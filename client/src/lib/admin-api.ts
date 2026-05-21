import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';
import type { SamplerAppConfig } from '@/components/sampler/samplerAppConfig';
import type { AdminLegalDocumentState, LegalDocument, LegalDocumentKey } from '@/lib/legal-content';

export type SortDirection = 'asc' | 'desc';

export interface AdminUser {
  id: string;
  email: string | null;
  role: 'admin' | 'user';
  account_tier?: 'free' | 'pro' | 'pro_max';
  effective_account_tier?: 'free' | 'pro' | 'pro_max';
  tier_source?: string | null;
  tier_updated_at?: string | null;
  display_name: string;
  owned_bank_quota: number;
  owned_bank_pad_cap: number;
  device_total_bank_cap: number;
  created_at: string | null;
  last_sign_in_at: string | null;
  last_sign_in_device_name: string | null;
  last_sign_in_platform: string | null;
  last_sign_in_app_version: string | null;
  banned_until: string | null;
  is_banned: boolean;
}

export interface AdminAccountTierConfig {
  tier: 'free' | 'pro' | 'pro_max';
  display_name: string;
  description?: string | null;
  price_php: number;
  limits: Record<string, unknown>;
  features: Record<string, boolean>;
  is_active: boolean;
  updated_at?: string | null;
}

