import type {
  AndroidMuteGateMode,
  AudioInstance,
  LatencyDistributionStats,
  PadLatencySample,
  PadLatencyStats,
} from './useGlobalPlaybackManager';

const PAD_LATENCY_SAMPLE_MAX = 200;
const IS_CAPACITOR_NATIVE = typeof window !== 'undefined' &&
  Boolean((window as any).Capacitor?.isNativePlatform?.());

interface AudioPadLatencyRuntimeHost {
  getNowMs(): number;
  getAndroidMuteGateMode(): AndroidMuteGateMode;
  getAudioInstances(): Map<string, AudioInstance>;
  getIsAndroid(): boolean;
}

export class AudioPadLatencyRuntime {
  private readonly host: AudioPadLatencyRuntimeHost;
  private readonly padLatencySamples: PadLatencySample[] = [];
  private padLatencyTotalSamples = 0;

  constructor(host: AudioPadLatencyRuntimeHost) {
    this.host = host;
  }

  beginPadLatencyProbe(instance: AudioInstance, playToken: number, mode: AndroidMuteGateMode): void {
    if (!this.isPadLatencyEnabled()) {
      instance.padLatencyProbe = null;
      return;
    }
    instance.padLatencyProbe = {
      playToken,
      padId: instance.padId,
      padName: instance.padName,
      mode,
      triggerAtMs: this.host.getNowMs(),
      startTimeMs: instance.startTimeMs || 0,
      playPromiseResolvedAtMs: null,
      firstPlayingAtMs: null,
      firstTimeupdateAtMs: null,
      playPromiseResolvedCurrentTimeMs: null,
      playingCurrentTimeMs: null,
      firstTimeupdateCurrentTimeMs: null
    };
  }

  markPadLatencyPlayResolved(instance: AudioInstance, playToken: number): void {
    const probe = instance.padLatencyProbe;
    if (!probe || probe.playToken !== playToken || !instance.audioElement) return;
    if (probe.playPromiseResolvedAtMs === null) {
      probe.playPromiseResolvedAtMs = this.host.getNowMs();
      probe.playPromiseResolvedCurrentTimeMs = instance.audioElement.currentTime * 1000;
    }
  }

  markPadLatencyPlaying(instance: AudioInstance): void {
    const probe = instance.padLatencyProbe;
    if (!probe || !instance.audioElement) return;
    if (probe.firstPlayingAtMs === null) {
      probe.firstPlayingAtMs = this.host.getNowMs();
      probe.playingCurrentTimeMs = instance.audioElement.currentTime * 1000;
    }
  }

  markPadLatencyTimeupdate(instance: AudioInstance, currentTimeMs: number): void {
    const probe = instance.padLatencyProbe;
    if (!probe) return;
    if (probe.firstTimeupdateAtMs === null) {
      probe.firstTimeupdateAtMs = this.host.getNowMs();
      probe.firstTimeupdateCurrentTimeMs = currentTimeMs;
      this.finalizePadLatencyProbe(instance);
    }
  }

  getPadLatencyStats(): PadLatencyStats | null {
    return this.computePadLatencyStats();
  }

