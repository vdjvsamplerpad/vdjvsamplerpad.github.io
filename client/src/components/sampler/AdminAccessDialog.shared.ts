import type {
  AdminDashboardOverview,
  AdminUser,
  SortDirection,
} from '@/lib/admin-api';
import { validateManagedImageFile } from '@/lib/image-upload';
import { LED_COLOR_PALETTE } from '@/lib/led-colors';

export interface AdminAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  defaultBankSourceOptions?: DefaultBankSourceOption[];
  onPublishDefaultBankRelease?: (
    bankId: string,
    options?: { releaseNotes?: string; minAppVersion?: string }
  ) => Promise<string>;
}

export type AdminDialogTheme = AdminAccessDialogProps['theme'];
export interface DefaultBankSourceOption {
  id: string;
  title: string;
  padCount: number;
  isDefaultBank: boolean;
}
export type TabKey =
  | 'home'
  | 'assignments'
  | 'banks'
  | 'sampler_defaults'
  | 'default_bank'
  | 'users'
  | 'active'
  | 'activity'
  | 'account_requests'
  | 'crash_reports'
  | 'store_requests'
  | 'installer_requests'
  | 'store_catalog'
  | 'store_promotions'
  | 'store_banners'
  | 'landing_download'
  | 'store_config'
  | 'installer';
export type UserSortBy = 'display_name' | 'email' | 'created_at' | 'last_sign_in_at' | 'ban_status';
export type BankSortBy = 'title' | 'created_at' | 'access_count';
export type AssignmentUserSortBy = 'display_name' | 'email' | 'created_at';
export type AssignmentBankSortBy = 'title' | 'status' | 'access_count';
export type ActiveSortBy = 'user_id' | 'email' | 'device_name' | 'platform' | 'last_seen_at';
export type ActivitySortBy = 'created_at' | 'event_type' | 'status' | 'email' | 'bank_name';
export type StoreCatalogSort = 'title_asc' | 'title_desc' | 'price_high' | 'price_low' | 'status' | 'pinned_first' | 'newest';
export type RequestListFilter = 'pending' | 'history';
export type RequestStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
export type RequestChannelFilter = 'all' | 'image_proof' | 'gcash_manual' | 'maya_manual';
export type RequestDecisionFilter = 'all' | 'manual' | 'automation';
export type RequestAutomationFilter =
  | 'all'
  | 'approved'
  | 'manual_review_disabled'
  | 'outside_window'
  | 'missing_reference'
  | 'missing_amount'
  | 'missing_recipient_number'
  | 'duplicate_reference'
  | 'wallet_number_mismatch'
  | 'amount_mismatch'
  | 'ocr_failed'
  | 'approval_error'
  | 'not_image_proof';
export type RequestOcrStatusFilter =
  | 'all'
  | 'detected'
  | 'missing_reference'
  | 'missing_amount'
  | 'missing_recipient_number'
  | 'failed'
  | 'unavailable'
  | 'skipped';
export type TabTone =
  | 'blue'
  | 'emerald'
  | 'violet'
  | 'cyan'
  | 'amber'
  | 'rose'
  | 'orange'
  | 'teal'
  | 'fuchsia';

export const ACTIVE_SORT_STORAGE_KEY = 'vdjv-admin-active-sort';

export const ACCOUNT_ASSISTED_MIN_PASSWORD = 8;

export const generateAssistedPassword = (): string => {
  const seed = Math.random().toString(36).slice(2, 8);
  return `Assist!${seed}9`;
};

export const validateStoreQrFile = (file: File): string | null => validateManagedImageFile(file, 'qr');

export const validateStoreBannerFile = (file: File): string | null => validateManagedImageFile(file, 'banner');

