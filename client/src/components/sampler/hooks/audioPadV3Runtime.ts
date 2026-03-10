import type { AudioEngineCore } from '../../../lib/audio-engine';
import type { AudioRuntimeStage } from './audioRuntimeStage';
import type { DeckPadSnapshot, StopMode } from './audioDeckRuntime';
import type { AudioPadRuntimeRegistrationData } from './audioPadRuntimeTypes';
import { AudioPadV3StateRuntime } from './audioPadV3StateRuntime';

const IS_IOS_ENV = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const IS_ANDROID_ENV = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
const IS_CAPACITOR_NATIVE = typeof window !== 'undefined' &&
  Boolean((window as any).Capacitor?.isNativePlatform?.());
const V3_PLAY_TIMEOUT_MS = IS_IOS_ENV ? 3200 : IS_ANDROID_ENV ? 4200 : 2800;
const V3_PAD_LOAD_FAILURE_THRESHOLD = 2;
const V3_PAD_QUARANTINE_THRESHOLD = IS_IOS_ENV ? 3 : 4;
const V3_POLYPHONY_CAP_DESKTOP = 9;
const V3_POLYPHONY_CAP_ANDROID_NATIVE = 6;
const V3_POLYPHONY_CAP_IOS_NATIVE = 5;
const V3_POLYPHONY_CAP_MOBILE_WEB = 4;
const V3_POLYPHONY_CAP_LOW_MEMORY = 3;
const V3_SHORT_PAD_BURST_MAX_DURATION_MS = 30_200;
const V3_SHORT_BURST_CAP_DESKTOP = 16;
const V3_SHORT_BURST_CAP_ANDROID_NATIVE = 9;
const V3_SHORT_BURST_CAP_IOS_NATIVE = 6;
const V3_SHORT_BURST_CAP_MOBILE_WEB = 7;
const V3_SHORT_BURST_CAP_LOW_MEMORY = 4;
// Keep a tiny Android-only guard to absorb duplicate synthetic gesture events
// without eating intentional rapid taps.
const V3_STUTTER_RETRIGGER_GUARD_MS = IS_ANDROID_ENV ? (IS_CAPACITOR_NATIVE ? 6 : 10) : 0;

type TransportStatePayload = Parameters<AudioEngineCore['registerTransport']>[1];

interface AudioPadV3RuntimeHost {
  getRegisteredPads(): Map<string, DeckPadSnapshot>;
  getEngine(): AudioEngineCore;
  getStateRuntime(): AudioPadV3StateRuntime;
  getAudioRuntimeStage(): AudioRuntimeStage;
  getNowMs(): number;
  getIsIOS(): boolean;
  createTransportState(snapshot: DeckPadSnapshot): TransportStatePayload;
  registerPad(padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string): Promise<void>;
  notifyStateChange(immediate?: boolean): void;
  emitAudioRuntimeStageInfo(action: string): void;
  emitPadPlayFailed(padId: string, reason: string, retryCount: number): void;
}

export class AudioPadV3Runtime {
  private readonly host: AudioPadV3RuntimeHost;
  private readonly playRetryCountByPad: Map<string, number> = new Map();
  private readonly preloadingPads: Set<string> = new Set();
  private readonly preloadPromiseByPad: Map<string, Promise<boolean>> = new Map();
  private playQueue: Promise<void> = Promise.resolve();

  constructor(host: AudioPadV3RuntimeHost) {
    this.host = host;
  }

  isPreloadingPad(padId: string): boolean {
    return this.preloadingPads.has(padId);
  }

  clearPadRuntimeState(padId: string): void {
    this.playRetryCountByPad.delete(padId);
    this.preloadingPads.delete(padId);
    this.preloadPromiseByPad.delete(padId);
    this.host.getStateRuntime().clearPlayTimeout(padId);
  }

  stopAllPads(mode: StopMode = 'instant'): boolean {
    const stateRuntime = this.host.getStateRuntime();
    stateRuntime.cancelAllPendingPlays();
    let stoppedAny = false;
    this.host.getRegisteredPads().forEach((_snapshot, padId) => {
      const stopped = this.stopPadBasic(padId, mode, {
        cancelPending: false,
        notify: false,
        emitAction: 'pad_stop',
      });
      if (stopped) stoppedAny = true;
    });
    stateRuntime.setActivePadId(null);
    return stoppedAny;
  }

