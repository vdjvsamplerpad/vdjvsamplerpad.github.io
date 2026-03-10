import type { HotcueTuple } from './audioPadNormalization';
import { computeChannelHotcueMaxMs, normalizeChannelHotcuesForWindow } from './audioHotcueUtils';
import { resolveDeckEndMs, resolveDeckStartMs } from './audioChannelPlaybackLoop';
import { computeLoadedDeckChannelDurationMs } from './audioDeckChannelStateRuntime';

interface DeckLoadedPadRefLike {
  bankId: string;
  padId: string;
}

export interface DeckChannelLoadPadInput {
  bankId: string;
  padId: string;
  audioUrl: string;
  startTimeMs: number;
  endTimeMs: number;
  audioDurationMs?: number;
  savedHotcuesMs: HotcueTuple;
}

export interface DeckChannelLoadDerivedState {
  loadedPadRef: DeckLoadedPadRefLike;
  durationMs: number;
  hotcuesMs: HotcueTuple;
  waveformKey: string;
}

export const shouldReuseLoadedDeckChannelPad = (
  loadedPadRef: DeckLoadedPadRefLike | null | undefined,
  bankId: string,
  padId: string
): boolean => Boolean(
  loadedPadRef &&
  loadedPadRef.padId === padId &&
  loadedPadRef.bankId === bankId
);

export const deriveDeckChannelLoadState = (pad: DeckChannelLoadPadInput): DeckChannelLoadDerivedState => {
  const durationMs = computeLoadedDeckChannelDurationMs(pad);
  const startMs = resolveDeckStartMs(pad.startTimeMs);
  const endMs = resolveDeckEndMs({
    startTimeMs: pad.startTimeMs,
    endTimeMs: pad.endTimeMs,
    durationMs,
  });
  const sourceDurationMs = Number.isFinite(pad.audioDurationMs)
    ? Math.max(0, Number(pad.audioDurationMs))
    : 0;
  const maxMs = computeChannelHotcueMaxMs(startMs, endMs, sourceDurationMs);
  return {
    loadedPadRef: { bankId: pad.bankId, padId: pad.padId },
    durationMs,
    hotcuesMs: normalizeChannelHotcuesForWindow(pad.savedHotcuesMs, startMs, maxMs),
    waveformKey: `${pad.padId}:${pad.audioUrl}`,
  };
};
