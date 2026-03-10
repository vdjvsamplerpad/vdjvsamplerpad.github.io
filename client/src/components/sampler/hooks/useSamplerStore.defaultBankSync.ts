import type { PadData, SamplerBank } from '../types/sampler';
import { applyBankContentPolicy } from './useSamplerStore.provenance';

type SetState<T> = (value: T | ((prev: T) => T)) => void;

type DedupeResult = {
  banks: SamplerBank[];
  removedIdToKeptId: Map<string, string>;
};

export interface RunDefaultBankSyncInput {
  allowAudio: boolean;
  needsInsert: boolean;
  needsAudioStateSync: boolean;
  needsVisualStateSync: boolean;
  forceApplySource: boolean;
  syncSignature: string;
}

export interface RunDefaultBankSyncDeps {
  defaultBankSyncSignatureRef: { current: string };
  loadDefaultBankSource: (allowAudio: boolean) => Promise<SamplerBank>;
  getDefaultBankPadImagePreference: (padId: string) => 'none' | null;
  isCancelled: () => boolean;
  setBanks: SetState<SamplerBank[]>;
  setPrimaryBankIdState: SetState<string | null>;
  setSecondaryBankIdState: SetState<string | null>;
  setCurrentBankIdState: SetState<string | null>;
  isDefaultBankIdentity: (bank: Pick<SamplerBank, 'name' | 'sourceBankId'>) => boolean;
  defaultBankSourceId: string;
  dedupeBanksByIdentity: (banks: SamplerBank[]) => DedupeResult;
}