  togglePad(padId: string): void {
    const engine = this.host.getEngine();
    const stateRuntime = this.host.getStateRuntime();
    if (stateRuntime.hasPendingPlay(padId)) {
      this.stopPadBasic(padId, 'instant');
      return;
    }
    const state = engine.getTransportState(padId);
    if (state?.isPlaying) {
      this.stopPadBasic(padId, 'instant');
      return;
    }
    this.playPadBasic(padId);
  }

  triggerHoldStart(padId: string): void {
    const engine = this.host.getEngine();
    const transport = engine.getTransportState(padId);
    if (transport?.isPlaying) return;
    if (this.playLoadedTransportImmediate(padId, { stageAction: 'pad_play_hold_loaded' })) return;
    this.playPadBasic(padId);
  }

  triggerHoldStop(padId: string): void {
    this.stopPadBasic(padId, 'instant');
  }

  triggerStutter(padId: string): void {
    const engine = this.host.getEngine();
    const stateRuntime = this.host.getStateRuntime();
    const nowMs = this.host.getNowMs();
    if (stateRuntime.shouldSkipStutterTrigger(padId, nowMs, V3_STUTTER_RETRIGGER_GUARD_MS)) {
      this.host.emitAudioRuntimeStageInfo('pad_stutter_guard_skip');
      return;
    }
    stateRuntime.noteStutterTrigger(padId, nowMs);

    if (stateRuntime.hasPendingPlay(padId)) {
      stateRuntime.cancelPendingPlay(padId);
    }
    const transport = engine.getTransportState(padId);
    if (transport?.isPlaying) {
      if (stateRuntime.isTransportRegionDirty(padId)) {
        this.stopPadBasic(padId, 'instant', {
          emitAction: null,
        });
        this.playPadBasic(padId, { forceRestart: true });
      } else {
        this.playLoadedTransportImmediate(padId, {
          retrigger: true,
          stageAction: 'pad_stutter_retrigger',
        });
      }
      return;
    }
    if (this.playLoadedTransportImmediate(padId, { stageAction: 'pad_stutter_loaded_start' })) {
      return;
    }
    this.playPadBasic(padId, { forceRestart: true });
  }

  triggerUnmuteToggle(padId: string): void {
    const engine = this.host.getEngine();
    const stateRuntime = this.host.getStateRuntime();
    if (stateRuntime.hasPendingPlay(padId)) {
      this.stopPadBasic(padId, 'instant');
      return;
    }
    const transport = engine.getTransportState(padId);
    const isActive = Boolean(transport?.isPlaying);
    if (!isActive) {
      this.playPadBasic(padId);
      return;
    }
    const nextMuted = !Boolean(transport?.softMuted);
    engine.setTransportSoftMuted(padId, nextMuted);
    this.host.notifyStateChange(true);
    this.host.emitAudioRuntimeStageInfo(nextMuted ? 'pad_soft_mute' : 'pad_soft_unmute');
  }

  async preloadPad(
    padId: string,
    padData: AudioPadRuntimeRegistrationData,
    bankId: string,
    bankName: string
  ): Promise<boolean> {
    try {
      await this.host.registerPad(padId, padData, bankId, bankName);
    } catch {
      return false;
    }

    const stateRuntime = this.host.getStateRuntime();
    const snapshot = this.host.getRegisteredPads().get(padId);
    if (!snapshot || !snapshot.audioUrl) return false;

    const quarantineRemainingMs = stateRuntime.getPadQuarantineRemainingMs(padId, snapshot.audioUrl);
    if (quarantineRemainingMs > 0) {
      stateRuntime.setLastBlocked(`pad_quarantined:${Math.ceil(quarantineRemainingMs)}`, padId);
      this.host.emitAudioRuntimeStageInfo('pad_preload_quarantined_blocked');
      return false;
    }

    const existingPreload = this.preloadPromiseByPad.get(padId);
    if (existingPreload) {
      return existingPreload;
    }

    this.preloadingPads.add(padId);
    this.host.notifyStateChange();
    this.host.emitAudioRuntimeStageInfo('pad_preload_start');

    const engine = this.host.getEngine();
    const preloadPromise = (async () => {
      try {
        await engine.registerTransport(padId, this.host.createTransportState(snapshot));
        stateRuntime.clearTransportRegionDirty(padId);
        stateRuntime.clearPadLoadFailureState(padId);
        return Boolean(engine.getTransportState(padId));
      } catch (error) {
        const errorMessage = String((error as Error)?.message || 'preload_error');
        if (errorMessage.startsWith('transport_load_failed:')) {
          const loadFailureState = stateRuntime.markPadLoadFailure(padId, V3_PAD_LOAD_FAILURE_THRESHOLD);
          const quarantineState = stateRuntime.maybeQuarantinePadOnLoadFailure(
            padId,
            snapshot.audioUrl,
            loadFailureState.count,
            errorMessage,
            this.host.getAudioRuntimeStage(),
            V3_PAD_QUARANTINE_THRESHOLD
          );
          stateRuntime.setLastBlocked(
            quarantineState
              ? `pad_quarantined:${errorMessage}`
              : loadFailureState.cooldownUntil !== null
                ? `transport_cooldown:${errorMessage}`
                : errorMessage,
            padId
          );
        }
        return false;
      } finally {
        this.preloadPromiseByPad.delete(padId);
        if (this.preloadingPads.delete(padId)) {
          this.host.notifyStateChange();
        }
      }
    })();

    this.preloadPromiseByPad.set(padId, preloadPromise);
    return preloadPromise;
  }

