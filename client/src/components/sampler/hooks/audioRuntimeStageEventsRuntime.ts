import type { AudioBackendType, AudioEngineCore } from '../../../lib/audio-engine';
import { computeStageInfoThrottle } from './audioRuntimeDiagnostics';
import type { AudioRuntimeStage } from './audioRuntimeStage';

interface RuntimeInfoSnapshot {
  activePadId: string | null;
  lastPadLoadLatencyMs: number | null;
  lastPadStartLatencyMs: number | null;
  lastPadStopLatencyMs: number | null;
  quarantinedPads: number;
  lastBlockedPadId: string | null;
  lastBlockedReason: string | null;
}

interface AudioRuntimeStageEventsRuntimeHost {
  getAudioRuntimeStage(): AudioRuntimeStage;
  getRuntimeInfo(): RuntimeInfoSnapshot;
  getEngineBackendForPad(padId: string): AudioBackendType | null;
  notifyStateChange(immediate?: boolean): void;
}

export class AudioRuntimeStageEventsRuntime {
  private readonly host: AudioRuntimeStageEventsRuntimeHost;
  private v3EngineStateBridgeListener: (() => void) | null = null;
  private lastStageInfoDispatchAtMs = 0;
  private lastStageInfoThrottleKey = '';
  private lastChannelAction: 'none' | 'play' | 'pause' | 'stop' | 'seek' | 'ended' = 'none';
  private lastChannelId: number | null = null;
  private lastChannelCommandToken = 0;
  private lastChannelActionAt: number | null = null;

  constructor(host: AudioRuntimeStageEventsRuntimeHost) {
    this.host = host;
  }

  ensureV3EngineStateBridge(engine: AudioEngineCore): void {
    if (this.v3EngineStateBridgeListener) return;
    this.v3EngineStateBridgeListener = () => {
      this.host.notifyStateChange(true);
    };
    engine.addStateListener(this.v3EngineStateBridgeListener);
  }

  emitAudioRuntimeStageInfo(action?: string): void {
    if (typeof window === 'undefined') return;
    const resolvedAction = action || 'state';
    if (this.shouldThrottleAudioRuntimeStageInfo(resolvedAction)) return;
    const runtimeInfo = this.host.getRuntimeInfo();
    const detail = {
      action: resolvedAction,
      stage: this.host.getAudioRuntimeStage(),
      activePadId: runtimeInfo.activePadId,
      activePadBackend: runtimeInfo.activePadId ? this.host.getEngineBackendForPad(runtimeInfo.activePadId) : null,
      lastPadLoadLatencyMs: runtimeInfo.lastPadLoadLatencyMs,
      lastPadStartLatencyMs: runtimeInfo.lastPadStartLatencyMs,
      lastPadStopLatencyMs: runtimeInfo.lastPadStopLatencyMs,
      quarantinedPads: runtimeInfo.quarantinedPads,
      lastBlockedPadId: runtimeInfo.lastBlockedPadId,
      lastBlockedReason: runtimeInfo.lastBlockedReason,
      lastChannelAction: this.lastChannelAction,
      lastChannelId: this.lastChannelId,
      lastChannelCommandToken: this.lastChannelCommandToken,
      lastChannelActionAt: this.lastChannelActionAt
    };
    window.dispatchEvent(new CustomEvent('vdjv-audio-stage-info', { detail }));
  }

  setChannelRuntimeDiag(
    action: 'none' | 'play' | 'pause' | 'stop' | 'seek' | 'ended',
    channelId: number | null,
    token: number
  ): void {
    this.lastChannelAction = action;
    this.lastChannelId = channelId;
    this.lastChannelCommandToken = token;
    this.lastChannelActionAt = Date.now();
    this.emitAudioRuntimeStageInfo('channel_diag');
  }

  emitV3PadPlayFailed(padId: string, reason: string, retryCount: number): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vdjv-audio-pad-play-failed', {
      detail: {
        padId,
        reason,
        retryCount,
        stage: this.host.getAudioRuntimeStage()
      }
    }));
  }

  getLastChannelDiag() {
    return {
      action: this.lastChannelAction,
      channelId: this.lastChannelId,
      token: this.lastChannelCommandToken,
      actionAt: this.lastChannelActionAt
    };
  }

  private shouldThrottleAudioRuntimeStageInfo(action: string): boolean {
    const nowMs = Date.now();
    const runtimeInfo = this.host.getRuntimeInfo();
    const throttleResult = computeStageInfoThrottle({
      action,
      isCapacitorNative: typeof window !== 'undefined' &&
        Boolean((window as any).Capacitor?.isNativePlatform?.()),
      stage: this.host.getAudioRuntimeStage(),
      activePadId: runtimeInfo.activePadId,
      lastBlockedReason: runtimeInfo.lastBlockedReason,
      quarantinedPads: runtimeInfo.quarantinedPads,
      channelAction: this.lastChannelAction,
      channelId: this.lastChannelId,
      nowMs,
      lastDispatchAtMs: this.lastStageInfoDispatchAtMs,
      lastThrottleKey: this.lastStageInfoThrottleKey,
    });
    this.lastStageInfoDispatchAtMs = throttleResult.nextDispatchAtMs;
    this.lastStageInfoThrottleKey = throttleResult.nextThrottleKey;
    return throttleResult.shouldThrottle;
  }
}
