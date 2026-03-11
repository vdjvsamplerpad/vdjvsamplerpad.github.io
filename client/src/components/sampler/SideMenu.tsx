import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { Plus, X, Crown, RotateCcw, ChevronUp, ChevronDown, Loader2, Settings, ShoppingCart } from 'lucide-react';
import { SamplerBank, PadData } from './types/sampler';
const BankEditDialog = React.lazy(() => import('./BankEditDialog').then(m => ({ default: m.BankEditDialog })));
import type { OnlineBankStoreDialog as OnlineBankStoreDialogType } from './OnlineBankStoreDialog';
const OnlineBankStoreDialog = React.lazy(() => import('./OnlineBankStoreDialog').then(m => ({ default: m.OnlineBankStoreDialog }))) as unknown as typeof OnlineBankStoreDialogType;
import { getCachedUser, useAuth } from '@/hooks/useAuth';
import { createPortal } from 'react-dom';
import { normalizeStoredShortcutKey } from '@/lib/keyboard-shortcuts';
import type { PerformanceTier } from '@/lib/performance-monitor';
import { useGuestStorePreviewBanks, type GuestStorePreviewBank } from './hooks/useGuestStorePreviewBanks';
import { isDefaultBankIdentity } from './hooks/useSamplerStore.bankIdentity';
import { useOnlineStoreDownloadTransfer } from './hooks/useOnlineStoreDownloadTransfer';
import { deriveSnapshotRestoreStatus } from './hooks/useSamplerStore.snapshotMetadata';
import type { OnlineBankStoreImportMeta, StoreDownloadedArtifact, StoreItem, TransferState } from './onlineStore.types';

type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string };
type BankListEntry =
  | { kind: 'real'; bank: SamplerBank }
  | { kind: 'preview'; preview: GuestStorePreviewBank };
type ImportStageDetail = {
  message?: string;
  elapsedMs?: number;
  progress?: number;
  stageId?: string | null;
};

const EXPORT_MIN_DIALOG_MS = 900;
const STORE_BUTTON_CONFETTI = [
  { key: 'c1', className: '-top-2 left-3 bg-amber-300', delay: '0ms', duration: '2.1s', drift: '-8px', rotate: '-26deg' },
  { key: 'c2', className: '-top-3 right-5 bg-pink-300', delay: '260ms', duration: '2.4s', drift: '10px', rotate: '32deg' },
  { key: 'c3', className: '-top-1 right-2 bg-cyan-300', delay: '520ms', duration: '2s', drift: '-6px', rotate: '18deg' },
  { key: 'c4', className: '-top-2 left-8 bg-emerald-300', delay: '160ms', duration: '2.3s', drift: '7px', rotate: '-20deg' },
  { key: 'c5', className: '-top-3 right-8 bg-fuchsia-300', delay: '420ms', duration: '2.5s', drift: '-10px', rotate: '28deg' },
];

interface SideMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: SamplerBank[];
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  isDualMode: boolean;
  theme: 'light' | 'dark';
  editMode: boolean;
  onCreateBank: (name: string, defaultColor: string) => void;
  onSetPrimaryBank: (id: string | null) => void;
  onSetSecondaryBank: (id: string | null) => void;
  onSetCurrentBank: (id: string | null) => void;
  onUpdateBank: (id: string, updates: Partial<SamplerBank>) => void;
  onUpdatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  onDeleteBank: (id: string) => void;
  onDuplicateBank?: (bankId: string, onProgress?: (progress: number) => void) => Promise<SamplerBank>;
  onImportBank: (
    file: File,
    onProgress?: (progress: number) => void,
    options?: {
      allowDuplicateImport?: boolean;
      skipActivityLog?: boolean;
      preferredDerivedKey?: string | null;
      preferredBankId?: string | null;
      entitlementToken?: string | null;
      replaceExistingBankId?: string | null;
    }
  ) => Promise<SamplerBank | null>;
  onExportBank: (id: string, onProgress?: (progress: number) => void) => Promise<string>;
  onMoveBankUp: (id: string) => void;
  onMoveBankDown: (id: string) => void;
  onTransferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  canTransferFromBank?: (bankId: string) => boolean;
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
  midiEnabled?: boolean;
  blockedShortcutKeys: Set<string>;
  blockedMidiNotes: Set<number>;
  blockedMidiCCs: Set<number>;
  editBankRequest?: { bankId: string; token: number } | null;
  hideShortcutLabels?: boolean;
  graphicsTier?: PerformanceTier;
  onRequestRestoreBackup: () => void;
  onRequestRecoverBankFiles: () => void;
  onRetryBankMissingMedia: (bankId: string) => Promise<{
    missingBefore: number;
    restored: number;
    remaining: number;
    remainingOfficial: number;
    remainingUser: number;
  }>;
  defaultBankColor?: string;
}

