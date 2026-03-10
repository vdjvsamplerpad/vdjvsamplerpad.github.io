/**
 * Audio Engine V3 – Stop Scheduler
 *
 * Single stop-envelope engine used for BOTH pads and channels.
 * Implements all 5 modes: instant, fadeout, brake, backspin, filter.
 *
 * Replaces the duplicated logic previously split across:
 *  - stopPadInstant / stopPadFadeout / stopPadBrake / stopPadBackspin / stopPadFilter
 *  - stopDeckChannelInternal
 */

import { StopMode, getStopTimingProfile } from './types';
import { clampGain } from './GainPipeline';

// ─── Stop Target Interface ───────────────────────────────────────────────────

/**
 * Abstraction that both pad transports and channel transports implement
 * so the scheduler can drive them uniformly.
 */
export interface StopTarget {
    /** Set the output gain with a sample-accurate envelope (duration > 0 means ramp). */
    setGainRamp(target: number, durationSec: number): void;
    /** Get the current output gain value. */
    getGain(): number;
    /** Set audio playback rate (used by brake / backspin). */
    setPlaybackRate(rate: number): void;
    /** Get the current playback rate. */
    getPlaybackRate(): number;
    /** Optional filter automation for filter-sweep stop mode. */
    setFilterState?(cutoffHz: number, q: number): void;
    /** Reset stop filter back to neutral/open state. */
    resetFilter?(): void;
    /** Finalize: pause, reset position, release resources. */
    finalize(): void;
    /** Whether this target is currently playing. */
    isActive(): boolean;
}

// ─── Stop Scheduler ──────────────────────────────────────────────────────────

/**
 * Execute a stop with the given mode on the supplied target.
 * Returns a cleanup function that cancels any in-progress animation.
 */
export function executeStop(
    target: StopTarget,
    mode: StopMode,
    ctx?: AudioContext,
): () => void {
    const timing = getStopTimingProfile();
    let cancelled = false;
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cancel = () => {
        cancelled = true;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        target.resetFilter?.();
    };

    const runRafAnimation = (
        durationMs: number,
        onFrame: (progress: number, startGain: number, originalRate: number) => void,
        onEnd?: () => void,
    ) => {
        const startGain = target.getGain();
        const originalRate = target.getPlaybackRate();
        const startedAt = performance.now();

        const tick = () => {
            if (cancelled) return;
            const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
            onFrame(progress, startGain, originalRate);

            if (progress >= 1 || !target.isActive()) {
                if (onEnd) onEnd();
                target.finalize();
                return;
            }
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
    };

    switch (mode) {
        // ── Instant ────────────────────────────────────────────────────────────
        case 'instant': {
            if (!target.isActive()) {
                target.finalize();
                break;
            }

            const fadeMs = Math.max(10, timing.instantStopFinalizeDelayMs);
            if (ctx) {
                // Use sample-accurate gain ramp
                target.setGainRamp(0, fadeMs / 1000);
            } else {
                target.setGainRamp(0, 0); // fallback immediate
            }

            timeoutId = setTimeout(() => {
                timeoutId = null;
                target.finalize();
            }, fadeMs);
            break;
        }

        // ── Fade Out ───────────────────────────────────────────────────────────
        case 'fadeout': {
            const durationMs = timing.defaultFadeOutMs;
            if (ctx) {
                target.setGainRamp(0, durationMs / 1000);
            }
            // Optional: still run a slow RAF for rate deceleration if needed,
            // but for pure fadeout, just gain is usually enough. By default, 
            // pitch deceleration feels like brake, but fadeout should just be gain.
            runRafAnimation(durationMs, (progress, _startGain, originalRate) => {
                target.setPlaybackRate(Math.max(0.9, originalRate - (originalRate - 0.85) * progress));
                if (!ctx) target.setGainRamp(clampGain(_startGain * (1 - progress)), 0);
            });
            break;
        }

        // ── Brake ──────────────────────────────────────────────────────────────
        case 'brake': {
            const durationMs = timing.brakeWebDurationMs;
            if (ctx) {
                target.setGainRamp(0, durationMs / 1000);
            }
            runRafAnimation(
                durationMs,
                (progress, _startGain, originalRate) => {
                    const nextRate = Math.max(timing.brakeMinRate, originalRate * (1 - Math.pow(progress, 0.5))); // Non-linear vinyl brake feel
                    target.setPlaybackRate(nextRate);
                    if (!ctx) target.setGainRamp(clampGain(_startGain * (1 - progress)), 0);
                },
                () => {
                    target.setPlaybackRate(Math.max(timing.brakeMinRate, target.getPlaybackRate()));
                },
            );
            break;
        }

        // ── Backspin ───────────────────────────────────────────────────────────
        case 'backspin': {
            const totalMs = timing.backspinWebTotalMs;
            const speedUpPoint = timing.backspinWebSpeedUpMs / totalMs;
            const maxRate = timing.backspinWebMaxRate;
            const minRate = timing.backspinWebMinRate;

            if (ctx) {
                target.setGainRamp(0, totalMs / 1000);
            }

            runRafAnimation(
                totalMs,
                (progress, _startGain, originalRate) => {
                    if (progress < speedUpPoint) {
                        const p = progress / speedUpPoint;
                        target.setPlaybackRate(originalRate + (maxRate - originalRate) * p);
                    } else {
                        const p = (progress - speedUpPoint) / (1 - speedUpPoint);
                        target.setPlaybackRate(Math.max(minRate, maxRate - (maxRate - minRate) * p));
                    }
                    if (!ctx) target.setGainRamp(clampGain(_startGain * (1 - progress)), 0);
                },
                () => {
                    target.setPlaybackRate(1);
                },
            );
            break;
        }

        // ── Filter (HPF sweep + fade) ─────────────────────────────────────────
        case 'filter': {
            const durationMs = timing.filterDurationSec * 1000;
            const fadeTailRatio = Math.max(0.1, Math.min(0.45, timing.filterFadeTailRatio));
            const fadeTailMs = Math.max(80, durationMs * fadeTailRatio);
            const fadeStartMs = Math.max(0, durationMs - fadeTailMs);
            const fadeStartProgress = fadeStartMs / Math.max(1, durationMs);
            const startHz = Math.max(timing.filterEndHz + 50, timing.filterStartHz);
            const endHz = Math.max(40, timing.filterEndHz);
            const targetQ = Math.max(0.7, timing.filterResonanceQ);

            target.resetFilter?.();
            target.setFilterState?.(startHz, 0.707);

            if (ctx) {
                timeoutId = setTimeout(() => {
                    timeoutId = null;
                    if (cancelled || !target.isActive()) return;
                    target.setGainRamp(0, fadeTailMs / 1000);
                }, fadeStartMs);
            }
            runRafAnimation(durationMs, (progress, _startGain, originalRate) => {
                const eased = 1 - Math.pow(1 - progress, 2.2);
                const cutoffHz = startHz * Math.pow(endHz / startHz, eased);
                const q = 0.707 + ((targetQ - 0.707) * Math.min(1, progress * 1.15));
                target.setFilterState?.(cutoffHz, q);
                target.setPlaybackRate(Math.max(0.98, originalRate));
                if (!ctx) {
                    const fadeProgress = progress <= fadeStartProgress
                        ? 0
                        : (progress - fadeStartProgress) / Math.max(0.0001, 1 - fadeStartProgress);
                    target.setGainRamp(clampGain(_startGain * (1 - Math.min(1, fadeProgress))), 0);
                }
            }, () => {
                target.resetFilter?.();
            });
            break;
        }
    }

    return cancel;
}
