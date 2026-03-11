import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AdminAccountRegistrationRequest, DefaultBankRelease, LandingDownloadConfig, LandingPlatformKey, LandingVersionKey } from '@/lib/admin-api';
import { Check, ChevronDown, ChevronUp, EyeOff, Loader2, Plus, RotateCcw, Save, Search, Store, Trash2, Upload, X } from 'lucide-react';
import type {
  AdminDialogTheme,
  CatalogDraft,
  DefaultBankSourceOption,
  StoreConfigDraft,
  StoreMarketingBanner,
  StoreCatalogSort
} from './AdminAccessDialog.shared';
import { CatalogCard, Pagination, ProofImagePreview } from './AdminAccessDialog.widgets';

interface AccountRequestsTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  cardClass: string;
  filter: 'pending' | 'history';
  search: string;
  loading: boolean;
  rows: AdminAccountRegistrationRequest[];
  page: number;
  totalPages: number;
  pendingCount: number;
  historyCount: number;
  onFilterChange: (filter: 'pending' | 'history') => void;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onApprove: (id: string) => void;
  onAssist: (id: string) => void;
  onReject: (id: string) => void;
  onRetryEmail: (id: string) => void;
}

interface StoreRequestItem {
  title: string;
  isPaid: boolean;
  pricePhp: number | null;
}

interface StoreRequestGroup {
  id: string;
  batch_id?: string;
  bankNames: string[];
  bankItems: StoreRequestItem[];
  user_id: string;
  user_profile?: { display_name: string; email: string } | null;
  status: 'pending' | 'approved' | 'rejected';
  payment_channel: string;
  payer_name: string;
  reference_no: string;
  notes: string;
  proof_path?: string;
  rejection_message?: string;
  decision_email_status?: 'pending' | 'sent' | 'failed' | 'skipped' | null;
  decision_email_error?: string | null;
  ocr_reference_no?: string | null;
  ocr_payer_name?: string | null;
  ocr_amount_php?: number | null;
  ocr_recipient_number?: string | null;
  ocr_provider?: string | null;
  ocr_scanned_at?: string | null;
  ocr_status?: 'detected' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'failed' | 'unavailable' | 'skipped' | null;
  ocr_error_code?: string | null;
  decision_source?: 'manual' | 'automation' | null;
  automation_result?: string | null;
  created_at: string;
  count: number;
  totalAmountPhp: number;
  hasTbdAmount: boolean;
}

interface StoreRequestsTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  cardClass: string;
  filter: 'pending' | 'history';
  search: string;
  loading: boolean;
  rows: StoreRequestGroup[];
  page: number;
  totalPages: number;
  expandedId: string | null;
  pendingCount: number;
  historyCount: number;
  onFilterChange: (filter: 'pending' | 'history') => void;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onToggleExpanded: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRetryEmail: (id: string) => void;
}

interface StoreCatalogStats {
  total: number;
  published: number;
  draft: number;
  paid: number;
  pinned: number;
}

interface StoreCatalogTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  storeDrafts: CatalogDraft[];
  pagedDrafts: CatalogDraft[];
  page: number;
  totalPages: number;
  search: string;
  bankFilter: string;
  statusFilter: 'all' | 'published' | 'draft';
  paidFilter: 'all' | 'paid' | 'free';
  pinnedFilter: 'all' | 'pinned' | 'unpinned';
  sort: StoreCatalogSort;
  bankOptions: string[];
  filteredCount: number;
  stats: StoreCatalogStats;
  hasFilters: boolean;
  onSearchChange: (value: string) => void;
  onBankFilterChange: (value: string) => void;
  onStatusFilterChange: (value: 'all' | 'published' | 'draft') => void;
  onPaidFilterChange: (value: 'all' | 'paid' | 'free') => void;
  onPinnedFilterChange: (value: 'all' | 'pinned' | 'unpinned') => void;
  onSortChange: (value: StoreCatalogSort) => void;
  onResetFilters: () => void;
  onPageChange: (page: number) => void;
  onUpdateDraft: (id: string, updates: Record<string, any>) => void;
  onPublishDraft: (draft: CatalogDraft) => void;
  onReload: () => void;
  pushNotice: (notice: { variant: 'success' | 'error'; message: string }) => void;
}

interface StoreBannersTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  bannerLoading: boolean;
  banners: StoreMarketingBanner[];
  dirtyBannerIds: Set<string>;
  bannerStats: { total: number; active: number; inactive: number; dirty: number };
  showInactive: boolean;
  newBannerPreviewUrl: string | null;
  newBannerImageUrl: string;
  newBannerLinkUrl: string;
  newBannerSortOrder: string;
  newBannerHasFile: boolean;
  bannerUploadingIds: Set<string>;
  onShowInactiveChange: (value: boolean) => void;
  onNewBannerImageUrlChange: (value: string) => void;
  onNewBannerLinkUrlChange: (value: string) => void;
  onNewBannerSortOrderChange: (value: string) => void;
  onNewBannerFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearNewBannerFile: () => void;
  onCreateBanner: () => void;
  onReplaceBannerImage: (id: string, file: File) => void;
  onNudgeBannerSort: (id: string, delta: -1 | 1) => void;
  onUpdateBanner: (id: string, updates: Partial<StoreMarketingBanner>) => void;
  onResetBanner: (id: string) => void;
  onSaveBanner: (banner: StoreMarketingBanner) => void;
  onDeleteBanner: (banner: StoreMarketingBanner) => void;
}

interface StoreConfigTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  storeConfig: StoreConfigDraft;
  storeQrPreviewUrl: string | null;
  hasQrImage: boolean;
  onStoreConfigChange: (next: StoreConfigDraft) => void;
  onQrFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAutoApprovalAction: (target: 'account' | 'store', action: 'start' | 'stop') => void;
  onRemoveQr: () => void;
  onSave: () => void;
}

interface LandingDownloadTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  saving: boolean;
  config: LandingDownloadConfig;
  onConfigChange: (next: LandingDownloadConfig) => void;
  onRefresh: () => void;
  onSave: () => void;
}

interface DefaultBankTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  publishLoading: boolean;
  rollbackLoading: boolean;
  currentRelease: DefaultBankRelease | null;
  releases: DefaultBankRelease[];
  nextVersion: number;
  sourceOptions: DefaultBankSourceOption[];
  selectedSourceId: string;
  releaseNotes: string;
  minAppVersion: string;
  onSelectedSourceIdChange: (value: string) => void;
  onReleaseNotesChange: (value: string) => void;
  onMinAppVersionChange: (value: string) => void;
  onRefresh: () => void;
  onPublish: () => void;
  onRollback: (version: number) => void;
}

const formatAutomationLabel = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return '-';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
};

