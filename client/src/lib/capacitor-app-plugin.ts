import { App as CapacitorApp } from '@capacitor/app';

export type CapacitorAppListenerHandle = {
  remove?: () => Promise<void> | void;
};

export type CapacitorAppPluginLike = {
  addListener?: (
    eventName: string,
    callback: (payload?: any) => void,
  ) => Promise<CapacitorAppListenerHandle> | CapacitorAppListenerHandle;
};

export const isNativeCapacitorRuntime = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());

export const getCapacitorAppPlugin = (): CapacitorAppPluginLike | null => {
  if (!isNativeCapacitorRuntime()) return null;
  const windowAppPlugin = (window as any).Capacitor?.Plugins?.App as CapacitorAppPluginLike | undefined;
  if (typeof windowAppPlugin?.addListener === 'function') return windowAppPlugin;
  if (typeof CapacitorApp?.addListener === 'function') return CapacitorApp as CapacitorAppPluginLike;
  return null;
};
