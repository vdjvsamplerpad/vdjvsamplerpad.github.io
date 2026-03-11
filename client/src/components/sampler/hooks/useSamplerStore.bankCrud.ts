import type { PadData, SamplerBank } from '../types/sampler';
import { applyBankContentPolicy, isOfficialPadContent } from './useSamplerStore.provenance';

type MediaBackend = 'native' | 'idb';
type SetState<T> = (value: T | ((prev: T) => T)) => void;

type QuotaPolicy = {
  deviceTotalBankCap: number;
  ownedBankQuota: number;
  ownedBankPadCap: number;
};

type PadTemplateDefaults = {
  triggerMode: PadData['triggerMode'];
  playbackMode: PadData['playbackMode'];
  volume: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  pitch: number;
  tempoPercent: number;
  keyLock: boolean;
};

export const runAddPadPipeline = async (
  input: {
    file: File;
    targetBankId: string | null;
    defaultTriggerMode?: PadData['triggerMode'];
    padDefaults?: PadTemplateDefaults;
    profileRole?: string | null;
    quotaPolicy: QuotaPolicy;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    setBanks: SetState<SamplerBank[]>;
    trimPadName: (name: string) => string;
    extractMetadataFromFile: (file: File) => Promise<{ audioBytes: number; audioDurationMs: number }>;
    checkAdmission: (metadata: { audioBytes: number; audioDurationMs: number }) => { allowed: boolean; message?: string };
    ensureStorageHeadroom: (requiredBytes: number, operation: string) => Promise<void>;
    generateId: () => string;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    isOwnedCountedBankForQuota: (bank: SamplerBank) => boolean;
    deletePadMediaArtifacts: (
      pad: Partial<PadData> & { id: string },
      type?: 'audio' | 'image'
    ) => Promise<void>;
  }
): Promise<void> => {
  const {
    file,
    targetBankId,
    defaultTriggerMode,
    padDefaults,
    profileRole,
    quotaPolicy,
  } = input;
  const {
    banksRef,
    setBanks,
    trimPadName,
    extractMetadataFromFile,
    checkAdmission,
    ensureStorageHeadroom,
    generateId,
    storeFile,
    isOwnedCountedBankForQuota,
    deletePadMediaArtifacts,
  } = deps;

  if (!targetBankId) return;
  const targetBank = banksRef.current.find((bank) => bank.id === targetBankId);
  if (!targetBank) return;
  const shouldEnforceOwnedPadCap = profileRole !== 'admin' && isOwnedCountedBankForQuota(targetBank);
  if (shouldEnforceOwnedPadCap && targetBank.pads.length >= quotaPolicy.ownedBankPadCap) {
    throw new Error(`Max ${quotaPolicy.ownedBankPadCap} pads allowed for owned banks. Remove a pad or use a trusted Store/Admin bank.`);
  }

  const metadata = await extractMetadataFromFile(file);
  const admission = checkAdmission(metadata);
  if (!admission.allowed) {
    throw new Error(admission.message || 'Audio file exceeds supported limits.');
  }
  await ensureStorageHeadroom(file.size, 'audio upload');
  const padId = generateId();
  const audioUrl = URL.createObjectURL(file);
  const storedAudio = await storeFile(padId, file, 'audio');
  const maxPosition = targetBank.pads.length > 0 ? Math.max(...targetBank.pads.map((p) => p.position || 0)) : -1;
  const resolvedDurationMs = metadata.audioDurationMs > 0 ? metadata.audioDurationMs : 30000;
  const triggerMode = defaultTriggerMode || padDefaults?.triggerMode || 'toggle';
  const newPad: PadData = {
    id: padId,
    name: trimPadName(file.name.replace(/\.[^/.]+$/, '')),
    audioUrl,
    audioStorageKey: storedAudio.storageKey,
    audioBackend: storedAudio.backend,
    hasImageAsset: false,
    color: targetBank.defaultColor,
    triggerMode,
    playbackMode: padDefaults?.playbackMode || 'once',
    volume: typeof padDefaults?.volume === 'number' ? padDefaults.volume : 1,
    gainDb: typeof padDefaults?.gainDb === 'number' ? padDefaults.gainDb : 0,
    gain: Math.pow(10, ((typeof padDefaults?.gainDb === 'number' ? padDefaults.gainDb : 0) / 20)),
    fadeInMs: typeof padDefaults?.fadeInMs === 'number' ? padDefaults.fadeInMs : 0,
    fadeOutMs: typeof padDefaults?.fadeOutMs === 'number' ? padDefaults.fadeOutMs : 0,
    startTimeMs: 0,
    endTimeMs: resolvedDurationMs,
    pitch: typeof padDefaults?.pitch === 'number' ? padDefaults.pitch : 0,
    tempoPercent: typeof padDefaults?.tempoPercent === 'number' ? padDefaults.tempoPercent : 0,
    keyLock: typeof padDefaults?.keyLock === 'boolean' ? padDefaults.keyLock : true,
    position: maxPosition + 1,
    ignoreChannel: false,
    audioBytes: metadata.audioBytes,
    audioDurationMs: metadata.audioDurationMs,
    savedHotcuesMs: [null, null, null, null],
    contentOrigin: 'user',
  };

  const latestBanks = banksRef.current;
  const latestBank = latestBanks.find((bank) => bank.id === targetBankId);
  const mustEnforceLatestPadCap =
    Boolean(latestBank) &&
    profileRole !== 'admin' &&
    isOwnedCountedBankForQuota(latestBank as SamplerBank);
  if (!latestBank || (mustEnforceLatestPadCap && latestBank.pads.length >= quotaPolicy.ownedBankPadCap)) {
    if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    await deletePadMediaArtifacts({
      id: padId,
      audioStorageKey: storedAudio.storageKey,
      audioBackend: storedAudio.backend,
    }, 'audio');
    throw new Error(`Max ${quotaPolicy.ownedBankPadCap} pads allowed for owned banks. First ${quotaPolicy.ownedBankPadCap} pads are kept.`);
  }

  const nextBanks = latestBanks.map((bank) => (
    bank.id === targetBankId ? applyBankContentPolicy({ ...bank, pads: [...bank.pads, newPad] }) : bank
  ));
  banksRef.current = nextBanks;
  setBanks(nextBanks);
};

