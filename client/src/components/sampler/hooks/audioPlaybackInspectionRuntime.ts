import type { AudioBackendType, EngineHealth } from '../../../lib/audio-engine';
import { normalizePadVolumeValue } from './audioPadNormalization';
import type { AudioRuntimeStage } from './audioRuntimeStage';
import type { DeckPadSnapshot } from './audioDeckRuntime';
import type {
  AudioInstance,
  AudioRuntimeInfo,
  AudioSystemState,
  DiagnosticResult,
  PadWarmStatus,
  PadLatencyStats,
} from './useGlobalPlaybackManager';

interface RuntimeInfoSnapshot {
  activePadId: string | null;
  lastPadLoadLatencyMs: number | null;
  lastPadStartLatencyMs: number | null;
  lastPadStopLatencyMs: number | null;
  quarantinedPads: number;
  lastBlockedPadId: string | null;
  lastBlockedReason: string | null;
}

interface WarmStateSnapshot {
  backend: AudioBackendType | null;
  isReady: boolean;
  isWarming: boolean;
  isPendingPlay: boolean;
  isQuarantined: boolean;
  quarantineRemainingMs: number;
}

interface AudioPlaybackInspectionRuntimeHost {
  usesLegacyAudioRuntimePath(): boolean;
  getAudioRuntimeStage(): AudioRuntimeStage;
  getIsIOS(): boolean;
  getAudioContext(): AudioContext | null;
  getContextUnlocked(): boolean;
  getSharedIOSGainNode(): GainNode | null;
  getIsPrewarmed(): boolean;
  getMasterVolume(): number;
  getGlobalMuted(): boolean;
  getAudioInstances(): Map<string, AudioInstance>;
  getRegisteredPads(): Map<string, DeckPadSnapshot>;
  getLegacyBufferCacheSize(): number;
  getEngineHealth(): EngineHealth;
  getEngineBackendForPad(padId: string): AudioBackendType | null;
  getTransportState(padId: string): {
    isPlaying?: boolean;
    progress?: number;
    playStartTime?: number | null;
    softMuted?: boolean;
    startTimeMs?: number;
    endTimeMs?: number;
    audioDurationMs?: number;
    tempoRate?: number;
    playbackMode?: 'once' | 'loop' | 'stopper';
  } | null;
  computeV3EffectiveVolume(snapshot: DeckPadSnapshot, transport?: { softMuted?: boolean } | null): number;
  getRuntimeInfo(): RuntimeInfoSnapshot;
  getLastChannelDiag(): {
    action: 'none' | 'play' | 'pause' | 'stop' | 'seek' | 'ended';
    channelId: number | null;
    token: number;
    actionAt: number | null;
  };
  setActivePadId(padId: string | null): void;
  isPreloadingPad(padId: string): boolean;
  getPadWarmState(
    padId: string,
    backend: AudioBackendType | null,
    isReady: boolean,
    isWarming: boolean,
    audioUrl?: string
  ): WarmStateSnapshot;
  getBaseGain(instance: AudioInstance): number;
  getPadLatencyStats(): PadLatencyStats | null;
}

export class AudioPlaybackInspectionRuntime {
  private readonly host: AudioPlaybackInspectionRuntimeHost;

  constructor(host: AudioPlaybackInspectionRuntimeHost) {
    this.host = host;
  }

  private resolveV3WindowMs(
    snapshot: DeckPadSnapshot,
    transport?: {
      startTimeMs?: number;
      endTimeMs?: number;
      audioDurationMs?: number;
    } | null
  ): { startMs: number; endMs: number; durationMs: number } {
    const startMs = Number.isFinite(transport?.startTimeMs)
      ? Math.max(0, Number(transport?.startTimeMs))
      : Math.max(0, snapshot.startTimeMs || 0);
    const endCandidate = Number.isFinite(transport?.endTimeMs)
      ? Math.max(0, Number(transport?.endTimeMs))
      : Math.max(0, snapshot.endTimeMs || 0);
    const sourceDurationMs = Number.isFinite(transport?.audioDurationMs)
      ? Math.max(0, Number(transport?.audioDurationMs))
      : Math.max(0, snapshot.audioDurationMs || 0);
    const resolvedEndMs = endCandidate > startMs
      ? endCandidate
      : Math.max(startMs, sourceDurationMs);
    return {
      startMs,
      endMs: resolvedEndMs,
      durationMs: Math.max(0, resolvedEndMs - startMs)
    };
  }

