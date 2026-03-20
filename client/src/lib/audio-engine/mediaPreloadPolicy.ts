import { IS_ANDROID, IS_CAPACITOR_NATIVE } from './types';

const ANDROID_EAGER_MEDIA_DURATION_THRESHOLD_MS = 90_000;
const ANDROID_EAGER_MEDIA_SIZE_THRESHOLD_BYTES = 8 * 1024 * 1024;

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

export interface MediaPreloadPolicyInput {
    sourceUrl?: string | null;
    audioDurationMs?: number | null;
    audioBytes?: number | null;
    isAndroid?: boolean;
    isCapacitorNative?: boolean;
}

export function shouldUseEagerMediaPreload(input: MediaPreloadPolicyInput): boolean {
    const isAndroid = input.isAndroid ?? IS_ANDROID;
    const isCapacitorNative = input.isCapacitorNative ?? IS_CAPACITOR_NATIVE;
    if (!isAndroid || !isCapacitorNative) return false;
    if (!isLikelyLocalSourceUrl(input.sourceUrl)) return false;

    const durationMs = typeof input.audioDurationMs === 'number' && Number.isFinite(input.audioDurationMs)
        ? input.audioDurationMs
        : null;
    const audioBytes = typeof input.audioBytes === 'number' && Number.isFinite(input.audioBytes)
        ? input.audioBytes
        : null;

    return Boolean(
        (durationMs !== null && durationMs >= ANDROID_EAGER_MEDIA_DURATION_THRESHOLD_MS) ||
        (audioBytes !== null && audioBytes >= ANDROID_EAGER_MEDIA_SIZE_THRESHOLD_BYTES)
    );
}
