/**
 * Audio Engine V3 – Shared Types & Configuration
 */

// ─── Backend Types ───────────────────────────────────────────────────────────

export type AudioBackendType = 'buffer' | 'media';

export type StopMode = 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter';

export type TriggerMode = 'toggle' | 'hold' | 'stutter' | 'unmute';

export type PlaybackMode = 'once' | 'loop' | 'stopper';

export type HotcueTuple = [number | null, number | null, number | null, number | null];

export type AudioRejectedReason = 'size_limit' | 'duration_limit';

// ─── Configuration Constants ─────────────────────────────────────────────────

/** Platform detection (evaluated once at module load) */
export const IS_IOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream;

export const IS_ANDROID =
    typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

export const IS_CAPACITOR_NATIVE =
    typeof window !== 'undefined' &&
    Boolean((window as any).Capacitor?.isNativePlatform?.());

export const IS_ELECTRON =
    typeof window !== 'undefined' &&
    (
        /Electron/i.test(navigator.userAgent) ||
        Boolean((window as Window & { process?: { versions?: { electron?: string } } }).process?.versions?.electron)
    );

/** Audio limits */
export const DEFAULT_MAX_PAD_AUDIO_BYTES = 52_428_800; // 50 MB
export const DEFAULT_MAX_PAD_AUDIO_DURATION_MS = 1_200_000; // 20 min

/** iOS backend selection thresholds */
export const IOS_MEDIA_DURATION_THRESHOLD_MS = 240_000; // 4 min
export const IOS_MEDIA_SIZE_THRESHOLD_BYTES = 15_728_640; // 15 MB

/** iOS memory cap for decoded AudioBuffers */
export const IOS_MAX_BUFFER_MEMORY = 50 * 1024 * 1024;
export const ANDROID_MAX_BUFFER_MEMORY = 64 * 1024 * 1024;
export const CAPACITOR_NATIVE_MAX_BUFFER_MEMORY = 72 * 1024 * 1024;
export const LOW_MEMORY_WEB_MAX_BUFFER_MEMORY = 96 * 1024 * 1024;
export const DESKTOP_MAX_BUFFER_MEMORY = 160 * 1024 * 1024;

/** Chrome limit is ~1000; keep a safety margin */
export const MAX_AUDIO_ELEMENTS = 800;

/** Max concurrent AudioBufferSourceNodes on iOS */
export const MAX_IOS_BUFFER_SOURCES = 32;

/** Max mixer channels */
export const MAX_PLAYBACK_CHANNELS = 8;

/** State-change notification throttle */
export const NOTIFICATION_THROTTLE_MS = IS_IOS ? 100 : IS_ANDROID ? 50 : 16;

// ─── Stop Timing Profile ─────────────────────────────────────────────────────

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
    filterStartHz: number;
    filterEndHz: number;
    filterResonanceQ: number;
    filterFadeTailRatio: number;
    volumeSmoothingSec: number;
    softMuteSmoothingSec: number;
    masterSmoothingSec: number;
}

/** Platform-specific timing profiles */
export function getStopTimingProfile(): StopTimingProfile {
    if (IS_IOS) {
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
            filterStartHz: 18000,
            filterEndHz: 120,
            filterResonanceQ: 1.05,
            filterFadeTailRatio: 0.24,
            volumeSmoothingSec: 0.016,
            softMuteSmoothingSec: 0.014,
            masterSmoothingSec: 0.012,
        };
    }

    if (IS_ANDROID) {
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
            filterStartHz: 18000,
            filterEndHz: 160,
            filterResonanceQ: 0.96,
            filterFadeTailRatio: 0.22,
            volumeSmoothingSec: 0.02,
            softMuteSmoothingSec: 0.018,
            masterSmoothingSec: 0.015,
        };
    }

    // Desktop / default
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
        filterStartHz: 20000,
        filterEndHz: 100,
        filterResonanceQ: 1.1,
        filterFadeTailRatio: 0.26,
        volumeSmoothingSec: 0.012,
        softMuteSmoothingSec: 0.01,
        masterSmoothingSec: 0.01,
    };
}

// ─── Engine Config ───────────────────────────────────────────────────────────

export interface AudioLimits {
    maxPadAudioBytes: number;
    maxPadAudioDurationMs: number;
}

export interface EngineConfig {
    audioEngineV3Enabled: boolean;
    audioLimits: AudioLimits;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
    audioEngineV3Enabled: false,
    audioLimits: {
        maxPadAudioBytes: DEFAULT_MAX_PAD_AUDIO_BYTES,
        maxPadAudioDurationMs: DEFAULT_MAX_PAD_AUDIO_DURATION_MS,
    },
};

// ─── EQ Settings ─────────────────────────────────────────────────────────────

export interface EqSettings {
    low: number;
    mid: number;
    high: number;
}

// ─── Transport State ─────────────────────────────────────────────────────────

export interface TransportState {
    padId: string;
    padName: string;
    bankId: string;
    bankName: string;
    color: string;
    audioUrl: string;
    volume: number;
    gainDb?: number;
    gain?: number;
    startTimeMs: number;
    endTimeMs: number;
    fadeInMs: number;
    fadeOutMs: number;
    pitch: number;
    tempoRate: number;
    preservePitch: boolean;
    triggerMode: TriggerMode;
    playbackMode: PlaybackMode;
    isPlaying: boolean;
    isPaused: boolean;
    progress: number;
    playStartTime: number | null;
    channelId: number | null;
    backendType: AudioBackendType;
    savedHotcuesMs: HotcueTuple;
    softMuted: boolean;
    audioBytes?: number;
    audioDurationMs?: number;
}

// ─── Backend Interface ───────────────────────────────────────────────────────

/**
 * Common interface implemented by both BufferBackend and MediaBackend.
 */
export interface IAudioBackend {
    readonly type: AudioBackendType;

    load(url: string, transport: TransportState): Promise<boolean>;
    play(transport: TransportState): void;
    stop(): void;
    pause(): void;
    resume(): void;
    seek(ms: number): void;
    setPitch(semitones: number): void;
    setTempoRate(rate: number): void;
    setPreservePitch(enabled: boolean): void;
    setEffectivePlaybackRate(rate: number): void;
    getEffectivePlaybackRate(): number;
    setLoop(loop: boolean): void;
    getPlayheadMs(): number;
    getDurationMs(): number;

    /** Connect this backend's output into the given gain node. */
    connectOutput(gainNode: GainNode): void;
    disconnectOutput(): void;
    setEndedCallback(callback: (() => void) | null): void;

    /** Release all resources held by this backend. */
    dispose(): void;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface EngineHealth {
    contextState: string;
    backendCounts: { buffer: number; media: number };
    decodeQueueDepth: number;
    xrunsApprox: number;
    totalTransports: number;
    totalTransportCap: number;
    loadedTransports: number;
    playingTransports: number;
    transportBudget: number;
    transportEvictions: number;
    lastEvictedPadId: string | null;
    lastEvictedAt: number | null;
}
