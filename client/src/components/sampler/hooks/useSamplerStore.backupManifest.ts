export interface BackupPartManifestEntry {
  index: number;
  fileName: string;
  size: number;
  offset: number;
}

export interface BackupArchiveManifest {
  schema: string;
  manifestVersion: number;
  backupVersion: number;
  backupId: string;
  exportedAt: string;
  userId: string;
  encryptedSize: number;
  partSize: number;
  parts: BackupPartManifestEntry[];
}

export interface AssembleBackupPartsInput {
  manifest: BackupArchiveManifest;
  manifestFile: File;
  companionFiles: File[];
  maxBackupPartCount: number;
  readNativeBackupPartByName?: (fileName: string) => Promise<File | null>;
}

export interface AssembleBackupPartsResult {
  encryptedBlob: Blob;
  resolvedParts: number;
  missingParts: string[];
  expectedParts: number;
}

const isBackupManifestLike = (
  value: unknown,
  backupManifestSchema: string
): value is BackupArchiveManifest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackupArchiveManifest>;
  if (candidate.schema !== backupManifestSchema) return false;
  if (!Array.isArray(candidate.parts)) return false;
  if (typeof candidate.userId !== 'string' || !candidate.userId.trim()) return false;
  return candidate.parts.every(
    (part) =>
      part &&
      typeof part.index === 'number' &&
      Number.isFinite(part.index) &&
      typeof part.fileName === 'string' &&
      part.fileName.trim().length > 0 &&
      typeof part.size === 'number' &&
      part.size >= 0
  );
};

export const parseBackupManifestFile = async (
  file: File,
  backupManifestSchema: string
): Promise<BackupArchiveManifest | null> => {
  if (file.size > 8 * 1024 * 1024) return null;

  try {
    const preview = await file.slice(0, 128).text();
    if (!preview.trimStart().startsWith('{')) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(await file.text()) as unknown;
    if (!isBackupManifestLike(payload, backupManifestSchema)) return null;
    return payload;
  } catch {
    return null;
  }
};

export const assembleBackupPartsBlob = async (
  input: AssembleBackupPartsInput
): Promise<AssembleBackupPartsResult> => {
  const {
    manifest,
    manifestFile,
    companionFiles,
    maxBackupPartCount,
    readNativeBackupPartByName,
  } = input;

  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new Error('This backup file is incomplete.');
  }
  if (manifest.parts.length > maxBackupPartCount) {
    throw new Error(
      `Backup manifest lists ${manifest.parts.length} parts, exceeding supported limit (${maxBackupPartCount}).`
    );
  }

  const fileByLowerName = new Map<string, File>();
  const allSelected = [manifestFile, ...companionFiles];
  allSelected.forEach((selectedFile) => {
    fileByLowerName.set(selectedFile.name.toLowerCase(), selectedFile);
  });

  const missing: string[] = [];
  const resolvedParts: Array<{ entry: BackupPartManifestEntry; file: File }> = [];

  const sortedParts = [...manifest.parts].sort((a, b) => a.index - b.index);
  const seenPartFileNames = new Set<string>();
  sortedParts.forEach((entry, sequenceIndex) => {
    if (entry.index !== sequenceIndex) {
      throw new Error(
        `Backup manifest is invalid: expected part index ${sequenceIndex}, found ${entry.index} (${entry.fileName}).`
      );
    }
    const lowerName = entry.fileName.toLowerCase();
    if (seenPartFileNames.has(lowerName)) {
      throw new Error(`Backup manifest is invalid: duplicate part file "${entry.fileName}".`);
    }
    seenPartFileNames.add(lowerName);
  });

  let assembledSize = 0;
  for (const entry of sortedParts) {
    let partFile = fileByLowerName.get(entry.fileName.toLowerCase()) || null;
    if (!partFile && readNativeBackupPartByName) {
      partFile = await readNativeBackupPartByName(entry.fileName);
      if (partFile) {
        fileByLowerName.set(entry.fileName.toLowerCase(), partFile);
      }
    }

    if (!partFile) {
      missing.push(entry.fileName);
      continue;
    }

    if (typeof entry.size === 'number' && entry.size >= 0 && partFile.size !== entry.size) {
      throw new Error(
        `Backup part "${entry.fileName}" size mismatch. Expected ${entry.size} bytes, got ${partFile.size} bytes.`
      );
    }

    assembledSize += partFile.size;
    resolvedParts.push({ entry, file: partFile });
  }

  if (missing.length > 0) {
    return {
      encryptedBlob: new Blob(),
      resolvedParts: resolvedParts.length,
      missingParts: missing,
      expectedParts: sortedParts.length,
    };
  }

  const orderedFiles = resolvedParts
    .sort((a, b) => a.entry.index - b.entry.index)
    .map((part) => part.file);

  if (typeof manifest.encryptedSize === 'number' && manifest.encryptedSize > 0 && assembledSize !== manifest.encryptedSize) {
    throw new Error(
      `Backup payload size mismatch. Expected ${manifest.encryptedSize} bytes, assembled ${assembledSize} bytes.`
    );
  }

  return {
    encryptedBlob: new Blob(orderedFiles, { type: 'application/octet-stream' }),
    resolvedParts: orderedFiles.length,
    missingParts: [],
    expectedParts: sortedParts.length,
  };
};
