import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PaymentReceiptCard } from '@/components/ui/payment-receipt-card';
import { OnlineStoreDebugPanel } from '@/components/sampler/OnlineStoreDebugPanel';
import { OnlineStoreCartBar } from '@/components/sampler/OnlineStoreCartBar';
import { OnlineStorePurchasePane } from '@/components/sampler/OnlineStorePurchasePane';
import { OnlineStoreRejectedOverlay } from '@/components/sampler/OnlineStoreRejectedOverlay';
import { Loader2, Download, ShoppingCart, LockIcon, ExternalLink, Check, X, ChevronLeft, ChevronRight, ChevronDown, Search, Plus, AlertCircle, RotateCcw, Timer } from 'lucide-react';
import { getCachedUser, useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { useOnlineStoreDebugLog } from '@/components/sampler/hooks/useOnlineStoreDebugLog';
import { useOnlineStoreDownloadTransfer } from '@/components/sampler/hooks/useOnlineStoreDownloadTransfer';
import { useOnlineStoreCatalogData } from '@/components/sampler/hooks/useOnlineStoreCatalogData';
import { useOnlineStorePurchaseFlow } from '@/components/sampler/hooks/useOnlineStorePurchaseFlow';
import {
    OnlineBankStoreImportMeta,
    PaymentChannel,
    PaymentConfig,
    PurchaseReceiptState,
    StoreBanner,
    StoreDownloadedArtifact,
    StoreItem,
    StoreMaintenanceState,
    TransferState,
} from '@/components/sampler/onlineStore.types';

interface OnlineBankStoreDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    theme: 'light' | 'dark';
    importedBankIds?: Set<string>;
    runtimeBankIdsBySource?: Record<string, string[]>;
    onImportBankFromStore: (
        file: File,
        meta: OnlineBankStoreImportMeta,
        onProgress?: (progress: number) => void
    ) => Promise<void>;
}

const ACCOUNT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
const ACCOUNT_PROOF_ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif']);
const ACCOUNT_PROOF_ALLOWED_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
]);
const getFileExt = (name: string): string => String(name.split('.').pop() || '').toLowerCase();

const validateProofFile = (file: File): string | null => {
    if (!file) return 'Please upload your proof of payment.';
    if (file.size <= 0) return 'Selected proof file is empty.';
    if (file.size > ACCOUNT_PROOF_MAX_BYTES) {
        return `Proof file is too large. Max is ${Math.ceil(ACCOUNT_PROOF_MAX_BYTES / (1024 * 1024))}MB.`;
    }
    const ext = getFileExt(file.name);
    const mime = String(file.type || '').toLowerCase();
    const extAllowed = ACCOUNT_PROOF_ALLOWED_EXTENSIONS.has(ext);
    const mimeAllowed = !mime || ACCOUNT_PROOF_ALLOWED_MIME_TYPES.has(mime);
    if (!extAllowed || !mimeAllowed) {
        return 'Unsupported image format. Please upload PNG, JPG, WEBP, GIF, or HEIC/HEIF.';
    }
    return null;
};

