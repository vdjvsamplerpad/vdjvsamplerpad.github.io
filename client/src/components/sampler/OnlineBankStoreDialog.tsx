import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PaymentReceiptCard } from '@/components/ui/payment-receipt-card';
import { OnlineStoreDebugPanel } from '@/components/sampler/OnlineStoreDebugPanel';
import { OnlineStoreCartBar } from '@/components/sampler/OnlineStoreCartBar';
import { OnlineStorePurchasePane } from '@/components/sampler/OnlineStorePurchasePane';
import { OnlineStoreRejectedOverlay } from '@/components/sampler/OnlineStoreRejectedOverlay';
import { Loader2, Download, ShoppingCart, LockIcon, ExternalLink, Check, X, ChevronLeft, ChevronRight, Search, Plus, AlertCircle, RotateCcw } from 'lucide-react';
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

export function OnlineBankStoreDialog({ open, onOpenChange, theme, importedBankIds, runtimeBankIdsBySource, onImportBankFromStore }: OnlineBankStoreDialogProps) {
    const { user, profile } = useAuth();
    const effectiveUser = user || getCachedUser();
    const effectiveUserId = effectiveUser?.id || null;
    const isGuest = !effectiveUser;
    const isAdmin = profile?.role === 'admin';

    const [loading, setLoading] = React.useState(false);
    const [items, setItems] = React.useState<StoreItem[]>([]);
    const [paymentConfig, setPaymentConfig] = React.useState<PaymentConfig | null>(null);
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
                    className={`!left-[50%] !top-[50%] !translate-x-[-50%] !translate-y-[-50%] fixed z-[120] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0 ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
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
                    <DialogHeader className={`p-6 border-b shrink-0 ${isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-white/50'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg shrink-0 ${isDark ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
                                <ShoppingCart className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <DialogTitle className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {selectedItem || checkoutMode ? 'Complete Purchase' : 'Bank Store'}
                                    </DialogTitle>
                                    {!isOnline && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600'}`}>
                                            Offline
                                        </span>
                                    )}
                                </div>
                                <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    <span className="min-w-0 max-w-full truncate">
                                        {checkoutMode
                                            ? `Checking out ${cartItems.length} item${cartItems.length > 1 ? 's' : ''} for PHP ${cartTotal.toLocaleString()}`
                                            : selectedItem
                                                ? `Purchasing: ${selectedItem.bank.title}`
                                                : 'Discover premium sound banks and import them straight into your grid.'}
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
                                        { label: 'VDJV Receipt No', value: purchaseReceipt.receiptNo },
                                        { label: 'Payment Reference', value: purchaseReceipt.paymentReference },
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
                            <div className="space-y-4">
                                {activeBanner && (
                                    <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'}`}>
                                        <div className="relative">
                                            {activeBanner.link_url ? (
                                                <button
                                                    type="button"
                                                    onClick={() => window.open(activeBanner.link_url || '', '_blank', 'noopener,noreferrer')}
                                                    className="block w-full text-left"
                                                >
                                                    <img src={activeBanner.image_url} alt="Store banner" className="w-full aspect-[16/5] object-cover" />
                                                </button>
                                            ) : (
                                                <img src={activeBanner.image_url} alt="Store banner" className="w-full aspect-[16/5] object-cover" />
                                            )}
                                            {banners.length > 1 && (
                                                <div className="absolute inset-x-0 bottom-2 px-2 flex items-center justify-between gap-2">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={goToPrevBanner}
                                                        className={`h-7 px-2 text-xs ${isDark ? 'bg-black/50 border-gray-600 text-gray-100 hover:bg-black/70' : 'bg-white/90 border-gray-200'}`}
                                                    >
                                                        <ChevronLeft className="w-3.5 h-3.5" />
                                                    </Button>
                                                    <div className="flex items-center gap-1.5">
                                                        {banners.map((banner, index) => (
                                                            <button
                                                                key={banner.id}
                                                                type="button"
                                                                onClick={() => setBannerIndex(index)}
                                                                className={`w-2.5 h-2.5 rounded-full border transition-all ${index === bannerIndex
                                                                    ? (isDark ? 'bg-white border-white' : 'bg-indigo-600 border-indigo-600')
                                                                    : (isDark ? 'bg-black/45 border-gray-400' : 'bg-white/80 border-gray-300')
                                                                    }`}
                                                                aria-label={`Show banner ${index + 1}`}
                                                            />
                                                        ))}
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={goToNextBanner}
                                                        className={`h-7 px-2 text-xs ${isDark ? 'bg-black/50 border-gray-600 text-gray-100 hover:bg-black/70' : 'bg-white/90 border-gray-200'}`}
                                                    >
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {/* Search + Sort Bar */}
                                <div className="space-y-2">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <div className="relative flex-1 min-w-0">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
                                            <Input value={storeSearch} onChange={e => { setStoreSearch(e.target.value); setStorePage(1); }} placeholder="Search banks..." className={`pl-8 h-9 text-sm ${isDark ? 'bg-gray-800 border-gray-700' : ''}`} />
                                        </div>
                                        <select value={storeSort} onChange={e => { setStoreSort(e.target.value as any); setStorePage(1); }} className={`h-9 rounded-md border px-3 text-sm outline-none sm:w-[190px] ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300'}`}>
                                            <option value="default">Default</option>
                                            <option value="name_asc">Name A-Z</option>
                                            <option value="name_desc">Name Z-A</option>
                                            <option value="price_low">Price: Low to High</option>
                                            <option value="price_high">Price: High to Low</option>
                                            <option value="free_download">Free Download</option>
                                            <option value="purchased">Purchased</option>
                                            <option value="downloaded">Downloaded</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        {paymentConfig?.messenger_url && (
                                            <div className="w-full sm:w-auto sm:ml-auto">
                                                <a
                                                    href={paymentConfig.messenger_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={`h-8 inline-flex items-center justify-center gap-1.5 px-2.5 rounded-md border text-xs font-semibold transition-colors w-full sm:w-auto ${
                                                        isDark
                                                            ? 'border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25'
                                                            : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                                    }`}
                                                >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    Message us on Facebook
                                                </a>
                                                <div className={`mt-1 text-[11px] text-center sm:text-right ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                                                    {effectiveTotalItems.toLocaleString()} item{effectiveTotalItems === 1 ? '' : 's'}
                                                </div>
                                            </div>
                                        )}
                                        {!paymentConfig?.messenger_url && (
                                            <div className={`text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                                                {effectiveTotalItems.toLocaleString()} item{effectiveTotalItems === 1 ? '' : 's'}
                                            </div>
                                        )}
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
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {displayedItems.map((item) => (
                                                <div key={item.id} className={`relative h-36 flex flex-col rounded-xl border transition-all duration-150 overflow-hidden ${isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}>
                                                    <div className="absolute inset-0">
                                                        {item.thumbnail_path ? (
                                                            <div
                                                                className="absolute inset-0 bg-cover bg-center"
                                                                style={{ backgroundImage: `url(${item.thumbnail_path})` }}
                                                            />
                                                        ) : (
                                                            <div
                                                                className="absolute inset-0"
                                                                style={{ backgroundColor: item.bank.color || '#3b82f6' }}
                                                            />
                                                        )}
                                                        <div className="absolute inset-0" style={{ backgroundColor: item.bank.color || '#3b82f6', opacity: 0.45 }} />
                                                        <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-black/45 to-black/85" />
                                                    </div>
                                                    {/* Transfer Progress Overlay */}
                                                    {(transfers[item.id]?.phase === 'downloading' || transfers[item.id]?.phase === 'importing') && (
                                                        <div className="absolute inset-y-0 left-0 bg-indigo-400/20 pointer-events-none transition-all duration-300 z-0" style={{ width: `${normalizeProgress(transfers[item.id].progress)}%` }} />
                                                    )}
                                                    {/* Info */}
                                                    <div className="flex-1 p-2.5 pb-1.5 relative z-10">
                                                        <div className="flex items-center gap-1.5">
                                                            <h3 className="font-bold text-sm leading-tight truncate text-white" title={item.bank.title}>
                                                                {item.bank.title}
                                                            </h3>
                                                            {item.is_pinned && (
                                                                <span className="inline-flex items-center h-4 px-1.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-400/20 text-amber-100 border border-amber-200/30">
                                                                    Pinned
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs mt-1 line-clamp-2 text-gray-200/95" title={item.bank.description || 'No description available yet.'}>
                                                            {item.bank.description || 'No description available yet.'}
                                                        </p>
                                                    </div>

                                                    {/* Bottom: Footer with Price & Actions */}
                                                    <div className="p-2.5 pt-1.5 flex items-center justify-between mt-auto relative z-10 border-t border-white/15">
                                                        {/* Price */}
                                                        {!isGuest && item.status === 'buy' ? (
                                                            <div className="text-sm font-semibold shrink-0 text-white">
                                                                {item.price_php === null ? <span className="text-amber-300 text-sm">Price to be announced</span> : <span>PHP {item.price_php.toLocaleString()}</span>}
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
                                                                    className="h-7 px-2.5 text-xs disabled:opacity-50 bg-indigo-600 hover:bg-indigo-500 text-white"
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
                                                                        className={`h-7 px-2.5 text-xs rounded-md font-medium border ${isDark ? 'bg-cyan-500/10 text-cyan-300 border-cyan-400/30 hover:bg-cyan-500/20' : 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100'}`}
                                                                        title={(runtimeBankIdsBySource?.[item.bank_id] || []).length > 0 ? 'Redownload official bank assets without changing your edits.' : 'This bank is not currently available on this device.'}
                                                                    >
                                                                        <RotateCcw className="w-3 h-3 mr-1" />Redownload
                                                                    </Button>
                                                                ) : transfers[item.id]?.phase === 'error' ? (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => handleDownload(item)}
                                                                        disabled={!isOnline}
                                                                        className="h-7 px-2.5 text-xs bg-red-600 hover:bg-red-700 text-white border-0 disabled:opacity-50"
                                                                        title={transfers[item.id].error}
                                                                    >
                                                                        <RotateCcw className="w-3.5 h-3.5 mr-1" />Try Again
                                                                    </Button>
                                                                ) : transfers[item.id]?.phase === 'downloading' ? (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => cancelDownload(item.id)}
                                                                        className="h-7 px-2.5 text-xs bg-rose-600 hover:bg-rose-700 text-white border-0"
                                                                    >
                                                                        <X className="w-3.5 h-3.5 mr-1" />Cancel {normalizeProgress(transfers[item.id].progress)}%
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => handleDownload(item)}
                                                                        disabled={!isOnline || transfers[item.id]?.phase === 'importing'}
                                                                        className={`h-7 transition-all text-xs font-medium text-white border-0 disabled:opacity-50 relative overflow-hidden ${transfers[item.id] ? 'bg-indigo-600 px-3' : 'bg-green-600 hover:bg-green-700 px-2.5'
                                                                            }`}
                                                                    >
                                                                        {transfers[item.id]?.phase === 'downloading' || transfers[item.id]?.phase === 'importing' ? (
                                                                            <span className="flex items-center gap-1 w-[68px] justify-center text-center">
                                                                                {transfers[item.id].phase === 'importing' ? 'Importing ' : ''}
                                                                                {normalizeProgress(transfers[item.id].progress)}%
                                                                            </span>
                                                                        ) : (
                                                                            <><Download className="w-3.5 h-3.5 mr-1" />Download</>
                                                                        )}
                                                                    </Button>
                                                                )
                                                            ) : item.status === 'pending' ? (
                                                                <span className={`inline-flex items-center h-7 px-2.5 text-xs rounded-md font-medium ${isDark ? 'bg-orange-500/10 text-orange-400' : 'bg-orange-50 text-orange-600'}`}>
                                                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />Under Review
                                                                </span>
                                                            ) : item.status === 'rejected' ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => setRejectedOverlay({ item })}
                                                                    className={`h-7 px-2.5 text-xs ${isDark ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20' : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'}`}
                                                                >
                                                                    <AlertCircle className="w-3 h-3 mr-1" />Not Approved
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
                                                                        className={`h-7 px-2 text-xs disabled:opacity-50 ${cartItemIds.has(item.id) ? (isDark ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'bg-indigo-50 border-indigo-300 text-indigo-600') : (isDark ? 'border-gray-600 text-gray-300' : '')}`}
                                                                    >
                                                                        {cartItemIds.has(item.id) ? <Check className="w-3 h-3 mr-0.5" /> : <Plus className="w-3 h-3 mr-0.5" />}
                                                                        {cartItemIds.has(item.id) ? 'Added' : 'Add to Cart'}
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => {
                                                                            if (!effectiveUser) { requestLogin(); return; }
                                                                            setSelectedItem(item);
                                                                        }}
                                                                        disabled={!isOnline}
                                                                        className={`h-7 px-2.5 text-xs disabled:opacity-50 ${isDark ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
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
                                            <div className="flex items-center justify-center gap-3 pt-2">
                                                <Button size="sm" variant="outline" disabled={storePage <= 1} onClick={() => setStorePage(p => p - 1)} className={`h-7 px-2 ${isDark ? 'border-gray-700' : ''}`}>
                                                    <ChevronLeft className="w-3.5 h-3.5" />
                                                </Button>
                                                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Page {storePage} of {effectiveTotalPages}</span>
                                                <Button size="sm" variant="outline" disabled={storePage >= effectiveTotalPages} onClick={() => setStorePage(p => p + 1)} className={`h-7 px-2 ${isDark ? 'border-gray-700' : ''}`}>
                                                    <ChevronRight className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Cart Bar */}
                    {effectiveUser && cartItemIds.size > 0 && !selectedItem && !checkoutMode && (
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
