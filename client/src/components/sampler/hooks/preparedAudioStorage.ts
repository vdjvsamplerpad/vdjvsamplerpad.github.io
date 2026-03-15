import { deleteBlobFromDB, getBlobFromDB, saveBlobToDB } from './useSamplerStore.idbStorage';
import type { PreparedAudioStorageBackend } from './preparedAudio';

const PREPARED_AUDIO_DB_PREFIX = 'prepared_audio_';
const PREPARED_AUDIO_OPFS_ROOT = 'vdjv-prepared-audio';

const supportsOpfs = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.storage !== 'undefined' &&
  typeof (navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> }).getDirectory === 'function';

const buildPreparedAudioDbId = (padId: string): string => `${PREPARED_AUDIO_DB_PREFIX}${padId}`;

const getOpfsDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!supportsOpfs()) return null;
  try {
    const root = await (navigator.storage as StorageManager & { getDirectory: () => Promise<FileSystemDirectoryHandle> }).getDirectory();
    return await root.getDirectoryHandle(PREPARED_AUDIO_OPFS_ROOT, { create: true });
  } catch {
    return null;
  }
};

const deleteOpfsFile = async (storageKey?: string | null): Promise<void> => {
  const safeKey = typeof storageKey === 'string' ? storageKey.trim() : '';
  if (!safeKey) return;
  const dir = await getOpfsDirectory();
  if (!dir) return;
  try {
    await dir.removeEntry(safeKey);
  } catch {
    // Ignore missing-entry errors.
  }
};

export const savePreparedAudioBlob = async (
  padId: string,
  blob: Blob,
): Promise<{ storageKey: string; backend: PreparedAudioStorageBackend }> => {
  const safePadId = padId.trim();
  const dbId = buildPreparedAudioDbId(safePadId);
  const opfsDir = await getOpfsDirectory();

  if (opfsDir) {
    const storageKey = `${safePadId}.bin`;
    try {
      const handle = await opfsDir.getFileHandle(storageKey, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { storageKey, backend: 'opfs' };
    } catch {
      await deleteOpfsFile(storageKey);
    }
  }

  await saveBlobToDB(dbId, blob, false);
  return { storageKey: dbId, backend: 'idb' };
};

export const readPreparedAudioBlob = async (
  padId: string,
  storageKey?: string,
  backend?: PreparedAudioStorageBackend,
): Promise<Blob | null> => {
  const safePadId = padId.trim();
  const safeKey = typeof storageKey === 'string' && storageKey.trim().length > 0
    ? storageKey.trim()
    : buildPreparedAudioDbId(safePadId);

  if (backend === 'opfs') {
    const dir = await getOpfsDirectory();
    if (dir) {
      try {
        const handle = await dir.getFileHandle(safeKey);
        return await handle.getFile();
      } catch {
        // Fall through to IndexedDB fallback.
      }
    }
  }

  try {
    return await getBlobFromDB(safeKey);
  } catch {
    return null;
  }
};

export const restorePreparedAudioUrl = async (
  padId: string,
  storageKey?: string,
  backend?: PreparedAudioStorageBackend,
): Promise<{ url: string | null; storageKey?: string; backend?: PreparedAudioStorageBackend }> => {
  const blob = await readPreparedAudioBlob(padId, storageKey, backend);
  if (!blob) {
    return { url: null, storageKey, backend };
  }
  return {
    url: URL.createObjectURL(blob),
    storageKey: storageKey || (backend === 'opfs' ? `${padId.trim()}.bin` : buildPreparedAudioDbId(padId)),
    backend: backend || (supportsOpfs() ? 'opfs' : 'idb'),
  };
};

export const estimatePreparedAudioBytes = async (
  padId: string,
  storageKey?: string,
  backend?: PreparedAudioStorageBackend,
): Promise<number> => {
  const blob = await readPreparedAudioBlob(padId, storageKey, backend);
  return blob?.size || 0;
};

export const deletePreparedAudioBlob = async (
  padId: string,
  storageKey?: string,
  backend?: PreparedAudioStorageBackend,
): Promise<void> => {
  const safePadId = padId.trim();
  const safeKey = typeof storageKey === 'string' && storageKey.trim().length > 0
    ? storageKey.trim()
    : buildPreparedAudioDbId(safePadId);

  if (backend === 'opfs') {
    await deleteOpfsFile(safeKey);
  }

  await deleteBlobFromDB(safeKey, false);
};
