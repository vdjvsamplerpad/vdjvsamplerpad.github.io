import * as React from 'react';
import {
  checkNativeAppUpdate,
  completeNativeAppUpdate,
  getNativeAppUpdateState,
  isNativeAppUpdateAvailable,
  onNativeAppUpdateState,
  type NativeAppUpdateState,
} from '@/lib/native-app-update';
import { forceFreshAppReload } from '@/lib/chunk-load-recovery';

export type AppUpdatePlatform = 'web' | 'electron' | 'android';

export interface AppUpdateViewState {
  platform: AppUpdatePlatform;
  supported: boolean;
  enabled: boolean;
  status: string;
  message: string;
  currentVersion?: string | null;
  nextVersion?: string | null;
  downloadPercent?: number | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  canCheck: boolean;
  canInstall: boolean;
  busy: boolean;
}

const createBaseState = (): AppUpdateViewState => ({
  platform: 'web',
  supported: false,
  enabled: false,
  status: 'disabled',
  message: 'Automatic app updates are unavailable in the browser build.',
  currentVersion: null,
  nextVersion: null,
  downloadPercent: null,
  lastCheckedAt: null,
  lastError: null,
  canCheck: false,
  canInstall: false,
  busy: false,
});

const createWebState = (patch: Partial<AppUpdateViewState> = {}): AppUpdateViewState => ({
  platform: 'web',
  supported: true,
  enabled: true,
  status: 'idle',
  message: 'Web app is ready. Check here when you want to refresh to the latest deployed version.',
  currentVersion: (import.meta as any).env?.VITE_APP_VERSION ?? null,
  nextVersion: null,
  downloadPercent: null,
  lastCheckedAt: null,
  lastError: null,
  canCheck: true,
  canInstall: false,
  busy: false,
  ...patch,
});

const normalizeState = (
  platform: AppUpdatePlatform,
  patch: Partial<NativeAppUpdateState & { enabled: boolean }>
): AppUpdateViewState => {
  const enabled = patch.enabled === true;
  const status = typeof patch.status === 'string' && patch.status.trim() ? patch.status : enabled ? 'idle' : 'disabled';
  return {
    platform,
    supported: platform !== 'web',
    enabled,
    status,
    message: typeof patch.message === 'string' && patch.message.trim()
      ? patch.message
      : enabled
        ? 'No update status available.'
        : platform === 'android'
          ? 'Play in-app updates are unavailable on this build.'
          : 'Auto-update is unavailable.',
    currentVersion: patch.currentVersion ?? null,
    nextVersion: patch.nextVersion ?? null,
    downloadPercent: patch.downloadPercent ?? null,
    lastCheckedAt: patch.lastCheckedAt ?? null,
    lastError: patch.lastError ?? null,
    canCheck: platform !== 'web' && status !== 'checking' && status !== 'installing',
    canInstall: status === 'downloaded',
    busy: status === 'checking' || status === 'downloading' || status === 'installing',
  };
};

