import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { CopyableValue } from '@/components/ui/copyable-value';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  ActiveSessionRow,
  AdminActivityRow,
  AdminBank,
  AdminDashboardOverview,
  AdminUser,
  SortDirection,
} from '@/lib/admin-api';
import { Edit, Plus, Search, Trash2, Users } from 'lucide-react';
import {
  HOME_WINDOW_OPTIONS,
  type HomeTrendRows,
  isUserBanned,
  type ActiveSortBy,
  type ActivitySortBy,
  type AdminDialogTheme,
  type AssignmentBankSortBy,
  type AssignmentUserSortBy,
  type BankSortBy,
  type TabKey,
  type UserSortBy,
} from './AdminAccessDialog.shared';
import {
  ActiveUsersTrendChart,
  MiniGroupedBarChart,
  Pagination,
  RevenueAdvancedChart,
  SortHeader,
} from './AdminAccessDialog.widgets';
import { AdminActionCluster, AdminControlsBar, AdminPageScaffold, AdminRefreshButton, AdminStatsStrip, AdminToolbar } from './AdminAccessDialog.layout';

interface HomeTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  cardClass: string;
  homeFromDate: string;
  homeToDate: string;
  homeLoading: boolean;
  homeError: string;
  homeData: AdminDashboardOverview | null;
  homeRangeLabel: string;
  homeLastRefresh: string | null;
  homeTrends: HomeTrendRows;
  homePointLabels: string[];
  homeStoreBuyersSeries: number[];
  homeAccountBuyersSeries: number[];
  homeInstallerSalesSeries: number[];
  homeAuthSuccessSeries: number[];
  homeAuthFailedSeries: number[];
  homeActiveUsersSeries: number[];
  homeImportSeries: number[];
  onHomeFromDateChange: (value: string) => void;
  onHomeToDateChange: (value: string) => void;
  onApplyPresetRange: (days: number) => void;
  onRefresh: () => void;
  onOpenAccountRequests: () => void;
  onOpenStoreRequests: () => void;
  formatMoney: (value: number) => string;
}

interface AssignmentsTabProps {
  theme: AdminDialogTheme;
  cardClass: string;
  usersLoading: boolean;
  usersQuery: string;
  assignmentUsers: AdminUser[];
  assignmentUsersPage: number;
  assignmentUsersTotalPages: number;
  assignmentUserSortBy: AssignmentUserSortBy;
  assignmentUserSortDir: SortDirection;
  selectedUserId: string;
  selectedUser: AdminUser | null;
  accessLoading: boolean;
  bulkLoading: boolean;
  selectedGrantIds: string[];
  selectedRevokeIds: string[];
  allGrantIds: string[];
  allRevokeIds: string[];
  assignmentBanks: AdminBank[];
  assignmentBanksQuery: string;
  assignmentBanksPage: number;
  assignmentBanksTotalPages: number;
  assignmentBankSortBy: AssignmentBankSortBy;
  assignmentBankSortDir: SortDirection;
  selectedBankIds: Set<string>;
  grantedBankIds: Set<string>;
  banksLoading: boolean;
  onUsersQueryChange: (value: string) => void;
  onRefreshUsers: () => void;
  onAssignmentUsersPageChange: (page: number) => void;
  onToggleAssignmentUserSort: (next: AssignmentUserSortBy) => void;
  onSelectUser: (id: string) => void;
  onGrant: (ids: string[]) => void;
  onRevoke: (ids: string[]) => void;
  onAssignmentBanksQueryChange: (value: string) => void;
  onAssignmentBanksPageChange: (page: number) => void;
  onToggleAssignmentBankSort: (next: AssignmentBankSortBy) => void;
  onToggleBankSelection: (id: string) => void;
}

interface BanksTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  banksLoading: boolean;
  banksQuery: string;
  banks: AdminBank[];
  allBanks: AdminBank[];
  bankCatalogFilter: 'all' | 'published' | 'draft' | 'coming_soon' | 'no_catalog';
  bankAccessFilter: 'all' | 'has_access' | 'no_access';
  banksPage: number;
  banksTotalPages: number;
  banksSortBy: BankSortBy;
  banksSortDir: SortDirection;
  onBanksQueryChange: (value: string) => void;
  onBankCatalogFilterChange: (value: 'all' | 'published' | 'draft' | 'coming_soon' | 'no_catalog') => void;
  onBankAccessFilterChange: (value: 'all' | 'has_access' | 'no_access') => void;
  onRefreshBanks: () => void;
  onBanksPageChange: (page: number) => void;
  onToggleBankSort: (next: BankSortBy) => void;
  onOpenBankAccess: (bank: AdminBank) => void;
  onEditBank: (bank: AdminBank) => void;
  onDeleteBank: (bank: AdminBank) => void;
}

interface UsersTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  usersLoading: boolean;
  usersQuery: string;
  users: AdminUser[];
  allUsers: AdminUser[];
  userTierFilter: 'all' | 'free' | 'pro' | 'pro_max' | 'admin';
  userStatusFilter: 'all' | 'active' | 'banned' | 'never_signed_in';
  usersPage: number;
  usersTotalPages: number;
  usersSortBy: UserSortBy;
  usersSortDir: SortDirection;
  onUsersQueryChange: (value: string) => void;
  onUserTierFilterChange: (value: 'all' | 'free' | 'pro' | 'pro_max' | 'admin') => void;
  onUserStatusFilterChange: (value: 'all' | 'active' | 'banned' | 'never_signed_in') => void;
  onRefreshUsers: () => void;
  onUsersPageChange: (page: number) => void;
  onToggleUserSort: (next: UserSortBy) => void;
  onOpenCreateUser: () => void;
  onOpenUserDetails: (user: AdminUser) => void;
}

interface ActiveTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  cardClass: string;
  activeLoading: boolean;
  activeCounts: { activeUsers: number; activeSessions: number; activeTodayUsers: number };
  activeUsersRows: ActiveSessionRow[];
  activeTodayUsersRows: ActiveSessionRow[];
  activePage: number;
  activeTotalPages: number;
  activeTodayPage: number;
  activeTodayTotalPages: number;
  activeSortBy: ActiveSortBy;
  activeSortDir: SortDirection;
  onRefreshActive: () => void;
  onActivePageChange: (page: number) => void;
  onActiveTodayPageChange: (page: number) => void;
  onToggleActiveSort: (next: ActiveSortBy) => void;
}

interface ActivityTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  cardClass: string;
  activityLoading: boolean;
  activityRows: AdminActivityRow[];
  activityPage: number;
  activityTotalPages: number;
  activitySummary: { successBankExport: number; successBankImport: number };
  activitySearch: string;
  activitySortBy: ActivitySortBy;
  activitySortDir: SortDirection;
  activityStatusFilter: 'all' | 'success' | 'failed';
  activityCategoryFilter: 'all' | 'bank_export' | 'backup_recovery';
  activityPhaseFilter: 'all' | 'requested' | 'local_export' | 'remote_upload' | 'backup_export' | 'backup_restore' | 'media_recovery';
  activityUploadResultFilter: 'all' | 'duplicate_no_change';
  expandedActivityId: number | null;
  otherActivityLoading: boolean;
  otherActivityRows: AdminActivityRow[];
  otherActivityPage: number;
  otherActivityTotalPages: number;
  otherActivitySearch: string;
  otherActivitySortBy: ActivitySortBy;
  otherActivitySortDir: SortDirection;
  otherActivityStatusFilter: 'all' | 'success' | 'failed';
  getActivityMeta: (row: AdminActivityRow) => Record<string, unknown>;
  getActivityPadNames: (row: AdminActivityRow) => string[];
  onActivityPageChange: (page: number) => void;
  onActivitySearchChange: (value: string) => void;
  onToggleActivitySort: (next: ActivitySortBy) => void;
  onActivityStatusFilterChange: (value: 'all' | 'success' | 'failed') => void;
  onActivityCategoryFilterChange: (value: 'all' | 'bank_export' | 'backup_recovery') => void;
  onActivityPhaseFilterChange: (value: 'all' | 'requested' | 'local_export' | 'remote_upload' | 'backup_export' | 'backup_restore' | 'media_recovery') => void;
  onActivityUploadResultFilterChange: (value: 'all' | 'duplicate_no_change') => void;
  onToggleExpandedActivity: (id: number) => void;
  onRefreshActivity: () => void;
  onOtherActivityPageChange: (page: number) => void;
  onOtherActivitySearchChange: (value: string) => void;
  onToggleOtherActivitySort: (next: ActivitySortBy) => void;
  onOtherActivityStatusFilterChange: (value: 'all' | 'success' | 'failed') => void;
  onRefreshOtherActivity: () => void;
}

interface AdminAccessAppTabsProps {
  tab: TabKey;
  home: HomeTabProps;
  assignments: AssignmentsTabProps;
  banks: BanksTabProps;
  users: UsersTabProps;
  active: ActiveTabProps;
  activity: ActivityTabProps;
}

const DESKTOP_FILL_CLASS = 'min-h-0';
const DESKTOP_FLEX_PANEL_CLASS = 'min-h-0';
const DESKTOP_SCROLL_REGION_CLASS = 'min-h-0';
const DESKTOP_SECTION_CARD_CLASS = 'min-h-0';
const TABLE_SHELL_CLASS = 'border rounded overflow-hidden';
const TABLE_CONTAINER_CLASS = 'overflow-x-auto';

const truncateAdminStatText = (value: string | null | undefined, maxLength = 28): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return '-';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

