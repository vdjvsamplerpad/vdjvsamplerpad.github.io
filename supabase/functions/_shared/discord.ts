import { asObject, asString, extractPadNames } from "./validate.ts";

type ActivityEventType =
  | "auth.login"
  | "auth.signup"
  | "auth.signout"
  | "bank.export"
  | "bank.import";

type ActivityStatus = "success" | "failed";
export type DiscordSeverity = "info" | "warning" | "critical";

type DevicePayload = {
  fingerprint?: string | null;
  name?: string | null;
  model?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  raw?: Record<string, unknown> | null;
};

export type DiscordField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordAttachment = {
  fileName: string;
  text: string;
};

const WEBHOOK_HTTP_TIMEOUT_MS = Math.max(1000, Number(Deno.env.get("WEBHOOK_HTTP_TIMEOUT_MS") || 5000));
const GEO_LOOKUP_TIMEOUT_MS = Math.max(500, Number(Deno.env.get("GEO_LOOKUP_TIMEOUT_MS") || 2500));
const DISCORD_ENV_LABEL =
  asString(Deno.env.get("DISCORD_ENV_LABEL"), 120)
  || asString(Deno.env.get("APP_ENV"), 120)
  || asString(Deno.env.get("ENVIRONMENT"), 120)
  || null;

const DISCORD_WEBHOOK_INFO = asString(Deno.env.get("DISCORD_WEBHOOK_INFO"), 5000);
const DISCORD_WEBHOOK_WARNING = asString(Deno.env.get("DISCORD_WEBHOOK_WARNING"), 5000);
const DISCORD_WEBHOOK_CRITICAL = asString(Deno.env.get("DISCORD_WEBHOOK_CRITICAL"), 5000);
const DISCORD_WEBHOOK_ACCOUNT = asString(Deno.env.get("DISCORD_WEBHOOK_ACCOUNT"), 5000);
const DISCORD_WEBHOOK_STORE = asString(Deno.env.get("DISCORD_WEBHOOK_STORE"), 5000);
const DISCORD_WEBHOOK_INSTALLER = asString(Deno.env.get("DISCORD_WEBHOOK_INSTALLER"), 5000);

const DISCORD_EMBED_COLORS: Record<DiscordSeverity, number> = {
  info: 0x2563eb,
  warning: 0xf59e0b,
  critical: 0xdc2626,
};

