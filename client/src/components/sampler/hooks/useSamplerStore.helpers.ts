import * as lamejs from 'lamejs';
import { PadData, SamplerBank } from '../types/sampler';

export type DetectedAudioFormat = 'mp3' | 'wav' | 'ogg' | 'unknown';
export type ExportAudioMode = 'fast' | 'compact' | 'trim_mp3';

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });

export const base64ToBlob = (base64: string): Blob => {
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
};

export const buildDuplicateBankName = (sourceName: string, existingBanks: SamplerBank[]): string => {
  const takenNames = new Set(
    existingBanks
      .map((bank) => (typeof bank.name === 'string' ? bank.name.trim().toLowerCase() : ''))
      .filter(Boolean)
  );
  const baseName = `${sourceName} (Copy)`;
  if (!takenNames.has(baseName.toLowerCase())) return baseName;
  let copyNumber = 2;
  while (takenNames.has(`${sourceName} (Copy ${copyNumber})`.toLowerCase())) {
    copyNumber += 1;
  }
  return `${sourceName} (Copy ${copyNumber})`;
};

export const buildDuplicatePadName = (sourceName: string, existingPads: PadData[]): string => {
  const safeSourceName = sourceName.trim().length > 0 ? sourceName.trim() : 'Untitled Pad';
  const takenNames = new Set(
    existingPads
      .map((pad) => (typeof pad.name === 'string' ? pad.name.trim().toLowerCase() : ''))
      .filter(Boolean)
  );
  const baseName = `${safeSourceName} (Copy)`;
  if (!takenNames.has(baseName.toLowerCase())) return baseName.slice(0, 32);
  let copyNumber = 2;
  while (takenNames.has(`${safeSourceName} (Copy ${copyNumber})`.toLowerCase())) {
    copyNumber += 1;
  }
  return `${safeSourceName} (Copy ${copyNumber})`.slice(0, 32);
};

export const detectAudioFormat = (blob: Blob): DetectedAudioFormat => {
  const type = blob.type.toLowerCase();
  if (type.includes('mp3') || type.includes('mpeg')) return 'mp3';
  if (type.includes('wav') || type.includes('wave')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'unknown';
};

const audioBufferToWavBlob = (audioBuffer: AudioBuffer): Blob => {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

const MP3_SUPPORTED_SAMPLE_RATES = [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000] as const;

const resolveNearestSupportedMp3SampleRate = (sampleRate: number): number => {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 44100;
  let best: number = MP3_SUPPORTED_SAMPLE_RATES[0];
  let bestDistance = Math.abs(best - sampleRate);
  for (const candidate of MP3_SUPPORTED_SAMPLE_RATES) {
    const distance = Math.abs(candidate - sampleRate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};

const resampleAudioBuffer = async (
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> => {
  if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0 || audioBuffer.sampleRate === targetSampleRate) {
    return audioBuffer;
  }
  const frameCount = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate));
  const OfflineContextClass =
    window.OfflineAudioContext ||
    (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const offlineContext = new OfflineContextClass(audioBuffer.numberOfChannels, frameCount, targetSampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  return await offlineContext.startRendering();
};

const encodeAudioBufferToMP3 = (
  audioBuffer: AudioBuffer,
  bitrate: number = 128
): { blob: Blob; format: 'mp3' | 'wav'; errorMessage?: string } => {
  const numChannels = Math.max(1, Math.min(2, audioBuffer.numberOfChannels));
  const sampleRate = resolveNearestSupportedMp3SampleRate(audioBuffer.sampleRate);
  try {
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = numChannels > 1 && audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
    const convertToInt16 = (samples: Float32Array): Int16Array => {
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return int16;
    };
    const leftInt16 = convertToInt16(leftChannel);
    const rightInt16 = convertToInt16(rightChannel);
    const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrate);
    const mp3Data: Int8Array[] = [];
    const sampleBlockSize = 1152;
    for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
      const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
      const mp3buf =
        numChannels === 1 ? mp3encoder.encodeBuffer(leftChunk) : mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    const totalLength = mp3Data.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of mp3Data) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return { blob: new Blob([result], { type: 'audio/mp3' }), format: 'mp3' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { blob: audioBufferToWavBlob(audioBuffer), format: 'wav', errorMessage };
  }
};

const encodeAudioBufferToMP3Strict = (
  audioBuffer: AudioBuffer,
  bitrate: number = 128
): Blob => {
  const result = encodeAudioBufferToMP3(audioBuffer, bitrate);
  if (result.format !== 'mp3') {
    throw new Error(result.errorMessage ? `MP3 encoding failed: ${result.errorMessage}` : 'MP3 encoding failed.');
  }
  return result.blob;
};

export const trimAudio = async (
  audioBlob: Blob,
  startTimeMs: number,
  endTimeMs: number,
  originalFormat: DetectedAudioFormat
): Promise<{ blob: Blob; newDurationMs: number }> => {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const arrayBufferCopy = arrayBuffer.slice(0);
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBufferCopy);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor((startTimeMs / 1000) * sampleRate);
    const endSample = Math.min(Math.floor((endTimeMs / 1000) * sampleRate), audioBuffer.length);
    const trimmedLength = endSample - startSample;

    if (trimmedLength <= 0) throw new Error(`Invalid trim range: trimmedLength=${trimmedLength}`);

    const trimmedBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, trimmedLength, sampleRate);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const originalData = audioBuffer.getChannelData(channel);
      const trimmedData = trimmedBuffer.getChannelData(channel);
      for (let i = 0; i < trimmedLength; i++) trimmedData[i] = originalData[startSample + i];
    }
    const newDurationMs = (trimmedLength / sampleRate) * 1000;
    const resultBlob =
      originalFormat === 'mp3' ? encodeAudioBufferToMP3(trimmedBuffer).blob : audioBufferToWavBlob(trimmedBuffer);
    return { blob: resultBlob, newDurationMs };
  } finally {
    await audioContext.close();
  }
};

