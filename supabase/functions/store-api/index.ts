import "@supabase/functions-js/edge-runtime.d.ts";
import { badRequest, buildCorsHeaders, handleCorsPreflight, json } from "../_shared/http.ts";
import { createPresignedGetUrl, createPresignedPutUrl, deleteObject } from "../_shared/r2-storage.ts";
import { createSignedEntitlementToken, isEntitlementTokenSigningEnabled } from "../_shared/entitlement-token.ts";
import { DEFAULT_SAMPLER_APP_CONFIG, normalizeSamplerAppConfig } from "../_shared/sampler-app-config.ts";
import { createServiceClient, getUserFromAuthHeader, isAdminUser } from "../_shared/supabase.ts";
import { asString, asUuid } from "../_shared/validate.ts";
import { consumeRateLimit } from "../_shared/rate-limit.ts";
import {
  type DiscordField,
  sendDiscordAccountRegistrationEvent,
  sendDiscordAdminActionEvent,
  sendDiscordOcrFailureEvent,
  sendDiscordStoreCrashReportEvent,
  sendDiscordStoreRequestEvent,
} from "../_shared/discord.ts";

const ok = (data: Record<string, unknown>, status = 200) => json(status, { ok: true, data, ...data });
const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  json(status, { ok: false, error, ...(extra || {}) });

const swallowDiscordError = async (task: () => Promise<void>) => {
  try {
    await task();
  } catch {
    // Discord is secondary notification only.
  }
};

const shouldNotifyOcrFailure = (errorCode: string | null | undefined): boolean => {
  if (!errorCode) return false;
  return errorCode !== "MANUAL_REVIEW_MODE";
};

const asPriceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(".") && cleaned.includes(",")) normalized = cleaned.replace(/,/g, "");
  else if (!cleaned.includes(".") && cleaned.includes(",")) normalized = cleaned.replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const resolveCatalogPrice = (row: any): number | null => {
  return asPriceNumber(row?.price_php ?? row?.price_label);
};

const getFirstRelationRow = (value: any) => Array.isArray(value) ? value[0] : value;
const titleSortCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const stripLeadingNonWord = (value: string): string => value.replace(/^[^\p{L}\p{N}]+/u, "");
const normalizeCatalogTitleSortKey = (title: string): string => {
  const raw = String(title || "").trim();
  const withoutPrefixNoise = stripLeadingNonWord(raw);
  const normalized = (withoutPrefixNoise || raw)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en");
  return normalized;
};

const compareCatalogItemsByTitle = (left: any, right: any, direction: "asc" | "desc"): number => {
  const leftBank = getFirstRelationRow(left?.banks);
  const rightBank = getFirstRelationRow(right?.banks);
  const leftTitle = String(leftBank?.title || "");
  const rightTitle = String(rightBank?.title || "");
  const leftKey = normalizeCatalogTitleSortKey(leftTitle);
  const rightKey = normalizeCatalogTitleSortKey(rightTitle);
  const primary = titleSortCollator.compare(leftKey, rightKey);
  if (primary !== 0) return direction === "asc" ? primary : -primary;
  const secondary = titleSortCollator.compare(leftTitle, rightTitle);
  if (secondary !== 0) return direction === "asc" ? secondary : -secondary;
  const leftId = String(left?.id || "");
  const rightId = String(right?.id || "");
  return leftId.localeCompare(rightId);
};

const requireAdmin = async (req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  if (!user) return { ok: false, response: fail(401, "NOT_AUTHENTICATED") };
  const admin = await isAdminUser(user.id);
  if (!admin) return { ok: false, response: fail(403, "NOT_AUTHORIZED") };
  return { ok: true, userId: user.id };
};

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const STORE_DOWNLOAD_RATE_LIMIT = readPositiveInt(Deno.env.get("STORE_DOWNLOAD_RATE_LIMIT"), 20);
const STORE_DOWNLOAD_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("STORE_DOWNLOAD_RATE_WINDOW_SECONDS"), 3600);
const STORE_PURCHASE_RATE_LIMIT = readPositiveInt(Deno.env.get("STORE_PURCHASE_RATE_LIMIT"), 12);
const STORE_PURCHASE_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("STORE_PURCHASE_RATE_WINDOW_SECONDS"), 3600);
const STORE_MAX_PURCHASE_ITEMS = readPositiveInt(Deno.env.get("STORE_MAX_PURCHASE_ITEMS"), 20);
const STORE_MAX_DOWNLOAD_BYTES = readPositiveInt(Deno.env.get("STORE_MAX_DOWNLOAD_BYTES"), 478150656); // 456 MB
const STORE_MAX_NATIVE_DOWNLOAD_BYTES = readPositiveInt(
  Deno.env.get("STORE_MAX_NATIVE_DOWNLOAD_BYTES"),
  2 * 1024 * 1024 * 1024 - 1,
); // ~2 GB, aligned with native-capable archive handling
const R2_BUCKET = asString(Deno.env.get("R2_BUCKET"), 200) || "";
const R2_UPLOAD_URL_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, readPositiveInt(Deno.env.get("R2_UPLOAD_URL_TTL_SECONDS"), 900)),
);
const STORE_MANAGED_ASSET_MAX_BYTES = readPositiveInt(
  Deno.env.get("STORE_MANAGED_ASSET_MAX_BYTES"),
  25 * 1024 * 1024,
); // 25 MB for QR / banner / thumbnail assets
const STORE_R2_SIGNED_DOWNLOAD_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, readPositiveInt(Deno.env.get("R2_SIGNED_URL_TTL_SECONDS"), 300)),
);
const STORE_MARKETING_BANNER_MAX_ACTIVE = readPositiveInt(Deno.env.get("STORE_MARKETING_BANNER_MAX_ACTIVE"), 12);
const STORE_BANNER_ROTATION_DEFAULT_MS = 5000;
const STORE_BANNER_ROTATION_MIN_MS = 3000;
const STORE_BANNER_ROTATION_MAX_MS = 15000;
const STORE_RELEASE_CACHE_TTL_SECONDS = readPositiveInt(Deno.env.get("STORE_RELEASE_CACHE_TTL_SECONDS"), 300);
const STORE_RELEASE_CACHE_MAX_ENTRIES = readPositiveInt(Deno.env.get("STORE_RELEASE_CACHE_MAX_ENTRIES"), 200);
const STORE_EMAIL_RECEIPT_LINK_TTL_SECONDS = Math.max(
  300,
  Math.min(604800, readPositiveInt(Deno.env.get("STORE_EMAIL_RECEIPT_LINK_TTL_SECONDS"), 3600)),
);
const USER_IDENTITY_CACHE_TTL_SECONDS = readPositiveInt(Deno.env.get("USER_IDENTITY_CACHE_TTL_SECONDS"), 300);
const USER_IDENTITY_CACHE_MAX_ENTRIES = readPositiveInt(Deno.env.get("USER_IDENTITY_CACHE_MAX_ENTRIES"), 5000);
const PAYMENT_CHANNEL_VALUES = new Set(["image_proof", "gcash_manual", "maya_manual"]);
const ACCOUNT_REG_SUBMIT_RATE_LIMIT = readPositiveInt(Deno.env.get("ACCOUNT_REG_RATE_LIMIT"), 8);
const ACCOUNT_REG_SUBMIT_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACCOUNT_REG_RATE_WINDOW_SECONDS"), 3600);
const ACCOUNT_REG_UPLOAD_RATE_LIMIT = readPositiveInt(Deno.env.get("ACCOUNT_REG_UPLOAD_RATE_LIMIT"), 12);
const ACCOUNT_REG_UPLOAD_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACCOUNT_REG_UPLOAD_RATE_WINDOW_SECONDS"), 3600);
const ACCOUNT_REG_LOGIN_HINT_RATE_LIMIT = readPositiveInt(Deno.env.get("ACCOUNT_REG_LOGIN_HINT_RATE_LIMIT"), 30);
const ACCOUNT_REG_LOGIN_HINT_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACCOUNT_REG_LOGIN_HINT_RATE_WINDOW_SECONDS"), 3600);
const ACCOUNT_REG_MAX_PROOF_BYTES = readPositiveInt(Deno.env.get("ACCOUNT_REG_MAX_PROOF_BYTES"), 10 * 1024 * 1024);
const RECEIPT_OCR_RATE_LIMIT = readPositiveInt(Deno.env.get("RECEIPT_OCR_RATE_LIMIT"), 40);
const RECEIPT_OCR_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("RECEIPT_OCR_RATE_WINDOW_SECONDS"), 3600);
const RECEIPT_OCR_TIMEOUT_MS = readPositiveInt(Deno.env.get("RECEIPT_OCR_TIMEOUT_MS"), 12000);
const CLIENT_CRASH_REPORT_RATE_LIMIT = readPositiveInt(Deno.env.get("CLIENT_CRASH_REPORT_RATE_LIMIT"), 12);
const CLIENT_CRASH_REPORT_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("CLIENT_CRASH_REPORT_RATE_WINDOW_SECONDS"), 86400);
const CLIENT_CRASH_REPORT_MAX_BYTES = readPositiveInt(Deno.env.get("CLIENT_CRASH_REPORT_MAX_BYTES"), 256 * 1024);
const ACCOUNT_REG_PASSWORD_KEY_VERSION = readPositiveInt(Deno.env.get("ACCOUNT_REG_PASSWORD_KEY_VERSION"), 1);
const ACCOUNT_REG_MIN_PASSWORD_LENGTH = 8;
const OCR_SPACE_API_URL = String(Deno.env.get("OCR_SPACE_API_URL") || "https://api.ocr.space/parse/image");
const OCR_SPACE_PROVIDER = "ocr.space";
const ACCOUNT_REG_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const ACCOUNT_REG_ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let cachedRegistrationPasswordKey: CryptoKey | null = null;

type CachedReleaseAsset = {
  url: string;
  size: number;
  downloadUrl: string | null;
  expiresAt: number;
};

const releaseAssetCache = new Map<string, CachedReleaseAsset>();

type CachedUserIdentity = {
  display_name: string;
  email: string;
  expiresAt: number;
};
const userIdentityCache = new Map<string, CachedUserIdentity>();

const RESEND_API_KEY = String(Deno.env.get("RESEND_API_KEY") || "").trim();
const STORE_EMAIL_FROM = String(Deno.env.get("STORE_EMAIL_FROM") || "").trim();
const STORE_EMAIL_REPLY_TO = asString(Deno.env.get("STORE_EMAIL_REPLY_TO"), 320) || null;
const INSTALLER_WORKER_BASE_URL = String(Deno.env.get("INSTALLER_WORKER_BASE_URL") || "").trim().replace(/\/+$/, "");
const INSTALLER_WORKER_ADMIN_SECRET = String(Deno.env.get("INSTALLER_WORKER_ADMIN_SECRET") || "").trim();

const normalizeAuthErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown auth error";
  if (typeof error === "string") return error;
  if (typeof (error as any)?.message === "string") return String((error as any).message);
  return String(error);
};

const buildInstallerWorkerUrl = (pathWithQuery: string): string => {
  if (!INSTALLER_WORKER_BASE_URL) {
    throw new Error("INSTALLER_WORKER_BASE_URL is not configured");
  }
  const normalizedPath = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  return `${INSTALLER_WORKER_BASE_URL}${normalizedPath}`;
};

const callInstallerAdmin = async <T>(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<T> => {
  if (!INSTALLER_WORKER_ADMIN_SECRET) {
    throw new Error("INSTALLER_WORKER_ADMIN_SECRET is not configured");
  }

  const response = await fetch(buildInstallerWorkerUrl(pathWithQuery), {
    method,
    headers: {
      "x-admin-secret": INSTALLER_WORKER_ADMIN_SECRET,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      String((payload as any)?.message || (payload as any)?.error || (payload as any)?.status || "Installer worker request failed");
    throw new Error(message);
  }

  return payload as T;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => values[key] || "");

const toHtmlFromPlainText = (value: string): string =>
  escapeHtml(value).replace(/\n/g, "<br />");

const formatPhpCurrency = (value: number): string =>
  `PHP ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const matchesAutoApprovalAmount = (expectedAmount: number, detectedAmount: number): boolean => {
  const expected = roundMoney(expectedAmount);
  const detected = roundMoney(detectedAmount);
  if (!Number.isFinite(expected) || !Number.isFinite(detected)) return false;
  if (expected <= 0 || detected <= 0) return false;
  if (expected === detected) return true;
  if (Math.abs(detected - expected) <= 1) return true;

  // Allow small user-friendly upward round-off amounts such as 49->50, 88->90, or 98->100,
  // but do not allow larger underpayments or broad overpayments.
  const roundedUpToFive = roundMoney(Math.ceil(expected / 5) * 5);
  if (roundedUpToFive > expected && roundedUpToFive - expected <= 2 && detected === roundedUpToFive) {
    return true;
  }

  return false;
};

const AUTO_APPROVAL_TIMEZONE = "Asia/Manila";
type AutomationReason =
  | "approved"
  | "manual_review_disabled"
  | "outside_window"
  | "missing_reference"
  | "missing_amount"
  | "missing_recipient_number"
  | "duplicate_reference"
  | "wallet_number_mismatch"
  | "amount_mismatch"
  | "ocr_failed"
  | "approval_error"
  | "not_image_proof";
type OcrStatus =
  | "detected"
  | "missing_reference"
  | "missing_amount"
  | "missing_recipient_number"
  | "failed"
  | "unavailable"
  | "skipped";

type ReceiptOcrDetection = {
  referenceNo: string | null;
  payerName: string | null;
  amountPhp: number | null;
  recipientNumber: string | null;
  rawText: string;
  provider: string;
  elapsedMs: number;
};

type ReceiptOcrFailureCode =
  | "OCR_UNAVAILABLE"
  | "OCR_STORAGE_DOWNLOAD_FAILED"
  | "OCR_UNSUPPORTED_EXTENSION"
  | "OCR_UNSUPPORTED_MIME"
  | "OCR_INVALID_FILE_SIZE"
  | "OCR_FILE_TOO_LARGE"
  | "OCR_TIMEOUT"
  | "OCR_HTTP_FAILED"
  | "OCR_PROVIDER_PROCESSING_ERROR"
  | "OCR_EMPTY_TEXT"
  | "OCR_FAILED";

type ReceiptOcrAttempt = {
  detected: ReceiptOcrDetection | null;
  errorCode: ReceiptOcrFailureCode | null;
  provider: string | null;
  elapsedMs: number;
};

type ReceiptOcrMetadata = {
  referenceNo: string | null;
  payerName: string | null;
  amountPhp: number | null;
  recipientNumber: string | null;
  provider: string | null;
  scannedAt: string | null;
  status: OcrStatus;
  errorCode: string | null;
};

type ClientCrashReportBody = {
  domain?: string | null;
  title?: string | null;
  supportLogText?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  operation?: string | null;
  phase?: string | null;
  stage?: string | null;
  entryCount?: number | null;
  recentEventPattern?: string | null;
  detectedAt?: string | number | null;
  lastUpdatedAt?: string | number | null;
};

type ClientCrashReportDomain = "bank_store" | "playback" | "global_runtime";

type AutoApprovalMode = "schedule" | "countdown" | "always";

type AutoApprovalWindowConfig = {
  enabled: boolean;
  mode: AutoApprovalMode;
  startHour: number;
  endHour: number;
  durationHours: number;
  expiresAt: string | null;
};

const normalizeAutoApprovalHour = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(23, Math.floor(parsed)));
};

const normalizeAutoApprovalMode = (value: unknown): AutoApprovalMode => {
  if (value === "countdown") return "countdown";
  if (value === "always") return "always";
  return "schedule";
};

const normalizeAutoApprovalDurationHours = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(168, Math.floor(parsed)));
};

type StoreMaintenanceState = {
  enabled: boolean;
  message: string | null;
  isAdmin: boolean;
};

const getStoreMaintenanceState = async (
  req: Request,
  admin: ReturnType<typeof createServiceClient>,
): Promise<StoreMaintenanceState | { response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  const userId = user?.id || null;
  const adminBypass = userId ? await isAdminUser(userId) : false;
  const { data, error } = await admin
    .from("store_payment_settings")
    .select("store_maintenance_enabled,store_maintenance_message")
    .eq("id", "default")
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { response: fail(500, error.message) };
  return {
    enabled: Boolean((data as any)?.store_maintenance_enabled),
    message: asString((data as any)?.store_maintenance_message, 2000) || null,
    isAdmin: adminBypass,
  };
};

const getHourInTimezone = (date: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((part) => part.type === "hour")?.value || "0";
  const parsed = Number(hourPart);
  return Number.isFinite(parsed) ? parsed % 24 : 0;
};

const normalizePhMobileNumber = (value: unknown): string | null => {
  const raw = typeof value === "string" ? value : String(value || "");
  if (!raw.trim()) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("09")) return `63${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("63")) return digits;
  return null;
};

const extractPhMobileTailDigits = (value: unknown): string | null => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
};

const looksLikeMaskedPhMobileNumber = (value: unknown): boolean => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (!/(?:\+?63|0)\s*9/i.test(raw)) return false;
  if (!/[xX*•._-]/.test(raw)) return false;
  return Boolean(extractPhMobileTailDigits(raw));
};

const detectReceiptRecipientNumber = (rawText: string): string | null => {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const phoneRegex = /(?:\+?63|0)\s*9(?:[\s-]*\d){9}/g;
  const maskedPhoneRegex = /(?:\+?63|0)\s*9(?:[\sxX*•._-]*[\dxX*•._-]){3,20}\d{4}/g;
  const positiveKeywordRegex = /\b(?:to|recipient|receiver|receive|received by|send to|sent to|account|account number|mobile|mobile number|number|gcash|maya)\b/i;
  const negativeKeywordRegex = /\b(?:from|sender|reference|ref|transaction|amount|total|paid|payment|balance|available)\b/i;

  type Candidate = { value: string; score: number; exact: boolean };
  const scoredCandidates: Candidate[] = [];

  for (const line of lines) {
    const matches = Array.from(
      new Set([...(line.match(phoneRegex) || []), ...(line.match(maskedPhoneRegex) || [])]),
    );
    if (matches.length === 0) continue;
    const hasPositive = positiveKeywordRegex.test(line);
    const hasNegative = negativeKeywordRegex.test(line);
    for (const match of matches) {
      const normalized = normalizePhMobileNumber(match);
      const masked = !normalized && looksLikeMaskedPhMobileNumber(match);
      if (!normalized && !masked) continue;
      let score = 0;
      if (hasPositive) score += 5;
      if (/\b(?:gcash|maya)\b/i.test(line)) score += 2;
      if (/account\s*number|mobile\s*number|recipient|receiver|send\s*to|sent\s*to/i.test(line)) score += 2;
      if (hasNegative) score -= 3;
      if (masked) score -= 1;
      scoredCandidates.push({ value: normalized || match.trim(), score, exact: Boolean(normalized) });
    }
  }

  const positiveCandidates = scoredCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.value.localeCompare(right.value));
  if (positiveCandidates.length > 0) return positiveCandidates[0].value;

  const fallbackCandidates = Array.from(
    new Set(
      lines
        .flatMap((line) => [...(line.match(phoneRegex) || []), ...(line.match(maskedPhoneRegex) || [])])
        .map((match) => normalizePhMobileNumber(match) || (looksLikeMaskedPhMobileNumber(match) ? match.trim() : null))
        .filter(Boolean) as string[],
    ),
  );
  if (fallbackCandidates.length === 1) return fallbackCandidates[0];
  return null;
};

const matchesConfiguredWalletRecipient = (input: {
  paymentChannel: string | null | undefined;
  detectedRecipientNumber: string | null;
  paymentConfig: any;
}): boolean => {
  const detected = normalizePhMobileNumber(input.detectedRecipientNumber);
  const detectedTail = extractPhMobileTailDigits(input.detectedRecipientNumber);
  const gcashNumber = normalizePhMobileNumber(input.paymentConfig?.gcash_number);
  const mayaNumber = normalizePhMobileNumber(input.paymentConfig?.maya_number);
  const gcashTail = extractPhMobileTailDigits(input.paymentConfig?.gcash_number);
  const mayaTail = extractPhMobileTailDigits(input.paymentConfig?.maya_number);
  const channel = String(input.paymentChannel || "").toLowerCase();

  if (detected) {
    const exactMatch = channel === "gcash_manual"
      ? Boolean(gcashNumber && detected === gcashNumber)
      : channel === "maya_manual"
        ? Boolean(mayaNumber && detected === mayaNumber)
        : Boolean((gcashNumber && detected === gcashNumber) || (mayaNumber && detected === mayaNumber));
    if (exactMatch) return true;
  }

  if (!looksLikeMaskedPhMobileNumber(input.detectedRecipientNumber) || !detectedTail) return false;

  const tailMatch = channel === "gcash_manual"
    ? Boolean(gcashTail && detectedTail === gcashTail)
    : channel === "maya_manual"
      ? Boolean(mayaTail && detectedTail === mayaTail)
      : Boolean((gcashTail && detectedTail === gcashTail) || (mayaTail && detectedTail === mayaTail));
  return tailMatch;
};

const isWithinAutoApprovalWindow = (config: AutoApprovalWindowConfig, now = new Date()): boolean => {
  if (!config.enabled) return false;
  if (config.mode === "always") return true;
  if (config.mode === "countdown") {
    if (!config.expiresAt) return false;
    const expiresAtMs = new Date(config.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return false;
    return expiresAtMs > now.getTime();
  }
  if (config.startHour === config.endHour) return true;
  const hour = getHourInTimezone(now, AUTO_APPROVAL_TIMEZONE);
  if (config.startHour < config.endHour) return hour >= config.startHour && hour < config.endHour;
  return hour >= config.startHour || hour < config.endHour;
};

const normalizePaymentReferenceRegistryKey = (value: unknown): string | null => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return normalized || null;
};

const buildReceiptStyleEmailHtml = (input: {
  variant: "approved" | "rejected" | "pending";
  title: string;
  subtitle: string;
  amountLabel?: string;
  amountValue?: string;
  details: Array<{ label: string; value: string }>;
  bodyText: string;
  receiptImageUrl?: string;
}): string => {
  const isApproved = input.variant === "approved";
  const isPending = input.variant === "pending";
  const accent = isApproved ? "#10b981" : isPending ? "#f59e0b" : "#ef4444";
  const cardBorder = isApproved ? "#0f766e" : isPending ? "#92400e" : "#7f1d1d";
  const cardBgFrom = "#0f172a";
  const cardBgTo = isApproved ? "#172554" : isPending ? "#3b2a12" : "#3f1d2a";
  const bodyTextClean = String(input.bodyText || "").trim();
  const iconChar = isApproved ? "&#10003;" : isPending ? "&#9716;" : "&#10005;";

  const detailsRows = input.details
    .map((row) => `
      <tr>
        <td style="padding:7px 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(row.label)}</td>
        <td style="padding:7px 0;color:#f9fafb;font-size:13px;font-weight:700;text-align:right;word-break:break-word;">${escapeHtml(row.value)}</td>
      </tr>
    `)
    .join("");

  const amountBlock = input.amountValue
    ? `
      <tr>
        <td align="center" style="padding:12px 24px 2px;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;">${escapeHtml(input.amountLabel || "Total Payment")}</div>
          <div style="margin-top:6px;font-size:42px;line-height:1.05;font-weight:800;color:#f9fafb;">${escapeHtml(input.amountValue)}</div>
        </td>
      </tr>
    `
    : "";

  const messageBlock = bodyTextClean
    ? `
      <tr>
        <td style="padding:0 24px 16px;">
          <div style="font-size:14px;line-height:1.6;color:#d1d5db;">${toHtmlFromPlainText(bodyTextClean)}</div>
        </td>
      </tr>
    `
    : "";

  const receiptSection = input.receiptImageUrl
    ? `
      <tr>
        <td style="padding:0 24px 20px;">
          <div style="margin-bottom:8px;font-size:12px;font-weight:700;color:#f9fafb;">Submitted Receipt</div>
          <img src="${escapeHtml(input.receiptImageUrl)}" alt="Payment receipt" style="display:block;width:100%;max-width:512px;height:auto;border:1px solid #374151;border-radius:10px;" />
        </td>
      </tr>
    `
    : "";

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#0b1220;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:380px;background:${cardBgFrom};background-image:linear-gradient(180deg,${cardBgFrom} 0%,${cardBgTo} 100%);border:1px solid ${cardBorder};border-radius:28px;overflow:hidden;box-shadow:0 18px 45px rgba(2,6,23,0.7);">
            <tr>
              <td align="center" style="padding:18px 20px 8px;">
                <div style="margin:0 auto;width:96px;height:96px;border-radius:9999px;background:rgba(16,185,129,0.12);display:flex;align-items:center;justify-content:center;">
                  <div style="width:64px;height:64px;border-radius:9999px;background:rgba(16,185,129,0.25);display:flex;align-items:center;justify-content:center;">
                    <div style="width:46px;height:46px;border-radius:9999px;background:${accent};color:#ffffff;font-size:30px;line-height:46px;font-weight:900;text-align:center;">${iconChar}</div>
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:2px 24px 0;">
                <div style="font-size:42px;line-height:1.06;font-weight:800;color:#f9fafb;">${escapeHtml(input.title)}</div>
                <div style="margin-top:8px;font-size:14px;line-height:1.45;color:#d1d5db;">${escapeHtml(input.subtitle)}</div>
              </td>
            </tr>
            ${amountBlock}
            <tr>
              <td style="padding:14px 24px 6px;">
                <hr style="border:none;border-top:1px dashed #475569;margin:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:8px 18px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #334155;border-radius:12px;padding:12px 14px;background:rgba(30,41,59,0.7);">
                  ${detailsRows}
                </table>
              </td>
            </tr>
            ${messageBlock}
            ${receiptSection}
          </table>
        </td>
      </tr>
    </table>
  `;
};

const stripReceiptDuplicateLines = (value: string): string => {
  const blocked = /^(banks|total items|amount|vdjv receipt no|payment reference|payment channel|reviewed at|reason)\s*:/i;
  return String(value || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !blocked.test(line.trim()))
    .join("\n")
    .trim();
};
const sanitizeEmailSubject = (value: string, maxLength = 300): string =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, maxLength));

const sendEmailViaResend = async (input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
}): Promise<void> => {
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    throw new Error("Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)");
  }
  const safeSubject = sanitizeEmailSubject(input.subject, 300) || "VDJV Notification";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: STORE_EMAIL_FROM,
      to: [input.to],
      subject: safeSubject,
      html: input.html,
      text: input.text || undefined,
      reply_to: input.replyTo || STORE_EMAIL_REPLY_TO || undefined,
    }),
  });
  if (response.ok) return;
  const errorPayload = await response.text().catch(() => "");
  const suffix = errorPayload ? ` (${errorPayload.slice(0, 300)})` : "";
  throw new Error(`Resend email send failed: HTTP_${response.status}${suffix}`);
};

const normalizeBase64 = (value: string): string => {
  const trimmed = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padding = trimmed.length % 4;
  if (!padding) return trimmed;
  return trimmed + "=".repeat(4 - padding);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const normalized = normalizeBase64(value);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

const normalizeCrashText = (value: unknown, maxLength = 400): string | null => {
  const trimmed = asString(value, maxLength * 4);
  if (!trimmed) return null;
  const normalized = trimmed
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z/g, "<iso>")
    .replace(/\b\d{13,}\b/g, "<longnum>")
    .replace(/\b[0-9a-f]{8,}\b/g, "<hex>")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, maxLength) || null;
};

const shouldNotifyCrashReportRepeat = (repeatCount: number): boolean =>
  repeatCount <= 2 || repeatCount === 5 || repeatCount === 10 || repeatCount % 25 === 0;

const normalizeClientCrashReportDomain = (value: unknown): ClientCrashReportDomain | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bank_store" || normalized === "playback" || normalized === "global_runtime") {
    return normalized;
  }
  return null;
};

const getClientCrashReportTitle = (domain: ClientCrashReportDomain, fallbackTitle?: string | null): string => {
  const explicit = asString(fallbackTitle, 200);
  if (explicit) return explicit;
  if (domain === "playback") return "Recovered Playback Crash";
  if (domain === "global_runtime") return "Recovered Global Runtime Error";
  return "Recovered Bank Store Crash";
};

const uploadCrashReportTextToR2 = async (input: {
  reportId: string;
  bodyText: string;
  domain: string;
}): Promise<{ objectKey: string; sizeBytes: number }> => {
  if (!R2_BUCKET) throw new Error("R2_NOT_CONFIGURED");
  const safeReportId = asString(input.reportId, 120) || crypto.randomUUID();
  const objectKey = `crash-reports/${input.domain}/${safeReportId}/${Date.now()}.log`;
  const upload = await createPresignedPutUrl(
    R2_BUCKET,
    objectKey,
    R2_UPLOAD_URL_TTL_SECONDS,
    "text/plain;charset=utf-8",
  );
  const payload = textEncoder.encode(input.bodyText);
  const response = await fetch(upload.url, {
    method: "PUT",
    headers: upload.headers,
    body: payload,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`CRASH_REPORT_UPLOAD_FAILED_${response.status}${text ? `:${text}` : ""}`);
  }
  return {
    objectKey,
    sizeBytes: payload.byteLength,
  };
};

const normalizeEmail = (value: unknown): string | null => {
  const email = asString(value, 320)?.toLowerCase() || null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
};

const getRequestIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
};

const getExtensionFromFileName = (value: string | null): string | null => {
  if (!value) return null;
  const ext = value.split(".").pop()?.toLowerCase() || "";
  return ext || null;
};

const utcDateStamp = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, "");

const buildAccountReceiptReference = (): string =>
  `VDJV-ACC-${utcDateStamp()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const buildStoreReceiptReference = (batchId: string): string =>
  `VDJV-STORE-${utcDateStamp()}-${String(batchId || "").replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const buildInstallerReceiptReference = (version: InstallerBuyVersionKey): string =>
  `VDJV-${version}-BUY-${utcDateStamp()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const normalizeReceiptText = (value: string): string =>
  value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

const receiptReferenceKeywordRegex = /\b(ref(?:erence)?|transaction|txn|trx|trace)\b/i;
const receiptReferenceContinuationLineRegex = /^[A-Z0-9][A-Z0-9\s-]{1,31}$/i;
const receiptReferenceStopWordRegex = /\b(?:amount|total|paid|payment|date|time|gcash|maya|sent|received|recipient)\b/i;

const extractReferenceFragments = (value: string): string[] =>
  String(value || "")
    .toUpperCase()
    .match(/[A-Z0-9]+/g)
    ?.filter((fragment) => {
      if (!fragment) return false;
      if (/^(REF|REFERENCE|NO|TRANSACTION|TXN|TRX|TRACE)$/i.test(fragment)) return false;
      return /\d/.test(fragment);
    }) || [];

const normalizeReferenceCandidate = (value: string): string | null => {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!normalized || !/\d/.test(normalized) || normalized.length < 6) return null;
  return normalized;
};

const detectReferenceNo = (rawText: string): string | null => {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const tokenRegex = /([A-Z0-9][A-Z0-9-]{5,31})/g;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!receiptReferenceKeywordRegex.test(line)) continue;
    const matches = line.toUpperCase().match(tokenRegex) || [];
    const picked = matches.find((token) => /\d/.test(token) && token.length >= 6);
    if (picked) return picked;

    const fragments = extractReferenceFragments(line);
    const mergedSameLine = normalizeReferenceCandidate(fragments.join(""));
    if (mergedSameLine && mergedSameLine.length >= 8) return mergedSameLine;

    const mergedFragments = [...fragments];
    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      if (receiptReferenceKeywordRegex.test(nextLine)) break;
      if (!receiptReferenceContinuationLineRegex.test(nextLine)) break;
      if (receiptReferenceStopWordRegex.test(nextLine)) break;
      const nextFragments = extractReferenceFragments(nextLine);
      if (nextFragments.length === 0) break;
      mergedFragments.push(...nextFragments);
      const mergedCandidate = normalizeReferenceCandidate(mergedFragments.join(""));
      if (mergedCandidate && mergedCandidate.length >= 8) return mergedCandidate;
    }
  }

  const allMatches = rawText.toUpperCase().match(tokenRegex) || [];
  const scored = allMatches
    .filter((token) => /\d/.test(token))
    .filter((token) => token.length >= 8)
    .sort((a, b) => b.length - a.length);
  return scored[0] || null;
};

const detectPayerName = (rawText: string): string | null => {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const keyedRegex = /\b(account\s*name|sender|from|name)\b\s*[:\-]?\s*([A-Za-z][A-Za-z .,'-]{2,60})$/i;
  for (const line of lines) {
    const match = line.match(keyedRegex);
    if (match?.[2]) return match[2].trim();
  }
  return null;
};

const RECEIPT_PROMO_LINE_REGEX = /\b(?:lazada|shopee|shop\s*now|free\s*shipping|free\s*gift|up\s*to\s*\d+%|voucher|promo|discount|cashback|register\s+and\s+get|score\s+the\s+best\s+deals|gco2e|carbon\s+footprint|transportation,\s*paper,\s*and\s*plastic|eth(?:yl)?\s+alcohol|jilidd)\b/i;
const RECEIPT_TAIL_ANCHOR_REGEX = /\b(?:ref(?:erence)?(?:\s*no\.?)?|transaction(?:\s+date|\s+date\s*&\s*time|\s+time)?|processing\s*time|sent\s+via|total\s+amount|total\s+amount\s+sent|transfer\s+method|transfer\s+amount)\b/i;

const getRelevantReceiptLines = (rawText: string): string[] => {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return lines;

  const filtered: string[] = [];
  let seenTailAnchor = false;
  for (const line of lines) {
    if (RECEIPT_TAIL_ANCHOR_REGEX.test(line)) {
      seenTailAnchor = true;
    }
    if (seenTailAnchor && RECEIPT_PROMO_LINE_REGEX.test(line)) {
      break;
    }
    filtered.push(line);
  }
  return filtered.length > 0 ? filtered : lines;
};

const detectReceiptAmount = (rawText: string): number | null => {
  const lines = getRelevantReceiptLines(rawText);
  const positiveKeywordRegex = /\b(amount|total|paid|payment|grand\s*total|total\s*amount|amount\s*paid|payment\s*amount|transfer\s*amount|total\s*amount\s*sent|transferred)\b/i;
  const strongPositiveKeywordRegex = /\b(total\s*amount\s*sent|transfer\s*amount|total\s*amount|amount\s*paid|transferred)\b/i;
  const negativeKeywordRegex = /\b(balance|available|fee|service\s*fee|charge|discount|cashback|change|before|after)\b/i;
  const amountTokenRegex = /(?:PHP|P|\u20b1)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/gi;
  const standaloneAmountLineRegex = /^-?\s*(?:PHP|P|\u20b1)\s*[0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})\s*$/i;

  const parseAmountToken = (token: string): number | null => {
    const cleaned = token.replace(/[,\s]/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return roundMoney(parsed);
  };

  const getLineCandidates = (line: string): number[] => {
    const candidates: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = amountTokenRegex.exec(line)) !== null) {
      const parsed = parseAmountToken(match[1] || "");
      if (parsed !== null) candidates.push(parsed);
    }
    amountTokenRegex.lastIndex = 0;
    return candidates;
  };

  type Candidate = { value: number; score: number; lineIndex: number };
  const scoredCandidates: Candidate[] = [];
  lines.forEach((line, lineIndex) => {
    const candidates = getLineCandidates(line);
    if (candidates.length === 0) return;
    const hasPositive = positiveKeywordRegex.test(line);
    const hasStrongPositive = strongPositiveKeywordRegex.test(line);
    const hasNegative = negativeKeywordRegex.test(line);
    const hasPromo = RECEIPT_PROMO_LINE_REGEX.test(line);
    const isStandaloneAmountLine = standaloneAmountLineRegex.test(line);
    const isDebitStyleAmountLine = /^-\s*(?:PHP|P|\u20b1)/i.test(line);
    const letterlessAmountLine = line.replace(/(?:PHP|P|\u20b1|[\d,\s.\-])/gi, "").trim().length === 0;
    for (const value of candidates) {
      let score = 0;
      if (hasPositive) score += 5;
      if (hasStrongPositive) score += 4;
      if (/grand\s*total|total\s*amount|amount\s*paid/i.test(line)) score += 2;
      if (/(php|\u20b1|\bpaid\b)/i.test(line)) score += 1;
      if (isStandaloneAmountLine) score += 5;
      if (isDebitStyleAmountLine) score += 2;
      if (letterlessAmountLine) score += 2;
      if (hasNegative) score -= 4;
      if (hasPromo) score -= 8;
      if (lineIndex > Math.floor(lines.length * 0.6) && !hasPositive) score -= 2;
      scoredCandidates.push({ value, score, lineIndex });
    }
  });

  const positiveCandidates = scoredCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.lineIndex - right.lineIndex || right.value - left.value);
  if (positiveCandidates.length > 0) return positiveCandidates[0].value;

  const fallbackCandidates = lines
    .flatMap((line) => getLineCandidates(line))
    .filter((value) => value > 0);
  const uniqueFallbackCandidates = Array.from(new Set(fallbackCandidates));
  if (uniqueFallbackCandidates.length === 1) return uniqueFallbackCandidates[0];
  return null;
};

const extractOcrSpaceText = (payload: any): string => {
  const parsedResults = Array.isArray(payload?.ParsedResults) ? payload.ParsedResults : [];
  const chunks: string[] = [];
  for (const result of parsedResults) {
    const parsedText = String(result?.ParsedText || "").trim();
    if (parsedText) chunks.push(parsedText);
  }
  return normalizeReceiptText(chunks.join("\n"));
};

type ReceiptOcrContext = "account_registration" | "bank_store" | "unknown";

const normalizeReceiptOcrContext = (value: string | null | undefined): ReceiptOcrContext => {
  if (value === "account_registration" || value === "bank_store") return value;
  return "unknown";
};

const validateReceiptOcrFile = (file: File): ReceiptOcrFailureCode | null => {
  const fileName = asString(file.name, 240) || "receipt.jpg";
  const ext = getExtensionFromFileName(fileName);
  const contentType = String(file.type || "").toLowerCase();
  if (!ext || !ACCOUNT_REG_ALLOWED_EXTENSIONS.has(ext)) return "OCR_UNSUPPORTED_EXTENSION";
  if (contentType && !ACCOUNT_REG_ALLOWED_MIME_TYPES.has(contentType)) return "OCR_UNSUPPORTED_MIME";
  if (!Number.isFinite(file.size) || file.size <= 0) return "OCR_INVALID_FILE_SIZE";
  if (file.size > ACCOUNT_REG_MAX_PROOF_BYTES) return "OCR_FILE_TOO_LARGE";
  return null;
};

