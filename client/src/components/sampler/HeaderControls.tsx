import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Menu, Pencil, Volume2, VolumeX, Square, Sliders, Shield, LogIn, X, Search, Palette, Undo2, ArrowUpCircle } from 'lucide-react';
import type { SamplerBank, StopMode } from './types/sampler';
import { createPortal, flushSync } from 'react-dom';
import { getCachedUser, useAuthActions, useAuthState } from '@/hooks/useAuth';
import type { SystemAction, SystemMappings } from '@/lib/system-mappings';
import {
  applyStopTimingOverrides,
  getStopModeDurationMs,
  getStopTimingProfile,
  type StopTimingOverridesMs,
} from '@/lib/audio-engine';
import type { MidiDeviceProfile } from '@/lib/midi/device-profiles';
import type { GraphicsProfile } from '@/lib/performance-monitor';
import type { DefaultBankSourceOption } from './AdminAccessDialog.shared';
import type { LoginModal as LoginModalType } from '@/components/auth/LoginModal';
import type { AppSettingsDialog as AppSettingsDialogType } from '@/components/ui/AppSettingsDialog';
import type { HeaderAdminDebugPanel as HeaderAdminDebugPanelType } from './HeaderAdminDebugPanel';
import type { AccountUpgradeDialog as AccountUpgradeDialogType } from './AccountUpgradeDialog';
import { EXTRA_PAD_COLORS, PRIMARY_PAD_COLORS, getPadColorOptionLabel } from './padColorPalette';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { useStorePreviewBadge } from './hooks/useStorePreviewBadge';
import { AUDIO_FILE_INPUT_ACCEPT } from '@/lib/audio-file-accept';
import { cn } from '@/lib/utils';

const LoginModal = React.lazy(() => import('@/components/auth/LoginModal').then((module) => ({ default: module.LoginModal }))) as unknown as typeof LoginModalType;
const AppSettingsDialog = React.lazy(() => import('@/components/ui/AppSettingsDialog').then((module) => ({ default: module.AppSettingsDialog }))) as unknown as typeof AppSettingsDialogType;
const HeaderAdminDebugPanel = React.lazy(() => import('./HeaderAdminDebugPanel').then((module) => ({ default: module.HeaderAdminDebugPanel }))) as unknown as typeof HeaderAdminDebugPanelType;
const AccountUpgradeDialog = React.lazy(() => import('./AccountUpgradeDialog').then((module) => ({ default: module.AccountUpgradeDialog }))) as unknown as typeof AccountUpgradeDialogType;

type StopAnimationState = {
  key: number;
  durationMs: number;
};

type StopModePickerState = {
  open: boolean;
  center: { x: number; y: number };
  activeMode: StopMode | null;
  isCompact: boolean;
};

type StopGestureState = {
  pointerId: number;
  holdOpened: boolean;
  suppressClick: boolean;
  isCompact: boolean;
  center: { x: number; y: number };
};

const STOP_MODE_HOLD_MS = 360;
const STOP_MODE_RADIAL_OPTIONS: Array<{
  mode: StopMode;
  label: string;
  shortLabel: string;
  angleDeg: number;
}> = [
  { mode: 'instant', label: 'Instant Stop', shortLabel: 'Instant', angleDeg: 200 },
  { mode: 'fadeout', label: 'Fade Out', shortLabel: 'Fade', angleDeg: 235 },
  { mode: 'brake', label: 'Brake', shortLabel: 'Brake', angleDeg: 270 },
  { mode: 'backspin', label: 'BrakeSpin', shortLabel: 'Spin', angleDeg: 305 },
  { mode: 'filter', label: 'FilterSweep', shortLabel: 'Filter', angleDeg: 340 },
];

const normalizeHexColor = (value?: string | null): string | null => {
  if (!value) return null;
  const body = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return null;
  return `#${body.toLowerCase()}`;
};

const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace(/^#/, '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getReadableTextColor = (hex: string): string => {
  const normalized = hex.replace(/^#/, '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58 ? '#0f172a' : '#ffffff';
};

const getStopModeLabel = (mode: StopMode): string => (
  STOP_MODE_RADIAL_OPTIONS.find((option) => option.mode === mode)?.label || 'Instant Stop'
);

const getStopModePickerGeometry = (
  mode: StopMode,
  center: { x: number; y: number },
  isCompact: boolean,
) => {
  const option = STOP_MODE_RADIAL_OPTIONS.find((item) => item.mode === mode) || STOP_MODE_RADIAL_OPTIONS[0];
  const index = Math.max(0, STOP_MODE_RADIAL_OPTIONS.findIndex((item) => item.mode === option.mode));
  if (!isCompact) {
    return {
      x: center.x,
      y: center.y - 242 + index * 54,
    };
  }
  const radius = isCompact ? 118 : 132;
  const radians = (option.angleDeg * Math.PI) / 180;
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };
};

const getStopModeFromPointer = (
  clientX: number,
  clientY: number,
  center: { x: number; y: number },
  isCompact: boolean,
): StopMode | null => {
  const dx = clientX - center.x;
  const dy = clientY - center.y;
  const radialDistance = Math.hypot(dx, dy);
  if (dy > 42 || radialDistance < 48) return null;

  let nearest: { mode: StopMode; distance: number } | null = null;
  STOP_MODE_RADIAL_OPTIONS.forEach((option) => {
    const point = getStopModePickerGeometry(option.mode, center, isCompact);
    const distance = Math.hypot(clientX - point.x, clientY - point.y);
    if (!nearest || distance < nearest.distance) {
      nearest = { mode: option.mode, distance };
    }
  });

  const maxDistance = isCompact ? 76 : 84;
  if (!isCompact) {
    const inVerticalBand = Math.abs(clientX - center.x) <= 92
      && clientY <= center.y - 24
      && clientY >= center.y - 282;
    if (nearest && (nearest.distance <= maxDistance || inVerticalBand)) {
      return nearest.mode;
    }
    return null;
  }
  const broadArcDistance = isCompact ? 205 : 225;
  if (nearest && (nearest.distance <= maxDistance || (clientY < center.y + 10 && radialDistance <= broadArcDistance))) {
    return nearest.mode;
  }
  return null;
};


interface HeaderControlsProps {
  primaryBank: SamplerBank | null;
  secondaryBank: SamplerBank | null;
  currentBank: SamplerBank | null;
  isDualMode: boolean;
  padSize: number;
  stopMode: StopMode;
  stopTimingOverrides: StopTimingOverridesMs;
  editMode: boolean;
  globalMuted: boolean;
  sideMenuOpen: boolean;
  mixerOpen: boolean;
  hasActiveDeckPlayback: boolean;
  searchOpen: boolean;
  channelLoadArmed: boolean;
  adminPadColorPaintActive: boolean;
  adminPadColorPaintColor: string | null;
  adminPadColorPaintCanUndo: boolean;
  theme: 'light' | 'dark';
  windowWidth: number;
  onFileUpload: (file: File, targetBankId?: string) => void;
  onToggleEditMode: () => void;
  onToggleMute: () => void;
  onStopAll: () => void;
  onToggleSideMenu: () => void;
  onToggleMixer: () => void;
  onToggleSearch: () => void;
  onCancelChannelLoad: () => void;
  onStartAdminPadColorPaint: (color: string) => void;
  onStopAdminPadColorPaint: () => void;
  onUndoAdminPadColorPaint: () => void;
  onToggleTheme: () => void;
  onExitDualMode: () => void;
  onPadSizeChange: (size: number) => void;
  onStopModeChange: (mode: StopMode) => void;
  onStopTimingOverridesChange: (overrides: StopTimingOverridesMs) => void;
  defaultTriggerMode: SamplerBank['pads'][number]['triggerMode'];
  onDefaultTriggerModeChange: (mode: SamplerBank['pads'][number]['triggerMode']) => void;
  graphicsProfile: GraphicsProfile;
  effectiveGraphicsTierLabel: string;
  onGraphicsProfileChange: (profile: GraphicsProfile) => void;
  midiSupported: boolean;
  midiEnabled: boolean;
  midiAccessGranted: boolean;
  midiBackend: 'web' | 'native';
  midiOutputSupported: boolean;
  midiInputs: import('@/lib/midi').MidiInputInfo[];
  midiSelectedInputId: string | null;
  midiError: string | null;
  onRequestMidiAccess: () => void;
  onSelectMidiInput: (id: string | null) => void;
  onToggleMidiEnabled: (enabled: boolean) => void;
  systemMappings: SystemMappings;
  onUpdateSystemKey: (action: SystemAction, key: string) => void;
  onResetSystemKey: (action: SystemAction) => void;
  onUpdateSystemMidi: (action: SystemAction, midiNote?: number, midiCC?: number) => void;
  onUpdateSystemColor: (action: SystemAction, color?: string) => void;
  onSetMasterVolumeCC: (cc?: number) => void;
  channelCount: number;
  onChangeChannelCount: (count: number) => void;
  onUpdateChannelMapping: (channelIndex: number, updates: Partial<{ keyUp?: string; keyDown?: string; keyStop?: string; midiCC?: number; midiNote?: number }>) => void;
  padBankShortcutKeys: Set<string>;
  padBankMidiNotes: Set<number>;
  padBankMidiCCs: Set<number>;
  midiNoteAssignments: Array<{ note: number; type: 'pad' | 'bank'; bankName: string; padName?: string }>;
  keyboardMappingEnabled: boolean;
  onToggleKeyboardMappingEnabled: (enabled: boolean) => void;
  hideShortcutLabels: boolean;
  onToggleHideShortcutLabels: (hide: boolean) => void;
  autoPadBankMapping: boolean;
  onToggleAutoPadBankMapping: (enabled: boolean) => void;
  sidePanelMode: 'overlay' | 'reflow';
  onChangeSidePanelMode: (mode: 'overlay' | 'reflow') => void;
  onResetAllSystemMappings: () => void;
  onClearAllSystemMappings: () => void;
  onResetAllChannelMappings: () => void;
  onClearAllChannelMappings: () => void;
  midiDeviceProfiles: MidiDeviceProfile[];
  midiDeviceProfileId: string | null;
  onSelectMidiDeviceProfile: (id: string | null) => void;
  onExportMappings: () => Promise<string>;
  onImportMappings: (file: File) => Promise<string>;
  onImportSharedBank: (file: File) => Promise<string>;
  onExportAppBackup: (options?: { riskMode?: boolean }) => Promise<string>;
  onRestoreAppBackup: (file: File, companionFiles?: File[]) => Promise<string>;
  onRetryMissingMediaInCurrentBank: () => Promise<string>;
  onRecoverMissingMediaFromBanks: (
    files: File[],
    options?: { addAsNewWhenNoTarget?: boolean }
  ) => Promise<string>;
  guestPlaySummary?: {
    visible: boolean;
    mode: 'guest' | 'free';
    remainingCount: number;
    exhausted: boolean;
    resetLabel?: string | null;
  };
  freePlaySummary?: {
    visible: boolean;
    remainingCount: number;
    exhausted: boolean;
    resetLabel?: string | null;
  };
  defaultBankSourceOptions: DefaultBankSourceOption[];
  onPublishDefaultBankRelease: (
    bankId: string,
    options?: { releaseNotes?: string; minAppVersion?: string }
  ) => Promise<string>;
}

