/**
 * Audio Engine V3 – Audio Admission
 *
 * Extracts metadata (size, duration) from audio files / blobs / URLs and
 * enforces admission limits (max 50 MB, max 20 minutes).
 *
 * Used at:
 *  - Direct upload (addPad)
 *  - Bank import
 *  - Backup restore
 *  - Channel load
 */

import {
    AudioRejectedReason,
    DEFAULT_MAX_PAD_AUDIO_BYTES,
    DEFAULT_MAX_PAD_AUDIO_DURATION_MS,
    type AudioLimits,
} from './types';

// ─── Metadata Extraction ─────────────────────────────────────────────────────

export interface AudioMetadata {
    audioBytes: number;
    audioDurationMs: number;
}

/**
 * Extract metadata from a File object (fast path — no decode needed for size).
 * Duration is measured via an HTMLAudioElement.
 */
export async function extractMetadataFromFile(file: File): Promise<AudioMetadata> {
    const audioBytes = file.size;
    const audioDurationMs = await measureDuration(URL.createObjectURL(file));
    return { audioBytes, audioDurationMs };
}

/**
 * Extract metadata from a Blob (e.g. from a zip entry during import).
 */
export async function extractMetadataFromBlob(blob: Blob): Promise<AudioMetadata> {
    const audioBytes = blob.size;
    const audioDurationMs = await measureDuration(URL.createObjectURL(blob));
    return { audioBytes, audioDurationMs };
}

/**
 * Extract metadata from a URL (e.g. already-uploaded audio).
 * Size is obtained via a HEAD request; duration via audio element.
 */
export async function extractMetadataFromUrl(url: string): Promise<AudioMetadata> {
    let audioBytes = 0;
    try {
        const response = await fetch(url, { method: 'HEAD' });
        const contentLength = response.headers.get('content-length');
        if (contentLength) audioBytes = parseInt(contentLength, 10) || 0;
    } catch {
        // Size unknown — skip size check
    }

    const audioDurationMs = await measureDuration(url);
    return { audioBytes, audioDurationMs };
}

/**
 * Measure the duration of an audio file via a temporary HTMLAudioElement.
 * Returns duration in milliseconds, or 0 if it cannot be determined.
 */
function measureDuration(src: string): Promise<number> {
    return new Promise<number>((resolve) => {
        if (typeof Audio === 'undefined') {
            resolve(0);
            return;
        }

        const audio = new Audio();
        audio.preload = 'metadata';

        const cleanup = () => {
            audio.removeEventListener('loadedmetadata', onMeta);
            audio.removeEventListener('error', onError);
            audio.src = '';
            audio.load();
            // Revoke if it was a blob URL
            if (src.startsWith('blob:')) {
                try { URL.revokeObjectURL(src); } catch { /* ignore */ }
            }
        };

        const onMeta = () => {
            const durationMs = Number.isFinite(audio.duration)
                ? Math.round(audio.duration * 1000)
                : 0;
            cleanup();
            resolve(durationMs);
        };

        const onError = () => {
            cleanup();
            resolve(0);
        };

        audio.addEventListener('loadedmetadata', onMeta, { once: true });
        audio.addEventListener('error', onError, { once: true });
        audio.src = src;
    });
}

// ─── Admission Checks ────────────────────────────────────────────────────────

export interface AdmissionResult {
    allowed: boolean;
    reason?: AudioRejectedReason;
    /** Human-friendly message for UI display */
    message?: string;
}

/**
 * Check whether an audio asset passes admission limits.
 */
export function checkAdmission(
    metadata: AudioMetadata,
    limits?: Partial<AudioLimits>,
): AdmissionResult {
    const maxBytes = limits?.maxPadAudioBytes ?? DEFAULT_MAX_PAD_AUDIO_BYTES;
    const maxDuration = limits?.maxPadAudioDurationMs ?? DEFAULT_MAX_PAD_AUDIO_DURATION_MS;

    if (metadata.audioBytes > 0 && metadata.audioBytes > maxBytes) {
        const sizeMB = (metadata.audioBytes / (1024 * 1024)).toFixed(1);
        const limitMB = (maxBytes / (1024 * 1024)).toFixed(0);
        return {
            allowed: false,
            reason: 'size_limit',
            message: `Audio file is ${sizeMB} MB which exceeds the ${limitMB} MB limit.`,
        };
    }

    if (metadata.audioDurationMs > 0 && metadata.audioDurationMs > maxDuration) {
        const durationMin = (metadata.audioDurationMs / 60_000).toFixed(1);
        const limitMin = (maxDuration / 60_000).toFixed(0);
        return {
            allowed: false,
            reason: 'duration_limit',
            message: `Audio file is ${durationMin} min which exceeds the ${limitMin} min limit.`,
        };
    }

    return { allowed: true };
}

/**
 * Convenience: check a File directly.
 */
export async function checkFileAdmission(
    file: File,
    limits?: Partial<AudioLimits>,
): Promise<AdmissionResult> {
    const metadata = await extractMetadataFromFile(file);
    return checkAdmission(metadata, limits);
}

// ─── Bank Import Report ──────────────────────────────────────────────────────

export interface ImportAdmissionReport {
    totalPads: number;
    acceptedPads: number;
    rejectedPads: number;
    rejections: Array<{
        padName: string;
        reason: AudioRejectedReason;
        message: string;
    }>;
}

/**
 * Create an empty import report for accumulation.
 */
export function createImportReport(): ImportAdmissionReport {
    return { totalPads: 0, acceptedPads: 0, rejectedPads: 0, rejections: [] };
}