const shouldRetryReceiptOcr = (errorCode: ReceiptOcrFailureCode | null): boolean =>
  errorCode === "OCR_TIMEOUT"
  || errorCode === "OCR_HTTP_FAILED"
  || errorCode === "OCR_PROVIDER_PROCESSING_ERROR"
  || errorCode === "OCR_EMPTY_TEXT";

const runOcrSpaceAttempt = async (input: {
  file: File;
  fileName: string;
  timeoutMs: number;
  detectOrientation: boolean;
  engine: "1" | "2";
}): Promise<ReceiptOcrAttempt> => {
  const startedAt = Date.now();
  const ocrApiKey = String(Deno.env.get("OCR_SPACE_API_KEY") || "").trim();
  if (!ocrApiKey) {
    return { detected: null, errorCode: "OCR_UNAVAILABLE", provider: null, elapsedMs: Date.now() - startedAt };
  }

  const providerPayload = new FormData();
  providerPayload.append("file", input.file, input.fileName);
  providerPayload.append("language", "eng");
  providerPayload.append("isOverlayRequired", "false");
  providerPayload.append("detectOrientation", input.detectOrientation ? "true" : "false");
  providerPayload.append("scale", "true");
  providerPayload.append("OCREngine", input.engine);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, input.timeoutMs));
  try {
    const response = await fetch(OCR_SPACE_API_URL, {
      method: "POST",
      headers: { apikey: ocrApiKey },
      body: providerPayload,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { detected: null, errorCode: "OCR_HTTP_FAILED", provider: OCR_SPACE_PROVIDER, elapsedMs: Date.now() - startedAt };
    }

    const isErrored = Boolean(payload?.IsErroredOnProcessing);
    const rawText = extractOcrSpaceText(payload);
    if (isErrored && !rawText) {
      return {
        detected: null,
        errorCode: "OCR_PROVIDER_PROCESSING_ERROR",
        provider: OCR_SPACE_PROVIDER,
        elapsedMs: Date.now() - startedAt,
      };
    }
    if (!rawText) {
      return { detected: null, errorCode: "OCR_EMPTY_TEXT", provider: OCR_SPACE_PROVIDER, elapsedMs: Date.now() - startedAt };
    }

    return {
      detected: {
        referenceNo: detectReferenceNo(rawText),
        payerName: detectPayerName(rawText),
        amountPhp: detectReceiptAmount(rawText),
        recipientNumber: detectReceiptRecipientNumber(rawText),
        rawText,
        provider: OCR_SPACE_PROVIDER,
        elapsedMs: Date.now() - startedAt,
      },
      errorCode: null,
      provider: OCR_SPACE_PROVIDER,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    return {
      detected: null,
      errorCode: errorName === "AbortError" ? "OCR_TIMEOUT" : "OCR_FAILED",
      provider: OCR_SPACE_PROVIDER,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const extractReceiptFieldsViaOcr = async (input: {
  file: File;
  context: ReceiptOcrContext;
}): Promise<ReceiptOcrAttempt> => {
  const startedAt = Date.now();
  const ocrApiKey = String(Deno.env.get("OCR_SPACE_API_KEY") || "").trim();
  if (!ocrApiKey) {
    return { detected: null, errorCode: "OCR_UNAVAILABLE", provider: null, elapsedMs: Date.now() - startedAt };
  }

  const file = input.file;
  const fileName = asString(file.name, 240) || "receipt.jpg";
  const validationError = validateReceiptOcrFile(file);
  if (validationError) {
    return { detected: null, errorCode: validationError, provider: null, elapsedMs: Date.now() - startedAt };
  }

  const primaryTimeoutMs = Math.max(1000, RECEIPT_OCR_TIMEOUT_MS);
  const fallbackTimeoutMs = Math.max(primaryTimeoutMs + 6000, Math.round(primaryTimeoutMs * 1.5));
  const attempts = [
    { engine: "2" as const, detectOrientation: true, timeoutMs: primaryTimeoutMs },
    { engine: "1" as const, detectOrientation: false, timeoutMs: fallbackTimeoutMs },
  ];

  let lastAttempt: ReceiptOcrAttempt | null = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = await runOcrSpaceAttempt({
      file,
      fileName,
      timeoutMs: attempts[index].timeoutMs,
      detectOrientation: attempts[index].detectOrientation,
      engine: attempts[index].engine,
    });
    if (attempt.detected) {
      const elapsedMs = Date.now() - startedAt;
      return {
        ...attempt,
        detected: {
          ...attempt.detected,
          elapsedMs,
        },
        elapsedMs,
      };
    }
    lastAttempt = attempt;
    if (index >= attempts.length - 1 || !shouldRetryReceiptOcr(attempt.errorCode)) {
      break;
    }
  }

  return {
    detected: null,
    errorCode: lastAttempt?.errorCode || "OCR_FAILED",
    provider: lastAttempt?.provider || OCR_SPACE_PROVIDER,
    elapsedMs: Date.now() - startedAt,
  };
};

const extractReceiptFieldsFromStoragePath = async (
  admin: ReturnType<typeof createServiceClient>,
  bucket: string,
  path: string,
  context: ReceiptOcrContext,
) : Promise<ReceiptOcrAttempt> => {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) {
    return { detected: null, errorCode: "OCR_STORAGE_DOWNLOAD_FAILED", provider: null, elapsedMs: 0 };
  }
  const ext = getExtensionFromFileName(path) || "jpg";
  const mime = String((data as Blob).type || "").toLowerCase() || "image/jpeg";
  const file = new File([data], `receipt.${ext}`, { type: mime });
  return await extractReceiptFieldsViaOcr({ file, context });
};

const getRegistrationPasswordKey = async (): Promise<CryptoKey> => {
  if (cachedRegistrationPasswordKey) return cachedRegistrationPasswordKey;
  const rawKey = Deno.env.get("ACCOUNT_REG_PASSWORD_KEY_B64") || "";
  if (!rawKey.trim()) throw new Error("Missing ACCOUNT_REG_PASSWORD_KEY_B64");
  const keyBytes = base64ToBytes(rawKey);
  if (![16, 24, 32].includes(keyBytes.length)) {
    throw new Error("ACCOUNT_REG_PASSWORD_KEY_B64 must decode to 16/24/32 bytes");
  }
  cachedRegistrationPasswordKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedRegistrationPasswordKey;
};

const encryptRegistrationPassword = async (
  plaintextPassword: string,
): Promise<{ ciphertext: string; iv: string; keyVersion: number }> => {
  const key = await getRegistrationPasswordKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(plaintextPassword),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    iv: bytesToBase64(iv),
    keyVersion: ACCOUNT_REG_PASSWORD_KEY_VERSION,
  };
};

const decryptRegistrationPassword = async (payload: { ciphertext: string; iv: string }): Promise<string> => {
  const key = await getRegistrationPasswordKey();
  const cipherBytes = base64ToBytes(payload.ciphertext);
  const ivBytes = base64ToBytes(payload.iv);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    cipherBytes,
  );
  return textDecoder.decode(new Uint8Array(plainBuffer));
};

const findAuthUserByEmail = async (
  admin: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<{ id: string; email: string } | null> => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data, error } = await admin
    .schema("auth")
    .from("users")
    .select("id,email")
    .eq("email", normalized)
    .limit(1)
    .maybeSingle();
  if (error || !data?.id || !data?.email) return null;
  return { id: data.id, email: data.email };
};

const getCachedReleaseAsset = (releaseTag: string, assetName: string): CachedReleaseAsset | null => {
  const key = `${releaseTag}:${assetName}`;
  const cached = releaseAssetCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    releaseAssetCache.delete(key);
    return null;
  }
  return cached;
};

const setCachedReleaseAsset = (
  releaseTag: string,
  assetName: string,
  asset: { url: string; size: number; downloadUrl?: string | null },
) => {
  const key = `${releaseTag}:${assetName}`;
  releaseAssetCache.set(key, {
    url: asset.url,
    size: Number(asset.size || 0),
    downloadUrl: asString(asset.downloadUrl, 2000) || null,
    expiresAt: Date.now() + STORE_RELEASE_CACHE_TTL_SECONDS * 1000,
  });
  while (releaseAssetCache.size > STORE_RELEASE_CACHE_MAX_ENTRIES) {
    const oldestKey = releaseAssetCache.keys().next().value;
    if (!oldestKey) break;
    releaseAssetCache.delete(oldestKey);
  }
  if (Math.random() < 0.05) {
    const now = Date.now();
    for (const [k, v] of releaseAssetCache.entries()) {
      if (now > v.expiresAt) releaseAssetCache.delete(k);
    }
  }
};

const getCachedUserIdentity = (userId: string): { display_name: string; email: string } | null => {
  const cached = userIdentityCache.get(userId);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    userIdentityCache.delete(userId);
    return null;
  }
  return { display_name: cached.display_name, email: cached.email };
};

const setCachedUserIdentity = (userId: string, identity: { display_name: string; email: string }) => {
  userIdentityCache.set(userId, {
    display_name: identity.display_name || "",
    email: identity.email || "",
    expiresAt: Date.now() + USER_IDENTITY_CACHE_TTL_SECONDS * 1000,
  });
  while (userIdentityCache.size > USER_IDENTITY_CACHE_MAX_ENTRIES) {
    const oldestKey = userIdentityCache.keys().next().value;
    if (!oldestKey) break;
    userIdentityCache.delete(oldestKey);
  }
  if (Math.random() < 0.02) {
    const now = Date.now();
    for (const [cachedUserId, value] of userIdentityCache.entries()) {
      if (now > value.expiresAt) userIdentityCache.delete(cachedUserId);
    }
  }
};

const normalizeAdminCatalogItem = (item: any) => {
  const bank = getFirstRelationRow(item?.banks);
  return {
    ...item,
    is_pinned: Boolean(item?.is_pinned),
    coming_soon: Boolean(item?.coming_soon),
    status: item?.is_published ? "published" : "draft",
    price_php: resolveCatalogPrice(item),
    bank: {
      title: bank?.title || "Unknown Bank",
      description: asString(bank?.description, 2000) || "",
      color: asString(bank?.color, 40) || "",
    },
  };
};

const normalizeStoreCatalogItem = (
  item: any,
  input: {
    userGrants: Set<string>;
    approvedRequests: Set<string>;
    pendingRequests: Set<string>;
    rejectedRequests: Map<string, string>;
    userId: string | null;
    isAdmin: boolean;
  },
) => {
  const bank = getFirstRelationRow(item?.banks);
  if (!bank || bank.deleted_at) return null;

  const bankId = asString(item?.bank_id, 80) || "";
  const isComingSoon = Boolean(item?.coming_soon);
  let status = "buy";
  let rejectionMessage: string | null = null;
  if (isComingSoon) status = "pending";
  else if (!item?.requires_grant) status = "free_download";
  else if (input.isAdmin) status = "granted_download";
  else if (input.userId) {
    if (input.userGrants.has(bankId) || input.approvedRequests.has(bankId)) status = "granted_download";
    else if (input.pendingRequests.has(bankId)) status = "pending";
    else if (input.rejectedRequests.has(bankId)) {
      status = "rejected";
      rejectionMessage = input.rejectedRequests.get(bankId) || null;
    }
  }

  return {
    id: asString(item?.id, 80) || "",
    bank_id: bankId,
    is_paid: Boolean(item?.is_paid),
    requires_grant: Boolean(item?.requires_grant),
    coming_soon: isComingSoon,
    asset_protection: asString(item?.asset_protection, 40)?.toLowerCase() === "public" ? "public" : "encrypted",
    is_pinned: Boolean(item?.is_pinned),
    is_owned: input.isAdmin || input.userGrants.has(bankId) || input.approvedRequests.has(bankId),
    is_free_download: !item?.requires_grant,
    is_pending: isComingSoon || input.pendingRequests.has(bankId),
    is_rejected: input.rejectedRequests.has(bankId),
    is_downloadable: status === "free_download" || status === "granted_download",
    is_purchased: status === "granted_download",
    price_php: isComingSoon ? null : resolveCatalogPrice(item),
    original_price_php: asPriceNumber(item?.original_price_php),
    discount_amount_php: asPriceNumber(item?.discount_amount_php) || 0,
    promotion_id: asString(item?.promotion_id, 80) || null,
    promotion_name: asString(item?.promotion_name, 200) || null,
    promotion_badge: asString(item?.promotion_badge, 120) || null,
    promotion_type: item?.promotion_type ? normalizePromotionType(item?.promotion_type) : null,
    promotion_starts_at: parseIsoDateTime(item?.promotion_starts_at),
    promotion_ends_at: parseIsoDateTime(item?.promotion_ends_at),
    has_active_promotion: Boolean(item?.has_active_promotion),
    sha256: asString(item?.sha256, 255) || null,
    thumbnail_path: asString(item?.thumbnail_path, 2000) || null,
    status,
    rejection_message: rejectionMessage,
    bank: {
      title: asString(bank?.title, 255) || "Unknown Bank",
      description: asString(bank?.description, 2000) || "",
      color: asString(bank?.color, 40) || "",
    },
  };
};

const normalizeOptionalHttpUrl = (value: unknown): string | null => {
  const raw = asString(value, 2000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeRequiredHttpUrl = (value: unknown): string | null => {
  const normalized = normalizeOptionalHttpUrl(value);
  return normalized || null;
};

const buildStoreApiBaseUrl = (req?: Request): string | null => {
  const explicit = asString(Deno.env.get("APP_SUPABASE_URL") || Deno.env.get("SUPABASE_URL"), 500);
  if (explicit) return `${explicit.replace(/\/+$/, "")}/functions/v1/store-api`;
  if (!req) return null;
  try {
    const url = new URL(req.url);
    const marker = "/functions/v1/store-api";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex >= 0) {
      return `${url.origin}${url.pathname.slice(0, markerIndex + marker.length)}`;
    }
  } catch {
  }
  return null;
};

const buildManagedStoreAssetUrl = (objectKey: string, req?: Request): string | null => {
  const baseUrl = buildStoreApiBaseUrl(req);
  if (!baseUrl) return null;
  return `${baseUrl}/asset?path=${encodeURIComponent(objectKey)}`;
};

type ManagedStoreAssetKind = "thumbnail" | "qr" | "banner";

const sanitizeManagedAssetExt = (value: string | null | undefined, fallback: string): string => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return fallback;
  return normalized.slice(0, 10);
};

const normalizeManagedStoreAssetKind = (value: unknown): ManagedStoreAssetKind | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "thumbnail") return "thumbnail";
  if (normalized === "qr") return "qr";
  if (normalized === "banner") return "banner";
  return null;
};

const buildManagedStoreAssetObjectKey = (input: {
  kind: ManagedStoreAssetKind;
  fileName?: string | null;
  bankId?: string | null;
}): string => {
  const extFromName = (() => {
    const fileName = String(input.fileName || "").trim();
    if (!fileName.includes(".")) return null;
    return fileName.split(".").pop() || null;
  })();
  const ext = sanitizeManagedAssetExt(extFromName, "webp");
  const suffix = crypto.randomUUID().slice(0, 8);
  if (input.kind === "thumbnail") {
    const bankId = asUuid(input.bankId) || "";
    if (!bankId) throw new Error("bankId is required for thumbnail uploads");
    return `bank-thumbnails/${bankId}/${Date.now()}-${suffix}.${ext}`;
  }
  if (input.kind === "qr") {
    return `payment-qr/${Date.now()}-${suffix}.${ext}`;
  }
  return `store-banners/${Date.now()}-${suffix}.${ext}`;
};

const ensureStoreAssetUploadReady = (): string | null => {
  if (!R2_BUCKET) return "R2_BUCKET_NOT_CONFIGURED";
  return null;
};

const normalizeBannerRotationMs = (value: unknown): number | null => {
  if (value === null || value === "" || typeof value === "undefined") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  if (rounded < STORE_BANNER_ROTATION_MIN_MS || rounded > STORE_BANNER_ROTATION_MAX_MS) return null;
  return rounded;
};

type PromotionType = "standard" | "flash_sale";
type PromotionDiscountType = "percent" | "fixed";
type PromotionTargetType = "catalog" | "bank";

