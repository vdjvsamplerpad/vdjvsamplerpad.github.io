import * as React from 'react';
import { PadData, SamplerBank } from '../types/sampler';
import {
  derivePassword,
  encryptZip,
  decryptZip,
  addBankMetadata,
} from '@/lib/bank-utils';
import { getCachedUser } from '@/hooks/useAuth';
import { ensureActivityRuntime, logActivityEvent } from '@/lib/activityLogger';
import { checkAdmission, extractMetadataFromFile } from '@/lib/audio-engine/AudioAdmission';
import {
  getBankDuplicateSignature,
  isFileAccessDeniedError,
} from './useSamplerStore.importUtils';
import type { ImportBankOptions } from './useSamplerStore.importBank';
import {
  coerceUploadHeaders,
  invokeUserExportApi,
  isNonRetryableGithubUploadError,
  patchAdminCatalogItem,
  uploadAdminCatalogAsset,
  uploadDefaultBankReleaseArchive,
  uploadUserExportAsset,
} from './useSamplerStore.exportUpload';
import {
  issueSignedAdminExportToken,
  sha256HexFromBlob,
  sha256HexFromText,
} from './useSamplerStore.exportSigning';
import {
  blobToBase64,
  extFromMime,
  inferImageExtFromPath,
  mimeFromExt,
  normalizeBase64Data,
  parseStorageKeyExt,
} from './useSamplerStore.mediaUtils';
import {
  base64ToBlob,
  buildDuplicateBankName,
  buildDuplicatePadName,
  detectAudioFormat,
  fileToBase64,
  remapSavedHotcuesForBakedTrim,
  shouldAttemptTrim,
  transcodeAudioToMP3,
  trimAudio,
} from './useSamplerStore.helpers';
import {
  PREPARED_HEAVY_RESUME_IDLE_MS,
  buildPadPreparedSourceSignature,
  hasMeaningfulPreparedTrim,
  isPreparedAudioCurrent,
  resolvePadPlaybackAudioUrl,
  resolvePreparedAudioClassification,
  resolvePreparedAudioKind,
  shouldPreparePadAudio,
  stripPreparedAudioPersistenceTransientFields,
  summarizeBankPreparedAudioState,
} from './preparedAudio';
import {
  deletePreparedAudioBlob,
  restorePreparedAudioUrl,
  savePreparedAudioBlob,
} from './preparedAudioStorage';
import {
  createSamplerMediaHelpers,
  type MediaBackend,
} from './useSamplerStore.mediaRuntime';
import {
  clearAdminUpdateRetryJobsForCatalogItem,
  type AdminExportUploadJob,
  type UserExportUploadJob,
} from './useSamplerStore.uploadQueue';
import { useSamplerStoreUploadQueueRuntime } from './useSamplerStore.uploadQueueRuntime';
import { runRestoreAllFilesPipeline } from './useSamplerStore.startupRestore';
import {
  readDefaultBankPadImagePreference,
  writeDefaultBankPadImagePreference,
} from './useSamplerStore.defaultBankImagePrefs';
import {
  readDefaultBankOwnerCache,
  writeDefaultBankOwnerCache,
} from './useSamplerStore.defaultBankOwnerCache';
import {
  type StoreRecoveryCatalogItem,
  type StoreRecoveryCatalogCache,
  persistStoreRecoveryCatalogItem as persistStoreRecoveryCatalogItemPipeline,
  resolveStoreRecoveryCatalogItem as resolveStoreRecoveryCatalogItemPipeline,
  downloadStoreBankArchiveForRecovery as downloadStoreBankArchiveForRecoveryPipeline,
} from './useSamplerStore.storeRecovery';
import {
  runRehydrateMissingMediaInBankPipeline,
  runRehydratePadMediaPipeline,
} from './useSamplerStore.mediaRecovery';
import { runRecoverMissingMediaFromBanksPipeline } from './useSamplerStore.mediaRecoveryBatch';
import { writeDefaultBankReleaseMetaState } from './useSamplerStore.defaultBankRelease';
import { runMergeImportedBankMissingMediaPipeline } from './useSamplerStore.mediaMergeRecovery';
import { useSamplerStoreBankLifecycle } from './useSamplerStore.bankLifecycle';
import { useSamplerStoreSession } from './useSamplerStore.session';
import { DEFAULT_SAMPLER_APP_CONFIG, type SamplerAppConfig } from '../samplerAppConfig';
import { useGlobalPlaybackManagerApi } from './useGlobalPlaybackManager';
import {
  runAddPadPipeline,
  runAddPadsPipeline,
  runCreateBankPipeline,
  runDeleteBankPipeline,
  runMoveBankDownPipeline,
  runMoveBankUpPipeline,
  runRemovePadPipeline,
  runReorderPadsPipeline,
  runSetCurrentBankPipeline,
  runSetPrimaryBankPipeline,
  runSetSecondaryBankPipeline,
  runTransferPadPipeline,
  runUpdateBankPipeline,
  runUpdatePadPipeline,
} from './useSamplerStore.bankCrud';
import {
  runHideProtectedBanksPipeline,
  runRestoreHiddenProtectedBanksPipeline,
} from './useSamplerStore.protectedBanks';
import {
  readHiddenProtectedBanksCache,
  sanitizeBankForHiddenProtectedCache,
  writeHiddenProtectedBanksCache,
} from './useSamplerStore.hiddenProtectedBanksCache';
import {
  countOwnedCountedBanks,
  dedupeBanksByIdentity,
  DEFAULT_BANK_SOURCE_ID,
  isDefaultBankIdentity,
  isOwnedCountedBankForQuota,
  normalizeIdentityToken,
  pruneBanksForGuestLock,
} from './useSamplerStore.bankIdentity';
import {
  readLastOpenBankIdFromCache,
  writeLastOpenBankIdToCache,
} from './useSamplerStore.lastOpenBankCache';
import {
  addOperationStage,
} from './useSamplerStore.operationDiagnostics';
import {
  ADMIN_EXPORT_UPLOAD_MAX_AGE_MS,
  ADMIN_EXPORT_UPLOAD_MAX_ATTEMPTS,
  USER_EXPORT_UPLOAD_MAX_AGE_MS,
  USER_EXPORT_UPLOAD_MAX_ATTEMPTS,
  computeUploadRetryAt,
  readAdminExportUploadQueue,
  readUserExportUploadQueue,
  writeAdminExportUploadQueue,
  writeUserExportUploadQueue,
} from './useSamplerStore.queuePersistence';
import {
  getLocalStorageItemSafe,
  setLocalStorageItemSafe,
} from './useSamplerStore.localStorage';
import {
  generateOperationId,
  getNowMs,
  yieldToMainThread,
} from './useSamplerStore.runtimeUtils';
import {
  generateId,
  getPadPositionOrFallback,
  normalizePadNameToken,
  padHasExpectedImageAsset,
  padNeedsMediaHydration,
} from './useSamplerStore.padHelpers';
import { ensureStorageHeadroom } from './useSamplerStore.storageHeadroom';
import {
  readIdbJsonFallback,
  writeIdbJsonFallback,
} from './useSamplerStore.idbJsonFallback';
import { createSamplerBackupRuntimeHelpers } from './useSamplerStore.backupRuntime';
import {
  type ExportAudioMode,
  type SamplerStore,
  type UpdateStoreBankInput,
} from './useSamplerStore.types';
import {
  saveBatchBlobsToDB,
} from './useSamplerStore.idbStorage';
import {
  applyResolvedOfficialPadMedia,
  buildSamplerMetadataSnapshot,
  deriveSnapshotRestoreStatus,
  materializeSnapshotBanks,
  reviveSamplerMetadataSnapshot,
  type SamplerMetadataSnapshot,
} from './useSamplerStore.snapshotMetadata';
import { saveUserSamplerMetadataSnapshot } from '@/lib/user-sampler-snapshot-api';

// Detect native Android runtime.
const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/.test(ua);

  const capacitor = (window as any).Capacitor;
  return isAndroid && capacitor?.isNativePlatform?.() === true;
};

const isNativeCapacitorPlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as any).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
};

const isElectronDesktopRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.electronAPI?.getSystemMemoryInfo || window.electronAPI?.transcodeAudioToMp3);
};

const transcodeAudioToMP3ForExport = (input: {
  source: Blob;
  startTimeMs?: number;
  endTimeMs?: number;
  applyTrim?: boolean;
  bitrate?: number;
}) =>
  transcodeAudioToMP3(input.source, {
    startTimeMs: input.startTimeMs,
    endTimeMs: input.endTimeMs,
    applyTrim: input.applyTrim,
    bitrate: input.bitrate,
  });

const EXPORT_FOLDER_NAME = 'VDJV-Export';
const ANDROID_DOWNLOAD_ROOT = '/storage/emulated/0/Download';
const NATIVE_MEDIA_ROOT = `${EXPORT_FOLDER_NAME}/_media`;
const EXPORT_LOGS_FOLDER = `${EXPORT_FOLDER_NAME}/logs`;
// Keep bridge payloads bounded while avoiding excessive chunk overhead on mobile export.
const CAPACITOR_EXPORT_SINGLE_WRITE_BYTES = 24 * 1024 * 1024;
const CAPACITOR_EXPORT_CHUNK_BYTES = 2 * 1024 * 1024;
const BACKUP_VERSION = 3;
const BACKUP_EXT = '.vdjvbackup';
const BACKUP_PART_EXT = '.vdjvpart';
const BACKUP_MANIFEST_SCHEMA = 'vdjv-backup-manifest-v1';
const BACKUP_MANIFEST_VERSION = 1;
const MAX_NATIVE_BANK_EXPORT_BYTES = 700 * 1024 * 1024;
const MAX_NATIVE_APP_BACKUP_BYTES = 1700 * 1024 * 1024;
const BACKUP_PART_SIZE_MOBILE_BYTES = 64 * 1024 * 1024;
const BACKUP_PART_SIZE_DESKTOP_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_PART_COUNT = 200;
const MAX_NATIVE_STARTUP_RESTORE_PADS = 320;
const MAX_CAPACITOR_NATIVE_AUDIO_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_CAPACITOR_NATIVE_IMAGE_WRITE_BYTES = 4 * 1024 * 1024;
const MAX_CAPACITOR_BRIDGE_READ_BYTES = 6 * 1024 * 1024;
const SELECTED_BANK_HYDRATION_MAX_RETRIES = 3;
const BACKUP_FILE_ACCESS_DENIED_MESSAGE =
  'Cannot read the selected backup file. Please pick it again from the in-app file picker and allow file access.';

const buildPadCapReachedMessage = (padCap: number): string =>
  `LIMITED: Max ${padCap} pads allowed per bank. Remove a pad or message us on facebook for expansion.`;

const STORAGE_KEY = 'vdjv-sampler-banks';
const STATE_STORAGE_KEY = 'vdjv-sampler-state';
const DEFAULT_BANK_OWNER_CACHE_KEY = 'vdjv-default-bank-by-owner';
const STORAGE_IDB_FALLBACK_KEY = 'state/sampler-banks-fallback.json';
const STATE_IDB_FALLBACK_KEY = 'state/sampler-ui-fallback.json';
const LAST_OPEN_BANK_KEY = 'vdjv-last-open-bank';
const SESSION_ENFORCEMENT_EVENT_KEY = 'vdjv-session-enforcement-event';
const HIDE_PROTECTED_BANKS_KEY = 'vdjv-hide-protected-banks';
const HIDDEN_PROTECTED_BANKS_CACHE_KEY = 'vdjv-hidden-protected-banks-by-user';
const DEFAULT_BANK_IMAGE_PREFS_KEY = 'vdjv-default-bank-image-prefs';
const DECK_LOADED_BANKS_EVENT = 'vdjv-deck-loaded-banks-changed';

// Shared password used when export is disabled.
// This path works for signed-in and signed-out imports.

const SHARED_EXPORT_DISABLED_PASSWORD = 'vdjv-export-disabled-2024-secure';
const {
  getBackupPartSizeBytes,
  buildBackupManifestName,
  splitBlobIntoParts,
  tryParseBackupManifestFile,
  readNativeExportBackupFileByName,
  resolveManifestBackupBlob,
  createOperationDiagnostics,
  ensureExportPermission,
  saveExportFile,
  writeOperationDiagnosticsLog,
  emitImportStage,
} = createSamplerBackupRuntimeHelpers({
  isNativeCapacitorPlatform,
  isNativeAndroid,
  exportFolderName: EXPORT_FOLDER_NAME,
  androidDownloadRoot: ANDROID_DOWNLOAD_ROOT,
  exportLogsFolder: EXPORT_LOGS_FOLDER,
  capacitorExportSingleWriteBytes: CAPACITOR_EXPORT_SINGLE_WRITE_BYTES,
  capacitorExportChunkBytes: CAPACITOR_EXPORT_CHUNK_BYTES,
  backupExt: BACKUP_EXT,
  backupPartExt: BACKUP_PART_EXT,
  backupManifestSchema: BACKUP_MANIFEST_SCHEMA,
  backupPartSizeMobileBytes: BACKUP_PART_SIZE_MOBILE_BYTES,
  backupPartSizeDesktopBytes: BACKUP_PART_SIZE_DESKTOP_BYTES,
  maxBackupPartCount: MAX_BACKUP_PART_COUNT,
  blobToBase64,
  normalizeBase64Data,
});

