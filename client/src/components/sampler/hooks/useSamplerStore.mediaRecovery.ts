import type { PadData, SamplerBank } from '../types/sampler';
import { getOfficialPadRecoveryRef, isOfficialPadContent } from './useSamplerStore.provenance';

type SetState<T> = (value: T | ((prev: T) => T)) => void;

const applyHydratedPadState = (
  bankId: string,
  padId: string,
  hydratedPad: PadData,
  setBanks: SetState<SamplerBank[]>
): void => {
  setBanks((prev) => prev.map((bank) => {
    if (bank.id !== bankId) return bank;
    return {
      ...bank,
      pads: bank.pads.map((pad) => (pad.id === padId ? hydratedPad : pad)),
    };
  }));
};

export const runRehydratePadMediaPipeline = async (
  input: {
    bankId: string;
    padId: string;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    setBanks: SetState<SamplerBank[]>;
    clearBankMedia: (bank: SamplerBank) => Promise<void>;
    downloadStoreBankArchiveForRecovery: (bank: SamplerBank) => Promise<File | null>;
    importBank: (
      file: File,
      onProgress?: (progress: number) => void,
      options?: { allowDuplicateImport?: boolean; skipActivityLog?: boolean }
    ) => Promise<SamplerBank | null>;
    mergeImportedBankMissingMedia: (
      imported: SamplerBank,
      options?: { ownerId?: string | null; addAsNewWhenNoTarget?: boolean }
    ) => Promise<{ merged: boolean; recoveredItems: number; addedBank: boolean }>;
    rehydratePadMediaFromStorage: (pad: PadData) => Promise<PadData>;
    loadPadMediaBlobWithUrlFallback: (pad: PadData, type: 'audio' | 'image') => Promise<Blob | null>;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: 'native' | 'idb' }>;
    padNeedsMediaHydration: (pad: PadData) => boolean;
    resolveOwnerId: () => string | null;
  }
): Promise<boolean> => {
  const {
    bankId,
    padId,
  } = input;
  const {
    banksRef,
    setBanks,
    clearBankMedia,
    downloadStoreBankArchiveForRecovery,
    importBank,
    mergeImportedBankMissingMedia,
    rehydratePadMediaFromStorage,
    loadPadMediaBlobWithUrlFallback,
    storeFile,
    padNeedsMediaHydration,
    resolveOwnerId,
  } = deps;

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const currentBank = banksRef.current.find((bank) => bank.id === bankId);
    const currentPad = currentBank?.pads.find((pad) => pad.id === padId);
    if (!currentBank || !currentPad) return false;
    if (!padNeedsMediaHydration(currentPad)) return true;

    const hydratedPad = await rehydratePadMediaFromStorage(currentPad);
    applyHydratedPadState(bankId, padId, hydratedPad, setBanks);

    if (!padNeedsMediaHydration(hydratedPad)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, attempt === 0 ? 120 : 420));
  }

  const bankForRecovery = banksRef.current.find((bank) => bank.id === bankId);
  const padBeforeRecovery = bankForRecovery?.pads.find((pad) => pad.id === padId);
  if (!bankForRecovery || !padBeforeRecovery || !padNeedsMediaHydration(padBeforeRecovery)) {
    return Boolean(padBeforeRecovery && !padNeedsMediaHydration(padBeforeRecovery));
  }

  const officialRecoveryRef = isOfficialPadContent(padBeforeRecovery)
    ? getOfficialPadRecoveryRef(padBeforeRecovery, bankForRecovery)
    : null;
  const existingOfficialSourceBank = officialRecoveryRef?.bankId
    ? banksRef.current.find((bank) =>
        bank.bankMetadata?.bankId === officialRecoveryRef.bankId ||
        bank.sourceBankId === officialRecoveryRef.bankId
      )
    : null;
  if (existingOfficialSourceBank && officialRecoveryRef?.padId) {
    const sourcePad = existingOfficialSourceBank.pads.find((pad) =>
      pad.originPadId === officialRecoveryRef.padId || pad.id === officialRecoveryRef.padId
    );
    if (sourcePad) {
      const audioBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'audio');
      if (audioBlob) {
        const storedAudio = await storeFile(
          padBeforeRecovery.id,
          new File([audioBlob], `${padBeforeRecovery.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
          'audio'
        );
        let imageBlob: Blob | null = null;
        let storedImage: { storageKey?: string; backend: 'native' | 'idb' } | null = null;
        if (sourcePad.hasImageAsset || sourcePad.imageStorageKey || sourcePad.imageUrl) {
          imageBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'image');
          if (imageBlob) {
            storedImage = await storeFile(
              padBeforeRecovery.id,
              new File([imageBlob], `${padBeforeRecovery.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
              'image'
            );
          }
        }
        applyHydratedPadState(bankId, padId, {
          ...padBeforeRecovery,
          audioUrl: URL.createObjectURL(audioBlob),
          audioStorageKey: storedAudio.storageKey,
          audioBackend: storedAudio.backend,
          imageUrl: imageBlob ? URL.createObjectURL(imageBlob) : padBeforeRecovery.imageUrl,
          imageStorageKey: storedImage?.storageKey || padBeforeRecovery.imageStorageKey,
          imageBackend: storedImage?.backend || padBeforeRecovery.imageBackend,
          hasImageAsset: imageBlob ? true : padBeforeRecovery.hasImageAsset,
        }, setBanks);
        return true;
      }
    }
  }
  const recoveryBankRef = officialRecoveryRef?.bankId || officialRecoveryRef?.catalogItemId
    ? {
      ...bankForRecovery,
      name: officialRecoveryRef.bankTitle || bankForRecovery.name,
      bankMetadata: {
        ...(bankForRecovery.bankMetadata || { password: true, transferable: true }),
        bankId: officialRecoveryRef.bankId || undefined,
        catalogItemId: officialRecoveryRef.catalogItemId || undefined,
      },
    }
    : bankForRecovery;
  const recoveryFile = await downloadStoreBankArchiveForRecovery(recoveryBankRef);
  if (!recoveryFile) return false;

  const preExistingBankIds = new Set(banksRef.current.map((bank) => bank.id));
  let importedBank: SamplerBank | null = null;
  let merged = false;
  const shouldRemoveImportedBankAfterUse = Boolean(officialRecoveryRef?.padId);
  try {
    importedBank = await importBank(recoveryFile, undefined, {
      allowDuplicateImport: true,
      skipActivityLog: true,
    });
    if (!importedBank) return false;

    if (officialRecoveryRef?.padId) {
      const sourcePad = importedBank.pads.find((pad) =>
        pad.originPadId === officialRecoveryRef.padId ||
        pad.id === officialRecoveryRef.padId
      );
      if (!sourcePad) return false;

      const audioBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'audio');
      if (!audioBlob) return false;
      const storedAudio = await storeFile(
        padBeforeRecovery.id,
        new File([audioBlob], `${padBeforeRecovery.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
        'audio'
      );

      let imageBlob: Blob | null = null;
      let storedImage: { storageKey?: string; backend: 'native' | 'idb' } | null = null;
      if (sourcePad.hasImageAsset || sourcePad.imageStorageKey || sourcePad.imageUrl) {
        imageBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'image');
        if (imageBlob) {
          storedImage = await storeFile(
            padBeforeRecovery.id,
            new File([imageBlob], `${padBeforeRecovery.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
            'image'
          );
        }
      }

      applyHydratedPadState(bankId, padId, {
        ...padBeforeRecovery,
        audioUrl: URL.createObjectURL(audioBlob),
        audioStorageKey: storedAudio.storageKey,
        audioBackend: storedAudio.backend,
        imageUrl: imageBlob ? URL.createObjectURL(imageBlob) : padBeforeRecovery.imageUrl,
        imageStorageKey: storedImage?.storageKey || padBeforeRecovery.imageStorageKey,
        imageBackend: storedImage?.backend || padBeforeRecovery.imageBackend,
        hasImageAsset: imageBlob ? true : padBeforeRecovery.hasImageAsset,
      }, setBanks);
      merged = true;
    } else {
      const mergeResult = await mergeImportedBankMissingMedia(importedBank, {
        ownerId: resolveOwnerId(),
        addAsNewWhenNoTarget: false,
      });
      merged = mergeResult.merged;
      if (!merged) return false;
    }
  } catch {
    return false;
  } finally {
    if (importedBank && !preExistingBankIds.has(importedBank.id) && (!merged || shouldRemoveImportedBankAfterUse)) {
      const importedStillExists = banksRef.current.some((bank) => bank.id === importedBank?.id);
      if (importedStillExists) {
        try {
          await clearBankMedia(importedBank);
        } catch {
        }
        setBanks((prev) => prev.filter((bank) => bank.id !== importedBank?.id));
      }
    }
  }

  const recoveredPad = banksRef.current
    .find((bank) => bank.id === bankId)
    ?.pads.find((pad) => pad.id === padId);
  if (!recoveredPad) return false;
  if (!padNeedsMediaHydration(recoveredPad)) return true;

  const hydratedAfterRecovery = await rehydratePadMediaFromStorage(recoveredPad);
  applyHydratedPadState(bankId, padId, hydratedAfterRecovery, setBanks);
  return !padNeedsMediaHydration(hydratedAfterRecovery);
};

