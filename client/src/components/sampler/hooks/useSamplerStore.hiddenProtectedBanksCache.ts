import { PadData, SamplerBank } from '../types/sampler';

const sanitizePadForPersistentCache = (pad: PadData, padIndex: number): PadData => ({
  ...pad,
  audioUrl: null,
  imageUrl: null,
  imageData: undefined,
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
});

export const sanitizeBankForHiddenProtectedCache = (bank: SamplerBank): SamplerBank => ({
  ...bank,
  bankMetadata: bank.bankMetadata
    ? {
        ...bank.bankMetadata,
        thumbnailUrl: bank.bankMetadata.thumbnailUrl?.startsWith('blob:')
          ? undefined
          : bank.bankMetadata.thumbnailUrl,
      }
    : bank.bankMetadata,
  pads: (bank.pads || []).map((pad, padIndex) => sanitizePadForPersistentCache(pad, padIndex)),
});

const reviveCachedPad = (pad: any, padIndex: number): PadData => ({
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
});

const reviveCachedBank = (bank: any, index: number): SamplerBank => ({
  ...bank,
  createdAt: bank?.createdAt ? new Date(bank.createdAt) : new Date(),
  sortOrder: bank?.sortOrder ?? index,
  pads: Array.isArray(bank?.pads) ? bank.pads.map((pad: any, padIndex: number) => reviveCachedPad(pad, padIndex)) : [],
});

export const readHiddenProtectedBanksCache = (cacheKey: string): Record<string, SamplerBank[]> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, any[]>;
    const revived: Record<string, SamplerBank[]> = {};
    Object.entries(parsed || {}).forEach(([userId, banks]) => {
      if (!Array.isArray(banks) || !userId) return;
      revived[userId] = banks.map((bank, index) => reviveCachedBank(bank, index));
    });
    return revived;
  } catch {
    return {};
  }
};

export const writeHiddenProtectedBanksCache = (cacheKey: string, cache: Record<string, SamplerBank[]>): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(cache));
  } catch {
  }
};