export const runAddPadsPipeline = async (
  input: {
    files: File[];
    targetBankId: string | null;
    defaultTriggerMode?: PadData['triggerMode'];
    padDefaults?: PadTemplateDefaults;
    profileRole?: string | null;
    quotaPolicy: QuotaPolicy;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    setBanks: SetState<SamplerBank[]>;
    trimPadName: (name: string) => string;
    extractMetadataFromFile: (file: File) => Promise<{ audioBytes: number; audioDurationMs: number }>;
    checkAdmission: (metadata: { audioBytes: number; audioDurationMs: number }) => { allowed: boolean; message?: string };
    ensureStorageHeadroom: (requiredBytes: number, operation: string) => Promise<void>;
    generateId: () => string;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    isOwnedCountedBankForQuota: (bank: SamplerBank) => boolean;
    isNativeCapacitorPlatform: () => boolean;
    saveBatchBlobsToDB: (items: Array<{ id: string; blob: Blob; type: 'audio' | 'image' }>) => Promise<void>;
  }
): Promise<void> => {
  const {
    files,
    targetBankId,
    defaultTriggerMode,
    padDefaults,
    profileRole,
    quotaPolicy,
  } = input;
  const {
    banksRef,
    setBanks,
    trimPadName,
    extractMetadataFromFile,
    checkAdmission,
    ensureStorageHeadroom,
    generateId,
    storeFile,
    isOwnedCountedBankForQuota,
    isNativeCapacitorPlatform,
    saveBatchBlobsToDB,
  } = deps;

  if (!targetBankId) return;
  const targetBank = banksRef.current.find((b) => b.id === targetBankId);
  if (!targetBank) return;

  const validFiles = files.filter((file) => file.type.startsWith('audio/'));
  if (validFiles.length === 0) return;
  const shouldEnforceOwnedPadCap = profileRole !== 'admin' && isOwnedCountedBankForQuota(targetBank);
  const remainingSlots = shouldEnforceOwnedPadCap
    ? Math.max(0, quotaPolicy.ownedBankPadCap - targetBank.pads.length)
    : Number.MAX_SAFE_INTEGER;
  if (remainingSlots <= 0) {
    throw new Error(`Max ${quotaPolicy.ownedBankPadCap} pads allowed for owned banks. Remove a pad first.`);
  }
  const acceptedFiles = validFiles.slice(0, remainingSlots);
  const blockedCount = Math.max(0, validFiles.length - acceptedFiles.length);

  const batchItems: Array<{ id: string; blob: Blob; type: 'audio' | 'image' }> = [];
  const newPads: PadData[] = [];
  let maxPosition = targetBank.pads.length > 0 ? Math.max(...targetBank.pads.map((p) => p.position || 0)) : -1;
  const triggerMode = defaultTriggerMode || padDefaults?.triggerMode || 'toggle';

  for (const file of acceptedFiles) {
    const metadata = await extractMetadataFromFile(file);
    const admission = checkAdmission(metadata);
    if (!admission.allowed) continue;
    await ensureStorageHeadroom(file.size, 'batch audio upload');
    const padId = generateId();
    const audioUrl = URL.createObjectURL(file);
    let audioStorageKey: string | undefined;
    let audioBackend: MediaBackend = 'idb';
    if (isNativeCapacitorPlatform()) {
      const storedAudio = await storeFile(padId, file, 'audio');
      audioStorageKey = storedAudio.storageKey;
      audioBackend = storedAudio.backend;
    } else {
      batchItems.push({ id: padId, blob: file, type: 'audio' });
    }

    maxPosition += 1;
    newPads.push({
      id: padId,
      name: trimPadName(file.name.replace(/\.[^/.]+$/, '')),
      audioUrl,
      audioStorageKey,
      audioBackend,
      hasImageAsset: false,
      color: targetBank.defaultColor,
      triggerMode,
      playbackMode: padDefaults?.playbackMode || 'once',
      volume: typeof padDefaults?.volume === 'number' ? padDefaults.volume : 1,
      gainDb: typeof padDefaults?.gainDb === 'number' ? padDefaults.gainDb : 0,
      gain: Math.pow(10, ((typeof padDefaults?.gainDb === 'number' ? padDefaults.gainDb : 0) / 20)),
      fadeInMs: typeof padDefaults?.fadeInMs === 'number' ? padDefaults.fadeInMs : 0,
      fadeOutMs: typeof padDefaults?.fadeOutMs === 'number' ? padDefaults.fadeOutMs : 0,
      startTimeMs: 0,
      endTimeMs: metadata.audioDurationMs > 0 ? metadata.audioDurationMs : 30000,
      pitch: typeof padDefaults?.pitch === 'number' ? padDefaults.pitch : 0,
      tempoPercent: typeof padDefaults?.tempoPercent === 'number' ? padDefaults.tempoPercent : 0,
      keyLock: typeof padDefaults?.keyLock === 'boolean' ? padDefaults.keyLock : true,
      position: maxPosition,
      ignoreChannel: false,
      audioBytes: metadata.audioBytes,
      audioDurationMs: metadata.audioDurationMs,
      savedHotcuesMs: [null, null, null, null],
      contentOrigin: 'user',
    });
  }

  if (!isNativeCapacitorPlatform() && batchItems.length > 0) {
    await saveBatchBlobsToDB(batchItems);
  }
  if (newPads.length > 0) {
    const latestBanks = banksRef.current;
    const latestTargetBank = latestBanks.find((bank) => bank.id === targetBankId);
    const latestRemainingSlots = latestTargetBank && profileRole !== 'admin' && isOwnedCountedBankForQuota(latestTargetBank)
      ? Math.max(0, quotaPolicy.ownedBankPadCap - latestTargetBank.pads.length)
      : Number.MAX_SAFE_INTEGER;
    const finalPadsToAdd = newPads.slice(0, latestRemainingSlots);
    const lateBlocked = Math.max(0, newPads.length - finalPadsToAdd.length);
    if (finalPadsToAdd.length > 0) {
      const nextBanks = latestBanks.map((bank) => (
        bank.id === targetBankId ? applyBankContentPolicy({ ...bank, pads: [...bank.pads, ...finalPadsToAdd] }) : bank
      ));
      banksRef.current = nextBanks;
      setBanks(nextBanks);
    }
    if (blockedCount > 0 || lateBlocked > 0) {
      const totalBlocked = blockedCount + lateBlocked;
      throw new Error(`Loaded first ${Math.max(0, acceptedFiles.length - lateBlocked)} file(s). Blocked ${totalBlocked} file(s) because owned-bank pad limit is ${quotaPolicy.ownedBankPadCap}.`);
    }
  } else if (blockedCount > 0) {
    throw new Error(`Loaded first ${acceptedFiles.length} file(s). Blocked ${blockedCount} file(s) because owned-bank pad limit is ${quotaPolicy.ownedBankPadCap}.`);
  }
};

