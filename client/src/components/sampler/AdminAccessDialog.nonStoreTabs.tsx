import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Edit, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react';
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
  ExportHealthPieChart,
  MiniGroupedBarChart,
  Pagination,
  RevenueAdvancedChart,
  SortHeader,
} from './AdminAccessDialog.widgets';

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
  homeImportRequestsSeries: number[];
  homeExportSuccessSeries: number[];
  homeExportFailedSeries: number[];
  homeAuthSuccessSeries: number[];
  homeAuthFailedSeries: number[];
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
  assignmentBankSortBy: AssignmentBankSortBy;
  assignmentBankSortDir: SortDirection;
  selectedBankIds: Set<string>;
  grantedBankIds: Set<string>;
  banksLoading: boolean;
  onUsersQueryChange: (value: string) => void;
  onRefreshUsers: () => void;
  onToggleAssignmentUserSort: (next: AssignmentUserSortBy) => void;
  onSelectUser: (id: string) => void;
  onGrant: (ids: string[]) => void;
  onRevoke: (ids: string[]) => void;
  onToggleAssignmentBankSort: (next: AssignmentBankSortBy) => void;
  onToggleBankSelection: (id: string) => void;
}

interface BanksTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  banksLoading: boolean;
  banksQuery: string;
  banks: AdminBank[];
  banksSortBy: BankSortBy;
  banksSortDir: SortDirection;
  onBanksQueryChange: (value: string) => void;
  onRefreshBanks: () => void;
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
  usersSortBy: UserSortBy;
  usersSortDir: SortDirection;
  onUsersQueryChange: (value: string) => void;
  onRefreshUsers: () => void;
  onToggleUserSort: (next: UserSortBy) => void;
  onOpenCreateUser: () => void;
  onOpenUserDetails: (user: AdminUser) => void;
}

