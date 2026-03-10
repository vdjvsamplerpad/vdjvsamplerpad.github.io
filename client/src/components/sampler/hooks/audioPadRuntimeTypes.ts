import type { HotcueTuple, PadPlaybackMode, PadTriggerMode } from './audioPadNormalization';

export interface AudioPadRuntimeRegistrationData {
  name: string;
  audioUrl: string;
  color: string;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  startTimeMs: number;
  endTimeMs: number;
  pitch: number;
  triggerMode: PadTriggerMode;
  playbackMode: PadPlaybackMode;
  gainDb?: number;
  gain?: number;
  tempoPercent?: number;
  keyLock?: boolean;
  ignoreChannel?: boolean;
  savedHotcuesMs?: HotcueTuple;
  audioBytes?: number;
  audioDurationMs?: number;
  imageUrl?: string;
  imageData?: string;
}

export interface AudioPadRuntimeSettings extends Partial<Omit<AudioPadRuntimeRegistrationData, 'audioUrl'>> {
  padName?: string;
  bankId?: string;
  bankName?: string;
}
