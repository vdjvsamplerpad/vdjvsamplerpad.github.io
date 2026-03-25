import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Menu, Pencil, Volume2, VolumeX, Square, Sliders, Shield, LogIn, X, Search, Palette, Undo2 } from 'lucide-react';
import type { SamplerBank, StopMode } from './types/sampler';
import { createPortal } from 'react-dom';
import { getCachedUser, useAuthActions, useAuthState } from '@/hooks/useAuth';
import type { SystemAction, SystemMappings } from '@/lib/system-mappings';
import type { MidiDeviceProfile } from '@/lib/midi/device-profiles';
import type { GraphicsProfile } from '@/lib/performance-monitor';
import type { DefaultBankSourceOption } from './AdminAccessDialog.shared';
import type { LoginModal as LoginModalType } from '@/components/auth/LoginModal';
import type { AboutDialog as AboutDialogType } from '@/components/ui/about-dialog';
import type { HeaderAdminDebugPanel as HeaderAdminDebugPanelType } from './HeaderAdminDebugPanel';
import { EXTRA_PAD_COLORS, PRIMARY_PAD_COLORS, getPadColorOptionLabel } from './padColorPalette';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { useStorePreviewBadge } from './hooks/useStorePreviewBadge';

const LoginModal = React.lazy(() => import('@/components/auth/LoginModal').then((module) => ({ default: module.LoginModal }))) as unknown as typeof LoginModalType;
const AboutDialog = React.lazy(() => import('@/components/ui/about-dialog').then((module) => ({ default: module.AboutDialog }))) as unknown as typeof AboutDialogType;
const HeaderAdminDebugPanel = React.lazy(() => import('./HeaderAdminDebugPanel').then((module) => ({ default: module.HeaderAdminDebugPanel }))) as unknown as typeof HeaderAdminDebugPanelType;


interface HeaderControlsProps {
  primaryBank: SamplerBank | null;
  secondaryBank: SamplerBank | null;
  currentBank: SamplerBank | null;
  isDualMode: boolean;
  padSize: number;
  stopMode: StopMode;
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
  defaultBankSourceOptions: DefaultBankSourceOption[];
  onPublishDefaultBankRelease: (
    bankId: string,
    options?: { releaseNotes?: string; minAppVersion?: string }
  ) => Promise<string>;
}