export const runUpdatePadPipeline = async (
  input: {
    bankId: string;
    id: string;
    updatedPad: PadData;
    banks: SamplerBank[];
  },
  deps: {
    base64ToBlob: (base64: string) => Blob;
    ensureStorageHeadroom: (requiredBytes: number, operation: string) => Promise<void>;
    storeFile: (
      padId: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    deletePadMediaArtifacts: (
      pad: Partial<PadData> & { id: string },
      type?: 'audio' | 'image'
    ) => Promise<void>;
    padHasExpectedImageAsset: (pad: Partial<PadData>) => boolean;
    setBanks: SetState<SamplerBank[]>;
  }
): Promise<void> => {
  const {
    bankId,
    id,
    updatedPad,
    banks,
  } = input;
  const {
    base64ToBlob,
    ensureStorageHeadroom,
    storeFile,
    deletePadMediaArtifacts,
    padHasExpectedImageAsset,
    setBanks,
  } = deps;

  const existingBank = banks.find((bank) => bank.id === bankId);
  const existingPad = existingBank?.pads.find((pad) => pad.id === id);
  const hadVisibleImage = Boolean(existingPad?.imageUrl || existingPad?.imageData);

  if (updatedPad.imageData && updatedPad.imageData.startsWith('data:')) {
    try {
      const imageBlob = base64ToBlob(updatedPad.imageData);
      await ensureStorageHeadroom(imageBlob.size, 'pad image save');
      if (updatedPad.imageUrl && updatedPad.imageUrl.startsWith('blob:')) URL.revokeObjectURL(updatedPad.imageUrl);
      updatedPad.imageUrl = URL.createObjectURL(imageBlob);
      const storedImage = await storeFile(id, new File([imageBlob], 'image', { type: imageBlob.type }), 'image');
      if (storedImage.storageKey) updatedPad.imageStorageKey = storedImage.storageKey;
      updatedPad.imageBackend = storedImage.backend;
      updatedPad.imageData = undefined;
      updatedPad.hasImageAsset = true;
    } catch {
    }
  }

  const requestedImageRemoval =
    hadVisibleImage &&
    (!updatedPad.imageUrl || updatedPad.imageUrl.trim().length === 0) &&
    (!updatedPad.imageData || updatedPad.imageData.trim().length === 0);

  if (requestedImageRemoval) {
    try {
      await deletePadMediaArtifacts({
        id,
        imageStorageKey: existingPad?.imageStorageKey,
        imageBackend: existingPad?.imageBackend,
      }, 'image');
    } catch {
    }
    updatedPad.imageStorageKey = undefined;
    updatedPad.imageBackend = undefined;
    updatedPad.hasImageAsset = false;
  } else {
    updatedPad.hasImageAsset = padHasExpectedImageAsset(updatedPad) || Boolean(existingPad?.hasImageAsset);
  }

  setBanks((prev) =>
    prev.map((bank) => {
      if (bank.id !== bankId) return bank;
      const currentPad = bank.pads.find((pad) => pad.id === id);
      const removedShortcut = Boolean(currentPad?.shortcutKey) && !updatedPad.shortcutKey;
      return applyBankContentPolicy({
        ...bank,
        disableDefaultPadShortcutLayout: removedShortcut ? true : bank.disableDefaultPadShortcutLayout,
        pads: bank.pads.map((pad) => (pad.id === id ? updatedPad : pad)),
      });
    })
  );
};

export const runRemovePadPipeline = async (
  input: {
    bankId: string;
    id: string;
    banks: SamplerBank[];
  },
  deps: {
    deletePadMediaArtifacts: (
      pad: Partial<PadData> & { id: string },
      type?: 'audio' | 'image'
    ) => Promise<void>;
    setBanks: SetState<SamplerBank[]>;
  }
): Promise<void> => {
  const {
    bankId,
    id,
    banks,
  } = input;
  const {
    deletePadMediaArtifacts,
    setBanks,
  } = deps;

  const existingBank = banks.find((bank) => bank.id === bankId);
  const existingPad = existingBank?.pads.find((pad) => pad.id === id);
  try {
    await deletePadMediaArtifacts({
      id,
      audioStorageKey: existingPad?.audioStorageKey,
      audioBackend: existingPad?.audioBackend,
      imageStorageKey: existingPad?.imageStorageKey,
      imageBackend: existingPad?.imageBackend,
    });
  } catch {
  }
  setBanks((prev) => prev.map((bank) => bank.id === bankId ? applyBankContentPolicy({
    ...bank,
    pads: bank.pads.filter((pad) => {
      if (pad.id === id) {
        if (pad.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.audioUrl);
        if (pad.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.imageUrl);
      }
      return pad.id !== id;
    }),
  }) : bank));
};

export const runReorderPadsPipeline = (
  bankId: string,
  fromIndex: number,
  toIndex: number,
  setBanks: SetState<SamplerBank[]>
): void => {
  setBanks((prev) => prev.map((bank) => {
    if (bank.id !== bankId) return bank;
    const sorted = [...bank.pads].sort((a, b) => (a.position || 0) - (b.position || 0));
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved);
    return { ...bank, pads: sorted.map((pad, index) => ({ ...pad, position: index })) };
  }));
};

