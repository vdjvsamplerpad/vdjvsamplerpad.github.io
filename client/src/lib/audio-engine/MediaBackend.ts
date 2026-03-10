/**
 * Audio Engine V3 - Media Backend
 *
 * HTMLAudioElement-backed playback for streaming-safe long assets.
 * Handles play, stop, seek, pitch, loop via the media element API.
 * Includes resource pooling (enforce element limits).
 */

import {
    type IAudioBackend,
    type TransportState,
    MAX_AUDIO_ELEMENTS,
    IS_ANDROID,
    IS_IOS,
} from './types';

const REGION_MONITOR_INTERVAL_MS = 20;
const LOOP_WRAP_DUCK_SEC = IS_ANDROID ? 0.006 : IS_IOS ? 0.005 : 0.004;
const LOOP_WRAP_SEEK_DELAY_MS = IS_ANDROID ? 8 : IS_IOS ? 7 : 5;

export class MediaBackend implements IAudioBackend {
    readonly type = 'media' as const;

    private ctx: AudioContext;
    private audioElement: HTMLAudioElement | null = null;
    private sourceNode: MediaElementAudioSourceNode | null = null;
    private outputGainNode: GainNode | null = null;
    private playing = false;
    private sourceConnected = false;
    private endedCallback: (() => void) | null = null;
    private regionStartSec = 0;
    private regionEndSec = 0;
    private regionLoopEnabled = false;
    private regionMonitorInterval: ReturnType<typeof setInterval> | null = null;
    private regionEndedDispatched = false;
    private loopWrapTimeout: ReturnType<typeof setTimeout> | null = null;
    private loopWrapInFlight = false;
    private currentPitch = 0;
    private currentTempoRate = 1;
    private preservePitch = false;
    private manualRateOverride: number | null = null;
    private playAttemptToken = 0;

    // Track active media elements to cap resource use.
    private static activeElements = new Set<HTMLAudioElement>();

    private readonly handleEnded = () => {
        this.stopRegionMonitor();
        this.playing = false;
        this.regionEndedDispatched = false;
        this.endedCallback?.();
    };

    constructor(ctx: AudioContext) {
        this.ctx = ctx;
    }

    async load(url: string, transport: TransportState): Promise<boolean> {
        if (!url) return false;

        this.disposeElement();
        this.enforceElementLimit();

        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = url;
        audio.preload = 'metadata';
        (audio as any).playsInline = true;
        audio.muted = false;
        audio.volume = 1.0;

        this.currentPitch = Number.isFinite(transport.pitch) ? transport.pitch : 0;
        this.currentTempoRate = Number.isFinite(transport.tempoRate) ? Math.max(0.05, transport.tempoRate) : 1;
        this.preservePitch = Boolean(transport.preservePitch);
        this.manualRateOverride = null;
        this.applyPreservePitch(audio);
        audio.playbackRate = this.resolvePlaybackRate();
        audio.loop = transport.playbackMode === 'loop';

        this.audioElement = audio;
        MediaBackend.activeElements.add(audio);
        audio.addEventListener('ended', this.handleEnded);

        // Wait for metadata to load
        return new Promise<boolean>((resolve) => {
            const onLoaded = () => {
                cleanup();
                this.applyRegionState(transport);
                if (this.regionStartSec > 0) {
                    audio.currentTime = this.regionStartSec;
                }
                resolve(true);
            };

            const onError = () => {
                cleanup();
                resolve(false);
            };

            const cleanup = () => {
                audio.removeEventListener('loadedmetadata', onLoaded);
                audio.removeEventListener('error', onError);
            };

            audio.addEventListener('loadedmetadata', onLoaded, { once: true });
            audio.addEventListener('error', onError, { once: true });
        });
    }