const LOGIN_GREETING_STORAGE_PREFIX = 'vdjv-login-greeting';
const OFFLINE_READY_INFO_STORAGE_PREFIX = 'vdjv-offline-ready-info';
const DISPLAY_NAME_PROMPT_SNOOZE_PREFIX = 'vdjv-display-name-prompt-snooze';
const DISPLAY_NAME_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000;

const getFallbackDisplayName = (email?: string | null): string => {
  const localPart = String(email || '').split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  return localPart || 'User';
};

const shouldPromptForDisplayName = (displayName: string | null | undefined, email?: string | null): boolean => {
  const normalized = String(displayName || '').trim();
  if (!normalized) return true;
  return normalized.localeCompare(getFallbackDisplayName(email), undefined, { sensitivity: 'accent' }) === 0;
};

// Slide-down notification UI used by the header.
type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string; closing?: boolean }
const MAX_ACTIVE_NOTICES = 2;
const NOTICE_EXIT_MS = 220;
const NOTICE_AUTO_DISMISS_MS = 4000;

const getLocalGreetingDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function useNotices() {
  const [notices, setNotices] = React.useState<Notice[]>([])
  const removalTimersRef = React.useRef<Record<string, number>>({})

  const clearRemovalTimer = React.useCallback((id: string) => {
    const timer = removalTimersRef.current[id]
    if (typeof timer !== 'number') return
    window.clearTimeout(timer)
    delete removalTimersRef.current[id]
  }, [])

  const removeNow = React.useCallback((id: string) => {
    clearRemovalTimer(id)
    setNotices((arr) => arr.filter((n) => n.id !== id))
  }, [clearRemovalTimer])

  const pushNotice = React.useCallback((n: Omit<Notice, 'id'>) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now() + Math.random())
    const notice: Notice = { id, ...n }
    setNotices((arr) => {
      const active = arr.filter((entry) => !entry.closing)
      const duplicate = active.some((entry) => entry.variant === notice.variant && entry.message === notice.message)
      if (duplicate) return arr

      let next = [...active, notice]
      if (next.length > MAX_ACTIVE_NOTICES) {
        const [oldest, ...rest] = next
        next = [{ ...oldest, closing: true }, ...rest]
        window.setTimeout(() => removeNow(oldest.id), NOTICE_EXIT_MS)
      }
      return next
    })
    window.setTimeout(() => dismiss(id), NOTICE_AUTO_DISMISS_MS)
  }, [removeNow])

  const dismiss = React.useCallback((id: string) => {
    setNotices((arr) => {
      const target = arr.find((entry) => entry.id === id)
      if (!target) return arr
      if (target.closing) return arr
      return arr.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry))
    })
    clearRemovalTimer(id)
    removalTimersRef.current[id] = window.setTimeout(() => removeNow(id), NOTICE_EXIT_MS)
  }, [clearRemovalTimer, removeNow])

  React.useEffect(() => () => {
    Object.values(removalTimersRef.current).forEach((timer) => window.clearTimeout(timer))
    removalTimersRef.current = {}
  }, [])

  return { notices, pushNotice, dismiss }
}

function NoticesPortal(
  { notices, dismiss, theme }: { notices: Notice[]; dismiss: (id: string) => void; theme: 'light' | 'dark' }
) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed top-0 left-0 right-0 z-[2147483647] flex justify-center pointer-events-none">
      <div className="w-full max-w-xl px-3">
        {notices.map((n) => (
          <NoticeItem key={n.id} notice={n} dismiss={dismiss} theme={theme} />
        ))}
      </div>
    </div>,
    document.body
  )
}


