import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import {
  createR2DirectUploadSession,
  finalizeR2DirectUploadSession,
  readR2DirectUploadSession,
} from "../_shared/r2-direct-upload.ts";
import { createPresignedPutUrl, deleteObject, headObject } from "../_shared/r2-storage.ts";
import {
  createSignedAdminExportToken,
  isAdminExportTokenSigningEnabled,
} from "../_shared/admin-export-token.ts";
import { DEFAULT_SAMPLER_APP_CONFIG, normalizeSamplerAppConfig } from "../_shared/sampler-app-config.ts";
import { createServiceClient, getUserFromAuthHeader, isAdminUser } from "../_shared/supabase.ts";
import { asNumber, asString, asUuid } from "../_shared/validate.ts";
import { consumeRateLimit } from "../_shared/rate-limit.ts";
import { sendDiscordAdminActionEvent } from "../_shared/discord.ts";
import {
  type StoredAccountTier,
  buildAccountCapabilitySnapshot,
  loadAccountCapabilitySnapshot,
  normalizeTierPrice,
} from "../_shared/account-capabilities.ts";

type SortDirection = "asc" | "desc";
type ActivityEventType = "auth.login" | "auth.signup" | "auth.signout" | "bank.export" | "bank.import";
type ActivityStatus = "success" | "failed";
type ActivitySortBy = "created_at" | "event_type" | "status" | "email" | "bank_name";
type ActivityUploadResult = "success" | "failed" | "duplicate_no_change";
type ActivityScope = "export" | "auth" | "non_export" | "all";
type CatalogAssetProtection = "encrypted" | "public";
type ActiveSessionSortBy = "user_id" | "email" | "device_name" | "platform" | "last_seen_at";

type AdminRoute = {
  section: string;
  id: string | null;
  action: string | null;
};

type R2UploadTarget = {
  bucket: string;
  objectKey: string;
  assetName: string;
};

type AdminCatalogUploadSessionView = {
  id: string;
  catalog_item_id: string | null;
  bank_id: string | null;
  status: string;
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
  asset_protection: CatalogAssetProtection;
  operation_type: "create" | "update";
  is_current_catalog_asset: boolean;
};

type CatalogAssetVariantType = "full" | "low_memory_segmented";
type CatalogAssetVariantStatus = "uploading" | "ready" | "failed";

type AdminCatalogAssetVariantPartView = {
  id: string;
  part_index: number;
  storage_bucket: string;
  storage_key: string;
  asset_name: string | null;
  file_size_bytes: number;
  sha256: string | null;
  pad_start_index: number;
  pad_end_index: number;
  object_exists: boolean;
  actual_file_size_bytes: number | null;
};

type AdminCatalogAssetVariantView = {
  id: string;
  catalog_item_id: string;
  variant_type: CatalogAssetVariantType;
  status: CatalogAssetVariantStatus;
  manifest_storage_bucket: string | null;
  manifest_storage_key: string | null;
  manifest_asset_name: string | null;
  manifest_object_exists: boolean;
  manifest_actual_file_size_bytes: number | null;
  total_file_size_bytes: number | null;
  part_count: number;
  min_client_version: string | null;
  source_asset_sha256: string | null;
  created_at: string | null;
  updated_at: string | null;
  parts: AdminCatalogAssetVariantPartView[];
};

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const ADMIN_STORE_PUBLISH_RATE_LIMIT = readPositiveInt(Deno.env.get("ADMIN_STORE_PUBLISH_RATE_LIMIT"), 30);
const ADMIN_STORE_PUBLISH_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ADMIN_STORE_PUBLISH_RATE_WINDOW_SECONDS"), 3600);
const ADMIN_EXPORT_SIGN_TOKEN_RATE_LIMIT = readPositiveInt(Deno.env.get("ADMIN_EXPORT_SIGN_TOKEN_RATE_LIMIT"), 120);
const ADMIN_EXPORT_SIGN_TOKEN_RATE_WINDOW_SECONDS = readPositiveInt(
  Deno.env.get("ADMIN_EXPORT_SIGN_TOKEN_RATE_WINDOW_SECONDS"),
  3600,
);
const DASHBOARD_SERIES_CAP = readPositiveInt(Deno.env.get("ADMIN_DASHBOARD_SERIES_CAP"), 5000);
const DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT = readPositiveInt(Deno.env.get("ADMIN_DASHBOARD_ACTIVE_SCAN_LIMIT"), 2000);
const DASHBOARD_MAX_WINDOW_DAYS = Math.max(30, readPositiveInt(Deno.env.get("ADMIN_DASHBOARD_MAX_WINDOW_DAYS"), 730));
const ASIA_MANILA_UTC_OFFSET_MINUTES = 8 * 60;
const R2_BUCKET = asString(Deno.env.get("R2_BUCKET"), 200);
const RESEND_API_KEY = asString(Deno.env.get("RESEND_API_KEY"), 1000);
const STORE_EMAIL_FROM = asString(Deno.env.get("STORE_EMAIL_FROM"), 500);
const STORE_EMAIL_REPLY_TO = asString(Deno.env.get("STORE_EMAIL_REPLY_TO"), 500);
const R2_MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const R2_UPLOAD_URL_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, readPositiveInt(Deno.env.get("R2_UPLOAD_URL_TTL_SECONDS"), 900)),
);
const R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, readPositiveInt(Deno.env.get("R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS"), 900)),
);
const textEncoder = new TextEncoder();

const resolveSupabaseUrl = (): string =>
  Deno.env.get("APP_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";

const resolveSupabaseAnonKey = (): string =>
  Deno.env.get("APP_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

const ok = (data: Record<string, unknown>, status = 200) =>
  json(status, { ok: true, data, ...data });

const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  json(status, { ok: false, error, ...(extra || {}) });

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const swallowDiscordError = async (task: () => Promise<void>) => {
  try {
    await task();
  } catch {
    // Discord is secondary monitoring only.
  }
};

const normalizeEmail = (value: unknown): string | null => {
  const normalized = asString(value, 320)?.trim().toLowerCase() || "";
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatPhpCurrency = (value: unknown): string => {
  const amount = normalizeTierPrice(value);
  return `PHP ${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

const buildReceiptStyleEmailHtml = (input: {
  variant: "approved" | "pending" | "rejected";
  title: string;
  subtitle: string;
  amountLabel?: string;
  amountValue?: string;
  details: Array<{ label: string; value: string | number | null | undefined }>;
  bodyText: string;
}): string => {
  const color = input.variant === "approved"
    ? "#b9ff12"
    : input.variant === "rejected"
      ? "#ff4d6d"
      : "#fbbf24";
  const detailsHtml = input.details
    .map((detail) => `
      <tr>
        <td style="padding:10px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;font-weight:800;letter-spacing:.08em;">${escapeHtml(detail.label)}</td>
        <td style="padding:10px 0;color:#f8fafc;font-size:14px;font-weight:800;text-align:right;">${escapeHtml(detail.value || "-")}</td>
      </tr>
    `)
    .join("");
  const bodyHtml = escapeHtml(input.bodyText).replace(/\n/g, "<br>");
  const amountHtml = input.amountLabel || input.amountValue
    ? `
      <div style="margin:22px 0;padding:16px;border:1px solid rgba(185,255,18,.22);border-radius:12px;background:rgba(185,255,18,.08);">
        <div style="color:#9ca3af;font-size:11px;text-transform:uppercase;font-weight:900;letter-spacing:.12em;">${escapeHtml(input.amountLabel || "Amount")}</div>
        <div style="margin-top:6px;color:#f8fafc;font-size:28px;font-weight:900;">${escapeHtml(input.amountValue || "-")}</div>
      </div>
    `
    : "";
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#05070b;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#f8fafc;">
        <div style="max-width:620px;margin:0 auto;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#0b0f17;overflow:hidden;">
          <div style="height:5px;background:${color};"></div>
          <div style="padding:28px;">
            <div style="color:#ff2b95;font-size:12px;text-transform:uppercase;font-weight:900;letter-spacing:.18em;">VDJV Sampler Pad</div>
            <h1 style="margin:10px 0 0;color:#fff;font-size:28px;line-height:1.15;">${escapeHtml(input.title)}</h1>
            <p style="margin:8px 0 0;color:#cbd5e1;font-size:15px;line-height:1.55;">${escapeHtml(input.subtitle)}</p>
            ${amountHtml}
            <table style="width:100%;border-collapse:collapse;border-top:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1);">
              ${detailsHtml}
            </table>
            <p style="margin:22px 0 0;color:#d1d5db;font-size:14px;line-height:1.65;">${bodyHtml}</p>
          </div>
        </div>
      </body>
    </html>
  `;
};

const sendEmailViaResend = async (input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> => {
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    throw new Error("Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: STORE_EMAIL_FROM,
      to: input.to,
      subject: asString(input.subject, 240) || "VDJV Sampler Pad",
      html: input.html,
      text: input.text,
      reply_to: STORE_EMAIL_REPLY_TO || undefined,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend email failed (${response.status}): ${body.slice(0, 500)}`);
  }
};

const normalizeSortDir = (value: string | null): SortDirection => {
  return String(value || "").toLowerCase() === "asc" ? "asc" : "desc";
};

const normalizeActiveSessionSortBy = (value: string | null): ActiveSessionSortBy => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "user_id" ||
    normalized === "email" ||
    normalized === "device_name" ||
    normalized === "platform" ||
    normalized === "last_seen_at"
  ) {
    return normalized as ActiveSessionSortBy;
  }
  return "last_seen_at";
};

const normalizeActivitySortBy = (value: string | null): ActivitySortBy => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "created_at" ||
    normalized === "event_type" ||
    normalized === "status" ||
    normalized === "email" ||
    normalized === "bank_name"
  ) {
    return normalized as ActivitySortBy;
  }
  return "created_at";
};

const normalizeActivityEventType = (value: string | null): ActivityEventType | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "auth.login" ||
    normalized === "auth.signup" ||
    normalized === "auth.signout" ||
    normalized === "bank.export" ||
    normalized === "bank.import"
  ) {
    return normalized as ActivityEventType;
  }
  return null;
};

const normalizeActivityStatus = (value: string | null): ActivityStatus | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "success" || normalized === "failed") return normalized as ActivityStatus;
  return null;
};

const normalizeActivityUploadResult = (value: string | null): ActivityUploadResult | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "success" || normalized === "failed" || normalized === "duplicate_no_change") {
    return normalized as ActivityUploadResult;
  }
  return null;
};

const normalizeActivityScope = (value: string | null): ActivityScope => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "export" || normalized === "auth" || normalized === "non_export" || normalized === "all") {
    return normalized as ActivityScope;
  }
  return "all";
};

const parseBooleanFlag = (value: string | null, fallback = false): boolean => {
  if (value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeCatalogAssetProtection = (
  value: unknown,
  fallback: CatalogAssetProtection = "encrypted",
): CatalogAssetProtection => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "public" || normalized === "public_free" || normalized === "plain") return "public";
  if (normalized === "encrypted" || normalized === "protected") return "encrypted";
  return fallback;
};

const normalizeCatalogAssetVariantType = (
  value: unknown,
  fallback: CatalogAssetVariantType = "low_memory_segmented",
): CatalogAssetVariantType => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "full") return "full";
  if (normalized === "low_memory_segmented" || normalized === "low-memory-segmented" || normalized === "segmented") {
    return "low_memory_segmented";
  }
  return fallback;
};

const normalizeCatalogAssetVariantStatus = (
  value: unknown,
  fallback: CatalogAssetVariantStatus = "uploading",
): CatalogAssetVariantStatus => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ready") return "ready";
  if (normalized === "failed") return "failed";
  if (normalized === "uploading") return "uploading";
  return fallback;
};

const normalizeHexColor = (value: unknown): string | null => {
  const color = asString(value, 16);
  if (!color) return null;
  const normalized = color.startsWith("#") ? color : `#${color}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return normalized.toLowerCase();
};

const compareNullableText = (a: string | null | undefined, b: string | null | undefined) => {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
};

const compareNullableDate = (a: string | null | undefined, b: string | null | undefined) => {
  const left = a ? new Date(a).getTime() : 0;
  const right = b ? new Date(b).getTime() : 0;
  if (Number.isNaN(left) && Number.isNaN(right)) return 0;
  if (Number.isNaN(left)) return -1;
  if (Number.isNaN(right)) return 1;
  return left - right;
};

const sortRows = <T,>(
  rows: T[],
  sortBy: string,
  sortDir: SortDirection,
  comparators: Record<string, (a: T, b: T) => number>,
): T[] => {
  const compare = comparators[sortBy];
  if (!compare) return rows;
  const sorted = [...rows].sort(compare);
  return sortDir === "asc" ? sorted : sorted.reverse();
};

const paginateRows = <T,>(rows: T[], page: number, perPage: number): T[] => {
  const from = (page - 1) * perPage;
  return rows.slice(from, from + perPage);
};

const parseRoute = (pathname: string): AdminRoute => {
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "admin-api");
  if (index < 0) return { section: "", id: null, action: null };

  const section = parts[index + 1] || "";
  const id = parts[index + 2] || null;
  const action = parts[index + 3] || null;
  return { section, id, action };
};

const parseUuidList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const parsed = asUuid(item);
    if (parsed) unique.add(parsed);
    if (unique.size >= 2000) break;
  }
  return Array.from(unique);
};

const normalizeUpgradeTier = (value: unknown): StoredAccountTier | null => {
  const normalized = asString(value, 32);
  if (normalized === "pro" || normalized === "pro_max") return normalized;
  return null;
};

const normalizeProfileTier = (value: unknown): StoredAccountTier | null => {
  const normalized = asString(value, 32);
  if (normalized === "free" || normalized === "pro" || normalized === "pro_max") return normalized;
  return null;
};

const randomVoucherCode = (): string => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const text = Array.from(bytes).map((byte) => byte.toString(36).padStart(2, "0")).join("").toUpperCase();
  return `VDJV-${text.slice(0, 6)}-${text.slice(6, 12)}-${text.slice(12, 18)}`;
};

const LEGACY_QUOTA_SYNC_BATCH_SIZE = 500;
const LEGACY_QUOTA_CUSTOM_TIER_SOURCES = new Set(["admin", "system"]);

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value.trim().toUpperCase()));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hasLimitOverrideValues = (value: unknown): boolean => (
  Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0)
);

const toLegacyProfileQuotaLimits = (limits: { ownedBankQuota: number; ownedBankPadCap: number; deviceTotalBankCap: number }) => ({
  ownedBankQuota: Math.max(1, Math.min(500, Math.floor(Number(limits.ownedBankQuota) || 1))),
  ownedBankPadCap: Math.max(1, Math.min(256, Math.floor(Number(limits.ownedBankPadCap) || 1))),
  deviceTotalBankCap: Math.max(10, Math.min(1000, Math.floor(Number(limits.deviceTotalBankCap) || 10))),
});

const syncSamplerLegacyQuotaDefaults = async (
  admin: ReturnType<typeof createServiceClient>,
  limits: { ownedBankQuota: number; ownedBankPadCap: number; deviceTotalBankCap: number },
) => {
  const quotaDefaults = {
    ownedBankQuota: limits.ownedBankQuota,
    ownedBankPadCap: limits.ownedBankPadCap,
    deviceTotalBankCap: limits.deviceTotalBankCap,
  };
  const { data: existing, error: existingError } = await admin
    .from("sampler_app_config")
    .select("id")
    .eq("id", "default")
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const writePayload = {
    quota_defaults: quotaDefaults,
    updated_at: new Date().toISOString(),
  };
  const result = existing?.id
    ? await admin.from("sampler_app_config").update(writePayload).eq("id", "default")
    : await admin.from("sampler_app_config").insert({ id: "default", is_active: true, ...writePayload });
  if (result.error) throw new Error(result.error.message);
};

const syncLegacyProfileQuotasForTier = async (
  admin: ReturnType<typeof createServiceClient>,
  tier: StoredAccountTier,
  tierConfig: unknown,
) => {
  const snapshot = buildAccountCapabilitySnapshot({ role: "user", account_tier: tier }, tierConfig, null);
  const limits = toLegacyProfileQuotaLimits(snapshot.limits);
  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id,tier_source")
    .eq("account_tier", tier)
    .neq("role", "admin");
  if (profileError) throw new Error(profileError.message);

  const rows = (profileRows || []) as Array<{ id?: string | null; tier_source?: string | null }>;
  const userIds = rows.map((row) => asUuid(row.id)).filter(Boolean) as string[];
  const overrideUserIds = new Set<string>();
  for (let index = 0; index < userIds.length; index += LEGACY_QUOTA_SYNC_BATCH_SIZE) {
    const chunk = userIds.slice(index, index + LEGACY_QUOTA_SYNC_BATCH_SIZE);
    const { data: overrideRows, error: overrideError } = await admin
      .from("profile_feature_overrides")
      .select("user_id,limits")
      .in("user_id", chunk);
    if (overrideError) throw new Error(overrideError.message);
    for (const row of overrideRows || []) {
      const rowUserId = asUuid((row as any)?.user_id);
      if (rowUserId && hasLimitOverrideValues((row as any)?.limits)) overrideUserIds.add(rowUserId);
    }
  }

  const syncUserIds = rows
    .map((row) => ({ id: asUuid(row.id), tierSource: asString(row.tier_source, 40) || "" }))
    .filter((row): row is { id: string; tierSource: string } => Boolean(row.id))
    .filter((row) => !LEGACY_QUOTA_CUSTOM_TIER_SOURCES.has(row.tierSource))
    .filter((row) => !overrideUserIds.has(row.id))
    .map((row) => row.id);

  for (let index = 0; index < syncUserIds.length; index += LEGACY_QUOTA_SYNC_BATCH_SIZE) {
    const chunk = syncUserIds.slice(index, index + LEGACY_QUOTA_SYNC_BATCH_SIZE);
    const { error } = await admin
      .from("profiles")
      .update({
        owned_bank_quota: limits.ownedBankQuota,
        owned_bank_pad_cap: limits.ownedBankPadCap,
        device_total_bank_cap: limits.deviceTotalBankCap,
      })
      .in("id", chunk);
    if (error) throw new Error(error.message);
  }

  if (tier === "pro") await syncSamplerLegacyQuotaDefaults(admin, limits);
  return { profileCount: syncUserIds.length, samplerDefaultsSynced: tier === "pro" };
};

const applyAccountTierToUser = async (
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  tier: StoredAccountTier,
  source: "admin" | "upgrade_request" | "voucher" | "system",
) => {
  const { data: tierConfig, error: tierConfigError } = await admin
    .from("account_tier_configs")
    .select("tier,limits,features,is_active")
    .eq("tier", tier)
    .maybeSingle();
  if (tierConfigError) throw new Error(tierConfigError.message);
  const tierDefaults = buildAccountCapabilitySnapshot({ id: userId, role: "user", account_tier: tier }, tierConfig, null);
  const legacyProfileLimits = toLegacyProfileQuotaLimits(tierDefaults.limits);
  const { error: tierError } = await admin
    .from("profiles")
    .update({
      account_tier: tier,
      tier_source: source,
      tier_updated_at: new Date().toISOString(),
      owned_bank_quota: legacyProfileLimits.ownedBankQuota,
      owned_bank_pad_cap: legacyProfileLimits.ownedBankPadCap,
      device_total_bank_cap: legacyProfileLimits.deviceTotalBankCap,
    })
    .eq("id", userId);
  if (tierError) throw new Error(tierError.message);

  if (tier === "pro_max") {
    await grantPublishedStoreBanksToUser(admin, userId);
  }

  const snapshot = await loadAccountCapabilitySnapshot(admin, userId);
  return snapshot;
};

const grantPublishedStoreBanksToUser = async (
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
) => {
  const { data: catalogRows, error } = await admin
    .from("bank_catalog_items")
    .select("bank_id,item_type,is_published,coming_soon")
    .eq("is_published", true)
    .eq("item_type", "single_bank")
    .not("bank_id", "is", null);
  if (error) throw new Error(error.message);
  const bankIds = Array.from(new Set((catalogRows || [])
    .filter((row: any) => !row?.coming_soon)
    .map((row: any) => asUuid(row?.bank_id))
    .filter(Boolean) as string[]));
  if (bankIds.length === 0) return;
  const rows = bankIds.map((bankId) => ({ user_id: userId, bank_id: bankId }));
  const { error: upsertError } = await admin
    .from("user_bank_access")
    .upsert(rows, { onConflict: "user_id,bank_id", ignoreDuplicates: true });
  if (upsertError) throw new Error(upsertError.message);
};

const toUtcDateKey = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const startOfFixedOffsetDay = (value: Date, offsetMinutes: number): Date => {
  const shifted = new Date(value.getTime() + (offsetMinutes * 60 * 1000));
  const shiftedStart = startOfUtcDay(shifted);
  return new Date(shiftedStart.getTime() - (offsetMinutes * 60 * 1000));
};

const toFixedOffsetDateKey = (value: Date, offsetMinutes: number): string => {
  const shifted = new Date(value.getTime() + (offsetMinutes * 60 * 1000));
  return toUtcDateKey(shifted);
};

const fixedOffsetDateOnlyStart = (value: Date, offsetMinutes: number): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - (offsetMinutes * 60 * 1000));

const asFiniteNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const parseIsoDateTime = (value: unknown): string | null => {
  const text = asString(value, 80);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseDateOnlyParam = (value: string | null): Date | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

type AttendanceMetrics = {
  attendance_date: string | null;
  first_seen_today_at: string | null;
  last_seen_at: string | null;
  today_heartbeat_count: number;
  attendance_days_7: number;
  attendance_days_30: number;
  attendance_days_total: number;
};

const isMissingAttendanceStorageError = (error: unknown): boolean => {
  const record = asRecord(error);
  const code = String(record.code || "");
  const message = String(record.message || error || "");
  return code === "42P01"
    || code === "42883"
    || code === "PGRST205"
    || /user_daily_attendance/i.test(message)
    || /record_user_daily_attendance/i.test(message)
    || /Could not find the table/i.test(message)
    || /relation .* does not exist/i.test(message);
};

const addDaysToDateKey = (dateKey: string, days: number): string => {
  const parsed = parseDateOnlyParam(dateKey);
  if (!parsed) return dateKey;
  return toUtcDateKey(new Date(parsed.getTime() + (days * 24 * 60 * 60 * 1000)));
};

const emptyAttendanceMetrics = (dateKey: string | null = null): AttendanceMetrics => ({
  attendance_date: dateKey,
  first_seen_today_at: null,
  last_seen_at: null,
  today_heartbeat_count: 0,
  attendance_days_7: 0,
  attendance_days_30: 0,
  attendance_days_total: 0,
});

const ATTENDANCE_METRICS_RPC_CHUNK_SIZE = 500;
const ATTENDANCE_METRICS_FALLBACK_PAGE_SIZE = 1000;

const applyAttendanceAggregateRow = (
  metricsByUser: Map<string, AttendanceMetrics>,
  row: unknown,
  todayDateKey: string,
) => {
  const record = asRecord(row);
  const userId = asUuid(record.user_id);
  if (!userId) return;
  const current = metricsByUser.get(userId) || emptyAttendanceMetrics(todayDateKey);
  current.attendance_date = asString(record.attendance_date, 20) || todayDateKey;
  current.first_seen_today_at = asString(record.first_seen_today_at, 80) || null;
  current.last_seen_at = asString(record.last_seen_at, 80) || null;
  current.today_heartbeat_count = Math.max(0, Math.floor(asFiniteNumber(record.today_heartbeat_count)));
  current.attendance_days_7 = Math.max(0, Math.floor(asFiniteNumber(record.attendance_days_7)));
  current.attendance_days_30 = Math.max(0, Math.floor(asFiniteNumber(record.attendance_days_30)));
  current.attendance_days_total = Math.max(0, Math.floor(asFiniteNumber(record.attendance_days_total)));
  metricsByUser.set(userId, current);
};

const loadAttendanceMetricsForUsers = async (
  admin: ReturnType<typeof createServiceClient>,
  userIdsInput: string[],
  todayDateKey: string,
): Promise<Map<string, AttendanceMetrics>> => {
  const userIds = Array.from(new Set(userIdsInput.map((id) => asUuid(id)).filter(Boolean) as string[]));
  const metricsByUser = new Map<string, AttendanceMetrics>();
  if (userIds.length === 0) return metricsByUser;

  for (const userId of userIds) {
    metricsByUser.set(userId, emptyAttendanceMetrics(todayDateKey));
  }

  let useFallbackTableScan = false;
  for (let index = 0; index < userIds.length; index += ATTENDANCE_METRICS_RPC_CHUNK_SIZE) {
    const chunk = userIds.slice(index, index + ATTENDANCE_METRICS_RPC_CHUNK_SIZE);
    const { data, error } = await admin.rpc("get_user_attendance_metrics", {
      p_user_ids: chunk,
      p_today_date: todayDateKey,
    });
    if (error) {
      if (isMissingAttendanceStorageError(error)) {
        useFallbackTableScan = true;
        break;
      }
      throw new Error(error.message || "Failed to load attendance metrics");
    }
    for (const row of data || []) applyAttendanceAggregateRow(metricsByUser, row, todayDateKey);
  }
  if (!useFallbackTableScan) return metricsByUser;

  const since30DateKey = addDaysToDateKey(todayDateKey, -29);
  const since7DateKey = addDaysToDateKey(todayDateKey, -6);
  for (let userIndex = 0; userIndex < userIds.length; userIndex += ATTENDANCE_METRICS_RPC_CHUNK_SIZE) {
    const chunk = userIds.slice(userIndex, userIndex + ATTENDANCE_METRICS_RPC_CHUNK_SIZE);
    for (let from = 0; ; from += ATTENDANCE_METRICS_FALLBACK_PAGE_SIZE) {
      const { data, error } = await admin
        .from("user_daily_attendance")
        .select("user_id,attendance_date,first_seen_at,last_seen_at,heartbeat_count")
        .in("user_id", chunk)
        .order("attendance_date", { ascending: false })
        .range(from, from + ATTENDANCE_METRICS_FALLBACK_PAGE_SIZE - 1);
      if (error) {
        if (isMissingAttendanceStorageError(error)) return metricsByUser;
        throw new Error(error.message || "Failed to load attendance metrics");
      }
      for (const row of data || []) {
        const userId = asUuid((row as any)?.user_id);
        const attendanceDate = asString((row as any)?.attendance_date, 20);
        if (!userId || !attendanceDate) continue;
        const current = metricsByUser.get(userId) || emptyAttendanceMetrics(todayDateKey);
        current.attendance_days_total += 1;
        if (attendanceDate >= since30DateKey && attendanceDate <= todayDateKey) current.attendance_days_30 += 1;
        if (attendanceDate >= since7DateKey && attendanceDate <= todayDateKey) current.attendance_days_7 += 1;
        if (attendanceDate === todayDateKey) {
          current.attendance_date = attendanceDate;
          current.first_seen_today_at = asString((row as any)?.first_seen_at, 80) || null;
          current.last_seen_at = asString((row as any)?.last_seen_at, 80) || null;
          current.today_heartbeat_count = Math.max(0, Math.floor(asFiniteNumber((row as any)?.heartbeat_count)));
        }
        metricsByUser.set(userId, current);
      }
      if ((data || []).length < ATTENDANCE_METRICS_FALLBACK_PAGE_SIZE) break;
    }
  }
  return metricsByUser;
};

const requireAdmin = async (req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  if (!user) return { ok: false, response: fail(401, "Unauthorized") };
  const isAdmin = await isAdminUser(user.id);
  if (!isAdmin) return { ok: false, response: fail(403, "Forbidden") };
  return { ok: true, userId: user.id };
};

const buildAdminCatalogUploadTarget = (catalogItemId: string, assetName: string): R2UploadTarget => {
  const safeAssetName = String(assetName || "").replace(/^\/+/, "").trim();
  return {
    bucket: R2_BUCKET || "",
    objectKey: `catalog/${catalogItemId}/${safeAssetName}`,
    assetName: safeAssetName,
  };
};

const buildDefaultBankUploadTarget = (version: number, assetName: string): R2UploadTarget => {
  const safeAssetName = String(assetName || "").replace(/^\/+/, "").trim();
  return {
    bucket: R2_BUCKET || "",
    objectKey: `default-bank/releases/v${version}/${safeAssetName}`,
    assetName: safeAssetName,
  };
};

const buildAccountTierVideoUploadTarget = (tier: StoredAccountTier, assetName: string): R2UploadTarget => {
  const safeAssetName = String(assetName || "").replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "_").trim();
  return {
    bucket: R2_BUCKET || "",
    objectKey: `account-tiers/${tier}/${Date.now()}-${crypto.randomUUID()}-${safeAssetName}`,
    assetName: safeAssetName,
  };
};

const DEFAULT_BANK_RELEASE_UPLOAD_SCOPE = "admin_catalog" as const;

const isDefaultBankReleaseUploadScope = (scope: string | null | undefined): boolean =>
  scope === "default_bank_release" || scope === DEFAULT_BANK_RELEASE_UPLOAD_SCOPE;

const mapDefaultBankReleaseRow = (row: any) => ({
  id: asUuid(row?.id) || "",
  version: Number(asNumber(row?.version) || 0),
  sourceBankRuntimeId: asString(row?.source_bank_runtime_id, 255) || null,
  sourceBankTitle: asString(row?.source_bank_title, 255) || "Default Bank",
  sourceBankPadCount: Number(asNumber(row?.source_bank_pad_count) || 0),
  storageProvider: asString(row?.storage_provider, 40) || "r2",
  storageBucket: asString(row?.storage_bucket, 300) || "",
  storageKey: asString(row?.storage_key, 2000) || "",
  storageEtag: asString(row?.storage_etag, 300) || null,
  fileSizeBytes: Number(asNumber(row?.file_size_bytes) || 0),
  fileSha256: asString(row?.file_sha256, 128) || null,
  releaseNotes: asString(row?.release_notes, 5000) || null,
  minAppVersion: asString(row?.min_app_version, 64) || null,
  publishedBy: asUuid(row?.published_by) || null,
  publishedAt: asString(row?.published_at, 80) || null,
  isActive: Boolean(row?.is_active),
  createdAt: asString(row?.created_at, 80) || null,
  updatedAt: asString(row?.updated_at, 80) || null,
  deactivatedAt: asString(row?.deactivated_at, 80) || null,
  deactivatedBy: asUuid(row?.deactivated_by) || null,
});

const getNormalizedSamplerAppConfig = async (admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin
    .from("sampler_app_config")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) return { error, config: DEFAULT_SAMPLER_APP_CONFIG };
  return {
    error: null,
    config: normalizeSamplerAppConfig({
      ui_defaults: data?.ui_defaults,
      bank_defaults: data?.bank_defaults,
      pad_defaults: data?.pad_defaults,
      quota_defaults: data?.quota_defaults,
      audio_limits: data?.audio_limits,
      shortcut_defaults: data?.shortcut_defaults,
    }),
  };
};

const ensureR2UploadReady = (): string | null => {
  if (!R2_BUCKET) return "R2_BUCKET_NOT_CONFIGURED";
  return null;
};

const issueSignedAdminExportToken = async (
  body: Record<string, unknown>,
  adminUserId: string,
): Promise<Response> => {
  if (!isAdminExportTokenSigningEnabled()) {
    return fail(503, "ADMIN_EXPORT_TOKEN_SIGNING_DISABLED");
  }

  const rate = await consumeRateLimit({
    scope: "admin.store.export_sign_token",
    subject: adminUserId,
    maxHits: ADMIN_EXPORT_SIGN_TOKEN_RATE_LIMIT,
    windowSeconds: ADMIN_EXPORT_SIGN_TOKEN_RATE_WINDOW_SECONDS,
  });
  if (!rate.allowed) {
    const retryAfter = rate.retryAfterSeconds || ADMIN_EXPORT_SIGN_TOKEN_RATE_WINDOW_SECONDS;
    return json(429, {
      ok: false,
      error: "RATE_LIMITED",
      retryAfterSec: retryAfter,
    });
  }

  const bankJsonSha256 = asString(body.bankJsonSha256, 128) || "";
  if (!/^[a-f0-9]{64}$/i.test(bankJsonSha256)) {
    return badRequest("Invalid bankJsonSha256");
  }

  const bankName = asString(body.bankName, 200) || "Untitled Bank";
  const padCountRaw = asNumber(body.padCount);
  const padCount = Number.isFinite(padCountRaw || NaN) ? Math.max(0, Math.floor(Number(padCountRaw))) : 0;
  const allowExport = Boolean(body.allowExport);

  try {
    const signed = await createSignedAdminExportToken({
      adminUserId,
      bankJsonSha256: bankJsonSha256.toLowerCase(),
      bankName,
      padCount,
      allowExport,
    });
    return ok({
      mode: "signed_admin_export",
      token: signed.token,
      keyId: signed.keyId,
      issuedAt: signed.issuedAt,
      expiresAt: signed.expiresAt,
      bankJsonSha256: signed.payload.bank_json_sha256,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADMIN_EXPORT_TOKEN_SIGNING_FAILED";
    if (message === "ADMIN_EXPORT_TOKEN_SIGNING_DISABLED") {
      return fail(503, message);
    }
    if (message === "INVALID_BANK_JSON_SHA256") {
      return badRequest("Invalid bankJsonSha256");
    }
    return fail(500, message);
  }
};

const getAssetNameFromStorageKey = (storageKey: string | null | undefined): string | null => {
  if (!storageKey) return null;
  const segments = String(storageKey).split("/").filter(Boolean);
  return segments.length ? segments[segments.length - 1] : null;
};

const buildCatalogLowMemoryManifestObjectKey = (catalogItemId: string, variantId: string): string =>
  `catalog/${catalogItemId}/low-memory/${variantId}/manifest.json`;

const buildCatalogLowMemoryPartObjectKey = (
  catalogItemId: string,
  variantId: string,
  partIndex: number,
  assetName?: string | null,
): string => {
  const normalizedIndex = Math.max(0, Math.floor(partIndex));
  const safeAssetName = (asString(assetName, 240) || `part-${String(normalizedIndex + 1).padStart(3, "0")}.bank`)
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `catalog/${catalogItemId}/low-memory/${variantId}/${safeAssetName}`;
};

const mapAdminCatalogAssetVariantView = async (row: any): Promise<AdminCatalogAssetVariantView> => {
  const manifestStorageBucket = asString(row?.manifest_storage_bucket, 300) || null;
  const manifestStorageKey = asString(row?.manifest_storage_key, 2000) || null;
  let manifestObjectInfo: Awaited<ReturnType<typeof headObject>> | null = null;
  if (manifestStorageBucket && manifestStorageKey) {
    try {
      manifestObjectInfo = await headObject(manifestStorageBucket, manifestStorageKey);
    } catch {
      manifestObjectInfo = null;
    }
  }

  const partRows = Array.isArray(row?.bank_catalog_asset_variant_parts)
    ? row.bank_catalog_asset_variant_parts
    : [];
  const parts = await Promise.all(partRows.map(async (partRow: any): Promise<AdminCatalogAssetVariantPartView> => {
    const storageBucket = asString(partRow?.storage_bucket, 300) || "";
    const storageKey = asString(partRow?.storage_key, 2000) || "";
    let objectInfo: Awaited<ReturnType<typeof headObject>> | null = null;
    if (storageBucket && storageKey) {
      try {
        objectInfo = await headObject(storageBucket, storageKey);
      } catch {
        objectInfo = null;
      }
    }
    return {
      id: asUuid(partRow?.id) || "",
      part_index: Math.max(0, Math.floor(Number(asNumber(partRow?.part_index) || 0))),
      storage_bucket: storageBucket,
      storage_key: storageKey,
      asset_name: getAssetNameFromStorageKey(storageKey),
      file_size_bytes: Math.max(0, Math.floor(Number(asNumber(partRow?.file_size_bytes) || 0))),
      sha256: asString(partRow?.sha256, 128),
      pad_start_index: Math.max(0, Math.floor(Number(asNumber(partRow?.pad_start_index) || 0))),
      pad_end_index: Math.max(0, Math.floor(Number(asNumber(partRow?.pad_end_index) || 0))),
      object_exists: Boolean(objectInfo),
      actual_file_size_bytes: objectInfo?.sizeBytes ?? null,
    };
  }));

  return {
    id: asUuid(row?.id) || "",
    catalog_item_id: asUuid(row?.catalog_item_id) || "",
    variant_type: normalizeCatalogAssetVariantType(row?.variant_type, "low_memory_segmented"),
    status: normalizeCatalogAssetVariantStatus(row?.status, "uploading"),
    manifest_storage_bucket: manifestStorageBucket,
    manifest_storage_key: manifestStorageKey,
    manifest_asset_name: getAssetNameFromStorageKey(manifestStorageKey),
    manifest_object_exists: Boolean(manifestObjectInfo),
    manifest_actual_file_size_bytes: manifestObjectInfo?.sizeBytes ?? null,
    total_file_size_bytes: Number.isFinite(Number(asNumber(row?.total_file_size_bytes)))
      ? Math.max(0, Math.floor(Number(asNumber(row?.total_file_size_bytes) || 0)))
      : null,
    part_count: Math.max(0, Math.floor(Number(asNumber(row?.part_count) || parts.length))),
    min_client_version: asString(row?.min_client_version, 64),
    source_asset_sha256: asString(row?.source_asset_sha256, 128),
    created_at: asString(row?.created_at, 80),
    updated_at: asString(row?.updated_at, 80),
    parts: parts.sort((left, right) => left.part_index - right.part_index),
  };
};

const mapAdminCatalogUploadSessionView = async (
  row: any,
  currentStorageKey: string,
): Promise<AdminCatalogUploadSessionView> => {
  const storageBucket = asString(row?.storage_bucket, 300) || "";
  const storageKey = asString(row?.storage_key, 2000) || "";
  let objectInfo: Awaited<ReturnType<typeof headObject>> | null = null;
  if (storageBucket && storageKey) {
    try {
      objectInfo = await headObject(storageBucket, storageKey);
    } catch {
      objectInfo = null;
    }
  }
  const meta = typeof row?.meta === "object" && row.meta ? row.meta as Record<string, unknown> : {};
  return {
    id: asUuid(row?.id) || "",
    catalog_item_id: asUuid(row?.catalog_item_id),
    bank_id: asUuid(row?.bank_id),
    status: asString(row?.status, 40) || "issued",
    failure_reason: asString(row?.failure_reason, 2000),
    created_at: asString(row?.created_at, 80),
    updated_at: asString(row?.updated_at, 80),
    completed_at: asString(row?.completed_at, 80),
    expires_at: asString(row?.expires_at, 80),
    storage_bucket: storageBucket,
    storage_key: storageKey,
    asset_name: getAssetNameFromStorageKey(storageKey),
    expected_file_size_bytes: Math.max(0, Math.floor(Number(asNumber(row?.expected_file_size_bytes) || 0))),
    expected_sha256: asString(row?.expected_sha256, 128),
    actual_file_size_bytes: objectInfo?.sizeBytes ?? null,
    actual_etag: objectInfo?.etag ?? null,
    object_exists: Boolean(objectInfo),
    asset_protection: normalizeCatalogAssetProtection(meta.assetProtection, "encrypted"),
    operation_type: asString(meta.operationType, 40) === "update" ? "update" : "create",
    is_current_catalog_asset: Boolean(currentStorageKey) && currentStorageKey === storageKey,
  };
};

const listUsers = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(2000, Number(url.searchParams.get("perPage") || 100)));
  const includeAdmins = String(url.searchParams.get("includeAdmins") || "false").toLowerCase() === "true";
  const sortBy = String(url.searchParams.get("sortBy") || "created_at");
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
  const todayDateKey = toFixedOffsetDateKey(new Date(), ASIA_MANILA_UTC_OFFSET_MINUTES);

  const { data: tierConfigRows, error: tierConfigError } = await admin
    .from("account_tier_configs")
    .select("tier,limits,features,is_active");
  if (tierConfigError) return fail(500, tierConfigError.message);
  const tierConfigByTier = new Map((tierConfigRows || []).map((row: any) => [asString(row?.tier, 32), row]));

  const authUsers: any[] = [];
  const authBatchSize = 500;
  for (let authPage = 1; authPage <= 40; authPage += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page: authPage, perPage: authBatchSize });
    if (error) return fail(500, error.message);
    const batch = Array.isArray(data?.users) ? data.users : [];
    authUsers.push(...batch);
    if (batch.length < authBatchSize) break;
  }

  const userIds = authUsers.map((user) => user.id);
  const { data: profileRows, error: profileError } = userIds.length
    ? await admin
      .from("profiles")
      .select("id, role, display_name, account_tier, tier_source, tier_updated_at, owned_bank_quota, owned_bank_pad_cap, device_total_bank_cap")
      .in("id", userIds)
    : { data: [], error: null };
  if (profileError) return fail(500, profileError.message);
  const profileMap = new Map((profileRows || []).map((row: any) => [row.id, row]));

  const mapped = authUsers.map((user: any) => {
    const profile = profileMap.get(user.id);
    const profileDisplayName = asString(profile?.display_name, 120);
    const metadataDisplayName = asString(user?.user_metadata?.display_name, 120);
    const displayName = profileDisplayName || metadataDisplayName || user.email?.split("@")[0] || "User";
    const role = profile?.role === "admin" ? "admin" : "user";
    const accountTier = role === "admin" ? "pro_max" : (normalizeProfileTier(profile?.account_tier) || "free");
    const tierDefaults = buildAccountCapabilitySnapshot(
      { id: user.id, role, account_tier: accountTier },
      tierConfigByTier.get(accountTier),
      null,
    );
    const legacyQuotaDefaults = toLegacyProfileQuotaLimits(tierDefaults.limits);
    const bannedUntil = (user as any).banned_until || null;
    const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());

    return {
      id: user.id,
      email: user.email || null,
      role,
      account_tier: accountTier,
      effective_account_tier: role === "admin" ? "pro_max" : accountTier,
      tier_source: asString(profile?.tier_source, 40) || null,
      tier_updated_at: parseIsoDateTime(profile?.tier_updated_at),
      display_name: displayName,
      owned_bank_quota: Number.isFinite(Number(profile?.owned_bank_quota)) ? Number(profile?.owned_bank_quota) : legacyQuotaDefaults.ownedBankQuota,
      owned_bank_pad_cap: Number.isFinite(Number(profile?.owned_bank_pad_cap)) ? Number(profile?.owned_bank_pad_cap) : legacyQuotaDefaults.ownedBankPadCap,
      device_total_bank_cap: Number.isFinite(Number(profile?.device_total_bank_cap)) ? Number(profile?.device_total_bank_cap) : legacyQuotaDefaults.deviceTotalBankCap,
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      banned_until: bannedUntil,
      is_banned: isBanned,
    };
  });

  const visible = includeAdmins ? mapped : mapped.filter((row) => row.role !== "admin");
  const filtered = q
    ? visible.filter((row) =>
      [row.id, row.email, row.display_name, row.role].filter(Boolean).join(" ").toLowerCase().includes(q)
    )
    : visible;

  const filteredUserIds = filtered.map((row) => row.id).filter(Boolean);
  const latestSessionByUser = new Map<string, { device_name: string | null; platform: string | null; app_version: string | null }>();
  if (filteredUserIds.length > 0) {
    const { data: sessionRows, error: sessionError } = await admin
      .from("active_sessions")
      .select("user_id,device_name,platform,last_seen_at,meta")
      .in("user_id", filteredUserIds)
      .order("last_seen_at", { ascending: false })
      .limit(Math.max(200, Math.min(5000, filteredUserIds.length * 8)));
    if (sessionError) return fail(500, sessionError.message);
    for (const row of sessionRows || []) {
      const rowUserId = asUuid((row as any)?.user_id);
      if (!rowUserId || latestSessionByUser.has(rowUserId)) continue;
      const meta = asRecord((row as any)?.meta);
      latestSessionByUser.set(rowUserId, {
        device_name: asString((row as any)?.device_name, 200) || null,
        platform: asString((row as any)?.platform, 120) || null,
        app_version: asString(meta.appVersion, 80) || null,
      });
    }
  }

  const latestLoginVersionByUser = new Map<string, string | null>();
  if (filteredUserIds.length > 0) {
    const { data: loginRows, error: loginError } = await admin
      .from("activity_logs")
      .select("user_id,created_at,meta")
      .in("user_id", filteredUserIds)
      .eq("event_type", "auth.login")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(Math.max(200, Math.min(5000, filteredUserIds.length * 8)));
    if (loginError) return fail(500, loginError.message);
    for (const row of loginRows || []) {
      const rowUserId = asUuid((row as any)?.user_id);
      if (!rowUserId || latestLoginVersionByUser.has(rowUserId)) continue;
      const meta = asRecord((row as any)?.meta);
      latestLoginVersionByUser.set(rowUserId, asString(meta.appVersion, 80) || null);
    }
  }

  const attendanceMetrics = await loadAttendanceMetricsForUsers(admin, filteredUserIds, todayDateKey);

  const enriched = filtered.map((row) => {
    const latestSession = latestSessionByUser.get(row.id);
    const attendance = attendanceMetrics.get(row.id) || emptyAttendanceMetrics(todayDateKey);
    return {
      ...row,
      last_sign_in_device_name: latestSession?.device_name || null,
      last_sign_in_platform: latestSession?.platform || null,
      last_sign_in_app_version: latestLoginVersionByUser.get(row.id) || latestSession?.app_version || null,
      attendance_days_total: attendance.attendance_days_total,
      attendance_days_30: attendance.attendance_days_30,
      attendance_days_7: attendance.attendance_days_7,
      today_heartbeat_count: attendance.today_heartbeat_count,
    };
  });

  const sorted = sortRows(enriched, sortBy, sortDir, {
    display_name: (a, b) => compareNullableText(a.display_name, b.display_name),
    email: (a, b) => compareNullableText(a.email, b.email),
    created_at: (a, b) => compareNullableDate(a.created_at, b.created_at),
    last_sign_in_at: (a, b) => compareNullableDate(a.last_sign_in_at, b.last_sign_in_at),
    last_sign_in_device_name: (a, b) => compareNullableText(a.last_sign_in_device_name, b.last_sign_in_device_name),
    last_sign_in_platform: (a, b) => compareNullableText(a.last_sign_in_platform, b.last_sign_in_platform),
    last_sign_in_app_version: (a, b) => compareNullableText(a.last_sign_in_app_version, b.last_sign_in_app_version),
    attendance_days_total: (a, b) => asFiniteNumber(a.attendance_days_total) - asFiniteNumber(b.attendance_days_total),
    ban_status: (a, b) => Number(a.is_banned) - Number(b.is_banned),
  });
  const pagedUsers = paginateRows(sorted, page, perPage);

  return ok({
    users: pagedUsers,
    page,
    perPage,
    total: sorted.length,
    sortBy,
    sortDir,
    includeAdmins,
  });
};

