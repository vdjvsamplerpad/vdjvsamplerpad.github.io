import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Menu, Pencil, Volume2, VolumeX, Square, Sliders, Shield, LogIn, X, Search, Maximize2, Minimize2 } from 'lucide-react';
import type { SamplerBank, StopMode } from './types/sampler';
import { createPortal } from 'react-dom';
import { getCachedUser, useAuth } from '@/hooks/useAuth';
import type { SystemAction, SystemMappings } from '@/lib/system-mappings';
import type { MidiDeviceProfile } from '@/lib/midi/device-profiles';
import type { GraphicsProfile } from '@/lib/performance-monitor';
import type { DefaultBankSourceOption } from './AdminAccessDialog.shared';
import type { LoginModal as LoginModalType } from '@/components/auth/LoginModal';
import type { AboutDialog as AboutDialogType } from '@/components/ui/about-dialog';
import type { HeaderAdminDebugPanel as HeaderAdminDebugPanelType } from './HeaderAdminDebugPanel';

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
  searchOpen: boolean;
  channelLoadArmed: boolean;
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

// Slide-down notification UI used by the header.
type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string }

const getLocalGreetingDayKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function useNotices() {
  const [notices, setNotices] = React.useState<Notice[]>([])

  const pushNotice = React.useCallback((n: Omit<Notice, 'id'>) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now() + Math.random())
    const notice: Notice = { id, ...n }
    setNotices((arr) => [notice, ...arr])
    // Auto-dismiss after 4s.
    setTimeout(() => dismiss(id), 4000)
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setNotices((arr) => arr.filter((n) => n.id !== id))
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
      className={`${base} ${colors} ${show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'}`}
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
  searchOpen,
  channelLoadArmed,
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
  const { user, profile, loading, authTransition, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [adminDialogOpen, setAdminDialogOpen] = React.useState(false);
  const [AdminAccessDialog, setAdminAccessDialog] = React.useState<React.ComponentType<any> | null>(null);
  const [showLoginModal, setShowLoginModal] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [isElectronFullscreen, setIsElectronFullscreen] = React.useState(false);
  const appVersion = (import.meta as any).env?.VITE_APP_VERSION || 'unknown';
  const isElectronWindowControlsAvailable = typeof window !== 'undefined' && Boolean(window.electronAPI?.toggleFullscreen);

  // Dynamically load AdminAccessDialog only for admin users
  React.useEffect(() => {
    if (isAdmin && !AdminAccessDialog) {
      import('./AdminAccessDialog').then((module) => {
        setAdminAccessDialog(() => module.AdminAccessDialog);
      }).catch((error) => {
      });
    }
  }, [isAdmin, AdminAccessDialog]);

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
    if (!isElectronWindowControlsAvailable) return;
    let mounted = true;

    window.electronAPI?.getFullscreenState?.()
      .then((value) => {
        if (!mounted) return;
        setIsElectronFullscreen(Boolean(value));
      })
      .catch(() => {});

    const unsubscribe = window.electronAPI?.onFullscreenChange?.((next) => {
      if (!mounted) return;
      setIsElectronFullscreen(Boolean(next));
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
      const normalizedKey = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && normalizedKey === 'k') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        onToggleSearch();
        return;
      }
      if (normalizedKey === 'escape' && searchOpen) {
        onToggleSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleSearch, searchOpen, windowWidth]);

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

  const handleToggleElectronFullscreen = React.useCallback(() => {
    if (!isElectronWindowControlsAvailable) return;
    window.electronAPI?.toggleFullscreen?.()
      .then((next) => {
        setIsElectronFullscreen(Boolean(next));
      })
      .catch(() => {
        pushNotice({ variant: 'error', message: 'Could not change fullscreen mode.' });
      });
  }, [isElectronWindowControlsAvailable, pushNotice]);

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
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${sideMenuOpen
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

          {isElectronWindowControlsAvailable && (
            <Button
              onClick={handleToggleElectronFullscreen}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${
                isElectronFullscreen
                  ? theme === 'dark'
                    ? 'bg-emerald-500 border-emerald-400 text-emerald-100'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : theme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-emerald-500 hover:border-emerald-400 hover:text-emerald-100'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700'
              }`}
              title={isElectronFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isElectronFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              {!isMobileScreen && (isElectronFullscreen ? 'Exit Full' : 'Fullscreen')}
            </Button>
          )}

          {/* Mute/Unmute Button */}
          <Button
            onClick={onToggleMute}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
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
            {!isMobileScreen && (isMobileScreen ? '' : globalMuted ? 'Unmute' : 'Mute')}
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
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${channelLoadArmed
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
        </div>
      </header>

      {isAdmin && AdminAccessDialog && (
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
    </>
  );
}
