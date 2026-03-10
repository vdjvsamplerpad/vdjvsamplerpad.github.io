import { asString, asNumber } from "./validate.ts";

const ADMIN_EXPORT_TOKEN_PRIVATE_KEY_PEM = asString(
  Deno.env.get("ADMIN_EXPORT_TOKEN_PRIVATE_KEY_PEM"),
  65535,
);
const ADMIN_EXPORT_TOKEN_KEY_ID =
  asString(Deno.env.get("ADMIN_EXPORT_TOKEN_KEY_ID"), 120) || "admin-export-v1";

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed || NaN)) return fallback;
  const normalized = Math.floor(Number(parsed));
  if (!Number.isFinite(normalized)) return fallback;
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
};

const ADMIN_EXPORT_TOKEN_TTL_SECONDS = clampInt(
  Deno.env.get("ADMIN_EXPORT_TOKEN_TTL_SECONDS"),
  5 * 365 * 24 * 60 * 60,
  0,
  20 * 365 * 24 * 60 * 60,
);

const TOKEN_ISSUER = "vdjv.admin-export";
const TOKEN_VERSION = 1;

export type SignedAdminExportTokenPayload = {
  v: number;
  iss: string;
  sub: string;
  iat: number;
  exp?: number;
  kid: string;
  bank_json_sha256: string;
  bank_name: string;
  pad_count: number;
  allow_export: boolean;
};

const textEncoder = new TextEncoder();
let cachedPrivateKeyPromise: Promise<CryptoKey> | null = null;

const normalizePem = (value: string): string =>
  value
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();

const pemToDer = (pem: string): Uint8Array => {
  const normalized = normalizePem(pem);
  const base64 = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) throw new Error("ADMIN_EXPORT_TOKEN_PRIVATE_KEY_INVALID");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const getPrivateKey = async (): Promise<CryptoKey> => {
  if (!ADMIN_EXPORT_TOKEN_PRIVATE_KEY_PEM) throw new Error("ADMIN_EXPORT_TOKEN_SIGNING_DISABLED");
  if (!cachedPrivateKeyPromise) {
    cachedPrivateKeyPromise = crypto.subtle.importKey(
      "pkcs8",
      pemToDer(ADMIN_EXPORT_TOKEN_PRIVATE_KEY_PEM),
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false,
      ["sign"],
    );
  }
  return cachedPrivateKeyPromise;
};

export const isAdminExportTokenSigningEnabled = (): boolean => Boolean(ADMIN_EXPORT_TOKEN_PRIVATE_KEY_PEM);

export const createSignedAdminExportToken = async (input: {
  adminUserId: string;
  bankJsonSha256: string;
  bankName: string;
  padCount: number;
  allowExport: boolean;
}): Promise<{
  token: string;
  keyId: string;
  issuedAt: string;
  expiresAt: string | null;
  payload: SignedAdminExportTokenPayload;
}> => {
  const bankJsonSha256 = asString(input.bankJsonSha256, 128)?.toLowerCase() || "";
  if (!/^[a-f0-9]{64}$/.test(bankJsonSha256)) {
    throw new Error("INVALID_BANK_JSON_SHA256");
  }
  const bankName = asString(input.bankName, 200) || "Untitled Bank";
  const safePadCount = clampInt(input.padCount, 0, 0, 10000);
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = ADMIN_EXPORT_TOKEN_TTL_SECONDS > 0 ? issuedAt + ADMIN_EXPORT_TOKEN_TTL_SECONDS : undefined;

  const payload: SignedAdminExportTokenPayload = {
    v: TOKEN_VERSION,
    iss: TOKEN_ISSUER,
    sub: input.adminUserId,
    iat: issuedAt,
    ...(exp ? { exp } : {}),
    kid: ADMIN_EXPORT_TOKEN_KEY_ID,
    bank_json_sha256: bankJsonSha256,
    bank_name: bankName,
    pad_count: safePadCount,
    allow_export: Boolean(input.allowExport),
  };

  const header = {
    alg: "ES256",
    typ: "VDJV-AET",
    kid: ADMIN_EXPORT_TOKEN_KEY_ID,
  };

  const encodedHeader = toBase64Url(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await getPrivateKey();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    textEncoder.encode(signingInput),
  );
  const encodedSignature = toBase64Url(new Uint8Array(signature));

  return {
    token: `${signingInput}.${encodedSignature}`,
    keyId: ADMIN_EXPORT_TOKEN_KEY_ID,
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    payload,
  };
};
