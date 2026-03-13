import type { PadData, SamplerBank } from '../types/sampler';
import type { MediaBackend, NativeMediaKind } from './useSamplerStore.nativeMedia';
import type { NativeMediaStorageTargets } from './useSamplerStore.nativeMedia';

type FileHandleType = 'audio' | 'image';

export type MediaReferenceSet = {
  audioDb: Set<string>;
  imageDb: Set<string>;
  nativeKeys: Set<string>;
};

export interface MediaStorageDeps {
  isNativeCapacitorPlatform: () => boolean;
  supportsFileSystemAccess: () => boolean;
  getFileHandle: (id: string, type: FileHandleType) => Promise<FileSystemFileHandle | null>;
  saveBlobToDB: (id: string, blob: Blob, isImage?: boolean) => Promise<void>;
  getBlobFromDB: (id: string) => Promise<Blob | null>;
  deleteBlobFromDB: (id: string, isImage?: boolean) => Promise<void>;
  deleteFileHandle: (id: string, type: FileHandleType) => Promise<void>;
  resolveMediaStorageTargets: (
    padId: string,
    type: NativeMediaKind,
    storageKey?: string,
    backend?: MediaBackend
  ) => NativeMediaStorageTargets;
  nativeMediaRuntime: {
    getNativeMediaPlaybackUrl: (storageKey: string) => Promise<string | null>;
    writeNativeMediaBlob: (
      padId: string,
      blob: Blob,
      type: NativeMediaKind,
      storageKeyHint?: string
    ) => Promise<string | null>;
    readNativeMediaBlob: (storageKey: string, type: NativeMediaKind) => Promise<Blob | null>;
    readNativeMediaSize: (storageKey?: string | null) => Promise<number>;
    deleteNativeMediaBlob: (storageKey?: string | null) => Promise<void>;
  };
}

export const restoreFileAccessPipeline = async (
  input: {
    padId: string;
    type: NativeMediaKind;
    storageKey?: string;
    backend?: MediaBackend;
  },
  deps: MediaStorageDeps
): Promise<{ url: string | null; storageKey?: string; backend: MediaBackend }> => {
  const { padId, type, storageKey, backend } = input;
  const {
    isNativeCapacitorPlatform,
    supportsFileSystemAccess,
    getFileHandle,
    getBlobFromDB,
    resolveMediaStorageTargets,
    nativeMediaRuntime,
  } = deps;
  const targets = resolveMediaStorageTargets(padId, type, storageKey, backend);

  if (isNativeCapacitorPlatform()) {
    for (const nativeKey of targets.nativeKeys) {
      const playbackUrl = await nativeMediaRuntime.getNativeMediaPlaybackUrl(nativeKey);
      if (playbackUrl) {
        return { url: playbackUrl, storageKey: nativeKey, backend: 'native' };
      }
      const blob = await nativeMediaRuntime.readNativeMediaBlob(nativeKey, type);
      if (blob) {
        return { url: URL.createObjectURL(blob), storageKey: nativeKey, backend: 'native' };
      }
    }
  }

  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(targets.canonicalDbId, type);
      if (handle) {
        const permission = await (handle as any).queryPermission?.();
        if (permission === 'granted') {
          const file = await handle.getFile();
          return { url: URL.createObjectURL(file), storageKey, backend: 'idb' };
        }
      }
    } catch {
      // Continue to blob fallback.
    }
  }

  try {
    for (const dbId of targets.dbIds) {
      const blob = await getBlobFromDB(dbId);
      if (blob) {
        return { url: URL.createObjectURL(blob), storageKey: dbId, backend: 'idb' };
      }
    }
  } catch {
    // Continue to native fallback probe.
  }

  if (isNativeCapacitorPlatform() && (!storageKey || backend === 'native')) {
    const candidateKeys: string[] = [];
    if (storageKey) {
      candidateKeys.push(storageKey);
    }
    const extensions =
      type === 'audio'
        ? ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'bin']
        : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bin'];
    extensions.forEach((ext) => candidateKeys.push(`${type}/${padId}.${ext}`));
    for (const candidate of candidateKeys) {
      const playbackUrl = await nativeMediaRuntime.getNativeMediaPlaybackUrl(candidate);
      if (playbackUrl) {
        return { url: playbackUrl, storageKey: candidate, backend: 'native' };
      }
      const blob = await nativeMediaRuntime.readNativeMediaBlob(candidate, type);
      if (blob) {
        return { url: URL.createObjectURL(blob), storageKey: candidate, backend: 'native' };
      }
    }
  }

  return { url: null, storageKey, backend: backend || (storageKey ? 'native' : 'idb') };
};

