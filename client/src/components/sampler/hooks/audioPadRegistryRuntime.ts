import {
  cloneHotcuesTupleValue,
  normalizeAudioBytesValue,
  normalizeDurationMsValue,
  normalizeKeyLockForRuntime,
  normalizePadGainLinearValue,
  normalizePadPlaybackModeValue,
  normalizePadTriggerModeValue,
  normalizePadVolumeValue,
  normalizeTempoPercentForRuntime,
  tempoPercentToRateForRuntime,
  type HotcueTuple,
} from './audioPadNormalization';
import { hotcueTupleEqualsValue } from './audioHotcueUtils';
import type { AudioRuntimeStage } from './audioRuntimeStage';
import type { DeckPadSnapshot, StopMode } from './audioDeckRuntime';
import type { AudioPadRuntimeRegistrationData, AudioPadRuntimeSettings } from './audioPadRuntimeTypes';
import type { AudioInstance } from './useGlobalPlaybackManager';

interface AudioPadRegistryRuntimeHost {
  usesLegacyAudioRuntimePath(): boolean;
  getIsIOS(): boolean;
  getAudioContext(): AudioContext | null;
  initializeAudioContext(): void;
  getAudioInstances(): Map<string, AudioInstance>;
  getRegisteredPads(): Map<string, DeckPadSnapshot>;
  notifyStateChange(immediate?: boolean): void;
  syncLoadedChannelHotcuesFromRegisteredPad(padId: string): void;
  legacyCleanupInstance(instance: AudioInstance): void;
  legacyEnsureAudioResources(instance: AudioInstance): boolean;
  legacyStartBufferDecode(instance: AudioInstance): Promise<void>;
  legacyReleaseChannel(instance: AudioInstance, keepChannel?: boolean): void;
  legacyAssignChannel(instance: AudioInstance): boolean;
  legacyUpdateInstanceVolume(instance: AudioInstance): void;
  legacyStartFadeOutMonitor(instance: AudioInstance): void;
  legacyUnloadChannelsForPad(padId: string): void;
  v3StopPadBasic(padId: string, mode?: StopMode, options?: Record<string, unknown>): void;
  v3DisposeTransport(padId: string): void;
  v3ClearPadRuntimeState(padId: string): void;
  v3ClearStutterGuard(padId: string): void;
  v3ClearPadLoadFailureState(padId: string): void;
  v3ClearPadQuarantineState(padId: string, reason: string, stage: AudioRuntimeStage): void;
  v3MarkTransportRegionDirty(padId: string): void;
  v3ClearTransportRegionDirty(padId: string): void;
  getAudioRuntimeStage(): AudioRuntimeStage;
  v3SetTransportPitch(padId: string, pitch: number): void;
  v3SetTransportTempoRate(padId: string, rate: number): void;
  v3SetTransportPreservePitch(padId: string, preservePitch: boolean): void;
  v3SetTransportVolume(padId: string, volume: number): void;
  v3SetTransportGain(padId: string, gain: number): void;
  v3SetTransportPlaybackMode(padId: string, mode: DeckPadSnapshot['playbackMode']): void;
}

export class AudioPadRegistryRuntime {
  private readonly host: AudioPadRegistryRuntimeHost;

  constructor(host: AudioPadRegistryRuntimeHost) {
    this.host = host;
  }

  async registerPad(padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string): Promise<void> {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      if (!padData.audioUrl) return;
      this.upsertRegisteredPadSnapshot(padId, padData, bankId, bankName);
      this.host.notifyStateChange();
      return;
    }

    if (!this.host.getAudioContext()) this.host.initializeAudioContext();
    const padGainLinear = this.resolvePadGainLinear(padData?.gainDb, padData?.gain);

    const audioInstances = this.host.getAudioInstances();
    const registeredPads = this.host.getRegisteredPads();
    const existing = audioInstances.get(padId);

