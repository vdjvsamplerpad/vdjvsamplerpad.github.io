import type { AudioRuntimeStage } from './audioRuntimeStage';

const AUDIO_STAGE_INFO_MIN_INTERVAL_NATIVE_MS = 220;
const AUDIO_STAGE_INFO_MIN_INTERVAL_WEB_MS = 120;
const AUDIO_STAGE_INFO_CHANNEL_DIAG_MIN_INTERVAL_NATIVE_MS = 160;
const AUDIO_STAGE_INFO_CHANNEL_DIAG_MIN_INTERVAL_WEB_MS = 90;

interface StageInfoThrottleInput {
  action: string;
  isCapacitorNative: boolean;
  stage: AudioRuntimeStage;
  activePadId: string | null;
  lastBlockedReason: string | null;
  quarantinedPads: number;
  channelAction: 'none' | 'play' | 'pause' | 'stop' | 'seek' | 'ended';
  channelId: number | null;
  nowMs: number;
  lastDispatchAtMs: number;
  lastThrottleKey: string;
}

interface StageInfoThrottleResult {
  shouldThrottle: boolean;
  nextDispatchAtMs: number;
  nextThrottleKey: string;
}

const getAudioStageInfoMinIntervalMs = (action: string, isCapacitorNative: boolean): number => {
  if (action === 'channel_diag') {
    return isCapacitorNative
      ? AUDIO_STAGE_INFO_CHANNEL_DIAG_MIN_INTERVAL_NATIVE_MS
      : AUDIO_STAGE_INFO_CHANNEL_DIAG_MIN_INTERVAL_WEB_MS;
  }
  return isCapacitorNative
    ? AUDIO_STAGE_INFO_MIN_INTERVAL_NATIVE_MS
    : AUDIO_STAGE_INFO_MIN_INTERVAL_WEB_MS;
};

const buildStageInfoThrottleKey = (input: StageInfoThrottleInput): string => {
  if (input.action === 'channel_diag') {
    return `${input.action}:${input.channelAction}:${input.channelId ?? 'none'}:${input.activePadId ?? 'none'}:${input.lastBlockedReason ?? 'none'}`;
  }
  return `${input.action}:${input.stage}:${input.activePadId ?? 'none'}:${input.lastBlockedReason ?? 'none'}:${input.quarantinedPads}`;
};

export const computeStageInfoThrottle = (input: StageInfoThrottleInput): StageInfoThrottleResult => {
  if (input.action !== 'state' && input.action !== 'channel_diag') {
    return {
      shouldThrottle: false,
      nextDispatchAtMs: input.nowMs,
      nextThrottleKey: '',
    };
  }

  const minIntervalMs = getAudioStageInfoMinIntervalMs(input.action, input.isCapacitorNative);
  const key = buildStageInfoThrottleKey(input);
  const elapsedMs = input.nowMs - input.lastDispatchAtMs;
  const shouldThrottle = input.lastThrottleKey === key && elapsedMs < minIntervalMs;

  if (shouldThrottle) {
    return {
      shouldThrottle: true,
      nextDispatchAtMs: input.lastDispatchAtMs,
      nextThrottleKey: input.lastThrottleKey,
    };
  }

  return {
    shouldThrottle: false,
    nextDispatchAtMs: input.nowMs,
    nextThrottleKey: key,
  };
};

