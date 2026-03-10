interface DeckRangeInput {
  startTimeMs?: number | null;
  endTimeMs?: number | null;
  durationMs?: number | null;
}

interface IOSStartupPlayheadGuardInput {
  isIOS: boolean;
  nowMs: number;
  startupBackwardGuardUntilMs: number;
  playheadGuardBypassUntilMs: number;
  previousPlayheadMs: number;
  rawPlayheadMs: number;
  backwardGuardMaxMs: number;
}

interface StartupWindowChannelState {
  isPlaying: boolean;
  startupHighRateUntilMs: number;
}

interface DeckPlaybackSampleInput {
  isIOS: boolean;
  nowMs: number;
  startupBackwardGuardUntilMs: number;
  playheadGuardBypassUntilMs: number;
  previousPlayheadMs: number;
  backwardGuardMaxMs: number;
  currentTimeSec: number;
  startMs: number;
  endMs: number;
}

interface DeckStartupProfileInput {
  nowMs: number;
  highRateWindowMs: number;
  backwardGuardWindowMs: number;
}

interface PlatformRuntimeInput {
  isCapacitorNative: boolean;
  isIOS: boolean;
  isAndroid: boolean;
}

interface NativeTickIntervalInput {
  isIOS: boolean;
  isAndroid: boolean;
  iosMs: number;
  androidMs: number;
  defaultMs: number;
}

interface DeckPlaybackSampleResult {
  nowAbsMs: number;
  nextPlayheadMs: number;
  reachedEnd: boolean;
}

interface DeckStartupProfileState {
  startupHighRateUntilMs: number;
  startupBackwardGuardUntilMs: number;
  playheadGuardBypassUntilMs: number;
}

export const resolveDeckStartMs = (startTimeMs?: number | null): number => startTimeMs || 0;

export const resolveDeckEndMs = (input: DeckRangeInput): number => {
  const startMs = resolveDeckStartMs(input.startTimeMs);
  const endTimeMs = input.endTimeMs || 0;
  if (endTimeMs > startMs) return endTimeMs;
  const durationMs = input.durationMs || 0;
  return durationMs > startMs ? durationMs : startMs;
};

export const computeDeckRawPlayheadMs = (currentAbsMs: number, startMs: number, endMs: number): number => {
  const windowMs = Math.max(0, endMs - startMs);
  return Math.max(0, Math.min(windowMs, currentAbsMs - startMs));
};

export const applyIOSStartupBackwardGuardToPlayhead = (input: IOSStartupPlayheadGuardInput): number => {
  if (!input.isIOS) return input.rawPlayheadMs;
  if (input.startupBackwardGuardUntilMs <= input.nowMs) return input.rawPlayheadMs;
  if (input.playheadGuardBypassUntilMs > input.nowMs) return input.rawPlayheadMs;

  const backwardDeltaMs = input.previousPlayheadMs - input.rawPlayheadMs;
  if (backwardDeltaMs > input.backwardGuardMaxMs) {
    return input.previousPlayheadMs;
  }
  return input.rawPlayheadMs;
};

export const hasActiveIOSStartupWindowState = (
  channels: Iterable<StartupWindowChannelState>,
  nowMs: number
): boolean => {
  for (const channel of channels) {
    if (channel.isPlaying && channel.startupHighRateUntilMs > nowMs) {
      return true;
    }
  }
  return false;
};

export const computeDeckPlaybackSample = (input: DeckPlaybackSampleInput): DeckPlaybackSampleResult => {
  const nowAbsMs = Math.max(0, input.currentTimeSec * 1000);
  const rawPlayheadMs = computeDeckRawPlayheadMs(nowAbsMs, input.startMs, input.endMs);
  const nextPlayheadMs = applyIOSStartupBackwardGuardToPlayhead({
    isIOS: input.isIOS,
    nowMs: input.nowMs,
    startupBackwardGuardUntilMs: input.startupBackwardGuardUntilMs,
    playheadGuardBypassUntilMs: input.playheadGuardBypassUntilMs,
    previousPlayheadMs: input.previousPlayheadMs,
    rawPlayheadMs,
    backwardGuardMaxMs: input.backwardGuardMaxMs,
  });
  const reachedEnd = input.endMs > input.startMs && nowAbsMs >= input.endMs;
  return {
    nowAbsMs,
    nextPlayheadMs,
    reachedEnd,
  };
};

export const createDeckStartupProfileState = (input: DeckStartupProfileInput): DeckStartupProfileState => ({
  startupHighRateUntilMs: input.nowMs + input.highRateWindowMs,
  startupBackwardGuardUntilMs: input.nowMs + input.backwardGuardWindowMs,
  playheadGuardBypassUntilMs: 0,
});

export const clearDeckStartupProfileState = (): DeckStartupProfileState => ({
  startupHighRateUntilMs: 0,
  startupBackwardGuardUntilMs: 0,
  playheadGuardBypassUntilMs: 0,
});

export const resolveDeckNativeTickIntervalMs = (input: NativeTickIntervalInput): number => {
  if (input.isIOS) return input.iosMs;
  if (input.isAndroid) return input.androidMs;
  return input.defaultMs;
};

export const shouldUseImmediateDeckNotify = (input: PlatformRuntimeInput): boolean => (
  !input.isCapacitorNative && !input.isIOS && !input.isAndroid
);

export const shouldAutoStopDeckAtEnd = (playbackMode: unknown): boolean => playbackMode !== 'loop';
