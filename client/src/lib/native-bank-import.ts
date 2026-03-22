import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeBankImportStage =
  | 'validate-file'
  | 'download-start'
  | 'download-progress'
  | 'decrypt-start'
  | 'metadata-start'
  | 'pads-start'
  | 'pads-progress'
  | 'finalize'
  | 'complete';

export interface NativeBankImportPadResult {
  index: number;
  sourcePadId?: string | null;
  sourcePadName?: string | null;
  audioStorageKey?: string | null;
  audioFilePath?: string | null;
  audioFileUrl?: string | null;
  imageStorageKey?: string | null;
  imageFilePath?: string | null;
  imageFileUrl?: string | null;
  audioBytes?: number | null;
  audioDurationMs?: number | null;
  hasImageAsset?: boolean;
  audioRejectedReason?: string | null;
}

export interface NativeBankImportResult {
  jobId: string;
  sourceFileName: string;
  sourceFileBytes: number;
  encrypted: boolean;
  bankJsonText: string;
  metadataJsonText?: string | null;
  thumbnailStorageKey?: string | null;
  thumbnailFilePath?: string | null;
  thumbnailFileUrl?: string | null;
  pads: NativeBankImportPadResult[];
}

export interface NativeBankImportProgressEvent {
  jobId: string;
  stage: NativeBankImportStage;
  progress?: number;
  message?: string;
  currentPad?: number;
  totalPads?: number;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface NativeBankImportErrorEvent {
  jobId: string;
  message: string;
  stage?: string;
}

export interface NativeSharedBankPickResult {
  uri: string;
  displayName?: string | null;
  size?: number | null;
}

export interface NativeStoreImportJobInput {
  catalogItemId: string;
  bankId: string;
  signedUrl: string;
  fileName?: string;
  expectedSha256?: string;
  preferredDerivedKey?: string | null;
  candidateDerivedKeys?: string[];
  entitlementToken?: string | null;
  userId?: string | null;
}

export interface ElectronImportArchiveJobInput {
  jobId: string;
  source:
    | {
        kind: 'file';
        filePath: string;
        fileName?: string;
        fileBytes?: number | null;
      }
    | {
        kind: 'url';
        signedUrl: string;
        fileName?: string;
        expectedSha256?: string;
      };
  preferredDerivedKey?: string | null;
  candidateDerivedKeys?: string[];
  entitlementToken?: string | null;
  userId?: string | null;
}

export interface NativeSharedImportJobInput {
  uri: string;
  displayName?: string;
  size?: number | null;
  preferredDerivedKey?: string | null;
  preferredBankId?: string | null;
  candidateDerivedKeys?: string[];
  entitlementToken?: string | null;
  userId?: string | null;
}

type NativeBankImportPlugin = {
  pickSharedBankFile: () => Promise<NativeSharedBankPickResult>;
  startStoreImportJob: (input: NativeStoreImportJobInput) => Promise<{ jobId: string }>;
  startSharedImportJob: (input: NativeSharedImportJobInput) => Promise<{ jobId: string }>;
  cancelImportJob: (input: { jobId: string }) => Promise<void>;
  cleanupImportedAssets?: (input: { storageKeys: string[] }) => Promise<void>;
  addListener: (
    eventName: 'nativeImportProgress' | 'nativeImportFinished' | 'nativeImportFailed',
    listenerFunc: (event: any) => void
  ) => Promise<PluginListenerHandle> | PluginListenerHandle;
};

const NativeBankImport = registerPlugin<NativeBankImportPlugin>('NativeBankImport');

const getCapacitorRuntime = (): any => {
  if (typeof window === 'undefined') return Capacitor;
  return (window as any).Capacitor || Capacitor;
};

const isNativeAndroid = (): boolean => {
  const capacitor = getCapacitorRuntime();
  return capacitor?.isNativePlatform?.() === true && capacitor?.getPlatform?.() === 'android';
};

export const isNativeBankImportAvailable = (): boolean => {
  if (!isNativeAndroid()) return false;
  const capacitor = getCapacitorRuntime();
  if (capacitor?.Plugins?.NativeBankImport) return true;
  if (Capacitor.isPluginAvailable('NativeBankImport')) return true;
  // This app registers the Android plugin directly in MainActivity, so it may be callable
  // even when it is not listed in capacitor.plugins.json.
  return true;
};

export const isElectronImportBridgeAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.electronAPI?.importArchiveJob === 'function';

export const pickNativeSharedBankFile = async (): Promise<NativeSharedBankPickResult> => {
  if (!isNativeBankImportAvailable()) {
    throw new Error('Native bank import is not available on this device.');
  }
  return NativeBankImport.pickSharedBankFile();
};

const runNativeImportJob = async (
  start: () => Promise<{ jobId: string }>,
  onProgress?: (event: NativeBankImportProgressEvent) => void
): Promise<NativeBankImportResult> => {
  if (!isNativeBankImportAvailable()) {
    throw new Error('Native bank import is not available on this device.');
  }

  const handles: PluginListenerHandle[] = [];
  let activeJobId: string | null = null;

  const cleanup = async () => {
    await Promise.allSettled(handles.map((handle) => Promise.resolve(handle.remove())));
  };

  try {
    const progressHandle = await Promise.resolve(
      NativeBankImport.addListener('nativeImportProgress', (event: NativeBankImportProgressEvent) => {
        if (!activeJobId || event?.jobId !== activeJobId) return;
        onProgress?.(event);
      })
    );
    const finishedPromise = new Promise<NativeBankImportResult>((resolve, reject) => {
      Promise.resolve(
        NativeBankImport.addListener('nativeImportFinished', (event: { jobId: string; result?: NativeBankImportResult }) => {
          if (!activeJobId || event?.jobId !== activeJobId) return;
          if (!event?.result) {
            reject(new Error('Native import finished without a result.'));
            return;
          }
          resolve(event.result);
        })
      ).then((handle) => handles.push(handle));

      Promise.resolve(
        NativeBankImport.addListener('nativeImportFailed', (event: NativeBankImportErrorEvent) => {
          if (!activeJobId || event?.jobId !== activeJobId) return;
          reject(new Error(event?.message || 'Native import failed.'));
        })
      ).then((handle) => handles.push(handle));
    });

    handles.push(progressHandle);
    const startResult = await start();
    activeJobId = typeof startResult?.jobId === 'string' ? startResult.jobId : null;
    if (!activeJobId) {
      throw new Error('Native import did not return a job id.');
    }
    return await finishedPromise;
  } catch (error) {
    if (activeJobId) {
      await NativeBankImport.cancelImportJob({ jobId: activeJobId }).catch(() => undefined);
    }
    throw error;
  } finally {
    await cleanup();
  }
};

export const runNativeStoreImportJob = async (
  input: NativeStoreImportJobInput,
  onProgress?: (event: NativeBankImportProgressEvent) => void
): Promise<NativeBankImportResult> =>
  runNativeImportJob(() => NativeBankImport.startStoreImportJob(input), onProgress);

export const runNativeSharedImportJob = async (
  input: NativeSharedImportJobInput,
  onProgress?: (event: NativeBankImportProgressEvent) => void
): Promise<NativeBankImportResult> =>
  runNativeImportJob(() => NativeBankImport.startSharedImportJob(input), onProgress);

export const cleanupNativeImportedAssets = async (storageKeys: string[]): Promise<void> => {
  const keys = Array.from(new Set(storageKeys.filter((value) => typeof value === 'string' && value.trim().length > 0)));
  if (keys.length === 0) return;
  if (isNativeBankImportAvailable() && NativeBankImport.cleanupImportedAssets) {
    await NativeBankImport.cleanupImportedAssets({ storageKeys: keys });
    return;
  }
  if (isElectronImportBridgeAvailable()) {
    await Promise.allSettled(
      keys.map((storageKey) => window.electronAPI?.deleteNativeMedia?.({ storageKey }))
    );
  }
};

export const runElectronImportArchiveJob = async (
  input: ElectronImportArchiveJobInput,
  onProgress?: (event: NativeBankImportProgressEvent) => void
): Promise<NativeBankImportResult> => {
  if (!isElectronImportBridgeAvailable()) {
    throw new Error('Electron import bridge is unavailable.');
  }
  const cleanup = window.electronAPI?.onImportArchiveProgress?.((event: NativeBankImportProgressEvent) => {
    if (event?.jobId !== input.jobId) return;
    onProgress?.(event);
  });
  try {
    return await window.electronAPI!.importArchiveJob!(input);
  } finally {
    if (typeof cleanup === 'function') cleanup();
  }
};