    if (existing && existing.lastAudioUrl === padData.audioUrl) {
      existing.padName = padData.name;
      existing.bankId = bankId;
      existing.bankName = bankName;
      existing.color = padData.color;
      existing.volume = padData.volume;
      existing.padGainLinear = padGainLinear;
      existing.ignoreChannel = !!padData.ignoreChannel;
      if (typeof existing.playToken !== 'number') existing.playToken = 0;
      if (existing.pendingDecodePlayToken === undefined) existing.pendingDecodePlayToken = null;
      if (existing.reversedBackspinBuffer === undefined) existing.reversedBackspinBuffer = null;
      if (existing.stopCancel === undefined) existing.stopCancel = null;
      if (typeof existing.lastProgressNotify !== 'number') existing.lastProgressNotify = 0;
      if (existing.padLatencyProbe === undefined) existing.padLatencyProbe = null;

      this.updateLegacyPadSettings(existing, registeredPads.get(padId), padId, {
        triggerMode: normalizePadTriggerModeValue(padData.triggerMode),
        playbackMode: normalizePadPlaybackModeValue(padData.playbackMode),
        startTimeMs: padData.startTimeMs,
        endTimeMs: padData.endTimeMs,
        fadeInMs: padData.fadeInMs,
        fadeOutMs: padData.fadeOutMs,
        pitch: padData.pitch,
        tempoPercent: padData.tempoPercent,
        keyLock: padData.keyLock,
        gainDb: padData.gainDb,
        gain: padData.gain,
        ignoreChannel: padData.ignoreChannel
      });

      existing.lastUsedTime = Date.now();
      registeredPads.set(padId, this.createRegisteredPadSnapshot(padId, padData, bankId, bankName, padGainLinear));
      this.host.notifyStateChange();
      return;
    }

    if (existing) {
      this.host.legacyCleanupInstance(existing);
    }

    if (!padData.audioUrl) return;

    const audioContext = this.host.getAudioContext();
    if (!audioContext) return;

    const instance: AudioInstance = {
      padId,
      padName: padData.name,
      bankId,
      bankName,
      color: padData.color,
      volume: padData.volume,
      padGainLinear,
      channelId: null,
      ignoreChannel: !!padData.ignoreChannel,
      audioElement: null,
      audioContext,
      sourceNode: null,
      gainNode: null,
      filterNode: null,
      isPlaying: false,
      progress: 0,
      triggerMode: normalizePadTriggerModeValue(padData.triggerMode),
      playbackMode: normalizePadPlaybackModeValue(padData.playbackMode),
      startTimeMs: padData.startTimeMs || 0,
      endTimeMs: padData.endTimeMs || 0,
      fadeInMs: padData.fadeInMs || 0,
      fadeOutMs: padData.fadeOutMs || 0,
      pitch: padData.pitch || 0,
      fadeIntervalId: null,
      fadeAnimationFrameId: null,
      fadeMonitorFrameId: null,
      cleanupFunctions: [],
      isFading: false,
      isConnected: false,
      lastAudioUrl: padData.audioUrl,
      sourceConnected: false,
      fadeInStartTime: null,
      fadeOutStartTime: null,
      playStartTime: null,
      softMuted: false,
      nextPlayOverrides: undefined,
      lastUsedTime: Date.now(),
      audioBuffer: null,
      bufferSourceNode: null,
      isBufferDecoding: false,
      bufferDuration: 0,
      iosProgressInterval: null,
      stopEffectTimeoutId: null,
      playToken: 0,
      pendingDecodePlayToken: null,
      reversedBackspinBuffer: null,
      stopCancel: null,
      lastProgressNotify: 0,
      padLatencyProbe: null
    };

    audioInstances.set(padId, instance);
    registeredPads.set(padId, this.createRegisteredPadSnapshot(padId, padData, bankId, bankName, padGainLinear));

    if (!this.host.getIsIOS()) {
      this.host.legacyEnsureAudioResources(instance);
    } else if (audioInstances.size <= 12) {
      void this.host.legacyStartBufferDecode(instance);
    }

