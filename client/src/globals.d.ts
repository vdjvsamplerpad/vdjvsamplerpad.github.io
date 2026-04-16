/// <reference types="vite/client" />

declare const __VDJV_INCLUDE_LANDING__: boolean;

interface ImportMetaEnv {
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI?: {
    toggleFullscreen?: () => Promise<boolean>;
    getFullscreenState?: () => Promise<boolean>;
    transcodeAudioToMp3?: (payload: {
      audioBytes: Uint8Array | ArrayBuffer;
      mimeType?: string;
      startTimeMs?: number;
      endTimeMs?: number;
      applyTrim?: boolean;
      bitrate?: number;
    }) => Promise<{ audioBytes: Uint8Array | ArrayBuffer | number[] | { data: number[] } }>;
    createZipArchive?: (payload: {
      entries: Array<{
        path: string;
        data?: Uint8Array | ArrayBuffer;
        sourcePath?: string;
        cleanupSourcePath?: boolean;
      }>;
      compression?: 'STORE' | 'DEFLATE';
      compressionLevel?: number;
    }) => Promise<{ archiveBytes: Uint8Array | ArrayBuffer | number[] | { data: number[] } }>;
    createAndSaveZipArchive?: (payload: {
      entries: Array<{
        path: string;
        data?: Uint8Array | ArrayBuffer;
        sourcePath?: string;
        cleanupSourcePath?: boolean;
      }>;
      fileName: string;
      relativeFolder?: string;
      compression?: 'STORE' | 'DEFLATE';
      compressionLevel?: number;
    }) => Promise<{ savedPath?: string; archiveBytes?: number; message?: string }>;
    stageExportEntry?: (payload: {
      archivePath: string;
      data: Uint8Array | ArrayBuffer;
      fileName?: string;
    }) => Promise<{ sourcePath?: string; bytes?: number }>;
    cleanupStagedExportEntries?: (payload: {
      paths: string[];
    }) => Promise<{ removedCount?: number }>;
    exportArchiveJob?: (payload: {
      jobId: string;
      entries: Array<
        | {
            kind: 'raw';
            path: string;
            data?: Uint8Array | ArrayBuffer;
            sourcePath?: string;
            cleanupSourcePath?: boolean;
          }
        | {
            kind: 'audio';
            path: string;
            sourcePath: string;
            mimeType?: string;
            transform: 'copy' | 'trim' | 'trim_mp3';
            startTimeMs?: number;
            endTimeMs?: number;
            bitrate?: number;
            cleanupSourcePath?: boolean;
          }
      >;
      fileName: string;
      relativeFolder?: string;
      compression?: 'STORE' | 'DEFLATE';
      encryptionPassword?: string;
      returnArchiveBytes?: boolean;
    }) => Promise<{
      savedPath?: string;
      archiveBytes?: number;
      archiveData?: Uint8Array | ArrayBuffer | number[] | { data: number[] };
      message?: string;
    }>;
    importArchiveJob?: (payload: {
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
    }) => Promise<{
      jobId: string;
      sourceFileName: string;
      sourceFileBytes: number;
      encrypted: boolean;
      bankJsonText: string;
      metadataJsonText?: string | null;
      thumbnailStorageKey?: string | null;
      thumbnailFilePath?: string | null;
      thumbnailFileUrl?: string | null;
      pads: Array<{
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
      }>;
    }>;
    saveFile?: (payload: {
      title?: string;
      fileName: string;
      data: Uint8Array | ArrayBuffer;
      filters?: Array<{
        name: string;
        extensions: string[];
      }>;
    }) => Promise<{
      ok: boolean;
      canceled?: boolean;
      reason?: string;
      savedPath?: string;
    }>;
    resolveNativeMedia?: (payload: {
      storageKey: string;
    }) => Promise<{
      storageKey?: string;
      exists?: boolean;
      sourcePath?: string;
      fileUrl?: string;
      bytes?: number;
    }>;
    writeNativeMedia?: (payload: {
      storageKey: string;
      data: Uint8Array | ArrayBuffer;
    }) => Promise<{
      storageKey?: string;
      sourcePath?: string;
      fileUrl?: string;
      bytes?: number;
    }>;
    readNativeMedia?: (payload: {
      storageKey: string;
    }) => Promise<{
      storageKey?: string;
      sourcePath?: string;
      fileUrl?: string;
      bytes?: number;
      data?: Uint8Array | ArrayBuffer | number[] | { data: number[] };
    }>;
    deleteNativeMedia?: (payload: {
      storageKey: string;
    }) => Promise<{ storageKey?: string; deleted?: boolean }>;
    getSystemMemoryInfo?: () => {
      totalMemBytes: number;
      freeMemBytes: number;
      cpuCount: number;
    };
    onFullscreenChange?: (callback: (isFullscreen: boolean) => void) => (() => void) | void;
    getAppUpdateState?: () => Promise<{
      enabled: boolean;
      status: string;
      message: string;
      currentVersion?: string | null;
      nextVersion?: string | null;
      downloadPercent?: number | null;
      lastCheckedAt?: string | null;
      lastError?: string | null;
    }>;
    checkForAppUpdates?: () => Promise<{
      enabled: boolean;
      status: string;
      message: string;
      currentVersion?: string | null;
      nextVersion?: string | null;
      downloadPercent?: number | null;
      lastCheckedAt?: string | null;
      lastError?: string | null;
    }>;
    installDownloadedAppUpdate?: () => Promise<{ ok: boolean; reason?: string }>;
    onAppUpdateState?: (
      callback: (payload: {
        enabled: boolean;
        status: string;
        message: string;
        currentVersion?: string | null;
        nextVersion?: string | null;
        downloadPercent?: number | null;
        lastCheckedAt?: string | null;
        lastError?: string | null;
      }) => void
    ) => (() => void) | void;
    onImportArchiveProgress?: (
      callback: (payload: {
        jobId: string;
        stage: string;
        progress?: number;
        message?: string;
        currentPad?: number;
        totalPads?: number;
        downloadedBytes?: number;
        totalBytes?: number;
      }) => void
    ) => (() => void) | void;
  };
}
