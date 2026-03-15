const MOBILE_IMAGE_QUOTA = 100 * 1024 * 1024;
const DESKTOP_BROWSER_IMAGE_QUOTA = 250 * 1024 * 1024;
const ELECTRON_IMAGE_QUOTA = 350 * 1024 * 1024;

const resolveMaxImageQuota = (): number => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return MOBILE_IMAGE_QUOTA;
  }

  if (window.electronAPI) {
    return ELECTRON_IMAGE_QUOTA;
  }

  const userAgent = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent);
  const isNativeCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());

  if (isMobile || isNativeCapacitor) {
    return MOBILE_IMAGE_QUOTA;
  }

  return DESKTOP_BROWSER_IMAGE_QUOTA;
};

export interface BatchFileItem {
  id: string;
  blob: Blob;
  type: 'audio' | 'image';
}

export const supportsFileSystemAccess = (): boolean => {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'FileSystemFileHandle' in window;
};

export const openFileDB = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable in this browser context'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open('vdjv-file-storage', 4);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('file-handles')) db.createObjectStore('file-handles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('image-handles')) db.createObjectStore('image-handles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quota-info')) db.createObjectStore('quota-info', { keyPath: 'type' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getCurrentQuotaUsage = async (): Promise<number> => {
  try {
    const db = await openFileDB();
    return new Promise((resolve) => {
      const tx = db.transaction('quota-info', 'readonly');
      const request = tx.objectStore('quota-info').get('images');
      request.onsuccess = () => resolve(request.result?.usage || 0);
      request.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
};

export const saveBatchBlobsToDB = async (items: BatchFileItem[]) => {
  if (items.length === 0) return;

  const db = await openFileDB();
  const maxImageQuota = resolveMaxImageQuota();

  let totalImageSize = 0;
  items.forEach((item) => {
    if (item.type === 'image') totalImageSize += item.blob.size;
  });

  if (totalImageSize > 0) {
    const currentUsage = await getCurrentQuotaUsage();
    if (currentUsage + totalImageSize > maxImageQuota) {
      throw new Error('Pad image storage is full. Delete some pad images before adding another.');
    }
  }

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['blobs', 'quota-info'], 'readwrite');
    const blobStore = tx.objectStore('blobs');
    const quotaStore = tx.objectStore('quota-info');

    items.forEach((item) => {
      const storeId = `${item.type}_${item.id}`;
      blobStore.put({ id: storeId, blob: item.blob, timestamp: Date.now() });
    });

    if (totalImageSize > 0) {
      const quotaRequest = quotaStore.get('images');
      quotaRequest.onsuccess = () => {
        const current = quotaRequest.result?.usage || 0;
        quotaStore.put({ type: 'images', usage: current + totalImageSize });
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const saveFileHandle = async (id: string, handle: FileSystemFileHandle, type: 'audio' | 'image' = 'audio') => {
  try {
    const db = await openFileDB();
    const storeName = type === 'image' ? 'image-handles' : 'file-handles';
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put({ id, handle, type, timestamp: Date.now() });
  } catch {
  }
};

export const getFileHandle = async (id: string, type: 'audio' | 'image' = 'audio'): Promise<FileSystemFileHandle | null> => {
  try {
    const db = await openFileDB();
    const storeName = type === 'image' ? 'image-handles' : 'file-handles';
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result ? request.result.handle : null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

export const deleteFileHandle = async (id: string, type: 'audio' | 'image' = 'audio') => {
  try {
    const db = await openFileDB();
    const storeName = type === 'image' ? 'image-handles' : 'file-handles';
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
  } catch {
  }
};

export const saveBlobToDB = async (id: string, blob: Blob, isImage: boolean = false) => {
  try {
    const db = await openFileDB();
    if (isImage) {
      const maxImageQuota = resolveMaxImageQuota();
      const currentUsage = await getCurrentQuotaUsage();
      if (currentUsage + blob.size > maxImageQuota) {
        throw new Error('Local image storage is full. Remove some pad images or bank thumbnails and try again.');
      }
    }
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['blobs', 'quota-info'], 'readwrite');
      tx.objectStore('blobs').put({ id, blob, timestamp: Date.now() });
      if (isImage) {
        const qs = tx.objectStore('quota-info');
        const req = qs.get('images');
        req.onsuccess = () => qs.put({ type: 'images', usage: (req.result?.usage || 0) + blob.size });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    throw e;
  }
};

export const getBlobFromDB = async (id: string): Promise<Blob | null> => {
  try {
    const db = await openFileDB();
    return new Promise((resolve) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

export const deleteBlobFromDB = async (id: string, isImage: boolean = false) => {
  try {
    const db = await openFileDB();
    const tx = db.transaction(['blobs', 'quota-info'], 'readwrite');
    const store = tx.objectStore('blobs');
    if (isImage) {
      const req = store.get(id);
      req.onsuccess = () => {
        const size = req.result?.blob?.size || 0;
        store.delete(id);
        if (size > 0) {
          const qs = tx.objectStore('quota-info');
          const qr = qs.get('images');
          qr.onsuccess = () => qs.put({ type: 'images', usage: Math.max(0, (qr.result?.usage || 0) - size) });
        }
      };
    } else {
      store.delete(id);
    }
  } catch {
  }
};
