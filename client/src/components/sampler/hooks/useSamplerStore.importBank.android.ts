import type { BankMetadata, PadData, SamplerBank } from '../types/sampler';
import {
  derivePassword,
  getDerivedKey,
  parseBankIdFromFileName,
  resolveAdminBankMetadata,
} from '@/lib/bank-utils';
import { verifySignedAdminExportToken } from '@/lib/admin-export-token';
import { verifySignedEntitlementToken } from '@/lib/entitlement-token';
import { fetchStoreDownloadAccessMaterial } from '@/lib/store-download-access';
import { checkAdmission } from '@/lib/audio-engine/AudioAdmission';
import { applyBankContentPolicy } from './useSamplerStore.provenance';
import {
  addOperationStage,
  createAdHocOperationDiagnostics,
  failOperationDiagnostics,
  finishOperationDiagnostics,
  startOperationHeartbeat,
} from './useSamplerStore.operationDiagnostics';
import {
  cleanupNativeImportedAssets,
  isElectronImportBridgeAvailable,
  runNativeSharedImportJob,
  runNativeStoreImportJob,
  runElectronImportArchiveJob,
  type NativeBankImportProgressEvent,
  type NativeBankImportResult,
} from '@/lib/native-bank-import';
import {
  isNativeAndroidSharedImportSource,
  isNativeAndroidStoreImportSource,
  isNativeElectronStoreImportSource,
  type ImportBankSource,
} from './nativeBankImport.types';
import type { ImportBankOptions, ImportBankPipelineDeps } from './useSamplerStore.importBank';
import { getBankDuplicateSignature } from './useSamplerStore.importUtils';
import { createRecoverableDuplicateImportError } from './useSamplerStore.importErrors';

const SHARED_EXPORT_DISABLED_PASSWORD = 'vdjv-export-disabled-2024-secure';

const convertNativePathToUrl = (path?: string | null): string | null => {
  if (!path) return null;
  const capacitor = (window as any).Capacitor;
  const convertFileSrc = capacitor?.convertFileSrc;
  return typeof convertFileSrc === 'function' ? convertFileSrc(path) : path;
};

const getElectronFilePathFromImportSource = (source: ImportBankSource): string | null => {
  if (!(source instanceof File)) return null;
  const maybePath = (source as File & { path?: string }).path;
  return typeof maybePath === 'string' && maybePath.trim().length > 0 ? maybePath.trim() : null;
};

const parseNativeMetadata = (raw: string | null | undefined): BankMetadata | null => {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as BankMetadata;
  } catch {
    return null;
  }
};

const buildCandidateDerivedKeys = async (
  source: ImportBankSource,
  options: ImportBankOptions | undefined,
  deps: ImportBankPipelineDeps
): Promise<string[]> => {
  const { user, getCachedUser, profileRole } = deps;
  const values = new Set<string>([SHARED_EXPORT_DISABLED_PASSWORD]);
  const preferredDerivedKey = typeof options?.preferredDerivedKey === 'string'
    ? options.preferredDerivedKey.trim()
    : '';
  if (preferredDerivedKey) values.add(preferredDerivedKey);

  const effectiveUser = user || getCachedUser();
  const lastDerivedKeyStorageKey = effectiveUser ? `vdjv-last-import-derived-key-${effectiveUser.id}` : null;
  if (lastDerivedKeyStorageKey && typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(lastDerivedKeyStorageKey)?.trim();
      if (cached) values.add(cached);
    } catch {
    }
  }

  if (!effectiveUser) {
    return Array.from(values);
  }

  const hintedIds = new Set<string>();
  const preferredBankId = typeof options?.preferredBankId === 'string' ? options.preferredBankId.trim() : '';
  if (preferredBankId) hintedIds.add(preferredBankId);
  if (isNativeAndroidStoreImportSource(source)) {
    if (source.bankId?.trim()) hintedIds.add(source.bankId.trim());
    if (source.fileName?.trim()) {
      const parsed = parseBankIdFromFileName(source.fileName);
      if (parsed) hintedIds.add(parsed);
    }
  }
  if (isNativeElectronStoreImportSource(source)) {
    if (source.bankId?.trim()) hintedIds.add(source.bankId.trim());
    if (source.fileName?.trim()) {
      const parsed = parseBankIdFromFileName(source.fileName);
      if (parsed) hintedIds.add(parsed);
    }
  }
  if (isNativeAndroidSharedImportSource(source) && source.displayName?.trim()) {
    const parsed = parseBankIdFromFileName(source.displayName);
    if (parsed) hintedIds.add(parsed);
  }
  const electronFilePath = getElectronFilePathFromImportSource(source);
  if (electronFilePath && source instanceof File) {
    const parsed = parseBankIdFromFileName(source.name);
    if (parsed) hintedIds.add(parsed);
  }

  if (profileRole === 'admin') {
    for (const bankId of hintedIds) {
      try {
        const adminDerivedKey = await derivePassword(bankId);
        if (adminDerivedKey?.trim()) values.add(adminDerivedKey.trim());
      } catch {
      }
    }
  }

  for (const bankId of hintedIds) {
    try {
      const derivedKey = await getDerivedKey(bankId, effectiveUser.id);
      if (derivedKey?.trim()) values.add(derivedKey.trim());
    } catch {
    }
  }

  return Array.from(values);
};

