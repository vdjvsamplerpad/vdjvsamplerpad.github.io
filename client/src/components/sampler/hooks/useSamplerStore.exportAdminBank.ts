import JSZip from 'jszip';
import type { BankMetadata, SamplerBank } from '../types/sampler';
import type { AdminCatalogUploadPublishResult } from './useSamplerStore.exportUpload';

type SamplerPad = SamplerBank['pads'][number];

export type ExportAudioMode = 'fast' | 'compact';

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

type SignedAdminExportTokenResult = {
  token: string;
  keyId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  bankJsonSha256: string;
};

type EnqueueAdminExportUploadInput = {
  exportOperationId: string;
  userId: string;
  bankId: string;
  bankName: string;
  catalogItemId: string;
  fileName: string;
  assetName: string;
  assetProtection: 'encrypted' | 'public';
  fileSize: number;
  fileSha256: string | null;
  padNames: string[];
  blob: Blob;
};

type ImportableAdminUser = {
  id: string;
  email?: string | null;
};

export interface RunExportAdminBankInput {
  id: string;
  title: string;
  description: string;
  addToDatabase: boolean;
  allowExport: boolean;
  publicCatalogAsset: boolean;
  exportMode: ExportAudioMode;
  thumbnailPath?: string;
  onProgress?: (progress: number) => void;
  banks: SamplerBank[];
  user: ImportableAdminUser | null;
  profileRole?: string | null;
}

export interface RunExportAdminBankDeps {
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
  detectAudioFormat: (blob: Blob) => string;
  sha256HexFromBlob: (blob: Blob) => Promise<string>;
  sha256HexFromText: (text: string) => Promise<string>;
  yieldToMainThread: () => Promise<void>;
  extFromMime: (mime: string | undefined, fallbackType: 'audio' | 'image') => string;
  inferImageExtFromPath: (value: string | undefined) => string;
  addBankMetadata: (zip: JSZip, metadata: BankMetadata) => void;
  encryptZip: (zip: JSZip, password: string) => Promise<Blob>;
  sharedExportDisabledPassword: string;
  issueSignedAdminExportToken: (input: {
    bankJsonSha256: string;
    bankName: string;
    padCount: number;
    allowExport: boolean;
  }) => Promise<SignedAdminExportTokenResult>;
  saveExportFile: (blob: Blob, fileName: string) => Promise<SaveExportFileResult>;
  uploadAdminCatalogAsset: (input: {
    catalogItemId: string;
    assetName: string;
    exportBlob: Blob;
    assetProtection: 'encrypted' | 'public';
  }) => Promise<AdminCatalogUploadPublishResult>;
  isNonRetryableGithubUploadError: (error: unknown) => boolean;
  enqueueAdminExportUpload: (input: EnqueueAdminExportUploadInput) => void;
  writeOperationDiagnosticsLog: (diagnostics: ExportDiagnosticsLike, error: unknown) => Promise<string | null>;
}

