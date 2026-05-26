export type EditableAccountTier = 'free' | 'pro' | 'pro_max';
export type EditableInstallerTier = 'standard' | 'pro' | 'pro_max';

export type TierVideoContent = {
  src?: string;
  storageProvider?: 'r2' | 'local' | null;
  storageBucket?: string | null;
  storageKey?: string | null;
  assetName?: string | null;
};

export type TierCardHeaderContent = {
  enabled: boolean;
  label: string;
};

export type TierVersionBadgeContent = {
  enabled: boolean;
  label: string;
};

export type TierDetailRow = {
  title: string;
  body?: string;
};

export type TierInclusionRow = {
  title: string;
  badge: string;
  enabled: boolean;
};

export type AccountTierUiContent = {
  version: 1;
  color: string;
  cardHeader: TierCardHeaderContent;
  versionBadge: TierVersionBadgeContent;
  video: TierVideoContent;
  shortDescriptions: string[];
  otherDescriptions: TierDetailRow[];
  checklist: string[];
  meterPercent: number;
  inclusionTitle: string;
  inclusions: TierInclusionRow[];
};

export const DEFAULT_TIER_VIDEO_SRC = '/assets/v1-preview.mp4';

export const DEFAULT_TIER_UI_CONTENT: Record<EditableAccountTier, AccountTierUiContent> = {
  free: {
    version: 1,
    color: '#64748b',
    cardHeader: { enabled: false, label: '' },
    versionBadge: { enabled: false, label: '' },
    video: { src: DEFAULT_TIER_VIDEO_SRC, storageProvider: 'local' },
    shortDescriptions: ['For trying VDJV before upgrading'],
    otherDescriptions: [
      { title: 'Daily trial access', body: '50 Default Bank plays. Upgrade to remove daily play limits.' },
    ],
    checklist: [
      '50 Default Bank plays/day',
      '2 own sampler banks',
      'Store browsing only',
      'Locked checkout and free promotions',
    ],
    meterPercent: 33,
    inclusionTitle: 'Locked Features',
    inclusions: [
      { title: 'Bank Store downloads', badge: 'LOCKED', enabled: false },
      { title: 'Search / mappings', badge: 'LOCKED', enabled: false },
      { title: 'Backup / repair', badge: 'LOCKED', enabled: false },
    ],
  },
  pro: {
    version: 1,
    color: '#f21984',
    cardHeader: { enabled: true, label: 'Most popular' },
    versionBadge: { enabled: true, label: 'VDJV 2.0' },
    video: { src: DEFAULT_TIER_VIDEO_SRC, storageProvider: 'local' },
    shortDescriptions: ['Full VDJV feature set.'],
    otherDescriptions: [
      { title: 'Full sampler tools', body: 'Unlock checkout, free promos, search, mapping, backup, and editing.' },
    ],
    checklist: [
      'Unlimited Default Bank plays',
      'Bank Store checkout and free promotions',
      'Search, MIDI/keyboard mapping, backup and repair',
      'Full pad/bank edit controls and 4 deck channels',
    ],
    meterPercent: 66,
    inclusionTitle: 'Included Tools',
    inclusions: [
      { title: 'Bank Store downloads', badge: 'ENABLED', enabled: true },
      { title: 'Search / mappings', badge: 'ENABLED', enabled: true },
      { title: 'Backup / repair', badge: 'ENABLED', enabled: true },
    ],
  },
  pro_max: {
    version: 1,
    color: '#2155ff',
    cardHeader: { enabled: true, label: 'Best value' },
    versionBadge: { enabled: true, label: 'VDJV 2.0' },
    video: { src: DEFAULT_TIER_VIDEO_SRC, storageProvider: 'local' },
    shortDescriptions: ['All PRO features plus a snapshot grant of Store banks published at upgrade time.'],
    otherDescriptions: [
      { title: 'All current Store banks', body: 'PRO plus Store bank grant snapshot at approval time.' },
    ],
    checklist: [
      'Everything in PRO',
      'All Store banks published at upgrade time are granted',
      'Higher own-bank and device bank caps',
      'Best option for heavy offline/event use',
    ],
    meterPercent: 100,
    inclusionTitle: 'Store Access',
    inclusions: [
      { title: 'Published Store banks', badge: 'GRANTED', enabled: true },
      { title: 'Own bank quota', badge: '12', enabled: true },
      { title: 'Device bank cap', badge: '150', enabled: true },
    ],
  },
};

