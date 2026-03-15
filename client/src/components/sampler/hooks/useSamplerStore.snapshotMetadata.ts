import type { AppSettings, MappingExport } from '../SamplerPadApp.shared';
import type { BankMetadata, PadData, SamplerBank } from '../types/sampler';
import { DEFAULT_BANK_SOURCE_ID, isDefaultBankIdentity } from './useSamplerStore.bankIdentity';
import { getPadContentOrigin, isOfficialBankSource, isOfficialPadContent } from './useSamplerStore.provenance';

export type SnapshotPadRecord = Omit<
  PadData,
  | 'audioUrl'
  | 'imageUrl'
  | 'imageData'
  | 'audioStorageKey'
  | 'imageStorageKey'
  | 'preparedAudioUrl'
  | 'preparedAudioStorageKey'
  | 'preparedAudioBackend'
  | 'preparedAudioKind'
  | 'preparedSourceSignature'
  | 'preparedStatus'
  | 'preparedBytes'
  | 'preparedAt'
  | 'preparedDurationMs'
> & {
  restoreAssetKind: NonNullable<PadData['restoreAssetKind']>;
  missingMediaExpected: boolean;
  missingImageExpected: boolean;
};

export type SnapshotBankRecord = Omit<SamplerBank, 'createdAt' | 'pads'> & {
  createdAt: string;
  restoreKind: NonNullable<SamplerBank['restoreKind']>;
  restoreStatus: NonNullable<SamplerBank['restoreStatus']>;
  pads: SnapshotPadRecord[];
};

export type SamplerMetadataSnapshot = {
  version: 1;
  exportedAt: string;
  userId: string;
  settings: Record<string, unknown>;
  mappings: Record<string, unknown>;
  state: {
    primaryBankId: string | null;
    secondaryBankId: string | null;
    currentBankId: string | null;
  };
  banks: SnapshotBankRecord[];
};

const cloneBankMetadataForSnapshot = (metadata: BankMetadata | undefined): BankMetadata | undefined => {
  if (!metadata) return undefined;
  return {
    ...metadata,
    thumbnailUrl: undefined,
    remoteSnapshotThumbnailUrl:
      typeof metadata.thumbnailUrl === 'string' && metadata.thumbnailUrl.trim().length > 0
        ? metadata.thumbnailUrl
        : metadata.remoteSnapshotThumbnailUrl,
  };
};

export const getSnapshotBankRestoreKind = (bank: SamplerBank): SnapshotBankRecord['restoreKind'] => {
  if (isDefaultBankIdentity(bank)) return 'default_bank';
  if (isOfficialBankSource(bank)) return 'paid_bank';
  return 'custom_bank';
};

export const getSnapshotPadRestoreKind = (
  bank: SamplerBank,
  pad: PadData
): SnapshotPadRecord['restoreAssetKind'] => {
  if (getPadContentOrigin(pad) === 'user') return 'custom_local_media';
  if (
    bank.bankMetadata?.defaultBankSource ||
    bank.sourceBankId === DEFAULT_BANK_SOURCE_ID ||
    pad.originBankId === DEFAULT_BANK_SOURCE_ID
  ) {
    return 'default_asset';
  }
  return 'paid_asset';
};

const computeSnapshotBankRestoreStatus = (
  restoreKind: SnapshotBankRecord['restoreKind'],
  pads: SnapshotPadRecord[]
): SnapshotBankRecord['restoreStatus'] => {
  if (restoreKind === 'paid_bank') return 'needs_download';
  const missingCustom = pads.some((pad) => pad.restoreAssetKind === 'custom_local_media' && pad.missingMediaExpected);
  const missingPaid = pads.some((pad) => pad.restoreAssetKind === 'paid_asset' && pad.missingMediaExpected);

  if (restoreKind === 'default_bank') {
    if (missingPaid || missingCustom) return 'partially_restored';
    return 'ready';
  }

  const missingOfficial = pads.some((pad) => pad.restoreAssetKind !== 'custom_local_media');
  if (missingCustom && missingOfficial) return 'partially_restored';
  if (missingCustom || missingOfficial) return 'missing_media';
  return 'ready';
};

