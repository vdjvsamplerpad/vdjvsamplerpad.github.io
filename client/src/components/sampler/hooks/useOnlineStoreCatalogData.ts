import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';
import {
    PaymentConfig,
    StoreBanner,
    StoreCatalogMeta,
    StoreItem,
    StoreSnapshot,
} from '@/components/sampler/onlineStore.types';

const STORE_SNAPSHOT_VERSION = 5;
const STORE_SNAPSHOT_FRESH_TTL_MS = 30 * 60 * 1000;

type UseOnlineStoreCatalogDataArgs = {
    STORE_PAGE_SIZE: number;
    debouncedStoreSearch: string;
    isOnline: boolean;
    effectiveUserId: string | null;
    storePage: number;
    storeSort: 'default' | 'name_asc' | 'name_desc' | 'price_low' | 'price_high' | 'free_download' | 'purchased' | 'downloaded';
    userKey: string;
    cacheKey: string;
    loadSeqRef: React.MutableRefObject<number>;
    lastCountQueryRef: React.MutableRefObject<string>;
    bannersRef: React.MutableRefObject<StoreBanner[]>;
    paymentConfigRef: React.MutableRefObject<PaymentConfig | null>;
    storeTotalItemsRef: React.MutableRefObject<number>;
    storeTotalPagesRef: React.MutableRefObject<number>;
    retryUnlockedBankIdsRef: React.MutableRefObject<Set<string>>;
    pushDownloadDebugLog: (level: 'info' | 'error', event: string, details?: Record<string, unknown>) => void;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setItems: React.Dispatch<React.SetStateAction<StoreItem[]>>;
    setPaymentConfig: React.Dispatch<React.SetStateAction<PaymentConfig | null>>;
    setBanners: React.Dispatch<React.SetStateAction<StoreBanner[]>>;
    setBannerIndex: React.Dispatch<React.SetStateAction<number>>;
    setStoreTotalItems: React.Dispatch<React.SetStateAction<number>>;
    setStoreTotalPages: React.Dispatch<React.SetStateAction<number>>;
    setStorePage: React.Dispatch<React.SetStateAction<number>>;
    setOfflineSnapshotTime: React.Dispatch<React.SetStateAction<number | null>>;
};

const parseFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

