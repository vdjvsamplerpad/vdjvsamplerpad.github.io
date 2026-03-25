import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { Plus, X, Crown, RotateCcw, ChevronUp, ChevronDown, Loader2, Settings, ShoppingCart, ArrowDownToLine } from 'lucide-react';
import { SamplerBank, PadData } from './types/sampler';
const BankEditDialog = React.lazy(() => import('./BankEditDialog').then(m => ({ default: m.BankEditDialog })));
import type { OnlineBankStoreDialog as OnlineBankStoreDialogType } from './OnlineBankStoreDialog';
const OnlineBankStoreDialog = React.lazy(() => import('./OnlineBankStoreDialog').then(m => ({ default: m.OnlineBankStoreDialog }))) as unknown as typeof OnlineBankStoreDialogType;
import { getCachedUser, useAuthState } from '@/hooks/useAuth';
import { createPortal } from 'react-dom';
import { normalizeStoredShortcutKey } from '@/lib/keyboard-shortcuts';
import type { PerformanceTier } from '@/lib/performance-monitor';
import { type GuestStorePreviewBank } from './hooks/useGuestStorePreviewBanks';
import { useStorePreviewBadge } from './hooks/useStorePreviewBadge';
import { isCanonicalDefaultBankIdentity, isExplicitDefaultBankIdentity } from './hooks/useSamplerStore.bankIdentity';
import { useOnlineStoreDownloadTransfer } from './hooks/useOnlineStoreDownloadTransfer';
import { deriveSnapshotRestoreStatus } from './hooks/useSamplerStore.snapshotMetadata';
import type { OnlineBankStoreImportMeta, StoreDownloadedArtifact, StoreItem, TransferState } from './onlineStore.types';
import type { ImportBankSource } from './hooks/nativeBankImport.types';
import type { AdminStoreUploadQueueSummary, ExportAudioMode, LinkExistingStoreBankCandidate, UpdateStoreBankInput } from './hooks/useSamplerStore.types';
import type { BankPreparedSummary } from './hooks/preparedAudio';
import { parsePadDragTransferPayload } from './padDragTransfer';

type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string; closing?: boolean };
const MAX_ACTIVE_NOTICES = 2;
const NOTICE_EXIT_MS = 220;
const NOTICE_AUTO_DISMISS_MS = 5000;
type BankListEntry =
  | { kind: 'real'; bank: SamplerBank }
  | { kind: 'preview'; preview: GuestStorePreviewBank };

const EXPORT_MIN_DIALOG_MS = 900;
const MAX_PROGRESS_LOG_LINES = 80;
const STORE_BUTTON_CONFETTI = [
  { key: 'c1', className: '-top-2 left-3 bg-amber-300', delay: '0ms', duration: '2.1s', drift: '-8px', rotate: '-26deg' },
  { key: 'c2', className: '-top-3 right-5 bg-pink-300', delay: '260ms', duration: '2.4s', drift: '10px', rotate: '32deg' },
  { key: 'c3', className: '-top-1 right-2 bg-cyan-300', delay: '520ms', duration: '2s', drift: '-6px', rotate: '18deg' },
  { key: 'c4', className: '-top-2 left-8 bg-emerald-300', delay: '160ms', duration: '2.3s', drift: '7px', rotate: '-20deg' },
  { key: 'c5', className: '-top-3 right-8 bg-fuchsia-300', delay: '420ms', duration: '2.5s', drift: '-10px', rotate: '28deg' },
];
const withAlpha = (hex: string, alphaHex: string): string => {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  return `#${normalized}${alphaHex}`;
};

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

