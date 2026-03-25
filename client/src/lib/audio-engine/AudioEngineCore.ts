/**
 * Audio Engine V3 - Core Engine
 *
 * Singleton that owns the AudioContext, master gain chain, and manages
 * unified transports for both pad and channel playback.
 *
 * Delegates to BufferBackend or MediaBackend per asset, and uses
 * the shared StopScheduler for all stop modes.
 */

import {
    type TransportState,
    type IAudioBackend,
    type AudioBackendType,
    type EqSettings,
    type EngineHealth,
    type EngineConfig,
    type StopMode,
    type HotcueTuple,
    type PlaybackMode,
    DEFAULT_ENGINE_CONFIG,
    IS_IOS,
    IS_ANDROID,
    MAX_PLAYBACK_CHANNELS,
} from './types';
import { selectBackend, shouldFallbackToMedia } from './BackendSelector';
import { BufferBackend } from './BufferBackend';
import { MediaBackend } from './MediaBackend';
import { executeStop, type StopTarget } from './StopScheduler';
import { computeGain, applyGain, safeVolume } from './GainPipeline';
import { LifecycleManager, type LifecycleDelegate } from './LifecycleManager';
import { getIOSAudioService } from '../ios-audio-service';

const IS_CAPACITOR_NATIVE =
    typeof window !== 'undefined' &&
    Boolean((window as any).Capacitor?.isNativePlatform?.());

const FIXED_HEADROOM_GAIN = IS_CAPACITOR_NATIVE ? 0.78 : 0.84;
const RETRIGGER_ENVELOPE_SEC = IS_ANDROID ? 0.004 : 0.0025;
const MIN_REGION_MS = 12;
const MIN_FADE_MS = 8;
const PLAY_FINALIZE_SLACK_MS = 10;
const MAX_LOADED_TRANSPORTS_CAP_IOS = 16;
const MAX_LOADED_TRANSPORTS_CAP_ANDROID = 28;
const MAX_LOADED_TRANSPORTS_IOS_WEB = 14;
const MAX_LOADED_TRANSPORTS_IOS_WEB_PRESSURE = 10;
const MAX_LOADED_TRANSPORTS_ANDROID_WEB = 40;
const MAX_LOADED_TRANSPORTS_DESKTOP = 96;
const TOTAL_TRANSPORT_CAP_IOS_NATIVE = 24;
const TOTAL_TRANSPORT_CAP_IOS_WEB = 18;
const TOTAL_TRANSPORT_CAP_IOS_WEB_PRESSURE = 14;
const TOTAL_TRANSPORT_CAP_ANDROID = 64;
const TOTAL_TRANSPORT_CAP_DESKTOP = 192;
const HOT_TRANSPORT_PADS_CHANGED_EVENT = 'vdjv-audio-transport-hot-pads-changed';
const IOS_WEB_PRESSURE_WINDOW_MS = 12_000;
const IOS_WEB_PRESSURE_MIN_EVICTIONS = 3;
const IOS_WEB_PRESSURE_COOLDOWN_MS = 45_000;

interface ManagedTransport {
    state: TransportState;
    backend: IAudioBackend | null;
    gainNode: GainNode | null;
    gainConnectedToMaster: boolean;
    eqNodes: { low: BiquadFilterNode | null; mid: BiquadFilterNode | null; high: BiquadFilterNode | null };
    stopCancel: (() => void) | null;
    playFinalizeTimeout: ReturnType<typeof setTimeout> | null;
    fadeOutTimeout: ReturnType<typeof setTimeout> | null;
    lastAccessAt: number;
}

export class AudioEngineCore implements LifecycleDelegate {
    private static instance: AudioEngineCore | null = null;

    private config: EngineConfig;
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private limiterNode: DynamicsCompressorNode | null = null;
    private contextUnlocked = false;
    private isPrewarmed = false;

    private transports = new Map<string, ManagedTransport>();
    private transportRegistrationQueue = new Map<string, Promise<void>>();
    private stateListeners = new Set<() => void>();
    private notifyTimeout: ReturnType<typeof setTimeout> | null = null;
    private idleCacheTrimTimeout: ReturnType<typeof setTimeout> | null = null;

    private masterVolume = 1;
    private globalMuted = false;
    private globalEQ: EqSettings = { low: 0, mid: 0, high: 0 };

    private lifecycle: LifecycleManager;
    private iosAudioService: any = null;
    private transportEvictScheduled = false;
    private transportEvictions = 0;
    private lastEvictedPadId: string | null = null;
    private lastEvictedAt: number | null = null;
    private recentEvictionTimestamps: number[] = [];
    private pressureModeUntil = 0;
    private forceMediaPads = new Set<string>();
    private preservePitchFallbackPads = new Set<string>();
    private hotTransportPadIds = new Set<string>();

    static getInstance(config?: Partial<EngineConfig>): AudioEngineCore {
        if (!AudioEngineCore.instance) {
            AudioEngineCore.instance = new AudioEngineCore(config);
        }
        return AudioEngineCore.instance;
    }

    /** Reset singleton (testing only). */
    static resetInstance(): void {
        if (AudioEngineCore.instance) {
            AudioEngineCore.instance.destroy();
            AudioEngineCore.instance = null;
        }
    }

    private constructor(config?: Partial<EngineConfig>) {
        this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };

        if (IS_IOS) {
            this.iosAudioService = getIOSAudioService();
            this.iosAudioService.onUnlock(() => {
                this.contextUnlocked = true;
                this.ctx = this.iosAudioService.getAudioContext();
                this.setupMasterGain();
            });
        }

        this.lifecycle = new LifecycleManager(this);
        this.initAudioContext();

