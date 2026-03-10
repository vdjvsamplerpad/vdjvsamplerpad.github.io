/**
 * Audio Engine V3 – Barrel Export
 */

export { AudioEngineCore } from './AudioEngineCore';
export { BufferBackend } from './BufferBackend';
export { MediaBackend } from './MediaBackend';
export { selectBackend, shouldFallbackToMedia } from './BackendSelector';
export { executeStop, type StopTarget } from './StopScheduler';
export { computeGain, clampGain, safeVolume, applyGain, scheduleGainRamp } from './GainPipeline';
export { LifecycleManager } from './LifecycleManager';
export {
    checkAdmission,
    checkFileAdmission,
    extractMetadataFromFile,
    extractMetadataFromBlob,
    extractMetadataFromUrl,
    createImportReport,
    type AudioMetadata,
    type AdmissionResult,
    type ImportAdmissionReport,
} from './AudioAdmission';

// Re-export key types
export type {
    AudioBackendType,
    StopMode,
    TriggerMode,
    PlaybackMode,
    HotcueTuple,
    AudioRejectedReason,
    StopTimingProfile,
    AudioLimits,
    EngineConfig,
    EqSettings,
    TransportState,
    IAudioBackend,
    EngineHealth,
} from './types';
export {
    DEFAULT_ENGINE_CONFIG,
    IS_IOS,
    IS_ANDROID,
    getStopTimingProfile,
} from './types';
