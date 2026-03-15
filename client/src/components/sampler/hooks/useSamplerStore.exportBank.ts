import JSZip from 'jszip';
import type { SamplerBank } from '../types/sampler';
import { getExportRestrictionReason } from './useSamplerStore.provenance';
import { stripPreparedAudioForExport } from './preparedAudio';

type SamplerPad = SamplerBank['pads'][number];

type ExportActivityPhase =
  | 'requested'
  | 'local_export'
  | 'remote_upload'
  | 'backup_export'
  | 'backup_restore'
  | 'media_recovery';

type ExportUploadMeta = {
  releaseTag?: string | null;
  assetName?: string | null;
  attempt?: number;
  result?: 'success' | 'failed' | 'duplicate_no_change';
  reason?: string | null;
  verified?: boolean;
  fileSize?: number;
  fileSha256?: string | null;
  duplicateOfExportOperationId?: string | null;
};

type ExportDiagnosticsLike = {
  operationId: string;
  metrics: Record<string, number>;
};

type SaveExportFileResult = {
  success: boolean;
  savedPath?: string;
  message?: string;
  error?: string;
};

type UserExportUploadQueueInput = {
  exportOperationId: string;
  userId: string;
  bankId: string;
  bankName: string;
  fileName: string;
  fileSize: number;
  fileSha256: string | null;
  padNames: string[];
  blob: Blob;
};

type TrimAudioResult = {
  blob: Blob;
  newDurationMs: number;
};

interface ImportableUser {
  id: string;
  email?: string | null;
}

export interface RunExportBankInput {
  id: string;
  onProgress?: (progress: number) => void;
  banks: SamplerBank[];
  user: ImportableUser | null;
  profileRole?: string | null;
}

export interface RunExportBankDeps {
  getCachedUser: () => ImportableUser | null;
  generateOperationId: () => string;
  createOperationDiagnostics: (operation: 'bank_export', userId?: string | null) => ExportDiagnosticsLike;
  addOperationStage: (diagnostics: ExportDiagnosticsLike, stage: string, details?: Record<string, unknown>) => void;
  getNowMs: () => number;
  logExportActivity: (input: {
    status: 'success' | 'failed';
    phase: ExportActivityPhase;
    bankName: string;
    bankId?: string;
    padNames: string[];
    exportOperationId?: string;
    upload?: ExportUploadMeta;
    timing?: Record<string, number>;
    errorMessage?: string;
    source?: string;
    meta?: Record<string, unknown>;
  }) => void;
  ensureExportPermission: () => Promise<void>;
  estimateBankMediaBytes: (bank: SamplerBank) => Promise<number>;
  isNativeCapacitorPlatform: () => boolean;
  maxNativeBankExportBytes: number;
  ensureStorageHeadroom: (requiredBytes: number, operationName: string) => Promise<void>;
  padHasExpectedImageAsset: (pad: Partial<SamplerPad>) => boolean;
  loadPadMediaBlob: (pad: SamplerPad, type: 'audio' | 'image') => Promise<Blob | null>;
  shouldAttemptTrim: (pad: SamplerPad, mode: 'fast' | 'compact') => boolean;
  trimAudio: (
    source: Blob,
    startTimeMs?: number,
    endTimeMs?: number,
    formatHint?: string
  ) => Promise<TrimAudioResult>;
  detectAudioFormat: (blob: Blob) => string;
  sha256HexFromBlob: (blob: Blob) => Promise<string>;
  yieldToMainThread: () => Promise<void>;
  saveExportFile: (blob: Blob, fileName: string) => Promise<SaveExportFileResult>;
  enqueueUserExportUpload: (input: UserExportUploadQueueInput) => void;
  processUserExportUploadQueue: () => Promise<void>;
  writeOperationDiagnosticsLog: (diagnostics: ExportDiagnosticsLike, error: unknown) => Promise<string | null>;
}

