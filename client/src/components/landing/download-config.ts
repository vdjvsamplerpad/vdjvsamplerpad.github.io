export type VersionKey = 'V1' | 'V2' | 'V3';
export type PlatformKey = 'android' | 'ios' | 'windows' | 'macos';

export const VERSION_OPTIONS: VersionKey[] = ['V1', 'V2', 'V3'];

export const DOWNLOAD_LINKS: Record<VersionKey, Record<PlatformKey, string>> = {
  V1: {
    android: 'https://vdjvsamplerpad.online/android',
    ios: 'https://vdjvsamplerpad.online/ios',
    windows: 'https://vdjvsamplerpad.online',
    macos: '',
  },
  V2: {
    android: 'https://www.mediafire.com/file/lxd0x4365yrhgzf/',
    ios: '',
    windows: 'https://www.mediafire.com/file/0h40ivp0y63su8b/',
    macos: '',
  },
  V3: {
    android: 'https://www.mediafire.com/file/lxd0x4365yrhgzf/',
    ios: '',
    windows: 'https://www.mediafire.com/file/0h40ivp0y63su8b/',
    macos: '',
  },
};
