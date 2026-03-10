import JSZip from 'jszip';

const MAX_IMPORT_ARCHIVE_ENTRY_COUNT = 2000;
const MAX_IMPORT_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_IMPORT_ARCHIVE_ENTRY_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const VDJV_ENCRYPTION_MAGIC = 'VDJVENC2';

const fnv1aHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildBankDuplicateSignature = (name: string, padNames: string[]): string => {
  const normalizedName = name.trim().toLowerCase();
  const normalizedPadNames = padNames
    .map((padName) => padName.trim().toLowerCase())
    .join('|');
  return `sig:${fnv1aHash(`${normalizedName}::${padNames.length}::${normalizedPadNames}`)}:${padNames.length}`;
};

export const getBankDuplicateSignature = (
  bankLike: { name?: string; pads?: Array<{ name?: string }> } | null | undefined
): string | null => {
  const name = typeof bankLike?.name === 'string' ? bankLike.name : '';
  const pads = Array.isArray(bankLike?.pads) ? bankLike.pads : [];
  if (!name || !pads.length) return null;
  const padNames = pads.map((pad) => (typeof pad?.name === 'string' ? pad.name : ''));
  return buildBankDuplicateSignature(name, padNames);
};

const readZipEntryUncompressedBytes = (entry: any): number | null => {
  const raw = Number(entry?._data?.uncompressedSize || 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
};

export const assertSafeBankImportArchive = (zip: JSZip): void => {
  const entries = Object.values(zip.files || {});
  if (entries.length > MAX_IMPORT_ARCHIVE_ENTRY_COUNT) {
    throw new Error(
      `Bank archive has too many files (${entries.length}). Maximum supported is ${MAX_IMPORT_ARCHIVE_ENTRY_COUNT}.`
    );
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    if ((entry as any)?.dir) continue;
    const uncompressedBytes = readZipEntryUncompressedBytes(entry);
    if (uncompressedBytes !== null && uncompressedBytes > MAX_IMPORT_ARCHIVE_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Bank archive contains an oversized file (${Math.ceil(uncompressedBytes / (1024 * 1024))}MB).`
      );
    }
    if (uncompressedBytes !== null) {
      totalUncompressedBytes += uncompressedBytes;
      if (totalUncompressedBytes > MAX_IMPORT_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Bank archive is too large after extraction (${Math.ceil(totalUncompressedBytes / (1024 * 1024))}MB).`
        );
      }
    }
  }
};

const extractErrorText = (error: unknown): string => {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase();
  return String(error || '').toLowerCase();
};

export const isFileAccessDeniedError = (error: unknown): boolean => {
  const text = extractErrorText(error);
  return (
    text.includes('permission to access file') ||
    text.includes('notreadableerror') ||
    text.includes('requested file could not be read') ||
    text.includes('securityerror') ||
    text.includes('permission denied') ||
    text.includes('not allowed to read local resource') ||
    text.includes('operation not permitted')
  );
};

export const normalizeArchiveAssetPath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/^\/+/, '').trim();

export const hasZipMagicHeader = async (file: Blob): Promise<boolean> => {
  try {
    const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (bytes.length < 4) return false;
    const isPk = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!isPk) return false;
    return (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
  } catch {
    return false;
  }
};

export const hasVdjvEncryptionMagic = async (file: Blob): Promise<boolean> => {
  try {
    const magicBytes = new Uint8Array(await file.slice(0, VDJV_ENCRYPTION_MAGIC.length).arrayBuffer());
    if (magicBytes.length < VDJV_ENCRYPTION_MAGIC.length) return false;
    const magic = new TextDecoder().decode(magicBytes);
    return magic === VDJV_ENCRYPTION_MAGIC;
  } catch {
    return false;
  }
};

export const hasWebCryptoSubtle = (): boolean =>
  typeof crypto !== 'undefined' && Boolean(crypto.subtle);
