import * as React from 'react';
import { normalizeShortcutKey } from '@/lib/keyboard-shortcuts';
import { DEFAULT_SYSTEM_MAPPINGS, type ChannelMapping, type SystemAction, type SystemMappings } from '@/lib/system-mappings';
import { DECK_LAYOUT_SCHEMA_VERSION, normalizeDeckLayoutEntries } from '../utils/deck-layout-persistence';
import { type PadData, type SamplerBank } from '../types/sampler';
import {
  MAPPING_EXPORT_VERSION,
  mergeSystemMappings,
  saveMappingFile,
  type AppSettings,
  type BankMappingValue,
  type MappingExport,
  type PadMappingValue
} from '../SamplerPadApp.shared';

type UpdateBank = (bankId: string, updates: Partial<SamplerBank>) => void | Promise<void>;
type UpdatePad = (bankId: string, padId: string, pad: PadData) => void | Promise<void>;

type PlaybackManagerLike = {
  setChannelCount: (count: number) => void;
  getChannelStates: () => Array<{ channelId: number; isPlaying: boolean }>;
};

type RestoreAppBackupResult = {
  settings?: unknown;
  mappings?: unknown;
  message: string;
};

type RehydrateMissingMediaResult = {
  missingBefore: number;
  remaining: number;
  restored: number;
  remainingOfficial: number;
  remainingUser: number;
};

interface UseSamplerPadAppMappingsParams {
  banks: SamplerBank[];
  currentBankId: string | null;
  primaryBankId: string | null;
  secondaryBankId: string | null;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  playbackManager: PlaybackManagerLike;
  updateBank: UpdateBank;
  updatePad: UpdatePad;
  importBank: (file: File) => Promise<SamplerBank | null>;
  exportAppBackup: (payload: Record<string, unknown>, options?: { riskMode?: boolean }) => Promise<string>;
  restoreAppBackup: (file: File, companionFiles?: File[]) => Promise<RestoreAppBackupResult>;
  recoverMissingMediaFromBanks: (files: File[], options?: { addAsNewWhenNoTarget?: boolean }) => Promise<string>;
  rehydrateMissingMediaInBank: (bankId: string) => Promise<RehydrateMissingMediaResult>;
  defaultBankShortcutLayout: string[];
  orderedBanks: SamplerBank[];
  normalizeStoredShortcutKey: (value: string | null | undefined) => string | undefined;
}

