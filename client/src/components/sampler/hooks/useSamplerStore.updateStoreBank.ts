import JSZip from 'jszip';
import type { BankMetadata, SamplerBank } from '../types/sampler';
import type { AdminCatalogUploadPublishResult } from './useSamplerStore.exportUpload';
import type { ExportAudioMode, StoreBankAssetProtection } from './useSamplerStore.types';
import { derivePassword } from '@/lib/bank-utils';
import { ensureManagedStoreThumbnail } from './storeThumbnailUpload';

type SamplerPad = SamplerBank['pads'][number];
type MediaBackend = 'native' | 'idb';

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

type TrimAudioResult = {
  blob: Blob;
  newDurationMs: number;
};

type TranscodeAudioToMP3Result = {
  blob: Blob;
  newDurationMs: number;
  appliedTrim: boolean;
};

type ImportableAdminUser = {
  id: string;
  email?: string | null;
};

type EnqueueAdminExportUploadInput = {
  exportOperationId: string;
  userId: string;
  bankId: string;
  bankName: string;
  catalogItemId: string;
  operationType: 'create' | 'update';
  fileName: string;
  assetName: string;
  assetProtection: 'encrypted' | 'public';
  exportAudioMode?: ExportAudioMode;
  fileSize: number;
  fileSha256: string | null;
  padNames: string[];
  blob: Blob;
};

export interface RunUpdateStoreBankInput {
  bankSnapshot: SamplerBank;
  title: string;
  description: string;
  syncMetadata: boolean;
  assetProtection: StoreBankAssetProtection;
  exportMode: ExportAudioMode;
  thumbnailPath?: string;
  onProgress?: (progress: number) => void;
  user: ImportableAdminUser | null;
  profileRole?: string | null;
}

