import type { PadData, SamplerBank } from '../types/sampler';

type MediaBackend = 'native' | 'idb';
type SetState<T> = (value: T | ((prev: T) => T)) => void;

export const runMergeImportedBankMissingMediaPipeline = async (
  imported: SamplerBank,
  options: { ownerId?: string | null; addAsNewWhenNoTarget?: boolean } | undefined,
  deps: {
    resolveOwnerId: () => string | null;
    banksRef: { current: SamplerBank[] };
    getHiddenProtectedBanks: (ownerId: string | null) => SamplerBank[];
    setHiddenProtectedBanks: (ownerId: string | null, hiddenBanks: SamplerBank[]) => void;
    clearBankMedia: (bank: SamplerBank) => Promise<void>;
    setBanks: SetState<SamplerBank[]>;
    getPadPositionOrFallback: (pad: Partial<PadData>, fallbackIndex: number) => number;
    normalizePadNameToken: (value: unknown) => string;
    loadPadMediaBlob: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
    loadPadMediaBlobWithUrlFallback: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    padHasExpectedImageAsset: (pad: Partial<PadData>) => boolean;
  }
): Promise<{ merged: boolean; recoveredItems: number; addedBank: boolean }> => {
  const {
    resolveOwnerId,
    banksRef,
    getHiddenProtectedBanks,
    setHiddenProtectedBanks,
    clearBankMedia,
    setBanks,
    getPadPositionOrFallback,
    normalizePadNameToken,
    loadPadMediaBlob,
    loadPadMediaBlobWithUrlFallback,
    storeFile,
    padHasExpectedImageAsset,
  } = deps;

  const ownerId = options?.ownerId ?? resolveOwnerId();
  const addAsNewWhenNoTarget = options?.addAsNewWhenNoTarget !== false;
  let recoveredItems = 0;

  const visibleBanks = banksRef.current;
  let hiddenProtected = getHiddenProtectedBanks(ownerId);
  const combinedBanks = [
    ...visibleBanks,
    ...hiddenProtected.filter((hiddenBank) => !visibleBanks.some((visibleBank) => visibleBank.id === hiddenBank.id)),
  ];
  const target = combinedBanks.find((bank) => {
    if (bank.id === imported.id) return false;
    if (imported.sourceBankId && (bank.sourceBankId === imported.sourceBankId || bank.id === imported.sourceBankId)) return true;
    return bank.name === imported.name;
  });

  if (!target) {
    if (!addAsNewWhenNoTarget) {
      await clearBankMedia(imported);
      setBanks((prev) => prev.filter((bank) => bank.id !== imported.id));
      if (ownerId) {
        hiddenProtected = hiddenProtected.filter((bank) => bank.id !== imported.id);
        setHiddenProtectedBanks(ownerId, hiddenProtected);
      }
    }
    return { merged: false, recoveredItems: 0, addedBank: addAsNewWhenNoTarget };
  }

  const sourceById = new Map(imported.pads.map((pad) => [pad.id, pad] as const));
  const sourceByPosition = new Map<number, PadData>();
  const sourceByName = new Map<string, PadData[]>();
  imported.pads.forEach((pad, sourceIndex) => {
    const position = getPadPositionOrFallback(pad, sourceIndex);
    if (!sourceByPosition.has(position)) sourceByPosition.set(position, pad);
    const nameToken = normalizePadNameToken(pad.name);
    if (!nameToken) return;
    const bucket = sourceByName.get(nameToken) || [];
    bucket.push(pad);
    sourceByName.set(nameToken, bucket);
  });

  const updatedPads: PadData[] = [];
  for (let targetIndex = 0; targetIndex < target.pads.length; targetIndex += 1) {
    const targetPad = target.pads[targetIndex];
    const targetPosition = getPadPositionOrFallback(targetPad, targetIndex);
    const targetNameToken = normalizePadNameToken(targetPad.name);
    const bucket = targetNameToken ? sourceByName.get(targetNameToken) : undefined;
    const sourcePad =
      sourceById.get(targetPad.id) ||
      (bucket && bucket.length > 0 ? bucket.shift() : undefined) ||
      sourceByPosition.get(targetPosition) ||
      imported.pads[targetIndex] ||
      imported.pads[targetPosition];
    let nextPad = { ...targetPad };

    const existingAudioBlob = await loadPadMediaBlob(nextPad, 'audio');
    if (existingAudioBlob && !nextPad.audioUrl) {
      nextPad.audioUrl = URL.createObjectURL(existingAudioBlob);
      nextPad.audioBackend = nextPad.audioStorageKey ? 'native' : (nextPad.audioBackend || 'idb');
    }

    if (!existingAudioBlob && sourcePad) {
      try {
        const audioBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'audio');
        if (!audioBlob) throw new Error('Some audio data is missing in this file.');
        const storedAudio = await storeFile(
          nextPad.id,
          new File([audioBlob], `${nextPad.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
          'audio'
        );
        nextPad.audioUrl = URL.createObjectURL(audioBlob);
        if (storedAudio.storageKey) nextPad.audioStorageKey = storedAudio.storageKey;
        nextPad.audioBackend = storedAudio.backend;
        recoveredItems += 1;
      } catch {
      }
    }

    const expectsImage = padHasExpectedImageAsset(nextPad);
    const existingImageBlob = expectsImage ? await loadPadMediaBlob(nextPad, 'image') : null;
    if (existingImageBlob && !nextPad.imageUrl) {
      nextPad.imageUrl = URL.createObjectURL(existingImageBlob);
      nextPad.imageBackend = nextPad.imageStorageKey ? 'native' : (nextPad.imageBackend || 'idb');
      nextPad.hasImageAsset = true;
    }

    if (expectsImage && !existingImageBlob && sourcePad) {
      try {
        const imageBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'image');
        if (!imageBlob) throw new Error('Some image data is missing in this file.');
        const storedImage = await storeFile(
          nextPad.id,
          new File([imageBlob], `${nextPad.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
          'image'
        );
        nextPad.imageUrl = URL.createObjectURL(imageBlob);
        if (storedImage.storageKey) nextPad.imageStorageKey = storedImage.storageKey;
        nextPad.imageBackend = storedImage.backend;
        nextPad.hasImageAsset = true;
        recoveredItems += 1;
      } catch {
      }
    }

    updatedPads.push(nextPad);
  }

  await clearBankMedia(imported);
  setBanks((prev) =>
    prev
      .map((bank) => (bank.id === target.id ? { ...bank, pads: updatedPads } : bank))
      .filter((bank) => bank.id !== imported.id)
  );
  if (ownerId) {
    const hiddenUpdated = hiddenProtected
      .map((bank) => (bank.id === target.id ? { ...bank, pads: updatedPads } : bank))
      .filter((bank) => bank.id !== imported.id);
    setHiddenProtectedBanks(ownerId, hiddenUpdated);
  }

  return { merged: true, recoveredItems, addedBank: false };
};

