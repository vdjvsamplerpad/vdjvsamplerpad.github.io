import * as React from 'react';
import { getIOSAudioService, type IOSAudioService } from '../../../lib/ios-audio-service';
import {
  AudioEngineCore,
  type EngineHealth,
  type AudioBackendType
} from '../../../lib/audio-engine';
import {
  DEFAULT_AUDIO_RUNTIME_STAGE,
  resolveAudioRuntimeStageFromStorage,
  usesLegacyAudioRuntimePath,
  type AudioRuntimeStage,
} from './audioRuntimeStage';
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
  type PadPlaybackMode,
  type PadTriggerMode,
} from './audioPadNormalization';
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
  resolveDeckNativeTickIntervalMs,
  resolveDeckEndMs,
  resolveDeckStartMs,
  shouldAutoStopDeckAtEnd,
  shouldUseImmediateDeckNotify,
} from './audioChannelPlaybackLoop';
import {
  computeDeckChannelTargetGainRuntime,
} from './audioChannelGainUtils';
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
  AudioDeckRuntime,
  type StopMode,
  type DeckLoadedPadRef,
  type DeckLayoutSnapshotEntry,
  type DeckChannelState,
  type DeckPadSnapshot,
} from './audioDeckRuntime';
import { AudioPadV3StateRuntime } from './audioPadV3StateRuntime';
import { AudioPadV3Runtime } from './audioPadV3Runtime';
import { AudioRuntimeCore, type AudioRecoveryState } from './audioRuntimeCore';
import { AudioLegacyPadRuntime } from './audioLegacyPadRuntime';
import { AudioLegacyPadResourceRuntime } from './audioLegacyPadResourceRuntime';
import { AudioPadRegistryRuntime } from './audioPadRegistryRuntime';
import { AudioPadLatencyRuntime } from './audioPadLatencyRuntime';
import { AudioPlaybackInspectionRuntime } from './audioPlaybackInspectionRuntime';
import { AudioRuntimeStageEventsRuntime } from './audioRuntimeStageEventsRuntime';
import type { AudioPadRuntimeRegistrationData, AudioPadRuntimeSettings } from './audioPadRuntimeTypes';
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
import {
  getAudioNowMs,
  getAndroidMuteGateModeValue,
  isAndroidNativeFastPathEnabledValue,
  setAndroidMuteGateLegacyValue,
} from './audioPlatformGateUtils';
import {
  createGlobalPlaybackStateSubscriber,
  registerGlobalPlaybackDebug,
  usePadPlaybackStateBinding,
  usePadWarmStatusBinding,
} from './audioGlobalPlaybackBindings';

// Runtime limits and tuning values.
// Limit concurrent iOS buffer sources.
const MAX_IOS_BUFFER_SOURCES = 32;
const IS_IOS = IS_IOS_RUNTIME_ENV;
const IS_ANDROID = IS_ANDROID_RUNTIME_ENV;
const IS_CAPACITOR_NATIVE = IS_CAPACITOR_NATIVE_RUNTIME;
const MIN_PROGRAM_HEADROOM = IS_CAPACITOR_NATIVE ? 0.3 : 0.4;
// Throttle UI notifications to avoid excess re-renders.
const NOTIFICATION_THROTTLE_MS = IS_CAPACITOR_NATIVE ? (IS_IOS ? 110 : 80) : (IS_IOS ? 100 : IS_ANDROID ? 50 : 16);
const ANDROID_FAST_START_RAMP_MS = 8;
const PAD_LATENCY_SAMPLE_MAX = 200;
const V3_FIXED_HEADROOM_GAIN = IS_CAPACITOR_NATIVE ? 0.78 : 0.84;

export type AndroidMuteGateMode = 'legacy' | 'fast';

interface PadLatencyProbe {
  playToken: number;
  padId: string;
  padName: string;
  mode: AndroidMuteGateMode;
  triggerAtMs: number;
  startTimeMs: number;
  playPromiseResolvedAtMs: number | null;
  firstPlayingAtMs: number | null;
  firstTimeupdateAtMs: number | null;
  playPromiseResolvedCurrentTimeMs: number | null;
  playingCurrentTimeMs: number | null;
  firstTimeupdateCurrentTimeMs: number | null;
}

export interface LatencyDistributionStats {
  count: number;
  avgMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

export interface PadLatencySample {
  padId: string;
  padName: string;
  mode: AndroidMuteGateMode;
  triggerAtMs: number;
  startTimeMs: number;
  playPromiseResolvedAtMs: number | null;
  firstPlayingAtMs: number | null;
  firstTimeupdateAtMs: number | null;
  playPromiseResolvedCurrentTimeMs: number | null;
  playingCurrentTimeMs: number | null;
  firstTimeupdateCurrentTimeMs: number | null;
  triggerToPlayResolveMs: number | null;
  triggerToPlayingMs: number | null;
  triggerToFirstTimeupdateMs: number | null;
  headAdvanceAtPlayResolveMs: number | null;
  headAdvanceAtPlayingMs: number | null;
  headAdvanceAtFirstTimeupdateMs: number | null;
  audibleGateDelayMs: number | null;
}

export interface PadLatencyStats {
  enabled: boolean;
  mode: AndroidMuteGateMode;
  sampleCount: number;
  totalSamples: number;
  maxSamples: number;
  lastSample: PadLatencySample | null;
  triggerToPlayResolveMs: LatencyDistributionStats;
  triggerToPlayingMs: LatencyDistributionStats;
  triggerToFirstTimeupdateMs: LatencyDistributionStats;
  headAdvanceAtPlayResolveMs: LatencyDistributionStats;
  headAdvanceAtPlayingMs: LatencyDistributionStats;
  headAdvanceAtFirstTimeupdateMs: LatencyDistributionStats;
  audibleGateDelayMs: LatencyDistributionStats;
}

export interface AudioInstance {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  color: string;
  volume: number;
  padGainLinear: number;
  channelId: number | null;
  ignoreChannel: boolean;