const formatPhp = (value: number): string =>
    `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normalizeBannerRotationMs = (value: unknown): number | null => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(parsed)) return null;
    return Math.max(3000, Math.min(15000, Math.floor(parsed)));
};

const parseStoredCartItemIds = (raw: string | null): Set<string> => {
    if (!raw) return new Set();
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(
            parsed
                .filter((value): value is string => typeof value === 'string')
                .map((value) => value.trim())
                .filter(Boolean),
        );
    } catch {
        return new Set();
    }
};

export function OnlineBankStoreDialog({ open, onOpenChange, theme, importedBankIds, runtimeBankIdsBySource, onImportBankFromStore }: OnlineBankStoreDialogProps) {
    const { user, profile } = useAuth();
    const effectiveUser = user || getCachedUser();
    const effectiveUserId = effectiveUser?.id || null;
    const isGuest = !effectiveUser;
    const isAdmin = profile?.role === 'admin';

    const [loading, setLoading] = React.useState(false);
    const [items, setItems] = React.useState<StoreItem[]>([]);
    const [paymentConfig, setPaymentConfig] = React.useState<PaymentConfig | null>(null);
    const [storeMaintenance, setStoreMaintenance] = React.useState<StoreMaintenanceState>({ enabled: false, message: null });
    const [banners, setBanners] = React.useState<StoreBanner[]>([]);
    const [bannerIndex, setBannerIndex] = React.useState(0);
    const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

    // Offline support
    const [isOnline, setIsOnline] = React.useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [offlineSnapshotTime, setOfflineSnapshotTime] = React.useState<number | null>(null);

    // Purchase Form State
    const [selectedItem, setSelectedItem] = React.useState<StoreItem | null>(null);
    const [formChannel, setFormChannel] = React.useState<PaymentChannel>('image_proof');
    const [formName, setFormName] = React.useState('');
    const [formRef, setFormRef] = React.useState('');
    const [formNotes, setFormNotes] = React.useState('');
    const [formProofFile, setFormProofFile] = React.useState<File | null>(null);
    const [proofOcrLoading, setProofOcrLoading] = React.useState(false);
    const [submitLoading, setSubmitLoading] = React.useState(false);
    const [transfers, setTransfers] = React.useState<Record<string, TransferState>>({});

    // Cart state
    const [cartItemIds, setCartItemIds] = React.useState<Set<string>>(new Set());
    const [checkoutMode, setCheckoutMode] = React.useState(false);
    const [rejectedOverlay, setRejectedOverlay] = React.useState<{ item: StoreItem } | null>(null);
    const [cartViewOpen, setCartViewOpen] = React.useState(true);
    const [retryUnlockedBankIds, setRetryUnlockedBankIds] = React.useState<Set<string>>(new Set());
    const retryUnlockedBankIdsRef = React.useRef<Set<string>>(new Set());

    // Search, sort, and pagination
    const STORE_PAGE_SIZE = 8;
    const [storeSearch, setStoreSearch] = React.useState('');
    const [debouncedStoreSearch, setDebouncedStoreSearch] = React.useState('');
    const [storeSort, setStoreSort] = React.useState<'default' | 'name_asc' | 'name_desc' | 'price_low' | 'price_high' | 'free_download' | 'purchased' | 'downloaded'>('default');
    const [storePage, setStorePage] = React.useState(1);
    const [storeTotalItems, setStoreTotalItems] = React.useState(0);
    const [storeTotalPages, setStoreTotalPages] = React.useState(1);

    const [toastMessage, setToastMessage] = React.useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const [proofPreviewUrl, setProofPreviewUrl] = React.useState<string | null>(null);
    const [expandedQrUrl, setExpandedQrUrl] = React.useState<string | null>(null);
    const [purchaseReceipt, setPurchaseReceipt] = React.useState<PurchaseReceiptState | null>(null);
    const [refreshAssetsItem, setRefreshAssetsItem] = React.useState<StoreItem | null>(null);
    const dialogScrollRef = React.useRef<HTMLDivElement | null>(null);
    const proofOcrSeqRef = React.useRef(0);
    const loadSeqRef = React.useRef(0);
    const bannersRef = React.useRef<StoreBanner[]>([]);
    const paymentConfigRef = React.useRef<PaymentConfig | null>(null);
    const maintenanceRef = React.useRef<StoreMaintenanceState>({ enabled: false, message: null });
    const storeTotalItemsRef = React.useRef(0);
    const storeTotalPagesRef = React.useRef(1);
    const lastCountQueryRef = React.useRef('');
    const downloadedArtifactsRef = React.useRef<Record<string, StoreDownloadedArtifact>>({});

    const showToast = (message: string, type: 'success' | 'error') => {
        setToastMessage({ message, type });
        setTimeout(() => setToastMessage(null), 3000);
    };
    const {
        downloadDebugEntries,
        downloadDebugText,
        pushDownloadDebugLog,
        copyDownloadDebugLog,
        exportDownloadDebugLog,
        clearDownloadDebugLog,
    } = useOnlineStoreDebugLog({
        open,
        effectiveUserId,
        enabled: isAdmin,
        showToast,
    });

    const requestLogin = (reason: string = 'Please sign in to get this bank.') => {
        onOpenChange(false);
        window.setTimeout(() => {
            window.dispatchEvent(new Event('vdjv-login-request'));
            window.dispatchEvent(new CustomEvent('vdjv-require-login', { detail: { reason } }));
        }, 0);
    };
    const { normalizeProgress, handleDownload, cancelDownload } = useOnlineStoreDownloadTransfer({
        effectiveUser,
        requestLogin,
        transfers,
        setTransfers,
        downloadedArtifactsRef,
        pushDownloadDebugLog,
        showToast,
        onImportBankFromStore,
    });

    const userKey = effectiveUserId || 'anon';
    const cacheKey = `vdjv-store-snapshot-v1:${userKey}`;
    const cartStorageKey = effectiveUserId ? `vdjv-store-cart-v1:${effectiveUserId}` : null;

    React.useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            pushDownloadDebugLog('info', 'network_online');
        };
        const handleOffline = () => {
            setIsOnline(false);
            pushDownloadDebugLog('error', 'network_offline');
        };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [pushDownloadDebugLog]);

    const downloadQrImage = React.useCallback(async (url: string) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = 'vdjv-payment-qr';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
            return;
        } catch {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.click();
        }
    }, []);

    React.useEffect(() => {
        retryUnlockedBankIdsRef.current = retryUnlockedBankIds;
    }, [retryUnlockedBankIds]);

    React.useEffect(() => {
        paymentConfigRef.current = paymentConfig;
    }, [paymentConfig]);

    React.useEffect(() => {
        maintenanceRef.current = storeMaintenance;
    }, [storeMaintenance]);

    React.useEffect(() => {
        storeTotalItemsRef.current = storeTotalItems;
    }, [storeTotalItems]);

    React.useEffect(() => {
        storeTotalPagesRef.current = storeTotalPages;
    }, [storeTotalPages]);

    React.useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedStoreSearch(storeSearch.trim());
        }, 350);
        return () => window.clearTimeout(timer);
    }, [storeSearch]);

    React.useEffect(() => {
        bannersRef.current = banners;
    }, [banners]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setPrefersReducedMotion(Boolean(media.matches));
        update();
        media.addEventListener?.('change', update);
        return () => media.removeEventListener?.('change', update);
    }, []);

    const { loadData } = useOnlineStoreCatalogData({
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
        maintenanceRef,
        storeTotalItemsRef,
        storeTotalPagesRef,
        retryUnlockedBankIdsRef,
        pushDownloadDebugLog,
        setLoading,
        setItems,
        setPaymentConfig,
        setStoreMaintenance,
        setBanners,
        setBannerIndex,
        setStoreTotalItems,
        setStoreTotalPages,
        setStorePage,
        setOfflineSnapshotTime,
    });

    React.useEffect(() => {
        if (open) {
            loadData();
        } else {
            proofOcrSeqRef.current += 1;
            lastCountQueryRef.current = '';
            downloadedArtifactsRef.current = {};
            setStoreSearch('');
            setDebouncedStoreSearch('');
            setStoreSort('default');
            setStorePage(1);
            setSelectedItem(null);
            setFormName('');
            setFormRef('');
            setFormNotes('');
            setFormProofFile(null);
            setProofOcrLoading(false);
            setCheckoutMode(false);
            setExpandedQrUrl(null);
            setPurchaseReceipt(null);
            setBannerIndex(0);
        }
    }, [open, isOnline, loadData]);

    React.useEffect(() => {
        if (banners.length <= 0) {
            setBannerIndex(0);
            return;
        }
        setBannerIndex((prev) => {
            if (prev >= banners.length) return 0;
            if (prev < 0) return 0;
            return prev;
        });
    }, [banners.length]);

    const goToNextBanner = React.useCallback(() => {
        setBannerIndex((prev) => {
            if (banners.length <= 1) return 0;
            return (prev + 1) % banners.length;
        });
    }, [banners.length]);

    const goToPrevBanner = React.useCallback(() => {
        setBannerIndex((prev) => {
            if (banners.length <= 1) return 0;
            return (prev - 1 + banners.length) % banners.length;
        });
    }, [banners.length]);

    React.useEffect(() => {
        if (!open) return;
        if (selectedItem || checkoutMode || purchaseReceipt) return;
        if (banners.length <= 1) return;
        const configuredDelay = normalizeBannerRotationMs(paymentConfig?.banner_rotation_ms) ?? 5000;
        const delay = prefersReducedMotion ? Math.max(configuredDelay, 8000) : configuredDelay;
        const timer = window.setInterval(() => {
            goToNextBanner();
        }, delay);
        return () => window.clearInterval(timer);
    }, [open, selectedItem, checkoutMode, purchaseReceipt, banners.length, paymentConfig?.banner_rotation_ms, prefersReducedMotion, goToNextBanner]);

    React.useEffect(() => {
        if (!open || !purchaseReceipt) return;
        const scrollEl = dialogScrollRef.current;
        if (!scrollEl) return;
        scrollEl.scrollTop = 0;
    }, [open, purchaseReceipt]);

    React.useEffect(() => {
        if (!formProofFile) {
            setProofPreviewUrl(null);
            return;
        }
        const url = URL.createObjectURL(formProofFile);
        setProofPreviewUrl(url);
        return () => {
            URL.revokeObjectURL(url);
        };
    }, [formProofFile]);

    React.useEffect(() => {
        if (formChannel === 'image_proof') {
            proofOcrSeqRef.current += 1;
            setProofOcrLoading(false);
            setFormName('');
            setFormRef('');
        }
    }, [formChannel]);

    React.useEffect(() => {
        if (cartItemIds.size > 0) {
            setCartViewOpen(true);
        }
    }, [cartItemIds.size]);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!cartStorageKey) {
            setCartItemIds(new Set());
            return;
        }
        setCartItemIds(parseStoredCartItemIds(window.localStorage.getItem(cartStorageKey)));
    }, [cartStorageKey]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !cartStorageKey) return;
        if (cartItemIds.size === 0) {
            window.localStorage.removeItem(cartStorageKey);
            return;
        }
        window.localStorage.setItem(cartStorageKey, JSON.stringify(Array.from(cartItemIds)));
    }, [cartItemIds, cartStorageKey]);

    React.useEffect(() => {
        if (items.length === 0 || cartItemIds.size === 0) return;
        const validBuyableIds = new Set(
            items
                .filter((item) => item.status === 'buy')
                .map((item) => item.id),
        );
        let changed = false;
        const next = new Set<string>();
        cartItemIds.forEach((id) => {
            if (validBuyableIds.has(id)) {
                next.add(id);
                return;
            }
            changed = true;
        });
        if (changed) setCartItemIds(next);
    }, [items, cartItemIds]);

    React.useEffect(() => {
        if (!effectiveUserId) {
            setCartItemIds(new Set());
            setCheckoutMode(false);
        }
    }, [effectiveUserId]);

    const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
        if (!nextOpen && (selectedItem || checkoutMode)) {
            setSelectedItem(null);
            setCheckoutMode(false);
            return;
        }
        onOpenChange(nextOpen);
    }, [selectedItem, checkoutMode, onOpenChange]);

    const { handleProofUpload, handlePurchaseSubmit } = useOnlineStorePurchaseFlow({
        effectiveUser,
        selectedItem,
        checkoutMode,
        items,
        cartItemIds,
        formChannel,
        formName,
        formRef,
        formNotes,
        formProofFile,
        proofOcrSeqRef,
        validateProofFile,
        formatPhp,
        loadData,
        showToast,
        setProofOcrLoading,
        setSubmitLoading,
        setPurchaseReceipt,
        setSelectedItem,
        setCheckoutMode,
        setCartItemIds,
        setFormName,
        setFormRef,
        setFormNotes,
        setFormProofFile,
    });

    const handleRetry = (item: StoreItem) => {
        const retriableItem: StoreItem = { ...item, status: 'buy', rejection_message: null };
        setRetryUnlockedBankIds((prev) => {
            const next = new Set(prev);
            next.add(item.bank_id);
            return next;
        });
        setItems((prev) =>
            prev.map((entry) =>
                entry.id === item.id
                    ? { ...entry, status: 'buy', rejection_message: null }
                    : entry,
            ),
        );
        setRejectedOverlay(null);
        setCheckoutMode(false);
        setSelectedItem(retriableItem);
    };

    const cartItems = React.useMemo(() => items.filter(i => cartItemIds.has(i.id)), [items, cartItemIds]);
    const cartTotal = cartItems.reduce((sum, i) => sum + (i.price_php ?? 0), 0);
    const importedOrDownloadedBankIds = React.useMemo(() => {
        return new Set<string>(Array.from(importedBankIds || []));
    }, [importedBankIds]);
    const activeBanner = React.useMemo(() => {
        if (!Array.isArray(banners) || banners.length === 0) return null;
        const index = bannerIndex >= 0 && bannerIndex < banners.length ? bannerIndex : 0;
        return banners[index] || null;
    }, [banners, bannerIndex]);

    const isDark = theme === 'dark';

    const renderCatalogPrice = React.useCallback((item: StoreItem) => {
        if (item.price_php === null) return <span className="text-amber-300 text-sm">Price to be announced</span>;
        const hasPromotion = Boolean(
            item.has_active_promotion
            && typeof item.original_price_php === 'number'
            && item.original_price_php > item.price_php,
        );
        if (!hasPromotion) return <span>PHP {item.price_php.toLocaleString()}</span>;
        return (
            <div className="flex flex-col items-start leading-tight min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] line-through opacity-60">PHP {Number(item.original_price_php || 0).toLocaleString()}</span>
                    <span>PHP {item.price_php.toLocaleString()}</span>
                </div>
                {item.promotion_badge && item.promotion_type !== 'flash_sale' ? (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1 w-full">
                        <span className="shrink-0 inline-flex items-center h-4 px-1.5 rounded text-[9px] font-bold uppercase tracking-wide border bg-sky-500/20 text-sky-100 border-sky-200/30">
                            {item.promotion_badge}
                        </span>
                    </div>
                ) : null}
            </div>
        );
    }, []);

    const filteredItems = React.useMemo(() => {
        if (storeSort === 'downloaded') {
            return items.filter((item) => importedOrDownloadedBankIds.has(item.bank_id));
        }
        return items;
    }, [importedOrDownloadedBankIds, items, storeSort]);

    const effectiveTotalItems = storeSort === 'downloaded' ? filteredItems.length : storeTotalItems;
    const effectiveTotalPages = storeSort === 'downloaded'
        ? Math.max(1, Math.ceil(filteredItems.length / STORE_PAGE_SIZE))
        : storeTotalPages;
    const displayedItems = React.useMemo(() => {
        if (storeSort !== 'downloaded') return filteredItems;
        const start = (storePage - 1) * STORE_PAGE_SIZE;
        return filteredItems.slice(start, start + STORE_PAGE_SIZE);
    }, [STORE_PAGE_SIZE, filteredItems, storePage, storeSort]);

    React.useEffect(() => {
        if (storePage <= effectiveTotalPages) return;
        setStorePage(effectiveTotalPages);
    }, [effectiveTotalPages, storePage]);

    return (
        <>
            <Dialog open={open} onOpenChange={handleDialogOpenChange}>
                <DialogContent
                    overlayClassName="z-[110]"
                    className={`!left-[50%] !top-[50%] !translate-x-[-50%] !translate-y-[-50%] fixed z-[120] w-[95vw] max-w-5xl max-h-[88vh] md:max-h-[85vh] overflow-hidden flex flex-col p-0 rounded-2xl md:rounded-3xl border shadow-2xl transition-all ${isDark ? 'bg-gray-900/95 backdrop-blur-2xl border-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.7)]' : 'bg-white/95 backdrop-blur-2xl border-gray-200/80 shadow-[0_30px_60px_-15px_rgba(29,78,216,0.15)]'}`}
                    aria-describedby={undefined}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                    }}
                >
                    {toastMessage && (
                        <div className={`absolute top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-md shadow-md z-50 flex items-center gap-2 transition-all ${toastMessage.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
                            {toastMessage.type === 'error' ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                            <span className="text-sm font-medium">{toastMessage.message}</span>
                        </div>
                    )}
                    <DialogHeader className={`relative px-6 py-5 md:px-8 md:py-6 border-b shrink-0 overflow-hidden ${isDark ? 'border-white/5 bg-gray-900/40' : 'border-black/5 bg-white/40'}`}>
                        {/* Premium Glow Effect in Background */}
                        <div className="absolute -top-1/2 left-1/4 w-1/2 h-full bg-indigo-500/20 dark:bg-indigo-400/20 blur-[80px] pointer-events-none rounded-full" />

                        <div className="relative flex items-center gap-4">
                            <div className={`p-3 rounded-2xl shrink-0 border shadow-sm ${isDark ? 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-white/10 text-indigo-300' : 'bg-gradient-to-br from-indigo-100 to-purple-100 border-indigo-200/50 text-indigo-600'}`}>
                                <ShoppingCart className="w-6 h-6" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <DialogTitle className={`text-xl md:text-2xl font-black tracking-tight ${isDark ? 'text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400' : 'text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-600'}`}>
                                        {selectedItem || checkoutMode ? 'Complete Purchase' : 'Bank Store'}
                                    </DialogTitle>
                                    {!isOnline && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600'}`}>
                                            Offline
                                        </span>
                                    )}
                                </div>
                                <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm md:text-base font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    <span className="min-w-0 max-w-full truncate">
                                        {checkoutMode
                                            ? `Checking out ${cartItems.length} item${cartItems.length > 1 ? 's' : ''} for PHP ${cartTotal.toLocaleString()}`
                                            : selectedItem
                                                ? `Purchasing: ${selectedItem.bank.title}`
                                                : 'Discover sampler banks and download them'}
                                    </span>
                                    {!isOnline && offlineSnapshotTime && (
                                        <span className="text-xs opacity-80 shrink-0">
                                            Last updated {new Date(offlineSnapshotTime).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <DialogDescription className="sr-only">
                            Browse store banks, review payment instructions, and submit purchase requests.
                        </DialogDescription>
                    </DialogHeader>
                    {isAdmin && (
                        <OnlineStoreDebugPanel
                            isDark={isDark}
                            entries={downloadDebugEntries}
                            debugText={downloadDebugText}
                            onClear={clearDownloadDebugLog}
                            onCopy={copyDownloadDebugLog}
                            onExport={exportDownloadDebugLog}
                        />
                    )}

                    <div ref={dialogScrollRef} className="flex-1 overflow-y-auto p-6 scroll-smooth">
                        {loading && !selectedItem && !checkoutMode && !purchaseReceipt ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                            </div>
                        ) : purchaseReceipt ? (
                            <div className="max-w-xl mx-auto py-4">
                                <PaymentReceiptCard
                                    theme={theme}
                                    title="Payment Success"
                                    status={purchaseReceipt.status || 'pending'}
                                    statusLabel={purchaseReceipt.statusLabel || 'Pending Approval'}
                                    subtitle={purchaseReceipt.message}
                                    amountLabel="Total Payment"
                                    amountValue={purchaseReceipt.amountText}
                                    lineItems={[
                                        { label: 'Payment for', value: `${purchaseReceipt.itemCount} bank${purchaseReceipt.itemCount > 1 ? 's' : ''}` },
                                        { label: 'VDJV Receipt No', value: purchaseReceipt.receiptNo, copyValue: purchaseReceipt.receiptNo },
                                        { label: 'Payment Reference', value: purchaseReceipt.paymentReference, copyValue: purchaseReceipt.paymentReference },
                                        { label: 'Submitted', value: new Date(purchaseReceipt.submittedAt).toLocaleString() },
                                    ]}
                                    receiptFileName={`bank-store-receipt-${new Date(purchaseReceipt.submittedAt).toISOString().replace(/[:.]/g, '-')}.png`}
                                    primaryAction={{
                                        label: 'Done',
                                        onClick: () => {
                                            setPurchaseReceipt(null);
                                            onOpenChange(false);
                                        },
                                    }}
                                    secondaryAction={paymentConfig?.messenger_url
                                        ? {
                                            label: 'Message us on Facebook',
                                            onClick: () => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer'),
                                        }
                                        : undefined}
                                />
                            </div>
                        ) : storeMaintenance.enabled && !isAdmin ? (
                            <div className="max-w-2xl mx-auto py-8">
                                <div className={`rounded-2xl border p-6 sm:p-8 text-center space-y-4 ${isDark ? 'border-amber-500/40 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                                        <AlertCircle className="w-7 h-7" />
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Bank Store is under maintenance</h3>
                                        <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                            {storeMaintenance.message || 'Browsing, downloads, and new store requests are temporarily unavailable. Please try again later.'}
                                        </p>
                                    </div>
                                    <div className={`text-xs ${isDark ? 'text-amber-200/80' : 'text-amber-700'}`}>
                                        Your already imported local banks remain usable while maintenance is active.
                                    </div>
                                </div>
                            </div>
                        ) : selectedItem || checkoutMode ? (
                            <OnlineStorePurchasePane
                                isDark={isDark}
                                checkoutMode={checkoutMode}
                                cartItems={cartItems}
                                cartTotal={cartTotal}
                                selectedItem={selectedItem}
                                paymentConfig={paymentConfig}
                                setExpandedQrUrl={setExpandedQrUrl}
                                downloadQrImage={downloadQrImage}
                                handlePurchaseSubmit={handlePurchaseSubmit}
                                formChannel={formChannel}
                                setFormChannel={setFormChannel}
                                formName={formName}
                                setFormName={setFormName}
                                formRef={formRef}
                                setFormRef={setFormRef}
                                proofOcrLoading={proofOcrLoading}
                                proofPreviewUrl={proofPreviewUrl}
                                formProofFile={formProofFile}
                                handleProofUpload={handleProofUpload}
                                submitLoading={submitLoading}
                                setFormProofFile={setFormProofFile}
                                formNotes={formNotes}
                                setFormNotes={setFormNotes}
                                onCancel={() => { setSelectedItem(null); setCheckoutMode(false); }}
                            />
                        ) : (
                            <div className="space-y-6">
                                {activeBanner && (
                                    <div className={`group relative rounded-2xl border overflow-hidden transition-all duration-500 shadow-xl ${isDark ? 'border-white/10 bg-gray-900/50 shadow-black/50' : 'border-gray-200/80 bg-white/80 shadow-indigo-900/5'}`}>
                                        <div className="relative overflow-hidden aspect-[16/6] sm:aspect-[21/6]">
                                            {activeBanner.link_url ? (
                                                <button
                                                    type="button"
                                                    onClick={() => window.open(activeBanner.link_url || '', '_blank', 'noopener,noreferrer')}
                                                    className="block w-full h-full text-left"
                                                >
                                                    <img src={activeBanner.image_url} alt="Store banner" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
                                                </button>
                                            ) : (
                                                <img src={activeBanner.image_url} alt="Store banner" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
                                            )}

                                            {banners.length > 1 && (
                                                <>
                                                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                                    <div className="absolute inset-x-0 bottom-3 px-4 flex items-center justify-between gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); goToPrevBanner(); }}
                                                            className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-white hover:bg-black/50 hover:scale-110 transition-all shadow-lg"
                                                            aria-label="Previous banner"
                                                        >
                                                            <ChevronLeft className="w-4 h-4" />
                                                        </Button>
                                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 backdrop-blur-md border border-white/10 shadow-lg">
                                                            {banners.map((banner, index) => (
                                                                <button
                                                                    key={banner.id}
                                                                    type="button"
                                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBannerIndex(index); }}
                                                                    className={`h-1.5 rounded-full transition-all duration-300 ${index === bannerIndex
                                                                        ? 'w-4 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                                                                        : 'w-1.5 bg-white/50 hover:bg-white/80'
                                                                        }`}
                                                                    aria-label={`Show banner ${index + 1}`}
                                                                />
                                                            ))}
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); goToNextBanner(); }}
                                                            className="w-8 h-8 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-white hover:bg-black/50 hover:scale-110 transition-all shadow-lg"
                                                            aria-label="Next banner"
                                                        >
                                                            <ChevronRight className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {/* Search + Sort Bar */}
                                <div className="space-y-3">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <div className="relative flex-1 min-w-0 group">
                                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500/50 group-focus-within:text-indigo-500 transition-colors" />
                                            <Input value={storeSearch} onChange={e => { setStoreSearch(e.target.value); setStorePage(1); }} placeholder="Discover amazing sound banks..." className={`pl-10 h-10 text-sm rounded-xl transition-all duration-200 border ${isDark ? 'bg-gray-800/40 border-white/5 focus-visible:bg-gray-800/80 focus-visible:border-indigo-500/50 focus-visible:ring-1 focus-visible:ring-indigo-500/30' : 'bg-gray-50/50 border-gray-200/80 focus-visible:bg-white focus-visible:border-indigo-400 focus-visible:ring-1 focus-visible:ring-indigo-400/30'}`} />
                                        </div>
                                        <div className="relative w-full sm:w-[200px]">
                                            <select value={storeSort} onChange={e => { setStoreSort(e.target.value as any); setStorePage(1); }} className={`appearance-none h-10 w-full rounded-xl border px-4 pr-10 text-sm outline-none transition-all duration-200 cursor-pointer ${isDark ? 'bg-gray-800/40 border-white/5 hover:bg-gray-800/80 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 text-white' : 'bg-gray-50/50 border-gray-200/80 hover:bg-white focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 text-gray-900'}`}>
                                                <option value="default">Default Sorting</option>
                                                <option value="name_asc">Name (A-Z)</option>
                                                <option value="name_desc">Name (Z-A)</option>
                                                <option value="price_low">Price (Low to High)</option>
                                                <option value="price_high">Price (High to Low)</option>
                                                <option value="free_download">Free Downloads</option>
                                                <option value="purchased">My Purchases</option>
                                                <option value="downloaded">Downloaded Only</option>
                                            </select>
                                            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 pointer-events-none" />
                                        </div>
                                    </div>

                                </div>
                                {displayedItems.length === 0 ? (
                                    <div className={`text-center py-20 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                        <p className="text-lg font-medium">{storeSearch ? 'No matching items' : 'No items available'}</p>
                                        <p className="text-sm mt-1">{storeSearch ? 'Try a different search.' : 'Check back later for new banks.'}</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                                            {displayedItems.map((item) => (
                                                <div key={item.id} className={`group relative h-[160px] sm:h-[180px] flex flex-col rounded-2xl border transition-all duration-300 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 ${isDark ? 'border-white/5 bg-gray-800/30 hover:border-indigo-500/40 hover:bg-gray-800/50' : 'border-gray-200 hover:border-indigo-300 hover:shadow-indigo-900/10 bg-white'}`}>
                                                    <div className="absolute inset-0 overflow-hidden">
                                                        {item.thumbnail_path ? (
                                                            <div
                                                                className="absolute inset-0 bg-cover bg-left transition-transform duration-700 ease-out group-hover:scale-110"
                                                                style={{ backgroundImage: `url(${item.thumbnail_path})` }}
                                                            />
                                                        ) : (
                                                            <div
                                                                className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-110"
                                                                style={{ backgroundColor: item.bank.color || '#3b82f6' }}
                                                            />
                                                        )}
                                                        <div className="absolute inset-0 mix-blend-multiply opacity-40 transition-opacity duration-300 group-hover:opacity-60" style={{ backgroundColor: item.bank.color || '#1e1b4b' }} />
                                                        <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/40 to-black/95 transition-opacity duration-300 group-hover:via-black/50 group-hover:to-black" />
                                                    </div>
                                                    {/* Flash Sale Top Banner */}
                                                    {item.has_active_promotion && item.promotion_type === 'flash_sale' && item.promotion_ends_at && !(item.status === 'granted_download' || importedOrDownloadedBankIds.has(item.bank_id)) && (
                                                        <div className="relative z-20 shrink-0 bg-gradient-to-r from-rose-600/90 to-rose-500/90 backdrop-blur-md border-b border-rose-400/30 px-3 py-1.5 flex items-center justify-between text-[10px] sm:text-[11px] font-bold text-white tracking-wide shadow-lg">
                                                            <div className="flex items-center gap-1.5 shrink-0 uppercase tracking-wider">
                                                                <Timer className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-pulse" />
                                                                <span className="hidden sm:inline">{item.promotion_badge || 'Flash Sale'}</span>
                                                                <span className="sm:hidden">Sale</span>
                                                            </div>
                                                            <span className="truncate ml-2 text-right opacity-95 text-[9px] sm:text-[10px]">Ends {new Date(item.promotion_ends_at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                                                        </div>
                                                    )}
                                                    {/* Transfer Progress Overlay */}
                                                    {(transfers[item.id]?.phase === 'downloading' || transfers[item.id]?.phase === 'importing') && (
                                                        <div className="absolute inset-y-0 left-0 bg-indigo-500/25 pointer-events-none transition-all duration-300 z-0 backdrop-blur-[1px]" style={{ width: `${normalizeProgress(transfers[item.id].progress)}%` }} />
                                                    )}
                                                    {/* Info */}
                                                    <div className="flex-1 p-4 pb-2 relative z-10 flex flex-col justify-end pointer-events-none">
                                                        {(() => {
                                                            const ownsItem = item.status === 'granted_download' || importedOrDownloadedBankIds.has(item.bank_id);
                                                            return (
                                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                                    <h3 className="font-bold text-base sm:text-lg leading-tight line-clamp-2 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" title={item.bank.title}>
                                                                        {item.bank.title}
                                                                    </h3>
                                                                    <div className="flex flex-col gap-1 items-end shrink-0">
                                                                        {item.is_pinned && (
                                                                            <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold uppercase tracking-wider bg-black/40 backdrop-blur-md text-amber-300 border border-amber-400/30 shadow-lg">
                                                                                Pinned
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                        <p className="text-xs sm:text-sm mt-1 line-clamp-2 text-gray-300/90 drop-shadow-md leading-relaxed" title={item.bank.description || 'No description available.'}>
                                                            {item.bank.description || 'No description available.'}
                                                        </p>
                                                    </div>

                                                    {/* Bottom: Footer with Price & Actions */}
                                                    <div className="p-4 pt-3 flex items-center justify-between mt-auto relative z-10 border-t border-white/10 bg-black/20 backdrop-blur-sm">
                                                        {/* Price */}
                                                        {!isGuest && item.status === 'buy' ? (
                                                            <div className="text-sm font-semibold min-w-0 flex-1 mr-2 text-white">
                                                                {renderCatalogPrice(item)}
                                                            </div>
                                                        ) : importedOrDownloadedBankIds.has(item.bank_id) ? (
                                                            <span
                                                                className="inline-flex items-center h-6 px-2 text-[10px] rounded-md font-bold uppercase tracking-wide bg-cyan-600/20 text-cyan-200 border border-cyan-300/30"
                                                                title="This bank is already imported on this device."
                                                            >
                                                                Imported
                                                            </span>
                                                        ) : !isGuest && item.status === 'free_download' ? (
                                                            <span className="inline-flex items-center h-6 px-2 text-[10px] rounded-md font-bold uppercase tracking-wide bg-green-600/20 text-green-200 border border-green-300/30">
                                                                FREE DOWNLOAD
                                                            </span>
                                                        ) : !isGuest && item.status === 'granted_download' ? (
                                                            <span className="inline-flex items-center h-6 px-2 text-[10px] rounded-md font-bold uppercase tracking-wide bg-blue-600/20 text-blue-200 border border-blue-300/30">
                                                                PURCHASED
                                                            </span>
                                                        ) : <div />}

                                                        {/* Action Button(s) */}
                                                        <div className="shrink-0 flex gap-2">
                                                            {isGuest && (item.status === 'free_download' || item.status === 'granted_download' || item.status === 'buy') ? (
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        requestLogin();
                                                                    }}
                                                                    disabled={!isOnline}
                                                                    className="h-8 px-4 text-xs font-medium rounded-full disabled:opacity-50 bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.2)] hover:shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-all"
                                                                >
                                                                    Get
                                                                </Button>
                                                            ) : (item.status === 'free_download' || item.status === 'granted_download') ? (
                                                                importedOrDownloadedBankIds.has(item.bank_id) ? (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => {
                                                                            if ((runtimeBankIdsBySource?.[item.bank_id] || []).length <= 0) return;
                                                                            setRefreshAssetsItem(item);
                                                                        }}
                                                                        disabled={(runtimeBankIdsBySource?.[item.bank_id] || []).length <= 0 || transfers[item.id]?.phase === 'downloading' || transfers[item.id]?.phase === 'importing'}
                                                                        className={`h-8 px-3 text-xs rounded-full font-medium border backdrop-blur-sm ${isDark ? 'bg-cyan-500/10 text-cyan-300 border-cyan-400/30 hover:bg-cyan-500/20' : 'bg-cyan-50/80 text-cyan-700 border-cyan-200 hover:bg-cyan-100'}`}
                                                                        title={(runtimeBankIdsBySource?.[item.bank_id] || []).length > 0 ? 'Redownload official bank assets without changing your edits.' : 'This bank is not currently available on this device.'}
                                                                    >
                                                                        <RotateCcw className="w-3.5 h-3.5 mr-1" />Redownload
                                                                    </Button>
                                                                ) : transfers[item.id]?.phase === 'error' ? (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => handleDownload(item)}
                                                                        disabled={!isOnline}
                                                                        className="h-8 px-3 text-xs font-medium rounded-full bg-red-500/90 hover:bg-red-500 text-white border-0 disabled:opacity-50 shadow-lg"
                                                                        title={transfers[item.id].error}
                                                                    >
                                                                        <RotateCcw className="w-3.5 h-3.5 mr-1" />Try Again
                                                                    </Button>
                                                                ) : transfers[item.id]?.phase === 'downloading' ? (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => cancelDownload(item.id)}
                                                                        className="h-8 px-3 text-xs font-medium rounded-full bg-rose-500/90 hover:bg-rose-500 text-white border-0 shadow-lg"
                                                                    >
                                                                        <X className="w-3.5 h-3.5 mr-1" />Cancel {normalizeProgress(transfers[item.id].progress)}%
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => handleDownload(item)}
                                                                        disabled={!isOnline || transfers[item.id]?.phase === 'importing'}
                                                                        className={`h-8 transition-all text-xs font-medium rounded-full text-white border-0 disabled:opacity-50 shadow-lg ${transfers[item.id] ? 'bg-indigo-600 px-4' : 'bg-green-500 hover:bg-green-400 px-3'
                                                                            }`}
                                                                    >
                                                                        {transfers[item.id]?.phase === 'downloading' || transfers[item.id]?.phase === 'importing' ? (
                                                                            <span className="flex items-center gap-1 w-[72px] justify-center text-center">
                                                                                {transfers[item.id].phase === 'importing' ? 'Importing ' : ''}
                                                                                {normalizeProgress(transfers[item.id].progress)}%
                                                                            </span>
                                                                        ) : (
                                                                            <><Download className="w-3.5 h-3.5 mr-1" />Download</>
                                                                        )}
                                                                    </Button>
                                                                )
                                                            ) : item.status === 'pending' ? (
                                                                <span className={`inline-flex items-center h-8 px-3 text-xs rounded-full font-medium border backdrop-blur-sm ${isDark ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-orange-50 text-orange-600 border-orange-200'}`}>
                                                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Under Review
                                                                </span>
                                                            ) : item.status === 'rejected' ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => setRejectedOverlay({ item })}
                                                                    className={`h-8 px-3 text-xs rounded-full font-medium backdrop-blur-sm ${isDark ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20' : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'}`}
                                                                >
                                                                    <AlertCircle className="w-3.5 h-3.5 mr-1" />Not Approved
                                                                </Button>
                                                            ) : (
                                                                <>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            if (!effectiveUser) { requestLogin(); return; }
                                                                            setCartItemIds(prev => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
                                                                        }}
                                                                        disabled={!isOnline}
                                                                        className={`h-8 px-3 text-xs rounded-full font-medium disabled:opacity-50 transition-colors backdrop-blur-sm ${cartItemIds.has(item.id) ? (isDark ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-indigo-50 border-indigo-300 text-indigo-600') : (isDark ? 'border-white/20 text-gray-300 hover:bg-white/10 hover:text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100')}`}
                                                                    >
                                                                        {cartItemIds.has(item.id) ? <Check className="w-3.5 h-3.5 mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                                                                        {cartItemIds.has(item.id) ? 'Added' : 'Cart'}
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => {
                                                                            if (!effectiveUser) { requestLogin(); return; }
                                                                            setSelectedItem(item);
                                                                        }}
                                                                        disabled={!isOnline}
                                                                        className={`h-8 px-4 text-xs font-semibold rounded-full disabled:opacity-50 shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-all ${isDark ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-0' : 'bg-indigo-600 hover:bg-indigo-700 text-white border-0'}`}
                                                                    >
                                                                        Buy
                                                                    </Button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {/* Pagination */}
                                        {effectiveTotalPages > 1 && (
                                            <div className="flex items-center justify-center gap-4 pt-6 pb-2">
                                                <Button size="sm" variant="outline" disabled={storePage <= 1} onClick={() => setStorePage(p => p - 1)} className={`h-9 w-9 p-0 rounded-full transition-colors ${isDark ? 'border-white/10 text-gray-300 hover:bg-white/10 hover:text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                    <ChevronLeft className="w-4 h-4" />
                                                </Button>
                                                <span className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                                    Page <span className={`text-base mx-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{storePage}</span> of {effectiveTotalPages}
                                                </span>
                                                <Button size="sm" variant="outline" disabled={storePage >= effectiveTotalPages} onClick={() => setStorePage(p => p + 1)} className={`h-9 w-9 p-0 rounded-full transition-colors ${isDark ? 'border-white/10 text-gray-300 hover:bg-white/10 hover:text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                    <ChevronRight className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Cart Bar */}
                    {effectiveUser && cartItemIds.size > 0 && !selectedItem && !checkoutMode && !storeMaintenance.enabled && (
                        <OnlineStoreCartBar
                            isDark={isDark}
                            itemCount={cartItemIds.size}
                            cartItems={cartItems}
                            cartTotal={cartTotal}
                            cartViewOpen={cartViewOpen}
                            onToggleCartView={() => setCartViewOpen((v) => !v)}
                            onCloseCartView={() => setCartViewOpen(false)}
                            onRemoveItem={(itemId) => setCartItemIds((prev) => {
                                const next = new Set(prev);
                                next.delete(itemId);
                                return next;
                            })}
                            onClearCart={() => setCartItemIds(new Set())}
                            onCheckout={() => {
                                if (!effectiveUser) { requestLogin(); return; }
                                setCheckoutMode(true);
                            }}
                        />
                    )}

                    {expandedQrUrl && (
                        <div className="absolute inset-0 z-[75] flex items-center justify-center bg-black/75 p-4" onClick={() => setExpandedQrUrl(null)}>
                            <div className="max-w-[95vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                                <img src={expandedQrUrl} alt="Expanded payment QR" className="max-w-[90vw] max-h-[78vh] rounded-xl border bg-white p-2" />
                                <div className="mt-2 flex justify-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="bg-white text-gray-900 border-gray-300 hover:bg-gray-100"
                                        onClick={() => void downloadQrImage(expandedQrUrl)}
                                    >
                                        <Download className="w-3.5 h-3.5 mr-1" />Download QR
                                    </Button>
                                    <Button type="button" size="sm" onClick={() => setExpandedQrUrl(null)}>
                                        Close
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    <Dialog
                        open={Boolean(refreshAssetsItem)}
                        onOpenChange={(nextOpen) => {
                            if (!nextOpen) setRefreshAssetsItem(null);
                        }}
                        useHistory={false}
                    >
                        <DialogContent
                            overlayClassName="z-[159]"
                            className="z-[160] sm:max-w-md"
                            aria-describedby={undefined}
                        >
                            <DialogHeader>
                                <DialogTitle>Redownload Bank Assets?</DialogTitle>
                                <DialogDescription>
                                    Refresh the official audio, image, and thumbnail assets for this bank without changing your saved edits, custom pads, or metadata.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 text-sm">
                                <p className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                                    {refreshAssetsItem
                                        ? `This refreshes official assets for "${refreshAssetsItem.bank.title}" on this device, including duplicate paid banks and linked paid pads when they match this store bank.`
                                        : 'Refresh official bank assets on this device.'}
                                </p>
                                <div className="grid grid-cols-1 gap-2">
                                    <Button
                                        onClick={async () => {
                                            if (!refreshAssetsItem) return;
                                            const targetBankIds = runtimeBankIdsBySource?.[refreshAssetsItem.bank_id] || [];
                                            const targetBankId = targetBankIds[0] || null;
                                            if (!targetBankId) {
                                                showToast('This bank is not currently available on this device.', 'error');
                                                setRefreshAssetsItem(null);
                                                return;
                                            }
                                            const nextItem: StoreItem = {
                                                ...refreshAssetsItem,
                                                snapshot_target_bank_id: targetBankId,
                                            };
                                            setRefreshAssetsItem(null);
                                            await handleDownload(nextItem, {
                                                preferCachedImportRetry: false,
                                                refreshAssetsOnly: true,
                                            });
                                        }}
                                    >
                                        Redownload Assets
                                    </Button>
                                    <Button variant="ghost" onClick={() => setRefreshAssetsItem(null)}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {rejectedOverlay && (
                        <OnlineStoreRejectedOverlay
                            isDark={isDark}
                            item={rejectedOverlay.item}
                            isOnline={isOnline}
                            onClose={() => setRejectedOverlay(null)}
                            onRetry={() => handleRetry(rejectedOverlay.item)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