export const storeFilePipeline = async (
  input: {
    padId: string;
    file: File;
    type: NativeMediaKind;
    options?: { storageId?: string; nativeStorageKeyHint?: string };
  },
  deps: MediaStorageDeps
): Promise<{ storageKey?: string; backend: MediaBackend }> => {
  const { padId, file, type, options } = input;
  const { isNativeCapacitorPlatform, nativeMediaRuntime, saveBlobToDB } = deps;
  const keyPrefix = type === 'image' ? 'image' : 'audio';
  const storageId = options?.storageId || `${keyPrefix}_${padId}`;

  if (isNativeCapacitorPlatform()) {
    const nativeKey = await nativeMediaRuntime.writeNativeMediaBlob(padId, file, type, options?.nativeStorageKeyHint);
    if (nativeKey) return { storageKey: nativeKey, backend: 'native' };
  }

  await saveBlobToDB(storageId, file, type === 'image');
  return { storageKey: storageId, backend: 'idb' };
};

export const loadPadMediaBlobPipeline = async (
  input: { pad: PadData; type: NativeMediaKind },
  deps: MediaStorageDeps
): Promise<Blob | null> => {
  const { pad, type } = input;
  const {
    supportsFileSystemAccess,
    getFileHandle,
    getBlobFromDB,
    resolveMediaStorageTargets,
    nativeMediaRuntime,
  } = deps;
  const storageKey = type === 'audio' ? pad.audioStorageKey : pad.imageStorageKey;
  const backend = type === 'audio' ? pad.audioBackend : pad.imageBackend;
  const targets = resolveMediaStorageTargets(pad.id, type, storageKey, backend);

  for (const nativeKey of targets.nativeKeys) {
    const nativeBlob = await nativeMediaRuntime.readNativeMediaBlob(nativeKey, type);
    if (nativeBlob) return nativeBlob;
  }

  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(targets.canonicalDbId, type);
      if (handle && (await (handle as any).queryPermission?.()) === 'granted') {
        const file = await handle.getFile();
        return file;
      }
    } catch {
      // Continue to IndexedDB fallback.
    }
  }

  try {
    for (const dbId of targets.dbIds) {
      const blob = await getBlobFromDB(dbId);
      if (blob) return blob;
    }
  } catch {
    // Continue to URL fallback.
  }

  const mediaUrl = type === 'audio' ? pad.audioUrl : pad.imageUrl;
  if (mediaUrl) {
    try {
      return await (await fetch(mediaUrl)).blob();
    } catch {
      return null;
    }
  }
  return null;
};

export const loadPadMediaBlobWithUrlFallbackPipeline = async (
  input: { pad: PadData; type: NativeMediaKind },
  deps: MediaStorageDeps
): Promise<Blob | null> => {
  const { pad, type } = input;
  const stored = await loadPadMediaBlobPipeline({ pad, type }, deps);
  if (stored) return stored;
  const mediaUrl = type === 'audio' ? pad.audioUrl : pad.imageUrl;
  if (!mediaUrl) return null;
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
};

export const estimatePadMediaBytesPipeline = async (
  input: { pad: PadData; type: NativeMediaKind },
  deps: MediaStorageDeps
): Promise<number> => {
  const { pad, type } = input;
  const {
    supportsFileSystemAccess,
    getFileHandle,
    getBlobFromDB,
    resolveMediaStorageTargets,
    nativeMediaRuntime,
  } = deps;
  const storageKey = type === 'audio' ? pad.audioStorageKey : pad.imageStorageKey;
  const backend = type === 'audio' ? pad.audioBackend : pad.imageBackend;
  const targets = resolveMediaStorageTargets(pad.id, type, storageKey, backend);

  for (const nativeKey of targets.nativeKeys) {
    const nativeSize = await nativeMediaRuntime.readNativeMediaSize(nativeKey);
    if (nativeSize > 0) return nativeSize;
  }

  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(targets.canonicalDbId, type);
      if (handle && (await (handle as any).queryPermission?.()) === 'granted') {
        const file = await handle.getFile();
        if (file?.size) return file.size;
      }
    } catch {
      // Continue to IndexedDB fallback.
    }
  }
  try {
    for (const dbId of targets.dbIds) {
      const blob = await getBlobFromDB(dbId);
      if (blob) return blob.size;
    }
  } catch {
    // Continue to URL fallback.
  }
  const mediaUrl = type === 'audio' ? pad.audioUrl : pad.imageUrl;
  if (mediaUrl) {
    try {
      const blob = await (await fetch(mediaUrl)).blob();
      return blob.size;
    } catch {
      return 0;
    }
  }
  return 0;
};