export const runDefaultBankSyncPipeline = async (
  input: RunDefaultBankSyncInput,
  deps: RunDefaultBankSyncDeps
): Promise<void> => {
  const {
    allowAudio,
    needsInsert,
    needsAudioStateSync,
    needsVisualStateSync,
    forceApplySource,
    syncSignature,
  } = input;
  const {
    defaultBankSyncSignatureRef,
    loadDefaultBankSource,
    getDefaultBankPadImagePreference,
    isCancelled,
    setBanks,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    setCurrentBankIdState,
    isDefaultBankIdentity,
    defaultBankSourceId,
    dedupeBanksByIdentity,
  } = deps;

  if (!needsInsert && !needsAudioStateSync && !needsVisualStateSync && !forceApplySource) {
    defaultBankSyncSignatureRef.current = syncSignature;
    return;
  }
  if (defaultBankSyncSignatureRef.current === syncSignature) return;

  let assetDefault: SamplerBank;
  try {
    assetDefault = await loadDefaultBankSource(allowAudio);
  } catch {
    return;
  }
  assetDefault = applyBankContentPolicy(assetDefault);
  if (isCancelled()) return;

  let resolvedDefaultBankId = assetDefault.id;
  const removedPlaceholderIds = new Set<string>();
  let removedIdToKeptId = new Map<string, string>();
  setBanks((prev) => {
    const cloneHotcues = (
      value: PadData['savedHotcuesMs']
    ): [number | null, number | null, number | null, number | null] => (
      Array.isArray(value)
        ? (value.slice(0, 4) as [number | null, number | null, number | null, number | null])
        : [null, null, null, null]
    );

    const mergeCanonicalPadFields = (existingPad: PadData, sourcePad: PadData): PadData => ({
      ...existingPad,
      name: sourcePad.name || existingPad.name,
      color: sourcePad.color || existingPad.color,
      triggerMode: sourcePad.triggerMode,
      playbackMode: sourcePad.playbackMode,
      volume: sourcePad.volume,
      gainDb: typeof sourcePad.gainDb === 'number' ? sourcePad.gainDb : 0,
      gain: typeof sourcePad.gain === 'number' ? sourcePad.gain : 1,
      fadeInMs: sourcePad.fadeInMs,
      fadeOutMs: sourcePad.fadeOutMs,
      startTimeMs: sourcePad.startTimeMs,
      endTimeMs: sourcePad.endTimeMs,
      pitch: sourcePad.pitch,
      tempoPercent: typeof sourcePad.tempoPercent === 'number' ? sourcePad.tempoPercent : 0,
      keyLock: sourcePad.keyLock !== false,
      savedHotcuesMs: cloneHotcues(sourcePad.savedHotcuesMs),
      audioBytes: sourcePad.audioBytes ?? existingPad.audioBytes,
      audioDurationMs: sourcePad.audioDurationMs ?? existingPad.audioDurationMs,
      contentOrigin: sourcePad.contentOrigin ?? existingPad.contentOrigin,
      originBankId: sourcePad.originBankId ?? existingPad.originBankId,
      originPadId: sourcePad.originPadId ?? existingPad.originPadId,
      originBankTitle: sourcePad.originBankTitle ?? existingPad.originBankTitle,
    });

    const mergeDefaultPads = (
      existingPads: PadData[],
      assetPads: PadData[],
      shouldAllowAudio: boolean
    ): PadData[] => {
      if (!existingPads.length) return assetPads;
      const assetById = new Map(assetPads.map((pad) => [pad.id, pad] as const));
      return existingPads.map((pad, index) => {
        const assetPad = assetById.get(pad.id) || assetPads[index];
        const imagePreference = getDefaultBankPadImagePreference(pad.id || assetPad?.id || '');
        const shouldHideImage = imagePreference === 'none';
        if (!assetPad) {
          if (!shouldAllowAudio) {
            if (pad.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.audioUrl);
            return {
              ...mergeCanonicalPadFields(pad, pad),
              audioUrl: '',
              audioStorageKey: pad.audioStorageKey,
              audioBackend: pad.audioBackend,
              imageUrl: shouldHideImage ? '' : pad.imageUrl,
              hasImageAsset: shouldHideImage ? false : pad.hasImageAsset,
            };
          }
          return shouldHideImage
            ? {
                ...pad,
                imageUrl: '',
                hasImageAsset: false,
              }
            : pad;
        }

        if (!shouldAllowAudio) {
          if (pad.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.audioUrl);
          return {
            ...mergeCanonicalPadFields(pad, assetPad),
            audioUrl: '',
            audioStorageKey: assetPad.audioStorageKey ?? pad.audioStorageKey,
            audioBackend: assetPad.audioBackend ?? pad.audioBackend,
            imageUrl: shouldHideImage ? '' : (assetPad.imageUrl || pad.imageUrl),
            imageStorageKey: shouldHideImage ? undefined : (pad.imageStorageKey ?? assetPad.imageStorageKey),
            imageBackend: shouldHideImage ? undefined : (pad.imageBackend ?? assetPad.imageBackend),
            hasImageAsset: shouldHideImage ? false : (assetPad.hasImageAsset ?? pad.hasImageAsset),
          };
        }

        return {
          ...mergeCanonicalPadFields(pad, assetPad),
          audioUrl: assetPad.audioUrl || pad.audioUrl,
          audioStorageKey: assetPad.audioStorageKey ?? pad.audioStorageKey,
          audioBackend: assetPad.audioBackend ?? pad.audioBackend,
          imageUrl: shouldHideImage ? '' : (pad.imageUrl || assetPad.imageUrl),
          imageStorageKey: shouldHideImage ? undefined : (pad.imageStorageKey ?? assetPad.imageStorageKey),
          imageBackend: shouldHideImage ? undefined : (pad.imageBackend ?? assetPad.imageBackend),
          hasImageAsset: shouldHideImage ? false : (pad.hasImageAsset ?? assetPad.hasImageAsset),
        };
      });
    };

    const existingDefault = prev.find(
      (bank) => isDefaultBankIdentity(bank) && Array.isArray(bank.pads) && bank.pads.length > 0
    );

    let nextBanks: SamplerBank[];
    if (!existingDefault) {
      const withoutDefaultPlaceholders = prev.filter((bank) => {
        const isPlaceholder = isDefaultBankIdentity(bank) && (!Array.isArray(bank.pads) || bank.pads.length === 0);
        if (isPlaceholder) removedPlaceholderIds.add(bank.id);
        return !isPlaceholder;
      });
      nextBanks = [...withoutDefaultPlaceholders, assetDefault];
    } else {
      nextBanks = prev.map((bank) => {
        if (!isDefaultBankIdentity(bank)) return bank;
        const mergedPads = mergeDefaultPads(bank.pads || [], assetDefault.pads || [], allowAudio);
        return applyBankContentPolicy({
          ...bank,
          name: 'Default Bank',
          sourceBankId: defaultBankSourceId,
          defaultColor: assetDefault.defaultColor || bank.defaultColor,
          isAdminBank: assetDefault.isAdminBank,
          transferable: assetDefault.transferable,
          exportable: assetDefault.exportable,
          bankMetadata: assetDefault.bankMetadata
            ? {
                ...assetDefault.bankMetadata,
                thumbnailUrl: bank.bankMetadata?.thumbnailUrl || assetDefault.bankMetadata.thumbnailUrl,
                hideThumbnailPreview:
                  typeof bank.bankMetadata?.hideThumbnailPreview === 'boolean'
                    ? bank.bankMetadata.hideThumbnailPreview
                    : assetDefault.bankMetadata.hideThumbnailPreview,
              }
            : bank.bankMetadata,
          pads: mergedPads.length > 0 ? mergedPads : assetDefault.pads,
        });
      });
    }

    const deduped = dedupeBanksByIdentity(nextBanks);
    removedIdToKeptId = deduped.removedIdToKeptId;
    const defaultAfter = deduped.banks.find((bank) => isDefaultBankIdentity(bank));
    if (defaultAfter) resolvedDefaultBankId = defaultAfter.id;
    return deduped.banks;
  });

  const remapSelectedBankId = (selectedBankId: string | null): string | null => {
    if (!selectedBankId) return selectedBankId;
    if (removedPlaceholderIds.has(selectedBankId)) return resolvedDefaultBankId;
    return removedIdToKeptId.get(selectedBankId) || selectedBankId;
  };

  setPrimaryBankIdState((current) => remapSelectedBankId(current));
  setSecondaryBankIdState((current) => remapSelectedBankId(current));
  setCurrentBankIdState((current) => {
    const remapped = remapSelectedBankId(current);
    if (remapped) return remapped;
    return needsInsert ? resolvedDefaultBankId : remapped;
  });
  defaultBankSyncSignatureRef.current = syncSignature;
};
