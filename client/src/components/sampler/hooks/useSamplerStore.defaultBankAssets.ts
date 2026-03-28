import type { BankMetadata, PadData, SamplerBank } from '../types/sampler';
import { applyBankContentPolicy } from './useSamplerStore.provenance';

const getDefaultBankAssetBasePath = (): string => {
  const isElectron = window.navigator.userAgent.includes('Electron');
  const isAndroid = /Android/.test(navigator.userAgent);

  if (isElectron) return './assets/DEFAULT_BANK';
  if (isAndroid) return '/assets/DEFAULT_BANK';
  return '/assets/DEFAULT_BANK';
};

const defaultBankAssetJsonCache = new Map<string, unknown | null>();
const defaultBankAssetJsonInFlight = new Map<string, Promise<unknown | null>>();

const fetchDefaultBankAssetJson = async <T,>(
  fileName: string,
  required: boolean = true
): Promise<T | null> => {
  if (defaultBankAssetJsonCache.has(fileName)) {
    return (defaultBankAssetJsonCache.get(fileName) as T | null) ?? null;
  }
  const inFlight = defaultBankAssetJsonInFlight.get(fileName);
  if (inFlight) {
    const shared = await inFlight;
    return (shared as T | null) ?? null;
  }

  if (typeof window === 'undefined') {
    if (required) throw new Error(`Default bank asset missing: ${fileName}`);
    return null;
  }

  const request = (async () => {
    const basePath = getDefaultBankAssetBasePath();
    const candidates = new Set<string>([`${basePath}/${fileName}`]);
    if (/Android/.test(navigator.userAgent) && basePath.startsWith('/')) {
      candidates.add(`./assets/DEFAULT_BANK/${fileName}`);
    }
    if (window.navigator.userAgent.includes('Electron') && basePath.startsWith('./')) {
      candidates.add(`/assets/DEFAULT_BANK/${fileName}`);
    }

    for (const assetUrl of candidates) {
      try {
        const response = await fetch(assetUrl);
        if (!response.ok) continue;
        const parsed = await response.json() as T;
        defaultBankAssetJsonCache.set(fileName, parsed);
        return parsed;
      } catch {
      }
    }

    if (required) throw new Error(`Default bank asset missing: ${fileName}`);
    defaultBankAssetJsonCache.set(fileName, null);
    return null;
  })();

  defaultBankAssetJsonInFlight.set(fileName, request);
  try {
    const resolved = await request;
    return (resolved as T | null) ?? null;
  } finally {
    defaultBankAssetJsonInFlight.delete(fileName);
  }
};

