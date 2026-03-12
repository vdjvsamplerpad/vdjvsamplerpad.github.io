import {
  executeStop,
  type StopTarget,
} from '../../../lib/audio-engine';
import type { AudioRuntimeStage } from './audioRuntimeStage';
import type {
  HotcueTuple,
  PadPlaybackMode,
  PadTriggerMode,
} from './audioPadNormalization';
import { cloneHotcuesTupleValue } from './audioPadNormalization';
import {
  computeChannelHotcueMaxMs,
  hotcueTupleEqualsValue,
  normalizeChannelHotcuesForWindow,
  serializeChannelHotcuesForSource,
} from './audioHotcueUtils';
import {
  clearDeckStartupProfileState,
  computeDeckPlaybackSample,
  createDeckStartupProfileState,
  hasActiveIOSStartupWindowState,
  resolveDeckEndMs,
  resolveDeckNativeTickIntervalMs,
  resolveDeckStartMs,
  shouldAutoStopDeckAtEnd,
  shouldUseImmediateDeckNotify,
} from './audioChannelPlaybackLoop';
import { computeDeckChannelTargetGainRuntime } from './audioChannelGainUtils';
import {
  getDeckChannelCurrentGainRuntime,
  hardMuteDeckChannelOutputRuntime,
  rampDeckChannelElementVolumeRuntime,
  setDeckChannelGainRuntime,
} from './audioDeckChannelGainRuntime';
import {
  checkHotcueCooldown,
  clampChannelRelativeMs,
  clampDeckChannelCount,
  isValidHotcueSlot,
  resolveChannelHotcueSeekMode,
  resolveChannelSeekMode,
  resolveChannelSeekProfile,
  shouldUseIOSHotcueScheduler,
} from './audioDeckChannelControllerUtils';
import {
  applyLoadedDeckChannelState,
  resetUnloadedDeckChannelState,
  setDeckChannelStoppedState,
} from './audioDeckChannelStateRuntime';
import {
  createInitialChannelPlayAttemptResult,
  executeChannelPlayAttempt,
  resolveExpectedChannelSourceUrl,
  shouldAttemptIOSSourceRehydrate,
  type ChannelPlayAttemptResult,
} from './audioDeckChannelPlayRuntime';
import {
  deriveDeckChannelLoadState,
  shouldReuseLoadedDeckChannelPad,
} from './audioDeckChannelLoadRuntime';
import {
  finalizeDeckChannelPausedState,
  finalizeDeckChannelStoppedState,
  resolveDeckChannelBaselineCurrentTimeMs,
} from './audioDeckChannelStopRuntime';
import {
  buildDeckChannelStopTargetRuntime,
  hasDeckChannelGraphGainPath,
  resolveDeckChannelStartAtSec,
  resolveDeckChannelZeroFadePlan,
} from './audioDeckChannelStopControllerRuntime';
import {
  emitAudioEngineDisabledRuntime,
  emitChannelHotcueDiagRuntime,
  emitChannelPauseDiagRuntime,
  emitChannelPlayDiagRuntime,
  emitChannelSeekDiagRuntime,
  emitChannelStopDiagRuntime,
} from './audioChannelDiagnostics';
import {
  CHANNEL_HOTCUE_TRIGGER_COOLDOWN_MS,
  CHANNEL_IOS_HOTCUE_COALESCE_MS,
  CHANNEL_IOS_HOTCUE_SEEK_DELAY_MS,
  CHANNEL_IOS_HOTCUE_SEEK_FADE_SEC,
  CHANNEL_IOS_STARTUP_BACKWARD_GUARD_BYPASS_MS,
  CHANNEL_IOS_STARTUP_BACKWARD_GUARD_MAX_MS,
  CHANNEL_IOS_STARTUP_BACKWARD_GUARD_WINDOW_MS,
  CHANNEL_IOS_STARTUP_HIGH_RATE_WINDOW_MS,
  CHANNEL_NATIVE_TICK_MS_ANDROID,
  CHANNEL_NATIVE_TICK_MS_DEFAULT,
  CHANNEL_NATIVE_TICK_MS_IOS,
  CHANNEL_PAUSE_FADE_SEC,
  CHANNEL_PAUSE_FINALIZE_DELAY_MS,
  CHANNEL_SEEK_DELAY_MS,
  CHANNEL_SEEK_FADE_SEC,
  CHANNEL_START_RAMP_SEC,
  CHANNEL_STOP_FAST_FADE_SEC,
  CHANNEL_STOP_FAST_FINALIZE_DELAY_MS,
  IS_ANDROID_RUNTIME_ENV,
  IS_CAPACITOR_NATIVE_RUNTIME,
  IS_IOS_RUNTIME_ENV,
} from './audioPlaybackRuntimeTuning';
const MAX_PLAYBACK_CHANNELS = 8;
const IS_IOS_ENV = IS_IOS_RUNTIME_ENV;
const IS_ANDROID_ENV = IS_ANDROID_RUNTIME_ENV;
const IS_CAPACITOR_NATIVE = IS_CAPACITOR_NATIVE_RUNTIME;

export type StopMode = 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter';

interface StopTimingProfile {
  volumeSmoothingSec: number;
}

export interface DeckLoadedPadRef {
  bankId: string;
  padId: string;
}

export interface DeckLayoutSnapshotEntry {
  channelId: number;
  loadedPadRef: DeckLoadedPadRef | null;
  hotcuesMs: HotcueTuple;
  collapsed: boolean;
  channelVolume: number;
  positionMs: number;
  wasPlaying: boolean;
  savedAt: number;
}

export interface DeckPadSnapshot {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  color: string;
  audioUrl: string;
  volume: number;
  padGainLinear: number;
  startTimeMs: number;
  endTimeMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  pitch: number;
  tempoPercent: number;
  keyLock: boolean;
  triggerMode: PadTriggerMode;
  playbackMode: PadPlaybackMode;
  savedHotcuesMs: HotcueTuple;
  audioBytes?: number;
  audioDurationMs?: number;
}

interface DeckChannelRuntime {
  channelId: number;
  channelVolume: number;
  loadedPadRef: DeckLoadedPadRef | null;
  pad: DeckPadSnapshot | null;
  iosRecoveredSourceUrl: string | null;
  iosSourceRecoverySourceUrl: string | null;
  iosSourceRecoveryPromise: Promise<boolean> | null;
  audioElement: HTMLAudioElement | null;
  sourceNode: MediaElementAudioSourceNode | null;
  sourceConnected: boolean;
  gainNode: GainNode | null;
  graphConnected: boolean;
  pendingInitialSeekSec: number | null;
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
  durationMs: number;
  hotcuesMs: HotcueTuple;
  hasLocalHotcueOverride: boolean;
  collapsed: boolean;
  waveformKey: string | null;
  stopCancel: (() => void) | null;
  volumeRampTimer: NodeJS.Timeout | null;
  seekRampTimer: NodeJS.Timeout | null;
  commandToken: number;
  startupHighRateUntilMs: number;
  startupBackwardGuardUntilMs: number;
  playheadGuardBypassUntilMs: number;
}

export interface DeckChannelState {
  channelId: number;
  channelVolume: number;
  loadedPadRef: DeckLoadedPadRef | null;
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
  durationMs: number;
  hotcuesMs: HotcueTuple;
  hasLocalHotcueOverride: boolean;
  collapsed: boolean;
  waveformKey: string | null;
  pad: {
    padId: string;
    padName: string;
    bankId: string;
    bankName: string;
    audioUrl?: string;
    color: string;
    volume: number;
    effectiveVolume: number;
    currentMs: number;
    endMs: number;
    playStartTime: number;
    channelId?: number | null;
  } | null;
}

interface AudioDeckRuntimeHost {
  getRegisteredPads(): Map<string, DeckPadSnapshot>;
  getIsIOS(): boolean;
  getIsAndroid(): boolean;
  getAudioRuntimeStage(): AudioRuntimeStage;
  getAudioContext(): AudioContext | null;
  getSharedIOSGainNode(): GainNode | null;
  getGlobalMuted(): boolean;
  getMasterVolume(): number;
  getContextUnlocked(): boolean;
  getNowMs(): number;
  getProgramHeadroomGain(): number;
  getStopTimingProfile(): StopTimingProfile;
  initializeAudioContext(): void;
  setupSharedIOSNodes(): void;
  disablePitchPreservation(audio: HTMLAudioElement): void;
  preUnlockAudio(): Promise<void>;
  notifyStateChange(immediate?: boolean): void;
  refreshRuntimeMixLevels(): void;
  emitAudioRuntimeStageInfo(action?: string): void;
  setChannelRuntimeDiag(
    action: 'none' | 'play' | 'pause' | 'stop' | 'seek' | 'ended',
    channelId: number | null,
    token: number
  ): void;
}

