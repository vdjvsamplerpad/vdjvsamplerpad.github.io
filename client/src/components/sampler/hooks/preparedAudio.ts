import type { PadData, SamplerBank } from '../types/sampler';

export type PreparedAudioStorageBackend = 'native' | 'idb' | 'opfs';
export type PreparedAudioKind = 'source_alias' | 'trimmed_lossless' | 'trimmed_mp3';
export type PreparedAudioStatus = 'none' | 'queued' | 'preparing' | 'ready' | 'stale' | 'error';
export type PreparedAudioClass = 'short_hot' | 'medium' | 'long_heavy';
export type BankPreparedStatus = 'none' | 'preparing' | 'ready' | 'stale';

export interface BankPreparedSummary {
  status: BankPreparedStatus;
  label: 'Not prepared' | 'Preparing' | 'Ready' | 'Stale';
  readyPads: number;
  activePads: number;
}

export const PREPARED_AUDIO_POLICY_VERSION = 1;
export const PREPARED_SHORT_HOT_MAX_DURATION_MS = 12_000;
export const PREPARED_SHORT_HOT_MAX_BYTES = 1_500_000;
export const PREPARED_LONG_HEAVY_MIN_DURATION_MS = 90_000;
export const PREPARED_LONG_HEAVY_MIN_BYTES = 12 * 1024 * 1024;
export const PREPARED_HEAVY_RESUME_IDLE_MS = 5_000;

const clampNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export const getPadTrimWindowMs = (pad: Pick<PadData, 'startTimeMs' | 'endTimeMs' | 'audioDurationMs'>): number | null => {
  const start = clampNumber(pad.startTimeMs) ?? 0;
  const end = clampNumber(pad.endTimeMs);
  if (end !== null && end > start) return end - start;
  const duration = clampNumber(pad.audioDurationMs);
  return duration !== null && duration > start ? duration - start : duration;
};

export const hasMeaningfulPreparedTrim = (pad: Pick<PadData, 'startTimeMs' | 'endTimeMs' | 'audioDurationMs'>): boolean => {
  const duration = clampNumber(pad.audioDurationMs);
  const trimmed = getPadTrimWindowMs(pad);
  if (duration === null || trimmed === null) return false;
  const savedMs = duration - trimmed;
  if (savedMs < 1_500) return false;
  return savedMs / Math.max(duration, 1) >= 0.15;
};

export const resolvePreparedAudioClassification = (
  pad: Pick<PadData, 'audioBytes' | 'audioDurationMs' | 'startTimeMs' | 'endTimeMs'>
): PreparedAudioClass => {
  const bytes = clampNumber(pad.audioBytes);
  const duration = clampNumber(pad.audioDurationMs);
  const trimmedWindow = getPadTrimWindowMs(pad);
  if (
    (duration !== null && duration > PREPARED_LONG_HEAVY_MIN_DURATION_MS) ||
    (bytes !== null && bytes > PREPARED_LONG_HEAVY_MIN_BYTES)
  ) {
    return 'long_heavy';
  }
  if (
    ((duration !== null && duration <= PREPARED_SHORT_HOT_MAX_DURATION_MS) ||
      (trimmedWindow !== null && trimmedWindow <= PREPARED_SHORT_HOT_MAX_DURATION_MS)) &&
    (bytes === null || bytes <= PREPARED_SHORT_HOT_MAX_BYTES)
  ) {
    return 'short_hot';
  }
  return 'medium';
};

export const buildPadPreparedSourceSignature = (pad: Pick<
  PadData,
  'audioStorageKey' | 'audioUrl' | 'startTimeMs' | 'endTimeMs' | 'audioBytes' | 'audioDurationMs'
>): string => {
  const sourceIdentity = typeof pad.audioStorageKey === 'string' && pad.audioStorageKey.trim().length > 0
    ? pad.audioStorageKey.trim()
    : typeof pad.audioUrl === 'string'
      ? pad.audioUrl.trim()
      : '';
  const payload = [
    `src=${sourceIdentity}`,
    `start=${clampNumber(pad.startTimeMs) ?? 0}`,
    `end=${clampNumber(pad.endTimeMs) ?? -1}`,
    `bytes=${clampNumber(pad.audioBytes) ?? -1}`,
    `duration=${clampNumber(pad.audioDurationMs) ?? -1}`,
    `policy=${PREPARED_AUDIO_POLICY_VERSION}`,
  ];
  return payload.join('|');
};

