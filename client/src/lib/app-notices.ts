export type AppNoticeVariant = 'success' | 'error' | 'info';

export type AppNoticePayload = {
  variant: AppNoticeVariant;
  message: string;
};

export const APP_NOTICE_EVENT = 'vdjv-app-notice';

export const emitAppNotice = (payload: AppNoticePayload): void => {
  if (typeof window === 'undefined') return;
  if (!payload.message.trim()) return;
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<AppNoticePayload>(APP_NOTICE_EVENT, { detail: payload }));
  }, 0);
};
