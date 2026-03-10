import type { AdminExportUploadJob, UserExportUploadJob } from './useSamplerStore.uploadQueue';

export const USER_EXPORT_UPLOAD_QUEUE_KEY = 'vdjv-user-export-upload-queue-v1';
export const USER_EXPORT_UPLOAD_MAX_ATTEMPTS = 3;
export const USER_EXPORT_UPLOAD_RETRY_BASE_MS = 30000;
export const USER_EXPORT_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ADMIN_EXPORT_UPLOAD_QUEUE_KEY = 'vdjv-admin-export-upload-queue-v1';
export const ADMIN_EXPORT_UPLOAD_MAX_ATTEMPTS = 5;
export const ADMIN_EXPORT_UPLOAD_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export const readUserExportUploadQueue = (): UserExportUploadJob[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_EXPORT_UPLOAD_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .map((item: any) => ({
        exportOperationId: typeof item?.exportOperationId === 'string' ? item.exportOperationId : '',
        userId: typeof item?.userId === 'string' ? item.userId : '',
        bankId: typeof item?.bankId === 'string' ? item.bankId : '',
        bankName: typeof item?.bankName === 'string' ? item.bankName : 'bank',
        fileName: typeof item?.fileName === 'string' ? item.fileName : '',
        fileSize: Number(item?.fileSize || 0),
        fileSha256: typeof item?.fileSha256 === 'string' ? item.fileSha256 : null,
        createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date(now).toISOString(),
        nextRetryAt: Number(item?.nextRetryAt || now),
        attempts: Math.max(0, Math.floor(Number(item?.attempts || 0))),
        maxAttempts: Math.max(1, Math.floor(Number(item?.maxAttempts || USER_EXPORT_UPLOAD_MAX_ATTEMPTS))),
        padNames: Array.isArray(item?.padNames)
          ? item.padNames
              .map((entry: unknown) => (typeof entry === 'string' ? entry.trim() : ''))
              .filter(Boolean)
              .slice(0, 500)
          : [],
      }))
      .filter((item) => {
        if (!item.exportOperationId || !item.userId || !item.bankId || !item.fileName) return false;
        const createdAtMs = new Date(item.createdAt).getTime();
        if (!Number.isFinite(createdAtMs)) return false;
        if (now - createdAtMs > USER_EXPORT_UPLOAD_MAX_AGE_MS) return false;
        if (item.attempts >= item.maxAttempts) return false;
        return true;
      });
  } catch {
    return [];
  }
};

export const readAdminExportUploadQueue = (): AdminExportUploadJob[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ADMIN_EXPORT_UPLOAD_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .map((item: any) => {
        const assetProtection: 'encrypted' | 'public' = item?.assetProtection === 'public' ? 'public' : 'encrypted';
        return {
          exportOperationId: typeof item?.exportOperationId === 'string' ? item.exportOperationId : '',
          userId: typeof item?.userId === 'string' ? item.userId : '',
          bankId: typeof item?.bankId === 'string' ? item.bankId : '',
          bankName: typeof item?.bankName === 'string' ? item.bankName : 'bank',
          catalogItemId: typeof item?.catalogItemId === 'string' ? item.catalogItemId : '',
          fileName: typeof item?.fileName === 'string' ? item.fileName : '',
          assetName: typeof item?.assetName === 'string' ? item.assetName : '',
          assetProtection,
          fileSize: Number(item?.fileSize || 0),
          fileSha256: typeof item?.fileSha256 === 'string' ? item.fileSha256 : null,
          createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date(now).toISOString(),
          nextRetryAt: Number(item?.nextRetryAt || now),
          attempts: Math.max(0, Math.floor(Number(item?.attempts || 0))),
          maxAttempts: Math.max(1, Math.floor(Number(item?.maxAttempts || ADMIN_EXPORT_UPLOAD_MAX_ATTEMPTS))),
          padNames: Array.isArray(item?.padNames)
            ? item.padNames
                .map((entry: unknown) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean)
                .slice(0, 500)
            : [],
        };
      })
      .filter((item) => {
        if (!item.exportOperationId || !item.userId || !item.catalogItemId || !item.fileName || !item.assetName) return false;
        const createdAtMs = new Date(item.createdAt).getTime();
        if (!Number.isFinite(createdAtMs)) return false;
        if (now - createdAtMs > ADMIN_EXPORT_UPLOAD_MAX_AGE_MS) return false;
        if (item.attempts >= item.maxAttempts) return false;
        return true;
      });
  } catch {
    return [];
  }
};

export const writeUserExportUploadQueue = (jobs: UserExportUploadJob[]): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!jobs.length) {
      localStorage.removeItem(USER_EXPORT_UPLOAD_QUEUE_KEY);
      return;
    }
    localStorage.setItem(USER_EXPORT_UPLOAD_QUEUE_KEY, JSON.stringify(jobs));
  } catch {
    // best effort persistence only
  }
};

export const writeAdminExportUploadQueue = (jobs: AdminExportUploadJob[]): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!jobs.length) {
      localStorage.removeItem(ADMIN_EXPORT_UPLOAD_QUEUE_KEY);
      return;
    }
    localStorage.setItem(ADMIN_EXPORT_UPLOAD_QUEUE_KEY, JSON.stringify(jobs));
  } catch {
    // best effort persistence only
  }
};

export const computeUploadRetryAt = (attempts: number): number => {
  const safeAttempts = Math.max(1, attempts);
  const multiplier = Math.min(6, safeAttempts);
  return Date.now() + USER_EXPORT_UPLOAD_RETRY_BASE_MS * multiplier;
};