type PromotionRow = {
  id: string;
  name: string;
  description: string | null;
  promotion_type: PromotionType;
  discount_type: PromotionDiscountType;
  discount_value: number;
  starts_at: string;
  ends_at: string;
  timezone: string;
  badge_text: string | null;
  priority: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

type PromotionTargetRow = {
  id: string;
  promotion_id: string;
  bank_id: string | null;
  catalog_item_id: string | null;
};

type ResolvedPromotion = {
  promotion: PromotionRow;
  targetType: PromotionTargetType;
  originalPricePhp: number;
  discountAmountPhp: number;
  effectivePricePhp: number;
};

const normalizePromotionType = (value: unknown): PromotionType => {
  return String(value || "").trim().toLowerCase() === "flash_sale" ? "flash_sale" : "standard";
};

const normalizePromotionDiscountType = (value: unknown): PromotionDiscountType => {
  return String(value || "").trim().toLowerCase() === "fixed" ? "fixed" : "percent";
};

const parseIsoDateTime = (value: unknown): string | null => {
  const raw = asString(value, 120);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const mapPromotionRow = (row: any): PromotionRow => ({
  id: asString(row?.id, 80) || "",
  name: asString(row?.name, 200) || "Untitled Promotion",
  description: asString(row?.description, 2000) || null,
  promotion_type: normalizePromotionType(row?.promotion_type),
  discount_type: normalizePromotionDiscountType(row?.discount_type),
  discount_value: roundMoney(Math.max(0, Number(row?.discount_value || 0))),
  starts_at: parseIsoDateTime(row?.starts_at) || new Date(0).toISOString(),
  ends_at: parseIsoDateTime(row?.ends_at) || new Date(0).toISOString(),
  timezone: asString(row?.timezone, 120) || AUTO_APPROVAL_TIMEZONE,
  badge_text: asString(row?.badge_text, 120) || null,
  priority: Math.max(0, Math.floor(Number(row?.priority || 0))),
  is_active: Boolean(row?.is_active),
  created_at: parseIsoDateTime(row?.created_at),
  updated_at: parseIsoDateTime(row?.updated_at),
  created_by: asUuid(row?.created_by),
  updated_by: asUuid(row?.updated_by),
});

const mapPromotionTargetRow = (row: any): PromotionTargetRow => ({
  id: asString(row?.id, 80) || "",
  promotion_id: asString(row?.promotion_id, 80) || "",
  bank_id: asUuid(row?.bank_id),
  catalog_item_id: asUuid(row?.catalog_item_id),
});

const getPromotionLifecycleStatus = (promotion: PromotionRow, nowIso = new Date().toISOString()): "inactive" | "scheduled" | "active" | "expired" => {
  if (!promotion.is_active) return "inactive";
  if (promotion.starts_at > nowIso) return "scheduled";
  if (promotion.ends_at <= nowIso) return "expired";
  return "active";
};

const resolvePromotionDiscount = (basePrice: number, promotion: PromotionRow): { discountAmountPhp: number; effectivePricePhp: number } | null => {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return null;
  let discountAmountPhp = promotion.discount_type === "fixed"
    ? roundMoney(promotion.discount_value)
    : roundMoney(basePrice * (promotion.discount_value / 100));
  if (!Number.isFinite(discountAmountPhp) || discountAmountPhp <= 0) return null;
  if (discountAmountPhp >= basePrice) return null;
  const effectivePricePhp = roundMoney(basePrice - discountAmountPhp);
  if (!Number.isFinite(effectivePricePhp) || effectivePricePhp <= 0) return null;
  return { discountAmountPhp, effectivePricePhp };
};

const buildPromotionSnapshot = (resolved: ResolvedPromotion | null): Record<string, unknown> | null => {
  if (!resolved) return null;
  return {
    id: resolved.promotion.id,
    name: resolved.promotion.name,
    promotion_type: resolved.promotion.promotion_type,
    discount_type: resolved.promotion.discount_type,
    discount_value: resolved.promotion.discount_value,
    badge_text: resolved.promotion.badge_text,
    priority: resolved.promotion.priority,
    starts_at: resolved.promotion.starts_at,
    ends_at: resolved.promotion.ends_at,
    timezone: resolved.promotion.timezone,
    target_type: resolved.targetType,
    original_price_php: resolved.originalPricePhp,
    discount_amount_php: resolved.discountAmountPhp,
    final_price_php: resolved.effectivePricePhp,
  };
};

const comparePromotionCandidates = (left: ResolvedPromotion, right: ResolvedPromotion): number => {
  if (left.promotion.priority !== right.promotion.priority) return right.promotion.priority - left.promotion.priority;
  if (left.targetType !== right.targetType) return left.targetType === "catalog" ? -1 : 1;
  if (left.promotion.promotion_type !== right.promotion.promotion_type) {
    return left.promotion.promotion_type === "flash_sale" ? -1 : 1;
  }
  if (left.discountAmountPhp !== right.discountAmountPhp) return right.discountAmountPhp - left.discountAmountPhp;
  return String(right.promotion.created_at || "").localeCompare(String(left.promotion.created_at || ""));
};

const resolvePromotionForCatalogItem = (
  item: any,
  promotions: PromotionRow[],
  targetsByPromotionId: Map<string, PromotionTargetRow[]>,
  nowIso = new Date().toISOString(),
): ResolvedPromotion | null => {
  const catalogItemId = asString(item?.id, 80) || "";
  const bankId = asString(item?.bank_id, 80) || "";
  const basePrice = resolveCatalogPrice(item);
  if (!catalogItemId || !bankId || basePrice === null || basePrice <= 0 || !item?.is_paid) return null;

  const candidates: ResolvedPromotion[] = [];
  for (const promotion of promotions) {
    if (getPromotionLifecycleStatus(promotion, nowIso) !== "active") continue;
    const targets = targetsByPromotionId.get(promotion.id) || [];
    let targetType: PromotionTargetType | null = null;
    for (const target of targets) {
      if (target.catalog_item_id && target.catalog_item_id === catalogItemId) {
        targetType = "catalog";
        break;
      }
      if (!targetType && target.bank_id && target.bank_id === bankId) {
        targetType = "bank";
      }
    }
    if (!targetType) continue;
    const pricing = resolvePromotionDiscount(basePrice, promotion);
    if (!pricing) continue;
    candidates.push({
      promotion,
      targetType,
      originalPricePhp: basePrice,
      discountAmountPhp: pricing.discountAmountPhp,
      effectivePricePhp: pricing.effectivePricePhp,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort(comparePromotionCandidates);
  return candidates[0];
};

const attachPromotionToCatalogItem = (
  item: any,
  resolvedPromotion: ResolvedPromotion | null,
) => {
  const originalPricePhp = resolveCatalogPrice(item);
  if (!resolvedPromotion) {
    return {
      ...item,
      original_price_php: originalPricePhp,
      discount_amount_php: 0,
      promotion_id: null,
      promotion_name: null,
      promotion_badge: null,
      promotion_type: null,
      promotion_starts_at: null,
      promotion_ends_at: null,
      has_active_promotion: false,
    };
  }
  return {
    ...item,
    price_php: resolvedPromotion.effectivePricePhp,
    original_price_php: resolvedPromotion.originalPricePhp,
    discount_amount_php: resolvedPromotion.discountAmountPhp,
    promotion_id: resolvedPromotion.promotion.id,
    promotion_name: resolvedPromotion.promotion.name,
    promotion_badge: resolvedPromotion.promotion.badge_text || resolvedPromotion.promotion.name,
    promotion_type: resolvedPromotion.promotion.promotion_type,
    promotion_starts_at: resolvedPromotion.promotion.starts_at,
    promotion_ends_at: resolvedPromotion.promotion.ends_at,
    has_active_promotion: true,
  };
};

const loadPromotionTargetsByPromotionId = async (
  admin: ReturnType<typeof createServiceClient>,
  promotionIds: string[],
): Promise<Map<string, PromotionTargetRow[]>> => {
  const byPromotionId = new Map<string, PromotionTargetRow[]>();
  if (promotionIds.length === 0) return byPromotionId;
  const { data, error } = await admin
    .from("store_promotion_targets")
    .select("id,promotion_id,bank_id,catalog_item_id")
    .in("promotion_id", promotionIds);
  if (error) {
    if (/store_promotion_targets/i.test(error.message || "")) return byPromotionId;
    throw new Error(error.message);
  }
  for (const row of data || []) {
    const mapped = mapPromotionTargetRow(row);
    if (!mapped.promotion_id) continue;
    const current = byPromotionId.get(mapped.promotion_id) || [];
    current.push(mapped);
    byPromotionId.set(mapped.promotion_id, current);
  }
  return byPromotionId;
};

const resolvePromotionsForCatalogItems = async (
  admin: ReturnType<typeof createServiceClient>,
  items: any[],
  options?: { nowIso?: string; includeInactive?: boolean },
): Promise<Map<string, ResolvedPromotion>> => {
  const resolved = new Map<string, ResolvedPromotion>();
  if (!Array.isArray(items) || items.length === 0) return resolved;
  const nowIso = options?.nowIso || new Date().toISOString();
  let query: any = admin
    .from("store_promotions")
    .select("id,name,description,promotion_type,discount_type,discount_value,starts_at,ends_at,timezone,badge_text,priority,is_active,created_at,updated_at,created_by,updated_by");
  if (!options?.includeInactive) {
    query = query.eq("is_active", true).lte("starts_at", nowIso).gt("ends_at", nowIso);
  }
  const { data, error } = await query;
  if (error) {
    if (/store_promotions/i.test(error.message || "")) return resolved;
    throw new Error(error.message);
  }
  const promotions = (data || []).map(mapPromotionRow);
  if (promotions.length === 0) return resolved;
  const targetsByPromotionId = await loadPromotionTargetsByPromotionId(admin, promotions.map((promotion) => promotion.id));
  for (const item of items) {
    const itemId = asString(item?.id, 80);
    if (!itemId) continue;
    const chosen = resolvePromotionForCatalogItem(item, promotions, targetsByPromotionId, nowIso);
    if (chosen) resolved.set(itemId, chosen);
  }
  return resolved;
};

const normalizePromotionTargetLists = (body: any): { bankIds: string[]; catalogItemIds: string[] } => {
  const rawBankIds = Array.isArray(body?.target_bank_ids) ? body.target_bank_ids : body?.targetBankIds;
  const rawCatalogItemIds = Array.isArray(body?.target_catalog_item_ids) ? body.target_catalog_item_ids : body?.targetCatalogItemIds;
  const bankIds = Array.from(new Set((Array.isArray(rawBankIds) ? rawBankIds : []).map((value) => asUuid(value)).filter(Boolean) as string[]));
  const catalogItemIds = Array.from(new Set((Array.isArray(rawCatalogItemIds) ? rawCatalogItemIds : []).map((value) => asUuid(value)).filter(Boolean) as string[]));
  return { bankIds, catalogItemIds };
};

const validatePromotionDefinition = async (
  admin: ReturnType<typeof createServiceClient>,
  input: {
    promotionType: PromotionType;
    discountType: PromotionDiscountType;
    discountValue: number;
    startsAt: string;
    endsAt: string;
    bankIds: string[];
    catalogItemIds: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!input.startsAt || !input.endsAt) return { ok: false, error: "starts_at and ends_at are required" };
  if (input.endsAt <= input.startsAt) return { ok: false, error: "ends_at must be after starts_at" };
  if (input.discountType === "percent" && (!(input.discountValue > 0) || input.discountValue >= 100)) {
    return { ok: false, error: "Percent discounts must be greater than 0 and less than 100" };
  }
  if (input.discountType === "fixed" && !(input.discountValue > 0)) {
    return { ok: false, error: "Fixed discounts must be greater than 0" };
  }
  if (input.bankIds.length === 0 && input.catalogItemIds.length === 0) {
    return { ok: false, error: "Select at least one bank or catalog item target" };
  }

  const catalogRowsById = new Map<string, any>();
  if (input.catalogItemIds.length > 0) {
    const { data, error } = await admin
      .from("bank_catalog_items")
      .select("id,bank_id,is_paid,price_label,price_php")
      .in("id", input.catalogItemIds);
    if (error) return { ok: false, error: error.message };
    for (const row of data || []) catalogRowsById.set(String(row.id), row);
  }

  if (input.bankIds.length > 0) {
    const { data, error } = await admin
      .from("bank_catalog_items")
      .select("id,bank_id,is_paid,price_label,price_php")
      .in("bank_id", input.bankIds);
    if (error) return { ok: false, error: error.message };
    for (const row of data || []) {
      const rowId = String(row.id || "");
      if (rowId) catalogRowsById.set(rowId, row);
    }
  }

  const candidateRows = Array.from(catalogRowsById.values()).filter((row) => Boolean(row?.is_paid));
  if (candidateRows.length === 0) {
    return { ok: false, error: "Promotion targets must include at least one paid catalog item" };
  }

  for (const row of candidateRows) {
    const basePrice = resolveCatalogPrice(row);
    if (basePrice === null || basePrice <= 0) {
      return { ok: false, error: "Promotion targets cannot include paid catalog items without a valid price" };
    }
    const pricing = resolvePromotionDiscount(basePrice, {
      id: "",
      name: "",
      description: null,
      promotion_type: input.promotionType,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      timezone: AUTO_APPROVAL_TIMEZONE,
      badge_text: null,
      priority: 0,
      is_active: true,
      created_at: null,
      updated_at: null,
      created_by: null,
      updated_by: null,
    });
    if (!pricing) {
      return { ok: false, error: "Discount value is too large for one or more targeted catalog items" };
    }
  }

  return { ok: true };
};

const loadAdminPromotionRows = async (
  admin: ReturnType<typeof createServiceClient>,
): Promise<{ promotions: PromotionRow[]; targetsByPromotionId: Map<string, PromotionTargetRow[]> }> => {
  const { data, error } = await admin
    .from("store_promotions")
    .select("id,name,description,promotion_type,discount_type,discount_value,starts_at,ends_at,timezone,badge_text,priority,is_active,created_at,updated_at,created_by,updated_by")
    .order("created_at", { ascending: false });
  if (error) {
    if (/store_promotions/i.test(error.message || "")) {
      return { promotions: [], targetsByPromotionId: new Map<string, PromotionTargetRow[]>() };
    }
    throw new Error(error.message);
  }
  const promotions = (data || []).map(mapPromotionRow);
  const targetsByPromotionId = await loadPromotionTargetsByPromotionId(admin, promotions.map((promotion) => promotion.id));
  return { promotions, targetsByPromotionId };
};

const STORE_ASSETS_BUCKET = "store-assets";

const extractManagedStoreAssetReference = (value: unknown): { provider: "supabase" | "r2"; objectPath: string } | null => {
  const normalized = normalizeOptionalHttpUrl(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    const publicPrefix = `/storage/v1/object/public/${STORE_ASSETS_BUCKET}/`;
    const renderPrefix = `/storage/v1/render/image/public/${STORE_ASSETS_BUCKET}/`;
    if (parsed.pathname.includes(publicPrefix) || parsed.pathname.includes(renderPrefix)) {
      const marker = parsed.pathname.includes(publicPrefix) ? publicPrefix : renderPrefix;
      const objectPath = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length)).replace(/^\/+/, "");
      return objectPath ? { provider: "supabase", objectPath } : null;
    }
    if (parsed.pathname.endsWith("/store-api/asset")) {
      const objectPath = decodeURIComponent(parsed.searchParams.get("path") || "").replace(/^\/+/, "");
      return objectPath ? { provider: "r2", objectPath } : null;
    }
  } catch {
  }
  return null;
};

const deleteManagedStoreAsset = async (
  admin: ReturnType<typeof createServiceClient>,
  imageUrl: unknown,
): Promise<string | null> => {
  const reference = extractManagedStoreAssetReference(imageUrl);
  if (!reference) return null;
  if (reference.provider === "supabase") {
    const { error } = await admin.storage.from(STORE_ASSETS_BUCKET).remove([reference.objectPath]);
    if (!error) return null;
    const message = String(error.message || "");
    if (/not found|does not exist|no such object/i.test(message)) return null;
    return message || "Unknown cleanup error";
  }
  try {
    await deleteObject(R2_BUCKET, reference.objectPath);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/404/.test(message)) return null;
    return message || "Unknown cleanup error";
  }
};

const extractOwnedBankThumbnailPath = (bankId: unknown, imageUrl: unknown): string | null => {
  const normalizedBankId = asString(bankId, 80);
  if (!normalizedBankId) return null;
  const objectPath = extractManagedStoreAssetReference(imageUrl)?.objectPath;
  if (!objectPath) return null;
  const expectedPrefix = `bank-thumbnails/${normalizedBankId}/`;
  if (!objectPath.startsWith(expectedPrefix)) return null;
  return objectPath;
};

const getManagedStoreAsset = async (req: Request): Promise<Response> => {
  const objectPath = decodeURIComponent(String(new URL(req.url).searchParams.get("path") || "")).replace(/^\/+/, "");
  if (!objectPath) return badRequest("Missing asset path");
  const signed = await createPresignedGetUrl(R2_BUCKET, objectPath, STORE_R2_SIGNED_DOWNLOAD_TTL_SECONDS);
  const headers = new Headers({
    ...buildCorsHeaders(req),
    "Cache-Control": "public, max-age=300",
    "Location": signed.url,
    "X-Store-Asset-Mode": "redirect",
  });
  headers.set("Access-Control-Expose-Headers", "Location, X-Store-Asset-Mode");
  return new Response(null, { status: 302, headers });
};

const createAdminStoreAssetUpload = async (req: Request, body: any) => {
  const adminCheck = await requireAdmin(req);
  if (!adminCheck.ok) return adminCheck.response;
  const kind = normalizeManagedStoreAssetKind(body?.kind ?? body?.assetKind);
  if (!kind) return badRequest("Invalid asset kind");
  const fileName = asString(body?.fileName ?? body?.file_name, 255) || null;
  const contentType = asString(body?.contentType ?? body?.content_type, 200) || "application/octet-stream";
  const fileSize = Number(body?.fileSize ?? body?.file_size ?? 0);
  const bankId = kind === "thumbnail" ? asUuid(body?.bankId ?? body?.bank_id) : null;
  if (kind === "thumbnail" && !bankId) return badRequest("bankId is required for thumbnail uploads");
  if (!Number.isFinite(fileSize) || fileSize <= 0) return badRequest("Missing or invalid fileSize");
  if (fileSize > STORE_MANAGED_ASSET_MAX_BYTES) {
    return fail(413, "FILE_TOO_LARGE", { max_bytes: STORE_MANAGED_ASSET_MAX_BYTES, asset_bytes: fileSize });
  }
  const r2Error = ensureStoreAssetUploadReady();
  if (r2Error) return fail(500, r2Error);
  const objectKey = buildManagedStoreAssetObjectKey({ kind, fileName, bankId });
  const upload = await createPresignedPutUrl(R2_BUCKET, objectKey, R2_UPLOAD_URL_TTL_SECONDS, contentType);
  const assetUrl = buildManagedStoreAssetUrl(objectKey, req);
  if (!assetUrl) return fail(500, "STORE_ASSET_URL_UNAVAILABLE");
  return ok({
    mode: "r2_direct",
    kind,
    uploadUrl: upload.url,
    uploadMethod: "PUT",
    uploadHeaders: upload.headers,
    bucket: R2_BUCKET,
    objectKey,
    assetUrl,
    urlExpiresAt: upload.expiresAt,
  });
};

const deleteAdminStoreAsset = async (req: Request, body: any) => {
  const adminCheck = await requireAdmin(req);
  if (!adminCheck.ok) return adminCheck.response;
  const objectKey =
    asString(body?.objectKey ?? body?.object_key, 2000)
    || extractManagedStoreAssetReference(body?.assetUrl ?? body?.asset_url)?.objectPath
    || "";
  if (!objectKey) return badRequest("Missing asset reference");
  try {
    await deleteObject(R2_BUCKET, objectKey);
    return ok({ deleted: true, objectKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/404/.test(message)) return ok({ deleted: false, objectKey });
    return fail(500, message || "STORE_ASSET_DELETE_FAILED");
  }
};

const toNonNegativeSortOrder = (value: unknown, fallback = 0): number => {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const normalizeMarketingBannerRow = (row: any) => ({
  id: String(row?.id || ""),
  image_url: String(row?.image_url || ""),
  link_url: row?.link_url ? String(row.link_url) : null,
  sort_order: toNonNegativeSortOrder(row?.sort_order, 0),
  is_active: Boolean(row?.is_active),
  created_at: String(row?.created_at || ""),
  updated_at: String(row?.updated_at || ""),
});

const listMarketingBanners = async (
  admin: ReturnType<typeof createServiceClient>,
  input: { includeInactive?: boolean; cap?: number } = {},
): Promise<{ ok: true; banners: any[] } | { ok: false; response: Response }> => {
  const includeInactive = Boolean(input.includeInactive);
  const cap = Math.max(1, Math.min(100, Number(input.cap || STORE_MARKETING_BANNER_MAX_ACTIVE)));
  let query = admin
    .from("store_marketing_banners")
    .select("id,image_url,link_url,sort_order,is_active,created_at,updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (!includeInactive) query = query.eq("is_active", true).limit(cap);
  const { data, error } = await query;
  if (error) return { ok: false, response: fail(500, error.message) };
  return { ok: true, banners: (data || []).map(normalizeMarketingBannerRow) };
};

const buildUserIdentityMap = async (
  admin: ReturnType<typeof createServiceClient>,
  userIds: string[],
): Promise<Record<string, { display_name: string; email: string }>> => {
  const profileMap: Record<string, { display_name: string; email: string }> = {};
  if (!userIds.length) return profileMap;
  const unresolvedUserIds: string[] = [];

  for (const userId of userIds) {
    const cached = getCachedUserIdentity(userId);
    if (cached) {
      profileMap[userId] = cached;
      continue;
    }
    unresolvedUserIds.push(userId);
  }

  if (!unresolvedUserIds.length) return profileMap;

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", unresolvedUserIds);
  if (profileError) throw new Error(profileError.message);

  (profiles || []).forEach((p: any) => {
    profileMap[p.id] = { display_name: p.display_name || "", email: "" };
  });

  await Promise.all(
    unresolvedUserIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data?.user) return;
      if (!profileMap[userId]) profileMap[userId] = { display_name: "", email: "" };
      profileMap[userId].email = data.user.email || "";
    }),
  );

  unresolvedUserIds.forEach((userId) => {
    const identity = profileMap[userId] || { display_name: "", email: "" };
    profileMap[userId] = identity;
    setCachedUserIdentity(userId, identity);
  });

  return profileMap;
};

const getStoreCatalog = async (req: Request) => {
  const admin = createServiceClient();
  const catalogStartedAt = Date.now();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(60, Number(url.searchParams.get("perPage") || 24)));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  const q = asString(url.searchParams.get("q"), 120);
  const includeBanners = url.searchParams.get("includeBanners") !== "0";
  const includeCount = url.searchParams.get("includeCount") !== "0";
  const selectOptions = includeCount ? ({ count: "exact" } as const) : undefined;
  const requestedSort = String(url.searchParams.get("sort") || "default").toLowerCase();
  const sort =
    requestedSort === "default" ||
      requestedSort === "name_desc" ||
      requestedSort === "price_low" ||
      requestedSort === "price_high" ||
      requestedSort === "free_first" ||
      requestedSort === "free_download" ||
      requestedSort === "purchased"
      ? requestedSort
      : "name_asc";
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  const userId = user?.id || null;
  const userIsAdmin = userId ? await isAdminUser(userId) : false;
  const maintenanceState = await getStoreMaintenanceState(req, admin);
  if ("response" in maintenanceState) return maintenanceState.response;
  if (maintenanceState.enabled && !maintenanceState.isAdmin) {
    return ok({
      items: [],
      banners: [],
      page,
      perPage,
      total: 0,
      totalPages: 1,
      sort,
      q: q || "",
      maintenance: {
        enabled: true,
        message: maintenanceState.message,
      },
      meta: {
        durationMs: Date.now() - catalogStartedAt,
        strategy: "maintenance_mode",
        itemCount: 0,
        total: 0,
      },
    });
  }
  let banners: any[] = [];
  let strategy = "standard";
  if (includeBanners) {
    const bannersResult = await listMarketingBanners(admin, { includeInactive: false, cap: STORE_MARKETING_BANNER_MAX_ACTIVE });
    if (!bannersResult.ok) return bannersResult.response;
    banners = bannersResult.banners;
  }

  let purchasedBankIds: string[] = [];
  if (sort === "purchased" || sort === "default") {
    if (!userId && sort === "purchased") {
      return ok({
        items: [],
        banners,
        page,
        perPage,
        total: 0,
        totalPages: 1,
        sort,
        q: q || "",
      });
    }
    if (userId) {
      const [accessResult, approvedResult] = await Promise.all([
        admin.from("user_bank_access").select("bank_id").eq("user_id", userId),
        admin.from("bank_purchase_requests").select("bank_id").eq("user_id", userId).eq("status", "approved"),
      ]);
      const purchasedSet = new Set<string>();
      (accessResult.data || []).forEach((row: any) => {
        const bankId = asString(row?.bank_id, 80);
        if (bankId) purchasedSet.add(bankId);
      });
      (approvedResult.data || []).forEach((row: any) => {
        const bankId = asString(row?.bank_id, 80);
        if (bankId) purchasedSet.add(bankId);
      });
      purchasedBankIds = Array.from(purchasedSet);
    }
    if (sort === "purchased" && purchasedBankIds.length === 0) {
      return ok({
        items: [],
        banners,
        page,
        perPage,
        total: 0,
        totalPages: 1,
        sort,
        q: q || "",
      });
    }
  }

  const catalogSelect =
    "id,bank_id,is_paid,requires_grant,asset_protection,price_label,price_php,sha256,thumbnail_path,is_pinned,banks ( title, description, color, deleted_at )";
  const applyCatalogSearch = (query: any): any => {
    if (!q) return query;
    const escaped = q.replace(/[,%_]/g, "");
    return query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`, { foreignTable: "banks" });
  };

  let catalogQuery: any = admin
    .from("bank_catalog_items")
    .select(catalogSelect)
    .eq("is_published", true);
  if (sort === "purchased" && purchasedBankIds.length > 0) {
    catalogQuery = catalogQuery.in("bank_id", purchasedBankIds);
  }
  catalogQuery = applyCatalogSearch(catalogQuery);
  catalogQuery = catalogQuery.order("created_at", { ascending: false });

  let { data: catalogItems, error: catalogError } = await catalogQuery;
  if (catalogError && /is_pinned/i.test(catalogError.message || "")) {
      const fallback = await applyCatalogSearch(
      admin
        .from("bank_catalog_items")
        .select("id,bank_id,is_paid,requires_grant,asset_protection,price_label,price_php,sha256,thumbnail_path,banks ( title, description, color, deleted_at )")
        .eq("is_published", true)
        .order("created_at", { ascending: false }),
    );
    catalogItems = fallback.data;
    catalogError = fallback.error;
  }
  if (catalogError) return fail(500, catalogError.message);

  let userGrants = new Set<string>();
  let pendingRequests = new Set<string>();
  let approvedRequests = new Set<string>();
  const rejectedRequests = new Map<string, string>();
  const catalogBankIds = Array.from(new Set((catalogItems || []).map((item: any) => asString(item?.bank_id, 80)).filter(Boolean) as string[]));
  if (userId && catalogBankIds.length > 0) {
    const [accessDataResult, requestDataResult] = await Promise.all([
      admin.from("user_bank_access").select("bank_id").eq("user_id", userId).in("bank_id", catalogBankIds),
      admin
        .from("bank_purchase_requests")
        .select("bank_id,status,rejection_message")
        .eq("user_id", userId)
        .in("bank_id", catalogBankIds),
    ]);
    if (accessDataResult.data) userGrants = new Set(accessDataResult.data.map((row: any) => row.bank_id));
    (requestDataResult.data || []).forEach((row: any) => {
      if (row.status === "pending") pendingRequests.add(row.bank_id);
      if (row.status === "approved") approvedRequests.add(row.bank_id);
      if (row.status === "rejected") rejectedRequests.set(row.bank_id, row.rejection_message || "");
    });
  }

  const promotionMap = await resolvePromotionsForCatalogItems(admin, catalogItems || []);
  let items = (catalogItems || [])
    .map((item: any) => {
      const itemId = asString(item?.id, 80) || "";
      const enriched = attachPromotionToCatalogItem(item, promotionMap.get(itemId) || null);
      return normalizeStoreCatalogItem(enriched, {
        userGrants,
        approvedRequests,
        pendingRequests,
        rejectedRequests,
        userId,
        isAdmin: userIsAdmin,
      });
    })
    .filter(Boolean) as any[];

  const compareTitle = (left: any, right: any, direction: "asc" | "desc" = "asc") => {
    const leftTitle = String(left?.bank?.title || "");
    const rightTitle = String(right?.bank?.title || "");
    const leftKey = normalizeCatalogTitleSortKey(leftTitle);
    const rightKey = normalizeCatalogTitleSortKey(rightTitle);
    const primary = titleSortCollator.compare(leftKey, rightKey);
    if (primary !== 0) return direction === "asc" ? primary : -primary;
    const secondary = titleSortCollator.compare(leftTitle, rightTitle);
    return direction === "asc" ? secondary : -secondary;
  };
  const comparePrice = (left: any, right: any, direction: "asc" | "desc") => {
    const leftPrice = left?.is_paid ? (typeof left?.price_php === "number" ? left.price_php : null) : 0;
    const rightPrice = right?.is_paid ? (typeof right?.price_php === "number" ? right.price_php : null) : 0;
    if (leftPrice === null && rightPrice === null) return compareTitle(left, right, "asc");
    if (leftPrice === null) return 1;
    if (rightPrice === null) return -1;
    if (leftPrice !== rightPrice) return direction === "asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
    return compareTitle(left, right, "asc");
  };

  if (sort === "free_download") {
    items = items.filter((item) => item.status === "free_download");
    items.sort((left, right) => compareTitle(left, right, "asc"));
    strategy = "filtered_free_download";
  } else if (sort === "purchased") {
    items = items.filter((item) => item.status === "granted_download");
    items.sort((left, right) => compareTitle(left, right, "asc"));
    strategy = "filtered_purchased";
  } else if (sort === "name_asc") {
    items.sort((left, right) => compareTitle(left, right, "asc"));
    strategy = "name_asc_memory";
  } else if (sort === "name_desc") {
    items.sort((left, right) => compareTitle(left, right, "desc"));
    strategy = "name_desc_memory";
  } else if (sort === "price_low") {
    items.sort((left, right) => {
      if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
      return comparePrice(left, right, "asc");
    });
    strategy = "price_low_memory";
  } else if (sort === "price_high") {
    items.sort((left, right) => {
      if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
      return comparePrice(left, right, "desc");
    });
    strategy = "price_high_memory";
  } else if (sort === "free_first") {
    items.sort((left, right) => {
      const leftRank = left.status === "free_download" ? 0 : 1;
      const rightRank = right.status === "free_download" ? 0 : 1;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
      return compareTitle(left, right, "asc");
    });
    strategy = "free_first_memory";
  } else {
    items.sort((left, right) => {
      const leftRank = left.is_pinned ? 0 : left.status === "granted_download" ? 1 : 2;
      const rightRank = right.is_pinned ? 0 : right.status === "granted_download" ? 1 : 2;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return compareTitle(left, right, "asc");
    });
    strategy = "bucketed_default_memory";
  }

  const total = includeCount ? items.length : null;
  const pagedItems = items.slice(from, to + 1);
  return ok({
    items: pagedItems,
    banners,
    page,
    perPage,
    total,
    totalPages: includeCount ? Math.max(1, Math.ceil(Number(total || 0) / perPage)) : null,
    sort,
    q: q || "",
    maintenance: {
      enabled: false,
      message: null,
    },
    meta: {
      durationMs: Date.now() - catalogStartedAt,
      strategy,
      itemCount: items.length,
      total,
    },
  });
};

const getStorePaymentConfig = async (req: Request) => {
  const admin = createServiceClient();
  const maintenanceState = await getStoreMaintenanceState(req, admin);
  if ("response" in maintenanceState) return maintenanceState.response;
  const { data: config, error } = await admin
    .from("store_payment_settings")
    .select("instructions,gcash_number,maya_number,messenger_url,qr_image_path,account_price_php,banner_rotation_ms,store_maintenance_enabled,store_maintenance_message")
    .eq("id", "default")
    .eq("is_active", true)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!config) return ok({ config: null });
  return ok({
    config: {
      instructions: asString((config as any)?.instructions, 4000) || "",
      gcash_number: asString((config as any)?.gcash_number, 120) || "",
      maya_number: asString((config as any)?.maya_number, 120) || "",
      messenger_url: asString((config as any)?.messenger_url, 2000) || "",
      qr_image_path: asString((config as any)?.qr_image_path, 2000) || "",
      account_price_php: asPriceNumber((config as any)?.account_price_php),
      banner_rotation_ms: normalizeBannerRotationMs((config as any)?.banner_rotation_ms) ?? STORE_BANNER_ROTATION_DEFAULT_MS,
      store_maintenance_enabled: Boolean((config as any)?.store_maintenance_enabled),
      store_maintenance_message: asString((config as any)?.store_maintenance_message, 2000) || "",
    },
    maintenance: {
      enabled: maintenanceState.enabled,
      message: maintenanceState.message,
    },
  });
};

const LANDING_VERSION_KEYS = ["V1", "V2", "V3"] as const;
const LANDING_PLATFORM_KEYS = ["android", "ios", "windows", "macos"] as const;
const DEFAULT_LANDING_DOWNLOAD_LINKS = {
  V1: {
    android: "/android/",
    ios: "/ios/",
    windows: "https://m.me/vdjvsampler/",
    macos: "https://m.me/vdjvsampler/",
  },
  V2: {
    android: "https://m.me/vdjvsampler/",
    ios: "https://apps.apple.com/us/app/virtualdj-remote/id407160120",
    windows: "https://m.me/vdjvsampler/",
    macos: "https://m.me/vdjvsampler/",
  },
  V3: {
    android: "https://m.me/vdjvsampler/",
    ios: "https://apps.apple.com/us/app/virtualdj-remote/id407160120",
    windows: "https://m.me/vdjvsampler/",
    macos: "https://m.me/vdjvsampler/",
  },
} as const;
const DEFAULT_LANDING_PLATFORM_DESCRIPTIONS = {
  V1: {
    android: "VDJV App, no laptop needed",
    ios: "Web App, no laptop needed",
    windows: "Standalone software, no remote app",
    macos: "Web app sa browser, no remote app",
  },
  V2: {
    android: "VDJV Remote App V2 connect sa laptop/PC",
    ios: "VirtualDJ Remote App",
    windows: "VDJV V2 (up to V2.5)",
    macos: "Message muna for compatibility",
  },
  V3: {
    android: "VDJV Remote App V3 connect sa laptop/PC",
    ios: "VirtualDJ Remote App",
    windows: "VDJV V3 (2026 latest)",
    macos: "Message muna for compatibility",
  },
} as const;
const DEFAULT_LANDING_VERSION_DESCRIPTIONS = {
  V1: {
    title: "V1 – Standalone Version",
    desc: "Pinakasimple na version ng VDJV. Hindi kailangan ng laptop o PC dahil diretso na itong gagana sa device mo. Best ito para sa mga gusto lang ng basic sampler pad para sa events gamit ang phone, tablet, o computer nang walang setup o remote connection. May unique features kumpara sa V2 at V3 pero mabilis at madaling gamitin.",
  },
  V2: {
    title: "V2 – Laptop/PC Based Version",
    desc: "Ito ang 2023 version na gumagamit ng laptop o PC bilang main system. Ang phone o tablet ay gagamitin bilang wireless touchscreen controller gamit ang remote app. Mas stable ito para sa events at mas flexible kumpara sa V1 dahil naka-run ang audio sa laptop. Recommended ito kung gusto mo ng mas professional setup pero hindi pa kailangan ang full features ng V3.",
  },
  V3: {
    title: "V3 – Full Features Version",
    desc: "Ito ang pinaka-complete at latest version ng VDJV. May kasama na itong installer, bagong features, effects, at lahat ng banks. Designed ito para sa professional events at mas advanced na paggamit. Laptop o PC pa rin ang main system habang ang phone o tablet ay gagamitin bilang wireless controller. Ito ang recommended version kung gusto mo ng full VDJV experience.",
  },
} as const;

const DEFAULT_LANDING_BUY_SECTIONS = {
  V1: {
    title: "Buy V1",
    description: "Register your VDJV V1 account, submit payment proof, and wait for approval before logging in.",
    imageUrl: "/assets/logo.png",
    defaultInstallerDownloadLink: "",
  },
  V2: {
    title: "Buy V2",
    description: "Choose V2 Standard, exact updates, or V2 PRO MAX. Approved purchases receive a real installer license.",
    imageUrl: "/assets/logo.png",
    defaultInstallerDownloadLink: "https://m.me/vdjvsampler/",
  },
  V3: {
    title: "Buy V3",
    description: "Choose V3 Standard, exact updates, or V3 PRO MAX. Approved purchases receive a real installer license.",
    imageUrl: "/assets/logo.png",
    defaultInstallerDownloadLink: "https://m.me/vdjvsampler/",
  },
} as const;

const normalizeLandingDownloadConfig = (row: any) => {
  const downloadLinksRaw = row?.download_links && typeof row.download_links === "object" ? row.download_links : {};
  const platformDescriptionsRaw = row?.platform_descriptions && typeof row.platform_descriptions === "object" ? row.platform_descriptions : {};
  const versionDescriptionsRaw = row?.version_descriptions && typeof row.version_descriptions === "object" ? row.version_descriptions : {};
  const buySectionsRaw = row?.buy_sections && typeof row.buy_sections === "object" ? row.buy_sections : {};

  const downloadLinks: Record<string, Record<string, string>> = {};
  const platformDescriptions: Record<string, Record<string, string>> = {};
  const versionDescriptions: Record<string, { title: string; desc: string }> = {};
  const buySections: Record<string, { title: string; description: string; imageUrl: string; defaultInstallerDownloadLink: string }> = {};

  LANDING_VERSION_KEYS.forEach((version) => {
    const downloadEntry = downloadLinksRaw?.[version] && typeof downloadLinksRaw[version] === "object" ? downloadLinksRaw[version] : {};
    const platformEntry = platformDescriptionsRaw?.[version] && typeof platformDescriptionsRaw[version] === "object" ? platformDescriptionsRaw[version] : {};
    const versionEntry = versionDescriptionsRaw?.[version] && typeof versionDescriptionsRaw[version] === "object" ? versionDescriptionsRaw[version] : {};

    downloadLinks[version] = {};
    platformDescriptions[version] = {};
    LANDING_PLATFORM_KEYS.forEach((platform) => {
      downloadLinks[version][platform] = asString(downloadEntry?.[platform], 2000) || DEFAULT_LANDING_DOWNLOAD_LINKS[version][platform];
      platformDescriptions[version][platform] = asString(platformEntry?.[platform], 500) || DEFAULT_LANDING_PLATFORM_DESCRIPTIONS[version][platform];
    });
    versionDescriptions[version] = {
      title: asString(versionEntry?.title, 200) || DEFAULT_LANDING_VERSION_DESCRIPTIONS[version].title,
      desc: asString(versionEntry?.desc, 5000) || DEFAULT_LANDING_VERSION_DESCRIPTIONS[version].desc,
    };

    const buyEntry = buySectionsRaw?.[version] && typeof buySectionsRaw[version] === "object" ? buySectionsRaw[version] : {};
    buySections[version] = {
      title: asString(buyEntry?.title, 200) || DEFAULT_LANDING_BUY_SECTIONS[version].title,
      description: asString(buyEntry?.description, 5000) || DEFAULT_LANDING_BUY_SECTIONS[version].description,
      imageUrl: asString(buyEntry?.imageUrl, 2000) || DEFAULT_LANDING_BUY_SECTIONS[version].imageUrl,
      defaultInstallerDownloadLink: asString(buyEntry?.defaultInstallerDownloadLink, 2000) || DEFAULT_LANDING_BUY_SECTIONS[version].defaultInstallerDownloadLink,
    };
  });

  return { downloadLinks, platformDescriptions, versionDescriptions, buySections };
};

const getSamplerAppConfigRecord = async (admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin
    .from("sampler_app_config")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) return { error, data: null };
  return { error: null, data };
};

const getNormalizedSamplerAppConfig = async (admin: ReturnType<typeof createServiceClient>) => {
  const result = await getSamplerAppConfigRecord(admin);
  if (result.error) return { error: result.error, config: DEFAULT_SAMPLER_APP_CONFIG };
  const row = result.data || {};
  return {
    error: null,
    config: normalizeSamplerAppConfig({
      ui_defaults: row?.ui_defaults,
      bank_defaults: row?.bank_defaults,
      pad_defaults: row?.pad_defaults,
      quota_defaults: row?.quota_defaults,
      audio_limits: row?.audio_limits,
      shortcut_defaults: row?.shortcut_defaults,
    }),
  };
};

const getLandingDownloadConfig = async () => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("landing_download_config")
    .select("download_links,platform_descriptions,version_descriptions,buy_sections")
    .eq("id", "default")
    .eq("is_active", true)
    .maybeSingle();
  if (error) return fail(500, error.message);
  return ok({ config: normalizeLandingDownloadConfig(data || {}) });
};

const INSTALLER_BUY_VERSION_KEYS = ["V2", "V3"] as const;
type InstallerBuyVersionKey = typeof INSTALLER_BUY_VERSION_KEYS[number];
type InstallerBuyProductType = "standard" | "update" | "promax";

const normalizeInstallerBuyVersion = (value: unknown): InstallerBuyVersionKey | null => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "V2" || normalized === "V3") return normalized;
  return null;
};

const normalizeInstallerBuyProductType = (value: unknown): InstallerBuyProductType | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "standard" || normalized === "update" || normalized === "promax") return normalized;
  return null;
};

type InstallerManifestPackageKind = "standard" | "update";
type InstallerManifestPackage = {
  version: InstallerBuyVersionKey;
  productCode: string;
  displayName: string;
  installOrder: number;
  packageKind: InstallerManifestPackageKind;
  includeInProMax: boolean;
  enabled: boolean;
};

const normalizeInstallerManifestPackageKind = (value: unknown): InstallerManifestPackageKind | null => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "standard" || normalized === "update") return normalized;
  return null;
};

const buildInstallerProMaxSku = (version: InstallerBuyVersionKey): string => `${version}_PRO_MAX`;

const sanitizeInstallerBuyEntitlements = (value: unknown, version: InstallerBuyVersionKey): string[] => {
  const items = Array.isArray(value) ? value : [];
  const prefix = `${version}_`;
  return Array.from(new Set(items
    .map((entry) => String(entry || "").trim().toUpperCase())
    .filter((entry) => entry.startsWith(prefix))));
};

const mapInstallerBuyProductRow = (row: any) => {
  const version = normalizeInstallerBuyVersion(row?.version) || "V2";
  return {
    id: asString(row?.id, 80) || "",
    version,
    skuCode: asString(row?.sku_code, 120) || "",
    productType: normalizeInstallerBuyProductType(row?.product_type) || "standard",
    displayName: asString(row?.display_name, 200) || "",
    description: asString(row?.description, 5000) || "",
    pricePhp: asPriceNumber(row?.price_php) || 0,
    enabled: Boolean(row?.enabled),
    sortOrder: Math.max(0, Math.floor(Number(row?.sort_order || 0))),
    allowAutoApprove: Boolean(row?.allow_auto_approve),
    heroImageUrl: asString(row?.hero_image_url, 2000) || "",
    downloadLinkOverride: asString(row?.download_link_override, 2000) || "",
    grantedEntitlements: sanitizeInstallerBuyEntitlements(row?.granted_entitlements, version),
    createdAt: asString(row?.created_at, 80) || null,
    updatedAt: asString(row?.updated_at, 80) || null,
  };
};

const mapInstallerManifestPackage = (row: any, version: InstallerBuyVersionKey): InstallerManifestPackage | null => {
  const productCode = asString(row?.productCode ?? row?.product_code, 120)?.trim().toUpperCase() || "";
  const packageKind = normalizeInstallerManifestPackageKind(row?.packageKind ?? row?.package_kind);
  if (!productCode || !packageKind) return null;
  return {
    version,
    productCode,
    displayName: asString(row?.displayName ?? row?.display_name, 200) || productCode,
    installOrder: Math.max(0, Math.floor(Number(row?.installOrder ?? row?.install_order ?? 0))),
    packageKind,
    includeInProMax: Boolean(row?.includeInProMax ?? row?.include_in_pro_max),
    enabled: Boolean(row?.enabled),
  };
};

const listInstallerManifestPackages = async (version: InstallerBuyVersionKey): Promise<InstallerManifestPackage[]> => {
  const payload = await callInstallerAdmin<Record<string, unknown>>("GET", `/admin/packages?version=${encodeURIComponent(version)}`);
  const rows = Array.isArray((payload as any)?.items) ? (payload as any).items : [];
  return rows
    .map((row: any) => mapInstallerManifestPackage(row, version))
    .filter((row: InstallerManifestPackage | null): row is InstallerManifestPackage => Boolean(row))
    .sort((left, right) => left.installOrder - right.installOrder || left.productCode.localeCompare(right.productCode));
};

const isAutoManagedInstallerBuyRow = (row: any, version: InstallerBuyVersionKey): boolean => {
  const skuCode = asString(row?.sku_code, 120)?.trim().toUpperCase() || "";
  const productType = normalizeInstallerBuyProductType(row?.product_type);
  const entitlements = sanitizeInstallerBuyEntitlements(row?.granted_entitlements, version);
  if (!skuCode || !productType) return false;
  if (skuCode === buildInstallerProMaxSku(version) && productType === "promax") return true;
  return productType !== "promax" && entitlements.length === 1 && entitlements[0] === skuCode;
};

const buildAutoInstallerBuyRows = (version: InstallerBuyVersionKey, packages: InstallerManifestPackage[]) => {
  const rows = packages.map((pkg) => ({
    version,
    sku_code: pkg.productCode,
    product_type: pkg.packageKind === "standard" ? "standard" as const : "update" as const,
    display_name: pkg.displayName,
    sort_order: pkg.installOrder,
    enabled: pkg.enabled,
    granted_entitlements: [pkg.productCode],
  }));

  if (packages.length > 0) {
    const proMaxEntitlements = packages
      .filter((pkg) => pkg.includeInProMax)
      .map((pkg) => pkg.productCode);
    rows.push({
      version,
      sku_code: buildInstallerProMaxSku(version),
      product_type: "promax" as const,
      display_name: `${version} PRO MAX`,
      sort_order: Math.max(...packages.map((pkg) => pkg.installOrder), 0) + 100,
      enabled: proMaxEntitlements.length > 0,
      granted_entitlements: proMaxEntitlements,
    });
  }

  return rows;
};

const syncInstallerBuyCatalogForVersion = async (
  admin: ReturnType<typeof createServiceClient>,
  version: InstallerBuyVersionKey,
) => {
  const packages = await listInstallerManifestPackages(version);
  const desiredRows = buildAutoInstallerBuyRows(version, packages);
  const desiredSkuCodes = new Set(desiredRows.map((row) => row.sku_code));

  const { data: existingRows, error: existingError } = await admin
    .from("installer_buy_products")
    .select("*")
    .eq("version", version);
  if (existingError) throw new Error(existingError.message);

  const existingMap = new Map((existingRows || []).map((row: any) => [String(row?.sku_code || "").toUpperCase(), row]));

  if (desiredRows.length > 0) {
    const upsertRows = desiredRows.map((row) => {
      const existing = existingMap.get(row.sku_code);
      return {
        version: row.version,
        sku_code: row.sku_code,
        product_type: row.product_type,
        display_name: row.display_name,
        description: asString(existing?.description, 5000) || "",
        price_php: asPriceNumber(existing?.price_php) ?? 0,
        enabled: row.enabled,
        sort_order: row.sort_order,
        allow_auto_approve: typeof existing?.allow_auto_approve === "boolean" ? existing.allow_auto_approve : true,
        hero_image_url: asString(existing?.hero_image_url, 2000) || null,
        download_link_override: asString(existing?.download_link_override, 2000) || null,
        granted_entitlements: row.granted_entitlements,
      };
    });

    const { error: upsertError } = await admin
      .from("installer_buy_products")
      .upsert(upsertRows, { onConflict: "version,sku_code" });
    if (upsertError) throw new Error(upsertError.message);
  }

  const staleAutoSkuCodes = (existingRows || [])
    .filter((row: any) => isAutoManagedInstallerBuyRow(row, version))
    .map((row: any) => String(row?.sku_code || "").toUpperCase())
    .filter((skuCode: string) => !desiredSkuCodes.has(skuCode));

  if (staleAutoSkuCodes.length > 0) {
    const { error: deleteError } = await admin
      .from("installer_buy_products")
      .delete()
      .eq("version", version)
      .in("sku_code", staleAutoSkuCodes);
    if (deleteError) throw new Error(deleteError.message);
  }

  const { data, error } = await admin
    .from("installer_buy_products")
    .select("*")
    .eq("version", version)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(mapInstallerBuyProductRow);
};

const listEnabledInstallerBuyProducts = async (admin: ReturnType<typeof createServiceClient>) => {
  const synced = await Promise.all(INSTALLER_BUY_VERSION_KEYS.map((version) => syncInstallerBuyCatalogForVersion(admin, version)));
  return synced
    .flat()
    .filter((item) => item.enabled)
    .sort((left, right) => left.version.localeCompare(right.version) || left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName));
};

const getPublicBuyConfig = async () => {
  const admin = createServiceClient();
  const [{ data: landingRow, error: landingError }, { data: paymentRow, error: paymentError }, products] = await Promise.all([
    admin.from("landing_download_config").select("download_links,platform_descriptions,version_descriptions,buy_sections").eq("id", "default").eq("is_active", true).maybeSingle(),
    admin.from("store_payment_settings").select("instructions,gcash_number,maya_number,messenger_url,qr_image_path,account_price_php").eq("id", "default").eq("is_active", true).maybeSingle(),
    listEnabledInstallerBuyProducts(admin),
  ]);
  if (landingError) return fail(500, landingError.message);
  if (paymentError) return fail(500, paymentError.message);
  return ok({
    config: normalizeLandingDownloadConfig(landingRow || {}),
    paymentConfig: {
      instructions: asString((paymentRow as any)?.instructions, 5000) || "",
      gcash_number: asString((paymentRow as any)?.gcash_number, 80) || "",
      maya_number: asString((paymentRow as any)?.maya_number, 80) || "",
      messenger_url: asString((paymentRow as any)?.messenger_url, 500) || "",
      qr_image_path: asString((paymentRow as any)?.qr_image_path, 1000) || "",
      account_price_php: asPriceNumber((paymentRow as any)?.account_price_php),
    },
    v2v3Products: products,
  });
};

const getNormalizedLandingConfigRecord = async (admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin
    .from("landing_download_config")
    .select("download_links,platform_descriptions,version_descriptions,buy_sections")
    .eq("id", "default")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeLandingDownloadConfig(data || {});
};

const createInstallerRequestProofUploadUrl = async (req: Request, body: any) => {
  const admin = createServiceClient();
  const email = normalizeEmail(body?.email);
  const fileName = asString(body?.fileName, 240);
  const contentType = asString(body?.contentType, 160)?.toLowerCase() || "";
  const paymentChannel = asString(body?.paymentChannel, 40);
  const sizeBytes = Number(body?.sizeBytes ?? body?.size_bytes ?? 0);

  if (!email) return badRequest("A valid email is required");
  if (!paymentChannel || !PAYMENT_CHANNEL_VALUES.has(paymentChannel)) {
    return badRequest("Invalid paymentChannel");
  }
  if (!fileName) return badRequest("fileName is required");
  const ext = getExtensionFromFileName(fileName);
  if (!ext || !ACCOUNT_REG_ALLOWED_EXTENSIONS.has(ext)) {
    return badRequest("Unsupported proof file extension");
  }
  if (contentType && !ACCOUNT_REG_ALLOWED_MIME_TYPES.has(contentType)) {
    return badRequest("Unsupported proof mime type");
  }
  if (Number.isFinite(sizeBytes) && sizeBytes > ACCOUNT_REG_MAX_PROOF_BYTES) {
    return fail(413, "PROOF_TOO_LARGE", { max_bytes: ACCOUNT_REG_MAX_PROOF_BYTES });
  }

  const uploadRateLimit = await consumeRateLimit({
    scope: "installer_purchase.proof_upload",
    subject: `${getRequestIp(req)}:${email}`,
    maxHits: ACCOUNT_REG_UPLOAD_RATE_LIMIT,
    windowSeconds: ACCOUNT_REG_UPLOAD_RATE_WINDOW_SECONDS,
  });
  if (!uploadRateLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "installer_purchase.proof_upload",
      retry_after_seconds: uploadRateLimit.retryAfterSeconds,
    });
  }

  const objectPath = `installer/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from("payment-proof").createSignedUploadUrl(objectPath);
  if (error || !data?.token) {
    return fail(500, error?.message || "Failed to create signed upload URL");
  }
  return ok({
    bucket: "payment-proof",
    path: objectPath,
    token: data.token,
    signedUrl: data.signedUrl || null,
    max_bytes: ACCOUNT_REG_MAX_PROOF_BYTES,
  });
};

const getInstallerAutomationConfigForVersion = (
  settings: Awaited<ReturnType<typeof getStoreAutomationSettings>>,
  version: InstallerBuyVersionKey,
) => version === "V2" ? settings.installerV2 : settings.installerV3;

const getInstallerBuyProductByVersionAndSku = async (
  admin: ReturnType<typeof createServiceClient>,
  version: InstallerBuyVersionKey,
  skuCode: string,
) => {
  const { data, error } = await admin
    .from("installer_buy_products")
    .select("*")
    .eq("version", version)
    .eq("sku_code", skuCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapInstallerBuyProductRow(data) : null;
};

const getInstallerBuyProductsByVersionAndSkus = async (
  admin: ReturnType<typeof createServiceClient>,
  version: InstallerBuyVersionKey,
  skuCodes: string[],
) => {
  if (skuCodes.length === 0) return [];
  const normalizedCodes = Array.from(new Set(
    skuCodes.map((entry) => asString(entry, 120)?.trim().toUpperCase() || "").filter(Boolean),
  ));
  if (normalizedCodes.length === 0) return [];
  const { data, error } = await admin
    .from("installer_buy_products")
    .select("*")
    .eq("version", version)
    .in("sku_code", normalizedCodes);
  if (error) throw new Error(error.message);
  const mapped = (data || []).map(mapInstallerBuyProductRow);
  const orderLookup = new Map(mapped.map((item) => [item.skuCode, item]));
  return normalizedCodes.map((code) => orderLookup.get(code)).filter(Boolean);
};

const resolveInstallerDownloadLink = (
  landingConfig: ReturnType<typeof normalizeLandingDownloadConfig>,
  row: {
    version?: unknown;
    download_link_override?: unknown;
    installer_download_link?: unknown;
  },
): string => {
  const explicit = asString(row?.installer_download_link, 2000)
    || asString(row?.download_link_override, 2000);
  if (explicit) return explicit;
  const version = normalizeInstallerBuyVersion(row?.version) || "V2";
  return landingConfig.buySections[version]?.defaultInstallerDownloadLink || "";
};

const loadInstallerPurchaseBatchRows = async (
  admin: ReturnType<typeof createServiceClient>,
  row: { receipt_reference?: unknown; email?: unknown; version?: unknown },
) => {
  const receiptReference = asString(row?.receipt_reference, 160) || "";
  const email = normalizeEmail(row?.email);
  const version = normalizeInstallerBuyVersion(row?.version);
  if (!receiptReference || !email || !version) return [];
  const { data, error } = await admin
    .from("installer_purchase_requests")
    .select("*")
    .eq("receipt_reference", receiptReference)
    .eq("email_normalized", email)
    .eq("version", version)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
};

const dedupeStringList = (values: Array<unknown>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const buildInstallerPurchaseBatchSummary = (rows: any[]) => {
  const sortedRows = [...rows].sort((left, right) => {
    const leftTime = Date.parse(asString(left?.created_at, 80) || "") || 0;
    const rightTime = Date.parse(asString(right?.created_at, 80) || "") || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
  const firstRow = sortedRows[0] || null;
  const titles = dedupeStringList(sortedRows.map((row) => asString(row?.display_name_snapshot, 200) || ""));
  const skuCodes = dedupeStringList(sortedRows.map((row) => asString(row?.sku_code, 120) || ""));
  const entitlements = dedupeStringList(sortedRows.flatMap((row) => Array.isArray(row?.granted_entitlements_snapshot) ? row.granted_entitlements_snapshot : []));
  const totalAmount = sortedRows.reduce((sum, row) => sum + (asPriceNumber(row?.price_php_snapshot) || 0), 0);
  const purchaseLabel = titles.length === 0
    ? "VDJV Purchase"
    : titles.length === 1
      ? titles[0]
      : `${titles.length} items: ${titles.join(", ")}`;
  return {
    rows: sortedRows,
    firstRow,
    version: normalizeInstallerBuyVersion(firstRow?.version) || "V2",
    email: normalizeEmail(firstRow?.email) || "",
    receiptReference: asString(firstRow?.receipt_reference, 160) || "",
    paymentReference: asString(firstRow?.reference_no, 160) || "",
    paymentChannel: asString(firstRow?.payment_channel, 80) || "",
    titles,
    skuCodes,
    entitlements,
    totalAmount,
    purchaseLabel,
  };
};

const mapInstallerPurchaseRequestRow = (row: any) => ({
  id: asString(row?.id, 80) || "",
  email: asString(row?.email, 320) || "",
  version: normalizeInstallerBuyVersion(row?.version) || "V2",
  skuCode: asString(row?.sku_code, 120) || "",
  productType: normalizeInstallerBuyProductType(row?.product_type) || "standard",
  displayNameSnapshot: asString(row?.display_name_snapshot, 200) || "",
  pricePhpSnapshot: asPriceNumber(row?.price_php_snapshot),
  grantedEntitlementsSnapshot: Array.isArray(row?.granted_entitlements_snapshot)
    ? row.granted_entitlements_snapshot.map((entry: unknown) => String(entry || "").trim()).filter(Boolean)
    : [],
  status: String(row?.status || "pending"),
  paymentChannel: asString(row?.payment_channel, 40) || "",
  payerName: asString(row?.payer_name, 160) || null,
  referenceNo: asString(row?.reference_no, 160) || null,
  receiptReference: asString(row?.receipt_reference, 160) || null,
  notes: asString(row?.notes, 1000) || null,
  proofPath: asString(row?.proof_path, 600) || null,
  rejectionMessage: asString(row?.rejection_message, 1000) || null,
  decisionEmailStatus: asString(row?.decision_email_status, 40) || null,
  decisionEmailError: asString(row?.decision_email_error, 1000) || null,
  reviewedBy: asString(row?.reviewed_by, 80) || null,
  reviewedAt: asString(row?.reviewed_at, 80) || null,
  issuedLicenseId: Number.isFinite(Number(row?.issued_license_id)) ? Number(row.issued_license_id) : null,
  issuedLicenseCode: asString(row?.issued_license_code, 120) || null,
  installerDownloadLink: asString(row?.installer_download_link, 2000) || null,
  ocrReferenceNo: asString(row?.ocr_reference_no, 160) || null,
  ocrPayerName: asString(row?.ocr_payer_name, 160) || null,
  ocrAmountPhp: asPriceNumber(row?.ocr_amount_php),
  ocrRecipientNumber: asString(row?.ocr_recipient_number, 80) || null,
  ocrProvider: asString(row?.ocr_provider, 80) || null,
  ocrScannedAt: asString(row?.ocr_scanned_at, 80) || null,
  ocrStatus: asString(row?.ocr_status, 40) || null,
  ocrErrorCode: asString(row?.ocr_error_code, 120) || null,
  decisionSource: asString(row?.decision_source, 40) || null,
  automationResult: asString(row?.automation_result, 120) || null,
  createdAt: asString(row?.created_at, 80) || new Date().toISOString(),
});

const sendInstallerPendingSubmissionEmail = async (input: {
  requestRow: any;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const batchRows = await loadInstallerPurchaseBatchRows(createServiceClient(), input.requestRow);
  const summary = buildInstallerPurchaseBatchSummary(batchRows.length > 0 ? batchRows : [input.requestRow]);
  const targetEmail = summary.email || normalizeEmail(input.requestRow?.email);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const version = summary.version;
  const title = summary.purchaseLabel || `${version} Purchase`;
  const amount = summary.totalAmount > 0 ? summary.totalAmount : asPriceNumber(input.requestRow?.price_php_snapshot);
  const receiptReference = summary.receiptReference || asString(input.requestRow?.receipt_reference, 160) || "-";
  const referenceNo = summary.paymentReference || asString(input.requestRow?.reference_no, 160) || "-";
  const paymentChannel = summary.paymentChannel || asString(input.requestRow?.payment_channel, 80) || "-";
  const submittedAt = new Date(asString(summary.firstRow?.created_at, 80) || asString(input.requestRow?.created_at, 80) || new Date().toISOString()).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";

  const textBody = [
    `We received your ${title} payment submission.`,
    "",
    "Status: PENDING APPROVAL",
    "Keep your receipt reference. If you do not receive an email update soon, send this receipt reference to Facebook Messenger for manual status checking.",
    "",
    `Receipt Reference: ${receiptReference}`,
  ].join("\n");

  const htmlBody = buildReceiptStyleEmailHtml({
    variant: "pending",
    title: "Pending Approval",
    subtitle: `Your ${version} purchase is waiting for review.`,
    amountLabel: "Total Payment",
    amountValue: amount !== null ? formatPhpCurrency(amount) : "To be confirmed",
    details: [
      { label: "Purchase", value: title },
      { label: "VDJV Receipt No", value: receiptReference },
      { label: "Payment Reference", value: referenceNo },
      { label: "Payment Channel", value: paymentChannel },
      { label: "Submitted At", value: submittedAt },
      { label: "Status", value: "Pending Approval" },
    ],
    bodyText: textBody,
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject: `Payment Received - Pending Approval - ${receiptReference}`,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
};

const sendInstallerDecisionEmail = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  requestRow: any;
  nextStatus: "approved" | "rejected";
  reviewedAtIso: string;
  rejectionMessage?: string | null;
  issuedLicenseCode?: string | null;
  installerDownloadLink?: string | null;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const batchRows = await loadInstallerPurchaseBatchRows(input.admin, input.requestRow);
  const summary = buildInstallerPurchaseBatchSummary(batchRows.length > 0 ? batchRows : [input.requestRow]);
  const targetEmail = summary.email || normalizeEmail(input.requestRow?.email);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const version = summary.version;
  const title = summary.purchaseLabel || `${version} Purchase`;
  const receiptReference = summary.receiptReference || asString(input.requestRow?.receipt_reference, 160) || "-";
  const paymentReference = summary.paymentReference || asString(input.requestRow?.reference_no, 160) || "-";
  const paymentChannel = summary.paymentChannel || asString(input.requestRow?.payment_channel, 80) || "-";
  const reviewedAt = new Date(input.reviewedAtIso).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";

  const subject = input.nextStatus === "approved"
    ? `License Ready - ${receiptReference}`
    : `Purchase Update - ${receiptReference}`;

  const textBody = input.nextStatus === "approved"
    ? [
      `Your ${title} purchase has been approved.`,
      "",
      `License Code: ${input.issuedLicenseCode || "-"}`,
      `Installer Download: ${input.installerDownloadLink || "-"}`,
      "",
      "Keep this email for future reinstall and support reference.",
    ].join("\n")
    : [
      `Your ${title} purchase was not approved.`,
      "",
      `Reason: ${asString(input.rejectionMessage, 1000) || "Please message us on Facebook for assistance."}`,
      "",
      `Receipt Reference: ${receiptReference}`,
    ].join("\n");

  const htmlBody = buildReceiptStyleEmailHtml({
    variant: input.nextStatus === "approved" ? "approved" : "rejected",
    title: input.nextStatus === "approved" ? "License Ready" : "Purchase Rejected",
    subtitle: input.nextStatus === "approved"
      ? `Your ${version} purchase is approved and ready to use.`
      : `Your ${version} purchase requires manual follow-up.`,
    amountLabel: "Purchase",
    amountValue: title,
    details: [
      { label: "VDJV Receipt No", value: receiptReference },
      { label: "Payment Reference", value: paymentReference },
      { label: "Payment Channel", value: paymentChannel },
      { label: "Reviewed At", value: reviewedAt },
      ...(input.nextStatus === "approved"
        ? [
          { label: "License Code", value: asString(input.issuedLicenseCode, 120) || "-" },
          { label: "Download Link", value: asString(input.installerDownloadLink, 2000) || "-" },
        ]
        : [{ label: "Reason", value: asString(input.rejectionMessage, 1000) || "-" }]),
    ],
    bodyText: textBody,
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
};

const executeInstallerPurchaseApproval = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  requestRow: any;
  reviewedAtIso: string;
  reviewedBy: string | null;
  decisionSource: "manual" | "automation";
  automationResult?: string | null;
}) => {
  const batchRows = await loadInstallerPurchaseBatchRows(input.admin, input.requestRow);
  const summary = buildInstallerPurchaseBatchSummary(batchRows.length > 0 ? batchRows : [input.requestRow]);
  const version = summary.version;
  if (!version) return fail(400, "INVALID_VERSION");

  const landingConfig = await getNormalizedLandingConfigRecord(input.admin);
  const existingIssuedRow = summary.rows.find((row) => Number.isFinite(Number(row?.issued_license_id)) && asString(row?.issued_license_code, 120));
  let issuedLicenseId = Number.isFinite(Number(existingIssuedRow?.issued_license_id))
    ? Number(existingIssuedRow?.issued_license_id)
    : Number.isFinite(Number(input.requestRow?.issued_license_id))
      ? Number(input.requestRow.issued_license_id)
      : null;
  let issuedLicenseCode = asString(existingIssuedRow?.issued_license_code, 120) || asString(input.requestRow?.issued_license_code, 120) || null;

  if (!issuedLicenseId || !issuedLicenseCode) {
    const createPayload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/licenses/create", {
      version,
      customerName: summary.email || asString(input.requestRow?.display_name_snapshot, 200) || `${version} Buyer`,
      notes: [
        `installer_purchase_request:${asString(input.requestRow?.id, 80) || ""}`,
        `receipt:${summary.receiptReference}`,
        `sku:${summary.skuCodes.join(",")}`,
        `email:${summary.email}`,
      ].join(" | "),
      unlimited: false,
      entitlements: summary.entitlements,
    });

    issuedLicenseCode = asString((createPayload as any)?.rawCode, 120) || null;
    issuedLicenseId = Number.isFinite(Number((createPayload as any)?.item?.id))
      ? Number((createPayload as any).item.id)
      : null;
    if (!issuedLicenseId || !issuedLicenseCode) {
      return fail(500, "INSTALLER_LICENSE_CREATE_FAILED");
    }
  }

  const installerDownloadLink = resolveInstallerDownloadLink(landingConfig, summary.firstRow || input.requestRow);
  const decisionEmail = await sendInstallerDecisionEmail({
    admin: input.admin,
    requestRow: summary.firstRow || input.requestRow,
    nextStatus: "approved",
    reviewedAtIso: input.reviewedAtIso,
    issuedLicenseCode,
    installerDownloadLink,
  });

  const { error } = await input.admin
    .from("installer_purchase_requests")
    .update({
      status: "approved",
      rejection_message: null,
      reviewed_by: input.reviewedBy,
      reviewed_at: input.reviewedAtIso,
      issued_license_id: issuedLicenseId,
      issued_license_code: issuedLicenseCode,
      installer_download_link: installerDownloadLink || null,
      decision_email_status: decisionEmail.status,
      decision_email_error: decisionEmail.error,
      decision_source: input.decisionSource,
      automation_result: input.automationResult || null,
    })
    .eq("receipt_reference", summary.receiptReference)
    .eq("email_normalized", summary.email)
    .eq("version", version)
    .eq("status", "pending");
  if (error) return fail(500, error.message);

  return ok({
    requestId: asString(summary.firstRow?.id, 80) || asString(input.requestRow?.id, 80) || "",
    status: "approved",
    issued_license_id: issuedLicenseId,
    issued_license_code: issuedLicenseCode,
    installer_download_link: installerDownloadLink || null,
    purchase_label: summary.purchaseLabel,
    decision_email_status: decisionEmail.status,
    decision_email_error: decisionEmail.error,
  });
};

const createInstallerPurchaseRequest = async (req: Request, body: any) => {
  const admin = createServiceClient();
  const email = normalizeEmail(body?.email);
  const version = normalizeInstallerBuyVersion(body?.version);
  const skuCodes = dedupeStringList(
    Array.isArray(body?.skuCodes)
      ? body.skuCodes
      : [body?.skuCode],
  ).map((entry) => entry.toUpperCase());
  const paymentChannel = asString(body?.paymentChannel, 40);
  let payerName = asString(body?.payerName, 120);
  let referenceNo = asString(body?.referenceNo, 120);
  const notes = asString(body?.notes, 1000);
  const proofPath = asString(body?.proofPath, 600);

  if (!email) return badRequest("A valid email is required");
  if (!version) return badRequest("A valid version is required");
  if (skuCodes.length === 0) return badRequest("skuCodes is required");
  if (!paymentChannel || !PAYMENT_CHANNEL_VALUES.has(paymentChannel)) return badRequest("Invalid paymentChannel");
  if (!proofPath && paymentChannel === "image_proof") return badRequest("proofPath is required for image_proof");
  if (proofPath) {
    if (!proofPath.startsWith("installer/")) return badRequest("Invalid proofPath");
    const ext = getExtensionFromFileName(proofPath);
    if (!ext || !ACCOUNT_REG_ALLOWED_EXTENSIONS.has(ext)) return badRequest("Invalid proofPath extension");
  }

  const purchaseRateLimit = await consumeRateLimit({
    scope: "installer_purchase.submit",
    subject: `${getRequestIp(req)}:${email}`,
    maxHits: ACCOUNT_REG_SUBMIT_RATE_LIMIT,
    windowSeconds: ACCOUNT_REG_SUBMIT_RATE_WINDOW_SECONDS,
  });
  if (!purchaseRateLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "installer_purchase.submit",
      retry_after_seconds: purchaseRateLimit.retryAfterSeconds,
    });
  }

  if (proofPath) {
    const { error: signedError } = await admin.storage.from("payment-proof").createSignedUrl(proofPath, 60);
    if (signedError) return fail(400, "INVALID_PROOF_PATH");
  }

  const products = await getInstallerBuyProductsByVersionAndSkus(admin, version, skuCodes);
  if (products.length !== skuCodes.length || products.some((product) => !product.enabled)) {
    return fail(404, "INSTALLER_BUY_PRODUCT_NOT_FOUND");
  }
  const standardProducts = products.filter((product) => product.productType === "standard");
  const updateProducts = products.filter((product) => product.productType === "update");
  const promaxProducts = products.filter((product) => product.productType === "promax");
  if (promaxProducts.length > 0 && products.length > 1) {
    return badRequest("PRO MAX cannot be combined with other items");
  }
  if (standardProducts.length > 1) {
    return badRequest("Only one Standard item can be selected");
  }
  if (products.length > 1 && standardProducts.length === 0 && updateProducts.length !== products.length) {
    return badRequest("Multiple selection is only supported for Standard + updates or update-only purchases");
  }
  if (products.length > 1 && standardProducts.length === 1 && standardProducts.length + updateProducts.length !== products.length) {
    return badRequest("Standard can only be combined with update purchases");
  }

  const { data: existingPending, error: existingPendingError } = await admin
    .from("installer_purchase_requests")
    .select("id,sku_code")
    .eq("email_normalized", email)
    .eq("version", version)
    .in("sku_code", skuCodes)
    .eq("status", "pending")
    .limit(Math.max(1, skuCodes.length));
  if (existingPendingError) return fail(500, existingPendingError.message);
  if ((existingPending || []).length > 0) return fail(409, "INSTALLER_PURCHASE_PENDING");

  const automationSettings = await getStoreAutomationSettings(admin);
  let ocrDetected: ReceiptOcrDetection | null = null;
  let ocrErrorCode: string | null = null;
  let ocrProvider: string | null = null;
  const automationConfig = getInstallerAutomationConfigForVersion(automationSettings, version);
  const shouldRunServerOcr = paymentChannel === "image_proof" && Boolean(proofPath) && automationConfig.enabled;
  if (shouldRunServerOcr && proofPath) {
    const attempt = await extractReceiptFieldsFromStoragePath(
      admin,
      "payment-proof",
      proofPath,
      "account_registration",
    ).catch(() => ({ detected: null, errorCode: "OCR_FAILED", provider: OCR_SPACE_PROVIDER, elapsedMs: 0 } satisfies ReceiptOcrAttempt));
    if (attempt.detected) {
      ocrDetected = attempt.detected;
      ocrProvider = attempt.detected.provider;
      if (!payerName && attempt.detected.payerName) payerName = attempt.detected.payerName;
      if (!referenceNo && attempt.detected.referenceNo) referenceNo = attempt.detected.referenceNo;
    } else {
      ocrErrorCode = attempt.errorCode || (String(Deno.env.get("OCR_SPACE_API_KEY") || "").trim() ? "OCR_FAILED" : "OCR_UNAVAILABLE");
      ocrProvider = attempt.provider;
    }
  } else if (paymentChannel === "image_proof" && proofPath) {
    ocrErrorCode = "MANUAL_REVIEW_MODE";
  }

  const ocrMetadata = buildReceiptOcrMetadata(ocrDetected, ocrErrorCode, ocrProvider);
  const { data: paymentSettings, error: paymentSettingsError } = await admin
    .from("store_payment_settings")
    .select("gcash_number,maya_number,messenger_url")
    .eq("id", "default")
    .maybeSingle();
  if (paymentSettingsError) return fail(500, paymentSettingsError.message);

  const receiptReference = buildInstallerReceiptReference(version);
  const insertPayload = products.map((product) => ({
    email,
    version,
    sku_code: product.skuCode,
    product_type: product.productType,
    display_name_snapshot: product.displayName,
    price_php_snapshot: product.pricePhp,
    granted_entitlements_snapshot: product.grantedEntitlements,
    status: "pending",
    payment_channel: paymentChannel,
    payer_name: payerName || null,
    reference_no: referenceNo || null,
    receipt_reference: receiptReference,
    notes: notes || null,
    proof_path: proofPath || null,
    decision_email_status: "pending",
    ocr_reference_no: ocrMetadata.referenceNo,
    ocr_payer_name: ocrMetadata.payerName,
    ocr_amount_php: ocrMetadata.amountPhp,
    ocr_recipient_number: ocrMetadata.recipientNumber,
    ocr_provider: ocrMetadata.provider,
    ocr_scanned_at: ocrMetadata.scannedAt,
    ocr_status: ocrMetadata.status,
    ocr_error_code: ocrMetadata.errorCode,
  }));

  const { data, error } = await admin
    .from("installer_purchase_requests")
    .insert(insertPayload)
    .select("*");
  if (error) return fail(500, error.message);
  const requestRows = Array.isArray(data) ? data : [];
  const requestRow = requestRows[0] as any;
  const summary = buildInstallerPurchaseBatchSummary(requestRows);

  let automationResult: AutomationReason = "not_image_proof";
  let autoApproved = false;
  if (paymentChannel === "image_proof") {
    if (!automationConfig.enabled) {
      automationResult = "manual_review_disabled";
    } else if (!ocrDetected) {
      automationResult = "ocr_failed";
    } else if (!ocrMetadata.referenceNo) {
      automationResult = "missing_reference";
    } else if (ocrMetadata.amountPhp === null) {
      automationResult = "missing_amount";
    } else if (!ocrMetadata.recipientNumber) {
      automationResult = "missing_recipient_number";
    } else {
      const reserved = await tryReservePaymentReference({
        admin,
        sourceReference: ocrMetadata.referenceNo,
        sourceTable: "installer_purchase_requests",
        sourceRequestId: String(requestRow.id),
      });
      if (reserved.errorMessage) {
        automationResult = "approval_error";
      } else if (!reserved.reserved) {
        automationResult = "duplicate_reference";
      } else if (!isWithinAutoApprovalWindow(automationConfig)) {
        automationResult = "outside_window";
      } else if (!matchesConfiguredWalletRecipient({
        paymentChannel,
        detectedRecipientNumber: ocrMetadata.recipientNumber,
        paymentConfig: paymentSettings,
      })) {
        automationResult = "wallet_number_mismatch";
      } else {
        const expectedAmount = roundMoney(summary.totalAmount || 0);
        const detectedAmount = roundMoney(ocrMetadata.amountPhp);
        if (!matchesAutoApprovalAmount(expectedAmount, detectedAmount)) {
          automationResult = "amount_mismatch";
        } else {
          automationResult = "approved";
          autoApproved = true;
        }
      }
    }
  }

  if (autoApproved) {
    const approvalResponse = await executeInstallerPurchaseApproval({
      admin,
      requestRow,
      reviewedAtIso: new Date().toISOString(),
      reviewedBy: null,
      decisionSource: "automation",
      automationResult,
    });
    if (approvalResponse.ok || approvalResponse.status < 500) {
      return approvalResponse;
    }
    automationResult = "approval_error";
  }

  await admin
    .from("installer_purchase_requests")
    .update({ automation_result: automationResult })
    .eq("receipt_reference", receiptReference)
    .eq("email_normalized", email)
    .eq("version", version);

  const pendingEmailResult = await sendInstallerPendingSubmissionEmail({ requestRow });
  if (pendingEmailResult.status !== "skipped") {
    await admin
      .from("installer_purchase_requests")
      .update({
        decision_email_status: pendingEmailResult.status,
        decision_email_error: pendingEmailResult.error,
      })
      .eq("receipt_reference", receiptReference)
      .eq("email_normalized", email)
      .eq("version", version);
  }

  return ok({
    requestId: requestRow.id,
    status: "pending",
    auto_approved: false,
    payer_name: payerName || null,
    reference_no: ocrMetadata.referenceNo || referenceNo || null,
    receipt_reference: receiptReference,
    purchase_label: summary.purchaseLabel,
    decision_email_status: pendingEmailResult.status,
    decision_email_error: pendingEmailResult.error,
    wait_message: "Your purchase request is under confirmation. Please check your email or message us on Facebook with the receipt reference for status.",
  });
};

const listAdminInstallerBuyProducts = async (req: Request) => {
  const admin = createServiceClient();
  const url = new URL(req.url);
  const version = normalizeInstallerBuyVersion(url.searchParams.get("version"));
  try {
    const items = version
      ? await syncInstallerBuyCatalogForVersion(admin, version)
      : (await Promise.all(INSTALLER_BUY_VERSION_KEYS.map((entry) => syncInstallerBuyCatalogForVersion(admin, entry)))).flat();
    return ok({ items });
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : "Failed to load buy catalog");
  }
};

const saveAdminInstallerBuyProduct = async (body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const version = normalizeInstallerBuyVersion(body?.version);
  const productType = normalizeInstallerBuyProductType(body?.productType);
  const skuCode = asString(body?.skuCode, 120)?.trim().toUpperCase() || "";
  const displayName = asString(body?.displayName, 200)?.trim() || "";
  const description = asString(body?.description, 5000) || "";
  const heroImageUrl = asString(body?.heroImageUrl, 2000) || null;
  const downloadLinkOverride = asString(body?.downloadLinkOverride, 2000) || null;
  const pricePhp = asPriceNumber(body?.pricePhp);
  const sortOrder = Math.max(0, Math.floor(Number(body?.sortOrder || 0)));
  const allowAutoApprove = Boolean(body?.allowAutoApprove);
  const enabled = Boolean(body?.enabled);
  const grantedEntitlements = sanitizeInstallerBuyEntitlements(body?.grantedEntitlements, version || "V2");
  if (!version) return badRequest("Invalid version");
  if (!productType) return badRequest("Invalid productType");
  if (!skuCode) return badRequest("skuCode is required");
  if (!displayName) return badRequest("displayName is required");
  if (pricePhp === null) return badRequest("pricePhp is required");
  if (grantedEntitlements.length === 0) return badRequest("grantedEntitlements is required");
  if (heroImageUrl) {
    try {
      const parsed = new URL(heroImageUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return badRequest("heroImageUrl must be a valid http or https URL");
      }
    } catch {
      return badRequest("heroImageUrl must be a valid http or https URL");
    }
  }
  if (downloadLinkOverride) {
    try {
      const parsed = new URL(downloadLinkOverride);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return badRequest("downloadLinkOverride must be a valid http or https URL");
      }
    } catch {
      return badRequest("downloadLinkOverride must be a valid http or https URL");
    }
  }

  const payload = {
    version,
    sku_code: skuCode,
    product_type: productType,
    display_name: displayName,
    description,
    price_php: pricePhp,
    enabled,
    sort_order: sortOrder,
    allow_auto_approve: allowAutoApprove,
    hero_image_url: heroImageUrl,
    download_link_override: downloadLinkOverride,
    granted_entitlements: grantedEntitlements,
    updated_by: adminUserId,
  };

  const { data, error } = await admin
    .from("installer_buy_products")
    .upsert(payload, { onConflict: "version,sku_code" })
    .select("*")
    .single();
  if (error) return fail(500, error.message);
  try {
    const syncedItems = await syncInstallerBuyCatalogForVersion(admin, version);
    const syncedItem = syncedItems.find((item) => item.skuCode === skuCode) || mapInstallerBuyProductRow(data);
    return ok({ item: syncedItem });
  } catch (syncError) {
    return fail(500, syncError instanceof Error ? syncError.message : "Failed to sync buy catalog");
  }
};

const deleteAdminInstallerBuyProduct = async (body: any) => {
  const admin = createServiceClient();
  const version = normalizeInstallerBuyVersion(body?.version);
  const skuCode = asString(body?.skuCode, 120)?.trim().toUpperCase() || "";
  if (!version) return badRequest("Invalid version");
  if (!skuCode) return badRequest("skuCode is required");

  const { error } = await admin
    .from("installer_buy_products")
    .delete()
    .eq("version", version)
    .eq("sku_code", skuCode);
  if (error) return fail(500, error.message);
  try {
    await syncInstallerBuyCatalogForVersion(admin, version);
  } catch (syncError) {
    return fail(500, syncError instanceof Error ? syncError.message : "Failed to sync buy catalog");
  }
  return ok({ deleted: true, version, skuCode });
};

const listAdminInstallerPurchaseRequests = async (req: Request) => {
  const admin = createServiceClient();
  const url = new URL(req.url);
  const version = normalizeInstallerBuyVersion(url.searchParams.get("version"));
  const status = String(url.searchParams.get("status") || "all").toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get("perPage") || 20)));
  const q = asString(url.searchParams.get("q"), 120)?.trim();
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query: any = admin
    .from("installer_purchase_requests")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (version) query = query.eq("version", version);
  if (status === "pending" || status === "approved" || status === "rejected") query = query.eq("status", status);
  if (q) {
    const escaped = q.replace(/[%_]/g, "");
    query = query.or([
      `email.ilike.%${escaped}%`,
      `sku_code.ilike.%${escaped}%`,
      `display_name_snapshot.ilike.%${escaped}%`,
      `reference_no.ilike.%${escaped}%`,
      `ocr_reference_no.ilike.%${escaped}%`,
      `receipt_reference.ilike.%${escaped}%`,
      `issued_license_code.ilike.%${escaped}%`,
    ].join(","));
  }

  const { data, error, count } = await query.range(from, to);
  if (error) return fail(500, error.message);
  return ok({
    items: (data || []).map(mapInstallerPurchaseRequestRow),
    total: Number(count || 0),
    page,
    perPage,
  });
};