    this.host.notifyStateChange();
  }

  unregisterPad(padId: string): void {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      this.host.v3StopPadBasic(padId, 'instant', {
        notify: false,
        emitAction: null,
        force: true
      });
      this.host.v3DisposeTransport(padId);
      this.host.v3ClearPadRuntimeState(padId);
      this.host.getRegisteredPads().delete(padId);
      this.host.v3ClearStutterGuard(padId);
      this.host.v3ClearTransportRegionDirty(padId);
      this.host.v3ClearPadLoadFailureState(padId);
      this.host.notifyStateChange();
      return;
    }

    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    this.host.legacyUnloadChannelsForPad(padId);
    this.host.legacyReleaseChannel(instance);
    this.host.legacyCleanupInstance(instance);
    this.host.getAudioInstances().delete(padId);
    this.host.getRegisteredPads().delete(padId);
    this.host.notifyStateChange();
  }

  updatePadSettings(padId: string, settings: AudioPadRuntimeSettings): void {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      this.updateV3PadSettings(padId, settings);
      return;
    }

    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    const registered = this.host.getRegisteredPads().get(padId);
    this.updateLegacyPadSettings(instance, registered, padId, settings);
  }

  updatePadSettingsNextPlay(padId: string, settings: AudioPadRuntimeSettings): void {
    if (!this.host.usesLegacyAudioRuntimePath()) {
      const registered = this.host.getRegisteredPads().get(padId);
      if (!registered) return;
      if (typeof settings.name === 'string') registered.padName = settings.name;
      if (typeof settings.color === 'string') registered.color = settings.color;
      this.updateV3PadSettings(padId, settings);
      return;
    }

    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    instance.nextPlayOverrides = { ...(instance.nextPlayOverrides || {}), ...settings };
  }

  updatePadMetadata(padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }): void {
    const registered = this.host.getRegisteredPads().get(padId);

    if (!this.host.usesLegacyAudioRuntimePath()) {
      if (!registered) return;
      if (metadata.name !== undefined) registered.padName = metadata.name;
      if (metadata.color !== undefined) registered.color = metadata.color;
      if (metadata.bankId !== undefined) registered.bankId = metadata.bankId;
      if (metadata.bankName !== undefined) registered.bankName = metadata.bankName;
      this.host.notifyStateChange();
      return;
    }

    const instance = this.host.getAudioInstances().get(padId);
    if (!instance) return;
    if (metadata.name !== undefined) instance.padName = metadata.name;
    if (metadata.color !== undefined) instance.color = metadata.color;
    if (metadata.bankId !== undefined) instance.bankId = metadata.bankId;
    if (metadata.bankName !== undefined) instance.bankName = metadata.bankName;
    if (registered) {
      if (metadata.name !== undefined) registered.padName = metadata.name;
      if (metadata.color !== undefined) registered.color = metadata.color;
      if (metadata.bankId !== undefined) registered.bankId = metadata.bankId;
      if (metadata.bankName !== undefined) registered.bankName = metadata.bankName;
    }
    this.host.notifyStateChange();
  }

  private updateV3PadSettings(padId: string, settings: AudioPadRuntimeSettings): void {
    const registered = this.host.getRegisteredPads().get(padId);
    if (!registered) return;

    let trimRegionChanged = false;
    let hotcuesChanged = false;

    if (typeof settings.startTimeMs === 'number') {
      if (registered.startTimeMs !== settings.startTimeMs) {
        trimRegionChanged = true;
      }
      registered.startTimeMs = settings.startTimeMs;
    }
    if (typeof settings.endTimeMs === 'number') {
      if (registered.endTimeMs !== settings.endTimeMs) {
        trimRegionChanged = true;
      }
      registered.endTimeMs = settings.endTimeMs;
    }
    if (typeof settings.fadeInMs === 'number') registered.fadeInMs = settings.fadeInMs;
    if (typeof settings.fadeOutMs === 'number') registered.fadeOutMs = settings.fadeOutMs;
    if (typeof settings.pitch === 'number') {
      registered.pitch = settings.pitch;
      this.host.v3SetTransportPitch(padId, registered.pitch);
    }
    if (typeof settings.tempoPercent === 'number') {
      registered.tempoPercent = normalizeTempoPercentForRuntime(this.host.getIsIOS(), settings.tempoPercent);
      this.host.v3SetTransportTempoRate(padId, tempoPercentToRateForRuntime(this.host.getIsIOS(), registered.tempoPercent));
    }
    if (typeof settings.keyLock === 'boolean') {
      registered.keyLock = normalizeKeyLockForRuntime(this.host.getIsIOS(), settings.keyLock);
      this.host.v3SetTransportPreservePitch(padId, registered.keyLock);
    }
    if (typeof settings.volume === 'number') {
      registered.volume = normalizePadVolumeValue(settings.volume);
      this.host.v3SetTransportVolume(padId, registered.volume);
    }
    if (settings.gainDb !== undefined || settings.gain !== undefined) {
      registered.padGainLinear = this.resolvePadGainLinear(settings.gainDb, settings.gain);
      this.host.v3SetTransportGain(padId, normalizePadGainLinearValue(registered.padGainLinear));
    }
    if (typeof settings.triggerMode === 'string') {
      registered.triggerMode = normalizePadTriggerModeValue(settings.triggerMode);
    }
    if (typeof settings.playbackMode === 'string') {
      registered.playbackMode = normalizePadPlaybackModeValue(settings.playbackMode);
      this.host.v3SetTransportPlaybackMode(padId, registered.playbackMode);
    }
    if (settings.savedHotcuesMs !== undefined) {
      const nextHotcues: HotcueTuple = Array.isArray(settings.savedHotcuesMs)
        ? (settings.savedHotcuesMs.slice(0, 4) as HotcueTuple)
        : [null, null, null, null];
      hotcuesChanged = !hotcueTupleEqualsValue(
        cloneHotcuesTupleValue(registered.savedHotcuesMs),
        cloneHotcuesTupleValue(nextHotcues)
      );
      registered.savedHotcuesMs = nextHotcues;
    }
    if (trimRegionChanged) {
      this.host.v3MarkTransportRegionDirty(padId);
    }
    if (hotcuesChanged) {
      this.host.syncLoadedChannelHotcuesFromRegisteredPad(padId);
    }
    this.host.notifyStateChange();
  }

  private updateLegacyPadSettings(
    instance: AudioInstance,
    registered: DeckPadSnapshot | undefined,
    padId: string,
    settings: any
  ): void {
    let hotcuesChanged = false;

    const fadeSettingsChanged =
      settings.fadeInMs !== undefined ||
      settings.fadeOutMs !== undefined ||
      settings.startTimeMs !== undefined ||
      settings.endTimeMs !== undefined;

    if (settings.triggerMode !== undefined) {
      instance.triggerMode = normalizePadTriggerModeValue(settings.triggerMode);
    }
    if (settings.playbackMode !== undefined) {
      const playbackMode = normalizePadPlaybackModeValue(settings.playbackMode);
      instance.playbackMode = playbackMode;
      if (instance.audioElement) instance.audioElement.loop = playbackMode === 'loop';
      if (registered) {
        registered.playbackMode = playbackMode;
      }
    }
    if (settings.startTimeMs !== undefined) {
      instance.startTimeMs = settings.startTimeMs;
      if (registered) registered.startTimeMs = settings.startTimeMs;
    }
    if (settings.endTimeMs !== undefined) {
      instance.endTimeMs = settings.endTimeMs;
      if (registered) registered.endTimeMs = settings.endTimeMs;
    }
    if (settings.fadeInMs !== undefined) {
      instance.fadeInMs = settings.fadeInMs;
      if (registered) registered.fadeInMs = settings.fadeInMs;
    }
    if (settings.fadeOutMs !== undefined) {
      instance.fadeOutMs = settings.fadeOutMs;
      if (registered) registered.fadeOutMs = settings.fadeOutMs;
    }
    if (settings.pitch !== undefined) {
      instance.pitch = settings.pitch;
      if (registered) registered.pitch = settings.pitch;
      if (instance.audioElement) instance.audioElement.playbackRate = Math.pow(2, settings.pitch / 12);
      const audioContext = this.host.getAudioContext();
      if (instance.bufferSourceNode && audioContext) {
        instance.bufferSourceNode.playbackRate.setValueAtTime(Math.pow(2, settings.pitch / 12), audioContext.currentTime);
      }
    }
    if (settings.volume !== undefined) {
      instance.volume = settings.volume;
      if (registered) registered.volume = settings.volume;
      this.host.legacyUpdateInstanceVolume(instance);
    }
    if (settings.gainDb !== undefined || settings.gain !== undefined) {
      instance.padGainLinear = this.resolvePadGainLinear(settings.gainDb, settings.gain);
      if (registered) {
        registered.padGainLinear = this.resolvePadGainLinear(settings.gainDb, settings.gain);
      }
      this.host.legacyUpdateInstanceVolume(instance);
    }
    if (settings.savedHotcuesMs !== undefined && registered) {
      const nextHotcues: HotcueTuple = Array.isArray(settings.savedHotcuesMs)
        ? (settings.savedHotcuesMs.slice(0, 4) as HotcueTuple)
        : [null, null, null, null];
      hotcuesChanged = !hotcueTupleEqualsValue(
        cloneHotcuesTupleValue(registered.savedHotcuesMs),
        cloneHotcuesTupleValue(nextHotcues)
      );
      registered.savedHotcuesMs = nextHotcues;
    }
    if (settings.ignoreChannel !== undefined) {
      instance.ignoreChannel = settings.ignoreChannel;
      if (settings.ignoreChannel) {
        this.host.legacyReleaseChannel(instance);
        this.host.legacyUpdateInstanceVolume(instance);
        this.host.notifyStateChange();
      } else if (instance.isPlaying && !instance.channelId) {
        this.host.legacyAssignChannel(instance);
        this.host.legacyUpdateInstanceVolume(instance);
        this.host.notifyStateChange();
      }
    }

    if (fadeSettingsChanged && instance.isPlaying && !instance.isFading) {
      instance.fadeOutStartTime = null;
      this.host.legacyStartFadeOutMonitor(instance);
    }
    if (hotcuesChanged) {
      this.host.syncLoadedChannelHotcuesFromRegisteredPad(padId);
    }
  }

  private upsertRegisteredPadSnapshot(padId: string, padData: any, bankId: string, bankName: string): void {
    const padGainLinear = this.resolvePadGainLinear(padData?.gainDb, padData?.gain);
    const audioBytes = normalizeAudioBytesValue(padData?.audioBytes);
    const audioDurationMs = this.inferAudioDurationMsFromPadData(padData);
    const nextAudioUrl = typeof padData.audioUrl === 'string' ? padData.audioUrl : '';
    const previousSnapshot = this.host.getRegisteredPads().get(padId);
    if (previousSnapshot && previousSnapshot.audioUrl !== nextAudioUrl) {
      this.host.v3ClearPadLoadFailureState(padId);
      this.host.v3ClearPadQuarantineState(padId, 'audio_url_changed', this.host.getAudioRuntimeStage());
    } else if (
      previousSnapshot &&
      previousSnapshot.audioUrl === nextAudioUrl &&
      (previousSnapshot.audioBytes !== audioBytes || previousSnapshot.audioDurationMs !== audioDurationMs)
    ) {
      this.host.v3ClearPadLoadFailureState(padId);
      this.host.v3ClearPadQuarantineState(padId, 'audio_metadata_changed', this.host.getAudioRuntimeStage());
    }
    this.host.getRegisteredPads().set(
      padId,
      this.createRegisteredPadSnapshot(padId, padData, bankId, bankName, padGainLinear)
    );
  }

  private createRegisteredPadSnapshot(
    padId: string,
    padData: any,
    bankId: string,
    bankName: string,
    padGainLinear: number
  ): DeckPadSnapshot {
    return {
      padId,
      padName: padData.name,
      bankId,
      bankName,
      color: padData.color,
      audioUrl: padData.audioUrl,
      volume: typeof padData.volume === 'number' ? padData.volume : 1,
      padGainLinear,
      startTimeMs: typeof padData.startTimeMs === 'number' ? padData.startTimeMs : 0,
      endTimeMs: typeof padData.endTimeMs === 'number' ? padData.endTimeMs : 0,
      fadeInMs: typeof padData.fadeInMs === 'number' ? padData.fadeInMs : 0,
      fadeOutMs: typeof padData.fadeOutMs === 'number' ? padData.fadeOutMs : 0,
      pitch: typeof padData.pitch === 'number' ? padData.pitch : 0,
      tempoPercent: normalizeTempoPercentForRuntime(this.host.getIsIOS(), padData?.tempoPercent),
      keyLock: normalizeKeyLockForRuntime(this.host.getIsIOS(), padData?.keyLock),
      triggerMode: normalizePadTriggerModeValue(padData.triggerMode),
      playbackMode: normalizePadPlaybackModeValue(padData.playbackMode),
      savedHotcuesMs: Array.isArray(padData.savedHotcuesMs)
        ? (padData.savedHotcuesMs.slice(0, 4) as HotcueTuple)
        : [null, null, null, null],
      audioBytes: normalizeAudioBytesValue(padData?.audioBytes),
      audioDurationMs: this.inferAudioDurationMsFromPadData(padData)
    };
  }

  private inferAudioDurationMsFromPadData(padData: any): number | undefined {
    return normalizeDurationMsValue(padData?.audioDurationMs);
  }

  private dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
  }

  private resolvePadGainLinear(gainDbValue: unknown, legacyGainValue: unknown): number {
    if (typeof gainDbValue === 'number' && Number.isFinite(gainDbValue)) {
      const clampedDb = Math.max(-24, Math.min(24, gainDbValue));
      return Math.max(0, this.dbToLinear(clampedDb));
    }

    if (typeof legacyGainValue === 'number' && Number.isFinite(legacyGainValue)) {
      if (legacyGainValue >= 0 && legacyGainValue <= 3) {
        return Math.max(0, legacyGainValue);
      }
      const assumedDb = Math.max(-24, Math.min(24, legacyGainValue));
      return Math.max(0, this.dbToLinear(assumedDb));
    }

    return 1;
  }
}