export const loadDefaultBankFromAssetsPipeline = async (
  allowAudio: boolean,
  deps: {
    generateId: () => string;
    defaultBankSourceId: string;
  }
): Promise<SamplerBank> => {
  const {
    generateId,
    defaultBankSourceId,
  } = deps;

  const basePath = getDefaultBankAssetBasePath();
  const bankData = await fetchDefaultBankAssetJson<any>('bank.json');
  const metadata = await fetchDefaultBankAssetJson<BankMetadata>('metadata.json', false);

  const defaultColor =
    (typeof metadata?.color === 'string' && metadata.color.trim().length > 0 ? metadata.color : null) ||
    (typeof bankData?.defaultColor === 'string' && bankData.defaultColor.trim().length > 0 ? bankData.defaultColor : null) ||
    '#3b82f6';

  const toAssetUrl = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return undefined;
    return `${basePath}/${normalized}`;
  };
  const toNumber = (value: unknown, fallback: number = 0): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const toTriggerMode = (value: unknown): PadData['triggerMode'] => (
    value === 'toggle' || value === 'hold' || value === 'stutter' || value === 'unmute' ? value : 'toggle'
  );
  const toPlaybackMode = (value: unknown): PadData['playbackMode'] => (
    value === 'once' || value === 'loop' || value === 'stopper' ? value : 'once'
  );

  const sourcePads = Array.isArray(bankData?.pads) ? bankData.pads : [];
  const pads: PadData[] = sourcePads.map((pad: any, index: number) => {
    const resolvedPadId =
      typeof pad?.id === 'string' && pad.id.trim().length > 0 ? pad.id : generateId();
    const audioAssetUrl = toAssetUrl(pad?.audioUrl);
    const imageAssetUrl = toAssetUrl(pad?.imageUrl);
    const hotcues = Array.isArray(pad?.savedHotcuesMs)
      ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
      : [null, null, null, null];

    return {
      id: resolvedPadId,
      name: typeof pad?.name === 'string' && pad.name.trim().length > 0 ? pad.name : 'Untitled Pad',
      artist: typeof pad?.artist === 'string' && pad.artist.trim().length > 0 ? pad.artist.trim() : undefined,
      audioUrl: allowAudio ? (audioAssetUrl || '') : '',
      imageUrl: imageAssetUrl,
      audioStorageKey: undefined,
      audioBackend: undefined,
      imageStorageKey: undefined,
      imageBackend: undefined,
      hasImageAsset: Boolean(imageAssetUrl),
      imageData: undefined,
      shortcutKey: typeof pad?.shortcutKey === 'string' ? pad.shortcutKey : undefined,
      midiNote: typeof pad?.midiNote === 'number' ? pad.midiNote : undefined,
      midiCC: typeof pad?.midiCC === 'number' ? pad.midiCC : undefined,
      ignoreChannel: Boolean(pad?.ignoreChannel),
      color: typeof pad?.color === 'string' && pad.color.trim().length > 0 ? pad.color : defaultColor,
      triggerMode: toTriggerMode(pad?.triggerMode),
      playbackMode: toPlaybackMode(pad?.playbackMode),
      padGroup: typeof pad?.padGroup === 'number' && Number.isFinite(pad.padGroup) && pad.padGroup > 0 ? Math.trunc(pad.padGroup) : undefined,
      padGroupUniversal: pad?.padGroupUniversal === true,
      volume: Math.max(0, Math.min(1, toNumber(pad?.volume, 1))),
      gainDb: toNumber(pad?.gainDb, 0),
      gain: Math.max(0, toNumber(pad?.gain, 1)),
      fadeInMs: Math.max(0, toNumber(pad?.fadeInMs, 0)),
      fadeOutMs: Math.max(0, toNumber(pad?.fadeOutMs, 0)),
      startTimeMs: Math.max(0, toNumber(pad?.startTimeMs, 0)),
      endTimeMs: Math.max(0, toNumber(pad?.endTimeMs, 0)),
      pitch: toNumber(pad?.pitch, 0),
      tempoPercent: toNumber(pad?.tempoPercent, 0),
      keyLock: typeof pad?.keyLock === 'boolean' ? pad.keyLock : true,
      position: Number.isFinite(Number(pad?.position)) ? Number(pad.position) : index,
      savedHotcuesMs: hotcues,
      audioBytes: typeof pad?.audioBytes === 'number' ? pad.audioBytes : undefined,
      audioDurationMs: typeof pad?.audioDurationMs === 'number' ? pad.audioDurationMs : undefined,
      contentOrigin: 'official_admin',
      originBankId: defaultBankSourceId,
      originPadId: resolvedPadId,
      originBankTitle: 'Default Bank',
    };
  });

  const createdAtCandidate = new Date(bankData?.createdAt || Date.now());
  const createdAt = Number.isNaN(createdAtCandidate.getTime()) ? new Date() : createdAtCandidate;
  const parsedSortOrder = Number(bankData?.sortOrder);
  const sortOrder = Number.isFinite(parsedSortOrder) ? parsedSortOrder : 0;

  const bankMetadata: BankMetadata | undefined = metadata ? {
    password: Boolean(metadata.password),
    transferable: true,
    exportable: typeof metadata.exportable === 'boolean' ? metadata.exportable : undefined,
    adminExportToken: metadata.adminExportToken,
    adminExportTokenKid: metadata.adminExportTokenKid,
    adminExportTokenIssuedAt: metadata.adminExportTokenIssuedAt,
    adminExportTokenExpiresAt: metadata.adminExportTokenExpiresAt,
    adminExportTokenBankSha256: metadata.adminExportTokenBankSha256,
    trustedAdminExport: Boolean(metadata.trustedAdminExport),
    entitlementToken: metadata.entitlementToken,
    entitlementTokenKid: metadata.entitlementTokenKid,
    entitlementTokenIssuedAt: metadata.entitlementTokenIssuedAt,
    entitlementTokenExpiresAt: metadata.entitlementTokenExpiresAt,
    entitlementTokenVerified: Boolean(metadata.entitlementTokenVerified),
    bankId: metadata.bankId,
    catalogItemId: metadata.catalogItemId,
    catalogSha256: metadata.catalogSha256,
    title: metadata.title || 'Default Bank',
    description: metadata.description || '',
    color: metadata.color || defaultColor,
    thumbnailUrl: metadata.thumbnailUrl,
    thumbnailRemoved: typeof metadata.thumbnailRemoved === 'boolean' ? metadata.thumbnailRemoved : undefined,
    thumbnailAssetPath: metadata.thumbnailAssetPath,
    hideThumbnailPreview: typeof metadata.hideThumbnailPreview === 'boolean' ? metadata.hideThumbnailPreview : undefined,
    defaultBankSource: 'assets',
  } : undefined;

  return applyBankContentPolicy({
    id: typeof bankData?.id === 'string' && bankData.id.trim().length > 0 ? bankData.id : generateId(),
    name: 'Default Bank',
    defaultColor,
    pads,
    createdAt,
    sortOrder,
    sourceBankId: defaultBankSourceId,
    isAdminBank: bankMetadata?.password === true,
    transferable: true,
    exportable: bankMetadata?.exportable ?? true,
    bankMetadata,
  });
};
