export const GUEST_DEFAULT_BANK_TRIAL_LIMIT = 10;

const GUEST_DEFAULT_BANK_TRIAL_STORAGE_KEY = 'vdjv-guest-default-bank-trial-v1';
const GUEST_DEFAULT_BANK_TRIAL_SHADOW_KEY = 'vdjv-guest-default-bank-trial-shadow-v1';
const GUEST_DEFAULT_BANK_TRIAL_SCHEMA_VERSION = 1;

type GuestDefaultBankTrialRecord = {
  schemaVersion: number;
  installId: string;
  usedCount: number;
  exhaustedAt: string | null;
  updatedAt: string;
};

export type GuestDefaultBankTrialState = {
  installId: string;
  usedCount: number;
  remainingCount: number;
  exhausted: boolean;
  exhaustedAt: string | null;
  updatedAt: string;
};

const createInstallId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const createDefaultRecord = (): GuestDefaultBankTrialRecord => ({
  schemaVersion: GUEST_DEFAULT_BANK_TRIAL_SCHEMA_VERSION,
  installId: createInstallId(),
  usedCount: 0,
  exhaustedAt: null,
  updatedAt: new Date().toISOString(),
});

const clampUsedCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(GUEST_DEFAULT_BANK_TRIAL_LIMIT, Math.floor(parsed)));
};

const normalizeIsoString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeRecord = (value: unknown): GuestDefaultBankTrialRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const installId = typeof source.installId === 'string' && source.installId.trim()
    ? source.installId.trim()
    : createInstallId();
  const usedCount = clampUsedCount(source.usedCount);
  const exhaustedAt = normalizeIsoString(source.exhaustedAt);
  const updatedAt = normalizeIsoString(source.updatedAt) || new Date().toISOString();
  return {
    schemaVersion: GUEST_DEFAULT_BANK_TRIAL_SCHEMA_VERSION,
    installId,
    usedCount: exhaustedAt ? Math.max(usedCount, GUEST_DEFAULT_BANK_TRIAL_LIMIT) : usedCount,
    exhaustedAt: exhaustedAt || (usedCount >= GUEST_DEFAULT_BANK_TRIAL_LIMIT ? updatedAt : null),
    updatedAt,
  };
};

const mergeRecords = (records: Array<GuestDefaultBankTrialRecord | null | undefined>): GuestDefaultBankTrialRecord => {
  const valid = records.filter(Boolean) as GuestDefaultBankTrialRecord[];
  if (valid.length === 0) return createDefaultRecord();
  const preferred = [...valid].sort((left, right) => {
    if (left.usedCount !== right.usedCount) return right.usedCount - left.usedCount;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  })[0];
  const highestUsed = valid.reduce((max, record) => Math.max(max, record.usedCount), 0);
  const newestUpdatedAt = [...valid].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  )[0]?.updatedAt || preferred.updatedAt;
  const exhaustedAt = valid
    .map((record) => normalizeIsoString(record.exhaustedAt))
    .filter(Boolean)
    .sort((left, right) => new Date(left as string).getTime() - new Date(right as string).getTime())[0] || null;
  const nextUsedCount = exhaustedAt ? Math.max(highestUsed, GUEST_DEFAULT_BANK_TRIAL_LIMIT) : highestUsed;
  return {
    schemaVersion: GUEST_DEFAULT_BANK_TRIAL_SCHEMA_VERSION,
    installId: preferred.installId || createInstallId(),
    usedCount: nextUsedCount,
    exhaustedAt: exhaustedAt || (nextUsedCount >= GUEST_DEFAULT_BANK_TRIAL_LIMIT ? newestUpdatedAt : null),
    updatedAt: newestUpdatedAt,
  };
};