export const TABS: Array<{
  key: TabKey;
  label: string;
  emoji: string;
  hint: string;
  tone: TabTone;
}> = [
  { key: 'home', label: 'Home', emoji: '🏠', hint: 'Overview dashboard for priority admin signals', tone: 'blue' },
  { key: 'assignments', label: 'Assignments', emoji: '🧩', hint: 'Grant and revoke bank access', tone: 'blue' },
  { key: 'banks', label: 'Banks', emoji: '🎵', hint: 'Manage bank metadata and archive', tone: 'emerald' },
  { key: 'users', label: 'Users', emoji: '👥', hint: 'Manage user accounts and status', tone: 'violet' },
  { key: 'active', label: 'Active', emoji: '🟢', hint: 'Monitor online user sessions', tone: 'cyan' },
  { key: 'activity', label: 'Activity', emoji: '📋', hint: 'Review export/import audit logs', tone: 'amber' },
  { key: 'sampler_defaults', label: 'Sampler Defaults', emoji: 'SD', hint: 'Control first-run sampler defaults and limits', tone: 'violet' },
  { key: 'account_requests', label: 'Account Requests', emoji: '✅', hint: 'Approve or reject account registration', tone: 'rose' },
  { key: 'crash_reports', label: 'Crash Reports', emoji: 'CR', hint: 'Review client-submitted crash diagnostics', tone: 'amber' },
  { key: 'store_requests', label: 'Store Requests', emoji: '🛒', hint: 'Handle purchase requests', tone: 'orange' },
  { key: 'installer_requests', label: 'Installer Requests', emoji: 'IR', hint: 'Review bundled installer purchase requests', tone: 'orange' },
  { key: 'store_catalog', label: 'Catalog', emoji: '🏷️', hint: 'Prepare and publish store catalog items', tone: 'teal' },
  { key: 'store_banners', label: 'Banners', emoji: '🖼️', hint: 'Manage marketing banners for store homepage', tone: 'teal' },
  { key: 'store_promotions', label: 'Promotions', emoji: 'SALE', hint: 'Schedule discounts and flash sales', tone: 'teal' },
  { key: 'default_bank', label: 'Default Bank', emoji: 'DB', hint: 'Publish and roll back versioned default-bank releases', tone: 'teal' },
  { key: 'landing_download', label: 'Landing Download', emoji: 'LD', hint: 'Manage landing page download links and descriptions', tone: 'fuchsia' },
  { key: 'store_config', label: 'Pay Config', emoji: '💳', hint: 'Configure payment details and QR', tone: 'fuchsia' },
  { key: 'installer', label: 'Installer', emoji: 'IN', hint: 'Manage V2 and V3 installer packages and licenses', tone: 'fuchsia' },
];

export const TAB_TONE_CLASSES: Record<
  TabTone,
  { activeLight: string; inactiveLight: string; activeDark: string; inactiveDark: string }
> = {
  blue: {
    activeLight: 'bg-blue-600 border-blue-600 text-white',
    inactiveLight: 'border-blue-300 text-blue-700 hover:bg-blue-50',
    activeDark: 'bg-blue-500 border-blue-400 text-white',
    inactiveDark: 'border-blue-500/40 text-blue-200 hover:bg-blue-500/20',
  },
  emerald: {
    activeLight: 'bg-emerald-600 border-emerald-600 text-white',
    inactiveLight: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
    activeDark: 'bg-emerald-500 border-emerald-400 text-white',
    inactiveDark: 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/20',
  },
  violet: {
    activeLight: 'bg-violet-600 border-violet-600 text-white',
    inactiveLight: 'border-violet-300 text-violet-700 hover:bg-violet-50',
    activeDark: 'bg-violet-500 border-violet-400 text-white',
    inactiveDark: 'border-violet-500/40 text-violet-200 hover:bg-violet-500/20',
  },
  cyan: {
    activeLight: 'bg-cyan-600 border-cyan-600 text-white',
    inactiveLight: 'border-cyan-300 text-cyan-700 hover:bg-cyan-50',
    activeDark: 'bg-cyan-500 border-cyan-400 text-white',
    inactiveDark: 'border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/20',
  },
  amber: {
    activeLight: 'bg-amber-500 border-amber-500 text-black',
    inactiveLight: 'border-amber-300 text-amber-800 hover:bg-amber-50',
    activeDark: 'bg-amber-400 border-amber-300 text-black',
    inactiveDark: 'border-amber-500/40 text-amber-200 hover:bg-amber-500/20',
  },
  rose: {
    activeLight: 'bg-rose-600 border-rose-600 text-white',
    inactiveLight: 'border-rose-300 text-rose-700 hover:bg-rose-50',
    activeDark: 'bg-rose-500 border-rose-400 text-white',
    inactiveDark: 'border-rose-500/40 text-rose-200 hover:bg-rose-500/20',
  },
  orange: {
    activeLight: 'bg-orange-600 border-orange-600 text-white',
    inactiveLight: 'border-orange-300 text-orange-700 hover:bg-orange-50',
    activeDark: 'bg-orange-500 border-orange-400 text-white',
    inactiveDark: 'border-orange-500/40 text-orange-200 hover:bg-orange-500/20',
  },
  teal: {
    activeLight: 'bg-teal-600 border-teal-600 text-white',
    inactiveLight: 'border-teal-300 text-teal-700 hover:bg-teal-50',
    activeDark: 'bg-teal-500 border-teal-400 text-white',
    inactiveDark: 'border-teal-500/40 text-teal-200 hover:bg-teal-500/20',
  },
  fuchsia: {
    activeLight: 'bg-fuchsia-600 border-fuchsia-600 text-white',
    inactiveLight: 'border-fuchsia-300 text-fuchsia-700 hover:bg-fuchsia-50',
    activeDark: 'bg-fuchsia-500 border-fuchsia-400 text-white',
    inactiveDark: 'border-fuchsia-500/40 text-fuchsia-200 hover:bg-fuchsia-500/20',
  },
};