export const runCreateBankPipeline = (
  input: {
    name: string;
    defaultColor: string;
    currentBankId: string | null;
    isDualMode: boolean;
    profileRole?: string | null;
    creatorEmail?: string | null;
    quotaPolicy: QuotaPolicy;
  },
  deps: {
    banksRef: { current: SamplerBank[] };
    setBanks: SetState<SamplerBank[]>;
    setCurrentBankIdState: SetState<string | null>;
    countOwnedCountedBanks: (banks: SamplerBank[]) => number;
    generateId: () => string;
  }
): void => {
  const {
    name,
    defaultColor,
    currentBankId,
    isDualMode,
    profileRole,
    creatorEmail,
    quotaPolicy,
  } = input;
  const {
    banksRef,
    setBanks,
    setCurrentBankIdState,
    countOwnedCountedBanks,
    generateId,
  } = deps;

  const currentBanks = banksRef.current;
  const isAdminUser = profileRole === 'admin';
  if (!isAdminUser) {
    if (currentBanks.length >= quotaPolicy.deviceTotalBankCap) {
      throw new Error(`You reached your device bank limit (${quotaPolicy.deviceTotalBankCap}). Remove a bank before creating a new one.`);
    }
    const ownedUsed = countOwnedCountedBanks(currentBanks);
    if (ownedUsed >= quotaPolicy.ownedBankQuota) {
      throw new Error(`You reached your owned bank quota (${quotaPolicy.ownedBankQuota}). Import trusted Store/Admin banks or remove an owned bank first. Message us on facebook for expansion.`);
    }
  }

  const maxSort = currentBanks.length > 0 ? Math.max(...currentBanks.map((b) => b.sortOrder || 0)) : -1;
  const newBank: SamplerBank = {
    id: generateId(),
    name,
    defaultColor,
    pads: [],
    createdAt: new Date(),
    sortOrder: maxSort + 1,
    creatorEmail: typeof creatorEmail === 'string' && creatorEmail.trim().length > 0 ? creatorEmail.trim() : undefined,
  };
  const nextBanks = [...currentBanks, newBank];
  banksRef.current = nextBanks;
  setBanks(nextBanks);
  if (!currentBankId && !isDualMode) setCurrentBankIdState(newBank.id);
};