const adminInstallerPurchaseRequestAction = async (requestId: string, body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const action = String(body?.action || "").toLowerCase();
  if (action !== "approve" && action !== "reject") return badRequest("Invalid action");
  const rejectionMessage = asString(body?.rejection_message, 1000);
  if (action === "reject" && !rejectionMessage) return badRequest("rejection_message is required");

  const { data: requestRow, error: requestError } = await admin
    .from("installer_purchase_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return fail(500, requestError.message);
  if (!requestRow) return fail(404, "Request not found");
  if (requestRow.status !== "pending") return badRequest("Request is not pending");

  const reviewedAtIso = new Date().toISOString();
  if (action === "approve") {
    return await executeInstallerPurchaseApproval({
      admin,
      requestRow,
      reviewedAtIso,
      reviewedBy: adminUserId,
      decisionSource: "manual",
      automationResult: asString(requestRow?.automation_result, 120) || null,
    });
  }

  const decisionEmail = await sendInstallerDecisionEmail({
    admin,
    requestRow,
    nextStatus: "rejected",
    reviewedAtIso,
    rejectionMessage: rejectionMessage || null,
  });

  const { error } = await admin
    .from("installer_purchase_requests")
    .update({
      status: "rejected",
      rejection_message: rejectionMessage || null,
      reviewed_by: adminUserId,
      reviewed_at: reviewedAtIso,
      decision_email_status: decisionEmail.status,
      decision_email_error: decisionEmail.error,
      decision_source: "manual",
      automation_result: asString(requestRow?.automation_result, 120) || null,
    })
    .eq("receipt_reference", asString(requestRow?.receipt_reference, 160) || "")
    .eq("email_normalized", normalizeEmail(requestRow?.email) || "")
    .eq("version", normalizeInstallerBuyVersion(requestRow?.version) || "V2")
    .eq("status", "pending");
  if (error) return fail(500, error.message);

  return ok({
    requestId,
    status: "rejected",
    decision_email_status: decisionEmail.status,
    decision_email_error: decisionEmail.error,
  });
};

const getPublicSamplerAppConfig = async () => {
  const admin = createServiceClient();
  const result = await getNormalizedSamplerAppConfig(admin);
  if (result.error) return fail(500, result.error.message);
  return ok({ config: result.config });
};

const createAccountRegistrationProofUploadUrl = async (req: Request, body: any) => {
  const admin = createServiceClient();
  const email = normalizeEmail(body?.email);
  const fileName = asString(body?.fileName, 240);
  const contentType = asString(body?.contentType, 160)?.toLowerCase() || "";
  const paymentChannel = asString(body?.paymentChannel, 40);
  const sizeBytes = Number(body?.sizeBytes ?? body?.size_bytes ?? 0);

  if (!paymentChannel || !PAYMENT_CHANNEL_VALUES.has(paymentChannel)) {
    return badRequest("Invalid paymentChannel");
  }
  if (!fileName) return badRequest("fileName is required");
  const ext = getExtensionFromFileName(fileName);
  if (!ext || !ACCOUNT_REG_ALLOWED_EXTENSIONS.has(ext)) {
    return badRequest("Unsupported proof file extension");
  }
  if (contentType && !ACCOUNT_REG_ALLOWED_MIME_TYPES.has(contentType)) {
    return badRequest("Unsupported proof mime type");
  }
  if (Number.isFinite(sizeBytes) && sizeBytes > ACCOUNT_REG_MAX_PROOF_BYTES) {
    return fail(413, "PROOF_TOO_LARGE", { max_bytes: ACCOUNT_REG_MAX_PROOF_BYTES });
  }

  const uploadRateLimit = await consumeRateLimit({
    scope: "account_registration.proof_upload",
    subject: `${getRequestIp(req)}:${email || "anon"}`,
    maxHits: ACCOUNT_REG_UPLOAD_RATE_LIMIT,
    windowSeconds: ACCOUNT_REG_UPLOAD_RATE_WINDOW_SECONDS,
  });
  if (!uploadRateLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "account_registration.proof_upload",
      retry_after_seconds: uploadRateLimit.retryAfterSeconds,
    });
  }

  const objectPath = `registration/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from("payment-proof").createSignedUploadUrl(objectPath);
  if (error || !data?.token) {
    return fail(500, error?.message || "Failed to create signed upload URL");
  }
  return ok({
    bucket: "payment-proof",
    path: objectPath,
    token: data.token,
    signedUrl: data.signedUrl || null,
    max_bytes: ACCOUNT_REG_MAX_PROOF_BYTES,
  });
};

const createReceiptOcr = async (req: Request) => {
  const startedAt = Date.now();
  const ocrApiKey = String(Deno.env.get("OCR_SPACE_API_KEY") || "").trim();
  if (!ocrApiKey) return fail(503, "OCR_UNAVAILABLE");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Invalid form-data payload");
  }

  const maybeFile = form.get("file");
  if (!(maybeFile instanceof File)) return badRequest("file is required");
  const file = maybeFile;
  const context = normalizeReceiptOcrContext(asString(form.get("context"), 50) || "unknown");
  const normalizedEmail = normalizeEmail(form.get("email"));
  const subjectHint = asString(form.get("subject"), 120) || "";

  const validationError = validateReceiptOcrFile(file);
  if (validationError === "OCR_UNSUPPORTED_EXTENSION") {
    return fail(400, validationError);
  }
  if (validationError === "OCR_UNSUPPORTED_MIME") {
    return fail(400, validationError);
  }
  if (validationError === "OCR_INVALID_FILE_SIZE") {
    return fail(400, validationError);
  }
  if (validationError === "OCR_FILE_TOO_LARGE") {
    return fail(413, validationError, { max_bytes: ACCOUNT_REG_MAX_PROOF_BYTES });
  }

  const subject = `${getRequestIp(req)}:${normalizedEmail || subjectHint || "anon"}`;
  const ocrLimit = await consumeRateLimit({
    scope: "receipt_ocr",
    subject,
    maxHits: RECEIPT_OCR_RATE_LIMIT,
    windowSeconds: RECEIPT_OCR_RATE_WINDOW_SECONDS,
  });
  if (!ocrLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "receipt_ocr",
      retry_after_seconds: ocrLimit.retryAfterSeconds,
    });
  }

  const attempt = await extractReceiptFieldsViaOcr({ file, context });
  if (!attempt.detected) {
    await swallowDiscordError(() =>
      sendDiscordOcrFailureEvent({
        context,
        subject: subjectHint || null,
        email: normalizedEmail,
        errorCode: attempt.errorCode || "OCR_FAILED",
        provider: attempt.provider,
      })
    );
    return fail(502, attempt.errorCode || "OCR_FAILED", {
      provider: attempt.provider,
      elapsedMs: attempt.elapsedMs || (Date.now() - startedAt),
    });
  }
  const detected = attempt.detected;

  return ok({
    context,
    provider: detected.provider,
    elapsedMs: detected.elapsedMs,
    detected: {
      referenceNo: detected.referenceNo,
      payerName: detected.payerName,
      amountPhp: detected.amountPhp,
      recipientNumber: detected.recipientNumber,
      rawText: detected.rawText,
      confidence: null,
    },
  });
};

const createAccountRegistrationSubmit = async (req: Request, body: any) => {
  const admin = createServiceClient();
  const email = normalizeEmail(body?.email);
  const emailDisplayName = email ? email.split("@")[0]?.replace(/[._-]+/g, " ").trim() : "";
  const displayName = asString(body?.displayName, 120) || emailDisplayName || "User";
  const password = String(body?.password || "");
  const confirmPassword = String(body?.confirmPassword || "");
  const paymentChannel = asString(body?.paymentChannel, 40);
  let payerName = asString(body?.payerName, 120);
  let referenceNo = asString(body?.referenceNo, 120);
  const notes = asString(body?.notes, 1000);
  const proofPath = asString(body?.proofPath, 600);

  if (!email) return badRequest("A valid email is required");
  if (password.length < ACCOUNT_REG_MIN_PASSWORD_LENGTH) {
    return fail(400, "WEAK_PASSWORD", { min_length: ACCOUNT_REG_MIN_PASSWORD_LENGTH });
  }
  if (password !== confirmPassword) return fail(400, "PASSWORD_MISMATCH");
  if (!paymentChannel || !PAYMENT_CHANNEL_VALUES.has(paymentChannel)) {
    return badRequest("Invalid paymentChannel");
  }
  if (!proofPath && paymentChannel === "image_proof") {
    return badRequest("proofPath is required for image_proof");
  }
  if (proofPath) {
    if (!proofPath.startsWith("registration/")) return badRequest("Invalid proofPath");
    const ext = getExtensionFromFileName(proofPath);
    if (!ext || !ACCOUNT_REG_ALLOWED_EXTENSIONS.has(ext)) return badRequest("Invalid proofPath extension");
  }

  const submitRateLimit = await consumeRateLimit({
    scope: "account_registration.submit",
    subject: `${getRequestIp(req)}:${email}`,
    maxHits: ACCOUNT_REG_SUBMIT_RATE_LIMIT,
    windowSeconds: ACCOUNT_REG_SUBMIT_RATE_WINDOW_SECONDS,
  });
  if (!submitRateLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "account_registration.submit",
      retry_after_seconds: submitRateLimit.retryAfterSeconds,
    });
  }

  if (proofPath) {
    const { error: signedError } = await admin.storage.from("payment-proof").createSignedUrl(proofPath, 60);
    if (signedError) return fail(400, "INVALID_PROOF_PATH");
  }

  const automationSettings = await getStoreAutomationSettings(admin);
  let ocrDetected: ReceiptOcrDetection | null = null;
  let ocrErrorCode: string | null = null;
  let ocrProvider: string | null = null;
  const shouldRunServerOcr = paymentChannel === "image_proof" && Boolean(proofPath) && automationSettings.account.enabled;
  if (shouldRunServerOcr && proofPath) {
    const attempt = await extractReceiptFieldsFromStoragePath(
      admin,
      "payment-proof",
      proofPath,
      "account_registration",
    ).catch(() => ({ detected: null, errorCode: "OCR_FAILED", provider: OCR_SPACE_PROVIDER, elapsedMs: 0 } satisfies ReceiptOcrAttempt));
    if (attempt.detected) {
      ocrDetected = attempt.detected;
      ocrProvider = attempt.detected.provider;
      if (!payerName && attempt.detected.payerName) payerName = attempt.detected.payerName;
      if (!referenceNo && attempt.detected.referenceNo) referenceNo = attempt.detected.referenceNo;
    } else {
      ocrErrorCode = attempt.errorCode || (String(Deno.env.get("OCR_SPACE_API_KEY") || "").trim() ? "OCR_FAILED" : "OCR_UNAVAILABLE");
      ocrProvider = attempt.provider;
    }
  } else if (paymentChannel === "image_proof" && proofPath) {
    ocrErrorCode = "MANUAL_REVIEW_MODE";
  }
  const ocrMetadata = buildReceiptOcrMetadata(ocrDetected, ocrErrorCode, ocrProvider);
  const { data: paymentSettings, error: paymentSettingsError } = await admin
    .from("store_payment_settings")
    .select("gcash_number,maya_number")
    .eq("id", "default")
    .maybeSingle();
  if (paymentSettingsError) return fail(500, paymentSettingsError.message);

  const existingAuthUser = await findAuthUserByEmail(admin, email);
  if (existingAuthUser) return fail(409, "EMAIL_ALREADY_REGISTERED");

  const { data: existingReqs, error: existingReqsError } = await admin
    .from("account_registration_requests")
    .select("id,status,created_at")
    .eq("email_normalized", email)
    .order("created_at", { ascending: false });
  if (existingReqsError) return fail(500, existingReqsError.message);

  const hasPending = (existingReqs || []).some((row: any) => row.status === "pending");
  if (hasPending) return fail(409, "ACCOUNT_REGISTRATION_PENDING");
  const hasApproved = (existingReqs || []).some((row: any) => row.status === "approved");
  if (hasApproved) return fail(409, "EMAIL_ALREADY_REGISTERED");

  const { ciphertext, iv, keyVersion } = await encryptRegistrationPassword(password);
  const { data: paymentConfig } = await admin
    .from("store_payment_settings")
    .select("instructions,gcash_number,maya_number,messenger_url,qr_image_path,account_price_php,updated_at")
    .eq("id", "default")
    .eq("is_active", true)
    .maybeSingle();
  const paymentSnapshot = paymentConfig || {};
  const receiptReference = buildAccountReceiptReference();
  const insertPayload: Record<string, unknown> = {
    email,
    display_name: displayName,
    password_ciphertext: ciphertext,
    password_iv: iv,
    password_key_version: keyVersion,
    status: "pending",
    payment_channel: paymentChannel,
    payer_name: payerName || null,
    reference_no: referenceNo || null,
    receipt_reference: receiptReference,
    notes: notes || null,
    proof_path: proofPath || null,
    payment_settings_snapshot: paymentSnapshot,
    account_price_php_snapshot: asPriceNumber((paymentConfig as any)?.account_price_php),
    decision_email_status: "pending",
    ocr_reference_no: ocrMetadata.referenceNo,
    ocr_payer_name: ocrMetadata.payerName,
    ocr_amount_php: ocrMetadata.amountPhp,
    ocr_recipient_number: ocrMetadata.recipientNumber,
    ocr_provider: ocrMetadata.provider,
    ocr_scanned_at: ocrMetadata.scannedAt,
    ocr_status: ocrMetadata.status,
    ocr_error_code: ocrMetadata.errorCode,
  };

  let insertResult = await admin
    .from("account_registration_requests")
    .insert(insertPayload)
    .select("id,status,created_at,receipt_reference")
    .single();
  if (insertResult.error && /receipt_reference/i.test(insertResult.error.message || "")) {
    const { receipt_reference: _drop, ...fallbackPayload } = insertPayload;
    insertResult = await admin
      .from("account_registration_requests")
      .insert(fallbackPayload)
      .select("id,status,created_at")
      .single();
  }
  const { data, error } = insertResult;

  if (error) {
    if ((error.message || "").toLowerCase().includes("ux_account_reg_pending_email")) {
      return fail(409, "ACCOUNT_REGISTRATION_PENDING");
    }
    if ((error.message || "").toLowerCase().includes("ux_account_reg_approved_email")) {
      return fail(409, "EMAIL_ALREADY_REGISTERED");
    }
    return fail(500, error.message);
  }

  const requestRow = {
    ...insertPayload,
    id: data.id,
    created_at: (data as any)?.created_at || new Date().toISOString(),
    receipt_reference: (data as any)?.receipt_reference || receiptReference,
    status: "pending",
  };

  await swallowDiscordError(() =>
    sendDiscordAccountRegistrationEvent({
      severity: "info",
      title: "Account Registration Submitted",
      description: "A new account registration request was submitted.",
      requestId: String(data.id),
      email,
      displayName,
      paymentChannel,
      payerName: payerName || null,
      referenceNo: ocrMetadata.referenceNo || referenceNo || null,
      receiptReference: asString(requestRow.receipt_reference, 160) || null,
      proofPath: proofPath || null,
      extraFields: [
        { name: "Has Proof", value: proofPath ? "Yes" : "No", inline: true },
      ],
    })
  );
  if (shouldNotifyOcrFailure(ocrMetadata.errorCode)) {
    await swallowDiscordError(() =>
      sendDiscordOcrFailureEvent({
        context: "account_registration",
        email,
        errorCode: ocrMetadata.errorCode,
        provider: ocrMetadata.provider,
        receiptReference: asString(requestRow.receipt_reference, 160) || null,
        requestId: String(data.id),
      })
    );
  }

  let automationResult: AutomationReason = "not_image_proof";
  let autoApproved = false;

  if (paymentChannel === "image_proof") {
    if (!automationSettings.account.enabled) {
      automationResult = "manual_review_disabled";
    } else if (!ocrDetected) {
      automationResult = "ocr_failed";
    } else if (!ocrMetadata.referenceNo) {
      automationResult = "missing_reference";
    } else if (ocrMetadata.amountPhp === null) {
      automationResult = "missing_amount";
    } else if (!ocrMetadata.recipientNumber) {
      automationResult = "missing_recipient_number";
    } else {
      const reserved = await tryReservePaymentReference({
        admin,
        sourceReference: ocrMetadata.referenceNo,
        sourceTable: "account_registration_requests",
        sourceRequestId: String(data.id),
      });
      if (reserved.errorMessage) {
        automationResult = "approval_error";
      } else if (!reserved.reserved) {
        automationResult = "duplicate_reference";
      } else if (!isWithinAutoApprovalWindow(automationSettings.account)) {
        automationResult = "outside_window";
      } else if (!matchesConfiguredWalletRecipient({
        paymentChannel,
        detectedRecipientNumber: ocrMetadata.recipientNumber,
        paymentConfig,
        })) {
          automationResult = "wallet_number_mismatch";
        } else {
          const expectedAmount = roundMoney(asPriceNumber((paymentConfig as any)?.account_price_php) || 0);
          const detectedAmount = roundMoney(ocrMetadata.amountPhp);
          if (!matchesAutoApprovalAmount(expectedAmount, detectedAmount)) {
            automationResult = "amount_mismatch";
          } else {
            automationResult = "approved";
            autoApproved = true;
          }
      }
    }
  }

  if (autoApproved) {
    const autoApprovalResponse = await executeAccountApproval({
      admin,
      requestRow,
      reviewedAtIso: new Date().toISOString(),
      reviewedBy: null,
      decisionSource: "automation",
      assisted: false,
      automationResult,
    });
    if (autoApprovalResponse.ok || autoApprovalResponse.status < 500) {
      return autoApprovalResponse;
    }
    automationResult = "approval_error";
  }

  await admin
    .from("account_registration_requests")
    .update({ automation_result: automationResult })
    .eq("id", data.id);

  const pendingEmailResult = await sendAccountPendingSubmissionEmail({
    admin,
    requestRow,
  });

  if (pendingEmailResult.status !== "skipped") {
    await admin
      .from("account_registration_requests")
      .update({
        decision_email_status: pendingEmailResult.status,
        decision_email_error: pendingEmailResult.error,
      })
      .eq("id", data.id);
  }

  return ok({
    requestId: data.id,
    status: "pending",
    auto_approved: false,
    payer_name: payerName || null,
    reference_no: ocrMetadata.referenceNo || referenceNo || null,
    receipt_reference: (data as any)?.receipt_reference || receiptReference,
    decision_email_status: pendingEmailResult.status,
    decision_email_error: pendingEmailResult.error,
    pending_email_status: pendingEmailResult.status,
    pending_email_error: pendingEmailResult.error,
    wait_message:
      "Your account request is under confirmation. Please wait up to 24 hours and check your email for updates.",
  });
};

const getAccountRegistrationLoginHint = async (req: Request, body: any) => {
  const admin = createServiceClient();
  const email = normalizeEmail(body?.email);
  if (!email) return badRequest("A valid email is required");

  const hintRateLimit = await consumeRateLimit({
    scope: "account_registration.login_hint",
    subject: `${getRequestIp(req)}:${email}`,
    maxHits: ACCOUNT_REG_LOGIN_HINT_RATE_LIMIT,
    windowSeconds: ACCOUNT_REG_LOGIN_HINT_RATE_WINDOW_SECONDS,
  });
  if (!hintRateLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "account_registration.login_hint",
      retry_after_seconds: hintRateLimit.retryAfterSeconds,
    });
  }

  const existingAuthUser = await findAuthUserByEmail(admin, email);
  if (existingAuthUser) {
    return ok({ status: "approved_or_registered" });
  }

  const { data: latest, error } = await admin
    .from("account_registration_requests")
    .select("id,status,rejection_message,created_at")
    .eq("email_normalized", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!latest) return ok({ status: "none" });
  if (latest.status === "pending") {
    return ok({ status: "pending", request_id: latest.id, created_at: latest.created_at });
  }
  if (latest.status === "rejected") {
    return ok({
      status: "rejected",
      request_id: latest.id,
      created_at: latest.created_at,
      rejection_message: latest.rejection_message || null,
    });
  }
  return ok({ status: "approved_or_registered" });
};

const buildReceiptOcrMetadata = (
  detected: ReceiptOcrDetection | null,
  fallbackErrorCode: string | null,
  fallbackProvider: string | null = null,
): ReceiptOcrMetadata => {
  if (!detected) {
    if (!fallbackErrorCode) {
      return {
        referenceNo: null,
        payerName: null,
        amountPhp: null,
        recipientNumber: null,
        provider: null,
        scannedAt: null,
        status: "skipped",
        errorCode: null,
      };
    }
    if (fallbackErrorCode === "MANUAL_REVIEW_MODE") {
      return {
        referenceNo: null,
        payerName: null,
        amountPhp: null,
        recipientNumber: null,
        provider: null,
        scannedAt: new Date().toISOString(),
        status: "skipped",
        errorCode: fallbackErrorCode,
      };
    }
    return {
      referenceNo: null,
      payerName: null,
      amountPhp: null,
      recipientNumber: null,
      provider: fallbackErrorCode === "OCR_UNAVAILABLE" ? null : fallbackProvider,
      scannedAt: new Date().toISOString(),
      status: fallbackErrorCode === "OCR_UNAVAILABLE" ? "unavailable" : "failed",
      errorCode: fallbackErrorCode || "OCR_FAILED",
    };
  }
  const hasReference = Boolean(detected.referenceNo);
  const hasAmount = detected.amountPhp !== null;
  const hasRecipientNumber = Boolean(detected.recipientNumber);
  let status: OcrStatus = "detected";
  if (!hasReference) status = "missing_reference";
  else if (!hasAmount) status = "missing_amount";
  else if (!hasRecipientNumber) status = "missing_recipient_number";
  return {
    referenceNo: detected.referenceNo,
    payerName: detected.payerName,
    amountPhp: detected.amountPhp,
    recipientNumber: detected.recipientNumber,
    provider: detected.provider,
    scannedAt: new Date().toISOString(),
    status,
    errorCode: null,
  };
};

const disableExpiredCountdowns = async (admin: ReturnType<typeof createServiceClient>): Promise<void> => {
  const nowIso = new Date().toISOString();
  await admin
    .from("store_payment_settings")
    .update({
      account_auto_approve_enabled: false,
      account_auto_approve_expires_at: null,
    })
    .eq("id", "default")
    .eq("account_auto_approve_enabled", true)
    .eq("account_auto_approve_mode", "countdown")
    .lt("account_auto_approve_expires_at", nowIso);

  await admin
    .from("store_payment_settings")
    .update({
      store_auto_approve_enabled: false,
      store_auto_approve_expires_at: null,
    })
    .eq("id", "default")
    .eq("store_auto_approve_enabled", true)
    .eq("store_auto_approve_mode", "countdown")
    .lt("store_auto_approve_expires_at", nowIso);

  await admin
    .from("store_payment_settings")
    .update({
      installer_v2_auto_approve_enabled: false,
      installer_v2_auto_approve_expires_at: null,
    })
    .eq("id", "default")
    .eq("installer_v2_auto_approve_enabled", true)
    .eq("installer_v2_auto_approve_mode", "countdown")
    .lt("installer_v2_auto_approve_expires_at", nowIso);

  await admin
    .from("store_payment_settings")
    .update({
      installer_v3_auto_approve_enabled: false,
      installer_v3_auto_approve_expires_at: null,
    })
    .eq("id", "default")
    .eq("installer_v3_auto_approve_enabled", true)
    .eq("installer_v3_auto_approve_mode", "countdown")
    .lt("installer_v3_auto_approve_expires_at", nowIso);
};

const getStoreAutomationSettings = async (admin: ReturnType<typeof createServiceClient>) => {
  await disableExpiredCountdowns(admin);
  const { data, error } = await admin
    .from("store_payment_settings")
    .select(
      "id,account_auto_approve_enabled,account_auto_approve_mode,account_auto_approve_start_hour,account_auto_approve_end_hour,account_auto_approve_duration_hours,account_auto_approve_expires_at,store_auto_approve_enabled,store_auto_approve_mode,store_auto_approve_start_hour,store_auto_approve_end_hour,store_auto_approve_duration_hours,store_auto_approve_expires_at,installer_v2_auto_approve_enabled,installer_v2_auto_approve_mode,installer_v2_auto_approve_start_hour,installer_v2_auto_approve_end_hour,installer_v2_auto_approve_duration_hours,installer_v2_auto_approve_expires_at,installer_v3_auto_approve_enabled,installer_v3_auto_approve_mode,installer_v3_auto_approve_start_hour,installer_v3_auto_approve_end_hour,installer_v3_auto_approve_duration_hours,installer_v3_auto_approve_expires_at",
    )
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    account: {
      enabled: Boolean((data as any)?.account_auto_approve_enabled),
      mode: normalizeAutoApprovalMode((data as any)?.account_auto_approve_mode),
      startHour: normalizeAutoApprovalHour((data as any)?.account_auto_approve_start_hour),
      endHour: normalizeAutoApprovalHour((data as any)?.account_auto_approve_end_hour),
      durationHours: normalizeAutoApprovalDurationHours((data as any)?.account_auto_approve_duration_hours),
      expiresAt: asString((data as any)?.account_auto_approve_expires_at, 80) || null,
    },
    store: {
      enabled: Boolean((data as any)?.store_auto_approve_enabled),
      mode: normalizeAutoApprovalMode((data as any)?.store_auto_approve_mode),
      startHour: normalizeAutoApprovalHour((data as any)?.store_auto_approve_start_hour),
      endHour: normalizeAutoApprovalHour((data as any)?.store_auto_approve_end_hour),
      durationHours: normalizeAutoApprovalDurationHours((data as any)?.store_auto_approve_duration_hours),
      expiresAt: asString((data as any)?.store_auto_approve_expires_at, 80) || null,
    },
    installerV2: {
      enabled: Boolean((data as any)?.installer_v2_auto_approve_enabled),
      mode: normalizeAutoApprovalMode((data as any)?.installer_v2_auto_approve_mode),
      startHour: normalizeAutoApprovalHour((data as any)?.installer_v2_auto_approve_start_hour),
      endHour: normalizeAutoApprovalHour((data as any)?.installer_v2_auto_approve_end_hour),
      durationHours: normalizeAutoApprovalDurationHours((data as any)?.installer_v2_auto_approve_duration_hours),
      expiresAt: asString((data as any)?.installer_v2_auto_approve_expires_at, 80) || null,
    },
    installerV3: {
      enabled: Boolean((data as any)?.installer_v3_auto_approve_enabled),
      mode: normalizeAutoApprovalMode((data as any)?.installer_v3_auto_approve_mode),
      startHour: normalizeAutoApprovalHour((data as any)?.installer_v3_auto_approve_start_hour),
      endHour: normalizeAutoApprovalHour((data as any)?.installer_v3_auto_approve_end_hour),
      durationHours: normalizeAutoApprovalDurationHours((data as any)?.installer_v3_auto_approve_duration_hours),
      expiresAt: asString((data as any)?.installer_v3_auto_approve_expires_at, 80) || null,
    },
  };
};

const reservePaymentReference = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  sourceReference: string;
  sourceTable: "account_registration_requests" | "bank_purchase_requests" | "installer_purchase_requests";
  sourceRequestId: string | null;
}): Promise<{ reserved: boolean; normalizedReference: string | null }> => {
  const normalizedReference = normalizePaymentReferenceRegistryKey(input.sourceReference);
  if (!normalizedReference) return { reserved: false, normalizedReference: null };
  const { data, error } = await input.admin.rpc("claim_payment_reference", {
    p_source_reference: input.sourceReference,
    p_source_table: input.sourceTable,
    p_source_request_id: input.sourceRequestId,
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return {
      reserved: Boolean((row as any)?.reserved),
      normalizedReference: asString((row as any)?.normalized_reference, 160) || normalizedReference,
    };
  }
  throw new Error(error.message);
};

const tryReservePaymentReference = async (input: Parameters<typeof reservePaymentReference>[0]): Promise<{
  reserved: boolean;
  normalizedReference: string | null;
  errorMessage: string | null;
}> => {
  try {
    const result = await reservePaymentReference(input);
    return { ...result, errorMessage: null };
  } catch (error) {
    return {
      reserved: false,
      normalizedReference: normalizePaymentReferenceRegistryKey(input.sourceReference),
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildAccountApprovalLoginHint = (assisted: boolean): string =>
  assisted
    ? "Your account is approved. Sign in using the temporary password provided by the admin. If you do not have it, use Reset Password on the login screen."
    : "Your account is approved. Sign in using the password you registered. If you forgot it, use Reset Password on the login screen.";

const cleanupCreatedAuthUser = async (
  admin: ReturnType<typeof createServiceClient>,
  authUserId: string | null,
): Promise<void> => {
  if (!authUserId) return;
  try {
    await admin.auth.admin.deleteUser(authUserId);
  } catch {
    // Best-effort cleanup for partially-created auth users.
  }
};

const executeAccountApproval = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  requestRow: any;
  reviewedAtIso: string;
  reviewedBy: string | null;
  decisionSource: "manual" | "automation";
  assisted: boolean;
  temporaryPassword?: string | null;
  automationResult?: string | null;
}) => {
  const resolvedAutomationResult =
    input.decisionSource === "manual"
      ? (asString(input.requestRow?.automation_result, 120) || null)
      : (input.automationResult || null);
  const existingAuthUser = await findAuthUserByEmail(input.admin, input.requestRow.email);
  if (existingAuthUser) return fail(409, "EMAIL_ALREADY_REGISTERED");

  let resolvedPassword = "";
  if (input.assisted && String(input.temporaryPassword || "").trim()) {
    resolvedPassword = String(input.temporaryPassword || "").trim();
  } else {
    try {
      resolvedPassword = await decryptRegistrationPassword({
        ciphertext: String(input.requestRow.password_ciphertext || ""),
        iv: String(input.requestRow.password_iv || ""),
      });
    } catch (err) {
      return fail(500, `Failed to decrypt password: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let authUserId: string | null = null;
  let createdNewAuthUser = false;
  const createResult = await input.admin.auth.admin.createUser({
    email: input.requestRow.email,
    password: resolvedPassword,
    email_confirm: true,
    user_metadata: input.assisted
      ? {
        display_name: input.requestRow.display_name || "User",
        registration_assisted: true,
        registration_assisted_at: input.reviewedAtIso,
      }
      : { display_name: input.requestRow.display_name || "User" },
  } as any);
  if (createResult.error) {
    const existingAfterCreate = await findAuthUserByEmail(input.admin, input.requestRow.email);
    if (existingAfterCreate?.id) authUserId = existingAfterCreate.id;
    else return fail(500, `Account create failed (${normalizeAuthErrorMessage(createResult.error)})`);
  } else {
    authUserId = createResult.data?.user?.id || null;
    createdNewAuthUser = Boolean(authUserId);
  }

  if (!authUserId) authUserId = (await findAuthUserByEmail(input.admin, input.requestRow.email))?.id || null;
  if (!authUserId) return fail(500, "Failed to resolve approved user id");

  const userMetadata: Record<string, unknown> = { display_name: input.requestRow.display_name || "User" };
  if (input.assisted) {
    userMetadata.registration_assisted = true;
    userMetadata.registration_assisted_at = input.reviewedAtIso;
  }

  const updateAuthResult = await input.admin.auth.admin.updateUserById(authUserId, {
    password: resolvedPassword,
    email_confirm: true,
    user_metadata: userMetadata,
  } as any);
  if (updateAuthResult.error) {
    if (createdNewAuthUser) await cleanupCreatedAuthUser(input.admin, authUserId);
    return fail(500, updateAuthResult.error.message);
  }

  const samplerConfigResult = await getNormalizedSamplerAppConfig(input.admin);
  if (samplerConfigResult.error) {
    if (createdNewAuthUser) await cleanupCreatedAuthUser(input.admin, authUserId);
    return fail(500, samplerConfigResult.error.message);
  }
  const quotaDefaults = samplerConfigResult.config.quotaDefaults;

  const { error: profileUpsertError } = await input.admin
    .from("profiles")
    .upsert(
      {
        id: authUserId,
        role: "user",
        display_name: input.requestRow.display_name || input.requestRow.email,
        owned_bank_quota: quotaDefaults.ownedBankQuota,
        owned_bank_pad_cap: quotaDefaults.ownedBankPadCap,
        device_total_bank_cap: quotaDefaults.deviceTotalBankCap,
        updated_at: input.reviewedAtIso,
      },
      { onConflict: "id" },
    );
  if (profileUpsertError) {
    if (createdNewAuthUser) await cleanupCreatedAuthUser(input.admin, authUserId);
    return fail(500, profileUpsertError.message);
  }

  const { error: updateError } = await input.admin
    .from("account_registration_requests")
    .update({
      status: "approved",
      rejection_message: null,
      reviewed_by: input.reviewedBy,
      reviewed_at: input.reviewedAtIso,
      approved_auth_user_id: authUserId,
      decision_email_status: "skipped",
      decision_email_error: null,
      password_ciphertext: null,
      password_iv: null,
      decision_source: input.decisionSource,
      automation_result: resolvedAutomationResult,
    })
    .eq("id", input.requestRow.id)
    .eq("status", "pending");
  if (updateError) {
    if (createdNewAuthUser) await cleanupCreatedAuthUser(input.admin, authUserId);
    return fail(500, updateError.message);
  }

  let approvalEmailResult: { status: "sent" | "failed" | "skipped"; error: string | null } = {
    status: "skipped",
    error: input.assisted ? "Skipped by assisted approval" : null,
  };
  if (!input.assisted) {
    approvalEmailResult = await sendAccountApprovalDecisionEmail({
      admin: input.admin,
      requestRow: input.requestRow,
      reviewedAtIso: input.reviewedAtIso,
      loginHint: buildAccountApprovalLoginHint(false),
    });
    await input.admin
      .from("account_registration_requests")
      .update({
        decision_email_status: approvalEmailResult.status,
        decision_email_error: approvalEmailResult.error,
      })
      .eq("id", input.requestRow.id);
  }

  await swallowDiscordError(() =>
    sendDiscordAccountRegistrationEvent({
      severity: input.decisionSource === "automation" ? "warning" : "info",
      title: "Account Request Approved",
      description: input.decisionSource === "automation"
        ? "Account request was auto-approved."
        : "Account request was approved by admin.",
      requestId: String(input.requestRow.id),
      email: asString(input.requestRow.email, 320) || "unknown",
      displayName: asString(input.requestRow.display_name, 160) || null,
      paymentChannel: asString(input.requestRow.payment_channel, 80) || null,
      payerName: asString(input.requestRow.payer_name, 160) || null,
      referenceNo: asString(input.requestRow.ocr_reference_no, 160) || asString(input.requestRow.reference_no, 160) || null,
      receiptReference: asString(input.requestRow.receipt_reference, 160) || null,
      decisionSource: input.decisionSource,
      automationResult: resolvedAutomationResult,
      actorUserId: input.reviewedBy,
      extraFields: [
        { name: "Assisted", value: input.assisted ? "Yes" : "No", inline: true },
        { name: "Approved User", value: authUserId, inline: true },
      ],
    })
  );

  return ok({
    requestId: input.requestRow.id,
    status: "approved",
    auth_user_id: authUserId,
    decision_email_status: approvalEmailResult.status,
    decision_email_error: approvalEmailResult.error,
    assisted_approval: input.assisted,
    auto_approved: input.decisionSource === "automation",
    payer_name: asString(input.requestRow.payer_name, 160) || null,
    reference_no: asString(input.requestRow.ocr_reference_no, 160) || asString(input.requestRow.reference_no, 160) || null,
    receipt_reference: asString(input.requestRow.receipt_reference, 160) || null,
  });
};

