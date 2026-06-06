export type AccountTier = 'guest' | 'free' | 'pro' | 'pro_max';
export type StoredAccountTier = Exclude<AccountTier, 'guest'>;

export type AccountLimits = {
  ownedBankQuota: number;
  ownedBankPadCap: number;
  deviceTotalBankCap: number;
  defaultBankDailyPlays: number | null;
  deckMinCount: number;
  deckDefaultCount: number;
  deckCount: number;
};

export type AccountFeatures = {
  bankStoreBrowse: boolean;
  bankStoreCheckout: boolean;
  bankStoreDownload: boolean;
  bankStoreFreeClaim: boolean;
  bankStoreAllAccess: boolean;
  search: boolean;
  inputMapping: boolean;
  systemShortcuts: boolean;
  channelShortcuts: boolean;
  mappingImportExport: boolean;
  backupRepair: boolean;
  advancedStopModes: boolean;
  mixerHotcue: boolean;
  padEditGroup: boolean;
  padEditTempo: boolean;
  padEditKeyboardMidi: boolean;
  padEditHotcue: boolean;
  padEditFades: boolean;
  bankEditPosition: boolean;
  bankEditKeyboardMidi: boolean;
  storeDemoBanks: boolean;
  ownBankUnlimitedPlay: boolean;
};

export type AccountCapabilitySnapshot = {
  version: number;
  baseTier: AccountTier;
  effectiveTier: AccountTier;
  role: 'admin' | 'user' | 'guest';
  limits: AccountLimits;
  features: AccountFeatures;
  overrideSummary: {
    hasLimits: boolean;
    hasFeatures: boolean;
  };
  refreshedAt: string;
};

export const ACCOUNT_CAPABILITIES_CACHE_KEY = 'vdjv-account-capabilities-v5';

const proFeatures: AccountFeatures = {
  bankStoreBrowse: true,
  bankStoreCheckout: true,
  bankStoreDownload: true,
  bankStoreFreeClaim: true,
  bankStoreAllAccess: false,
  search: true,
  inputMapping: true,
  systemShortcuts: true,
  channelShortcuts: true,
  mappingImportExport: true,
  backupRepair: true,
  advancedStopModes: true,
  mixerHotcue: true,
  padEditGroup: true,
  padEditTempo: true,
  padEditKeyboardMidi: true,
  padEditHotcue: true,
  padEditFades: true,
  bankEditPosition: true,
  bankEditKeyboardMidi: true,
  storeDemoBanks: true,
  ownBankUnlimitedPlay: true,
};

export const DEFAULT_ACCOUNT_CAPABILITIES: Record<AccountTier, AccountCapabilitySnapshot> = {
  guest: {
    version: 1,
    baseTier: 'guest',
    effectiveTier: 'guest',
    role: 'guest',
    limits: {
      ownedBankQuota: 0,
      ownedBankPadCap: 0,
      deviceTotalBankCap: 1,
      defaultBankDailyPlays: 10,
      deckMinCount: 1,
      deckDefaultCount: 1,
      deckCount: 1,
    },
    features: {
      ...proFeatures,
      bankStoreCheckout: false,
      bankStoreDownload: false,
      bankStoreFreeClaim: false,
      bankStoreAllAccess: false,
      search: false,
      inputMapping: false,
      systemShortcuts: false,
      channelShortcuts: false,
      mappingImportExport: false,
      backupRepair: false,
      advancedStopModes: false,
      mixerHotcue: false,
      padEditGroup: false,
      padEditTempo: false,
      padEditKeyboardMidi: false,
      padEditHotcue: false,
      padEditFades: false,
      bankEditPosition: false,
      bankEditKeyboardMidi: false,
    },
    overrideSummary: { hasLimits: false, hasFeatures: false },
    refreshedAt: new Date(0).toISOString(),
  },
  free: {
    version: 1,
    baseTier: 'free',
    effectiveTier: 'free',
    role: 'user',
    limits: {
      ownedBankQuota: 2,
      ownedBankPadCap: 25,
      deviceTotalBankCap: 4,
      defaultBankDailyPlays: 50,
      deckMinCount: 1,
      deckDefaultCount: 1,
      deckCount: 1,
    },
    features: {
      ...proFeatures,
      bankStoreCheckout: false,
      bankStoreDownload: false,
      bankStoreFreeClaim: false,
      bankStoreAllAccess: false,
      search: false,
      inputMapping: false,
      systemShortcuts: false,
      channelShortcuts: false,
      mappingImportExport: false,
      backupRepair: false,
      advancedStopModes: false,
      mixerHotcue: false,
      padEditGroup: false,
      padEditTempo: false,
      padEditKeyboardMidi: false,
      padEditHotcue: false,
      padEditFades: false,
      bankEditPosition: false,
      bankEditKeyboardMidi: false,
    },
    overrideSummary: { hasLimits: false, hasFeatures: false },
    refreshedAt: new Date(0).toISOString(),
  },
  pro: {
    version: 1,
    baseTier: 'pro',
    effectiveTier: 'pro',
    role: 'user',
    limits: {
      ownedBankQuota: 6,
      ownedBankPadCap: 64,
      deviceTotalBankCap: 120,
      defaultBankDailyPlays: null,
      deckMinCount: 1,
      deckDefaultCount: 2,
      deckCount: 4,
    },
    features: proFeatures,
    overrideSummary: { hasLimits: false, hasFeatures: false },
    refreshedAt: new Date(0).toISOString(),
  },
  pro_max: {
    version: 1,
    baseTier: 'pro_max',
    effectiveTier: 'pro_max',
    role: 'user',
    limits: {
      ownedBankQuota: 12,
      ownedBankPadCap: 128,
      deviceTotalBankCap: 150,
      defaultBankDailyPlays: null,
      deckMinCount: 1,
      deckDefaultCount: 4,
      deckCount: 8,
    },
    features: { ...proFeatures, bankStoreAllAccess: true },
    overrideSummary: { hasLimits: false, hasFeatures: false },
    refreshedAt: new Date(0).toISOString(),
  },
};

