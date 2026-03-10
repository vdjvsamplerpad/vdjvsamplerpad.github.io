import * as React from 'react';
import { cloneHotcuesTupleValue, normalizeKeyLockForRuntime, normalizeTempoPercentForRuntime } from './audioPadNormalization';
import type { GlobalPlaybackManager } from './useGlobalPlaybackManager';
import type { PadData } from '../types/sampler';

export interface AudioPlayerRuntimeSettings {
  tempoPercent: number;
  keyLock: boolean;
}

interface UseAudioPlayerRuntimeSyncOptions {
  pad: PadData;
  bankId: string;
  bankName: string;
  playbackManager: GlobalPlaybackManager;
  runtimeSettings: AudioPlayerRuntimeSettings;
}

interface UseAudioPlayerRuntimeSyncResult {
  registeredRef: React.MutableRefObject<boolean>;
  flushPendingRuntimeState: () => void;
}

export const resolveAudioPlayerRuntimeSettings = (
  pad: Pick<PadData, 'tempoPercent' | 'keyLock'>,
  isIOS: boolean
): AudioPlayerRuntimeSettings => ({
  tempoPercent: normalizeTempoPercentForRuntime(isIOS, pad.tempoPercent),
  keyLock: normalizeKeyLockForRuntime(isIOS, pad.keyLock),
});

export const buildAudioPlayerPadSettings = (
  pad: PadData,
  runtimeSettings: AudioPlayerRuntimeSettings
) => ({
  triggerMode: pad.triggerMode,
  playbackMode: pad.playbackMode,
  startTimeMs: pad.startTimeMs,
  endTimeMs: pad.endTimeMs,
  fadeInMs: pad.fadeInMs,
  fadeOutMs: pad.fadeOutMs,
  pitch: pad.pitch,
  tempoPercent: runtimeSettings.tempoPercent,
  keyLock: runtimeSettings.keyLock,
  volume: pad.volume,
  gainDb: pad.gainDb,
  gain: pad.gain,
  savedHotcuesMs: cloneHotcuesTupleValue(pad.savedHotcuesMs),
});

export const buildAudioPlayerPadMetadata = (
  pad: Pick<PadData, 'name' | 'color'>,
  bankId: string,
  bankName: string
) => ({
  name: pad.name,
  color: pad.color,
  bankId,
  bankName,
});

export const buildAudioPlayerNextPlaySettings = (
  updatedPad: PadData,
  isIOS: boolean
) => ({
  name: updatedPad.name,
  color: updatedPad.color,
  imageUrl: updatedPad.imageUrl,
  imageData: updatedPad.imageData,
  startTimeMs: updatedPad.startTimeMs,
  endTimeMs: updatedPad.endTimeMs,
  fadeInMs: updatedPad.fadeInMs,
  fadeOutMs: updatedPad.fadeOutMs,
  pitch: updatedPad.pitch,
  tempoPercent: normalizeTempoPercentForRuntime(isIOS, updatedPad.tempoPercent),
  keyLock: normalizeKeyLockForRuntime(isIOS, updatedPad.keyLock),
  volume: updatedPad.volume,
  gainDb: updatedPad.gainDb,
  gain: updatedPad.gain,
  triggerMode: updatedPad.triggerMode,
  playbackMode: updatedPad.playbackMode,
  savedHotcuesMs: cloneHotcuesTupleValue(updatedPad.savedHotcuesMs),
});

export function useAudioPlayerRuntimeSync({
  pad,
  bankId,
  bankName,
  playbackManager,
  runtimeSettings,
}: UseAudioPlayerRuntimeSyncOptions): UseAudioPlayerRuntimeSyncResult {
  const registeredRef = React.useRef(false);
  const pendingSettingsRef = React.useRef<Record<string, unknown> | null>(null);
  const pendingMetadataRef = React.useRef<{ name: string; color: string; bankId: string; bankName: string } | null>(null);

  const flushPendingRuntimeState = React.useCallback(() => {
    const pendingSettings = pendingSettingsRef.current;
    if (pendingSettings) {
      playbackManager.updatePadSettings(pad.id, pendingSettings);
      pendingSettingsRef.current = null;
    }

    const pendingMetadata = pendingMetadataRef.current;
    if (pendingMetadata) {
      playbackManager.updatePadMetadata(pad.id, pendingMetadata);
      pendingMetadataRef.current = null;
    }
  }, [pad.id, playbackManager]);

  React.useEffect(() => {
    if (!pad.audioUrl) return;
    let cancelled = false;
    registeredRef.current = false;

    const registerPad = async () => {
      try {
        await playbackManager.registerPad(pad.id, pad, bankId, bankName);
        if (cancelled) return;
        registeredRef.current = true;
        flushPendingRuntimeState();
      } catch {
      }
    };

    registerPad();

    return () => {
      cancelled = true;
    };
  }, [flushPendingRuntimeState, pad.audioUrl, pad.id, playbackManager]);

  React.useEffect(() => {
    const nextSettings = buildAudioPlayerPadSettings(pad, runtimeSettings);
    if (registeredRef.current) {
      playbackManager.updatePadSettings(pad.id, nextSettings);
      pendingSettingsRef.current = null;
      return;
    }
    pendingSettingsRef.current = nextSettings;
  }, [
    playbackManager,
    pad.id,
    pad.triggerMode,
    pad.playbackMode,
    pad.startTimeMs,
    pad.endTimeMs,
    pad.fadeInMs,
    pad.fadeOutMs,
    pad.pitch,
    runtimeSettings.tempoPercent,
    runtimeSettings.keyLock,
    pad.volume,
    pad.gainDb,
    pad.gain,
    pad.savedHotcuesMs,
  ]);

  React.useEffect(() => {
    const nextMetadata = buildAudioPlayerPadMetadata(pad, bankId, bankName);
    if (registeredRef.current) {
      playbackManager.updatePadMetadata(pad.id, nextMetadata);
      pendingMetadataRef.current = null;
      return;
    }
    pendingMetadataRef.current = nextMetadata;
  }, [playbackManager, pad.id, pad.name, pad.color, bankId, bankName]);

  return {
    registeredRef,
    flushPendingRuntimeState,
  };
}
