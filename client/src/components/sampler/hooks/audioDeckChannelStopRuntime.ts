import {
  setDeckChannelPausedState,
  setDeckChannelStoppedState,
} from './audioDeckChannelStateRuntime';

export interface DeckChannelStopMutableState {
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
  stopCancel: (() => void) | null;
  volumeRampTimer: ReturnType<typeof setInterval> | null;
}

export const clearDeckChannelVolumeRampState = (channel: DeckChannelStopMutableState): void => {
  if (!channel.volumeRampTimer) return;
  clearInterval(channel.volumeRampTimer);
  channel.volumeRampTimer = null;
};

export const finalizeDeckChannelStoppedState = (
  channel: DeckChannelStopMutableState,
  options?: { clearStopCancel?: boolean }
): void => {
  clearDeckChannelVolumeRampState(channel);
  setDeckChannelStoppedState(channel);
  if (options?.clearStopCancel !== false) {
    channel.stopCancel = null;
  }
};

export const finalizeDeckChannelPausedState = (
  channel: DeckChannelStopMutableState,
  options?: { clearStopCancel?: boolean }
): void => {
  clearDeckChannelVolumeRampState(channel);
  setDeckChannelPausedState(channel);
  if (options?.clearStopCancel !== false) {
    channel.stopCancel = null;
  }
};

export const resolveDeckChannelBaselineCurrentTimeMs = (
  audioElement: HTMLAudioElement | null | undefined
): number | undefined => {
  if (!audioElement) return undefined;
  const currentSec = Number.isFinite(audioElement.currentTime) ? audioElement.currentTime : 0;
  return Math.max(0, currentSec * 1000);
};
