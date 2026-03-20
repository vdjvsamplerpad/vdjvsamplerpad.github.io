import JSZip, { type JSZipObject } from 'jszip';
import { extractBankMetadata } from '@/lib/bank-utils';
import { edgeFunctionUrl } from '@/lib/edge-api';
import type { BankMetadata, PadData, SamplerBank } from '../types/sampler';
import { applyBankContentPolicy } from './useSamplerStore.provenance';
import { assertSafeBankImportArchive, normalizeArchiveAssetPath } from './useSamplerStore.importUtils';

type MediaBackend = 'native' | 'idb';

export const DEFAULT_BANK_RELEASE_META_STORAGE_KEY = 'vdjv-default-bank-release-meta';
export const DEFAULT_BANK_RELEASE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface DefaultBankReleaseManifest {
  id: string;
  version: number;
  sourceBankTitle: string;
  sourceBankPadCount: number;
  fileSizeBytes: number;
  fileSha256: string | null;
  minAppVersion: string | null;
  publishedAt: string | null;
  releaseNotes: string | null;
}

export interface DefaultBankReleaseMetaState {
  manifest: DefaultBankReleaseManifest | null;
  lastCheckedAt: number;
}

export interface DefaultBankReleaseDownload {
  release: DefaultBankReleaseManifest;
  downloadUrl: string;
  downloadExpiresAt: string | null;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseManifest = (value: unknown): DefaultBankReleaseManifest | null => {
  if (!isObjectRecord(value)) return null;
  const version = Number(value.version || 0);
  if (!Number.isFinite(version) || version <= 0) return null;
  return {
    id: typeof value.id === 'string' ? value.id : '',
    version: Math.floor(version),
    sourceBankTitle: typeof value.sourceBankTitle === 'string' && value.sourceBankTitle.trim()
      ? value.sourceBankTitle.trim()
      : 'Default Bank',
    sourceBankPadCount: Math.max(0, Math.floor(Number(value.sourceBankPadCount || 0))),
    fileSizeBytes: Math.max(0, Math.floor(Number(value.fileSizeBytes || 0))),
    fileSha256: typeof value.fileSha256 === 'string' && value.fileSha256.trim() ? value.fileSha256.trim() : null,
    minAppVersion: typeof value.minAppVersion === 'string' && value.minAppVersion.trim() ? value.minAppVersion.trim() : null,
    publishedAt: typeof value.publishedAt === 'string' && value.publishedAt.trim() ? value.publishedAt.trim() : null,
    releaseNotes: typeof value.releaseNotes === 'string' && value.releaseNotes.trim() ? value.releaseNotes.trim() : null,
  };
};

export const readDefaultBankReleaseMetaState = (): DefaultBankReleaseMetaState => {
  if (typeof window === 'undefined') {
    return { manifest: null, lastCheckedAt: 0 };
  }
  try {
    const raw = window.localStorage.getItem(DEFAULT_BANK_RELEASE_META_STORAGE_KEY);
    if (!raw) return { manifest: null, lastCheckedAt: 0 };
    const parsed = JSON.parse(raw) as { manifest?: unknown; lastCheckedAt?: unknown };
    return {
      manifest: parseManifest(parsed?.manifest) || null,
      lastCheckedAt: Number.isFinite(Number(parsed?.lastCheckedAt)) ? Number(parsed?.lastCheckedAt) : 0,
    };
  } catch {
    return { manifest: null, lastCheckedAt: 0 };
  }
};

export const writeDefaultBankReleaseMetaState = (value: DefaultBankReleaseMetaState): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEFAULT_BANK_RELEASE_META_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best effort only.
  }
};

export const fetchDefaultBankReleaseManifest = async (): Promise<DefaultBankReleaseManifest | null> => {
  const response = await fetch(edgeFunctionUrl('store-api', 'default-bank/manifest'), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });
  const payload = await response.json().catch(() => ({} as { ok?: boolean; error?: string; manifest?: unknown; data?: { manifest?: unknown } }));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Default bank manifest request failed (${response.status})`);
  }
  const manifest = parseManifest(isObjectRecord(payload?.data) ? payload.data.manifest : payload?.manifest);
  return manifest || null;
};

export const fetchDefaultBankReleaseDownload = async (): Promise<DefaultBankReleaseDownload> => {
  const response = await fetch(edgeFunctionUrl('store-api', 'default-bank/download'), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });
  const payload = await response.json().catch(() => ({} as { ok?: boolean; error?: string; release?: unknown; downloadUrl?: unknown; downloadExpiresAt?: unknown; data?: Record<string, unknown> }));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Default bank download request failed (${response.status})`);
  }
  const data = isObjectRecord(payload?.data) ? payload.data : payload;
  const release = parseManifest(data?.release);
  const downloadUrl = typeof data?.downloadUrl === 'string' ? data.downloadUrl : '';
  const downloadExpiresAt = typeof data?.downloadExpiresAt === 'string' ? data.downloadExpiresAt : null;
  if (!release || !downloadUrl) {
    throw new Error('Default bank download payload is missing release data.');
  }
  return {
    release,
    downloadUrl,
    downloadExpiresAt,
  };
};

