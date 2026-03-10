export type EntitlementTokenPayload = {
  v: number;
  iss: string;
  sub: string;
  iat: number;
  exp?: number;
  kid?: string;
  bank_id: string;
  catalog_item_id?: string;
};

export type VerifyEntitlementTokenResult = {
  valid: boolean;
  reason: string;
  payload?: EntitlementTokenPayload;
};

const TOKEN_ISSUER = 'vdjv.entitlement';
const TOKEN_VERSION = 1;
const TOKEN_EXP_SKEW_SECONDS = 300;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const configuredPublicKeyPem = (((import.meta as any).env?.VITE_ENTITLEMENT_TOKEN_PUBLIC_KEY_PEM as
  | string
  | undefined)
  || ((import.meta as any).env?.VITE_ADMIN_EXPORT_TOKEN_PUBLIC_KEY_PEM as string | undefined)
  || '');

let cachedPublicKeyPromise: Promise<CryptoKey | null> | null = null;

const normalizePem = (value: string): string =>
  value
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim();

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
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
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!base64) throw new Error('invalid public key');
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
        'spki',
        pemToDer(configuredPublicKeyPem),
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        false,
        ['verify']
      )
      .catch(() => null);
  }
  return cachedPublicKeyPromise;
};

const parsePayload = (decodedPayload: string): EntitlementTokenPayload | null => {
  const parsed = parseJsonObject(decodedPayload);
  if (!parsed) return null;
  const version = Number(parsed.v);
  const issuedAt = Number(parsed.iat);
  const subject = typeof parsed.sub === 'string' ? parsed.sub.trim() : '';
  const bankId = typeof parsed.bank_id === 'string' ? parsed.bank_id.trim() : '';
  if (!Number.isFinite(version) || !Number.isFinite(issuedAt) || !subject || !bankId) return null;

  const payload: EntitlementTokenPayload = {
    v: Math.floor(version),
    iss: String(parsed.iss || ''),
    sub: subject,
    iat: Math.floor(issuedAt),
    bank_id: bankId,
  };

  const exp = Number(parsed.exp);
  if (Number.isFinite(exp)) payload.exp = Math.floor(exp);
  if (typeof parsed.kid === 'string') payload.kid = parsed.kid;
  if (typeof parsed.catalog_item_id === 'string') payload.catalog_item_id = parsed.catalog_item_id;
  return payload;
};

export const verifySignedEntitlementToken = async (input: {
  token: string;
  expectedUserId: string;
  expectedBankId: string;
  expectedCatalogItemId?: string | null;
}): Promise<VerifyEntitlementTokenResult> => {
  try {
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    const expectedUserId = typeof input.expectedUserId === 'string' ? input.expectedUserId.trim() : '';
    const expectedBankId = typeof input.expectedBankId === 'string' ? input.expectedBankId.trim() : '';
    const expectedCatalogItemId =
      typeof input.expectedCatalogItemId === 'string' ? input.expectedCatalogItemId.trim() : '';

    if (!token) return { valid: false, reason: 'missing_token' };
    if (!expectedUserId || !expectedBankId) return { valid: false, reason: 'invalid_expected_subject' };
    if (typeof crypto === 'undefined' || !crypto.subtle) return { valid: false, reason: 'webcrypto_unavailable' };

    const key = await getPublicKey();
    if (!key) return { valid: false, reason: 'public_key_not_configured' };

    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'invalid_token_format' };
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) return { valid: false, reason: 'invalid_token_format' };

    const header = parseJsonObject(textDecoder.decode(fromBase64Url(encodedHeader)));
    if (!header) return { valid: false, reason: 'invalid_header' };
    if (String(header.alg || '') !== 'ES256') return { valid: false, reason: 'invalid_alg' };

    const payload = parsePayload(textDecoder.decode(fromBase64Url(encodedPayload)));
    if (!payload) return { valid: false, reason: 'invalid_payload' };
    if (payload.iss !== TOKEN_ISSUER) return { valid: false, reason: 'invalid_issuer' };
    if (payload.v !== TOKEN_VERSION) return { valid: false, reason: 'invalid_version' };
    if (payload.sub !== expectedUserId) return { valid: false, reason: 'subject_mismatch' };
    if (payload.bank_id !== expectedBankId) return { valid: false, reason: 'bank_mismatch' };
    if (expectedCatalogItemId && payload.catalog_item_id && payload.catalog_item_id !== expectedCatalogItemId) {
      return { valid: false, reason: 'catalog_item_mismatch' };
    }

    if (typeof payload.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (now > payload.exp + TOKEN_EXP_SKEW_SECONDS) return { valid: false, reason: 'token_expired' };
    }

    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64Url(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    if (!verified) return { valid: false, reason: 'invalid_signature' };

    return {
      valid: true,
      reason: 'ok',
      payload,
    };
  } catch {
    return { valid: false, reason: 'verification_error' };
  }
};
