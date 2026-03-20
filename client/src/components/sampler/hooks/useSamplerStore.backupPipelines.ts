import JSZip from 'jszip';
import type { PadData, SamplerBank } from '../types/sampler';
import { applyBankContentPolicy, isOfficialPadContent } from './useSamplerStore.provenance';
import {
  deriveSnapshotRestoreStatus,
  getSnapshotBankRestoreKind,
  getSnapshotPadRestoreKind,
} from './useSamplerStore.snapshotMetadata';
import {
  failOperationDiagnostics,
  finishOperationDiagnostics,
  startOperationHeartbeat,
  type OperationDiagnostics,
} from './useSamplerStore.operationDiagnostics';

type MediaBackend = 'native' | 'idb';

type OperationDiagnosticsLike = OperationDiagnostics;

type BackupPartManifestEntryLike = {
  index: number;
  fileName: string;
  size: number;
  offset: number;
};

type BackupArchiveManifestLike = {
  schema: string;
  manifestVersion: number;
  backupVersion: number;
  backupId: string;
  exportedAt: string;
  userId: string;
  encryptedSize: number;
  partSize: number;
  parts: BackupPartManifestEntryLike[];
};

type BackupStateShape = {
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
};

type SaveExportFileResult = {
  success: boolean;
  savedPath?: string;
  message?: string;
  error?: string;
};

type BackupManifestResolveResult = {
  encryptedBlob: Blob;
  resolvedParts: number;
  missingParts: string[];
};

type MediaReferenceSet = {
  audioDb: Set<string>;
  imageDb: Set<string>;
  nativeKeys: Set<string>;
};

type LogExportActivityInput = {
  status: 'success' | 'failed';
  phase: 'backup_export' | 'backup_restore';
  bankName: string;
  padNames: string[];
  exportOperationId?: string;
  errorMessage?: string;
  source?: string;
  meta?: Record<string, unknown>;
};

export interface RunBackupExportInput {
  payload: {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
    state: BackupStateShape;
  };
  options?: { riskMode?: boolean };
  banks: SamplerBank[];
  user: { id: string } | null;
}

export interface RunBackupExportDeps {
  getCachedUser: () => { id: string } | null;
  createOperationDiagnostics: (operation: 'app_backup_export', userId?: string | null) => OperationDiagnosticsLike;
  addOperationStage: (diagnostics: OperationDiagnosticsLike, stage: string, details?: Record<string, unknown>) => void;
  logExportActivity: (input: LogExportActivityInput) => void;
  ensureExportPermission: () => Promise<void>;
  estimateBankMediaBytes: (bank: SamplerBank) => Promise<number>;
  isNativeCapacitorPlatform: () => boolean;
  maxNativeAppBackupBytes: number;
  ensureStorageHeadroom: (requiredBytes: number, operationName: string) => Promise<void>;
  loadPadMediaBlob: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
  padHasExpectedImageAsset: (pad: Partial<PadData>) => boolean;
  yieldToMainThread: () => Promise<void>;
  derivePassword: (seed: string) => Promise<string>;
  encryptZip: (zip: JSZip, password: string) => Promise<Blob>;
  splitBlobIntoParts: (
    blob: Blob,
    partSize: number,
    backupId: string
  ) => Array<{ fileName: string; blob: Blob; index: number; offset: number }>;
  getBackupPartSizeBytes: () => number;
  buildBackupManifestName: (backupId: string) => string;
  backupVersion: number;
  backupManifestSchema: string;
  backupManifestVersion: number;
  backupPartExt: string;
  saveExportFile: (blob: Blob, fileName: string) => Promise<SaveExportFileResult>;
  writeOperationDiagnosticsLog: (diagnostics: OperationDiagnosticsLike, error: unknown) => Promise<string | null>;
}

export interface RunBackupRestoreInput {
  file: File;
  companionFiles?: File[];
  user: { id: string } | null;
  previousBanksSnapshot: SamplerBank[];
}

