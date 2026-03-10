import {
  computeDeckChannelCurrentGainValue,
  computeLinearRampVolume,
  normalizeDeckChannelGainTarget,
  normalizeDeckElementVolume,
} from './audioChannelGainUtils';

export interface DeckChannelGainRuntimeState {
  audioElement: HTMLAudioElement | null;
  gainNode: GainNode | null;
  graphConnected: boolean;
  volumeRampTimer: ReturnType<typeof setInterval> | null;
}

export const clearDeckChannelVolumeRampTimer = (channel: DeckChannelGainRuntimeState): void => {
  if (!channel.volumeRampTimer) return;
  clearInterval(channel.volumeRampTimer);
  channel.volumeRampTimer = null;
};

interface HardMuteDeckChannelOutputInput {
  channel: DeckChannelGainRuntimeState;
  audioContext: AudioContext | null;
}

export const hardMuteDeckChannelOutputRuntime = (input: HardMuteDeckChannelOutputInput): void => {
  const { channel, audioContext } = input;
  clearDeckChannelVolumeRampTimer(channel);
  if (channel.gainNode && channel.graphConnected && audioContext) {
    const now = audioContext.currentTime;
    channel.gainNode.gain.cancelScheduledValues(now);
    channel.gainNode.gain.setValueAtTime(0, now);
  }
  if (channel.audioElement) {
    channel.audioElement.volume = 0;
  }
};

interface SetDeckChannelGainInput {
  channel: DeckChannelGainRuntimeState;
  audioContext: AudioContext | null;
  targetGain: number;
  immediate?: boolean;
  volumeSmoothingSec: number;
}

export const setDeckChannelGainRuntime = (input: SetDeckChannelGainInput): void => {
  const { channel, audioContext } = input;
  const target = normalizeDeckChannelGainTarget(input.targetGain);
  clearDeckChannelVolumeRampTimer(channel);
  if (channel.gainNode && channel.graphConnected && audioContext) {
    const now = audioContext.currentTime;
    channel.gainNode.gain.cancelScheduledValues(now);
    if (input.immediate) {
      channel.gainNode.gain.setValueAtTime(target, now);
    } else {
      channel.gainNode.gain.setTargetAtTime(target, now, input.volumeSmoothingSec);
    }
    if (channel.audioElement) channel.audioElement.volume = 1.0;
    return;
  }
  if (channel.audioElement) {
    channel.audioElement.volume = normalizeDeckElementVolume(target);
  }
};

interface RampDeckChannelElementVolumeInput {
  channel: DeckChannelGainRuntimeState;
  targetGain: number;
  durationSec: number;
  getNowMs: () => number;
  onComplete?: () => void;
}

export const rampDeckChannelElementVolumeRuntime = (input: RampDeckChannelElementVolumeInput): void => {
  const { channel } = input;
  const audio = channel.audioElement;
  if (!audio) {
    if (input.onComplete) input.onComplete();
    return;
  }
  const safeTarget = normalizeDeckElementVolume(input.targetGain);
  const durationMs = Math.max(0, Math.floor(input.durationSec * 1000));
  if (durationMs <= 0) {
    audio.volume = safeTarget;
    if (input.onComplete) input.onComplete();
    return;
  }
  clearDeckChannelVolumeRampTimer(channel);
  const startVolume = normalizeDeckElementVolume(audio.volume);
  const startAt = input.getNowMs();
  const tickMs = 16;
  channel.volumeRampTimer = setInterval(() => {
    if (!channel.audioElement) {
      clearDeckChannelVolumeRampTimer(channel);
      return;
    }
    const elapsed = input.getNowMs() - startAt;
    channel.audioElement.volume = computeLinearRampVolume({
      startVolume,
      targetVolume: safeTarget,
      elapsedMs: elapsed,
      durationMs,
    });
    if (elapsed >= durationMs) {
      clearDeckChannelVolumeRampTimer(channel);
      channel.audioElement.volume = safeTarget;
      if (input.onComplete) input.onComplete();
    }
  }, tickMs);
};

export const getDeckChannelCurrentGainRuntime = (channel: DeckChannelGainRuntimeState): number => (
  computeDeckChannelCurrentGainValue(
    Boolean(channel.gainNode && channel.graphConnected),
    channel.gainNode?.gain.value,
    channel.audioElement?.volume
  )
);
