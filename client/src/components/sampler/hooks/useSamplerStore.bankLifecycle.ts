import * as React from 'react';
import { getSamplerRuntimeTuningProfile } from '@/lib/sampler-runtime-profile';
import { type PadData, type SamplerBank } from '../types/sampler';
import { loadDefaultBankFromAssetsPipeline } from './useSamplerStore.defaultBankAssets';
import { runDefaultBankSyncPipeline } from './useSamplerStore.defaultBankSync';
import {
  DEFAULT_BANK_RELEASE_CHECK_INTERVAL_MS,
  fetchDefaultBankReleaseDownload,
  fetchDefaultBankReleaseManifest,
  installDefaultBankReleaseArchive,
  readDefaultBankReleaseMetaState,
  shouldRefreshDefaultBankRelease,
  writeDefaultBankReleaseMetaState,
} from './useSamplerStore.defaultBankRelease';
import {
  DEFAULT_BANK_SOURCE_ID,
  dedupeBanksByIdentity,
  isCanonicalDefaultBankIdentity,
} from './useSamplerStore.bankIdentity';
import {
  clearSelectedBankHydrationRetryTimer,
  collectSelectedBankIds,
  queueSelectedBankHydrationRetryPipeline,
  runSelectedBankHydrationPipeline,
} from './useSamplerStore.selectedBankHydration';
import { summarizeMissingMedia, padNeedsMediaHydration } from './useSamplerStore.padHelpers';
import { type SamplerMediaHelpers } from './useSamplerStore.mediaRuntime';

const BANK_MEDIA_DEHYDRATE_IDLE_MS = 15_000;
const DECK_LOADED_BANKS_EVENT = 'vdjv-deck-loaded-banks-changed';
const DECK_PLAYBACK_EVENT = 'vdjv-deck-playback-changed';
const PREPARED_PLAYBACK_PAD_STARTED_EVENT = 'vdjv-prepared-playback-pad-started';
const HOT_TRANSPORT_PADS_CHANGED_EVENT = 'vdjv-audio-transport-hot-pads-changed';

const isBlobUrl = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.startsWith('blob:');

const bankHasBlobMedia = (bank: SamplerBank, preservedPadIds: Set<string> = new Set()): boolean => {
  return (bank.pads || []).some((pad) => {
    const preservePadMedia = preservedPadIds.has(pad.id);
    return (
      (!preservePadMedia && isBlobUrl(pad.audioUrl)) ||
      (!preservePadMedia && isBlobUrl(pad.preparedAudioUrl)) ||
      isBlobUrl(pad.imageUrl)
    );
  });
};

const dehydrateBankMedia = (bank: SamplerBank, preservedPadIds: Set<string> = new Set()): SamplerBank => {
  let changed = false;

  const nextPads = (bank.pads || []).map((pad) => {
    let nextPad = pad;
    const preservePadMedia = preservedPadIds.has(pad.id);
    if (!preservePadMedia && isBlobUrl(pad.audioUrl)) {
      try { URL.revokeObjectURL(pad.audioUrl); } catch {}
      nextPad = { ...nextPad, audioUrl: null };
      changed = true;
    }
    if (!preservePadMedia && isBlobUrl(pad.preparedAudioUrl)) {
      try { URL.revokeObjectURL(pad.preparedAudioUrl); } catch {}
      nextPad = { ...nextPad, preparedAudioUrl: undefined };
      changed = true;
    }
    if (isBlobUrl(pad.imageUrl)) {
      try { URL.revokeObjectURL(pad.imageUrl); } catch {}
      nextPad = { ...nextPad, imageUrl: null };
      changed = true;
    }
    return nextPad;
  });

  if (!changed) return bank;
  return {
    ...bank,
    pads: nextPads,
  };
};

