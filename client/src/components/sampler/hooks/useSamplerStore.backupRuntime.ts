import {
  assembleBackupPartsBlob,
  parseBackupManifestFile,
  type BackupArchiveManifest,
} from './useSamplerStore.backupManifest';
import {
  ensureExportPermissionPipeline,
  readNativeExportBackupFileByNamePipeline,
  saveExportFilePipeline,
  writeOperationDiagnosticsLogPipeline,
} from './useSamplerStore.backupIO';
import {
  addOperationStage,
  createOperationDiagnostics as createOperationDiagnosticsRecord,
  sanitizeOperationError,
  type OperationDiagnostics,
  type OperationName,
} from './useSamplerStore.operationDiagnostics';

type CreateSamplerBackupRuntimeHelpersInput = {
  isNativeCapacitorPlatform: () => boolean;
  isNativeAndroid: () => boolean;
  exportFolderName: string;
  androidDownloadRoot: string;
  exportLogsFolder: string;
  capacitorExportSingleWriteBytes: number;
  capacitorExportChunkBytes: number;
  backupExt: string;
  backupPartExt: string;
  backupManifestSchema: string;
  backupPartSizeMobileBytes: number;
  backupPartSizeDesktopBytes: number;
  maxBackupPartCount: number;
  blobToBase64: (blob: Blob) => Promise<string>;
  normalizeBase64Data: (input: string) => string;
};

const normalizeFolderPath = (path: string): string => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const getRuntimePlatformLabel = (
  isNativeCapacitorPlatform: () => boolean,
  isNativeAndroid: () => boolean
): string => {
  if (typeof window === 'undefined') return 'unknown';
  if (isNativeCapacitorPlatform()) return isNativeAndroid() ? 'capacitor-android' : 'capacitor-ios';
  if (window.navigator.userAgent.includes('Electron')) return 'electron';
  return 'web';
};

const isMobileBrowserRuntime = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
};

const buildBackupBaseName = (backupId: string): string => `vdjv-full-backup-${backupId}`;

export const createSamplerBackupRuntimeHelpers = (input: CreateSamplerBackupRuntimeHelpersInput) => {
  const getBackupPartSizeBytes = (): number => {
    if (input.isNativeCapacitorPlatform()) {
      return input.backupPartSizeMobileBytes;
    }
    if (isMobileBrowserRuntime()) {
      return 1024 * 1024 * 1024;
    }
    return input.backupPartSizeDesktopBytes;
  };

  const buildBackupManifestName = (backupId: string): string => `${buildBackupBaseName(backupId)}${input.backupExt}`;

  const splitBlobIntoParts = (
    blob: Blob,
    partSize: number,
    backupId: string
  ): Array<{ fileName: string; blob: Blob; index: number; offset: number }> => {
    const safePartSize = Math.max(1, partSize);
    const totalParts = Math.max(1, Math.ceil(blob.size / safePartSize));
    if (totalParts > input.maxBackupPartCount) {
      throw new Error(
        `Backup requires ${totalParts} parts, exceeding supported limit (${input.maxBackupPartCount}). Reduce library size and try again.`
      );
    }
    const padWidth = Math.max(3, String(totalParts).length);
    const parts: Array<{ fileName: string; blob: Blob; index: number; offset: number }> = [];

    for (let index = 0; index < totalParts; index += 1) {
      const offset = index * safePartSize;
      const partBlob = blob.slice(offset, Math.min(blob.size, offset + safePartSize));
      const fileName = `${buildBackupBaseName(backupId)}.part-${String(index + 1).padStart(padWidth, '0')}${input.backupPartExt}`;
      parts.push({ fileName, blob: partBlob, index, offset });
    }

    return parts;
  };

  const tryParseBackupManifestFile = async (file: File): Promise<BackupArchiveManifest | null> =>
    parseBackupManifestFile(file, input.backupManifestSchema);

  const readNativeExportBackupFileByName = async (fileName: string): Promise<File | null> => {
    return readNativeExportBackupFileByNamePipeline(fileName, {
      isNativeCapacitorPlatform: input.isNativeCapacitorPlatform,
      isNativeAndroid: input.isNativeAndroid,
      normalizeBase64Data: input.normalizeBase64Data,
      androidDownloadRoot: input.androidDownloadRoot,
      exportFolderName: input.exportFolderName,
    });
  };

  const resolveManifestBackupBlob = async (
    manifest: BackupArchiveManifest,
    manifestFile: File,
    companionFiles: File[],
    diagnostics?: OperationDiagnostics
  ): Promise<{ encryptedBlob: Blob; resolvedParts: number; missingParts: string[] }> => {
    const assembled = await assembleBackupPartsBlob({
      manifest,
      manifestFile,
      companionFiles,
      maxBackupPartCount: input.maxBackupPartCount,
      readNativeBackupPartByName: readNativeExportBackupFileByName,
    });

    if (diagnostics) {
      addOperationStage(diagnostics, 'resolve-backup-parts', {
        manifest: manifestFile.name,
        expectedParts: assembled.expectedParts,
        resolvedParts: assembled.resolvedParts,
      });
    }

    return {
      encryptedBlob: assembled.encryptedBlob,
      resolvedParts: assembled.resolvedParts,
      missingParts: assembled.missingParts,
    };
  };

  const createOperationDiagnostics = (operation: OperationName, userId?: string | null): OperationDiagnostics =>
    createOperationDiagnosticsRecord(operation, userId, {
      platform: getRuntimePlatformLabel(input.isNativeCapacitorPlatform, input.isNativeAndroid),
      isCapacitorNative: input.isNativeCapacitorPlatform(),
      isElectron: typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron'),
    });

  const ensureExportPermission = async (): Promise<void> =>
    ensureExportPermissionPipeline({ isNativeAndroid: input.isNativeAndroid });

  const saveExportFile = async (
    blob: Blob,
    fileName: string,
    relativeFolder: string = input.exportFolderName
  ): Promise<{ success: boolean; message?: string; savedPath?: string }> => {
    return saveExportFilePipeline(blob, fileName, relativeFolder, {
      normalizeFolderPath,
      isNativeCapacitorPlatform: input.isNativeCapacitorPlatform,
      isNativeAndroid: input.isNativeAndroid,
      isMobileBrowserRuntime,
      ensureExportPermission,
      blobToBase64: input.blobToBase64,
      androidDownloadRoot: input.androidDownloadRoot,
      capacitorExportSingleWriteBytes: input.capacitorExportSingleWriteBytes,
      capacitorExportChunkBytes: input.capacitorExportChunkBytes,
      exportFolderName: input.exportFolderName,
    });
  };

  const writeOperationDiagnosticsLog = async (
    diagnostics: OperationDiagnostics,
    error: unknown
  ): Promise<string | null> => {
    return writeOperationDiagnosticsLogPipeline(diagnostics, error, {
      sanitizeOperationError,
      saveExportFile,
      exportLogsFolder: input.exportLogsFolder,
    });
  };

  const emitImportStage = (
    message: string,
    startedAt: number,
    progress?: number,
    stageId?: string
  ): void => {
    if (typeof window === 'undefined') return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    window.dispatchEvent(
      new CustomEvent('vdjv-import-stage', {
        detail: {
          message,
          elapsedMs: Math.max(0, now - startedAt),
          progress,
          stageId: stageId || null,
        },
      })
    );
  };

  return {
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
  };
};

