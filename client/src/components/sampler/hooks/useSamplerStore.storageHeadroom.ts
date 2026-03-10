const MIN_FREE_STORAGE_BYTES = 200 * 1024 * 1024;
const MAX_UNKNOWN_STORAGE_OPERATION_BYTES = 450 * 1024 * 1024;
const MAX_UNKNOWN_STORAGE_IMPORT_BYTES = 3 * 1024 * 1024 * 1024;

export const ensureStorageHeadroom = async (requiredBytes: number, operation: string): Promise<void> => {
  const unknownStorageLimitBytes =
    operation === 'bank import' || operation === 'backup restore'
      ? MAX_UNKNOWN_STORAGE_IMPORT_BYTES
      : MAX_UNKNOWN_STORAGE_OPERATION_BYTES;

  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
    if (requiredBytes > unknownStorageLimitBytes) {
      const requiredMb = Math.ceil(requiredBytes / (1024 * 1024));
      throw new Error(`Unable to verify free storage for ${operation}. Operation is too large (${requiredMb}MB) without quota support.`);
    }
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate.quota || !estimate.usage) return;
    const freeBytes = estimate.quota - estimate.usage;
    if (freeBytes < requiredBytes + MIN_FREE_STORAGE_BYTES) {
      const freeMb = Math.floor(freeBytes / (1024 * 1024));
      const neededMb = Math.ceil((requiredBytes + MIN_FREE_STORAGE_BYTES) / (1024 * 1024));
      throw new Error(`Not enough free storage for ${operation}. Available: ${freeMb}MB, required: ${neededMb}MB.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Not enough free storage')) {
      throw error;
    }
  }
};

