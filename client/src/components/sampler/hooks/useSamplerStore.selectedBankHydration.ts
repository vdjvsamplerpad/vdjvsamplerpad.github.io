import type { PadData, SamplerBank } from '../types/sampler';

type SetState<T> = (value: T | ((prev: T) => T)) => void;

const replacePadInBank = (bank: SamplerBank, padId: string, nextPad: PadData): SamplerBank => ({
  ...bank,
  pads: bank.pads.map((pad) => (pad.id === padId ? nextPad : pad)),
});

export const clearSelectedBankHydrationRetryTimer = (
  timerRef: { current: ReturnType<typeof setTimeout> | null }
): void => {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
};

export const collectSelectedBankIds = (input: {
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
}): Set<string> => {
  const selectedBankIds = new Set<string>();
  if (input.primaryBankId) selectedBankIds.add(input.primaryBankId);
  if (input.secondaryBankId) selectedBankIds.add(input.secondaryBankId);
  if (!input.primaryBankId && input.currentBankId) selectedBankIds.add(input.currentBankId);
  return selectedBankIds;
};

export const queueSelectedBankHydrationRetryPipeline = (
  bankId: string,
  deps: {
    maxRetries: number;
    retryAttemptsRef: { current: Record<string, number> };
    retryTimerRef: { current: ReturnType<typeof setTimeout> | null };
    setRetryNonce: (value: (prev: number) => number) => void;
  }
): void => {
  const {
    maxRetries,
    retryAttemptsRef,
    retryTimerRef,
    setRetryNonce,
  } = deps;

  const currentAttempts = retryAttemptsRef.current[bankId] || 0;
  if (currentAttempts >= maxRetries) return;
  const nextAttempts = currentAttempts + 1;
  retryAttemptsRef.current[bankId] = nextAttempts;

  if (retryTimerRef.current !== null) return;
  const delayMs = Math.min(6000, 700 * (2 ** Math.max(0, nextAttempts - 1)));
  retryTimerRef.current = setTimeout(() => {
    retryTimerRef.current = null;
    setRetryNonce((value) => value + 1);
  }, delayMs);
};

export const runSelectedBankHydrationPipeline = async (
  input: {
    selectedBankIds: Set<string>;
    runId: number;
    isCancelled: () => boolean;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    runIdRef: { current: number };
    retryAttemptsRef: { current: Record<string, number> };
    rehydratePadMediaFromStorage: (pad: PadData) => Promise<PadData>;
    rehydrateBankMediaFromStorage: (bank: SamplerBank) => Promise<SamplerBank>;
    setBanks: SetState<SamplerBank[]>;
    padNeedsMediaHydration: (pad: PadData) => boolean;
    queueSelectedBankHydrationRetry: (bankId: string) => void;
    yieldToMainThread: () => Promise<void>;
  }
): Promise<void> => {
  const {
    selectedBankIds,
    runId,
    isCancelled,
  } = input;
  const {
    banksRef,
    runIdRef,
    retryAttemptsRef,
    rehydratePadMediaFromStorage,
    rehydrateBankMediaFromStorage,
    setBanks,
    padNeedsMediaHydration,
    queueSelectedBankHydrationRetry,
    yieldToMainThread,
  } = deps;

  for (const bankId of selectedBankIds) {
    const current = banksRef.current.find((bank) => bank.id === bankId);
    if (!current || !Array.isArray(current.pads) || current.pads.length === 0) continue;
    const hasPersistentThumbnail = Boolean(
      current.bankMetadata?.thumbnailStorageKey || current.bankMetadata?.thumbnailBackend
    );
    const missingBefore = current.pads.filter((pad) => padNeedsMediaHydration(pad)).length;
    if (missingBefore <= 0 && !hasPersistentThumbnail) {
      delete retryAttemptsRef.current[bankId];
      continue;
    }

    let hydrated = current;
    let improved = false;

    for (let index = 0; index < current.pads.length; index += 1) {
      const currentPad = hydrated.pads[index];
      if (!currentPad || !padNeedsMediaHydration(currentPad)) continue;

      const restoredPad = await rehydratePadMediaFromStorage(currentPad);
      if (isCancelled() || runIdRef.current !== runId) return;

      const padImproved = !padNeedsMediaHydration(restoredPad);
      const padChanged =
        restoredPad !== currentPad ||
        restoredPad.audioUrl !== currentPad.audioUrl ||
        restoredPad.imageUrl !== currentPad.imageUrl ||
        restoredPad.audioStorageKey !== currentPad.audioStorageKey ||
        restoredPad.imageStorageKey !== currentPad.imageStorageKey ||
        restoredPad.audioBackend !== currentPad.audioBackend ||
        restoredPad.imageBackend !== currentPad.imageBackend;

      if (padChanged) {
        hydrated = replacePadInBank(hydrated, currentPad.id, restoredPad);
        setBanks((prev) => {
          const targetIndex = prev.findIndex((bank) => bank.id === hydrated.id);
          if (targetIndex < 0) return prev;
          const next = [...prev];
          next[targetIndex] = hydrated;
          return next;
        });
      }

      if (padImproved) {
        improved = true;
      }

      await yieldToMainThread();
    }

    const missingAfter = hydrated.pads.filter((pad) => padNeedsMediaHydration(pad)).length;

    if (hasPersistentThumbnail) {
      const previousThumbnailUrl = hydrated.bankMetadata?.thumbnailUrl;
      const hydratedWithThumbnail = await rehydrateBankMediaFromStorage(hydrated);
      if (isCancelled() || runIdRef.current !== runId) return;
      hydrated = hydratedWithThumbnail;
      const thumbnailImproved =
        hydrated.bankMetadata?.thumbnailUrl !== previousThumbnailUrl ||
        hydrated.bankMetadata?.thumbnailStorageKey !== current.bankMetadata?.thumbnailStorageKey ||
        hydrated.bankMetadata?.thumbnailBackend !== current.bankMetadata?.thumbnailBackend;
      if (thumbnailImproved) {
        improved = true;
        setBanks((prev) => {
          const targetIndex = prev.findIndex((bank) => bank.id === hydrated.id);
          if (targetIndex < 0) return prev;
          const next = [...prev];
          next[targetIndex] = hydrated;
          return next;
        });
      }
    }

    if (missingAfter <= 0) {
      delete retryAttemptsRef.current[bankId];
    } else {
      queueSelectedBankHydrationRetry(bankId);
    }

    await yieldToMainThread();
  }
};
