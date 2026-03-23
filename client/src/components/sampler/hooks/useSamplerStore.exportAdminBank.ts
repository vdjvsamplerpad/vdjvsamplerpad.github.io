import JSZip from 'jszip';
import type { BankMetadata, SamplerBank } from '../types/sampler';
import type { AdminCatalogUploadPublishResult } from './useSamplerStore.exportUpload';
import type { ExportAudioMode } from './useSamplerStore.types';
import { ensureManagedStoreThumbnail } from './storeThumbnailUpload';
import { stripPreparedAudioForExport } from './preparedAudio';
import {
  encodeTextToUint8Array,
  type ElectronExportArchiveJobEntry,
  type ElectronExportArchiveJobResult,
} from './electronArchiveJob';
import {
  failOperationDiagnostics,
  finishOperationDiagnostics,
  startOperationHeartbeat,
  type OperationDiagnostics,
} from './useSamplerStore.operationDiagnostics';

type SamplerPad = SamplerBank['pads'][number];

type ExportDiagnosticsLike = OperationDiagnostics;

type SaveExportFileResult = {
  success: boolean;
  savedPath?: string;
  message?: string;
  error?: string;
};

type ElectronArchiveEntry = {
  path: string;
  data?: Uint8Array;
  sourcePath?: string;
  cleanupSourcePath?: boolean;
};

type ElectronArchiveSaveResult = {
  savedPath?: string;
  message?: string;
  archiveBytes: number;
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

type SignedAdminExportTokenResult = {
  token: string;
  keyId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  bankJsonSha256: string;
};

const padHasExpectedAudioAsset = (pad: Partial<SamplerPad>): boolean =>
  Boolean((pad.audioStorageKey && pad.audioStorageKey.trim()) || (pad.audioUrl && pad.audioUrl.trim()));

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
  comingSoonOnly?: boolean;
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
  resolvePadMediaSourcePath?: (pad: SamplerPad, type: 'audio' | 'image') => Promise<string | null>;
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
  getElectronBridgeDiagnostics?: () => Record<string, unknown> | null;
  createElectronZipArchive?: (input: {
    entries: ElectronArchiveEntry[];
    compression?: 'STORE' | 'DEFLATE';
    compressionLevel?: number;
  }) => Promise<Uint8Array | null>;
  createAndSaveElectronZipArchive?: (input: {
    entries: ElectronArchiveEntry[];
    fileName: string;
    compression?: 'STORE' | 'DEFLATE';
    compressionLevel?: number;
  }) => Promise<ElectronArchiveSaveResult | null>;
  stageElectronZipEntry?: (input: {
    archivePath: string;
    blob: Blob;
    fileName?: string;
  }) => Promise<{ sourcePath: string; bytes: number } | null>;
  cleanupStagedElectronZipEntries?: (paths: string[]) => Promise<void>;
  canUseElectronZipArchive?: boolean;
  runElectronExportArchiveJob?: (input: {
    jobId: string;
    entries: ElectronExportArchiveJobEntry[];
    fileName: string;
    relativeFolder?: string;
    compression?: 'STORE' | 'DEFLATE';
    encryptionPassword?: string;
    returnArchiveBytes?: boolean;
  }) => Promise<ElectronExportArchiveJobResult | null>;
  canUseElectronExportArchiveJob?: boolean;
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
    operationType?: 'create' | 'update';
    assetName: string;
    exportBlob: Blob;
    assetProtection: 'encrypted' | 'public';
  }) => Promise<AdminCatalogUploadPublishResult>;
  isNonRetryableGithubUploadError: (error: unknown) => boolean;
  enqueueAdminExportUpload: (input: EnqueueAdminExportUploadInput) => void;
  writeOperationDiagnosticsLog: (diagnostics: ExportDiagnosticsLike, error: unknown) => Promise<string | null>;
}

export type RunExportAdminBankResult = {
  message: string;
  linkedStoreBank?: {
    bankId: string;
    catalogItemId: string | null;
    title: string;
    description: string;
    thumbnailUrl?: string;
    assetProtection: 'encrypted' | 'public';
  };
};