  forceWarmPad(padId: string, padData: AudioPadRuntimeRegistrationData, bankId: string, bankName: string): Promise<boolean> {
    return this.preloadPad(padId, padData, bankId, bankName);
  }

  playPadBasic(padId: string, options?: { forceRestart?: boolean }): void {
    const engine = this.host.getEngine();
    const stateRuntime = this.host.getStateRuntime();
    const snapshot = this.host.getRegisteredPads().get(padId);
    if (!snapshot || !snapshot.audioUrl) return;

    const quarantineRemainingMs = stateRuntime.getPadQuarantineRemainingMs(padId, snapshot.audioUrl);
    if (quarantineRemainingMs > 0) {
      const blockedReason = `pad_quarantined:${Math.ceil(quarantineRemainingMs)}`;
      stateRuntime.setLastBlocked(blockedReason, padId);
      this.host.emitPadPlayFailed(padId, blockedReason, 0);
      this.host.emitAudioRuntimeStageInfo('pad_play_quarantined_blocked');
      return;
    }

    const cooldownRemainingMs = stateRuntime.getPadLoadCooldownRemainingMs(padId);
    if (cooldownRemainingMs > 0) {
      this.host.emitPadPlayFailed(padId, `cooldown_active:${Math.ceil(cooldownRemainingMs)}`, 0);
      this.host.emitAudioRuntimeStageInfo('pad_play_cooldown_blocked');
      return;
    }

    const forceRestart = Boolean(options?.forceRestart);
    const existingState = engine.getTransportState(padId);
    if (existingState?.isPlaying && !forceRestart) {
      stateRuntime.setActivePadId(padId);
      return;
    }
    if (stateRuntime.hasPendingPlay(padId)) return;

    const token = stateRuntime.nextPlayToken(padId);
    stateRuntime.beginPendingPlay(padId);
    this.armPlayTimeout(padId, token);
    this.host.notifyStateChange();
    this.host.emitAudioRuntimeStageInfo('pad_pending_play');

    this.playQueue = this.playQueue
      .then(async () => {
        if (!stateRuntime.isPlayTokenCurrent(padId, token)) return;

        const latestSnapshot = this.host.getRegisteredPads().get(padId);
        if (!latestSnapshot || !latestSnapshot.audioUrl) {
          throw new Error(`pad_snapshot_missing:${padId}`);
        }
        if (this.host.getIsIOS()) {
          await engine.preUnlock();
        }
        if (latestSnapshot.playbackMode === 'stopper') {
          stateRuntime.cancelAllPendingPlays(padId);
          this.stopOtherPads(padId, 'instant');
        } else {
          this.enforcePolyphonyCap(padId);
        }

        const existingPreload = this.preloadPromiseByPad.get(padId);
        if (existingPreload) {
          await existingPreload.catch(() => false);
        }

        const loadStart = this.host.getNowMs();
        await engine.registerTransport(padId, this.host.createTransportState(latestSnapshot));
        stateRuntime.clearTransportRegionDirty(padId);
        stateRuntime.setLastPadLoadLatencyMs(Math.max(0, this.host.getNowMs() - loadStart));

        if (!stateRuntime.isPlayTokenCurrent(padId, token)) return;

        const playStart = this.host.getNowMs();
        engine.playTransport(padId);
        stateRuntime.setLastPadStartLatencyMs(Math.max(0, this.host.getNowMs() - playStart));

        const startedState = engine.getTransportState(padId);
        if (!startedState?.isPlaying) {
          throw new Error(`transport_not_started:${padId}`);
        }

        if (!stateRuntime.isPlayTokenCurrent(padId, token)) {
          this.stopPadBasic(padId, 'instant', {
            cancelPending: false,
            notify: false,
            emitAction: null,
            force: true,
          });
          return;
        }

        stateRuntime.setActivePadId(padId);
        this.enforcePolyphonyCap(padId);
        this.playRetryCountByPad.delete(padId);
        stateRuntime.clearPadLoadFailureState(padId);
        stateRuntime.clearPadQuarantineState(padId, 'play_success', this.host.getAudioRuntimeStage());
        this.host.notifyStateChange(true);
        this.host.emitAudioRuntimeStageInfo('pad_play');
      })
      .catch((error) => {
        if (!stateRuntime.isPlayTokenCurrent(padId, token)) return;
        const errorMessage = String((error as Error)?.message || 'play_error');
        const isTransportLoadFailed = errorMessage.startsWith('transport_load_failed:');
        const loadFailureState = isTransportLoadFailed
          ? stateRuntime.markPadLoadFailure(padId, V3_PAD_LOAD_FAILURE_THRESHOLD)
          : { count: 0, cooldownUntil: null as number | null };
        const latestSnapshot = this.host.getRegisteredPads().get(padId) || snapshot;
        const quarantineState = isTransportLoadFailed
          ? stateRuntime.maybeQuarantinePadOnLoadFailure(
            padId,
            latestSnapshot.audioUrl,
            loadFailureState.count,
            errorMessage,
            this.host.getAudioRuntimeStage(),
            V3_PAD_QUARANTINE_THRESHOLD
          )
          : null;
        const retryCount = this.playRetryCountByPad.get(padId) || 0;
        const canRetry =
          retryCount < 1 &&
          !(isTransportLoadFailed && (loadFailureState.cooldownUntil !== null || quarantineState !== null));
        if (canRetry) {
          this.playRetryCountByPad.set(padId, retryCount + 1);
          stateRuntime.cancelPendingPlay(padId);
          this.host.emitAudioRuntimeStageInfo('pad_play_error_retry');
          this.playPadBasic(padId, { forceRestart: true });
          return;
        }
        stateRuntime.cancelPendingPlay(padId);
        if (stateRuntime.getActivePadId() === padId) {
          stateRuntime.setActivePadId(null);
        }
        const reason = quarantineState
          ? `pad_quarantined:${errorMessage}`
          : isTransportLoadFailed && loadFailureState.cooldownUntil !== null
            ? `transport_cooldown:${errorMessage}`
            : errorMessage;
        this.host.emitPadPlayFailed(padId, reason, retryCount);
        this.host.notifyStateChange(true);
        this.host.emitAudioRuntimeStageInfo(quarantineState ? 'pad_play_quarantined' : 'pad_play_failed_error');
      })
      .finally(() => {
        if (stateRuntime.isPlayTokenCurrent(padId, token)) {
          const hadPending = stateRuntime.finishPendingPlayIfCurrent(padId, token);
          if (hadPending) {
            this.host.notifyStateChange();
          }
        }
      });
  }