    play(transport: TransportState): void {
        if (!this.audioElement) return;

        // (Re)connect to Web Audio graph
        this.ensureSourceConnected();

        const audio = this.audioElement;
        this.currentPitch = Number.isFinite(transport.pitch) ? transport.pitch : this.currentPitch;
        this.currentTempoRate = Number.isFinite(transport.tempoRate) ? Math.max(0.05, transport.tempoRate) : this.currentTempoRate;
        this.preservePitch = Boolean(transport.preservePitch);
        this.manualRateOverride = null;
        this.applyRegionState(transport);
        audio.muted = false;
        this.applyPreservePitch(audio);
        audio.playbackRate = this.resolvePlaybackRate();
        audio.loop = this.regionLoopEnabled && !this.hasTrimRegion();

        try {
            audio.currentTime = this.regionStartSec;
        } catch {
        }
        this.playing = false;
        const playToken = ++this.playAttemptToken;
        this.regionEndedDispatched = false;
        if (audio.loop || (!this.regionLoopEnabled && !this.hasTrimRegion())) {
            this.stopRegionMonitor();
        } else {
            this.startRegionMonitor();
        }

        const playResult = audio.play();
        if (playResult && typeof (playResult as Promise<void>).then === 'function') {
            (playResult as Promise<void>)
                .then(() => {
                    if (this.playAttemptToken !== playToken) return;
                    if (!this.audioElement || this.audioElement !== audio) return;
                    this.playing = true;
                })
                .catch(() => {
                    if (this.playAttemptToken !== playToken) return;
                    if (!this.audioElement || this.audioElement !== audio) return;
                    this.stopRegionMonitor();
                    this.playing = false;
                    this.regionEndedDispatched = false;
                    this.endedCallback?.();
                });
        } else {
            this.playing = !audio.paused;
        }
    }

    stop(): void {
        if (!this.audioElement) return;
        this.playAttemptToken += 1;
        this.cancelLoopWrap();
        this.stopRegionMonitor();
        this.regionEndedDispatched = false;
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.playing = false;
    }

    pause(): void {
        if (!this.audioElement) return;
        this.playAttemptToken += 1;
        this.cancelLoopWrap();
        this.stopRegionMonitor();
        this.audioElement.pause();
        this.playing = false;
    }

    resume(): void {
        if (!this.audioElement) return;
        if (this.audioElement.loop || (!this.regionLoopEnabled && !this.hasTrimRegion())) {
            this.stopRegionMonitor();
        } else {
            this.startRegionMonitor();
        }
        this.audioElement.play().catch(() => { });
        this.playing = true;
    }

    seek(ms: number): void {
        if (!this.audioElement) return;
        this.audioElement.currentTime = ms / 1000;
    }

    setPitch(semitones: number): void {
        this.currentPitch = Number.isFinite(semitones) ? semitones : 0;
        this.manualRateOverride = null;
        this.applyPlaybackRate();
    }

    setTempoRate(rate: number): void {
        this.currentTempoRate = Number.isFinite(rate) ? Math.max(0.05, rate) : 1;
        this.manualRateOverride = null;
        this.applyPlaybackRate();
    }

    setPreservePitch(enabled: boolean): void {
        this.preservePitch = Boolean(enabled);
        this.manualRateOverride = null;
        if (this.audioElement) {
            this.applyPreservePitch(this.audioElement);
        }
        this.applyPlaybackRate();
    }

    setEffectivePlaybackRate(rate: number): void {
        this.manualRateOverride = Number.isFinite(rate) ? Math.max(0.05, rate) : 1;
        this.applyPlaybackRate();
    }

    getEffectivePlaybackRate(): number {
        return this.audioElement
            ? Math.max(0.05, Number.isFinite(this.audioElement.playbackRate) ? this.audioElement.playbackRate : 1)
            : this.resolvePlaybackRate();
    }

    setLoop(loop: boolean): void {
        if (!this.audioElement) return;
        this.regionLoopEnabled = loop;
        this.audioElement.loop = loop && !this.hasTrimRegion();
        if (this.audioElement.loop || (!this.regionLoopEnabled && !this.hasTrimRegion())) {
            this.stopRegionMonitor();
        } else if (this.playing) {
            this.startRegionMonitor();
        }
    }

    getPlayheadMs(): number {
        if (!this.audioElement) return 0;
        return this.audioElement.currentTime * 1000;
    }

    getDurationMs(): number {
        if (!this.audioElement) return 0;
        return Number.isFinite(this.audioElement.duration)
            ? this.audioElement.duration * 1000
            : 0;
    }

    connectOutput(gainNode: GainNode): void {
        this.outputGainNode = gainNode;
        this.ensureSourceConnected();
    }

