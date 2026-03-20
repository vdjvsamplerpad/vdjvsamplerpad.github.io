import * as React from 'react';
import { PadData, StopMode } from '../types/sampler';
import { useGlobalPlaybackManagerApi, usePadPlaybackState, usePadWarmStatus } from './useGlobalPlaybackManager';
import { getAudioTelemetry } from '@/lib/audio-telemetry';
import {
  buildAudioPlayerNextPlaySettings,
  buildAudioPlayerRuntimePad,
  resolveAudioPlayerRuntimeSettings,
  useAudioPlayerRuntimeSync,
} from './useAudioPlayerRuntimeSync';

interface AudioPlayerState {
  isPlaying: boolean;
  progress: number;
  effectiveVolume: number;
  isSoftMuted: boolean;
  isWarmReady: boolean;
  isWarming: boolean;
  isPendingPlay: boolean;
  isQuarantined: boolean;
  quarantineRemainingMs: number;
  playAudio: () => void;
  forceWarmAudio: () => void;
  stopAudio: () => void;
  fadeOutStop: () => void;
  brakeStop: () => void;
  backspinStop: () => void;
  filterStop: () => void;
  releaseAudio: () => void;
  queueNextPlaySettings: (updatedPad: PadData) => void;
  syncLiveMetadata: (updatedPad: PadData) => void;
}