export interface RunBackupRestoreDeps {
  getCachedUser: () => { id: string } | null;
  createOperationDiagnostics: (operation: 'app_backup_restore', userId?: string | null) => OperationDiagnosticsLike;
  addOperationStage: (diagnostics: OperationDiagnosticsLike, stage: string, details?: Record<string, unknown>) => void;
  logExportActivity: (input: LogExportActivityInput) => void;
  ensureExportPermission: () => Promise<void>;
  tryParseBackupManifestFile: (file: File) => Promise<BackupArchiveManifestLike | null>;
  resolveManifestBackupBlob: (
    manifest: BackupArchiveManifestLike,
    manifestFile: File,
    companionFiles: File[],
    diagnostics?: OperationDiagnosticsLike
  ) => Promise<BackupManifestResolveResult>;
  backupPartExt: string;
  ensureStorageHeadroom: (requiredBytes: number, operationName: string) => Promise<void>;
  isFileAccessDeniedError: (error: unknown) => boolean;
  backupFileAccessDeniedMessage: string;
  derivePassword: (seed: string) => Promise<string>;
  decryptZip: (blob: Blob, password: string) => Promise<Blob>;
  backupVersion: number;
  isNativeCapacitorPlatform: () => boolean;
  maxNativeAppBackupBytes: number;
  yieldToMainThread: () => Promise<void>;
  storeFile: (
    padId: string,
    file: File,
    type: 'audio' | 'image',
    options?: { storageId?: string; nativeStorageKeyHint?: string }
  ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
  collectMediaReferenceSet: (banks: SamplerBank[]) => MediaReferenceSet;
  deletePadMediaArtifactsExcept: (pad: Partial<PadData> & { id: string }, keepRefs: MediaReferenceSet) => Promise<void>;
  setBanks: (banks: SamplerBank[]) => void;
  setPrimaryBankIdState: (value: string | null) => void;
  setSecondaryBankIdState: (value: string | null) => void;
  setCurrentBankIdState: (value: string | null) => void;
  writeOperationDiagnosticsLog: (diagnostics: OperationDiagnosticsLike, error: unknown) => Promise<string | null>;
}

export interface BackupRestoreResult {
  message: string;
  settings: Record<string, unknown> | null;
  mappings: Record<string, unknown> | null;
  state: BackupStateShape | null;
}

export const runBackupExportPipeline = async (
  input: RunBackupExportInput,
  deps: RunBackupExportDeps
): Promise<string> => {
  const { payload, options, banks, user } = input;
  const {
    getCachedUser,
    createOperationDiagnostics,
    addOperationStage,
    logExportActivity,
    ensureExportPermission,
    estimateBankMediaBytes,
    isNativeCapacitorPlatform,
    maxNativeAppBackupBytes,
    ensureStorageHeadroom,
    loadPadMediaBlob,
    padHasExpectedImageAsset,
    yieldToMainThread,
    derivePassword,
    encryptZip,
    splitBlobIntoParts,
    getBackupPartSizeBytes,
    buildBackupManifestName,
    backupVersion,
    backupManifestSchema,
    backupManifestVersion,
    backupPartExt,
    saveExportFile,
    writeOperationDiagnosticsLog,
  } = deps;

  const effectiveUser = user || getCachedUser();
  if (!effectiveUser?.id) {
    throw new Error('Please sign in before creating a backup.');
  }

  const riskMode = options?.riskMode === true;
  const diagnostics = createOperationDiagnostics('app_backup_export', effectiveUser.id);
  const stopHeartbeat = startOperationHeartbeat(diagnostics, {
    getDetails: () => ({
      bankCount: banks.length,
      riskMode,
    }),
  });
  addOperationStage(diagnostics, 'start', { bankCount: banks.length });
  logExportActivity({
    status: 'success',
    phase: 'backup_export',
    bankName: 'App Backup Export',
    padNames: [],
    exportOperationId: diagnostics.operationId,
    source: 'useSamplerStore.exportAppBackup',
    meta: {
      stage: 'start',
      bankCount: banks.length,
    },
  });
  try {
    await ensureExportPermission();

    let estimatedBytes = 0;
    for (const bank of banks) {
      estimatedBytes += await estimateBankMediaBytes(bank);
    }
    diagnostics.metrics.estimatedBytes = estimatedBytes;
    diagnostics.metrics.bankCount = banks.length;

    if (isNativeCapacitorPlatform() && estimatedBytes > maxNativeAppBackupBytes) {
      throw new Error(
        `Full backup is too large for reliable mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Use desktop full backup or export banks individually.`
      );
    }

    const requiredBytes = Math.ceil(Math.max(estimatedBytes, 1) * 0.45);
    addOperationStage(diagnostics, 'preflight', { estimatedBytes, requiredBytes, riskMode });
    logExportActivity({
      status: 'success',
      phase: 'backup_export',
      bankName: 'App Backup Export',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.exportAppBackup',
      meta: {
        stage: 'preflight',
        estimatedBytes,
        requiredBytes,
        riskMode,
      },
    });
    if (!riskMode) {
      await ensureStorageHeadroom(requiredBytes, 'backup export');
    } else {
      addOperationStage(diagnostics, 'preflight-skipped', { reason: 'risk-mode-enabled' });
    }

    const zip = new JSZip();
    const backupBanks: any[] = [];
    let totalMediaBytes = 0;
    let processedPads = 0;
    const totalPads = banks.reduce((sum, bank) => sum + bank.pads.length, 0);

    for (const bank of banks) {
      const bankClone: any = {
        ...bank,
        createdAt: bank.createdAt instanceof Date ? bank.createdAt.toISOString() : bank.createdAt,
        pads: [] as any[],
      };

      for (const pad of bank.pads) {
        const padClone: any = {
          ...pad,
          audioUrl: undefined,
          imageUrl: undefined,
          imageData: undefined,
          audioPath: null,
          imagePath: null,
          audioBackend: pad.audioBackend || (pad.audioStorageKey ? 'native' : 'idb'),
          imageBackend: pad.imageBackend || (pad.imageStorageKey ? 'native' : 'idb'),
        };

        const isOfficial = isOfficialPadContent(pad);
        const audioBlob = isOfficial ? null : await loadPadMediaBlob(pad, 'audio');
        if (audioBlob) {
          const audioPath = `media/audio/${bank.id}/${pad.id}.audio`;
          zip.file(audioPath, audioBlob);
          padClone.audioPath = audioPath;
          totalMediaBytes += audioBlob.size;
        }

        const imageBlob = !isOfficial && padHasExpectedImageAsset(pad) ? await loadPadMediaBlob(pad, 'image') : null;
        if (imageBlob) {
          const imagePath = `media/images/${bank.id}/${pad.id}.image`;
          zip.file(imagePath, imageBlob);
          padClone.imagePath = imagePath;
          totalMediaBytes += imageBlob.size;
        }

        if (isNativeCapacitorPlatform() && totalMediaBytes > maxNativeAppBackupBytes) {
          throw new Error('Backup exceeded reliable mobile size limit during packaging. Use desktop full backup or export banks individually.');
        }

        bankClone.pads.push(padClone);
        processedPads += 1;
        if (processedPads % 8 === 0) await yieldToMainThread();
      }

      backupBanks.push(bankClone);
    }

    diagnostics.metrics.processedBytes = totalMediaBytes;
    diagnostics.metrics.padCount = totalPads;
    logExportActivity({
      status: 'success',
      phase: 'backup_export',
      bankName: 'App Backup Export',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.exportAppBackup',
      meta: {
        stage: 'package-complete',
        totalMediaBytes,
        totalPads,
      },
    });

    zip.file(
      'backup.json',
      JSON.stringify(
        {
          version: backupVersion,
          exportedAt: new Date().toISOString(),
          userId: effectiveUser.id,
          manifest: {
            schema: 'vdjv-backup',
            mediaPolicy: 'hybrid-reference',
            hasBackendHints: true,
            restoreMode: 'hybrid-reference-current',
          },
          state: payload.state,
          settings: payload.settings,
          mappings: payload.mappings,
          banks: backupBanks,
        },
        null,
        2
      )
    );

    addOperationStage(diagnostics, 'encrypt');
    const backupPassword = await derivePassword(`backup-${effectiveUser.id}`);
    const encrypted = await encryptZip(zip, backupPassword);

    const backupId = new Date().toISOString().replace(/[:.]/g, '-');
    const partSizeBytes = getBackupPartSizeBytes();
    const splitParts = splitBlobIntoParts(encrypted, partSizeBytes, backupId);
    addOperationStage(diagnostics, 'split', {
      encryptedBytes: encrypted.size,
      partCount: splitParts.length,
      partSizeBytes,
    });
    logExportActivity({
      status: 'success',
      phase: 'backup_export',
      bankName: 'App Backup Export',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.exportAppBackup',
      meta: {
        stage: 'encrypted',
        encryptedBytes: encrypted.size,
        partCount: splitParts.length,
        partSizeBytes,
      },
    });

    if (splitParts.length <= 1) {
      const backupFileName = buildBackupManifestName(backupId);
      const saveResult = await saveExportFile(encrypted, backupFileName);
      if (!saveResult.success) {
        throw new Error(saveResult.message || 'Failed to save backup file.');
      }
      addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || backupFileName, mode: 'single-file' });
      finishOperationDiagnostics(diagnostics, {
        bankCount: banks.length,
        mode: 'single-file',
      });
      logExportActivity({
        status: 'success',
        phase: 'backup_export',
        bankName: 'App Backup Export',
        padNames: [],
        exportOperationId: diagnostics.operationId,
        source: 'useSamplerStore.exportAppBackup',
        meta: {
          stage: 'complete',
          mode: 'single-file',
          path: saveResult.savedPath || backupFileName,
        },
      });
      return saveResult.message || 'Backup exported successfully.';
    }