export interface AdminAccountUpgradeRequest {
  id: string;
  user_id: string | null;
  email: string;
  display_name?: string | null;
  target_tier: 'pro' | 'pro_max';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  payment_channel?: string | null;
  payer_name?: string | null;
  reference_no?: string | null;
  proof_path?: string | null;
  notes?: string | null;
  base_price_php_snapshot: number;
  store_credit_php_snapshot: number;
  quote_price_php_snapshot: number;
  receipt_reference?: string | null;
  rejection_message?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface AdminVoucherCampaign {
  id: string;
  name: string;
  target_tier: 'pro' | 'pro_max';
  max_codes: number;
  reserved_count: number;
  redeemed_count: number;
  expires_at?: string | null;
  target_email?: string | null;
  target_user_id?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at: string;
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
  store_catalog?: {
    id: string;
    item_type: 'single_bank' | 'bank_bundle';
    is_published: boolean;
    coming_soon: boolean;
    asset_protection: 'encrypted' | 'public';
    file_size_bytes: number | null;
    thumbnail_path: string | null;
    storage_key: string;
    expected_asset_name: string;
    price_php: number | null;
    updated_at: string | null;
  } | null;
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

export interface AdminActiveSessionCounts {
  activeUsers: number;
  activeSessions: number;
  activeTodayUsers: number;
}

export interface AdminAccountRegistrationRequest {
  id: string;
  email: string;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected';
  is_refunded?: boolean;
  refunded_at?: string | null;
  refunded_by?: string | null;
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
  activeUsers: number;
  exportSuccess: number;
  exportFailed: number;
  authSuccess: number;
  authFailed: number;
  importTotal: number;
  storeRevenueApproved: number;
  accountRevenueApproved: number;
  installerRevenueApproved: number;
  totalRevenueApproved: number;
  storeBuyersApproved: number;
  accountBuyersApproved: number;
  installerSalesApproved: number;
  importRequests: number;
}

export interface AdminDashboardOverview {
  refreshedAt: string;
  windowDays: number;
  counts: {
    activeUsers: number;
    activeSessions: number;
    activeTodayUsers: number;
    pendingAccountRequests: number;
    pendingStoreRequests: number;
    pendingInstallerRequests: number;
    totalRegisteredUsers: number;
    totalInstallerLicenses: number;
    approvedStoreRequestsTotal: number;
    todayRequestTotal: number;
    importFailures24h: number;
    imports24h: number;
    storeRevenueApprovedTotal: number;
    accountRevenueApprovedTotal: number;
    installerRevenueApprovedTotal: number;
    totalRevenueApproved: number;
    storeRevenue24h: number;
    accountRevenue24h: number;
    installerRevenue24h: number;
    totalRevenue24h: number;
    storeBuyersApprovedTotal: number;
    accountBuyersApprovedTotal: number;
    installerSalesApprovedTotal: number;
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
    activeTodayTimeBasis?: string;
    rangeTimeZone?: string;
    rangeStartIso?: string;
    rangeEndIso?: string;
    granularity?: 'hour' | 'day' | string;
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

export interface AdminStoreCatalogItem {
  id: string;
  bank_id: string;
  item_type?: 'single_bank' | 'bank_bundle';
  status: 'published' | 'draft';
  coming_soon?: boolean;
  asset_protection?: 'encrypted' | 'public' | null;
  file_size_bytes?: number | null;
  storage_key?: string | null;
  expected_asset_name?: string | null;
  price_php?: number | null;
  is_pinned?: boolean;
  thumbnail_path?: string | null;
  sha256?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  bundle_title?: string;
  bundle_description?: string;
  bundle_bank_ids?: string[];
  bundle_bank_titles?: string[];
  bundle_count?: number;
  bank: {
    title: string;
    description: string;
    color: string;
  };
}

export interface AdminCatalogUploadSession {
  id: string;
  catalog_item_id: string | null;
  bank_id: string | null;
  status: 'issued' | 'completed' | 'failed' | 'expired' | string;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  storage_bucket: string;
  storage_key: string;
  asset_name: string | null;
  expected_file_size_bytes: number;
  expected_sha256: string | null;
  actual_file_size_bytes: number | null;
  actual_etag: string | null;
  object_exists: boolean;
  asset_protection: 'encrypted' | 'public';
  operation_type: 'create' | 'update';
  is_current_catalog_asset: boolean;
}

export interface AdminCatalogAssetVariantPart {
  id: string;
  part_index: number;
  storage_bucket: string;
  storage_key: string;
  file_size_bytes: number;
  sha256: string | null;
  pad_start_index: number;
  pad_end_index: number;
}

export interface AdminCatalogAssetVariant {
  id: string;
  catalog_item_id: string;
  variant_type: 'full' | 'low_memory_segmented';
  status: 'uploading' | 'ready' | 'failed';
  manifest_storage_bucket: string | null;
  manifest_storage_key: string | null;
  total_file_size_bytes: number | null;
  part_count: number;
  min_client_version: string | null;
  source_asset_sha256: string | null;
  object_exists: boolean;
  parts: AdminCatalogAssetVariantPart[];
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminClientCrashReport {
  id: string;
  user_id: string;
  user_profile: {
    display_name: string;
    email: string;
  };
  domain: 'bank_store' | 'playback' | 'global_runtime';
  status: 'new' | 'acknowledged' | 'fixed' | 'ignored';
  report_title: string;
  latest_operation?: string | null;
  latest_phase?: string | null;
  latest_stage?: string | null;
  platform?: string | null;
  app_version?: string | null;
  recent_event_pattern?: string | null;
  report_object_key?: string | null;
  report_download_url?: string | null;
  report_uploaded_at?: string | null;
  report_size_bytes?: number | null;
  repeat_count: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  latest_summary?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export type LandingVersionKey = 'V1' | 'V2' | 'V3';
export type LandingPlatformKey = 'android' | 'ios' | 'windows' | 'macos';

export interface LandingVersionDescription {
  title: string;
  desc: string;
}

export interface LandingBuySection {
  title: string;
  description: string;
  imageUrl: string;
  defaultInstallerDownloadLink: string;
}

export type LandingSocialKey = 'facebook' | 'instagram' | 'youtube';

export interface LandingSocialLink {
  label: string;
  url: string;
}

export interface LandingDownloadConfig {
  downloadLinks: Record<LandingVersionKey, Record<LandingPlatformKey, string>>;
  platformDescriptions: Record<LandingVersionKey, Record<LandingPlatformKey, string>>;
  versionDescriptions: Record<LandingVersionKey, LandingVersionDescription>;
  buySections: Record<LandingVersionKey, LandingBuySection>;
  socialLinks: Record<LandingSocialKey, LandingSocialLink>;
}

export type InstallerVersionKey = 'V2' | 'V3';
export type InstallerPackageKind = 'standard' | 'update';
export type InstallerBuyProductType = 'standard' | 'update' | 'promax';

export interface InstallerPackagePart {
  partIndex: number;
  archiveName: string;
  downloadUrl: string;
  downloadSize: number;
  sha256: string;
  zipPassword: string;
  enabled: boolean;
}

export interface InstallerPackage {
  version: InstallerVersionKey;
  productCode: string;
  displayName: string;
  archiveName: string;
  downloadUrl: string;
  downloadSize: number;
  sha256: string;
  zipPassword: string;
  installOrder: number;
  packageKind: InstallerPackageKind;
  includeInProMax: boolean;
  enabled: boolean;
  partCount?: number;
  parts: InstallerPackagePart[];
}

export interface AdminInstallerLicense {
  id: number;
  codeHint: string | null;
  rawCode: string | null;
  version: InstallerVersionKey;
  customerName: string | null;
  status: 'available' | 'claimed' | 'used' | 'disabled' | string;
  notes: string;
  unlimited: boolean;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  usedAt: string | null;
  redemptionCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  entitlements: string[];
  completedProducts: string[];
}

export interface AdminInstallerEvent {
  id: number;
  licenseId: number;
  eventType: string;
  createdAt: string;
  version: InstallerVersionKey;
  customerName: string | null;
  codeHint: string | null;
  payload: Record<string, unknown>;
}

export interface InstallerBuyProduct {
  id?: string;
  version: InstallerVersionKey;
  skuCode: string;
  productType: InstallerBuyProductType;
  displayName: string;
  description: string;
  pricePhp: number;
  enabled: boolean;
  sortOrder: number;
  allowAutoApprove: boolean;
  heroImageUrl: string;
  downloadLinkOverride: string;
  grantedEntitlements: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminInstallerPurchaseRequest {
  id: string;
  email: string;
  version: InstallerVersionKey;
  skuCode: string;
  productType: InstallerBuyProductType;
  displayNameSnapshot: string;
  pricePhpSnapshot: number | null;
  grantedEntitlementsSnapshot: string[];
  status: 'pending' | 'approved' | 'rejected';
  paymentChannel: 'image_proof' | 'gcash_manual' | 'maya_manual';
  payerName?: string | null;
  referenceNo?: string | null;
  receiptReference?: string | null;
  notes?: string | null;
  proofPath?: string | null;
  rejectionMessage?: string | null;
  decisionEmailStatus?: 'pending' | 'sent' | 'failed' | 'skipped' | null;
  decisionEmailError?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  issuedLicenseId?: number | null;
  issuedLicenseCode?: string | null;
  installerDownloadLink?: string | null;
  ocrReferenceNo?: string | null;
  ocrPayerName?: string | null;
  ocrAmountPhp?: number | null;
  ocrRecipientNumber?: string | null;
  ocrProvider?: string | null;
  ocrScannedAt?: string | null;
  ocrStatus?: 'detected' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'failed' | 'unavailable' | 'skipped' | null;
  ocrErrorCode?: string | null;
  decisionSource?: 'manual' | 'automation' | null;
  automationResult?: string | null;
  isRefunded?: boolean;
  refundedAt?: string | null;
  refundedBy?: string | null;
  createdAt: string;
}

export interface AdminInstallerPurchaseRequestGroup {
  id: string;
  bundleKey: string;
  email: string;
  versions: InstallerVersionKey[];
  status: 'pending' | 'approved' | 'rejected';
  paymentChannel: 'image_proof' | 'gcash_manual' | 'maya_manual';
  payerName?: string | null;
  referenceNo?: string | null;
  receiptReference?: string | null;
  notes?: string | null;
  proofPath?: string | null;
  rejectionMessage?: string | null;
  decisionEmailStatus?: 'pending' | 'sent' | 'failed' | 'skipped' | null;
  decisionEmailError?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  issuedLicenseId?: number | null;
  issuedLicenseCode?: string | null;
  installerDownloadLink?: string | null;
  ocrReferenceNo?: string | null;
  ocrPayerName?: string | null;
  ocrAmountPhp?: number | null;
  ocrRecipientNumber?: string | null;
  ocrProvider?: string | null;
  ocrScannedAt?: string | null;
  ocrStatus?: 'detected' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'failed' | 'unavailable' | 'skipped' | null;
  ocrErrorCode?: string | null;
  decisionSource?: 'manual' | 'automation' | null;
  automationResult?: string | null;
  isRefunded?: boolean;
  refundedAt?: string | null;
  refundedBy?: string | null;
  createdAt: string;
  itemCount: number;
  totalAmountPhp: number | null;
  hasTbdAmount: boolean;
  items: AdminInstallerPurchaseRequest[];
}

export interface BuyConfig {
  config: LandingDownloadConfig;
  paymentConfig: {
    instructions?: string;
    gcash_number?: string;
    maya_number?: string;
    messenger_url?: string;
    qr_image_path?: string;
    account_price_php?: number | null;
  };
  v2v3Products: InstallerBuyProduct[];
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

const callStoreApi = async <T>(method: 'GET' | 'POST' | 'PATCH', route: string, body?: unknown): Promise<T> => {
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
    sortBy?: 'display_name' | 'email' | 'created_at' | 'last_sign_in_at' | 'last_sign_in_device_name' | 'last_sign_in_platform' | 'last_sign_in_app_version' | 'ban_status';
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
    return callAdmin<{
      users: AdminUser[];
      total: number;
      page: number;
      perPage: number;
      sortBy: string;
      sortDir: SortDirection;
      includeAdmins: boolean;
    }>('GET', `users${query}`);
  },

  async createUser(input: { email: string; password: string; displayName?: string }) {
    return callAdmin<{ user: AdminUser }>('POST', 'users/create', input);
  },

  async updateUserProfile(userId: string, input: {
    displayName: string;
    accountTier?: 'free' | 'pro' | 'pro_max';
    ownedBankQuota: number;
    ownedBankPadCap: number;
    deviceTotalBankCap: number;
    featureOverrides?: Record<string, boolean>;
    limitOverrides?: Record<string, number | null>;
    overrideNotes?: string;
  }) {
    return callAdmin<{ user: AdminUser }>('POST', `users/${userId}/update-profile`, input);
  },

  async listAccountTierConfigs() {
    return callAdmin<{ tiers: AdminAccountTierConfig[] }>('GET', 'account-tiers');
  },

  async saveAccountTierConfig(input: {
    tier: 'free' | 'pro' | 'pro_max';
    displayName?: string;
    description?: string;
    pricePhp?: number;
    limits?: Record<string, unknown>;
    features?: Record<string, boolean>;
    isActive?: boolean;
  }) {
    return callAdmin<{ tier: AdminAccountTierConfig }>('POST', 'account-tiers/save', input);
  },

  async listAccountUpgradeRequests(input: { q?: string; status?: 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'; page?: number; perPage?: number }) {
    const query = toQueryString({
      q: input.q,
      status: input.status ?? 'pending',
      page: input.page ?? 1,
      perPage: input.perPage ?? 50,
    });
    return callAdmin<{ requests: AdminAccountUpgradeRequest[]; total: number; page: number; perPage: number; totalPages: number }>('GET', `account-upgrades${query}`);
  },

  async accountUpgradeDecision(requestId: string, action: 'approve' | 'reject', rejectionMessage?: string) {
    return callAdmin<{ requestId: string; status: 'approved' | 'rejected' }>('POST', `account-upgrades/${requestId}/decision`, { action, rejectionMessage });
  },

  async listVoucherCampaigns() {
    return callAdmin<{ campaigns: AdminVoucherCampaign[] }>('GET', 'vouchers');
  },

  async createVoucherCampaign(input: {
    name: string;
    targetTier: 'pro' | 'pro_max';
    maxCodes: number;
    expiresAt?: string | null;
    targetEmail?: string | null;
    targetUserId?: string | null;
    notes?: string | null;
  }) {
    return callAdmin<{ campaign: AdminVoucherCampaign }>('POST', 'vouchers/campaigns/create', input);
  },

  async copyNextVoucher(campaignId: string) {
    return callAdmin<{ voucher: Record<string, unknown>; code: string }>('POST', `vouchers/${campaignId}/copy-next`);
  },

  async revokeLatestVoucher(campaignId: string) {
    return callAdmin<{ campaignId: string; voucherId: string; status: string }>('POST', `vouchers/${campaignId}/revoke-latest`);
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
    page?: number;
    perPage?: number;
    sortBy?: 'title' | 'created_at' | 'access_count';
    sortDir?: SortDirection;
    }) {
      const query = toQueryString({
        q: input.q,
        page: input.page ?? 1,
        perPage: input.perPage ?? 100,
      sortBy: input.sortBy ?? 'created_at',
      sortDir: input.sortDir ?? 'desc',
    });
    return callAdmin<{
      banks: AdminBank[];
      total: number;
      page: number;
      perPage: number;
      sortBy: string;
      sortDir: SortDirection;
      includeDeleted: boolean;
    }>('GET', `banks${query}`);
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

  async listActiveSessions(input: {
      q?: string;
      page?: number;
      perPage?: number;
      activeTodayPage?: number;
      activeTodayPerPage?: number;
      sortBy?: 'user_id' | 'email' | 'device_name' | 'platform' | 'last_seen_at';
      sortDir?: SortDirection;
    }) {
      const query = toQueryString({
        q: input.q,
        page: input.page ?? 1,
        perPage: input.perPage ?? 100,
        activeTodayPage: input.activeTodayPage ?? 1,
        activeTodayPerPage: input.activeTodayPerPage ?? 100,
        sortBy: input.sortBy ?? 'last_seen_at',
        sortDir: input.sortDir ?? 'desc',
        });
        return callAdmin<{
          counts: AdminActiveSessionCounts;
          sessions: ActiveSessionRow[];
          activeTodaySessions: ActiveSessionRow[];
          total: number;
          page: number;
          perPage: number;
          activeTodayTotal: number;
          activeTodayPage: number;
          activeTodayPerPage: number;
          sortBy: string;
          sortDir: SortDirection;
        }>(
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
    status?: 'all' | 'pending' | 'approved' | 'rejected';
    paymentChannel?: 'all' | 'image_proof' | 'gcash_manual' | 'maya_manual';
    decisionSource?: 'all' | 'manual' | 'automation';
    automationResult?: 'all' | 'approved' | 'manual_review_disabled' | 'outside_window' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'duplicate_reference' | 'wallet_number_mismatch' | 'amount_mismatch' | 'ocr_failed' | 'approval_error' | 'not_image_proof';
    ocrStatus?: 'all' | 'detected' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'failed' | 'unavailable' | 'skipped';
  }) {
    const query = toQueryString({
      filter: input.filter ?? 'pending',
      q: input.q,
      page: input.page ?? 1,
      perPage: input.perPage ?? 10,
      status: input.status ?? 'all',
      paymentChannel: input.paymentChannel ?? 'all',
      decisionSource: input.decisionSource ?? 'all',
      automationResult: input.automationResult ?? 'all',
      ocrStatus: input.ocrStatus ?? 'all',
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
    input: { action: 'approve' | 'approve_assisted' | 'reject' | 'refund'; rejection_message?: string; temporary_password?: string }
  ) {
    return callStoreApi<{
      requestId: string;
      status: 'approved' | 'rejected';
      refunded?: boolean;
      refunded_at?: string | null;
      refunded_by?: string | null;
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

  async getLandingDownloadConfig() {
    return callStoreApi<{ config: LandingDownloadConfig }>('GET', 'admin/store/landing-config');
  },

  async saveLandingDownloadConfig(input: LandingDownloadConfig) {
    return callStoreApi<{ config: LandingDownloadConfig }>('POST', 'admin/store/landing-config', input);
  },

  async getLegalDocuments() {
    return callStoreApi<{ documents: AdminLegalDocumentState }>('GET', 'admin/store/legal-documents');
  },

  async saveLegalDocumentDraft(input: LegalDocument) {
    return callStoreApi<{ document: LegalDocument }>('POST', 'admin/store/legal-documents/draft', input);
  },

  async publishLegalDocument(documentKey: LegalDocumentKey) {
    return callStoreApi<{ document: LegalDocument }>('POST', 'admin/store/legal-documents/publish', { documentKey });
  },

  async getSamplerAppConfig() {
    return callStoreApi<{ config: SamplerAppConfig }>('GET', 'admin/store/sampler-config');
  },

  async saveSamplerAppConfig(input: SamplerAppConfig) {
    return callStoreApi<{ config: SamplerAppConfig }>('POST', 'admin/store/sampler-config', input);
  },

  async listStoreCatalog() {
    return callStoreApi<{
      items: AdminStoreCatalogItem[];
      banners: Array<Record<string, unknown>>;
    }>('GET', 'admin/store/catalog');
  },

  async listCatalogUploadSessions(catalogItemId: string) {
    return callAdmin<{
      sessions: AdminCatalogUploadSession[];
      item: AdminStoreCatalogItem | Record<string, unknown>;
    }>('GET', `store/catalog/${catalogItemId}/upload-sessions`);
  },

  async promoteCatalogUploadSession(catalogItemId: string, sessionId: string) {
    return callAdmin<{
      item: AdminStoreCatalogItem;
      session: AdminCatalogUploadSession;
    }>('POST', `store/catalog/${catalogItemId}/promote-upload-session`, { sessionId });
  },

  async deleteCatalogUploadSession(catalogItemId: string, sessionId: string) {
    return callAdmin<{ deleted: boolean; sessionId: string }>(
      'POST',
      `store/catalog/${catalogItemId}/delete-upload-session`,
      { sessionId },
    );
  },

  async listCatalogAssetVariants(catalogItemId: string) {
    return callAdmin<{
      variants: AdminCatalogAssetVariant[];
      item: AdminStoreCatalogItem | Record<string, unknown>;
    }>('GET', `store/catalog/${catalogItemId}/asset-variants`);
  },

  async startLowMemoryCatalogVariantUpload(
    catalogItemId: string,
    payload: {
      totalFileSizeBytes: number;
      sourceAssetSha256?: string | null;
      minClientVersion?: string | null;
      manifest: {
        fileSizeBytes: number;
        sha256?: string | null;
        assetName?: string | null;
      };
      parts: Array<{
        partIndex: number;
        fileSizeBytes: number;
        sha256?: string | null;
        padStartIndex: number;
        padEndIndex: number;
        assetName?: string | null;
      }>;
    },
  ) {
    return callAdmin<{
      variant: AdminCatalogAssetVariant;
      manifestUpload: { storageBucket: string; storageKey: string; uploadUrl: string };
      partUploads: Array<{ partIndex: number; storageBucket: string; storageKey: string; uploadUrl: string }>;
    }>('POST', `store/catalog/${catalogItemId}/start-low-memory-upload`, payload);
  },

  async completeLowMemoryCatalogVariantUpload(catalogItemId: string, variantId: string) {
    return callAdmin<{ variant: AdminCatalogAssetVariant }>(
      'POST',
      `store/catalog/${catalogItemId}/complete-low-memory-upload`,
      { variantId },
    );
  },

  async deleteCatalogAssetVariant(catalogItemId: string, variantId: string, variantType: 'full' | 'low_memory_segmented' = 'low_memory_segmented') {
    return callAdmin<{ deleted: boolean; variantId: string }>(
      'POST',
      `store/catalog/${catalogItemId}/delete-asset-variant`,
      { variantId, variantType },
    );
  },

  async listClientCrashReports(input: {
    q?: string;
    page?: number;
    perPage?: number;
    status?: 'all' | 'new' | 'acknowledged' | 'fixed' | 'ignored';
    domain?: 'all' | 'bank_store' | 'playback' | 'global_runtime';
    platform?: string;
    appVersion?: string;
  }) {
    const query = toQueryString({
      q: input.q,
      page: input.page ?? 1,
      perPage: input.perPage ?? 10,
      status: input.status ?? 'all',
      domain: input.domain ?? 'all',
      platform: input.platform ?? 'all',
      appVersion: input.appVersion ?? 'all',
    });
    return callStoreApi<{
      reports: AdminClientCrashReport[];
      total: number;
      totalCount: number;
      newCount: number;
      page: number;
      perPage: number;
    }>('GET', `admin/store/crash-reports${query}`);
  },

  async updateClientCrashReportStatus(
    reportId: string,
    status: 'new' | 'acknowledged' | 'fixed' | 'ignored',
  ) {
    return callStoreApi<{
      report: { id: string; status: 'new' | 'acknowledged' | 'fixed' | 'ignored'; updated_at: string };
    }>('PATCH', `admin/store/crash-reports/${reportId}`, { status });
  },

  async listInstallerPackages(version: InstallerVersionKey) {
    return callStoreApi<{
      version: InstallerVersionKey;
      items: InstallerPackage[];
    }>('GET', `admin/store/installer/packages?version=${encodeURIComponent(version)}`);
  },

  async saveInstallerPackage(input: InstallerPackage) {
    return callStoreApi<{
      item: InstallerPackage | null;
    }>('POST', 'admin/store/installer/packages/save', input);
  },

  async deleteInstallerPackage(input: { version: InstallerVersionKey; productCode: string }) {
    return callStoreApi<{
      deleted: boolean;
      version: InstallerVersionKey;
      productCode: string;
    }>('POST', 'admin/store/installer/packages/delete', input);
  },

  async listInstallerLicenses(input: {
    version: InstallerVersionKey;
    q?: string;
    status?: 'all' | 'available' | 'claimed' | 'used' | 'disabled';
    page?: number;
    perPage?: number;
  }) {
    const query = toQueryString({
      version: input.version,
      q: input.q,
      status: input.status ?? 'all',
      page: input.page ?? 1,
      perPage: input.perPage ?? 20,
    });
    return callStoreApi<{
      version: InstallerVersionKey;
      items: AdminInstallerLicense[];
      total: number;
      page: number;
      perPage: number;
    }>('GET', `admin/store/installer/licenses${query}`);
  },

  async listInstallerEvents(input: {
    version: InstallerVersionKey;
    q?: string;
    eventType?: 'all' | 'claim' | 'complete' | 'release';
    licenseId?: number;
    page?: number;
    perPage?: number;
  }) {
    const query = toQueryString({
      version: input.version,
      q: input.q,
      eventType: input.eventType ?? 'all',
      licenseId: input.licenseId,
      page: input.page ?? 1,
      perPage: input.perPage ?? 20,
    });
    return callStoreApi<{
      version: InstallerVersionKey;
      items: AdminInstallerEvent[];
      total: number;
      page: number;
      perPage: number;
    }>('GET', `admin/store/installer/events${query}`);
  },

  async createInstallerLicense(input: {
    code?: string;
    version: InstallerVersionKey;
    customerName?: string;
    notes?: string;
    unlimited?: boolean;
    entitlements: string[];
  }) {
    return callStoreApi<{
      rawCode: string;
      item: AdminInstallerLicense | null;
    }>('POST', 'admin/store/installer/licenses/create', input);
  },

  async updateInstallerLicense(input: {
    id: number;
    customerName?: string;
    notes?: string;
    unlimited?: boolean;
    disabled?: boolean;
    entitlements: string[];
  }) {
    return callStoreApi<{
      item: AdminInstallerLicense | null;
    }>('POST', 'admin/store/installer/licenses/update', input);
  },

  async resetInstallerLicense(id: number) {
    return callStoreApi<{
      item: AdminInstallerLicense | null;
    }>('POST', 'admin/store/installer/licenses/reset', { id });
  },

  async deleteInstallerLicense(id: number) {
    return callStoreApi<{
      deleted: boolean;
      id: number;
    }>('POST', 'admin/store/installer/licenses/delete', { id });
  },

  async listInstallerBuyProducts(version?: InstallerVersionKey) {
    const query = toQueryString({ version });
    return callStoreApi<{
      items: InstallerBuyProduct[];
    }>('GET', `admin/store/installer-buy/products${query}`);
  },

  async saveInstallerBuyProduct(input: InstallerBuyProduct) {
    return callStoreApi<{
      item: InstallerBuyProduct | null;
    }>('POST', 'admin/store/installer-buy/products/save', input);
  },

  async deleteInstallerBuyProduct(input: { version: InstallerVersionKey; skuCode: string }) {
    return callStoreApi<{
      deleted: boolean;
      version: InstallerVersionKey;
      skuCode: string;
    }>('POST', 'admin/store/installer-buy/products/delete', input);
  },

  async listInstallerPurchaseRequests(input: {
    version?: InstallerVersionKey;
    q?: string;
    status?: 'all' | 'pending' | 'approved' | 'rejected';
    page?: number;
    perPage?: number;
  }) {
    const query = toQueryString({
      version: input.version,
      q: input.q,
      status: input.status ?? 'all',
      page: input.page ?? 1,
      perPage: input.perPage ?? 20,
    });
    return callStoreApi<{
      items: AdminInstallerPurchaseRequest[];
      total: number;
      page: number;
      perPage: number;
    }>('GET', `admin/store/installer-buy/requests${query}`);
  },

  async listInstallerPurchaseRequestGroups(input: {
    scope?: 'pending' | 'history';
    q?: string;
    status?: 'all' | 'pending' | 'approved' | 'rejected';
    channel?: 'all' | 'image_proof' | 'gcash_manual' | 'maya_manual';
    decision?: 'all' | 'manual' | 'automation';
    automation?: 'all' | 'approved' | 'manual_review_disabled' | 'outside_window' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'duplicate_reference' | 'wallet_number_mismatch' | 'amount_mismatch' | 'ocr_failed' | 'approval_error' | 'not_image_proof';
    ocrStatus?: 'all' | 'detected' | 'missing_reference' | 'missing_amount' | 'missing_recipient_number' | 'failed' | 'unavailable' | 'skipped';
    version?: 'all' | InstallerVersionKey;
    skuCode?: string;
    page?: number;
    perPage?: number;
  }) {
    const query = toQueryString({
      scope: input.scope ?? 'pending',
      q: input.q,
      status: input.status ?? 'all',
      channel: input.channel ?? 'all',
      decision: input.decision ?? 'all',
      automation: input.automation ?? 'all',
      ocrStatus: input.ocrStatus ?? 'all',
      version: input.version && input.version !== 'all' ? input.version : undefined,
      skuCode: input.skuCode,
      page: input.page ?? 1,
      perPage: input.perPage ?? 20,
    });
    return callStoreApi<{
      items: AdminInstallerPurchaseRequestGroup[];
      total: number;
      page: number;
      perPage: number;
      pendingCount: number;
      historyCount: number;
    }>('GET', `admin/store/installer-buy/request-groups${query}`);
  },

  async installerPurchaseRequestAction(
    requestId: string,
    input: { action: 'approve' | 'reject' | 'refund'; rejection_message?: string }
  ) {
    return callStoreApi<{
      requestId: string;
      status: 'approved' | 'rejected';
      refunded?: boolean;
      refunded_at?: string | null;
      refunded_by?: string | null;
      issued_license_code?: string | null;
      installer_download_link?: string | null;
      decision_email_status?: 'pending' | 'sent' | 'failed' | 'skipped';
      decision_email_error?: string | null;
    }>('POST', `admin/store/installer-buy/requests/${requestId}`, input);
  },
};