const listActiveSessions = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = asString(url.searchParams.get("q"), 120)?.toLowerCase() || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(200, Number(url.searchParams.get("perPage") || 100)));
  const activeTodayPage = Math.max(1, Number(url.searchParams.get("activeTodayPage") || 1));
  const activeTodayPerPage = Math.max(1, Math.min(200, Number(url.searchParams.get("activeTodayPerPage") || 100)));
  const sortBy = normalizeActiveSessionSortBy(url.searchParams.get("sortBy"));
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
  const now = new Date();
  const startOfTodayManila = startOfFixedOffsetDay(now, ASIA_MANILA_UTC_OFFSET_MINUTES);
  const todayDateKey = toFixedOffsetDateKey(now, ASIA_MANILA_UTC_OFFSET_MINUTES);

  const { data: sessions, error: sessionsError } = await admin
    .from("v_active_sessions_now")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT);
  if (sessionsError) return fail(500, sessionsError.message);

  const rows = Array.isArray(sessions) ? sessions : [];
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
  const adminIds = new Set((admins || []).map((a: any) => String(a.id || "")).filter(Boolean));

  const attendanceTodayResp = await admin
    .from("user_daily_attendance")
    .select("user_id,latest_session_key,latest_email,latest_device_fingerprint,latest_device_name,latest_platform,latest_browser,latest_os,attendance_date,first_seen_at,last_seen_at,heartbeat_count")
    .eq("attendance_date", todayDateKey)
    .order("last_seen_at", { ascending: false })
    .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT * 5);

  let nonAdminActiveTodayRows: any[] = [];
  if (!attendanceTodayResp.error) {
    nonAdminActiveTodayRows = (attendanceTodayResp.data || [])
      .map((row: any) => {
        const userId = String(row?.user_id || "");
        if (!userId) return null;
        return {
          session_key: asString(row?.latest_session_key, 80) || `attendance:${userId}:${todayDateKey}`,
          user_id: userId,
          email: asString(row?.latest_email, 320) || null,
          device_fingerprint: asString(row?.latest_device_fingerprint, 256) || "unknown",
          device_name: asString(row?.latest_device_name, 200) || null,
          platform: asString(row?.latest_platform, 120) || null,
          browser: asString(row?.latest_browser, 120) || null,
          os: asString(row?.latest_os, 120) || null,
          last_seen_at: asString(row?.last_seen_at, 80) || asString(row?.first_seen_at, 80) || null,
          attendance_date: asString(row?.attendance_date, 20) || todayDateKey,
          first_seen_today_at: asString(row?.first_seen_at, 80) || null,
          today_heartbeat_count: Math.max(0, Math.floor(asFiniteNumber(row?.heartbeat_count))),
        };
      })
      .filter(Boolean)
      .filter((row: any) => !adminIds.has(String(row?.user_id || "")));
  } else {
    if (!isMissingAttendanceStorageError(attendanceTodayResp.error)) return fail(500, attendanceTodayResp.error.message);
    const { data: activeTodayRows, error: activeTodayError } = await admin
      .from("active_sessions")
      .select("session_key,user_id,email,device_fingerprint,device_name,platform,browser,os,last_seen_at")
      .gte("last_seen_at", startOfTodayManila.toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT * 5);
    if (activeTodayError) return fail(500, activeTodayError.message);
    nonAdminActiveTodayRows = (activeTodayRows || []).filter((row: any) => {
      const userId = String(row?.user_id || "");
      return Boolean(userId) && !adminIds.has(userId);
    });
  }

  const activeTodayLatestByUser = new Map<string, any>();
  for (const row of nonAdminActiveTodayRows) {
    const userId = String(row?.user_id || "");
    if (!userId) continue;
    const previous = activeTodayLatestByUser.get(userId);
    if (!previous || compareNullableDate(previous?.last_seen_at, row?.last_seen_at) < 0) {
      activeTodayLatestByUser.set(userId, row);
    }
  }
  const latestByUser = new Map<string, any>();
  for (const row of rows) {
    const userId = String(row?.user_id || "");
    if (!userId) continue;
    const previous = latestByUser.get(userId);
    if (!previous || compareNullableDate(previous?.last_seen_at, row?.last_seen_at) < 0) {
      latestByUser.set(userId, row);
    }
  }

  const attendanceMetrics = await loadAttendanceMetricsForUsers(
    admin,
    [
      ...Array.from(latestByUser.keys()),
      ...Array.from(activeTodayLatestByUser.keys()),
    ],
    todayDateKey,
  );
  const enrichWithAttendance = (row: any) => {
    const userId = String(row?.user_id || "");
    const metrics = attendanceMetrics.get(userId) || emptyAttendanceMetrics(todayDateKey);
    return {
      ...row,
      attendance_date: metrics.attendance_date || row?.attendance_date || todayDateKey,
      first_seen_today_at: metrics.first_seen_today_at || row?.first_seen_today_at || null,
      today_heartbeat_count: metrics.today_heartbeat_count || Number(row?.today_heartbeat_count || 0),
      attendance_days_7: metrics.attendance_days_7,
      attendance_days_30: metrics.attendance_days_30,
      attendance_days_total: metrics.attendance_days_total,
    };
  };

  const dedupedRows = Array.from(latestByUser.values()).map(enrichWithAttendance);
  const activeTodayRowsWithAttendance = Array.from(activeTodayLatestByUser.values()).map(enrichWithAttendance);
  const filtered = q
    ? dedupedRows.filter((row: any) => {
      const text = [
        row?.user_id,
        row?.email,
        row?.device_name,
        row?.platform,
        row?.browser,
        row?.os,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    })
    : dedupedRows;

  const sorted = sortRows(filtered, sortBy, sortDir, {
    user_id: (a, b) => compareNullableText(a.user_id, b.user_id),
    email: (a, b) => compareNullableText(a.email, b.email),
    device_name: (a, b) => compareNullableText(a.device_name, b.device_name),
    platform: (a, b) => compareNullableText(
      [a.platform, a.browser, a.os].filter(Boolean).join(" / "),
      [b.platform, b.browser, b.os].filter(Boolean).join(" / "),
    ),
    last_seen_at: (a, b) => compareNullableDate(a.last_seen_at, b.last_seen_at),
  });

  const filteredSessionCount = q
    ? rows.filter((row: any) => {
      const matchedUser = latestByUser.get(String(row?.user_id || ""));
      return filtered.includes(matchedUser);
    }).length
    : rows.length;
  const activeTodayUsers = activeTodayLatestByUser.size;
  const sortedActiveTodayRows = activeTodayRowsWithAttendance.sort((left, right) =>
    compareNullableDate(right?.last_seen_at, left?.last_seen_at)
  );

  return ok({
    counts: {
      activeSessions: filteredSessionCount,
      activeUsers: filtered.length,
      activeTodayUsers,
    },
    sessions: paginateRows(sorted, page, perPage),
    activeTodaySessions: paginateRows(sortedActiveTodayRows, activeTodayPage, activeTodayPerPage),
    total: sorted.length,
    page,
    perPage,
    activeTodayTotal: sortedActiveTodayRows.length,
    activeTodayPage,
    activeTodayPerPage,
    sortBy,
    sortDir,
  });
};

const createUser = async (body: any, admin: ReturnType<typeof createServiceClient>) => {
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const displayNameInput = String(body?.displayName || "").trim();
  if (!email || !email.includes("@")) return badRequest("Valid email is required");
  if (!password || password.length < 6) return badRequest("Password must be at least 6 characters");

  const displayName = displayNameInput || email.split("@")[0] || "User";
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  } as any);
  if (createErr || !created?.user) {
    return fail(500, createErr?.message || "Failed to create user");
  }

  const userId = created.user.id;
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({
      id: userId,
      display_name: displayName,
      role: "user",
      account_tier: "free",
      tier_source: "admin",
      tier_updated_at: new Date().toISOString(),
      owned_bank_quota: 2,
      owned_bank_pad_cap: 25,
      device_total_bank_cap: 10,
    }, { onConflict: "id" });
  if (profileErr) return fail(500, `User created, profile setup failed: ${profileErr.message}`);
  const capabilities = await applyAccountTierToUser(admin, userId, "free", "admin");
  const legacyProfileLimits = toLegacyProfileQuotaLimits(capabilities.limits);

  return ok(
    {
      user: {
        id: userId,
        email: created.user.email,
        display_name: displayName,
        role: "user",
        account_tier: "free",
        effective_account_tier: "free",
        tier_source: "admin",
        tier_updated_at: capabilities.refreshedAt,
        owned_bank_quota: legacyProfileLimits.ownedBankQuota,
        owned_bank_pad_cap: legacyProfileLimits.ownedBankPadCap,
        device_total_bank_cap: legacyProfileLimits.deviceTotalBankCap,
      },
    },
    201,
  );
};

const updateUserProfile = async (
  userId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const displayName = asString(body?.displayName, 120);
  if (!displayName) return badRequest("displayName is required");
  const ownedBankQuota = Math.floor(Number(body?.ownedBankQuota));
  const ownedBankPadCap = Math.floor(Number(body?.ownedBankPadCap));
  const deviceTotalBankCap = Math.floor(Number(body?.deviceTotalBankCap));
  const requestedTier = normalizeProfileTier(body?.accountTier ?? body?.account_tier);
  if (!Number.isFinite(ownedBankQuota) || ownedBankQuota < 1 || ownedBankQuota > 500) {
    return badRequest("ownedBankQuota must be between 1 and 500");
  }
  if (!Number.isFinite(ownedBankPadCap) || ownedBankPadCap < 1 || ownedBankPadCap > 256) {
    return badRequest("ownedBankPadCap must be between 1 and 256");
  }
  if (!Number.isFinite(deviceTotalBankCap) || deviceTotalBankCap < 10 || deviceTotalBankCap > 1000) {
    return badRequest("deviceTotalBankCap must be between 10 and 1000");
  }

  const { data: existingUser, error: existingUserError } = await admin.auth.admin.getUserById(userId);
  if (existingUserError || !existingUser?.user) {
    return fail(404, existingUserError?.message || "User not found");
  }

  const currentMetadata = ((existingUser.user as any).user_metadata || {}) as Record<string, unknown>;
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMetadata,
      display_name: displayName,
    },
  } as any);
  if (authUpdateError) return fail(500, authUpdateError.message);

  const { data: profileRow, error: profileSelectError } = await admin
    .from("profiles")
    .select("id, role, account_tier, tier_source")
    .eq("id", userId)
    .maybeSingle();
  if (profileSelectError) return fail(500, profileSelectError.message);

  const currentRole = profileRow?.role === "admin" ? "admin" : "user";
  const accountTier = currentRole === "admin" ? "pro_max" : (requestedTier || normalizeProfileTier(profileRow?.account_tier) || "free");
  if (profileRow?.id) {
    const profileUpdates: Record<string, unknown> = {
      display_name: displayName,
      account_tier: accountTier,
      tier_source: requestedTier ? "admin" : (asString(profileRow?.tier_source, 40) || "admin"),
      owned_bank_quota: ownedBankQuota,
      owned_bank_pad_cap: ownedBankPadCap,
      device_total_bank_cap: deviceTotalBankCap,
    };
    if (requestedTier) profileUpdates.tier_updated_at = new Date().toISOString();
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update(profileUpdates)
      .eq("id", userId);
    if (profileUpdateError) return fail(500, profileUpdateError.message);
  } else {
    const { error: profileUpsertError } = await admin
      .from("profiles")
      .upsert(
        {
          id: userId,
          role: "user",
          display_name: displayName,
          account_tier: accountTier,
          tier_source: "admin",
          tier_updated_at: new Date().toISOString(),
          owned_bank_quota: ownedBankQuota,
          owned_bank_pad_cap: ownedBankPadCap,
          device_total_bank_cap: deviceTotalBankCap,
        },
        { onConflict: "id" },
      );
    if (profileUpsertError) return fail(500, profileUpsertError.message);
  }

  const hasLimitOverrides = body?.limitOverrides && typeof body.limitOverrides === "object" && !Array.isArray(body.limitOverrides);
  const hasFeatureOverrides = body?.featureOverrides && typeof body.featureOverrides === "object" && !Array.isArray(body.featureOverrides);
  if (hasLimitOverrides || hasFeatureOverrides) {
    const { error: overrideError } = await admin
      .from("profile_feature_overrides")
      .upsert({
        user_id: userId,
        limits: hasLimitOverrides ? body.limitOverrides : {},
        features: hasFeatureOverrides ? body.featureOverrides : {},
        notes: asString(body?.overrideNotes, 1000),
        updated_by: adminUserId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (overrideError) return fail(500, overrideError.message);
  }

  const capabilities = await loadAccountCapabilitySnapshot(admin, userId);

  return ok({
    user: {
      id: userId,
      email: existingUser.user.email || null,
      display_name: displayName,
      role: currentRole,
      account_tier: accountTier,
      effective_account_tier: currentRole === "admin" ? "pro_max" : accountTier,
      owned_bank_quota: ownedBankQuota,
      owned_bank_pad_cap: ownedBankPadCap,
      device_total_bank_cap: deviceTotalBankCap,
    },
    capabilities,
  });
};

const deleteUser = async (
  userId: string,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const existing = await admin.auth.admin.getUserById(userId);
  const targetEmail = existing.data?.user?.email || null;
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return fail(500, error.message);
  await swallowDiscordError(() =>
    sendDiscordAdminActionEvent({
      severity: "critical",
      title: "Admin Deleted User",
      description: "A user account was deleted by admin.",
      actorUserId: adminUserId,
      targetUserId: userId,
      extraFields: targetEmail ? [{ name: "Target Email", value: targetEmail, inline: true }] : [],
    })
  );
  return ok({ userId });
};

const banUser = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const hours = Math.max(1, Math.min(8760, Number(body?.hours || 24)));
  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: `${hours}h`,
  } as any);
  if (error) return fail(500, error.message);
  const bannedUntil = (data?.user as any)?.banned_until || null;
  return ok({ userId, banned_until: bannedUntil });
};

const unbanUser = async (userId: string, admin: ReturnType<typeof createServiceClient>) => {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" } as any);
  if (error) return fail(500, error.message);
  return ok({ userId, banned_until: null });
};

const resetPassword = async (
  userId: string,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return fail(404, error?.message || "User not found");
  const email = data.user.email;
  if (!email) return badRequest("User has no email");

  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  if (!supabaseUrl || !supabaseAnonKey) {
    return fail(500, "Missing Supabase environment variables");
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { error: resetErr } = await anon.auth.resetPasswordForEmail(email);
  if (resetErr) return fail(500, resetErr.message);
  await swallowDiscordError(() =>
    sendDiscordAdminActionEvent({
      severity: "warning",
      title: "Admin Reset User Password",
      description: "Password reset email was triggered by admin.",
      actorUserId: adminUserId,
      targetUserId: userId,
      extraFields: [{ name: "Target Email", value: email, inline: true }],
    })
  );
  return ok({ userId, email });
};

const listBanks = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(2000, Number(url.searchParams.get("perPage") || 100)));
  const sortBy = String(url.searchParams.get("sortBy") || "created_at");
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
  const includeDeleted = parseBooleanFlag(url.searchParams.get("includeDeleted"), false);

  let banks: any[] = [];
  let includeColor = true;
  let includeSoftDelete = true;
  {
    let query = admin
      .from("banks")
      .select("id, title, description, color, created_at, created_by, deleted_at, deleted_by");
    if (!includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) {
      const isMissingColorColumn = /column .*color/i.test(error.message || "");
      const isMissingSoftDeleteColumns = /column .*deleted_(at|by)/i.test(error.message || "");
      includeColor = !isMissingColorColumn;
      includeSoftDelete = !isMissingSoftDeleteColumns;
      if (!isMissingColorColumn && !isMissingSoftDeleteColumns) return fail(500, error.message);

      let fallbackSelect = "id, title, description, created_at, created_by";
      if (includeColor) fallbackSelect += ", color";
      if (includeSoftDelete) fallbackSelect += ", deleted_at, deleted_by";

      let fallbackQuery = admin
        .from("banks")
        .select(fallbackSelect);
      if (!includeDeleted && includeSoftDelete) fallbackQuery = fallbackQuery.is("deleted_at", null);

      const fallback = await fallbackQuery;
      if (fallback.error) return fail(500, fallback.error.message);
      banks = fallback.data || [];
    } else {
      banks = data || [];
    }
  }

  const bankIds = (banks || []).map((bank: any) => String(bank?.id || "")).filter(Boolean);
  const { data: accessRows, error: accessError } = bankIds.length > 0
    ? await admin
      .from("user_bank_access")
      .select("bank_id")
      .in("bank_id", bankIds)
    : { data: [], error: null };
  if (accessError) return fail(500, accessError.message);

  const accessCountMap = new Map<string, number>();
  for (const row of accessRows || []) {
    const bankId = (row as any).bank_id as string;
    accessCountMap.set(bankId, (accessCountMap.get(bankId) || 0) + 1);
  }

  const catalogSummaryByBankId = new Map<string, Record<string, unknown>>();
  if (bankIds.length > 0) {
    const { data: catalogRows, error: catalogError } = await admin
      .from("bank_catalog_items")
      .select("id,bank_id,item_type,is_published,coming_soon,asset_protection,file_size_bytes,thumbnail_path,storage_key,expected_asset_name,price_php,updated_at")
      .in("bank_id", bankIds);
    if (catalogError && !/bank_catalog_items/i.test(catalogError.message || "")) {
      return fail(500, catalogError.message);
    }
    for (const row of catalogRows || []) {
      const bankId = asUuid(row?.bank_id);
      if (!bankId || catalogSummaryByBankId.has(bankId)) continue;
      catalogSummaryByBankId.set(bankId, {
        id: asUuid(row?.id) || "",
        item_type: String(row?.item_type || "").trim().toLowerCase() === "bank_bundle" ? "bank_bundle" : "single_bank",
        is_published: Boolean(row?.is_published),
        coming_soon: Boolean(row?.coming_soon),
        asset_protection: normalizeCatalogAssetProtection(row?.asset_protection, "encrypted"),
        file_size_bytes: Number.isFinite(Number(row?.file_size_bytes)) ? Math.max(0, Math.floor(Number(row.file_size_bytes))) : null,
        thumbnail_path: asString(row?.thumbnail_path, 2000) || null,
        storage_key: asString(row?.storage_key, 2000) || "",
        expected_asset_name: asString(row?.expected_asset_name, 500) || "",
        price_php: Number.isFinite(Number(row?.price_php)) ? Number(row.price_php) : null,
        updated_at: asString(row?.updated_at, 80) || null,
      });
    }
  }

  const mapped = (banks || []).map((bank: any) => ({
    id: bank.id,
    title: bank.title || "",
    description: bank.description || "",
    color: includeColor ? (bank.color || null) : null,
    created_at: bank.created_at || null,
    created_by: bank.created_by || null,
    deleted_at: includeSoftDelete ? (bank.deleted_at || null) : null,
    deleted_by: includeSoftDelete ? (bank.deleted_by || null) : null,
    access_count: accessCountMap.get(bank.id) || 0,
    store_catalog: catalogSummaryByBankId.get(bank.id) || null,
  }));

  const filtered = q
    ? mapped.filter((bank) =>
      [bank.id, bank.title, bank.description].filter(Boolean).join(" ").toLowerCase().includes(q)
    )
    : mapped;

  const sorted = sortRows(filtered, sortBy, sortDir, {
    title: (a, b) => compareNullableText(a.title, b.title),
    created_at: (a, b) => compareNullableDate(a.created_at, b.created_at),
    access_count: (a, b) => a.access_count - b.access_count,
  });

  return ok({
    banks: paginateRows(sorted, page, perPage),
    total: sorted.length,
    page,
    perPage,
    sortBy,
    sortDir,
    includeDeleted,
  });
};

const listActivity = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get("perPage") || 30)));
  const sortBy = normalizeActivitySortBy(url.searchParams.get("sortBy"));
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
  const eventType = normalizeActivityEventType(url.searchParams.get("eventType"));
  const scope = normalizeActivityScope(url.searchParams.get("scope"));
  const status = normalizeActivityStatus(url.searchParams.get("status"));
  const phase = asString(url.searchParams.get("phase"), 80);
  const category = asString(url.searchParams.get("category"), 80);
  const uploadResult = normalizeActivityUploadResult(url.searchParams.get("uploadResult"));
  const from = asString(url.searchParams.get("from"), 80);
  const to = asString(url.searchParams.get("to"), 80);
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const fromIso = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate.toISOString() : null;
  const toIso = toDate && !Number.isNaN(toDate.getTime()) ? toDate.toISOString() : null;

  let query: any = admin
    .from("activity_logs")
    .select(
      "id, created_at, event_type, status, user_id, email, bank_id, bank_uuid, bank_name, pad_count, error_message, meta",
      { count: "planned" },
    );

  if (eventType) {
    query = query.eq("event_type", eventType);
  } else if (scope === "export") {
    query = query.eq("event_type", "bank.export");
  } else if (scope === "auth") {
    query = query.in("event_type", ["auth.login", "auth.signup", "auth.signout"]);
  } else if (scope === "non_export") {
    query = query.neq("event_type", "bank.export");
  }
  if (status) query = query.eq("status", status);
  if (phase) query = query.contains("meta", { phase });
  if (category) query = query.contains("meta", { category });
  if (uploadResult) query = query.contains("meta", { upload: { result: uploadResult } });
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lte("created_at", toIso);
  if (q) {
    const safe = q.replace(/[%*,]/g, " ").trim();
    if (safe) {
      query = query.or(
        `email.ilike.%${safe}%,bank_name.ilike.%${safe}%,event_type.ilike.%${safe}%`,
      );
    }
  }

  query = query.order(sortBy, { ascending: sortDir === "asc" });
  const rangeFrom = (page - 1) * perPage;
  const rangeTo = rangeFrom + perPage - 1;
  query = query.range(rangeFrom, rangeTo);

  const { data: rows, error, count } = await query;
  if (error) return fail(500, error.message);

  const userIds = Array.from(
    new Set((rows || []).map((row: any) => asUuid(row.user_id)).filter(Boolean) as string[]),
  );
  const profileMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    if (profileError) return fail(500, profileError.message);
    for (const profile of profiles || []) {
      profileMap.set(String((profile as any).id), String((profile as any).display_name || ""));
    }
  }

  const activity = (rows || []).map((row: any) => ({
    id: Number(row.id || 0),
    created_at: row.created_at || null,
    event_type: row.event_type || "",
    status: row.status || "",
    user_id: row.user_id || null,
    display_name: row.user_id ? (profileMap.get(String(row.user_id)) || null) : null,
    email: row.email || null,
    bank_id: row.bank_id || null,
    bank_uuid: row.bank_uuid || null,
    bank_name: row.bank_name || null,
    pad_count: row.pad_count ?? null,
    error_message: row.error_message || null,
    meta: row.meta || {},
  }));

  return ok({
    activity,
    total: Number(count || 0),
    page,
    perPage,
    sortBy,
    sortDir,
    eventType: eventType || null,
    scope,
    status: status || null,
    phase: phase || null,
    category: category || null,
    uploadResult: uploadResult || null,
  });
};