export class AudioDeckRuntime {
  private channelVolumes: Map<number, number> = new Map();
  private deckChannels: Map<number, DeckChannelRuntime> = new Map();
  private deckChannelCount = 4;
  private waveformCacheRefs: Map<string, number> = new Map();
  private deckPlaybackRafId: number | null = null;
  private deckPlaybackIntervalId: NodeJS.Timeout | null = null;
  private deckStartupRafId: number | null = null;
  private hotcueTriggerCooldownMs = CHANNEL_HOTCUE_TRIGGER_COOLDOWN_MS;
  private lastHotcueTriggerAt: Map<string, number> = new Map();
  private pendingHotcueSlotByChannel: Map<number, number> = new Map();
  private pendingHotcueTimerByChannel: Map<number, ReturnType<typeof setTimeout>> = new Map();

  constructor(private readonly host: AudioDeckRuntimeHost) {}

  private get registeredPads(): Map<string, DeckPadSnapshot> {
    return this.host.getRegisteredPads();
  }

  private get isIOS(): boolean {
    return this.host.getIsIOS();
  }

  private get isAndroid(): boolean {
    return this.host.getIsAndroid();
  }

  private get audioRuntimeStage(): AudioRuntimeStage {
    return this.host.getAudioRuntimeStage();
  }

  private get audioContext(): AudioContext | null {
    return this.host.getAudioContext();
  }

  private get sharedIOSGainNode(): GainNode | null {
    return this.host.getSharedIOSGainNode();
  }

  private get globalMuted(): boolean {
    return this.host.getGlobalMuted();
  }

  private get masterVolume(): number {
    return this.host.getMasterVolume();
  }

  private get contextUnlocked(): boolean {
    return this.host.getContextUnlocked();
  }

  private getNowMs(): number {
    return this.host.getNowMs();
  }

  private notifyStateChange(immediate: boolean = false): void {
    this.host.notifyStateChange(immediate);
  }

  private getProgramHeadroomGain(): number {
    return this.host.getProgramHeadroomGain();
  }

  private getStopTimingProfile(): StopTimingProfile {
    return this.host.getStopTimingProfile();
  }