const LOGIN_GREETING_STORAGE_PREFIX = 'vdjv-login-greeting';
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

  const base = 'pointer-events-auto mt-3 rounded-lg border px-4 py-2 shadow-lg transition-all duration-300'
  const colors =
    notice.variant === 'success'
      ? (theme === 'dark' ? 'bg-green-600/90 border-green-500 text-white' : 'bg-green-600 text-white border-green-700')
      : notice.variant === 'error'
        ? (theme === 'dark' ? 'bg-red-600/90 border-red-500 text-white' : 'bg-red-600 text-white border-red-700')
        : (theme === 'dark' ? 'bg-gray-800/90 border-gray-700 text-white' : 'bg-gray-900 text-white border-gray-800')

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
  defaultBankSourceOptions,
  onPublishDefaultBankRelease,
}: HeaderControlsProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { user, profile, loading, authTransition } = useAuthState();
  const { signOut, updateDisplayName } = useAuthActions();
  const isAdmin = profile?.role === 'admin';
  const [adminDialogOpen, setAdminDialogOpen] = React.useState(false);
  const [AdminAccessDialog, setAdminAccessDialog] = React.useState<React.ComponentType<any> | null>(null);
  const [showLoginModal, setShowLoginModal] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [showPadColorPaintDialog, setShowPadColorPaintDialog] = React.useState(false);
  const [showAllPadColors, setShowAllPadColors] = React.useState(false);
  const [pendingPadColor, setPendingPadColor] = React.useState<string>(adminPadColorPaintColor || PRIMARY_PAD_COLORS[0]?.value || '#f59e0b');
  const [showDisplayNamePrompt, setShowDisplayNamePrompt] = React.useState(false);
  const [displayNamePromptValue, setDisplayNamePromptValue] = React.useState('');
  const [savingDisplayNamePrompt, setSavingDisplayNamePrompt] = React.useState(false);
  const appVersion = (import.meta as any).env?.VITE_APP_VERSION || 'unknown';
  const isElectronWindowControlsAvailable = typeof window !== 'undefined' && Boolean(window.electronAPI?.onFullscreenChange);
  const { state: appUpdateState, checkForUpdates, installUpdate } = useAppUpdate();

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
      setShowLoginModal(true);
      const reason = customEvent.detail?.reason;
      if (reason) {
        pushNotice({ variant: 'info', message: reason });
      }
    };
    window.addEventListener('vdjv-require-login', handleRequireLogin as EventListener);
    return () => window.removeEventListener('vdjv-require-login', handleRequireLogin as EventListener);
  }, [pushNotice]);

  React.useEffect(() => {
    const handleOpenAbout = () => setAboutOpen(true);
    window.addEventListener('vdjv-open-about', handleOpenAbout as EventListener);
    return () => window.removeEventListener('vdjv-open-about', handleOpenAbout as EventListener);
  }, []);

  React.useEffect(() => {
    const handleOpenSharedBankImport = () => {
      setAboutOpen(true);
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
  }, [adminPadColorPaintActive, onStopAdminPadColorPaint, onToggleSearch, pushNotice, searchOpen, windowWidth]);

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

  const handleSignOut = React.useCallback(async () => {
    if (authTransition.status === 'signing_out') return;
    const { error } = await signOut();
    if (error) {
      pushNotice({ variant: 'error', message: error.message || 'Sign out failed.' });
      return;
    }
    pushNotice({ variant: 'info', message: 'Signing out...' });
  }, [authTransition.status, signOut, pushNotice]);

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
  const mixerBadgeClass = theme === 'dark'
    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
    : 'border-emerald-300 bg-emerald-50 text-emerald-700';

  return (
    <>
      {/* Slide-down notifications */}
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        id="global-audio-upload-input"
      />

      <header
        className={`sticky top-0 z-40 text-center mb-2 backdrop-blur-sm ${theme === 'dark' ? 'bg-gray-900/70' : 'bg-white/70'
          }`}
      >
        <div className={`mb-1 text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
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
          {isDualMode ? (
            <div className="flex items-center justify-center gap-2 min-w-0 px-2 whitespace-nowrap">
              <span className="text-blue-600 font-medium shrink-0">Primary:</span>
              <span className="min-w-0 max-w-[26vw] sm:max-w-[32vw] truncate" title={primaryBank?.name || 'None'}>
                {primaryBank?.name || 'None'}
              </span>
              <span className="text-gray-400">|</span>
              <span className="text-purple-600 font-medium shrink-0">Secondary (SHIFT):</span>
              <span className="min-w-0 max-w-[26vw] sm:max-w-[32vw] truncate" title={secondaryBank?.name || 'None'}>
                {secondaryBank?.name || 'None'}
              </span>
            </div>
          ) : (
            <span className="inline-block max-w-[90vw] truncate align-middle" title={getBankDisplayName()}>
              Bank: {getBankDisplayName()}
            </span>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-2">
          {/* Banks Menu Button */}
          <Button
            onClick={onToggleSideMenu}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`relative ${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${sideMenuOpen
              ? theme === 'dark'
                ? 'bg-indigo-500 border-indigo-400 text-indigo-300'
                : 'bg-indigo-50 border-indigo-300 text-indigo-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-indigo-500 hover:border-indigo-400 hover:text-indigo-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600'
              }`}
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
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${theme === 'dark'
              ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-teal-500 hover:border-teal-400 hover:text-teal-300'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-600'
              }`}
          >
            <Upload className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Upload')}
          </Button>

          {/* Edit Mode Toggle */}
          <Button
            onClick={onToggleEditMode}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${editMode
              ? theme === 'dark'
                ? 'bg-orange-500 border-orange-400 text-orange-300'
                : 'bg-orange-50 border-orange-300 text-orange-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-orange-500 hover:border-orange-400 hover:text-orange-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-orange-50 hover:border-orange-300 hover:text-orange-600'
              }`}
          >
            <Pencil className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : editMode ? 'Exit Edit' : 'Edit')}
          </Button>

          {isAdmin && editMode && (
            <Button
              onClick={handlePadColorPaintButton}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={`${isMobileScreen ? 'w-10' : 'w-28'} transition-all duration-200 ${
                adminPadColorPaintActive
                  ? theme === 'dark'
                    ? 'bg-fuchsia-500 border-fuchsia-400 text-fuchsia-100'
                    : 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700'
                  : theme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-fuchsia-500 hover:border-fuchsia-400 hover:text-fuchsia-100'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-fuchsia-50 hover:border-fuchsia-300 hover:text-fuchsia-700'
              }`}
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
              className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${
                theme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-slate-500 hover:border-slate-400 hover:text-white'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
              }`}
              title="Undo last painted pad color"
            >
              <Undo2 className="w-4 h-4" />
              {!isMobileScreen && 'Undo'}
            </Button>
          )}

          {/* Search Button */}
          <Button
            onClick={onToggleSearch}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${
              searchOpen
                ? theme === 'dark'
                  ? 'bg-cyan-500 border-cyan-400 text-cyan-100'
                  : 'bg-cyan-50 border-cyan-300 text-cyan-700'
                : theme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-cyan-500 hover:border-cyan-400 hover:text-cyan-100'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700'
            }`}
            title={isMobileScreen ? 'Search pads' : 'Search pads (Ctrl/Cmd+K)'}
          >
            <Search className="w-4 h-4" />
            {!isMobileScreen && 'Search'}
          </Button>

          {/* Mute/Unmute Button */}
          <Button
            onClick={onToggleMute}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            title={globalMuted ? 'Master output is muted. Click to unmute.' : 'Mute all sampler output.'}
            aria-pressed={globalMuted}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${globalMuted
              ? theme === 'dark'
                ? 'bg-red-500 border-red-400 text-red-300'
                : 'bg-red-50 border-red-300 text-red-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-purple-500 hover:border-purple-400 hover:text-purple-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600'
              }`}
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
            onClick={onStopAll}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${theme === 'dark'
              ? 'bg-red-500 border-red-400 text-red-400 hover:bg-red-600'
              : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
              }`}
          >
            <Square className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Stop All')}
          </Button>

          {/* Mixer Button */}
          <Button
            onClick={channelLoadArmed ? onCancelChannelLoad : onToggleMixer}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`relative ${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${channelLoadArmed
              ? theme === 'dark'
                ? 'bg-red-500/20 border-red-400 text-red-300 hover:bg-red-500/40'
                : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
              : mixerOpen
                ? theme === 'dark'
                  ? 'bg-green-500 border-green-400 text-green-300'
                  : 'bg-green-50 border-green-300 text-green-600'
                : theme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-green-500 hover:border-green-400 hover:text-green-300'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-green-50 hover:border-green-300 hover:text-green-600'
              }`}
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

          {/* Login Button (only shown when not logged in) */}
          {!loading && !isAuthenticated && (
            <Button
              onClick={() => {
                if (isSigningIn) return;
                setShowLoginModal(true);
              }}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              disabled={loading || isSigningIn}
              className={`w-24 transition-all duration-200 ${theme === 'dark'
                ? 'bg-blue-600/20 border-blue-500 text-blue-300 hover:bg-blue-500 hover:border-blue-400 hover:text-blue-200'
                : 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100 hover:border-blue-400 hover:text-blue-700'
                }`}
              title={isSigningIn ? 'Signing in...' : 'Sign in to your account'}
            >
              <LogIn className="w-4 h-4" />
              <span className="ml-1">{isSigningIn ? 'Wait' : 'Login'}</span>
            </Button>
          )}

          {/* Admin Access (admin-only) */}
          {isAdmin && (
            <Button
              onClick={() => setAdminDialogOpen(true)}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={`${isMobileScreen ? 'w-10' : 'w-40'} transition-all duration-200 ${theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-yellow-500 hover:border-yellow-400 hover:text-yellow-200'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-yellow-50 hover:border-yellow-300 hover:text-yellow-700'
                }`}
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
              className={`w-36 transition-all duration-200 ${
                theme === 'dark'
                  ? 'bg-amber-500/15 border-amber-400 text-amber-200 hover:bg-amber-500/30 hover:border-amber-300'
                  : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100 hover:border-amber-400'
              }`}
              title="Exit dual mode"
            >
              <X className="w-4 h-4" />
              <span>Exit Dual Mode</span>
            </Button>
          )}
        </div>

        {globalMuted && (
          <div className={`mx-auto mb-2 inline-flex max-w-[92vw] flex-wrap items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            theme === 'dark'
              ? 'border-red-400/50 bg-red-500/15 text-red-100'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}>
            <VolumeX className="h-3.5 w-3.5 shrink-0" />
            <span>Master output muted</span>
            <span className={theme === 'dark' ? 'text-red-100/80' : 'text-red-600/80'}>
              Pad taps still trigger, but no sound will come out until you unmute.
            </span>

          </div>
        )}

        {isAdmin && adminPadColorPaintActive && adminPadColorPaintColor && (
          <div className={`mx-auto mb-2 inline-flex max-w-[92vw] flex-wrap items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
            theme === 'dark'
              ? 'border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100'
              : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700'
          }`}>
            <Palette className="h-3.5 w-3.5" />
            <span>Color Paint Mode</span>
            <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/60" style={{ backgroundColor: adminPadColorPaintColor }} />
            <span>{getPadColorOptionLabel(adminPadColorPaintColor)}</span>
            <span className={theme === 'dark' ? 'text-fuchsia-200/80' : 'text-fuchsia-600/80'}>
              Click pads to recolor. Press Esc or stop paint to return to normal edit mode.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStopPadColorPaint}
              className={`h-7 px-2 text-[11px] ${
                theme === 'dark'
                  ? 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20'
                  : 'border-fuchsia-300 bg-white text-fuchsia-700 hover:bg-fuchsia-100'
              }`}
            >
              Stop Paint
            </Button>
          </div>
        )}
      </header>

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
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowPadColorPaintDialog(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleConfirmPadColorPaint}>
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

      {(aboutOpen || showLoginModal) && (
        <React.Suspense fallback={null}>
          <AboutDialog
            open={aboutOpen}
            onOpenChange={setAboutOpen}
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
            padSizeMin={minPadSize}
            padSizeMax={maxPadSize}
            onPadSizeChange={handlePadSizeFromDialog}
            onStopModeChange={onStopModeChange}
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

      <Dialog
        open={showDisplayNamePrompt}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !savingDisplayNamePrompt) {
            dismissDisplayNamePrompt(true);
          }
        }}
      >
        <DialogContent className={theme === 'dark' ? 'bg-gray-800 border-gray-600 sm:max-w-md' : 'bg-white border-gray-300 sm:max-w-md'}>
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
            <div className="flex gap-2">
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
