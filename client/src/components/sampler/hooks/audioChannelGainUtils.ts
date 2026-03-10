interface DeckChannelTargetGainInput {
  padVolumeValue: number;
  padGainValue: number;
  channelVolumeValue: number;
  globalMuted: boolean;
  headroom: number;
  masterVolume: number;
  useSharedIOSMaster: boolean;
}

interface RampVolumeInput {
  startVolume: number;
  targetVolume: number;
  elapsedMs: number;
  durationMs: number;
}

interface DeckChannelPadLike {
  volume: number;
  padGainLinear: number;
}

interface DeckChannelLike {
  pad: DeckChannelPadLike | null;
  channelVolume: number;
  graphConnected: boolean;
}

interface DeckChannelTargetGainRuntimeInput {
  channel: DeckChannelLike;
  globalMuted: boolean;
  headroom: number;
  masterVolume: number;
  isIOS: boolean;
  hasSharedIOSGain: boolean;
}

const clamp01 = (value: number, fallback: number): number => {
  const numeric = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numeric));
};

export const normalizeDeckChannelGainTarget = (next: number): number =>
  Math.max(0, Number.isFinite(next) ? next : 0);

export const normalizeDeckElementVolume = (next: number): number =>
  clamp01(next, 0);

export const computeDeckChannelTargetGainValue = (input: DeckChannelTargetGainInput): number => {
  if (input.globalMuted) return 0;

  const padVolume = clamp01(input.padVolumeValue, 1);
  const padGainLinear = Math.max(0, Number.isFinite(input.padGainValue) ? input.padGainValue : 1);
  const channelVolume = clamp01(input.channelVolumeValue, 1);
  const headroom = Math.max(0, Number.isFinite(input.headroom) ? input.headroom : 1);
  const masterVolume = clamp01(input.masterVolume, 1);

  const multiplier = input.useSharedIOSMaster
    ? 1
    : masterVolume;

  return Math.max(0, padVolume * padGainLinear * channelVolume * headroom * multiplier);
};

export const computeDeckChannelTargetGainRuntime = (
  input: DeckChannelTargetGainRuntimeInput
): number => {
  const { channel } = input;
  if (!channel.pad) return 0;
  return computeDeckChannelTargetGainValue({
    padVolumeValue: channel.pad.volume,
    padGainValue: channel.pad.padGainLinear,
    channelVolumeValue: channel.channelVolume,
    globalMuted: input.globalMuted,
    headroom: input.headroom,
    masterVolume: input.masterVolume,
    useSharedIOSMaster: input.isIOS && channel.graphConnected && input.hasSharedIOSGain,
  });
};

export const computeLinearRampVolume = (input: RampVolumeInput): number => {
  const startVolume = clamp01(input.startVolume, 0);
  const targetVolume = clamp01(input.targetVolume, 0);
  const durationMs = Math.max(0, Math.floor(Number.isFinite(input.durationMs) ? input.durationMs : 0));
  if (durationMs <= 0) return targetVolume;
  const elapsedMs = Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0);
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return startVolume + ((targetVolume - startVolume) * t);
};

export const computeDeckChannelCurrentGainValue = (
  graphConnected: boolean,
  graphGainValue: number | null | undefined,
  elementVolume: number | null | undefined
): number => {
  if (graphConnected) {
    return Math.max(0, Number.isFinite(graphGainValue) ? Number(graphGainValue) : 0);
  }
  return Math.max(0, Number.isFinite(elementVolume) ? Number(elementVolume) : 0);
};
