import type { PadData, SamplerBank } from '../types/sampler';
import { getSamplerRuntimeTuningProfile } from '@/lib/sampler-runtime-profile';
import { applyBankContentPolicy } from './useSamplerStore.provenance';
import { loadDefaultBankFromAssetsPipeline } from './useSamplerStore.defaultBankAssets';
import {
  DEFAULT_BANK_SOURCE_ID,
  isCanonicalDefaultBankIdentity,
  isExplicitDefaultBankIdentity,
} from './useSamplerStore.bankIdentity';

type MediaBackend = 'native' | 'idb';
type SetState<T> = (value: T | ((prev: T) => T)) => void;

export interface RunRestoreAllFilesInput {
  user: { id: string } | null;
  allowDefaultBankAudio: boolean;
}

export interface RunRestoreAllFilesDeps {
  setIsBanksHydrated: (value: boolean) => void;
  mediaRestoreRunIdRef: { current: number };
  startupMediaRestoreInProgressRef: { current: boolean };
  getLocalStorageItemSafe: (key: string) => string | null;
  readIdbJsonFallback: (key: string) => Promise<string | null>;
  storageKey: string;
  stateStorageKey: string;
  storageIdbFallbackKey: string;
  stateIdbFallbackKey: string;
  getCachedUser: () => { id: string } | null;
  lastAuthenticatedUserIdRef: { current: string | null };
  readLastOpenBankId: (ownerId: string | null) => string | null;
  writeLastOpenBankId: (ownerId: string | null, bankId: string | null) => void;
  generateId: () => string;
  defaultBankName: string;
  defaultBankColor: string;
  setBanks: SetState<SamplerBank[]>;
  setCurrentBankIdState: SetState<string | null>;
  setPrimaryBankIdState: SetState<string | null>;
  setSecondaryBankIdState: SetState<string | null>;
  dedupeBanksByIdentity: (banks: SamplerBank[]) => {
    banks: SamplerBank[];
    removedIdToKeptId: Map<string, string>;
  };
  hideProtectedBanksKey: string;
  pruneBanksForGuestLock: (banks: SamplerBank[]) => SamplerBank[];
  setHiddenProtectedBanks: (ownerId: string | null, hiddenBanks: SamplerBank[]) => void;
  getDefaultBankPadImagePreference: (padId: string) => 'none' | null;
  isNativeCapacitorPlatform: () => boolean;
  maxNativeStartupRestorePads: number;
  yieldToMainThread: () => Promise<void>;
  restoreFileAccess: (
    padId: string,
    type: 'audio' | 'image',
    storageKey?: string,
    backend?: MediaBackend
  ) => Promise<{ url: string | null; storageKey?: string; backend: MediaBackend }>;
  base64ToBlob: (value: string) => Blob;
}

const resolveDefaultBankIdForStartup = (banks: SamplerBank[]): string | null => {
  return (
    banks.find((bank) => isExplicitDefaultBankIdentity(bank))?.id
    || banks.find((bank) => isCanonicalDefaultBankIdentity(bank, banks))?.id
    || null
  );
};

