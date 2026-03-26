import { Capacitor } from '@capacitor/core';

export type WalletAppKey = 'gcash' | 'maya';

const MAYA_MOBILE_URL = 'https://official.maya.ph/3xMF/w3xi2eyw';
const GCASH_ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.globe.gcash.android&hl=en&gl=US';
const GCASH_IOS_URL = 'https://apps.apple.com/ph/app/gcash/id520020791';

const getUserAgent = (): string => {
  if (typeof navigator === 'undefined') return '';
  return String(navigator.userAgent || '');
};

export const isAndroidDevice = (): boolean => /Android/i.test(getUserAgent());
export const isIosDevice = (): boolean => /(iPhone|iPod|iPad)/i.test(getUserAgent());
export const isMobileAppleOrAndroid = (): boolean => isAndroidDevice() || isIosDevice();

const getCapacitorRuntime = (): any => {
  if (typeof window === 'undefined') return Capacitor;
  return (window as any).Capacitor || Capacitor;
};

const isNativeCapacitor = (): boolean => {
  const capacitor = getCapacitorRuntime();
  return capacitor?.isNativePlatform?.() === true;
};

export const getWalletOpenUrl = (wallet: WalletAppKey): string => {
  if (wallet === 'maya') return MAYA_MOBILE_URL;
  if (isIosDevice()) return GCASH_IOS_URL;
  return GCASH_ANDROID_URL;
};

export const openWalletAppAfterCopy = (wallet: WalletAppKey): void => {
  if (!isMobileAppleOrAndroid() || typeof window === 'undefined') return;
  const nextUrl = getWalletOpenUrl(wallet);
  if (!nextUrl) return;
  window.setTimeout(() => {
    if (isNativeCapacitor()) {
      window.location.href = nextUrl;
      return;
    }
    const openedWindow = window.open(nextUrl, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.href = nextUrl;
    }
  }, 90);
};