function NoticeItem({ notice, dismiss, theme }: { notice: Notice; dismiss: (id: string) => void; theme: 'light' | 'dark' }) {
  const [show, setShow] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 10)
    return () => clearTimeout(t)
  }, [])

  const base = 'pointer-events-auto mt-3 rounded-xl border px-4 py-2 shadow-lg transition-all duration-300'
  const colors =
    notice.variant === 'success'
      ? theme === 'dark'
        ? 'border-[#B9FF12]/45 bg-[#18240b] text-[#dcff8a]'
        : 'border-[#B9FF12] bg-[#f4ffd8] text-slate-950'
      : notice.variant === 'error'
        ? theme === 'dark'
          ? 'border-red-400/55 bg-red-950 text-red-100'
          : 'border-red-300 bg-red-50 text-red-800'
        : theme === 'dark'
          ? 'border-slate-600 bg-slate-950 text-slate-100'
          : 'border-slate-200 bg-white text-slate-950'

  return (
    <div
      className={`${base} ${colors} ${notice.closing ? 'opacity-0 -translate-y-3 scale-[0.98]' : show ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-3 scale-[0.98]'}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(true)}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 text-sm">{notice.message}</div>
        <button
          className="text-white/80 hover:text-white"
          onClick={() => dismiss(notice.id)}
          aria-label="Dismiss"
        >
          x
        </button>
      </div>
    </div>
  )
}

export function HeaderControls({
  primaryBank,
  secondaryBank,
  currentBank,
  isDualMode,
  padSize,
  stopMode,
  stopTimingOverrides,
  editMode,
  globalMuted,
  sideMenuOpen,
  mixerOpen,
  hasActiveDeckPlayback,
  searchOpen,
  channelLoadArmed,
  adminPadColorPaintActive,
  adminPadColorPaintColor,
  adminPadColorPaintCanUndo,
  theme,
  windowWidth,
  onFileUpload,
  onToggleEditMode,
  onToggleMute,
  onStopAll,
  onToggleSideMenu,
  onToggleMixer,
  onToggleSearch,
  onCancelChannelLoad,
  onStartAdminPadColorPaint,
  onStopAdminPadColorPaint,
  onUndoAdminPadColorPaint,
  onToggleTheme,
  onExitDualMode,
  onPadSizeChange,
  onStopModeChange,
  onStopTimingOverridesChange,
  defaultTriggerMode,
  onDefaultTriggerModeChange,
  graphicsProfile,
  effectiveGraphicsTierLabel,
  onGraphicsProfileChange,
  midiSupported,
  midiEnabled,
  midiAccessGranted,
  midiBackend,
  midiOutputSupported,
  midiInputs,
  midiSelectedInputId,
  midiError,
  onRequestMidiAccess,
  onSelectMidiInput,
  onToggleMidiEnabled,
  systemMappings,
  onUpdateSystemKey,
  onResetSystemKey,
  onUpdateSystemMidi,
  onUpdateSystemColor,
  onSetMasterVolumeCC,
  channelCount,
  onChangeChannelCount,
  onUpdateChannelMapping,
  padBankShortcutKeys,
  padBankMidiNotes,
  padBankMidiCCs,
  midiNoteAssignments,
  keyboardMappingEnabled,
  onToggleKeyboardMappingEnabled,
  hideShortcutLabels,
  onToggleHideShortcutLabels,
  autoPadBankMapping,
  onToggleAutoPadBankMapping,
  sidePanelMode,
  onChangeSidePanelMode,
  onResetAllSystemMappings,
  onClearAllSystemMappings,
  onResetAllChannelMappings,
  onClearAllChannelMappings,
  midiDeviceProfiles,
  midiDeviceProfileId,
  onSelectMidiDeviceProfile,
  onExportMappings,
  onImportMappings,
  onImportSharedBank,
  onExportAppBackup,
  onRestoreAppBackup,
  onRetryMissingMediaInCurrentBank,
  onRecoverMissingMediaFromBanks,
  guestPlaySummary,
  freePlaySummary,
  defaultBankSourceOptions,
  onPublishDefaultBankRelease,
}: HeaderControlsProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { user, profile, loading, authTransition, capabilities, offlineTrustedSession, pendingSessionClaim, sessionConflictReason } = useAuthState();
  const { signOut, updateDisplayName } = useAuthActions();
  const isAdmin = profile?.role === 'admin';
  const [adminDialogOpen, setAdminDialogOpen] = React.useState(false);
  const [AdminAccessDialog, setAdminAccessDialog] = React.useState<React.ComponentType<any> | null>(null);
  const [showLoginModal, setShowLoginModal] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const [showPadColorPaintDialog, setShowPadColorPaintDialog] = React.useState(false);
  const [showAllPadColors, setShowAllPadColors] = React.useState(false);
  const [pendingPadColor, setPendingPadColor] = React.useState<string>(adminPadColorPaintColor || PRIMARY_PAD_COLORS[0]?.value || '#f59e0b');
  const [showDisplayNamePrompt, setShowDisplayNamePrompt] = React.useState(false);
  const [showOfflineReadyDialog, setShowOfflineReadyDialog] = React.useState(false);
  const [isOnline, setIsOnline] = React.useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [displayNamePromptValue, setDisplayNamePromptValue] = React.useState('');
  const [savingDisplayNamePrompt, setSavingDisplayNamePrompt] = React.useState(false);
  const [stopAnimation, setStopAnimation] = React.useState<StopAnimationState | null>(null);
  const [stopModePicker, setStopModePicker] = React.useState<StopModePickerState | null>(null);
  const stopAnimationTimeoutRef = React.useRef<number | null>(null);
  const stopModeHoldTimeoutRef = React.useRef<number | null>(null);
  const stopClickSuppressTimeoutRef = React.useRef<number | null>(null);
  const stopGestureRef = React.useRef<StopGestureState | null>(null);
  const offlineNoticeShownRef = React.useRef(false);
  const appVersion = (import.meta as any).env?.VITE_APP_VERSION || 'unknown';
  const isElectronWindowControlsAvailable = typeof window !== 'undefined' && Boolean(window.electronAPI?.onFullscreenChange);
  const { state: appUpdateState, checkForUpdates, installUpdate } = useAppUpdate();
  const baseStopTimingProfile = React.useMemo(() => getStopTimingProfile(), []);
  const activeStopDurationMs = React.useMemo(() => (
    Math.max(10, getStopModeDurationMs(
      stopMode,
      applyStopTimingOverrides(baseStopTimingProfile, stopTimingOverrides)
    ))
  ), [baseStopTimingProfile, stopMode, stopTimingOverrides]);

  // Dynamically load AdminAccessDialog only for admin users
  React.useEffect(() => {
    if (isAdmin && adminDialogOpen && !AdminAccessDialog) {
      import('./AdminAccessDialog').then((module) => {
        setAdminAccessDialog(() => module.AdminAccessDialog);
      }).catch((error) => {
      });
    }
  }, [isAdmin, adminDialogOpen, AdminAccessDialog]);

  // Slide notices
  const { notices, pushNotice, dismiss } = useNotices()

  React.useEffect(() => {
    if (pendingSessionClaim || sessionConflictReason) {
      setShowLoginModal(true);
    }
  }, [pendingSessionClaim, sessionConflictReason]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const showOfflineNotice = () => {
      if (offlineNoticeShownRef.current) return;
      offlineNoticeShownRef.current = true;
      pushNotice({
        variant: 'info',
        message: 'Offline mode active. Local and prepared banks are available; Store, sync, and account changes need internet.',
      });
    };
    const updateOnlineState = () => {
      const nextOnline = navigator.onLine;
      setIsOnline(nextOnline);
      if (nextOnline) {
        offlineNoticeShownRef.current = false;
      } else {
        showOfflineNotice();
      }
    };
    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, [pushNotice]);

  React.useEffect(() => {
    if (loading || isOnline) return;
    const activeUser = user || getCachedUser();
    if (!activeUser?.id) return;
    if (!offlineTrustedSession && !user?.id) return;
    const storageKey = `${OFFLINE_READY_INFO_STORAGE_PREFIX}:${activeUser.id}`;
    try {
      if (localStorage.getItem(storageKey) === '1') return;
      localStorage.setItem(storageKey, '1');
    } catch {
    }
    setShowOfflineReadyDialog(true);
  }, [isOnline, loading, offlineTrustedSession, user]);

  const openUpgradeDialog = React.useCallback((reason?: string | null) => {
    const message = reason || 'Choose a PRO or PRO MAX plan to unlock this feature.';
    const activeUser = user || getCachedUser();
    if (!activeUser) {
      pushNotice({ variant: 'info', message });
      setUpgradeOpen(true);
      return;
    }
    pushNotice({ variant: 'info', message });
    setUpgradeOpen(true);
  }, [pushNotice, user]);

  React.useEffect(() => () => {
    if (stopAnimationTimeoutRef.current !== null) {
      window.clearTimeout(stopAnimationTimeoutRef.current);
      stopAnimationTimeoutRef.current = null;
    }
    if (stopModeHoldTimeoutRef.current !== null) {
      window.clearTimeout(stopModeHoldTimeoutRef.current);
      stopModeHoldTimeoutRef.current = null;
    }
    if (stopClickSuppressTimeoutRef.current !== null) {
      window.clearTimeout(stopClickSuppressTimeoutRef.current);
      stopClickSuppressTimeoutRef.current = null;
    }
  }, []);

  const startStopAnimation = React.useCallback(() => {
    if (stopMode === 'instant') {
      return;
    }
    if (stopAnimationTimeoutRef.current !== null) {
      window.clearTimeout(stopAnimationTimeoutRef.current);
      stopAnimationTimeoutRef.current = null;
    }
    const durationMs = Math.max(10, Math.round(activeStopDurationMs));
    flushSync(() => {
      setStopAnimation((current) => ({
        key: (current?.key ?? 0) + 1,
        durationMs,
      }));
    });
    stopAnimationTimeoutRef.current = window.setTimeout(() => {
      setStopAnimation(null);
      stopAnimationTimeoutRef.current = null;
    }, durationMs);
  }, [activeStopDurationMs, stopMode]);

  const handleStopAllWithAnimation = React.useCallback(() => {
    startStopAnimation();
    onStopAll();
  }, [onStopAll, startStopAnimation]);

  const closeStopModePicker = React.useCallback(() => {
    setStopModePicker(null);
  }, []);

  const isStopModeAllowed = React.useCallback((mode: StopMode) => (
    mode === 'instant' || capabilities.features.advancedStopModes
  ), [capabilities.features.advancedStopModes]);

  const handleStopModeSelection = React.useCallback((mode: StopMode | null) => {
    closeStopModePicker();
    if (!mode) return;
    if (!isStopModeAllowed(mode)) {
      openUpgradeDialog('Advanced stop modes require PRO.');
      return;
    }
    if (mode !== stopMode) {
      onStopModeChange(mode);
      pushNotice({ variant: 'success', message: `Stop mode: ${getStopModeLabel(mode)}` });
    }
  }, [closeStopModePicker, isStopModeAllowed, onStopModeChange, openUpgradeDialog, pushNotice, stopMode]);

  const clearStopHoldTimer = React.useCallback(() => {
    if (stopModeHoldTimeoutRef.current !== null) {
      window.clearTimeout(stopModeHoldTimeoutRef.current);
      stopModeHoldTimeoutRef.current = null;
    }
  }, []);

  const armStopClickSuppression = React.useCallback((gesture: StopGestureState) => {
    if (stopClickSuppressTimeoutRef.current !== null) {
      window.clearTimeout(stopClickSuppressTimeoutRef.current);
      stopClickSuppressTimeoutRef.current = null;
    }
    stopGestureRef.current = { ...gesture, suppressClick: true };
    stopClickSuppressTimeoutRef.current = window.setTimeout(() => {
      const current = stopGestureRef.current;
      if (current?.pointerId === gesture.pointerId && current.suppressClick) {
        stopGestureRef.current = null;
      }
      stopClickSuppressTimeoutRef.current = null;
    }, 450);
  }, []);

  const handleStopPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>, isCompact: boolean) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    clearStopHoldTimer();
    if (stopClickSuppressTimeoutRef.current !== null) {
      window.clearTimeout(stopClickSuppressTimeoutRef.current);
      stopClickSuppressTimeoutRef.current = null;
    }
    stopGestureRef.current = {
      pointerId: event.pointerId,
      holdOpened: false,
      suppressClick: false,
      isCompact,
      center,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    stopModeHoldTimeoutRef.current = window.setTimeout(() => {
      const gesture = stopGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.holdOpened = true;
      gesture.suppressClick = true;
      setStopModePicker({
        open: true,
        center,
        activeMode: null,
        isCompact,
      });
    }, STOP_MODE_HOLD_MS);
  }, [clearStopHoldTimer]);

  const handleStopPointerMove = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = stopGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !gesture.holdOpened) return;
    event.preventDefault();
    const activeMode = getStopModeFromPointer(event.clientX, event.clientY, gesture.center, gesture.isCompact);
    setStopModePicker((current) => {
      if (!current || current.activeMode === activeMode) return current;
      return { ...current, activeMode };
    });
  }, []);

  const handleStopPointerUp = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = stopGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    clearStopHoldTimer();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
    }
    if (gesture.holdOpened) {
      armStopClickSuppression(gesture);
      const selectedMode = getStopModeFromPointer(event.clientX, event.clientY, gesture.center, gesture.isCompact);
      handleStopModeSelection(selectedMode);
      return;
    }
    armStopClickSuppression(gesture);
    handleStopAllWithAnimation();
  }, [armStopClickSuppression, clearStopHoldTimer, handleStopAllWithAnimation, handleStopModeSelection]);

  const handleStopClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const gesture = stopGestureRef.current;
    if (gesture?.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      stopGestureRef.current = null;
      if (stopClickSuppressTimeoutRef.current !== null) {
        window.clearTimeout(stopClickSuppressTimeoutRef.current);
        stopClickSuppressTimeoutRef.current = null;
      }
      return;
    }
    handleStopAllWithAnimation();
  }, [handleStopAllWithAnimation]);

  const handleStopPointerCancel = React.useCallback(() => {
    clearStopHoldTimer();
    if (stopClickSuppressTimeoutRef.current !== null) {
      window.clearTimeout(stopClickSuppressTimeoutRef.current);
      stopClickSuppressTimeoutRef.current = null;
    }
    stopGestureRef.current = null;
    closeStopModePicker();
  }, [clearStopHoldTimer, closeStopModePicker]);

  // Track previous user to detect login
  const prevUserIdRef = React.useRef<string | null>(null);
  const prevAuthTransitionRef = React.useRef(authTransition.status);

  React.useEffect(() => {
    const handleLoginRequest = () => setShowLoginModal(true);
    window.addEventListener('vdjv-login-request', handleLoginRequest as EventListener);
    return () => window.removeEventListener('vdjv-login-request', handleLoginRequest as EventListener);
  }, []);

  React.useEffect(() => {
    const handleRequireLogin = (event: Event) => {
      const customEvent = event as CustomEvent<{ reason?: string }>;
      const reason = customEvent.detail?.reason;
      if (user || getCachedUser()) {
        if (capabilities.effectiveTier === 'free') {
          openUpgradeDialog(reason || 'Upgrade to unlock this action.');
        } else if (reason) {
          pushNotice({ variant: 'info', message: reason });
        }
        return;
      }
      setShowLoginModal(true);
      if (reason) {
        pushNotice({ variant: 'info', message: reason });
      }
    };
    window.addEventListener('vdjv-require-login', handleRequireLogin as EventListener);
    return () => window.removeEventListener('vdjv-require-login', handleRequireLogin as EventListener);
  }, [capabilities.effectiveTier, openUpgradeDialog, pushNotice, user]);

  React.useEffect(() => {
    const handleOpenAbout = () => setSettingsOpen(true);
    window.addEventListener('vdjv-open-about', handleOpenAbout as EventListener);
    return () => window.removeEventListener('vdjv-open-about', handleOpenAbout as EventListener);
  }, []);

  React.useEffect(() => {
    const handleOpenUpgrade = (event: Event) => {
      const customEvent = event as CustomEvent<{ reason?: string }>;
      openUpgradeDialog(customEvent.detail?.reason || 'Upgrade to PRO or PRO MAX to unlock this feature.');
    };
    window.addEventListener('vdjv-open-upgrade', handleOpenUpgrade as EventListener);
    return () => window.removeEventListener('vdjv-open-upgrade', handleOpenUpgrade as EventListener);
  }, [openUpgradeDialog]);

  React.useEffect(() => {
    const handleOpenSharedBankImport = () => {
      setSettingsOpen(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new Event('vdjv-open-shared-bank-import'));
        });
      });
    };
    window.addEventListener('vdjv-import-bank', handleOpenSharedBankImport as EventListener);
    return () => window.removeEventListener('vdjv-import-bank', handleOpenSharedBankImport as EventListener);
  }, []);

  React.useEffect(() => {
    if (!showPadColorPaintDialog) return;
    setPendingPadColor(adminPadColorPaintColor || PRIMARY_PAD_COLORS[0]?.value || '#f59e0b');
  }, [adminPadColorPaintColor, showPadColorPaintDialog]);

  React.useEffect(() => {
    if (!isElectronWindowControlsAvailable) return;
    let mounted = true;

    const unsubscribe = window.electronAPI?.onFullscreenChange?.((next) => {
      if (!mounted) return;
      if (next) {
        pushNotice({ variant: 'info', message: 'Fullscreen enabled. Press Esc to exit or use the Fullscreen button.' });
      }
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isElectronWindowControlsAvailable, pushNotice]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tagName = element.tagName;
      return (
        element.isContentEditable ||
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT'
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (windowWidth < 1024) return;
      const normalizedKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (!normalizedKey) return;
      if ((event.metaKey || event.ctrlKey) && normalizedKey === 'k') {
        if (isEditableTarget(event.target)) return;
        if (!capabilities.features.search) {
          if (capabilities.effectiveTier === 'free') {
            event.preventDefault();
            openUpgradeDialog('Search is available in PRO and PRO MAX.');
          } else {
            pushNotice({ variant: 'info', message: 'Search is available in PRO.' });
          }
          return;
        }
        event.preventDefault();
        onToggleSearch();
        return;
      }
      if (normalizedKey === 'escape' && adminPadColorPaintActive) {
        onStopAdminPadColorPaint();
        pushNotice({ variant: 'info', message: 'Color Paint Mode cancelled.' });
        return;
      }
      if (normalizedKey === 'escape' && searchOpen) {
        onToggleSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adminPadColorPaintActive, capabilities.effectiveTier, capabilities.features.search, onStopAdminPadColorPaint, onToggleSearch, openUpgradeDialog, pushNotice, searchOpen, windowWidth]);

  // Show greeting notification when user logs in
  React.useEffect(() => {
    const currentUserId = user?.id || null;
    const justLoggedIn = currentUserId && prevUserIdRef.current !== currentUserId;

    if (justLoggedIn && profile) {
      const todayKey = getLocalGreetingDayKey(new Date());
      const greetingStorageKey = `${LOGIN_GREETING_STORAGE_PREFIX}:${currentUserId}`;
      let alreadyGreetedToday = false;

      try {
        alreadyGreetedToday = localStorage.getItem(greetingStorageKey) === todayKey;
      } catch {
      }

      if (alreadyGreetedToday) {
        prevUserIdRef.current = currentUserId;
        return;
      }

      const greeting = getTimeBasedGreeting();
      const displayName = profile.display_name || user?.email?.split('@')[0] || 'User';
      pushNotice({
        variant: 'success',
        message: `${greeting}, ${displayName}! Welcome back.`
      });

      try {
        localStorage.setItem(greetingStorageKey, todayKey);
      } catch {
      }
    }

    prevUserIdRef.current = currentUserId;
  }, [user, profile, pushNotice]);

  React.useEffect(() => {
    if (!user?.id || !profile || loading || showLoginModal || isAdmin) return;
    if (!shouldPromptForDisplayName(profile.display_name, user.email)) {
      setShowDisplayNamePrompt(false);
      return;
    }

    try {
      const snoozedUntil = Number(localStorage.getItem(`${DISPLAY_NAME_PROMPT_SNOOZE_PREFIX}:${user.id}`) || 0);
      if (Number.isFinite(snoozedUntil) && snoozedUntil > Date.now()) {
        return;
      }
    } catch {
    }

    setDisplayNamePromptValue('');
    setShowDisplayNamePrompt(true);
  }, [isAdmin, loading, profile, showLoginModal, user]);

  const dismissDisplayNamePrompt = React.useCallback((snooze: boolean) => {
    if (user?.id && snooze) {
      try {
        localStorage.setItem(`${DISPLAY_NAME_PROMPT_SNOOZE_PREFIX}:${user.id}`, String(Date.now() + DISPLAY_NAME_PROMPT_SNOOZE_MS));
      } catch {
      }
    }
    setShowDisplayNamePrompt(false);
  }, [user?.id]);

  const handleSaveDisplayNamePrompt = React.useCallback(async () => {
    const normalized = displayNamePromptValue.trim();
    if (normalized.length < 2) {
      pushNotice({ variant: 'error', message: 'Display name must be at least 2 characters.' });
      return;
    }
    if (normalized.length > 50) {
      pushNotice({ variant: 'error', message: 'Display name must be 50 characters or less.' });
      return;
    }

    setSavingDisplayNamePrompt(true);
    try {
      const result = await updateDisplayName(normalized);
      if (result.error) {
        pushNotice({ variant: 'error', message: result.error.message || 'Display name could not be updated.' });
        return;
      }
      if (user?.id) {
        try {
          localStorage.removeItem(`${DISPLAY_NAME_PROMPT_SNOOZE_PREFIX}:${user.id}`);
        } catch {
        }
      }
      setShowDisplayNamePrompt(false);
      pushNotice({ variant: 'success', message: `Saved. We will call you ${normalized}.` });
    } finally {
      setSavingDisplayNamePrompt(false);
    }
  }, [displayNamePromptValue, pushNotice, updateDisplayName, user?.id]);

  const handleSignOut = React.useCallback(async () => {
    if (authTransition.status === 'signing_out') return;
    const { error } = await signOut();
    if (error) {
      pushNotice({ variant: 'error', message: error.message || 'Sign out failed.' });
      return;
    }
    pushNotice({ variant: 'info', message: 'Signing out...' });
  }, [authTransition.status, signOut, pushNotice]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('audio/')) {
          try {
            await onFileUpload(file);
          } catch {
          }
        }
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const isMobileScreen = windowWidth < 1160;
  const effectiveAuthUser = user || getCachedUser();
  const { showStoreNewBadge } = useStorePreviewBadge({
    effectiveUser: effectiveAuthUser,
    profileId: profile?.id,
  });
  const isAuthenticated = Boolean(effectiveAuthUser);
  const isSigningIn = authTransition.status === 'signing_in';
  const isSigningOut = authTransition.status === 'signing_out';
  const isPortraitViewport = typeof window !== 'undefined'
    ? window.innerHeight > window.innerWidth
    : windowWidth < 768;
  const isCompactBottomNav = windowWidth < 768 || isPortraitViewport;
  const effectiveGraphicsTierKey = React.useMemo(() => {
    const label = effectiveGraphicsTierLabel.toLowerCase();
    if (label.includes('lowest')) return 'lowest';
    if (label.includes('medium')) return 'medium';
    if (label.includes('high')) return 'high';
    if (label.includes('low')) return 'low';
    return graphicsProfile === 'auto' ? 'medium' : graphicsProfile;
  }, [effectiveGraphicsTierLabel, graphicsProfile]);
  const useGlassStopModePicker = effectiveGraphicsTierKey === 'high';
  const defaultTrialSummary = freePlaySummary?.visible
    ? {
      visible: true,
      mode: 'free' as const,
      remainingCount: freePlaySummary.remainingCount,
      exhausted: freePlaySummary.exhausted,
      resetLabel: freePlaySummary.resetLabel,
    }
    : undefined;
  const playSummary = guestPlaySummary?.visible ? guestPlaySummary : defaultTrialSummary;
  const maxPadSize = isPortraitViewport ? 8 : 16;
  const minPadSize = 2;

  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = profile?.display_name || effectiveAuthUser?.email?.split('@')[0] || 'Guest';
  const handlePadSizeFromDialog = React.useCallback((requestedSize: number) => {
    const nextSize = Math.max(minPadSize, Math.min(maxPadSize, requestedSize));
    onPadSizeChange(nextSize);
  }, [maxPadSize, minPadSize, onPadSizeChange]);

  const getBankDisplayName = () => {
    if (isDualMode) {
      return `${primaryBank?.name || 'None'} | ${secondaryBank?.name || 'None'}`;
    } else {
      return currentBank?.name || 'No bank selected';
    }
  };

  React.useEffect(() => {
    const previous = prevAuthTransitionRef.current;
    if (previous === 'signing_out' && authTransition.status === 'idle' && !isAuthenticated) {
      pushNotice({ variant: 'success', message: 'Signed out.' });
    }
    prevAuthTransitionRef.current = authTransition.status;
  }, [authTransition.status, isAuthenticated, pushNotice]);

  const padColorPaintBlockedReason = !editMode
    ? 'Enter Edit Mode before using Color Paint Mode.'
    : channelLoadArmed
      ? 'Cancel channel load mode before using Color Paint Mode.'
      : searchOpen
        ? 'Close search before using Color Paint Mode.'
        : null;

  const handlePadColorPaintButton = React.useCallback(() => {
    if (padColorPaintBlockedReason) {
      pushNotice({ variant: 'info', message: padColorPaintBlockedReason });
      return;
    }
    setShowPadColorPaintDialog(true);
  }, [padColorPaintBlockedReason, pushNotice]);

  const handleStopPadColorPaint = React.useCallback(() => {
    onStopAdminPadColorPaint();
    pushNotice({ variant: 'info', message: 'Color Paint Mode cancelled.' });
  }, [onStopAdminPadColorPaint, pushNotice]);

  const handleConfirmPadColorPaint = React.useCallback(() => {
    onStartAdminPadColorPaint(pendingPadColor);
    setShowPadColorPaintDialog(false);
    setShowAllPadColors(false);
    pushNotice({
      variant: 'success',
      message: `Color Paint Mode active: ${getPadColorOptionLabel(pendingPadColor)}. Click pads to recolor them.`,
    });
  }, [onStartAdminPadColorPaint, pendingPadColor, pushNotice]);

  const handleUndoPadColorPaint = React.useCallback(() => {
    onUndoAdminPadColorPaint();
    pushNotice({ variant: 'info', message: 'Undid the last painted pad color.' });
  }, [onUndoAdminPadColorPaint, pushNotice]);
  const headerBadgeClass = theme === 'dark'
    ? 'border-red-400/60 bg-red-500/20 text-red-100'
    : 'border-red-300 bg-red-50 text-red-700';
  const mixerBadgeClass = 'vdjv-status-good';
  const controlClass = React.useCallback((
    widthClass: string,
    state: 'default' | 'active' | 'danger' | 'warn' | 'good' = 'default',
  ) => cn(
    widthClass,
    'transition-all duration-200',
    state === 'active' && 'vdjv-control-active',
    state === 'danger' && 'vdjv-status-danger hover:bg-primary/18',
    state === 'warn' && 'vdjv-status-warn hover:bg-amber-500/18',
    state === 'good' && 'vdjv-status-good hover:bg-emerald-500/18',
  ), []);

  const handleSearchSlotClick = React.useCallback(() => {
    if (capabilities.features.search) {
      onToggleSearch();
      return;
    }
    if (playSummary?.mode === 'guest') {
      setShowLoginModal(true);
      pushNotice({
        variant: 'info',
        message: playSummary.exhausted
          ? `Guest trial finished. Sign in or upgrade to keep playing.`
          : `Guest trial: ${playSummary.remainingCount} plays left on Default Bank.`,
      });
      return;
    }
    if (playSummary?.mode === 'free') {
      openUpgradeDialog(
        playSummary.exhausted
          ? `Free plays are finished. They reset ${playSummary.resetLabel || 'tomorrow'}. Upgrade to keep playing now.`
          : 'Upgrade to PRO for unlimited Default Bank plays and Store access.'
      );
      return;
    }
    openUpgradeDialog('Search is available in PRO and PRO MAX.');
  }, [capabilities.features.search, onToggleSearch, openUpgradeDialog, playSummary, pushNotice]);

  const navButtonBase = cn(
    'relative flex h-12 items-center justify-center gap-1.5 rounded-2xl border text-xs font-bold transition-colors',
    theme === 'dark'
      ? 'border-slate-700 bg-slate-950 text-slate-200 hover:border-red-400 hover:bg-slate-900'
      : 'border-slate-200 bg-white text-slate-700 hover:border-red-300 hover:bg-red-50'
  );
  const compactNavButtonBase = cn(
    'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-bold transition-colors',
    theme === 'dark' ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-900'
  );

  const bankIslandClass = (tone: 'primary' | 'secondary') => cn(
    'pointer-events-auto min-w-0 max-w-full truncate rounded-full border px-4 py-1.5 text-center text-xs font-black shadow-sm',
    tone === 'secondary'
      ? theme === 'dark'
        ? 'border-sky-400/40 bg-sky-950/95 text-sky-100'
        : 'border-sky-200 bg-white/95 text-sky-700'
      : theme === 'dark'
        ? 'border-red-400/40 bg-slate-950/95 text-red-100'
        : 'border-red-200 bg-white/95 text-red-700'
  );

  const getBankAccentColor = React.useCallback((bank: SamplerBank | null | undefined) => (
    normalizeHexColor(bank?.bankMetadata?.color) ||
    normalizeHexColor(bank?.defaultColor) ||
    null
  ), []);

  const bankIslandStyle = React.useCallback((bank: SamplerBank | null | undefined): React.CSSProperties | undefined => {
    const color = getBankAccentColor(bank);
    if (!color) return undefined;
    return {
      borderColor: hexToRgba(color, theme === 'dark' ? 0.85 : 0.72),
      backgroundColor: color,
      color: getReadableTextColor(color),
      boxShadow: `0 10px 28px ${hexToRgba(color, 0.24)}`,
    };
  }, [getBankAccentColor, theme]);

  const navDotRingClass = theme === 'dark' ? 'ring-slate-950' : 'ring-white';
  const renderNavIcon = (icon: React.ReactNode, dotClass?: string) => (
    <span className="relative inline-flex h-6 w-6 items-center justify-center">
      <span className="inline-flex h-5 w-5 items-center justify-center">{icon}</span>
      {dotClass ? (
        <span
          aria-hidden="true"
          className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2', navDotRingClass, dotClass)}
        />
      ) : null}
    </span>
  );

  return (
    <>
      {/* Slide-down notifications */}
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      {stopModePicker?.open && typeof document !== 'undefined' && createPortal(
        <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden="true">
          {STOP_MODE_RADIAL_OPTIONS.map((option) => {
            const point = getStopModePickerGeometry(option.mode, stopModePicker.center, stopModePicker.isCompact);
            const selected = stopModePicker.activeMode === option.mode;
            const current = stopMode === option.mode;
            const locked = !isStopModeAllowed(option.mode);
            return (
              <div
                key={option.mode}
                className={cn(
                  'fixed flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border text-center font-black shadow-[0_18px_45px_rgba(15,23,42,0.32)] transition-all duration-150',
                  stopModePicker.isCompact ? 'h-12 w-[4.55rem] text-[10px]' : 'h-11 w-28 text-[11px]',
                  useGlassStopModePicker && 'backdrop-blur-xl',
                  useGlassStopModePicker
                    ? theme === 'dark'
                      ? 'border-slate-600/80 bg-slate-950/82 text-slate-50'
                      : 'border-white/80 bg-white/82 text-slate-900'
                    : theme === 'dark'
                      ? 'border-slate-700 bg-slate-950 text-slate-50'
                      : 'border-slate-300 bg-white text-slate-900',
                  current && !selected && 'border-red-300 text-red-500 ring-2 ring-red-300/35',
                  selected && 'scale-110 border-[#B9FF12] bg-[#B9FF12] text-slate-950 ring-4 ring-[#B9FF12]/30',
                  locked && !selected && 'opacity-65'
                )}
                style={{ left: point.x, top: point.y }}
              >
                <span className="max-w-full truncate px-1">{stopModePicker.isCompact ? option.shortLabel : option.label}</span>
                {locked ? <span className="mt-0.5 text-[8px] uppercase tracking-[0.18em] opacity-80">PRO</span> : null}
              </div>
            );
          })}
        </div>,
        document.body
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_FILE_INPUT_ACCEPT}
        multiple
        onChange={handleFileSelect}
        className="hidden"
        id="global-audio-upload-input"
      />

      <header className="fixed left-0 right-0 top-[calc(var(--vdjv-safe-top)+0.35rem)] z-40 flex min-h-[2.65rem] items-start justify-center px-2 text-center pointer-events-none">
        <div className="absolute left-2 top-1 pointer-events-auto">
          {isAdmin && (
            <React.Suspense fallback={null}>
              <HeaderAdminDebugPanel
                currentBankId={currentBank?.id || null}
                isDualMode={isDualMode}
                primaryBankId={primaryBank?.id || null}
                secondaryBankId={secondaryBank?.id || null}
                theme={theme}
                pushNotice={pushNotice}
              />
            </React.Suspense>
          )}
        </div>
        <div className={cn(
          'grid w-full items-center gap-2 text-sm',
          isDualMode
            ? 'max-w-[min(100vw-1rem,calc(100vw-1rem))] grid-cols-2'
            : 'max-w-[min(42rem,94vw)] grid-cols-1 justify-items-center',
          theme === 'dark' ? 'text-slate-200' : 'text-slate-700'
        )}>
          {isDualMode ? (
            <>
              <span className={cn(bankIslandClass('primary'), 'w-[min(19rem,44vw)] justify-self-center')} style={bankIslandStyle(primaryBank)} title={primaryBank?.name || 'None'}>
                {primaryBank?.name || 'None'}
              </span>
              <span className={cn(bankIslandClass('secondary'), 'w-[min(19rem,44vw)] justify-self-center')} style={bankIslandStyle(secondaryBank)} title={secondaryBank?.name || 'None'}>
                {secondaryBank?.name || 'None'}
              </span>
            </>
          ) : (
            <span className={cn(bankIslandClass('primary'), 'inline-block max-w-[90vw] justify-self-center')} style={bankIslandStyle(currentBank)} title={getBankDisplayName()}>
              {getBankDisplayName()}
            </span>
          )}
        </div>

        <div className="hidden">
          {/* Banks Menu Button */}
          <Button
            onClick={onToggleSideMenu}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={cn('relative', controlClass(isMobileScreen ? 'w-10' : 'w-24', sideMenuOpen ? 'active' : 'default'))}
          >
            <Menu className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Banks')}
            {showStoreNewBadge && (
              isMobileScreen ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.85)] dark:shadow-[0_0_0_2px_rgba(17,24,39,0.9)]"
                />
              ) : (
                <span className={`absolute -right-1.5 -top-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none ${headerBadgeClass}`}>
                  NEW
                </span>
              )
            )}
          </Button>

          {/* Upload Button */}
          <Button
            onClick={handleUploadClick}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={controlClass(isMobileScreen ? 'w-10' : 'w-24')}
          >
            <Upload className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Upload')}
          </Button>

          {/* Edit Mode Toggle */}
          <Button
            onClick={onToggleEditMode}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={controlClass(isMobileScreen ? 'w-10' : 'w-24', editMode ? 'warn' : 'default')}
          >
            <Pencil className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : editMode ? 'Exit Edit' : 'Edit')}
          </Button>

          {isAdmin && editMode && (
            <Button
              onClick={handlePadColorPaintButton}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={controlClass(isMobileScreen ? 'w-10' : 'w-28', adminPadColorPaintActive ? 'active' : 'default')}
              title={adminPadColorPaintActive ? 'Change paint color' : (padColorPaintBlockedReason || 'Color Paint Mode')}
            >
              <Palette className="w-4 h-4" />
              {!isMobileScreen && (adminPadColorPaintActive ? 'Change Color' : 'Color Paint')}
            </Button>
          )}

          {isAdmin && adminPadColorPaintCanUndo && (
            <Button
              onClick={handleUndoPadColorPaint}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={controlClass(isMobileScreen ? 'w-10' : 'w-24')}
              title="Undo last painted pad color"
            >
              <Undo2 className="w-4 h-4" />
              {!isMobileScreen && 'Undo'}
            </Button>
          )}

          {/* Search Button */}
          {capabilities.features.search && (
            <Button
              onClick={onToggleSearch}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={controlClass(isMobileScreen ? 'w-10' : 'w-24', searchOpen ? 'active' : 'default')}
              title={isMobileScreen ? 'Search pads' : 'Search pads (Ctrl/Cmd+K)'}
            >
              <Search className="w-4 h-4" />
              {!isMobileScreen && 'Search'}
            </Button>
          )}
          {/* Mute/Unmute Button */}
          <Button
            onClick={onToggleMute}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            title={globalMuted ? 'Master output is muted. Click to unmute.' : 'Mute all sampler output.'}
            aria-pressed={globalMuted}
            className={controlClass(isMobileScreen ? 'w-10' : 'w-24', globalMuted ? 'danger' : 'default')}
          >
            {globalMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
            {!isMobileScreen && (isMobileScreen ? '' : globalMuted ? 'Muted' : 'Mute')}
          </Button>

          {/* Stop All Button */}
          <Button
            onClick={handleStopAllWithAnimation}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={controlClass(isMobileScreen ? 'w-10' : 'w-24', 'danger')}
          >
            <Square className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Stop All')}
          </Button>

          {/* Mixer Button */}
          <Button
            onClick={channelLoadArmed ? onCancelChannelLoad : onToggleMixer}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={cn('relative', controlClass(isMobileScreen ? 'w-10' : 'w-24', channelLoadArmed ? 'danger' : mixerOpen ? 'good' : 'default'))}
          >
            {channelLoadArmed ? <X className="w-4 h-4" /> : <Sliders className="w-4 h-4" />}
            {!isMobileScreen && (isMobileScreen ? '' : channelLoadArmed ? 'Cancel' : 'Mixer')}
            {!channelLoadArmed && hasActiveDeckPlayback && (
              isMobileScreen ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(255,255,255,0.85)] dark:shadow-[0_0_0_2px_rgba(17,24,39,0.9)]"
                />
              ) : (
                <span className={`absolute -right-1.5 -top-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none ${mixerBadgeClass}`}>
                  PLAYING
                </span>
              )
            )}
          </Button>

          {/* Admin Access (admin-only) */}
          {isAdmin && (
            <Button
              onClick={() => setAdminDialogOpen(true)}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={controlClass(isMobileScreen ? 'w-10' : 'w-40', 'warn')}
              title="Manage bank access"
            >
              <Shield className="w-4 h-4" />
              {!isMobileScreen && 'Admin Access'}
            </Button>
          )}

          {isDualMode && (
            <Button
              onClick={onExitDualMode}
              variant="outline"
              size="default"
              className={controlClass('w-36', 'warn')}
              title="Exit dual mode"
            >
              <X className="w-4 h-4" />
              <span>Exit Dual Mode</span>
            </Button>
          )}
        </div>

        {false && globalMuted && (
          <div className={`mx-auto mb-2 inline-flex max-w-[92vw] flex-wrap items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            theme === 'dark'
              ? 'border-red-400/50 bg-red-500/15 text-red-100'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}>
            <VolumeX className="h-3.5 w-3.5 shrink-0" />
            <span>Master output muted</span>
          </div>
        )}

        {false && isAdmin && adminPadColorPaintActive && adminPadColorPaintColor && (
          <div className={`mx-auto mb-2 inline-flex max-w-[92vw] flex-wrap items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
            theme === 'dark'
              ? 'border-red-400/40 bg-red-500/10 text-red-100'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}>
            <Palette className="h-3.5 w-3.5" />
            <span>Color Paint Mode</span>
            <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/60" style={{ backgroundColor: adminPadColorPaintColor }} />
            <span>{getPadColorOptionLabel(adminPadColorPaintColor)}</span>
            <span className={theme === 'dark' ? 'text-red-200/80' : 'text-red-600/80'}>
              Click pads to recolor. Press Esc or stop paint to return to normal edit mode.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStopPadColorPaint}
              className={`h-7 px-2 text-[11px] ${
                theme === 'dark'
                  ? 'border-red-300/40 bg-red-500/10 text-red-100 hover:bg-red-500/20'
                  : 'border-red-300 bg-white text-red-700 hover:bg-red-100'
              }`}
            >
              Stop Paint
            </Button>
          </div>
        )}
      </header>

      <div
        className={cn(
          'fixed left-1/2 z-40 -translate-x-1/2 pointer-events-none',
          isCompactBottomNav
            ? 'bottom-[calc(var(--vdjv-safe-bottom)+0.65rem)] w-[min(29rem,calc(100vw-1rem))]'
            : 'bottom-[calc(var(--vdjv-safe-bottom)+0.85rem)]'
        )}
      >
        <div
          className={cn(
            'pointer-events-auto mx-auto items-center border shadow-lg',
            isCompactBottomNav
              ? theme === 'dark'
                ? 'flex h-[4.85rem] rounded-[2rem] border-slate-700 bg-neutral-950 px-3 pb-2 pt-3'
                : 'flex h-[4.85rem] rounded-[2rem] border-slate-200 bg-white px-3 pb-2 pt-3'
              : theme === 'dark'
                ? 'grid grid-cols-[6rem_6rem_6rem_7rem_6rem_6rem_6rem] gap-2 rounded-2xl border-slate-800 bg-slate-950 p-1.5'
                : 'grid grid-cols-[6rem_6rem_6rem_7rem_6rem_6rem_6rem] gap-2 rounded-2xl border-slate-200 bg-white p-1.5'
          )}
        >
          <button
            type="button"
            onClick={onToggleSideMenu}
            className={isCompactBottomNav ? compactNavButtonBase : cn(navButtonBase, 'w-full', sideMenuOpen && 'border-red-400 text-red-500')}
          >
            {renderNavIcon(
              <Menu className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} />,
              showStoreNewBadge ? 'bg-[#B9FF12]' : undefined
            )}
            <span>Bank</span>
          </button>

          {!isCompactBottomNav && (
            <button
              type="button"
              onClick={handleUploadClick}
              className={cn(navButtonBase, 'w-full')}
              title="Upload audio to current bank"
            >
              {renderNavIcon(<Upload className="h-4 w-4" />)}
              <span>Upload</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSearchSlotClick}
            className={isCompactBottomNav ? compactNavButtonBase : cn(navButtonBase, 'w-full', searchOpen && 'border-red-400 text-red-500')}
            title={capabilities.features.search ? 'Search pads' : 'Upgrade or sign in for full search'}
          >
            {capabilities.features.search
              ? renderNavIcon(<Search className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} />)
              : playSummary?.mode === 'guest' || !isAuthenticated
                ? renderNavIcon(<LogIn className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} />)
                : renderNavIcon(<ArrowUpCircle className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} />)}
            <span className="max-w-full truncate">
              {capabilities.features.search
                  ? 'Search'
                  : playSummary?.mode === 'guest' || !isAuthenticated
                    ? 'Login'
                    : 'Upgrade'}
            </span>
            {playSummary?.visible && !capabilities.features.search && (
              <span
                aria-label={`${playSummary.remainingCount} plays left`}
                className={cn(
                  'absolute -right-1 -top-1 z-10 min-w-6 rounded-full border px-1.5 py-0.5 text-[10px] font-black leading-none shadow',
                  playSummary.exhausted
                    ? 'border-red-200 bg-red-600 text-white'
                    : 'border-white/70 bg-[#B9FF12] text-slate-950'
                )}
              >
                {playSummary.remainingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleStopClick}
            onPointerDown={(event) => handleStopPointerDown(event, isCompactBottomNav)}
            onPointerMove={handleStopPointerMove}
            onPointerUp={handleStopPointerUp}
            onPointerCancel={handleStopPointerCancel}
            onContextMenu={(event) => event.preventDefault()}
            className={cn(
              'relative flex touch-none select-none items-center justify-center border font-black text-white shadow-lg transition-transform active:scale-95',
              isCompactBottomNav
                ? 'mx-1 -mt-12 h-[4.65rem] w-[4.65rem] shrink-0 overflow-visible rounded-full border-red-200 bg-red-600 ring-[0.5rem] ring-red-200/80'
                : 'h-12 w-full overflow-hidden rounded-2xl border-red-400 bg-red-600',
              theme === 'dark' && isCompactBottomNav ? 'ring-slate-700/80' : ''
            )}
            title="Stop all pads"
          >
            {stopAnimation && isCompactBottomNav ? (
              <svg
                key={`stop-ring-${stopAnimation.key}`}
                className="pointer-events-none absolute -inset-2.5 z-20 -rotate-90 overflow-visible"
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="rgba(185,255,18,0.16)"
                  strokeWidth="5"
                />
                <circle
                  className="vdjv-stop-ring-deprogress"
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  pathLength="1"
                  stroke="#B9FF12"
                  strokeDasharray="1"
                  strokeDashoffset="0"
                  strokeLinecap="round"
                  strokeWidth="5"
                  style={{ animationDuration: `${stopAnimation.durationMs}ms` }}
                />
              </svg>
            ) : null}
            {stopAnimation && !isCompactBottomNav ? (
              <span
                key={`stop-bar-${stopAnimation.key}`}
                className="vdjv-stop-bar-deprogress pointer-events-none absolute inset-0 z-0 bg-[#B9FF12]/85"
                style={{ animationDuration: `${stopAnimation.durationMs}ms` }}
                aria-hidden="true"
              />
            ) : null}
            <span className="absolute inset-2 rounded-full bg-white/10" />
            <Square className={isCompactBottomNav ? 'relative z-10 h-6 w-6' : 'relative z-10 h-4 w-4'} />
            {!isCompactBottomNav && <span className="relative z-10 ml-2 text-xs">Stop</span>}
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={globalMuted}
            className={isCompactBottomNav ? compactNavButtonBase : cn(navButtonBase, 'w-full', globalMuted && 'border-red-400 text-red-500')}
            title={globalMuted ? 'Master output is muted. Click to unmute.' : 'Mute all sampler output.'}
          >
            {renderNavIcon(
              globalMuted ? <VolumeX className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} /> : <Volume2 className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} />,
              globalMuted ? 'bg-red-500' : undefined
            )}
            <span>{globalMuted ? 'Muted' : 'Mute'}</span>
          </button>

          {!isCompactBottomNav && (
            <button
              type="button"
              onClick={onToggleEditMode}
              className={cn(navButtonBase, 'w-full', editMode && 'border-amber-400 text-amber-500')}
              title={editMode ? 'Exit Edit Mode' : 'Edit pads'}
            >
              {renderNavIcon(<Pencil className="h-4 w-4" />, editMode ? 'bg-amber-400' : undefined)}
              <span>Edit</span>
            </button>
          )}

          <button
            type="button"
            onClick={channelLoadArmed ? onCancelChannelLoad : onToggleMixer}
            className={isCompactBottomNav ? compactNavButtonBase : cn(navButtonBase, 'w-full', (mixerOpen || channelLoadArmed) && 'border-emerald-400 text-emerald-500')}
          >
            {renderNavIcon(
              channelLoadArmed ? <X className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} /> : <Sliders className={isCompactBottomNav ? 'h-5 w-5' : 'h-4 w-4'} />,
              !channelLoadArmed && hasActiveDeckPlayback ? 'bg-emerald-400' : undefined
            )}
            <span>{channelLoadArmed ? 'Cancel' : 'Mixer'}</span>
          </button>

        </div>
      </div>

      {isCompactBottomNav && (
      <div className="fixed bottom-[calc(var(--vdjv-safe-bottom)+6.15rem)] right-3 z-40 flex flex-col-reverse gap-2">
        <Button
          type="button"
          onClick={onToggleEditMode}
          variant="outline"
          size="icon"
            className={cn(
              'shadow-lg',
              editMode
                ? 'border-amber-300 bg-amber-500 text-amber-950 hover:bg-amber-500'
                : theme === 'dark'
                  ? 'border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-950'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-white',
              'h-12 w-12 rounded-2xl'
            )}
          title={editMode ? 'Exit Edit Mode' : 'Edit pads'}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
      )}

      {isAdmin && (
        <div
          className={cn(
            'fixed left-3 z-40 flex flex-col-reverse gap-2',
            isCompactBottomNav ? 'bottom-[calc(var(--vdjv-safe-bottom)+6.15rem)]' : 'bottom-[calc(var(--vdjv-safe-bottom)+4.85rem)]'
          )}
        >
          <Button
            type="button"
            onClick={() => setAdminDialogOpen(true)}
            variant="outline"
            size="icon"
            className={cn('h-12 w-12 rounded-2xl shadow-lg', theme === 'dark' ? 'border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-950' : 'border-slate-200 bg-white text-slate-800 hover:bg-white')}
            title="Manage bank access"
          >
            <Shield className="h-4 w-4" />
          </Button>
          {isCompactBottomNav && adminPadColorPaintCanUndo && (
            <Button
              type="button"
              onClick={handleUndoPadColorPaint}
              variant="outline"
              size="icon"
              className={cn('h-12 w-12 rounded-2xl shadow-lg', theme === 'dark' ? 'border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-950' : 'border-slate-200 bg-white text-slate-800 hover:bg-white')}
              title="Undo last painted pad color"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {isAdmin && editMode && (
        <div
          className={cn(
            'fixed right-3 z-40',
            isCompactBottomNav ? 'bottom-[calc(var(--vdjv-safe-bottom)+9.65rem)]' : 'bottom-[calc(var(--vdjv-safe-bottom)+4.85rem)]'
          )}
        >
          <Button
            type="button"
            onClick={adminPadColorPaintActive ? handleStopPadColorPaint : handlePadColorPaintButton}
            variant="outline"
            size="icon"
            className={cn(
              'h-12 w-12 rounded-2xl shadow-lg',
              adminPadColorPaintActive
                ? 'border-red-300 bg-red-600 text-white hover:bg-red-600'
                : theme === 'dark'
                  ? 'border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-950'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-white'
            )}
            title={adminPadColorPaintActive ? 'Stop Color Paint Mode' : (padColorPaintBlockedReason || 'Color Paint Mode')}
          >
            <Palette className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isDualMode && (
        <Button
          type="button"
          onClick={onExitDualMode}
          variant="outline"
          size="sm"
          className={cn(
            'fixed left-1/2 z-50 h-8 -translate-x-1/2 rounded-full px-3 text-[11px] font-black shadow-lg',
            isCompactBottomNav ? 'bottom-[calc(var(--vdjv-safe-bottom)+5.95rem)]' : 'bottom-[calc(var(--vdjv-safe-bottom)+4.85rem)]',
            'h-10 px-4',
            theme === 'dark'
              ? 'border-amber-300/45 bg-slate-950/95 text-amber-100'
              : 'border-amber-200 bg-white/95 text-amber-700'
          )}
          title="Exit dual mode"
        >
          <X className="h-3.5 w-3.5" />
          Exit Dual
        </Button>
      )}

      {globalMuted && (
        <div className={cn(
          'fixed left-1/2 z-50 max-w-[92vw] -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg',
          isCompactBottomNav ? 'top-[calc(var(--vdjv-safe-top)+3.25rem)]' : 'bottom-[calc(var(--vdjv-safe-bottom)+6rem)]',
          theme === 'dark'
            ? 'border-red-400/50 bg-red-950 text-red-100'
            : 'border-red-300 bg-red-50 text-red-700'
        )}>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <VolumeX className="h-3.5 w-3.5 shrink-0" />
            <span>Master output muted</span>
          </div>
        </div>
      )}

      {(editMode || channelLoadArmed) && (
        <div className={cn(
          'fixed left-1/2 z-50 max-w-[92vw] -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg animate-pulse',
          isCompactBottomNav ? 'top-[calc(var(--vdjv-safe-top)+5.75rem)]' : 'bottom-[calc(var(--vdjv-safe-bottom)+8.25rem)]',
          channelLoadArmed && !editMode
            ? theme === 'dark'
              ? 'border-emerald-300/45 bg-emerald-950 text-emerald-100'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : theme === 'dark'
              ? 'border-amber-300/45 bg-amber-950 text-amber-100'
              : 'border-amber-300 bg-amber-50 text-amber-700'
        )}>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {editMode ? <Pencil className="h-3.5 w-3.5 shrink-0" /> : null}
            {channelLoadArmed ? <Sliders className="h-3.5 w-3.5 shrink-0" /> : null}
            <span>{editMode && channelLoadArmed ? 'Edit + Load mode' : editMode ? 'Edit mode' : 'Load mode'}</span>
          </div>
        </div>
      )}

      {isAdmin && adminPadColorPaintActive && adminPadColorPaintColor && (
        <div className={cn(
          'fixed left-1/2 top-[calc(var(--vdjv-safe-top)+3.25rem)] z-50 max-w-[92vw] -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-semibold shadow-lg',
          theme === 'dark'
            ? 'border-red-400/40 bg-red-950 text-red-100'
            : 'border-red-300 bg-red-50 text-red-700'
        )}>
          <div className="flex flex-wrap items-center gap-2">
            <Palette className="h-3.5 w-3.5" />
            <span>Color Paint Mode</span>
            <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/60" style={{ backgroundColor: adminPadColorPaintColor }} />
            <span>{getPadColorOptionLabel(adminPadColorPaintColor)}</span>
            <Button type="button" variant="outline" size="sm" onClick={handleStopPadColorPaint} className="h-7 rounded-full px-2 text-[11px]">
              Stop Paint
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showPadColorPaintDialog} onOpenChange={setShowPadColorPaintDialog}>
        <DialogContent className={theme === 'dark' ? 'border-gray-700 bg-gray-950 text-gray-100' : ''}>
          <DialogHeader>
            <DialogTitle>{adminPadColorPaintActive ? 'Change Paint Color' : 'Color Paint Mode'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              {adminPadColorPaintActive
                ? 'Choose a new paint color. Your next pad clicks will use it immediately.'
                : 'Select a pad color, then confirm to enter admin-only paint mode. Clicking pads will save the new color immediately.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(showAllPadColors ? [...PRIMARY_PAD_COLORS, ...EXTRA_PAD_COLORS] : PRIMARY_PAD_COLORS).map((colorOption) => (
                <button
                  key={colorOption.value}
                  type="button"
                  onClick={() => setPendingPadColor(colorOption.value)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    pendingPadColor === colorOption.value ? 'scale-110 border-white shadow-lg' : (theme === 'dark' ? 'border-gray-500' : 'border-gray-300')
                  }`}
                  style={{ backgroundColor: colorOption.value }}
                  title={colorOption.label}
                />
              ))}
              {EXTRA_PAD_COLORS.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setShowAllPadColors((prev) => !prev)}
                >
                  {showAllPadColors ? 'Less' : 'More'}
                </Button>
              )}
            </div>
            <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${theme === 'dark' ? 'border-gray-800 bg-gray-900/80' : 'border-gray-200 bg-gray-50'}`}>
              <span className="inline-block h-4 w-4 rounded-full border border-white/70" style={{ backgroundColor: pendingPadColor }} />
              <span className="text-sm font-medium">{getPadColorOptionLabel(pendingPadColor)}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/45 p-1">
              <Button type="button" variant="outline" onClick={() => setShowPadColorPaintDialog(false)}>
                Cancel
              </Button>
              <Button type="button" variant="success" onClick={handleConfirmPadColorPaint}>
                {adminPadColorPaintActive ? 'Apply Color' : 'Start Paint Mode'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isAdmin && adminDialogOpen && AdminAccessDialog && (
        <AdminAccessDialog
          open={adminDialogOpen}
          onOpenChange={setAdminDialogOpen}
          theme={theme}
          defaultBankSourceOptions={defaultBankSourceOptions}
          onPublishDefaultBankRelease={onPublishDefaultBankRelease}
        />
      )}

      {(settingsOpen || showLoginModal) && (
        <React.Suspense fallback={null}>
          <AppSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            displayName={displayName}
            version={appVersion}
            appUpdatePlatform={appUpdateState.platform}
            appUpdateEnabled={appUpdateState.enabled}
            appUpdateStatus={appUpdateState.status}
            appUpdateMessage={appUpdateState.message}
            appUpdateTargetVersion={appUpdateState.nextVersion}
            appUpdateCanCheck={appUpdateState.canCheck}
            appUpdateCanInstall={appUpdateState.canInstall}
            appUpdateBusy={appUpdateState.busy}
            appUpdateError={appUpdateState.lastError}
            onCheckForAppUpdates={checkForUpdates}
            onInstallAppUpdate={installUpdate}
            theme={theme}
            onToggleTheme={onToggleTheme}
            midiSupported={midiSupported}
            midiEnabled={midiEnabled}
            midiAccessGranted={midiAccessGranted}
            midiBackend={midiBackend}
            midiOutputSupported={midiOutputSupported}
            midiInputs={midiInputs}
            midiSelectedInputId={midiSelectedInputId}
            midiError={midiError}
            onRequestMidiAccess={onRequestMidiAccess}
            onSelectMidiInput={onSelectMidiInput}
            onToggleMidiEnabled={onToggleMidiEnabled}
            systemMappings={systemMappings}
            onUpdateSystemKey={onUpdateSystemKey}
            onResetSystemKey={onResetSystemKey}
            onUpdateSystemMidi={onUpdateSystemMidi}
            onUpdateSystemColor={onUpdateSystemColor}
            onSetMasterVolumeCC={onSetMasterVolumeCC}
            channelCount={channelCount}
            onChangeChannelCount={onChangeChannelCount}
            onUpdateChannelMapping={onUpdateChannelMapping}
            padBankShortcutKeys={padBankShortcutKeys}
            padBankMidiNotes={padBankMidiNotes}
            padBankMidiCCs={padBankMidiCCs}
            midiNoteAssignments={midiNoteAssignments}
            keyboardMappingEnabled={keyboardMappingEnabled}
            onToggleKeyboardMappingEnabled={onToggleKeyboardMappingEnabled}
            hideShortcutLabels={hideShortcutLabels}
            onToggleHideShortcutLabels={onToggleHideShortcutLabels}
            autoPadBankMapping={autoPadBankMapping}
            onToggleAutoPadBankMapping={onToggleAutoPadBankMapping}
            sidePanelMode={sidePanelMode}
            onChangeSidePanelMode={onChangeSidePanelMode}
            onResetAllSystemMappings={onResetAllSystemMappings}
            onClearAllSystemMappings={onClearAllSystemMappings}
            onResetAllChannelMappings={onResetAllChannelMappings}
            onClearAllChannelMappings={onClearAllChannelMappings}
            midiDeviceProfiles={midiDeviceProfiles}
            midiDeviceProfileId={midiDeviceProfileId}
            onSelectMidiDeviceProfile={onSelectMidiDeviceProfile}
            onExportMappings={onExportMappings}
            onImportMappings={onImportMappings}
            onImportSharedBank={onImportSharedBank}
            onExportAppBackup={onExportAppBackup}
            onRestoreAppBackup={onRestoreAppBackup}
            onRetryMissingMediaInCurrentBank={onRetryMissingMediaInCurrentBank}
            onRecoverMissingMediaFromBanks={onRecoverMissingMediaFromBanks}
            isDualMode={isDualMode}
            padSize={padSize}
            stopMode={stopMode}
            stopTimingOverrides={stopTimingOverrides}
            padSizeMin={minPadSize}
            padSizeMax={maxPadSize}
            onPadSizeChange={handlePadSizeFromDialog}
            onStopModeChange={onStopModeChange}
            onStopTimingOverridesChange={onStopTimingOverridesChange}
            defaultTriggerMode={defaultTriggerMode}
            onDefaultTriggerModeChange={onDefaultTriggerModeChange}
            graphicsProfile={graphicsProfile}
            effectiveTierLabel={effectiveGraphicsTierLabel}
            onGraphicsProfileChange={onGraphicsProfileChange}
            isAuthenticated={isAuthenticated}
            authTransitionStatus={authTransition.status}
            onSignOut={handleSignOut}
          />

          <LoginModal
            open={showLoginModal}
            onOpenChange={setShowLoginModal}
            theme={theme}
            pushNotice={pushNotice}
          />
        </React.Suspense>
      )}

      {upgradeOpen && (
        <React.Suspense fallback={null}>
          <AccountUpgradeDialog
            open={upgradeOpen}
            onOpenChange={setUpgradeOpen}
            theme={theme}
            pushNotice={pushNotice}
          />
        </React.Suspense>
      )}

      <Dialog open={showOfflineReadyDialog} onOpenChange={setShowOfflineReadyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
              Offline Mode Is Ready
            </DialogTitle>
            <DialogDescription>
              Your last trusted account is saved on this device for offline use.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 text-sm leading-relaxed ${
              theme === 'dark'
                ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-50'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}>
              You can keep playing local banks and banks prepared for offline use without internet. Store downloads, account changes, sync, upgrades, and new online checks will resume when the connection returns.
            </div>
            <Button
              type="button"
              variant="success"
              className="w-full"
              onClick={() => setShowOfflineReadyDialog(false)}
            >
              Got It
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDisplayNamePrompt}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !savingDisplayNamePrompt) {
            dismissDisplayNamePrompt(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
              What should we call you?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              Set your display name or DJ name. This will be shown in your account and around the app.
            </p>
            <div className="space-y-2">
              <Label htmlFor="display-name-prompt" className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
                Display Name / DJ Name
              </Label>
              <Input
                id="display-name-prompt"
                value={displayNamePromptValue}
                onChange={(event) => setDisplayNamePromptValue(event.target.value)}
                placeholder={getFallbackDisplayName(user?.email)}
                maxLength={50}
                autoFocus
                disabled={savingDisplayNamePrompt}
              />
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/45 p-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => dismissDisplayNamePrompt(true)}
                disabled={savingDisplayNamePrompt}
              >
                Later
              </Button>
              <Button
                type="button"
                variant="success"
                className="flex-1"
                onClick={() => void handleSaveDisplayNamePrompt()}
                disabled={savingDisplayNamePrompt}
              >
                {savingDisplayNamePrompt ? 'Saving...' : 'Save Name'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