const isPrivateIp = (ip: string): boolean =>
  ip === "127.0.0.1" ||
  ip === "::1" ||
  ip.startsWith("10.") ||
  ip.startsWith("192.168.") ||
  ip.startsWith("172.16.") ||
  ip.startsWith("172.17.") ||
  ip.startsWith("172.18.") ||
  ip.startsWith("172.19.") ||
  ip.startsWith("172.2") ||
  ip.startsWith("172.3");

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchGeo = async (ip: string): Promise<Record<string, string> | null> => {
  try {
    if (!ip || isPrivateIp(ip)) return null;
    const resp = await fetchWithTimeout(
      `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      { method: "GET" },
      GEO_LOOKUP_TIMEOUT_MS,
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.error) return null;
    return {
      city: data?.city || "",
      region: data?.region || "",
      country: data?.country_name || data?.country || "",
      timezone: data?.timezone || "",
      org: data?.org || data?.org_name || "",
    };
  } catch {
    return null;
  }
};

const mapDeviceForDisplay = (device: DevicePayload): string =>
  device.name ||
  device.model ||
  [device.platform, device.os, device.browser].filter(Boolean).join(" / ") ||
  "unknown";

const resolveSeverityWebhook = (
  severity: DiscordSeverity,
  fallbackWebhook?: string | null,
): string | null => {
  if (severity === "critical") {
    return DISCORD_WEBHOOK_CRITICAL || DISCORD_WEBHOOK_WARNING || DISCORD_WEBHOOK_INFO || fallbackWebhook || null;
  }
  if (severity === "warning") {
    return DISCORD_WEBHOOK_WARNING || DISCORD_WEBHOOK_INFO || fallbackWebhook || null;
  }
  return DISCORD_WEBHOOK_INFO || fallbackWebhook || null;
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}\u2026` : value;

const suffixValue = (value: string | null | undefined, size = 8): string | null => {
  const normalized = asString(value, 300);
  if (!normalized) return null;
  if (normalized.length <= size) return normalized;
  return `…${normalized.slice(-size)}`;
};

const formatIdList = (values: string[] | null | undefined): string | null => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const normalized = values
    .map((value) => asString(value, 120))
    .filter((value): value is string => Boolean(value));
  if (normalized.length === 0) return null;
  const listed = normalized.slice(0, 5).map((value) => suffixTraceValue(value, 8) || value);
  const remainder = normalized.length - listed.length;
  return remainder > 0 ? `${listed.join(", ")} +${remainder} more` : listed.join(", ");
};

const normalizeFieldValue = (value: unknown, maxLength = 1024): string | null => {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : String(value).trim();
  if (!text) return null;
  return truncate(text, maxLength);
};

const sanitizeFields = (fields: DiscordField[]): DiscordField[] =>
  fields
    .map((field) => {
      const name = normalizeFieldValue(field.name, 256);
      const value = normalizeFieldValue(field.value, 1024);
      if (!name || !value) return null;
      return {
        name,
        value,
        inline: field.inline !== false,
      };
    })
    .filter((field): field is DiscordField => Boolean(field))
    .slice(0, 25);

const suffixTraceValue = (value: string | null | undefined, size = 8): string | null => {
  const normalized = asString(value, 300);
  if (!normalized) return null;
  if (normalized.length <= size) return normalized;
  return `...${normalized.slice(-size)}`;
};

const buildFooterLabel = (severity: DiscordSeverity): string => {
  const parts = [severity.toUpperCase()];
  if (DISCORD_ENV_LABEL) parts.push(DISCORD_ENV_LABEL);
  return parts.join(" | ");
};

const buildFooterText = (severity: DiscordSeverity): string => {
  const parts = [severity.toUpperCase()];
  if (DISCORD_ENV_LABEL) parts.push(DISCORD_ENV_LABEL);
  return parts.join(" · ");
};

export const buildDiscordTraceFields = (input: {
  requestId?: string | null;
  userId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  sessionKey?: string | null;
  deviceSessionId?: string | null;
  deviceFingerprint?: string | null;
  bankId?: string | null;
  bankIds?: string[] | null;
  catalogItemId?: string | null;
  catalogItemIds?: string[] | null;
  batchId?: string | null;
  receiptReference?: string | null;
  decisionSource?: string | null;
  automationResult?: string | null;
}): DiscordField[] => {
  const fields: DiscordField[] = [];
  const push = (name: string, value: string | null | undefined, inline = true) => {
    const normalized = normalizeFieldValue(value);
    if (!normalized) return;
    fields.push({ name, value: normalized, inline });
  };

  push("Request ID", suffixTraceValue(input.requestId, 10));
  push("User ID", suffixTraceValue(input.userId, 10));
  push("Actor ID", suffixTraceValue(input.actorUserId, 10));
  push("Actor Email", input.actorEmail || null);
  push("Session", suffixTraceValue(input.sessionKey, 10));
  push("Device Session", suffixTraceValue(input.deviceSessionId, 10));
  push("Fingerprint", suffixTraceValue(input.deviceFingerprint, 10));
  push("Bank ID", suffixTraceValue(input.bankId, 10));
  push("Bank IDs", formatIdList(input.bankIds || null), false);
  push("Catalog Item", suffixTraceValue(input.catalogItemId, 10));
  push("Catalog Items", formatIdList(input.catalogItemIds || null), false);
  push("Batch ID", suffixTraceValue(input.batchId, 10));
  push("Receipt", input.receiptReference || null);
  push("Decision", input.decisionSource || null);
  push("Automation", input.automationResult || null);
  return fields;
};

const postDiscordPayload = async (
  url: string,
  payload: Record<string, unknown>,
  attachment?: DiscordAttachment,
) => {
  let resp: Response;
  if (attachment) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("file", new Blob([attachment.text], { type: "text/plain" }), attachment.fileName);
    resp = await fetchWithTimeout(url, { method: "POST", body: form }, WEBHOOK_HTTP_TIMEOUT_MS);
  } else {
    resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      WEBHOOK_HTTP_TIMEOUT_MS,
    );
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

export const sendDiscordNotification = async (input: {
  webhook?: string | null;
  severity: DiscordSeverity;
  colorOverride?: number | null;
  title: string;
  description?: string | null;
  fields?: DiscordField[];
  attachment?: DiscordAttachment | null;
  clientIp?: string | null;
  includeGeoLookup?: boolean;
  preferExplicitWebhook?: boolean;
}) => {
  const webhookUrl = input.preferExplicitWebhook
    ? (input.webhook || null)
    : resolveSeverityWebhook(input.severity, input.webhook);
  if (!webhookUrl) return;

  const fields = [...(input.fields || [])];
  if (input.clientIp) {
    fields.push({ name: "IP", value: input.clientIp, inline: true });
  }
  if (input.includeGeoLookup && input.clientIp) {
    const geo = await fetchGeo(input.clientIp);
    if (geo?.city || geo?.region || geo?.country) {
      fields.push({
        name: "Location",
        value: [geo.city, geo.region, geo.country].filter(Boolean).join(", "),
        inline: false,
      });
    }
    if (geo?.timezone) fields.push({ name: "Geo TZ", value: geo.timezone, inline: true });
    if (geo?.org) fields.push({ name: "Org", value: geo.org, inline: false });
  }

  const embed = {
    title: truncate(`${DISCORD_ENV_LABEL ? `[${DISCORD_ENV_LABEL}] ` : ""}${input.title}`, 256),
    description: input.description ? truncate(input.description, 4096) : undefined,
    color: typeof input.colorOverride === "number" ? input.colorOverride : DISCORD_EMBED_COLORS[input.severity],
    fields: sanitizeFields(fields),
    timestamp: new Date().toISOString(),
    footer: {
      text: buildFooterLabel(input.severity),
    },
  };

  await postDiscordPayload(
    webhookUrl,
    {
      allowed_mentions: { parse: [] },
      embeds: [embed],
    },
    input.attachment || undefined,
  );
};

export const sendDiscordAuthEvent = async (input: {
  webhook: string | null;
  eventType: ActivityEventType;
  email: string;
  device: DevicePayload;
  status?: ActivityStatus;
  errorMessage?: string | null;
  clientIp?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  deviceSessionId?: string | null;
  isAdminLogin?: boolean;
  appVersion?: string | null;
  runtime?: string | null;
}) => {
  const eventName = input.eventType.replace("auth.", "").toUpperCase();
  const severity: DiscordSeverity = input.isAdminLogin
    ? "critical"
    : input.status === "failed"
      ? "warning"
      : "info";
  const fields: DiscordField[] = [
    { name: "Status", value: (input.status || "success").toUpperCase(), inline: true },
    { name: "Email", value: input.email, inline: true },
    { name: "Device", value: mapDeviceForDisplay(input.device), inline: false },
    ...buildDiscordTraceFields({
      userId: input.userId,
      sessionKey: input.sessionKey,
      deviceSessionId: input.deviceSessionId,
      deviceFingerprint: input.device?.fingerprint || null,
    }),
  ];
  if (input.device?.model) fields.push({ name: "Model", value: input.device.model, inline: true });
  if (input.device?.platform) fields.push({ name: "Platform", value: input.device.platform, inline: true });
  if (input.device?.browser) fields.push({ name: "Browser", value: input.device.browser, inline: true });
  if (input.device?.os) fields.push({ name: "OS", value: input.device.os, inline: true });
  if (input.runtime) fields.push({ name: "Runtime", value: input.runtime, inline: true });
  if (input.appVersion) fields.push({ name: "App Version", value: input.appVersion, inline: true });
  if (input.errorMessage) fields.push({ name: "Error", value: input.errorMessage, inline: false });

  await sendDiscordNotification({
    webhook: input.webhook,
    severity,
    title: input.isAdminLogin ? "Admin Login" : `Auth ${eventName}`,
    description: input.isAdminLogin
      ? "Admin sign-in detected."
      : input.status === "failed"
        ? "Authentication event failed."
        : "Authentication event recorded.",
    fields,
    clientIp: input.clientIp || null,
    includeGeoLookup: Boolean(input.isAdminLogin),
  });
};

export const sendDiscordExportEvent = async (input: {
  webhook: string | null;
  status?: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  errorMessage?: string | null;
  userId?: string | null;
  bankId?: string | null;
  requestId?: string | null;
  appVersion?: string | null;
  runtime?: string | null;
}) => {
  const severity: DiscordSeverity = input.status === "failed" ? "warning" : "info";
  const sanitizedBankName = String(input.bankName).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "bank";
  const padListText = [
    `Bank: ${input.bankName}`,
    `Email: ${input.email}`,
    `Pad Count: ${input.padNames.length}`,
    "",
    ...(input.padNames.length ? input.padNames.map((name) => `- ${name}`) : ["- (no pads)"]),
  ].join("\n");

  await sendDiscordNotification({
    webhook: input.webhook,
    severity,
    preferExplicitWebhook: true,
    title: "Bank Export",
    description: input.status === "failed" ? "Bank export failed." : "Bank export completed.",
    fields: [
      { name: "Status", value: (input.status || "success").toUpperCase(), inline: true },
      { name: "Email", value: input.email, inline: true },
      ...(input.runtime ? [{ name: "Runtime", value: input.runtime, inline: true }] : []),
      ...(input.appVersion ? [{ name: "App Version", value: input.appVersion, inline: true }] : []),
      { name: "Bank", value: input.bankName, inline: false },
      { name: "Pad Count", value: String(input.padNames.length), inline: true },
      ...(input.errorMessage ? [{ name: "Error", value: input.errorMessage, inline: false }] : []),
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        userId: input.userId,
        bankId: input.bankId,
      }),
    ],
    attachment: {
      fileName: `export_${sanitizedBankName}_pads.txt`,
      text: padListText,
    },
  });
};