  stopPadBasic(
    padId: string,
    mode: StopMode = 'instant',
    options?: { cancelPending?: boolean; notify?: boolean; emitAction?: string | null; force?: boolean }
  ): boolean {
    const engine = this.host.getEngine();
    const stateRuntime = this.host.getStateRuntime();
    const shouldCancelPending = options?.cancelPending !== false;
    const transport = engine.getTransportState(padId);
    const hasPendingPlay = stateRuntime.hasPendingPlay(padId);
    const isActive = Boolean(transport?.isPlaying) || hasPendingPlay;
    if (!isActive && !options?.force) return false;

    if (shouldCancelPending) {
      stateRuntime.cancelPendingPlay(padId);
    }
    stateRuntime.clearPlayTimeout(padId);
    this.playRetryCountByPad.delete(padId);

    const stopStart = this.host.getNowMs();
    engine.stopTransport(padId, mode);
    stateRuntime.setLastPadStopLatencyMs(Math.max(0, this.host.getNowMs() - stopStart));
    if (stateRuntime.getActivePadId() === padId) {
      stateRuntime.setActivePadId(null);
    }

    if (options?.notify !== false) {
      this.host.notifyStateChange(true);
      if (mode !== 'instant') {
        setTimeout(() => {
          this.host.notifyStateChange(true);
        }, 0);
      }
    }

    const action = options?.emitAction === undefined ? 'pad_stop' : options.emitAction;
    if (action) {
      this.host.emitAudioRuntimeStageInfo(action);
    }
    return true;
  }