    for (const part of splitParts) {
      const partResult = await saveExportFile(part.blob, part.fileName);
      if (!partResult.success) {
        throw new Error(partResult.message || `Failed to save backup part ${part.fileName}.`);
      }
      addOperationStage(diagnostics, 'save-part', {
        fileName: part.fileName,
        size: part.blob.size,
        path: partResult.savedPath || part.fileName,
      });
      await yieldToMainThread();
    }

    const manifest: BackupArchiveManifestLike = {
      schema: backupManifestSchema,
      manifestVersion: backupManifestVersion,
      backupVersion,
      backupId,
      exportedAt: new Date().toISOString(),
      userId: effectiveUser.id,
      encryptedSize: encrypted.size,
      partSize: partSizeBytes,
      parts: splitParts.map((part) => ({
        index: part.index,
        fileName: part.fileName,
        size: part.blob.size,
        offset: part.offset,
      })),
    };

    const manifestName = buildBackupManifestName(backupId);
    const manifestResult = await saveExportFile(
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/octet-stream' }),
      manifestName
    );
    if (!manifestResult.success) {
      throw new Error(manifestResult.message || 'Failed to save backup manifest file.');
    }

    addOperationStage(diagnostics, 'saved', {
      path: manifestResult.savedPath || manifestName,
      mode: 'manifest+parts',
      partCount: splitParts.length,
    });
    finishOperationDiagnostics(diagnostics, {
      bankCount: banks.length,
      mode: 'manifest+parts',
      partCount: splitParts.length,
    });
    logExportActivity({
      status: 'success',
      phase: 'backup_export',
      bankName: 'App Backup Export',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.exportAppBackup',
      meta: {
        stage: 'complete',
        mode: 'manifest+parts',
        partCount: splitParts.length,
        path: manifestResult.savedPath || manifestName,
      },
    });
    return `Backup exported in ${splitParts.length} parts. Restore using "${manifestName}" with all "${backupPartExt}" files.`;
  } catch (error) {
    failOperationDiagnostics(diagnostics, error, {
      bankCount: banks.length,
      riskMode,
    });
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lastStage = diagnostics.stages[diagnostics.stages.length - 1]?.stage || 'unknown';
    logExportActivity({
      status: 'failed',
      phase: 'backup_export',
      bankName: 'App Backup Export',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      errorMessage,
      source: 'useSamplerStore.exportAppBackup',
      meta: {
        stage: lastStage,
      },
    });
    const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
    throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
  } finally {
    stopHeartbeat();
  }
};

