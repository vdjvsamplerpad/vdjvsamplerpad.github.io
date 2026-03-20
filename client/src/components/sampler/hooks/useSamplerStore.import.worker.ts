/// <reference lib="webworker" />

import JSZip, { type JSZipObject } from 'jszip';
import { decryptEncryptedBankBlob, doesEncryptedBankPasswordMatch } from '@/lib/bank-encryption';
import {
  assertSafeBankImportArchive,
  hasVdjvEncryptionMagic,
  hasZipMagicHeader,
  normalizeArchiveAssetPath,
} from './useSamplerStore.importUtils';
import type {
  ImportWorkerAssetPayload,
  ImportWorkerOpenResult,
  ImportWorkerPadChunkDescriptor,
  ImportWorkerPadChunkItem,
  ImportWorkerRequest,
  ImportWorkerResponse,
} from './useSamplerStore.importWorkerShared';

let activeArchive: JSZip | null = null;

const respond = (message: ImportWorkerResponse) => {
  self.postMessage(message);
};

const asErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'Unknown import worker error');

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const loadZipFromBlob = async (blob: Blob, timeoutMs: number): Promise<JSZip> => {
  try {
    return await withTimeout(new JSZip().loadAsync(blob), timeoutMs, 'Zip load');
  } catch {
    const buffer = await blob.arrayBuffer();
    return await withTimeout(new JSZip().loadAsync(buffer), timeoutMs, 'Zip load');
  }
};

const inferMimeType = (assetPath: string): string => {
  const normalized = assetPath.trim().toLowerCase();
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  if (normalized.endsWith('.ogg')) return 'audio/ogg';
  if (normalized.endsWith('.m4a')) return 'audio/mp4';
  if (normalized.endsWith('.aac')) return 'audio/aac';
  if (normalized.endsWith('.flac')) return 'audio/flac';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
};

const entryToAssetPayload = async (entry: JSZipObject, assetPath: string): Promise<ImportWorkerAssetPayload | null> => {
  const buffer = await entry.async('arraybuffer');
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) return null;
  return {
    buffer,
    type: inferMimeType(assetPath),
    size: buffer.byteLength,
  };
};

const readOptionalJsonFile = async <T,>(archive: JSZip, path: string, timeoutMs: number): Promise<T | null> => {
  const entry = archive.file(path);
  if (!entry) return null;
  const text = await withTimeout(entry.async('string'), timeoutMs, `${path} load`);
  return JSON.parse(text) as T;
};

const openArchive = async (file: File, candidateKeys: string[], timeoutMs: number): Promise<ImportWorkerOpenResult> => {
  const looksLikePlainZip = await hasZipMagicHeader(file);
  let archive: JSZip | null = null;
  let usedKey: string | null = null;

  if (looksLikePlainZip) {
    archive = await loadZipFromBlob(file, timeoutMs);
  } else if (await hasVdjvEncryptionMagic(file)) {
    for (const candidateKey of candidateKeys) {
      const normalizedKey = candidateKey.trim();
      if (!normalizedKey) continue;
      const headerMatch = await withTimeout(
        doesEncryptedBankPasswordMatch(file, normalizedKey),
        Math.min(timeoutMs, 10_000),
        'Encrypted header check'
      );
      if (!headerMatch) continue;
      const decryptedBlob = await withTimeout(
        decryptEncryptedBankBlob(file, normalizedKey),
        timeoutMs,
        'Decrypt archive'
      );
      archive = await loadZipFromBlob(decryptedBlob, timeoutMs);
      usedKey = normalizedKey;
      break;
    }
    if (!archive) {
      throw new Error('Cannot decrypt bank file. Please ensure you have access to this bank.');
    }
  } else {
    throw new Error('This file is not a valid bank file.');
  }

  assertSafeBankImportArchive(archive);
  const bankJsonEntry = archive.file('bank.json');
  if (!bankJsonEntry) {
    throw new Error('Invalid bank file: bank.json not found. This may not be a valid bank file.');
  }
  const bankJsonText = await withTimeout(bankJsonEntry.async('string'), timeoutMs, 'Bank JSON load');
  const bankData = JSON.parse(bankJsonText) as Record<string, unknown>;
  if (!bankData || typeof bankData !== 'object' || !bankData.name || !Array.isArray(bankData.pads)) {
    throw new Error('Invalid bank file format: Missing required fields');
  }
  const metadata = await readOptionalJsonFile<Record<string, unknown>>(archive, 'metadata.json', timeoutMs);
  activeArchive = archive;
  return {
    bankJsonText,
    bankData,
    metadata: metadata as unknown as ImportWorkerOpenResult['metadata'],
    usedKey,
  };
};

const extractThumbnail = async (assetPath: string | null): Promise<ImportWorkerAssetPayload | null> => {
  if (!activeArchive || !assetPath) return null;
  const normalizedPath = normalizeArchiveAssetPath(assetPath);
  if (!normalizedPath) return null;
  const entry = activeArchive.file(normalizedPath);
  if (!entry) return null;
  return entryToAssetPayload(entry, normalizedPath);
};

const extractPadChunk = async (chunk: ImportWorkerPadChunkDescriptor[]): Promise<ImportWorkerPadChunkItem[]> => {
  if (!activeArchive) {
    throw new Error('Import archive is not open.');
  }
  const items: ImportWorkerPadChunkItem[] = [];
  for (const descriptor of chunk) {
    const audioPath = descriptor.audioPath ? normalizeArchiveAssetPath(descriptor.audioPath) : '';
    const imagePath = descriptor.imagePath ? normalizeArchiveAssetPath(descriptor.imagePath) : '';
    const audioEntry = audioPath ? activeArchive.file(audioPath) : null;
    const imageEntry = imagePath ? activeArchive.file(imagePath) : null;
    items.push({
      index: descriptor.index,
      audio: audioEntry ? await entryToAssetPayload(audioEntry, audioPath) : null,
      image: imageEntry ? await entryToAssetPayload(imageEntry, imagePath) : null,
    });
  }
  return items;
};

self.onmessage = async (event: MessageEvent<ImportWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'open') {
      const result = await openArchive(message.file, message.candidateKeys, message.timeoutMs);
      respond({ id: message.id, type: 'open-result', result });
      return;
    }

    if (message.type === 'extract-thumbnail') {
      const asset = await extractThumbnail(message.assetPath);
      const transfer = asset ? [asset.buffer] : [];
      self.postMessage({ id: message.id, type: 'thumbnail-result', asset } satisfies ImportWorkerResponse, transfer);
      return;
    }

    if (message.type === 'extract-pad-chunk') {
      const items = await extractPadChunk(message.chunk);
      const transfer: ArrayBuffer[] = [];
      items.forEach((item) => {
        if (item.audio?.buffer) transfer.push(item.audio.buffer);
        if (item.image?.buffer) transfer.push(item.image.buffer);
      });
      self.postMessage({ id: message.id, type: 'pad-chunk-result', items } satisfies ImportWorkerResponse, transfer);
      return;
    }

    if (message.type === 'dispose') {
      activeArchive = null;
      respond({ id: message.id, type: 'disposed' });
    }
  } catch (error) {
    respond({
      id: message.id,
      type: 'error',
      message: asErrorMessage(error),
    });
  }
};

export {};