export const runRehydrateMissingMediaInBankPipeline = async (
  input: {
    bankId: string;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    padNeedsMediaHydration: (pad: PadData) => boolean;
    rehydratePadMedia: (bankId: string, padId: string) => Promise<boolean>;
  }
): Promise<{ missingBefore: number; restored: number; remaining: number; remainingOfficial: number; remainingUser: number }> => {
  const {
    bankId,
  } = input;
  const {
    banksRef,
    padNeedsMediaHydration,
    rehydratePadMedia,
  } = deps;

  const bank = banksRef.current.find((entry) => entry.id === bankId);
  if (!bank) {
    return { missingBefore: 0, restored: 0, remaining: 0, remainingOfficial: 0, remainingUser: 0 };
  }

  const missingPadIds = (bank.pads || [])
    .filter((pad) => padNeedsMediaHydration(pad))
    .map((pad) => pad.id);
  if (missingPadIds.length === 0) {
    return { missingBefore: 0, restored: 0, remaining: 0, remainingOfficial: 0, remainingUser: 0 };
  }

  for (const padId of missingPadIds) {
    await rehydratePadMedia(bankId, padId);
  }

  const refreshedBank = banksRef.current.find((entry) => entry.id === bankId);
  const remaining = refreshedBank
    ? refreshedBank.pads.filter((pad) => padNeedsMediaHydration(pad)).length
    : missingPadIds.length;
  const remainingOfficial = refreshedBank
    ? refreshedBank.pads.filter((pad) => padNeedsMediaHydration(pad) && isOfficialPadContent(pad)).length
    : 0;
  const remainingUser = Math.max(0, remaining - remainingOfficial);
  const restored = Math.max(0, missingPadIds.length - remaining);

  return {
    missingBefore: missingPadIds.length,
    restored,
    remaining,
    remainingOfficial,
    remainingUser,
  };
};