        if (typeof window !== 'undefined') {
            window.addEventListener(HOT_TRANSPORT_PADS_CHANGED_EVENT, this.handleHotTransportPadsChanged as EventListener);
        }
    }

    private handleBackendEnded(padId: string, expectedBackend: IAudioBackend): void {
        const t = this.transports.get(padId);
        if (!t || t.backend !== expectedBackend) return;
        if (!t.state.isPlaying) return;
        if (t.state.playbackMode === 'loop') return;
        this.finalizePlayback(t, { skipBackendStop: true });
    }

    private getLoadedTransportBudget(): number {
        if (IS_CAPACITOR_NATIVE) {
            return IS_IOS ? MAX_LOADED_TRANSPORTS_CAP_IOS : MAX_LOADED_TRANSPORTS_CAP_ANDROID;
        }
        if (IS_IOS) {
            return this.isPressureModeActive()
                ? MAX_LOADED_TRANSPORTS_IOS_WEB_PRESSURE
                : MAX_LOADED_TRANSPORTS_IOS_WEB;
        }
        if (IS_ANDROID) return MAX_LOADED_TRANSPORTS_ANDROID_WEB;
        return MAX_LOADED_TRANSPORTS_DESKTOP;
    }

    private getTotalTransportCap(): number {
        if (IS_IOS) {
            if (IS_CAPACITOR_NATIVE) return TOTAL_TRANSPORT_CAP_IOS_NATIVE;
            return this.isPressureModeActive()
                ? TOTAL_TRANSPORT_CAP_IOS_WEB_PRESSURE
                : TOTAL_TRANSPORT_CAP_IOS_WEB;
        }
        if (IS_ANDROID) return TOTAL_TRANSPORT_CAP_ANDROID;
        return TOTAL_TRANSPORT_CAP_DESKTOP;
    }

    private isPressureModeActive(): boolean {
        return !IS_CAPACITOR_NATIVE && IS_IOS && this.pressureModeUntil > Date.now();
    }

    private pruneRecentEvictions(now: number): void {
        this.recentEvictionTimestamps = this.recentEvictionTimestamps.filter(
            (timestamp) => now - timestamp <= IOS_WEB_PRESSURE_WINDOW_MS
        );
    }

    private registerTransportEviction(now: number): void {
        if (!IS_IOS || IS_CAPACITOR_NATIVE) return;
        this.recentEvictionTimestamps.push(now);
        this.pruneRecentEvictions(now);
        if (this.recentEvictionTimestamps.length >= IOS_WEB_PRESSURE_MIN_EVICTIONS) {
            this.pressureModeUntil = Math.max(this.pressureModeUntil, now + IOS_WEB_PRESSURE_COOLDOWN_MS);
            BufferBackend.trimIdleCache();
        }
    }

    private touchTransport(transport: ManagedTransport): void {
        transport.lastAccessAt = Date.now();
    }

    private canEvictTransport(transport: ManagedTransport): boolean {
        if (!transport.backend) return false;
        if (transport.state.isPlaying) return false;
        if (transport.state.isPaused) return false;
        if (transport.stopCancel) return false;
        return true;
    }

    private handleHotTransportPadsChanged = (event: Event): void => {
        const detail = (event as CustomEvent<{ padIds?: unknown }>).detail;
        const padIds = Array.isArray(detail?.padIds)
            ? detail.padIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
            : [];
        this.hotTransportPadIds = new Set(padIds);
    };

    private compareTransportEvictionPriority(
        left: [string, ManagedTransport],
        right: [string, ManagedTransport]
    ): number {
        const leftHot = this.hotTransportPadIds.has(left[0]) ? 1 : 0;
        const rightHot = this.hotTransportPadIds.has(right[0]) ? 1 : 0;
        if (leftHot !== rightHot) {
            return leftHot - rightHot;
        }
        return left[1].lastAccessAt - right[1].lastAccessAt;
    }

    private enforceTransportBudget(excludePadId?: string): void {
        const budget = this.getLoadedTransportBudget();
        if (budget <= 0) return;

        const loadedEntries = Array.from(this.transports.entries()).filter(([, transport]) => Boolean(transport.backend));
        if (loadedEntries.length <= budget) return;

        let loadedCount = loadedEntries.length;
        const evictCandidates = loadedEntries
            .filter(([padId, transport]) => padId !== excludePadId && this.canEvictTransport(transport))
            .sort((left, right) => this.compareTransportEvictionPriority(left, right));

        while (loadedCount > budget && evictCandidates.length > 0) {
            const [padId] = evictCandidates.shift()!;
            this.transportEvictions += 1;
            this.lastEvictedPadId = padId;
            this.lastEvictedAt = Date.now();
            this.registerTransportEviction(this.lastEvictedAt);
            this.disposeTransport(padId);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('vdjv-audio-transport-evict', {
                    detail: {
                        padId,
                        budget,
                        loadedBeforeEvict: loadedCount
                    }
                }));
            }
            loadedCount -= 1;
        }

        if (this.isPressureModeActive()) {
            BufferBackend.trimIdleCache();
        }

        if (loadedCount > budget && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vdjv-audio-transport-budget-blocked', {
                detail: {
                    budget,
                    loadedCount,
                    blockedCandidates: evictCandidates.length
                }
            }));
        }
    }

    private enforceTotalTransportCap(excludePadId?: string): void {
        const cap = this.getTotalTransportCap();
        if (cap <= 0) return;
        if (this.transports.size <= cap) return;

        const removable = Array.from(this.transports.entries())
            .filter(([padId, transport]) => {
                if (padId === excludePadId) return false;
                if (transport.state.isPlaying) return false;
                if (transport.state.isPaused) return false;
                if (transport.stopCancel) return false;
                return true;
            })
            .sort((left, right) => {
                const leftUnloaded = left[1].backend ? 1 : 0;
                const rightUnloaded = right[1].backend ? 1 : 0;
                if (leftUnloaded !== rightUnloaded) return leftUnloaded - rightUnloaded;
                return this.compareTransportEvictionPriority(left, right);
            });

        while (this.transports.size > cap && removable.length > 0) {
            const [padId] = removable.shift()!;
            this.disposeTransport(padId);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('vdjv-audio-transport-gc-dispose', {
                    detail: {
                        padId,
                        cap,
                        totalBeforeDispose: this.transports.size + 1
                    }
                }));
            }
        }
    }

    private scheduleTransportBudgetEnforcement(excludePadId?: string): void {
        if (this.transportEvictScheduled) return;
        this.transportEvictScheduled = true;
        setTimeout(() => {
            this.transportEvictScheduled = false;
            this.enforceTransportBudget(excludePadId);
            this.enforceTotalTransportCap(excludePadId);
            this.scheduleIdleCacheTrim();
        }, 0);
    }

    private hasActivePlayback(): boolean {
        for (const transport of this.transports.values()) {
            if (transport.state.isPlaying || transport.state.isPaused || transport.stopCancel) {
                return true;
            }
        }
        return false;
    }

    private scheduleIdleCacheTrim(): void {
        if (this.idleCacheTrimTimeout) return;
        this.idleCacheTrimTimeout = setTimeout(() => {
            this.idleCacheTrimTimeout = null;
            if (this.hasActivePlayback()) return;
            BufferBackend.trimIdleCache();
        }, 1800);
    }

    private initAudioContext(): void {
        if (this.ctx) return;

        try {
            if (IS_IOS && this.iosAudioService) {
                this.ctx = this.iosAudioService.getAudioContext();
                this.contextUnlocked = this.iosAudioService.isUnlocked();
                if (this.contextUnlocked) this.setupMasterGain();
                return;
            }

            const AC = window.AudioContext || (window as any).webkitAudioContext;
            const latencyHint: AudioContextLatencyCategory = IS_CAPACITOR_NATIVE ? 'balanced' : 'interactive';
            this.ctx = new AC({ latencyHint });
            this.setupMasterGain();

            if (!this.contextUnlocked) this.setupUnlockListeners();
        } catch {
        }
    }

    private setupMasterGain(): void {
        if (!this.ctx || this.masterGain) return;
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
        try {
            this.limiterNode = this.ctx.createDynamicsCompressor();
            // Protection-only limiter to catch overload peaks.
            this.limiterNode.threshold.setValueAtTime(-2, this.ctx.currentTime);
            this.limiterNode.knee.setValueAtTime(8, this.ctx.currentTime);
            this.limiterNode.ratio.setValueAtTime(20, this.ctx.currentTime);
            this.limiterNode.attack.setValueAtTime(0.003, this.ctx.currentTime);
            this.limiterNode.release.setValueAtTime(0.08, this.ctx.currentTime);
            this.masterGain.connect(this.limiterNode);
            this.limiterNode.connect(this.ctx.destination);
        } catch {
            this.limiterNode = null;
            this.masterGain.connect(this.ctx.destination);
        }
        this.reconcileTransportGainConnections();
    }

    private reconcileTransportGainConnections(): void {
        if (!this.masterGain) return;
        for (const transport of this.transports.values()) {
            if (transport.eqNodes.low && !transport.gainConnectedToMaster) {
                try {
                    transport.eqNodes.low.connect(this.masterGain);
                    transport.gainConnectedToMaster = true;
                } catch {
                    // Ignore connect failures for stale nodes; transport will re-register on next play.
                }
                continue;
            }
            if (!transport.gainNode || transport.gainConnectedToMaster) continue;
            try {
                transport.gainNode.connect(this.masterGain);
                transport.gainConnectedToMaster = true;
            } catch {
                // Ignore connect failures for stale nodes; transport will re-register on next play.
            }
        }
    }

    private ensureTransportStopFilterNode(t: ManagedTransport): BiquadFilterNode | null {
        if (!this.ctx || !this.masterGain || !t.gainNode) return null;
        if (!t.eqNodes.low) {
            const filterNode = this.ctx.createBiquadFilter();
            filterNode.type = 'lowpass';
            filterNode.frequency.setValueAtTime(20000, this.ctx.currentTime);
            filterNode.Q.setValueAtTime(0.707, this.ctx.currentTime);
            try {
                if (t.gainConnectedToMaster) {
                    t.gainNode.disconnect(this.masterGain);
                } else {
                    try { t.gainNode.disconnect(); } catch { /* */ }
                }
            } catch {
                try { t.gainNode.disconnect(); } catch { /* */ }
            }
            t.gainNode.connect(filterNode);
            filterNode.connect(this.masterGain);
            t.eqNodes.low = filterNode;
            t.gainConnectedToMaster = true;
        }
        return t.eqNodes.low;
    }

    private resetTransportStopFilterNode(t: ManagedTransport): void {
        if (!this.ctx || !t.eqNodes.low) return;
        const now = this.ctx.currentTime;
        t.eqNodes.low.type = 'lowpass';
        t.eqNodes.low.frequency.cancelScheduledValues(now);
        t.eqNodes.low.Q.cancelScheduledValues(now);
        t.eqNodes.low.frequency.setValueAtTime(20000, now);
        t.eqNodes.low.Q.setValueAtTime(0.707, now);
    }

    private computeTransportGain(t: ManagedTransport): number {
        return computeGain({
            padVolume: t.state.volume,
            padGain: safeVolume(t.state.gain, 1) * FIXED_HEADROOM_GAIN,
            channelVolume: null,
            // Master volume is applied by the master gain node.
            masterVolume: 1,
            globalMuted: this.globalMuted,
            softMuted: t.state.softMuted,
        });
    }

    private applyTransportGain(t: ManagedTransport, smoothingSec: number = 0.01): void {
        if (!t.gainNode || !this.ctx) return;
        applyGain(t.gainNode, this.ctx, this.computeTransportGain(t), smoothingSec);
    }

    private clearPlaybackAutomation(t: ManagedTransport): void {
        if (t.fadeOutTimeout) {
            clearTimeout(t.fadeOutTimeout);
            t.fadeOutTimeout = null;
        }
        if (t.playFinalizeTimeout) {
            clearTimeout(t.playFinalizeTimeout);
            t.playFinalizeTimeout = null;
        }
    }

    private resolvePlaybackRegionMs(t: ManagedTransport): { startMs: number; endMs: number; windowMs: number } {
        const durationMsRaw = t.backend?.getDurationMs() ?? 0;
        const durationMs = Number.isFinite(durationMsRaw) && durationMsRaw > 0 ? durationMsRaw : 0;

        const rawStartMs = Number.isFinite(t.state.startTimeMs) ? Math.max(0, t.state.startTimeMs) : 0;
        const rawEndMs = Number.isFinite(t.state.endTimeMs) ? Math.max(0, t.state.endTimeMs) : 0;

        const startMs = durationMs > 0 ? Math.min(rawStartMs, Math.max(0, durationMs - MIN_REGION_MS)) : rawStartMs;
        const fallbackEndMs = durationMs > 0 ? durationMs : startMs + MIN_REGION_MS;
        const desiredEndMs = rawEndMs > 0 ? rawEndMs : fallbackEndMs;
        const endMsUnclamped = durationMs > 0 ? Math.min(desiredEndMs, durationMs) : desiredEndMs;
        const endMs = Math.max(startMs + MIN_REGION_MS, endMsUnclamped);

        return {
            startMs,
            endMs,
            windowMs: Math.max(MIN_REGION_MS, endMs - startMs),
        };
    }

    private applyStartEnvelope(t: ManagedTransport): void {
        const targetGain = this.computeTransportGain(t);
        if (!t.gainNode || !this.ctx) return;

        const region = this.resolvePlaybackRegionMs(t);
        const fadeInMs = Math.max(0, Math.min(t.state.fadeInMs || 0, Math.max(0, region.windowMs - MIN_FADE_MS)));
        const now = this.ctx.currentTime;
        t.gainNode.gain.cancelScheduledValues(now);

        if (fadeInMs >= MIN_FADE_MS) {
            t.gainNode.gain.setValueAtTime(0, now);
            t.gainNode.gain.linearRampToValueAtTime(targetGain, now + (fadeInMs / 1000));
            return;
        }

        t.gainNode.gain.setValueAtTime(targetGain, now);
    }

    private finalizePlayback(t: ManagedTransport, options?: { skipBackendStop?: boolean }): void {
        this.clearPlaybackAutomation(t);
        if (!options?.skipBackendStop) {
            t.backend?.stop();
        }
        t.state.isPlaying = false;
        t.state.isPaused = false;
        t.state.progress = 0;
        t.state.playStartTime = null;
        t.stopCancel = null;
        this.touchTransport(t);
        this.scheduleTransportBudgetEnforcement();
        this.notifyStateChange();
    }

    private schedulePlaybackAutomation(t: ManagedTransport): void {
        this.clearPlaybackAutomation(t);
        if (!t.state.isPlaying) return;
        if (t.state.playbackMode === 'loop') return;

        const region = this.resolvePlaybackRegionMs(t);
        const playbackRate = this.getTransportSpeedRate(t);
        const effectiveWindowMs = Math.max(MIN_REGION_MS, region.windowMs / playbackRate);
        const fadeOutMs = Math.max(0, Math.min(t.state.fadeOutMs || 0, Math.max(0, effectiveWindowMs - MIN_FADE_MS)));

        if (fadeOutMs >= MIN_FADE_MS && t.gainNode && this.ctx) {
            const fadeDelayMs = Math.max(0, effectiveWindowMs - fadeOutMs);
            t.fadeOutTimeout = setTimeout(() => {
                t.fadeOutTimeout = null;
                if (!t.state.isPlaying || !t.gainNode || !this.ctx) return;
                const now = this.ctx.currentTime;
                t.gainNode.gain.cancelScheduledValues(now);
                t.gainNode.gain.setValueAtTime(Math.max(0, t.gainNode.gain.value), now);
                t.gainNode.gain.linearRampToValueAtTime(0, now + (fadeOutMs / 1000));
            }, fadeDelayMs);
        }

        t.playFinalizeTimeout = setTimeout(() => {
            t.playFinalizeTimeout = null;
            if (!t.state.isPlaying) return;
            this.finalizePlayback(t);
        }, effectiveWindowMs + PLAY_FINALIZE_SLACK_MS);
    }

    private getTransportSpeedRate(t: ManagedTransport): number {
        if (t.backend) {
            const backendRate = t.backend.getEffectivePlaybackRate();
            if (Number.isFinite(backendRate) && backendRate > 0) {
                return Math.max(0.05, backendRate);
            }
        }
        const tempoRate = Number.isFinite(t.state.tempoRate) ? Math.max(0.05, t.state.tempoRate) : 1;
        if (t.state.preservePitch) return tempoRate;
        const pitchRate = Math.pow(2, (Number.isFinite(t.state.pitch) ? t.state.pitch : 0) / 12);
        return Math.max(0.05, tempoRate * pitchRate);
    }

    private setupUnlockListeners(): void {
        const unlock = async () => {
            if (!this.ctx || this.contextUnlocked) return;
            try {
                if (this.ctx.state === 'suspended') await this.ctx.resume();
                this.contextUnlocked = true;
                this.setupMasterGain();
                for (const ev of ['click', 'touchstart', 'touchend', 'mousedown']) {
                    document.removeEventListener(ev, unlock);
                }
            } catch {
            }
        };
        for (const ev of ['click', 'touchstart', 'touchend', 'mousedown']) {
            document.addEventListener(ev, unlock, { once: false, passive: true });
        }
    }

    async preUnlock(): Promise<void> {
        try {
            if (!this.ctx) this.initAudioContext();
            if (this.ctx?.state === 'suspended') {
                if (!this.contextUnlocked && !this.hasUserActivation()) return;
                await this.ctx.resume();
            }
            if (IS_IOS && this.iosAudioService && !this.iosAudioService.isUnlocked()) {
                try { await this.iosAudioService.forceUnlock(); } catch { /* */ }
            }
            if (this.ctx && !this.isPrewarmed) {
                const osc = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(0, this.ctx.currentTime);
                osc.connect(g);
                g.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + 0.001);
                this.isPrewarmed = true;
            }
            this.contextUnlocked = this.ctx?.state === 'running';
        } catch (err) {
            const name = String((err as Error)?.name ?? '').toLowerCase();
            if (name === 'notallowederror') return;
        }
    }

    hasUserActivation(): boolean {
        const nav = navigator as Navigator & {
            userActivation?: { isActive?: boolean; hasBeenActive?: boolean };
        };
        return Boolean(nav.userActivation?.isActive || nav.userActivation?.hasBeenActive);
    }

    onForeground(): void {
        this.preUnlock().catch(() => { });
    }

    async registerTransport(
        padId: string,
        state: Omit<TransportState, 'isPlaying' | 'isPaused' | 'progress' | 'playStartTime' | 'backendType' | 'softMuted'>,
    ): Promise<void> {
        const previousRegistration = this.transportRegistrationQueue.get(padId) ?? Promise.resolve();
        const registration = previousRegistration
            .catch(() => { /* keep queue moving after a failed registration */ })
            .then(async () => {
                await this.performRegisterTransport(padId, state);
            });
        this.transportRegistrationQueue.set(padId, registration);
        try {
            await registration;
        } finally {
            if (this.transportRegistrationQueue.get(padId) === registration) {
                this.transportRegistrationQueue.delete(padId);
            }
        }
    }

    private async performRegisterTransport(
        padId: string,
        state: Omit<TransportState, 'isPlaying' | 'isPaused' | 'progress' | 'playStartTime' | 'backendType' | 'softMuted'>,
    ): Promise<void> {
        if (!this.ctx) this.initAudioContext();

        const existing = this.transports.get(padId);
        const requestedTempoRate = Number.isFinite(state.tempoRate) ? Math.max(0.05, state.tempoRate) : 1;
        const requestedPreservePitch = Boolean(state.preservePitch);
        const persistPreservePitchFallback =
            this.preservePitchFallbackPads.has(padId) &&
            Math.abs(requestedTempoRate - 1) > 0.001;
        const effectivePreservePitch = persistPreservePitchFallback ? false : requestedPreservePitch;
        const requiresMediaForKeyLock =
            effectivePreservePitch && Math.abs(requestedTempoRate - 1) > 0.001;
        const requiresBackendMigration =
            Boolean(existing?.backend) &&
            existing!.backend!.type === 'buffer' &&
            requiresMediaForKeyLock;

        if (existing && existing.state.audioUrl === state.audioUrl && existing.backend && !requiresBackendMigration) {
            Object.assign(existing.state, state);
            existing.backend?.setPitch(existing.state.pitch ?? 0);
            existing.backend?.setTempoRate(existing.state.tempoRate ?? 1);
            existing.backend?.setPreservePitch(Boolean(existing.state.preservePitch));
            existing.backend?.setLoop(existing.state.playbackMode === 'loop');
            this.resetTransportStopFilterNode(existing);
            this.applyTransportGain(existing, 0.01);
            this.touchTransport(existing);
            this.notifyStateChange();
            return;
        }

        if (existing) this.disposeTransport(padId);

        const fullState: TransportState = {
            ...state,
            isPlaying: false,
            isPaused: false,
            progress: 0,
            playStartTime: null,
            backendType: 'buffer',
            softMuted: false,
            tempoRate: Number.isFinite(state.tempoRate) ? Math.max(0.05, state.tempoRate) : 1,
            preservePitch: effectivePreservePitch,
        };

        const trimmedWindowMs =
            Number.isFinite(state.endTimeMs) &&
            Number.isFinite(state.startTimeMs) &&
            state.endTimeMs > state.startTimeMs
                ? Math.max(0, state.endTimeMs - state.startTimeMs)
                : null;
        const selectedBackendType = selectBackend({
            audioDurationMs: state.audioDurationMs,
            audioBytes: state.audioBytes,
            forceBackend: fullState.preservePitch && Math.abs((fullState.tempoRate ?? 1) - 1) > 0.001 ? 'media' : undefined,
            preferLowLatency: state.triggerMode === 'stutter',
            trimWindowMs: trimmedWindowMs,
            sourceUrl: state.audioUrl,
        });
        const backendType: AudioBackendType =
            IS_IOS && this.forceMediaPads.has(padId)
                ? 'media'
                : selectedBackendType;
        fullState.backendType = backendType;

        const gainNode = this.ctx ? this.ctx.createGain() : null;
        const stopFilterNode = this.ctx && gainNode ? this.ctx.createBiquadFilter() : null;
        let gainConnectedToMaster = false;
        if (stopFilterNode && this.ctx) {
            stopFilterNode.type = 'lowpass';
            stopFilterNode.frequency.setValueAtTime(20000, this.ctx.currentTime);
            stopFilterNode.Q.setValueAtTime(0.707, this.ctx.currentTime);
            gainNode!.connect(stopFilterNode);
        }
        if (this.masterGain && (stopFilterNode || gainNode)) {
            (stopFilterNode || gainNode)!.connect(this.masterGain);
            gainConnectedToMaster = true;
        }

        let backend: IAudioBackend;
        if (backendType === 'buffer') {
            backend = new BufferBackend(this.ctx!);
        } else {
            backend = new MediaBackend(this.ctx!);
        }
        backend.setEndedCallback(() => this.handleBackendEnded(padId, backend));

        if (gainNode) {
            backend.connectOutput(gainNode);
        }
        backend.setTempoRate(fullState.tempoRate ?? 1);
        backend.setPreservePitch(Boolean(fullState.preservePitch));
        backend.setPitch(fullState.pitch ?? 0);

        const loaded = await backend.load(state.audioUrl, fullState);

        const shouldAttemptMediaFallback =
            backendType === 'buffer' &&
            (IS_IOS || this.forceMediaPads.has(padId) || shouldFallbackToMedia(null));

        if (!loaded && shouldAttemptMediaFallback) {
            backend.dispose();
            const mediaBackend = new MediaBackend(this.ctx!);
            mediaBackend.setEndedCallback(() => this.handleBackendEnded(padId, mediaBackend));
            if (gainNode) mediaBackend.connectOutput(gainNode);
            mediaBackend.setTempoRate(fullState.tempoRate ?? 1);
            mediaBackend.setPreservePitch(Boolean(fullState.preservePitch));
            mediaBackend.setPitch(fullState.pitch ?? 0);
            const fallbackLoaded = await mediaBackend.load(state.audioUrl, fullState);
            if (fallbackLoaded) {
                fullState.backendType = 'media';
                this.forceMediaPads.add(padId);
                this.transports.set(padId, {
                    state: fullState,
                    backend: mediaBackend,
                    gainNode,
                    gainConnectedToMaster,
                    eqNodes: { low: stopFilterNode, mid: null, high: null },
                    stopCancel: null,
                    playFinalizeTimeout: null,
                    fadeOutTimeout: null,
                    lastAccessAt: Date.now(),
                });
                this.enforceTransportBudget(padId);
                this.enforceTotalTransportCap(padId);
                this.notifyStateChange();
                return;
            } else {
                mediaBackend.dispose();
                if (gainNode) {
                    try { gainNode.disconnect(); } catch { /* */ }
                }
                this.forceMediaPads.add(padId);
                throw new Error(`transport_load_failed:${padId}:buffer_to_media`);
            }
        }

        if (!loaded && backendType === 'media' && requestedPreservePitch && Math.abs(requestedTempoRate - 1) > 0.001) {
            backend.dispose();
            const fallbackBackend = new BufferBackend(this.ctx!);
            fallbackBackend.setEndedCallback(() => this.handleBackendEnded(padId, fallbackBackend));
            if (gainNode) fallbackBackend.connectOutput(gainNode);
            fallbackBackend.setTempoRate(fullState.tempoRate ?? 1);
            fallbackBackend.setPreservePitch(false);
            fallbackBackend.setPitch(fullState.pitch ?? 0);
            const fallbackLoaded = await fallbackBackend.load(state.audioUrl, {
                ...fullState,
                preservePitch: false,
            });
            if (fallbackLoaded) {
                fullState.backendType = 'buffer';
                fullState.preservePitch = false;
                this.preservePitchFallbackPads.add(padId);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('vdjv-audio-preserve-pitch-fallback', {
                        detail: {
                            padId,
                            reason: 'media_backend_keylock_not_supported',
                        },
                    }));
                }
                this.transports.set(padId, {
                    state: fullState,
                    backend: fallbackBackend,
                    gainNode,
                    gainConnectedToMaster,
                    eqNodes: { low: stopFilterNode, mid: null, high: null },
                    stopCancel: null,
                    playFinalizeTimeout: null,
                    fadeOutTimeout: null,
                    lastAccessAt: Date.now(),
                });
                this.enforceTransportBudget(padId);
                this.enforceTotalTransportCap(padId);
                this.notifyStateChange();
                return;
            }
            fallbackBackend.dispose();
        }

        if (!loaded) {
            backend.dispose();
            if (gainNode) {
                try { gainNode.disconnect(); } catch { /* */ }
            }
            this.forceMediaPads.add(padId);
            throw new Error(`transport_load_failed:${padId}:${backendType}`);
        }

        this.transports.set(padId, {
            state: fullState,
            backend,
            gainNode,
            gainConnectedToMaster,
            eqNodes: { low: stopFilterNode, mid: null, high: null },
            stopCancel: null,
            playFinalizeTimeout: null,
            fadeOutTimeout: null,
            lastAccessAt: Date.now(),
        });

        this.enforceTransportBudget(padId);
        this.enforceTotalTransportCap(padId);
        this.notifyStateChange();
    }

    playTransport(padId: string, options?: { retrigger?: boolean }): void {
        const t = this.transports.get(padId);
        if (!t || !t.backend) return;
        this.resetTransportStopFilterNode(t);

        if (t.stopCancel) {
            t.stopCancel();
            t.stopCancel = null;
        }
        this.clearPlaybackAutomation(t);

        const shouldUseRetriggerEnvelope =
            Boolean(options?.retrigger) &&
            t.state.isPlaying &&
            t.backend.type !== 'buffer' &&
            Boolean(this.ctx && t.gainNode);
        const isBufferStutterRetrigger =
            Boolean(options?.retrigger) &&
            t.state.isPlaying &&
            t.backend.type === 'buffer' &&
            t.state.triggerMode === 'stutter';

        t.backend.setTempoRate(t.state.tempoRate ?? 1);
        t.backend.setPreservePitch(Boolean(t.state.preservePitch));
        t.backend.setPitch(t.state.pitch ?? 0);

        if (shouldUseRetriggerEnvelope && this.ctx && t.gainNode) {
            const now = this.ctx.currentTime;
            const targetGain = this.computeTransportGain(t);
            t.gainNode.gain.cancelScheduledValues(now);
            // Hard reset to silence at retrigger boundary to avoid discontinuity clicks.
            t.gainNode.gain.setValueAtTime(0, now);
            t.backend.play(t.state);
            t.gainNode.gain.linearRampToValueAtTime(targetGain, now + RETRIGGER_ENVELOPE_SEC);
            t.state.isPlaying = true;
            t.state.isPaused = false;
            t.state.playStartTime = performance.now();
            this.schedulePlaybackAutomation(t);
            this.touchTransport(t);
            this.notifyStateChange();
            return;
        }

        if (!isBufferStutterRetrigger) {
            this.applyStartEnvelope(t);
        } else if (t.gainNode && this.ctx) {
            // Layered envelope model:
            // - stutter retrigger uses per-voice click-safe crossfade in backend
            // - transport macro gain stays continuous (avoid hard gain reset artifacts)
            this.applyTransportGain(t, 0.002);
        }

        t.backend.play(t.state);
        t.state.isPlaying = true;
        t.state.isPaused = false;
        t.state.playStartTime = performance.now();
        this.schedulePlaybackAutomation(t);
        this.touchTransport(t);
        this.notifyStateChange();
    }

    stopTransport(padId: string, mode: StopMode = 'instant'): void {
        const t = this.transports.get(padId);
        if (!t || !t.backend) return;

        if (t.stopCancel) {
            t.stopCancel();
            t.stopCancel = null;
        }
        this.clearPlaybackAutomation(t);

        const target: StopTarget = {
            setGainRamp: (targetGain: number, durationSec: number) => {
                if (t.gainNode && this.ctx) {
                    const now = this.ctx.currentTime;
                    t.gainNode.gain.cancelScheduledValues(now);
                    if (durationSec > 0) {
                        t.gainNode.gain.setValueAtTime(t.gainNode.gain.value, now);
                        t.gainNode.gain.linearRampToValueAtTime(Math.max(0, targetGain), now + durationSec);
                    } else {
                        t.gainNode.gain.setValueAtTime(Math.max(0, targetGain), now);
                    }
                }
            },
            getGain: () => t.gainNode?.gain.value ?? 1,
            setPlaybackRate: (rate: number) => t.backend?.setEffectivePlaybackRate(rate) ?? undefined,
            getPlaybackRate: () => this.getTransportSpeedRate(t),
            setFilterState: (cutoffHz: number, q: number) => {
                const filterNode = this.ensureTransportStopFilterNode(t);
                if (!filterNode || !this.ctx) return;
                const now = this.ctx.currentTime;
                const safeCutoff = Math.max(40, Math.min(20000, Number.isFinite(cutoffHz) ? cutoffHz : 20000));
                const safeQ = Math.max(0.707, Math.min(4, Number.isFinite(q) ? q : 0.707));
                filterNode.type = 'lowpass';
                filterNode.frequency.cancelScheduledValues(now);
                filterNode.Q.cancelScheduledValues(now);
                filterNode.frequency.setValueAtTime(filterNode.frequency.value || 20000, now);
                filterNode.frequency.linearRampToValueAtTime(safeCutoff, now + 0.03);
                filterNode.Q.setValueAtTime(filterNode.Q.value || 0.707, now);
                filterNode.Q.linearRampToValueAtTime(safeQ, now + 0.04);
            },
            resetFilter: () => {
                this.resetTransportStopFilterNode(t);
            },
            finalize: () => {
                this.finalizePlayback(t);
            },
            isActive: () => t.state.isPlaying,
        };

        t.stopCancel = executeStop(target, mode, this.ctx ?? undefined);
    }

    disposeTransport(padId: string): void {
        const t = this.transports.get(padId);
        if (!t) return;

        if (t.stopCancel) t.stopCancel();
        this.clearPlaybackAutomation(t);
        t.backend?.setEndedCallback(null);
        t.backend?.dispose();
        if (t.eqNodes.low) {
            try { t.eqNodes.low.disconnect(); } catch { /* */ }
            t.eqNodes.low = null;
        }
        if (t.gainNode) {
            try { t.gainNode.disconnect(); } catch { /* */ }
            t.gainConnectedToMaster = false;
        }
        this.transports.delete(padId);
        this.scheduleIdleCacheTrim();
    }

    setMasterVolume(volume: number): void {
        this.masterVolume = safeVolume(volume, 1);
        if (this.masterGain && this.ctx) {
            applyGain(this.masterGain, this.ctx, this.masterVolume, 0.01);
        }
    }

    setGlobalMute(muted: boolean): void {
        this.globalMuted = muted;
        this.applyGlobalGain();
    }

    applyGlobalEQ(_eq: EqSettings): void {
        this.globalEQ = _eq;
    }

    stopAll(mode: StopMode = 'instant'): void {
        for (const [padId] of this.transports) {
            this.stopTransport(padId, mode);
        }
    }

    getTransportState(padId: string): TransportState | null {
        return this.transports.get(padId)?.state ?? null;
    }

    setTransportPlaybackMode(padId: string, mode: PlaybackMode): void {
        const t = this.transports.get(padId);
        if (!t) return;
        t.state.playbackMode = mode;
        t.backend?.setLoop(mode === 'loop');
        if (mode === 'loop') {
            this.clearPlaybackAutomation(t);
        } else if (t.state.isPlaying) {
            this.schedulePlaybackAutomation(t);
        }
        this.touchTransport(t);
        this.notifyStateChange();
    }

    setTransportPitch(padId: string, pitch: number): void {
        const t = this.transports.get(padId);
        if (!t) return;
        const safePitch = Number.isFinite(pitch) ? pitch : 0;
        t.state.pitch = safePitch;
        t.backend?.setPitch(safePitch);
        if (t.state.isPlaying && t.state.playbackMode !== 'loop') {
            this.schedulePlaybackAutomation(t);
        }
        this.touchTransport(t);
        this.notifyStateChange();
    }

    setTransportTempoRate(padId: string, tempoRate: number): void {
        const t = this.transports.get(padId);
        if (!t) return;
        const safeTempoRate = Number.isFinite(tempoRate) ? Math.max(0.05, tempoRate) : 1;
        t.state.tempoRate = safeTempoRate;
        t.backend?.setTempoRate(safeTempoRate);
        if (t.state.isPlaying && t.state.playbackMode !== 'loop') {
            this.schedulePlaybackAutomation(t);
        }
        this.touchTransport(t);
        this.notifyStateChange();
    }

    setTransportPreservePitch(padId: string, preservePitch: boolean): void {
        const t = this.transports.get(padId);
        if (!t) return;
        t.state.preservePitch = Boolean(preservePitch);
        t.backend?.setPreservePitch(t.state.preservePitch);
        if (t.state.isPlaying && t.state.playbackMode !== 'loop') {
            this.schedulePlaybackAutomation(t);
        }
        this.touchTransport(t);
        this.notifyStateChange();
    }

    setTransportVolume(padId: string, volume: number): void {
        const t = this.transports.get(padId);
        if (!t) return;
        t.state.volume = safeVolume(volume, 1);
        this.applyTransportGain(t, 0.01);
        this.touchTransport(t);
        this.notifyStateChange();
    }

    setTransportGain(padId: string, gain: number): void {
        const t = this.transports.get(padId);
        if (!t) return;
        t.state.gain = safeVolume(gain, 1);
        this.applyTransportGain(t, 0.01);
        this.touchTransport(t);
        this.notifyStateChange();
    }

    setTransportSoftMuted(padId: string, muted: boolean): void {
        const t = this.transports.get(padId);
        if (!t) return;
        t.state.softMuted = muted;
        this.applyTransportGain(t, 0.01);
        this.touchTransport(t);
        this.notifyStateChange();
    }

    getEngineBackendForPad(padId: string): AudioBackendType | null {
        return this.transports.get(padId)?.backend?.type ?? null;
    }

    getEngineHealth(): EngineHealth {
        let bufferCount = 0;
        let mediaCount = 0;
        let loadedTransports = 0;
        let playingTransports = 0;
        for (const t of this.transports.values()) {
            if (t.backend?.type === 'buffer') bufferCount++;
            else if (t.backend?.type === 'media') mediaCount++;
            if (t.backend) loadedTransports += 1;
            if (t.state.isPlaying) playingTransports += 1;
        }
        return {
            contextState: this.ctx?.state ?? 'closed',
            backendCounts: { buffer: bufferCount, media: mediaCount },
            decodeQueueDepth: 0,
            xrunsApprox: 0,
            totalTransports: this.transports.size,
            totalTransportCap: this.getTotalTransportCap(),
            loadedTransports,
            playingTransports,
            transportBudget: this.getLoadedTransportBudget(),
            transportEvictions: this.transportEvictions,
            lastEvictedPadId: this.lastEvictedPadId,
            lastEvictedAt: this.lastEvictedAt,
        };
    }

    isEnabled(): boolean {
        return this.config.audioEngineV3Enabled;
    }

    getConfig(): EngineConfig {
        return { ...this.config };
    }

    updateConfig(partial: Partial<EngineConfig>): void {
        this.config = { ...this.config, ...partial };
    }

    addStateListener(listener: () => void): void {
        this.stateListeners.add(listener);
    }

    removeStateListener(listener: () => void): void {
        this.stateListeners.delete(listener);
    }

    private notifyStateChange(): void {
        if (this.notifyTimeout) return;
        const throttle = IS_IOS ? 100 : IS_ANDROID ? 50 : 16;
        this.notifyTimeout = setTimeout(() => {
            this.notifyTimeout = null;
            for (const listener of this.stateListeners) {
                try { listener(); } catch { /* */ }
            }
        }, throttle);
    }

    private applyGlobalGain(): void {
        for (const t of this.transports.values()) {
            this.applyTransportGain(t, 0.01);
        }
    }

    private destroy(): void {
        this.lifecycle.destroy();
        this.transportRegistrationQueue.clear();
        if (typeof window !== 'undefined') {
            window.removeEventListener(HOT_TRANSPORT_PADS_CHANGED_EVENT, this.handleHotTransportPadsChanged as EventListener);
        }
        this.hotTransportPadIds.clear();
        for (const [padId] of this.transports) {
            this.disposeTransport(padId);
        }
        if (this.notifyTimeout) {
            clearTimeout(this.notifyTimeout);
            this.notifyTimeout = null;
        }
        if (this.idleCacheTrimTimeout) {
            clearTimeout(this.idleCacheTrimTimeout);
            this.idleCacheTrimTimeout = null;
        }
        BufferBackend.clearCache();
        if (this.masterGain) {
            try { this.masterGain.disconnect(); } catch { /* */ }
            this.masterGain = null;
        }
        if (this.limiterNode) {
            try { this.limiterNode.disconnect(); } catch { /* */ }
            this.limiterNode = null;
        }
        if (this.ctx && this.ctx.state !== 'closed') {
            try { this.ctx.close(); } catch { /* */ }
        }
        this.ctx = null;
    }
}

