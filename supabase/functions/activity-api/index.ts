import "@supabase/functions-js/edge-runtime.d.ts"
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import { createServiceClient, getUserFromAuthHeader, isAdminUser } from "../_shared/supabase.ts";
import { asNumber, asObject, asString, asUuid, extractPadNames } from "../_shared/validate.ts";
import {
  sendDiscordAuthEvent,
  sendDiscordExportEvent,
  sendDiscordImportEvent,
  sendDiscordSessionConflictEvent,
} from "../_shared/discord.ts";
import { consumeRateLimit } from "../_shared/rate-limit.ts";

type ActivityEventType =
  | "auth.login"
  | "auth.signup"
  | "auth.signout"
  | "bank.export"
  | "bank.import";
type ActivityStatus = "success" | "failed";
type DevicePayload = {
  fingerprint?: string | null;
  name?: string | null;
  model?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  raw?: Record<string, unknown> | null;
};

const EVENT_TYPES: ActivityEventType[] = [
  "auth.login",
  "auth.signup",
  "auth.signout",
  "bank.export",
  "bank.import",
];

const STATUS_VALUES: ActivityStatus[] = ["success", "failed"];
const MAX_META_PAD_NAMES = 200;

const isEventType = (value: unknown): value is ActivityEventType =>
  typeof value === "string" && EVENT_TYPES.includes(value as ActivityEventType);

const isStatus = (value: unknown): value is ActivityStatus =>
  typeof value === "string" && STATUS_VALUES.includes(value as ActivityStatus);

const normalizeExportPhase = (value: unknown): string | null => {
  const phase = asString(value, 80);
  if (!phase) return null;
  if (phase === "github_upload") return "remote_upload";
  if (
    phase === "requested" ||
    phase === "local_export" ||
    phase === "remote_upload" ||
    phase === "backup_export" ||
    phase === "backup_restore" ||
    phase === "media_recovery"
  ) return phase;
  return null;
};

const normalizeDevice = (value: unknown): DevicePayload => {
  const raw = asObject(value);
  return {
    fingerprint: asString(raw.fingerprint, 256),
    name: asString(raw.name, 200),
    model: asString(raw.model, 200),
    platform: asString(raw.platform, 120),
    browser: asString(raw.browser, 120),
    os: asString(raw.os, 120),
    raw: asObject(raw.raw),
  };
};

const parseClientIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("X-Forwarded-For");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim() || "";
  return first.replace("::ffff:", "") || null;
};

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const ACTIVITY_EVENT_RATE_LIMIT = readPositiveInt(Deno.env.get("ACTIVITY_EVENT_RATE_LIMIT"), 120);
const ACTIVITY_EVENT_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACTIVITY_EVENT_RATE_WINDOW_SECONDS"), 600);
const ACTIVITY_HEARTBEAT_RATE_LIMIT = readPositiveInt(Deno.env.get("ACTIVITY_HEARTBEAT_RATE_LIMIT"), 40);
const ACTIVITY_HEARTBEAT_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACTIVITY_HEARTBEAT_RATE_WINDOW_SECONDS"), 600);
const ACTIVITY_SESSION_CHECK_RATE_LIMIT = readPositiveInt(Deno.env.get("ACTIVITY_SESSION_CHECK_RATE_LIMIT"), 30);
const ACTIVITY_SESSION_CHECK_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACTIVITY_SESSION_CHECK_RATE_WINDOW_SECONDS"), 600);
const ACTIVITY_SESSION_CLAIM_RATE_LIMIT = readPositiveInt(Deno.env.get("ACTIVITY_SESSION_CLAIM_RATE_LIMIT"), 24);
const ACTIVITY_SESSION_CLAIM_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACTIVITY_SESSION_CLAIM_RATE_WINDOW_SECONDS"), 600);
const ACTIVITY_SESSION_CLAIM_STALE_MS = readPositiveInt(Deno.env.get("ACTIVITY_SESSION_CLAIM_STALE_SECONDS"), 6 * 60) * 1000;
const ACTIVITY_SIGNOUT_RATE_LIMIT = readPositiveInt(Deno.env.get("ACTIVITY_SIGNOUT_RATE_LIMIT"), 15);
const ACTIVITY_SIGNOUT_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("ACTIVITY_SIGNOUT_RATE_WINDOW_SECONDS"), 600);

const requireAuthenticatedActor = async (
  req: Request,
  bodyUserId: string | null,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const authUser = await getUserFromAuthHeader(authHeader);
  if (!authUser?.id) {
    return { ok: false, response: json(401, { ok: false, error: "NOT_AUTHENTICATED" }, req) };
  }
  if (bodyUserId && authUser.id !== bodyUserId) {
    return { ok: false, response: json(403, { ok: false, error: "ACTOR_MISMATCH" }, req) };
  }
  return { ok: true, userId: authUser.id };
};