export const isPreparedAudioReady = (pad: Pick<
  PadData,
  'preparedStatus' | 'preparedAudioStorageKey' | 'preparedSourceSignature'
>): boolean =>
  pad.preparedStatus === 'ready' &&
  typeof pad.preparedAudioStorageKey === 'string' &&
  pad.preparedAudioStorageKey.trim().length > 0 &&
  typeof pad.preparedSourceSignature === 'string' &&
  pad.preparedSourceSignature.trim().length > 0;

export const isPreparedAudioCurrent = (pad: Pick<
  PadData,
  'preparedStatus' | 'preparedAudioStorageKey' | 'preparedSourceSignature' | 'audioStorageKey' | 'audioUrl' | 'startTimeMs' | 'endTimeMs' | 'audioBytes' | 'audioDurationMs'
>): boolean => {
  if (!isPreparedAudioReady(pad)) return false;
  return buildPadPreparedSourceSignature(pad) === pad.preparedSourceSignature;
};

export const shouldPreparePadAudio = (
  pad: Pick<PadData, 'audioUrl' | 'audioStorageKey' | 'audioBytes' | 'audioDurationMs' | 'startTimeMs' | 'endTimeMs'>,
  explicit: boolean
): boolean => {
  const hasSource = Boolean((pad.audioStorageKey && pad.audioStorageKey.trim()) || (pad.audioUrl && pad.audioUrl.trim()));
  if (!hasSource) return false;
  if (explicit) return true;
  if (hasMeaningfulPreparedTrim(pad)) return true;
  const classification = resolvePreparedAudioClassification(pad);
  return classification === 'long_heavy';
};

export const resolvePreparedAudioKind = (
  pad: Pick<PadData, 'startTimeMs' | 'endTimeMs' | 'audioDurationMs'>,
  _explicit: boolean
): PreparedAudioKind => {
  if (hasMeaningfulPreparedTrim(pad)) return 'trimmed_lossless';
  return 'source_alias';
};

export const isPreparedTrimmedPlaybackCurrent = (
  pad: Pick<
    PadData,
    | 'preparedAudioKind'
    | 'preparedStatus'
    | 'preparedAudioStorageKey'
    | 'preparedSourceSignature'
    | 'audioStorageKey'
    | 'audioUrl'
    | 'startTimeMs'
    | 'endTimeMs'
    | 'audioBytes'
    | 'audioDurationMs'
  >
): boolean =>
  isPreparedAudioCurrent(pad) &&
  (pad.preparedAudioKind === 'trimmed_lossless' || pad.preparedAudioKind === 'trimmed_mp3');

export const resolvePadPlaybackAudioUrl = (
  pad: Pick<
    PadData,
    'audioUrl' | 'preparedAudioUrl' | 'preparedStatus' | 'preparedAudioStorageKey' | 'preparedSourceSignature' | 'audioStorageKey' | 'startTimeMs' | 'endTimeMs' | 'audioBytes' | 'audioDurationMs'
  >
): string => {
  if (isPreparedAudioCurrent(pad) && typeof pad.preparedAudioUrl === 'string' && pad.preparedAudioUrl.trim().length > 0) {
    return pad.preparedAudioUrl.trim();
  }
  return typeof pad.audioUrl === 'string' ? pad.audioUrl.trim() : '';
};

export const resolvePadSourceAudioUrl = (
  pad: Pick<PadData, 'audioUrl'>
): string =>
  typeof pad.audioUrl === 'string' ? pad.audioUrl.trim() : '';

export const resolvePadPlaybackBytes = (
  pad: Pick<
    PadData,
    'audioBytes' | 'preparedBytes' | 'preparedStatus' | 'preparedAudioStorageKey' | 'preparedSourceSignature' | 'audioStorageKey' | 'audioUrl' | 'startTimeMs' | 'endTimeMs' | 'audioDurationMs'
  >
): number | undefined =>
  isPreparedAudioCurrent(pad) && clampNumber(pad.preparedBytes) !== null
    ? clampNumber(pad.preparedBytes) ?? undefined
    : clampNumber(pad.audioBytes) ?? undefined;

export const resolvePadPlaybackDurationMs = (
  pad: Pick<
    PadData,
    'audioDurationMs' | 'preparedDurationMs' | 'preparedStatus' | 'preparedAudioStorageKey' | 'preparedSourceSignature' | 'audioStorageKey' | 'audioUrl' | 'startTimeMs' | 'endTimeMs' | 'audioBytes'
  >
): number | undefined =>
  isPreparedAudioCurrent(pad) && clampNumber(pad.preparedDurationMs) !== null
    ? clampNumber(pad.preparedDurationMs) ?? undefined
    : clampNumber(pad.audioDurationMs) ?? undefined;