export const sendDiscordImportEvent = async (input: {
  webhook: string | null;
  status: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  includePadList: boolean;
  errorMessage?: string | null;
  userId?: string | null;
  bankId?: string | null;
  requestId?: string | null;
  appVersion?: string | null;
  runtime?: string | null;
}) => {
  const severity: DiscordSeverity = input.status === "failed" ? "warning" : "info";
  const shouldShowPads = input.includePadList && input.padNames.length > 0;
  const attachment = shouldShowPads
    ? {
        fileName: `import_${String(input.bankName).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "bank"}_pads.txt`,
        text: [
          `Bank: ${input.bankName}`,
          `Email: ${input.email}`,
          `Status: ${input.status.toUpperCase()}`,
          "",
          input.padNames.map((name) => `- ${name}`).join("\n"),
        ].join("\n"),
      }
    : null;

  await sendDiscordNotification({
    webhook: input.webhook,
    severity,
    preferExplicitWebhook: true,
    title: "Bank Import",
    description: input.status === "failed" ? "Bank import failed." : "Bank import completed.",
    fields: [
      { name: "Status", value: input.status.toUpperCase(), inline: true },
      { name: "Email", value: input.email, inline: true },
      ...(input.runtime ? [{ name: "Runtime", value: input.runtime, inline: true }] : []),
      ...(input.appVersion ? [{ name: "App Version", value: input.appVersion, inline: true }] : []),
      { name: "Bank", value: input.bankName, inline: false },
      ...(shouldShowPads ? [{ name: "Pad Count", value: String(input.padNames.length), inline: true }] : []),
      ...(input.errorMessage ? [{ name: "Error", value: input.errorMessage, inline: false }] : []),
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        userId: input.userId,
        bankId: input.bankId,
      }),
    ],
    attachment,
  });
};