export const runNativeAndroidImportPipeline = async (
  source: ImportBankSource,
  onProgress: ((progress: number) => void) | undefined,
  options: ImportBankOptions | undefined,
  deps: ImportBankPipelineDeps
): Promise<SamplerBank | null> => {
  const {
    user,
    getCachedUser,
    banks,
    banksRefCurrent,
    profileRole,
    quotaPolicy,
    emitImportStage,
    normalizeIdentityToken,
    countOwnedCountedBanks,
    generateId,
    sha256HexFromText,
    dedupeBanksByIdentity,
    setBanks,
    logImportActivity,
  } = deps;
  const electronFilePath = getElectronFilePathFromImportSource(source);
  const effectiveUser = user || getCachedUser();
  let importBankName = isNativeAndroidStoreImportSource(source)
    ? source.fileName || source.bankId || 'unknown.bank'
    : isNativeElectronStoreImportSource(source)
      ? source.fileName || source.bankId || 'unknown.bank'
      : isNativeAndroidSharedImportSource(source)
        ? source.displayName || 'unknown.bank'
        : (source instanceof File ? source.name || 'unknown.bank' : 'unknown.bank');
  let importPadNames: string[] = [];
  let includePadList = false;
  const importStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const operationDiagnostics = createAdHocOperationDiagnostics('bank_import', effectiveUser?.id || null);
  let lastReportedProgress = 0;
  let lastReportedStageId: string | null = null;
  let nativeCreatedStorageKeys: string[] = [];
  const stopHeartbeat = startOperationHeartbeat(operationDiagnostics, {
    getDetails: () => ({
      bankName: importBankName,
      fileName: importBankName,
      progress: lastReportedProgress,
      stageId: lastReportedStageId,
      fileBytes: 0,
    }),
  });
  const reportImportStage = (
    message: string,
    progress?: number,
    stageId?: string,
    debugDetails?: Record<string, unknown>
  ) => {
    emitImportStage(message, importStartedAt, progress, stageId);
    if (typeof progress === 'number') onProgress?.(progress);
    if (typeof progress === 'number') lastReportedProgress = progress;
    lastReportedStageId = stageId || null;
    addOperationStage(operationDiagnostics, stageId || 'stage', {
      message,
      progress,
      elapsedMs: Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - importStartedAt),
      ...debugDetails,
    });
  };
  const setLastDerivedKey = (derivedKey: string): void => {
    if (!effectiveUser || typeof window === 'undefined' || !derivedKey) return;
    try {
      localStorage.setItem(`vdjv-last-import-derived-key-${effectiveUser.id}`, derivedKey);
    } catch {
    }
  };

  try {
    reportImportStage('Checking bank file...', 5, 'validate-file');
    const candidateDerivedKeys = await buildCandidateDerivedKeys(source, options, deps);
    const handleNativeProgress = (event: NativeBankImportProgressEvent) => {
      reportImportStage(
        event.message || 'Importing bank...',
        typeof event.progress === 'number' ? event.progress : undefined,
        event.stage
      );
    };

    let nativeResult: NativeBankImportResult;
    if (isNativeAndroidStoreImportSource(source)) {
      nativeResult = await runNativeStoreImportJob({
        catalogItemId: source.catalogItemId,
        bankId: source.bankId,
        signedUrl: source.signedUrl,
        fileName: source.fileName,
        expectedSha256: source.expectedSha256,
        preferredDerivedKey: options?.preferredDerivedKey || null,
        candidateDerivedKeys,
        entitlementToken: options?.entitlementToken || null,
        userId: effectiveUser?.id || null,
      }, handleNativeProgress);
    } else if (isNativeElectronStoreImportSource(source)) {
      nativeResult = await runElectronImportArchiveJob({
        jobId: `electron-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        source: {
          kind: 'url',
          signedUrl: source.signedUrl,
          fileName: source.fileName,
          expectedSha256: source.expectedSha256,
        },
        preferredDerivedKey: options?.preferredDerivedKey || null,
        candidateDerivedKeys,
        entitlementToken: options?.entitlementToken || null,
        userId: effectiveUser?.id || null,
      }, handleNativeProgress);
    } else if (isNativeAndroidSharedImportSource(source)) {
      nativeResult = await runNativeSharedImportJob({
        uri: source.uri,
        displayName: source.displayName,
        size: source.size ?? null,
        preferredDerivedKey: options?.preferredDerivedKey || null,
        preferredBankId: options?.preferredBankId || null,
        candidateDerivedKeys,
        entitlementToken: options?.entitlementToken || null,
        userId: effectiveUser?.id || null,
      }, handleNativeProgress);
    } else if (electronFilePath && isElectronImportBridgeAvailable()) {
      nativeResult = await runElectronImportArchiveJob({
        jobId: `electron-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        source: {
          kind: 'file',
          filePath: electronFilePath,
          fileName: source.name,
          fileBytes: source.size,
        },
        preferredDerivedKey: options?.preferredDerivedKey || null,
        candidateDerivedKeys,
        entitlementToken: options?.entitlementToken || null,
        userId: effectiveUser?.id || null,
      }, handleNativeProgress);
    } else {
      throw new Error('Unsupported native import source.');
    }

    if (options?.preferredDerivedKey?.trim()) {
      setLastDerivedKey(options.preferredDerivedKey.trim());
    }

    nativeCreatedStorageKeys = nativeResult.thumbnailStorageKey ? [nativeResult.thumbnailStorageKey] : [];
    for (const pad of nativeResult.pads) {
      if (typeof pad.audioStorageKey === 'string' && pad.audioStorageKey) {
        nativeCreatedStorageKeys.push(pad.audioStorageKey);
      }
      if (typeof pad.imageStorageKey === 'string' && pad.imageStorageKey) {
        nativeCreatedStorageKeys.push(pad.imageStorageKey);
      }
    }

    importBankName = nativeResult.sourceFileName || importBankName;
    reportImportStage('Parsing bank content...', 23, 'bank-json-parse');
    const bankJsonText = nativeResult.bankJsonText;
    const bankData = JSON.parse(bankJsonText);
    if (!bankData || typeof bankData !== 'object' || !bankData.name || !Array.isArray(bankData.pads)) {
      throw new Error('Invalid bank file format: Missing required fields');
    }
    importBankName = bankData.name;
    const bankJsonSha256 = await sha256HexFromText(bankJsonText);
    (nativeResult as NativeBankImportResult & { bankJsonText?: string }).bankJsonText = '';
    const bankDataId =
      typeof bankData?.id === 'string' && bankData.id.trim().length > 0
        ? bankData.id.trim()
        : undefined;
    const importSignature = getBankDuplicateSignature(bankData);
    const sourcePads = Array.isArray(bankData.pads) ? bankData.pads : [];
    bankData.pads = [];
    const replaceExistingBankId = typeof options?.replaceExistingBankId === 'string'
      ? options.replaceExistingBankId.trim()
      : '';

    let metadata = parseNativeMetadata(nativeResult.metadataJsonText);
    (nativeResult as NativeBankImportResult & { metadataJsonText?: string | null }).metadataJsonText = null;
    if (metadata) {
      metadata = {
        ...metadata,
        password: metadata.password ?? false,
        transferable: metadata.transferable ?? true,
      };
    }
    const metadataBankId = metadata?.bankId || parseBankIdFromFileName(nativeResult.sourceFileName) || undefined;
    if (metadataBankId && !metadata?.bankId) {
      metadata = {
        ...(metadata || { password: false, transferable: true }),
        bankId: metadataBankId,
      };
    }

    if (nativeResult.thumbnailFilePath) {
      metadata = {
        ...(metadata || { password: false, transferable: true }),
        thumbnailUrl: nativeResult.thumbnailFileUrl || convertNativePathToUrl(nativeResult.thumbnailFilePath) || undefined,
        thumbnailStorageKey: nativeResult.thumbnailStorageKey || undefined,
        thumbnailBackend: 'native',
      };
    }

    includePadList = !(metadata?.password === true || !!metadataBankId);
    if (includePadList) {
      importPadNames = sourcePads.map((pad: any) => pad?.name || 'Untitled Pad');
    }
    const duplicateTokens = new Set<string>();
    const addDuplicateToken = (value: unknown) => {
      const normalized = normalizeIdentityToken(value);
      if (normalized) duplicateTokens.add(normalized);
    };
    addDuplicateToken(bankDataId);
    addDuplicateToken(metadataBankId);
    addDuplicateToken(importSignature);

    if (!options?.allowDuplicateImport && duplicateTokens.size > 0) {
      const duplicateBank = banksRefCurrent.find((bank) => {
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
          ...(metadata || { password: false, transferable: true }),
          bankId: metadataBankId,
          title: resolvedMetadata.title,
          description: resolvedMetadata.description,
          color: resolvedMetadata.color || metadata?.color,
        };
        importBankName = resolvedMetadata.title;
        if (resolvedMetadata.color) resolvedBankColor = resolvedMetadata.color;
      } else if (metadata?.color) {
        resolvedBankColor = metadata.color;
      }
    } else if (metadata?.color) {
      resolvedBankColor = metadata.color;
    }

    let hasVerifiedSignedAdminExportToken = false;
    const signedAdminExportToken = typeof metadata?.adminExportToken === 'string'
      ? metadata.adminExportToken.trim()
      : '';
    if (signedAdminExportToken) {
      const verification = await verifySignedAdminExportToken(signedAdminExportToken, bankJsonSha256);
      if (verification.valid) {
        hasVerifiedSignedAdminExportToken = true;
        metadata = {
          ...(metadata || { password: false, transferable: true }),
          trustedAdminExport: true,
          adminExportTokenBankSha256: bankJsonSha256,
          adminExportTokenKid: verification.payload?.kid || metadata?.adminExportTokenKid,
        };
        reportImportStage('Admin trust token verified.', 24, 'admin-token-verified');
      } else {
        reportImportStage('Admin trust token invalid. Using owned quota rules.', 24, 'admin-token-invalid');
      }
    }

    let hasVerifiedEntitlementToken = false;
    const signedEntitlementToken = (typeof options?.entitlementToken === 'string' && options.entitlementToken.trim())
      || (typeof metadata?.entitlementToken === 'string' && metadata.entitlementToken.trim())
      || '';
    let entitlementVerificationReason: string | null = null;
    const requiresSignedEntitlement = Boolean(
      isAdminBank &&
      metadataBankId &&
      (metadata?.catalogItemId || options?.preferredDerivedKey)
    );
    if (requiresSignedEntitlement && !signedEntitlementToken && metadata?.catalogItemId && effectiveUser?.id) {
      const accessMaterial = await fetchStoreDownloadAccessMaterial(metadata.catalogItemId).catch(() => null);
      if (accessMaterial?.entitlementToken) {
        metadata = {
          ...(metadata || { password: false, transferable: true }),
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
    const resolvedSignedEntitlementToken = (typeof options?.entitlementToken === 'string' && options.entitlementToken.trim())
      || (typeof metadata?.entitlementToken === 'string' && metadata.entitlementToken.trim())
      || '';
    if (requiresSignedEntitlement && !resolvedSignedEntitlementToken) {
      reportImportStage('Missing entitlement token. Import blocked.', 24, 'entitlement-token-missing', {
        reason: 'missing_token',
        tokenSource: typeof options?.entitlementToken === 'string' && options.entitlementToken.trim()
          ? 'option'
          : (typeof metadata?.entitlementToken === 'string' && metadata.entitlementToken.trim() ? 'metadata' : 'none'),
        hasCatalogItemId: Boolean(metadata?.catalogItemId),
        hasPreferredDerivedKey: Boolean(options?.preferredDerivedKey),
      });
      throw new Error('This bank requires a signed entitlement token. Please re-download it from Store.');
    }
    if (resolvedSignedEntitlementToken && effectiveUser?.id && metadataBankId) {
      const entitlementVerification = await verifySignedEntitlementToken({
        token: resolvedSignedEntitlementToken,
        expectedUserId: effectiveUser.id,
        expectedBankId: metadataBankId,
        expectedCatalogItemId: metadata?.catalogItemId || null,
      });
      if (entitlementVerification.valid) {
        hasVerifiedEntitlementToken = true;
        metadata = {
          ...(metadata || { password: false, transferable: true }),
          entitlementToken: resolvedSignedEntitlementToken,
          entitlementTokenKid: entitlementVerification.payload?.kid || metadata?.entitlementTokenKid,
          entitlementTokenVerified: true,
        };
        reportImportStage('Entitlement token verified.', 24, 'entitlement-token-verified');
      } else {
        entitlementVerificationReason = entitlementVerification.reason;
        reportImportStage('Entitlement token invalid. Import blocked.', 24, 'entitlement-token-invalid', {
          reason: entitlementVerification.reason,
          tokenSource: typeof options?.entitlementToken === 'string' && options.entitlementToken.trim()
            ? 'option'
            : (typeof metadata?.entitlementToken === 'string' && metadata.entitlementToken.trim() ? 'metadata' : 'unknown'),
          hasCatalogItemId: Boolean(metadata?.catalogItemId),
          expectedCatalogItemId: metadata?.catalogItemId || null,
        });
      }
    }

    if (isAdminBank && !effectiveUser) throw new Error('Login required');
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
    const currentBanks = banksRefCurrent;
    const replaceExistingBank = replaceExistingBankId
      ? currentBanks.find((bank) => bank.id === replaceExistingBankId) || null
      : null;
    if (profileRole !== 'admin') {
      if (currentBanks.length >= quotaPolicy.deviceTotalBankCap) {
        throw new Error(`LIMITED: You reached your device bank limit (${quotaPolicy.deviceTotalBankCap}). Remove a bank before importing another one.`);
      }
      if (!importedIsTrustedBank) {
        const ownedUsed = countOwnedCountedBanks(currentBanks);
        if (ownedUsed >= quotaPolicy.ownedBankQuota) {
          throw new Error(`LIMITED: You reached your owned bank quota (${quotaPolicy.ownedBankQuota}). Trusted Store/Admin imports are unlimited. Message us on facebook for expansion.`);
        }
        const incomingPadCount = sourcePads.length;
        if (incomingPadCount > quotaPolicy.ownedBankPadCap) {
          throw new Error(`Owned bank import blocked: ${incomingPadCount} pads found, max allowed is ${quotaPolicy.ownedBankPadCap}.`);
        }
      }
    }

    reportImportStage('Preparing pads for import...', 30, 'pads-start');
    const maxSortOrder = banks.length > 0 ? Math.max(...banks.map((bank) => bank.sortOrder || 0)) : -1;
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

    const padResultByIndex = new Map<number, NativeBankImportResult['pads'][number]>();
    for (const pad of nativeResult.pads) {
      padResultByIndex.set(pad.index, pad);
    }
    const newPads: PadData[] = [];
    const importDiagnostics = { audioBytes: 0, imageBytes: 0, rejectedPads: 0 };
    const totalPads = sourcePads.length;
    for (let index = 0; index < totalPads; index += 1) {
      const padData = sourcePads[index];
      const nativePad = padResultByIndex.get(index);
      if (!nativePad?.audioStorageKey || !nativePad.audioFilePath) {
        importDiagnostics.rejectedPads += 1;
        continue;
      }
      const inferredDurationMs =
        typeof padData?.endTimeMs === 'number' && Number.isFinite(padData.endTimeMs) && padData.endTimeMs > 0
          ? Math.round(padData.endTimeMs)
          : 0;
      const admissionMetadata = {
        audioBytes: Math.max(0, Number(nativePad.audioBytes || 0)),
        audioDurationMs: Math.max(0, Number(nativePad.audioDurationMs || inferredDurationMs || 0)),
      };
      const admission = checkAdmission(admissionMetadata);
      if (!admission.allowed) {
        importDiagnostics.rejectedPads += 1;
        continue;
      }
      const newPadId = generateId();
      const audioUrl = nativePad.audioFileUrl || convertNativePathToUrl(nativePad.audioFilePath);
      if (!audioUrl) {
        importDiagnostics.rejectedPads += 1;
        continue;
      }
      const imageUrl = nativePad.imageFileUrl || convertNativePathToUrl(nativePad.imageFilePath || null);
      newPads.push({
        ...padData,
        id: newPadId,
        audioUrl,
        imageUrl: imageUrl || undefined,
        audioStorageKey: nativePad.audioStorageKey,
        audioBackend: 'native',
        imageStorageKey: nativePad.imageStorageKey || undefined,
        imageBackend: nativePad.imageStorageKey ? 'native' : undefined,
        hasImageAsset: Boolean(nativePad.hasImageAsset && nativePad.imageStorageKey),
        imageData: undefined,
        shortcutKey: padData.shortcutKey || undefined,
        midiNote: typeof padData.midiNote === 'number' ? padData.midiNote : undefined,
        midiCC: typeof padData.midiCC === 'number' ? padData.midiCC : undefined,
        ignoreChannel: !!padData.ignoreChannel,
        fadeInMs: padData.fadeInMs || 0,
        fadeOutMs: padData.fadeOutMs || 0,
        startTimeMs: padData.startTimeMs || 0,
        endTimeMs: padData.endTimeMs || admissionMetadata.audioDurationMs || 0,
        pitch: padData.pitch || 0,
        tempoPercent: typeof padData.tempoPercent === 'number' ? padData.tempoPercent : 0,
        keyLock: padData.keyLock !== false,
        audioBytes: admissionMetadata.audioBytes,
        audioDurationMs: admissionMetadata.audioDurationMs > 0 ? admissionMetadata.audioDurationMs : undefined,
        savedHotcuesMs: Array.isArray(padData.savedHotcuesMs)
          ? (padData.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
          : [null, null, null, null],
        position: padData.position ?? index,
        contentOrigin: importedContentOrigin,
        originBankId: importedContentOrigin === 'user' ? undefined : (metadataBankId || bankDataId || undefined),
        originPadId: importedContentOrigin === 'user'
          ? (typeof padData.originPadId === 'string' ? padData.originPadId : undefined)
          : (typeof padData.originPadId === 'string' && padData.originPadId.trim().length > 0
            ? padData.originPadId
            : (typeof nativePad.sourcePadId === 'string' ? nativePad.sourcePadId : undefined)),
        originCatalogItemId:
          importedContentOrigin === 'official_store'
            ? (metadata?.catalogItemId || (typeof padData.originCatalogItemId === 'string' ? padData.originCatalogItemId : undefined))
            : undefined,
        originBankTitle:
          importedContentOrigin === 'user'
            ? (typeof padData.originBankTitle === 'string' ? padData.originBankTitle : undefined)
            : (metadata?.title || resolvedBankName || bankData.name || undefined),
      });
      importDiagnostics.audioBytes += admissionMetadata.audioBytes;
    }
    nativeResult.pads.length = 0;
    padResultByIndex.clear();
    sourcePads.length = 0;

    if (newPads.length === 0) {
      throw new Error('No valid pads found in bank file. The bank may be corrupted or empty.');
    }

    const importedPadCount = newPads.length;
    let importedBankRef: SamplerBank;
    if (replaceExistingBank) {
      const importedPadById = new Map<string, PadData>();
      const matchedImportedPadIds = new Set<string>();
      for (const pad of newPads) {
        importedPadById.set(pad.id, pad);
        if (typeof pad.originPadId === 'string' && pad.originPadId.trim().length > 0) {
          importedPadById.set(pad.originPadId, pad);
        }
      }
      const finalPads: PadData[] = [];
      for (const existingPad of replaceExistingBank.pads) {
        if (existingPad.restoreAssetKind === 'default_asset') {
          finalPads.push(existingPad);
          continue;
        }
        const importedPad =
          importedPadById.get(existingPad.id) ||
          (typeof existingPad.sourcePadId === 'string' ? importedPadById.get(existingPad.sourcePadId) : undefined) ||
          (typeof existingPad.originPadId === 'string' ? importedPadById.get(existingPad.originPadId) : undefined);
        if (!importedPad) {
          finalPads.push(existingPad);
          continue;
        }
        matchedImportedPadIds.add(importedPad.id);
        if (existingPad.restoreAssetKind === 'custom_local_media') {
          finalPads.push(existingPad);
          continue;
        }
        finalPads.push({
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
        });
      }
      for (const pad of newPads) {
        if (!matchedImportedPadIds.has(pad.id)) {
          finalPads.push(pad);
        }
      }
      importedBankRef = applyBankContentPolicy({
        ...replaceExistingBank,
        ...newBank,
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
        pads: finalPads,
      });
      newPads.length = 0;
      setBanks((prev) => prev.map((bank) => bank.id === replaceExistingBank.id ? importedBankRef : bank));
    } else {
      newBank.pads = newPads;
      importedBankRef = applyBankContentPolicy(newBank);
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
    const totalImportMs = Math.max(0, importCompletedAt - importStartedAt);
    operationDiagnostics.metrics.fileBytes = Number(nativeResult.sourceFileBytes || 0);
    operationDiagnostics.metrics.totalPads = totalPads;
    operationDiagnostics.metrics.importedPads = importedPadCount;
    operationDiagnostics.metrics.rejectedPads = importDiagnostics.rejectedPads;
    operationDiagnostics.metrics.audioBytes = importDiagnostics.audioBytes;
    operationDiagnostics.metrics.imageBytes = importDiagnostics.imageBytes;
    operationDiagnostics.metrics.totalImportMs = Math.round(totalImportMs);
    finishOperationDiagnostics(operationDiagnostics, {
      bankName: importBankName,
      fileName: nativeResult.sourceFileName,
      importedPads: importedPadCount,
      rejectedPads: importDiagnostics.rejectedPads,
      totalImportMs: Math.round(totalImportMs),
    });
    nativeCreatedStorageKeys = [];
    if (!options?.skipActivityLog) {
      logImportActivity({
        status: 'success',
        bankName: importBankName,
        bankId: importedBankRef.sourceBankId || importedBankRef.id,
        padNames: importPadNames,
        includePadList,
      });
    }
    return importedBankRef;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown import error';
    if (nativeCreatedStorageKeys.length > 0) {
      await cleanupNativeImportedAssets(nativeCreatedStorageKeys).catch(() => undefined);
      nativeCreatedStorageKeys = [];
    }
    reportImportStage(`Import failed: ${errorMessage}`, undefined, 'failed');
    failOperationDiagnostics(operationDiagnostics, error, {
      bankName: importBankName,
      fileName: importBankName,
      progress: lastReportedProgress,
      stageId: lastReportedStageId,
    });
    if (!options?.skipActivityLog) {
      logImportActivity({
        status: 'failed',
        bankName: importBankName,
        padNames: importPadNames,
        includePadList,
        errorMessage,
      });
    }
    throw new Error(`Import failed: ${errorMessage}`);
  } finally {
    stopHeartbeat();
  }
};