function HomeTab({
  theme,
  panelClass,
  cardClass,
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
  onHomeFromDateChange,
  onHomeToDateChange,
  onApplyPresetRange,
  onRefresh,
  onOpenAccountRequests,
  onOpenStoreRequests,
  formatMoney,
}: HomeTabProps) {
  const selectedRangeStats = React.useMemo(() => {
    return homeTrends.reduce((acc, point) => {
      acc.storeRevenue += Number(point.storeRevenueApproved || 0);
      acc.accountRevenue += Number(point.accountRevenueApproved || 0);
      acc.installerRevenue += Number(point.installerRevenueApproved || 0);
      acc.totalRevenue += Number(point.totalRevenueApproved || 0);
      acc.storeBuyers += Number(point.storeBuyersApproved || 0);
      acc.accountBuyers += Number(point.accountBuyersApproved || 0);
      acc.installerSales += Number(point.installerSalesApproved || 0);
      acc.importRequests += Number(point.importRequests || 0);
      acc.exportSuccess += Number(point.exportSuccess || 0);
      acc.exportFailed += Number(point.exportFailed || 0);
      acc.authSuccess += Number(point.authSuccess || 0);
      acc.authFailed += Number(point.authFailed || 0);
      acc.importTotal += Number(point.importTotal || 0);
      return acc;
    }, {
      storeRevenue: 0,
      accountRevenue: 0,
      installerRevenue: 0,
      totalRevenue: 0,
      storeBuyers: 0,
      accountBuyers: 0,
      installerSales: 0,
      importRequests: 0,
      exportSuccess: 0,
      exportFailed: 0,
      authSuccess: 0,
      authFailed: 0,
      importTotal: 0,
    });
  }, [homeTrends]);

  const isDark = theme === 'dark';
  const heroRangeMeta = React.useMemo(() => {
    const start = homeData?.meta?.rangeStartDate || homeFromDate;
    const end = homeData?.meta?.rangeEndDate || homeToDate;
    const rangeZone = homeData?.meta?.rangeTimeZone || 'Asia/Manila';
    const parseDate = (value: string) => {
      if (!value) return null;
      const parsed = new Date(`${value}T00:00:00`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate || !endDate) return rangeZone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${formatter.format(startDate)} to ${formatter.format(endDate)} - ${rangeZone}`;
  }, [homeData?.meta?.rangeEndDate, homeData?.meta?.rangeStartDate, homeData?.meta?.rangeTimeZone, homeFromDate, homeToDate]);
  const liveSnapshotCards = [
    { label: 'Revenue', value: formatMoney(Number(homeData?.counts?.totalRevenue24h || 0)), tone: 'text-yellow-500' },
    { label: 'Pending Account Requests', value: Number(homeData?.counts?.pendingAccountRequests || 0), tone: 'text-rose-500' },
    { label: 'Pending Store Requests', value: Number(homeData?.counts?.pendingStoreRequests || 0), tone: 'text-orange-500' },
    { label: 'Pending Installer Requests', value: Number(homeData?.counts?.pendingInstallerRequests || 0), tone: 'text-amber-500' },
    { label: 'Active Users', value: Number(homeData?.counts?.activeUsers || 0), tone: 'text-cyan-500' },
    { label: 'Published Catalog', value: Number(homeData?.counts?.publishedCatalog || 0), tone: 'text-emerald-500' },
  ];
  const todayCards = [
    { label: 'Active Today', value: Number(homeData?.counts?.activeTodayUsers || 0), tone: 'text-sky-500' },
    { label: 'Total User', value: Number(homeData?.counts?.totalRegisteredUsers || 0), tone: 'text-blue-500' },
    { label: 'Total Installer License', value: Number(homeData?.counts?.totalInstallerLicenses || 0), tone: 'text-red-500' },
    { label: 'Total Store Request', value: Number(homeData?.counts?.approvedStoreRequestsTotal || 0), tone: 'text-amber-500' },
    { label: 'Import Failures', value: Number(homeData?.counts?.importFailures24h || 0), tone: 'text-fuchsia-500' },
    { label: 'Imports', value: Number(homeData?.counts?.imports24h || 0), tone: 'text-indigo-500' },
  ];
  const pendingRequestsTotal = Number(homeData?.counts?.pendingAccountRequests || 0)
    + Number(homeData?.counts?.pendingStoreRequests || 0)
    + Number(homeData?.counts?.pendingInstallerRequests || 0);
  const todayRequestTotal = Number(homeData?.counts?.todayRequestTotal || 0);
  const primaryStats = [
    { label: 'Range Revenue', value: formatMoney(selectedRangeStats.totalRevenue), detail: heroRangeMeta, toneClass: 'text-emerald-500' },
    { label: 'Pending Queues', value: pendingRequestsTotal, detail: 'Account, store, installer', toneClass: 'text-amber-500' },
    { label: 'Active Today', value: Number(homeData?.counts?.activeTodayUsers || 0), detail: 'Today', toneClass: 'text-sky-500' },
    { label: 'Today Requests', value: todayRequestTotal, detail: 'Account, store, installer', toneClass: 'text-fuchsia-500' },
  ];
  const heroShellClass = isDark
    ? 'relative overflow-hidden rounded-[24px] border border-white/10 bg-[radial-gradient(110%_95%_at_90%_0%,rgba(255,20,132,0.3),transparent_48%),radial-gradient(100%_80%_at_0%_0%,rgba(74,144,255,0.22),transparent_42%),linear-gradient(180deg,rgba(18,22,33,0.98),rgba(13,16,26,0.96))] p-4 shadow-[0_28px_80px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.06)]'
    : 'relative overflow-hidden rounded-[24px] border border-slate-900/10 bg-[radial-gradient(110%_95%_at_90%_0%,rgba(255,20,132,0.12),transparent_48%),radial-gradient(100%_80%_at_0%_0%,rgba(74,144,255,0.1),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,248,255,0.96))] p-4 shadow-[0_28px_80px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.88)]';
  const heroMiniCardClass = isDark
    ? 'rounded-[16px] border border-white/8 bg-white/[0.04] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
    : 'rounded-[16px] border border-slate-900/8 bg-white/78 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]';
  const moduleShellClass = `${cardClass} relative overflow-hidden rounded-[22px] border p-4 shadow-[0_20px_48px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.75)] dark:shadow-[0_20px_48px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)]`;
  const compactMetricClass = isDark
    ? 'rounded-[16px] border border-white/8 bg-white/[0.045] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
    : 'rounded-[16px] border border-slate-900/8 bg-white/78 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]';
  const pulseStripClass = isDark
    ? 'rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
    : 'rounded-[18px] border border-slate-900/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(255,255,255,0.68))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]';
  const pulseMetricClass = isDark
    ? 'rounded-[14px] border border-white/6 bg-white/[0.04] px-3 py-2.5'
    : 'rounded-[14px] border border-slate-900/8 bg-white/76 px-3 py-2.5';
  const queueRowClass = isDark
    ? 'rounded-[14px] border border-white/8 bg-white/[0.045] px-3 py-2.5'
    : 'rounded-[14px] border border-slate-900/8 bg-white/76 px-3 py-2.5';
  const queueMetaClass = isDark
    ? 'rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/68'
    : 'rounded-full border border-slate-900/10 bg-slate-900/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600';
  const footerPillClass = isDark
    ? 'rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1'
    : 'rounded-full border border-slate-900/10 bg-white/72 px-2.5 py-1';
  const skeletonBlockClass = isDark ? 'bg-white/10' : 'bg-slate-900/8';
  const rangeBreakdownCards = [
    { label: 'Store Revenue', value: formatMoney(selectedRangeStats.storeRevenue), detail: `${selectedRangeStats.storeBuyers} buyers`, tone: 'text-emerald-500' },
    { label: 'Account Revenue', value: formatMoney(selectedRangeStats.accountRevenue), detail: `${selectedRangeStats.accountBuyers} account buyers`, tone: 'text-cyan-500' },
    { label: 'Installer Revenue', value: formatMoney(selectedRangeStats.installerRevenue), detail: `${selectedRangeStats.installerSales} installer sales`, tone: 'text-amber-500' },
    { label: 'Purchase Requests', value: selectedRangeStats.importRequests, detail: `${selectedRangeStats.importTotal} imports processed`, tone: 'text-fuchsia-500' },
  ];
  const rangePulseCards = [
    { label: 'Export Success', value: selectedRangeStats.exportSuccess, detail: 'Completed exports', tone: 'text-emerald-500' },
    { label: 'Export Failed', value: selectedRangeStats.exportFailed, detail: 'Needs review', tone: 'text-rose-500' },
    { label: 'Auth Success', value: selectedRangeStats.authSuccess, detail: 'Successful auth', tone: 'text-blue-500' },
    { label: 'Auth Failed', value: selectedRangeStats.authFailed, detail: 'Login issues', tone: 'text-amber-500' },
  ];
  const renderQueuePreview = (
    title: string,
    subtitle: string,
    rows: Array<{ id: string; title: string; meta: string }>,
    count: number,
    toneClass: string,
    actionLabel: string,
    onAction: () => void,
  ) => (
    <div className={moduleShellClass}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">{title}</div>
          <div className="mt-1 text-lg font-black tracking-tight">{count}</div>
          <div className="text-xs opacity-70">{subtitle}</div>
        </div>
        <Button size="sm" variant="outline" onClick={onAction} className="rounded-full">
          {actionLabel}
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        {rows.length > 0 ? rows.map((row) => (
          <div key={row.id} className={queueRowClass}>
            <div className="truncate text-sm font-semibold">{row.title}</div>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 shrink-0 rounded-full ${toneClass}`} />
              <div className="truncate text-xs opacity-70">{row.meta}</div>
            </div>
          </div>
        )) : (
          <div className={queueRowClass}>
            <div className="text-sm font-semibold">Queue clear</div>
            <div className="mt-1 text-xs opacity-70">No pending items right now.</div>
          </div>
        )}
      </div>
    </div>
  );
  const renderHomeLoadingSkeleton = () => (
    <div className="space-y-4">
      <div className={`rounded-[24px] border p-4 ${skeletonBlockClass}/40`}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_420px]">
          <div className="space-y-4">
            <div className={`h-5 w-40 rounded-full ${skeletonBlockClass} animate-pulse`} />
            <div className={`h-10 w-72 rounded-xl ${skeletonBlockClass} animate-pulse`} />
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className={`h-24 rounded-[18px] ${skeletonBlockClass} animate-pulse`} />
              ))}
            </div>
          </div>
          <div className={`rounded-[18px] ${skeletonBlockClass} animate-pulse`} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={`h-64 rounded-[22px] border ${skeletonBlockClass}/40`}>
            <div className="space-y-3 p-4">
              <div className={`h-4 w-32 rounded-full ${skeletonBlockClass} animate-pulse`} />
              <div className={`h-20 rounded-[16px] ${skeletonBlockClass} animate-pulse`} />
              <div className={`h-20 rounded-[16px] ${skeletonBlockClass} animate-pulse`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  const accountQueueRows = (homeData?.queues?.accountRequests || []).map((row) => {
    const userLabel = row.display_name || row.email || 'Unknown';
    const tierLabel = row.target_tier === 'pro_max' ? 'PRO MAX' : row.target_tier === 'pro' ? 'PRO' : 'PRO';
    return {
      id: row.id,
      title: row.request_type === 'account_upgrade' ? `Upgrade ${tierLabel}: ${userLabel}` : userLabel,
      meta: `${row.email || '-'} | ${row.payment_channel || '-'}`,
    };
  });
  const storeQueueRows = (homeData?.queues?.storeRequests || []).map((row) => ({
    id: row.id,
    title: row.user_label || 'Unknown User',
    meta: `${row.bank_name || '-'} | ${row.payment_channel || '-'}`,
  }));

  return (
    <AdminPageScaffold
      panelClass={`${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}
      title="ADMIN OVERVIEW"
      description="Revenue, queues, and activity in Manila time."
      actions={<AdminRefreshButton loading={homeLoading} onClick={onRefresh} />}
      stats={<AdminStatsStrip items={primaryStats} />}
      controls={(
        <AdminControlsBar
          left={(
            <div className="grid gap-2 md:grid-cols-[160px_160px_auto_minmax(0,1fr)] md:items-end">
              <div className="space-y-1">
                <Label>From</Label>
                <Input
                  type="date"
                  value={homeFromDate}
                  onChange={(event) => onHomeFromDateChange(event.target.value)}
                  className={`h-10 text-sm ${isDark ? 'bg-gray-800/80 border-gray-700 text-gray-100' : 'bg-white/85 border-gray-300 text-gray-900'}`}
                />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input
                  type="date"
                  value={homeToDate}
                  onChange={(event) => onHomeToDateChange(event.target.value)}
                  className={`h-10 text-sm ${isDark ? 'bg-gray-800/80 border-gray-700 text-gray-100' : 'bg-white/85 border-gray-300 text-gray-900'}`}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="success"
                className="h-10 rounded-[14px] px-4"
                onClick={onRefresh}
                disabled={homeLoading}
              >
                Apply
              </Button>
              <div className="flex flex-wrap gap-2">
                {HOME_WINDOW_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full px-3 text-xs"
                    onClick={() => onApplyPresetRange(option)}
                  >
                    {option === 1 ? 'Today' : `${option}d`}
                  </Button>
                ))}
              </div>
            </div>
          )}
          right={<div className="rounded-xl border px-3 py-2 text-xs opacity-75">{heroRangeMeta}</div>}
        />
      )}
    >
      <div className={`${DESKTOP_SCROLL_REGION_CLASS} space-y-4 pr-0 lg:pr-1`}>
        {homeError && (
          <div className={`border rounded p-3 text-sm ${theme === 'dark' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {homeError}
          </div>
        )}

        {homeLoading && !homeData ? renderHomeLoadingSkeleton() : (
          <>
            <div className={heroShellClass}>
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,rgba(255,255,255,0.16),transparent_24%,transparent_70%,rgba(255,255,255,0.08))] dark:bg-[linear-gradient(112deg,rgba(255,255,255,0.08),transparent_24%,transparent_70%,rgba(255,255,255,0.03))]" />
              <div className="relative grid gap-4">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={queueMetaClass}>Selected range</span>
                    {homeData?.meta?.sampled ? <span className={queueMetaClass}>Sampled</span> : null}
                  </div>
                  <div>
                    <div className={`text-[11px] font-black uppercase tracking-[0.22em] ${isDark ? 'text-white/58' : 'text-slate-500'}`}>Operational focus</div>
                    <div className="mt-2 text-2xl font-black tracking-tight sm:text-[2.35rem]">Revenue and activity overview</div>
                    <div className={`mt-2 text-sm font-medium ${isDark ? 'text-white/62' : 'text-slate-600'}`}>{heroRangeMeta}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {rangeBreakdownCards.map((card) => (
                      <div key={card.label} className={heroMiniCardClass}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-65">{card.label}</div>
                        <div className={`mt-2 text-xl font-black tracking-tight ${card.tone}`}>{card.value}</div>
                        <div className="mt-1 text-[11px] opacity-70">{card.detail}</div>
                      </div>
                    ))}
                  </div>
                  <div className={pulseStripClass}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Range Pulse</div>
                      <div className="text-[11px] opacity-65">Exports and auth health</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
                      {rangePulseCards.map((card) => (
                        <div key={card.label} className={pulseMetricClass}>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">{card.label}</div>
                          <div className={`mt-1.5 text-lg font-black tracking-tight ${card.tone}`}>{card.value}</div>
                          <div className="mt-1 text-[11px] opacity-65">{card.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.95fr)]">
              <div className={moduleShellClass}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
                <div className="relative">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">Live Snapshot</div>
                  <div className="mt-1 text-lg font-black tracking-tight">Current queues and store state</div>
                  <div className="text-xs opacity-70">Always live. Not tied to the selected range.</div>
                  <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {liveSnapshotCards.map((card) => (
                      <div key={card.label} className={compactMetricClass}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-65">{card.label}</div>
                        <div className={`mt-2 text-xl font-black tracking-tight ${card.tone}`}>{card.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={moduleShellClass}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
                <div className="relative">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">Today</div>
                  <div className="mt-1 text-lg font-black tracking-tight">Midnight to 11:59 PM Manila</div>
                  <div className="text-xs opacity-70">Today-only totals for activity, imports, and approvals.</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {todayCards.map((card) => (
                      <div key={card.label} className={compactMetricClass}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-65">{card.label}</div>
                        <div className={`mt-2 text-xl font-black tracking-tight ${card.tone}`}>{card.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {renderQueuePreview(
                'Account Queue',
                `${Number(homeData?.counts?.pendingAccountRequests || 0)} pending account requests`,
                accountQueueRows,
                Number(homeData?.counts?.pendingAccountRequests || 0),
                'bg-rose-400',
                'Open Account Requests',
                onOpenAccountRequests,
              )}
              {renderQueuePreview(
                'Store Queue',
                `${Number(homeData?.counts?.pendingStoreRequests || 0)} pending store requests`,
                (homeData?.queues?.storeRequests || []).map((row) => ({
                  id: row.id,
                  title: row.user_label || 'Unknown User',
                  meta: `${row.bank_name || '-'} | ${row.payment_channel || '-'}`,
                })),
                Number(homeData?.counts?.pendingStoreRequests || 0),
                'bg-amber-400',
                'Open Store Requests',
                onOpenStoreRequests,
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className={moduleShellClass}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
                <div className="relative flex h-full flex-col">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">Revenue Trend</div>
                  <div className="mt-1 text-lg font-black tracking-tight">Selected revenue movement</div>
                  <div className="mb-3 text-xs opacity-70">{heroRangeMeta}</div>
                  <RevenueAdvancedChart rows={homeTrends} theme={theme} formatMoney={formatMoney} />
                </div>
              </div>
              <div className={moduleShellClass}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
                <div className="relative flex h-full flex-col">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">Buyer and Import Trend</div>
                  <div className="mt-1 text-lg font-black tracking-tight">Store, account, and installer flow</div>
                  <div className="mb-3 text-xs opacity-70">{heroRangeMeta}</div>
                  <MiniGroupedBarChart
                    points={homePointLabels}
                    authSuccess={homeStoreBuyersSeries}
                    authFailed={homeAccountBuyersSeries}
                    imports={homeInstallerSalesSeries}
                    seriesALabel="Store Buyers"
                    seriesBLabel="Account Buyers"
                    seriesCLabel="Installer Sales"
                    theme={theme}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className={moduleShellClass}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
                <div className="relative flex h-full flex-col">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">Active Today Trend</div>
                  <div className="mt-1 text-lg font-black tracking-tight">Heartbeat activity curve</div>
                  <div className="mb-3 text-xs opacity-70">{heroRangeMeta}</div>
                  <ActiveUsersTrendChart points={homePointLabels} activeUsers={homeActiveUsersSeries} theme={theme} />
                </div>
              </div>
              <div className={moduleShellClass}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
                <div className="relative flex h-full flex-col">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-60">Auth and Import Health</div>
                  <div className="mt-1 text-lg font-black tracking-tight">Operational reliability</div>
                  <div className="mb-3 text-xs opacity-70">{heroRangeMeta}</div>
                  <MiniGroupedBarChart
                    points={homePointLabels}
                    authSuccess={homeAuthSuccessSeries}
                    authFailed={homeAuthFailedSeries}
                    imports={homeImportSeries}
                    seriesALabel="Auth OK"
                    seriesBLabel="Auth Failed"
                    seriesCLabel="Imports"
                    theme={theme}
                  />
                </div>
              </div>
            </div>
          </>
        )}

      {homeData?.meta?.sampled ? (
        <div className="pt-2 text-[11px] opacity-70">
          <div className="flex flex-wrap gap-2">
            <span className={footerPillClass}>Sampled at cap {homeData?.meta?.seriesCap || 0}</span>
          </div>
        </div>
      ) : null}
      </div>
    </AdminPageScaffold>
  );
}

function AssignmentsTab({
  theme,
  cardClass,
  usersLoading,
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
  assignmentBanksQuery,
  assignmentBanksPage,
  assignmentBanksTotalPages,
  assignmentBankSortBy,
  assignmentBankSortDir,
  selectedBankIds,
  grantedBankIds,
  banksLoading,
  onUsersQueryChange,
  onRefreshUsers,
  onAssignmentUsersPageChange,
  onToggleAssignmentUserSort,
  onSelectUser,
  onGrant,
  onRevoke,
  onAssignmentBanksQueryChange,
  onAssignmentBanksPageChange,
  onToggleAssignmentBankSort,
  onToggleBankSelection,
}: AssignmentsTabProps) {
  const [pendingRevokeIds, setPendingRevokeIds] = React.useState<string[] | null>(null);
  const [pendingGrantAllIds, setPendingGrantAllIds] = React.useState<string[] | null>(null);
  const requestRevoke = (ids: string[]) => {
    if (ids.length === 0) return;
    setPendingRevokeIds(ids);
  };
  const requestGrantAll = (ids: string[]) => {
    if (ids.length === 0) return;
    setPendingGrantAllIds(ids);
  };

  return (
    <AdminPageScaffold
      panelClass={cardClass}
      title="Assignments"
      description="Grant and revoke bank access by selecting a user, then applying changes against the official bank list."
      actions={<AdminRefreshButton loading={usersLoading} label="Refresh" onClick={onRefreshUsers} />}
    >
    <div className={`grid grid-cols-1 gap-3 lg:grid-cols-2 ${DESKTOP_FILL_CLASS} lg:overflow-hidden`}>
      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="flex items-center justify-between">
          <Label>Select User</Label>
          <AdminActionCluster>
            <Button size="sm" variant={assignmentUserSortBy === 'created_at' ? 'secondary' : 'outline'} onClick={() => onToggleAssignmentUserSort('created_at')}>
              Newest
            </Button>
          </AdminActionCluster>
        </div>
        <Input value={usersQuery} onChange={(event) => onUsersQueryChange(event.target.value)} placeholder="Search users..." onKeyDown={(event) => event.key === 'Enter' && onRefreshUsers()} className="h-9 text-sm" />
        <div className={TABLE_SHELL_CLASS}>
          <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[680px] block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead><SortHeader title="User" active={assignmentUserSortBy === 'display_name'} direction={assignmentUserSortDir} onClick={() => onToggleAssignmentUserSort('display_name')} /></TableHead>
                <TableHead><SortHeader title="Email" active={assignmentUserSortBy === 'email'} direction={assignmentUserSortDir} onClick={() => onToggleAssignmentUserSort('email')} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group space-y-1 md:space-y-0 p-1 md:p-0">
              {assignmentUsers.map((user) => (
                <TableRow key={user.id} className={`flex flex-col md:table-row cursor-pointer rounded md:rounded-none border md:border-none p-2 md:p-0 ${selectedUserId === user.id ? (theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100') : ''}`} onClick={() => onSelectUser(user.id)}>
                  <TableCell className="block md:table-cell font-medium max-w-[220px] border-none md:border-b pb-0 md:pb-4" title={user.display_name}>
                    <div className="flex items-center gap-2">
                      <span className="truncate">{user.display_name}</span>
                      {user.role === 'admin' ? (
                        <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                          Admin
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="block md:table-cell text-xs opacity-70 max-w-[220px] border-none md:border-b pt-0 md:pt-4">
                    <CopyableValue
                      value={user.email || '-'}
                      label="user email"
                      className="max-w-full"
                      valueClassName="block max-w-full truncate text-inherit"
                      buttonClassName="h-5 w-5"
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!usersLoading && assignmentUsers.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={2} className="block md:table-cell text-center py-3 opacity-70">No users</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <Pagination page={assignmentUsersPage} totalPages={assignmentUsersTotalPages} onPageChange={onAssignmentUsersPageChange} />
      </div>

      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="text-sm">
          <div className="font-medium">Bank Access</div>
          <div className="text-xs opacity-70">
            {accessLoading ? 'Loading access...' : selectedUser ? `${selectedUser.display_name} (${selectedUser.email || 'no email'})` : 'Select a user first'}
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          <Input
            value={assignmentBanksQuery}
            onChange={(event) => onAssignmentBanksQueryChange(event.target.value)}
            placeholder="Search banks..."
            className="h-9 pl-9 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Button size="sm" variant="success" className="w-full rounded-[14px]" onClick={() => onGrant(selectedGrantIds)} disabled={!selectedUserId || selectedGrantIds.length === 0 || bulkLoading}>Grant Selected ({selectedGrantIds.length})</Button>
          <Button size="sm" className="w-full rounded-[14px]" variant="destructive" onClick={() => requestRevoke(selectedRevokeIds)} disabled={!selectedUserId || selectedRevokeIds.length === 0 || bulkLoading}>Revoke Selected ({selectedRevokeIds.length})</Button>
          <Button size="sm" className="w-full rounded-[14px]" variant="success" onClick={() => requestGrantAll(allGrantIds)} disabled={!selectedUserId || allGrantIds.length === 0 || bulkLoading}>Grant All ({allGrantIds.length})</Button>
          <Button size="sm" className="w-full rounded-[14px]" variant="destructive" onClick={() => requestRevoke(allRevokeIds)} disabled={!selectedUserId || allRevokeIds.length === 0 || bulkLoading}>Revoke All ({allRevokeIds.length})</Button>
        </div>
        <div className={TABLE_SHELL_CLASS}>
          <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[860px] block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead className="w-10" />
                <TableHead><SortHeader title="Bank" active={assignmentBankSortBy === 'title'} direction={assignmentBankSortDir} onClick={() => onToggleAssignmentBankSort('title')} /></TableHead>
                <TableHead><SortHeader title="Status" active={assignmentBankSortBy === 'status'} direction={assignmentBankSortDir} onClick={() => onToggleAssignmentBankSort('status')} /></TableHead>
                <TableHead><SortHeader title="Access" active={assignmentBankSortBy === 'access_count'} direction={assignmentBankSortDir} onClick={() => onToggleAssignmentBankSort('access_count')} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
              {assignmentBanks.map((bank) => {
                const granted = grantedBankIds.has(bank.id);
                const selected = selectedBankIds.has(bank.id);
                const checked = granted ? !selected : selected;
                const statusLabel = selected
                  ? (granted ? 'Selected to revoke' : 'Selected to grant')
                  : (granted ? 'Granted' : 'Not granted');
                const statusClass = selected
                  ? (granted ? 'bg-amber-500/20 text-amber-500' : 'bg-sky-500/20 text-sky-500')
                  : (granted ? 'bg-emerald-600/20 text-emerald-500' : 'bg-gray-600/20 text-gray-500');
                return (
                  <TableRow key={bank.id} className="flex flex-col md:table-row relative border rounded md:border-none p-2 md:p-0">
                    <TableCell className="absolute top-2 right-2 md:relative md:top-0 md:right-0 block md:table-cell p-0 md:p-4 border-none md:border-b"><Checkbox checked={checked} onCheckedChange={() => onToggleBankSelection(bank.id)} disabled={!selectedUserId} /></TableCell>
                    <TableCell className="block md:table-cell border-none md:border-b pb-1 md:pb-4 pr-8 md:pr-4"><div className="font-medium truncate max-w-[240px]" title={bank.title}>{bank.title}</div><div className="text-xs opacity-70 truncate max-w-[240px]" title={bank.description || ''}>{bank.description || '-'}</div></TableCell>
                    <TableCell className="block md:table-cell border-none md:border-b py-1 md:py-4"><span className={`text-xs px-2 py-1 rounded ${statusClass}`}>{statusLabel}</span></TableCell>
                    <TableCell className="block md:table-cell border-none md:border-b pt-1 md:pt-4 text-xs"><span className="md:hidden font-semibold opacity-70 mr-1">Access count:</span>{bank.access_count}</TableCell>
                  </TableRow>
                );
              })}
              {!banksLoading && assignmentBanks.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={4} className="block md:table-cell text-center py-3 opacity-70">No banks</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <Pagination page={assignmentBanksPage} totalPages={assignmentBanksTotalPages} onPageChange={onAssignmentBanksPageChange} />
      </div>
      <ConfirmationDialog
        open={Boolean(pendingRevokeIds)}
        onOpenChange={(open) => {
          if (!open) setPendingRevokeIds(null);
        }}
        title="Revoke bank access?"
        description={`This will revoke ${pendingRevokeIds?.length || 0} bank access ${pendingRevokeIds?.length === 1 ? 'grant' : 'grants'} from the selected user.`}
        confirmText="Revoke"
        variant="destructive"
        theme={theme}
        onConfirm={() => {
          const ids = pendingRevokeIds || [];
          setPendingRevokeIds(null);
          onRevoke(ids);
        }}
      />
      <ConfirmationDialog
        open={Boolean(pendingGrantAllIds)}
        onOpenChange={(open) => {
          if (!open) setPendingGrantAllIds(null);
        }}
        title="Grant all bank access?"
        description={`This will grant ${pendingGrantAllIds?.length || 0} banks to the selected user.`}
        confirmText="Grant All"
        variant="default"
        theme={theme}
        onConfirm={() => {
          const ids = pendingGrantAllIds || [];
          setPendingGrantAllIds(null);
          onGrant(ids);
        }}
      />
    </div>
    </AdminPageScaffold>
  );
}

function BanksTab({
  theme,
  panelClass,
  banksLoading,
  banksQuery,
  banks,
  allBanks,
  bankCatalogFilter,
  bankAccessFilter,
  banksPage,
  banksTotalPages,
  banksSortBy,
  banksSortDir,
  onBanksQueryChange,
  onBankCatalogFilterChange,
  onBankAccessFilterChange,
  onRefreshBanks,
  onBanksPageChange,
  onToggleBankSort,
  onOpenBankAccess,
  onEditBank,
  onDeleteBank,
}: BanksTabProps) {
  const selectClass = `h-9 rounded-md border bg-background/70 px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-900 text-gray-100' : ''}`;
  const mostAccessedBank = React.useMemo(() => (
    allBanks.reduce<AdminBank | null>((best, bank) => (!best || Number(bank.access_count || 0) > Number(best.access_count || 0) ? bank : best), null)
  ), [allBanks]);
  const latestReleasedBank = React.useMemo(() => (
    allBanks
      .filter((bank) => bank.store_catalog?.is_published || bank.store_catalog)
      .sort((left, right) => {
        const leftTime = new Date(left.created_at || left.store_catalog?.updated_at || 0).getTime();
        const rightTime = new Date(right.created_at || right.store_catalog?.updated_at || 0).getTime();
        return rightTime - leftTime;
      })[0] || null
  ), [allBanks]);
  const publishedStoreBanks = allBanks.filter((bank) => bank.store_catalog?.is_published).length;
  const protectedAssets = allBanks.filter((bank) => bank.store_catalog?.asset_protection === 'encrypted').length;
  const bankFilterCount = Number(Boolean(banksQuery.trim())) + Number(bankCatalogFilter !== 'all') + Number(bankAccessFilter !== 'all');

  return (
    <AdminPageScaffold
      panelClass={`${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}
      title="Banks"
      description="Search, inspect, edit, and manage access for the banks currently stored in the system."
      actions={<AdminRefreshButton loading={banksLoading} onClick={onRefreshBanks} />}
      stats={<AdminStatsStrip items={[
        { label: 'Most Accessed', value: mostAccessedBank?.access_count ?? 0, detail: mostAccessedBank?.title || 'No access data yet', toneClass: 'text-emerald-500' },
        {
          label: 'Latest Release',
          value: latestReleasedBank ? truncateAdminStatText(latestReleasedBank.title, 24) : '-',
          detail: latestReleasedBank ? truncateAdminStatText(latestReleasedBank.description || 'No description', 46) : 'No released store bank',
          toneClass: 'text-blue-500',
        },
        { label: 'Published Store', value: publishedStoreBanks, detail: 'Live catalog banks', toneClass: 'text-fuchsia-500' },
        { label: 'Protected Assets', value: protectedAssets, detail: 'Encrypted catalog files', toneClass: 'text-amber-500' },
      ]} />}
      controls={(
        <AdminToolbar
          search={{
            value: banksQuery,
            onChange: onBanksQueryChange,
            onSubmit: onRefreshBanks,
            placeholder: 'Search title or description...',
          }}
          resultLabel={`Page ${banksPage}/${banksTotalPages}`}
          activeFilterCount={bankFilterCount}
          onClearFilters={() => {
            onBanksQueryChange('');
            onBankCatalogFilterChange('all');
            onBankAccessFilterChange('all');
          }}
          primaryFilters={(
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              <select className={selectClass} value={bankCatalogFilter} onChange={(event) => onBankCatalogFilterChange(event.target.value as typeof bankCatalogFilter)}>
                <option value="all">All catalog states</option>
                <option value="published">Published</option>
                <option value="coming_soon">Coming Soon</option>
                <option value="draft">Draft</option>
                <option value="no_catalog">No catalog item</option>
              </select>
              <select className={selectClass} value={bankAccessFilter} onChange={(event) => onBankAccessFilterChange(event.target.value as typeof bankAccessFilter)}>
                <option value="all">All access states</option>
                <option value="has_access">Has access grants</option>
                <option value="no_access">No access grants</option>
              </select>
            </div>
          )}
        />
      )}
    >
      <div className={TABLE_SHELL_CLASS}>
        <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[980px] block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead>Color</TableHead>
              <TableHead><SortHeader title="Title" active={banksSortBy === 'title'} direction={banksSortDir} onClick={() => onToggleBankSort('title')} /></TableHead>
              <TableHead>Description</TableHead>
              <TableHead><SortHeader title="Created" active={banksSortBy === 'created_at'} direction={banksSortDir} onClick={() => onToggleBankSort('created_at')} /></TableHead>
              <TableHead><SortHeader title="Access" active={banksSortBy === 'access_count'} direction={banksSortDir} onClick={() => onToggleBankSort('access_count')} /></TableHead>
              <TableHead className={`text-right min-w-[92px] sticky right-0 z-10 ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
            {banks.map((bank) => (
              <TableRow key={bank.id} className="flex flex-col md:table-row border border-gray-200 dark:border-gray-800 rounded-lg md:rounded-none md:border-none p-3 md:p-0">
                <TableCell className="hidden md:table-cell"><span className="inline-block w-5 h-5 rounded border" style={{ backgroundColor: bank.color || '#3b82f6' }} /></TableCell>
                <TableCell className="block md:table-cell pb-1 md:pb-4 font-medium border-none md:border-b">
                  <div className="flex items-center gap-2">
                    <span className="md:hidden inline-block w-4 h-4 rounded-full border shrink-0" style={{ backgroundColor: bank.color || '#3b82f6' }} />
                    {bank.title}
                  </div>
                </TableCell>
                <TableCell className="block md:table-cell py-1 md:py-4 text-xs opacity-70 border-none md:border-b md:max-w-[280px] truncate" title={bank.description || ''}>{bank.description || '-'}</TableCell>
                <TableCell className="hidden md:table-cell">{bank.created_at ? new Date(bank.created_at).toLocaleString() : '-'}</TableCell>
                <TableCell className="block md:table-cell py-1 md:py-4 text-xs border-none md:border-b"><span className="md:hidden font-semibold mr-1">Access count:</span>{bank.access_count}</TableCell>
                <TableCell className="flex md:table-cell justify-end gap-2 mt-2 md:mt-0 pt-3 md:pt-4 border-t border-gray-100 dark:border-gray-800 md:border-none md:border-b md:text-right md:space-x-2">
                  <Button size="sm" variant="outline" className="md:w-auto flex-1 md:flex-none" onClick={() => onOpenBankAccess(bank)}><Users className="w-4 h-4 md:mr-0 mr-1" /><span className="md:hidden text-xs">Access</span></Button>
                  <Button size="sm" variant="outline" className="md:w-auto flex-1 md:flex-none" onClick={() => onEditBank(bank)}><Edit className="w-4 h-4 md:mr-0 mr-1" /><span className="md:hidden text-xs">Edit</span></Button>
                  <Button size="sm" variant="destructive" className="md:w-auto flex-1 md:flex-none" onClick={() => onDeleteBank(bank)}><Trash2 className="w-4 h-4 md:mr-0 mr-1" /><span className="md:hidden text-xs">Delete</span></Button>
                </TableCell>
              </TableRow>
            ))}
            {!banksLoading && banks.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={6} className="block md:table-cell text-center py-3 opacity-70">No banks</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <Pagination page={banksPage} totalPages={banksTotalPages} onPageChange={onBanksPageChange} />
    </AdminPageScaffold>
  );
}

function UsersTab({
  theme,
  panelClass,
  usersLoading,
  usersQuery,
  users,
  allUsers,
  userTierFilter,
  userStatusFilter,
  usersPage,
  usersTotalPages,
  usersSortBy,
  usersSortDir,
  onUsersQueryChange,
  onUserTierFilterChange,
  onUserStatusFilterChange,
  onRefreshUsers,
  onUsersPageChange,
  onToggleUserSort,
  onOpenCreateUser,
  onOpenUserDetails,
}: UsersTabProps) {
  const selectClass = `h-9 rounded-md border bg-background/70 px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-900 text-gray-100' : ''}`;
  const proUsers = allUsers.filter((user) => (user.effective_account_tier || user.account_tier) === 'pro').length;
  const proMaxUsers = allUsers.filter((user) => (user.effective_account_tier || user.account_tier) === 'pro_max' || user.role === 'admin').length;
  const bannedUsers = allUsers.filter(isUserBanned).length;
  const recentUser = React.useMemo(() => (
    [...allUsers].sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null
  ), [allUsers]);
  const userFilterCount = Number(Boolean(usersQuery.trim())) + Number(userTierFilter !== 'all') + Number(userStatusFilter !== 'all');
  const renderAttendance = (user: AdminUser) => {
    const total = Math.max(0, Number(user.attendance_days_total || 0));
    const days7 = Math.max(0, Number(user.attendance_days_7 || 0));
    const days30 = Math.max(0, Number(user.attendance_days_30 || 0));
    return (
      <div className="leading-tight">
        <div className="text-sm font-semibold">{total} {total === 1 ? 'day' : 'days'}</div>
        <div className="text-[11px] opacity-60">7d {days7} / 30d {days30}</div>
      </div>
    );
  };

  return (
    <AdminPageScaffold
      panelClass={`${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}
      title="Users"
      description="Search users, review tier and sign-in details, and open full account edits from one list."
      actions={(
        <>
          <Button size="sm" variant="success" className="rounded-[14px]" onClick={onOpenCreateUser}><Plus className="w-4 h-4 mr-1" />Add User</Button>
          <AdminRefreshButton loading={usersLoading} onClick={onRefreshUsers} />
        </>
      )}
      stats={<AdminStatsStrip items={[
        { label: 'PRO Users', value: proUsers, detail: 'Effective PRO accounts', toneClass: 'text-blue-500' },
        { label: 'PRO MAX Users', value: proMaxUsers, detail: 'Includes admins', toneClass: 'text-fuchsia-500' },
        { label: 'Banned', value: bannedUsers, detail: 'Accounts currently blocked', toneClass: 'text-red-500' },
        {
          label: 'Latest User',
          value: recentUser ? truncateAdminStatText(recentUser.display_name || recentUser.email || 'Unnamed user', 24) : '-',
          detail: recentUser?.email || 'No email',
          toneClass: 'text-emerald-500',
        },
      ]} />}
      controls={(
        <AdminToolbar
          search={{
            value: usersQuery,
            onChange: onUsersQueryChange,
            onSubmit: onRefreshUsers,
            placeholder: 'Search name, email, id...',
          }}
          resultLabel={`Page ${usersPage}/${usersTotalPages}`}
          activeFilterCount={userFilterCount}
          onClearFilters={() => {
            onUsersQueryChange('');
            onUserTierFilterChange('all');
            onUserStatusFilterChange('all');
          }}
          primaryFilters={(
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              <select className={selectClass} value={userTierFilter} onChange={(event) => onUserTierFilterChange(event.target.value as typeof userTierFilter)}>
                <option value="all">All tiers</option>
                <option value="free">FREE</option>
                <option value="pro">PRO</option>
                <option value="pro_max">PRO MAX</option>
                <option value="admin">Admins</option>
              </select>
              <select className={selectClass} value={userStatusFilter} onChange={(event) => onUserStatusFilterChange(event.target.value as typeof userStatusFilter)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="banned">Banned</option>
                <option value="never_signed_in">Never signed in</option>
              </select>
            </div>
          )}
        />
      )}
    >
      <div className={TABLE_SHELL_CLASS}>
        <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[1220px] block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead><SortHeader title="Display Name" active={usersSortBy === 'display_name'} direction={usersSortDir} onClick={() => onToggleUserSort('display_name')} /></TableHead>
              <TableHead><SortHeader title="Email" active={usersSortBy === 'email'} direction={usersSortDir} onClick={() => onToggleUserSort('email')} /></TableHead>
              <TableHead>Tier</TableHead>
              <TableHead><SortHeader title="Created" active={usersSortBy === 'created_at'} direction={usersSortDir} onClick={() => onToggleUserSort('created_at')} /></TableHead>
              <TableHead><SortHeader title="Last Sign-In" active={usersSortBy === 'last_sign_in_at'} direction={usersSortDir} onClick={() => onToggleUserSort('last_sign_in_at')} /></TableHead>
              <TableHead><SortHeader title="Attendance" active={usersSortBy === 'attendance_days_total'} direction={usersSortDir} onClick={() => onToggleUserSort('attendance_days_total')} /></TableHead>
              <TableHead><SortHeader title="Last Device" active={usersSortBy === 'last_sign_in_device_name'} direction={usersSortDir} onClick={() => onToggleUserSort('last_sign_in_device_name')} /></TableHead>
              <TableHead><SortHeader title="Platform" active={usersSortBy === 'last_sign_in_platform'} direction={usersSortDir} onClick={() => onToggleUserSort('last_sign_in_platform')} /></TableHead>
              <TableHead><SortHeader title="Last Version" active={usersSortBy === 'last_sign_in_app_version'} direction={usersSortDir} onClick={() => onToggleUserSort('last_sign_in_app_version')} /></TableHead>
              <TableHead><SortHeader title="Ban Status" active={usersSortBy === 'ban_status'} direction={usersSortDir} onClick={() => onToggleUserSort('ban_status')} /></TableHead>
              <TableHead className={`text-right min-w-[92px] sticky right-0 z-10 ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
            {users.map((user) => (
              <TableRow key={user.id} className="flex flex-col md:table-row border border-gray-200 dark:border-gray-800 rounded-lg md:rounded-none md:border-none p-3 md:p-0 relative">
                <TableCell className="block md:table-cell pb-1 md:pb-4 font-medium text-base truncate pr-16 border-none md:border-b">{user.display_name}</TableCell>
                <TableCell className="block md:table-cell py-1 md:py-4 text-xs opacity-70 border-none md:border-b">
                  <span className="md:hidden font-semibold">Email: </span>
                  <CopyableValue
                    value={user.email || '-'}
                    label="user email"
                    className="max-w-full"
                    valueClassName="inline-block max-w-[220px] truncate text-inherit align-middle"
                    buttonClassName="h-5 w-5"
                  />
                </TableCell>
                <TableCell className="block md:table-cell py-1 md:py-4 border-none md:border-b">
                  <span className="md:hidden font-semibold text-xs mr-2">Tier:</span>
                  <span className={`inline-flex rounded px-2 py-1 text-[11px] font-bold uppercase ${
                    (user.effective_account_tier || user.account_tier) === 'pro_max'
                      ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
                      : (user.effective_account_tier || user.account_tier) === 'pro'
                        ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-500/20 text-gray-700 dark:text-gray-300'
                  }`}>
                    {user.role === 'admin' ? 'ADMIN PRO MAX' : String(user.effective_account_tier || user.account_tier || 'free').replace('_', ' ')}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">{user.created_at ? new Date(user.created_at).toLocaleString() : '-'}</TableCell>
                <TableCell className="hidden md:table-cell">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '-'}</TableCell>
                <TableCell className="hidden md:table-cell">{renderAttendance(user)}</TableCell>
                <TableCell className="hidden md:table-cell">{user.last_sign_in_device_name || '-'}</TableCell>
                <TableCell className="hidden md:table-cell">{user.last_sign_in_platform || '-'}</TableCell>
                <TableCell className="hidden md:table-cell">{user.last_sign_in_app_version || '-'}</TableCell>
                <TableCell className="block md:hidden py-1 text-xs border-none">
                  <span className="font-semibold opacity-70">Attendance: </span>{renderAttendance(user)}
                </TableCell>
                <TableCell className="block md:hidden py-1 text-xs opacity-70 border-none">
                  <span className="font-semibold">Last Device: </span>{user.last_sign_in_device_name || '-'}
                </TableCell>
                <TableCell className="block md:hidden py-1 text-xs opacity-70 border-none">
                  <span className="font-semibold">Platform: </span>{user.last_sign_in_platform || '-'}
                </TableCell>
                <TableCell className="block md:hidden py-1 text-xs opacity-70 border-none">
                  <span className="font-semibold">Last Version: </span>{user.last_sign_in_app_version || '-'}
                </TableCell>
                <TableCell className="block md:table-cell py-1 md:py-4 border-none md:border-b">
                  <span className="md:hidden font-semibold text-xs mr-2">Status:</span>
                  <span className={`text-xs px-2 py-1 rounded ${isUserBanned(user) ? 'bg-red-600/20 text-red-500' : 'bg-emerald-600/20 text-emerald-500'}`}>{isUserBanned(user) ? 'Banned' : 'Active'}</span>
                </TableCell>
                <TableCell className={`block md:table-cell absolute top-3 right-3 md:relative md:top-0 md:right-0 md:text-right border-none md:border-b p-0 md:p-4 md:sticky ${theme === 'dark' ? 'md:bg-gray-900 bg-transparent' : 'md:bg-white bg-transparent'}`}>
                  <Button size="sm" variant="outline" onClick={() => onOpenUserDetails(user)}>Edit</Button>
                </TableCell>
              </TableRow>
            ))}
            {!usersLoading && users.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={11} className="block md:table-cell text-center py-3 opacity-70">No users</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <Pagination page={usersPage} totalPages={usersTotalPages} onPageChange={onUsersPageChange} />
    </AdminPageScaffold>
  );
}

function ActiveTab({
  panelClass,
  cardClass,
  activeLoading,
  activeCounts,
  activeUsersRows,
  activeTodayUsersRows,
  activePage,
  activeTotalPages,
  activeTodayPage,
  activeTodayTotalPages,
  activeSortBy,
  activeSortDir,
  onRefreshActive,
  onActivePageChange,
  onActiveTodayPageChange,
  onToggleActiveSort,
}: ActiveTabProps) {
  const [activeSearch, setActiveSearch] = React.useState('');
  const [activePlatformFilter, setActivePlatformFilter] = React.useState('all');
  const platformOptions = React.useMemo(() => {
    const values = new Set<string>();
    [...activeUsersRows, ...activeTodayUsersRows].forEach((row) => {
      const platform = String(row.platform || row.browser || row.os || '').trim();
      if (platform) values.add(platform);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [activeTodayUsersRows, activeUsersRows]);
  const filterActiveRows = React.useCallback((rows: ActiveSessionRow[]) => {
    const query = activeSearch.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [row.email, row.user_id, row.device_name, row.platform, row.browser, row.os].filter(Boolean).join(' ').toLowerCase();
      const platform = String(row.platform || row.browser || row.os || '').trim();
      return (!query || haystack.includes(query)) && (activePlatformFilter === 'all' || platform === activePlatformFilter);
    });
  }, [activePlatformFilter, activeSearch]);
  const filteredActiveUsersRows = React.useMemo(() => filterActiveRows(activeUsersRows), [activeUsersRows, filterActiveRows]);
  const filteredActiveTodayRows = React.useMemo(() => filterActiveRows(activeTodayUsersRows), [activeTodayUsersRows, filterActiveRows]);
  const activeFilterCount = Number(Boolean(activeSearch.trim())) + Number(activePlatformFilter !== 'all');
  const renderAttendanceSummary = (row: ActiveSessionRow) => {
    const days7 = Math.max(0, Number(row.attendance_days_7 || 0));
    const days30 = Math.max(0, Number(row.attendance_days_30 || 0));
    const daysTotal = Math.max(0, Number(row.attendance_days_total || 0));
    const heartbeatsToday = Math.max(0, Number(row.today_heartbeat_count || 0));
    if (days7 === 0 && days30 === 0 && daysTotal === 0 && heartbeatsToday === 0) return <span className="opacity-60">-</span>;
    return (
      <div className="space-y-0.5">
        <div className="text-xs font-black">{daysTotal} day{daysTotal === 1 ? '' : 's'} total</div>
        <div className="text-[11px] opacity-70">{days7} in 7d / {days30} in 30d</div>
        <div className="text-[11px] opacity-70">{heartbeatsToday} heartbeat{heartbeatsToday === 1 ? '' : 's'} today</div>
      </div>
    );
  };
  const renderActiveRows = (
    rows: ActiveSessionRow[],
    emptyLabel: string,
    accentClass: string,
  ) => (
    <div className={TABLE_SHELL_CLASS}>
      <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[1120px] block md:table">
        <TableHeader className="hidden md:table-header-group">
          <TableRow>
            <TableHead><SortHeader title="User" active={activeSortBy === 'user_id'} direction={activeSortDir} onClick={() => onToggleActiveSort('user_id')} /></TableHead>
            <TableHead><SortHeader title="Email" active={activeSortBy === 'email'} direction={activeSortDir} onClick={() => onToggleActiveSort('email')} /></TableHead>
            <TableHead><SortHeader title="Device" active={activeSortBy === 'device_name'} direction={activeSortDir} onClick={() => onToggleActiveSort('device_name')} /></TableHead>
            <TableHead><SortHeader title="Platform" active={activeSortBy === 'platform'} direction={activeSortDir} onClick={() => onToggleActiveSort('platform')} /></TableHead>
            <TableHead>Attendance</TableHead>
            <TableHead><SortHeader title="Last Seen" active={activeSortBy === 'last_seen_at'} direction={activeSortDir} onClick={() => onToggleActiveSort('last_seen_at')} /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
          {rows.map((row) => (
            <TableRow key={`${row.user_id}-${row.session_key}-${row.last_seen_at}`} className="flex flex-col md:table-row border border-gray-200 dark:border-gray-800 rounded-lg md:rounded-none md:border-none p-3 md:p-0">
              <TableCell className="block md:table-cell font-mono text-xs border-none md:border-b pb-1 md:pb-4"><span className="md:hidden font-semibold font-sans">ID: </span>{row.user_id.slice(0, 8)}...</TableCell>
              <TableCell className="block md:table-cell font-medium border-none md:border-b py-0 md:py-4">
                <CopyableValue
                  value={row.email || '-'}
                  label="active session email"
                  className="max-w-full"
                  valueClassName="block max-w-[220px] truncate text-inherit"
                  buttonClassName="h-5 w-5"
                />
              </TableCell>
              <TableCell className="block md:table-cell text-xs opacity-70 border-none md:border-b py-0 md:py-4"><span className="md:hidden font-semibold opacity-100">Device: </span>{row.device_name || '-'}</TableCell>
              <TableCell className="block md:table-cell text-xs opacity-70 border-none md:border-b py-0 md:py-4">{[row.platform, row.browser, row.os].filter(Boolean).join(' / ') || '-'}</TableCell>
              <TableCell className="block md:table-cell text-xs border-none md:border-b py-1 md:py-4"><span className="md:hidden font-semibold text-gray-500 dark:text-gray-400 mr-1">Attendance: </span>{renderAttendanceSummary(row)}</TableCell>
              <TableCell className={`block md:table-cell text-xs font-medium border-none md:border-b pt-1 md:pt-4 ${accentClass}`}><span className="md:hidden font-semibold text-gray-500 dark:text-gray-400 mr-1">Last seen: </span>{new Date(row.last_seen_at).toLocaleString()}</TableCell>
            </TableRow>
          ))}
          {!activeLoading && rows.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={6} className="block md:table-cell text-center py-3 opacity-70">{emptyLabel}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );

  return (
      <AdminPageScaffold
        panelClass={`${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}
        title="Active Users"
        description="Monitor current live sessions and daily attendance."
        actions={<AdminRefreshButton loading={activeLoading} onClick={onRefreshActive} />}
        stats={(
          <AdminStatsStrip
            items={[
              { label: 'Active Users', value: activeCounts.activeUsers, detail: 'Unique live users', toneClass: 'text-cyan-500' },
              { label: 'Active Sessions', value: activeCounts.activeSessions, detail: 'Current sessions', toneClass: 'text-blue-500' },
              { label: 'Active Today', value: activeCounts.activeTodayUsers, detail: 'Today attendance', toneClass: 'text-sky-500' },
            ]}
          />
        )}
        controls={(
          <AdminToolbar
            search={{
              value: activeSearch,
              onChange: setActiveSearch,
              placeholder: 'Search active users...',
            }}
            resultLabel={`${filteredActiveUsersRows.length + filteredActiveTodayRows.length} visible`}
            activeFilterCount={activeFilterCount}
            onClearFilters={() => {
              setActiveSearch('');
              setActivePlatformFilter('all');
            }}
            primaryFilters={(
              <select className="h-9 rounded-md border bg-background/70 px-3 text-sm" value={activePlatformFilter} onChange={(event) => setActivePlatformFilter(event.target.value)}>
                <option value="all">All platforms</option>
                {platformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
              </select>
            )}
          />
        )}
      >
          <div className={`border rounded p-3 space-y-3 ${cardClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Currently Active</div>
                <div className="text-xs opacity-70">Live sessions right now, including admins for monitoring.</div>
              </div>
          </div>
          {renderActiveRows(filteredActiveUsersRows, 'No active users', 'text-cyan-600 dark:text-cyan-400')}
          <Pagination page={activePage} totalPages={activeTotalPages} onPageChange={onActivePageChange} />
        </div>

          <div className={`border rounded p-3 space-y-3 ${cardClass}`}>
            <div>
              <div className="text-sm font-semibold">Active Today</div>
              <div className="text-xs opacity-70">Unique non-admin users with attendance today, ordered by most recent activity.</div>
            </div>
            {renderActiveRows(filteredActiveTodayRows, 'No users have heartbeat activity today', 'text-sky-600 dark:text-sky-400')}
            <Pagination page={activeTodayPage} totalPages={activeTodayTotalPages} onPageChange={onActiveTodayPageChange} />
          </div>
      </AdminPageScaffold>
  );
}

function ActivityTab({
  theme,
  panelClass,
  cardClass,
  activityLoading,
  activityRows,
  activityPage,
  activityTotalPages,
  activitySummary,
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
  onActivityPageChange,
  onActivitySearchChange,
  onToggleActivitySort,
  onActivityStatusFilterChange,
  onActivityCategoryFilterChange,
  onActivityPhaseFilterChange,
  onActivityUploadResultFilterChange,
  onToggleExpandedActivity,
  onRefreshActivity,
  onOtherActivityPageChange,
  onOtherActivitySearchChange,
  onToggleOtherActivitySort,
  onOtherActivityStatusFilterChange,
  onRefreshOtherActivity,
}: ActivityTabProps) {
  const exportFilterCount = Number(activityCategoryFilter !== 'all')
    + Number(activityPhaseFilter !== 'all')
    + Number(activityStatusFilter !== 'all')
    + Number(activityUploadResultFilter !== 'all')
    + Number(Boolean(activitySearch.trim()));
  const otherFilterCount = Number(otherActivityStatusFilter !== 'all') + Number(Boolean(otherActivitySearch.trim()));

  return (
    <AdminPageScaffold
      panelClass={`${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}
      title="Activity"
      description="Review export and non-export operational activity, with filters for outcome, phase, category, and user."
      actions={(
        <AdminRefreshButton
          loading={activityLoading || otherActivityLoading}
          onClick={() => {
            onRefreshActivity();
            onRefreshOtherActivity();
          }}
        />
      )}
      stats={<AdminStatsStrip items={[
        { label: 'Success Bank Export', value: activitySummary.successBankExport, detail: 'All matching export logs', toneClass: 'text-emerald-500' },
        { label: 'Success Bank Import', value: activitySummary.successBankImport, detail: 'All matching import logs', toneClass: 'text-blue-500' },
        { label: 'Export Pages', value: `${activityPage}/${activityTotalPages}`, detail: 'Current export view', toneClass: 'text-amber-500' },
        { label: 'Other Pages', value: `${otherActivityPage}/${otherActivityTotalPages}`, detail: 'Current other activity view', toneClass: 'text-fuchsia-500' },
      ]} />}
    >
      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Export Activity</div>
            <div className="text-xs opacity-70">Page {activityPage}/{activityTotalPages} - {exportFilterCount} active filters</div>
          </div>
        </div>

        <AdminToolbar
          search={{
            value: activitySearch,
            onChange: (value) => { onActivitySearchChange(value); onActivityPageChange(1); },
            placeholder: 'Search bank, email, event...',
          }}
          resultLabel={`Page ${activityPage}/${activityTotalPages}`}
          activeFilterCount={exportFilterCount}
          onClearFilters={() => {
            onActivityCategoryFilterChange('all');
            onActivityPhaseFilterChange('all');
            onActivityStatusFilterChange('all');
            onActivityUploadResultFilterChange('all');
            onActivitySearchChange('');
            onActivityPageChange(1);
          }}
          primaryFilters={(
            <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-4">
              <select className={`h-9 rounded-md border px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`} value={activityCategoryFilter} onChange={(event) => { onActivityCategoryFilterChange(event.target.value as typeof activityCategoryFilter); onActivityPhaseFilterChange('all'); onActivityPageChange(1); }}>
                <option value="all">All Types</option>
                <option value="bank_export">Bank Export</option>
                <option value="backup_recovery">Backup / Recovery</option>
              </select>
              <select className={`h-9 rounded-md border px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`} value={activityPhaseFilter} onChange={(event) => { onActivityPhaseFilterChange(event.target.value as typeof activityPhaseFilter); onActivityPageChange(1); }}>
                <option value="all">All Export</option>
                <option value="requested">Requested</option>
                <option value="local_export">Local Export</option>
                <option value="remote_upload">Remote Upload</option>
                <option value="backup_export">Backup Export</option>
                <option value="backup_restore">Backup Restore</option>
                <option value="media_recovery">Media Recovery</option>
              </select>
              <select className={`h-9 rounded-md border px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`} value={activityStatusFilter} onChange={(event) => { onActivityStatusFilterChange(event.target.value as typeof activityStatusFilter); onActivityPageChange(1); }}>
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
              <select className={`h-9 rounded-md border px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`} value={activityUploadResultFilter} onChange={(event) => { onActivityUploadResultFilterChange(event.target.value as typeof activityUploadResultFilter); onActivityPageChange(1); }}>
                <option value="all">All Upload</option>
                <option value="duplicate_no_change">No Change</option>
              </select>
            </div>
          )}
        />

        <div className="hidden gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className={`rounded-lg border p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Category</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityCategoryFilter === 'all' ? 'default' : 'outline'} onClick={() => { onActivityCategoryFilterChange('all'); onActivityPhaseFilterChange('all'); onActivityPageChange(1); }}>All Types</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityCategoryFilter === 'bank_export' ? 'default' : 'outline'} onClick={() => { onActivityCategoryFilterChange('bank_export'); onActivityPhaseFilterChange('all'); onActivityPageChange(1); }}>Bank Export</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityCategoryFilter === 'backup_recovery' ? 'default' : 'outline'} onClick={() => { onActivityCategoryFilterChange('backup_recovery'); onActivityPhaseFilterChange('all'); onActivityPageChange(1); }}>Backup / Recovery</Button>
              </div>
            </div>

            <div className={`rounded-lg border p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Phase</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'all' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('all'); onActivityPageChange(1); }}>All Export</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'requested' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('requested'); onActivityPageChange(1); }}>Requested</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'local_export' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('local_export'); onActivityPageChange(1); }}>Local Export</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'remote_upload' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('remote_upload'); onActivityPageChange(1); }}>Remote Upload</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'backup_export' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('backup_export'); onActivityPageChange(1); }}>Backup Export</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'backup_restore' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('backup_restore'); onActivityPageChange(1); }}>Backup Restore</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityPhaseFilter === 'media_recovery' ? 'default' : 'outline'} onClick={() => { onActivityPhaseFilterChange('media_recovery'); onActivityPageChange(1); }}>Media Recovery</Button>
              </div>
            </div>

            <div className={`rounded-lg border p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Outcome</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityStatusFilter === 'all' ? 'default' : 'outline'} onClick={() => { onActivityStatusFilterChange('all'); onActivityPageChange(1); }}>All Status</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityStatusFilter === 'success' ? 'default' : 'outline'} onClick={() => { onActivityStatusFilterChange('success'); onActivityPageChange(1); }}>Success</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityStatusFilter === 'failed' ? 'default' : 'outline'} onClick={() => { onActivityStatusFilterChange('failed'); onActivityPageChange(1); }}>Failed</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityUploadResultFilter === 'all' ? 'default' : 'outline'} onClick={() => { onActivityUploadResultFilterChange('all'); onActivityPageChange(1); }}>All Upload</Button>
                <Button size="sm" className="h-9 px-3 text-xs" variant={activityUploadResultFilter === 'duplicate_no_change' ? 'default' : 'outline'} onClick={() => { onActivityUploadResultFilterChange('duplicate_no_change'); onActivityPageChange(1); }}>No Change</Button>
              </div>
            </div>
          </div>

          <div className={`rounded-lg border p-3 space-y-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Search</div>
              <div className="mt-2 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-50" />
                <Input value={activitySearch} onChange={(event) => { onActivitySearchChange(event.target.value); onActivityPageChange(1); }} placeholder="Search bank, email, event..." className={`h-9 w-full pl-8 text-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`} />
              </div>
            </div>
          </div>
        </div>

        <div className={TABLE_SHELL_CLASS}>
          <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[980px] block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead />
                <TableHead><SortHeader title="Time" active={activitySortBy === 'created_at'} direction={activitySortDir} onClick={() => onToggleActivitySort('created_at')} /></TableHead>
                <TableHead><SortHeader title="Event" active={activitySortBy === 'event_type'} direction={activitySortDir} onClick={() => onToggleActivitySort('event_type')} /></TableHead>
                <TableHead><SortHeader title="Status" active={activitySortBy === 'status'} direction={activitySortDir} onClick={() => onToggleActivitySort('status')} /></TableHead>
                <TableHead><SortHeader title="Email" active={activitySortBy === 'email'} direction={activitySortDir} onClick={() => onToggleActivitySort('email')} /></TableHead>
                <TableHead><SortHeader title="Bank" active={activitySortBy === 'bank_name'} direction={activitySortDir} onClick={() => onToggleActivitySort('bank_name')} /></TableHead>
                <TableHead>Phase</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
              {activityRows.map((row) => {
                const meta = getActivityMeta(row);
                const phase = String(meta.phase || '-');
                const padNames = getActivityPadNames(row);
                const upload = (meta.upload && typeof meta.upload === 'object' && !Array.isArray(meta.upload))
                  ? (meta.upload as Record<string, unknown>)
                  : null;
                const expanded = expandedActivityId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <TableRow className="flex flex-col md:table-row border border-gray-200 dark:border-gray-800 rounded-lg md:rounded-none md:border-none p-3 md:p-0 relative">
                      <TableCell className="absolute top-3 right-3 md:relative md:top-0 md:right-0 block md:table-cell p-0 md:p-4 border-none md:border-b">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onToggleExpandedActivity(row.id)}>
                          {expanded ? 'Hide' : 'View'}
                        </Button>
                      </TableCell>
                      <TableCell className="block md:table-cell pb-1 md:pb-4 text-xs font-medium border-none md:border-b">{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</TableCell>
                      <TableCell className="block md:table-cell py-0 md:py-4 font-semibold text-sm border-none md:border-b max-w-[200px]">{row.event_type}</TableCell>
                      <TableCell className="block md:table-cell pt-1 md:py-4 pb-2 md:pb-4 border-none md:border-b">
                        <span className={`text-xs px-2 py-1 rounded ${row.status === 'failed' ? 'bg-red-600/20 text-red-500' : 'bg-emerald-600/20 text-emerald-500'}`}>{row.status}</span>
                      </TableCell>
                      <TableCell className="block md:table-cell py-1 md:py-4 text-sm max-w-[220px] border-none md:border-b">
                        <span className="md:hidden font-semibold mr-1 text-xs opacity-70">User:</span>
                        <CopyableValue
                          value={row.email || row.display_name || '-'}
                          label="activity user"
                          className="max-w-full"
                          valueClassName="inline-block max-w-[180px] truncate text-inherit align-middle"
                          buttonClassName="h-5 w-5"
                        />
                      </TableCell>
                      <TableCell className="block md:table-cell py-1 md:py-4 text-sm max-w-[180px] truncate border-none md:border-b" title={row.bank_name || ''}><span className="md:hidden font-semibold mr-1 text-xs opacity-70">Bank:</span>{row.bank_name || '-'}</TableCell>
                      <TableCell className="block md:table-cell pt-1 md:pt-4 text-sm border-none md:border-b"><span className="md:hidden font-semibold mr-1 text-xs opacity-70">Phase:</span>{phase}</TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="block md:table-row border border-t-0 border-gray-200 dark:border-gray-800 rounded-b-lg md:rounded-none md:border-none">
                        <TableCell colSpan={7} className={`block md:table-cell rounded-b-lg md:rounded-none p-3 md:p-4 border-none md:border-b ${theme === 'dark' ? 'bg-gray-900/40 md:bg-gray-900/40' : 'bg-gray-50 md:bg-gray-50'}`}>
                          <div className="space-y-2 py-1 text-xs">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div><span className="opacity-70">Export Operation:</span> <span className="font-mono">{String(meta.exportOperationId || '-')}</span></div>
                              <div><span className="opacity-70">User:</span> {row.display_name || row.user_id || '-'}</div>
                              <div><span className="opacity-70">Pad Count:</span> {row.pad_count ?? padNames.length}</div>
                              <div><span className="opacity-70">Stage:</span> {String(meta.stage || '-')}</div>
                              <div><span className="opacity-70">Error:</span> {row.error_message || '-'}</div>
                            </div>
                            {upload && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div><span className="opacity-70">Release Tag:</span> {String(upload.releaseTag || '-')}</div>
                                <div><span className="opacity-70">Asset:</span> {String(upload.assetName || '-')}</div>
                                <div><span className="opacity-70">Attempt:</span> {String(upload.attempt || '-')}</div>
                                <div><span className="opacity-70">Result:</span> {String(upload.result || '-')}</div>
                              </div>
                            )}
                            <div>
                              <div className="opacity-70 mb-1">Export Pad List</div>
                              {padNames.length === 0 ? (
                                <div className="opacity-60">No pad names captured for this event.</div>
                              ) : (
                                <div className={`max-h-44 overflow-auto rounded border p-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-white'}`}>
                                  {padNames.map((padName, index) => (
                                    <div key={`${row.id}-${index}`} className="leading-5">{index + 1}. {padName}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
              {!activityLoading && activityRows.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={7} className="block md:table-cell text-center py-3 opacity-70">No export activity found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <Pagination page={activityPage} totalPages={activityTotalPages} onPageChange={onActivityPageChange} />
      </div>

      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Other Activity</div>
            <div className="text-xs opacity-70">Page {otherActivityPage}/{otherActivityTotalPages} - {otherFilterCount} active filters</div>
          </div>
        </div>

        <AdminToolbar
          search={{
            value: otherActivitySearch,
            onChange: (value) => { onOtherActivitySearchChange(value); onOtherActivityPageChange(1); },
            placeholder: 'Search user, event, bank...',
          }}
          resultLabel={`Page ${otherActivityPage}/${otherActivityTotalPages}`}
          activeFilterCount={otherFilterCount}
          onClearFilters={() => {
            onOtherActivityStatusFilterChange('all');
            onOtherActivitySearchChange('');
            onOtherActivityPageChange(1);
          }}
          primaryFilters={(
            <select className={`h-9 rounded-md border px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`} value={otherActivityStatusFilter} onChange={(event) => { onOtherActivityStatusFilterChange(event.target.value as typeof otherActivityStatusFilter); onOtherActivityPageChange(1); }}>
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          )}
        />

        <div className="hidden gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className={`rounded-lg border p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Status</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" className="h-9 px-3 text-xs" variant={otherActivityStatusFilter === 'all' ? 'default' : 'outline'} onClick={() => { onOtherActivityStatusFilterChange('all'); onOtherActivityPageChange(1); }}>All Status</Button>
              <Button size="sm" className="h-9 px-3 text-xs" variant={otherActivityStatusFilter === 'success' ? 'default' : 'outline'} onClick={() => { onOtherActivityStatusFilterChange('success'); onOtherActivityPageChange(1); }}>Success</Button>
              <Button size="sm" className="h-9 px-3 text-xs" variant={otherActivityStatusFilter === 'failed' ? 'default' : 'outline'} onClick={() => { onOtherActivityStatusFilterChange('failed'); onOtherActivityPageChange(1); }}>Failed</Button>
            </div>
          </div>

          <div className={`rounded-lg border p-3 space-y-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/30' : 'border-gray-200 bg-gray-50'}`}>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Search</div>
              <div className="mt-2 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-50" />
                <Input value={otherActivitySearch} onChange={(event) => { onOtherActivitySearchChange(event.target.value); onOtherActivityPageChange(1); }} placeholder="Search user, event, bank..." className={`h-9 w-full pl-8 text-sm ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`} />
              </div>
            </div>
          </div>
        </div>

        <div className={TABLE_SHELL_CLASS}>
          <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[980px] block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead><SortHeader title="Time" active={otherActivitySortBy === 'created_at'} direction={otherActivitySortDir} onClick={() => onToggleOtherActivitySort('created_at')} /></TableHead>
                <TableHead><SortHeader title="Event" active={otherActivitySortBy === 'event_type'} direction={otherActivitySortDir} onClick={() => onToggleOtherActivitySort('event_type')} /></TableHead>
                <TableHead><SortHeader title="Status" active={otherActivitySortBy === 'status'} direction={otherActivitySortDir} onClick={() => onToggleOtherActivitySort('status')} /></TableHead>
                <TableHead><SortHeader title="Email" active={otherActivitySortBy === 'email'} direction={otherActivitySortDir} onClick={() => onToggleOtherActivitySort('email')} /></TableHead>
                <TableHead><SortHeader title="Bank" active={otherActivitySortBy === 'bank_name'} direction={otherActivitySortDir} onClick={() => onToggleOtherActivitySort('bank_name')} /></TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
              {otherActivityRows.map((row) => (
                <TableRow key={row.id} className="flex flex-col md:table-row border border-gray-200 dark:border-gray-800 rounded-lg md:rounded-none md:border-none p-3 md:p-0 relative">
                  <TableCell className="block md:table-cell pb-1 md:pb-4 text-xs font-medium border-none md:border-b opacity-70">{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</TableCell>
                  <TableCell className="block md:table-cell font-semibold text-sm border-none md:border-b py-0 md:py-4">{row.event_type}</TableCell>
                  <TableCell className="block md:table-cell pt-1 md:py-4 pb-2 md:pb-4 border-none md:border-b"><span className={`text-xs px-2 py-1 rounded ${row.status === 'failed' ? 'bg-red-600/20 text-red-500' : 'bg-emerald-600/20 text-emerald-500'}`}>{row.status}</span></TableCell>
                  <TableCell className="block md:table-cell py-1 md:py-4 text-sm max-w-[220px] border-none md:border-b">
                    <span className="md:hidden font-semibold mr-1 text-xs opacity-70">User:</span>
                    <CopyableValue
                      value={row.email || row.display_name || '-'}
                      label="activity user"
                      className="max-w-full"
                      valueClassName="inline-block max-w-[180px] truncate text-inherit align-middle"
                      buttonClassName="h-5 w-5"
                    />
                  </TableCell>
                  <TableCell className="block md:table-cell py-1 md:py-4 text-sm max-w-[160px] truncate border-none md:border-b" title={row.bank_name || ''}><span className="md:hidden font-semibold mr-1 text-xs opacity-70">Bank:</span>{row.bank_name || '-'}</TableCell>
                  <TableCell className={`block md:table-cell py-1 md:py-4 text-sm max-w-[300px] truncate border-none md:border-b ${row.error_message ? 'text-red-500' : ''}`} title={row.error_message || ''}><span className="md:hidden font-semibold mr-1 text-xs opacity-70">Error:</span>{row.error_message || '-'}</TableCell>
                </TableRow>
              ))}
              {!otherActivityLoading && otherActivityRows.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={6} className="block md:table-cell text-center py-3 opacity-70">No non-export activity found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <Pagination page={otherActivityPage} totalPages={otherActivityTotalPages} onPageChange={onOtherActivityPageChange} />
      </div>
    </AdminPageScaffold>
  );
}

export function AdminAccessAppTabs(props: AdminAccessAppTabsProps) {
  if (props.tab === 'home') return <HomeTab {...props.home} />;
  if (props.tab === 'assignments') return <AssignmentsTab {...props.assignments} />;
  if (props.tab === 'banks') return <BanksTab {...props.banks} />;
  if (props.tab === 'users') return <UsersTab {...props.users} />;
  if (props.tab === 'active') return <ActiveTab {...props.active} />;
  if (props.tab === 'activity') return <ActivityTab {...props.activity} />;
  return null;
}
