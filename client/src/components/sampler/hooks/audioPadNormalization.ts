export type HotcueTuple = [number | null, number | null, number | null, number | null];
export type PadTriggerMode = 'toggle' | 'hold' | 'stutter' | 'unmute';
export type PadPlaybackMode = 'once' | 'loop' | 'stopper';

export const normalizePadTriggerModeValue = (value: unknown): PadTriggerMode => (
  value === 'toggle' || value === 'hold' || value === 'stutter' || value === 'unmute'
    ? value
    : 'toggle'
);

export const normalizePadPlaybackModeValue = (value: unknown): PadPlaybackMode => (
  value === 'once' || value === 'loop' || value === 'stopper'
    ? value
    : 'once'
);

export const normalizePadVolumeValue = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0, Math.min(1, numeric));
};

export const normalizePadGainLinearValue = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0, numeric);
};

export const normalizeTempoPercentValue = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-50, Math.min(100, Math.round(numeric)));
};

export const normalizeKeyLockValue = (value: unknown): boolean => value !== false;

export const normalizeTempoPercentForRuntime = (isIOS: boolean, value: unknown): number => (
  isIOS ? 0 : normalizeTempoPercentValue(value)
);

export const normalizeKeyLockForRuntime = (isIOS: boolean, value: unknown): boolean => (
  isIOS ? false : normalizeKeyLockValue(value)
);

export const tempoPercentToRateValue = (value: unknown): number => {
  const safePercent = normalizeTempoPercentValue(value);
  return Math.max(0.5, Math.min(2, 1 + (safePercent / 100)));
};

export const tempoPercentToRateForRuntime = (isIOS: boolean, value: unknown): number => (
  isIOS ? 1 : tempoPercentToRateValue(value)
);

export const normalizeAudioBytesValue = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
};

export const normalizeDurationMsValue = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
};

export const cloneHotcuesTupleValue = (value?: unknown): HotcueTuple => {
  const input = Array.isArray(value) ? value : [];
  const next: HotcueTuple = [null, null, null, null];
  for (let i = 0; i < 4; i += 1) {
    const cue = input[i];
    next[i] = typeof cue === 'number' && Number.isFinite(cue)
      ? (cue >= 0 ? cue : null)
      : null;
  }
  return next;
};
