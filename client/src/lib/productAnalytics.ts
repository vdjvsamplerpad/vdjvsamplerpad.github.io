import posthog from 'posthog-js';

type ProductAnalyticsProperties = Record<string, unknown>;

const POSTHOG_KEY = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const POSTHOG_HOST = String(import.meta.env.VITE_POSTHOG_HOST || '').trim();
const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || 'unknown').trim();

let initialized = false;

const isBrowser = typeof window !== 'undefined';

const resolveRuntime = (): string => {
  if (!isBrowser) return 'server';
  const ua = navigator.userAgent || '';
  if (/Electron/i.test(ua)) return 'electron';
  const capacitor = (window as Window & typeof globalThis & {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }).Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const platform = String(capacitor.getPlatform?.() || '').trim().toLowerCase();
    return platform ? `capacitor-${platform}` : 'capacitor';
  }
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios-web';
  if (/Android/i.test(ua)) return 'android-web';
  return 'web';
};

const baseProperties = (): ProductAnalyticsProperties => ({
  app_version: APP_VERSION,
  runtime: resolveRuntime(),
});

export const isProductAnalyticsEnabled = (): boolean => Boolean(POSTHOG_KEY && POSTHOG_HOST && isBrowser);

export const initProductAnalytics = (): void => {
  if (!isProductAnalyticsEnabled() || initialized) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    defaults: '2026-01-30',
    person_profiles: 'identified_only',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    loaded: (instance) => {
      instance.register(baseProperties());
    },
  });
  initialized = true;
};

export const captureProductEvent = (event: string, properties?: ProductAnalyticsProperties): void => {
  if (!initialized) return;
  posthog.capture(event, {
    ...baseProperties(),
    ...(properties || {}),
  });
};

export const identifyProductUser = (
  distinctId: string,
  properties?: ProductAnalyticsProperties,
): void => {
  if (!initialized || !distinctId) return;
  posthog.identify(distinctId, {
    ...baseProperties(),
    ...(properties || {}),
  });
};

export const resetProductAnalytics = (): void => {
  if (!initialized) return;
  posthog.reset();
  posthog.register(baseProperties());
};