const writeActivityLog = async (payload: {
  requestId: string;
  eventType: ActivityEventType;
  status: ActivityStatus;
  userId?: string | null;
  email?: string | null;
  sessionKey?: string | null;
  device: DevicePayload;
  bankId?: string | null;
  bankName?: string | null;
  padCount?: number | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown>;
}) => {
  const admin = createServiceClient();
  const insertPayload: Record<string, unknown> = {
    request_id: payload.requestId,
    event_type: payload.eventType,
    status: payload.status,
    user_id: payload.userId || null,
    email: payload.email || null,
    session_key: payload.sessionKey || null,
    device_fingerprint: payload.device?.fingerprint || null,
    device_name: payload.device?.name || null,
    device_model: payload.device?.model || null,
    platform: payload.device?.platform || null,
    browser: payload.device?.browser || null,
    os: payload.device?.os || null,
    bank_id: payload.bankId || null,
    bank_uuid: asUuid(payload.bankId),
    bank_name: payload.bankName || null,
    pad_count: payload.padCount ?? null,
    error_message: payload.errorMessage || null,
    meta: asObject(payload.meta),
  };

  let supportsBankUuid = true;
  let insertResult = await admin
    .from("activity_logs")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertResult.error && /bank_uuid/i.test(insertResult.error.message || "")) {
    supportsBankUuid = false;
    const { bank_uuid: _skip, ...fallbackPayload } = insertPayload;
    insertResult = await admin
      .from("activity_logs")
      .insert(fallbackPayload)
      .select("id")
      .single();
  }

  const error = insertResult.error;

  if (!error) return { deduped: false };
  if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
    return { deduped: true };
  }
  if (error.code === "23503" || /activity_logs_user_id_fkey/i.test(error.message || "")) {
    const retryPayload: Record<string, unknown> = {
      ...insertPayload,
      user_id: null,
    };
    if (!supportsBankUuid) delete retryPayload.bank_uuid;

    const retry = await admin
      .from("activity_logs")
      .insert(retryPayload)
      .select("id")
      .single();
    if (!retry.error) return { deduped: false };
    throw new Error(retry.error.message);
  }
  throw new Error(error.message);
};

const claimSingleActiveSession = async (payload: {
  userId: string;
  sessionKey: string;
  deviceSessionId: string;
  email?: string | null;
  device: DevicePayload;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  const admin = createServiceClient();
  const rpc = await admin.rpc("claim_single_active_session", {
    p_user_id: payload.userId,
    p_device_session_id: payload.deviceSessionId,
    p_session_key: payload.sessionKey,
    p_email: payload.email || null,
    p_device_fingerprint: payload.device.fingerprint || "unknown",
    p_device_name: payload.device.name || null,
    p_device_model: payload.device.model || null,
    p_platform: payload.device.platform || null,
    p_browser: payload.device.browser || null,
    p_os: payload.device.os || null,
    p_ip: payload.ip || null,
    p_meta: asObject(payload.meta),
  });
  if (!rpc.error) {
    await recordDailyAttendance({
      userId: payload.userId,
      sessionKey: payload.sessionKey,
      email: payload.email,
      device: payload.device,
      lastEvent: "auth.login",
      meta: {
        ...(payload.meta || {}),
        deviceSessionId: payload.deviceSessionId,
      },
    });
    return;
  }

  // Fallback for partial rollout: keep current session row up-to-date.
  await upsertActiveSession({
    sessionKey: payload.sessionKey,
    userId: payload.userId,
    email: payload.email,
    device: payload.device,
    ip: payload.ip,
    lastEvent: "auth.login",
    meta: {
      ...(payload.meta || {}),
      deviceSessionId: payload.deviceSessionId,
    },
  });
};

const validateSingleSession = async (userId: string, deviceSessionId: string) => {
  const admin = createServiceClient();
  const rpc = await admin.rpc("validate_single_session", {
    p_user_id: userId,
    p_device_session_id: deviceSessionId,
  });
  if (!rpc.error && rpc.data) {
    const result = asObject(rpc.data);
    return {
      valid: result.valid !== false,
      reason: asString(result.reason, 240) || "Session invalidated by a newer login.",
    };
  }

  // Fallback for partial rollout.
  const { data, error } = await admin
    .from("profiles")
    .select("current_device_session_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    return { valid: true, reason: "" };
  }
  const current = asString((data as Record<string, unknown>).current_device_session_id, 80);
  if (!current) return { valid: true, reason: "" };
  return {
    valid: current === deviceSessionId,
    reason: "This account was used on another device. You were signed out on this device.",
  };
};

type SessionClaimState = {
  currentDeviceSessionId: string | null;
  sessionKey: string | null;
  conflict: boolean;
  sameDevice: boolean;
  stale: boolean;
  currentDevice: Record<string, unknown> | null;
};

const getSessionMetaString = (meta: Record<string, unknown>, key: string, maxLen = 80): string | null =>
  asString(meta[key], maxLen);

const buildSafeClaimDevice = (row: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!row) return null;
  const meta = asObject(row.meta);
  return {
    deviceSessionId: asString(row.device_session_id, 80),
    deviceName: asString(row.device_name, 200),
    deviceModel: asString(row.device_model, 200),
    platform: asString(row.platform, 120),
    browser: asString(row.browser, 120),
    os: asString(row.os, 120),
    appVersion: getSessionMetaString(meta, "appVersion", 80),
    runtime: getSessionMetaString(meta, "runtime", 80),
    lastSeenAt: asString(row.last_seen_at, 80),
    lastEvent: asString(row.last_event, 80),
    isOnline: row.is_online === true,
  };
};