export const DEFAULT_INSTALLER_TIER_UI_CONTENT: Record<EditableInstallerTier, AccountTierUiContent> = {
  standard: {
    ...DEFAULT_TIER_UI_CONTENT.free,
    color: '#f59e0b',
    cardHeader: { enabled: false, label: '' },
    versionBadge: { enabled: true, label: 'VDJV' },
    shortDescriptions: ['Core installer package.'],
    otherDescriptions: [
      { title: 'Core installer', body: 'Base package with license request, receipt review, and download links after approval.' },
    ],
    checklist: ['Base installer package', 'License request by email', 'Admin receipt review', 'Installer links after approval'],
    meterPercent: 48,
    inclusionTitle: 'Included Tools',
    inclusions: [
      { title: 'Installer download', badge: 'ENABLED', enabled: true },
      { title: 'License code', badge: 'ENABLED', enabled: true },
      { title: 'Update add-ons', badge: 'OPTIONAL', enabled: false },
    ],
  },
  pro: {
    ...DEFAULT_TIER_UI_CONTENT.pro,
    color: '#f21984',
    cardHeader: { enabled: true, label: 'Flexible' },
    versionBadge: { enabled: true, label: 'VDJV' },
    shortDescriptions: ['Build PRO from Standard plus updates, or choose Update Only if Standard is already installed.'],
    otherDescriptions: [
      { title: 'Standard + Update', body: 'Bundle Standard with one or more update packages in one checkout request.' },
    ],
    checklist: ['Choose Standard + Update or Update Only', 'Select one or more update SKUs', 'Single checkout request', 'Better fit for existing users'],
    meterPercent: 66,
    inclusionTitle: 'Included Tools',
    inclusions: [
      { title: 'Standard installer', badge: 'INCLUDED', enabled: true },
      { title: 'Selected updates', badge: 'OPTIONAL', enabled: false },
      { title: 'License review', badge: 'ENABLED', enabled: true },
    ],
  },
  pro_max: {
    ...DEFAULT_TIER_UI_CONTENT.pro_max,
    color: '#2155ff',
    cardHeader: { enabled: true, label: 'Best value' },
    versionBadge: { enabled: true, label: 'VDJV' },
    shortDescriptions: ['Maximum installer package.'],
    otherDescriptions: [
      { title: 'Maximum installer access', body: 'Top package from the Installer Catalog with complete setup and admin-controlled pricing.' },
    ],
    checklist: ['Top package from Installer Catalog', 'Best for complete setup', 'License and download after approval', 'Admin-controlled pricing'],
    meterPercent: 100,
    inclusionTitle: 'Included Tools',
    inclusions: [
      { title: 'Full installer package', badge: 'ENABLED', enabled: true },
      { title: 'Updates', badge: 'INCLUDED', enabled: true },
      { title: 'License code', badge: 'ENABLED', enabled: true },
    ],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeText = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const normalizeTextRows = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const rows = value.map((item) => normalizeText(item)).filter(Boolean);
  return rows.length ? rows.slice(0, 12) : fallback;
};

const normalizeDetailRows = (value: unknown, fallback: TierDetailRow[]): TierDetailRow[] => {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => {
      if (typeof item === 'string') return { title: item.trim(), body: '' };
      if (!isRecord(item)) return null;
      const title = normalizeText(item.title);
      if (!title) return null;
      return { title, body: normalizeText(item.body) };
    })
    .filter(Boolean) as TierDetailRow[];
  return rows.length ? rows.slice(0, 12) : fallback;
};

const normalizeInclusionRows = (value: unknown, fallback: TierInclusionRow[]): TierInclusionRow[] => {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const title = normalizeText(item.title);
      if (!title) return null;
      return {
        title,
        badge: normalizeText(item.badge, 'ENABLED').toUpperCase(),
        enabled: item.enabled !== false,
      };
    })
    .filter(Boolean) as TierInclusionRow[];
  return rows.length ? rows.slice(0, 12) : fallback;
};

const normalizeHexColor = (value: unknown, fallback: string): string => {
  const text = normalizeText(value, fallback);
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
};

const normalizePercent = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed)));
};

export const normalizeTierUiContentWithDefaults = (
  value: unknown,
  defaults: AccountTierUiContent,
): AccountTierUiContent => {
  const input = isRecord(value) ? value : {};
  const cardHeader = isRecord(input.cardHeader) ? input.cardHeader : {};
  const versionBadge = isRecord(input.versionBadge) ? input.versionBadge : {};
  const video = isRecord(input.video) ? input.video : {};
  return {
    version: 1,
    color: normalizeHexColor(input.color, defaults.color),
    cardHeader: {
      enabled: typeof cardHeader.enabled === 'boolean' ? cardHeader.enabled : defaults.cardHeader.enabled,
      label: normalizeText(cardHeader.label, defaults.cardHeader.label),
    },
    versionBadge: {
      enabled: typeof versionBadge.enabled === 'boolean' ? versionBadge.enabled : defaults.versionBadge.enabled,
      label: normalizeText(versionBadge.label, defaults.versionBadge.label),
    },
    video: {
      src: normalizeText(video.src, defaults.video.src),
      storageProvider: video.storageProvider === 'r2' || video.storageProvider === 'local' ? video.storageProvider : defaults.video.storageProvider,
      storageBucket: normalizeText(video.storageBucket, defaults.video.storageBucket || '') || null,
      storageKey: normalizeText(video.storageKey, defaults.video.storageKey || '') || null,
      assetName: normalizeText(video.assetName, defaults.video.assetName || '') || null,
    },
    shortDescriptions: normalizeTextRows(input.shortDescriptions, defaults.shortDescriptions),
    otherDescriptions: normalizeDetailRows(input.otherDescriptions, defaults.otherDescriptions),
    checklist: normalizeTextRows(input.checklist, defaults.checklist),
    meterPercent: normalizePercent(input.meterPercent, defaults.meterPercent),
    inclusionTitle: normalizeText(input.inclusionTitle, defaults.inclusionTitle),
    inclusions: normalizeInclusionRows(input.inclusions, defaults.inclusions),
  };
};

export const normalizeTierUiContent = (
  value: unknown,
  tier: EditableAccountTier,
): AccountTierUiContent => normalizeTierUiContentWithDefaults(value, DEFAULT_TIER_UI_CONTENT[tier]);

export const normalizeInstallerTierUiContent = (
  value: unknown,
  tier: EditableInstallerTier,
): AccountTierUiContent => normalizeTierUiContentWithDefaults(value, DEFAULT_INSTALLER_TIER_UI_CONTENT[tier]);

export const resolveTierVideoSrc = (content: AccountTierUiContent): string =>
  content.video.src || DEFAULT_TIER_VIDEO_SRC;