export function useSamplerPadAppMappings({
  banks,
  currentBankId,
  primaryBankId,
  secondaryBankId,
  settings,
  setSettings,
  playbackManager,
  updateBank,
  updatePad,
  importBank,
  exportAppBackup,
  restoreAppBackup,
  recoverMissingMediaFromBanks,
  rehydrateMissingMediaInBank,
  defaultBankShortcutLayout,
  orderedBanks,
  normalizeStoredShortcutKey
}: UseSamplerPadAppMappingsParams) {
  type PadWithMidi = PadData & { midiNote?: number; midiCC?: number };

  const [pendingChannelCountConfirm, setPendingChannelCountConfirm] = React.useState<{
    nextCount: number;
  } | null>(null);

  const updateSystemMapping = React.useCallback((action: SystemAction, updates: Partial<SystemMappings[SystemAction]>) => {
    setSettings((prev) => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        [action]: {
          ...prev.systemMappings[action],
          ...updates
        }
      }
    }));
  }, [setSettings]);

  const updateSystemKey = React.useCallback((action: SystemAction, key: string) => {
    updateSystemMapping(action, { key });
  }, [updateSystemMapping]);

  const updateSystemMidi = React.useCallback((action: SystemAction, midiNote?: number, midiCC?: number) => {
    updateSystemMapping(action, { midiNote, midiCC });
  }, [updateSystemMapping]);

  const updateSystemColor = React.useCallback((action: SystemAction, color?: string) => {
    updateSystemMapping(action, { color });
  }, [updateSystemMapping]);

  const resetSystemMapping = React.useCallback((action: SystemAction) => {
    setSettings((prev) => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        [action]: { ...DEFAULT_SYSTEM_MAPPINGS[action] }
      }
    }));
  }, [setSettings]);

  const setMasterVolumeCC = React.useCallback((cc?: number) => {
    setSettings((prev) => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        masterVolumeCC: cc
      }
    }));
  }, [setSettings]);

  const updateChannelMapping = React.useCallback((channelIndex: number, updates: Partial<ChannelMapping>) => {
    setSettings((prev) => {
      const nextMappings = [...(prev.systemMappings.channelMappings || [])];
      while (nextMappings.length < 8) {
        nextMappings.push({ keyUp: '', keyDown: '', keyStop: '', midiCC: undefined, midiNote: undefined });
      }
      nextMappings[channelIndex] = { ...nextMappings[channelIndex], ...updates };
      return {
        ...prev,
        systemMappings: {
          ...prev.systemMappings,
          channelMappings: nextMappings
        }
      };
    });
  }, [setSettings]);

  const applyChannelCountChange = React.useCallback((nextCount: number) => {
    const safeCount = Math.max(2, Math.min(8, Math.floor(nextCount || 4)));
    setSettings((prev) => ({
      ...prev,
      channelCount: safeCount,
      systemMappings: {
        ...prev.systemMappings,
        channelCount: safeCount
      }
    }));
    playbackManager.setChannelCount(safeCount);
  }, [playbackManager, setSettings]);

  const handleChannelCountChange = React.useCallback((nextCount: number) => {
    const safeCount = Math.max(2, Math.min(8, Math.floor(nextCount || 4)));
    const previousCount = Math.max(2, Math.min(8, Math.floor(settings.channelCount || 4)));
    if (safeCount === previousCount) return;
    if (safeCount < previousCount) {
      const removedHasPlayingDeck = playbackManager
        .getChannelStates()
        .some((channel) => channel.channelId > safeCount && channel.isPlaying);
      if (removedHasPlayingDeck) {
        setPendingChannelCountConfirm({ nextCount: safeCount });
        return;
      }
    }
    applyChannelCountChange(safeCount);
  }, [applyChannelCountChange, playbackManager, settings.channelCount]);

  const systemActions = React.useMemo(
    () =>
      (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
        .filter((key) => key !== 'channelMappings' && key !== 'masterVolumeCC') as SystemAction[],
    []
  );

  const buildEmptyChannelMappings = React.useCallback(
    () => DEFAULT_SYSTEM_MAPPINGS.channelMappings.map((entry) => ({ ...entry })),
    []
  );

  const handleResetAllSystemMappings = React.useCallback(() => {
    setSettings((prev) => {
      const nextMappings = { ...prev.systemMappings };
      systemActions.forEach((action) => {
        nextMappings[action] = { ...DEFAULT_SYSTEM_MAPPINGS[action] };
      });
      return { ...prev, systemMappings: nextMappings };
    });
  }, [setSettings, systemActions]);

  const handleClearAllSystemMappings = React.useCallback(() => {
    setSettings((prev) => {
      const nextMappings = { ...prev.systemMappings };
      systemActions.forEach((action) => {
        nextMappings[action] = { key: '' };
      });
      nextMappings.masterVolumeCC = undefined;
      return { ...prev, systemMappings: nextMappings };
    });
  }, [setSettings, systemActions]);

  const handleResetAllChannelMappings = React.useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        channelMappings: buildEmptyChannelMappings()
      }
    }));
  }, [buildEmptyChannelMappings, setSettings]);

  const handleClearAllChannelMappings = React.useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        channelMappings: buildEmptyChannelMappings()
      }
    }));
  }, [buildEmptyChannelMappings, setSettings]);

  const buildMappingExport = React.useCallback((): MappingExport => {
    const channelMappings = settings.systemMappings.channelMappings || [];
    const bankShortcutKeys: Record<string, BankMappingValue> = {};
    const padShortcutKeys: Record<string, Record<string, PadMappingValue>> = {};

    banks.forEach((bank) => {
      bankShortcutKeys[bank.id] = {
        shortcutKey: bank.shortcutKey || '',
        midiNote: typeof bank.midiNote === 'number' ? bank.midiNote : null,
        midiCC: typeof bank.midiCC === 'number' ? bank.midiCC : null,
        bankName: bank.name
      };
      const padMappings: Record<string, PadMappingValue> = {};
      bank.pads.forEach((pad) => {
        padMappings[pad.id] = {
          shortcutKey: pad.shortcutKey || '',
          midiNote: typeof pad.midiNote === 'number' ? pad.midiNote : null,
          midiCC: typeof pad.midiCC === 'number' ? pad.midiCC : null,
          padName: pad.name
        };
      });
      padShortcutKeys[bank.id] = padMappings;
    });

    return {
      version: MAPPING_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      systemMappings: settings.systemMappings,
      channelMappings,
      bankShortcutKeys,
      padShortcutKeys
    };
  }, [banks, settings.systemMappings]);

  const handleExportMappings = React.useCallback(async () => {
    const payload = buildMappingExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `vdjv-mappings-${timestamp}.json`;
    return saveMappingFile(blob, fileName);
  }, [buildMappingExport]);

  const handleImportMappings = React.useCallback(async (file: File) => {
    const text = await file.text();
    let data: MappingExport | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Invalid mapping file: JSON parse failed.');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid mapping file: missing data.');
    }

    const incomingSystemMappings = typeof data.systemMappings === 'object' && data.systemMappings ? data.systemMappings : null;
    const incomingChannelMappings = Array.isArray(data.channelMappings)
      ? data.channelMappings
      : (Array.isArray(incomingSystemMappings?.channelMappings)
        ? incomingSystemMappings.channelMappings || []
        : settings.systemMappings.channelMappings || []);

    const mergedSystemMappings = mergeSystemMappings((incomingSystemMappings || {}) as Partial<SystemMappings>);
    mergedSystemMappings.channelMappings = incomingChannelMappings;

    setSettings((prev) => ({
      ...prev,
      systemMappings: mergedSystemMappings
    }));

    const banksById = new Map(banks.map((bank) => [bank.id, bank] as const));
    const bankShortcutKeys = data.bankShortcutKeys && typeof data.bankShortcutKeys === 'object' ? data.bankShortcutKeys : {};
    const padShortcutKeys = data.padShortcutKeys && typeof data.padShortcutKeys === 'object' ? data.padShortcutKeys : {};
    const hasBankMappings = Object.keys(bankShortcutKeys).length > 0;
    const hasPadMappings = Object.keys(padShortcutKeys).length > 0;
    const bankNameById = new Map<string, string>();

    Object.entries(bankShortcutKeys).forEach(([bankId, mapping]) => {
      const bankMapping = mapping as BankMappingValue;
      if (bankMapping?.bankName) {
        bankNameById.set(bankId, bankMapping.bankName);
      }
    });

    if (hasBankMappings) {
      banks.forEach((bank) => {
        updateBank(bank.id, { shortcutKey: undefined, midiNote: undefined, midiCC: undefined });
      });
    }

    if (hasPadMappings) {
      banks.forEach((bank) => {
        bank.pads.forEach((pad) => {
          updatePad(bank.id, pad.id, {
            ...pad,
            shortcutKey: undefined,
            midiNote: undefined,
            midiCC: undefined
          });
        });
      });
    }

    let appliedBanks = 0;
    let skippedBanks = 0;
    let appliedPads = 0;
    let skippedPads = 0;

    Object.entries(bankShortcutKeys).forEach(([bankId, mapping]) => {
      const bankMapping = mapping as BankMappingValue;
      let bank = banksById.get(bankId);
      if (!bank && bankMapping?.bankName) {
        bank = banks.find((entry) => entry.name === bankMapping.bankName);
      }
      if (!bank) {
        skippedBanks += 1;
        return;
      }
      if (!mapping || typeof mapping !== 'object') return;
      const nextShortcut = typeof bankMapping.shortcutKey === 'string' ? bankMapping.shortcutKey : '';
      updateBank(bank.id, {
        shortcutKey: nextShortcut || undefined,
        midiNote: typeof bankMapping.midiNote === 'number' ? bankMapping.midiNote : undefined,
        midiCC: typeof bankMapping.midiCC === 'number' ? bankMapping.midiCC : undefined
      });
      appliedBanks += 1;
    });

    Object.entries(padShortcutKeys).forEach(([bankId, padMappings]) => {
      let bank = banksById.get(bankId);
      if (!bank) {
        const bankName = bankNameById.get(bankId);
        if (bankName) {
          bank = banks.find((entry) => entry.name === bankName);
        }
      }
      if (!bank) {
        if (padMappings && typeof padMappings === 'object') {
          skippedPads += Object.keys(padMappings).length;
        }
        skippedBanks += 1;
        return;
      }
      if (!padMappings || typeof padMappings !== 'object') return;
      Object.entries(padMappings as Record<string, PadMappingValue>).forEach(([padId, mapping]) => {
        let pad = bank.pads.find((entry) => entry.id === padId);
        if (!pad && mapping?.padName) {
          pad = bank.pads.find((entry) => entry.name === mapping.padName);
        }
        if (!pad) {
          skippedPads += 1;
          return;
        }
        const nextShortcut = typeof mapping.shortcutKey === 'string' ? mapping.shortcutKey : '';
        updatePad(bank.id, pad.id, {
          ...pad,
          shortcutKey: nextShortcut || undefined,
          midiNote: typeof mapping.midiNote === 'number' ? mapping.midiNote : undefined,
          midiCC: typeof mapping.midiCC === 'number' ? mapping.midiCC : undefined
        });
        appliedPads += 1;
      });
    });

    return `Mappings imported. Banks: ${appliedBanks} updated, ${skippedBanks} skipped. Pads: ${appliedPads} updated, ${skippedPads} skipped.`;
  }, [banks, setSettings, settings.systemMappings.channelMappings, updateBank, updatePad]);

  const handleImportSharedBank = React.useCallback(async (file: File) => {
    const imported = await importBank(file);
    if (!imported) {
      throw new Error('Shared bank import failed.');
    }
    return `Imported shared bank "${imported.name}".`;
  }, [importBank]);

  const handleExportAppBackup = React.useCallback(async (options?: { riskMode?: boolean }) => {
    const payload = {
      settings: settings as unknown as Record<string, unknown>,
      mappings: buildMappingExport() as unknown as Record<string, unknown>,
      state: {
        primaryBankId,
        secondaryBankId,
        currentBankId
      }
    };
    return exportAppBackup(payload, options);
  }, [buildMappingExport, currentBankId, exportAppBackup, primaryBankId, secondaryBankId, settings]);

  const handleRestoreAppBackup = React.useCallback(async (file: File, companionFiles: File[] = []) => {
    const result = await restoreAppBackup(file, companionFiles);

    if (result.settings) {
      const restoredSettings = result.settings as Partial<AppSettings>;
      const normalizedDeckLayout = normalizeDeckLayoutEntries(restoredSettings.deckLayout);
      setSettings((prev) => ({
        ...prev,
        ...restoredSettings,
        deckLayout: normalizedDeckLayout,
        deckLayoutVersion: DECK_LAYOUT_SCHEMA_VERSION,
        systemMappings: mergeSystemMappings((restoredSettings.systemMappings || prev.systemMappings) as Partial<SystemMappings>)
      }));
    }

    if (result.mappings) {
      const mappingsPayload = result.mappings as MappingExport;
      if (mappingsPayload?.systemMappings) {
        setSettings((prev) => ({
          ...prev,
          systemMappings: mergeSystemMappings(mappingsPayload.systemMappings)
        }));
      }
    }

    return result.message;
  }, [restoreAppBackup, setSettings]);

  const handleRecoverMissingMediaFromBanks = React.useCallback(async (
    files: File[],
    options?: { addAsNewWhenNoTarget?: boolean }
  ) => recoverMissingMediaFromBanks(files, options), [recoverMissingMediaFromBanks]);

  const handleRetryMissingMediaInCurrentBank = React.useCallback(async () => {
    const targetBankId = currentBankId || primaryBankId || secondaryBankId;
    if (!targetBankId) {
      return 'No active bank selected.';
    }

    const targetBankName = banks.find((bank) => bank.id === targetBankId)?.name || 'Current bank';
    const result = await rehydrateMissingMediaInBank(targetBankId);

    if (result.missingBefore <= 0) {
      return `${targetBankName}: no missing media found.`;
    }
    if (result.remaining <= 0) {
      return `${targetBankName}: restored ${result.missingBefore} missing pad(s).`;
    }
    const suffixParts: string[] = [];
    if (result.remainingUser > 0) {
      suffixParts.push(`${result.remainingUser} user pad missing: original file required`);
    }
    if (result.remainingOfficial > 0) {
      suffixParts.push(`${result.remainingOfficial} official pad missing: repair from Store required`);
    }
    const suffix = suffixParts.length > 0 ? ` ${suffixParts.join('. ')}.` : '';
    return `${targetBankName}: restored ${result.restored}/${result.missingBefore} missing pad(s). ${result.remaining} still need recovery.${suffix}`;
  }, [banks, currentBankId, primaryBankId, rehydrateMissingMediaInBank, secondaryBankId]);

  const padShortcutByBank = React.useMemo(() => {
    const map = new Map<string, Map<string, { pad: PadData; bankId: string; bankName: string }>>();
    banks.forEach((bank) => {
      const bankMap = new Map<string, { pad: PadData; bankId: string; bankName: string }>();
      bank.pads.forEach((pad) => {
        const normalized = normalizeStoredShortcutKey(pad.shortcutKey);
        if (normalized) {
          bankMap.set(normalized, { pad: { ...pad, shortcutKey: normalized }, bankId: bank.id, bankName: bank.name });
        }
      });
      map.set(bank.id, bankMap);
    });
    return map;
  }, [banks, normalizeStoredShortcutKey]);

  const midiNoteByBank = React.useMemo(() => {
    const map = new Map<string, Map<number, { pad: PadData; bankId: string; bankName: string }>>();
    banks.forEach((bank) => {
      const bankMap = new Map<number, { pad: PadData; bankId: string; bankName: string }>();
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiNote === 'number') {
          bankMap.set(midiPad.midiNote, { pad: midiPad, bankId: bank.id, bankName: bank.name });
        }
      });
      map.set(bank.id, bankMap);
    });
    return map;
  }, [banks]);

  const midiCCByBank = React.useMemo(() => {
    const map = new Map<string, Map<number, { pad: PadData; bankId: string; bankName: string }>>();
    banks.forEach((bank) => {
      const bankMap = new Map<number, { pad: PadData; bankId: string; bankName: string }>();
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiCC === 'number') {
          bankMap.set(midiPad.midiCC, { pad: midiPad, bankId: bank.id, bankName: bank.name });
        }
      });
      map.set(bank.id, bankMap);
    });
    return map;
  }, [banks]);

  const midiBankNoteMap = React.useMemo(() => {
    const map = new Map<number, { bankId: string; bankName: string }>();
    banks.forEach((bank) => {
      if (typeof bank.midiNote === 'number') {
        map.set(bank.midiNote, { bankId: bank.id, bankName: bank.name });
      }
    });
    return map;
  }, [banks]);

  const midiBankCCMap = React.useMemo(() => {
    const map = new Map<number, { bankId: string; bankName: string }>();
    banks.forEach((bank) => {
      if (typeof bank.midiCC === 'number') {
        map.set(bank.midiCC, { bankId: bank.id, bankName: bank.name });
      }
    });
    return map;
  }, [banks]);

  const midiNoteAssignments = React.useMemo(() => {
    const assignments: Array<{ note: number; type: 'pad' | 'bank'; bankName: string; padName?: string }> = [];
    banks.forEach((bank) => {
      if (typeof bank.midiNote === 'number') {
        assignments.push({ note: bank.midiNote, type: 'bank', bankName: bank.name });
      }
      bank.pads.forEach((pad) => {
        if (typeof pad.midiNote === 'number') {
          assignments.push({
            note: pad.midiNote,
            type: 'pad',
            bankName: bank.name,
            padName: pad.name
          });
        }
      });
    });
    return assignments;
  }, [banks]);

  const bankShortcutMap = React.useMemo(() => {
    const map = new Map<string, { bankId: string; bankName: string }>();
    banks.forEach((bank) => {
      const normalized = normalizeStoredShortcutKey(bank.shortcutKey);
      if (normalized) {
        map.set(normalized, { bankId: bank.id, bankName: bank.name });
      }
    });
    return map;
  }, [banks, normalizeStoredShortcutKey]);

  const padBankShortcutKeys = React.useMemo(() => {
    const keys = new Set<string>();
    banks.forEach((bank) => {
      const bankKey = normalizeStoredShortcutKey(bank.shortcutKey);
      if (bankKey) keys.add(bankKey);
      bank.pads.forEach((pad) => {
        const padKey = normalizeStoredShortcutKey(pad.shortcutKey);
        if (padKey) keys.add(padKey);
      });
    });
    return keys;
  }, [banks, normalizeStoredShortcutKey]);

  const padBankMidiNotes = React.useMemo(() => {
    const notes = new Set<number>();
    banks.forEach((bank) => {
      if (typeof bank.midiNote === 'number') notes.add(bank.midiNote);
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiNote === 'number') notes.add(midiPad.midiNote);
      });
    });
    return notes;
  }, [banks]);

  const padBankMidiCCs = React.useMemo(() => {
    const ccs = new Set<number>();
    banks.forEach((bank) => {
      if (typeof bank.midiCC === 'number') ccs.add(bank.midiCC);
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiCC === 'number') ccs.add(midiPad.midiCC);
      });
    });
    return ccs;
  }, [banks]);

  const channelMappings = settings.systemMappings.channelMappings || [];

  const systemKeys = React.useMemo(() => {
    const keys = new Set<string>();
    (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const mapping = settings.systemMappings[key as SystemAction];
        if (mapping?.key) keys.add(mapping.key);
      });
    return keys;
  }, [settings.systemMappings]);

  const systemMidiNotes = React.useMemo(() => {
    const notes = new Set<number>();
    (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const mapping = settings.systemMappings[key as SystemAction];
        if (typeof mapping?.midiNote === 'number') notes.add(mapping.midiNote);
      });
    return notes;
  }, [settings.systemMappings]);

  const systemMidiCCs = React.useMemo(() => {
    const ccs = new Set<number>();
    (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const mapping = settings.systemMappings[key as SystemAction];
        if (typeof mapping?.midiCC === 'number') ccs.add(mapping.midiCC);
      });
    if (typeof settings.systemMappings.masterVolumeCC === 'number') {
      ccs.add(settings.systemMappings.masterVolumeCC);
    }
    return ccs;
  }, [settings.systemMappings]);

  const channelKeys = React.useMemo(() => {
    const keys = new Set<string>();
    channelMappings.forEach((mapping) => {
      if (mapping?.keyUp) keys.add(mapping.keyUp);
      if (mapping?.keyDown) keys.add(mapping.keyDown);
      if (mapping?.keyStop) keys.add(mapping.keyStop);
    });
    return keys;
  }, [channelMappings]);

  const channelMidiNotes = React.useMemo(() => {
    const notes = new Set<number>();
    channelMappings.forEach((mapping) => {
      if (typeof mapping?.midiNote === 'number') notes.add(mapping.midiNote);
    });
    return notes;
  }, [channelMappings]);

  const channelMidiCCs = React.useMemo(() => {
    const ccs = new Set<number>();
    channelMappings.forEach((mapping) => {
      if (typeof mapping?.midiCC === 'number') ccs.add(mapping.midiCC);
    });
    return ccs;
  }, [channelMappings]);

  const blockedShortcutKeys = React.useMemo(() => new Set([...systemKeys, ...channelKeys]), [channelKeys, systemKeys]);
  const blockedMidiNotes = React.useMemo(() => new Set([...systemMidiNotes, ...channelMidiNotes]), [channelMidiNotes, systemMidiNotes]);
  const blockedMidiCCs = React.useMemo(() => new Set([...systemMidiCCs, ...channelMidiCCs]), [channelMidiCCs, systemMidiCCs]);

  React.useEffect(() => {
    if (!settings.autoPadBankMapping) return;
    if (orderedBanks.length === 0) return;

    const usedKeys = new Set<string>();
    systemKeys.forEach((key) => usedKeys.add(key));
    channelKeys.forEach((key) => usedKeys.add(key));
    padBankShortcutKeys.forEach((key) => usedKeys.add(key));

    const normalizedCandidates = defaultBankShortcutLayout
      .map((entry) => {
        const [modifier, key] = entry.split('+');
        if (!modifier || !key) return null;
        const lower = modifier.toLowerCase();
        return normalizeShortcutKey(key, {
          altKey: lower === 'alt',
          metaKey: lower === 'meta' || lower === 'cmd' || lower === 'command'
        });
      })
      .filter(Boolean) as string[];

    let candidateIndex = 0;
    orderedBanks.forEach((bank) => {
      if (bank.disableDefaultBankShortcutLayout) return;
      const currentKey = normalizeStoredShortcutKey(bank.shortcutKey);
      if (currentKey) return;
      while (candidateIndex < normalizedCandidates.length && usedKeys.has(normalizedCandidates[candidateIndex])) {
        candidateIndex += 1;
      }
      if (candidateIndex >= normalizedCandidates.length) return;
      const nextKey = normalizedCandidates[candidateIndex];
      usedKeys.add(nextKey);
      updateBank(bank.id, { shortcutKey: nextKey });
      candidateIndex += 1;
    });
  }, [
    channelKeys,
    defaultBankShortcutLayout,
    normalizeStoredShortcutKey,
    orderedBanks,
    padBankShortcutKeys,
    settings.autoPadBankMapping,
    systemKeys,
    updateBank
  ]);

  return {
    pendingChannelCountConfirm,
    setPendingChannelCountConfirm,
    updateSystemKey,
    updateSystemMidi,
    updateSystemColor,
    resetSystemMapping,
    setMasterVolumeCC,
    updateChannelMapping,
    applyChannelCountChange,
    handleChannelCountChange,
    handleResetAllSystemMappings,
    handleClearAllSystemMappings,
    handleResetAllChannelMappings,
    handleClearAllChannelMappings,
    handleExportMappings,
    handleImportMappings,
    handleImportSharedBank,
    handleExportAppBackup,
    handleRestoreAppBackup,
    handleRecoverMissingMediaFromBanks,
    handleRetryMissingMediaInCurrentBank,
    padShortcutByBank,
    midiNoteByBank,
    midiCCByBank,
    midiBankNoteMap,
    midiBankCCMap,
    midiNoteAssignments,
    bankShortcutMap,
    padBankShortcutKeys,
    padBankMidiNotes,
    padBankMidiCCs,
    channelMappings,
    systemKeys,
    systemMidiNotes,
    systemMidiCCs,
    channelKeys,
    channelMidiNotes,
    channelMidiCCs,
    blockedShortcutKeys,
    blockedMidiNotes,
    blockedMidiCCs
  };
}
