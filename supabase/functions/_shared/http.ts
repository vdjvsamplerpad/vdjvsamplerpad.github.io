const DEFAULT_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const ALLOW_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const ORIGIN_ENV_KEYS = ["APP_ALLOWED_ORIGINS", "ALLOWED_ORIGINS"] as const;

const parseAllowedOrigins = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const configuredAllowedOrigins = (() => {
  for (const key of ORIGIN_ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value && value.trim()) return parseAllowedOrigins(value);
  }
  return [] as string[];
})();

const normalizeOrigin = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.host) return "";
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
};

const matchesOriginRule = (origin: string, ruleRaw: string): boolean => {
  const rule = ruleRaw.trim().toLowerCase();
  if (!rule) return false;
  if (rule === "*") return true;
  if (rule.startsWith("*.")) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      const suffix = rule.slice(1); // ".example.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    } catch {
      return false;
    }
  }
  const normalizedRule = normalizeOrigin(rule) || rule;
  return origin === normalizedRule;
};

const isOriginAllowed = (origin: string): boolean => {
  if (!origin) return false;
  if (configuredAllowedOrigins.length === 0) return true;
  return configuredAllowedOrigins.some((rule) => matchesOriginRule(origin, rule));
};

const resolveCorsOrigin = (req?: Request): string | null => {
  const rawOrigin = req?.headers.get("origin")?.trim() || "";
  const origin = normalizeOrigin(rawOrigin);
  if (!origin) {
    return "*";
  }
  return isOriginAllowed(origin) ? origin : null;
};

export const buildCorsHeaders = (req?: Request): Record<string, string> => {
  const origin = resolveCorsOrigin(req);
  const requestHeaders = req?.headers.get("access-control-request-headers")?.trim();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Headers": requestHeaders || DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
  };
  if (origin && origin !== "*") {
    headers["Vary"] = "Origin";
  }
  return headers;
};

export const corsHeaders: Record<string, string> = buildCorsHeaders();

export const handleCorsPreflight = (req: Request): Response | null => {
  if (req.method !== "OPTIONS") return null;
  if (!resolveCorsOrigin(req)) {
    return new Response("forbidden", { status: 403, headers: buildCorsHeaders(req) });
  }
  return new Response("ok", { headers: buildCorsHeaders(req) });
};

export const json = (status: number, payload: unknown, req?: Request): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export const badRequest = (message: string, req?: Request): Response => json(400, { error: message }, req);

export const getEnvOrThrow = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
};
