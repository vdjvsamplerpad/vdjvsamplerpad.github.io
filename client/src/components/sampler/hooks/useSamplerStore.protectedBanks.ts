import type { PadData, SamplerBank } from '../types/sampler';
import { isDefaultBankIdentity } from './useSamplerStore.bankIdentity';

type SetState<T> = (value: T | ((prev: T) => T)) => void;

export const runHideProtectedBanksPipeline = (
  input: {
    ownerId: string | null;
  },
  deps: {
    setBanks: SetState<SamplerBank[]>;
    pruneBanksForGuestLock: (banks: SamplerBank[]) => SamplerBank[];
    setHiddenProtectedBanks: (ownerId: string | null, hiddenBanks: SamplerBank[]) => void;
    setPrimaryBankIdState: SetState<string | null>;
    setSecondaryBankIdState: SetState<string | null>;
    setCurrentBankIdState: SetState<string | null>;
  }
): void => {
  const { ownerId } = input;
  const {
    setBanks,
    pruneBanksForGuestLock,
    setHiddenProtectedBanks,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    setCurrentBankIdState,
  } = deps;

  setBanks((prev) => {
    const next = pruneBanksForGuestLock(prev);
    if (next.length === prev.length) return prev;
    const visibleIds = new Set(next.map((bank) => bank.id));
    setHiddenProtectedBanks(ownerId, prev.filter((bank) => !visibleIds.has(bank.id)));
    const nextIds = new Set(next.map((bank) => bank.id));
    setPrimaryBankIdState((current) => (current && nextIds.has(current) ? current : null));
    setSecondaryBankIdState((current) => (current && nextIds.has(current) ? current : null));
    setCurrentBankIdState((current) => {
      if (current && nextIds.has(current)) return current;
      return next[0]?.id || null;
    });
    return next;
  });
};

export const runRestoreHiddenProtectedBanksPipeline = (
  input: {
    currentUserId: string | null;
    defaultBankSourceId: string;
  },
  deps: {
    getHiddenProtectedBanks: (ownerId: string | null) => SamplerBank[];
    setHiddenProtectedBanks: (ownerId: string | null, hiddenBanks: SamplerBank[]) => void;
    setBanks: SetState<SamplerBank[]>;
    banksRef: { current: SamplerBank[] };
    padNeedsMediaHydration: (pad: PadData) => boolean;
    rehydrateBankMediaFromStorage: (bank: SamplerBank) => Promise<SamplerBank>;
  }
): void => {
  const {
    currentUserId,
    defaultBankSourceId,
  } = input;
  const {
    getHiddenProtectedBanks,
    setHiddenProtectedBanks,
    setBanks,
    banksRef,
    padNeedsMediaHydration,
    rehydrateBankMediaFromStorage,
  } = deps;

  const hidden = getHiddenProtectedBanks(currentUserId);
  if (!hidden.length) return;

  const restoredBankIds: string[] = [];
  setBanks((prev) => {
    const existing = new Set(prev.map((bank) => bank.id));
    const existingSourceIds = new Set(
      prev
        .map((bank) => bank.sourceBankId)
        .filter((id): id is string => Boolean(id))
    );
    const existingMetadataBankIds = new Set(
      prev
        .map((bank) => bank.bankMetadata?.bankId)
        .filter((id): id is string => Boolean(id))
    );
    const hasDefaultLikeBank = prev.some(
      (bank) => bank.sourceBankId === defaultBankSourceId || isDefaultBankIdentity(bank)
    );

    const toRestore = hidden.filter((bank) => {
      if (existing.has(bank.id)) return false;
      if (bank.sourceBankId && existingSourceIds.has(bank.sourceBankId)) return false;
      if (bank.bankMetadata?.bankId && existingMetadataBankIds.has(bank.bankMetadata.bankId)) return false;
      if (
        hasDefaultLikeBank &&
        (bank.sourceBankId === defaultBankSourceId || isDefaultBankIdentity(bank))
      ) {
        return false;
      }
      return true;
    });
    if (!toRestore.length) {
      setHiddenProtectedBanks(currentUserId, []);
      return prev;
    }
    restoredBankIds.push(...toRestore.map((bank) => bank.id));
    setHiddenProtectedBanks(currentUserId, []);
    return [...prev, ...toRestore].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  });
  if (!restoredBankIds.length) return;

  void (async () => {
    for (const bankId of restoredBankIds) {
      const current = banksRef.current.find((bank) => bank.id === bankId);
      if (!current) continue;
      const hasMissingMedia = (current.pads || []).some((pad) => padNeedsMediaHydration(pad));
      if (!hasMissingMedia) continue;

      const hydrated = await rehydrateBankMediaFromStorage(current);
      setBanks((prev) => {
        const targetIndex = prev.findIndex((bank) => bank.id === hydrated.id);
        if (targetIndex < 0) return prev;
        const next = [...prev];
        next[targetIndex] = hydrated;
        return next;
      });
    }
  })();
};
