/**
 * Audio Engine V3 – Gain Pipeline
 *
 * Zero-safe volume math with clamping at source and on apply.
 * Single gain chain: pad → channel → master → destination.
 *
 * Key fix: replaces all `|| 1` volume defaults with nullish-safe `?? 1`
 * so that an explicit volume of 0 yields true silence.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a gain value to a safe range. */
export function clampGain(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    if (value > 2) return 2; // allow slight boost, but cap
    return value;
}

/**
 * Nullish-safe volume default.
 * Returns the input if it is a finite number (including 0); otherwise returns fallback.
 */
export function safeVolume(value: number | null | undefined, fallback: number = 1): number {
    if (value == null || !Number.isFinite(value)) return fallback;
    return value;
}

// ─── Gain Pipeline ───────────────────────────────────────────────────────────

export interface GainInputs {
    padVolume: number | null | undefined;
    padGain?: number | null | undefined;
    channelVolume: number | null | undefined;
    masterVolume: number | null | undefined;
    globalMuted: boolean;
    softMuted: boolean;
}

/**
 * Compute the final linear gain from the full chain. Returns a value ≥ 0.
 *
 * Order: pad × channel × master.
 * If globally muted or soft-muted, returns 0.
 */
export function computeGain(inputs: GainInputs): number {
    if (inputs.globalMuted || inputs.softMuted) return 0;

    const padVolumeLevel = clampGain(safeVolume(inputs.padVolume, 1));
    const padGainLevel = safeVolume(inputs.padGain, 1);
    const pad = clampGain(padVolumeLevel * padGainLevel);
    const channel = clampGain(safeVolume(inputs.channelVolume, 1));
    const master = clampGain(safeVolume(inputs.masterVolume, 1));

    return clampGain(pad * channel * master);
}

/**
 * Apply a gain value to a Web Audio GainNode with optional smoothing.
 */
export function applyGain(
    gainNode: GainNode,
    ctx: AudioContext,
    gain: number,
    smoothingSec: number = 0,
): void {
    const safeGain = clampGain(gain);
    const now = ctx.currentTime;

    gainNode.gain.cancelScheduledValues(now);

    if (smoothingSec > 0) {
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(safeGain, now + smoothingSec);
    } else {
        gainNode.gain.setValueAtTime(safeGain, now);
    }
}

/**
 * Schedule a linear gain ramp (used for fade-in / fade-out / stop envelopes).
 */
export function scheduleGainRamp(
    gainNode: GainNode,
    ctx: AudioContext,
    fromGain: number,
    toGain: number,
    durationSec: number,
): void {
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(clampGain(fromGain), now);
    gainNode.gain.linearRampToValueAtTime(clampGain(toGain), now + Math.max(0, durationSec));
}