  private armPlayTimeout(padId: string, token: number): void {
    const stateRuntime = this.host.getStateRuntime();
    stateRuntime.armPlayTimeout(padId, token, () => {
      if (!stateRuntime.isPlayTokenCurrent(padId, token)) return;
      if (!stateRuntime.hasPendingPlay(padId)) return;

      const retryCount = this.playRetryCountByPad.get(padId) || 0;
      if (retryCount < 1) {
        this.playRetryCountByPad.set(padId, retryCount + 1);
        stateRuntime.cancelPendingPlay(padId);
        this.host.emitAudioRuntimeStageInfo('pad_play_timeout_retry');
        this.playPadBasic(padId, { forceRestart: true });
        return;
      }

      stateRuntime.cancelPendingPlay(padId);
      if (stateRuntime.getActivePadId() === padId) {
        stateRuntime.setActivePadId(null);
      }
      this.host.emitPadPlayFailed(padId, 'timeout', retryCount);
      this.host.notifyStateChange(true);
      this.host.emitAudioRuntimeStageInfo('pad_play_failed_timeout');
    }, V3_PLAY_TIMEOUT_MS);
  }

  private playLoadedTransportImmediate(
    padId: string,
    options?: { retrigger?: boolean; stageAction?: string }
  ): boolean {
    const engine = this.host.getEngine();
    const stateRuntime = this.host.getStateRuntime();
    const transport = engine.getTransportState(padId);
    if (!transport) return false;
    if (stateRuntime.isTransportRegionDirty(padId)) {
      this.host.emitAudioRuntimeStageInfo('pad_region_dirty_rehydrate_required');
      return false;
    }

    const snapshot = this.host.getRegisteredPads().get(padId);
    if (snapshot?.playbackMode === 'stopper') {
      stateRuntime.cancelAllPendingPlays(padId);
      this.stopOtherPads(padId, 'instant');
    } else {
      this.enforcePolyphonyCap(padId);
    }

    const playStart = this.host.getNowMs();
    engine.playTransport(padId, { retrigger: Boolean(options?.retrigger) });
    stateRuntime.setLastPadStartLatencyMs(Math.max(0, this.host.getNowMs() - playStart));
    stateRuntime.setActivePadId(padId);
    this.enforcePolyphonyCap(padId);
    this.host.notifyStateChange(true);
    if (options?.stageAction) {
      this.host.emitAudioRuntimeStageInfo(options.stageAction);
    }
    return true;
  }

  private stopOtherPads(targetPadId: string, mode: StopMode = 'instant'): void {
    this.getCurrentlyPlayingPads().forEach(({ padId: playingPadId }) => {
      if (playingPadId === targetPadId) return;
      this.stopPadBasic(playingPadId, mode, {
        emitAction: null,
        notify: false,
      });
    });
  }

  private enforcePolyphonyCap(targetPadId?: string): void {
    const longCap = this.getPolyphonyCap();
    const shortCap = this.getShortBurstCap();
    const totalCap = longCap + shortCap;
    const currentlyPlaying = this.getCurrentlyPlayingPads();
    let activeLong = currentlyPlaying.reduce((count, entry) => count + (entry.isShortBurst ? 0 : 1), 0);
    let activeShort = currentlyPlaying.reduce((count, entry) => count + (entry.isShortBurst ? 1 : 0), 0);
    let activeTotal = currentlyPlaying.length;
    if (activeLong <= longCap && activeShort <= shortCap && activeTotal <= totalCap) return;

    const stealCandidates = currentlyPlaying
      .filter((entry) => entry.padId !== targetPadId)
      .sort((left, right) => left.playStartTime - right.playStartTime);
    let stoleAny = false;
    while ((activeLong > longCap || activeShort > shortCap || activeTotal > totalCap) && stealCandidates.length > 0) {
      let victimIndex = -1;
      if (activeLong > longCap) {
        victimIndex = stealCandidates.findIndex((entry) => !entry.isShortBurst);
      } else if (activeShort > shortCap) {
        victimIndex = stealCandidates.findIndex((entry) => entry.isShortBurst);
      } else if (activeTotal > totalCap) {
        victimIndex = stealCandidates.findIndex((entry) => entry.isShortBurst);
        if (victimIndex < 0) victimIndex = 0;
      }
      if (victimIndex < 0) break;
      const [victim] = stealCandidates.splice(victimIndex, 1);
      if (!victim) continue;
      const stopped = this.stopPadBasic(victim.padId, 'instant', {
        emitAction: 'pad_voice_steal',
        notify: false,
      });
      if (stopped) {
        activeTotal -= 1;
        if (victim.isShortBurst) activeShort = Math.max(0, activeShort - 1);
        else activeLong = Math.max(0, activeLong - 1);
        stoleAny = true;
      }
    }
    if (stoleAny) {
      this.host.notifyStateChange(true);
      this.host.emitAudioRuntimeStageInfo('pad_polyphony_cap_enforced');
    }
  }

