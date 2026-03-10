import { cloneHotcuesTupleValue, type HotcueTuple } from './audioPadNormalization';

export const hotcueTupleEqualsValue = (left: HotcueTuple, right: HotcueTuple): boolean => {
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

export const computeChannelHotcueMaxMs = (
  startMs: number,
  endMs: number,
  sourceDurationMs: number
): number => {
  const regionMs = Math.max(0, endMs - startMs);
  if (regionMs > 0) return regionMs;
  return Math.max(0, sourceDurationMs - startMs);
};

export const normalizeChannelHotcueValueForWindow = (
  cue: number | null,
  startMs: number,
  maxMs: number
): number | null => {
  if (typeof cue !== 'number' || !Number.isFinite(cue) || cue < 0) return null;
  if (maxMs <= 0) return Math.max(0, cue);

  // Support both absolute source coords and channel-relative coords.
  const absoluteToRelative = cue - startMs;
  const baseValue = (absoluteToRelative >= 0 && absoluteToRelative <= maxMs)
    ? absoluteToRelative
    : cue;
  return Math.max(0, Math.min(maxMs, baseValue));
};

export const normalizeChannelHotcuesForWindow = (
  value: unknown,
  startMs: number,
  maxMs: number
): HotcueTuple => {
  const cloned = cloneHotcuesTupleValue(value);
  return [
    normalizeChannelHotcueValueForWindow(cloned[0], startMs, maxMs),
    normalizeChannelHotcueValueForWindow(cloned[1], startMs, maxMs),
    normalizeChannelHotcueValueForWindow(cloned[2], startMs, maxMs),
    normalizeChannelHotcueValueForWindow(cloned[3], startMs, maxMs),
  ];
};

export const serializeChannelHotcuesForSource = (
  value: unknown,
  startMs: number,
  endMs: number,
  sourceDurationMs: number
): HotcueTuple => {
  const maxMs = computeChannelHotcueMaxMs(startMs, endMs, sourceDurationMs);
  const normalized = normalizeChannelHotcuesForWindow(value, startMs, maxMs);
  const maxRel = Math.max(0, endMs - startMs);
  const maxSourceMs = Math.max(
    endMs,
    startMs + maxRel,
    Number.isFinite(sourceDurationMs) ? sourceDurationMs : 0
  );
  const toSourceTime = (cue: number | null): number | null => {
    if (cue === null) return null;
    const absolute = startMs + cue;
    if (maxSourceMs <= 0) return Math.max(0, absolute);
    return Math.max(0, Math.min(maxSourceMs, absolute));
  };
  return [
    toSourceTime(normalized[0]),
    toSourceTime(normalized[1]),
    toSourceTime(normalized[2]),
    toSourceTime(normalized[3]),
  ];
};

