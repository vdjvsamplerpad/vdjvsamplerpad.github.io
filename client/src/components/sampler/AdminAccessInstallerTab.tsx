import * as React from 'react';
import { ChevronDown, ChevronUp, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyableValue } from '@/components/ui/copyable-value';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  adminApi,
  type AdminInstallerPurchaseRequest,
  type AdminInstallerCompletionDetail,
  type AdminInstallerEvent,
  type AdminInstallerLicense,
  type InstallerBuyProduct,
  type InstallerPackage,
  type InstallerPricingTier,
  type InstallerTierConfig,
  type InstallerVersionKey,
} from '@/lib/admin-api';
import {
  type AccountTierUiContent,
  DEFAULT_TIER_VIDEO_SRC,
  normalizeInstallerTierUiContent,
} from '@/lib/account-tier-content';
import {
  AdminPageScaffold,
  AdminRefreshButton,
  AdminSectionTabs,
  AdminStatsStrip,
  AdminTierConfigLoadingSkeleton,
  AdminToolbar,
} from './AdminAccessDialog.layout';

type Props = {
  theme: 'light' | 'dark';
  panelClass: string;
  mode?: 'full' | 'tier-config';
  tierConfigVersion?: InstallerVersionKey;
  versionTabs?: React.ReactNode;
  embedded?: boolean;
  externalSaveSignal?: number;
  externalRefreshSignal?: number;
  onTierConfigStateChange?: (state: { dirty: boolean; saving: boolean; loading: boolean }) => void;
  pushNotice: (notice: { variant: 'success' | 'error' | 'info'; message: string }) => void;
};

type ViewKey = 'packages' | 'licenses' | 'catalog' | 'tierUi' | 'requests' | 'events';

type PackageDialogState = {
  open: boolean;
  mode: 'create' | 'edit';
  originalProductCode: string | null;
  draft: InstallerPackage;
};

type LicenseDialogState = {
  open: boolean;
  mode: 'create' | 'edit';
  version: InstallerVersionKey;
  licenseId: number | null;
  draft: {
    customerName: string;
    notes: string;
    unlimited: boolean;
    disabled: boolean;
    entitlements: string[];
  };
};

type CatalogDialogState = {
  open: boolean;
  mode: 'create' | 'edit';
  originalSkuCode: string | null;
  draft: InstallerBuyProduct;
};

type RequestDialogState = {
  open: boolean;
  item: AdminInstallerPurchaseRequest | null;
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  variant: 'default' | 'destructive';
  action: null | (() => Promise<void> | void);
};

type RejectDialogState = {
  open: boolean;
  item: AdminInstallerPurchaseRequest | null;
  reason: string;
};

const VERSIONS: InstallerVersionKey[] = ['V2', 'V3'];

const blankPackagePart = (partIndex: number) => ({
  partIndex,
  archiveName: '',
  downloadUrl: '',
  downloadSize: 0,
  sha256: '',
  zipPassword: '',
  enabled: true,
});

const blankPackage = (version: InstallerVersionKey): InstallerPackage => ({
  version,
  productCode: `${version}_`,
  displayName: '',
  archiveName: '',
  downloadUrl: '',
  downloadSize: 0,
  sha256: '',
  zipPassword: '',
  installOrder: 10,
  packageKind: 'update',
  includeInProMax: false,
  enabled: true,
  partCount: 1,
  parts: [blankPackagePart(1)],
});

const blankLicenseDraft = () => ({
  customerName: '',
  notes: '',
  unlimited: false,
  disabled: false,
  entitlements: [] as string[],
});

const blankCatalogProduct = (version: InstallerVersionKey): InstallerBuyProduct => ({
  version,
  skuCode: `${version}_STANDARD`,
  productType: 'standard',
  displayName: `${version} Standard`,
  description: '',
  pricePhp: 0,
  enabled: true,
  sortOrder: 0,
  allowAutoApprove: true,
  heroImageUrl: '',
  downloadLinkOverride: '',
  grantedEntitlements: [],
});

const INSTALLER_TIER_ORDER: InstallerPricingTier[] = ['standard', 'pro', 'pro_max'];

const defaultInstallerTierConfig = (version: InstallerVersionKey, tier: InstallerPricingTier): InstallerTierConfig => ({
  version,
  tier,
  displayName: tier === 'pro_max' ? 'PRO MAX' : tier.toUpperCase(),
  description: tier === 'standard'
    ? `Core ${version} installer package.`
    : tier === 'pro'
      ? `${version} standard package plus selected update access, or Update Only for users who already installed the base package.`
      : `Maximum ${version} installer package.`,
  uiContent: {
    ...normalizeInstallerTierUiContent(null, tier),
    versionBadge: { enabled: true, label: version },
    video: { src: `/assets/${version.toLowerCase()}-preview.mp4`, storageProvider: 'local' },
  },
  isActive: true,
});

const normalizeInstallerTierUiContentForVersion = (
  value: unknown,
  tier: InstallerPricingTier,
  version: InstallerVersionKey,
): AccountTierUiContent => {
  const content = normalizeInstallerTierUiContent(value, tier);
  const configuredSrc = content.video.src || '';
  if (!configuredSrc || configuredSrc === DEFAULT_TIER_VIDEO_SRC) {
    return {
      ...content,
      video: {
        ...content.video,
        src: `/assets/${version.toLowerCase()}-preview.mp4`,
        storageProvider: content.video.storageProvider || 'local',
      },
    };
  }
  return content;
};

const moveArrayItem = <T,>(rows: T[], index: number, delta: -1 | 1): T[] => {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

const cardShell = (theme: 'light' | 'dark') =>
  theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white';

const inputClass = (theme: 'light' | 'dark') =>
  theme === 'dark' ? 'bg-gray-950 border-gray-700 text-gray-100' : 'bg-white border-gray-300';

const selectClass = (theme: 'light' | 'dark') =>
  `h-9 rounded-md border px-3 text-sm ${inputClass(theme)}`;

const statusBadgeClass = (theme: 'light' | 'dark', status: string) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'available') return theme === 'dark' ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (normalized === 'claimed') return theme === 'dark' ? 'bg-amber-500/15 text-amber-200 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200';
  if (normalized === 'used') return theme === 'dark' ? 'bg-blue-500/15 text-blue-200 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-200';
  if (normalized === 'pending') return theme === 'dark' ? 'bg-amber-500/15 text-amber-200 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200';
  if (normalized === 'approved') return theme === 'dark' ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (normalized === 'rejected') return theme === 'dark' ? 'bg-rose-500/15 text-rose-200 border-rose-500/30' : 'bg-rose-50 text-rose-700 border-rose-200';
  if (normalized === 'disabled') return theme === 'dark' ? 'bg-rose-500/15 text-rose-200 border-rose-500/30' : 'bg-rose-50 text-rose-700 border-rose-200';
  return theme === 'dark' ? 'bg-rose-500/15 text-rose-200 border-rose-500/30' : 'bg-rose-50 text-rose-700 border-rose-200';
};

const eventBadgeClass = (theme: 'light' | 'dark', eventType: string) => {
  const normalized = String(eventType || '').toLowerCase();
  if (normalized === 'claim') return theme === 'dark' ? 'bg-amber-500/15 text-amber-200 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200';
  if (normalized === 'complete') return theme === 'dark' ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (normalized === 'release') return theme === 'dark' ? 'bg-blue-500/15 text-blue-200 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-200';
  return theme === 'dark' ? 'bg-gray-500/15 text-gray-200 border-gray-500/30' : 'bg-gray-50 text-gray-700 border-gray-200';
};

const installerPackageKindMeta = (kind: InstallerPackage['packageKind']) => {
  if (kind === 'standard') {
    return {
      label: 'Standard Package',
      shortLabel: 'Standard',
      description: 'Base package entitlement. Actual integrated or portable mode is recorded after install completion.',
    };
  }
  return {
    label: 'Update Package',
    shortLabel: 'Update',
    description: 'Update package entitlement. Actual integrated or portable mode is recorded after install completion.',
  };
};

const installerProductTypeMeta = (type: InstallerBuyProduct['productType']) => {
  if (type === 'standard') {
    return {
      label: 'Standard',
      shortLabel: 'Standard',
      description: 'Buyer receives the standard/base installer entitlement. Install mode is recorded after completion.',
    };
  }
  if (type === 'update') {
    return {
      label: 'Update Only',
      shortLabel: 'Update',
      description: 'Buyer receives update-only package access. Install mode is recorded after completion.',
    };
  }
  return {
    label: 'PRO MAX Bundle',
    shortLabel: 'PRO MAX',
    description: 'Buyer receives all installer entitlements configured for PRO MAX.',
  };
};

const installerKindBadgeClass = (theme: 'light' | 'dark', kind: InstallerPackage['packageKind'] | InstallerBuyProduct['productType']) => {
  if (kind === 'standard') {
    return theme === 'dark'
      ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (kind === 'update') {
    return theme === 'dark'
      ? 'border-sky-400/35 bg-sky-500/15 text-sky-100'
      : 'border-sky-200 bg-sky-50 text-sky-700';
  }
  return theme === 'dark'
    ? 'border-fuchsia-400/35 bg-fuchsia-500/15 text-fuchsia-100'
    : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700';
};

const InstallerKindBadge = ({
  theme,
  kind,
  compact = false,
}: {
  theme: 'light' | 'dark';
  kind: InstallerPackage['packageKind'];
  compact?: boolean;
}) => {
  const meta = installerPackageKindMeta(kind);
  return (
    <span
      title={meta.description}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${installerKindBadgeClass(theme, kind)}`}
    >
      {compact ? meta.shortLabel : meta.label}
    </span>
  );
};

const InstallerProductTypeBadge = ({
  theme,
  type,
  compact = false,
}: {
  theme: 'light' | 'dark';
  type: InstallerBuyProduct['productType'];
  compact?: boolean;
}) => {
  const meta = installerProductTypeMeta(type);
  return (
    <span
      title={meta.description}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${installerKindBadgeClass(theme, type)}`}
    >
      {compact ? meta.shortLabel : meta.label}
    </span>
  );
};

type CompletionModeSummary = 'integrated' | 'portable' | 'mixed' | 'unknown';