export const runRestoreAllFilesPipeline = async (
  input: RunRestoreAllFilesInput,
  deps: RunRestoreAllFilesDeps
): Promise<void> => {
  const {
    user,
    allowDefaultBankAudio,
  } = input;
  const {
    setIsBanksHydrated,
    mediaRestoreRunIdRef,
    startupMediaRestoreInProgressRef,
    getLocalStorageItemSafe,
    readIdbJsonFallback,
    storageKey,
    stateStorageKey,
    storageIdbFallbackKey,
    stateIdbFallbackKey,
    getCachedUser,
    lastAuthenticatedUserIdRef,
    readLastOpenBankId,
    writeLastOpenBankId,
    generateId,
    defaultBankName,
    defaultBankColor,
    setBanks,
    setCurrentBankIdState,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    dedupeBanksByIdentity,
    hideProtectedBanksKey,
    pruneBanksForGuestLock,
    setHiddenProtectedBanks,
    getDefaultBankPadImagePreference,
    isNativeCapacitorPlatform,
    maxNativeStartupRestorePads,
    yieldToMainThread,
    restoreFileAccess,
    base64ToBlob,
  } = deps;

  setIsBanksHydrated(false);
  const restoreRunId = mediaRestoreRunIdRef.current + 1;
  mediaRestoreRunIdRef.current = restoreRunId;
  startupMediaRestoreInProgressRef.current = false;
  if (typeof window === 'undefined') return;
  let savedData = getLocalStorageItemSafe(storageKey);
  if (!savedData) {
    savedData = await readIdbJsonFallback(storageIdbFallbackKey);
  }
  let savedState = getLocalStorageItemSafe(stateStorageKey);
  if (!savedState) {
    savedState = await readIdbJsonFallback(stateIdbFallbackKey);
  }
    const ownerId = user?.id || getCachedUser()?.id || lastAuthenticatedUserIdRef.current || null;
    const lastOpenBankId = readLastOpenBankId(ownerId);

    if (!savedData) {
      const defaultBank: SamplerBank = {
        id: generateId(),
        name: defaultBankName,
      defaultColor: defaultBankColor,
      pads: [],
      createdAt: new Date(),
      sortOrder: 0,
      sourceBankId: 'vdjv-default-bank-source',
    };
    setBanks([defaultBank]);
    setCurrentBankIdState(defaultBank.id);
    writeLastOpenBankId(ownerId, defaultBank.id);
    setIsBanksHydrated(true);
    return;
  }
    try {
    const { banks: savedBanks } = JSON.parse(savedData);
    let restoredState: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null } = {
      primaryBankId: null,
      secondaryBankId: null,
      currentBankId: null,
    };
    if (savedState) try { restoredState = JSON.parse(savedState); } catch { }
    const applyRestoredState = (nextBanks: SamplerBank[]) => {
      const defaultBankId = resolveDefaultBankIdForStartup(nextBanks);
      setBanks(nextBanks);
      setPrimaryBankIdState(restoredState.primaryBankId);
      setSecondaryBankIdState(restoredState.secondaryBankId);
      const currentFromState = restoredState.currentBankId && nextBanks.find((b) => b.id === restoredState.currentBankId)
        ? restoredState.currentBankId
        : null;
      const currentFromLastOpen = !currentFromState && lastOpenBankId && nextBanks.find((b) => b.id === lastOpenBankId)
        ? lastOpenBankId
        : null;
      const resolvedCurrent = defaultBankId || currentFromState || currentFromLastOpen || nextBanks[0]?.id || null;
      setCurrentBankIdState(resolvedCurrent);
      writeLastOpenBankId(ownerId, resolvedCurrent);
      setIsBanksHydrated(true);
    };

    const restorePadMedia = async (pad: PadData): Promise<PadData> => {
      const restoredPad: PadData = {
        ...pad,
        savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
          ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
          : [null, null, null, null],
      };
      if (pad.audioStorageKey || pad.audioBackend) {
        try {
          const restoredAudio = await restoreFileAccess(
            pad.id,
            'audio',
            pad.audioStorageKey,
            pad.audioBackend
          );
          if (restoredAudio.url) restoredPad.audioUrl = restoredAudio.url;
          if (restoredAudio.storageKey) restoredPad.audioStorageKey = restoredAudio.storageKey;
          restoredPad.audioBackend = restoredAudio.backend;
        } catch { }
      }
      if (pad.imageStorageKey || pad.imageBackend) {
        try {
          const restoredImage = await restoreFileAccess(
            pad.id,
            'image',
            pad.imageStorageKey,
            pad.imageBackend
          );
          if (restoredImage.url) restoredPad.imageUrl = restoredImage.url;
          if (restoredImage.storageKey) restoredPad.imageStorageKey = restoredImage.storageKey;
          restoredPad.imageBackend = restoredImage.backend;
          if (restoredImage.url) restoredPad.hasImageAsset = true;
        } catch { }
      }
      if (!restoredPad.imageUrl && pad.imageData) {
        try {
          restoredPad.imageUrl = URL.createObjectURL(base64ToBlob(pad.imageData));
          restoredPad.imageBackend = 'idb';
          restoredPad.hasImageAsset = true;
        } catch { }
      }
      return restoredPad;
    };

    let defaultBankAssetSourcePromise: Promise<SamplerBank> | null = null;
    const getDefaultBankAssetSource = async (): Promise<SamplerBank> => {
      if (!defaultBankAssetSourcePromise) {
        defaultBankAssetSourcePromise = loadDefaultBankFromAssetsPipeline(allowDefaultBankAudio, {
          generateId,
          defaultBankSourceId: DEFAULT_BANK_SOURCE_ID,
        });
      }
      return await defaultBankAssetSourcePromise;
    };

    const restoreBankMedia = async (bank: SamplerBank): Promise<SamplerBank> => {
      const defaultBankAssetSource = isExplicitDefaultBankIdentity(bank)
        ? await getDefaultBankAssetSource().catch(() => null)
        : null;
      const defaultBankAssetPadsById = defaultBankAssetSource
        ? new Map(defaultBankAssetSource.pads.map((pad) => [pad.id, pad] as const))
        : null;
      const thumbnailStorageId = `bank-thumbnail-${bank.id}`;
      const hasExplicitThumbnailRemoval = bank.bankMetadata?.thumbnailRemoved === true;
      let nextMetadata = defaultBankAssetSource?.bankMetadata
        ? {
            ...defaultBankAssetSource.bankMetadata,
            ...bank.bankMetadata,
            thumbnailUrl: hasExplicitThumbnailRemoval
              ? undefined
              : (bank.bankMetadata?.thumbnailUrl || defaultBankAssetSource.bankMetadata.thumbnailUrl),
            remoteSnapshotThumbnailUrl: hasExplicitThumbnailRemoval
              ? undefined
              : bank.bankMetadata?.remoteSnapshotThumbnailUrl,
          }
        : bank.bankMetadata;
      if (!nextMetadata?.thumbnailRemoved && (nextMetadata?.thumbnailStorageKey || nextMetadata?.thumbnailBackend)) {
        try {
          const currentThumbnailUrl = typeof nextMetadata.thumbnailUrl === 'string' ? nextMetadata.thumbnailUrl.trim() : '';
          const restoredThumbnail = await restoreFileAccess(
            thumbnailStorageId,
            'image',
            nextMetadata.thumbnailStorageKey,
            nextMetadata.thumbnailBackend
          );
          nextMetadata = {
            ...nextMetadata,
            thumbnailUrl: restoredThumbnail.url || (/^https?:\/\//i.test(currentThumbnailUrl) ? currentThumbnailUrl : undefined),
            thumbnailStorageKey: restoredThumbnail.storageKey || nextMetadata.thumbnailStorageKey,
            thumbnailBackend: restoredThumbnail.backend || nextMetadata.thumbnailBackend,
            thumbnailRemoved: restoredThumbnail.url ? undefined : nextMetadata.thumbnailRemoved,
          };
        } catch {
          // Ignore thumbnail restore failures and keep any durable remote URL.
        }
      }
      const restoredPads: PadData[] = [];
      for (let i = 0; i < bank.pads.length; i += 1) {
        const restoredPad = await restorePadMedia(bank.pads[i]);
        const assetPad =
          defaultBankAssetPadsById?.get(restoredPad.id) ||
          defaultBankAssetSource?.pads[i] ||
          null;
        if (assetPad) {
          const imagePreference = getDefaultBankPadImagePreference(restoredPad.id || assetPad.id || '');
          const shouldHideImage = imagePreference === 'none';
          if (!restoredPad.audioUrl && !restoredPad.audioStorageKey && !restoredPad.audioBackend) {
            restoredPad.audioUrl = assetPad.audioUrl || restoredPad.audioUrl;
          }
          if (shouldHideImage) {
            restoredPad.imageUrl = '';
            restoredPad.imageStorageKey = undefined;
            restoredPad.imageBackend = undefined;
            restoredPad.hasImageAsset = false;
          } else if (!restoredPad.imageUrl && !restoredPad.imageStorageKey && !restoredPad.imageBackend) {
            restoredPad.imageUrl = assetPad.imageUrl || restoredPad.imageUrl;
            if (assetPad.imageUrl) restoredPad.hasImageAsset = true;
          }
        }
        restoredPads.push(restoredPad);
        if ((i + 1) % 6 === 0) await yieldToMainThread();
      }
      return { ...bank, pads: restoredPads, bankMetadata: nextMetadata };
    };

    const prioritizeBanksForMediaRestore = (candidateBanks: SamplerBank[], priorityBankId: string | null): SamplerBank[] => {
      if (!priorityBankId) return candidateBanks;
      const first = candidateBanks.filter((bank) => bank.id === priorityBankId);
      const rest = candidateBanks.filter((bank) => bank.id !== priorityBankId);
      return [...first, ...rest];
    };

    let restoredBanks: SamplerBank[] = savedBanks.map((bank: any, index: number) => ({
        ...bank,
        createdAt: new Date(bank.createdAt),
        sortOrder: bank.sortOrder ?? index,
        pads: (bank.pads || []).map((pad: any, padIndex: number) => ({
          ...pad,
          audioUrl: null,
          preparedAudioUrl: undefined,
          imageUrl: null,
          audioBackend: (pad.audioBackend as MediaBackend | undefined) || (pad.audioStorageKey ? 'native' : undefined),
          imageBackend: (pad.imageBackend as MediaBackend | undefined) || (pad.imageStorageKey ? 'native' : undefined),
          hasImageAsset: typeof pad.hasImageAsset === 'boolean'
            ? pad.hasImageAsset
            : Boolean(pad.imageStorageKey || pad.imageData || (typeof pad.imageUrl === 'string' && pad.imageUrl.length > 0)),
        fadeInMs: pad.fadeInMs || 0,
        fadeOutMs: pad.fadeOutMs || 0,
        startTimeMs: pad.startTimeMs || 0,
        endTimeMs: pad.endTimeMs || 0,
        pitch: pad.pitch || 0,
        tempoPercent: typeof pad.tempoPercent === 'number' ? pad.tempoPercent : 0,
        keyLock: pad.keyLock !== false,
        savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
          ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
          : [null, null, null, null],
        position: pad.position ?? padIndex,
      })),
    }));
    restoredBanks = dedupeBanksByIdentity(restoredBanks).banks.map((bank) => applyBankContentPolicy(bank));

    const hideProtectedLock =
      typeof window !== 'undefined' && localStorage.getItem(hideProtectedBanksKey) === '1';
    if (hideProtectedLock) {
      const visible = pruneBanksForGuestLock(restoredBanks);
      setHiddenProtectedBanks(ownerId, restoredBanks.filter(
        (bank) => !visible.some((visibleBank) => visibleBank.id === bank.id)
      ));
      restoredBanks = visible;
    }

    restoredBanks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const totalPads = restoredBanks.reduce((sum, bank) => sum + bank.pads.length, 0);
    const eagerRestoreLimit = getSamplerRuntimeTuningProfile().startupRestorePadLimit
      || (isNativeCapacitorPlatform() ? maxNativeStartupRestorePads : 1200);
    const priorityBankId =
      resolveDefaultBankIdForStartup(restoredBanks)
      ?? (restoredState.currentBankId && restoredBanks.some((bank) => bank.id === restoredState.currentBankId)
        ? restoredState.currentBankId
        : (lastOpenBankId && restoredBanks.some((bank) => bank.id === lastOpenBankId) ? lastOpenBankId : null));
    const orderedBanks = prioritizeBanksForMediaRestore(restoredBanks, priorityBankId);

    applyRestoredState(restoredBanks);

    const quickThumbnailRestoreTargets = restoredBanks.filter((bank) =>
      Boolean(bank.bankMetadata?.thumbnailStorageKey || bank.bankMetadata?.thumbnailBackend)
    );
    if (quickThumbnailRestoreTargets.length > 0) {
      for (let index = 0; index < quickThumbnailRestoreTargets.length; index += 1) {
        if (mediaRestoreRunIdRef.current !== restoreRunId) return;
        const bank = quickThumbnailRestoreTargets[index];
        const thumbnailStorageId = `bank-thumbnail-${bank.id}`;
        const metadata = bank.bankMetadata;
        if (!metadata) continue;
        try {
          const currentThumbnailUrl = typeof metadata.thumbnailUrl === 'string' ? metadata.thumbnailUrl.trim() : '';
          const restoredThumbnail = await restoreFileAccess(
            thumbnailStorageId,
            'image',
            metadata.thumbnailStorageKey,
            metadata.thumbnailBackend
          );
          if (!restoredThumbnail.url && !/^https?:\/\//i.test(currentThumbnailUrl)) continue;
          setBanks((prev) => {
            const targetIndex = prev.findIndex((entry) => entry.id === bank.id);
            if (targetIndex < 0) return prev;
            const currentBank = prev[targetIndex];
            const nextMetadata = {
              ...currentBank.bankMetadata,
              thumbnailUrl: restoredThumbnail.url || (/^https?:\/\//i.test(currentThumbnailUrl) ? currentThumbnailUrl : undefined),
              thumbnailStorageKey: restoredThumbnail.storageKey || currentBank.bankMetadata?.thumbnailStorageKey,
              thumbnailBackend: restoredThumbnail.backend || currentBank.bankMetadata?.thumbnailBackend,
            };
            if (nextMetadata.thumbnailUrl === currentBank.bankMetadata?.thumbnailUrl &&
              nextMetadata.thumbnailStorageKey === currentBank.bankMetadata?.thumbnailStorageKey &&
              nextMetadata.thumbnailBackend === currentBank.bankMetadata?.thumbnailBackend) {
              return prev;
            }
            const next = [...prev];
            next[targetIndex] = { ...currentBank, bankMetadata: nextMetadata };
            return next;
          });
        } catch {
          // Ignore thumbnail restore failures and keep any durable remote URL.
        }
        if ((index + 1) % 8 === 0) await yieldToMainThread();
      }
    }

    const limitedTargets = priorityBankId
      ? orderedBanks.filter((bank) => bank.id === priorityBankId).slice(0, 1)
      : orderedBanks.slice(0, 1);
    const hydrationTargets = totalPads > eagerRestoreLimit ? limitedTargets : orderedBanks;
    if (!hydrationTargets.length) return;

    startupMediaRestoreInProgressRef.current = true;
    try {
      for (let bankIndex = 0; bankIndex < hydrationTargets.length; bankIndex += 1) {
        if (mediaRestoreRunIdRef.current !== restoreRunId) return;
        const hydratedBank = await restoreBankMedia(hydrationTargets[bankIndex]);
        if (mediaRestoreRunIdRef.current !== restoreRunId) return;
        setBanks((prev) => {
          const targetIndex = prev.findIndex((bank) => bank.id === hydratedBank.id);
          if (targetIndex < 0) return prev;
          const next = [...prev];
          next[targetIndex] = applyBankContentPolicy(hydratedBank);
          return next;
        });
        if ((bankIndex + 1) % 2 === 0) await yieldToMainThread();
      }
    } finally {
      if (mediaRestoreRunIdRef.current === restoreRunId) {
        startupMediaRestoreInProgressRef.current = false;
      }
    }
  } catch {
    startupMediaRestoreInProgressRef.current = false;
    const defaultBank: SamplerBank = {
      id: generateId(),
      name: defaultBankName,
      defaultColor: defaultBankColor,
      pads: [],
      createdAt: new Date(),
      sortOrder: 0,
      sourceBankId: 'vdjv-default-bank-source',
    };
    setBanks([defaultBank]);
    setCurrentBankIdState(defaultBank.id);
    writeLastOpenBankId(ownerId, defaultBank.id);
    setIsBanksHydrated(true);
  }
};
