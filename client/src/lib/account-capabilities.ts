export type AccountTier = 'guest' | 'free' | 'pro' | 'pro_max';
export type StoredAccountTier = Exclude<AccountTier, 'guest'>;

export type AccountLimits = {
  ownedBankQuota: number;
  ownedBankPadCap: number;
  deviceTotalBankCap: number;
  defaultBankDailyPlays: number | null;
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

export const ACCOUNT_CAPABILITIES_CACHE_KEY = 'vdjv-account-capabilities-v4';

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
      deckCount: 2,
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
      deckCount: 4,
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
    return parsed;
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
