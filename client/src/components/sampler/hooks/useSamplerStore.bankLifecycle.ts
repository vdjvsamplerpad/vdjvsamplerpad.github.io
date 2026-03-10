import * as React from 'react';
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
  isDefaultBankIdentity,
} from './useSamplerStore.bankIdentity';
import {
  clearSelectedBankHydrationRetryTimer,
  collectSelectedBankIds,
  queueSelectedBankHydrationRetryPipeline,
  runSelectedBankHydrationPipeline,
} from './useSamplerStore.selectedBankHydration';
import { summarizeMissingMedia, padNeedsMediaHydration } from './useSamplerStore.padHelpers';
import { type SamplerMediaHelpers } from './useSamplerStore.mediaRuntime';

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
  React.useEffect(() => {
    return () => {
      clearSelectedBankHydrationRetryTimer(selectedBankHydrationRetryTimerRef);
    };
  }, [selectedBankHydrationRetryTimerRef]);

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

    const hasMissingMedia = banks.some((bank) =>
      Array.isArray(bank.pads) && bank.pads.some((pad) => padNeedsMediaHydration(pad))
    );
    if (!hasMissingMedia) return;

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
      (bank) => isDefaultBankIdentity(bank) && bank.bankMetadata?.defaultBankSource === 'remote'
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
        (bank) => isDefaultBankIdentity(bank) && Array.isArray(bank.pads) && bank.pads.length > 0
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
          isDefaultBankIdentity,
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
      (bank) => isDefaultBankIdentity(bank) && bank.bankMetadata?.defaultBankSource === 'remote'
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

    const lastOpenBankId = readLastOpenBankId(ownerId);
    if (!lastOpenBankId) return;
    if (!banks.some((bank) => bank.id === lastOpenBankId)) return;
    if (currentBankId === lastOpenBankId && primaryBankId === null && secondaryBankId === null) return;

    const currentBank = currentBankId ? banks.find((bank) => bank.id === currentBankId) || null : null;
    const shouldRestoreSelection =
      previousOwnerId === null ||
      !currentBank ||
      isDefaultBankIdentity(currentBank) ||
      primaryBankId !== null ||
      secondaryBankId !== null;

    if (!shouldRestoreSelection) return;

    setPrimaryBankIdState(null);
    setSecondaryBankIdState(null);
    setCurrentBankIdState(lastOpenBankId);
  }, [
    authSessionUserId,
    banks,
    currentBankId,
    hasCompletedInitialDefaultBankSync,
    isBanksHydrated,
    isDefaultBankSyncing,
    primaryBankId,
    readLastOpenBankId,
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
      (bank) => isDefaultBankIdentity(bank) && Array.isArray(bank.pads) && bank.pads.length > 0
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
