import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import {
  createR2DirectUploadSession,
  finalizeR2DirectUploadSession,
  readR2DirectUploadSession,
} from "../_shared/r2-direct-upload.ts";
import { createPresignedPutUrl, headObject } from "../_shared/r2-storage.ts";
import {
  createSignedAdminExportToken,
  isAdminExportTokenSigningEnabled,
} from "../_shared/admin-export-token.ts";
import { DEFAULT_SAMPLER_APP_CONFIG, normalizeSamplerAppConfig } from "../_shared/sampler-app-config.ts";
import { createServiceClient, getUserFromAuthHeader, isAdminUser } from "../_shared/supabase.ts";
import { asNumber, asString, asUuid } from "../_shared/validate.ts";
import { consumeRateLimit } from "../_shared/rate-limit.ts";
import { sendDiscordAdminActionEvent } from "../_shared/discord.ts";

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
const R2_BUCKET = asString(Deno.env.get("R2_BUCKET"), 200);
const R2_MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const R2_UPLOAD_URL_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, readPositiveInt(Deno.env.get("R2_UPLOAD_URL_TTL_SECONDS"), 900)),
);
const R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, readPositiveInt(Deno.env.get("R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS"), 900)),
);

const resolveSupabaseUrl = (): string =>
  Deno.env.get("APP_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";

const resolveSupabaseAnonKey = (): string =>
  Deno.env.get("APP_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

const ok = (data: Record<string, unknown>, status = 200) =>
  json(status, { ok: true, data, ...data });

const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  json(status, { ok: false, error, ...(extra || {}) });

const swallowDiscordError = async (task: () => Promise<void>) => {
  try {
    await task();
  } catch {
    // Discord is secondary monitoring only.
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

const toUtcDateKey = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const asFiniteNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const parseDateOnlyParam = (value: string | null): Date | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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

const listUsers = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(2000, Number(url.searchParams.get("perPage") || 100)));
  const includeAdmins = String(url.searchParams.get("includeAdmins") || "false").toLowerCase() === "true";
  const sortBy = String(url.searchParams.get("sortBy") || "created_at");
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));

  const samplerConfigResult = await getNormalizedSamplerAppConfig(admin);
  if (samplerConfigResult.error) return fail(500, samplerConfigResult.error.message);
  const quotaDefaults = samplerConfigResult.config.quotaDefaults;

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
      .select("id, role, display_name, owned_bank_quota, owned_bank_pad_cap, device_total_bank_cap")
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
    const bannedUntil = (user as any).banned_until || null;
    const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());

    return {
      id: user.id,
      email: user.email || null,
      role,
      display_name: displayName,
      owned_bank_quota: Number.isFinite(Number(profile?.owned_bank_quota)) ? Number(profile?.owned_bank_quota) : quotaDefaults.ownedBankQuota,
      owned_bank_pad_cap: Number.isFinite(Number(profile?.owned_bank_pad_cap)) ? Number(profile?.owned_bank_pad_cap) : quotaDefaults.ownedBankPadCap,
      device_total_bank_cap: Number.isFinite(Number(profile?.device_total_bank_cap)) ? Number(profile?.device_total_bank_cap) : quotaDefaults.deviceTotalBankCap,
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

  const sorted = sortRows(filtered, sortBy, sortDir, {
    display_name: (a, b) => compareNullableText(a.display_name, b.display_name),
    email: (a, b) => compareNullableText(a.email, b.email),
    created_at: (a, b) => compareNullableDate(a.created_at, b.created_at),
    last_sign_in_at: (a, b) => compareNullableDate(a.last_sign_in_at, b.last_sign_in_at),
    ban_status: (a, b) => Number(a.is_banned) - Number(b.is_banned),
  });

  return ok({
    users: paginateRows(sorted, page, perPage),
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
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);

  const { data: sessions, error: sessionsError } = await admin
    .from("v_active_sessions_now")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT);
  if (sessionsError) return fail(500, sessionsError.message);

  const rows = Array.isArray(sessions) ? sessions : [];
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
  const adminIds = new Set((admins || []).map((a: any) => a.id));
  const { data: activeTodayRows, error: activeTodayError } = await admin
    .from("active_sessions")
    .select("session_key,user_id,email,device_fingerprint,device_name,platform,browser,os,last_seen_at")
    .gte("last_seen_at", startOfTodayUtc.toISOString())
    .order("last_seen_at", { ascending: false })
    .limit(DASHBOARD_ACTIVE_SESSION_SCAN_LIMIT * 5);
  if (activeTodayError) return fail(500, activeTodayError.message);
  const nonAdminActiveTodayRows = (activeTodayRows || []).filter((row: any) => {
    const userId = String(row?.user_id || "");
    return Boolean(userId) && !adminIds.has(userId);
  });
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

  const dedupedRows = Array.from(latestByUser.values());
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
  const activeTodayUsers = new Set(
    nonAdminActiveTodayRows
      .map((row: any) => String(row?.user_id || ""))
      .filter(Boolean),
  ).size;
  const sortedActiveTodayRows = Array.from(activeTodayLatestByUser.values()).sort((left, right) =>
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
  const samplerConfigResult = await getNormalizedSamplerAppConfig(admin);
  if (samplerConfigResult.error) return fail(500, samplerConfigResult.error.message);
  const quotaDefaults = samplerConfigResult.config.quotaDefaults;
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
      owned_bank_quota: quotaDefaults.ownedBankQuota,
      owned_bank_pad_cap: quotaDefaults.ownedBankPadCap,
      device_total_bank_cap: quotaDefaults.deviceTotalBankCap,
    }, { onConflict: "id" });
  if (profileErr) return fail(500, `User created, profile setup failed: ${profileErr.message}`);

  return ok(
    {
      user: {
        id: userId,
        email: created.user.email,
        display_name: displayName,
        role: "user",
        owned_bank_quota: quotaDefaults.ownedBankQuota,
        owned_bank_pad_cap: quotaDefaults.ownedBankPadCap,
        device_total_bank_cap: quotaDefaults.deviceTotalBankCap,
      },
    },
    201,
  );
};