export const runExportBankPipeline = async (
  input: RunExportBankInput,
  deps: RunExportBankDeps
): Promise<string> => {
  const {
    id,
    onProgress,
    banks,
    user,
    profileRole,
  } = input;
  const {
    getCachedUser,
    generateOperationId,
    createOperationDiagnostics,
    addOperationStage,
    getNowMs,
    logExportActivity,
    ensureExportPermission,
    estimateBankMediaBytes,
    isNativeCapacitorPlatform,
    maxNativeBankExportBytes,
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
  } = deps;

  const bank = banks.find((b) => b.id === id);
  if (!bank) throw new Error('We could not find that bank.');
  const exportRestrictionReason = getExportRestrictionReason(bank);
  if (exportRestrictionReason === 'official_bank') {
    throw new Error('Export is disabled for official Store/Admin banks.');
  }
  if (exportRestrictionReason === 'mixed_official') {
    throw new Error('Export is disabled because this bank contains official Store/Admin pads. Use Backup for personal recovery instead.');
  }

  const effectiveUser = user || getCachedUser();
  const exportOperationId = generateOperationId();
  const exportPadNames = bank.pads.map((pad) => pad.name || 'Untitled Pad');
  const diagnostics = createOperationDiagnostics('bank_export', effectiveUser?.id || null);
  addOperationStage(diagnostics, 'start', { bankId: bank.id, bankName: bank.name, padCount: bank.pads.length });
  const exportStartedAt = getNowMs();
  let preflightCompletedAt = exportStartedAt;
  let mediaCompletedAt = exportStartedAt;
  let archiveCompletedAt = exportStartedAt;
  let saveCompletedAt = exportStartedAt;
  let exportedArchiveBytes = 0;

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Internet connection is required to export right now. Please reconnect and try again.');
    }

    logExportActivity({
      status: 'success',
      phase: 'requested',
      bankName: bank.name,
      bankId: bank.id,
      padNames: exportPadNames,
      exportOperationId,
    });

    onProgress?.(5);
    await ensureExportPermission();

    const estimatedBytes = await estimateBankMediaBytes(bank);
    diagnostics.metrics.estimatedBytes = estimatedBytes;
    addOperationStage(diagnostics, 'preflight', { estimatedBytes });

    if (isNativeCapacitorPlatform() && estimatedBytes > maxNativeBankExportBytes) {
      throw new Error(
        `Bank export is too large for mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Reduce bank size and try again.`
      );
    }

    await ensureStorageHeadroom(Math.ceil(estimatedBytes * 0.35), 'bank export');
    preflightCompletedAt = getNowMs();

    const zip = new JSZip();
    const audioFolder = zip.folder('audio');
    const imageFolder = zip.folder('images');
    if (!audioFolder || !imageFolder) throw new Error('Could not prepare files for export.');

    const totalMediaItems = Math.max(
      1,
      bank.pads.reduce((count, pad) => count + (pad.audioUrl ? 1 : 0) + (padHasExpectedImageAsset(pad) ? 1 : 0), 0)
    );
    let processedItems = 0;
    let exportedAudio = 0;
    let exportedImages = 0;
    let totalExportBytes = 0;
    let uniqueExportBytes = 0;
    let dedupedAudioReuses = 0;
    let dedupedImageReuses = 0;
    const audioHashToPath = new Map<string, string>();
    const imageHashToPath = new Map<string, string>();

    const exportPads = bank.pads.map((pad) => ({
      ...stripPreparedAudioForExport(pad),
      audioUrl: undefined as string | undefined,
      imageUrl: undefined as string | undefined,
    }));
    const exportPadMap = new Map(exportPads.map((pad) => [pad.id, pad]));

    for (const pad of bank.pads) {
      if (pad.audioUrl) {
        const exportPad = exportPadMap.get(pad.id);
        const sourceBlob = await loadPadMediaBlob(pad, 'audio');
        if (sourceBlob) {
          let audioBlob = sourceBlob;
          if (shouldAttemptTrim(pad, 'fast')) {
            try {
              const trimResult = await trimAudio(sourceBlob, pad.startTimeMs, pad.endTimeMs, detectAudioFormat(sourceBlob));
              audioBlob = trimResult.blob;
              if (exportPad) {
                exportPad.startTimeMs = 0;
                exportPad.endTimeMs = trimResult.newDurationMs;
              }
              addOperationStage(diagnostics, 'audio-trimmed', {
                padId: pad.id,
                padName: pad.name || 'Untitled Pad',
                originalBytes: sourceBlob.size,
                trimmedBytes: audioBlob.size,
              });
            } catch (trimError) {
              addOperationStage(diagnostics, 'audio-trim-fallback', {
                padId: pad.id,
                padName: pad.name || 'Untitled Pad',
                reason: trimError instanceof Error ? trimError.message : String(trimError),
              });
            }
          }
          const audioHash = await sha256HexFromBlob(audioBlob);
          const existingAudioPath = audioHashToPath.get(audioHash);
          if (existingAudioPath) {
            dedupedAudioReuses += 1;
            if (exportPad) exportPad.audioUrl = existingAudioPath;
          } else {
            const fileName = `${audioHash}.audio`;
            audioFolder.file(fileName, audioBlob);
            const path = `audio/${fileName}`;
            audioHashToPath.set(audioHash, path);
            if (exportPad) exportPad.audioUrl = path;
            uniqueExportBytes += audioBlob.size;
            if (isNativeCapacitorPlatform() && uniqueExportBytes > maxNativeBankExportBytes) {
              throw new Error('This bank is too large to export on mobile. Try desktop export.');
            }
          }
          exportedAudio += 1;
          totalExportBytes += audioBlob.size;
        }
        processedItems += 1;
        onProgress?.(10 + (processedItems / totalMediaItems) * 60);
        if (processedItems % 8 === 0) await yieldToMainThread();
      }

      if (padHasExpectedImageAsset(pad)) {
        const exportPad = exportPadMap.get(pad.id);
        const imageBlob = await loadPadMediaBlob(pad, 'image');
        if (imageBlob) {
          const imageHash = await sha256HexFromBlob(imageBlob);
          const existingImagePath = imageHashToPath.get(imageHash);
          if (existingImagePath) {
            dedupedImageReuses += 1;
            if (exportPad) exportPad.imageUrl = existingImagePath;
          } else {
            const fileName = `${imageHash}.image`;
            imageFolder.file(fileName, imageBlob);
            const path = `images/${fileName}`;
            imageHashToPath.set(imageHash, path);
            if (exportPad) exportPad.imageUrl = path;
            uniqueExportBytes += imageBlob.size;
            if (isNativeCapacitorPlatform() && uniqueExportBytes > maxNativeBankExportBytes) {
              throw new Error('This bank is too large to export on mobile. Try desktop export.');
            }
          }
          exportedImages += 1;
          totalExportBytes += imageBlob.size;
        }
        processedItems += 1;
        onProgress?.(10 + (processedItems / totalMediaItems) * 60);
        if (processedItems % 8 === 0) await yieldToMainThread();
      }
    }

    diagnostics.metrics.processedBytes = totalExportBytes;
    diagnostics.metrics.exportedAudio = exportedAudio;
    diagnostics.metrics.exportedImages = exportedImages;
    diagnostics.metrics.uniqueExportBytes = uniqueExportBytes;
    diagnostics.metrics.uniqueAudioAssets = audioHashToPath.size;
    diagnostics.metrics.uniqueImageAssets = imageHashToPath.size;
    diagnostics.metrics.dedupedAudioReuses = dedupedAudioReuses;
    diagnostics.metrics.dedupedImageReuses = dedupedImageReuses;
    mediaCompletedAt = getNowMs();

    const bankData = {
      ...bank,
      createdAt: bank.createdAt.toISOString(),
      pads: exportPads,
      creatorEmail: effectiveUser?.email || undefined,
    };
    zip.file('bank.json', JSON.stringify(bankData, null, 2));

    addOperationStage(diagnostics, 'archive-generate');
    onProgress?.(75);
    const zipBlob = isNativeCapacitorPlatform()
      ? await zip.generateAsync(
        {
          type: 'blob',
          compression: 'STORE',
        },
        (meta) => onProgress?.(75 + meta.percent * 0.2)
      )
      : await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 },
        },
        (meta) => onProgress?.(75 + meta.percent * 0.2)
      );
    archiveCompletedAt = getNowMs();
    exportedArchiveBytes = zipBlob.size;

    const fileName = `${bank.name.replace(/[^a-z0-9]/gi, '_')}.bank`;
    const saveResult = await saveExportFile(zipBlob, fileName);
    if (!saveResult.success) {
      throw new Error(saveResult.message || 'Failed to save exported bank.');
    }
    addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
    saveCompletedAt = getNowMs();

    const timing = {
      totalMs: Math.round(saveCompletedAt - exportStartedAt),
      preflightMs: Math.round(preflightCompletedAt - exportStartedAt),
      mediaPrepareMs: Math.round(Math.max(0, mediaCompletedAt - preflightCompletedAt)),
      archiveMs: Math.round(Math.max(0, archiveCompletedAt - mediaCompletedAt)),
      saveMs: Math.round(Math.max(0, saveCompletedAt - archiveCompletedAt)),
      archiveBytes: exportedArchiveBytes,
    };
    diagnostics.metrics.exportTotalMs = timing.totalMs;
    diagnostics.metrics.exportPreflightMs = timing.preflightMs;
    diagnostics.metrics.exportMediaPrepareMs = timing.mediaPrepareMs;
    diagnostics.metrics.exportArchiveMs = timing.archiveMs;
    diagnostics.metrics.exportSaveMs = timing.saveMs;
    diagnostics.metrics.archiveBytes = exportedArchiveBytes;
    addOperationStage(diagnostics, 'timings', timing);

    if (effectiveUser?.id && profileRole !== 'admin' && isNativeCapacitorPlatform()) {
      const fileSha256 = await sha256HexFromBlob(zipBlob);
      try {
        enqueueUserExportUpload({
          exportOperationId,
          userId: effectiveUser.id,
          bankId: bank.id,
          bankName: bank.name,
          fileName,
          fileSize: zipBlob.size,
          fileSha256,
          padNames: exportPadNames,
          blob: zipBlob,
        });
        void processUserExportUploadQueue();
      } catch {
        // Upload queueing is best effort and should never block local export.
      }
    }

    onProgress?.(100);
    logExportActivity({
      status: 'success',
      phase: 'local_export',
      bankName: bank.name,
      bankId: bank.id,
      padNames: exportPadNames,
      exportOperationId,
      timing,
    });
    return saveResult.message || 'Bank exported successfully.';
  } catch (error) {
    const now = getNowMs();
    const timing = {
      totalMs: Math.round(now - exportStartedAt),
      preflightMs: Math.round(preflightCompletedAt - exportStartedAt),
      mediaPrepareMs: Math.round(Math.max(0, mediaCompletedAt - preflightCompletedAt)),
      archiveMs: Math.round(Math.max(0, archiveCompletedAt - mediaCompletedAt)),
      saveMs: Math.round(Math.max(0, saveCompletedAt - archiveCompletedAt)),
      archiveBytes: exportedArchiveBytes,
    };
    diagnostics.metrics.exportTotalMs = timing.totalMs;
    diagnostics.metrics.exportPreflightMs = timing.preflightMs;
    diagnostics.metrics.exportMediaPrepareMs = timing.mediaPrepareMs;
    diagnostics.metrics.exportArchiveMs = timing.archiveMs;
    diagnostics.metrics.exportSaveMs = timing.saveMs;
    diagnostics.metrics.archiveBytes = exportedArchiveBytes;
    addOperationStage(diagnostics, 'timings-partial', timing);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
    logExportActivity({
      status: 'failed',
      phase: 'local_export',
      bankName: bank.name,
      bankId: bank.id,
      padNames: exportPadNames,
      exportOperationId,
      timing,
      errorMessage: logPath ? `${errorMessage} (diagnostics: ${logPath})` : errorMessage,
    });
    throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
  }
};
