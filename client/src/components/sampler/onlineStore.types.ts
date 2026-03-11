export interface StoreItem {
    id: string; // catalog item id
    bank_id: string;
    snapshot_target_bank_id?: string | null;
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
    original_price_php?: number | null;
    discount_amount_php?: number | null;
    promotion_id?: string | null;
    promotion_name?: string | null;
    promotion_badge?: string | null;
    promotion_type?: 'standard' | 'flash_sale' | null;
    promotion_starts_at?: string | null;
    promotion_ends_at?: string | null;
    has_active_promotion?: boolean;
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
    store_maintenance_enabled?: boolean;
    store_maintenance_message?: string | null;
}

export type StoreMaintenanceState = {
    enabled: boolean;
    message: string | null;
};

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
    version: 1 | 2 | 3 | 4 | 5 | 6;
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
    maintenance?: StoreMaintenanceState | null;
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
    targetBankId?: string;
    refreshAssetsOnly?: boolean;
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

export interface StorePromotionTargetLabel {
    type: 'bank' | 'catalog';
    id: string;
    label: string;
}

export interface StorePromotion {
    id: string;
    name: string;
    description?: string | null;
    promotion_type: 'standard' | 'flash_sale';
    discount_type: 'percent' | 'fixed';
    discount_value: number;
    starts_at: string;
    ends_at: string;
    timezone: string;
    badge_text?: string | null;
    priority: number;
    is_active: boolean;
    status: 'inactive' | 'scheduled' | 'active' | 'expired';
    target_bank_ids: string[];
    target_catalog_item_ids: string[];
    target_labels: StorePromotionTargetLabel[];
}
