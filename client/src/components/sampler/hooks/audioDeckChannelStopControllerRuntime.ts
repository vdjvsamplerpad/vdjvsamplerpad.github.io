import type { StopTarget } from '../../../lib/audio-engine';

export type DeckChannelZeroFadePlan = 'ios' | 'graph' | 'element' | 'none';

interface ResolveDeckChannelZeroFadePlanInput {
  isIOS: boolean;
  hasAudioElement: boolean;
  hasGraphGainPath: boolean;
}

export const hasDeckChannelGraphGainPath = (
  audioContext: AudioContext | null,
  gainNode: GainNode | null,
  graphConnected: boolean
): boolean => Boolean(audioContext && gainNode && graphConnected);

export const resolveDeckChannelZeroFadePlan = (
  input: ResolveDeckChannelZeroFadePlanInput
): DeckChannelZeroFadePlan => {
  if (input.isIOS) return 'ios';
  if (input.hasGraphGainPath) return 'graph';
  if (input.hasAudioElement) return 'element';
  return 'none';
};

export const resolveDeckChannelStartAtSec = (startTimeMs: number | null | undefined): number =>
  Math.max(0, (startTimeMs || 0) / 1000);

interface BuildDeckChannelStopTargetRuntimeInput {
  audioElement: HTMLAudioElement;
  audioContext: AudioContext | null;
  gainNode: GainNode | null;
  graphConnected: boolean;
  getCurrentGain: () => number;
  setElementRamp: (targetGain: number, durationSec: number) => void;
  setImmediateGain: (targetGain: number) => void;
  onFinalize: () => void;
  isActive: () => boolean;
}

export const buildDeckChannelStopTargetRuntime = (
  input: BuildDeckChannelStopTargetRuntimeInput
): StopTarget => ({
  setGainRamp: (targetGain: number, durationSec: number) => {
    const hasGraphPath = hasDeckChannelGraphGainPath(
      input.audioContext,
      input.gainNode,
      input.graphConnected
    );
    if (durationSec > 0 && hasGraphPath && input.audioContext && input.gainNode) {
      const now = input.audioContext.currentTime;
      input.gainNode.gain.cancelScheduledValues(now);
      input.gainNode.gain.setValueAtTime(input.gainNode.gain.value, now);
      input.gainNode.gain.linearRampToValueAtTime(targetGain, now + durationSec);
      return;
    }

    if (durationSec > 0) {
      input.setElementRamp(targetGain, durationSec);
      return;
    }

    input.setImmediateGain(targetGain);
  },
  getGain: () => input.getCurrentGain(),
  setPlaybackRate: (rate: number) => {
    const safeRate = Math.max(0.05, Number.isFinite(rate) ? rate : 1);
    input.audioElement.playbackRate = safeRate;
  },
  getPlaybackRate: () => {
    const rate = Number.isFinite(input.audioElement.playbackRate)
      ? input.audioElement.playbackRate
      : 1;
    return rate > 0 ? rate : 1;
  },
  setFilterState: () => undefined,
  resetFilter: () => undefined,
  finalize: input.onFinalize,
  isActive: input.isActive,
});
