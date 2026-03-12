import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { Copy } from 'lucide-react';
import { SamplerBank, PadData } from './types/sampler';
import { useAuth } from '@/hooks/useAuth';
import { isReservedShortcutCombo, normalizeShortcutKey, normalizeStoredShortcutKey, RESERVED_SHORTCUT_KEYS } from '@/lib/keyboard-shortcuts';
import { MidiMessage } from '@/lib/midi';
import { BankEditAdminExportDialog } from './BankEditAdminExportDialog';
import { BankEditUpdateStoreDialog } from './BankEditUpdateStoreDialog';
import { BankEditCoreForm } from './BankEditCoreForm';
import { bankColorOptions, formatBankEditDate } from './bankEdit.shared';
import { isDefaultBankIdentity } from './hooks/useSamplerStore.bankIdentity';
import { prepareManagedImageUpload, validateManagedImageFile } from '@/lib/image-upload';
import type { UpdateStoreBankInput } from './hooks/useSamplerStore.types';

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
  onAdminThumbnailChange?: (thumbnailUrl?: string) => void | Promise<void>;
  onExportAdmin?: (
    id: string,
    title: string,
    description: string,
    addToDatabase: boolean,
    allowExport: boolean,
    publicCatalogAsset: boolean,
    exportMode: 'fast' | 'compact',
    thumbnailPath?: string,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  onUpdateStoreBank?: (input: UpdateStoreBankInput) => Promise<string>;
  onDuplicate?: (onProgress?: (progress: number) => void) => Promise<void> | void;
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
  onDuplicate,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs
}: BankEditDialogProps) {
  type BankWithMidi = SamplerBank & { midiNote?: number; midiCC?: number };
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const canDeleteBank = !isDefaultBankIdentity(bank);
  const { profile } = useAuth();
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
  const [adminTitle, setAdminTitle] = React.useState(bank.name);
  const [adminDescription, setAdminDescription] = React.useState('');
  const [adminAddToDatabase, setAdminAddToDatabase] = React.useState(false);
  const [adminAllowExport, setAdminAllowExport] = React.useState(false);
  const [adminPublicCatalogAsset, setAdminPublicCatalogAsset] = React.useState(false);
  const [adminExportMode, setAdminExportMode] = React.useState<'fast' | 'compact'>('fast');
  const [showAdminExportProgress, setShowAdminExportProgress] = React.useState(false);
  const [adminExportProgress, setAdminExportProgress] = React.useState(0);
  const [adminExportStatus, setAdminExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [adminExportError, setAdminExportError] = React.useState<string>('');
  const [storeUpdateTitle, setStoreUpdateTitle] = React.useState(bank.name);
  const [storeUpdateDescription, setStoreUpdateDescription] = React.useState(bank.bankMetadata?.description || '');
  const [storeUpdateSyncMetadata, setStoreUpdateSyncMetadata] = React.useState(true);
  const [storeUpdateProtection, setStoreUpdateProtection] = React.useState<'encrypted' | 'public'>(
    bank.bankMetadata?.password ? 'encrypted' : 'public'
  );
  const [storeUpdateExportMode, setStoreUpdateExportMode] = React.useState<'fast' | 'compact'>('fast');
  const [showStoreUpdateProgress, setShowStoreUpdateProgress] = React.useState(false);
  const [storeUpdateProgress, setStoreUpdateProgress] = React.useState(0);
  const [storeUpdateStatus, setStoreUpdateStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [storeUpdateError, setStoreUpdateError] = React.useState('');
  const [adminThumbnailFile, setAdminThumbnailFile] = React.useState<File | null>(null);
  const [adminThumbnailPreviewUrl, setAdminThumbnailPreviewUrl] = React.useState<string | null>(null);
  const [adminThumbnailUploading, setAdminThumbnailUploading] = React.useState(false);
  const [adminThumbnailError, setAdminThumbnailError] = React.useState<string>('');
  const [adminThumbnailNotice, setAdminThumbnailNotice] = React.useState<string>('');
  const [hideThumbnailPreview, setHideThumbnailPreview] = React.useState(Boolean(bank.bankMetadata?.hideThumbnailPreview));
  const [showDuplicateConfirm, setShowDuplicateConfirm] = React.useState(false);
  const [showDuplicateProgress, setShowDuplicateProgress] = React.useState(false);
  const [duplicateProgress, setDuplicateProgress] = React.useState(0);
  const [duplicateStatus, setDuplicateStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [duplicateError, setDuplicateError] = React.useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

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
      setAdminAddToDatabase(false);
      setAdminAllowExport(true); // Default to true when Add to Database is disabled
      setAdminPublicCatalogAsset(false);
      setAdminExportMode('fast');
      setShowStoreUpdateDialog(false);
      setStoreUpdateTitle(bank.name);
      setStoreUpdateDescription(bank.bankMetadata?.description || '');
      setStoreUpdateSyncMetadata(true);
      setStoreUpdateProtection(bank.bankMetadata?.password ? 'encrypted' : 'public');
      setStoreUpdateExportMode('fast');
      setShowStoreUpdateProgress(false);
      setStoreUpdateProgress(0);
      setStoreUpdateStatus('loading');
      setStoreUpdateError('');
      setShowDuplicateConfirm(false);
      setShowDuplicateProgress(false);
      setDuplicateProgress(0);
      setDuplicateStatus('loading');
      setDuplicateError('');
      setShowDiscardConfirm(false);
    }
  }, [open, bank]);

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

  const isTransientStorageError = (error: unknown): boolean => {
    const text = (error instanceof Error ? `${error.name} ${error.message}` : String(error || '')).toLowerCase();
    return (
      text.includes('network') ||
      text.includes('timeout') ||
      text.includes('temporar') ||
      text.includes('429') ||
      text.includes('500') ||
      text.includes('502') ||
      text.includes('503') ||
      text.includes('fetch') ||
      text.includes('jwt expired') ||
      text.includes('session')
    );
  };

  const validateThumbnailFile = (file: File): string | null => {
    return validateManagedImageFile(file, 'thumbnail');
  };

  const extractOwnedBankThumbnailPath = React.useCallback((value: string | null | undefined): string | null => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return null;
    try {
      const parsed = new URL(normalized, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const publicPrefix = `/storage/v1/object/public/store-assets/`;
      const renderPrefix = `/storage/v1/render/image/public/store-assets/`;
      const marker = parsed.pathname.includes(publicPrefix)
        ? publicPrefix
        : parsed.pathname.includes(renderPrefix)
          ? renderPrefix
          : null;
      if (!marker) return null;
      const objectPath = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length)).replace(/^\/+/, '');
      const ownedPrefix = `bank-thumbnails/${bank.id}/`;
      if (!objectPath.startsWith(ownedPrefix)) return null;
      return objectPath;
    } catch {
      return null;
    }
  }, [bank.id]);

  const removeOwnedBankThumbnail = React.useCallback(async (value: string | null | undefined): Promise<void> => {
    const objectPath = extractOwnedBankThumbnailPath(value);
    if (!objectPath) return;
    const { supabase } = await import('@/lib/supabase');
    const { error } = await supabase.storage.from('store-assets').remove([objectPath]);
    if (!error) return;
    const message = String(error.message || '');
    if (/not found|does not exist|no such object/i.test(message)) return;
    throw error instanceof Error ? error : new Error(message || 'Failed to remove thumbnail.');
  }, [extractOwnedBankThumbnailPath]);

  const uploadAdminThumbnail = async (file: File): Promise<{ objectPath: string; publicUrl: string }> => {
    const { supabase } = await import('@/lib/supabase');
    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      throw new Error('Your session expired. Please sign in again.');
    }

    const preparedFile = await prepareManagedImageUpload(file, 'thumbnail');
    const ext = (preparedFile.name.split('.').pop() || 'webp').toLowerCase();
    const suffix = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    const objectPath = `bank-thumbnails/${bank.id}/${Date.now()}-${suffix}.${ext}`;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await supabase.storage
        .from('store-assets')
        .upload(objectPath, preparedFile, { upsert: false, cacheControl: '3600' });
      if (!error) {
        const {
          data: { publicUrl }
        } = supabase.storage.from('store-assets').getPublicUrl(objectPath);
        return { objectPath, publicUrl };
      }
      lastError = error;
      if (attempt === 0 && isTransientStorageError(error)) {
        await supabase.auth.getSession();
        continue;
      }
      break;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Thumbnail upload failed.'));
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
    setAdminThumbnailNotice('Uploading thumbnail...');

    const latestStoredThumbnail = bank.bankMetadata?.thumbnailUrl;
    let uploaded: { objectPath: string; publicUrl: string } | null = null;
    try {
      uploaded = await uploadAdminThumbnail(file);
      await onAdminThumbnailChange(uploaded.publicUrl);
      if (latestStoredThumbnail && latestStoredThumbnail !== uploaded.publicUrl) {
        try {
          await removeOwnedBankThumbnail(latestStoredThumbnail);
        } catch (cleanupError) {
          setAdminThumbnailNotice(
            cleanupError instanceof Error
              ? `Thumbnail saved. Previous thumbnail cleanup failed: ${cleanupError.message}`
              : 'Thumbnail saved. Previous thumbnail cleanup failed.'
          );
          setAdminThumbnailFile(null);
          return;
        }
      }
      setAdminThumbnailNotice('Thumbnail saved.');
      setAdminThumbnailFile(null);
    } catch (thumbnailError) {
      if (uploaded?.publicUrl) {
        await removeOwnedBankThumbnail(uploaded.publicUrl).catch(() => undefined);
      }
      setAdminThumbnailFile(null);
      setAdminThumbnailError(
        thumbnailError instanceof Error ? thumbnailError.message : 'Thumbnail upload failed.'
      );
      setAdminThumbnailNotice('');
    } finally {
      setAdminThumbnailUploading(false);
    }
  };

  const handleThumbnailRemove = async () => {
    if (!isAdmin || !onAdminThumbnailChange || adminThumbnailUploading) return;
    const previousThumbnailUrl = bank.bankMetadata?.thumbnailUrl;
    setAdminThumbnailFile(null);
    setAdminThumbnailError('');
    setAdminThumbnailNotice('');
    await onAdminThumbnailChange(undefined);
    try {
      await removeOwnedBankThumbnail(previousThumbnailUrl);
    } catch (cleanupError) {
      setAdminThumbnailError(
        cleanupError instanceof Error
          ? `Thumbnail removed, but cleanup failed: ${cleanupError.message}`
          : 'Thumbnail removed, but cleanup failed.'
      );
      return;
    }
    if (previousThumbnailUrl) {
      setAdminThumbnailNotice('Thumbnail removed.');
    }
  };

  const handleAdminExport = async () => {
    if (!onExportAdmin) return;

    setShowAdminExportProgress(true);
    setAdminExportStatus('loading');
    setAdminExportProgress(0);
    setAdminExportError('');

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
        });
      setAdminExportStatus('success');
      setAdminExportError(exportMessage || '');
    } catch (error) {
      setAdminExportStatus('error');
      setAdminExportError(error instanceof Error ? error.message : 'Export failed.');
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
    } catch (error) {
      setStoreUpdateStatus('error');
      setStoreUpdateError(error instanceof Error ? error.message : 'Store bank update failed.');
    }
  };

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
        <DialogContent className={`grid grid-rows-[auto_1fr] max-h-[80vh] overflow-hidden sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Bank</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto pr-1">
            <BankEditCoreForm
              bank={bank}
              canDelete={canDeleteBank}
              theme={theme}
              colorOptions={bankColorOptions}
              defaultColor={defaultColor}
              setDefaultColor={setDefaultColor}
              name={name}
              setName={setName}
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
              onSave={handleSave}
              onShowDuplicateConfirm={() => setShowDuplicateConfirm(true)}
              onShowAdminExport={() => setShowAdminExport(true)}
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
        onRetry={handleStoreUpdate}
      />

    </>
  );
}