    disconnectOutput(): void {
        this.disconnectSource();
        this.outputGainNode = null;
    }

    setEndedCallback(callback: (() => void) | null): void {
        this.endedCallback = callback;
    }

    dispose(): void {
        this.cancelLoopWrap();
        this.stopRegionMonitor();
        this.disconnectSource();
        this.disposeElement();
        this.outputGainNode = null;
        this.playing = false;
        this.endedCallback = null;
    }

    /** Expose the underlying element for legacy compatibility. */
    getAudioElement(): HTMLAudioElement | null {
        return this.audioElement;
    }

    private ensureSourceConnected(): void {
        if (this.sourceConnected || !this.audioElement || !this.outputGainNode) return;

        try {
            if (!this.sourceNode) {
                this.sourceNode = this.ctx.createMediaElementSource(this.audioElement);
            }
            this.sourceNode.connect(this.outputGainNode);
            this.sourceConnected = true;
        } catch {
        }
    }

    private disconnectSource(): void {
        if (this.sourceNode && this.sourceConnected) {
            try { this.sourceNode.disconnect(); } catch { /* ignore */ }
            this.sourceConnected = false;
        }
    }

    private disposeElement(): void {
        this.playAttemptToken += 1;
        if (this.audioElement) {
            this.cancelLoopWrap();
            this.stopRegionMonitor();
            this.audioElement.removeEventListener('ended', this.handleEnded);
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement.load();
            MediaBackend.activeElements.delete(this.audioElement);
            this.audioElement = null;
        }
        this.sourceNode = null;
        this.sourceConnected = false;
        this.manualRateOverride = null;
    }

    private enforceElementLimit(): void {
        // Nothing to do if under limit
        if (MediaBackend.activeElements.size < MAX_AUDIO_ELEMENTS) return;

        // Find the first non-playing element and remove it
        for (const el of MediaBackend.activeElements) {
            if (el.paused) {
                el.src = '';
                el.load();
                MediaBackend.activeElements.delete(el);
                break;
            }
        }
    }

    static getActiveElementCount(): number {
        return MediaBackend.activeElements.size;
    }

    private getMinRegionDurationSec(): number {
        return 1 / Math.max(1, this.ctx.sampleRate || 44_100);
    }

    private applyRegionState(transport: TransportState): void {
        const audio = this.audioElement;
        if (!audio) return;

        const minRegionDuration = this.getMinRegionDurationSec();
        const durationSecRaw = Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0;
        const fallbackDurationSec = durationSecRaw > 0
            ? durationSecRaw
            : Math.max(
                minRegionDuration,
                transport.endTimeMs > 0 ? transport.endTimeMs / 1000 : minRegionDuration,
            );

        const rawStartSec = Math.max(0, (transport.startTimeMs ?? 0) / 1000);
        const rawEndSec = transport.endTimeMs > 0
            ? Math.max(0, transport.endTimeMs / 1000)
            : fallbackDurationSec;

        const boundedStartSec = Math.max(
            0,
            Math.min(rawStartSec, Math.max(0, fallbackDurationSec - minRegionDuration)),
        );
        const boundedEndSec = Math.max(
            boundedStartSec + minRegionDuration,
            Math.min(rawEndSec, fallbackDurationSec),
        );

        this.regionStartSec = boundedStartSec;
        this.regionEndSec = boundedEndSec;
        this.regionLoopEnabled = transport.playbackMode === 'loop';
    }

    private applyPreservePitch(audio: HTMLAudioElement): void {
        const preserve = this.preservePitch;
        if ('preservesPitch' in audio) {
            (audio as any).preservesPitch = preserve;
        }
        if ('mozPreservesPitch' in audio) {
            (audio as any).mozPreservesPitch = preserve;
        }
        if ('webkitPreservesPitch' in audio) {
            (audio as any).webkitPreservesPitch = preserve;
        }
    }

    private resolvePlaybackRate(): number {
        if (this.manualRateOverride !== null) {
            return Math.max(0.05, this.manualRateOverride);
        }
        const tempoRate = Number.isFinite(this.currentTempoRate) ? Math.max(0.05, this.currentTempoRate) : 1;
        if (this.preservePitch) {
            // Key-lock mode: tempo changes speed while keeping original key.
            return tempoRate;
        }
        const pitchRate = Math.pow(2, (Number.isFinite(this.currentPitch) ? this.currentPitch : 0) / 12);
        return Math.max(0.05, tempoRate * pitchRate);
    }

