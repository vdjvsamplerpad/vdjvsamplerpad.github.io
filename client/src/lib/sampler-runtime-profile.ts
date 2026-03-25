import { getDesktopSessionMediaRetentionPolicy, getElectronMemoryTuningProfile } from './electron-performance';

export type SamplerRuntimeKind =
  | 'electron_desktop'
  | 'desktop_web'
  | 'android_capacitor'
  | 'ios_web'
  | 'ios_capacitor'
  | 'mobile_web';

export type SamplerRuntimeTier = 'low' | 'medium' | 'high';

export interface SamplerWarmupPolicy {
  maxPerBank: number;
  maxTotal: number;
  idleDelayMs: number;
  maxDurationMs: number | null;
  skipUnknownDuration: boolean;
}

export interface SamplerSessionMediaRetentionPolicy {
  enabled: boolean;
  minBanksForDehydration: number;
  maxRecentWarmBanks: number;
  hotPadCount: number;
  hotPadTtlMs: number;
  dehydrateIdleMs: number;
}

export interface SamplerPreparedPlaybackPolicy {
  autoScanOnIdle: boolean;
  queueAfterPlay: boolean;
  diagEnabled: boolean;
}

export interface SamplerRuntimeTuningProfile {
  kind: SamplerRuntimeKind;
  tier: SamplerRuntimeTier;
  warmupPolicy: SamplerWarmupPolicy;
  startupRestorePadLimit: number;
  backgroundHydrationPadLimit: number;
  sessionMediaRetention: SamplerSessionMediaRetentionPolicy;
  preparedPlayback: SamplerPreparedPlaybackPolicy;
}

const DEFAULT_DESKTOP_WARMUP: SamplerWarmupPolicy = {
  maxPerBank: 14,
  maxTotal: 36,
  idleDelayMs: 60,
  maxDurationMs: null,
  skipUnknownDuration: false,
};

const MOBILE_RUNTIME_PROFILES: Record<
  Exclude<SamplerRuntimeKind, 'electron_desktop' | 'desktop_web'>,
  Record<SamplerRuntimeTier, SamplerRuntimeTuningProfile>