export const transcodeAudioToMP3 = async (
  audioBlob: Blob,
  options?: {
    startTimeMs?: number;
    endTimeMs?: number;
    applyTrim?: boolean;
    bitrate?: number;
  }
): Promise<{ blob: Blob; newDurationMs: number; appliedTrim: boolean }> => {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const arrayBufferCopy = arrayBuffer.slice(0);
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBufferCopy);
    const sampleRate = audioBuffer.sampleRate;
    const requestedStartMs = Number.isFinite(options?.startTimeMs) ? Math.max(0, options?.startTimeMs || 0) : 0;
    const requestedEndMs = Number.isFinite(options?.endTimeMs) ? Math.max(0, options?.endTimeMs || 0) : 0;
    const shouldBakeTrim = options?.applyTrim === true && requestedEndMs > requestedStartMs;

    let bufferForExport = audioBuffer;
    let appliedTrim = false;
    let trimmedLength = audioBuffer.length;

    if (shouldBakeTrim) {
      const startSample = Math.floor((requestedStartMs / 1000) * sampleRate);
      const endSample = Math.min(Math.floor((requestedEndMs / 1000) * sampleRate), audioBuffer.length);
      trimmedLength = endSample - startSample;
      if (trimmedLength > 0) {
        const trimmedBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, trimmedLength, sampleRate);
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          const originalData = audioBuffer.getChannelData(channel);
          const trimmedData = trimmedBuffer.getChannelData(channel);
          for (let i = 0; i < trimmedLength; i++) trimmedData[i] = originalData[startSample + i];
        }
        bufferForExport = trimmedBuffer;
        appliedTrim = true;
      }
    }

    const electronMp3Transcoder = typeof window !== 'undefined' ? window.electronAPI?.transcodeAudioToMp3 : undefined;
    if (electronMp3Transcoder) {
      const response = await electronMp3Transcoder({
        audioBytes: new Uint8Array(arrayBuffer),
        mimeType: audioBlob.type,
        startTimeMs: requestedStartMs,
        endTimeMs: requestedEndMs,
        applyTrim: appliedTrim,
        bitrate: options?.bitrate ?? 128,
      });
      const returnedBytes = response.audioBytes;
      const normalizedBytes =
        returnedBytes instanceof Uint8Array
          ? returnedBytes
          : returnedBytes instanceof ArrayBuffer
            ? new Uint8Array(returnedBytes)
            : new Uint8Array();
      if (normalizedBytes.byteLength <= 0) {
        throw new Error('Electron MP3 export returned no audio data.');
      }
      const newDurationMs = (Math.max(1, appliedTrim ? trimmedLength : audioBuffer.length) / sampleRate) * 1000;
      return { blob: new Blob([normalizedBytes], { type: 'audio/mp3' }), newDurationMs, appliedTrim };
    }

    const mp3ReadyBuffer = await resampleAudioBuffer(
      bufferForExport,
      resolveNearestSupportedMp3SampleRate(bufferForExport.sampleRate)
    );
    const blob = encodeAudioBufferToMP3Strict(mp3ReadyBuffer, options?.bitrate ?? 128);
    const newDurationMs = (bufferForExport.length / sampleRate) * 1000;
    return { blob, newDurationMs, appliedTrim };
  } finally {
    await audioContext.close();
  }
};

export const remapSavedHotcuesForBakedTrim = (
  hotcues: PadData['savedHotcuesMs'],
  startMs: number,
  trimmedDurationMs: number
): [number | null, number | null, number | null, number | null] => {
  const safeStartMs = Number.isFinite(startMs) ? Math.max(0, startMs) : 0;
  const safeMaxMs = Number.isFinite(trimmedDurationMs) ? Math.max(0, trimmedDurationMs) : 0;
  const values = Array.isArray(hotcues)
    ? (hotcues.slice(0, 4) as [number | null, number | null, number | null, number | null])
    : [null, null, null, null];
  const normalizeCue = (cue: number | null): number | null => {
    if (typeof cue !== 'number' || !Number.isFinite(cue) || cue < 0) return null;
    if (safeMaxMs <= 0) return Math.max(0, cue);
    const absoluteToRelative = cue - safeStartMs;
    const baseValue =
      absoluteToRelative >= 0 && absoluteToRelative <= safeMaxMs
        ? absoluteToRelative
        : cue;
    return Math.max(0, Math.min(safeMaxMs, baseValue));
  };
  return [
    normalizeCue(values[0]),
    normalizeCue(values[1]),
    normalizeCue(values[2]),
    normalizeCue(values[3]),
  ];
};

const BAKED_TRIM_MIN_DELTA_MS = 10000;

export const shouldAttemptTrim = (pad: PadData, mode: ExportAudioMode = 'compact'): boolean => {
  if (mode !== 'compact') return false;
  const startMs = Number.isFinite(pad.startTimeMs) ? Math.max(0, pad.startTimeMs) : 0;
  const endMs = Number.isFinite(pad.endTimeMs) ? Math.max(0, pad.endTimeMs) : 0;
  if (!(endMs > startMs)) return false;

  const sourceDurationMs = Number.isFinite(pad.audioDurationMs) ? Math.max(0, pad.audioDurationMs || 0) : 0;
  const hasMeaningfulTrimIn = startMs >= BAKED_TRIM_MIN_DELTA_MS;
  const hasMeaningfulTrimOut = sourceDurationMs > 0 && (sourceDurationMs - endMs) >= BAKED_TRIM_MIN_DELTA_MS;

  return hasMeaningfulTrimIn || hasMeaningfulTrimOut;
};