const {
  restoreFileAccess,
  storeFile,
  loadPadMediaBlob,
  loadPadMediaBlobWithUrlFallback,
  estimatePadMediaBytes,
  deletePadMediaArtifacts,
  collectMediaReferenceSet,
  deletePadMediaArtifactsExcept,
  estimateBankMediaBytes,
} = createSamplerMediaHelpers({
  isNativeCapacitorPlatform,
  nativeMediaRoot: NATIVE_MEDIA_ROOT,
  maxNativeAudioWriteBytes: MAX_CAPACITOR_NATIVE_AUDIO_WRITE_BYTES,
  maxNativeImageWriteBytes: MAX_CAPACITOR_NATIVE_IMAGE_WRITE_BYTES,
  maxCapacitorBridgeReadBytes: MAX_CAPACITOR_BRIDGE_READ_BYTES,
  extFromMime,
  mimeFromExt,
  parseStorageKeyExt,
  blobToBase64,
  normalizeBase64Data,
});

export function useSamplerStore(options?: { samplerConfig?: SamplerAppConfig }): SamplerStore {
  const samplerConfig = options?.samplerConfig || DEFAULT_SAMPLER_APP_CONFIG;
  const playbackManager = useGlobalPlaybackManagerApi();
  const {
    user,
    profile,
    loading,
    sessionConflictReason,
    quotaPolicy,
    authSessionMode,
    authSessionUserId,
    isGuestLockedSession,
  } = useSamplerStoreSession();
  const [banks, setBanks] = React.useState<SamplerBank[]>([]);
  const banksRef = React.useRef<SamplerBank[]>([]);
  const [isBanksHydrated, setIsBanksHydrated] = React.useState(false);
  const [primaryBankId, setPrimaryBankIdState] = React.useState<string | null>(null);
  const [secondaryBankId, setSecondaryBankIdState] = React.useState<string | null>(null);
  const [currentBankId, setCurrentBankIdState] = React.useState<string | null>(null);

  const primaryBank = React.useMemo(() => banks.find((b) => b.id === primaryBankId) || null, [banks, primaryBankId]);
  const secondaryBank = React.useMemo(() => banks.find((b) => b.id === secondaryBankId) || null, [banks, secondaryBankId]);
  const currentBank = React.useMemo(() => banks.find((b) => b.id === currentBankId) || null, [banks, currentBankId]);
  const isDualMode = React.useMemo(() => primaryBankId !== null, [primaryBankId]);
  const hiddenProtectedBanksByUserRef = React.useRef<Record<string, SamplerBank[]>>({});
  const hiddenProtectedBanksFallbackRef = React.useRef<SamplerBank[]>([]);
  const lastAuthenticatedUserIdRef = React.useRef<string | null>(null);
  const guestDefaultSelectionPendingRef = React.useRef(false);
  const previousGuestModeRef = React.useRef<boolean | null>(null);
  const previousHydratedRef = React.useRef(false);
  const selectionOwnerRef = React.useRef<string | null>(null);
  const selectionPersistenceOwnerRef = React.useRef<string | null | undefined>(undefined);
  const defaultBankOwnerRef = React.useRef<string | null | undefined>(undefined);
  const defaultBankPersistenceOwnerRef = React.useRef<string | null | undefined>(undefined);
  const missingMediaNoticeSignatureRef = React.useRef<string | null>(null);
  const selectedBankHydrationRunIdRef = React.useRef(0);
  const selectedBankHydrationRetryAttemptsRef = React.useRef<Record<string, number>>({});
  const selectedBankHydrationRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedBankHydrationRetryNonce, setSelectedBankHydrationRetryNonce] = React.useState(0);
  const mediaRestoreRunIdRef = React.useRef(0);
  const startupMediaRestoreInProgressRef = React.useRef(false);
  const [startupRestoreCompleted, setStartupRestoreCompleted] = React.useState(false);
  const backgroundBankHydrationRunIdRef = React.useRef(0);
  const backgroundBankHydrationInProgressRef = React.useRef(false);
  const defaultBankSyncRunIdRef = React.useRef(0);
  const defaultBankSyncSignatureRef = React.useRef<string | null>(null);
  const defaultBankSourceOverrideRef = React.useRef<SamplerBank | null>(null);
  const defaultBankSourceForceApplyRef = React.useRef(false);
  const defaultBankReleaseCheckStartedRef = React.useRef(false);
  const defaultBankReleaseInstallInProgressRef = React.useRef(false);
  const defaultBankSessionTransitionPendingRef = React.useRef(true);
  const [isDefaultBankSyncing, setIsDefaultBankSyncing] = React.useState(false);
  const [hasCompletedInitialDefaultBankSync, setHasCompletedInitialDefaultBankSync] = React.useState(false);
  const [defaultBankSourceRevision, setDefaultBankSourceRevision] = React.useState(0);
  const recentPreparedBankOrderRef = React.useRef<string[]>([]);
  const deckLoadedPreparedBankIdsRef = React.useRef<Set<string>>(new Set());
  const preparedQueueRunIdRef = React.useRef(0);
  const preparedQueueActiveBankIdRef = React.useRef<string | null>(null);
  const preparedExplicitBankIdsRef = React.useRef<Set<string>>(new Set());
  const [preparedQueueNonce, setPreparedQueueNonce] = React.useState(0);
  const [preparedPlaybackActive, setPreparedPlaybackActive] = React.useState(false);
  const [preparedPlaybackIdleNonce, setPreparedPlaybackIdleNonce] = React.useState(0);
  const preparedAutoQueueEnabled = React.useMemo(() => isElectronDesktopRuntime(), []);
  const preparedLastPlaybackActivityRef = React.useRef<number>(0);
  const preparedPlaybackIdleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exportUploadQueue, setExportUploadQueue] = React.useState<UserExportUploadJob[]>(() => readUserExportUploadQueue());
  const exportUploadQueueRef = React.useRef<UserExportUploadJob[]>(exportUploadQueue);
  const exportUploadProcessingRef = React.useRef(false);
  const exportUploadBlobCacheRef = React.useRef<Map<string, Blob>>(new Map());
  const exportUploadTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adminExportUploadQueue, setAdminExportUploadQueue] = React.useState<AdminExportUploadJob[]>(() => readAdminExportUploadQueue());
  const adminExportUploadQueueRef = React.useRef<AdminExportUploadJob[]>(adminExportUploadQueue);
  const adminExportUploadProcessingRef = React.useRef(false);
  const adminExportUploadBlobCacheRef = React.useRef<Map<string, Blob>>(new Map());
  const adminExportUploadTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRecoveryCatalogCacheRef = React.useRef<StoreRecoveryCatalogCache>({
    fetchedAt: 0,
    byBankId: {},
  });

  const setHiddenProtectedBanks = React.useCallback((ownerId: string | null, hiddenBanks: SamplerBank[]) => {
    if (ownerId) {
      if (hiddenBanks.length) {
        hiddenProtectedBanksByUserRef.current[ownerId] = hiddenBanks;
      } else {
        delete hiddenProtectedBanksByUserRef.current[ownerId];
      }
      const persisted = readHiddenProtectedBanksCache(HIDDEN_PROTECTED_BANKS_CACHE_KEY);
      const persistedHiddenBanks = hiddenBanks.map((bank) => sanitizeBankForHiddenProtectedCache(bank));
      if (persistedHiddenBanks.length) {
        persisted[ownerId] = persistedHiddenBanks;
      } else {
        delete persisted[ownerId];
      }
      writeHiddenProtectedBanksCache(HIDDEN_PROTECTED_BANKS_CACHE_KEY, persisted);
      return;
    }
    hiddenProtectedBanksFallbackRef.current = hiddenBanks;
  }, []);

  const getHiddenProtectedBanks = React.useCallback((ownerId: string | null): SamplerBank[] => {
    if (ownerId) {
      const inMemory = hiddenProtectedBanksByUserRef.current[ownerId];
      if (Array.isArray(inMemory) && inMemory.length > 0) return inMemory;
      const persistedCache = readHiddenProtectedBanksCache(HIDDEN_PROTECTED_BANKS_CACHE_KEY);
      const persisted = persistedCache[ownerId];
      if (Array.isArray(persisted) && persisted.length > 0) {
        hiddenProtectedBanksByUserRef.current[ownerId] = persisted;
        return persisted;
      }
      return [];
    }
    return hiddenProtectedBanksFallbackRef.current;
  }, []);

  const isProtectedBanksLockActive = React.useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(HIDE_PROTECTED_BANKS_KEY) === '1';
  }, []);

  const readLastOpenBankId = React.useCallback(
    (ownerId: string | null): string | null => readLastOpenBankIdFromCache(LAST_OPEN_BANK_KEY, ownerId),
    []
  );

  const writeLastOpenBankId = React.useCallback(
    (ownerId: string | null, bankId: string | null): void =>
      writeLastOpenBankIdToCache(LAST_OPEN_BANK_KEY, ownerId, bankId),
    []
  );

  const resolveDefaultBankPreferenceOwnerId = React.useCallback(
    (): string | null => authSessionUserId || null,
    [authSessionUserId]
  );

  const getDefaultBankPadImagePreference = React.useCallback(
    (padId: string): 'none' | null =>
      readDefaultBankPadImagePreference(
        DEFAULT_BANK_IMAGE_PREFS_KEY,
        resolveDefaultBankPreferenceOwnerId(),
        padId
      ),
    [resolveDefaultBankPreferenceOwnerId]
  );

  const writeDefaultBankPadImagePreferenceForOwner = React.useCallback(
    (padId: string, preference: 'none' | null): void => {
      writeDefaultBankPadImagePreference(
        DEFAULT_BANK_IMAGE_PREFS_KEY,
        resolveDefaultBankPreferenceOwnerId(),
        padId,
        preference
      );
    },
    [resolveDefaultBankPreferenceOwnerId]
  );

  const revokePreparedAudioUrl = React.useCallback((pad: Partial<PadData> | null | undefined) => {
    if (pad?.preparedAudioUrl?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(pad.preparedAudioUrl);
      } catch {
        // Ignore URL cleanup failures.
      }
    }
  }, []);

  const normalizePreparedPadState = React.useCallback((pad: PadData): PadData => {
    const nextPad = { ...pad };
    const currentSignature = buildPadPreparedSourceSignature(nextPad);
    const hasPreparedAsset = Boolean(nextPad.preparedAudioStorageKey && nextPad.preparedAudioStorageKey.trim().length > 0);

    if (!hasPreparedAsset) {
      revokePreparedAudioUrl(nextPad);
      nextPad.preparedAudioUrl = undefined;
      if (
        nextPad.preparedStatus &&
        nextPad.preparedStatus !== 'none' &&
        nextPad.preparedStatus !== 'queued' &&
        nextPad.preparedStatus !== 'preparing'
      ) {
        nextPad.preparedStatus = 'none';
      }
      nextPad.preparedSourceSignature = undefined;
      nextPad.preparedBytes = undefined;
      nextPad.preparedAt = undefined;
      nextPad.preparedDurationMs = undefined;
      nextPad.preparedAudioKind = undefined;
      nextPad.preparedAudioBackend = undefined;
      return nextPad;
    }

    if (
      typeof nextPad.preparedSourceSignature === 'string' &&
      nextPad.preparedSourceSignature.length > 0 &&
      nextPad.preparedSourceSignature !== currentSignature
    ) {
      revokePreparedAudioUrl(nextPad);
      nextPad.preparedAudioUrl = undefined;
      nextPad.preparedStatus = 'stale';
    }

    if (
      nextPad.preparedStatus === 'ready' &&
      (!nextPad.preparedSourceSignature || nextPad.preparedSourceSignature !== currentSignature)
    ) {
      nextPad.preparedStatus = 'stale';
    }

    return nextPad;
  }, [revokePreparedAudioUrl]);

  const rehydratePreparedAudioForPad = React.useCallback(async (pad: PadData): Promise<PadData> => {
    const normalizedPad = normalizePreparedPadState(pad);
    if (
      !normalizedPad.preparedAudioStorageKey ||
      normalizedPad.preparedStatus === 'queued' ||
      normalizedPad.preparedStatus === 'preparing'
    ) {
      return normalizedPad;
    }

    if (normalizedPad.preparedAudioUrl && normalizedPad.preparedAudioUrl.trim().length > 0) {
      return normalizedPad;
    }

    const restored = await restorePreparedAudioUrl(
      normalizedPad.id,
      normalizedPad.preparedAudioStorageKey,
      normalizedPad.preparedAudioBackend,
    );
    if (!restored.url) {
      if (normalizedPad.preparedStatus === 'ready') {
        return {
          ...normalizedPad,
          preparedStatus: 'stale',
          preparedAudioUrl: undefined,
        };
      }
      return normalizedPad;
    }

    return {
      ...normalizedPad,
      preparedAudioUrl: restored.url,
      preparedAudioStorageKey: restored.storageKey || normalizedPad.preparedAudioStorageKey,
      preparedAudioBackend: restored.backend || normalizedPad.preparedAudioBackend,
    };
  }, [banks, normalizePreparedPadState]);

  const rehydratePadMediaFromStorage = React.useCallback(async (pad: PadData): Promise<PadData> => {
    const restoredPad: PadData = {
      ...pad,
      savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
        ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
        : [null, null, null, null],
    };

    if (pad.audioStorageKey || pad.audioBackend) {
      const restoredAudio = await restoreFileAccess(
        pad.id,
        'audio',
        pad.audioStorageKey,
        pad.audioBackend
      );
      if (restoredAudio.url) restoredPad.audioUrl = restoredAudio.url;
      if (restoredAudio.storageKey) restoredPad.audioStorageKey = restoredAudio.storageKey;
      restoredPad.audioBackend = restoredAudio.backend;
    }

    if (pad.imageStorageKey || pad.imageBackend) {
      const restoredImage = await restoreFileAccess(
        pad.id,
        'image',
        pad.imageStorageKey,
        pad.imageBackend
      );
      if (restoredImage.url) restoredPad.imageUrl = restoredImage.url;
      if (restoredImage.storageKey) restoredPad.imageStorageKey = restoredImage.storageKey;
      restoredPad.imageBackend = restoredImage.backend;
      if (restoredImage.url) restoredPad.hasImageAsset = true;
    }
    if (!restoredPad.imageUrl && pad.imageData) {
      try {
        restoredPad.imageUrl = URL.createObjectURL(base64ToBlob(pad.imageData));
        restoredPad.imageBackend = 'idb';
        restoredPad.hasImageAsset = true;
      } catch {
        // Ignore image data fallback errors.
      }
    }
    return await rehydratePreparedAudioForPad(restoredPad);
  }, [rehydratePreparedAudioForPad, restoreFileAccess, yieldToMainThread]);

  const rehydrateBankMediaFromStorage = React.useCallback(async (bank: SamplerBank): Promise<SamplerBank> => {
    const restoredPads: PadData[] = [];
    for (let i = 0; i < bank.pads.length; i += 1) {
      restoredPads.push(await rehydratePadMediaFromStorage(bank.pads[i]));
      if ((i + 1) % 6 === 0) await yieldToMainThread();
    }
    const thumbnailStorageId = `bank-thumbnail-${bank.id}`;
    let nextMetadata = bank.bankMetadata;
    if (nextMetadata?.thumbnailStorageKey || nextMetadata?.thumbnailBackend) {
      try {
        const currentThumbnailUrl = typeof nextMetadata.thumbnailUrl === 'string' ? nextMetadata.thumbnailUrl.trim() : '';
        if (currentThumbnailUrl.startsWith('blob:')) {
          return { ...bank, pads: restoredPads, bankMetadata: nextMetadata };
        }
        const restoredThumbnail = await restoreFileAccess(
          thumbnailStorageId,
          'image',
          nextMetadata.thumbnailStorageKey,
          nextMetadata.thumbnailBackend
        );
        nextMetadata = {
          ...nextMetadata,
          thumbnailUrl: restoredThumbnail.url || (/^https?:\/\//i.test(currentThumbnailUrl) ? currentThumbnailUrl : undefined),
          thumbnailStorageKey: restoredThumbnail.storageKey || nextMetadata.thumbnailStorageKey,
          thumbnailBackend: restoredThumbnail.backend || nextMetadata.thumbnailBackend,
        };
      } catch {
        // Ignore thumbnail restore failures and keep any durable remote URL.
      }
    }
    return { ...bank, pads: restoredPads, bankMetadata: nextMetadata };
  }, [rehydratePadMediaFromStorage, restoreFileAccess, yieldToMainThread]);

  React.useEffect(() => {
    ensureActivityRuntime();
  }, []);

  React.useEffect(() => {
    if (user?.id) {
      lastAuthenticatedUserIdRef.current = user.id;
    }
  }, [user?.id]);

  React.useEffect(() => {
    banksRef.current = banks;
  }, [banks]);

  React.useEffect(() => {
    const activeIds = [currentBankId, primaryBankId, secondaryBankId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (activeIds.length === 0) return;
    recentPreparedBankOrderRef.current = [
      ...activeIds,
      ...recentPreparedBankOrderRef.current.filter((id) => !activeIds.includes(id)),
    ];
  }, [currentBankId, primaryBankId, secondaryBankId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDeckLoadedBanksChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ bankIds?: unknown }>).detail;
      const bankIds = Array.isArray(detail?.bankIds)
        ? detail.bankIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
      deckLoadedPreparedBankIdsRef.current = new Set(bankIds);
      setPreparedQueueNonce((value) => value + 1);
    };

    window.addEventListener(DECK_LOADED_BANKS_EVENT, handleDeckLoadedBanksChanged as EventListener);
    return () => {
      window.removeEventListener(DECK_LOADED_BANKS_EVENT, handleDeckLoadedBanksChanged as EventListener);
      deckLoadedPreparedBankIdsRef.current = new Set();
    };
  }, []);

  React.useEffect(() => {
    const syncPlaybackState = () => {
      const hasActivePadPlayback = playbackManager.getAllPlayingPads().length > 0;
      const hasActiveDeckPlayback = playbackManager.getDeckChannelStates().some((channel) => channel.isPlaying);
      const nextActive = hasActivePadPlayback || hasActiveDeckPlayback;
      const now = Date.now();

      if (preparedPlaybackIdleTimerRef.current !== null) {
        clearTimeout(preparedPlaybackIdleTimerRef.current);
        preparedPlaybackIdleTimerRef.current = null;
      }

      if (nextActive) {
        preparedLastPlaybackActivityRef.current = now;
        setPreparedPlaybackActive(true);
        return;
      }

      preparedLastPlaybackActivityRef.current = now;
      setPreparedPlaybackActive(false);
      preparedPlaybackIdleTimerRef.current = setTimeout(() => {
        preparedPlaybackIdleTimerRef.current = null;
        setPreparedPlaybackIdleNonce((value) => value + 1);
      }, PREPARED_HEAVY_RESUME_IDLE_MS);
    };

    syncPlaybackState();
    playbackManager.addStateChangeListener(syncPlaybackState);
    return () => {
      playbackManager.removeStateChangeListener(syncPlaybackState);
      if (preparedPlaybackIdleTimerRef.current !== null) {
        clearTimeout(preparedPlaybackIdleTimerRef.current);
        preparedPlaybackIdleTimerRef.current = null;
      }
    };
  }, [playbackManager]);

  React.useEffect(() => {
    if (preparedAutoQueueEnabled) return;
    setBanks((prev) => {
      let changed = false;
      const next = prev.map((bank) => {
        let bankChanged = false;
        const nextPads = bank.pads.map((pad) => {
          if (pad.preparedStatus !== 'queued' && pad.preparedStatus !== 'preparing') {
            return pad;
          }
          bankChanged = true;
          return {
            ...pad,
            preparedStatus: 'none' as const,
          };
        });
        if (!bankChanged) return bank;
        changed = true;
        return {
          ...bank,
          pads: nextPads,
        };
      });
      return changed ? next : prev;
    });
  }, [preparedAutoQueueEnabled]);

  React.useEffect(() => {
    setBanks((prev) => {
      let changed = false;
      const next = prev.map((bank) => {
        let bankChanged = false;
        const nextPads = bank.pads.map((pad) => {
          const normalized = normalizePreparedPadState(pad);
          const padChanged =
            normalized.preparedStatus !== pad.preparedStatus ||
            normalized.preparedSourceSignature !== pad.preparedSourceSignature ||
            normalized.preparedAudioUrl !== pad.preparedAudioUrl ||
            normalized.preparedAudioKind !== pad.preparedAudioKind ||
            normalized.preparedBytes !== pad.preparedBytes ||
            normalized.preparedAt !== pad.preparedAt ||
            normalized.preparedDurationMs !== pad.preparedDurationMs;
          if (padChanged) {
            bankChanged = true;
            return normalized;
          }
          return pad;
        });
        if (bankChanged) {
          changed = true;
          return {
            ...bank,
            pads: nextPads,
          };
        }
        return bank;
      });
      return changed ? next : prev;
    });
  }, [normalizePreparedPadState]);

  const updatePreparedPadState = React.useCallback((
    bankId: string,
    padId: string,
    updater: (pad: PadData) => PadData
  ) => {
    setBanks((prev) => prev.map((bank) => {
      if (bank.id !== bankId) return bank;
      let changed = false;
      const nextPads = bank.pads.map((pad) => {
        if (pad.id !== padId) return pad;
        const updated = normalizePreparedPadState(updater(pad));
        const padChanged = updated !== pad &&
          (
            updated.preparedStatus !== pad.preparedStatus ||
            updated.preparedAudioUrl !== pad.preparedAudioUrl ||
            updated.preparedAudioStorageKey !== pad.preparedAudioStorageKey ||
            updated.preparedAudioBackend !== pad.preparedAudioBackend ||
            updated.preparedAudioKind !== pad.preparedAudioKind ||
            updated.preparedSourceSignature !== pad.preparedSourceSignature ||
            updated.preparedBytes !== pad.preparedBytes ||
            updated.preparedAt !== pad.preparedAt ||
            updated.preparedDurationMs !== pad.preparedDurationMs
          );
        if (!padChanged) return pad;
        changed = true;
        return updated;
      });
      return changed ? { ...bank, pads: nextPads } : bank;
    }));
  }, [normalizePreparedPadState]);

  const preparePadForPlayback = React.useCallback(async (
    bankId: string,
    pad: PadData,
    explicit: boolean,
    runId?: number
  ): Promise<void> => {
    const normalizedPad = normalizePreparedPadState(pad);
    if (!shouldPreparePadAudio(normalizedPad, explicit)) return;

    const sourceSignature = buildPadPreparedSourceSignature(normalizedPad);
    if (isPreparedAudioCurrent(normalizedPad)) {
      const hydratedPrepared = await rehydratePreparedAudioForPad(normalizedPad);
      if (
        hydratedPrepared.preparedAudioUrl !== normalizedPad.preparedAudioUrl ||
        hydratedPrepared.preparedStatus !== normalizedPad.preparedStatus
      ) {
        updatePreparedPadState(bankId, pad.id, () => hydratedPrepared);
      }
      return;
    }

    updatePreparedPadState(bankId, pad.id, (currentPad) => ({
      ...currentPad,
      preparedStatus: 'preparing',
      preparedSourceSignature: sourceSignature,
    }));

    try {
      const sourceBlob = await loadPadMediaBlobWithUrlFallback(normalizedPad, 'audio');
      if (!sourceBlob) {
        throw new Error('Prepared audio source could not be loaded.');
      }

      let preparedBlob = sourceBlob;
      let preparedDurationMs = normalizedPad.audioDurationMs;
      const preparedKind = resolvePreparedAudioKind(normalizedPad, explicit);
      if (preparedKind === 'trimmed_lossless' && hasMeaningfulPreparedTrim(normalizedPad)) {
        const trimResult = await trimAudio(
          sourceBlob,
          normalizedPad.startTimeMs,
          normalizedPad.endTimeMs,
          detectAudioFormat(sourceBlob)
        );
        preparedBlob = trimResult.blob;
        preparedDurationMs = trimResult.newDurationMs;
      }

      const storedPrepared = await savePreparedAudioBlob(normalizedPad.id, preparedBlob);
      const restoredPrepared = await restorePreparedAudioUrl(
        normalizedPad.id,
        storedPrepared.storageKey,
        storedPrepared.backend
      );
      if (typeof runId === 'number' && preparedQueueRunIdRef.current !== runId) {
        return;
      }

      setBanks((prev) => prev.map((bank) => {
        if (bank.id !== bankId) return bank;
        const padIndex = bank.pads.findIndex((entry) => entry.id === normalizedPad.id);
        if (padIndex < 0) return bank;
        const currentPad = bank.pads[padIndex];
        if (buildPadPreparedSourceSignature(currentPad) !== sourceSignature) {
          return bank;
        }
        revokePreparedAudioUrl(currentPad);
        const nextPad = normalizePreparedPadState({
          ...currentPad,
          preparedAudioUrl: restoredPrepared.url || undefined,
          preparedAudioStorageKey: storedPrepared.storageKey,
          preparedAudioBackend: storedPrepared.backend,
          preparedAudioKind: preparedKind,
          preparedSourceSignature: sourceSignature,
          preparedStatus: 'ready',
          preparedBytes: preparedBlob.size,
          preparedAt: Date.now(),
          preparedDurationMs: typeof preparedDurationMs === 'number' && Number.isFinite(preparedDurationMs)
            ? preparedDurationMs
            : currentPad.audioDurationMs,
        });
        const nextPads = [...bank.pads];
        nextPads[padIndex] = nextPad;
        return {
          ...bank,
          pads: nextPads,
        };
      }));
    } catch {
      if (typeof runId === 'number' && preparedQueueRunIdRef.current !== runId) {
        return;
      }
      updatePreparedPadState(bankId, pad.id, (currentPad) => ({
        ...currentPad,
        preparedStatus: 'error',
        preparedAudioUrl: undefined,
      }));
    }
  }, [
    detectAudioFormat,
    loadPadMediaBlobWithUrlFallback,
    normalizePreparedPadState,
    rehydratePreparedAudioForPad,
    revokePreparedAudioUrl,
    trimAudio,
    updatePreparedPadState,
  ]);

  const getBankPreparedSummary = React.useCallback((bankId: string) => {
    const bank = banksRef.current.find((entry) => entry.id === bankId);
    return bank
      ? summarizeBankPreparedAudioState(bank)
      : { status: 'none' as const, label: 'Not prepared' as const, readyPads: 0, activePads: 0 };
  }, []);

  const cancelPrepareBankForLive = React.useCallback((bankId?: string) => {
    if (!bankId) {
      preparedExplicitBankIdsRef.current.clear();
      preparedQueueRunIdRef.current += 1;
      preparedQueueActiveBankIdRef.current = null;
      setBanks((prev) => prev.map((bank) => ({
        ...bank,
        pads: bank.pads.map((pad) => (
          pad.preparedStatus === 'queued' || pad.preparedStatus === 'preparing'
            ? { ...pad, preparedStatus: 'none' }
            : pad
        )),
      })));
      setPreparedQueueNonce((value) => value + 1);
      return;
    }

    preparedExplicitBankIdsRef.current.delete(bankId);
    if (preparedQueueActiveBankIdRef.current === bankId) {
      preparedQueueRunIdRef.current += 1;
      preparedQueueActiveBankIdRef.current = null;
    }
    setBanks((prev) => prev.map((bank) => (
      bank.id !== bankId
        ? bank
        : {
            ...bank,
            pads: bank.pads.map((pad) => (
              pad.preparedStatus === 'queued' || pad.preparedStatus === 'preparing'
                ? { ...pad, preparedStatus: 'none' }
                : pad
            )),
          }
    )));
    setPreparedQueueNonce((value) => value + 1);
  }, []);

  const prepareBankForLive = React.useCallback(async (
    bankId: string,
    options?: { explicit?: boolean }
  ): Promise<void> => {
    const explicit = options?.explicit !== false;
    preparedExplicitBankIdsRef.current.add(bankId);
    setBanks((prev) => prev.map((bank) => (
      bank.id !== bankId
        ? bank
        : {
            ...bank,
            pads: bank.pads.map((pad) => {
              const normalizedPad = normalizePreparedPadState(pad);
              if (!shouldPreparePadAudio(normalizedPad, explicit)) return normalizedPad;
              if (isPreparedAudioCurrent(normalizedPad)) return normalizedPad;
              return {
                ...normalizedPad,
                preparedStatus: normalizedPad.preparedStatus === 'preparing' ? 'preparing' : 'queued',
                preparedSourceSignature: buildPadPreparedSourceSignature(normalizedPad),
              };
            }),
          }
    )));
    setPreparedQueueNonce((value) => value + 1);
  }, [normalizePreparedPadState]);

  React.useEffect(() => {
    if (!isBanksHydrated) return;
    if (!startupRestoreCompleted) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;
    if (preparedPlaybackActive) return;
    if (Date.now() - preparedLastPlaybackActivityRef.current < PREPARED_HEAVY_RESUME_IDLE_MS) return;
    if (!preparedAutoQueueEnabled && preparedExplicitBankIdsRef.current.size === 0) return;

    const priorityBankIds: string[] = [];
    const pushPriorityBankId = (value: string | null | undefined) => {
      if (!value || priorityBankIds.includes(value)) return;
      priorityBankIds.push(value);
    };

    Array.from(preparedExplicitBankIdsRef.current).forEach(pushPriorityBankId);
    if (preparedAutoQueueEnabled) {
      pushPriorityBankId(currentBankId);
      pushPriorityBankId(primaryBankId);
      pushPriorityBankId(secondaryBankId);
      Array.from(deckLoadedPreparedBankIdsRef.current).forEach(pushPriorityBankId);
      recentPreparedBankOrderRef.current.forEach(pushPriorityBankId);
      banks.forEach((bank) => pushPriorityBankId(bank.id));
    }

    if (priorityBankIds.length === 0) return;

    let cancelled = false;
    const runId = preparedQueueRunIdRef.current + 1;
    preparedQueueRunIdRef.current = runId;

    const runPreparedQueue = async () => {
      for (const bankId of priorityBankIds) {
        if (cancelled || preparedQueueRunIdRef.current !== runId) return;
        const bank = banksRef.current.find((entry) => entry.id === bankId);
        if (!bank) continue;
        const explicit = preparedExplicitBankIdsRef.current.has(bankId);
        const candidates = bank.pads.filter((pad) => {
          const normalizedPad = normalizePreparedPadState(pad);
          if (!shouldPreparePadAudio(normalizedPad, explicit)) return false;
          if (normalizedPad.preparedStatus === 'preparing') return false;
          return !isPreparedAudioCurrent(normalizedPad);
        });
        if (candidates.length === 0) {
          if (explicit) {
            preparedExplicitBankIdsRef.current.delete(bankId);
          }
          continue;
        }

        preparedQueueActiveBankIdRef.current = bankId;
        const prioritizedCandidates = [...candidates].sort((left, right) => {
          const leftRank = resolvePreparedAudioClassification(left) === 'long_heavy' ? 0 : 1;
          const rightRank = resolvePreparedAudioClassification(right) === 'long_heavy' ? 0 : 1;
          return leftRank - rightRank;
        });

        for (const pad of prioritizedCandidates) {
          if (cancelled || preparedQueueRunIdRef.current !== runId || preparedPlaybackActive) return;
          await preparePadForPlayback(bankId, pad, explicit, runId);
          await yieldToMainThread();
        }

        preparedQueueActiveBankIdRef.current = null;
        if (explicit) {
          preparedExplicitBankIdsRef.current.delete(bankId);
          setPreparedQueueNonce((value) => value + 1);
        }
      }
    };

    void runPreparedQueue();
    return () => {
      cancelled = true;
      if (preparedQueueRunIdRef.current === runId) {
        preparedQueueActiveBankIdRef.current = null;
      }
    };
  }, [
    banks,
    currentBankId,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    preparePadForPlayback,
    preparedPlaybackActive,
    preparedPlaybackIdleNonce,
    preparedQueueNonce,
    preparedAutoQueueEnabled,
    primaryBankId,
    secondaryBankId,
    startupRestoreCompleted,
    yieldToMainThread,
    normalizePreparedPadState,
  ]);

  const {
    logExportActivity,
    processUserExportUploadQueue,
    enqueueUserExportUpload,
    enqueueAdminExportUpload,
  } = useSamplerStoreUploadQueueRuntime({
    profileRole: profile?.role,
    user,
    getCachedUser,
    exportUploadQueue,
    setExportUploadQueue,
    exportUploadQueueRef,
    exportUploadProcessingRef,
    exportUploadBlobCacheRef,
    exportUploadTimerRef,
    adminExportUploadQueue,
    setAdminExportUploadQueue,
    adminExportUploadQueueRef,
    adminExportUploadProcessingRef,
    adminExportUploadBlobCacheRef,
    adminExportUploadTimerRef,
    isNativeCapacitorPlatform,
    readNativeExportBackupFileByName,
    invokeUserExportApi,
    coerceUploadHeaders,
    uploadUserExportAsset,
    uploadAdminCatalogAsset,
    isNonRetryableGithubUploadError,
    computeUploadRetryAt,
    userExportUploadMaxAttempts: USER_EXPORT_UPLOAD_MAX_ATTEMPTS,
    adminExportUploadMaxAttempts: ADMIN_EXPORT_UPLOAD_MAX_ATTEMPTS,
    userExportUploadMaxAgeMs: USER_EXPORT_UPLOAD_MAX_AGE_MS,
    adminExportUploadMaxAgeMs: ADMIN_EXPORT_UPLOAD_MAX_AGE_MS,
    writeUserExportUploadQueue,
    writeAdminExportUploadQueue,
  });

  const logImportActivity = React.useCallback((input: {
    status: 'success' | 'failed';
    bankName: string;
    bankId?: string;
    padNames: string[];
    includePadList: boolean;
    errorMessage?: string;
  }) => {
    const effectiveUser = user || getCachedUser();
    void logActivityEvent({
      eventType: 'bank.import',
      status: input.status,
      userId: effectiveUser?.id || null,
      email: effectiveUser?.email || 'unknown',
      bankId: input.bankId || null,
      bankName: input.bankName,
      padCount: input.padNames.length,
      padNames: input.includePadList ? input.padNames : [],
      errorMessage: input.errorMessage || null,
      meta: {
        source: 'useSamplerStore.importBank',
        includePadList: input.includePadList,
      },
    }).catch((err) => {
    });
  }, [user]);

  const hideProtectedBanks = React.useCallback(() => {
    runHideProtectedBanksPipeline(
      {
        ownerId: authSessionUserId || lastAuthenticatedUserIdRef.current || null,
      },
      {
        setBanks,
        pruneBanksForGuestLock,
        setHiddenProtectedBanks,
        setPrimaryBankIdState,
        setSecondaryBankIdState,
        setCurrentBankIdState,
      }
    );
  }, [authSessionUserId, setHiddenProtectedBanks]);

  const restoreHiddenProtectedBanks = React.useCallback((currentUserId: string | null) => {
    runRestoreHiddenProtectedBanksPipeline(
      {
        currentUserId,
        defaultBankSourceId: DEFAULT_BANK_SOURCE_ID,
      },
      {
        getHiddenProtectedBanks,
        setHiddenProtectedBanks,
        setBanks,
        banksRef,
        padNeedsMediaHydration,
        rehydrateBankMediaFromStorage,
      }
    );
  }, [getHiddenProtectedBanks, rehydrateBankMediaFromStorage, setHiddenProtectedBanks]);

  React.useEffect(() => {
    if (!startupRestoreCompleted) return;
    if (!isBanksHydrated) return;

    const ownerId = authSessionUserId || null;
    if (defaultBankOwnerRef.current === ownerId) return;
    defaultBankOwnerRef.current = ownerId;

    const cachedDefaultBank = readDefaultBankOwnerCache(DEFAULT_BANK_OWNER_CACHE_KEY, ownerId);
    const previousDefaultIds = new Set(
      banksRef.current
        .filter((bank) => isDefaultBankIdentity(bank) && !bank.isLocalDuplicate)
        .map((bank) => bank.id)
    );
    const withoutDefaultBanks = banksRef.current.filter(
      (bank) => !isDefaultBankIdentity(bank) || bank.isLocalDuplicate
    );
    const deduped = dedupeBanksByIdentity(
      cachedDefaultBank ? [...withoutDefaultBanks, cachedDefaultBank] : withoutDefaultBanks
    );
    const nextDefaultBankId =
      deduped.banks.find((bank) => isDefaultBankIdentity(bank))?.id || cachedDefaultBank?.id || null;

    banksRef.current = deduped.banks;
    setBanks(deduped.banks);

    const remapSelectedBankId = (selectedBankId: string | null): string | null => {
      if (!selectedBankId) return selectedBankId;
      if (previousDefaultIds.has(selectedBankId)) return nextDefaultBankId;
      return deduped.removedIdToKeptId.get(selectedBankId) || selectedBankId;
    };

    setPrimaryBankIdState((current) => remapSelectedBankId(current));
    setSecondaryBankIdState((current) => remapSelectedBankId(current));
    setCurrentBankIdState((current) => remapSelectedBankId(current));

    defaultBankSourceForceApplyRef.current = true;
    defaultBankSyncSignatureRef.current = null;
    defaultBankSessionTransitionPendingRef.current = true;
    missingMediaNoticeSignatureRef.current = null;
    setHasCompletedInitialDefaultBankSync(false);
    setIsDefaultBankSyncing(true);
    setDefaultBankSourceRevision((current) => current + 1);
  }, [
    authSessionUserId,
    isBanksHydrated,
    setBanks,
    setCurrentBankIdState,
    setDefaultBankSourceRevision,
    setHasCompletedInitialDefaultBankSync,
    setIsDefaultBankSyncing,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    startupRestoreCompleted,
  ]);

  useSamplerStoreBankLifecycle({
    banks,
    banksRef,
    isBanksHydrated,
    startupRestoreCompleted,
    hasCompletedInitialDefaultBankSync,
    setHasCompletedInitialDefaultBankSync,
    isDefaultBankSyncing,
    setIsDefaultBankSyncing,
    primaryBankId,
    secondaryBankId,
    currentBankId,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    setCurrentBankIdState,
    authSessionUserId,
    isGuestLockedSession,
    defaultBankSourceRevision,
    setDefaultBankSourceRevision,
    selectedBankHydrationRetryNonce,
    setSelectedBankHydrationRetryNonce,
    rehydratePadMediaFromStorage,
    rehydrateBankMediaFromStorage,
    setBanks,
    yieldToMainThread,
    getDefaultBankPadImagePreference,
    readLastOpenBankId,
    generateId,
    restoreFileAccess,
    storeFile,
    selectedBankHydrationRunIdRef,
    selectedBankHydrationRetryAttemptsRef,
    selectedBankHydrationRetryTimerRef,
    startupMediaRestoreInProgressRef,
    backgroundBankHydrationRunIdRef,
    backgroundBankHydrationInProgressRef,
    defaultBankSyncRunIdRef,
    defaultBankSyncSignatureRef,
    defaultBankSourceOverrideRef,
    defaultBankSourceForceApplyRef,
    defaultBankReleaseCheckStartedRef,
    defaultBankReleaseInstallInProgressRef,
    defaultBankSessionTransitionPendingRef,
    selectionOwnerRef,
    missingMediaNoticeSignatureRef,
    previousGuestModeRef,
    previousHydratedRef,
    guestDefaultSelectionPendingRef,
  });

  const restoreAllFiles = React.useCallback(async () => {
    setStartupRestoreCompleted(false);
    await runRestoreAllFilesPipeline(
      {
        user: getCachedUser(),
        allowDefaultBankAudio: Boolean(authSessionUserId) && !isGuestLockedSession,
      },
      {
        setIsBanksHydrated,
        mediaRestoreRunIdRef,
        startupMediaRestoreInProgressRef,
        getLocalStorageItemSafe,
        readIdbJsonFallback,
        storageKey: STORAGE_KEY,
        stateStorageKey: STATE_STORAGE_KEY,
        storageIdbFallbackKey: STORAGE_IDB_FALLBACK_KEY,
        stateIdbFallbackKey: STATE_IDB_FALLBACK_KEY,
        getCachedUser,
        lastAuthenticatedUserIdRef,
        readLastOpenBankId,
        writeLastOpenBankId,
        generateId,
        defaultBankName: samplerConfig.bankDefaults.defaultBankName,
        defaultBankColor: samplerConfig.bankDefaults.defaultBankColor,
        setBanks,
        setCurrentBankIdState,
        setPrimaryBankIdState,
        setSecondaryBankIdState,
        dedupeBanksByIdentity,
        hideProtectedBanksKey: HIDE_PROTECTED_BANKS_KEY,
        pruneBanksForGuestLock,
        setHiddenProtectedBanks,
        isNativeCapacitorPlatform,
        maxNativeStartupRestorePads: MAX_NATIVE_STARTUP_RESTORE_PADS,
        yieldToMainThread,
        restoreFileAccess,
        base64ToBlob,
      }
    );
    setStartupRestoreCompleted(true);
  }, [
    authSessionUserId,
    isGuestLockedSession,
    readLastOpenBankId,
    samplerConfig.bankDefaults.defaultBankColor,
    samplerConfig.bankDefaults.defaultBankName,
    setHiddenProtectedBanks,
    writeLastOpenBankId,
  ]);

  React.useEffect(() => { restoreAllFiles(); }, [restoreAllFiles]);

  React.useEffect(() => {
    setBanks((prev) => {
      let changed = false;
      const targetName = samplerConfig.bankDefaults.defaultBankName;
      const targetColor = samplerConfig.bankDefaults.defaultBankColor;
      const next = prev.map((bank) => {
        if (!isDefaultBankIdentity(bank) || bank.isLocalDuplicate) return bank;
        const needsSourceBankId = !bank.sourceBankId;
        const nextName = targetName;
        const nextColor = bank.pads.length === 0
          ? targetColor
          : bank.defaultColor;
        const nextMetadataTitle = bank.bankMetadata?.title ?? null;
        const nextMetadataColor = bank.pads.length === 0
          ? targetColor
          : bank.bankMetadata?.color ?? null;
        const metadataNeedsUpdate = Boolean(
          bank.bankMetadata &&
          (
            nextMetadataTitle !== nextName ||
            nextMetadataColor !== (bank.bankMetadata?.color ?? null)
          )
        );
        if (
          bank.name === nextName &&
          bank.defaultColor === nextColor &&
          !needsSourceBankId &&
          !metadataNeedsUpdate
        ) {
          return bank;
        }
        changed = true;
        return {
          ...bank,
          sourceBankId: bank.sourceBankId || DEFAULT_BANK_SOURCE_ID,
          name: nextName,
          defaultColor: nextColor,
          bankMetadata: bank.bankMetadata
            ? {
                ...bank.bankMetadata,
                title: nextName,
                color: bank.pads.length === 0 ? targetColor : bank.bankMetadata.color,
              }
            : bank.bankMetadata,
        };
      });
      return changed ? next : prev;
    });
  }, [samplerConfig.bankDefaults.defaultBankColor, samplerConfig.bankDefaults.defaultBankName]);

  React.useEffect(() => {
    if (loading) return;
    if (!isGuestLockedSession) return;
    hideProtectedBanks();
  }, [isGuestLockedSession, loading, hideProtectedBanks]);

  React.useEffect(() => {
    if (loading) return;
    if (authSessionMode !== 'authenticated' || !authSessionUserId) return;
    if (isProtectedBanksLockActive()) return;
    restoreHiddenProtectedBanks(authSessionUserId);
  }, [authSessionMode, authSessionUserId, loading, isProtectedBanksLockActive, restoreHiddenProtectedBanks]);

  React.useEffect(() => {
    if (!sessionConflictReason) return;
    hideProtectedBanks();
  }, [sessionConflictReason, hideProtectedBanks]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_ENFORCEMENT_EVENT_KEY || !event.newValue) return;
      hideProtectedBanks();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [hideProtectedBanks]);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && banks.length > 0) {
      if (isProtectedBanksLockActive()) return;
      try {
        const dataToSave = {
          banks: banks.map(bank => ({
            ...bank,
            pads: bank.pads.map((pad) => ({
              ...stripPreparedAudioPersistenceTransientFields(pad),
              audioUrl: undefined,
              imageUrl: undefined,
              imageData: undefined,
            }))
          }))
        };
        const dataString = JSON.stringify(dataToSave);
        let payloadToPersist = dataString;
        if (dataString.length > 4 * 1024 * 1024) {
          const reducedData = {
            banks: banks.map(bank => ({
              ...bank, pads: bank.pads.map(pad => ({
                ...stripPreparedAudioPersistenceTransientFields(pad),
                id: pad.id,
                name: pad.name,
                audioStorageKey: pad.audioStorageKey,
                audioBackend: pad.audioBackend,
                preparedAudioStorageKey: pad.preparedAudioStorageKey,
                preparedAudioBackend: pad.preparedAudioBackend,
                preparedAudioKind: pad.preparedAudioKind,
                preparedSourceSignature: pad.preparedSourceSignature,
                preparedStatus: stripPreparedAudioPersistenceTransientFields(pad).preparedStatus,
                preparedBytes: pad.preparedBytes,
                preparedAt: pad.preparedAt,
                preparedDurationMs: pad.preparedDurationMs,
                imageStorageKey: pad.imageStorageKey,
                imageBackend: pad.imageBackend,
                hasImageAsset: pad.hasImageAsset,
                color: pad.color,
                shortcutKey: pad.shortcutKey,
                midiNote: pad.midiNote,
                midiCC: pad.midiCC,
                triggerMode: pad.triggerMode,
                playbackMode: pad.playbackMode,
                volume: pad.volume,
                gainDb: typeof pad.gainDb === 'number' ? pad.gainDb : 0,
                gain: pad.gain ?? 1.0,
                fadeInMs: pad.fadeInMs,
                fadeOutMs: pad.fadeOutMs,
                startTimeMs: pad.startTimeMs,
                endTimeMs: pad.endTimeMs,
                pitch: pad.pitch,
                tempoPercent: typeof pad.tempoPercent === 'number' ? pad.tempoPercent : 0,
                keyLock: pad.keyLock !== false,
                position: pad.position,
                ignoreChannel: pad.ignoreChannel,
                audioBytes: pad.audioBytes,
                audioDurationMs: pad.audioDurationMs,
                savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
                  ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
                  : [null, null, null, null]
              }))
            }))
          };
          payloadToPersist = JSON.stringify(reducedData);
        }
        const stored = setLocalStorageItemSafe(STORAGE_KEY, payloadToPersist);
        if (!stored) {
          void writeIdbJsonFallback(STORAGE_IDB_FALLBACK_KEY, payloadToPersist);
        }
      } catch { }
    }
  }, [banks]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!startupRestoreCompleted) return;
    if (!isBanksHydrated) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;
    if (defaultBankSessionTransitionPendingRef.current) return;

    const ownerId = authSessionUserId || null;
    if (defaultBankPersistenceOwnerRef.current !== ownerId) {
      defaultBankPersistenceOwnerRef.current = ownerId;
      return;
    }

    const defaultBank =
      banks.find((bank) => isDefaultBankIdentity(bank) && !bank.isLocalDuplicate && Array.isArray(bank.pads) && bank.pads.length > 0) ||
      banks.find((bank) => isDefaultBankIdentity(bank) && !bank.isLocalDuplicate) ||
      null;

    writeDefaultBankOwnerCache(DEFAULT_BANK_OWNER_CACHE_KEY, ownerId, defaultBank);
  }, [
    authSessionUserId,
    banks,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    startupRestoreCompleted,
  ]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const ownerId = authSessionUserId || null;
    if (selectionPersistenceOwnerRef.current !== ownerId) {
      selectionPersistenceOwnerRef.current = ownerId;
      return;
    }
    const nextLastOpenBankId = primaryBankId || currentBankId || secondaryBankId || null;

    if (!isProtectedBanksLockActive()) {
      try {
        const statePayload = JSON.stringify({
          primaryBankId,
          secondaryBankId,
          currentBankId,
        });
        const stored = setLocalStorageItemSafe(STATE_STORAGE_KEY, statePayload);
        if (!stored) {
          void writeIdbJsonFallback(STATE_IDB_FALLBACK_KEY, statePayload);
        }
      } catch {
        // Best effort only.
      }
    }

    writeLastOpenBankId(ownerId, nextLastOpenBankId);
  }, [
    authSessionUserId,
    currentBankId,
    isProtectedBanksLockActive,
    primaryBankId,
    secondaryBankId,
    writeLastOpenBankId,
  ]);

  const getTargetBankId = React.useCallback((bankId?: string): string | null => {
    if (bankId) return bankId;
    if (isDualMode && secondaryBankId) return secondaryBankId;
    if (isDualMode && primaryBankId) return primaryBankId;
    return currentBankId;
  }, [isDualMode, primaryBankId, secondaryBankId, currentBankId]);

  const trimPadName = React.useCallback((name: string) => name.slice(0, 32), []);
  const samplerAudioLimits = React.useMemo(
    () => ({
      maxPadAudioBytes: samplerConfig.audioLimits.maxPadAudioBytes,
      maxPadAudioDurationMs: samplerConfig.audioLimits.maxPadAudioDurationMs,
    }),
    [samplerConfig.audioLimits.maxPadAudioBytes, samplerConfig.audioLimits.maxPadAudioDurationMs],
  );
  const checkAdmissionWithDefaults = React.useCallback(
    (metadata: { audioBytes: number; audioDurationMs: number }) => checkAdmission(metadata, samplerAudioLimits),
    [samplerAudioLimits],
  );

  const addPad = React.useCallback(async (
    file: File,
    bankId?: string,
    options?: {
      defaultTriggerMode?: PadData['triggerMode'];
      padDefaults?: Partial<Pick<PadData, 'playbackMode' | 'volume' | 'gainDb' | 'fadeInMs' | 'fadeOutMs' | 'pitch' | 'tempoPercent' | 'keyLock'>>;
    }
  ) => {
    await runAddPadPipeline(
      {
        file,
        targetBankId: getTargetBankId(bankId),
        defaultTriggerMode: options?.defaultTriggerMode,
        padDefaults: options?.padDefaults
          ? {
              triggerMode: options?.defaultTriggerMode || samplerConfig.padDefaults.defaultTriggerMode,
              playbackMode: options.padDefaults.playbackMode || samplerConfig.padDefaults.defaultPlaybackMode,
              volume: typeof options.padDefaults.volume === 'number' ? options.padDefaults.volume : samplerConfig.padDefaults.defaultVolume,
              gainDb: typeof options.padDefaults.gainDb === 'number' ? options.padDefaults.gainDb : samplerConfig.padDefaults.defaultGainDb,
              fadeInMs: typeof options.padDefaults.fadeInMs === 'number' ? options.padDefaults.fadeInMs : samplerConfig.padDefaults.defaultFadeInMs,
              fadeOutMs: typeof options.padDefaults.fadeOutMs === 'number' ? options.padDefaults.fadeOutMs : samplerConfig.padDefaults.defaultFadeOutMs,
              pitch: typeof options.padDefaults.pitch === 'number' ? options.padDefaults.pitch : samplerConfig.padDefaults.defaultPitch,
              tempoPercent: typeof options.padDefaults.tempoPercent === 'number' ? options.padDefaults.tempoPercent : samplerConfig.padDefaults.defaultTempoPercent,
              keyLock: typeof options.padDefaults.keyLock === 'boolean' ? options.padDefaults.keyLock : samplerConfig.padDefaults.defaultKeyLock,
            }
          : {
              triggerMode: options?.defaultTriggerMode || samplerConfig.padDefaults.defaultTriggerMode,
              playbackMode: samplerConfig.padDefaults.defaultPlaybackMode,
              volume: samplerConfig.padDefaults.defaultVolume,
              gainDb: samplerConfig.padDefaults.defaultGainDb,
              fadeInMs: samplerConfig.padDefaults.defaultFadeInMs,
              fadeOutMs: samplerConfig.padDefaults.defaultFadeOutMs,
              pitch: samplerConfig.padDefaults.defaultPitch,
              tempoPercent: samplerConfig.padDefaults.defaultTempoPercent,
              keyLock: samplerConfig.padDefaults.defaultKeyLock,
            },
        profileRole: profile?.role,
        quotaPolicy,
      },
      {
        banksRef,
        setBanks,
        trimPadName,
        extractMetadataFromFile,
        checkAdmission: checkAdmissionWithDefaults,
        ensureStorageHeadroom,
        generateId,
        storeFile,
        isOwnedCountedBankForQuota,
        deletePadMediaArtifacts,
      }
    );
  }, [checkAdmissionWithDefaults, getTargetBankId, profile?.role, quotaPolicy.ownedBankPadCap, samplerConfig.padDefaults, trimPadName]);

  const addPads = React.useCallback(async (
    files: File[],
    bankId?: string,
    options?: {
      defaultTriggerMode?: PadData['triggerMode'];
      padDefaults?: Partial<Pick<PadData, 'playbackMode' | 'volume' | 'gainDb' | 'fadeInMs' | 'fadeOutMs' | 'pitch' | 'tempoPercent' | 'keyLock'>>;
    }
  ) => {
    await runAddPadsPipeline(
      {
        files,
        targetBankId: getTargetBankId(bankId),
        defaultTriggerMode: options?.defaultTriggerMode,
        padDefaults: options?.padDefaults
          ? {
              triggerMode: options?.defaultTriggerMode || samplerConfig.padDefaults.defaultTriggerMode,
              playbackMode: options.padDefaults.playbackMode || samplerConfig.padDefaults.defaultPlaybackMode,
              volume: typeof options.padDefaults.volume === 'number' ? options.padDefaults.volume : samplerConfig.padDefaults.defaultVolume,
              gainDb: typeof options.padDefaults.gainDb === 'number' ? options.padDefaults.gainDb : samplerConfig.padDefaults.defaultGainDb,
              fadeInMs: typeof options.padDefaults.fadeInMs === 'number' ? options.padDefaults.fadeInMs : samplerConfig.padDefaults.defaultFadeInMs,
              fadeOutMs: typeof options.padDefaults.fadeOutMs === 'number' ? options.padDefaults.fadeOutMs : samplerConfig.padDefaults.defaultFadeOutMs,
              pitch: typeof options.padDefaults.pitch === 'number' ? options.padDefaults.pitch : samplerConfig.padDefaults.defaultPitch,
              tempoPercent: typeof options.padDefaults.tempoPercent === 'number' ? options.padDefaults.tempoPercent : samplerConfig.padDefaults.defaultTempoPercent,
              keyLock: typeof options.padDefaults.keyLock === 'boolean' ? options.padDefaults.keyLock : samplerConfig.padDefaults.defaultKeyLock,
            }
          : {
              triggerMode: options?.defaultTriggerMode || samplerConfig.padDefaults.defaultTriggerMode,
              playbackMode: samplerConfig.padDefaults.defaultPlaybackMode,
              volume: samplerConfig.padDefaults.defaultVolume,
              gainDb: samplerConfig.padDefaults.defaultGainDb,
              fadeInMs: samplerConfig.padDefaults.defaultFadeInMs,
              fadeOutMs: samplerConfig.padDefaults.defaultFadeOutMs,
              pitch: samplerConfig.padDefaults.defaultPitch,
              tempoPercent: samplerConfig.padDefaults.defaultTempoPercent,
              keyLock: samplerConfig.padDefaults.defaultKeyLock,
            },
        profileRole: profile?.role,
        quotaPolicy,
      },
      {
        banksRef,
        setBanks,
        trimPadName,
        extractMetadataFromFile,
        checkAdmission: checkAdmissionWithDefaults,
        ensureStorageHeadroom,
        generateId,
        storeFile,
        isOwnedCountedBankForQuota,
        isNativeCapacitorPlatform,
        saveBatchBlobsToDB,
      }
    );
  }, [checkAdmissionWithDefaults, getTargetBankId, profile?.role, quotaPolicy.ownedBankPadCap, samplerConfig.padDefaults, trimPadName]);

  const updatePad = React.useCallback(async (bankId: string, id: string, updatedPad: PadData) => {
    const existingBank = banks.find((bank) => bank.id === bankId);
    const existingPad = existingBank?.pads.find((pad) => pad.id === id);
    const nextPad = { ...updatedPad };
    const sourceChanged = existingPad
      ? buildPadPreparedSourceSignature(existingPad) !== buildPadPreparedSourceSignature(nextPad)
      : false;
    if (sourceChanged && existingPad) {
      revokePreparedAudioUrl(existingPad);
      try {
        await deletePreparedAudioBlob(existingPad.id, existingPad.preparedAudioStorageKey, existingPad.preparedAudioBackend);
      } catch {
        // Ignore prepared cache cleanup failures for source updates.
      }
      nextPad.preparedAudioUrl = undefined;
      nextPad.preparedAudioStorageKey = undefined;
      nextPad.preparedAudioBackend = undefined;
      nextPad.preparedAudioKind = undefined;
      nextPad.preparedSourceSignature = undefined;
      nextPad.preparedStatus = 'none';
      nextPad.preparedBytes = undefined;
      nextPad.preparedAt = undefined;
      nextPad.preparedDurationMs = undefined;
    }
    const currentImagePreference = getDefaultBankPadImagePreference(id);
    const hasVisibleImage = Boolean(existingPad?.imageUrl || existingPad?.imageData);
    const imageIsBlank =
      (!nextPad.imageUrl || nextPad.imageUrl.trim().length === 0) &&
      (!nextPad.imageData || nextPad.imageData.trim().length === 0);
    const requestedImageRemoval = hasVisibleImage && imageIsBlank;

    await runUpdatePadPipeline(
      {
        bankId,
        id,
        updatedPad: nextPad,
        banks,
      },
      {
        base64ToBlob,
        ensureStorageHeadroom,
        storeFile,
        deletePadMediaArtifacts,
        padHasExpectedImageAsset,
        setBanks,
      }
    );
    if (!existingBank || !isDefaultBankIdentity(existingBank)) return;
    if (requestedImageRemoval || (currentImagePreference === 'none' && imageIsBlank)) {
      writeDefaultBankPadImagePreferenceForOwner(id, 'none');
      return;
    }
    if (currentImagePreference === 'none') {
      writeDefaultBankPadImagePreferenceForOwner(id, null);
    }
  }, [banks, getDefaultBankPadImagePreference, revokePreparedAudioUrl, writeDefaultBankPadImagePreferenceForOwner]);

  const removePad = React.useCallback(async (bankId: string, id: string) => {
    const existingBank = banks.find((bank) => bank.id === bankId);
    const existingPad = existingBank?.pads.find((pad) => pad.id === id);
    if (existingPad) {
      revokePreparedAudioUrl(existingPad);
      try {
        await deletePreparedAudioBlob(existingPad.id, existingPad.preparedAudioStorageKey, existingPad.preparedAudioBackend);
      } catch {
        // Ignore prepared cache cleanup failures for removed pads.
      }
    }
    await runRemovePadPipeline(
      {
        bankId,
        id,
        banks,
      },
      {
        deletePadMediaArtifacts,
        setBanks,
      }
    );
  }, [banks, revokePreparedAudioUrl]);

  const reorderPads = React.useCallback((bankId: string, fromIndex: number, toIndex: number) => {
    runReorderPadsPipeline(bankId, fromIndex, toIndex, setBanks);
  }, []);

  const createBank = React.useCallback((name: string, defaultColor: string) => {
    runCreateBankPipeline(
      {
        name,
        defaultColor,
        currentBankId,
        isDualMode,
        profileRole: profile?.role,
        creatorEmail: user?.email || null,
        quotaPolicy,
      },
      {
        banksRef,
        setBanks,
        setCurrentBankIdState,
        countOwnedCountedBanks,
        generateId,
      }
    );
  }, [currentBankId, isDualMode, profile?.role, quotaPolicy.deviceTotalBankCap, quotaPolicy.ownedBankQuota, user?.email]);

  const moveBankUp = React.useCallback((id: string) => {
    runMoveBankUpPipeline(id, setBanks);
  }, []);

  const moveBankDown = React.useCallback((id: string) => {
    runMoveBankDownPipeline(id, setBanks);
  }, []);

  const transferPad = React.useCallback((padId: string, sourceBankId: string, targetBankId: string) => {
    const targetBank = banksRef.current.find((bank) => bank.id === targetBankId);
    if (profile?.role !== 'admin' && targetBank && targetBank.pads.length >= quotaPolicy.ownedBankPadCap) {
      throw new Error(buildPadCapReachedMessage(quotaPolicy.ownedBankPadCap));
    }
    runTransferPadPipeline(
      {
        padId,
        sourceBankId,
        targetBankId,
        profileRole: profile?.role,
        quotaOwnedBankPadCap: quotaPolicy.ownedBankPadCap,
      },
      {
        setBanks,
        isOwnedCountedBankForQuota,
      }
    );
  }, [profile?.role, quotaPolicy.ownedBankPadCap]);

  const setPrimaryBank = React.useCallback((id: string | null) => {
    runSetPrimaryBankPipeline(
      {
        id,
        primaryBankId,
        secondaryBankId,
        currentBankId,
      },
      {
        setCurrentBankIdState,
        setPrimaryBankIdState,
        setSecondaryBankIdState,
      }
    );
  }, [primaryBankId, secondaryBankId, currentBankId]);

  const setSecondaryBank = React.useCallback((id: string | null) => {
    runSetSecondaryBankPipeline({ id, primaryBankId }, setSecondaryBankIdState);
  }, [primaryBankId]);
  const setVisibleBanks = React.useCallback((primaryId: string | null, secondaryId: string | null) => {
    const nextPrimary = primaryId;
    const nextSecondary = secondaryId && secondaryId !== primaryId ? secondaryId : null;
    setPrimaryBankIdState(nextPrimary);
    setSecondaryBankIdState(nextSecondary);
    if (nextPrimary || nextSecondary) {
      setCurrentBankIdState(null);
    }
  }, []);
  const setCurrentBank = React.useCallback((id: string | null) => {
    runSetCurrentBankPipeline({ id, isDualMode }, setCurrentBankIdState);
  }, [isDualMode]);

  const updateBank = React.useCallback((id: string, updates: Partial<SamplerBank>) => {
    runUpdateBankPipeline(id, updates, setBanks);
  }, []);

  const deleteBank = React.useCallback(async (id: string) => {
    await runDeleteBankPipeline(
      {
        id,
        banks,
        primaryBankId,
        secondaryBankId,
        currentBankId,
      },
      {
        deletePadMediaArtifacts,
        setBanks,
        setPrimaryBankIdState,
        setSecondaryBankIdState,
        setCurrentBankIdState,
        generateId,
        defaultBankName: samplerConfig.bankDefaults.defaultBankName,
        defaultBankColor: samplerConfig.bankDefaults.defaultBankColor,
      }
    );
  }, [currentBankId, primaryBankId, samplerConfig.bankDefaults.defaultBankColor, samplerConfig.bankDefaults.defaultBankName, secondaryBankId]);

  const duplicateBank = React.useCallback(async (bankId: string, onProgress?: (progress: number) => void): Promise<SamplerBank> => {
    const { runDuplicateBankPipeline } = await import('./useSamplerStore.bankDuplication');
    return runDuplicateBankPipeline(
      {
        bankId,
        profileRole: profile?.role,
        quotaPolicy,
      },
      {
        banksRef,
        setBanks,
        isOwnedCountedBankForQuota,
        countOwnedCountedBanks,
        generateId,
        buildDuplicateBankName,
        loadPadMediaBlobWithUrlFallback,
        storeFile,
        padHasExpectedImageAsset,
        deletePadMediaArtifacts,
        yieldToMainThread,
        onProgress,
      }
    );
  }, [profile?.role, quotaPolicy.deviceTotalBankCap, quotaPolicy.ownedBankQuota]);

  const duplicatePad = React.useCallback(async (bankId: string, padId: string): Promise<PadData> => {
    const { runDuplicatePadPipeline } = await import('./useSamplerStore.bankDuplication');
    return runDuplicatePadPipeline(
      {
        bankId,
        padId,
        profileRole: profile?.role,
        quotaPolicy,
      },
      {
        banksRef,
        setBanks,
        isOwnedCountedBankForQuota,
        generateId,
        loadPadMediaBlobWithUrlFallback,
        storeFile,
        padHasExpectedImageAsset,
        buildDuplicatePadName,
        deletePadMediaArtifacts,
      }
    );
  }, [profile?.role, quotaPolicy.ownedBankPadCap]);

  // Export bank.
  const exportBank = React.useCallback(async (id: string, onProgress?: (progress: number) => void) => {
    const { runExportBankPipeline } = await import('./useSamplerStore.exportBank');
    return runExportBankPipeline(
      {
        id,
        onProgress,
        banks,
        user,
        profileRole: profile?.role,
      },
      {
        getCachedUser,
        generateOperationId,
        createOperationDiagnostics,
        addOperationStage,
        getNowMs,
        logExportActivity,
        ensureExportPermission,
        estimateBankMediaBytes,
        isNativeCapacitorPlatform,
        maxNativeBankExportBytes: MAX_NATIVE_BANK_EXPORT_BYTES,
        ensureStorageHeadroom,
        padHasExpectedImageAsset,
        loadPadMediaBlob,
        shouldAttemptTrim,
        trimAudio,
        detectAudioFormat,
        sha256HexFromBlob,
        yieldToMainThread,
        saveExportFile,
        enqueueUserExportUpload,
        processUserExportUploadQueue,
        writeOperationDiagnosticsLog,
      }
    );
  }, [banks, enqueueUserExportUpload, logExportActivity, processUserExportUploadQueue, profile?.role, user]);

  // Import bank.
  const importBank = React.useCallback(async (
    file: File,
    onProgress?: (progress: number) => void,
    options?: ImportBankOptions
  ) => {
    const { runImportBankPipeline } = await import('./useSamplerStore.importBank');
    return runImportBankPipeline(file, onProgress, options, {
      user,
      getCachedUser,
      banks,
      banksRefCurrent: banksRef.current,
      profileRole: profile?.role,
      quotaPolicy,
      emitImportStage,
      ensureStorageHeadroom,
      normalizeIdentityToken,
      countOwnedCountedBanks,
      generateId,
      isNativeCapacitorPlatform,
      isNativeAndroid,
      storeFile,
      saveBatchBlobsToDB,
      yieldToMainThread,
      sha256HexFromText,
      dedupeBanksByIdentity,
      setBanks,
      logImportActivity,
    });
  }, [
    banks,
    user,
    profile?.role,
    quotaPolicy.deviceTotalBankCap,
    quotaPolicy.ownedBankPadCap,
    quotaPolicy.ownedBankQuota,
    logImportActivity
  ]);

  // Export admin bank.
  const exportAdminBank = React.useCallback(async (
    id: string,
    title: string,
    description: string,
    addToDatabase: boolean,
    allowExport: boolean,
    publicCatalogAsset: boolean,
    exportMode: ExportAudioMode,
    thumbnailPath?: string,
    onProgress?: (progress: number) => void
  ) => {
    const { runExportAdminBankPipeline } = await import('./useSamplerStore.exportAdminBank');

    return runExportAdminBankPipeline(
      {
        id,
        title,
        description,
        addToDatabase,
        allowExport,
        publicCatalogAsset,
        exportMode,
        thumbnailPath,
        onProgress,
        banks,
        user,
        profileRole: profile?.role,
      },
      {
        createOperationDiagnostics,
        addOperationStage,
        getNowMs,
        ensureExportPermission,
        estimateBankMediaBytes,
        isNativeCapacitorPlatform,
        maxNativeBankExportBytes: MAX_NATIVE_BANK_EXPORT_BYTES,
        ensureStorageHeadroom,
        padHasExpectedImageAsset,
        loadPadMediaBlob,
        shouldAttemptTrim,
        trimAudio,
        remapSavedHotcuesForBakedTrim,
        transcodeAudioToMP3: transcodeAudioToMP3ForExport,
        detectAudioFormat,
        sha256HexFromBlob,
        sha256HexFromText,
        yieldToMainThread,
        extFromMime,
        inferImageExtFromPath,
        addBankMetadata: (zip, metadata) => addBankMetadata(zip, metadata),
        encryptZip,
        sharedExportDisabledPassword: SHARED_EXPORT_DISABLED_PASSWORD,
        issueSignedAdminExportToken,
        saveExportFile,
        uploadAdminCatalogAsset,
        isNonRetryableGithubUploadError,
        enqueueAdminExportUpload,
        writeOperationDiagnosticsLog,
      }
    );
  }, [banks, enqueueAdminExportUpload, user, profile]);

  const updateStoreBank = React.useCallback(async (
    input: UpdateStoreBankInput,
  ) => {
    const { runUpdateStoreBankPipeline } = await import('./useSamplerStore.updateStoreBank');

    return runUpdateStoreBankPipeline(
      {
        ...input,
        user,
        profileRole: profile?.role,
      },
      {
        createOperationDiagnostics,
        addOperationStage,
        getNowMs,
        ensureExportPermission,
        estimateBankMediaBytes,
        isNativeCapacitorPlatform,
        maxNativeBankExportBytes: MAX_NATIVE_BANK_EXPORT_BYTES,
        ensureStorageHeadroom,
        padHasExpectedImageAsset,
        loadPadMediaBlob,
        shouldAttemptTrim,
        trimAudio,
        remapSavedHotcuesForBakedTrim,
        transcodeAudioToMP3: transcodeAudioToMP3ForExport,
        detectAudioFormat,
        sha256HexFromBlob,
        sha256HexFromText,
        yieldToMainThread,
        extFromMime,
        inferImageExtFromPath,
        addBankMetadata: (zip, metadata) => addBankMetadata(zip, metadata),
        encryptZip,
        saveExportFile,
        patchAdminCatalogItem,
        uploadAdminCatalogAsset,
        isNonRetryableGithubUploadError,
        enqueueAdminExportUpload,
        clearQueuedAdminUpdateJobsForCatalogItem: (catalogItemId, options) => {
          clearAdminUpdateRetryJobsForCatalogItem(catalogItemId, {
            blobCacheRef: adminExportUploadBlobCacheRef,
            setQueue: setAdminExportUploadQueue,
            excludeExportOperationId: options?.excludeExportOperationId,
          });
        },
        writeOperationDiagnosticsLog,
      },
    );
  }, [enqueueAdminExportUpload, user, profile]);

  const publishDefaultBankRelease = React.useCallback(async (
    bankId: string,
    options?: { releaseNotes?: string; minAppVersion?: string }
  ): Promise<string> => {
    const { runExportAdminBankPipeline } = await import('./useSamplerStore.exportAdminBank');

    const sourceBank = banksRef.current.find((bank) => bank.id === bankId);
    if (!sourceBank) throw new Error('We could not find that bank.');

    let preparedBlob: Blob | null = null;
    let preparedFileName = '';
    await runExportAdminBankPipeline(
      {
        id: bankId,
        title: sourceBank.name,
        description: sourceBank.bankMetadata?.description || '',
        addToDatabase: false,
        allowExport: true,
        publicCatalogAsset: true,
        exportMode: 'fast',
        thumbnailPath: sourceBank.bankMetadata?.thumbnailUrl,
        banks: banksRef.current,
        user,
        profileRole: profile?.role,
      },
      {
        createOperationDiagnostics,
        addOperationStage,
        getNowMs,
        ensureExportPermission,
        estimateBankMediaBytes,
        isNativeCapacitorPlatform,
        maxNativeBankExportBytes: MAX_NATIVE_BANK_EXPORT_BYTES,
        ensureStorageHeadroom,
        padHasExpectedImageAsset,
        loadPadMediaBlob,
        shouldAttemptTrim,
        trimAudio,
        remapSavedHotcuesForBakedTrim,
        transcodeAudioToMP3: transcodeAudioToMP3ForExport,
        detectAudioFormat,
        sha256HexFromBlob,
        sha256HexFromText,
        yieldToMainThread,
        extFromMime,
        inferImageExtFromPath,
        addBankMetadata: (zip, metadata) => addBankMetadata(zip, metadata),
        encryptZip,
        sharedExportDisabledPassword: SHARED_EXPORT_DISABLED_PASSWORD,
        issueSignedAdminExportToken,
        saveExportFile: async (blob, fileName) => {
          preparedBlob = blob;
          preparedFileName = fileName;
          return {
            success: true,
            savedPath: fileName,
            message: 'Default bank release prepared.',
          };
        },
        uploadAdminCatalogAsset,
        isNonRetryableGithubUploadError,
        enqueueAdminExportUpload,
        writeOperationDiagnosticsLog,
      }
    );

    if (!preparedBlob || !preparedFileName) {
      throw new Error('Default bank release archive was not prepared.');
    }

    const fileSha256 = await sha256HexFromBlob(preparedBlob);
    const uploaded = await uploadDefaultBankReleaseArchive({
      sourceBankRuntimeId: sourceBank.id,
      sourceBankTitle: sourceBank.name,
      sourceBankPadCount: sourceBank.pads.length,
      assetName: preparedFileName,
      exportBlob: preparedBlob,
      fileSha256,
      releaseNotes: options?.releaseNotes || null,
      minAppVersion: options?.minAppVersion || null,
    });

    const publishedAt = typeof uploaded.release?.publishedAt === 'string' ? uploaded.release.publishedAt : null;
    const defaultBankSource: SamplerBank = {
      ...sourceBank,
      name: samplerConfig.bankDefaults.defaultBankName,
      defaultColor: sourceBank.pads.length === 0 ? samplerConfig.bankDefaults.defaultBankColor : sourceBank.defaultColor,
      sourceBankId: DEFAULT_BANK_SOURCE_ID,
      bankMetadata: {
        ...(sourceBank.bankMetadata || {
          password: false,
          transferable: true,
        }),
        title: samplerConfig.bankDefaults.defaultBankName,
        color: sourceBank.pads.length === 0 ? samplerConfig.bankDefaults.defaultBankColor : sourceBank.bankMetadata?.color,
        defaultBankSource: 'remote',
        defaultBankReleaseVersion: uploaded.version,
        defaultBankReleasePublishedAt: publishedAt || undefined,
        defaultBankReleaseSha256: fileSha256,
      },
    };

    defaultBankSourceOverrideRef.current = defaultBankSource;
    defaultBankSourceForceApplyRef.current = true;
    writeDefaultBankReleaseMetaState({
      manifest: {
        id: typeof uploaded.release?.id === 'string' ? uploaded.release.id : '',
        version: uploaded.version,
        sourceBankTitle: sourceBank.name,
        sourceBankPadCount: sourceBank.pads.length,
        fileSizeBytes: preparedBlob.size,
        fileSha256,
        minAppVersion: options?.minAppVersion || null,
        publishedAt,
        releaseNotes: options?.releaseNotes || null,
      },
      lastCheckedAt: Date.now(),
    });
    setHasCompletedInitialDefaultBankSync(false);
    setIsDefaultBankSyncing(true);
    setDefaultBankSourceRevision((value) => value + 1);

    return `Default bank v${uploaded.version} published successfully.`;
  }, [banks, profile?.role, samplerConfig.bankDefaults.defaultBankColor, samplerConfig.bankDefaults.defaultBankName, user]);

  const canTransferFromBank = React.useCallback((bankId: string): boolean => {
    const bank = banks.find(b => b.id === bankId);
    return Boolean(bank);
  }, [banks]);

  const clearBankMedia = React.useCallback(async (bank: SamplerBank) => {
    await Promise.all(
      bank.pads.map(async (pad) => {
        try {
          await deletePadMediaArtifacts(pad);
        } catch {

        }
        try {
          await deletePreparedAudioBlob(pad.id, pad.preparedAudioStorageKey, pad.preparedAudioBackend);
        } catch {
          // Ignore prepared cache cleanup failures.
        }
        revokePreparedAudioUrl(pad);
      })
    );
  }, [revokePreparedAudioUrl]);

  const applySamplerMetadataSnapshot = React.useCallback(async (rawSnapshot: SamplerMetadataSnapshot) => {
    const snapshot = reviveSamplerMetadataSnapshot(rawSnapshot);
    if (!snapshot) {
      throw new Error('Invalid metadata snapshot.');
    }

    const nextBanks = applyResolvedOfficialPadMedia(
      materializeSnapshotBanks(snapshot, banksRef.current)
    ).map((bank) => ({
      ...bank,
      restoreStatus: deriveSnapshotRestoreStatus(bank),
    }));

    const nextIds = new Set(nextBanks.map((bank) => bank.id));
    const nextPrimary =
      snapshot.state.primaryBankId && nextIds.has(snapshot.state.primaryBankId)
        ? snapshot.state.primaryBankId
        : null;
    const nextSecondary =
      snapshot.state.secondaryBankId && nextIds.has(snapshot.state.secondaryBankId)
        ? snapshot.state.secondaryBankId
        : null;
    const nextCurrent =
      snapshot.state.currentBankId && nextIds.has(snapshot.state.currentBankId)
        ? snapshot.state.currentBankId
        : nextPrimary || nextSecondary || nextBanks[0]?.id || null;

    setBanks(nextBanks);
    setPrimaryBankIdState(nextPrimary);
    setSecondaryBankIdState(nextSecondary);
    setCurrentBankIdState(nextCurrent);

    return {
      message: `Loaded ${nextBanks.length} bank${nextBanks.length === 1 ? '' : 's'} from cloud metadata snapshot.`,
      settings: snapshot.settings || null,
      mappings: snapshot.mappings || null,
      state: snapshot.state || null,
    };
  }, []);

  const relinkPadAudioFromFile = React.useCallback(async (bankId: string, padId: string, file: File) => {
    const latestBanks = banksRef.current;
    const bank = latestBanks.find((candidate) => candidate.id === bankId);
    const pad = bank?.pads.find((candidate) => candidate.id === padId);
    if (!bank || !pad) {
      throw new Error('Pad not found.');
    }

    const metadata = await extractMetadataFromFile(file);
    const admission = checkAdmissionWithDefaults(metadata);
    if (!admission.allowed) {
      throw new Error(admission.message || 'Audio file exceeds supported limits.');
    }

    await ensureStorageHeadroom(file.size, 'pad media relink');

    const storedAudio = await storeFile(padId, file, 'audio');
    const audioUrl = URL.createObjectURL(file);
    const resolvedDurationMs = metadata.audioDurationMs > 0
      ? metadata.audioDurationMs
      : (typeof pad.endTimeMs === 'number' && Number.isFinite(pad.endTimeMs) && pad.endTimeMs > 0 ? pad.endTimeMs : 30000);
    const previousStart = typeof pad.startTimeMs === 'number' && Number.isFinite(pad.startTimeMs) ? pad.startTimeMs : 0;
    const previousEnd = typeof pad.endTimeMs === 'number' && Number.isFinite(pad.endTimeMs) && pad.endTimeMs > 0
      ? pad.endTimeMs
      : resolvedDurationMs;
    const nextStart = Math.max(0, Math.min(previousStart, Math.max(0, resolvedDurationMs - 1)));
    const nextEnd = Math.max(nextStart, Math.min(previousEnd, resolvedDurationMs));

    const updatedPad: PadData = {
      ...pad,
      audioUrl,
      audioStorageKey: storedAudio.storageKey,
      audioBackend: storedAudio.backend,
      imageUrl: undefined,
      imageStorageKey: undefined,
      imageBackend: undefined,
      imageData: undefined,
      hasImageAsset: false,
      audioBytes: metadata.audioBytes,
      audioDurationMs: metadata.audioDurationMs,
      startTimeMs: nextStart,
      endTimeMs: nextEnd,
      missingMediaExpected: false,
      missingImageExpected: false,
    };

    const nextBanks = latestBanks.map((candidate) => {
      if (candidate.id !== bankId) return candidate;
      const nextPads = candidate.pads.map((candidatePad) => candidatePad.id === padId ? updatedPad : candidatePad);
      return {
        ...candidate,
        pads: nextPads,
        restoreStatus: deriveSnapshotRestoreStatus({ ...candidate, pads: nextPads }),
      };
    });

    banksRef.current = nextBanks;
    setBanks(nextBanks);

    try {
      await deletePadMediaArtifacts({
        id: padId,
        imageStorageKey: pad.imageStorageKey,
        imageBackend: pad.imageBackend,
      }, 'image');
    } catch {
      // Ignore image cleanup failures; relinked audio should still succeed.
    }
  }, [checkAdmission, deletePadMediaArtifacts, ensureStorageHeadroom, extractMetadataFromFile, storeFile]);

  const exportAppBackup = React.useCallback(async (payload: {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null };
  }, options?: { riskMode?: boolean }) => {
    let snapshotSyncError: string | null = null;
    const effectiveUser = user || getCachedUser();
    if (effectiveUser?.id) {
      try {
        const snapshot = buildSamplerMetadataSnapshot({
          userId: effectiveUser.id,
          settings: payload.settings,
          mappings: payload.mappings,
          state: payload.state,
          banks,
        });
        await saveUserSamplerMetadataSnapshot(snapshot);
      } catch (error) {
        snapshotSyncError = error instanceof Error ? error.message : 'Cloud metadata sync failed.';
      }
    }

    const { runBackupExportPipeline } = await import('./useSamplerStore.backupPipelines');
    const exportMessage = await runBackupExportPipeline(
      {
        payload,
        options,
        banks,
        user,
      },
      {
        getCachedUser,
        createOperationDiagnostics,
        addOperationStage,
        logExportActivity: (input) => logExportActivity(input),
        ensureExportPermission,
        estimateBankMediaBytes,
        isNativeCapacitorPlatform,
        maxNativeAppBackupBytes: MAX_NATIVE_APP_BACKUP_BYTES,
        ensureStorageHeadroom,
        loadPadMediaBlob,
        padHasExpectedImageAsset,
        yieldToMainThread,
        derivePassword,
        encryptZip,
        splitBlobIntoParts,
        getBackupPartSizeBytes,
        buildBackupManifestName,
        backupVersion: BACKUP_VERSION,
        backupManifestSchema: BACKUP_MANIFEST_SCHEMA,
        backupManifestVersion: BACKUP_MANIFEST_VERSION,
        backupPartExt: BACKUP_PART_EXT,
        saveExportFile,
        writeOperationDiagnosticsLog,
      }
    );
    return snapshotSyncError ? `${exportMessage}\nCloud metadata snapshot not updated: ${snapshotSyncError}` : exportMessage;
  }, [banks, user, logExportActivity]);

  const restoreAppBackup = React.useCallback(async (file: File, companionFiles: File[] = []) => {
    const { runBackupRestorePipeline } = await import('./useSamplerStore.backupPipelines');
    return runBackupRestorePipeline(
      {
        file,
        companionFiles,
        user,
        previousBanksSnapshot: banksRef.current,
      },
      {
        getCachedUser,
        createOperationDiagnostics,
        addOperationStage,
        logExportActivity: (input) => logExportActivity(input),
        ensureExportPermission,
        tryParseBackupManifestFile,
        resolveManifestBackupBlob,
        backupPartExt: BACKUP_PART_EXT,
        ensureStorageHeadroom,
        isFileAccessDeniedError,
        backupFileAccessDeniedMessage: BACKUP_FILE_ACCESS_DENIED_MESSAGE,
        derivePassword,
        decryptZip,
        backupVersion: BACKUP_VERSION,
        isNativeCapacitorPlatform,
        maxNativeAppBackupBytes: MAX_NATIVE_APP_BACKUP_BYTES,
        yieldToMainThread,
        storeFile,
        collectMediaReferenceSet,
        deletePadMediaArtifactsExcept,
        setBanks: (nextBanks) => setBanks(nextBanks),
        setPrimaryBankIdState,
        setSecondaryBankIdState,
        setCurrentBankIdState,
        writeOperationDiagnosticsLog,
      }
    );
  }, [user, logExportActivity]);

  const mergeImportedBankMissingMedia = React.useCallback(async (
    imported: SamplerBank,
    options?: { ownerId?: string | null; addAsNewWhenNoTarget?: boolean }
  ): Promise<{ merged: boolean; recoveredItems: number; addedBank: boolean }> => {
    return runMergeImportedBankMissingMediaPipeline(imported, options, {
      resolveOwnerId: () => user?.id ?? getCachedUser()?.id ?? lastAuthenticatedUserIdRef.current ?? null,
      banksRef,
      getHiddenProtectedBanks,
      setHiddenProtectedBanks,
      clearBankMedia,
      setBanks,
      getPadPositionOrFallback,
      normalizePadNameToken,
      loadPadMediaBlob,
      loadPadMediaBlobWithUrlFallback,
      storeFile,
      padHasExpectedImageAsset,
    });
  }, [clearBankMedia, getHiddenProtectedBanks, setHiddenProtectedBanks, user?.id]);

  const recoverMissingMediaFromBanks = React.useCallback(async (
    files: File[],
    options?: { addAsNewWhenNoTarget?: boolean }
  ) => {
    return runRecoverMissingMediaFromBanksPipeline(
      {
        files,
        options,
      },
      {
        generateOperationId,
        resolveOwnerId: () => user?.id || getCachedUser()?.id || lastAuthenticatedUserIdRef.current || null,
        importBank,
        mergeImportedBankMissingMedia,
        logExportActivity,
      }
    );
  }, [importBank, mergeImportedBankMissingMedia, user?.id, logExportActivity]);

  const persistStoreRecoveryCatalogItem = React.useCallback((runtimeBankId: string, item: StoreRecoveryCatalogItem) => {
    persistStoreRecoveryCatalogItemPipeline(runtimeBankId, item, {
      setBanks,
    });
  }, [checkAdmissionWithDefaults]);

  const resolveStoreRecoveryCatalogItem = React.useCallback(async (bank: SamplerBank): Promise<StoreRecoveryCatalogItem | null> => {
    return resolveStoreRecoveryCatalogItemPipeline(bank, {
      cacheRef: storeRecoveryCatalogCacheRef,
      persistStoreRecoveryCatalogItem,
    });
  }, [persistStoreRecoveryCatalogItem]);

  const downloadStoreBankArchiveForRecovery = React.useCallback(async (bank: SamplerBank): Promise<File | null> => {
    const effectiveUser = user || getCachedUser();
    return downloadStoreBankArchiveForRecoveryPipeline(bank, {
      userId: effectiveUser?.id || null,
      resolveStoreRecoveryCatalogItem,
      sha256HexFromBlob,
    });
  }, [resolveStoreRecoveryCatalogItem, user?.id]);

  const rehydratePadMedia = React.useCallback(async (bankId: string, padId: string): Promise<boolean> => {
    return runRehydratePadMediaPipeline(
      {
        bankId,
        padId,
      },
      {
        banksRef,
        setBanks,
        clearBankMedia,
        downloadStoreBankArchiveForRecovery,
        importBank,
        mergeImportedBankMissingMedia,
        rehydratePadMediaFromStorage,
        loadPadMediaBlobWithUrlFallback,
        storeFile,
        padNeedsMediaHydration,
        resolveOwnerId: () => user?.id || getCachedUser()?.id || lastAuthenticatedUserIdRef.current || null,
      }
    );
  }, [
    clearBankMedia,
    downloadStoreBankArchiveForRecovery,
    importBank,
    loadPadMediaBlobWithUrlFallback,
    mergeImportedBankMissingMedia,
    rehydratePadMediaFromStorage,
    storeFile,
    user?.id,
  ]);

  const rehydrateMissingMediaInBank = React.useCallback(async (bankId: string) => {
    return runRehydrateMissingMediaInBankPipeline(
      {
        bankId,
      },
      {
        banksRef,
        padNeedsMediaHydration,
        rehydratePadMedia,
      }
    );
  }, [rehydratePadMedia]);

  const prefetchOfficialBankMediaForOffline = React.useCallback(async (bankId: string) => {
    const bank = banksRef.current.find((entry) => entry.id === bankId);
    if (!bank) {
      return { candidates: 0, prefetched: 0, failed: 0 };
    }

    const isBankOfficial =
      isDefaultBankIdentity(bank) ||
      bank.restoreKind === 'default_bank' ||
      bank.restoreKind === 'paid_bank' ||
      Boolean(bank.bankMetadata?.defaultBankSource) ||
      Boolean(bank.bankMetadata?.catalogItemId) ||
      Boolean(bank.bankMetadata?.bankId);

    const candidatePads = bank.pads.filter((pad) => {
      const audioNeedsPrefetch = Boolean(pad.audioUrl) && !pad.audioStorageKey && !pad.audioBackend;
      const imageNeedsPrefetch =
        Boolean(pad.imageUrl) &&
        pad.hasImageAsset === true &&
        !pad.imageStorageKey &&
        !pad.imageBackend;
      const padIsOfficial =
        isBankOfficial ||
        pad.contentOrigin === 'official_admin' ||
        pad.contentOrigin === 'official_store' ||
        pad.restoreAssetKind === 'default_asset' ||
        pad.restoreAssetKind === 'paid_asset';
      return padIsOfficial && (audioNeedsPrefetch || imageNeedsPrefetch);
    });

    if (candidatePads.length === 0) {
      return { candidates: 0, prefetched: 0, failed: 0 };
    }

    let prefetched = 0;
    let failed = 0;
    const nextPads = [...bank.pads];

    for (let index = 0; index < candidatePads.length; index += 1) {
      const sourcePad = candidatePads[index];
      const padIndex = nextPads.findIndex((entry) => entry.id === sourcePad.id);
      if (padIndex < 0) continue;

      try {
        const currentPad = nextPads[padIndex];
        let nextPad: PadData = { ...currentPad };
        let changed = false;

        const audioNeedsPrefetch = Boolean(currentPad.audioUrl) && !currentPad.audioStorageKey && !currentPad.audioBackend;
        if (audioNeedsPrefetch) {
          const audioBlob = await loadPadMediaBlobWithUrlFallback(currentPad, 'audio');
          if (!audioBlob) throw new Error(`Failed to cache audio for "${currentPad.name}".`);
          const storedAudio = await storeFile(
            currentPad.id,
            new File([audioBlob], `${currentPad.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
            'audio'
          );
          nextPad = {
            ...nextPad,
            audioUrl: URL.createObjectURL(audioBlob),
            audioStorageKey: storedAudio.storageKey,
            audioBackend: storedAudio.backend,
          };
          changed = true;
        }

        const imageNeedsPrefetch =
          Boolean(currentPad.imageUrl) &&
          currentPad.hasImageAsset === true &&
          !currentPad.imageStorageKey &&
          !currentPad.imageBackend;
        if (imageNeedsPrefetch) {
          const imageBlob = await loadPadMediaBlobWithUrlFallback(currentPad, 'image');
          if (imageBlob) {
            const storedImage = await storeFile(
              currentPad.id,
              new File([imageBlob], `${currentPad.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
              'image'
            );
            nextPad = {
              ...nextPad,
              imageUrl: URL.createObjectURL(imageBlob),
              imageStorageKey: storedImage.storageKey,
              imageBackend: storedImage.backend,
              hasImageAsset: true,
            };
            changed = true;
          }
        }

        if (changed) {
          nextPads[padIndex] = nextPad;
          prefetched += 1;
        }
      } catch {
        failed += 1;
      }

      if ((index + 1) % 4 === 0) {
        await yieldToMainThread();
      }
    }

    if (prefetched > 0) {
      setBanks((prev) => prev.map((entry) => (
        entry.id === bankId
          ? {
              ...entry,
              pads: nextPads,
            }
          : entry
      )));
    }

    return {
      candidates: candidatePads.length,
      prefetched,
      failed,
    };
  }, [loadPadMediaBlobWithUrlFallback, setBanks, storeFile, yieldToMainThread]);


  return {
    banks, startupRestoreCompleted, primaryBankId, secondaryBankId, currentBankId, primaryBank, secondaryBank, currentBank, isDualMode,
    addPad, addPads, updatePad, removePad, createBank, setPrimaryBank, setSecondaryBank, setVisibleBanks, setCurrentBank, updateBank, deleteBank, duplicateBank, duplicatePad, importBank, exportBank, reorderPads, moveBankUp, moveBankDown, transferPad, exportAdminBank, updateStoreBank, publishDefaultBankRelease, canTransferFromBank,
    exportAppBackup, restoreAppBackup, applySamplerMetadataSnapshot, relinkPadAudioFromFile, rehydratePadMedia, rehydrateMissingMediaInBank, prefetchOfficialBankMediaForOffline, getBankPreparedSummary, prepareBankForLive, cancelPrepareBankForLive, recoverMissingMediaFromBanks,
  };
}