const installModeBadgeClass = (theme: 'light' | 'dark', mode: CompletionModeSummary) => {
  if (mode === 'integrated') {
    return theme === 'dark'
      ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (mode === 'portable') {
    return theme === 'dark'
      ? 'border-sky-400/35 bg-sky-500/15 text-sky-100'
      : 'border-sky-200 bg-sky-50 text-sky-700';
  }
  if (mode === 'mixed') {
    return theme === 'dark'
      ? 'border-amber-400/35 bg-amber-500/15 text-amber-100'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return theme === 'dark'
    ? 'border-gray-500/30 bg-gray-500/10 text-gray-200'
    : 'border-gray-200 bg-gray-50 text-gray-700';
};

const installModeLabel = (mode: CompletionModeSummary) => {
  if (mode === 'integrated') return 'Integrated';
  if (mode === 'portable') return 'Portable';
  if (mode === 'mixed') return 'Mixed';
  return 'Mode not recorded';
};

const InstallModeBadge = ({ theme, mode }: { theme: 'light' | 'dark'; mode: CompletionModeSummary }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${installModeBadgeClass(theme, mode)}`}>
    {installModeLabel(mode)}
  </span>
);

const asInstallerRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const normalizeBooleanLike = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'portable'].includes(normalized)) return true;
    if (['false', '0', 'no', 'integrated'].includes(normalized)) return false;
  }
  return null;
};

const normalizeInstallMode = (value: unknown, portableMode?: unknown): Exclude<CompletionModeSummary, 'mixed' | 'unknown'> | null => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'integrated' || normalized === 'virtualdj' || normalized === 'vdj') return 'integrated';
  if (normalized === 'portable') return 'portable';
  const portable = normalizeBooleanLike(portableMode);
  if (portable !== null) return portable ? 'portable' : 'integrated';
  return null;
};

const getCompletionMode = (detail: AdminInstallerCompletionDetail | Record<string, unknown>): 'integrated' | 'portable' | null => {
  const row = asInstallerRecord(detail);
  return normalizeInstallMode(row.installMode ?? row.install_mode, row.portableMode ?? row.portable_mode);
};

const getCompletionProductCode = (detail: AdminInstallerCompletionDetail | Record<string, unknown>): string => {
  const row = asInstallerRecord(detail);
  return String(row.productCode ?? row.product_code ?? '').trim();
};

const summarizeCompletionMode = (
  details: Array<AdminInstallerCompletionDetail | Record<string, unknown>> | undefined,
  completedProducts: string[] = [],
) => {
  const rows = Array.isArray(details) ? details : [];
  const modes = Array.from(new Set(rows.map(getCompletionMode).filter(Boolean))) as Array<'integrated' | 'portable'>;
  const productCodes = Array.from(new Set([
    ...completedProducts,
    ...rows.map(getCompletionProductCode),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const targetPaths = Array.from(new Set(rows
    .map((detail) => {
      const row = asInstallerRecord(detail);
      return String(row.targetPath ?? row.target_path ?? '').trim();
    })
    .filter(Boolean)));
  const mode: CompletionModeSummary = modes.length > 1 ? 'mixed' : modes[0] || 'unknown';
  return { mode, productCodes, targetPaths };
};

const toggleValue = (values: string[], value: string, enabled: boolean) => {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return Array.from(next).sort();
};

const normalizePackageParts = (parts: InstallerPackage['parts']) =>
  [...parts]
    .map((part, index) => ({
      ...part,
      partIndex: Number.isFinite(part.partIndex) && part.partIndex > 0 ? Math.floor(part.partIndex) : index + 1,
      archiveName: String(part.archiveName || ''),
      downloadUrl: String(part.downloadUrl || ''),
      downloadSize: Number.isFinite(part.downloadSize) ? Math.max(0, Math.floor(part.downloadSize)) : 0,
      sha256: String(part.sha256 || ''),
      zipPassword: String(part.zipPassword || ''),
      enabled: Boolean(part.enabled),
    }))
    .sort((left, right) => left.partIndex - right.partIndex);

const withDerivedPackageSummary = (draft: InstallerPackage): InstallerPackage => {
  const parts = normalizePackageParts(draft.parts?.length ? draft.parts : [blankPackagePart(1)]);
  const primaryPart = parts[0];
  return {
    ...draft,
    archiveName: primaryPart?.archiveName || '',
    downloadUrl: primaryPart?.downloadUrl || '',
    downloadSize: primaryPart?.downloadSize || 0,
    sha256: primaryPart?.sha256 || '',
    zipPassword: primaryPart?.zipPassword || '',
    partCount: parts.length,
    parts,
  };
};

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const packageNameList = (productCodes: string[], packageMap: Map<string, InstallerPackage>, includeKind = false) => {
  if (productCodes.length === 0) return '-';
  return productCodes.map((productCode) => {
    const item = packageMap.get(productCode);
    if (!item) return productCode;
    return includeKind ? `${item.displayName} (${installerPackageKindMeta(item.packageKind).shortLabel})` : item.displayName;
  }).join(', ');
};

const totalPages = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage));

const useDebouncedValue = <T,>(value: T, delayMs: number) => {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debounced;
};

export function AdminAccessInstallerTab({
  theme,
  panelClass,
  mode = 'full',
  tierConfigVersion,
  versionTabs,
  embedded = false,
  externalSaveSignal = 0,
  externalRefreshSignal = 0,
  onTierConfigStateChange,
  pushNotice,
}: Props) {
  const isTierConfigMode = mode === 'tier-config';
  const [view, setView] = React.useState<ViewKey>(isTierConfigMode ? 'tierUi' : 'licenses');

  const [packagesByVersion, setPackagesByVersion] = React.useState<Record<InstallerVersionKey, InstallerPackage[]>>({ V2: [], V3: [] });
  const [packagesLoading, setPackagesLoading] = React.useState(false);
  const [packageActionKey, setPackageActionKey] = React.useState('');
  const [packageQuery, setPackageQuery] = React.useState('');
  const [packageKindFilter, setPackageKindFilter] = React.useState<'all' | 'standard' | 'update'>('all');
  const [packageStatusFilter, setPackageStatusFilter] = React.useState<'all' | 'enabled' | 'disabled'>('all');
  const [packageDialog, setPackageDialog] = React.useState<PackageDialogState>({
    open: false,
    mode: 'create',
    originalProductCode: null,
    draft: blankPackage('V2'),
  });

  const [licenseQuery, setLicenseQuery] = React.useState('');
  const [licenseStatus, setLicenseStatus] = React.useState<'all' | 'available' | 'claimed' | 'used' | 'disabled'>('all');
  const [licensePages, setLicensePages] = React.useState<Record<InstallerVersionKey, number>>({ V2: 1, V3: 1 });
  const [licensesByVersion, setLicensesByVersion] = React.useState<Record<InstallerVersionKey, AdminInstallerLicense[]>>({ V2: [], V3: [] });
  const [licenseTotals, setLicenseTotals] = React.useState<Record<InstallerVersionKey, number>>({ V2: 0, V3: 0 });
  const [licensesLoading, setLicensesLoading] = React.useState(false);
  const [licenseActionKey, setLicenseActionKey] = React.useState('');
  const [licenseDialog, setLicenseDialog] = React.useState<LicenseDialogState>({
    open: false,
    mode: 'create',
    version: 'V2',
    licenseId: null,
    draft: blankLicenseDraft(),
  });
  const [createdCode, setCreatedCode] = React.useState('');

  const [catalogByVersion, setCatalogByVersion] = React.useState<Record<InstallerVersionKey, InstallerBuyProduct[]>>({ V2: [], V3: [] });
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [catalogActionKey, setCatalogActionKey] = React.useState('');
  const [catalogQuery, setCatalogQuery] = React.useState('');
  const [catalogTypeFilter, setCatalogTypeFilter] = React.useState<'all' | InstallerBuyProduct['productType']>('all');
  const [catalogStatusFilter, setCatalogStatusFilter] = React.useState<'all' | 'enabled' | 'disabled'>('all');
  const [catalogDialog, setCatalogDialog] = React.useState<CatalogDialogState>({
    open: false,
    mode: 'create',
    originalSkuCode: null,
    draft: blankCatalogProduct('V2'),
  });
  const [tierUiByVersion, setTierUiByVersion] = React.useState<Record<InstallerVersionKey, InstallerTierConfig[]>>({ V2: [], V3: [] });
  const [tierUiLoading, setTierUiLoading] = React.useState(false);
  const [tierUiSaving, setTierUiSaving] = React.useState(false);
  const [hasUnsavedTierUiChanges, setHasUnsavedTierUiChanges] = React.useState(false);

  const [requestQuery, setRequestQuery] = React.useState('');
  const [requestStatus, setRequestStatus] = React.useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [requestPages, setRequestPages] = React.useState<Record<InstallerVersionKey, number>>({ V2: 1, V3: 1 });
  const [requestsByVersion, setRequestsByVersion] = React.useState<Record<InstallerVersionKey, AdminInstallerPurchaseRequest[]>>({ V2: [], V3: [] });
  const [requestTotals, setRequestTotals] = React.useState<Record<InstallerVersionKey, number>>({ V2: 0, V3: 0 });
  const [requestsLoading, setRequestsLoading] = React.useState(false);
  const [requestActionKey, setRequestActionKey] = React.useState('');
  const [requestDialog, setRequestDialog] = React.useState<RequestDialogState>({ open: false, item: null });
  const [confirmDialog, setConfirmDialog] = React.useState<ConfirmDialogState>({
    open: false,
    title: '',
    description: '',
    confirmText: 'Confirm',
    variant: 'default',
    action: null,
  });
  const [rejectDialog, setRejectDialog] = React.useState<RejectDialogState>({ open: false, item: null, reason: '' });

  const [eventQuery, setEventQuery] = React.useState('');
  const [eventType, setEventType] = React.useState<'all' | 'claim' | 'complete' | 'release'>('all');
  const [eventPages, setEventPages] = React.useState<Record<InstallerVersionKey, number>>({ V2: 1, V3: 1 });
  const [eventsByVersion, setEventsByVersion] = React.useState<Record<InstallerVersionKey, AdminInstallerEvent[]>>({ V2: [], V3: [] });
  const [eventTotals, setEventTotals] = React.useState<Record<InstallerVersionKey, number>>({ V2: 0, V3: 0 });
  const [eventsLoading, setEventsLoading] = React.useState(false);

  const debouncedLicenseQuery = useDebouncedValue(licenseQuery, 400);
  const debouncedRequestQuery = useDebouncedValue(requestQuery, 400);
  const debouncedEventQuery = useDebouncedValue(eventQuery, 400);
  const hasLoadedPackagesRef = React.useRef(false);

  const licensePerPage = 10;
  const requestPerPage = 10;
  const eventPerPage = 10;

  const showMessage = React.useCallback((tone: 'success' | 'error', nextMessage: string) => {
    pushNotice({ variant: tone, message: nextMessage });
  }, [pushNotice]);

  const allPackages = React.useMemo(() => [...packagesByVersion.V2, ...packagesByVersion.V3], [packagesByVersion]);
  const packageMap = React.useMemo(() => new Map(allPackages.map((item) => [item.productCode, item])), [allPackages]);

  const getEntitlementGroups = React.useCallback((version: InstallerVersionKey) => {
    const items = packagesByVersion[version] || [];
    return {
      standard: items.filter((item) => item.packageKind === 'standard').sort((left, right) => left.installOrder - right.installOrder),
      update: items.filter((item) => item.packageKind === 'update').sort((left, right) => left.installOrder - right.installOrder),
    };
  }, [packagesByVersion]);

  const isAutoManagedCatalogProduct = React.useCallback((item: InstallerBuyProduct) => (
    item.skuCode === `${item.version}_PRO_MAX` || packageMap.has(item.skuCode)
  ), [packageMap]);

  const catalogDraftAutoManaged = catalogDialog.mode === 'edit' && isAutoManagedCatalogProduct(catalogDialog.draft);

  const loadPackages = React.useCallback(async () => {
    if (hasLoadedPackagesRef.current) return;
    setPackagesLoading(true);
    try {
      const [v2, v3] = await Promise.all([adminApi.listInstallerPackages('V2'), adminApi.listInstallerPackages('V3')]);
      setPackagesByVersion({ V2: v2.items || [], V3: v3.items || [] });
      hasLoadedPackagesRef.current = true;
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load installer packages.');
    } finally {
      setPackagesLoading(false);
    }
  }, [showMessage]);

  const reloadPackages = React.useCallback(async () => {
    setPackagesLoading(true);
    try {
      const [v2, v3] = await Promise.all([adminApi.listInstallerPackages('V2'), adminApi.listInstallerPackages('V3')]);
      setPackagesByVersion({ V2: v2.items || [], V3: v3.items || [] });
      hasLoadedPackagesRef.current = true;
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load installer packages.');
    } finally {
      setPackagesLoading(false);
    }
  }, [showMessage]);

  const loadLicenses = React.useCallback(async () => {
    setLicensesLoading(true);
    try {
      const [v2, v3] = await Promise.all([
        adminApi.listInstallerLicenses({ version: 'V2', q: debouncedLicenseQuery || undefined, status: licenseStatus, page: licensePages.V2, perPage: licensePerPage }),
        adminApi.listInstallerLicenses({ version: 'V3', q: debouncedLicenseQuery || undefined, status: licenseStatus, page: licensePages.V3, perPage: licensePerPage }),
      ]);
      setLicensesByVersion({ V2: v2.items || [], V3: v3.items || [] });
      setLicenseTotals({ V2: v2.total || 0, V3: v3.total || 0 });
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load installer licenses.');
    } finally {
      setLicensesLoading(false);
    }
  }, [debouncedLicenseQuery, licensePages, licenseStatus, showMessage]);

  const loadCatalog = React.useCallback(async () => {
    setCatalogLoading(true);
    try {
      const [v2, v3] = await Promise.all([
        adminApi.listInstallerBuyProducts('V2'),
        adminApi.listInstallerBuyProducts('V3'),
      ]);
      setCatalogByVersion({ V2: v2.items || [], V3: v3.items || [] });
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load buy catalog.');
    } finally {
      setCatalogLoading(false);
    }
  }, [showMessage]);

  const loadTierUi = React.useCallback(async () => {
    setTierUiLoading(true);
    try {
      const [v2, v3] = await Promise.all([
        adminApi.listInstallerTierConfigs('V2'),
        adminApi.listInstallerTierConfigs('V3'),
      ]);
      const normalizeItems = (version: InstallerVersionKey, items: InstallerTierConfig[]) => (
        INSTALLER_TIER_ORDER.map((tier) => {
          const item = items.find((entry) => entry.tier === tier) || defaultInstallerTierConfig(version, tier);
          return {
            ...item,
            version,
            tier,
            displayName: item.displayName || (tier === 'pro_max' ? 'PRO MAX' : tier.toUpperCase()),
            uiContent: normalizeInstallerTierUiContentForVersion(item.uiContent, tier, version),
            isActive: item.isActive !== false,
          };
        })
      );
      setTierUiByVersion({
        V2: normalizeItems('V2', v2.items || []),
        V3: normalizeItems('V3', v3.items || []),
      });
      setHasUnsavedTierUiChanges(false);
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load installer tier config.');
    } finally {
      setTierUiLoading(false);
    }
  }, [showMessage]);

  const loadRequests = React.useCallback(async () => {
    setRequestsLoading(true);
    try {
      const [v2, v3] = await Promise.all([
        adminApi.listInstallerPurchaseRequests({ version: 'V2', q: debouncedRequestQuery || undefined, status: requestStatus, page: requestPages.V2, perPage: requestPerPage }),
        adminApi.listInstallerPurchaseRequests({ version: 'V3', q: debouncedRequestQuery || undefined, status: requestStatus, page: requestPages.V3, perPage: requestPerPage }),
      ]);
      setRequestsByVersion({ V2: v2.items || [], V3: v3.items || [] });
      setRequestTotals({ V2: v2.total || 0, V3: v3.total || 0 });
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load installer requests.');
    } finally {
      setRequestsLoading(false);
    }
  }, [debouncedRequestQuery, requestPages, requestStatus, showMessage]);

  const loadEvents = React.useCallback(async () => {
    setEventsLoading(true);
    try {
      const [v2, v3] = await Promise.all([
        adminApi.listInstallerEvents({ version: 'V2', q: debouncedEventQuery || undefined, eventType, page: eventPages.V2, perPage: eventPerPage }),
        adminApi.listInstallerEvents({ version: 'V3', q: debouncedEventQuery || undefined, eventType, page: eventPages.V3, perPage: eventPerPage }),
      ]);
      setEventsByVersion({ V2: v2.items || [], V3: v3.items || [] });
      setEventTotals({ V2: v2.total || 0, V3: v3.total || 0 });
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to load installer events.');
    } finally {
      setEventsLoading(false);
    }
  }, [debouncedEventQuery, eventPages, eventType, showMessage]);

  React.useEffect(() => {
    if (view === 'packages' || view === 'licenses' || view === 'events') {
      void loadPackages();
    }
  }, [loadPackages, view]);

  React.useEffect(() => {
    if (view === 'licenses') {
      void loadLicenses();
    }
  }, [loadLicenses, view]);

  React.useEffect(() => {
    if (view === 'catalog') {
      void loadCatalog();
    }
  }, [loadCatalog, view]);

  React.useEffect(() => {
    if (view === 'tierUi') {
      void loadTierUi();
    }
  }, [loadTierUi, view]);

  React.useEffect(() => {
    if (view === 'requests') {
      void loadRequests();
    }
  }, [loadRequests, view]);

  React.useEffect(() => {
    if (view === 'events') {
      void loadEvents();
    }
  }, [loadEvents, view]);

  const validatePackage = React.useCallback((item: InstallerPackage, existing: InstallerPackage[]): string | null => {
    const productCode = item.productCode.trim().toUpperCase();
    if (!productCode) return 'Product code is required.';
    if (!productCode.startsWith(`${item.version}_`)) return `Product code must start with ${item.version}_.`;
    if (!item.displayName.trim()) return 'Display name is required.';
    if (!Number.isFinite(item.installOrder) || item.installOrder < 0) return 'Install order must be zero or greater.';

    const parts = normalizePackageParts(item.parts || []);
    if (parts.length === 0) return 'At least one package part is required.';
    const seenPartIndexes = new Set<number>();
    for (const part of parts) {
      if (!part.archiveName.trim()) return `Archive name is required for part ${part.partIndex}.`;
      if (!part.zipPassword.trim()) return `Zip password is required for part ${part.partIndex}.`;
      if (!isHttpUrl(part.downloadUrl.trim())) return `Download URL must be valid for part ${part.partIndex}.`;
      if (!Number.isFinite(part.downloadSize) || part.downloadSize < 0) return `Download size must be zero or greater for part ${part.partIndex}.`;
      if (seenPartIndexes.has(part.partIndex)) return `Duplicate part index: ${part.partIndex}`;
      seenPartIndexes.add(part.partIndex);
    }

    const compareProductCode = packageDialog.mode === 'edit' ? packageDialog.originalProductCode : null;
    const otherPackages = existing.filter((entry) => entry.productCode !== compareProductCode);
    if (otherPackages.some((entry) => entry.productCode === productCode)) return `Duplicate product code: ${productCode}`;
    if (otherPackages.some((entry) => entry.installOrder === item.installOrder)) return `Install order ${item.installOrder} is already used.`;
    if (item.packageKind === 'standard' && otherPackages.some((entry) => entry.packageKind === 'standard')) return `Only one standard package is allowed for ${item.version}.`;
    return null;
  }, [packageDialog.mode, packageDialog.originalProductCode]);

  const openCreatePackageDialog = (version: InstallerVersionKey) => {
    setPackageDialog({ open: true, mode: 'create', originalProductCode: null, draft: withDerivedPackageSummary(blankPackage(version)) });
  };

  const openEditPackageDialog = (item: InstallerPackage) => {
    setPackageDialog({ open: true, mode: 'edit', originalProductCode: item.productCode, draft: withDerivedPackageSummary({ ...item }) });
  };

  const updatePackagePart = (partIndex: number, updater: (current: InstallerPackage['parts'][number]) => InstallerPackage['parts'][number]) => {
    setPackageDialog((current) => ({
      ...current,
      draft: withDerivedPackageSummary({
        ...current.draft,
        parts: current.draft.parts.map((part) => (part.partIndex === partIndex ? updater(part) : part)),
      }),
    }));
  };

  const addPackagePart = () => {
    setPackageDialog((current) => {
      const nextIndex = (current.draft.parts.reduce((max, part) => Math.max(max, part.partIndex), 0) || 0) + 1;
      return {
        ...current,
        draft: withDerivedPackageSummary({
          ...current.draft,
          parts: [...current.draft.parts, blankPackagePart(nextIndex)],
        }),
      };
    });
  };

  const removePackagePart = (partIndex: number) => {
    setPackageDialog((current) => {
      const nextParts = current.draft.parts.filter((part) => part.partIndex !== partIndex);
      return {
        ...current,
        draft: withDerivedPackageSummary({
          ...current.draft,
          parts: nextParts.length > 0 ? nextParts : [blankPackagePart(1)],
        }),
      };
    });
  };

  const handleSavePackageDialog = async () => {
    const draft = withDerivedPackageSummary(packageDialog.draft);
    const validationError = validatePackage(draft, packagesByVersion[draft.version]);
    if (validationError) {
      showMessage('error', validationError);
      return;
    }
    setPackageActionKey(`${packageDialog.mode}:${packageDialog.originalProductCode || draft.productCode}`);
    try {
      await adminApi.saveInstallerPackage(draft);
      setPackageDialog((current) => ({ ...current, open: false }));
      showMessage('success', `${draft.productCode} saved.`);
      await reloadPackages();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to save package.');
    } finally {
      setPackageActionKey('');
    }
  };

  const handleDeletePackage = async (item: InstallerPackage) => {
    setPackageActionKey(`delete:${item.productCode}`);
    try {
      await adminApi.deleteInstallerPackage({ version: item.version, productCode: item.productCode });
      showMessage('success', `${item.productCode} deleted.`);
      await reloadPackages();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to delete package.');
    } finally {
      setPackageActionKey('');
    }
  };

  const openCreateLicenseDialog = (version: InstallerVersionKey) => {
    setCreatedCode('');
    setLicenseDialog({ open: true, mode: 'create', version, licenseId: null, draft: blankLicenseDraft() });
  };

  const openEditLicenseDialog = (item: AdminInstallerLicense) => {
    setCreatedCode('');
    setLicenseDialog({
      open: true,
      mode: 'edit',
      version: item.version,
      licenseId: item.id,
      draft: {
        customerName: item.customerName || '',
        notes: item.notes || '',
        unlimited: item.unlimited,
        disabled: item.status === 'disabled',
        entitlements: [...item.entitlements],
      },
    });
  };

  const handleSaveLicenseDialog = async () => {
    const { draft, mode, version, licenseId } = licenseDialog;
    if (draft.entitlements.length === 0) {
      showMessage('error', 'Select at least one entitlement.');
      return;
    }
    setLicenseActionKey(`${mode}:${licenseId || version}`);
    try {
      if (mode === 'create') {
        const result = await adminApi.createInstallerLicense({
          version,
          customerName: draft.customerName,
          notes: draft.notes,
          unlimited: draft.unlimited,
          entitlements: draft.entitlements,
        });
        setCreatedCode(result.rawCode || '');
        showMessage('success', 'Installer license created.');
      } else if (licenseId) {
        await adminApi.updateInstallerLicense({
          id: licenseId,
          customerName: draft.customerName,
          notes: draft.notes,
          unlimited: draft.unlimited,
          disabled: draft.disabled,
          entitlements: draft.entitlements,
        });
        setLicenseDialog((current) => ({ ...current, open: false }));
        showMessage('success', `License #${licenseId} saved.`);
      }
      await loadLicenses();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to save installer license.');
    } finally {
      setLicenseActionKey('');
    }
  };

  const handleResetLicense = async (licenseId: number) => {
    setLicenseActionKey(`reset:${licenseId}`);
    try {
      await adminApi.resetInstallerLicense(licenseId);
      showMessage('success', `License #${licenseId} reset.`);
      await loadLicenses();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to reset installer license.');
    } finally {
      setLicenseActionKey('');
    }
  };

  const handleDeleteLicense = async (licenseId: number) => {
    setLicenseActionKey(`delete:${licenseId}`);
    try {
      await adminApi.deleteInstallerLicense(licenseId);
      showMessage('success', `License #${licenseId} deleted.`);
      await loadLicenses();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to delete installer license.');
    } finally {
      setLicenseActionKey('');
    }
  };

  const validateCatalogProduct = React.useCallback((item: InstallerBuyProduct, existing: InstallerBuyProduct[]): string | null => {
    const skuCode = item.skuCode.trim().toUpperCase();
    if (!skuCode) return 'SKU code is required.';
    if (!skuCode.startsWith(item.version)) return `SKU code must start with ${item.version}.`;
    if (!item.displayName.trim()) return 'Display name is required.';
    if (!Number.isFinite(item.pricePhp) || item.pricePhp < 0) return 'Price must be zero or greater.';
    if (!Number.isFinite(item.sortOrder) || item.sortOrder < 0) return 'Sort order must be zero or greater.';
    if (item.grantedEntitlements.length === 0) return 'Select at least one granted entitlement.';
    if (item.downloadLinkOverride.trim() && !isHttpUrl(item.downloadLinkOverride.trim())) return 'Download override must be a valid http or https URL.';
    if (item.heroImageUrl.trim() && !isHttpUrl(item.heroImageUrl.trim())) return 'Hero image must be a valid http or https URL.';
    const compareSku = catalogDialog.mode === 'edit' ? catalogDialog.originalSkuCode : null;
    const others = existing.filter((entry) => entry.skuCode !== compareSku);
    if (others.some((entry) => entry.skuCode === skuCode)) return `Duplicate SKU code: ${skuCode}`;
    return null;
  }, [catalogDialog.mode, catalogDialog.originalSkuCode]);

  const openCreateCatalogDialog = (version: InstallerVersionKey) => {
    const firstEntitlement = packagesByVersion[version]?.[0]?.productCode;
    const draft = blankCatalogProduct(version);
    if (firstEntitlement) draft.grantedEntitlements = [firstEntitlement];
    setCatalogDialog({ open: true, mode: 'create', originalSkuCode: null, draft });
  };

  const openEditCatalogDialog = (item: InstallerBuyProduct) => {
    setCatalogDialog({ open: true, mode: 'edit', originalSkuCode: item.skuCode, draft: { ...item } });
  };

  const handleSaveCatalogDialog = async () => {
    const draft = {
      ...catalogDialog.draft,
      skuCode: catalogDialog.draft.skuCode.trim().toUpperCase(),
    };
    const validationError = validateCatalogProduct(draft, catalogByVersion[draft.version]);
    if (validationError) {
      showMessage('error', validationError);
      return;
    }
    setCatalogActionKey(`${catalogDialog.mode}:${draft.version}:${draft.skuCode}`);
    try {
      await adminApi.saveInstallerBuyProduct(draft);
      setCatalogDialog((current) => ({ ...current, open: false }));
      showMessage('success', `${draft.skuCode} saved.`);
      await loadCatalog();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to save catalog item.');
    } finally {
      setCatalogActionKey('');
    }
  };

  const handleDeleteCatalogProduct = async (item: InstallerBuyProduct) => {
    setCatalogActionKey(`delete:${item.version}:${item.skuCode}`);
    try {
      await adminApi.deleteInstallerBuyProduct({ version: item.version, skuCode: item.skuCode });
      showMessage('success', `${item.skuCode} deleted.`);
      await loadCatalog();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to delete catalog item.');
    } finally {
      setCatalogActionKey('');
    }
  };

  const updateTierUiDraft = React.useCallback((
    version: InstallerVersionKey,
    tier: InstallerPricingTier,
    updater: (current: InstallerTierConfig) => InstallerTierConfig,
  ) => {
    setHasUnsavedTierUiChanges(true);
    setTierUiByVersion((current) => {
      const existing = current[version]?.length ? current[version] : INSTALLER_TIER_ORDER.map((entry) => defaultInstallerTierConfig(version, entry));
      const nextItems = existing.map((item) => item.tier === tier ? updater(item) : item);
      return { ...current, [version]: nextItems };
    });
  }, []);

  const updateTierUiContent = React.useCallback((
    version: InstallerVersionKey,
    tier: InstallerPricingTier,
    patch: Partial<AccountTierUiContent>,
  ) => {
    updateTierUiDraft(version, tier, (current) => {
      const currentContent = normalizeInstallerTierUiContentForVersion(current.uiContent, tier, version);
      return {
        ...current,
        uiContent: { ...currentContent, ...patch },
      };
    });
  }, [updateTierUiDraft]);

  const updateTierUiRow = React.useCallback(<T extends string | { title?: string }>(
    version: InstallerVersionKey,
    tier: InstallerPricingTier,
    key: 'shortDescriptions' | 'otherDescriptions' | 'checklist' | 'inclusions',
    rows: T[],
  ) => {
    updateTierUiContent(version, tier, { [key]: rows } as Partial<AccountTierUiContent>);
  }, [updateTierUiContent]);

  const moveTierUiRow = React.useCallback((
    version: InstallerVersionKey,
    tier: InstallerPricingTier,
    key: 'checklist' | 'inclusions',
    index: number,
    delta: -1 | 1,
  ) => {
    const current = tierUiByVersion[version]?.find((item) => item.tier === tier) || defaultInstallerTierConfig(version, tier);
    const content = normalizeInstallerTierUiContentForVersion(current.uiContent, tier, version);
    if (key === 'checklist') {
      updateTierUiRow(version, tier, 'checklist', moveArrayItem(content.checklist, index, delta));
      return;
    }
    updateTierUiRow(version, tier, 'inclusions', moveArrayItem(content.inclusions, index, delta));
  }, [tierUiByVersion, updateTierUiRow]);

  const saveTierUiConfigs = async (onlyVersion?: InstallerVersionKey) => {
    setTierUiSaving(true);
    try {
      const items = onlyVersion ? [...(tierUiByVersion[onlyVersion] || [])] : [...tierUiByVersion.V2, ...tierUiByVersion.V3];
      for (const item of items) {
        await adminApi.saveInstallerTierConfig({
          ...item,
          displayName: item.displayName.trim() || (item.tier === 'pro_max' ? 'PRO MAX' : item.tier.toUpperCase()),
          uiContent: normalizeInstallerTierUiContent(item.uiContent, item.tier),
        });
      }
      showMessage('success', `Saved ${items.length} ${onlyVersion ? `${onlyVersion} ` : ''}installer tier config${items.length === 1 ? '' : 's'}.`);
      setHasUnsavedTierUiChanges(false);
      await loadTierUi();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to save installer tier config.');
    } finally {
      setTierUiSaving(false);
    }
  };
  const lastExternalSaveSignal = React.useRef(externalSaveSignal);
  const lastExternalRefreshSignal = React.useRef(externalRefreshSignal);

  React.useEffect(() => {
    if (!isTierConfigMode) return;
    onTierConfigStateChange?.({
      dirty: hasUnsavedTierUiChanges,
      saving: tierUiSaving,
      loading: tierUiLoading,
    });
  }, [hasUnsavedTierUiChanges, isTierConfigMode, onTierConfigStateChange, tierUiLoading, tierUiSaving]);

  React.useEffect(() => {
    if (!isTierConfigMode) return;
    if (lastExternalSaveSignal.current === externalSaveSignal) return;
    lastExternalSaveSignal.current = externalSaveSignal;
    void saveTierUiConfigs(tierConfigVersion);
  }, [externalSaveSignal, isTierConfigMode, tierConfigVersion]);

  React.useEffect(() => {
    if (!isTierConfigMode) return;
    if (lastExternalRefreshSignal.current === externalRefreshSignal) return;
    lastExternalRefreshSignal.current = externalRefreshSignal;
    void loadTierUi();
  }, [externalRefreshSignal, isTierConfigMode, loadTierUi]);

  const handleInstallerRequestAction = async (
    item: AdminInstallerPurchaseRequest,
    action: 'approve' | 'reject',
    rejectionMessage?: string,
  ) => {
    if (action === 'reject' && !rejectionMessage?.trim()) return;
    setRequestActionKey(`${action}:${item.id}`);
    try {
      await adminApi.installerPurchaseRequestAction(item.id, {
        action,
        rejection_message: action === 'reject' ? rejectionMessage?.trim() : undefined,
      });
      showMessage('success', `${item.displayNameSnapshot} ${action === 'approve' ? 'approved' : 'rejected'}.`);
      setRequestDialog((current) => current.item?.id === item.id ? { ...current, open: false } : current);
      if (action === 'reject') {
        setRejectDialog({ open: false, item: null, reason: '' });
      }
      await loadRequests();
      await loadLicenses();
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to update installer request.');
    } finally {
      setRequestActionKey('');
    }
  };

  const renderPackagesTable = (version: InstallerVersionKey) => {
    const query = packageQuery.trim().toLowerCase();
    const items = (packagesByVersion[version] || []).filter((item) => {
      if (packageKindFilter !== 'all' && item.packageKind !== packageKindFilter) return false;
      if (packageStatusFilter === 'enabled' && !item.enabled) return false;
      if (packageStatusFilter === 'disabled' && item.enabled) return false;
      if (!query) return true;
      return [item.productCode, item.displayName, item.archiveName, item.downloadUrl]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
    return (
      <section className={`rounded-2xl border p-4 space-y-4 ${cardShell(theme)}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{version} Packages</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Manifest-driven packages used by the installer Worker for {version}.</div>
          </div>
          <Button type="button" size="sm" onClick={() => openCreatePackageDialog(version)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Package
          </Button>
        </div>
        <Table containerClassName={`rounded-xl border ${cardShell(theme)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Package Type</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>PRO MAX</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="w-[170px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm opacity-70">No packages yet.</TableCell></TableRow>}
            {items.map((item) => (
              <TableRow key={item.productCode}>
                <TableCell className="font-medium">{item.productCode}</TableCell>
                <TableCell>
                  <div>{item.displayName}</div>
                  <div className="text-xs opacity-60">
                    {item.partCount && item.partCount > 1 ? `${item.partCount} parts` : item.archiveName}
                  </div>
                </TableCell>
                <TableCell><InstallerKindBadge theme={theme} kind={item.packageKind} /></TableCell>
                <TableCell>{item.installOrder}</TableCell>
                <TableCell>{item.parts.reduce((total, part) => total + (part.downloadSize || 0), 0).toLocaleString()}</TableCell>
                <TableCell>{item.includeInProMax ? 'Yes' : 'No'}</TableCell>
                <TableCell>{item.enabled ? 'Yes' : 'No'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEditPackageDialog(item)}>Edit</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={packageActionKey === `delete:${item.productCode}`}
                      onClick={() => setConfirmDialog({
                        open: true,
                        title: 'Delete Package',
                        description: `Delete package ${item.productCode}?`,
                        confirmText: 'Delete Package',
                        variant: 'destructive',
                        action: async () => { await handleDeletePackage(item); },
                      })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    );
  };

  const renderCompletedInstallCell = (item: AdminInstallerLicense) => {
    const summary = summarizeCompletionMode(item.completedProductDetails, item.completedProducts);
    if (summary.productCodes.length === 0) return <span className="text-xs opacity-60">-</span>;
    return (
      <div className="space-y-1 text-xs">
        <InstallModeBadge theme={theme} mode={summary.mode} />
        <div className="opacity-80">{packageNameList(summary.productCodes, packageMap)}</div>
        {summary.targetPaths[0] ? (
          <div className="truncate opacity-60" title={summary.targetPaths[0]}>Target: {summary.targetPaths[0]}</div>
        ) : null}
        {summary.mode === 'unknown' ? (
          <div className="text-[11px] opacity-60">Completion exists but install mode was not recorded.</div>
        ) : null}
      </div>
    );
  };

  const renderLicensesTable = (version: InstallerVersionKey) => {
    const items = licensesByVersion[version] || [];
    return (
      <section className={`rounded-2xl border p-4 space-y-4 ${cardShell(theme)}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{version} Licenses</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>One row per customer license. Edit purchases in the dialog and copy the actual code when available.</div>
          </div>
          <Button type="button" size="sm" onClick={() => openCreateLicenseDialog(version)}>
            <Plus className="mr-2 h-4 w-4" />
            New License
          </Button>
        </div>
        <Table containerClassName={`rounded-xl border ${cardShell(theme)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>License</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Entitlements</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead className="w-[210px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm opacity-70">No licenses found.</TableCell></TableRow>}
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell><div className="font-medium">{item.customerName || 'Unnamed User'}</div><div className="text-xs opacity-60">#{item.id} | {item.redemptionCount} redemption(s)</div></TableCell>
                <TableCell>{item.rawCode ? <CopyableValue value={item.rawCode} label="license code" wrap /> : <span className="text-xs opacity-60">{item.codeHint || 'Legacy license'}</span>}</TableCell>
                <TableCell><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(theme, item.status)}`}>{item.status}</span></TableCell>
                <TableCell className="max-w-[260px] text-xs">{packageNameList(item.entitlements, packageMap, true)}</TableCell>
                <TableCell className="max-w-[260px] text-xs">{renderCompletedInstallCell(item)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEditLicenseDialog(item)}>Edit</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={licenseActionKey === `reset:${item.id}`}
                      onClick={() => setConfirmDialog({
                        open: true,
                        title: 'Reset License',
                        description: `Reset license #${item.id} to available and clear completions?`,
                        confirmText: 'Reset License',
                        variant: 'default',
                        action: async () => { await handleResetLicense(item.id); },
                      })}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={licenseActionKey === `delete:${item.id}`}
                      onClick={() => setConfirmDialog({
                        open: true,
                        title: 'Delete License',
                        description: `Delete license #${item.id}? This cannot be undone.`,
                        confirmText: 'Delete License',
                        variant: 'destructive',
                        action: async () => { await handleDeleteLicense(item.id); },
                      })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs opacity-70">Showing {items.length} of {licenseTotals[version]} | Page {licensePages[version]} of {totalPages(licenseTotals[version], licensePerPage)}</div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={licensePages[version] <= 1} onClick={() => setLicensePages((current) => ({ ...current, [version]: Math.max(1, current[version] - 1) }))}>Previous</Button>
            <Button type="button" size="sm" variant="outline" disabled={licensePages[version] >= totalPages(licenseTotals[version], licensePerPage)} onClick={() => setLicensePages((current) => ({ ...current, [version]: Math.min(totalPages(licenseTotals[version], licensePerPage), current[version] + 1) }))}>Next</Button>
          </div>
        </div>
      </section>
    );
  };

  const renderCatalogTable = (version: InstallerVersionKey) => {
    const query = catalogQuery.trim().toLowerCase();
    const items = (catalogByVersion[version] || []).filter((item) => {
      if (catalogTypeFilter !== 'all' && item.productType !== catalogTypeFilter) return false;
      if (catalogStatusFilter === 'enabled' && !item.enabled) return false;
      if (catalogStatusFilter === 'disabled' && item.enabled) return false;
      if (!query) return true;
      return [item.skuCode, item.displayName, item.description, item.productType]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
    return (
      <section className={`rounded-2xl border p-4 space-y-4 ${cardShell(theme)}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{version} Buy Catalog</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Public SKUs shown on the buy page for {version}. Package rows are auto-generated here.</div>
          </div>
          <Button type="button" size="sm" onClick={() => openCreateCatalogDialog(version)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Custom SKU
          </Button>
        </div>
        <Table containerClassName={`rounded-xl border ${cardShell(theme)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Product Type</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Entitlements</TableHead>
              <TableHead>Auto</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="w-[170px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm opacity-70">No buy products yet.</TableCell></TableRow>}
            {items.map((item) => (
              <TableRow key={`${item.version}:${item.skuCode}`}>
                <TableCell className="font-medium">
                  <div>{item.skuCode}</div>
                  <div className="text-xs opacity-60">{isAutoManagedCatalogProduct(item) ? 'Auto from Packages' : 'Custom SKU'}</div>
                </TableCell>
                <TableCell><div>{item.displayName}</div><div className="text-xs opacity-60">{item.description || '-'}</div></TableCell>
                <TableCell><InstallerProductTypeBadge theme={theme} type={item.productType} /></TableCell>
                <TableCell>{item.pricePhp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                <TableCell className="max-w-[260px] text-xs">{packageNameList(item.grantedEntitlements, packageMap, true)}</TableCell>
                <TableCell>{item.allowAutoApprove ? 'Yes' : 'No'}</TableCell>
                <TableCell>{item.enabled ? 'Yes' : 'No'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEditCatalogDialog(item)}>Edit</Button>
                    {!isAutoManagedCatalogProduct(item) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={catalogActionKey === `delete:${item.version}:${item.skuCode}`}
                        onClick={() => setConfirmDialog({
                          open: true,
                          title: 'Delete Buy SKU',
                          description: `Delete SKU ${item.skuCode}?`,
                          confirmText: 'Delete SKU',
                          variant: 'destructive',
                          action: async () => { await handleDeleteCatalogProduct(item); },
                        })}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    );
  };

  const renderTierUiEditor = (version: InstallerVersionKey) => {
    const items = tierUiByVersion[version]?.length
      ? tierUiByVersion[version]
      : INSTALLER_TIER_ORDER.map((tier) => defaultInstallerTierConfig(version, tier));
    return (
      <section className={`rounded-2xl border p-4 space-y-4 ${cardShell(theme)}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-base font-semibold">{version} Tier UI Config</div>
            <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Edits here control the {version} pricing cards: color, header, badge, descriptions, checklist, and included tools.</div>
          </div>
        </div>
        {(() => {
          const standardItem = items.find((entry) => entry.tier === 'standard') || defaultInstallerTierConfig(version, 'standard');
          const standardContent = normalizeInstallerTierUiContentForVersion(standardItem.uiContent, 'standard', version);
          return (
            <div className={`rounded-xl border p-3 ${cardShell(theme)}`}>
              <div className="mb-2">
                <div className="text-sm font-semibold">{version} Portrait Video</div>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Used by the {version} mobile pricing preview. Store a local asset path or a public/signed video URL.</div>
              </div>
              <Input
                className={`${inputClass(theme)} h-8 text-xs`}
                value={standardContent.video.src || ''}
                onChange={(event) => updateTierUiContent(version, 'standard', {
                  video: {
                    src: event.target.value,
                    storageProvider: 'local',
                    storageBucket: null,
                    storageKey: null,
                    assetName: null,
                  },
                })}
                placeholder={`/assets/${version.toLowerCase()}-preview.mp4`}
              />
            </div>
          );
        })()}
        <div className="grid gap-3 xl:grid-cols-3">
          {items.map((item) => {
            const content = normalizeInstallerTierUiContentForVersion(item.uiContent, item.tier, version);
            const shortDescription = content.shortDescriptions[0] || '';
            const otherDescription = content.otherDescriptions[0] || { title: '', body: '' };
            const hasSelectedUpdatesRow = content.inclusions.some((row) => /selected updates/i.test(row.title));
            return (
              <div key={`${version}:${item.tier}`} className={`space-y-3 rounded-xl border p-3 ${cardShell(theme)}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold uppercase">{item.tier.replace('_', ' ')}</div>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={item.isActive !== false}
                      onCheckedChange={(checked) => updateTierUiDraft(version, item.tier, (current) => ({ ...current, isActive: checked === true }))}
                    />
                    Active
                  </label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tier Name</Label>
                  <Input className={inputClass(theme)} value={item.displayName} onChange={(event) => updateTierUiDraft(version, item.tier, (current) => ({ ...current, displayName: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Subtitle Fallback</Label>
                  <Input className={inputClass(theme)} value={item.description} onChange={(event) => updateTierUiDraft(version, item.tier, (current) => ({ ...current, description: event.target.value }))} />
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border px-3 py-2 text-xs">
                  <input
                    type="color"
                    value={content.color}
                    onChange={(event) => updateTierUiContent(version, item.tier, { color: event.target.value })}
                    className="h-8 w-10 rounded border bg-transparent p-0"
                    aria-label={`${version} ${item.displayName} card color`}
                  />
                  <Input className={`${inputClass(theme)} h-8 text-xs`} value={content.color} onChange={(event) => updateTierUiContent(version, item.tier, { color: event.target.value })} />
                </div>
                <div className="grid grid-cols-[1fr_5rem] items-center gap-2 rounded-md border px-3 py-2 text-xs">
                  <label>
                    <span className="mb-1 block font-semibold">Tier line bar</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={content.meterPercent}
                      onChange={(event) => updateTierUiContent(version, item.tier, { meterPercent: Number(event.target.value) })}
                      className="w-full"
                    />
                  </label>
                  <Input className={`${inputClass(theme)} h-8 text-xs`} value={String(content.meterPercent)} onChange={(event) => updateTierUiContent(version, item.tier, { meterPercent: Number(event.target.value) })} />
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Card Header</div>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={content.cardHeader.enabled}
                        onCheckedChange={(checked) => updateTierUiContent(version, item.tier, { cardHeader: { ...content.cardHeader, enabled: checked === true } })}
                      />
                      Enabled
                    </label>
                  </div>
                  <Input className={`${inputClass(theme)} h-8 text-xs`} value={content.cardHeader.label} onChange={(event) => updateTierUiContent(version, item.tier, { cardHeader: { ...content.cardHeader, label: event.target.value } })} placeholder="Most Popular" />
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Title Badge</div>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={content.versionBadge.enabled}
                        onCheckedChange={(checked) => updateTierUiContent(version, item.tier, { versionBadge: { ...content.versionBadge, enabled: checked === true } })}
                      />
                      Enabled
                    </label>
                  </div>
                  <Input className={`${inputClass(theme)} h-8 text-xs`} value={content.versionBadge.label} onChange={(event) => updateTierUiContent(version, item.tier, { versionBadge: { ...content.versionBadge, label: event.target.value } })} placeholder={version} />
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Short Description</div>
                  </div>
                  <Input
                    className={`${inputClass(theme)} h-8 text-xs`}
                    value={shortDescription}
                    onChange={(event) => updateTierUiRow(version, item.tier, 'shortDescriptions', [event.target.value])}
                  />
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Other Description</div>
                  </div>
                  <div className="space-y-1 rounded border p-2">
                    <Input
                      className={`${inputClass(theme)} h-8 text-xs`}
                      value={otherDescription.title}
                      onChange={(event) => updateTierUiRow(version, item.tier, 'otherDescriptions', [{
                        ...otherDescription,
                        title: event.target.value,
                      }])}
                      placeholder="Title"
                    />
                    <textarea
                      value={otherDescription.body || ''}
                      onChange={(event) => updateTierUiRow(version, item.tier, 'otherDescriptions', [{
                        ...otherDescription,
                        body: event.target.value,
                      }])}
                      className={`min-h-14 w-full rounded-md border px-2 py-1 text-xs ${inputClass(theme)}`}
                      placeholder="Description"
                    />
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Checklist Rows</div>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => updateTierUiRow(version, item.tier, 'checklist', [...content.checklist, 'New checklist item'])}>Add</Button>
                  </div>
                  <div className="space-y-2">
                    {content.checklist.map((row, index) => (
                      <div key={`${item.tier}:check:${index}`} className="grid grid-cols-[auto_1fr_auto] gap-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0"
                            disabled={index === 0}
                            aria-label="Move checklist row up"
                            onClick={() => moveTierUiRow(version, item.tier, 'checklist', index, -1)}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0"
                            disabled={index >= content.checklist.length - 1}
                            aria-label="Move checklist row down"
                            onClick={() => moveTierUiRow(version, item.tier, 'checklist', index, 1)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Input
                          className={`${inputClass(theme)} h-8 text-xs`}
                          value={row}
                          onChange={(event) => {
                            const rows = [...content.checklist];
                            rows[index] = event.target.value;
                            updateTierUiRow(version, item.tier, 'checklist', rows);
                          }}
                        />
                        <Button size="sm" variant="outline" className="h-8 px-2 text-[11px]" onClick={() => updateTierUiRow(version, item.tier, 'checklist', content.checklist.filter((_, rowIndex) => rowIndex !== index))}>Delete</Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Bottom Inclusions</div>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => updateTierUiRow(version, item.tier, 'inclusions', [...content.inclusions, { title: 'New included tool', badge: 'ENABLED', enabled: true }])}>Add</Button>
                  </div>
                  {item.tier === 'pro' && !hasSelectedUpdatesRow ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mb-2 h-7 px-2 text-[11px]"
                      onClick={() => updateTierUiRow(version, item.tier, 'inclusions', [...content.inclusions, { title: 'Selected updates', badge: 'OPTIONAL', enabled: false }])}
                    >
                      Restore Selected Updates row
                    </Button>
                  ) : null}
                  <Input className={`${inputClass(theme)} mb-2 h-8 text-xs`} value={content.inclusionTitle} onChange={(event) => updateTierUiContent(version, item.tier, { inclusionTitle: event.target.value })} placeholder="Included Tools" />
                  <div className="space-y-2">
                    {content.inclusions.map((row, index) => (
                      <div key={`${item.tier}:inclusion:${index}`} className="space-y-1 rounded border p-2">
                        <div className="grid grid-cols-[auto_1fr_7rem] gap-2">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              disabled={index === 0}
                              aria-label="Move inclusion row up"
                              onClick={() => moveTierUiRow(version, item.tier, 'inclusions', index, -1)}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              disabled={index >= content.inclusions.length - 1}
                              aria-label="Move inclusion row down"
                              onClick={() => moveTierUiRow(version, item.tier, 'inclusions', index, 1)}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <Input
                            className={`${inputClass(theme)} h-8 text-xs`}
                            value={row.title}
                            onChange={(event) => {
                              const rows = [...content.inclusions];
                              rows[index] = { ...row, title: event.target.value };
                              updateTierUiRow(version, item.tier, 'inclusions', rows);
                            }}
                            placeholder="Included tool"
                          />
                          <Input
                            className={`${inputClass(theme)} h-8 text-xs`}
                            value={row.badge}
                            onChange={(event) => {
                              const rows = [...content.inclusions];
                              rows[index] = { ...row, badge: event.target.value };
                              updateTierUiRow(version, item.tier, 'inclusions', rows);
                            }}
                            placeholder="ENABLED"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={row.enabled}
                              onCheckedChange={(checked) => {
                                const rows = [...content.inclusions];
                                rows[index] = { ...row, enabled: checked === true };
                                updateTierUiRow(version, item.tier, 'inclusions', rows);
                              }}
                            />
                            Enabled badge style
                          </label>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => updateTierUiRow(version, item.tier, 'inclusions', content.inclusions.filter((_, rowIndex) => rowIndex !== index))}>Delete</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderRequestsTable = (version: InstallerVersionKey) => {
    const items = requestsByVersion[version] || [];
    return (
      <section className={`rounded-2xl border p-4 space-y-4 ${cardShell(theme)}`}>
        <div>
          <div className="text-base font-semibold">{version} Purchase Requests</div>
          <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Buyer submissions waiting for approval or already fulfilled for {version}.</div>
        </div>
        <Table containerClassName={`rounded-xl border ${cardShell(theme)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Receipt Ref</TableHead>
              <TableHead>License</TableHead>
              <TableHead className="w-[190px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm opacity-70">No requests found.</TableCell></TableRow>}
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell><div className="font-medium">{item.email}</div><div className="text-xs opacity-60">{formatDateTime(item.createdAt)}</div></TableCell>
                <TableCell>
                  <div>{item.displayNameSnapshot}</div>
                  <div className="text-xs opacity-60">{item.skuCode}</div>
                  <div className="mt-1">
                    <InstallerProductTypeBadge theme={theme} type={item.productType} compact />
                  </div>
                </TableCell>
                <TableCell><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(theme, item.status)}`}>{item.status}</span></TableCell>
                <TableCell>{item.receiptReference ? <CopyableValue value={item.receiptReference} label="receipt reference" wrap /> : '-'}</TableCell>
                <TableCell>{item.issuedLicenseCode ? <CopyableValue value={item.issuedLicenseCode} label="license code" wrap /> : <span className="text-xs opacity-60">Not issued</span>}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setRequestDialog({ open: true, item })}>Open</Button>
                    {item.status === 'pending' && (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={requestActionKey === `approve:${item.id}`} onClick={() => void handleInstallerRequestAction(item, 'approve')}>Approve</Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={requestActionKey === `reject:${item.id}`}
                          onClick={() => setRejectDialog({ open: true, item, reason: item.rejectionMessage || '' })}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs opacity-70">Showing {items.length} of {requestTotals[version]} | Page {requestPages[version]} of {totalPages(requestTotals[version], requestPerPage)}</div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={requestPages[version] <= 1} onClick={() => setRequestPages((current) => ({ ...current, [version]: Math.max(1, current[version] - 1) }))}>Previous</Button>
            <Button type="button" size="sm" variant="outline" disabled={requestPages[version] >= totalPages(requestTotals[version], requestPerPage)} onClick={() => setRequestPages((current) => ({ ...current, [version]: Math.min(totalPages(requestTotals[version], requestPerPage), current[version] + 1) }))}>Next</Button>
          </div>
        </div>
      </section>
    );
  };

  const renderEventsTable = (version: InstallerVersionKey) => {
    const items = eventsByVersion[version] || [];
    const eventProductCode = (event: AdminInstallerEvent) => {
      const payload = asInstallerRecord(event.payload);
      return String(event.productCode ?? payload.productCode ?? payload.product_code ?? '').trim();
    };
    const eventCompletedProducts = (event: AdminInstallerEvent) => {
      const payload = asInstallerRecord(event.payload);
      if (Array.isArray(event.completedProducts) && event.completedProducts.length > 0) return event.completedProducts;
      return Array.isArray(payload.completedProducts) ? payload.completedProducts.map((item) => String(item || '').trim()).filter(Boolean) : [];
    };
    const eventRequestedProducts = (event: AdminInstallerEvent) => {
      const payload = asInstallerRecord(event.payload);
      return Array.isArray(payload.requestedProducts) ? payload.requestedProducts.map((item) => String(item || '').trim()).filter(Boolean) : [];
    };
    const eventInstallMode = (event: AdminInstallerEvent): CompletionModeSummary => {
      const payload = asInstallerRecord(event.payload);
      return normalizeInstallMode(
        event.installMode ?? payload.installMode ?? payload.install_mode,
        event.portableMode ?? payload.portableMode ?? payload.portable_mode,
      ) || 'unknown';
    };
    const eventTargetPath = (event: AdminInstallerEvent) => {
      const payload = asInstallerRecord(event.payload);
      return String(event.targetPath ?? payload.targetPath ?? payload.target_path ?? '').trim();
    };
    const eventMachineId = (event: AdminInstallerEvent) => {
      const payload = asInstallerRecord(event.payload);
      return String(event.machineId ?? payload.machineId ?? payload.machine_id ?? '').trim();
    };
    return (
      <section className={`rounded-2xl border p-4 space-y-4 ${cardShell(theme)}`}>
        <div>
          <div className="text-base font-semibold">{version} Events</div>
          <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Claim, complete, and release history from the installer Worker.</div>
        </div>
        <Table containerClassName={`rounded-xl border ${cardShell(theme)}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>User</TableHead>
              <TableHead>License</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm opacity-70">No events found.</TableCell></TableRow>}
            {items.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="text-xs">{formatDateTime(event.createdAt)}</TableCell>
                <TableCell><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${eventBadgeClass(theme, event.eventType)}`}>{event.eventType}</span></TableCell>
                <TableCell>{event.customerName || 'Unnamed User'}</TableCell>
                <TableCell>{event.codeHint || `#${event.licenseId}`}</TableCell>
                <TableCell className="text-xs">{packageNameList([eventProductCode(event)].filter(Boolean), packageMap, true)}</TableCell>
                <TableCell className="max-w-[320px] text-xs">
                  <div className="mb-1"><InstallModeBadge theme={theme} mode={eventInstallMode(event)} /></div>
                  <div>Requested: {packageNameList(eventRequestedProducts(event), packageMap, true)}</div>
                  <div>Completed: {packageNameList(eventCompletedProducts(event), packageMap)}</div>
                  {eventTargetPath(event) ? <div className="truncate opacity-70" title={eventTargetPath(event)}>Target: {eventTargetPath(event)}</div> : null}
                  {eventMachineId(event) ? <div className="truncate opacity-70" title={eventMachineId(event)}>Machine: {eventMachineId(event)}</div> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs opacity-70">Showing {items.length} of {eventTotals[version]} | Page {eventPages[version]} of {totalPages(eventTotals[version], eventPerPage)}</div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={eventPages[version] <= 1} onClick={() => setEventPages((current) => ({ ...current, [version]: Math.max(1, current[version] - 1) }))}>Previous</Button>
            <Button type="button" size="sm" variant="outline" disabled={eventPages[version] >= totalPages(eventTotals[version], eventPerPage)} onClick={() => setEventPages((current) => ({ ...current, [version]: Math.min(totalPages(eventTotals[version], eventPerPage), current[version] + 1) }))}>Next</Button>
          </div>
        </div>
      </section>
    );
  };

  const packageDialogBusy = packageActionKey !== '';
  const licenseDialogBusy = licenseActionKey.startsWith(licenseDialog.mode);
  const entitlementGroups = getEntitlementGroups(licenseDialog.version);
  const currentViewLoading =
    (view === 'packages' && packagesLoading) ||
    (view === 'licenses' && licensesLoading) ||
    (view === 'catalog' && catalogLoading) ||
    (view === 'tierUi' && tierUiLoading) ||
    (view === 'requests' && requestsLoading) ||
    (view === 'events' && eventsLoading);

  const installerStats = React.useMemo(() => {
    const packageCount = allPackages.length;
    const activePackageCount = allPackages.filter((item) => item.enabled).length;
    const licenseCount = Number(licenseTotals.V2 || 0) + Number(licenseTotals.V3 || 0);
    const pendingRequests = [...requestsByVersion.V2, ...requestsByVersion.V3].filter((item) => item.status === 'pending').length;
    const eventCount = Number(eventTotals.V2 || 0) + Number(eventTotals.V3 || 0);
    return [
      { label: 'Packages', value: packageCount, detail: `${activePackageCount} enabled`, toneClass: 'text-fuchsia-500' },
      { label: 'Licenses', value: licenseCount, detail: 'V2 + V3 inventory', toneClass: 'text-blue-500' },
      { label: 'Pending Requests', value: pendingRequests, detail: 'Buyer approvals waiting', toneClass: 'text-amber-500' },
      { label: 'Tier UI', value: hasUnsavedTierUiChanges ? 'Unsaved' : 'Saved', detail: 'V2/V3 pricing cards', toneClass: 'text-pink-500' },
      { label: 'Events', value: eventCount, detail: 'Recent Worker activity', toneClass: 'text-emerald-500' },
    ];
  }, [allPackages, eventTotals, hasUnsavedTierUiChanges, licenseTotals, requestsByVersion]);

  if (isTierConfigMode) {
    const version = tierConfigVersion || 'V2';
    const tierSaveDisabled = tierUiSaving || !hasUnsavedTierUiChanges;
    return (
      <AdminPageScaffold
        embedded={embedded}
        panelClass={panelClass}
        title={`${version} Tier Config`}
        description={`Configure the ${version} public pricing cards, portrait video, headers, badges, descriptions, checklist rows, and included tools.`}
        actions={(
          <>
            {!embedded ? <Button type="button" size="sm" variant="success" onClick={() => void saveTierUiConfigs(version)} disabled={tierSaveDisabled} className="rounded-[14px]">
              {tierUiSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              {tierUiSaving ? 'Saving...' : 'Save Changes'}
            </Button> : null}
            {!embedded ? <AdminRefreshButton
              loading={tierUiLoading}
              onClick={() => void loadTierUi()}
            /> : null}
          </>
        )}
        stickySave={!embedded ? {
          dirty: hasUnsavedTierUiChanges,
          saving: tierUiSaving,
          disabled: tierSaveDisabled,
          label: 'Save Changes',
          savingLabel: 'Saving...',
          message: `Unsaved ${version} pricing-card edits are local until saved.`,
          onSave: () => void saveTierUiConfigs(version),
        } : undefined}
        controls={!embedded ? versionTabs : undefined}
      >
        {tierUiLoading ? <AdminTierConfigLoadingSkeleton theme={theme} /> : renderTierUiEditor(version)}
      </AdminPageScaffold>
    );
  }

  return (
    <AdminPageScaffold
      panelClass={panelClass}
      title="Installer Manager"
      description="Manage V2 and V3 packages, licenses, buy catalog, buyer requests, and event history from one aligned admin workspace."
      actions={(
        <>
          {view === 'tierUi' ? (
            <Button type="button" size="sm" variant="success" onClick={() => void saveTierUiConfigs()} disabled={tierUiSaving || !hasUnsavedTierUiChanges} className="rounded-[14px]">
              {tierUiSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              {tierUiSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          ) : null}
          <AdminRefreshButton
            loading={currentViewLoading}
            onClick={() => {
              if (view === 'packages') void reloadPackages();
              if (view === 'licenses') void loadLicenses();
              if (view === 'catalog') void loadCatalog();
              if (view === 'tierUi') void loadTierUi();
              if (view === 'requests') void loadRequests();
              if (view === 'events') void loadEvents();
            }}
          />
        </>
      )}
      stats={<AdminStatsStrip items={installerStats} />}
      stickySave={view === 'tierUi' ? {
        dirty: hasUnsavedTierUiChanges,
        saving: tierUiSaving,
        disabled: tierUiSaving || !hasUnsavedTierUiChanges,
        label: 'Save Changes',
        savingLabel: 'Saving...',
        message: 'Unsaved V2/V3 pricing-card edits are local until saved.',
        onSave: () => void saveTierUiConfigs(),
      } : undefined}
      controls={(
        <AdminSectionTabs
          sections={[
            { key: 'licenses', label: 'Licenses' },
            { key: 'packages', label: 'Packages' },
            { key: 'catalog', label: 'Catalog' },
            { key: 'requests', label: 'Requests' },
            { key: 'events', label: 'Events' },
          ]}
          active={view}
          onChange={(next) => setView(next as ViewKey)}
        />
      )}
    >

      {view === 'packages' && (
        <>
          <AdminToolbar
            search={{
              value: packageQuery,
              onChange: setPackageQuery,
              placeholder: 'Search package code, name, archive, or URL...',
            }}
            resultLabel={`${(packagesByVersion.V2.length + packagesByVersion.V3.length).toLocaleString()} packages`}
            activeFilterCount={Number(Boolean(packageQuery.trim())) + Number(packageKindFilter !== 'all') + Number(packageStatusFilter !== 'all')}
            onClearFilters={() => {
              setPackageQuery('');
              setPackageKindFilter('all');
              setPackageStatusFilter('all');
            }}
            primaryFilters={(
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <select className={selectClass(theme)} value={packageKindFilter} onChange={(event) => setPackageKindFilter(event.target.value as typeof packageKindFilter)}>
                  <option value="all">All package types</option>
                  <option value="standard">Standard packages</option>
                  <option value="update">Update packages</option>
                </select>
                <select className={selectClass(theme)} value={packageStatusFilter} onChange={(event) => setPackageStatusFilter(event.target.value as typeof packageStatusFilter)}>
                  <option value="all">All package statuses</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            )}
          />
          {renderPackagesTable('V2')}
          {renderPackagesTable('V3')}
        </>
      )}

      {view === 'licenses' && (
        <>
          <AdminToolbar
            search={{
              value: licenseQuery,
              onChange: (value) => { setLicenseQuery(value); setLicensePages({ V2: 1, V3: 1 }); },
              placeholder: 'Search by customer or code hint...',
            }}
            resultLabel={`${Number(licenseTotals.V2 || 0) + Number(licenseTotals.V3 || 0)} licenses`}
            activeFilterCount={Number(Boolean(licenseQuery.trim())) + Number(licenseStatus !== 'all')}
            onClearFilters={() => {
              setLicenseQuery('');
              setLicenseStatus('all');
              setLicensePages({ V2: 1, V3: 1 });
            }}
            primaryFilters={(
              <select className={selectClass(theme)} value={licenseStatus} onChange={(event) => { setLicenseStatus(event.target.value as typeof licenseStatus); setLicensePages({ V2: 1, V3: 1 }); }}>
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="claimed">Claimed</option>
                <option value="used">Used</option>
                <option value="disabled">Disabled</option>
              </select>
            )}
          />
          <section className={`hidden rounded-2xl border p-4 space-y-3 ${cardShell(theme)}`}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-base font-semibold">License Filters</div>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Shared filters for both V2 and V3 tables to keep requests small and paginated.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input className={`${inputClass(theme)} w-60`} placeholder="Search by customer or code hint" value={licenseQuery} onChange={(event) => { setLicenseQuery(event.target.value); setLicensePages({ V2: 1, V3: 1 }); }} />
                <select className={selectClass(theme)} value={licenseStatus} onChange={(event) => { setLicenseStatus(event.target.value as typeof licenseStatus); setLicensePages({ V2: 1, V3: 1 }); }}>
                  <option value="all">All statuses</option>
                  <option value="available">Available</option>
                  <option value="claimed">Claimed</option>
                  <option value="used">Used</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
          </section>
          {renderLicensesTable('V2')}
          {renderLicensesTable('V3')}
        </>
      )}

      {view === 'catalog' && (
        <>
          <AdminToolbar
            search={{
              value: catalogQuery,
              onChange: setCatalogQuery,
              placeholder: 'Search SKU, name, description, or product type...',
            }}
            resultLabel={`${(catalogByVersion.V2.length + catalogByVersion.V3.length).toLocaleString()} SKUs`}
            activeFilterCount={Number(Boolean(catalogQuery.trim())) + Number(catalogTypeFilter !== 'all') + Number(catalogStatusFilter !== 'all')}
            onClearFilters={() => {
              setCatalogQuery('');
              setCatalogTypeFilter('all');
              setCatalogStatusFilter('all');
            }}
            primaryFilters={(
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <select className={selectClass(theme)} value={catalogTypeFilter} onChange={(event) => setCatalogTypeFilter(event.target.value as typeof catalogTypeFilter)}>
                <option value="all">All product types</option>
                <option value="standard">Standard</option>
                <option value="update">Update only</option>
                <option value="promax">PRO MAX bundle</option>
                </select>
                <select className={selectClass(theme)} value={catalogStatusFilter} onChange={(event) => setCatalogStatusFilter(event.target.value as typeof catalogStatusFilter)}>
                  <option value="all">All SKU statuses</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            )}
          />
          {renderCatalogTable('V2')}
          {renderCatalogTable('V3')}
        </>
      )}

      {view === 'tierUi' && (
        <>
          {tierUiLoading ? (
            <AdminTierConfigLoadingSkeleton theme={theme} />
          ) : (
            <>
              {renderTierUiEditor('V2')}
              {renderTierUiEditor('V3')}
            </>
          )}
        </>
      )}

      {view === 'requests' && (
        <>
          <AdminToolbar
            search={{
              value: requestQuery,
              onChange: (value) => { setRequestQuery(value); setRequestPages({ V2: 1, V3: 1 }); },
              placeholder: 'Search email, SKU, receipt, or license...',
            }}
            resultLabel={`${Number(requestTotals.V2 || 0) + Number(requestTotals.V3 || 0)} requests`}
            activeFilterCount={Number(Boolean(requestQuery.trim())) + Number(requestStatus !== 'all')}
            onClearFilters={() => {
              setRequestQuery('');
              setRequestStatus('all');
              setRequestPages({ V2: 1, V3: 1 });
            }}
            primaryFilters={(
              <select className={selectClass(theme)} value={requestStatus} onChange={(event) => { setRequestStatus(event.target.value as typeof requestStatus); setRequestPages({ V2: 1, V3: 1 }); }}>
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            )}
          />
          <section className={`hidden rounded-2xl border p-4 space-y-3 ${cardShell(theme)}`}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-base font-semibold">Request Filters</div>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Shared filters for both V2 and V3 buyer request tables.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input className={`${inputClass(theme)} w-64`} placeholder="Search email, SKU, receipt, or license" value={requestQuery} onChange={(event) => { setRequestQuery(event.target.value); setRequestPages({ V2: 1, V3: 1 }); }} />
                <select className={selectClass(theme)} value={requestStatus} onChange={(event) => { setRequestStatus(event.target.value as typeof requestStatus); setRequestPages({ V2: 1, V3: 1 }); }}>
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
          </section>
          {renderRequestsTable('V2')}
          {renderRequestsTable('V3')}
        </>
      )}

      {view === 'events' && (
        <>
          <AdminToolbar
            search={{
              value: eventQuery,
              onChange: (value) => { setEventQuery(value); setEventPages({ V2: 1, V3: 1 }); },
              placeholder: 'Search by customer or code hint...',
            }}
            resultLabel={`${Number(eventTotals.V2 || 0) + Number(eventTotals.V3 || 0)} events`}
            activeFilterCount={Number(Boolean(eventQuery.trim())) + Number(eventType !== 'all')}
            onClearFilters={() => {
              setEventQuery('');
              setEventType('all');
              setEventPages({ V2: 1, V3: 1 });
            }}
            primaryFilters={(
              <select className={selectClass(theme)} value={eventType} onChange={(event) => { setEventType(event.target.value as typeof eventType); setEventPages({ V2: 1, V3: 1 }); }}>
                <option value="all">All events</option>
                <option value="claim">Claim</option>
                <option value="complete">Complete</option>
                <option value="release">Release</option>
              </select>
            )}
          />
          <section className={`hidden rounded-2xl border p-4 space-y-3 ${cardShell(theme)}`}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-base font-semibold">Event Filters</div>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Shared filters for both V2 and V3 event tables.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input className={`${inputClass(theme)} w-60`} placeholder="Search by customer or code hint" value={eventQuery} onChange={(event) => { setEventQuery(event.target.value); setEventPages({ V2: 1, V3: 1 }); }} />
                <select className={selectClass(theme)} value={eventType} onChange={(event) => { setEventType(event.target.value as typeof eventType); setEventPages({ V2: 1, V3: 1 }); }}>
                  <option value="all">All events</option>
                  <option value="claim">Claim</option>
                  <option value="complete">Complete</option>
                  <option value="release">Release</option>
                </select>
              </div>
            </div>
          </section>
          {renderEventsTable('V2')}
          {renderEventsTable('V3')}
        </>
      )}

      <Dialog open={packageDialog.open} onOpenChange={(open) => setPackageDialog((current) => ({ ...current, open }))}>
        <DialogContent className={theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-100' : ''}>
          <DialogHeader>
            <DialogTitle>{packageDialog.mode === 'create' ? 'Add Package' : 'Edit Package'}</DialogTitle>
            <DialogDescription>Update the package manifest row for {packageDialog.draft.version}. Changes apply to future installer sessions.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Version</Label><select value={packageDialog.draft.version} disabled={packageDialog.mode === 'edit'} className={selectClass(theme)} onChange={(event) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, version: event.target.value as InstallerVersionKey, productCode: `${event.target.value}_` } }))}>{VERSIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs">Product Code</Label><Input className={inputClass(theme)} value={packageDialog.draft.productCode} onChange={(event) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, productCode: event.target.value.toUpperCase() } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Display Name</Label><Input className={inputClass(theme)} value={packageDialog.draft.displayName} onChange={(event) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, displayName: event.target.value } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Install Order</Label><Input className={inputClass(theme)} type="number" value={packageDialog.draft.installOrder} onChange={(event) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, installOrder: Number(event.target.value || 0) } }))} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Package Type</Label>
              <select className={selectClass(theme)} value={packageDialog.draft.packageKind} onChange={(event) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, packageKind: event.target.value as InstallerPackage['packageKind'] } }))}>
                <option value="standard">Standard package</option>
                <option value="update">Update package</option>
              </select>
              <div className="text-[11px] leading-snug opacity-60">{installerPackageKindMeta(packageDialog.draft.packageKind).description}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={packageDialog.draft.includeInProMax} onCheckedChange={(checked) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, includeInProMax: Boolean(checked) } }))} /><span>Include in PRO MAX</span></label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={packageDialog.draft.enabled} onCheckedChange={(checked) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, enabled: Boolean(checked) } }))} /><span>Enabled</span></label>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Package Parts</div>
                <div className="text-xs opacity-70">Use one part for normal packages, or add multiple parts for split archives like `.001`, `.002`, `.003`.</div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addPackagePart}>
                <Plus className="mr-2 h-4 w-4" />
                Add Part
              </Button>
            </div>
            <div className="space-y-3">
              {packageDialog.draft.parts.map((part) => (
                <div key={part.partIndex} className={`rounded-xl border p-3 space-y-3 ${cardShell(theme)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Part {part.partIndex}</div>
                    <Button type="button" size="sm" variant="ghost" disabled={packageDialog.draft.parts.length <= 1} onClick={() => removePackagePart(part.partIndex)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1"><Label className="text-xs">Part Index</Label><Input className={inputClass(theme)} type="number" min="1" value={part.partIndex} onChange={(event) => updatePackagePart(part.partIndex, (current) => ({ ...current, partIndex: Number(event.target.value || current.partIndex || 1) }))} /></div>
                    <div className="space-y-1"><Label className="text-xs">Archive Name</Label><Input className={inputClass(theme)} value={part.archiveName} onChange={(event) => updatePackagePart(part.partIndex, (current) => ({ ...current, archiveName: event.target.value }))} /></div>
                    <div className="space-y-1 md:col-span-2"><Label className="text-xs">Download URL</Label><Input className={inputClass(theme)} value={part.downloadUrl} onChange={(event) => updatePackagePart(part.partIndex, (current) => ({ ...current, downloadUrl: event.target.value }))} /></div>
                    <div className="space-y-1"><Label className="text-xs">SHA-256</Label><Input className={inputClass(theme)} value={part.sha256} onChange={(event) => updatePackagePart(part.partIndex, (current) => ({ ...current, sha256: event.target.value }))} /></div>
                    <div className="space-y-1"><Label className="text-xs">Zip Password</Label><Input className={inputClass(theme)} value={part.zipPassword} onChange={(event) => updatePackagePart(part.partIndex, (current) => ({ ...current, zipPassword: event.target.value }))} /></div>
                    <div className="space-y-1"><Label className="text-xs">Download Size (bytes)</Label><Input className={inputClass(theme)} type="number" min="0" value={part.downloadSize} onChange={(event) => updatePackagePart(part.partIndex, (current) => ({ ...current, downloadSize: Number(event.target.value || 0) }))} /></div>
                    <div className="space-y-1 flex items-end"><label className="flex items-center gap-2 text-sm"><Checkbox checked={part.enabled} onCheckedChange={(checked) => updatePackagePart(part.partIndex, (current) => ({ ...current, enabled: Boolean(checked) }))} /><span>Enabled</span></label></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPackageDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
            <Button type="button" onClick={() => void handleSavePackageDialog()} disabled={packageDialogBusy}>{packageDialogBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Package</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogDialog.open} onOpenChange={(open) => setCatalogDialog((current) => ({ ...current, open }))}>
        <DialogContent className={`max-w-3xl ${theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-100' : ''}`}>
          <DialogHeader>
            <DialogTitle>{catalogDialog.mode === 'create' ? 'Add Buy SKU' : 'Edit Buy SKU'}</DialogTitle>
            <DialogDescription>Control what buyers can purchase on `/buy`, including price, copy, auto-approval eligibility, and granted entitlements.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Version</Label><select value={catalogDialog.draft.version} disabled={catalogDialog.mode === 'edit'} className={selectClass(theme)} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, version: event.target.value as InstallerVersionKey, skuCode: `${event.target.value}_STANDARD`, grantedEntitlements: [] } }))}>{VERSIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs">SKU Code</Label><Input className={inputClass(theme)} value={catalogDialog.draft.skuCode} disabled={catalogDraftAutoManaged} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, skuCode: event.target.value.toUpperCase() } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Display Name</Label><Input className={inputClass(theme)} value={catalogDialog.draft.displayName} disabled={catalogDraftAutoManaged} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, displayName: event.target.value } }))} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Product Type</Label>
              <select className={selectClass(theme)} value={catalogDialog.draft.productType} disabled={catalogDraftAutoManaged} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, productType: event.target.value as InstallerBuyProduct['productType'] } }))}>
                <option value="standard">Standard</option>
                <option value="update">Update only</option>
                <option value="promax">PRO MAX bundle</option>
              </select>
              <div className="text-[11px] leading-snug opacity-60">{installerProductTypeMeta(catalogDialog.draft.productType).description}</div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Price (PHP)</Label><Input className={inputClass(theme)} type="number" min="0" step="0.01" value={catalogDialog.draft.pricePhp} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, pricePhp: Number(event.target.value || 0) } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Sort Order</Label><Input className={inputClass(theme)} type="number" min="0" value={catalogDialog.draft.sortOrder} disabled={catalogDraftAutoManaged} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, sortOrder: Number(event.target.value || 0) } }))} /></div>
            <div className="space-y-1 md:col-span-2"><Label className="text-xs">Description</Label><Input className={inputClass(theme)} value={catalogDialog.draft.description} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, description: event.target.value } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Hero Image URL</Label><Input className={inputClass(theme)} value={catalogDialog.draft.heroImageUrl} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, heroImageUrl: event.target.value } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Download Link Override</Label><Input className={inputClass(theme)} value={catalogDialog.draft.downloadLinkOverride} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, downloadLinkOverride: event.target.value } }))} /></div>
          </div>
          {catalogDraftAutoManaged ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This SKU is auto-managed from Packages. Price and buyer-facing fields can be edited here, while code, type, order, and entitlements stay synced from the manifest.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={catalogDialog.draft.allowAutoApprove} onCheckedChange={(checked) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, allowAutoApprove: Boolean(checked) } }))} /><span>Allow auto approval</span></label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={catalogDialog.draft.enabled} onCheckedChange={(checked) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, enabled: Boolean(checked) } }))} /><span>Enabled</span></label>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Granted Entitlements</div>
            <div className="flex flex-wrap gap-2">
              {(packagesByVersion[catalogDialog.draft.version] || []).map((pkg) => (
                <label key={pkg.productCode} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cardShell(theme)}`}>
                  <Checkbox disabled={catalogDraftAutoManaged} checked={catalogDialog.draft.grantedEntitlements.includes(pkg.productCode)} onCheckedChange={(checked) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, grantedEntitlements: toggleValue(current.draft.grantedEntitlements, pkg.productCode, Boolean(checked)) } }))} />
                  <span>{pkg.displayName}</span>
                  <InstallerKindBadge theme={theme} kind={pkg.packageKind} compact />
                  <span className="opacity-60">{pkg.productCode}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCatalogDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
            <Button type="button" onClick={() => void handleSaveCatalogDialog()} disabled={Boolean(catalogActionKey)}>{catalogActionKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save SKU</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={licenseDialog.open} onOpenChange={(open) => setLicenseDialog((current) => ({ ...current, open }))}>
        <DialogContent className={`max-w-2xl ${theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-100' : ''}`}>
          <DialogHeader>
            <DialogTitle>{licenseDialog.mode === 'create' ? `New ${licenseDialog.version} License` : `Edit ${licenseDialog.version} License`}</DialogTitle>
            <DialogDescription>Manage customer purchase entitlements in one place. New codes are generated on create and shown once for copying.</DialogDescription>
          </DialogHeader>
          {createdCode && licenseDialog.mode === 'create' && <div className={`rounded-lg border px-3 py-2 text-sm ${cardShell(theme)}`}><div className="mb-1 text-xs opacity-70">Generated License</div><CopyableValue value={createdCode} label="license code" wrap /></div>}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Customer Name</Label><Input className={inputClass(theme)} value={licenseDialog.draft.customerName} onChange={(event) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, customerName: event.target.value } }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input className={inputClass(theme)} value={licenseDialog.draft.notes} onChange={(event) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, notes: event.target.value } }))} /></div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={licenseDialog.draft.unlimited} onCheckedChange={(checked) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, unlimited: Boolean(checked) } }))} /><span>Unlimited</span></label>
            {licenseDialog.mode === 'edit' && <label className="flex items-center gap-2 text-sm"><Checkbox checked={licenseDialog.draft.disabled} onCheckedChange={(checked) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, disabled: Boolean(checked) } }))} /><span>Disabled</span></label>}
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">Standard Packages</div>
              <div className="flex flex-wrap gap-2">
                {entitlementGroups.standard.map((pkg) => <label key={pkg.productCode} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cardShell(theme)}`}><Checkbox checked={licenseDialog.draft.entitlements.includes(pkg.productCode)} onCheckedChange={(checked) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, entitlements: toggleValue(current.draft.entitlements, pkg.productCode, Boolean(checked)) } }))} /><span>{pkg.displayName}</span><InstallerKindBadge theme={theme} kind={pkg.packageKind} compact /><span className="opacity-60">{pkg.productCode}</span></label>)}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">Update Packages</div>
              <div className="flex flex-wrap gap-2">
                {entitlementGroups.update.map((pkg) => <label key={pkg.productCode} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cardShell(theme)}`}><Checkbox checked={licenseDialog.draft.entitlements.includes(pkg.productCode)} onCheckedChange={(checked) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, entitlements: toggleValue(current.draft.entitlements, pkg.productCode, Boolean(checked)) } }))} /><span>{pkg.displayName}</span><InstallerKindBadge theme={theme} kind={pkg.packageKind} compact /><span className="opacity-60">{pkg.productCode}</span></label>)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLicenseDialog((current) => ({ ...current, open: false }))}>Close</Button>
            <Button type="button" onClick={() => void handleSaveLicenseDialog()} disabled={licenseDialogBusy}>{licenseDialogBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{licenseDialog.mode === 'create' ? 'Create License' : 'Save License'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestDialog.open} onOpenChange={(open) => setRequestDialog((current) => ({ ...current, open }))}>
        <DialogContent className={`max-w-2xl ${theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-100' : ''}`}>
          <DialogHeader>
            <DialogTitle>Purchase Request</DialogTitle>
            <DialogDescription>Review buyer payment details, OCR results, and fulfillment state before taking action.</DialogDescription>
          </DialogHeader>
          {requestDialog.item && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div><div className="text-xs opacity-70">Buyer Email</div><div className="font-medium">{requestDialog.item.email}</div></div>
                <div><div className="text-xs opacity-70">Status</div><div>{requestDialog.item.status}</div></div>
                <div>
                  <div className="text-xs opacity-70">Product</div>
                  <div>{requestDialog.item.displayNameSnapshot} ({requestDialog.item.skuCode})</div>
                  <div className="mt-1"><InstallerProductTypeBadge theme={theme} type={requestDialog.item.productType} /></div>
                </div>
                <div><div className="text-xs opacity-70">Price</div><div>{requestDialog.item.pricePhpSnapshot !== null ? requestDialog.item.pricePhpSnapshot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</div></div>
                <div><div className="text-xs opacity-70">Receipt Reference</div>{requestDialog.item.receiptReference ? <CopyableValue value={requestDialog.item.receiptReference} label="receipt reference" wrap /> : '-'}</div>
                <div><div className="text-xs opacity-70">Payment Reference</div><div>{requestDialog.item.referenceNo || requestDialog.item.ocrReferenceNo || '-'}</div></div>
                <div><div className="text-xs opacity-70">Payment Channel</div><div>{requestDialog.item.paymentChannel}</div></div>
                <div><div className="text-xs opacity-70">OCR Status</div><div>{requestDialog.item.ocrStatus || '-'}</div></div>
                <div className="md:col-span-2"><div className="text-xs opacity-70">Granted Entitlements</div><div>{packageNameList(requestDialog.item.grantedEntitlementsSnapshot, packageMap, true)}</div></div>
                <div className="md:col-span-2"><div className="text-xs opacity-70">Issued License</div>{requestDialog.item.issuedLicenseCode ? <CopyableValue value={requestDialog.item.issuedLicenseCode} label="license code" wrap /> : <span>Not issued</span>}</div>
              </div>
              {requestDialog.item.status === 'pending' && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" disabled={requestActionKey === `reject:${requestDialog.item.id}`} onClick={() => void handleInstallerRequestAction(requestDialog.item!, 'reject')}>Reject</Button>
                  <Button type="button" disabled={requestActionKey === `approve:${requestDialog.item.id}`} onClick={() => void handleInstallerRequestAction(requestDialog.item!, 'approve')}>Approve</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialog.open} onOpenChange={(open) => setRejectDialog((current) => ({ ...current, open }))}>
        <DialogContent className={`max-w-lg ${theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-100' : ''}`}>
          <DialogHeader>
            <DialogTitle>Reject Purchase Request</DialogTitle>
            <DialogDescription>Enter the reason that will be emailed to the buyer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Rejection Reason</Label>
            <Input
              className={inputClass(theme)}
              value={rejectDialog.reason}
              onChange={(event) => setRejectDialog((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Explain why this request was not approved"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectDialog({ open: false, item: null, reason: '' })}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectDialog.reason.trim() || Boolean(requestActionKey)}
              onClick={() => {
                if (!rejectDialog.item || !rejectDialog.reason.trim()) return;
                void handleInstallerRequestAction(rejectDialog.item, 'reject', rejectDialog.reason.trim());
              }}
            >
              {requestActionKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((current) => ({ ...current, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        variant={confirmDialog.variant}
        theme={theme}
        onConfirm={() => {
          const action = confirmDialog.action;
          setConfirmDialog((current) => ({ ...current, open: false, action: null }));
          if (action) void action();
        }}
      />
    </AdminPageScaffold>
  );
}