export const runMoveBankUpPipeline = (id: string, setBanks: SetState<SamplerBank[]>): void => {
  setBanks((prev) => {
    const ordered = [...prev]
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((bank, index) => ({ ...bank, sortOrder: index }));
    const idx = ordered.findIndex((bank) => bank.id === id);
    if (idx <= 0) return prev;
    [ordered[idx - 1], ordered[idx]] = [ordered[idx], ordered[idx - 1]];
    return ordered.map((bank, index) => ({ ...bank, sortOrder: index }));
  });
};

export const runMoveBankDownPipeline = (id: string, setBanks: SetState<SamplerBank[]>): void => {
  setBanks((prev) => {
    const ordered = [...prev]
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((bank, index) => ({ ...bank, sortOrder: index }));
    const idx = ordered.findIndex((bank) => bank.id === id);
    if (idx === -1 || idx >= ordered.length - 1) return prev;
    [ordered[idx], ordered[idx + 1]] = [ordered[idx + 1], ordered[idx]];
    return ordered.map((bank, index) => ({ ...bank, sortOrder: index }));
  });
};

export const runTransferPadPipeline = (
  input: {
    padId: string;
    sourceBankId: string;
    targetBankId: string;
    profileRole?: string | null;
    quotaOwnedBankPadCap: number;
  },
  deps: {
    setBanks: SetState<SamplerBank[]>;
    isOwnedCountedBankForQuota: (bank: SamplerBank) => boolean;
  }
): void => {
  const {
    padId,
    sourceBankId,
    targetBankId,
    profileRole,
    quotaOwnedBankPadCap,
  } = input;
  const {
    setBanks,
    isOwnedCountedBankForQuota,
  } = deps;

  setBanks((prev) => {
    const src = prev.find((b) => b.id === sourceBankId);
    const tgt = prev.find((b) => b.id === targetBankId);
    if (!src || !tgt) return prev;
    if (
      profileRole !== 'admin' &&
      isOwnedCountedBankForQuota(tgt) &&
      tgt.pads.length >= quotaOwnedBankPadCap
    ) {
      return prev;
    }
    const pad = src.pads.find((p) => p.id === padId);
    if (!pad) return prev;
    const maxPos = tgt.pads.length > 0 ? Math.max(...tgt.pads.map((p) => p.position || 0)) : -1;
    const upPad: PadData = {
      ...pad,
      position: maxPos + 1,
      contentOrigin: pad.contentOrigin || 'user',
      originPadId: pad.originPadId || pad.id,
      originBankId: pad.originBankId,
      originCatalogItemId: pad.originCatalogItemId,
      originBankTitle: pad.originBankTitle || src.name,
    };
    return prev.map((b) => {
      if (b.id === sourceBankId) return applyBankContentPolicy({ ...b, pads: b.pads.filter((p) => p.id !== padId) });
      if (b.id === targetBankId) {
        return applyBankContentPolicy({
          ...b,
          officialTransferAcknowledged: b.officialTransferAcknowledged || isOfficialPadContent(pad) || b.containsOfficialContent,
          pads: [...b.pads, upPad],
        });
      }
      return b;
    });
  });
};

