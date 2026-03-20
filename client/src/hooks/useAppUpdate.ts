import * as React from 'react';
import {
  checkNativeAppUpdate,
  completeNativeAppUpdate,
  getNativeAppUpdateState,
  isNativeAppUpdateAvailable,
  onNativeAppUpdateState,
  type NativeAppUpdateState,
} from '@/lib/native-app-update';

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

    void (async () => {
      if (await attachElectron()) {
        return;
      }
      if (await attachAndroid()) {
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
    }
  }, [state.platform]);

  return {
    state,
    checkForUpdates,
    installUpdate,
  };
}
