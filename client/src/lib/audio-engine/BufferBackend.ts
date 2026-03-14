/**
 * Audio Engine V3 - Buffer Backend.
 *
 * AudioBuffer-backed playback for low-latency short assets.
 * Handles play, stop, seek, pitch, loop via AudioBufferSourceNode.
 * Consolidates iOS buffer decode / cache / memory eviction logic.
 */

import {
    ANDROID_MAX_BUFFER_MEMORY,
    CAPACITOR_NATIVE_MAX_BUFFER_MEMORY,
    DESKTOP_MAX_BUFFER_MEMORY,
    LOW_MEMORY_WEB_MAX_BUFFER_MEMORY,
    type IAudioBackend,
    type TransportState,
    IS_CAPACITOR_NATIVE,
    IS_ELECTRON,
    IOS_MAX_BUFFER_MEMORY,
    IS_IOS,
    IS_ANDROID,
} from './types';

const STUTTER_ZERO_CROSS_WINDOW_SAMPLES = IS_ANDROID ? 256 : 192;
const STUTTER_CROSSFADE_SEC = IS_ANDROID ? 0.008 : 0.006;
const LOOP_ZERO_CROSS_WINDOW_SAMPLES = IS_ANDROID ? 384 : 256;

interface ActiveVoice {
    voiceId: number;
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    startSec: number;
    endSec: number;
    startedAt: number;
    playbackRate: number;
    loop: boolean;
    manualStop: boolean;
}

export class BufferBackend implements IAudioBackend {
    readonly type = 'buffer' as const;

    private ctx: AudioContext;
    private sourceNode: AudioBufferSourceNode | null = null;
    private outputGainNode: GainNode | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private isDecoding = false;
    private playing = false;
    private startOffset = 0; // seconds
    private playStartedAt = 0; // AudioContext time
    private looping = false;
    private currentPitch = 0;
    private currentTempoRate = 1;
    private endedCallback: (() => void) | null = null;
    private regionStartSec = 0;
    private regionEndSec = 0;

    private voices = new Map<number, ActiveVoice>();
    private voiceBySource = new Map<AudioBufferSourceNode, number>();
    private activeVoiceId: number | null = null;
    private voiceIdCounter = 0;

    // Shared buffer cache across backend instances.
    private static bufferCache = new Map<string, AudioBuffer>();
    private static bufferAccessTime = new Map<string, number>();
    private static bufferMemoryUsage = 0;

    constructor(ctx: AudioContext) {
        this.ctx = ctx;
    }