  private resolveV3CurrentMs(
    snapshot: DeckPadSnapshot,
    transport?: {
      progress?: number;
      playStartTime?: number | null;
      tempoRate?: number;
      playbackMode?: 'once' | 'loop' | 'stopper';
      startTimeMs?: number;
      endTimeMs?: number;
      audioDurationMs?: number;
    } | null
  ): { currentMs: number; endMs: number } {
    const window = this.resolveV3WindowMs(snapshot, transport);
    if (window.durationMs <= 0) {
      return { currentMs: 0, endMs: 0 };
    }
    if (typeof transport?.progress === 'number' && Number.isFinite(transport.progress) && transport.progress > 0) {
      const normalized = transport.progress > 1 ? transport.progress / 100 : transport.progress;
      const clamped = Math.max(0, Math.min(1, normalized));
      return {
        currentMs: clamped * window.durationMs,
        endMs: window.durationMs
      };
    }
    if (typeof transport?.playStartTime === 'number' && Number.isFinite(transport.playStartTime) && transport.playStartTime > 0) {
      const tempoRate = Number.isFinite(transport.tempoRate) ? Math.max(0.05, Number(transport.tempoRate)) : 1;
      const elapsedMs = Math.max(0, performance.now() - transport.playStartTime) * tempoRate;
      const playbackMode = transport.playbackMode || snapshot.playbackMode;
      const currentMs = playbackMode === 'loop'
        ? (window.durationMs > 0 ? elapsedMs % window.durationMs : 0)
        : Math.min(window.durationMs, elapsedMs);
      return {
        currentMs,
        endMs: window.durationMs
      };
    }
    return {
      currentMs: 0,
      endMs: window.durationMs
    };
  }

