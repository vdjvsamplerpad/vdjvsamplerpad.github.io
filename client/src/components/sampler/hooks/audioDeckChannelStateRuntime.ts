import type { HotcueTuple } from './audioPadNormalization';

interface DeckLoadedPadRefLike {
  bankId: string;
  padId: string;
}

interface DeckPadSnapshotLike {
  startTimeMs: number;
  endTimeMs: number;
  audioDurationMs?: number;
}

interface DeckChannelPlaybackMutableState {
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
}

interface DeckChannelLoadMutableState extends DeckChannelPlaybackMutableState {
  loadedPadRef: DeckLoadedPadRefLike | null;
  pad: DeckPadSnapshotLike | null;
  durationMs: number;
  hotcuesMs: HotcueTuple;
  hasLocalHotcueOverride: boolean;
}

interface ApplyLoadedDeckChannelStateInput {
  loadedPadRef: DeckLoadedPadRefLike;
  pad: DeckPadSnapshotLike;
  durationMs: number;
  hotcuesMs: HotcueTuple;
}

export const computeLoadedDeckChannelDurationMs = (pad: DeckPadSnapshotLike): number => {
  const sourceDurationMs = Number.isFinite(pad.audioDurationMs)
    ? Math.max(0, Number(pad.audioDurationMs))
    : 0;
  return Math.max(pad.startTimeMs || 0, pad.endTimeMs || 0, sourceDurationMs);
};

export const setDeckChannelStoppedState = (channel: DeckChannelPlaybackMutableState): void => {
  channel.isPlaying = false;
  channel.isPaused = false;
  channel.playheadMs = 0;
};

export const setDeckChannelPausedState = (channel: DeckChannelPlaybackMutableState): void => {
  channel.isPlaying = false;
  channel.isPaused = true;
};

export const applyLoadedDeckChannelState = (
  channel: DeckChannelLoadMutableState,
  input: ApplyLoadedDeckChannelStateInput
): void => {
  channel.loadedPadRef = { ...input.loadedPadRef };
  channel.pad = input.pad;
  setDeckChannelStoppedState(channel);
  channel.durationMs = input.durationMs;
  channel.hotcuesMs = [...input.hotcuesMs] as HotcueTuple;
  channel.hasLocalHotcueOverride = false;
};

export const resetUnloadedDeckChannelState = (channel: DeckChannelLoadMutableState): void => {
  channel.loadedPadRef = null;
  channel.pad = null;
  setDeckChannelStoppedState(channel);
  channel.durationMs = 0;
  channel.hotcuesMs = [null, null, null, null];
  channel.hasLocalHotcueOverride = false;
};