export const sendDiscordAdminActionEvent = async (input: {
  severity: DiscordSeverity;
  title: string;
  description?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  targetUserId?: string | null;
  bankId?: string | null;
  bankIds?: string[] | null;
  catalogItemId?: string | null;
  requestId?: string | null;
  clientIp?: string | null;
  extraFields?: DiscordField[];
}) => {
  await sendDiscordNotification({
    severity: input.severity,
    title: input.title,
    description: input.description || "Admin action recorded.",
    clientIp: input.clientIp || null,
    fields: [
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        userId: input.targetUserId,
        bankId: input.bankId,
        bankIds: input.bankIds || null,
        catalogItemId: input.catalogItemId,
      }),
      ...(input.extraFields || []),
    ],
  });
};

export const sendDiscordAccountRegistrationEvent = async (input: {
  webhook?: string | null;
  severity: DiscordSeverity;
  colorOverride?: number | null;
  title: string;
  description?: string | null;
  requestId?: string | null;
  email: string;
  displayName?: string | null;
  paymentChannel?: string | null;
  payerName?: string | null;
  referenceNo?: string | null;
  receiptReference?: string | null;
  proofPath?: string | null;
  decisionSource?: string | null;
  automationResult?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  extraFields?: DiscordField[];
}) => {
  await sendDiscordNotification({
    webhook: input.webhook || DISCORD_WEBHOOK_ACCOUNT || null,
    preferExplicitWebhook: true,
    severity: input.severity,
    colorOverride: input.colorOverride,
    title: input.title,
    description: input.description || "Account registration event recorded.",
    fields: [
      { name: "Email", value: input.email, inline: true },
      ...(input.displayName ? [{ name: "Display Name", value: input.displayName, inline: true }] : []),
      ...(input.paymentChannel ? [{ name: "Payment Channel", value: input.paymentChannel, inline: true }] : []),
      ...(input.payerName ? [{ name: "Payer", value: input.payerName, inline: true }] : []),
      ...(input.referenceNo ? [{ name: "Reference", value: input.referenceNo, inline: true }] : []),
      ...(input.proofPath ? [{ name: "Proof", value: input.proofPath, inline: false }] : []),
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        receiptReference: input.receiptReference,
        decisionSource: input.decisionSource,
        automationResult: input.automationResult,
      }),
      ...(input.extraFields || []),
    ],
  });
};

