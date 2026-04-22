export type DefaultBankPlayAllowanceState = {
  key: string;
  usedCount: number;
  remainingCount: number;
  exhausted: boolean;
  dayKey: string;
  lastSeenAt: number;
  resetAfter: number;
};

const STORAGE_KEY_PREFIX = 'vdjv-default-bank-play-allowance-v1:';

const getLocalDayKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNextLocalMidnightMs = (date = new Date()): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();

const storageKeyFor = (userId: string, tier: string): string =>
  `${STORAGE_KEY_PREFIX}${tier}:${userId}`;

const normalizeLimit = (limit: number): number =>
  Math.max(0, Math.min(100000, Math.floor(Number.isFinite(limit) ? limit : 0)));

const createState = (key: string, limit: number, now = new Date()): DefaultBankPlayAllowanceState => ({
  key,
  usedCount: 0,
  remainingCount: normalizeLimit(limit),
  exhausted: normalizeLimit(limit) <= 0,
  dayKey: getLocalDayKey(now),
  lastSeenAt: now.getTime(),
  resetAfter: getNextLocalMidnightMs(now),
});

const normalizeState = (
  key: string,
  limit: number,
  value: unknown,
  now = new Date(),
): DefaultBankPlayAllowanceState => {
  const normalizedLimit = normalizeLimit(limit);
  const fallback = createState(key, normalizedLimit, now);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  const nowMs = now.getTime();
  const storedLastSeen = Number(source.lastSeenAt);
  const lastSeenAt = Number.isFinite(storedLastSeen) ? Math.max(0, storedLastSeen) : nowMs;
  const storedResetAfter = Number(source.resetAfter);
  const resetAfter = Number.isFinite(storedResetAfter) ? Math.max(0, storedResetAfter) : fallback.resetAfter;
  const storedDayKey = typeof source.dayKey === 'string' && source.dayKey ? source.dayKey : fallback.dayKey;

  const clockMovedBack = nowMs + 5 * 60 * 1000 < lastSeenAt;
  const shouldReset = !clockMovedBack && storedDayKey !== fallback.dayKey && nowMs >= resetAfter;
  if (shouldReset) return fallback;

  const usedCount = Math.max(0, Math.min(normalizedLimit, Math.floor(Number(source.usedCount) || 0)));
  return {
    key,
    usedCount,
    remainingCount: Math.max(0, normalizedLimit - usedCount),
    exhausted: usedCount >= normalizedLimit,
    dayKey: storedDayKey,
    lastSeenAt: Math.max(lastSeenAt, nowMs),
    resetAfter: Math.max(resetAfter, fallback.resetAfter),
  };
};

export const loadDefaultBankPlayAllowance = (
  userId: string,
  tier: string,
  limit: number,
): DefaultBankPlayAllowanceState => {
  const key = storageKeyFor(userId, tier);
  if (typeof window === 'undefined') return createState(key, limit);
  try {
    return normalizeState(key, limit, JSON.parse(window.localStorage.getItem(key) || 'null'));
  } catch {
    return createState(key, limit);
  }
};

export const persistDefaultBankPlayAllowance = (state: DefaultBankPlayAllowanceState): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(state.key, JSON.stringify(state));
  } catch {
  }
};

export const consumeDefaultBankPlayAllowance = (
  state: DefaultBankPlayAllowanceState,
  limit: number,
): DefaultBankPlayAllowanceState => {
  const normalizedLimit = normalizeLimit(limit);
  const usedCount = Math.max(0, Math.min(normalizedLimit, state.usedCount + 1));
  const now = Date.now();
  return {
    ...state,
    usedCount,
    remainingCount: Math.max(0, normalizedLimit - usedCount),
    exhausted: usedCount >= normalizedLimit,
    lastSeenAt: Math.max(state.lastSeenAt, now),
  };
};
