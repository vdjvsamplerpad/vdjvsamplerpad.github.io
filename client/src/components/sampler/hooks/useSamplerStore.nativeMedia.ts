export type NativeMediaKind = 'audio' | 'image';
export type MediaBackend = 'native' | 'idb';

export interface NativeMediaStorageTargets {
  dbIds: string[];
  nativeKeys: string[];
  canonicalDbId: string;
}

export interface NativeMediaRuntimeDeps {
  isNativeCapacitorPlatform: () => boolean;
  nativeMediaRoot: string;
  maxNativeAudioWriteBytes: number;
  maxNativeImageWriteBytes: number;
  maxCapacitorBridgeReadBytes: number;
  extFromMime: (mime: string, type: NativeMediaKind) => string;
  mimeFromExt: (ext: string, type: NativeMediaKind) => string;
  parseStorageKeyExt: (storageKey: string) => string;
  blobToBase64: (blob: Blob) => Promise<string>;
  normalizeBase64Data: (raw: string) => string;
}

type NativeMediaResolvedDescriptor = {
  storageKey?: string;
  exists?: boolean;
  sourcePath?: string;
  fileUrl?: string;
  bytes?: number;
};

const normalizeElectronBinaryPayload = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && typeof value === 'object' && Array.isArray((value as { data?: number[] }).data)) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  return null;
};

const getElectronNativeMediaApi = () => {
  if (typeof window === 'undefined') return null;
  const electronAPI = window.electronAPI;
  if (!electronAPI) return null;
  if (
    typeof electronAPI.resolveNativeMedia !== 'function' ||
    typeof electronAPI.writeNativeMedia !== 'function' ||
    typeof electronAPI.readNativeMedia !== 'function' ||
    typeof electronAPI.deleteNativeMedia !== 'function'
  ) {
    return null;
  }
  return electronAPI;
};

const buildNativeStorageKey = (
  padId: string,
  blob: Blob,
  type: NativeMediaKind,
  storageKeyHint: string | undefined,
  extFromMime: (mime: string, kind: NativeMediaKind) => string
): string => {
  const ext = extFromMime(blob.type, type);
  if (!storageKeyHint || storageKeyHint.trim().length === 0) {
    return `${type}/${padId}.${ext}`;
  }
  const normalizedHint = storageKeyHint.replace(/^\/+/, '').trim();
  if (/\.[a-z0-9]+$/i.test(normalizedHint)) return normalizedHint;
  return `${normalizedHint}.${ext}`;
};

export const resolveMediaStorageTargets = (
  padId: string,
  type: NativeMediaKind,
  storageKey?: string,
  backend?: MediaBackend
): NativeMediaStorageTargets => {
  const canonicalDbId = `${type}_${padId}`;
  const dbIds = new Set<string>([canonicalDbId]);
  const nativeKeys = new Set<string>();

  if (backend === 'idb') {
    if (storageKey && storageKey.trim().length > 0) dbIds.add(storageKey);
  } else if (backend === 'native') {
    if (storageKey && storageKey.trim().length > 0) nativeKeys.add(storageKey);
  } else if (storageKey && storageKey.trim().length > 0) {
    if (storageKey.includes('/')) nativeKeys.add(storageKey);
    else dbIds.add(storageKey);
  }

  return {
    dbIds: Array.from(dbIds),
    nativeKeys: Array.from(nativeKeys),
    canonicalDbId,
  };
};

