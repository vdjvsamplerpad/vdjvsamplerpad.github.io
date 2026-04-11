import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { adminApi, type AccessEntry, type ActiveSessionRow, type AdminAccountRegistrationRequest, type AdminActivityRow, type AdminBank, type AdminClientCrashReport, type AdminDashboardOverview, type AdminUser, type BankAccessEntry, type DefaultBankRelease, type LandingDownloadConfig, type SortDirection } from '@/lib/admin-api';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { DEFAULT_LANDING_DOWNLOAD_CONFIG, normalizeLandingDownloadConfig } from '@/components/landing/download-config';
import { DEFAULT_SAMPLER_APP_CONFIG, normalizeSamplerAppConfig, type SamplerAppConfig } from './samplerAppConfig';
import { Edit, Eye, EyeOff, Plus, RefreshCw, Shield, Trash2, UserPlus, Users, Loader2, Store, CreditCard, History, Save, Check, X, Search, Menu } from 'lucide-react';
import { useAuthState } from '@/hooks/useAuth';
import {
  ACTIVE_SORT_STORAGE_KEY,
  HOME_WINDOW_OPTIONS,
  MS_PER_DAY,
  PAGE_SIZE,
  TABS,
  TAB_CONTENT_TONE_CLASSES,
  TAB_TONE_CLASSES,
  colorOptions,
  isUserBanned,
  isValidHttpUrl,
  parseIsoDateOnly,
  toIsoDateOnly,
  type ActiveSortBy,
  type ActivitySortBy,
  type AdminAccessDialogProps,
  type AssignmentBankSortBy,
  type AssignmentUserSortBy,
  type BankSortBy,
  type CatalogDraft,
  type PurchaseRequest,
  type RequestAutomationFilter,
  type RequestChannelFilter,
  type RequestDecisionFilter,
  type RequestOcrStatusFilter,
  type RequestStatusFilter,
  type StoreCatalogSort,
  type StoreConfigDraft,
  type StoreMarketingBanner,
  type TabKey,
  type UserSortBy,
  validateStoreBannerFile,
  validateStoreQrFile,
} from './AdminAccessDialog.shared';
import {
  ExportHealthPieChart,
  MiniGroupedBarChart,
  NoticesPortal,
  Pagination,
  RevenueAdvancedChart,
  SortHeader,
  useNotices,
} from './AdminAccessDialog.widgets';
import {
  AccountRequestsTab,
  CrashReportsTab,
  DefaultBankTab,
  InstallerRequestsTab,
  LandingDownloadTab,
  SamplerDefaultsTab,
  StoreBannersTab,
  StoreCatalogTab,
  StorePromotionsTab,
  StoreConfigTab,
  StoreRequestsTab,
} from './AdminAccessDialog.tabs';
import { AdminAccessInstallerTab } from './AdminAccessInstallerTab';
import { AdminAccessNonStoreTabs } from './AdminAccessDialog.nonStoreTabs';
import { AdminAccessDialogModals } from './AdminAccessDialog.dialogs';
import { useAdminAccessStoreManager } from './AdminAccessDialog.store';

const ADMIN_HOME_AUTO_REFRESH_MS = 5 * 60 * 1000;
const ADMIN_HOME_FETCH_COOLDOWN_MS = 60 * 1000;
const ADMIN_NAV_ORDER: TabKey[] = [
  'home',
  'account_requests',
  'store_requests',
  'installer_requests',
  'assignments',
  'banks',
  'store_catalog',
  'users',
  'active',
  'activity',
  'sampler_defaults',
  'default_bank',
  'store_banners',
  'store_promotions',
  'landing_download',
  'store_config',
  'installer',
  'crash_reports',
];