export function SideMenu({
  open,
  onOpenChange,
  banks,
  primaryBankId,
  secondaryBankId,
  currentBankId,
  isDualMode,
  theme,
  editMode,
  onCreateBank,
  onSetPrimaryBank,
  onSetSecondaryBank,
  onSetCurrentBank,
  onUpdateBank,
  onUpdatePad,
  onDeleteBank,
  onDuplicateBank,
  onImportBank,
  onExportBank,
  onMoveBankUp,
  onMoveBankDown,
  onTransferPad,
  canTransferFromBank,
  onExportAdmin,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs,
  editBankRequest = null,
  hideShortcutLabels = false,
  graphicsTier = 'low',
  onRequestRestoreBackup,
  onRequestRecoverBankFiles,
  onRetryBankMissingMedia,
  defaultBankColor = '#3b82f6',
}: SideMenuProps) {
  const logoSrc = `${import.meta.env.BASE_URL}assets/logo.png`;
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showStoreDialog, setShowStoreDialog] = React.useState(false);
  const [showEditDialog, setShowEditDialog] = React.useState(false);
  const [editingBank, setEditingBank] = React.useState<SamplerBank | null>(null);
  const lastEditTokenRef = React.useRef<number | undefined>(undefined);
  const [newBankName, setNewBankName] = React.useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [bankToDelete, setBankToDelete] = React.useState<SamplerBank | null>(null);
  const [pendingImportFile, setPendingImportFile] = React.useState<File | null>(null);

  // Progress State
  const [showExportProgress, setShowExportProgress] = React.useState(false);
  const [showImportProgress, setShowImportProgress] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);
  const [importProgress, setImportProgress] = React.useState(0);
  const [exportStatus, setExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [importStatus, setImportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [exportError, setExportError] = React.useState<string>('');
  const [importError, setImportError] = React.useState<string>('');
  const [importStageMessage, setImportStageMessage] = React.useState<string>('');
  const [dragOverBankId, setDragOverBankId] = React.useState<string | null>(null);
  const [renderContent, setRenderContent] = React.useState(open);
  const [pendingBulkClearAction, setPendingBulkClearAction] = React.useState<'keys' | 'midi' | null>(null);


  // ETA Calculation State
  const [importStartTime, setImportStartTime] = React.useState<number>(0);
  const [importEta, setImportEta] = React.useState<number | null>(null);

  // Loading State
  const [isLoadingBanks, setIsLoadingBanks] = React.useState(true);

  // Toast notification state
  const [notices, setNotices] = React.useState<Notice[]>([]);
  const [snapshotBankAction, setSnapshotBankAction] = React.useState<{
    kind: 'download' | 'recover';
    bankId: string;
  } | null>(null);
  const [snapshotRecoverBusyBankId, setSnapshotRecoverBusyBankId] = React.useState<string | null>(null);
  const [snapshotTransfers, setSnapshotTransfers] = React.useState<Record<string, TransferState>>({});
  const downloadedArtifactsRef = React.useRef<Record<string, StoreDownloadedArtifact>>({});

  const pushNotice = React.useCallback((n: Omit<Notice, 'id'>) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now() + Math.random());
    const notice: Notice = { id, ...n };
    setNotices((arr) => [notice, ...arr]);
    setTimeout(() => {
      setNotices((arr) => arr.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  const dismissNotice = React.useCallback((id: string) => {
    setNotices((arr) => arr.filter((n) => n.id !== id));
  }, []);

  const executeClearPadShortcuts = React.useCallback(() => {
    if (!editingBank) return;
    const latestBank = banks.find((bank) => bank.id === editingBank.id);
    if (!latestBank) return;
    let cleared = 0;
    latestBank.pads.forEach((pad) => {
      if (pad.shortcutKey) {
        cleared += 1;
        onUpdatePad(latestBank.id, pad.id, { ...pad, shortcutKey: undefined });
      }
    });
    onUpdateBank(latestBank.id, { disableDefaultPadShortcutLayout: true });
    if (cleared > 0) {
      pushNotice({ variant: 'success', message: `Cleared keyboard shortcuts from ${cleared} pad${cleared === 1 ? '' : 's'}.` });
    } else {
      pushNotice({ variant: 'info', message: 'No pad keyboard shortcuts to clear.' });
    }
  }, [banks, editingBank, onUpdatePad, onUpdateBank, pushNotice]);

  const executeClearPadMidi = React.useCallback(() => {
    if (!editingBank) return;
    const latestBank = banks.find((bank) => bank.id === editingBank.id);
    if (!latestBank) return;
    let cleared = 0;
    latestBank.pads.forEach((pad) => {
      if (typeof pad.midiNote === 'number' || typeof pad.midiCC === 'number') {
        cleared += 1;
        onUpdatePad(latestBank.id, pad.id, { ...pad, midiNote: undefined, midiCC: undefined });
      }
    });
    if (cleared > 0) {
      pushNotice({ variant: 'success', message: `Cleared MIDI mappings from ${cleared} pad${cleared === 1 ? '' : 's'}.` });
    } else {
      pushNotice({ variant: 'info', message: 'No pad MIDI mappings to clear.' });
    }
  }, [banks, editingBank, onUpdatePad, pushNotice]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { user, profile } = useAuth();
  const prevUserIdRef = React.useRef<string | null>(null);
  const requestLoginModal = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('vdjv-login-request'));
  }, []);

  const isHighGraphics = graphicsTier === 'high';
  const isMediumGraphics = graphicsTier === 'medium';
  const showEnhancedStoreButton = isHighGraphics;
  const storeButtonMotionStyle = showEnhancedStoreButton
    ? { animation: 'vdjv-store-button-float 2.6s ease-in-out infinite' }
    : undefined;
  const storeIconMotionStyle = showEnhancedStoreButton
    ? { animation: 'vdjv-store-icon-wiggle 1.8s ease-in-out infinite' }
    : undefined;
  const requestLoginPrompt = React.useCallback((reason: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('vdjv-login-request'));
    window.dispatchEvent(new CustomEvent('vdjv-require-login', { detail: { reason } }));
  }, []);
  const requestAboutDialog = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('vdjv-open-about'));
  }, []);
  const effectiveUser = user || getCachedUser();
  const { previewBanks } = useGuestStorePreviewBanks(effectiveUser);
  const displayName = profile?.display_name?.trim() || effectiveUser?.email?.split('@')[0] || 'Guest';
  const isLowestGraphics = graphicsTier === 'lowest';
  const requestStoreLogin = React.useCallback((reason?: string) => {
    requestLoginPrompt(reason || 'Please sign in to download this bank.');
  }, [requestLoginPrompt]);

  const mergeOfficialPadAssets = React.useCallback((targetPad: PadData, sourcePad: PadData): PadData => ({
    ...targetPad,
    audioUrl: sourcePad.audioUrl || targetPad.audioUrl,
    audioStorageKey: sourcePad.audioStorageKey ?? targetPad.audioStorageKey,
    audioBackend: sourcePad.audioBackend ?? targetPad.audioBackend,
    imageUrl: sourcePad.imageUrl || targetPad.imageUrl,
    imageStorageKey: sourcePad.imageStorageKey ?? targetPad.imageStorageKey,
    imageBackend: sourcePad.imageBackend ?? targetPad.imageBackend,
    hasImageAsset: sourcePad.hasImageAsset ?? targetPad.hasImageAsset,
    audioBytes: sourcePad.audioBytes ?? targetPad.audioBytes,
    audioDurationMs: sourcePad.audioDurationMs ?? targetPad.audioDurationMs,
    contentOrigin: sourcePad.contentOrigin ?? targetPad.contentOrigin,
    originBankId: sourcePad.originBankId ?? targetPad.originBankId,
    originPadId: sourcePad.originPadId ?? targetPad.originPadId,
    originCatalogItemId: sourcePad.originCatalogItemId ?? targetPad.originCatalogItemId,
    originBankTitle: sourcePad.originBankTitle ?? targetPad.originBankTitle,
    missingMediaExpected: false,
    missingImageExpected: false,
  }), []);

  const refreshStoreAssetsFromImportedBank = React.useCallback((importedBank: SamplerBank, meta: OnlineBankStoreImportMeta) => {
    const importedPadById = new Map<string, PadData>();
    const importedPadByOriginId = new Map<string, PadData>();
    importedBank.pads.forEach((pad) => {
      importedPadById.set(pad.id, pad);
      if (typeof pad.originPadId === 'string' && pad.originPadId.trim().length > 0) {
        importedPadByOriginId.set(pad.originPadId, pad);
      }
    });

    const resolveImportedPad = (targetPad: PadData): PadData | null => {
      return (
        importedPadById.get(targetPad.id) ||
        (typeof targetPad.sourcePadId === 'string'
          ? importedPadByOriginId.get(targetPad.sourcePadId) || importedPadById.get(targetPad.sourcePadId)
          : undefined) ||
        (typeof targetPad.originPadId === 'string'
          ? importedPadByOriginId.get(targetPad.originPadId) || importedPadById.get(targetPad.originPadId)
          : undefined) ||
        null
      );
    };

    let refreshedBanks = 0;
    let refreshedPads = 0;
    banks.forEach((candidate) => {
      if (candidate.id === importedBank.id) return;

      const isPaidBankDuplicate =
        candidate.bankMetadata?.bankId === meta.bankId ||
        candidate.sourceBankId === meta.bankId ||
        candidate.bankMetadata?.catalogItemId === meta.catalogItemId;

      let changed = false;
      let nextPads = candidate.pads;

      if (isPaidBankDuplicate) {
        const matchedImportedPadIds = new Set<string>();
        nextPads = candidate.pads.map((targetPad) => {
          if (targetPad.restoreAssetKind === 'custom_local_media') return targetPad;
          const sourcePad = resolveImportedPad(targetPad);
          if (!sourcePad) return targetPad;
          matchedImportedPadIds.add(sourcePad.id);
          changed = true;
          refreshedPads += 1;
          return mergeOfficialPadAssets(targetPad, sourcePad);
        });
        const appendedImportedPads = importedBank.pads.filter((pad) =>
          pad.restoreAssetKind !== 'custom_local_media' && !matchedImportedPadIds.has(pad.id)
        );
        if (appendedImportedPads.length > 0) {
          nextPads = [...nextPads, ...appendedImportedPads];
          changed = true;
          refreshedPads += appendedImportedPads.length;
        }
      } else {
        nextPads = candidate.pads.map((targetPad) => {
          const referencesThisStoreBank = targetPad.restoreAssetKind === 'paid_asset' && (
            targetPad.originCatalogItemId === meta.catalogItemId ||
            targetPad.sourceCatalogItemId === meta.catalogItemId ||
            targetPad.originBankId === meta.bankId
          );
          if (!referencesThisStoreBank) return targetPad;
          const sourcePad = resolveImportedPad(targetPad);
          if (!sourcePad) return targetPad;
          changed = true;
          refreshedPads += 1;
          return mergeOfficialPadAssets(targetPad, sourcePad);
        });
      }

      if (!changed) return;
      refreshedBanks += 1;
      onUpdateBank(candidate.id, {
        pads: nextPads,
        restoreStatus: deriveSnapshotRestoreStatus({ ...candidate, pads: nextPads }),
        bankMetadata: isPaidBankDuplicate
          ? {
              ...candidate.bankMetadata,
              thumbnailUrl: meta.thumbnailUrl || candidate.bankMetadata?.thumbnailUrl,
            }
          : candidate.bankMetadata,
      });
    });

    return { refreshedBanks, refreshedPads };
  }, [banks, mergeOfficialPadAssets, onUpdateBank]);

  const importBankFromStoreWithSnapshotReconcile = React.useCallback(async (
    file: File,
    meta: OnlineBankStoreImportMeta,
    onProgress?: (progress: number) => void
  ) => {
      const placeholderBank = (
        (meta.targetBankId
          ? banks.find((candidate) => candidate.id === meta.targetBankId) || null
          : null)
        || banks.find((candidate) =>
          candidate.remoteSnapshotApplied &&
          candidate.restoreKind === 'paid_bank' &&
          (candidate.bankMetadata?.bankId === meta.bankId || candidate.sourceBankId === meta.bankId)
        )
        || null
      );

      const importedBank = await onImportBank(file, onProgress, {
        preferredDerivedKey: meta.derivedKey || null,
        preferredBankId: meta.bankId || null,
        entitlementToken: meta.entitlementToken || null,
        allowDuplicateImport: Boolean(placeholderBank),
        replaceExistingBankId: meta.targetBankId || placeholderBank?.id || null,
      });

      if (!importedBank) return;

      if (meta.refreshAssetsOnly) {
        const refreshResult = refreshStoreAssetsFromImportedBank(importedBank, meta);
        if (refreshResult.refreshedBanks > 0 || refreshResult.refreshedPads > 0) {
          pushNotice({
            variant: 'success',
            message: `Refreshed official assets for ${refreshResult.refreshedBanks} bank${refreshResult.refreshedBanks === 1 ? '' : 's'} and ${refreshResult.refreshedPads} pad${refreshResult.refreshedPads === 1 ? '' : 's'}.`,
          });
        } else {
          pushNotice({
            variant: 'info',
            message: 'The latest bank assets were refreshed on this device.',
          });
        }
      }

      const nextRestoreStatus = deriveSnapshotRestoreStatus({
        ...importedBank,
        restoreKind: 'paid_bank',
      });
      onUpdateBank(importedBank.id, {
        sortOrder: placeholderBank?.sortOrder ?? importedBank.sortOrder,
        restoreKind: 'paid_bank',
        restoreStatus: nextRestoreStatus,
        remoteSnapshotApplied: true,
        bankMetadata: {
          ...importedBank.bankMetadata,
          bankId: meta.bankId,
          catalogItemId: meta.catalogItemId,
          catalogSha256: meta.catalogSha256,
          thumbnailUrl: meta.thumbnailUrl,
          entitlementToken: meta.entitlementToken || importedBank.bankMetadata?.entitlementToken,
          entitlementTokenKid: meta.entitlementTokenKid || importedBank.bankMetadata?.entitlementTokenKid,
          entitlementTokenIssuedAt:
            meta.entitlementTokenIssuedAt || importedBank.bankMetadata?.entitlementTokenIssuedAt,
          entitlementTokenExpiresAt:
            meta.entitlementTokenExpiresAt || importedBank.bankMetadata?.entitlementTokenExpiresAt,
        }
      });
  }, [
    banks,
    onImportBank,
    onUpdateBank,
    pushNotice,
    refreshStoreAssetsFromImportedBank,
  ]);

  const { normalizeProgress, handleDownload: handleSnapshotBankDownload } = useOnlineStoreDownloadTransfer({
    effectiveUser,
    requestLogin: requestStoreLogin,
    transfers: snapshotTransfers,
    setTransfers: setSnapshotTransfers,
    downloadedArtifactsRef,
    pushDownloadDebugLog: () => {},
    showToast: (message, type) => {
      pushNotice({ variant: type === 'success' ? 'success' : 'error', message });
    },
    onImportBankFromStore: importBankFromStoreWithSnapshotReconcile,
  });

  const buildSnapshotStoreItem = React.useCallback((bank: SamplerBank): StoreItem | null => {
    const catalogItemId = typeof bank.bankMetadata?.catalogItemId === 'string' ? bank.bankMetadata.catalogItemId.trim() : '';
    const storeBankId = typeof bank.bankMetadata?.bankId === 'string'
      ? bank.bankMetadata.bankId.trim()
      : (typeof bank.sourceBankId === 'string' ? bank.sourceBankId.trim() : '');
    if (!catalogItemId || !storeBankId) return null;
    const requiresGrant = Boolean(
      bank.bankMetadata?.entitlementToken ||
      bank.bankMetadata?.entitlementTokenKid ||
      bank.bankMetadata?.entitlementTokenIssuedAt ||
      bank.bankMetadata?.entitlementTokenExpiresAt
    );
    return {
      id: catalogItemId,
      bank_id: storeBankId,
      snapshot_target_bank_id: bank.id,
      is_paid: requiresGrant,
      requires_grant: requiresGrant,
      is_pinned: false,
      is_owned: true,
      is_free_download: !requiresGrant,
      is_pending: false,
      is_rejected: false,
      is_downloadable: true,
      is_purchased: true,
      price_php: null,
      sha256: bank.bankMetadata?.catalogSha256 || null,
      thumbnail_path: bank.bankMetadata?.thumbnailUrl || bank.bankMetadata?.remoteSnapshotThumbnailUrl || null,
      status: 'granted_download',
      rejection_message: null,
      bank: {
        title: bank.name,
        description: bank.bankMetadata?.description || '',
        color: bank.defaultColor || bank.bankMetadata?.color || defaultBankColor,
      }
    };
  }, []);

  const handleSnapshotBankRecovery = React.useCallback(async (bankId: string) => {
    setSnapshotRecoverBusyBankId(bankId);
    try {
      const result = await onRetryBankMissingMedia(bankId);
      if (result.restored > 0) {
        pushNotice({
          variant: 'success',
          message: `Restored ${result.restored} missing pad asset${result.restored === 1 ? '' : 's'}.`
        });
      } else {
        pushNotice({
          variant: 'info',
          message: 'No official assets could be restored automatically. Use .bank recovery or full backup for custom media.'
        });
      }
    } catch (error) {
      pushNotice({
        variant: 'error',
        message: error instanceof Error ? error.message : 'Bank media recovery failed.'
      });
    } finally {
      setSnapshotRecoverBusyBankId(null);
    }
  }, [onRetryBankMissingMedia, pushNotice]);

  // Manage loading state - CHANGED
  // We removed the timeout. It will now keep loading indefinitely until at least one bank is detected.
  React.useEffect(() => {
    if (banks.length > 0) {
      setIsLoadingBanks(false);
    }
  }, [banks]);

  React.useEffect(() => {
    if (open) {
      setRenderContent(true);
      return;
    }
    const timeout = setTimeout(() => setRenderContent(false), 200);
    return () => clearTimeout(timeout);
  }, [open]);

  // Sort banks by sortOrder
  const sortedBanks = React.useMemo(() => {
    return [...banks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [banks]);

  const bankIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    sortedBanks.forEach((bank, index) => {
      map.set(bank.id, index);
    });
    return map;
  }, [sortedBanks]);

  const bankListEntries = React.useMemo<BankListEntry[]>(() => {
    const realEntries: BankListEntry[] = sortedBanks.map((bank) => ({ kind: 'real', bank }));
    if (previewBanks.length === 0) return realEntries;

    const previewEntries: BankListEntry[] = previewBanks.map((preview) => ({ kind: 'preview', preview }));
    const defaultBankIndex = realEntries.findIndex(
      (entry) => entry.kind === 'real' && isDefaultBankIdentity(entry.bank)
    );

    if (defaultBankIndex < 0) {
      return [...realEntries, ...previewEntries];
    }

    return [
      ...realEntries.slice(0, defaultBankIndex + 1),
      ...previewEntries,
      ...realEntries.slice(defaultBankIndex + 1),
    ];
  }, [previewBanks, sortedBanks]);

  const snapshotActionBank = React.useMemo(
    () => (snapshotBankAction ? banks.find((bank) => bank.id === snapshotBankAction.bankId) || null : null),
    [banks, snapshotBankAction]
  );


  const handleCreateBank = () => {
    if (newBankName.trim()) {
      try {
        onCreateBank(newBankName.trim(), defaultBankColor);
        setNewBankName('');
        setShowCreateDialog(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not create bank.';
        if (message.toLowerCase().includes('owned bank quota')) {
          setShowCreateDialog(false);
        }
        pushNotice({ variant: 'error', message });
      }
    }
  };

  const handleEditBank = (bank: SamplerBank) => {
    setEditingBank(bank);
    setShowEditDialog(true);
  };

  React.useEffect(() => {
    if (!showEditDialog || !editingBank) return;
    const latest = banks.find((bank) => bank.id === editingBank.id);
    if (latest && latest !== editingBank) {
      setEditingBank(latest);
    }
  }, [banks, showEditDialog, editingBank]);

  React.useEffect(() => {
    if (!editMode || !editBankRequest) return;
    if (lastEditTokenRef.current === editBankRequest.token) return;
    const target = banks.find((bank) => bank.id === editBankRequest.bankId);
    if (!target) return;
    lastEditTokenRef.current = editBankRequest.token;
    handleEditBank(target);
  }, [banks, editBankRequest, editMode]);

  const handleDeleteBank = (bank: SamplerBank) => {
    if (isDefaultBankIdentity(bank)) return;
    setBankToDelete(bank);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (bankToDelete) {
      onDeleteBank(bankToDelete.id);
      setBankToDelete(null);
    }
  };

  const handlePrimaryClick = (bankId: string) => {
    if (bankId === primaryBankId) {
      // Clicking primary again - disable dual mode
      onSetPrimaryBank(null);
    } else {
      // Set as new primary - this enables dual mode
      onSetPrimaryBank(bankId);
    }
  };

  const handleBankClick = (bankId: string) => {
    if (!isDualMode) {
      // In single mode, set as current bank
      onSetCurrentBank(bankId);
    } else if (bankId !== primaryBankId) {
      // In dual mode, set as secondary if it's not primary
      onSetSecondaryBank(bankId);
    }
  };

  // Detect Android/WebView environment
  const isAndroid = React.useMemo(() => /Android/.test(navigator.userAgent), []);
  const isWebView = React.useMemo(() => {
    return !!(window as any).Android ||
      navigator.userAgent.includes('wv') ||
      navigator.userAgent.includes('WebView');
  }, []);

  // Create Android/WebView compatible file input
  const createCompatibleFileInput = React.useCallback((): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'file';
    // Keep bank-focused MIME hints, but include wildcard fallback for Android pickers.
    input.accept = '.bank,application/zip,application/x-zip-compressed,application/octet-stream,*/*';
    input.setAttribute('capture', 'none');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    return input;
  }, []);

  const handleImportClick = React.useCallback(() => {
    const effectiveUser = user || getCachedUser();
    if (!effectiveUser) {
      requestLoginModal();
      pushNotice({ variant: 'error', message: 'Please sign in to import a bank.' });
      return;
    }
    // Use enhanced file picker for Android/WebView
    if (isAndroid || isWebView) {
      const compatibleInput = createCompatibleFileInput();

      const handleChange = async (event: Event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];

        if (file) {
          await processFileImport(file);
        } else {
          pushNotice({ variant: 'error', message: 'No file selected. Please try again.' });
        }

        // Clean up
        compatibleInput.removeEventListener('change', handleChange);
        if (compatibleInput.parentNode) compatibleInput.remove();
      };

      compatibleInput.addEventListener('change', handleChange);

      // Add timeout to detect silent failures
      const timeoutId = setTimeout(() => {
        pushNotice({
          variant: 'error',
          message: 'File picker did not respond. Please try selecting the file again or use Google Drive to import.'
        });
        compatibleInput.removeEventListener('change', handleChange);
        if (compatibleInput.parentNode) compatibleInput.remove();
      }, 60000);

      compatibleInput.addEventListener('change', () => clearTimeout(timeoutId), { once: true });

      try {
        compatibleInput.click();
      } catch (error) {
        pushNotice({
          variant: 'error',
          message: 'Failed to open file picker. Please try again or use Google Drive to import.'
        });
        clearTimeout(timeoutId);
        if (compatibleInput.parentNode) compatibleInput.remove();
      }
    } else {
      // Standard file input for other platforms
      fileInputRef.current?.click();
    }
  }, [isAndroid, isWebView, createCompatibleFileInput, pushNotice, user, requestLoginModal]);

  React.useEffect(() => {
    const handleGlobalImport = () => {
      handleImportClick();
    };
    window.addEventListener('vdjv-import-bank', handleGlobalImport as EventListener);
    return () => window.removeEventListener('vdjv-import-bank', handleGlobalImport as EventListener);
  }, [handleImportClick]);

  React.useEffect(() => {
    const handleImportStage = (event: Event) => {
      const detail = (event as CustomEvent<ImportStageDetail>).detail;
      if (!detail?.message) return;
      setImportStageMessage(detail.message);
      if (typeof detail.progress === 'number') {
        setImportProgress((prev) => Math.max(prev, Math.round(detail.progress)));
      }
    };

    window.addEventListener('vdjv-import-stage', handleImportStage as EventListener);
    return () => window.removeEventListener('vdjv-import-stage', handleImportStage as EventListener);
  }, []);

  const processFileImport = React.useCallback(async (file: File) => {
    // Validate file
    if (!file) {
      pushNotice({ variant: 'error', message: 'No file selected.' });
      return;
    }

    if (!file.name.endsWith('.bank')) {
      pushNotice({ variant: 'error', message: 'Invalid file type. Please select a .bank file.' });
      return;
    }

    if (file.size === 0) {
      pushNotice({ variant: 'error', message: 'Selected file is empty.' });
      return;
    }

    setShowImportProgress(true);
    setImportStatus('loading');
    setImportProgress(0);
    setImportError('');
    setImportStageMessage('Preparing import...');

    // Reset ETA calculation
    setImportStartTime(Date.now());
    setImportEta(null);

    try {
      window.dispatchEvent(new Event('vdjv-import-start'));
      await onImportBank(file, (progress) => {
        setImportProgress(progress);
      });
      setImportStatus('success');
      setImportStageMessage('Import complete.');
      pushNotice({ variant: 'success', message: 'Bank imported successfully!' });
      setPendingImportFile(null); // Clear pending file on success
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      setImportStatus('error');
      setImportError(errorMessage);
      setImportStageMessage('Import failed.');

      // Check if error is login-related
      const needsLogin = errorMessage.toLowerCase().includes('sign in') ||
        errorMessage.toLowerCase().includes('login required') ||
        errorMessage.toLowerCase().includes('please sign in');

      if (needsLogin) {
        // Store file for auto-import after login
        setPendingImportFile(file);
      } else {
        setPendingImportFile(null);
      }

      pushNotice({ variant: 'error', message: `Import failed: ${errorMessage}` });
    } finally {
      window.dispatchEvent(new Event('vdjv-import-end'));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onImportBank, pushNotice]);

  const handleFileSelect = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processFileImport(file);
    }
  }, [processFileImport]);

  // Auto-import pending file after login (moved here after processFileImport is defined)
  React.useEffect(() => {
    const currentUserId = user?.id || null;
    const justLoggedIn = currentUserId && prevUserIdRef.current !== currentUserId;

    if (justLoggedIn && pendingImportFile) {
      prevUserIdRef.current = currentUserId;
      // Close login modal
      // Small delay to ensure login state is fully propagated
      setTimeout(() => {
        // Auto-import the pending file
        processFileImport(pendingImportFile).finally(() => {
          setPendingImportFile(null);
        });
      }, 100);
    } else {
      prevUserIdRef.current = currentUserId;
    }
  }, [user, pendingImportFile, processFileImport]);

  // ETA Calculation Effect
  React.useEffect(() => {
    let interval: NodeJS.Timeout;

    if (showImportProgress && importStatus === 'loading' && importProgress > 0 && importProgress < 100) {

      const calculateEta = () => {
        const now = Date.now();
        const elapsedSeconds = (now - importStartTime) / 1000;

        // Rate = percent per second
        const rate = importProgress / elapsedSeconds;

        if (rate > 0) {
          const remainingPercent = 100 - importProgress;
          let estimatedSeconds = remainingPercent / rate;

          // "Smart Floor" Logic
          if (estimatedSeconds < 3 && importProgress < 98) {
            estimatedSeconds = 5;
          }

          setImportEta(estimatedSeconds);
        }
      };

      // Run calculation immediately
      calculateEta();
      // Recalculate every 1 second
      interval = setInterval(calculateEta, 1000);

    } else if (importStatus !== 'loading') {
      setImportEta(null);
    }

    return () => clearInterval(interval);
  }, [importProgress, showImportProgress, importStatus, importStartTime]);

  const getImportPhaseInfo = () => {
    if (importStageMessage) {
      return {
        message: importStageMessage,
        showWarning: importProgress < 20
      };
    }
    if (importProgress < 20) {
      return {
        message: "Verifying your purchase...",
        showWarning: true
      };
    }
    return {
      message: "Extracting and processing audio files and images...",
      showWarning: false
    };
  };

  const importPhase = getImportPhaseInfo();

  const handleExportBank = async (bankId: string) => {
    const startedAt = Date.now();
    setShowExportProgress(true);
    setExportStatus('loading');
    setExportProgress(0);
    setExportError('');

    try {
      const exportMessage = await onExportBank(bankId, (progress) => {
        setExportProgress(progress);
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < EXPORT_MIN_DIALOG_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, EXPORT_MIN_DIALOG_MS - elapsed));
      }
      setExportStatus('success');
      // Show success notification with platform-specific message
      if (exportMessage) {
        pushNotice({ variant: 'success', message: exportMessage });
      }
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < EXPORT_MIN_DIALOG_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, EXPORT_MIN_DIALOG_MS - elapsed));
      }
      setExportStatus('error');
      setExportError(error instanceof Error ? error.message : 'Export failed');
    }
  };

  const handleBankDragOver = (e: React.DragEvent, bankId: string) => {
    if (!editMode) return;

    e.preventDefault();
    e.stopPropagation();

    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (!data) return;

    try {
      const dragData = JSON.parse(data);

      if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== bankId) {
        if (canTransferFrom(dragData.sourceBankId)) {
          setDragOverBankId(bankId);
        }
      }
    } catch {
    }
  };

  const handleBankDrop = (e: React.DragEvent, targetBankId: string) => {
    if (!editMode) return;

    e.preventDefault();
    e.stopPropagation();
    setDragOverBankId(null);

    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (!data) {
      return;
    }

    try {
      const dragData = JSON.parse(data);

      if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== targetBankId) {
        if (canTransferFrom(dragData.sourceBankId)) {
          onTransferPad(dragData.pad.id, dragData.sourceBankId, targetBankId);
        }
      }
    } catch {
    }
  };

  const handleBankDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverBankId(null);
    }
  };

  const getBankStatus = (bankId: string) => {
    if (bankId === primaryBankId) return 'primary';
    if (bankId === secondaryBankId) return 'secondary';
    if (bankId === currentBankId) return 'current';
    return 'inactive';
  };

  const canMoveUp = (bankId: string) => (bankIndexById.get(bankId) ?? -1) > 0;
  const canMoveDown = (bankId: string) => {
    const index = bankIndexById.get(bankId) ?? -1;
    return index >= 0 && index < sortedBanks.length - 1;
  };

  const getTextColorForBackground = (backgroundColor: string) => {
    const hex = backgroundColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  };

  const canAcceptDrop = (bankId: string) => true;

  const canTransferFrom = (bankId: string) => {
    return canTransferFromBank ? canTransferFromBank(bankId) : true;
  };

  const handlePreviewBankInteraction = React.useCallback((reason?: string) => {
    requestLoginPrompt(reason || 'Please sign in to open this bank preview.');
  }, [requestLoginPrompt]);

  const handleConfirmBulkClear = React.useCallback(() => {
    if (pendingBulkClearAction === 'keys') {
      executeClearPadShortcuts();
    } else if (pendingBulkClearAction === 'midi') {
      executeClearPadMidi();
    }
    setPendingBulkClearAction(null);
  }, [pendingBulkClearAction, executeClearPadShortcuts, executeClearPadMidi]);

  return (
    <>
      {showEnhancedStoreButton && (
        <style>{`
          @keyframes vdjv-store-button-float {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-3px) scale(1.015); }
          }
          @keyframes vdjv-store-icon-wiggle {
            0%, 100% { transform: rotate(0deg) scale(1); }
            20% { transform: rotate(-10deg) scale(1.04); }
            40% { transform: rotate(9deg) scale(1.07); }
            60% { transform: rotate(-7deg) scale(1.04); }
            80% { transform: rotate(4deg) scale(1.02); }
          }
          @keyframes vdjv-store-shimmer {
            0% { transform: translateX(-135%) skewX(-18deg); opacity: 0; }
            18% { opacity: 0.2; }
            50% { opacity: 0.45; }
            100% { transform: translateX(155%) skewX(-18deg); opacity: 0; }
          }
          @keyframes vdjv-store-confetti-fall {
            0% { transform: translate3d(0, -8px, 0) rotate(0deg) scale(0.9); opacity: 0; }
            8% { opacity: 0.95; }
            70% { opacity: 0.95; }
            100% { transform: translate3d(var(--vdjv-confetti-drift), 22px, 0) rotate(var(--vdjv-confetti-rotate)) scale(1); opacity: 0; }
          }
        `}</style>
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r transition-transform duration-200 will-change-transform ${theme === 'dark'
          ? 'bg-gray-800/95 border-gray-700 perf-high:backdrop-blur-md'
          : 'bg-white/95 border-gray-200 perf-high:backdrop-blur-md'
          } flex h-[100dvh] flex-col ${open ? 'translate-x-0' : '-translate-x-full'} perf-high:shadow-2xl`}
      >
        <div
          className={`flex items-center gap-3 p-3 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
            }`}
        >
          <img src={logoSrc} alt="VDJV Logo" className="w-9 h-9 object-contain shrink-0" />
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold truncate ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              VDJV Sampler Pad
            </div>
            <div className={`text-[11px] truncate ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{displayName}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={requestAboutDialog}
            className={theme === 'dark'
              ? 'h-8 w-8 p-0 text-cyan-300 hover:bg-cyan-900/40 hover:text-cyan-200'
              : 'h-8 w-8 p-0 text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800'}
            title="About & Settings"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>

        <div
          className={`flex items-center justify-between p-3 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
            }`}
        >
          <h2
            className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}
          >
            Banks
          </h2>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className={theme === 'dark'
              ? 'h-8 w-8 p-0 inline-flex items-center justify-center border border-red-500/50 bg-red-900/40 text-red-300 hover:bg-red-800/60 hover:text-red-100'
              : 'h-8 w-8 p-0 inline-flex items-center justify-center border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700'}
            title="Close Banks"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {renderContent && (
          <div className="flex-1 min-h-0 overflow-y-auto p-2 pb-6">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <Button
                onClick={() => setShowCreateDialog(true)}
                className={`min-w-0 px-2 sm:px-3 text-[13px] sm:text-sm gap-0 transition-all duration-200 ${theme === 'dark'
                  ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'
                  : 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100'
                  }`}
              >
                <Plus className="w-4 h-4 mr-1.5 shrink-0" />
                <span className="truncate">New Bank</span>
              </Button>
              <div className={`relative min-w-0 ${showEnhancedStoreButton ? 'overflow-visible' : ''}`}>
                {showEnhancedStoreButton && (
                  <>
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-0 -z-10 rounded-xl blur-md opacity-80 animate-pulse ${theme === 'dark'
                        ? 'bg-gradient-to-r from-fuchsia-500/55 via-indigo-400/55 to-cyan-400/55'
                        : 'bg-gradient-to-r from-fuchsia-300/65 via-indigo-300/65 to-cyan-300/65'
                        }`}
                    />
                    {STORE_BUTTON_CONFETTI.map((piece) => (
                      <span
                        key={piece.key}
                        aria-hidden="true"
                        className={`pointer-events-none absolute z-10 h-2 w-1 rounded-full opacity-90 ${piece.className}`}
                        style={{
                          animation: 'vdjv-store-confetti-fall linear infinite',
                          animationDelay: piece.delay,
                          animationDuration: piece.duration,
                          ['--vdjv-confetti-drift' as string]: piece.drift,
                          ['--vdjv-confetti-rotate' as string]: piece.rotate,
                        }}
                      />
                    ))}
                  </>
                )}
                <Button
                  onClick={() => setShowStoreDialog(true)}
                  className={`relative min-w-0 w-full px-2 sm:px-3 text-[13px] sm:text-sm gap-0 transition-all duration-200 ${showEnhancedStoreButton ? 'shadow-[0_0_18px_rgba(99,102,241,0.35)] hover:scale-[1.02]' : ''} ${theme === 'dark'
                    ? 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500'
                    : 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  style={storeButtonMotionStyle}
                >
                  {showEnhancedStoreButton && (
                    <>
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 rounded-md opacity-70 ${theme === 'dark'
                          ? 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.28),transparent_58%)]'
                          : 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.85),transparent_58%)]'
                          }`}
                      />
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-y-0 left-0 w-8 rounded-md ${theme === 'dark'
                          ? 'bg-white/30'
                          : 'bg-white/80'
                          }`}
                        style={{ animation: 'vdjv-store-shimmer 2.2s ease-in-out infinite' }}
                      />
                    </>
                  )}
                  <ShoppingCart className="relative z-[1] w-4 h-4 mr-1.5 shrink-0" style={storeIconMotionStyle} />
                  <span className="relative z-[1] truncate">Bank Store</span>
                </Button>
              </div>
            </div>

            {editMode && (
              <div className={`mb-1 p-2 rounded-lg border ${theme === 'dark'
                ? 'bg-orange-900 border-orange-600 text-orange-300'
                : 'bg-orange-50 border-orange-300 text-orange-700'
                }`}>
                <p className="text-xs text-center font-medium">
                  Drag sampler to transfer bank
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".bank,application/zip,application/x-zip-compressed,application/octet-stream,*/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="space-y-2">
              {isLoadingBanks && sortedBanks.length === 0 && bankListEntries.length === 0 ? (
                <div className={`flex flex-col gap-2 p-8 items-center justify-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm">Loading banks...</span>
                </div>
              ) : bankListEntries.map((entry) => {
                const isPreview = entry.kind === 'preview';
                const bank = entry.kind === 'real' ? entry.bank : null;
                const preview = entry.kind === 'preview' ? entry.preview : null;
                const bankId = bank?.id || preview?.bankId || '';
                const bankName = bank?.name || preview?.title || 'Bank Preview';
                const bankColor = bank?.defaultColor || preview?.color || defaultBankColor;
                const restoreStatus = !isPreview ? bank?.restoreStatus || null : null;
                const snapshotTransfer = !isPreview && bank?.bankMetadata?.catalogItemId
                  ? snapshotTransfers[bank.bankMetadata.catalogItemId]
                  : undefined;
                const thumbnailUrl = isPreview
                  ? preview?.thumbnailUrl || undefined
                  : (!bank?.bankMetadata?.hideThumbnailPreview ? bank?.bankMetadata?.thumbnailUrl : undefined);
                const status = getBankStatus(bankId);
                const isPrimary = status === 'primary';
                const isSecondary = status === 'secondary';
                const isCurrent = status === 'current';
                const isActive = !isPreview && (isPrimary || isSecondary || isCurrent);
                const isDragOver = !isPreview && dragOverBankId === bankId;
                const bankShortcutLabel = !isPreview ? normalizeStoredShortcutKey(bank?.shortcutKey) : undefined;
                const shouldUseBankColorText = (!isActive || isLowestGraphics)
                  && !(thumbnailUrl && !isActive && !isLowestGraphics && !isMediumGraphics);
                const isHighThumbnailCard = isHighGraphics && !isActive && !isLowestGraphics && !!thumbnailUrl;
                const bankTextColorStyle = shouldUseBankColorText
                  ? { color: getTextColorForBackground(bankColor) }
                  : undefined;
                const highThumbnailTextStyle = isHighThumbnailCard
                  ? { color: '#ffffff', textShadow: '0 1px 2px rgba(0, 0, 0, 0.75)' }
                  : undefined;
                const inactiveBankCardStyle = !isActive
                  ? {
                    backgroundColor: bankColor,
                    borderColor: bankColor,
                    ...(isHighGraphics
                      ? {
                        boxShadow: `inset 0 0 0 3px ${bankColor}`,
                      }
                      : {}),
                    ...(thumbnailUrl
                      ? isMediumGraphics
                        ? {
                          backgroundImage: `linear-gradient(to right, transparent 0%, ${bankColor} 70%), url(${thumbnailUrl})`,
                          backgroundSize: 'cover, cover',
                          backgroundPosition: 'center, left center',
                        }
                        : {
                          backgroundImage: `url(${thumbnailUrl})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }
                      : {}),
                  }
                  : undefined;
                const activeLabel = isPrimary ? 'PRIMARY' : isSecondary ? 'SECONDARY' : isCurrent ? 'CURRENT' : null;
                const activeAccentClass = isPrimary
                  ? (theme === 'dark'
                    ? 'bg-gradient-to-r from-blue-500/18 via-slate-800/94 to-slate-900/96 border-blue-400/80 text-white shadow-[0_10px_24px_-18px_rgba(59,130,246,0.9)] perf-high:backdrop-blur-sm'
                    : 'bg-gradient-to-r from-blue-50 via-white to-white border-blue-500 text-gray-900 shadow-[0_10px_24px_-18px_rgba(59,130,246,0.45)] perf-high:backdrop-blur-sm')
                  : isSecondary
                    ? (theme === 'dark'
                      ? 'bg-gradient-to-r from-purple-500/18 via-slate-800/94 to-slate-900/96 border-purple-400/80 text-white shadow-[0_10px_24px_-18px_rgba(168,85,247,0.9)] perf-high:backdrop-blur-sm'
                      : 'bg-gradient-to-r from-purple-50 via-white to-white border-purple-500 text-gray-900 shadow-[0_10px_24px_-18px_rgba(168,85,247,0.4)] perf-high:backdrop-blur-sm')
                    : (theme === 'dark'
                      ? 'bg-gradient-to-r from-emerald-500/18 via-slate-800/94 to-slate-900/96 border-emerald-400/80 text-white shadow-[0_10px_24px_-18px_rgba(34,197,94,0.9)] perf-high:backdrop-blur-sm'
                      : 'bg-gradient-to-r from-emerald-50 via-white to-white border-emerald-500 text-gray-900 shadow-[0_10px_24px_-18px_rgba(34,197,94,0.4)] perf-high:backdrop-blur-sm');
                const activePillClass = isPrimary
                  ? (theme === 'dark' ? 'bg-blue-500/18 text-blue-200 border-blue-400/50' : 'bg-blue-100 text-blue-700 border-blue-200')
                  : isSecondary
                    ? (theme === 'dark' ? 'bg-purple-500/18 text-purple-200 border-purple-400/50' : 'bg-purple-100 text-purple-700 border-purple-200')
                    : (theme === 'dark' ? 'bg-emerald-500/18 text-emerald-200 border-emerald-400/50' : 'bg-emerald-100 text-emerald-700 border-emerald-200');
                const lowestActivePillClass = isPrimary
                  ? (theme === 'dark' ? 'bg-blue-950/85 text-blue-100 border-blue-400/70' : 'bg-blue-600 text-white border-blue-200')
                  : isSecondary
                    ? (theme === 'dark' ? 'bg-purple-950/85 text-purple-100 border-purple-400/70' : 'bg-purple-600 text-white border-purple-200')
                    : (theme === 'dark' ? 'bg-emerald-950/85 text-emerald-100 border-emerald-400/70' : 'bg-emerald-600 text-white border-emerald-200');
                const activeRailClass = isPrimary
                  ? 'bg-blue-500'
                  : isSecondary
                    ? 'bg-purple-500'
                    : 'bg-emerald-500';
                const canRecoverAtBankLevel = !isPreview && bank?.restoreKind === 'custom_bank';
                const lowestAccentBorder = isPrimary
                  ? '#3b82f6'
                  : isSecondary
                    ? '#a855f7'
                    : isCurrent
                      ? '#22c55e'
                      : bankColor;
                const handleBankSelect = () => {
                  if (isPreview) {
                    handlePreviewBankInteraction(`Please sign in to open "${bankName}".`);
                    return;
                  }
                  if (restoreStatus === 'needs_download') {
                    setSnapshotBankAction({ kind: 'download', bankId });
                    return;
                  }
                  if (canRecoverAtBankLevel && (restoreStatus === 'missing_media' || restoreStatus === 'partially_restored')) {
                    setSnapshotBankAction({ kind: 'recover', bankId });
                    return;
                  }
                  handleBankClick(bankId);
                };

                return (
                  <div
                    key={isPreview ? `preview:${preview?.catalogItemId || bankId}` : bankId}
                    className={`p-2 rounded-lg border-[1.5px] ${isLowestGraphics ? 'transition-none' : 'transition-all duration-200'} relative overflow-hidden ${isDragOver
                      ? 'ring-4 ring-orange-400 scale-[1.02] bg-orange-200'
                      : ''
                      } ${isLowestGraphics
                        ? 'cursor-pointer'
                        : isActive
                        ? activeAccentClass
                        : theme === 'dark'
                          ? 'bg-gray-800/40 border-gray-700 text-gray-300 hover:bg-gray-700/60 hover:border-gray-500 cursor-pointer perf-high:backdrop-blur-sm'
                          : 'bg-white/40 border-gray-300 text-gray-700 hover:bg-white/80 hover:border-gray-400 cursor-pointer perf-high:backdrop-blur-sm'
                      }`}
                    style={isLowestGraphics
                      ? {
                        backgroundColor: bankColor,
                        borderColor: lowestAccentBorder,
                        borderWidth: isActive ? '2px' : undefined,
                        boxShadow: isActive ? `inset 0 0 0 2px ${lowestAccentBorder}` : undefined,
                      }
                      : inactiveBankCardStyle}
                    onDragOver={isPreview ? undefined : (e) => handleBankDragOver(e, bankId)}
                    onDrop={isPreview ? undefined : (e) => handleBankDrop(e, bankId)}
                    onDragLeave={isPreview ? undefined : handleBankDragLeave}
                  >
                    {/* Drop zone indicator for edit mode */}
                    {!isPreview && editMode && isDragOver && canAcceptDrop(bankId) && (
                      <div className={`absolute inset-0 border-4 border-dashed border-orange-400 rounded-xl flex items-center justify-center z-10 ${theme === 'dark'
                        ? 'bg-orange-900 text-orange-200'
                        : 'bg-orange-50 text-orange-800'
                        }`}>
                        <div className="text-center">
                          <div className="text-2xl mb-1">TARGET</div>
                          <p className="font-bold text-sm">DROP PAD HERE</p>
                          <p className="text-xs opacity-75">Transfer to {bankName}</p>
                          {isActive && (
                            <p className="text-xs opacity-60 mt-1">
                              {isPrimary ? '(Primary Bank)' : isSecondary ? '(Secondary Bank)' : '(Current Bank)'}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {isActive && !isLowestGraphics && (
                      <div className={`pointer-events-none absolute inset-y-2 left-1.5 w-1 rounded-full ${activeRailClass}`} />
                    )}

                    <div className={`flex items-center gap-2 mb-1 ${isActive && !isLowestGraphics ? 'pl-3' : ''} ${isHighThumbnailCard ? 'rounded-md bg-black/25 px-1.5 py-1 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.7)] backdrop-blur-[1px]' : ''}`}>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={handleBankSelect}>
                        {activeLabel && (
                          <div className="mb-1">
                            <span className={`inline-flex rounded-full border font-semibold tracking-[0.12em] ${isLowestGraphics
                              ? `px-1.5 py-0.5 text-[8px] ${lowestActivePillClass}`
                              : `px-1.5 py-0.5 text-[9px] ${activePillClass}`
                              }`}>
                              {activeLabel}
                            </span>
                          </div>
                        )}
                        <h3 className="font-medium text-sm truncate" title={bankName} style={isHighThumbnailCard ? highThumbnailTextStyle : bankTextColorStyle}>
                          {bankName.length > 15 ? `${bankName.substring(0, 15)}...` : bankName}
                        </h3>
                        {!isPreview && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <p className="text-xs opacity-75" style={isHighThumbnailCard ? highThumbnailTextStyle : bankTextColorStyle}>
                              {bank?.pads.length || 0} pad{bank?.pads.length !== 1 ? 's' : ''}
                            </p>
                            {restoreStatus === 'needs_download' && (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${theme === 'dark'
                                ? 'bg-indigo-500/15 text-indigo-200'
                                : 'bg-indigo-100 text-indigo-700'
                                }`}>
                                Download
                              </span>
                            )}
                            {restoreStatus === 'missing_media' && (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${theme === 'dark'
                                ? 'bg-amber-500/15 text-amber-200'
                                : 'bg-amber-100 text-amber-700'
                                }`}>
                                Missing
                              </span>
                            )}
                            {restoreStatus === 'partially_restored' && (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${theme === 'dark'
                                ? 'bg-orange-500/15 text-orange-200'
                                : 'bg-orange-100 text-orange-700'
                                }`}>
                                Partial
                              </span>
                            )}
                          </div>
                        )}
                        {!isPreview && snapshotTransfer && (snapshotTransfer.phase === 'downloading' || snapshotTransfer.phase === 'importing' || snapshotTransfer.phase === 'error') && (
                          <div className="mt-1 space-y-1">
                            <div className={`h-1.5 overflow-hidden rounded-full ${isHighThumbnailCard ? 'bg-black/45' : theme === 'dark' ? 'bg-black/20' : 'bg-white/40'}`}>
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${snapshotTransfer.phase === 'error' ? 'bg-red-500' : 'bg-indigo-500'}`}
                                style={{ width: `${normalizeProgress(snapshotTransfer.progress)}%` }}
                              />
                            </div>
                            <p className="text-[10px] opacity-80" style={isHighThumbnailCard ? highThumbnailTextStyle : bankTextColorStyle}>
                              {snapshotTransfer.phase === 'importing'
                                ? `Importing ${normalizeProgress(snapshotTransfer.progress)}%`
                                : snapshotTransfer.phase === 'downloading'
                                  ? `Downloading ${normalizeProgress(snapshotTransfer.progress)}%`
                                  : snapshotTransfer.error || 'Download failed'}
                            </p>
                          </div>
                        )}
                      </div>
                      {bankShortcutLabel && !hideShortcutLabels && (
                        <span
                          className={`max-w-[64px] shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide truncate ${isHighThumbnailCard ? 'bg-black/45' : 'bg-black/20'}`}
                          style={isHighThumbnailCard ? highThumbnailTextStyle : bankTextColorStyle}
                          title={bankShortcutLabel}
                        >
                          {bankShortcutLabel}
                        </span>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="flex flex-col gap-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPreview) {
                                handlePreviewBankInteraction(`Please sign in to reorder "${bankName}".`);
                                return;
                              }
                              onMoveBankUp(bankId);
                            }}
                            disabled={!isPreview && !canMoveUp(bankId)}
                            className={`p-0 h-3 w-4 transition-all duration-200 ${isHighThumbnailCard
                              ? 'text-white/85 hover:text-white hover:bg-black/35 disabled:text-white/30'
                              : theme === 'dark'
                                ? 'text-gray-400 hover:text-white hover:bg-gray-600 disabled:text-gray-600'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-white disabled:text-gray-400'
                              }`}
                            title="Move up"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPreview) {
                                handlePreviewBankInteraction(`Please sign in to reorder "${bankName}".`);
                                return;
                              }
                              onMoveBankDown(bankId);
                            }}
                            disabled={!isPreview && !canMoveDown(bankId)}
                            className={`p-0 h-3 w-4 transition-all duration-200 ${isHighThumbnailCard
                              ? 'text-white/85 hover:text-white hover:bg-black/35 disabled:text-white/30'
                              : theme === 'dark'
                                ? 'text-gray-400 hover:text-white hover:bg-gray-600 disabled:text-gray-600'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-white disabled:text-gray-400'
                              }`}
                            title="Move down"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isPreview) {
                                handlePreviewBankInteraction(`Please sign in to select "${bankName}".`);
                                return;
                              }
                              if (restoreStatus === 'needs_download') {
                                setSnapshotBankAction({ kind: 'download', bankId });
                                return;
                              }
                              handlePrimaryClick(bankId);
                            }}
                          disabled={!isPreview && bankId === secondaryBankId}
                          className={`p-1 h-6 w-6 transition-all duration-200 ${isPrimary
                            ? theme === 'dark'
                              ? 'bg-yellow-500 text-yellow-300 hover:bg-yellow-400'
                              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            : isHighThumbnailCard
                              ? 'text-white/85 hover:text-yellow-200 hover:bg-black/35'
                              : theme === 'dark'
                                ? 'text-gray-400 hover:text-yellow-300 hover:bg-yellow-500'
                                : 'text-gray-600 hover:text-yellow-700 hover:bg-yellow-100'
                            }`}
                          title={isPrimary ? 'Primary (click to exit dual mode)' : 'Set as Primary'}
                        >
                          <Crown className="w-3 h-3" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isPreview) {
                                handlePreviewBankInteraction(`Please sign in to view settings for "${bankName}".`);
                                return;
                              }
                              if (restoreStatus === 'needs_download') {
                                setSnapshotBankAction({ kind: 'download', bankId });
                                return;
                              }
                              if (canRecoverAtBankLevel && (restoreStatus === 'missing_media' || restoreStatus === 'partially_restored')) {
                                setSnapshotBankAction({ kind: 'recover', bankId });
                                return;
                              }
                              if (bank) handleEditBank(bank);
                            }}
                          className={`p-1 h-6 w-6 transition-all duration-200 ${isHighThumbnailCard
                            ? 'text-white/85 hover:text-white hover:bg-black/35'
                            : theme === 'dark'
                              ? 'text-gray-400 hover:text-white hover:bg-gray-600'
                              : 'text-gray-600 hover:text-gray-900 hover:bg-white'
                            }`}
                        >
                          <Settings className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={snapshotBankAction?.kind === 'download' && Boolean(snapshotActionBank)}
        onOpenChange={(open) => {
          if (!open) setSnapshotBankAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Download Bank?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              {snapshotActionBank
                ? `"${snapshotActionBank.name}" was restored from your online metadata snapshot. Download the bank files now to use it on this device.`
                : 'Download this bank on this device.'}
            </p>
            {snapshotActionBank?.bankMetadata?.remoteSnapshotThumbnailUrl && (
              <div className={`rounded-lg border p-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-gray-50'}`}>
                <img
                  src={snapshotActionBank.bankMetadata.remoteSnapshotThumbnailUrl}
                  alt={snapshotActionBank.name}
                  className="h-28 w-full rounded object-cover"
                />
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              <Button
                onClick={async () => {
                  if (!snapshotActionBank) return;
                  const item = buildSnapshotStoreItem(snapshotActionBank);
                  if (!item) {
                    pushNotice({ variant: 'error', message: 'Download information is incomplete for this bank.' });
                    setSnapshotBankAction(null);
                    return;
                  }
                  setSnapshotBankAction(null);
                  await handleSnapshotBankDownload(item);
                }}
              >
                Download Bank
              </Button>
              <Button variant="ghost" onClick={() => setSnapshotBankAction(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={snapshotBankAction?.kind === 'recover' && Boolean(snapshotActionBank)}
        onOpenChange={(open) => {
          if (!open) setSnapshotBankAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Recover Missing Bank Media</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              {snapshotActionBank?.restoreKind === 'default_bank'
                ? 'This bank needs built-in Default Bank assets or custom media relinking on this device.'
                : 'This bank was restored from metadata only. Use .bank recovery or full backup to restore custom media on this device.'}
            </p>
            <div className={`rounded-md border p-3 text-xs ${theme === 'dark' ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              <div><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Import .bank files:</span> recover custom banks or mixed banks from exports copied from the old device.</div>
              <div className="mt-1"><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Restore from Full Backup:</span> fastest full-media restore if you exported a backup on the old device.</div>
              {snapshotActionBank?.restoreKind !== 'custom_bank' && (
                <div className="mt-1"><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Sync official assets:</span> tries to restore Default/Paid source assets automatically before manual recovery.</div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {snapshotActionBank?.restoreKind !== 'custom_bank' && (
                <Button
                  variant="default"
                  disabled={snapshotRecoverBusyBankId === snapshotActionBank?.id}
                  onClick={async () => {
                    if (!snapshotActionBank) return;
                    await handleSnapshotBankRecovery(snapshotActionBank.id);
                    setSnapshotBankAction(null);
                  }}
                >
                  {snapshotRecoverBusyBankId === snapshotActionBank?.id ? 'Syncing...' : 'Sync Official Assets'}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setSnapshotBankAction(null);
                  onRequestRecoverBankFiles();
                }}
              >
                Import .bank Files
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSnapshotBankAction(null);
                  onRequestRestoreBackup();
                }}
              >
                Restore from Full Backup
              </Button>
              <Button variant="ghost" onClick={() => setSnapshotBankAction(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className={`${theme === 'dark' ? 'bg-gray-800' : 'bg-white'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create New Bank</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div>
              <Label htmlFor="bankName">Bank Name</Label>
              <Input
                id="bankName"
                value={newBankName}
                onChange={(e) => {
                  if (e.target.value.length <= 18) {
                    setNewBankName(e.target.value);
                  }
                }}
                placeholder="Enter bank name"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateBank()}
                maxLength={24}
              />
            </div>
            <div className="flex gap-1">
              <Button onClick={handleCreateBank} className="flex-1">
                Create Bank
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {editingBank && (
        <React.Suspense fallback={null}>
          <BankEditDialog
            bank={editingBank}
            allBanks={banks}
            allPads={banks.flatMap((bank) => bank.pads)}
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            theme={theme}
            onSave={(updates) => {
              const nextUpdates: Partial<SamplerBank> = { ...updates };
              if (updates.shortcutKey === undefined && editingBank.shortcutKey) {
                nextUpdates.disableDefaultBankShortcutLayout = true;
              } else if (typeof updates.shortcutKey === 'string' && updates.shortcutKey.trim().length > 0) {
                nextUpdates.disableDefaultBankShortcutLayout = false;
              }
              onUpdateBank(editingBank.id, nextUpdates);
              setShowEditDialog(false);
            }}
            onDelete={() => {
              if (isDefaultBankIdentity(editingBank)) return;
              setShowEditDialog(false);
              onDeleteBank(editingBank.id);
            }}
            onExport={() => {
              setShowEditDialog(false);
              handleExportBank(editingBank.id);
            }}
            onDuplicate={onDuplicateBank ? async (onProgress) => {
              try {
                const duplicatedBank = await onDuplicateBank(editingBank.id, onProgress);
                setEditingBank(duplicatedBank);
                pushNotice({ variant: 'success', message: `Bank duplicated as "${duplicatedBank.name}".` });
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to duplicate bank.';
                pushNotice({ variant: 'error', message });
                throw error;
              }
            } : undefined}
            onExportAdmin={onExportAdmin}
            onAdminThumbnailChange={onExportAdmin ? async (thumbnailUrl?: string) => {
              const latestBank = banks.find((bank) => bank.id === editingBank.id);
              if (!latestBank) return;
              const currentMetadata = latestBank.bankMetadata;
              if (!thumbnailUrl && !currentMetadata?.thumbnailUrl) return;

              if (currentMetadata) {
                onUpdateBank(latestBank.id, {
                  bankMetadata: {
                    ...currentMetadata,
                    thumbnailUrl: thumbnailUrl || undefined,
                  }
                });
                return;
              }

              if (thumbnailUrl) {
                onUpdateBank(latestBank.id, {
                  bankMetadata: {
                    password: false,
                    transferable: typeof latestBank.transferable === 'boolean' ? latestBank.transferable : true,
                    exportable: latestBank.exportable,
                    thumbnailUrl,
                  }
                });
              }
            } : undefined}
            midiEnabled={midiEnabled}
            blockedShortcutKeys={blockedShortcutKeys}
            blockedMidiNotes={blockedMidiNotes}
            blockedMidiCCs={blockedMidiCCs}
            onClearPadShortcuts={() => setPendingBulkClearAction('keys')}
            onClearPadMidi={() => setPendingBulkClearAction('midi')}
          />
        </React.Suspense>
      )}

      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Bank"
        description={`Are you sure you want to delete the bank "${bankToDelete?.name}"? This will permanently delete all pads in this bank. This action cannot be undone.`}
        confirmText="Delete Bank"
        variant="destructive"
        onConfirm={handleConfirmDelete}
        theme={theme}
      />

      <ConfirmationDialog
        open={pendingBulkClearAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBulkClearAction(null);
        }}
        title={pendingBulkClearAction === 'midi' ? 'Clear All MIDI' : 'Clear All Keys'}
        description={
          pendingBulkClearAction === 'midi'
            ? `Clear all MIDI note/CC mappings for pads in "${editingBank?.name || 'this bank'}"?`
            : `Clear all keyboard shortcuts for pads in "${editingBank?.name || 'this bank'}"?`
        }
        confirmText={pendingBulkClearAction === 'midi' ? 'Clear MIDI' : 'Clear Keys'}
        onConfirm={handleConfirmBulkClear}
        theme={theme}
      />

      <ProgressDialog
        open={showExportProgress}
        onOpenChange={setShowExportProgress}
        title="Exporting Bank"
        description="Compressing audio files, images, and bank data..."
        progress={exportProgress}
        status={exportStatus}
        type="export"
        theme={theme}
        errorMessage={exportError}
        hideCloseButton
        useHistory={false}
        onRetry={() => {
          if (banks.length > 0) {
            handleExportBank(banks[0].id);
          }
        }}
      />

      <ProgressDialog
        open={showImportProgress}
        onOpenChange={setShowImportProgress}
        title="Importing Bank"
        description=""
        progress={importProgress}
        status={importStatus}
        type="import"
        theme={theme}
        errorMessage={importError}
        statusMessage={importPhase.message}
        etaSeconds={importEta}
        showWarning={importPhase.showWarning}
        useHistory={false}
        onRetry={() => {
          handleImportClick();
        }}
        onLogin={() => {
          // File is already stored in pendingImportFile when error occurred
          requestLoginModal();
        }}
      />

      <React.Suspense fallback={null}>
        <OnlineBankStoreDialog
          open={showStoreDialog}
          onOpenChange={setShowStoreDialog}
          theme={theme}
          importedBankIds={React.useMemo(() => {
            const ids = new Set<string>();
            banks.forEach(b => {
              if (b.sourceBankId) ids.add(b.sourceBankId);
              if (b.bankMetadata?.bankId) ids.add(b.bankMetadata.bankId);
            });
            return ids;
          }, [banks])}
          runtimeBankIdsBySource={React.useMemo(() => {
            const next: Record<string, string[]> = {};
            banks.forEach((bank) => {
              const keys = [
                typeof bank.bankMetadata?.bankId === 'string' ? bank.bankMetadata.bankId.trim() : '',
                typeof bank.sourceBankId === 'string' ? bank.sourceBankId.trim() : '',
              ].filter(Boolean);
              keys.forEach((key) => {
                if (!next[key]) next[key] = [];
                if (!next[key].includes(bank.id)) next[key].push(bank.id);
              });
            });
            return next;
          }, [banks])}
          onImportBankFromStore={importBankFromStoreWithSnapshotReconcile}
        />
      </React.Suspense>

      {/* Toast Notifications */}
      {typeof document !== 'undefined' && createPortal(
        <div className="fixed top-0 left-0 right-0 z-[2147483647] flex justify-center pointer-events-none">
          <div className="w-full max-w-xl px-3">
            {notices.map((notice) => (
              <NoticeItem key={notice.id} notice={notice} dismiss={dismissNotice} theme={theme} />
            ))}
          </div>
        </div>,
        document.body
      )}

    </>
  );
}

// Toast notification component
function NoticeItem({ notice, dismiss, theme }: { notice: Notice; dismiss: (id: string) => void; theme: 'light' | 'dark' }) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 10);
    return () => clearTimeout(t);
  }, []);

  const base = 'pointer-events-auto mt-3 rounded-lg border px-4 py-2 shadow-lg transition-all duration-300';
  const colors =
    notice.variant === 'success'
      ? (theme === 'dark' ? 'bg-green-600/90 border-green-500 text-white' : 'bg-green-600 text-white border-green-700')
      : notice.variant === 'error'
        ? (theme === 'dark' ? 'bg-red-600/90 border-red-500 text-white' : 'bg-red-600 text-white border-red-700')
        : (theme === 'dark' ? 'bg-gray-800/90 border-gray-700 text-white' : 'bg-gray-900 text-white border-gray-800');

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
  );
}

