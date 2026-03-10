import type { SamplerBank } from '../types/sampler';
import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

type SetState<T> = (value: T | ((prev: T) => T)) => void;

const STORE_RECOVERY_CATALOG_TTL_MS = 5 * 60 * 1000;

const getStoreCatalogStatusRank = (status: unknown): number => {
  switch (status) {
    case 'granted_download':
      return 4;
    case 'free_download':
      return 3;
    case 'buy':
      return 2;
    case 'pending':
      return 1;
    default:
      return 0;
  }
};

export interface StoreRecoveryCatalogItem {
  catalogItemId: string;
  bankId: string;
  sha256?: string | null;
}

export interface StoreRecoveryCatalogCache {
  fetchedAt: number;
  byBankId: Record<string, StoreRecoveryCatalogItem>;
}

export const persistStoreRecoveryCatalogItem = (
  runtimeBankId: string,
  item: StoreRecoveryCatalogItem,
  deps: {
    setBanks: SetState<SamplerBank[]>;
  }
): void => {
  if (!runtimeBankId || !item.catalogItemId) return;
  deps.setBanks((prev) => prev.map((bank) => {
    if (bank.id !== runtimeBankId) return bank;
    const currentMetadata = bank.bankMetadata || null;
    const resolvedBankId =
      (typeof currentMetadata?.bankId === 'string' && currentMetadata.bankId.trim().length > 0)
        ? currentMetadata.bankId
        : item.bankId;
    const resolvedSha = item.sha256 ?? currentMetadata?.catalogSha256;
    if (
      currentMetadata?.catalogItemId === item.catalogItemId &&
      currentMetadata?.bankId === resolvedBankId &&
      (currentMetadata?.catalogSha256 || null) === (resolvedSha || null)
    ) {
      return bank;
    }
    return {
      ...bank,
      bankMetadata: {
        ...(currentMetadata || { password: false, transferable: bank.transferable ?? true }),
        bankId: resolvedBankId,
        catalogItemId: item.catalogItemId,
        catalogSha256: resolvedSha || undefined,
      },
    };
  }));
};

export const resolveStoreRecoveryCatalogItem = async (
  bank: SamplerBank,
  deps: {
    cacheRef: { current: StoreRecoveryCatalogCache };
    persistStoreRecoveryCatalogItem: (runtimeBankId: string, item: StoreRecoveryCatalogItem) => void;
  }
): Promise<StoreRecoveryCatalogItem | null> => {
  const metadataBankId = typeof bank.bankMetadata?.bankId === 'string' ? bank.bankMetadata.bankId.trim() : '';
  const metadataCatalogItemId =
    typeof bank.bankMetadata?.catalogItemId === 'string' ? bank.bankMetadata.catalogItemId.trim() : '';
  const metadataSha =
    typeof bank.bankMetadata?.catalogSha256 === 'string' ? bank.bankMetadata.catalogSha256.trim().toLowerCase() : '';

  if (metadataCatalogItemId) {
    const directItem: StoreRecoveryCatalogItem = {
      catalogItemId: metadataCatalogItemId,
      bankId: metadataBankId || bank.id,
      sha256: metadataSha || null,
    };
    if (metadataBankId) {
      deps.cacheRef.current.byBankId[metadataBankId] = directItem;
    }
    deps.persistStoreRecoveryCatalogItem(bank.id, directItem);
    return directItem;
  }

  if (!metadataBankId) return null;

  const now = Date.now();
  const cacheAgeMs = now - deps.cacheRef.current.fetchedAt;
  if (cacheAgeMs <= STORE_RECOVERY_CATALOG_TTL_MS) {
    const cached = deps.cacheRef.current.byBankId[metadataBankId];
    if (cached?.catalogItemId) {
      deps.persistStoreRecoveryCatalogItem(bank.id, cached);
      return cached;
    }
  }

  try {
    const headers = await getAuthHeaders(true);
    const nextByBankId: Record<string, StoreRecoveryCatalogItem> = {};
    const nextRankByBankId: Record<string, number> = {};
    const perPage = 200;
    const maxPages = 25;
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= maxPages) {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('perPage', String(perPage));
      params.set('sort', 'name_asc');
      params.set('includeBanners', '0');
      params.set('includeCount', page === 1 ? '1' : '0');
      const response = await fetch(edgeFunctionUrl('store-api', `catalog?${params.toString()}`), {
        headers,
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => ({}));
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const parsedTotalPages = Number(payload?.totalPages);
      if (Number.isFinite(parsedTotalPages) && parsedTotalPages > 0) {
        totalPages = Math.max(1, Math.floor(parsedTotalPages));
      }
      for (const item of items) {
        const bankId = typeof item?.bank_id === 'string' ? item.bank_id.trim() : '';
        const catalogItemId = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!bankId || !catalogItemId) continue;

        const statusRank = getStoreCatalogStatusRank(item?.status);
        const previousRank = nextRankByBankId[bankId];
        if (typeof previousRank === 'number' && previousRank > statusRank) continue;

        nextRankByBankId[bankId] = statusRank;
        nextByBankId[bankId] = {
          catalogItemId,
          bankId,
          sha256: typeof item?.sha256 === 'string' ? item.sha256.trim().toLowerCase() : null,
        };
      }
      if (items.length === 0) break;
      page += 1;
    }

    deps.cacheRef.current = {
      fetchedAt: now,
      byBankId: nextByBankId,
    };

    const resolved = nextByBankId[metadataBankId] || null;
    if (resolved?.catalogItemId) {
      deps.persistStoreRecoveryCatalogItem(bank.id, resolved);
    }
    return resolved;
  } catch {
    return null;
  }
};

export const downloadStoreBankArchiveForRecovery = async (
  bank: SamplerBank,
  deps: {
    userId: string | null;
    resolveStoreRecoveryCatalogItem: (bank: SamplerBank) => Promise<StoreRecoveryCatalogItem | null>;
    sha256HexFromBlob: (blob: Blob) => Promise<string | null>;
  }
): Promise<File | null> => {
  if (!deps.userId) return null;

  const recoveryItem = await deps.resolveStoreRecoveryCatalogItem(bank);
  if (!recoveryItem?.catalogItemId) return null;

  try {
    const headers = await getAuthHeaders(true);
    const ticketResponse = await fetch(edgeFunctionUrl('store-api', `download/${recoveryItem.catalogItemId}?transport=signed_url`), {
      headers,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!ticketResponse.ok) return null;

    const ticketPayload = await ticketResponse.json().catch(() => ({}));
    const signedDownloadUrl = typeof ticketPayload?.downloadUrl === 'string'
      ? ticketPayload.downloadUrl
      : (typeof ticketPayload?.data?.downloadUrl === 'string' ? ticketPayload.data.downloadUrl : '');
    if (!signedDownloadUrl) return null;

    const response = await fetch(signedDownloadUrl, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (!(blob instanceof Blob) || blob.size <= 0) return null;

    const expectedSha = typeof recoveryItem.sha256 === 'string' ? recoveryItem.sha256.trim().toLowerCase() : '';
    if (expectedSha) {
      const actualSha = await deps.sha256HexFromBlob(blob);
      if (!actualSha || actualSha.toLowerCase() !== expectedSha) {
        return null;
      }
    }

    const safeBankName = (bank.name || 'bank').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'bank';
    return new File([blob], `${safeBankName}.bank`, { type: 'application/octet-stream' });
  } catch {
    return null;
  }
};

