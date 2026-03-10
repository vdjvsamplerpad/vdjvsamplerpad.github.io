export type ChannelSeekMode = 'default' | 'ios_hotcue';

interface HotcueCooldownCheckInput {
  channelId: number;
  slotIndex: number;
  nowMs: number;
  cooldownMs: number;
  lastTriggeredAtMs: number;
}

interface HotcueCooldownCheckResult {
  hotcueKey: string;
  elapsedMs: number;
  blocked: boolean;
}

interface ChannelSeekProfileInput {
  seekMode: ChannelSeekMode;
  defaultFadeSec: number;
  defaultDelayMs: number;
  iosHotcueFadeSec: number;
  iosHotcueDelayMs: number;
}

interface ChannelSeekProfileResult {
  seekFadeSec: number;
  seekDelayMs: number;
}

export const isValidHotcueSlot = (slotIndex: number): boolean => slotIndex >= 0 && slotIndex <= 3;

export const buildHotcueKey = (channelId: number, slotIndex: number): string => `${channelId}:${slotIndex}`;

export const checkHotcueCooldown = (input: HotcueCooldownCheckInput): HotcueCooldownCheckResult => {
  const hotcueKey = buildHotcueKey(input.channelId, input.slotIndex);
  const elapsedMs = input.nowMs - input.lastTriggeredAtMs;
  return {
    hotcueKey,
    elapsedMs,
    blocked: elapsedMs < input.cooldownMs,
  };
};

export const resolveChannelHotcueSeekMode = (isIOS: boolean, isPlaying: boolean): ChannelSeekMode => (
  isIOS && isPlaying ? 'ios_hotcue' : 'default'
);

export const resolveChannelSeekMode = (mode?: string): ChannelSeekMode => (
  mode === 'ios_hotcue' ? 'ios_hotcue' : 'default'
);

export const resolveChannelSeekProfile = (input: ChannelSeekProfileInput): ChannelSeekProfileResult => (
  input.seekMode === 'ios_hotcue'
    ? {
      seekFadeSec: input.iosHotcueFadeSec,
      seekDelayMs: input.iosHotcueDelayMs,
    }
    : {
      seekFadeSec: input.defaultFadeSec,
      seekDelayMs: input.defaultDelayMs,
    }
);

export const clampChannelRelativeMs = (ms: number, startMs: number, endMs: number): number => {
  const windowMs = endMs > startMs ? endMs - startMs : 0;
  return Math.max(0, Math.min(windowMs, ms));
};

export const clampDeckChannelCount = (count: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(count)));

export const shouldUseIOSHotcueScheduler = (isIOS: boolean): boolean => isIOS;