export const shouldRefreshDefaultBankRelease = (
  localManifest: DefaultBankReleaseManifest | null,
  remoteManifest: DefaultBankReleaseManifest | null
): boolean => {
  if (!remoteManifest) return false;
  if (!localManifest) return true;
  if (localManifest.version !== remoteManifest.version) return true;
  return (localManifest.fileSha256 || null) !== (remoteManifest.fileSha256 || null);
};

export const installDefaultBankReleaseArchive = async (
  input: {
    manifest: DefaultBankReleaseManifest;
    archiveBlob: Blob;
    defaultBankSourceId: string;
  },
  deps: {
    generateId: () => string;
    storeFile: (
      id: string,
      file: File,
      type: 'audio' | 'image'
    ) => Promise<{ storageKey?: string; backend: MediaBackend }>;
    yieldToMainThread: () => Promise<void>;
  }
): Promise<SamplerBank> => {
  const { manifest, archiveBlob, defaultBankSourceId } = input;
  const { generateId, storeFile, yieldToMainThread } = deps;

  const contents = await new JSZip().loadAsync(await archiveBlob.arrayBuffer());
  assertSafeBankImportArchive(contents);

  const bankJsonFile = contents.file('bank.json');
  if (!bankJsonFile) {
    throw new Error('Default bank release archive is missing bank.json.');
  }

  const bankJsonText = await bankJsonFile.async('string');
  const bankData = JSON.parse(bankJsonText);
  if (!bankData || typeof bankData !== 'object' || !Array.isArray(bankData.pads)) {
    throw new Error('Default bank release archive is invalid.');
  }

  const metadata = await extractBankMetadata(contents);
  const defaultColor =
    (typeof metadata?.color === 'string' && metadata.color.trim() ? metadata.color.trim() : null) ||
    (typeof bankData?.defaultColor === 'string' && bankData.defaultColor.trim() ? bankData.defaultColor.trim() : null) ||
    '#3b82f6';

  const resolveArchiveMediaFile = (pad: Record<string, unknown>, kind: 'audio' | 'image'): JSZipObject | null => {
    const rawPath = kind === 'audio' ? pad.audioUrl : pad.imageUrl;
    if (typeof rawPath === 'string' && rawPath.trim()) {
      const normalizedPath = normalizeArchiveAssetPath(rawPath);
      if (normalizedPath) {
        const exact = contents.file(normalizedPath);
        if (exact) return exact;
      }
    }
    const padId = typeof pad.id === 'string' ? pad.id : '';
    const legacyPath = kind === 'audio' ? `audio/${padId}.audio` : `images/${padId}.image`;
    return contents.file(legacyPath);
  };

  const toNumber = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const toTriggerMode = (value: unknown): PadData['triggerMode'] => (
    value === 'toggle' || value === 'hold' || value === 'stutter' || value === 'unmute' ? value : 'toggle'
  );
  const toPlaybackMode = (value: unknown): PadData['playbackMode'] => (
    value === 'once' || value === 'loop' || value === 'stopper' ? value : 'once'
  );

  const pads: PadData[] = [];
  for (let index = 0; index < bankData.pads.length; index += 1) {
    const sourcePad = isObjectRecord(bankData.pads[index]) ? bankData.pads[index] : {};
    const padId = typeof sourcePad.id === 'string' && sourcePad.id.trim() ? sourcePad.id.trim() : generateId();
    const audioFile = resolveArchiveMediaFile(sourcePad, 'audio');
    const imageFile = resolveArchiveMediaFile(sourcePad, 'image');

    let audioStorageKey: string | undefined;
    let imageStorageKey: string | undefined;
    let audioBackend: MediaBackend | undefined;
    let imageBackend: MediaBackend | undefined;
    let hasImageAsset = false;

    if (audioFile) {
      const audioBlob = await audioFile.async('blob');
      if (audioBlob.size > 0) {
        const storedAudio = await storeFile(
          padId,
          new File([audioBlob], `${padId}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
          'audio'
        );
        audioStorageKey = storedAudio.storageKey;
        audioBackend = storedAudio.backend;
      }
    }

    if (imageFile) {
      const imageBlob = await imageFile.async('blob');
      if (imageBlob.size > 0) {
        hasImageAsset = true;
        const storedImage = await storeFile(
          padId,
          new File([imageBlob], `${padId}.image`, { type: imageBlob.type || 'application/octet-stream' }),
          'image'
        );
        imageStorageKey = storedImage.storageKey;
        imageBackend = storedImage.backend;
      }
    }

    pads.push({
      id: padId,
      name: typeof sourcePad.name === 'string' && sourcePad.name.trim() ? sourcePad.name.trim() : 'Untitled Pad',
      artist: typeof sourcePad.artist === 'string' && sourcePad.artist.trim() ? sourcePad.artist.trim() : undefined,
      audioUrl: '',
      imageUrl: '',
      audioStorageKey,
      audioBackend,
      imageStorageKey,
      imageBackend,
      hasImageAsset,
      imageData: undefined,
      shortcutKey: typeof sourcePad.shortcutKey === 'string' ? sourcePad.shortcutKey : undefined,
      midiNote: typeof sourcePad.midiNote === 'number' ? sourcePad.midiNote : undefined,
      midiCC: typeof sourcePad.midiCC === 'number' ? sourcePad.midiCC : undefined,
      ignoreChannel: Boolean(sourcePad.ignoreChannel),
      color: typeof sourcePad.color === 'string' && sourcePad.color.trim() ? sourcePad.color : defaultColor,
      triggerMode: toTriggerMode(sourcePad.triggerMode),
      playbackMode: toPlaybackMode(sourcePad.playbackMode),
      padGroup: typeof sourcePad.padGroup === 'number' && Number.isFinite(sourcePad.padGroup) && sourcePad.padGroup > 0 ? Math.trunc(sourcePad.padGroup) : undefined,
      padGroupUniversal: sourcePad.padGroupUniversal === true,
      volume: Math.max(0, Math.min(1, toNumber(sourcePad.volume, 1))),
      gainDb: typeof sourcePad.gainDb === 'number' ? sourcePad.gainDb : 0,
      gain: typeof sourcePad.gain === 'number' ? sourcePad.gain : 1,
      fadeInMs: Math.max(0, toNumber(sourcePad.fadeInMs, 0)),
      fadeOutMs: Math.max(0, toNumber(sourcePad.fadeOutMs, 0)),
      startTimeMs: Math.max(0, toNumber(sourcePad.startTimeMs, 0)),
      endTimeMs: Math.max(0, toNumber(sourcePad.endTimeMs, 0)),
      pitch: toNumber(sourcePad.pitch, 0),
      tempoPercent: toNumber(sourcePad.tempoPercent, 0),
      keyLock: sourcePad.keyLock !== false,
      position: Number.isFinite(Number(sourcePad.position)) ? Number(sourcePad.position) : index,
      audioBytes: typeof sourcePad.audioBytes === 'number' ? sourcePad.audioBytes : undefined,
      audioDurationMs: typeof sourcePad.audioDurationMs === 'number' ? sourcePad.audioDurationMs : undefined,
      savedHotcuesMs: Array.isArray(sourcePad.savedHotcuesMs)
        ? (sourcePad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
        : [null, null, null, null],
      contentOrigin: 'official_admin',
      originBankId: defaultBankSourceId,
      originPadId: padId,
      originBankTitle: 'Default Bank',
    });

    if ((index + 1) % 4 === 0) {
      await yieldToMainThread();
    }
  }

  const sourceMetadata: BankMetadata | undefined = {
    password: false,
    transferable: true,
    exportable: true,
    title: 'Default Bank',
    description: metadata?.description || '',
    color: metadata?.color || defaultColor,
    thumbnailUrl: metadata?.thumbnailUrl,
    thumbnailAssetPath: metadata?.thumbnailAssetPath,
    hideThumbnailPreview: metadata?.hideThumbnailPreview,
    defaultBankSource: 'remote',
    defaultBankReleaseVersion: manifest.version,
    defaultBankReleasePublishedAt: manifest.publishedAt || undefined,
    defaultBankReleaseSha256: manifest.fileSha256 || undefined,
  };

  return applyBankContentPolicy({
    id: typeof bankData.id === 'string' && bankData.id.trim() ? bankData.id.trim() : generateId(),
    name: 'Default Bank',
    defaultColor,
    pads,
    createdAt: bankData.createdAt ? new Date(bankData.createdAt) : new Date(manifest.publishedAt || Date.now()),
    sortOrder: Number.isFinite(Number(bankData.sortOrder)) ? Number(bankData.sortOrder) : 0,
    sourceBankId: defaultBankSourceId,
    isAdminBank: false,
    transferable: true,
    exportable: true,
    bankMetadata: sourceMetadata,
  });
};
