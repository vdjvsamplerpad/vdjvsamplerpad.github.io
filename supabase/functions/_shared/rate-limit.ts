import { createServiceClient } from "./supabase.ts";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  source: "db" | "memory";
};

type BucketState = {
  hits: number;
  windowStartedAtMs: number;
};

const fallbackBuckets = new Map<string, BucketState>();
const FALLBACK_BUCKET_MAX_KEYS = Math.max(100, Number(Deno.env.get("RATE_LIMIT_FALLBACK_MAX_KEYS") || 5000));
const FAIL_CLOSED_SCOPES = new Set(
  String(
    Deno.env.get("RATE_LIMIT_FAIL_CLOSED_SCOPES")
      || "webhook.auth_event,webhook.export_bank,webhook.import_bank,store.purchase_request,store.download,admin.store.publish,account_registration.submit,account_registration.proof_upload,account_registration.login_hint,receipt_ocr",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const shouldFailClosed = (scope: string): boolean => FAIL_CLOSED_SCOPES.has(scope);

const denyWhenLimiterUnavailable = (windowSeconds: number): RateLimitResult => ({
  allowed: false,
  remaining: 0,
  retryAfterSeconds: Math.max(1, windowSeconds),
  source: "memory",
});

const consumeInMemory = (
  scope: string,
  subject: string,
  maxHits: number,
  windowSeconds: number,
): RateLimitResult => {
  const now = Date.now();
  const key = `${scope}:${subject}`;
  const windowMs = Math.max(1, windowSeconds) * 1000;
  const allowedHits = Math.max(1, maxHits);

  let bucket = fallbackBuckets.get(key);
  if (!bucket || now - bucket.windowStartedAtMs >= windowMs) {
    bucket = { hits: 0, windowStartedAtMs: now };
  }
  bucket.hits += 1;
  fallbackBuckets.set(key, bucket);
  if (fallbackBuckets.size > FALLBACK_BUCKET_MAX_KEYS) {
    for (const [bucketKey, state] of fallbackBuckets.entries()) {
      if (now - state.windowStartedAtMs >= windowMs) fallbackBuckets.delete(bucketKey);
      if (fallbackBuckets.size <= FALLBACK_BUCKET_MAX_KEYS) break;
    }
    while (fallbackBuckets.size > FALLBACK_BUCKET_MAX_KEYS) {
      const oldestKey = fallbackBuckets.keys().next().value;
      if (!oldestKey) break;
      fallbackBuckets.delete(oldestKey);
    }
  }

  if (Math.random() < 0.05) {
    for (const [bucketKey, state] of fallbackBuckets.entries()) {
      if (now - state.windowStartedAtMs >= windowMs * 2) fallbackBuckets.delete(bucketKey);
    }
  }

  if (bucket.hits > allowedHits) {
    const elapsedSec = Math.floor((now - bucket.windowStartedAtMs) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, windowSeconds - elapsedSec),
      source: "memory",
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, allowedHits - bucket.hits),
    retryAfterSeconds: 0,
    source: "memory",
  };
};

export const consumeRateLimit = async (input: {
  scope: string;
  subject: string;
  maxHits: number;
  windowSeconds: number;
}): Promise<RateLimitResult> => {
  const scope = String(input.scope || "").trim();
  const subject = String(input.subject || "").trim();
  const maxHits = Math.max(1, Number(input.maxHits || 1));
  const windowSeconds = Math.max(1, Number(input.windowSeconds || 1));
  if (!scope || !subject) {
    return {
      allowed: true,
      remaining: maxHits,
      retryAfterSeconds: 0,
      source: "memory",
    };
  }

  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("consume_api_rate_limit", {
      p_scope: scope,
      p_subject: subject,
      p_limit: maxHits,
      p_window_seconds: windowSeconds,
    });

    if (!error && Array.isArray(data) && data[0]) {
      const row = data[0] as Record<string, unknown>;
      return {
        allowed: Boolean(row.allowed),
        remaining: Math.max(0, Number(row.remaining || 0)),
        retryAfterSeconds: Math.max(0, Number(row.retry_after_seconds || 0)),
        source: "db",
      };
    }

    if (shouldFailClosed(scope)) {
      return denyWhenLimiterUnavailable(windowSeconds);
    }
    return consumeInMemory(scope, subject, maxHits, windowSeconds);
  } catch (err) {
    if (shouldFailClosed(scope)) {
      return denyWhenLimiterUnavailable(windowSeconds);
    }
    return consumeInMemory(scope, subject, maxHits, windowSeconds);
  }
};