export const normalizeAccountTier = (value: unknown): AccountTier => {
  if (value === 'free' || value === 'pro' || value === 'pro_max' || value === 'guest') return value;
  return 'free';
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

export const normalizeAccountLimits = (
  limits: Partial<AccountLimits> | Record<string, unknown> | null | undefined,
  fallback: AccountLimits,
): AccountLimits => {
  const input = limits && typeof limits === 'object' ? limits as Record<string, unknown> : {};
  const deckMax = clampInt(input.deckCount ?? input.deck_count, fallback.deckCount, 1, 8);
  const deckMin = clampInt(
    input.deckMinCount ?? input.deck_min_count,
    Math.min(fallback.deckMinCount ?? 1, deckMax),
    1,
    deckMax,
  );
  const deckDefault = clampInt(
    input.deckDefaultCount ?? input.deck_default_count,
    Math.max(deckMin, Math.min(deckMax, fallback.deckDefaultCount ?? deckMin)),
    deckMin,
    deckMax,
  );
  return {
    ownedBankQuota: clampInt(input.ownedBankQuota ?? input.owned_bank_quota, fallback.ownedBankQuota, 0, 500),
    ownedBankPadCap: clampInt(input.ownedBankPadCap ?? input.owned_bank_pad_cap, fallback.ownedBankPadCap, 0, 256),
    deviceTotalBankCap: clampInt(input.deviceTotalBankCap ?? input.device_total_bank_cap, fallback.deviceTotalBankCap, 1, 1000),
    defaultBankDailyPlays: (input.defaultBankDailyPlays ?? input.default_bank_daily_plays) === null
      ? null
      : clampInt(input.defaultBankDailyPlays ?? input.default_bank_daily_plays, fallback.defaultBankDailyPlays ?? 0, 0, 100000),
    deckMinCount: deckMin,
    deckDefaultCount: deckDefault,
    deckCount: deckMax,
  };
};

export const normalizeAccountCapabilitySnapshot = (
  snapshot: AccountCapabilitySnapshot,
  fallback?: AccountCapabilitySnapshot,
): AccountCapabilitySnapshot => {
  const fallbackTier = normalizeAccountTier(snapshot.effectiveTier || fallback?.effectiveTier || 'free');
  const fallbackLimits = fallback?.limits || DEFAULT_ACCOUNT_CAPABILITIES[fallbackTier].limits;
  return {
    ...snapshot,
    limits: normalizeAccountLimits(snapshot.limits, fallbackLimits),
  };
};

export const fallbackCapabilitiesForProfile = (profile?: { role?: string | null; account_tier?: string | null } | null): AccountCapabilitySnapshot => {
  if (!profile) return DEFAULT_ACCOUNT_CAPABILITIES.guest;
  if (profile.role === 'admin') {
    return { ...DEFAULT_ACCOUNT_CAPABILITIES.pro_max, role: 'admin', baseTier: 'pro_max', effectiveTier: 'pro_max' };
  }
  const tier = normalizeAccountTier(profile.account_tier || 'free');
  if (tier === 'guest') return DEFAULT_ACCOUNT_CAPABILITIES.free;
  return DEFAULT_ACCOUNT_CAPABILITIES[tier];
};

export const readCachedCapabilities = (userId: string | null): AccountCapabilitySnapshot | null => {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`${ACCOUNT_CAPABILITIES_CACHE_KEY}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccountCapabilitySnapshot;
    if (!parsed || typeof parsed !== 'object' || !parsed.effectiveTier || !parsed.features || !parsed.limits) return null;
    return normalizeAccountCapabilitySnapshot(parsed);
  } catch {
    return null;
  }
};

export const writeCachedCapabilities = (userId: string | null, snapshot: AccountCapabilitySnapshot | null): void => {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = `${ACCOUNT_CAPABILITIES_CACHE_KEY}:${userId}`;
    if (!snapshot) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
  }
};