const readLocalRecord = (key: string): GuestDefaultBankTrialRecord | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizeRecord(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeLocalRecord = (record: GuestDefaultBankTrialRecord): void => {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(record);
  try {
    window.localStorage.setItem(GUEST_DEFAULT_BANK_TRIAL_STORAGE_KEY, serialized);
    window.localStorage.setItem(GUEST_DEFAULT_BANK_TRIAL_SHADOW_KEY, serialized);
  } catch {
  }
};

const readElectronRecord = async (): Promise<GuestDefaultBankTrialRecord | null> => {
  if (typeof window === 'undefined') return null;
  const reader = window.electronAPI?.getGuestDefaultBankTrialState;
  if (typeof reader !== 'function') return null;
  try {
    return normalizeRecord(await reader());
  } catch {
    return null;
  }
};

const writeElectronRecord = async (record: GuestDefaultBankTrialRecord): Promise<void> => {
  if (typeof window === 'undefined') return;
  const writer = window.electronAPI?.setGuestDefaultBankTrialState;
  if (typeof writer !== 'function') return;
  try {
    await writer(record);
  } catch {
  }
};

const toState = (record: GuestDefaultBankTrialRecord): GuestDefaultBankTrialState => ({
  installId: record.installId,
  usedCount: record.usedCount,
  remainingCount: Math.max(0, GUEST_DEFAULT_BANK_TRIAL_LIMIT - record.usedCount),
  exhausted: record.usedCount >= GUEST_DEFAULT_BANK_TRIAL_LIMIT,
  exhaustedAt: record.exhaustedAt,
  updatedAt: record.updatedAt,
});

const toRecord = (state: GuestDefaultBankTrialState): GuestDefaultBankTrialRecord => ({
  schemaVersion: GUEST_DEFAULT_BANK_TRIAL_SCHEMA_VERSION,
  installId: state.installId || createInstallId(),
  usedCount: clampUsedCount(state.usedCount),
  exhaustedAt: state.exhausted ? (normalizeIsoString(state.exhaustedAt) || new Date().toISOString()) : null,
  updatedAt: normalizeIsoString(state.updatedAt) || new Date().toISOString(),
});

export const readGuestDefaultBankTrialStateSync = (): GuestDefaultBankTrialState =>
  toState(mergeRecords([
    readLocalRecord(GUEST_DEFAULT_BANK_TRIAL_STORAGE_KEY),
    readLocalRecord(GUEST_DEFAULT_BANK_TRIAL_SHADOW_KEY),
  ]));

export const loadGuestDefaultBankTrialState = async (): Promise<GuestDefaultBankTrialState> => {
  const merged = mergeRecords([
    readLocalRecord(GUEST_DEFAULT_BANK_TRIAL_STORAGE_KEY),
    readLocalRecord(GUEST_DEFAULT_BANK_TRIAL_SHADOW_KEY),
    await readElectronRecord(),
  ]);
  writeLocalRecord(merged);
  await writeElectronRecord(merged);
  return toState(merged);
};

export const persistGuestDefaultBankTrialState = async (state: GuestDefaultBankTrialState): Promise<void> => {
  const record = normalizeRecord(toRecord(state)) || createDefaultRecord();
  writeLocalRecord(record);
  await writeElectronRecord(record);
};

export const consumeGuestDefaultBankTrialPlay = (
  current: GuestDefaultBankTrialState,
): GuestDefaultBankTrialState => {
  const nextUsedCount = Math.max(0, Math.min(GUEST_DEFAULT_BANK_TRIAL_LIMIT, current.usedCount + 1));
  const exhausted = nextUsedCount >= GUEST_DEFAULT_BANK_TRIAL_LIMIT;
  const updatedAt = new Date().toISOString();
  return {
    installId: current.installId || createInstallId(),
    usedCount: nextUsedCount,
    remainingCount: Math.max(0, GUEST_DEFAULT_BANK_TRIAL_LIMIT - nextUsedCount),
    exhausted,
    exhaustedAt: exhausted ? (current.exhaustedAt || updatedAt) : null,
    updatedAt,
  };
};