export function useAppUpdate() {
  const [state, setState] = React.useState<AppUpdateViewState>(() => createBaseState());
  const webUpdateRegistrationRef = React.useRef<ServiceWorkerRegistration | null>(null);
  const webUpdateReadyRef = React.useRef(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;
    const cleanups: Array<() => void | Promise<void>> = [];
    const setSafeState = (next: AppUpdateViewState) => {
      if (!cancelled) {
        setState(next);
      }
    };

    const attachElectron = async () => {
      const electronApi = window.electronAPI;
      if (!electronApi?.getAppUpdateState) {
        return false;
      }

      try {
        const initial = await electronApi.getAppUpdateState();
        if (!cancelled) {
          setSafeState(normalizeState('electron', initial ?? {}));
        }
      } catch (error) {
        if (!cancelled) {
          setSafeState(normalizeState('electron', {
            enabled: false,
            status: 'error',
            message: 'Could not load the desktop update state.',
            lastError: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      const unsubscribe = electronApi.onAppUpdateState?.((payload) => {
        setSafeState(normalizeState('electron', payload ?? {}));
      });
      if (typeof unsubscribe === 'function') {
        cleanups.push(unsubscribe);
      }
      return true;
    };

    const attachAndroid = async () => {
      if (!isNativeAppUpdateAvailable()) {
        return false;
      }

      try {
        const remove = await onNativeAppUpdateState((payload) => {
          setSafeState(normalizeState('android', payload ?? {}));
        });
        cleanups.push(remove);
      } catch {
      }

      try {
        const initial = await getNativeAppUpdateState();
        if (!cancelled) {
          setSafeState(normalizeState('android', initial ?? {}));
        }
      } catch (error) {
        if (!cancelled) {
          setSafeState(normalizeState('android', {
            enabled: false,
            status: 'error',
            message: 'Could not load the Android update state.',
            lastError: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      void checkNativeAppUpdate({ autoStart: true })
        .then((next) => {
          if (!cancelled) {
            setSafeState(normalizeState('android', next ?? {}));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSafeState(normalizeState('android', {
              enabled: false,
              status: 'error',
              message: 'Android update check failed.',
              lastError: error instanceof Error ? error.message : String(error),
            }));
          }
        });

      const refreshOnVisible = () => {
        if (document.visibilityState !== 'visible') return;
        void getNativeAppUpdateState()
          .then((next) => {
            if (!cancelled) {
              setSafeState(normalizeState('android', next ?? {}));
            }
          })
          .catch(() => undefined);
      };
      document.addEventListener('visibilitychange', refreshOnVisible);
      cleanups.push(() => document.removeEventListener('visibilitychange', refreshOnVisible));
      return true;
    };

    const attachWeb = async () => {
      const canUseServiceWorker = 'serviceWorker' in navigator;
      const isSecureContext = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
      const includeLanding = typeof __VDJV_INCLUDE_LANDING__ !== 'undefined' ? __VDJV_INCLUDE_LANDING__ : true;
      if (!canUseServiceWorker || !isSecureContext || !includeLanding) {
        return false;
      }

      let registration: ServiceWorkerRegistration | null = null;
      try {
        registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration) {
          registration = await navigator.serviceWorker.getRegistration();
        }
      } catch {
        registration = null;
      }

      if (!registration) {
        setSafeState(createWebState({
          status: 'disabled',
          message: 'Web update check is unavailable until the service worker is ready.',
          enabled: false,
          supported: false,
          canCheck: false,
        }));
        return true;
      }

      webUpdateRegistrationRef.current = registration;

      const setWebState = (patch: Partial<AppUpdateViewState>) => {
        setSafeState(createWebState(patch));
      };

      const markReady = (message?: string) => {
        webUpdateReadyRef.current = true;
        setWebState({
          status: 'downloaded',
          message: message || 'A newer web app version is ready. Reload from Settings to apply it.',
          canInstall: true,
        });
      };

      const markIdle = (message?: string) => {
        webUpdateReadyRef.current = false;
        setWebState({
          status: 'idle',
          message: message || 'Web app is up to date.',
          canInstall: false,
        });
      };

      const watchInstallingWorker = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const handleStateChange = () => {
          if (worker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              markReady();
            } else {
              markIdle('Latest web app version is installed.');
            }
          } else if (worker.state === 'redundant') {
            setWebState({
              status: 'error',
              message: 'Web update became invalid before it finished.',
              canInstall: false,
            });
          }
        };
        worker.addEventListener('statechange', handleStateChange);
        cleanups.push(() => worker.removeEventListener('statechange', handleStateChange));
      };

      if (registration.waiting) {
        markReady();
      } else {
        markIdle('Web app is up to date. Use Check for Updates when you want to refresh from the server.');
      }

      watchInstallingWorker(registration.installing);

      const handleUpdateFound = () => {
        setWebState({
          status: 'checking',
          message: 'Downloading the latest web app files...',
          busy: true,
          canCheck: false,
        });
        watchInstallingWorker(registration?.installing ?? null);
      };
      registration.addEventListener('updatefound', handleUpdateFound);
      cleanups.push(() => registration?.removeEventListener('updatefound', handleUpdateFound));

      const handleControllerChange = () => {
        markIdle('Latest web app version is active.');
      };
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
      cleanups.push(() => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange));

      return true;
    };

    void (async () => {
      if (await attachElectron()) {
        return;
      }
      if (await attachAndroid()) {
        return;
      }
      if (await attachWeb()) {
        return;
      }
      setSafeState(createBaseState());
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => {
        try {
          const result = cleanup();
          if (result && typeof (result as Promise<void>).then === 'function') {
            void result;
          }
        } catch {
        }
      });
    };
  }, []);

  const checkForUpdates = React.useCallback(async () => {
    if (state.platform === 'electron') {
      const next = await window.electronAPI?.checkForAppUpdates?.();
      if (next) {
        setState(normalizeState('electron', next));
      }
      return;
    }
    if (state.platform === 'android') {
      const next = await checkNativeAppUpdate({ autoStart: true });
      setState(normalizeState('android', next));
      return;
    }
    if (state.platform === 'web') {
      const registration = webUpdateRegistrationRef.current;
      if (!registration) return;
      setState((prev) => createWebState({
        ...prev,
        status: 'checking',
        message: 'Checking for the latest web app files...',
        busy: true,
        canCheck: false,
        lastCheckedAt: new Date().toISOString(),
      }));
      try {
        await registration.update();
        if (registration.waiting || webUpdateReadyRef.current) {
          setState((prev) => createWebState({
            ...prev,
            status: 'downloaded',
            message: 'A newer web app version is ready. Reload from Settings to apply it.',
            canInstall: true,
            busy: false,
            canCheck: true,
            lastCheckedAt: new Date().toISOString(),
          }));
        } else {
          setState((prev) => createWebState({
            ...prev,
            status: 'idle',
            message: 'Web app is already up to date.',
            canInstall: false,
            busy: false,
            canCheck: true,
            lastCheckedAt: new Date().toISOString(),
          }));
        }
      } catch (error) {
        setState((prev) => createWebState({
          ...prev,
          status: 'error',
          message: 'Could not check for the latest web app version.',
          lastError: error instanceof Error ? error.message : String(error),
          busy: false,
          canCheck: true,
          canInstall: false,
          lastCheckedAt: new Date().toISOString(),
        }));
      }
    }
  }, [state.platform]);

  const installUpdate = React.useCallback(async () => {
    if (state.platform === 'electron') {
      await window.electronAPI?.installDownloadedAppUpdate?.();
      return;
    }
    if (state.platform === 'android') {
      const next = await completeNativeAppUpdate();
      setState(normalizeState('android', next));
      return;
    }
    if (state.platform === 'web') {
      const registration = webUpdateRegistrationRef.current;
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        await registration?.update().catch(() => undefined);
      }
      await forceFreshAppReload();
    }
  }, [state.platform]);

  return {
    state,
    checkForUpdates,
    installUpdate,
  };
}
