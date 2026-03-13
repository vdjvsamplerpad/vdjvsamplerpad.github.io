import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ExternalLink, LogOut } from 'lucide-react';
import { MidiInputInfo, MidiMessage } from '@/lib/midi';
import { MidiDeviceProfile } from '@/lib/midi/device-profiles';
import { DEFAULT_SYSTEM_MAPPINGS, SystemAction, SystemMappings, SYSTEM_ACTION_LABELS, ChannelMapping } from '@/lib/system-mappings';
import { normalizeShortcutKey } from '@/lib/keyboard-shortcuts';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { StopMode } from '@/components/sampler/types/sampler';
import type { GraphicsProfile } from '@/lib/performance-monitor';
import { edgeFunctionUrl } from '@/lib/edge-api';

const SYSTEM_COLOR_OPTIONS = [
  { name: 'Red', hex: '#ff0000' },
  { name: 'Orange', hex: '#ff5400' },
  { name: 'Warm Yellow', hex: '#ffbd6c' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Yellow Green', hex: '#bdff2d' },
  { name: 'Lime', hex: '#54ff00' },
  { name: 'Green', hex: '#00ff00' },
  { name: 'Cyan', hex: '#4cc3ff' },
  { name: 'Blue', hex: '#0000ff' },
  { name: 'Purple', hex: '#5400ff' },
  { name: 'Pink', hex: '#ff00ff' },
  { name: 'White', hex: '#ffffff' }
];

const SUPPORT_MESSENGER_URL_CACHE_KEY = 'vdjv-support-messenger-url';
const DEFAULT_SUPPORT_MESSENGER_URL = (
  ((import.meta as any).env?.VITE_SUPPORT_MESSENGER_URL as string | undefined) || ''
).trim();


interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  version: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  midiSupported: boolean;
  midiEnabled: boolean;
  midiAccessGranted: boolean;
  midiBackend: 'web' | 'native';
  midiOutputSupported: boolean;
  midiInputs: MidiInputInfo[];
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
  onUpdateChannelMapping: (channelIndex: number, updates: Partial<ChannelMapping>) => void;
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
  isDualMode: boolean;
  padSize: number;
  stopMode: StopMode;
  padSizeMin: number;
  padSizeMax: number;
  onPadSizeChange: (size: number) => void;
  onStopModeChange: (mode: StopMode) => void;
  defaultTriggerMode: 'toggle' | 'hold' | 'stutter' | 'unmute';
  onDefaultTriggerModeChange: (mode: 'toggle' | 'hold' | 'stutter' | 'unmute') => void;
  graphicsProfile: GraphicsProfile;
  effectiveTierLabel: string;
  onGraphicsProfileChange: (profile: GraphicsProfile) => void;
  isAuthenticated?: boolean;
  authTransitionStatus?: 'idle' | 'signing_in' | 'signing_out';
  onSignOut?: () => Promise<void> | void;
}

