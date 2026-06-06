import { asNumber, asString } from "./validate.ts";

export type AccountTier = "guest" | "free" | "pro" | "pro_max";
export type StoredAccountTier = Exclude<AccountTier, "guest">;

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
  role: "admin" | "user" | "guest";
  limits: AccountLimits;
  features: AccountFeatures;
  overrideSummary: {
    hasLimits: boolean;
    hasFeatures: boolean;
  };
  refreshedAt: string;
};

export const ACCOUNT_CAPABILITY_VERSION = 1;

export const DEFAULT_ACCOUNT_LIMITS: Record<AccountTier, AccountLimits> = {
  guest: {
    ownedBankQuota: 0,
    ownedBankPadCap: 0,
    deviceTotalBankCap: 1,
    defaultBankDailyPlays: 10,
    deckMinCount: 1,
    deckDefaultCount: 1,
    deckCount: 1,
  },
  free: {
    ownedBankQuota: 2,
    ownedBankPadCap: 25,
    deviceTotalBankCap: 4,
    defaultBankDailyPlays: 50,
    deckMinCount: 1,
    deckDefaultCount: 1,
    deckCount: 1,
  },
  pro: {
    ownedBankQuota: 6,
    ownedBankPadCap: 64,
    deviceTotalBankCap: 120,
    defaultBankDailyPlays: null,
    deckMinCount: 1,
    deckDefaultCount: 2,
    deckCount: 4,
  },
  pro_max: {
    ownedBankQuota: 12,
    ownedBankPadCap: 128,
    deviceTotalBankCap: 150,
    defaultBankDailyPlays: null,
    deckMinCount: 1,
    deckDefaultCount: 4,
    deckCount: 8,
  },
};

