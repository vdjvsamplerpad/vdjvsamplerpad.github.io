const CHUNK_RECOVERY_STORAGE_KEY = 'vdjv-chunk-recovery-attempted';
const SHELL_CACHE_PREFIX = 'vdjv-shell-cache';

const getErrorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message || '';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return '';
};

export const isDynamicImportChunkError = (value: unknown): boolean => {
  const message = getErrorMessage(value).toLowerCase();
  if (!message) return false;
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('chunkloaderror') ||
    /loading chunk [\w-]+ failed/.test(message)
  );
};

const getReloadUrl = (): string => {
  const url = new URL(window.location.href);
  url.searchParams.set('_vdjv_chunk_reload', String(Date.now()));
  return url.toString();
};

export async function forceFreshAppReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
    }
  } catch {
  }

  try {
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith(SHELL_CACHE_PREFIX))
          .map((key) => caches.delete(key))
      );
    }
  } catch {
  }

  window.location.replace(getReloadUrl());
}

export function clearChunkRecoveryAttempt(): void {
  try {
    window.sessionStorage.removeItem(CHUNK_RECOVERY_STORAGE_KEY);
  } catch {
  }
}

export async function attemptChunkRecovery(errorLike: unknown): Promise<boolean> {
  if (!isDynamicImportChunkError(errorLike)) return false;

  try {
    const alreadyAttempted = window.sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY);
    if (alreadyAttempted) return false;
    window.sessionStorage.setItem(CHUNK_RECOVERY_STORAGE_KEY, String(Date.now()));
  } catch {
  }

  await forceFreshAppReload();
  return true;
}

export function installChunkLoadRecovery(): void {
  if (typeof window === 'undefined') return;

  const handleWindowError = (event: ErrorEvent) => {
    if (isDynamicImportChunkError(event.error || event.message)) {
      event.preventDefault();
      void attemptChunkRecovery(event.error || event.message);
    }
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isDynamicImportChunkError(event.reason)) {
      event.preventDefault();
      void attemptChunkRecovery(event.reason);
    }
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}
