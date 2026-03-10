import type { AudioEngineCore } from '../../../lib/audio-engine';
import type { AudioRuntimeStage } from './audioRuntimeStage';

const V3_PAD_LOAD_FAILURE_COOLDOWN_MS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  ? 12000
  : 8000;
const V3_PAD_QUARANTINE_MS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  ? 30 * 60 * 1000
  : 15 * 60 * 1000;
const V3_PAD_QUARANTINE_STORAGE_KEY = 'vdjv_v3_pad_quarantine_v1';
const V3_PAD_QUARANTINE_MAX_ENTRIES = 256;

export interface V3PadQuarantineEntry {
  audioUrl: string;
  failureCount: number;
  blockedUntil: number;
  lastReason: string;
  updatedAt: number;
}

export interface V3PadRuntimeInfo {
  activePadId: string | null;
  lastPadLoadLatencyMs: number | null;
  lastPadStartLatencyMs: number | null;
  lastPadStopLatencyMs: number | null;
  quarantinedPads: number;
  lastBlockedPadId: string | null;
  lastBlockedReason: string | null;
}

export class AudioPadV3StateRuntime {
  private activePadId: string | null = null;
  private lastPadLoadLatencyMs: number | null = null;
  private lastPadStartLatencyMs: number | null = null;
  private lastPadStopLatencyMs: number | null = null;
  private playTokenCounter = 0;
  private playTokenByPad: Map<string, number> = new Map();
  private pendingPlayPads: Set<string> = new Set();
  private playTimeoutByPad: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private padLoadFailureCountByPad: Map<string, number> = new Map();
  private padLoadCooldownUntilByPad: Map<string, number> = new Map();
  private padQuarantineByPad: Map<string, V3PadQuarantineEntry> = new Map();
  private lastBlockedPadId: string | null = null;
  private lastBlockedReason: string | null = null;
  private lastStutterTriggerAtByPad: Map<string, number> = new Map();
  private transportRegionDirtyPads: Set<string> = new Set();

  getRuntimeInfo(): V3PadRuntimeInfo {
    this.pruneExpiredPadQuarantine();
    return {
      activePadId: this.activePadId,
      lastPadLoadLatencyMs: this.lastPadLoadLatencyMs,
      lastPadStartLatencyMs: this.lastPadStartLatencyMs,
      lastPadStopLatencyMs: this.lastPadStopLatencyMs,
      quarantinedPads: this.padQuarantineByPad.size,
      lastBlockedPadId: this.lastBlockedPadId,
      lastBlockedReason: this.lastBlockedReason,
    };
  }

  getActivePadId(): string | null {
    return this.activePadId;
  }

  setActivePadId(padId: string | null): void {
    this.activePadId = padId;
  }

  getPadWarmState(
    padId: string,
    backend: ReturnType<AudioEngineCore['getEngineBackendForPad']>,
    isReady: boolean,
    isWarming: boolean,
    audioUrl?: string
  ): {
    backend: ReturnType<AudioEngineCore['getEngineBackendForPad']>;
    isReady: boolean;
    isWarming: boolean;
    isPendingPlay: boolean;
    isQuarantined: boolean;
    quarantineRemainingMs: number;
  } {
    const quarantineRemainingMs = audioUrl ? this.getPadQuarantineRemainingMs(padId, audioUrl) : 0;
    return {
      backend,
      isReady,
      isWarming,
      isPendingPlay: this.hasPendingPlay(padId),
      isQuarantined: quarantineRemainingMs > 0,
      quarantineRemainingMs,
    };
  }

  hasPendingPlay(padId: string): boolean {
    return this.pendingPlayPads.has(padId);
  }

  nextPlayToken(padId: string): number {
    this.playTokenCounter += 1;
    const token = this.playTokenCounter;
    this.playTokenByPad.set(padId, token);
    return token;
  }

  isPlayTokenCurrent(padId: string, token: number): boolean {
    return this.playTokenByPad.get(padId) === token;
  }

  beginPendingPlay(padId: string): void {
    this.pendingPlayPads.add(padId);
  }

  finishPendingPlayIfCurrent(padId: string, token: number): boolean {
    if (!this.isPlayTokenCurrent(padId, token)) return false;
    const hadPending = this.pendingPlayPads.delete(padId);
    this.clearPlayTimeout(padId);
    return hadPending;
  }