  ensureInitialChannels(): void {
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      this.ensureDeckChannelRuntime(i);
    }
  }

  connectLoadedChannelsToSharedIOSGraph(): void {
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel?.audioElement) continue;
      this.ensureDeckChannelAudioGraph(channel);
    }
  }

  syncAllChannelVolumes(): void {
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (channel) this.syncDeckChannelVolume(channel);
    }
  }

  getActivePlayingChannelCount(): number {
    let count = 0;
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (channel?.isPlaying) count += 1;
    }
    return count;
  }

  stopAllChannels(mode: StopMode = 'instant'): void {
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      this.stopChannel(i, mode);
    }
  }

  unloadChannelsForPad(padId: string): void {
    this.deckChannels.forEach((channel) => {
      if (channel.loadedPadRef?.padId !== padId) return;
      this.unloadChannel(channel.channelId);
    });
  }

  syncLoadedChannelHotcuesFromRegisteredPad(padId: string): boolean {
    const registered = this.registeredPads.get(padId);
    if (!registered) return false;
    let changed = false;
    this.deckChannels.forEach((channel) => {
      if (channel.loadedPadRef?.padId !== padId) return;
      if (!channel.pad) return;
      if (channel.hasLocalHotcueOverride) return;
      channel.pad.savedHotcuesMs = cloneHotcuesTupleValue(registered.savedHotcuesMs);
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      const sourceDurationMs = Number.isFinite(channel.pad?.audioDurationMs)
        ? Math.max(0, Number(channel.pad?.audioDurationMs))
        : 0;
      const maxMs = computeChannelHotcueMaxMs(start, end, sourceDurationMs);
      const next = normalizeChannelHotcuesForWindow(registered.savedHotcuesMs, start, maxMs);
      if (hotcueTupleEqualsValue(channel.hotcuesMs, next)) return;
      channel.hotcuesMs = next;
      changed = true;
    });
    return changed;
  }

  private buildChannelPadSnapshot(source: DeckPadSnapshot): DeckPadSnapshot {
    // Channels intentionally ignore pad trim and always use the full source region.
    const safeStartTimeMs = 0;
    const safeEndTimeMs = 0;
    const safeAudioDurationMs = Number.isFinite(source.audioDurationMs)
      ? Math.max(0, Number(source.audioDurationMs))
      : Math.max(
        Number.isFinite(source.endTimeMs) ? Math.max(0, Number(source.endTimeMs)) : 0,
        Number.isFinite(source.startTimeMs) ? Math.max(0, Number(source.startTimeMs)) : 0
      );
    const snapshot: DeckPadSnapshot = {
      ...source,
      padGainLinear: Number.isFinite(source.padGainLinear) ? source.padGainLinear : 1,
      savedHotcuesMs: cloneHotcuesTupleValue(source.savedHotcuesMs),
      startTimeMs: safeStartTimeMs,
      endTimeMs: safeEndTimeMs,
      audioDurationMs: safeAudioDurationMs > 0 ? safeAudioDurationMs : undefined,
    };
    return {
      ...snapshot,
      fadeInMs: 0,
      fadeOutMs: 0,
      pitch: 0,
      tempoPercent: 0,
      keyLock: false
    };
  }

  private ensureDeckChannelRuntime(channelId: number): DeckChannelRuntime | null {
    if (!Number.isFinite(channelId)) return null;
    if (channelId < 1 || channelId > MAX_PLAYBACK_CHANNELS) return null;
    const existing = this.deckChannels.get(channelId);
    if (existing) {
      if (!this.channelVolumes.has(channelId)) {
        this.channelVolumes.set(channelId, existing.channelVolume);
      }
      return existing;
    }

    const runtime: DeckChannelRuntime = {
      channelId,
      channelVolume: this.channelVolumes.get(channelId) ?? 1,
      loadedPadRef: null,
      pad: null,
      iosRecoveredSourceUrl: null,
      iosSourceRecoverySourceUrl: null,
      iosSourceRecoveryPromise: null,
      audioElement: null,
      sourceNode: null,
      sourceConnected: false,
      gainNode: null,
      graphConnected: false,
      pendingInitialSeekSec: null,
      isPlaying: false,
      isPaused: false,
      playheadMs: 0,
      durationMs: 0,
      hotcuesMs: [null, null, null, null],
      hasLocalHotcueOverride: false,
      collapsed: true,
      waveformKey: null,
      stopCancel: null,
      volumeRampTimer: null,
      seekRampTimer: null,
      commandToken: 0,
      startupHighRateUntilMs: 0,
      startupBackwardGuardUntilMs: 0,
      playheadGuardBypassUntilMs: 0
    };
    this.channelVolumes.set(channelId, runtime.channelVolume);
    this.deckChannels.set(channelId, runtime);
    return runtime;
  }

  private getDeckChannel(channelId: number): DeckChannelRuntime | null {
    if (!Number.isFinite(channelId)) return null;
    if (channelId < 1 || channelId > MAX_PLAYBACK_CHANNELS) return null;
    return this.deckChannels.get(channelId) || null;
  }

  private getDeckStartMs(channel: DeckChannelRuntime): number {
    return resolveDeckStartMs(channel.pad?.startTimeMs);
  }

  private getDeckEndMs(channel: DeckChannelRuntime): number {
    return resolveDeckEndMs({
      startTimeMs: channel.pad?.startTimeMs,
      endTimeMs: channel.pad?.endTimeMs,
      durationMs: channel.durationMs,
    });
  }

  private nextDeckChannelCommandToken(channel: DeckChannelRuntime): number {
    channel.commandToken += 1;
    return channel.commandToken;
  }

  private isDeckChannelCommandTokenCurrent(channel: DeckChannelRuntime, token: number): boolean {
    return channel.commandToken === token;
  }

  private runDeckPlaybackTick(): boolean {
    let hasPlayingChannel = false;
    const nowMs = this.getNowMs();
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel?.audioElement || !channel.pad || !channel.isPlaying) continue;

      hasPlayingChannel = true;
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      const playbackSample = computeDeckPlaybackSample({
        isIOS: this.isIOS,
        nowMs,
        startupBackwardGuardUntilMs: channel.startupBackwardGuardUntilMs,
        playheadGuardBypassUntilMs: channel.playheadGuardBypassUntilMs,
        previousPlayheadMs: channel.playheadMs,
        backwardGuardMaxMs: CHANNEL_IOS_STARTUP_BACKWARD_GUARD_MAX_MS,
        currentTimeSec: channel.audioElement.currentTime,
        startMs: start,
        endMs: end,
      });

      channel.playheadMs = playbackSample.nextPlayheadMs;

      if (playbackSample.reachedEnd && shouldAutoStopDeckAtEnd(channel.pad.playbackMode)) {
        this.stopDeckChannelClickSafeInstant(channel, 'auto_end');
      }
    }

    if (hasPlayingChannel) {
      const immediate = shouldUseImmediateDeckNotify({
        isCapacitorNative: IS_CAPACITOR_NATIVE,
        isIOS: IS_IOS_ENV,
        isAndroid: IS_ANDROID_ENV,
      });
      this.notifyStateChange(immediate);
    }
    return hasPlayingChannel;
  }

  private hasActiveIOSDeckStartupWindow(nowMs: number): boolean {
    if (!this.isIOS) return false;
    const channels: Array<{ isPlaying: boolean; startupHighRateUntilMs: number }> = [];
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      channels.push({
        isPlaying: channel.isPlaying,
        startupHighRateUntilMs: channel.startupHighRateUntilMs,
      });
    }
    return hasActiveIOSStartupWindowState(channels, nowMs);
  }

  private startDeckStartupLoopIfNeeded(): void {
    if (!this.isIOS || !IS_CAPACITOR_NATIVE) return;
    if (this.deckStartupRafId !== null) return;
    if (!this.hasActiveIOSDeckStartupWindow(this.getNowMs())) return;
    const tick = () => {
      this.deckStartupRafId = null;
      const hasPlayingChannel = this.runDeckPlaybackTick();
      const nowMs = this.getNowMs();
      if (hasPlayingChannel && this.hasActiveIOSDeckStartupWindow(nowMs)) {
        this.deckStartupRafId = requestAnimationFrame(tick);
      }
    };
    this.deckStartupRafId = requestAnimationFrame(tick);
  }

  private beginDeckChannelStartupProfile(channel: DeckChannelRuntime): void {
    const profile = createDeckStartupProfileState({
      nowMs: this.getNowMs(),
      highRateWindowMs: CHANNEL_IOS_STARTUP_HIGH_RATE_WINDOW_MS,
      backwardGuardWindowMs: CHANNEL_IOS_STARTUP_BACKWARD_GUARD_WINDOW_MS,
    });
    channel.startupHighRateUntilMs = profile.startupHighRateUntilMs;
    channel.startupBackwardGuardUntilMs = profile.startupBackwardGuardUntilMs;
    channel.playheadGuardBypassUntilMs = profile.playheadGuardBypassUntilMs;
  }

  private clearDeckChannelStartupProfile(channel: DeckChannelRuntime): void {
    const profile = clearDeckStartupProfileState();
    channel.startupHighRateUntilMs = profile.startupHighRateUntilMs;
    channel.startupBackwardGuardUntilMs = profile.startupBackwardGuardUntilMs;
    channel.playheadGuardBypassUntilMs = profile.playheadGuardBypassUntilMs;
  }

  private startDeckPlaybackLoop(): void {
    if (IS_CAPACITOR_NATIVE) {
      if (this.deckPlaybackIntervalId !== null) return;
      const intervalMs = resolveDeckNativeTickIntervalMs({
        isIOS: this.isIOS,
        isAndroid: this.isAndroid,
        iosMs: CHANNEL_NATIVE_TICK_MS_IOS,
        androidMs: CHANNEL_NATIVE_TICK_MS_ANDROID,
        defaultMs: CHANNEL_NATIVE_TICK_MS_DEFAULT,
      });
      this.deckPlaybackIntervalId = setInterval(() => {
        const hasPlayingChannel = this.runDeckPlaybackTick();
        if (!hasPlayingChannel) {
          this.stopDeckPlaybackLoopIfIdle();
        }
      }, intervalMs);
      return;
    }

    if (this.deckPlaybackRafId !== null) return;
    const tick = () => {
      this.deckPlaybackRafId = null;
      const hasPlayingChannel = this.runDeckPlaybackTick();
      if (hasPlayingChannel) {
        this.deckPlaybackRafId = requestAnimationFrame(tick);
      }
    };
    this.deckPlaybackRafId = requestAnimationFrame(tick);
  }

  private stopDeckPlaybackLoopIfIdle(): void {
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (channel?.isPlaying) return;
    }
    if (this.deckPlaybackRafId !== null) {
      cancelAnimationFrame(this.deckPlaybackRafId);
      this.deckPlaybackRafId = null;
    }
    if (this.deckPlaybackIntervalId !== null) {
      clearInterval(this.deckPlaybackIntervalId);
      this.deckPlaybackIntervalId = null;
    }
    if (this.deckStartupRafId !== null) {
      cancelAnimationFrame(this.deckStartupRafId);
      this.deckStartupRafId = null;
    }
  }

  private clearDeckChannelSeekTimer(channel: DeckChannelRuntime): void {
    if (channel.seekRampTimer) {
      clearTimeout(channel.seekRampTimer);
      channel.seekRampTimer = null;
    }
  }

  private clearPendingChannelHotcue(channelId: number): void {
    const timer = this.pendingHotcueTimerByChannel.get(channelId);
    if (timer) {
      clearTimeout(timer);
      this.pendingHotcueTimerByChannel.delete(channelId);
    }
    this.pendingHotcueSlotByChannel.delete(channelId);
  }

  private scheduleIOSChannelHotcue(channelId: number, slotIndex: number): void {
    this.pendingHotcueSlotByChannel.set(channelId, slotIndex);
    if (this.pendingHotcueTimerByChannel.has(channelId)) {
      const channel = this.getDeckChannel(channelId);
      if (channel) {
        emitChannelHotcueDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'trigger_coalesced', {
          slotIndex,
          windowMs: CHANNEL_IOS_HOTCUE_COALESCE_MS
        });
      }
      return;
    }

    const timer = setTimeout(() => {
      this.pendingHotcueTimerByChannel.delete(channelId);
      const pendingSlot = this.pendingHotcueSlotByChannel.get(channelId);
      this.pendingHotcueSlotByChannel.delete(channelId);
      if (typeof pendingSlot === 'number') {
        this.triggerChannelHotcueNow(channelId, pendingSlot);
      }
    }, CHANNEL_IOS_HOTCUE_COALESCE_MS);

    this.pendingHotcueTimerByChannel.set(channelId, timer);
  }

  private setDeckChannelCurrentTimeSafe(channel: DeckChannelRuntime, nextSec: number): void {
    const audio = channel.audioElement;
    if (!audio) return;
    const safeSec = Math.max(0, nextSec);
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      try {
        audio.currentTime = safeSec;
        channel.pendingInitialSeekSec = null;
        return;
      } catch {}
    }
    channel.pendingInitialSeekSec = safeSec;
  }

  private ensureDeckChannelAudioGraph(channel: DeckChannelRuntime): void {
    if (!channel.audioElement) return;
    if (!this.audioContext) this.host.initializeAudioContext();
    if (!this.audioContext) return;

    if (this.isIOS && !this.sharedIOSGainNode) {
      this.host.setupSharedIOSNodes();
      if (!this.sharedIOSGainNode) return;
    }

    try {
      if (!channel.gainNode) {
        channel.gainNode = this.audioContext.createGain();
      }
      if (!channel.sourceNode) {
        channel.sourceNode = this.audioContext.createMediaElementSource(channel.audioElement);
      }
      if (!channel.sourceConnected && channel.sourceNode) {
        channel.sourceNode.connect(channel.gainNode!);
        if (this.isIOS && this.sharedIOSGainNode) {
          channel.gainNode!.connect(this.sharedIOSGainNode);
        } else {
          channel.gainNode!.connect(this.audioContext.destination);
        }
        channel.sourceConnected = true;
      }
      channel.graphConnected = true;
      channel.audioElement.muted = false;
      channel.audioElement.volume = 1.0;
      this.syncDeckChannelVolume(channel);
    } catch {
      channel.graphConnected = false;
    }
  }

  private disconnectDeckChannelAudioGraph(channel: DeckChannelRuntime): void {
    if (channel.volumeRampTimer) {
      clearInterval(channel.volumeRampTimer);
      channel.volumeRampTimer = null;
    }
    try {
      channel.sourceNode?.disconnect();
    } catch {}
    try {
      channel.gainNode?.disconnect();
    } catch {}
    channel.sourceNode = null;
    channel.sourceConnected = false;
    channel.gainNode = null;
    channel.graphConnected = false;
    channel.pendingInitialSeekSec = null;
  }

  private rampDownDeckChannelOutputIOS(
    channel: DeckChannelRuntime,
    durationSec: number,
    onDone: () => void
  ): () => void {
    let cancelled = false;
    let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
    const safeDone = () => {
      if (cancelled) return;
      cancelled = true;
      if (finalizeTimer) {
        clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }
      onDone();
    };

    try {
      if (this.audioContext && channel.gainNode && channel.graphConnected) {
        const now = this.audioContext.currentTime;
        const currentGain = Math.max(
          0,
          Number.isFinite(channel.gainNode.gain.value)
            ? channel.gainNode.gain.value
            : computeDeckChannelTargetGainRuntime({
              channel,
              globalMuted: this.globalMuted,
              headroom: this.getProgramHeadroomGain(),
              masterVolume: this.masterVolume,
              isIOS: this.isIOS,
              hasSharedIOSGain: Boolean(this.sharedIOSGainNode),
            })
        );
        channel.gainNode.gain.cancelScheduledValues(now);
        channel.gainNode.gain.setValueAtTime(currentGain, now);
        channel.gainNode.gain.linearRampToValueAtTime(0, now + durationSec);
        finalizeTimer = setTimeout(safeDone, Math.ceil(durationSec * 1000) + 4);
      } else if (channel.audioElement) {
        rampDeckChannelElementVolumeRuntime({
          channel,
          targetGain: 0,
          durationSec,
          getNowMs: () => this.getNowMs(),
          onComplete: safeDone,
        });
      } else {
        safeDone();
      }
    } catch {
      hardMuteDeckChannelOutputRuntime({
        channel,
        audioContext: this.audioContext,
      });
      safeDone();
    }

    return () => {
      cancelled = true;
      if (finalizeTimer) {
        clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }
      if (channel.volumeRampTimer) {
        clearInterval(channel.volumeRampTimer);
        channel.volumeRampTimer = null;
      }
    };
  }

  private syncDeckChannelVolume(channel: DeckChannelRuntime): void {
    if (!channel.audioElement || !channel.pad) return;
    const next = computeDeckChannelTargetGainRuntime({
      channel,
      globalMuted: this.globalMuted,
      headroom: this.getProgramHeadroomGain(),
      masterVolume: this.masterVolume,
      isIOS: this.isIOS,
      hasSharedIOSGain: Boolean(this.sharedIOSGainNode),
    });
    const timing = this.getStopTimingProfile();
    setDeckChannelGainRuntime({
      channel,
      audioContext: this.audioContext,
      targetGain: next,
      immediate: false,
      volumeSmoothingSec: timing.volumeSmoothingSec,
    });
  }

  private releaseWaveformRef(channel: DeckChannelRuntime): void {
    if (!channel.waveformKey) return;
    const key = channel.waveformKey;
    const count = this.waveformCacheRefs.get(key) || 0;
    if (count <= 1) this.waveformCacheRefs.delete(key);
    else this.waveformCacheRefs.set(key, count - 1);
    channel.waveformKey = null;
  }

  private retainWaveformRef(channel: DeckChannelRuntime, key: string): void {
    this.releaseWaveformRef(channel);
    channel.waveformKey = key;
    this.waveformCacheRefs.set(key, (this.waveformCacheRefs.get(key) || 0) + 1);
  }

  private revokeChannelRecoveredSource(channel: DeckChannelRuntime): void {
    channel.iosSourceRecoveryPromise = null;
    channel.iosSourceRecoverySourceUrl = null;
    if (!channel.iosRecoveredSourceUrl) return;
    try {
      URL.revokeObjectURL(channel.iosRecoveredSourceUrl);
    } catch {}
    channel.iosRecoveredSourceUrl = null;
  }

  private inferAudioMimeFromBytes(buffer: ArrayBuffer, fallbackUrl: string): string | null {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 12) {
      if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
      ) return 'audio/wav';
      if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
      if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'audio/flac';
      if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'audio/mp4';
      if (
        (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
      ) return 'audio/mpeg';
    }
    const lower = fallbackUrl.toLowerCase();
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
    if (lower.endsWith('.flac')) return 'audio/flac';
    if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    return null;
  }

  private async tryRecoverChannelSourceForIOS(
    channel: DeckChannelRuntime,
    options?: { expectedSourceUrl?: string }
  ): Promise<boolean> {
    if (!this.isIOS || !channel.audioElement || !channel.pad) return false;
    const audio = channel.audioElement;
    const currentSrc = audio.currentSrc || audio.src || channel.pad.audioUrl;
    if (!currentSrc) return false;
    const expectedSourceUrl = options?.expectedSourceUrl;
    if (expectedSourceUrl && currentSrc !== expectedSourceUrl && channel.pad.audioUrl !== expectedSourceUrl) return false;
    if (channel.iosRecoveredSourceUrl && currentSrc === channel.iosRecoveredSourceUrl) return false;

    try {
      const response = await fetch(currentSrc);
      if (!response.ok) return false;
      const sourceBlob = await response.blob();
      const sourceBuffer = await sourceBlob.arrayBuffer();
      const inferredMime = this.inferAudioMimeFromBytes(sourceBuffer, currentSrc);
      const effectiveMime =
        sourceBlob.type && sourceBlob.type !== 'application/octet-stream'
          ? sourceBlob.type
          : inferredMime;
      if (!effectiveMime) return false;

      const normalizedBlob =
        sourceBlob.type === effectiveMime
          ? sourceBlob
          : new Blob([sourceBuffer], { type: effectiveMime });
      const recoveredUrl = URL.createObjectURL(normalizedBlob);

      if (!channel.pad || channel.audioElement !== audio) {
        URL.revokeObjectURL(recoveredUrl);
        return false;
      }
      const liveSrc = audio.currentSrc || audio.src || channel.pad.audioUrl || '';
      if (expectedSourceUrl && liveSrc !== expectedSourceUrl && channel.pad.audioUrl !== expectedSourceUrl) {
        URL.revokeObjectURL(recoveredUrl);
        return false;
      }

      this.revokeChannelRecoveredSource(channel);
      channel.iosRecoveredSourceUrl = recoveredUrl;
      try {
        audio.pause();
      } catch {}
      audio.src = recoveredUrl;
      channel.pendingInitialSeekSec = (channel.pad.startTimeMs || 0) / 1000;
      audio.load();
      return true;
    } catch {
      return false;
    }
  }

  private prewarmDeckChannelSourceForIOS(channel: DeckChannelRuntime): void {
    if (!this.isIOS || !channel.audioElement || !channel.pad) return;
    const audio = channel.audioElement;
    const sourceUrl = audio.currentSrc || audio.src || channel.pad.audioUrl || '';
    if (!sourceUrl.startsWith('blob:')) {
      channel.iosSourceRecoveryPromise = null;
      channel.iosSourceRecoverySourceUrl = null;
      return;
    }
    if (channel.iosRecoveredSourceUrl && sourceUrl === channel.iosRecoveredSourceUrl) return;
    if (channel.iosSourceRecoveryPromise && channel.iosSourceRecoverySourceUrl === sourceUrl) return;

    channel.iosSourceRecoverySourceUrl = sourceUrl;
    const recoveryPromise = this.tryRecoverChannelSourceForIOS(channel, { expectedSourceUrl: sourceUrl })
      .catch(() => false)
      .finally(() => {
        if (channel.iosSourceRecoveryPromise === recoveryPromise) {
          channel.iosSourceRecoveryPromise = null;
        }
      });
    channel.iosSourceRecoveryPromise = recoveryPromise;
  }

  private createDeckAudioElement(channel: DeckChannelRuntime): void {
    if (!channel.pad) return;
    this.revokeChannelRecoveredSource(channel);
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    (audio as any).playsInline = true;
    audio.preload = IS_CAPACITOR_NATIVE ? 'metadata' : 'auto';
    audio.loop = channel.pad.playbackMode === 'loop';
    audio.playbackRate = Math.pow(2, (channel.pad.pitch || 0) / 12);
    this.host.disablePitchPreservation(audio);
    channel.pendingInitialSeekSec = (channel.pad.startTimeMs || 0) / 1000;
    this.disconnectDeckChannelAudioGraph(channel);
    audio.src = channel.pad.audioUrl;

    audio.addEventListener('loadedmetadata', () => {
      if (!channel.pad) return;
      if (channel.pendingInitialSeekSec !== null) {
        this.setDeckChannelCurrentTimeSafe(channel, channel.pendingInitialSeekSec);
      }
      const fullMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      const regionEnd = channel.pad.endTimeMs > channel.pad.startTimeMs ? channel.pad.endTimeMs : fullMs;
      channel.durationMs = Math.max(channel.pad.startTimeMs, regionEnd);
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      const sourceDurationMs = Number.isFinite(channel.pad?.audioDurationMs)
        ? Math.max(0, Number(channel.pad?.audioDurationMs))
        : 0;
      const maxMs = computeChannelHotcueMaxMs(start, end, sourceDurationMs);
      channel.hotcuesMs = normalizeChannelHotcuesForWindow(channel.hotcuesMs, start, maxMs);
      this.notifyStateChange(true);
    });

    audio.addEventListener('timeupdate', () => {
      if (!channel.pad || !channel.isPlaying) return;
      if (this.isIOS) return;
      const nowAbsMs = audio.currentTime * 1000;
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      channel.playheadMs = Math.max(0, Math.min(Math.max(0, end - start), nowAbsMs - start));
      if (end > start && nowAbsMs >= end && shouldAutoStopDeckAtEnd(channel.pad.playbackMode)) {
        this.stopDeckChannelClickSafeInstant(channel, 'auto_end');
      }
    });

    audio.addEventListener('ended', () => {
      setDeckChannelStoppedState(channel);
      this.clearDeckChannelStartupProfile(channel);
      this.host.setChannelRuntimeDiag('ended', channel.channelId, channel.commandToken);
      if (channel.pad && channel.audioElement) {
        this.setDeckChannelCurrentTimeSafe(channel, (channel.pad.startTimeMs || 0) / 1000);
      }
      this.host.refreshRuntimeMixLevels();
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange(true);
    });

    channel.audioElement = audio;
    this.ensureDeckChannelAudioGraph(channel);
    this.syncDeckChannelVolume(channel);
    this.prewarmDeckChannelSourceForIOS(channel);
  }

  private stopDeckChannelClickSafeInstant(
    channel: DeckChannelRuntime,
    origin: 'user_stop' | 'auto_end' | 'internal' = 'internal'
  ): void {
    this.clearDeckChannelSeekTimer(channel);
    const commandToken = this.nextDeckChannelCommandToken(channel);
    const stopIssuedAtMs = this.getNowMs();
    this.host.setChannelRuntimeDiag('stop', channel.channelId, commandToken);
    emitChannelStopDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'command', stopIssuedAtMs, undefined, undefined, { origin });
    const audio = channel.audioElement;
    const pad = channel.pad;
    if (channel.stopCancel) {
      channel.stopCancel();
      channel.stopCancel = null;
    }

    const finalizeStop = () => {
      if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
      try {
        audio?.pause();
      } catch {}
      if (pad && channel.audioElement) {
        this.setDeckChannelCurrentTimeSafe(channel, (pad.startTimeMs || 0) / 1000);
        channel.audioElement.playbackRate = Math.pow(2, (pad.pitch || 0) / 12);
      }
      finalizeDeckChannelStoppedState(channel);
      this.clearDeckChannelStartupProfile(channel);
      this.syncDeckChannelVolume(channel);
      this.host.refreshRuntimeMixLevels();
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange();

      const finalizedAtMs = this.getNowMs();
      const baselineCurrentTimeMs = resolveDeckChannelBaselineCurrentTimeMs(channel.audioElement);
      emitChannelStopDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'finalize', stopIssuedAtMs, finalizedAtMs, baselineCurrentTimeMs, { origin, reason: 'normal' });
      if (typeof window !== 'undefined' && typeof baselineCurrentTimeMs === 'number') {
        window.setTimeout(() => {
          if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
          emitChannelStopDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'guard', stopIssuedAtMs, finalizedAtMs, baselineCurrentTimeMs, { origin });
        }, 30);
      }
    };

    if (!audio || !pad) {
      finalizeDeckChannelStoppedState(channel);
      this.clearDeckChannelStartupProfile(channel);
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange();
      emitChannelStopDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'finalize', stopIssuedAtMs, this.getNowMs(), undefined, { origin, reason: 'missing_audio_or_pad' });
      return;
    }

    const stopPlan = resolveDeckChannelZeroFadePlan({
      isIOS: this.isIOS,
      hasAudioElement: Boolean(channel.audioElement),
      hasGraphGainPath: hasDeckChannelGraphGainPath(this.audioContext, channel.gainNode, channel.graphConnected),
    });

    if (stopPlan === 'ios') {
      channel.stopCancel = this.rampDownDeckChannelOutputIOS(channel, CHANNEL_STOP_FAST_FADE_SEC, () => {
        hardMuteDeckChannelOutputRuntime({ channel, audioContext: this.audioContext });
        finalizeStop();
      });
      return;
    }

    if (stopPlan === 'graph') {
      const now = this.audioContext!.currentTime;
      const currentGain = Math.max(0, Number.isFinite(channel.gainNode!.gain.value) ? channel.gainNode!.gain.value : 0);
      channel.gainNode!.gain.cancelScheduledValues(now);
      channel.gainNode!.gain.setValueAtTime(currentGain, now);
      channel.gainNode!.gain.linearRampToValueAtTime(0, now + CHANNEL_STOP_FAST_FADE_SEC);
      setTimeout(finalizeStop, CHANNEL_STOP_FAST_FINALIZE_DELAY_MS);
      return;
    }

    if (stopPlan === 'element') {
      rampDeckChannelElementVolumeRuntime({
        channel,
        targetGain: 0,
        durationSec: CHANNEL_STOP_FAST_FADE_SEC,
        getNowMs: () => this.getNowMs(),
        onComplete: finalizeStop,
      });
      return;
    }

    finalizeStop();
  }

  private stopDeckChannelInternal(channel: DeckChannelRuntime, mode: StopMode = 'instant'): void {
    this.clearDeckChannelSeekTimer(channel);
    const commandToken = this.nextDeckChannelCommandToken(channel);
    this.host.setChannelRuntimeDiag('stop', channel.channelId, commandToken);
    const audio = channel.audioElement;
    const pad = channel.pad;
    if (channel.stopCancel) {
      channel.stopCancel();
      channel.stopCancel = null;
    }
    if (!audio || !pad) {
      finalizeDeckChannelStoppedState(channel);
      this.clearDeckChannelStartupProfile(channel);
      this.stopDeckPlaybackLoopIfIdle();
      return;
    }

    const startAtSec = resolveDeckChannelStartAtSec(pad.startTimeMs);
    let finalized = false;
    const finalizeStop = () => {
      if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken) || finalized) return;
      finalized = true;
      try {
        audio.pause();
        this.setDeckChannelCurrentTimeSafe(channel, startAtSec);
        audio.playbackRate = Math.pow(2, (pad.pitch || 0) / 12);
      } catch {}
      finalizeDeckChannelStoppedState(channel);
      this.clearDeckChannelStartupProfile(channel);
      this.syncDeckChannelVolume(channel);
      this.host.refreshRuntimeMixLevels();
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange();
    };

    if (resolveDeckChannelZeroFadePlan({
      isIOS: this.isIOS,
      hasAudioElement: Boolean(channel.audioElement),
      hasGraphGainPath: hasDeckChannelGraphGainPath(this.audioContext, channel.gainNode, channel.graphConnected),
    }) === 'ios') {
      channel.stopCancel = this.rampDownDeckChannelOutputIOS(channel, CHANNEL_STOP_FAST_FADE_SEC, () => {
        hardMuteDeckChannelOutputRuntime({ channel, audioContext: this.audioContext });
        finalizeStop();
      });
      return;
    }

    const timing = this.getStopTimingProfile();
    const stopTarget: StopTarget = buildDeckChannelStopTargetRuntime({
      audioElement: audio,
      audioContext: this.audioContext,
      gainNode: channel.gainNode,
      graphConnected: channel.graphConnected,
      getCurrentGain: () => getDeckChannelCurrentGainRuntime(channel),
      setElementRamp: (targetGain, durationSec) => {
        rampDeckChannelElementVolumeRuntime({ channel, targetGain, durationSec, getNowMs: () => this.getNowMs() });
      },
      setImmediateGain: (targetGain) => {
        setDeckChannelGainRuntime({
          channel,
          audioContext: this.audioContext,
          targetGain,
          immediate: true,
          volumeSmoothingSec: timing.volumeSmoothingSec,
        });
      },
      onFinalize: finalizeStop,
      isActive: () => channel.isPlaying && !audio.paused,
    });

    channel.stopCancel = executeStop(stopTarget, mode, this.audioContext ?? undefined);
  }

  loadPadToChannel(channelId: number, padId: string): boolean {
    if (channelId < 1 || channelId > this.deckChannelCount) return false;
    const channel = this.getDeckChannel(channelId) || this.ensureDeckChannelRuntime(channelId);
    if (!channel) return false;
    this.clearDeckChannelSeekTimer(channel);
    this.clearPendingChannelHotcue(channelId);
    const pad = this.registeredPads.get(padId);
    if (!pad || !pad.audioUrl) return false;
    if (shouldReuseLoadedDeckChannelPad(channel.loadedPadRef, pad.bankId, padId)) return true;

    this.stopDeckChannelInternal(channel, 'instant');
    if (channel.stopCancel) {
      channel.stopCancel();
      channel.stopCancel = null;
    }
    if (channel.audioElement) {
      try {
        channel.audioElement.pause();
        channel.audioElement.src = '';
      } catch {}
    }
    this.revokeChannelRecoveredSource(channel);
    this.disconnectDeckChannelAudioGraph(channel);
    this.releaseWaveformRef(channel);

    const nextPad = this.buildChannelPadSnapshot(pad);
    this.clearDeckChannelStartupProfile(channel);
    const derived = deriveDeckChannelLoadState({
      bankId: pad.bankId,
      padId: pad.padId,
      audioUrl: pad.audioUrl,
      startTimeMs: nextPad.startTimeMs,
      endTimeMs: nextPad.endTimeMs,
      audioDurationMs: nextPad.audioDurationMs,
      savedHotcuesMs: nextPad.savedHotcuesMs,
    });
    applyLoadedDeckChannelState(channel, {
      loadedPadRef: derived.loadedPadRef,
      pad: nextPad,
      durationMs: derived.durationMs,
      hotcuesMs: derived.hotcuesMs,
    });
    this.retainWaveformRef(channel, derived.waveformKey);
    this.createDeckAudioElement(channel);
    this.notifyStateChange(true);
    return true;
  }

  unloadChannel(channelId: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    this.clearDeckChannelSeekTimer(channel);
    this.clearPendingChannelHotcue(channelId);
    this.stopDeckChannelInternal(channel, 'instant');
    if (channel.stopCancel) {
      channel.stopCancel();
      channel.stopCancel = null;
    }
    if (channel.audioElement) {
      try {
        channel.audioElement.pause();
        channel.audioElement.src = '';
      } catch {}
    }
    this.revokeChannelRecoveredSource(channel);
    this.disconnectDeckChannelAudioGraph(channel);
    channel.audioElement = null;
    this.clearDeckChannelStartupProfile(channel);
    resetUnloadedDeckChannelState(channel);
    this.releaseWaveformRef(channel);
    this.notifyStateChange(true);
  }

  playChannel(channelId: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.audioElement || !channel.pad) return;
    const resolveChannelTargetGain = (): number => computeDeckChannelTargetGainRuntime({
      channel,
      globalMuted: this.globalMuted,
      headroom: this.getProgramHeadroomGain(),
      masterVolume: this.masterVolume,
      isIOS: this.isIOS,
      hasSharedIOSGain: Boolean(this.sharedIOSGainNode),
    });
    const commandToken = this.nextDeckChannelCommandToken(channel);
    this.host.setChannelRuntimeDiag('play', channel.channelId, commandToken);
    const emitPlayDiag = (phase: Parameters<typeof emitChannelPlayDiagRuntime>[4], extra: Record<string, unknown> = {}) => {
      emitChannelPlayDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, phase, {
        audioContextState: this.audioContext?.state ?? 'none',
        contextUnlocked: this.contextUnlocked,
        globalMuted: this.globalMuted,
        masterVolume: this.masterVolume,
        hasSharedGain: Boolean(this.sharedIOSGainNode),
        targetGain: channel.pad ? resolveChannelTargetGain() : null,
      }, extra);
    };
    emitPlayDiag('command');
    if (channel.stopCancel) {
      channel.stopCancel();
      channel.stopCancel = null;
    }

    const markPlaying = () => {
      if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) {
        try { channel.audioElement?.pause(); } catch {}
        return;
      }
      const targetGain = resolveChannelTargetGain();
      if (this.audioContext && channel.gainNode && channel.graphConnected) {
        const now = this.audioContext.currentTime;
        channel.gainNode.gain.cancelScheduledValues(now);
        channel.gainNode.gain.setValueAtTime(0, now);
        channel.gainNode.gain.linearRampToValueAtTime(targetGain, now + CHANNEL_START_RAMP_SEC);
        if (channel.audioElement) channel.audioElement.volume = 1;
      } else if (channel.audioElement) {
        channel.audioElement.volume = Math.max(0, Math.min(1, targetGain));
      }
      channel.isPlaying = true;
      channel.isPaused = false;
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      const nowAbsMs = channel.audioElement ? channel.audioElement.currentTime * 1000 : start;
      channel.playheadMs = Math.max(0, Math.min(Math.max(0, end - start), nowAbsMs - start));
      this.beginDeckChannelStartupProfile(channel);
      this.host.refreshRuntimeMixLevels();
      this.startDeckPlaybackLoop();
      this.startDeckStartupLoopIfNeeded();
      this.notifyStateChange();
    };

    const playOnce = async (attempt: string): Promise<ChannelPlayAttemptResult> => executeChannelPlayAttempt({
      attempt,
      isCommandCurrent: () => this.isDeckChannelCommandTokenCurrent(channel, commandToken),
      play: async () => channel.audioElement!.play(),
      onDiag: (phase, detail) => emitPlayDiag(phase, detail),
    });

    const runPlay = async () => {
      this.ensureDeckChannelAudioGraph(channel);
      channel.audioElement!.playbackRate = Math.pow(2, (channel.pad!.pitch || 0) / 12);
      channel.audioElement!.loop = channel.pad!.playbackMode === 'loop';
      if (channel.pendingInitialSeekSec !== null) {
        this.setDeckChannelCurrentTimeSafe(channel, channel.pendingInitialSeekSec);
      }
      hardMuteDeckChannelOutputRuntime({ channel, audioContext: this.audioContext });
      let attemptResult: ChannelPlayAttemptResult = createInitialChannelPlayAttemptResult();

      if (this.isIOS) {
        attemptResult = await playOnce('ios_immediate');
        if (attemptResult.started) {
          markPlaying();
          emitPlayDiag('success', { attempt: attemptResult.attempt });
          return;
        }
        if (channel.iosSourceRecoveryPromise) {
          emitPlayDiag('fallback', { strategy: 'ios_source_prewarm_wait' });
          try { await channel.iosSourceRecoveryPromise; } catch {}
          if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
          attemptResult = await playOnce('ios_after_prewarm');
          if (attemptResult.started) {
            markPlaying();
            emitPlayDiag('success', { attempt: attemptResult.attempt });
            return;
          }
        }
      }

      if (!this.contextUnlocked || this.audioContext?.state === 'suspended') {
        try { await this.host.preUnlockAudio(); } catch {}
      }
      if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
      if (this.audioContext?.state === 'suspended') {
        try { await this.audioContext.resume(); } catch {}
      }
      if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;

      attemptResult = await playOnce('post_unlock');
      if (!attemptResult.started) {
        try { await this.host.preUnlockAudio(); } catch {}
        if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
        attemptResult = await playOnce('retry_after_preunlock');
      }
      if (!attemptResult.started && this.isIOS) {
        emitPlayDiag('fallback', { strategy: 'ios_direct_media' });
        attemptResult = await playOnce('ios_direct_media');
      }
      if (shouldAttemptIOSSourceRehydrate(this.isIOS, attemptResult)) {
        const expectedSourceUrl = resolveExpectedChannelSourceUrl(channel.audioElement, channel.pad?.audioUrl);
        const recovered = await this.tryRecoverChannelSourceForIOS(channel, { expectedSourceUrl });
        if (recovered && this.isDeckChannelCommandTokenCurrent(channel, commandToken)) {
          emitPlayDiag('fallback', { strategy: 'ios_source_rehydrate' });
          attemptResult = await playOnce('ios_rehydrated_source');
        }
      }
      if (!attemptResult.started) {
        if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
        finalizeDeckChannelStoppedState(channel);
        this.clearDeckChannelStartupProfile(channel);
        emitPlayDiag('failed', {
          attempt: attemptResult.attempt,
          errorName: attemptResult.errorName || null,
          errorMessage: attemptResult.errorMessage || null,
        });
        this.host.emitAudioRuntimeStageInfo('channel_play_failed');
        this.notifyStateChange();
        return;
      }
      markPlaying();
      emitPlayDiag('success', { attempt: attemptResult.attempt });
    };

    void runPlay();
  }

  pauseChannel(channelId: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.audioElement) return;
    this.clearPendingChannelHotcue(channelId);
    this.clearDeckChannelSeekTimer(channel);
    const commandToken = this.nextDeckChannelCommandToken(channel);
    const pauseIssuedAtMs = this.getNowMs();
    this.host.setChannelRuntimeDiag('pause', channel.channelId, commandToken);
    emitChannelPauseDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'command', pauseIssuedAtMs);
    if (channel.stopCancel) {
      channel.stopCancel();
      channel.stopCancel = null;
    }

    const finalizePause = () => {
      if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
      try { channel.audioElement!.pause(); } catch {}
      finalizeDeckChannelPausedState(channel);
      this.clearDeckChannelStartupProfile(channel);
      this.host.refreshRuntimeMixLevels();
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange();
      const finalizedAtMs = this.getNowMs();
      const baselineCurrentTimeMs = resolveDeckChannelBaselineCurrentTimeMs(channel.audioElement);
      emitChannelPauseDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'finalize', pauseIssuedAtMs, finalizedAtMs, baselineCurrentTimeMs);
      if (typeof window !== 'undefined' && typeof baselineCurrentTimeMs === 'number') {
        window.setTimeout(() => {
          if (!this.isDeckChannelCommandTokenCurrent(channel, commandToken)) return;
          emitChannelPauseDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, commandToken, 'guard', pauseIssuedAtMs, finalizedAtMs, baselineCurrentTimeMs);
        }, 30);
      }
    };

    const pausePlan = resolveDeckChannelZeroFadePlan({
      isIOS: this.isIOS,
      hasAudioElement: Boolean(channel.audioElement),
      hasGraphGainPath: hasDeckChannelGraphGainPath(this.audioContext, channel.gainNode, channel.graphConnected),
    });
    if (pausePlan === 'ios') {
      channel.stopCancel = this.rampDownDeckChannelOutputIOS(channel, CHANNEL_PAUSE_FADE_SEC, () => {
        hardMuteDeckChannelOutputRuntime({ channel, audioContext: this.audioContext });
        finalizePause();
      });
      return;
    }
    if (pausePlan === 'graph') {
      const now = this.audioContext!.currentTime;
      channel.gainNode!.gain.cancelScheduledValues(now);
      channel.gainNode!.gain.setValueAtTime(channel.gainNode!.gain.value, now);
      channel.gainNode!.gain.linearRampToValueAtTime(0, now + CHANNEL_PAUSE_FADE_SEC);
      setTimeout(finalizePause, CHANNEL_PAUSE_FINALIZE_DELAY_MS);
      return;
    }
    if (pausePlan === 'element') {
      rampDeckChannelElementVolumeRuntime({
        channel,
        targetGain: 0,
        durationSec: CHANNEL_PAUSE_FADE_SEC,
        getNowMs: () => this.getNowMs(),
        onComplete: finalizePause,
      });
      return;
    }
    finalizePause();
  }

  seekChannel(channelId: number, ms: number, options?: { mode?: 'default' | 'ios_hotcue' }): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'seekChannel', 'channel');
      return;
    }
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.audioElement || !channel.pad) return;
    const seekMode = resolveChannelSeekMode(options?.mode);
    const { seekFadeSec, seekDelayMs } = resolveChannelSeekProfile({
      seekMode,
      defaultFadeSec: CHANNEL_SEEK_FADE_SEC,
      defaultDelayMs: CHANNEL_SEEK_DELAY_MS,
      iosHotcueFadeSec: CHANNEL_IOS_HOTCUE_SEEK_FADE_SEC,
      iosHotcueDelayMs: CHANNEL_IOS_HOTCUE_SEEK_DELAY_MS,
    });
    this.host.setChannelRuntimeDiag('seek', channel.channelId, channel.commandToken);
    this.clearDeckChannelSeekTimer(channel);
    const start = this.getDeckStartMs(channel);
    const end = this.getDeckEndMs(channel);
    const clamped = clampChannelRelativeMs(ms, start, end);
    const targetGain = computeDeckChannelTargetGainRuntime({
      channel,
      globalMuted: this.globalMuted,
      headroom: this.getProgramHeadroomGain(),
      masterVolume: this.masterVolume,
      isIOS: this.isIOS,
      hasSharedIOSGain: Boolean(this.sharedIOSGainNode),
    });
    const sourcePlayheadMs = channel.playheadMs;
    const sourceCurrentTimeMs = Math.max(0, (Number.isFinite(channel.audioElement.currentTime) ? channel.audioElement.currentTime : 0) * 1000);
    const sourceCommandToken = channel.commandToken;
    if (this.isIOS) {
      channel.playheadGuardBypassUntilMs = this.getNowMs() + CHANNEL_IOS_STARTUP_BACKWARD_GUARD_BYPASS_MS;
    }
    emitChannelSeekDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'command', {
      requestedMs: ms,
      clampedMs: clamped,
      sourcePlayheadMs,
      sourceCurrentTimeMs,
      sourceCommandToken,
      seekMode,
    });

    const performSeek = () => {
      if (channel.commandToken !== sourceCommandToken) {
        emitChannelSeekDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'cancelled', {
          reason: 'stale_command_token',
          sourceCommandToken,
          latestCommandToken: channel.commandToken,
          clampedMs: clamped,
        });
        return;
      }
      channel.playheadMs = clamped;
      this.setDeckChannelCurrentTimeSafe(channel, (start + clamped) / 1000);
      if (this.audioContext && channel.gainNode && channel.graphConnected && channel.isPlaying) {
        const now2 = this.audioContext.currentTime;
        channel.gainNode.gain.cancelScheduledValues(now2);
        channel.gainNode.gain.setValueAtTime(0, now2);
        channel.gainNode.gain.linearRampToValueAtTime(targetGain, now2 + 0.010);
      }
      const finalizedCurrentTimeMs = channel.audioElement
        ? Math.max(0, (Number.isFinite(channel.audioElement.currentTime) ? channel.audioElement.currentTime : 0) * 1000)
        : null;
      emitChannelSeekDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'finalize', {
        clampedMs: clamped,
        sourcePlayheadMs,
        sourceCurrentTimeMs,
        finalizedCurrentTimeMs,
        sourceCommandToken,
        seekMode,
      });
      this.notifyStateChange(true);
    };

    if (this.audioContext && channel.gainNode && channel.graphConnected && channel.isPlaying) {
      const now = this.audioContext.currentTime;
      channel.gainNode.gain.cancelScheduledValues(now);
      channel.gainNode.gain.setValueAtTime(channel.gainNode.gain.value, now);
      channel.gainNode.gain.linearRampToValueAtTime(0, now + seekFadeSec);
      channel.seekRampTimer = setTimeout(() => {
        channel.seekRampTimer = null;
        performSeek();
      }, seekDelayMs);
    } else if (channel.isPlaying && channel.audioElement) {
      rampDeckChannelElementVolumeRuntime({
        channel,
        targetGain: 0,
        durationSec: seekFadeSec,
        getNowMs: () => this.getNowMs(),
        onComplete: () => {
          performSeek();
          if (channel.commandToken !== sourceCommandToken) return;
          rampDeckChannelElementVolumeRuntime({
            channel,
            targetGain,
            durationSec: seekFadeSec,
            getNowMs: () => this.getNowMs(),
          });
        },
      });
    } else {
      performSeek();
    }
  }

  setChannelHotcue(channelId: number, slotIndex: number, ms: number | null): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !isValidHotcueSlot(slotIndex)) return;
    if (ms === null) {
      channel.hotcuesMs[slotIndex] = null;
      emitChannelHotcueDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'clear', { slotIndex });
    } else {
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      const sourceDurationMs = Number.isFinite(channel.pad?.audioDurationMs) ? Math.max(0, Number(channel.pad?.audioDurationMs)) : 0;
      const maxMs = computeChannelHotcueMaxMs(start, end, sourceDurationMs);
      const safe = maxMs > 0 ? Math.max(0, Math.min(maxMs, ms)) : Math.max(0, ms);
      channel.hotcuesMs[slotIndex] = safe;
      emitChannelHotcueDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'set', { slotIndex, valueMs: safe, maxMs });
    }
    channel.hasLocalHotcueOverride = true;
    this.notifyStateChange(true);
  }

  clearChannelHotcue(channelId: number, slotIndex: number): void {
    this.setChannelHotcue(channelId, slotIndex, null);
  }

  private triggerChannelHotcueNow(channelId: number, slotIndex: number): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerChannelHotcue', 'channel');
      return;
    }
    const channel = this.getDeckChannel(channelId);
    if (!channel || !isValidHotcueSlot(slotIndex)) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const cooldown = checkHotcueCooldown({
      channelId,
      slotIndex,
      nowMs: now,
      cooldownMs: this.hotcueTriggerCooldownMs,
      lastTriggeredAtMs: this.lastHotcueTriggerAt.get(`${channelId}:${slotIndex}`) || 0,
    });
    if (cooldown.blocked) {
      emitChannelHotcueDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'trigger_blocked', {
        slotIndex,
        elapsedMs: Math.max(0, Math.round(cooldown.elapsedMs)),
        cooldownMs: this.hotcueTriggerCooldownMs,
      });
      return;
    }
    this.lastHotcueTriggerAt.set(cooldown.hotcueKey, now);
    const cue = channel.hotcuesMs[slotIndex];
    if (cue === null || cue === undefined) {
      emitChannelHotcueDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'trigger_missing', { slotIndex });
      return;
    }
    const hotcueSeekMode = resolveChannelHotcueSeekMode(this.isIOS, channel.isPlaying);
    emitChannelHotcueDiagRuntime(this.audioRuntimeStage, this.getNowMs(), channel, 'trigger', {
      slotIndex,
      cueMs: cue,
      wasPlaying: channel.isPlaying,
      seekMode: hotcueSeekMode,
    });
    this.seekChannel(channelId, cue, { mode: hotcueSeekMode });
    if (!channel.isPlaying) {
      this.playChannel(channelId);
    }
  }

  triggerChannelHotcue(channelId: number, slotIndex: number): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerChannelHotcue', 'channel');
      return;
    }
    if (!isValidHotcueSlot(slotIndex)) return;
    if (shouldUseIOSHotcueScheduler(this.isIOS)) {
      this.scheduleIOSChannelHotcue(channelId, slotIndex);
      return;
    }
    this.triggerChannelHotcueNow(channelId, slotIndex);
  }

  setChannelCollapsed(channelId: number, collapsed: boolean): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    channel.collapsed = collapsed;
    this.notifyStateChange();
  }

  private cleanupRemovedChannels(keepCount: number): void {
    for (let i = keepCount + 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      this.clearPendingChannelHotcue(i);
      this.unloadChannel(i);
      this.deckChannels.delete(i);
      this.channelVolumes.delete(i);
    }
  }

  setChannelCount(count: number): void {
    const safe = clampDeckChannelCount(count, 2, MAX_PLAYBACK_CHANNELS);
    if (safe === this.deckChannelCount) return;
    if (safe < this.deckChannelCount) this.cleanupRemovedChannels(safe);
    if (safe > this.deckChannelCount) {
      for (let i = 1; i <= safe; i += 1) {
        this.ensureDeckChannelRuntime(i);
      }
    }
    this.deckChannelCount = safe;
    this.notifyStateChange();
  }

  getChannelCount(): number {
    return this.deckChannelCount;
  }

  resetDeckPlaybackToStart(): void {
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel || !channel.pad) continue;
      this.stopDeckChannelInternal(channel, 'instant');
      setDeckChannelStoppedState(channel);
      if (channel.audioElement) {
        this.setDeckChannelCurrentTimeSafe(channel, (channel.pad.startTimeMs || 0) / 1000);
      }
    }
    this.notifyStateChange();
  }

  hydrateDeckLayout(deckState: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs?: HotcueTuple; collapsed?: boolean; channelVolume?: number; positionMs?: number; wasPlaying?: boolean; savedAt?: number }>): void {
    if (!Array.isArray(deckState)) return;
    deckState.forEach((entry) => {
      const channel = this.getDeckChannel(entry.channelId);
      if (!channel) return;
      if (typeof entry.channelVolume === 'number' && Number.isFinite(entry.channelVolume)) {
        this.setChannelVolume(entry.channelId, entry.channelVolume);
      }
      if (typeof entry.collapsed === 'boolean') channel.collapsed = entry.collapsed;
      if (!entry.loadedPadRef?.padId) {
        this.unloadChannel(entry.channelId);
        return;
      }
      const loaded = this.loadPadToChannel(entry.channelId, entry.loadedPadRef.padId);
      if (!loaded) return;
      if (Array.isArray(entry.hotcuesMs)) {
        const start = this.getDeckStartMs(channel);
        const end = this.getDeckEndMs(channel);
        const sourceDurationMs = Number.isFinite(channel.pad?.audioDurationMs) ? Math.max(0, Number(channel.pad?.audioDurationMs)) : 0;
        const maxMs = computeChannelHotcueMaxMs(start, end, sourceDurationMs);
        channel.hotcuesMs = normalizeChannelHotcuesForWindow(entry.hotcuesMs, start, maxMs);
        channel.hasLocalHotcueOverride = true;
      }
      this.restoreChannelPlaybackState(entry.channelId, entry.positionMs, true);
    });
    this.notifyStateChange();
  }

  restoreChannelPlaybackState(channelId: number, positionMs: number = 0, paused: boolean = true): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.pad) return;
    this.stopDeckChannelInternal(channel, 'instant');
    setDeckChannelStoppedState(channel);
    channel.isPaused = paused;
    const start = this.getDeckStartMs(channel);
    const end = this.getDeckEndMs(channel);
    const clamped = clampChannelRelativeMs(Number(positionMs) || 0, start, end);
    channel.playheadMs = clamped;
    if (channel.audioElement) {
      this.setDeckChannelCurrentTimeSafe(channel, (start + clamped) / 1000);
    }
    this.notifyStateChange();
  }

  persistDeckLayoutSnapshot(): DeckLayoutSnapshotEntry[] {
    const items: DeckLayoutSnapshotEntry[] = [];
    const savedAt = Date.now();
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      items.push({
        channelId: i,
        loadedPadRef: channel.loadedPadRef ? { ...channel.loadedPadRef } : null,
        hotcuesMs: cloneHotcuesTupleValue(channel.hotcuesMs),
        collapsed: channel.collapsed,
        channelVolume: channel.channelVolume,
        positionMs: channel.playheadMs,
        wasPlaying: channel.isPlaying,
        savedAt,
      });
    }
    return items;
  }

  saveChannelHotcuesToPad(channelId: number): { ok: boolean; padId?: string; savedHotcuesMs?: HotcueTuple } {
    const channel = this.getDeckChannel(channelId);
    if (!channel?.loadedPadRef?.padId) return { ok: false };
    const snapshot = this.registeredPads.get(channel.loadedPadRef.padId);
    if (!snapshot) return { ok: false };
    const start = this.getDeckStartMs(channel);
    const end = this.getDeckEndMs(channel);
    const sourceDurationMs = Number.isFinite(channel.pad?.audioDurationMs) ? Number(channel.pad?.audioDurationMs) : 0;
    const savedHotcuesMs = serializeChannelHotcuesForSource(channel.hotcuesMs, start, end, sourceDurationMs);
    snapshot.savedHotcuesMs = savedHotcuesMs;
    channel.hasLocalHotcueOverride = false;
    this.notifyStateChange();
    return { ok: true, padId: snapshot.padId, savedHotcuesMs };
  }

  getDeckChannelStates(): DeckChannelState[] {
    const result: DeckChannelState[] = [];
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      const pad = channel.pad ? {
        padId: channel.pad.padId,
        padName: channel.pad.padName,
        bankId: channel.pad.bankId,
        bankName: channel.pad.bankName,
        audioUrl: channel.pad.audioUrl,
        color: channel.pad.color,
        volume: channel.pad.volume,
        effectiveVolume: Math.max(0, channel.pad.volume * channel.pad.padGainLinear * channel.channelVolume * this.masterVolume),
        currentMs: channel.playheadMs,
        endMs: Math.max(0, this.getDeckEndMs(channel) - this.getDeckStartMs(channel)),
        playStartTime: 0,
        channelId: channel.channelId,
      } : null;
      result.push({
        channelId: channel.channelId,
        channelVolume: channel.channelVolume,
        loadedPadRef: channel.loadedPadRef ? { ...channel.loadedPadRef } : null,
        isPlaying: channel.isPlaying,
        isPaused: channel.isPaused,
        playheadMs: channel.playheadMs,
        durationMs: channel.durationMs,
        hotcuesMs: cloneHotcuesTupleValue(channel.hotcuesMs),
        hasLocalHotcueOverride: channel.hasLocalHotcueOverride,
        collapsed: channel.collapsed,
        waveformKey: channel.waveformKey,
        pad,
      });
    }
    return result;
  }

  getChannelStates(): DeckChannelState[] {
    return this.getDeckChannelStates();
  }

  setChannelVolume(channelId: number, volume: number): void {
    const safe = Math.max(0, Math.min(1, volume));
    const current = this.getChannelVolume(channelId);
    if (Math.abs(current - safe) < 0.001) return;
    this.channelVolumes.set(channelId, safe);
    const channel = this.getDeckChannel(channelId);
    if (channel) {
      channel.channelVolume = safe;
      this.syncDeckChannelVolume(channel);
    }
    this.notifyStateChange();
  }

  getChannelVolume(channelId: number): number {
    const channel = this.getDeckChannel(channelId);
    if (channel) return channel.channelVolume;
    return this.channelVolumes.get(channelId) ?? 1;
  }

  stopChannel(channelId: number, mode: StopMode = 'instant'): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    this.clearPendingChannelHotcue(channelId);
    void mode;
    this.stopDeckChannelClickSafeInstant(channel, 'user_stop');
  }
}