  private getCurrentlyPlayingPads(): Array<{ padId: string; playStartTime: number; isShortBurst: boolean }> {
    const playingPads: Array<{ padId: string; playStartTime: number; isShortBurst: boolean }> = [];
    this.host.getRegisteredPads().forEach((snapshot, registeredPadId) => {
      const transport = this.host.getEngine().getTransportState(registeredPadId);
      if (!transport?.isPlaying) return;
      playingPads.push({
        padId: registeredPadId,
        playStartTime: transport.playStartTime || 0,
        isShortBurst: this.isShortBurstCandidate(snapshot),
      });
    });
    return playingPads;
  }

  private isShortBurstCandidate(snapshot: DeckPadSnapshot): boolean {
    if (snapshot.playbackMode === 'stopper') return false;
    const windowMs = this.resolvePadWindowMs(snapshot);
    if (windowMs === null) return false;
    return windowMs > 0 && windowMs <= V3_SHORT_PAD_BURST_MAX_DURATION_MS;
  }

  private resolvePadWindowMs(snapshot: DeckPadSnapshot): number | null {
    const startMs = Number.isFinite(snapshot.startTimeMs) ? Math.max(0, snapshot.startTimeMs) : 0;
    const endMs = Number.isFinite(snapshot.endTimeMs) ? Math.max(0, snapshot.endTimeMs) : 0;
    if (endMs > startMs) {
      return Math.max(0, endMs - startMs);
    }
    const durationMs = Number.isFinite(snapshot.audioDurationMs) ? Math.max(0, snapshot.audioDurationMs || 0) : 0;
    if (durationMs > 0) {
      return Math.max(0, durationMs - startMs);
    }
    return null;
  }

  private getPolyphonyCap(): number {
    let cap = V3_POLYPHONY_CAP_DESKTOP;
    if (IS_CAPACITOR_NATIVE) {
      cap = IS_IOS_ENV ? V3_POLYPHONY_CAP_IOS_NATIVE : V3_POLYPHONY_CAP_ANDROID_NATIVE;
    } else if (IS_IOS_ENV || IS_ANDROID_ENV) {
      cap = V3_POLYPHONY_CAP_MOBILE_WEB;
    }
    const memoryGiB = this.getDeviceMemoryGiB();
    if (memoryGiB !== null && memoryGiB <= 2) {
      cap = Math.min(cap, V3_POLYPHONY_CAP_LOW_MEMORY);
    }
    return Math.max(2, cap);
  }

  private getShortBurstCap(): number {
    let cap = V3_SHORT_BURST_CAP_DESKTOP;
    if (IS_CAPACITOR_NATIVE) {
      cap = IS_IOS_ENV ? V3_SHORT_BURST_CAP_IOS_NATIVE : V3_SHORT_BURST_CAP_ANDROID_NATIVE;
    } else if (IS_IOS_ENV || IS_ANDROID_ENV) {
      cap = V3_SHORT_BURST_CAP_MOBILE_WEB;
    }
    const memoryGiB = this.getDeviceMemoryGiB();
    if (memoryGiB !== null && memoryGiB <= 2) {
      cap = Math.min(cap, V3_SHORT_BURST_CAP_LOW_MEMORY);
    }
    return Math.max(2, cap);
  }

  private getDeviceMemoryGiB(): number | null {
    if (typeof navigator === 'undefined') return null;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof memory !== 'number' || !Number.isFinite(memory) || memory <= 0) return null;
    return memory;
  }
}
