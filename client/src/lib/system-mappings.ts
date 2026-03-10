export type SystemAction =
  | 'stopAll'
  | 'mixer'
  | 'editMode'
  | 'mute'
  | 'banksMenu'
  | 'nextBank'
  | 'prevBank'
  | 'upload'
  | 'volumeUp'
  | 'volumeDown'
  | 'padSizeUp'
  | 'padSizeDown'
  | 'importBank'
  | 'activateSecondary'
  | 'midiShift';

export interface ChannelMapping {
  // Legacy volume mappings (backward compatible)
  keyUp?: string;
  keyDown?: string;
  keyStop?: string;
  midiCC?: number;
  midiNote?: number;

  // Expanded discrete controls
  keyPlayPause?: string;
  keyLoadArm?: string;
  keyCancelLoad?: string;

  keyHotcue1?: string;
  keyHotcue2?: string;
  keyHotcue3?: string;
  keyHotcue4?: string;
  keySetHotcue1?: string;
  keySetHotcue2?: string;
  keySetHotcue3?: string;
  keySetHotcue4?: string;

  midiPlayPause?: number;
  midiStop?: number;
  midiLoadArm?: number;
  midiCancelLoad?: number;

  midiHotcue1?: number;
  midiHotcue2?: number;
  midiHotcue3?: number;
  midiHotcue4?: number;
  midiSetHotcue1?: number;
  midiSetHotcue2?: number;
  midiSetHotcue3?: number;
  midiSetHotcue4?: number;
}

export interface SystemMapping {
  key: string;
  midiNote?: number;
  midiCC?: number;
  color?: string;
}

export interface SystemMappings {
  stopAll: SystemMapping;
  mixer: SystemMapping;
  editMode: SystemMapping;
  mute: SystemMapping;
  banksMenu: SystemMapping;
  nextBank: SystemMapping;
  prevBank: SystemMapping;
  upload: SystemMapping;
  volumeUp: SystemMapping;
  volumeDown: SystemMapping;
  padSizeUp: SystemMapping;
  padSizeDown: SystemMapping;
  importBank: SystemMapping;
  activateSecondary: SystemMapping;
  midiShift: SystemMapping;
  channelMappings: ChannelMapping[];
  channelCount?: number;
  masterVolumeCC?: number;
}

export const DEFAULT_SYSTEM_MAPPINGS: SystemMappings = {
  stopAll: { key: 'Space' },
  mixer: { key: 'M' },
  editMode: { key: 'Z' },
  mute: { key: 'X' },
  banksMenu: { key: 'B' },
  nextBank: { key: '[' },
  prevBank: { key: ']' },
  upload: { key: 'N' },
  volumeUp: { key: 'ArrowUp' },
  volumeDown: { key: 'ArrowDown' },
  padSizeUp: { key: '=' },
  padSizeDown: { key: '-' },
  importBank: { key: 'V' },
  activateSecondary: { key: 'C' },
  midiShift: { key: '' },
  channelMappings: Array.from({ length: 8 }, () => ({
    keyUp: '',
    keyDown: '',
    keyStop: '',
    midiCC: undefined,
    midiNote: undefined,
    keyPlayPause: '',
    keyLoadArm: '',
    keyCancelLoad: '',
    keyHotcue1: '',
    keyHotcue2: '',
    keyHotcue3: '',
    keyHotcue4: '',
    keySetHotcue1: '',
    keySetHotcue2: '',
    keySetHotcue3: '',
    keySetHotcue4: '',
    midiPlayPause: undefined,
    midiStop: undefined,
    midiLoadArm: undefined,
    midiCancelLoad: undefined,
    midiHotcue1: undefined,
    midiHotcue2: undefined,
    midiHotcue3: undefined,
    midiHotcue4: undefined,
    midiSetHotcue1: undefined,
    midiSetHotcue2: undefined,
    midiSetHotcue3: undefined,
    midiSetHotcue4: undefined
  })),
  channelCount: 4,
  masterVolumeCC: undefined
};

export const SYSTEM_ACTION_LABELS: Record<SystemAction, string> = {
  stopAll: 'Stop All',
  mixer: 'Mixer',
  editMode: 'Edit Mode',
  mute: 'Mute/Unmute',
  banksMenu: 'Banks Menu',
  nextBank: 'Next Bank',
  prevBank: 'Previous Bank',
  upload: 'Upload',
  volumeUp: 'Master Volume +',
  volumeDown: 'Master Volume -',
  padSizeUp: 'Pad Size +',
  padSizeDown: 'Pad Size -',
  importBank: 'Import Bank',
  activateSecondary: 'Activate Secondary Page',
  midiShift: 'MIDI Shift'
};

export const SYSTEM_ACTIONS: SystemAction[] = [
  'stopAll',
  'mixer',
  'editMode',
  'mute',
  'banksMenu',
  'nextBank',
  'prevBank',
  'upload',
  'volumeUp',
  'volumeDown',
  'padSizeUp',
  'padSizeDown',
  'importBank',
  'activateSecondary',
  'midiShift'
];