const proFeatureSet: AccountFeatures = {
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

export const DEFAULT_ACCOUNT_FEATURES: Record<AccountTier, AccountFeatures> = {
  guest: {
    ...proFeatureSet,
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
    storeDemoBanks: true,
  },
  free: {
    ...proFeatureSet,
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
  pro: proFeatureSet,
  pro_max: {
    ...proFeatureSet,
    bankStoreAllAccess: true,
  },
};

const toCamelFeatureKey = (key: string): keyof AccountFeatures | null => {
  const normalized = key.trim();
  const direct = normalized as keyof AccountFeatures;
  if (direct in proFeatureSet) return direct;
  const camel = normalized.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof AccountFeatures;
  return camel in proFeatureSet ? camel : null;
};

const normalizeStoredTier = (value: unknown): StoredAccountTier => {
  const tier = asString(value, 32);
  if (tier === "pro" || tier === "pro_max") return tier;
  return "free";
};

export const normalizeEffectiveTier = (profile: any): StoredAccountTier => {
  if (profile?.role === "admin") return "pro_max";
  return normalizeStoredTier(profile?.account_tier);
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const mergeLimits = (base: AccountLimits, raw: unknown): AccountLimits => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const defaultBankDailyPlaysRaw = input.defaultBankDailyPlays ?? input.default_bank_daily_plays;
  const defaultBankDailyPlays = defaultBankDailyPlaysRaw === null
    ? null
    : clampInt(defaultBankDailyPlaysRaw, base.defaultBankDailyPlays ?? 0, 0, 100000);
  const deckCount = clampInt(input.deckCount ?? input.deck_count, base.deckCount, 1, 8);
  const deckMinCount = clampInt(input.deckMinCount ?? input.deck_min_count, Math.min(base.deckMinCount, deckCount), 1, deckCount);
  const deckDefaultCount = clampInt(input.deckDefaultCount ?? input.deck_default_count, Math.max(deckMinCount, Math.min(deckCount, base.deckDefaultCount)), deckMinCount, deckCount);
  return {
    ownedBankQuota: clampInt(input.ownedBankQuota ?? input.owned_bank_quota, base.ownedBankQuota, 0, 500),
    ownedBankPadCap: clampInt(input.ownedBankPadCap ?? input.owned_bank_pad_cap, base.ownedBankPadCap, 0, 256),
    deviceTotalBankCap: clampInt(input.deviceTotalBankCap ?? input.device_total_bank_cap, base.deviceTotalBankCap, 1, 1000),
    defaultBankDailyPlays,
    deckMinCount,
    deckDefaultCount,
    deckCount,
  };
};

const mergeFeatures = (base: AccountFeatures, raw: unknown): AccountFeatures => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const next = { ...base };
  for (const [rawKey, value] of Object.entries(input)) {
    const key = toCamelFeatureKey(rawKey);
    if (!key || typeof value !== "boolean") continue;
    next[key] = value;
  }
  return next;
};

export const buildAccountCapabilitySnapshot = (
  profile: any,
  tierConfig?: any | null,
  overrideRow?: any | null,
): AccountCapabilitySnapshot => {
  const role = profile?.role === "admin" ? "admin" : "user";
  const baseTier = normalizeStoredTier(profile?.account_tier);
  const effectiveTier = normalizeEffectiveTier(profile);
  const configLimits = mergeLimits(DEFAULT_ACCOUNT_LIMITS[effectiveTier], tierConfig?.limits);
  const tierSource = asString(profile?.tier_source, 40);
  const shouldApplyLegacyProfileLimits = tierSource === "admin" || tierSource === "system";
  const profileLimits = shouldApplyLegacyProfileLimits
    ? mergeLimits(configLimits, {
        ownedBankQuota: profile?.owned_bank_quota,
        ownedBankPadCap: profile?.owned_bank_pad_cap,
        deviceTotalBankCap: profile?.device_total_bank_cap,
      })
    : configLimits;
  const configFeatures = mergeFeatures(DEFAULT_ACCOUNT_FEATURES[effectiveTier], tierConfig?.features);
  const limits = mergeLimits(profileLimits, overrideRow?.limits);
  const features = mergeFeatures(configFeatures, overrideRow?.features);
  return {
    version: ACCOUNT_CAPABILITY_VERSION,
    baseTier,
    effectiveTier,
    role,
    limits,
    features,
    overrideSummary: {
      hasLimits: Boolean(overrideRow?.limits && Object.keys(overrideRow.limits || {}).length > 0),
      hasFeatures: Boolean(overrideRow?.features && Object.keys(overrideRow.features || {}).length > 0),
    },
    refreshedAt: new Date().toISOString(),
  };
};

export const loadAccountCapabilitySnapshot = async (
  admin: any,
  userId: string | null,
): Promise<AccountCapabilitySnapshot> => {
  if (!userId) {
    return {
      version: ACCOUNT_CAPABILITY_VERSION,
      baseTier: "guest",
      effectiveTier: "guest",
      role: "guest",
      limits: DEFAULT_ACCOUNT_LIMITS.guest,
      features: DEFAULT_ACCOUNT_FEATURES.guest,
      overrideSummary: { hasLimits: false, hasFeatures: false },
      refreshedAt: new Date().toISOString(),
    };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id,role,account_tier,tier_source,owned_bank_quota,owned_bank_pad_cap,device_total_bank_cap")
    .eq("id", userId)
    .maybeSingle();
  const safeProfile = profile || { id: userId, role: "user", account_tier: "free" };
  const effectiveTier = normalizeEffectiveTier(safeProfile);
  const [tierResult, overrideResult] = await Promise.all([
    admin.from("account_tier_configs").select("tier,limits,features,is_active").eq("tier", effectiveTier).maybeSingle(),
    admin.from("profile_feature_overrides").select("limits,features").eq("user_id", userId).maybeSingle(),
  ]);
  return buildAccountCapabilitySnapshot(safeProfile, tierResult.data, overrideResult.data);
};

export const normalizeTierPrice = (value: unknown): number => {
  const parsed = asNumber(value);
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
};