const formatOcrErrorLabel = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return '-';
  switch (normalized) {
    case 'MANUAL_REVIEW_MODE':
      return 'Skipped because auto-approval is disabled';
    case 'OCR_UNAVAILABLE':
      return 'OCR provider is not configured';
    case 'OCR_STORAGE_DOWNLOAD_FAILED':
      return 'Proof image could not be loaded from storage';
    case 'OCR_UNSUPPORTED_EXTENSION':
      return 'Proof image file extension is not supported';
    case 'OCR_UNSUPPORTED_MIME':
      return 'Proof image mime type is not supported';
    case 'OCR_INVALID_FILE_SIZE':
      return 'Proof image file size is invalid';
    case 'OCR_FILE_TOO_LARGE':
      return 'Proof image is too large for OCR';
    case 'OCR_TIMEOUT':
      return 'OCR request timed out';
    case 'OCR_HTTP_FAILED':
      return 'OCR provider request failed';
    case 'OCR_PROVIDER_PROCESSING_ERROR':
      return 'OCR provider could not process the proof image';
    case 'OCR_EMPTY_TEXT':
      return 'OCR found no readable text in the proof image';
    case 'OCR_FAILED':
      return 'OCR failed for an unknown reason';
    default:
      return formatAutomationLabel(normalized);
  }
};

const formatOcrAmount = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatHourLabel = (value: string): string => {
  const parsed = Number(value || 0);
  const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(23, Math.floor(parsed))) : 0;
  return `${String(normalized).padStart(2, '0')}:00`;
};