  audioElement: HTMLAudioElement | null;
  audioContext: AudioContext;
  sourceNode: MediaElementAudioSourceNode | null;
  gainNode: GainNode | null;
  filterNode: BiquadFilterNode | null;
  isPlaying: boolean;
  progress: number;
  triggerMode: 'toggle' | 'hold' | 'stutter' | 'unmute';
  playbackMode: 'once' | 'loop' | 'stopper';
  startTimeMs: number;
  endTimeMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  pitch: number;
  fadeIntervalId: NodeJS.Timeout | null;
  fadeAnimationFrameId: number | null;
  fadeMonitorFrameId: number | null;
  cleanupFunctions: (() => void)[];
  isFading: boolean;
  isConnected: boolean;
  lastAudioUrl: string | null;
  sourceConnected: boolean;
  fadeInStartTime: number | null;
  fadeOutStartTime: number | null;
  playStartTime: number | null;
  softMuted: boolean;
  nextPlayOverrides?: AudioPadRuntimeSettings;
  lastUsedTime: number;
  // iOS buffer state.
  audioBuffer: AudioBuffer | null;
  bufferSourceNode: AudioBufferSourceNode | null;
  isBufferDecoding: boolean;
  bufferDuration: number;
  iosProgressInterval: NodeJS.Timeout | null;
  stopEffectTimeoutId: NodeJS.Timeout | null;
  playToken: number;
  pendingDecodePlayToken: number | null;
  reversedBackspinBuffer: AudioBuffer | null;
  stopCancel: (() => void) | null;
  lastProgressNotify: number;
  padLatencyProbe: PadLatencyProbe | null;
}

export interface StopTimingProfile {
  instantStopFadeSec: number;
  instantStopFinalizeDelayMs: number;
  defaultFadeOutMs: number;
  brakeDurationSec: number;
  brakeMinRate: number;
  brakeWebDurationMs: number;
  backspinIOSPitchStart: number;
  backspinIOSPitchEnd: number;
  backspinIOSPitchRampSec: number;
  backspinIOSDurationSec: number;
  backspinWebSpeedUpMs: number;
  backspinWebTotalMs: number;
  backspinWebMaxRate: number;
  backspinWebMinRate: number;
  filterDurationSec: number;
  filterEndHz: number;
  volumeSmoothingSec: number;
  softMuteSmoothingSec: number;
  masterSmoothingSec: number;
}

export interface GlobalPlaybackManager {
  registerPad: (padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string) => Promise<void>;
  preloadPad: (padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string) => Promise<boolean>;
  forceWarmPad: (padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string) => Promise<boolean>;
  unregisterPad: (padId: string) => void;
  playPad: (padId: string) => void;
  stopPad: (padId: string, mode?: StopMode, keepChannel?: boolean) => void;
  togglePad: (padId: string) => void;
  triggerToggle: (padId: string) => void;
  triggerHoldStart: (padId: string) => void;
  triggerHoldStop: (padId: string) => void;
  triggerStutter: (padId: string) => void;
  triggerUnmuteToggle: (padId: string) => void;
  updatePadSettings: (padId: string, settings: AudioPadRuntimeSettings) => void;
  updatePadSettingsNextPlay: (padId: string, settings: AudioPadRuntimeSettings) => void;
  updatePadMetadata: (padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }) => void;
  getPadState: (padId: string) => { isPlaying: boolean; progress: number; effectiveVolume: number; softMuted: boolean } | null;
  getAllPlayingPads: () => {
    padId: string;
    padName: string;
    bankId: string;
    bankName: string;
    color: string;
    volume: number;
    currentMs: number;
    endMs: number;
    playStartTime: number;
    tempoRate?: number;
    playbackMode?: 'once' | 'loop' | 'stopper';
    timingSource?: 'date' | 'performance';
    channelId?: number | null
  }[];
  getLegacyPlayingPads: () => {
    padId: string;
    padName: string;
    bankId: string;
    bankName: string;
    color: string;
    volume: number;
    currentMs: number;
    endMs: number;
    playStartTime: number;
    tempoRate?: number;
    playbackMode?: 'once' | 'loop' | 'stopper';
    timingSource?: 'date' | 'performance'
  }[];
  getChannelStates: () => DeckChannelState[];
  getDeckChannelStates: () => DeckChannelState[];
  loadPadToChannel: (channelId: number, padId: string) => boolean;
  unloadChannel: (channelId: number) => void;
  playChannel: (channelId: number) => void;
  pauseChannel: (channelId: number) => void;
  seekChannel: (channelId: number, ms: number) => void;
  setChannelHotcue: (channelId: number, slotIndex: number, ms: number | null) => void;
  clearChannelHotcue: (channelId: number, slotIndex: number) => void;
  triggerChannelHotcue: (channelId: number, slotIndex: number) => void;
  setChannelCollapsed: (channelId: number, collapsed: boolean) => void;
  setChannelCount: (count: number) => void;
  getChannelCount: () => number;
  resetDeckPlaybackToStart: () => void;
  hydrateDeckLayout: (deckState: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs?: HotcueTuple; collapsed?: boolean; channelVolume?: number; positionMs?: number; wasPlaying?: boolean; savedAt?: number }>) => void;
  restoreChannelPlaybackState: (channelId: number, positionMs?: number, paused?: boolean) => void;
  persistDeckLayoutSnapshot: () => DeckLayoutSnapshotEntry[];
  saveChannelHotcuesToPad: (channelId: number) => { ok: boolean; padId?: string; savedHotcuesMs?: HotcueTuple };
  setChannelVolume: (channelId: number, volume: number) => void;
  getChannelVolume: (channelId: number) => number;
  stopChannel: (channelId: number, mode?: StopMode) => void;
  stopAllPads: (mode?: StopMode) => void;
  setGlobalMute: (muted: boolean) => void;
  setMasterVolume: (volume: number) => void;
  updatePadVolume: (padId: string, volume: number) => void;
  addStateChangeListener: (listener: () => void) => void;
  removeStateChangeListener: (listener: () => void) => void;
  isPadRegistered: (padId: string) => boolean;
  getAllRegisteredPads: () => string[];
  playStutterPad: (padId: string) => void;
  toggleMutePad: (padId: string) => void;
  preUnlockAudio: () => Promise<void>;

  runDiagnostics: () => Promise<DiagnosticResult>;
  getAudioState: () => AudioSystemState;
  getAudioRuntimeInfo: () => AudioRuntimeInfo;
  getPadWarmStatus: (padId: string) => PadWarmStatus;
  getAudioRecoveryState: () => AudioRecoveryState;
  getPadLatencyStats: () => PadLatencyStats | null;
  resetPadLatencyStats: () => void;
  // Audio Engine V3 facade. diagnostics.
  getEngineBackendForPad: (padId: string) => AudioBackendType | null;
  getEngineHealth: () => EngineHealth;
}

export interface DiagnosticResult {
  contextState: string;
  isUnlocked: boolean;
  isIOS: boolean;
  silentAudioTest: { success: boolean; latencyMs: number };
  oscillatorTest: { success: boolean; latencyMs: number };
  bufferTest: { success: boolean; latencyMs: number };
  mediaElementTest: { success: boolean; latencyMs: number };
  totalInstances: number;
  activeBuffers: number;
  padLatencyStats?: PadLatencyStats | null;
}