const executeStoreDecision = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  batchRows: any[];
  nextStatus: "approved" | "rejected";
  rejectionMessage: string | null;
  reviewedAtIso: string;
  reviewedBy: string | null;
  decisionSource: "manual" | "automation";
  automationResult?: string | null;
}) => {
  const rowIds = input.batchRows.map((row) => row.id);
  const rpc = await input.admin.rpc("apply_store_request_decision", {
    p_request_ids: rowIds,
    p_next_status: input.nextStatus,
    p_reviewed_by: input.reviewedBy,
    p_reviewed_at: input.reviewedAtIso,
    p_rejection_message: input.rejectionMessage,
    p_decision_source: input.decisionSource,
    p_automation_result: input.automationResult || null,
  });
  if (rpc.error) return fail(500, rpc.error.message);
  const appliedIds = Array.isArray(rpc.data)
    ? rpc.data.map((row: any) => String(row?.id || "")).filter(Boolean)
    : [];
  if (appliedIds.length !== rowIds.length) {
    return fail(409, "One or more store requests could not be updated atomically");
  }

  const emailResults = await sendStoreDecisionEmailsByUser({
    admin: input.admin,
    rows: input.batchRows,
    nextStatus: input.nextStatus,
    rejectionMessage: input.rejectionMessage,
    reviewedAtIso: input.reviewedAtIso,
  });
  for (const result of emailResults.perUser) {
    const emailUpdateResult = await input.admin
      .from("bank_purchase_requests")
      .update({
        decision_email_status: result.status,
        decision_email_error: result.error,
      })
      .in("id", result.rowIds);
    if (emailUpdateResult.error && !/decision_email_status|decision_email_error/i.test(emailUpdateResult.error.message || "")) {
      return fail(500, emailUpdateResult.error.message);
    }
  }

  await swallowDiscordError(() =>
    sendDiscordStoreRequestEvent({
      severity: input.nextStatus === "rejected" ? "warning" : (input.decisionSource === "automation" ? "warning" : "info"),
      title: input.nextStatus === "approved" ? "Store Request Approved" : "Store Request Rejected",
      description: input.decisionSource === "automation"
        ? `Store request was ${input.nextStatus} automatically.`
        : `Store request was ${input.nextStatus} by admin.`,
      requestId: String(rowIds[0] || ""),
      userId: asString(input.batchRows[0]?.user_id, 80) || null,
      actorUserId: input.reviewedBy,
      bankIds: input.batchRows.map((row) => asString(row?.bank_id, 80) || "").filter(Boolean),
      catalogItemIds: input.batchRows.map((row) => asString(row?.catalog_item_id, 80) || "").filter(Boolean),
      batchId: asString(input.batchRows[0]?.batch_id, 80) || null,
      receiptReference: asString(input.batchRows[0]?.receipt_reference, 160) || null,
      paymentChannel: asString(input.batchRows[0]?.payment_channel, 80) || null,
      payerName: asString(input.batchRows[0]?.payer_name, 160) || null,
      referenceNo: asString(input.batchRows[0]?.ocr_reference_no, 160) || asString(input.batchRows[0]?.reference_no, 160) || null,
      decisionSource: input.decisionSource,
      automationResult: input.automationResult || null,
      extraFields: [
        { name: "Request Count", value: String(input.batchRows.length), inline: true },
        ...(input.rejectionMessage ? [{ name: "Reason", value: input.rejectionMessage, inline: false } as DiscordField] : []),
      ],
    })
  );

  return ok({
    ids: appliedIds,
    requestIds: appliedIds,
    batchId: asString(input.batchRows[0]?.batch_id, 80) || null,
    status: input.nextStatus,
    decision_email_status: emailResults.aggregate.status,
    decision_email_error: emailResults.aggregate.error,
    auto_approved: input.decisionSource === "automation",
    payer_name: asString(input.batchRows[0]?.payer_name, 160) || null,
    reference_no: asString(input.batchRows[0]?.ocr_reference_no, 160) || asString(input.batchRows[0]?.reference_no, 160) || null,
    receipt_reference: asString(input.batchRows[0]?.receipt_reference, 160) || null,
  });
};

const listAdminAccountRegistrationRequests = async (req: Request) => {
  const admin = createServiceClient();
  const url = new URL(req.url);
  const filter = String(url.searchParams.get("filter") || "pending").toLowerCase();
  const q = asString(url.searchParams.get("q"), 120);
  const status = String(url.searchParams.get("status") || "all").toLowerCase();
  const paymentChannel = String(url.searchParams.get("paymentChannel") || "all").toLowerCase();
  const decisionSource = String(url.searchParams.get("decisionSource") || "all").toLowerCase();
  const automationResult = String(url.searchParams.get("automationResult") || "all").toLowerCase();
  const ocrStatus = String(url.searchParams.get("ocrStatus") || "all").toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get("perPage") || 50)));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query: any = admin
    .from("account_registration_requests")
    .select(
      "id,email,display_name,status,payment_channel,payer_name,reference_no,receipt_reference,notes,proof_path,rejection_message,decision_email_status,decision_email_error,reviewed_by,reviewed_at,approved_auth_user_id,created_at,ocr_reference_no,ocr_payer_name,ocr_amount_php,ocr_recipient_number,ocr_provider,ocr_scanned_at,ocr_status,ocr_error_code,decision_source,automation_result",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (filter === "pending") query = query.eq("status", "pending");
  else if (filter === "history") query = query.neq("status", "pending");

  if (status === "pending" || status === "approved" || status === "rejected") {
    query = query.eq("status", status);
  }
  if (paymentChannel === "image_proof" || paymentChannel === "gcash_manual" || paymentChannel === "maya_manual") {
    query = query.eq("payment_channel", paymentChannel);
  }
  if (decisionSource === "manual" || decisionSource === "automation") {
    query = query.eq("decision_source", decisionSource);
  }
  if (
    automationResult === "approved"
    || automationResult === "manual_review_disabled"
    || automationResult === "outside_window"
    || automationResult === "missing_reference"
    || automationResult === "missing_amount"
    || automationResult === "missing_recipient_number"
    || automationResult === "duplicate_reference"
    || automationResult === "wallet_number_mismatch"
    || automationResult === "amount_mismatch"
    || automationResult === "ocr_failed"
    || automationResult === "approval_error"
    || automationResult === "not_image_proof"
  ) {
    query = query.eq("automation_result", automationResult);
  }
  if (
    ocrStatus === "detected"
    || ocrStatus === "missing_reference"
    || ocrStatus === "missing_amount"
    || ocrStatus === "missing_recipient_number"
    || ocrStatus === "failed"
    || ocrStatus === "unavailable"
    || ocrStatus === "skipped"
  ) {
    query = query.eq("ocr_status", ocrStatus);
  }

  if (q) {
    const escaped = q.replace(/[%_]/g, "");
    query = query.or(
      `email.ilike.%${escaped}%,display_name.ilike.%${escaped}%,payer_name.ilike.%${escaped}%,reference_no.ilike.%${escaped}%,ocr_reference_no.ilike.%${escaped}%,ocr_recipient_number.ilike.%${escaped}%,receipt_reference.ilike.%${escaped}%`,
    );
  }

  const [{ count: pendingCount, error: pendingCountError }, { count: historyCount, error: historyCountError }] = await Promise.all([
    admin
      .from("account_registration_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("account_registration_requests")
      .select("id", { count: "exact", head: true })
      .neq("status", "pending"),
  ]);
  if (pendingCountError) return fail(500, pendingCountError.message);
  if (historyCountError) return fail(500, historyCountError.message);

  query = query.range(from, to);
  const { data, error, count } = await query;
  if (error) return fail(500, error.message);
  return ok({
    requests: data || [],
    page,
    perPage,
    total: Number(count || 0),
    pendingCount: Number(pendingCount || 0),
    historyCount: Number(historyCount || 0),
    filter,
  });
};

const adminAccountRegistrationRequestAction = async (requestId: string, body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const action = String(body?.action || "").toLowerCase();
  if (action !== "approve" && action !== "approve_assisted" && action !== "reject") return badRequest("Invalid action");
  const rejectionMessage = asString(body?.rejection_message, 1000);
  const temporaryPassword = asString(body?.temporary_password, 200);
  if (action === "reject" && !rejectionMessage) return badRequest("rejection_message is required");
  if (action === "approve_assisted" && temporaryPassword && temporaryPassword.length < ACCOUNT_REG_MIN_PASSWORD_LENGTH) {
    return fail(400, "WEAK_PASSWORD", { min_length: ACCOUNT_REG_MIN_PASSWORD_LENGTH });
  }

  const { data: requestRow, error: requestError } = await admin
    .from("account_registration_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return fail(500, requestError.message);
  if (!requestRow) return fail(404, "Request not found");
  if (requestRow.status !== "pending") return badRequest("Request is not pending");

  const nowIso = new Date().toISOString();

  if (action === "approve" || action === "approve_assisted") {
    return await executeAccountApproval({
      admin,
      requestRow,
      reviewedAtIso: nowIso,
      reviewedBy: adminUserId,
      decisionSource: "manual",
      assisted: action === "approve_assisted",
      temporaryPassword: temporaryPassword || null,
    });
  }

  const rejectionEmailResult = await sendAccountRejectionDecisionEmail({
    requestRow,
    rejectionMessage: rejectionMessage || null,
    reviewedAtIso: nowIso,
  });
  const decisionEmailStatus = rejectionEmailResult.status;
  const decisionEmailError = rejectionEmailResult.error;

  const rejectPayload: Record<string, unknown> = {
    status: "rejected",
    rejection_message: rejectionMessage || null,
    reviewed_by: adminUserId,
    reviewed_at: nowIso,
    decision_email_status: decisionEmailStatus,
    decision_email_error: decisionEmailError,
    password_ciphertext: null,
    password_iv: null,
    decision_source: "manual",
    automation_result: asString(requestRow?.automation_result, 120) || null,
  };
  const { error: rejectUpdateError } = await admin
    .from("account_registration_requests")
    .update(rejectPayload)
    .eq("id", requestId)
    .eq("status", "pending");
  if (rejectUpdateError) return fail(500, rejectUpdateError.message);

  await swallowDiscordError(() =>
    sendDiscordAccountRegistrationEvent({
      severity: "warning",
      title: "Account Request Rejected",
      description: "Account request was rejected by admin.",
      requestId,
      email: asString(requestRow.email, 320) || "unknown",
      displayName: asString(requestRow.display_name, 160) || null,
      paymentChannel: asString(requestRow.payment_channel, 80) || null,
      payerName: asString(requestRow.payer_name, 160) || null,
      referenceNo: asString(requestRow.ocr_reference_no, 160) || asString(requestRow.reference_no, 160) || null,
      receiptReference: asString(requestRow.receipt_reference, 160) || null,
      decisionSource: "manual",
      actorUserId: adminUserId,
      extraFields: rejectionMessage ? [{ name: "Reason", value: rejectionMessage, inline: false }] : [],
    })
  );

  return ok({
    requestId,
    status: "rejected",
    decision_email_status: decisionEmailStatus,
    decision_email_error: decisionEmailError,
  });
};

const adminAccountRegistrationRetryDecisionEmail = async (requestId: string, adminUserId: string) => {
  const admin = createServiceClient();
  const { data: requestRow, error: requestError } = await admin
    .from("account_registration_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return fail(500, requestError.message);
  if (!requestRow) return fail(404, "Request not found");
  if (requestRow.status !== "approved" && requestRow.status !== "rejected") {
    return badRequest("Only approved/rejected requests can retry decision email");
  }

  const nowIso = new Date().toISOString();
  let decisionEmailStatus: "sent" | "failed" | "skipped" = "skipped";
  let decisionEmailError: string | null = null;

  try {
    if (requestRow.status === "approved") {
      const existingAuthUser = await findAuthUserByEmail(admin, requestRow.email);
      if (!existingAuthUser) {
        throw new Error("Approved user account not found. Cannot retry decision email.");
      }
      const approvalEmailResult = await sendAccountApprovalDecisionEmail({
        admin,
        requestRow,
        reviewedAtIso: nowIso,
        loginHint: "Your account is approved. Sign in using your registered password.",
      });
      decisionEmailStatus = approvalEmailResult.status;
      decisionEmailError = approvalEmailResult.error;
    } else {
      const rejectionEmailResult = await sendAccountRejectionDecisionEmail({
        requestRow,
        rejectionMessage: asString(requestRow.rejection_message, 1000) || null,
        reviewedAtIso: nowIso,
      });
      decisionEmailStatus = rejectionEmailResult.status;
      decisionEmailError = rejectionEmailResult.error;
    }
  } catch (err) {
    decisionEmailStatus = "failed";
    decisionEmailError = err instanceof Error ? err.message : String(err);
  }

  const { error: updateError } = await admin
    .from("account_registration_requests")
    .update({
      decision_email_status: decisionEmailStatus,
      decision_email_error: decisionEmailError,
      reviewed_by: adminUserId,
      reviewed_at: nowIso,
    })
    .eq("id", requestId);
  if (updateError) return fail(500, updateError.message);

  return ok({
    requestId,
    status: requestRow.status,
    decision_email_status: decisionEmailStatus,
    decision_email_error: decisionEmailError,
  });
};

const createStorePurchaseRequest = async (req: Request, body: any) => {
  const admin = createServiceClient();
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  const userId = user?.id || null;
  if (!userId) return fail(401, "NOT_AUTHENTICATED");
  const maintenanceState = await getStoreMaintenanceState(req, admin);
  if ("response" in maintenanceState) return maintenanceState.response;
  if (maintenanceState.enabled && !maintenanceState.isAdmin) {
    return fail(503, "STORE_MAINTENANCE", {
      maintenance: {
        enabled: true,
        message: maintenanceState.message,
      },
    });
  }

  const purchaseLimit = await consumeRateLimit({
    scope: "store.purchase_request",
    subject: userId,
    maxHits: STORE_PURCHASE_RATE_LIMIT,
    windowSeconds: STORE_PURCHASE_RATE_WINDOW_SECONDS,
  });
  if (!purchaseLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "store.purchase_request",
      retry_after_seconds: purchaseLimit.retryAfterSeconds,
    });
  }

  const { bankId, catalogItemId, items, paymentChannel, payerName, referenceNo, proofPath, notes } = body || {};
  const normalizedPaymentChannel = asString(paymentChannel, 40);
  let normalizedPayerName = asString(payerName, 120);
  let normalizedReferenceNo = asString(referenceNo, 120);
  const normalizedProofPath = asString(proofPath, 500);
  const normalizedNotes = asString(notes, 1000);

  if (normalizedPaymentChannel && !PAYMENT_CHANNEL_VALUES.has(normalizedPaymentChannel)) {
    return badRequest("Invalid paymentChannel");
  }
  if (normalizedProofPath && !normalizedProofPath.startsWith(`${userId}/`)) {
    return badRequest("proofPath must be inside your own folder");
  }
  if (
    normalizedProofPath &&
    !/\.(png|jpg|jpeg|webp|gif|heic|heif)$/i.test(normalizedProofPath)
  ) {
    return badRequest("proofPath must be an image file");
  }
  if (normalizedPaymentChannel === "image_proof" && !normalizedProofPath) {
    return badRequest("proofPath is required for image_proof");
  }

  const automationSettings = await getStoreAutomationSettings(admin);
  let ocrDetected: ReceiptOcrDetection | null = null;
  let ocrErrorCode: string | null = null;
  let ocrProvider: string | null = null;
  const shouldRunServerOcr = normalizedPaymentChannel === "image_proof"
    && Boolean(normalizedProofPath)
    && automationSettings.store.enabled;
  if (shouldRunServerOcr && normalizedProofPath) {
    const attempt = await extractReceiptFieldsFromStoragePath(
      admin,
      "payment-proof",
      normalizedProofPath,
      "bank_store",
    ).catch(() => ({ detected: null, errorCode: "OCR_FAILED", provider: OCR_SPACE_PROVIDER, elapsedMs: 0 } satisfies ReceiptOcrAttempt));
    if (attempt.detected) {
      ocrDetected = attempt.detected;
      ocrProvider = attempt.detected.provider;
      if (!normalizedPayerName && attempt.detected.payerName) normalizedPayerName = attempt.detected.payerName;
      if (!normalizedReferenceNo && attempt.detected.referenceNo) normalizedReferenceNo = attempt.detected.referenceNo;
    } else {
      ocrErrorCode = attempt.errorCode || (String(Deno.env.get("OCR_SPACE_API_KEY") || "").trim() ? "OCR_FAILED" : "OCR_UNAVAILABLE");
      ocrProvider = attempt.provider;
    }
  } else if (normalizedPaymentChannel === "image_proof" && normalizedProofPath) {
    ocrErrorCode = "MANUAL_REVIEW_MODE";
  }
  const ocrMetadata = buildReceiptOcrMetadata(ocrDetected, ocrErrorCode, ocrProvider);
  const { data: paymentSettings, error: paymentSettingsError } = await admin
    .from("store_payment_settings")
    .select("gcash_number,maya_number")
    .eq("id", "default")
    .maybeSingle();
  if (paymentSettingsError) return fail(500, paymentSettingsError.message);

  const itemList: Array<{ bankId: string; catalogItemId?: string }> = Array.isArray(items) && items.length > 0
    ? items
    : bankId
      ? [{ bankId, catalogItemId }]
      : [];
  if (itemList.length === 0) return badRequest("Missing bankId or items");
  if (itemList.length > STORE_MAX_PURCHASE_ITEMS) {
    return fail(413, "TOO_MANY_ITEMS", { max_items: STORE_MAX_PURCHASE_ITEMS });
  }

  const normalizedItems: Array<{ bankId: string; catalogItemId: string }> = [];
  const seenBankIds = new Set<string>();
  for (const item of itemList) {
    const normalizedBankId = asUuid(item?.bankId);
    const normalizedCatalogItemId = asUuid(item?.catalogItemId);
    if (!normalizedBankId || !normalizedCatalogItemId) return badRequest("Each item must include valid bankId and catalogItemId");
    if (seenBankIds.has(normalizedBankId)) return badRequest("Duplicate bank in purchase request is not allowed");
    seenBankIds.add(normalizedBankId);
    normalizedItems.push({ bankId: normalizedBankId, catalogItemId: normalizedCatalogItemId });
  }

  const catalogItemIds = [...new Set(normalizedItems.map((item) => item.catalogItemId))];
  let catalogQuery: any = await admin
    .from("bank_catalog_items")
    .select("id, bank_id, is_paid, price_label, price_php, is_published, coming_soon, banks ( title )")
    .in("id", catalogItemIds);
  if (catalogQuery.error && /price_php/i.test(catalogQuery.error.message || "")) {
    catalogQuery = await admin
      .from("bank_catalog_items")
      .select("id, bank_id, is_paid, price_label, is_published, coming_soon, banks ( title )")
      .in("id", catalogItemIds);
  }
  if (catalogQuery.error) return fail(500, catalogQuery.error.message);
  const catalogRows = catalogQuery.data;

  const catalogById = new Map<string, any>();
  for (const row of catalogRows || []) catalogById.set(row.id, row);
  const promotionMap = await resolvePromotionsForCatalogItems(admin, catalogRows || []);
  const enrichedCatalogById = new Map<string, any>();
  for (const row of catalogRows || []) {
    const rowId = asString(row?.id, 80) || "";
    if (!rowId) continue;
    enrichedCatalogById.set(rowId, attachPromotionToCatalogItem(row, promotionMap.get(rowId) || null));
  }
  for (const item of normalizedItems) {
    const catalogRow = enrichedCatalogById.get(item.catalogItemId) || catalogById.get(item.catalogItemId);
    if (!catalogRow) return fail(400, `Catalog item not found: ${item.catalogItemId}`);
    if (catalogRow.bank_id !== item.bankId) return fail(400, `Catalog item ${item.catalogItemId} does not match bank ${item.bankId}`);
    if (!catalogRow.is_published) return fail(400, `Catalog item is not published: ${item.catalogItemId}`);
    if (catalogRow.coming_soon) return fail(409, "COMING_SOON");
  }

  const requestedBankIds = [...new Set(normalizedItems.map((item) => item.bankId))];
  const { data: bankRows, error: bankRowsError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .in("id", requestedBankIds);
  if (bankRowsError) return fail(500, bankRowsError.message);
  const deletedBankIds = new Set((bankRows || []).filter((b: any) => Boolean(b.deleted_at)).map((b: any) => b.id));
  for (const item of normalizedItems) {
    if (deletedBankIds.has(item.bankId)) return fail(400, `Bank is archived: ${item.bankId}`);
  }

  const batchId = crypto.randomUUID();
  const receiptReference = buildStoreReceiptReference(batchId);
  const rowsToInsert = normalizedItems.map((item) => {
    const catalogRow = enrichedCatalogById.get(item.catalogItemId) || catalogById.get(item.catalogItemId);
    const resolvedPromotion = promotionMap.get(item.catalogItemId) || null;
    return {
      user_id: userId,
      bank_id: item.bankId,
      catalog_item_id: item.catalogItemId,
      is_paid_snapshot: Boolean(catalogRow?.is_paid),
      price_label_snapshot: catalogRow?.price_label || (resolveCatalogPrice(catalogRow) !== null ? String(resolveCatalogPrice(catalogRow)) : null),
      price_php_snapshot: resolveCatalogPrice(catalogRow),
      original_price_php_snapshot: asPriceNumber(catalogRow?.original_price_php) ?? resolveCatalogPrice(catalogById.get(item.catalogItemId)),
      discount_amount_php_snapshot: asPriceNumber(catalogRow?.discount_amount_php) || 0,
      promotion_snapshot: buildPromotionSnapshot(resolvedPromotion),
      batch_id: batchId,
      status: "pending",
      payment_channel: normalizedPaymentChannel || null,
      payer_name: normalizedPayerName || null,
      reference_no: normalizedReferenceNo || null,
      receipt_reference: receiptReference,
      proof_path: normalizedProofPath || null,
      notes: normalizedNotes || null,
      ocr_reference_no: ocrMetadata.referenceNo,
      ocr_payer_name: ocrMetadata.payerName,
      ocr_amount_php: ocrMetadata.amountPhp,
      ocr_recipient_number: ocrMetadata.recipientNumber,
      ocr_provider: ocrMetadata.provider,
      ocr_scanned_at: ocrMetadata.scannedAt,
      ocr_status: ocrMetadata.status,
      ocr_error_code: ocrMetadata.errorCode,
    };
  });

  let insertResult = await admin.from("bank_purchase_requests").insert(rowsToInsert).select("id,receipt_reference");
  if (
    insertResult.error &&
    /is_paid_snapshot|price_label_snapshot|price_php_snapshot|original_price_php_snapshot|discount_amount_php_snapshot|promotion_snapshot|receipt_reference/i.test(insertResult.error.message || "")
  ) {
    const fallbackRows = rowsToInsert.map((row) => {
      const {
        is_paid_snapshot: _a,
        price_label_snapshot: _b,
        price_php_snapshot: _c,
        original_price_php_snapshot: _d,
        discount_amount_php_snapshot: _e,
        promotion_snapshot: _f,
        receipt_reference: _g,
        ...rest
      } = row;
      return rest;
    });
    insertResult = await admin.from("bank_purchase_requests").insert(fallbackRows).select("id");
  }
  if (insertResult.error) return fail(500, insertResult.error.message);
  const insertedRows = rowsToInsert.map((row, index) => ({
    ...row,
    id: (insertResult.data?.[index] as any)?.id || null,
    receipt_reference: (insertResult.data?.[index] as any)?.receipt_reference || receiptReference,
    banks: {
      title: asString(enrichedCatalogById.get(row.catalog_item_id)?.banks?.[0]?.title, 200)
        || asString(enrichedCatalogById.get(row.catalog_item_id)?.banks?.title, 200)
        || asString(catalogById.get(row.catalog_item_id)?.banks?.[0]?.title, 200)
        || asString(catalogById.get(row.catalog_item_id)?.banks?.title, 200)
      || "Unknown Bank",
    },
  }));

  await swallowDiscordError(() =>
    sendDiscordStoreRequestEvent({
      severity: "info",
      title: "Store Purchase Request Submitted",
      description: "A new store purchase request was submitted.",
      requestId: String(insertedRows[0]?.id || ""),
      userId,
      bankIds: normalizedItems.map((item) => item.bankId),
      catalogItemIds: normalizedItems.map((item) => item.catalogItemId),
      batchId,
      receiptReference,
      paymentChannel: normalizedPaymentChannel || null,
      payerName: normalizedPayerName || null,
      referenceNo: ocrMetadata.referenceNo || normalizedReferenceNo || null,
      extraFields: [
        { name: "Item Count", value: String(normalizedItems.length), inline: true },
      ],
    })
  );
  if (shouldNotifyOcrFailure(ocrMetadata.errorCode)) {
    await swallowDiscordError(() =>
      sendDiscordOcrFailureEvent({
        context: "bank_store",
        email: user?.email || null,
        errorCode: ocrMetadata.errorCode,
        provider: ocrMetadata.provider,
        receiptReference,
        requestId: String(insertedRows[0]?.id || ""),
        bankIds: normalizedItems.map((item) => item.bankId),
        catalogItemIds: normalizedItems.map((item) => item.catalogItemId),
      })
    );
  }

  let automationResult: AutomationReason = "not_image_proof";
  let autoApproved = false;
  if (normalizedPaymentChannel === "image_proof") {
    if (!automationSettings.store.enabled) {
      automationResult = "manual_review_disabled";
    } else if (!ocrDetected) {
      automationResult = "ocr_failed";
    } else if (!ocrMetadata.referenceNo) {
      automationResult = "missing_reference";
    } else if (ocrMetadata.amountPhp === null) {
      automationResult = "missing_amount";
    } else if (!ocrMetadata.recipientNumber) {
      automationResult = "missing_recipient_number";
    } else {
      const reserved = await tryReservePaymentReference({
        admin,
        sourceReference: ocrMetadata.referenceNo,
        sourceTable: "bank_purchase_requests",
        sourceRequestId: String(insertedRows[0]?.id || ""),
      });
      if (reserved.errorMessage) {
        automationResult = "approval_error";
      } else if (!reserved.reserved) {
        automationResult = "duplicate_reference";
      } else if (!isWithinAutoApprovalWindow(automationSettings.store)) {
        automationResult = "outside_window";
      } else if (!matchesConfiguredWalletRecipient({
        paymentChannel: normalizedPaymentChannel,
        detectedRecipientNumber: ocrMetadata.recipientNumber,
        paymentConfig: paymentSettings,
        })) {
          automationResult = "wallet_number_mismatch";
        } else {
          const expectedAmount = roundMoney(
            insertedRows.reduce((sum: number, row: any) => sum + (asPriceNumber(row.price_php_snapshot) || 0), 0),
          );
          const detectedAmount = roundMoney(ocrMetadata.amountPhp);
          if (!matchesAutoApprovalAmount(expectedAmount, detectedAmount)) {
            automationResult = "amount_mismatch";
          } else {
            automationResult = "approved";
            autoApproved = true;
          }
      }
    }
  }

  const insertedIds = insertedRows.map((row) => row.id).filter(Boolean);
  if (!autoApproved && insertedIds.length > 0) {
    await admin
      .from("bank_purchase_requests")
      .update({ automation_result: automationResult })
      .in("id", insertedIds);
  }

  if (autoApproved) {
    const decisionResponse = await executeStoreDecision({
      admin,
      batchRows: insertedRows,
      nextStatus: "approved",
      rejectionMessage: null,
      reviewedAtIso: new Date().toISOString(),
      reviewedBy: null,
      decisionSource: "automation",
      automationResult,
    });
    if (decisionResponse.ok || decisionResponse.status < 500) {
      return decisionResponse;
    }
    automationResult = "approval_error";
  }

  const pendingEmailResult = await sendStorePendingSubmissionEmail({
    admin,
    targetEmail: user?.email || null,
    rows: insertedRows,
  });
  return ok({
    batchId,
    requestIds: (insertResult.data || []).map((r: any) => r.id),
    status: "pending",
    auto_approved: false,
    payer_name: normalizedPayerName || null,
    reference_no: ocrMetadata.referenceNo || normalizedReferenceNo || null,
    receipt_reference: (insertResult.data?.[0] as any)?.receipt_reference || receiptReference,
    decision_email_status: pendingEmailResult.status,
    decision_email_error: pendingEmailResult.error,
    pending_email_status: pendingEmailResult.status,
    pending_email_error: pendingEmailResult.error,
  });
};

type StoreDownloadContext = {
  admin: ReturnType<typeof createServiceClient>;
  userId: string;
  catalogItem: any;
  transport: "web" | "native" | "electron";
};

const normalizeStoreDownloadTransport = (value: string | null | undefined): "web" | "native" | "electron" => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "electron") return "electron";
  if (normalized === "native" || normalized === "android" || normalized === "capacitor") return "native";
  return "web";
};