    async load(url: string, _transport: TransportState): Promise<boolean> {
        if (!url) return false;
        if (this.isDecoding) return false;

        // Check cache first.
        const cached = BufferBackend.bufferCache.get(url);
        if (cached) {
            BufferBackend.bufferAccessTime.set(url, Date.now());
            this.audioBuffer = cached;
            return true;
        }

        this.isDecoding = true;
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            const size = BufferBackend.getBufferSize(audioBuffer);
            const maxBufferMemory = BufferBackend.getMaxBufferMemory();

            // Memory management: evict old buffers if over limit.
            if (BufferBackend.bufferMemoryUsage + size > maxBufferMemory) {
                BufferBackend.evictOldest(size, maxBufferMemory);
            }

            BufferBackend.bufferCache.set(url, audioBuffer);
            BufferBackend.bufferAccessTime.set(url, Date.now());
            BufferBackend.bufferMemoryUsage += size;

            this.audioBuffer = audioBuffer;
            return true;
        } catch {
            return false;
        } finally {
            this.isDecoding = false;
        }
    }

    play(transport: TransportState): void {
        if (!this.audioBuffer || !this.outputGainNode) return;

        const sampleRate = this.getSampleRate();
        const minDurationSec = 1 / sampleRate;
        const bufferDuration = Math.max(0, this.audioBuffer.duration);

        const rawStartSec = Math.max(0, (transport.startTimeMs ?? 0) / 1000);
        const rawEndSec = transport.endTimeMs > 0
            ? Math.max(0, transport.endTimeMs / 1000)
            : bufferDuration;

        let startSec = rawStartSec;
        let endSec = rawEndSec;

        if (bufferDuration <= minDurationSec) {
            startSec = 0;
            endSec = bufferDuration;
        } else {
            startSec = Math.max(0, Math.min(rawStartSec, bufferDuration - minDurationSec));
            endSec = Math.max(startSec + minDurationSec, Math.min(rawEndSec, bufferDuration));
        }

        // Stutter retrigger: snap boundaries to nearby zero crossing to reduce clicks.
        if (transport.triggerMode === 'stutter') {
            const snappedStart = this.snapToNearestZeroCrossing(
                startSec,
                startSec,
                endSec,
                STUTTER_ZERO_CROSS_WINDOW_SAMPLES,
            );
            const boundedStart = Math.max(0, Math.min(snappedStart, Math.max(0, endSec - minDurationSec)));
            const snappedEnd = this.snapToNearestZeroCrossing(
                endSec,
                boundedStart,
                endSec,
                STUTTER_ZERO_CROSS_WINDOW_SAMPLES,
            );
            startSec = boundedStart;
            endSec = Math.max(startSec + minDurationSec, Math.min(snappedEnd, bufferDuration));
        }

        const loopEnabled = transport.playbackMode === 'loop';
        const pitch = transport.pitch ?? 0;
        const tempoRate = Number.isFinite(transport.tempoRate) ? Math.max(0.05, transport.tempoRate) : 1;
        const isStutterRetrigger = transport.triggerMode === 'stutter' && this.playing && this.activeVoiceId !== null;

        this.regionStartSec = startSec;
        this.regionEndSec = endSec;
        this.currentPitch = pitch;
        this.currentTempoRate = tempoRate;
        this.looping = loopEnabled;

        // Loop safety: align loop boundaries to nearby zero crossings so loop wraps avoid clicks.
        if (loopEnabled && transport.triggerMode !== 'stutter') {
            const snappedStart = this.snapToNearestZeroCrossing(
                startSec,
                startSec,
                endSec,
                LOOP_ZERO_CROSS_WINDOW_SAMPLES,
            );
            const boundedStart = Math.max(0, Math.min(snappedStart, Math.max(0, endSec - minDurationSec)));
            const snappedEnd = this.snapToNearestZeroCrossing(
                endSec,
                boundedStart,
                endSec,
                LOOP_ZERO_CROSS_WINDOW_SAMPLES,
            );
            startSec = boundedStart;
            endSec = Math.max(startSec + minDurationSec, Math.min(snappedEnd, bufferDuration));
            this.regionStartSec = startSec;
            this.regionEndSec = endSec;
        }

        if (isStutterRetrigger) {
            this.stopNonActiveVoices(0);
            const outgoingVoiceId = this.activeVoiceId;
            if (outgoingVoiceId !== null) {
                this.stopVoice(outgoingVoiceId, STUTTER_CROSSFADE_SEC);
            }
            this.createVoice(startSec, endSec, this.resolvePlaybackRate(), loopEnabled, STUTTER_CROSSFADE_SEC);
            return;
        }

        this.stopAllVoices();
        this.createVoice(startSec, endSec, this.resolvePlaybackRate(), loopEnabled, 0);
    }

    stop(): void {
        this.stopAllVoices();
        this.playing = false;
    }

    pause(): void {
        // AudioBufferSourceNode cannot pause; stop and keep offset.
        if (!this.playing) return;
        this.startOffset = this.getPlayheadSec();
        this.stopAllVoices();
        this.playing = false;
    }

    resume(): void {
        if (!this.audioBuffer || !this.outputGainNode) return;

        const sampleRate = this.getSampleRate();
        const minDurationSec = 1 / sampleRate;
        const bufferDuration = Math.max(0, this.audioBuffer.duration);
        const startSec = Math.max(0, Math.min(this.startOffset, Math.max(0, bufferDuration - minDurationSec)));
        const endSec = Math.max(startSec + minDurationSec, Math.min(
            this.regionEndSec > 0 ? this.regionEndSec : bufferDuration,
            bufferDuration,
        ));

        this.stopAllVoices();
        this.createVoice(startSec, endSec, this.resolvePlaybackRate(), this.looping, 0);
    }

    seek(ms: number): void {
        if (!this.audioBuffer) return;

        const sampleRate = this.getSampleRate();
        const minDurationSec = 1 / sampleRate;
        const bufferDuration = Math.max(0, this.audioBuffer.duration);
        const requestedStartSec = Math.max(0, ms / 1000);
        const boundedStartSec = Math.max(0, Math.min(requestedStartSec, Math.max(0, bufferDuration - minDurationSec)));

        this.startOffset = boundedStartSec;

        if (!this.playing || !this.outputGainNode) return;

        const endSec = Math.max(
            boundedStartSec + minDurationSec,
            Math.min(this.regionEndSec > 0 ? this.regionEndSec : bufferDuration, bufferDuration),
        );

        this.stopAllVoices();
        this.createVoice(boundedStartSec, endSec, this.resolvePlaybackRate(), this.looping, 0);
    }

    setPitch(semitones: number): void {
        this.currentPitch = semitones;
        this.applyVoicePlaybackRate(this.resolvePlaybackRate());
    }

    setTempoRate(rate: number): void {
        this.currentTempoRate = Number.isFinite(rate) ? Math.max(0.05, rate) : 1;
        this.applyVoicePlaybackRate(this.resolvePlaybackRate());
    }

    setPreservePitch(_enabled: boolean): void {
        // Buffer backend has no native key-lock support.
    }

    setEffectivePlaybackRate(rate: number): void {
        const safeRate = Number.isFinite(rate) ? Math.max(0.05, rate) : 1;
        this.applyVoicePlaybackRate(safeRate);
    }

    getEffectivePlaybackRate(): number {
        if (this.activeVoiceId !== null) {
            const active = this.voices.get(this.activeVoiceId);
            if (active) {
                return Math.max(0.05, active.playbackRate);
            }
        }
        return this.resolvePlaybackRate();
    }

    private applyVoicePlaybackRate(rate: number): void {
        const safeRate = Number.isFinite(rate) ? Math.max(0.05, rate) : 1;
        for (const voice of this.voices.values()) {
            voice.playbackRate = safeRate;
            try {
                voice.source.playbackRate.value = safeRate;
            } catch {
            }
        }
    }

    setLoop(loop: boolean): void {
        this.looping = loop;
        for (const voice of this.voices.values()) {
            voice.loop = loop;
            try {
                voice.source.loop = loop;
                if (loop) {
                    voice.source.loopStart = voice.startSec;
                    voice.source.loopEnd = voice.endSec;
                }
            } catch {
            }
        }
    }

    getPlayheadMs(): number {
        return this.getPlayheadSec() * 1000;
    }

    getDurationMs(): number {
        return this.audioBuffer ? this.audioBuffer.duration * 1000 : 0;
    }

    connectOutput(gainNode: GainNode): void {
        this.outputGainNode = gainNode;
    }

    disconnectOutput(): void {
        this.stopAllVoices();
        this.outputGainNode = null;
    }

    setEndedCallback(callback: (() => void) | null): void {
        this.endedCallback = callback;
    }

    dispose(): void {
        this.stopAllVoices();
        this.audioBuffer = null;
        this.outputGainNode = null;
        this.playing = false;
        this.endedCallback = null;
    }

    private createVoice(
        startSec: number,
        endSec: number,
        playbackRate: number,
        loopEnabled: boolean,
        fadeInSec: number,
    ): void {
        if (!this.audioBuffer || !this.outputGainNode) return;

        const source = this.ctx.createBufferSource();
        source.buffer = this.audioBuffer;
        source.loop = loopEnabled;
        source.playbackRate.value = Math.max(0.05, playbackRate);

        if (source.loop) {
            source.loopStart = startSec;
            source.loopEnd = endSec;
        }

        const voiceGain = this.ctx.createGain();
        const now = this.ctx.currentTime;
        if (fadeInSec > 0) {
            voiceGain.gain.setValueAtTime(0, now);
            voiceGain.gain.linearRampToValueAtTime(1, now + fadeInSec);
        } else {
            voiceGain.gain.setValueAtTime(1, now);
        }

        source.connect(voiceGain);
        voiceGain.connect(this.outputGainNode);

        const voiceId = ++this.voiceIdCounter;
        const voice: ActiveVoice = {
            voiceId,
            source,
            gainNode: voiceGain,
            startSec,
            endSec,
            startedAt: now,
            playbackRate: Math.max(0.05, playbackRate),
            loop: loopEnabled,
            manualStop: false,
        };

        source.onended = () => {
            this.handleVoiceEnded(voiceId, source);
        };

        const duration = Math.max(1 / this.getSampleRate(), endSec - startSec);
        source.start(0, startSec, source.loop ? undefined : duration);

        this.voices.set(voiceId, voice);
        this.voiceBySource.set(source, voiceId);
        this.activeVoiceId = voiceId;
        this.sourceNode = source;
        this.playing = true;
        this.startOffset = startSec;
        this.playStartedAt = now;
    }

    private handleVoiceEnded(voiceId: number, source: AudioBufferSourceNode): void {
        const voice = this.voices.get(voiceId);
        if (!voice) return;

        const wasActive = this.activeVoiceId === voiceId;
        const manualStop = voice.manualStop;

        this.voices.delete(voiceId);
        this.voiceBySource.delete(source);

        try {
            source.disconnect();
        } catch {
        }
        try {
            voice.gainNode.disconnect();
        } catch {
        }

        if (wasActive) {
            this.activeVoiceId = null;
            this.sourceNode = null;
        }

        if (this.voices.size === 0) {
            this.playing = false;
            this.activeVoiceId = null;
            this.sourceNode = null;
            if (!manualStop) {
                this.endedCallback?.();
            }
            return;
        }

        if (this.activeVoiceId === null) {
            const nextActive = this.getNewestVoice();
            if (nextActive) {
                this.activeVoiceId = nextActive.voiceId;
                this.sourceNode = nextActive.source;
                this.startOffset = nextActive.startSec;
                this.playStartedAt = nextActive.startedAt;
                this.looping = nextActive.loop;
                this.regionStartSec = nextActive.startSec;
                this.regionEndSec = nextActive.endSec;
                this.playing = true;
            }
        }
    }

    private getNewestVoice(): ActiveVoice | null {
        let newest: ActiveVoice | null = null;
        for (const voice of this.voices.values()) {
            if (!newest || voice.voiceId > newest.voiceId) {
                newest = voice;
            }
        }
        return newest;
    }

    private stopVoice(voiceId: number, fadeSec: number): void {
        const voice = this.voices.get(voiceId);
        if (!voice || voice.manualStop) return;

        voice.manualStop = true;
        const now = this.ctx.currentTime;

        try {
            voice.gainNode.gain.cancelScheduledValues(now);
            const current = Math.max(0, voice.gainNode.gain.value || 0);
            voice.gainNode.gain.setValueAtTime(current, now);

            if (fadeSec > 0) {
                voice.gainNode.gain.linearRampToValueAtTime(0, now + fadeSec);
                voice.source.stop(now + fadeSec + 0.0005);
            } else {
                voice.gainNode.gain.setValueAtTime(0, now);
                voice.source.stop();
            }
        } catch {
            try {
                voice.source.stop();
            } catch {
            }
        }
    }

    private stopNonActiveVoices(fadeSec: number): void {
        for (const [voiceId] of this.voices) {
            if (voiceId === this.activeVoiceId) continue;
            this.stopVoice(voiceId, fadeSec);
        }
    }

    private stopAllVoices(): void {
        for (const voice of this.voices.values()) {
            voice.manualStop = true;
            try {
                voice.source.onended = null;
            } catch {
            }
            try {
                voice.source.stop();
            } catch {
            }
            try {
                voice.source.disconnect();
            } catch {
            }
            try {
                voice.gainNode.disconnect();
            } catch {
            }
        }

        this.voices.clear();
        this.voiceBySource.clear();
        this.activeVoiceId = null;
        this.sourceNode = null;
    }

    private getPlayheadSec(): number {
        if (!this.playing) return this.startOffset;
        if (this.activeVoiceId === null) return this.startOffset;

        const voice = this.voices.get(this.activeVoiceId);
        if (!voice) return this.startOffset;

        const rate = Math.max(0.05, voice.playbackRate || 1);
        const elapsed = (this.ctx.currentTime - voice.startedAt) * rate;
        const raw = voice.startSec + elapsed;

        if (voice.loop) {
            const sampleRate = this.getSampleRate();
            const loopDuration = Math.max(1 / sampleRate, voice.endSec - voice.startSec);
            const wrapped = ((raw - voice.startSec) % loopDuration + loopDuration) % loopDuration;
            return voice.startSec + wrapped;
        }

        return raw;
    }

    private snapToNearestZeroCrossing(
        targetSec: number,
        regionStartSec: number,
        regionEndSec: number,
        windowSamples: number = STUTTER_ZERO_CROSS_WINDOW_SAMPLES,
    ): number {
        if (!this.audioBuffer) return targetSec;
        if (typeof (this.audioBuffer as any).getChannelData !== 'function') return targetSec;
        if (!Number.isFinite(targetSec)) return targetSec;

        const sampleRate = this.getSampleRate();
        const maxIndex = Math.max(0, this.audioBuffer.length - 1);
        const targetIndex = this.clampIndex(Math.round(targetSec * sampleRate), 0, maxIndex);
        const regionStartIndex = this.clampIndex(Math.floor(regionStartSec * sampleRate), 0, maxIndex);
        const regionEndIndex = this.clampIndex(Math.ceil(regionEndSec * sampleRate), 0, maxIndex);

        if (regionEndIndex <= regionStartIndex) {
            return targetIndex / sampleRate;
        }

        const halfWindow = Math.max(16, Math.floor(windowSamples));
        const searchStart = this.clampIndex(targetIndex - halfWindow, regionStartIndex, regionEndIndex);
        const searchEnd = this.clampIndex(targetIndex + halfWindow, regionStartIndex, regionEndIndex);
        if (searchEnd <= searchStart) return targetIndex / sampleRate;

        const channelData: Float32Array[] = [];
        for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel += 1) {
            try {
                channelData.push(this.audioBuffer.getChannelData(channel));
            } catch {
                return targetIndex / sampleRate;
            }
        }
        if (!channelData.length) return targetIndex / sampleRate;

        let bestCrossIndex = -1;
        let bestCrossScore = Number.POSITIVE_INFINITY;

        for (let i = searchStart + 1; i <= searchEnd; i += 1) {
            const prev = this.getMixedSampleAtIndex(channelData, i - 1);
            const curr = this.getMixedSampleAtIndex(channelData, i);
            const crossed = (prev <= 0 && curr >= 0) || (prev >= 0 && curr <= 0);
            if (!crossed) continue;

            const amplitudeScore = Math.abs(prev) + Math.abs(curr);
            const distanceScore = Math.abs(i - targetIndex) / (halfWindow + 1);
            const score = amplitudeScore + (distanceScore * 0.01);
            if (score < bestCrossScore) {
                bestCrossScore = score;
                bestCrossIndex = i;
            }
        }

        if (bestCrossIndex >= 0) {
            return bestCrossIndex / sampleRate;
        }

        let bestAbsIndex = targetIndex;
        let bestAbsScore = Number.POSITIVE_INFINITY;
        for (let i = searchStart; i <= searchEnd; i += 1) {
            const value = Math.abs(this.getMixedSampleAtIndex(channelData, i));
            const distancePenalty = Math.abs(i - targetIndex) / (halfWindow + 1);
            const score = value + (distancePenalty * 0.001);
            if (score < bestAbsScore) {
                bestAbsScore = score;
                bestAbsIndex = i;
            }
        }

        return bestAbsIndex / sampleRate;
    }

    private getMixedSampleAtIndex(channelData: Float32Array[], index: number): number {
        let sum = 0;
        for (let i = 0; i < channelData.length; i += 1) {
            sum += channelData[i]?.[index] || 0;
        }
        return sum / Math.max(1, channelData.length);
    }

    private clampIndex(value: number, min: number, max: number): number {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    private getSampleRate(): number {
        if (this.audioBuffer && Number.isFinite((this.audioBuffer as any).sampleRate)) {
            const sampleRate = Number((this.audioBuffer as any).sampleRate);
            if (sampleRate > 0) return sampleRate;
        }
        return 44100;
    }

    private static getBufferSize(buffer: AudioBuffer): number {
        return buffer.length * buffer.numberOfChannels * 4;
    }

    private static getMaxBufferMemory(): number {
        if (IS_IOS) return IOS_MAX_BUFFER_MEMORY;
        if (IS_ANDROID) return ANDROID_MAX_BUFFER_MEMORY;
        if (IS_CAPACITOR_NATIVE) return CAPACITOR_NATIVE_MAX_BUFFER_MEMORY;
        if (IS_ELECTRON) return DESKTOP_MAX_BUFFER_MEMORY;

        const deviceMemory =
            typeof navigator !== 'undefined' &&
            typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
                ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
                : null;

        if (deviceMemory !== null && Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) {
            return LOW_MEMORY_WEB_MAX_BUFFER_MEMORY;
        }

        return DESKTOP_MAX_BUFFER_MEMORY;
    }

    private resolvePlaybackRate(): number {
        const pitchRate = Math.pow(2, (Number.isFinite(this.currentPitch) ? this.currentPitch : 0) / 12);
        const tempoRate = Number.isFinite(this.currentTempoRate) ? Math.max(0.05, this.currentTempoRate) : 1;
        return Math.max(0.05, pitchRate * tempoRate);
    }

    private static evictOldest(neededBytes: number, maxBufferMemory: number): void {
        const entries = Array.from(BufferBackend.bufferAccessTime.entries())
            .sort((a, b) => a[1] - b[1]);

        let freed = 0;
        for (const [url] of entries) {
            if (BufferBackend.bufferMemoryUsage + neededBytes - freed <= maxBufferMemory) break;

            const buf = BufferBackend.bufferCache.get(url);
            if (buf) {
                freed += BufferBackend.getBufferSize(buf);
                BufferBackend.bufferCache.delete(url);
                BufferBackend.bufferAccessTime.delete(url);
            }
        }
        BufferBackend.bufferMemoryUsage -= freed;
    }

    /** Clear all cached buffers (e.g. for memory pressure). */
    static clearCache(): void {
        BufferBackend.bufferCache.clear();
        BufferBackend.bufferAccessTime.clear();
        BufferBackend.bufferMemoryUsage = 0;
    }

    static getCacheStats(): { count: number; memoryBytes: number } {
        return {
            count: BufferBackend.bufferCache.size,
            memoryBytes: BufferBackend.bufferMemoryUsage,
        };
    }
}
