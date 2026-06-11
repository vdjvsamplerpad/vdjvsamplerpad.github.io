export type OfflineReadinessResult = {
  loaded: string[];
  failed: Array<{ id: string; message: string }>;
};

type OfflineReadinessEntry = {
  id: string;
  load: () => Promise<unknown>;
};

const OFFLINE_READINESS_BATCH_SIZE = 3;
const OFFLINE_READINESS_IDLE_TIMEOUT_MS = 180;

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

    const result = { loaded, failed };
    if (failed.length === 0) cachedResult = result;
    return result;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
};
