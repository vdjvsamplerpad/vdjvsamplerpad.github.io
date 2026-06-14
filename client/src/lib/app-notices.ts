export type AppNoticeVariant = 'success' | 'error' | 'info';

export type AppNoticePayload = {
  variant: AppNoticeVariant;
  message: string;
  dedupeKey?: string;
  dedupeMs?: number;
};

export const APP_NOTICE_EVENT = 'vdjv-app-notice';

const DEFAULT_DEDUPE_MS = 2500;
const lastNoticeAt = new Map<string, number>();

export const emitAppNotice = (payload: AppNoticePayload): void => {
  if (typeof window === 'undefined') return;
  const message = payload.message.trim();
  if (!message) return;
  const dedupeMs = Number.isFinite(payload.dedupeMs)
    ? Math.max(0, Number(payload.dedupeMs))
    : DEFAULT_DEDUPE_MS;
  const dedupeKey = payload.dedupeKey || `${payload.variant}:${message}`;
  if (dedupeMs > 0) {
    const now = Date.now();
    const previousAt = lastNoticeAt.get(dedupeKey) || 0;
    if (now - previousAt < dedupeMs) return;
    lastNoticeAt.set(dedupeKey, now);
  }
  const detail: AppNoticePayload = { ...payload, message };
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<AppNoticePayload>(APP_NOTICE_EVENT, { detail }));
  }, 0);
};