export interface RunUpdateStoreBankDeps {
  createOperationDiagnostics: (operation: 'admin_bank_export', userId?: string | null) => ExportDiagnosticsLike;
  addOperationStage: (diagnostics: ExportDiagnosticsLike, stage: string, details?: Record<string, unknown>) => void;
  getNowMs: () => number;
  ensureExportPermission: () => Promise<void>;
  estimateBankMediaBytes: (bank: SamplerBank) => Promise<number>;
  isNativeCapacitorPlatform: () => boolean;
  maxNativeBankExportBytes: number;
  ensureStorageHeadroom: (requiredBytes: number, operationName: string) => Promise<void>;
  padHasExpectedImageAsset: (pad: Partial<SamplerPad>) => boolean;
  loadPadMediaBlob: (pad: SamplerPad, type: 'audio' | 'image') => Promise<Blob | null>;
  shouldAttemptTrim: (pad: SamplerPad, mode: ExportAudioMode) => boolean;
  trimAudio: (
    source: Blob,
    startTimeMs?: number,
    endTimeMs?: number,
    formatHint?: string
  ) => Promise<TrimAudioResult>;
  remapSavedHotcuesForBakedTrim: (
    hotcues: SamplerPad['savedHotcuesMs'],
    startMs: number,
    trimmedDurationMs: number
  ) => [number | null, number | null, number | null, number | null];
  transcodeAudioToMP3: (input: {
    source: Blob;
    startTimeMs?: number;
    endTimeMs?: number;
    applyTrim?: boolean;
    bitrate?: number;
  }) => Promise<TranscodeAudioToMP3Result>;
  detectAudioFormat: (blob: Blob) => string;
  sha256HexFromBlob: (blob: Blob) => Promise<string>;
  sha256HexFromText: (text: string) => Promise<string>;
  yieldToMainThread: () => Promise<void>;
  extFromMime: (mime: string | undefined, fallbackType: 'audio' | 'image') => string;
  inferImageExtFromPath: (value: string | undefined) => string;
  addBankMetadata: (zip: JSZip, metadata: BankMetadata) => void;
  encryptZip: (zip: JSZip, password: string) => Promise<Blob>;
  saveExportFile: (blob: Blob, fileName: string) => Promise<SaveExportFileResult>;
  patchAdminCatalogItem: (input: { catalogItemId: string; updates: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  uploadAdminCatalogAsset: (input: {
    catalogItemId: string;
    operationType?: 'create' | 'update';
    assetName: string;
    exportBlob: Blob;
    assetProtection: 'encrypted' | 'public';
  }) => Promise<AdminCatalogUploadPublishResult>;
  isNonRetryableGithubUploadError: (error: unknown) => boolean;
  enqueueAdminExportUpload: (input: EnqueueAdminExportUploadInput) => void;
  clearQueuedAdminUpdateJobsForCatalogItem: (catalogItemId: string, options?: { excludeExportOperationId?: string }) => void;
  writeOperationDiagnosticsLog: (diagnostics: ExportDiagnosticsLike, error: unknown) => Promise<string | null>;
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): T => {
  const nextEntries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(nextEntries) as T;
};

const buildStoreReleaseMetadata = (input: {
  bank: SamplerBank;
  title: string;
  description: string;
  assetProtection: StoreBankAssetProtection;
  thumbnailPath?: string;
  embeddedThumbnailAssetPath?: string;
}): BankMetadata => {
  const existing = input.bank.bankMetadata;
  return stripUndefined({
    password: input.assetProtection === 'encrypted',
    transferable: true,
    exportable: false,
    bankId: existing?.bankId,
    catalogItemId: existing?.catalogItemId,
    title: input.title,
    description: input.description,
    color: input.bank.defaultColor || existing?.color,
    thumbnailUrl: input.thumbnailPath,
    thumbnailAssetPath: input.embeddedThumbnailAssetPath,
    hideThumbnailPreview: existing?.hideThumbnailPreview,
  });
};

const buildStoreUpdateFileName = (title: string, catalogItemId: string): string => {
  const base = (title || 'Bank').trim().replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'Bank';
  const suffix = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${base}_${catalogItemId}_${suffix}.bank`;
};

export const runUpdateStoreBankPipeline = async (
  input: RunUpdateStoreBankInput,
  deps: RunUpdateStoreBankDeps,
): Promise<string> => {
  const {
    bankSnapshot,
    title,
    description,
    syncMetadata,
    assetProtection,
    exportMode,
    thumbnailPath,
    onProgress,
    user,
    profileRole,
  } = input;
  const {
    createOperationDiagnostics,
    addOperationStage,
    getNowMs,
    ensureExportPermission,
    estimateBankMediaBytes,
    isNativeCapacitorPlatform,
    maxNativeBankExportBytes,
    ensureStorageHeadroom,
    padHasExpectedImageAsset,
    loadPadMediaBlob,
    shouldAttemptTrim,
    trimAudio,
    remapSavedHotcuesForBakedTrim,
    transcodeAudioToMP3,
    detectAudioFormat,
    sha256HexFromBlob,
    sha256HexFromText,
    yieldToMainThread,
    extFromMime,
    inferImageExtFromPath,
    addBankMetadata,
    encryptZip,
    saveExportFile,
    patchAdminCatalogItem,
    uploadAdminCatalogAsset,
    isNonRetryableGithubUploadError,
    enqueueAdminExportUpload,
    clearQueuedAdminUpdateJobsForCatalogItem,
    writeOperationDiagnosticsLog,
  } = deps;

  const isHttpUrl = (value: string | null | undefined): value is string =>
    typeof value === 'string' && /^https?:\/\//i.test(value.trim());

  if (!user || profileRole !== 'admin') throw new Error('Only admins can update store banks.');
  const catalogItemId = typeof bankSnapshot.bankMetadata?.catalogItemId === 'string'
    ? bankSnapshot.bankMetadata.catalogItemId.trim()
    : '';
  if (!catalogItemId) throw new Error('Only linked store banks can be updated.');

  const normalizedTitle = (title || bankSnapshot.name || 'Bank').trim();
  const diagnostics = createOperationDiagnostics('admin_bank_export', user.id);
  addOperationStage(diagnostics, 'start', {
    bankId: bankSnapshot.id,
    bankName: bankSnapshot.name,
    catalogItemId,
    padCount: bankSnapshot.pads.length,
    syncMetadata,
    assetProtection,
    exportMode,
    operationType: 'update',
  });

  const exportStartedAt = getNowMs();
  let preflightCompletedAt = exportStartedAt;
  let mediaCompletedAt = exportStartedAt;
  let archiveCompletedAt = exportStartedAt;
  let saveCompletedAt = exportStartedAt;
  let exportedArchiveBytes = 0;
  let managedThumbnailCleanup: (() => Promise<void>) | null = null;

  try {
    onProgress?.(5);
    await ensureExportPermission();

    const estimatedBytes = await estimateBankMediaBytes(bankSnapshot);
    diagnostics.metrics.estimatedBytes = estimatedBytes;
    addOperationStage(diagnostics, 'preflight', { estimatedBytes });

    if (isNativeCapacitorPlatform() && estimatedBytes > maxNativeBankExportBytes) {
      throw new Error(
        `Store bank update is too large for mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Reduce bank size and try again.`,
      );
    }

    await ensureStorageHeadroom(Math.ceil(estimatedBytes * 0.35), 'store bank update');
    preflightCompletedAt = getNowMs();

    const zip = new JSZip();
    const audioFolder = zip.folder('audio');
    const imageFolder = zip.folder('images');
    if (!audioFolder || !imageFolder) throw new Error('Could not prepare files for store update.');

    const totalMediaItems = Math.max(
      1,
      bankSnapshot.pads.reduce((count, pad) => count + (pad.audioUrl ? 1 : 0) + (padHasExpectedImageAsset(pad) ? 1 : 0), 0),
    );
    let processedItems = 0;
    let totalExportBytes = 0;
    let exportedAudio = 0;
    let exportedImages = 0;
    let uniqueExportBytes = 0;
    let dedupedAudioReuses = 0;
    let dedupedImageReuses = 0;
    const audioHashToPath = new Map<string, string>();
    const imageHashToPath = new Map<string, string>();
    const exportPads = bankSnapshot.pads.map((pad) => ({
      ...pad,
      audioUrl: undefined as string | undefined,
      imageUrl: undefined as string | undefined,
    }));
    const exportPadMap = new Map(exportPads.map((pad) => [pad.id, pad]));

    for (const pad of bankSnapshot.pads) {
      if (pad.audioUrl) {
        const exportPad = exportPadMap.get(pad.id);
        const sourceBlob = await loadPadMediaBlob(pad, 'audio');
        if (sourceBlob) {
          let audioBlob = sourceBlob;
          const shouldBakeTrim = shouldAttemptTrim(pad, 'compact');
          if (exportMode === 'trim_mp3') {
            const mp3Result = await transcodeAudioToMP3({
              source: sourceBlob,
              startTimeMs: pad.startTimeMs,
              endTimeMs: pad.endTimeMs,
              applyTrim: shouldBakeTrim,
              bitrate: 128,
            });
            audioBlob = mp3Result.blob;
            if (exportPad && mp3Result.appliedTrim) {
              exportPad.startTimeMs = 0;
              exportPad.endTimeMs = mp3Result.newDurationMs;
              exportPad.savedHotcuesMs = remapSavedHotcuesForBakedTrim(
                pad.savedHotcuesMs,
                pad.startTimeMs,
                mp3Result.newDurationMs
              );
            }
            addOperationStage(diagnostics, mp3Result.appliedTrim ? 'audio-trim-mp3' : 'audio-mp3-transcoded', {
              padId: pad.id,
              padName: pad.name || 'Untitled Pad',
              originalBytes: sourceBlob.size,
              outputBytes: audioBlob.size,
              bitrate: 128,
            });
          } else if (shouldAttemptTrim(pad, exportMode)) {
            try {
              const trimResult = await trimAudio(sourceBlob, pad.startTimeMs, pad.endTimeMs, detectAudioFormat(sourceBlob));
              audioBlob = trimResult.blob;
              if (exportPad) {
                exportPad.startTimeMs = 0;
                exportPad.endTimeMs = trimResult.newDurationMs;
                exportPad.savedHotcuesMs = remapSavedHotcuesForBakedTrim(
                  pad.savedHotcuesMs,
                  pad.startTimeMs,
                  trimResult.newDurationMs
                );
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
              throw new Error('This bank is too large to update from mobile. Try desktop upload.');
            }
          }
          exportedAudio += 1;
          totalExportBytes += audioBlob.size;
        }
        processedItems += 1;
        onProgress?.(10 + (processedItems / totalMediaItems) * 45);
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
              throw new Error('This bank is too large to update from mobile. Try desktop upload.');
            }
          }
          exportedImages += 1;
          totalExportBytes += imageBlob.size;
        }
        processedItems += 1;
        onProgress?.(10 + (processedItems / totalMediaItems) * 45);
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
    diagnostics.metrics.exportAudioMode = exportMode === 'fast' ? 0 : exportMode === 'compact' ? 1 : 2;
    mediaCompletedAt = getNowMs();

    let embeddedThumbnailAssetPath: string | undefined;
    if (thumbnailPath) {
      try {
        const response = await fetch(thumbnailPath, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) {
          throw new Error(`Thumbnail fetch failed (${response.status}).`);
        }
        const thumbnailBlob = await response.blob();
        if (thumbnailBlob.size <= 0) {
          throw new Error('Thumbnail file was empty.');
        }
        let ext = extFromMime(thumbnailBlob.type, 'image');
        if (ext === 'bin') ext = inferImageExtFromPath(thumbnailPath);
        embeddedThumbnailAssetPath = `thumbnail/bank-thumbnail.${ext}`;
        zip.file(embeddedThumbnailAssetPath, thumbnailBlob);
        addOperationStage(diagnostics, 'thumbnail-embedded', {
          source: thumbnailPath,
          bytes: thumbnailBlob.size,
          path: embeddedThumbnailAssetPath,
        });
      } catch (embedError) {
        throw new Error(
          `Could not embed the bank thumbnail for offline use. ${
            embedError instanceof Error ? embedError.message : String(embedError)
          }`,
        );
      }
    }

    let durableThumbnailPath: string | undefined = isHttpUrl(thumbnailPath) ? thumbnailPath : undefined;
    if (syncMetadata && thumbnailPath) {
      const managedThumbnail = await ensureManagedStoreThumbnail({
        bankId: bankSnapshot.bankMetadata?.bankId || bankSnapshot.id,
        thumbnailPath,
        inferImageExtFromPath,
      });
      durableThumbnailPath = managedThumbnail.url;
      managedThumbnailCleanup = managedThumbnail.uploaded ? managedThumbnail.cleanup : null;
      addOperationStage(diagnostics, 'thumbnail-uploaded-for-store', {
        catalogItemId,
        uploaded: managedThumbnail.uploaded,
      });
    }

    const sanitizedMetadata = buildStoreReleaseMetadata({
      bank: bankSnapshot,
      title: normalizedTitle,
      description,
      assetProtection,
      thumbnailPath: durableThumbnailPath,
      embeddedThumbnailAssetPath,
    });

    const bankData = {
      ...bankSnapshot,
      name: normalizedTitle,
      defaultColor: bankSnapshot.defaultColor,
      createdAt: bankSnapshot.createdAt.toISOString(),
      transferable: true,
      exportable: false,
      bankMetadata: sanitizedMetadata,
      pads: exportPads,
    };
    const bankJsonText = JSON.stringify(bankData, null, 2);
    zip.file('bank.json', bankJsonText);
    await sha256HexFromText(bankJsonText);
    const fileName = buildStoreUpdateFileName(normalizedTitle, catalogItemId);
    addBankMetadata(zip, sanitizedMetadata);

    onProgress?.(65);
    let outputBlob: Blob;
    if (assetProtection === 'public') {
      outputBlob = isNativeCapacitorPlatform()
        ? await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => onProgress?.(65 + meta.percent * 0.23))
        : await zip.generateAsync(
          { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } },
          (meta) => onProgress?.(65 + meta.percent * 0.23),
        );
    } else {
      const bankId = typeof bankSnapshot.bankMetadata?.bankId === 'string' ? bankSnapshot.bankMetadata.bankId.trim() : '';
      const derivedKey = bankId ? await derivePassword(bankId) : catalogItemId;
      outputBlob = await encryptZip(zip, derivedKey);
      onProgress?.(88);
    }
    archiveCompletedAt = getNowMs();
    exportedArchiveBytes = outputBlob.size;

    const saveResult = await saveExportFile(outputBlob, fileName);
    if (!saveResult.success) {
      throw new Error(saveResult.message || 'Failed to save store bank update export.');
    }
    addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
    saveCompletedAt = getNowMs();

    let metadataSynced = false;
    let uploadWarningMessage = '';
    let uploadSucceeded = false;
    try {
      onProgress?.(95);
      const uploadResult = await uploadAdminCatalogAsset({
        catalogItemId,
        operationType: 'update',
        assetName: fileName,
        exportBlob: outputBlob,
        assetProtection,
      });
      addOperationStage(diagnostics, 'catalog-upload-linked', {
        catalogItemId,
        assetName: uploadResult.assetName,
        fileSize: uploadResult.fileSize,
        assetProtection,
      });
      clearQueuedAdminUpdateJobsForCatalogItem(catalogItemId, {
        excludeExportOperationId: diagnostics.operationId,
      });
      uploadSucceeded = true;
      onProgress?.(99);
    } catch (uploadError) {
      const reason = uploadError instanceof Error ? uploadError.message : String(uploadError);
      const shouldQueueRetry = !isNonRetryableGithubUploadError(uploadError);
      if (shouldQueueRetry) {
        enqueueAdminExportUpload({
          exportOperationId: diagnostics.operationId,
          userId: user.id,
          bankId: bankSnapshot.id,
          bankName: normalizedTitle,
          catalogItemId,
          operationType: 'update',
          fileName,
          assetName: fileName,
          assetProtection,
          exportAudioMode: exportMode,
          fileSize: outputBlob.size,
          fileSha256: await sha256HexFromBlob(outputBlob),
          padNames: bankSnapshot.pads.map((pad) => pad.name || 'Untitled Pad'),
          blob: outputBlob,
        });
        uploadWarningMessage = ` Upload failed. Auto-retry queued in background. (${reason})`;
      } else {
        uploadWarningMessage = ` Upload failed and was not queued for retry. (${reason})`;
      }
      addOperationStage(diagnostics, 'catalog-upload-warning', {
        catalogItemId,
        reason,
        queuedRetry: shouldQueueRetry,
      });
    }

    let metadataWarningMessage = '';
    if (uploadSucceeded && syncMetadata) {
      try {
        await patchAdminCatalogItem({
          catalogItemId,
          updates: {
            title: normalizedTitle,
            description,
            color: bankSnapshot.defaultColor,
            thumbnail_path: durableThumbnailPath || null,
          },
        });
        metadataSynced = true;
        addOperationStage(diagnostics, 'catalog-metadata-synced', {
          catalogItemId,
          thumbnailPath: durableThumbnailPath || null,
        });
      } catch (metadataError) {
        metadataWarningMessage = ` Store metadata sync failed. (${
          metadataError instanceof Error ? metadataError.message : String(metadataError)
        })`;
        addOperationStage(diagnostics, 'catalog-metadata-sync-warning', {
          catalogItemId,
          reason: metadataError instanceof Error ? metadataError.message : String(metadataError),
        });
      }
    }

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
    onProgress?.(100);

    const metadataMessage = metadataSynced ? ' Store metadata synced.' : '';
    return `${saveResult.message || 'Store bank update exported successfully.'}${metadataMessage}${metadataWarningMessage}${uploadWarningMessage}${uploadWarningMessage ? '' : ' Draft asset uploaded. Publish it from Admin Access > Catalog when ready.'}`;
  } catch (error) {
    if (typeof managedThumbnailCleanup === 'function') {
      await managedThumbnailCleanup().catch(() => undefined);
    }
    const now = getNowMs();
    const partialTiming = {
      totalMs: Math.round(now - exportStartedAt),
      preflightMs: Math.round(preflightCompletedAt - exportStartedAt),
      mediaPrepareMs: Math.round(Math.max(0, mediaCompletedAt - preflightCompletedAt)),
      archiveMs: Math.round(Math.max(0, archiveCompletedAt - mediaCompletedAt)),
      saveMs: Math.round(Math.max(0, saveCompletedAt - archiveCompletedAt)),
      archiveBytes: exportedArchiveBytes,
    };
    diagnostics.metrics.exportTotalMs = partialTiming.totalMs;
    diagnostics.metrics.exportPreflightMs = partialTiming.preflightMs;
    diagnostics.metrics.exportMediaPrepareMs = partialTiming.mediaPrepareMs;
    diagnostics.metrics.exportArchiveMs = partialTiming.archiveMs;
    diagnostics.metrics.exportSaveMs = partialTiming.saveMs;
    diagnostics.metrics.archiveBytes = exportedArchiveBytes;
    addOperationStage(diagnostics, 'timings-partial', partialTiming);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
    throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
  }
};
