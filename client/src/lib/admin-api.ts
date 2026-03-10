import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export type SortDirection = 'asc' | 'desc';

export interface AdminUser {
  id: string;
  email: string | null;
  role: 'admin' | 'user';
  display_name: string;
  owned_bank_quota: number;
  owned_bank_pad_cap: number;
  device_total_bank_cap: number;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  is_banned: boolean;
}

export interface AdminBank {
  id: string;
  title: string;
  description: string;
  color?: string | null;
  created_at: string | null;
  created_by: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  access_count: number;
}

export interface AccessEntry {
  id: string;
  user_id: string;
  bank_id: string;
  granted_at: string;
  bank: {
    id: string;
    title: string;
    description?: string | null;
  } | null;
}

export interface BankAccessEntry {
  id: string;
  user_id: string;
  bank_id: string;
  granted_at: string;
  user: {
    id: string;
    email: string | null;
    display_name: string;
    role: 'admin' | 'user';
  };
}

export interface ActiveSessionRow {
  session_key: string;
  user_id: string;
  email?: string | null;
  device_fingerprint: string;
  device_name?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  last_seen_at: string;
}

export interface AdminAccountRegistrationRequest {
  id: string;
  email: string;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected';
  payment_channel: 'image_proof' | 'gcash_manual' | 'maya_manual';
  payer_name?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  proof_path?: string | null;
  rejection_message?: string | null;
  decision_email_status?: 'pending' | 'sent' | 'failed' | 'skipped' | null;
  decision_email_error?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_auth_user_id?: string | null;
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
}

export interface AdminActivityRow {
  id: number;
  created_at: string | null;
  event_type: 'auth.login' | 'auth.signup' | 'auth.signout' | 'bank.export' | 'bank.import' | string;
  status: 'success' | 'failed' | string;
  user_id: string | null;
  display_name: string | null;
  email: string | null;
  bank_id: string | null;
  bank_uuid: string | null;
  bank_name: string | null;
  pad_count: number | null;
  error_message: string | null;
  meta: Record<string, unknown>;
}

export interface AdminDashboardTrendPoint {
  date: string;
  exportSuccess: number;
  exportFailed: number;
  authSuccess: number;
  authFailed: number;
  importTotal: number;
  storeRevenueApproved: number;
  accountRevenueApproved: number;
  totalRevenueApproved: number;
  storeBuyersApproved: number;
  accountBuyersApproved: number;
  importRequests: number;
}

export interface AdminDashboardOverview {
  refreshedAt: string;
  windowDays: number;
  counts: {
    activeUsers: number;
    activeSessions: number;
    pendingAccountRequests: number;
    pendingStoreRequests: number;
    exports24h: number;
    exportFailures24h: number;
    duplicateNoChange24h: number;
    authFailures24h: number;
    imports24h: number;
    storeRevenueApprovedTotal: number;
    accountRevenueApprovedTotal: number;
    totalRevenueApproved: number;
    storeRevenue24h: number;
    accountRevenue24h: number;
    totalRevenue24h: number;
    storeBuyersApprovedTotal: number;
    accountBuyersApprovedTotal: number;
    publishedCatalog: number;
    draftCatalog: number;
  };
  trends: AdminDashboardTrendPoint[];
  queues: {
    accountRequests: Array<{
      id: string;
      display_name: string;
      email: string;
      payment_channel: string;
      created_at: string | null;
    }>;
    storeRequests: Array<{
      id: string;
      user_id: string | null;
      user_label: string;
      bank_id: string;
      bank_name: string;
      payment_channel: string;
      created_at: string | null;
    }>;
  };
  meta: {
    timeBasis: 'UTC' | string;
    sampled: boolean;
    seriesCap: number;
    rangeStartDate?: string;
    rangeEndDate?: string;
  };
}

export interface DefaultBankRelease {
  id: string;
  version: number;
  sourceBankRuntimeId: string | null;
  sourceBankTitle: string;
  sourceBankPadCount: number;
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
  storageEtag: string | null;
  fileSizeBytes: number;
  fileSha256: string | null;
  releaseNotes: string | null;
  minAppVersion: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
}

const toQueryString = (params: Record<string, string | number | boolean | null | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
};