export const runSetPrimaryBankPipeline = (
  input: {
    id: string | null;
    primaryBankId: string | null;
    secondaryBankId: string | null;
    currentBankId: string | null;
  },
  deps: {
    setCurrentBankIdState: SetState<string | null>;
    setPrimaryBankIdState: SetState<string | null>;
    setSecondaryBankIdState: SetState<string | null>;
  }
): void => {
  const { id, primaryBankId, secondaryBankId, currentBankId } = input;
  const { setCurrentBankIdState, setPrimaryBankIdState, setSecondaryBankIdState } = deps;

  if (id === null) {
    if (primaryBankId) setCurrentBankIdState(primaryBankId);
    setPrimaryBankIdState(null);
    setSecondaryBankIdState(null);
    return;
  }
  if (id === primaryBankId) {
    setCurrentBankIdState(primaryBankId);
    setPrimaryBankIdState(null);
    setSecondaryBankIdState(null);
    return;
  }
  setPrimaryBankIdState(id);
  if (id === secondaryBankId) setSecondaryBankIdState(null);
  if (currentBankId && currentBankId !== id) setSecondaryBankIdState(currentBankId);
  setCurrentBankIdState(null);
};

export const runSetSecondaryBankPipeline = (
  input: { id: string | null; primaryBankId: string | null },
  setSecondaryBankIdState: SetState<string | null>
): void => {
  if (input.primaryBankId && input.id !== input.primaryBankId) {
    setSecondaryBankIdState(input.id);
  }
};

