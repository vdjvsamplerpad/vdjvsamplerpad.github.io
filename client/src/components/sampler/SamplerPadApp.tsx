import * as React from 'react';
import { SamplerPadAppView } from './SamplerPadAppView';
import {
  SETTINGS_STORAGE_KEY,
  createDefaultSettings,
  isNativeAndroid,
  isGraphicsProfile,
  isPadTriggerMode,
  mergeSystemMappings,
  normalizePadSize,
  serializeDeckLayoutForDiff,
  type AppSettings,
  type ExtendedSystemAction
} from './SamplerPadApp.shared';
import { useSamplerStore } from './hooks/useSamplerStore';
import { isOfficialPadContent } from './hooks/useSamplerStore.provenance';
import { useGlobalPlaybackManager } from './hooks/useGlobalPlaybackManager';
import { useSamplerPadAppMappings } from './hooks/useSamplerPadAppMappings';
import { useTheme } from './hooks/useTheme';
import { useWindowSize } from './hooks/useWindowSize';
import { PadData } from './types/sampler';
import { normalizeShortcutKey, normalizeStoredShortcutKey } from '@/lib/keyboard-shortcuts';
import { MidiMessage, useWebMidi } from '@/lib/midi';
import { DEFAULT_SYSTEM_MAPPINGS, SystemAction, SystemMappings } from '@/lib/system-mappings';
import type { MidiDeviceProfile } from '@/lib/midi/device-profiles';
import { performanceMonitor, type PerformanceTier } from '@/lib/performance-monitor';
import { getCachedUser, useAuth } from '@/hooks/useAuth';
import { getAudioTelemetry } from '@/lib/audio-telemetry';
import { getLatestUserSamplerMetadataSnapshot } from '@/lib/user-sampler-snapshot-api';
import {
  summarizeRemoteSnapshotPrompt,
  type RemoteSnapshotPromptState,
  type SamplerMetadataSnapshot,
} from './hooks/useSamplerStore.snapshotMetadata';
import {
  DECK_LAYOUT_SCHEMA_VERSION,
  normalizeDeckLayoutEntries,
} from './utils/deck-layout-persistence';
const PAD_SIZE_MIN = 2;
const PAD_SIZE_MAX_PORTRAIT = 8;
const PAD_SIZE_MAX_LANDSCAPE = 16;
const DEFAULT_PAD_SIZE = 6;
const DEFAULT_BANK_SOURCE_ID = 'vdjv-default-bank-source';
const PAD_WARMUP_MAX_PER_BANK = 10;
const PAD_WARMUP_MAX_TOTAL = 20;
const PAD_WARMUP_IDLE_DELAY_MS = 120;
const PAD_WARMUP_MOBILE_MAX_DURATION_MS = 120_000;
const PAD_WARMUP_NATIVE_MAX_DURATION_MS = 90_000;
const PAD_WARMUP_UNKNOWN_SAFE_MAX_BYTES = 1_500_000;
const PAD_WARMUP_UNKNOWN_SAFE_MAX_TRIM_MS = 12_000;

interface PadWarmupPolicy {
  maxPerBank: number;
  maxTotal: number;
  idleDelayMs: number;
  maxDurationMs: number | null;
  skipUnknownDuration: boolean;
}

const createFallbackMidiDeviceProfile = (): MidiDeviceProfile => ({
  id: 'generic',
  name: 'Generic (loading...)',
  matches: () => false,
  mapColorToVelocity: () => 127,
  resolveLed: (_note, desiredColor, channel) => ({
    color: desiredColor,
    channel,
    velocity: 127
  })
});

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const resolvePadWarmupPolicy = (): PadWarmupPolicy => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return {
      maxPerBank: PAD_WARMUP_MAX_PER_BANK,
      maxTotal: PAD_WARMUP_MAX_TOTAL,
      idleDelayMs: PAD_WARMUP_IDLE_DELAY_MS,
      maxDurationMs: PAD_WARMUP_MOBILE_MAX_DURATION_MS,
      skipUnknownDuration: false
    };
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = nav.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
  const isIOSUA = /iPhone|iPad|iPod/i.test(ua);
  const isNativeCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());

  let base: PadWarmupPolicy;
  if (isNativeCapacitor) {
    base = {
      maxPerBank: 6,
      maxTotal: 10,
      idleDelayMs: 180,
      maxDurationMs: PAD_WARMUP_NATIVE_MAX_DURATION_MS,
      skipUnknownDuration: true
    };
  } else if (isIOSUA) {
    base = {
      maxPerBank: 5,
      maxTotal: 8,
      idleDelayMs: 180,
      maxDurationMs: PAD_WARMUP_NATIVE_MAX_DURATION_MS,
      skipUnknownDuration: true
    };
  } else if (isMobileUA) {
    base = {
      maxPerBank: 8,
      maxTotal: 14,
      idleDelayMs: 140,
      maxDurationMs: PAD_WARMUP_MOBILE_MAX_DURATION_MS,
      skipUnknownDuration: false
    };
  } else {
    base = {
      maxPerBank: 14,
      maxTotal: 36,
      idleDelayMs: 60,
      maxDurationMs: null,
      skipUnknownDuration: false
    };
  }

  const deviceMemory = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
    ? nav.deviceMemory
    : null;
  const cpuCores = typeof nav.hardwareConcurrency === 'number' && Number.isFinite(nav.hardwareConcurrency)
    ? nav.hardwareConcurrency
    : null;

  let scale = 1;
  if (deviceMemory !== null) {
    if (deviceMemory <= 3) scale *= 0.55;
    else if (deviceMemory <= 4) scale *= 0.72;
    else if (!isNativeCapacitor && !isMobileUA && deviceMemory >= 8) scale *= 1.2;
  }
  if (cpuCores !== null) {
    if (cpuCores <= 4) scale *= 0.75;
    else if (!isNativeCapacitor && !isMobileUA && cpuCores >= 12) scale *= 1.1;
  }

  const maxPerBank = clampInt(base.maxPerBank * scale, 3, 24);
  const maxTotal = clampInt(base.maxTotal * scale, 6, 64);
  const inverseScale = Math.max(0.65, Math.min(1.8, scale > 0 ? 1 / scale : 1));
  const idleDelayMs = clampInt(base.idleDelayMs * inverseScale, 30, 260);

  return {
    ...base,
    maxPerBank,
    maxTotal,
    idleDelayMs
  };
};

const getPadDurationForWarmup = (pad: PadData): number | null => {
  if (typeof pad.audioDurationMs === 'number' && Number.isFinite(pad.audioDurationMs) && pad.audioDurationMs > 0) {
    return pad.audioDurationMs;
  }
  if (
    typeof pad.endTimeMs === 'number' &&
    Number.isFinite(pad.endTimeMs) &&
    typeof pad.startTimeMs === 'number' &&
    Number.isFinite(pad.startTimeMs)
  ) {
    const range = pad.endTimeMs - pad.startTimeMs;
    if (range > 0) return range;
  }
  return null;
};

const isRemoteHttpAudioUrl = (url: string): boolean => /^https?:\/\//i.test(url);
const isLikelyLocalAudioUrl = (url: string): boolean => {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('blob:')) return true;
  if (normalized.startsWith('data:')) return true;
  if (normalized.startsWith('file:')) return true;
  if (normalized.startsWith('capacitor://')) return true;
  if (normalized.startsWith('content://')) return true;
  if (normalized.startsWith('/')) return true;
  return !isRemoteHttpAudioUrl(normalized);
};

const shouldWarmUnknownDurationPad = (pad: PadData): boolean => {
  const audioUrl = typeof pad.audioUrl === 'string' ? pad.audioUrl.trim() : '';
  if (!audioUrl || !isLikelyLocalAudioUrl(audioUrl)) return false;
  if (typeof pad.audioBytes === 'number' && Number.isFinite(pad.audioBytes) && pad.audioBytes > 0) {
    return pad.audioBytes <= PAD_WARMUP_UNKNOWN_SAFE_MAX_BYTES;
  }
  if (
    typeof pad.endTimeMs === 'number' &&
    Number.isFinite(pad.endTimeMs) &&
    typeof pad.startTimeMs === 'number' &&
    Number.isFinite(pad.startTimeMs)
  ) {
    const trimmedWindowMs = pad.endTimeMs - pad.startTimeMs;
    return trimmedWindowMs > 0 && trimmedWindowMs <= PAD_WARMUP_UNKNOWN_SAFE_MAX_TRIM_MS;
  }
  return false;
};

const getTriggerWarmPriority = (mode: PadData['triggerMode']): number => {
  if (mode === 'stutter') return 0;
  if (mode === 'hold') return 1;
  if (mode === 'toggle') return 2;
  return 3;
};

