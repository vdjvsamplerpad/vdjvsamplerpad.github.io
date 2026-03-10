import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export const sha256HexFromBlob = async (blob: Blob): Promise<string | null> => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
};

export const sha256HexFromText = async (text: string): Promise<string | null> => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
};

export const issueSignedAdminExportToken = async (input: {
  bankJsonSha256: string;
  bankName: string;
  padCount: number;
  allowExport: boolean;
}): Promise<{
  token: string;
  keyId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  bankJsonSha256: string;
}> => {
  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('admin-api', 'store/sign-export-token'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || `Admin export token signing failed (${response.status})`));
  }
  const data = payload?.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : payload;
  const token = typeof data?.token === 'string' ? data.token.trim() : '';
  const bankJsonSha256 = typeof data?.bankJsonSha256 === 'string'
    ? data.bankJsonSha256.trim().toLowerCase()
    : '';
  if (!token || !/^[a-f0-9]{64}$/.test(bankJsonSha256)) {
    throw new Error('Admin export token signing returned invalid payload.');
  }
  return {
    token,
    keyId: typeof data?.keyId === 'string' ? data.keyId : null,
    issuedAt: typeof data?.issuedAt === 'string' ? data.issuedAt : null,
    expiresAt: typeof data?.expiresAt === 'string' ? data.expiresAt : null,
    bankJsonSha256,
  };
};
