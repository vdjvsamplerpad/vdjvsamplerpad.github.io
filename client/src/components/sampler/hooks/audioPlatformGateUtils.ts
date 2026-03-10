const ANDROID_LEGACY_MUTE_GATE_KEY = 'vdjv_audio_android_legacy_mute_gate';
const IS_CAPACITOR_NATIVE = typeof window !== 'undefined' &&
  Boolean((window as any).Capacitor?.isNativePlatform?.());

export type AndroidMuteGateModeValue = 'legacy' | 'fast';

export function getAudioNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function getAndroidMuteGateModeValue(isAndroid: boolean): AndroidMuteGateModeValue {
  if (!isAndroid || !IS_CAPACITOR_NATIVE || typeof window === 'undefined') return 'legacy';
  try {
    return window.localStorage.getItem(ANDROID_LEGACY_MUTE_GATE_KEY) === '1' ? 'legacy' : 'fast';
  } catch {
    return 'fast';
  }
}

export function isAndroidNativeFastPathEnabledValue(isAndroid: boolean): boolean {
  return isAndroid && IS_CAPACITOR_NATIVE && getAndroidMuteGateModeValue(isAndroid) === 'fast';
}

export function setAndroidMuteGateLegacyValue(isAndroid: boolean, enabled: boolean): AndroidMuteGateModeValue {
  if (!isAndroid || !IS_CAPACITOR_NATIVE || typeof window === 'undefined') return 'legacy';
  try {
    window.localStorage.setItem(ANDROID_LEGACY_MUTE_GATE_KEY, enabled ? '1' : '0');
  } catch {
  }
  return getAndroidMuteGateModeValue(isAndroid);
}