export const resolvePadSourceDurationMs = (
  pad: Pick<PadData, 'audioDurationMs' | 'endTimeMs' | 'startTimeMs'>
): number | undefined => {
  const sourceDuration = clampNumber(pad.audioDurationMs);
  if (sourceDuration !== null) return sourceDuration;
  const startMs = clampNumber(pad.startTimeMs) ?? 0;
  const endMs = clampNumber(pad.endTimeMs);
  if (endMs !== null && endMs > startMs) return endMs;
  return undefined;
};

export const resolvePadPlaybackWindow = (
  pad: Pick<
    PadData,
    | 'preparedAudioKind'
    | 'preparedDurationMs'
    | 'preparedStatus'
    | 'preparedAudioStorageKey'
    | 'preparedSourceSignature'
    | 'audioStorageKey'
    | 'audioUrl'
    | 'startTimeMs'
    | 'endTimeMs'
    | 'audioBytes'
    | 'audioDurationMs'
  >
): { startTimeMs: number; endTimeMs: number } => {
  if (isPreparedTrimmedPlaybackCurrent(pad)) {
    const preparedDurationMs = clampNumber(pad.preparedDurationMs) ?? 0;
    return {
      startTimeMs: 0,
      endTimeMs: preparedDurationMs,
    };
  }
  return {
    startTimeMs: clampNumber(pad.startTimeMs) ?? 0,
    endTimeMs: clampNumber(pad.endTimeMs) ?? 0,
  };
};

export const stripPreparedAudioTransientFields = <T extends PadData>(pad: T): T => ({
  ...pad,
  preparedAudioUrl: undefined,
}) as T;

export const getPreparedAudioPersistedStatus = (
  status?: PreparedAudioStatus
): PreparedAudioStatus | undefined => {
  if (status === 'queued' || status === 'preparing') return 'none';
  return status;
};

export const stripPreparedAudioPersistenceTransientFields = <T extends PadData>(pad: T): T => ({
  ...pad,
  preparedAudioUrl: undefined,
  preparedStatus: getPreparedAudioPersistedStatus(pad.preparedStatus),
}) as T;

export const stripPreparedAudioForExport = <T extends PadData>(pad: T): T => ({
  ...pad,
  preparedAudioUrl: undefined,
  preparedAudioStorageKey: undefined,
  preparedAudioBackend: undefined,
  preparedAudioKind: undefined,
  preparedSourceSignature: undefined,
  preparedStatus: undefined,
  preparedBytes: undefined,
  preparedAt: undefined,
  preparedDurationMs: undefined,
}) as T;

export const summarizeBankPreparedAudioState = (bank: SamplerBank): BankPreparedSummary => {
  const audioPads = bank.pads.filter((pad) => Boolean((pad.audioStorageKey && pad.audioStorageKey.trim()) || (pad.audioUrl && pad.audioUrl.trim())));
  const trackedPads = audioPads.filter((pad) => (
    shouldPreparePadAudio(pad, false) ||
    pad.preparedStatus === 'queued' ||
    pad.preparedStatus === 'preparing' ||
    pad.preparedStatus === 'ready' ||
    pad.preparedStatus === 'stale' ||
    pad.preparedStatus === 'error' ||
    Boolean(pad.preparedAudioStorageKey && pad.preparedAudioStorageKey.trim())
  ));
  const readyPads = trackedPads.filter((pad) => isPreparedAudioCurrent(pad)).length;
  const preparingPads = trackedPads.filter((pad) => pad.preparedStatus === 'queued' || pad.preparedStatus === 'preparing').length;
  const stalePads = trackedPads.filter((pad) => pad.preparedStatus === 'stale' || pad.preparedStatus === 'error').length;
  const activePads = trackedPads.length;

  if (preparingPads > 0) {
    return { status: 'preparing', label: 'Preparing', readyPads, activePads };
  }
  if (stalePads > 0) {
    return { status: 'stale', label: 'Stale', readyPads, activePads };
  }
  if (readyPads > 0) {
    return { status: 'ready', label: 'Ready', readyPads, activePads };
  }
  return { status: 'none', label: 'Not prepared', readyPads, activePads };
};
