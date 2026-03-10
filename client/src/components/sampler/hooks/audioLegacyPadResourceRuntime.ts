import type { StopMode } from './audioDeckRuntime';
import type { AudioInstance } from './useGlobalPlaybackManager';

const MAX_AUDIO_ELEMENTS = 800;
const IOS_MAX_BUFFER_MEMORY = 50 * 1024 * 1024;
const MAX_PLAYBACK_CHANNELS = 8;
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
const IS_CAPACITOR_NATIVE = typeof window !== 'undefined' &&
  Boolean((window as any).Capacitor?.isNativePlatform?.());
const PROGRESS_NOTIFY_STEP = IS_CAPACITOR_NATIVE ? (IS_ANDROID ? 5 : 5) : (IS_ANDROID ? 4 : 2);

interface AudioLegacyPadResourceRuntimeHost {
  getAudioInstances(): Map<string, AudioInstance>;
  getAudioContext(): AudioContext | null;
  getSharedIOSGainNode(): GainNode | null;
  getIsIOS(): boolean;
  disablePitchPreservation(audio: HTMLAudioElement): void;
  markPadLatencyTimeupdate(instance: AudioInstance, currentTimeMs: number): void;
  markPadLatencyPlaying(instance: AudioInstance): void;
  stopPadById(padId: string, mode?: StopMode, keepChannel?: boolean): void;
  refreshRuntimeMixLevels(): void;
  notifyStateChange(immediate?: boolean): void;
  updateInstanceVolume(instance: AudioInstance): void;
}

export class AudioLegacyPadResourceRuntime {
  private readonly host: AudioLegacyPadResourceRuntimeHost;
  private readonly bufferCache: Map<string, AudioBuffer> = new Map();
  private readonly bufferAccessTime: Map<string, number> = new Map();
  private readonly channelAssignments: Map<number, string> = new Map();
  private bufferMemoryUsage = 0;

  constructor(host: AudioLegacyPadResourceRuntimeHost) {
    this.host = host;
  }

  getBufferCacheSize(): number {
    return this.bufferCache.size;
  }

  ensureAudioResources(instance: AudioInstance): boolean {
    instance.lastUsedTime = Date.now();

    if (this.host.getIsIOS() && instance.audioBuffer) return true;
    if (instance.audioElement) return true;
    if (!instance.lastAudioUrl) return false;

    try {
      this.enforceAudioLimit();

      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = instance.lastAudioUrl;
      audio.muted = false;
      audio.volume = 1.0;
      audio.preload = this.host.getIsIOS() ? 'none' : 'metadata';
      (audio as any).playsInline = true;
      audio.muted = false;
      audio.volume = 1.0;

      this.host.disablePitchPreservation(audio);

      audio.playbackRate = Math.pow(2, (instance.pitch || 0) / 12);
      audio.loop = instance.playbackMode === 'loop';

      instance.audioElement = audio;

      const handleTimeUpdate = () => {
        if (!instance.audioElement) return;
        const currentTime = instance.audioElement.currentTime * 1000;
        this.host.markPadLatencyTimeupdate(instance, currentTime);
        const duration = (instance.endTimeMs || instance.audioElement.duration * 1000) - (instance.startTimeMs || 0);
        const safeDuration = Math.max(1, duration);
        const currentProgress = ((currentTime - (instance.startTimeMs || 0)) / safeDuration) * 100;
        instance.progress = Math.max(0, Math.min(100, currentProgress));
        if (
          Math.abs(instance.progress - instance.lastProgressNotify) >= PROGRESS_NOTIFY_STEP ||
          instance.progress <= 0 ||
          instance.progress >= 100
        ) {
          instance.lastProgressNotify = instance.progress;
          this.host.notifyStateChange();
        }

        if (instance.endTimeMs > 0 && currentTime >= instance.endTimeMs) {
          if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
            this.host.stopPadById(instance.padId, 'instant');
          } else if (instance.playbackMode === 'loop') {
            instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;
          }
        }
      };

      const handleEnded = () => {
        if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
          instance.isPlaying = false;
          instance.progress = 0;
          instance.lastProgressNotify = 0;
          instance.isFading = false;
          this.stopFadeAutomation(instance);
          this.releaseChannel(instance);
          this.host.refreshRuntimeMixLevels();
          this.host.notifyStateChange(true);
        }
      };

      const handleLoadedMetadata = () => {
        if (!instance.audioElement) return;
        if (instance.startTimeMs > 0) instance.audioElement.currentTime = instance.startTimeMs / 1000;
        if (instance.endTimeMs === 0) instance.endTimeMs = instance.audioElement.duration * 1000;
      };
      const handlePlaying = () => {
        this.host.markPadLatencyPlaying(instance);
      };
      const handleCanPlayThrough = () => { };

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('playing', handlePlaying);
      audio.addEventListener('canplaythrough', handleCanPlayThrough);

