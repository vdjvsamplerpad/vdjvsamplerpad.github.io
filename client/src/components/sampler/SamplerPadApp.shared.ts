import { type GraphicsProfile } from '@/lib/performance-monitor';
import { DEFAULT_SYSTEM_MAPPINGS, type SystemAction, type SystemMappings } from '@/lib/system-mappings';
import { type PersistedDeckLayoutEntry } from './utils/deck-layout-persistence';
import { type PadData, type StopMode } from './types/sampler';

export const SETTINGS_STORAGE_KEY = 'vdjv-sampler-settings';

export interface AppSettings {
  masterVolume: number;
  stopMode: StopMode;
  sideMenuOpen: boolean;
  mixerOpen: boolean;
  channelCount: number;
  channelCollapsedMap: Record<number, boolean>;
  deckLayout: PersistedDeckLayoutEntry[];
  deckLayoutVersion: number;
  sidePanelMode: 'overlay' | 'reflow';
  editMode: boolean;
  defaultTriggerMode: PadData['triggerMode'];
  padSizePortrait: number;
  padSizeLandscape: number;
  hideShortcutLabels: boolean;
  autoPadBankMapping: boolean;
  midiEnabled: boolean;
  midiDeviceProfileId: string | null;
  systemMappings: SystemMappings;
  graphicsProfile: GraphicsProfile;
}

export type BankMappingValue = {
  shortcutKey: string;
  midiNote: number | null;
  midiCC: number | null;
  bankName?: string;
};

export type PadMappingValue = {
  shortcutKey: string;
  midiNote: number | null;
  midiCC: number | null;
  padName?: string;
};

export type MappingExport = {
  version: number;
  exportedAt: string;
  systemMappings: SystemMappings;
  channelMappings: SystemMappings['channelMappings'];
  bankShortcutKeys: Record<string, BankMappingValue>;
  padShortcutKeys: Record<string, Record<string, PadMappingValue>>;
};

export type ExtendedSystemAction =
  | SystemAction
  | 'padSizeUp'
  | 'padSizeDown'
  | 'importBank'
  | 'activateSecondary';

export const MAPPING_EXPORT_VERSION = 1;

const EXPORT_FOLDER_NAME = 'VDJV-Export';
const ANDROID_DOWNLOAD_ROOT = '/storage/emulated/0/Download';

export const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/.test(ua);
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return isAndroid && capacitor?.isNativePlatform?.() === true;
};

export const saveMappingFile = async (blob: Blob, fileName: string): Promise<string> => {
  if (isNativeAndroid()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const downloadRelativePath = `Download/${EXPORT_FOLDER_NAME}/${fileName}`;
      const downloadAbsolutePath = `${ANDROID_DOWNLOAD_ROOT}/${EXPORT_FOLDER_NAME}/${fileName}`;

      try {
        const permissionStatus = await Filesystem.checkPermissions();
        if (permissionStatus.publicStorage !== 'granted') {
          await Filesystem.requestPermissions();
        }
      } catch {
      }

      try {
        await Filesystem.writeFile({
          path: downloadAbsolutePath,
          data: base64Data,
          recursive: true
        });
        return `Mappings exported to ${downloadRelativePath}`;
      } catch {
      }

      await Filesystem.writeFile({
        path: `${EXPORT_FOLDER_NAME}/${fileName}`,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true
      });
      return `Mappings exported to Documents/${EXPORT_FOLDER_NAME}/${fileName}`;
    } catch {
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return `Mappings exported to selected path (${fileName})`;
};

const resolveDefaultChannelCount = (): number => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 4;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
  const isElectron = /Electron/i.test(ua) || Boolean((window as Window & { process?: { versions?: { electron?: string } } }).process?.versions?.electron);
  return isMobileUA && !isElectron ? 2 : 4;
};

export const DEFAULT_INITIAL_CHANNEL_COUNT = resolveDefaultChannelCount();

export const createDefaultSettings = (
  deckLayoutVersion: number,
  defaultPadSize: number
): AppSettings => ({
  masterVolume: 1,
  stopMode: 'instant',
  sideMenuOpen: false,
  mixerOpen: false,
  channelCount: DEFAULT_INITIAL_CHANNEL_COUNT,
  channelCollapsedMap: {},
  deckLayout: [],
  deckLayoutVersion,
  sidePanelMode: 'overlay',
  editMode: false,
  defaultTriggerMode: 'toggle',
  padSizePortrait: defaultPadSize,
  padSizeLandscape: defaultPadSize,
  hideShortcutLabels: true,
  autoPadBankMapping: true,
  midiEnabled: false,
  midiDeviceProfileId: null,
  systemMappings: {
    ...DEFAULT_SYSTEM_MAPPINGS,
    channelCount: DEFAULT_INITIAL_CHANNEL_COUNT
  },
  graphicsProfile: 'auto'
});

export const mergeSystemMappings = (incoming?: Partial<SystemMappings> | null): SystemMappings => {
  const merged: SystemMappings & { toggleTheme?: unknown } = {
    ...DEFAULT_SYSTEM_MAPPINGS,
    ...(incoming || {})
  };

  if ('toggleTheme' in merged) {
    delete merged.toggleTheme;
  }

  if (typeof merged.channelCount !== 'number' || !Number.isFinite(merged.channelCount)) {
    merged.channelCount = DEFAULT_SYSTEM_MAPPINGS.channelCount;
  } else {
    merged.channelCount = Math.max(2, Math.min(8, Math.floor(merged.channelCount)));
  }

  return merged as SystemMappings;
};

export const normalizePadSize = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

export const isGraphicsProfile = (value: unknown): value is GraphicsProfile =>
  value === 'auto' || value === 'lowest' || value === 'low' || value === 'medium' || value === 'high';

export const isPadTriggerMode = (value: unknown): value is PadData['triggerMode'] =>
  value === 'toggle' || value === 'hold' || value === 'stutter' || value === 'unmute';

export const serializeDeckLayoutForDiff = (entries: PersistedDeckLayoutEntry[]): string =>
  JSON.stringify(entries.map(({ savedAt: _savedAt, ...rest }) => rest));
