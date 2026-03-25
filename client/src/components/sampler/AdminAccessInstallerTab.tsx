import * as React from 'react';
import { Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react';

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
  type AdminInstallerEvent,
  type AdminInstallerLicense,
  type InstallerBuyProduct,
  type InstallerPackage,
  type InstallerVersionKey,
} from '@/lib/admin-api';

type Props = {
  theme: 'light' | 'dark';
  panelClass: string;
  pushNotice: (notice: { variant: 'success' | 'error' | 'info'; message: string }) => void;
};

type ViewKey = 'packages' | 'licenses' | 'catalog' | 'requests' | 'events';

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

const cardShell = (theme: 'light' | 'dark') =>
  theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white';

const inputClass = (theme: 'light' | 'dark') =>
  theme === 'dark' ? 'bg-gray-950 border-gray-700 text-gray-100' : 'bg-white border-gray-300';

const selectClass = (theme: 'light' | 'dark') =>
  `h-9 rounded-md border px-3 text-sm ${inputClass(theme)}`;

const subTabClass = (active: boolean, theme: 'light' | 'dark') => {
  if (active) {
    return theme === 'dark'
      ? 'bg-fuchsia-500 border-fuchsia-400 text-white'
      : 'bg-fuchsia-600 border-fuchsia-600 text-white';
  }
  return theme === 'dark'
    ? 'border-fuchsia-500/40 text-fuchsia-200 hover:bg-fuchsia-500/10'
    : 'border-fuchsia-300 text-fuchsia-700 hover:bg-fuchsia-50';
};

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

