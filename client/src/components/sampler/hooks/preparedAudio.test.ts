import { describe, expect, it } from 'vitest';

import {
  buildPadPreparedSourceSignature,
  resolvePadPlaybackAudioUrl,
  resolvePadPlaybackBytes,
  resolvePadPlaybackDurationMs,
  resolvePadPlaybackWindow,
} from './preparedAudio';

describe('preparedAudio playback resolution', () => {
  it('falls back to source playback settings when prepared audio is not rehydrated yet', () => {
    const basePad = {
      audioUrl: 'file:///source.wav',
      audioBytes: 1_500_000,
      audioDurationMs: 12_000,
      startTimeMs: 2_000,
      endTimeMs: 7_000,
    };
    const pad = {
      ...basePad,
      preparedAudioUrl: undefined,
      preparedStatus: 'ready' as const,
      preparedAudioStorageKey: 'prepared-pad.bin',
      preparedSourceSignature: buildPadPreparedSourceSignature(basePad),
      preparedAudioKind: 'trimmed_lossless' as const,
      preparedBytes: 640_000,
      preparedDurationMs: 5_000,
    };

    expect(resolvePadPlaybackAudioUrl(pad)).toBe('file:///source.wav');
    expect(resolvePadPlaybackBytes(pad)).toBe(1_500_000);
    expect(resolvePadPlaybackDurationMs(pad)).toBe(12_000);
    expect(resolvePadPlaybackWindow(pad)).toEqual({
      startTimeMs: 2_000,
      endTimeMs: 7_000,
    });
  });

  it('uses prepared playback settings only when the prepared asset url is available', () => {
    const basePad = {
      audioUrl: 'file:///source.wav',
      audioBytes: 1_500_000,
      audioDurationMs: 12_000,
      startTimeMs: 2_000,
      endTimeMs: 7_000,
    };
    const pad = {
      ...basePad,
      preparedAudioUrl: 'blob:prepared-audio',
      preparedStatus: 'ready' as const,
      preparedAudioStorageKey: 'prepared-pad.bin',
      preparedSourceSignature: buildPadPreparedSourceSignature(basePad),
      preparedAudioKind: 'trimmed_lossless' as const,
      preparedBytes: 640_000,
      preparedDurationMs: 5_000,
    };

    expect(resolvePadPlaybackAudioUrl(pad)).toBe('blob:prepared-audio');
    expect(resolvePadPlaybackBytes(pad)).toBe(640_000);
    expect(resolvePadPlaybackDurationMs(pad)).toBe(5_000);
    expect(resolvePadPlaybackWindow(pad)).toEqual({
      startTimeMs: 0,
      endTimeMs: 5_000,
    });
  });
});
