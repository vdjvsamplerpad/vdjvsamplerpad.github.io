import type { PrepareUserExportUploadResult } from './useSamplerStore.exportUpload';
import type { ExportAudioMode } from './useSamplerStore.types';
import { deleteBlobFromDB, getBlobFromDB, saveBlobToDB } from './useSamplerStore.idbStorage';

export interface UserExportUploadJob {
  exportOperationId: string;
  userId: string;
  bankId: string;
  bankName: string;
  fileName: string;
  fileSize: number;
  fileSha256: string | null;
  createdAt: string;
  nextRetryAt: number;
  attempts: number;
  maxAttempts: number;
  padNames: string[];
}

export interface AdminExportUploadJob {
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
  createdAt: string;
  nextRetryAt: number;
  attempts: number;
  maxAttempts: number;
  padNames: string[];
}

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

type QueueSetter<T> = (updater: (prev: T[]) => T[]) => void;

type LogExportActivityFn = (input: {
  status: 'success' | 'failed';
  phase: 'requested' | 'local_export' | 'remote_upload' | 'backup_export' | 'backup_restore' | 'media_recovery';
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

type UploadUserAssetFn = (input: {
  exportOperationId: string;
  sessionId: string;
  uploadUrl: string;
  uploadMethod?: string | null;
  uploadHeaders?: Record<string, string> | null;
  bucket?: string | null;
  objectKey?: string | null;
  releaseTag: string;
  releaseId: number;
  assetName: string;
  exportBlob: Blob;
}) => Promise<{ releaseTag: string; releaseId: number; assetName: string; fileSize: number; etag: string | null }>;

type UploadAdminAssetFn = (input: {
  catalogItemId: string;
  operationType?: 'create' | 'update';
  assetName: string;
  exportBlob: Blob;
  assetProtection: 'encrypted' | 'public';
}) => Promise<{ releaseTag?: string | null; assetName: string; fileSize: number }>;

const getRetryBlobStorageId = (scope: 'user' | 'admin', exportOperationId: string): string =>
  `upload_retry_${scope}_${exportOperationId}`;

export const getUserExportJobBlob = async (
  job: UserExportUploadJob,
  blobCacheRef: { current: Map<string, Blob> },
  isNativeCapacitorPlatform: () => boolean,
  readNativeExportBackupFileByName: (fileName: string) => Promise<File | null>
): Promise<Blob | null> => {
  const cached = blobCacheRef.current.get(job.exportOperationId);
  if (cached) return cached;
  const persisted = await getBlobFromDB(getRetryBlobStorageId('user', job.exportOperationId));
  if (persisted) {
    blobCacheRef.current.set(job.exportOperationId, persisted);
    return persisted;
  }
  if (!isNativeCapacitorPlatform()) return null;
  const nativeFile = await readNativeExportBackupFileByName(job.fileName);
  if (!nativeFile) return null;
  return nativeFile;
};

export const getAdminExportJobBlob = async (
  job: AdminExportUploadJob,
  blobCacheRef: { current: Map<string, Blob> },
  isNativeCapacitorPlatform: () => boolean,
  readNativeExportBackupFileByName: (fileName: string) => Promise<File | null>
): Promise<Blob | null> => {
  const cached = blobCacheRef.current.get(job.exportOperationId);
  if (cached) return cached;
  const persisted = await getBlobFromDB(getRetryBlobStorageId('admin', job.exportOperationId));
  if (persisted) {
    blobCacheRef.current.set(job.exportOperationId, persisted);
    return persisted;
  }
  if (!isNativeCapacitorPlatform()) return null;
  const nativeFile = await readNativeExportBackupFileByName(job.fileName);
  if (!nativeFile) return null;
  return nativeFile;
};

export const enqueueUserExportUploadJob = (
  input: {
    exportOperationId: string;
    userId: string;
    bankId: string;
    bankName: string;
    fileName: string;
    fileSize: number;
    fileSha256: string | null;
    padNames: string[];
    blob: Blob;
  },
  options: {
    maxAttempts: number;
    blobCacheRef: { current: Map<string, Blob> };
    setQueue: QueueSetter<UserExportUploadJob>;
  }
): void => {
  const now = Date.now();
  const nextJob: UserExportUploadJob = {
    exportOperationId: input.exportOperationId,
    userId: input.userId,
    bankId: input.bankId,
    bankName: input.bankName,
    fileName: input.fileName,
    fileSize: input.fileSize,
    fileSha256: input.fileSha256,
    createdAt: new Date(now).toISOString(),
    nextRetryAt: now,
    attempts: 0,
    maxAttempts: options.maxAttempts,
    padNames: input.padNames.slice(0, 500),
  };
  options.blobCacheRef.current.set(nextJob.exportOperationId, input.blob);
  void saveBlobToDB(getRetryBlobStorageId('user', nextJob.exportOperationId), input.blob, false).catch(() => undefined);
  options.setQueue((prev) => {
    const others = prev.filter((job) => job.exportOperationId !== nextJob.exportOperationId);
    return [...others, nextJob];
  });
};

export const enqueueAdminExportUploadJob = (
  input: {
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
  },
  options: {
    maxAttempts: number;
    blobCacheRef: { current: Map<string, Blob> };
    setQueue: QueueSetter<AdminExportUploadJob>;
  }
): void => {
  const now = Date.now();
  let staleJobs: AdminExportUploadJob[] = [];
  const nextJob: AdminExportUploadJob = {
    exportOperationId: input.exportOperationId,
    userId: input.userId,
      bankId: input.bankId,
      bankName: input.bankName,
      catalogItemId: input.catalogItemId,
      operationType: input.operationType,
      fileName: input.fileName,
      assetName: input.assetName,
    assetProtection: input.assetProtection,
    exportAudioMode: input.exportAudioMode,
    fileSize: input.fileSize,
    fileSha256: input.fileSha256,
    createdAt: new Date(now).toISOString(),
    nextRetryAt: now,
    attempts: 0,
    maxAttempts: options.maxAttempts,
    padNames: input.padNames.slice(0, 500),
  };
  options.blobCacheRef.current.set(nextJob.exportOperationId, input.blob);
  void saveBlobToDB(getRetryBlobStorageId('admin', nextJob.exportOperationId), input.blob, false).catch(() => undefined);
  options.setQueue((prev) => {
    staleJobs = input.operationType === 'update'
      ? prev.filter((job) => job.catalogItemId === nextJob.catalogItemId && job.operationType === 'update')
      : prev.filter((job) => job.exportOperationId === nextJob.exportOperationId);
    const staleIds = new Set(staleJobs.map((job) => job.exportOperationId));
    staleIds.add(nextJob.exportOperationId);
    const others = prev.filter((job) => !staleIds.has(job.exportOperationId));
    return [...others, nextJob];
  });
  staleJobs.forEach((job) => {
    options.blobCacheRef.current.delete(job.exportOperationId);
    void deleteBlobFromDB(getRetryBlobStorageId('admin', job.exportOperationId), false).catch(() => undefined);
  });
};

export const processUserExportUploadQueueOnce = async (params: {
  profileRole?: string | null;
  user: { id: string } | null;
  getCachedUser: () => { id: string } | null;
  queueRef: { current: UserExportUploadJob[] };
  processingRef: { current: boolean };
  blobCacheRef: { current: Map<string, Blob> };
  setQueue: QueueSetter<UserExportUploadJob>;
  isNativeCapacitorPlatform: () => boolean;
  readNativeExportBackupFileByName: (fileName: string) => Promise<File | null>;
  invokeUserExportApi: <T,>(route: string, body: Record<string, unknown>) => Promise<T>;
  coerceUploadHeaders: (value: unknown) => Record<string, string>;
  uploadUserExportAsset: UploadUserAssetFn;
  isNonRetryableGithubUploadError: (error: unknown) => boolean;
  computeUploadRetryAt: (attempts: number) => number;
  userExportUploadMaxAgeMs: number;
  logExportActivity: LogExportActivityFn;
}): Promise<void> => {
  if (params.processingRef.current) return;
  if (params.profileRole === 'admin') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const effectiveUser = params.user || params.getCachedUser();
  if (!effectiveUser?.id) return;

  const now = Date.now();
  const availableJobs = params.queueRef.current
    .filter((job) => job.userId === effectiveUser.id)
    .filter((job) => now - new Date(job.createdAt).getTime() <= params.userExportUploadMaxAgeMs)
    .sort((a, b) => a.nextRetryAt - b.nextRetryAt);
  const currentJob = availableJobs[0];
  if (!currentJob) return;
  if (currentJob.nextRetryAt > now) return;

  params.processingRef.current = true;
  let preparedUpload: PrepareUserExportUploadResult | null = null;
  try {
    const exportBlob = await getUserExportJobBlob(
      currentJob,
      params.blobCacheRef,
      params.isNativeCapacitorPlatform,
      params.readNativeExportBackupFileByName
    );
    if (!exportBlob) {
      throw new Error('Export file is no longer available for upload retry.');
    }

    const attemptNumber = currentJob.attempts + 1;
    const prepare = await params.invokeUserExportApi<PrepareUserExportUploadResult>('prepare-upload', {
      exportOperationId: currentJob.exportOperationId,
      bankId: currentJob.bankId,
      bankName: currentJob.bankName,
      fileName: currentJob.fileName,
      fileSize: currentJob.fileSize,
      fileSha256: currentJob.fileSha256,
    });
    preparedUpload = prepare;

    if (prepare.skipUpload) {
      const releaseTag = typeof prepare.releaseTag === 'string' ? prepare.releaseTag : '';
      const assetName = typeof prepare.assetName === 'string' ? prepare.assetName : '';
      const skipReason = String(prepare.skipReason || 'already_uploaded');

      params.blobCacheRef.current.delete(currentJob.exportOperationId);
      void deleteBlobFromDB(getRetryBlobStorageId('user', currentJob.exportOperationId), false).catch(() => undefined);
      params.setQueue((prev) => prev.filter((job) => job.exportOperationId !== currentJob.exportOperationId));

      params.logExportActivity({
        status: 'success',
        phase: 'remote_upload',
        bankId: currentJob.bankId,
        bankName: currentJob.bankName,
        padNames: currentJob.padNames,
        exportOperationId: currentJob.exportOperationId,
        upload: {
          releaseTag: releaseTag || null,
          assetName: assetName || null,
          attempt: attemptNumber,
          result: skipReason === 'no_change_hash' ? 'duplicate_no_change' : 'success',
          verified: false,
          reason: skipReason,
          fileSize: currentJob.fileSize,
          fileSha256: currentJob.fileSha256,
          duplicateOfExportOperationId: prepare.duplicateOfExportOperationId || null,
        },
      });
      return;
    }

    if (!prepare.sessionId || !prepare.uploadUrl) {
      throw new Error('Missing direct upload target from prepare-upload.');
    }
    const targetReleaseTag = typeof prepare.releaseTag === 'string' ? prepare.releaseTag : '';
    const targetReleaseId = Number(prepare.releaseId || 0);
    const targetAssetName = typeof prepare.assetName === 'string'
      ? prepare.assetName
      : (typeof prepare.objectKey === 'string' ? prepare.objectKey.split('/').filter(Boolean).pop() || currentJob.fileName : currentJob.fileName);
    const targetSessionId = String(prepare.sessionId);
    const targetUploadUrl = String(prepare.uploadUrl);
    const targetUploadMethod = typeof prepare.uploadMethod === 'string' ? prepare.uploadMethod : 'PUT';
    const targetUploadHeaders = params.coerceUploadHeaders(prepare.uploadHeaders);
    const targetBucket = typeof prepare.bucket === 'string' ? prepare.bucket : null;
    const targetObjectKey = typeof prepare.objectKey === 'string' ? prepare.objectKey : null;

    const uploadResult = await params.uploadUserExportAsset({
      exportOperationId: currentJob.exportOperationId,
      sessionId: targetSessionId,
      uploadUrl: targetUploadUrl,
      uploadMethod: targetUploadMethod,
      uploadHeaders: targetUploadHeaders,
      bucket: targetBucket,
      objectKey: targetObjectKey,
      releaseTag: targetReleaseTag,
      releaseId: targetReleaseId,
      assetName: targetAssetName,
      exportBlob,
    });

    const report = await params.invokeUserExportApi<any>('complete-upload', {
      sessionId: targetSessionId,
      exportOperationId: currentJob.exportOperationId,
      status: 'success',
      attempt: attemptNumber,
      fileSha256: currentJob.fileSha256,
      etag: uploadResult.etag,
    }).catch(() => null);

    params.blobCacheRef.current.delete(currentJob.exportOperationId);
    void deleteBlobFromDB(getRetryBlobStorageId('user', currentJob.exportOperationId), false).catch(() => undefined);
    params.setQueue((prev) => prev.filter((job) => job.exportOperationId !== currentJob.exportOperationId));

    params.logExportActivity({
      status: 'success',
      phase: 'remote_upload',
      bankId: currentJob.bankId,
      bankName: currentJob.bankName,
      padNames: currentJob.padNames,
      exportOperationId: currentJob.exportOperationId,
      upload: {
        releaseTag: uploadResult.releaseTag,
        assetName: uploadResult.assetName,
        attempt: attemptNumber,
        result: 'success',
        verified: Boolean(report?.verified),
        fileSize: currentJob.fileSize,
        fileSha256: currentJob.fileSha256,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttempts = currentJob.attempts + 1;
    const exhausted = params.isNonRetryableGithubUploadError(error) || nextAttempts >= currentJob.maxAttempts;
    const fallbackUploadMeta: ExportUploadMeta = {
      releaseTag: preparedUpload?.releaseTag || null,
      assetName: preparedUpload?.assetName || currentJob.fileName,
      attempt: nextAttempts,
      result: 'failed',
      reason: exhausted ? `retry_exhausted: ${message}` : message,
      fileSize: currentJob.fileSize,
      fileSha256: currentJob.fileSha256,
    };

    try {
      if (preparedUpload?.sessionId) {
        await params.invokeUserExportApi('complete-upload', {
          sessionId: preparedUpload.sessionId,
          exportOperationId: currentJob.exportOperationId,
          status: 'failed',
          attempt: nextAttempts,
          failureReason: message,
          fileSha256: currentJob.fileSha256,
        });
      }
    } catch {
    }

    params.logExportActivity({
      status: 'failed',
      phase: 'remote_upload',
      bankId: currentJob.bankId,
      bankName: currentJob.bankName,
      padNames: currentJob.padNames,
      exportOperationId: currentJob.exportOperationId,
      errorMessage: exhausted ? `Upload retries exhausted. ${message}` : message,
      upload: fallbackUploadMeta,
    });

    params.setQueue((prev) => {
      if (exhausted) {
        params.blobCacheRef.current.delete(currentJob.exportOperationId);
        void deleteBlobFromDB(getRetryBlobStorageId('user', currentJob.exportOperationId), false).catch(() => undefined);
        return prev.filter((job) => job.exportOperationId !== currentJob.exportOperationId);
      }
      return prev.map((job) => (
        job.exportOperationId === currentJob.exportOperationId
          ? {
            ...job,
            attempts: nextAttempts,
            nextRetryAt: params.computeUploadRetryAt(nextAttempts),
          }
          : job
      ));
    });
  } finally {
    params.processingRef.current = false;
  }
};

export const processAdminExportUploadQueueOnce = async (params: {
  profileRole?: string | null;
  user: { id: string } | null;
  getCachedUser: () => { id: string } | null;
  queueRef: { current: AdminExportUploadJob[] };
  processingRef: { current: boolean };
  blobCacheRef: { current: Map<string, Blob> };
  setQueue: QueueSetter<AdminExportUploadJob>;
  isNativeCapacitorPlatform: () => boolean;
  readNativeExportBackupFileByName: (fileName: string) => Promise<File | null>;
  uploadAdminCatalogAsset: UploadAdminAssetFn;
  isNonRetryableGithubUploadError: (error: unknown) => boolean;
  computeUploadRetryAt: (attempts: number) => number;
  adminExportUploadMaxAgeMs: number;
  logExportActivity: LogExportActivityFn;
}): Promise<void> => {
  if (params.processingRef.current) return;
  if (params.profileRole !== 'admin') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const effectiveUser = params.user || params.getCachedUser();
  if (!effectiveUser?.id) return;

  const now = Date.now();
  const availableJobs = params.queueRef.current
    .filter((job) => job.userId === effectiveUser.id)
    .filter((job) => now - new Date(job.createdAt).getTime() <= params.adminExportUploadMaxAgeMs)
    .sort((a, b) => a.nextRetryAt - b.nextRetryAt);
  const currentJob = availableJobs[0];
  if (!currentJob) return;
  if (currentJob.nextRetryAt > now) return;

  if (currentJob.operationType === 'update') {
    const newestMatchingJob = availableJobs
      .filter((job) => job.catalogItemId === currentJob.catalogItemId && job.operationType === 'update')
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
    if (newestMatchingJob && newestMatchingJob.exportOperationId !== currentJob.exportOperationId) {
      params.blobCacheRef.current.delete(currentJob.exportOperationId);
      void deleteBlobFromDB(getRetryBlobStorageId('admin', currentJob.exportOperationId), false).catch(() => undefined);
      params.setQueue((prev) => prev.filter((job) => job.exportOperationId !== currentJob.exportOperationId));
      params.logExportActivity({
        status: 'failed',
        phase: 'remote_upload',
        bankId: currentJob.bankId,
        bankName: currentJob.bankName,
        padNames: currentJob.padNames,
        exportOperationId: currentJob.exportOperationId,
        errorMessage: 'Skipped stale admin update retry because a newer update exists for this catalog item.',
        upload: {
          assetName: currentJob.assetName || currentJob.fileName,
          result: 'failed',
          reason: 'stale_update_retry_skipped',
          fileSize: currentJob.fileSize,
          fileSha256: currentJob.fileSha256,
        },
      });
      return;
    }
  }

  params.processingRef.current = true;
  try {
    const exportBlob = await getAdminExportJobBlob(
      currentJob,
      params.blobCacheRef,
      params.isNativeCapacitorPlatform,
      params.readNativeExportBackupFileByName
    );
    if (!exportBlob) {
      throw new Error('Export file is no longer available for admin upload retry.');
    }

    const attemptNumber = currentJob.attempts + 1;
    const uploadResult = await params.uploadAdminCatalogAsset({
      catalogItemId: currentJob.catalogItemId,
      operationType: currentJob.operationType,
      assetName: currentJob.assetName || currentJob.fileName,
      exportBlob,
      assetProtection: currentJob.assetProtection,
    });

    params.blobCacheRef.current.delete(currentJob.exportOperationId);
    void deleteBlobFromDB(getRetryBlobStorageId('admin', currentJob.exportOperationId), false).catch(() => undefined);
    params.setQueue((prev) => prev.filter((job) => job.exportOperationId !== currentJob.exportOperationId));

    params.logExportActivity({
      status: 'success',
      phase: 'remote_upload',
      bankId: currentJob.bankId,
      bankName: currentJob.bankName,
      padNames: currentJob.padNames,
      exportOperationId: currentJob.exportOperationId,
      upload: {
        releaseTag: uploadResult.releaseTag || null,
        assetName: uploadResult.assetName || currentJob.assetName,
        attempt: attemptNumber,
        result: 'success',
        verified: true,
        reason: currentJob.operationType === 'update' ? 'admin_update_retry_queue' : 'admin_retry_queue',
        fileSize: currentJob.fileSize,
        fileSha256: currentJob.fileSha256,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttempts = currentJob.attempts + 1;
    const exhausted = params.isNonRetryableGithubUploadError(error) || nextAttempts >= currentJob.maxAttempts;

    params.logExportActivity({
      status: 'failed',
      phase: 'remote_upload',
      bankId: currentJob.bankId,
      bankName: currentJob.bankName,
      padNames: currentJob.padNames,
      exportOperationId: currentJob.exportOperationId,
      errorMessage: exhausted ? `Admin upload retries exhausted. ${message}` : `Admin upload retry pending. ${message}`,
      upload: {
        releaseTag: null,
        assetName: currentJob.assetName || currentJob.fileName,
        attempt: nextAttempts,
        result: 'failed',
        reason: exhausted ? `retry_exhausted: ${message}` : message,
        fileSize: currentJob.fileSize,
        fileSha256: currentJob.fileSha256,
      },
    });

    params.setQueue((prev) => {
      if (exhausted) {
        params.blobCacheRef.current.delete(currentJob.exportOperationId);
        void deleteBlobFromDB(getRetryBlobStorageId('admin', currentJob.exportOperationId), false).catch(() => undefined);
        return prev.filter((job) => job.exportOperationId !== currentJob.exportOperationId);
      }
      return prev.map((job) => (
        job.exportOperationId === currentJob.exportOperationId
          ? {
            ...job,
            attempts: nextAttempts,
            nextRetryAt: params.computeUploadRetryAt(nextAttempts),
          }
          : job
      ));
    });
  } finally {
    params.processingRef.current = false;
  }
};

export const clearAdminUpdateRetryJobsForCatalogItem = (
  catalogItemId: string,
  options: {
    blobCacheRef: { current: Map<string, Blob> };
    setQueue: QueueSetter<AdminExportUploadJob>;
    excludeExportOperationId?: string;
  }
): void => {
  const trimmedCatalogItemId = String(catalogItemId || '').trim();
  if (!trimmedCatalogItemId) return;
  let removedJobs: AdminExportUploadJob[] = [];
  options.setQueue((prev) => {
    removedJobs = prev.filter((job) =>
      job.catalogItemId === trimmedCatalogItemId &&
      job.operationType === 'update' &&
      job.exportOperationId !== options.excludeExportOperationId
    );
    if (!removedJobs.length) return prev;
    const removedIds = new Set(removedJobs.map((job) => job.exportOperationId));
    return prev.filter((job) => !removedIds.has(job.exportOperationId));
  });
  removedJobs.forEach((job) => {
    options.blobCacheRef.current.delete(job.exportOperationId);
    void deleteBlobFromDB(getRetryBlobStorageId('admin', job.exportOperationId), false).catch(() => undefined);
  });
};