export const runBackupRestorePipeline = async (
  input: RunBackupRestoreInput,
  deps: RunBackupRestoreDeps
): Promise<BackupRestoreResult> => {
  const { file, companionFiles = [], user, previousBanksSnapshot } = input;
  const {
    getCachedUser,
    createOperationDiagnostics,
    addOperationStage,
    logExportActivity,
    ensureExportPermission,
    tryParseBackupManifestFile,
    resolveManifestBackupBlob,
    backupPartExt,
    ensureStorageHeadroom,
    isFileAccessDeniedError,
    backupFileAccessDeniedMessage,
    derivePassword,
    decryptZip,
    backupVersion,
    isNativeCapacitorPlatform,
    maxNativeAppBackupBytes,
    yieldToMainThread,
    storeFile,
    collectMediaReferenceSet,
    deletePadMediaArtifactsExcept,
    setBanks,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    setCurrentBankIdState,
    writeOperationDiagnosticsLog,
  } = deps;

  const effectiveUser = user || getCachedUser();
  if (!effectiveUser?.id) {
    throw new Error('Please sign in before restoring a backup.');
  }

  const diagnostics = createOperationDiagnostics('app_backup_restore', effectiveUser.id);
  const stopHeartbeat = startOperationHeartbeat(diagnostics, {
    getDetails: () => ({
      inputBytes: file.size,
      companionFiles: companionFiles.length,
    }),
  });
  addOperationStage(diagnostics, 'start', {
    inputBytes: file.size,
    bankCount: previousBanksSnapshot.length,
    companionFiles: companionFiles.length,
  });
  logExportActivity({
    status: 'success',
    phase: 'backup_restore',
    bankName: 'App Backup Restore',
    padNames: [],
    exportOperationId: diagnostics.operationId,
    source: 'useSamplerStore.restoreAppBackup',
    meta: {
      stage: 'start',
      inputBytes: file.size,
      companionFiles: companionFiles.length,
    },
  });

  try {
    await ensureExportPermission();

    let encryptedInputBlob: Blob = file;
    let resolvedManifest: BackupArchiveManifestLike | null = null;
    const parsedManifest = await tryParseBackupManifestFile(file);
    if (parsedManifest) {
      if (parsedManifest.userId !== effectiveUser.id) {
        throw new Error('This backup manifest belongs to a different account.');
      }
      const resolved = await resolveManifestBackupBlob(parsedManifest, file, companionFiles, diagnostics);
      if (resolved.missingParts.length > 0) {
        const preview = resolved.missingParts.slice(0, 6).join(', ');
        const moreCount = Math.max(0, resolved.missingParts.length - 6);
        const moreSuffix = moreCount > 0 ? ` and ${moreCount} more` : '';
        throw new Error(
          `Missing backup part files: ${preview}${moreSuffix}. Select "${file.name}" together with all "${backupPartExt}" files.`
        );
      }
      encryptedInputBlob = resolved.encryptedBlob;
      resolvedManifest = parsedManifest;
      addOperationStage(diagnostics, 'manifest-resolved', {
        manifest: file.name,
        resolvedParts: resolved.resolvedParts,
        encryptedBytes: encryptedInputBlob.size,
      });
      logExportActivity({
        status: 'success',
        phase: 'backup_restore',
        bankName: 'App Backup Restore',
        padNames: [],
        exportOperationId: diagnostics.operationId,
        source: 'useSamplerStore.restoreAppBackup',
        meta: {
          stage: 'manifest-resolved',
          manifest: file.name,
          resolvedParts: resolved.resolvedParts,
          encryptedBytes: encryptedInputBlob.size,
        },
      });
    }

    await ensureStorageHeadroom(Math.ceil(encryptedInputBlob.size * 1.2), 'backup restore');

    try {
      await encryptedInputBlob.slice(0, 64).arrayBuffer();
    } catch (error) {
      if (isFileAccessDeniedError(error)) {
        throw new Error(backupFileAccessDeniedMessage);
      }
      throw error;
    }

    const backupPassword = await derivePassword(`backup-${effectiveUser.id}`);
    const decryptedZipBlob = await decryptZip(encryptedInputBlob, backupPassword);
    const zip = await new JSZip().loadAsync(await decryptedZipBlob.arrayBuffer());
    logExportActivity({
      status: 'success',
      phase: 'backup_restore',
      bankName: 'App Backup Restore',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.restoreAppBackup',
      meta: {
        stage: 'decrypt-complete',
        encryptedBytes: encryptedInputBlob.size,
      },
    });
    const backupJsonFile = zip.file('backup.json');
    if (!backupJsonFile) {
      throw new Error('Invalid backup: backup.json missing.');
    }

    const backupPayload = JSON.parse(await backupJsonFile.async('string'));
    if (!backupPayload || Number(backupPayload.version) !== backupVersion) {
      throw new Error(`This backup format is unsupported here. Expected backup version ${backupVersion}.`);
    }
    if (backupPayload.userId !== effectiveUser.id) {
      throw new Error('This backup was created from another account and cannot be restored here.');
    }
    const missingMediaEntries: string[] = [];
    const declaredMediaPaths = new Set<string>();
    let declaredMediaCount = 0;
    let declaredMediaBytes = 0;

    for (const bank of backupPayload.banks || []) {
      for (const pad of bank.pads || []) {
        if (!isOfficialPadContent(pad) && (!pad.audioPath || typeof pad.audioPath !== 'string')) {
          throw new Error(`Invalid backup payload: pad "${pad.id || 'unknown'}" is missing audioPath.`);
        }
        if (pad.audioPath && typeof pad.audioPath === 'string') {
          declaredMediaPaths.add(String(pad.audioPath));
          declaredMediaCount += 1;
        }
        if (pad.imagePath && typeof pad.imagePath === 'string') {
          declaredMediaPaths.add(String(pad.imagePath));
          declaredMediaCount += 1;
        }
      }
    }

    declaredMediaPaths.forEach((path) => {
      const entry = zip.file(path);
      if (!entry) {
        missingMediaEntries.push(path);
        return;
      }
      const expectedBytes = Number((entry as any)?._data?.uncompressedSize || 0);
      if (Number.isFinite(expectedBytes) && expectedBytes > 0) {
        declaredMediaBytes += expectedBytes;
      }
    });

    if (missingMediaEntries.length > 0) {
      const preview = missingMediaEntries.slice(0, 6).join(', ');
      const moreCount = Math.max(0, missingMediaEntries.length - 6);
      const moreSuffix = moreCount > 0 ? ` and ${moreCount} more` : '';
      throw new Error(`Backup is missing media entries: ${preview}${moreSuffix}.`);
    }

    if (isNativeCapacitorPlatform() && declaredMediaBytes > maxNativeAppBackupBytes) {
      throw new Error(
        `Backup media payload is too large for reliable mobile restore (${Math.ceil(declaredMediaBytes / (1024 * 1024))}MB).`
      );
    }
    addOperationStage(diagnostics, 'media-preflight', {
      declaredMediaCount,
      declaredMediaBytes,
    });
    logExportActivity({
      status: 'success',
      phase: 'backup_restore',
      bankName: 'App Backup Restore',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.restoreAppBackup',
      meta: {
        stage: 'media-preflight',
        declaredMediaCount,
        declaredMediaBytes,
      },
    });

    const restoredBanks: SamplerBank[] = [];
    let restoredMediaBytes = 0;
    const restoreSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let restoredPadCount = 0;
    let officialReferencePadsNeedingRepair = 0;

    for (const bank of backupPayload.banks || []) {
      const restoredPads: PadData[] = [];
      for (let padIndex = 0; padIndex < (bank.pads || []).length; padIndex += 1) {
        const pad = (bank.pads || [])[padIndex];
        let audioUrl = '';
        let imageUrl: string | undefined;
        let audioStorageKey: string | undefined;
        let imageStorageKey: string | undefined;
        let audioBackend: MediaBackend = (pad.audioBackend as MediaBackend | undefined) || (pad.audioStorageKey ? 'native' : 'idb');
        let imageBackend: MediaBackend | undefined = (pad.imageBackend as MediaBackend | undefined) || (pad.imageStorageKey ? 'native' : undefined);
        let hasImageAsset = Boolean(pad.hasImageAsset || pad.imagePath || pad.imageStorageKey || pad.imageData);

        if (pad.audioPath) {
          const audioFile = zip.file(String(pad.audioPath));
          if (audioFile) {
            const audioBlob = await audioFile.async('blob');
            const audioStorageId = `restore_${restoreSessionId}_audio_${bank.id}_${pad.id || padIndex}`;
            const storedAudio = await storeFile(
              pad.id,
              new File([audioBlob], `${pad.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
              'audio',
              {
                storageId: audioStorageId,
                nativeStorageKeyHint: `restore/${restoreSessionId}/audio/${bank.id}-${pad.id || padIndex}`,
              }
            );
            audioStorageKey = storedAudio.storageKey;
            audioBackend = storedAudio.backend;
            audioUrl = URL.createObjectURL(audioBlob);
            restoredMediaBytes += audioBlob.size;
          }
        }

        if (isOfficialPadContent(pad) && !audioUrl) {
          officialReferencePadsNeedingRepair += 1;
        }

        if (pad.imagePath) {
          const imageFile = zip.file(String(pad.imagePath));
          if (imageFile) {
            const imageBlob = await imageFile.async('blob');
            const imageStorageId = `restore_${restoreSessionId}_image_${bank.id}_${pad.id || padIndex}`;
            const storedImage = await storeFile(
              pad.id,
              new File([imageBlob], `${pad.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
              'image',
              {
                storageId: imageStorageId,
                nativeStorageKeyHint: `restore/${restoreSessionId}/image/${bank.id}-${pad.id || padIndex}`,
              }
            );
            imageStorageKey = storedImage.storageKey;
            imageBackend = storedImage.backend;
            imageUrl = URL.createObjectURL(imageBlob);
            hasImageAsset = true;
            restoredMediaBytes += imageBlob.size;
          }
        }

        restoredPads.push({
          ...pad,
          audioUrl,
          imageUrl,
          audioStorageKey,
          audioBackend,
          imageStorageKey,
          imageBackend,
          hasImageAsset,
          imageData: undefined,
          savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
            ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
            : [null, null, null, null],
        } as PadData);

        restoredPadCount += 1;
        if (restoredPadCount % 6 === 0) await yieldToMainThread();
      }

      const restoredBankBase = applyBankContentPolicy({
        ...bank,
        createdAt: new Date(bank.createdAt || Date.now()),
        pads: restoredPads,
      } as SamplerBank);
      const restoreKind = getSnapshotBankRestoreKind(restoredBankBase);
      const normalizedPads = restoredBankBase.pads.map((pad) => {
        const restoreAssetKind = pad.restoreAssetKind || getSnapshotPadRestoreKind(restoredBankBase, pad);
        const expectsCustomImage = restoreAssetKind === 'custom_local_media' && Boolean(
          pad.hasImageAsset ||
          pad.imageStorageKey ||
          pad.imageBackend ||
          (typeof pad.imageUrl === 'string' && pad.imageUrl.trim().length > 0)
        );
        return {
          ...pad,
          restoreAssetKind,
          missingMediaExpected: !pad.audioUrl,
          missingImageExpected: !pad.imageUrl && expectsCustomImage,
        };
      });
      restoredBanks.push({
        ...restoredBankBase,
        restoreKind,
        pads: normalizedPads,
        restoreStatus: deriveSnapshotRestoreStatus({
          ...restoredBankBase,
          restoreKind,
          pads: normalizedPads,
        }),
      });
    }

    diagnostics.metrics.processedBytes = restoredMediaBytes;
    diagnostics.metrics.restoredBanks = restoredBanks.length;
    diagnostics.metrics.restoredPads = restoredPadCount;

    const keepRefs = collectMediaReferenceSet(restoredBanks);
    addOperationStage(diagnostics, 'cleanup-old-media', {
      previousBanks: previousBanksSnapshot.length,
      keepAudioDbRefs: keepRefs.audioDb.size,
      keepImageDbRefs: keepRefs.imageDb.size,
      keepNativeRefs: keepRefs.nativeKeys.size,
    });
    for (const bank of previousBanksSnapshot) {
      for (const pad of bank.pads) {
        await deletePadMediaArtifactsExcept(pad, keepRefs);
        if (pad.audioUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(pad.audioUrl);
        }
        if (pad.imageUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(pad.imageUrl);
        }
      }
    }

    setBanks(restoredBanks);

    const restoredState = backupPayload.state || null;
    if (restoredState) {
      const bankIds = new Set(restoredBanks.map((b) => b.id));
      setPrimaryBankIdState(bankIds.has(restoredState.primaryBankId) ? restoredState.primaryBankId : null);
      setSecondaryBankIdState(bankIds.has(restoredState.secondaryBankId) ? restoredState.secondaryBankId : null);
      if (bankIds.has(restoredState.currentBankId)) {
        setCurrentBankIdState(restoredState.currentBankId);
      } else {
        setCurrentBankIdState(restoredBanks[0]?.id || null);
      }
    } else {
      setPrimaryBankIdState(null);
      setSecondaryBankIdState(null);
      setCurrentBankIdState(restoredBanks[0]?.id || null);
    }

    addOperationStage(diagnostics, 'complete', { restoredBanks: restoredBanks.length });
    finishOperationDiagnostics(diagnostics, {
      restoredBanks: restoredBanks.length,
      restoredPads: restoredPadCount,
      restoredMediaBytes,
    });
    logExportActivity({
      status: 'success',
      phase: 'backup_restore',
      bankName: 'App Backup Restore',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      source: 'useSamplerStore.restoreAppBackup',
      meta: {
        stage: 'complete',
        restoredBanks: restoredBanks.length,
        restoredPads: restoredPadCount,
        restoredMediaBytes,
      },
    });
    return {
      message: resolvedManifest
        ? `Backup restored: ${restoredBanks.length} bank(s) from ${resolvedManifest.parts.length} part file(s).${officialReferencePadsNeedingRepair > 0 ? ` ${officialReferencePadsNeedingRepair} official pad(s) still need Store repair.` : ''}`
        : `Backup restored: ${restoredBanks.length} bank(s).${officialReferencePadsNeedingRepair > 0 ? ` ${officialReferencePadsNeedingRepair} official pad(s) still need Store repair.` : ''}`,
      settings: (backupPayload.settings || null) as Record<string, unknown> | null,
      mappings: (backupPayload.mappings || null) as Record<string, unknown> | null,
      state: (backupPayload.state || null) as BackupStateShape | null,
    };
  } catch (error) {
    const normalizedError = isFileAccessDeniedError(error)
      ? new Error(backupFileAccessDeniedMessage)
      : error;
    const errorMessage = normalizedError instanceof Error ? normalizedError.message : String(normalizedError);
    failOperationDiagnostics(diagnostics, normalizedError, {
      inputBytes: file.size,
      companionFiles: companionFiles.length,
    });
    const lastStage = diagnostics.stages[diagnostics.stages.length - 1]?.stage || 'unknown';
    logExportActivity({
      status: 'failed',
      phase: 'backup_restore',
      bankName: 'App Backup Restore',
      padNames: [],
      exportOperationId: diagnostics.operationId,
      errorMessage,
      source: 'useSamplerStore.restoreAppBackup',
      meta: {
        stage: lastStage,
      },
    });
    const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
    throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
  } finally {
    stopHeartbeat();
  }
};
