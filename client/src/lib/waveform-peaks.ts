export interface WaveformPeaksData {
  peaks: number[];
  duration: number;
}

const DEFAULT_PEAK_COUNT = 2000;
const waveformDataCache = new Map<string, WaveformPeaksData>();
const waveformCacheAccessTime = new Map<string, number>();
const waveformDataInFlight = new Map<string, Promise<WaveformPeaksData>>();
const waveformQueue: Array<() => void> = [];

const getWaveformCacheEntryCap = (): number => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 72;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = nav.userAgent || '';
  const isNativeCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const isMobile = /iPad|iPhone|iPod|Android/i.test(ua);
  const isElectron = /Electron/i.test(ua);
  const memory = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
    ? Number(nav.deviceMemory)
    : null;
  if (isNativeCapacitor) return 18;
  if (isMobile || (memory !== null && memory <= 4)) return 24;
  if (isElectron) return 72;
  return 56;
};

const getWaveformDecodeConcurrency = (): number => {
  if (typeof navigator === 'undefined') return 2;
  const ua = navigator.userAgent || '';
  const isMobile = /iPad|iPhone|iPod|Android/i.test(ua);
  const memory = typeof (navigator as any).deviceMemory === 'number'
    ? Number((navigator as any).deviceMemory)
    : null;
  if (memory !== null && Number.isFinite(memory) && memory <= 4) return 1;
  return isMobile ? 1 : 2;
};

const WAVEFORM_MAX_CONCURRENCY = getWaveformDecodeConcurrency();
let waveformRunningCount = 0;

const formatWaveformKey = (cacheKey: string): string => {
  if (cacheKey.length <= 96) return cacheKey;
  return `${cacheKey.slice(0, 48)}...${cacheKey.slice(-32)}`;
};

const buildWaveformDecodeCacheKey = (cacheKey: string, peakCount: number): string => (
  `${cacheKey}::peaks:${peakCount}`
);

const logWaveform = (_message: string, _details?: Record<string, unknown>) => {};

const touchWaveformCacheEntry = (cacheKey: string): void => {
  waveformCacheAccessTime.set(cacheKey, Date.now());
};

const trimWaveformCache = (maxEntries: number = getWaveformCacheEntryCap()): void => {
  if (maxEntries <= 0) {
    waveformDataCache.clear();
    waveformCacheAccessTime.clear();
    return;
  }
  if (waveformDataCache.size <= maxEntries) return;
  const evictionOrder = Array.from(waveformCacheAccessTime.entries())
    .sort((left, right) => left[1] - right[1]);
  while (waveformDataCache.size > maxEntries && evictionOrder.length > 0) {
    const [cacheKey] = evictionOrder.shift()!;
    waveformDataCache.delete(cacheKey);
    waveformCacheAccessTime.delete(cacheKey);
  }
};

const runNextWaveformTask = () => {
  if (waveformRunningCount >= WAVEFORM_MAX_CONCURRENCY) return;
  const next = waveformQueue.shift();
  if (!next) return;
  next();
};

const runWaveformTaskBounded = <T>(runner: () => Promise<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const execute = () => {
      waveformRunningCount += 1;
      runner()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          waveformRunningCount = Math.max(0, waveformRunningCount - 1);
          runNextWaveformTask();
        });
    };

    if (waveformRunningCount < WAVEFORM_MAX_CONCURRENCY) {
      execute();
      return;
    }

    waveformQueue.push(execute);
  });
};

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const ctor = (window.AudioContext || (window as any).webkitAudioContext) as
    | typeof AudioContext
    | undefined;
  return ctor || null;
};