const getDashboardOverview = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const rawWindowDays = Number(url.searchParams.get("windowDays") || 7);
  const parsedWindowDays = Math.max(1, Math.min(DASHBOARD_MAX_WINDOW_DAYS, Number.isFinite(rawWindowDays) ? Math.floor(rawWindowDays) : 7));
  const now = new Date();
  const nowIso = now.toISOString();
  const startOfTodayManila = startOfFixedOffsetDay(now, ASIA_MANILA_UTC_OFFSET_MINUTES);
  const endOfTodayManila = new Date(startOfTodayManila.getTime() + (24 * 60 * 60 * 1000) - 1);
  const fromDateParam = parseDateOnlyParam(url.searchParams.get("fromDate"));
  const toDateParam = parseDateOnlyParam(url.searchParams.get("toDate"));

  let windowEnd = toDateParam
    ? new Date(fixedOffsetDateOnlyStart(toDateParam, ASIA_MANILA_UTC_OFFSET_MINUTES).getTime() + (24 * 60 * 60 * 1000) - 1)
    : endOfTodayManila;

  const windowEndStartOfDay = startOfFixedOffsetDay(windowEnd, ASIA_MANILA_UTC_OFFSET_MINUTES);
  let windowStart = fromDateParam
    ? fixedOffsetDateOnlyStart(fromDateParam, ASIA_MANILA_UTC_OFFSET_MINUTES)
    : new Date(windowEndStartOfDay.getTime() - ((parsedWindowDays - 1) * 24 * 60 * 60 * 1000));

  if (windowStart.getTime() > windowEnd.getTime()) {
    windowStart = new Date(windowEndStartOfDay);
  }

  let windowDays = Math.floor((windowEndStartOfDay.getTime() - startOfFixedOffsetDay(windowStart, ASIA_MANILA_UTC_OFFSET_MINUTES).getTime()) / (24 * 60 * 60 * 1000)) + 1;
  windowDays = Math.max(1, Math.min(DASHBOARD_MAX_WINDOW_DAYS, windowDays));
  if (windowDays >= DASHBOARD_MAX_WINDOW_DAYS) {
    windowStart = new Date(windowEndStartOfDay.getTime() - ((DASHBOARD_MAX_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000));
    windowDays = DASHBOARD_MAX_WINDOW_DAYS;
  }

  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();
  const windowStartDate = toFixedOffsetDateKey(windowStart, ASIA_MANILA_UTC_OFFSET_MINUTES);
  const windowEndDate = toFixedOffsetDateKey(windowEndStartOfDay, ASIA_MANILA_UTC_OFFSET_MINUTES);
  const isHourlyWindow = windowDays === 1;
  const todayStartIso = startOfTodayManila.toISOString();
  const todayEndIso = endOfTodayManila.toISOString();

  const { data: adminRows, error: adminRowsError } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  if (adminRowsError) return fail(500, adminRowsError.message);
  const adminIds = new Set((adminRows || []).map((row: any) => String(row.id || "")).filter(Boolean));

  const { data: activeRows, error: activeRowsError } = await admin
    .from("v_active_sessions_now")
    .select("user_id")
    .order("last_seen_at", { ascending: false })
    .limit(Math.max(100, Math.min(10000, DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT)));
  if (activeRowsError) return fail(500, activeRowsError.message);
  const nonAdminActiveRows = (activeRows || []).filter((row: any) => {
    const userId = String(row?.user_id || "");
    if (!userId) return false;
    return !adminIds.has(userId);
  });
  const uniqueActiveUsers = new Set(nonAdminActiveRows.map((row: any) => String(row.user_id))).size;

  const [
    activeTodayRowsResp,
    pendingAccountCountResp,
    pendingAccountUpgradeCountResp,
    pendingStoreCountResp,
    pendingInstallerCountResp,
    todayAccountRequestsResp,
    todayAccountUpgradeRequestsResp,
    todayStoreRequestsResp,
    todayInstallerRequestsResp,
    publishedCatalogCountResp,
    draftCatalogCountResp,
    totalRegisteredUsersResp,
    totalInstallerLicensesResp,
    approvedStoreRequestsResp,
    importFailures24hResp,
    imports24hResp,
    storeRevenue24hResp,
    accountRevenue24hResp,
    accountUpgradeRevenue24hResp,
    installerRevenue24hResp,
    revenueTotalsResp,
    installerRevenueTotalsResp,
  ] = await Promise.all([
    admin
      .from("active_sessions")
      .select("user_id")
      .gte("last_seen_at", startOfTodayManila.toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT * 5),
    admin
      .from("account_registration_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    admin
      .from("account_upgrade_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    admin
      .from("bank_purchase_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    admin
      .from("installer_purchase_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    admin
      .from("account_registration_requests")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso),
    admin
      .from("account_upgrade_requests")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso),
    admin
      .from("bank_purchase_requests")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso),
    admin
      .from("installer_purchase_requests")
      .select("id", { head: true, count: "exact" })
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso),
    admin
      .from("bank_catalog_items")
      .select("id", { head: true, count: "exact" })
      .eq("is_published", true),
    admin
      .from("bank_catalog_items")
      .select("id", { head: true, count: "exact" })
      .eq("is_published", false),
    admin
      .from("profiles")
      .select("id", { head: true, count: "exact" })
      .neq("role", "admin"),
    admin
      .from("installer_purchase_requests")
      .select("issued_license_code")
      .eq("status", "approved")
      .not("issued_license_code", "is", null)
      .limit(10000),
    admin
      .from("bank_purchase_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "approved"),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .eq("event_type", "bank.import")
      .eq("status", "failed")
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .eq("event_type", "bank.import")
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso),
    admin
      .from("bank_purchase_requests")
      .select("price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso)
      .limit(5000),
    admin
      .from("account_registration_requests")
      .select("account_price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso)
      .limit(5000),
    admin
      .from("account_upgrade_requests")
      .select("quote_price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso)
      .limit(5000),
    admin
      .from("installer_purchase_requests")
      .select("receipt_reference, price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", todayStartIso)
      .lte("created_at", todayEndIso)
      .limit(10000),
    admin
      .from("v_admin_dashboard_revenue_totals")
      .select("store_revenue_approved_total,account_revenue_approved_total,store_buyers_approved_total,account_buyers_approved_total")
      .limit(1)
      .maybeSingle(),
    admin
      .from("installer_purchase_requests")
      .select("receipt_reference, price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .limit(10000),
  ]);

  if (activeTodayRowsResp.error) return fail(500, activeTodayRowsResp.error.message);
  if (pendingAccountCountResp.error) return fail(500, pendingAccountCountResp.error.message);
  if (pendingAccountUpgradeCountResp.error) return fail(500, pendingAccountUpgradeCountResp.error.message);
  if (pendingStoreCountResp.error) return fail(500, pendingStoreCountResp.error.message);
  if (pendingInstallerCountResp.error) return fail(500, pendingInstallerCountResp.error.message);
  if (todayAccountRequestsResp.error) return fail(500, todayAccountRequestsResp.error.message);
  if (todayAccountUpgradeRequestsResp.error) return fail(500, todayAccountUpgradeRequestsResp.error.message);
  if (todayStoreRequestsResp.error) return fail(500, todayStoreRequestsResp.error.message);
  if (todayInstallerRequestsResp.error) return fail(500, todayInstallerRequestsResp.error.message);
  if (publishedCatalogCountResp.error) return fail(500, publishedCatalogCountResp.error.message);
  if (draftCatalogCountResp.error) return fail(500, draftCatalogCountResp.error.message);
  if (totalRegisteredUsersResp.error) return fail(500, totalRegisteredUsersResp.error.message);
  if (totalInstallerLicensesResp.error) return fail(500, totalInstallerLicensesResp.error.message);
  if (approvedStoreRequestsResp.error) return fail(500, approvedStoreRequestsResp.error.message);
  if (importFailures24hResp.error) return fail(500, importFailures24hResp.error.message);
  if (imports24hResp.error) return fail(500, imports24hResp.error.message);
  if (storeRevenue24hResp.error) return fail(500, storeRevenue24hResp.error.message);
  if (accountRevenue24hResp.error) return fail(500, accountRevenue24hResp.error.message);
  if (accountUpgradeRevenue24hResp.error) return fail(500, accountUpgradeRevenue24hResp.error.message);
  if (installerRevenue24hResp.error) return fail(500, installerRevenue24hResp.error.message);
  if (revenueTotalsResp.error) return fail(500, revenueTotalsResp.error.message);
  if (installerRevenueTotalsResp.error) return fail(500, installerRevenueTotalsResp.error.message);

  const [
    accountQueueResp,
    accountUpgradeQueueResp,
    storeQueueResp,
    trendRowsResp,
    storeRevenueRangeResp,
    accountRevenueRangeResp,
    accountUpgradeRevenueRangeResp,
    storeRequestRangeResp,
    revenueDailyResp,
    installerRevenueDailyResp,
    installerRequestDailyResp,
  ] = await Promise.all([
    admin
      .from("account_registration_requests")
      .select("id, display_name, email, payment_channel, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("account_upgrade_requests")
      .select("id, display_name, email, payment_channel, target_tier, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("bank_purchase_requests")
      .select("id, user_id, bank_id, payment_channel, created_at, banks ( title )")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("activity_logs")
      .select("created_at, event_type, status, user_id")
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(Math.max(100, Math.min(10000, DASHBOARD_SERIES_CAP))),
    admin
      .from("bank_purchase_requests")
      .select("created_at, price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(10000),
    admin
      .from("account_registration_requests")
      .select("created_at, account_price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(10000),
    admin
      .from("account_upgrade_requests")
      .select("created_at, quote_price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(10000),
    admin
      .from("bank_purchase_requests")
      .select("created_at")
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(10000),
    admin
      .from("v_admin_dashboard_revenue_daily")
      .select("date_utc,store_revenue_approved,account_revenue_approved,store_buyers_approved,account_buyers_approved,store_requests_total")
      .gte("date_utc", windowStartDate)
      .lte("date_utc", windowEndDate)
      .order("date_utc", { ascending: true })
      .limit(Math.max(30, Math.min(365, windowDays + 32))),
    admin
      .from("installer_purchase_requests")
      .select("created_at, receipt_reference, price_php_snapshot")
      .eq("status", "approved")
      .eq("is_refunded", false)
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(10000),
    admin
      .from("installer_purchase_requests")
      .select("id, created_at, receipt_reference")
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(10000),
  ]);

  if (accountQueueResp.error) return fail(500, accountQueueResp.error.message);
  if (accountUpgradeQueueResp.error) return fail(500, accountUpgradeQueueResp.error.message);
  if (storeQueueResp.error) return fail(500, storeQueueResp.error.message);
  if (trendRowsResp.error) return fail(500, trendRowsResp.error.message);
  if (storeRevenueRangeResp.error) return fail(500, storeRevenueRangeResp.error.message);
  if (accountRevenueRangeResp.error) return fail(500, accountRevenueRangeResp.error.message);
  if (accountUpgradeRevenueRangeResp.error) return fail(500, accountUpgradeRevenueRangeResp.error.message);
  if (storeRequestRangeResp.error) return fail(500, storeRequestRangeResp.error.message);
  if (revenueDailyResp.error) return fail(500, revenueDailyResp.error.message);
  if (installerRevenueDailyResp.error) return fail(500, installerRevenueDailyResp.error.message);
  if (installerRequestDailyResp.error) return fail(500, installerRequestDailyResp.error.message);

  const attendanceTrendResp = await admin
    .from("user_daily_attendance")
    .select("user_id,attendance_date,first_seen_at,last_seen_at")
    .gte("attendance_date", windowStartDate)
    .lte("attendance_date", windowEndDate)
    .order("attendance_date", { ascending: true })
    .limit(Math.max(1000, Math.min(50000, DASHBOARD_SERIES_CAP * 10)));
  if (attendanceTrendResp.error && !isMissingAttendanceStorageError(attendanceTrendResp.error)) {
    return fail(500, attendanceTrendResp.error.message);
  }
  const attendanceTrendAvailable = !attendanceTrendResp.error;
  const attendanceTrendRows = attendanceTrendAvailable ? (attendanceTrendResp.data || []) : [];
  const todayAttendanceDateKey = toFixedOffsetDateKey(now, ASIA_MANILA_UTC_OFFSET_MINUTES);
  const attendanceTodayResp = await admin
    .from("user_daily_attendance")
    .select("user_id,attendance_date")
    .eq("attendance_date", todayAttendanceDateKey)
    .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT * 5);
  if (attendanceTodayResp.error && !isMissingAttendanceStorageError(attendanceTodayResp.error)) {
    return fail(500, attendanceTodayResp.error.message);
  }
  const attendanceTodayAvailable = !attendanceTodayResp.error;
  const attendanceTodayRowsForCount = attendanceTodayAvailable ? (attendanceTodayResp.data || []) : [];

  const storeQueueRows = storeQueueResp.data || [];
  const storeQueueUserIds = Array.from(
    new Set(storeQueueRows.map((row: any) => asUuid(row?.user_id)).filter(Boolean) as string[]),
  );
  const profileMap = new Map<string, string>();
  if (storeQueueUserIds.length > 0) {
    const { data: profileRows, error: profileRowsError } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", storeQueueUserIds);
    if (profileRowsError) return fail(500, profileRowsError.message);
    for (const row of profileRows || []) {
      profileMap.set(String((row as any).id || ""), String((row as any).display_name || ""));
    }
  }

  const trendSeed = new Map<string, {
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
  }>();
  const createEmptyTrendBucket = (date: string) => ({
    date,
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
  const toTrendBucketKey = (value: Date): string => {
    if (!isHourlyWindow) return toFixedOffsetDateKey(value, ASIA_MANILA_UTC_OFFSET_MINUTES);
    const shifted = new Date(value.getTime() + (ASIA_MANILA_UTC_OFFSET_MINUTES * 60 * 1000));
    return `${String(shifted.getUTCHours()).padStart(2, "0")}:00`;
  };
  if (isHourlyWindow) {
    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${String(hour).padStart(2, "0")}:00`;
      trendSeed.set(label, createEmptyTrendBucket(label));
    }
  } else {
    for (let offset = 0; offset < windowDays; offset += 1) {
      const day = new Date(windowStart.getTime() + (offset * 24 * 60 * 60 * 1000));
      const date = toFixedOffsetDateKey(day, ASIA_MANILA_UTC_OFFSET_MINUTES);
      trendSeed.set(date, createEmptyTrendBucket(date));
    }
  }

  for (const row of storeRevenueRangeResp.data || []) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const bucket = trendSeed.get(toTrendBucketKey(createdAt));
    if (!bucket) continue;
    bucket.storeRevenueApproved += asFiniteNumber((row as any).price_php_snapshot);
    bucket.storeBuyersApproved += 1;
    bucket.totalRevenueApproved = bucket.storeRevenueApproved + bucket.accountRevenueApproved + bucket.installerRevenueApproved;
  }
  for (const row of accountRevenueRangeResp.data || []) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const bucket = trendSeed.get(toTrendBucketKey(createdAt));
    if (!bucket) continue;
    bucket.accountRevenueApproved += asFiniteNumber((row as any).account_price_php_snapshot);
    bucket.accountBuyersApproved += 1;
    bucket.totalRevenueApproved = bucket.storeRevenueApproved + bucket.accountRevenueApproved + bucket.installerRevenueApproved;
  }
  for (const row of accountUpgradeRevenueRangeResp.data || []) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const bucket = trendSeed.get(toTrendBucketKey(createdAt));
    if (!bucket) continue;
    bucket.accountRevenueApproved += asFiniteNumber((row as any).quote_price_php_snapshot);
    bucket.accountBuyersApproved += 1;
    bucket.totalRevenueApproved = bucket.storeRevenueApproved + bucket.accountRevenueApproved + bucket.installerRevenueApproved;
  }
  for (const row of storeRequestRangeResp.data || []) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const bucket = trendSeed.get(toTrendBucketKey(createdAt));
    if (!bucket) continue;
    bucket.importRequests += 1;
  }

  const installerRevenueDailyMap = new Map<string, { revenue: number; receiptRefs: Set<string> }>();
  for (const row of installerRevenueDailyResp.data || []) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const date = toTrendBucketKey(createdAt);
    const daily = installerRevenueDailyMap.get(date) || { revenue: 0, receiptRefs: new Set<string>() };
    daily.revenue += asFiniteNumber((row as any).price_php_snapshot);
    const receiptReference = asString((row as any).receipt_reference, 160) || "";
    if (receiptReference) daily.receiptRefs.add(receiptReference);
    installerRevenueDailyMap.set(date, daily);
  }
  for (const [date, daily] of installerRevenueDailyMap.entries()) {
    const bucket = trendSeed.get(date);
    if (!bucket) continue;
    bucket.installerRevenueApproved = daily.revenue;
    bucket.installerSalesApproved = daily.receiptRefs.size;
    bucket.totalRevenueApproved = bucket.storeRevenueApproved + bucket.accountRevenueApproved + daily.revenue;
  }

  const installerRequestDailyMap = new Map<string, Set<string>>();
  for (const row of installerRequestDailyResp.data || []) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const date = toTrendBucketKey(createdAt);
    const daily = installerRequestDailyMap.get(date) || new Set<string>();
    const rawReceiptReference = asString((row as any).receipt_reference, 160) || "";
    const requestKey = rawReceiptReference || `row:${asString((row as any).id, 160) || ""}`;
    if (!requestKey) continue;
    daily.add(requestKey);
    installerRequestDailyMap.set(date, daily);
  }
  for (const [date, requestKeys] of installerRequestDailyMap.entries()) {
    const bucket = trendSeed.get(date);
    if (!bucket) continue;
    bucket.importRequests += requestKeys.size;
  }

  const trendRows = trendRowsResp.data || [];
  const dailyActiveUserSets = new Map<string, Set<string>>();
  if (attendanceTrendAvailable) {
    const nowManilaHour = new Date(now.getTime() + (ASIA_MANILA_UTC_OFFSET_MINUTES * 60 * 1000)).getUTCHours();
    const maxHourlyBucket = windowStartDate === toFixedOffsetDateKey(now, ASIA_MANILA_UTC_OFFSET_MINUTES)
      ? nowManilaHour
      : windowStartDate < toFixedOffsetDateKey(now, ASIA_MANILA_UTC_OFFSET_MINUTES)
        ? 23
        : -1;
    for (const row of attendanceTrendRows) {
      const userId = String((row as any).user_id || "");
      if (!userId || adminIds.has(userId)) continue;
      const attendanceDate = asString((row as any).attendance_date, 20);
      if (!attendanceDate) continue;
      if (isHourlyWindow) {
        if (maxHourlyBucket < 0) continue;
        const firstSeenAt = new Date(String((row as any).first_seen_at || (row as any).last_seen_at || ""));
        if (Number.isNaN(firstSeenAt.getTime())) continue;
        const shifted = new Date(firstSeenAt.getTime() + (ASIA_MANILA_UTC_OFFSET_MINUTES * 60 * 1000));
        const firstHour = Math.max(0, Math.min(23, shifted.getUTCHours()));
        for (let hour = firstHour; hour <= maxHourlyBucket; hour += 1) {
          const key = `${String(hour).padStart(2, "0")}:00`;
          const activeSet = dailyActiveUserSets.get(key) || new Set<string>();
          activeSet.add(userId);
          dailyActiveUserSets.set(key, activeSet);
        }
      } else {
        const bucket = trendSeed.get(attendanceDate);
        if (!bucket) continue;
        const activeSet = dailyActiveUserSets.get(attendanceDate) || new Set<string>();
        activeSet.add(userId);
        dailyActiveUserSets.set(attendanceDate, activeSet);
      }
    }
  }
  for (const row of trendRows) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const date = toTrendBucketKey(createdAt);
    const bucket = trendSeed.get(date);
    if (!bucket) continue;

    const userId = String((row as any).user_id || "");
    if (!attendanceTrendAvailable && userId && !adminIds.has(userId)) {
      const activeSet = dailyActiveUserSets.get(date) || new Set<string>();
      activeSet.add(userId);
      dailyActiveUserSets.set(date, activeSet);
    }

    const eventType = String((row as any).event_type || "");
    const status = String((row as any).status || "");
    if (eventType === "bank.export") {
      if (status === "failed") bucket.exportFailed += 1;
      else bucket.exportSuccess += 1;
      continue;
    }
    if (eventType === "bank.import") {
      bucket.importTotal += 1;
      continue;
    }
    if (eventType === "auth.login" || eventType === "auth.signup" || eventType === "auth.signout") {
      if (status === "failed") bucket.authFailed += 1;
      else bucket.authSuccess += 1;
      continue;
    }
  }
  for (const [date, activeSet] of dailyActiveUserSets.entries()) {
    const bucket = trendSeed.get(date);
    if (!bucket) continue;
    bucket.activeUsers = activeSet.size;
  }

  const accountRequests = [
    ...(accountQueueResp.data || []).map((row: any) => ({
      id: String(row.id || ""),
      request_type: "legacy_registration",
      display_name: String(row.display_name || ""),
      email: String(row.email || ""),
      payment_channel: String(row.payment_channel || ""),
      created_at: row.created_at || null,
    })),
    ...(accountUpgradeQueueResp.data || []).map((row: any) => ({
      id: String(row.id || ""),
      request_type: "account_upgrade",
      target_tier: normalizeUpgradeTier((row as any).target_tier),
      display_name: String(row.display_name || ""),
      email: String(row.email || ""),
      payment_channel: String(row.payment_channel || ""),
      created_at: row.created_at || null,
    })),
  ]
    .sort((a, b) => new Date(String(b.created_at || "")).getTime() - new Date(String(a.created_at || "")).getTime())
    .slice(0, 5);

  const storeRequests = storeQueueRows.map((row: any) => {
    const bankRelation = Array.isArray(row.banks) ? row.banks[0] : row.banks;
    const userId = String(row.user_id || "");
    const profileLabel = profileMap.get(userId) || "";
    return {
      id: String(row.id || ""),
      user_id: userId || null,
      user_label: profileLabel || (userId ? `${userId.slice(0, 8)}...` : "Unknown User"),
      bank_id: String(row.bank_id || ""),
      bank_name: String(bankRelation?.title || "Unknown Bank"),
      payment_channel: String(row.payment_channel || ""),
      created_at: row.created_at || null,
    };
  });

  const storeRevenue24h = (storeRevenue24hResp.data || []).reduce((acc: number, row: any) => {
    return acc + asFiniteNumber(row?.price_php_snapshot);
  }, 0);
  const accountRevenue24h = (accountRevenue24hResp.data || []).reduce((acc: number, row: any) => {
    return acc + asFiniteNumber(row?.account_price_php_snapshot);
  }, 0);
  const accountUpgradeRevenue24h = (accountUpgradeRevenue24hResp.data || []).reduce((acc: number, row: any) => {
    return acc + asFiniteNumber(row?.quote_price_php_snapshot);
  }, 0);
  const installerRevenue24hSeenReceipts = new Set<string>();
  const installerRevenue24h = (installerRevenue24hResp.data || []).reduce((acc: number, row: any) => {
    const receiptReference = asString((row as any)?.receipt_reference, 160) || "";
    if (!receiptReference || installerRevenue24hSeenReceipts.has(receiptReference)) return acc;
    installerRevenue24hSeenReceipts.add(receiptReference);
    return acc + asFiniteNumber((row as any)?.price_php_snapshot);
  }, 0);
  const totalAccountRevenue24h = accountRevenue24h + accountUpgradeRevenue24h;
  const totalRevenue24h = storeRevenue24h + totalAccountRevenue24h + installerRevenue24h;

  const totalRevenueRow = revenueTotalsResp.data || {};
  const storeRevenueApprovedTotal = asFiniteNumber((totalRevenueRow as any).store_revenue_approved_total);
  const accountRevenueApprovedTotal = asFiniteNumber((totalRevenueRow as any).account_revenue_approved_total);
  const installerRevenueApprovedSeenReceipts = new Set<string>();
  const installerRevenueApprovedTotal = (installerRevenueTotalsResp.data || []).reduce((acc: number, row: any) => {
    const receiptReference = asString((row as any)?.receipt_reference, 160) || "";
    if (!receiptReference || installerRevenueApprovedSeenReceipts.has(receiptReference)) return acc;
    installerRevenueApprovedSeenReceipts.add(receiptReference);
    return acc + asFiniteNumber((row as any)?.price_php_snapshot);
  }, 0);
  const installerSalesApprovedTotal = installerRevenueApprovedSeenReceipts.size;
  const totalRevenueApproved = storeRevenueApprovedTotal + accountRevenueApprovedTotal + installerRevenueApprovedTotal;
  const storeBuyersApprovedTotal = Math.max(0, Math.floor(asFiniteNumber((totalRevenueRow as any).store_buyers_approved_total)));
  const accountBuyersApprovedTotal = Math.max(0, Math.floor(asFiniteNumber((totalRevenueRow as any).account_buyers_approved_total)));
  const totalInstallerLicenses = new Set(
    (totalInstallerLicensesResp.data || [])
      .map((row: any) => asString((row as any)?.issued_license_code, 120) || "")
      .filter(Boolean),
  ).size;
  const activeTodayUsers = new Set(
    (attendanceTodayAvailable
      ? attendanceTodayRowsForCount
      : (activeTodayRowsResp.data || []))
      .map((row: any) => String(row?.user_id || ""))
      .filter((userId) => Boolean(userId) && !adminIds.has(userId)),
  ).size;
  const todayRequestTotal =
    Number(todayAccountRequestsResp.count || 0)
    + Number(todayAccountUpgradeRequestsResp.count || 0)
    + Number(todayStoreRequestsResp.count || 0)
    + Number(todayInstallerRequestsResp.count || 0);
  const pendingAccountRequests =
    Number(pendingAccountCountResp.count || 0)
    + Number(pendingAccountUpgradeCountResp.count || 0);

  return ok({
    refreshedAt: nowIso,
    windowDays,
    counts: {
      activeUsers: uniqueActiveUsers,
      activeSessions: nonAdminActiveRows.length,
      activeTodayUsers,
      pendingAccountRequests,
      pendingStoreRequests: Number(pendingStoreCountResp.count || 0),
      pendingInstallerRequests: Number(pendingInstallerCountResp.count || 0),
      totalRegisteredUsers: Number(totalRegisteredUsersResp.count || 0),
      totalInstallerLicenses,
      approvedStoreRequestsTotal: Number(approvedStoreRequestsResp.count || 0),
      todayRequestTotal,
      importFailures24h: Number(importFailures24hResp.count || 0),
      imports24h: Number(imports24hResp.count || 0),
      storeRevenueApprovedTotal,
      accountRevenueApprovedTotal,
      installerRevenueApprovedTotal,
      totalRevenueApproved,
      storeRevenue24h,
      accountRevenue24h: totalAccountRevenue24h,
      installerRevenue24h,
      totalRevenue24h,
      storeBuyersApprovedTotal,
      accountBuyersApprovedTotal,
      installerSalesApprovedTotal,
      publishedCatalog: Number(publishedCatalogCountResp.count || 0),
      draftCatalog: Number(draftCatalogCountResp.count || 0),
    },
    trends: Array.from(trendSeed.values()),
    queues: {
      accountRequests,
      storeRequests,
    },
    meta: {
      timeBasis: "Asia/Manila",
      activeTodayTimeBasis: "Asia/Manila",
      rangeTimeZone: "Asia/Manila",
      rangeStartIso: windowStartIso,
      rangeEndIso: windowEndIso,
      granularity: isHourlyWindow ? "hour" : "day",
      sampled: trendRows.length >= Math.max(100, Math.min(10000, DASHBOARD_SERIES_CAP)),
      seriesCap: Math.max(100, Math.min(10000, DASHBOARD_SERIES_CAP)),
      rangeStartDate: windowStartDate,
      rangeEndDate: windowEndDate,
    },
  });
};

const updateBank = async (bankId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const title = asString(body?.title, 120);
  const description = asString(body?.description, 2000) || "";
  const color = body?.color === null ? null : normalizeHexColor(body?.color);
  if (!title) return badRequest("title is required");
  if (body?.color !== undefined && body?.color !== null && !color) return badRequest("Invalid color");

  const { data: bankState, error: bankStateError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", bankId)
    .maybeSingle();
  if (bankStateError) return fail(500, bankStateError.message);
  if (!bankState) return fail(404, "Bank not found");
  if (bankState.deleted_at) return fail(400, "Cannot update archived bank");

  const updatePayload: Record<string, unknown> = { title, description };
  if (body?.color !== undefined) updatePayload.color = color;

  const attempt = await admin
    .from("banks")
    .update(updatePayload)
    .eq("id", bankId)
    .select("id, title, description, color, created_at, created_by")
    .single();

  if (attempt.error) {
    const isMissingColorColumn = /column .*color/i.test(attempt.error.message || "");
    if (!isMissingColorColumn) {
      return fail(500, attempt.error.message || "Failed to update bank");
    }

    const fallback = await admin
      .from("banks")
      .update({ title, description })
      .eq("id", bankId)
      .select("id, title, description, created_at, created_by")
      .single();
    if (fallback.error || !fallback.data) {
      return fail(500, fallback.error?.message || "Failed to update bank");
    }
    return ok({ bank: { ...fallback.data, color: null } });
  }

  if (!attempt.data) return fail(500, "Failed to update bank");
  return ok({ bank: attempt.data });
};

const deleteBank = async (
  bankId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const revokeAll = body?.revokeAll !== false;

  const { data: bankRow, error: bankError } = await admin
    .from("banks")
    .select("id, title, deleted_at")
    .eq("id", bankId)
    .maybeSingle();
  if (bankError) return fail(500, bankError.message);
  if (!bankRow) return fail(404, "Bank not found");
  if (bankRow.deleted_at) return ok({ bankId, revokedAll: false, softDeleted: true, alreadyDeleted: true, catalogUnpublished: 0 });

  if (revokeAll) {
    const { error: revokeError } = await admin.from("user_bank_access").delete().eq("bank_id", bankId);
    if (revokeError) return fail(500, revokeError.message);
  }

  const { data: unpublishedRows, error: catalogUpdateError } = await admin
    .from("bank_catalog_items")
    .update({ is_published: false })
    .eq("bank_id", bankId)
    .select("id");
  if (catalogUpdateError) return fail(500, catalogUpdateError.message);

  const { error: softDeleteError } = await admin
    .from("banks")
    .update({ deleted_at: new Date().toISOString(), deleted_by: adminUserId })
    .eq("id", bankId)
    .is("deleted_at", null);
  if (softDeleteError) return fail(500, softDeleteError.message);

  await swallowDiscordError(() =>
    sendDiscordAdminActionEvent({
      severity: "critical",
      title: "Admin Deleted Bank",
      description: "A bank was archived by admin.",
      actorUserId: adminUserId,
      bankId,
      extraFields: [
        { name: "Bank", value: asString((bankRow as any)?.title, 255) || bankId, inline: false },
        { name: "Revoke All Access", value: revokeAll ? "Yes" : "No", inline: true },
        { name: "Catalog Unpublished", value: String((unpublishedRows || []).length), inline: true },
      ],
    })
  );

  return ok({
    bankId,
    revokedAll: revokeAll,
    softDeleted: true,
    catalogUnpublished: (unpublishedRows || []).length,
  });
};

const listAccessByUser = async (userId: string, admin: ReturnType<typeof createServiceClient>) => {
  const { data: rows, error } = await admin
    .from("user_bank_access")
    .select("id, user_id, bank_id, granted_at")
    .eq("user_id", userId)
    .order("granted_at", { ascending: false });
  if (error) return fail(500, error.message);

  const bankIds = Array.from(new Set((rows || []).map((row: any) => row.bank_id)));
  const { data: bankRows, error: banksError } = bankIds.length
    ? await admin.from("banks").select("id, title, description").in("id", bankIds).is("deleted_at", null)
    : { data: [], error: null };
  if (banksError) return fail(500, banksError.message);
  const bankMap = new Map((bankRows || []).map((bank: any) => [bank.id, bank]));

  const access = (rows || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    bank_id: row.bank_id,
    granted_at: row.granted_at,
    bank: bankMap.get(row.bank_id) || null,
  }));
  return ok({
    userId,
    bankIds,
    access,
    total: access.length,
  });
};

const listAccessByBank = async (req: Request, bankId: string, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const qLower = q.toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get("perPage") || 20)));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const { data: bankRow, error: bankError } = await admin
    .from("banks")
    .select("id, title")
    .eq("id", bankId)
    .is("deleted_at", null)
    .maybeSingle();
  if (bankError) return fail(500, bankError.message);
  if (!bankRow) return fail(404, "Bank not found");

  let filteredUserIds: string[] | null = null;
  if (qLower) {
    const qUuid = asUuid(q);
    const { data: profileRows, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .ilike("display_name", `%${qLower}%`)
      .limit(5000);
    if (profileError) return fail(500, profileError.message);

    const userSet = new Set<string>((profileRows || []).map((row: any) => String(row.id || "")).filter(Boolean));
    if (qUuid) userSet.add(qUuid);
    filteredUserIds = Array.from(userSet);
    if (!filteredUserIds.length) {
      return ok({
        bankId,
        bankTitle: bankRow.title || "",
        page,
        perPage,
        total: 0,
        access: [],
      });
    }
  }

  let accessQuery = admin
    .from("user_bank_access")
    .select("id, user_id, bank_id, granted_at", { count: "exact" })
    .eq("bank_id", bankId)
    .order("granted_at", { ascending: false });
  if (filteredUserIds) accessQuery = accessQuery.in("user_id", filteredUserIds);

  const { data: rows, error, count } = await accessQuery.range(from, to);
  if (error) return fail(500, error.message);

  const userIds = Array.from(new Set((rows || []).map((row: any) => String(row.user_id || "")).filter(Boolean)));
  const { data: profileRows, error: profileError } = userIds.length
    ? await admin
      .from("profiles")
      .select("id, role, display_name, owned_bank_quota, owned_bank_pad_cap, device_total_bank_cap")
      .in("id", userIds)
    : { data: [], error: null };
  if (profileError) return fail(500, profileError.message);
  const profileMap = new Map((profileRows || []).map((row: any) => [String(row.id), row]));

  const authUsers = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) return [userId, null] as const;
      return [userId, data?.user || null] as const;
    }),
  );
  const authUserMap = new Map(authUsers);

  const access = (rows || []).map((row: any) => {
    const profile = profileMap.get(String(row.user_id)) || null;
    const authUser = authUserMap.get(String(row.user_id)) || null;
    const email = authUser?.email || null;
    const displayName = asString(profile?.display_name, 120) || asString(authUser?.user_metadata?.display_name, 120) || email?.split("@")[0] || "User";
    return {
      id: row.id,
      user_id: row.user_id,
      bank_id: row.bank_id,
      granted_at: row.granted_at,
      user: {
        id: row.user_id,
        email,
        display_name: displayName,
        role: profile?.role === "admin" ? "admin" : "user",
      },
    };
  });

  return ok({
    bankId,
    bankTitle: bankRow.title || "",
    page,
    perPage,
    total: Number(count || 0),
    access,
  });
};

const grantAccessForUser = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const bankIds = parseUuidList(body?.bankIds);
  if (!bankIds.length) return badRequest("bankIds is required");

  const payload = bankIds.map((bankId) => ({ user_id: userId, bank_id: bankId }));
  const { error } = await admin
    .from("user_bank_access")
    .upsert(payload, { onConflict: "user_id,bank_id" });
  if (error) return fail(500, error.message);

  return ok({ userId, bankIds, grantedCount: bankIds.length });
};

const revokeAccessForUser = async (
  userId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const bankIds = parseUuidList(body?.bankIds);
  if (!bankIds.length) return badRequest("bankIds is required");

  const { error } = await admin
    .from("user_bank_access")
    .delete()
    .eq("user_id", userId)
    .in("bank_id", bankIds);
  if (error) return fail(500, error.message);

  await swallowDiscordError(() =>
    sendDiscordAdminActionEvent({
      severity: "critical",
      title: "Admin Revoked Bank Access",
      description: "Bank access was revoked for a user.",
      actorUserId: adminUserId,
      targetUserId: userId,
      bankIds,
      extraFields: [{ name: "Revoked Count", value: String(bankIds.length), inline: true }],
    })
  );

  return ok({ userId, bankIds, revokedCount: bankIds.length });
};

// Store admin helpers
const createStoreDraft = async (bankId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const expectedAssetName = asString(body?.expected_asset_name, 500);
  if (!expectedAssetName) return badRequest("expected_asset_name is required");
  const thumbnailPath = asString(body?.thumbnail_path, 1000) || null;
  const assetProtection = normalizeCatalogAssetProtection(body?.asset_protection, "encrypted");
  const comingSoon = Boolean(body?.coming_soon);

  const { data: bankData, error: bankError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", bankId)
    .maybeSingle();
  if (bankError || !bankData) return fail(404, "Target bank not found");
  if (bankData.deleted_at) return fail(400, "Cannot create draft for archived bank");

  const { data: existingDraft } = await admin.from("bank_catalog_items").select("id").eq("bank_id", bankId).maybeSingle();
  const draftBaseUpdate: Record<string, unknown> = {
    expected_asset_name: expectedAssetName,
    thumbnail_path: thumbnailPath,
    asset_protection: assetProtection,
    coming_soon: comingSoon,
    is_published: false,
    storage_provider: "r2",
    storage_bucket: "",
    storage_key: "",
    storage_etag: null,
    storage_uploaded_at: null,
    file_size_bytes: null,
    sha256: null,
  };
  if (comingSoon) {
    draftBaseUpdate.is_paid = false;
    draftBaseUpdate.requires_grant = true;
    draftBaseUpdate.price_php = null;
    draftBaseUpdate.price_label = null;
  }

  if (existingDraft?.id) {
    const { data: updated, error: updateError } = await admin.from("bank_catalog_items").update(draftBaseUpdate)
      .eq("id", existingDraft.id).select("*").single();
    if (updateError) return fail(500, updateError.message);
    return ok({ item: updated });
  }

  const { data: newDraft, error: insertError } = await admin.from("bank_catalog_items").insert({
    bank_id: bankId,
    ...draftBaseUpdate,
  }).select("*").single();
  if (insertError) return fail(500, insertError.message);
  return ok({ item: newDraft });
};

const listCatalogUploadSessions = async (
  catalogItemId: string,
  admin: ReturnType<typeof createServiceClient>,
) => {
  const { data: item, error: itemError } = await admin
    .from("bank_catalog_items")
    .select("id,item_type,storage_key")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (itemError) return fail(500, itemError.message);
  if (!item) return fail(404, "Catalog item not found");
  if (String(item?.item_type || "").trim().toLowerCase() === "bank_bundle") {
    return ok({ sessions: [], item });
  }

  const { data: rows, error } = await admin
    .from("r2_direct_upload_sessions")
    .select("id,catalog_item_id,bank_id,status,failure_reason,created_at,updated_at,completed_at,expires_at,storage_bucket,storage_key,expected_file_size_bytes,expected_sha256,meta")
    .eq("scope", "admin_catalog")
    .eq("catalog_item_id", catalogItemId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return fail(500, error.message);

  const currentStorageKey = asString(item?.storage_key, 2000) || "";
  const visibleRows = (rows || [])
    .filter((row: any) => asString(row?.failure_reason, 2000) !== "ASSET_DELETED_BY_ADMIN")
    .slice(0, 12);
  const sessions = await Promise.all(visibleRows.map((row: any) => mapAdminCatalogUploadSessionView(row, currentStorageKey)));
  return ok({ sessions, item });
};

const promoteCatalogUploadSession = async (
  catalogItemId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const sessionId = asUuid(body?.sessionId || body?.session_id);
  if (!sessionId) return badRequest("Missing or invalid sessionId");

  const { data: item, error: itemError } = await admin
    .from("bank_catalog_items")
    .select("*")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (itemError) return fail(500, itemError.message);
  if (!item) return fail(404, "Catalog item not found");
  if (String(item?.item_type || "").trim().toLowerCase() === "bank_bundle") {
    return badRequest("Bundle catalog items do not support asset session promotion");
  }

  const { data: session, error: sessionError } = await admin
    .from("r2_direct_upload_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("scope", "admin_catalog")
    .maybeSingle();
  if (sessionError) return fail(500, sessionError.message);
  if (!session) return fail(404, "Upload session not found");
  if (asUuid(session?.catalog_item_id) !== catalogItemId) return badRequest("CATALOG_ITEM_MISMATCH");

  const storageBucket = asString(session?.storage_bucket, 300) || "";
  const storageKey = asString(session?.storage_key, 2000) || "";
  if (!storageBucket || !storageKey) return fail(400, "SESSION_ASSET_MISSING");

  let objectInfo: Awaited<ReturnType<typeof headObject>>;
  try {
    objectInfo = await headObject(storageBucket, storageKey);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
  }
  if (!objectInfo) return fail(404, "ASSET_NOT_FOUND");

  const expectedFileSizeBytes = Math.max(0, Math.floor(Number(asNumber(session?.expected_file_size_bytes) || 0)));
  if (expectedFileSizeBytes > 0 && objectInfo.sizeBytes !== expectedFileSizeBytes) {
    return fail(409, "ASSET_SIZE_MISMATCH");
  }

  const meta = typeof session?.meta === "object" && session.meta ? session.meta as Record<string, unknown> : {};
  const nextAssetProtection = normalizeCatalogAssetProtection(meta.assetProtection, normalizeCatalogAssetProtection(item?.asset_protection, "encrypted"));
  const resolvedAssetName = getAssetNameFromStorageKey(storageKey) || asString(item?.expected_asset_name, 500) || null;
  const nowIso = new Date().toISOString();

  const { data: updatedItem, error: updateError } = await admin
    .from("bank_catalog_items")
    .update({
      is_published: Boolean(item?.is_published),
      coming_soon: Boolean(item?.coming_soon),
      asset_protection: nextAssetProtection,
      storage_provider: "r2",
      storage_bucket: storageBucket,
      storage_key: storageKey,
      storage_etag: objectInfo.etag,
      storage_uploaded_at: nowIso,
      expected_asset_name: resolvedAssetName || item.expected_asset_name,
      file_size_bytes: objectInfo.sizeBytes,
    })
    .eq("id", catalogItemId)
    .select("*")
    .single();
  if (updateError) return fail(500, updateError.message);

  await admin
    .from("r2_direct_upload_sessions")
    .update({
      status: "completed",
      failure_reason: null,
      completed_at: nowIso,
    })
    .eq("id", sessionId);

  await admin
    .from("r2_direct_upload_sessions")
    .update({
      status: "failed",
      failure_reason: "SUPERSEDED_BY_PROMOTED_ASSET",
      completed_at: nowIso,
    })
    .eq("scope", "admin_catalog")
    .eq("catalog_item_id", catalogItemId)
    .eq("status", "issued")
    .neq("id", sessionId);

  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "info",
    title: "Store Catalog Asset Promoted",
    description: "Admin promoted a previously uploaded staged asset to the catalog row.",
    actorUserId: adminUserId,
    bankId: asString(item.bank_id, 80) || null,
    catalogItemId,
    extraFields: [
      { name: "Asset", value: resolvedAssetName || storageKey, inline: false },
      { name: "Protection", value: nextAssetProtection, inline: true },
      { name: "Published", value: item?.is_published ? "Yes" : "No", inline: true },
    ],
  }));

  const sessionView = await mapAdminCatalogUploadSessionView({ ...session, status: "completed", failure_reason: null, completed_at: nowIso }, storageKey);
  return ok({ item: updatedItem, session: sessionView });
};

const deleteCatalogUploadSessionAsset = async (
  catalogItemId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const sessionId = asUuid(body?.sessionId || body?.session_id);
  if (!sessionId) return badRequest("Missing or invalid sessionId");

  const { data: item, error: itemError } = await admin
    .from("bank_catalog_items")
    .select("id,bank_id,storage_key")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (itemError) return fail(500, itemError.message);
  if (!item) return fail(404, "Catalog item not found");

  const { data: session, error: sessionError } = await admin
    .from("r2_direct_upload_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("scope", "admin_catalog")
    .maybeSingle();
  if (sessionError) return fail(500, sessionError.message);
  if (!session) return fail(404, "Upload session not found");
  if (asUuid(session?.catalog_item_id) !== catalogItemId) return badRequest("CATALOG_ITEM_MISMATCH");

  const storageBucket = asString(session?.storage_bucket, 300) || "";
  const storageKey = asString(session?.storage_key, 2000) || "";
  if (!storageBucket || !storageKey) return badRequest("SESSION_ASSET_MISSING");
  if (storageKey === (asString(item?.storage_key, 2000) || "")) {
    return fail(409, "CURRENT_CATALOG_ASSET");
  }

  try {
    await deleteObject(storageBucket, storageKey);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "R2_DELETE_FAILED");
  }

  await admin
    .from("r2_direct_upload_sessions")
    .update({
      status: "failed",
      failure_reason: "ASSET_DELETED_BY_ADMIN",
      completed_at: asString(session?.completed_at, 80) || new Date().toISOString(),
    })
    .eq("id", sessionId);

  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "critical",
    title: "Staged Store Asset Deleted",
    description: "Admin deleted a stale staged catalog upload asset.",
    actorUserId: adminUserId,
    bankId: asString(item.bank_id, 80) || null,
    catalogItemId,
    extraFields: [
      { name: "Asset", value: getAssetNameFromStorageKey(storageKey) || storageKey, inline: false },
    ],
  }));

  return ok({ deleted: true, sessionId });
};

const listCatalogAssetVariants = async (
  catalogItemId: string,
  admin: ReturnType<typeof createServiceClient>,
) => {
  const { data: item, error: itemError } = await admin
    .from("bank_catalog_items")
    .select("id,item_type")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (itemError) return fail(500, itemError.message);
  if (!item) return fail(404, "Catalog item not found");
  if (String(item?.item_type || "").trim().toLowerCase() === "bank_bundle") {
    return ok({ variants: [], item });
  }

  const { data: rows, error } = await admin
    .from("bank_catalog_asset_variants")
    .select("*, bank_catalog_asset_variant_parts (*)")
    .eq("catalog_item_id", catalogItemId)
    .order("updated_at", { ascending: false });
  if (error) return fail(500, error.message);

  const variants = await Promise.all((rows || []).map((row: any) => mapAdminCatalogAssetVariantView(row)));
  return ok({ variants, item });
};

const startLowMemoryCatalogVariantUpload = async (
  catalogItemId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const { data: item, error: itemError } = await admin
    .from("bank_catalog_items")
    .select("id,bank_id,item_type")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (itemError) return fail(500, itemError.message);
  if (!item) return fail(404, "Catalog item not found");
  if (String(item?.item_type || "").trim().toLowerCase() === "bank_bundle") {
    return badRequest("Bundle catalog items do not support low-memory variants");
  }

  const totalFileSizeBytes = Number(asNumber(body?.totalFileSizeBytes ?? body?.total_file_size_bytes) || 0);
  const sourceAssetSha256 = asString(body?.sourceAssetSha256 ?? body?.source_asset_sha256, 128) || null;
  const minClientVersion = asString(body?.minClientVersion ?? body?.min_client_version, 64) || null;
  const manifestExpectedFileSizeBytes = Number(
    asNumber(body?.manifest?.fileSizeBytes ?? body?.manifest?.file_size_bytes) || 0,
  );
  const manifestExpectedSha256 = asString(body?.manifest?.sha256 ?? body?.manifest?.expected_sha256, 128) || null;
  const parts = Array.isArray(body?.parts) ? body.parts : [];
  if (!Number.isFinite(totalFileSizeBytes) || totalFileSizeBytes <= 0) {
    return badRequest("Missing or invalid totalFileSizeBytes");
  }
  if (!Number.isFinite(manifestExpectedFileSizeBytes) || manifestExpectedFileSizeBytes <= 0) {
    return badRequest("Missing or invalid manifest.fileSizeBytes");
  }
  if (parts.length === 0) return badRequest("At least one low-memory part is required");
  if (parts.length > 64) return badRequest("Too many low-memory parts");

  const normalizedParts = parts.map((part: any, index: number) => {
    const partIndex = Math.max(0, Math.floor(Number(asNumber(part?.partIndex ?? part?.part_index) ?? index)));
    const fileSizeBytes = Number(asNumber(part?.fileSizeBytes ?? part?.file_size_bytes) || 0);
    const sha256 = asString(part?.sha256, 128) || null;
    const padStartIndex = Math.max(0, Math.floor(Number(asNumber(part?.padStartIndex ?? part?.pad_start_index) || 0)));
    const padEndIndex = Math.max(padStartIndex, Math.floor(Number(asNumber(part?.padEndIndex ?? part?.pad_end_index) || padStartIndex)));
    const assetName = asString(part?.assetName ?? part?.asset_name, 255) || null;
    return {
      partIndex,
      fileSizeBytes,
      sha256,
      padStartIndex,
      padEndIndex,
      assetName,
    };
  }).sort((left, right) => left.partIndex - right.partIndex);

  const distinctPartIndexes = new Set(normalizedParts.map((part) => part.partIndex));
  if (distinctPartIndexes.size !== normalizedParts.length) return badRequest("Duplicate part indexes are not allowed");
  if (normalizedParts.some((part) => !Number.isFinite(part.fileSizeBytes) || part.fileSizeBytes <= 0)) {
    return badRequest("Every part must include a valid fileSizeBytes");
  }

  const existingVariantResult = await admin
    .from("bank_catalog_asset_variants")
    .select("id")
    .eq("catalog_item_id", catalogItemId)
    .eq("variant_type", "low_memory_segmented")
    .maybeSingle();
  if (existingVariantResult.error) return fail(500, existingVariantResult.error.message);

  const variantId = asUuid(existingVariantResult.data?.id) || crypto.randomUUID();
  const manifestStorageBucket = R2_BUCKET;
  const manifestStorageKey = buildCatalogLowMemoryManifestObjectKey(catalogItemId, variantId);
  if (!manifestStorageBucket) return fail(500, "R2_BUCKET is not configured");

  const variantPayload = {
    catalog_item_id: catalogItemId,
    variant_type: "low_memory_segmented",
    status: "uploading",
    manifest_storage_bucket: manifestStorageBucket,
    manifest_storage_key: manifestStorageKey,
    total_file_size_bytes: Math.max(0, Math.floor(totalFileSizeBytes)),
    part_count: normalizedParts.length,
    min_client_version: minClientVersion,
    source_asset_sha256: sourceAssetSha256,
    created_by: adminUserId,
    updated_by: adminUserId,
  };

  const upsertResult = existingVariantResult.data?.id
    ? await admin
      .from("bank_catalog_asset_variants")
      .update(variantPayload)
      .eq("id", variantId)
      .select("*")
      .single()
    : await admin
      .from("bank_catalog_asset_variants")
      .insert({ id: variantId, ...variantPayload })
      .select("*")
      .single();
  if (upsertResult.error || !upsertResult.data) return fail(500, upsertResult.error?.message || "Could not prepare low-memory variant");

  const deletePartsResult = await admin
    .from("bank_catalog_asset_variant_parts")
    .delete()
    .eq("variant_id", variantId);
  if (deletePartsResult.error) return fail(500, deletePartsResult.error.message);

  const partRows = normalizedParts.map((part) => ({
    variant_id: variantId,
    part_index: part.partIndex,
    storage_bucket: manifestStorageBucket,
    storage_key: buildCatalogLowMemoryPartObjectKey(catalogItemId, variantId, part.partIndex, part.assetName),
    file_size_bytes: Math.max(1, Math.floor(part.fileSizeBytes)),
    sha256: part.sha256,
    pad_start_index: part.padStartIndex,
    pad_end_index: part.padEndIndex,
  }));
  const insertPartsResult = await admin
    .from("bank_catalog_asset_variant_parts")
    .insert(partRows)
    .select("*");
  if (insertPartsResult.error) return fail(500, insertPartsResult.error.message);

  const manifestSigned = await createPresignedPutUrl(
    manifestStorageBucket,
    manifestStorageKey,
    Math.max(60, Math.min(R2_UPLOAD_URL_TTL_SECONDS, R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS)),
  );
  const partUploads = await Promise.all(partRows.map(async (partRow) => {
    const signed = await createPresignedPutUrl(
      manifestStorageBucket,
      partRow.storage_key,
      Math.max(60, Math.min(R2_UPLOAD_URL_TTL_SECONDS, R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS)),
    );
    return {
      partIndex: partRow.part_index,
      storageBucket: partRow.storage_bucket,
      storageKey: partRow.storage_key,
      fileSizeBytes: partRow.file_size_bytes,
      sha256: partRow.sha256,
      padStartIndex: partRow.pad_start_index,
      padEndIndex: partRow.pad_end_index,
      uploadUrl: signed.url,
      urlExpiresAt: signed.expiresAt,
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": "application/octet-stream",
      },
    };
  }));

  return ok({
    variantId,
    variantType: "low_memory_segmented",
    manifest: {
      storageBucket: manifestStorageBucket,
      storageKey: manifestStorageKey,
      expectedFileSizeBytes: Math.max(1, Math.floor(manifestExpectedFileSizeBytes)),
      expectedSha256: manifestExpectedSha256,
      uploadUrl: manifestSigned.url,
      urlExpiresAt: manifestSigned.expiresAt,
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": "application/json",
      },
    },
    parts: partUploads,
  });
};

const completeLowMemoryCatalogVariantUpload = async (
  catalogItemId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const variantId = asUuid(body?.variantId ?? body?.variant_id);
  if (!variantId) return badRequest("Missing or invalid variantId");

  const { data: variant, error: variantError } = await admin
    .from("bank_catalog_asset_variants")
    .select("*, bank_catalog_asset_variant_parts (*)")
    .eq("id", variantId)
    .eq("catalog_item_id", catalogItemId)
    .maybeSingle();
  if (variantError) return fail(500, variantError.message);
  if (!variant) return fail(404, "Low-memory variant not found");

  const manifestStorageBucket = asString(variant?.manifest_storage_bucket, 300) || "";
  const manifestStorageKey = asString(variant?.manifest_storage_key, 2000) || "";
  if (!manifestStorageBucket || !manifestStorageKey) return fail(400, "LOW_MEMORY_MANIFEST_MISSING");

  let manifestObjectInfo: Awaited<ReturnType<typeof headObject>>;
  try {
    manifestObjectInfo = await headObject(manifestStorageBucket, manifestStorageKey);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
  }
  if (!manifestObjectInfo) return fail(404, "LOW_MEMORY_MANIFEST_NOT_FOUND");

  const partRows = Array.isArray(variant?.bank_catalog_asset_variant_parts)
    ? variant.bank_catalog_asset_variant_parts
    : [];
  if (partRows.length === 0) return fail(400, "LOW_MEMORY_VARIANT_HAS_NO_PARTS");

  for (const partRow of partRows) {
    const storageBucket = asString(partRow?.storage_bucket, 300) || "";
    const storageKey = asString(partRow?.storage_key, 2000) || "";
    if (!storageBucket || !storageKey) return fail(400, "LOW_MEMORY_PART_STORAGE_MISSING");
    let objectInfo: Awaited<ReturnType<typeof headObject>>;
    try {
      objectInfo = await headObject(storageBucket, storageKey);
    } catch (error) {
      return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
    }
    if (!objectInfo) return fail(404, `LOW_MEMORY_PART_NOT_FOUND_${Math.max(0, Math.floor(Number(asNumber(partRow?.part_index) || 0)))}`);
    const expectedSize = Math.max(0, Math.floor(Number(asNumber(partRow?.file_size_bytes) || 0)));
    if (expectedSize > 0 && objectInfo.sizeBytes !== expectedSize) {
      return fail(409, `LOW_MEMORY_PART_SIZE_MISMATCH_${Math.max(0, Math.floor(Number(asNumber(partRow?.part_index) || 0)))}`);
    }
  }

  const updateResult = await admin
    .from("bank_catalog_asset_variants")
    .update({
      status: "ready",
      updated_by: adminUserId,
      part_count: partRows.length,
    })
    .eq("id", variantId)
    .select("*, bank_catalog_asset_variant_parts (*)")
    .single();
  if (updateResult.error || !updateResult.data) {
    return fail(500, updateResult.error?.message || "Could not finalize low-memory variant");
  }

  const mappedVariant = await mapAdminCatalogAssetVariantView(updateResult.data);
  return ok({ variant: mappedVariant });
};

const deleteCatalogAssetVariant = async (
  catalogItemId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const variantId = asUuid(body?.variantId ?? body?.variant_id);
  if (!variantId) return badRequest("Missing or invalid variantId");
  const variantType = normalizeCatalogAssetVariantType(body?.variantType ?? body?.variant_type, "low_memory_segmented");
  if (variantType !== "low_memory_segmented") {
    return badRequest("Only low-memory variants can be deleted from this action");
  }

  const { data: variant, error: variantError } = await admin
    .from("bank_catalog_asset_variants")
    .select("*, bank_catalog_asset_variant_parts (*)")
    .eq("id", variantId)
    .eq("catalog_item_id", catalogItemId)
    .maybeSingle();
  if (variantError) return fail(500, variantError.message);
  if (!variant) return fail(404, "Low-memory variant not found");

  const manifestStorageBucket = asString(variant?.manifest_storage_bucket, 300) || "";
  const manifestStorageKey = asString(variant?.manifest_storage_key, 2000) || "";
  if (manifestStorageBucket && manifestStorageKey) {
    await deleteObject(manifestStorageBucket, manifestStorageKey).catch(() => undefined);
  }
  const partRows = Array.isArray(variant?.bank_catalog_asset_variant_parts)
    ? variant.bank_catalog_asset_variant_parts
    : [];
  await Promise.allSettled(partRows.map((partRow: any) => {
    const storageBucket = asString(partRow?.storage_bucket, 300) || "";
    const storageKey = asString(partRow?.storage_key, 2000) || "";
    if (!storageBucket || !storageKey) return Promise.resolve();
    return deleteObject(storageBucket, storageKey);
  }));

  const deleteResult = await admin
    .from("bank_catalog_asset_variants")
    .delete()
    .eq("id", variantId)
    .eq("catalog_item_id", catalogItemId);
  if (deleteResult.error) return fail(500, deleteResult.error.message);

  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "warning",
    title: "Low-Memory Variant Deleted",
    description: "Admin deleted a segmented low-memory catalog asset variant.",
    actorUserId: adminUserId,
    catalogItemId,
    extraFields: [
      { name: "Variant", value: variantId, inline: true },
      { name: "Type", value: "low_memory_segmented", inline: true },
    ],
  }));

  return ok({ deleted: true, variantId });
};

const publishCatalogItem = async (
  catalogItemId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const publishLimit = await consumeRateLimit({
    scope: "admin.store_publish",
    subject: adminUserId,
    maxHits: ADMIN_STORE_PUBLISH_RATE_LIMIT,
    windowSeconds: ADMIN_STORE_PUBLISH_RATE_WINDOW_SECONDS,
  });
  if (!publishLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "admin.store_publish",
      retry_after_seconds: publishLimit.retryAfterSeconds,
    });
  }

  const { data: item, error: itemError } = await admin.from("bank_catalog_items").select("*").eq("id", catalogItemId).single();
  if (itemError || !item) return fail(404, "Catalog item not found");
  const itemType = String(item?.item_type || "").trim().toLowerCase() === "bank_bundle" ? "bank_bundle" : "single_bank";
  const publishAsComingSoon = Boolean(body?.coming_soon) || Boolean(item?.coming_soon);
  const isPaid = Boolean(item?.is_paid);
  const requiresGrant = Boolean(item?.requires_grant);
  const parsedPrice = Number(item?.price_php);
  const hasPositivePrice = Number.isFinite(parsedPrice) && parsedPrice > 0;
  if (!publishAsComingSoon && isPaid && !hasPositivePrice) {
    return badRequest("Paid catalog items must have price set before publish");
  }
  if (!publishAsComingSoon && isPaid && !requiresGrant) {
    return badRequest("Paid catalog items must require grant");
  }
  if (itemType === "bank_bundle" && !publishAsComingSoon && !isPaid) {
    return badRequest("Bundle catalog items must stay paid unless they are Coming Soon");
  }

  if (itemType === "bank_bundle") {
    const { data: bundleRows, error: bundleError } = await admin
      .from("bank_catalog_bundle_items")
      .select("bank_id,banks ( id, deleted_at )")
      .eq("catalog_item_id", catalogItemId);
    if (bundleError) return fail(500, bundleError.message);
    if (!Array.isArray(bundleRows) || bundleRows.length < 2) {
      return badRequest("Bundle catalog items must include at least two banks");
    }
    const hasDeletedBundleBank = bundleRows.some((row: any) => {
      const bank = Array.isArray(row?.banks) ? row.banks[0] : row?.banks;
      return Boolean(bank?.deleted_at);
    });
    if (hasDeletedBundleBank) return badRequest("Bundles cannot publish while one of the included banks is archived");
  } else {
    const { data: bankData, error: bankError } = await admin
      .from("banks")
      .select("id, deleted_at")
      .eq("id", item.bank_id)
      .maybeSingle();
    if (bankError) return fail(500, bankError.message);
    if (!bankData) return fail(404, "Target bank not found");
    if (bankData.deleted_at) return fail(400, "Cannot publish catalog for archived bank");
  }

  const storageProvider = asString(item?.storage_provider, 40);
  const storageBucket = asString(item?.storage_bucket, 300);
  const storageKey = asString(item?.storage_key, 2000);
  let updated: any = null;
  let updateError: any = null;
  if (publishAsComingSoon) {
    const result = await admin.from("bank_catalog_items").update({
      is_published: true,
      coming_soon: true,
      is_paid: false,
      requires_grant: true,
      price_php: null,
      price_label: null,
      file_size_bytes: null,
      sha256: null,
      storage_provider: "r2",
      storage_bucket: "",
      storage_key: "",
      storage_etag: null,
      storage_uploaded_at: null,
    }).eq("id", catalogItemId).select("*").single();
    updated = result.data;
    updateError = result.error;
  } else if (itemType === "bank_bundle") {
    const result = await admin.from("bank_catalog_items").update({
      is_published: true,
      coming_soon: false,
      requires_grant: true,
      file_size_bytes: null,
      sha256: null,
      storage_provider: "r2",
      storage_bucket: "",
      storage_key: "",
      storage_etag: null,
      storage_uploaded_at: null,
    }).eq("id", catalogItemId).select("*").single();
    updated = result.data;
    updateError = result.error;
  } else {
    if (storageProvider !== "r2" || !storageBucket || !storageKey) {
      return fail(400, "CATALOG_ASSET_NOT_UPLOADED");
    }

    let objectInfo: Awaited<ReturnType<typeof headObject>>;
    try {
      objectInfo = await headObject(storageBucket, storageKey);
    } catch (error) {
      return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
    }
    if (!objectInfo) return fail(404, "ASSET_NOT_FOUND");

    const result = await admin.from("bank_catalog_items").update({
      is_published: true,
      coming_soon: false,
      file_size_bytes: objectInfo.sizeBytes,
      storage_provider: "r2",
      storage_bucket: storageBucket,
      storage_key: storageKey,
      storage_etag: objectInfo.etag,
      storage_uploaded_at: new Date().toISOString(),
    }).eq("id", catalogItemId).select("*").single();
    updated = result.data;
    updateError = result.error;
  }
  if (updateError) return fail(500, updateError.message);
  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "info",
    title: publishAsComingSoon ? "Store Bank Coming Soon Published" : "Store Bank Publish Completed",
    description: publishAsComingSoon
      ? "Catalog item was published as a teaser without an archive asset."
      : itemType === "bank_bundle"
        ? "Bundle catalog item was published and now sells multiple bank grants as one purchase."
        : "Catalog item was published and is now live for entitled buyers.",
    actorUserId: adminUserId,
    bankId: asString(item.bank_id, 80) || null,
    catalogItemId,
    extraFields: [
      { name: "Protection", value: String(updated.asset_protection || item.asset_protection || "encrypted"), inline: true },
      { name: "Mode", value: publishAsComingSoon ? "coming_soon" : "live", inline: true },
      { name: "Storage Key", value: String(updated.storage_key || storageKey || "-"), inline: false },
    ],
  }));
  return ok({ item: updated });
};

const startUploadPublishCatalogItem = async (
  body: any,
  catalogItemId: string,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const publishLimit = await consumeRateLimit({
    scope: "admin.store_publish",
    subject: adminUserId,
    maxHits: ADMIN_STORE_PUBLISH_RATE_LIMIT,
    windowSeconds: ADMIN_STORE_PUBLISH_RATE_WINDOW_SECONDS,
  });
  if (!publishLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "admin.store_publish",
      retry_after_seconds: publishLimit.retryAfterSeconds,
    });
  }

  const { data: item, error: itemError } = await admin.from("bank_catalog_items").select("*").eq("id", catalogItemId).single();
  if (itemError || !item) return fail(404, "Catalog item not found");
  const itemType = String(item?.item_type || "").trim().toLowerCase() === "bank_bundle" ? "bank_bundle" : "single_bank";

  if (itemType !== "bank_bundle") {
    const { data: bankData, error: bankError } = await admin
      .from("banks")
      .select("id, deleted_at")
      .eq("id", item.bank_id)
      .maybeSingle();
    if (bankError) return fail(500, bankError.message);
    if (!bankData) return fail(404, "Target bank not found");
    if (bankData.deleted_at) return fail(400, "Cannot publish catalog for archived bank");
  }

  const targetAsset = asString(body?.assetName, 500) || asString(body?.asset_name, 500) || item.expected_asset_name;
  const operationType = asString(body?.operationType ?? body?.operation_type, 40) === "update" ? "update" : "create";
  const assetProtection = normalizeCatalogAssetProtection(
    body?.assetProtection ?? body?.asset_protection,
    normalizeCatalogAssetProtection(item?.asset_protection, "encrypted"),
  );
  const fileSize = Number(asNumber(body?.fileSize ?? body?.file_size) || 0);
  const fileSha256 = asString(body?.fileSha256 ?? body?.file_sha256, 128);
  if (!targetAsset) return badRequest("Missing assetName or drafted asset name");
  if (!Number.isFinite(fileSize) || fileSize <= 0) return badRequest("Missing or invalid fileSize");
  if (fileSize >= R2_MAX_ASSET_BYTES) {
    return fail(413, `FILE_TOO_LARGE (max ${R2_MAX_ASSET_BYTES} bytes)`);
  }
  const r2Error = ensureR2UploadReady();
  if (r2Error) return fail(500, r2Error);

  const target = buildAdminCatalogUploadTarget(catalogItemId, targetAsset);
  if (!target.assetName) return badRequest("Missing assetName or drafted asset name");

  const sessionExpiresMs = Date.now() + R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS * 1000;
  const uploadTtlSeconds = Math.max(
    60,
    Math.min(R2_UPLOAD_URL_TTL_SECONDS, Math.floor((sessionExpiresMs - Date.now()) / 1000)),
  );

  const session = await createR2DirectUploadSession({
    scope: "admin_catalog",
    actorUserId: adminUserId,
    catalogItemId,
    bankId: itemType === "bank_bundle" ? null : item.bank_id,
    storageBucket: target.bucket,
    storageKey: target.objectKey,
    expectedFileSizeBytes: fileSize,
    expectedSha256: fileSha256 || null,
    expiresAtIso: new Date(sessionExpiresMs).toISOString(),
    meta: {
      source: "start-upload-publish",
      assetProtection,
      operationType,
    },
  });
  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "info",
    title: operationType === "update" ? "Store Bank Update Requested" : "Store Catalog Upload Requested",
    description: operationType === "update"
      ? "Admin started preparing a replacement draft asset for a linked store bank."
      : "Admin started preparing a catalog draft upload.",
    actorUserId: adminUserId,
    bankId: asString(item.bank_id, 80) || null,
    catalogItemId,
    extraFields: [
      { name: "Asset", value: target.assetName, inline: false },
      { name: "Protection", value: assetProtection, inline: true },
    ],
  }));
  const upload = await createPresignedPutUrl(
    target.bucket,
    target.objectKey,
    uploadTtlSeconds,
    "application/octet-stream",
  );

  return ok({
    mode: "r2_direct",
    sessionId: session.id,
    assetName: target.assetName,
    fileSize,
    assetProtection,
    uploadUrl: upload.url,
    uploadMethod: "PUT",
    uploadHeaders: upload.headers,
    bucket: target.bucket,
    objectKey: target.objectKey,
    urlExpiresAt: upload.expiresAt,
  });
};

const completeUploadPublishCatalogItem = async (
  body: any,
  catalogItemId: string,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const sessionId = asUuid(body?.sessionId || body?.session_id);
  const status = asString(body?.status, 40);
  const failureReason = asString(body?.failureReason || body?.failure_reason, 2000);
  const reportedEtag = asString(body?.etag, 300);
  if (!sessionId) return badRequest("Missing or invalid sessionId");
  if (status !== "success" && status !== "failed") return badRequest("Missing or invalid status");

  const session = await readR2DirectUploadSession(sessionId);
  if (!session || session.actorUserId !== adminUserId || session.scope !== "admin_catalog") {
    return fail(404, "SESSION_NOT_FOUND");
  }
  if (session.catalogItemId && session.catalogItemId !== catalogItemId) {
    return badRequest("CATALOG_ITEM_MISMATCH");
  }

  const mapFinalizeError = (code: string) => {
    if (code === "SESSION_EXPIRED") return fail(410, code);
    if (code === "SESSION_ALREADY_USED") return fail(409, code);
    if (code === "SESSION_SCOPE_MISMATCH") return fail(400, code);
    return fail(404, code);
  };

  if (status === "failed") {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: "admin_catalog",
      nextStatus: "failed",
      failureReason: failureReason || "upload_failed",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return ok({ sessionId: session.id, verified: false, status });
  }

  const { data: item, error: itemError } = await admin.from("bank_catalog_items").select("*").eq("id", catalogItemId).single();
  if (itemError || !item) return fail(404, "Catalog item not found");
  const itemType = String(item?.item_type || "").trim().toLowerCase() === "bank_bundle" ? "bank_bundle" : "single_bank";

  if (itemType !== "bank_bundle") {
    const { data: bankData, error: bankError } = await admin
      .from("banks")
      .select("id, deleted_at")
      .eq("id", item.bank_id)
      .maybeSingle();
    if (bankError) return fail(500, bankError.message);
    if (!bankData) return fail(404, "Target bank not found");
    if (bankData.deleted_at) return fail(400, "Cannot publish catalog for archived bank");
  }

  let objectInfo: Awaited<ReturnType<typeof headObject>>;
  try {
    objectInfo = await headObject(session.storageBucket, session.storageKey);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
  }
  if (!objectInfo) {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: "admin_catalog",
      nextStatus: "failed",
      failureReason: "ASSET_NOT_FOUND",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return fail(404, "ASSET_NOT_FOUND");
  }

  const actualSize = Number(objectInfo.sizeBytes || 0);
  if (actualSize <= 0 || actualSize !== Number(session.expectedFileSizeBytes || 0)) {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: "admin_catalog",
      nextStatus: "failed",
      failureReason: "ASSET_SIZE_MISMATCH",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return fail(409, "ASSET_SIZE_MISMATCH");
  }

  const metaAssetProtection = asString((session.meta as Record<string, unknown>)?.assetProtection, 40);
  const operationType = asString((session.meta as Record<string, unknown>)?.operationType, 40) === "update" ? "update" : "create";
  const previousAssetProtection = normalizeCatalogAssetProtection(item?.asset_protection, "encrypted");
  const assetProtection = normalizeCatalogAssetProtection(
    metaAssetProtection,
    previousAssetProtection,
  );
  const resolvedAssetName = getAssetNameFromStorageKey(session.storageKey)
    || asString(item?.expected_asset_name, 500)
    || null;
  const { data: updated, error: updateError } = await admin.from("bank_catalog_items").update({
    // Keep draft mode after upload so admin can still set price/details before publish.
    is_published: false,
    asset_protection: assetProtection,
    storage_provider: "r2",
    storage_bucket: session.storageBucket,
    storage_key: session.storageKey,
    storage_etag: objectInfo.etag,
    storage_uploaded_at: new Date().toISOString(),
    expected_asset_name: resolvedAssetName || item.expected_asset_name,
    file_size_bytes: actualSize,
  }).eq("id", catalogItemId).select("*").single();
  if (updateError) return fail(500, updateError.message);

  const finalized = await finalizeR2DirectUploadSession({
    sessionId: session.id,
    actorUserId: adminUserId,
    scope: "admin_catalog",
    nextStatus: "completed",
  });
  if (!finalized.ok) return mapFinalizeError(finalized.code);

  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "info",
    title: operationType === "update" ? "Store Bank Upload Succeeded" : "Store Catalog Upload Succeeded",
    description: operationType === "update"
      ? "A replacement draft asset for a linked store bank was uploaded successfully."
      : "A catalog draft asset was uploaded successfully.",
    actorUserId: adminUserId,
    bankId: asString(item.bank_id, 80) || null,
    catalogItemId,
    extraFields: [
      { name: "Asset", value: resolvedAssetName || String(item.expected_asset_name || "unknown"), inline: false },
      { name: "Protection", value: assetProtection, inline: true },
      { name: "Draft Status", value: "Pending publish", inline: true },
    ],
  }));
  if (assetProtection !== previousAssetProtection) {
    await swallowDiscordError(() => sendDiscordAdminActionEvent({
      severity: "info",
      title: "Store Bank Protection Changed",
      description: "The uploaded draft changed the store asset protection mode.",
      actorUserId: adminUserId,
      bankId: asString(item.bank_id, 80) || null,
      catalogItemId,
      extraFields: [
        { name: "Previous Protection", value: previousAssetProtection, inline: true },
        { name: "Next Protection", value: assetProtection, inline: true },
      ],
    }));
  }

  return ok({
    item: updated,
    mode: "r2_direct",
    bucket: session.storageBucket,
    objectKey: session.storageKey,
    assetName: getAssetNameFromStorageKey(session.storageKey),
    fileSize: actualSize,
    etag: objectInfo.etag,
    reportedEtag,
    status,
    verified: true,
  });
};

const getDefaultBankReleaseAdminState = async (admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin
    .from("default_bank_releases")
    .select("*")
    .order("version", { ascending: false });
  if (error) return fail(500, error.message);
  const releases = Array.isArray(data) ? data.map(mapDefaultBankReleaseRow) : [];
  const currentRelease = releases.find((release) => release.isActive) || null;
  const nextVersion = Math.max(1, ...releases.map((release) => release.version + 1));
  return ok({
    currentRelease,
    releases,
    nextVersion,
  });
};

const startUploadDefaultBankRelease = async (
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const publishLimit = await consumeRateLimit({
    scope: "admin.default_bank_publish",
    subject: adminUserId,
    maxHits: ADMIN_STORE_PUBLISH_RATE_LIMIT,
    windowSeconds: ADMIN_STORE_PUBLISH_RATE_WINDOW_SECONDS,
  });
  if (!publishLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "admin.default_bank_publish",
      retry_after_seconds: publishLimit.retryAfterSeconds,
    });
  }

  const sourceBankTitle = asString(body?.sourceBankTitle, 255);
  const sourceBankRuntimeId = asString(body?.sourceBankRuntimeId, 255) || null;
  const sourceBankPadCount = Math.max(0, Math.floor(Number(asNumber(body?.sourceBankPadCount) || 0)));
  const targetAssetName = asString(body?.assetName, 500);
  const releaseNotes = asString(body?.releaseNotes, 5000) || null;
  const minAppVersion = asString(body?.minAppVersion, 64) || null;
  const fileSize = Number(asNumber(body?.fileSize) || 0);
  const fileSha256 = asString(body?.fileSha256, 128);
  if (!sourceBankTitle) return badRequest("Missing sourceBankTitle");
  if (!targetAssetName) return badRequest("Missing assetName");
  if (!Number.isFinite(fileSize) || fileSize <= 0) return badRequest("Missing or invalid fileSize");
  if (fileSize >= R2_MAX_ASSET_BYTES) {
    return fail(413, `FILE_TOO_LARGE (max ${R2_MAX_ASSET_BYTES} bytes)`);
  }
  const r2Error = ensureR2UploadReady();
  if (r2Error) return fail(500, r2Error);

  const { data: latestRelease, error: latestError } = await admin
    .from("default_bank_releases")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return fail(500, latestError.message);
  const nextVersion = Math.max(1, Number(asNumber(latestRelease?.version) || 0) + 1);
  const target = buildDefaultBankUploadTarget(nextVersion, targetAssetName);
  if (!target.assetName) return badRequest("Missing assetName");

  const sessionExpiresMs = Date.now() + R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS * 1000;
  const uploadTtlSeconds = Math.max(
    60,
    Math.min(R2_UPLOAD_URL_TTL_SECONDS, Math.floor((sessionExpiresMs - Date.now()) / 1000)),
  );

  const session = await createR2DirectUploadSession({
    scope: DEFAULT_BANK_RELEASE_UPLOAD_SCOPE,
    actorUserId: adminUserId,
    expiresAtIso: new Date(sessionExpiresMs).toISOString(),
    storageBucket: target.bucket,
    storageKey: target.objectKey,
    expectedFileSizeBytes: fileSize,
    expectedSha256: fileSha256 || null,
    meta: {
      version: nextVersion,
      sourceBankTitle,
      sourceBankRuntimeId,
      sourceBankPadCount,
      releaseNotes,
      minAppVersion,
    },
  });
  const upload = await createPresignedPutUrl(
    target.bucket,
    target.objectKey,
    uploadTtlSeconds,
    "application/octet-stream",
  );

  return ok({
    mode: "r2_direct",
    sessionId: session.id,
    version: nextVersion,
    assetName: target.assetName,
    fileSize,
    uploadUrl: upload.url,
    uploadMethod: "PUT",
    uploadHeaders: upload.headers,
    bucket: target.bucket,
    objectKey: target.objectKey,
    urlExpiresAt: upload.expiresAt,
  });
};

const completeUploadDefaultBankRelease = async (
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const sessionId = asUuid(body?.sessionId || body?.session_id);
  const status = asString(body?.status, 40);
  const failureReason = asString(body?.failureReason || body?.failure_reason, 2000);
  if (!sessionId) return badRequest("Missing or invalid sessionId");
  if (status !== "success" && status !== "failed") return badRequest("Missing or invalid status");

  const session = await readR2DirectUploadSession(sessionId);
  if (!session || session.actorUserId !== adminUserId || !isDefaultBankReleaseUploadScope(session.scope)) {
    return fail(404, "SESSION_NOT_FOUND");
  }

  const mapFinalizeError = (code: string) => {
    if (code === "SESSION_EXPIRED") return fail(410, code);
    if (code === "SESSION_ALREADY_USED") return fail(409, code);
    if (code === "SESSION_SCOPE_MISMATCH") return fail(400, code);
    return fail(404, code);
  };

  if (status === "failed") {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: session.scope,
      nextStatus: "failed",
      failureReason: failureReason || "upload_failed",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return ok({ sessionId: session.id, verified: false, status });
  }

  let objectInfo: Awaited<ReturnType<typeof headObject>>;
  try {
    objectInfo = await headObject(session.storageBucket, session.storageKey);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
  }
  if (!objectInfo) {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: session.scope,
      nextStatus: "failed",
      failureReason: "ASSET_NOT_FOUND",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return fail(404, "ASSET_NOT_FOUND");
  }

  const actualSize = Number(objectInfo.sizeBytes || 0);
  if (actualSize <= 0 || actualSize !== Number(session.expectedFileSizeBytes || 0)) {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: session.scope,
      nextStatus: "failed",
      failureReason: "ASSET_SIZE_MISMATCH",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return fail(409, "ASSET_SIZE_MISMATCH");
  }

  const meta = (session.meta || {}) as Record<string, unknown>;
  const version = Math.max(1, Math.floor(Number(asNumber(meta.version) || 0)));
  const sourceBankTitle = asString(meta.sourceBankTitle, 255) || "Default Bank";
  const sourceBankRuntimeId = asString(meta.sourceBankRuntimeId, 255) || null;
  const sourceBankPadCount = Math.max(0, Math.floor(Number(asNumber(meta.sourceBankPadCount) || 0)));
  const releaseNotes = asString(meta.releaseNotes, 5000) || null;
  const minAppVersion = asString(meta.minAppVersion, 64) || null;

  const { data: insertedRelease, error: insertError } = await admin
    .from("default_bank_releases")
    .insert({
      version,
      source_bank_runtime_id: sourceBankRuntimeId,
      source_bank_title: sourceBankTitle,
      source_bank_pad_count: sourceBankPadCount,
      storage_provider: "r2",
      storage_bucket: session.storageBucket,
      storage_key: session.storageKey,
      storage_etag: objectInfo.etag,
      file_size_bytes: actualSize,
      file_sha256: session.expectedSha256 || null,
      release_notes: releaseNotes,
      min_app_version: minAppVersion,
      published_by: adminUserId,
      published_at: new Date().toISOString(),
      is_active: false,
    })
    .select("*")
    .single();
  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return fail(409, "DEFAULT_BANK_VERSION_CONFLICT");
    }
    return fail(500, insertError.message);
  }

  const nowIso = new Date().toISOString();
  const deactivateActive = await admin
    .from("default_bank_releases")
    .update({
      is_active: false,
      deactivated_at: nowIso,
      deactivated_by: adminUserId,
    })
    .neq("id", insertedRelease.id)
    .eq("is_active", true);
  if (deactivateActive.error) return fail(500, deactivateActive.error.message);

  const { data: activatedRelease, error: activateError } = await admin
    .from("default_bank_releases")
    .update({
      is_active: true,
      deactivated_at: null,
      deactivated_by: null,
    })
    .eq("id", insertedRelease.id)
    .select("*")
    .single();
  if (activateError) return fail(500, activateError.message);

  const finalized = await finalizeR2DirectUploadSession({
    sessionId: session.id,
    actorUserId: adminUserId,
    scope: session.scope,
    nextStatus: "completed",
  });
  if (!finalized.ok) return mapFinalizeError(finalized.code);

  return ok({
    release: mapDefaultBankReleaseRow(activatedRelease),
    mode: "r2_direct",
    assetName: getAssetNameFromStorageKey(session.storageKey),
    fileSize: actualSize,
    verified: true,
    status,
  });
};

const rollbackDefaultBankRelease = async (
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const targetVersion = Math.max(1, Math.floor(Number(asNumber(body?.version) || 0)));
  if (!targetVersion) return badRequest("Missing or invalid version");

  const { data: targetRelease, error: targetError } = await admin
    .from("default_bank_releases")
    .select("*")
    .eq("version", targetVersion)
    .maybeSingle();
  if (targetError) return fail(500, targetError.message);
  if (!targetRelease) return fail(404, "DEFAULT_BANK_RELEASE_NOT_FOUND");

  const nowIso = new Date().toISOString();
  const deactivate = await admin
    .from("default_bank_releases")
    .update({
      is_active: false,
      deactivated_at: nowIso,
      deactivated_by: adminUserId,
    })
    .neq("id", targetRelease.id)
    .eq("is_active", true);
  if (deactivate.error) return fail(500, deactivate.error.message);

  const { data: activatedRelease, error: activateError } = await admin
    .from("default_bank_releases")
    .update({
      is_active: true,
      deactivated_at: null,
      deactivated_by: null,
    })
    .eq("id", targetRelease.id)
    .select("*")
    .single();
  if (activateError) return fail(500, activateError.message);

  return ok({
    release: mapDefaultBankReleaseRow(activatedRelease),
  });
};

const uploadAndPublishCatalogItem = async (
  _req: Request,
  _catalogItemId: string,
  _admin: ReturnType<typeof createServiceClient>,
  _adminUserId: string,
) => {
  return fail(410, "UPLOAD_RELAY_REMOVED");
};

const handlePurchaseAction = async (requestId: string, action: string, admin: ReturnType<typeof createServiceClient>) => {
  const { data: request, error: reqError } = await admin.from("bank_purchase_requests").select("*").eq("id", requestId).single();
  if (reqError || !request) return fail(404, "Request not found");
  if (request.status !== "pending") return badRequest("Request is already processed");

  if (action === "reject" || action === "approve") {
    const status = action === "approve" ? "approved" : "rejected";
    const { data, error } = await admin.rpc("apply_store_request_decision", {
      p_request_ids: [requestId],
      p_next_status: status,
      p_reviewed_by: null,
      p_reviewed_at: new Date().toISOString(),
      p_rejection_message: null,
      p_decision_source: "manual",
      p_automation_result: null,
    });
    if (error) return fail(500, error.message);
    const applied = Array.isArray(data) && data.some((row: any) => String(row?.id || "") === requestId);
    if (!applied) return fail(409, "Request could not be updated");
    return ok({ requestId, status });
  }
  return badRequest("Invalid action");
};

const listAccountTierConfigs = async (admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin
    .from("account_tier_configs")
    .select("*")
    .order("tier", { ascending: true });
  if (error) return fail(500, error.message);
  return ok({ tiers: data || [] });
};

const TIER_LIMIT_KEY_ALIASES: Record<string, string> = {
  defaultBankDailyPlays: "default_bank_daily_plays",
  ownedBankQuota: "owned_bank_quota",
  ownedBankPadCap: "owned_bank_pad_cap",
  deviceTotalBankCap: "device_total_bank_cap",
  deckMinCount: "deck_min_count",
  deckDefaultCount: "deck_default_count",
  deckCount: "deck_count",
};

const TIER_FEATURE_KEY_ALIASES: Record<string, string> = {
  bankStoreBrowse: "bank_store_browse",
  bankStoreCheckout: "bank_store_checkout",
  bankStoreDownload: "bank_store_download",
  bankStoreFreeClaim: "bank_store_free_claim",
  bankStoreAllAccess: "bank_store_all_access",
  inputMapping: "input_mapping",
  systemShortcuts: "system_shortcuts",
  channelShortcuts: "channel_shortcuts",
  mappingImportExport: "mapping_import_export",
  backupRepair: "backup_repair",
  advancedStopModes: "advanced_stop_modes",
  mixerHotcue: "mixer_hotcue",
  padEditGroup: "pad_edit_group",
  padEditTempo: "pad_edit_tempo",
  padEditKeyboardMidi: "pad_edit_keyboard_midi",
  padEditHotcue: "pad_edit_hotcue",
  padEditFades: "pad_edit_fades",
  bankEditPosition: "bank_edit_position",
  bankEditKeyboardMidi: "bank_edit_keyboard_midi",
  storeDemoBanks: "store_demo_banks",
  ownBankUnlimitedPlay: "own_bank_unlimited_play",
};

const readConfigValue = (input: Record<string, unknown>, camelKey: string, snakeKey: string): unknown =>
  input[camelKey] ?? input[snakeKey];

const normalizeTierConfigLimits = (value: unknown): Record<string, unknown> => {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const next: Record<string, unknown> = {};
  for (const [camelKey, snakeKey] of Object.entries(TIER_LIMIT_KEY_ALIASES)) {
    const raw = readConfigValue(input, camelKey, snakeKey);
    if (raw === undefined) continue;
    if (raw === null && snakeKey === "default_bank_daily_plays") {
      next[snakeKey] = null;
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) next[snakeKey] = Math.floor(parsed);
  }
  const promoRaw = input.pricePromoDiscountPercent ?? input.price_promo_discount_percent;
  const promoParsed = Number(promoRaw);
  if (Number.isFinite(promoParsed)) {
    next.price_promo_discount_percent = Math.min(90, Math.max(0, Math.round(promoParsed)));
  }
  return next;
};

const normalizeTierConfigFeatures = (value: unknown): Record<string, boolean> => {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const next: Record<string, boolean> = {};
  for (const [camelKey, snakeKey] of Object.entries(TIER_FEATURE_KEY_ALIASES)) {
    next[snakeKey] = readConfigValue(input, camelKey, snakeKey) === true;
  }
  next.search = input.search === true;
  return next;
};

const saveAccountTierConfig = async (body: any, admin: ReturnType<typeof createServiceClient>, adminUserId: string) => {
  const tier = normalizeProfileTier(body?.tier);
  if (!tier) return badRequest("tier is required");
  const displayName = asString(body?.displayName ?? body?.display_name, 80) || tier.toUpperCase();
  const description = asString(body?.description, 500);
  const pricePhp = normalizeTierPrice(body?.pricePhp ?? body?.price_php);
  const limits = normalizeTierConfigLimits(body?.limits);
  const features = normalizeTierConfigFeatures(body?.features);
  const uiContent = body?.uiContent && typeof body.uiContent === "object" && !Array.isArray(body.uiContent)
    ? body.uiContent
    : body?.ui_content && typeof body.ui_content === "object" && !Array.isArray(body.ui_content)
      ? body.ui_content
      : {};
  const { data, error } = await admin
    .from("account_tier_configs")
    .upsert({
      tier,
      display_name: displayName,
      description,
      price_php: pricePhp,
      limits,
      features,
      ui_content: uiContent,
      is_active: body?.isActive ?? body?.is_active ?? true,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tier" })
    .select("*")
    .single();
  if (error || !data) return fail(500, error?.message || "Tier config could not be saved");
  try {
    const legacyQuotaSync = await syncLegacyProfileQuotasForTier(admin, tier, data);
    return ok({ tier: data, legacyQuotaSync });
  } catch (syncError) {
    return fail(500, syncError instanceof Error ? syncError.message : "Tier config saved, but legacy quota sync failed");
  }
};

const ACCOUNT_TIER_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
const ACCOUNT_TIER_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const ACCOUNT_TIER_VIDEO_MAX_BYTES = 512 * 1024 * 1024;

const getExtensionFromFileName = (fileName: string | null | undefined): string => {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
};

const createAccountTierVideoUploadUrl = async (
  body: any,
  _admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const tier = normalizeProfileTier(body?.tier);
  if (!tier) return badRequest("tier is required");
  const fileName = asString(body?.fileName ?? body?.file_name, 240);
  const contentType = asString(body?.contentType ?? body?.content_type, 160)?.toLowerCase() || "application/octet-stream";
  const fileSize = Math.floor(Number(body?.sizeBytes ?? body?.size_bytes ?? 0));
  if (!fileName) return badRequest("fileName is required");
  const ext = getExtensionFromFileName(fileName);
  if (!ACCOUNT_TIER_VIDEO_EXTENSIONS.has(ext)) return badRequest("Unsupported tier video extension");
  if (contentType !== "application/octet-stream" && !ACCOUNT_TIER_VIDEO_MIME_TYPES.has(contentType)) {
    return badRequest("Unsupported tier video mime type");
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) return badRequest("sizeBytes is required");
  if (fileSize > ACCOUNT_TIER_VIDEO_MAX_BYTES) return fail(413, "TIER_VIDEO_TOO_LARGE", { max_bytes: ACCOUNT_TIER_VIDEO_MAX_BYTES });
  const r2Error = ensureR2UploadReady();
  if (r2Error) return fail(500, r2Error);

  const target = buildAccountTierVideoUploadTarget(tier, fileName);
  const sessionExpiresMs = Date.now() + R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS * 1000;
  const uploadTtlSeconds = Math.max(
    60,
    Math.min(R2_UPLOAD_URL_TTL_SECONDS, Math.floor((sessionExpiresMs - Date.now()) / 1000)),
  );
  const session = await createR2DirectUploadSession({
    scope: "admin_catalog",
    actorUserId: adminUserId,
    storageBucket: target.bucket,
    storageKey: target.objectKey,
    expectedFileSizeBytes: fileSize,
    expiresAtIso: new Date(sessionExpiresMs).toISOString(),
    meta: {
      source: "account-tier-video",
      tier,
      contentType,
    },
  });
  const upload = await createPresignedPutUrl(target.bucket, target.objectKey, uploadTtlSeconds, contentType);
  return ok({
    mode: "r2_direct",
    sessionId: session.id,
    assetName: target.assetName,
    fileSize,
    uploadUrl: upload.url,
    uploadMethod: "PUT",
    uploadHeaders: upload.headers,
    bucket: target.bucket,
    objectKey: target.objectKey,
    urlExpiresAt: upload.expiresAt,
  });
};

const completeAccountTierVideoUpload = async (
  body: any,
  _admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const tier = normalizeProfileTier(body?.tier);
  if (!tier) return badRequest("tier is required");
  const sessionId = asUuid(body?.sessionId || body?.session_id);
  const status = asString(body?.status, 40);
  const failureReason = asString(body?.failureReason || body?.failure_reason, 2000);
  if (!sessionId) return badRequest("Missing or invalid sessionId");
  if (status !== "success" && status !== "failed") return badRequest("Missing or invalid status");
  const session = await readR2DirectUploadSession(sessionId);
  if (!session || session.actorUserId !== adminUserId || session.scope !== "admin_catalog") {
    return fail(404, "SESSION_NOT_FOUND");
  }
  const source = asString((session.meta as Record<string, unknown>)?.source, 80);
  const metaTier = normalizeProfileTier((session.meta as Record<string, unknown>)?.tier);
  if (source !== "account-tier-video" || metaTier !== tier) return badRequest("SESSION_TARGET_MISMATCH");
  const mapFinalizeError = (code: string) => {
    if (code === "SESSION_EXPIRED") return fail(410, code);
    if (code === "SESSION_ALREADY_USED") return fail(409, code);
    if (code === "SESSION_SCOPE_MISMATCH") return fail(400, code);
    return fail(404, code);
  };
  if (status === "failed") {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: adminUserId,
      scope: "admin_catalog",
      nextStatus: "failed",
      failureReason: failureReason || "upload_failed",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);
    return ok({ sessionId: session.id, status: "failed" });
  }
  let objectInfo: Awaited<ReturnType<typeof headObject>>;
  try {
    objectInfo = await headObject(session.storageBucket, session.storageKey);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "R2_VERIFY_FAILED");
  }
  if (!objectInfo) return fail(404, "ASSET_NOT_FOUND");
  const actualSize = Number(objectInfo.sizeBytes || 0);
  if (actualSize <= 0 || actualSize !== Number(session.expectedFileSizeBytes || 0)) {
    return fail(409, "ASSET_SIZE_MISMATCH", { expected: session.expectedFileSizeBytes, actual: actualSize });
  }
  const finalized = await finalizeR2DirectUploadSession({
    sessionId: session.id,
    actorUserId: adminUserId,
    scope: "admin_catalog",
    nextStatus: "completed",
  });
  if (!finalized.ok) return mapFinalizeError(finalized.code);
  return ok({
    sessionId: session.id,
    status: "success",
    video: {
      storageProvider: "r2",
      storageBucket: session.storageBucket,
      storageKey: session.storageKey,
      assetName: getAssetNameFromStorageKey(session.storageKey),
      fileSizeBytes: actualSize,
      etag: objectInfo.etag,
    },
  });
};

const sendAccountUpgradeDecisionEmail = async (input: {
  requestRow: any;
  nextStatus: "approved" | "rejected";
  reviewedAtIso: string;
  rejectionMessage?: string | null;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const targetEmail = normalizeEmail(input.requestRow?.email);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const targetTier = normalizeUpgradeTier(input.requestRow?.target_tier);
  const targetTierLabel = targetTier === "pro_max" ? "PRO MAX" : targetTier === "pro" ? "PRO" : "Account";
  const displayName = asString(input.requestRow?.display_name, 160) || "User";
  const receiptReference = asString(input.requestRow?.receipt_reference, 160) || "-";
  const paymentReference = asString(input.requestRow?.reference_no, 160) || "-";
  const paymentChannel = asString(input.requestRow?.payment_channel, 80) || "-";
  const reviewedAt = new Date(input.reviewedAtIso).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  const amountValue = formatPhpCurrency(input.requestRow?.quote_price_php_snapshot);
  const isApproved = input.nextStatus === "approved";
  const rejectionReason = asString(input.rejectionMessage ?? input.requestRow?.rejection_message, 1000) || "Please contact support for details.";
  const textBody = isApproved
    ? [
      `Hi ${displayName},`,
      "",
      `Your ${targetTierLabel} account upgrade request has been approved.`,
      "",
      "Your upgraded tier is now active. Reopen VDJV if it does not appear yet.",
    ].join("\n")
    : [
      `Hi ${displayName},`,
      "",
      `Your ${targetTierLabel} account upgrade request was rejected.`,
      "",
      `Reason: ${rejectionReason}`,
      "",
      "Please submit a new request after correcting the issue.",
    ].join("\n");

  const htmlBody = buildReceiptStyleEmailHtml({
    variant: isApproved ? "approved" : "rejected",
    title: isApproved ? "Account Upgrade Approved" : "Account Upgrade Update",
    subtitle: isApproved ? `Your ${targetTierLabel} access is now active.` : "Your upgrade request needs correction.",
    amountLabel: "Total Payment",
    amountValue,
    details: [
      { label: "Upgrade", value: targetTierLabel },
      { label: "VDJV Receipt No", value: receiptReference },
      { label: "Payment Reference", value: paymentReference },
      { label: "Payment Channel", value: paymentChannel },
      { label: "Reviewed At", value: reviewedAt },
      ...(isApproved ? [] : [{ label: "Reason", value: rejectionReason }]),
    ],
    bodyText: textBody,
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject: `${isApproved ? "Account Upgrade Approved" : "Account Upgrade Update"} - ${receiptReference}`,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
};

const listAccountUpgradeRequests = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const status = asString(url.searchParams.get("status"), 40) || "pending";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(200, Number(url.searchParams.get("perPage") || 50)));
  const q = asString(url.searchParams.get("q"), 160)?.toLowerCase() || "";
  let query: any = admin
    .from("account_upgrade_requests")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%,receipt_reference.ilike.%${q}%`);
  const { data, error, count } = await query.range((page - 1) * perPage, (page * perPage) - 1);
  if (error) return fail(500, error.message);
  return ok({
    requests: data || [],
    total: Number(count || 0),
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(Number(count || 0) / perPage)),
  });
};

const accountUpgradeRequestAction = async (
  requestId: string,
  body: any,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const action = asString(body?.action, 40) || "";
  if (action !== "approve" && action !== "reject" && action !== "refund") return badRequest("Invalid action");
  const rejectionMessage = asString(body?.rejectionMessage ?? body?.rejection_message, 1000);
  const { data: requestRow, error: requestError } = await admin
    .from("account_upgrade_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError || !requestRow) return fail(404, requestError?.message || "Upgrade request not found");

  const nowIso = new Date().toISOString();

  if (action === "refund") {
    if ((requestRow as any).status !== "approved") return badRequest("Only approved upgrade requests can be refunded");
    if (Boolean((requestRow as any).is_refunded)) return badRequest("Upgrade request is already refunded");

    const { error: refundError } = await admin
      .from("account_upgrade_requests")
      .update({
        is_refunded: true,
        refunded_at: nowIso,
        refunded_by: adminUserId,
        updated_at: nowIso,
      })
      .eq("id", requestId)
      .eq("status", "approved")
      .eq("is_refunded", false);
    if (refundError) return fail(500, refundError.message);

    await swallowDiscordError(() =>
      sendDiscordAdminActionEvent({
        severity: "warning",
        title: "Admin Refunded Account Upgrade",
        description: "An approved account upgrade was marked refunded. Account tier access stays active.",
        actorUserId: adminUserId,
        targetUserId: asUuid((requestRow as any).user_id),
        requestId,
        extraFields: [
          { name: "Target Tier", value: (normalizeUpgradeTier((requestRow as any).target_tier) || "unknown").toUpperCase(), inline: true },
          { name: "Email", value: asString((requestRow as any).email, 320) || "unknown", inline: true },
          { name: "Amount", value: formatPhpCurrency((requestRow as any).quote_price_php_snapshot), inline: true },
        ],
      })
    );

    return ok({
      requestId,
      status: "approved",
      refunded: true,
      refunded_at: nowIso,
      refunded_by: adminUserId,
    });
  }

  if ((requestRow as any).status !== "pending") return badRequest("Request is already processed");

  if (action === "reject") {
    const { error } = await admin
      .from("account_upgrade_requests")
      .update({
        status: "rejected",
        rejection_message: rejectionMessage,
        reviewed_by: adminUserId,
        reviewed_at: nowIso,
        decision_source: "manual",
        updated_at: nowIso,
      })
      .eq("id", requestId);
    if (error) return fail(500, error.message);
    const decisionEmail = await sendAccountUpgradeDecisionEmail({
      requestRow: {
        ...requestRow,
        status: "rejected",
        rejection_message: rejectionMessage,
        reviewed_by: adminUserId,
        reviewed_at: nowIso,
      },
      nextStatus: "rejected",
      reviewedAtIso: nowIso,
      rejectionMessage,
    });
    const { error: emailUpdateError } = await admin
      .from("account_upgrade_requests")
      .update({
        decision_email_status: decisionEmail.status,
        decision_email_error: decisionEmail.error,
      })
      .eq("id", requestId);
    if (emailUpdateError && !/decision_email_status|decision_email_error/i.test(emailUpdateError.message || "")) {
      return fail(500, emailUpdateError.message);
    }
    return ok({
      requestId,
      status: "rejected",
      decision_email_status: decisionEmail.status,
      decision_email_error: decisionEmail.error,
    });
  }

  if (action === "approve") {
    const userId = asUuid((requestRow as any).user_id);
    const targetTier = normalizeUpgradeTier((requestRow as any).target_tier);
    if (!userId || !targetTier) return fail(409, "REQUEST_MISSING_USER_OR_TIER");
    const capabilities = await applyAccountTierToUser(admin, userId, targetTier, "upgrade_request");
    const { error } = await admin
      .from("account_upgrade_requests")
      .update({
        status: "approved",
        reviewed_by: adminUserId,
        reviewed_at: nowIso,
        decision_source: "manual",
        updated_at: nowIso,
      })
      .eq("id", requestId);
    if (error) return fail(500, error.message);
    await swallowDiscordError(() =>
      sendDiscordAdminActionEvent({
        severity: "info",
        title: "Account Upgrade Approved",
        description: `Admin approved ${targetTier.toUpperCase()} access.`,
        actorUserId: adminUserId,
        targetUserId: userId,
        requestId,
        extraFields: [
          { name: "Target Tier", value: targetTier.toUpperCase(), inline: true },
          { name: "Quote", value: `PHP ${normalizeTierPrice((requestRow as any).quote_price_php_snapshot).toFixed(2)}`, inline: true },
        ],
      })
    );
    const decisionEmail = await sendAccountUpgradeDecisionEmail({
      requestRow: {
        ...requestRow,
        status: "approved",
        reviewed_by: adminUserId,
        reviewed_at: nowIso,
      },
      nextStatus: "approved",
      reviewedAtIso: nowIso,
    });
    const { error: emailUpdateError } = await admin
      .from("account_upgrade_requests")
      .update({
        decision_email_status: decisionEmail.status,
        decision_email_error: decisionEmail.error,
      })
      .eq("id", requestId);
    if (emailUpdateError && !/decision_email_status|decision_email_error/i.test(emailUpdateError.message || "")) {
      return fail(500, emailUpdateError.message);
    }
    return ok({
      requestId,
      status: "approved",
      capabilities,
      decision_email_status: decisionEmail.status,
      decision_email_error: decisionEmail.error,
    });
  }

  return badRequest("Invalid action");
};

const listVoucherCampaigns = async (admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin
    .from("account_voucher_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return fail(500, error.message);
  return ok({ campaigns: data || [] });
};

const createVoucherCampaign = async (body: any, admin: ReturnType<typeof createServiceClient>, adminUserId: string) => {
  const name = asString(body?.name, 160);
  const targetTier = normalizeUpgradeTier(body?.targetTier ?? body?.target_tier);
  if (!name) return badRequest("name is required");
  if (!targetTier) return badRequest("targetTier must be pro or pro_max");
  const maxCodes = Math.max(1, Math.min(10000, Math.floor(Number(body?.maxCodes ?? body?.max_codes ?? 1))));
  const expiresAtRaw = asString(body?.expiresAt ?? body?.expires_at, 80);
  const expiresAt = expiresAtRaw ? parseIsoDateTime(expiresAtRaw) : null;
  const { data, error } = await admin
    .from("account_voucher_campaigns")
    .insert({
      name,
      target_tier: targetTier,
      max_codes: maxCodes,
      expires_at: expiresAt,
      target_email: asString(body?.targetEmail ?? body?.target_email, 320)?.toLowerCase() || null,
      target_user_id: asUuid(body?.targetUserId ?? body?.target_user_id),
      notes: asString(body?.notes, 1000),
      created_by: adminUserId,
    })
    .select("*")
    .single();
  if (error || !data) return fail(500, error?.message || "Voucher campaign could not be created");
  return ok({ campaign: data }, 201);
};

const copyNextVoucher = async (
  campaignId: string,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  let lastError: any = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomVoucherCode();
    const { data: voucher, error } = await admin.rpc("copy_next_account_voucher_code", {
      p_campaign_id: campaignId,
      p_code_hash: await sha256Hex(code),
      p_code_prefix: code.slice(0, 9),
      p_code_suffix: code.slice(-6),
      p_admin_user_id: adminUserId,
    });
    if (!error && voucher) {
      return ok({ voucher, code });
    }
    lastError = error;
    const message = asString(error?.message, 200) || "";
    if (!/VOUCHER_CODE_COLLISION/i.test(message)) break;
  }
  const message = asString(lastError?.message, 200) || "Voucher could not be created";
  if (/VOUCHER_CAMPAIGN_NOT_FOUND/i.test(message)) return fail(404, "Voucher campaign not found");
  if (/CAMPAIGN_INACTIVE|CAMPAIGN_EXPIRED|VOUCHER_LIMIT_REACHED/i.test(message)) return fail(409, message);
  return fail(500, message);
};

const revokeLatestUnusedVoucher = async (
  campaignId: string,
  admin: ReturnType<typeof createServiceClient>,
  adminUserId: string,
) => {
  const { data: voucher, error } = await admin
    .from("account_vouchers")
    .select("id,campaign_id,status,redeemed_at")
    .eq("campaign_id", campaignId)
    .eq("status", "reserved")
    .is("redeemed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!voucher) return fail(404, "NO_UNUSED_VOUCHER");
  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("account_vouchers")
    .update({ status: "disabled", updated_at: nowIso })
    .eq("id", (voucher as any).id)
    .eq("status", "reserved");
  if (updateError) return fail(500, updateError.message);
  const { data: campaign } = await admin
    .from("account_voucher_campaigns")
    .select("reserved_count")
    .eq("id", campaignId)
    .maybeSingle();
  await admin
    .from("account_voucher_campaigns")
    .update({
      reserved_count: Math.max(0, Math.floor(Number((campaign as any)?.reserved_count || 0)) - 1),
      updated_at: nowIso,
    })
    .eq("id", campaignId);
  await swallowDiscordError(() =>
    sendDiscordAdminActionEvent({
      severity: "info",
      title: "Voucher Revoked",
      description: "Admin revoked the latest unused voucher code for a campaign.",
      actorUserId: adminUserId,
      extraFields: [{ name: "Campaign ID", value: campaignId, inline: false }],
    })
  );
  return ok({ campaignId, voucherId: (voucher as any).id, status: "disabled" });
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.response;

    const admin = createServiceClient();
    const url = new URL(req.url);
    const route = parseRoute(url.pathname);

    if (req.method === "GET" && route.section === "users" && !route.id) {
      return await listUsers(req, admin);
    }

    if (req.method === "GET" && route.section === "active-sessions") {
      return await listActiveSessions(req, admin);
    }

    if (req.method === "GET" && route.section === "activity") {
      return await listActivity(req, admin);
    }

    if (req.method === "GET" && route.section === "dashboard-overview") {
      return await getDashboardOverview(req, admin);
    }

    if (req.method === "GET" && route.section === "default-bank" && !route.id) {
      return await getDefaultBankReleaseAdminState(admin);
    }

    if (req.method === "GET" && route.section === "banks" && !route.id) {
      return await listBanks(req, admin);
    }

    if (req.method === "GET" && route.section === "account-tiers" && !route.id) {
      return await listAccountTierConfigs(admin);
    }

    if (req.method === "GET" && route.section === "account-upgrades" && !route.id) {
      return await listAccountUpgradeRequests(req, admin);
    }

    if (req.method === "GET" && route.section === "vouchers" && !route.id) {
      return await listVoucherCampaigns(admin);
    }

    if (req.method === "GET" && route.section === "store" && route.id === "catalog" && url.pathname.includes("/upload-sessions")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await listCatalogUploadSessions(catalogItemId, admin);
    }

    if (req.method === "GET" && route.section === "store" && route.id === "catalog" && url.pathname.includes("/asset-variants")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await listCatalogAssetVariants(catalogItemId, admin);
    }

    if (req.method === "GET" && route.section === "access" && route.id === "user" && route.action) {
      const userId = asUuid(route.action);
      if (!userId) return badRequest("Invalid user id");
      return await listAccessByUser(userId, admin);
    }

    if (req.method === "GET" && route.section === "access" && route.id === "bank" && route.action) {
      const bankId = asUuid(route.action);
      if (!bankId) return badRequest("Invalid bank id");
      return await listAccessByBank(req, bankId, admin);
    }

    if (req.method !== "POST") return fail(405, "Method not allowed");

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/upload-publish")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await uploadAndPublishCatalogItem(req, catalogItemId, admin, adminCheck.userId);
    }

    const body = await req.json().catch(() => ({}));

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/start-upload-publish")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await startUploadPublishCatalogItem(body, catalogItemId, admin, adminCheck.userId);
    }

    if (route.section === "default-bank" && route.id === "start-upload") {
      return await startUploadDefaultBankRelease(body, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "sign-export-token") {
      return await issueSignedAdminExportToken(body, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/complete-upload-publish")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await completeUploadPublishCatalogItem(body, catalogItemId, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/promote-upload-session")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await promoteCatalogUploadSession(catalogItemId, body, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/delete-upload-session")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await deleteCatalogUploadSessionAsset(catalogItemId, body, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/start-low-memory-upload")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await startLowMemoryCatalogVariantUpload(catalogItemId, body, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/complete-low-memory-upload")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await completeLowMemoryCatalogVariantUpload(catalogItemId, body, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/delete-asset-variant")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await deleteCatalogAssetVariant(catalogItemId, body, admin, adminCheck.userId);
    }

    if (route.section === "default-bank" && route.id === "complete-upload") {
      return await completeUploadDefaultBankRelease(body, admin, adminCheck.userId);
    }

    if (route.section === "default-bank" && route.id === "rollback") {
      return await rollbackDefaultBankRelease(body, admin, adminCheck.userId);
    }

    if (route.section === "users" && route.id === "create") {
      return await createUser(body, admin);
    }

    if (route.section === "account-tiers" && route.id === "save") {
      return await saveAccountTierConfig(body, admin, adminCheck.userId);
    }

    if (route.section === "account-tiers" && route.id === "video-upload-url") {
      return await createAccountTierVideoUploadUrl(body, admin, adminCheck.userId);
    }

    if (route.section === "account-tiers" && route.id === "video-upload-complete") {
      return await completeAccountTierVideoUpload(body, admin, adminCheck.userId);
    }

    if (route.section === "account-upgrades" && route.id && route.action === "decision") {
      const requestId = asUuid(route.id);
      if (!requestId) return badRequest("Invalid upgrade request id");
      return await accountUpgradeRequestAction(requestId, body, admin, adminCheck.userId);
    }

    if (route.section === "vouchers" && route.id === "campaigns" && route.action === "create") {
      return await createVoucherCampaign(body, admin, adminCheck.userId);
    }

    if (route.section === "vouchers" && route.id && route.action === "copy-next") {
      const campaignId = asUuid(route.id);
      if (!campaignId) return badRequest("Invalid voucher campaign id");
      return await copyNextVoucher(campaignId, admin, adminCheck.userId);
    }

    if (route.section === "vouchers" && route.id && route.action === "revoke-latest") {
      const campaignId = asUuid(route.id);
      if (!campaignId) return badRequest("Invalid voucher campaign id");
      return await revokeLatestUnusedVoucher(campaignId, admin, adminCheck.userId);
    }

    if (route.section === "users" && route.id && route.action) {
      const userId = asUuid(route.id);
      if (!userId) return badRequest("Invalid user id");
      if (route.action === "update-profile") return await updateUserProfile(userId, body, admin, adminCheck.userId);
      if (route.action === "delete") return await deleteUser(userId, admin, adminCheck.userId);
      if (route.action === "ban") return await banUser(userId, body, admin);
      if (route.action === "unban") return await unbanUser(userId, admin);
      if (route.action === "reset-password") return await resetPassword(userId, admin, adminCheck.userId);
      return fail(404, "Unknown admin route");
    }

    if (route.section === "banks" && route.id && route.action) {
      const bankId = asUuid(route.id);
      if (!bankId) return badRequest("Invalid bank id");
      if (route.action === "update") return await updateBank(bankId, body, admin);
      if (route.action === "delete") return await deleteBank(bankId, body, admin, adminCheck.userId);
      return fail(404, "Unknown admin route");
    }

    if (route.section === "access" && route.id === "user" && route.action) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((segment) => segment === "admin-api");
      const userId = asUuid(segments[adminIndex + 3] || null);
      const accessAction = segments[adminIndex + 4] || null;
      if (!userId || !accessAction) return badRequest("Invalid access route");

      if (accessAction === "grant") return await grantAccessForUser(userId, body, admin);
      if (accessAction === "revoke") return await revokeAccessForUser(userId, body, admin, adminCheck.userId);
      return fail(404, "Unknown access route");
    }

    if (route.section === "store" && route.id === "banks" && url.pathname.includes("/draft")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const bankId = asUuid(segments[adminIndex + 3] || null);
      if (!bankId) return badRequest("Invalid bank id");
      return await createStoreDraft(bankId, body, admin);
    }

    if (route.section === "store" && route.id === "catalog" && url.pathname.includes("/publish")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const catalogItemId = asUuid(segments[adminIndex + 3] || null);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await publishCatalogItem(catalogItemId, body, admin, adminCheck.userId);
    }

    if (route.section === "store" && route.id === "requests") {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((s) => s === "admin-api");
      const requestId = asUuid(segments[adminIndex + 3] || null);
      const action = segments[adminIndex + 4];
      if (!requestId || !action) return badRequest("Invalid request");
      return await handlePurchaseAction(requestId, action, admin);
    }

    return fail(404, "Unknown admin route");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return fail(500, message);
  }
});