const resolveStoreDownloadContext = async (
  req: Request,
  catalogItemId: string,
  options?: { consumeRateLimit?: boolean },
): Promise<{ ok: true; context: StoreDownloadContext } | { ok: false; response: Response }> => {
  const admin = createServiceClient();
  const requestUrl = new URL(req.url);
  const transport = normalizeStoreDownloadTransport(requestUrl.searchParams.get("transport"));
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  const userId = user?.id || null;
  if (!userId) return { ok: false, response: fail(401, "NOT_AUTHENTICATED") };
  const maintenanceState = await getStoreMaintenanceState(req, admin);
  if ("response" in maintenanceState) return { ok: false, response: maintenanceState.response };
  if (maintenanceState.enabled && !maintenanceState.isAdmin) {
    return {
      ok: false,
      response: fail(503, "STORE_MAINTENANCE", {
        maintenance: {
          enabled: true,
          message: maintenanceState.message,
        },
      }),
    };
  }

  const shouldRateLimit = options?.consumeRateLimit !== false;
  if (shouldRateLimit) {
    const downloadLimit = await consumeRateLimit({
      scope: "store.download",
      subject: userId,
      maxHits: STORE_DOWNLOAD_RATE_LIMIT,
      windowSeconds: STORE_DOWNLOAD_RATE_WINDOW_SECONDS,
    });
    if (!downloadLimit.allowed) {
      return {
        ok: false,
        response: fail(429, "RATE_LIMITED", {
          scope: "store.download",
          retry_after_seconds: downloadLimit.retryAfterSeconds,
        }),
      };
    }
  }

  const { data: catalogItem, error: catalogError } = await admin
    .from("bank_catalog_items")
    .select("*")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (catalogError || !catalogItem) return { ok: false, response: fail(404, "CATALOG_NOT_FOUND") };
  if (!catalogItem.is_published) return { ok: false, response: fail(403, "NOT_PUBLISHED") };
  if (catalogItem.coming_soon) return { ok: false, response: fail(403, "COMING_SOON") };
  const catalogSize = Number(catalogItem.file_size_bytes || 0);
  const maxDownloadBytes = transport === "web" ? STORE_MAX_DOWNLOAD_BYTES : STORE_MAX_NATIVE_DOWNLOAD_BYTES;
  if (Number.isFinite(catalogSize) && catalogSize > maxDownloadBytes) {
    return {
      ok: false,
      response: fail(413, "ASSET_TOO_LARGE", {
        max_bytes: maxDownloadBytes,
        asset_bytes: catalogSize,
        transport,
      }),
    };
  }

  const { data: bankRow, error: bankError } = await admin
    .from("banks")
    .select("id, deleted_at")
    .eq("id", catalogItem.bank_id)
    .maybeSingle();
  if (bankError) return { ok: false, response: fail(500, bankError.message) };
  if (!bankRow || bankRow.deleted_at) return { ok: false, response: fail(410, "BANK_ARCHIVED") };

  if (catalogItem.requires_grant) {
    const { data: accessData } = await admin
      .from("user_bank_access")
      .select("id")
      .eq("user_id", userId)
      .eq("bank_id", catalogItem.bank_id)
      .maybeSingle();
    if (!accessData) {
      const adminRole = await isAdminUser(userId);
      if (!adminRole) return { ok: false, response: fail(403, "NOT_GRANTED") };
    }
  }

  return {
    ok: true,
    context: {
      admin,
      userId,
      catalogItem,
      transport,
    },
  };
};

const downloadStoreCatalogItem = async (req: Request, catalogItemId: string) => {
  const resolved = await resolveStoreDownloadContext(req, catalogItemId, { consumeRateLimit: true });
  if (!resolved.ok) return resolved.response;
  const { catalogItem, transport } = resolved.context;

  const requestUrl = new URL(req.url);
  const requestedTransport = String(requestUrl.searchParams.get("transport") || "").toLowerCase();
  if (requestedTransport === "proxy") {
    return fail(410, "DOWNLOAD_PROXY_REMOVED");
  }
  const useSignedUrlPayload =
    requestedTransport === "signed_url"
    || requestedTransport === "signed-url"
    || requestedTransport === "direct"
    || transport === "native"
    || transport === "electron";
  const storageProvider = asString(catalogItem.storage_provider, 40) || "";
  const storageBucket = asString(catalogItem.storage_bucket, 300) || "";
  const storageKey = asString(catalogItem.storage_key, 2000) || "";
  if (storageProvider !== "r2" || !storageBucket || !storageKey) {
    return fail(503, "CATALOG_STORAGE_NOT_READY");
  }

  let redirectLocation = "";
  let signedExpiresAt = "";
  try {
    const signed = await createPresignedGetUrl(storageBucket, storageKey, STORE_R2_SIGNED_DOWNLOAD_TTL_SECONDS);
    redirectLocation = signed.url;
    signedExpiresAt = signed.expiresAt;
  } catch (error) {
    const message = error instanceof Error ? error.message : "R2_SIGNED_URL_FAILED";
    return fail(502, message);
  }
  if (!redirectLocation) return fail(502, "ASSET_REDIRECT_UNAVAILABLE");

  if (useSignedUrlPayload) {
    return ok({
      mode: "signed_url",
      downloadUrl: redirectLocation,
      urlExpiresAt: signedExpiresAt || null,
    });
  }

  const outHeaders = new Headers({
    ...buildCorsHeaders(req),
    "Cache-Control": "no-store",
    "Location": redirectLocation,
    "X-Store-Download-Mode": "redirect",
  });
  outHeaders.set("Access-Control-Expose-Headers", "Location, X-Store-Download-Mode");
  return new Response(null, { status: 302, headers: outHeaders });
};

const getStoreCatalogItemDecryptKey = async (req: Request, catalogItemId: string) => {
  const resolved = await resolveStoreDownloadContext(req, catalogItemId, { consumeRateLimit: false });
  if (!resolved.ok) return resolved.response;
  const { admin, catalogItem, userId } = resolved.context;

  const protectionMode = asString(catalogItem.asset_protection, 40)?.toLowerCase() || "";
  let derivedKey: string | null = null;
  if (protectionMode === "encrypted") {
    const { data: bankRow, error: bankError } = await admin
      .from("banks")
      .select("id, derived_key, deleted_at")
      .eq("id", catalogItem.bank_id)
      .maybeSingle();
    if (bankError) return fail(500, bankError.message);
    if (!bankRow || bankRow.deleted_at) return fail(410, "BANK_ARCHIVED");

    derivedKey = asString(bankRow.derived_key, 255);
    if (!derivedKey) return fail(503, "DERIVED_KEY_UNAVAILABLE");
  }

  let entitlementToken: string | null = null;
  let entitlementTokenKeyId: string | null = null;
  let entitlementTokenIssuedAt: string | null = null;
  let entitlementTokenExpiresAt: string | null = null;
  if (isEntitlementTokenSigningEnabled()) {
    try {
      const signed = await createSignedEntitlementToken({
        userId,
        bankId: asString(catalogItem.bank_id, 80) || "",
        catalogItemId,
      });
      entitlementToken = signed.token;
      entitlementTokenKeyId = signed.keyId;
      entitlementTokenIssuedAt = signed.issuedAt;
      entitlementTokenExpiresAt = signed.expiresAt;
    } catch {
      // Best-effort only: keep decrypt-key available even if token signing fails.
    }
  }

  return ok({
    catalogItemId,
    bankId: asString(catalogItem.bank_id, 80) || null,
    protected: protectionMode === "encrypted",
    derivedKey,
    entitlementToken,
    entitlementTokenKeyId,
    entitlementTokenIssuedAt,
    entitlementTokenExpiresAt,
  });
};

const aggregateDecisionEmailResult = (
  results: Array<{ status: "sent" | "failed" | "skipped"; error: string | null }>,
): { status: "sent" | "failed" | "skipped"; error: string | null } => {
  if (results.length === 0) return { status: "skipped", error: "No recipients resolved" };
  const failedMessages = results
    .map((row) => (row.status === "failed" ? row.error : null))
    .filter((value): value is string => Boolean(value));
  const hasFailed = failedMessages.length > 0;
  const hasSent = results.some((row) => row.status === "sent");
  if (hasFailed) return { status: "failed", error: failedMessages.slice(0, 3).join(" | ") || "Email send failed" };
  if (hasSent) return { status: "sent", error: null };
  const firstSkipError = results.find((row) => row.status === "skipped")?.error || null;
  return { status: "skipped", error: firstSkipError };
};