    private applyPlaybackRate(): void {
        if (!this.audioElement) return;
        this.audioElement.playbackRate = this.resolvePlaybackRate();
    }

    private hasTrimRegion(): boolean {
        const audio = this.audioElement;
        const durationSec = Number.isFinite(audio?.duration)
            ? Math.max(0, Number(audio?.duration))
            : Math.max(this.regionEndSec, this.regionStartSec);
        if (durationSec <= 0) return this.regionStartSec > 0 || this.regionEndSec > 0;
        const startTrimmed = this.regionStartSec > 0.01;
        const endTrimmed = this.regionEndSec < durationSec - 0.01;
        return startTrimmed || endTrimmed;
    }

    private startRegionMonitor(): void {
        if (this.regionMonitorInterval) return;
        this.regionMonitorInterval = setInterval(() => this.enforceRegionBounds(), REGION_MONITOR_INTERVAL_MS);
    }

    private stopRegionMonitor(): void {
        if (!this.regionMonitorInterval) return;
        clearInterval(this.regionMonitorInterval);
        this.regionMonitorInterval = null;
    }

    private cancelLoopWrap(): void {
        this.loopWrapInFlight = false;
        if (!this.loopWrapTimeout) return;
        clearTimeout(this.loopWrapTimeout);
        this.loopWrapTimeout = null;
    }

    private performLoopWrap(audio: HTMLAudioElement): void {
        if (this.loopWrapInFlight) return;
        this.loopWrapInFlight = true;

        const gainNode = this.outputGainNode;
        const gainParam = gainNode?.gain ?? null;
        const restoreGain = gainParam ? Math.max(0, gainParam.value) : 0;
        const now = this.ctx.currentTime;

        if (gainParam) {
            try {
                gainParam.cancelScheduledValues(now);
                gainParam.setValueAtTime(restoreGain, now);
                gainParam.linearRampToValueAtTime(0, now + LOOP_WRAP_DUCK_SEC);
            } catch {
                // ignore
            }
        }

        this.loopWrapTimeout = setTimeout(() => {
            this.loopWrapTimeout = null;
            if (!this.audioElement || this.audioElement !== audio || !this.playing) {
                this.loopWrapInFlight = false;
                return;
            }

            try {
                audio.currentTime = this.regionStartSec;
            } catch {
                this.loopWrapInFlight = false;
                return;
            }

            if (gainParam) {
                const now2 = this.ctx.currentTime;
                try {
                    gainParam.cancelScheduledValues(now2);
                    gainParam.setValueAtTime(0, now2);
                    gainParam.linearRampToValueAtTime(restoreGain, now2 + LOOP_WRAP_DUCK_SEC);
                } catch {
                    // ignore
                }
            }

            if (audio.paused && this.playing) {
                audio.play().catch(() => { });
            }
            this.loopWrapInFlight = false;
        }, LOOP_WRAP_SEEK_DELAY_MS);
    }

    private enforceRegionBounds(): void {
        const audio = this.audioElement;
        if (!audio || !this.playing) return;

        const minDurationSec = this.getMinRegionDurationSec();
        const regionWindowSec = Math.max(minDurationSec, this.regionEndSec - this.regionStartSec);
        const loopThresholdSec = Math.min(0.03, Math.max(0.006, regionWindowSec * 0.2));
        const nowSec = audio.currentTime;

        if (nowSec < this.regionStartSec - 0.05) {
            try {
                audio.currentTime = this.regionStartSec;
            } catch {
                // ignore
            }
            return;
        }

        if (nowSec + loopThresholdSec < this.regionEndSec) {
            return;
        }

        if (this.regionLoopEnabled) {
            this.performLoopWrap(audio);
            return;
        }

        audio.pause();
        this.playing = false;
        this.stopRegionMonitor();
        if (!this.regionEndedDispatched) {
            this.regionEndedDispatched = true;
            this.endedCallback?.();
        }
    }
}