export const buildSamplerMetadataSnapshot = (input: {
  userId: string;
  settings: Record<string, unknown>;
  mappings: Record<string, unknown>;
  state: {
    primaryBankId: string | null;
    secondaryBankId: string | null;
    currentBankId: string | null;
  };
  banks: SamplerBank[];
}): SamplerMetadataSnapshot => {
  const banks = input.banks.map((bank) => {
    const restoreKind = getSnapshotBankRestoreKind(bank);
    const pads: SnapshotPadRecord[] = bank.pads.map((pad) => {
      const restoreAssetKind = getSnapshotPadRestoreKind(bank, pad);
      const isCustomMedia = restoreAssetKind === 'custom_local_media';
      const expectsImage = Boolean(
        pad.hasImageAsset ||
          pad.imageStorageKey ||
          pad.imageBackend ||
          (typeof pad.imageUrl === 'string' && pad.imageUrl.trim().length > 0)
      );
      return {
        ...pad,
        audioUrl: undefined,
        imageUrl: undefined,
        imageData: undefined,
        audioStorageKey: undefined,
        imageStorageKey: undefined,
        audioBackend: undefined,
        imageBackend: undefined,
        preparedAudioUrl: undefined,
        preparedAudioStorageKey: undefined,
        preparedAudioBackend: undefined,
        preparedAudioKind: undefined,
        preparedSourceSignature: undefined,
        preparedStatus: undefined,
        preparedBytes: undefined,
        preparedAt: undefined,
        preparedDurationMs: undefined,
        restoreAssetKind,
        missingMediaExpected: isCustomMedia,
        missingImageExpected: isCustomMedia && expectsImage,
        sourcePadId: pad.originPadId || pad.id,
        sourceCatalogItemId: pad.originCatalogItemId || bank.bankMetadata?.catalogItemId,
      };
    }) as SnapshotPadRecord[];
    return {
      ...bank,
      createdAt: bank.createdAt instanceof Date ? bank.createdAt.toISOString() : String(bank.createdAt),
      bankMetadata: cloneBankMetadataForSnapshot(bank.bankMetadata),
      pads,
      restoreKind,
      restoreStatus: computeSnapshotBankRestoreStatus(restoreKind, pads),
    };
  });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    userId: input.userId,
    settings: input.settings,
    mappings: input.mappings,
    state: input.state,
    banks,
  };
};

export const reviveSamplerMetadataSnapshot = (raw: any): SamplerMetadataSnapshot | null => {
  if (!raw || typeof raw !== 'object' || Number(raw.version) !== 1 || !Array.isArray(raw.banks)) return null;
  const banks: SnapshotBankRecord[] = raw.banks.map((bank: any) => {
    const pads: SnapshotPadRecord[] = Array.isArray(bank?.pads)
      ? bank.pads.map((pad: any, index: number) => ({
          ...pad,
          position: typeof pad?.position === 'number' ? pad.position : index,
          restoreAssetKind:
            pad?.restoreAssetKind === 'default_asset' || pad?.restoreAssetKind === 'paid_asset'
              ? pad.restoreAssetKind
              : 'custom_local_media',
          missingMediaExpected: pad?.missingMediaExpected !== false,
          missingImageExpected: pad?.missingImageExpected === true,
        }))
      : [];
    const restoreKind =
      bank?.restoreKind === 'default_bank' || bank?.restoreKind === 'paid_bank'
        ? bank.restoreKind
        : 'custom_bank';
    return {
      ...bank,
      createdAt: typeof bank?.createdAt === 'string' ? bank.createdAt : new Date().toISOString(),
      pads,
      restoreKind,
      restoreStatus:
        bank?.restoreStatus === 'needs_download' ||
        bank?.restoreStatus === 'missing_media' ||
        bank?.restoreStatus === 'partially_restored'
          ? bank.restoreStatus
          : 'ready',
    };
  });

  return {
    version: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    settings: typeof raw.settings === 'object' && raw.settings ? raw.settings : {},
    mappings: typeof raw.mappings === 'object' && raw.mappings ? raw.mappings : {},
    state: typeof raw.state === 'object' && raw.state ? raw.state : {
      primaryBankId: null,
      secondaryBankId: null,
      currentBankId: null,
    },
    banks,
  };
};

export const materializeSnapshotBanks = (
  snapshot: SamplerMetadataSnapshot,
  existingBanks: SamplerBank[] = []
): SamplerBank[] => {
  const existingByIdentity = new Map<string, SamplerBank>();
  existingBanks.forEach((bank) => {
    const key = bank.bankMetadata?.bankId || bank.sourceBankId || bank.id;
    existingByIdentity.set(key, bank);
  });

  return snapshot.banks.map((bank) => {
    const identityKey = bank.bankMetadata?.bankId || bank.sourceBankId || bank.id;
    const existing = existingByIdentity.get(identityKey);
    return {
      ...bank,
      createdAt: new Date(bank.createdAt),
      remoteSnapshotApplied: true,
      bankMetadata: bank.bankMetadata
        ? {
            ...bank.bankMetadata,
            thumbnailUrl: existing?.bankMetadata?.thumbnailUrl || bank.bankMetadata.remoteSnapshotThumbnailUrl,
          }
        : bank.bankMetadata,
      pads: bank.pads.map((pad) => {
        const existingPad = existing?.pads.find((candidate) => candidate.id === pad.id || candidate.originPadId === pad.sourcePadId);
        if (existingPad?.audioUrl) {
          return {
            ...pad,
            ...existingPad,
            restoreAssetKind: pad.restoreAssetKind,
            missingMediaExpected: false,
            missingImageExpected: false,
          };
        }
        return {
          ...pad,
          audioUrl: '',
          imageUrl: undefined,
          imageData: undefined,
          audioStorageKey: undefined,
          imageStorageKey: undefined,
          audioBackend: undefined,
          imageBackend: undefined,
          hasImageAsset: pad.restoreAssetKind === 'custom_local_media' ? false : pad.hasImageAsset,
        };
      }),
    };
  });
};

