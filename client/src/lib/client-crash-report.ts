import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export type ClientCrashReportDomain = 'bank_store' | 'playback' | 'global_runtime';

export type ClientCrashReportPayload = {
  domain: ClientCrashReportDomain;
  title: string;
  supportLogText: string;
  platform?: string | null;
  appVersion?: string | null;
  operation?: string | null;
  phase?: string | null;
  stage?: string | null;
  entryCount?: number | null;
  recentEventPattern?: string | null;
  detectedAt?: string | number | null;
  lastUpdatedAt?: string | number | null;
};

export type ClientCrashReportResponse = {
  reportId: string;
  fingerprint: string;
  repeatCount: number;
  uploaded: boolean;
  deduped: boolean;
  notified: boolean;
};

export const resolveClientCrashReportPlatform = (): string => {
  if (typeof window === 'undefined') return 'unknown';
  const capacitor = (window as Window & typeof globalThis & {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }).Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const platform = capacitor.getPlatform?.();
    return platform ? `capacitor-${platform}` : 'capacitor-native';
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Electron/i.test(ua)) return 'electron';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios-web';
  if (/Android/i.test(ua)) return 'android-web';
  return 'desktop-web';
};

export const sendClientCrashReport = async (
  payload: ClientCrashReportPayload,
): Promise<ClientCrashReportResponse> => {
  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('store-api', 'crash-report'), {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || data?.message || `HTTP ${response.status}`));
  }
  return {
    reportId: String(data?.reportId || data?.data?.reportId || ''),
    fingerprint: String(data?.fingerprint || data?.data?.fingerprint || ''),
    repeatCount: Number(data?.repeatCount || data?.data?.repeatCount || 1),
    uploaded: Boolean(data?.uploaded ?? data?.data?.uploaded),
    deduped: Boolean(data?.deduped ?? data?.data?.deduped),
    notified: Boolean(data?.notified ?? data?.data?.notified),
  };
};
