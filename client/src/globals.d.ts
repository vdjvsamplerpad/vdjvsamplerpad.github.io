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
    }) => Promise<{ audioBytes: Uint8Array | ArrayBuffer }>;
    getSystemMemoryInfo?: () => {
      totalMemBytes: number;
      freeMemBytes: number;
      cpuCount: number;
    };
    onFullscreenChange?: (callback: (isFullscreen: boolean) => void) => (() => void) | void;
  };
}