const getSessionClaimMessage = (device: Record<string, unknown> | null): string => {
  const name = asString(device?.deviceName, 200) || "another device";
  const platform = asString(device?.platform, 120) || asString(device?.os, 120) || "";
  const label = platform && !name.toLowerCase().includes(platform.toLowerCase()) ? `${name} (${platform})` : name;
  return `This account is already active on ${label}. Log it out first to continue here?`;
};

const buildSafeReplacingDevice = (
  device: DevicePayload,
  meta: Record<string, unknown>,
): Record<string, unknown> => ({
  deviceName: device.name || "another device",
  deviceModel: device.model || null,
  platform: device.platform || null,
  browser: device.browser || null,
  os: device.os || null,
  appVersion: asString(meta.appVersion, 80),
  runtime: asString(meta.runtime, 80),
});

const getReplacementNoticeMessage = (replacement: Record<string, unknown> | null): string => {
  const replacingDevice = asObject(replacement?.replacingDevice);
  const name = asString(replacingDevice.deviceName, 200) || "another device";
  const platform = asString(replacingDevice.platform, 120) || asString(replacingDevice.os, 120) || "";
  const label = platform && !name.toLowerCase().includes(platform.toLowerCase()) ? `${name} (${platform})` : name;
  const replacedAt = asString(replacement?.replacedAt, 80);
  const when = replacedAt ? ` at ${new Date(replacedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` : "";
  return `You were logged out because this account was continued on ${label}${when}.`;
};

const markSessionReplaced = async (payload: {
  sessionKey: string;
  replacingDevice: DevicePayload;
  replacingMeta?: Record<string, unknown> | null;
}) => {
  const admin = createServiceClient();
  const now = new Date().toISOString();
  const existing = await admin
    .from("active_sessions")
    .select("meta")
    .eq("session_key", payload.sessionKey)
    .maybeSingle();
  const existingMeta = asObject((existing.data as Record<string, unknown> | null)?.meta);
  const replacingMeta = asObject(payload.replacingMeta);
  const replacement = {
    reason: "session.replaced",
    replacedAt: now,
    replacingDevice: buildSafeReplacingDevice(payload.replacingDevice, replacingMeta),
  };
  const updatePayload = {
    is_online: false,
    last_seen_at: now,
    last_event: "session.replaced",
    invalidated_at: now,
    invalidated_reason: "session.replaced",
    meta: {
      ...existingMeta,
      sessionReplacement: replacement,
    },
  };
  const updated = await admin
    .from("active_sessions")
    .update(updatePayload)
    .eq("session_key", payload.sessionKey);
  if (!updated.error) return;

  const fallback = await admin
    .from("active_sessions")
    .update({
      is_online: false,
      last_seen_at: now,
      last_event: "session.replaced",
      meta: {
        ...existingMeta,
        sessionReplacement: replacement,
      },
    })
    .eq("session_key", payload.sessionKey);
  if (fallback.error) throw new Error(fallback.error.message || updated.error.message);
};

const resolveSessionConflictNotice = async (payload: {
  userId: string;
  sessionKey?: string | null;
  deviceSessionId?: string | null;
  fallbackReason?: string | null;
}) => {
  const admin = createServiceClient();
  let row: Record<string, unknown> | null = null;
  if (payload.sessionKey) {
    const bySession = await admin
      .from("active_sessions")
      .select("last_event, invalidated_reason, meta")
      .eq("session_key", payload.sessionKey)
      .maybeSingle();
    row = (bySession.data || null) as Record<string, unknown> | null;
  }
  if (!row && payload.deviceSessionId) {
    const byDevice = await admin
      .from("active_sessions")
      .select("last_event, invalidated_reason, meta")
      .eq("user_id", payload.userId)
      .eq("device_session_id", payload.deviceSessionId)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    row = (byDevice.data || null) as Record<string, unknown> | null;
  }

  const meta = asObject(row?.meta);
  const replacement = asObject(meta.sessionReplacement);
  const reason = asString(row?.invalidated_reason, 120) || asString(row?.last_event, 120) || asString(replacement.reason, 120);
  if (reason === "session.replaced" || replacement.reason === "session.replaced") {
    return {
      reason: "session.replaced",
      message: getReplacementNoticeMessage(replacement),
      replacedAt: asString(replacement.replacedAt, 80),
      replacingDevice: asObject(replacement.replacingDevice),
    };
  }
  return {
    reason: "session.conflict",
    message: payload.fallbackReason || "This account was used on another device. You were signed out on this device.",
    replacedAt: null,
    replacingDevice: null,
  };
};