export const sendDiscordStoreRequestEvent = async (input: {
  webhook?: string | null;
  severity: DiscordSeverity;
  colorOverride?: number | null;
  title: string;
  description?: string | null;
  requestId?: string | null;
  userId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  bankIds?: string[] | null;
  catalogItemIds?: string[] | null;
  batchId?: string | null;
  receiptReference?: string | null;
  paymentChannel?: string | null;
  payerName?: string | null;
  referenceNo?: string | null;
  decisionSource?: string | null;
  automationResult?: string | null;
  extraFields?: DiscordField[];
}) => {
  await sendDiscordNotification({
    webhook: input.webhook || DISCORD_WEBHOOK_STORE || null,
    preferExplicitWebhook: true,
    severity: input.severity,
    colorOverride: input.colorOverride,
    title: input.title,
    description: input.description || "Store request event recorded.",
    fields: [
      ...(input.paymentChannel ? [{ name: "Payment Channel", value: input.paymentChannel, inline: true }] : []),
      ...(input.payerName ? [{ name: "Payer", value: input.payerName, inline: true }] : []),
      ...(input.referenceNo ? [{ name: "Reference", value: input.referenceNo, inline: true }] : []),
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        userId: input.userId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        bankIds: input.bankIds || null,
        catalogItemIds: input.catalogItemIds || null,
        batchId: input.batchId,
        receiptReference: input.receiptReference,
        decisionSource: input.decisionSource,
        automationResult: input.automationResult,
      }),
      ...(input.extraFields || []),
    ],
  });
};