const callAdmin = async <T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> => {
  const headers = await getAuthHeaders(true);
  const resp = await fetch(edgeFunctionUrl('admin-api', route), {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await resp.json().catch(() => ({}));
  const err = payload?.error || payload?.data?.error;
  if (!resp.ok || payload?.ok === false) {
    throw new Error(err || 'Admin API request failed');
  }

  return ((payload?.data ?? payload) as T);
};

const callStoreApi = async <T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> => {
  const headers = await getAuthHeaders(true);
  const resp = await fetch(edgeFunctionUrl('store-api', route), {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await resp.json().catch(() => ({}));
  const err = payload?.error || payload?.data?.error;
  if (!resp.ok || payload?.ok === false) {
    throw new Error(err || 'Store API request failed');
  }

  return ((payload?.data ?? payload) as T);
};

export const adminApi = {
  async listUsers(input: {
    q?: string;
    page?: number;
    perPage?: number;
    sortBy?: 'display_name' | 'email' | 'created_at' | 'last_sign_in_at' | 'ban_status';
    sortDir?: SortDirection;
    includeAdmins?: boolean;
  }) {
    const query = toQueryString({
      q: input.q,
      page: input.page ?? 1,
      perPage: input.perPage ?? 1000,
      sortBy: input.sortBy ?? 'created_at',
      sortDir: input.sortDir ?? 'desc',
      includeAdmins: input.includeAdmins ?? false,
    });
    return callAdmin<{ users: AdminUser[]; total: number }>('GET', `users${query}`);
  },

  async createUser(input: { email: string; password: string; displayName?: string }) {
    return callAdmin<{ user: AdminUser }>('POST', 'users/create', input);
  },

  async updateUserProfile(userId: string, input: {
    displayName: string;
    ownedBankQuota: number;
    ownedBankPadCap: number;
    deviceTotalBankCap: number;
  }) {
    return callAdmin<{ user: AdminUser }>('POST', `users/${userId}/update-profile`, input);
  },

  async deleteUser(userId: string) {
    return callAdmin<{ userId: string }>('POST', `users/${userId}/delete`);
  },

  async banUser(userId: string, hours: number) {
    return callAdmin<{ userId: string; banned_until: string }>('POST', `users/${userId}/ban`, { hours });
  },

  async unbanUser(userId: string) {
    return callAdmin<{ userId: string; banned_until: null }>('POST', `users/${userId}/unban`);
  },

  async resetPassword(userId: string) {
    return callAdmin<{ userId: string; email: string }>('POST', `users/${userId}/reset-password`);
  },

  async listBanks(input: {
    q?: string;
    sortBy?: 'title' | 'created_at' | 'access_count';
    sortDir?: SortDirection;
  }) {
    const query = toQueryString({
      q: input.q,
      sortBy: input.sortBy ?? 'created_at',
      sortDir: input.sortDir ?? 'desc',
    });
    return callAdmin<{ banks: AdminBank[]; total: number }>('GET', `banks${query}`);
  },

  async updateBank(bankId: string, input: { title: string; description?: string; color?: string | null }) {
    return callAdmin<{ bank: AdminBank }>('POST', `banks/${bankId}/update`, input);
  },

  async deleteBank(bankId: string, revokeAll = true) {
    return callAdmin<{ bankId: string; revokedAll: boolean }>('POST', `banks/${bankId}/delete`, { revokeAll });
  },

  async getUserAccess(userId: string) {
    return callAdmin<{ userId: string; bankIds: string[]; access: AccessEntry[] }>('GET', `access/user/${userId}`);
  },

  async getBankAccess(bankId: string, input?: { page?: number; perPage?: number; q?: string }) {
    const query = toQueryString({
      page: input?.page ?? 1,
      perPage: input?.perPage ?? 20,
      q: input?.q,
    });
    return callAdmin<{
      bankId: string;
      bankTitle: string;
      page: number;
      perPage: number;
      total: number;
      access: BankAccessEntry[];
    }>('GET', `access/bank/${bankId}${query}`);
  },

  async grantUserAccess(userId: string, bankIds: string[]) {
    return callAdmin<{ userId: string; bankIds: string[]; grantedCount: number }>('POST', `access/user/${userId}/grant`, { bankIds });
  },

  async revokeUserAccess(userId: string, bankIds: string[]) {
    return callAdmin<{ userId: string; bankIds: string[]; revokedCount: number }>('POST', `access/user/${userId}/revoke`, { bankIds });
  },

  async listActiveSessions(input: { q?: string; limit?: number }) {
    const query = toQueryString({
      q: input.q,
      limit: input.limit ?? 300,
    });
    return callAdmin<{ counts: { activeUsers: number; activeSessions: number }; sessions: ActiveSessionRow[]; total: number }>(
      'GET',
      `active-sessions${query}`,
    );
  },

  async getDashboardOverview(input?: { windowDays?: number; fromDate?: string; toDate?: string }) {
    const query = toQueryString({
      windowDays: input?.windowDays ?? 7,
      fromDate: input?.fromDate,
      toDate: input?.toDate,
    });
    return callAdmin<AdminDashboardOverview>('GET', `dashboard-overview${query}`);
  },

  async listActivity(input: {
    scope?: 'export' | 'auth' | 'non_export' | 'all';
    eventType?: 'auth.login' | 'auth.signup' | 'auth.signout' | 'bank.export' | 'bank.import';
    status?: 'success' | 'failed';
    category?: 'bank_export' | 'backup_recovery';
    phase?: string;
    uploadResult?: 'success' | 'failed' | 'duplicate_no_change';
    q?: string;
    page?: number;
    perPage?: number;
    sortBy?: 'created_at' | 'event_type' | 'status' | 'email' | 'bank_name';
    sortDir?: SortDirection;
    from?: string;
    to?: string;
  }) {
    const query = toQueryString({
      scope: input.scope,
      eventType: input.eventType,
      status: input.status,
      category: input.category,
      phase: input.phase,
      uploadResult: input.uploadResult,
      q: input.q,
      page: input.page ?? 1,
      perPage: input.perPage ?? 30,
      sortBy: input.sortBy ?? 'created_at',
      sortDir: input.sortDir ?? 'desc',
      from: input.from,
      to: input.to,
    });
    return callAdmin<{
      activity: AdminActivityRow[];
      total: number;
      page: number;
      perPage: number;
      sortBy: string;
      sortDir: SortDirection;
      eventType: string | null;
      scope: string | null;
      status: string | null;
      category: string | null;
      phase: string | null;
      uploadResult: string | null;
    }>('GET', `activity${query}`);
  },

  async listAccountRegistrationRequests(input: {
    filter?: 'pending' | 'history';
    q?: string;
    page?: number;
    perPage?: number;
  }) {
    const query = toQueryString({
      filter: input.filter ?? 'pending',
      q: input.q,
      page: input.page ?? 1,
      perPage: input.perPage ?? 10,
    });
    return callStoreApi<{
      requests: AdminAccountRegistrationRequest[];
      total: number;
      page: number;
      perPage: number;
      pendingCount: number;
      historyCount: number;
      filter: 'pending' | 'history';
    }>('GET', `admin/account-registration/requests${query}`);
  },

  async accountRegistrationAction(
    requestId: string,
    input: { action: 'approve' | 'approve_assisted' | 'reject'; rejection_message?: string; temporary_password?: string }
  ) {
    return callStoreApi<{
      requestId: string;
      status: 'approved' | 'rejected';
      decision_email_status?: 'pending' | 'sent' | 'failed' | 'skipped';
      decision_email_error?: string | null;
      assisted_approval?: boolean;
    }>('POST', `admin/account-registration/requests/${requestId}`, input);
  },

  async accountRegistrationRetryEmail(requestId: string) {
    return callStoreApi<{
      requestId: string;
      status: 'approved' | 'rejected';
      decision_email_status?: 'pending' | 'sent' | 'failed' | 'skipped';
      decision_email_error?: string | null;
    }>('POST', `admin/account-registration/requests/${requestId}/retry-email`);
  },

  async getDefaultBankReleaseState() {
    return callAdmin<{
      currentRelease: DefaultBankRelease | null;
      releases: DefaultBankRelease[];
      nextVersion: number;
    }>('GET', 'default-bank');
  },

  async rollbackDefaultBankRelease(version: number) {
    return callAdmin<{ release: DefaultBankRelease }>('POST', 'default-bank/rollback', { version });
  },
};
