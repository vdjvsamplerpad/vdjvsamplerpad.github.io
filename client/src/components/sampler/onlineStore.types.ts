export interface StoreItem {
    id: string; // catalog item id
    bank_id: string;
    is_paid: boolean;
    requires_grant: boolean;
    is_pinned?: boolean;
    is_owned?: boolean;
    is_free_download?: boolean;
    is_pending?: boolean;
    is_rejected?: boolean;
    is_downloadable?: boolean;
    is_purchased?: boolean;
    price_php: number | null;
    sha256?: string | null;
    thumbnail_path?: string | null;
    status: 'free_download' | 'buy' | 'pending' | 'granted_download' | 'rejected';
    rejection_message?: string | null;
    bank: {
        title: string;
        description: string;
        color: string;
    };
}

export interface StoreBanner {
    id: string;
    image_url: string;
    link_url: string | null;
    sort_order: number;
    is_active: boolean;
}

export interface PaymentConfig {
    instructions?: string;
    gcash_number?: string;
    maya_number?: string;
    messenger_url?: string;
    qr_image_path?: string;
    account_price_php?: number | null;
    banner_rotation_ms?: number | null;
}

export type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual';

export type TransferState = {
    phase: 'idle' | 'downloading' | 'importing' | 'success' | 'error';
    progress: number;
    message?: string;
    error?: string;
    errorStage?: 'download' | 'checksum' | 'import';
    startedAt: number;
    updatedAt: number
};

export type StoreDownloadedArtifact = {
    blob: Blob;
    fileName: string;
    savedAt: number;
    sha256?: string | null;
};

export type StoreDownloadDebugLevel = 'info' | 'error';

export type StoreDownloadDebugEntry = {
    id: number;
    ts: number;
    level: StoreDownloadDebugLevel;
    event: string;
    details?: Record<string, unknown>;
};

export const STORE_DOWNLOAD_DEBUG_MAX_ENTRIES = 250;

export type StoreSnapshot = {
    version: 1 | 2 | 3 | 4 | 5;
    userKey: string;
    savedAt: number;
    queryKey?: string;
    items: StoreItem[];
    paymentConfig: PaymentConfig | null;
    banners?: StoreBanner[];
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
};

export type StoreCatalogMeta = {
    durationMs?: number;
    strategy?: string;
    snapshotAgeMs?: number;
    snapshotFresh?: boolean;
    itemCount?: number;
    total?: number | null;
};

export type OnlineBankStoreImportMeta = {
    bankId: string;
    bankName: string;
    catalogItemId: string;
    catalogSha256?: string;
    thumbnailUrl?: string;
    derivedKey?: string;
    entitlementToken?: string;
    entitlementTokenKid?: string;
    entitlementTokenIssuedAt?: string;
    entitlementTokenExpiresAt?: string;
};

export type PurchaseReceiptState = {
    amountText: string;
    itemCount: number;
    submittedAt: string;
    receiptNo: string;
    paymentReference: string;
    message: string;
    status?: 'success' | 'pending';
    statusLabel?: string;
};