export function useOnlineStoreCatalogData({
    STORE_PAGE_SIZE,
    debouncedStoreSearch,
    isOnline,
    effectiveUserId,
    storePage,
    storeSort,
    userKey,
    cacheKey,
    loadSeqRef,
    lastCountQueryRef,
    bannersRef,
    paymentConfigRef,
    storeTotalItemsRef,
    storeTotalPagesRef,
    retryUnlockedBankIdsRef,
    pushDownloadDebugLog,
    setLoading,
    setItems,
    setPaymentConfig,
    setBanners,
    setBannerIndex,
    setStoreTotalItems,
    setStoreTotalPages,
    setStorePage,
    setOfflineSnapshotTime,
}: UseOnlineStoreCatalogDataArgs) {
    const requestPage = storeSort === 'downloaded' ? 1 : storePage;
    const requestPerPage = storeSort === 'downloaded' ? 200 : STORE_PAGE_SIZE;
    const requestSort = storeSort === 'downloaded' ? 'name_asc' : storeSort;
    const trimmedSearch = debouncedStoreSearch.trim();
    const viewQueryKey = React.useMemo(
        () => `${storeSort}::${requestSort}::${requestPage}::${requestPerPage}::${trimmedSearch || '-'}`,
        [requestPage, requestPerPage, requestSort, storeSort, trimmedSearch],
    );
    const exactCacheKey = `${cacheKey}:view`;
    const baseCacheKey = `${cacheKey}:base`;

    const loadSnapshot = React.useCallback((): boolean => {
        const parseSnapshot = (raw: string | null): StoreSnapshot | null => {
            if (!raw) return null;
            const snapshot: StoreSnapshot = JSON.parse(raw);
            if (![1, 2, 3, 4, 5].includes(snapshot.version)) return null;
            if (snapshot.userKey !== userKey) return null;
            return snapshot;
        };
        const applySnapshot = (snapshot: StoreSnapshot, source: 'exact' | 'base'): boolean => {
            const ageMs = Math.max(0, Date.now() - Number(snapshot.savedAt || 0));
            const isFresh = ageMs <= STORE_SNAPSHOT_FRESH_TTL_MS;
            setItems(snapshot.items || []);
            setPaymentConfig(snapshot.paymentConfig || null);
            setBanners(Array.isArray(snapshot.banners) ? snapshot.banners : []);
            const cachedTotalRaw = parseFiniteNumber(snapshot.total);
            const cachedPerPageRaw = parseFiniteNumber(snapshot.perPage);
            const cachedTotalPagesRaw = parseFiniteNumber(snapshot.totalPages);
            const cachedTotal = cachedTotalRaw !== null && cachedTotalRaw >= 0 ? Math.floor(cachedTotalRaw) : 0;
            const cachedPerPage = cachedPerPageRaw !== null && cachedPerPageRaw > 0
                ? Math.floor(cachedPerPageRaw)
                : STORE_PAGE_SIZE;
            setStoreTotalItems(cachedTotal);
            if (cachedTotalPagesRaw !== null && cachedTotalPagesRaw > 0) {
                setStoreTotalPages(Math.max(1, Math.floor(cachedTotalPagesRaw)));
            } else {
                const fallbackPages = Math.max(1, Math.ceil(cachedTotal / Math.max(1, cachedPerPage)));
                setStoreTotalPages(fallbackPages);
            }
            setBannerIndex(0);
            setOfflineSnapshotTime(snapshot.savedAt);
            pushDownloadDebugLog('info', 'catalog_snapshot_loaded', {
                source,
                queryKey: snapshot.queryKey || null,
                ageMs,
                fresh: isFresh,
                itemCount: Array.isArray(snapshot.items) ? snapshot.items.length : 0,
            });
            return true;
        };
        try {
            const exactSnapshot = parseSnapshot(localStorage.getItem(exactCacheKey));
            if (exactSnapshot && (exactSnapshot.version < 4 || exactSnapshot.queryKey === viewQueryKey)) {
                return applySnapshot(exactSnapshot, 'exact');
            }
            const baseSnapshot = parseSnapshot(localStorage.getItem(baseCacheKey));
            if (baseSnapshot) return applySnapshot(baseSnapshot, 'base');
        } catch {
            // no-op
        }
        return false;
    }, [
        baseCacheKey,
        exactCacheKey,
        STORE_PAGE_SIZE,
        setBannerIndex,
        setBanners,
        setItems,
        setOfflineSnapshotTime,
        setPaymentConfig,
        setStoreTotalItems,
        setStoreTotalPages,
        pushDownloadDebugLog,
        userKey,
        viewQueryKey,
    ]);

    const saveSnapshot = React.useCallback((
        newItems: StoreItem[],
        newConfig: PaymentConfig | null,
        newBanners: StoreBanner[],
        meta?: { page?: number; perPage?: number; total?: number; totalPages?: number },
    ) => {
        try {
            const snapshot: StoreSnapshot = {
                version: STORE_SNAPSHOT_VERSION,
                userKey,
                savedAt: Date.now(),
                queryKey: viewQueryKey,
                items: newItems,
                paymentConfig: newConfig,
                banners: newBanners,
                page: meta?.page,
                perPage: meta?.perPage,
                total: meta?.total,
                totalPages: meta?.totalPages,
            };
            localStorage.setItem(exactCacheKey, JSON.stringify(snapshot));
            if (storeSort === 'default' && requestPage === 1 && !trimmedSearch) {
                localStorage.setItem(baseCacheKey, JSON.stringify(snapshot));
            }
            setOfflineSnapshotTime(snapshot.savedAt);
        } catch {
            // no-op
        }
    }, [baseCacheKey, exactCacheKey, requestPage, setOfflineSnapshotTime, storeSort, trimmedSearch, userKey, viewQueryKey]);

    const loadData = React.useCallback(async () => {
        const requestSeq = ++loadSeqRef.current;
        const loadedSnapshot = loadSnapshot();
        if (!isOnline) {
            if (!loadedSnapshot) {
                setStoreTotalItems(0);
                setStoreTotalPages(1);
                setLoading(false);
            }
            return;
        }

        setLoading(!loadedSnapshot);
        try {
            const requestStartedAt = Date.now();
            const headers: Record<string, string> = {};
            if (effectiveUserId) {
                const { supabase } = await import('@/lib/supabase');
                const session = await supabase.auth.getSession();
                if (session.data.session?.access_token) {
                    headers.Authorization = `Bearer ${session.data.session.access_token}`;
                }
            }

            const params = new URLSearchParams();
            params.set('page', String(requestPage));
            params.set('perPage', String(requestPerPage));
            params.set('sort', requestSort);
            const countQueryKey = `${storeSort}::${trimmedSearch}`;
            const queryChanged = lastCountQueryRef.current !== countQueryKey;
            const includeBanners = requestPage === 1;
            params.set('includeBanners', includeBanners ? '1' : '0');
            const includeCount = requestPage === 1 || queryChanged;
            params.set('includeCount', includeCount ? '1' : '0');
            if (trimmedSearch) params.set('q', trimmedSearch);

            const shouldFetchConfig = !paymentConfigRef.current;
            const catalogReq = fetch(edgeFunctionUrl('store-api', `catalog?${params.toString()}`), { headers });
            const configReq = shouldFetchConfig
                ? fetch(edgeFunctionUrl('store-api', 'payment-config'))
                : Promise.resolve(null);
            const [catalogRes, configRes] = await Promise.all([catalogReq, configReq]);
            if (loadSeqRef.current !== requestSeq) return;

            let fetchedItems: StoreItem[] = [];
            let fetchedConfig: PaymentConfig | null = paymentConfigRef.current;
            let fetchedBanners: StoreBanner[] = [];
            let shouldReplaceBanners = false;
            let fetchedTotal = storeTotalItemsRef.current;
            let fetchedTotalPages = storeTotalPagesRef.current;
            let fetchedPage = storePage;

            if (catalogRes.ok) {
                const data = await catalogRes.json();
                const meta: StoreCatalogMeta | null = data?.meta && typeof data.meta === 'object' ? data.meta : null;
                if (includeCount) {
                    lastCountQueryRef.current = countQueryKey;
                }
                fetchedItems = Array.isArray(data.items) ? data.items : [];
                if (Array.isArray(data.banners)) {
                    fetchedBanners = data.banners;
                    shouldReplaceBanners = true;
                }
                const apiTotal = parseFiniteNumber(data.total);
                if (apiTotal !== null) {
                    fetchedTotal = Math.max(0, apiTotal);
                } else if (requestPage === 1) {
                    fetchedTotal = fetchedItems.length;
                }
                const apiTotalPages = parseFiniteNumber(data.totalPages);
                if (apiTotalPages !== null && apiTotalPages > 0) {
                    fetchedTotalPages = Math.max(1, apiTotalPages);
                } else if (requestPage === 1) {
                    fetchedTotalPages = Math.max(1, Math.ceil(fetchedTotal / Math.max(1, requestPerPage)));
                }
                const apiPage = parseFiniteNumber(data.page);
                fetchedPage = apiPage !== null ? Math.max(1, apiPage) : requestPage;
                pushDownloadDebugLog('info', 'catalog_loaded', {
                    durationMs: Date.now() - requestStartedAt,
                    serverDurationMs: meta?.durationMs ?? null,
                    strategy: meta?.strategy ?? null,
                    itemCount: fetchedItems.length,
                    total: typeof data.total === 'number' ? data.total : null,
                    sort: storeSort,
                    query: trimmedSearch || null,
                });
            } else {
                pushDownloadDebugLog('error', 'catalog_request_failed', {
                    status: catalogRes.status,
                    sort: storeSort,
                    query: trimmedSearch || null,
                });
            }
            if (configRes?.ok) {
                const data = await configRes.json();
                fetchedConfig = data.config || null;
            }

            const hydratedItems = fetchedItems.map((item) => {
                if (retryUnlockedBankIdsRef.current.has(item.bank_id) && item.status === 'rejected') {
                    return { ...item, status: 'buy' as StoreItem['status'], rejection_message: null };
                }
                return item;
            });

            const normalizedTotalPages = Math.max(1, Math.floor(fetchedTotalPages));
            const normalizedPage = Math.min(Math.max(1, Math.floor(fetchedPage)), normalizedTotalPages);
            const nextBanners = shouldReplaceBanners ? fetchedBanners : bannersRef.current;
            setItems(hydratedItems);
            setPaymentConfig(fetchedConfig);
            if (shouldReplaceBanners) {
                setBanners(fetchedBanners);
                setBannerIndex(0);
            }
            setStoreTotalItems(Math.floor(fetchedTotal));
            setStoreTotalPages(normalizedTotalPages);
            if (storeSort !== 'downloaded' && normalizedPage !== storePage) setStorePage(normalizedPage);
            saveSnapshot(hydratedItems, fetchedConfig, nextBanners, {
                page: normalizedPage,
                perPage: requestPerPage,
                total: fetchedTotal,
                totalPages: normalizedTotalPages,
            });
        } catch (error) {
            pushDownloadDebugLog('error', 'catalog_load_exception', {
                sort: storeSort,
                query: trimmedSearch || null,
                message: error instanceof Error ? error.message : String(error),
            });
            loadSnapshot();
        } finally {
            if (loadSeqRef.current === requestSeq) setLoading(false);
        }
    }, [
        STORE_PAGE_SIZE,
        bannersRef,
        debouncedStoreSearch,
        effectiveUserId,
        isOnline,
        lastCountQueryRef,
        loadSeqRef,
        loadSnapshot,
        paymentConfigRef,
        pushDownloadDebugLog,
        retryUnlockedBankIdsRef,
        requestPage,
        requestPerPage,
        requestSort,
        saveSnapshot,
        setBannerIndex,
        setBanners,
        setItems,
        setLoading,
        setPaymentConfig,
        setStorePage,
        setStoreTotalItems,
        setStoreTotalPages,
        storeSort,
        storeTotalItemsRef,
        storeTotalPagesRef,
        trimmedSearch,
    ]);

    return {
        loadSnapshot,
        saveSnapshot,
        loadData,
    };
}