interface UseSamplerStoreBankLifecycleParams {
  banks: SamplerBank[];
  banksRef: React.MutableRefObject<SamplerBank[]>;
  isBanksHydrated: boolean;
  startupRestoreCompleted: boolean;
  hasCompletedInitialDefaultBankSync: boolean;
  setHasCompletedInitialDefaultBankSync: React.Dispatch<React.SetStateAction<boolean>>;
  isDefaultBankSyncing: boolean;
  setIsDefaultBankSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  setPrimaryBankIdState: React.Dispatch<React.SetStateAction<string | null>>;
  setSecondaryBankIdState: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentBankIdState: React.Dispatch<React.SetStateAction<string | null>>;
  authSessionUserId: string | null;
  isGuestLockedSession: boolean;
  defaultBankSourceRevision: number;
  setDefaultBankSourceRevision: React.Dispatch<React.SetStateAction<number>>;
  selectedBankHydrationRetryNonce: number;
  setSelectedBankHydrationRetryNonce: React.Dispatch<React.SetStateAction<number>>;
  rehydratePadMediaFromStorage: (pad: PadData) => Promise<PadData>;
  rehydrateBankMediaFromStorage: (bank: SamplerBank) => Promise<SamplerBank>;
  setBanks: React.Dispatch<React.SetStateAction<SamplerBank[]>>;
  yieldToMainThread: () => Promise<void>;
  getDefaultBankPadImagePreference: (padId: string) => 'none' | null;
  readLastOpenBankId: (ownerId: string | null) => string | null;
  generateId: () => string;
  restoreFileAccess: SamplerMediaHelpers['restoreFileAccess'];
  storeFile: SamplerMediaHelpers['storeFile'];
  selectedBankHydrationRunIdRef: React.MutableRefObject<number>;
  selectedBankHydrationRetryAttemptsRef: React.MutableRefObject<Record<string, number>>;
  selectedBankHydrationRetryTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  startupMediaRestoreInProgressRef: React.MutableRefObject<boolean>;
  backgroundBankHydrationRunIdRef: React.MutableRefObject<number>;
  backgroundBankHydrationInProgressRef: React.MutableRefObject<boolean>;
  defaultBankSyncRunIdRef: React.MutableRefObject<number>;
  defaultBankSyncSignatureRef: React.MutableRefObject<string | null>;
  defaultBankSourceOverrideRef: React.MutableRefObject<SamplerBank | null>;
  defaultBankSourceForceApplyRef: React.MutableRefObject<boolean>;
  defaultBankReleaseCheckStartedRef: React.MutableRefObject<boolean>;
  defaultBankReleaseInstallInProgressRef: React.MutableRefObject<boolean>;
  defaultBankSessionTransitionPendingRef: React.MutableRefObject<boolean>;
  selectionOwnerRef: React.MutableRefObject<string | null>;
  missingMediaNoticeSignatureRef: React.MutableRefObject<string | null>;
  previousGuestModeRef: React.MutableRefObject<boolean | null>;
  previousHydratedRef: React.MutableRefObject<boolean>;
  guestDefaultSelectionPendingRef: React.MutableRefObject<boolean>;
}

