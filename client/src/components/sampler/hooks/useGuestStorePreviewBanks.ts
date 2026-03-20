import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';

export interface GuestStorePreviewBank {
  kind: 'preview';
  bankId: string;
  catalogItemId: string;
  title: string;
  color: string;
  thumbnailUrl: string | null;
  isPinned: boolean;
  order: number;
}

type GuestStorePreviewCache = {
  version: number;
  savedAt: number;
  items: GuestStorePreviewBank[];
};

const GUEST_STORE_PREVIEW_CACHE_KEY = 'vdjv-guest-store-preview-banks-v1';
const GUEST_STORE_PREVIEW_SUPPRESSED_KEY = 'vdjv-guest-store-preview-suppressed-v1';
const GUEST_STORE_PREVIEW_CACHE_VERSION = 1;
export const STORE_PREVIEW_LIMIT = 10;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const readSuppressed = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(GUEST_STORE_PREVIEW_SUPPRESSED_KEY) === '1';
  } catch {
    return false;
  }
};

const writeSuppressed = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_STORE_PREVIEW_SUPPRESSED_KEY, '1');
  } catch {
  }
};

const readCache = (): GuestStorePreviewBank[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_STORE_PREVIEW_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GuestStorePreviewCache;
    if (!parsed || parsed.version !== GUEST_STORE_PREVIEW_CACHE_VERSION || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items.filter((item): item is GuestStorePreviewBank =>
      isObjectRecord(item)
      && item.kind === 'preview'
      && isNonEmptyString(item.bankId)
      && isNonEmptyString(item.catalogItemId)
      && isNonEmptyString(item.title)
      && isNonEmptyString(item.color)
      && typeof item.isPinned === 'boolean'
      && typeof item.order === 'number'
    );
  } catch {
    return [];
  }
};

const writeCache = (items: GuestStorePreviewBank[]): void => {
  if (typeof window === 'undefined') return;
  try {
    const payload: GuestStorePreviewCache = {
      version: GUEST_STORE_PREVIEW_CACHE_VERSION,
      savedAt: Date.now(),
      items,
    };
    window.localStorage.setItem(GUEST_STORE_PREVIEW_CACHE_KEY, JSON.stringify(payload));
  } catch {
  }
};

const normalizePreviewItems = (items: unknown): GuestStorePreviewBank[] => {
  if (!Array.isArray(items)) return [];
  const seenBankIds = new Set<string>();
  const normalized: GuestStorePreviewBank[] = [];

  items.forEach((item, index) => {
    if (!isObjectRecord(item)) return;
    const bankId = isNonEmptyString(item.bank_id) ? item.bank_id.trim() : '';
    const catalogItemId = isNonEmptyString(item.id) ? item.id.trim() : '';
    const bank = isObjectRecord(item.bank) ? item.bank : {};
    const title = isNonEmptyString(bank.title) ? bank.title.trim() : '';
    const color = isNonEmptyString(bank.color) ? bank.color.trim() : '#3b82f6';
    const normalizedTitle = title.toLowerCase();

    if (!bankId || !catalogItemId || !title) return;
    if (normalizedTitle === 'default bank') return;
    if (seenBankIds.has(bankId)) return;
    seenBankIds.add(bankId);

    normalized.push({
      kind: 'preview',
      bankId,
      catalogItemId,
      title,
      color,
      thumbnailUrl: isNonEmptyString(item.thumbnail_path) ? item.thumbnail_path.trim() : null,
      isPinned: Boolean(item.is_pinned),
      order: index,
    });
  });

  return normalized.slice(0, STORE_PREVIEW_LIMIT);
};

export const fetchStorePreviewBanks = async (): Promise<{ items: GuestStorePreviewBank[]; maintenanceEnabled: boolean }> => {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('perPage', String(STORE_PREVIEW_LIMIT));
  params.set('sort', 'default');
  params.set('includeBanners', '0');
  params.set('includeCount', '0');

  const response = await fetch(edgeFunctionUrl('store-api', `catalog?${params.toString()}`), {
    method: 'GET',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Preview catalog request failed (${response.status})`);
  }
  const payload = await response.json().catch(() => ({}));
  const maintenanceEnabled = Boolean(
    isObjectRecord(payload)
    && isObjectRecord(payload.maintenance)
    && payload.maintenance.enabled === true,
  );
  return {
    items: maintenanceEnabled ? [] : normalizePreviewItems(isObjectRecord(payload) ? payload.items : []),
    maintenanceEnabled,
  };
};

export function useGuestStorePreviewBanks(effectiveUser: { id?: string | null } | null) {
  const [isSuppressed, setIsSuppressed] = React.useState<boolean>(() => readSuppressed());
  const [previewBanks, setPreviewBanks] = React.useState<GuestStorePreviewBank[]>(() => {
    if (readSuppressed()) return [];
    if (typeof navigator !== 'undefined' && navigator.onLine) return [];
    return readCache();
  });

  React.useEffect(() => {
    if (!effectiveUser) return;
    writeSuppressed();
    setIsSuppressed(true);
    setPreviewBanks([]);
  }, [effectiveUser]);

  React.useEffect(() => {
    if (isSuppressed || effectiveUser) return;

    const cached = readCache();
    if (cached.length > 0) {
      setPreviewBanks(cached);
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const fetched = await fetchStorePreviewBanks();
        if (cancelled) return;
        if (fetched.maintenanceEnabled) {
          writeCache([]);
          setPreviewBanks([]);
          return;
        }
        if (fetched.items.length === 0) return;
        writeCache(fetched.items);
        setPreviewBanks(fetched.items);
      } catch {
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [effectiveUser, isSuppressed]);

  React.useEffect(() => {
    if (isSuppressed || effectiveUser || typeof window === 'undefined') return;

    const handleOnline = () => {
      void fetchStorePreviewBanks()
        .then((fetched) => {
          if (fetched.maintenanceEnabled) {
            writeCache([]);
            setPreviewBanks([]);
            return;
          }
          if (fetched.items.length === 0) return;
          writeCache(fetched.items);
          setPreviewBanks(fetched.items);
        })
        .catch(() => {
        });
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [effectiveUser, isSuppressed]);

  return {
    previewBanks: isSuppressed || effectiveUser ? [] : previewBanks,
    isSuppressed,
  };
}
