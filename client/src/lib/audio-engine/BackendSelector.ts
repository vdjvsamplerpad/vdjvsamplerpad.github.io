/**
 * Audio Engine V3 – Backend Selector
 *
 * Decides whether a given audio asset should use BufferBackend (low-latency,
 * decoded into memory) or MediaBackend (streamed via HTMLAudioElement).
 *
 * Rules (locked):
 *  • iOS → MediaBackend if duration > 4 min OR size > 15 MB
 *  • Non-iOS → BufferBackend by default; auto-fallback to MediaBackend on
 *    decode failure or memory pressure
 */

import {
    AudioBackendType,
    IS_IOS,
    IOS_MEDIA_DURATION_THRESHOLD_MS,
    IOS_MEDIA_SIZE_THRESHOLD_BYTES,
} from './types';

const IS_CAPACITOR_NATIVE =
    typeof window !== 'undefined' &&
    Boolean((window as any).Capacitor?.isNativePlatform?.());
const IS_IOS_WEB = IS_IOS && !IS_CAPACITOR_NATIVE;
const CAPACITOR_MEDIA_DURATION_THRESHOLD_MS_DEFAULT = 90_000;
const CAPACITOR_MEDIA_SIZE_THRESHOLD_BYTES_DEFAULT = 8 * 1024 * 1024;
const CAPACITOR_MEDIA_DURATION_THRESHOLD_MS_IOS = 240_000;
const CAPACITOR_MEDIA_SIZE_THRESHOLD_BYTES_IOS = 10 * 1024 * 1024;
const IOS_WEB_MEDIA_DURATION_THRESHOLD_MS = 120_000;
const IOS_WEB_MEDIA_SIZE_THRESHOLD_BYTES = 6 * 1024 * 1024;

export interface BackendSelectionInput {
    audioDurationMs?: number | null;
    audioBytes?: number | null;
    forceBackend?: AudioBackendType;
    preferLowLatency?: boolean;
    trimWindowMs?: number | null;
    sourceUrl?: string | null;
}

const LOW_LATENCY_UNKNOWN_TRIM_MAX_MS = 12_000;
const LOW_LATENCY_UNKNOWN_SIZE_MAX_BYTES = 1_500_000;

const isLikelyLocalSourceUrl = (sourceUrl?: string | null): boolean => {
    const normalized = String(sourceUrl || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith('blob:')) return true;
    if (normalized.startsWith('data:')) return true;
    if (normalized.startsWith('file:')) return true;
    if (normalized.startsWith('capacitor://')) return true;
    if (normalized.startsWith('content://')) return true;
    if (normalized.startsWith('/')) return true;
    return !/^https?:\/\//i.test(normalized);
};

/**
 * Select the optimal backend for a given audio asset.
 */
export function selectBackend(input: BackendSelectionInput): AudioBackendType {
    // Honour explicit override when provided
    if (input.forceBackend) return input.forceBackend;

    const duration = input.audioDurationMs ?? 0;
    const size = input.audioBytes ?? 0;
    const hasDuration = typeof input.audioDurationMs === 'number' && Number.isFinite(input.audioDurationMs) && input.audioDurationMs > 0;
    const hasSize = typeof input.audioBytes === 'number' && Number.isFinite(input.audioBytes) && input.audioBytes > 0;
    const trimWindowMs = typeof input.trimWindowMs === 'number' && Number.isFinite(input.trimWindowMs) && input.trimWindowMs > 0
        ? input.trimWindowMs
        : null;
    const canPreferLowLatencyUnknownMetadata =
        Boolean(input.preferLowLatency) &&
        isLikelyLocalSourceUrl(input.sourceUrl) &&
        (
            (trimWindowMs !== null && trimWindowMs <= LOW_LATENCY_UNKNOWN_TRIM_MAX_MS) ||
            (hasSize && size <= LOW_LATENCY_UNKNOWN_SIZE_MAX_BYTES)
        );

    // Capacitor WebView: avoid heavy decode paths for medium+ files.
    if (IS_CAPACITOR_NATIVE) {
        const capacitorDurationThreshold = IS_IOS
            ? CAPACITOR_MEDIA_DURATION_THRESHOLD_MS_IOS
            : CAPACITOR_MEDIA_DURATION_THRESHOLD_MS_DEFAULT;
        const capacitorSizeThreshold = IS_IOS
            ? CAPACITOR_MEDIA_SIZE_THRESHOLD_BYTES_IOS
            : CAPACITOR_MEDIA_SIZE_THRESHOLD_BYTES_DEFAULT;
        // Missing metadata on mobile is safer with media backend to avoid costly full decode spikes.
        if (!hasDuration && !hasSize) {
            if (canPreferLowLatencyUnknownMetadata) {
                return 'buffer';
            }
            return 'media';
        }
        if (duration > capacitorDurationThreshold || size > capacitorSizeThreshold) {
            return 'media';
        }
    }

    if (IS_IOS_WEB) {
        if (!hasDuration && !hasSize) {
            if (canPreferLowLatencyUnknownMetadata) {
                return 'buffer';
            }
            return 'media';
        }
        if (duration > IOS_WEB_MEDIA_DURATION_THRESHOLD_MS || size > IOS_WEB_MEDIA_SIZE_THRESHOLD_BYTES) {
            return 'media';
        }
    } else if (IS_IOS) {
        if (duration > IOS_MEDIA_DURATION_THRESHOLD_MS || size > IOS_MEDIA_SIZE_THRESHOLD_BYTES) {
            return 'media';
        }
    }

    // Default: BufferBackend (caller is responsible for fallback on decode failure)
    return 'buffer';
}

/**
 * Check whether a fallback from buffer → media is appropriate after a decode
 * failure or memory-pressure event. Non-iOS only (iOS already checks above).
 */
export function shouldFallbackToMedia(
    _decodeError: unknown,
    _memoryPressure: boolean = false,
): boolean {
    // On non-iOS, always fall back to media on decode error
    return true;
}