> = {
  android_capacitor: {
    low: {
      kind: 'android_capacitor',
      tier: 'low',
      warmupPolicy: { maxPerBank: 3, maxTotal: 5, idleDelayMs: 220, maxDurationMs: 60_000, skipUnknownDuration: true },
      startupRestorePadLimit: 220,
      backgroundHydrationPadLimit: 120,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 3, maxRecentWarmBanks: 1, hotPadCount: 4, hotPadTtlMs: 60_000, dehydrateIdleMs: 6_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: true, diagEnabled: false },
    },
    medium: {
      kind: 'android_capacitor',
      tier: 'medium',
      warmupPolicy: { maxPerBank: 4, maxTotal: 6, idleDelayMs: 180, maxDurationMs: 75_000, skipUnknownDuration: true },
      startupRestorePadLimit: 320,
      backgroundHydrationPadLimit: 180,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 4, maxRecentWarmBanks: 1, hotPadCount: 6, hotPadTtlMs: 90_000, dehydrateIdleMs: 8_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: true, diagEnabled: false },
    },
    high: {
      kind: 'android_capacitor',
      tier: 'high',
      warmupPolicy: { maxPerBank: 5, maxTotal: 8, idleDelayMs: 150, maxDurationMs: 90_000, skipUnknownDuration: true },
      startupRestorePadLimit: 420,
      backgroundHydrationPadLimit: 240,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 5, maxRecentWarmBanks: 2, hotPadCount: 8, hotPadTtlMs: 120_000, dehydrateIdleMs: 10_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: true, diagEnabled: false },
    },
  },
  ios_web: {
    low: {
      kind: 'ios_web',
      tier: 'low',
      warmupPolicy: { maxPerBank: 1, maxTotal: 2, idleDelayMs: 340, maxDurationMs: 30_000, skipUnknownDuration: true },
      startupRestorePadLimit: 96,
      backgroundHydrationPadLimit: 48,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 2, maxRecentWarmBanks: 0, hotPadCount: 2, hotPadTtlMs: 20_000, dehydrateIdleMs: 2_500 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: true },
    },
    medium: {
      kind: 'ios_web',
      tier: 'medium',
      warmupPolicy: { maxPerBank: 2, maxTotal: 3, idleDelayMs: 320, maxDurationMs: 45_000, skipUnknownDuration: true },
      startupRestorePadLimit: 140,
      backgroundHydrationPadLimit: 72,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 3, maxRecentWarmBanks: 0, hotPadCount: 2, hotPadTtlMs: 25_000, dehydrateIdleMs: 3_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: true },
    },
    high: {
      kind: 'ios_web',
      tier: 'high',
      warmupPolicy: { maxPerBank: 2, maxTotal: 4, idleDelayMs: 280, maxDurationMs: 60_000, skipUnknownDuration: true },
      startupRestorePadLimit: 180,
      backgroundHydrationPadLimit: 96,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 4, maxRecentWarmBanks: 0, hotPadCount: 3, hotPadTtlMs: 35_000, dehydrateIdleMs: 4_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: true },
    },
  },
  ios_capacitor: {
    low: {
      kind: 'ios_capacitor',
      tier: 'low',
      warmupPolicy: { maxPerBank: 2, maxTotal: 4, idleDelayMs: 240, maxDurationMs: 45_000, skipUnknownDuration: true },
      startupRestorePadLimit: 160,
      backgroundHydrationPadLimit: 80,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 2, maxRecentWarmBanks: 0, hotPadCount: 3, hotPadTtlMs: 30_000, dehydrateIdleMs: 4_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: false },
    },
    medium: {
      kind: 'ios_capacitor',
      tier: 'medium',
      warmupPolicy: { maxPerBank: 3, maxTotal: 5, idleDelayMs: 220, maxDurationMs: 60_000, skipUnknownDuration: true },
      startupRestorePadLimit: 220,
      backgroundHydrationPadLimit: 110,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 3, maxRecentWarmBanks: 1, hotPadCount: 4, hotPadTtlMs: 60_000, dehydrateIdleMs: 6_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: false },
    },
    high: {
      kind: 'ios_capacitor',
      tier: 'high',
      warmupPolicy: { maxPerBank: 4, maxTotal: 6, idleDelayMs: 200, maxDurationMs: 75_000, skipUnknownDuration: true },
      startupRestorePadLimit: 280,
      backgroundHydrationPadLimit: 140,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 4, maxRecentWarmBanks: 1, hotPadCount: 5, hotPadTtlMs: 90_000, dehydrateIdleMs: 8_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: false },
    },
  },
  mobile_web: {
    low: {
      kind: 'mobile_web',
      tier: 'low',
      warmupPolicy: { maxPerBank: 3, maxTotal: 5, idleDelayMs: 220, maxDurationMs: 60_000, skipUnknownDuration: true },
      startupRestorePadLimit: 220,
      backgroundHydrationPadLimit: 120,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 3, maxRecentWarmBanks: 1, hotPadCount: 4, hotPadTtlMs: 60_000, dehydrateIdleMs: 6_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: true },
    },
    medium: {
      kind: 'mobile_web',
      tier: 'medium',
      warmupPolicy: { maxPerBank: 4, maxTotal: 6, idleDelayMs: 180, maxDurationMs: 75_000, skipUnknownDuration: true },
      startupRestorePadLimit: 320,
      backgroundHydrationPadLimit: 180,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 4, maxRecentWarmBanks: 1, hotPadCount: 6, hotPadTtlMs: 90_000, dehydrateIdleMs: 8_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: true },
    },
    high: {
      kind: 'mobile_web',
      tier: 'high',
      warmupPolicy: { maxPerBank: 5, maxTotal: 8, idleDelayMs: 150, maxDurationMs: 90_000, skipUnknownDuration: true },
      startupRestorePadLimit: 420,
      backgroundHydrationPadLimit: 220,
      sessionMediaRetention: { enabled: true, minBanksForDehydration: 5, maxRecentWarmBanks: 2, hotPadCount: 8, hotPadTtlMs: 120_000, dehydrateIdleMs: 10_000 },
      preparedPlayback: { autoScanOnIdle: false, queueAfterPlay: false, diagEnabled: true },
    },
  },
};

const getNavigatorDeviceMemory = (): number | null => {
  if (typeof navigator === 'undefined') return null;
  const raw = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Number(raw) : null;
};

