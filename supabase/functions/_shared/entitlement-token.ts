import { asNumber, asString } from "./validate.ts";

const ENTITLEMENT_TOKEN_PRIVATE_KEY_PEM = asString(
  Deno.env.get("ENTITLEMENT_TOKEN_PRIVATE_KEY_PEM") || Deno.env.get("ADMIN_EXPORT_TOKEN_PRIVATE_KEY_PEM"),
  65535,
);
const ENTITLEMENT_TOKEN_KEY_ID =
  asString(Deno.env.get("ENTITLEMENT_TOKEN_KEY_ID"), 120)
  || asString(Deno.env.get("ADMIN_EXPORT_TOKEN_KEY_ID"), 120)
  || "entitlement-v1";

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed || NaN)) return fallback;
  const normalized = Math.floor(Number(parsed));
  if (!Number.isFinite(normalized)) return fallback;
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
};

const ENTITLEMENT_TOKEN_TTL_SECONDS = clampInt(
  Deno.env.get("ENTITLEMENT_TOKEN_TTL_SECONDS"),
  180 * 24 * 60 * 60,
  60,
  5 * 365 * 24 * 60 * 60,
);

const TOKEN_ISSUER = "vdjv.entitlement";
const TOKEN_VERSION = 1;

export type SignedEntitlementTokenPayload = {
  v: number;
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  kid: string;
  bank_id: string;
  catalog_item_id?: string;
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
  if (!base64) throw new Error("ENTITLEMENT_TOKEN_PRIVATE_KEY_INVALID");
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
  if (!ENTITLEMENT_TOKEN_PRIVATE_KEY_PEM) throw new Error("ENTITLEMENT_TOKEN_SIGNING_DISABLED");
  if (!cachedPrivateKeyPromise) {
    cachedPrivateKeyPromise = crypto.subtle.importKey(
      "pkcs8",
      pemToDer(ENTITLEMENT_TOKEN_PRIVATE_KEY_PEM),
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

export const isEntitlementTokenSigningEnabled = (): boolean => Boolean(ENTITLEMENT_TOKEN_PRIVATE_KEY_PEM);

export const createSignedEntitlementToken = async (input: {
  userId: string;
  bankId: string;
  catalogItemId?: string | null;
}): Promise<{
  token: string;
  keyId: string;
  issuedAt: string;
  expiresAt: string;
  payload: SignedEntitlementTokenPayload;
}> => {
  const userId = asString(input.userId, 120) || "";
  const bankId = asString(input.bankId, 120) || "";
  const catalogItemId = asString(input.catalogItemId, 120);
  if (!userId || !bankId) throw new Error("INVALID_ENTITLEMENT_TOKEN_SUBJECT");

  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + ENTITLEMENT_TOKEN_TTL_SECONDS;

  const payload: SignedEntitlementTokenPayload = {
    v: TOKEN_VERSION,
    iss: TOKEN_ISSUER,
    sub: userId,
    iat: issuedAt,
    exp,
    kid: ENTITLEMENT_TOKEN_KEY_ID,
    bank_id: bankId,
    ...(catalogItemId ? { catalog_item_id: catalogItemId } : {}),
  };

  const header = {
    alg: "ES256",
    typ: "VDJV-ENT",
    kid: ENTITLEMENT_TOKEN_KEY_ID,
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
    keyId: ENTITLEMENT_TOKEN_KEY_ID,
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    payload,
  };
};
