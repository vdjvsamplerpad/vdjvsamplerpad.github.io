import JSZip, { type JSZipObject } from 'jszip';
import type { BankMetadata, PadData, SamplerBank } from '../types/sampler';
import {
  derivePassword,
  getDerivedKey,
  parseBankIdFromFileName,
  refreshAccessibleBanksCache,
  resolveAdminBankMetadata,
} from '@/lib/bank-utils';
import { verifySignedAdminExportToken } from '@/lib/admin-export-token';
import { verifySignedEntitlementToken } from '@/lib/entitlement-token';
import { fetchStoreDownloadAccessMaterial } from '@/lib/store-download-access';
import { checkAdmission, extractMetadataFromBlob } from '@/lib/audio-engine/AudioAdmission';
import {
  getBankDuplicateSignature,
  hasVdjvEncryptionMagic,
  hasWebCryptoSubtle,
  hasZipMagicHeader,
  isFileAccessDeniedError,
  normalizeArchiveAssetPath,
} from './useSamplerStore.importUtils';
import { createRecoverableDuplicateImportError } from './useSamplerStore.importErrors';
import { applyBankContentPolicy } from './useSamplerStore.provenance';
import { runNativeAndroidImportPipeline } from './useSamplerStore.importBank.android';
import {
  isNativeAndroidSharedImportSource,
  isNativeAndroidStoreImportSource,
  isNativeElectronStoreImportSource,
  type ImportBankSource,
} from './nativeBankImport.types';
import {
  addOperationStage,
  createAdHocOperationDiagnostics,
  failOperationDiagnostics,
  finishOperationDiagnostics,
  startOperationHeartbeat,
} from './useSamplerStore.operationDiagnostics';
import { createImportArchiveWorkerClient } from './useSamplerStore.importWorkerClient';
import type {
  ImportWorkerAssetPayload,
  ImportWorkerPadChunkDescriptor,
  ImportWorkerPadChunkItem,
} from './useSamplerStore.importWorkerShared';
const NATIVE_IMPORT_CONCURRENCY = 1;
const NATIVE_ANDROID_IMPORT_CONCURRENCY = 2;
const WEB_IMPORT_CONCURRENCY = 4;
const IMPORT_BATCH_FLUSH_COUNT = 12;
const IMPORT_BATCH_FLUSH_BYTES = 48 * 1024 * 1024;
const IMPORT_FILE_ACCESS_DENIED_MESSAGE =
  'Cannot read the selected file. Android denied storage access. Please import via the in-app picker and allow file access when prompted.';
const SHARED_EXPORT_DISABLED_PASSWORD = 'vdjv-export-disabled-2024-secure';
type MediaBackend = 'native' | 'idb';
interface BatchFileItem {
  id: string;
  blob: Blob;
  type: 'audio' | 'image';
}

