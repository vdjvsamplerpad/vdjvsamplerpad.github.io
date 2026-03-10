import {
  executeStop,
  type StopTarget,
} from '../../../lib/audio-engine';
import type { StopMode } from './audioDeckRuntime';
import type {
  AudioInstance,
  StopTimingProfile,
  AndroidMuteGateMode,
} from './useGlobalPlaybackManager';

const ANDROID_FAST_START_RAMP_MS = 8;
const PROGRESS_NOTIFY_STEP = typeof window !== 'undefined' &&
  Boolean((window as any).Capacitor?.isNativePlatform?.())
  ? (/Android/.test(navigator.userAgent) ? 5 : 5)
  : (/Android/.test(navigator.userAgent) ? 4 : 2);

interface AudioLegacyPadRuntimeHost {
  getAudioInstances(): Map<string, AudioInstance>;
  getAudioContext(): AudioContext | null;
  getSilentAudio(): HTMLAudioElement | null;
  getIsIOS(): boolean;
  getIsAndroid(): boolean;
  getContextUnlocked(): boolean;
  setContextUnlocked(unlocked: boolean): void;
  ensureAudioResources(instance: AudioInstance): boolean;
  startBufferDecode(instance: AudioInstance): Promise<void>;
  connectAudioNodes(instance: AudioInstance): void;
  disconnectAudioNodes(instance: AudioInstance): void;
  releaseChannel(instance: AudioInstance, keepChannel?: boolean): void;
  refreshRuntimeMixLevels(): void;
  notifyStateChange(immediate?: boolean): void;
  getBaseGain(instance: AudioInstance): number;
  getStopTimingProfile(): StopTimingProfile;
  beginPadLatencyProbe(instance: AudioInstance, playToken: number, mode: AndroidMuteGateMode): void;
  markPadLatencyPlayResolved(instance: AudioInstance, playToken: number): void;
  playPadById(padId: string): void;
  stopPadById(padId: string, mode?: StopMode, keepChannel?: boolean): void;
  isAndroidNativeFastPathEnabled(): boolean;
}

export class AudioLegacyPadRuntime {
  private readonly host: AudioLegacyPadRuntimeHost;

  constructor(host: AudioLegacyPadRuntimeHost) {
    this.host = host;
  }

  playPad(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;

    this.cancelPendingPadStop(instance);
    instance.lastUsedTime = Date.now();
    const playToken = (instance.playToken || 0) + 1;
    instance.playToken = playToken;
    instance.pendingDecodePlayToken = null;

    if (this.host.getIsIOS()) {
      this.playPadIOS(instance, playToken);
      return;
    }

    const isReady = this.host.ensureAudioResources(instance);
    if (!isReady) {
      this.host.releaseChannel(instance);
      return;
    }

    const audioContext = this.host.getAudioContext();
    if (!this.host.getContextUnlocked() && audioContext) {
      const tryResume = audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve();
      const trySilent = this.host.getSilentAudio() ? this.host.getSilentAudio()!.play().catch(() => { }) : Promise.resolve();

      Promise.all([tryResume, trySilent]).then(() => {
        this.host.setContextUnlocked(Boolean(this.host.getAudioContext()) && this.host.getAudioContext()!.state === 'running');
        if (instance.playToken !== playToken) return;
        this.proceedWithPlay(instance, playToken);
      });
      return;
    }

    this.proceedWithPlay(instance, playToken);
  }

