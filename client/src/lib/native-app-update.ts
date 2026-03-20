import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeAppUpdateState {
  enabled: boolean;
  status: string;
  message: string;
  currentVersion?: string | null;
  nextVersion?: string | null;
  downloadPercent?: number | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

type NativeAppUpdatePlugin = {
  getState: () => Promise<NativeAppUpdateState>;
  checkForUpdate: (input?: { autoStart?: boolean }) => Promise<NativeAppUpdateState>;
  completeUpdate: () => Promise<NativeAppUpdateState>;
  addListener: (
    eventName: 'appUpdateState',
    listenerFunc: (event: NativeAppUpdateState) => void
  ) => Promise<PluginListenerHandle> | PluginListenerHandle;
};

const NativeAppUpdate = registerPlugin<NativeAppUpdatePlugin>('NativeAppUpdate');

const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as any).Capacitor || Capacitor;
  return capacitor?.isNativePlatform?.() === true && capacitor?.getPlatform?.() === 'android';
};

export const isNativeAppUpdateAvailable = (): boolean =>
  isNativeAndroid() && Capacitor.isPluginAvailable('NativeAppUpdate');

export const getNativeAppUpdateState = async (): Promise<NativeAppUpdateState> => {
  if (!isNativeAppUpdateAvailable()) {
    return {
      enabled: false,
      status: 'disabled',
      message: 'Play in-app updates are unavailable on this build.',
    };
  }
  return NativeAppUpdate.getState();
};

export const checkNativeAppUpdate = async (options?: { autoStart?: boolean }): Promise<NativeAppUpdateState> => {
  if (!isNativeAppUpdateAvailable()) {
    return {
      enabled: false,
      status: 'disabled',
      message: 'Play in-app updates are unavailable on this build.',
    };
  }
  return NativeAppUpdate.checkForUpdate(options ?? {});
};

export const completeNativeAppUpdate = async (): Promise<NativeAppUpdateState> => {
  if (!isNativeAppUpdateAvailable()) {
    throw new Error('Play in-app updates are unavailable on this build.');
  }
  return NativeAppUpdate.completeUpdate();
};

export const onNativeAppUpdateState = async (
  listener: (state: NativeAppUpdateState) => void
): Promise<() => Promise<void>> => {
  const handle = await Promise.resolve(NativeAppUpdate.addListener('appUpdateState', listener));
  return async () => {
    await Promise.resolve(handle.remove());
  };
};