type StoreRecoveryResolution = {
  catalogItemId: string;
  bankId: string;
  sha256?: string | null;
};

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
    source: ImportBankSource,
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
  onMoveBankToPosition: (id: string, targetIndex: number) => void;
  onTransferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  canTransferFromBank?: (bankId: string) => boolean;
  onExportAdmin?: (
    id: string,
    title: string,
    description: string,
    addToDatabase: boolean,
    allowExport: boolean,
    publicCatalogAsset: boolean,
    comingSoonOnly: boolean,
    exportMode: ExportAudioMode,
    thumbnailPath?: string,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  onUpdateStoreBank?: (input: UpdateStoreBankInput) => Promise<string>;
  adminExportUploadQueueSummary?: AdminStoreUploadQueueSummary;
  onRetryPendingAdminExportUploads?: () => Promise<string>;
  onListLinkableStoreBanks?: () => Promise<LinkExistingStoreBankCandidate[]>;
  onLinkExistingStoreBank?: (runtimeBankId: string, candidate: LinkExistingStoreBankCandidate) => Promise<string>;
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
  onResolveStoreRecoveryCatalogItem?: (bank: SamplerBank) => Promise<StoreRecoveryResolution | null>;
  onPrefetchOfficialBankMediaForOffline: (bankId: string) => Promise<{
    candidates: number;
    prefetched: number;
    failed: number;
  }>;
  getBankPreparedSummary: (bankId: string) => BankPreparedSummary;
  onPrepareBankForLive: (bankId: string, options?: { explicit?: boolean }) => Promise<void>;
  onCancelPrepareBankForLive: (bankId?: string) => void;
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
  onMoveBankToPosition,
  onTransferPad,
  canTransferFromBank,
  onExportAdmin,
  onUpdateStoreBank,
  adminExportUploadQueueSummary,
  onRetryPendingAdminExportUploads,
  onListLinkableStoreBanks,
  onLinkExistingStoreBank,
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
  onResolveStoreRecoveryCatalogItem,
  onPrefetchOfficialBankMediaForOffline,
  getBankPreparedSummary,
  onPrepareBankForLive,
  onCancelPrepareBankForLive,
  defaultBankColor = '#3b82f6',
}: SideMenuProps) {
  const logoSrc = `${import.meta.env.BASE_URL}assets/logo.png`;
  const isNativeCapacitorRuntime = React.useMemo(
    () => typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.()),
    []
  );
  const isElectronRuntime = React.useMemo(
    () => typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent),
    []
  );
  const shouldShowOfflinePrefetchAction = !isNativeCapacitorRuntime && !isElectronRuntime;
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showStoreDialog, setShowStoreDialog] = React.useState(false);
  const [showEditDialog, setShowEditDialog] = React.useState(false);
  const [editingBank, setEditingBank] = React.useState<SamplerBank | null>(null);
  const lastEditTokenRef = React.useRef<number | undefined>(undefined);
  const [newBankName, setNewBankName] = React.useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [bankToDelete, setBankToDelete] = React.useState<SamplerBank | null>(null);

  // Progress State
  const [showExportProgress, setShowExportProgress] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);
  const [exportStatus, setExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [exportError, setExportError] = React.useState<string>('');
  const [exportLogLines, setExportLogLines] = React.useState<string[]>([]);
  const [dragOverBankId, setDragOverBankId] = React.useState<string | null>(null);
  const [renderContent, setRenderContent] = React.useState(open);
  const [pendingBulkClearAction, setPendingBulkClearAction] = React.useState<'keys' | 'midi' | null>(null);
  const [offlinePrefetchBusyBankId, setOfflinePrefetchBusyBankId] = React.useState<string | null>(null);

  // Loading State
  const [isLoadingBanks, setIsLoadingBanks] = React.useState(true);

  // Toast notification state
  const [notices, setNotices] = React.useState<Notice[]>([]);
  const noticeRemovalTimersRef = React.useRef<Record<string, number>>({});
  const [snapshotBankAction, setSnapshotBankAction] = React.useState<{
    kind: 'download' | 'recover';
    bankId: string;
  } | null>(null);
  const [adminUploadRetryBusy, setAdminUploadRetryBusy] = React.useState(false);
  const [snapshotDownloadBusyBankId, setSnapshotDownloadBusyBankId] = React.useState<string | null>(null);
  const [snapshotRecoverBusyBankId, setSnapshotRecoverBusyBankId] = React.useState<string | null>(null);
  const [snapshotTransfers, setSnapshotTransfers] = React.useState<Record<string, TransferState>>({});
  const downloadedArtifactsRef = React.useRef<Record<string, StoreDownloadedArtifact>>({});

  const clearNoticeRemovalTimer = React.useCallback((id: string) => {
    const timer = noticeRemovalTimersRef.current[id];
    if (typeof timer !== 'number') return;
    window.clearTimeout(timer);
    delete noticeRemovalTimersRef.current[id];
  }, []);

  const removeNoticeNow = React.useCallback((id: string) => {
    clearNoticeRemovalTimer(id);
    setNotices((arr) => arr.filter((notice) => notice.id !== id));
  }, [clearNoticeRemovalTimer]);

  const dismissNotice = React.useCallback((id: string) => {
    setNotices((arr) => {
      const target = arr.find((notice) => notice.id === id);
      if (!target || target.closing) return arr;
      return arr.map((notice) => (notice.id === id ? { ...notice, closing: true } : notice));
    });
    clearNoticeRemovalTimer(id);
    noticeRemovalTimersRef.current[id] = window.setTimeout(() => removeNoticeNow(id), NOTICE_EXIT_MS);
  }, [clearNoticeRemovalTimer, removeNoticeNow]);

  const pushNotice = React.useCallback((n: Omit<Notice, 'id'>) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now() + Math.random());
    const notice: Notice = { id, ...n };
    setNotices((arr) => {
      const active = arr.filter((entry) => !entry.closing);
      const duplicate = active.some((entry) => entry.variant === notice.variant && entry.message === notice.message);
      if (duplicate) return arr;

      let next = [...active, notice];
      if (next.length > MAX_ACTIVE_NOTICES) {
        const [oldest, ...rest] = next;
        next = [{ ...oldest, closing: true }, ...rest];
        window.setTimeout(() => removeNoticeNow(oldest.id), NOTICE_EXIT_MS);
      }
      return next;
    });
    window.setTimeout(() => dismissNotice(id), NOTICE_AUTO_DISMISS_MS);
  }, [dismissNotice, removeNoticeNow]);

  React.useEffect(() => () => {
    Object.values(noticeRemovalTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    noticeRemovalTimersRef.current = {};
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

  const { user, profile } = useAuthState();
  const isAdmin = profile?.role === 'admin';
  const pendingAdminUploadCount = adminExportUploadQueueSummary?.pendingCount || 0;
  const nextAdminUploadRetryLabel = React.useMemo(() => {
    const nextRetryAt = adminExportUploadQueueSummary?.nextRetryAt || null;
    if (!nextRetryAt) return null;
    const retryDate = new Date(nextRetryAt);
    if (Number.isNaN(retryDate.getTime())) return null;
    return retryDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [adminExportUploadQueueSummary?.nextRetryAt]);
  const lastExportMilestoneRef = React.useRef(-1);
  const appendExportLog = React.useCallback((message: string) => {
    if (!isAdmin) return;
    appendProgressLogLine(setExportLogLines, message);
  }, [isAdmin]);

  React.useEffect(() => {
    if (!isAdmin || !showExportProgress || exportStatus !== 'loading') return;
    const handleOperationDebug = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      if (detail.operation !== 'bank_export') return;
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
        appendExportLog(`Heartbeat bank_export${lastStageText}${idleText}`);
        return;
      }
      if (phase === 'error' && typeof opDetails.message === 'string') {
        appendExportLog(`bank_export error: ${opDetails.message}`);
      }
    };
    window.addEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
    return () => window.removeEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
  }, [appendExportLog, exportStatus, isAdmin, showExportProgress]);

  const isHighGraphics = graphicsTier === 'high';
  const isLowGraphics = graphicsTier === 'low';
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
  const { storePreviewItems, showStoreNewBadge, markStorePreviewSeen } = useStorePreviewBadge({
    effectiveUser,
    profileId: profile?.id,
  });
  const displayName = profile?.display_name?.trim() || effectiveUser?.email?.split('@')[0] || 'Guest';
  const isLowestGraphics = graphicsTier === 'lowest';
  const requestStoreLogin = React.useCallback((reason?: string) => {
    requestLoginPrompt(reason || 'Please sign in to download this bank.');
  }, [requestLoginPrompt]);

  React.useEffect(() => {
    if (!showStoreDialog) return;
    markStorePreviewSeen();
  }, [markStorePreviewSeen, showStoreDialog]);

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
    source: ImportBankSource,
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

      const importedBank = await onImportBank(source, onProgress, {
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

  const buildSnapshotStoreItem = React.useCallback((
    bank: SamplerBank,
    resolvedItem?: StoreRecoveryResolution | null
  ): StoreItem | null => {
    const catalogItemId = typeof bank.bankMetadata?.catalogItemId === 'string'
      ? bank.bankMetadata.catalogItemId.trim()
      : (typeof resolvedItem?.catalogItemId === 'string' ? resolvedItem.catalogItemId.trim() : '');
    const storeBankId = typeof bank.bankMetadata?.bankId === 'string'
      ? bank.bankMetadata.bankId.trim()
      : (
        typeof bank.sourceBankId === 'string' && bank.sourceBankId.trim().length > 0
          ? bank.sourceBankId.trim()
          : (typeof resolvedItem?.bankId === 'string' ? resolvedItem.bankId.trim() : '')
      );
    if (!catalogItemId || !storeBankId) return null;
    const requiresGrant = Boolean(
      bank.restoreKind === 'paid_bank' ||
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
      asset_protection: requiresGrant ? 'encrypted' : 'public',
      is_pinned: false,
      is_owned: true,
      is_free_download: !requiresGrant,
      is_pending: false,
      is_rejected: false,
      is_downloadable: true,
      is_purchased: true,
      price_php: null,
      sha256: bank.bankMetadata?.catalogSha256 || resolvedItem?.sha256 || null,
      thumbnail_path: bank.bankMetadata?.thumbnailUrl || bank.bankMetadata?.remoteSnapshotThumbnailUrl || null,
      status: 'granted_download',
      rejection_message: null,
      bank: {
        title: bank.name,
        description: bank.bankMetadata?.description || '',
        color: bank.defaultColor || bank.bankMetadata?.color || defaultBankColor,
      }
    };
  }, [defaultBankColor]);

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

  const handleOfflinePrefetch = React.useCallback(async (bankId: string) => {
    setOfflinePrefetchBusyBankId(bankId);
    try {
      const result = await onPrefetchOfficialBankMediaForOffline(bankId);
      if (result.candidates === 0) {
        pushNotice({ variant: 'info', message: 'This bank is already available offline on this device.' });
        return;
      }
      if (result.prefetched > 0 && result.failed === 0) {
        pushNotice({
          variant: 'success',
          message: `Offline-ready: cached ${result.prefetched} pad${result.prefetched === 1 ? '' : 's'} for this bank.`,
        });
        return;
      }
      if (result.prefetched > 0) {
        pushNotice({
          variant: 'info',
          message: `Cached ${result.prefetched} pad${result.prefetched === 1 ? '' : 's'} offline. ${result.failed} pad${result.failed === 1 ? '' : 's'} still need network.`,
        });
        return;
      }
      pushNotice({ variant: 'error', message: 'Could not cache this bank for offline use.' });
    } finally {
      setOfflinePrefetchBusyBankId(null);
    }
  }, [onPrefetchOfficialBankMediaForOffline, pushNotice]);

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
    if (storePreviewItems.length === 0) return realEntries;

    const previewEntries: BankListEntry[] = storePreviewItems.map((preview) => ({ kind: 'preview', preview }));
    const defaultBankIndex = realEntries.findIndex(
      (entry) => entry.kind === 'real' && isCanonicalDefaultBankIdentity(entry.bank, banks)
    );

    if (defaultBankIndex < 0) {
      return [...realEntries, ...previewEntries];
    }

    return [
      ...realEntries.slice(0, defaultBankIndex + 1),
      ...previewEntries,
      ...realEntries.slice(defaultBankIndex + 1),
    ];
  }, [banks, sortedBanks, storePreviewItems]);

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
    if (isExplicitDefaultBankIdentity(bank)) return;
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

  const handleExportBank = async (bankId: string) => {
    const startedAt = Date.now();
    const exportBank = banks.find((candidate) => candidate.id === bankId);
    setShowExportProgress(true);
    setExportStatus('loading');
    setExportProgress(0);
    setExportError('');
    setExportLogLines([]);
    lastExportMilestoneRef.current = -1;
    appendExportLog(`Export requested: ${exportBank?.name || 'Bank'}`);
    appendExportLog('Preparing bank archive...');

    try {
      const exportMessage = await onExportBank(bankId, (progress) => {
        setExportProgress(progress);
        const rounded = Math.max(0, Math.min(100, Math.round(progress)));
        const milestone = rounded >= 100 ? 100 : Math.floor(rounded / 10) * 10;
        if (milestone >= 0 && milestone !== lastExportMilestoneRef.current) {
          lastExportMilestoneRef.current = milestone;
          appendExportLog(milestone >= 100 ? 'Export payload complete.' : `Export progress: ${milestone}%`);
        }
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < EXPORT_MIN_DIALOG_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, EXPORT_MIN_DIALOG_MS - elapsed));
      }
      setExportStatus('success');
      appendExportLog(exportMessage || 'Export complete.');
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
      const errorMessage = error instanceof Error ? error.message : 'Export failed';
      setExportError(errorMessage);
      appendExportLog(`Export failed: ${errorMessage}`);
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

    const dragData = parsePadDragTransferPayload(data);
    if (!dragData) return;

    if (dragData.sourceBankId !== bankId && canTransferFrom(dragData.sourceBankId)) {
      setDragOverBankId(bankId);
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

    const dragData = parsePadDragTransferPayload(data);
    if (!dragData) return;

    if (dragData.sourceBankId !== targetBankId && canTransferFrom(dragData.sourceBankId)) {
      onTransferPad(dragData.padId, dragData.sourceBankId, targetBankId);
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
  const getBackgroundLuminance = (backgroundColor: string) => {
    const hex = backgroundColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
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
          <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-2 pb-6">
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
              <div
                className={`relative min-w-0 overflow-visible ${showEnhancedStoreButton ? 'isolate rounded-xl' : ''}`}
              >
                {showEnhancedStoreButton && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                    style={{ contain: 'paint' }}
                  >
                    <div
                      className={`pointer-events-none absolute inset-0 -z-10 rounded-xl opacity-65 animate-pulse ${theme === 'dark'
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
                  </div>
                )}
                {showStoreNewBadge && (
                  <span
                    className={`pointer-events-none absolute -top-2 -right-2 z-[3] inline-flex h-5 min-w-[2.1rem] items-center justify-center rounded-full border px-1.5 text-[10px] font-bold uppercase tracking-[0.14em] shadow-sm ${
                      theme === 'dark'
                        ? 'border-rose-300/70 bg-rose-500 text-white'
                        : 'border-rose-200 bg-rose-500 text-white'
                    }`}
                    title="There are newly published banks in the store."
                  >
                    New
                  </span>
                )}
                <Button
                  onClick={() => {
                    markStorePreviewSeen();
                    setShowStoreDialog(true);
                  }}
                  className={`relative min-w-0 w-full overflow-hidden px-2 sm:px-3 text-[13px] sm:text-sm gap-0 transition-colors duration-200 ${showEnhancedStoreButton ? 'shadow-[0_0_14px_rgba(99,102,241,0.26)]' : ''} ${theme === 'dark'
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

            {isAdmin && pendingAdminUploadCount > 0 && onRetryPendingAdminExportUploads && (
              <div className={`mb-2 rounded-lg border p-2 ${theme === 'dark'
                ? 'border-sky-700 bg-sky-950/50 text-sky-100'
                : 'border-sky-200 bg-sky-50 text-sky-900'
                }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide">Store Upload Queue</p>
                    <p className="mt-1 text-xs">
                      {pendingAdminUploadCount === 1
                        ? '1 bank upload is waiting to reach Store.'
                        : `${pendingAdminUploadCount} bank uploads are waiting to reach Store.`}
                    </p>
                    <p className={`mt-1 text-[11px] ${theme === 'dark' ? 'text-sky-200/80' : 'text-sky-700'}`}>
                      {typeof navigator !== 'undefined' && !navigator.onLine
                        ? 'Waiting for internet connection.'
                        : nextAdminUploadRetryLabel
                          ? `Next automatic retry: ${nextAdminUploadRetryLabel}`
                          : 'Automatic retry is enabled while this app stays open.'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-8 shrink-0 ${theme === 'dark' ? 'border-sky-700 text-sky-100 hover:bg-sky-900/60' : 'border-sky-300 text-sky-800 hover:bg-sky-100'}`}
                    disabled={adminUploadRetryBusy}
                    onClick={async () => {
                      setAdminUploadRetryBusy(true);
                      try {
                        const message = await onRetryPendingAdminExportUploads();
                        pushNotice({ variant: 'info', message });
                      } catch (error) {
                        pushNotice({
                          variant: 'error',
                          message: error instanceof Error ? error.message : 'Could not retry pending Store uploads.',
                        });
                      } finally {
                        setAdminUploadRetryBusy(false);
                      }
                    }}
                  >
                    {adminUploadRetryBusy ? 'Retrying...' : 'Retry Now'}
                  </Button>
                </div>
              </div>
            )}

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
                const isHighThumbnailCard = isHighGraphics && !isActive && !!thumbnailUrl;
                const isMediumGradientCard = isMediumGraphics && !isActive && !!thumbnailUrl;
                const bankColorLuminance = getBackgroundLuminance(bankColor);
                const isLightFlatBankColor = !thumbnailUrl && bankColorLuminance > 0.88;
                const shouldUseBankColorText = !isActive && !isHighThumbnailCard && !isMediumGradientCard;
                const bankTextColorStyle = shouldUseBankColorText
                  ? { color: getTextColorForBackground(bankColor) }
                  : undefined;
                const highThumbnailTextStyle = isHighThumbnailCard
                  ? { color: '#ffffff', textShadow: '0 2px 6px rgba(0, 0, 0, 0.92)' }
                  : undefined;
                const highReadableBankTextStyle = isHighGraphics && isHighThumbnailCard
                  ? { textShadow: '0 2px 6px rgba(0, 0, 0, 0.88)' }
                  : undefined;
                const resolvedBankTextStyle = {
                  ...(isHighThumbnailCard ? highThumbnailTextStyle : bankTextColorStyle),
                  ...(highReadableBankTextStyle || {}),
                };
                const bankCardSpacingClass = isHighGraphics
                  ? 'p-2.5 rounded-xl'
                  : isLowestGraphics
                    ? 'p-1.5 rounded-md'
                    : 'p-2 rounded-lg';
                const bankTitleClass = isHighGraphics ? 'font-semibold text-[15px]' : 'font-medium text-sm';
                const bankMetaClass = isHighGraphics ? 'text-[11px] opacity-85' : 'text-xs opacity-75';
                const bankActionButtonClass = isHighGraphics ? 'p-1.5 h-7 w-7' : 'p-1 h-6 w-6';
                const bankOrderButtonClass = isHighGraphics ? 'p-0 h-4 w-5' : 'p-0 h-3 w-4';
                const bankShortcutChipClass = isHighGraphics
                  ? 'max-w-[76px] rounded px-2 py-1 text-[10px]'
                  : 'max-w-[64px] rounded px-2 py-0.5 text-[10px]';
                const inactiveBankCardStyle = !isActive
                  ? {
                    backgroundColor: isLowestGraphics
                      ? withAlpha(bankColor, theme === 'dark' ? 'CC' : 'D9')
                      : isLowGraphics
                        ? withAlpha(bankColor, theme === 'dark' ? 'B8' : 'CC')
                        : bankColor,
                    borderColor: withAlpha(bankColor, theme === 'dark' ? 'EE' : 'D9'),
                    ...(isHighGraphics
                      ? {
                        boxShadow: `inset 0 0 0 2px ${withAlpha(bankColor, 'CC')}`,
                      }
                      : {}),
                    ...(isLightFlatBankColor && theme === 'light'
                      ? {
                        boxShadow: `${isHighGraphics ? 'inset 0 0 0 2px rgba(148,163,184,0.55)' : 'inset 0 0 0 1.5px rgba(148,163,184,0.48)'}, 0 1px 0 rgba(15,23,42,0.04)`,
                      }
                      : {}),
                    ...(isMediumGradientCard
                      ? {
                        backgroundImage: `linear-gradient(to right, ${withAlpha(bankColor, theme === 'dark' ? 'F0' : 'E6')} 0%, ${withAlpha(bankColor, theme === 'dark' ? 'B8' : '99')} 34%, transparent 78%), url(${thumbnailUrl})`,
                        backgroundSize: 'cover, cover',
                        backgroundPosition: 'center, right center',
                      }
                      : isHighThumbnailCard
                        ? {
                          backgroundImage: `linear-gradient(to right, ${withAlpha(bankColor, 'F2')} 0%, ${withAlpha(bankColor, 'AA')} 32%, transparent 76%), url(${thumbnailUrl})`,
                          backgroundSize: 'cover, cover',
                          backgroundPosition: 'center, center',
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
                      : withAlpha(bankColor, 'E6');
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
                    className={`${bankCardSpacingClass} border-[1.5px] ${isLowestGraphics ? 'transition-none' : 'transition-all duration-200'} relative overflow-hidden ${isDragOver
                      ? 'ring-4 ring-orange-400 scale-[1.02] bg-orange-200'
                      : ''
                      } ${isLowestGraphics
                        ? (isActive
                          ? theme === 'dark'
                            ? 'cursor-pointer bg-slate-900/95 text-white shadow-[0_10px_24px_-18px_rgba(15,23,42,0.95)]'
                            : 'cursor-pointer bg-white text-gray-900 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)]'
                          : 'cursor-pointer'
                        )
                        : isActive
                        ? activeAccentClass
                        : theme === 'dark'
                          ? 'bg-gray-800/40 border-gray-700 text-gray-300 hover:bg-gray-700/60 hover:border-gray-500 cursor-pointer perf-high:backdrop-blur-sm'
                          : 'bg-white/40 border-gray-300 text-gray-700 hover:bg-white/80 hover:border-gray-400 cursor-pointer perf-high:backdrop-blur-sm'
                      }`}
                    style={isLowestGraphics
                      ? {
                        backgroundColor: isActive
                          ? undefined
                          : withAlpha(bankColor, theme === 'dark' ? 'CC' : 'D9'),
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
                        <h3 className={`${bankTitleClass} truncate`} title={bankName} style={resolvedBankTextStyle}>
                          {bankName.length > 15 ? `${bankName.substring(0, 15)}...` : bankName}
                        </h3>
                        {!isPreview && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <p className={bankMetaClass} style={resolvedBankTextStyle}>
                              {bank?.pads.length || 0} pad{bank?.pads.length !== 1 ? 's' : ''}
                            </p>
                            {bankShortcutLabel && !hideShortcutLabels && (
                              <span
                                className={`${bankShortcutChipClass} ml-auto font-semibold uppercase tracking-wide truncate text-right ${isHighThumbnailCard ? 'bg-black/45' : 'bg-black/20'}`}
                                style={resolvedBankTextStyle}
                                title={bankShortcutLabel}
                              >
                                {bankShortcutLabel}
                              </span>
                            )}
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
                            <p className="text-[10px] opacity-80" style={resolvedBankTextStyle}>
                              {snapshotTransfer.phase === 'importing'
                                ? `Importing ${normalizeProgress(snapshotTransfer.progress)}%`
                                : snapshotTransfer.phase === 'downloading'
                                  ? `Downloading ${normalizeProgress(snapshotTransfer.progress)}%`
                                  : snapshotTransfer.error || 'Download failed'}
                            </p>
                          </div>
                        )}
                      </div>
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
                            className={`${bankOrderButtonClass} transition-all duration-200 ${isHighThumbnailCard
                              ? 'text-white/85 hover:text-white hover:bg-black/35 disabled:text-white/30'
                              : theme === 'dark'
                                ? 'text-gray-400 hover:text-white hover:bg-gray-600 disabled:text-gray-600'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-white disabled:text-gray-400'
                              }`}
                            title="Move up"
                          >
                            <ChevronUp className={isHighGraphics ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
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
                            className={`${bankOrderButtonClass} transition-all duration-200 ${isHighThumbnailCard
                              ? 'text-white/85 hover:text-white hover:bg-black/35 disabled:text-white/30'
                              : theme === 'dark'
                                ? 'text-gray-400 hover:text-white hover:bg-gray-600 disabled:text-gray-600'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-white disabled:text-gray-400'
                              }`}
                            title="Move down"
                          >
                            <ChevronDown className={isHighGraphics ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
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
                          className={`${bankActionButtonClass} transition-all duration-200 ${isPrimary
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
                            <Crown className={isHighGraphics ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                          </Button>

                        {shouldShowOfflinePrefetchAction && !isPreview && bank && isExplicitDefaultBankIdentity(bank) && bank.pads.some((pad) => {
                          const hasUrlBackedAudio = Boolean(pad.audioUrl) && !pad.audioStorageKey && !pad.audioBackend;
                          const hasUrlBackedImage = Boolean(pad.imageUrl) && pad.hasImageAsset === true && !pad.imageStorageKey && !pad.imageBackend;
                          return hasUrlBackedAudio || hasUrlBackedImage;
                        }) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleOfflinePrefetch(bankId);
                            }}
                            disabled={offlinePrefetchBusyBankId === bankId}
                            className={`${bankActionButtonClass} transition-all duration-200 ${isHighThumbnailCard
                              ? 'text-white/85 hover:text-white hover:bg-black/35'
                              : theme === 'dark'
                                ? 'text-gray-400 hover:text-white hover:bg-gray-600'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-white'
                              }`}
                            title={offlinePrefetchBusyBankId === bankId ? 'Caching bank for offline use...' : 'Make available offline'}
                          >
                            {offlinePrefetchBusyBankId === bankId ? (
                              <Loader2 className={`${isHighGraphics ? 'w-3.5 h-3.5' : 'w-3 h-3'} animate-spin`} />
                            ) : (
                              <ArrowDownToLine className={isHighGraphics ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                            )}
                          </Button>
                        )}

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
                          className={`${bankActionButtonClass} transition-all duration-200 ${isHighThumbnailCard
                            ? 'text-white/85 hover:text-white hover:bg-black/35'
                            : theme === 'dark'
                              ? 'text-gray-400 hover:text-white hover:bg-gray-600'
                              : 'text-gray-600 hover:text-gray-900 hover:bg-white'
                            }`}
                        >
                          <Settings className={isHighGraphics ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
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
                disabled={snapshotDownloadBusyBankId === snapshotActionBank?.id}
                onClick={async () => {
                  if (!snapshotActionBank) return;
                  setSnapshotDownloadBusyBankId(snapshotActionBank.id);
                  try {
                    let item = buildSnapshotStoreItem(snapshotActionBank);
                    if (!item && onResolveStoreRecoveryCatalogItem) {
                      const resolvedItem = await onResolveStoreRecoveryCatalogItem(snapshotActionBank);
                      item = buildSnapshotStoreItem(snapshotActionBank, resolvedItem);
                    }
                    if (!item) {
                      pushNotice({
                        variant: 'error',
                        message: 'This restored bank is missing Store download metadata on this device. Restore your account backup or open Store once to refresh the bank record.',
                      });
                      setSnapshotBankAction(null);
                      return;
                    }
                    setSnapshotBankAction(null);
                    await handleSnapshotBankDownload(item);
                  } finally {
                    setSnapshotDownloadBusyBankId(null);
                  }
                }}
              >
                {snapshotDownloadBusyBankId === snapshotActionBank?.id ? 'Preparing Download...' : 'Download Bank'}
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
            <DialogTitle>Repair Missing Bank Media</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              {snapshotActionBank?.restoreKind === 'default_bank'
                ? 'This bank needs built-in Default Bank assets or custom media relinking on this device.'
                : 'This bank was restored from metadata only. Use .bank recovery or full backup to restore custom media on this device.'}
            </p>
            <div className={`rounded-md border p-3 text-xs ${theme === 'dark' ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              <div><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Repair from .bank Files:</span> restore custom banks or mixed banks from exports copied from the old device.</div>
              <div className="mt-1"><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Restore Account Backup:</span> fastest full-media restore if you exported an account backup on the old device.</div>
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
                Repair from .bank Files
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSnapshotBankAction(null);
                  onRequestRestoreBackup();
                }}
              >
                Restore Account Backup
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
            onApplyLocalBankUpdates={(updates) => {
              const nextUpdates: Partial<SamplerBank> = { ...updates };
              if (updates.shortcutKey === undefined && editingBank.shortcutKey) {
                nextUpdates.disableDefaultBankShortcutLayout = true;
              } else if (typeof updates.shortcutKey === 'string' && updates.shortcutKey.trim().length > 0) {
                nextUpdates.disableDefaultBankShortcutLayout = false;
              }
              onUpdateBank(editingBank.id, nextUpdates);
            }}
            onDelete={() => {
              if (isExplicitDefaultBankIdentity(editingBank)) return;
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
            onUpdateStoreBank={onUpdateStoreBank}
            onListLinkableStoreBanks={onListLinkableStoreBanks}
            onLinkExistingStoreBank={onLinkExistingStoreBank}
            onMoveToPosition={onMoveBankToPosition}
            preparedSummary={profile?.role === 'admin' ? getBankPreparedSummary(editingBank.id) : undefined}
            onPrepareForLive={profile?.role === 'admin'
              ? async (bankId) => {
                await onPrepareBankForLive(bankId, { explicit: true });
              }
              : undefined}
            onCancelPrepareForLive={profile?.role === 'admin' ? onCancelPrepareBankForLive : undefined}
            onAdminThumbnailChange={profile?.role === 'admin' ? async (thumbnail) => {
              const latestBank = banks.find((bank) => bank.id === editingBank.id);
              if (!latestBank) return;
              const currentMetadata = latestBank.bankMetadata;
              const nextThumbnailUrl = thumbnail?.thumbnailUrl;
              if (!nextThumbnailUrl && !currentMetadata?.thumbnailUrl && !currentMetadata?.thumbnailStorageKey) return;

              const previousBlobUrl = currentMetadata?.thumbnailUrl;
              if (
                previousBlobUrl &&
                previousBlobUrl.startsWith('blob:') &&
                previousBlobUrl !== nextThumbnailUrl
              ) {
                try { URL.revokeObjectURL(previousBlobUrl); } catch {}
              }

              if (currentMetadata) {
                onUpdateBank(latestBank.id, {
                  bankMetadata: {
                    ...currentMetadata,
                    thumbnailUrl: nextThumbnailUrl || undefined,
                    thumbnailStorageKey: thumbnail?.thumbnailStorageKey,
                    thumbnailBackend: thumbnail?.thumbnailBackend,
                  }
                });
                return;
              }

              if (nextThumbnailUrl) {
                onUpdateBank(latestBank.id, {
                  bankMetadata: {
                    password: false,
                    transferable: typeof latestBank.transferable === 'boolean' ? latestBank.transferable : true,
                    exportable: latestBank.exportable,
                    thumbnailUrl: nextThumbnailUrl,
                    thumbnailStorageKey: thumbnail?.thumbnailStorageKey,
                    thumbnailBackend: thumbnail?.thumbnailBackend,
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
        logLines={exportLogLines}
        debugOperations={['bank_export']}
        showLogPanel={isAdmin}
        supportLogFilePrefix="bank-export-error"
        hideCloseButton
        useHistory={false}
        onRetry={() => {
          if (banks.length > 0) {
            handleExportBank(banks[0].id);
          }
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
          runtimeCatalogShasBySource={React.useMemo(() => {
            const next: Record<string, string[]> = {};
            banks.forEach((bank) => {
              const sha = typeof bank.bankMetadata?.catalogSha256 === 'string'
                ? bank.bankMetadata.catalogSha256.trim().toLowerCase()
                : '';
              if (!sha) return;
              const keys = [
                typeof bank.bankMetadata?.bankId === 'string' ? bank.bankMetadata.bankId.trim() : '',
                typeof bank.sourceBankId === 'string' ? bank.sourceBankId.trim() : '',
              ].filter(Boolean);
              keys.forEach((key) => {
                if (!next[key]) next[key] = [];
                if (!next[key].includes(sha)) next[key].push(sha);
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
  );
}

