import type { PadData, SamplerBank } from '../types/sampler';
import { applyBankContentPolicy } from './useSamplerStore.provenance';

type MediaBackend = 'native' | 'idb';
type SetState<T> = (value: T | ((prev: T) => T)) => void;

type QuotaPolicy = {
  deviceTotalBankCap: number;
  ownedBankQuota: number;
  ownedBankPadCap: number;
};

const EMPTY_HOTCUES: [number | null, number | null, number | null, number | null] = [null, null, null, null];

const resolveResetDuplicateEndTimeMs = (pad: PadData): number => {
  if (typeof pad.audioDurationMs === 'number' && Number.isFinite(pad.audioDurationMs) && pad.audioDurationMs > 0) {
    return Math.max(0, Math.round(pad.audioDurationMs));
  }
  return 0;
};

export const runDuplicateBankPipeline = async (
  input: {
    bankId: string;
    profileRole?: string | null;
    quotaPolicy: QuotaPolicy;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    setBanks: SetState<SamplerBank[]>;
    isOwnedCountedBankForQuota: (bank: SamplerBank) => boolean;
    countOwnedCountedBanks: (banks: SamplerBank[]) => number;
    generateId: () => string;
    buildDuplicateBankName: (sourceName: string, existingBanks: SamplerBank[]) => string;
    loadPadMediaBlobWithUrlFallback: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    padHasExpectedImageAsset: (pad: Partial<PadData>) => boolean;
    deletePadMediaArtifacts: (
      pad: Partial<PadData> & { id: string },
      type?: 'audio' | 'image'
    ) => Promise<void>;
    yieldToMainThread: () => Promise<void>;
    onProgress?: (progress: number) => void;
  }
): Promise<SamplerBank> => {
  const {
    bankId,
    profileRole,
    quotaPolicy,
  } = input;
  const {
    banksRef,
    setBanks,
    isOwnedCountedBankForQuota,
    countOwnedCountedBanks,
    generateId,
    buildDuplicateBankName,
    loadPadMediaBlobWithUrlFallback,
    storeFile,
    padHasExpectedImageAsset,
    deletePadMediaArtifacts,
    yieldToMainThread,
    onProgress,
  } = deps;

  const currentBanks = banksRef.current;
  const sourceBank = currentBanks.find((bank) => bank.id === bankId);
  if (!sourceBank) throw new Error('We could not find that bank.');
  const isAdminUser = profileRole === 'admin';
  if (!isAdminUser) {
    if (currentBanks.length >= quotaPolicy.deviceTotalBankCap) {
      throw new Error(`You reached your device bank limit (${quotaPolicy.deviceTotalBankCap}). Remove a bank before duplicating.`);
    }
    if (isOwnedCountedBankForQuota(sourceBank)) {
      const ownedUsed = countOwnedCountedBanks(currentBanks);
      if (ownedUsed >= quotaPolicy.ownedBankQuota) {
        throw new Error(`You reached your owned bank quota (${quotaPolicy.ownedBankQuota}). Remove an owned bank before duplicating. Message us on facebook for expansion.`);
      }
    }
  }

  const duplicateId = generateId();
  const duplicateName = buildDuplicateBankName(sourceBank.name, currentBanks);
  const maxSortOrder = currentBanks.length > 0 ? Math.max(...currentBanks.map((bank) => bank.sortOrder || 0)) : -1;
  const totalPads = sourceBank.pads.length;

  const rollbackItems: Array<{
    padId: string;
    audioStorageKey?: string;
    imageStorageKey?: string;
    audioUrl?: string;
    imageUrl?: string;
  }> = [];
  const duplicatePads: PadData[] = [];

  const rollbackCopiedMedia = async () => {
    await Promise.all(rollbackItems.map(async (item) => {
      if (item.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(item.audioUrl);
      if (item.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(item.imageUrl);
      await deletePadMediaArtifacts({
        id: item.padId,
        audioStorageKey: item.audioStorageKey,
        audioBackend: item.audioStorageKey?.includes('/') ? 'native' : 'idb',
        imageStorageKey: item.imageStorageKey,
        imageBackend: item.imageStorageKey?.includes('/') ? 'native' : 'idb',
      });
    }));
  };

  onProgress?.(5);

  try {
    for (let index = 0; index < sourceBank.pads.length; index += 1) {
      const sourcePad = sourceBank.pads[index];
      const newPadId = generateId();
      const audioBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'audio');
      if (!audioBlob) {
        throw new Error(`Missing audio for pad "${sourcePad.name || sourcePad.id}"`);
      }

      const storedAudio = await storeFile(
        newPadId,
        new File([audioBlob], `${newPadId}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
        'audio'
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      let imageUrl: string | undefined;
      let imageStorageKey: string | undefined;
      let imageBackend: MediaBackend | undefined;
      let hasImageAsset = false;

      if (padHasExpectedImageAsset(sourcePad)) {
        const imageBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'image');
        if (imageBlob) {
          const storedImage = await storeFile(
            newPadId,
            new File([imageBlob], `${newPadId}.image`, { type: imageBlob.type || 'application/octet-stream' }),
            'image'
          );
          imageStorageKey = storedImage.storageKey;
          imageBackend = storedImage.backend;
          imageUrl = URL.createObjectURL(imageBlob);
          hasImageAsset = true;
        }
      }

      rollbackItems.push({
        padId: newPadId,
        audioStorageKey: storedAudio.storageKey,
        imageStorageKey,
        audioUrl,
        imageUrl,
      });

      duplicatePads.push({
        ...sourcePad,
        id: newPadId,
        audioUrl,
        imageUrl,
        audioStorageKey: storedAudio.storageKey,
        audioBackend: storedAudio.backend,
        imageStorageKey,
        imageBackend,
        hasImageAsset,
        imageData: undefined,
        position: sourcePad.position ?? index,
      });

      onProgress?.(5 + (((index + 1) / Math.max(totalPads, 1)) * 90));
      if ((index + 1) % 4 === 0) await yieldToMainThread();
    }

    const clonedBank: SamplerBank = applyBankContentPolicy({
      ...sourceBank,
      id: duplicateId,
      name: duplicateName,
      createdAt: new Date(),
      sortOrder: maxSortOrder + 1,
      pads: duplicatePads,
      isLocalDuplicate: true,
      duplicateOriginBankId: sourceBank.id,
    });

    setBanks((prev) => [...prev, clonedBank].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
    onProgress?.(100);
    return clonedBank;
  } catch (error) {
    await rollbackCopiedMedia();
    throw new Error(error instanceof Error ? error.message : 'Failed to duplicate bank.');
  }
};

export const runDuplicatePadPipeline = async (
  input: {
    bankId: string;
    padId: string;
    profileRole?: string | null;
    quotaPolicy: QuotaPolicy;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    setBanks: SetState<SamplerBank[]>;
    isOwnedCountedBankForQuota: (bank: SamplerBank) => boolean;
    generateId: () => string;
    loadPadMediaBlobWithUrlFallback: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    padHasExpectedImageAsset: (pad: Partial<PadData>) => boolean;
    buildDuplicatePadName: (sourceName: string, existingPads: PadData[]) => string;
    deletePadMediaArtifacts: (
      pad: Partial<PadData> & { id: string },
      type?: 'audio' | 'image'
    ) => Promise<void>;
  }
): Promise<PadData> => {
  const {
    bankId,
    padId,
    profileRole,
    quotaPolicy,
  } = input;
  const {
    banksRef,
    setBanks,
    isOwnedCountedBankForQuota,
    generateId,
    loadPadMediaBlobWithUrlFallback,
    storeFile,
    padHasExpectedImageAsset,
    buildDuplicatePadName,
    deletePadMediaArtifacts,
  } = deps;

  const currentBanks = banksRef.current;
  const sourceBank = currentBanks.find((bank) => bank.id === bankId);
  if (!sourceBank) throw new Error('We could not find that bank.');
  if (profileRole !== 'admin' && isOwnedCountedBankForQuota(sourceBank) && sourceBank.pads.length >= quotaPolicy.ownedBankPadCap) {
    throw new Error(`Max ${quotaPolicy.ownedBankPadCap} pads allowed for owned banks. Remove a pad first.`);
  }

  const sourcePad = sourceBank.pads.find((pad) => pad.id === padId);
  if (!sourcePad) throw new Error('We could not find that pad.');

  const newPadId = generateId();
  let audioStorageKey: string | undefined;
  let imageStorageKey: string | undefined;
  let audioBackend: MediaBackend | undefined;
  let imageBackend: MediaBackend | undefined;
  let audioUrl: string | undefined;
  let imageUrl: string | undefined;

  try {
    const audioBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'audio');
    if (!audioBlob) {
      throw new Error(`Missing audio for pad "${sourcePad.name || sourcePad.id}"`);
    }

    const storedAudio = await storeFile(
      newPadId,
      new File([audioBlob], `${newPadId}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
      'audio'
    );
    audioStorageKey = storedAudio.storageKey;
    audioBackend = storedAudio.backend;
    audioUrl = URL.createObjectURL(audioBlob);

    let hasImageAsset = false;
    if (padHasExpectedImageAsset(sourcePad)) {
      const imageBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'image');
      if (imageBlob) {
        const storedImage = await storeFile(
          newPadId,
          new File([imageBlob], `${newPadId}.image`, { type: imageBlob.type || 'application/octet-stream' }),
          'image'
        );
        imageStorageKey = storedImage.storageKey;
        imageBackend = storedImage.backend;
        imageUrl = URL.createObjectURL(imageBlob);
        hasImageAsset = true;
      }
    }

    const duplicateName = buildDuplicatePadName(sourcePad.name || 'Untitled Pad', sourceBank.pads);
    const maxPosition = sourceBank.pads.length > 0
      ? Math.max(...sourceBank.pads.map((pad) => pad.position || 0))
      : -1;

    const duplicate: PadData = {
      ...sourcePad,
      id: newPadId,
      name: duplicateName,
      audioUrl: audioUrl || sourcePad.audioUrl,
      audioStorageKey,
      audioBackend,
      imageUrl,
      imageStorageKey,
      imageBackend,
      hasImageAsset,
      imageData: undefined,
      volume: 1,
      gainDb: 0,
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      startTimeMs: 0,
      endTimeMs: resolveResetDuplicateEndTimeMs(sourcePad),
      pitch: 0,
      tempoPercent: 0,
      keyLock: true,
      savedHotcuesMs: EMPTY_HOTCUES,
      shortcutKey: undefined,
      midiNote: undefined,
      midiCC: undefined,
      position: maxPosition + 1,
    };

    setBanks((prev) => prev.map((bank) => {
      if (bank.id !== bankId) return bank;
      return applyBankContentPolicy({
        ...bank,
        pads: [...bank.pads, duplicate],
      });
    }));
    return duplicate;
  } catch (error) {
    if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    await deletePadMediaArtifacts({
      id: newPadId,
      audioStorageKey,
      audioBackend,
      imageStorageKey,
      imageBackend,
    });
    throw new Error(error instanceof Error ? error.message : 'Failed to duplicate pad.');
  }
};