export function AboutDialog({
  open,
  onOpenChange,
  displayName,
  version,
  theme,
  onToggleTheme,
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
  isDualMode,
  padSize,
  stopMode,
  padSizeMin,
  padSizeMax,
  onPadSizeChange,
  onStopModeChange,
  defaultTriggerMode,
  onDefaultTriggerModeChange,
  graphicsProfile,
  effectiveTierLabel,
  onGraphicsProfileChange,
  isAuthenticated = false,
  authTransitionStatus = 'idle',
  onSignOut
}: AboutDialogProps) {
  const [midiLearnAction, setMidiLearnAction] = React.useState<
    | { type: 'system'; action: SystemAction }
    | { type: 'channel'; channelIndex: number; field?: keyof ChannelMapping }
    | { type: 'masterVolume' }
    | null
  >(null);
  const [activePanel, setActivePanel] = React.useState<'general' | 'system' | 'channels' | 'backup'>('general');
  const [systemMappingError, setSystemMappingError] = React.useState<string | null>(null);
  const [channelMappingError, setChannelMappingError] = React.useState<string | null>(null);
  const [mappingNotice, setMappingNotice] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [backupNotice, setBackupNotice] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = React.useState(false);
  const [showBackupExportConfirm, setShowBackupExportConfirm] = React.useState(false);
  const [showBackupExportRiskConfirm, setShowBackupExportRiskConfirm] = React.useState(false);
  const [pendingBackupRiskMessage, setPendingBackupRiskMessage] = React.useState<string | null>(null);
  const [showBackupRestoreConfirm, setShowBackupRestoreConfirm] = React.useState(false);
  const [showRecoverModeDialog, setShowRecoverModeDialog] = React.useState(false);
  const [pendingRecoverAddAsNew, setPendingRecoverAddAsNew] = React.useState(false);
  const [pendingRestoreSelection, setPendingRestoreSelection] = React.useState<{
    manifestFile: File;
    companionFiles: File[];
  } | null>(null);
  const [backupProgressOpen, setBackupProgressOpen] = React.useState(false);
  const [backupProgress, setBackupProgress] = React.useState(0);
  const [backupProgressStatus, setBackupProgressStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [backupProgressType, setBackupProgressType] = React.useState<'export' | 'import'>('export');
  const [backupProgressTitle, setBackupProgressTitle] = React.useState('Preparing Backup');
  const [backupProgressDescription, setBackupProgressDescription] = React.useState('');
  const [backupProgressMessage, setBackupProgressMessage] = React.useState<string | undefined>(undefined);
  const [supportMessengerUrl, setSupportMessengerUrl] = React.useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem(SUPPORT_MESSENGER_URL_CACHE_KEY) || DEFAULT_SUPPORT_MESSENGER_URL;
    } catch {
      return DEFAULT_SUPPORT_MESSENGER_URL;
    }
  });
  const backupProgressTimerRef = React.useRef<number | null>(null);
  const backupBusy = backupProgressOpen && backupProgressStatus === 'loading';
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const backupRestoreInputRef = React.useRef<HTMLInputElement>(null);
  const sharedBankImportInputRef = React.useRef<HTMLInputElement>(null);
  const recoveryImportInputRef = React.useRef<HTMLInputElement>(null);
  const [inlineMappingErrors, setInlineMappingErrors] = React.useState<Record<string, string>>({});
  const inlineMappingErrorTimersRef = React.useRef<Map<string, number>>(new Map());

  const clearInlineMappingError = React.useCallback((fieldId: string) => {
    const timer = inlineMappingErrorTimersRef.current.get(fieldId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      inlineMappingErrorTimersRef.current.delete(fieldId);
    }
    setInlineMappingErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, []);

  const setInlineMappingError = React.useCallback((fieldId: string, message: string) => {
    const timer = inlineMappingErrorTimersRef.current.get(fieldId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    setInlineMappingErrors((prev) => ({ ...prev, [fieldId]: message }));
    const nextTimer = window.setTimeout(() => {
      inlineMappingErrorTimersRef.current.delete(fieldId);
      setInlineMappingErrors((prev) => {
        if (!prev[fieldId]) return prev;
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }, 2600);
    inlineMappingErrorTimersRef.current.set(fieldId, nextTimer);
  }, []);

  const getInlineMappingError = React.useCallback((fieldId: string) => inlineMappingErrors[fieldId] || null, [inlineMappingErrors]);

  React.useEffect(() => {
    if (!open) {
      setMidiLearnAction(null);
      setSystemMappingError(null);
      setChannelMappingError(null);
      setMappingNotice(null);
      setBackupNotice(null);
      setActivePanel('general');
      setShowSignOutConfirm(false);
      setShowBackupExportConfirm(false);
      setShowBackupExportRiskConfirm(false);
      setPendingBackupRiskMessage(null);
      setShowBackupRestoreConfirm(false);
      setShowRecoverModeDialog(false);
      setPendingRecoverAddAsNew(false);
      setPendingRestoreSelection(null);
      setBackupProgressOpen(false);
      setBackupProgress(0);
      setBackupProgressMessage(undefined);
      setInlineMappingErrors({});
      inlineMappingErrorTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      inlineMappingErrorTimersRef.current.clear();
      if (backupProgressTimerRef.current !== null) {
        window.clearInterval(backupProgressTimerRef.current);
        backupProgressTimerRef.current = null;
      }
    }
  }, [open]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const value = supportMessengerUrl.trim();
      if (value) {
        localStorage.setItem(SUPPORT_MESSENGER_URL_CACHE_KEY, value);
      } else {
        localStorage.removeItem(SUPPORT_MESSENGER_URL_CACHE_KEY);
      }
    } catch {
    }
  }, [supportMessengerUrl]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadSupportLink = async () => {
      try {
        const response = await fetch(edgeFunctionUrl('store-api', 'payment-config'));
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        const messengerUrl = typeof payload?.config?.messenger_url === 'string'
          ? payload.config.messenger_url.trim()
          : '';
        if (!cancelled) {
          setSupportMessengerUrl((prev) => messengerUrl || prev || DEFAULT_SUPPORT_MESSENGER_URL);
        }
      } catch {
      }
    };
    void loadSupportLink();
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!isAuthenticated && activePanel !== 'general') {
      setActivePanel('general');
    }
  }, [isAuthenticated, activePanel]);

  React.useEffect(() => {
    return () => {
      inlineMappingErrorTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      inlineMappingErrorTimersRef.current.clear();
      if (backupProgressTimerRef.current !== null) {
        window.clearInterval(backupProgressTimerRef.current);
        backupProgressTimerRef.current = null;
      }
    };
  }, []);

  const channelMappings = systemMappings.channelMappings || [];
  const activeChannelCount = Math.max(2, Math.min(8, Math.floor(channelCount || 4)));
  const activeChannelMappings = React.useMemo(
    () => channelMappings.slice(0, activeChannelCount),
    [activeChannelCount, channelMappings]
  );
  const visibleChannelMappings = React.useMemo(
    () => Array.from({ length: activeChannelCount }, (_, index) => channelMappings[index] || {}),
    [activeChannelCount, channelMappings]
  );
  const systemActionKeys = React.useMemo(() => Object.keys(SYSTEM_ACTION_LABELS) as SystemAction[], []);
  const midiNoteAssignmentMap = React.useMemo(() => {
    const map = new Map<number, { type: 'pad' | 'bank'; bankName: string; padName?: string }>();
    midiNoteAssignments.forEach((entry) => {
      if (!map.has(entry.note)) {
        map.set(entry.note, { type: entry.type, bankName: entry.bankName, padName: entry.padName });
      }
    });
    return map;
  }, [midiNoteAssignments]);

  const describeMidiNoteConflict = React.useCallback((
    note: number,
    options?: { excludeAction?: SystemAction; excludeChannelIndex?: number }
  ) => {
    const assignment = midiNoteAssignmentMap.get(note);
    if (assignment) {
      if (assignment.type === 'pad') {
        return `pad "${assignment.padName || 'Unnamed'}" in bank "${assignment.bankName}"`;
      }
      return `bank "${assignment.bankName}"`;
    }

    const systemAction = systemActionKeys.find(
      (action) => action !== options?.excludeAction && systemMappings[action]?.midiNote === note
    );
    if (systemAction) {
      return `system mapping "${SYSTEM_ACTION_LABELS[systemAction]}"`;
    }

    const channelIndex = activeChannelMappings.findIndex(
      (mapping, index) => index !== options?.excludeChannelIndex && mapping?.midiNote === note
    );
    if (channelIndex >= 0) {
      return `Channel ${channelIndex + 1} Stop`;
    }

    return null;
  }, [activeChannelMappings, midiNoteAssignmentMap, systemActionKeys, systemMappings]);

  const isSystemKeyUsed = React.useCallback(
    (key: string, excludeAction?: SystemAction) => {
      return systemActionKeys
        .filter((action) => action !== excludeAction)
        .some((action) => systemMappings[action]?.key === key);
    },
    [systemMappings, systemActionKeys]
  );

  const isChannelKeyUsed = React.useCallback(
    (key: string, excludeIndex?: number, excludeField?: 'keyUp' | 'keyDown' | 'keyStop') => {
      return activeChannelMappings.some((mapping, index) => {
        if (!mapping) return false;
        if (excludeIndex === index) {
          if (excludeField && mapping[excludeField] === key) return false;
        }
        return mapping.keyUp === key || mapping.keyDown === key || mapping.keyStop === key;
      });
    },
    [activeChannelMappings]
  );

  const isSystemMidiNoteUsed = React.useCallback(
    (note: number, excludeAction?: SystemAction) => {
      return systemActionKeys
        .filter((action) => action !== excludeAction)
        .some((action) => systemMappings[action]?.midiNote === note);
    },
    [systemMappings, systemActionKeys]
  );

  const isSystemMidiCCUsed = React.useCallback(
    (cc: number, excludeAction?: SystemAction) => {
      if (excludeAction !== undefined) {
        return systemActionKeys
          .filter((action) => action !== excludeAction)
          .some((action) => systemMappings[action]?.midiCC === cc);
      }
      return systemActionKeys.some((action) => systemMappings[action]?.midiCC === cc);
    },
    [systemMappings, systemActionKeys]
  );

  const isChannelMidiNoteUsed = React.useCallback(
    (note: number, excludeIndex?: number) => {
      return activeChannelMappings.some((mapping, index) => {
        if (!mapping || typeof mapping.midiNote !== 'number') return false;
        if (excludeIndex === index) return false;
        return mapping.midiNote === note;
      });
    },
    [activeChannelMappings]
  );

  const isChannelMidiCCUsed = React.useCallback(
    (cc: number, excludeIndex?: number) => {
      return activeChannelMappings.some((mapping, index) => {
        if (!mapping || typeof mapping.midiCC !== 'number') return false;
        if (excludeIndex === index) return false;
        return mapping.midiCC === cc;
      });
    },
    [activeChannelMappings]
  );

  React.useEffect(() => {
    if (!midiLearnAction) return;
    const handleMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;

      if (midiLearnAction.type === 'masterVolume') {
        if (detail.type === 'cc') {
          if (padBankMidiCCs.has(detail.cc) || isChannelMidiCCUsed(detail.cc) || isSystemMidiCCUsed(detail.cc)) {
            setChannelMappingError('That MIDI CC is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onSetMasterVolumeCC(detail.cc);
          setChannelMappingError(null);
          setMidiLearnAction(null);
        }
        return;
      }

      if (midiLearnAction.type === 'system') {
        if (detail.type === 'noteon') {
          if (padBankMidiNotes.has(detail.note) || isChannelMidiNoteUsed(detail.note) || isSystemMidiNoteUsed(detail.note, midiLearnAction.action)) {
            const conflict = describeMidiNoteConflict(detail.note, { excludeAction: midiLearnAction.action });
            setSystemMappingError(conflict ? `That MIDI note is already assigned to ${conflict}.` : 'That MIDI note is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateSystemMidi(midiLearnAction.action, detail.note, undefined);
          setSystemMappingError(null);
          setMidiLearnAction(null);
        } else if (detail.type === 'cc') {
          if (midiLearnAction.action === 'midiShift') {
            setSystemMappingError('MIDI Shift must use a MIDI note.');
            setMidiLearnAction(null);
            return;
          }
          if (padBankMidiCCs.has(detail.cc) || isChannelMidiCCUsed(detail.cc) || isSystemMidiCCUsed(detail.cc, midiLearnAction.action)) {
            setSystemMappingError('That MIDI CC is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateSystemMidi(midiLearnAction.action, undefined, detail.cc);
          setSystemMappingError(null);
          setMidiLearnAction(null);
        }
        return;
      }

      if (midiLearnAction.type === 'channel') {
        if (detail.type === 'cc') {
          if (padBankMidiCCs.has(detail.cc) || isSystemMidiCCUsed(detail.cc) || isChannelMidiCCUsed(detail.cc, midiLearnAction.channelIndex)) {
            setChannelMappingError('That MIDI CC is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateChannelMapping(midiLearnAction.channelIndex, { midiCC: detail.cc });
          setChannelMappingError(null);
          setMidiLearnAction(null);
          return;
        }
        if (detail.type === 'noteon') {
          if (padBankMidiNotes.has(detail.note) || isSystemMidiNoteUsed(detail.note) || isChannelMidiNoteUsed(detail.note, midiLearnAction.channelIndex)) {
            const conflict = describeMidiNoteConflict(detail.note, { excludeChannelIndex: midiLearnAction.channelIndex });
            setChannelMappingError(conflict ? `That MIDI note is already assigned to ${conflict}.` : 'That MIDI note is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateChannelMapping(midiLearnAction.channelIndex, { midiNote: detail.note });
          setChannelMappingError(null);
          setMidiLearnAction(null);
          return;
        }
        setMidiLearnAction(null);
      }
    };

    window.addEventListener('vdjv-midi', handleMidiEvent as EventListener);
    return () => window.removeEventListener('vdjv-midi', handleMidiEvent as EventListener);
  }, [
    midiLearnAction,
    onSetMasterVolumeCC,
    onUpdateSystemMidi,
    onUpdateChannelMapping,
    padBankMidiNotes,
    padBankMidiCCs,
    isChannelMidiNoteUsed,
    isChannelMidiCCUsed,
    isSystemMidiNoteUsed,
    isSystemMidiCCUsed,
    describeMidiNoteConflict
  ]);

  const handleKeyAssign = (action: SystemAction) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const fieldId = `system-${action}-key`;
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Escape') return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      onUpdateSystemKey(action, '');
      clearInlineMappingError(fieldId);
      setSystemMappingError(null);
      return;
    }
    const normalized = normalizeShortcutKey(event.key, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
    if (normalized) {
      if (systemMappings[action]?.key === normalized) {
        clearInlineMappingError(fieldId);
        setSystemMappingError(null);
        return;
      }
      if (padBankShortcutKeys.has(normalized) || isChannelKeyUsed(normalized) || isSystemKeyUsed(normalized, action)) {
        setInlineMappingError(fieldId, 'That key is already assigned.');
        return;
      }
      onUpdateSystemKey(action, normalized);
      clearInlineMappingError(fieldId);
      setSystemMappingError(null);
    }
  };

  const systemActions: SystemAction[] = [
    'stopAll',
    'mixer',
    'editMode',
    'banksMenu',
    'nextBank',
    'prevBank',
    'upload',
    'padSizeUp',
    'padSizeDown',
    'importBank',
    'activateSecondary',
    'midiShift'
  ];

  const handleChannelKeyAssign = (channelIndex: number, field: 'keyUp' | 'keyDown' | 'keyStop') =>
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const fieldId = `channel-${channelIndex}-${field}`;
      if (event.key === 'Tab') return;
      event.preventDefault();
      if (event.key === 'Escape') return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        onUpdateChannelMapping(channelIndex, { [field]: '' });
        clearInlineMappingError(fieldId);
        setChannelMappingError(null);
        return;
      }
      const normalized = normalizeShortcutKey(event.key, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        code: event.code
      });
      if (normalized) {
        const currentValue = channelMappings[channelIndex]?.[field];
        if (currentValue === normalized) {
          clearInlineMappingError(fieldId);
          setChannelMappingError(null);
          return;
        }
        if (padBankShortcutKeys.has(normalized) || isSystemKeyUsed(normalized) || isChannelKeyUsed(normalized, channelIndex, field)) {
          setInlineMappingError(fieldId, 'That key is already assigned.');
          return;
        }
        onUpdateChannelMapping(channelIndex, { [field]: normalized });
        clearInlineMappingError(fieldId);
        setChannelMappingError(null);
      }
    };

  const handleMasterKeyAssign = (field: 'volumeUp' | 'volumeDown' | 'mute') =>
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const fieldId = `master-${field}-key`;
      if (event.key === 'Tab') return;
      event.preventDefault();
      if (event.key === 'Escape') return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        onUpdateSystemKey(field, '');
        clearInlineMappingError(fieldId);
        setChannelMappingError(null);
        return;
      }
      const normalized = normalizeShortcutKey(event.key, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        code: event.code
      });
      if (normalized) {
        if (systemMappings[field]?.key === normalized) {
          clearInlineMappingError(fieldId);
          setChannelMappingError(null);
          return;
        }
        if (padBankShortcutKeys.has(normalized) || isChannelKeyUsed(normalized) || isSystemKeyUsed(normalized, field)) {
          setInlineMappingError(fieldId, 'That key is already assigned.');
          return;
        }
        onUpdateSystemKey(field, normalized);
        clearInlineMappingError(fieldId);
        setChannelMappingError(null);
      }
    };

  const handleExportMappings = React.useCallback(async () => {
    try {
      const message = await onExportMappings();
      setMappingNotice({ type: 'success', message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed.';
      setMappingNotice({ type: 'error', message });
    }
  }, [onExportMappings]);

  const handleImportClick = React.useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportMappings = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const message = await onImportMappings(file);
        setMappingNotice({ type: 'success', message });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed.';
        setMappingNotice({ type: 'error', message });
      }
    },
    [onImportMappings]
  );

  const beginBackupProgress = React.useCallback(
    (type: 'export' | 'import', title: string, description: string) => {
      if (backupProgressTimerRef.current !== null) {
        window.clearInterval(backupProgressTimerRef.current);
      }
      setBackupProgressType(type);
      setBackupProgressTitle(title);
      setBackupProgressDescription(description);
      setBackupProgressStatus('loading');
      setBackupProgressMessage(undefined);
      setBackupProgress(8);
      setBackupProgressOpen(true);
      backupProgressTimerRef.current = window.setInterval(() => {
        setBackupProgress((prev) => {
          if (prev >= 92) return prev;
          const step = prev < 40 ? 5 : prev < 70 ? 3 : 1;
          return Math.min(92, prev + step);
        });
      }, 350);
    },
    []
  );

  const endBackupProgress = React.useCallback(
    (status: 'success' | 'error', message: string) => {
      if (backupProgressTimerRef.current !== null) {
        window.clearInterval(backupProgressTimerRef.current);
        backupProgressTimerRef.current = null;
      }
      setBackupProgressStatus(status);
      setBackupProgress(100);
      setBackupProgressMessage(message);
    },
    []
  );

  const requestExportBackup = React.useCallback(() => {
    if (backupBusy) return;
    setShowBackupExportConfirm(true);
  }, [backupBusy]);

  const confirmExportBackup = React.useCallback(async () => {
    setShowBackupExportConfirm(false);
    beginBackupProgress('export', 'Exporting Full Backup', 'Creating encrypted app backup...');
    try {
      const message = await onExportAppBackup();
      setBackupNotice({ type: 'success', message });
      endBackupProgress('success', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup export failed.';
      if (message.includes('Not enough free storage for backup export')) {
        setBackupProgressOpen(false);
        setPendingBackupRiskMessage(message);
        setShowBackupExportRiskConfirm(true);
      } else {
        setBackupNotice({ type: 'error', message });
        endBackupProgress('error', message);
      }
    }
  }, [beginBackupProgress, endBackupProgress, onExportAppBackup]);

  const confirmExportBackupRisk = React.useCallback(async () => {
    setShowBackupExportRiskConfirm(false);
    beginBackupProgress(
      'export',
      'Exporting Full Backup (Risk Mode)',
      'Storage preflight is skipped. Keep the app open until export completes.'
    );
    try {
      const message = await onExportAppBackup({ riskMode: true });
      setBackupNotice({ type: 'success', message });
      endBackupProgress('success', message);
      setPendingBackupRiskMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup export failed.';
      setBackupNotice({ type: 'error', message });
      endBackupProgress('error', message);
    }
  }, [beginBackupProgress, endBackupProgress, onExportAppBackup]);

  const handleRestoreBackupClick = React.useCallback(() => {
    if (backupBusy) return;
    backupRestoreInputRef.current?.click();
  }, [backupBusy]);

  const handleImportSharedBankClick = React.useCallback(() => {
    if (backupBusy) return;
    sharedBankImportInputRef.current?.click();
  }, [backupBusy]);

  const handleRestoreBackup = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) return;

      const backupCandidates = files.filter((entry) =>
        /\.(vdjvbackup|vdjvpart|json)$/i.test(entry.name)
      );
      if (!backupCandidates.length) {
        setBackupNotice({
          type: 'error',
          message: 'Invalid selection. Pick a .vdjvbackup manifest (and .vdjvpart files if split).',
        });
        return;
      }

      const manifestFile =
        backupCandidates.find((entry) => entry.name.toLowerCase().endsWith('.vdjvbackup')) ||
        backupCandidates.find((entry) => entry.name.toLowerCase().endsWith('.json'));
      if (!manifestFile) {
        setBackupNotice({
          type: 'error',
          message: 'Manifest file missing. Select a .vdjvbackup file as the primary backup file.',
        });
        return;
      }

      const companionFiles = backupCandidates.filter(
        (entry) => entry !== manifestFile && entry.name.toLowerCase().endsWith('.vdjvpart')
      );
      setPendingRestoreSelection({ manifestFile, companionFiles });
      setShowBackupRestoreConfirm(true);
    },
    []
  );

  const confirmRestoreBackup = React.useCallback(async () => {
    const selection = pendingRestoreSelection;
    setShowBackupRestoreConfirm(false);
    if (!selection) return;

    const { manifestFile, companionFiles } = selection;
    const sourceLabel =
      companionFiles.length > 0
        ? `${manifestFile.name} + ${companionFiles.length} companion file(s)`
        : manifestFile.name;
    beginBackupProgress('import', 'Restoring Backup', `Restoring from ${sourceLabel}...`);
    try {
      const message = await onRestoreAppBackup(manifestFile, companionFiles);
      setBackupNotice({ type: 'success', message });
      endBackupProgress('success', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup restore failed.';
      setBackupNotice({ type: 'error', message });
      endBackupProgress('error', message);
    } finally {
      setPendingRestoreSelection(null);
    }
  }, [pendingRestoreSelection, beginBackupProgress, onRestoreAppBackup, endBackupProgress]);

  const handleRecoverClick = React.useCallback(() => {
    if (backupBusy) return;
    setShowRecoverModeDialog(true);
  }, [backupBusy]);

  const handleRecoverModeSelect = React.useCallback((addAsNewWhenNoTarget: boolean) => {
    setPendingRecoverAddAsNew(addAsNewWhenNoTarget);
    setShowRecoverModeDialog(false);
    window.setTimeout(() => {
      recoveryImportInputRef.current?.click();
    }, 0);
  }, []);

  const handleImportSharedBank = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      beginBackupProgress('import', 'Importing Shared Bank', `Importing ${file.name}...`);
      try {
        const message = await onImportSharedBank(file);
        setBackupNotice({ type: 'success', message });
        endBackupProgress('success', message);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shared bank import failed.';
        setBackupNotice({ type: 'error', message });
        endBackupProgress('error', message);
      }
    },
    [beginBackupProgress, endBackupProgress, onImportSharedBank]
  );

  const handleRetryMissingCurrentBank = React.useCallback(async () => {
    if (backupBusy) return;
    beginBackupProgress('import', 'Retrying Missing Media', 'Checking and restoring missing media in the active bank...');
    try {
      const message = await onRetryMissingMediaInCurrentBank();
      setBackupNotice({ type: 'success', message });
      endBackupProgress('success', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Retry failed.';
      setBackupNotice({ type: 'error', message });
      endBackupProgress('error', message);
    }
  }, [backupBusy, beginBackupProgress, endBackupProgress, onRetryMissingMediaInCurrentBank]);

  const handleRecoveryImport = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) return;
      const bankFiles = files.filter((entry) => /\.bank$/i.test(entry.name));
      if (!bankFiles.length) {
        setBackupNotice({ type: 'error', message: 'No valid .bank files selected.' });
        return;
      }
      const sourceLabel = bankFiles.length === 1 ? bankFiles[0].name : `${bankFiles.length} bank files`;
      beginBackupProgress('import', 'Recovering Missing Media', `Recovering from ${sourceLabel}...`);
      try {
        const message = await onRecoverMissingMediaFromBanks(files, {
          addAsNewWhenNoTarget: pendingRecoverAddAsNew,
        });
        setBackupNotice({ type: 'success', message });
        endBackupProgress('success', message);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Recovery import failed.';
        setBackupNotice({ type: 'error', message });
        endBackupProgress('error', message);
      } finally {
        setPendingRecoverAddAsNew(false);
      }
    },
    [beginBackupProgress, endBackupProgress, onRecoverMissingMediaFromBanks, pendingRecoverAddAsNew]
  );

  const confirmSignOut = React.useCallback(async () => {
    if (!onSignOut || isSigningOut) return;
    setIsSigningOut(true);
    try {
      await onSignOut();
    } catch {
      setIsSigningOut(false);
    }
  }, [onSignOut, isSigningOut, onOpenChange]);

  React.useEffect(() => {
    if (!isSigningOut) return;
    if (authTransitionStatus === 'signing_out') return;

    if (!isAuthenticated) {
      setShowSignOutConfirm(false);
      onOpenChange(false);
    }
    setIsSigningOut(false);
  }, [authTransitionStatus, isAuthenticated, isSigningOut, onOpenChange]);

  const showColorColumn = midiEnabled;
  const showMidiColumn = midiAccessGranted;
  const systemGridCols = showMidiColumn
    ? (showColorColumn ? 'sm:grid-cols-4' : 'sm:grid-cols-3')
    : (showColorColumn ? 'sm:grid-cols-3' : 'sm:grid-cols-2');
  const masterVolumeUpKeyError = getInlineMappingError('master-volumeUp-key');
  const masterVolumeDownKeyError = getInlineMappingError('master-volumeDown-key');
  const masterMuteKeyError = getInlineMappingError('master-mute-key');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-h-[92vh] overflow-hidden sm:max-w-4xl backdrop-blur-md bg-white/95 border-gray-300 dark:bg-gray-800/95 dark:border-gray-600">
        <DialogHeader className="pb-2 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle>Setting</DialogTitle>
          <DialogDescription>
            Configure app preferences, MIDI mappings, channel controls, and backup tools.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[calc(92vh-96px)] overflow-y-auto pr-1 text-sm">
          <div className={`grid gap-2 ${isAuthenticated ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'}`}>
            <Button type="button" variant={activePanel === 'general' ? 'default' : 'outline'} size="sm" onClick={() => setActivePanel('general')}>General</Button>
            {isAuthenticated && (
              <Button type="button" variant={activePanel === 'system' ? 'default' : 'outline'} size="sm" onClick={() => setActivePanel('system')}>System Shortcut</Button>
            )}
            {isAuthenticated && (
              <Button type="button" variant={activePanel === 'channels' ? 'default' : 'outline'} size="sm" onClick={() => setActivePanel('channels')}>Channels Shortcut</Button>
            )}
            {isAuthenticated && (
              <Button type="button" variant={activePanel === 'backup' ? 'default' : 'outline'} size="sm" onClick={() => setActivePanel('backup')}>Backup</Button>
            )}
          </div>

          {activePanel === 'general' && (
            <>
              <div className="rounded-lg border p-3 space-y-3 bg-gray-50/60 dark:bg-gray-900/30">
                <div className="text-xs uppercase tracking-wide text-gray-500">General Settings</div>
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Theme</Label>
                    <p className="text-[10px] text-gray-500">Enable = Light, Disable = Dark.</p>
                  </div>
                  <Switch
                    checked={theme === 'light'}
                    onCheckedChange={(checked) => {
                      if (checked && theme !== 'light') onToggleTheme();
                      if (!checked && theme !== 'dark') onToggleTheme();
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Side Panel Behavior</Label>
                    <p className="text-[10px] text-gray-500">Enable = Reflow, Disable = Overlay.</p>
                  </div>
                  <Switch
                    checked={sidePanelMode === 'reflow'}
                    onCheckedChange={(checked) => onChangeSidePanelMode(checked ? 'reflow' : 'overlay')}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Graphics</Label>
                  <p className="text-[10px] text-gray-500">Auto chooses device tier. Lowest is the most aggressive low-lag mode. High restores full motion.</p>
                  <Select value={graphicsProfile} onValueChange={(value) => onGraphicsProfileChange(value as GraphicsProfile)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="lowest">Lowest</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-gray-500">Effective: {effectiveTierLabel}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <Label className="text-xs font-medium">Pad size</Label>
                        <p className="text-[10px] text-gray-500">Portrait supports up to 8 columns. Landscape supports up to 16.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => onPadSizeChange(padSize - (isDualMode ? 2 : 1))}
                          disabled={padSize <= padSizeMin}
                        >
                          -
                        </Button>
                        <span className="w-16 text-center text-xs font-medium">
                          {padSize}/{padSizeMax}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => onPadSizeChange(padSize + (isDualMode ? 2 : 1))}
                          disabled={padSize >= padSizeMax}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Stop Mode</Label>
                  <p className="text-[10px] text-gray-500">Choose how pads stop playback when toggled off.</p>
                  <Select value={stopMode} onValueChange={(value) => onStopModeChange(value as StopMode)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instant">Instant Stop</SelectItem>
                      <SelectItem value="fadeout">Fade Out</SelectItem>
                      <SelectItem value="brake">Brake</SelectItem>
                      <SelectItem value="backspin">Backspin</SelectItem>
                      <SelectItem value="filter">Filter Sweep</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Default Trigger Mode</Label>
                  <p className="text-[10px] text-gray-500">Applied only to newly loaded audio pads.</p>
                  <Select value={defaultTriggerMode} onValueChange={(value) => onDefaultTriggerModeChange(value as 'toggle' | 'hold' | 'stutter' | 'unmute')}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toggle">Toggle</SelectItem>
                      <SelectItem value="hold">Hold</SelectItem>
                      <SelectItem value="stutter">Stutter</SelectItem>
                      <SelectItem value="unmute">Unmute</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-3 bg-gray-50/60 dark:bg-gray-900/30">
                <div className="text-xs uppercase tracking-wide text-gray-500">Input & Mapping</div>
                {!midiSupported && (
                  <p className="text-xs text-red-500">Web MIDI not supported in this browser.</p>
                )}
                {midiSupported && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">Enable MIDI Input</Label>
                      <p className="text-[10px] text-gray-500">Turn on MIDI controller input and mapping support.</p>
                    </div>
                    <Switch checked={midiEnabled} onCheckedChange={onToggleMidiEnabled} disabled={!midiSupported} />
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Enable Keyboard Mapping</Label>
                    <p className="text-[10px] text-gray-500">Turn on keyboard-triggered bank, pad, and system mappings.</p>
                  </div>
                  <Switch checked={keyboardMappingEnabled} onCheckedChange={onToggleKeyboardMappingEnabled} />
                </div>
                {keyboardMappingEnabled && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">Hide Keyboard Shortcut</Label>
                      <p className="text-[10px] text-gray-500">Hide key labels on pad buttons for a cleaner look.</p>
                    </div>
                    <Switch checked={hideShortcutLabels} onCheckedChange={onToggleHideShortcutLabels} />
                  </div>
                )}
                {!keyboardMappingEnabled && (
                  <div className="rounded-md border border-dashed px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    Keyboard shortcut labels stay hidden while keyboard mapping is disabled.
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Auto Pad & Bank Mapping</Label>
                    <p className="text-[10px] text-gray-500">Fill missing default keyboard mappings on new, imported, or duplicated content without overwriting existing assignments.</p>
                  </div>
                  <Switch checked={autoPadBankMapping} onCheckedChange={onToggleAutoPadBankMapping} />
                </div>
                {midiSupported && midiEnabled && midiAccessGranted && (
                  <div className="space-y-2 border-t pt-3 border-gray-200 dark:border-gray-700">
                    <div className="text-[10px] text-gray-500">
                      Backend: {midiBackend === 'native' ? 'Native MIDI' : 'Web MIDI'}
                      {!midiOutputSupported && (
                        <span className="ml-2 text-red-500">LED output not available</span>
                      )}
                    </div>
                    {midiError && <p className="text-xs text-red-500">{midiError}</p>}
                    <div className="space-y-1">
                      <Label className="text-xs">MIDI Input</Label>
                      <Select
                        value={midiSelectedInputId || ''}
                        onValueChange={(value) => onSelectMidiInput(value || null)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select device" />
                        </SelectTrigger>
                        <SelectContent>
                          {midiInputs.length === 0 && (
                            <SelectItem value="none" disabled>
                              No MIDI inputs
                            </SelectItem>
                          )}
                          {midiInputs.map((input) => (
                            <SelectItem key={input.id} value={input.id}>
                              {input.name || input.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Device Profile</Label>
                      <Select
                        value={midiDeviceProfileId || '__auto__'}
                        onValueChange={(value) => onSelectMidiDeviceProfile(value === '__auto__' ? null : value)}
                        disabled={!midiOutputSupported}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Auto-detect" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">Auto-detect</SelectItem>
                          {midiDeviceProfiles.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {profile.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border p-3 bg-gray-50/60 dark:bg-gray-900/30">
                  <div className="text-xs uppercase tracking-wide text-gray-500">User</div>
                  <div className="font-medium">{displayName}</div>
                </div>
                <div className="rounded-lg border p-3 bg-gray-50/60 dark:bg-gray-900/30">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Version</div>
                  <div className="font-medium">{version}</div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-900/20 p-3 space-y-2">
                <div className="text-xs uppercase tracking-wide text-blue-600 dark:text-blue-300">Support</div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-blue-400 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-600 dark:text-blue-300 dark:hover:bg-blue-900/40 dark:hover:text-blue-200 disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!supportMessengerUrl) return;
                    window.open(supportMessengerUrl, '_blank', 'noopener,noreferrer');
                  }}
                  disabled={!supportMessengerUrl}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {supportMessengerUrl ? 'Message us on Facebook' : 'Loading support link...'}
                </Button>
              </div>

              {isAuthenticated && onSignOut && (
                <div className="rounded-lg border border-red-300 bg-red-50/60 dark:border-red-700 dark:bg-red-900/20 p-3 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-red-600 dark:text-red-300">Account</div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-red-400 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-600 dark:text-red-300 dark:hover:bg-red-900/40 dark:hover:text-red-200"
                    onClick={() => setShowSignOutConfirm(true)}
                    disabled={isSigningOut}
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    {isSigningOut ? 'Signing out...' : 'Sign Out'}
                  </Button>
                </div>
              )}
            </>
          )}
          {isAuthenticated && activePanel === 'system' && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs uppercase tracking-wide text-gray-500">System Mapping</div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onResetAllSystemMappings}>
                    Reset All
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onClearAllSystemMappings}>
                    Clear All
                  </Button>
                </div>
              </div>
              {systemMappingError && (
                <div className="text-xs text-red-500">{systemMappingError}</div>
              )}
              <div className="space-y-2 sm:hidden">
                {systemActions.map((action) => {
                  const mapping = systemMappings[action] as SystemMappings[SystemAction] & { color?: string };
                  const hasMidi = mapping.midiNote !== undefined || mapping.midiCC !== undefined;
                  const keyFieldId = `system-${action}-key`;
                  const keyFieldError = getInlineMappingError(keyFieldId);
                  return (
                    <div key={`mobile-${action}`} className="rounded-md border p-2 space-y-2">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{SYSTEM_ACTION_LABELS[action]}</div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-gray-500">Keyboard</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            value={mapping.key || ''}
                            onKeyDown={handleKeyAssign(action)}
                            placeholder={DEFAULT_SYSTEM_MAPPINGS[action].key}
                            readOnly
                            className={`h-8 text-xs ${keyFieldError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-[10px]"
                            onClick={() => {
                              onResetSystemKey(action);
                              onUpdateSystemMidi(action, undefined, undefined);
                            }}
                          >
                            Reset
                          </Button>
                        </div>
                        {keyFieldError && (
                          <p className="text-[10px] text-red-500">{keyFieldError}</p>
                        )}
                      </div>
                      {showColorColumn && (
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-gray-500">Color</Label>
                          <Select
                            value={mapping.color || '__none__'}
                            onValueChange={(value) => onUpdateSystemColor(action, value === '__none__' ? undefined : value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {SYSTEM_COLOR_OPTIONS.map((entry) => (
                                <SelectItem key={entry.name} value={entry.hex}>
                                  {entry.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {showMidiColumn && (
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-gray-500">MIDI</Label>
                          <div className="flex items-center gap-2">
                            {!hasMidi && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-[10px]"
                                onClick={() => setMidiLearnAction({ type: 'system', action })}
                              >
                                {midiLearnAction?.type === 'system' && midiLearnAction.action === action ? 'Listening...' : 'Learn'}
                              </Button>
                            )}
                            {hasMidi && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-[10px]"
                                onClick={() => {
                                  onUpdateSystemMidi(action, undefined, undefined);
                                  setSystemMappingError(null);
                                }}
                              >
                                Clear
                              </Button>
                            )}
                            <span className="text-xs text-gray-500">
                              {mapping.midiNote !== undefined
                                ? `Note ${mapping.midiNote}`
                                : mapping.midiCC !== undefined
                                  ? `CC ${mapping.midiCC}`
                                  : '-'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={`hidden sm:grid gap-2 text-xs font-medium text-gray-500 grid-cols-1 ${systemGridCols}`}>
                <div>Function</div>
                <div>Keyboard</div>
                {showColorColumn && <div>Color</div>}
                {showMidiColumn && <div>MIDI</div>}
              </div>
              {systemActions.map((action) => {
                const mapping = systemMappings[action] as SystemMappings[SystemAction] & { color?: string };
                const hasMidi = mapping.midiNote !== undefined || mapping.midiCC !== undefined;
                const keyFieldId = `system-${action}-key`;
                const keyFieldError = getInlineMappingError(keyFieldId);
                return (
                  <div key={action} className={`hidden sm:grid gap-2 items-center grid-cols-1 ${systemGridCols}`}>
                    <div className="text-xs text-gray-700 dark:text-gray-200">{SYSTEM_ACTION_LABELS[action]}</div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={mapping.key || ''}
                        onKeyDown={handleKeyAssign(action)}
                        placeholder={DEFAULT_SYSTEM_MAPPINGS[action].key}
                        readOnly
                        className={`h-7 text-xs ${keyFieldError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => {
                          onResetSystemKey(action);
                          onUpdateSystemMidi(action, undefined, undefined);
                        }}
                      >
                        Reset
                      </Button>
                      {keyFieldError && (
                        <p className="text-[10px] text-red-500">{keyFieldError}</p>
                      )}
                    </div>
                    {showColorColumn && (
                      <Select
                        value={mapping.color || '__none__'}
                        onValueChange={(value) => onUpdateSystemColor(action, value === '__none__' ? undefined : value)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="-" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {SYSTEM_COLOR_OPTIONS.map((entry) => (
                            <SelectItem key={entry.name} value={entry.hex}>
                              {entry.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {showMidiColumn && (
                      <div className="flex items-center gap-2">
                        {!hasMidi && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => setMidiLearnAction({ type: 'system', action })}
                          >
                            {midiLearnAction?.type === 'system' && midiLearnAction.action === action ? 'Listening...' : 'Learn'}
                          </Button>
                        )}
                        {hasMidi && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => {
                              onUpdateSystemMidi(action, undefined, undefined);
                              setSystemMappingError(null);
                            }}
                          >
                            Clear
                          </Button>
                        )}
                        <span className="text-xs text-gray-500">
                          {mapping.midiNote !== undefined
                            ? `Note ${mapping.midiNote}`
                            : mapping.midiCC !== undefined
                              ? `CC ${mapping.midiCC}`
                              : '-'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          )}
          {isAuthenticated && activePanel === 'channels' && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs uppercase tracking-wide text-gray-500">Channel Mapping</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 rounded-md border px-2 py-1">
                    <Label className="text-[10px] uppercase tracking-wide text-gray-500">Deck Channels</Label>
                    <Select
                      value={String(activeChannelCount)}
                      onValueChange={(value) => onChangeChannelCount(Number(value))}
                    >
                      <SelectTrigger className="h-7 w-[72px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 7 }, (_, idx) => idx + 2).map((count) => (
                          <SelectItem key={`channel-count-${count}`} value={String(count)}>
                            {count}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onResetAllChannelMappings}>
                    Reset All
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onClearAllChannelMappings}>
                    Clear All
                  </Button>
                </div>
              </div>
              {channelMappingError && (
                <div className="text-xs text-red-500">{channelMappingError}</div>
              )}
              <div className="space-y-4">
                {visibleChannelMappings.map((mapping, index) => {
                  const renderField = (
                    label: string,
                    keyField: keyof ChannelMapping,
                    midiField?: keyof ChannelMapping,
                    isCC: boolean = false
                  ) => {
                    const keyFieldId = `channel-${index}-${String(keyField)}`;
                    const keyError = getInlineMappingError(keyFieldId);
                    const midiValue = midiField ? mapping[midiField] : undefined;

                    return (
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-gray-500">{label}</Label>
                        <div className="flex flex-col gap-1.5">
                          <Input
                            value={String(mapping[keyField] || '')}
                            onKeyDown={handleChannelKeyAssign(index, keyField as any)}
                            placeholder="-"
                            readOnly
                            className={`h-7 text-xs ${keyError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          />
                          {keyError && <p className="text-[10px] text-red-500 mt-0.5">{keyError}</p>}

                          {showMidiColumn && midiField && (
                            <div className="flex items-center gap-1.5">
                              {midiValue === undefined ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-1.5 text-[10px]"
                                  onClick={() => setMidiLearnAction({ type: 'channel', channelIndex: index, field: midiField })}
                                >
                                  {midiLearnAction?.type === 'channel' && midiLearnAction.channelIndex === index && (midiLearnAction as any).field === midiField ? 'Listening...' : (isCC ? 'Learn CC' : 'Learn Note')}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-1.5 text-[10px]"
                                  onClick={() => {
                                    onUpdateChannelMapping(index, { [midiField]: undefined });
                                    setChannelMappingError(null);
                                  }}
                                >
                                  Clear
                                </Button>
                              )}
                              <span className="text-[10px] text-gray-500">{midiValue ?? '-'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div key={`channel-card-${index}`} className="rounded-lg border p-3 space-y-3 bg-gray-50/30 dark:bg-gray-900/10">
                      <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 border-b pb-2">CH {index + 1}</div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {renderField('Volume Up', 'keyUp')}
                        {renderField('Volume Down', 'keyDown')}
                        {renderField('Volume CC', 'keyUp', 'midiCC', true)}
                        {renderField('Stop', 'keyStop', 'midiStop')}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {renderField('Play/Pause', 'keyPlayPause', 'midiPlayPause')}
                        {renderField('Load Arm', 'keyLoadArm', 'midiLoadArm')}
                        {renderField('Cancel Load', 'keyCancelLoad', 'midiCancelLoad')}
                      </div>

                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase">Trigger Hotcues</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {renderField('Hotcue 1', 'keyHotcue1', 'midiHotcue1')}
                          {renderField('Hotcue 2', 'keyHotcue2', 'midiHotcue2')}
                          {renderField('Hotcue 3', 'keyHotcue3', 'midiHotcue3')}
                          {renderField('Hotcue 4', 'keyHotcue4', 'midiHotcue4')}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase">Set/Clear Hotcues</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {renderField('Set/Clear 1', 'keySetHotcue1', 'midiSetHotcue1')}
                          {renderField('Set/Clear 2', 'keySetHotcue2', 'midiSetHotcue2')}
                          {renderField('Set/Clear 3', 'keySetHotcue3', 'midiSetHotcue3')}
                          {renderField('Set/Clear 4', 'keySetHotcue4', 'midiSetHotcue4')}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="rounded-lg border p-3 space-y-3 bg-gray-50/50 dark:bg-gray-900/20">
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 border-b pb-2">Master Controls</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-gray-500">Volume Up</Label>
                      <Input
                        value={systemMappings.volumeUp.key || ''}
                        onKeyDown={handleMasterKeyAssign('volumeUp')}
                        placeholder={DEFAULT_SYSTEM_MAPPINGS.volumeUp.key}
                        readOnly
                        className={`h-7 text-xs ${masterVolumeUpKeyError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                      />
                      {masterVolumeUpKeyError && <p className="text-[10px] text-red-500 mt-1">{masterVolumeUpKeyError}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-gray-500">Volume Down</Label>
                      <Input
                        value={systemMappings.volumeDown.key || ''}
                        onKeyDown={handleMasterKeyAssign('volumeDown')}
                        placeholder={DEFAULT_SYSTEM_MAPPINGS.volumeDown.key}
                        readOnly
                        className={`h-7 text-xs ${masterVolumeDownKeyError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                      />
                      {masterVolumeDownKeyError && <p className="text-[10px] text-red-500 mt-1">{masterVolumeDownKeyError}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-gray-500">Mute</Label>
                      <div className="flex flex-col gap-1.5">
                        <Input
                          value={systemMappings.mute.key || ''}
                          onKeyDown={handleMasterKeyAssign('mute')}
                          placeholder={DEFAULT_SYSTEM_MAPPINGS.mute.key}
                          readOnly
                          className={`h-7 text-xs ${masterMuteKeyError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        />
                        {masterMuteKeyError && <p className="text-[10px] text-red-500">{masterMuteKeyError}</p>}
                        {showMidiColumn && (
                          <div className="flex items-center gap-1.5">
                            {systemMappings.mute.midiNote === undefined ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => setMidiLearnAction({ type: 'system', action: 'mute' })}
                              >
                                {midiLearnAction?.type === 'system' && midiLearnAction.action === 'mute' ? 'Listening...' : 'Learn Note'}
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => {
                                  onUpdateSystemMidi('mute', undefined, undefined);
                                  setChannelMappingError(null);
                                }}
                              >
                                Clear
                              </Button>
                            )}
                            <span className="text-[10px] text-gray-500">{systemMappings.mute.midiNote ?? '-'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {showMidiColumn && (
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-gray-500">Master Volume CC</Label>
                        <div className="flex flex-col gap-1.5">
                          <div className="h-7" /> {/* Spacer to align with Inputs */}
                          <div className="flex items-center gap-1.5">
                            {systemMappings.masterVolumeCC === undefined ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => setMidiLearnAction({ type: 'masterVolume' })}
                              >
                                {midiLearnAction?.type === 'masterVolume' ? 'Listening...' : 'Learn CC'}
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => onSetMasterVolumeCC(undefined)}
                              >
                                Clear
                              </Button>
                            )}
                            <span className="text-[10px] text-gray-500">{systemMappings.masterVolumeCC ?? '-'}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {isAuthenticated && activePanel === 'backup' && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-1 bg-gray-50/60 dark:bg-gray-900/30">
                <div className="text-xs uppercase tracking-wide text-gray-500">🎧🔥 About Us - VDJV Sampler Pad 🔥🎧</div>
                <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                  <p>Welcome, ka-Power! 💪</p>
                  <p>
                    <strong>VDJV Sampler Pad</strong> is a powerful and user-friendly DJ soundboard system designed for
                    hosts, DJs, event organizers, content creators, and anyone who wants to level up events and performances.
                  </p>
                  <p>
                    We are an independent development team focused on practical, affordable, and professional-grade sampler
                    pad solutions, especially tailored for the Filipino market.
                  </p>

                  <div>
                    <p className="font-semibold">🎛️ What Is VDJV Sampler Pad?</p>
                    <p className="mt-1">Customizable soundboard with ready-to-use banks such as:</p>
                    <p>🎶 Background Drops (Budots, Chacha, Beat Drops)</p>
                    <p>😂 Sound Effects (Laugh, Horn, DJ Voice, Anime)</p>
                    <p>🎂 Birthday & Event Sounds</p>
                    <p>🏆 Competition & Awarding</p>
                    <p>🎮 Games & Memes</p>
                    <p>🎄 Seasonal Events (Christmas, Graduation, Halloween)</p>
                    <p>🎵 TikTok Banks (2022-2025 Editions)</p>
                  </div>

                  <p>
                    🎤 At VDJV, this isn&apos;t just a sampler pad - it&apos;s a tool to make your events more dynamic,
                    engaging, and unforgettable.
                  </p>
                  <p>Thank you for your support, ka-Power! ⚡ More power! 💪🔥</p>
                </div>
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Mapping Backup</div>
                {mappingNotice && (
                  <div className={`text-xs ${mappingNotice.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                    {mappingNotice.message}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleExportMappings}>
                    Export Mappings
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleImportClick}>
                    Import Mappings
                  </Button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={handleImportMappings}
                  />
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">App Backup</div>
                <p className="text-xs text-gray-500">
                  Encrypted account-bound full backup with banks, media, arrangement, settings, and mappings. Large exports may generate one manifest plus multiple part files.
                </p>
                {backupNotice && (
                  <div className={`text-xs ${backupNotice.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                    {backupNotice.message}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleImportSharedBankClick} disabled={backupBusy}>
                    Import Shared Bank
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={requestExportBackup} disabled={backupBusy}>
                    Export Full Backup
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleRestoreBackupClick} disabled={backupBusy}>
                    Restore from Backup
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleRetryMissingCurrentBank} disabled={backupBusy}>
                    Retry Missing (Current Bank)
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleRecoverClick} disabled={backupBusy}>
                    Recover Missing (.bank)
                  </Button>
                </div>
                <input
                  ref={backupRestoreInputRef}
                  type="file"
                  accept=".vdjvbackup,.vdjvpart,.json,application/octet-stream,application/json"
                  multiple
                  className="hidden"
                  onChange={handleRestoreBackup}
                />
                <input
                  ref={sharedBankImportInputRef}
                  type="file"
                  accept=".bank,application/zip,application/x-zip-compressed,application/octet-stream,*/*"
                  className="hidden"
                  onChange={handleImportSharedBank}
                />
                <input
                  ref={recoveryImportInputRef}
                  type="file"
                  accept=".bank,application/zip,application/octet-stream,*/*"
                  multiple
                  className="hidden"
                  onChange={handleRecoveryImport}
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
      <ProgressDialog
        open={backupProgressOpen}
        onOpenChange={setBackupProgressOpen}
        title={backupProgressTitle}
        description={backupProgressDescription}
        progress={backupProgress}
        status={backupProgressStatus}
        type={backupProgressType}
        theme={theme}
        errorMessage={backupProgressMessage}
        hideCloseButton
      />
      <ConfirmationDialog
        open={showBackupExportConfirm}
        onOpenChange={setShowBackupExportConfirm}
        title="Export Full Backup"
        description="Export encrypted full backup now? This can take time on large libraries."
        confirmText="Export Backup"
        onConfirm={confirmExportBackup}
        theme={theme}
      />
      <ConfirmationDialog
        open={showBackupExportRiskConfirm}
        onOpenChange={setShowBackupExportRiskConfirm}
        title="Export In Risk Mode?"
        description={pendingBackupRiskMessage
          ? `${pendingBackupRiskMessage} Continue anyway by skipping storage preflight? This may fail if the device runs out of space.`
          : 'Continue by skipping storage preflight? This may fail if the device runs out of space.'}
        confirmText="Continue Risk Mode"
        variant="destructive"
        onConfirm={confirmExportBackupRisk}
        theme={theme}
      />
      <ConfirmationDialog
        open={showBackupRestoreConfirm}
        onOpenChange={setShowBackupRestoreConfirm}
        title="Restore Backup"
        description={pendingRestoreSelection
          ? `Restore from "${pendingRestoreSelection.manifestFile.name}"${pendingRestoreSelection.companionFiles.length ? ` with ${pendingRestoreSelection.companionFiles.length} companion file(s)` : ''}? Current local data will be replaced.`
          : 'Restore selected backup now?'}
        confirmText="Restore Backup"
        variant="destructive"
        onConfirm={confirmRestoreBackup}
        theme={theme}
      />
      <Dialog open={showRecoverModeDialog} onOpenChange={setShowRecoverModeDialog}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Recover Missing Media</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-gray-600 dark:text-gray-300">
              Choose how recovery should handle `.bank` files that do not match an existing target bank.
            </p>
            <div className="grid gap-2">
              <Button type="button" onClick={() => handleRecoverModeSelect(false)}>
                Merge Only
              </Button>
              <Button type="button" variant="outline" onClick={() => handleRecoverModeSelect(true)}>
                Allow New Banks
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowRecoverModeDialog(false)}>
                Cancel
              </Button>
            </div>
            <div className="rounded-md border p-3 text-xs text-gray-500 dark:text-gray-400">
              <div><span className="font-medium text-gray-700 dark:text-gray-200">Merge Only:</span> safer, restores into matching banks only.</div>
              <div className="mt-1"><span className="font-medium text-gray-700 dark:text-gray-200">Allow New Banks:</span> creates a new bank when no target match is found.</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        open={showSignOutConfirm}
        onOpenChange={setShowSignOutConfirm}
        title="Sign out"
        description="Are you sure you want to sign out?"
        confirmText={isSigningOut ? 'Signing out...' : 'Sign out'}
        variant="destructive"
        onConfirm={confirmSignOut}
        theme={theme}
      />
    </Dialog>
  );
}
