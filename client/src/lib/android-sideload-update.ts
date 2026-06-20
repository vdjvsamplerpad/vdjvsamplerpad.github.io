import { Capacitor } from '@capacitor/core';

export interface AndroidSideloadReleaseInfo {
  version: string;
  publicVersion: string;
  buildVersion: string | null;
  buildCode: number | null;
  assetName: string;
  downloadUrl: string;
  releaseUrl: string | null;
  publishedAt: string | null;
}

const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_RELEASE_OWNER = 'vdjvsamplerpad';
const DEFAULT_RELEASE_REPO = 'vdjvsamplerpad.github.io';

const readEnv = (key: string): string =>
  String((import.meta as any).env?.[key] || '').trim();

const getRuntimeCapacitor = (): any => {
  if (typeof window === 'undefined') return Capacitor;
  return (window as any).Capacitor || Capacitor;
};

const isNativeAndroid = (): boolean => {
  const capacitor = getRuntimeCapacitor();
  return capacitor?.isNativePlatform?.() === true && capacitor?.getPlatform?.() === 'android';
};

const normalizeVersion = (value: string | null | undefined): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^v/i, '').trim();
};

const parseComparableVersion = (value: string | null | undefined): number[] | null => {
  const normalized = normalizeVersion(value);
  if (!normalized) return null;
  const main = normalized.split('-')[0]?.trim() || normalized;
  const parts = main.split('.');
  if (parts.length === 0) return null;
  const parsed = parts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parsed;
};

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

export const isAndroidSideloadUpdateConfigured = (): boolean => {
  if (!isNativeAndroid()) return false;
  return true;
};

export const isNewerAndroidSideloadVersion = (
  currentVersion: string | null | undefined,
  nextVersion: string | null | undefined
): boolean => {
  const current = parseComparableVersion(currentVersion);
  const next = parseComparableVersion(nextVersion);
  if (!current || !next) return false;
  const maxLength = Math.max(current.length, next.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = current[index] ?? 0;
    const right = next[index] ?? 0;
    if (right > left) return true;
    if (right < left) return false;
  }
  return false;
};

export const isNewerAndroidSideloadRelease = (
  currentVersion: string | null | undefined,
  currentBuildCode: number | string | null | undefined,
  nextRelease: Pick<AndroidSideloadReleaseInfo, 'version' | 'buildCode'>
): boolean => {
  const currentCode = parsePositiveInteger(currentBuildCode);
  const nextCode = parsePositiveInteger(nextRelease.buildCode);
  if (currentCode && nextCode) {
    return nextCode > currentCode;
  }
  return isNewerAndroidSideloadVersion(currentVersion, nextRelease.version);
};

const getGithubReleaseConfig = () => {
  const apiBase = readEnv('VITE_ANDROID_RELEASES_API_BASE_URL') || DEFAULT_GITHUB_API_BASE_URL;
  const owner = readEnv('VITE_ANDROID_RELEASES_OWNER') || DEFAULT_RELEASE_OWNER;
  const repo = readEnv('VITE_ANDROID_RELEASES_REPO') || DEFAULT_RELEASE_REPO;
  const preferredPrefix = readEnv('VITE_ANDROID_RELEASE_APK_PREFIX') || 'VDJV-Sampler-Pad-';
  return { apiBase, owner, repo, preferredPrefix };
};

const resolveBestApkAsset = (
  assets: Array<Record<string, unknown>>,
  preferredPrefix: string
): { name: string; browser_download_url: string } | null => {
  const apkAssets = assets.filter((asset) => {
    const name = String(asset?.name || '').trim();
    const url = String(asset?.browser_download_url || '').trim();
    return name.toLowerCase().endsWith('.apk') && Boolean(url);
  }) as Array<{ name: string; browser_download_url: string }>;

  if (apkAssets.length === 0) return null;

  const exactPrefixMatch = apkAssets.find((asset) => asset.name.startsWith(preferredPrefix));
  if (exactPrefixMatch) return exactPrefixMatch;

  return apkAssets[0] || null;
};

const findAssetByName = (
  assets: Array<Record<string, unknown>>,
  names: string[]
): { name: string; browser_download_url: string } | null => {
  const normalizedNames = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (normalizedNames.size === 0) return null;
  for (const asset of assets) {
    const name = String(asset?.name || '').trim();
    const url = String(asset?.browser_download_url || '').trim();
    if (name && url && normalizedNames.has(name.toLowerCase())) {
      return { name, browser_download_url: url };
    }
  }
  return null;
};

const fetchReleaseManifest = async (
  assets: Array<Record<string, unknown>>
): Promise<Record<string, unknown> | null> => {
  const manifestAsset = findAssetByName(assets, ['release-manifest.json', 'android-release-manifest.json']);
  if (!manifestAsset) return null;
  try {
    const response = await fetch(`${manifestAsset.browser_download_url}${manifestAsset.browser_download_url.includes('?') ? '&' : '?'}_vdjv=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json,text/plain,*/*',
      },
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export const fetchLatestAndroidSideloadRelease = async (): Promise<AndroidSideloadReleaseInfo> => {
  const { apiBase, owner, repo, preferredPrefix } = getGithubReleaseConfig();
  const response = await fetch(
    `${apiBase.replace(/\/+$/, '')}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status}).`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const tagName = normalizeVersion(String(payload?.tag_name || ''));
  const releaseUrl = String(payload?.html_url || '').trim() || null;
  const publishedAt = String(payload?.published_at || '').trim() || null;
  const assets = Array.isArray(payload?.assets) ? payload.assets as Array<Record<string, unknown>> : [];
  const manifest = await fetchReleaseManifest(assets);
  const manifestApk = manifest?.apk && typeof manifest.apk === 'object' ? manifest.apk as Record<string, unknown> : null;
  const manifestAssetName = String(
    manifestApk?.asset ||
    manifest?.apkAsset ||
    manifestApk?.versionedAsset ||
    ''
  ).trim();
  const apkAsset = findAssetByName(assets, manifestAssetName ? [manifestAssetName] : [])
    || resolveBestApkAsset(assets, preferredPrefix);

  if (!tagName) {
    throw new Error('Latest release tag is missing a version.');
  }
  if (!apkAsset) {
    throw new Error('Latest release does not contain an APK asset.');
  }

  const publicVersion = normalizeVersion(String(manifest?.publicVersion || manifest?.version || tagName));
  const buildVersion = String(manifest?.buildVersion || '').trim() || null;
  const buildCode = parsePositiveInteger(manifest?.buildCode);

  return {
    version: publicVersion || tagName,
    publicVersion: publicVersion || tagName,
    buildVersion,
    buildCode,
    assetName: apkAsset.name,
    downloadUrl: apkAsset.browser_download_url,
    releaseUrl,
    publishedAt,
  };
};

export const openAndroidSideloadDownload = (url: string): void => {
  const nextUrl = String(url || '').trim();
  if (!nextUrl || typeof window === 'undefined') {
    throw new Error('No APK download URL is available.');
  }

  if (isNativeAndroid()) {
    const openedWindow = window.open(nextUrl, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.href = nextUrl;
    }
    return;
  }

  const openedWindow = window.open(nextUrl, '_blank', 'noopener,noreferrer');
  if (!openedWindow) {
    window.location.href = nextUrl;
  }
};