const getNavigatorCpuCores = (): number | null => {
  if (typeof navigator === 'undefined') return null;
  const raw = navigator.hardwareConcurrency;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Number(raw) : null;
};

const resolveMobileRuntimeTier = (): SamplerRuntimeTier => {
  const deviceMemory = getNavigatorDeviceMemory();
  const cpuCores = getNavigatorCpuCores();

  if ((deviceMemory !== null && deviceMemory <= 3) || (cpuCores !== null && cpuCores <= 4)) {
    return 'low';
  }
  if ((deviceMemory !== null && deviceMemory >= 8) && (cpuCores !== null && cpuCores >= 8)) {
    return 'high';
  }
  return 'medium';
};

export const resolveSamplerRuntimeKind = (): SamplerRuntimeKind => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'desktop_web';

  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isCapacitorNative = Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  const isElectron = Boolean(
    /Electron/i.test(ua) ||
    (window as Window & { process?: { versions?: { electron?: string } } }).process?.versions?.electron
  );

  if (isElectron) return 'electron_desktop';
  if (isCapacitorNative && isAndroid) return 'android_capacitor';
  if (isCapacitorNative && isIOS) return 'ios_capacitor';
  if (isIOS) return 'ios_web';
  if (isMobile) return 'mobile_web';
  return 'desktop_web';
};

export const getSamplerRuntimeTuningProfile = (): SamplerRuntimeTuningProfile => {
  const runtimeKind = resolveSamplerRuntimeKind();

  if (runtimeKind === 'electron_desktop') {
    const electronProfile = getElectronMemoryTuningProfile();
    if (electronProfile) {
      return {
        kind: 'electron_desktop',
        tier: electronProfile.tier,
        warmupPolicy: { ...electronProfile.warmupPolicy },
        startupRestorePadLimit: electronProfile.startupRestorePadLimit,
        backgroundHydrationPadLimit: electronProfile.backgroundHydrationPadLimit,
        sessionMediaRetention: {
          enabled: true,
          ...electronProfile.sessionMediaRetention,
          dehydrateIdleMs: electronProfile.dehydrateIdleMs,
        },
        preparedPlayback: {
          autoScanOnIdle: false,
          queueAfterPlay: true,
          diagEnabled: true,
        },
      };
    }

    // Preload/system memory info can be temporarily unavailable during early boot.
    // Fall back to a safe desktop profile instead of indexing the mobile profile map.
    return {
      kind: 'electron_desktop',
      tier: 'medium',
      warmupPolicy: { ...DEFAULT_DESKTOP_WARMUP },
      startupRestorePadLimit: 900,
      backgroundHydrationPadLimit: 320,
      sessionMediaRetention: {
        enabled: true,
        minBanksForDehydration: 5,
        maxRecentWarmBanks: 2,
        hotPadCount: 16,
        hotPadTtlMs: 180_000,
        dehydrateIdleMs: 10_000,
      },
      preparedPlayback: {
        autoScanOnIdle: false,
        queueAfterPlay: true,
        diagEnabled: true,
      },
    };
  }

  if (runtimeKind === 'desktop_web') {
    const retention = getDesktopSessionMediaRetentionPolicy();
    const tier = retention?.hotPadCount && retention.hotPadCount >= 20
      ? 'high'
      : retention?.hotPadCount && retention.hotPadCount <= 8
        ? 'low'
        : 'medium';
    return {
      kind: 'desktop_web',
      tier,
      warmupPolicy: { ...DEFAULT_DESKTOP_WARMUP },
      startupRestorePadLimit: 1_200,
      backgroundHydrationPadLimit: 480,
      sessionMediaRetention: {
        enabled: true,
        minBanksForDehydration: retention?.minBanksForDehydration ?? 5,
        maxRecentWarmBanks: retention?.maxRecentWarmBanks ?? 1,
        hotPadCount: retention?.hotPadCount ?? 14,
        hotPadTtlMs: retention?.hotPadTtlMs ?? 180_000,
        dehydrateIdleMs: retention?.dehydrateIdleMs ?? 15_000,
      },
      preparedPlayback: {
        autoScanOnIdle: false,
        queueAfterPlay: true,
        diagEnabled: true,
      },
    };
  }

  const tier = resolveMobileRuntimeTier();
  return MOBILE_RUNTIME_PROFILES[runtimeKind][tier];
};
