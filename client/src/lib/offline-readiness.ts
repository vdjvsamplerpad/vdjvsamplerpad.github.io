export type OfflineReadinessResult = {
  loaded: string[];
  failed: Array<{ id: string; message: string }>;
  shell: OfflineShellReadinessResult;
};

export type OfflineShellReadinessResult = {
  supported: boolean;
  ready: boolean;
  cacheName?: string;
  checked?: number;
  missing: string[];
  error?: string;
};

type OfflineReadinessEntry = {
  id: string;
  load: () => Promise<unknown>;
};

const OFFLINE_READINESS_BATCH_SIZE = 3;
const OFFLINE_READINESS_IDLE_TIMEOUT_MS = 180;
const OFFLINE_SHELL_MESSAGE_TIMEOUT_MS = 20_000;

let cachedResult: OfflineReadinessResult | null = null;
let inFlight: Promise<OfflineReadinessResult> | null = null;

const entries: OfflineReadinessEntry[] = [
  { id: 'settings-dialog', load: () => import('@/components/ui/AppSettingsDialog') },
  { id: 'login-dialog', load: () => import('@/components/auth/LoginModal') },
  { id: 'upgrade-dialog', load: () => import('@/components/sampler/AccountUpgradeDialog') },
  { id: 'pad-edit-dialog', load: () => import('@/components/sampler/PadEditDialog') },
  { id: 'pad-transfer-dialog', load: () => import('@/components/sampler/PadTransferDialog') },
  { id: 'bank-edit-dialog', load: () => import('@/components/sampler/BankEditDialog') },
  { id: 'side-menu', load: () => import('@/components/sampler/SideMenu') },
  { id: 'volume-mixer', load: () => import('@/components/sampler/VolumeMixer') },
  { id: 'app-dialogs', load: () => import('@/components/sampler/SamplerPadAppDialogs') },
  { id: 'bank-store-dialog', load: () => import('@/components/sampler/OnlineBankStoreDialog') },
  { id: 'bank-duplication', load: () => import('@/components/sampler/hooks/useSamplerStore.bankDuplication') },
  { id: 'bank-export', load: () => import('@/components/sampler/hooks/useSamplerStore.exportBank') },
  { id: 'bank-import', load: () => import('@/components/sampler/hooks/useSamplerStore.importBank') },
  { id: 'backup-pipelines', load: () => import('@/components/sampler/hooks/useSamplerStore.backupPipelines') },
];

const waitForIdle = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve();
  const requestIdle = (window as any).requestIdleCallback as
    | ((callback: () => void, options?: { timeout?: number }) => number)
    | undefined;
  if (typeof requestIdle === 'function') {
    return new Promise((resolve) => requestIdle(resolve, { timeout: OFFLINE_READINESS_IDLE_TIMEOUT_MS }));
  }
  return new Promise((resolve) => window.setTimeout(resolve, OFFLINE_READINESS_IDLE_TIMEOUT_MS));
};

const postServiceWorkerReadinessMessage = async (
  type: 'VDJV_PREPARE_OFFLINE_READY' | 'VDJV_VERIFY_OFFLINE_READY'
): Promise<OfflineShellReadinessResult> => {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof MessageChannel === 'undefined'
  ) {
    return { supported: false, ready: false, missing: [], error: 'Service Worker is unavailable.' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || navigator.serviceWorker.controller || registration.waiting || registration.installing;
    if (!worker) {
      return { supported: true, ready: false, missing: [], error: 'Service Worker is not active yet.' };
    }

    return await new Promise<OfflineShellReadinessResult>((resolve) => {
      const channel = new MessageChannel();
      const timeoutId = window.setTimeout(() => {
        channel.port1.close();
        resolve({ supported: true, ready: false, missing: [], error: 'Offline shell verification timed out.' });
      }, OFFLINE_SHELL_MESSAGE_TIMEOUT_MS);

      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeoutId);
        channel.port1.close();
        const data = event.data || {};
        const missing = Array.isArray(data.missing)
          ? data.missing.filter((entry: unknown): entry is string => typeof entry === 'string')
          : [];
        resolve({
          supported: true,
          ready: data.ready === true,
          cacheName: typeof data.cacheName === 'string' ? data.cacheName : undefined,
          checked: typeof data.checked === 'number' ? data.checked : undefined,
          missing,
          error: typeof data.error === 'string' ? data.error : undefined,
        });
      };

      worker.postMessage({ type }, [channel.port2]);
    });
  } catch (error) {
    return {
      supported: true,
      ready: false,
      missing: [],
      error: error instanceof Error ? error.message : 'Offline shell verification failed.',
    };
  }
};

export const prepareOfflineShellCache = (): Promise<OfflineShellReadinessResult> =>
  postServiceWorkerReadinessMessage('VDJV_PREPARE_OFFLINE_READY');

export const verifyOfflineShellCache = (): Promise<OfflineShellReadinessResult> =>
  postServiceWorkerReadinessMessage('VDJV_VERIFY_OFFLINE_READY');

export const warmEssentialOfflineModules = async (): Promise<OfflineReadinessResult> => {
  if (cachedResult && cachedResult.failed.length === 0) return cachedResult;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const loaded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];

    await waitForIdle();
    for (let index = 0; index < entries.length; index += OFFLINE_READINESS_BATCH_SIZE) {
      const batch = entries.slice(index, index + OFFLINE_READINESS_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((entry) => entry.load()));
      results.forEach((result, resultIndex) => {
        const entry = batch[resultIndex];
        if (result.status === 'fulfilled') {
          loaded.push(entry.id);
          return;
        }
        failed.push({
          id: entry.id,
          message: result.reason instanceof Error ? result.reason.message : 'Module did not load.',
        });
      });
      await waitForIdle();
    }

    const shell = await prepareOfflineShellCache();
    const result = { loaded, failed, shell };
    if (failed.length === 0 && (!shell.supported || shell.ready)) cachedResult = result;
    return result;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
};
