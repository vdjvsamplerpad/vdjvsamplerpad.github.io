import { PadData, SamplerBank } from '../types/sampler';
import {
  createNativeMediaRuntime,
  resolveMediaStorageTargets,
} from './useSamplerStore.nativeMedia';
import {
  collectMediaReferenceSetPipeline,
  deletePadMediaArtifactsExceptPipeline,
  deletePadMediaArtifactsPipeline,
  estimateBankMediaBytesPipeline,
  estimatePadMediaBytesPipeline,
  loadPadMediaBlobPipeline,
  loadPadMediaBlobWithUrlFallbackPipeline,
  resolvePadMediaSourcePathPipeline,
  restoreFileAccessPipeline,
  storeFilePipeline,
  type MediaReferenceSet,
} from './useSamplerStore.mediaStorage';
import {
  deleteBlobFromDB,
  deleteFileHandle,
  getBlobFromDB,
  getFileHandle,
  saveBlobToDB,
  supportsFileSystemAccess,
} from './useSamplerStore.idbStorage';

export type MediaBackend = 'native' | 'idb';

type CreateSamplerMediaHelpersInput = {
  isNativeCapacitorPlatform: () => boolean;
  nativeMediaRoot: string;
  maxNativeAudioWriteBytes: number;
  maxNativeImageWriteBytes: number;
  maxCapacitorBridgeReadBytes: number;
  extFromMime: (mime: string, type: 'audio' | 'image') => string;
  mimeFromExt: (ext: string, type: 'audio' | 'image') => string;
  parseStorageKeyExt: (storageKey: string | undefined | null) => string | null;
  blobToBase64: (blob: Blob) => Promise<string>;
  normalizeBase64Data: (input: string) => string;
};

export type SamplerMediaHelpers = {
  restoreFileAccess: (
    padId: string,
    type: 'audio' | 'image',
    storageKey?: string,
    backend?: MediaBackend
  ) => Promise<{ url: string | null; storageKey?: string; backend: MediaBackend }>;
  storeFile: (
    padId: string,
    file: File,
    type: 'audio' | 'image',
    options?: { storageId?: string; nativeStorageKeyHint?: string }
  ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
  loadPadMediaBlob: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
  loadPadMediaBlobWithUrlFallback: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
  estimatePadMediaBytes: (pad: PadData, type: 'audio' | 'image') => Promise<number>;
  deletePadMediaArtifacts: (pad: Partial<PadData> & { id: string }, type?: 'audio' | 'image') => Promise<void>;
  collectMediaReferenceSet: (banks: SamplerBank[]) => MediaReferenceSet;
  deletePadMediaArtifactsExcept: (pad: Partial<PadData> & { id: string }, keepRefs: MediaReferenceSet) => Promise<void>;
  estimateBankMediaBytes: (bank: SamplerBank) => Promise<number>;
  resolvePadMediaSourcePath: (pad: PadData, type: 'audio' | 'image') => Promise<string | null>;
};

export const createSamplerMediaHelpers = (input: CreateSamplerMediaHelpersInput): SamplerMediaHelpers => {
  const nativeMediaRuntime = createNativeMediaRuntime({
    isNativeCapacitorPlatform: input.isNativeCapacitorPlatform,
    nativeMediaRoot: input.nativeMediaRoot,
    maxNativeAudioWriteBytes: input.maxNativeAudioWriteBytes,
    maxNativeImageWriteBytes: input.maxNativeImageWriteBytes,
    maxCapacitorBridgeReadBytes: input.maxCapacitorBridgeReadBytes,
    extFromMime: input.extFromMime,
    mimeFromExt: input.mimeFromExt,
    parseStorageKeyExt: input.parseStorageKeyExt,
    blobToBase64: input.blobToBase64,
    normalizeBase64Data: input.normalizeBase64Data,
  });

  const mediaStorageDeps = {
    isNativeCapacitorPlatform: input.isNativeCapacitorPlatform,
    supportsFileSystemAccess,
    getFileHandle,
    saveBlobToDB,
    getBlobFromDB,
    deleteBlobFromDB,
    deleteFileHandle,
    resolveMediaStorageTargets,
    nativeMediaRuntime,
  };

  const restoreFileAccess = async (
    padId: string,
    type: 'audio' | 'image',
    storageKey?: string,
    backend?: MediaBackend
  ): Promise<{ url: string | null; storageKey?: string; backend: MediaBackend }> =>
    restoreFileAccessPipeline({ padId, type, storageKey, backend }, mediaStorageDeps);

  const storeFile = async (
    padId: string,
    file: File,
    type: 'audio' | 'image',
    options?: { storageId?: string; nativeStorageKeyHint?: string }
  ): Promise<{ storageKey?: string; backend: MediaBackend }> =>
    storeFilePipeline({ padId, file, type, options }, mediaStorageDeps);

  const loadPadMediaBlob = async (pad: PadData, type: 'audio' | 'image'): Promise<Blob | null> =>
    loadPadMediaBlobPipeline({ pad, type }, mediaStorageDeps);

  const loadPadMediaBlobWithUrlFallback = async (pad: PadData, type: 'audio' | 'image'): Promise<Blob | null> =>
    loadPadMediaBlobWithUrlFallbackPipeline({ pad, type }, mediaStorageDeps);

  const estimatePadMediaBytes = async (pad: PadData, type: 'audio' | 'image'): Promise<number> =>
    estimatePadMediaBytesPipeline({ pad, type }, mediaStorageDeps);

  const deletePadMediaArtifacts = async (
    pad: Partial<PadData> & { id: string },
    type?: 'audio' | 'image'
  ): Promise<void> =>
    deletePadMediaArtifactsPipeline({ pad, type }, mediaStorageDeps);

  const collectMediaReferenceSet = (banks: SamplerBank[]): MediaReferenceSet =>
    collectMediaReferenceSetPipeline(banks, resolveMediaStorageTargets);

  const deletePadMediaArtifactsExcept = async (
    pad: Partial<PadData> & { id: string },
    keepRefs: MediaReferenceSet
  ): Promise<void> =>
    deletePadMediaArtifactsExceptPipeline({ pad, keepRefs }, mediaStorageDeps);

  const estimateBankMediaBytes = async (bank: SamplerBank): Promise<number> =>
    estimateBankMediaBytesPipeline(bank, estimatePadMediaBytes);

  const resolvePadMediaSourcePath = async (pad: PadData, type: 'audio' | 'image'): Promise<string | null> =>
    resolvePadMediaSourcePathPipeline({ pad, type }, mediaStorageDeps);

  return {
    restoreFileAccess,
    storeFile,
    loadPadMediaBlob,
    loadPadMediaBlobWithUrlFallback,
    estimatePadMediaBytes,
    deletePadMediaArtifacts,
    collectMediaReferenceSet,
    deletePadMediaArtifactsExcept,
    estimateBankMediaBytes,
    resolvePadMediaSourcePath,
  };
};