export const sendDiscordInstallerRequestEvent = async (input: {
  webhook?: string | null;
  severity: DiscordSeverity;
  colorOverride?: number | null;
  title: string;
  description?: string | null;
  requestId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  email: string;
  version?: string | null;
  purchaseLabel?: string | null;
  skuCodes?: string[] | null;
  paymentChannel?: string | null;
  payerName?: string | null;
  referenceNo?: string | null;
  receiptReference?: string | null;
  decisionSource?: string | null;
  automationResult?: string | null;
  extraFields?: DiscordField[];
}) => {
  await sendDiscordNotification({
    webhook: input.webhook || DISCORD_WEBHOOK_INSTALLER || null,
    preferExplicitWebhook: true,
    severity: input.severity,
    colorOverride: input.colorOverride,
    title: input.title,
    description: input.description || "Installer request event recorded.",
    fields: [
      { name: "Email", value: input.email, inline: true },
      ...(input.version ? [{ name: "Version", value: input.version, inline: true }] : []),
      ...(input.purchaseLabel ? [{ name: "Purchase", value: input.purchaseLabel, inline: false }] : []),
      ...(Array.isArray(input.skuCodes) && input.skuCodes.length > 0
        ? [{ name: "SKU Codes", value: input.skuCodes.join(", "), inline: false }]
        : []),
      ...(input.paymentChannel ? [{ name: "Payment Channel", value: input.paymentChannel, inline: true }] : []),
      ...(input.payerName ? [{ name: "Payer", value: input.payerName, inline: true }] : []),
      ...(input.referenceNo ? [{ name: "Reference", value: input.referenceNo, inline: true }] : []),
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        receiptReference: input.receiptReference,
        decisionSource: input.decisionSource,
        automationResult: input.automationResult,
      }),
      ...(input.extraFields || []),
    ],
  });
};

export const sendDiscordStoreCrashReportEvent = async (input: {
  webhook?: string | null;
  severity?: DiscordSeverity;
  reportId: string;
  userId?: string | null;
  email?: string | null;
  domain?: "bank_store" | "playback" | "global_runtime" | null;
  platform?: string | null;
  appVersion?: string | null;
  operation?: string | null;
  phase?: string | null;
  stage?: string | null;
  repeatCount?: number | null;
  fingerprint?: string | null;
  extraFields?: DiscordField[];
}) => {
  const domain = input.domain || "bank_store";
  const titleBase = domain === "playback"
    ? "Playback Crash Report"
    : domain === "global_runtime"
      ? "Runtime Crash Report"
      : "Store Crash Report";
  const description = domain === "playback"
    ? "A user submitted a recovered playback or audio stress crash report."
    : domain === "global_runtime"
      ? "A user submitted a recovered global runtime error report."
      : "A user submitted a recovered Bank Store crash report.";
  await sendDiscordNotification({
    webhook: input.webhook || DISCORD_WEBHOOK_STORE || null,
    preferExplicitWebhook: true,
    severity: input.severity || "warning",
    title: (input.repeatCount || 1) > 1 ? `Repeated ${titleBase}` : titleBase,
    description,
    fields: [
      ...(input.email ? [{ name: "Email", value: input.email, inline: true }] : []),
      { name: "Domain", value: domain, inline: true },
      ...(input.platform ? [{ name: "Platform", value: input.platform, inline: true }] : []),
      ...(input.appVersion ? [{ name: "App Version", value: input.appVersion, inline: true }] : []),
      ...(input.operation ? [{ name: "Operation", value: input.operation, inline: true }] : []),
      ...(input.phase ? [{ name: "Phase", value: input.phase, inline: true }] : []),
      ...(input.stage ? [{ name: "Stage", value: input.stage, inline: true }] : []),
      ...(input.repeatCount ? [{ name: "Repeat Count", value: String(input.repeatCount), inline: true }] : []),
      ...(input.fingerprint ? [{ name: "Fingerprint", value: suffixTraceValue(input.fingerprint, 12) || input.fingerprint, inline: true }] : []),
      { name: "Report ID", value: suffixTraceValue(input.reportId, 12) || input.reportId, inline: true },
      ...buildDiscordTraceFields({
        requestId: input.reportId,
        userId: input.userId,
      }),
      ...(input.extraFields || []),
    ],
  });
};

