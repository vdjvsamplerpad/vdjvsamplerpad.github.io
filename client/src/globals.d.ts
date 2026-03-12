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
    onFullscreenChange?: (callback: (isFullscreen: boolean) => void) => (() => void) | void;
  };
}
