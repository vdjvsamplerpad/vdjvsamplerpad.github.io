import type { BankMetadata } from '../types/sampler';

export interface ImportWorkerAssetPayload {
  buffer: ArrayBuffer;
  type: string;
  size: number;
}

export interface ImportWorkerPadChunkDescriptor {
  index: number;
  audioPath: string | null;
  imagePath: string | null;
}

export interface ImportWorkerPadChunkItem {
  index: number;
  audio: ImportWorkerAssetPayload | null;
  image: ImportWorkerAssetPayload | null;
}

export interface ImportWorkerOpenResult {
  bankJsonText: string;
  bankData: Record<string, unknown>;
  metadata: BankMetadata | null;
  usedKey: string | null;
}

export type ImportWorkerRequest =
  | {
      id: number;
      type: 'open';
      file: File;
      candidateKeys: string[];
      timeoutMs: number;
    }
  | {
      id: number;
      type: 'extract-thumbnail';
      assetPath: string | null;
    }
  | {
      id: number;
      type: 'extract-pad-chunk';
      chunk: ImportWorkerPadChunkDescriptor[];
    }
  | {
      id: number;
      type: 'dispose';
    };

export type ImportWorkerResponse =
  | {
      id: number;
      type: 'open-result';
      result: ImportWorkerOpenResult;
    }
  | {
      id: number;
      type: 'thumbnail-result';
      asset: ImportWorkerAssetPayload | null;
    }
  | {
      id: number;
      type: 'pad-chunk-result';
      items: ImportWorkerPadChunkItem[];
    }
  | {
      id: number;
      type: 'disposed';
    }
  | {
      id: number;
      type: 'error';
      message: string;
    };
