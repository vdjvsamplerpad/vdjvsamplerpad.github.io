export type ElectronMemoryTier = 'low' | 'medium' | 'high';

export interface ElectronSystemMemoryInfo {
  totalMemBytes: number;
  freeMemBytes: number;
  cpuCount: number;
}

export interface ElectronMemoryTuningProfile {
  tier: ElectronMemoryTier;
  warmupPolicy: {
    maxPerBank: number;
    maxTotal: number;
    idleDelayMs: number;
    maxDurationMs: number | null;
    skipUnknownDuration: boolean;
  };
  startupRestorePadLimit: number;
  backgroundHydrationPadLimit: number;
  dehydrateIdleMs: number;
  bufferCacheLimitBytes: number;
  sessionMediaRetention: {
    minBanksForDehydration: number;
    maxRecentWarmBanks: number;
    hotPadCount: number;
    hotPadTtlMs: number;
  };
}

const GIB = 1024 * 1024 * 1024;

const ELECTRON_MEMORY_TUNING: Record<ElectronMemoryTier, ElectronMemoryTuningProfile> = {
  low: {
    tier: 'low',
    warmupPolicy: {
      maxPerBank: 5,
      maxTotal: 10,
      idleDelayMs: 180,
      maxDurationMs: 90_000,
      skipUnknownDuration: true,
    },
    startupRestorePadLimit: 600,
    backgroundHydrationPadLimit: 220,
    dehydrateIdleMs: 7_000,
    bufferCacheLimitBytes: 96 * 1024 * 1024,
    sessionMediaRetention: {
      minBanksForDehydration: 3,
      maxRecentWarmBanks: 1,
      hotPadCount: 8,
      hotPadTtlMs: 120_000,
    },
  },
  medium: {
    tier: 'medium',
    warmupPolicy: {
      maxPerBank: 8,
      maxTotal: 16,
      idleDelayMs: 120,
      maxDurationMs: 120_000,
      skipUnknownDuration: false,
    },
    startupRestorePadLimit: 900,
    backgroundHydrationPadLimit: 320,
    dehydrateIdleMs: 10_000,
    bufferCacheLimitBytes: 128 * 1024 * 1024,
    sessionMediaRetention: {
      minBanksForDehydration: 5,
      maxRecentWarmBanks: 2,
      hotPadCount: 16,
      hotPadTtlMs: 180_000,
    },
  },
  high: {
    tier: 'high',
    warmupPolicy: {
      maxPerBank: 10,
      maxTotal: 24,
      idleDelayMs: 80,
      maxDurationMs: 180_000,
      skipUnknownDuration: false,
    },
    startupRestorePadLimit: 1_200,
    backgroundHydrationPadLimit: 480,
    dehydrateIdleMs: 15_000,
    bufferCacheLimitBytes: 160 * 1024 * 1024,
    sessionMediaRetention: {
      minBanksForDehydration: 7,
      maxRecentWarmBanks: 3,
      hotPadCount: 24,
      hotPadTtlMs: 300_000,
    },
  },
};

const downgradeTier = (tier: ElectronMemoryTier): ElectronMemoryTier => {
  if (tier === 'high') return 'medium';
  if (tier === 'medium') return 'low';
  return 'low';
};

export const getElectronSystemMemoryInfo = (): ElectronSystemMemoryInfo | null => {
  if (typeof window === 'undefined') return null;
  const reader = window.electronAPI?.getSystemMemoryInfo;
  if (typeof reader !== 'function') return null;

  try {
    const raw = reader();
    const totalMemBytes = Number(raw?.totalMemBytes);
    const freeMemBytes = Number(raw?.freeMemBytes);
    const cpuCount = Number(raw?.cpuCount);
    if (!Number.isFinite(totalMemBytes) || totalMemBytes <= 0) return null;
    if (!Number.isFinite(freeMemBytes) || freeMemBytes < 0) return null;

    return {
      totalMemBytes,
      freeMemBytes,
      cpuCount: Number.isFinite(cpuCount) && cpuCount > 0 ? Math.round(cpuCount) : 0,
    };
  } catch {
    return null;
  }
};

export const resolveElectronMemoryTier = (
  info: ElectronSystemMemoryInfo | null = getElectronSystemMemoryInfo()
): ElectronMemoryTier | null => {
  if (!info) return null;

  const totalGiB = info.totalMemBytes / GIB;
  let tier: ElectronMemoryTier;
  if (totalGiB <= 8) tier = 'low';
  else if (totalGiB <= 16) tier = 'medium';
  else tier = 'high';

  const freeRatio = info.totalMemBytes > 0 ? info.freeMemBytes / info.totalMemBytes : 1;
  if (freeRatio < 0.12) return 'low';
  if (freeRatio < 0.25) {
    tier = downgradeTier(tier);
  }

  return tier;
};

export const getElectronMemoryTuningProfile = (): ElectronMemoryTuningProfile | null => {
  const tier = resolveElectronMemoryTier();
  return tier ? ELECTRON_MEMORY_TUNING[tier] : null;
};

export interface DesktopSessionMediaRetentionPolicy {
  minBanksForDehydration: number;
  maxRecentWarmBanks: number;
  hotPadCount: number;
  hotPadTtlMs: number;
  dehydrateIdleMs: number;
}

const BROWSER_DESKTOP_SESSION_RETENTION: Record<ElectronMemoryTier, DesktopSessionMediaRetentionPolicy> = {
  low: {
    minBanksForDehydration: 4,
    maxRecentWarmBanks: 1,
    hotPadCount: 8,
    hotPadTtlMs: 120_000,
    dehydrateIdleMs: 12_000,
  },
  medium: {
    minBanksForDehydration: 5,
    maxRecentWarmBanks: 2,
    hotPadCount: 14,
    hotPadTtlMs: 180_000,
    dehydrateIdleMs: 15_000,
  },
  high: {
    minBanksForDehydration: 6,
    maxRecentWarmBanks: 3,
    hotPadCount: 20,
    hotPadTtlMs: 240_000,
    dehydrateIdleMs: 18_000,
  },
};

export const getDesktopSessionMediaRetentionPolicy = (): DesktopSessionMediaRetentionPolicy | null => {
  const electronProfile = getElectronMemoryTuningProfile();
  if (electronProfile) {
    return {
      ...electronProfile.sessionMediaRetention,
      dehydrateIdleMs: electronProfile.dehydrateIdleMs,
    };
  }

  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
    ? Number(nav.deviceMemory)
    : null;
  const cpuCores = typeof nav.hardwareConcurrency === 'number' && Number.isFinite(nav.hardwareConcurrency)
    ? Number(nav.hardwareConcurrency)
    : null;

  let tier: ElectronMemoryTier = 'medium';
  if ((deviceMemory !== null && deviceMemory <= 4) || (cpuCores !== null && cpuCores <= 4)) {
    tier = 'low';
  } else if ((deviceMemory !== null && deviceMemory >= 8) && (cpuCores !== null && cpuCores >= 8)) {
    tier = 'high';
  }

  return BROWSER_DESKTOP_SESSION_RETENTION[tier];
};