export const sendDiscordOcrFailureEvent = async (input: {
  webhook?: string | null;
  severity?: DiscordSeverity;
  context: "account_registration" | "bank_store" | "unknown";
  subject?: string | null;
  email?: string | null;
  errorCode?: string | null;
  provider?: string | null;
  receiptReference?: string | null;
  bankIds?: string[] | null;
  catalogItemIds?: string[] | null;
  requestId?: string | null;
}) => {
  const domainWebhook = input.context === "account_registration"
    ? DISCORD_WEBHOOK_ACCOUNT
    : input.context === "bank_store"
      ? DISCORD_WEBHOOK_STORE
      : null;
  await sendDiscordNotification({
    webhook: input.webhook || domainWebhook || null,
    preferExplicitWebhook: true,
    severity: input.severity || "warning",
    title: "OCR Receipt Failure",
    description: "Receipt OCR did not complete successfully.",
    fields: [
      { name: "Context", value: input.context, inline: true },
      ...(input.subject ? [{ name: "Subject", value: input.subject, inline: true }] : []),
      ...(input.email ? [{ name: "Email", value: input.email, inline: true }] : []),
      ...(input.errorCode ? [{ name: "Error Code", value: input.errorCode, inline: true }] : []),
      ...(input.provider ? [{ name: "Provider", value: input.provider, inline: true }] : []),
      ...buildDiscordTraceFields({
        requestId: input.requestId,
        receiptReference: input.receiptReference,
        bankIds: input.bankIds || null,
        catalogItemIds: input.catalogItemIds || null,
      }),
    ],
  });
};

export const sendDiscordSessionConflictEvent = async (input: {
  userId: string;
  email?: string | null;
  sessionKey?: string | null;
  deviceSessionId?: string | null;
  clientIp?: string | null;
  lastEvent?: string | null;
  appVersion?: string | null;
  runtime?: string | null;
}) => {
  await sendDiscordNotification({
    severity: "warning",
    title: "Session Conflict",
    description: "A session was invalidated by a newer login or forced signout condition.",
    clientIp: input.clientIp || null,
    fields: [
      ...(input.email ? [{ name: "Email", value: input.email, inline: true }] : []),
      ...(input.lastEvent ? [{ name: "Last Event", value: input.lastEvent, inline: true }] : []),
      ...(input.runtime ? [{ name: "Runtime", value: input.runtime, inline: true }] : []),
      ...(input.appVersion ? [{ name: "App Version", value: input.appVersion, inline: true }] : []),
      ...buildDiscordTraceFields({
        userId: input.userId,
        sessionKey: input.sessionKey,
        deviceSessionId: input.deviceSessionId,
      }),
    ],
  });
};

export const parseDiscordWebhookPayload = (body: Record<string, unknown>) => ({
  status: String(body.status || "").toLowerCase() === "failed" ? "failed" : "success",
  email: asString(body.email, 320),
  bankName: asString(body.bankName, 200),
  padNames: extractPadNames(body.padNames),
  includePadList: Boolean(body.includePadList),
  errorMessage: asString(body.errorMessage, 2000),
  event: asString(body.event, 40),
  device: asObject(body.device),
});