const resolveArchiveAssetPath = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const normalizedPath = normalizeArchiveAssetPath(value.replace(/^\.?\//, '').trim());
  if (
    !normalizedPath ||
    normalizedPath.startsWith('blob:') ||
    normalizedPath.startsWith('data:') ||
    /^https?:\/\//i.test(normalizedPath)
  ) {
    return null;
  }
  return normalizedPath;
};

const toBlobFromWorkerAsset = (asset: ImportWorkerAssetPayload | null | undefined): Blob | null => {
  if (!asset || !(asset.buffer instanceof ArrayBuffer) || asset.buffer.byteLength <= 0) return null;
  return new Blob([asset.buffer], { type: asset.type || 'application/octet-stream' });
};
export interface ImportBankOptions {
  allowDuplicateImport?: boolean;
  skipActivityLog?: boolean;
  preferredDerivedKey?: string | null;
  preferredBankId?: string | null;
  entitlementToken?: string | null;
  replaceExistingBankId?: string | null;
}
type ImportActivityPayload = {
  status: 'success' | 'failed';
  bankName: string;
  bankId?: string;
  padNames: string[];
  includePadList: boolean;
  errorMessage?: string;
};
export interface ImportBankPipelineDeps {
  user: { id: string } | null;
  getCachedUser: () => { id: string } | null;
  banks: SamplerBank[];
  banksRefCurrent: SamplerBank[];
  profileRole?: string | null;
  quotaPolicy: {
    ownedBankQuota: number;
    ownedBankPadCap: number;
    deviceTotalBankCap: number;
  };
  emitImportStage: (message: string, startedAt: number, progress?: number, stageId?: string) => void;
  ensureStorageHeadroom: (requiredBytes: number, operationName: string) => Promise<void>;
  normalizeIdentityToken: (value: unknown) => string | null;
  countOwnedCountedBanks: (banks: SamplerBank[]) => number;
  generateId: () => string;
  isNativeCapacitorPlatform: () => boolean;
  isNativeAndroid: () => boolean;
  supportsNativeMediaStorage: () => boolean;
  storeFile: (
    id: string,
    file: File,
    type: 'audio' | 'image',
    options?: { storageId?: string; nativeStorageKeyHint?: string }
  ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
  saveBatchBlobsToDB: (items: BatchFileItem[]) => Promise<void>;
  yieldToMainThread: () => Promise<void>;
  sha256HexFromText: (text: string) => Promise<string>;
  dedupeBanksByIdentity: (inputBanks: SamplerBank[]) => {
    banks: SamplerBank[];
    removedIdToKeptId: Map<string, string>;
  };
  setBanks: (updater: (prev: SamplerBank[]) => SamplerBank[]) => void;
  logImportActivity: (payload: ImportActivityPayload) => void;
}
export const runImportBankPipeline = async (
  source: ImportBankSource,
  onProgress: ((progress: number) => void) | undefined,
  options: ImportBankOptions | undefined,
  deps: ImportBankPipelineDeps
): Promise<SamplerBank | null> => {
    if (
      deps.isNativeCapacitorPlatform() &&
      deps.isNativeAndroid() &&
      (isNativeAndroidStoreImportSource(source) || isNativeAndroidSharedImportSource(source))
    ) {
      return runNativeAndroidImportPipeline(source, onProgress, options, deps);
    }
    if (
      isNativeElectronStoreImportSource(source) ||
      (source instanceof File &&
        deps.supportsNativeMediaStorage() &&
        typeof window !== 'undefined' &&
        typeof (source as File & { path?: string }).path === 'string' &&
        typeof window.electronAPI?.importArchiveJob === 'function')
    ) {
      return runNativeAndroidImportPipeline(source, onProgress, options, deps);
    }
    if (!(source instanceof File)) {
      throw new Error('Unsupported import source.');
    }
    const file = source;
    const {
      user,
      getCachedUser,
      banks,
      banksRefCurrent,
      profileRole,
      quotaPolicy,
      emitImportStage,
      ensureStorageHeadroom,
      normalizeIdentityToken,
      countOwnedCountedBanks,
      generateId,
      isNativeCapacitorPlatform,
      isNativeAndroid,
      supportsNativeMediaStorage,
      storeFile,
      saveBatchBlobsToDB,
      yieldToMainThread,
      sha256HexFromText,
      dedupeBanksByIdentity,
      setBanks,
      logImportActivity,
    } = deps;
    const profile: { role?: string | null } = { role: profileRole ?? null };
    const banksRef = { current: banksRefCurrent };
    const effectiveUser = user || getCachedUser();
    let importBankName = file?.name || 'unknown.bank';
    let importPadNames: string[] = [];
    let includePadList = false;
    const importStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const operationDiagnostics = createAdHocOperationDiagnostics('bank_import', effectiveUser?.id || null);
    let lastReportedProgress = 0;
    let lastReportedStageId: string | null = null;
    const stopHeartbeat = startOperationHeartbeat(operationDiagnostics, {
      getDetails: () => ({
        bankName: importBankName,
        fileName: file?.name || 'unknown.bank',
        fileBytes: file?.size || 0,
        progress: lastReportedProgress,
        stageId: lastReportedStageId,
      }),
    });
    let zipStageCompletedAt = importStartedAt;
    let parseStageCompletedAt = importStartedAt;
    const reportImportStage = (
      message: string,
      progress?: number,
      stageId?: string,
      debugDetails?: Record<string, unknown>
    ) => {
      emitImportStage(message, importStartedAt, progress, stageId);
      if (typeof progress === 'number') onProgress?.(progress);
      if (typeof progress === 'number') {
        lastReportedProgress = progress;
      }
      lastReportedStageId = stageId || null;
      addOperationStage(operationDiagnostics, stageId || 'stage', {
        message,
        progress,
        elapsedMs: Math.max(
          0,
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - importStartedAt
        ),
        ...debugDetails,
      });
    };
    const lastDerivedKeyStorageKey = effectiveUser ? `vdjv-last-import-derived-key-${effectiveUser.id}` : null;
    const setLastDerivedKey = (derivedKey: string): void => {
      if (!lastDerivedKeyStorageKey || typeof window === 'undefined' || !derivedKey) return;
      try {
        localStorage.setItem(lastDerivedKeyStorageKey, derivedKey);
      } catch {
        // Ignore local storage failures.
      }
    };
    const workerClient = createImportArchiveWorkerClient();
    try {
      reportImportStage('Checking bank file...', 5, 'validate-file');


      // Validate file before processing
      if (!file || file.size === 0) {
        throw new Error('Invalid file: File is empty or not accessible');
      }

      if (!file.name.endsWith('.bank')) {
        throw new Error('Please select a valid .bank file.');
      }

      try {
        await file.slice(0, 64).arrayBuffer();
      } catch (error) {
        if (isFileAccessDeniedError(error)) {
          throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
        }
        throw error;
      }

      reportImportStage('Checking available storage...', 8, 'storage-check');
      await ensureStorageHeadroom(Math.ceil(file.size * 1.2), 'bank import');

      const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(ms / 1000)}s`)), ms);
        });
        try {
          return await Promise.race([promise, timeoutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };

      const baseTimeoutMs = 60_000;
      const per100MbMs = 60_000;
      const maxTimeoutMs = 10 * 60_000;
      const sizeIn100Mb = Math.max(1, Math.ceil(file.size / (100 * 1024 * 1024)));
      const adaptiveTimeoutMs = Math.min(maxTimeoutMs, baseTimeoutMs + (sizeIn100Mb * per100MbMs));
      const looksLikePlainZip = await hasZipMagicHeader(file);
      const looksLikeVdjvEncryptedEnvelope = !looksLikePlainZip && await hasVdjvEncryptionMagic(file);
      if (looksLikeVdjvEncryptedEnvelope && !hasWebCryptoSubtle()) {
        throw new Error('Encrypted bank import requires a secure context (HTTPS or localhost).');
      }

      reportImportStage('Reading bank archive...', 10, 'zip-open');

      let bankData: any;
      let bankJsonText = '';
      let metadata: BankMetadata | null = null;
      const preferredDerivedKey = typeof options?.preferredDerivedKey === 'string'
        ? options.preferredDerivedKey.trim()
        : '';
      const preferredBankId = typeof options?.preferredBankId === 'string'
        ? options.preferredBankId.trim()
        : '';
      const hintedId = parseBankIdFromFileName(file.name);
      const candidateBankIds = Array.from(
        new Set([preferredBankId, hintedId || ''].filter((id) => typeof id === 'string' && id.trim().length > 0))
      );
      const buildCandidateKeys = async (allowRefresh: boolean): Promise<string[]> => {
        const keys: string[] = [SHARED_EXPORT_DISABLED_PASSWORD];
        if (preferredDerivedKey) keys.push(preferredDerivedKey);
        if (profile?.role === 'admin') {
          for (const bankId of candidateBankIds) {
            const adminDerivedKey = await derivePassword(bankId).catch(() => '');
            if (adminDerivedKey) keys.push(adminDerivedKey);
          }
        }
        if (effectiveUser && candidateBankIds.length > 0) {
          if (allowRefresh) {
            reportImportStage('Refreshing granted bank keys...', 17, 'decrypt-access-refresh');
            await refreshAccessibleBanksCache(effectiveUser.id).catch(() => {});
          }
          reportImportStage(`Resolving ${candidateBankIds.length} bank key hint(s)...`, 16, 'decrypt-bank-id-hints');
          for (let index = 0; index < candidateBankIds.length; index += 1) {
            const bankId = candidateBankIds[index];
            reportImportStage(
              `Resolving bank key (${index + 1}/${candidateBankIds.length})...`,
              17,
              'decrypt-bank-id-resolve'
            );
            const derivedKey = await getDerivedKey(bankId, effectiveUser.id);
            if (derivedKey) keys.push(derivedKey);
          }
        }
        return Array.from(new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0)));
      };

      try {
        let openResult: Awaited<ReturnType<typeof workerClient.open>> | null = null;
        const openArchiveWithKeys = async (allowRefresh: boolean) => {
          const candidateKeys = await buildCandidateKeys(allowRefresh);
          if (looksLikeVdjvEncryptedEnvelope) {
            reportImportStage('Encrypted bank detected. Opening archive...', 12, 'decrypt-start');
          }
          return withTimeout(
            workerClient.open(file, candidateKeys, adaptiveTimeoutMs),
            adaptiveTimeoutMs,
            'Archive import worker'
          );
        };

        try {
          openResult = await openArchiveWithKeys(false);
        } catch (openError) {
          if (isFileAccessDeniedError(openError)) {
            throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
          }
          if (
            looksLikeVdjvEncryptedEnvelope &&
            effectiveUser &&
            candidateBankIds.length > 0
          ) {
            openResult = await openArchiveWithKeys(true);
          } else if (looksLikeVdjvEncryptedEnvelope && !effectiveUser && !preferredDerivedKey) {
            throw new Error('Login required to import encrypted banks. Please sign in and try again.');
          } else {
            throw openError;
          }
        }

        if (!openResult) {
          throw new Error('This file is not a valid bank file.');
        }

        if (openResult.usedKey && openResult.usedKey !== SHARED_EXPORT_DISABLED_PASSWORD) {
          setLastDerivedKey(openResult.usedKey);
        }

        reportImportStage(
          looksLikeVdjvEncryptedEnvelope ? 'Encrypted archive opened.' : 'Archive loaded (not encrypted).',
          20,
          'zip-opened'
        );
        zipStageCompletedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        reportImportStage('Reading bank metadata...', 20, 'metadata-start');
        bankJsonText = openResult.bankJsonText;
        reportImportStage('Parsing bank content...', 23, 'bank-json-parse');
        bankData = openResult.bankData;
        metadata = openResult.metadata
          ? {
              password: openResult.metadata.password ?? false,
              transferable: openResult.metadata.transferable ?? true,
              exportable: openResult.metadata.exportable,
              adminExportToken: openResult.metadata.adminExportToken,
              adminExportTokenKid: openResult.metadata.adminExportTokenKid,
              adminExportTokenIssuedAt: openResult.metadata.adminExportTokenIssuedAt,
              adminExportTokenExpiresAt: openResult.metadata.adminExportTokenExpiresAt,
              adminExportTokenBankSha256: openResult.metadata.adminExportTokenBankSha256,
              bankId: openResult.metadata.bankId,
              entitlementToken: openResult.metadata.entitlementToken,
              entitlementTokenKid: openResult.metadata.entitlementTokenKid,
              entitlementTokenIssuedAt: openResult.metadata.entitlementTokenIssuedAt,
              entitlementTokenExpiresAt: openResult.metadata.entitlementTokenExpiresAt,
              entitlementTokenVerified: openResult.metadata.entitlementTokenVerified,
              catalogItemId: openResult.metadata.catalogItemId,
              catalogSha256: openResult.metadata.catalogSha256,
              title: openResult.metadata.title,
              description: openResult.metadata.description,
              color: openResult.metadata.color,
              thumbnailUrl: openResult.metadata.thumbnailUrl,
              thumbnailRemoved: openResult.metadata.thumbnailRemoved,
              thumbnailAssetPath: openResult.metadata.thumbnailAssetPath,
              hideThumbnailPreview: openResult.metadata.hideThumbnailPreview,
            }
          : null;

        if (!bankData || typeof bankData !== 'object') {
          throw new Error('Invalid bank file data. This file may be damaged or unsupported.');
        }
        if (!bankData.name || !Array.isArray(bankData.pads)) {
          throw new Error('Invalid bank file format: Missing required fields');
        }
        importBankName = String(bankData.name);
        importPadNames = (bankData.pads as any[]).map((pad: any) => pad?.name || 'Untitled Pad');
        parseStageCompletedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error('Invalid bank file: bank.json is corrupted or invalid JSON');
        }
        throw error;
      }
      const bankJsonSha256 = await sha256HexFromText(bankJsonText);

      const bankDataId =
        typeof bankData?.id === 'string' && bankData.id.trim().length > 0
          ? bankData.id.trim()
          : undefined;
      const importSignature = getBankDuplicateSignature(bankData);
      const metadataBankId = metadata?.bankId || parseBankIdFromFileName(file.name) || undefined;
      const replaceExistingBankId = typeof options?.replaceExistingBankId === 'string'
        ? options.replaceExistingBankId.trim()
        : '';
      if (metadataBankId && !metadata?.bankId) {
        metadata = {
          password: metadata?.password ?? false,
          transferable: metadata?.transferable ?? true,
          exportable: metadata?.exportable,
          adminExportToken: metadata?.adminExportToken,
          adminExportTokenKid: metadata?.adminExportTokenKid,
          adminExportTokenIssuedAt: metadata?.adminExportTokenIssuedAt,
          adminExportTokenExpiresAt: metadata?.adminExportTokenExpiresAt,
          adminExportTokenBankSha256: metadata?.adminExportTokenBankSha256,
          bankId: metadataBankId,
          entitlementToken: metadata?.entitlementToken,
          entitlementTokenKid: metadata?.entitlementTokenKid,
          entitlementTokenIssuedAt: metadata?.entitlementTokenIssuedAt,
          entitlementTokenExpiresAt: metadata?.entitlementTokenExpiresAt,
          entitlementTokenVerified: metadata?.entitlementTokenVerified,
          catalogItemId: metadata?.catalogItemId,
          catalogSha256: metadata?.catalogSha256,
          title: metadata?.title,
          description: metadata?.description,
          color: metadata?.color,
          thumbnailUrl: metadata?.thumbnailUrl,
          thumbnailRemoved: metadata?.thumbnailRemoved,
          thumbnailAssetPath: metadata?.thumbnailAssetPath,
          hideThumbnailPreview: metadata?.hideThumbnailPreview,
        };
      }

      includePadList = !(metadata?.password === true || !!metadataBankId);
      const duplicateTokens = new Set<string>();
      const addDuplicateToken = (value: unknown) => {
        const normalized = normalizeIdentityToken(value);
        if (normalized) duplicateTokens.add(normalized);
      };

      addDuplicateToken(bankDataId);
      addDuplicateToken(metadataBankId);
      addDuplicateToken(importSignature);

      if (!options?.allowDuplicateImport && duplicateTokens.size > 0) {
        const duplicateBank = banksRef.current.find((bank) => {
          if (replaceExistingBankId && bank.id === replaceExistingBankId) return false;
          const bankSignature = getBankDuplicateSignature(bank);
          return [bank.id, bank.sourceBankId, bank.bankMetadata?.bankId, bankSignature]
            .some((token) => {
              const normalized = normalizeIdentityToken(token);
              return normalized ? duplicateTokens.has(normalized) : false;
            });
        });

        if (duplicateBank) {
          if (duplicateBank.restoreStatus && duplicateBank.restoreStatus !== 'ready') {
            throw createRecoverableDuplicateImportError(duplicateBank, importBankName);
          }
          throw new Error('This bank is already imported.');
        }
      }
      const isAdminBank = Boolean(
        metadata?.password === true ||
        metadataBankId ||
        metadata?.trustedAdminExport ||
        (typeof metadata?.adminExportToken === 'string' && metadata.adminExportToken.trim().length > 0)
      );

      let resolvedBankName = bankData.name;
      let resolvedBankColor = typeof bankData.defaultColor === 'string' ? bankData.defaultColor : '#3b82f6';
      if (metadataBankId) {
        const resolvedMetadata = await resolveAdminBankMetadata(metadataBankId);
        if (resolvedMetadata) {
          resolvedBankName = resolvedMetadata.title;
          metadata = {
            password: metadata?.password ?? false,
            transferable: metadata?.transferable ?? true,
            exportable: metadata?.exportable,
            adminExportToken: metadata?.adminExportToken,
            adminExportTokenKid: metadata?.adminExportTokenKid,
            adminExportTokenIssuedAt: metadata?.adminExportTokenIssuedAt,
            adminExportTokenExpiresAt: metadata?.adminExportTokenExpiresAt,
            adminExportTokenBankSha256: metadata?.adminExportTokenBankSha256,
            bankId: metadataBankId,
            entitlementToken: metadata?.entitlementToken,
            entitlementTokenKid: metadata?.entitlementTokenKid,
            entitlementTokenIssuedAt: metadata?.entitlementTokenIssuedAt,
            entitlementTokenExpiresAt: metadata?.entitlementTokenExpiresAt,
            entitlementTokenVerified: metadata?.entitlementTokenVerified,
            catalogItemId: metadata?.catalogItemId,
            catalogSha256: metadata?.catalogSha256,
            title: resolvedMetadata.title,
            description: resolvedMetadata.description,
            color: resolvedMetadata.color || metadata?.color,
            thumbnailUrl: metadata?.thumbnailUrl,
            thumbnailRemoved: metadata?.thumbnailRemoved,
            thumbnailAssetPath: metadata?.thumbnailAssetPath,
            hideThumbnailPreview: metadata?.hideThumbnailPreview,
          };
          importBankName = resolvedMetadata.title;
          if (resolvedMetadata.color) {
            resolvedBankColor = resolvedMetadata.color;
          }
        } else if (metadata?.color) {
          resolvedBankColor = metadata.color;
        }
      } else if (metadata?.color) {
        resolvedBankColor = metadata.color;
      }

      const embeddedThumbnailBlob = toBlobFromWorkerAsset(
        await withTimeout(
          workerClient.extractThumbnail(metadata?.thumbnailAssetPath || null),
          adaptiveTimeoutMs,
          'Thumbnail extract'
        )
      );
      if (embeddedThumbnailBlob) {
        metadata = {
          ...(metadata || {
            password: false,
            transferable: true,
          }),
          thumbnailUrl: URL.createObjectURL(embeddedThumbnailBlob),
          thumbnailRemoved: undefined,
          hideThumbnailPreview: metadata?.hideThumbnailPreview,
        };
      }

      let hasVerifiedSignedAdminExportToken = false;
      const signedAdminExportToken = typeof metadata?.adminExportToken === 'string'
        ? metadata.adminExportToken.trim()
        : '';
      if (signedAdminExportToken) {
        if (!bankJsonSha256) {
          reportImportStage('Admin trust token skipped (missing hash).', 24, 'admin-token-skip');
        } else {
          const verification = await verifySignedAdminExportToken(signedAdminExportToken, bankJsonSha256);
          if (verification.valid) {
            hasVerifiedSignedAdminExportToken = true;
            metadata = {
              ...(metadata || {
                password: false,
                transferable: true,
              }),
              trustedAdminExport: true,
              adminExportTokenBankSha256: bankJsonSha256,
              adminExportTokenKid: verification.payload?.kid || metadata?.adminExportTokenKid,
            };
            reportImportStage('Admin trust token verified.', 24, 'admin-token-verified');
          } else {
            reportImportStage('Admin trust token invalid. Using owned quota rules.', 24, 'admin-token-invalid');
          }
        }
      }

      // Reuse effective user for admin access checks.
      const userForAccess = user || getCachedUser();
      let hasVerifiedEntitlementToken = false;
      const entitlementTokenFromOption = typeof options?.entitlementToken === 'string'
        ? options.entitlementToken.trim()
        : '';
      const entitlementTokenFromMetadata = typeof metadata?.entitlementToken === 'string'
        ? metadata.entitlementToken.trim()
        : '';
      const signedEntitlementToken = entitlementTokenFromOption || entitlementTokenFromMetadata;
      let entitlementVerificationReason: string | null = null;
      const requiresSignedEntitlement = Boolean(
        isAdminBank &&
        metadataBankId &&
        (metadata?.catalogItemId || options?.preferredDerivedKey)
      );
      if (requiresSignedEntitlement && !signedEntitlementToken && metadata?.catalogItemId && userForAccess?.id) {
        const accessMaterial = await fetchStoreDownloadAccessMaterial(metadata.catalogItemId).catch(() => null);
        if (accessMaterial?.entitlementToken) {
          metadata = {
            ...(metadata || {
              password: false,
              transferable: true,
            }),
            entitlementToken: accessMaterial.entitlementToken,
            entitlementTokenKid: accessMaterial.entitlementTokenKid || metadata?.entitlementTokenKid,
            entitlementTokenIssuedAt: accessMaterial.entitlementTokenIssuedAt || metadata?.entitlementTokenIssuedAt,
            entitlementTokenExpiresAt: accessMaterial.entitlementTokenExpiresAt || metadata?.entitlementTokenExpiresAt,
          };
          reportImportStage('Resolved Store entitlement for shared import.', 24, 'entitlement-token-resolved', {
            source: 'download-key',
            hasCatalogItemId: true,
          });
        }
      }
      const resolvedEntitlementTokenFromMetadata = typeof metadata?.entitlementToken === 'string'
        ? metadata.entitlementToken.trim()
        : '';
      const resolvedSignedEntitlementToken = entitlementTokenFromOption || resolvedEntitlementTokenFromMetadata;
      if (requiresSignedEntitlement && !resolvedSignedEntitlementToken) {
        reportImportStage('Missing entitlement token. Import blocked.', 24, 'entitlement-token-missing', {
          reason: 'missing_token',
          tokenSource: entitlementTokenFromOption ? 'option' : (resolvedEntitlementTokenFromMetadata ? 'metadata' : 'none'),
          hasCatalogItemId: Boolean(metadata?.catalogItemId),
          hasPreferredDerivedKey: Boolean(options?.preferredDerivedKey),
        });
        throw new Error('This bank requires a signed entitlement token. Please re-download it from Store.');
      }
      if (resolvedSignedEntitlementToken && userForAccess?.id && metadataBankId) {
        const entitlementVerification = await verifySignedEntitlementToken({
          token: resolvedSignedEntitlementToken,
          expectedUserId: userForAccess.id,
          expectedBankId: metadataBankId,
          expectedCatalogItemId: metadata?.catalogItemId || null,
        });
        if (entitlementVerification.valid) {
          hasVerifiedEntitlementToken = true;
          metadata = {
            ...(metadata || {
              password: false,
              transferable: true,
            }),
            entitlementToken: resolvedSignedEntitlementToken,
            entitlementTokenKid: entitlementVerification.payload?.kid || metadata?.entitlementTokenKid,
            entitlementTokenIssuedAt: metadata?.entitlementTokenIssuedAt,
            entitlementTokenExpiresAt: metadata?.entitlementTokenExpiresAt,
            entitlementTokenVerified: true,
          };
          reportImportStage('Entitlement token verified.', 24, 'entitlement-token-verified');
        } else {
          entitlementVerificationReason = entitlementVerification.reason;
          reportImportStage('Entitlement token invalid. Import blocked.', 24, 'entitlement-token-invalid', {
            reason: entitlementVerification.reason,
            tokenSource: entitlementTokenFromOption ? 'option' : (resolvedEntitlementTokenFromMetadata ? 'metadata' : 'unknown'),
            hasCatalogItemId: Boolean(metadata?.catalogItemId),
            expectedCatalogItemId: metadata?.catalogItemId || null,
          });
        }
      }

      if (isAdminBank && !userForAccess) throw new Error('Login required');
      if (requiresSignedEntitlement && !hasVerifiedEntitlementToken) {
        throw new Error(
          entitlementVerificationReason
            ? `Entitlement verification failed (${entitlementVerificationReason}). Please re-download the bank from Store.`
            : 'Entitlement verification failed. Please re-download the bank from Store.'
        );
      }

      const importedIsTrustedBank = Boolean(
        isAdminBank ||
        metadata?.catalogItemId ||
        metadataBankId ||
        hasVerifiedSignedAdminExportToken ||
        metadata?.trustedAdminExport
      );
      const importedContentOrigin: PadData['contentOrigin'] =
        metadata?.catalogItemId ? 'official_store' : (importedIsTrustedBank ? 'official_admin' : 'user');
      const importedIsOwnedCounted = !importedIsTrustedBank;
      const currentBanks = banksRef.current;
      const replaceExistingBank = replaceExistingBankId
        ? currentBanks.find((bank) => bank.id === replaceExistingBankId) || null
        : null;
      if (profile?.role !== 'admin') {
        if (currentBanks.length >= quotaPolicy.deviceTotalBankCap) {
          throw new Error(`LIMITED: You reached your device bank limit (${quotaPolicy.deviceTotalBankCap}). Remove a bank before importing another one.`);
        }
        if (importedIsOwnedCounted) {
          const ownedUsed = countOwnedCountedBanks(currentBanks);
          if (ownedUsed >= quotaPolicy.ownedBankQuota) {
            throw new Error(`LIMITED: You reached your owned bank quota (${quotaPolicy.ownedBankQuota}). Trusted Store/Admin imports are unlimited. Message us on facebook for expansion.`);
          }
          const incomingPadCount = Array.isArray(bankData?.pads) ? bankData.pads.length : 0;
          if (incomingPadCount > quotaPolicy.ownedBankPadCap) {
            throw new Error(`Owned bank import blocked: ${incomingPadCount} pads found, max allowed is ${quotaPolicy.ownedBankPadCap}.`);
          }
        }
      }

      reportImportStage('Preparing pads for import...', 30, 'pads-start');

      const maxSortOrder = banks.length > 0 ? Math.max(...banks.map(b => b.sortOrder || 0)) : -1;
      const newBank: SamplerBank = {
        ...bankData,
        id: replaceExistingBank?.id || generateId(),
        name: replaceExistingBank?.name || resolvedBankName,
        defaultColor: replaceExistingBank?.defaultColor || resolvedBankColor,
        createdAt: replaceExistingBank?.createdAt || (bankData.createdAt ? new Date(bankData.createdAt) : new Date()),
        sortOrder: replaceExistingBank?.sortOrder ?? (maxSortOrder + 1),
        creatorEmail:
          replaceExistingBank?.creatorEmail ||
          (typeof bankData?.creatorEmail === 'string' && bankData.creatorEmail.trim().length > 0
            ? bankData.creatorEmail.trim()
            : undefined),
        pads: [],
        sourceBankId: metadataBankId || bankDataId || importSignature,
        isAdminBank,
        transferable: true,
        exportable: metadata?.exportable ?? true,
        bankMetadata: metadata,
        isLocalDuplicate: replaceExistingBank?.isLocalDuplicate,
        duplicateOriginBankId: replaceExistingBank?.duplicateOriginBankId,
        restoreKind: replaceExistingBank?.restoreKind,
        restoreStatus: replaceExistingBank?.restoreStatus,
        remoteSnapshotApplied: replaceExistingBank?.remoteSnapshotApplied,
      };

      if (embeddedThumbnailBlob) {
        try {
          const thumbStorageId = `bank-thumbnail-${newBank.id}`;
          const thumbExt = (() => {
            const mime = embeddedThumbnailBlob.type || '';
            if (mime === 'image/png') return 'png';
            if (mime === 'image/webp') return 'webp';
            if (mime === 'image/gif') return 'gif';
            if (mime === 'image/jpeg') return 'jpg';
            return 'bin';
          })();
          const storedThumbnail = await storeFile(
            thumbStorageId,
            new File([embeddedThumbnailBlob], `${thumbStorageId}.${thumbExt}`, { type: embeddedThumbnailBlob.type || 'application/octet-stream' }),
            'image',
            {
              storageId: `image_${thumbStorageId}`,
              nativeStorageKeyHint: `image/${thumbStorageId}.${thumbExt}`,
            }
          );
          newBank.bankMetadata = {
            ...(newBank.bankMetadata || {
              password: false,
              transferable: true,
            }),
            thumbnailStorageKey: storedThumbnail.storageKey,
            thumbnailBackend: storedThumbnail.backend,
          };
        } catch {
          // Keep the in-memory thumbnail URL even if persistence fails.
        }
      }

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const createFastIOSBlobURL = async (blob: Blob): Promise<string> => {
        if (!isIOS) return URL.createObjectURL(blob);
        try {
          const url = URL.createObjectURL(blob);
          await new Promise<void>(resolve => {
            const audio = new Audio();
            const t = setTimeout(() => { audio.src = ''; resolve(); }, 50);
            audio.oncanplaythrough = () => { clearTimeout(t); resolve(); };
            audio.onerror = () => { clearTimeout(t); resolve(); };
            audio.src = url;
          });
          return url;
        } catch (e) {
          return URL.createObjectURL(blob);
        }
      };

      const newPads: PadData[] = [];
      const totalPads = bankData.pads.length;
      const nativeMode = supportsNativeMediaStorage();
      const aggressiveAndroidImport = isNativeCapacitorPlatform() && isNativeAndroid();
      const concurrentPadCount = nativeMode
        ? (aggressiveAndroidImport ? NATIVE_ANDROID_IMPORT_CONCURRENCY : NATIVE_IMPORT_CONCURRENCY)
        : WEB_IMPORT_CONCURRENCY;
      const pendingBatchFilesToStore: BatchFileItem[] = [];
      let pendingBatchBytes = 0;
      const importDiagnostics = {
        audioBytes: 0,
        imageBytes: 0,
        rejectedPads: 0,
      };

      const flushPendingBatchFiles = async () => {
        if (nativeMode || pendingBatchFilesToStore.length === 0) return;
        const items = pendingBatchFilesToStore.splice(0, pendingBatchFilesToStore.length);
        pendingBatchBytes = 0;
        try {
          await withTimeout(
            saveBatchBlobsToDB(items),
            adaptiveTimeoutMs,
            'Save batch'
          );
        } catch (e) {
          throw new Error(`Failed to save files to storage: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      const processPad = async (
        padData: any,
        globalPadIndex: number,
        extractedAssets: ImportWorkerPadChunkItem | null
      ): Promise<PadData | null> => {
        try {
          const newPadId = generateId();
          let audioUrl: string | null = null;
          let imageUrl: string | null = null;
          let audioStorageKey: string | undefined;
          let imageStorageKey: string | undefined;
          let audioBackend: MediaBackend = 'idb';
          let imageBackend: MediaBackend = 'idb';
          let hasImageAsset = false;
          let audioBytes: number | undefined;
          let audioDurationMs: number | undefined;

          const audioBlob = toBlobFromWorkerAsset(extractedAssets?.audio);
          if (audioBlob) {
            try {
              const inferredDurationMs =
                typeof padData.audioDurationMs === 'number' && Number.isFinite(padData.audioDurationMs) && padData.audioDurationMs > 0
                  ? Math.round(padData.audioDurationMs)
                  : (
                    typeof padData.endTimeMs === 'number' && Number.isFinite(padData.endTimeMs) && padData.endTimeMs > 0
                      ? Math.round(padData.endTimeMs)
                      : 0
                  );
              const trustedAudioBytes =
                typeof padData.audioBytes === 'number' && Number.isFinite(padData.audioBytes) && padData.audioBytes > 0
                  ? Math.round(padData.audioBytes)
                  : audioBlob.size;
              const canTrustArchiveAdmission =
                aggressiveAndroidImport ||
                (trustedAudioBytes > 0 && inferredDurationMs > 0);
              const admissionMetadata = canTrustArchiveAdmission
                ? { audioBytes: trustedAudioBytes, audioDurationMs: inferredDurationMs }
                : await extractMetadataFromBlob(audioBlob);
              const admission = checkAdmission(admissionMetadata);
              if (!admission.allowed) {
                importDiagnostics.rejectedPads += 1;
                return null;
              }
              audioBytes = admissionMetadata.audioBytes;
              audioDurationMs = admissionMetadata.audioDurationMs > 0 ? admissionMetadata.audioDurationMs : undefined;

              if (nativeMode) {
                const storedAudio = await storeFile(
                  newPadId,
                  new File([audioBlob], `${newPadId}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
                  'audio'
                );
                audioStorageKey = storedAudio.storageKey;
                audioBackend = storedAudio.backend;
              } else {
                pendingBatchFilesToStore.push({ id: newPadId, blob: audioBlob, type: 'audio' });
                pendingBatchBytes += audioBlob.size;
              }
              audioUrl = await createFastIOSBlobURL(audioBlob);
              importDiagnostics.audioBytes += audioBlob.size;
            } catch {
            }
          }

          const imageBlob = toBlobFromWorkerAsset(extractedAssets?.image);
          if (imageBlob) {
            try {
              hasImageAsset = true;
              if (nativeMode) {
                const storedImage = await storeFile(
                  newPadId,
                  new File([imageBlob], `${newPadId}.image`, { type: imageBlob.type || 'application/octet-stream' }),
                  'image'
                );
                imageStorageKey = storedImage.storageKey;
                imageBackend = storedImage.backend;
              } else {
                pendingBatchFilesToStore.push({ id: newPadId, blob: imageBlob, type: 'image' });
                pendingBatchBytes += imageBlob.size;
              }
              imageUrl = await createFastIOSBlobURL(imageBlob);
              importDiagnostics.imageBytes += imageBlob.size;
            } catch {
            }
          }

          if (!audioUrl) {
            importDiagnostics.rejectedPads += 1;
            return null;
          }

          return {
            ...padData,
            id: newPadId,
            audioUrl,
            imageUrl,
            audioStorageKey,
            audioBackend,
            imageStorageKey,
            imageBackend,
            hasImageAsset,
            imageData: undefined,
            shortcutKey: padData.shortcutKey || undefined,
            midiNote: typeof padData.midiNote === 'number' ? padData.midiNote : undefined,
            midiCC: typeof padData.midiCC === 'number' ? padData.midiCC : undefined,
            ignoreChannel: !!padData.ignoreChannel,
            fadeInMs: padData.fadeInMs || 0,
            fadeOutMs: padData.fadeOutMs || 0,
            startTimeMs: padData.startTimeMs || 0,
            endTimeMs: padData.endTimeMs || audioDurationMs || 0,
            pitch: padData.pitch || 0,
            tempoPercent: typeof padData.tempoPercent === 'number' ? padData.tempoPercent : 0,
            keyLock: padData.keyLock !== false,
            audioBytes,
            audioDurationMs,
            savedHotcuesMs: Array.isArray(padData.savedHotcuesMs)
              ? (padData.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
              : [null, null, null, null],
            position: padData.position ?? globalPadIndex,
            contentOrigin: importedContentOrigin,
            originBankId: importedContentOrigin === 'user' ? undefined : (metadataBankId || bankDataId || undefined),
            originPadId: importedContentOrigin === 'user'
              ? (typeof padData.originPadId === 'string' ? padData.originPadId : undefined)
              : (typeof padData.originPadId === 'string' && padData.originPadId.trim().length > 0
                ? padData.originPadId
                : (typeof padData.id === 'string' ? padData.id : undefined)),
            originCatalogItemId:
              importedContentOrigin === 'official_store'
                ? (metadata?.catalogItemId || (typeof padData.originCatalogItemId === 'string' ? padData.originCatalogItemId : undefined))
                : undefined,
            originBankTitle:
              importedContentOrigin === 'user'
                ? (typeof padData.originBankTitle === 'string' ? padData.originBankTitle : undefined)
                : (metadata?.title || resolvedBankName || bankData.name || undefined),
          };
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          return null;
        }
      };

      const padImportStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      for (let i = 0; i < totalPads; i += concurrentPadCount) {
        const chunk = bankData.pads.slice(i, i + concurrentPadCount);
        const workerChunkDescriptors: ImportWorkerPadChunkDescriptor[] = chunk.map((padData: any, localIndex: number) => ({
          index: i + localIndex,
          audioPath: resolveArchiveAssetPath(padData.audioUrl),
          imagePath: resolveArchiveAssetPath(padData.imageUrl),
        }));
        const extractedChunkItems = await withTimeout(
          workerClient.extractPadChunk(workerChunkDescriptors),
          adaptiveTimeoutMs,
          'Pad chunk extract'
        );
        const extractedByIndex = new Map<number, ImportWorkerPadChunkItem>();
        extractedChunkItems.forEach((item) => {
          extractedByIndex.set(item.index, item);
        });
        const chunkResults = await Promise.allSettled(
          chunk.map((padData: any, localIndex: number) =>
            processPad(padData, i + localIndex, extractedByIndex.get(i + localIndex) || null)
          )
        );

        for (let localIndex = 0; localIndex < chunkResults.length; localIndex += 1) {
          const globalPadIndex = i + localIndex;
          const chunkResult = chunkResults[localIndex];
          if (chunkResult.status === 'fulfilled' && chunkResult.value) {
            newPads.push(chunkResult.value);
          } else if (chunkResult.status === 'rejected') {
            importDiagnostics.rejectedPads += 1;
          }

          const currentProgress = 30 + (((globalPadIndex + 1) / Math.max(totalPads, 1)) * 60);
          onProgress && onProgress(Math.min(95, currentProgress));
          await yieldToMainThread();
        }

        if (!nativeMode && (
          pendingBatchFilesToStore.length >= IMPORT_BATCH_FLUSH_COUNT ||
          pendingBatchBytes >= IMPORT_BATCH_FLUSH_BYTES
        )) {
          await flushPendingBatchFiles();
        }
        reportImportStage(
          `Importing pads... ${Math.min(i + chunk.length, totalPads)}/${totalPads}`,
          Math.min(95, 30 + ((Math.min(i + chunk.length, totalPads) / Math.max(totalPads, 1)) * 60)),
          'pads-progress'
        );
      }

      await flushPendingBatchFiles();
      const padImportCompletedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (newPads.length === 0) {
        throw new Error('No valid pads found in bank file. The bank may be corrupted or empty.');
      }

      newBank.pads = newPads;
      let importedBankRef: SamplerBank = applyBankContentPolicy(newBank);
      if (replaceExistingBank) {
        const importedPadById = new Map<string, PadData>();
        const matchedImportedPadIds = new Set<string>();
        importedBankRef.pads.forEach((pad) => {
          importedPadById.set(pad.id, pad);
          if (typeof pad.originPadId === 'string' && pad.originPadId.trim().length > 0) {
            importedPadById.set(pad.originPadId, pad);
          }
        });

        const mergedPads = replaceExistingBank.pads.map((existingPad) => {
          if (existingPad.restoreAssetKind === 'default_asset') return existingPad;
          const importedPad =
            importedPadById.get(existingPad.id) ||
            (typeof existingPad.sourcePadId === 'string' ? importedPadById.get(existingPad.sourcePadId) : undefined) ||
            (typeof existingPad.originPadId === 'string' ? importedPadById.get(existingPad.originPadId) : undefined);
          if (!importedPad) return existingPad;
          matchedImportedPadIds.add(importedPad.id);
          if (existingPad.restoreAssetKind === 'custom_local_media') return existingPad;
          return {
            ...existingPad,
            audioUrl: importedPad.audioUrl || existingPad.audioUrl,
            audioStorageKey: importedPad.audioStorageKey ?? existingPad.audioStorageKey,
            audioBackend: importedPad.audioBackend ?? existingPad.audioBackend,
            imageUrl: importedPad.imageUrl || existingPad.imageUrl,
            imageStorageKey: importedPad.imageStorageKey ?? existingPad.imageStorageKey,
            imageBackend: importedPad.imageBackend ?? existingPad.imageBackend,
            hasImageAsset: importedPad.hasImageAsset ?? existingPad.hasImageAsset,
            audioBytes: importedPad.audioBytes ?? existingPad.audioBytes,
            audioDurationMs: importedPad.audioDurationMs ?? existingPad.audioDurationMs,
            contentOrigin: importedPad.contentOrigin ?? existingPad.contentOrigin,
            originBankId: importedPad.originBankId ?? existingPad.originBankId,
            originPadId: importedPad.originPadId ?? existingPad.originPadId,
            originCatalogItemId: importedPad.originCatalogItemId ?? existingPad.originCatalogItemId,
            originBankTitle: importedPad.originBankTitle ?? existingPad.originBankTitle,
            missingMediaExpected: false,
            missingImageExpected: false,
          };
        });
        const appendedImportedPads = importedBankRef.pads.filter((pad) => !matchedImportedPadIds.has(pad.id));

        importedBankRef = applyBankContentPolicy({
          ...replaceExistingBank,
          ...importedBankRef,
          id: replaceExistingBank.id,
          name: replaceExistingBank.name,
          defaultColor: replaceExistingBank.defaultColor,
          createdAt: replaceExistingBank.createdAt,
          sortOrder: replaceExistingBank.sortOrder,
          isLocalDuplicate: replaceExistingBank.isLocalDuplicate,
          duplicateOriginBankId: replaceExistingBank.duplicateOriginBankId,
          restoreKind: replaceExistingBank.restoreKind,
          restoreStatus: replaceExistingBank.restoreStatus,
          remoteSnapshotApplied: replaceExistingBank.remoteSnapshotApplied,
          pads: [...mergedPads, ...appendedImportedPads],
        });

        setBanks((prev) => prev.map((bank) => bank.id === replaceExistingBank.id ? importedBankRef : bank));
      } else {
        setBanks((prev) => {
          const deduped = dedupeBanksByIdentity([...prev, importedBankRef]);
          const replacementId = deduped.removedIdToKeptId.get(importedBankRef.id);
          if (replacementId) {
            const replacementBank = prev.find((bank) => bank.id === replacementId);
            if (replacementBank) importedBankRef = replacementBank;
          }
          return deduped.banks;
        });
      }
      reportImportStage('Finalizing imported bank...', 98, 'finalize');
      reportImportStage('Import complete.', 100, 'complete');
      const importCompletedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const zipStageMs = Math.max(0, zipStageCompletedAt - importStartedAt);
      const parseStageMs = Math.max(0, parseStageCompletedAt - zipStageCompletedAt);
      const padStageMs = Math.max(0, padImportCompletedAt - padImportStartedAt);
      const totalImportMs = Math.max(0, importCompletedAt - importStartedAt);
      const padThroughput = padStageMs > 0 ? ((totalPads / padStageMs) * 1000) : 0;
      operationDiagnostics.metrics.fileBytes = file.size;
      operationDiagnostics.metrics.totalPads = totalPads;
      operationDiagnostics.metrics.importedPads = newPads.length;
      operationDiagnostics.metrics.rejectedPads = importDiagnostics.rejectedPads;
      operationDiagnostics.metrics.audioBytes = importDiagnostics.audioBytes;
      operationDiagnostics.metrics.imageBytes = importDiagnostics.imageBytes;
      operationDiagnostics.metrics.zipStageMs = Math.round(zipStageMs);
      operationDiagnostics.metrics.parseStageMs = Math.round(parseStageMs);
      operationDiagnostics.metrics.padStageMs = Math.round(padStageMs);
      operationDiagnostics.metrics.totalImportMs = Math.round(totalImportMs);
      operationDiagnostics.metrics.padThroughputPerSec = Math.round(padThroughput * 100) / 100;
      finishOperationDiagnostics(operationDiagnostics, {
        bankName: importBankName,
        fileName: file.name,
        importedPads: newPads.length,
        rejectedPads: importDiagnostics.rejectedPads,
        totalImportMs: Math.round(totalImportMs),
      });
      if (!options?.skipActivityLog) {
        logImportActivity({
          status: 'success',
          bankName: importBankName,
          bankId: importedBankRef.sourceBankId || importedBankRef.id,
          padNames: importPadNames,
          includePadList
        });
      }
      return importedBankRef;

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown import error';
      reportImportStage(`Import failed: ${errorMessage}`, undefined, 'failed');
      failOperationDiagnostics(operationDiagnostics, e, {
        bankName: importBankName,
        fileName: file?.name || 'unknown.bank',
        progress: lastReportedProgress,
        stageId: lastReportedStageId,
      });
      if (!options?.skipActivityLog) {
        logImportActivity({
          status: 'failed',
          bankName: importBankName,
          padNames: importPadNames,
          includePadList,
          errorMessage
        });
      }

      // Map low-level import errors to user-facing messages.
      if (isFileAccessDeniedError(e) || errorMessage.toLowerCase().includes('cannot read the selected file')) {
        throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
      } else if (errorMessage.includes('timeout')) {
        throw new Error('Import timed out. The file may be too large or corrupted. Please try again.');
      } else if (errorMessage.toLowerCase().includes('secure context')) {
        throw new Error('Encrypted bank import requires HTTPS/localhost runtime. Open from https://localhost, localhost, or your production HTTPS domain.');
      } else if (errorMessage.includes('decrypt') || errorMessage.includes('encryption')) {
        throw new Error('Cannot decrypt bank file. Please ensure you have access to this bank and are signed in.');
      } else if (errorMessage.includes('Invalid bank')) {
        throw new Error('Invalid bank file format. Please ensure you selected a valid .bank file.');
      } else if (errorMessage.includes('Login required')) {
        throw new Error('Please sign in to import this bank file.');
      }

      throw new Error(`Import failed: ${errorMessage}`);
    } finally {
      await workerClient.dispose().catch(() => {});
      stopHeartbeat();
    }
};