export const TAB_CONTENT_TONE_CLASSES: Record<
  TabTone,
  { panelLight: string; panelDark: string; cardLight: string; cardDark: string; textLight: string; textDark: string }
> = {
  blue: {
    panelLight: 'border-blue-200 bg-blue-50/30',
    panelDark: 'border-blue-500/30 bg-blue-500/10',
    cardLight: 'border-blue-200 bg-white',
    cardDark: 'border-blue-500/25 bg-blue-950/20',
    textLight: 'text-blue-700',
    textDark: 'text-blue-200',
  },
  emerald: {
    panelLight: 'border-emerald-200 bg-emerald-50/30',
    panelDark: 'border-emerald-500/30 bg-emerald-500/10',
    cardLight: 'border-emerald-200 bg-white',
    cardDark: 'border-emerald-500/25 bg-emerald-950/20',
    textLight: 'text-emerald-700',
    textDark: 'text-emerald-200',
  },
  violet: {
    panelLight: 'border-violet-200 bg-violet-50/30',
    panelDark: 'border-violet-500/30 bg-violet-500/10',
    cardLight: 'border-violet-200 bg-white',
    cardDark: 'border-violet-500/25 bg-violet-950/20',
    textLight: 'text-violet-700',
    textDark: 'text-violet-200',
  },
  cyan: {
    panelLight: 'border-cyan-200 bg-cyan-50/30',
    panelDark: 'border-cyan-500/30 bg-cyan-500/10',
    cardLight: 'border-cyan-200 bg-white',
    cardDark: 'border-cyan-500/25 bg-cyan-950/20',
    textLight: 'text-cyan-700',
    textDark: 'text-cyan-200',
  },
  amber: {
    panelLight: 'border-amber-200 bg-amber-50/30',
    panelDark: 'border-amber-500/30 bg-amber-500/10',
    cardLight: 'border-amber-200 bg-white',
    cardDark: 'border-amber-500/25 bg-amber-950/20',
    textLight: 'text-amber-800',
    textDark: 'text-amber-200',
  },
  rose: {
    panelLight: 'border-rose-200 bg-rose-50/30',
    panelDark: 'border-rose-500/30 bg-rose-500/10',
    cardLight: 'border-rose-200 bg-white',
    cardDark: 'border-rose-500/25 bg-rose-950/20',
    textLight: 'text-rose-700',
    textDark: 'text-rose-200',
  },
  orange: {
    panelLight: 'border-orange-200 bg-orange-50/30',
    panelDark: 'border-orange-500/30 bg-orange-500/10',
    cardLight: 'border-orange-200 bg-white',
    cardDark: 'border-orange-500/25 bg-orange-950/20',
    textLight: 'text-orange-700',
    textDark: 'text-orange-200',
  },
  teal: {
    panelLight: 'border-teal-200 bg-teal-50/30',
    panelDark: 'border-teal-500/30 bg-teal-500/10',
    cardLight: 'border-teal-200 bg-white',
    cardDark: 'border-teal-500/25 bg-teal-950/20',
    textLight: 'text-teal-700',
    textDark: 'text-teal-200',
  },
  fuchsia: {
    panelLight: 'border-fuchsia-200 bg-fuchsia-50/30',
    panelDark: 'border-fuchsia-500/30 bg-fuchsia-500/10',
    cardLight: 'border-fuchsia-200 bg-white',
    cardDark: 'border-fuchsia-500/25 bg-fuchsia-950/20',
    textLight: 'text-fuchsia-700',
    textDark: 'text-fuchsia-200',
  },
};

export const isUserBanned = (user: AdminUser | null): boolean => {
  if (!user?.banned_until) return false;
  const dt = new Date(user.banned_until).getTime();
  return !Number.isNaN(dt) && dt > Date.now();
};

const BANK_COLOR_NAMES = [
  'Dim Gray',
  'Gray',
  'White',
  'Red',
  'Amber',
  'Orange',
  'Light Yellow',
  'Yellow',
  'Green',
  'Aqua',
  'Blue',
  'Pure Blue',
  'Violet',
  'Purple',
  'Hot Pink',
  'Hot Pink 2',
  'Deep Magenta',
  'Deep Brown 2',
];