const loadSessionClaimState = async (userId: string, deviceSessionId: string): Promise<SessionClaimState> => {
  const admin = createServiceClient();
  const profile = await admin
    .from("profiles")
    .select("current_device_session_id")
    .eq("id", userId)
    .maybeSingle();
  const currentDeviceSessionId = asString((profile.data as Record<string, unknown> | null)?.current_device_session_id, 80);
  if (profile.error || !currentDeviceSessionId) {
    return {
      currentDeviceSessionId: null,
      sessionKey: null,
      conflict: false,
      sameDevice: false,
      stale: false,
      currentDevice: null,
    };
  }

  const sameDevice = currentDeviceSessionId === deviceSessionId;
  if (sameDevice) {
    return {
      currentDeviceSessionId,
      sessionKey: null,
      conflict: false,
      sameDevice: true,
      stale: false,
      currentDevice: null,
    };
  }

  const active = await admin
    .from("active_sessions")
    .select("session_key, device_session_id, device_name, device_model, platform, browser, os, last_seen_at, is_online, last_event, meta, invalidated_at")
    .eq("user_id", userId)
    .eq("device_session_id", currentDeviceSessionId)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const activeRow = (active.data || null) as Record<string, unknown> | null;
  if (active.error || !activeRow) {
    return {
      currentDeviceSessionId,
      sessionKey: null,
      conflict: false,
      sameDevice: false,
      stale: true,
      currentDevice: null,
    };
  }

  const lastSeenAt = asString(activeRow.last_seen_at, 80);
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : 0;
  const stale = !lastSeenMs || (Date.now() - lastSeenMs > ACTIVITY_SESSION_CLAIM_STALE_MS) || Boolean(activeRow.invalidated_at);
  const currentDevice = buildSafeClaimDevice(activeRow);
  return {
    currentDeviceSessionId,
    sessionKey: asUuid(activeRow.session_key) || asString(activeRow.session_key, 80),
    conflict: !stale,
    sameDevice: false,
    stale,
    currentDevice,
  };
};

