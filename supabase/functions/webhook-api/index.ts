import "@supabase/functions-js/edge-runtime.d.ts";
import { handleCorsPreflight, json } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  parseDiscordWebhookPayload,
  sendDiscordAuthEvent,
  sendDiscordExportEvent,
  sendDiscordImportEvent,
} from "../_shared/discord.ts";
import { asObject, asString, extractPadNames } from "../_shared/validate.ts";
import { consumeRateLimit } from "../_shared/rate-limit.ts";

const normalizeDevicePayload = (value: unknown) => {
  const raw = asObject(value);
  return {
    fingerprint: asString(raw.fingerprint, 256),
    name: asString(raw.name || raw.device || raw.platform || raw.ua, 200),
    model: asString(raw.model, 200),
    platform: asString(raw.platform, 120),
    browser: asString(raw.browser, 120),
    os: asString(raw.os, 120),
    raw: asObject(raw.raw || raw),
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

const WEBHOOK_SIGNING_SECRET = asString(Deno.env.get("WEBHOOK_SIGNING_SECRET"), 5000);
const WEBHOOK_MAX_SKEW_SECONDS = readPositiveInt(Deno.env.get("WEBHOOK_MAX_SKEW_SECONDS"), 300);
const WEBHOOK_RATE_LIMIT = readPositiveInt(Deno.env.get("WEBHOOK_RATE_LIMIT"), 120);
const WEBHOOK_RATE_WINDOW_SECONDS = readPositiveInt(Deno.env.get("WEBHOOK_RATE_WINDOW_SECONDS"), 3600);
const WEBHOOK_REPLAY_TTL_SECONDS = Math.max(
  600,
  readPositiveInt(Deno.env.get("WEBHOOK_REPLAY_TTL_SECONDS"), WEBHOOK_MAX_SKEW_SECONDS * 2),
);

const normalizeSignature = (value: string | null): string | null => {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith("sha256=")) return raw.slice(7).trim().toLowerCase();
  return raw.toLowerCase();
};

const toHex = (bytes: Uint8Array): string => {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
};

const verifyWebhookSignature = async (
  req: Request,
  rawBody: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
  if (!WEBHOOK_SIGNING_SECRET) return { ok: false, status: 503, error: "WEBHOOK_DISABLED" };
  const timestampHeader = asString(req.headers.get("x-webhook-timestamp"), 40);
  const signatureHeader = normalizeSignature(asString(req.headers.get("x-webhook-signature"), 500));
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, status: 401, error: "INVALID_WEBHOOK_SIGNATURE" };
  }

  const parsedTimestamp = Number(timestampHeader);
  if (!Number.isFinite(parsedTimestamp)) {
    return { ok: false, status: 401, error: "INVALID_WEBHOOK_SIGNATURE" };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.abs(nowSeconds - Math.floor(parsedTimestamp));
  if (ageSeconds > WEBHOOK_MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: "WEBHOOK_SIGNATURE_EXPIRED" };
  }

  const payloadToSign = `${Math.floor(parsedTimestamp)}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadToSign));
  const expectedHex = toHex(new Uint8Array(signed));
  if (!timingSafeEqualHex(expectedHex, signatureHeader)) {
    return { ok: false, status: 401, error: "INVALID_WEBHOOK_SIGNATURE" };
  }

  return { ok: true };
};

const claimWebhookReplayKey = async (
  replayKey: string,
  route: string,
  requester: string,
): Promise<boolean> => {
  const admin = createServiceClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (WEBHOOK_REPLAY_TTL_SECONDS * 1000)).toISOString();
  await admin
    .from("webhook_replay_cache")
    .delete()
    .lt("expires_at", now.toISOString());
  const { error } = await admin
    .from("webhook_replay_cache")
    .insert({
      replay_key: replayKey,
      route,
      requester_ip: requester,
      expires_at: expiresAt,
    });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505" || /duplicate key/i.test(error.message || "")) {
    return false;
  }
  throw new Error(error.message);
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, req);

  try {
    const rawBody = await req.text();
    const signatureCheck = await verifyWebhookSignature(req, rawBody);
    if ("error" in signatureCheck) return json(signatureCheck.status, { error: signatureCheck.error }, req);

    const body = rawBody ? asObject(JSON.parse(rawBody)) : {};
    const path = new URL(req.url).pathname;
    const requester = parseClientIp(req) || "unknown";
    const requestId = asString(body.requestId, 120) || asString(body.request_id, 120) || null;
    const replayKey = requestId || `sig:${normalizeSignature(asString(req.headers.get("x-webhook-signature"), 500)) || "missing"}`;
    const claimed = await claimWebhookReplayKey(replayKey, path, requester);
    if (!claimed) return json(409, { error: "REPLAYED_WEBHOOK" }, req);

    if (path.endsWith("/auth-event")) {
      const rate = await consumeRateLimit({
        scope: "webhook.auth_event",
        subject: requester,
        maxHits: WEBHOOK_RATE_LIMIT,
        windowSeconds: WEBHOOK_RATE_WINDOW_SECONDS,
      });
      if (!rate.allowed) {
        return json(429, { error: "RATE_LIMITED", retry_after_seconds: rate.retryAfterSeconds }, req);
      }
      const event = asString(body.event, 40);
      const email = asString(body.email, 320);
      if (!event || !email) return json(400, { error: "Missing event or email" }, req);

      const mapped =
        event.toLowerCase() === "signup"
          ? "auth.signup"
          : event.toLowerCase() === "signout"
            ? "auth.signout"
            : "auth.login";

      await sendDiscordAuthEvent({
        webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
        eventType: mapped,
        email,
        device: normalizeDevicePayload(body.device),
        status: String(body.status || "").toLowerCase() === "failed" ? "failed" : "success",
        errorMessage: asString(body.errorMessage, 2000),
        clientIp: requester,
        userId: asString(body.userId, 120),
        sessionKey: asString(body.sessionKey, 120),
        deviceSessionId: asString(body.deviceSessionId, 120),
      });
      return json(200, { ok: true }, req);
    }

    if (path.endsWith("/export-bank")) {
      const rate = await consumeRateLimit({
        scope: "webhook.export_bank",
        subject: requester,
        maxHits: WEBHOOK_RATE_LIMIT,
        windowSeconds: WEBHOOK_RATE_WINDOW_SECONDS,
      });
      if (!rate.allowed) {
        return json(429, { error: "RATE_LIMITED", retry_after_seconds: rate.retryAfterSeconds }, req);
      }
      const parsed = parseDiscordWebhookPayload(body);
      if (!parsed.email || !parsed.bankName) {
        return json(400, { error: "Missing email or bankName" }, req);
      }
      const padNames = parsed.padNames.length ? parsed.padNames : extractPadNames(body.padNames);
      await sendDiscordExportEvent({
        webhook: Deno.env.get("DISCORD_WEBHOOK_EXPORT") || null,
        status: parsed.status,
        email: parsed.email,
        bankName: parsed.bankName,
        padNames,
        errorMessage: parsed.errorMessage,
      });
      return json(200, { ok: true }, req);
    }

    if (path.endsWith("/import-bank")) {
      const rate = await consumeRateLimit({
        scope: "webhook.import_bank",
        subject: requester,
        maxHits: WEBHOOK_RATE_LIMIT,
        windowSeconds: WEBHOOK_RATE_WINDOW_SECONDS,
      });
      if (!rate.allowed) {
        return json(429, { error: "RATE_LIMITED", retry_after_seconds: rate.retryAfterSeconds }, req);
      }
      const parsed = parseDiscordWebhookPayload(body);
      if (!parsed.email || !parsed.bankName) {
        return json(400, { error: "Missing email or bankName" }, req);
      }
      await sendDiscordImportEvent({
        webhook: Deno.env.get("DISCORD_WEBHOOK_IMPORT") || null,
        status: parsed.status,
        email: parsed.email,
        bankName: parsed.bankName,
        padNames: parsed.padNames,
        includePadList: parsed.includePadList,
        errorMessage: parsed.errorMessage,
      });
      return json(200, { ok: true }, req);
    }

    return json(404, { error: "Unknown webhook route" }, req);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return json(400, { error: "Invalid JSON body" }, req);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: message }, req);
  }
});