  resetPadLatencyStats(): void {
    this.padLatencySamples.length = 0;
    this.padLatencyTotalSamples = 0;
    this.host.getAudioInstances().forEach((instance) => {
      instance.padLatencyProbe = null;
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vdjv-pad-latency-stats', { detail: this.computePadLatencyStats() }));
    }
  }

  private isPadLatencyEnabled(): boolean {
    return this.host.getIsAndroid() && IS_CAPACITOR_NATIVE;
  }

  private toLatencyDistribution(values: number[]): LatencyDistributionStats {
    if (values.length === 0) {
      return { count: 0, avgMs: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
    const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
    return {
      count: sorted.length,
      avgMs: sum / sorted.length,
      medianMs: median,
      p95Ms: sorted[p95Index],
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1]
    };
  }

  private computePadLatencyStats(): PadLatencyStats | null {
    if (!this.isPadLatencyEnabled()) return null;
    const numbers = (picker: (sample: PadLatencySample) => number | null): number[] =>
      this.padLatencySamples
        .map(picker)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
      enabled: true,
      mode: this.host.getAndroidMuteGateMode(),
      sampleCount: this.padLatencySamples.length,
      totalSamples: this.padLatencyTotalSamples,
      maxSamples: PAD_LATENCY_SAMPLE_MAX,
      lastSample: this.padLatencySamples[this.padLatencySamples.length - 1] || null,
      triggerToPlayResolveMs: this.toLatencyDistribution(numbers((sample) => sample.triggerToPlayResolveMs)),
      triggerToPlayingMs: this.toLatencyDistribution(numbers((sample) => sample.triggerToPlayingMs)),
      triggerToFirstTimeupdateMs: this.toLatencyDistribution(numbers((sample) => sample.triggerToFirstTimeupdateMs)),
      headAdvanceAtPlayResolveMs: this.toLatencyDistribution(numbers((sample) => sample.headAdvanceAtPlayResolveMs)),
      headAdvanceAtPlayingMs: this.toLatencyDistribution(numbers((sample) => sample.headAdvanceAtPlayingMs)),
      headAdvanceAtFirstTimeupdateMs: this.toLatencyDistribution(numbers((sample) => sample.headAdvanceAtFirstTimeupdateMs)),
      audibleGateDelayMs: this.toLatencyDistribution(numbers((sample) => sample.audibleGateDelayMs))
    };
  }

  private publishPadLatencyStatsEvents(sample: PadLatencySample): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vdjv-pad-latency-sample', { detail: sample }));
    window.dispatchEvent(new CustomEvent('vdjv-pad-latency-stats', { detail: this.computePadLatencyStats() }));
  }

  private finalizePadLatencyProbe(instance: AudioInstance): void {
    const probe = instance.padLatencyProbe;
    instance.padLatencyProbe = null;
    if (!probe) return;
    const toDelta = (stamp: number | null): number | null => (
      stamp === null ? null : Math.max(0, stamp - probe.triggerAtMs)
    );
    const toHeadAdvance = (value: number | null): number | null => (
      value === null ? null : value - probe.startTimeMs
    );
    const triggerToPlayResolveMs = toDelta(probe.playPromiseResolvedAtMs);
    const sample: PadLatencySample = {
      padId: probe.padId,
      padName: probe.padName,
      mode: probe.mode,
      triggerAtMs: probe.triggerAtMs,
      startTimeMs: probe.startTimeMs,
      playPromiseResolvedAtMs: probe.playPromiseResolvedAtMs,
      firstPlayingAtMs: probe.firstPlayingAtMs,
      firstTimeupdateAtMs: probe.firstTimeupdateAtMs,
      playPromiseResolvedCurrentTimeMs: probe.playPromiseResolvedCurrentTimeMs,
      playingCurrentTimeMs: probe.playingCurrentTimeMs,
      firstTimeupdateCurrentTimeMs: probe.firstTimeupdateCurrentTimeMs,
      triggerToPlayResolveMs,
      triggerToPlayingMs: toDelta(probe.firstPlayingAtMs),
      triggerToFirstTimeupdateMs: toDelta(probe.firstTimeupdateAtMs),
      headAdvanceAtPlayResolveMs: toHeadAdvance(probe.playPromiseResolvedCurrentTimeMs),
      headAdvanceAtPlayingMs: toHeadAdvance(probe.playingCurrentTimeMs),
      headAdvanceAtFirstTimeupdateMs: toHeadAdvance(probe.firstTimeupdateCurrentTimeMs),
      audibleGateDelayMs: probe.mode === 'legacy' ? triggerToPlayResolveMs : 0
    };
    this.padLatencySamples.push(sample);
    if (this.padLatencySamples.length > PAD_LATENCY_SAMPLE_MAX) {
      this.padLatencySamples.splice(0, this.padLatencySamples.length - PAD_LATENCY_SAMPLE_MAX);
    }
    this.padLatencyTotalSamples += 1;
    this.publishPadLatencyStatsEvents(sample);
  }
}