export const createNativeMediaRuntime = (deps: NativeMediaRuntimeDeps) => {
  const {
    isNativeCapacitorPlatform,
    nativeMediaRoot,
    maxNativeAudioWriteBytes,
    maxNativeImageWriteBytes,
    maxCapacitorBridgeReadBytes,
    extFromMime,
    mimeFromExt,
    parseStorageKeyExt,
    blobToBase64,
    normalizeBase64Data,
  } = deps;

  const nativeWriteFallbackLogged = new Set<NativeMediaKind>();
  const canUseElectronNativeMedia = (): boolean => getElectronNativeMediaApi() !== null;
  const canUseNativeMediaStorage = (): boolean => isNativeCapacitorPlatform() || canUseElectronNativeMedia();

  const resolveElectronNativeMedia = async (
    storageKey?: string | null
  ): Promise<NativeMediaResolvedDescriptor | null> => {
    if (!canUseElectronNativeMedia() || !storageKey) return null;
    try {
      return await getElectronNativeMediaApi()!.resolveNativeMedia!({ storageKey });
    } catch {
      return null;
    }
  };

  const getNativeMediaPlaybackUrl = async (storageKey: string): Promise<string | null> => {
    if (canUseElectronNativeMedia()) {
      const descriptor = await resolveElectronNativeMedia(storageKey);
      return descriptor?.exists ? descriptor.fileUrl || null : null;
    }
    if (!isNativeCapacitorPlatform()) return null;
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const uriResult = await Filesystem.getUri({
        path: `${nativeMediaRoot}/${storageKey}`,
        directory: Directory.Data,
      });
      const capacitor = (window as any).Capacitor;
      const convertFileSrc = capacitor?.convertFileSrc;
      return convertFileSrc ? convertFileSrc(uriResult.uri) : uriResult.uri;
    } catch {
      return null;
    }
  };

  const readNativeMediaSize = async (storageKey?: string | null): Promise<number> => {
    if (canUseElectronNativeMedia()) {
      const descriptor = await resolveElectronNativeMedia(storageKey);
      return descriptor?.exists ? Math.max(0, Number(descriptor.bytes || 0)) : 0;
    }
    if (!isNativeCapacitorPlatform() || !storageKey) return 0;
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const stat = await Filesystem.stat({
        path: `${nativeMediaRoot}/${storageKey}`,
        directory: Directory.Data,
      });
      return Number(stat.size || 0);
    } catch {
      return 0;
    }
  };

  const writeNativeMediaBlob = async (
    padId: string,
    blob: Blob,
    type: NativeMediaKind,
    storageKeyHint?: string
  ): Promise<string | null> => {
    if (canUseElectronNativeMedia()) {
      try {
        const storageKey = buildNativeStorageKey(padId, blob, type, storageKeyHint, extFromMime);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const response = await getElectronNativeMediaApi()!.writeNativeMedia!({
          storageKey,
          data: bytes,
        });
        return typeof response?.storageKey === 'string' && response.storageKey.trim().length > 0
          ? response.storageKey.trim()
          : storageKey;
      } catch {
        return null;
      }
    }
    if (!isNativeCapacitorPlatform()) return null;
    const nativeWriteLimitBytes = type === 'audio' ? maxNativeAudioWriteBytes : maxNativeImageWriteBytes;
    if (blob.size > nativeWriteLimitBytes) {
      if (!nativeWriteFallbackLogged.has(type)) {
        nativeWriteFallbackLogged.add(type);
      }
      return null;
    }
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const storageKey = buildNativeStorageKey(padId, blob, type, storageKeyHint, extFromMime);
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: `${nativeMediaRoot}/${storageKey}`,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      });
      return storageKey;
    } catch {
      return null;
    }
  };

  const readNativeMediaBlob = async (storageKey: string, type: NativeMediaKind): Promise<Blob | null> => {
    if (canUseElectronNativeMedia()) {
      try {
        const descriptor = await resolveElectronNativeMedia(storageKey);
        if (!descriptor?.exists) return null;
        const response = await getElectronNativeMediaApi()!.readNativeMedia!({ storageKey });
        const bytes = normalizeElectronBinaryPayload(response?.data);
        if (!bytes || bytes.byteLength <= 0) return null;
        return new Blob([bytes], {
          type: mimeFromExt(parseStorageKeyExt(storageKey), type),
        });
      } catch {
        return null;
      }
    }
    if (!isNativeCapacitorPlatform()) return null;
    try {
      const uri = await getNativeMediaPlaybackUrl(storageKey);
      if (uri) {
        try {
          const response = await fetch(uri, { cache: 'no-store' });
          if (response.ok) {
            const blob = await response.blob();
            if (blob.size > 0) {
              if (blob.type) return blob;
              return new Blob([blob], { type: mimeFromExt(parseStorageKeyExt(storageKey), type) });
            }
          }
        } catch {
          // Fall through to readFile fallback.
        }
      }

      const nativeSize = await readNativeMediaSize(storageKey);
      if (nativeSize > maxCapacitorBridgeReadBytes) {
        return null;
      }

      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const result = await Filesystem.readFile({
        path: `${nativeMediaRoot}/${storageKey}`,
        directory: Directory.Data,
      });
      const base64 = normalizeBase64Data(String(result.data || ''));
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeFromExt(parseStorageKeyExt(storageKey), type) });
    } catch {
      return null;
    }
  };

  const resolveNativeMediaSourcePath = async (storageKey?: string | null): Promise<string | null> => {
    if (canUseElectronNativeMedia()) {
      const descriptor = await resolveElectronNativeMedia(storageKey);
      return descriptor?.exists ? descriptor.sourcePath || null : null;
    }
    return null;
  };

  const deleteNativeMediaBlob = async (storageKey?: string | null): Promise<void> => {
    if (canUseElectronNativeMedia()) {
      if (!storageKey) return;
      try {
        await getElectronNativeMediaApi()!.deleteNativeMedia!({ storageKey });
      } catch {
        // Ignore missing file errors.
      }
      return;
    }
    if (!isNativeCapacitorPlatform() || !storageKey) return;
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({
        path: `${nativeMediaRoot}/${storageKey}`,
        directory: Directory.Data,
      });
    } catch {
      // Ignore missing file errors.
    }
  };

  return {
    canUseNativeMediaStorage,
    getNativeMediaPlaybackUrl,
    writeNativeMediaBlob,
    readNativeMediaBlob,
    readNativeMediaSize,
    resolveNativeMediaSourcePath,
    deleteNativeMediaBlob,
  };
};