export const runSetCurrentBankPipeline = (
  input: { id: string | null; isDualMode: boolean },
  setCurrentBankIdState: SetState<string | null>
): void => {
  if (!input.isDualMode) setCurrentBankIdState(input.id);
};

export const runUpdateBankPipeline = (
  id: string,
  updates: Partial<SamplerBank>,
  setBanks: SetState<SamplerBank[]>
): void => {
  setBanks((prev) =>
    prev.map((bank) => {
      if (bank.id !== id) return bank;
      const next: SamplerBank = { ...bank, ...updates };
      if (bank.shortcutKey && updates.shortcutKey === undefined) {
        next.disableDefaultBankShortcutLayout = true;
      } else if (typeof updates.shortcutKey === 'string' && updates.shortcutKey.trim().length > 0) {
        next.disableDefaultBankShortcutLayout = false;
      }
      return applyBankContentPolicy(next);
    })
  );
};

export const runDeleteBankPipeline = async (
  input: {
    id: string;
    banks: SamplerBank[];
    primaryBankId: string | null;
    secondaryBankId: string | null;
    currentBankId: string | null;
  },
  deps: {
    deletePadMediaArtifacts: (
      pad: Partial<PadData> & { id: string },
      type?: 'audio' | 'image'
    ) => Promise<void>;
    setBanks: SetState<SamplerBank[]>;
    setPrimaryBankIdState: SetState<string | null>;
    setSecondaryBankIdState: SetState<string | null>;
    setCurrentBankIdState: SetState<string | null>;
    generateId: () => string;
    defaultBankName: string;
    defaultBankColor: string;
  }
): Promise<void> => {
  const {
    id,
    primaryBankId,
    secondaryBankId,
    currentBankId,
  } = input;
  const {
    deletePadMediaArtifacts,
    setBanks,
    setPrimaryBankIdState,
    setSecondaryBankIdState,
    setCurrentBankIdState,
    generateId,
    defaultBankName,
    defaultBankColor,
  } = deps;

  setBanks((prev) => {
    const toDel = prev.find((b) => b.id === id);
    if (toDel) {
      if (toDel.bankMetadata?.thumbnailUrl?.startsWith('blob:')) {
        try { URL.revokeObjectURL(toDel.bankMetadata.thumbnailUrl); } catch {}
      }
      toDel.pads.forEach(async (pad) => {
        try {
          await deletePadMediaArtifacts(pad);
          if (pad.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.audioUrl);
          if (pad.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.imageUrl);
        } catch {}
      });
    }
    const newBanks = prev.filter((b) => b.id !== id);
    if (id === primaryBankId) {
      setPrimaryBankIdState(null);
      setSecondaryBankIdState(null);
      if (newBanks.length > 0) setCurrentBankIdState(newBanks[0].id);
    } else if (id === secondaryBankId) {
      setSecondaryBankIdState(null);
    } else if (id === currentBankId) {
      setCurrentBankIdState(newBanks.length > 0 ? newBanks[0].id : null);
    }
    if (newBanks.length === 0) {
      const d = {
        id: generateId(),
        name: defaultBankName,
        defaultColor: defaultBankColor,
        pads: [],
        createdAt: new Date(),
        sortOrder: 0,
        sourceBankId: 'vdjv-default-bank-source',
      };
      setCurrentBankIdState(d.id);
      return [d];
    }
    return newBanks;
  });
};