const decodeWaveformPeaks = async (
  audioUrl: string,
  peakCount: number,
  logKey: string
): Promise<WaveformPeaksData> => {
  const startedAt = Date.now();
  logWaveform('Fetch start', { key: logKey, peakCount });
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Waveform fetch failed (${response.status} ${response.statusText || 'unknown'})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  logWaveform('Fetch complete', {
    key: logKey,
    bytes: arrayBuffer.byteLength,
    elapsedMs: Date.now() - startedAt
  });

  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error('AudioContext is not available in this environment.');
  }

  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContextCtor();
    logWaveform('Decode start', { key: logKey });
    const decodeStartedAt = Date.now();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    logWaveform('Decode complete', {
      key: logKey,
      elapsedMs: Date.now() - decodeStartedAt,
      channels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      durationSec: Number(audioBuffer.duration.toFixed(3))
    });
    const samples = audioBuffer.getChannelData(0);
    const samplesPerPeak = Math.max(1, Math.floor(samples.length / peakCount));
    const peaks: number[] = [];

    for (let i = 0; i < peakCount; i += 1) {
      const start = i * samplesPerPeak;
      const end = Math.min(samples.length, start + samplesPerPeak);
      let max = 0;
      for (let j = start; j < end; j += 10) {
        const sample = Math.abs(samples[j] || 0);
        if (sample > max) max = sample;
      }
      peaks.push(max);
    }

    const maxPeak = Math.max(...peaks, 1);
    const normalizedPeaks = peaks.map((value) => value / maxPeak);

    const result = {
      peaks: normalizedPeaks,
      duration: audioBuffer.duration
    };
    logWaveform('Peaks ready', {
      key: logKey,
      elapsedMs: Date.now() - startedAt,
      points: normalizedPeaks.length
    });
    return result;
  } catch (error) {
    logWaveform('Decode failed', {
      key: logKey,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close();
    }
  }
};

export const loadWaveformPeaks = async (
  audioUrl: string,
  cacheKey: string = audioUrl,
  peakCount: number = DEFAULT_PEAK_COUNT
): Promise<WaveformPeaksData> => {
  const decodeCacheKey = buildWaveformDecodeCacheKey(cacheKey, peakCount);
  const logKey = formatWaveformKey(decodeCacheKey);
  const existing = waveformDataCache.get(decodeCacheKey);
  if (existing) {
    touchWaveformCacheEntry(decodeCacheKey);
    logWaveform('Cache hit', { key: logKey, points: existing.peaks.length });
    return existing;
  }

  const pending = waveformDataInFlight.get(decodeCacheKey);
  if (pending) {
    logWaveform('Join in-flight decode', { key: logKey });
    return pending;
  }

  logWaveform('Queue decode', {
    key: logKey,
    queueDepth: waveformQueue.length,
    running: waveformRunningCount,
    concurrency: WAVEFORM_MAX_CONCURRENCY
  });
  const task = runWaveformTaskBounded(() => decodeWaveformPeaks(audioUrl, peakCount, logKey))
    .then((data) => {
      waveformDataCache.set(decodeCacheKey, data);
      touchWaveformCacheEntry(decodeCacheKey);
      trimWaveformCache();
      waveformDataInFlight.delete(decodeCacheKey);
      logWaveform('Cached decode result', { key: logKey, points: data.peaks.length });
      return data;
    })
    .catch((error) => {
      waveformDataInFlight.delete(decodeCacheKey);
      logWaveform('Decode task failed', {
        key: logKey,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    });

  waveformDataInFlight.set(decodeCacheKey, task);
  return task;
};

export const resampleWaveformPeaks = (peaks: number[], points: number): number[] => {
  if (!Array.isArray(peaks) || peaks.length === 0 || points <= 0) return [];
  if (peaks.length === points) return peaks;

  const sampled: number[] = [];
  const step = peaks.length / points;
  for (let i = 0; i < points; i += 1) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j += 1) {
      if (peaks[j] > max) max = peaks[j];
    }
    sampled.push(max);
  }
  return sampled;
};

export const trimWaveformPeaksCache = (maxEntries?: number): void => {
  trimWaveformCache(maxEntries);
};