const packageNameList = (productCodes: string[], packageMap: Map<string, InstallerPackage>) => {
  if (productCodes.length === 0) return '-';
  return productCodes.map((productCode) => packageMap.get(productCode)?.displayName || productCode).join(', ');
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

export function AdminAccessInstallerTab({ theme, panelClass, pushNotice }: Props) {
  const [view, setView] = React.useState<ViewKey>('packages');

  const [packagesByVersion, setPackagesByVersion] = React.useState<Record<InstallerVersionKey, InstallerPackage[]>>({ V2: [], V3: [] });
  const [packagesLoading, setPackagesLoading] = React.useState(false);
  const [packageActionKey, setPackageActionKey] = React.useState('');
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
  const [catalogDialog, setCatalogDialog] = React.useState<CatalogDialogState>({
    open: false,
    mode: 'create',
    originalSkuCode: null,
    draft: blankCatalogProduct('V2'),
  });

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
    const items = packagesByVersion[version] || [];
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
              <TableHead>Kind</TableHead>
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
                <TableCell>{item.packageKind}</TableCell>
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
                <TableCell className="max-w-[260px] text-xs">{packageNameList(item.entitlements, packageMap)}</TableCell>
                <TableCell className="max-w-[260px] text-xs">{packageNameList(item.completedProducts, packageMap)}</TableCell>
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
    const items = catalogByVersion[version] || [];
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
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
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
                <TableCell>{item.productType}</TableCell>
                <TableCell>{item.pricePhp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                <TableCell className="max-w-[260px] text-xs">{packageNameList(item.grantedEntitlements, packageMap)}</TableCell>
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
                <TableCell><div>{item.displayNameSnapshot}</div><div className="text-xs opacity-60">{item.skuCode}</div></TableCell>
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
                <TableCell className="text-xs">{String(event.payload?.productCode || '-')}</TableCell>
                <TableCell className="max-w-[320px] text-xs">
                  <div>Requested: {Array.isArray(event.payload?.requestedProducts) ? (event.payload.requestedProducts as string[]).join(', ') : '-'}</div>
                  <div>Completed: {Array.isArray(event.payload?.completedProducts) ? (event.payload.completedProducts as string[]).join(', ') : '-'}</div>
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
    (view === 'requests' && requestsLoading) ||
    (view === 'events' && eventsLoading);

  return (
    <div className={`rounded-2xl border p-4 md:p-5 space-y-5 ${panelClass}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-lg font-semibold">Installer Manager</div>
          <div className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>Manage V2 and V3 packages, customer licenses, and installer events from one admin surface.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className={subTabClass(view === 'packages', theme)} onClick={() => setView('packages')}>Packages</Button>
          <Button type="button" size="sm" variant="outline" className={subTabClass(view === 'licenses', theme)} onClick={() => setView('licenses')}>Licenses</Button>
          <Button type="button" size="sm" variant="outline" className={subTabClass(view === 'catalog', theme)} onClick={() => setView('catalog')}>Catalog</Button>
          <Button type="button" size="sm" variant="outline" className={subTabClass(view === 'events', theme)} onClick={() => setView('events')}>Events</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { if (view === 'packages') void reloadPackages(); if (view === 'licenses') void loadLicenses(); if (view === 'catalog') void loadCatalog(); if (view === 'events') void loadEvents(); }}>
            <RefreshCw className={`mr-2 h-4 w-4 ${currentViewLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {view === 'packages' && (
        <>
          {renderPackagesTable('V2')}
          {renderPackagesTable('V3')}
        </>
      )}

      {view === 'licenses' && (
        <>
          <section className={`rounded-2xl border p-4 space-y-3 ${cardShell(theme)}`}>
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
          {renderCatalogTable('V2')}
          {renderCatalogTable('V3')}
        </>
      )}

      {view === 'requests' && (
        <>
          <section className={`rounded-2xl border p-4 space-y-3 ${cardShell(theme)}`}>
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
          <section className={`rounded-2xl border p-4 space-y-3 ${cardShell(theme)}`}>
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
            <div className="space-y-1"><Label className="text-xs">Package Kind</Label><select className={selectClass(theme)} value={packageDialog.draft.packageKind} onChange={(event) => setPackageDialog((current) => ({ ...current, draft: { ...current.draft, packageKind: event.target.value as InstallerPackage['packageKind'] } }))}><option value="standard">Standard</option><option value="update">Update</option></select></div>
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
            <div className="space-y-1"><Label className="text-xs">Product Type</Label><select className={selectClass(theme)} value={catalogDialog.draft.productType} disabled={catalogDraftAutoManaged} onChange={(event) => setCatalogDialog((current) => ({ ...current, draft: { ...current.draft, productType: event.target.value as InstallerBuyProduct['productType'] } }))}><option value="standard">Standard</option><option value="update">Update</option><option value="promax">PRO MAX</option></select></div>
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
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">Standard</div>
              <div className="flex flex-wrap gap-2">
                {entitlementGroups.standard.map((pkg) => <label key={pkg.productCode} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cardShell(theme)}`}><Checkbox checked={licenseDialog.draft.entitlements.includes(pkg.productCode)} onCheckedChange={(checked) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, entitlements: toggleValue(current.draft.entitlements, pkg.productCode, Boolean(checked)) } }))} /><span>{pkg.displayName}</span><span className="opacity-60">{pkg.productCode}</span></label>)}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">Updates</div>
              <div className="flex flex-wrap gap-2">
                {entitlementGroups.update.map((pkg) => <label key={pkg.productCode} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cardShell(theme)}`}><Checkbox checked={licenseDialog.draft.entitlements.includes(pkg.productCode)} onCheckedChange={(checked) => setLicenseDialog((current) => ({ ...current, draft: { ...current.draft, entitlements: toggleValue(current.draft.entitlements, pkg.productCode, Boolean(checked)) } }))} /><span>{pkg.displayName}</span><span className="opacity-60">{pkg.productCode}</span></label>)}
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
                <div><div className="text-xs opacity-70">SKU</div><div>{requestDialog.item.displayNameSnapshot} ({requestDialog.item.skuCode})</div></div>
                <div><div className="text-xs opacity-70">Price</div><div>{requestDialog.item.pricePhpSnapshot !== null ? requestDialog.item.pricePhpSnapshot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</div></div>
                <div><div className="text-xs opacity-70">Receipt Reference</div>{requestDialog.item.receiptReference ? <CopyableValue value={requestDialog.item.receiptReference} label="receipt reference" wrap /> : '-'}</div>
                <div><div className="text-xs opacity-70">Payment Reference</div><div>{requestDialog.item.referenceNo || requestDialog.item.ocrReferenceNo || '-'}</div></div>
                <div><div className="text-xs opacity-70">Payment Channel</div><div>{requestDialog.item.paymentChannel}</div></div>
                <div><div className="text-xs opacity-70">OCR Status</div><div>{requestDialog.item.ocrStatus || '-'}</div></div>
                <div className="md:col-span-2"><div className="text-xs opacity-70">Granted Entitlements</div><div>{packageNameList(requestDialog.item.grantedEntitlementsSnapshot, packageMap)}</div></div>
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
    </div>
  );
}