export interface AudioSystemState {
  isIOS: boolean;
  contextState: string;
  isUnlocked: boolean;
  totalInstances: number;
  playingCount: number;
  bufferedCount: number;
  masterVolume: number;
  globalMuted: boolean;
}

export interface AudioRuntimeInfo {
  stage: AudioRuntimeStage;
  activePadId: string | null;
  activePadBackend: AudioBackendType | null;
  lastPadLoadLatencyMs: number | null;
  lastPadStartLatencyMs: number | null;
  lastPadStopLatencyMs: number | null;
  quarantinedPads: number;
  lastBlockedPadId: string | null;
  lastBlockedReason: string | null;
  lastChannelAction: 'none' | 'play' | 'pause' | 'stop' | 'seek' | 'ended';
  lastChannelId: number | null;
  lastChannelCommandToken: number;
  lastChannelActionAt: number | null;
}

export interface PadWarmStatus {
  stage: AudioRuntimeStage;
  backend: AudioBackendType | null;
  isReady: boolean;
  isWarming: boolean;
  isPendingPlay: boolean;
  isQuarantined: boolean;
  quarantineRemainingMs: number;
}

class GlobalPlaybackManagerClass {
  private audioInstances: Map<string, AudioInstance> = new Map();
  private registeredPads: Map<string, DeckPadSnapshot> = new Map();
  private stateChangeListeners: Set<() => void> = new Set();
  private globalMuted: boolean = false;
  private masterVolume: number = 1;
  private audioContext: AudioContext | null = null;
  private isIOS: boolean = false;
  private isAndroid: boolean = false;
  private contextUnlocked: boolean = false;
  private silentAudio: HTMLAudioElement | null = null;
  private iosAudioService: IOSAudioService | null = null;
  private notificationTimeout: NodeJS.Timeout | null = null;
  // Shared gain node for iOS buffer playback.
  private sharedIOSGainNode: GainNode | null = null;
  private deckRuntime!: AudioDeckRuntime;
  // Audio pre-warm state.
  private isPrewarmed: boolean = false;
  private masterVolumeRafId: number | null = null;
  private pendingMasterVolume: number | null = null;
  private runtimeCore!: AudioRuntimeCore;
  private legacyPadResourceRuntime!: AudioLegacyPadResourceRuntime;
  private legacyPadRuntime!: AudioLegacyPadRuntime;
  private padRegistryRuntime!: AudioPadRegistryRuntime;
  private padLatencyRuntime!: AudioPadLatencyRuntime;
  private inspectionRuntime!: AudioPlaybackInspectionRuntime;
  private stageEventsRuntime!: AudioRuntimeStageEventsRuntime;
  // Audio Engine V3 facade.
  private v3Engine: AudioEngineCore = AudioEngineCore.getInstance();
  private v3StateRuntime: AudioPadV3StateRuntime = new AudioPadV3StateRuntime();
  private v3PadRuntime!: AudioPadV3Runtime;
  private audioRuntimeStage: AudioRuntimeStage = DEFAULT_AUDIO_RUNTIME_STAGE;

  private computeV3EffectiveVolume(snapshot: DeckPadSnapshot, transport?: { softMuted?: boolean } | null): number {
    if (this.globalMuted) return 0;
    if (transport?.softMuted) return 0;
    const volume = normalizePadVolumeValue(snapshot.volume);
    const gain = normalizePadGainLinearValue(snapshot.padGainLinear);
    return volume * gain * this.masterVolume * V3_FIXED_HEADROOM_GAIN;
  }

  private createRawV3TransportState(snapshot: DeckPadSnapshot) {
    const startTimeMs = Number.isFinite(snapshot.startTimeMs) ? Math.max(0, snapshot.startTimeMs) : 0;
    const endTimeMsCandidate = Number.isFinite(snapshot.endTimeMs) ? Math.max(0, snapshot.endTimeMs) : 0;
    const endTimeMs = endTimeMsCandidate > startTimeMs ? endTimeMsCandidate : 0;
    const fadeInMs = Number.isFinite(snapshot.fadeInMs) ? Math.max(0, snapshot.fadeInMs) : 0;
    const fadeOutMs = Number.isFinite(snapshot.fadeOutMs) ? Math.max(0, snapshot.fadeOutMs) : 0;
    const savedHotcuesMs: HotcueTuple = [
      typeof snapshot.savedHotcuesMs?.[0] === 'number' ? snapshot.savedHotcuesMs[0] : null,
      typeof snapshot.savedHotcuesMs?.[1] === 'number' ? snapshot.savedHotcuesMs[1] : null,
      typeof snapshot.savedHotcuesMs?.[2] === 'number' ? snapshot.savedHotcuesMs[2] : null,
      typeof snapshot.savedHotcuesMs?.[3] === 'number' ? snapshot.savedHotcuesMs[3] : null
    ];
    return {
      padId: snapshot.padId,
      padName: snapshot.padName,
      bankId: snapshot.bankId,
      bankName: snapshot.bankName,
      color: snapshot.color,
      audioUrl: snapshot.audioUrl,
      volume: normalizePadVolumeValue(snapshot.volume),
      gain: normalizePadGainLinearValue(snapshot.padGainLinear),
      startTimeMs,
      endTimeMs,
      fadeInMs,
      fadeOutMs,
      pitch: Number.isFinite(snapshot.pitch) ? snapshot.pitch : 0,
      tempoRate: tempoPercentToRateForRuntime(this.isIOS, snapshot.tempoPercent),
      preservePitch: normalizeKeyLockForRuntime(this.isIOS, snapshot.keyLock),
      triggerMode: snapshot.triggerMode,
      playbackMode: snapshot.playbackMode,
      channelId: null,
      savedHotcuesMs,
      audioBytes: normalizeAudioBytesValue(snapshot.audioBytes),
      audioDurationMs: normalizeDurationMsValue(snapshot.audioDurationMs)
    };
  }

  setAndroidMuteGateLegacy(enabled: boolean): AndroidMuteGateMode {
    return setAndroidMuteGateLegacyValue(this.isAndroid, enabled);
  }

  getAndroidMuteGateMode(): AndroidMuteGateMode {
    return getAndroidMuteGateModeValue(this.isAndroid);
  }

  getPadLatencyStats(): PadLatencyStats | null {
    return this.padLatencyRuntime.getPadLatencyStats();
  }

  resetPadLatencyStats(): void {
    this.padLatencyRuntime.resetPadLatencyStats();
  }

