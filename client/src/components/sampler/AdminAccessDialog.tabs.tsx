import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyableValue, copyTextToClipboard } from '@/components/ui/copyable-value';
import type { AdminAccountRegistrationRequest, DefaultBankRelease, LandingDownloadConfig, LandingPlatformKey, LandingVersionKey } from '@/lib/admin-api';
import { Check, ChevronDown, ChevronUp, Copy, EyeOff, Loader2, Plus, RotateCcw, Save, Search, Store, Trash2, Upload, X } from 'lucide-react';
import type { SamplerAppConfig, SamplerShortcutAction } from './samplerAppConfig';
import type {
  AdminDialogTheme,
  CatalogDraft,
  DefaultBankSourceOption,
  StoreConfigDraft,
  StoreMarketingBanner,
  StorePromotion,
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
  storeConfig: StoreConfigDraft;
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
  onStoreConfigChange: (next: StoreConfigDraft) => void;
  onSaveStoreConfig: () => void;
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

interface StorePromotionsTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  promotions: StorePromotion[];
  page: number;
  totalPages: number;
  stats: { total: number; active: number; scheduled: number; expired: number; inactive: number };
  catalogDrafts: CatalogDraft[];
  editingPromotionId: string | null;
  form: {
    name: string;
    description: string;
    promotion_type: 'standard' | 'flash_sale';
    discount_type: 'percent' | 'fixed';
    discount_value: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    badge_text: string;
    priority: string;
    is_active: boolean;
    target_bank_ids: string[];
  };
  onFormChange: (next: {
    name: string;
    description: string;
    promotion_type: 'standard' | 'flash_sale';
    discount_type: 'percent' | 'fixed';
    discount_value: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    badge_text: string;
    priority: string;
    is_active: boolean;
    target_bank_ids: string[];
  }) => void;
  onPageChange: (page: number) => void;
  onEdit: (promotion: StorePromotion) => void;
  onReset: () => void;
  onSave: () => Promise<boolean>;
  onDelete: (promotionId: string) => void;
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

interface SamplerDefaultsTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  saving: boolean;
  config: SamplerAppConfig;
  onConfigChange: (next: SamplerAppConfig) => void;
  onRefresh: () => void;
  onReset: () => void;
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

function InlineCopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!String(value || '').trim()) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => {
        void copyTextToClipboard(value).then(() => setCopied(true)).catch(() => undefined);
      }}
      title={copied ? `Copied ${label}` : `Copy ${label}`}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

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
  const isDark = theme === 'dark';
  const totalPlatformSlots = LANDING_VERSION_OPTIONS.length * LANDING_PLATFORM_OPTIONS.length;
  const configuredLinkCount = LANDING_VERSION_OPTIONS.reduce((sum, version) => (
    sum + LANDING_PLATFORM_OPTIONS.filter((platform) => String(config.downloadLinks[version][platform] || '').trim()).length
  ), 0);
  const configuredPlatformDescriptionCount = LANDING_VERSION_OPTIONS.reduce((sum, version) => (
    sum + LANDING_PLATFORM_OPTIONS.filter((platform) => String(config.platformDescriptions[version][platform] || '').trim()).length
  ), 0);

  return (
    <div className={`border rounded p-3 space-y-3 ${panelClass}`}>
      <div className={`rounded-2xl border p-4 ${isDark ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="text-base font-semibold">Landing Download Config</div>
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Manage version copy, platform descriptions, and download links without touching the landing page source.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading || saving}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
            </Button>
            <Button size="sm" onClick={onSave} disabled={loading || saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
              Save Changes
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Versions</div>
            <div className="mt-1 text-xl font-semibold">{LANDING_VERSION_OPTIONS.length}</div>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'border-emerald-700/60 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>Links Ready</div>
            <div className="mt-1 text-xl font-semibold">{configuredLinkCount}/{totalPlatformSlots}</div>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'border-blue-700/60 bg-blue-500/10' : 'border-blue-200 bg-blue-50'}`}>
            <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>Descriptions</div>
            <div className="mt-1 text-xl font-semibold">{configuredPlatformDescriptionCount}/{totalPlatformSlots}</div>
          </div>
          <div className={`rounded-xl border p-3 ${isDark ? 'border-amber-700/60 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
            <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Guidance</div>
            <div className="mt-1 text-xs font-medium">Keep version copy short and platform links explicit.</div>
          </div>
        </div>
      </div>

      <div className="space-y-4 pr-1">
        {LANDING_VERSION_OPTIONS.map((version) => (
          <div key={version} className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{version}</div>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {LANDING_PLATFORM_OPTIONS.filter((platform) => String(config.downloadLinks[version][platform] || '').trim()).length}/{LANDING_PLATFORM_OPTIONS.length} platform links configured
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LANDING_PLATFORM_OPTIONS.map((platform) => {
                  const hasLink = Boolean(String(config.downloadLinks[version][platform] || '').trim());
                  return (
                    <span
                      key={`${version}-${platform}-status`}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${
                        hasLink
                          ? (isDark ? 'border-emerald-700/60 text-emerald-300 bg-emerald-950/20' : 'border-emerald-300 text-emerald-700 bg-emerald-50')
                          : (isDark ? 'border-gray-700 text-gray-300 bg-gray-900/30' : 'border-gray-300 text-gray-700 bg-gray-50')
                      }`}
                    >
                      {platform}
                    </span>
                  );
                })}
              </div>
            </div>
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
                      <div className="flex items-center gap-2">
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
                        <InlineCopyButton value={config.downloadLinks[version][platform]} label={`${version} ${platform} download link`} />
                      </div>
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

const SAMPLER_SHORTCUT_FIELDS: Array<{ key: SamplerShortcutAction; label: string }> = [
  { key: 'stopAll', label: 'Stop All' },
  { key: 'mixer', label: 'Mixer' },
  { key: 'editMode', label: 'Edit Mode' },
  { key: 'mute', label: 'Mute' },
  { key: 'banksMenu', label: 'Banks Menu' },
  { key: 'nextBank', label: 'Next Bank' },
  { key: 'prevBank', label: 'Previous Bank' },
  { key: 'upload', label: 'Upload' },
  { key: 'volumeUp', label: 'Volume Up' },
  { key: 'volumeDown', label: 'Volume Down' },
  { key: 'padSizeUp', label: 'Pad Size Up' },
  { key: 'padSizeDown', label: 'Pad Size Down' },
  { key: 'importBank', label: 'Import Bank' },
  { key: 'activateSecondary', label: 'Activate Secondary' },
  { key: 'midiShift', label: 'MIDI Shift' },
];