export function SamplerPadApp() {
  const {
    banks,
    startupRestoreCompleted,
    primaryBankId,
    secondaryBankId,
    currentBankId,
    primaryBank,
    secondaryBank,
    currentBank,
    isDualMode,
    addPad,
    addPads,
    updatePad,
    removePad,
    createBank,
    setPrimaryBank,
    setSecondaryBank,
    setCurrentBank,
    updateBank,
    deleteBank,
    duplicateBank,
    duplicatePad,
    importBank,
    exportBank,
    reorderPads,
    moveBankUp,
    moveBankDown,
    transferPad,
    exportAdminBank,
    publishDefaultBankRelease,
    canTransferFromBank,
    exportAppBackup,
    restoreAppBackup,
    applySamplerMetadataSnapshot,
    relinkPadAudioFromFile,
    rehydratePadMedia,
    rehydrateMissingMediaInBank,
    recoverMissingMediaFromBanks
  } = useSamplerStore();

  const playbackManager = useGlobalPlaybackManager() as ReturnType<typeof useGlobalPlaybackManager> & {
    triggerToggle: (padId: string) => void;
    triggerHoldStart: (padId: string) => void;
    triggerHoldStop: (padId: string) => void;
    triggerStutter: (padId: string) => void;
    triggerUnmuteToggle: (padId: string) => void;
  };
  const { theme, toggleTheme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const midi = useWebMidi();
  const { user, profile, loading } = useAuth();
  const audioTelemetry = React.useMemo(
    () => getAudioTelemetry((import.meta as any).env?.VITE_APP_VERSION || 'unknown'),
    []
  );
  const [midiDeviceProfilesState, setMidiDeviceProfilesState] = React.useState<MidiDeviceProfile[]>([]);
  const midiProfileResolversRef = React.useRef<{
    byOutputName: (deviceName?: string | null) => MidiDeviceProfile;
    byId: (id?: string | null) => MidiDeviceProfile;
  }>({
    byOutputName: () => createFallbackMidiDeviceProfile(),
    byId: () => createFallbackMidiDeviceProfile(),
  });
  const effectiveAuthUser = user || getCachedUser();
  const defaultSettings = React.useMemo(
    () => createDefaultSettings(DECK_LAYOUT_SCHEMA_VERSION, DEFAULT_PAD_SIZE),
    []
  );
  const settingsSaveTimeoutRef = React.useRef<number | null>(null);
  const settingsLatestRef = React.useRef<AppSettings>(defaultSettings);
  const remoteSnapshotSyncAttemptRef = React.useRef<string | null>(null);
  const canUseAdminExport = profile?.role === 'admin';

  // Load settings from localStorage
  const [settings, setSettings] = React.useState<AppSettings>(() => {
    if (typeof window === 'undefined') return defaultSettings;

    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const parsedSettings = { ...(parsed || {}) } as Record<string, unknown>;
        delete parsedSettings.eqSettings;
        delete parsedSettings.mixerEqCollapsed;
        const mergedMappings = mergeSystemMappings(parsed.systemMappings || {});
        const parsedChannelCount = typeof parsed.channelCount === 'number'
          ? Math.max(2, Math.min(8, Math.floor(parsed.channelCount)))
          : defaultSettings.channelCount;
        const legacyPadSize = normalizePadSize(
          parsed.padSize,
          PAD_SIZE_MIN,
          PAD_SIZE_MAX_LANDSCAPE,
          DEFAULT_PAD_SIZE
        );
        const parsedPortraitPadSize = normalizePadSize(
          parsed.padSizePortrait,
          PAD_SIZE_MIN,
          PAD_SIZE_MAX_PORTRAIT,
          Math.min(PAD_SIZE_MAX_PORTRAIT, legacyPadSize)
        );
        const parsedLandscapePadSize = normalizePadSize(
          parsed.padSizeLandscape,
          PAD_SIZE_MIN,
          PAD_SIZE_MAX_LANDSCAPE,
          parsedPortraitPadSize
        );
        const parsedDeckLayout = normalizeDeckLayoutEntries(parsed.deckLayout);
        const parsedDefaultTriggerMode = isPadTriggerMode(parsed.defaultTriggerMode)
          ? parsed.defaultTriggerMode
          : defaultSettings.defaultTriggerMode;
        const parsedGraphicsProfile = isGraphicsProfile(parsed.graphicsProfile)
          ? parsed.graphicsProfile
          : defaultSettings.graphicsProfile;
        return {
          ...defaultSettings,
          ...parsedSettings,
          channelCount: parsedChannelCount,
          padSizePortrait: parsedPortraitPadSize,
          padSizeLandscape: parsedLandscapePadSize,
          channelCollapsedMap: typeof parsed.channelCollapsedMap === 'object' && parsed.channelCollapsedMap
            ? parsed.channelCollapsedMap
            : {},
          deckLayout: parsedDeckLayout,
          deckLayoutVersion: DECK_LAYOUT_SCHEMA_VERSION,
          systemMappings: {
            ...mergedMappings,
            channelCount: parsedChannelCount
          },
          defaultTriggerMode: parsedDefaultTriggerMode,
          graphicsProfile: parsedGraphicsProfile
        };
      }
    } catch {
    }
    return defaultSettings;
  });
  const [globalMuted, setGlobalMuted] = React.useState(false);
  const [isOnline, setIsOnline] = React.useState(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine)
  );
  const [error, setError] = React.useState<string | null>(null);
  const [showErrorDialog, setShowErrorDialog] = React.useState(false);
  const [missingMediaSummary, setMissingMediaSummary] = React.useState<{
    missingAudio: number;
    missingImages: number;
    affectedBanks: string[];
  } | null>(null);
  const [remoteSnapshotPrompt, setRemoteSnapshotPrompt] = React.useState<RemoteSnapshotPromptState | null>(null);
  const restoreBackupInputRef = React.useRef<HTMLInputElement>(null);
  const recoverBankInputRef = React.useRef<HTMLInputElement>(null);
  const [showRecoverBankModeDialog, setShowRecoverBankModeDialog] = React.useState(false);
  const [pendingRecoverAddAsNew, setPendingRecoverAddAsNew] = React.useState(false);
  const [editRequest, setEditRequest] = React.useState<{ padId: string; token: number } | null>(null);
  const [editBankRequest, setEditBankRequest] = React.useState<{ bankId: string; token: number } | null>(null);
  const [armedLoadChannelId, setArmedLoadChannelId] = React.useState<number | null>(null);
  const [pendingChannelLoadConfirm, setPendingChannelLoadConfirm] = React.useState<{
    channelId: number;
    pad: PadData;
    bankId: string;
    bankName: string;
  } | null>(null);
  const [pendingOfficialPadTransferConfirm, setPendingOfficialPadTransferConfirm] = React.useState<{
    padId: string;
    sourceBankId: string;
    targetBankId: string;
    padName: string;
    targetBankName: string;
  } | null>(null);
  const bankScrollPositionsRef = React.useRef<Map<string, number>>(new Map());
  const singleScrollRef = React.useRef<HTMLDivElement | null>(null);
  const primaryScrollRef = React.useRef<HTMLDivElement | null>(null);
  const secondaryScrollRef = React.useRef<HTMLDivElement | null>(null);
  const singleFallbackScrollRef = React.useRef(0);
  const primaryFallbackScrollRef = React.useRef(0);
  const secondaryFallbackScrollRef = React.useRef(0);
  const lastSingleScrollBankRef = React.useRef<string | null>(null);
  const lastPrimaryScrollBankRef = React.useRef<string | null>(null);
  const lastSecondaryScrollBankRef = React.useRef<string | null>(null);
  const deckHydratedRef = React.useRef(false);
  const lastDeckPersistRef = React.useRef('');
  const warmupRunIdRef = React.useRef(0);
  const warmedPadAudioRef = React.useRef<Map<string, string>>(new Map());
  const lastWarmupQueueLogKeyRef = React.useRef<string>('');
  const lastWarmupQueueLogAtRef = React.useRef(0);
  const warmupPolicy = React.useMemo(() => resolvePadWarmupPolicy(), []);
  const warmupSourceSignature = React.useMemo(() => {
    const activeBankIds: string[] = [];
    if (isDualMode) {
      if (primaryBankId) activeBankIds.push(primaryBankId);
      if (secondaryBankId && secondaryBankId !== primaryBankId) activeBankIds.push(secondaryBankId);
    } else if (currentBankId) {
      activeBankIds.push(currentBankId);
    }

    if (activeBankIds.length === 0) {
      return `online:${isOnline ? 1 : 0}|active:none`;
    }

    const bankById = new Map(banks.map((bank) => [bank.id, bank] as const));
    const bankParts = activeBankIds.map((bankId) => {
      const bank = bankById.get(bankId);
      if (!bank) return `${bankId}:missing`;

      const padParts = bank.pads
        .map((pad, index) => {
          const audioUrl = typeof pad.audioUrl === 'string' ? pad.audioUrl.trim() : '';
          if (!audioUrl) return '';
          const durationMs = getPadDurationForWarmup(pad);
          const triggerMode = typeof pad.triggerMode === 'string' ? pad.triggerMode : 'toggle';
          const position = Number.isFinite(Number(pad.position)) ? Number(pad.position) : index;
          return [
            pad.id,
            audioUrl,
            triggerMode,
            position,
            durationMs ?? 'na',
            pad.audioBytes ?? 'na'
          ].join('~');
        })
        .filter(Boolean)
        .join('|');

      return `${bank.id}#${bank.name}#${padParts}`;
    });

    return `online:${isOnline ? 1 : 0}|active:${activeBankIds.join(',')}|banks:${bankParts.join('||')}`;
  }, [banks, currentBankId, isDualMode, isOnline, primaryBankId, secondaryBankId]);

  // Global Toast State
  const [directImportSuccess, setDirectImportSuccess] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  React.useEffect(() => {
    performanceMonitor.setOverrideTier(settings.graphicsProfile === 'auto' ? null : settings.graphicsProfile);
  }, [settings.graphicsProfile]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const highMotion = settings.graphicsProfile === 'high';
    root.classList.toggle('motion-off', !highMotion);
    root.classList.toggle('motion-full', highMotion);
  }, [settings.graphicsProfile]);

  const effectiveGraphicsTier = React.useMemo<PerformanceTier>(() => {
    return settings.graphicsProfile === 'auto' ? performanceMonitor.getTier() : settings.graphicsProfile;
  }, [settings.graphicsProfile]);

  const effectiveGraphicsTierLabel = React.useMemo(() => {
    if (settings.graphicsProfile === 'auto') return `Auto (${effectiveGraphicsTier})`;
    return settings.graphicsProfile.charAt(0).toUpperCase() + settings.graphicsProfile.slice(1);
  }, [effectiveGraphicsTier, settings.graphicsProfile]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('graphics-lowest', effectiveGraphicsTier === 'lowest');
  }, [effectiveGraphicsTier]);

  React.useEffect(() => {
    settingsLatestRef.current = settings;
  }, [settings]);

  // Save settings to localStorage whenever they change
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (settingsSaveTimeoutRef.current !== null) return;
    settingsSaveTimeoutRef.current = window.setTimeout(() => {
      settingsSaveTimeoutRef.current = null;
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsLatestRef.current));
      } catch {
      }
    }, 200);
  }, [settings]);

  React.useEffect(
    () => () => {
      if (typeof window === 'undefined') return;
      if (settingsSaveTimeoutRef.current !== null) {
        window.clearTimeout(settingsSaveTimeoutRef.current);
        settingsSaveTimeoutRef.current = null;
      }
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsLatestRef.current));
      } catch {
      }
    },
    []
  );

  React.useEffect(() => {
    const mapped = typeof settings.systemMappings.channelCount === 'number'
      ? Math.max(2, Math.min(8, Math.floor(settings.systemMappings.channelCount)))
      : null;
    if (mapped === null || mapped === settings.channelCount) return;
    setSettings((prev) => ({
      ...prev,
      channelCount: mapped,
      systemMappings: {
        ...prev.systemMappings,
        channelCount: mapped
      }
    }));
  }, [settings.channelCount, settings.systemMappings.channelCount]);

  React.useEffect(() => {
    if (!settings.midiEnabled) return;
    if (midi.enabled && !midi.accessGranted) {
      midi.requestAccess();
    }
  }, [settings.midiEnabled, midi.enabled, midi.accessGranted, midi.requestAccess]);

  React.useEffect(() => {
    if (!midi.supported) return;
    let cancelled = false;

    void import('@/lib/midi/device-profiles').then((module) => {
      if (cancelled) return;
      midiProfileResolversRef.current = {
        byOutputName: module.getMidiDeviceProfile,
        byId: module.getMidiDeviceProfileById,
      };
      setMidiDeviceProfilesState(module.midiDeviceProfiles);
    }).catch(() => {
    });

    return () => {
      cancelled = true;
    };
  }, [midi.supported]);

  React.useEffect(() => {
    if (midi.enabled !== settings.midiEnabled) {
      midi.setEnabled(settings.midiEnabled);
    }
  }, [midi, settings.midiEnabled]);

  React.useEffect(() => {
    const onMissingMediaDetected = (event: Event) => {
      const detail = (event as CustomEvent<{ missingAudio: number; missingImages: number; affectedBanks: string[] }>).detail;
      if (!detail || (detail.missingAudio <= 0 && detail.missingImages <= 0)) return;
      setMissingMediaSummary(detail);
    };

    const onDirectBankImport = async (event: Event) => {
      const customEvent = event as CustomEvent<{ file: File, bankName?: string, thumbnailUrl?: string }>;
      if (customEvent.detail?.file) {
        try {
          const imported = await importBank(customEvent.detail.file);
          // Patch thumbnailUrl into bankMetadata if provided
          if (imported && customEvent.detail.thumbnailUrl && imported.bankMetadata) {
            updateBank(imported.id, {
              bankMetadata: { ...imported.bankMetadata, thumbnailUrl: customEvent.detail.thumbnailUrl }
            });
          }
          setDirectImportSuccess(customEvent.detail.bankName || 'Bank');
          setTimeout(() => setDirectImportSuccess(null), 3500);
        } catch (err: any) {
          setError(`Failed to import bank directly: ${err.message || String(err)}`);
          setShowErrorDialog(true);
        }
      }
    };

    window.addEventListener('vdjv-missing-media-detected', onMissingMediaDetected as EventListener);
    window.addEventListener('vdjv-import-bank-direct', onDirectBankImport as EventListener);
    return () => {
      window.removeEventListener('vdjv-missing-media-detected', onMissingMediaDetected as EventListener);
      window.removeEventListener('vdjv-import-bank-direct', onDirectBankImport as EventListener);
    };
  }, [importBank]);

  React.useEffect(() => {
    setMissingMediaSummary(null);
  }, [effectiveAuthUser?.id]);

  // Update individual settings
  const updateSetting = React.useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const requestEditPad = React.useCallback((padId: string) => {
    setEditRequest({ padId, token: Date.now() });
  }, []);

  const requestEditBank = React.useCallback((bankId: string) => {
    setEditBankRequest({ bankId, token: Date.now() });
  }, []);

  const handleToggleHideShortcutLabels = React.useCallback((hide: boolean) => {
    updateSetting('hideShortcutLabels', hide);
  }, [updateSetting]);

  const handleToggleMidiEnabled = React.useCallback((enabled: boolean) => {
    updateSetting('midiEnabled', enabled);
    midi.setEnabled(enabled);
    if (enabled) {
      if (!midi.accessGranted) {
        midi.requestAccess();
      }
    } else {
      midi.setSelectedInputId(null);
    }
  }, [midi, updateSetting]);

  const isMac = React.useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    []
  );

  const defaultPadShortcutLayout = React.useMemo(() => ([
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P',
    'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';',
    'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad0'
  ]), []);

  const defaultBankShortcutLayout = React.useMemo(() => {
    const modifier = isMac ? 'Meta' : 'Alt';
    return [
      `${modifier}+1`, `${modifier}+2`, `${modifier}+3`, `${modifier}+4`, `${modifier}+5`,
      `${modifier}+6`, `${modifier}+7`, `${modifier}+8`, `${modifier}+9`, `${modifier}+0`
    ];
  }, [isMac]);

  const applyDefaultLayoutToBank = React.useCallback((bankId: string | null) => {
    if (!settings.autoPadBankMapping) return;
    if (!bankId) return;
    const bank = banks.find((entry) => entry.id === bankId);
    if (!bank) return;
    if (bank.disableDefaultPadShortcutLayout) return;
    const sortedPads = [...bank.pads].sort((a, b) => (a.position || 0) - (b.position || 0));
    sortedPads.forEach((pad, index) => {
      const desiredKey = defaultPadShortcutLayout[index] || undefined;
      if (pad.shortcutKey !== desiredKey) {
        updatePad(bank.id, pad.id, { ...pad, shortcutKey: desiredKey });
      }
    });
  }, [banks, defaultPadShortcutLayout, settings.autoPadBankMapping, updatePad]);

  const orderedBanks = React.useMemo(() => {
    return [...banks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [banks]);

  const lastAppliedLayoutRef = React.useRef<{ primary?: string | null; secondary?: string | null; single?: string | null }>({});
  React.useEffect(() => {
    if (!settings.autoPadBankMapping) return;
    if (isDualMode) {
      if (primaryBankId && lastAppliedLayoutRef.current.primary !== primaryBankId) {
        applyDefaultLayoutToBank(primaryBankId);
        lastAppliedLayoutRef.current.primary = primaryBankId;
      }
      if (secondaryBankId && lastAppliedLayoutRef.current.secondary !== secondaryBankId) {
        applyDefaultLayoutToBank(secondaryBankId);
        lastAppliedLayoutRef.current.secondary = secondaryBankId;
      }
    } else if (currentBankId && lastAppliedLayoutRef.current.single !== currentBankId) {
      applyDefaultLayoutToBank(currentBankId);
      lastAppliedLayoutRef.current.single = currentBankId;
    }
  }, [applyDefaultLayoutToBank, currentBankId, isDualMode, primaryBankId, secondaryBankId, settings.autoPadBankMapping]);

  const previousPadCountsRef = React.useRef<Map<string, number>>(new Map());
  React.useEffect(() => {
    const previousCounts = previousPadCountsRef.current;
    const nextCounts = new Map<string, number>();
    banks.forEach((bank) => {
      const currentCount = bank.pads.length;
      const previousCount = previousCounts.get(bank.id) ?? 0;
      nextCounts.set(bank.id, currentCount);
      if (settings.autoPadBankMapping && previousCount === 0 && currentCount > 0) {
        applyDefaultLayoutToBank(bank.id);
      }
    });
    previousPadCountsRef.current = nextCounts;
  }, [banks, applyDefaultLayoutToBank, settings.autoPadBankMapping]);

  const {
    pendingChannelCountConfirm,
    setPendingChannelCountConfirm,
    updateSystemKey,
    updateSystemMidi,
    updateSystemColor,
    resetSystemMapping,
    setMasterVolumeCC,
    updateChannelMapping,
    applyChannelCountChange,
    handleChannelCountChange,
    handleResetAllSystemMappings,
    handleClearAllSystemMappings,
    handleResetAllChannelMappings,
    handleClearAllChannelMappings,
    handleExportMappings,
    handleImportMappings,
    handleImportSharedBank,
    handleExportAppBackup,
    handleRestoreAppBackup,
    handleRecoverMissingMediaFromBanks,
    handleRetryMissingMediaInCurrentBank,
    padShortcutByBank,
    midiNoteByBank,
    midiCCByBank,
    midiBankNoteMap,
    midiBankCCMap,
    midiNoteAssignments,
    bankShortcutMap,
    padBankShortcutKeys,
    padBankMidiNotes,
    padBankMidiCCs,
    channelMappings,
    blockedShortcutKeys,
    blockedMidiNotes,
    blockedMidiCCs
  } = useSamplerPadAppMappings({
    banks,
    currentBankId,
    primaryBankId,
    secondaryBankId,
    settings,
    setSettings,
    playbackManager,
    updateBank,
    updatePad,
    importBank,
    exportAppBackup,
    restoreAppBackup,
    recoverMissingMediaFromBanks,
    rehydrateMissingMediaInBank,
    defaultBankShortcutLayout,
    orderedBanks,
    normalizeStoredShortcutKey
  });

  React.useEffect(() => {
    if (loading) return;
    if (!startupRestoreCompleted) return;
    if (!effectiveAuthUser?.id) return;

    const hasLocalUserBanks = banks.some((bank) => bank.remoteSnapshotApplied || (
      bank.sourceBankId !== DEFAULT_BANK_SOURCE_ID && bank.name !== 'Default Bank'
    ));
    if (hasLocalUserBanks) return;

    const userId = effectiveAuthUser.id;
    if (remoteSnapshotSyncAttemptRef.current === userId) return;
    remoteSnapshotSyncAttemptRef.current = userId;

    let cancelled = false;
    const storageKey = `vdjv-remote-snapshot-applied:${userId}`;

    void (async () => {
      try {
        const { snapshot, savedAt } = await getLatestUserSamplerMetadataSnapshot();
        if (cancelled || !snapshot) return;

        const snapshotMarker = savedAt || snapshot.exportedAt || '';
        if (typeof window !== 'undefined' && snapshotMarker && localStorage.getItem(storageKey) === snapshotMarker) {
          return;
        }
        setRemoteSnapshotPrompt({
          snapshot,
          summary: summarizeRemoteSnapshotPrompt(snapshot),
        });
      } catch {
        remoteSnapshotSyncAttemptRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySamplerMetadataSnapshot, banks, effectiveAuthUser?.id, loading, startupRestoreCompleted]);

  const applyRemoteSnapshotToDevice = React.useCallback(async (snapshot: SamplerMetadataSnapshot) => {
    const result = await applySamplerMetadataSnapshot(snapshot);

    if (result.settings) {
      const restoredSettings = result.settings as Partial<AppSettings>;
      const normalizedDeckLayout = normalizeDeckLayoutEntries(restoredSettings.deckLayout);
      setSettings((prev) => ({
        ...prev,
        ...restoredSettings,
        deckLayout: normalizedDeckLayout,
        deckLayoutVersion: DECK_LAYOUT_SCHEMA_VERSION,
        systemMappings: mergeSystemMappings((restoredSettings.systemMappings || prev.systemMappings) as Partial<SystemMappings>),
      }));
    }

    if (result.mappings) {
      const mappingsPayload = result.mappings as { systemMappings?: Partial<SystemMappings> };
      if (mappingsPayload?.systemMappings) {
        setSettings((prev) => ({
          ...prev,
          systemMappings: mergeSystemMappings(mappingsPayload.systemMappings),
        }));
      }
    }

    const userId = effectiveAuthUser?.id;
    const snapshotMarker = snapshot.exportedAt || '';
    if (typeof window !== 'undefined' && userId && snapshotMarker) {
      localStorage.setItem(`vdjv-remote-snapshot-applied:${userId}`, snapshotMarker);
    }

    return result;
  }, [applySamplerMetadataSnapshot, effectiveAuthUser?.id]);

  const handleApplyRemoteSnapshot = React.useCallback(async () => {
    if (!remoteSnapshotPrompt) return;
    try {
      const result = await applyRemoteSnapshotToDevice(remoteSnapshotPrompt.snapshot);
      setRemoteSnapshotPrompt(null);
      setError(result.message);
      setShowErrorDialog(true);
    } catch (snapshotError) {
      setError(snapshotError instanceof Error ? snapshotError.message : 'Failed to sync sampler metadata.');
      setShowErrorDialog(true);
    }
  }, [applyRemoteSnapshotToDevice, remoteSnapshotPrompt]);

  React.useEffect(() => {
    playbackManager.setChannelCount(settings.channelCount);
  }, [playbackManager, settings.channelCount]);

  React.useEffect(() => {
    if (deckHydratedRef.current) return;
    if (!banks.length) return;

    let cancelled = false;
    const hydrateDeck = async () => {
      for (const entry of settings.deckLayout || []) {
        if (cancelled) return;
        if (!entry?.loadedPadRef?.padId || typeof entry.channelId !== 'number') continue;
        const bank = banks.find((item) => item.id === entry.loadedPadRef?.bankId);
        const pad = bank?.pads.find((item) => item.id === entry.loadedPadRef?.padId);
        if (!bank || !pad) continue;
        await playbackManager.registerPad(pad.id, pad, bank.id, bank.name);
        const loaded = playbackManager.loadPadToChannel(entry.channelId, pad.id);
        if (!loaded) continue;
        if (Array.isArray(entry.hotcuesMs)) {
          entry.hotcuesMs.slice(0, 4).forEach((cue, index) => {
            if (typeof cue === 'number') {
              playbackManager.setChannelHotcue(entry.channelId, index, cue);
            } else {
              playbackManager.clearChannelHotcue(entry.channelId, index);
            }
          });
        }
        if (typeof entry.collapsed === 'boolean') {
          playbackManager.setChannelCollapsed(entry.channelId, entry.collapsed);
        }
        if (typeof entry.channelVolume === 'number') {
          playbackManager.setChannelVolume(entry.channelId, entry.channelVolume);
        }
        playbackManager.restoreChannelPlaybackState(
          entry.channelId,
          typeof entry.positionMs === 'number' ? entry.positionMs : 0,
          true
        );
      }
      deckHydratedRef.current = true;
    };

    void hydrateDeck();
    return () => {
      cancelled = true;
    };
  }, [banks, playbackManager, settings.deckLayout]);

  const normalizeMidiValue = React.useCallback((value: number) => {
    // Scale full MIDI CC range (0-127) to 0-1.
    const clamped = Math.max(0, Math.min(127, value));
    return clamped / 127;
  }, []);

  // Get playing pads from global manager
  const channelStates = playbackManager.getChannelStates();
  const legacyPlayingPads = playbackManager.getLegacyPlayingPads();
  const audioRecoveryState = playbackManager.getAudioRecoveryState();
  const isIOSClient =
    typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  const handleRestoreAudio = React.useCallback(() => {
    playbackManager.preUnlockAudio().catch((unlockError) => {
    });
  }, [playbackManager]);

  React.useEffect(() => {
    if (!deckHydratedRef.current) return;
    const snapshot = playbackManager.persistDeckLayoutSnapshot();
    const nextJson = serializeDeckLayoutForDiff(snapshot);
    if (lastDeckPersistRef.current === nextJson) return;
    lastDeckPersistRef.current = nextJson;
    setSettings((prev) => {
      const prevJson = serializeDeckLayoutForDiff(prev.deckLayout || []);
      if (prevJson === nextJson) return prev;
      const collapsedMap: Record<number, boolean> = {};
      snapshot.forEach((item) => {
        collapsedMap[item.channelId] = !!item.collapsed;
      });
      return {
        ...prev,
        deckLayout: snapshot,
        deckLayoutVersion: DECK_LAYOUT_SCHEMA_VERSION,
        channelCollapsedMap: collapsedMap
      };
    });
  }, [channelStates, playbackManager]);

  const getPreferredOutputName = React.useCallback(() => {
    const selectedInput = midi.inputs.find((input) => input.id === midi.selectedInputId);
    return selectedInput?.name;
  }, [midi.inputs, midi.selectedInputId]);

  const lastLedNotesRef = React.useRef<Set<number>>(new Set());
  const ledEchoRef = React.useRef<Map<string, number>>(new Map());
  const systemFlashRef = React.useRef<Map<number, { until: number; color: string; channel: number }>>(new Map());
  const [ledFlashTick, setLedFlashTick] = React.useState(0);

  const markLedEcho = React.useCallback((note: number, channel: number) => {
    ledEchoRef.current.set(`${note}:${channel}`, Date.now());
  }, []);

  const flashSystemLed = React.useCallback(
    (note: number | undefined, color: string, channel: number, durationMs: number = 250) => {
      if (typeof note !== 'number') return;
      systemFlashRef.current.set(note, { until: Date.now() + durationMs, color, channel });
      setLedFlashTick(Date.now());
      window.setTimeout(() => setLedFlashTick(Date.now()), durationMs + 20);
    },
    []
  );

  const [uploadInProgress, setUploadInProgress] = React.useState(false);
  const [importInProgress, setImportInProgress] = React.useState(false);

  React.useEffect(() => {
    const handleUploadStart = () => setUploadInProgress(true);
    const handleUploadEnd = () => setUploadInProgress(false);
    const handleImportStart = () => setImportInProgress(true);
    const handleImportEnd = () => setImportInProgress(false);
    window.addEventListener('vdjv-upload-start', handleUploadStart as EventListener);
    window.addEventListener('vdjv-upload-end', handleUploadEnd as EventListener);
    window.addEventListener('vdjv-import-start', handleImportStart as EventListener);
    window.addEventListener('vdjv-import-end', handleImportEnd as EventListener);
    return () => {
      window.removeEventListener('vdjv-upload-start', handleUploadStart as EventListener);
      window.removeEventListener('vdjv-upload-end', handleUploadEnd as EventListener);
      window.removeEventListener('vdjv-import-start', handleImportStart as EventListener);
      window.removeEventListener('vdjv-import-end', handleImportEnd as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (!midi.accessGranted) return;
    const outputName = getPreferredOutputName();
    const nextNotes = new Set<number>();
    const allPadNotes = new Set<number>();
    const targetPadNotes = new Set<number>();
    const playingPads = new Set(
      playbackManager.getAllPlayingPads().map((entry) => `${entry.bankId}:${entry.padId}`)
    );

    const solidChannel = 6;
    const midChannel = 0;
    const pulseChannel = 7;
    const blinkChannel = 13;

    const midiProfile = settings.midiDeviceProfileId
      ? midiProfileResolversRef.current.byId(settings.midiDeviceProfileId)
      : midiProfileResolversRef.current.byOutputName(outputName);
    const resolveLed = (note: number, desired: string, channel: number) =>
      midiProfile.resolveLed(note, desired, channel);

    const midiShiftActive = midiShiftActiveRef.current;
    const targetPadBankId = isDualMode
      ? (midiShiftActive ? secondaryBankId : primaryBankId)
      : currentBankId;

    banks.forEach((bank) => {
      bank.pads.forEach((pad) => {
        if (typeof pad.midiNote === 'number') {
          allPadNotes.add(pad.midiNote);
        }
      });
      if (typeof bank.midiNote === 'number') {
        const isActiveBank = isDualMode
          ? bank.id === primaryBankId || bank.id === secondaryBankId
          : bank.id === currentBankId;
        const bankChannel = isActiveBank ? pulseChannel : midChannel;
        const led = resolveLed(bank.midiNote, bank.defaultColor, bankChannel);
        midi.sendNoteOn(bank.midiNote, led.velocity, { outputName, channel: led.channel });
        markLedEcho(bank.midiNote, led.channel);
        nextNotes.add(bank.midiNote);
      }
    });

    if (targetPadBankId) {
      const targetBank = banks.find((bank) => bank.id === targetPadBankId);
      if (targetBank) {
        targetBank.pads.forEach((pad) => {
          if (typeof pad.midiNote !== 'number') return;
          targetPadNotes.add(pad.midiNote);
          const padChannel = settings.editMode ? midChannel : solidChannel;
          if (playingPads.has(`${targetBank.id}:${pad.id}`)) {
            const led = resolveLed(pad.midiNote, pad.color, blinkChannel);
            midi.sendNoteOn(pad.midiNote, led.velocity, { outputName, channel: led.channel });
            markLedEcho(pad.midiNote, led.channel);
            nextNotes.add(pad.midiNote);
            return;
          }
          const led = resolveLed(pad.midiNote, pad.color, padChannel);
          midi.sendNoteOn(pad.midiNote, led.velocity, { outputName, channel: led.channel });
          markLedEcho(pad.midiNote, led.channel);
          nextNotes.add(pad.midiNote);
        });
      }
    }

    const systemDefaults: Record<SystemAction, string> = {
      stopAll: '#00ff00',
      mixer: '#00a9ff',
      editMode: '#ffff00',
      mute: '#ff0000',
      banksMenu: '#00a9ff',
      nextBank: '#ffffff',
      prevBank: '#ffffff',
      upload: '#ffffff',
      volumeUp: '#ffffff',
      volumeDown: '#ffffff',
      padSizeUp: '#ffffff',
      padSizeDown: '#ffffff',
      importBank: '#ffffff',
      activateSecondary: '#7f00ff',
      midiShift: '#00a9ff'
    };

    (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const action = key as SystemAction;
        const mapping = settings.systemMappings[action];
        if (typeof mapping?.midiNote !== 'number') return;
        const flash = systemFlashRef.current.get(mapping.midiNote);
        const now = Date.now();
        if (flash && flash.until > now) {
          const led = resolveLed(mapping.midiNote, flash.color, flash.channel);
          midi.sendNoteOn(mapping.midiNote, led.velocity, { outputName, channel: led.channel });
          markLedEcho(mapping.midiNote, led.channel);
          nextNotes.add(mapping.midiNote);
          return;
        }

        const baseColor = mapping.color || systemDefaults[action] || '#ff0000';
        let channel = midChannel;
        if (action === 'mixer') channel = settings.mixerOpen ? solidChannel : midChannel;
        if (action === 'banksMenu') channel = settings.sideMenuOpen ? solidChannel : midChannel;
        if (action === 'editMode') channel = settings.editMode ? solidChannel : midChannel;
        if (action === 'activateSecondary') channel = isDualMode ? solidChannel : midChannel;
        if (action === 'midiShift') {
          const shiftEnabled = isDualMode && Boolean(secondaryBankId);
          channel = shiftEnabled ? (midiShiftActive ? blinkChannel : solidChannel) : midChannel;
        }
        if (action === 'upload' && uploadInProgress) channel = blinkChannel;
        if (action === 'importBank' && importInProgress) channel = blinkChannel;

        const ledColor = action === 'midiShift' && midiShiftActive ? '#ff0000' : baseColor;
        const led = resolveLed(mapping.midiNote, ledColor, channel);
        midi.sendNoteOn(mapping.midiNote, led.velocity, { outputName, channel: led.channel });
        markLedEcho(mapping.midiNote, led.channel);
        nextNotes.add(mapping.midiNote);
      });

    const channelMappings = settings.systemMappings.channelMappings || [];
    channelMappings.forEach((mapping) => {
      if (typeof mapping?.midiNote !== 'number') return;
      const led = resolveLed(mapping.midiNote, '#ff0000', solidChannel);
      midi.sendNoteOn(mapping.midiNote, led.velocity, { outputName, channel: led.channel });
      markLedEcho(mapping.midiNote, led.channel);
      nextNotes.add(mapping.midiNote);
    });

    const allLedChannels = [solidChannel, midChannel, pulseChannel, blinkChannel];

    allPadNotes.forEach((note) => {
      if (targetPadNotes.has(note)) return;
      if (nextNotes.has(note)) return;
      allLedChannels.forEach((channel) => {
        // Use note-on with velocity 0 for devices that ignore note-off.
        midi.sendNoteOn(note, 0, { outputName, channel });
        markLedEcho(note, channel);
      });
    });

    lastLedNotesRef.current.forEach((note) => {
      if (!nextNotes.has(note)) {
        allLedChannels.forEach((channel) => {
          midi.sendNoteOn(note, 0, { outputName, channel });
          markLedEcho(note, channel);
        });
      }
    });
    lastLedNotesRef.current = nextNotes;
  }, [
    banks,
    settings.systemMappings,
    midi,
    getPreferredOutputName,
    playbackManager,
    isDualMode,
    primaryBankId,
    secondaryBankId,
    currentBankId,
    markLedEcho,
    settings.editMode,
    settings.mixerOpen,
    settings.sideMenuOpen,
    theme,
    uploadInProgress,
    importInProgress,
    ledFlashTick,
    settings.midiDeviceProfileId
  ]);

  const isPhonePortraitScreen = React.useMemo(() => {
    return windowWidth < 900 && windowHeight > windowWidth;
  }, [windowHeight, windowWidth]);
  const isPortraitOrSmallScreen = React.useMemo(() => {
    return windowWidth < 768 || isPhonePortraitScreen;
  }, [isPhonePortraitScreen, windowWidth]);
  const shouldFocusPadsForChannelLoad = React.useMemo(() => {
    return settings.sidePanelMode === 'overlay' || isPortraitOrSmallScreen;
  }, [settings.sidePanelMode, isPortraitOrSmallScreen]);

  // Handle responsive side menu behavior
  React.useEffect(() => {
    if (isPortraitOrSmallScreen && settings.sideMenuOpen && settings.mixerOpen) {
      updateSetting('mixerOpen', false);
    }
  }, [isPortraitOrSmallScreen, settings.sideMenuOpen, settings.mixerOpen, updateSetting]);

  // Apply global settings to playback manager
  React.useEffect(() => {
    playbackManager.setGlobalMute(globalMuted);
  }, [globalMuted, playbackManager]);

  React.useEffect(() => {
    playbackManager.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume, playbackManager]);

  const handleSideMenuToggle = React.useCallback((open: boolean) => {
    updateSetting('sideMenuOpen', open);
    if (open && isPortraitOrSmallScreen) {
      updateSetting('mixerOpen', false);
      return;
    }
    if (!open && armedLoadChannelId !== null && shouldFocusPadsForChannelLoad) {
      updateSetting('mixerOpen', true);
    }
  }, [armedLoadChannelId, isPortraitOrSmallScreen, shouldFocusPadsForChannelLoad, updateSetting]);

  const handleMixerToggle = React.useCallback((open: boolean) => {
    updateSetting('mixerOpen', open);
    if (open && isPortraitOrSmallScreen) {
      updateSetting('sideMenuOpen', false);
    }
  }, [isPortraitOrSmallScreen, updateSetting]);

  React.useEffect(() => {
    if (armedLoadChannelId === null) return;
    const safeChannelCount = Math.max(2, Math.min(8, settings.channelCount || 4));
    if (armedLoadChannelId > safeChannelCount) {
      setArmedLoadChannelId(null);
    }
  }, [armedLoadChannelId, settings.channelCount]);

  const requestDefaultBankLogin = React.useCallback(() => {
    window.dispatchEvent(new Event('vdjv-login-request'));
    window.dispatchEvent(new CustomEvent('vdjv-require-login', {
      detail: { reason: 'Please sign in to play default bank pads.' }
    }));
  }, []);

  const handleFileUpload = React.useCallback(async (file: File, targetBankId?: string) => {
    try {
      const effectiveUser = user || getCachedUser();
      if (!effectiveUser) {
        window.dispatchEvent(new Event('vdjv-login-request'));
        return;
      }
      if (!file.type.startsWith('audio/')) {
        setError('Invalid file type. Please select an audio file.');
        setShowErrorDialog(true);
        return;
      }

      const maxAudioSizeMB = 50;
      const maxAudioSizeBytes = maxAudioSizeMB * 1024 * 1024;

      if (file.size > maxAudioSizeBytes) {
        setError(`Audio file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size allowed is ${maxAudioSizeMB}MB. Please use a smaller audio file.`);
        setShowErrorDialog(true);
        return;
      }

      window.dispatchEvent(new Event('vdjv-upload-start'));
      await addPad(file, targetBankId, { defaultTriggerMode: settings.defaultTriggerMode });
      window.dispatchEvent(new Event('vdjv-upload-end'));
    } catch (error) {
      window.dispatchEvent(new Event('vdjv-upload-end'));
      const resolvedError = error instanceof Error ? error : new Error('Failed to upload file. Please try again.');
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('Failed to upload file. Please try again.');
      }
      setShowErrorDialog(true);
      throw resolvedError;
    }
  }, [addPad, settings.defaultTriggerMode, user]);

  const handleStopAll = React.useCallback(() => {
    // Header STOP ALL should only stop pad-grid playback, not deck channels.
    const playingPads = playbackManager.getLegacyPlayingPads();
    playingPads.forEach((pad) => {
      playbackManager.stopPad(pad.padId, settings.stopMode);
    });
  }, [playbackManager, settings.stopMode]);

  const handleStopSpecificPad = React.useCallback((padId: string) => {

    playbackManager.stopPad(padId, settings.stopMode);
  }, [playbackManager, settings.stopMode]);

  const handleToggleMute = React.useCallback(() => {
    const newMuted = !globalMuted;

    setGlobalMuted(newMuted);
  }, [globalMuted]);

  const handlePadVolumeChange = React.useCallback((padId: string, volume: number) => {

    for (const bank of banks) {
      const pad = bank.pads.find(p => p.id === padId);
      if (pad) {
        updatePad(bank.id, padId, { ...pad, volume });
        break;
      }
    }
    playbackManager.updatePadVolume(padId, volume);
  }, [banks, updatePad, playbackManager]);

  const handleChannelVolumeChange = React.useCallback((channelId: number, volume: number) => {
    playbackManager.setChannelVolume(channelId, volume);
  }, [playbackManager]);

  const handleStopChannel = React.useCallback((channelId: number) => {
    playbackManager.stopChannel(channelId, settings.stopMode);
  }, [playbackManager, settings.stopMode]);

  const handlePauseChannel = React.useCallback((channelId: number) => {
    playbackManager.pauseChannel(channelId);
  }, [playbackManager]);

  const handlePlayChannel = React.useCallback((channelId: number) => {
    playbackManager.playChannel(channelId);
  }, [playbackManager]);

  const handleSeekChannel = React.useCallback((channelId: number, ms: number) => {
    playbackManager.seekChannel(channelId, ms);
  }, [playbackManager]);

  const handleUnloadChannel = React.useCallback((channelId: number) => {
    playbackManager.unloadChannel(channelId);
  }, [playbackManager]);

  const handleTriggerChannelHotcue = React.useCallback((channelId: number, slotIndex: number) => {
    playbackManager.triggerChannelHotcue(channelId, slotIndex);
  }, [playbackManager]);

  const persistChannelHotcuesToPad = React.useCallback((channelId: number) => {
    const result = playbackManager.saveChannelHotcuesToPad(channelId);
    if (!result.ok || !result.padId || !Array.isArray(result.savedHotcuesMs)) return;
    for (const bank of banks) {
      const pad = bank.pads.find((entry) => entry.id === result.padId);
      if (!pad) continue;
      updatePad(bank.id, pad.id, {
        ...pad,
        savedHotcuesMs: result.savedHotcuesMs
      });
      return;
    }
  }, [banks, playbackManager, updatePad]);

  const handleSetChannelHotcue = React.useCallback((channelId: number, slotIndex: number, ms: number | null) => {
    playbackManager.setChannelHotcue(channelId, slotIndex, ms);
    persistChannelHotcuesToPad(channelId);
  }, [playbackManager, persistChannelHotcuesToPad]);

  const handleSetChannelCollapsed = React.useCallback((channelId: number, collapsed: boolean) => {
    playbackManager.setChannelCollapsed(channelId, collapsed);
  }, [playbackManager]);

  const handleArmChannelLoad = React.useCallback((channelId: number) => {
    const isSameChannel = armedLoadChannelId === channelId;
    const next = isSameChannel ? null : channelId;
    setArmedLoadChannelId(next);
    setPendingChannelLoadConfirm(null);

    if (!isSameChannel) {
      if (settings.editMode) {
        updateSetting('editMode', false);
      }
      if (shouldFocusPadsForChannelLoad) {
        updateSetting('sideMenuOpen', false);
        updateSetting('mixerOpen', false);
      }
    }
  }, [armedLoadChannelId, settings.editMode, shouldFocusPadsForChannelLoad, updateSetting]);

  const handleCancelChannelLoad = React.useCallback(() => {
    setArmedLoadChannelId(null);
    setPendingChannelLoadConfirm(null);
  }, []);

  const handleCancelChannelLoadFromHeader = React.useCallback(() => {
    setArmedLoadChannelId(null);
    setPendingChannelLoadConfirm(null);
    if (shouldFocusPadsForChannelLoad) {
      updateSetting('mixerOpen', false);
    }
  }, [shouldFocusPadsForChannelLoad, updateSetting]);

  const executePadLoadToChannel = React.useCallback(async (
    channelId: number,
    pad: PadData,
    bankId: string,
    bankName: string
  ) => {
    try {
      await playbackManager.registerPad(pad.id, pad, bankId, bankName);
      const loaded = playbackManager.loadPadToChannel(channelId, pad.id);
      if (!loaded) {
        setError(`Failed to load "${pad.name}" into Channel ${channelId}.`);
        setShowErrorDialog(true);
        return;
      }
      setPendingChannelLoadConfirm(null);
      setArmedLoadChannelId(null);
      if (shouldFocusPadsForChannelLoad) {
        updateSetting('sideMenuOpen', false);
      }
      updateSetting('mixerOpen', true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load pad into channel.');
      setShowErrorDialog(true);
    }
  }, [playbackManager, shouldFocusPadsForChannelLoad, updateSetting]);

  const handleSelectPadForChannelLoad = React.useCallback((pad: PadData, bankId: string, bankName: string) => {
    if (armedLoadChannelId === null) return;
    const channelId = armedLoadChannelId;
    const targetChannel = playbackManager.getChannelStates().find((entry) => entry.channelId === channelId);
    if (targetChannel?.isPlaying) {
      setPendingChannelLoadConfirm({ channelId, pad, bankId, bankName });
      return;
    }
    void executePadLoadToChannel(channelId, pad, bankId, bankName);
  }, [armedLoadChannelId, executePadLoadToChannel, playbackManager]);

  const isPortraitViewport = React.useMemo(() => windowHeight > windowWidth, [windowHeight, windowWidth]);
  const activePadSizeMax = isPortraitViewport ? PAD_SIZE_MAX_PORTRAIT : PAD_SIZE_MAX_LANDSCAPE;
  const activePadSizeRaw = isPortraitViewport ? settings.padSizePortrait : settings.padSizeLandscape;
  const requiresEvenPadColumns = isDualMode && !isPortraitViewport;

  const displayPadSize = React.useMemo(() => {
    const clamped = normalizePadSize(activePadSizeRaw, PAD_SIZE_MIN, activePadSizeMax, DEFAULT_PAD_SIZE);
    if (!requiresEvenPadColumns || clamped % 2 === 0) return clamped;
    return clamped > PAD_SIZE_MIN ? clamped - 1 : Math.min(activePadSizeMax, clamped + 1);
  }, [activePadSizeRaw, activePadSizeMax, requiresEvenPadColumns]);

  const handlePadSizeChange = React.useCallback((requestedSize: number) => {
    const maxForOrientation = isPortraitViewport ? PAD_SIZE_MAX_PORTRAIT : PAD_SIZE_MAX_LANDSCAPE;
    let nextSize = normalizePadSize(requestedSize, PAD_SIZE_MIN, maxForOrientation, DEFAULT_PAD_SIZE);
    if (requiresEvenPadColumns && nextSize % 2 !== 0) {
      nextSize = nextSize > PAD_SIZE_MIN ? nextSize - 1 : Math.min(maxForOrientation, nextSize + 1);
    }

    setSettings((prev) => ({
      ...prev,
      padSizePortrait: isPortraitViewport ? nextSize : prev.padSizePortrait,
      padSizeLandscape: isPortraitViewport ? prev.padSizeLandscape : nextSize
    }));
  }, [isPortraitViewport, requiresEvenPadColumns]);

  const handleResetPadSize = React.useCallback(() => {
    handlePadSizeChange(DEFAULT_PAD_SIZE);
  }, [handlePadSizeChange]);

  const handlePadSizeIncrease = React.useCallback(() => {
    const step = isDualMode ? 2 : 1;
    handlePadSizeChange(displayPadSize + step);
  }, [displayPadSize, handlePadSizeChange, isDualMode]);

  const handlePadSizeDecrease = React.useCallback(() => {
    const step = isDualMode ? 2 : 1;
    handlePadSizeChange(displayPadSize - step);
  }, [displayPadSize, handlePadSizeChange, isDualMode]);

  // Handle pad removal - ensure playback manager cleans up
  const handleRemovePad = React.useCallback((bankId: string, id: string) => {
    // Stop and clean up the pad in the global manager first
    playbackManager.unregisterPad(id);
    // Then remove from the store
    removePad(bankId, id);
  }, [playbackManager, removePad]);

  const handleDuplicatePad = React.useCallback(async (bankId: string, padId: string) => {
    await duplicatePad(bankId, padId);
  }, [duplicatePad]);

  // Handle bank deletion - clean up all pads
  const handleDeleteBank = React.useCallback((bankId: string) => {
    const bank = banks.find(b => b.id === bankId);
    if (bank) {
      // Clean up all pads in the bank from the playback manager
      bank.pads.forEach(pad => {
        playbackManager.unregisterPad(pad.id);
      });
    }
    deleteBank(bankId);
  }, [banks, playbackManager, deleteBank]);

  // Handle pad updates with error handling
  const handleUpdatePad = React.useCallback(
    async (bankId: string, id: string, updatedPad: any) => {
      try {
        // Look for the pad across all banks, in case bankId is stale
        let targetBank = banks.find(b => b.pads.some(p => p.id === id));
        if (!targetBank) {
          throw new Error('Pad not found');
        }

        const currentPad = targetBank.pads.find(p => p.id === id);
        if (!currentPad) {
          throw new Error('Pad not found');
        }

        // Merge updated fields with existing pad
        const mergedPad = {
          ...currentPad,
          ...updatedPad,
          imageData:
            updatedPad.imageData !== undefined
              ? updatedPad.imageData
              : currentPad.imageData,
          imageUrl:
            updatedPad.imageUrl !== undefined
              ? updatedPad.imageUrl
              : currentPad.imageUrl,
        };

        await updatePad(targetBank.id, id, mergedPad);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError('Failed to update pad. Please try again.');
        }
        setShowErrorDialog(true);
      }
    },
    [banks, updatePad]
  );

  const saveBankScroll = React.useCallback((bankId: string | null, scrollTop: number) => {
    if (!bankId) return;
    bankScrollPositionsRef.current.set(bankId, Math.max(0, scrollTop));
  }, []);

  const restoreBankScroll = React.useCallback((container: HTMLDivElement | null, bankId: string | null, fallback: number) => {
    if (!container || !bankId) return;
    const remembered = bankScrollPositionsRef.current.get(bankId);
    container.scrollTop = typeof remembered === 'number' ? remembered : fallback;
  }, []);

  React.useEffect(() => {
    const prev = lastSingleScrollBankRef.current;
    if (prev && singleScrollRef.current) {
      saveBankScroll(prev, singleScrollRef.current.scrollTop);
    }
    if (singleScrollRef.current && currentBankId) {
      const fallback = singleScrollRef.current.scrollTop || singleFallbackScrollRef.current;
      requestAnimationFrame(() => restoreBankScroll(singleScrollRef.current, currentBankId, fallback));
    }
    lastSingleScrollBankRef.current = currentBankId;
  }, [currentBankId, restoreBankScroll, saveBankScroll]);

  React.useEffect(() => {
    const prev = lastPrimaryScrollBankRef.current;
    if (prev && primaryScrollRef.current) {
      saveBankScroll(prev, primaryScrollRef.current.scrollTop);
    }
    if (primaryScrollRef.current && primaryBankId) {
      const fallback = primaryScrollRef.current.scrollTop || primaryFallbackScrollRef.current;
      requestAnimationFrame(() => restoreBankScroll(primaryScrollRef.current, primaryBankId, fallback));
    }
    lastPrimaryScrollBankRef.current = primaryBankId;
  }, [primaryBankId, restoreBankScroll, saveBankScroll]);

  React.useEffect(() => {
    const prev = lastSecondaryScrollBankRef.current;
    if (prev && secondaryScrollRef.current) {
      saveBankScroll(prev, secondaryScrollRef.current.scrollTop);
    }
    if (secondaryScrollRef.current && secondaryBankId) {
      const fallback = secondaryScrollRef.current.scrollTop || secondaryFallbackScrollRef.current;
      requestAnimationFrame(() => restoreBankScroll(secondaryScrollRef.current, secondaryBankId, fallback));
    }
    lastSecondaryScrollBankRef.current = secondaryBankId;
  }, [secondaryBankId, restoreBankScroll, saveBankScroll]);

  const ensureRegisteredAndTrigger = React.useCallback(
    (pad: PadData, bankId: string, bankName: string, trigger: () => void) => {
      if (playbackManager.isPadRegistered(pad.id)) {
        trigger();
        return;
      }

      playbackManager
        .registerPad(pad.id, pad, bankId, bankName)
        .then(() => trigger())
        .catch((error) => {
        });
    },
    [playbackManager]
  );

  const activeHoldKeysRef = React.useRef<Map<string, string>>(new Map());
  const lastSelectedBankIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isDualMode && currentBankId) {
      lastSelectedBankIdRef.current = currentBankId;
      return;
    }
    if (isDualMode && secondaryBankId) {
      lastSelectedBankIdRef.current = secondaryBankId;
    }
  }, [isDualMode, currentBankId, secondaryBankId]);

  React.useEffect(() => {
    const runId = ++warmupRunIdRef.current;
    let cancelled = false;
    let startTimer: number | null = null;
    let delayTimer: number | null = null;

    const knownPadAudioById = new Map<string, string>();
    banks.forEach((bank) => {
      bank.pads.forEach((pad) => {
        const audioUrl = typeof pad.audioUrl === 'string' ? pad.audioUrl.trim() : '';
        if (!audioUrl) return;
        knownPadAudioById.set(pad.id, audioUrl);
      });
    });

    warmedPadAudioRef.current.forEach((audioUrl, padId) => {
      const knownAudioUrl = knownPadAudioById.get(padId);
      if (!knownAudioUrl || knownAudioUrl !== audioUrl) {
        warmedPadAudioRef.current.delete(padId);
      }
    });

    const activeBankIds: string[] = [];
    if (isDualMode) {
      if (primaryBankId) activeBankIds.push(primaryBankId);
      if (secondaryBankId && secondaryBankId !== primaryBankId) activeBankIds.push(secondaryBankId);
    } else if (currentBankId) {
      activeBankIds.push(currentBankId);
    }
    if (activeBankIds.length === 0) {
      audioTelemetry.log('warmup_queue_skipped', {
        runId,
        reason: 'no_active_banks'
      });
      return () => {
        cancelled = true;
      };
    }

    const focusedBankId = lastSelectedBankIdRef.current;
    const orderedActiveBankIds = [...activeBankIds].sort((left, right) => {
      if (left === focusedBankId) return -1;
      if (right === focusedBankId) return 1;
      return 0;
    });

    const queue: Array<{ bankId: string; bankName: string; pad: PadData; audioUrl: string }> = [];
    for (const bankId of orderedActiveBankIds) {
      const bank = banks.find((entry) => entry.id === bankId);
      if (!bank) continue;

      const candidates = [...bank.pads]
        .filter((pad) => {
          const audioUrl = typeof pad.audioUrl === 'string' ? pad.audioUrl.trim() : '';
          if (!audioUrl) return false;
          if (!isOnline && isRemoteHttpAudioUrl(audioUrl)) return false;
          const durationMs = getPadDurationForWarmup(pad);
          if (warmupPolicy.maxDurationMs !== null) {
            if (durationMs === null && warmupPolicy.skipUnknownDuration && !shouldWarmUnknownDurationPad(pad)) return false;
            if (durationMs !== null && durationMs > warmupPolicy.maxDurationMs) return false;
          }
          return warmedPadAudioRef.current.get(pad.id) !== audioUrl;
        })
        .sort((left, right) => {
          const leftUrl = left.audioUrl.trim();
          const rightUrl = right.audioUrl.trim();
          const leftLocalScore = isLikelyLocalAudioUrl(leftUrl) ? 0 : 1;
          const rightLocalScore = isLikelyLocalAudioUrl(rightUrl) ? 0 : 1;
          if (leftLocalScore !== rightLocalScore) return leftLocalScore - rightLocalScore;

          const leftTrigger = getTriggerWarmPriority(left.triggerMode);
          const rightTrigger = getTriggerWarmPriority(right.triggerMode);
          if (leftTrigger !== rightTrigger) return leftTrigger - rightTrigger;

          const leftDuration = getPadDurationForWarmup(left) ?? Number.MAX_SAFE_INTEGER;
          const rightDuration = getPadDurationForWarmup(right) ?? Number.MAX_SAFE_INTEGER;
          if (leftDuration !== rightDuration) return leftDuration - rightDuration;

          return (left.position || 0) - (right.position || 0);
        })
        .slice(0, warmupPolicy.maxPerBank);

      for (const pad of candidates) {
        if (queue.length >= warmupPolicy.maxTotal) break;
        queue.push({
          bankId: bank.id,
          bankName: bank.name,
          pad,
          audioUrl: pad.audioUrl.trim()
        });
      }
      if (queue.length >= warmupPolicy.maxTotal) break;
    }

    const queueLogKey = [
      focusedBankId || '',
      orderedActiveBankIds.join(','),
      queue.length,
      warmupPolicy.maxPerBank,
      warmupPolicy.maxTotal,
      warmupPolicy.idleDelayMs,
      warmupPolicy.maxDurationMs ?? 'none',
      isOnline ? 'on' : 'off'
    ].join('|');
    const nowMs = Date.now();
    const canLogQueueBuild = nowMs - lastWarmupQueueLogAtRef.current >= 3000;
    if (canLogQueueBuild && lastWarmupQueueLogKeyRef.current !== queueLogKey) {
      lastWarmupQueueLogKeyRef.current = queueLogKey;
      lastWarmupQueueLogAtRef.current = nowMs;
      audioTelemetry.log('warmup_queue_built', {
        runId,
        focusedBankId: focusedBankId || null,
        activeBankIds: orderedActiveBankIds,
        queueLength: queue.length,
        maxPerBank: warmupPolicy.maxPerBank,
        maxTotal: warmupPolicy.maxTotal,
        idleDelayMs: warmupPolicy.idleDelayMs,
        maxDurationMs: warmupPolicy.maxDurationMs
      });
    }

    if (queue.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const waitDelay = () =>
      new Promise<void>((resolve) => {
        delayTimer = window.setTimeout(() => {
          delayTimer = null;
          resolve();
        }, warmupPolicy.idleDelayMs);
      });

    const runWarmup = async () => {
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (cancelled || runId !== warmupRunIdRef.current) return;
        audioTelemetry.log('warmup_item_start', {
          runId,
          index: index + 1,
          total: queue.length,
          bankId: item.bankId,
          padId: item.pad.id,
          triggerMode: item.pad.triggerMode,
          durationMs: getPadDurationForWarmup(item.pad),
          audioBytes: item.pad.audioBytes
        });
        try {
          const warmed = await playbackManager.preloadPad(item.pad.id, item.pad, item.bankId, item.bankName);
          if (warmed && !cancelled && runId === warmupRunIdRef.current) {
            warmedPadAudioRef.current.set(item.pad.id, item.audioUrl);
          }
          audioTelemetry.log('warmup_item_result', {
            runId,
            index: index + 1,
            total: queue.length,
            bankId: item.bankId,
            padId: item.pad.id,
            warmed,
            backend: playbackManager.getEngineBackendForPad(item.pad.id)
          }, warmed ? 'info' : 'warn');
        } catch {
          audioTelemetry.log('warmup_item_result', {
            runId,
            index: index + 1,
            total: queue.length,
            bankId: item.bankId,
            padId: item.pad.id,
            warmed: false,
            reason: 'preload_exception'
          }, 'error');
        }
        if (warmupPolicy.idleDelayMs > 0) {
          await waitDelay();
        }
      }
      audioTelemetry.log('warmup_queue_complete', {
        runId,
        total: queue.length
      });
    };

    startTimer = window.setTimeout(() => {
      void runWarmup();
    }, warmupPolicy.idleDelayMs);

    return () => {
      cancelled = true;
      if (startTimer !== null) {
        window.clearTimeout(startTimer);
        startTimer = null;
      }
      if (delayTimer !== null) {
        window.clearTimeout(delayTimer);
        delayTimer = null;
      }
    };
  }, [audioTelemetry, currentBankId, isDualMode, isOnline, playbackManager, primaryBankId, secondaryBankId, warmupPolicy, warmupSourceSignature]);

  const handleBankShortcut = React.useCallback((bankId: string) => {
    if (isDualMode) {
      if (bankId === primaryBankId) {
        const fallback = lastSelectedBankIdRef.current;
        if (fallback && fallback !== primaryBankId) {
          setSecondaryBank(fallback);
        }
        return;
      }
      setSecondaryBank(bankId);
      lastSelectedBankIdRef.current = bankId;
      return;
    }
    setCurrentBank(bankId);
    lastSelectedBankIdRef.current = bankId;
  }, [isDualMode, primaryBankId, setSecondaryBank, setCurrentBank]);

  const handleCycleBank = React.useCallback((direction: 'next' | 'prev') => {
    if (orderedBanks.length === 0) return;
    const activeId = isDualMode ? (secondaryBankId || primaryBankId) : currentBankId;
    const currentIndex = orderedBanks.findIndex((bank) => bank.id === activeId);
    const offset = direction === 'next' ? 1 : -1;
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + offset + orderedBanks.length) % orderedBanks.length;
    const nextId = orderedBanks[nextIndex]?.id;
    if (!nextId) return;
    if (isDualMode) {
      setSecondaryBank(nextId);
    } else {
      setCurrentBank(nextId);
    }
    lastSelectedBankIdRef.current = nextId;
  }, [orderedBanks, isDualMode, secondaryBankId, primaryBankId, currentBankId, setSecondaryBank, setCurrentBank]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!target || !(target as HTMLElement).tagName) return false;
      const element = target as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      return (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        element.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const normalized = normalizeShortcutKey(event.key, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        code: event.code
      });
      if (!normalized) return;

      const systemAction = (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
        .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings' && key !== 'midiShift')
        .find((key) => settings.systemMappings[key as SystemAction]?.key === normalized) as ExtendedSystemAction | undefined;

      if (systemAction) {
        event.preventDefault();
        switch (systemAction) {
          case 'stopAll':
            handleStopAll();
            flashSystemLed(settings.systemMappings.stopAll?.midiNote, '#00ff00', 6);
            return;
          case 'mixer':
            if (armedLoadChannelId !== null) {
              handleCancelChannelLoadFromHeader();
            } else {
              handleMixerToggle(!settings.mixerOpen);
            }
            return;
          case 'editMode':
            updateSetting('editMode', !settings.editMode);
            return;
          case 'mute':
            handleToggleMute();
            return;
          case 'banksMenu':
            handleSideMenuToggle(!settings.sideMenuOpen);
            return;
          case 'nextBank':
            handleCycleBank('next');
            flashSystemLed(settings.systemMappings.nextBank?.midiNote, '#ffffff', 6);
            return;
          case 'prevBank':
            handleCycleBank('prev');
            flashSystemLed(settings.systemMappings.prevBank?.midiNote, '#ffffff', 6);
            return;
          case 'upload': {
            const input = document.getElementById('global-audio-upload-input') as HTMLInputElement | null;
            input?.click();
            flashSystemLed(settings.systemMappings.upload?.midiNote, '#ffffff', 6);
            return;
          }
          case 'volumeDown': {
            const next = Math.max(0, Number((settings.masterVolume - 0.05).toFixed(2)));
            updateSetting('masterVolume', next);
            return;
          }
          case 'volumeUp': {
            const next = Math.min(1, Number((settings.masterVolume + 0.05).toFixed(2)));
            updateSetting('masterVolume', next);
            return;
          }
          case 'padSizeUp':
            handlePadSizeIncrease();
            flashSystemLed(settings.systemMappings.padSizeUp?.midiNote, '#ffffff', 6);
            return;
          case 'padSizeDown':
            handlePadSizeDecrease();
            flashSystemLed(settings.systemMappings.padSizeDown?.midiNote, '#ffffff', 6);
            return;
          case 'importBank':
            window.dispatchEvent(new Event('vdjv-import-bank'));
            flashSystemLed(settings.systemMappings.importBank?.midiNote, '#ffffff', 6);
            return;
          case 'activateSecondary': {
            const targetBankId = currentBankId || banks[0]?.id || null;
            if (isDualMode) {
              setPrimaryBank(null);
            } else if (targetBankId) {
              setPrimaryBank(targetBankId);
            }
            return;
          }
        }
      }

      const channelMappings = settings.systemMappings.channelMappings || [];
      const activeChannelLimit = Math.max(2, Math.min(8, settings.channelCount || 4));
      for (let i = 0; i < Math.min(channelMappings.length, activeChannelLimit); i += 1) {
        const mapping = channelMappings[i];
        if (!mapping) continue;
        const cId = i + 1;

        if (mapping.keyUp && mapping.keyUp === normalized) {
          event.preventDefault();
          const current = playbackManager.getChannelVolume(cId);
          playbackManager.setChannelVolume(cId, Math.min(1, Number((current + 0.05).toFixed(2))));
          return;
        }
        if (mapping.keyDown && mapping.keyDown === normalized) {
          event.preventDefault();
          const current = playbackManager.getChannelVolume(cId);
          playbackManager.setChannelVolume(cId, Math.max(0, Number((current - 0.05).toFixed(2))));
          return;
        }
        if (mapping.keyStop && mapping.keyStop === normalized) {
          event.preventDefault();
          handleStopChannel(cId);
          return;
        }
        if (mapping.keyPlayPause && mapping.keyPlayPause === normalized) {
          event.preventDefault();
          const channelState = playbackManager.getChannelStates().find((c) => c.channelId === cId);
          if (channelState) {
            if (channelState.isPlaying) handlePauseChannel(cId);
            else handlePlayChannel(cId);
          }
          return;
        }
        if (mapping.keyLoadArm && mapping.keyLoadArm === normalized) {
          event.preventDefault();
          handleArmChannelLoad(cId);
          return;
        }
        if (mapping.keyCancelLoad && mapping.keyCancelLoad === normalized) {
          event.preventDefault();
          handleCancelChannelLoadFromHeader();
          return;
        }

        const hotcueKeys = [mapping.keyHotcue1, mapping.keyHotcue2, mapping.keyHotcue3, mapping.keyHotcue4];
        let handledHotcue = false;
        for (let hc = 0; hc < 4; hc++) {
          if (hotcueKeys[hc] && hotcueKeys[hc] === normalized) {
            event.preventDefault();
            handleTriggerChannelHotcue(cId, hc);
            handledHotcue = true;
            break;
          }
        }
        if (handledHotcue) return;

        const setHotcueKeys = [mapping.keySetHotcue1, mapping.keySetHotcue2, mapping.keySetHotcue3, mapping.keySetHotcue4];
        for (let hc = 0; hc < 4; hc++) {
          if (setHotcueKeys[hc] && setHotcueKeys[hc] === normalized) {
            event.preventDefault();
            const channelState = playbackManager.getChannelStates().find((c) => c.channelId === cId);
            if (channelState) {
              if (channelState.hotcuesMs[hc] !== null) {
                playbackManager.clearChannelHotcue(cId, hc);
                persistChannelHotcuesToPad(cId);
              } else {
                handleSetChannelHotcue(cId, hc, channelState.playheadMs);
              }
            }
            handledHotcue = true;
            break;
          }
        }
        if (handledHotcue) return;
      }

      if (event.repeat) return;

      const hasNonShiftModifier = event.ctrlKey || event.altKey || event.metaKey;
      const comboKey = hasNonShiftModifier
        ? normalizeShortcutKey(event.key, {
          shiftKey: false,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          code: event.code
        })
        : null;
      const baseKey = normalizeShortcutKey(event.key, { code: event.code });
      if (!baseKey && !comboKey) return;

      const isShifted = !hasNonShiftModifier && event.shiftKey;
      const lookupKey = comboKey && !event.shiftKey ? comboKey : baseKey;

      if (!isShifted && lookupKey) {
        const bankShortcut = bankShortcutMap.get(lookupKey);
        if (bankShortcut) {
          event.preventDefault();
          if (settings.editMode) {
            requestEditBank(bankShortcut.bankId);
            return;
          }
          handleBankShortcut(bankShortcut.bankId);
          return;
        }
      }

      if (!lookupKey) return;
      const targetBankId = isDualMode ? (isShifted ? secondaryBankId : primaryBankId) : currentBankId;
      if (!targetBankId) return;
      const padMap = padShortcutByBank.get(targetBankId);
      const mapped = padMap?.get(lookupKey);
      if (mapped) {
        event.preventDefault();
        if (settings.editMode) {
          requestEditPad(mapped.pad.id);
          return;
        }
        switch (mapped.pad.triggerMode) {
          case 'toggle':
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerToggle(mapped.pad.id)
            );
            break;
          case 'hold': {
            const holdKey = `${mapped.bankId}:${lookupKey}`;
            activeHoldKeysRef.current.set(holdKey, mapped.pad.id);
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerHoldStart(mapped.pad.id)
            );
            break;
          }
          case 'stutter':
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerStutter(mapped.pad.id)
            );
            break;
          case 'unmute':
          default:
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerUnmuteToggle(mapped.pad.id)
            );
            break;
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const hasNonShiftModifier = event.ctrlKey || event.altKey || event.metaKey;
      const comboKey = hasNonShiftModifier
        ? normalizeShortcutKey(event.key, {
          shiftKey: false,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          code: event.code
        })
        : null;
      const baseKey = normalizeShortcutKey(event.key, { code: event.code });
      const lookupKey = comboKey && !event.shiftKey ? comboKey : baseKey;
      if (!lookupKey) return;

      const holdTargets = [
        primaryBankId ? `${primaryBankId}:${lookupKey}` : null,
        secondaryBankId ? `${secondaryBankId}:${lookupKey}` : null,
        currentBankId ? `${currentBankId}:${lookupKey}` : null
      ].filter(Boolean) as string[];
      holdTargets.forEach((holdKey) => {
        const holdPadId = activeHoldKeysRef.current.get(holdKey);
        if (holdPadId) {
          playbackManager.triggerHoldStop(holdPadId);
          activeHoldKeysRef.current.delete(holdKey);
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    handleMixerToggle,
    handleCancelChannelLoadFromHeader,
    handleSideMenuToggle,
    handleStopAll,
    handleToggleMute,
    ensureRegisteredAndTrigger,
    padShortcutByBank,
    bankShortcutMap,
    settings.editMode,
    settings.masterVolume,
    settings.mixerOpen,
    settings.sideMenuOpen,
    armedLoadChannelId,
    settings.systemMappings,
    updateSetting,
    isDualMode,
    setCurrentBank,
    setSecondaryBank,
    playbackManager,
    handlePadSizeIncrease,
    handlePadSizeDecrease,
    handleCycleBank,
    currentBankId,
    banks,
    handleBankShortcut,
    primaryBankId,
    secondaryBankId,
    requestEditPad,
    requestEditBank
  ]);

  const midiDebounceRef = React.useRef<Map<string, number>>(new Map());
  const activeMidiNotesRef = React.useRef<Map<string, boolean>>(new Map());
  const midiHoldPadByNoteRef = React.useRef<Map<number, string>>(new Map());
  const midiShiftActiveRef = React.useRef(false);
  const pendingMidiMasterVolumeRef = React.useRef<number | null>(null);
  const midiMasterVolumeRafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!isDualMode || !secondaryBankId) {
      midiShiftActiveRef.current = false;
    }
  }, [isDualMode, secondaryBankId]);

  React.useEffect(() => {
    return () => {
      if (midiMasterVolumeRafRef.current !== null) {
        window.cancelAnimationFrame(midiMasterVolumeRafRef.current);
        midiMasterVolumeRafRef.current = null;
      }
      pendingMidiMasterVolumeRef.current = null;
    };
  }, []);

  const handleMidiMessage = React.useCallback((message: MidiMessage) => {
    const resolvePad = (mapped: { pad: PadData; bankId: string; bankName: string } | undefined) => {
      if (!mapped) return null;
      return mapped;
    };

    const handleSystemAction = (action: ExtendedSystemAction) => {
      switch (action) {
        case 'stopAll':
          handleStopAll();
          flashSystemLed(settings.systemMappings.stopAll?.midiNote, '#00ff00', 6);
          return true;
        case 'mixer':
          if (armedLoadChannelId !== null) {
            handleCancelChannelLoadFromHeader();
          } else {
            handleMixerToggle(!settings.mixerOpen);
          }
          return true;
        case 'editMode':
          updateSetting('editMode', !settings.editMode);
          return true;
        case 'mute':
          handleToggleMute();
          return true;
        case 'banksMenu':
          handleSideMenuToggle(!settings.sideMenuOpen);
          return true;
        case 'nextBank':
          handleCycleBank('next');
          flashSystemLed(settings.systemMappings.nextBank?.midiNote, '#ffffff', 6);
          return true;
        case 'prevBank':
          handleCycleBank('prev');
          flashSystemLed(settings.systemMappings.prevBank?.midiNote, '#ffffff', 6);
          return true;
        case 'upload': {
          const input = document.getElementById('global-audio-upload-input') as HTMLInputElement | null;
          input?.click();
          flashSystemLed(settings.systemMappings.upload?.midiNote, '#ffffff', 6);
          return true;
        }
        case 'volumeUp': {
          const next = Math.min(1, Number((settings.masterVolume + 0.05).toFixed(2)));
          updateSetting('masterVolume', next);
          return true;
        }
        case 'volumeDown': {
          const next = Math.max(0, Number((settings.masterVolume - 0.05).toFixed(2)));
          updateSetting('masterVolume', next);
          return true;
        }
        case 'padSizeUp':
          handlePadSizeIncrease();
          flashSystemLed(settings.systemMappings.padSizeUp?.midiNote, '#ffffff', 6);
          return true;
        case 'padSizeDown':
          handlePadSizeDecrease();
          flashSystemLed(settings.systemMappings.padSizeDown?.midiNote, '#ffffff', 6);
          return true;
        case 'importBank':
          window.dispatchEvent(new Event('vdjv-import-bank'));
          flashSystemLed(settings.systemMappings.importBank?.midiNote, '#ffffff', 6);
          return true;
        case 'activateSecondary': {
          const targetBankId = currentBankId || banks[0]?.id || null;
          if (isDualMode) {
            setPrimaryBank(null);
          } else if (targetBankId) {
            setPrimaryBank(targetBankId);
          }
          return true;
        }
      }
      return false;
    };

    const midiShiftNote = settings.systemMappings.midiShift?.midiNote;
    if (message.type === 'noteon' || message.type === 'noteoff') {
      if (message.channel !== 0) {
        const echoAt = ledEchoRef.current.get(`${message.note}:${message.channel}`);
        if (echoAt && Date.now() - echoAt < 80) {
          return;
        }
      }
      const noteKey = `${message.inputId}:${message.note}`;
      if (message.type === 'noteoff') {
        activeMidiNotesRef.current.delete(noteKey);
      } else {
        if (activeMidiNotesRef.current.get(noteKey)) {
          return;
        }
        activeMidiNotesRef.current.set(noteKey, true);
      }

      if (message.note === midiShiftNote) {
        if (isDualMode && secondaryBankId && message.type === 'noteon') {
          midiShiftActiveRef.current = !midiShiftActiveRef.current;
        }
        return;
      }

      if (message.type === 'noteon') {
        const channelMappings = settings.systemMappings.channelMappings || [];
        const activeChannelLimit = Math.max(2, Math.min(8, settings.channelCount || 4));
        let handledChannelMidi = false;

        for (let i = 0; i < Math.min(channelMappings.length, activeChannelLimit); i += 1) {
          const mapping = channelMappings[i];
          if (!mapping) continue;
          const cId = i + 1;

          if (mapping.midiNote === message.note || mapping.midiStop === message.note) {
            handleStopChannel(cId);
            handledChannelMidi = true;
            break;
          }
          if (mapping.midiPlayPause === message.note) {
            const channelState = playbackManager.getChannelStates().find((c) => c.channelId === cId);
            if (channelState) {
              if (channelState.isPlaying) handlePauseChannel(cId);
              else handlePlayChannel(cId);
            }
            handledChannelMidi = true;
            break;
          }
          if (mapping.midiLoadArm === message.note) {
            handleArmChannelLoad(cId);
            handledChannelMidi = true;
            break;
          }
          if (mapping.midiCancelLoad === message.note) {
            handleCancelChannelLoadFromHeader();
            handledChannelMidi = true;
            break;
          }

          const hcMidis = [mapping.midiHotcue1, mapping.midiHotcue2, mapping.midiHotcue3, mapping.midiHotcue4];
          for (let hc = 0; hc < 4; hc++) {
            if (hcMidis[hc] === message.note) {
              handleTriggerChannelHotcue(cId, hc);
              handledChannelMidi = true;
              break;
            }
          }
          if (handledChannelMidi) break;

          const hcSetMidis = [mapping.midiSetHotcue1, mapping.midiSetHotcue2, mapping.midiSetHotcue3, mapping.midiSetHotcue4];
          for (let hc = 0; hc < 4; hc++) {
            if (hcSetMidis[hc] === message.note) {
              const channelState = playbackManager.getChannelStates().find((c) => c.channelId === cId);
              if (channelState) {
                if (channelState.hotcuesMs[hc] !== null) {
                  playbackManager.clearChannelHotcue(cId, hc);
                  persistChannelHotcuesToPad(cId);
                } else {
                  handleSetChannelHotcue(cId, hc, channelState.playheadMs);
                }
              }
              handledChannelMidi = true;
              break;
            }
          }
          if (handledChannelMidi) break;
        }

        if (handledChannelMidi) return;

        const systemAction = (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as ExtendedSystemAction[]).find(
          (action) => action !== 'midiShift' && settings.systemMappings[action]?.midiNote === message.note
        );
        if (systemAction && handleSystemAction(systemAction)) {
          return;
        }
      }

      const midiShiftActive = midiShiftActiveRef.current;
      const targetBankId = isDualMode ? (midiShiftActive ? secondaryBankId : primaryBankId) : currentBankId;
      const secondaryTargetId = isDualMode ? (midiShiftActive ? primaryBankId : secondaryBankId) : null;

      const bankMapping = midiBankNoteMap.get(message.note);
      if (bankMapping && message.type === 'noteon') {
        if (settings.editMode) {
          requestEditBank(bankMapping.bankId);
        } else {
          handleBankShortcut(bankMapping.bankId);
        }
        return;
      }

      const mapped =
        (targetBankId ? resolvePad(midiNoteByBank.get(targetBankId)?.get(message.note)) : null) ||
        (message.type === 'noteoff' && secondaryTargetId ? resolvePad(midiNoteByBank.get(secondaryTargetId)?.get(message.note)) : null);
      if (!mapped) return;

      if (message.type === 'noteoff') {
        if (settings.editMode) {
          return;
        }
        if (mapped.pad.triggerMode === 'hold') {
          const activeHoldPadId = midiHoldPadByNoteRef.current.get(message.note);
          if (activeHoldPadId === mapped.pad.id) {
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerHoldStop(mapped.pad.id)
            );
            midiHoldPadByNoteRef.current.delete(message.note);
          }
        }
        return;
      }

      const debounceKey = `${mapped.pad.id}-${message.note}`;
      const now = Date.now();
      const last = midiDebounceRef.current.get(debounceKey) || 0;
      if (now - last < 120) return;
      midiDebounceRef.current.set(debounceKey, now);

      if (settings.editMode) {
        requestEditPad(mapped.pad.id);
        return;
      }

      switch (mapped.pad.triggerMode) {
        case 'toggle':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerToggle(mapped.pad.id)
          );
          break;
        case 'hold':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerHoldStart(mapped.pad.id)
          );
          midiHoldPadByNoteRef.current.set(message.note, mapped.pad.id);
          break;
        case 'stutter':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerStutter(mapped.pad.id)
          );
          break;
        case 'unmute':
        default:
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerUnmuteToggle(mapped.pad.id)
          );
          break;
      }
    } else if (message.type === 'cc') {
      const channelMappings = settings.systemMappings.channelMappings || [];
      const activeChannelLimit = Math.max(2, Math.min(8, settings.channelCount || 4));
      const channelIndex = channelMappings.findIndex((mapping, index) => index < activeChannelLimit && mapping?.midiCC === message.cc);
      if (channelIndex >= 0) {
        const next = normalizeMidiValue(message.value);
        playbackManager.setChannelVolume(channelIndex + 1, Number(next.toFixed(3)));
        return;
      }

      if (typeof settings.systemMappings.masterVolumeCC === 'number' && settings.systemMappings.masterVolumeCC === message.cc) {
        pendingMidiMasterVolumeRef.current = Number(normalizeMidiValue(message.value).toFixed(3));
        if (midiMasterVolumeRafRef.current === null) {
          midiMasterVolumeRafRef.current = window.requestAnimationFrame(() => {
            midiMasterVolumeRafRef.current = null;
            const next = pendingMidiMasterVolumeRef.current;
            pendingMidiMasterVolumeRef.current = null;
            if (typeof next === 'number') {
              updateSetting('masterVolume', next);
            }
          });
        }
        return;
      }

      const systemAction = (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as ExtendedSystemAction[]).find(
        (action) => action !== 'midiShift' && settings.systemMappings[action]?.midiCC === message.cc
      );
      if (systemAction && handleSystemAction(systemAction)) {
        return;
      }

      const midiShiftActive = midiShiftActiveRef.current;
      const targetBankId = isDualMode ? (midiShiftActive ? secondaryBankId : primaryBankId) : currentBankId;
      const secondaryTargetId = isDualMode ? (midiShiftActive ? primaryBankId : secondaryBankId) : null;

      const bankMapping = midiBankCCMap.get(message.cc);
      if (bankMapping) {
        if (settings.editMode) {
          requestEditBank(bankMapping.bankId);
        } else {
          handleBankShortcut(bankMapping.bankId);
        }
        return;
      }

      const mapped =
        (targetBankId ? resolvePad(midiCCByBank.get(targetBankId)?.get(message.cc)) : null) ||
        (secondaryTargetId ? resolvePad(midiCCByBank.get(secondaryTargetId)?.get(message.cc)) : null);
      if (!mapped) return;

      const debounceKey = `${mapped.pad.id}-cc-${message.cc}`;
      const now = Date.now();
      const last = midiDebounceRef.current.get(debounceKey) || 0;
      if (now - last < 120) return;
      midiDebounceRef.current.set(debounceKey, now);

      if (settings.editMode) {
        requestEditPad(mapped.pad.id);
        return;
      }

      switch (mapped.pad.triggerMode) {
        case 'toggle':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerToggle(mapped.pad.id)
          );
          break;
        case 'hold':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerHoldStart(mapped.pad.id)
          );
          break;
        case 'stutter':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerStutter(mapped.pad.id)
          );
          break;
        case 'unmute':
        default:
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerUnmuteToggle(mapped.pad.id)
          );
          break;
      }
    }
  }, [
    midiNoteByBank,
    midiCCByBank,
    midiBankNoteMap,
    midiBankCCMap,
    playbackManager,
    ensureRegisteredAndTrigger,
    setCurrentBank,
    setSecondaryBank,
    settings.systemMappings,
    settings.masterVolume,
    settings.mixerOpen,
    settings.sideMenuOpen,
    armedLoadChannelId,
    updateSetting,
    handleStopAll,
    handleMixerToggle,
    handleCancelChannelLoadFromHeader,
    handleToggleMute,
    handleSideMenuToggle,
    handlePadSizeIncrease,
    handlePadSizeDecrease,
    handleCycleBank,
    currentBankId,
    primaryBankId,
    secondaryBankId,
    isDualMode,
    banks,
    isDualMode,
    handleBankShortcut,
    primaryBankId,
    secondaryBankId,
    normalizeMidiValue,
    handleStopChannel,
    requestEditPad,
    requestEditBank
  ]);

  React.useEffect(() => {
    const onMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;
      handleMidiMessage(detail);
    };

    window.addEventListener('vdjv-midi', onMidiEvent as EventListener);
    return () => {
      window.removeEventListener('vdjv-midi', onMidiEvent as EventListener);
    };
  }, [handleMidiMessage]);

  // Enhanced pad transfer handler with better dual mode support
  const commitTransferPad = React.useCallback((padId: string, sourceBankId: string, targetBankId: string) => {

    // Don't transfer to the same bank
    if (sourceBankId === targetBankId) {
      return;
    }

    const sourceBank = banks.find(b => b.id === sourceBankId);
    const targetBank = banks.find(b => b.id === targetBankId);

    if (!sourceBank || !targetBank) {
      return;
    }

    const padToTransfer = sourceBank.pads.find(p => p.id === padId);
    if (!padToTransfer) {
      return;
    }

    // Additional validation for dual mode transfers
    if (isDualMode) {
      const isPrimaryToSecondary = sourceBankId === primaryBankId && targetBankId === secondaryBankId;
      const isSecondaryToPrimary = sourceBankId === secondaryBankId && targetBankId === primaryBankId;

      if (isPrimaryToSecondary) {
      } else if (isSecondaryToPrimary) {
      } else {
      }
    }

    try {
      transferPad(padId, sourceBankId, targetBankId);
    } catch (error) {
      setError('Failed to transfer pad. Please try again.');
      setShowErrorDialog(true);
    }
  }, [banks, transferPad, isDualMode, primaryBankId, secondaryBankId, currentBankId]);

  const handleTransferPad = React.useCallback((padId: string, sourceBankId: string, targetBankId: string) => {
    if (sourceBankId === targetBankId) {
      return;
    }

    const sourceBank = banks.find((bank) => bank.id === sourceBankId);
    const targetBank = banks.find((bank) => bank.id === targetBankId);
    const sourcePad = sourceBank?.pads.find((pad) => pad.id === padId);

    if (!sourceBank || !targetBank || !sourcePad) {
      return;
    }

    if (
      isOfficialPadContent(sourcePad) &&
      !targetBank.containsOfficialContent &&
      !targetBank.officialTransferAcknowledged
    ) {
      setPendingOfficialPadTransferConfirm({
        padId,
        sourceBankId,
        targetBankId,
        padName: sourcePad.name || 'this pad',
        targetBankName: targetBank.name || 'this bank',
      });
      return;
    }

    commitTransferPad(padId, sourceBankId, targetBankId);
  }, [banks, commitTransferPad]);

  // Enhanced drag start handler with better logging
  const handlePadDragStart = React.useCallback((e: React.DragEvent, pad: PadData, sourceBankId: string) => {
    if (!settings.editMode) {
      e.preventDefault();
      return;
    }

    // Set drag data with comprehensive information
    const transferData = {
      type: 'pad-transfer',
      pad: pad,
      sourceBankId: sourceBankId,
      isDualMode: isDualMode,
      primaryBankId: primaryBankId,
      secondaryBankId: secondaryBankId
    };

    e.dataTransfer.setData('application/json', JSON.stringify(transferData));
    e.dataTransfer.setData('text/plain', JSON.stringify(transferData)); // Fallback
    e.dataTransfer.effectAllowed = 'move';
  }, [settings.editMode, isDualMode, primaryBankId, secondaryBankId]);

  const usePortraitDualStack = React.useMemo(() => {
    return isDualMode && isPhonePortraitScreen;
  }, [isDualMode, isPhonePortraitScreen]);

  const getGridColumns = React.useMemo(() => {
    const finalSize = normalizePadSize(displayPadSize, PAD_SIZE_MIN, activePadSizeMax, DEFAULT_PAD_SIZE);
    if (isDualMode && !isPortraitViewport) {
      return Math.max(1, Math.floor(finalSize / 2));
    }
    return finalSize;
  }, [activePadSizeMax, displayPadSize, isDualMode, isPortraitViewport]);

  // Overlay mode keeps width stable to minimize reflow.
  // Reflow mode shifts content on desktop only.
  const getMainContentMargin = React.useMemo(() => {
    if (isPortraitOrSmallScreen || settings.sidePanelMode === 'overlay') return 'mx-0';
    if (settings.sideMenuOpen && !settings.mixerOpen) return 'ml-64';
    if (!settings.sideMenuOpen && settings.mixerOpen) return 'mr-[24rem]';
    if (settings.sideMenuOpen && settings.mixerOpen) return 'ml-64 mr-[24rem]';
    return 'mx-0';
  }, [isPortraitOrSmallScreen, settings.sidePanelMode, settings.sideMenuOpen, settings.mixerOpen]);

  const getMainContentPadding = React.useMemo(() => {
    const isMobile = windowWidth < 768;
    return isMobile ? 'px-1' : 'px-2';
  }, [windowWidth]);

  const handleErrorClose = () => {
    setShowErrorDialog(false);
    setError(null);
  };

  const handleRestoreBackupPrompt = React.useCallback(() => {
    restoreBackupInputRef.current?.click();
  }, []);

  const handleRestoreFromBackupForRemoteSnapshot = React.useCallback(() => {
    setRemoteSnapshotPrompt(null);
    handleRestoreBackupPrompt();
  }, [handleRestoreBackupPrompt]);

  const handleRecoverBankPrompt = React.useCallback(() => {
    setShowRecoverBankModeDialog(true);
  }, []);

  const handleChooseRecoverBankMode = React.useCallback((addAsNewWhenNoTarget: boolean) => {
    setPendingRecoverAddAsNew(addAsNewWhenNoTarget);
    setShowRecoverBankModeDialog(false);
    window.setTimeout(() => {
      recoverBankInputRef.current?.click();
    }, 0);
  }, []);

  const handleRestoreBackupFile = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const message = await handleRestoreAppBackup(file);
      setMissingMediaSummary(null);
      setError(message);
      setShowErrorDialog(true);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Backup restore failed.');
      setShowErrorDialog(true);
    }
  }, [handleRestoreAppBackup]);

  const handleRecoverBankFiles = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    try {
      const message = await handleRecoverMissingMediaFromBanks(files, {
        addAsNewWhenNoTarget: pendingRecoverAddAsNew,
      });
      setMissingMediaSummary(null);
      setError(message);
      setShowErrorDialog(true);
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : 'Recovery import failed.');
      setShowErrorDialog(true);
    } finally {
      setPendingRecoverAddAsNew(false);
    }
  }, [handleRecoverMissingMediaFromBanks, pendingRecoverAddAsNew]);

  // Get all pads from all banks for cross-bank controls
  const allPads = React.useMemo(() => {
    return banks.flatMap(bank => bank.pads);
  }, [banks]);

  // Create available banks list for pad transfer
  const availableBanks = React.useMemo(() => {
    return banks.map(bank => ({ id: bank.id, name: bank.name }));
  }, [banks]);

  // Get the banks to display based on current mode
  const getDisplayBanks = () => {
    if (isDualMode) {
      return {
        primaryBank,
        secondaryBank
      };
    } else {
      return {
        singleBank: currentBank
      };
    }
  };

  const { primaryBank: displayPrimary, secondaryBank: displaySecondary, singleBank } = getDisplayBanks();

  const layoutSafeAreaClass = isNativeAndroid() ? 'vdjv-safe-area-vertical' : 'vdjv-safe-area';
  const layoutSizeClass = `h-[100dvh] box-border overflow-hidden ${layoutSafeAreaClass}`;
  const shouldLockPadInteractionForMixer = settings.mixerOpen && isPortraitOrSmallScreen;
  const padInteractionLockClass = shouldLockPadInteractionForMixer ? 'pointer-events-none touch-none select-none' : '';

  const sideMenuProps = {
    open: settings.sideMenuOpen,
    onOpenChange: handleSideMenuToggle,
    banks,
    primaryBankId,
    secondaryBankId,
    currentBankId,
    isDualMode,
    theme,
    editMode: settings.editMode,
    onCreateBank: createBank,
    onSetPrimaryBank: setPrimaryBank,
    onSetSecondaryBank: setSecondaryBank,
    onSetCurrentBank: setCurrentBank,
    onUpdateBank: updateBank,
    onUpdatePad: handleUpdatePad,
    onDeleteBank: handleDeleteBank,
    onDuplicateBank: duplicateBank,
    onImportBank: importBank,
    onExportBank: exportBank,
    onMoveBankUp: moveBankUp,
    onMoveBankDown: moveBankDown,
    onTransferPad: handleTransferPad,
    canTransferFromBank,
    onExportAdmin: canUseAdminExport ? exportAdminBank : undefined,
    midiEnabled: midi.enabled && midi.accessGranted,
    blockedShortcutKeys,
    blockedMidiNotes,
    blockedMidiCCs,
    editBankRequest,
    hideShortcutLabels: settings.hideShortcutLabels,
    graphicsTier: effectiveGraphicsTier,
    onRequestRestoreBackup: handleRestoreBackupPrompt,
    onRequestRecoverBankFiles: handleRecoverBankPrompt,
    onRetryBankMissingMedia: rehydrateMissingMediaInBank,
  };

  const volumeMixerProps = {
    open: settings.mixerOpen,
    onOpenChange: handleMixerToggle,
    channelStates,
    channelCount: settings.channelCount,
    legacyPlayingPads,
    masterVolume: settings.masterVolume,
    onMasterVolumeChange: (volume: number) => updateSetting('masterVolume', volume),
    onPadVolumeChange: handlePadVolumeChange,
    onStopPad: handleStopSpecificPad,
    onChannelVolumeChange: handleChannelVolumeChange,
    onStopChannel: handleStopChannel,
    onPlayChannel: handlePlayChannel,
    onPauseChannel: handlePauseChannel,
    onSeekChannel: handleSeekChannel,
    onUnloadChannel: handleUnloadChannel,
    onArmChannelLoad: handleArmChannelLoad,
    onCancelChannelLoad: handleCancelChannelLoad,
    armedLoadChannelId,
    onSetChannelHotcue: handleSetChannelHotcue,
    onTriggerChannelHotcue: handleTriggerChannelHotcue,
    onSetChannelCollapsed: handleSetChannelCollapsed,
    stopMode: settings.stopMode,
    editMode: settings.editMode,
    theme,
    windowWidth,
    graphicsTier: effectiveGraphicsTier
  };

  const headerControlsProps = {
    primaryBank: displayPrimary,
    secondaryBank: displaySecondary,
    currentBank: singleBank,
    isDualMode,
    padSize: displayPadSize,
    stopMode: settings.stopMode,
    editMode: settings.editMode,
    globalMuted,
    sideMenuOpen: settings.sideMenuOpen,
    mixerOpen: settings.mixerOpen,
    channelLoadArmed: armedLoadChannelId !== null,
    theme,
    windowWidth,
    onFileUpload: handleFileUpload,
    onToggleEditMode: () => {
      if (armedLoadChannelId !== null) {
        setArmedLoadChannelId(null);
      }
      updateSetting('editMode', !settings.editMode);
    },
    onToggleMute: handleToggleMute,
    onStopAll: handleStopAll,
    onToggleSideMenu: () => handleSideMenuToggle(!settings.sideMenuOpen),
    onToggleMixer: () => handleMixerToggle(!settings.mixerOpen),
    onCancelChannelLoad: handleCancelChannelLoadFromHeader,
    onToggleTheme: toggleTheme,
    onExitDualMode: () => setPrimaryBank(null),
    onPadSizeChange: handlePadSizeChange,
    onStopModeChange: (mode: typeof settings.stopMode) => updateSetting('stopMode', mode),
    defaultTriggerMode: settings.defaultTriggerMode,
    onDefaultTriggerModeChange: (mode: typeof settings.defaultTriggerMode) => updateSetting('defaultTriggerMode', mode),
    graphicsProfile: settings.graphicsProfile,
    effectiveGraphicsTierLabel,
    onGraphicsProfileChange: (profile: typeof settings.graphicsProfile) => updateSetting('graphicsProfile', profile),
    midiSupported: midi.supported,
    midiEnabled: midi.enabled,
    midiAccessGranted: midi.enabled && midi.accessGranted,
    midiBackend: midi.backend,
    midiOutputSupported: midi.outputSupported,
    midiInputs: midi.inputs,
    midiSelectedInputId: midi.selectedInputId,
    midiError: midi.error,
    onRequestMidiAccess: midi.requestAccess,
    onSelectMidiInput: midi.setSelectedInputId,
    onToggleMidiEnabled: handleToggleMidiEnabled,
    systemMappings: settings.systemMappings,
    onUpdateSystemKey: updateSystemKey,
    onResetSystemKey: resetSystemMapping,
    onUpdateSystemMidi: updateSystemMidi,
    onUpdateSystemColor: updateSystemColor,
    onSetMasterVolumeCC: setMasterVolumeCC,
    channelCount: settings.channelCount,
    onChangeChannelCount: handleChannelCountChange,
    onUpdateChannelMapping: updateChannelMapping,
    padBankShortcutKeys,
    padBankMidiNotes,
    padBankMidiCCs,
    midiNoteAssignments,
    hideShortcutLabels: settings.hideShortcutLabels,
    onToggleHideShortcutLabels: handleToggleHideShortcutLabels,
    autoPadBankMapping: settings.autoPadBankMapping,
    onToggleAutoPadBankMapping: (enabled: boolean) => updateSetting('autoPadBankMapping', enabled),
    sidePanelMode: settings.sidePanelMode,
    onChangeSidePanelMode: (mode: typeof settings.sidePanelMode) => updateSetting('sidePanelMode', mode),
    onResetAllSystemMappings: handleResetAllSystemMappings,
    onClearAllSystemMappings: handleClearAllSystemMappings,
    onResetAllChannelMappings: handleResetAllChannelMappings,
    onClearAllChannelMappings: handleClearAllChannelMappings,
    onExportMappings: handleExportMappings,
    onImportMappings: handleImportMappings,
    onImportSharedBank: handleImportSharedBank,
    onExportAppBackup: handleExportAppBackup,
    onRestoreAppBackup: handleRestoreAppBackup,
    onRetryMissingMediaInCurrentBank: handleRetryMissingMediaInCurrentBank,
    onRecoverMissingMediaFromBanks: handleRecoverMissingMediaFromBanks,
    midiDeviceProfiles: midiDeviceProfilesState,
    midiDeviceProfileId: settings.midiDeviceProfileId,
    onSelectMidiDeviceProfile: (id: string | null) => updateSetting('midiDeviceProfileId', id),
    defaultBankSourceOptions: banks
      .filter((bank) => Array.isArray(bank.pads) && bank.pads.length > 0)
      .map((bank) => ({
        id: bank.id,
        title: bank.name,
        padCount: bank.pads.length,
        isDefaultBank: bank.sourceBankId === DEFAULT_BANK_SOURCE_ID || bank.name === 'Default Bank',
      })),
    onPublishDefaultBankRelease: publishDefaultBankRelease
  };

  return (
    <SamplerPadAppView
      layoutSizeClass={layoutSizeClass}
      theme={theme}
      sideMenuProps={sideMenuProps}
      headerControlsProps={headerControlsProps}
      volumeMixerProps={volumeMixerProps}
      showVolumeMixer={true}
      isIOSClient={isIOSClient}
      audioRecoveryState={audioRecoveryState}
      onRestoreAudio={handleRestoreAudio}
      getMainContentMargin={getMainContentMargin}
      getMainContentPadding={getMainContentPadding}
      usePortraitDualStack={usePortraitDualStack}
      padInteractionLockClass={padInteractionLockClass}
      isDualMode={isDualMode}
      displayPrimary={displayPrimary}
      displaySecondary={displaySecondary}
      singleBank={singleBank}
      primaryBankId={primaryBankId}
      secondaryBankId={secondaryBankId}
      currentBankId={currentBankId}
      primaryScrollRef={primaryScrollRef}
      secondaryScrollRef={secondaryScrollRef}
      singleScrollRef={singleScrollRef}
      primaryFallbackScrollRef={primaryFallbackScrollRef}
      secondaryFallbackScrollRef={secondaryFallbackScrollRef}
      singleFallbackScrollRef={singleFallbackScrollRef}
      saveBankScroll={saveBankScroll}
      allPads={allPads}
      banks={banks}
      availableBanks={availableBanks}
      editMode={settings.editMode}
      globalMuted={globalMuted}
      masterVolume={settings.masterVolume}
      padSize={getGridColumns}
      stopMode={settings.stopMode}
      windowWidth={windowWidth}
      onUpdatePad={handleUpdatePad}
      onRemovePad={handleRemovePad}
      onDuplicatePad={handleDuplicatePad}
      onRelinkMissingPadMedia={relinkPadAudioFromFile}
      onRehydratePadMedia={rehydratePadMedia}
      onReorderPads={reorderPads}
      onFileUpload={handleFileUpload}
      onPadDragStart={handlePadDragStart}
      onTransferPad={handleTransferPad}
      canTransferFromBank={canTransferFromBank}
      midiEnabled={midi.enabled && midi.accessGranted}
      hideShortcutLabels={settings.hideShortcutLabels}
      graphicsTier={effectiveGraphicsTier}
      editRequest={editRequest}
      blockedShortcutKeys={blockedShortcutKeys}
      blockedMidiNotes={blockedMidiNotes}
      blockedMidiCCs={blockedMidiCCs}
      channelLoadArmed={armedLoadChannelId !== null}
      onSelectPadForChannelLoad={handleSelectPadForChannelLoad}
      hasEffectiveAuthUser={Boolean(effectiveAuthUser)}
      defaultBankSourceId={DEFAULT_BANK_SOURCE_ID}
      onRequireLogin={requestDefaultBankLogin}
      restoreBackupInputRef={restoreBackupInputRef}
      recoverBankInputRef={recoverBankInputRef}
      onRestoreBackupFile={handleRestoreBackupFile}
      onRecoverBankFiles={handleRecoverBankFiles}
      remoteSnapshotPrompt={remoteSnapshotPrompt}
      onRemoteSnapshotPromptChange={setRemoteSnapshotPrompt}
      onApplyRemoteSnapshot={handleApplyRemoteSnapshot}
      onRestoreFromBackupForRemoteSnapshot={handleRestoreFromBackupForRemoteSnapshot}
      missingMediaSummary={missingMediaSummary}
      onMissingMediaSummaryChange={setMissingMediaSummary}
      onRestoreBackupPrompt={handleRestoreBackupPrompt}
      onRecoverBankPrompt={handleRecoverBankPrompt}
      showRecoverBankModeDialog={showRecoverBankModeDialog}
      onShowRecoverBankModeDialogChange={setShowRecoverBankModeDialog}
      onChooseRecoverBankMode={handleChooseRecoverBankMode}
      pendingChannelLoadConfirm={pendingChannelLoadConfirm}
      onPendingChannelLoadConfirmChange={setPendingChannelLoadConfirm}
      onConfirmChannelLoad={(pending) => {
        void executePadLoadToChannel(pending.channelId, pending.pad, pending.bankId, pending.bankName);
      }}
      pendingChannelCountConfirm={pendingChannelCountConfirm}
      onPendingChannelCountConfirmChange={setPendingChannelCountConfirm}
      onConfirmChannelCountChange={applyChannelCountChange}
      pendingOfficialPadTransferConfirm={pendingOfficialPadTransferConfirm}
      onPendingOfficialPadTransferConfirmChange={setPendingOfficialPadTransferConfirm}
      onConfirmOfficialPadTransfer={(pending) => {
        commitTransferPad(pending.padId, pending.sourceBankId, pending.targetBankId);
      }}
      showErrorDialog={showErrorDialog}
      onShowErrorDialogChange={setShowErrorDialog}
      error={error}
      onErrorClose={handleErrorClose}
    />
  );

}