export function useAudioPlayer(
  pad: PadData,
  bankId: string,
  bankName: string,
  _globalMuted: boolean = false,
  _masterVolume: number = 1,
  currentStopMode: StopMode = 'instant'
): AudioPlayerState {
  const playbackManager = useGlobalPlaybackManagerApi();
  const telemetry = React.useMemo(
    () => getAudioTelemetry((import.meta as any).env?.VITE_APP_VERSION || 'unknown'),
    []
  );
  const [isHolding, setIsHolding] = React.useState(false);
  const isHoldingRef = React.useRef(false);
  const audioStateCheckTimeoutRef = React.useRef<number | null>(null);
  const playRequestTokenRef = React.useRef(0);
  const holdIntentRef = React.useRef(false);
  const holdSessionTokenRef = React.useRef(0);
  const prevIsPlayingRef = React.useRef(false);
  const isIOS = React.useMemo(
    () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent),
    []
  );
  const runtimeSettings = React.useMemo(
    () => resolveAudioPlayerRuntimeSettings(pad, isIOS),
    [isIOS, pad]
  );
  const runtimePad = React.useMemo(() => buildAudioPlayerRuntimePad(pad), [pad]);
  const { registeredRef, flushPendingRuntimeState } = useAudioPlayerRuntimeSync({
    pad,
    bankId,
    bankName,
    playbackManager,
    runtimeSettings,
  });

  // Subscribe to playback state for this pad.
  const padState = usePadPlaybackState(pad.id, pad.volume);
  const warmStatus = usePadWarmStatus(pad.id);
  const isPlaying = padState?.isPlaying || false;
  const progress = padState?.progress || 0;
  const effectiveVolume = padState?.effectiveVolume ?? pad.volume;
  const isSoftMuted = padState?.softMuted ?? false;
  const isWarmReady = warmStatus.isReady;
  const isWarming = warmStatus.isWarming;
  const isPendingPlay = warmStatus.isPendingPlay;
  const isQuarantined = warmStatus.isQuarantined;
  const quarantineRemainingMs = warmStatus.quarantineRemainingMs;

  React.useEffect(() => {
    if (!prevIsPlayingRef.current && isPlaying) {
      telemetry.log('pad_play_started', {
        padId: pad.id,
        bankId,
        triggerMode: pad.triggerMode,
        playbackMode: pad.playbackMode
      });
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('vdjv-prepared-playback-pad-started', {
            detail: {
              bankId,
              padId: pad.id,
            },
          }));
        } catch {
        }
      }
    }
    prevIsPlayingRef.current = isPlaying;
  }, [bankId, isPlaying, pad.id, pad.playbackMode, pad.triggerMode, telemetry]);

  React.useEffect(() => {
    if (pad.triggerMode === 'hold' && isHolding && !isPlaying) {
      holdIntentRef.current = false;
      holdSessionTokenRef.current += 1;
      isHoldingRef.current = false;
      setIsHolding(false);
    }
  }, [pad.triggerMode, isHolding, isPlaying]);

  const resetHoldState = React.useCallback(() => {
    holdIntentRef.current = false;
    isHoldingRef.current = false;
    setIsHolding(false);
  }, []);

  const invalidatePendingPlayback = React.useCallback(() => {
    playRequestTokenRef.current += 1;
    holdSessionTokenRef.current += 1;
  }, []);

  const canResolvePlayRequest = React.useCallback((requestToken: number, holdSessionToken: number | null) => {
    if (requestToken !== playRequestTokenRef.current) return false;
    if (pad.triggerMode !== 'hold') return true;
    return holdIntentRef.current && holdSessionToken !== null && holdSessionToken === holdSessionTokenRef.current;
  }, [pad.triggerMode]);

  const scheduleAudioStateCheck = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (audioStateCheckTimeoutRef.current !== null) {
      window.clearTimeout(audioStateCheckTimeoutRef.current);
    }
    audioStateCheckTimeoutRef.current = window.setTimeout(() => {
      try {
        const state = playbackManager.getAudioState();
        if (state.contextState !== 'running') {
          window.dispatchEvent(new CustomEvent('vdjv-audio-unlock-required', {
            detail: { contextState: state.contextState, padId: pad.id }
          }));
        } else {
          window.dispatchEvent(new Event('vdjv-audio-unlock-restored'));
        }
      } catch {
      }
    }, 250);
  }, [playbackManager, pad.id]);

  React.useEffect(() => {
    return () => {
      if (audioStateCheckTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(audioStateCheckTimeoutRef.current);
      }
    };
  }, []);

  const triggerPlayback = React.useCallback(() => {
    switch (pad.triggerMode) {
      case 'toggle':
        playbackManager.triggerToggle(pad.id, { groupStopMode: currentStopMode });
        break;
      case 'stutter':
        playbackManager.triggerStutter(pad.id, { groupStopMode: currentStopMode });
        break;
      case 'hold':
        if (!holdIntentRef.current) {
          break;
        }
        if (!isHoldingRef.current) {
          isHoldingRef.current = true;
          setIsHolding(true);
        }
        // Always trigger hold-start so rapid tap sequences are not blocked by async React state timing.
        playbackManager.triggerHoldStart(pad.id, { groupStopMode: currentStopMode });
        break;
      case 'unmute':
        playbackManager.triggerUnmuteToggle(pad.id, { groupStopMode: currentStopMode });
        break;
    }
    scheduleAudioStateCheck();
  }, [currentStopMode, pad.id, pad.triggerMode, playbackManager, scheduleAudioStateCheck]);

  const playAudio = React.useCallback(() => {
    const requestToken = ++playRequestTokenRef.current;
    const holdSessionToken = pad.triggerMode === 'hold'
      ? (() => {
          holdIntentRef.current = true;
          holdSessionTokenRef.current += 1;
          return holdSessionTokenRef.current;
        })()
      : null;
    telemetry.log('pad_play_request', {
      padId: pad.id,
      bankId,
      triggerMode: pad.triggerMode,
      playbackMode: pad.playbackMode,
      hasAudioUrl: Boolean(runtimePad.audioUrl),
      alreadyRegistered: registeredRef.current,
      requestToken
    });

    if (!runtimePad.audioUrl) {
      if (pad.triggerMode === 'hold') {
        invalidatePendingPlayback();
        resetHoldState();
      }
      telemetry.log('pad_play_blocked_media_unready', {
        padId: pad.id,
        bankId,
        requestToken
      }, 'warn');
      return;
    }

    if (!registeredRef.current) {
      void playbackManager
        .registerPad(runtimePad.id, runtimePad, bankId, bankName)
        .then(() => {
          if (!canResolvePlayRequest(requestToken, holdSessionToken)) return;
          registeredRef.current = true;
          flushPendingRuntimeState();
          telemetry.log('pad_register_ready', {
            padId: pad.id,
            bankId,
            requestToken
          });
          triggerPlayback();
        })
        .catch(() => {
          telemetry.log('pad_register_failed', {
            padId: pad.id,
            bankId,
            requestToken
          }, 'error', true);
        });
      return;
    }

    if (!canResolvePlayRequest(requestToken, holdSessionToken)) return;
    triggerPlayback();
  }, [
    bankId,
    bankName,
    canResolvePlayRequest,
    flushPendingRuntimeState,
    invalidatePendingPlayback,
    pad,
    pad.id,
    pad.playbackMode,
    pad.triggerMode,
    playbackManager,
    resetHoldState,
    runtimePad,
    telemetry,
    triggerPlayback,
  ]);

  const forceWarmAudio = React.useCallback(() => {
    if (!runtimePad.audioUrl) return;
    void playbackManager.forceWarmPad(runtimePad.id, runtimePad, bankId, bankName)
      .then((warmed) => {
        telemetry.log('pad_force_warm_result', {
          padId: pad.id,
          bankId,
          warmed
        }, warmed ? 'info' : 'warn');
      })
      .catch(() => {
        telemetry.log('pad_force_warm_result', {
          padId: pad.id,
          bankId,
          warmed: false,
          reason: 'force_warm_exception'
        }, 'error', true);
      });
  }, [bankId, bankName, pad.id, playbackManager, runtimePad, telemetry]);

  const stopPadWithMode = React.useCallback((mode: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') => {
    if (mode !== 'instant' && !registeredRef.current) return;
    if (mode === 'instant') {
      invalidatePendingPlayback();
    }
    resetHoldState();
    playbackManager.stopPad(pad.id, mode);
  }, [invalidatePendingPlayback, pad.id, playbackManager, registeredRef, resetHoldState]);

  const stopAudio = React.useCallback(() => {
    stopPadWithMode('instant');
  }, [stopPadWithMode]);

  const fadeOutStop = React.useCallback(() => {
    stopPadWithMode('fadeout');
  }, [stopPadWithMode]);

  const brakeStop = React.useCallback(() => {
    stopPadWithMode('brake');
  }, [stopPadWithMode]);

  const backspinStop = React.useCallback(() => {
    stopPadWithMode('backspin');
  }, [stopPadWithMode]);

  const filterStop = React.useCallback(() => {
    stopPadWithMode('filter');
  }, [stopPadWithMode]);

  const releaseAudio = React.useCallback(() => {
    if (pad.triggerMode === 'hold') {
      invalidatePendingPlayback();
      resetHoldState();
      playbackManager.triggerHoldStop(pad.id);
    }
  }, [invalidatePendingPlayback, pad.id, pad.triggerMode, playbackManager, resetHoldState]);

  const queueNextPlaySettings = React.useCallback((updatedPad: PadData) => {
    playbackManager.updatePadSettingsNextPlay(
      updatedPad.id,
      buildAudioPlayerNextPlaySettings(updatedPad, isIOS)
    );
  }, [isIOS, playbackManager]);

  const syncLiveMetadata = React.useCallback((updatedPad: PadData) => {
    playbackManager.updatePadMetadata(updatedPad.id, {
      name: updatedPad.name,
      artist: updatedPad.artist,
      color: updatedPad.color,
      bankId,
      bankName,
    });
  }, [bankId, bankName, playbackManager]);
  
   return {
    isPlaying,
    progress,
    effectiveVolume,
    isSoftMuted,
    isWarmReady,
    isWarming,
    isPendingPlay,
    isQuarantined,
    quarantineRemainingMs,
    playAudio,
    forceWarmAudio,
    stopAudio,
    queueNextPlaySettings,
    syncLiveMetadata,
    fadeOutStop,
    brakeStop,
    backspinStop,
    filterStop,
    releaseAudio,
  };
}