  getPadState(padId: string): { isPlaying: boolean; progress: number; effectiveVolume: number; softMuted: boolean } | null {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      const registered = this.host.getRegisteredPads().get(padId);
      if (!registered) return null;
      const transport = this.host.getTransportState(padId);
      const isPlaying = Boolean(transport?.isPlaying);
      return {
        isPlaying,
        progress: typeof transport?.progress === 'number' ? transport.progress : 0,
        effectiveVolume: this.host.computeV3EffectiveVolume(registered, transport),
        softMuted: Boolean(transport?.softMuted),
      };
    }

    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return null;
    const factor = this.computeEffectiveVolumeFactor(instance);
    return {
      isPlaying: instance.isPlaying,
      progress: instance.progress,
      effectiveVolume: instance.volume * instance.padGainLinear * factor,
      softMuted: Boolean(instance.softMuted),
    };
  }

  getAllPlayingPads() {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      const playing: any[] = [];
      this.host.getRegisteredPads().forEach((snapshot, padId) => {
        const transport = this.host.getTransportState(padId);
        if (!transport?.isPlaying) return;
        const timing = this.resolveV3CurrentMs(snapshot, transport);
        playing.push({
          padId: snapshot.padId,
          padName: snapshot.padName,
          bankId: snapshot.bankId,
          bankName: snapshot.bankName,
          color: snapshot.color,
          volume: normalizePadVolumeValue(snapshot.volume),
          effectiveVolume: this.host.computeV3EffectiveVolume(snapshot, transport),
          currentMs: timing.currentMs,
          endMs: timing.endMs,
          playStartTime: transport.playStartTime || Date.now(),
          tempoRate: Number.isFinite(transport.tempoRate) ? Math.max(0.05, Number(transport.tempoRate)) : 1,
          playbackMode: transport.playbackMode || snapshot.playbackMode,
          timingSource: 'performance',
          channelId: null
        });
      });
      return playing.sort((a, b) => (a.playStartTime || 0) - (b.playStartTime || 0));
    }

    const playing: any[] = [];
    this.host.getAudioInstances().forEach((instance) => {
      if (!instance.isPlaying) return;

      let currentRelMs = 0;
      let endRelMs = 0;

      if (instance.audioElement) {
        const nowAbsMs = instance.audioElement.currentTime * 1000;
        const regionStart = instance.startTimeMs || 0;
        const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.audioElement.duration * 1000;
        currentRelMs = Math.max(0, Math.min(regionEnd - regionStart, nowAbsMs - regionStart));
        endRelMs = Math.max(0, regionEnd - regionStart);
      } else if (instance.bufferSourceNode && instance.playStartTime) {
        const elapsed = (Date.now() - instance.playStartTime) * Math.pow(2, (instance.pitch || 0) / 12);
        const regionStart = instance.startTimeMs || 0;
        const regionEnd = instance.endTimeMs || instance.bufferDuration;
        currentRelMs = Math.min(elapsed, regionEnd - regionStart);
        endRelMs = regionEnd - regionStart;
      }

      const factor = this.computeEffectiveVolumeFactor(instance);
      playing.push({
        padId: instance.padId,
        padName: instance.padName,
        bankId: instance.bankId,
        bankName: instance.bankName,
        color: instance.color,
        volume: instance.volume,
        effectiveVolume: instance.volume * instance.padGainLinear * factor,
        currentMs: currentRelMs,
        endMs: endRelMs,
        playStartTime: instance.playStartTime || 0,
        tempoRate: 1,
        playbackMode: instance.playbackMode,
        timingSource: 'date',
        channelId: instance.channelId ?? null
      });
    });
    return playing.sort((a, b) => (a.playStartTime || 0) - (b.playStartTime || 0));
  }

  getLegacyPlayingPads() {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      return this.getAllPlayingPads().map((item) => ({
        padId: item.padId,
        padName: item.padName,
        bankId: item.bankId,
        bankName: item.bankName,
        color: item.color,
        volume: item.volume,
        currentMs: item.currentMs,
        endMs: item.endMs,
        playStartTime: item.playStartTime,
        tempoRate: item.tempoRate,
        playbackMode: item.playbackMode,
        timingSource: item.timingSource
      }));
    }

    const playing: any[] = [];
    this.host.getAudioInstances().forEach((instance) => {
      if (!instance.isPlaying) return;

      let currentRelMs = 0;
      let endRelMs = 0;

      if (instance.audioElement) {
        const nowAbsMs = instance.audioElement.currentTime * 1000;
        const regionStart = instance.startTimeMs || 0;
        const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.audioElement.duration * 1000;
        currentRelMs = Math.max(0, Math.min(regionEnd - regionStart, nowAbsMs - regionStart));
        endRelMs = Math.max(0, regionEnd - regionStart);
      } else if (instance.bufferSourceNode && instance.playStartTime) {
        const elapsed = (Date.now() - instance.playStartTime) * Math.pow(2, (instance.pitch || 0) / 12);
        const regionStart = instance.startTimeMs || 0;
        const regionEnd = instance.endTimeMs || instance.bufferDuration;
        currentRelMs = Math.min(elapsed, regionEnd - regionStart);
        endRelMs = regionEnd - regionStart;
      }

      playing.push({
        padId: instance.padId,
        padName: instance.padName,
        bankId: instance.bankId,
        bankName: instance.bankName,
        color: instance.color,
        volume: instance.volume,
        currentMs: currentRelMs,
        endMs: endRelMs,
        playStartTime: instance.playStartTime || 0,
        tempoRate: 1,
        playbackMode: instance.playbackMode,
        timingSource: 'date'
      });
    });
    return playing.sort((a, b) => (a.playStartTime || 0) - (b.playStartTime || 0));
  }

  getDebugInfo() {
    return {
      totalInstances: this.host.getAudioInstances().size,
      activeElements: Array.from(this.host.getAudioInstances().values()).filter((i) => i.audioElement).length,
      activeBuffers: Array.from(this.host.getAudioInstances().values()).filter((i) => i.audioBuffer).length,
      playingCount: Array.from(this.host.getAudioInstances().values()).filter((i) => i.isPlaying).length,
      isIOS: this.host.getIsIOS(),
      contextState: this.host.getAudioContext()?.state || 'none',
      isUnlocked: this.host.getContextUnlocked()
    };
  }

  getIOSDebugInfo() {
    return {
      isIOS: this.host.getIsIOS(),
      contextState: this.host.getAudioContext()?.state || 'none',
      isUnlocked: this.host.getContextUnlocked(),
      hasSharedGain: !!this.host.getSharedIOSGainNode(),
      bufferCacheSize: this.host.getLegacyBufferCacheSize(),
      isPrewarmed: this.host.getIsPrewarmed()
    };
  }

  getAudioState(): AudioSystemState {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      const health = this.host.getEngineHealth();
      const playingCount = Array.from(this.host.getRegisteredPads().keys()).reduce((count, padId) => {
        return count + (this.host.getTransportState(padId)?.isPlaying ? 1 : 0);
      }, 0);
      if (playingCount === 0) {
        this.host.setActivePadId(null);
      }
      return {
        isIOS: this.host.getIsIOS(),
        contextState: health.contextState,
        isUnlocked: health.contextState === 'running',
        totalInstances: this.host.getRegisteredPads().size,
        playingCount,
        bufferedCount: health.backendCounts.buffer,
        masterVolume: this.host.getMasterVolume(),
        globalMuted: this.host.getGlobalMuted()
      };
    }

    return {
      isIOS: this.host.getIsIOS(),
      contextState: this.host.getAudioContext()?.state || 'none',
      isUnlocked: this.host.getContextUnlocked(),
      totalInstances: this.host.getAudioInstances().size,
      playingCount: Array.from(this.host.getAudioInstances().values()).filter((i) => i.isPlaying).length,
      bufferedCount: Array.from(this.host.getAudioInstances().values()).filter((i) => i.audioBuffer).length,
      masterVolume: this.host.getMasterVolume(),
      globalMuted: this.host.getGlobalMuted()
    };
  }

  getAudioRuntimeInfo(): AudioRuntimeInfo {
    const runtimeInfo = this.host.getRuntimeInfo();
    const channel = this.host.getLastChannelDiag();
    return {
      stage: this.host.getAudioRuntimeStage(),
      activePadId: runtimeInfo.activePadId,
      activePadBackend: runtimeInfo.activePadId ? this.host.getEngineBackendForPad(runtimeInfo.activePadId) : null,
      lastPadLoadLatencyMs: runtimeInfo.lastPadLoadLatencyMs,
      lastPadStartLatencyMs: runtimeInfo.lastPadStartLatencyMs,
      lastPadStopLatencyMs: runtimeInfo.lastPadStopLatencyMs,
      quarantinedPads: runtimeInfo.quarantinedPads,
      lastBlockedPadId: runtimeInfo.lastBlockedPadId,
      lastBlockedReason: runtimeInfo.lastBlockedReason,
      lastChannelAction: channel.action,
      lastChannelId: channel.channelId,
      lastChannelCommandToken: channel.token,
      lastChannelActionAt: channel.actionAt
    };
  }

  getPadWarmStatus(padId: string): PadWarmStatus {
    if (this.host.usesLegacyAudioRuntimePath()) {
      const instance = this.host.getAudioInstances().get(padId);
      return {
        stage: this.host.getAudioRuntimeStage(),
        backend: null,
        isReady: Boolean(instance && (instance.audioBuffer || instance.audioElement)),
        isWarming: Boolean(instance?.isBufferDecoding),
        isPendingPlay: false,
        isQuarantined: false,
        quarantineRemainingMs: 0
      };
    }

    const snapshot = this.host.getRegisteredPads().get(padId);
    const backend = this.host.getEngineBackendForPad(padId);
    const warmState = this.host.getPadWarmState(
      padId,
      backend,
      Boolean(snapshot && backend),
      this.host.isPreloadingPad(padId),
      snapshot?.audioUrl
    );

    return {
      stage: this.host.getAudioRuntimeStage(),
      backend: warmState.backend,
      isReady: warmState.isReady,
      isWarming: warmState.isWarming,
      isPendingPlay: warmState.isPendingPlay,
      isQuarantined: warmState.isQuarantined,
      quarantineRemainingMs: warmState.quarantineRemainingMs
    };
  }

  async runDiagnostics(): Promise<DiagnosticResult> {
    const engineHealth = this.host.getEngineHealth();
    const audioContext = this.host.getAudioContext();
    const result: DiagnosticResult = {
      contextState: this.host.usesLegacyAudioRuntimePath() ? (audioContext?.state || 'none') : engineHealth.contextState,
      isUnlocked: this.host.getContextUnlocked(),
      isIOS: this.host.getIsIOS(),
      silentAudioTest: { success: false, latencyMs: 0 },
      oscillatorTest: { success: false, latencyMs: 0 },
      bufferTest: { success: false, latencyMs: 0 },
      mediaElementTest: { success: false, latencyMs: 0 },
      totalInstances: this.host.usesLegacyAudioRuntimePath() ? this.host.getAudioInstances().size : this.host.getRegisteredPads().size,
      activeBuffers: this.host.usesLegacyAudioRuntimePath() ? this.host.getLegacyBufferCacheSize() : engineHealth.backendCounts.buffer,
      padLatencyStats: this.host.getPadLatencyStats()
    };

    if (!audioContext) {
      return result;
    }

    try {
      const start1 = performance.now();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      result.silentAudioTest = {
        success: audioContext.state === 'running',
        latencyMs: performance.now() - start1
      };
    } catch {
      result.silentAudioTest = { success: false, latencyMs: 0 };
    }

    try {
      const start2 = performance.now();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.01, audioContext.currentTime);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.1);
      result.oscillatorTest = { success: true, latencyMs: performance.now() - start2 };
    } catch {
      result.oscillatorTest = { success: false, latencyMs: 0 };
    }

    try {
      const start3 = performance.now();
      const testBuffer = audioContext.createBuffer(1, 44100, 44100);
      const source = audioContext.createBufferSource();
      source.buffer = testBuffer;
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.01, audioContext.currentTime);
      source.connect(gain);
      gain.connect(audioContext.destination);
      source.start();
      source.stop(audioContext.currentTime + 0.05);
      result.bufferTest = { success: true, latencyMs: performance.now() - start3 };
    } catch {
      result.bufferTest = { success: false, latencyMs: 0 };
    }

    if (!this.host.getIsIOS()) {
      try {
        const start4 = performance.now();
        const audio = new Audio();
        audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        audio.volume = 0.01;
        await audio.play();
        audio.pause();
        result.mediaElementTest = { success: true, latencyMs: performance.now() - start4 };
      } catch {
        result.mediaElementTest = { success: false, latencyMs: 0 };
      }
    } else {
      result.mediaElementTest = { success: true, latencyMs: 0 };
    }

    return result;
  }

  private computeEffectiveVolumeFactor(instance: AudioInstance): number {
    const base = this.host.getBaseGain(instance);
    if (base <= 0) return 0;
    const currentGain = instance.gainNode ? instance.gainNode.gain.value : base;
    return Math.max(0, Math.min(1, currentGain / base));
  }
}