interface ActiveTabProps {
  theme: AdminDialogTheme;
  panelClass: string;
  cardClass: string;
  titleClass: string;
  activeLoading: boolean;
  activeCounts: { activeUsers: number; activeSessions: number };
  activeUsersRows: ActiveSessionRow[];
  activeSortBy: ActiveSortBy;
  activeSortDir: SortDirection;
  onRefreshActive: () => void;
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

interface AdminAccessNonStoreTabsProps {
  tab: TabKey;
  home: HomeTabProps;
  assignments: AssignmentsTabProps;
  banks: BanksTabProps;
  users: UsersTabProps;
  active: ActiveTabProps;
  activity: ActivityTabProps;
}

const DESKTOP_FILL_CLASS = 'overflow-visible lg:h-full lg:min-h-0';
const DESKTOP_FLEX_PANEL_CLASS = 'overflow-visible lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden';
const DESKTOP_SCROLL_REGION_CLASS = 'overflow-visible lg:flex-1 lg:min-h-0 lg:overflow-auto';
const DESKTOP_SECTION_CARD_CLASS = 'overflow-visible lg:min-h-0 lg:flex lg:flex-col';
const TABLE_SHELL_CLASS = 'border rounded overflow-hidden lg:flex-1 lg:min-h-0 lg:overflow-hidden';
const TABLE_CONTAINER_CLASS = 'overflow-x-auto lg:h-full lg:overflow-auto';

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
  homeImportRequestsSeries,
  homeExportSuccessSeries,
  homeExportFailedSeries,
  homeAuthSuccessSeries,
  homeAuthFailedSeries,
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
      acc.totalRevenue += Number(point.totalRevenueApproved || 0);
      acc.storeBuyers += Number(point.storeBuyersApproved || 0);
      acc.accountBuyers += Number(point.accountBuyersApproved || 0);
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
      totalRevenue: 0,
      storeBuyers: 0,
      accountBuyers: 0,
      importRequests: 0,
      exportSuccess: 0,
      exportFailed: 0,
      authSuccess: 0,
      authFailed: 0,
      importTotal: 0,
    });
  }, [homeTrends]);

  const liveSnapshotCards = [
    { label: 'Pending Account Requests', value: Number(homeData?.counts?.pendingAccountRequests || 0), tone: 'text-rose-500' },
    { label: 'Pending Store Requests', value: Number(homeData?.counts?.pendingStoreRequests || 0), tone: 'text-orange-500' },
    { label: 'Active Users', value: Number(homeData?.counts?.activeUsers || 0), tone: 'text-cyan-500' },
    { label: 'Active Sessions', value: Number(homeData?.counts?.activeSessions || 0), tone: 'text-sky-500' },
    { label: 'Published Catalog', value: Number(homeData?.counts?.publishedCatalog || 0), tone: 'text-emerald-500' },
    { label: 'Draft Catalog', value: Number(homeData?.counts?.draftCatalog || 0), tone: 'text-slate-500' },
  ];

  const rolling24hCards = [
    { label: 'Revenue (24h)', value: formatMoney(Number(homeData?.counts?.totalRevenue24h || 0)), tone: 'text-yellow-500' },
    { label: 'Exports (24h)', value: Number(homeData?.counts?.exports24h || 0), tone: 'text-blue-500' },
    { label: 'Export Failures (24h)', value: Number(homeData?.counts?.exportFailures24h || 0), tone: 'text-red-500' },
    { label: 'No Change Uploads (24h)', value: Number(homeData?.counts?.duplicateNoChange24h || 0), tone: 'text-amber-500' },
    { label: 'Auth Failures (24h)', value: Number(homeData?.counts?.authFailures24h || 0), tone: 'text-fuchsia-500' },
    { label: 'Imports (24h)', value: Number(homeData?.counts?.imports24h || 0), tone: 'text-indigo-500' },
  ];

  return (
    <div className={`border rounded p-3 ${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="text-sm font-semibold">Admin Overview</div>
          <div className="text-xs opacity-70">Selected range: {homeRangeLabel}</div>
        </div>
        <Input
          type="date"
          value={homeFromDate}
          onChange={(event) => onHomeFromDateChange(event.target.value)}
          className={`h-8 w-[142px] text-xs ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
        />
        <Input
          type="date"
          value={homeToDate}
          onChange={(event) => onHomeToDateChange(event.target.value)}
          className={`h-8 w-[142px] text-xs ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
        />
        <div className="flex flex-wrap gap-1">
          {HOME_WINDOW_OPTIONS.map((option) => (
            <Button key={option} type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => onApplyPresetRange(option)}>
              {option}d
            </Button>
          ))}
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={homeLoading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${homeLoading ? 'animate-spin' : ''}`} />
          Apply
        </Button>
      </div>

      <div className={`${DESKTOP_SCROLL_REGION_CLASS} space-y-3 pr-0 lg:pr-1`}>
        {homeError && (
          <div className={`border rounded p-3 text-sm ${theme === 'dark' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {homeError}
          </div>
        )}

        <div className={`border rounded p-3 space-y-2 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Selected Range</div>
              <div className="text-xs opacity-70">These cards change with the date range above.</div>
            </div>
            <div className="text-[11px] opacity-70">{homeData?.meta?.timeBasis || 'UTC'}</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: 'Revenue', value: formatMoney(selectedRangeStats.totalRevenue), tone: 'text-emerald-500' },
              { label: 'Store Revenue', value: formatMoney(selectedRangeStats.storeRevenue), tone: 'text-green-500' },
              { label: 'Account Revenue', value: formatMoney(selectedRangeStats.accountRevenue), tone: 'text-lime-500' },
              { label: 'Store Buyers', value: selectedRangeStats.storeBuyers, tone: 'text-cyan-500' },
              { label: 'Account Buyers', value: selectedRangeStats.accountBuyers, tone: 'text-sky-500' },
              { label: 'Purchase Requests', value: selectedRangeStats.importRequests, tone: 'text-orange-500' },
              { label: 'Exports', value: selectedRangeStats.exportSuccess, tone: 'text-blue-500' },
              { label: 'Export Failures', value: selectedRangeStats.exportFailed, tone: 'text-red-500' },
            ].map((card) => (
              <div key={card.label} className={`border rounded p-3 ${cardClass}`}>
                <div className="text-[11px] opacity-75">{card.label}</div>
                <div className={`text-xl font-semibold ${card.tone}`}>{card.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`border rounded p-3 space-y-2 ${cardClass}`}>
          <div>
            <div className="text-sm font-semibold">Live Snapshot</div>
            <div className="text-xs opacity-70">Current queue and catalog state. These are not filtered by the selected range.</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {liveSnapshotCards.map((card) => (
              <div key={card.label} className={`border rounded p-3 ${cardClass}`}>
                <div className="text-[11px] opacity-75">{card.label}</div>
                <div className={`text-xl font-semibold ${card.tone}`}>{card.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`border rounded p-3 space-y-2 ${cardClass}`}>
          <div>
            <div className="text-sm font-semibold">Rolling 24 Hours</div>
            <div className="text-xs opacity-70">Operational health over the last 24 hours, independent of the selected range.</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {rolling24hCards.map((card) => (
              <div key={card.label} className={`border rounded p-3 ${cardClass}`}>
                <div className="text-[11px] opacity-75">{card.label}</div>
                <div className={`text-xl font-semibold ${card.tone}`}>{card.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className={`border rounded p-3 space-y-2 ${cardClass}`}>
            <div className="flex items-center">
              <div>
                <div className="text-sm font-semibold">Pending Account Requests</div>
                <div className="text-xs opacity-70">
                  {Number(homeData?.counts?.pendingAccountRequests || 0)} currently pending
                </div>
              </div>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={onOpenAccountRequests}>
                Open Account Requests
              </Button>
            </div>
            <div className="space-y-1">
              {(homeData?.queues?.accountRequests || []).map((row) => (
                <div key={row.id} className={`rounded border px-2 py-1 text-xs ${theme === 'dark' ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
                  <div className="font-medium truncate">{row.display_name || row.email || 'Unknown'}</div>
                  <div className="flex items-center gap-1 opacity-70 min-w-0">
                    <CopyableValue
                      value={row.email || '-'}
                      label="account request email"
                      className="max-w-full min-w-0 flex-1"
                      valueClassName="text-inherit"
                      buttonClassName="h-5 w-5"
                    />
                    <span className="shrink-0">| {row.payment_channel || '-'}</span>
                  </div>
                </div>
              ))}
              {!homeLoading && (homeData?.queues?.accountRequests || []).length === 0 && (
                <div className="text-xs opacity-70">No pending account requests.</div>
              )}
            </div>
          </div>

          <div className={`border rounded p-3 space-y-2 ${cardClass}`}>
            <div className="flex items-center">
              <div>
                <div className="text-sm font-semibold">Pending Store Requests</div>
                <div className="text-xs opacity-70">
                  {Number(homeData?.counts?.pendingStoreRequests || 0)} currently pending
                </div>
              </div>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={onOpenStoreRequests}>
                Open Store Requests
              </Button>
            </div>
            <div className="space-y-1">
              {(homeData?.queues?.storeRequests || []).map((row) => (
                <div key={row.id} className={`rounded border px-2 py-1 text-xs ${theme === 'dark' ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
                  <div className="font-medium truncate">{row.user_label || 'Unknown User'}</div>
                  <div className="opacity-70 truncate">{row.bank_name || '-'} | {row.payment_channel || '-'}</div>
                </div>
              ))}
              {!homeLoading && (homeData?.queues?.storeRequests || []).length === 0 && (
                <div className="text-xs opacity-70">No pending store requests.</div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-stretch">
          <div className={`border rounded p-3 h-full flex flex-col ${cardClass}`}>
            <div className="text-sm font-semibold">Revenue Trend</div>
            <div className="text-xs opacity-70 mb-1">Range: {homeRangeLabel}</div>
            <RevenueAdvancedChart rows={homeTrends} theme={theme} formatMoney={formatMoney} />
          </div>
          <div className={`border rounded p-3 h-full flex flex-col ${cardClass}`}>
            <div className="text-sm font-semibold">Buyer & Import Trend</div>
            <div className="text-xs opacity-70 mb-1">Range: {homeRangeLabel}</div>
            <MiniGroupedBarChart
              points={homePointLabels}
              authSuccess={homeStoreBuyersSeries}
              authFailed={homeAccountBuyersSeries}
              imports={homeImportRequestsSeries}
              seriesALabel="Store Buyers"
              seriesBLabel="Account Buyers"
              seriesCLabel="Import Requests"
              theme={theme}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-stretch">
          <div className={`border rounded p-3 h-full flex flex-col ${cardClass}`}>
            <div className="text-sm font-semibold">Export Health</div>
            <div className="text-xs opacity-70 mb-1">Range: {homeRangeLabel}</div>
            <ExportHealthPieChart
              successTotal={homeExportSuccessSeries.reduce((sum, value) => sum + value, 0)}
              failedTotal={homeExportFailedSeries.reduce((sum, value) => sum + value, 0)}
              theme={theme}
            />
          </div>
          <div className={`border rounded p-3 h-full flex flex-col ${cardClass}`}>
            <div className="text-sm font-semibold">Auth & Import</div>
            <div className="text-xs opacity-70 mb-1">Range: {homeRangeLabel}</div>
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

      <div className="pt-2 text-[11px] opacity-70">
        <span>Last refresh: {homeLastRefresh ? new Date(homeLastRefresh).toLocaleString() : '-'}</span>
        <span className="mx-2">|</span>
        <span>Time basis: {homeData?.meta?.timeBasis || 'UTC'}</span>
        {homeData?.meta?.sampled ? (
          <>
            <span className="mx-2">|</span>
            <span>Sampled at cap {homeData?.meta?.seriesCap || 0}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function AssignmentsTab({
  theme,
  cardClass,
  usersLoading,
  usersQuery,
  assignmentUsers,
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
  assignmentBankSortBy,
  assignmentBankSortDir,
  selectedBankIds,
  grantedBankIds,
  banksLoading,
  onUsersQueryChange,
  onRefreshUsers,
  onToggleAssignmentUserSort,
  onSelectUser,
  onGrant,
  onRevoke,
  onToggleAssignmentBankSort,
  onToggleBankSelection,
}: AssignmentsTabProps) {
  return (
    <div className={`grid grid-cols-1 gap-3 lg:grid-cols-2 ${DESKTOP_FILL_CLASS} lg:overflow-hidden`}>
      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="flex items-center justify-between">
          <Label>Select User</Label>
          <div className="flex items-center gap-1">
            <Button size="sm" variant={assignmentUserSortBy === 'created_at' ? 'secondary' : 'outline'} onClick={() => onToggleAssignmentUserSort('created_at')}>
              Newest
            </Button>
            <Button size="sm" variant="outline" onClick={onRefreshUsers} disabled={usersLoading}>
              <RefreshCw className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
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
                  <TableCell className="block md:table-cell font-medium max-w-[200px] truncate border-none md:border-b pb-0 md:pb-4" title={user.display_name}>{user.display_name}</TableCell>
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
      </div>

      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="text-sm">
          <div className="font-medium">Bank Access</div>
          <div className="text-xs opacity-70">
            {accessLoading ? 'Loading access...' : selectedUser ? `${selectedUser.display_name} (${selectedUser.email || 'no email'})` : 'Select a user first'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onGrant(selectedGrantIds)} disabled={!selectedUserId || selectedGrantIds.length === 0 || bulkLoading}>Grant Selected ({selectedGrantIds.length})</Button>
          <Button size="sm" variant="outline" onClick={() => onRevoke(selectedRevokeIds)} disabled={!selectedUserId || selectedRevokeIds.length === 0 || bulkLoading}>Revoke Selected ({selectedRevokeIds.length})</Button>
          <Button size="sm" variant="secondary" onClick={() => onGrant(allGrantIds)} disabled={!selectedUserId || allGrantIds.length === 0 || bulkLoading}>Grant All ({allGrantIds.length})</Button>
          <Button size="sm" variant="outline" onClick={() => onRevoke(allRevokeIds)} disabled={!selectedUserId || allRevokeIds.length === 0 || bulkLoading}>Revoke All ({allRevokeIds.length})</Button>
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
                return (
                  <TableRow key={bank.id} className="flex flex-col md:table-row relative border rounded md:border-none p-2 md:p-0">
                    <TableCell className="absolute top-2 right-2 md:relative md:top-0 md:right-0 block md:table-cell p-0 md:p-4 border-none md:border-b"><Checkbox checked={selectedBankIds.has(bank.id)} onCheckedChange={() => onToggleBankSelection(bank.id)} disabled={!selectedUserId} /></TableCell>
                    <TableCell className="block md:table-cell border-none md:border-b pb-1 md:pb-4 pr-8 md:pr-4"><div className="font-medium truncate max-w-[240px]" title={bank.title}>{bank.title}</div><div className="text-xs opacity-70 truncate max-w-[240px]" title={bank.description || ''}>{bank.description || '-'}</div></TableCell>
                    <TableCell className="block md:table-cell border-none md:border-b py-1 md:py-4"><span className={`text-xs px-2 py-1 rounded ${granted ? 'bg-emerald-600/20 text-emerald-500' : 'bg-gray-600/20 text-gray-500'}`}>{granted ? 'Granted' : 'Not granted'}</span></TableCell>
                    <TableCell className="block md:table-cell border-none md:border-b pt-1 md:pt-4 text-xs"><span className="md:hidden font-semibold opacity-70 mr-1">Access count:</span>{bank.access_count}</TableCell>
                  </TableRow>
                );
              })}
              {!banksLoading && assignmentBanks.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={4} className="block md:table-cell text-center py-3 opacity-70">No banks</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function BanksTab({
  theme,
  panelClass,
  banksLoading,
  banksQuery,
  banks,
  banksSortBy,
  banksSortDir,
  onBanksQueryChange,
  onRefreshBanks,
  onToggleBankSort,
  onOpenBankAccess,
  onEditBank,
  onDeleteBank,
}: BanksTabProps) {
  return (
    <div className={`border rounded p-3 space-y-3 ${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label>Search Banks</Label>
          <Input value={banksQuery} onChange={(event) => onBanksQueryChange(event.target.value)} placeholder="Search title or description..." onKeyDown={(event) => event.key === 'Enter' && onRefreshBanks()} />
        </div>
        <Button variant="outline" onClick={onRefreshBanks} disabled={banksLoading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${banksLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
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
    </div>
  );
}

function UsersTab({
  theme,
  panelClass,
  usersLoading,
  usersQuery,
  users,
  usersSortBy,
  usersSortDir,
  onUsersQueryChange,
  onRefreshUsers,
  onToggleUserSort,
  onOpenCreateUser,
  onOpenUserDetails,
}: UsersTabProps) {
  return (
    <div className={`border rounded p-3 space-y-3 ${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label>Search Users</Label>
          <Input value={usersQuery} onChange={(event) => onUsersQueryChange(event.target.value)} placeholder="Search name, email, id..." onKeyDown={(event) => event.key === 'Enter' && onRefreshUsers()} />
        </div>
        <Button onClick={onOpenCreateUser}><Plus className="w-4 h-4 mr-1" />Add User</Button>
        <Button variant="outline" onClick={onRefreshUsers} disabled={usersLoading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${usersLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <div className={TABLE_SHELL_CLASS}>
        <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[980px] block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead><SortHeader title="Display Name" active={usersSortBy === 'display_name'} direction={usersSortDir} onClick={() => onToggleUserSort('display_name')} /></TableHead>
              <TableHead><SortHeader title="Email" active={usersSortBy === 'email'} direction={usersSortDir} onClick={() => onToggleUserSort('email')} /></TableHead>
              <TableHead><SortHeader title="Created" active={usersSortBy === 'created_at'} direction={usersSortDir} onClick={() => onToggleUserSort('created_at')} /></TableHead>
              <TableHead><SortHeader title="Last Sign-In" active={usersSortBy === 'last_sign_in_at'} direction={usersSortDir} onClick={() => onToggleUserSort('last_sign_in_at')} /></TableHead>
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
                <TableCell className="hidden md:table-cell">{user.created_at ? new Date(user.created_at).toLocaleString() : '-'}</TableCell>
                <TableCell className="hidden md:table-cell">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '-'}</TableCell>
                <TableCell className="block md:table-cell py-1 md:py-4 border-none md:border-b">
                  <span className="md:hidden font-semibold text-xs mr-2">Status:</span>
                  <span className={`text-xs px-2 py-1 rounded ${isUserBanned(user) ? 'bg-red-600/20 text-red-500' : 'bg-emerald-600/20 text-emerald-500'}`}>{isUserBanned(user) ? 'Banned' : 'Active'}</span>
                </TableCell>
                <TableCell className={`block md:table-cell absolute top-3 right-3 md:relative md:top-0 md:right-0 md:text-right border-none md:border-b p-0 md:p-4 md:sticky ${theme === 'dark' ? 'md:bg-gray-900 bg-transparent' : 'md:bg-white bg-transparent'}`}>
                  <Button size="sm" variant="outline" onClick={() => onOpenUserDetails(user)}>Edit</Button>
                </TableCell>
              </TableRow>
            ))}
            {!usersLoading && users.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={6} className="block md:table-cell text-center py-3 opacity-70">No users</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ActiveTab({
  panelClass,
  cardClass,
  titleClass,
  activeLoading,
  activeCounts,
  activeUsersRows,
  activeSortBy,
  activeSortDir,
  onRefreshActive,
  onToggleActiveSort,
}: ActiveTabProps) {
  return (
    <div className={`border rounded p-3 space-y-3 ${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}>
      <div className="flex items-center justify-between">
        <div>
          <Label>Active Users</Label>
          <div className="text-xs opacity-70">Non-admin users currently online.</div>
        </div>
        <Button variant="outline" onClick={onRefreshActive} disabled={activeLoading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${activeLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={`border rounded p-3 ${cardClass}`}><div className={`text-xs opacity-80 ${titleClass}`}>Active Users</div><div className="text-xl font-semibold">{activeCounts.activeUsers}</div></div>
        <div className={`border rounded p-3 ${cardClass}`}><div className={`text-xs opacity-80 ${titleClass}`}>Active Sessions</div><div className="text-xl font-semibold">{activeCounts.activeSessions}</div></div>
      </div>
      <div className={TABLE_SHELL_CLASS}>
        <Table containerClassName={TABLE_CONTAINER_CLASS} className="md:min-w-[980px] block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead><SortHeader title="User" active={activeSortBy === 'user_id'} direction={activeSortDir} onClick={() => onToggleActiveSort('user_id')} /></TableHead>
              <TableHead><SortHeader title="Email" active={activeSortBy === 'email'} direction={activeSortDir} onClick={() => onToggleActiveSort('email')} /></TableHead>
              <TableHead><SortHeader title="Device Name" active={activeSortBy === 'device_name'} direction={activeSortDir} onClick={() => onToggleActiveSort('device_name')} /></TableHead>
              <TableHead><SortHeader title="Platform / Browser / OS" active={activeSortBy === 'platform'} direction={activeSortDir} onClick={() => onToggleActiveSort('platform')} /></TableHead>
              <TableHead><SortHeader title="Last Seen" active={activeSortBy === 'last_seen_at'} direction={activeSortDir} onClick={() => onToggleActiveSort('last_seen_at')} /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group space-y-2 md:space-y-0 p-2 md:p-0">
            {activeUsersRows.map((row) => (
              <TableRow key={row.user_id} className="flex flex-col md:table-row border border-gray-200 dark:border-gray-800 rounded-lg md:rounded-none md:border-none p-3 md:p-0">
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
                <TableCell className="block md:table-cell text-xs font-medium text-cyan-600 dark:text-cyan-400 border-none md:border-b pt-1 md:pt-4"><span className="md:hidden font-semibold text-gray-500 dark:text-gray-400 mr-1">Last seen: </span>{new Date(row.last_seen_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {!activeLoading && activeUsersRows.length === 0 && <TableRow className="block md:table-row"><TableCell colSpan={5} className="block md:table-cell text-center py-3 opacity-70">No active users</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
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
    <div className={`border rounded p-3 space-y-3 ${DESKTOP_FLEX_PANEL_CLASS} ${panelClass}`}>
      <div className={`border rounded p-3 space-y-3 ${DESKTOP_SECTION_CARD_CLASS} ${cardClass}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Export Activity</div>
            <div className="text-xs opacity-70">Track export requests, upload stages, and recovery events in a layout that scrolls naturally on mobile.</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-white'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">Visible</div>
              <div className="text-base font-semibold">{activityRows.length}</div>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-emerald-700/60 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">Page</div>
              <div className="text-base font-semibold">{activityPage}/{activityTotalPages}</div>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-blue-700/60 bg-blue-500/10' : 'border-blue-200 bg-blue-50'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">Filters</div>
              <div className="text-base font-semibold">{exportFilterCount}</div>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-amber-700/60 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">State</div>
              <div className="text-sm font-medium">{activityLoading ? 'Loading' : 'Ready'}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
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
            <Button variant="outline" size="sm" className="h-9 w-full justify-center" onClick={onRefreshActivity} disabled={activityLoading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${activityLoading ? 'animate-spin' : ''}`} />
              Refresh Export Activity
            </Button>
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
            <div className="text-xs opacity-70">Auth, import, and system events with full-width mobile controls and clearer filter state.</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-white'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">Visible</div>
              <div className="text-base font-semibold">{otherActivityRows.length}</div>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-blue-700/60 bg-blue-500/10' : 'border-blue-200 bg-blue-50'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">Page</div>
              <div className="text-base font-semibold">{otherActivityPage}/{otherActivityTotalPages}</div>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${theme === 'dark' ? 'border-amber-700/60 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-70">Filters</div>
              <div className="text-base font-semibold">{otherFilterCount}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
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
            <Button variant="outline" size="sm" className="h-9 w-full justify-center" onClick={onRefreshOtherActivity} disabled={otherActivityLoading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${otherActivityLoading ? 'animate-spin' : ''}`} />
              Refresh Other Activity
            </Button>
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
    </div>
  );
}

export function AdminAccessNonStoreTabs(props: AdminAccessNonStoreTabsProps) {
  if (props.tab === 'home') return <HomeTab {...props.home} />;
  if (props.tab === 'assignments') return <AssignmentsTab {...props.assignments} />;
  if (props.tab === 'banks') return <BanksTab {...props.banks} />;
  if (props.tab === 'users') return <UsersTab {...props.users} />;
  if (props.tab === 'active') return <ActiveTab {...props.active} />;
  if (props.tab === 'activity') return <ActivityTab {...props.activity} />;
  return null;
}