export function useSamplerStoreBankLifecycle({
  banks,
  banksRef,
  isBanksHydrated,
  startupRestoreCompleted,
  hasCompletedInitialDefaultBankSync,
  setHasCompletedInitialDefaultBankSync,
  isDefaultBankSyncing,
  setIsDefaultBankSyncing,
  primaryBankId,
  secondaryBankId,
  currentBankId,
  setPrimaryBankIdState,
  setSecondaryBankIdState,
  setCurrentBankIdState,
  authSessionUserId,
  isGuestLockedSession,
  defaultBankSourceRevision,
  setDefaultBankSourceRevision,
  selectedBankHydrationRetryNonce,
  setSelectedBankHydrationRetryNonce,
  rehydratePadMediaFromStorage,
  rehydrateBankMediaFromStorage,
  setBanks,
  yieldToMainThread,
  getDefaultBankPadImagePreference,
  readLastOpenBankId,
  generateId,
  restoreFileAccess,
  storeFile,
  selectedBankHydrationRunIdRef,
  selectedBankHydrationRetryAttemptsRef,
  selectedBankHydrationRetryTimerRef,
  startupMediaRestoreInProgressRef,
  backgroundBankHydrationRunIdRef,
  backgroundBankHydrationInProgressRef,
  defaultBankSyncRunIdRef,
  defaultBankSyncSignatureRef,
  defaultBankSourceOverrideRef,
  defaultBankSourceForceApplyRef,
  defaultBankReleaseCheckStartedRef,
  defaultBankReleaseInstallInProgressRef,
  defaultBankSessionTransitionPendingRef,
  selectionOwnerRef,
  missingMediaNoticeSignatureRef,
  previousGuestModeRef,
  previousHydratedRef,
  guestDefaultSelectionPendingRef,
}: UseSamplerStoreBankLifecycleParams): void {
  const recentBankOrderRef = React.useRef<string[]>([]);
  const recentHotPadsRef = React.useRef<Array<{ bankId: string; padId: string; lastPlayedAt: number }>>([]);
  const bankMediaDehydrateTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const deckLoadedBankIdsRef = React.useRef<Set<string>>(new Set());
  const hasActiveDeckPlaybackRef = React.useRef(false);
  const [deckPlaybackNonce, setDeckPlaybackNonce] = React.useState(0);
  const [hotPadNonce, setHotPadNonce] = React.useState(0);

  React.useEffect(() => {
    return () => {
      clearSelectedBankHydrationRetryTimer(selectedBankHydrationRetryTimerRef);
      if (bankMediaDehydrateTimerRef.current !== null) {
        clearTimeout(bankMediaDehydrateTimerRef.current);
        bankMediaDehydrateTimerRef.current = null;
      }
    };
  }, [selectedBankHydrationRetryTimerRef]);

  React.useEffect(() => {
    const activeIds = [currentBankId, primaryBankId, secondaryBankId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (activeIds.length === 0) return;

    recentBankOrderRef.current = [
      ...activeIds,
      ...recentBankOrderRef.current.filter((id) => !activeIds.includes(id)),
    ];
  }, [currentBankId, primaryBankId, secondaryBankId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDeckLoadedBanksChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ bankIds?: unknown }>).detail;
      const bankIds = Array.isArray(detail?.bankIds)
        ? detail.bankIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
      deckLoadedBankIdsRef.current = new Set(bankIds);
    };

    window.addEventListener(DECK_LOADED_BANKS_EVENT, handleDeckLoadedBanksChanged as EventListener);
    return () => {
      deckLoadedBankIdsRef.current = new Set();
      window.removeEventListener(DECK_LOADED_BANKS_EVENT, handleDeckLoadedBanksChanged as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePreparedPadStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ bankId?: unknown; padId?: unknown }>).detail;
      const bankId = typeof detail?.bankId === 'string' ? detail.bankId : '';
      const padId = typeof detail?.padId === 'string' ? detail.padId : '';
      if (!bankId || !padId) return;

      const retentionPolicy = getSamplerRuntimeTuningProfile().sessionMediaRetention;
      const hotPadCount = retentionPolicy?.hotPadCount ?? 16;
      const hotPadTtlMs = retentionPolicy?.hotPadTtlMs ?? 180_000;
      const now = Date.now();
      const nextEntries = [
        { bankId, padId, lastPlayedAt: now },
        ...recentHotPadsRef.current.filter((entry) => !(entry.bankId === bankId && entry.padId === padId) && (now - entry.lastPlayedAt) < hotPadTtlMs),
      ].slice(0, hotPadCount);
      recentHotPadsRef.current = nextEntries;
      setHotPadNonce((value) => value + 1);
    };

    window.addEventListener(PREPARED_PLAYBACK_PAD_STARTED_EVENT, handlePreparedPadStarted as EventListener);
    return () => {
      recentHotPadsRef.current = [];
      window.removeEventListener(PREPARED_PLAYBACK_PAD_STARTED_EVENT, handlePreparedPadStarted as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const retentionPolicy = getSamplerRuntimeTuningProfile().sessionMediaRetention;
    const hotPadTtlMs = retentionPolicy?.hotPadTtlMs ?? 180_000;
    const now = Date.now();
    recentHotPadsRef.current = recentHotPadsRef.current.filter((entry) => (now - entry.lastPlayedAt) < hotPadTtlMs);
    const padIds = Array.from(new Set(recentHotPadsRef.current.map((entry) => entry.padId)));

    window.dispatchEvent(new CustomEvent(HOT_TRANSPORT_PADS_CHANGED_EVENT, {
      detail: {
        padIds,
      },
    }));
  }, [hotPadNonce]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    return () => {
      window.dispatchEvent(new CustomEvent(HOT_TRANSPORT_PADS_CHANGED_EVENT, {
        detail: {
          padIds: [],
        },
      }));
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDeckPlaybackChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ isPlaying?: unknown }>).detail;
      const nextValue = detail?.isPlaying === true;
      if (hasActiveDeckPlaybackRef.current === nextValue) return;
      hasActiveDeckPlaybackRef.current = nextValue;
      setDeckPlaybackNonce((value) => value + 1);
    };

    window.addEventListener(DECK_PLAYBACK_EVENT, handleDeckPlaybackChanged as EventListener);
    return () => {
      hasActiveDeckPlaybackRef.current = false;
      window.removeEventListener(DECK_PLAYBACK_EVENT, handleDeckPlaybackChanged as EventListener);
    };
  }, []);

  const queueSelectedBankHydrationRetry = React.useCallback((bankId: string) => {
    queueSelectedBankHydrationRetryPipeline(bankId, {
      maxRetries: 3,
      retryAttemptsRef: selectedBankHydrationRetryAttemptsRef,
      retryTimerRef: selectedBankHydrationRetryTimerRef,
      setRetryNonce: setSelectedBankHydrationRetryNonce,
    });
  }, [
    selectedBankHydrationRetryAttemptsRef,
    selectedBankHydrationRetryTimerRef,
    setSelectedBankHydrationRetryNonce,
  ]);

  React.useEffect(() => {
    if (!isBanksHydrated) return;
    if (!startupRestoreCompleted) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;

    const selectedBankIds = collectSelectedBankIds({
      primaryBankId,
      secondaryBankId,
      currentBankId,
    });
    if (!selectedBankIds.size) return;

    const runId = selectedBankHydrationRunIdRef.current + 1;
    selectedBankHydrationRunIdRef.current = runId;
    let cancelled = false;

    const hydrateSelectedBanks = async () => {
      await runSelectedBankHydrationPipeline(
        {
          selectedBankIds,
          runId,
          isCancelled: () => cancelled,
        },
        {
          banksRef,
          runIdRef: selectedBankHydrationRunIdRef,
          retryAttemptsRef: selectedBankHydrationRetryAttemptsRef,
          rehydratePadMediaFromStorage,
          rehydrateBankMediaFromStorage,
          setBanks,
          padNeedsMediaHydration,
          queueSelectedBankHydrationRetry,
          yieldToMainThread,
        }
      );
    };

    void hydrateSelectedBanks();
    return () => {
      cancelled = true;
    };
  }, [
    banks,
    banksRef,
    currentBankId,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    primaryBankId,
    queueSelectedBankHydrationRetry,
    rehydratePadMediaFromStorage,
    rehydrateBankMediaFromStorage,
    secondaryBankId,
    selectedBankHydrationRetryAttemptsRef,
    selectedBankHydrationRetryNonce,
    selectedBankHydrationRunIdRef,
    setBanks,
    startupRestoreCompleted,
    yieldToMainThread,
  ]);

  React.useEffect(() => {
    if (!isBanksHydrated) return;
    if (!startupRestoreCompleted) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;
    if (startupMediaRestoreInProgressRef.current) return;
    if (backgroundBankHydrationInProgressRef.current) return;

    const runtimeProfile = getSamplerRuntimeTuningProfile();
    if (runtimeProfile.kind === 'electron_desktop') return;

    const totalPads = banks.reduce((sum, bank) => sum + (Array.isArray(bank.pads) ? bank.pads.length : 0), 0);
    const backgroundHydrationPadLimit = runtimeProfile.backgroundHydrationPadLimit ?? 480;
    if (totalPads > backgroundHydrationPadLimit) return;

    const hasMissingMedia = banks.some((bank) =>
      Array.isArray(bank.pads) && bank.pads.some((pad) => padNeedsMediaHydration(pad))
    );
    if (!hasMissingMedia) return;
    if (hasActiveDeckPlaybackRef.current) return;

    const runId = backgroundBankHydrationRunIdRef.current + 1;
    backgroundBankHydrationRunIdRef.current = runId;
    backgroundBankHydrationInProgressRef.current = true;
    let cancelled = false;

    const hydrateRemainingBanks = async () => {
      const attemptedBankIds = new Set<string>();
      try {
        while (!cancelled && backgroundBankHydrationRunIdRef.current === runId) {
          const nextBank = banksRef.current.find((bank) => {
            if (attemptedBankIds.has(bank.id)) return false;
            return Array.isArray(bank.pads) && bank.pads.some((pad) => padNeedsMediaHydration(pad));
          });
          if (!nextBank) break;
          attemptedBankIds.add(nextBank.id);

          const missingBefore = nextBank.pads.filter((pad) => padNeedsMediaHydration(pad)).length;
          if (missingBefore <= 0) continue;

          const hydrated = await rehydrateBankMediaFromStorage(nextBank);
          if (cancelled || backgroundBankHydrationRunIdRef.current !== runId) return;

          const missingAfter = hydrated.pads.filter((pad) => padNeedsMediaHydration(pad)).length;
          if (missingAfter < missingBefore) {
            setBanks((prev) => {
              const targetIndex = prev.findIndex((bank) => bank.id === hydrated.id);
              if (targetIndex < 0) return prev;
              const next = [...prev];
              next[targetIndex] = hydrated;
              return next;
            });
          }

          await yieldToMainThread();
        }
      } finally {
        if (backgroundBankHydrationRunIdRef.current === runId) {
          backgroundBankHydrationInProgressRef.current = false;
        }
      }
    };

    void hydrateRemainingBanks();
    return () => {
      cancelled = true;
      if (backgroundBankHydrationRunIdRef.current === runId) {
        backgroundBankHydrationInProgressRef.current = false;
      }
    };
  }, [
    backgroundBankHydrationInProgressRef,
    backgroundBankHydrationRunIdRef,
    banks,
    banksRef,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    rehydrateBankMediaFromStorage,
    setBanks,
    startupMediaRestoreInProgressRef,
    startupRestoreCompleted,
    yieldToMainThread,
    deckPlaybackNonce,
  ]);

  React.useEffect(() => {
    if (!isBanksHydrated) return;
    if (!startupRestoreCompleted) return;
    if (hasActiveDeckPlaybackRef.current) return;

    const retentionPolicy = getSamplerRuntimeTuningProfile().sessionMediaRetention;
    if (!retentionPolicy?.enabled) return;
    const minBanksForDehydration = retentionPolicy?.minBanksForDehydration ?? 5;
    const maxRecentWarmBanks = retentionPolicy?.maxRecentWarmBanks ?? 1;
    const hotPadTtlMs = retentionPolicy?.hotPadTtlMs ?? 180_000;
    if (banks.length < minBanksForDehydration) return;

    const dehydrateIdleMs = retentionPolicy?.dehydrateIdleMs ?? BANK_MEDIA_DEHYDRATE_IDLE_MS;

    if (bankMediaDehydrateTimerRef.current !== null) {
      clearTimeout(bankMediaDehydrateTimerRef.current);
    }

    bankMediaDehydrateTimerRef.current = setTimeout(() => {
      const now = Date.now();
      recentHotPadsRef.current = recentHotPadsRef.current.filter((entry) => (now - entry.lastPlayedAt) < hotPadTtlMs);
      const activeIds = new Set(
        [currentBankId, primaryBankId, secondaryBankId].filter(
          (value): value is string => typeof value === 'string' && value.length > 0
        )
      );
      const extraWarmIds = recentBankOrderRef.current
        .filter((id) => !activeIds.has(id))
        .slice(0, maxRecentWarmBanks);
      const defaultBankIds = banks
        .filter((bank) => isCanonicalDefaultBankIdentity(bank, banks))
        .map((bank) => bank.id);
      const preserveIds = new Set<string>([
        ...activeIds,
        ...extraWarmIds,
        ...defaultBankIds,
        ...deckLoadedBankIdsRef.current,
      ]);
      const preservedPadIdsByBank = new Map<string, Set<string>>();
      recentHotPadsRef.current.forEach((entry) => {
        const existing = preservedPadIdsByBank.get(entry.bankId);
        if (existing) {
          existing.add(entry.padId);
          return;
        }
        preservedPadIdsByBank.set(entry.bankId, new Set([entry.padId]));
      });

      setBanks((prev) => {
        let changed = false;
        const next = prev.map((bank) => {
          if (preserveIds.has(bank.id)) return bank;
          const preservedPadIds = preservedPadIdsByBank.get(bank.id) ?? new Set<string>();
          if (!bankHasBlobMedia(bank, preservedPadIds)) return bank;
          const dehydrated = dehydrateBankMedia(bank, preservedPadIds);
          if (dehydrated !== bank) changed = true;
          return dehydrated;
        });
        return changed ? next : prev;
      });
      bankMediaDehydrateTimerRef.current = null;
    }, dehydrateIdleMs);

    return () => {
      if (bankMediaDehydrateTimerRef.current !== null) {
        clearTimeout(bankMediaDehydrateTimerRef.current);
        bankMediaDehydrateTimerRef.current = null;
      }
    };
  }, [
    banks,
    currentBankId,
    hotPadNonce,
    isBanksHydrated,
    primaryBankId,
    secondaryBankId,
    setBanks,
    startupRestoreCompleted,
    deckPlaybackNonce,
  ]);

  const loadInstalledDefaultBankSource = React.useCallback(async (
    bank: SamplerBank,
    allowAudio: boolean
  ): Promise<SamplerBank> => {
    const restoredPads: PadData[] = [];
    for (let index = 0; index < bank.pads.length; index += 1) {
      const pad = bank.pads[index];
      let audioUrl = allowAudio ? pad.audioUrl || '' : '';
      let imageUrl = pad.imageUrl || '';

      if (allowAudio && !audioUrl && pad.audioStorageKey) {
        try {
          const restoredAudio = await restoreFileAccess(
            pad.id,
            'audio',
            pad.audioStorageKey,
            pad.audioBackend
          );
          audioUrl = restoredAudio.url || '';
        } catch {
          audioUrl = '';
        }
      }

      if (!imageUrl && (pad.imageStorageKey || pad.hasImageAsset)) {
        try {
          const restoredImage = await restoreFileAccess(
            pad.id,
            'image',
            pad.imageStorageKey,
            pad.imageBackend
          );
          imageUrl = restoredImage.url || '';
        } catch {
          imageUrl = '';
        }
      }

      restoredPads.push({
        ...pad,
        audioUrl,
        imageUrl,
      });
      if ((index + 1) % 6 === 0) await yieldToMainThread();
    }

    return {
      ...bank,
      pads: restoredPads,
    };
  }, [restoreFileAccess, yieldToMainThread]);

  const loadDefaultBankSource = React.useCallback(async (allowAudio: boolean): Promise<SamplerBank> => {
    const overrideSource = defaultBankSourceOverrideRef.current;
    if (overrideSource) {
      return await loadInstalledDefaultBankSource(overrideSource, allowAudio);
    }

    const installedRemoteDefault = banksRef.current.find(
      (bank) => isCanonicalDefaultBankIdentity(bank, banksRef.current) && bank.bankMetadata?.defaultBankSource === 'remote'
    );
    if (installedRemoteDefault) {
      return await loadInstalledDefaultBankSource(installedRemoteDefault, allowAudio);
    }

    return loadDefaultBankFromAssetsPipeline(allowAudio, {
      generateId,
      defaultBankSourceId: DEFAULT_BANK_SOURCE_ID,
    });
  }, [banksRef, defaultBankSourceOverrideRef, generateId, loadInstalledDefaultBankSource]);

  React.useEffect(() => {
    if (!startupRestoreCompleted) return;
    defaultBankSessionTransitionPendingRef.current = true;
    missingMediaNoticeSignatureRef.current = null;
    setHasCompletedInitialDefaultBankSync(false);
    setIsDefaultBankSyncing(true);
  }, [
    authSessionUserId,
    defaultBankSessionTransitionPendingRef,
    isGuestLockedSession,
    missingMediaNoticeSignatureRef,
    setHasCompletedInitialDefaultBankSync,
    setIsDefaultBankSyncing,
    startupRestoreCompleted,
  ]);

  React.useEffect(() => {
    if (!isBanksHydrated) return;
    if (!startupRestoreCompleted) return;

    const syncRunId = defaultBankSyncRunIdRef.current + 1;
    defaultBankSyncRunIdRef.current = syncRunId;
    setIsDefaultBankSyncing(true);
    let cancelled = false;

    const syncDefaultBankFromAssets = async () => {
      const allowAudio = Boolean(authSessionUserId) && !isGuestLockedSession;
      const defaultBank = banksRef.current.find(
        (bank) => isCanonicalDefaultBankIdentity(bank, banksRef.current) && Array.isArray(bank.pads) && bank.pads.length > 0
      );
      const needsInsert = !defaultBank;
      const hasAnyAudio = Boolean(defaultBank?.pads.some((pad) => Boolean(pad.audioUrl)));
      const hasLockedPads = Boolean(defaultBank?.pads.some((pad) => !pad.audioUrl));
      const hasMissingVisibleImages = Boolean(defaultBank?.pads.some((pad) => {
        if (getDefaultBankPadImagePreference(pad.id) === 'none') return false;
        return !pad.imageUrl;
      }));
      const needsAudioStateSync = !needsInsert && (allowAudio ? hasLockedPads : hasAnyAudio);
      const needsVisualStateSync = !needsInsert && hasMissingVisibleImages;
      const forceApplySource = defaultBankSourceForceApplyRef.current;
      const syncSignature = [
        allowAudio ? '1' : '0',
        defaultBank?.id || 'none',
        defaultBank?.pads?.length || 0,
        hasAnyAudio ? '1' : '0',
        hasLockedPads ? '1' : '0',
        hasMissingVisibleImages ? '1' : '0',
        defaultBankSourceRevision,
        forceApplySource ? '1' : '0',
      ].join('|');

      await runDefaultBankSyncPipeline(
        {
          allowAudio,
          needsInsert,
          needsAudioStateSync,
          needsVisualStateSync,
          forceApplySource,
          syncSignature,
        },
        {
          defaultBankSyncSignatureRef,
          loadDefaultBankSource,
          getDefaultBankPadImagePreference,
          isCancelled: () => cancelled || syncRunId !== defaultBankSyncRunIdRef.current,
          setBanks,
          setPrimaryBankIdState,
          setSecondaryBankIdState,
          setCurrentBankIdState,
          isCanonicalDefaultBankIdentity: (bank) => isCanonicalDefaultBankIdentity(bank, banksRef.current),
          defaultBankSourceId: DEFAULT_BANK_SOURCE_ID,
          dedupeBanksByIdentity,
        }
      );

      if (!cancelled && syncRunId === defaultBankSyncRunIdRef.current) {
        defaultBankSourceForceApplyRef.current = false;
        defaultBankSessionTransitionPendingRef.current = false;
        setHasCompletedInitialDefaultBankSync(true);
        setIsDefaultBankSyncing(false);
      }
    };

    void syncDefaultBankFromAssets();
    return () => {
      cancelled = true;
    };
  }, [
    authSessionUserId,
    banks,
    banksRef,
    defaultBankSourceForceApplyRef,
    defaultBankSourceRevision,
    defaultBankSyncRunIdRef,
    defaultBankSyncSignatureRef,
    defaultBankSessionTransitionPendingRef,
    getDefaultBankPadImagePreference,
    isBanksHydrated,
    isGuestLockedSession,
    loadDefaultBankSource,
    setBanks,
    setCurrentBankIdState,
    setHasCompletedInitialDefaultBankSync,
    setIsDefaultBankSyncing,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    startupRestoreCompleted,
  ]);

  React.useEffect(() => {
    if (!startupRestoreCompleted) return;
    if (!isBanksHydrated) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;
    if (defaultBankReleaseCheckStartedRef.current || defaultBankReleaseInstallInProgressRef.current) return;

    const metaState = readDefaultBankReleaseMetaState();
    const installedRemoteVersion = banksRef.current.find(
      (bank) => isCanonicalDefaultBankIdentity(bank, banksRef.current) && bank.bankMetadata?.defaultBankSource === 'remote'
    )?.bankMetadata?.defaultBankReleaseVersion ?? null;
    const missingInstalledRemote =
      Boolean(metaState.manifest) && (!installedRemoteVersion || installedRemoteVersion !== metaState.manifest?.version);
    const now = Date.now();
    const shouldCheckManifest =
      missingInstalledRemote ||
      !metaState.lastCheckedAt ||
      (now - metaState.lastCheckedAt) >= DEFAULT_BANK_RELEASE_CHECK_INTERVAL_MS;

    if (!shouldCheckManifest) return;

    defaultBankReleaseCheckStartedRef.current = true;
    let cancelled = false;

    const runReleaseCheck = async () => {
      try {
        const remoteManifest = await fetchDefaultBankReleaseManifest();
        if (cancelled) return;

        const refreshNeeded = shouldRefreshDefaultBankRelease(metaState.manifest, remoteManifest) || missingInstalledRemote;
        if (!refreshNeeded || !remoteManifest) {
          writeDefaultBankReleaseMetaState({
            manifest: remoteManifest || metaState.manifest,
            lastCheckedAt: now,
          });
          return;
        }

        defaultBankReleaseInstallInProgressRef.current = true;
        const download = await fetchDefaultBankReleaseDownload();
        if (cancelled) return;

        const archiveResponse = await fetch(download.downloadUrl, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!archiveResponse.ok) {
          throw new Error(`Default bank archive download failed (${archiveResponse.status})`);
        }
        const archiveBlob = await archiveResponse.blob();
        const installedBank = await installDefaultBankReleaseArchive(
          {
            manifest: download.release,
            archiveBlob,
            defaultBankSourceId: DEFAULT_BANK_SOURCE_ID,
          },
          {
            generateId,
            storeFile,
            yieldToMainThread,
          }
        );
        if (cancelled) return;

        defaultBankSourceOverrideRef.current = installedBank;
        defaultBankSourceForceApplyRef.current = true;
        writeDefaultBankReleaseMetaState({
          manifest: download.release,
          lastCheckedAt: now,
        });
        setHasCompletedInitialDefaultBankSync(false);
        setIsDefaultBankSyncing(true);
        setDefaultBankSourceRevision((value) => value + 1);
      } catch {
        // Keep bundled/default persisted bank on network or parse failures.
      } finally {
        defaultBankReleaseInstallInProgressRef.current = false;
      }
    };

    void runReleaseCheck();
    return () => {
      cancelled = true;
    };
  }, [
    banksRef,
    defaultBankReleaseCheckStartedRef,
    defaultBankReleaseInstallInProgressRef,
    defaultBankSourceForceApplyRef,
    defaultBankSourceOverrideRef,
    defaultBankSourceRevision,
    generateId,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    setDefaultBankSourceRevision,
    setHasCompletedInitialDefaultBankSync,
    setIsDefaultBankSyncing,
    startupRestoreCompleted,
    storeFile,
    yieldToMainThread,
  ]);

  React.useEffect(() => {
    if (!startupRestoreCompleted) return;
    if (!isBanksHydrated) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;

    const ownerId = authSessionUserId || null;
    if (selectionOwnerRef.current === ownerId) return;
    const previousOwnerId = selectionOwnerRef.current;
    selectionOwnerRef.current = ownerId;
    if (previousOwnerId === null) return;

    const defaultBankId = banks.find((bank) => isCanonicalDefaultBankIdentity(bank, banks))?.id;
    if (!defaultBankId) return;
    if (currentBankId === defaultBankId && primaryBankId === null && secondaryBankId === null) return;

    setPrimaryBankIdState(null);
    setSecondaryBankIdState(null);
    setCurrentBankIdState(defaultBankId);
  }, [
    authSessionUserId,
    banks,
    currentBankId,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    primaryBankId,
    secondaryBankId,
    selectionOwnerRef,
    setCurrentBankIdState,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    startupRestoreCompleted,
  ]);

  React.useEffect(() => {
    if (!startupRestoreCompleted) return;
    if (!isBanksHydrated) return;
    if (defaultBankSessionTransitionPendingRef.current) return;
    if (!hasCompletedInitialDefaultBankSync || isDefaultBankSyncing) return;

    const summary = summarizeMissingMedia(banks);
    if (!summary) {
      missingMediaNoticeSignatureRef.current = null;
      return;
    }

    const signature = [
      summary.missingAudio,
      summary.missingImages,
      summary.affectedBanks.join('|'),
    ].join(':');
    if (missingMediaNoticeSignatureRef.current === signature) return;

    missingMediaNoticeSignatureRef.current = signature;
    window.dispatchEvent(new CustomEvent('vdjv-missing-media-detected', { detail: summary }));
  }, [
    banks,
    defaultBankSessionTransitionPendingRef,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    missingMediaNoticeSignatureRef,
    startupRestoreCompleted,
  ]);

  React.useEffect(() => {
    const isGuestMode = isGuestLockedSession;
    const wasGuestMode = previousGuestModeRef.current;
    const wasHydrated = previousHydratedRef.current;

    const hydrationCompleted = !wasHydrated && isBanksHydrated;
    const enteredGuestMode = wasGuestMode === false && isGuestMode;
    if (isGuestMode && (hydrationCompleted || enteredGuestMode)) {
      guestDefaultSelectionPendingRef.current = true;
    }
    if (!isGuestMode) {
      guestDefaultSelectionPendingRef.current = false;
    }

    previousGuestModeRef.current = isGuestMode;
    previousHydratedRef.current = isBanksHydrated;
  }, [
    guestDefaultSelectionPendingRef,
    isBanksHydrated,
    isGuestLockedSession,
    previousGuestModeRef,
    previousHydratedRef,
  ]);

  React.useEffect(() => {
    if (!guestDefaultSelectionPendingRef.current) return;
    if (!isBanksHydrated) return;

    if (!isGuestLockedSession) {
      guestDefaultSelectionPendingRef.current = false;
      return;
    }

    const defaultBank = banks.find(
      (bank) => isCanonicalDefaultBankIdentity(bank, banks) && Array.isArray(bank.pads) && bank.pads.length > 0
    );
    if (!defaultBank) return;

    if (primaryBankId !== null || secondaryBankId !== null || currentBankId !== defaultBank.id) {
      setPrimaryBankIdState(null);
      setSecondaryBankIdState(null);
      setCurrentBankIdState(defaultBank.id);
    }

    guestDefaultSelectionPendingRef.current = false;
  }, [
    banks,
    currentBankId,
    guestDefaultSelectionPendingRef,
    isBanksHydrated,
    isGuestLockedSession,
    primaryBankId,
    secondaryBankId,
    setCurrentBankIdState,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
  ]);
}
