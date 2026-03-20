import type {
  ImportWorkerAssetPayload,
  ImportWorkerOpenResult,
  ImportWorkerPadChunkDescriptor,
  ImportWorkerPadChunkItem,
  ImportWorkerRequest,
  ImportWorkerResponse,
} from './useSamplerStore.importWorkerShared';

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type OpenWorkerRequest = Extract<ImportWorkerRequest, { type: 'open' }>;
type ThumbnailWorkerRequest = Extract<ImportWorkerRequest, { type: 'extract-thumbnail' }>;
type PadChunkWorkerRequest = Extract<ImportWorkerRequest, { type: 'extract-pad-chunk' }>;
type DisposeWorkerRequest = Extract<ImportWorkerRequest, { type: 'dispose' }>;

export interface ImportArchiveWorkerClient {
  open: (file: File, candidateKeys: string[], timeoutMs: number) => Promise<ImportWorkerOpenResult>;
  extractThumbnail: (assetPath: string | null) => Promise<ImportWorkerAssetPayload | null>;
  extractPadChunk: (chunk: ImportWorkerPadChunkDescriptor[]) => Promise<ImportWorkerPadChunkItem[]>;
  dispose: () => Promise<void>;
}

export const createImportArchiveWorkerClient = (): ImportArchiveWorkerClient => {
  const worker = new Worker(new URL('./useSamplerStore.import.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();

  worker.onmessage = (event: MessageEvent<ImportWorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.type === 'error') {
      entry.reject(new Error(response.message));
      return;
    }
    if (response.type === 'open-result') {
      entry.resolve(response.result);
      return;
    }
    if (response.type === 'thumbnail-result') {
      entry.resolve(response.asset);
      return;
    }
    if (response.type === 'pad-chunk-result') {
      entry.resolve(response.items);
      return;
    }
    entry.resolve(undefined);
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Import worker failed.');
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
  };

  const post = <TResponse,>(message: ImportWorkerRequest, transfer: Transferable[] = []): Promise<TResponse> => {
    const id = nextId++;
    return new Promise<TResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  };

  return {
    open: (file, candidateKeys, timeoutMs) =>
      post<ImportWorkerOpenResult>({ type: 'open', id: 0, file, candidateKeys, timeoutMs } satisfies OpenWorkerRequest),
    extractThumbnail: (assetPath) =>
      post<ImportWorkerAssetPayload | null>({ type: 'extract-thumbnail', id: 0, assetPath } satisfies ThumbnailWorkerRequest),
    extractPadChunk: (chunk) =>
      post<ImportWorkerPadChunkItem[]>({ type: 'extract-pad-chunk', id: 0, chunk } satisfies PadChunkWorkerRequest),
    dispose: async () => {
      try {
        await post<void>({ type: 'dispose', id: 0 } satisfies DisposeWorkerRequest);
      } finally {
        worker.terminate();
      }
    },
  };
};