export const deriveSnapshotRestoreStatus = (bank: SamplerBank): NonNullable<SamplerBank['restoreStatus']> => {
  const hasMissingCustom = bank.pads.some((pad) => pad.restoreAssetKind === 'custom_local_media' && pad.missingMediaExpected);
  const hasMissingDefaultOfficial = bank.pads.some(
    (pad) => pad.restoreAssetKind === 'default_asset' && !pad.audioUrl
  );
  const hasMissingPaidOfficial = bank.pads.some(
    (pad) => pad.restoreAssetKind === 'paid_asset' && !pad.audioUrl
  );

  if (bank.restoreKind === 'paid_bank') {
    if (hasMissingDefaultOfficial || hasMissingPaidOfficial) return 'needs_download';
    if (hasMissingCustom) return 'partially_restored';
    return 'ready';
  }

  if (bank.restoreKind === 'default_bank') {
    if (hasMissingPaidOfficial || hasMissingCustom) return 'partially_restored';
    return 'ready';
  }

  const hasMissingOfficial = hasMissingDefaultOfficial || hasMissingPaidOfficial;
  if (hasMissingCustom && hasMissingOfficial) return 'partially_restored';
  if (hasMissingCustom || hasMissingOfficial) return 'missing_media';
  return 'ready';
};

export const applyResolvedOfficialPadMedia = (banks: SamplerBank[]): SamplerBank[] => {
  const sourcePadsByKey = new Map<string, PadData>();
  banks.forEach((bank) => {
    bank.pads.forEach((pad) => {
      if (!pad.audioUrl) return;
      const sourceBankKey = pad.originBankId || bank.bankMetadata?.bankId || bank.sourceBankId || bank.id;
      const sourcePadKey = pad.originPadId || pad.id;
      sourcePadsByKey.set(`${sourceBankKey}:${sourcePadKey}`, pad);
      if (pad.originCatalogItemId) {
        sourcePadsByKey.set(`catalog:${pad.originCatalogItemId}:${sourcePadKey}`, pad);
      }
      if (isDefaultBankIdentity(bank)) {
        sourcePadsByKey.set(`default:${sourcePadKey}`, pad);
      }
    });
  });

  return banks.map((bank) => {
    let changed = false;
    const nextPads = bank.pads.map((pad) => {
      if (!pad.missingMediaExpected || pad.restoreAssetKind === 'custom_local_media') return pad;
      const sourceKey = pad.restoreAssetKind === 'default_asset'
        ? `default:${pad.sourcePadId || pad.originPadId || pad.id}`
        : (pad.originCatalogItemId || pad.sourceCatalogItemId)
          ? `catalog:${pad.originCatalogItemId || pad.sourceCatalogItemId}:${pad.sourcePadId || pad.originPadId || pad.id}`
          : `${pad.originBankId || bank.bankMetadata?.bankId || bank.sourceBankId || bank.id}:${pad.sourcePadId || pad.originPadId || pad.id}`;
      const sourcePad = sourcePadsByKey.get(sourceKey);
      if (!sourcePad?.audioUrl) return pad;
      changed = true;
      return {
        ...pad,
        audioUrl: sourcePad.audioUrl,
        audioStorageKey: sourcePad.audioStorageKey,
        audioBackend: sourcePad.audioBackend,
        imageUrl: sourcePad.imageUrl,
        imageStorageKey: sourcePad.imageStorageKey,
        imageBackend: sourcePad.imageBackend,
        hasImageAsset: sourcePad.hasImageAsset,
        missingMediaExpected: false,
        missingImageExpected: false,
      };
    });
    if (!changed) return bank;
    return {
      ...bank,
      pads: nextPads,
      restoreStatus: deriveSnapshotRestoreStatus({ ...bank, pads: nextPads }),
    };
  });
};

export const mergeRecoveredPadMedia = (
  pad: PadData,
  input: {
    audioUrl: string;
    audioStorageKey?: string;
    audioBackend?: 'native' | 'idb';
  }
): PadData => ({
  ...pad,
  audioUrl: input.audioUrl,
  audioStorageKey: input.audioStorageKey,
  audioBackend: input.audioBackend,
  imageUrl: undefined,
  imageStorageKey: undefined,
  imageBackend: undefined,
  hasImageAsset: false,
  missingMediaExpected: false,
  missingImageExpected: false,
});

export type RemoteSnapshotPromptState = {
  snapshot: SamplerMetadataSnapshot;
  summary: {
    bankCount: number;
    missingCustomPads: number;
    paidBanks: number;
  };
};

export const summarizeRemoteSnapshotPrompt = (snapshot: SamplerMetadataSnapshot): RemoteSnapshotPromptState['summary'] => ({
  bankCount: snapshot.banks.length,
  missingCustomPads: snapshot.banks.reduce(
    (sum, bank) => sum + bank.pads.filter((pad) => pad.restoreAssetKind === 'custom_local_media').length,
    0
  ),
  paidBanks: snapshot.banks.filter((bank) => bank.restoreKind === 'paid_bank').length,
});

export type SnapshotSettingsPayload = Partial<AppSettings> | Record<string, unknown>;
export type SnapshotMappingsPayload = Partial<MappingExport> | Record<string, unknown>;
