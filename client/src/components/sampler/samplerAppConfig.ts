import type { GraphicsProfile } from '@/lib/performance-monitor';
import type { SystemAction } from '@/lib/system-mappings';
import type { StopMode } from './types/sampler';
import { normalizePadPlaybackModeValue, normalizePadTriggerModeValue, normalizeTempoPercentValue } from './hooks/audioPadNormalization';

export type SamplerShortcutAction = SystemAction;

export interface SamplerAppConfig {
  uiDefaults: {
    defaultPadSizePortrait: number;
    defaultPadSizeLandscape: number;
    defaultChannelCountMobile: number;
    defaultChannelCountDesktop: number;
    defaultMasterVolume: number;
    defaultStopMode: StopMode;
    defaultSidePanelMode: 'overlay' | 'reflow';
    defaultHideShortcutLabels: boolean;
    defaultAutoPadBankMapping: boolean;
    defaultGraphicsProfile: GraphicsProfile;
  };
  bankDefaults: {
    defaultBankName: string;
    defaultBankColor: string;
  };
  padDefaults: {
    defaultTriggerMode: 'toggle' | 'hold' | 'stutter' | 'unmute';
    defaultPlaybackMode: 'once' | 'loop' | 'stopper';
    defaultVolume: number;
    defaultGainDb: number;
    defaultFadeInMs: number;
    defaultFadeOutMs: number;
    defaultPitch: number;
    defaultTempoPercent: number;
    defaultKeyLock: boolean;
  };
  quotaDefaults: {
    ownedBankQuota: number;
    ownedBankPadCap: number;
    deviceTotalBankCap: number;
  };
  audioLimits: {
    maxPadAudioBytes: number;
    maxPadAudioDurationMs: number;
  };
  shortcutDefaults: Record<SamplerShortcutAction, string>;
}

const DEFAULT_SHORTCUTS: Record<SamplerShortcutAction, string> = {
  stopAll: 'Space',
  mixer: 'M',
  editMode: 'Z',
  mute: 'X',
  banksMenu: 'B',
  nextBank: '[',
  prevBank: ']',
  upload: 'N',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  padSizeUp: '=',
  padSizeDown: '-',
  importBank: 'V',
  activateSecondary: 'C',
  midiShift: '',
};

