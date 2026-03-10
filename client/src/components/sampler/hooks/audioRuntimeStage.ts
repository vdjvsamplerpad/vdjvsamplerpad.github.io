export type AudioRuntimeStage = 'disabled' | 'v3_progressive' | 'legacy_full';

export const AUDIO_RUNTIME_STAGE_STORAGE_KEY = 'vdjv_audio_runtime_stage';
export const DEFAULT_AUDIO_RUNTIME_STAGE: AudioRuntimeStage = 'v3_progressive';

export const normalizeAudioRuntimeStage = (raw: string | null): AudioRuntimeStage | null => {
  if (raw === 'disabled' || raw === 'v3_progressive' || raw === 'legacy_full') return raw;
  if (raw === 'pad_basic_v3') return 'v3_progressive';
  if (raw === 'full_rewrite_progressive') return 'legacy_full';
  return null;
};

export const resolveAudioRuntimeStageFromStorage = (
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined
): AudioRuntimeStage => {
  if (!storage) return DEFAULT_AUDIO_RUNTIME_STAGE;
  try {
    const raw = storage.getItem(AUDIO_RUNTIME_STAGE_STORAGE_KEY);
    const normalized = normalizeAudioRuntimeStage(raw);
    if (normalized) {
      // One-time migration from legacy values to explicit runtime stages.
      if (raw !== normalized) {
        storage.setItem(AUDIO_RUNTIME_STAGE_STORAGE_KEY, normalized);
      }
      return normalized;
    }
  } catch {
  }
  return DEFAULT_AUDIO_RUNTIME_STAGE;
};

export const usesLegacyAudioRuntimePath = (stage: AudioRuntimeStage): boolean => stage === 'legacy_full';

