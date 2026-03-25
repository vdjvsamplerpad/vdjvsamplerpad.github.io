export const WEB_SAMPLER_APP_PATH = '/vdjv';
export const WEB_LANDING_PATH = '/';
export const WEB_BUY_PATH = '/buy';
export const PACKAGED_SAMPLER_APP_PATH = '/';
export const PACKAGED_LANDING_PATH = '/landing';
export const PACKAGED_BUY_PATH = '/buy';

const hasWindow = typeof window !== 'undefined';

export const isNativeCapacitorRuntime = (): boolean =>
  hasWindow && Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

export const isFileProtocolRuntime = (): boolean =>
  hasWindow && window.location.protocol === 'file:';

export const isPackagedAppRuntime = (): boolean => isFileProtocolRuntime() || isNativeCapacitorRuntime();

export const getSamplerAppPath = (): string =>
  isPackagedAppRuntime() ? PACKAGED_SAMPLER_APP_PATH : WEB_SAMPLER_APP_PATH;

export const getLandingPagePath = (): string =>
  isPackagedAppRuntime() ? PACKAGED_LANDING_PATH : WEB_LANDING_PATH;

export const getBuyPagePath = (): string =>
  isPackagedAppRuntime() ? PACKAGED_BUY_PATH : WEB_BUY_PATH;