export const DEFAULT_SAMPLER_APP_CONFIG: SamplerAppConfig = {
  uiDefaults: {
    defaultPadSizePortrait: 5,
    defaultPadSizeLandscape: 10,
    defaultChannelCountMobile: 2,
    defaultChannelCountDesktop: 4,
    defaultMasterVolume: 1,
    defaultStopMode: 'instant',
    defaultSidePanelMode: 'overlay',
    defaultHideShortcutLabels: true,
    defaultAutoPadBankMapping: true,
    defaultGraphicsProfile: 'auto',
  },
  bankDefaults: {
    defaultBankName: 'Default Bank',
    defaultBankColor: '#3b82f6',
  },
  padDefaults: {
    defaultTriggerMode: 'toggle',
    defaultPlaybackMode: 'once',
    defaultVolume: 1,
    defaultGainDb: 0,
    defaultFadeInMs: 0,
    defaultFadeOutMs: 0,
    defaultPitch: 0,
    defaultTempoPercent: 0,
    defaultKeyLock: true,
  },
  quotaDefaults: {
    ownedBankQuota: 6,
    ownedBankPadCap: 64,
    deviceTotalBankCap: 120,
  },
  audioLimits: {
    maxPadAudioBytes: 52_428_800,
    maxPadAudioDurationMs: 1_200_000,
  },
  shortcutDefaults: DEFAULT_SHORTCUTS,
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const clampFloat = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const normalizeHexColor = (value: unknown, fallback: string): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  const normalized = text.startsWith('#') ? text : `#${text}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return fallback;
  return normalized.toLowerCase();
};

const normalizeGraphicsProfile = (value: unknown): GraphicsProfile => (
  value === 'lowest' || value === 'low' || value === 'medium' || value === 'high'
    ? value
    : 'auto'
);

const normalizeStopMode = (value: unknown): StopMode => (
  value === 'fadeout' || value === 'brake' || value === 'backspin' || value === 'filter'
    ? value
    : 'instant'
);

const normalizeShortcutDefaults = (value: unknown): Record<SamplerShortcutAction, string> => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const next = { ...DEFAULT_SHORTCUTS };
  (Object.keys(DEFAULT_SHORTCUTS) as SamplerShortcutAction[]).forEach((action) => {
    const parsed = typeof raw[action] === 'string' ? raw[action].trim().slice(0, 40) : '';
    next[action] = parsed || DEFAULT_SHORTCUTS[action];
  });
  return next;
};

export const normalizeSamplerAppConfig = (value: unknown): SamplerAppConfig => {
  const raw = value && typeof value === 'object' ? value as Record<string, any> : {};
  const uiRaw = raw.uiDefaults || raw.ui_defaults || {};
  const bankRaw = raw.bankDefaults || raw.bank_defaults || {};
  const padRaw = raw.padDefaults || raw.pad_defaults || {};
  const quotaRaw = raw.quotaDefaults || raw.quota_defaults || {};
  const limitsRaw = raw.audioLimits || raw.audio_limits || {};

  return {
    uiDefaults: {
      defaultPadSizePortrait: clampInt(uiRaw.defaultPadSizePortrait, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultPadSizePortrait, 2, 8),
      defaultPadSizeLandscape: clampInt(uiRaw.defaultPadSizeLandscape, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultPadSizeLandscape, 2, 16),
      defaultChannelCountMobile: clampInt(uiRaw.defaultChannelCountMobile, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultChannelCountMobile, 2, 8),
      defaultChannelCountDesktop: clampInt(uiRaw.defaultChannelCountDesktop, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultChannelCountDesktop, 2, 8),
      defaultMasterVolume: clampFloat(uiRaw.defaultMasterVolume, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultMasterVolume, 0, 1),
      defaultStopMode: normalizeStopMode(uiRaw.defaultStopMode),
      defaultSidePanelMode: uiRaw.defaultSidePanelMode === 'reflow' ? 'reflow' : 'overlay',
      defaultHideShortcutLabels: normalizeBoolean(uiRaw.defaultHideShortcutLabels, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultHideShortcutLabels),
      defaultAutoPadBankMapping: normalizeBoolean(uiRaw.defaultAutoPadBankMapping, DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultAutoPadBankMapping),
      defaultGraphicsProfile: normalizeGraphicsProfile(uiRaw.defaultGraphicsProfile),
    },
    bankDefaults: {
      defaultBankName: (typeof bankRaw.defaultBankName === 'string' ? bankRaw.defaultBankName.trim().slice(0, 80) : '') || DEFAULT_SAMPLER_APP_CONFIG.bankDefaults.defaultBankName,
      defaultBankColor: normalizeHexColor(bankRaw.defaultBankColor, DEFAULT_SAMPLER_APP_CONFIG.bankDefaults.defaultBankColor),
    },
    padDefaults: {
      defaultTriggerMode: normalizePadTriggerModeValue(padRaw.defaultTriggerMode),
      defaultPlaybackMode: normalizePadPlaybackModeValue(padRaw.defaultPlaybackMode),
      defaultVolume: clampFloat(padRaw.defaultVolume, DEFAULT_SAMPLER_APP_CONFIG.padDefaults.defaultVolume, 0, 1),
      defaultGainDb: clampFloat(padRaw.defaultGainDb, DEFAULT_SAMPLER_APP_CONFIG.padDefaults.defaultGainDb, -24, 24),
      defaultFadeInMs: clampInt(padRaw.defaultFadeInMs, DEFAULT_SAMPLER_APP_CONFIG.padDefaults.defaultFadeInMs, 0, 60_000),
      defaultFadeOutMs: clampInt(padRaw.defaultFadeOutMs, DEFAULT_SAMPLER_APP_CONFIG.padDefaults.defaultFadeOutMs, 0, 60_000),
      defaultPitch: clampInt(padRaw.defaultPitch, DEFAULT_SAMPLER_APP_CONFIG.padDefaults.defaultPitch, -12, 12),
      defaultTempoPercent: normalizeTempoPercentValue(padRaw.defaultTempoPercent),
      defaultKeyLock: normalizeBoolean(padRaw.defaultKeyLock, DEFAULT_SAMPLER_APP_CONFIG.padDefaults.defaultKeyLock),
    },
    quotaDefaults: {
      ownedBankQuota: clampInt(quotaRaw.ownedBankQuota, DEFAULT_SAMPLER_APP_CONFIG.quotaDefaults.ownedBankQuota, 1, 500),
      ownedBankPadCap: clampInt(quotaRaw.ownedBankPadCap, DEFAULT_SAMPLER_APP_CONFIG.quotaDefaults.ownedBankPadCap, 1, 256),
      deviceTotalBankCap: clampInt(quotaRaw.deviceTotalBankCap, DEFAULT_SAMPLER_APP_CONFIG.quotaDefaults.deviceTotalBankCap, 10, 1000),
    },
    audioLimits: {
      maxPadAudioBytes: clampInt(limitsRaw.maxPadAudioBytes, DEFAULT_SAMPLER_APP_CONFIG.audioLimits.maxPadAudioBytes, 1_000_000, 524_288_000),
      maxPadAudioDurationMs: clampInt(limitsRaw.maxPadAudioDurationMs, DEFAULT_SAMPLER_APP_CONFIG.audioLimits.maxPadAudioDurationMs, 10_000, 7_200_000),
    },
    shortcutDefaults: normalizeShortcutDefaults(raw.shortcutDefaults || raw.shortcut_defaults),
  };
};

export const isMobileDefaultChannelContext = (): boolean => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
  const isElectron = /Electron/i.test(ua) || Boolean((window as Window & { process?: { versions?: { electron?: string } } }).process?.versions?.electron);
  return isMobileUA && !isElectron;
};

export const resolveConfiguredInitialChannelCount = (config: SamplerAppConfig): number => (
  isMobileDefaultChannelContext()
    ? config.uiDefaults.defaultChannelCountMobile
    : config.uiDefaults.defaultChannelCountDesktop
);