const writeLoginClaimActivity = async (payload: {
  requestId: string;
  userId: string;
  sessionKey: string;
  deviceSessionId: string;
  email?: string | null;
  device: DevicePayload;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  const meta = asObject(payload.meta);
  const appVersion = asString(meta.appVersion, 80);
  const runtime = asString(meta.runtime, 80);
  const result = await writeActivityLog({
    requestId: payload.requestId,
    eventType: "auth.login",
    status: "success",
    userId: payload.userId,
    email: payload.email,
    sessionKey: payload.sessionKey,
    device: payload.device,
    meta,
  });
  await claimSingleActiveSession({
    userId: payload.userId,
    sessionKey: payload.sessionKey,
    deviceSessionId: payload.deviceSessionId,
    email: payload.email,
    device: payload.device,
    ip: payload.ip,
    meta,
  });
  if (!result.deduped) {
    await sendDiscordAuthEvent({
      webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
      eventType: "auth.login",
      email: payload.email || "unknown",
      device: payload.device,
      status: "success",
      errorMessage: null,
      clientIp: payload.ip || null,
      userId: payload.userId,
      sessionKey: payload.sessionKey,
      deviceSessionId: payload.deviceSessionId,
      appVersion,
      runtime,
    });
  }
  return result;
};

const recordDailyAttendance = async (payload: {
  userId: string;
  sessionKey?: string | null;
  email?: string | null;
  device: DevicePayload;
  lastEvent?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  try {
    const admin = createServiceClient();
    const meta = asObject(payload.meta);
    const { error } = await admin.rpc("record_user_daily_attendance", {
      p_user_id: payload.userId,
      p_email: payload.email || null,
      p_session_key: payload.sessionKey || null,
      p_device_fingerprint: payload.device.fingerprint || "unknown",
      p_device_name: payload.device.name || null,
      p_platform: payload.device.platform || null,
      p_browser: payload.device.browser || null,
      p_os: payload.device.os || null,
      p_app_version: asString(meta.appVersion, 80),
      p_runtime: asString(meta.runtime, 80),
      p_seen_at: new Date().toISOString(),
      p_increment_heartbeat: payload.lastEvent === "heartbeat",
    });
    if (error) console.warn("record_user_daily_attendance failed", error.message);
  } catch (err) {
    console.warn("record_user_daily_attendance unavailable", err instanceof Error ? err.message : String(err));
  }
};

const upsertActiveSession = async (payload: {
  sessionKey: string;
  userId: string;
  email?: string | null;
  device: DevicePayload;
  ip?: string | null;
  lastEvent?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  const admin = createServiceClient();

  const rpc = await admin.rpc("upsert_active_session", {
    p_session_key: payload.sessionKey,
    p_user_id: payload.userId,
    p_email: payload.email || null,
    p_device_fingerprint: payload.device.fingerprint || "unknown",
    p_device_name: payload.device.name || null,
    p_device_model: payload.device.model || null,
    p_platform: payload.device.platform || null,
    p_browser: payload.device.browser || null,
    p_os: payload.device.os || null,
    p_ip: payload.ip || null,
    p_last_event: payload.lastEvent || null,
    p_meta: asObject(payload.meta),
  });

  if (!rpc.error) {
    await recordDailyAttendance(payload);
    return;
  }

  const fallback = await admin
    .from("active_sessions")
    .upsert(
      {
        session_key: payload.sessionKey,
        user_id: payload.userId,
        email: payload.email || null,
        device_fingerprint: payload.device.fingerprint || "unknown",
        device_name: payload.device.name || null,
        device_model: payload.device.model || null,
        platform: payload.device.platform || null,
        browser: payload.device.browser || null,
        os: payload.device.os || null,
        ip: payload.ip || null,
        last_seen_at: new Date().toISOString(),
        is_online: true,
        last_event: payload.lastEvent || null,
        meta: asObject(payload.meta),
      },
      { onConflict: "session_key" },
    );

  if (fallback.error) {
    if (fallback.error.code === "23503" || /active_sessions_user_id_fkey/i.test(fallback.error.message || "")) {
      return;
    }
    throw new Error(fallback.error.message || rpc.error.message);
  }

  await recordDailyAttendance(payload);
};

const markSessionOffline = async (sessionKey: string, lastEvent = "auth.signout") => {
  const admin = createServiceClient();
  const rpc = await admin.rpc("mark_session_offline", {
    p_session_key: sessionKey,
    p_last_event: lastEvent,
  });
  if (!rpc.error) return;

  const fallback = await admin
    .from("active_sessions")
    .update({ is_online: false, last_seen_at: new Date().toISOString(), last_event: lastEvent })
    .eq("session_key", sessionKey);
  if (fallback.error) throw new Error(fallback.error.message || rpc.error.message);
};

const finalizeSignoutSession = async (payload: {
  userId: string;
  deviceSessionId: string;
  sessionKey: string;
}) => {
  const admin = createServiceClient();
  const rpc = await admin.rpc("finalize_signout_session", {
    p_user_id: payload.userId,
    p_device_session_id: payload.deviceSessionId,
    p_session_key: payload.sessionKey,
  });
  if (!rpc.error) return;
  await markSessionOffline(payload.sessionKey, "auth.signout");
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" }, req);

    const url = new URL(req.url);
    const route = url.pathname.split("/").pop() || "";
    const body = await req.json().catch(() => ({}));

    if (route === "event") {
      const requestId = asUuid(body.requestId);
      const eventType = body.eventType;
      const status = body.status;
      if (!requestId) return badRequest("Missing or invalid requestId", req);
      if (!isEventType(eventType)) return badRequest("Invalid eventType", req);
      if (!isStatus(status)) return badRequest("Invalid status", req);

      const bodyUserId = asUuid(body.userId);
      const actor = await requireAuthenticatedActor(req, bodyUserId);
      if (!actor.ok) return actor.response;
      const userId = bodyUserId || actor.userId;
      const sessionKey = asUuid(body.sessionKey);
      const deviceSessionId = asUuid(body.deviceSessionId);
      const email = asString(body.email, 320);
      const device = normalizeDevice(body.device);
      const bankName = asString(body.bankName, 200);
      const bankId = asString(body.bankId, 200);
      const errorMessage = asString(body.errorMessage, 2000);
      const meta = asObject(body.meta);
      const appVersion = asString(meta.appVersion, 80);
      const runtime = asString(meta.runtime, 80);
      const exportPhase = normalizeExportPhase(meta.phase);
      const padNames = extractPadNames(body.padNames);
      const trimmedPadNames = padNames.slice(0, MAX_META_PAD_NAMES);
      const explicitPadCount = asNumber(body.padCount);
      const padCount = explicitPadCount ?? (padNames.length ? padNames.length : null);
      const actorIsAdmin = userId ? await isAdminUser(userId) : false;
      if (actorIsAdmin) {
        if (eventType === "auth.login" && status === "success") {
          const adminUser = userId ? await createServiceClient().auth.admin.getUserById(userId) : null;
          await sendDiscordAuthEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
            eventType,
            email: adminUser?.data?.user?.email || email || "unknown",
            device,
            status,
            errorMessage,
            clientIp: parseClientIp(req),
            userId,
            sessionKey,
            deviceSessionId,
            isAdminLogin: true,
            appVersion,
            runtime,
          });
        }
        return json(200, { ok: true, skippedAdmin: true }, req);
      }

      const eventLimit = await consumeRateLimit({
        scope: "activity.event",
        subject: actor.userId,
        maxHits: ACTIVITY_EVENT_RATE_LIMIT,
        windowSeconds: ACTIVITY_EVENT_RATE_WINDOW_SECONDS,
      });
      if (!eventLimit.allowed) {
        return json(
          429,
          {
            ok: false,
            error: "RATE_LIMITED",
            scope: "activity.event",
            retry_after_seconds: eventLimit.retryAfterSeconds,
          },
          req,
        );
      }

      const result = await writeActivityLog({
        requestId,
        eventType,
        status,
        userId,
        email,
        sessionKey,
        device,
        bankId,
        bankName,
        padCount,
        errorMessage,
        meta: {
          ...meta,
          ...(exportPhase ? { phase: exportPhase } : {}),
          padNamesCount: padNames.length,
          includePadList: Boolean(meta.includePadList),
          padNames: Boolean(meta.includePadList) ? trimmedPadNames : [],
          padNamesTruncated: padNames.length > trimmedPadNames.length,
        },
      });
      if (result.deduped) return json(200, { ok: true, deduped: true }, req);

      if (status === "success") {
        if (eventType === "auth.signout") {
          if (sessionKey) await markSessionOffline(sessionKey, "auth.signout");
        } else if (eventType === "auth.login" && userId && sessionKey && deviceSessionId) {
          await claimSingleActiveSession({
            userId,
            sessionKey,
            deviceSessionId,
            email,
            device,
            ip: parseClientIp(req),
            meta,
          });
        } else if (sessionKey && userId) {
          await upsertActiveSession({
            sessionKey,
            userId,
            email,
            device,
            ip: parseClientIp(req),
            lastEvent: eventType,
            meta,
          });
        }
      }
      let discordError: string | null = null;
      try {
        if (eventType.startsWith("auth.")) {
          await sendDiscordAuthEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
            eventType,
            email: email || "unknown",
            device,
            status,
            errorMessage,
            clientIp: parseClientIp(req),
            userId,
            sessionKey,
            deviceSessionId,
            appVersion,
            runtime,
          });
        } else if (eventType === "bank.export" && (!exportPhase || exportPhase === "local_export")) {
          await sendDiscordExportEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_EXPORT") || null,
            status,
            email: email || "unknown",
            bankName: bankName || "unknown",
            padNames,
            errorMessage,
            userId,
            bankId,
            requestId,
            appVersion,
            runtime,
          });
        } else if (eventType === "bank.import") {
          await sendDiscordImportEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_IMPORT") || null,
            status,
            email: email || "unknown",
            bankName: bankName || "unknown",
            padNames,
            includePadList: Boolean(meta.includePadList),
            errorMessage,
            userId,
            bankId,
            requestId,
            appVersion,
            runtime,
          });
        }
      } catch (err) {
        discordError = err instanceof Error ? err.message : "Discord fanout failed";
      }
      return json(200, { ok: true, discordError }, req);
    }

    if (route === "session-claim-preview" || route === "session-claim") {
      const requestId = asUuid(body.requestId) || crypto.randomUUID();
      const sessionKey = asUuid(body.sessionKey);
      const deviceSessionId = asUuid(body.deviceSessionId);
      const bodyUserId = asUuid(body.userId);
      if (!sessionKey) return badRequest("Missing or invalid sessionKey", req);
      if (!deviceSessionId) return badRequest("Missing or invalid deviceSessionId", req);
      if (!bodyUserId) return badRequest("Missing or invalid userId", req);
      const actor = await requireAuthenticatedActor(req, bodyUserId);
      if (!actor.ok) return actor.response;
      const userId = bodyUserId;
      if (await isAdminUser(userId)) {
        if (route === "session-claim") {
          const claimMeta = asObject(body.meta);
          const adminUser = await createServiceClient().auth.admin.getUserById(userId);
          await sendDiscordAuthEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
            eventType: "auth.login",
            email: adminUser?.data?.user?.email || asString(body.email, 320) || "unknown",
            device: normalizeDevice(body.device),
            status: "success",
            errorMessage: null,
            clientIp: parseClientIp(req),
            userId,
            sessionKey,
            deviceSessionId,
            isAdminLogin: true,
            appVersion: asString(claimMeta.appVersion, 80),
            runtime: asString(claimMeta.runtime, 80),
          });
        }
        return json(200, {
          ok: true,
          conflict: false,
          requiresConfirmation: false,
          skippedAdmin: true,
        }, req);
      }

      const claimLimit = await consumeRateLimit({
        scope: "activity.session_claim",
        subject: actor.userId,
        maxHits: ACTIVITY_SESSION_CLAIM_RATE_LIMIT,
        windowSeconds: ACTIVITY_SESSION_CLAIM_RATE_WINDOW_SECONDS,
      });
      if (!claimLimit.allowed) {
        return json(
          429,
          {
            ok: false,
            error: "RATE_LIMITED",
            scope: "activity.session_claim",
            retry_after_seconds: claimLimit.retryAfterSeconds,
          },
          req,
        );
      }

      const claimState = await loadSessionClaimState(userId, deviceSessionId);
      const conflictPayload = {
        ok: false,
        code: "SESSION_CLAIM_CONFLICT",
        conflict: true,
        requiresConfirmation: true,
        currentDevice: claimState.currentDevice,
        message: getSessionClaimMessage(claimState.currentDevice),
      };

      if (route === "session-claim-preview") {
        return json(200, {
          ok: true,
          conflict: claimState.conflict,
          requiresConfirmation: claimState.conflict,
          sameDevice: claimState.sameDevice,
          stale: claimState.stale,
          currentDevice: claimState.currentDevice,
          message: claimState.conflict ? getSessionClaimMessage(claimState.currentDevice) : null,
        }, req);
      }

      if (claimState.conflict && body.force !== true) {
        return json(409, conflictPayload, req);
      }

      const expectedCurrentDeviceSessionId = asString(body.expectedCurrentDeviceSessionId, 80);
      if (
        claimState.conflict &&
        expectedCurrentDeviceSessionId &&
        claimState.currentDeviceSessionId &&
        expectedCurrentDeviceSessionId !== claimState.currentDeviceSessionId
      ) {
        return json(409, {
          ...conflictPayload,
          message: "The active device changed while you were confirming. Review the device and try again.",
        }, req);
      }

      const email = asString(body.email, 320);
      const device = normalizeDevice(body.device);
      const meta = {
        ...asObject(body.meta),
        forcedSessionReplacement: body.force === true,
        replacedDeviceSessionId: claimState.currentDeviceSessionId || null,
      };

      if (body.force === true && claimState.sessionKey) {
        await markSessionReplaced({
          sessionKey: claimState.sessionKey,
          replacingDevice: device,
          replacingMeta: body.meta,
        });
        const claimMeta = asObject(body.meta);
        await sendDiscordSessionConflictEvent({
          userId,
          email,
          sessionKey: claimState.sessionKey,
          deviceSessionId: claimState.currentDeviceSessionId || "",
          clientIp: parseClientIp(req),
          lastEvent: "session.replaced",
          appVersion: asString(claimMeta.appVersion, 80),
          runtime: asString(claimMeta.runtime, 80),
        });
      }

      const result = await writeLoginClaimActivity({
        requestId,
        userId,
        sessionKey,
        deviceSessionId,
        email,
        device,
        ip: parseClientIp(req),
        meta,
      });
      return json(200, {
        ok: true,
        conflict: false,
        requiresConfirmation: false,
        claimed: true,
        deduped: result.deduped,
      }, req);
    }

    if (route === "heartbeat") {
      const sessionKey = asUuid(body.sessionKey);
      const deviceSessionId = asUuid(body.deviceSessionId);
      const bodyUserId = asUuid(body.userId);
      if (!sessionKey) return badRequest("Missing or invalid sessionKey", req);
      if (!deviceSessionId) return badRequest("Missing or invalid deviceSessionId", req);
      if (!bodyUserId) return badRequest("Missing or invalid userId", req);
      const actor = await requireAuthenticatedActor(req, bodyUserId);
      if (!actor.ok) return actor.response;
      const userId = bodyUserId;
      if (await isAdminUser(userId)) return json(200, { ok: true, skippedAdmin: true }, req);

      const heartbeatLimit = await consumeRateLimit({
        scope: "activity.heartbeat",
        subject: actor.userId,
        maxHits: ACTIVITY_HEARTBEAT_RATE_LIMIT,
        windowSeconds: ACTIVITY_HEARTBEAT_RATE_WINDOW_SECONDS,
      });
      if (!heartbeatLimit.allowed) {
        return json(
          429,
          {
            ok: false,
            error: "RATE_LIMITED",
            scope: "activity.heartbeat",
            retry_after_seconds: heartbeatLimit.retryAfterSeconds,
          },
          req,
        );
      }

      const validation = await validateSingleSession(userId, deviceSessionId);
      const heartbeatMeta = asObject(body.meta);
      const heartbeatAppVersion = asString(heartbeatMeta.appVersion, 80);
      const heartbeatRuntime = asString(heartbeatMeta.runtime, 80);
      if (!validation.valid) {
        const conflictNotice = await resolveSessionConflictNotice({
          userId,
          sessionKey,
          deviceSessionId,
          fallbackReason: validation.reason,
        });
        if (conflictNotice.reason !== "session.replaced") {
          await markSessionOffline(sessionKey, "session.conflict");
        }
        await sendDiscordSessionConflictEvent({
          userId,
          email: asString(body.email, 320),
          sessionKey,
          deviceSessionId,
          clientIp: parseClientIp(req),
          lastEvent: asString(body.lastEvent, 60) || "heartbeat",
          appVersion: heartbeatAppVersion,
          runtime: heartbeatRuntime,
        });
        return json(
          409,
          {
            ok: false,
            code: "SESSION_CONFLICT",
            invalidate: true,
            message: conflictNotice.message || validation.reason || "Session invalidated by a newer login.",
            reason: conflictNotice.reason,
            conflict: conflictNotice,
          },
          req,
        );
      }

      await upsertActiveSession({
        sessionKey,
        userId,
        email: asString(body.email, 320),
        device: normalizeDevice(body.device),
        ip: parseClientIp(req),
        lastEvent: asString(body.lastEvent, 60) || "heartbeat",
        meta: asObject(body.meta),
      });
      const admin = createServiceClient();
      await admin
        .from("active_sessions")
        .update({ device_session_id: deviceSessionId, invalidated_at: null, invalidated_reason: null })
        .eq("session_key", sessionKey);
      return json(200, { ok: true }, req);
    }

    if (route === "session-check") {
      const sessionKey = asUuid(body.sessionKey);
      const deviceSessionId = asUuid(body.deviceSessionId);
      const bodyUserId = asUuid(body.userId);
      if (!sessionKey) return badRequest("Missing or invalid sessionKey", req);
      if (!deviceSessionId) return badRequest("Missing or invalid deviceSessionId", req);
      if (!bodyUserId) return badRequest("Missing or invalid userId", req);
      const actor = await requireAuthenticatedActor(req, bodyUserId);
      if (!actor.ok) return actor.response;
      const userId = bodyUserId;
      if (await isAdminUser(userId)) return json(200, { ok: true, valid: true, skippedAdmin: true }, req);

      const checkLimit = await consumeRateLimit({
        scope: "activity.session_check",
        subject: actor.userId,
        maxHits: ACTIVITY_SESSION_CHECK_RATE_LIMIT,
        windowSeconds: ACTIVITY_SESSION_CHECK_RATE_WINDOW_SECONDS,
      });
      if (!checkLimit.allowed) {
        return json(
          429,
          {
            ok: false,
            error: "RATE_LIMITED",
            scope: "activity.session_check",
            retry_after_seconds: checkLimit.retryAfterSeconds,
          },
          req,
        );
      }

      const validation = await validateSingleSession(userId, deviceSessionId);
      const sessionCheckMeta = asObject(body.meta);
      const sessionCheckAppVersion = asString(sessionCheckMeta.appVersion, 80);
      const sessionCheckRuntime = asString(sessionCheckMeta.runtime, 80);
      if (!validation.valid) {
        const conflictNotice = await resolveSessionConflictNotice({
          userId,
          sessionKey,
          deviceSessionId,
          fallbackReason: validation.reason,
        });
        if (conflictNotice.reason !== "session.replaced") {
          await markSessionOffline(sessionKey, "session.conflict");
        }
        await sendDiscordSessionConflictEvent({
          userId,
          email: asString(body.email, 320),
          sessionKey,
          deviceSessionId,
          clientIp: parseClientIp(req),
          lastEvent: asString(body.lastEvent, 60) || "session-check",
          appVersion: sessionCheckAppVersion,
          runtime: sessionCheckRuntime,
        });
        return json(
          409,
          {
            ok: false,
            code: "SESSION_CONFLICT",
            invalidate: true,
            message: conflictNotice.message || validation.reason || "Session invalidated by a newer login.",
            reason: conflictNotice.reason,
            conflict: conflictNotice,
          },
          req,
        );
      }
      return json(200, { ok: true, valid: true }, req);
    }

    if (route === "signout") {
      const requestId = asUuid(body.requestId);
      const sessionKey = asUuid(body.sessionKey);
      const deviceSessionId = asUuid(body.deviceSessionId);
      const bodyUserId = asUuid(body.userId);
      const status = isStatus(body.status) ? body.status : "success";
      if (!requestId) return badRequest("Missing or invalid requestId", req);
      if (!sessionKey) return badRequest("Missing or invalid sessionKey", req);
      const actor = await requireAuthenticatedActor(req, bodyUserId);
      if (!actor.ok) return actor.response;
      const userId = bodyUserId || actor.userId;
      if (userId && (await isAdminUser(userId))) return json(200, { ok: true, skippedAdmin: true }, req);

      const signoutLimit = await consumeRateLimit({
        scope: "activity.signout",
        subject: actor.userId,
        maxHits: ACTIVITY_SIGNOUT_RATE_LIMIT,
        windowSeconds: ACTIVITY_SIGNOUT_RATE_WINDOW_SECONDS,
      });
      if (!signoutLimit.allowed) {
        return json(
          429,
          {
            ok: false,
            error: "RATE_LIMITED",
            scope: "activity.signout",
            retry_after_seconds: signoutLimit.retryAfterSeconds,
          },
          req,
        );
      }

      const result = await writeActivityLog({
        requestId,
        eventType: "auth.signout",
        status,
        userId,
        email: asString(body.email, 320),
        sessionKey,
        device: normalizeDevice(body.device),
        errorMessage: asString(body.errorMessage, 2000),
        meta: asObject(body.meta),
      });
      const signoutMeta = asObject(body.meta);
      const signoutAppVersion = asString(signoutMeta.appVersion, 80);
      const signoutRuntime = asString(signoutMeta.runtime, 80);

      if (!result.deduped && status === "success") {
        if (userId && deviceSessionId) {
          await finalizeSignoutSession({
            userId,
            deviceSessionId,
            sessionKey,
          });
        } else {
          await markSessionOffline(sessionKey, "auth.signout");
        }
      }
      let discordError: string | null = null;
      try {
        if (!result.deduped) {
          await sendDiscordAuthEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
            eventType: "auth.signout",
            email: asString(body.email, 320) || "unknown",
            device: normalizeDevice(body.device),
            status,
            errorMessage: asString(body.errorMessage, 2000),
            clientIp: parseClientIp(req),
            appVersion: signoutAppVersion,
            runtime: signoutRuntime,
          });
        }
      } catch (err) {
        discordError = err instanceof Error ? err.message : "Discord fanout failed";
      }
      return json(200, { ok: true, deduped: result.deduped, discordError }, req);
    }

    return json(404, { error: "Unknown activity route" }, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: message }, req);
  }
});
