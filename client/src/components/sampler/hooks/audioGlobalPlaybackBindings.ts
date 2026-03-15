import * as React from 'react';
import type { DiagnosticResult } from './useGlobalPlaybackManager';
import type { AudioRuntimeInfo, GlobalPlaybackManager, PadWarmStatus } from './useGlobalPlaybackManager';

interface PlaybackDebugBindings {
  getDebugInfo(): unknown;
  getIOSDebugInfo(): unknown;
  runDiagnostics(): Promise<DiagnosticResult>;
  getPadLatencyStats(): unknown;
  resetPadLatencyStats(): void;
  setAndroidMuteGateLegacy(enabled: boolean): unknown;
  getAndroidMuteGateMode(): unknown;
  getAudioRuntimeInfo(): AudioRuntimeInfo;
}

interface PlaybackStateSubscription {
  addStateChangeListener(listener: () => void): void;
  removeStateChangeListener(listener: () => void): void;
}

export function registerGlobalPlaybackDebug(manager: PlaybackDebugBindings): void {
  if (typeof window === 'undefined') return;
  (window as any).debugPlaybackManager = () => manager.getDebugInfo();
  (window as any).debugIOSAudio = () => manager.getIOSDebugInfo();
  (window as any).runAudioDiagnostics = () => manager.runDiagnostics();
  (window as any).getPadLatencyStats = () => manager.getPadLatencyStats();
  (window as any).resetPadLatencyStats = () => manager.resetPadLatencyStats();
  (window as any).setAndroidMuteGateLegacy = (enabled: boolean) => manager.setAndroidMuteGateLegacy(enabled);
  (window as any).getAndroidMuteGateMode = () => manager.getAndroidMuteGateMode();
  (window as any).getAudioRuntimeInfo = () => manager.getAudioRuntimeInfo();
}

export function createGlobalPlaybackStateSubscriber(manager: PlaybackStateSubscription) {
  return (listener: () => void): (() => void) => {
    manager.addStateChangeListener(listener);
    return () => manager.removeStateChangeListener(listener);
  };
}

type PadPlaybackState = { isPlaying: boolean; progress: number; effectiveVolume: number; softMuted: boolean };

export function usePadPlaybackStateBinding(
  manager: Pick<GlobalPlaybackManager, 'getPadState'>,
  subscribeGlobalPlaybackState: (listener: () => void) => () => void,
  padId: string,
  fallbackVolume: number
): PadPlaybackState {
  const fallbackStateRef = React.useRef<PadPlaybackState>({
    isPlaying: false,
    progress: 0,
    effectiveVolume: fallbackVolume,
    softMuted: false,
  });

  const getSnapshot = React.useCallback((): PadPlaybackState => {
    const state = manager.getPadState(padId) || {
      isPlaying: false,
      progress: 0,
      effectiveVolume: fallbackVolume,
      softMuted: false,
    };

    const prev = fallbackStateRef.current;
    if (
      prev.isPlaying === state.isPlaying &&
      Math.abs(prev.progress - state.progress) < 0.001 &&
      Math.abs(prev.effectiveVolume - state.effectiveVolume) < 0.0001 &&
      prev.softMuted === state.softMuted
    ) {
      return prev;
    }

    fallbackStateRef.current = state;
    return state;
  }, [manager, padId, fallbackVolume]);

  return React.useSyncExternalStore(
    subscribeGlobalPlaybackState,
    getSnapshot,
    getSnapshot
  );
}

export function usePadWarmStatusBinding(
  manager: Pick<GlobalPlaybackManager, 'getPadWarmStatus'>,
  subscribeGlobalPlaybackState: (listener: () => void) => () => void,
  padId: string
): PadWarmStatus {
  const normalizeWarmStatusSnapshot = React.useCallback((status: PadWarmStatus): PadWarmStatus => {
    const normalizedRemainingMs = status.isQuarantined
      ? Math.max(1_000, Math.ceil(status.quarantineRemainingMs / 1_000) * 1_000)
      : 0;
    return normalizedRemainingMs === status.quarantineRemainingMs
      ? status
      : {
          ...status,
          quarantineRemainingMs: normalizedRemainingMs,
        };
  }, []);

  const fallbackStateRef = React.useRef<PadWarmStatus>(normalizeWarmStatusSnapshot(manager.getPadWarmStatus(padId)));

  const getSnapshot = React.useCallback((): PadWarmStatus => {
    const next = normalizeWarmStatusSnapshot(manager.getPadWarmStatus(padId));
    const prev = fallbackStateRef.current;
    if (
      prev.stage === next.stage &&
      prev.backend === next.backend &&
      prev.isReady === next.isReady &&
      prev.isWarming === next.isWarming &&
      prev.isPendingPlay === next.isPendingPlay &&
      prev.isQuarantined === next.isQuarantined &&
      prev.quarantineRemainingMs === next.quarantineRemainingMs
    ) {
      return prev;
    }
    fallbackStateRef.current = next;
    return next;
  }, [manager, normalizeWarmStatusSnapshot, padId]);

  return React.useSyncExternalStore(
    subscribeGlobalPlaybackState,
    getSnapshot,
    getSnapshot
  );
}
