import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export type StoreDownloadAccessMaterial = {
  protected: boolean;
  derivedKey: string | null;
  entitlementToken: string | null;
  entitlementTokenKid: string | null;
  entitlementTokenIssuedAt: string | null;
  entitlementTokenExpiresAt: string | null;
};

export const fetchStoreDownloadAccessMaterial = async (
  catalogItemId: string
): Promise<StoreDownloadAccessMaterial | null> => {
  const trimmedCatalogItemId = typeof catalogItemId === 'string' ? catalogItemId.trim() : '';
  if (!trimmedCatalogItemId) return null;

  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('store-api', `download-key/${trimmedCatalogItemId}`), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) return null;

  const data = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload;

  return {
    protected: Boolean(data?.protected),
    derivedKey: typeof data?.derivedKey === 'string' && data.derivedKey.trim() ? data.derivedKey.trim() : null,
    entitlementToken:
      typeof data?.entitlementToken === 'string' && data.entitlementToken.trim() ? data.entitlementToken.trim() : null,
    entitlementTokenKid:
      typeof data?.entitlementTokenKeyId === 'string' && data.entitlementTokenKeyId.trim()
        ? data.entitlementTokenKeyId.trim()
        : null,
    entitlementTokenIssuedAt:
      typeof data?.entitlementTokenIssuedAt === 'string' && data.entitlementTokenIssuedAt.trim()
        ? data.entitlementTokenIssuedAt.trim()
        : null,
    entitlementTokenExpiresAt:
      typeof data?.entitlementTokenExpiresAt === 'string' && data.entitlementTokenExpiresAt.trim()
        ? data.entitlementTokenExpiresAt.trim()
        : null,
  };
};
