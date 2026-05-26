export const WEB_SAMPLER_APP_PATH = '/vdjv';
export const WEB_LANDING_PATH = '/';
export const WEB_PRICING_PATH = '/pricing';
export const WEB_BUY_PATH = WEB_PRICING_PATH;
export const WEB_LEGACY_BUY_PATH = '/buy';
export const WEB_PRIVACY_PATH = '/privacy';
export const WEB_TERMS_PATH = '/terms';
export const WEB_INSTALLER_REDIRECT_PATH = '/go/:version/:platform';
export const PACKAGED_SAMPLER_APP_PATH = '/';
export const PACKAGED_LANDING_PATH = '/landing';
export const PACKAGED_PRICING_PATH = '/pricing';
export const PACKAGED_BUY_PATH = PACKAGED_PRICING_PATH;
export const PACKAGED_LEGACY_BUY_PATH = '/buy';
export const PACKAGED_PRIVACY_PATH = '/privacy';
export const PACKAGED_TERMS_PATH = '/terms';
export const PACKAGED_INSTALLER_REDIRECT_PATH = '/go/:version/:platform';

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

export const getPricingPagePath = (): string =>
  isPackagedAppRuntime() ? PACKAGED_PRICING_PATH : WEB_PRICING_PATH;

export const getBuyPagePath = getPricingPagePath;

export const getPrivacyPagePath = (): string =>
  isPackagedAppRuntime() ? PACKAGED_PRIVACY_PATH : WEB_PRIVACY_PATH;

export const getTermsPagePath = (): string =>
  isPackagedAppRuntime() ? PACKAGED_TERMS_PATH : WEB_TERMS_PATH;

export const getInstallerRedirectPath = (version: string, platform: string): string => {
  const normalizedVersion = String(version || '').trim().toLowerCase();
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  if (!normalizedVersion || !normalizedPlatform) {
    return getLandingPagePath();
  }
  return `/go/${encodeURIComponent(normalizedVersion)}/${encodeURIComponent(normalizedPlatform)}`;
};
