import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Copy } from 'lucide-react';
import { SamplerBank, PadData } from './types/sampler';
import { useAuthState } from '@/hooks/useAuth';
import { isReservedShortcutCombo, normalizeShortcutKey, normalizeStoredShortcutKey, RESERVED_SHORTCUT_KEYS } from '@/lib/keyboard-shortcuts';
import { MidiMessage } from '@/lib/midi';
import { BankEditAdminExportDialog } from './BankEditAdminExportDialog';
import { BankEditUpdateStoreDialog } from './BankEditUpdateStoreDialog';
import { BankEditCoreForm } from './BankEditCoreForm';
import { bankColorOptions, extraBankColorOptions, formatBankEditDate, primaryBankColorOptions } from './bankEdit.shared';
import { isExplicitDefaultBankIdentity } from './hooks/useSamplerStore.bankIdentity';
import { validateManagedImageFile } from '@/lib/image-upload';
import { deleteBlobFromDB, saveBlobToDB } from './hooks/useSamplerStore.idbStorage';
import type { ExportAudioMode, LinkExistingStoreBankCandidate, UpdateStoreBankInput } from './hooks/useSamplerStore.types';
import type { BankPreparedSummary } from './hooks/preparedAudio';

const MAX_PROGRESS_LOG_LINES = 80;

const appendProgressLogLine = (
  setLines: React.Dispatch<React.SetStateAction<string[]>>,
  message: string,
) => {
  const nextMessage = message.trim();
  if (!nextMessage) return;
  setLines((prev) => {
    if (prev[prev.length - 1] === nextMessage) return prev;
    const next = [...prev, nextMessage];
    return next.length > MAX_PROGRESS_LOG_LINES ? next.slice(-MAX_PROGRESS_LOG_LINES) : next;
  });
};

interface BankEditDialogProps {
  bank: SamplerBank;
  allBanks: SamplerBank[];
  allPads: PadData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  onSave: (updates: Partial<SamplerBank>) => void;
  onApplyLocalBankUpdates?: (updates: Partial<SamplerBank>) => void;
  onDelete: () => void;
  onExport: () => void;
  onClearPadShortcuts?: () => void;
  onClearPadMidi?: () => void;
  onAdminThumbnailChange?: (thumbnail?: {
    thumbnailUrl?: string;
    thumbnailStorageKey?: string;
    thumbnailBackend?: 'native' | 'idb';
  }) => void | Promise<void>;
  onExportAdmin?: (
    id: string,
    title: string,
    description: string,
    addToDatabase: boolean,
    allowExport: boolean,
    publicCatalogAsset: boolean,
    exportMode: ExportAudioMode,
    thumbnailPath?: string,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  onUpdateStoreBank?: (input: UpdateStoreBankInput) => Promise<string>;
  onListLinkableStoreBanks?: () => Promise<LinkExistingStoreBankCandidate[]>;
  onLinkExistingStoreBank?: (runtimeBankId: string, candidate: LinkExistingStoreBankCandidate) => Promise<string>;
  onMoveToPosition?: (bankId: string, targetIndex: number) => void;
  onDuplicate?: (onProgress?: (progress: number) => void) => Promise<void> | void;
  preparedSummary?: BankPreparedSummary;
  onPrepareForLive?: (bankId: string) => Promise<void>;
  onCancelPrepareForLive?: (bankId?: string) => void;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
}

export function BankEditDialog({
  bank,
  allBanks,
  allPads,
  open,
  onOpenChange,
  theme,
  onSave,
  onApplyLocalBankUpdates,
  onDelete,
  onExport,
  onClearPadShortcuts,
  onClearPadMidi,
  onAdminThumbnailChange,
  onExportAdmin,
  onUpdateStoreBank,
  onListLinkableStoreBanks,
  onLinkExistingStoreBank,
  onMoveToPosition,
  onDuplicate,
  preparedSummary,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs
}: BankEditDialogProps) {
  type BankWithMidi = SamplerBank & { midiNote?: number; midiCC?: number };
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const canDeleteBank = !isExplicitDefaultBankIdentity(bank);
  const { profile } = useAuthState();
  const shouldShowPreparedPlaybackUi = profile?.role === 'admin';
  const [name, setName] = React.useState(bank.name);
  const [defaultColor, setDefaultColor] = React.useState(bank.defaultColor);
  const [shortcutKey, setShortcutKey] = React.useState(bank.shortcutKey || '');
  const [shortcutError, setShortcutError] = React.useState<string | null>(null);
  const [midiError, setMidiError] = React.useState<string | null>(null);
  const [midiNote, setMidiNote] = React.useState<number | undefined>((bank as BankWithMidi).midiNote);
  const [midiCC, setMidiCC] = React.useState<number | undefined>((bank as BankWithMidi).midiCC);
  const [midiLearnActive, setMidiLearnActive] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showAdminExport, setShowAdminExport] = React.useState(false);
  const [showStoreUpdateDialog, setShowStoreUpdateDialog] = React.useState(false);
  const [showStoreLinkDialog, setShowStoreLinkDialog] = React.useState(false);
  const [adminTitle, setAdminTitle] = React.useState(bank.name);
  const [adminDescription, setAdminDescription] = React.useState('');
  const [adminAddToDatabase, setAdminAddToDatabase] = React.useState(false);
  const [adminAllowExport, setAdminAllowExport] = React.useState(false);
  const [adminPublicCatalogAsset, setAdminPublicCatalogAsset] = React.useState(false);
  const [adminExportMode, setAdminExportMode] = React.useState<ExportAudioMode>('fast');
  const [showAdminExportProgress, setShowAdminExportProgress] = React.useState(false);
  const [adminExportProgress, setAdminExportProgress] = React.useState(0);
  const [adminExportStatus, setAdminExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [adminExportError, setAdminExportError] = React.useState<string>('');
  const [adminExportLogLines, setAdminExportLogLines] = React.useState<string[]>([]);
  const [storeUpdateTitle, setStoreUpdateTitle] = React.useState(bank.name);
  const [storeUpdateDescription, setStoreUpdateDescription] = React.useState(bank.bankMetadata?.description || '');
  const [storeUpdateSyncMetadata, setStoreUpdateSyncMetadata] = React.useState(true);
  const [storeUpdateProtection, setStoreUpdateProtection] = React.useState<'encrypted' | 'public'>(
    bank.bankMetadata?.password ? 'encrypted' : 'public'
  );
  const [storeUpdateExportMode, setStoreUpdateExportMode] = React.useState<ExportAudioMode>('fast');
  const [showStoreUpdateProgress, setShowStoreUpdateProgress] = React.useState(false);
  const [storeUpdateProgress, setStoreUpdateProgress] = React.useState(0);
  const [storeUpdateStatus, setStoreUpdateStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [storeUpdateError, setStoreUpdateError] = React.useState('');
  const [storeUpdateLogLines, setStoreUpdateLogLines] = React.useState<string[]>([]);
  const [storeLinkCandidates, setStoreLinkCandidates] = React.useState<LinkExistingStoreBankCandidate[]>([]);
  const [storeLinkQuery, setStoreLinkQuery] = React.useState('');
  const [storeLinkLoading, setStoreLinkLoading] = React.useState(false);
  const [storeLinkBusy, setStoreLinkBusy] = React.useState(false);
  const [storeLinkError, setStoreLinkError] = React.useState('');
  const [storeLinkNotice, setStoreLinkNotice] = React.useState('');
  const [selectedStoreLinkCatalogItemId, setSelectedStoreLinkCatalogItemId] = React.useState('');
  const [adminThumbnailFile, setAdminThumbnailFile] = React.useState<File | null>(null);
  const [adminThumbnailPreviewUrl, setAdminThumbnailPreviewUrl] = React.useState<string | null>(null);
  const [adminThumbnailUploading, setAdminThumbnailUploading] = React.useState(false);
  const [adminThumbnailError, setAdminThumbnailError] = React.useState<string>('');
  const [adminThumbnailNotice, setAdminThumbnailNotice] = React.useState<string>('');
  const [hideThumbnailPreview, setHideThumbnailPreview] = React.useState(Boolean(bank.bankMetadata?.hideThumbnailPreview));
  const orderedBanks = React.useMemo(
    () => [...allBanks].sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0)),
    [allBanks]
  );
  const currentBankPosition = React.useMemo(
    () => Math.max(0, orderedBanks.findIndex((entry) => entry.id === bank.id)),
    [bank.id, orderedBanks]
  );
  const [selectedBankPosition, setSelectedBankPosition] = React.useState(String(currentBankPosition));
  const [showDuplicateConfirm, setShowDuplicateConfirm] = React.useState(false);
  const [showDuplicateProgress, setShowDuplicateProgress] = React.useState(false);
  const [duplicateProgress, setDuplicateProgress] = React.useState(0);
  const [duplicateStatus, setDuplicateStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [duplicateError, setDuplicateError] = React.useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);
  const adminExportMilestoneRef = React.useRef(-1);
  const storeUpdateMilestoneRef = React.useRef(-1);