  cancelPendingPlay(padId: string): void {
    this.clearPlayTimeout(padId);
    this.nextPlayToken(padId);
    this.pendingPlayPads.delete(padId);
  }

  cancelAllPendingPlays(exceptPadId?: string): void {
    Array.from(this.pendingPlayPads).forEach((pendingPadId) => {
      if (pendingPadId === exceptPadId) return;
      this.cancelPendingPlay(pendingPadId);
    });
  }

  armPlayTimeout(padId: string, token: number, onTimeout: () => void, timeoutMs: number): void {
    this.clearPlayTimeout(padId);
    const timeout = setTimeout(() => {
      if (!this.isPlayTokenCurrent(padId, token)) return;
      if (!this.pendingPlayPads.has(padId)) return;
      onTimeout();
    }, timeoutMs);
    this.playTimeoutByPad.set(padId, timeout);
  }

  clearPlayTimeout(padId: string): void {
    const timeout = this.playTimeoutByPad.get(padId);
    if (!timeout) return;
    clearTimeout(timeout);
    this.playTimeoutByPad.delete(padId);
  }

  setLastPadLoadLatencyMs(value: number | null): void {
    this.lastPadLoadLatencyMs = value;
  }

  setLastPadStartLatencyMs(value: number | null): void {
    this.lastPadStartLatencyMs = value;
  }

  setLastPadStopLatencyMs(value: number | null): void {
    this.lastPadStopLatencyMs = value;
  }

  clearPadLoadFailureState(padId: string): void {
    this.padLoadFailureCountByPad.delete(padId);
    this.padLoadCooldownUntilByPad.delete(padId);
  }

  markPadLoadFailure(padId: string, failureThreshold: number): { count: number; cooldownUntil: number | null } {
    const nextCount = (this.padLoadFailureCountByPad.get(padId) || 0) + 1;
    this.padLoadFailureCountByPad.set(padId, nextCount);
    if (nextCount < failureThreshold) {
      return { count: nextCount, cooldownUntil: null };
    }
    const cooldownUntil = Date.now() + V3_PAD_LOAD_FAILURE_COOLDOWN_MS;
    this.padLoadCooldownUntilByPad.set(padId, cooldownUntil);
    return { count: nextCount, cooldownUntil };
  }