  constructor() {
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
    this.audioRuntimeStage = resolveAudioRuntimeStageFromStorage(typeof window === 'undefined' ? null : window.localStorage);
    this.stageEventsRuntime = new AudioRuntimeStageEventsRuntime({
      getAudioRuntimeStage: () => this.audioRuntimeStage,
      getRuntimeInfo: () => this.v3StateRuntime.getRuntimeInfo(),
      getEngineBackendForPad: (padId) => this.v3Engine.getEngineBackendForPad(padId),
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
    });
    this.runtimeCore = new AudioRuntimeCore({
      getAudioContext: () => this.audioContext,
      setAudioContext: (context) => { this.audioContext = context; },
      getContextUnlocked: () => this.contextUnlocked,
      setContextUnlocked: (unlocked) => { this.contextUnlocked = unlocked; },
      getSilentAudio: () => this.silentAudio,
      setSilentAudio: (audio) => { this.silentAudio = audio; },
      getSharedIOSGainNode: () => this.sharedIOSGainNode,
      setSharedIOSGainNode: (node) => { this.sharedIOSGainNode = node; },
      getMasterVolume: () => this.masterVolume,
      getIsIOS: () => this.isIOS,
      getAudioRuntimeStage: () => this.audioRuntimeStage,
      getIOSAudioService: () => this.iosAudioService,
      getEngine: () => this.v3Engine,
      getIsPrewarmed: () => this.isPrewarmed,
      setIsPrewarmed: (value) => { this.isPrewarmed = value; },
      connectLoadedChannelsToSharedIOSGraph: () => this.deckRuntime.connectLoadedChannelsToSharedIOSGraph(),
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
    });
    this.padLatencyRuntime = new AudioPadLatencyRuntime({
      getNowMs: () => getAudioNowMs(),
      getAndroidMuteGateMode: () => getAndroidMuteGateModeValue(this.isAndroid),
      getAudioInstances: () => this.audioInstances,
      getIsAndroid: () => this.isAndroid,
    });
    this.inspectionRuntime = new AudioPlaybackInspectionRuntime({
      usesLegacyAudioRuntimePath: () => usesLegacyAudioRuntimePath(this.audioRuntimeStage),
      getAudioRuntimeStage: () => this.audioRuntimeStage,
      getIsIOS: () => this.isIOS,
      getAudioContext: () => this.audioContext,
      getContextUnlocked: () => this.contextUnlocked,
      getSharedIOSGainNode: () => this.sharedIOSGainNode,
      getIsPrewarmed: () => this.isPrewarmed,
      getMasterVolume: () => this.masterVolume,
      getGlobalMuted: () => this.globalMuted,
      getAudioInstances: () => this.audioInstances,
      getRegisteredPads: () => this.registeredPads,
      getLegacyBufferCacheSize: () => this.legacyPadResourceRuntime.getBufferCacheSize(),
      getEngineHealth: () => this.v3Engine.getEngineHealth(),
      getEngineBackendForPad: (padId) => this.v3Engine.getEngineBackendForPad(padId),
      getTransportState: (padId) => this.v3Engine.getTransportState(padId),
      computeV3EffectiveVolume: (snapshot, transport) => this.computeV3EffectiveVolume(snapshot, transport),
      getRuntimeInfo: () => this.v3StateRuntime.getRuntimeInfo(),
      getLastChannelDiag: () => this.stageEventsRuntime.getLastChannelDiag(),
      setActivePadId: (padId) => this.v3StateRuntime.setActivePadId(padId),
      isPreloadingPad: (padId) => this.v3PadRuntime.isPreloadingPad(padId),
      getPadWarmState: (padId, backend, isReady, isWarming, audioUrl) => this.v3StateRuntime.getPadWarmState(padId, backend, isReady, isWarming, audioUrl),
      getBaseGain: (instance) => this.getBaseGain(instance),
      getPadLatencyStats: () => this.padLatencyRuntime.getPadLatencyStats(),
    });
    this.legacyPadResourceRuntime = new AudioLegacyPadResourceRuntime({
      getAudioInstances: () => this.audioInstances,
      getAudioContext: () => this.audioContext,
      getSharedIOSGainNode: () => this.sharedIOSGainNode,
      getIsIOS: () => this.isIOS,
      disablePitchPreservation: (audio) => this.runtimeCore.disablePitchPreservation(audio),
      markPadLatencyTimeupdate: (instance, currentTimeMs) => this.padLatencyRuntime.markPadLatencyTimeupdate(instance, currentTimeMs),
      markPadLatencyPlaying: (instance) => this.padLatencyRuntime.markPadLatencyPlaying(instance),
      stopPadById: (padId, mode, keepChannel) => this.stopPad(padId, mode, keepChannel),
      refreshRuntimeMixLevels: () => this.refreshRuntimeMixLevels(),
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
      updateInstanceVolume: (instance) => this.updateInstanceVolume(instance),
    });
    this.legacyPadRuntime = new AudioLegacyPadRuntime({
      getAudioInstances: () => this.audioInstances,
      getAudioContext: () => this.audioContext,
      getSilentAudio: () => this.silentAudio,
      getIsIOS: () => this.isIOS,
      getIsAndroid: () => this.isAndroid,
      getContextUnlocked: () => this.contextUnlocked,
      setContextUnlocked: (unlocked) => { this.contextUnlocked = unlocked; },
      ensureAudioResources: (instance) => this.legacyPadResourceRuntime.ensureAudioResources(instance),
      startBufferDecode: (instance) => this.legacyPadResourceRuntime.startBufferDecode(instance),
      connectAudioNodes: (instance) => this.legacyPadResourceRuntime.connectAudioNodes(instance),
      disconnectAudioNodes: (instance) => this.legacyPadResourceRuntime.disconnectAudioNodes(instance),
      releaseChannel: (instance, keepChannel) => this.legacyPadResourceRuntime.releaseChannel(instance, keepChannel),
      refreshRuntimeMixLevels: () => this.refreshRuntimeMixLevels(),
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
      getBaseGain: (instance) => this.getBaseGain(instance),
      getStopTimingProfile: () => this.getStopTimingProfile(),
      beginPadLatencyProbe: (instance, playToken, mode) => this.padLatencyRuntime.beginPadLatencyProbe(instance, playToken, mode),
      markPadLatencyPlayResolved: (instance, playToken) => this.padLatencyRuntime.markPadLatencyPlayResolved(instance, playToken),
      playPadById: (padId) => this.playPad(padId),
      stopPadById: (padId, mode, keepChannel) => this.stopPad(padId, mode, keepChannel),
      isAndroidNativeFastPathEnabled: () => isAndroidNativeFastPathEnabledValue(this.isAndroid),
    });
    this.padRegistryRuntime = new AudioPadRegistryRuntime({
      usesLegacyAudioRuntimePath: () => usesLegacyAudioRuntimePath(this.audioRuntimeStage),
      getIsIOS: () => this.isIOS,
      getAudioContext: () => this.audioContext,
      initializeAudioContext: () => this.runtimeCore.initializeAudioContext(),
      getAudioInstances: () => this.audioInstances,
      getRegisteredPads: () => this.registeredPads,
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
      syncLoadedChannelHotcuesFromRegisteredPad: (padId) => this.deckRuntime.syncLoadedChannelHotcuesFromRegisteredPad(padId),
      legacyCleanupInstance: (instance) => this.legacyPadResourceRuntime.cleanupInstance(instance),
      legacyEnsureAudioResources: (instance) => this.legacyPadResourceRuntime.ensureAudioResources(instance),
      legacyStartBufferDecode: (instance) => this.legacyPadResourceRuntime.startBufferDecode(instance),
      legacyReleaseChannel: (instance, keepChannel) => this.legacyPadResourceRuntime.releaseChannel(instance, keepChannel),
      legacyAssignChannel: (instance) => this.legacyPadResourceRuntime.assignChannel(instance),
      legacyUpdateInstanceVolume: (instance) => this.updateInstanceVolume(instance),
      legacyStartFadeOutMonitor: (instance) => this.startFadeOutMonitor(instance),
      legacyUnloadChannelsForPad: (padId) => this.deckRuntime.unloadChannelsForPad(padId),
      v3StopPadBasic: (padId, mode, options) => this.v3PadRuntime.stopPadBasic(padId, mode, options),
      v3DisposeTransport: (padId) => this.v3Engine.disposeTransport(padId),
      v3ClearPadRuntimeState: (padId) => this.v3PadRuntime.clearPadRuntimeState(padId),
      v3ClearStutterGuard: (padId) => this.v3StateRuntime.clearStutterGuard(padId),
      v3ClearPadLoadFailureState: (padId) => this.v3StateRuntime.clearPadLoadFailureState(padId),
      v3ClearPadQuarantineState: (padId, reason, stage) => this.v3StateRuntime.clearPadQuarantineState(padId, reason, stage),
      v3MarkTransportRegionDirty: (padId) => this.v3StateRuntime.markTransportRegionDirty(padId),
      v3ClearTransportRegionDirty: (padId) => this.v3StateRuntime.clearTransportRegionDirty(padId),
      getAudioRuntimeStage: () => this.audioRuntimeStage,
      v3SetTransportPitch: (padId, pitch) => this.v3Engine.setTransportPitch(padId, pitch),
      v3SetTransportTempoRate: (padId, rate) => this.v3Engine.setTransportTempoRate(padId, rate),
      v3SetTransportPreservePitch: (padId, preservePitch) => this.v3Engine.setTransportPreservePitch(padId, preservePitch),
      v3SetTransportVolume: (padId, volume) => this.v3Engine.setTransportVolume(padId, volume),
      v3SetTransportGain: (padId, gain) => this.v3Engine.setTransportGain(padId, gain),
      v3SetTransportPlaybackMode: (padId, mode) => this.v3Engine.setTransportPlaybackMode(padId, mode),
    });
    this.v3PadRuntime = new AudioPadV3Runtime({
      getRegisteredPads: () => this.registeredPads,
      getEngine: () => this.v3Engine,
      getStateRuntime: () => this.v3StateRuntime,
      getAudioRuntimeStage: () => this.audioRuntimeStage,
      getNowMs: () => getAudioNowMs(),
      getIsIOS: () => this.isIOS,
      createTransportState: (snapshot) => this.createRawV3TransportState(snapshot),
      registerPad: (padId, padData, bankId, bankName) => this.registerPad(padId, padData, bankId, bankName),
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
      emitAudioRuntimeStageInfo: (action) => this.stageEventsRuntime.emitAudioRuntimeStageInfo(action),
      emitPadPlayFailed: (padId, reason, retryCount) => this.stageEventsRuntime.emitV3PadPlayFailed(padId, reason, retryCount),
    });
    this.deckRuntime = new AudioDeckRuntime({
      getRegisteredPads: () => this.registeredPads,
      getIsIOS: () => this.isIOS,
      getIsAndroid: () => this.isAndroid,
      getAudioRuntimeStage: () => this.audioRuntimeStage,
      getAudioContext: () => this.audioContext,
      getSharedIOSGainNode: () => this.sharedIOSGainNode,
      getGlobalMuted: () => this.globalMuted,
      getMasterVolume: () => this.masterVolume,
      getContextUnlocked: () => this.contextUnlocked,
      getNowMs: () => getAudioNowMs(),
      getProgramHeadroomGain: () => this.getProgramHeadroomGain(),
      getStopTimingProfile: () => this.getStopTimingProfile(),
      initializeAudioContext: () => this.runtimeCore.initializeAudioContext(),
      setupSharedIOSNodes: () => this.runtimeCore.setupSharedIOSNodes(),
      disablePitchPreservation: (audio) => this.runtimeCore.disablePitchPreservation(audio),
      preUnlockAudio: () => this.runtimeCore.preUnlockAudio(),
      notifyStateChange: (immediate) => this.notifyStateChange(immediate),
      refreshRuntimeMixLevels: () => this.refreshRuntimeMixLevels(),
      emitAudioRuntimeStageInfo: (action) => this.stageEventsRuntime.emitAudioRuntimeStageInfo(action),
      setChannelRuntimeDiag: (action, channelId, token) => this.stageEventsRuntime.setChannelRuntimeDiag(action, channelId, token),
    });
    this.v3StateRuntime.restorePadQuarantine();
    this.stageEventsRuntime.ensureV3EngineStateBridge(this.v3Engine);
    this.deckRuntime.ensureInitialChannels();

    this.stageEventsRuntime.emitAudioRuntimeStageInfo('init');

    if (this.isIOS) {
      this.iosAudioService = getIOSAudioService();
      this.iosAudioService.onUnlock(() => {
        this.contextUnlocked = true;
        this.audioContext = this.iosAudioService.getAudioContext();
        this.runtimeCore.setupSharedIOSNodes();
      });
      if (usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
        window.addEventListener('ios-audio-control-pause', () => this.stopAllPads('fadeout'));
        window.addEventListener('ios-audio-control-stop', () => this.stopAllPads('instant'));
      }
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.runtimeCore.setupNativeAppStateListener();
      this.runtimeCore.initializeAudioContext();
      return;
    }

    const handleForeground = () => {
      this.runtimeCore.handleForegroundResume();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleForeground);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleForeground);
      window.addEventListener('pageshow', handleForeground);
    }

    this.runtimeCore.setupNativeAppStateListener();

    this.runtimeCore.initializeAudioContext();
  }

  async registerPad(padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string): Promise<void> {
    await this.padRegistryRuntime.registerPad(padId, padData, bankId, bankName);
  }

  private getActiveProgramVoices(): number {
    let voices = 0;
    this.audioInstances.forEach((inst) => {
      if (inst.isPlaying) voices += 1;
    });
    voices += this.deckRuntime.getActivePlayingChannelCount();
    return Math.max(1, voices);
  }

  private getProgramHeadroomGain(): number {
    const voices = this.getActiveProgramVoices();
    if (voices <= 1) return 1;
    return Math.max(MIN_PROGRAM_HEADROOM, 1 / Math.sqrt(voices));
  }

  private refreshRuntimeMixLevels(): void {
    this.audioInstances.forEach((instance) => this.updateInstanceVolume(instance));
    this.deckRuntime.syncAllChannelVolumes();
  }

  private getBaseGain(instance: AudioInstance) {
    const channelVolume = instance.channelId ? this.deckRuntime.getChannelVolume(instance.channelId) : 1;
    const padGainLinear = Number.isFinite(instance.padGainLinear) ? instance.padGainLinear : 1;
    if (this.globalMuted || instance.softMuted) return 0;
    const headroom = this.getProgramHeadroomGain();
    if (this.isIOS && this.sharedIOSGainNode) {
      return instance.volume * padGainLinear * channelVolume * headroom;
    }
    return instance.volume * padGainLinear * this.masterVolume * channelVolume * headroom;
  }

  private getStopTimingProfile(): StopTimingProfile {
    if (this.isIOS) {
      return {
        instantStopFadeSec: 0.014,
        instantStopFinalizeDelayMs: 18,
        defaultFadeOutMs: 900,
        brakeDurationSec: 1.35,
        brakeMinRate: 0.08,
        brakeWebDurationMs: 1350,
        backspinIOSPitchStart: 1.7,
        backspinIOSPitchEnd: 2.8,
        backspinIOSPitchRampSec: 0.22,
        backspinIOSDurationSec: 0.56,
        backspinWebSpeedUpMs: 420,
        backspinWebTotalMs: 900,
        backspinWebMaxRate: 2.8,
        backspinWebMinRate: 0.24,
        filterDurationSec: 1.2,
        filterEndHz: 120,
        volumeSmoothingSec: 0.016,
        softMuteSmoothingSec: 0.014,
        masterSmoothingSec: 0.012
      };
    }

    if (this.isAndroid) {
      return {
        instantStopFadeSec: 0.02,
        instantStopFinalizeDelayMs: 24,
        defaultFadeOutMs: 800,
        brakeDurationSec: 1.2,
        brakeMinRate: 0.1,
        brakeWebDurationMs: 1200,
        backspinIOSPitchStart: 1.8,
        backspinIOSPitchEnd: 3,
        backspinIOSPitchRampSec: 0.24,
        backspinIOSDurationSec: 0.58,
        backspinWebSpeedUpMs: 380,
        backspinWebTotalMs: 780,
        backspinWebMaxRate: 2.7,
        backspinWebMinRate: 0.28,
        filterDurationSec: 1.1,
        filterEndHz: 160,
        volumeSmoothingSec: 0.02,
        softMuteSmoothingSec: 0.018,
        masterSmoothingSec: 0.015
      };
    }

    return {
      instantStopFadeSec: 0.012,
      instantStopFinalizeDelayMs: 14,
      defaultFadeOutMs: 900,
      brakeDurationSec: 1.4,
      brakeMinRate: 0.08,
      brakeWebDurationMs: 1400,
      backspinIOSPitchStart: 1.8,
      backspinIOSPitchEnd: 3.1,
      backspinIOSPitchRampSec: 0.28,
      backspinIOSDurationSec: 0.62,
      backspinWebSpeedUpMs: 500,
      backspinWebTotalMs: 950,
      backspinWebMaxRate: 3,
      backspinWebMinRate: 0.2,
      filterDurationSec: 1.35,
      filterEndHz: 100,
      volumeSmoothingSec: 0.012,
      softMuteSmoothingSec: 0.01,
      masterSmoothingSec: 0.01
    };
  }

  private setGain(instance: AudioInstance, gain: number) {
    this.legacyPadRuntime.setGain(instance, gain);
  }

  private startManualFade(instance: AudioInstance, fromGain: number, toGain: number, durationMs: number, onComplete?: () => void) {
    this.legacyPadRuntime.startManualFade(instance, fromGain, toGain, durationMs, onComplete);
  }

  private startFadeOutMonitor(instance: AudioInstance) {
    this.legacyPadRuntime.startFadeOutMonitor(instance);
  }

  playPad(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'playPad', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.playPadBasic(padId);
      return;
    }
    this.legacyPadRuntime.playPad(padId);
  }

  private resetInstanceAudio(instance: AudioInstance): void {
    this.legacyPadRuntime.resetInstanceAudio(instance);
  }

  private updateInstanceVolume(instance: AudioInstance): void {
    this.legacyPadRuntime.updateInstanceVolume(instance);
  }

  private applySoftMute(instance: AudioInstance): void {
    this.legacyPadRuntime.applySoftMute(instance);
  }

  private notifyStateChange(immediate: boolean = false): void {
    if (immediate) {
      if (this.notificationTimeout) {
        clearTimeout(this.notificationTimeout);
        this.notificationTimeout = null;
      }
      this.stateChangeListeners.forEach(listener => { try { listener(); } catch { } });
      return;
    }

    // Coalesce frequent updates without starving renders.
    if (this.notificationTimeout) return;
    this.notificationTimeout = setTimeout(() => {
      this.notificationTimeout = null;
      this.stateChangeListeners.forEach(listener => { try { listener(); } catch { } });
    }, NOTIFICATION_THROTTLE_MS);
  }

  private _applyNextPlayOverrides(instance: AudioInstance) {
    const o = instance.nextPlayOverrides;
    if (!o) return;

    if (typeof o.padName === 'string') instance.padName = o.padName;
    if (typeof o.name === 'string') instance.padName = o.name;
    if (typeof o.color === 'string') instance.color = o.color;
    if (typeof o.bankId === 'string') instance.bankId = o.bankId;
    if (typeof o.bankName === 'string') instance.bankName = o.bankName;

    if (typeof o.triggerMode !== 'undefined') {
      instance.triggerMode = normalizePadTriggerModeValue(o.triggerMode);
    }
    if (typeof o.playbackMode !== 'undefined') {
      const playbackMode = normalizePadPlaybackModeValue(o.playbackMode);
      instance.playbackMode = playbackMode;
      if (instance.audioElement) instance.audioElement.loop = playbackMode === 'loop';
    }

    if (typeof o.startTimeMs === 'number') instance.startTimeMs = Math.max(0, o.startTimeMs);
    if (typeof o.endTimeMs === 'number') instance.endTimeMs = Math.max(0, o.endTimeMs);
    if (typeof o.fadeInMs === 'number') instance.fadeInMs = Math.max(0, o.fadeInMs);
    if (typeof o.fadeOutMs === 'number') instance.fadeOutMs = Math.max(0, o.fadeOutMs);
    if (typeof o.pitch === 'number') instance.pitch = o.pitch;
    if (typeof o.volume === 'number') instance.volume = o.volume;

    instance.nextPlayOverrides = undefined;
  }

  stopPad(padId: string, mode: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter' = 'instant', keepChannel?: boolean): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'stopPad', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.stopPadBasic(padId, mode);
      return;
    }
    this.legacyPadRuntime.stopPad(padId, mode, keepChannel);
  }

  unregisterPad(padId: string): void {
    this.padRegistryRuntime.unregisterPad(padId);
  }

  togglePad(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'togglePad', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.togglePad(padId);
      return;
    }

    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (instance.isPlaying) this.stopPad(padId);
    else this.playPad(padId);
  }

  updatePadSettings(padId: string, settings: AudioPadRuntimeSettings): void {
    this.padRegistryRuntime.updatePadSettings(padId, settings);
  }

  updatePadSettingsNextPlay(padId: string, settings: AudioPadRuntimeSettings): void {
    this.padRegistryRuntime.updatePadSettingsNextPlay(padId, settings);
  }

  updatePadMetadata(padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }): void {
    this.padRegistryRuntime.updatePadMetadata(padId, metadata);
  }

  getPadState(padId: string): { isPlaying: boolean; progress: number; effectiveVolume: number; softMuted: boolean } | null {
    return this.inspectionRuntime.getPadState(padId);
  }

  getAllPlayingPads() {
    return this.inspectionRuntime.getAllPlayingPads();
  }

  getLegacyPlayingPads() {
    return this.inspectionRuntime.getLegacyPlayingPads();
  }

  private syncLoadedChannelHotcuesFromRegisteredPad(padId: string): boolean {
    return this.deckRuntime.syncLoadedChannelHotcuesFromRegisteredPad(padId);
  }

  getDeckChannelStates(): DeckChannelState[] {
    return this.deckRuntime.getDeckChannelStates();
  }

  getChannelStates(): DeckChannelState[] {
    return this.deckRuntime.getChannelStates();
  }

  loadPadToChannel(channelId: number, padId: string): boolean {
    return this.deckRuntime.loadPadToChannel(channelId, padId);
  }

  unloadChannel(channelId: number): void {
    this.deckRuntime.unloadChannel(channelId);
  }

  playChannel(channelId: number): void {
    this.deckRuntime.playChannel(channelId);
  }

  pauseChannel(channelId: number): void {
    this.deckRuntime.pauseChannel(channelId);
  }

  seekChannel(
    channelId: number,
    ms: number,
    options?: {
      mode?: 'default' | 'ios_hotcue';
    }
  ): void {
    this.deckRuntime.seekChannel(channelId, ms, options);
  }

  setChannelHotcue(channelId: number, slotIndex: number, ms: number | null): void {
    this.deckRuntime.setChannelHotcue(channelId, slotIndex, ms);
  }

  clearChannelHotcue(channelId: number, slotIndex: number): void {
    this.deckRuntime.clearChannelHotcue(channelId, slotIndex);
  }

  triggerChannelHotcue(channelId: number, slotIndex: number): void {
    this.deckRuntime.triggerChannelHotcue(channelId, slotIndex);
  }

  setChannelCollapsed(channelId: number, collapsed: boolean): void {
    this.deckRuntime.setChannelCollapsed(channelId, collapsed);
  }

  setChannelCount(count: number): void {
    this.deckRuntime.setChannelCount(count);
  }

  getChannelCount(): number {
    return this.deckRuntime.getChannelCount();
  }

  resetDeckPlaybackToStart(): void {
    this.deckRuntime.resetDeckPlaybackToStart();
  }

  hydrateDeckLayout(deckState: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs?: HotcueTuple; collapsed?: boolean; channelVolume?: number; positionMs?: number; wasPlaying?: boolean; savedAt?: number }>): void {
    this.deckRuntime.hydrateDeckLayout(deckState);
  }

  restoreChannelPlaybackState(channelId: number, positionMs: number = 0, paused: boolean = true): void {
    this.deckRuntime.restoreChannelPlaybackState(channelId, positionMs, paused);
  }

  persistDeckLayoutSnapshot(): DeckLayoutSnapshotEntry[] {
    return this.deckRuntime.persistDeckLayoutSnapshot();
  }

  saveChannelHotcuesToPad(channelId: number): { ok: boolean; padId?: string; savedHotcuesMs?: HotcueTuple } {
    return this.deckRuntime.saveChannelHotcuesToPad(channelId);
  }

  setChannelVolume(channelId: number, volume: number): void {
    this.deckRuntime.setChannelVolume(channelId, volume);
  }

  getChannelVolume(channelId: number): number {
    return this.deckRuntime.getChannelVolume(channelId);
  }

  stopChannel(channelId: number, mode: StopMode = 'instant'): void {
    this.deckRuntime.stopChannel(channelId, mode);
  }

  stopAllPads(mode: StopMode = 'instant'): void {
    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      const stoppedAny = this.v3PadRuntime.stopAllPads(mode);
      if (stoppedAny) {
        this.notifyStateChange(true);
      } else {
        this.notifyStateChange();
      }
      this.stageEventsRuntime.emitAudioRuntimeStageInfo('stop_all');
      return;
    }

    this.audioInstances.forEach(instance => {
      if (instance.isPlaying) this.stopPad(instance.padId, mode);
    });
    this.deckRuntime.stopAllChannels(mode);
  }

  setGlobalMute(muted: boolean): void {
    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.globalMuted = muted;
      this.v3Engine.setGlobalMute(muted);
      this.notifyStateChange();
      return;
    }

    this.globalMuted = muted;
    this.audioInstances.forEach(instance => this.updateInstanceVolume(instance));
    this.deckRuntime.syncAllChannelVolumes();
    this.notifyStateChange();
  }

  setMasterVolume(volume: number): void {
    const safe = usesLegacyAudioRuntimePath(this.audioRuntimeStage)
      ? Math.max(0, Math.min(1, volume))
      : normalizePadVolumeValue(volume);
    this.pendingMasterVolume = safe;
    if (this.masterVolumeRafId !== null) return;

    this.masterVolumeRafId = requestAnimationFrame(() => {
      this.masterVolumeRafId = null;
      const next = this.pendingMasterVolume;
      this.pendingMasterVolume = null;
      if (typeof next !== 'number') return;
      if (Math.abs(this.masterVolume - next) < 0.0001) return;

      this.masterVolume = next;
      if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
        this.v3Engine.setMasterVolume(next);
      }
      if (this.sharedIOSGainNode && this.audioContext) {
        const now = this.audioContext.currentTime;
        const timing = this.getStopTimingProfile();
        this.sharedIOSGainNode.gain.cancelScheduledValues(now);
        this.sharedIOSGainNode.gain.setTargetAtTime(next, now, timing.masterSmoothingSec);
      }
      if (usesLegacyAudioRuntimePath(this.audioRuntimeStage) && !this.isIOS) {
        this.audioInstances.forEach(instance => this.updateInstanceVolume(instance));
      }
      this.deckRuntime.syncAllChannelVolumes();
      this.notifyStateChange();
    });
  }

  updatePadVolume(padId: string, volume: number): void {
    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      const registered = this.registeredPads.get(padId);
      if (!registered) return;
      const safe = normalizePadVolumeValue(volume);
      registered.volume = safe;
      this.v3Engine.setTransportVolume(padId, safe);
      this.notifyStateChange();
      return;
    }

    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    instance.volume = volume;
    const registered = this.registeredPads.get(padId);
    if (registered) registered.volume = volume;
    this.updateInstanceVolume(instance);
    this.notifyStateChange();
  }

  addStateChangeListener(listener: () => void): void { this.stateChangeListeners.add(listener); }
  removeStateChangeListener(listener: () => void): void { this.stateChangeListeners.delete(listener); }
  isPadRegistered(padId: string): boolean {
    return usesLegacyAudioRuntimePath(this.audioRuntimeStage) ? this.audioInstances.has(padId) : this.registeredPads.has(padId);
  }
  getAllRegisteredPads(): string[] {
    return usesLegacyAudioRuntimePath(this.audioRuntimeStage) ? Array.from(this.audioInstances.keys()) : Array.from(this.registeredPads.keys());
  }

  playStutterPad(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'playStutterPad', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.triggerStutter(padId);
      return;
    }
    this.legacyPadRuntime.playStutterPad(padId);
  }

  async preloadPad(padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string): Promise<boolean> {
    if (this.audioRuntimeStage === 'disabled') return false;

    if (usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      try {
        await this.registerPad(padId, padData, bankId, bankName);
      } catch {
        return false;
      }
      return this.audioInstances.has(padId);
    }

    return this.v3PadRuntime.preloadPad(padId, padData, bankId, bankName);
  }

  async forceWarmPad(padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string): Promise<boolean> {
    return this.audioRuntimeStage === 'disabled'
      ? false
      : usesLegacyAudioRuntimePath(this.audioRuntimeStage)
        ? this.preloadPad(padId, padData, bankId, bankName)
        : this.v3PadRuntime.forceWarmPad(padId, padData, bankId, bankName);
  }

  triggerToggle(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerToggle', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.togglePad(padId);
      return;
    }
    this.legacyPadRuntime.triggerToggle(padId);
  }

  triggerHoldStart(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerHoldStart', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.triggerHoldStart(padId);
      return;
    }
    this.legacyPadRuntime.triggerHoldStart(padId);
  }

  triggerHoldStop(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerHoldStop', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.triggerHoldStop(padId);
      return;
    }
    this.legacyPadRuntime.triggerHoldStop(padId);
  }

  triggerStutter(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerStutter', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.triggerStutter(padId);
      return;
    }
    this.legacyPadRuntime.triggerStutter(padId);
  }

  triggerUnmuteToggle(padId: string): void {
    if (this.audioRuntimeStage === 'disabled') {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'triggerUnmuteToggle', 'pad');
      return;
    }

    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      this.v3PadRuntime.triggerUnmuteToggle(padId);
      return;
    }
    this.legacyPadRuntime.triggerUnmuteToggle(padId);
  }

  toggleMutePad(padId: string): void {
    if (!usesLegacyAudioRuntimePath(this.audioRuntimeStage)) {
      emitAudioEngineDisabledRuntime(this.audioRuntimeStage, 'toggleMutePad', 'pad');
      return;
    }

    this.legacyPadRuntime.toggleMutePad(padId);
  }

  // Diagnostics.

  getDebugInfo() {
    return this.inspectionRuntime.getDebugInfo();
  }

  getIOSDebugInfo() {
    return this.inspectionRuntime.getIOSDebugInfo();
  }

  forceIOSUnlock() {
    if (this.iosAudioService) {
      return this.iosAudioService.forceUnlock();
    }
    return this.runtimeCore.preUnlockAudio().then(() => this.contextUnlocked);
  }

  async preUnlockAudio(): Promise<void> {
    return this.runtimeCore.preUnlockAudio();
  }

  getAudioState(): AudioSystemState {
    return this.inspectionRuntime.getAudioState();
  }

  getAudioRuntimeInfo(): AudioRuntimeInfo {
    return this.inspectionRuntime.getAudioRuntimeInfo();
  }

  getPadWarmStatus(padId: string): PadWarmStatus {
    return this.inspectionRuntime.getPadWarmStatus(padId);
  }

  getAudioRecoveryState(): AudioRecoveryState {
    return this.runtimeCore.getAudioRecoveryState();
  }

  async runDiagnostics(): Promise<DiagnosticResult> {
    return this.inspectionRuntime.runDiagnostics();
  }

  // Audio Engine V3 facade. diagnostics..
  getEngineBackendForPad(padId: string): AudioBackendType | null {
    return this.v3Engine.getEngineBackendForPad(padId);
  }

  getEngineHealth(): EngineHealth {
    return this.v3Engine.getEngineHealth();
  }
}

const globalPlaybackManager = new GlobalPlaybackManagerClass();
const globalPlaybackManagerApi: GlobalPlaybackManager = globalPlaybackManager;
const subscribeGlobalPlaybackState = createGlobalPlaybackStateSubscriber(globalPlaybackManager);

registerGlobalPlaybackDebug(globalPlaybackManager);

export function useGlobalPlaybackManager(): GlobalPlaybackManager {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => subscribeGlobalPlaybackState(forceUpdate), []);
  return globalPlaybackManagerApi;
}

export function useGlobalPlaybackManagerApi(): GlobalPlaybackManager {
  return globalPlaybackManagerApi;
}

export function usePadPlaybackState(padId: string, fallbackVolume: number) {
  return usePadPlaybackStateBinding(globalPlaybackManager, subscribeGlobalPlaybackState, padId, fallbackVolume);
}

export function usePadWarmStatus(padId: string): PadWarmStatus {
  return usePadWarmStatusBinding(globalPlaybackManager, subscribeGlobalPlaybackState, padId);
}
