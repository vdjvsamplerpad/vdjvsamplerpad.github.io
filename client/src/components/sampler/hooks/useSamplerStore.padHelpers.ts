import { PadData, SamplerBank } from '../types/sampler';

export const normalizePadNameToken = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export const getPadPositionOrFallback = (pad: Partial<PadData>, fallbackIndex: number): number => {
  if (typeof pad.position === 'number' && Number.isFinite(pad.position) && pad.position >= 0) {
    return Math.floor(pad.position);
  }
  return fallbackIndex;
};

export const padHasExpectedImageAsset = (pad: Partial<PadData>): boolean => {
  return Boolean(
    pad.hasImageAsset === true ||
      pad.imageStorageKey ||
      pad.imageData ||
      (typeof pad.imageUrl === 'string' && pad.imageUrl.trim().length > 0) ||
      pad.imageBackend === 'native'
  );
};

export const padNeedsMediaHydration = (pad: PadData): boolean => {
  const missingAudio = !pad.audioUrl && Boolean(pad.audioStorageKey || pad.audioBackend);
  const expectsImage = padHasExpectedImageAsset(pad);
  const missingImage = expectsImage && !pad.imageUrl && Boolean(pad.imageStorageKey || pad.imageData || pad.imageBackend);
  return Boolean(missingAudio || missingImage);
};

export const getPadMissingMediaState = (pad: Partial<PadData>): { missingAudio: boolean; missingImage: boolean } => {
  const missingAudio = !pad.audioUrl && Boolean(pad.audioStorageKey || pad.audioBackend);
  const expectsImage = padHasExpectedImageAsset(pad);
  const missingImage = expectsImage && !pad.imageUrl && Boolean(pad.imageStorageKey || pad.imageData || pad.imageBackend);
  return { missingAudio, missingImage };
};

export const summarizeMissingMedia = (
  banks: Array<Pick<SamplerBank, 'name' | 'pads'>>
): { missingAudio: number; missingImages: number; affectedBanks: string[] } | null => {
  let missingAudio = 0;
  let missingImages = 0;
  const affectedBanks = new Set<string>();

  banks.forEach((bank) => {
    bank.pads.forEach((pad) => {
      const state = getPadMissingMediaState(pad);
      if (state.missingAudio) {
        missingAudio += 1;
        affectedBanks.add(bank.name);
      }
      if (state.missingImage) {
        missingImages += 1;
        affectedBanks.add(bank.name);
      }
    });
  });

  if (missingAudio <= 0 && missingImages <= 0) return null;

  return {
    missingAudio,
    missingImages,
    affectedBanks: Array.from(affectedBanks).slice(0, 20),
  };
};

export const generateId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).substr(2);