  getPadLoadCooldownRemainingMs(padId: string): number {
    const cooldownUntil = this.padLoadCooldownUntilByPad.get(padId);
    if (!cooldownUntil) return 0;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      this.padLoadCooldownUntilByPad.delete(padId);
      return 0;
    }
    return remaining;
  }

  markTransportRegionDirty(padId: string): void {
    this.transportRegionDirtyPads.add(padId);
  }

  clearTransportRegionDirty(padId: string): void {
    this.transportRegionDirtyPads.delete(padId);
  }

  isTransportRegionDirty(padId: string): boolean {
    return this.transportRegionDirtyPads.has(padId);
  }

  shouldSkipStutterTrigger(padId: string, nowMs: number, guardWindowMs: number): boolean {
    if (guardWindowMs <= 0) return false;
    const previousMs = this.lastStutterTriggerAtByPad.get(padId) ?? 0;
    return nowMs - previousMs < guardWindowMs;
  }

  noteStutterTrigger(padId: string, nowMs: number): void {
    this.lastStutterTriggerAtByPad.set(padId, nowMs);
  }

  clearStutterGuard(padId: string): void {
    this.lastStutterTriggerAtByPad.delete(padId);
  }

  restorePadQuarantine(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(V3_PAD_QUARANTINE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const nowMs = Date.now();
      const next = new Map<string, V3PadQuarantineEntry>();
      Object.entries(parsed as Record<string, unknown>).forEach(([padId, value]) => {
        if (!value || typeof value !== 'object') return;
        const entry = value as Record<string, unknown>;
        const audioUrl = typeof entry.audioUrl === 'string' ? entry.audioUrl : '';
        const failureCountRaw = typeof entry.failureCount === 'number' ? entry.failureCount : Number(entry.failureCount);
        const blockedUntilRaw = typeof entry.blockedUntil === 'number' ? entry.blockedUntil : Number(entry.blockedUntil);
        const updatedAtRaw = typeof entry.updatedAt === 'number' ? entry.updatedAt : Number(entry.updatedAt);
        if (!audioUrl || !Number.isFinite(failureCountRaw) || !Number.isFinite(blockedUntilRaw)) return;
        if (blockedUntilRaw <= nowMs) return;
        next.set(padId, {
          audioUrl,
          failureCount: Math.max(1, Math.floor(failureCountRaw)),
          blockedUntil: Math.floor(blockedUntilRaw),
          lastReason: typeof entry.lastReason === 'string' ? entry.lastReason : 'transport_load_failed',
          updatedAt: Number.isFinite(updatedAtRaw) ? Math.floor(updatedAtRaw) : nowMs,
        });
      });
      this.padQuarantineByPad = next;
      this.pruneExpiredPadQuarantine();
    } catch {
    }
  }

  clearPadQuarantineState(padId: string, reason: string | undefined, stage: AudioRuntimeStage): void {
    if (!this.padQuarantineByPad.has(padId)) return;
    this.padQuarantineByPad.delete(padId);
    if (this.lastBlockedPadId === padId) {
      this.lastBlockedPadId = null;
      this.lastBlockedReason = null;
    }
    this.persistPadQuarantine();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vdjv-audio-pad-quarantine', {
        detail: { action: 'cleared', padId, reason: reason || null, stage }
      }));
    }
  }

  maybeQuarantinePadOnLoadFailure(
    padId: string,
    audioUrl: string,
    failureCount: number,
    reason: string,
    stage: AudioRuntimeStage,
    threshold: number
  ): { blockedUntil: number } | null {
    if (!audioUrl) return null;
    if (failureCount < threshold) return null;
    const blockedUntil = Date.now() + V3_PAD_QUARANTINE_MS;
    const nextEntry: V3PadQuarantineEntry = {
      audioUrl,
      failureCount,
      blockedUntil,
      lastReason: reason,
      updatedAt: Date.now(),
    };
    this.padQuarantineByPad.set(padId, nextEntry);
    this.lastBlockedPadId = padId;
    this.lastBlockedReason = reason;
    this.persistPadQuarantine();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vdjv-audio-pad-quarantine', {
        detail: {
          action: 'set',
          padId,
          audioUrl,
          reason,
          failureCount,
          blockedUntil,
          remainingMs: Math.max(0, blockedUntil - Date.now()),
          stage,
        }
      }));
    }
    return { blockedUntil };
  }

  getPadQuarantineRemainingMs(padId: string, audioUrl: string): number {
    const entry = this.getPadQuarantineState(padId, audioUrl);
    if (!entry) return 0;
    const remainingMs = entry.blockedUntil - Date.now();
    if (remainingMs <= 0) {
      this.clearPadQuarantineState(padId, 'expired', 'v3_progressive');
      return 0;
    }
    return remainingMs;
  }

  setLastBlocked(reason: string | null, padId: string | null): void {
    this.lastBlockedReason = reason;
    this.lastBlockedPadId = padId;
  }

  private persistPadQuarantine(): void {
    if (typeof window === 'undefined') return;
    try {
      const entries = Array.from(this.padQuarantineByPad.entries())
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
        .slice(0, V3_PAD_QUARANTINE_MAX_ENTRIES);
      const payload: Record<string, V3PadQuarantineEntry> = {};
      entries.forEach(([padId, entry]) => {
        payload[padId] = { ...entry };
      });
      window.localStorage.setItem(V3_PAD_QUARANTINE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
    }
  }

  private pruneExpiredPadQuarantine(nowMs: number = Date.now()): void {
    let changed = false;
    this.padQuarantineByPad.forEach((entry, padId) => {
      if (entry.blockedUntil <= nowMs) {
        this.padQuarantineByPad.delete(padId);
        changed = true;
        if (this.lastBlockedPadId === padId) {
          this.lastBlockedPadId = null;
          this.lastBlockedReason = null;
        }
      }
    });
    if (changed) {
      this.persistPadQuarantine();
    }
  }

  private getPadQuarantineState(padId: string, expectedAudioUrl: string): V3PadQuarantineEntry | null {
    this.pruneExpiredPadQuarantine();
    const entry = this.padQuarantineByPad.get(padId);
    if (!entry) return null;
    if (!expectedAudioUrl || entry.audioUrl !== expectedAudioUrl) {
      return null;
    }
    return entry;
  }
}