const updateSamplerShortcut = (
  config: SamplerAppConfig,
  action: SamplerShortcutAction,
  value: string,
): SamplerAppConfig => ({
  ...config,
  shortcutDefaults: {
    ...config.shortcutDefaults,
    [action]: value,
  },
});

export function SamplerDefaultsTab({
  theme,
  panelClass,
  loading,
  saving,
  config,
  onConfigChange,
  onRefresh,
  onReset,
  onSave,
}: SamplerDefaultsTabProps) {
  const isDark = theme === 'dark';
  const cardClass = isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white';
  const mutedText = isDark ? 'text-gray-400' : 'text-gray-600';

  return (
    <div className={`border rounded p-3 space-y-3 ${panelClass}`}>
      <div className={`rounded-2xl border p-4 ${cardClass}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="text-base font-semibold">Sampler Defaults</div>
            <div className={`text-sm ${mutedText}`}>
              These values seed first-run app behavior, blank default-bank setup, new pad creation, quota fallbacks, and upload limits.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading || saving}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
            </Button>
            <Button size="sm" variant="outline" onClick={onReset} disabled={loading || saving}>
              <RotateCcw className="w-3.5 h-3.5 mr-2" />
              Reset
            </Button>
            <Button size="sm" onClick={onSave} disabled={loading || saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
              Save Defaults
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
          <div>
            <div className="text-sm font-semibold">UI Defaults</div>
            <div className={`text-xs ${mutedText}`}>Used when the app boots without saved settings.</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Pad Size Portrait</Label>
              <Input type="number" min={2} max={8} value={config.uiDefaults.defaultPadSizePortrait} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultPadSizePortrait: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Pad Size Landscape</Label>
              <Input type="number" min={2} max={16} value={config.uiDefaults.defaultPadSizeLandscape} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultPadSizeLandscape: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Channel Count Mobile</Label>
              <Input type="number" min={2} max={8} value={config.uiDefaults.defaultChannelCountMobile} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultChannelCountMobile: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Channel Count Desktop</Label>
              <Input type="number" min={2} max={8} value={config.uiDefaults.defaultChannelCountDesktop} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultChannelCountDesktop: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Master Volume</Label>
              <Input type="number" min={0} max={1} step="0.05" value={config.uiDefaults.defaultMasterVolume} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultMasterVolume: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Stop Mode</Label>
              <select value={config.uiDefaults.defaultStopMode} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultStopMode: event.target.value as SamplerAppConfig['uiDefaults']['defaultStopMode'] } })} className={`w-full h-10 rounded-md border px-3 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
                <option value="instant">Instant</option>
                <option value="fadeout">Fadeout</option>
                <option value="brake">Brake</option>
                <option value="backspin">Backspin</option>
                <option value="filter">Filter</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Side Panel Mode</Label>
              <select value={config.uiDefaults.defaultSidePanelMode} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultSidePanelMode: event.target.value as 'overlay' | 'reflow' } })} className={`w-full h-10 rounded-md border px-3 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
                <option value="overlay">Overlay</option>
                <option value="reflow">Reflow</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Graphics Profile</Label>
              <select value={config.uiDefaults.defaultGraphicsProfile} onChange={(event) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultGraphicsProfile: event.target.value as SamplerAppConfig['uiDefaults']['defaultGraphicsProfile'] } })} className={`w-full h-10 rounded-md border px-3 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
                <option value="auto">Auto</option>
                <option value="lowest">Lowest</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <label className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isDark ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
              <Checkbox checked={config.uiDefaults.defaultKeyboardMappingEnabled} onCheckedChange={(checked) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultKeyboardMappingEnabled: checked === true } })} />
              <span className="text-sm">Enable keyboard mapping by default</span>
            </label>
            <label className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isDark ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
              <Checkbox checked={config.uiDefaults.defaultAutoPadBankMapping} onCheckedChange={(checked) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultAutoPadBankMapping: checked === true } })} />
              <span className="text-sm">Auto fill missing pad/bank mappings</span>
            </label>
          </div>
          {config.uiDefaults.defaultKeyboardMappingEnabled ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isDark ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
                <Checkbox checked={config.uiDefaults.defaultHideShortcutLabels} onCheckedChange={(checked) => onConfigChange({ ...config, uiDefaults: { ...config.uiDefaults, defaultHideShortcutLabels: checked === true } })} />
                <span className="text-sm">Hide shortcut labels by default</span>
              </label>
            </div>
          ) : (
            <div className={`rounded-lg border border-dashed px-3 py-2 text-xs ${isDark ? 'border-gray-800 bg-gray-950/20 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
              Shortcut labels stay hidden while keyboard mapping is disabled by default.
            </div>
          )}
        </div>

        <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
          <div>
            <div className="text-sm font-semibold">Default Bank</div>
            <div className={`text-xs ${mutedText}`}>Used for empty-state bank creation and default-bank labeling.</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px] gap-3">
            <div className="space-y-1">
              <Label>Default Bank Name</Label>
              <Input value={config.bankDefaults.defaultBankName} onChange={(event) => onConfigChange({ ...config, bankDefaults: { ...config.bankDefaults, defaultBankName: event.target.value } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Default Bank Color</Label>
              <Input value={config.bankDefaults.defaultBankColor} onChange={(event) => onConfigChange({ ...config, bankDefaults: { ...config.bankDefaults, defaultBankColor: event.target.value } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
          <div>
            <div className="text-sm font-semibold">New Pad Template</div>
            <div className={`text-xs ${mutedText}`}>Applied when users add new audio pads.</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Trigger Mode</Label>
              <select value={config.padDefaults.defaultTriggerMode} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultTriggerMode: event.target.value as SamplerAppConfig['padDefaults']['defaultTriggerMode'] } })} className={`w-full h-10 rounded-md border px-3 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
                <option value="toggle">Toggle</option>
                <option value="hold">Hold</option>
                <option value="stutter">Stutter</option>
                <option value="unmute">Unmute</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Playback Mode</Label>
              <select value={config.padDefaults.defaultPlaybackMode} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultPlaybackMode: event.target.value as SamplerAppConfig['padDefaults']['defaultPlaybackMode'] } })} className={`w-full h-10 rounded-md border px-3 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
                <option value="once">Once</option>
                <option value="loop">Loop</option>
                <option value="stopper">Stopper</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Volume</Label>
              <Input type="number" min={0} max={1} step="0.05" value={config.padDefaults.defaultVolume} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultVolume: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Gain dB</Label>
              <Input type="number" min={-24} max={24} step="0.5" value={config.padDefaults.defaultGainDb} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultGainDb: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Fade In ms</Label>
              <Input type="number" min={0} max={60000} value={config.padDefaults.defaultFadeInMs} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultFadeInMs: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Fade Out ms</Label>
              <Input type="number" min={0} max={60000} value={config.padDefaults.defaultFadeOutMs} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultFadeOutMs: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Pitch</Label>
              <Input type="number" min={-12} max={12} value={config.padDefaults.defaultPitch} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultPitch: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Tempo Percent</Label>
              <Input type="number" min={-50} max={100} value={config.padDefaults.defaultTempoPercent} onChange={(event) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultTempoPercent: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          </div>
          <label className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isDark ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
            <Checkbox checked={config.padDefaults.defaultKeyLock} onCheckedChange={(checked) => onConfigChange({ ...config, padDefaults: { ...config.padDefaults, defaultKeyLock: checked === true } })} />
            <span className="text-sm">Enable key lock by default</span>
          </label>
        </div>

        <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
          <div>
            <div className="text-sm font-semibold">Quota and Limits</div>
            <div className={`text-xs ${mutedText}`}>Used as defaults for new accounts and upload admission checks.</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Owned Bank Quota</Label>
              <Input type="number" min={1} max={500} value={config.quotaDefaults.ownedBankQuota} onChange={(event) => onConfigChange({ ...config, quotaDefaults: { ...config.quotaDefaults, ownedBankQuota: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Owned Bank Pad Cap</Label>
              <Input type="number" min={1} max={256} value={config.quotaDefaults.ownedBankPadCap} onChange={(event) => onConfigChange({ ...config, quotaDefaults: { ...config.quotaDefaults, ownedBankPadCap: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Device Total Bank Cap</Label>
              <Input type="number" min={10} max={1000} value={config.quotaDefaults.deviceTotalBankCap} onChange={(event) => onConfigChange({ ...config, quotaDefaults: { ...config.quotaDefaults, deviceTotalBankCap: Number(event.target.value) } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Max Pad Audio MB</Label>
              <Input type="number" min={1} max={500} value={Math.round(config.audioLimits.maxPadAudioBytes / 1024 / 1024)} onChange={(event) => onConfigChange({ ...config, audioLimits: { ...config.audioLimits, maxPadAudioBytes: Math.max(1, Number(event.target.value || 0)) * 1024 * 1024 } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Max Pad Audio Duration Seconds</Label>
              <Input type="number" min={10} max={7200} value={Math.round(config.audioLimits.maxPadAudioDurationMs / 1000)} onChange={(event) => onConfigChange({ ...config, audioLimits: { ...config.audioLimits, maxPadAudioDurationMs: Math.max(10, Number(event.target.value || 0)) * 1000 } })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
        <div>
          <div className="text-sm font-semibold">Shortcut Defaults</div>
          <div className={`text-xs ${mutedText}`}>Applied only to fresh settings or reset-to-default flows, not forced on existing users.</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {SAMPLER_SHORTCUT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label>{field.label}</Label>
              <Input value={config.shortcutDefaults[field.key] || ''} onChange={(event) => onConfigChange(updateSamplerShortcut(config, field.key, event.target.value))} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          ))}
        </div>
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
    <div className={`border rounded p-3 space-y-3 overflow-visible lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden ${panelClass}`}>
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

      <div className={`rounded-lg border p-3 overflow-visible lg:flex-1 lg:min-h-0 lg:flex lg:flex-col ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="text-sm font-semibold">Release History</div>
            <div className="text-xs opacity-70">Rollback switches the active release without deleting history.</div>
          </div>
          {rollbackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        </div>

        <div className="overflow-x-auto rounded border lg:flex-1 lg:min-h-0 lg:overflow-auto">
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
    <div className={`border rounded p-3 space-y-2 ${panelClass}`}>
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
            className={`h-9 w-full pl-8 text-sm sm:w-56 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <>
          <div className="space-y-2">
            {rows.length === 0 ? (
              <p className="text-center py-8 opacity-50 text-sm">No {filter} account registration requests.</p>
            ) : rows.map((req) => (
              <div key={req.id} className={`p-3 rounded-lg border ${cardClass}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-sm truncate">{req.display_name || 'No Name'}</h4>
                    </div>
                    <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'}`}>
                      <span className="shrink-0">{req.display_name || 'No Name'} -</span>
                      <CopyableValue
                        value={req.email || '-'}
                        label="account request email"
                        className="min-w-0 max-w-full"
                        valueClassName="text-inherit"
                        buttonClassName="h-5 w-5"
                      />
                    </div>
                    <div className={`text-xs mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                      <div><span className="opacity-70">Channel:</span> <span className="uppercase font-medium">{req.payment_channel}</span></div>
                      <div><span className="opacity-70">Name:</span> {req.payer_name || '-'}</div>
                      <div>
                        <span className="opacity-70">Ref:</span>{' '}
                        <CopyableValue
                          value={req.reference_no || '-'}
                          label="account request reference"
                          valueClassName="font-mono text-inherit"
                          buttonClassName="h-5 w-5"
                        />
                      </div>
                      <div><span className="opacity-70">Date:</span> {new Date(req.created_at).toLocaleString()}</div>
                      <div className="col-span-2">
                        <span className="opacity-70">Request ID:</span>{' '}
                        <CopyableValue
                          value={req.id}
                          label="account request id"
                          valueClassName="font-mono text-inherit"
                          buttonClassName="h-5 w-5"
                        />
                      </div>
                      {req.reviewed_at && (
                        <div className="col-span-2">
                          <span className="opacity-70">Reviewed:</span> {new Date(req.reviewed_at).toLocaleString()}
                          {req.reviewed_by ? ` by ${req.reviewed_by.slice(0, 8)}...` : ''}
                        </div>
                      )}
                      {req.approved_auth_user_id && (
                        <div className="col-span-2">
                          <span className="opacity-70">Approved User:</span>{' '}
                          <CopyableValue
                            value={req.approved_auth_user_id}
                            label="approved user id"
                            valueClassName="font-mono text-inherit"
                            buttonClassName="h-5 w-5"
                          />
                        </div>
                      )}
                      {req.decision_source && (
                        <div><span className="opacity-70">Decision:</span> {formatAutomationLabel(req.decision_source)}</div>
                      )}
                      {req.automation_result && (
                        <div><span className="opacity-70">Auto Check:</span> {formatAutomationLabel(req.automation_result)}</div>
                      )}
                      {req.ocr_reference_no && (
                        <div>
                          <span className="opacity-70">OCR Ref:</span>{' '}
                          <CopyableValue
                            value={req.ocr_reference_no}
                            label="ocr reference"
                            valueClassName="font-mono text-inherit"
                            buttonClassName="h-5 w-5"
                          />
                        </div>
                      )}
                      {req.ocr_recipient_number && (
                        <div>
                          <span className="opacity-70">OCR Wallet:</span>{' '}
                          <CopyableValue
                            value={req.ocr_recipient_number}
                            label="ocr wallet number"
                            valueClassName="font-mono text-inherit"
                            buttonClassName="h-5 w-5"
                          />
                        </div>
                      )}
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
    <div className={`border rounded p-3 space-y-2 ${panelClass}`}>
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
            className={`h-9 w-full pl-8 text-sm sm:w-56 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`}
          />
        </div>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <>
          <div className="space-y-2">
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
                      <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                        <span className="shrink-0">{req.user_profile.display_name || 'No Name'} -</span>
                        <CopyableValue
                          value={req.user_profile.email || '-'}
                          label="store request email"
                          className="min-w-0 max-w-full"
                          valueClassName="text-inherit"
                          buttonClassName="h-5 w-5"
                        />
                      </div>
                    )}
                    <div className={`text-xs mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                      <div><span className="opacity-70">Channel:</span> <span className="uppercase font-medium">{req.payment_channel}</span></div>
                      <div><span className="opacity-70">Name:</span> {req.payer_name}</div>
                      <div>
                        <span className="opacity-70">Ref:</span>{' '}
                        <CopyableValue
                          value={req.reference_no}
                          label="store request reference"
                          valueClassName="font-mono text-inherit"
                          buttonClassName="h-5 w-5"
                        />
                      </div>
                      <div><span className="opacity-70">Date:</span> {new Date(req.created_at).toLocaleDateString()}</div>
                      <div className="col-span-2">
                        <span className="opacity-70">Request ID:</span>{' '}
                        <CopyableValue
                          value={req.id}
                          label="store request id"
                          valueClassName="font-mono text-inherit"
                          buttonClassName="h-5 w-5"
                        />
                        {req.batch_id ? (
                          <>
                            <span className="mx-1 opacity-50">|</span>
                            <span className="opacity-70">Batch:</span>{' '}
                            <CopyableValue
                              value={req.batch_id}
                              label="store request batch id"
                              valueClassName="font-mono text-inherit"
                              buttonClassName="h-5 w-5"
                            />
                          </>
                        ) : null}
                      </div>
                      <div className="col-span-2"><span className="opacity-70">Amount:</span> {req.hasTbdAmount ? 'TBD' : `PHP ${req.totalAmountPhp.toLocaleString()}`}</div>
                      {req.decision_source && <div><span className="opacity-70">Decision:</span> {formatAutomationLabel(req.decision_source)}</div>}
                      {req.automation_result && <div><span className="opacity-70">Auto Check:</span> {formatAutomationLabel(req.automation_result)}</div>}
                      {req.ocr_reference_no && (
                        <div>
                          <span className="opacity-70">OCR Ref:</span>{' '}
                          <CopyableValue
                            value={req.ocr_reference_no}
                            label="ocr reference"
                            valueClassName="font-mono text-inherit"
                            buttonClassName="h-5 w-5"
                          />
                        </div>
                      )}
                      {req.ocr_recipient_number && (
                        <div>
                          <span className="opacity-70">OCR Wallet:</span>{' '}
                          <CopyableValue
                            value={req.ocr_recipient_number}
                            label="ocr wallet number"
                            valueClassName="font-mono text-inherit"
                            buttonClassName="h-5 w-5"
                          />
                        </div>
                      )}
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
  storeConfig,
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
  onStoreConfigChange,
  onSaveStoreConfig,
  onUpdateDraft,
  onPublishDraft,
  onReload,
  pushNotice,
}: StoreCatalogTabProps) {
  return (
    <div className={`border rounded p-3 space-y-2 ${panelClass}`}>
      <div className="space-y-2">
        <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Manage store catalog items. Drafts are created automatically during Admin Export.</p>
        <div className={`rounded-lg border p-3 space-y-3 ${theme === 'dark' ? 'border-amber-700/40 bg-amber-500/10' : 'border-amber-200 bg-amber-50/80'}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Store Maintenance Mode</div>
              <div className="text-xs opacity-75">
                Hide the Bank Store for end users and guests while still allowing admins to browse and manage it.
              </div>
            </div>
            <Button
              size="sm"
              onClick={onSaveStoreConfig}
              disabled={loading}
              className={storeConfig.store_maintenance_enabled ? 'bg-amber-600 hover:bg-amber-700 text-white' : undefined}
            >
              {storeConfig.store_maintenance_enabled ? 'Save Maintenance' : 'Save Store Config'}
            </Button>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-start">
            <label className="flex items-start gap-3 rounded-lg border px-3 py-2 md:min-w-[260px] cursor-pointer">
              <input
                type="checkbox"
                checked={storeConfig.store_maintenance_enabled}
                onChange={(event) => onStoreConfigChange({
                  ...storeConfig,
                  store_maintenance_enabled: event.target.checked,
                })}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Maintenance Enabled</div>
                <div className="text-xs opacity-70">
                  End users see a maintenance message instead of catalog banks. Guest sample banks are hidden too.
                </div>
              </div>
            </label>
            <div className="flex-1 min-w-0 space-y-1">
              <Label>Maintenance Message</Label>
              <textarea
                value={storeConfig.store_maintenance_message}
                onChange={(event) => onStoreConfigChange({
                  ...storeConfig,
                  store_maintenance_message: event.target.value,
                })}
                placeholder="Bank Store is under maintenance. Downloads and browsing are temporarily unavailable."
                className={`w-full min-h-[92px] rounded-md border p-2 text-sm outline-none resize-y ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`}
              />
              <div className="text-[11px] opacity-70">Admins bypass maintenance and can still use the store.</div>
            </div>
          </div>
        </div>
        <div className={`rounded-lg border p-2.5 space-y-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50/70'}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
            <div className="xl:col-span-2">
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Search</div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
                <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Title or asset name..." className={`h-9 pl-8 text-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Bank</div>
              <select value={bankFilter} onChange={(event) => onBankFilterChange(event.target.value)} className={`h-9 w-full rounded-md border px-2 text-sm outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="all">All banks</option>
                {bankOptions.map((bankName) => (
                  <option key={bankName} value={bankName}>{bankName}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Status</div>
              <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as 'all' | 'published' | 'draft')} className={`h-9 w-full rounded-md border px-2 text-sm outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="all">All status</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">Pricing</div>
              <select value={paidFilter} onChange={(event) => onPaidFilterChange(event.target.value as 'all' | 'paid' | 'free')} className={`h-9 w-full rounded-md border px-2 text-sm outline-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
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
          <div>
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

export function StorePromotionsTab({
  theme,
  panelClass,
  loading,
  promotions,
  page,
  totalPages,
  stats,
  catalogDrafts,
  editingPromotionId,
  form,
  onFormChange,
  onPageChange,
  onEdit,
  onReset,
  onSave,
  onDelete,
}: StorePromotionsTabProps) {
  const isDark = theme === 'dark';
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<StorePromotion | null>(null);
  const bankOptions = React.useMemo(() => {
    const byId = new Map<string, string>();
    catalogDrafts.forEach((draft) => {
      if (!draft.bank_id) return;
      if (!byId.has(draft.bank_id)) byId.set(draft.bank_id, draft.bank?.title || 'Unknown Bank');
    });
    return Array.from(byId.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [catalogDrafts]);
  const selectedBankCount = form.target_bank_ids.length;
  const isFlashSale = form.promotion_type === 'flash_sale';
  const mutedToneClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const selectedModeToneClass = isFlashSale
    ? (isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700')
    : (isDark ? 'border-sky-500/35 bg-sky-500/10 text-sky-100' : 'border-sky-200 bg-sky-50 text-sky-700');

  const handleEditorOpenChange = React.useCallback((open: boolean) => {
    setEditorOpen(open);
    if (!open) onReset();
  }, [onReset]);

  const handleCreate = React.useCallback(() => {
    onReset();
    setEditorOpen(true);
  }, [onReset]);

  const handleEdit = React.useCallback((promotion: StorePromotion) => {
    onEdit(promotion);
    setEditorOpen(true);
  }, [onEdit]);

  const handleSave = React.useCallback(async () => {
    const ok = await onSave();
    if (ok) setEditorOpen(false);
  }, [onSave]);

  return (
    <StorePromotionsSurface
      theme={theme}
      panelClass={panelClass}
      loading={loading}
      promotions={promotions}
      page={page}
      totalPages={totalPages}
      stats={stats}
      bankOptions={bankOptions}
      editingPromotionId={editingPromotionId}
      form={form}
      onFormChange={onFormChange}
      editorOpen={editorOpen}
      onEditorOpenChange={handleEditorOpenChange}
      onCreate={handleCreate}
      onPageChange={onPageChange}
      onEdit={handleEdit}
      onReset={onReset}
      onSave={handleSave}
      deleteTarget={deleteTarget}
      onDeleteTargetChange={setDeleteTarget}
      onDelete={onDelete}
    />
  );

  return (
    <div className={`border rounded p-3 space-y-3 overflow-visible lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden ${panelClass}`}>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className={`px-2 py-0.5 rounded border ${isDark ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`}>Total {stats.total}</span>
        <span className={`px-2 py-0.5 rounded border ${isDark ? 'border-emerald-700/60 text-emerald-300' : 'border-emerald-300 text-emerald-700'}`}>Active {stats.active}</span>
        <span className={`px-2 py-0.5 rounded border ${isDark ? 'border-blue-700/60 text-blue-300' : 'border-blue-300 text-blue-700'}`}>Scheduled {stats.scheduled}</span>
        <span className={`px-2 py-0.5 rounded border ${isDark ? 'border-amber-700/60 text-amber-300' : 'border-amber-300 text-amber-700'}`}>Expired {stats.expired}</span>
        <span className={`px-2 py-0.5 rounded border ${isDark ? 'border-rose-700/60 text-rose-300' : 'border-rose-300 text-rose-700'}`}>Inactive {stats.inactive}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-3 flex-1 min-h-0">
        <div className={`rounded-xl border p-3 space-y-3 min-h-0 overflow-auto ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{editingPromotionId ? 'Edit Promotion' : 'New Promotion'}</div>
              <div className="text-xs opacity-70">Discounts stay separate from base catalog price.</div>
            </div>
            {editingPromotionId && (
              <Button size="sm" variant="outline" onClick={onReset}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Reset
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <textarea value={form.description} onChange={(event) => onFormChange({ ...form, description: event.target.value })} className={`w-full min-h-[80px] rounded-md border p-2 text-sm outline-none resize-y ${isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Mode</Label>
              <select value={form.promotion_type} onChange={(event) => onFormChange({ ...form, promotion_type: event.target.value === 'standard' ? 'standard' : 'flash_sale' })} className={`h-9 w-full rounded-md border px-2 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="flash_sale">Flash Sale</option>
                <option value="standard">Standard</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Discount Type</Label>
              <select value={form.discount_type} onChange={(event) => onFormChange({ ...form, discount_type: event.target.value === 'fixed' ? 'fixed' : 'percent' })} className={`h-9 w-full rounded-md border px-2 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                <option value="percent">Percent</option>
                <option value="fixed">Fixed PHP</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Discount Value</Label>
              <Input type="number" min={0} step={form.discount_type === 'percent' ? '0.01' : '1'} value={form.discount_value} onChange={(event) => onFormChange({ ...form, discount_value: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Input type="number" min={0} step="1" value={form.priority} onChange={(event) => onFormChange({ ...form, priority: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start</Label>
              <Input type="datetime-local" value={form.starts_at} onChange={(event) => onFormChange({ ...form, starts_at: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>End</Label>
              <Input type="datetime-local" value={form.ends_at} onChange={(event) => onFormChange({ ...form, ends_at: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Timezone</Label>
              <Input value={form.timezone} onChange={(event) => onFormChange({ ...form, timezone: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
            <div className="space-y-1">
              <Label>Badge</Label>
              <Input value={form.badge_text} onChange={(event) => onFormChange({ ...form, badge_text: event.target.value })} placeholder="FLASH SALE" className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(event) => onFormChange({ ...form, is_active: event.target.checked })} />
            <span>Promotion enabled</span>
          </label>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Target Banks</div>
            <div className={`max-h-28 overflow-auto rounded-md border p-2 space-y-1 ${isDark ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
              {bankOptions.length === 0 ? (
                <div className="text-xs opacity-70">No catalog banks available yet.</div>
              ) : bankOptions.map((bank) => (
                <label key={bank.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.target_bank_ids.includes(bank.id)}
                    onChange={(event) => onFormChange({
                      ...form,
                      target_bank_ids: event.target.checked
                        ? [...form.target_bank_ids, bank.id]
                        : form.target_bank_ids.filter((id) => id !== bank.id),
                    })}
                  />
                  <span>{bank.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={loading} className="flex-1">
              {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              {editingPromotionId ? 'Save Promotion' : 'Create Promotion'}
            </Button>
            <Button type="button" variant="outline" onClick={onReset} disabled={loading}>
              Clear
            </Button>
          </div>
        </div>

        <div className={`rounded-xl border p-3 min-h-0 overflow-auto ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
          <div className="text-sm font-semibold mb-3">Existing Promotions</div>
          {promotions.length === 0 ? (
            <div className="text-sm opacity-70">No promotions created yet.</div>
          ) : (
            <div className="space-y-3">
              {promotions.map((promotion) => (
                <div key={promotion.id} className={`rounded-lg border p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{promotion.name}</div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${promotion.status === 'active'
                          ? (isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700')
                          : promotion.status === 'scheduled'
                            ? (isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700')
                            : promotion.status === 'expired'
                              ? (isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700')
                              : (isDark ? 'bg-rose-500/20 text-rose-300' : 'bg-rose-100 text-rose-700')}`}>
                          {promotion.status}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${isDark ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-fuchsia-100 text-fuchsia-700'}`}>
                          {promotion.promotion_type === 'flash_sale' ? 'Flash Sale' : 'Standard'}
                        </span>
                      </div>
                      <div className="text-xs opacity-70 mt-1">
                        {promotion.discount_type === 'percent' ? `${promotion.discount_value}% off` : `PHP ${promotion.discount_value} off`}
                        {' • '}
                        {new Date(promotion.starts_at).toLocaleString()} to {new Date(promotion.ends_at).toLocaleString()}
                      </div>
                      {promotion.description ? <div className="text-xs opacity-80 mt-1">{promotion.description}</div> : null}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => onEdit(promotion)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onDelete(promotion.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(promotion.target_labels || []).map((target) => (
                      <span key={`${target.type}-${target.id}`} className={`px-2 py-0.5 rounded border text-[11px] ${isDark ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
                        {target.type === 'catalog' ? 'Item' : 'Bank'}: {target.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StorePromotionsSurface({
  theme,
  panelClass,
  loading,
  promotions,
  page,
  totalPages,
  stats,
  bankOptions,
  editingPromotionId,
  form,
  onFormChange,
  editorOpen,
  onEditorOpenChange,
  onCreate,
  onPageChange,
  onEdit,
  onReset,
  onSave,
  deleteTarget,
  onDeleteTargetChange,
  onDelete,
}: {
  theme: AdminDialogTheme;
  panelClass: string;
  loading: boolean;
  promotions: StorePromotion[];
  page: number;
  totalPages: number;
  stats: { total: number; active: number; scheduled: number; expired: number; inactive: number };
  bankOptions: Array<{ id: string; label: string }>;
  editingPromotionId: string | null;
  form: StorePromotionsTabProps['form'];
  onFormChange: StorePromotionsTabProps['onFormChange'];
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
  onCreate: () => void;
  onPageChange: (page: number) => void;
  onEdit: (promotion: StorePromotion) => void;
  onReset: () => void;
  onSave: () => Promise<void>;
  deleteTarget: StorePromotion | null;
  onDeleteTargetChange: (promotion: StorePromotion | null) => void;
  onDelete: (promotionId: string) => void;
}) {
  const isDark = theme === 'dark';
  const selectedBankCount = form.target_bank_ids.length;
  const isFlashSale = form.promotion_type === 'flash_sale';
  const mutedToneClass = isDark ? 'text-gray-400' : 'text-gray-500';
  const selectedModeToneClass = isFlashSale
    ? (isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700')
    : (isDark ? 'border-sky-500/35 bg-sky-500/10 text-sky-100' : 'border-sky-200 bg-sky-50 text-sky-700');

  return (
    <>
      <div className={`border rounded p-3 space-y-3 ${panelClass}`}>
        <div className={`rounded-2xl border p-4 ${isDark ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="text-lg font-semibold">Promotions</div>
              <div className={`text-sm ${mutedToneClass}`}>
                Schedule temporary discounts without touching the base catalog price. Flash sales feel urgent in the storefront, while standard promotions stay calmer.
              </div>
            </div>
            <Button onClick={onCreate} disabled={loading} className={isDark ? 'bg-teal-500 hover:bg-teal-400 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}>
              <Plus className="w-4 h-4 mr-2" />
              New Promotion
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${mutedToneClass}`}>Total</div>
              <div className="mt-1 text-xl font-semibold">{stats.total}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-emerald-700/60 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>Active</div>
              <div className="mt-1 text-xl font-semibold">{stats.active}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-blue-700/60 bg-blue-500/10' : 'border-blue-200 bg-blue-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>Scheduled</div>
              <div className="mt-1 text-xl font-semibold">{stats.scheduled}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-amber-700/60 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Expired</div>
              <div className="mt-1 text-xl font-semibold">{stats.expired}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-rose-700/60 bg-rose-500/10' : 'border-rose-200 bg-rose-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>Inactive</div>
              <div className="mt-1 text-xl font-semibold">{stats.inactive}</div>
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-sm font-semibold">Existing Promotions</div>
              <div className={`text-xs ${mutedToneClass}`}>Create and edit promotions in a dedicated modal instead of reusing the inline form.</div>
            </div>
          </div>
          {promotions.length === 0 ? (
            <div className={`rounded-xl border border-dashed p-8 text-center ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-300 text-gray-500'}`}>
              <div className="text-sm font-medium">No promotions created yet.</div>
              <div className="text-xs mt-1">Create your first flash sale or scheduled standard discount.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {promotions.map((promotion) => (
                <div key={promotion.id} className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{promotion.name}</div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${promotion.status === 'active'
                          ? (isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700')
                          : promotion.status === 'scheduled'
                            ? (isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700')
                            : promotion.status === 'expired'
                              ? (isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700')
                              : (isDark ? 'bg-rose-500/20 text-rose-300' : 'bg-rose-100 text-rose-700')}`}>
                          {promotion.status}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${promotion.promotion_type === 'flash_sale'
                          ? (isDark ? 'bg-rose-500/20 text-rose-200' : 'bg-rose-100 text-rose-700')
                          : (isDark ? 'bg-sky-500/20 text-sky-200' : 'bg-sky-100 text-sky-700')}`}>
                          {promotion.promotion_type === 'flash_sale' ? 'Flash Sale' : 'Standard'}
                        </span>
                        {!promotion.is_active && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className={`text-xs mt-1 ${mutedToneClass}`}>
                        {promotion.discount_type === 'percent' ? `${promotion.discount_value}% off` : `PHP ${promotion.discount_value} off`}
                        {' • '}
                        {new Date(promotion.starts_at).toLocaleString()} to {new Date(promotion.ends_at).toLocaleString()}
                      </div>
                      {promotion.description ? <div className={`text-xs mt-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{promotion.description}</div> : null}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => onEdit(promotion)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onDeleteTargetChange(promotion)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(promotion.target_labels || []).map((target) => (
                      <span key={`${target.type}-${target.id}`} className={`px-2 py-0.5 rounded border text-[11px] ${isDark ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
                        Bank: {target.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
            </div>
          )}
        </div>
      </div>

      <Dialog open={editorOpen} onOpenChange={onEditorOpenChange} useHistory={false}>
        <DialogContent
          overlayClassName="z-[129]"
          className={`${isDark ? 'bg-gray-900 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-200'} z-[130] max-h-[92dvh] overflow-y-auto sm:max-w-3xl`}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{editingPromotionId ? 'Edit Promotion' : 'Create Promotion'}</DialogTitle>
            <DialogDescription className={isDark ? 'text-gray-400' : 'text-gray-500'}>
              Promotions apply on top of the bank catalog price. Flash sales get stronger urgency in the storefront, while standard promotions keep the presentation softer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => onFormChange({ ...form, promotion_type: 'flash_sale', badge_text: form.badge_text || 'FLASH SALE' })}
                className={`rounded-xl border p-4 text-left transition-colors ${isFlashSale ? selectedModeToneClass : (isDark ? 'border-gray-700 bg-gray-950/40 hover:border-rose-500/40' : 'border-gray-200 bg-gray-50 hover:border-rose-200')}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">Flash Sale</div>
                  {isFlashSale ? <span className="text-[10px] font-bold uppercase">Selected</span> : null}
                </div>
                <div className={`mt-1 text-xs ${isFlashSale ? '' : mutedToneClass}`}>
                  Urgent promo style with flash-sale treatment and sale-end emphasis in the storefront.
                </div>
              </button>
              <button
                type="button"
                onClick={() => onFormChange({ ...form, promotion_type: 'standard', badge_text: form.badge_text === 'FLASH SALE' ? '' : form.badge_text })}
                className={`rounded-xl border p-4 text-left transition-colors ${!isFlashSale ? selectedModeToneClass : (isDark ? 'border-gray-700 bg-gray-950/40 hover:border-sky-500/40' : 'border-gray-200 bg-gray-50 hover:border-sky-200')}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">Standard</div>
                  {!isFlashSale ? <span className="text-[10px] font-bold uppercase">Selected</span> : null}
                </div>
                <div className={`mt-1 text-xs ${!isFlashSale ? '' : mutedToneClass}`}>
                  Regular scheduled sale for softer discount messaging without the flash-sale label.
                </div>
              </button>
            </div>

            <div className={`rounded-xl border p-3 text-xs ${selectedModeToneClass}`}>
              {isFlashSale
                ? 'Flash sales work best for short, time-sensitive offers. The storefront shows the flash-sale label and the sale end time.'
                : 'Standard promotions are better for weekend campaigns, ongoing launches, or regular discounting without urgency-heavy treatment.'}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
              <div className="space-y-1">
                <Label>Badge</Label>
                <Input value={form.badge_text} onChange={(event) => onFormChange({ ...form, badge_text: event.target.value })} placeholder={isFlashSale ? 'FLASH SALE' : 'WEEKEND SALE'} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Description</Label>
              <textarea value={form.description} onChange={(event) => onFormChange({ ...form, description: event.target.value })} className={`w-full min-h-[88px] rounded-md border p-2 text-sm outline-none resize-y ${isDark ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Discount Type</Label>
                <select value={form.discount_type} onChange={(event) => onFormChange({ ...form, discount_type: event.target.value === 'fixed' ? 'fixed' : 'percent' })} className={`h-9 w-full rounded-md border px-2 text-sm ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed PHP</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Discount Value</Label>
                <Input type="number" min={0} step={form.discount_type === 'percent' ? '0.01' : '1'} value={form.discount_value} onChange={(event) => onFormChange({ ...form, discount_value: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Start</Label>
                <Input type="datetime-local" value={form.starts_at} onChange={(event) => onFormChange({ ...form, starts_at: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
              <div className="space-y-1">
                <Label>End</Label>
                <Input type="datetime-local" value={form.ends_at} onChange={(event) => onFormChange({ ...form, ends_at: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Timezone</Label>
                <Input value={form.timezone} onChange={(event) => onFormChange({ ...form, timezone: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <Input type="number" min={0} step="1" value={form.priority} onChange={(event) => onFormChange({ ...form, priority: event.target.value })} className={isDark ? 'bg-gray-800 border-gray-700' : ''} />
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="text-sm font-semibold">Target Banks</div>
                  <div className={`text-xs ${mutedToneClass}`}>Pick the banks that should receive this promotion.</div>
                </div>
                <div className={`text-xs font-semibold ${selectedBankCount > 0 ? (isDark ? 'text-teal-300' : 'text-teal-700') : mutedToneClass}`}>
                  {selectedBankCount} selected
                </div>
              </div>
              <div className={`max-h-44 overflow-auto rounded-md border p-2 space-y-1 ${isDark ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-white'}`}>
                {bankOptions.length === 0 ? (
                  <div className="text-xs opacity-70">No catalog banks available yet.</div>
                ) : bankOptions.map((bank) => (
                  <label key={bank.id} className="flex items-center gap-2 text-xs cursor-pointer rounded px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={form.target_bank_ids.includes(bank.id)}
                      onChange={(event) => onFormChange({
                        ...form,
                        target_bank_ids: event.target.checked
                          ? [...form.target_bank_ids, bank.id]
                          : form.target_bank_ids.filter((id) => id !== bank.id),
                      })}
                    />
                    <span>{bank.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={(event) => onFormChange({ ...form, is_active: event.target.checked })} />
              <span>Promotion enabled</span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onEditorOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={onReset} disabled={loading}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset Form
            </Button>
            <Button type="button" onClick={() => void onSave()} disabled={loading} className={isDark ? 'bg-teal-500 hover:bg-teal-400 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}>
              {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              {editingPromotionId ? 'Save Promotion' : 'Create Promotion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) onDeleteTargetChange(null);
        }}
        title="Delete Promotion"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? This removes the promotion from the storefront immediately.` : 'Delete this promotion?'}
        confirmText="Delete Promotion"
        variant="destructive"
        onConfirm={() => {
          if (!deleteTarget) return;
          onDelete(deleteTarget.id);
          onDeleteTargetChange(null);
        }}
        theme={theme}
      />
    </>
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
      <div className={`border rounded p-3 space-y-3 ${panelClass}`}>
        <div className={`rounded-2xl border p-4 ${isDark ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-wrap items-start gap-3">
            <div className="space-y-1">
              <div className="text-base font-semibold">Marketing Banners</div>
              <p className={`text-sm max-w-2xl ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Manage the rotating banner shown above the Bank Store list. Draft edits stay visible here so you can review before saving.
              </p>
            </div>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-xs rounded-md border px-2.5 py-1.5 self-start">
              <input type="checkbox" checked={showInactive} onChange={(event) => onShowInactiveChange(event.target.checked)} />
              Show inactive
            </label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Total</div>
              <div className="mt-1 text-xl font-semibold">{bannerStats.total}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-emerald-700/60 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>Active</div>
              <div className="mt-1 text-xl font-semibold">{bannerStats.active}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-amber-700/60 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Inactive</div>
              <div className="mt-1 text-xl font-semibold">{bannerStats.inactive}</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'border-blue-700/60 bg-blue-500/10' : 'border-blue-200 bg-blue-50'}`}>
              <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>Unsaved</div>
              <div className="mt-1 text-xl font-semibold">{bannerStats.dirty}</div>
            </div>
          </div>
        </div>

        {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
          <div className="pr-1">
            <div className="space-y-4">
            <div className={`rounded-xl border p-4 space-y-3 max-w-3xl ${isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <div>
                  <div className="text-sm font-semibold">Create New Banner</div>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Start with an image, optionally add a link, then choose its position in the slider.</div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
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
                <div className="grid grid-cols-1 gap-3">
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

            <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
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

                        <div className="grid grid-cols-1 2xl:grid-cols-[220px_minmax(0,1fr)] gap-4">
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
  const runningAutomationCount = Number(Boolean(storeConfig.account_auto_approve_enabled)) + Number(Boolean(storeConfig.store_auto_approve_enabled));
  const hasMessengerConfig = Boolean(String(storeConfig.messenger_url || '').trim());
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
    <div className={`border rounded p-3 overflow-visible lg:h-full lg:min-h-0 lg:overflow-auto ${panelClass}`}>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div> : (
        <div className="space-y-5">
          <div className={`rounded-2xl border p-4 space-y-4 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white/90'}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="text-base font-semibold">Payment and Store Controls</div>
                <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  Configure checkout instructions, payment channels, QR support, automation, and email outcomes from one place.
                </div>
              </div>
              <Button onClick={onSave} disabled={loading} className="w-full sm:w-auto sm:min-w-[220px]">Save Pay Config</Button>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className={`rounded-xl border p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Account Price</div>
                <div className="mt-1 text-xl font-semibold">{storeConfig.account_price_php || '0'}</div>
              </div>
              <div className={`rounded-xl border p-3 ${theme === 'dark' ? 'border-blue-700/60 bg-blue-500/10' : 'border-blue-200 bg-blue-50'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>Banner Delay</div>
                <div className="mt-1 text-xl font-semibold">{storeConfig.banner_rotation_ms || '5000'} ms</div>
              </div>
              <div className={`rounded-xl border p-3 ${theme === 'dark' ? 'border-emerald-700/60 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${theme === 'dark' ? 'text-emerald-300' : 'text-emerald-700'}`}>Automation</div>
                <div className="mt-1 text-xl font-semibold">{runningAutomationCount}/2</div>
              </div>
              <div className={`rounded-xl border p-3 ${theme === 'dark' ? 'border-amber-700/60 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>Checkout Support</div>
                <div className="mt-1 text-xs font-medium">{hasQrImage ? 'QR ready' : 'No QR uploaded'}{hasMessengerConfig ? ' • Messenger ready' : ''}</div>
              </div>
            </div>
          </div>

          <div className={`rounded-2xl border p-4 space-y-4 ${theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white/90'}`}>
            <div className="flex flex-col gap-1">
              <div className="text-base font-semibold">Payment Setup</div>
              <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Core payment channels, pricing, QR, and store banner timing.
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)] gap-4">
              <div className="space-y-4">
                <div className="space-y-1"><Label>Store Instructions</Label>
                  <textarea value={storeConfig.instructions} onChange={(event) => onStoreConfigChange({ ...storeConfig, instructions: event.target.value })} className={`w-full min-h-[100px] rounded-md border p-2 text-sm outline-none resize-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-300'}`} placeholder="Instructions shown to users when buying banks..." />
                </div>
                <div className="space-y-1">
                  <Label>FB Messenger URL</Label>
                  <div className="flex items-center gap-2">
                    <Input value={storeConfig.messenger_url} onChange={(event) => onStoreConfigChange({ ...storeConfig, messenger_url: event.target.value })} placeholder="https://m.me/yourpage" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} />
                    <InlineCopyButton value={storeConfig.messenger_url} label="Messenger URL" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>GCash Number</Label><Input value={storeConfig.gcash_number} onChange={(event) => onStoreConfigChange({ ...storeConfig, gcash_number: event.target.value })} placeholder="09171234567" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
                  <div className="space-y-1"><Label>Maya Number</Label><Input value={storeConfig.maya_number} onChange={(event) => onStoreConfigChange({ ...storeConfig, maya_number: event.target.value })} placeholder="09181234567" className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
                </div>
              </div>
              <div className="space-y-4">
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
                <div className="space-y-1">
                  <Label>QR Payment Image</Label>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    {hasQrImage ? (
                      <div className="flex flex-col gap-0.5 items-center">
                        <img src={storeQrPreviewUrl || storeConfig.qr_image_path} alt="QR" className="w-20 h-20 rounded-md object-cover border bg-white" />
                        <span className="text-[10px] opacity-50">{storeQrPreviewUrl ? 'New' : 'Current'}</span>
                      </div>
                    ) : <div className="w-20 h-20 rounded-md border-2 border-dashed flex items-center justify-center text-gray-400 text-xs">No QR</div>}
                    <div className="flex-1"><Input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif" onChange={onQrFileChange} disabled={loading} className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''} /></div>
                    {hasQrImage && <Button size="sm" variant="outline" onClick={onRemoveQr} className="shrink-0 text-red-500">Remove</Button>}
                  </div>
                </div>
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

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={loading} className="w-full sm:w-auto sm:min-w-[220px]">Save Pay Config</Button>
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
