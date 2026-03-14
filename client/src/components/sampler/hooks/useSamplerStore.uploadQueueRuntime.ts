import * as React from 'react';
import { logActivityEvent } from '@/lib/activityLogger';
import {
  enqueueAdminExportUploadJob,
  enqueueUserExportUploadJob,
  processAdminExportUploadQueueOnce,
  processUserExportUploadQueueOnce,
  type AdminExportUploadJob,
  type UserExportUploadJob,
} from './useSamplerStore.uploadQueue';
import type { ExportActivityPhase, ExportAudioMode, ExportUploadMeta } from './useSamplerStore.types';

type UploadQueueRuntimeParams = {
  profileRole?: string | null;
  user: { id?: string; email?: string } | null;
  getCachedUser: () => { id?: string; email?: string } | null;
  exportUploadQueue: UserExportUploadJob[];
  setExportUploadQueue: React.Dispatch<React.SetStateAction<UserExportUploadJob[]>>;
  exportUploadQueueRef: React.MutableRefObject<UserExportUploadJob[]>;
  exportUploadProcessingRef: React.MutableRefObject<boolean>;
  exportUploadBlobCacheRef: React.MutableRefObject<Map<string, Blob>>;
  exportUploadTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  adminExportUploadQueue: AdminExportUploadJob[];
  setAdminExportUploadQueue: React.Dispatch<React.SetStateAction<AdminExportUploadJob[]>>;
  adminExportUploadQueueRef: React.MutableRefObject<AdminExportUploadJob[]>;
  adminExportUploadProcessingRef: React.MutableRefObject<boolean>;
  adminExportUploadBlobCacheRef: React.MutableRefObject<Map<string, Blob>>;
  adminExportUploadTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isNativeCapacitorPlatform: () => boolean;
  readNativeExportBackupFileByName: (fileName: string) => Promise<File | null>;
  invokeUserExportApi: <T,>(route: string, body: Record<string, unknown>) => Promise<T>;
  coerceUploadHeaders: (value: unknown) => Record<string, string>;
  uploadUserExportAsset: (input: {
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
  uploadAdminCatalogAsset: (input: {
    catalogItemId: string;
    operationType?: 'create' | 'update';
    assetName: string;
    exportBlob: Blob;
    assetProtection: 'encrypted' | 'public';
  }) => Promise<{ releaseTag?: string | null; assetName: string; fileSize: number }>;
  isNonRetryableGithubUploadError: (error: unknown) => boolean;
  computeUploadRetryAt: (attempts: number) => number;
  userExportUploadMaxAttempts: number;
  adminExportUploadMaxAttempts: number;
  userExportUploadMaxAgeMs: number;
  adminExportUploadMaxAgeMs: number;
  writeUserExportUploadQueue: (jobs: UserExportUploadJob[]) => void;
  writeAdminExportUploadQueue: (jobs: AdminExportUploadJob[]) => void;
};

export const useSamplerStoreUploadQueueRuntime = (params: UploadQueueRuntimeParams) => {
  const {
    profileRole,
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
    userExportUploadMaxAttempts,
    adminExportUploadMaxAttempts,
    userExportUploadMaxAgeMs,
    adminExportUploadMaxAgeMs,
    writeUserExportUploadQueue,
    writeAdminExportUploadQueue,
  } = params;

  React.useEffect(() => {
    exportUploadQueueRef.current = exportUploadQueue;
    writeUserExportUploadQueue(exportUploadQueue);
  }, [exportUploadQueue, exportUploadQueueRef, writeUserExportUploadQueue]);

  React.useEffect(() => {
    adminExportUploadQueueRef.current = adminExportUploadQueue;
    writeAdminExportUploadQueue(adminExportUploadQueue);
  }, [adminExportUploadQueue, adminExportUploadQueueRef, writeAdminExportUploadQueue]);

  React.useEffect(() => {
    return () => {
      if (exportUploadTimerRef.current) {
        clearTimeout(exportUploadTimerRef.current);
        exportUploadTimerRef.current = null;
      }
      exportUploadBlobCacheRef.current.clear();
      if (adminExportUploadTimerRef.current) {
        clearTimeout(adminExportUploadTimerRef.current);
        adminExportUploadTimerRef.current = null;
      }
      adminExportUploadBlobCacheRef.current.clear();
    };
  }, [
    exportUploadTimerRef,
    exportUploadBlobCacheRef,
    adminExportUploadTimerRef,
    adminExportUploadBlobCacheRef,
  ]);

  const logExportActivity = React.useCallback((input: {
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
  }) => {
    const effectiveUser = user || getCachedUser();
    const padNames = input.padNames.slice(0, 300);
    const extraMeta = input.meta && typeof input.meta === 'object' ? input.meta : {};
    void logActivityEvent({
      eventType: 'bank.export',
      status: input.status,
      userId: effectiveUser?.id || null,
      email: effectiveUser?.email || 'unknown',
      bankId: input.bankId || null,
      bankName: input.bankName,
      padCount: input.padNames.length,
      padNames,
      errorMessage: input.errorMessage || null,
      meta: {
        ...extraMeta,
        source: input.source || 'useSamplerStore.exportBank',
        phase: input.phase,
        exportOperationId: input.exportOperationId || null,
        includePadList: true,
        padNames,
        padNamesTruncated: input.padNames.length > padNames.length,
        upload: input.upload || null,
        timing: input.timing || null,
      },
    }).catch(() => {
    });
  }, [user, getCachedUser]);

  const processUserExportUploadQueue = React.useCallback(async () => {
    await processUserExportUploadQueueOnce({
      profileRole,
      user: user as { id: string } | null,
      getCachedUser: getCachedUser as () => { id: string } | null,
      queueRef: exportUploadQueueRef,
      processingRef: exportUploadProcessingRef,
      blobCacheRef: exportUploadBlobCacheRef,
      setQueue: setExportUploadQueue,
      isNativeCapacitorPlatform,
      readNativeExportBackupFileByName,
      invokeUserExportApi,
      coerceUploadHeaders,
      uploadUserExportAsset,
      isNonRetryableGithubUploadError,
      computeUploadRetryAt,
      userExportUploadMaxAgeMs,
      logExportActivity,
    });
  }, [
    profileRole,
    user,
    getCachedUser,
    exportUploadQueueRef,
    exportUploadProcessingRef,
    exportUploadBlobCacheRef,
    setExportUploadQueue,
    isNativeCapacitorPlatform,
    readNativeExportBackupFileByName,
    invokeUserExportApi,
    coerceUploadHeaders,
    uploadUserExportAsset,
    isNonRetryableGithubUploadError,
    computeUploadRetryAt,
    userExportUploadMaxAgeMs,
    logExportActivity,
  ]);

  const enqueueUserExportUpload = React.useCallback((input: {
    exportOperationId: string;
    userId: string;
    bankId: string;
    bankName: string;
    fileName: string;
    fileSize: number;
    fileSha256: string | null;
    padNames: string[];
    blob: Blob;
  }) => {
    enqueueUserExportUploadJob(input, {
      maxAttempts: userExportUploadMaxAttempts,
      blobCacheRef: exportUploadBlobCacheRef,
      setQueue: setExportUploadQueue,
    });
  }, [userExportUploadMaxAttempts, exportUploadBlobCacheRef, setExportUploadQueue]);

  const processAdminExportUploadQueue = React.useCallback(async () => {
    await processAdminExportUploadQueueOnce({
      profileRole,
      user: user as { id: string } | null,
      getCachedUser: getCachedUser as () => { id: string } | null,
      queueRef: adminExportUploadQueueRef,
      processingRef: adminExportUploadProcessingRef,
      blobCacheRef: adminExportUploadBlobCacheRef,
      setQueue: setAdminExportUploadQueue,
      isNativeCapacitorPlatform,
      readNativeExportBackupFileByName,
      uploadAdminCatalogAsset,
      isNonRetryableGithubUploadError,
      computeUploadRetryAt,
      adminExportUploadMaxAgeMs,
      logExportActivity,
    });
  }, [
    profileRole,
    user,
    getCachedUser,
    adminExportUploadQueueRef,
    adminExportUploadProcessingRef,
    adminExportUploadBlobCacheRef,
    setAdminExportUploadQueue,
    isNativeCapacitorPlatform,
    readNativeExportBackupFileByName,
    uploadAdminCatalogAsset,
    isNonRetryableGithubUploadError,
    computeUploadRetryAt,
    adminExportUploadMaxAgeMs,
    logExportActivity,
  ]);

  const enqueueAdminExportUpload = React.useCallback((input: {
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
  }) => {
    enqueueAdminExportUploadJob(input, {
      maxAttempts: adminExportUploadMaxAttempts,
      blobCacheRef: adminExportUploadBlobCacheRef,
      setQueue: setAdminExportUploadQueue,
    });
  }, [adminExportUploadMaxAttempts, adminExportUploadBlobCacheRef, setAdminExportUploadQueue]);

  React.useEffect(() => {
    if (profileRole === 'admin') return;
    if (typeof window === 'undefined') return;
    const run = () => {
      void processUserExportUploadQueue();
    };
    run();
    const handleOnline = () => run();
    const handleFocus = () => run();
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [profileRole, processUserExportUploadQueue]);

  React.useEffect(() => {
    if (profileRole === 'admin') return;
    if (exportUploadTimerRef.current) {
      clearTimeout(exportUploadTimerRef.current);
      exportUploadTimerRef.current = null;
    }

    const nextDueAt = exportUploadQueue
      .map((job) => Number(job.nextRetryAt || 0))
      .filter((nextRetryAt) => Number.isFinite(nextRetryAt) && nextRetryAt > 0)
      .sort((a, b) => a - b)[0];
    if (!nextDueAt) return;

    const delay = Math.max(0, nextDueAt - Date.now());
    exportUploadTimerRef.current = setTimeout(() => {
      void processUserExportUploadQueue();
    }, delay);
  }, [profileRole, exportUploadQueue, exportUploadTimerRef, processUserExportUploadQueue]);

  React.useEffect(() => {
    if (profileRole !== 'admin') return;
    if (typeof window === 'undefined') return;
    const run = () => {
      void processAdminExportUploadQueue();
    };
    run();
    const handleOnline = () => run();
    const handleFocus = () => run();
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [profileRole, processAdminExportUploadQueue]);

  React.useEffect(() => {
    if (profileRole !== 'admin') return;
    if (adminExportUploadTimerRef.current) {
      clearTimeout(adminExportUploadTimerRef.current);
      adminExportUploadTimerRef.current = null;
    }

    const nextDueAt = adminExportUploadQueue
      .map((job) => Number(job.nextRetryAt || 0))
      .filter((nextRetryAt) => Number.isFinite(nextRetryAt) && nextRetryAt > 0)
      .sort((a, b) => a - b)[0];
    if (!nextDueAt) return;

    const delay = Math.max(0, nextDueAt - Date.now());
    adminExportUploadTimerRef.current = setTimeout(() => {
      void processAdminExportUploadQueue();
    }, delay);
  }, [profileRole, adminExportUploadQueue, adminExportUploadTimerRef, processAdminExportUploadQueue]);

  return {
    logExportActivity,
    processUserExportUploadQueue,
    enqueueUserExportUpload,
    processAdminExportUploadQueue,
    enqueueAdminExportUpload,
  };
};