      instance.cleanupFunctions.push(
        () => audio.removeEventListener('timeupdate', handleTimeUpdate),
        () => audio.removeEventListener('ended', handleEnded),
        () => audio.removeEventListener('loadedmetadata', handleLoadedMetadata),
        () => audio.removeEventListener('playing', handlePlaying),
        () => audio.removeEventListener('canplaythrough', handleCanPlayThrough)
      );

      return true;
    } catch {
      return false;
    }
  }

  async startBufferDecode(instance: AudioInstance): Promise<void> {
    if (!instance.lastAudioUrl || instance.isBufferDecoding || instance.audioBuffer) return;

    instance.isBufferDecoding = true;

    try {
      const buffer = await this.decodeAudioBuffer(instance.lastAudioUrl);
      if (buffer) {
        instance.audioBuffer = buffer;
        instance.reversedBackspinBuffer = null;
        instance.bufferDuration = buffer.duration * 1000;
        if (instance.endTimeMs === 0) {
          instance.endTimeMs = instance.bufferDuration;
        }
      }
    } catch {
    } finally {
      instance.isBufferDecoding = false;
    }
  }

  assignChannel(instance: AudioInstance): boolean {
    if (instance.ignoreChannel) {
      this.releaseChannel(instance);
      return true;
    }
    if (instance.channelId && this.channelAssignments.get(instance.channelId) === instance.padId) {
      return true;
    }
    if (instance.channelId && !this.channelAssignments.has(instance.channelId)) {
      this.channelAssignments.set(instance.channelId, instance.padId);
      return true;
    }
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      if (!this.channelAssignments.has(i)) {
        this.channelAssignments.set(i, instance.padId);
        instance.channelId = i;
        return true;
      }
    }
    return false;
  }

  releaseChannel(instance: AudioInstance, keepChannel?: boolean): void {
    if (keepChannel) return;
    if (instance.channelId && this.channelAssignments.get(instance.channelId) === instance.padId) {
      this.channelAssignments.delete(instance.channelId);
    }
    instance.channelId = null;
  }

  connectAudioNodes(instance: AudioInstance): void {
    const audioContext = this.host.getAudioContext();
    if (!audioContext || instance.isConnected || !instance.audioElement) return;

    if (this.host.getIsIOS()) {
      this.connectAudioNodesIOS(instance);
      return;
    }

    try {
      if (!instance.sourceNode) {
        instance.sourceNode = audioContext.createMediaElementSource(instance.audioElement);
        instance.sourceConnected = true;
      }

      if (!instance.gainNode) instance.gainNode = audioContext.createGain();

      if (!instance.filterNode) {
        instance.filterNode = audioContext.createBiquadFilter();
        instance.filterNode.type = 'lowpass';
        instance.filterNode.frequency.setValueAtTime(20000, audioContext.currentTime);
      }

      if (instance.sourceNode) {
        instance.sourceNode.connect(instance.filterNode);
        instance.filterNode.connect(instance.gainNode);
        instance.gainNode.connect(audioContext.destination);
      }

      instance.isConnected = true;
      this.host.updateInstanceVolume(instance);
    } catch {
      instance.isConnected = false;
    }
  }

  disconnectAudioNodes(instance: AudioInstance): void {
    if (!instance.isConnected) return;
    try {
      if (instance.bufferSourceNode) {
        try {
          instance.bufferSourceNode.stop();
          instance.bufferSourceNode.disconnect();
        } catch { }
        instance.bufferSourceNode = null;
      }

      if (instance.sourceNode) {
        try {
          instance.sourceNode.disconnect();
        } catch { }
        instance.sourceConnected = false;
      }

      instance.gainNode?.disconnect();
      instance.filterNode?.disconnect();
      instance.isConnected = false;
    } catch {
    }
  }

  cleanupInstance(instance: AudioInstance): void {
    if (instance.isPlaying) this.host.stopPadById(instance.padId, 'instant');
    this.stopFadeAutomation(instance);
    instance.padLatencyProbe = null;

    this.dehydrateInstance(instance);

    instance.isPlaying = false;
    instance.isFading = false;
    instance.progress = 0;
  }

  private getBufferSize(buffer: AudioBuffer): number {
    return buffer.length * buffer.numberOfChannels * 4;
  }

  private evictOldestBuffers(neededBytes: number): void {
    if (!this.host.getIsIOS()) return;

    const entries = Array.from(this.bufferAccessTime.entries())
      .sort((a, b) => a[1] - b[1]);

    let freedBytes = 0;
    for (const [url] of entries) {
      if (this.bufferMemoryUsage + neededBytes - freedBytes <= IOS_MAX_BUFFER_MEMORY) {
        break;
      }

      const buffer = this.bufferCache.get(url);
      if (buffer) {
        const size = this.getBufferSize(buffer);
        this.bufferCache.delete(url);
        this.bufferAccessTime.delete(url);
        freedBytes += size;

        this.host.getAudioInstances().forEach((inst) => {
          if (inst.lastAudioUrl === url && !inst.isPlaying) {
            inst.audioBuffer = null;
          }
        });
      }
    }

    this.bufferMemoryUsage -= freedBytes;
  }

  private async decodeAudioBuffer(url: string): Promise<AudioBuffer | null> {
    const audioContext = this.host.getAudioContext();
    if (!audioContext) return null;

    const cached = this.bufferCache.get(url);
    if (cached) {
      this.bufferAccessTime.set(url, Date.now());
      return cached;
    }

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const bufferSize = this.getBufferSize(audioBuffer);
      if (this.host.getIsIOS() && this.bufferMemoryUsage + bufferSize > IOS_MAX_BUFFER_MEMORY) {
        this.evictOldestBuffers(bufferSize);
      }

      this.bufferCache.set(url, audioBuffer);
      this.bufferAccessTime.set(url, Date.now());
      this.bufferMemoryUsage += bufferSize;

      return audioBuffer;
    } catch {
      return null;
    }
  }

  private enforceAudioLimit(): void {
    let activeCount = 0;
    this.host.getAudioInstances().forEach((inst) => {
      if (inst.audioElement) activeCount += 1;
    });

    if (activeCount < MAX_AUDIO_ELEMENTS) return;

    const candidates: AudioInstance[] = [];
    this.host.getAudioInstances().forEach((inst) => {
      if (inst.audioElement && !inst.isPlaying && !inst.isFading) {
        candidates.push(inst);
      }
    });

    candidates.sort((a, b) => a.lastUsedTime - b.lastUsedTime);
    if (candidates.length > 0) {
      this.dehydrateInstance(candidates[0]);
    }
  }

  private dehydrateInstance(instance: AudioInstance): void {
    if (!instance.audioElement && !instance.bufferSourceNode) return;

    try {
      instance.padLatencyProbe = null;
      instance.cleanupFunctions.forEach((cleanup) => {
        try { cleanup(); } catch { }
      });
      instance.cleanupFunctions = [];

      if (instance.audioElement) {
        instance.audioElement.pause();
        instance.audioElement.src = '';
        instance.audioElement.load();
      }

      if (instance.iosProgressInterval) {
        clearInterval(instance.iosProgressInterval);
        instance.iosProgressInterval = null;
      }

      this.disconnectAudioNodes(instance);

      instance.audioElement = null;
      instance.sourceNode = null;
      instance.bufferSourceNode = null;
      instance.isConnected = false;
      instance.sourceConnected = false;
    } catch {
    }
  }

  private stopFadeAutomation(instance: AudioInstance): void {
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
    const audioContext = this.host.getAudioContext();
    if (instance.gainNode && audioContext) {
      instance.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
    }
  }

  private connectAudioNodesIOS(instance: AudioInstance): void {
    const audioContext = this.host.getAudioContext();
    const sharedIOSGainNode = this.host.getSharedIOSGainNode();
    if (!audioContext || !sharedIOSGainNode) return;

    try {
      if (!instance.filterNode) {
        instance.filterNode = audioContext.createBiquadFilter();
        instance.filterNode.type = 'lowpass';
        instance.filterNode.frequency.setValueAtTime(20000, audioContext.currentTime);
        instance.filterNode.Q.setValueAtTime(1, audioContext.currentTime);
      }

      if (!instance.gainNode) {
        instance.gainNode = audioContext.createGain();
        instance.filterNode.connect(instance.gainNode);
        instance.gainNode.connect(sharedIOSGainNode);
      }

      if (instance.audioElement && !instance.sourceNode) {
        instance.sourceNode = audioContext.createMediaElementSource(instance.audioElement);
      }
      if (instance.sourceNode && !instance.sourceConnected) {
        instance.sourceNode.connect(instance.filterNode || instance.gainNode);
        instance.sourceConnected = true;
      }

      instance.isConnected = true;
      this.host.updateInstanceVolume(instance);
    } catch {
      instance.isConnected = false;
    }
  }
}
