export type ElectronExportArchiveJobRawEntry = {
  kind: 'raw';
  path: string;
  data?: Uint8Array;
  sourcePath?: string;
  cleanupSourcePath?: boolean;
};

export type ElectronExportArchiveJobAudioEntry = {
  kind: 'audio';
  path: string;
  sourcePath: string;
  mimeType?: string;
  transform: 'copy' | 'trim' | 'trim_mp3';
  startTimeMs?: number;
  endTimeMs?: number;
  bitrate?: number;
  cleanupSourcePath?: boolean;
};

export type ElectronExportArchiveJobEntry =
  | ElectronExportArchiveJobRawEntry
  | ElectronExportArchiveJobAudioEntry;

export type ElectronExportArchiveJobInput = {
  jobId: string;
  entries: ElectronExportArchiveJobEntry[];
  fileName: string;
  relativeFolder?: string;
  compression?: 'STORE' | 'DEFLATE';
  encryptionPassword?: string;
  returnArchiveBytes?: boolean;
};

export type ElectronExportArchiveJobResponse = {
  savedPath?: string;
  archiveBytes?: number;
  archiveData?: Uint8Array | ArrayBuffer | number[] | { data: number[] };
  message?: string;
};

export type ElectronExportArchiveJobResult = {
  savedPath?: string;
  archiveBytes: number;
  archiveData?: Uint8Array;
  message?: string;
};

export const normalizeElectronBinaryPayload = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && typeof value === 'object' && Array.isArray((value as { data?: number[] }).data)) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  return null;
};

export const describeElectronBinaryPayload = (value: unknown): string => {
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength})`;
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength})`;
  if (Array.isArray(value)) return `number[](${value.length})`;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: number[] }).data)) {
    return `{ data: number[](${(value as { data: number[] }).data.length}) }`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{ ${keys.length > 0 ? keys.join(', ') : 'no-keys'} }`;
  }
  return String(value);
};

export const encodeTextToUint8Array = (value: string): Uint8Array => new TextEncoder().encode(value);