export const runExportAdminBankPipeline = async (
  input: RunExportAdminBankInput,
  deps: RunExportAdminBankDeps
): Promise<RunExportAdminBankResult> => {
  const {
    id,
    title,
    description,
    addToDatabase,
    allowExport,
    publicCatalogAsset,
    comingSoonOnly = false,
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
    resolvePadMediaSourcePath,
    shouldAttemptTrim,
    trimAudio,
    remapSavedHotcuesForBakedTrim,
    transcodeAudioToMP3,
    detectAudioFormat,
    sha256HexFromBlob,
    sha256HexFromText,
    getElectronBridgeDiagnostics,
    createElectronZipArchive,
    createAndSaveElectronZipArchive,
    stageElectronZipEntry,
    cleanupStagedElectronZipEntries,
    canUseElectronZipArchive,
    runElectronExportArchiveJob,
    canUseElectronExportArchiveJob,
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

  const isHttpUrl = (value: string | null | undefined): value is string =>
    typeof value === 'string' && /^https?:\/\//i.test(value.trim());
  const shouldStoreArchive = isNativeCapacitorPlatform() || exportMode !== 'compact';

  if (!user || profileRole !== 'admin') throw new Error('Only admins can do this action.');
  const bank = banks.find((b) => b.id === id);
  if (!bank) throw new Error('We could not find that bank.');

  const diagnostics = createOperationDiagnostics('admin_bank_export', user.id);
  const stopHeartbeat = startOperationHeartbeat(diagnostics, {
    getDetails: () => ({
      bankId: bank.id,
      bankName: bank.name,
      addToDatabase,
      allowExport,
      publicCatalogAsset,
      comingSoonOnly,
      exportMode,
    }),
  });
  addOperationStage(diagnostics, 'start', {
    bankId: bank.id,
    bankName: bank.name,
    padCount: bank.pads.length,
    addToDatabase,
    allowExport,
    publicCatalogAsset,
    comingSoonOnly,
    transferable: true,
    exportMode,
  });
  const electronBridgeDiagnostics = getElectronBridgeDiagnostics?.();
  if (electronBridgeDiagnostics) {
    addOperationStage(diagnostics, 'electron-bridge', electronBridgeDiagnostics);
  }
  const exportStartedAt = getNowMs();
  let preflightCompletedAt = exportStartedAt;
  let mediaCompletedAt = exportStartedAt;
  let archiveCompletedAt = exportStartedAt;
  let saveCompletedAt = exportStartedAt;
  let exportedArchiveBytes = 0;
  let managedThumbnailCleanup: (() => Promise<void>) | null = null;
  const stagedElectronEntryPaths: string[] = [];

  try {
    onProgress?.(5);
    await ensureExportPermission();

    if (comingSoonOnly) {
      if (!addToDatabase) throw new Error('Coming Soon publish requires Add to Database.');
      addOperationStage(diagnostics, 'coming-soon-start', {
        bankId: bank.id,
        bankName: bank.name,
      });
      const normalizedTitle = (title || bank.name || 'Bank').trim();
      let durableThumbnailPath: string | undefined = isHttpUrl(thumbnailPath) ? thumbnailPath : undefined;
      const { createAdminBankWithDerivedKey } = await import('@/lib/admin-bank-utils');
      const adminBank = await createAdminBankWithDerivedKey(title, description, user.id, bank.defaultColor);
      if (!adminBank) throw new Error('Failed to create admin bank metadata entry.');
      const teaserFileName = `${normalizedTitle.replace(/[^a-z0-9]/gi, '_')}_${adminBank.id}.bank`;
      onProgress?.(25);

      if (thumbnailPath) {
        const managedThumbnail = await ensureManagedStoreThumbnail({
          bankId: adminBank.id,
          thumbnailPath,
          inferImageExtFromPath,
        });
        durableThumbnailPath = managedThumbnail.url;
        managedThumbnailCleanup = managedThumbnail.uploaded ? managedThumbnail.cleanup : null;
        addOperationStage(diagnostics, 'thumbnail-uploaded-for-store', {
          bankId: adminBank.id,
          uploaded: managedThumbnail.uploaded,
          comingSoonOnly: true,
        });
      }

      const { supabase } = await import('@/lib/supabase');
      await supabase
        .from('user_bank_access')
        .upsert({ user_id: user.id, bank_id: adminBank.id }, { onConflict: 'user_id,bank_id' as any });
      onProgress?.(45);

      const storeDraftResponse = await supabase.functions.invoke(`admin-api/store/banks/${adminBank.id}/draft`, {
        method: 'POST',
        body: {
          expected_asset_name: teaserFileName,
          thumbnail_path: durableThumbnailPath,
          asset_protection: publicCatalogAsset ? 'public' : 'encrypted',
          coming_soon: true,
        },
      });
      if (storeDraftResponse.error) {
        throw new Error(storeDraftResponse.error.message || 'Failed to create Store teaser draft.');
      }
      const catalogDraftId = (storeDraftResponse as any)?.data?.item?.id;
      if (typeof catalogDraftId !== 'string' || !catalogDraftId.trim()) {
        throw new Error('Store teaser draft did not return a catalog item id.');
      }
      addOperationStage(diagnostics, 'store-draft-created', {
        catalogItemId: catalogDraftId,
        comingSoonOnly: true,
      });
      onProgress?.(70);

      const publishResponse = await supabase.functions.invoke(`admin-api/store/catalog/${catalogDraftId}/publish`, {
        method: 'POST',
        body: {
          asset_name: teaserFileName,
          coming_soon: true,
        },
      });
      if (publishResponse.error) {
        throw new Error(publishResponse.error.message || 'Failed to publish Coming Soon teaser.');
      }
      addOperationStage(diagnostics, 'store-teaser-published', {
        catalogItemId: catalogDraftId,
        bankId: adminBank.id,
      });
      preflightCompletedAt = getNowMs();
      mediaCompletedAt = preflightCompletedAt;
      archiveCompletedAt = preflightCompletedAt;
      saveCompletedAt = preflightCompletedAt;
      const timing = {
        totalMs: Math.round(saveCompletedAt - exportStartedAt),
        preflightMs: Math.round(preflightCompletedAt - exportStartedAt),
        mediaPrepareMs: 0,
        archiveMs: 0,
        saveMs: 0,
        archiveBytes: 0,
      };
      diagnostics.metrics.exportTotalMs = timing.totalMs;
      diagnostics.metrics.exportPreflightMs = timing.preflightMs;
      diagnostics.metrics.exportMediaPrepareMs = timing.mediaPrepareMs;
      diagnostics.metrics.exportArchiveMs = timing.archiveMs;
      diagnostics.metrics.exportSaveMs = timing.saveMs;
      diagnostics.metrics.archiveBytes = 0;
      addOperationStage(diagnostics, 'timings', timing);
      finishOperationDiagnostics(diagnostics, {
        bankId: adminBank.id,
        bankName: normalizedTitle,
        archiveBytes: 0,
        addToDatabase,
        allowExport,
        publicCatalogAsset,
        comingSoonOnly: true,
      });
      onProgress?.(100);
      return {
        message: 'Coming Soon teaser published successfully.',
        linkedStoreBank: {
          bankId: adminBank.id,
          catalogItemId: catalogDraftId,
          title: normalizedTitle,
          description,
          thumbnailUrl: durableThumbnailPath,
          assetProtection: publicCatalogAsset ? 'public' : 'encrypted',
        },
      };
    }

    const estimatedBytes = await estimateBankMediaBytes(bank);
    diagnostics.metrics.estimatedBytes = estimatedBytes;
    addOperationStage(diagnostics, 'preflight', { estimatedBytes, comingSoonOnly: false });

    if (isNativeCapacitorPlatform() && estimatedBytes > maxNativeBankExportBytes) {
      throw new Error(
        `Admin bank export is too large for mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Reduce bank size and try again.`
      );
    }

    await ensureStorageHeadroom(Math.ceil(estimatedBytes * 0.35), 'admin bank export');
    preflightCompletedAt = getNowMs();

    const canUseElectronFastArchive =
      canUseElectronZipArchive === true &&
      typeof createElectronZipArchive === 'function' &&
      (publicCatalogAsset || (!addToDatabase && allowExport));
    const canUseElectronArchiveJob =
      canUseElectronExportArchiveJob === true &&
      typeof runElectronExportArchiveJob === 'function' &&
      typeof stageElectronZipEntry === 'function';
    const zip = canUseElectronFastArchive ? null : new JSZip();
    const audioFolder = zip?.folder('audio');
    const imageFolder = zip?.folder('images');
    if (!canUseElectronFastArchive && (!audioFolder || !imageFolder)) {
      throw new Error('Could not prepare files for export.');
    }
    const electronArchiveEntries: ElectronArchiveEntry[] | null = canUseElectronFastArchive ? [] : null;
    const electronArchiveJobEntries: ElectronExportArchiveJobEntry[] | null = canUseElectronArchiveJob ? [] : null;
    const pushElectronArchiveBlob = async (
      archivePath: string,
      blob: Blob,
      fileName?: string
    ): Promise<void> => {
      if (!electronArchiveEntries) return;
      if (typeof stageElectronZipEntry === 'function') {
        const stagedEntry = await stageElectronZipEntry({ archivePath, blob, fileName });
        if (stagedEntry?.sourcePath) {
          stagedElectronEntryPaths.push(stagedEntry.sourcePath);
          electronArchiveEntries.push({
            path: archivePath,
            sourcePath: stagedEntry.sourcePath,
            cleanupSourcePath: true,
          });
          return;
        }
      }
      electronArchiveEntries.push({
        path: archivePath,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    };
    const stageElectronArchiveSource = async (
      archivePath: string,
      blob: Blob,
      fileName?: string
    ): Promise<string> => {
      const stagedEntry = await stageElectronZipEntry!({ archivePath, blob, fileName });
      if (!stagedEntry?.sourcePath) {
        throw new Error(`Electron export staging failed for ${archivePath}.`);
      }
      stagedElectronEntryPaths.push(stagedEntry.sourcePath);
      return stagedEntry.sourcePath;
    };

    const totalMediaItems = Math.max(
      1,
      bank.pads.reduce(
        (count, pad) => count + (padHasExpectedAudioAsset(pad) ? 1 : 0) + (padHasExpectedImageAsset(pad) ? 1 : 0),
        0
      )
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
      ...stripPreparedAudioForExport(pad),
      audioUrl: undefined as string | undefined,
      imageUrl: undefined as string | undefined,
    }));
    const exportPadMap = new Map(exportPads.map((pad) => [pad.id, pad]));
    const resolveAudioExportSignature = async (input: {
      sourceHash: string;
      mode: ExportAudioMode;
      shouldBakeTrim: boolean;
      startTimeMs?: number;
      endTimeMs?: number;
    }): Promise<string> => {
      if (input.mode === 'fast' && !input.shouldBakeTrim) return input.sourceHash;
      return await sha256HexFromText(
        JSON.stringify({
          sourceHash: input.sourceHash,
          mode: input.mode,
          shouldBakeTrim: input.shouldBakeTrim,
          startTimeMs: input.startTimeMs || 0,
          endTimeMs: input.endTimeMs || 0,
        })
      );
    };

    for (const pad of bank.pads) {
      if (padHasExpectedAudioAsset(pad)) {
        const exportPad = exportPadMap.get(pad.id);
        const directAudioSourcePath =
          electronArchiveJobEntries && typeof resolvePadMediaSourcePath === 'function'
            ? await resolvePadMediaSourcePath(pad, 'audio')
            : null;
        const sourceBlob =
          !electronArchiveJobEntries || !directAudioSourcePath
            ? await loadPadMediaBlob(pad, 'audio')
            : null;
        if (sourceBlob || directAudioSourcePath) {
          const shouldBakeTrim = shouldAttemptTrim(pad, 'compact');
          const sourceHash = directAudioSourcePath
            ? await sha256HexFromText((typeof pad.audioStorageKey === 'string' && pad.audioStorageKey.trim()) || directAudioSourcePath)
            : await sha256HexFromBlob(sourceBlob!);
          let audioBlob = sourceBlob;
          if (exportMode === 'trim_mp3') {
            if (exportPad && shouldBakeTrim) {
              exportPad.startTimeMs = 0;
              exportPad.endTimeMs = Math.max(0, (pad.endTimeMs || 0) - (pad.startTimeMs || 0));
              exportPad.savedHotcuesMs = remapSavedHotcuesForBakedTrim(
                pad.savedHotcuesMs,
                pad.startTimeMs,
                exportPad.endTimeMs
              );
            }
            if (!electronArchiveJobEntries && sourceBlob) {
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
                outputBytes: audioBlob?.size || 0,
                bitrate: 128,
              });
            } else {
              addOperationStage(diagnostics, shouldBakeTrim ? 'audio-trim-mp3-queued' : 'audio-mp3-queued', {
                padId: pad.id,
                padName: pad.name || 'Untitled Pad',
                originalBytes: sourceBlob?.size,
                bitrate: 128,
              });
            }
          } else if (shouldAttemptTrim(pad, exportMode)) {
            if (!electronArchiveJobEntries && sourceBlob) {
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
                  trimmedBytes: audioBlob?.size || 0,
                });
              } catch (trimError) {
                addOperationStage(diagnostics, 'audio-trim-fallback', {
                  padId: pad.id,
                  padName: pad.name || 'Untitled Pad',
                  reason: trimError instanceof Error ? trimError.message : String(trimError),
                });
              }
            } else {
              if (exportPad) {
                exportPad.startTimeMs = 0;
                exportPad.endTimeMs = Math.max(0, (pad.endTimeMs || 0) - (pad.startTimeMs || 0));
                exportPad.savedHotcuesMs = remapSavedHotcuesForBakedTrim(
                  pad.savedHotcuesMs,
                  pad.startTimeMs,
                  exportPad.endTimeMs
                );
              }
              addOperationStage(diagnostics, 'audio-trim-queued', {
                padId: pad.id,
                padName: pad.name || 'Untitled Pad',
                originalBytes: sourceBlob?.size,
              });
            }
          }
          if (electronArchiveJobEntries) {
            const archiveHash = await resolveAudioExportSignature({
              sourceHash,
              mode: exportMode,
              shouldBakeTrim: exportMode === 'trim_mp3' ? shouldBakeTrim : shouldAttemptTrim(pad, exportMode),
              startTimeMs: pad.startTimeMs,
              endTimeMs: pad.endTimeMs,
            });
            const existingAudioPath = audioHashToPath.get(archiveHash);
            if (existingAudioPath) {
              dedupedAudioReuses += 1;
              if (exportPad) exportPad.audioUrl = existingAudioPath;
            } else {
              const fileName = `${archiveHash}.audio`;
              const archivePath = `audio/${fileName}`;
              const stagedSourcePath = directAudioSourcePath || await stageElectronArchiveSource(archivePath, sourceBlob!, fileName);
              electronArchiveJobEntries.push({
                kind: 'audio',
                path: archivePath,
                sourcePath: stagedSourcePath,
                mimeType: sourceBlob?.type,
                transform: exportMode === 'trim_mp3' ? 'trim_mp3' : (shouldAttemptTrim(pad, exportMode) ? 'trim' : 'copy'),
                startTimeMs: shouldBakeTrim ? pad.startTimeMs : undefined,
                endTimeMs: shouldBakeTrim ? pad.endTimeMs : undefined,
                bitrate: exportMode === 'trim_mp3' ? 128 : undefined,
                cleanupSourcePath: !directAudioSourcePath,
              });
              audioHashToPath.set(archiveHash, archivePath);
              if (exportPad) exportPad.audioUrl = archivePath;
              uniqueExportBytes += sourceBlob?.size || Math.max(0, Number(pad.audioBytes || 0));
            }
          } else if (electronArchiveEntries) {
            const audioHash = await sha256HexFromBlob(audioBlob!);
            const existingAudioPath = audioHashToPath.get(audioHash);
            if (existingAudioPath) {
              dedupedAudioReuses += 1;
              if (exportPad) exportPad.audioUrl = existingAudioPath;
            } else {
              const fileName = `${audioHash}.audio`;
              const path = `audio/${fileName}`;
              await pushElectronArchiveBlob(path, audioBlob!, fileName);
              audioHashToPath.set(audioHash, path);
              if (exportPad) exportPad.audioUrl = path;
              uniqueExportBytes += audioBlob?.size || 0;
            }
          } else {
            const audioHash = await sha256HexFromBlob(audioBlob!);
            const existingAudioPath = audioHashToPath.get(audioHash);
            if (existingAudioPath) {
              dedupedAudioReuses += 1;
              if (exportPad) exportPad.audioUrl = existingAudioPath;
            } else {
              const fileName = `${audioHash}.audio`;
              audioFolder.file(fileName, audioBlob!);
              const path = `audio/${fileName}`;
              audioHashToPath.set(audioHash, path);
              if (exportPad) exportPad.audioUrl = path;
              uniqueExportBytes += audioBlob?.size || 0;
            }
          }
          if (isNativeCapacitorPlatform() && uniqueExportBytes > maxNativeBankExportBytes) {
            throw new Error('This bank is too large to export on mobile. Try desktop export.');
          }
          exportedAudio += 1;
          totalExportBytes += audioBlob?.size || sourceBlob?.size || Math.max(0, Number(pad.audioBytes || 0));
        }
        processedItems += 1;
        onProgress?.(10 + (processedItems / totalMediaItems) * 45);
        if (processedItems % 8 === 0) await yieldToMainThread();
      }

      if (padHasExpectedImageAsset(pad)) {
        const exportPad = exportPadMap.get(pad.id);
        const directImageSourcePath =
          electronArchiveJobEntries && typeof resolvePadMediaSourcePath === 'function'
            ? await resolvePadMediaSourcePath(pad, 'image')
            : null;
        const imageBlob =
          !electronArchiveJobEntries || !directImageSourcePath
            ? await loadPadMediaBlob(pad, 'image')
            : null;
        if (imageBlob || directImageSourcePath) {
          if (electronArchiveJobEntries) {
            const imageHash = directImageSourcePath
              ? await sha256HexFromText((typeof pad.imageStorageKey === 'string' && pad.imageStorageKey.trim()) || directImageSourcePath)
              : await sha256HexFromBlob(imageBlob!);
            const existingImagePath = imageHashToPath.get(imageHash);
            if (existingImagePath) {
              dedupedImageReuses += 1;
              if (exportPad) exportPad.imageUrl = existingImagePath;
            } else {
              const fileName = `${imageHash}.image`;
              const archivePath = `images/${fileName}`;
              const stagedSourcePath = directImageSourcePath || await stageElectronArchiveSource(archivePath, imageBlob!, fileName);
              electronArchiveJobEntries.push({
                kind: 'raw',
                path: archivePath,
                sourcePath: stagedSourcePath,
                cleanupSourcePath: !directImageSourcePath,
              });
              imageHashToPath.set(imageHash, archivePath);
              if (exportPad) exportPad.imageUrl = archivePath;
              uniqueExportBytes += imageBlob?.size || 0;
            }
          } else if (electronArchiveEntries) {
            const imageHash = await sha256HexFromBlob(imageBlob!);
            const existingImagePath = imageHashToPath.get(imageHash);
            if (existingImagePath) {
              dedupedImageReuses += 1;
              if (exportPad) exportPad.imageUrl = existingImagePath;
            } else {
              const fileName = `${imageHash}.image`;
              const path = `images/${fileName}`;
              await pushElectronArchiveBlob(path, imageBlob!, fileName);
              imageHashToPath.set(imageHash, path);
              if (exportPad) exportPad.imageUrl = path;
              uniqueExportBytes += imageBlob?.size || 0;
            }
          } else {
            const imageHash = await sha256HexFromBlob(imageBlob!);
            const existingImagePath = imageHashToPath.get(imageHash);
            if (existingImagePath) {
              dedupedImageReuses += 1;
              if (exportPad) exportPad.imageUrl = existingImagePath;
            } else {
              const fileName = `${imageHash}.image`;
              imageFolder.file(fileName, imageBlob!);
              const path = `images/${fileName}`;
              imageHashToPath.set(imageHash, path);
              if (exportPad) exportPad.imageUrl = path;
              uniqueExportBytes += imageBlob?.size || 0;
            }
          }
          if (isNativeCapacitorPlatform() && uniqueExportBytes > maxNativeBankExportBytes) {
            throw new Error('This bank is too large to export on mobile. Try desktop export.');
          }
          exportedImages += 1;
          totalExportBytes += imageBlob?.size || 0;
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

    const bankData = {
      ...bank,
      createdAt: bank.createdAt.toISOString(),
      pads: exportPads,
    };
    const bankJsonText = JSON.stringify(bankData, null, 2);
    if (electronArchiveJobEntries) {
      electronArchiveJobEntries.push({
        kind: 'raw',
        path: 'bank.json',
        data: encodeTextToUint8Array(bankJsonText),
      });
    } else if (electronArchiveEntries) {
      electronArchiveEntries.push({
        path: 'bank.json',
        data: encodeTextToUint8Array(bankJsonText),
      });
    } else {
      zip.file('bank.json', bankJsonText);
    }
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
            if (electronArchiveJobEntries) {
              const stagedSourcePath = await stageElectronArchiveSource(
                embeddedThumbnailAssetPath,
                thumbnailBlob,
                `bank-thumbnail.${ext}`
              );
              electronArchiveJobEntries.push({
                kind: 'raw',
                path: embeddedThumbnailAssetPath,
                sourcePath: stagedSourcePath,
                cleanupSourcePath: true,
              });
            } else if (electronArchiveEntries) {
              await pushElectronArchiveBlob(embeddedThumbnailAssetPath, thumbnailBlob, `bank-thumbnail.${ext}`);
            } else {
              zip.file(embeddedThumbnailAssetPath, thumbnailBlob);
            }
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
    let preSavedJobResult: ElectronExportArchiveJobResult | null = null;
    let catalogDraftId: string | null = null;
    let uploadBankId = bank.id;
    let signedTokenWarningMessage = '';
    let durableThumbnailPath: string | undefined = isHttpUrl(thumbnailPath) ? thumbnailPath : undefined;

    if (addToDatabase) {
      addOperationStage(diagnostics, 'db-create');
      const { createAdminBankWithDerivedKey } = await import('@/lib/admin-bank-utils');
      const adminBank = await createAdminBankWithDerivedKey(title, description, user.id, bank.defaultColor);
      if (!adminBank) throw new Error('Failed to create admin bank metadata entry.');
      uploadBankId = adminBank.id;
      fileName = `${normalizedTitle.replace(/[^a-z0-9]/gi, '_')}_${adminBank.id}.bank`;

      if (thumbnailPath) {
        const managedThumbnail = await ensureManagedStoreThumbnail({
          bankId: adminBank.id,
          thumbnailPath,
          inferImageExtFromPath,
        });
        durableThumbnailPath = managedThumbnail.url;
        managedThumbnailCleanup = managedThumbnail.uploaded ? managedThumbnail.cleanup : null;
        addOperationStage(diagnostics, 'thumbnail-uploaded-for-store', {
          bankId: adminBank.id,
          uploaded: managedThumbnail.uploaded,
        });
      }

      const metadata = {
        password: !publicCatalogAsset,
        transferable: true,
        exportable: false,
        title,
        description,
        color: bank.defaultColor,
        bankId: adminBank.id,
        thumbnailUrl: durableThumbnailPath,
        thumbnailAssetPath: embeddedThumbnailAssetPath,
        hideThumbnailPreview: bank.bankMetadata?.hideThumbnailPreview,
      };
      if (electronArchiveJobEntries) {
        electronArchiveJobEntries.push({
          kind: 'raw',
          path: 'metadata.json',
          data: encodeTextToUint8Array(JSON.stringify(metadata, null, 2)),
        });
      } else if (electronArchiveEntries) {
        electronArchiveEntries.push({
          path: 'metadata.json',
          data: encodeTextToUint8Array(JSON.stringify(metadata, null, 2)),
        });
      } else {
        addBankMetadata(zip, metadata);
      }

      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase
          .from('user_bank_access')
          .upsert({ user_id: user.id, bank_id: adminBank.id }, { onConflict: 'user_id,bank_id' as any });

        const storeDraftResponse = await supabase.functions.invoke(`admin-api/store/banks/${adminBank.id}/draft`, {
          method: 'POST',
          body: {
            expected_asset_name: fileName,
            thumbnail_path: durableThumbnailPath,
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
        if (electronArchiveJobEntries && typeof runElectronExportArchiveJob === 'function') {
          const jobResult = await runElectronExportArchiveJob({
            jobId: diagnostics.operationId,
            entries: electronArchiveJobEntries,
            fileName,
            compression: 'STORE',
            returnArchiveBytes: true,
          });
          if (!jobResult?.archiveData) {
            throw new Error('Electron export job returned no archive data.');
          }
          preSavedJobResult = jobResult;
          outputBlob = new Blob([jobResult.archiveData], { type: 'application/zip' });
        } else if (electronArchiveEntries) {
          const archiveBytes = await createElectronZipArchive!({
            entries: electronArchiveEntries,
            compression: 'STORE',
          });
          if (!archiveBytes) {
            throw new Error('Electron archive generation returned no data.');
          }
          outputBlob = new Blob([archiveBytes], { type: 'application/zip' });
        } else {
          outputBlob = shouldStoreArchive
            ? await zip.generateAsync(
            {
              type: 'blob',
              compression: 'STORE',
              streamFiles: true,
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          )
          : await zip.generateAsync(
            {
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: 5 },
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          );
        }
      } else {
        if (electronArchiveJobEntries && typeof runElectronExportArchiveJob === 'function') {
          const jobResult = await runElectronExportArchiveJob({
            jobId: diagnostics.operationId,
            entries: electronArchiveJobEntries,
            fileName,
            compression: 'STORE',
            encryptionPassword: adminBank.derived_key,
            returnArchiveBytes: true,
          });
          if (!jobResult?.archiveData) {
            throw new Error('Electron export job returned no encrypted archive data.');
          }
          preSavedJobResult = jobResult;
          outputBlob = new Blob([jobResult.archiveData], { type: 'application/octet-stream' });
        } else {
          outputBlob = await encryptZip(zip, adminBank.derived_key);
        }
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

      const metadata = {
        password: !allowExport,
        transferable: true,
        exportable: allowExport,
        title,
        description,
        color: bank.defaultColor,
        thumbnailUrl: durableThumbnailPath,
        thumbnailAssetPath: embeddedThumbnailAssetPath,
        hideThumbnailPreview: bank.bankMetadata?.hideThumbnailPreview,
        adminExportToken: signedAdminExportToken?.token,
        adminExportTokenKid: signedAdminExportToken?.keyId || undefined,
        adminExportTokenIssuedAt: signedAdminExportToken?.issuedAt || undefined,
        adminExportTokenExpiresAt: signedAdminExportToken?.expiresAt || undefined,
        adminExportTokenBankSha256: signedAdminExportToken?.bankJsonSha256 || bankJsonSha256 || undefined,
      };
      if (electronArchiveJobEntries) {
        electronArchiveJobEntries.push({
          kind: 'raw',
          path: 'metadata.json',
          data: encodeTextToUint8Array(JSON.stringify(metadata, null, 2)),
        });
      } else if (electronArchiveEntries) {
        electronArchiveEntries.push({
          path: 'metadata.json',
          data: encodeTextToUint8Array(JSON.stringify(metadata, null, 2)),
        });
      } else {
        addBankMetadata(zip, metadata);
      }

      if (!allowExport) {
        onProgress?.(65);
        if (electronArchiveJobEntries && typeof runElectronExportArchiveJob === 'function') {
          const jobResult = await runElectronExportArchiveJob({
            jobId: diagnostics.operationId,
            entries: electronArchiveJobEntries,
            fileName,
            compression: 'STORE',
            encryptionPassword: sharedExportDisabledPassword,
          });
          archiveCompletedAt = getNowMs();
          if (!jobResult) {
            throw new Error('Electron export job returned no data.');
          }
          exportedArchiveBytes = jobResult.archiveBytes;
          addOperationStage(diagnostics, 'saved', { path: jobResult.savedPath || fileName });
          saveCompletedAt = archiveCompletedAt;
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
          finishOperationDiagnostics(diagnostics, {
            bankId: uploadBankId,
            bankName: normalizedTitle,
            archiveBytes: exportedArchiveBytes,
            addToDatabase,
            allowExport,
            publicCatalogAsset,
          });
          onProgress?.(100);
          return {
            message: `${jobResult.message || 'Admin bank exported successfully.'}${signedTokenWarningMessage}`,
          };
        }
        outputBlob = await encryptZip(zip, sharedExportDisabledPassword);
        onProgress?.(88);
        archiveCompletedAt = getNowMs();
      } else {
        addOperationStage(diagnostics, 'archive-generate');
        onProgress?.(65);
        if (electronArchiveJobEntries && typeof runElectronExportArchiveJob === 'function') {
          const saveResult = await runElectronExportArchiveJob({
            jobId: diagnostics.operationId,
            entries: electronArchiveJobEntries,
            fileName,
            compression: 'STORE',
          });
          archiveCompletedAt = getNowMs();
          if (!saveResult) {
            throw new Error('Electron export job returned no data.');
          }
          exportedArchiveBytes = saveResult.archiveBytes;
          addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
          saveCompletedAt = archiveCompletedAt;
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
          finishOperationDiagnostics(diagnostics, {
            bankId: uploadBankId,
            bankName: normalizedTitle,
            archiveBytes: exportedArchiveBytes,
            addToDatabase,
            allowExport,
            publicCatalogAsset,
          });
          onProgress?.(100);
          return {
            message: `${saveResult.message || 'Admin bank exported successfully.'}${signedTokenWarningMessage}`,
          };
        }
        if (electronArchiveEntries && typeof createAndSaveElectronZipArchive === 'function') {
          const saveResult = await createAndSaveElectronZipArchive({
            entries: electronArchiveEntries,
            fileName,
            compression: 'STORE',
          });
          archiveCompletedAt = getNowMs();
          if (!saveResult) {
            throw new Error('Electron archive save returned no data.');
          }
          exportedArchiveBytes = saveResult.archiveBytes;
          addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
          saveCompletedAt = archiveCompletedAt;
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
          finishOperationDiagnostics(diagnostics, {
            bankId: uploadBankId,
            bankName: normalizedTitle,
            archiveBytes: exportedArchiveBytes,
            addToDatabase,
            allowExport,
            publicCatalogAsset,
          });
          onProgress?.(100);
          return {
            message: `${saveResult.message || 'Admin bank exported successfully.'}${signedTokenWarningMessage}`,
          };
        }
        if (electronArchiveEntries) {
          const archiveBytes = await createElectronZipArchive!({
            entries: electronArchiveEntries,
            compression: 'STORE',
          });
          if (!archiveBytes) {
            throw new Error('Electron archive generation returned no data.');
          }
          outputBlob = new Blob([archiveBytes], { type: 'application/zip' });
        } else {
          outputBlob = shouldStoreArchive
            ? await zip.generateAsync(
            {
              type: 'blob',
              compression: 'STORE',
              streamFiles: true,
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          )
          : await zip.generateAsync(
            {
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: 5 },
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          );
        }
        archiveCompletedAt = getNowMs();
      }
    }

    exportedArchiveBytes = outputBlob.size;

    const saveResult = preSavedJobResult
      ? {
          success: true,
          savedPath: preSavedJobResult.savedPath,
          message: preSavedJobResult.message,
        }
      : await saveExportFile(outputBlob, fileName);
    if (!saveResult.success) {
      throw new Error(saveResult.message || 'Failed to save admin bank export.');
    }
    addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
    saveCompletedAt = preSavedJobResult ? archiveCompletedAt : getNowMs();
    let uploadWarningMessage = '';
    if (addToDatabase) {
      if (catalogDraftId) {
        try {
          onProgress?.(95);
          const uploadResult = await uploadAdminCatalogAsset({
            catalogItemId: catalogDraftId,
            operationType: 'create',
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
              operationType: 'create',
              fileName,
              assetName: fileName,
              assetProtection: publicCatalogAsset ? 'public' : 'encrypted',
              exportAudioMode: exportMode,
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
    finishOperationDiagnostics(diagnostics, {
      bankId: bank.id,
      bankName: bank.name,
      archiveBytes: exportedArchiveBytes,
      addToDatabase,
      allowExport,
      publicCatalogAsset,
    });
    onProgress?.(100);
    return {
      message: `${saveResult.message || 'Admin bank exported successfully.'}${uploadWarningMessage}${signedTokenWarningMessage}`,
      linkedStoreBank: addToDatabase
        ? {
            bankId: uploadBankId,
            catalogItemId: catalogDraftId,
            title: normalizedTitle,
            description,
            thumbnailUrl: durableThumbnailPath,
            assetProtection: publicCatalogAsset ? 'public' : 'encrypted',
          }
        : undefined,
    };
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
    failOperationDiagnostics(diagnostics, error, {
      bankId: bank.id,
      bankName: bank.name,
      archiveBytes: exportedArchiveBytes,
      addToDatabase,
      allowExport,
      publicCatalogAsset,
    });
    const errorMessage = error instanceof Error ? error.message : String(error);
    const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
    throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
  } finally {
    if (typeof cleanupStagedElectronZipEntries === 'function' && stagedElectronEntryPaths.length > 0) {
      await cleanupStagedElectronZipEntries(stagedElectronEntryPaths).catch(() => undefined);
    }
    stopHeartbeat();
  }
};
