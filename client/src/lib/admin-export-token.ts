export type SignedAdminExportTokenPayload = {
  v: number;
  iss: string;
  sub: string;
  iat: number;
  exp?: number;
  kid?: string;
  bank_json_sha256: string;
  bank_name?: string;
  pad_count?: number;
  allow_export?: boolean;
};

export type VerifySignedAdminExportTokenResult = {
  valid: boolean;
  reason: string;
  payload?: SignedAdminExportTokenPayload;
};

const TOKEN_ISSUER = "vdjv.admin-export";
const TOKEN_VERSION = 1;
const TOKEN_EXP_SKEW_SECONDS = 300;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const configuredPublicKeyPem = ((import.meta as any).env?.VITE_ADMIN_EXPORT_TOKEN_PUBLIC_KEY_PEM as
  | string
  | undefined) || "";

let cachedPublicKeyPromise: Promise<CryptoKey | null> | null = null;

const normalizePem = (value: string): string =>
  value
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const pemToDer = (pem: string): Uint8Array => {
  const normalized = normalizePem(pem);
  const base64 = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) throw new Error("invalid public key");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getPublicKey = async (): Promise<CryptoKey | null> => {
  if (!configuredPublicKeyPem.trim()) return null;
  if (!cachedPublicKeyPromise) {
    cachedPublicKeyPromise = crypto.subtle
      .importKey(
        "spki",
        pemToDer(configuredPublicKeyPem),
        {
          name: "ECDSA",
          namedCurve: "P-256",
        },
        false,
        ["verify"],
      )
      .catch(() => null);
  }
  return cachedPublicKeyPromise;
};

const normalizeSha256 = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return normalized;
};

const parsePayload = (decodedPayload: string): SignedAdminExportTokenPayload | null => {
  const parsed = parseJsonObject(decodedPayload);
  if (!parsed) return null;
  const bankSha = normalizeSha256(parsed.bank_json_sha256);
  if (!bankSha) return null;
  const version = Number(parsed.v);
  const issuedAt = Number(parsed.iat);
  if (!Number.isFinite(version) || !Number.isFinite(issuedAt)) return null;

  const payload: SignedAdminExportTokenPayload = {
    v: Math.floor(version),
    iss: String(parsed.iss || ""),
    sub: String(parsed.sub || ""),
    iat: Math.floor(issuedAt),
    bank_json_sha256: bankSha,
  };

  const expiresAt = Number(parsed.exp);
  if (Number.isFinite(expiresAt)) payload.exp = Math.floor(expiresAt);
  if (typeof parsed.kid === "string") payload.kid = parsed.kid;
  if (typeof parsed.bank_name === "string") payload.bank_name = parsed.bank_name;
  if (Number.isFinite(Number(parsed.pad_count))) payload.pad_count = Math.floor(Number(parsed.pad_count));
  if (typeof parsed.allow_export === "boolean") payload.allow_export = parsed.allow_export;
  return payload;
};

export const verifySignedAdminExportToken = async (
  token: string,
  expectedBankJsonSha256: string,
): Promise<VerifySignedAdminExportTokenResult> => {
  try {
    if (!token || typeof token !== "string") {
      return { valid: false, reason: "missing_token" };
    }
    if (typeof crypto === "undefined" || !crypto.subtle) {
      return { valid: false, reason: "webcrypto_unavailable" };
    }
    const expectedSha = normalizeSha256(expectedBankJsonSha256);
    if (!expectedSha) {
      return { valid: false, reason: "invalid_expected_sha" };
    }

    const key = await getPublicKey();
    if (!key) return { valid: false, reason: "public_key_not_configured" };

    const parts = token.trim().split(".");
    if (parts.length !== 3) return { valid: false, reason: "invalid_token_format" };
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return { valid: false, reason: "invalid_token_format" };
    }

    const headerObject = parseJsonObject(textDecoder.decode(fromBase64Url(encodedHeader)));
    if (!headerObject) return { valid: false, reason: "invalid_header" };
    if (String(headerObject.alg || "") !== "ES256") return { valid: false, reason: "invalid_alg" };

    const payload = parsePayload(textDecoder.decode(fromBase64Url(encodedPayload)));
    if (!payload) return { valid: false, reason: "invalid_payload" };
    if (payload.iss !== TOKEN_ISSUER) return { valid: false, reason: "invalid_issuer" };
    if (payload.v !== TOKEN_VERSION) return { valid: false, reason: "invalid_version" };
    if (payload.bank_json_sha256 !== expectedSha) return { valid: false, reason: "sha_mismatch" };

    if (typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (now > payload.exp + TOKEN_EXP_SKEW_SECONDS) {
        return { valid: false, reason: "token_expired" };
      }
    }

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromBase64Url(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!verified) return { valid: false, reason: "invalid_signature" };

    return { valid: true, reason: "ok", payload };
  } catch {
    return { valid: false, reason: "verification_error" };
  }
};