const formatCountdownRemaining = (expiresAt: string | null | undefined, nowMs: number): string => {
  if (!expiresAt) return 'No active countdown';
  const diffMs = new Date(expiresAt).getTime() - nowMs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'Countdown ended';
  const totalMinutes = Math.max(1, Math.floor(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m remaining`;
  if (hours > 0) return `${hours}h remaining`;
  return `${minutes}m remaining`;
};

const LANDING_VERSION_OPTIONS: LandingVersionKey[] = ['V1', 'V2', 'V3'];
const LANDING_PLATFORM_OPTIONS: LandingPlatformKey[] = ['android', 'ios', 'windows', 'macos'];

export function LandingDownloadTab({
  theme,
  panelClass,
  loading,
  saving,
  config,
  onConfigChange,
  onRefresh,
  onSave,
}: LandingDownloadTabProps) {
  return (
    <div className={`border rounded p-3 space-y-3 h-full min-h-0 flex flex-col overflow-hidden ${panelClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Landing Download Config</div>
          <div className="text-xs opacity-70">Manage links, platform descriptions, and version copy without editing frontend files.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading || saving}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
          </Button>
          <Button size="sm" onClick={onSave} disabled={loading || saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
        {LANDING_VERSION_OPTIONS.map((version) => (
          <div key={version} className={`rounded-lg border p-3 space-y-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
            <div className="text-sm font-semibold">{version}</div>
            <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>{version} Title</Label>
                  <Input
                    value={config.versionDescriptions[version].title}
                    onChange={(event) => onConfigChange({
                      ...config,
                      versionDescriptions: {
                        ...config.versionDescriptions,
                        [version]: {
                          ...config.versionDescriptions[version],
                          title: event.target.value,
                        },
                      },
                    })}
                    className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{version} Description</Label>
                  <textarea
                    value={config.versionDescriptions[version].desc}
                    onChange={(event) => onConfigChange({
                      ...config,
                      versionDescriptions: {
                        ...config.versionDescriptions,
                        [version]: {
                          ...config.versionDescriptions[version],
                          desc: event.target.value,
                        },
                      },
                    })}
                    className={`w-full min-h-[140px] rounded-md border p-2 text-sm outline-none resize-y ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`}
                  />
                </div>
              </div>
              <div className="space-y-3">
                {LANDING_PLATFORM_OPTIONS.map((platform) => (
                  <div key={`${version}-${platform}`} className={`rounded-lg border p-3 space-y-2 ${theme === 'dark' ? 'border-gray-800 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{platform}</div>
                    <div className="space-y-1">
                      <Label>Download Link</Label>
                      <Input
                        value={config.downloadLinks[version][platform]}
                        onChange={(event) => onConfigChange({
                          ...config,
                          downloadLinks: {
                            ...config.downloadLinks,
                            [version]: {
                              ...config.downloadLinks[version],
                              [platform]: event.target.value,
                            },
                          },
                        })}
                        placeholder="https://..."
                        className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Platform Description</Label>
                      <Input
                        value={config.platformDescriptions[version][platform]}
                        onChange={(event) => onConfigChange({
                          ...config,
                          platformDescriptions: {
                            ...config.platformDescriptions,
                            [version]: {
                              ...config.platformDescriptions[version],
                              [platform]: event.target.value,
                            },
                          },
                        })}
                        className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DefaultBankTab({
  theme,
  panelClass,
  loading,
  publishLoading,
  rollbackLoading,
  currentRelease,
  releases,
  nextVersion,
  sourceOptions,
  selectedSourceId,
  releaseNotes,
  minAppVersion,
  onSelectedSourceIdChange,
  onReleaseNotesChange,
  onMinAppVersionChange,
  onRefresh,
  onPublish,
  onRollback,
}: DefaultBankTabProps) {
  return (
    <div className={`border rounded p-3 space-y-3 h-full min-h-0 flex flex-col overflow-hidden ${panelClass}`}>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-3">
        <div className={`rounded-lg border p-3 space-y-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Publish Default Bank</div>
              <div className="text-xs opacity-70">Next release will be v{nextVersion}</div>
            </div>
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
            </Button>
          </div>

          <div className="space-y-1">
            <Label>Source Bank</Label>
            <select
              value={selectedSourceId}
              onChange={(event) => onSelectedSourceIdChange(event.target.value)}
              className={`h-9 w-full rounded-md border px-2 text-sm outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}
            >
              <option value="">Select loaded bank...</option>
              {sourceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} ({option.padCount} pads){option.isDefaultBank ? ' [Default]' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Release Notes</Label>
            <textarea
              value={releaseNotes}
              onChange={(event) => onReleaseNotesChange(event.target.value)}
              className={`w-full min-h-[96px] rounded-md border p-2 text-sm outline-none resize-y ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`}
              placeholder="What changed in this default bank release?"
            />
          </div>

          <div className="space-y-1">
            <Label>Min App Version</Label>
            <Input
              value={minAppVersion}
              onChange={(event) => onMinAppVersionChange(event.target.value)}
              placeholder="Optional"
              className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
            />
          </div>

          <Button onClick={onPublish} disabled={publishLoading || !selectedSourceId} className="w-full">
            {publishLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Publish New Version
          </Button>
        </div>

        <div className={`rounded-lg border p-3 space-y-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
          <div className="text-sm font-semibold">Current Release</div>
          {currentRelease ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div><span className="opacity-70">Version:</span> v{currentRelease.version}</div>
              <div><span className="opacity-70">Published:</span> {currentRelease.publishedAt ? new Date(currentRelease.publishedAt).toLocaleString() : '-'}</div>
              <div><span className="opacity-70">Source:</span> {currentRelease.sourceBankTitle}</div>
              <div><span className="opacity-70">Pad Count:</span> {currentRelease.sourceBankPadCount}</div>
              <div><span className="opacity-70">Size:</span> {currentRelease.fileSizeBytes.toLocaleString()} bytes</div>
              <div><span className="opacity-70">Min App:</span> {currentRelease.minAppVersion || '-'}</div>
              <div className="md:col-span-2"><span className="opacity-70">SHA-256:</span> <span className="font-mono text-[11px] break-all">{currentRelease.fileSha256 || '-'}</span></div>
              <div className="md:col-span-2"><span className="opacity-70">Notes:</span> {currentRelease.releaseNotes || '-'}</div>
            </div>
          ) : (
            <div className="text-sm opacity-70">No remote default-bank release published yet.</div>
          )}
        </div>
      </div>

      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="text-sm font-semibold">Release History</div>
            <div className="text-xs opacity-70">Rollback switches the active release without deleting history.</div>
          </div>
          {rollbackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        </div>

        <div className="flex-1 min-h-0 overflow-auto rounded border">
          <table className="w-full text-sm">
            <thead className={theme === 'dark' ? 'bg-gray-800 text-gray-200' : 'bg-gray-50 text-gray-700'}>
              <tr>
                <th className="text-left px-3 py-2">Version</th>
                <th className="text-left px-3 py-2">Published</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {releases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center opacity-70">No releases yet.</td>
                </tr>
              ) : releases.map((release) => (
                <tr key={release.id} className={theme === 'dark' ? 'border-t border-gray-800' : 'border-t border-gray-200'}>
                  <td className="px-3 py-2 font-medium">
                    v{release.version}
                    {release.isActive ? (
                      <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] uppercase text-emerald-500">Active</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{release.publishedAt ? new Date(release.publishedAt).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2">{release.sourceBankTitle}</td>
                  <td className="px-3 py-2 max-w-[320px] truncate" title={release.releaseNotes || ''}>{release.releaseNotes || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rollbackLoading || release.isActive}
                      onClick={() => onRollback(release.version)}
                    >
                      Rollback
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AccountRequestsTab({
  theme,
  panelClass,
  cardClass,
  filter,
  search,
  loading,
  rows,
  page,
  totalPages,
  pendingCount,
  historyCount,
  onFilterChange,
  onSearchChange,
  onPageChange,
  onApprove,
  onAssist,
  onReject,
  onRetryEmail,
}: AccountRequestsTabProps) {
  return (
    <div className={`border rounded p-3 space-y-2 h-full min-h-0 flex flex-col overflow-hidden ${panelClass}`}>
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant={filter === 'pending' ? 'default' : 'outline'} onClick={() => onFilterChange('pending')}>
          Pending ({pendingCount})
        </Button>
        <Button size="sm" variant={filter === 'history' ? 'default' : 'outline'} onClick={() => onFilterChange('history')}>
          History ({historyCount})
        </Button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search requests..."
            className={`h-7 pl-7 text-xs w-40 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-auto space-y-2">
            {rows.length === 0 ? (
              <p className="text-center py-8 opacity-50 text-sm">No {filter} account registration requests.</p>
            ) : rows.map((req) => (
              <div key={req.id} className={`p-3 rounded-lg border ${cardClass}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-sm truncate">{req.display_name || 'No Name'}</h4>
                    </div>
                    <div className={`text-[11px] mt-0.5 ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      {req.display_name || 'No Name'} - {req.email}
                    </div>
                    <div className={`text-xs mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                      <div><span className="opacity-70">Channel:</span> <span className="uppercase font-medium">{req.payment_channel}</span></div>
                      <div><span className="opacity-70">Name:</span> {req.payer_name || '-'}</div>
                      <div><span className="opacity-70">Ref:</span> <span className="font-mono">{req.reference_no || '-'}</span></div>
                      <div><span className="opacity-70">Date:</span> {new Date(req.created_at).toLocaleString()}</div>
                      {req.reviewed_at && (
                        <div className="col-span-2">
                          <span className="opacity-70">Reviewed:</span> {new Date(req.reviewed_at).toLocaleString()}
                          {req.reviewed_by ? ` by ${req.reviewed_by.slice(0, 8)}...` : ''}
                        </div>
                      )}
                      {req.approved_auth_user_id && (
                        <div className="col-span-2"><span className="opacity-70">Approved User:</span> <span className="font-mono">{req.approved_auth_user_id}</span></div>
                      )}
                      {req.decision_source && (
                        <div><span className="opacity-70">Decision:</span> {formatAutomationLabel(req.decision_source)}</div>
                      )}
                      {req.automation_result && (
                        <div><span className="opacity-70">Auto Check:</span> {formatAutomationLabel(req.automation_result)}</div>
                      )}
                      {req.ocr_reference_no && <div><span className="opacity-70">OCR Ref:</span> <span className="font-mono">{req.ocr_reference_no}</span></div>}
                      {req.ocr_recipient_number && <div><span className="opacity-70">OCR Wallet:</span> <span className="font-mono">{req.ocr_recipient_number}</span></div>}
                      {typeof req.ocr_amount_php === 'number' && <div><span className="opacity-70">OCR Amount:</span> {formatOcrAmount(req.ocr_amount_php)}</div>}
                      {req.ocr_status && <div><span className="opacity-70">OCR Status:</span> {formatAutomationLabel(req.ocr_status)}</div>}
                      {req.ocr_provider && <div><span className="opacity-70">OCR Provider:</span> {req.ocr_provider}</div>}
                      {req.ocr_error_code && (
                        <div className="col-span-2">
                          <span className="opacity-70">OCR Error:</span> {formatOcrErrorLabel(req.ocr_error_code)}
                          <span className="opacity-60 font-mono text-[11px]"> ({req.ocr_error_code})</span>
                        </div>
                      )}
                      {req.notes && <div className="col-span-2"><span className="opacity-70">Notes:</span> {req.notes}</div>}
                      {req.decision_email_error && <div className="col-span-2"><span className="opacity-70">Email Error:</span> {req.decision_email_error}</div>}
                      {req.proof_path && <div className="col-span-2"><span className="opacity-70">Proof:</span> <ProofImagePreview path={req.proof_path} /></div>}
                    </div>
                  </div>
                  <div className="flex gap-1 items-center shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <Button size="sm" onClick={() => onApprove(req.id)} className="h-6 px-2 bg-green-600 hover:bg-green-700 text-white text-[11px]">
                          <Check className="w-3 h-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onAssist(req.id)} className="h-6 px-2 text-[11px]">
                          No Email
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => onReject(req.id)} className="h-6 px-2 text-[11px]">
                          <X className="w-3 h-3 mr-1" /> Reject
                        </Button>
                      </>
                    ) : (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${req.status === 'approved' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}>{req.status}</span>
                        {req.decision_email_status && (
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${req.decision_email_status === 'sent' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : req.decision_email_status === 'failed' ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-300'}`}>
                            Email: {req.decision_email_status}
                          </span>
                        )}
                        {req.decision_email_status !== 'sent' && (
                          <Button size="sm" variant="outline" onClick={() => onRetryEmail(req.id)} className="h-6 px-2 text-[11px]">
                            Retry Email
                          </Button>
                        )}
                        {req.status === 'rejected' && req.rejection_message && (
                          <span className={`text-[10px] max-w-[180px] truncate ${theme === 'dark' ? 'text-red-400/70' : 'text-red-500/70'}`} title={req.rejection_message}>
                            "{req.rejection_message}"
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </>
      )}
    </div>
  );
}

export function StoreRequestsTab({
  theme,
  panelClass,
  cardClass,
  filter,
  search,
  loading,
  rows,
  page,
  totalPages,
  expandedId,
  pendingCount,
  historyCount,
  onFilterChange,
  onSearchChange,
  onPageChange,
  onToggleExpanded,
  onApprove,
  onReject,
  onRetryEmail,
}: StoreRequestsTabProps) {
  return (
    <div className={`border rounded p-3 space-y-2 h-full min-h-0 flex flex-col overflow-hidden ${panelClass}`}>
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant={filter === 'pending' ? 'default' : 'outline'} onClick={() => onFilterChange('pending')}>
          Pending ({pendingCount})
        </Button>
        <Button size="sm" variant={filter === 'history' ? 'default' : 'outline'} onClick={() => onFilterChange('history')}>
          History ({historyCount})
        </Button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search requests..."
            className={`h-7 pl-7 text-xs w-40 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`}
          />
        </div>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <>
          <div className="flex-1 min-h-0 overflow-auto space-y-2">
            {rows.length === 0 ? (
              <p className="text-center py-8 opacity-50 text-sm">No {filter} purchase requests.</p>
            ) : rows.map((req) => (
              <div key={req.id} className={`p-3 rounded-lg border ${cardClass}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-sm truncate">{req.count > 1 ? `${req.bankNames[0]} +${req.count - 1} more` : req.bankNames[0]}</h4>
                      {req.count > 1 && (
                        <button
                          type="button"
                          onClick={() => onToggleExpanded(req.id)}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-colors ${theme === 'dark' ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}
                        >
                          {req.count} banks
                        </button>
                      )}
                    </div>
                    {req.user_profile && (
                      <div className={`text-[11px] mt-0.5 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                        {req.user_profile.display_name || 'No Name'} - {req.user_profile.email}
                      </div>
                    )}
                    <div className={`text-xs mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                      <div><span className="opacity-70">Channel:</span> <span className="uppercase font-medium">{req.payment_channel}</span></div>
                      <div><span className="opacity-70">Name:</span> {req.payer_name}</div>
                      <div><span className="opacity-70">Ref:</span> <span className="font-mono">{req.reference_no}</span></div>
                      <div><span className="opacity-70">Date:</span> {new Date(req.created_at).toLocaleDateString()}</div>
                      <div className="col-span-2"><span className="opacity-70">Amount:</span> {req.hasTbdAmount ? 'TBD' : `PHP ${req.totalAmountPhp.toLocaleString()}`}</div>
                      {req.decision_source && <div><span className="opacity-70">Decision:</span> {formatAutomationLabel(req.decision_source)}</div>}
                      {req.automation_result && <div><span className="opacity-70">Auto Check:</span> {formatAutomationLabel(req.automation_result)}</div>}
                      {req.ocr_reference_no && <div><span className="opacity-70">OCR Ref:</span> <span className="font-mono">{req.ocr_reference_no}</span></div>}
                      {req.ocr_recipient_number && <div><span className="opacity-70">OCR Wallet:</span> <span className="font-mono">{req.ocr_recipient_number}</span></div>}
                      {typeof req.ocr_amount_php === 'number' && <div><span className="opacity-70">OCR Amount:</span> {formatOcrAmount(req.ocr_amount_php)}</div>}
                      {req.ocr_status && <div><span className="opacity-70">OCR Status:</span> {formatAutomationLabel(req.ocr_status)}</div>}
                      {req.ocr_provider && <div><span className="opacity-70">OCR Provider:</span> {req.ocr_provider}</div>}
                      {req.ocr_error_code && (
                        <div className="col-span-2">
                          <span className="opacity-70">OCR Error:</span> {formatOcrErrorLabel(req.ocr_error_code)}
                          <span className="opacity-60 font-mono text-[11px]"> ({req.ocr_error_code})</span>
                        </div>
                      )}
                      {req.notes && <div className="col-span-2"><span className="opacity-70">Notes:</span> {req.notes}</div>}
                      {req.proof_path && <div className="col-span-2"><span className="opacity-70">Proof:</span> <ProofImagePreview path={req.proof_path} /></div>}
                      {req.decision_email_error && <div className="col-span-2"><span className="opacity-70">Email Error:</span> {req.decision_email_error}</div>}
                    </div>
                    {expandedId === req.id && req.bankItems.length > 0 && (
                      <div className={`mt-2 rounded border p-2 space-y-1 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-white'}`}>
                        <div className="text-[10px] uppercase tracking-wide opacity-70 font-semibold">Requested Banks</div>
                        {req.bankItems.map((item, index) => (
                          <div key={`${req.id}-bank-${index}`} className={`flex items-center justify-between text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                            <span className="truncate pr-2">{item.title}</span>
                            <span className="shrink-0 font-medium">
                              {item.isPaid ? (item.pricePhp !== null ? `PHP ${item.pricePhp.toLocaleString()}` : 'TBD') : 'FREE'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 items-center shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <Button size="sm" onClick={() => onApprove(req.id)} className="h-6 px-2 bg-green-600 hover:bg-green-700 text-white text-[11px]"><Check className="w-3 h-3 mr-1" /> Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => onReject(req.id)} className="h-6 px-2 text-[11px]"><X className="w-3 h-3 mr-1" /> Reject</Button>
                      </>
                    ) : (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${req.status === 'approved' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}>{req.status}</span>
                        {req.decision_email_status && (
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${req.decision_email_status === 'sent' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : req.decision_email_status === 'failed' ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-300'}`}>
                            Email: {req.decision_email_status}
                          </span>
                        )}
                        {req.decision_email_status !== 'sent' && (
                          <Button size="sm" variant="outline" onClick={() => onRetryEmail(req.id)} className="h-6 px-2 text-[11px]">
                            Retry Email
                          </Button>
                        )}
                        {req.status === 'rejected' && req.rejection_message && (
                          <span className={`text-[10px] max-w-[180px] truncate ${theme === 'dark' ? 'text-red-400/70' : 'text-red-500/70'}`} title={req.rejection_message}>
                            "{req.rejection_message}"
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </>
      )}
    </div>
  );
}

export function StoreCatalogTab({
  theme,
  panelClass,
  loading,
  storeDrafts,
  pagedDrafts,
  page,
  totalPages,
  search,
  bankFilter,
  statusFilter,
  paidFilter,
  pinnedFilter,
  sort,
  bankOptions,
  filteredCount,
  stats,
  hasFilters,
  onSearchChange,
  onBankFilterChange,
  onStatusFilterChange,
  onPaidFilterChange,
  onPinnedFilterChange,
  onSortChange,
  onResetFilters,
  onPageChange,
  onUpdateDraft,
  onPublishDraft,
  onReload,
  pushNotice,
}: StoreCatalogTabProps) {
  return (
    <div className={`border rounded p-3 space-y-2 h-full min-h-0 flex flex-col overflow-hidden ${panelClass}`}>
      <div className="space-y-2">
        <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Manage store catalog items. Drafts are created automatically during Admin Export.</p>
        <div className={`rounded-lg border p-2.5 space-y-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50/70'}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
            <div className="xl:col-span-2">
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Search</div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
                <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Title or asset name..." className={`h-8 pl-7 text-xs ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Bank</div>
              <select value={bankFilter} onChange={(event) => onBankFilterChange(event.target.value)} className={`h-8 w-full rounded-md border px-2 text-xs outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="all">All banks</option>
                {bankOptions.map((bankName) => (
                  <option key={bankName} value={bankName}>{bankName}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Status</div>
              <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as 'all' | 'published' | 'draft')} className={`h-8 w-full rounded-md border px-2 text-xs outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="all">All status</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Pricing</div>
              <select value={paidFilter} onChange={(event) => onPaidFilterChange(event.target.value as 'all' | 'paid' | 'free')} className={`h-8 w-full rounded-md border px-2 text-xs outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="all">All pricing</option>
                <option value="paid">Paid</option>
                <option value="free">Free</option>
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Pin/Sort</div>
              <div className="flex gap-2">
                <select value={pinnedFilter} onChange={(event) => onPinnedFilterChange(event.target.value as 'all' | 'pinned' | 'unpinned')} className={`h-8 w-[48%] rounded-md border px-2 text-xs outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                  <option value="all">All pin</option>
                  <option value="pinned">Pinned</option>
                  <option value="unpinned">Unpinned</option>
                </select>
                <select value={sort} onChange={(event) => onSortChange(event.target.value as StoreCatalogSort)} className={`h-8 w-[52%] rounded-md border px-2 text-xs outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                  <option value="pinned_first">Pinned first</option>
                  <option value="newest">Newest</option>
                  <option value="title_asc">Bank A-Z</option>
                  <option value="title_desc">Bank Z-A</option>
                  <option value="price_high">Price high-low</option>
                  <option value="price_low">Price low-high</option>
                  <option value="status">Status</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Button size="sm" variant="outline" onClick={onResetFilters} disabled={!hasFilters} className="h-6 px-2 text-[11px]">
              Clear filters
            </Button>
            <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-indigo-700/60 text-indigo-300' : 'border-indigo-300 text-indigo-700'}`}>Filtered {filteredCount}</span>
            {hasFilters && (
              <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-emerald-700/60 text-emerald-300' : 'border-emerald-300 text-emerald-700'}`}>Filters active</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`}>Total {stats.total}</span>
          <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-emerald-700/60 text-emerald-300' : 'border-emerald-300 text-emerald-700'}`}>Published {stats.published}</span>
          <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-amber-700/60 text-amber-300' : 'border-amber-300 text-amber-700'}`}>Draft {stats.draft}</span>
          <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-blue-700/60 text-blue-300' : 'border-blue-300 text-blue-700'}`}>Paid {stats.paid}</span>
          <span className={`px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-fuchsia-700/60 text-fuchsia-300' : 'border-fuchsia-300 text-fuchsia-700'}`}>Pinned {stats.pinned}</span>
        </div>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <>
          <div className="flex-1 min-h-0 overflow-auto">
            {pagedDrafts.length === 0 ? (
              <div className={`text-center py-12 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                <Store className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">{storeDrafts.length === 0 ? 'No catalog items yet' : 'No catalog items match filters'}</p>
                <p className="text-xs mt-1">
                  {storeDrafts.length === 0 ? 'Export a bank from Bank Edit to create a draft.' : 'Try clearing some filters or search terms.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pagedDrafts.map((draft) => (
                  <CatalogCard key={draft.id} draft={draft} isDark={theme === 'dark'} onUpdate={onUpdateDraft} onPublish={onPublishDraft} pushNotice={pushNotice} onReload={onReload} />
                ))}
              </div>
            )}
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </>
      )}
    </div>
  );
}

export function StoreBannersTab({
  theme,
  panelClass,
  loading,
  bannerLoading,
  banners,
  dirtyBannerIds,
  bannerStats,
  showInactive,
  newBannerPreviewUrl,
  newBannerImageUrl,
  newBannerLinkUrl,
  newBannerSortOrder,
  newBannerHasFile,
  bannerUploadingIds,
  onShowInactiveChange,
  onNewBannerImageUrlChange,
  onNewBannerLinkUrlChange,
  onNewBannerSortOrderChange,
  onNewBannerFileChange,
  onClearNewBannerFile,
  onCreateBanner,
  onReplaceBannerImage,
  onNudgeBannerSort,
  onUpdateBanner,
  onResetBanner,
  onSaveBanner,
  onDeleteBanner,
}: StoreBannersTabProps) {
  const [deleteTarget, setDeleteTarget] = React.useState<StoreMarketingBanner | null>(null);
  const isDark = theme === 'dark';

  return (
    <>
      <div className={`border rounded p-3 space-y-3 h-full min-h-0 flex flex-col overflow-hidden ${panelClass}`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Marketing Banners</div>
            <p className={`text-xs max-w-xl ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Manage the slider shown above the Bank Store list. Unsaved banners stay visible here even if you switch them to inactive.
            </p>
          </div>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-xs rounded-md border px-2.5 py-1.5 self-start">
            <input type="checkbox" checked={showInactive} onChange={(event) => onShowInactiveChange(event.target.checked)} />
            Show inactive
          </label>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className={`px-2 py-1 rounded-full border ${isDark ? 'border-gray-700 text-gray-300 bg-gray-900/40' : 'border-gray-300 text-gray-700 bg-white'}`}>Total {bannerStats.total}</span>
          <span className={`px-2 py-1 rounded-full border ${isDark ? 'border-emerald-700/60 text-emerald-300 bg-emerald-950/20' : 'border-emerald-300 text-emerald-700 bg-emerald-50'}`}>Active {bannerStats.active}</span>
          <span className={`px-2 py-1 rounded-full border ${isDark ? 'border-amber-700/60 text-amber-300 bg-amber-950/20' : 'border-amber-300 text-amber-700 bg-amber-50'}`}>Inactive {bannerStats.inactive}</span>
          <span className={`px-2 py-1 rounded-full border ${isDark ? 'border-blue-700/60 text-blue-300 bg-blue-950/20' : 'border-blue-300 text-blue-700 bg-blue-50'}`}>Unsaved {bannerStats.dirty}</span>
        </div>

        {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
          <div className="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
            <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <div className="text-sm font-semibold">Create New Banner</div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)] gap-4">
                <div className={`rounded-lg border overflow-hidden h-32 ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}>
                  {(newBannerPreviewUrl || newBannerImageUrl) ? (
                    <img src={newBannerPreviewUrl || newBannerImageUrl} alt="New banner preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[11px] opacity-60">
                      <Upload className="w-4 h-4" />
                      <span>No preview yet</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Image URL</Label>
                    <Input value={newBannerImageUrl} onChange={(event) => onNewBannerImageUrlChange(event.target.value)} placeholder="https://..." className={`h-9 text-xs ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                  </div>
                  <div className="space-y-1">
                    <Label>Link URL</Label>
                    <Input value={newBannerLinkUrl} onChange={(event) => onNewBannerLinkUrlChange(event.target.value)} placeholder="Optional destination" className={`h-9 text-xs ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                  </div>
                  <div className="space-y-1">
                    <Label>Upload Image</Label>
                    <div className="flex items-center gap-2">
                      <Input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={onNewBannerFileChange} disabled={bannerLoading} className={`h-9 text-xs ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                      {newBannerHasFile && (
                        <Button type="button" size="sm" variant="outline" onClick={onClearNewBannerFile} className="h-9 px-3 text-xs">
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Sort Order</Label>
                    <div className="flex items-center gap-2">
                      <Input type="number" min={0} step={1} value={newBannerSortOrder} onChange={(event) => onNewBannerSortOrderChange(event.target.value)} placeholder="0" className={`h-9 text-xs w-[120px] ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                      <Button size="sm" onClick={onCreateBanner} disabled={bannerLoading} className="h-9 px-4 text-xs">
                        {bannerLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                        Create Banner
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold">Existing Banners</div>
                {!showInactive && bannerStats.inactive > 0 ? (
                  <span className={`text-[11px] px-2 py-1 rounded-full border ${isDark ? 'border-amber-700/60 text-amber-300 bg-amber-950/20' : 'border-amber-300 text-amber-700 bg-amber-50'}`}>
                    Inactive rows hidden after save
                  </span>
                ) : null}
              </div>

              <div className="space-y-3">
                {banners.length === 0 ? (
                  <div className={`rounded-lg border border-dashed px-4 py-10 text-center ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-300 text-gray-500'}`}>
                    <Store className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <div className="text-sm font-medium">No banners in this view</div>
                    <div className="text-xs mt-1">
                      {showInactive ? 'Create a banner to populate the store slider.' : 'Try enabling "Show inactive" to review hidden banners.'}
                    </div>
                  </div>
                ) : (
                  banners.map((banner) => {
                    const uploading = bannerUploadingIds.has(banner.id);
                    const isDirty = dirtyBannerIds.has(banner.id);
                    const willHideAfterSave = !showInactive && !banner.is_active;
                    return (
                      <div
                        key={banner.id}
                        className={`rounded-xl border p-3 space-y-3 ${isDirty
                          ? (isDark ? 'border-blue-500/50 bg-blue-950/10' : 'border-blue-300 bg-blue-50/60')
                          : (isDark ? 'border-gray-700 bg-gray-900/20' : 'border-gray-200 bg-white')
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-xs font-mono opacity-70">{banner.id.slice(0, 8)}...</div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${banner.is_active
                            ? (isDark ? 'border-emerald-700/60 text-emerald-300 bg-emerald-950/20' : 'border-emerald-300 text-emerald-700 bg-emerald-50')
                            : (isDark ? 'border-amber-700/60 text-amber-300 bg-amber-950/20' : 'border-amber-300 text-amber-700 bg-amber-50')
                          }`}>
                            {banner.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {isDirty ? (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${isDark ? 'border-blue-700/60 text-blue-300 bg-blue-950/20' : 'border-blue-300 text-blue-700 bg-blue-50'}`}>
                              Unsaved
                            </span>
                          ) : null}
                          {willHideAfterSave ? (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${isDark ? 'border-gray-700 text-gray-300 bg-gray-900/30' : 'border-gray-300 text-gray-700 bg-gray-50'}`}>
                              Hidden after save
                            </span>
                          ) : null}
                          <div className="flex-1" />
                          <div className="text-[11px] opacity-70">Sort {banner.sort_order}</div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)] gap-4">
                          <div className="space-y-2">
                            <div className={`rounded-lg border overflow-hidden h-28 ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}>
                              <img src={banner.image_url} alt="Banner" className="w-full h-full object-cover" />
                            </div>
                            <Input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) onReplaceBannerImage(banner.id, file);
                                event.target.value = '';
                              }}
                              disabled={uploading || bannerLoading}
                              className={`h-9 text-[11px] ${isDark ? 'bg-gray-800 border-gray-700' : ''}`}
                            />
                          </div>

                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label>Image URL</Label>
                                <Input value={banner.image_url} onChange={(event) => onUpdateBanner(banner.id, { image_url: event.target.value })} placeholder="Banner image URL" className={`h-9 text-xs ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                              </div>
                              <div className="space-y-1">
                                <Label>Link URL</Label>
                                <Input value={banner.link_url || ''} onChange={(event) => onUpdateBanner(banner.id, { link_url: event.target.value || null })} placeholder="Optional destination" className={`h-9 text-xs ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                              </div>
                            </div>

                            <div className="flex flex-wrap items-end gap-3">
                              <div className="space-y-1">
                                <Label>Sort Order</Label>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={String(banner.sort_order ?? 0)}
                                    onChange={(event) => {
                                      const parsed = Number(event.target.value);
                                      const nextSort = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
                                      onUpdateBanner(banner.id, { sort_order: nextSort });
                                    }}
                                    className={`h-9 text-xs w-[120px] ${isDark ? 'bg-gray-800 border-gray-700' : ''}`}
                                  />
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      type="button"
                                      onClick={() => onNudgeBannerSort(banner.id, -1)}
                                      disabled={bannerLoading || uploading || Number(banner.sort_order || 0) <= 0}
                                      className="h-9 w-9 p-0"
                                      title="Move earlier"
                                    >
                                      <ChevronUp className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      type="button"
                                      onClick={() => onNudgeBannerSort(banner.id, 1)}
                                      disabled={bannerLoading || uploading}
                                      className="h-9 w-9 p-0"
                                      title="Move later"
                                    >
                                      <ChevronDown className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              <label className="flex items-center gap-2 text-xs rounded-md border px-3 h-9">
                                <input type="checkbox" checked={banner.is_active} onChange={(event) => onUpdateBanner(banner.id, { is_active: event.target.checked })} />
                                Active
                              </label>
                              <Button size="sm" onClick={() => onSaveBanner(banner)} disabled={bannerLoading || uploading || !isDirty} className="h-9 px-4 text-xs">
                                {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                                Save
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => onResetBanner(banner.id)} disabled={bannerLoading || uploading || !isDirty} className="h-9 px-4 text-xs">
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                Reset
                              </Button>
                              {!banner.is_active ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setDeleteTarget(banner)}
                                  disabled={bannerLoading || uploading || isDirty}
                                  className="h-9 px-4 text-xs"
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                                  Delete
                                </Button>
                              ) : null}
                            </div>

                            {willHideAfterSave ? (
                              <div className={`flex items-center gap-2 text-[11px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                                <EyeOff className="w-3.5 h-3.5" />
                                This banner stays visible while you edit it, but it will leave this filtered list after you save because inactive banners are hidden.
                              </div>
                            ) : null}
                            {!banner.is_active && isDirty ? (
                              <div className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                Save or reset changes before deleting this inactive banner.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Banner"
        description="Delete this inactive banner permanently? The app will also remove its managed image file when possible."
        confirmText="Delete Banner"
        variant="destructive"
        theme={theme}
        onConfirm={() => {
          if (!deleteTarget) return;
          onDeleteBanner(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </>
  );
}

export function StoreConfigTab({
  theme,
  panelClass,
  loading,
  storeConfig,
  storeQrPreviewUrl,
  hasQrImage,
  onStoreConfigChange,
  onQrFileChange,
  onAutoApprovalAction,
  onRemoveQr,
  onSave,
}: StoreConfigTabProps) {
  const [confirmAction, setConfirmAction] = React.useState<{ target: 'account' | 'store'; action: 'start' | 'stop' } | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const renderAutoApprovalCard = (
    target: 'account' | 'store',
    title: string,
    description: string,
    enabled: boolean,
    mode: 'schedule' | 'countdown' | 'always',
    startHour: string,
    endHour: string,
    durationHours: string,
    expiresAt: string | null,
  ) => {
    const isCountdown = mode === 'countdown';
    const isAlways = mode === 'always';
    const accentClass = enabled
      ? (theme === 'dark' ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-emerald-200 bg-emerald-50/70')
      : (theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50');
    const statusText = enabled
      ? (isCountdown
        ? formatCountdownRemaining(expiresAt, nowMs)
        : isAlways
          ? 'Active always (24/7)'
        : `Active daily ${formatHourLabel(startHour)} to ${formatHourLabel(endHour)} (Asia/Manila)`)
      : 'Stopped';

    return (
      <div className={`rounded-xl border p-4 space-y-3 ${accentClass}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Label>{title}</Label>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${enabled
                ? (theme === 'dark' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700')
                : (theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700')}`}>
                {enabled ? 'Running' : 'Stopped'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${theme === 'dark' ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                {isCountdown ? 'Countdown' : isAlways ? 'Always' : 'Schedule'}
              </span>
            </div>
            <div className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{description}</div>
            <div className={`text-xs font-medium ${enabled
              ? (theme === 'dark' ? 'text-emerald-300' : 'text-emerald-700')
              : (theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}`}>
              {statusText}
            </div>
            {enabled && isCountdown && expiresAt && (
              <div className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Ends at {new Date(expiresAt).toLocaleString()}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {!enabled ? (
              <Button type="button" size="sm" onClick={() => setConfirmAction({ target, action: 'start' })}>
                Start
              </Button>
            ) : (
              <Button type="button" size="sm" variant="destructive" onClick={() => setConfirmAction({ target, action: 'stop' })}>
                Stop
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Mode</Label>
            <select
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value === 'countdown'
                  ? 'countdown'
                  : event.target.value === 'always'
                    ? 'always'
                    : 'schedule';
                onStoreConfigChange({
                  ...storeConfig,
                  ...(target === 'account'
                    ? {
                      account_auto_approve_mode: nextMode,
                      account_auto_approve_expires_at: nextMode === 'countdown' ? storeConfig.account_auto_approve_expires_at : null,
                    }
                    : {
                      store_auto_approve_mode: nextMode,
                      store_auto_approve_expires_at: nextMode === 'countdown' ? storeConfig.store_auto_approve_expires_at : null,
                    }),
                });
              }}
              className={`w-full rounded-md border px-3 py-2 text-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <option value="always">Always</option>
              <option value="schedule">Schedule</option>
              <option value="countdown">Countdown</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Timezone</Label>
            <div className={`rounded-md border px-3 py-2 text-sm ${theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
              Asia/Manila
            </div>
          </div>
        </div>

        {isCountdown ? (
          <div className="space-y-1">
            <Label>Countdown Duration (Hours)</Label>
            <Input
              type="number"
              min={1}
              max={168}
              step={1}
              value={durationHours}
              onChange={(event) => onStoreConfigChange({
                ...storeConfig,
                ...(target === 'account'
                  ? { account_auto_approve_duration_hours: event.target.value }
                  : { store_auto_approve_duration_hours: event.target.value }),
              })}
              className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
            />
          </div>
        ) : isAlways ? (
          <div className={`rounded-md border px-3 py-2 text-sm ${theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
            Runs continuously every day until you stop it.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start Hour</Label>
              <Input
                type="number"
                min={0}
                max={23}
                step={1}
                value={startHour}
                onChange={(event) => onStoreConfigChange({
                  ...storeConfig,
                  ...(target === 'account'
                    ? { account_auto_approve_start_hour: event.target.value }
                    : { store_auto_approve_start_hour: event.target.value }),
                })}
                className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
              />
            </div>
            <div className="space-y-1">
              <Label>End Hour</Label>
              <Input
                type="number"
                min={0}
                max={23}
                step={1}
                value={endHour}
                onChange={(event) => onStoreConfigChange({
                  ...storeConfig,
                  ...(target === 'account'
                    ? { account_auto_approve_end_hour: event.target.value }
                    : { store_auto_approve_end_hour: event.target.value }),
                })}
                className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}
              />
            </div>
          </div>
        )}

        <div className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          Only proof-image uploads qualify. OCR must detect a unique reference and exact amount match.
        </div>
      </div>
    );
  };

  return (
    <div className={`border rounded p-3 h-full min-h-0 overflow-auto ${panelClass}`}>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <div className="space-y-5 max-w-4xl">
          <div className={`rounded-2xl border p-4 space-y-4 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white/90'}`}>
            <div className="flex flex-col gap-1">
              <div className="text-base font-semibold">Payment Setup</div>
              <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Core payment channels, pricing, QR, and store banner timing.
              </div>
            </div>
            <div className="space-y-1"><Label>Store Instructions</Label>
              <textarea value={storeConfig.instructions} onChange={(event) => onStoreConfigChange({ ...storeConfig, instructions: event.target.value })} className={`w-full min-h-[100px] rounded-md border p-2 text-sm outline-none resize-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`} placeholder="Instructions shown to users when buying banks..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label>GCash Number</Label><Input value={storeConfig.gcash_number} onChange={(event) => onStoreConfigChange({ ...storeConfig, gcash_number: event.target.value })} placeholder="09171234567" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
              <div className="space-y-1"><Label>Maya Number</Label><Input value={storeConfig.maya_number} onChange={(event) => onStoreConfigChange({ ...storeConfig, maya_number: event.target.value })} placeholder="09181234567" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Price (PHP)</Label>
                <Input type="number" min={0} step="0.01" value={storeConfig.account_price_php} onChange={(event) => onStoreConfigChange({ ...storeConfig, account_price_php: event.target.value })} placeholder="e.g. 299.00" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
              <div className="space-y-1">
                <Label>Banner Rotation (ms)</Label>
                <Input type="number" min={3000} max={15000} step={500} value={storeConfig.banner_rotation_ms} onChange={(event) => onStoreConfigChange({ ...storeConfig, banner_rotation_ms: event.target.value })} placeholder="5000" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} />
                <div className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  Autoplay delay for the store banner slider. Allowed range: 3000 to 15000 ms.
                </div>
              </div>
            </div>
            <div className="space-y-1"><Label>FB Messenger URL</Label><Input value={storeConfig.messenger_url} onChange={(event) => onStoreConfigChange({ ...storeConfig, messenger_url: event.target.value })} placeholder="https://m.me/yourpage" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
            <div className="space-y-1">
              <Label>QR Payment Image</Label>
              <div className="flex items-center gap-3">
                {hasQrImage ? (
                  <div className="flex flex-col gap-0.5 items-center">
                    <img src={storeQrPreviewUrl || storeConfig.qr_image_path} alt="QR" className="w-14 h-14 rounded-md object-cover border bg-white" />
                    <span className="text-[10px] opacity-50">{storeQrPreviewUrl ? 'New' : 'Current'}</span>
                  </div>
                ) : <div className="w-14 h-14 rounded-md border-2 border-dashed flex items-center justify-center text-gray-400 text-xs">No QR</div>}
                <div className="flex-1"><Input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif" onChange={onQrFileChange} disabled={loading} className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
                {hasQrImage && <Button size="sm" variant="outline" onClick={onRemoveQr} className="shrink-0 text-red-500">Remove</Button>}
              </div>
            </div>
          </div>

          <div className={`rounded-2xl border p-4 space-y-4 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white/90'}`}>
            <div className="flex flex-col gap-1">
              <div className="text-base font-semibold">Auto Approval Control</div>
              <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Choose always-on, a daily schedule, or a temporary countdown. Starting or stopping automation asks for confirmation and saves immediately.
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {renderAutoApprovalCard(
                'account',
                'Account Requests',
                'Approve new BUY VDJV proofs automatically when OCR matches the account payment.',
                storeConfig.account_auto_approve_enabled,
                storeConfig.account_auto_approve_mode,
                storeConfig.account_auto_approve_start_hour,
                storeConfig.account_auto_approve_end_hour,
                storeConfig.account_auto_approve_duration_hours,
                storeConfig.account_auto_approve_expires_at,
              )}
              {renderAutoApprovalCard(
                'store',
                'Store Requests',
                'Approve new bank purchase proofs automatically when OCR matches the batch total.',
                storeConfig.store_auto_approve_enabled,
                storeConfig.store_auto_approve_mode,
                storeConfig.store_auto_approve_start_hour,
                storeConfig.store_auto_approve_end_hour,
                storeConfig.store_auto_approve_duration_hours,
                storeConfig.store_auto_approve_expires_at,
              )}
            </div>
          </div>

          <div className={`rounded-2xl border p-4 space-y-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white/90'}`}>
            <div className="flex flex-col gap-1">
              <div className="text-base font-semibold">Decision Email Templates</div>
              <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Customize the approved and rejected emails sent after admin or automation decisions.
              </div>
            </div>
            <div className="space-y-1">
              <Label>Approved Email Subject</Label>
              <Input value={storeConfig.store_email_approve_subject} onChange={(event) => onStoreConfigChange({ ...storeConfig, store_email_approve_subject: event.target.value })} placeholder="VDJV payment approved - {{receipt_reference}}" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Approved Email Body</Label>
              <textarea value={storeConfig.store_email_approve_body} onChange={(event) => onStoreConfigChange({ ...storeConfig, store_email_approve_body: event.target.value })} className={`w-full min-h-[110px] rounded-md border p-2 text-sm outline-none resize-y ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`} placeholder={'Hi {{display_name}},\n\nYour payment request has been approved.\nBanks: {{bank_titles}}'} />
            </div>
            <div className="space-y-1">
              <Label>Rejected Email Subject</Label>
              <Input value={storeConfig.store_email_reject_subject} onChange={(event) => onStoreConfigChange({ ...storeConfig, store_email_reject_subject: event.target.value })} placeholder="VDJV payment update - {{receipt_reference}}" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Rejected Email Body</Label>
              <textarea value={storeConfig.store_email_reject_body} onChange={(event) => onStoreConfigChange({ ...storeConfig, store_email_reject_body: event.target.value })} className={`w-full min-h-[110px] rounded-md border p-2 text-sm outline-none resize-y ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`} placeholder={'Hi {{display_name}},\n\nYour payment request was rejected.\nReason: {{rejection_message}}'} />
            </div>
            <div className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Available placeholders: {'{{display_name}}'}, {'{{email}}'}, {'{{bank_titles}}'}, {'{{bank_count}}'}, {'{{amount}}'}, {'{{receipt_reference}}'}, {'{{payment_reference}}'}, {'{{payment_channel}}'}, {'{{reviewed_at}}'}, {'{{rejection_message}}'}.
            </div>
          </div>

          <div className="sticky bottom-0 flex justify-end">
            <Button onClick={onSave} disabled={loading} className="min-w-[220px]">Save Pay Config</Button>
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction?.action === 'start' ? 'Start Auto Approval' : 'Stop Auto Approval'}
        description={confirmAction
          ? `${confirmAction.action === 'start' ? 'Start' : 'Stop'} ${confirmAction.target === 'account' ? 'Account Requests' : 'Store Requests'} auto approval now?`
          : ''}
        confirmText={confirmAction?.action === 'start' ? 'Start' : 'Stop'}
        variant={confirmAction?.action === 'stop' ? 'destructive' : 'default'}
        theme={theme}
        onConfirm={() => {
          if (!confirmAction) return;
          onAutoApprovalAction(confirmAction.target, confirmAction.action);
          setConfirmAction(null);
        }}
      />
    </div>
  );
}