  stopPad(padId: string, mode: StopMode = 'instant', keepChannel?: boolean): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    switch (mode) {
      case 'instant': this.stopPadInstant(instance, keepChannel); break;
      case 'fadeout': this.stopPadFadeout(instance); break;
      case 'brake': this.stopPadBrake(instance); break;
      case 'backspin': this.stopPadBackspin(instance); break;
      case 'filter': this.stopPadFilter(instance); break;
    }
  }

  playStutterPad(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    this.restartPadImmediate(instance);
  }

  triggerToggle(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    if (instance.isPlaying) {
      this.host.stopPadById(padId, 'instant');
    } else {
      instance.softMuted = false;
      this.host.playPadById(padId);
    }
  }

  triggerHoldStart(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    if (!instance.isPlaying) {
      instance.softMuted = false;
      this.host.playPadById(padId);
    }
  }

  triggerHoldStop(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    if (instance.isPlaying) {
      this.host.stopPadById(padId, 'instant');
    }
  }

  triggerStutter(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    if (!instance.isPlaying) {
      instance.softMuted = false;
      this.host.playPadById(padId);
      return;
    }
    this.restartPadImmediate(instance);
  }

  triggerUnmuteToggle(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    if (!instance.isPlaying) {
      instance.softMuted = false;
      this.host.playPadById(padId);
      return;
    }
    instance.softMuted = !instance.softMuted;
    this.applySoftMute(instance);
    this.host.notifyStateChange();
  }

  toggleMutePad(padId: string): void {
    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    instance.softMuted = !instance.softMuted;
    this.applySoftMute(instance);
    this.host.notifyStateChange();
  }

  setGain(instance: AudioInstance, gain: number): void {
    const audioContext = this.host.getAudioContext();
    if (!instance.gainNode || !audioContext) return;
    const safeGain = Math.max(0, gain);
    const now = audioContext.currentTime;
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setValueAtTime(safeGain, now);
  }

  startManualFade(instance: AudioInstance, fromGain: number, toGain: number, durationMs: number, onComplete?: () => void): void {
    const audioContext = this.host.getAudioContext();
    if (!instance.gainNode || !audioContext) { if (onComplete) onComplete(); return; }

    const now = audioContext.currentTime;
    const duration = Math.max(0, durationMs) / 1000;
    const startGain = Math.max(0, fromGain);
    const endGain = Math.max(0, toGain);

    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setValueAtTime(startGain, now);
    instance.gainNode.gain.linearRampToValueAtTime(endGain, now + duration);

    if (durationMs === 0) {
      if (onComplete) onComplete();
    } else {
      setTimeout(() => { if (onComplete) onComplete(); }, durationMs);
    }
  }

  startFadeOutMonitor(instance: AudioInstance): void {
    if (this.host.getIsIOS() && instance.bufferSourceNode) {
      this.startIOSFadeOutMonitor(instance);
      return;
    }

    if (!instance.audioElement) return;
    if (instance.fadeMonitorFrameId !== null) cancelAnimationFrame(instance.fadeMonitorFrameId);
    instance.fadeOutStartTime = null;

    const monitor = () => {
      if (!instance.audioElement || !instance.isPlaying) { instance.fadeMonitorFrameId = null; return; }

      const startMs = instance.startTimeMs || 0;
      const endMs = instance.endTimeMs > startMs
        ? instance.endTimeMs
        : (instance.audioElement.duration || 0) * 1000;

      const currentAbsMs = instance.audioElement.currentTime * 1000;
      const remainingMs = endMs - currentAbsMs;

      if (instance.playbackMode !== 'loop' && instance.fadeOutMs > 0 && remainingMs <= instance.fadeOutMs && instance.fadeOutStartTime === null) {
        const currentGain = instance.gainNode ? instance.gainNode.gain.value : this.host.getBaseGain(instance);
        instance.fadeOutStartTime = performance.now();
        instance.isFading = true;
        this.startManualFade(instance, currentGain, 0, Math.max(0, remainingMs), () => {
          instance.fadeOutStartTime = null;
          instance.isFading = false;
        });
      }

      instance.fadeMonitorFrameId = requestAnimationFrame(monitor);
    };

    instance.fadeMonitorFrameId = requestAnimationFrame(monitor);
  }

  resetInstanceAudio(instance: AudioInstance): void {
    if (!instance.audioElement) return;
    if (instance.startTimeMs > 0) instance.audioElement.currentTime = instance.startTimeMs / 1000;
    if (instance.isPlaying && !(instance.fadeInMs > 0 && instance.fadeInStartTime === null)) {
      this.updateInstanceVolume(instance);
    }
    instance.audioElement.playbackRate = Math.pow(2, instance.pitch / 12);
    const audioContext = this.host.getAudioContext();
    if (instance.filterNode && audioContext) instance.filterNode.frequency.setValueAtTime(20000, audioContext.currentTime);
  }

  updateInstanceVolume(instance: AudioInstance): void {
    const audioContext = this.host.getAudioContext();
    if (!instance.isConnected || !instance.gainNode || !audioContext) return;
    if (instance.isFading || instance.fadeInStartTime || instance.fadeOutStartTime) return;
    const targetVolume = this.host.getBaseGain(instance);
    if (instance.audioElement) instance.audioElement.volume = 1.0;
    const now = audioContext.currentTime;
    const timing = this.host.getStopTimingProfile();
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setTargetAtTime(Math.max(0, targetVolume), now, timing.volumeSmoothingSec);
  }

  applySoftMute(instance: AudioInstance): void {
    const audioContext = this.host.getAudioContext();
    if (!instance.gainNode || !audioContext) return;
    this.stopFadeAutomation(instance);
    const targetVolume = this.host.getBaseGain(instance);
    if (instance.audioElement) instance.audioElement.volume = 1.0;
    const now = audioContext.currentTime;
    const timing = this.host.getStopTimingProfile();
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setTargetAtTime(Math.max(0, targetVolume), now, timing.softMuteSmoothingSec);
  }

  private applyGlobalSettingsToInstance(instance: AudioInstance): void {
    this.updateInstanceVolume(instance);
  }

  private async playPadIOS(instance: AudioInstance, playToken: number): Promise<void> {
    const audioContext = this.host.getAudioContext();
    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        if (instance.playToken !== playToken) return;
        this.playPadIOSInternal(instance, playToken);
      });
      return;
    }

    this.playPadIOSInternal(instance, playToken);
  }

  private playPadIOSInternal(instance: AudioInstance, playToken: number): void {
    const audioContext = this.host.getAudioContext();
    if (!audioContext) return;
    if (instance.playToken !== playToken) return;

    if (!instance.audioBuffer) {
      instance.pendingDecodePlayToken = playToken;
      if (instance.lastAudioUrl && !instance.isBufferDecoding) {
        this.host.startBufferDecode(instance).finally(() => {
          if (instance.pendingDecodePlayToken !== playToken) return;
          if (instance.playToken !== playToken) return;
          this.playPadIOSInternal(instance, playToken);
        });
      }
      return;
    }
    instance.pendingDecodePlayToken = null;

    this.applyNextPlayOverrides(instance);

    if (instance.triggerMode === 'unmute' && instance.isPlaying) {
      instance.softMuted = !instance.softMuted;
      const targetGain = this.host.getBaseGain(instance);
      this.setGain(instance, targetGain);
      this.host.notifyStateChange(true);
      return;
    }

    if (instance.playbackMode === 'stopper') {
      this.host.getAudioInstances().forEach(other => {
        if (other.padId !== instance.padId && other.isPlaying) this.host.stopPadById(other.padId, 'instant');
      });
    }

    this.stopFadeAutomation(instance);
    if (instance.bufferSourceNode) {
      try {
        instance.bufferSourceNode.stop();
        instance.bufferSourceNode.disconnect();
      } catch { }
    }

    if (!instance.isConnected) {
      this.host.connectAudioNodes(instance);
    }

    if (!instance.gainNode) return;

    const source = audioContext.createBufferSource();
    source.buffer = instance.audioBuffer;
    source.loop = instance.playbackMode === 'loop';
    source.playbackRate.setValueAtTime(Math.pow(2, (instance.pitch || 0) / 12), audioContext.currentTime);

    if (instance.filterNode) {
      instance.filterNode.frequency.cancelScheduledValues(audioContext.currentTime);
      instance.filterNode.frequency.setValueAtTime(20000, audioContext.currentTime);
    }

    source.connect(instance.filterNode || instance.gainNode);
    instance.bufferSourceNode = source;

    const baseGain = this.host.getBaseGain(instance);
    const initialGain = instance.fadeInMs > 0 ? 0 : baseGain;
    this.setGain(instance, initialGain);

    const startOffset = (instance.startTimeMs || 0) / 1000;
    const endTime = instance.endTimeMs > 0 ? instance.endTimeMs / 1000 : instance.audioBuffer.duration;
    const duration = endTime - startOffset;

    source.onended = () => {
      if (instance.playToken !== playToken) return;
      if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
        instance.isPlaying = false;
        instance.progress = 0;
        instance.lastProgressNotify = 0;
        instance.isFading = false;
        instance.pendingDecodePlayToken = null;
        if (instance.iosProgressInterval) {
          clearInterval(instance.iosProgressInterval);
          instance.iosProgressInterval = null;
        }
        this.host.releaseChannel(instance);
        this.host.refreshRuntimeMixLevels();
        this.host.notifyStateChange(true);
      }
    };

    try {
      if (instance.playbackMode === 'loop') {
        source.loopStart = startOffset;
        source.loopEnd = endTime;
        source.start(0, startOffset);
      } else {
        source.start(0, startOffset, duration);
      }

      if (instance.playToken !== playToken) {
        try {
          source.stop();
          source.disconnect();
        } catch { }
        return;
      }

      instance.isPlaying = true;
      instance.playStartTime = Date.now();
      instance.isFading = instance.fadeInMs > 0;
      instance.progress = 0;
      instance.lastProgressNotify = 0;
      this.host.refreshRuntimeMixLevels();

      if (instance.fadeInMs > 0) {
        this.startManualFade(instance, initialGain, baseGain, instance.fadeInMs, () => {
          instance.fadeInStartTime = null;
          instance.isFading = false;
        });
      }

      this.startIOSFadeOutMonitor(instance);
      this.host.notifyStateChange(true);
    } catch {
    }
  }

  private proceedWithPlay(instance: AudioInstance, playToken: number): void {
    if (!instance.audioElement) return;
    if (instance.playToken !== playToken) return;

    const audioContext = this.host.getAudioContext();
    if (audioContext?.state === 'suspended') {
      audioContext.resume().catch(() => { });
    }

    if (!instance.isConnected) {
      this.host.connectAudioNodes(instance);
    }

    this.applyNextPlayOverrides(instance);

    if (instance.triggerMode === 'unmute' && instance.isPlaying) {
      instance.softMuted = !instance.softMuted;
      const targetGain = this.host.getBaseGain(instance);
      this.setGain(instance, targetGain);
      this.host.notifyStateChange(true);
      return;
    }

    if (instance.playbackMode === 'stopper') {
      this.host.getAudioInstances().forEach(other => {
        if (other.padId !== instance.padId && other.isPlaying) this.host.stopPadById(other.padId, 'instant');
      });
    }

    const androidMuteGateMode: AndroidMuteGateMode = this.host.isAndroidNativeFastPathEnabled() ? 'fast' : 'legacy';
    const useAndroidFastPath = androidMuteGateMode === 'fast';
    this.host.beginPadLatencyProbe(instance, playToken, androidMuteGateMode);

    instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;

    this.stopFadeAutomation(instance);
    instance.fadeInStartTime = instance.fadeInMs > 0 ? performance.now() : null;
    instance.fadeOutStartTime = null;

    const baseGainBeforePlay = this.host.getBaseGain(instance);
    const useFastRamp = useAndroidFastPath && instance.fadeInMs <= 0;
    const initialGainBeforePlay = (instance.fadeInMs > 0 || useFastRamp) ? 0 : baseGainBeforePlay;
    instance.audioElement.muted = useAndroidFastPath ? false : true;
    instance.audioElement.volume = 1.0;
    this.setGain(instance, initialGainBeforePlay);

    const playPromise = instance.audioElement.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.host.markPadLatencyPlayResolved(instance, playToken);
          if (instance.playToken !== playToken || !instance.audioElement) {
            if (instance.audioElement) {
              instance.audioElement.pause();
              instance.audioElement.muted = true;
            }
            instance.padLatencyProbe = null;
            return;
          }
          instance.isPlaying = true;
          instance.playStartTime = Date.now();
          if (!useAndroidFastPath) {
            instance.audioElement.muted = false;
          }
          instance.isFading = instance.fadeInMs > 0 || useFastRamp;
          instance.progress = 0;
          instance.lastProgressNotify = 0;
          this.resetInstanceAudio(instance);
          this.host.refreshRuntimeMixLevels();

          const baseGain = this.host.getBaseGain(instance);
          const initialGain = (instance.fadeInMs > 0 || useFastRamp) ? 0 : baseGain;
          this.setGain(instance, initialGain);

          if (instance.fadeInMs > 0) {
            this.startManualFade(instance, initialGain, baseGain, instance.fadeInMs, () => {
              instance.fadeInStartTime = null;
              instance.isFading = false;
            });
          } else if (useFastRamp) {
            this.startManualFade(instance, 0, baseGain, ANDROID_FAST_START_RAMP_MS, () => {
              instance.isFading = false;
            });
          } else {
            this.setGain(instance, baseGain);
          }

          this.startFadeOutMonitor(instance);

          this.host.notifyStateChange(true);
        })
        .catch(() => {
          instance.padLatencyProbe = null;
        });
    }
  }

  private startIOSFadeOutMonitor(instance: AudioInstance): void {
    if (instance.iosProgressInterval) {
      clearInterval(instance.iosProgressInterval);
    }

    const startTime = performance.now();
    const startOffset = instance.startTimeMs || 0;
    const endMs = instance.endTimeMs || instance.bufferDuration;
    const totalDuration = endMs - startOffset;
    const safeDuration = Math.max(1, totalDuration);
    let lastNotifiedProgress = instance.lastProgressNotify;

    const updateInterval = this.host.getIsIOS() ? 200 : (this.host.getIsAndroid() ? 100 : 50);

    instance.iosProgressInterval = setInterval(() => {
      if (!instance.isPlaying) {
        if (instance.iosProgressInterval) {
          clearInterval(instance.iosProgressInterval);
          instance.iosProgressInterval = null;
        }
        return;
      }

      const elapsed = performance.now() - startTime;
      const pitchFactor = Math.pow(2, (instance.pitch || 0) / 12);
      const adjustedElapsed = elapsed * pitchFactor;

      const newProgress = Math.min(100, (adjustedElapsed / safeDuration) * 100);
      instance.progress = newProgress;

      const remainingMs = totalDuration - adjustedElapsed;
      if (instance.playbackMode !== 'loop' && instance.fadeOutMs > 0 && remainingMs <= instance.fadeOutMs && instance.fadeOutStartTime === null) {
        const currentGain = instance.gainNode ? instance.gainNode.gain.value : this.host.getBaseGain(instance);
        instance.fadeOutStartTime = performance.now();
        instance.isFading = true;
        this.startManualFade(instance, currentGain, 0, Math.max(0, remainingMs), () => {
          instance.fadeOutStartTime = null;
          instance.isFading = false;
        });
      }

      if (adjustedElapsed >= totalDuration) {
        if (instance.playbackMode !== 'loop') {
          this.host.stopPadById(instance.padId, 'instant');
        }
      }

      if (Math.abs(newProgress - lastNotifiedProgress) >= PROGRESS_NOTIFY_STEP || newProgress >= 100) {
        lastNotifiedProgress = newProgress;
        instance.lastProgressNotify = newProgress;
        this.host.notifyStateChange();
      }
    }, updateInterval);
  }

  private cancelPendingPadStop(instance: AudioInstance): void {
    if (instance.stopCancel) {
      instance.stopCancel();
      instance.stopCancel = null;
    }
  }

  private finalizePadStop(instance: AudioInstance, keepChannel?: boolean): void {
    instance.padLatencyProbe = null;
    if (instance.bufferSourceNode) {
      try {
        instance.bufferSourceNode.stop();
        instance.bufferSourceNode.disconnect();
      } catch { }
      instance.bufferSourceNode = null;
    }

    if (instance.iosProgressInterval) {
      clearInterval(instance.iosProgressInterval);
      instance.iosProgressInterval = null;
    }

    if (instance.audioElement) {
      instance.audioElement.muted = true;
      try {
        instance.audioElement.pause();
        instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;
      } catch { }
    }

    instance.isPlaying = false;
    instance.progress = 0;
    instance.lastProgressNotify = 0;
    instance.isFading = false;
    instance.fadeInStartTime = null;
    instance.fadeOutStartTime = null;
    instance.playStartTime = null;
    instance.stopCancel = null;
    this.host.releaseChannel(instance, keepChannel);

    if (!this.host.getIsIOS()) this.host.disconnectAudioNodes(instance);
    this.stopFadeAutomation(instance);
    this.resetInstanceAudio(instance);
    this.host.refreshRuntimeMixLevels();
    this.host.notifyStateChange(true);
  }

  private stopPadWithScheduler(instance: AudioInstance, mode: StopMode = 'instant', keepChannel?: boolean): void {
    instance.playToken += 1;
    instance.pendingDecodePlayToken = null;
    this.stopFadeAutomation(instance);
    this.cancelPendingPadStop(instance);

    const target: StopTarget = {
      setGainRamp: (targetGain: number, durationSec: number) => {
        const audioContext = this.host.getAudioContext();
        if (!instance.gainNode || !audioContext) return;
        const now = audioContext.currentTime;
        instance.gainNode.gain.cancelScheduledValues(now);
        if (durationSec > 0) {
          instance.gainNode.gain.setValueAtTime(instance.gainNode.gain.value, now);
          instance.gainNode.gain.linearRampToValueAtTime(Math.max(0, targetGain), now + durationSec);
        } else {
          instance.gainNode.gain.setValueAtTime(Math.max(0, targetGain), now);
        }
      },
      getGain: () => {
        if (instance.gainNode) return Math.max(0, instance.gainNode.gain.value || 0);
        return Math.max(0, this.host.getBaseGain(instance));
      },
      setPlaybackRate: (rate: number) => {
        const safeRate = Math.max(0.05, Number.isFinite(rate) ? rate : 1);
        const audioContext = this.host.getAudioContext();
        if (instance.bufferSourceNode && audioContext) {
          instance.bufferSourceNode.playbackRate.setValueAtTime(safeRate, audioContext.currentTime);
        }
        if (instance.audioElement) {
          instance.audioElement.playbackRate = safeRate;
        }
      },
      getPlaybackRate: () => {
        if (instance.bufferSourceNode) {
          const rate = instance.bufferSourceNode.playbackRate.value;
          return Number.isFinite(rate) && rate > 0 ? rate : 1;
        }
        if (instance.audioElement) {
          const rate = instance.audioElement.playbackRate;
          return Number.isFinite(rate) && rate > 0 ? rate : 1;
        }
        return 1;
      },
      setFilterState: (cutoffHz: number, q: number) => {
        const audioContext = this.host.getAudioContext();
        if (!instance.filterNode || !audioContext) return;
        const now = audioContext.currentTime;
        const safeCutoff = Math.max(40, Math.min(20000, Number.isFinite(cutoffHz) ? cutoffHz : 20000));
        const safeQ = Math.max(0.707, Math.min(4, Number.isFinite(q) ? q : 0.707));
        instance.filterNode.type = 'lowpass';
        instance.filterNode.frequency.cancelScheduledValues(now);
        instance.filterNode.Q.cancelScheduledValues(now);
        instance.filterNode.frequency.setValueAtTime(instance.filterNode.frequency.value || 20000, now);
        instance.filterNode.frequency.linearRampToValueAtTime(safeCutoff, now + 0.03);
        instance.filterNode.Q.setValueAtTime(instance.filterNode.Q.value || 0.707, now);
        instance.filterNode.Q.linearRampToValueAtTime(safeQ, now + 0.04);
      },
      resetFilter: () => {
        const audioContext = this.host.getAudioContext();
        if (!instance.filterNode || !audioContext) return;
        const now = audioContext.currentTime;
        instance.filterNode.type = 'lowpass';
        instance.filterNode.frequency.cancelScheduledValues(now);
        instance.filterNode.Q.cancelScheduledValues(now);
        instance.filterNode.frequency.setValueAtTime(20000, now);
        instance.filterNode.Q.setValueAtTime(0.707, now);
      },
      finalize: () => this.finalizePadStop(instance, keepChannel),
      isActive: () => {
        const hasBuffer = instance.bufferSourceNode !== null;
        const hasMedia = Boolean(instance.audioElement && !instance.audioElement.paused);
        return instance.isPlaying && (hasBuffer || hasMedia);
      }
    };

    instance.stopCancel = executeStop(target, mode, this.host.getAudioContext() ?? undefined);
  }

  private stopPadInstant(instance: AudioInstance, keepChannel?: boolean): void {
    this.stopPadWithScheduler(instance, 'instant', keepChannel);
  }

  private stopPadFadeout(instance: AudioInstance): void {
    this.stopPadWithScheduler(instance, 'fadeout');
  }

  private stopPadBrake(instance: AudioInstance): void {
    this.stopPadWithScheduler(instance, 'brake');
  }

  private stopPadBackspin(instance: AudioInstance): void {
    this.stopPadWithScheduler(instance, 'backspin');
  }

  private stopPadFilter(instance: AudioInstance): void {
    this.stopPadWithScheduler(instance, 'filter');
  }

  private stopFadeAutomation(instance: AudioInstance): void {
    const audioContext = this.host.getAudioContext();
    if (instance.fadeIntervalId) {
      clearInterval(instance.fadeIntervalId);
      instance.fadeIntervalId = null;
    }
    if (instance.fadeAnimationFrameId !== null) {
      cancelAnimationFrame(instance.fadeAnimationFrameId);
      instance.fadeAnimationFrameId = null;
    }
    if (instance.fadeMonitorFrameId !== null) {
      cancelAnimationFrame(instance.fadeMonitorFrameId);
      instance.fadeMonitorFrameId = null;
    }
    if (instance.iosProgressInterval) {
      clearInterval(instance.iosProgressInterval);
      instance.iosProgressInterval = null;
    }
    if (instance.stopEffectTimeoutId) {
      clearTimeout(instance.stopEffectTimeoutId);
      instance.stopEffectTimeoutId = null;
    }
    if (instance.stopCancel) {
      instance.stopCancel();
      instance.stopCancel = null;
    }
    if (instance.gainNode && audioContext) {
      instance.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
    }
  }

  private restartPadImmediate(instance: AudioInstance): void {
    instance.softMuted = false;
    this.cancelPendingPadStop(instance);
    this.stopFadeAutomation(instance);

    if (this.host.getIsIOS() && instance.audioBuffer) {
      const nextToken = (instance.playToken || 0) + 1;
      instance.playToken = nextToken;
      instance.pendingDecodePlayToken = null;
      if (instance.bufferSourceNode) {
        try {
          instance.bufferSourceNode.stop();
          instance.bufferSourceNode.disconnect();
        } catch { }
        instance.bufferSourceNode = null;
      }
      instance.isPlaying = false;
      instance.progress = 0;
      instance.lastProgressNotify = 0;
      instance.playStartTime = null;
      this.playPadIOSInternal(instance, nextToken);
      return;
    }

    if (instance.audioElement) {
      if (!instance.isConnected) this.host.connectAudioNodes(instance);
      try {
        instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;
      } catch { }
      instance.audioElement.playbackRate = Math.pow(2, (instance.pitch || 0) / 12);
      instance.audioElement.muted = false;
      this.setGain(instance, this.host.getBaseGain(instance));
      instance.audioElement.play().then(() => {
        instance.isPlaying = true;
        instance.playStartTime = Date.now();
        instance.progress = 0;
        instance.lastProgressNotify = 0;
        this.startFadeOutMonitor(instance);
        this.host.refreshRuntimeMixLevels();
        this.host.notifyStateChange(true);
      }).catch(() => {
        this.host.playPadById(instance.padId);
      });
      return;
    }

    this.host.playPadById(instance.padId);
  }

  private applyNextPlayOverrides(instance: AudioInstance): void {
    const o = instance.nextPlayOverrides;
    if (!o) return;

    if (typeof o.padName === 'string') instance.padName = o.padName;
    if (typeof o.name === 'string') instance.padName = o.name;
    if (typeof o.color === 'string') instance.color = o.color;
    if (typeof o.bankId === 'string') instance.bankId = o.bankId;
    if (typeof o.bankName === 'string') instance.bankName = o.bankName;

    if (typeof o.triggerMode !== 'undefined') {
      instance.triggerMode = o.triggerMode;
    }
    if (typeof o.playbackMode !== 'undefined') {
      instance.playbackMode = o.playbackMode;
      if (instance.audioElement) instance.audioElement.loop = o.playbackMode === 'loop';
    }

    if (typeof o.startTimeMs === 'number') instance.startTimeMs = Math.max(0, o.startTimeMs);
    if (typeof o.endTimeMs === 'number') instance.endTimeMs = Math.max(0, o.endTimeMs);
    if (typeof o.fadeInMs === 'number') instance.fadeInMs = Math.max(0, o.fadeInMs);
    if (typeof o.fadeOutMs === 'number') instance.fadeOutMs = Math.max(0, o.fadeOutMs);
    if (typeof o.pitch === 'number') instance.pitch = o.pitch;
    if (typeof o.volume === 'number') instance.volume = o.volume;

    instance.nextPlayOverrides = undefined;
  }
}