  React.useEffect(() => {
    if (profile?.role !== 'admin' || !showAdminExportProgress || adminExportStatus !== 'loading') return;
    const handleOperationDebug = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      if (detail.operation !== 'admin_bank_export') return;
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const opDetails = detail.details && typeof detail.details === 'object'
        ? detail.details as Record<string, unknown>
        : {};
      if (phase === 'heartbeat') {
        const idleText = typeof opDetails.sinceLastActivityMs === 'number'
          ? ` idle=${Math.round(opDetails.sinceLastActivityMs)}ms`
          : '';
        const lastStageText = typeof opDetails.lastStage === 'string' && opDetails.lastStage
          ? ` lastStage=${opDetails.lastStage}`
          : '';
        appendProgressLogLine(setAdminExportLogLines, `Heartbeat admin_bank_export${lastStageText}${idleText}`);
        return;
      }
      if (phase === 'error' && typeof opDetails.message === 'string') {
        appendProgressLogLine(setAdminExportLogLines, `admin_bank_export error: ${opDetails.message}`);
      }
    };
    window.addEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
    return () => window.removeEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
  }, [adminExportStatus, profile?.role, showAdminExportProgress]);

  React.useEffect(() => {
    if (profile?.role !== 'admin' || !showStoreUpdateProgress || storeUpdateStatus !== 'loading') return;
    const handleOperationDebug = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      if (detail.operation !== 'admin_bank_export') return;
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const opDetails = detail.details && typeof detail.details === 'object'
        ? detail.details as Record<string, unknown>
        : {};
      if (phase === 'heartbeat') {
        const idleText = typeof opDetails.sinceLastActivityMs === 'number'
          ? ` idle=${Math.round(opDetails.sinceLastActivityMs)}ms`
          : '';
        const lastStageText = typeof opDetails.lastStage === 'string' && opDetails.lastStage
          ? ` lastStage=${opDetails.lastStage}`
          : '';
        appendProgressLogLine(setStoreUpdateLogLines, `Heartbeat admin_bank_export${lastStageText}${idleText}`);
        return;
      }
      if (phase === 'error' && typeof opDetails.message === 'string') {
        appendProgressLogLine(setStoreUpdateLogLines, `admin_bank_export error: ${opDetails.message}`);
      }
    };
    window.addEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
    return () => window.removeEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
  }, [profile?.role, showStoreUpdateProgress, storeUpdateStatus]);

  React.useEffect(() => {
    if (open) {
      setName(bank.name);
      setDefaultColor(bank.defaultColor);
      setShortcutKey(bank.shortcutKey || '');
      setShortcutError(null);
      setMidiNote((bank as BankWithMidi).midiNote);
      setMidiCC((bank as BankWithMidi).midiCC);
      setMidiLearnActive(false);
      setMidiError(null);
      setAdminTitle(bank.name);
      setAdminDescription('');
      setAdminThumbnailFile(null);
      setAdminThumbnailUploading(false);
      setAdminThumbnailError('');
      setAdminThumbnailNotice('');
      setHideThumbnailPreview(Boolean(bank.bankMetadata?.hideThumbnailPreview));
      setSelectedBankPosition(String(currentBankPosition));
      setAdminAddToDatabase(false);
      setAdminAllowExport(true); // Default to true when Add to Database is disabled
      setAdminPublicCatalogAsset(false);
      setAdminExportMode('fast');
      setShowStoreUpdateDialog(false);
      setShowStoreLinkDialog(false);
      setStoreUpdateTitle(bank.name);
      setStoreUpdateDescription(bank.bankMetadata?.description || '');
      setStoreUpdateSyncMetadata(true);
      setStoreUpdateProtection(bank.bankMetadata?.password ? 'encrypted' : 'public');
      setStoreUpdateExportMode('fast');
      setShowStoreUpdateProgress(false);
      setStoreUpdateProgress(0);
      setStoreUpdateStatus('loading');
      setStoreUpdateError('');
      setStoreLinkCandidates([]);
      setStoreLinkQuery('');
      setStoreLinkLoading(false);
      setStoreLinkBusy(false);
      setStoreLinkError('');
      setStoreLinkNotice('');
      setSelectedStoreLinkCatalogItemId('');
      setAdminExportLogLines([]);
      setStoreUpdateLogLines([]);
      setShowDuplicateConfirm(false);
      setShowDuplicateProgress(false);
      setDuplicateProgress(0);
      setDuplicateStatus('loading');
      setDuplicateError('');
      setShowDiscardConfirm(false);
    }
  }, [bank.id, currentBankPosition, open]);

  React.useEffect(() => {
    if (!adminThumbnailFile) {
      setAdminThumbnailPreviewUrl(null);
      return;
    }

    const previewUrl = URL.createObjectURL(adminThumbnailFile);
    setAdminThumbnailPreviewUrl(previewUrl);
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [adminThumbnailFile]);

  const formatShortcutForDisplay = React.useCallback(
    (storedKey?: string | null) => {
      if (!storedKey) return null;
      if (!storedKey.includes('+')) {
        return normalizeShortcutKey(storedKey) || storedKey;
      }
      const parts = storedKey.split('+').map((part) => part.trim()).filter(Boolean);
      const modifiers = new Set<string>();
      let mainKey = '';
      parts.forEach((part) => {
        const lower = part.toLowerCase();
        if (lower === 'shift') modifiers.add('shift');
        else if (lower === 'ctrl' || lower === 'control') modifiers.add('ctrl');
        else if (lower === 'alt' || lower === 'option') modifiers.add('alt');
        else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') modifiers.add('meta');
        else mainKey = part;
      });
      const displayKey = normalizeShortcutKey(mainKey) || mainKey;
      if (isMac) {
        const order = ['meta', 'ctrl', 'alt', 'shift'] as const;
        const labels: Record<string, string> = { meta: 'Cmd', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
        const prefix = order.filter((key) => modifiers.has(key)).map((key) => labels[key]);
        return [...prefix, displayKey].filter(Boolean).join('+');
      }
      const order = ['ctrl', 'alt', 'shift', 'meta'] as const;
      const labels: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
      const prefix = order.filter((key) => modifiers.has(key)).map((key) => labels[key]);
      return [...prefix, displayKey].filter(Boolean).join('+');
    },
    [isMac]
  );

  React.useEffect(() => {
    if (!midiLearnActive) return;

    const handleMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;

      if (detail.type === 'noteon') {
        if (blockedMidiNotes?.has(detail.note)) {
          setMidiError('That MIDI note is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((otherBank) => {
          if (otherBank.id === bank.id) return false;
          const otherNote = (otherBank as BankWithMidi).midiNote;
          return typeof otherNote === 'number' && otherNote === detail.note;
        });
        if (duplicateBank) {
          setMidiError(`That MIDI note is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = allPads.find((pad) => typeof pad.midiNote === 'number' && pad.midiNote === detail.note);
        if (duplicatePad) {
          setMidiError(`That MIDI note is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiNote(detail.note);
      } else if (detail.type === 'cc') {
        if (blockedMidiCCs?.has(detail.cc)) {
          setMidiError('That MIDI CC is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((otherBank) => {
          if (otherBank.id === bank.id) return false;
          const otherCC = (otherBank as BankWithMidi).midiCC;
          return typeof otherCC === 'number' && otherCC === detail.cc;
        });
        if (duplicateBank) {
          setMidiError(`That MIDI CC is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = allPads.find((pad) => typeof pad.midiCC === 'number' && pad.midiCC === detail.cc);
        if (duplicatePad) {
          setMidiError(`That MIDI CC is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiCC(detail.cc);
      } else {
        return;
      }
      setMidiLearnActive(false);
    };

    window.addEventListener('vdjv-midi', handleMidiEvent as EventListener);
    return () => window.removeEventListener('vdjv-midi', handleMidiEvent as EventListener);
  }, [midiLearnActive, allBanks, allPads, bank, blockedMidiNotes, blockedMidiCCs]);

  const handleSave = () => {
    if (shortcutError) {
      return;
    }

    const nextBankMetadata = bank.bankMetadata
      ? { ...bank.bankMetadata }
      : (hideThumbnailPreview
        ? {
            password: Boolean(bank.isAdminBank),
            transferable: bank.transferable ?? true,
            exportable: bank.exportable ?? true,
          }
        : undefined);

    if (nextBankMetadata) {
      if (hideThumbnailPreview) {
        nextBankMetadata.hideThumbnailPreview = true;
      } else {
        delete nextBankMetadata.hideThumbnailPreview;
      }
    }

    const targetPosition = Number(selectedBankPosition);
    if (onMoveToPosition && Number.isFinite(targetPosition) && targetPosition !== currentBankPosition) {
      onMoveToPosition(bank.id, targetPosition);
    }

    onSave({
      name,
      defaultColor,
      shortcutKey: shortcutKey || undefined,
      midiNote,
      midiCC,
      bankMetadata: nextBankMetadata,
    });
  };

  const buildPendingBankMetadata = React.useCallback((input?: {
    includeStoreMetadata?: boolean;
    description?: string;
    title?: string;
  }) => {
    const nextBankMetadata = bank.bankMetadata
      ? { ...bank.bankMetadata }
      : (hideThumbnailPreview
        ? {
            password: Boolean(bank.isAdminBank),
            transferable: bank.transferable ?? true,
            exportable: bank.exportable ?? true,
          }
        : undefined);

    if (nextBankMetadata) {
      if (hideThumbnailPreview) {
        nextBankMetadata.hideThumbnailPreview = true;
      } else {
        delete nextBankMetadata.hideThumbnailPreview;
      }
      if (input?.includeStoreMetadata) {
        nextBankMetadata.title = input.title || name;
        nextBankMetadata.description = input.description || '';
        nextBankMetadata.color = defaultColor;
      }
    }

    return nextBankMetadata;
  }, [bank.bankMetadata, bank.exportable, bank.isAdminBank, bank.transferable, defaultColor, hideThumbnailPreview, name]);

  const buildPendingBankUpdates = React.useCallback((input?: {
    includeStoreMetadata?: boolean;
    description?: string;
    title?: string;
  }): Partial<SamplerBank> => ({
    name,
    defaultColor,
    shortcutKey: shortcutKey || undefined,
    midiNote,
    midiCC,
    bankMetadata: buildPendingBankMetadata(input),
  }), [buildPendingBankMetadata, defaultColor, midiCC, midiNote, name, shortcutKey]);

  const buildPendingBankSnapshot = React.useCallback((input?: {
    includeStoreMetadata?: boolean;
    description?: string;
    title?: string;
  }): SamplerBank => ({
    ...bank,
    ...buildPendingBankUpdates(input),
    bankMetadata: buildPendingBankMetadata(input),
  }), [bank, buildPendingBankMetadata, buildPendingBankUpdates]);

  const handleDeleteClick = () => {
    if (!canDeleteBank) return;
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (!canDeleteBank) return;
    onDelete();
    setShowDeleteConfirm(false);
  };

  const validateThumbnailFile = (file: File): string | null => {
    return validateManagedImageFile(file, 'thumbnail');
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isAdmin || !onAdminThumbnailChange) return;

    setAdminThumbnailError('');
    setAdminThumbnailNotice('');

    const validationError = validateThumbnailFile(file);
    if (validationError) {
      setAdminThumbnailError(validationError);
      return;
    }

    setAdminThumbnailFile(file);
    setAdminThumbnailUploading(true);
    setAdminThumbnailNotice('Saving thumbnail locally...');

    const storageId = `image_bank-thumbnail-${bank.id}`;
    const previewUrl = URL.createObjectURL(file);
    try {
      await saveBlobToDB(storageId, file, true);
      await onAdminThumbnailChange({
        thumbnailUrl: previewUrl,
        thumbnailStorageKey: storageId,
        thumbnailBackend: 'idb',
      });
      setAdminThumbnailNotice('Thumbnail saved locally. It will upload only during store export or store update.');
      setAdminThumbnailFile(null);
    } catch (thumbnailError) {
      URL.revokeObjectURL(previewUrl);
      setAdminThumbnailFile(null);
      setAdminThumbnailError(
        thumbnailError instanceof Error ? thumbnailError.message : 'Thumbnail save failed.'
      );
      setAdminThumbnailNotice('');
    } finally {
      setAdminThumbnailUploading(false);
    }
  };

  const handleThumbnailRemove = async () => {
    if (!isAdmin || !onAdminThumbnailChange || adminThumbnailUploading) return;
    setAdminThumbnailFile(null);
    setAdminThumbnailError('');
    setAdminThumbnailNotice('');
    try {
      await deleteBlobFromDB(`image_bank-thumbnail-${bank.id}`, true);
      await onAdminThumbnailChange(undefined);
    } catch (cleanupError) {
      setAdminThumbnailError(
        cleanupError instanceof Error
          ? `Thumbnail removed, but cleanup failed: ${cleanupError.message}`
          : 'Thumbnail removed, but cleanup failed.'
      );
      return;
    }
    setAdminThumbnailNotice('Thumbnail removed.');
  };

  const handleAdminExport = async () => {
    if (!onExportAdmin) return;

    setShowAdminExportProgress(true);
    setAdminExportStatus('loading');
    setAdminExportProgress(0);
    setAdminExportError('');
    setAdminExportLogLines([]);
    adminExportMilestoneRef.current = -1;
    if (isAdmin) {
      appendProgressLogLine(setAdminExportLogLines, `Admin export requested: ${bank.name}`);
      appendProgressLogLine(setAdminExportLogLines, 'Preparing admin bank package...');
    }

    try {
      const exportMessage = await onExportAdmin(
        bank.id,
        adminTitle,
        adminDescription,
        adminAddToDatabase,
        adminAllowExport,
        adminPublicCatalogAsset,
        adminExportMode,
        bank.bankMetadata?.thumbnailUrl || undefined,
        (progress) => {
          setAdminExportProgress(progress);
          if (!isAdmin) return;
          const rounded = Math.max(0, Math.min(100, Math.round(progress)));
          const milestone = rounded >= 100 ? 100 : Math.floor(rounded / 10) * 10;
          if (milestone >= 0 && milestone !== adminExportMilestoneRef.current) {
            adminExportMilestoneRef.current = milestone;
            appendProgressLogLine(
              setAdminExportLogLines,
              milestone >= 100 ? 'Admin export payload complete.' : `Admin export progress: ${milestone}%`,
            );
          }
        });
      setAdminExportStatus('success');
      setAdminExportError(exportMessage || '');
      if (isAdmin) {
        appendProgressLogLine(setAdminExportLogLines, exportMessage || 'Admin export complete.');
      }
    } catch (error) {
      setAdminExportStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Export failed.';
      setAdminExportError(errorMessage);
      if (isAdmin) {
        appendProgressLogLine(setAdminExportLogLines, `Admin export failed: ${errorMessage}`);
      }
    }
  };

  const handleStoreUpdate = async () => {
    if (!onUpdateStoreBank) return;
    if (shortcutError) return;

    const pendingUpdates = buildPendingBankUpdates({
      includeStoreMetadata: storeUpdateSyncMetadata,
      description: storeUpdateDescription,
      title: storeUpdateTitle,
    });
    (onApplyLocalBankUpdates || onSave)(pendingUpdates);

    setShowStoreUpdateProgress(true);
    setStoreUpdateStatus('loading');
    setStoreUpdateProgress(0);
    setStoreUpdateError('');
    setStoreUpdateLogLines([]);
    storeUpdateMilestoneRef.current = -1;
    if (isAdmin) {
      appendProgressLogLine(setStoreUpdateLogLines, `Store update requested: ${bank.name}`);
      appendProgressLogLine(setStoreUpdateLogLines, 'Preparing store update payload...');
    }

    try {
      const updateMessage = await onUpdateStoreBank({
        bankSnapshot: buildPendingBankSnapshot({
          includeStoreMetadata: storeUpdateSyncMetadata,
          description: storeUpdateDescription,
          title: storeUpdateTitle,
        }),
        title: storeUpdateTitle,
        description: storeUpdateDescription,
        syncMetadata: storeUpdateSyncMetadata,
        assetProtection: storeUpdateProtection,
        exportMode: storeUpdateExportMode,
        thumbnailPath: bank.bankMetadata?.thumbnailUrl || undefined,
        onProgress: (progress) => {
          setStoreUpdateProgress(progress);
          if (!isAdmin) return;
          const rounded = Math.max(0, Math.min(100, Math.round(progress)));
          const milestone = rounded >= 100 ? 100 : Math.floor(rounded / 10) * 10;
          if (milestone >= 0 && milestone !== storeUpdateMilestoneRef.current) {
            storeUpdateMilestoneRef.current = milestone;
            appendProgressLogLine(
              setStoreUpdateLogLines,
              milestone >= 100 ? 'Store update payload complete.' : `Store update progress: ${milestone}%`,
            );
          }
        },
      });
      if (storeUpdateSyncMetadata) {
        (onApplyLocalBankUpdates || onSave)({
          ...pendingUpdates,
          bankMetadata: buildPendingBankMetadata({
            includeStoreMetadata: true,
            description: storeUpdateDescription,
            title: storeUpdateTitle,
          }),
        });
      }
      const requiresAttention = /auto-retry queued|was not queued|upload failed|metadata sync failed/i.test(updateMessage || '');
      setStoreUpdateProgress(100);
      setStoreUpdateStatus(requiresAttention ? 'error' : 'success');
      setStoreUpdateError(updateMessage || '');
      if (isAdmin) {
        appendProgressLogLine(
          setStoreUpdateLogLines,
          updateMessage || (requiresAttention ? 'Store update needs attention.' : 'Store update complete.'),
        );
      }
    } catch (error) {
      setStoreUpdateStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Store bank update failed.';
      setStoreUpdateError(errorMessage);
      if (isAdmin) {
        appendProgressLogLine(setStoreUpdateLogLines, `Store update failed: ${errorMessage}`);
      }
    }
  };

  const resolvePreferredStoreLinkCandidateId = React.useCallback((candidates: LinkExistingStoreBankCandidate[]) => {
    const normalizedBankId = typeof bank.bankMetadata?.bankId === 'string'
      ? bank.bankMetadata.bankId.trim()
      : typeof bank.sourceBankId === 'string'
        ? bank.sourceBankId.trim()
        : '';
    if (normalizedBankId) {
      const exactBankMatch = candidates.find((candidate) => candidate.bankId.trim() === normalizedBankId);
      if (exactBankMatch) return exactBankMatch.catalogItemId;
    }

    const normalizedTitle = (name || bank.name).trim().toLowerCase();
    if (normalizedTitle) {
      const exactTitleMatches = candidates.filter((candidate) => candidate.title.trim().toLowerCase() === normalizedTitle);
      if (exactTitleMatches.length === 1) return exactTitleMatches[0].catalogItemId;
    }

    return candidates[0]?.catalogItemId || '';
  }, [bank.bankMetadata?.bankId, bank.name, bank.sourceBankId, name]);

  React.useEffect(() => {
    if (!showStoreLinkDialog) return;
    if (!onListLinkableStoreBanks) {
      setStoreLinkError('Store link lookup is unavailable in this build.');
      return;
    }

    let cancelled = false;
    setStoreLinkLoading(true);
    setStoreLinkError('');

    const loadCandidates = async () => {
      try {
        const candidates = await onListLinkableStoreBanks();
        if (cancelled) return;
        const sortedCandidates = [...candidates].sort((left, right) => {
          const leftUpdated = left.updatedAt || left.createdAt || '';
          const rightUpdated = right.updatedAt || right.createdAt || '';
          if (leftUpdated !== rightUpdated) return rightUpdated.localeCompare(leftUpdated);
          return left.title.localeCompare(right.title);
        });
        setStoreLinkCandidates(sortedCandidates);
        setSelectedStoreLinkCatalogItemId((current) => {
          if (current && sortedCandidates.some((candidate) => candidate.catalogItemId === current)) {
            return current;
          }
          return resolvePreferredStoreLinkCandidateId(sortedCandidates);
        });
      } catch (error) {
        if (cancelled) return;
        setStoreLinkCandidates([]);
        setSelectedStoreLinkCatalogItemId('');
        setStoreLinkError(error instanceof Error ? error.message : 'Failed to load Store banks.');
      } finally {
        if (!cancelled) {
          setStoreLinkLoading(false);
        }
      }
    };

    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [bank.bankMetadata?.bankId, bank.name, bank.sourceBankId, name, onListLinkableStoreBanks, resolvePreferredStoreLinkCandidateId, showStoreLinkDialog]);

  const filteredStoreLinkCandidates = React.useMemo(() => {
    const normalizedQuery = storeLinkQuery.trim().toLowerCase();
    if (!normalizedQuery) return storeLinkCandidates;
    return storeLinkCandidates.filter((candidate) => (
      candidate.title.toLowerCase().includes(normalizedQuery)
      || candidate.bankId.toLowerCase().includes(normalizedQuery)
      || candidate.catalogItemId.toLowerCase().includes(normalizedQuery)
      || candidate.status.toLowerCase().includes(normalizedQuery)
    ));
  }, [storeLinkCandidates, storeLinkQuery]);

  const handleStoreLink = React.useCallback(async () => {
    if (!onLinkExistingStoreBank) return;
    if (shortcutError) return;

    const selectedCandidate = storeLinkCandidates.find(
      (candidate) => candidate.catalogItemId === selectedStoreLinkCatalogItemId,
    );
    if (!selectedCandidate) {
      setStoreLinkError('Choose the published bank you want to link.');
      return;
    }

    setStoreLinkBusy(true);
    setStoreLinkError('');
    setStoreLinkNotice('');

    try {
      (onApplyLocalBankUpdates || onSave)(buildPendingBankUpdates());
      const result = await onLinkExistingStoreBank(bank.id, selectedCandidate);
      setStoreLinkNotice(result || 'Store bank linked.');
      setShowStoreLinkDialog(false);
    } catch (error) {
      setStoreLinkError(error instanceof Error ? error.message : 'Failed to link Store bank.');
    } finally {
      setStoreLinkBusy(false);
    }
  }, [
    bank.id,
    buildPendingBankUpdates,
    onApplyLocalBankUpdates,
    onLinkExistingStoreBank,
    onSave,
    selectedStoreLinkCatalogItemId,
    shortcutError,
    storeLinkCandidates,
  ]);

  const handleDuplicate = async () => {
    if (!onDuplicate) return;
    setShowDuplicateConfirm(false);
    setShowDuplicateProgress(true);
    setDuplicateStatus('loading');
    setDuplicateProgress(5);
    setDuplicateError('');

    try {
      await onDuplicate((progress) => {
        setDuplicateProgress(Math.max(0, Math.min(100, Math.round(progress))));
      });
      setDuplicateProgress(100);
      setDuplicateStatus('success');
      setDuplicateError('Bank duplicated successfully.');
    } catch (error) {
      setDuplicateStatus('error');
      setDuplicateError(error instanceof Error ? error.message : 'Failed to duplicate bank.');
    }
  };

  const isAdmin = profile?.role === 'admin';
  const showDatabaseDescription = Boolean(bank.bankMetadata?.bankId);
  const isLinkedStoreBank = isAdmin && Boolean(bank.bankMetadata?.catalogItemId);
  const isAdminOrStoreBank = Boolean(
    bank.isAdminBank ||
    bank.bankMetadata?.bankId ||
    bank.bankMetadata?.catalogItemId
  );
  const activeAdminThumbnailUrl = adminThumbnailPreviewUrl || bank.bankMetadata?.thumbnailUrl || null;
  const adminThumbnailUpdatedLabel = React.useMemo(() => {
    const savedUrl = bank.bankMetadata?.thumbnailUrl;
    if (!savedUrl) return null;
    try {
      const parsed = new URL(savedUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const match = parsed.pathname.match(/\/(\d{13})-[^/]+\.[a-z0-9]+$/i);
      if (!match) return 'Thumbnail saved.';
      const updatedAt = new Date(Number(match[1]));
      if (Number.isNaN(updatedAt.getTime())) return 'Thumbnail saved.';
      return `Last updated: ${new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(updatedAt)}`;
    } catch {
      return 'Thumbnail saved.';
    }
  }, [bank.bankMetadata?.thumbnailUrl]);

  const applyShortcutKey = (nextKey: string | null) => {
    if (!nextKey) {
      setShortcutKey('');
      setShortcutError(null);
      return;
    }

    if (isReservedShortcutCombo(nextKey)) {
      setShortcutError(`"${nextKey}" is reserved for global controls.`);
      return;
    }

    if (blockedShortcutKeys?.has(nextKey)) {
      setShortcutError(`"${nextKey}" is already assigned to system or channel mapping.`);
      return;
    }

    const duplicateBank = allBanks.find((otherBank) => {
      if (otherBank.id === bank.id) return false;
      const existingKey = normalizeStoredShortcutKey(otherBank.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicateBank) {
      setShortcutError(`"${nextKey}" is already assigned to bank "${duplicateBank.name}".`);
      return;
    }

    const duplicatePad = allPads.find((pad) => {
      const existingKey = normalizeStoredShortcutKey(pad.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicatePad) {
      setShortcutError(`"${nextKey}" is already assigned to pad "${duplicatePad.name}".`);
      return;
    }

    setMidiError(null);

    setShortcutKey(nextKey);
    setShortcutError(null);
  };

  const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();

    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Escape') {
      applyShortcutKey(null);
      return;
    }

    if (event.shiftKey) {
      setShortcutError('Shift is reserved for the secondary bank.');
      return;
    }
    if (event.ctrlKey) {
      setShortcutError('Ctrl shortcuts are reserved by the browser. Use Alt or Meta instead.');
      return;
    }

    const normalized = normalizeShortcutKey(event.key, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      code: event.code
    });
    if (!normalized) {
      setShortcutError('Please press a letter or number key.');
      return;
    }

    applyShortcutKey(normalized);
  };

  const reservedKeysText = RESERVED_SHORTCUT_KEYS.join(', ');

  const shortcutAssignments = React.useMemo(() => {
    return bank.pads
      .map((pad) => ({
        name: pad.name,
        key: pad.shortcutKey ? formatShortcutForDisplay(pad.shortcutKey) : null,
        midi:
          typeof pad.midiNote === 'number'
            ? `Note ${pad.midiNote}`
            : typeof pad.midiCC === 'number'
              ? `CC ${pad.midiCC}`
              : null
      }))
      .filter((pad) => !!pad.key || !!pad.midi) as { name: string; key: string | null; midi: string | null }[];
  }, [bank.pads, formatShortcutForDisplay]);

  const hasChanges = name !== bank.name ||
    defaultColor !== bank.defaultColor ||
    shortcutKey !== (bank.shortcutKey || '') ||
    midiNote !== (bank as BankWithMidi).midiNote ||
    midiCC !== (bank as BankWithMidi).midiCC ||
    hideThumbnailPreview !== Boolean(bank.bankMetadata?.hideThumbnailPreview);

  const handleOpenChange = (openState: boolean) => {
    if (!openState && hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      onOpenChange(openState);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className={`grid h-[100dvh] max-h-[100dvh] w-[calc(100vw-1rem)] grid-rows-[auto_1fr] overflow-hidden backdrop-blur-md sm:h-auto sm:max-h-[80vh] sm:w-full sm:max-w-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Bank</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto overscroll-contain pr-1 pb-[max(6rem,env(safe-area-inset-bottom))] sm:pb-0">
            {shouldShowPreparedPlaybackUi && preparedSummary && (
              <div className={`mb-3 flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                theme === 'dark' ? 'border-gray-700 bg-gray-900/50 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
                    <span>Prepared Playback</span>
                    <HelpTooltip
                      content="Admin-only live-readiness summary. Prepared playback prebuilds eligible pad playback assets so first trigger is more consistent on supported runtimes."
                      label="Prepared playback help"
                      iconClassName="h-3 w-3"
                    />
                  </div>
                  <div className="opacity-80">
                    {preparedSummary.label}
                    {preparedSummary.activePads > 0 ? ` · ${preparedSummary.readyPads}/${preparedSummary.activePads} eligible prepared` : ''}
                  </div>
                </div>
              </div>
            )}
            <BankEditCoreForm
              bank={bank}
              canDelete={canDeleteBank}
              theme={theme}
              colorOptions={bankColorOptions}
              primaryColorOptions={primaryBankColorOptions}
              extraColorOptions={extraBankColorOptions}
              defaultColor={defaultColor}
              setDefaultColor={setDefaultColor}
              name={name}
              setName={setName}
              orderedBanks={orderedBanks}
              selectedBankPosition={selectedBankPosition}
              setSelectedBankPosition={setSelectedBankPosition}
              isAdmin={isAdmin}
              activeAdminThumbnailUrl={activeAdminThumbnailUrl}
              adminThumbnailUploading={adminThumbnailUploading}
              adminThumbnailNotice={adminThumbnailNotice}
              adminThumbnailUpdatedLabel={adminThumbnailUpdatedLabel}
              adminThumbnailError={adminThumbnailError}
              handleThumbnailUpload={handleThumbnailUpload}
              handleThumbnailRemove={handleThumbnailRemove}
              isAdminOrStoreBank={isAdminOrStoreBank}
              hideThumbnailPreview={hideThumbnailPreview}
              setHideThumbnailPreview={setHideThumbnailPreview}
              midiEnabled={midiEnabled}
              shortcutKey={shortcutKey}
              handleShortcutKeyDown={handleShortcutKeyDown}
              shortcutError={shortcutError}
              reservedKeysText={reservedKeysText}
              midiNote={midiNote}
              midiCC={midiCC}
              midiLearnActive={midiLearnActive}
              setMidiLearnActive={setMidiLearnActive}
              clearMidiAssignments={() => {
                setMidiNote(undefined);
                setMidiCC(undefined);
                setMidiLearnActive(false);
                setMidiError(null);
              }}
              midiError={midiError}
              onClearPadShortcuts={onClearPadShortcuts}
              onClearPadMidi={onClearPadMidi}
              shortcutAssignments={shortcutAssignments}
              formatDate={formatBankEditDate}
              showDatabaseDescription={showDatabaseDescription}
              canLinkExistingStoreBank={isAdmin && !isLinkedStoreBank && Boolean(onListLinkableStoreBanks) && Boolean(onLinkExistingStoreBank)}
              storeLinkNotice={storeLinkNotice || null}
              storeLinkError={storeLinkError || null}
              onSave={handleSave}
              onShowDuplicateConfirm={() => setShowDuplicateConfirm(true)}
              onShowAdminExport={() => setShowAdminExport(true)}
              onShowStoreLink={() => {
                setStoreLinkError('');
                setStoreLinkNotice('');
                setStoreLinkQuery('');
                setShowStoreLinkDialog(true);
              }}
              onShowStoreUpdate={() => {
                setStoreUpdateTitle(name);
                setStoreUpdateDescription(bank.bankMetadata?.description || '');
                setStoreUpdateProtection(bank.bankMetadata?.password ? 'encrypted' : 'public');
                setStoreUpdateSyncMetadata(true);
                setStoreUpdateExportMode('fast');
                setShowStoreUpdateDialog(true);
              }}
              onExport={onExport}
              onDelete={handleDeleteClick}
              onDuplicate={onDuplicate}
              onExportAdmin={onExportAdmin}
              onUpdateStoreBank={isLinkedStoreBank ? handleStoreUpdate : undefined}
            />
          </div>
        </DialogContent>
      </Dialog>

      {canDeleteBank && (
        <ConfirmationDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title="Delete Bank"
          description={`Are you sure you want to delete the bank "${bank.name}"? This will permanently delete all pads in this bank. This action cannot be undone.`}
          confirmText="Delete Bank"
          variant="destructive"
          onConfirm={handleConfirmDelete}
          theme={theme}
        />
      )}

      <ConfirmationDialog
        open={showDuplicateConfirm}
        onOpenChange={setShowDuplicateConfirm}
        title="Duplicate Bank"
        description={`Create a full duplicate of "${bank.name}" with copied audio and images? This may take a while for large banks.`}
        confirmText="Duplicate"
        variant="default"
        icon={<Copy className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
        onConfirm={handleDuplicate}
        theme={theme}
      />

      <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Save changes?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            You have unsaved changes for this bank. Save them or discard the changes.
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => {
                setShowDiscardConfirm(false);
                handleSave();
              }}
              className="flex-1"
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setShowDiscardConfirm(false);
                onOpenChange(false);
              }}
              variant="outline"
              className="flex-1"
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BankEditAdminExportDialog
        open={showAdminExport}
        onOpenChange={setShowAdminExport}
        theme={theme}
        bank={bank}
        adminTitle={adminTitle}
        setAdminTitle={setAdminTitle}
        adminDescription={adminDescription}
        setAdminDescription={setAdminDescription}
        adminAddToDatabase={adminAddToDatabase}
        setAdminAddToDatabase={setAdminAddToDatabase}
        adminAllowExport={adminAllowExport}
        setAdminAllowExport={setAdminAllowExport}
        adminPublicCatalogAsset={adminPublicCatalogAsset}
        setAdminPublicCatalogAsset={setAdminPublicCatalogAsset}
        adminExportMode={adminExportMode}
        setAdminExportMode={setAdminExportMode}
        onExport={handleAdminExport}
      />

      <BankEditUpdateStoreDialog
        open={showStoreUpdateDialog}
        onOpenChange={setShowStoreUpdateDialog}
        theme={theme}
        bank={bank}
        title={storeUpdateTitle}
        setTitle={setStoreUpdateTitle}
        description={storeUpdateDescription}
        setDescription={setStoreUpdateDescription}
        syncMetadata={storeUpdateSyncMetadata}
        setSyncMetadata={setStoreUpdateSyncMetadata}
        assetProtection={storeUpdateProtection}
        setAssetProtection={setStoreUpdateProtection}
        exportMode={storeUpdateExportMode}
        setExportMode={setStoreUpdateExportMode}
        onSubmit={handleStoreUpdate}
      />

      <Dialog
        open={showStoreLinkDialog}
        onOpenChange={(openState) => {
          setShowStoreLinkDialog(openState);
          if (!openState) {
            setStoreLinkBusy(false);
            setStoreLinkError('');
            setStoreLinkQuery('');
          }
        }}
      >
        <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Link Existing Published Bank</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              Attach this local bank to one of your existing Store entries so future edits can use Update Store Bank without redownloading.
            </p>
            <Input
              value={storeLinkQuery}
              onChange={(event) => setStoreLinkQuery(event.target.value)}
              placeholder="Search by title, bank id, or catalog item id"
              disabled={storeLinkBusy}
            />
            <div className={`max-h-80 overflow-y-auto rounded-lg border ${theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-gray-50'}`}>
              {storeLinkLoading ? (
                <div className="p-4 text-sm text-gray-500">Loading your Store banks...</div>
              ) : filteredStoreLinkCandidates.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">
                  {storeLinkCandidates.length === 0 ? 'No admin Store banks were found for this account.' : 'No Store banks match this search.'}
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-800">
                  {filteredStoreLinkCandidates.map((candidate) => {
                    const isSelected = candidate.catalogItemId === selectedStoreLinkCatalogItemId;
                    const isExactBankMatch = Boolean(
                      candidate.bankId
                      && (
                        candidate.bankId === bank.bankMetadata?.bankId
                        || candidate.bankId === bank.sourceBankId
                      ),
                    );
                    return (
                      <button
                        key={candidate.catalogItemId}
                        type="button"
                        onClick={() => setSelectedStoreLinkCatalogItemId(candidate.catalogItemId)}
                        className={`w-full px-4 py-3 text-left transition ${
                          isSelected
                            ? theme === 'dark'
                              ? 'bg-indigo-600/20'
                              : 'bg-indigo-50'
                            : theme === 'dark'
                              ? 'hover:bg-gray-800/80'
                              : 'hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{candidate.title}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                                theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'
                              }`}>
                                {candidate.status}
                              </span>
                              {isExactBankMatch ? (
                                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                                  theme === 'dark' ? 'bg-emerald-900/60 text-emerald-200' : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  Exact bank match
                                </span>
                              ) : null}
                            </div>
                            <div className={`mt-1 text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                              <div>Bank ID: {candidate.bankId}</div>
                              <div>Catalog Item: {candidate.catalogItemId}</div>
                              <div>Protection: {candidate.assetProtection === 'public' ? 'Public' : 'Encrypted'}</div>
                              {candidate.updatedAt ? <div>Updated: {candidate.updatedAt}</div> : null}
                            </div>
                            {candidate.description ? (
                              <p className={`mt-2 line-clamp-2 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                                {candidate.description}
                              </p>
                            ) : null}
                          </div>
                          <div className={`mt-1 h-3 w-3 rounded-full border ${isSelected ? 'bg-indigo-500 border-indigo-500' : theme === 'dark' ? 'border-gray-500' : 'border-gray-300'}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {storeLinkError ? (
              <p className="text-sm text-red-500">{storeLinkError}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => { void handleStoreLink(); }}
                disabled={storeLinkBusy || storeLinkLoading || !selectedStoreLinkCatalogItemId}
              >
                {storeLinkBusy ? 'Linking...' : 'Link Store Bank'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowStoreLinkDialog(false)}
                disabled={storeLinkBusy}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Export Progress Dialog */}
      <ProgressDialog
        open={showAdminExportProgress}
        onOpenChange={(open) => {
          setShowAdminExportProgress(open);
          if (!open && adminExportStatus === 'success') {
            setShowAdminExport(false);
          }
        }}
        title="Exporting Admin Bank"
        description="Creating bank file and updating database..."
        progress={adminExportProgress}
        status={adminExportStatus}
        type="export"
        theme={theme}
        errorMessage={adminExportError}
        logLines={isAdmin ? adminExportLogLines : undefined}
        debugOperations={isAdmin ? ['admin_bank_export'] : undefined}
        onRetry={handleAdminExport}
      />

      <ProgressDialog
        open={showDuplicateProgress}
        onOpenChange={setShowDuplicateProgress}
        title="Duplicating Bank"
        description="Copying pad media and settings..."
        progress={duplicateProgress}
        status={duplicateStatus}
        type="export"
        theme={theme}
        errorMessage={duplicateError}
        onRetry={handleDuplicate}
      />

      <ProgressDialog
        open={showStoreUpdateProgress}
        onOpenChange={(open) => {
          setShowStoreUpdateProgress(open);
          if (!open && storeUpdateStatus === 'success') {
            setShowStoreUpdateDialog(false);
          }
        }}
        title="Updating Store Bank"
        description="Saving local .bank file and uploading a new draft asset..."
        progress={storeUpdateProgress}
        status={storeUpdateStatus}
        type="export"
        theme={theme}
        errorMessage={storeUpdateError}
        logLines={isAdmin ? storeUpdateLogLines : undefined}
        debugOperations={isAdmin ? ['admin_bank_export'] : undefined}
        onRetry={handleStoreUpdate}
      />

    </>
  );
}