const updateUserProfile = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const displayName = asString(body?.displayName, 120);
  if (!displayName) return badRequest("displayName is required");
  const ownedBankQuota = Math.floor(Number(body?.ownedBankQuota));
  const ownedBankPadCap = Math.floor(Number(body?.ownedBankPadCap));
  const deviceTotalBankCap = Math.floor(Number(body?.deviceTotalBankCap));
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
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileSelectError) return fail(500, profileSelectError.message);

  if (profileRow?.id) {
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({
        display_name: displayName,
        owned_bank_quota: ownedBankQuota,
        owned_bank_pad_cap: ownedBankPadCap,
        device_total_bank_cap: deviceTotalBankCap,
      })
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
          owned_bank_quota: ownedBankQuota,
          owned_bank_pad_cap: ownedBankPadCap,
          device_total_bank_cap: deviceTotalBankCap,
        },
        { onConflict: "id" },
      );
    if (profileUpsertError) return fail(500, profileUpsertError.message);
  }

  return ok({
    user: {
      id: userId,
      email: existingUser.user.email || null,
      display_name: displayName,
      owned_bank_quota: ownedBankQuota,
      owned_bank_pad_cap: ownedBankPadCap,
      device_total_bank_cap: deviceTotalBankCap,
    },
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
  const since24hIso = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
  const fromDateParam = parseDateOnlyParam(url.searchParams.get("fromDate"));
  const toDateParam = parseDateOnlyParam(url.searchParams.get("toDate"));

  let windowEnd = toDateParam
    ? new Date(Date.UTC(toDateParam.getUTCFullYear(), toDateParam.getUTCMonth(), toDateParam.getUTCDate(), 23, 59, 59, 999))
    : now;
  if (windowEnd.getTime() > now.getTime()) windowEnd = now;

  const windowEndStartOfDay = startOfUtcDay(windowEnd);
  let windowStart = fromDateParam
    ? startOfUtcDay(fromDateParam)
    : new Date(windowEndStartOfDay.getTime() - ((parsedWindowDays - 1) * 24 * 60 * 60 * 1000));

  if (windowStart.getTime() > windowEnd.getTime()) {
    windowStart = new Date(windowEndStartOfDay);
  }

  let windowDays = Math.floor((windowEndStartOfDay.getTime() - startOfUtcDay(windowStart).getTime()) / (24 * 60 * 60 * 1000)) + 1;
  windowDays = Math.max(1, Math.min(DASHBOARD_MAX_WINDOW_DAYS, windowDays));
  if (windowDays >= DASHBOARD_MAX_WINDOW_DAYS) {
    windowStart = new Date(windowEndStartOfDay.getTime() - ((DASHBOARD_MAX_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000));
    windowDays = DASHBOARD_MAX_WINDOW_DAYS;
  }

  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();
  const windowStartDate = toUtcDateKey(windowStart);
  const windowEndDate = toUtcDateKey(windowEndStartOfDay);

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
    pendingAccountCountResp,
    pendingStoreCountResp,
    publishedCatalogCountResp,
    draftCatalogCountResp,
    exports24hResp,
    exportFailures24hResp,
    duplicateNoChange24hResp,
    authFailures24hResp,
    imports24hResp,
    storeRevenue24hResp,
    accountRevenue24hResp,
    revenueTotalsResp,
  ] = await Promise.all([
    admin
      .from("account_registration_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    admin
      .from("bank_purchase_requests")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    admin
      .from("bank_catalog_items")
      .select("id", { head: true, count: "exact" })
      .eq("is_published", true),
    admin
      .from("bank_catalog_items")
      .select("id", { head: true, count: "exact" })
      .eq("is_published", false),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .eq("event_type", "bank.export")
      .gte("created_at", since24hIso),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .eq("event_type", "bank.export")
      .eq("status", "failed")
      .gte("created_at", since24hIso),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .eq("event_type", "bank.export")
      .contains("meta", { upload: { result: "duplicate_no_change" } })
      .gte("created_at", since24hIso),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .in("event_type", ["auth.login", "auth.signup", "auth.signout"])
      .eq("status", "failed")
      .gte("created_at", since24hIso),
    admin
      .from("activity_logs")
      .select("id", { head: true, count: "exact" })
      .eq("event_type", "bank.import")
      .gte("created_at", since24hIso),
    admin
      .from("bank_purchase_requests")
      .select("price_php_snapshot")
      .eq("status", "approved")
      .gte("created_at", since24hIso)
      .limit(5000),
    admin
      .from("account_registration_requests")
      .select("account_price_php_snapshot")
      .eq("status", "approved")
      .gte("created_at", since24hIso)
      .limit(5000),
    admin
      .from("v_admin_dashboard_revenue_totals")
      .select("store_revenue_approved_total,account_revenue_approved_total,store_buyers_approved_total,account_buyers_approved_total")
      .limit(1)
      .maybeSingle(),
  ]);

  if (pendingAccountCountResp.error) return fail(500, pendingAccountCountResp.error.message);
  if (pendingStoreCountResp.error) return fail(500, pendingStoreCountResp.error.message);
  if (publishedCatalogCountResp.error) return fail(500, publishedCatalogCountResp.error.message);
  if (draftCatalogCountResp.error) return fail(500, draftCatalogCountResp.error.message);
  if (exports24hResp.error) return fail(500, exports24hResp.error.message);
  if (exportFailures24hResp.error) return fail(500, exportFailures24hResp.error.message);
  if (duplicateNoChange24hResp.error) return fail(500, duplicateNoChange24hResp.error.message);
  if (authFailures24hResp.error) return fail(500, authFailures24hResp.error.message);
  if (imports24hResp.error) return fail(500, imports24hResp.error.message);
  if (storeRevenue24hResp.error) return fail(500, storeRevenue24hResp.error.message);
  if (accountRevenue24hResp.error) return fail(500, accountRevenue24hResp.error.message);
  if (revenueTotalsResp.error) return fail(500, revenueTotalsResp.error.message);

  const [
    accountQueueResp,
    storeQueueResp,
    trendRowsResp,
    revenueDailyResp,
  ] = await Promise.all([
    admin
      .from("account_registration_requests")
      .select("id, display_name, email, payment_channel, created_at")
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
      .select("created_at, event_type, status")
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .order("created_at", { ascending: true })
      .limit(Math.max(100, Math.min(10000, DASHBOARD_SERIES_CAP))),
    admin
      .from("v_admin_dashboard_revenue_daily")
      .select("date_utc,store_revenue_approved,account_revenue_approved,store_buyers_approved,account_buyers_approved,store_requests_total")
      .gte("date_utc", windowStartDate)
      .lte("date_utc", windowEndDate)
      .order("date_utc", { ascending: true })
      .limit(Math.max(30, Math.min(365, windowDays + 32))),
  ]);

  if (accountQueueResp.error) return fail(500, accountQueueResp.error.message);
  if (storeQueueResp.error) return fail(500, storeQueueResp.error.message);
  if (trendRowsResp.error) return fail(500, trendRowsResp.error.message);
  if (revenueDailyResp.error) return fail(500, revenueDailyResp.error.message);

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
  }>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    const day = new Date(windowStart.getTime() + (offset * 24 * 60 * 60 * 1000));
    const date = toUtcDateKey(day);
    trendSeed.set(date, {
      date,
      exportSuccess: 0,
      exportFailed: 0,
      authSuccess: 0,
      authFailed: 0,
      importTotal: 0,
      storeRevenueApproved: 0,
      accountRevenueApproved: 0,
      totalRevenueApproved: 0,
      storeBuyersApproved: 0,
      accountBuyersApproved: 0,
      importRequests: 0,
    });
  }

  const revenueRows = revenueDailyResp.data || [];
  for (const row of revenueRows) {
    const rawDate = String((row as any).date_utc || "");
    if (!rawDate) continue;
    const date = rawDate.slice(0, 10);
    const bucket = trendSeed.get(date);
    if (!bucket) continue;
    const storeRevenue = asFiniteNumber((row as any).store_revenue_approved);
    const accountRevenue = asFiniteNumber((row as any).account_revenue_approved);
    bucket.storeRevenueApproved = storeRevenue;
    bucket.accountRevenueApproved = accountRevenue;
    bucket.totalRevenueApproved = storeRevenue + accountRevenue;
    bucket.storeBuyersApproved = Math.max(0, Math.floor(asFiniteNumber((row as any).store_buyers_approved)));
    bucket.accountBuyersApproved = Math.max(0, Math.floor(asFiniteNumber((row as any).account_buyers_approved)));
    bucket.importRequests = Math.max(0, Math.floor(asFiniteNumber((row as any).store_requests_total)));
  }

  const trendRows = trendRowsResp.data || [];
  for (const row of trendRows) {
    const createdAt = new Date(String((row as any).created_at || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    const date = toUtcDateKey(createdAt);
    const bucket = trendSeed.get(date);
    if (!bucket) continue;

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

  const accountRequests = (accountQueueResp.data || []).map((row: any) => ({
    id: String(row.id || ""),
    display_name: String(row.display_name || ""),
    email: String(row.email || ""),
    payment_channel: String(row.payment_channel || ""),
    created_at: row.created_at || null,
  }));

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
  const totalRevenue24h = storeRevenue24h + accountRevenue24h;

  const totalRevenueRow = revenueTotalsResp.data || {};
  const storeRevenueApprovedTotal = asFiniteNumber((totalRevenueRow as any).store_revenue_approved_total);
  const accountRevenueApprovedTotal = asFiniteNumber((totalRevenueRow as any).account_revenue_approved_total);
  const totalRevenueApproved = storeRevenueApprovedTotal + accountRevenueApprovedTotal;
  const storeBuyersApprovedTotal = Math.max(0, Math.floor(asFiniteNumber((totalRevenueRow as any).store_buyers_approved_total)));
  const accountBuyersApprovedTotal = Math.max(0, Math.floor(asFiniteNumber((totalRevenueRow as any).account_buyers_approved_total)));

  return ok({
    refreshedAt: nowIso,
    windowDays,
    counts: {
      activeUsers: uniqueActiveUsers,
      activeSessions: nonAdminActiveRows.length,
      pendingAccountRequests: Number(pendingAccountCountResp.count || 0),
      pendingStoreRequests: Number(pendingStoreCountResp.count || 0),
      exports24h: Number(exports24hResp.count || 0),
      exportFailures24h: Number(exportFailures24hResp.count || 0),
      duplicateNoChange24h: Number(duplicateNoChange24hResp.count || 0),
      authFailures24h: Number(authFailures24hResp.count || 0),
      imports24h: Number(imports24hResp.count || 0),
      storeRevenueApprovedTotal,
      accountRevenueApprovedTotal,
      totalRevenueApproved,
      storeRevenue24h,
      accountRevenue24h,
      totalRevenue24h,
      storeBuyersApprovedTotal,
      accountBuyersApprovedTotal,
      publishedCatalog: Number(publishedCatalogCountResp.count || 0),
      draftCatalog: Number(draftCatalogCountResp.count || 0),
    },
    trends: Array.from(trendSeed.values()),
    queues: {
      accountRequests,
      storeRequests,
    },
    meta: {
      timeBasis: "UTC",
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

  const { data: bankData, error: bankError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", bankId)
    .maybeSingle();
  if (bankError || !bankData) return fail(404, "Target bank not found");
  if (bankData.deleted_at) return fail(400, "Cannot create draft for archived bank");

  const { data: existingDraft } = await admin.from("bank_catalog_items").select("id").eq("bank_id", bankId).maybeSingle();

  if (existingDraft?.id) {
    const { data: updated, error: updateError } = await admin.from("bank_catalog_items").update({
      expected_asset_name: expectedAssetName,
      thumbnail_path: thumbnailPath,
      asset_protection: assetProtection,
      is_published: false,
      storage_provider: "r2",
      storage_bucket: "",
      storage_key: "",
      storage_etag: null,
      storage_uploaded_at: null,
      file_size_bytes: null,
      sha256: null,
    }).eq("id", existingDraft.id).select("*").single();
    if (updateError) return fail(500, updateError.message);
    return ok({ item: updated });
  }

  const { data: newDraft, error: insertError } = await admin.from("bank_catalog_items").insert({
    bank_id: bankId,
    expected_asset_name: expectedAssetName,
    thumbnail_path: thumbnailPath,
    asset_protection: assetProtection,
    is_published: false
  }).select("*").single();
  if (insertError) return fail(500, insertError.message);
  return ok({ item: newDraft });
};

const publishCatalogItem = async (
  catalogItemId: string,
  _body: any,
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
  const isPaid = Boolean(item?.is_paid);
  const requiresGrant = Boolean(item?.requires_grant);
  const parsedPrice = Number(item?.price_php);
  const hasPositivePrice = Number.isFinite(parsedPrice) && parsedPrice > 0;
  if (isPaid && !hasPositivePrice) {
    return badRequest("Paid catalog items must have price set before publish");
  }
  if (isPaid && !requiresGrant) {
    return badRequest("Paid catalog items must require grant");
  }

  const { data: bankData, error: bankError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", item.bank_id)
    .maybeSingle();
  if (bankError) return fail(500, bankError.message);
  if (!bankData) return fail(404, "Target bank not found");
  if (bankData.deleted_at) return fail(400, "Cannot publish catalog for archived bank");

  const storageProvider = asString(item?.storage_provider, 40);
  const storageBucket = asString(item?.storage_bucket, 300);
  const storageKey = asString(item?.storage_key, 2000);
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

  const { data: updated, error: updateError } = await admin.from("bank_catalog_items").update({
    is_published: true,
    file_size_bytes: objectInfo.sizeBytes,
    storage_provider: "r2",
    storage_bucket: storageBucket,
    storage_key: storageKey,
    storage_etag: objectInfo.etag,
    storage_uploaded_at: new Date().toISOString(),
  }).eq("id", catalogItemId).select("*").single();
  if (updateError) return fail(500, updateError.message);
  await swallowDiscordError(() => sendDiscordAdminActionEvent({
    severity: "info",
    title: "Store Bank Publish Completed",
    description: "Catalog item was published and is now live for entitled buyers.",
    actorUserId: adminUserId,
    bankId: asString(item.bank_id, 80) || null,
    catalogItemId,
    extraFields: [
      { name: "Protection", value: String(updated.asset_protection || item.asset_protection || "encrypted"), inline: true },
      { name: "Storage Key", value: String(updated.storage_key || storageKey), inline: false },
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

  const { data: bankData, error: bankError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", item.bank_id)
    .maybeSingle();
  if (bankError) return fail(500, bankError.message);
  if (!bankData) return fail(404, "Target bank not found");
  if (bankData.deleted_at) return fail(400, "Cannot publish catalog for archived bank");

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
    bankId: item.bank_id,
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

  const { data: bankData, error: bankError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", item.bank_id)
    .maybeSingle();
  if (bankError) return fail(500, bankError.message);
  if (!bankData) return fail(404, "Target bank not found");
  if (bankData.deleted_at) return fail(400, "Cannot publish catalog for archived bank");

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

  if (action === "reject") {
    const { error: rejectErr } = await admin.from("bank_purchase_requests").update({ status: "rejected" }).eq("id", requestId);
    if (rejectErr) return fail(500, rejectErr.message);
    return ok({ requestId, status: "rejected" });
  }

  if (action === "approve") {
    const { error: approveErr } = await admin.from("bank_purchase_requests").update({ status: "approved" }).eq("id", requestId);
    if (approveErr) return fail(500, approveErr.message);

    const { error: grantErr } = await admin.from("user_bank_access").upsert({
      user_id: request.user_id,
      bank_id: request.bank_id
    }, { onConflict: "user_id,bank_id" });
    if (grantErr) return fail(500, grantErr.message);

    return ok({ requestId, status: "approved" });
  }
  return badRequest("Invalid action");
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

    if (route.section === "default-bank" && route.id === "complete-upload") {
      return await completeUploadDefaultBankRelease(body, admin, adminCheck.userId);
    }

    if (route.section === "default-bank" && route.id === "rollback") {
      return await rollbackDefaultBankRelease(body, admin, adminCheck.userId);
    }

    if (route.section === "users" && route.id === "create") {
      return await createUser(body, admin);
    }

    if (route.section === "users" && route.id && route.action) {
      const userId = asUuid(route.id);
      if (!userId) return badRequest("Invalid user id");
      if (route.action === "update-profile") return await updateUserProfile(userId, body, admin);
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
