import { SamplerBank } from '../types/sampler';
import { sanitizeBankForHiddenProtectedCache } from './useSamplerStore.hiddenProtectedBanksCache';

type DefaultBankOwnerCacheState = {
  byOwner?: Record<string, unknown>;
  guest?: unknown;
};

const reviveCachedBank = (bank: any): SamplerBank | null => {
  if (!bank || typeof bank !== 'object') return null;
  if (!Array.isArray(bank.pads)) return null;
  return {
    ...bank,
    createdAt: bank.createdAt ? new Date(bank.createdAt) : new Date(),
    pads: bank.pads.map((pad: any, padIndex: number) => ({
      ...pad,
      fadeInMs: pad.fadeInMs || 0,
      fadeOutMs: pad.fadeOutMs || 0,
      startTimeMs: pad.startTimeMs || 0,
      endTimeMs: pad.endTimeMs || 0,
      pitch: pad.pitch || 0,
      tempoPercent: typeof pad.tempoPercent === 'number' ? pad.tempoPercent : 0,
      keyLock: pad.keyLock !== false,
      savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
        ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
        : [null, null, null, null],
      position: pad.position ?? padIndex,
    })),
  };
};

const readCacheState = (storageKey: string): DefaultBankOwnerCacheState => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DefaultBankOwnerCacheState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeCacheState = (storageKey: string, state: DefaultBankOwnerCacheState): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Best effort only.
  }
};

export const readDefaultBankOwnerCache = (
  storageKey: string,
  ownerId: string | null
): SamplerBank | null => {
  const state = readCacheState(storageKey);
  const rawBank = ownerId ? state.byOwner?.[ownerId] : state.guest;
  return reviveCachedBank(rawBank);
};

export const writeDefaultBankOwnerCache = (
  storageKey: string,
  ownerId: string | null,
  bank: SamplerBank | null
): void => {
  const state = readCacheState(storageKey);
  const sanitized = bank ? sanitizeBankForHiddenProtectedCache(bank) : null;

  if (ownerId) {
    const byOwner = { ...(state.byOwner || {}) };
    if (sanitized) {
      byOwner[ownerId] = sanitized;
    } else {
      delete byOwner[ownerId];
    }

    const nextState: DefaultBankOwnerCacheState = { ...state };
    if (Object.keys(byOwner).length > 0) {
      nextState.byOwner = byOwner;
    } else {
      delete nextState.byOwner;
    }
    writeCacheState(storageKey, nextState);
    return;
  }

  const nextState: DefaultBankOwnerCacheState = { ...state };
  if (sanitized) {
    nextState.guest = sanitized;
  } else {
    delete nextState.guest;
  }
  writeCacheState(storageKey, nextState);
};