export const deletePadMediaArtifactsPipeline = async (
  input: { pad: Partial<PadData> & { id: string }; type?: NativeMediaKind },
  deps: MediaStorageDeps
): Promise<void> => {
  const { pad, type } = input;
  const { deleteBlobFromDB, deleteFileHandle, resolveMediaStorageTargets, nativeMediaRuntime } = deps;
  const mediaTypes: NativeMediaKind[] = type ? [type] : ['audio', 'image'];

  await Promise.all(mediaTypes.map(async (mediaType) => {
    const storageKey = mediaType === 'audio' ? pad.audioStorageKey : pad.imageStorageKey;
    const backend = mediaType === 'audio' ? pad.audioBackend : pad.imageBackend;
    const targets = resolveMediaStorageTargets(pad.id, mediaType, storageKey, backend);
    const isImage = mediaType === 'image';

    await Promise.all([
      ...targets.dbIds.map((dbId) => deleteBlobFromDB(dbId, isImage)),
      deleteFileHandle(targets.canonicalDbId, mediaType),
      ...targets.nativeKeys.map((nativeKey) => nativeMediaRuntime.deleteNativeMediaBlob(nativeKey)),
    ]);
  }));
};

export const collectMediaReferenceSetPipeline = (
  banks: SamplerBank[],
  resolveMediaStorageTargetsFn: MediaStorageDeps['resolveMediaStorageTargets']
): MediaReferenceSet => {
  const refs: MediaReferenceSet = {
    audioDb: new Set<string>(),
    imageDb: new Set<string>(),
    nativeKeys: new Set<string>(),
  };

  banks.forEach((bank) => {
    bank.pads.forEach((pad) => {
      const audioTargets = resolveMediaStorageTargetsFn(pad.id, 'audio', pad.audioStorageKey, pad.audioBackend);
      audioTargets.dbIds.forEach((dbId) => refs.audioDb.add(dbId));
      audioTargets.nativeKeys.forEach((nativeKey) => refs.nativeKeys.add(nativeKey));

      const imageTargets = resolveMediaStorageTargetsFn(pad.id, 'image', pad.imageStorageKey, pad.imageBackend);
      imageTargets.dbIds.forEach((dbId) => refs.imageDb.add(dbId));
      imageTargets.nativeKeys.forEach((nativeKey) => refs.nativeKeys.add(nativeKey));
    });
  });

  return refs;
};

export const deletePadMediaArtifactsExceptPipeline = async (
  input: { pad: Partial<PadData> & { id: string }; keepRefs: MediaReferenceSet },
  deps: MediaStorageDeps
): Promise<void> => {
  const { pad, keepRefs } = input;
  const { deleteBlobFromDB, deleteFileHandle, resolveMediaStorageTargets, nativeMediaRuntime } = deps;
  const audioTargets = resolveMediaStorageTargets(pad.id, 'audio', pad.audioStorageKey, pad.audioBackend);
  const audioBlobDeletes = audioTargets.dbIds
    .filter((dbId) => !keepRefs.audioDb.has(dbId))
    .map((dbId) => deleteBlobFromDB(dbId, false));
  await Promise.all([
    ...audioBlobDeletes,
    ...audioTargets.nativeKeys
      .filter((nativeKey) => !keepRefs.nativeKeys.has(nativeKey))
      .map((nativeKey) => nativeMediaRuntime.deleteNativeMediaBlob(nativeKey)),
  ]);
  if (!keepRefs.audioDb.has(audioTargets.canonicalDbId)) {
    await deleteFileHandle(audioTargets.canonicalDbId, 'audio');
  }

  const imageTargets = resolveMediaStorageTargets(pad.id, 'image', pad.imageStorageKey, pad.imageBackend);
  const imageBlobDeletes = imageTargets.dbIds
    .filter((dbId) => !keepRefs.imageDb.has(dbId))
    .map((dbId) => deleteBlobFromDB(dbId, true));
  await Promise.all([
    ...imageBlobDeletes,
    ...imageTargets.nativeKeys
      .filter((nativeKey) => !keepRefs.nativeKeys.has(nativeKey))
      .map((nativeKey) => nativeMediaRuntime.deleteNativeMediaBlob(nativeKey)),
  ]);
  if (!keepRefs.imageDb.has(imageTargets.canonicalDbId)) {
    await deleteFileHandle(imageTargets.canonicalDbId, 'image');
  }
};

export const estimateBankMediaBytesPipeline = async (
  bank: SamplerBank,
  estimatePadMediaBytes: (pad: PadData, type: NativeMediaKind) => Promise<number>
): Promise<number> => {
  let total = 0;
  for (const pad of bank.pads) {
    total += await estimatePadMediaBytes(pad, 'audio');
    total += await estimatePadMediaBytes(pad, 'image');
  }
  return total;
};