const sendAccountRejectionDecisionEmail = async (input: {
  requestRow: any;
  rejectionMessage: string | null;
  reviewedAtIso: string;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const targetEmail = normalizeEmail(input.requestRow?.email);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const displayName = asString(input.requestRow?.display_name, 160) || "User";
  const reviewTime = new Date(input.reviewedAtIso).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  const reasonText = asString(input.rejectionMessage, 2000) || "No reason provided";
  const subject = `Account Request Rejected - ${asString(input.requestRow?.receipt_reference, 120) || "VDJV"}`;
  const bodyLines = [
    `Hi ${displayName},`,
    "",
    "Your account registration request was rejected.",
    "",
    "Please submit a new request after correcting the issue.",
  ];
  const textBody = bodyLines.join("\n");
  const htmlBody = buildReceiptStyleEmailHtml({
    variant: "rejected",
    title: "Account Request Rejected",
    subtitle: "Your registration request needs correction.",
    details: [
      { label: "VDJV Receipt No", value: asString(input.requestRow?.receipt_reference, 160) || "-" },
      { label: "Payment Reference", value: asString(input.requestRow?.reference_no, 160) || "-" },
      { label: "Payment Channel", value: asString(input.requestRow?.payment_channel, 80) || "-" },
      { label: "Reviewed At", value: reviewTime },
      { label: "Reason", value: reasonText },
    ],
    bodyText: textBody,
    brandName: "VDJV Sampler Pad",
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
};

const sendAccountPendingSubmissionEmail = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  requestRow: any;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const targetEmail = normalizeEmail(input.requestRow?.email);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const displayName = asString(input.requestRow?.display_name, 160) || "User";
  const submittedAt = new Date(asString(input.requestRow?.created_at, 80) || new Date().toISOString()).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  const amount = asPriceNumber(input.requestRow?.account_price_php_snapshot);
  const textBody = [
    `Hi ${displayName},`,
    "",
    "We received your VDJV account payment submission.",
    "",
    "Status: PENDING APPROVAL",
    "Your request is now waiting for admin review. Please wait up to 24 hours and check your email for the final approval result.",
  ].join("\n");

  const htmlBody = buildReceiptStyleEmailHtml({
    variant: "pending",
    title: "Pending Approval",
    subtitle: "Your VDJV account payment was received and is waiting for review.",
    amountLabel: "Total Payment",
    amountValue: amount !== null ? formatPhpCurrency(amount) : "To be confirmed",
    details: [
      { label: "Payment For", value: "VDJV Account" },
      { label: "VDJV Receipt No", value: asString(input.requestRow?.receipt_reference, 160) || "-" },
      { label: "Payment Reference", value: asString(input.requestRow?.reference_no, 160) || "-" },
      { label: "Payment Channel", value: asString(input.requestRow?.payment_channel, 80) || "-" },
      { label: "Submitted At", value: submittedAt },
      { label: "Status", value: "Pending Approval" },
    ],
    bodyText: textBody,
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject: `Payment Received - Pending Approval - ${asString(input.requestRow?.receipt_reference, 120) || "VDJV"}`,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
};

const sendAccountApprovalDecisionEmail = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  requestRow: any;
  reviewedAtIso: string;
  loginHint?: string;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const targetEmail = normalizeEmail(input.requestRow?.email);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const displayName = asString(input.requestRow?.display_name, 160) || "User";
  const reviewTime = new Date(input.reviewedAtIso).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  const loginHint = asString(input.loginHint, 500) || "You can now sign in using the password you registered.";
  let platformGuideText = "";
  try {
    const landingConfig = await getNormalizedLandingConfigRecord(input.admin);
    const v1Links = landingConfig.downloadLinks.V1;
    platformGuideText = [
      "",
      "Download guides:",
      `Android: ${v1Links.android || "-"}`,
      `iOS: ${v1Links.ios || "-"}`,
      `Desktop: ${v1Links.windows || "-"}`,
      `macOS: ${v1Links.macos || "-"}`,
    ].join("\n");
  } catch {
    // Best-effort extra guidance only.
  }
  const subject = `Account Approved - ${asString(input.requestRow?.receipt_reference, 120) || "VDJV"}`;
  const bodyLines = [
    `Hi ${displayName},`,
    "",
    "Your account registration request has been approved.",
    "",
    loginHint,
    platformGuideText,
  ];
  const textBody = bodyLines.join("\n");
  const htmlBody = buildReceiptStyleEmailHtml({
    variant: "approved",
    title: "Account Approved",
    subtitle: "Your account access is now active.",
    details: [
      { label: "VDJV Receipt No", value: asString(input.requestRow?.receipt_reference, 160) || "-" },
      { label: "Payment Reference", value: asString(input.requestRow?.reference_no, 160) || "-" },
      { label: "Payment Channel", value: asString(input.requestRow?.payment_channel, 80) || "-" },
      { label: "Reviewed At", value: reviewTime },
    ],
    bodyText: textBody,
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
};

const sendStorePendingSubmissionEmail = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  targetEmail: string | null;
  rows: any[];
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const targetEmail = normalizeEmail(input.targetEmail);
  if (!targetEmail) return { status: "skipped", error: "No valid recipient email" };
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  const firstRow = input.rows[0];
  if (!firstRow) return { status: "skipped", error: "No purchase rows provided" };
  const bankTitles = Array.from(new Set(input.rows.map((row: any) => asString(row?.banks?.title, 200) || "Unknown Bank")));
  const amountTotal = input.rows.reduce((sum: number, row: any) => {
    const next = asPriceNumber(row?.price_php_snapshot ?? row?.price_label_snapshot);
    return sum + (next || 0);
  }, 0);
  const amountText = amountTotal > 0 ? formatPhpCurrency(amountTotal) : "To be confirmed";
  const submittedAt = new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";

  const textBody = [
    "We received your bank store payment submission.",
    "",
    "Status: PENDING APPROVAL",
    `Banks: ${bankTitles.join(", ")}`,
    "Your request is now waiting for admin review. Please wait for the approval email before expecting access.",
  ].join("\n");

  const htmlBody = buildReceiptStyleEmailHtml({
    variant: "pending",
    title: "Pending Approval",
    subtitle: "Your bank payment was received and is waiting for review.",
    amountLabel: "Total Amount",
    amountValue: amountText,
    details: [
      { label: "Payment For", value: `${bankTitles.length} bank${bankTitles.length > 1 ? "s" : ""}` },
      { label: "VDJV Receipt No", value: String(firstRow.receipt_reference || "-") },
      { label: "Payment Reference", value: String(firstRow.reference_no || "-") },
      { label: "Payment Channel", value: String(firstRow.payment_channel || "-") },
      { label: "Submitted At", value: submittedAt },
      { label: "Status", value: "Pending Approval" },
    ],
    bodyText: textBody,
  });

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject: `Payment Received - Pending Approval - ${String(firstRow.receipt_reference || "VDJV")}`,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
};

const sendStoreDecisionEmail = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  rows: any[];
  nextStatus: "approved" | "rejected";
  rejectionMessage: string | null;
  reviewedAtIso: string;
  targetUserId?: string | null;
}): Promise<{ status: "sent" | "failed" | "skipped"; error: string | null }> => {
  const targetUserId = input.targetUserId || input.rows[0]?.user_id || null;
  if (!targetUserId) {
    return { status: "skipped", error: "Missing user id" };
  }
  const scopedRows = input.rows.filter((row) => row?.user_id === targetUserId);
  if (scopedRows.length === 0) return { status: "skipped", error: "No rows found for user" };
  const firstRow = scopedRows[0];

  let profileMap: Record<string, { display_name: string; email: string }> = {};
  try {
    profileMap = await buildUserIdentityMap(input.admin, [targetUserId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve user identity";
    return { status: "failed", error: message };
  }
  const targetProfile = profileMap[targetUserId] || { display_name: "", email: "" };
  const targetEmail = normalizeEmail(targetProfile.email);
  if (!targetEmail) {
    return { status: "skipped", error: "No valid recipient email on profile" };
  }

  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) {
    return {
      status: "skipped",
      error: "Email provider is not configured (missing RESEND_API_KEY or STORE_EMAIL_FROM)",
    };
  }

  let settings: any = null;
  let settingsQuery = await input.admin
    .from("store_payment_settings")
    .select("store_email_approve_subject,store_email_approve_body,store_email_reject_subject,store_email_reject_body")
    .eq("id", "default")
    .maybeSingle();
  if (
    settingsQuery.error &&
    /store_email_approve_subject|store_email_approve_body|store_email_reject_subject|store_email_reject_body/i.test(
      settingsQuery.error.message || "",
    )
  ) {
    settingsQuery = await input.admin.from("store_payment_settings").select("id").eq("id", "default").maybeSingle();
  }
  if (!settingsQuery.error) settings = settingsQuery.data || null;

  const bankTitles = scopedRows.map((row) => getFirstRelationRow(row?.banks)?.title || "Unknown Bank");
  const paidAmounts: number[] = [];
  let hasUnknownPaidAmount = false;
  for (const row of scopedRows) {
    const parsed = asPriceNumber(row?.price_php_snapshot ?? row?.price_label_snapshot);
    const isPaid = typeof row?.is_paid_snapshot === "boolean"
      ? row.is_paid_snapshot
      : (parsed !== null && parsed > 0);
    if (!isPaid) continue;
    if (parsed === null) {
      hasUnknownPaidAmount = true;
      continue;
    }
    paidAmounts.push(parsed);
  }
  const totalAmount = paidAmounts.reduce((sum, amount) => sum + amount, 0);
  const amountText = hasUnknownPaidAmount
    ? (totalAmount > 0 ? `${formatPhpCurrency(totalAmount)} + pending amount` : "Pending amount confirmation")
    : (totalAmount > 0 ? formatPhpCurrency(totalAmount) : "Free");
  const reviewedAtText = new Date(input.reviewedAtIso).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";

  const templateValues: Record<string, string> = {
    display_name: targetProfile.display_name || "User",
    email: targetEmail,
    status: input.nextStatus,
    bank_titles: bankTitles.join(", "),
    bank_count: String(bankTitles.length),
    amount: amountText,
    receipt_reference: String(firstRow.receipt_reference || "-"),
    payment_reference: String(firstRow.reference_no || "-"),
    payment_channel: String(firstRow.payment_channel || "-"),
    reviewed_at: reviewedAtText,
    rejection_message: String(input.rejectionMessage || ""),
  };

  const defaultApproveSubject = "VDJV payment approved - {{receipt_reference}}";
  const defaultRejectSubject = "VDJV payment update - {{receipt_reference}}";
  const defaultApproveBody = [
    "Hi {{display_name}},",
    "",
    "Your payment request has been approved.",
    "Banks: {{bank_titles}}",
    "Receipt no: {{receipt_reference}}",
    "Payment reference: {{payment_reference}}",
    "Amount: {{amount}}",
    "Reviewed at: {{reviewed_at}}",
    "",
    "You can now open the app and download your bank.",
  ].join("\n");
  const defaultRejectBody = [
    "Hi {{display_name}},",
    "",
    "Your payment request was rejected.",
    "Banks: {{bank_titles}}",
    "Receipt no: {{receipt_reference}}",
    "Payment reference: {{payment_reference}}",
    "Amount: {{amount}}",
    "Reviewed at: {{reviewed_at}}",
    "Reason: {{rejection_message}}",
    "",
    "Please submit a new payment request after correcting the issue.",
  ].join("\n");

  const subjectTemplate = input.nextStatus === "approved"
    ? (asString(settings?.store_email_approve_subject, 300)?.trim() || defaultApproveSubject)
    : (asString(settings?.store_email_reject_subject, 300)?.trim() || defaultRejectSubject);
  const bodyTemplate = input.nextStatus === "approved"
    ? (asString(settings?.store_email_approve_body, 12000)?.trim() || defaultApproveBody)
    : (asString(settings?.store_email_reject_body, 12000)?.trim() || defaultRejectBody);

  const renderedSubject = renderTemplate(subjectTemplate, templateValues).trim() || (
    input.nextStatus === "approved" ? "VDJV payment approved" : "VDJV payment update"
  );
  const renderedBody = renderTemplate(bodyTemplate, templateValues).trim();
  const bodyForCard = stripReceiptDuplicateLines(renderedBody);

  const htmlBody = buildReceiptStyleEmailHtml({
    variant: input.nextStatus === "approved" ? "approved" : "rejected",
    title: input.nextStatus === "approved" ? "Payment Approved" : "Payment Rejected",
    subtitle: input.nextStatus === "approved"
      ? "Your bank request has been approved."
      : "Your bank request needs correction before resubmission.",
    amountLabel: "Total Amount",
    amountValue: amountText,
    details: [
      { label: "Payment For", value: `${bankTitles.length} bank${bankTitles.length > 1 ? "s" : ""}` },
      { label: "VDJV Receipt No", value: String(firstRow.receipt_reference || "-") },
      { label: "Payment Reference", value: String(firstRow.reference_no || "-") },
      { label: "Payment Channel", value: String(firstRow.payment_channel || "-") },
      { label: "Reviewed At", value: reviewedAtText },
      ...(input.nextStatus === "rejected" ? [{ label: "Reason", value: String(input.rejectionMessage || "-") }] : []),
    ],
    bodyText: bodyForCard,
  });
  const textBody = renderedBody;

  try {
    await sendEmailViaResend({
      to: targetEmail,
      subject: renderedSubject,
      html: htmlBody,
      text: textBody,
    });
    return { status: "sent", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: message };
  }
};

const sendStoreDecisionEmailsByUser = async (input: {
  admin: ReturnType<typeof createServiceClient>;
  rows: any[];
  nextStatus: "approved" | "rejected";
  rejectionMessage: string | null;
  reviewedAtIso: string;
}): Promise<{
  perUser: Array<{ userId: string; rowIds: string[]; status: "sent" | "failed" | "skipped"; error: string | null }>;
  aggregate: { status: "sent" | "failed" | "skipped"; error: string | null };
}> => {
  const grouped = new Map<string, any[]>();
  for (const row of input.rows) {
    const userId = asString(row?.user_id, 80);
    if (!userId) continue;
    const list = grouped.get(userId) || [];
    list.push(row);
    grouped.set(userId, list);
  }
  const perUser: Array<{ userId: string; rowIds: string[]; status: "sent" | "failed" | "skipped"; error: string | null }> = [];
  for (const [userId, rows] of grouped.entries()) {
    const emailResult = await sendStoreDecisionEmail({
      admin: input.admin,
      rows,
      nextStatus: input.nextStatus,
      rejectionMessage: input.rejectionMessage,
      reviewedAtIso: input.reviewedAtIso,
      targetUserId: userId,
    });
    perUser.push({
      userId,
      rowIds: rows.map((row) => String(row.id)),
      status: emailResult.status,
      error: emailResult.error,
    });
  }
  return {
    perUser,
    aggregate: aggregateDecisionEmailResult(perUser.map((row) => ({ status: row.status, error: row.error }))),
  };
};

const submitClientCrashReport = async (req: Request, body: ClientCrashReportBody) => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  if (!user) return fail(401, "NOT_AUTHENTICATED");

  const ip = getRequestIp(req);
  const rateLimit = await consumeRateLimit({
    scope: "client_crash_report.submit",
    subject: `${user.id}:${ip}`,
    maxHits: CLIENT_CRASH_REPORT_RATE_LIMIT,
    windowSeconds: CLIENT_CRASH_REPORT_RATE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return fail(429, "RATE_LIMITED", {
      scope: "client_crash_report.submit",
      retry_after_seconds: rateLimit.retryAfterSeconds,
    });
  }

  const domain = normalizeClientCrashReportDomain(body?.domain || "bank_store");
  if (!domain) return badRequest("Unsupported crash report domain");

  const rawSupportLogText = typeof body?.supportLogText === "string" ? body.supportLogText.trim() : "";
  if (!rawSupportLogText) return badRequest("supportLogText is required");
  const supportLogSizeBytes = textEncoder.encode(rawSupportLogText).byteLength;
  if (supportLogSizeBytes > CLIENT_CRASH_REPORT_MAX_BYTES) {
    return fail(413, "CRASH_REPORT_TOO_LARGE", { max_bytes: CLIENT_CRASH_REPORT_MAX_BYTES });
  }

  const title = getClientCrashReportTitle(domain, body?.title);
  const platform = asString(body?.platform, 80) || null;
  const appVersion = asString(body?.appVersion, 80) || null;
  const operation = asString(body?.operation, 80) || null;
  const phase = asString(body?.phase, 80) || null;
  const stage = asString(body?.stage, 120) || null;
  const recentEventPattern = normalizeCrashText(body?.recentEventPattern, 280);
  const entryCount = Number.isFinite(Number(body?.entryCount)) ? Math.max(0, Math.floor(Number(body?.entryCount))) : null;
  const detectedAt = asString(body?.detectedAt, 80) || null;
  const lastUpdatedAt = asString(body?.lastUpdatedAt, 80) || null;
  const fingerprintSource = [
    "v1",
    domain,
    user.id,
    platform || "unknown",
    appVersion || "unknown",
    operation || "unknown",
    phase || "unknown",
    stage || "unknown",
    recentEventPattern || normalizeCrashText(rawSupportLogText, 280) || "no-pattern",
  ].join("|");
  const fingerprint = await sha256Hex(fingerprintSource);
  const nowIso = new Date().toISOString();
  const admin = createServiceClient();

  const { data: existingRow, error: existingError } = await admin
    .from("client_crash_reports")
    .select("id,status,repeat_count,first_seen_at,report_object_key,report_uploaded_at,report_size_bytes")
    .eq("user_id", user.id)
    .eq("domain", domain)
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (existingError) return fail(500, existingError.message);

  const existingUploadedAtMs = existingRow?.report_uploaded_at ? new Date(existingRow.report_uploaded_at).getTime() : 0;
  const shouldUploadFreshReport = !existingRow?.report_object_key
    || !existingUploadedAtMs
    || (Date.now() - existingUploadedAtMs) > CLIENT_CRASH_REPORT_RATE_WINDOW_SECONDS * 1000;
  const reportId = existingRow?.id || crypto.randomUUID();
  let reportObjectKey = asString(existingRow?.report_object_key, 2000) || null;
  let reportUploadedAt = asString(existingRow?.report_uploaded_at, 120) || null;
  let reportSizeBytes = Number.isFinite(Number(existingRow?.report_size_bytes))
    ? Math.max(0, Math.floor(Number(existingRow?.report_size_bytes)))
    : null;

  if (shouldUploadFreshReport) {
    const uploaded = await uploadCrashReportTextToR2({
      reportId,
      bodyText: rawSupportLogText,
      domain,
    });
    reportObjectKey = uploaded.objectKey;
    reportUploadedAt = nowIso;
    reportSizeBytes = uploaded.sizeBytes;
  }

  const repeatCount = existingRow ? Math.max(1, Number(existingRow.repeat_count || 0) + 1) : 1;
  const summary = {
    title,
    platform,
    app_version: appVersion,
    operation,
    phase,
    stage,
    entry_count: entryCount,
    detected_at: detectedAt,
    last_updated_at: lastUpdatedAt,
    recent_event_pattern: recentEventPattern,
    report_size_bytes: supportLogSizeBytes,
  };

  const basePayload = {
    report_title: title,
    latest_operation: operation,
    latest_phase: phase,
    latest_stage: stage,
    platform,
    app_version: appVersion,
    recent_event_pattern: recentEventPattern,
    report_object_key: reportObjectKey,
    report_uploaded_at: reportUploadedAt,
    report_size_bytes: reportSizeBytes,
    repeat_count: repeatCount,
    last_seen_at: nowIso,
    latest_summary: summary,
    updated_at: nowIso,
  };

  if (existingRow) {
    const { error: updateError } = await admin
      .from("client_crash_reports")
      .update(basePayload)
      .eq("id", existingRow.id);
    if (updateError) return fail(500, updateError.message);
  } else {
    const { error: insertError } = await admin
      .from("client_crash_reports")
      .insert({
        id: reportId,
        user_id: user.id,
        domain,
        fingerprint,
        fingerprint_version: 1,
        status: "new",
        first_seen_at: nowIso,
        created_at: nowIso,
        ...basePayload,
      });
    if (insertError) return fail(500, insertError.message);
  }

  const shouldNotify = !existingRow || shouldNotifyCrashReportRepeat(repeatCount);
  if (shouldNotify) {
    await swallowDiscordError(() => sendDiscordStoreCrashReportEvent({
      severity: repeatCount > 1 ? "warning" : "critical",
      reportId,
      userId: user.id,
      email: asString((user as any)?.email, 320) || null,
      domain,
      platform,
      appVersion,
      operation,
      phase,
      stage,
      repeatCount,
      fingerprint,
      extraFields: [
        ...(reportObjectKey ? [{ name: "R2 Object", value: reportObjectKey, inline: false } satisfies DiscordField] : []),
      ],
    }));
  }

  return ok({
    reportId,
    fingerprint,
    repeatCount,
    uploaded: shouldUploadFreshReport,
    deduped: Boolean(existingRow),
    notified: shouldNotify,
  });
};

const listAdminClientCrashReports = async (req: Request) => {
  const admin = createServiceClient();
  const url = new URL(req.url);
  const page = Math.max(1, readPositiveInt(url.searchParams.get("page") || "1", 1));
  const perPage = Math.max(1, Math.min(50, readPositiveInt(url.searchParams.get("perPage") || "10", 10)));
  const q = asString(url.searchParams.get("q"), 200)?.trim() || "";
  const status = asString(url.searchParams.get("status"), 40)?.trim().toLowerCase() || "all";
  const domain = asString(url.searchParams.get("domain"), 40)?.trim().toLowerCase() || "all";
  const platform = asString(url.searchParams.get("platform"), 80)?.trim() || "all";
  const appVersion = asString(url.searchParams.get("appVersion"), 80)?.trim() || "all";
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = admin
    .from("client_crash_reports")
    .select(
      "id,user_id,domain,status,report_title,latest_operation,latest_phase,latest_stage,platform,app_version,recent_event_pattern,report_object_key,report_uploaded_at,report_size_bytes,repeat_count,first_seen_at,last_seen_at,latest_summary,created_at,updated_at",
      { count: "exact" },
    )
    .order("last_seen_at", { ascending: false })
    .range(from, to);

  if (status === "new" || status === "acknowledged" || status === "fixed" || status === "ignored") {
    query = query.eq("status", status);
  }
  const normalizedDomain = normalizeClientCrashReportDomain(domain);
  if (normalizedDomain) {
    query = query.eq("domain", normalizedDomain);
  }
  if (platform !== "all") {
    query = query.eq("platform", platform);
  }
  if (appVersion !== "all") {
    query = query.eq("app_version", appVersion);
  }
  if (q) {
    const escaped = q.replace(/[%_]/g, "\\$&");
    query = query.or(
      `report_title.ilike.%${escaped}%,latest_operation.ilike.%${escaped}%,latest_phase.ilike.%${escaped}%,latest_stage.ilike.%${escaped}%,recent_event_pattern.ilike.%${escaped}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return fail(500, error.message);

  const [{ count: newCount, error: newCountError }, { count: totalCount, error: totalCountError }] = await Promise.all([
    admin.from("client_crash_reports").select("id", { count: "exact", head: true }).eq("status", "new"),
    admin.from("client_crash_reports").select("id", { count: "exact", head: true }),
  ]);
  if (newCountError) return fail(500, newCountError.message);
  if (totalCountError) return fail(500, totalCountError.message);

  const userIds = Array.from(new Set((data || []).map((row: any) => asString(row?.user_id, 80)).filter(Boolean))) as string[];
  let identities: Record<string, { display_name: string; email: string }> = {};
  if (userIds.length > 0) {
    try {
      identities = await buildUserIdentityMap(admin, userIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve crash report identities";
      return fail(500, message);
    }
  }

  const reports = await Promise.all((data || []).map(async (row: any) => {
    const userId = asString(row?.user_id, 80) || "";
    const identity = identities[userId] || { display_name: "", email: "" };
    const objectKey = asString(row?.report_object_key, 2000) || null;
    const downloadUrl = objectKey && R2_BUCKET
      ? await createPresignedGetUrl({
          bucket: R2_BUCKET,
          objectKey,
          expiresInSeconds: STORE_R2_SIGNED_DOWNLOAD_TTL_SECONDS,
        }).catch(() => null)
      : null;
    return {
      id: asString(row?.id, 80) || "",
      user_id: userId,
      user_profile: {
        display_name: identity.display_name || "",
        email: identity.email || "",
      },
      domain: normalizeClientCrashReportDomain(row?.domain) || "bank_store",
      status: asString(row?.status, 40) || "new",
      report_title: asString(row?.report_title, 200) || "Crash Report",
      latest_operation: asString(row?.latest_operation, 120) || null,
      latest_phase: asString(row?.latest_phase, 120) || null,
      latest_stage: asString(row?.latest_stage, 160) || null,
      platform: asString(row?.platform, 120) || null,
      app_version: asString(row?.app_version, 120) || null,
      recent_event_pattern: asString(row?.recent_event_pattern, 400) || null,
      report_object_key: objectKey,
      report_download_url: downloadUrl,
      report_uploaded_at: asString(row?.report_uploaded_at, 80) || null,
      report_size_bytes: Number.isFinite(Number(row?.report_size_bytes))
        ? Math.max(0, Math.floor(Number(row?.report_size_bytes)))
        : null,
      repeat_count: Math.max(1, Math.floor(Number(row?.repeat_count || 1))),
      first_seen_at: asString(row?.first_seen_at, 80) || null,
      last_seen_at: asString(row?.last_seen_at, 80) || null,
      latest_summary: row?.latest_summary && typeof row.latest_summary === "object" ? row.latest_summary : {},
      created_at: asString(row?.created_at, 80) || null,
      updated_at: asString(row?.updated_at, 80) || null,
    };
  }));

  return ok({
    reports,
    page,
    perPage,
    total: Number(count || 0),
    totalCount: Number(totalCount || 0),
    newCount: Number(newCount || 0),
  });
};

const patchAdminClientCrashReport = async (reportId: string, body: any) => {
  const status = asString(body?.status, 40)?.trim().toLowerCase();
  if (status !== "new" && status !== "acknowledged" && status !== "fixed" && status !== "ignored") {
    return badRequest("status must be new, acknowledged, fixed, or ignored");
  }
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("client_crash_reports")
    .update({ status, updated_at: nowIso })
    .eq("id", reportId)
    .select("id,status,updated_at")
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Crash report not found");
  return ok({
    report: {
      id: asString(data?.id, 80) || reportId,
      status: asString(data?.status, 40) || status,
      updated_at: asString(data?.updated_at, 80) || nowIso,
    },
  });
};

const listAdminStoreRequests = async (req: Request) => {
  const admin = createServiceClient();
  const url = new URL(req.url);
  const filter = String(url.searchParams.get("filter") || "pending").toLowerCase();
  const status = String(url.searchParams.get("status") || "all").toLowerCase();
  const paymentChannel = String(url.searchParams.get("paymentChannel") || "all").toLowerCase();
  const decisionSource = String(url.searchParams.get("decisionSource") || "all").toLowerCase();
  const automationResult = String(url.searchParams.get("automationResult") || "all").toLowerCase();
  const ocrStatus = String(url.searchParams.get("ocrStatus") || "all").toLowerCase();
  const selectWithSnapshots = `
    id,catalog_item_id,user_id,bank_id,batch_id,status,payment_channel,payer_name,reference_no,receipt_reference,notes,proof_path,rejection_message,decision_email_status,decision_email_error,
    is_paid_snapshot,price_label_snapshot,price_php_snapshot,created_at,banks ( title ),
    ocr_reference_no,ocr_payer_name,ocr_amount_php,ocr_recipient_number,ocr_provider,ocr_scanned_at,ocr_status,ocr_error_code,decision_source,automation_result
  `;
  const selectWithoutSnapshots = `
    id,catalog_item_id,user_id,bank_id,batch_id,status,payment_channel,payer_name,reference_no,receipt_reference,notes,proof_path,rejection_message,
    created_at,banks ( title ),ocr_reference_no,ocr_payer_name,ocr_amount_php,ocr_recipient_number,ocr_provider,ocr_scanned_at,ocr_status,ocr_error_code,decision_source,automation_result
  `;
  let requestQuery: any = admin
    .from("bank_purchase_requests")
    .select(selectWithSnapshots)
    .order("created_at", { ascending: false });
  if (filter === "pending") requestQuery = requestQuery.eq("status", "pending");
  else if (filter === "history") requestQuery = requestQuery.neq("status", "pending");

  if (status === "pending" || status === "approved" || status === "rejected") {
    requestQuery = requestQuery.eq("status", status);
  }
  if (paymentChannel === "image_proof" || paymentChannel === "gcash_manual" || paymentChannel === "maya_manual") {
    requestQuery = requestQuery.eq("payment_channel", paymentChannel);
  }
  if (decisionSource === "manual") {
    requestQuery = requestQuery.or("decision_source.eq.manual,decision_source.is.null");
  } else if (decisionSource === "automation") {
    requestQuery = requestQuery.eq("decision_source", "automation");
  }
  if (
    automationResult === "approved"
    || automationResult === "manual_review_disabled"
    || automationResult === "outside_window"
    || automationResult === "missing_reference"
    || automationResult === "missing_amount"
    || automationResult === "missing_recipient_number"
    || automationResult === "duplicate_reference"
    || automationResult === "wallet_number_mismatch"
    || automationResult === "amount_mismatch"
    || automationResult === "ocr_failed"
    || automationResult === "approval_error"
    || automationResult === "not_image_proof"
  ) {
    requestQuery = requestQuery.eq("automation_result", automationResult);
  }
  if (
    ocrStatus === "detected"
    || ocrStatus === "missing_reference"
    || ocrStatus === "missing_amount"
    || ocrStatus === "missing_recipient_number"
    || ocrStatus === "failed"
    || ocrStatus === "unavailable"
    || ocrStatus === "skipped"
  ) {
    requestQuery = requestQuery.eq("ocr_status", ocrStatus);
  }

  requestQuery = await requestQuery;
  if (
    requestQuery.error &&
    /is_paid_snapshot|price_label_snapshot|price_php_snapshot|decision_email_status|decision_email_error/i.test(
      requestQuery.error.message || "",
    )
  ) {
    requestQuery = admin
      .from("bank_purchase_requests")
      .select(selectWithoutSnapshots)
      .order("created_at", { ascending: false });
    if (filter === "pending") requestQuery = requestQuery.eq("status", "pending");
    else if (filter === "history") requestQuery = requestQuery.neq("status", "pending");
    if (status === "pending" || status === "approved" || status === "rejected") {
      requestQuery = requestQuery.eq("status", status);
    }
    if (paymentChannel === "image_proof" || paymentChannel === "gcash_manual" || paymentChannel === "maya_manual") {
      requestQuery = requestQuery.eq("payment_channel", paymentChannel);
    }
    if (decisionSource === "manual") {
      requestQuery = requestQuery.or("decision_source.eq.manual,decision_source.is.null");
    } else if (decisionSource === "automation") {
      requestQuery = requestQuery.eq("decision_source", "automation");
    }
    if (
      automationResult === "approved"
      || automationResult === "manual_review_disabled"
      || automationResult === "outside_window"
      || automationResult === "missing_reference"
      || automationResult === "missing_amount"
      || automationResult === "missing_recipient_number"
      || automationResult === "duplicate_reference"
      || automationResult === "wallet_number_mismatch"
      || automationResult === "amount_mismatch"
      || automationResult === "ocr_failed"
      || automationResult === "approval_error"
      || automationResult === "not_image_proof"
    ) {
      requestQuery = requestQuery.eq("automation_result", automationResult);
    }
    if (
      ocrStatus === "detected"
      || ocrStatus === "missing_reference"
      || ocrStatus === "missing_amount"
      || ocrStatus === "missing_recipient_number"
      || ocrStatus === "failed"
      || ocrStatus === "unavailable"
      || ocrStatus === "skipped"
    ) {
      requestQuery = requestQuery.eq("ocr_status", ocrStatus);
    }
    requestQuery = await requestQuery;
  }
  if (requestQuery.error) return fail(500, requestQuery.error.message);
  const data: any[] = requestQuery.data || [];

  const [{ count: pendingCount, error: pendingCountError }, { count: historyCount, error: historyCountError }] = await Promise.all([
    admin
      .from("bank_purchase_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("bank_purchase_requests")
      .select("id", { count: "exact", head: true })
      .neq("status", "pending"),
  ]);
  if (pendingCountError) return fail(500, pendingCountError.message);
  if (historyCountError) return fail(500, historyCountError.message);

  const userIds = [...new Set(data.map((r: any) => r.user_id).filter(Boolean))];
  let userProfiles: Record<string, { display_name: string; email: string }> = {};
  if (userIds.length > 0) {
    try {
      userProfiles = await buildUserIdentityMap(admin, userIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve user identities";
      return fail(500, message);
    }
  }

  const catalogItemIds = [...new Set(data.map((row: any) => row.catalog_item_id).filter(Boolean))];
  const bankIds = [...new Set(data.map((row: any) => row.bank_id).filter(Boolean))];
  const catalogItemMap: Record<string, any> = {};
  const catalogByBankMap: Record<string, any> = {};

  if (catalogItemIds.length > 0) {
    let catalogQuery: any = await admin
      .from("bank_catalog_items")
      .select("id, bank_id, is_published, is_paid, price_label, price_php, banks ( title )")
      .in("id", catalogItemIds);
    if (catalogQuery.error && /price_php/i.test(catalogQuery.error.message || "")) {
      catalogQuery = await admin
        .from("bank_catalog_items")
        .select("id, bank_id, is_published, is_paid, price_label, banks ( title )")
        .in("id", catalogItemIds);
    }
    if (catalogQuery.error) return fail(500, catalogQuery.error.message);
    (catalogQuery.data || []).forEach((row: any) => { catalogItemMap[row.id] = row; });
  }
  if (bankIds.length > 0) {
    let catalogByBankQuery: any = await admin
      .from("bank_catalog_items")
      .select("id, bank_id, is_published, is_paid, price_label, price_php, banks ( title )")
      .in("bank_id", bankIds)
      .order("created_at", { ascending: false });
    if (catalogByBankQuery.error && /price_php/i.test(catalogByBankQuery.error.message || "")) {
      catalogByBankQuery = await admin
        .from("bank_catalog_items")
        .select("id, bank_id, is_published, is_paid, price_label, banks ( title )")
        .in("bank_id", bankIds)
        .order("created_at", { ascending: false });
    }
    if (catalogByBankQuery.error) return fail(500, catalogByBankQuery.error.message);
    (catalogByBankQuery.data || []).forEach((row: any) => {
      if (!row?.bank_id) return;
      const existing = catalogByBankMap[row.bank_id];
      if (!existing || (row.is_published && !existing.is_published)) catalogByBankMap[row.bank_id] = row;
    });
  }

  const requests = data.map((row: any) => {
    const catalogItem = catalogItemMap[row.catalog_item_id] || catalogByBankMap[row.bank_id] || null;
    const catalogBank = getFirstRelationRow(catalogItem?.banks);
    const fallbackBank = getFirstRelationRow(row.banks);
    const bankTitle = catalogBank?.title || fallbackBank?.title || "Unknown Bank";
    const parsedSnapshotPrice = asPriceNumber(row.price_php_snapshot ?? row.price_label_snapshot);
    const parsedCatalogPrice = resolveCatalogPrice(catalogItem);
    const parsedPrice = parsedSnapshotPrice ?? parsedCatalogPrice;
    const isPaid = typeof row.is_paid_snapshot === "boolean"
      ? row.is_paid_snapshot
      : (Boolean(catalogItem?.is_paid) || (parsedPrice !== null && parsedPrice > 0));
    return {
      ...row,
      bank_catalog_items: { is_paid: isPaid, price_php: parsedPrice, banks: { title: bankTitle } },
      user_profile: userProfiles[row.user_id] || null,
    };
  });
  return ok({
    requests,
    total: requests.length,
    pendingCount: Number(pendingCount || 0),
    historyCount: Number(historyCount || 0),
    filter,
  });
};

const adminStoreRequestAction = async (requestId: string, body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const action = String(body?.action || "").toLowerCase();
  if (action !== "approve" && action !== "reject") return badRequest("Invalid action");
  const rejectionMessage = action === "reject" ? (asString(body?.rejection_message, 1000) || "") : null;

  const { data: requestRow, error: requestError } = await admin
    .from("bank_purchase_requests")
    .select(
      "id,user_id,bank_id,status,batch_id,payer_name,reference_no,receipt_reference,payment_channel,proof_path,is_paid_snapshot,price_label_snapshot,price_php_snapshot,banks ( title ),ocr_reference_no,ocr_payer_name,ocr_amount_php,ocr_recipient_number,ocr_provider,ocr_scanned_at,ocr_status,ocr_error_code,decision_source,automation_result",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return fail(500, requestError.message);
  if (!requestRow) return fail(404, "Request not found");
  if (requestRow.status !== "pending") return badRequest("Request is not pending");

  let batchRows: any[] = [requestRow];
  if (requestRow.batch_id) {
    const { data: batchData } = await admin
      .from("bank_purchase_requests")
      .select(
        "id,user_id,bank_id,status,batch_id,payer_name,reference_no,receipt_reference,payment_channel,proof_path,is_paid_snapshot,price_label_snapshot,price_php_snapshot,banks ( title ),ocr_reference_no,ocr_payer_name,ocr_amount_php,ocr_recipient_number,ocr_provider,ocr_scanned_at,ocr_status,ocr_error_code,decision_source,automation_result",
      )
      .eq("batch_id", requestRow.batch_id)
      .eq("status", "pending");
    if (batchData && batchData.length > 0) batchRows = batchData;
  }
  const nextStatus = action === "approve" ? "approved" : "rejected";
  return await executeStoreDecision({
    admin,
    batchRows,
    nextStatus,
    rejectionMessage,
    reviewedAtIso: new Date().toISOString(),
    reviewedBy: adminUserId,
    decisionSource: "manual",
  });
};

const adminStoreRequestRetryDecisionEmail = async (requestId: string, adminUserId: string) => {
  const admin = createServiceClient();
  const selectFields =
    "id,user_id,bank_id,status,batch_id,payer_name,reference_no,receipt_reference,rejection_message,payment_channel,proof_path,is_paid_snapshot,price_label_snapshot,price_php_snapshot,banks ( title )";
  const { data: requestRow, error: requestError } = await admin
    .from("bank_purchase_requests")
    .select(selectFields)
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return fail(500, requestError.message);
  if (!requestRow) return fail(404, "Request not found");
  if (requestRow.status !== "approved" && requestRow.status !== "rejected") {
    return badRequest("Only approved/rejected requests can retry decision email");
  }

  let batchRows: any[] = [requestRow];
  if (requestRow.batch_id) {
    const { data: batchData, error: batchError } = await admin
      .from("bank_purchase_requests")
      .select(selectFields)
      .eq("batch_id", requestRow.batch_id)
      .eq("status", requestRow.status);
    if (batchError) return fail(500, batchError.message);
    if (batchData && batchData.length > 0) batchRows = batchData;
  }
  const rowIds = batchRows.map((row) => String(row.id));
  const reviewedAtIso = new Date().toISOString();
  const emailResults = await sendStoreDecisionEmailsByUser({
    admin,
    rows: batchRows,
    nextStatus: requestRow.status,
    rejectionMessage: asString(requestRow.rejection_message, 1000) || null,
    reviewedAtIso,
  });
  for (const result of emailResults.perUser) {
    let update = await admin
      .from("bank_purchase_requests")
      .update({
        decision_email_status: result.status,
        decision_email_error: result.error,
        reviewed_by: adminUserId,
        reviewed_at: reviewedAtIso,
      })
      .in("id", result.rowIds);
    if (update.error && /reviewed_(by|at)/i.test(update.error.message || "")) {
      update = await admin
        .from("bank_purchase_requests")
        .update({
          decision_email_status: result.status,
          decision_email_error: result.error,
        })
        .in("id", result.rowIds);
    }
    if (
      update.error &&
      !/decision_email_status|decision_email_error|reviewed_by|reviewed_at/i.test(update.error.message || "")
    ) {
      return fail(500, update.error.message);
    }
  }

  return ok({
    ids: rowIds,
    status: requestRow.status,
    decision_email_status: emailResults.aggregate.status,
    decision_email_error: emailResults.aggregate.error,
  });
};

const listAdminStoreCatalog = async () => {
  const admin = createServiceClient();
  let { data, error } = await admin
    .from("bank_catalog_items")
    .select("*, banks ( title, deleted_at )")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error && /is_pinned/i.test(error.message || "")) {
    const fallback = await admin
      .from("bank_catalog_items")
      .select("*, banks ( title, deleted_at )")
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) return fail(500, error.message);
  const visible = (data || []).filter((item: any) => {
    const bank = getFirstRelationRow(item?.banks);
    return !bank?.deleted_at;
  });
  const bannersResult = await listMarketingBanners(admin, { includeInactive: true });
  if (!bannersResult.ok) return bannersResult.response;
  return ok({ items: visible.map(normalizeAdminCatalogItem), banners: bannersResult.banners });
};

const patchAdminStoreCatalog = async (catalogItemId: string, body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const { data: existing, error: existingError } = await admin
    .from("bank_catalog_items")
    .select("id,bank_id,is_paid,requires_grant,asset_protection,thumbnail_path,coming_soon")
    .eq("id", catalogItemId)
    .maybeSingle();
  if (existingError) return fail(500, existingError.message);
  if (!existing) return fail(404, "Catalog item not found");

  const updates: Record<string, unknown> = {};
  const bankUpdates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const nextStatus = String(body.status || "").toLowerCase();
    if (!["draft", "published", "archived"].includes(nextStatus)) return badRequest("Invalid status");
    if (nextStatus === "published") return badRequest("Use admin publish endpoint for published status");
    updates.is_published = nextStatus === "published";
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_paid")) {
    if (typeof body.is_paid !== "boolean") return badRequest("is_paid must be boolean");
    updates.is_paid = body.is_paid;
  }
  if (Object.prototype.hasOwnProperty.call(body, "coming_soon")) {
    if (typeof body.coming_soon !== "boolean") return badRequest("coming_soon must be boolean");
    updates.coming_soon = body.coming_soon;
    if (body.coming_soon) {
      updates.is_paid = false;
      updates.price_php = null;
      updates.price_label = null;
      updates.requires_grant = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "requires_grant")) {
    if (typeof body.requires_grant !== "boolean") return badRequest("requires_grant must be boolean");
    updates.requires_grant = body.requires_grant;
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_pinned")) {
    if (typeof body.is_pinned !== "boolean") return badRequest("is_pinned must be boolean");
    updates.is_pinned = body.is_pinned;
  }
  const nextIsPaid = typeof updates.is_paid === "boolean" ? Boolean(updates.is_paid) : Boolean(existing.is_paid);
  const nextRequiresGrant = typeof updates.requires_grant === "boolean"
    ? Boolean(updates.requires_grant)
    : Boolean(existing.requires_grant);
  if (nextIsPaid && !nextRequiresGrant) {
    return badRequest("Paid catalog items must require grant");
  }
  if (Object.prototype.hasOwnProperty.call(body, "price_php")) {
    if (body.price_php === null || body.price_php === "") {
      updates.price_php = null;
      if (!Object.prototype.hasOwnProperty.call(body, "price_label")) updates.price_label = null;
    }
    else {
      const parsedPrice = Number(body.price_php);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) return badRequest("price_php must be a valid non-negative number");
      updates.price_php = parsedPrice;
      if (!Object.prototype.hasOwnProperty.call(body, "price_label")) updates.price_label = String(parsedPrice);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "expected_asset_name")) {
    const expectedAssetName = asString(body.expected_asset_name, 500);
    if (!expectedAssetName) return badRequest("expected_asset_name must be a non-empty string");
    updates.expected_asset_name = expectedAssetName;
  }
  if (Object.prototype.hasOwnProperty.call(body, "thumbnail_path")) {
    if (body.thumbnail_path === null || body.thumbnail_path === "") {
      updates.thumbnail_path = null;
    } else {
      const thumbnailPath = normalizeOptionalHttpUrl(body.thumbnail_path);
      if (!thumbnailPath) return badRequest("thumbnail_path must be a valid http(s) URL");
      updates.thumbnail_path = thumbnailPath;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "asset_protection") || Object.prototype.hasOwnProperty.call(body, "assetProtection")) {
    const nextAssetProtectionRaw = body.asset_protection ?? body.assetProtection;
    const nextAssetProtection = String(nextAssetProtectionRaw || "").trim().toLowerCase();
    if (nextAssetProtection !== "encrypted" && nextAssetProtection !== "public") {
      return badRequest("asset_protection must be encrypted or public");
    }
    updates.asset_protection = nextAssetProtection;
  }
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = asString(body.title, 255);
    if (!title) return badRequest("title must be a non-empty string");
    bankUpdates.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    const description = asString(body.description, 2000);
    bankUpdates.description = description || "";
  }
  if (Object.prototype.hasOwnProperty.call(body, "color")) {
    const color = asString(body.color, 40);
    bankUpdates.color = color || null;
  }
  if (Object.keys(updates).length === 0 && Object.keys(bankUpdates).length === 0) {
    return badRequest("No valid fields to update");
  }

  if (Object.keys(bankUpdates).length > 0) {
    const bankUpdate = await admin
      .from("banks")
      .update(bankUpdates)
      .eq("id", existing.bank_id)
      .select("id,title,description,color")
      .maybeSingle();
    if (bankUpdate.error) return fail(500, bankUpdate.error.message);
    if (!bankUpdate.data) return fail(404, "Target bank not found");
  }

  let data: any = null;
  if (Object.keys(updates).length > 0) {
    const updateResult = await admin
      .from("bank_catalog_items")
      .update(updates)
      .eq("id", catalogItemId)
      .select("*, banks ( title, description, color )")
      .maybeSingle();
    if (updateResult.error) return fail(500, updateResult.error.message);
    data = updateResult.data;
  } else {
    const selectResult = await admin
      .from("bank_catalog_items")
      .select("*, banks ( title, description, color )")
      .eq("id", catalogItemId)
      .maybeSingle();
    if (selectResult.error) return fail(500, selectResult.error.message);
    data = selectResult.data;
  }
  if (!data) return fail(404, "Catalog item not found");

  const protectionChanged = typeof updates.asset_protection === "string" && updates.asset_protection !== existing.asset_protection;
  const metadataChanged = Object.keys(bankUpdates).length > 0 || Object.prototype.hasOwnProperty.call(updates, "thumbnail_path");
  let cleanupWarning: string | null = null;
  const thumbnailChanged = Object.prototype.hasOwnProperty.call(updates, "thumbnail_path") &&
    normalizeOptionalHttpUrl(existing.thumbnail_path) !== normalizeOptionalHttpUrl(updates.thumbnail_path);
  if (thumbnailChanged && extractOwnedBankThumbnailPath(existing.bank_id, existing.thumbnail_path)) {
    cleanupWarning = await deleteManagedStoreAsset(admin, existing.thumbnail_path);
  }
  if (protectionChanged || metadataChanged) {
    await swallowDiscordError(() => sendDiscordAdminActionEvent({
      severity: "info",
      title: protectionChanged ? "Store Bank Protection Changed" : "Store Catalog Metadata Updated",
      description: protectionChanged
        ? "Admin updated the linked store asset protection."
        : "Admin synced store bank metadata.",
      actorUserId: adminUserId,
      bankId: asString(existing.bank_id, 80) || null,
      catalogItemId,
      extraFields: [
        ...(protectionChanged
          ? [
              { name: "Previous Protection", value: String(existing.asset_protection || "encrypted"), inline: true },
              { name: "Next Protection", value: String(updates.asset_protection || existing.asset_protection || "encrypted"), inline: true },
            ]
          : []),
        ...(Object.prototype.hasOwnProperty.call(updates, "thumbnail_path")
          ? [{ name: "Thumbnail Synced", value: "Yes", inline: true }]
          : []),
      ],
    }));
  }
  return ok({ item: normalizeAdminCatalogItem(data), cleanup_warning: cleanupWarning });
};

const listAdminStorePromotions = async () => {
  const admin = createServiceClient();
  const { promotions, targetsByPromotionId } = await loadAdminPromotionRows(admin);
  const bankIds = new Set<string>();
  const catalogItemIds = new Set<string>();
  targetsByPromotionId.forEach((targets) => {
    targets.forEach((target) => {
      if (target.bank_id) bankIds.add(target.bank_id);
      if (target.catalog_item_id) catalogItemIds.add(target.catalog_item_id);
    });
  });

  const bankTitleById = new Map<string, string>();
  if (bankIds.size > 0) {
    const { data, error } = await admin
      .from("banks")
      .select("id,title")
      .in("id", Array.from(bankIds));
    if (error) return fail(500, error.message);
    for (const row of data || []) {
      const bankId = asUuid(row?.id);
      if (!bankId) continue;
      bankTitleById.set(bankId, asString(row?.title, 255) || "Unknown Bank");
    }
  }

  const catalogLabelById = new Map<string, string>();
  if (catalogItemIds.size > 0) {
    const { data, error } = await admin
      .from("bank_catalog_items")
      .select("id,bank_id,banks ( title )")
      .in("id", Array.from(catalogItemIds));
    if (error) return fail(500, error.message);
    for (const row of data || []) {
      const itemId = asUuid(row?.id);
      if (!itemId) continue;
      const bank = getFirstRelationRow(row?.banks);
      catalogLabelById.set(itemId, asString(bank?.title, 255) || "Unknown Catalog Item");
    }
  }

  const nowIso = new Date().toISOString();
  return ok({
    promotions: promotions.map((promotion) => {
      const targets = targetsByPromotionId.get(promotion.id) || [];
      const targetBankIds = Array.from(new Set(targets.map((target) => target.bank_id).filter(Boolean) as string[]));
      const targetCatalogItemIds = Array.from(
        new Set(targets.map((target) => target.catalog_item_id).filter(Boolean) as string[]),
      );
      const targetLabels = [
        ...targetCatalogItemIds.map((id) => ({ type: "catalog", id, label: catalogLabelById.get(id) || "Unknown Catalog Item" })),
        ...targetBankIds.map((id) => ({ type: "bank", id, label: bankTitleById.get(id) || "Unknown Bank" })),
      ];
      return {
        ...promotion,
        status: getPromotionLifecycleStatus(promotion, nowIso),
        target_bank_ids: targetBankIds,
        target_catalog_item_ids: targetCatalogItemIds,
        target_labels: targetLabels,
      };
    }),
  });
};

const createAdminStorePromotion = async (body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const name = asString(body?.name, 200);
  const description = asString(body?.description, 2000) || null;
  const badgeText = asString(body?.badge_text ?? body?.badgeText, 120) || null;
  const timezone = asString(body?.timezone, 120) || AUTO_APPROVAL_TIMEZONE;
  const startsAt = parseIsoDateTime(body?.starts_at ?? body?.startsAt);
  const endsAt = parseIsoDateTime(body?.ends_at ?? body?.endsAt);
  const promotionType = normalizePromotionType(body?.promotion_type ?? body?.promotionType);
  const discountType = normalizePromotionDiscountType(body?.discount_type ?? body?.discountType);
  const discountValue = roundMoney(Number((body?.discount_value ?? body?.discountValue) || 0));
  const priority = Math.max(0, Math.min(100000, Math.floor(Number(body?.priority ?? 100))));
  const isActive = Object.prototype.hasOwnProperty.call(body || {}, "is_active")
    ? Boolean(body?.is_active)
    : Boolean(body?.isActive ?? true);
  const targets = normalizePromotionTargetLists(body);

  if (!name) return badRequest("name is required");
  const validation = await validatePromotionDefinition(admin, {
    promotionType,
    discountType,
    discountValue,
    startsAt: startsAt || "",
    endsAt: endsAt || "",
    bankIds: targets.bankIds,
    catalogItemIds: targets.catalogItemIds,
  });
  if (!validation.ok) return badRequest(validation.error);

  const row = {
    name,
    description,
    promotion_type: promotionType,
    discount_type: discountType,
    discount_value: discountValue,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone,
    badge_text: badgeText,
    priority,
    is_active: isActive,
    created_by: adminUserId,
    updated_by: adminUserId,
    updated_at: new Date().toISOString(),
  };
  let insertResult = await admin.from("store_promotions").insert(row).select("*").single();
  if (insertResult.error && /created_by|updated_by/i.test(insertResult.error.message || "")) {
    const { created_by: _a, updated_by: _b, ...fallback } = row;
    insertResult = await admin.from("store_promotions").insert(fallback).select("*").single();
  }
  if (insertResult.error || !insertResult.data) return fail(500, insertResult.error?.message || "Failed to create promotion");

  const promotionId = asString(insertResult.data?.id, 80) || "";
  if (promotionId && (targets.bankIds.length > 0 || targets.catalogItemIds.length > 0)) {
    const rows = [
      ...targets.bankIds.map((bankId) => ({ promotion_id: promotionId, bank_id: bankId })),
      ...targets.catalogItemIds.map((catalogItemId) => ({ promotion_id: promotionId, catalog_item_id: catalogItemId })),
    ];
    const { error } = await admin.from("store_promotion_targets").insert(rows);
    if (error) return fail(500, error.message);
  }

  return await listAdminStorePromotions();
};

const patchAdminStorePromotion = async (promotionId: string, body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const { data: existing, error: existingError } = await admin
    .from("store_promotions")
    .select("*")
    .eq("id", promotionId)
    .maybeSingle();
  if (existingError) return fail(500, existingError.message);
  if (!existing) return fail(404, "Promotion not found");

  const targets = normalizePromotionTargetLists(body);
  const hasTargetUpdate =
    Object.prototype.hasOwnProperty.call(body || {}, "target_bank_ids")
    || Object.prototype.hasOwnProperty.call(body || {}, "targetBankIds")
    || Object.prototype.hasOwnProperty.call(body || {}, "target_catalog_item_ids")
    || Object.prototype.hasOwnProperty.call(body || {}, "targetCatalogItemIds");

  const nextName = Object.prototype.hasOwnProperty.call(body || {}, "name")
    ? asString(body?.name, 200)
    : asString(existing?.name, 200);
  const nextDescription = Object.prototype.hasOwnProperty.call(body || {}, "description")
    ? (asString(body?.description, 2000) || null)
    : (asString(existing?.description, 2000) || null);
  const nextBadgeText = Object.prototype.hasOwnProperty.call(body || {}, "badge_text") || Object.prototype.hasOwnProperty.call(body || {}, "badgeText")
    ? (asString(body?.badge_text ?? body?.badgeText, 120) || null)
    : (asString(existing?.badge_text, 120) || null);
  const nextTimezone = Object.prototype.hasOwnProperty.call(body || {}, "timezone")
    ? (asString(body?.timezone, 120) || AUTO_APPROVAL_TIMEZONE)
    : (asString(existing?.timezone, 120) || AUTO_APPROVAL_TIMEZONE);
  const nextStartsAt = Object.prototype.hasOwnProperty.call(body || {}, "starts_at") || Object.prototype.hasOwnProperty.call(body || {}, "startsAt")
    ? parseIsoDateTime(body?.starts_at ?? body?.startsAt)
    : parseIsoDateTime(existing?.starts_at);
  const nextEndsAt = Object.prototype.hasOwnProperty.call(body || {}, "ends_at") || Object.prototype.hasOwnProperty.call(body || {}, "endsAt")
    ? parseIsoDateTime(body?.ends_at ?? body?.endsAt)
    : parseIsoDateTime(existing?.ends_at);
  const nextPromotionType = Object.prototype.hasOwnProperty.call(body || {}, "promotion_type") || Object.prototype.hasOwnProperty.call(body || {}, "promotionType")
    ? normalizePromotionType(body?.promotion_type ?? body?.promotionType)
    : normalizePromotionType(existing?.promotion_type);
  const nextDiscountType = Object.prototype.hasOwnProperty.call(body || {}, "discount_type") || Object.prototype.hasOwnProperty.call(body || {}, "discountType")
    ? normalizePromotionDiscountType(body?.discount_type ?? body?.discountType)
    : normalizePromotionDiscountType(existing?.discount_type);
  const nextDiscountValue = Object.prototype.hasOwnProperty.call(body || {}, "discount_value") || Object.prototype.hasOwnProperty.call(body || {}, "discountValue")
    ? roundMoney(Number((body?.discount_value ?? body?.discountValue) || 0))
    : roundMoney(Number(existing?.discount_value || 0));
  const nextPriority = Object.prototype.hasOwnProperty.call(body || {}, "priority")
    ? Math.max(0, Math.min(100000, Math.floor(Number(body?.priority ?? 100))))
    : Math.max(0, Math.min(100000, Math.floor(Number(existing?.priority || 100))));
  const nextIsActive = Object.prototype.hasOwnProperty.call(body || {}, "is_active")
    ? Boolean(body?.is_active)
    : Object.prototype.hasOwnProperty.call(body || {}, "isActive")
      ? Boolean(body?.isActive)
      : Boolean(existing?.is_active);

  if (!nextName) return badRequest("name is required");

  let nextBankIds = targets.bankIds;
  let nextCatalogItemIds = targets.catalogItemIds;
  if (!hasTargetUpdate) {
    const { data: currentTargets, error: currentTargetsError } = await admin
      .from("store_promotion_targets")
      .select("bank_id,catalog_item_id")
      .eq("promotion_id", promotionId);
    if (currentTargetsError) return fail(500, currentTargetsError.message);
    nextBankIds = Array.from(new Set((currentTargets || []).map((row: any) => asUuid(row?.bank_id)).filter(Boolean) as string[]));
    nextCatalogItemIds = Array.from(new Set((currentTargets || []).map((row: any) => asUuid(row?.catalog_item_id)).filter(Boolean) as string[]));
  }

  const validation = await validatePromotionDefinition(admin, {
    promotionType: nextPromotionType,
    discountType: nextDiscountType,
    discountValue: nextDiscountValue,
    startsAt: nextStartsAt || "",
    endsAt: nextEndsAt || "",
    bankIds: nextBankIds,
    catalogItemIds: nextCatalogItemIds,
  });
  if (!validation.ok) return badRequest(validation.error);

  const updates = {
    name: nextName,
    description: nextDescription,
    promotion_type: nextPromotionType,
    discount_type: nextDiscountType,
    discount_value: nextDiscountValue,
    starts_at: nextStartsAt,
    ends_at: nextEndsAt,
    timezone: nextTimezone,
    badge_text: nextBadgeText,
    priority: nextPriority,
    is_active: nextIsActive,
    updated_by: adminUserId,
    updated_at: new Date().toISOString(),
  };
  let updateResult = await admin.from("store_promotions").update(updates).eq("id", promotionId).select("*").single();
  if (updateResult.error && /updated_by/i.test(updateResult.error.message || "")) {
    const { updated_by: _skip, ...fallback } = updates;
    updateResult = await admin.from("store_promotions").update(fallback).eq("id", promotionId).select("*").single();
  }
  if (updateResult.error) return fail(500, updateResult.error.message);

  if (hasTargetUpdate) {
    const { error: deleteError } = await admin.from("store_promotion_targets").delete().eq("promotion_id", promotionId);
    if (deleteError) return fail(500, deleteError.message);
    const rows = [
      ...nextBankIds.map((bankId) => ({ promotion_id: promotionId, bank_id: bankId })),
      ...nextCatalogItemIds.map((catalogItemId) => ({ promotion_id: promotionId, catalog_item_id: catalogItemId })),
    ];
    if (rows.length > 0) {
      const { error: insertError } = await admin.from("store_promotion_targets").insert(rows);
      if (insertError) return fail(500, insertError.message);
    }
  }

  return await listAdminStorePromotions();
};

const deleteAdminStorePromotion = async (promotionId: string) => {
  const admin = createServiceClient();
  const { error } = await admin.from("store_promotions").delete().eq("id", promotionId);
  if (error) return fail(500, error.message);
  return ok({ deleted: true, promotionId });
};

const createAdminStoreBanner = async (body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const imageUrl = normalizeRequiredHttpUrl(body?.image_url);
  if (!imageUrl) return badRequest("image_url must be a valid http(s) URL");
  const hasLink = Object.prototype.hasOwnProperty.call(body || {}, "link_url");
  const linkUrlRaw = hasLink ? body?.link_url : null;
  const linkUrl = linkUrlRaw === null || linkUrlRaw === "" || typeof linkUrlRaw === "undefined"
    ? null
    : normalizeOptionalHttpUrl(linkUrlRaw);
  if (hasLink && linkUrlRaw !== null && linkUrlRaw !== "" && !linkUrl) {
    return badRequest("link_url must be a valid http(s) URL");
  }
  const sortOrder = toNonNegativeSortOrder(body?.sort_order, 0);
  const isActive = Object.prototype.hasOwnProperty.call(body || {}, "is_active")
    ? Boolean(body?.is_active)
    : true;
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("store_marketing_banners")
    .insert({
      image_url: imageUrl,
      link_url: linkUrl,
      sort_order: sortOrder,
      is_active: isActive,
      created_by: adminUserId,
      created_at: nowIso,
      updated_by: adminUserId,
      updated_at: nowIso,
    })
    .select("id,image_url,link_url,sort_order,is_active,created_at,updated_at")
    .single();
  if (error) return fail(500, error.message);
  return ok({ banner: normalizeMarketingBannerRow(data) }, 201);
};

const patchAdminStoreBanner = async (bannerId: string, body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const { data: existing, error: existingError } = await admin
    .from("store_marketing_banners")
    .select("id,image_url,is_active")
    .eq("id", bannerId)
    .maybeSingle();
  if (existingError) return fail(500, existingError.message);
  if (!existing) return fail(404, "Banner not found");
  const updates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "image_url")) {
    const imageUrl = normalizeRequiredHttpUrl(body?.image_url);
    if (!imageUrl) return badRequest("image_url must be a valid http(s) URL");
    updates.image_url = imageUrl;
  }
  if (Object.prototype.hasOwnProperty.call(body, "link_url")) {
    const linkRaw = body?.link_url;
    if (linkRaw === null || linkRaw === "" || typeof linkRaw === "undefined") updates.link_url = null;
    else {
      const linkUrl = normalizeOptionalHttpUrl(linkRaw);
      if (!linkUrl) return badRequest("link_url must be a valid http(s) URL");
      updates.link_url = linkUrl;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "sort_order")) {
    const parsed = Number(body?.sort_order);
    if (!Number.isFinite(parsed) || parsed < 0) return badRequest("sort_order must be a non-negative number");
    updates.sort_order = Math.floor(parsed);
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    if (typeof body?.is_active !== "boolean") return badRequest("is_active must be boolean");
    updates.is_active = body.is_active;
  }
  if (Object.keys(updates).length === 0) return badRequest("No valid fields to update");
  updates.updated_by = adminUserId;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("store_marketing_banners")
    .update(updates)
    .eq("id", bannerId)
    .select("id,image_url,link_url,sort_order,is_active,created_at,updated_at")
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Banner not found");
  let cleanupWarning: string | null = null;
  if (typeof updates.image_url === "string" && updates.image_url !== existing.image_url) {
    cleanupWarning = await deleteManagedStoreAsset(admin, existing.image_url);
  }
  return ok({ banner: normalizeMarketingBannerRow(data), cleanup_warning: cleanupWarning });
};

const deleteAdminStoreBanner = async (bannerId: string) => {
  const admin = createServiceClient();
  const { data: existing, error: existingError } = await admin
    .from("store_marketing_banners")
    .select("id,image_url,is_active")
    .eq("id", bannerId)
    .maybeSingle();
  if (existingError) return fail(500, existingError.message);
  if (!existing) return fail(404, "Banner not found");
  if (existing.is_active) return badRequest("Only inactive banners can be deleted");

  const { error } = await admin.from("store_marketing_banners").delete().eq("id", bannerId);
  if (error) return fail(500, error.message);
  const cleanupWarning = await deleteManagedStoreAsset(admin, existing.image_url);
  return ok({ deleted: true, cleanup_warning: cleanupWarning });
};

const getAdminStoreConfig = async () => {
  const admin = createServiceClient();
  await disableExpiredCountdowns(admin);
  const { data, error } = await admin.from("store_payment_settings").select("*").eq("id", "default").maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return ok({ config: null });
  return ok({
    config: {
      ...data,
      banner_rotation_ms: normalizeBannerRotationMs((data as any)?.banner_rotation_ms) ?? STORE_BANNER_ROTATION_DEFAULT_MS,
      store_maintenance_enabled: Boolean((data as any)?.store_maintenance_enabled),
      store_maintenance_message: asString((data as any)?.store_maintenance_message, 2000) || "",
      account_auto_approve_enabled: Boolean((data as any)?.account_auto_approve_enabled),
      account_auto_approve_mode: normalizeAutoApprovalMode((data as any)?.account_auto_approve_mode),
      account_auto_approve_start_hour: normalizeAutoApprovalHour((data as any)?.account_auto_approve_start_hour),
      account_auto_approve_end_hour: normalizeAutoApprovalHour((data as any)?.account_auto_approve_end_hour),
      account_auto_approve_duration_hours: normalizeAutoApprovalDurationHours((data as any)?.account_auto_approve_duration_hours),
      account_auto_approve_expires_at: asString((data as any)?.account_auto_approve_expires_at, 80) || null,
      store_auto_approve_enabled: Boolean((data as any)?.store_auto_approve_enabled),
      store_auto_approve_mode: normalizeAutoApprovalMode((data as any)?.store_auto_approve_mode),
      store_auto_approve_start_hour: normalizeAutoApprovalHour((data as any)?.store_auto_approve_start_hour),
      store_auto_approve_end_hour: normalizeAutoApprovalHour((data as any)?.store_auto_approve_end_hour),
      store_auto_approve_duration_hours: normalizeAutoApprovalDurationHours((data as any)?.store_auto_approve_duration_hours),
      store_auto_approve_expires_at: asString((data as any)?.store_auto_approve_expires_at, 80) || null,
      installer_v2_auto_approve_enabled: Boolean((data as any)?.installer_v2_auto_approve_enabled),
      installer_v2_auto_approve_mode: normalizeAutoApprovalMode((data as any)?.installer_v2_auto_approve_mode),
      installer_v2_auto_approve_start_hour: normalizeAutoApprovalHour((data as any)?.installer_v2_auto_approve_start_hour),
      installer_v2_auto_approve_end_hour: normalizeAutoApprovalHour((data as any)?.installer_v2_auto_approve_end_hour),
      installer_v2_auto_approve_duration_hours: normalizeAutoApprovalDurationHours((data as any)?.installer_v2_auto_approve_duration_hours),
      installer_v2_auto_approve_expires_at: asString((data as any)?.installer_v2_auto_approve_expires_at, 80) || null,
      installer_v3_auto_approve_enabled: Boolean((data as any)?.installer_v3_auto_approve_enabled),
      installer_v3_auto_approve_mode: normalizeAutoApprovalMode((data as any)?.installer_v3_auto_approve_mode),
      installer_v3_auto_approve_start_hour: normalizeAutoApprovalHour((data as any)?.installer_v3_auto_approve_start_hour),
      installer_v3_auto_approve_end_hour: normalizeAutoApprovalHour((data as any)?.installer_v3_auto_approve_end_hour),
      installer_v3_auto_approve_duration_hours: normalizeAutoApprovalDurationHours((data as any)?.installer_v3_auto_approve_duration_hours),
      installer_v3_auto_approve_expires_at: asString((data as any)?.installer_v3_auto_approve_expires_at, 80) || null,
    },
  });
};

const getAdminLandingDownloadConfig = async () => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("landing_download_config")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) return fail(500, error.message);
  return ok({ config: normalizeLandingDownloadConfig(data || {}) });
};

const getAdminSamplerAppConfig = async () => {
  const admin = createServiceClient();
  const result = await getNormalizedSamplerAppConfig(admin);
  if (result.error) return fail(500, result.error.message);
  return ok({ config: result.config });
};

const saveAdminLandingDownloadConfig = async (body: any, adminUserId: string) => {
  const payload = normalizeLandingDownloadConfig({
    download_links: body?.downloadLinks,
    platform_descriptions: body?.platformDescriptions,
    version_descriptions: body?.versionDescriptions,
    buy_sections: body?.buySections,
  });
  const admin = createServiceClient();
  const row = {
    id: "default",
    is_active: true,
    download_links: payload.downloadLinks,
    platform_descriptions: payload.platformDescriptions,
    version_descriptions: payload.versionDescriptions,
    buy_sections: payload.buySections,
    updated_by: adminUserId,
    updated_at: new Date().toISOString(),
  };
  let upsert = await admin.from("landing_download_config").upsert(row, { onConflict: "id" }).select("*").single();
  if (upsert.error && /updated_by/i.test(upsert.error.message || "")) {
    const { updated_by: _skip, ...fallback } = row;
    upsert = await admin.from("landing_download_config").upsert(fallback, { onConflict: "id" }).select("*").single();
  }
  if (upsert.error) return fail(500, upsert.error.message);
  return ok({ config: normalizeLandingDownloadConfig(upsert.data) });
};

const saveAdminSamplerAppConfig = async (body: any, adminUserId: string) => {
  const payload = normalizeSamplerAppConfig(body || {});
  const admin = createServiceClient();
  const row = {
    id: "default",
    is_active: true,
    ui_defaults: payload.uiDefaults,
    bank_defaults: payload.bankDefaults,
    pad_defaults: payload.padDefaults,
    quota_defaults: payload.quotaDefaults,
    audio_limits: payload.audioLimits,
    shortcut_defaults: payload.shortcutDefaults,
    updated_by: adminUserId,
    updated_at: new Date().toISOString(),
  };
  let upsert = await admin.from("sampler_app_config").upsert(row, { onConflict: "id" }).select("*").single();
  if (upsert.error && /updated_by/i.test(upsert.error.message || "")) {
    const { updated_by: _skip, ...fallback } = row;
    upsert = await admin.from("sampler_app_config").upsert(fallback, { onConflict: "id" }).select("*").single();
  }
  if (upsert.error) return fail(500, upsert.error.message);
  return ok({
    config: normalizeSamplerAppConfig({
      ui_defaults: upsert.data?.ui_defaults,
      bank_defaults: upsert.data?.bank_defaults,
      pad_defaults: upsert.data?.pad_defaults,
      quota_defaults: upsert.data?.quota_defaults,
      audio_limits: upsert.data?.audio_limits,
      shortcut_defaults: upsert.data?.shortcut_defaults,
    }),
  });
};

const saveAdminStoreConfig = async (body: any, adminUserId: string) => {
  const admin = createServiceClient();
  const { data: existingConfig, error: existingError } = await admin
    .from("store_payment_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (existingError) return fail(500, existingError.message);

  const hasField = (field: string): boolean => Object.prototype.hasOwnProperty.call(body || {}, field);
  const readMergedString = (field: string, max: number): string =>
    hasField(field) ? asString(body?.[field], max) : asString((existingConfig as any)?.[field], max);

  const hasAccountPrice = Object.prototype.hasOwnProperty.call(body || {}, "account_price_php");
  const accountPriceRaw = hasAccountPrice ? body?.account_price_php : undefined;
  const parsedAccountPrice = accountPriceRaw === null || accountPriceRaw === "" || typeof accountPriceRaw === "undefined"
    ? (hasAccountPrice ? null : asPriceNumber((existingConfig as any)?.account_price_php))
    : asPriceNumber(accountPriceRaw);
  if (hasAccountPrice && accountPriceRaw !== null && accountPriceRaw !== "" && parsedAccountPrice === null) {
    return badRequest("account_price_php must be a valid non-negative number");
  }
  const hasBannerRotation = Object.prototype.hasOwnProperty.call(body || {}, "banner_rotation_ms");
  const bannerRotationRaw = hasBannerRotation ? body?.banner_rotation_ms : undefined;
  const parsedBannerRotation = bannerRotationRaw === null || bannerRotationRaw === "" || typeof bannerRotationRaw === "undefined"
    ? (hasBannerRotation
      ? STORE_BANNER_ROTATION_DEFAULT_MS
      : normalizeBannerRotationMs((existingConfig as any)?.banner_rotation_ms) ?? STORE_BANNER_ROTATION_DEFAULT_MS)
    : normalizeBannerRotationMs(bannerRotationRaw);
  if (hasBannerRotation && parsedBannerRotation === null) {
    return badRequest(`banner_rotation_ms must be between ${STORE_BANNER_ROTATION_MIN_MS} and ${STORE_BANNER_ROTATION_MAX_MS}`);
  }
  const accountAutoApproveEnabled = hasField("account_auto_approve_enabled")
    ? Boolean(body?.account_auto_approve_enabled)
    : Boolean((existingConfig as any)?.account_auto_approve_enabled);
  const storeAutoApproveEnabled = hasField("store_auto_approve_enabled")
    ? Boolean(body?.store_auto_approve_enabled)
    : Boolean((existingConfig as any)?.store_auto_approve_enabled);
  const accountAutoApproveMode = hasField("account_auto_approve_mode")
    ? normalizeAutoApprovalMode(body?.account_auto_approve_mode)
    : normalizeAutoApprovalMode((existingConfig as any)?.account_auto_approve_mode);
  const storeAutoApproveMode = hasField("store_auto_approve_mode")
    ? normalizeAutoApprovalMode(body?.store_auto_approve_mode)
    : normalizeAutoApprovalMode((existingConfig as any)?.store_auto_approve_mode);
  const accountAutoApproveStartHour = hasField("account_auto_approve_start_hour")
    ? normalizeAutoApprovalHour(body?.account_auto_approve_start_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.account_auto_approve_start_hour);
  const accountAutoApproveEndHour = hasField("account_auto_approve_end_hour")
    ? normalizeAutoApprovalHour(body?.account_auto_approve_end_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.account_auto_approve_end_hour);
  const accountAutoApproveDurationHours = hasField("account_auto_approve_duration_hours")
    ? normalizeAutoApprovalDurationHours(body?.account_auto_approve_duration_hours)
    : normalizeAutoApprovalDurationHours((existingConfig as any)?.account_auto_approve_duration_hours);
  const storeAutoApproveStartHour = hasField("store_auto_approve_start_hour")
    ? normalizeAutoApprovalHour(body?.store_auto_approve_start_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.store_auto_approve_start_hour);
  const storeAutoApproveEndHour = hasField("store_auto_approve_end_hour")
    ? normalizeAutoApprovalHour(body?.store_auto_approve_end_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.store_auto_approve_end_hour);
  const storeAutoApproveDurationHours = hasField("store_auto_approve_duration_hours")
    ? normalizeAutoApprovalDurationHours(body?.store_auto_approve_duration_hours)
    : normalizeAutoApprovalDurationHours((existingConfig as any)?.store_auto_approve_duration_hours);
  const accountAutoApproveExpiresAt = hasField("account_auto_approve_expires_at")
    ? (body?.account_auto_approve_expires_at === null ? null : asString(body?.account_auto_approve_expires_at, 80))
    : (asString((existingConfig as any)?.account_auto_approve_expires_at, 80) || null);
  const storeAutoApproveExpiresAt = hasField("store_auto_approve_expires_at")
    ? (body?.store_auto_approve_expires_at === null ? null : asString(body?.store_auto_approve_expires_at, 80))
    : (asString((existingConfig as any)?.store_auto_approve_expires_at, 80) || null);
  const installerV2AutoApproveEnabled = hasField("installer_v2_auto_approve_enabled")
    ? Boolean(body?.installer_v2_auto_approve_enabled)
    : Boolean((existingConfig as any)?.installer_v2_auto_approve_enabled);
  const installerV3AutoApproveEnabled = hasField("installer_v3_auto_approve_enabled")
    ? Boolean(body?.installer_v3_auto_approve_enabled)
    : Boolean((existingConfig as any)?.installer_v3_auto_approve_enabled);
  const installerV2AutoApproveMode = hasField("installer_v2_auto_approve_mode")
    ? normalizeAutoApprovalMode(body?.installer_v2_auto_approve_mode)
    : normalizeAutoApprovalMode((existingConfig as any)?.installer_v2_auto_approve_mode);
  const installerV3AutoApproveMode = hasField("installer_v3_auto_approve_mode")
    ? normalizeAutoApprovalMode(body?.installer_v3_auto_approve_mode)
    : normalizeAutoApprovalMode((existingConfig as any)?.installer_v3_auto_approve_mode);
  const installerV2AutoApproveStartHour = hasField("installer_v2_auto_approve_start_hour")
    ? normalizeAutoApprovalHour(body?.installer_v2_auto_approve_start_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.installer_v2_auto_approve_start_hour);
  const installerV2AutoApproveEndHour = hasField("installer_v2_auto_approve_end_hour")
    ? normalizeAutoApprovalHour(body?.installer_v2_auto_approve_end_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.installer_v2_auto_approve_end_hour);
  const installerV2AutoApproveDurationHours = hasField("installer_v2_auto_approve_duration_hours")
    ? normalizeAutoApprovalDurationHours(body?.installer_v2_auto_approve_duration_hours)
    : normalizeAutoApprovalDurationHours((existingConfig as any)?.installer_v2_auto_approve_duration_hours);
  const installerV3AutoApproveStartHour = hasField("installer_v3_auto_approve_start_hour")
    ? normalizeAutoApprovalHour(body?.installer_v3_auto_approve_start_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.installer_v3_auto_approve_start_hour);
  const installerV3AutoApproveEndHour = hasField("installer_v3_auto_approve_end_hour")
    ? normalizeAutoApprovalHour(body?.installer_v3_auto_approve_end_hour)
    : normalizeAutoApprovalHour((existingConfig as any)?.installer_v3_auto_approve_end_hour);
  const installerV3AutoApproveDurationHours = hasField("installer_v3_auto_approve_duration_hours")
    ? normalizeAutoApprovalDurationHours(body?.installer_v3_auto_approve_duration_hours)
    : normalizeAutoApprovalDurationHours((existingConfig as any)?.installer_v3_auto_approve_duration_hours);
  const installerV2AutoApproveExpiresAt = hasField("installer_v2_auto_approve_expires_at")
    ? (body?.installer_v2_auto_approve_expires_at === null ? null : asString(body?.installer_v2_auto_approve_expires_at, 80))
    : (asString((existingConfig as any)?.installer_v2_auto_approve_expires_at, 80) || null);
  const installerV3AutoApproveExpiresAt = hasField("installer_v3_auto_approve_expires_at")
    ? (body?.installer_v3_auto_approve_expires_at === null ? null : asString(body?.installer_v3_auto_approve_expires_at, 80))
    : (asString((existingConfig as any)?.installer_v3_auto_approve_expires_at, 80) || null);
  const payload: Record<string, unknown> = {
    id: "default",
    is_active: true,
    instructions: readMergedString("instructions", 5000),
    gcash_number: readMergedString("gcash_number", 80),
    maya_number: readMergedString("maya_number", 80),
    messenger_url: readMergedString("messenger_url", 500),
    qr_image_path: readMergedString("qr_image_path", 1000),
    store_maintenance_enabled: hasField("store_maintenance_enabled")
      ? Boolean(body?.store_maintenance_enabled)
      : Boolean((existingConfig as any)?.store_maintenance_enabled),
    store_maintenance_message: readMergedString("store_maintenance_message", 2000),
    store_email_approve_subject: readMergedString("store_email_approve_subject", 300),
    store_email_approve_body: readMergedString("store_email_approve_body", 12000),
    store_email_reject_subject: readMergedString("store_email_reject_subject", 300),
    store_email_reject_body: readMergedString("store_email_reject_body", 12000),
    account_auto_approve_enabled: accountAutoApproveEnabled,
    account_auto_approve_mode: accountAutoApproveMode,
    account_auto_approve_start_hour: accountAutoApproveStartHour,
    account_auto_approve_end_hour: accountAutoApproveEndHour,
    account_auto_approve_duration_hours: accountAutoApproveDurationHours,
    account_auto_approve_expires_at: accountAutoApproveExpiresAt,
    store_auto_approve_enabled: storeAutoApproveEnabled,
    store_auto_approve_mode: storeAutoApproveMode,
    store_auto_approve_start_hour: storeAutoApproveStartHour,
    store_auto_approve_end_hour: storeAutoApproveEndHour,
    store_auto_approve_duration_hours: storeAutoApproveDurationHours,
    store_auto_approve_expires_at: storeAutoApproveExpiresAt,
    installer_v2_auto_approve_enabled: installerV2AutoApproveEnabled,
    installer_v2_auto_approve_mode: installerV2AutoApproveMode,
    installer_v2_auto_approve_start_hour: installerV2AutoApproveStartHour,
    installer_v2_auto_approve_end_hour: installerV2AutoApproveEndHour,
    installer_v2_auto_approve_duration_hours: installerV2AutoApproveDurationHours,
    installer_v2_auto_approve_expires_at: installerV2AutoApproveExpiresAt,
    installer_v3_auto_approve_enabled: installerV3AutoApproveEnabled,
    installer_v3_auto_approve_mode: installerV3AutoApproveMode,
    installer_v3_auto_approve_start_hour: installerV3AutoApproveStartHour,
    installer_v3_auto_approve_end_hour: installerV3AutoApproveEndHour,
    installer_v3_auto_approve_duration_hours: installerV3AutoApproveDurationHours,
    installer_v3_auto_approve_expires_at: installerV3AutoApproveExpiresAt,
    updated_by: adminUserId,
    updated_at: new Date().toISOString(),
  };
  if (hasAccountPrice) payload.account_price_php = parsedAccountPrice;
  payload.banner_rotation_ms = parsedBannerRotation ?? STORE_BANNER_ROTATION_DEFAULT_MS;
  let upsert = await admin.from("store_payment_settings").upsert(payload, { onConflict: "id" }).select("*").single();
  if (upsert.error && /updated_by/i.test(upsert.error.message || "")) {
    const { updated_by: _skip, ...fallback } = payload;
    upsert = await admin.from("store_payment_settings").upsert(fallback, { onConflict: "id" }).select("*").single();
  }
  if (upsert.error) return fail(500, upsert.error.message);
  return ok({ config: upsert.data });
};

const mapDefaultBankReleaseManifest = (row: any) => ({
  id: asString(row?.id, 80) || "",
  version: Math.max(0, Math.floor(Number(row?.version || 0))),
  sourceBankTitle: asString(row?.source_bank_title, 255) || "Default Bank",
  sourceBankPadCount: Math.max(0, Math.floor(Number(row?.source_bank_pad_count || 0))),
  fileSizeBytes: Math.max(0, Math.floor(Number(row?.file_size_bytes || 0))),
  fileSha256: asString(row?.file_sha256, 128) || null,
  minAppVersion: asString(row?.min_app_version, 64) || null,
  publishedAt: asString(row?.published_at, 80) || null,
  releaseNotes: asString(row?.release_notes, 5000) || null,
});

const getPublicDefaultBankManifest = async () => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("default_bank_releases")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return ok({ manifest: null });
  return ok({
    manifest: mapDefaultBankReleaseManifest(data),
  });
};

const getPublicDefaultBankDownload = async () => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("default_bank_releases")
    .select("*")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "DEFAULT_BANK_RELEASE_NOT_FOUND");

  const storageBucket = asString(data?.storage_bucket, 300);
  const storageKey = asString(data?.storage_key, 2000);
  if (!storageBucket || !storageKey) return fail(500, "DEFAULT_BANK_RELEASE_STORAGE_MISSING");

  const signed = await createPresignedGetUrl(storageBucket, storageKey, STORE_R2_SIGNED_DOWNLOAD_TTL_SECONDS);
  return ok({
    release: mapDefaultBankReleaseManifest(data),
    downloadUrl: signed.url,
    downloadExpiresAt: signed.expiresAt,
  });
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const fnIndex = segments.findIndex((s) => s === "store-api");
    const scoped = fnIndex >= 0 ? segments.slice(fnIndex + 1) : [];

    if (req.method === "GET" && scoped[0] === "catalog" && scoped.length === 1) return await getStoreCatalog(req);
    if (req.method === "GET" && scoped[0] === "payment-config" && scoped.length === 1) return await getStorePaymentConfig(req);
    if (req.method === "GET" && scoped[0] === "landing-config" && scoped.length === 1) return await getLandingDownloadConfig();
    if (req.method === "GET" && scoped[0] === "buy-config" && scoped.length === 1) return await getPublicBuyConfig();
    if (req.method === "GET" && scoped[0] === "sampler-config" && scoped.length === 1) return await getPublicSamplerAppConfig();
    if (req.method === "GET" && scoped[0] === "default-bank" && scoped[1] === "manifest" && scoped.length === 2) {
      return await getPublicDefaultBankManifest();
    }
    if (req.method === "GET" && scoped[0] === "default-bank" && scoped[1] === "download" && scoped.length === 2) {
      return await getPublicDefaultBankDownload();
    }
    if (req.method === "GET" && scoped[0] === "asset" && scoped.length === 1) {
      return await getManagedStoreAsset(req);
    }
    if (req.method === "POST" && scoped[0] === "receipt-ocr" && scoped.length === 1) {
      return await createReceiptOcr(req);
    }
    if (req.method === "POST" && scoped[0] === "crash-report" && scoped.length === 1) {
      const body = await req.json().catch(() => ({}));
      return await submitClientCrashReport(req, body);
    }
    if (req.method === "POST" && scoped[0] === "account-registration" && scoped[1] === "proof-upload-url" && scoped.length === 2) {
      const body = await req.json().catch(() => ({}));
      return await createAccountRegistrationProofUploadUrl(req, body);
    }
    if (req.method === "POST" && scoped[0] === "account-registration" && scoped[1] === "submit" && scoped.length === 2) {
      const body = await req.json().catch(() => ({}));
      return await createAccountRegistrationSubmit(req, body);
    }
    if (req.method === "POST" && scoped[0] === "account-registration" && scoped[1] === "login-hint" && scoped.length === 2) {
      const body = await req.json().catch(() => ({}));
      return await getAccountRegistrationLoginHint(req, body);
    }
    if (req.method === "POST" && scoped[0] === "installer-request" && scoped[1] === "proof-upload-url" && scoped.length === 2) {
      const body = await req.json().catch(() => ({}));
      return await createInstallerRequestProofUploadUrl(req, body);
    }
    if (req.method === "POST" && scoped[0] === "installer-request" && scoped[1] === "submit" && scoped.length === 2) {
      const body = await req.json().catch(() => ({}));
      return await createInstallerPurchaseRequest(req, body);
    }
    if (req.method === "POST" && scoped[0] === "purchase-request" && scoped.length === 1) {
      const body = await req.json().catch(() => ({}));
      return await createStorePurchaseRequest(req, body);
    }
    if (req.method === "GET" && scoped[0] === "download" && scoped.length === 2) {
      const catalogItemId = asUuid(scoped[1]);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await downloadStoreCatalogItem(req, catalogItemId);
    }
    if (req.method === "GET" && scoped[0] === "download-key" && scoped.length === 2) {
      const catalogItemId = asUuid(scoped[1]);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      return await getStoreCatalogItemDecryptKey(req, catalogItemId);
    }

    if (scoped[0] === "admin" && scoped[1] === "account-registration") {
      const adminCheck = await requireAdmin(req);
      if (!adminCheck.ok) return adminCheck.response;
      const adminUserId = adminCheck.userId;
      if (req.method === "GET" && scoped[2] === "requests" && scoped.length === 3) {
        return await listAdminAccountRegistrationRequests(req);
      }
      if (req.method === "POST" && scoped[2] === "requests" && scoped[4] === "retry-email" && scoped.length === 5) {
        const requestId = asUuid(scoped[3]);
        if (!requestId) return badRequest("Invalid request id");
        return await adminAccountRegistrationRetryDecisionEmail(requestId, adminUserId);
      }
      if (req.method === "POST" && scoped[2] === "requests" && scoped.length === 4) {
        const requestId = asUuid(scoped[3]);
        if (!requestId) return badRequest("Invalid request id");
        const body = await req.json().catch(() => ({}));
        return await adminAccountRegistrationRequestAction(requestId, body, adminUserId);
      }
      return fail(404, "Unknown account registration route");
    }

    if (scoped[0] !== "admin" || scoped[1] !== "store") return fail(404, "Unknown store route");
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.response;
    const adminUserId = adminCheck.userId;

    if (req.method === "GET" && scoped[2] === "installer" && scoped[3] === "packages" && scoped.length === 4) {
      const version = asString(url.searchParams.get("version"), 10)?.trim().toUpperCase();
      if (!version) return badRequest("Missing version");
      const payload = await callInstallerAdmin<Record<string, unknown>>("GET", `/admin/packages?version=${encodeURIComponent(version)}`);
      return ok(payload);
    }
    if (req.method === "POST" && scoped[2] === "installer" && scoped[3] === "packages" && scoped[4] === "save" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      const payload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/packages/save", body);
      const version = normalizeInstallerBuyVersion((payload as any)?.item?.version ?? body?.version);
      if (version) {
        try {
          await syncInstallerBuyCatalogForVersion(createServiceClient(), version);
        } catch (error) {
          return fail(500, error instanceof Error ? error.message : "Failed to sync buy catalog");
        }
      }
      return ok(payload);
    }
    if (req.method === "POST" && scoped[2] === "installer" && scoped[3] === "packages" && scoped[4] === "delete" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      const payload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/packages/delete", body);
      const version = normalizeInstallerBuyVersion(body?.version);
      if (version) {
        try {
          await syncInstallerBuyCatalogForVersion(createServiceClient(), version);
        } catch (error) {
          return fail(500, error instanceof Error ? error.message : "Failed to sync buy catalog");
        }
      }
      return ok(payload);
    }
    if (req.method === "GET" && scoped[2] === "installer" && scoped[3] === "licenses" && scoped.length === 4) {
      const version = asString(url.searchParams.get("version"), 10)?.trim().toUpperCase();
      if (!version) return badRequest("Missing version");
      const params = new URLSearchParams();
      params.set("version", version);
      const q = asString(url.searchParams.get("q"), 200)?.trim();
      const status = asString(url.searchParams.get("status"), 40)?.trim();
      const page = asString(url.searchParams.get("page"), 20)?.trim();
      const perPage = asString(url.searchParams.get("perPage"), 20)?.trim();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (page) params.set("page", page);
      if (perPage) params.set("perPage", perPage);
      const payload = await callInstallerAdmin<Record<string, unknown>>("GET", `/admin/licenses?${params.toString()}`);
      return ok(payload);
    }
    if (req.method === "GET" && scoped[2] === "installer" && scoped[3] === "events" && scoped.length === 4) {
      const version = asString(url.searchParams.get("version"), 10)?.trim().toUpperCase();
      if (!version) return badRequest("Missing version");
      const params = new URLSearchParams();
      params.set("version", version);
      const q = asString(url.searchParams.get("q"), 200)?.trim();
      const eventType = asString(url.searchParams.get("eventType"), 40)?.trim();
      const page = asString(url.searchParams.get("page"), 20)?.trim();
      const perPage = asString(url.searchParams.get("perPage"), 20)?.trim();
      const licenseId = asString(url.searchParams.get("licenseId"), 20)?.trim();
      if (q) params.set("q", q);
      if (eventType) params.set("eventType", eventType);
      if (page) params.set("page", page);
      if (perPage) params.set("perPage", perPage);
      if (licenseId) params.set("licenseId", licenseId);
      const payload = await callInstallerAdmin<Record<string, unknown>>("GET", `/admin/events?${params.toString()}`);
      return ok(payload);
    }
    if (req.method === "POST" && scoped[2] === "installer" && scoped[3] === "licenses" && scoped[4] === "create" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      const payload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/licenses/create", body);
      return ok(payload);
    }
    if (req.method === "POST" && scoped[2] === "installer" && scoped[3] === "licenses" && scoped[4] === "update" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      const payload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/licenses/update", body);
      return ok(payload);
    }
    if (req.method === "POST" && scoped[2] === "installer" && scoped[3] === "licenses" && scoped[4] === "reset" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      const payload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/licenses/reset", body);
      return ok(payload);
    }
    if (req.method === "POST" && scoped[2] === "installer" && scoped[3] === "licenses" && scoped[4] === "delete" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      const payload = await callInstallerAdmin<Record<string, unknown>>("POST", "/admin/licenses/delete", body);
      return ok(payload);
    }
    if (req.method === "GET" && scoped[2] === "installer-buy" && scoped[3] === "products" && scoped.length === 4) {
      return await listAdminInstallerBuyProducts(req);
    }
    if (req.method === "POST" && scoped[2] === "installer-buy" && scoped[3] === "products" && scoped[4] === "save" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      return await saveAdminInstallerBuyProduct(body, adminUserId);
    }
    if (req.method === "POST" && scoped[2] === "installer-buy" && scoped[3] === "products" && scoped[4] === "delete" && scoped.length === 5) {
      const body = await req.json().catch(() => ({}));
      return await deleteAdminInstallerBuyProduct(body);
    }
    if (req.method === "GET" && scoped[2] === "installer-buy" && scoped[3] === "requests" && scoped.length === 4) {
      return await listAdminInstallerPurchaseRequests(req);
    }
    if (req.method === "POST" && scoped[2] === "installer-buy" && scoped[3] === "requests" && scoped.length === 5) {
      const requestId = asUuid(scoped[4]);
      if (!requestId) return badRequest("Invalid request id");
      const body = await req.json().catch(() => ({}));
      return await adminInstallerPurchaseRequestAction(requestId, body, adminUserId);
    }

    if (req.method === "GET" && scoped[2] === "crash-reports" && scoped.length === 3) {
      return await listAdminClientCrashReports(req);
    }
    if (req.method === "PATCH" && scoped[2] === "crash-reports" && scoped.length === 4) {
      const reportId = asUuid(scoped[3]);
      if (!reportId) return badRequest("Invalid crash report id");
      const body = await req.json().catch(() => ({}));
      return await patchAdminClientCrashReport(reportId, body);
    }
    if (req.method === "GET" && scoped[2] === "requests" && scoped.length === 3) return await listAdminStoreRequests(req);
    if (req.method === "POST" && scoped[2] === "requests" && scoped[4] === "retry-email" && scoped.length === 5) {
      const requestId = asUuid(scoped[3]);
      if (!requestId) return badRequest("Invalid request id");
      return await adminStoreRequestRetryDecisionEmail(requestId, adminUserId);
    }
    if (req.method === "POST" && scoped[2] === "requests" && scoped.length === 4) {
      const requestId = asUuid(scoped[3]);
      if (!requestId) return badRequest("Invalid request id");
      const body = await req.json().catch(() => ({}));
      return await adminStoreRequestAction(requestId, body, adminUserId);
    }
    if (req.method === "GET" && scoped[2] === "catalog" && scoped.length === 3) return await listAdminStoreCatalog();
    if (req.method === "POST" && scoped[2] === "assets" && scoped[3] === "upload" && scoped.length === 4) {
      const body = await req.json().catch(() => ({}));
      return await createAdminStoreAssetUpload(req, body);
    }
    if (req.method === "POST" && scoped[2] === "assets" && scoped[3] === "delete" && scoped.length === 4) {
      const body = await req.json().catch(() => ({}));
      return await deleteAdminStoreAsset(req, body);
    }
    if (req.method === "PATCH" && scoped[2] === "catalog" && scoped.length === 4) {
      const catalogItemId = asUuid(scoped[3]);
      if (!catalogItemId) return badRequest("Invalid catalog item id");
      const body = await req.json().catch(() => ({}));
      return await patchAdminStoreCatalog(catalogItemId, body, adminCheck.userId);
    }
    if (req.method === "GET" && scoped[2] === "promotions" && scoped.length === 3) return await listAdminStorePromotions();
    if (req.method === "POST" && scoped[2] === "promotions" && scoped.length === 3) {
      const body = await req.json().catch(() => ({}));
      return await createAdminStorePromotion(body, adminUserId);
    }
    if (req.method === "PATCH" && scoped[2] === "promotions" && scoped.length === 4) {
      const promotionId = asUuid(scoped[3]);
      if (!promotionId) return badRequest("Invalid promotion id");
      const body = await req.json().catch(() => ({}));
      return await patchAdminStorePromotion(promotionId, body, adminUserId);
    }
    if (req.method === "DELETE" && scoped[2] === "promotions" && scoped.length === 4) {
      const promotionId = asUuid(scoped[3]);
      if (!promotionId) return badRequest("Invalid promotion id");
      return await deleteAdminStorePromotion(promotionId);
    }
    if (req.method === "POST" && scoped[2] === "banners" && scoped.length === 3) {
      const body = await req.json().catch(() => ({}));
      return await createAdminStoreBanner(body, adminUserId);
    }
    if (req.method === "PATCH" && scoped[2] === "banners" && scoped.length === 4) {
      const bannerId = asUuid(scoped[3]);
      if (!bannerId) return badRequest("Invalid banner id");
      const body = await req.json().catch(() => ({}));
      return await patchAdminStoreBanner(bannerId, body, adminUserId);
    }
    if (req.method === "DELETE" && scoped[2] === "banners" && scoped.length === 4) {
      const bannerId = asUuid(scoped[3]);
      if (!bannerId) return badRequest("Invalid banner id");
      return await deleteAdminStoreBanner(bannerId);
    }
    if (req.method === "GET" && scoped[2] === "config" && scoped.length === 3) return await getAdminStoreConfig();
    if (req.method === "POST" && scoped[2] === "config" && scoped.length === 3) {
      const body = await req.json().catch(() => ({}));
      return await saveAdminStoreConfig(body, adminUserId);
    }
    if (req.method === "GET" && scoped[2] === "landing-config" && scoped.length === 3) return await getAdminLandingDownloadConfig();
    if (req.method === "POST" && scoped[2] === "landing-config" && scoped.length === 3) {
      const body = await req.json().catch(() => ({}));
      return await saveAdminLandingDownloadConfig(body, adminUserId);
    }
    if (req.method === "GET" && scoped[2] === "sampler-config" && scoped.length === 3) return await getAdminSamplerAppConfig();
    if (req.method === "POST" && scoped[2] === "sampler-config" && scoped.length === 3) {
      const body = await req.json().catch(() => ({}));
      return await saveAdminSamplerAppConfig(body, adminUserId);
    }
    return fail(404, "Unknown store route");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return fail(500, message);
  }
});