export const runExportAdminBankPipeline = async (
  input: RunExportAdminBankInput,
  deps: RunExportAdminBankDeps
): Promise<string> => {
  const {
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
    detectAudioFormat,
    sha256HexFromBlob,
    sha256HexFromText,
    yieldToMainThread,
    extFromMime,
    inferImageExtFromPath,
    addBankMetadata,
    encryptZip,
    sharedExportDisabledPassword,
    issueSignedAdminExportToken,
    saveExportFile,
    uploadAdminCatalogAsset,
    isNonRetryableGithubUploadError,
    enqueueAdminExportUpload,
    writeOperationDiagnosticsLog,
  } = deps;

  if (!user || profileRole !== 'admin') throw new Error('Only admins can do this action.');
  const bank = banks.find((b) => b.id === id);
  if (!bank) throw new Error('We could not find that bank.');

  const diagnostics = createOperationDiagnostics('admin_bank_export', user.id);
  addOperationStage(diagnostics, 'start', {
    bankId: bank.id,
    bankName: bank.name,
    padCount: bank.pads.length,
    addToDatabase,
    allowExport,
    publicCatalogAsset,
    transferable: true,
    exportMode,
  });
  const exportStartedAt = getNowMs();
  let preflightCompletedAt = exportStartedAt;
  let mediaCompletedAt = exportStartedAt;
  let archiveCompletedAt = exportStartedAt;
  let saveCompletedAt = exportStartedAt;
  let exportedArchiveBytes = 0;

  try {
    onProgress?.(5);
    await ensureExportPermission();

    const estimatedBytes = await estimateBankMediaBytes(bank);
    diagnostics.metrics.estimatedBytes = estimatedBytes;
    addOperationStage(diagnostics, 'preflight', { estimatedBytes });

    if (isNativeCapacitorPlatform() && estimatedBytes > maxNativeBankExportBytes) {
      throw new Error(
        `Admin bank export is too large for mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Reduce bank size and try again.`
      );
    }

    await ensureStorageHeadroom(Math.ceil(estimatedBytes * 0.35), 'admin bank export');
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
    let totalExportBytes = 0;
    let exportedAudio = 0;
    let exportedImages = 0;
    let uniqueExportBytes = 0;
    let dedupedAudioReuses = 0;
    let dedupedImageReuses = 0;
    const audioHashToPath = new Map<string, string>();
    const imageHashToPath = new Map<string, string>();

    const exportPads = bank.pads.map((pad) => ({
      ...pad,
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
          if (shouldAttemptTrim(pad, exportMode)) {
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
              throw new Error('This bank is too large to export on mobile. Try desktop export.');
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
    diagnostics.metrics.exportAudioMode = exportMode === 'compact' ? 1 : 0;
    mediaCompletedAt = getNowMs();

    const bankData = {
      ...bank,
      createdAt: bank.createdAt.toISOString(),
      pads: exportPads,
    };
    const bankJsonText = JSON.stringify(bankData, null, 2);
    zip.file('bank.json', bankJsonText);
    const bankJsonSha256 = await sha256HexFromText(bankJsonText);

    let embeddedThumbnailAssetPath: string | undefined;
    if (thumbnailPath) {
      try {
        const response = await fetch(thumbnailPath, { cache: 'no-store', credentials: 'omit' });
        if (response.ok) {
          const thumbnailBlob = await response.blob();
          if (thumbnailBlob.size > 0) {
            let ext = extFromMime(thumbnailBlob.type, 'image');
            if (ext === 'bin') {
              ext = inferImageExtFromPath(thumbnailPath);
            }
            embeddedThumbnailAssetPath = `thumbnail/bank-thumbnail.${ext}`;
            zip.file(embeddedThumbnailAssetPath, thumbnailBlob);
            addOperationStage(diagnostics, 'thumbnail-embedded', {
              source: thumbnailPath,
              bytes: thumbnailBlob.size,
              path: embeddedThumbnailAssetPath,
            });
          }
        } else {
          addOperationStage(diagnostics, 'thumbnail-embed-warning', {
            source: thumbnailPath,
            status: response.status,
          });
        }
      } catch (embedError) {
        addOperationStage(diagnostics, 'thumbnail-embed-warning', {
          source: thumbnailPath,
          reason: embedError instanceof Error ? embedError.message : String(embedError),
        });
      }
    }

    const normalizedTitle = (title || bank.name || 'Bank').trim();
    let fileName = `${normalizedTitle.replace(/[^a-z0-9]/gi, '_')}.bank`;
    let outputBlob: Blob;
    let catalogDraftId: string | null = null;
    let uploadBankId = bank.id;
    let signedTokenWarningMessage = '';

    if (addToDatabase) {
      addOperationStage(diagnostics, 'db-create');
      const { createAdminBankWithDerivedKey } = await import('@/lib/admin-bank-utils');
      const adminBank = await createAdminBankWithDerivedKey(title, description, user.id, bank.defaultColor);
      if (!adminBank) throw new Error('Failed to create admin bank metadata entry.');
      uploadBankId = adminBank.id;
      fileName = `${normalizedTitle.replace(/[^a-z0-9]/gi, '_')}_${adminBank.id}.bank`;

      addBankMetadata(zip, {
        password: !publicCatalogAsset,
        transferable: true,
        exportable: false,
        title,
        description,
        color: bank.defaultColor,
        bankId: adminBank.id,
        thumbnailUrl: thumbnailPath,
        thumbnailAssetPath: embeddedThumbnailAssetPath,
        hideThumbnailPreview: bank.bankMetadata?.hideThumbnailPreview,
      });

      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase
          .from('user_bank_access')
          .upsert({ user_id: user.id, bank_id: adminBank.id }, { onConflict: 'user_id,bank_id' as any });

        const storeDraftResponse = await supabase.functions.invoke(`admin-api/store/banks/${adminBank.id}/draft`, {
          method: 'POST',
          body: {
            expected_asset_name: fileName,
            thumbnail_path: thumbnailPath,
            asset_protection: publicCatalogAsset ? 'public' : 'encrypted',
          },
        });
        if (storeDraftResponse.error) {
          addOperationStage(diagnostics, 'store-draft-warning', { error: storeDraftResponse.error.message });
        } else {
          const maybeDraftId = (storeDraftResponse as any)?.data?.item?.id;
          if (typeof maybeDraftId === 'string' && maybeDraftId.trim().length > 0) {
            catalogDraftId = maybeDraftId;
          } else {
            addOperationStage(diagnostics, 'store-draft-warning', { error: 'missing catalog item id' });
          }
        }
      } catch (upsertError) {
        addOperationStage(diagnostics, 'db-integration-warning', {
          reason: upsertError instanceof Error ? upsertError.message : String(upsertError),
        });
      }

      onProgress?.(65);
      if (publicCatalogAsset) {
        addOperationStage(diagnostics, 'archive-generate');
        outputBlob = isNativeCapacitorPlatform()
          ? await zip.generateAsync(
            {
              type: 'blob',
              compression: 'STORE',
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          )
          : await zip.generateAsync(
            {
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: 9 },
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          );
      } else {
        outputBlob = await encryptZip(zip, adminBank.derived_key);
        onProgress?.(88);
      }
      archiveCompletedAt = getNowMs();
    } else {
      let signedAdminExportToken: SignedAdminExportTokenResult | null = null;
      if (bankJsonSha256) {
        try {
          signedAdminExportToken = await issueSignedAdminExportToken({
            bankJsonSha256,
            bankName: normalizedTitle,
            padCount: bank.pads.length,
            allowExport,
          });
          addOperationStage(diagnostics, 'admin-export-token-signed', {
            keyId: signedAdminExportToken.keyId,
            expiresAt: signedAdminExportToken.expiresAt,
          });
        } catch (tokenError) {
          signedTokenWarningMessage =
            ' Signed trust token unavailable; this file may count toward owned quota on import.';
          addOperationStage(diagnostics, 'admin-export-token-warning', {
            reason: tokenError instanceof Error ? tokenError.message : String(tokenError),
          });
        }
      } else {
        signedTokenWarningMessage =
          ' Signed trust token unavailable; this file may count toward owned quota on import.';
        addOperationStage(diagnostics, 'admin-export-token-warning', {
          reason: 'bank-json-sha256-unavailable',
        });
      }

      addBankMetadata(zip, {
        password: !allowExport,
        transferable: true,
        exportable: allowExport,
        title,
        description,
        color: bank.defaultColor,
        thumbnailUrl: thumbnailPath,
        thumbnailAssetPath: embeddedThumbnailAssetPath,
        hideThumbnailPreview: bank.bankMetadata?.hideThumbnailPreview,
        adminExportToken: signedAdminExportToken?.token,
        adminExportTokenKid: signedAdminExportToken?.keyId || undefined,
        adminExportTokenIssuedAt: signedAdminExportToken?.issuedAt || undefined,
        adminExportTokenExpiresAt: signedAdminExportToken?.expiresAt || undefined,
        adminExportTokenBankSha256: signedAdminExportToken?.bankJsonSha256 || bankJsonSha256 || undefined,
      });

      if (!allowExport) {
        onProgress?.(65);
        outputBlob = await encryptZip(zip, sharedExportDisabledPassword);
        onProgress?.(88);
        archiveCompletedAt = getNowMs();
      } else {
        addOperationStage(diagnostics, 'archive-generate');
        onProgress?.(65);
        outputBlob = isNativeCapacitorPlatform()
          ? await zip.generateAsync(
            {
              type: 'blob',
              compression: 'STORE',
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          )
          : await zip.generateAsync(
            {
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: 9 },
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          );
        archiveCompletedAt = getNowMs();
      }
    }

    exportedArchiveBytes = outputBlob.size;

    const saveResult = await saveExportFile(outputBlob, fileName);
    if (!saveResult.success) {
      throw new Error(saveResult.message || 'Failed to save admin bank export.');
    }
    addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
    saveCompletedAt = getNowMs();
    let uploadWarningMessage = '';
    if (addToDatabase) {
      if (catalogDraftId) {
        try {
          onProgress?.(95);
          const uploadResult = await uploadAdminCatalogAsset({
            catalogItemId: catalogDraftId,
            assetName: fileName,
            exportBlob: outputBlob,
            assetProtection: publicCatalogAsset ? 'public' : 'encrypted',
          });
          addOperationStage(diagnostics, 'github-upload-linked', {
            catalogItemId: catalogDraftId,
            releaseTag: uploadResult.releaseTag,
            assetName: uploadResult.assetName,
            fileSize: uploadResult.fileSize,
          });
          onProgress?.(99);
        } catch (uploadError) {
          const reason = uploadError instanceof Error ? uploadError.message : String(uploadError);
          const shouldQueueRetry = !isNonRetryableGithubUploadError(uploadError);
          if (shouldQueueRetry) {
            const queuedSha256 = await sha256HexFromBlob(outputBlob);
            enqueueAdminExportUpload({
              exportOperationId: diagnostics.operationId,
              userId: user.id,
              bankId: uploadBankId,
              bankName: normalizedTitle,
              catalogItemId: catalogDraftId,
              fileName,
              assetName: fileName,
              assetProtection: publicCatalogAsset ? 'public' : 'encrypted',
              fileSize: outputBlob.size,
              fileSha256: queuedSha256,
              padNames: bank.pads.map((pad) => pad.name || 'Untitled Pad'),
              blob: outputBlob,
            });
            uploadWarningMessage = ` Upload failed. Auto-retry queued in background. (${reason})`;
          } else {
            uploadWarningMessage = ` Upload failed and was not queued for retry. (${reason})`;
          }
          addOperationStage(diagnostics, 'github-upload-warning', {
            catalogItemId: catalogDraftId,
            reason,
            queuedRetry: shouldQueueRetry,
          });
        }
      } else {
        uploadWarningMessage = ' Upload skipped because catalog draft could not be created.';
        addOperationStage(diagnostics, 'github-upload-warning', {
          reason: 'catalog-draft-id-missing',
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
    return `${saveResult.message || 'Admin bank exported successfully.'}${uploadWarningMessage}${signedTokenWarningMessage}`;
  } catch (error) {
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