export function AdminAccessDialog({
  open,
  onOpenChange,
  theme,
  defaultBankSourceOptions = [],
  onPublishDefaultBankRelease,
}: AdminAccessDialogProps) {
  const { profile } = useAuthState();
  const isAdmin = profile?.role === 'admin';
  const readStoredActiveSort = React.useCallback((): { sortBy: ActiveSortBy; sortDir: SortDirection } => {
    if (typeof window === 'undefined') return { sortBy: 'last_seen_at', sortDir: 'desc' };
    try {
      const raw = localStorage.getItem(ACTIVE_SORT_STORAGE_KEY);
      if (!raw) return { sortBy: 'last_seen_at', sortDir: 'desc' };
      const parsed = JSON.parse(raw) as { sortBy?: string; sortDir?: string };
      const validSortBy: ActiveSortBy[] = ['user_id', 'email', 'device_name', 'platform', 'last_seen_at'];
      const sortBy = validSortBy.includes(parsed.sortBy as ActiveSortBy) ? (parsed.sortBy as ActiveSortBy) : 'last_seen_at';
      const sortDir: SortDirection = parsed.sortDir === 'asc' ? 'asc' : 'desc';
      return { sortBy, sortDir };
    } catch {
      return { sortBy: 'last_seen_at', sortDir: 'desc' };
    }
  }, []);

  const initialActiveSort = React.useMemo(() => readStoredActiveSort(), [readStoredActiveSort]);
  const [tab, setTab] = React.useState<TabKey>('home');
  const [isNavOpen, setIsNavOpen] = React.useState(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const { notices, pushNotice, dismiss } = useNotices();
  const {
    bannerLoading,
    bannerUploadingIds,
    catalogBankOptions,
    catalogTotalPages,
    createStoreCatalogBundle,
    executeStorePublish,
    expandedStoreRequestId,
    filteredDrafts,
    dirtyStoreBannerIds,
    handleCreateStoreBanner,
    handleDeleteStoreBanner,
    handleNewBannerImageChange,
    nudgeBannerSortOrder,
    handleSaveStoreBanner,
    handleStoreBannerImageReplace,
    handleStoreCatalogUpdate,
    handleStoreCatalogDraftAction,
    handleStoreConfigSave,
    handleStoreMaintenanceMode,
    handleStoreAutoApprovalAction,
    persistStorePromotion,
    deleteStorePromotion,
    editStorePromotion,
    handleStoreQrFileChange,
    handleStoreRequestAction,
    handleStoreRequestRetryEmail,
    hasStoreCatalogFilters,
    loadStoreCatalog,
    loadStoreRequests,
    loadStorePromotions,
    newBannerImageFile,
    newBannerImageUrl,
    newBannerLinkUrl,
    newBannerPreviewUrl,
    newBannerSortOrder,
    pagedDrafts,
    pagedRequests,
    promotionUserOptions,
    reqTotalPages,
    resetStoreCatalogFilters,
    resetBannerDraft,
    resetStorePromotionForm,
    setExpandedStoreRequestId,
    setNewBannerImageFile,
    setNewBannerImageUrl,
    setNewBannerLinkUrl,
    setNewBannerSortOrder,
    setShowInactiveBanners,
    setStoreCatalogBankFilter,
    setStoreCatalogPage,
    setStoreCatalogPaidFilter,
    setStoreCatalogPinnedFilter,
    setStoreCatalogSearch,
    setStoreCatalogSort,
    setStoreCatalogStatusFilter,
    setStoreConfig,
    setStorePromotionForm,
    setStorePublishDialog,
    setStoreReqPage,
    setStoreReqSearch,
    setStoreRequestAutomationFilter,
    setStoreRequestChannelFilter,
    setStoreRequestDecisionFilter,
    setStoreRequestFilter,
    setStoreRequestOcrStatusFilter,
    setStoreRequestStatusFilter,
    setStoreRequestToReject,
    setStoreQrFile,
    showInactiveBanners,
    storeBanners,
    storeBannerStats,
    storeCatalogBankFilter,
    storeCatalogPage,
    storeCatalogPaidFilter,
    storeCatalogPinnedFilter,
    storeCatalogSearch,
    storeCatalogSort,
    storeCatalogStats,
    storeCatalogStatusFilter,
    storeConfig,
    storeDrafts,
    storeLoading,
    storePromotionForm,
    storePromotionStats,
    storePromotions,
    editingPromotionId,
    storePublishDialog,
    storeQrPreviewUrl,
    storeReqPage,
    storeReqPendingCount,
    storeReqHistoryCount,
    storeReqSearch,
    storeRequestAutomationFilter,
    storeRequestChannelFilter,
    storeRequestDecisionFilter,
    storeRequestFilter,
    storeRequestOcrStatusFilter,
    storeRequestStatusFilter,
    storeRequestToReject,
    storeRequests,
    updateBannerDraft,
    visibleStoreBanners,
  } = useAdminAccessStoreManager({ open, isAdmin, tab, pushNotice });

  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [usersTotal, setUsersTotal] = React.useState(0);
  const [usersPage, setUsersPage] = React.useState(1);
  const [usersQuery, setUsersQuery] = React.useState('');
  const [usersSortBy, setUsersSortBy] = React.useState<UserSortBy>('created_at');
  const [usersSortDir, setUsersSortDir] = React.useState<SortDirection>('desc');
  const [assignmentUsersSource, setAssignmentUsersSource] = React.useState<AdminUser[]>([]);
  const [assignmentUsersLoading, setAssignmentUsersLoading] = React.useState(false);
  const [assignmentUsersPage, setAssignmentUsersPage] = React.useState(1);
  const [assignmentUserSortBy, setAssignmentUserSortBy] = React.useState<AssignmentUserSortBy>('created_at');
  const [assignmentUserSortDir, setAssignmentUserSortDir] = React.useState<SortDirection>('desc');

  const [banks, setBanks] = React.useState<AdminBank[]>([]);
  const [banksLoading, setBanksLoading] = React.useState(false);
  const [banksTotal, setBanksTotal] = React.useState(0);
  const [banksPage, setBanksPage] = React.useState(1);
  const [banksQuery, setBanksQuery] = React.useState('');
  const [banksSortBy, setBanksSortBy] = React.useState<BankSortBy>('created_at');
  const [banksSortDir, setBanksSortDir] = React.useState<SortDirection>('desc');
  const [assignmentBanksSource, setAssignmentBanksSource] = React.useState<AdminBank[]>([]);
  const [assignmentBanksLoading, setAssignmentBanksLoading] = React.useState(false);
  const [assignmentBanksPage, setAssignmentBanksPage] = React.useState(1);
  const [assignmentBankSortBy, setAssignmentBankSortBy] = React.useState<AssignmentBankSortBy>('title');
  const [assignmentBankSortDir, setAssignmentBankSortDir] = React.useState<SortDirection>('asc');

  const [selectedUserId, setSelectedUserId] = React.useState('');
  const [selectedBankIds, setSelectedBankIds] = React.useState<Set<string>>(new Set());
  const [accessRows, setAccessRows] = React.useState<AccessEntry[]>([]);
  const [accessLoading, setAccessLoading] = React.useState(false);
  const [bulkLoading, setBulkLoading] = React.useState(false);

  const [activeLoading, setActiveLoading] = React.useState(false);
  const [activeCounts, setActiveCounts] = React.useState({ activeUsers: 0, activeSessions: 0, activeTodayUsers: 0 });
  const [activeSessions, setActiveSessions] = React.useState<ActiveSessionRow[]>([]);
  const [activeTodaySessions, setActiveTodaySessions] = React.useState<ActiveSessionRow[]>([]);
  const [activeTotal, setActiveTotal] = React.useState(0);
  const [activePage, setActivePage] = React.useState(1);
  const [activeTodayTotal, setActiveTodayTotal] = React.useState(0);
  const [activeTodayPage, setActiveTodayPage] = React.useState(1);
  const [activeSortBy, setActiveSortBy] = React.useState<ActiveSortBy>(initialActiveSort.sortBy);
  const [activeSortDir, setActiveSortDir] = React.useState<SortDirection>(initialActiveSort.sortDir);
  const [activityLoading, setActivityLoading] = React.useState(false);
  const [activityRows, setActivityRows] = React.useState<AdminActivityRow[]>([]);
  const [activityPage, setActivityPage] = React.useState(1);
  const [activityTotal, setActivityTotal] = React.useState(0);
  const [activitySearch, setActivitySearch] = React.useState('');
  const [activitySortBy, setActivitySortBy] = React.useState<ActivitySortBy>('created_at');
  const [activitySortDir, setActivitySortDir] = React.useState<SortDirection>('desc');
  const [activityStatusFilter, setActivityStatusFilter] = React.useState<'all' | 'success' | 'failed'>('all');
  const [activityCategoryFilter, setActivityCategoryFilter] = React.useState<'all' | 'bank_export' | 'backup_recovery'>('all');
  const [activityPhaseFilter, setActivityPhaseFilter] = React.useState<
    'all' | 'requested' | 'local_export' | 'remote_upload' | 'backup_export' | 'backup_restore' | 'media_recovery'
  >('all');
  const [activityUploadResultFilter, setActivityUploadResultFilter] = React.useState<'all' | 'duplicate_no_change'>('all');
  const [expandedActivityId, setExpandedActivityId] = React.useState<number | null>(null);
  const [otherActivityLoading, setOtherActivityLoading] = React.useState(false);
  const [otherActivityRows, setOtherActivityRows] = React.useState<AdminActivityRow[]>([]);
  const [otherActivityPage, setOtherActivityPage] = React.useState(1);
  const [otherActivityTotal, setOtherActivityTotal] = React.useState(0);
  const [otherActivitySearch, setOtherActivitySearch] = React.useState('');
  const [otherActivitySortBy, setOtherActivitySortBy] = React.useState<ActivitySortBy>('created_at');
  const [otherActivitySortDir, setOtherActivitySortDir] = React.useState<SortDirection>('desc');
  const [otherActivityStatusFilter, setOtherActivityStatusFilter] = React.useState<'all' | 'success' | 'failed'>('all');
  const [homeLoading, setHomeLoading] = React.useState(false);
  const [homeData, setHomeData] = React.useState<AdminDashboardOverview | null>(null);
  const [homeError, setHomeError] = React.useState('');
  const [homeWindowDays, setHomeWindowDays] = React.useState<number>(7);
  const [homeFromDate, setHomeFromDate] = React.useState<string>(() => {
    const today = new Date();
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6));
    return toIsoDateOnly(from);
  });
  const [homeToDate, setHomeToDate] = React.useState<string>(() => toIsoDateOnly(new Date()));
  const [homeLastRefresh, setHomeLastRefresh] = React.useState<string | null>(null);
  const homeFromDateRef = React.useRef(homeFromDate);
  const homeToDateRef = React.useRef(homeToDate);
  const homeRefreshMetaRef = React.useRef<{ key: string; at: number }>({ key: '', at: 0 });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createEmail, setCreateEmail] = React.useState('');
  const [createPassword, setCreatePassword] = React.useState('');
  const [showCreatePassword, setShowCreatePassword] = React.useState(false);
  const [createDisplayName, setCreateDisplayName] = React.useState('');
  const [createLoading, setCreateLoading] = React.useState(false);

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [detailsUser, setDetailsUser] = React.useState<AdminUser | null>(null);
  const [editDisplayName, setEditDisplayName] = React.useState('');
  const [editOwnedBankQuota, setEditOwnedBankQuota] = React.useState('6');
  const [editOwnedBankPadCap, setEditOwnedBankPadCap] = React.useState('64');
  const [editDeviceTotalBankCap, setEditDeviceTotalBankCap] = React.useState('120');
  const [detailsBankListsLoading, setDetailsBankListsLoading] = React.useState(false);
  const [detailsOwnedBanks, setDetailsOwnedBanks] = React.useState<AdminBank[]>([]);
  const [detailsGrantedBanks, setDetailsGrantedBanks] = React.useState<AccessEntry[]>([]);
  const detailsBankListsRequestRef = React.useRef(0);
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [banOpen, setBanOpen] = React.useState(false);
  const [banHours, setBanHours] = React.useState(24);
  const [deleteUserOpen, setDeleteUserOpen] = React.useState(false);
  const [unbanOpen, setUnbanOpen] = React.useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false);

  const [editBankOpen, setEditBankOpen] = React.useState(false);
  const [editBank, setEditBank] = React.useState<AdminBank | null>(null);
  const [editBankTitle, setEditBankTitle] = React.useState('');
  const [editBankDesc, setEditBankDesc] = React.useState('');
  const [editBankColor, setEditBankColor] = React.useState('#3b82f6');
  const [bankSaving, setBankSaving] = React.useState(false);
  const [deleteBankOpen, setDeleteBankOpen] = React.useState(false);
  const [deleteBank, setDeleteBank] = React.useState<AdminBank | null>(null);
  const [bankAccessOpen, setBankAccessOpen] = React.useState(false);
  const [bankAccessBank, setBankAccessBank] = React.useState<AdminBank | null>(null);
  const [bankAccessLoading, setBankAccessLoading] = React.useState(false);
  const [bankAccessRows, setBankAccessRows] = React.useState<BankAccessEntry[]>([]);
  const [bankAccessPage, setBankAccessPage] = React.useState(1);
  const [bankAccessTotal, setBankAccessTotal] = React.useState(0);
  const [bankAccessSearch, setBankAccessSearch] = React.useState('');
  const [defaultBankLoading, setDefaultBankLoading] = React.useState(false);
  const [defaultBankPublishLoading, setDefaultBankPublishLoading] = React.useState(false);
  const [defaultBankRollbackLoading, setDefaultBankRollbackLoading] = React.useState(false);
  const [defaultBankCurrentRelease, setDefaultBankCurrentRelease] = React.useState<DefaultBankRelease | null>(null);
  const [defaultBankReleases, setDefaultBankReleases] = React.useState<DefaultBankRelease[]>([]);
  const [defaultBankNextVersion, setDefaultBankNextVersion] = React.useState(1);
  const [defaultBankSourceId, setDefaultBankSourceId] = React.useState('');
  const [defaultBankReleaseNotes, setDefaultBankReleaseNotes] = React.useState('');
  const [defaultBankMinAppVersion, setDefaultBankMinAppVersion] = React.useState('');
  const [landingDownloadLoading, setLandingDownloadLoading] = React.useState(false);
  const [landingDownloadSaving, setLandingDownloadSaving] = React.useState(false);
  const [landingDownloadConfig, setLandingDownloadConfig] = React.useState<LandingDownloadConfig>(() =>
    normalizeLandingDownloadConfig(DEFAULT_LANDING_DOWNLOAD_CONFIG)
  );
  const [samplerDefaultsLoading, setSamplerDefaultsLoading] = React.useState(false);
  const [samplerDefaultsSaving, setSamplerDefaultsSaving] = React.useState(false);
  const [samplerDefaultsConfig, setSamplerDefaultsConfig] = React.useState<SamplerAppConfig>(() =>
    normalizeSamplerAppConfig(DEFAULT_SAMPLER_APP_CONFIG)
  );
  const [storePromotionsPage, setStorePromotionsPage] = React.useState(1);

  const [accountReqFilter, setAccountReqFilter] = React.useState<'pending' | 'history'>('pending');
  const [accountReqLoading, setAccountReqLoading] = React.useState(false);
  const [accountReqRows, setAccountReqRows] = React.useState<AdminAccountRegistrationRequest[]>([]);
  const [accountReqPage, setAccountReqPage] = React.useState(1);
  const [accountReqTotal, setAccountReqTotal] = React.useState(0);
  const [accountReqPendingCount, setAccountReqPendingCount] = React.useState(0);
  const [accountReqHistoryCount, setAccountReqHistoryCount] = React.useState(0);
  const [accountReqSearch, setAccountReqSearch] = React.useState('');
  const [accountReqStatusFilter, setAccountReqStatusFilter] = React.useState<RequestStatusFilter>('all');
  const [accountReqChannelFilter, setAccountReqChannelFilter] = React.useState<RequestChannelFilter>('all');
  const [accountReqDecisionFilter, setAccountReqDecisionFilter] = React.useState<RequestDecisionFilter>('all');
  const [accountReqAutomationFilter, setAccountReqAutomationFilter] = React.useState<RequestAutomationFilter>('all');
  const [accountReqOcrStatusFilter, setAccountReqOcrStatusFilter] = React.useState<RequestOcrStatusFilter>('all');
  const [accountReqToReject, setAccountReqToReject] = React.useState<{ id: string; message: string } | null>(null);
  const [accountReqToAssist, setAccountReqToAssist] = React.useState<{ id: string } | null>(null);
  const [crashReportsLoading, setCrashReportsLoading] = React.useState(false);
  const [crashReportsRows, setCrashReportsRows] = React.useState<AdminClientCrashReport[]>([]);
  const [crashReportsPage, setCrashReportsPage] = React.useState(1);
  const [crashReportsTotal, setCrashReportsTotal] = React.useState(0);
  const [crashReportsNewCount, setCrashReportsNewCount] = React.useState(0);
  const [crashReportsSearch, setCrashReportsSearch] = React.useState('');
  const [crashReportsStatusFilter, setCrashReportsStatusFilter] = React.useState<'all' | 'new' | 'acknowledged' | 'fixed' | 'ignored'>('all');
  const [crashReportsDomainFilter, setCrashReportsDomainFilter] = React.useState<'all' | 'bank_store' | 'playback' | 'global_runtime'>('all');
  const [crashReportsPlatformFilter, setCrashReportsPlatformFilter] = React.useState('all');
  const [crashReportsAppVersionFilter, setCrashReportsAppVersionFilter] = React.useState('all');

  const selectedUser = React.useMemo(
    () => assignmentUsersSource.find((u) => u.id === selectedUserId) || users.find((u) => u.id === selectedUserId) || null,
    [assignmentUsersSource, users, selectedUserId],
  );
  const grantedBankIds = React.useMemo(() => new Set(accessRows.map((r) => r.bank_id)), [accessRows]);
  const defaultBankSourceChoices = React.useMemo(() => {
    return defaultBankSourceOptions
      .filter((option) => option.padCount > 0)
      .sort((left, right) => {
        if (left.isDefaultBank !== right.isDefaultBank) return left.isDefaultBank ? -1 : 1;
        return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
      });
  }, [defaultBankSourceOptions]);

  const assignmentUsers = React.useMemo(() => {
    const sorted = [...assignmentUsersSource].sort((a, b) => {
      if (assignmentUserSortBy === 'display_name') return String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' });
      if (assignmentUserSortBy === 'email') return String(a.email || '').localeCompare(String(b.email || ''), undefined, { sensitivity: 'base' });
      const left = a.created_at ? new Date(a.created_at).getTime() : 0;
      const right = b.created_at ? new Date(b.created_at).getTime() : 0;
      return left - right;
    });
    const ordered = assignmentUserSortDir === 'asc' ? sorted : sorted.reverse();
    return ordered.slice((assignmentUsersPage - 1) * PAGE_SIZE, assignmentUsersPage * PAGE_SIZE);
  }, [assignmentUsersSource, assignmentUserSortBy, assignmentUserSortDir, assignmentUsersPage]);

  const assignmentBanks = React.useMemo(() => {
    const sorted = [...assignmentBanksSource].sort((a, b) => {
      if (assignmentBankSortBy === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      }
      if (assignmentBankSortBy === 'status') {
        const left = grantedBankIds.has(a.id) ? 1 : 0;
        const right = grantedBankIds.has(b.id) ? 1 : 0;
        return left - right;
      }
      return (a.access_count || 0) - (b.access_count || 0);
    });
    const ordered = assignmentBankSortDir === 'asc' ? sorted : sorted.reverse();
    return ordered.slice((assignmentBanksPage - 1) * PAGE_SIZE, assignmentBanksPage * PAGE_SIZE);
  }, [assignmentBanksSource, assignmentBankSortBy, assignmentBankSortDir, grantedBankIds, assignmentBanksPage]);

  const activeUsersRows = React.useMemo(() => {
    const map = new Map<string, ActiveSessionRow>();
    activeSessions.forEach((row) => {
      const prev = map.get(row.user_id);
      if (!prev || new Date(row.last_seen_at).getTime() > new Date(prev.last_seen_at).getTime()) {
        map.set(row.user_id, row);
      }
    });
    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      if (activeSortBy === 'user_id') return String(a.user_id || '').localeCompare(String(b.user_id || ''), undefined, { sensitivity: 'base' });
      if (activeSortBy === 'email') return String(a.email || '').localeCompare(String(b.email || ''), undefined, { sensitivity: 'base' });
      if (activeSortBy === 'device_name') return String(a.device_name || '').localeCompare(String(b.device_name || ''), undefined, { sensitivity: 'base' });
      if (activeSortBy === 'platform') {
        const left = [a.platform, a.browser, a.os].filter(Boolean).join(' / ');
        const right = [b.platform, b.browser, b.os].filter(Boolean).join(' / ');
        return left.localeCompare(right, undefined, { sensitivity: 'base' });
      }
      const left = new Date(a.last_seen_at).getTime();
      const right = new Date(b.last_seen_at).getTime();
      return left - right;
    });
    return activeSortDir === 'asc' ? rows : rows.reverse();
  }, [activeSessions, activeSortBy, activeSortDir]);
  const pagedUsers = React.useMemo(
    () => users.slice((usersPage - 1) * PAGE_SIZE, usersPage * PAGE_SIZE),
    [users, usersPage],
  );
  const pagedBanks = React.useMemo(
    () => banks.slice((banksPage - 1) * PAGE_SIZE, banksPage * PAGE_SIZE),
    [banks, banksPage],
  );
  const pagedStorePromotions = React.useMemo(
    () => storePromotions.slice((storePromotionsPage - 1) * PAGE_SIZE, storePromotionsPage * PAGE_SIZE),
    [storePromotions, storePromotionsPage],
  );

  React.useEffect(() => {
    if (!error) return;
    pushNotice({ variant: 'error', message: error });
    setError('');
  }, [error, pushNotice]);

  React.useEffect(() => {
    if (!info) return;
    pushNotice({ variant: 'success', message: info });
    setInfo('');
  }, [info, pushNotice]);

  React.useEffect(() => {
    if (!defaultBankSourceChoices.length) {
      setDefaultBankSourceId('');
      return;
    }
    if (defaultBankSourceChoices.some((option) => option.id === defaultBankSourceId)) return;
    setDefaultBankSourceId(defaultBankSourceChoices[0].id);
  }, [defaultBankSourceChoices, defaultBankSourceId]);

  const refreshUsers = React.useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await adminApi.listUsers({
        q: usersQuery,
        page: 1,
        perPage: 2000,
        includeAdmins: false,
        sortBy: usersSortBy,
        sortDir: usersSortDir,
      });
      const nextUsers = Array.isArray(data.users) ? data.users : [];
      setUsers(nextUsers);
      setUsersTotal(Math.max(Number(data.total || 0), nextUsers.length));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load users.');
      setUsers([]);
      setUsersTotal(0);
    } finally {
      setUsersLoading(false);
    }
  }, [usersQuery, usersSortBy, usersSortDir]);

    const refreshAssignmentUsers = React.useCallback(async () => {
      setAssignmentUsersLoading(true);
      try {
        const data = await adminApi.listUsers({
          q: usersQuery,
          page: 1,
          perPage: 2000,
          includeAdmins: true,
          sortBy: 'created_at',
          sortDir: 'desc',
        });
        setAssignmentUsersSource(Array.isArray(data.users) ? data.users : []);
        setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load assignment users.');
      setAssignmentUsersSource([]);
    } finally {
      setAssignmentUsersLoading(false);
    }
  }, [usersQuery]);

  const refreshBanks = React.useCallback(async () => {
    setBanksLoading(true);
    try {
      const data = await adminApi.listBanks({
        q: banksQuery,
        page: 1,
        perPage: 2000,
        sortBy: banksSortBy,
        sortDir: banksSortDir,
      });
      const nextBanks = Array.isArray(data.banks) ? data.banks : [];
      setBanks(nextBanks);
      setBanksTotal(Math.max(Number(data.total || 0), nextBanks.length));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load banks.');
      setBanks([]);
      setBanksTotal(0);
    } finally {
      setBanksLoading(false);
    }
  }, [banksQuery, banksSortBy, banksSortDir]);

  const refreshAssignmentBanks = React.useCallback(async () => {
    setAssignmentBanksLoading(true);
    try {
      const data = await adminApi.listBanks({
        q: banksQuery,
        page: 1,
        perPage: 2000,
        sortBy: 'created_at',
        sortDir: 'desc',
      });
      setAssignmentBanksSource(Array.isArray(data.banks) ? data.banks : []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load assignment banks.');
      setAssignmentBanksSource([]);
    } finally {
      setAssignmentBanksLoading(false);
    }
  }, [banksQuery]);

  const refreshDefaultBank = React.useCallback(async () => {
    setDefaultBankLoading(true);
    try {
      const data = await adminApi.getDefaultBankReleaseState();
      setDefaultBankCurrentRelease(data.currentRelease || null);
      setDefaultBankReleases(Array.isArray(data.releases) ? data.releases : []);
      setDefaultBankNextVersion(Math.max(1, Number(data.nextVersion || 1)));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load default bank release data.');
      setDefaultBankCurrentRelease(null);
      setDefaultBankReleases([]);
      setDefaultBankNextVersion(1);
    } finally {
      setDefaultBankLoading(false);
    }
  }, []);

  const handlePublishDefaultBankRelease = React.useCallback(async () => {
    if (!defaultBankSourceId) {
      setError('Select a loaded source bank first.');
      return;
    }
    if (!onPublishDefaultBankRelease) {
      setError('Default bank publish is not available in this view.');
      return;
    }
    setDefaultBankPublishLoading(true);
    try {
      const message = await onPublishDefaultBankRelease(defaultBankSourceId, {
        releaseNotes: defaultBankReleaseNotes.trim() || undefined,
        minAppVersion: defaultBankMinAppVersion.trim() || undefined,
      });
      setInfo(message || 'Default bank release published.');
      setDefaultBankReleaseNotes('');
      await refreshDefaultBank();
    } catch (e: any) {
      setError(e?.message || 'Could not publish default bank release.');
    } finally {
      setDefaultBankPublishLoading(false);
    }
  }, [
    defaultBankMinAppVersion,
    defaultBankReleaseNotes,
    defaultBankSourceId,
    onPublishDefaultBankRelease,
    refreshDefaultBank,
  ]);

  const handleRollbackDefaultBankRelease = React.useCallback(async (version: number) => {
    setDefaultBankRollbackLoading(true);
    try {
      await adminApi.rollbackDefaultBankRelease(version);
      setInfo(`Default bank rolled back to v${version}.`);
      await refreshDefaultBank();
    } catch (e: any) {
      setError(e?.message || 'Could not roll back default bank release.');
    } finally {
      setDefaultBankRollbackLoading(false);
    }
  }, [refreshDefaultBank]);

  const refreshLandingDownloadConfig = React.useCallback(async () => {
    setLandingDownloadLoading(true);
    try {
      const data = await adminApi.getLandingDownloadConfig();
      setLandingDownloadConfig(normalizeLandingDownloadConfig(data.config));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load landing download config.');
      setLandingDownloadConfig(normalizeLandingDownloadConfig(DEFAULT_LANDING_DOWNLOAD_CONFIG));
    } finally {
      setLandingDownloadLoading(false);
    }
  }, []);

  const handleSaveLandingDownloadConfig = React.useCallback(async () => {
    setLandingDownloadSaving(true);
    try {
      const normalized = normalizeLandingDownloadConfig(landingDownloadConfig);
      const data = await adminApi.saveLandingDownloadConfig(normalized);
      setLandingDownloadConfig(normalizeLandingDownloadConfig(data.config));
      setInfo('Landing download config saved.');
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not save landing download config.');
    } finally {
      setLandingDownloadSaving(false);
    }
  }, [landingDownloadConfig]);

  const refreshSamplerDefaultsConfig = React.useCallback(async () => {
    setSamplerDefaultsLoading(true);
    try {
      const data = await adminApi.getSamplerAppConfig();
      setSamplerDefaultsConfig(normalizeSamplerAppConfig(data.config));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load sampler defaults.');
      setSamplerDefaultsConfig(normalizeSamplerAppConfig(DEFAULT_SAMPLER_APP_CONFIG));
    } finally {
      setSamplerDefaultsLoading(false);
    }
  }, []);

  const handleSaveSamplerDefaultsConfig = React.useCallback(async () => {
    setSamplerDefaultsSaving(true);
    try {
      const normalized = normalizeSamplerAppConfig(samplerDefaultsConfig);
      const data = await adminApi.saveSamplerAppConfig(normalized);
      setSamplerDefaultsConfig(normalizeSamplerAppConfig(data.config));
      setInfo('Sampler defaults saved.');
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not save sampler defaults.');
    } finally {
      setSamplerDefaultsSaving(false);
    }
  }, [samplerDefaultsConfig]);

  React.useEffect(() => {
    if (!open || !isAdmin) return;
    if (tab !== 'default_bank') return;
    void refreshDefaultBank();
  }, [isAdmin, open, refreshDefaultBank, tab]);

  React.useEffect(() => {
    if (!open || !isAdmin) return;
    if (tab !== 'landing_download') return;
    void refreshLandingDownloadConfig();
  }, [isAdmin, open, refreshLandingDownloadConfig, tab]);

  React.useEffect(() => {
    if (!open || !isAdmin) return;
    if (tab !== 'sampler_defaults') return;
    void refreshSamplerDefaultsConfig();
  }, [isAdmin, open, refreshSamplerDefaultsConfig, tab]);

  const refreshAccess = React.useCallback(async (userId: string) => {
    if (!userId) {
      setAccessRows([]);
      return;
    }
    setAccessLoading(true);
    try {
      const data = await adminApi.getUserAccess(userId);
      setAccessRows(data.access || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load access records.');
      setAccessRows([]);
    } finally {
      setAccessLoading(false);
    }
  }, []);

  const refreshActive = React.useCallback(async () => {
    setActiveLoading(true);
      try {
        const data = await adminApi.listActiveSessions({
          page: activePage,
          perPage: PAGE_SIZE,
          activeTodayPage,
          activeTodayPerPage: PAGE_SIZE,
          sortBy: activeSortBy,
          sortDir: activeSortDir,
        });
        setActiveCounts({
          activeUsers: Number(data?.counts?.activeUsers || 0),
          activeSessions: Number(data?.counts?.activeSessions || 0),
          activeTodayUsers: Number(data?.counts?.activeTodayUsers || 0),
        });
        const nextSessions = Array.isArray(data?.sessions) ? data.sessions : [];
        const nextActiveTodaySessions = Array.isArray(data?.activeTodaySessions) ? data.activeTodaySessions : [];
        setActiveSessions(nextSessions);
        setActiveTodaySessions(nextActiveTodaySessions);
        setActiveTotal(Math.max(Number(data?.total || 0), nextSessions.length));
        setActiveTodayTotal(Math.max(Number(data?.activeTodayTotal || 0), nextActiveTodaySessions.length));
        setError('');
      } catch (e: any) {
        setError(e?.message || 'Could not load active sessions.');
        setActiveCounts({ activeUsers: 0, activeSessions: 0, activeTodayUsers: 0 });
        setActiveSessions([]);
        setActiveTodaySessions([]);
        setActiveTotal(0);
        setActiveTodayTotal(0);
      } finally {
        setActiveLoading(false);
      }
    }, [activePage, activeSortBy, activeSortDir, activeTodayPage]);

  const refreshUserData = React.useCallback(
    async () => Promise.all([refreshUsers(), refreshAssignmentUsers()]),
    [refreshUsers, refreshAssignmentUsers],
  );

  const refreshBankData = React.useCallback(
    async () => Promise.all([refreshBanks(), refreshAssignmentBanks()]),
    [refreshBanks, refreshAssignmentBanks],
  );

  const refreshActivity = React.useCallback(async () => {
    setActivityLoading(true);
    try {
      const data = await adminApi.listActivity({
        scope: 'export',
        eventType: 'bank.export',
        status: activityStatusFilter === 'all' ? undefined : activityStatusFilter,
        category: activityCategoryFilter === 'all' ? undefined : activityCategoryFilter,
        phase: activityPhaseFilter === 'all' ? undefined : activityPhaseFilter,
        uploadResult: activityUploadResultFilter === 'all' ? undefined : activityUploadResultFilter,
        q: activitySearch.trim() || undefined,
        page: activityPage,
        perPage: PAGE_SIZE,
        sortBy: activitySortBy,
        sortDir: activitySortDir,
      });
      setActivityRows(Array.isArray(data.activity) ? data.activity : []);
      setActivityTotal(Number(data.total || 0));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load activity logs.');
      setActivityRows([]);
      setActivityTotal(0);
    } finally {
      setActivityLoading(false);
    }
  }, [activityCategoryFilter, activityPhaseFilter, activityPage, activitySearch, activitySortBy, activitySortDir, activityStatusFilter, activityUploadResultFilter]);

  const refreshOtherActivity = React.useCallback(async () => {
    setOtherActivityLoading(true);
    try {
      const data = await adminApi.listActivity({
        scope: 'non_export',
        status: otherActivityStatusFilter === 'all' ? undefined : otherActivityStatusFilter,
        q: otherActivitySearch.trim() || undefined,
        page: otherActivityPage,
        perPage: PAGE_SIZE,
        sortBy: otherActivitySortBy,
        sortDir: otherActivitySortDir,
      });
      setOtherActivityRows(Array.isArray(data.activity) ? data.activity : []);
      setOtherActivityTotal(Number(data.total || 0));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load other activity logs.');
      setOtherActivityRows([]);
      setOtherActivityTotal(0);
    } finally {
      setOtherActivityLoading(false);
    }
  }, [otherActivityPage, otherActivitySearch, otherActivitySortBy, otherActivitySortDir, otherActivityStatusFilter]);

  const refreshHomeDashboard = React.useCallback(async (
    range?: { fromDate?: string; toDate?: string },
    options?: { force?: boolean },
  ) => {
    const requestFromDate = (range?.fromDate || homeFromDateRef.current || '').trim();
    const requestToDate = (range?.toDate || homeToDateRef.current || '').trim();
    const refreshKey = `${requestFromDate}:${requestToDate}`;
    if (
      !options?.force
      && homeData
      && homeRefreshMetaRef.current.key === refreshKey
      && (Date.now() - homeRefreshMetaRef.current.at) < ADMIN_HOME_FETCH_COOLDOWN_MS
    ) {
      return;
    }
    const fromParsed = parseIsoDateOnly(requestFromDate);
    const toParsed = parseIsoDateOnly(requestToDate);
    if (!fromParsed || !toParsed) {
      const message = 'Invalid date range for dashboard.';
      setHomeError(message);
      setError(message);
      return;
    }
    if (fromParsed.getTime() > toParsed.getTime()) {
      const message = 'From date cannot be later than To date.';
      setHomeError(message);
      setError(message);
      return;
    }
    const derivedWindowDays = Math.max(1, Math.floor((toParsed.getTime() - fromParsed.getTime()) / MS_PER_DAY) + 1);
    setHomeLoading(true);
    try {
      const data = await adminApi.getDashboardOverview({
        windowDays: derivedWindowDays,
        fromDate: requestFromDate,
        toDate: requestToDate,
      });
      setHomeData(data);
      setHomeWindowDays(Number(data?.windowDays || derivedWindowDays));
      if (data?.meta?.rangeStartDate) {
        const nextFrom = String(data.meta.rangeStartDate);
        homeFromDateRef.current = nextFrom;
        setHomeFromDate(nextFrom);
      }
      if (data?.meta?.rangeEndDate) {
        const nextTo = String(data.meta.rangeEndDate);
        homeToDateRef.current = nextTo;
        setHomeToDate(nextTo);
      }
      homeRefreshMetaRef.current = {
        key: refreshKey,
        at: Date.now(),
      };
      setHomeLastRefresh(new Date().toISOString());
      setHomeError('');
      setError('');
    } catch (e: any) {
      const message = e?.message || 'Could not load home dashboard.';
      setHomeError(message);
      setError(message);
    } finally {
      setHomeLoading(false);
    }
  }, []);

  const applyHomePresetRange = React.useCallback((days: number) => {
    const today = new Date();
    const end = toIsoDateOnly(today);
    const from = toIsoDateOnly(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1))));
    setHomeWindowDays(days);
    setHomeFromDate(from);
    setHomeToDate(end);
  }, []);

  React.useEffect(() => {
    homeFromDateRef.current = homeFromDate;
  }, [homeFromDate]);

  React.useEffect(() => {
    homeToDateRef.current = homeToDate;
  }, [homeToDate]);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setInfo('');
    setSelectedBankIds(new Set());
    setShowCreatePassword(false);
  }, [open]);

  React.useEffect(() => {
    if (!open) setIsNavOpen(false);
  }, [open]);

  React.useEffect(() => {
    setIsNavOpen(false);
  }, [tab]);

  React.useEffect(() => {
    if (!open) return;
    if (tab !== 'users') return;
    const timer = window.setTimeout(() => {
      void refreshUsers();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, tab, refreshUsers]);

  React.useEffect(() => {
    if (!open) return;
    if (tab !== 'assignments') return;
    const timer = window.setTimeout(() => {
      void refreshAssignmentUsers();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, tab, refreshAssignmentUsers]);

  React.useEffect(() => {
    if (!open) return;
    if (tab !== 'banks') return;
    const timer = window.setTimeout(() => {
      void refreshBanks();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, tab, refreshBanks]);

  React.useEffect(() => {
    if (!open) return;
    if (tab !== 'assignments') return;
    const timer = window.setTimeout(() => {
      void refreshAssignmentBanks();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, tab, refreshAssignmentBanks]);

  React.useEffect(() => {
    if (!open || tab !== 'active') return;
    void refreshActive();
  }, [open, tab, refreshActive]);

  React.useEffect(() => {
    if (!open || tab !== 'home') return;
    const timer = window.setTimeout(() => {
      void refreshHomeDashboard();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, tab, refreshHomeDashboard]);

  React.useEffect(() => {
    if (!open || tab !== 'activity') return;
    const timer = window.setTimeout(() => {
      void refreshActivity();
      void refreshOtherActivity();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, tab, refreshActivity, refreshOtherActivity]);

  const loadAccountRegistrationRequests = React.useCallback(async () => {
    setAccountReqLoading(true);
      try {
        const data = await adminApi.listAccountRegistrationRequests({
          filter: accountReqFilter,
          q: accountReqSearch.trim() || undefined,
          page: accountReqPage,
          perPage: PAGE_SIZE,
          status: accountReqStatusFilter,
          paymentChannel: accountReqChannelFilter,
          decisionSource: accountReqDecisionFilter,
          automationResult: accountReqAutomationFilter,
          ocrStatus: accountReqOcrStatusFilter,
        });
      setAccountReqRows(Array.isArray(data?.requests) ? data.requests : []);
      setAccountReqTotal(Number(data?.total || 0));
      setAccountReqPendingCount(Number(data?.pendingCount || 0));
      setAccountReqHistoryCount(Number(data?.historyCount || 0));
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not load account registration requests. Please try again.' });
      setAccountReqRows([]);
      setAccountReqTotal(0);
      setAccountReqPendingCount(0);
      setAccountReqHistoryCount(0);
    } finally {
      setAccountReqLoading(false);
    }
    }, [
      pushNotice,
      accountReqAutomationFilter,
      accountReqChannelFilter,
      accountReqDecisionFilter,
      accountReqFilter,
      accountReqOcrStatusFilter,
      accountReqPage,
      accountReqSearch,
      accountReqStatusFilter,
    ]);

  React.useEffect(() => {
    if (!open || !isAdmin || tab !== 'account_requests') return;
    const timer = window.setTimeout(() => {
      void loadAccountRegistrationRequests();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, isAdmin, tab, loadAccountRegistrationRequests]);

  const loadClientCrashReports = React.useCallback(async () => {
    setCrashReportsLoading(true);
    try {
      const data = await adminApi.listClientCrashReports({
        q: crashReportsSearch.trim() || undefined,
        page: crashReportsPage,
        perPage: PAGE_SIZE,
        status: crashReportsStatusFilter,
        domain: crashReportsDomainFilter,
        platform: crashReportsPlatformFilter,
        appVersion: crashReportsAppVersionFilter,
      });
      setCrashReportsRows(Array.isArray(data?.reports) ? data.reports : []);
      setCrashReportsTotal(Number(data?.total || 0));
      setCrashReportsNewCount(Number(data?.newCount || 0));
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not load crash reports.' });
      setCrashReportsRows([]);
      setCrashReportsTotal(0);
      setCrashReportsNewCount(0);
    } finally {
      setCrashReportsLoading(false);
    }
  }, [
    crashReportsAppVersionFilter,
    crashReportsDomainFilter,
    crashReportsPage,
    crashReportsPlatformFilter,
    crashReportsSearch,
    crashReportsStatusFilter,
    pushNotice,
  ]);

  React.useEffect(() => {
    if (!open || !isAdmin || tab !== 'crash_reports') return;
    const timer = window.setTimeout(() => {
      void loadClientCrashReports();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadClientCrashReports, open, tab]);

  const handleClientCrashReportStatusUpdate = React.useCallback(async (
    id: string,
    status: AdminClientCrashReport['status'],
  ) => {
    try {
      await adminApi.updateClientCrashReportStatus(id, status);
      setCrashReportsRows((prev) => prev.map((row) => (
        row.id === id
          ? {
              ...row,
              status,
              updated_at: new Date().toISOString(),
            }
          : row
      )));
      if (status !== 'new') {
        setCrashReportsNewCount((prev) => Math.max(0, prev - (crashReportsRows.find((row) => row.id === id)?.status === 'new' ? 1 : 0)));
      }
      pushNotice({ variant: 'success', message: `Crash report marked ${status.replace(/_/g, ' ')}.` });
      void loadClientCrashReports();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not update crash report.' });
    }
  }, [crashReportsRows, loadClientCrashReports, pushNotice]);

  const handleAccountRequestAction = async (
    id: string,
    action: 'approve' | 'approve_assisted' | 'reject' | 'refund',
    rejectionMessage?: string,
    temporaryPassword?: string
  ) => {
    setAccountReqLoading(true);
    try {
      const result = await adminApi.accountRegistrationAction(id, {
        action,
        rejection_message: action === 'reject' ? (rejectionMessage || '').trim() : undefined,
        temporary_password: action === 'approve_assisted' ? (temporaryPassword || '') : undefined,
      });
      if (action === 'approve_assisted') {
        pushNotice({
          variant: 'info',
          message: 'Account approved without sending email. The user keeps their submitted password.'
        });
      } else if (action === 'refund') {
        pushNotice({ variant: 'success', message: 'Account request refunded from revenue. User account stays active.' });
      } else if (action === 'approve' && result.decision_email_status === 'failed') {
        const fallbackMsg = result.decision_email_error
          ? `Account approved. Email was not sent (${result.decision_email_error}). User can log in with submitted password.`
          : 'Account approved. Email was not sent due to provider limit. User can log in with submitted password.';
        pushNotice({ variant: 'info', message: fallbackMsg });
      } else {
        pushNotice({ variant: 'success', message: action === 'approve' ? 'Account request approved.' : 'Account request rejected.' });
      }
      await loadAccountRegistrationRequests();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Network error updating account request' });
    } finally {
      setAccountReqLoading(false);
    }
  };

  const handleAccountRequestRetryEmail = async (id: string) => {
    setAccountReqLoading(true);
    try {
      const result = await adminApi.accountRegistrationRetryEmail(id);
      if (result.decision_email_status === 'sent') {
        pushNotice({ variant: 'success', message: 'Decision email sent.' });
      } else if (result.decision_email_status === 'failed') {
        pushNotice({
          variant: 'error',
          message: result.decision_email_error
            ? `Retry email failed: ${result.decision_email_error}`
            : 'Retry email failed.'
        });
      } else {
        pushNotice({ variant: 'info', message: 'Email retry skipped.' });
      }
      await loadAccountRegistrationRequests();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Network error retrying decision email' });
    } finally {
      setAccountReqLoading(false);
    }
  };

  const usersTotalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const assignmentUsersTotalPages = Math.max(1, Math.ceil(assignmentUsersSource.length / PAGE_SIZE));
  const banksTotalPages = Math.max(1, Math.ceil(banks.length / PAGE_SIZE));
  const assignmentBanksTotalPages = Math.max(1, Math.ceil(assignmentBanksSource.length / PAGE_SIZE));
  const activeTotalPages = Math.max(1, Math.ceil(activeTotal / PAGE_SIZE));
  const activeTodayTotalPages = Math.max(1, Math.ceil(activeTodayTotal / PAGE_SIZE));
  const storePromotionsTotalPages = Math.max(1, Math.ceil(storePromotions.length / PAGE_SIZE));
  const accountReqTotalPages = Math.max(1, Math.ceil(accountReqTotal / PAGE_SIZE));
  const crashReportsTotalPages = Math.max(1, Math.ceil(crashReportsTotal / PAGE_SIZE));
  const bankAccessTotalPages = Math.max(1, Math.ceil(bankAccessTotal / PAGE_SIZE));
  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const otherActivityTotalPages = Math.max(1, Math.ceil(otherActivityTotal / PAGE_SIZE));
  const homeTrends = React.useMemo(() => {
    if (homeData?.trends && homeData.trends.length > 0) return homeData.trends;
    const fallback: AdminDashboardOverview['trends'] = [];
    const today = new Date();
    const days = Math.max(1, homeWindowDays);
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = new Date(today.getTime() - (offset * 24 * 60 * 60 * 1000));
      const yyyy = day.getUTCFullYear();
      const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(day.getUTCDate()).padStart(2, '0');
      fallback.push({
        date: `${yyyy}-${mm}-${dd}`,
        activeUsers: 0,
        exportSuccess: 0,
        exportFailed: 0,
        authSuccess: 0,
        authFailed: 0,
        importTotal: 0,
        storeRevenueApproved: 0,
        accountRevenueApproved: 0,
        installerRevenueApproved: 0,
        totalRevenueApproved: 0,
        storeBuyersApproved: 0,
        accountBuyersApproved: 0,
        installerSalesApproved: 0,
        importRequests: 0,
      });
    }
    return fallback;
  }, [homeData, homeWindowDays]);
  const homePointLabels = React.useMemo(
    () => homeTrends.map((point) => {
      const [year, month, day] = point.date.split('-');
      if (!year || !month || !day) return point.date;
      return `${month}/${day}`;
    }),
    [homeTrends],
  );
  const homeAuthSuccessSeries = React.useMemo(() => homeTrends.map((point) => Number(point.authSuccess || 0)), [homeTrends]);
  const homeAuthFailedSeries = React.useMemo(() => homeTrends.map((point) => Number(point.authFailed || 0)), [homeTrends]);
  const homeImportSeries = React.useMemo(() => homeTrends.map((point) => Number(point.importTotal || 0)), [homeTrends]);
  const homeStoreBuyersSeries = React.useMemo(() => homeTrends.map((point) => Number(point.storeBuyersApproved || 0)), [homeTrends]);
  const homeAccountBuyersSeries = React.useMemo(() => homeTrends.map((point) => Number(point.accountBuyersApproved || 0)), [homeTrends]);
  const homeInstallerSalesSeries = React.useMemo(() => homeTrends.map((point) => Number(point.installerSalesApproved || 0)), [homeTrends]);
  const homeActiveUsersSeries = React.useMemo(() => homeTrends.map((point) => Number(point.activeUsers || 0)), [homeTrends]);
  const homeRangeLabel = React.useMemo(() => {
    const start = homeData?.meta?.rangeStartDate || homeFromDate || '-';
    const end = homeData?.meta?.rangeEndDate || homeToDate || '-';
    return `${start} to ${end}`;
  }, [homeData, homeFromDate, homeToDate]);
  const crashReportPlatformOptions = React.useMemo(
    () => Array.from(new Set(crashReportsRows.map((row) => String(row.platform || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [crashReportsRows],
  );
  const crashReportAppVersionOptions = React.useMemo(
    () => Array.from(new Set(crashReportsRows.map((row) => String(row.app_version || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [crashReportsRows],
  );
  const formatHomeMoney = React.useCallback(
    (value: number) =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(value) ? value : 0),
    [],
  );

  const getActivityMeta = React.useCallback((row: AdminActivityRow): Record<string, unknown> => {
    if (!row.meta || typeof row.meta !== 'object' || Array.isArray(row.meta)) return {};
    return row.meta;
  }, []);

  const getActivityPadNames = React.useCallback((row: AdminActivityRow): string[] => {
    const meta = getActivityMeta(row);
    const raw = meta.padNames;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .slice(0, 500);
  }, [getActivityMeta]);

  React.useEffect(() => {
    if (!expandedActivityId) return;
    if (!activityRows.some((row) => row.id === expandedActivityId)) {
      setExpandedActivityId(null);
    }
  }, [activityRows, expandedActivityId]);

  const loadBankAccess = React.useCallback(async (bankId: string, page: number, search: string) => {
    setBankAccessLoading(true);
    try {
      const data = await adminApi.getBankAccess(bankId, {
        page,
        perPage: PAGE_SIZE,
        q: search.trim() || undefined,
      });
      setBankAccessRows(Array.isArray(data.access) ? data.access : []);
      setBankAccessTotal(Number(data.total || 0));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load bank access list.');
      setBankAccessRows([]);
      setBankAccessTotal(0);
    } finally {
      setBankAccessLoading(false);
    }
  }, [homeData]);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      ACTIVE_SORT_STORAGE_KEY,
      JSON.stringify({ sortBy: activeSortBy, sortDir: activeSortDir }),
    );
  }, [activeSortBy, activeSortDir]);

  React.useEffect(() => {
    if (usersPage > usersTotalPages) {
      setUsersPage(usersTotalPages);
    }
  }, [usersPage, usersTotalPages]);

  React.useEffect(() => {
    if (assignmentUsersPage > assignmentUsersTotalPages) {
      setAssignmentUsersPage(assignmentUsersTotalPages);
    }
  }, [assignmentUsersPage, assignmentUsersTotalPages]);

  React.useEffect(() => {
    if (banksPage > banksTotalPages) {
      setBanksPage(banksTotalPages);
    }
  }, [banksPage, banksTotalPages]);

  React.useEffect(() => {
    if (assignmentBanksPage > assignmentBanksTotalPages) {
      setAssignmentBanksPage(assignmentBanksTotalPages);
    }
  }, [assignmentBanksPage, assignmentBanksTotalPages]);

    React.useEffect(() => {
      if (activePage > activeTotalPages) {
        setActivePage(activeTotalPages);
      }
    }, [activePage, activeTotalPages]);

    React.useEffect(() => {
      if (activeTodayPage > activeTodayTotalPages) {
        setActiveTodayPage(activeTodayTotalPages);
      }
    }, [activeTodayPage, activeTodayTotalPages]);

  React.useEffect(() => {
    if (storePromotionsPage > storePromotionsTotalPages) {
      setStorePromotionsPage(storePromotionsTotalPages);
    }
  }, [storePromotionsPage, storePromotionsTotalPages]);

  React.useEffect(() => {
    if (crashReportsPage > crashReportsTotalPages) {
      setCrashReportsPage(crashReportsTotalPages);
    }
  }, [crashReportsPage, crashReportsTotalPages]);

  React.useEffect(() => {
    if (!open) return;
    if (!selectedUserId) {
      setAccessRows([]);
      return;
    }
    void refreshAccess(selectedUserId);
  }, [open, selectedUserId, refreshAccess]);

  React.useEffect(() => {
    if (!open || !bankAccessOpen || !bankAccessBank?.id) return;
    const timer = window.setTimeout(() => {
      void loadBankAccess(bankAccessBank.id, bankAccessPage, bankAccessSearch);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, bankAccessOpen, bankAccessBank?.id, bankAccessPage, bankAccessSearch, loadBankAccess]);

  React.useEffect(() => {
    if (bankAccessPage > bankAccessTotalPages) {
      setBankAccessPage(bankAccessTotalPages);
    }
  }, [bankAccessPage, bankAccessTotalPages]);

  React.useEffect(() => {
    if (!open || tab !== 'home') return;
    const onTick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refreshHomeDashboard();
    };
    const timer = window.setInterval(onTick, ADMIN_HOME_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, tab, refreshHomeDashboard]);

  const toggleUserSort = (next: UserSortBy) => {
    setUsersPage(1);
    if (usersSortBy === next) setUsersSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setUsersSortBy(next);
      setUsersSortDir(next === 'created_at' || next === 'last_sign_in_at' ? 'desc' : 'asc');
    }
  };

  const toggleBankSort = (next: BankSortBy) => {
    setBanksPage(1);
    if (banksSortBy === next) setBanksSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setBanksSortBy(next);
      setBanksSortDir(next === 'created_at' || next === 'access_count' ? 'desc' : 'asc');
    }
  };

  const toggleAssignmentUserSort = (next: AssignmentUserSortBy) => {
    setAssignmentUsersPage(1);
    if (assignmentUserSortBy === next) {
      setAssignmentUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setAssignmentUserSortBy(next);
    setAssignmentUserSortDir(next === 'created_at' ? 'desc' : 'asc');
  };

  const toggleAssignmentBankSort = (next: AssignmentBankSortBy) => {
    setAssignmentBanksPage(1);
    if (assignmentBankSortBy === next) {
      setAssignmentBankSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setAssignmentBankSortBy(next);
    setAssignmentBankSortDir(next === 'access_count' ? 'desc' : 'asc');
  };

  const toggleActiveSort = (next: ActiveSortBy) => {
    setActivePage(1);
    if (activeSortBy === next) {
      setActiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setActiveSortBy(next);
    setActiveSortDir(next === 'last_seen_at' ? 'desc' : 'asc');
  };

  const toggleActivitySort = (next: ActivitySortBy) => {
    if (activitySortBy === next) {
      setActivitySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      setActivityPage(1);
      return;
    }
    setActivitySortBy(next);
    setActivitySortDir(next === 'created_at' ? 'desc' : 'asc');
    setActivityPage(1);
  };

  const toggleOtherActivitySort = (next: ActivitySortBy) => {
    if (otherActivitySortBy === next) {
      setOtherActivitySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      setOtherActivityPage(1);
      return;
    }
    setOtherActivitySortBy(next);
    setOtherActivitySortDir(next === 'created_at' ? 'desc' : 'asc');
    setOtherActivityPage(1);
  };

  const toggleSelectBank = (bankId: string) => {
    setSelectedBankIds((prev) => {
      const next = new Set(prev);
      if (next.has(bankId)) next.delete(bankId);
      else next.add(bankId);
      return next;
    });
  };

  const selectedIds = Array.from(selectedBankIds);
  const selectedGrantIds = selectedIds.filter((id) => !grantedBankIds.has(id));
  const selectedRevokeIds = selectedIds.filter((id) => grantedBankIds.has(id));
  const allGrantIds = assignmentBanksSource.filter((b) => !grantedBankIds.has(b.id)).map((b) => b.id);
  const allRevokeIds = assignmentBanksSource.filter((b) => grantedBankIds.has(b.id)).map((b) => b.id);

  const doGrant = async (bankIds: string[]) => {
    if (!selectedUserId || bankIds.length === 0) return;
    setBulkLoading(true);
    try {
      await adminApi.grantUserAccess(selectedUserId, bankIds);
      setInfo(`Granted ${bankIds.length} bank(s).`);
      setSelectedBankIds(new Set());
      await Promise.all([refreshAccess(selectedUserId), refreshBankData()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Access grant failed.');
    } finally {
      setBulkLoading(false);
    }
  };

  const doRevoke = async (bankIds: string[]) => {
    if (!selectedUserId || bankIds.length === 0) return;
    setBulkLoading(true);
    try {
      await adminApi.revokeUserAccess(selectedUserId, bankIds);
      setInfo(`Revoked ${bankIds.length} bank(s).`);
      setSelectedBankIds(new Set());
      await Promise.all([refreshAccess(selectedUserId), refreshBankData()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Access revoke failed.');
    } finally {
      setBulkLoading(false);
    }
  };

  const createUser = async () => {
    const email = createEmail.trim().toLowerCase();
    if (!email) {
      setError('Email is required.');
      return;
    }
    if (!createPassword || createPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setCreateLoading(true);
    try {
      await adminApi.createUser({
        email,
        password: createPassword,
        displayName: createDisplayName.trim() || undefined,
      });
      setCreateEmail('');
      setCreatePassword('');
      setCreateDisplayName('');
      setCreateOpen(false);
      setInfo('User created.');
      await refreshUserData();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'User could not be created.');
    } finally {
      setCreateLoading(false);
    }
  };

  const saveUserProfile = async () => {
    if (!detailsUser) return;
    const displayName = editDisplayName.trim();
    if (!displayName) {
      setError('Display name is required.');
      return;
    }
    const ownedBankQuota = Math.floor(Number(editOwnedBankQuota));
    const ownedBankPadCap = Math.floor(Number(editOwnedBankPadCap));
    const deviceTotalBankCap = Math.floor(Number(editDeviceTotalBankCap));
    if (!Number.isFinite(ownedBankQuota) || ownedBankQuota < 1 || ownedBankQuota > 500) {
      setError('Bank quota must be between 1 and 500.');
      return;
    }
    if (!Number.isFinite(ownedBankPadCap) || ownedBankPadCap < 1 || ownedBankPadCap > 256) {
      setError('Pad cap must be between 1 and 256.');
      return;
    }
    if (!Number.isFinite(deviceTotalBankCap) || deviceTotalBankCap < 10 || deviceTotalBankCap > 1000) {
      setError('Bank cap must be between 10 and 1000.');
      return;
    }
    setProfileSaving(true);
    try {
      await adminApi.updateUserProfile(detailsUser.id, {
        displayName,
        ownedBankQuota,
        ownedBankPadCap,
        deviceTotalBankCap,
      });
      setDetailsUser((prev) => (prev ? {
        ...prev,
        display_name: displayName,
        owned_bank_quota: ownedBankQuota,
        owned_bank_pad_cap: ownedBankPadCap,
        device_total_bank_cap: deviceTotalBankCap,
      } : prev));
      setInfo('User profile updated.');
      await refreshUserData();
      if (selectedUserId) await refreshAccess(selectedUserId);
      setDetailsOpen(false);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Profile could not be updated.');
    } finally {
      setProfileSaving(false);
    }
  };

  const loadUserBankLists = React.useCallback(async (userId: string) => {
    const requestId = detailsBankListsRequestRef.current + 1;
    detailsBankListsRequestRef.current = requestId;
    setDetailsBankListsLoading(true);
    try {
      const [banksData, accessData] = await Promise.all([
        adminApi.listBanks({
          page: 1,
          perPage: 2000,
          sortBy: 'title',
          sortDir: 'asc',
        }),
        adminApi.getUserAccess(userId),
      ]);
      if (detailsBankListsRequestRef.current !== requestId) return;
      const ownedBanks = (Array.isArray(banksData.banks) ? banksData.banks : [])
        .filter((bank) => bank.created_by === userId)
        .sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), undefined, { sensitivity: 'base' }));
      const grantedBanks = (Array.isArray(accessData.access) ? accessData.access : [])
        .sort((left, right) => String(left.bank?.title || '').localeCompare(String(right.bank?.title || ''), undefined, { sensitivity: 'base' }));
      setDetailsOwnedBanks(ownedBanks);
      setDetailsGrantedBanks(grantedBanks);
    } catch {
      if (detailsBankListsRequestRef.current !== requestId) return;
      setDetailsOwnedBanks([]);
      setDetailsGrantedBanks([]);
    } finally {
      if (detailsBankListsRequestRef.current === requestId) {
        setDetailsBankListsLoading(false);
      }
    }
  }, []);

  const handleDetailsOpenChange = React.useCallback((nextOpen: boolean) => {
    setDetailsOpen(nextOpen);
    if (!nextOpen) {
      detailsBankListsRequestRef.current += 1;
      setDetailsBankListsLoading(false);
      setDetailsOwnedBanks([]);
      setDetailsGrantedBanks([]);
    }
  }, []);

  const removeUser = async () => {
    if (!detailsUser) return;
    try {
      await adminApi.deleteUser(detailsUser.id);
      setDeleteUserOpen(false);
      setDetailsOpen(false);
      if (selectedUserId === detailsUser.id) setSelectedUserId('');
      setInfo('User deleted.');
      await Promise.all([refreshUserData(), refreshBankData()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'User could not be deleted.');
    }
  };

  const banUser = async () => {
    if (!detailsUser) return;
    try {
      const result = await adminApi.banUser(detailsUser.id, banHours);
      setDetailsUser((prev) => (prev ? { ...prev, banned_until: result.banned_until || prev.banned_until } : prev));
      setBanOpen(false);
      setInfo(`User banned for ${banHours} hour(s).`);
      await refreshUserData();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Account restriction could not be applied.');
    }
  };

  const unbanUser = async () => {
    if (!detailsUser) return;
    try {
      await adminApi.unbanUser(detailsUser.id);
      setDetailsUser((prev) => (prev ? { ...prev, banned_until: null } : prev));
      setInfo('User unbanned.');
      await refreshUserData();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Account restriction could not be removed.');
    }
  };

  const sendReset = async () => {
    if (!detailsUser) return;
    try {
      await adminApi.resetPassword(detailsUser.id);
      setInfo('Password reset email sent.');
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Password reset email could not be sent.');
    }
  };

  const saveBank = async () => {
    if (!editBank) return;
    const title = editBankTitle.trim();
    if (!title) {
      setError('Bank title is required.');
      return;
    }
    setBankSaving(true);
    try {
      await adminApi.updateBank(editBank.id, { title, description: editBankDesc.trim(), color: editBankColor });
      setInfo('Bank updated.');
      setEditBankOpen(false);
      await refreshBankData();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to update bank');
    } finally {
      setBankSaving(false);
    }
  };

  const removeBank = async () => {
    if (!deleteBank) return;
    try {
      await adminApi.deleteBank(deleteBank.id, true);
      setInfo(`Bank "${deleteBank.title}" archived and access revoked.`);
      setDeleteBankOpen(false);
      setDeleteBank(null);
      await Promise.all([refreshBankData(), selectedUserId ? refreshAccess(selectedUserId) : Promise.resolve()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to archive bank');
    }
  };

  const openUserDetails = (user: AdminUser) => {
    setDetailsUser(user);
    setEditDisplayName(user.display_name || '');
    setEditOwnedBankQuota(String(user.owned_bank_quota ?? samplerDefaultsConfig.quotaDefaults.ownedBankQuota));
    setEditOwnedBankPadCap(String(user.owned_bank_pad_cap ?? samplerDefaultsConfig.quotaDefaults.ownedBankPadCap));
    setEditDeviceTotalBankCap(String(user.device_total_bank_cap ?? samplerDefaultsConfig.quotaDefaults.deviceTotalBankCap));
    setDetailsOwnedBanks([]);
    setDetailsGrantedBanks([]);
    setDetailsBankListsLoading(true);
    setBanHours(24);
    setDetailsOpen(true);
    void loadUserBankLists(user.id);
  };

  const openBankAccessDialog = (bank: AdminBank) => {
    setBankAccessBank(bank);
    setBankAccessRows([]);
    setBankAccessTotal(0);
    setBankAccessSearch('');
    setBankAccessPage(1);
    setBankAccessOpen(true);
  };

  const tabMap = React.useMemo(() => new Map(TABS.map((item) => [item.key, item])), []);
  const navTabs = React.useMemo(
    () => ADMIN_NAV_ORDER.map((key) => tabMap.get(key)).filter(Boolean) as typeof TABS,
    [tabMap],
  );

  const activeTab = tabMap.get(tab) || TABS[0];
  const tabToneForKey = (tabKey: TabKey) => (tabMap.get(tabKey) || TABS[0]).tone;
  const tabButtonClass = (tabKey: TabKey): string => {
    const config = tabMap.get(tabKey);
    if (!config) return '';
    const tone = TAB_TONE_CLASSES[config.tone];
    const isActive = tab === tabKey;
    const colorClass = isActive
      ? (theme === 'dark' ? tone.activeDark : tone.activeLight)
      : (theme === 'dark' ? tone.inactiveDark : tone.inactiveLight);
    return `h-9 w-full justify-start px-3 border transition-colors text-left overflow-hidden whitespace-nowrap ${colorClass}`;
  };
  const tabPanelToneClass = (tabKey: TabKey): string => {
    const tone = TAB_CONTENT_TONE_CLASSES[tabToneForKey(tabKey)];
    return theme === 'dark' ? tone.panelDark : tone.panelLight;
  };
  const tabCardToneClass = (tabKey: TabKey): string => {
    const tone = TAB_CONTENT_TONE_CLASSES[tabToneForKey(tabKey)];
    return theme === 'dark' ? tone.cardDark : tone.cardLight;
  };
  const tabTitleToneClass = (tabKey: TabKey): string => {
    const tone = TAB_CONTENT_TONE_CLASSES[tabToneForKey(tabKey)];
    return theme === 'dark' ? tone.textDark : tone.textLight;
  };

  return (
    <>
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className={`w-full max-w-[100vw] sm:max-w-[95vw] md:max-w-[92vw] 2xl:max-w-[1800px] h-[100dvh] max-h-[100dvh] sm:h-[90vh] sm:max-h-[90vh] overflow-hidden grid grid-rows-[auto_1fr] p-2 sm:p-6 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Admin Access
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 h-full overflow-hidden grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3">
            <aside className={`hidden lg:flex border rounded p-3 flex-col gap-2 min-h-0 overflow-auto w-[240px] min-w-[240px] max-w-[240px] ${tabCardToneClass(activeTab.key)}`}>
              <div className="text-sm font-semibold">Navigation</div>
              <div className={`text-xs rounded border px-2 py-1 min-h-[52px] flex flex-col justify-center overflow-hidden ${tabCardToneClass(activeTab.key)}`}>
                <span className={`font-medium truncate ${tabTitleToneClass(activeTab.key)}`}>{activeTab.emoji} {activeTab.label}</span>
                <div className="opacity-75 mt-0.5 truncate whitespace-nowrap" title={activeTab.hint}>{activeTab.hint}</div>
              </div>
              <div className="space-y-2">
                {navTabs.map((t) => (
                  <Button
                    key={t.key}
                    size="sm"
                    variant="outline"
                    className={tabButtonClass(t.key)}
                    onClick={() => setTab(t.key)}
                  >
                    <span className="mr-2 shrink-0">{t.emoji}</span>
                    <span className="truncate">{t.label}</span>
                  </Button>
                ))}
              </div>
            </aside>
            <div className="min-h-0 h-full overflow-y-auto flex flex-col pr-0 lg:pr-1">
              <div className="lg:hidden mb-2 flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="h-9 px-3" onClick={() => setIsNavOpen(true)}>
                  <Menu className="w-4 h-4 mr-1" />
                  Menu
                </Button>
                <div className={`flex-1 rounded border px-2 py-1 text-xs ${tabCardToneClass(activeTab.key)}`}>
                  <span className={`font-medium ${tabTitleToneClass(activeTab.key)}`}>{activeTab.emoji} {activeTab.label}</span>
                  <span className="opacity-70"> | {activeTab.hint}</span>
                </div>
              </div>
              <AdminAccessNonStoreTabs
                tab={tab}
                home={{
                  theme,
                  panelClass: tabPanelToneClass('home'),
                  cardClass: tabCardToneClass('home'),
                  homeFromDate,
                  homeToDate,
                  homeLoading,
                  homeError,
                  homeData,
                  homeRangeLabel,
                  homeLastRefresh,
                  homeTrends,
                  homePointLabels,
                  homeStoreBuyersSeries,
                  homeAccountBuyersSeries,
                  homeInstallerSalesSeries,
                  homeAuthSuccessSeries,
                  homeAuthFailedSeries,
                  homeActiveUsersSeries,
                  homeImportSeries,
                  onHomeFromDateChange: setHomeFromDate,
                  onHomeToDateChange: setHomeToDate,
                  onApplyPresetRange: applyHomePresetRange,
                  onRefresh: () => void refreshHomeDashboard(undefined, { force: true }),
                  onOpenAccountRequests: () => setTab('account_requests'),
                  onOpenStoreRequests: () => setTab('store_requests'),
                  formatMoney: formatHomeMoney,
                }}
                assignments={{
                  theme,
                  cardClass: tabCardToneClass('assignments'),
                  usersLoading: assignmentUsersLoading,
                  usersQuery,
                  assignmentUsers,
                  assignmentUsersPage,
                  assignmentUsersTotalPages,
                  assignmentUserSortBy,
                  assignmentUserSortDir,
                  selectedUserId,
                  selectedUser,
                  accessLoading,
                  bulkLoading,
                  selectedGrantIds,
                  selectedRevokeIds,
                  allGrantIds,
                  allRevokeIds,
                  assignmentBanks,
                  assignmentBanksPage,
                  assignmentBanksTotalPages,
                  assignmentBankSortBy,
                  assignmentBankSortDir,
                  selectedBankIds,
                  grantedBankIds,
                  banksLoading: assignmentBanksLoading,
                  onUsersQueryChange: (value) => {
                    setUsersQuery(value);
                    setAssignmentUsersPage(1);
                  },
                  onRefreshUsers: () => void refreshAssignmentUsers(),
                  onAssignmentUsersPageChange: setAssignmentUsersPage,
                  onToggleAssignmentUserSort: toggleAssignmentUserSort,
                  onSelectUser: setSelectedUserId,
                  onGrant: (ids) => void doGrant(ids),
                  onRevoke: (ids) => void doRevoke(ids),
                  onAssignmentBanksPageChange: setAssignmentBanksPage,
                  onToggleAssignmentBankSort: toggleAssignmentBankSort,
                  onToggleBankSelection: toggleSelectBank,
                }}
                banks={{
                  theme,
                  panelClass: tabPanelToneClass('active'),
                  banksLoading,
                  banksQuery,
                  banks: pagedBanks,
                  banksPage,
                  banksTotalPages,
                  banksSortBy,
                  banksSortDir,
                  onBanksQueryChange: (value) => {
                    setBanksQuery(value);
                    setBanksPage(1);
                  },
                  onRefreshBanks: () => void refreshBanks(),
                  onBanksPageChange: setBanksPage,
                  onToggleBankSort: toggleBankSort,
                  onOpenBankAccess: openBankAccessDialog,
                  onEditBank: (bank) => {
                    setEditBank(bank);
                    setEditBankTitle(bank.title);
                    setEditBankDesc(bank.description || '');
                    setEditBankColor(bank.color || '#3b82f6');
                    setEditBankOpen(true);
                  },
                  onDeleteBank: (bank) => {
                    setDeleteBank(bank);
                    setDeleteBankOpen(true);
                  },
                }}
                users={{
                  theme,
                  panelClass: tabPanelToneClass('users'),
                  usersLoading,
                  usersQuery,
                  users: pagedUsers,
                  usersPage,
                  usersTotalPages,
                  usersSortBy,
                  usersSortDir,
                  onUsersQueryChange: (value) => {
                    setUsersQuery(value);
                    setUsersPage(1);
                  },
                  onRefreshUsers: () => void refreshUsers(),
                  onUsersPageChange: setUsersPage,
                  onToggleUserSort: toggleUserSort,
                  onOpenCreateUser: () => setCreateOpen(true),
                  onOpenUserDetails: openUserDetails,
                }}
                active={{
                  theme,
                  panelClass: tabPanelToneClass('banks'),
                  cardClass: tabCardToneClass('active'),
                  titleClass: tabTitleToneClass('active'),
                    activeLoading,
                      activeCounts,
                      activeUsersRows: activeSessions,
                      activeTodayUsersRows: activeTodaySessions,
                    activePage,
                    activeTotalPages,
                    activeTodayPage,
                    activeTodayTotalPages,
                    activeSortBy,
                    activeSortDir,
                    onRefreshActive: () => void refreshActive(),
                    onActivePageChange: setActivePage,
                    onActiveTodayPageChange: setActiveTodayPage,
                    onToggleActiveSort: toggleActiveSort,
                  }}
                activity={{
                  theme,
                  panelClass: tabPanelToneClass('activity'),
                  cardClass: tabCardToneClass('activity'),
                  activityLoading,
                  activityRows,
                  activityPage,
                  activityTotalPages,
                  activitySearch,
                  activitySortBy,
                  activitySortDir,
                  activityStatusFilter,
                  activityCategoryFilter,
                  activityPhaseFilter,
                  activityUploadResultFilter,
                  expandedActivityId,
                  otherActivityLoading,
                  otherActivityRows,
                  otherActivityPage,
                  otherActivityTotalPages,
                  otherActivitySearch,
                  otherActivitySortBy,
                  otherActivitySortDir,
                  otherActivityStatusFilter,
                  getActivityMeta,
                  getActivityPadNames,
                  onActivityPageChange: setActivityPage,
                  onActivitySearchChange: setActivitySearch,
                  onToggleActivitySort: toggleActivitySort,
                  onActivityStatusFilterChange: setActivityStatusFilter,
                  onActivityCategoryFilterChange: setActivityCategoryFilter,
                  onActivityPhaseFilterChange: setActivityPhaseFilter,
                  onActivityUploadResultFilterChange: setActivityUploadResultFilter,
                  onToggleExpandedActivity: (id) => setExpandedActivityId((prev) => prev === id ? null : id),
                  onRefreshActivity: () => void refreshActivity(),
                  onOtherActivityPageChange: setOtherActivityPage,
                  onOtherActivitySearchChange: setOtherActivitySearch,
                  onToggleOtherActivitySort: toggleOtherActivitySort,
                  onOtherActivityStatusFilterChange: setOtherActivityStatusFilter,
                  onRefreshOtherActivity: () => void refreshOtherActivity(),
                }}
              />

              {tab === 'default_bank' && (
                <DefaultBankTab
                  theme={theme}
                  panelClass={tabPanelToneClass('default_bank')}
                  loading={defaultBankLoading}
                  publishLoading={defaultBankPublishLoading}
                  rollbackLoading={defaultBankRollbackLoading}
                  currentRelease={defaultBankCurrentRelease}
                  releases={defaultBankReleases}
                  nextVersion={defaultBankNextVersion}
                  sourceOptions={defaultBankSourceChoices}
                  selectedSourceId={defaultBankSourceId}
                  releaseNotes={defaultBankReleaseNotes}
                  minAppVersion={defaultBankMinAppVersion}
                  onSelectedSourceIdChange={setDefaultBankSourceId}
                  onReleaseNotesChange={setDefaultBankReleaseNotes}
                  onMinAppVersionChange={setDefaultBankMinAppVersion}
                  onRefresh={() => void refreshDefaultBank()}
                  onPublish={() => void handlePublishDefaultBankRelease()}
                  onRollback={(version) => void handleRollbackDefaultBankRelease(version)}
                />
              )}

              {tab === 'landing_download' && (
                <LandingDownloadTab
                  theme={theme}
                  panelClass={tabPanelToneClass('landing_download')}
                  loading={landingDownloadLoading}
                  saving={landingDownloadSaving}
                  config={landingDownloadConfig}
                  onConfigChange={setLandingDownloadConfig}
                  onRefresh={() => void refreshLandingDownloadConfig()}
                  onSave={() => void handleSaveLandingDownloadConfig()}
                />
              )}

              {tab === 'sampler_defaults' && (
                <SamplerDefaultsTab
                  theme={theme}
                  panelClass={tabPanelToneClass('sampler_defaults')}
                  loading={samplerDefaultsLoading}
                  saving={samplerDefaultsSaving}
                  config={samplerDefaultsConfig}
                  onConfigChange={setSamplerDefaultsConfig}
                  onRefresh={() => void refreshSamplerDefaultsConfig()}
                  onReset={() => setSamplerDefaultsConfig(normalizeSamplerAppConfig(DEFAULT_SAMPLER_APP_CONFIG))}
                  onSave={() => void handleSaveSamplerDefaultsConfig()}
                />
              )}

              {/* Store Requests Tab */}
              {tab === 'account_requests' && (
                <AccountRequestsTab
                  theme={theme}
                  panelClass={tabPanelToneClass('account_requests')}
                  cardClass={tabCardToneClass('account_requests')}
                  filter={accountReqFilter}
                  statusFilter={accountReqStatusFilter}
                  channelFilter={accountReqChannelFilter}
                  decisionFilter={accountReqDecisionFilter}
                  automationFilter={accountReqAutomationFilter}
                  ocrStatusFilter={accountReqOcrStatusFilter}
                  search={accountReqSearch}
                  loading={accountReqLoading}
                  rows={accountReqRows}
                  page={accountReqPage}
                  totalPages={accountReqTotalPages}
                  pendingCount={accountReqPendingCount}
                  historyCount={accountReqHistoryCount}
                  onFilterChange={(nextFilter) => {
                    setAccountReqFilter(nextFilter);
                    setAccountReqStatusFilter('all');
                    setAccountReqPage(1);
                  }}
                  onStatusFilterChange={(value) => {
                    setAccountReqStatusFilter(value);
                    setAccountReqPage(1);
                  }}
                  onChannelFilterChange={(value) => {
                    setAccountReqChannelFilter(value);
                    setAccountReqPage(1);
                  }}
                  onDecisionFilterChange={(value) => {
                    setAccountReqDecisionFilter(value);
                    setAccountReqPage(1);
                  }}
                  onAutomationFilterChange={(value) => {
                    setAccountReqAutomationFilter(value);
                    setAccountReqPage(1);
                  }}
                  onOcrStatusFilterChange={(value) => {
                    setAccountReqOcrStatusFilter(value);
                    setAccountReqPage(1);
                  }}
                    onSearchChange={(value) => {
                      setAccountReqSearch(value);
                      setAccountReqPage(1);
                    }}
                    onRefresh={() => void loadAccountRegistrationRequests()}
                    onPageChange={setAccountReqPage}
                  onApprove={(id) => void handleAccountRequestAction(id, 'approve')}
                  onAssist={(id) => setAccountReqToAssist({ id })}
                  onReject={(id) => setAccountReqToReject({ id, message: '' })}
                  onRetryEmail={(id) => void handleAccountRequestRetryEmail(id)}
                  onRefund={(id) => handleAccountRequestAction(id, 'refund')}
                />
              )}

              {tab === 'crash_reports' && (
                <CrashReportsTab
                  theme={theme}
                  panelClass={tabPanelToneClass('crash_reports')}
                  cardClass={tabCardToneClass('crash_reports')}
                  loading={crashReportsLoading}
                  rows={crashReportsRows}
                  page={crashReportsPage}
                  totalPages={crashReportsTotalPages}
                  totalCount={crashReportsTotal}
                  newCount={crashReportsNewCount}
                  search={crashReportsSearch}
                  statusFilter={crashReportsStatusFilter}
                  domainFilter={crashReportsDomainFilter}
                  platformFilter={crashReportsPlatformFilter}
                  appVersionFilter={crashReportsAppVersionFilter}
                  platformOptions={crashReportPlatformOptions}
                  appVersionOptions={crashReportAppVersionOptions}
                  onSearchChange={(value) => {
                    setCrashReportsSearch(value);
                    setCrashReportsPage(1);
                  }}
                  onStatusFilterChange={(value) => {
                    setCrashReportsStatusFilter(value);
                    setCrashReportsPage(1);
                  }}
                  onDomainFilterChange={(value) => {
                    setCrashReportsDomainFilter(value);
                    setCrashReportsPage(1);
                  }}
                  onPlatformFilterChange={(value) => {
                    setCrashReportsPlatformFilter(value);
                    setCrashReportsPage(1);
                  }}
                  onAppVersionFilterChange={(value) => {
                    setCrashReportsAppVersionFilter(value);
                    setCrashReportsPage(1);
                  }}
                  onRefresh={() => void loadClientCrashReports()}
                  onPageChange={setCrashReportsPage}
                  onStatusUpdate={(id, status) => void handleClientCrashReportStatusUpdate(id, status)}
                />
              )}

              {tab === 'store_requests' && (
                <StoreRequestsTab
                  theme={theme}
                  panelClass={tabPanelToneClass('store_requests')}
                  cardClass={tabCardToneClass('store_requests')}
                  filter={storeRequestFilter}
                  statusFilter={storeRequestStatusFilter}
                  channelFilter={storeRequestChannelFilter}
                  decisionFilter={storeRequestDecisionFilter}
                  automationFilter={storeRequestAutomationFilter}
                  ocrStatusFilter={storeRequestOcrStatusFilter}
                  search={storeReqSearch}
                  loading={storeLoading}
                  rows={pagedRequests}
                  page={storeReqPage}
                  totalPages={reqTotalPages}
                  expandedId={expandedStoreRequestId}
                  pendingCount={storeReqPendingCount}
                  historyCount={storeReqHistoryCount}
                  onFilterChange={(nextFilter) => {
                    setStoreRequestFilter(nextFilter);
                    setStoreRequestStatusFilter('all');
                    setStoreReqPage(1);
                    setExpandedStoreRequestId(null);
                  }}
                    onStatusFilterChange={(value) => {
                      setStoreRequestStatusFilter(value);
                      setStoreReqPage(1);
                      setExpandedStoreRequestId(null);
                    }}
                    onChannelFilterChange={(value) => {
                      setStoreRequestChannelFilter(value);
                      setStoreReqPage(1);
                      setExpandedStoreRequestId(null);
                    }}
                    onDecisionFilterChange={(value) => {
                      setStoreRequestDecisionFilter(value);
                      setStoreReqPage(1);
                      setExpandedStoreRequestId(null);
                    }}
                    onAutomationFilterChange={(value) => {
                      setStoreRequestAutomationFilter(value);
                      setStoreReqPage(1);
                      setExpandedStoreRequestId(null);
                    }}
                    onOcrStatusFilterChange={(value) => {
                      setStoreRequestOcrStatusFilter(value);
                      setStoreReqPage(1);
                      setExpandedStoreRequestId(null);
                    }}
                    onSearchChange={(value) => {
                      setStoreReqSearch(value);
                      setStoreReqPage(1);
                    }}
                    onRefresh={() => void loadStoreRequests()}
                    onPageChange={setStoreReqPage}
                    onToggleExpanded={(id) => setExpandedStoreRequestId((prev) => prev === id ? null : id)}
                  onApprove={(id) => {
                    void handleStoreRequestAction(id, 'approve');
                  }}
                  onReject={(id) => setStoreRequestToReject({ id, message: '' })}
                  onRetryEmail={(id) => void handleStoreRequestRetryEmail(id)}
                  onRefund={(id) => handleStoreRequestAction(id, 'refund')}
                />
              )}

              {/* Store Catalog Tab */}
              {tab === 'store_catalog' && (
                <StoreCatalogTab
                  theme={theme}
                  panelClass={tabPanelToneClass('store_catalog')}
                  loading={storeLoading}
                  storeConfig={storeConfig}
                  storeDrafts={storeDrafts}
                  pagedDrafts={pagedDrafts}
                  page={storeCatalogPage}
                  totalPages={catalogTotalPages}
                  search={storeCatalogSearch}
                  bankFilter={storeCatalogBankFilter}
                  statusFilter={storeCatalogStatusFilter}
                  paidFilter={storeCatalogPaidFilter}
                  pinnedFilter={storeCatalogPinnedFilter}
                  sort={storeCatalogSort}
                  bankOptions={catalogBankOptions}
                  filteredCount={filteredDrafts.length}
                  stats={storeCatalogStats}
                  hasFilters={hasStoreCatalogFilters}
                  onSearchChange={(value) => {
                    setStoreCatalogSearch(value);
                    setStoreCatalogPage(1);
                  }}
                  onBankFilterChange={(value) => {
                    setStoreCatalogBankFilter(value);
                    setStoreCatalogPage(1);
                  }}
                  onStatusFilterChange={(value) => {
                    setStoreCatalogStatusFilter(value);
                    setStoreCatalogPage(1);
                  }}
                  onPaidFilterChange={(value) => {
                    setStoreCatalogPaidFilter(value);
                    setStoreCatalogPage(1);
                  }}
                  onPinnedFilterChange={(value) => {
                    setStoreCatalogPinnedFilter(value);
                    setStoreCatalogPage(1);
                  }}
                  onSortChange={(value) => {
                    setStoreCatalogSort(value);
                    setStoreCatalogPage(1);
                  }}
                  onResetFilters={resetStoreCatalogFilters}
                  onPageChange={setStoreCatalogPage}
                  onApplyStoreMaintenanceMode={(enabled, message) => handleStoreMaintenanceMode(enabled, message)}
                  onApplyDraftAction={handleStoreCatalogDraftAction}
                  onCreateBundle={createStoreCatalogBundle}
                  onReload={loadStoreCatalog}
                  pushNotice={pushNotice}
                />
              )}

              {tab === 'store_promotions' && (
                <StorePromotionsTab
                  theme={theme}
                  panelClass={tabPanelToneClass('store_promotions')}
                  loading={storeLoading}
                  promotions={pagedStorePromotions}
                  page={storePromotionsPage}
                  totalPages={storePromotionsTotalPages}
                  stats={storePromotionStats}
                  catalogDrafts={storeDrafts}
                  promotionUserOptions={promotionUserOptions}
                  editingPromotionId={editingPromotionId}
                  form={storePromotionForm}
                  onFormChange={setStorePromotionForm}
                  onPageChange={setStorePromotionsPage}
                  onEdit={editStorePromotion}
                  onReset={resetStorePromotionForm}
                  onSave={persistStorePromotion}
                  onDelete={(promotionId) => void deleteStorePromotion(promotionId)}
                />
              )}

              {/* Store Banners Tab */}
              {tab === 'store_banners' && (
                <StoreBannersTab
                  theme={theme}
                  panelClass={tabPanelToneClass('store_banners')}
                  loading={storeLoading}
                  bannerLoading={bannerLoading}
                  banners={visibleStoreBanners}
                  dirtyBannerIds={dirtyStoreBannerIds}
                  bannerStats={storeBannerStats}
                  showInactive={showInactiveBanners}
                  newBannerPreviewUrl={newBannerPreviewUrl}
                  newBannerImageUrl={newBannerImageUrl}
                  newBannerLinkUrl={newBannerLinkUrl}
                  newBannerSortOrder={newBannerSortOrder}
                  newBannerHasFile={Boolean(newBannerImageFile)}
                  bannerUploadingIds={bannerUploadingIds}
                  onShowInactiveChange={setShowInactiveBanners}
                  onNewBannerImageUrlChange={setNewBannerImageUrl}
                  onNewBannerLinkUrlChange={setNewBannerLinkUrl}
                  onNewBannerSortOrderChange={setNewBannerSortOrder}
                  onNewBannerFileChange={handleNewBannerImageChange}
                  onClearNewBannerFile={() => setNewBannerImageFile(null)}
                  onCreateBanner={() => void handleCreateStoreBanner()}
                  onReplaceBannerImage={(id, file) => void handleStoreBannerImageReplace(id, file)}
                  onNudgeBannerSort={nudgeBannerSortOrder}
                  onUpdateBanner={updateBannerDraft}
                  onResetBanner={resetBannerDraft}
                  onSaveBanner={(banner) => void handleSaveStoreBanner(banner)}
                  onDeleteBanner={(banner) => void handleDeleteStoreBanner(banner)}
                />
              )}

              {/* Store Config Tab */}
              {tab === 'store_config' && (
                <StoreConfigTab
                  theme={theme}
                  panelClass={tabPanelToneClass('store_config')}
                  loading={storeLoading}
                  storeConfig={storeConfig}
                  storeQrPreviewUrl={storeQrPreviewUrl}
                  hasQrImage={Boolean(storeQrPreviewUrl || storeConfig.qr_image_path)}
                  onStoreConfigChange={setStoreConfig}
                  onQrFileChange={handleStoreQrFileChange}
                  onAutoApprovalAction={(target, action) => void handleStoreAutoApprovalAction(target, action)}
                  onRemoveQr={() => {
                    setStoreQrFile(null);
                    setStoreConfig({ ...storeConfig, qr_image_path: '' });
                  }}
                  onSave={() => void handleStoreConfigSave()}
                />
              )}

        {tab === 'installer' && (
          <AdminAccessInstallerTab
            theme={theme}
            panelClass={tabPanelToneClass('installer')}
            pushNotice={pushNotice}
          />
        )}

        {tab === 'installer_requests' && (
          <InstallerRequestsTab
            theme={theme}
            panelClass={tabPanelToneClass('installer_requests')}
            cardClass={theme === 'dark' ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}
            pushNotice={pushNotice}
          />
        )}
            </div>
          </div>
          {isNavOpen && (
            <div className="lg:hidden fixed inset-0 z-[160] bg-black/55" onClick={() => setIsNavOpen(false)}>
              <div
                className={`absolute left-0 top-0 h-full w-[82vw] max-w-[320px] border-r p-3 ${theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">Admin Navigation</div>
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setIsNavOpen(false)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className={`text-xs rounded border px-2 py-1 mb-2 ${tabCardToneClass(activeTab.key)}`}>
                  <span className={`font-medium ${tabTitleToneClass(activeTab.key)}`}>{activeTab.emoji} {activeTab.label}</span>
                  <div className="opacity-75 mt-0.5">{activeTab.hint}</div>
                </div>
                <div className="space-y-2 overflow-auto max-h-[calc(100vh-120px)] pr-1">
                  {navTabs.map((t) => (
                    <Button
                      key={`mobile-${t.key}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={tabButtonClass(t.key)}
                      onClick={() => {
                        setTab(t.key);
                        setIsNavOpen(false);
                      }}
                    >
                      <span className="mr-2 shrink-0">{t.emoji}</span>
                      <span className="truncate">{t.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AdminAccessDialogModals
        theme={theme}
        create={{
          open: createOpen,
          email: createEmail,
          password: createPassword,
          showPassword: showCreatePassword,
          displayName: createDisplayName,
          loading: createLoading,
          onOpenChange: setCreateOpen,
          onEmailChange: setCreateEmail,
          onPasswordChange: setCreatePassword,
          onToggleShowPassword: () => setShowCreatePassword((value) => !value),
          onDisplayNameChange: setCreateDisplayName,
          onSubmit: () => void createUser(),
        }}
        details={{
          open: detailsOpen,
          user: detailsUser,
          displayName: editDisplayName,
          ownedBankQuota: editOwnedBankQuota,
          ownedBankPadCap: editOwnedBankPadCap,
          deviceTotalBankCap: editDeviceTotalBankCap,
          saving: profileSaving,
          bankListsLoading: detailsBankListsLoading,
          ownedBanks: detailsOwnedBanks,
          grantedBanks: detailsGrantedBanks,
          onOpenChange: handleDetailsOpenChange,
          onDisplayNameChange: setEditDisplayName,
          onOwnedBankQuotaChange: setEditOwnedBankQuota,
          onOwnedBankPadCapChange: setEditOwnedBankPadCap,
          onDeviceTotalBankCapChange: setEditDeviceTotalBankCap,
          onSaveProfile: saveUserProfile,
          onOpenResetPassword: () => setResetPasswordOpen(true),
          onOpenUnban: () => setUnbanOpen(true),
          onOpenBan: () => setBanOpen(true),
          onOpenDeleteUser: () => setDeleteUserOpen(true),
        }}
        ban={{
          open: banOpen,
          hours: banHours,
          onOpenChange: setBanOpen,
          onHoursChange: setBanHours,
          onConfirm: banUser,
        }}
        bankEdit={{
          open: editBankOpen,
          title: editBankTitle,
          description: editBankDesc,
          color: editBankColor,
          saving: bankSaving,
          onOpenChange: setEditBankOpen,
          onTitleChange: setEditBankTitle,
          onDescriptionChange: setEditBankDesc,
          onColorChange: setEditBankColor,
          onSave: saveBank,
        }}
        bankAccess={{
          open: bankAccessOpen,
          bank: bankAccessBank,
          loading: bankAccessLoading,
          rows: bankAccessRows,
          page: bankAccessPage,
          total: bankAccessTotal,
          totalPages: bankAccessTotalPages,
          search: bankAccessSearch,
          onOpenChange: (nextOpen) => {
            setBankAccessOpen(nextOpen);
            if (!nextOpen) {
              setBankAccessBank(null);
              setBankAccessRows([]);
              setBankAccessTotal(0);
              setBankAccessSearch('');
              setBankAccessPage(1);
            }
          },
          onSearchChange: (value) => {
            setBankAccessSearch(value);
            setBankAccessPage(1);
          },
          onPageChange: setBankAccessPage,
        }}
        confirmations={{
          deleteUserOpen,
          unbanOpen,
          resetPasswordOpen,
          deleteBankOpen,
          deleteBank,
          detailsUser,
          onDeleteUserOpenChange: setDeleteUserOpen,
          onUnbanOpenChange: setUnbanOpen,
          onResetPasswordOpenChange: setResetPasswordOpen,
          onDeleteBankOpenChange: setDeleteBankOpen,
          onDeleteUserConfirm: removeUser,
          onUnbanConfirm: unbanUser,
          onResetPasswordConfirm: sendReset,
          onDeleteBankConfirm: removeBank,
        }}
        storePublish={{
          open: storePublishDialog.open,
          draft: storePublishDialog.draft,
          loading: storeLoading,
          onOpenChange: (nextOpen) => {
            if (!nextOpen) setStorePublishDialog({ open: false, draft: null });
          },
          onConfirm: executeStorePublish,
        }}
        storeRequestReject={{
          value: storeRequestToReject,
          onChange: setStoreRequestToReject,
          onConfirm: (value) => {
            handleStoreRequestAction(value.id, 'reject', value.message);
            setStoreRequestToReject(null);
          },
        }}
        accountRequestReject={{
          value: accountReqToReject,
          onChange: setAccountReqToReject,
          onConfirm: (value) => {
            const reason = value.message.trim();
            if (!reason) {
              pushNotice({ variant: 'error', message: 'Please enter a reason before declining.' });
              return;
            }
            void handleAccountRequestAction(value.id, 'reject', reason);
            setAccountReqToReject(null);
          },
        }}
        accountAssist={{
          value: accountReqToAssist,
          onChange: setAccountReqToAssist,
          onConfirm: (value) => {
            void handleAccountRequestAction(value.id, 'approve_assisted');
            setAccountReqToAssist(null);
          },
        }}
      />

    </>
  );
}