export const colorOptions = BANK_COLOR_NAMES
  .map((name) => LED_COLOR_PALETTE.find((entry) => entry.name === name))
  .filter(Boolean)
  .map((entry) => ({ label: entry!.name, value: entry!.hex }));

export const PAGE_SIZE = 10;
export const HOME_WINDOW_OPTIONS = [7, 14, 30, 90, 180, 365] as const;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const toIsoDateOnly = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseIsoDateOnly = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const isValidHttpUrl = (value: string): boolean => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export interface PurchaseRequest {
  id: string;
  catalog_item_id: string;
  user_id: string;
  batch_id?: string;
  status: 'pending' | 'approved' | 'rejected';
  is_refunded?: boolean;
  refunded_at?: string | null;
  refunded_by?: string | null;
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
  bank_catalog_items?: {
    is_paid?: boolean | null;
    price_php?: number | string | null;
    banks?: { title: string } | null;
  } | null;
  banks?: { title: string };
  user_profile?: { display_name: string; email: string } | null;
}

export interface CatalogDraft {
  id: string;
  bank_id: string;
  item_type?: 'single_bank' | 'bank_bundle';
  status: 'draft' | 'published' | 'archived';
  coming_soon?: boolean;
  is_paid: boolean;
  requires_grant: boolean;
  is_pinned: boolean;
  price_php: number | null;
  expected_asset_name: string;
  thumbnail_path?: string | null;
  bundle_title?: string;
  bundle_description?: string;
  bundle_bank_ids?: string[];
  bundle_bank_titles?: string[];
  bundle_count?: number;
  bank: {
    title: string;
    description?: string;
    color?: string;
  };
}

export interface StorePromotionTargetLabel {
  type: 'bank' | 'catalog';
  id: string;
  label: string;
}

export type StorePromotionAudienceType = 'all' | 'specific_users' | 'new_users_window';

export interface StorePromotion {
  id: string;
  name: string;
  description?: string | null;
  promotion_type: 'standard' | 'flash_sale';
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  starts_at: string;
  ends_at: string;
  timezone: string;
  badge_text?: string | null;
  priority: number;
  is_active: boolean;
  status: 'inactive' | 'scheduled' | 'active' | 'expired';
  audience_type: StorePromotionAudienceType;
  new_user_window_hours?: number | null;
  target_bank_ids: string[];
  target_catalog_item_ids: string[];
  target_user_ids: string[];
  target_labels: StorePromotionTargetLabel[];
}

export interface StoreMarketingBanner {
  id: string;
  image_url: string;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StoreConfigDraft {
  instructions: string;
  gcash_number: string;
  maya_number: string;
  messenger_url: string;
  qr_image_path: string;
  account_price_php: string;
  banner_rotation_ms: string;
  store_maintenance_enabled: boolean;
  store_maintenance_message: string;
  account_auto_approve_enabled: boolean;
  account_auto_approve_mode: 'schedule' | 'countdown' | 'always';
  account_auto_approve_start_hour: string;
  account_auto_approve_end_hour: string;
  account_auto_approve_duration_hours: string;
  account_auto_approve_expires_at: string | null;
  store_auto_approve_enabled: boolean;
  store_auto_approve_mode: 'schedule' | 'countdown' | 'always';
  store_auto_approve_start_hour: string;
  store_auto_approve_end_hour: string;
  store_auto_approve_duration_hours: string;
  store_auto_approve_expires_at: string | null;
  installer_v2_auto_approve_enabled: boolean;
  installer_v2_auto_approve_mode: 'schedule' | 'countdown' | 'always';
  installer_v2_auto_approve_start_hour: string;
  installer_v2_auto_approve_end_hour: string;
  installer_v2_auto_approve_duration_hours: string;
  installer_v2_auto_approve_expires_at: string | null;
  installer_v3_auto_approve_enabled: boolean;
  installer_v3_auto_approve_mode: 'schedule' | 'countdown' | 'always';
  installer_v3_auto_approve_start_hour: string;
  installer_v3_auto_approve_end_hour: string;
  installer_v3_auto_approve_duration_hours: string;
  installer_v3_auto_approve_expires_at: string | null;
  store_email_approve_subject: string;
  store_email_approve_body: string;
  store_email_reject_subject: string;
  store_email_reject_body: string;
}

export type HomeTrendRows = AdminDashboardOverview['trends'];


