import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { prepareManagedImageUpload } from '@/lib/image-upload';
import {
  PAGE_SIZE,
  isValidHttpUrl,
  type CatalogDraft,
  type PurchaseRequest,
  type StoreCatalogSort,
  type StoreConfigDraft,
  type StoreMarketingBanner,
  type StorePromotion,
  type TabKey,
  validateStoreBannerFile,
  validateStoreQrFile,
} from './AdminAccessDialog.shared';

type Notice = {
  variant: 'success' | 'error' | 'info';
  message: string;
};

type PushNotice = (notice: Notice) => void;

interface UseAdminAccessStoreManagerParams {
  open: boolean;
  isAdmin: boolean;
  tab: TabKey;
  pushNotice: PushNotice;
}

interface BatchedRequest {
  id: string;
  batch_id?: string;
  bankNames: string[];
  bankItems: Array<{ title: string; isPaid: boolean; pricePhp: number | null }>;
  user_id: string;
  user_profile?: { display_name: string; email: string } | null;
  status: PurchaseRequest['status'];
  payment_channel: string;
  payer_name: string;
  reference_no: string;
  notes: string;
  proof_path?: string;
  rejection_message?: string;
  decision_email_status?: PurchaseRequest['decision_email_status'];
  decision_email_error?: string | null;
  ocr_reference_no?: string | null;
  ocr_payer_name?: string | null;
  ocr_amount_php?: number | null;
  ocr_recipient_number?: string | null;
  ocr_provider?: string | null;
  ocr_scanned_at?: string | null;
  ocr_status?: PurchaseRequest['ocr_status'];
  ocr_error_code?: string | null;
  decision_source?: PurchaseRequest['decision_source'];
  automation_result?: string | null;
  created_at: string;
  count: number;
  totalAmountPhp: number;
  hasTbdAmount: boolean;
}

const normalizeBannerForCompare = (banner: StoreMarketingBanner) => ({
  image_url: String(banner.image_url || '').trim(),
  link_url: banner.link_url ? String(banner.link_url).trim() : null,
  sort_order: Math.max(0, Math.floor(Number(banner.sort_order || 0))),
  is_active: Boolean(banner.is_active),
});

const areBannersEquivalent = (left: StoreMarketingBanner | null | undefined, right: StoreMarketingBanner | null | undefined): boolean => {
  if (!left || !right) return false;
  const leftNormalized = normalizeBannerForCompare(left);
  const rightNormalized = normalizeBannerForCompare(right);
  return leftNormalized.image_url === rightNormalized.image_url
    && leftNormalized.link_url === rightNormalized.link_url
    && leftNormalized.sort_order === rightNormalized.sort_order
    && leftNormalized.is_active === rightNormalized.is_active;
};

const EMPTY_STORE_CONFIG: StoreConfigDraft = {
  instructions: '',
  gcash_number: '',
  maya_number: '',
  messenger_url: '',
  qr_image_path: '',
  account_price_php: '',
  banner_rotation_ms: '5000',
  store_maintenance_enabled: false,
  store_maintenance_message: '',
  account_auto_approve_enabled: false,
  account_auto_approve_mode: 'schedule',
  account_auto_approve_start_hour: '0',
  account_auto_approve_end_hour: '0',
  account_auto_approve_duration_hours: '24',
  account_auto_approve_expires_at: null,
  store_auto_approve_enabled: false,
  store_auto_approve_mode: 'schedule',
  store_auto_approve_start_hour: '0',
  store_auto_approve_end_hour: '0',
  store_auto_approve_duration_hours: '24',
  store_auto_approve_expires_at: null,
  store_email_approve_subject: '',
  store_email_approve_body: '',
  store_email_reject_subject: '',
  store_email_reject_body: '',
};

type StorePromotionForm = {
  name: string;
  description: string;
  promotion_type: 'standard' | 'flash_sale';
  discount_type: 'percent' | 'fixed';
  discount_value: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  badge_text: string;
  priority: string;
  is_active: boolean;
  target_bank_ids: string[];
};

const EMPTY_STORE_PROMOTION_FORM: StorePromotionForm = {
  name: '',
  description: '',
  promotion_type: 'flash_sale',
  discount_type: 'percent',
  discount_value: '10',
  starts_at: '',
  ends_at: '',
  timezone: 'Asia/Manila',
  badge_text: '',
  priority: '100',
  is_active: true,
  target_bank_ids: [],
};

const toDateTimeLocalValue = (value: string | null | undefined): string => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const adjusted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60 * 1000);
  return adjusted.toISOString().slice(0, 16);
};

export function useAdminAccessStoreManager({
  open,
  isAdmin,
  tab,
  pushNotice,
}: UseAdminAccessStoreManagerParams) {
  const [storeRequestFilter, setStoreRequestFilter] = React.useState<'pending' | 'history'>('pending');
  const [storeLoading, setStoreLoading] = React.useState(false);
  const [storeRequests, setStoreRequests] = React.useState<PurchaseRequest[]>([]);
  const [storeDrafts, setStoreDrafts] = React.useState<CatalogDraft[]>([]);
  const [storePromotions, setStorePromotions] = React.useState<StorePromotion[]>([]);
  const [storeBanners, setStoreBanners] = React.useState<StoreMarketingBanner[]>([]);
  const [loadedStoreBanners, setLoadedStoreBanners] = React.useState<StoreMarketingBanner[]>([]);
  const [bannerLoading, setBannerLoading] = React.useState(false);
  const [newBannerImageFile, setNewBannerImageFile] = React.useState<File | null>(null);
  const [newBannerImageUrl, setNewBannerImageUrl] = React.useState('');
  const [newBannerLinkUrl, setNewBannerLinkUrl] = React.useState('');
  const [newBannerSortOrder, setNewBannerSortOrder] = React.useState('0');
  const [showInactiveBanners, setShowInactiveBanners] = React.useState(false);
  const [bannerUploadingIds, setBannerUploadingIds] = React.useState<Set<string>>(new Set());
  const [newBannerPreviewUrl, setNewBannerPreviewUrl] = React.useState<string | null>(null);
  const [storePublishDialog, setStorePublishDialog] = React.useState<{
    open: boolean;
    draft: CatalogDraft | null;
  }>({ open: false, draft: null });
  const [storeRequestToReject, setStoreRequestToReject] = React.useState<{ id: string; message: string } | null>(null);
  const [storeConfig, setStoreConfig] = React.useState<StoreConfigDraft>(EMPTY_STORE_CONFIG);
  const [storeQrFile, setStoreQrFile] = React.useState<File | null>(null);
  const [storeQrPreviewUrl, setStoreQrPreviewUrl] = React.useState<string | null>(null);
  const [expandedStoreRequestId, setExpandedStoreRequestId] = React.useState<string | null>(null);
  const [storeReqPage, setStoreReqPage] = React.useState(1);
  const [storeReqSearch, setStoreReqSearch] = React.useState('');
  const [storeCatalogPage, setStoreCatalogPage] = React.useState(1);
  const [storeCatalogSearch, setStoreCatalogSearch] = React.useState('');
  const [storeCatalogBankFilter, setStoreCatalogBankFilter] = React.useState('all');
  const [storeCatalogStatusFilter, setStoreCatalogStatusFilter] = React.useState<'all' | 'published' | 'draft'>('all');
  const [storeCatalogPaidFilter, setStoreCatalogPaidFilter] = React.useState<'all' | 'paid' | 'free'>('all');
  const [storeCatalogPinnedFilter, setStoreCatalogPinnedFilter] = React.useState<'all' | 'pinned' | 'unpinned'>('all');
  const [storeCatalogSort, setStoreCatalogSort] = React.useState<StoreCatalogSort>('pinned_first');
  const [storePromotionForm, setStorePromotionForm] = React.useState(EMPTY_STORE_PROMOTION_FORM);
  const [editingPromotionId, setEditingPromotionId] = React.useState<string | null>(null);

  const storeAuthFetch = React.useCallback(async (url: string, options: RequestInit = {}) => {
    const normalized = url.replace(/^\/api\//, '');
    const baseUrl = edgeFunctionUrl('store-api', normalized);
    const { supabase } = await import('@/lib/supabase');
    const session = await supabase.auth.getSession();
    const headers = new Headers(options.headers || {});
    if (session.data.session?.access_token) headers.set('Authorization', `Bearer ${session.data.session.access_token}`);
    return fetch(baseUrl, { ...options, headers });
  }, []);

  React.useEffect(() => {
    if (!storeQrFile) {
      setStoreQrPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(storeQrFile);
    setStoreQrPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [storeQrFile]);

  React.useEffect(() => {
    if (!newBannerImageFile) {
      setNewBannerPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(newBannerImageFile);
    setNewBannerPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [newBannerImageFile]);

  const loadStoreRequests = React.useCallback(async () => {
    setStoreLoading(true);
    try {
      const res = await storeAuthFetch('/api/admin/store/requests');
      if (res.ok) {
        const data = await res.json();
        setStoreRequests(data.requests || []);
        setExpandedStoreRequestId(null);
      }
    } catch {
      pushNotice({ variant: 'error', message: 'Could not load requests. Check your connection and try again.' });
    }
    setStoreLoading(false);
  }, [pushNotice, storeAuthFetch]);

  const loadStoreCatalog = React.useCallback(async () => {
    setStoreLoading(true);
    try {
      const res = await storeAuthFetch('/api/admin/store/catalog');
      if (res.ok) {
        const data = await res.json();
        setStoreDrafts(Array.isArray(data.items) ? data.items : []);
        const nextBanners = Array.isArray(data.banners)
          ? data.banners.map((row: any) => ({
            id: String(row?.id || ''),
            image_url: String(row?.image_url || ''),
            link_url: row?.link_url ? String(row.link_url) : null,
            sort_order: Number.isFinite(Number(row?.sort_order)) ? Math.max(0, Math.floor(Number(row.sort_order))) : 0,
            is_active: Boolean(row?.is_active),
            created_at: row?.created_at ? String(row.created_at) : undefined,
            updated_at: row?.updated_at ? String(row.updated_at) : undefined,
          }))
          : [];
        setStoreBanners(nextBanners);
        setLoadedStoreBanners(nextBanners);
      }
    } catch {
      pushNotice({ variant: 'error', message: 'Could not load catalog data. Please try again.' });
    }
    setStoreLoading(false);
  }, [pushNotice, storeAuthFetch]);

  const loadStorePromotions = React.useCallback(async () => {
    setStoreLoading(true);
    try {
      const res = await storeAuthFetch('/api/admin/store/promotions');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => ({} as any));
      setStorePromotions(Array.isArray(data.promotions) ? data.promotions : []);
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not load store promotions.' });
    } finally {
      setStoreLoading(false);
    }
  }, [pushNotice, storeAuthFetch]);

  const loadStoreConfig = React.useCallback(async () => {
    setStoreLoading(true);
    try {
      const res = await storeAuthFetch('/api/admin/store/config');
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          const rawAccountPrice = data.config.account_price_php;
          const normalizedAccountPrice = typeof rawAccountPrice === 'number' && Number.isFinite(rawAccountPrice)
            ? String(rawAccountPrice)
            : '';
          setStoreConfig({
            instructions: data.config.instructions || '',
            gcash_number: data.config.gcash_number || '',
            maya_number: data.config.maya_number || '',
            messenger_url: data.config.messenger_url || '',
            qr_image_path: data.config.qr_image_path || '',
            account_price_php: normalizedAccountPrice,
            banner_rotation_ms: typeof data.config.banner_rotation_ms === 'number' && Number.isFinite(data.config.banner_rotation_ms)
              ? String(Math.max(3000, Math.min(15000, Math.floor(data.config.banner_rotation_ms))))
              : '5000',
            store_maintenance_enabled: Boolean(data.config.store_maintenance_enabled),
            store_maintenance_message: data.config.store_maintenance_message || '',
            account_auto_approve_enabled: Boolean(data.config.account_auto_approve_enabled),
            account_auto_approve_mode: data.config.account_auto_approve_mode === 'countdown'
              ? 'countdown'
              : data.config.account_auto_approve_mode === 'always'
                ? 'always'
                : 'schedule',
            account_auto_approve_start_hour: String(
              Number.isFinite(Number(data.config.account_auto_approve_start_hour))
                ? Math.max(0, Math.min(23, Math.floor(Number(data.config.account_auto_approve_start_hour))))
                : 0,
            ),
            account_auto_approve_end_hour: String(
              Number.isFinite(Number(data.config.account_auto_approve_end_hour))
                ? Math.max(0, Math.min(23, Math.floor(Number(data.config.account_auto_approve_end_hour))))
                : 0,
            ),
            account_auto_approve_duration_hours: String(
              Number.isFinite(Number(data.config.account_auto_approve_duration_hours))
                ? Math.max(1, Math.min(168, Math.floor(Number(data.config.account_auto_approve_duration_hours))))
                : 24,
            ),
            account_auto_approve_expires_at: data.config.account_auto_approve_expires_at ? String(data.config.account_auto_approve_expires_at) : null,
            store_auto_approve_enabled: Boolean(data.config.store_auto_approve_enabled),
            store_auto_approve_mode: data.config.store_auto_approve_mode === 'countdown'
              ? 'countdown'
              : data.config.store_auto_approve_mode === 'always'
                ? 'always'
                : 'schedule',
            store_auto_approve_start_hour: String(
              Number.isFinite(Number(data.config.store_auto_approve_start_hour))
                ? Math.max(0, Math.min(23, Math.floor(Number(data.config.store_auto_approve_start_hour))))
                : 0,
            ),
            store_auto_approve_end_hour: String(
              Number.isFinite(Number(data.config.store_auto_approve_end_hour))
                ? Math.max(0, Math.min(23, Math.floor(Number(data.config.store_auto_approve_end_hour))))
                : 0,
            ),
            store_auto_approve_duration_hours: String(
              Number.isFinite(Number(data.config.store_auto_approve_duration_hours))
                ? Math.max(1, Math.min(168, Math.floor(Number(data.config.store_auto_approve_duration_hours))))
                : 24,
            ),
            store_auto_approve_expires_at: data.config.store_auto_approve_expires_at ? String(data.config.store_auto_approve_expires_at) : null,
            store_email_approve_subject: data.config.store_email_approve_subject || '',
            store_email_approve_body: data.config.store_email_approve_body || '',
            store_email_reject_subject: data.config.store_email_reject_subject || '',
            store_email_reject_body: data.config.store_email_reject_body || '',
          });
          setStoreQrFile(null);
        } else {
          setStoreConfig(EMPTY_STORE_CONFIG);
        }
      }
    } catch {
      pushNotice({ variant: 'error', message: 'Could not load payment configuration. Please try again.' });
    }
    setStoreLoading(false);
  }, [pushNotice, storeAuthFetch]);

  React.useEffect(() => {
    if (!open || !isAdmin) return;
    if (tab === 'store_requests') void loadStoreRequests();
    if (tab === 'store_catalog' || tab === 'store_banners') void loadStoreCatalog();
    if (tab === 'store_promotions') {
      void loadStoreCatalog();
      void loadStorePromotions();
    }
    if (tab === 'store_catalog' || tab === 'store_config') void loadStoreConfig();
  }, [isAdmin, loadStoreCatalog, loadStoreConfig, loadStorePromotions, loadStoreRequests, open, tab]);

  const handleStoreRequestAction = React.useCallback(async (id: string, action: 'approve' | 'reject', rejectionMessage?: string) => {
    setStoreLoading(true);
    try {
      const body: Record<string, any> = { action };
      if (action === 'reject' && rejectionMessage) body.rejection_message = rejectionMessage;
      const res = await storeAuthFetch(`/api/admin/store/requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({} as any));
        if (data?.decision_email_status === 'failed') {
          pushNotice({
            variant: 'info',
            message: data?.decision_email_error
              ? `Request updated, but email failed: ${data.decision_email_error}`
              : 'Request updated, but decision email failed to send.',
          });
        } else if (data?.decision_email_status === 'sent') {
          pushNotice({ variant: 'success', message: 'Request updated and decision email sent.' });
        } else {
          pushNotice({ variant: 'success', message: 'Request updated successfully.' });
        }
        await loadStoreRequests();
      } else {
        const text = await res.text();
        pushNotice({ variant: 'error', message: `Request update failed. Please try again. (${text})` });
      }
    } catch {
      pushNotice({ variant: 'error', message: 'Network error updating request' });
    }
    setStoreLoading(false);
  }, [loadStoreRequests, pushNotice, storeAuthFetch]);

  const handleStoreRequestRetryEmail = React.useCallback(async (id: string) => {
    setStoreLoading(true);
    try {
      const res = await storeAuthFetch(`/api/admin/store/requests/${id}/retry-email`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Retry email failed');
      }
      const data = await res.json().catch(() => ({} as any));
      if (data?.decision_email_status === 'sent') {
        pushNotice({ variant: 'success', message: 'Store decision email sent.' });
      } else if (data?.decision_email_status === 'failed') {
        pushNotice({
          variant: 'error',
          message: data?.decision_email_error
            ? `Store retry email failed: ${data.decision_email_error}`
            : 'Store retry email failed.',
        });
      } else {
        pushNotice({ variant: 'info', message: 'Store retry email skipped.' });
      }
      await loadStoreRequests();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Network error retrying store decision email' });
    } finally {
      setStoreLoading(false);
    }
  }, [loadStoreRequests, pushNotice, storeAuthFetch]);

  const handleStoreCatalogUpdate = React.useCallback(async (id: string, updates: Record<string, any>) => {
    try {
      const res = await storeAuthFetch(`/api/admin/store/catalog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        pushNotice({ variant: 'success', message: 'Catalog item updated!' });
        void loadStoreCatalog();
      } else {
        const text = await res.text();
        pushNotice({ variant: 'error', message: `Update could not be saved. Please try again. (${text})` });
      }
    } catch {
      pushNotice({ variant: 'error', message: 'Network error updating catalog' });
    }
  }, [loadStoreCatalog, pushNotice, storeAuthFetch]);

  const resetStorePromotionForm = React.useCallback(() => {
    setEditingPromotionId(null);
    setStorePromotionForm(EMPTY_STORE_PROMOTION_FORM);
  }, []);

  const editStorePromotion = React.useCallback((promotion: StorePromotion) => {
    setEditingPromotionId(promotion.id);
    setStorePromotionForm({
      name: promotion.name || '',
      description: promotion.description || '',
      promotion_type: promotion.promotion_type,
      discount_type: promotion.discount_type,
      discount_value: String(promotion.discount_value ?? ''),
      starts_at: toDateTimeLocalValue(promotion.starts_at),
      ends_at: toDateTimeLocalValue(promotion.ends_at),
      timezone: promotion.timezone || 'Asia/Manila',
      badge_text: promotion.badge_text || '',
      priority: String(promotion.priority ?? 100),
      is_active: Boolean(promotion.is_active),
      target_bank_ids: [...(promotion.target_bank_ids || [])],
    });
  }, []);

  const persistStorePromotion = React.useCallback(async () => {
    const payload = {
      name: storePromotionForm.name.trim(),
      description: storePromotionForm.description.trim() || null,
      promotion_type: storePromotionForm.promotion_type,
      discount_type: storePromotionForm.discount_type,
      discount_value: Number(storePromotionForm.discount_value),
      starts_at: storePromotionForm.starts_at ? new Date(storePromotionForm.starts_at).toISOString() : null,
      ends_at: storePromotionForm.ends_at ? new Date(storePromotionForm.ends_at).toISOString() : null,
      timezone: storePromotionForm.timezone.trim() || 'Asia/Manila',
      badge_text: storePromotionForm.badge_text.trim() || null,
      priority: Number(storePromotionForm.priority),
      is_active: Boolean(storePromotionForm.is_active),
      target_bank_ids: storePromotionForm.target_bank_ids,
    };
    if (!payload.name) {
      pushNotice({ variant: 'error', message: 'Promotion name is required.' });
      return false;
    }
    if (!payload.starts_at || !payload.ends_at) {
      pushNotice({ variant: 'error', message: 'Start and end dates are required.' });
      return false;
    }
    if (!Number.isFinite(payload.discount_value) || payload.discount_value <= 0) {
      pushNotice({ variant: 'error', message: 'Discount value must be greater than zero.' });
      return false;
    }
    if (!Number.isFinite(payload.priority) || payload.priority < 0) {
      pushNotice({ variant: 'error', message: 'Priority must be zero or greater.' });
      return false;
    }
    if (payload.target_bank_ids.length === 0) {
      pushNotice({ variant: 'error', message: 'Select at least one target bank.' });
      return false;
    }

    setStoreLoading(true);
    try {
      const route = editingPromotionId
        ? `/api/admin/store/promotions/${editingPromotionId}`
        : '/api/admin/store/promotions';
      const method = editingPromotionId ? 'PATCH' : 'POST';
      const res = await storeAuthFetch(route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => ({} as any));
      setStorePromotions(Array.isArray(data.promotions) ? data.promotions : []);
      pushNotice({ variant: 'success', message: editingPromotionId ? 'Promotion updated.' : 'Promotion created.' });
      resetStorePromotionForm();
      return true;
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Promotion could not be saved.' });
      return false;
    } finally {
      setStoreLoading(false);
    }
  }, [editingPromotionId, pushNotice, resetStorePromotionForm, storeAuthFetch, storePromotionForm]);

  const deleteStorePromotion = React.useCallback(async (promotionId: string) => {
    setStoreLoading(true);
    try {
      const res = await storeAuthFetch(`/api/admin/store/promotions/${promotionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setStorePromotions((prev) => prev.filter((promotion) => promotion.id !== promotionId));
      if (editingPromotionId === promotionId) resetStorePromotionForm();
      pushNotice({ variant: 'success', message: 'Promotion deleted.' });
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Promotion could not be deleted.' });
    } finally {
      setStoreLoading(false);
    }
  }, [editingPromotionId, pushNotice, resetStorePromotionForm, storeAuthFetch]);

  const uploadStoreBannerImage = React.useCallback(async (file: File): Promise<string> => {
    const { supabase } = await import('@/lib/supabase');
    const preparedFile = await prepareManagedImageUpload(file, 'banner');
    const ext = String(preparedFile.name.split('.').pop() || 'webp').toLowerCase();
    const fileName = `store-banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('store-assets').upload(fileName, preparedFile, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('store-assets').getPublicUrl(fileName);
    const publicUrl = String(data?.publicUrl || '').trim();
    if (!publicUrl) throw new Error('Failed to resolve public URL for banner image.');
    return publicUrl;
  }, []);

  const handleNewBannerImageChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setNewBannerImageFile(null);
      return;
    }
    const validationError = validateStoreBannerFile(file);
    if (validationError) {
      pushNotice({ variant: 'error', message: validationError });
      event.target.value = '';
      return;
    }
    setNewBannerImageFile(file);
  }, [pushNotice]);

  const updateBannerDraft = React.useCallback((id: string, updates: Partial<StoreMarketingBanner>) => {
    setStoreBanners((prev) => prev.map((banner) => (banner.id === id ? { ...banner, ...updates } : banner)));
  }, []);

  const resetBannerDraft = React.useCallback((id: string) => {
    setStoreBanners((prev) => {
      const source = loadedStoreBanners.find((banner) => banner.id === id);
      if (!source) return prev;
      return prev.map((banner) => (banner.id === id ? { ...source } : banner));
    });
  }, [loadedStoreBanners]);

  const nudgeBannerSortOrder = React.useCallback((id: string, delta: -1 | 1) => {
    setStoreBanners((prev) => prev.map((banner) => {
      if (banner.id !== id) return banner;
      const nextSortOrder = Math.max(0, Math.floor(Number(banner.sort_order || 0)) + delta);
      return { ...banner, sort_order: nextSortOrder };
    }));
  }, []);

  const handleStoreBannerImageReplace = React.useCallback(async (bannerId: string, file: File) => {
    const validationError = validateStoreBannerFile(file);
    if (validationError) {
      pushNotice({ variant: 'error', message: validationError });
      return;
    }
    setBannerUploadingIds((prev) => new Set(prev).add(bannerId));
    try {
      const imageUrl = await uploadStoreBannerImage(file);
      updateBannerDraft(bannerId, { image_url: imageUrl });
      pushNotice({ variant: 'success', message: 'Banner image uploaded. Click Save to apply changes.' });
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not upload banner image.' });
    } finally {
      setBannerUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(bannerId);
        return next;
      });
    }
  }, [pushNotice, updateBannerDraft, uploadStoreBannerImage]);

  const handleCreateStoreBanner = React.useCallback(async () => {
    const linkTrimmed = String(newBannerLinkUrl || '').trim();
    const sortOrderValue = Math.max(0, Math.floor(Number(newBannerSortOrder || 0)));
    if (!Number.isFinite(sortOrderValue)) {
      pushNotice({ variant: 'error', message: 'Sort order must be a non-negative number.' });
      return;
    }
    if (linkTrimmed && !isValidHttpUrl(linkTrimmed)) {
      pushNotice({ variant: 'error', message: 'Banner link must be a valid http(s) URL.' });
      return;
    }
    let finalImageUrl = String(newBannerImageUrl || '').trim();
    if (newBannerImageFile) {
      const validationError = validateStoreBannerFile(newBannerImageFile);
      if (validationError) {
        pushNotice({ variant: 'error', message: validationError });
        return;
      }
    }
    if (!newBannerImageFile && !isValidHttpUrl(finalImageUrl)) {
      pushNotice({ variant: 'error', message: 'Provide a valid banner image URL or upload an image file.' });
      return;
    }
    setBannerLoading(true);
    try {
      if (newBannerImageFile) finalImageUrl = await uploadStoreBannerImage(newBannerImageFile);
      const res = await storeAuthFetch('/api/admin/store/banners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: finalImageUrl,
          link_url: linkTrimmed || null,
          sort_order: sortOrderValue,
          is_active: true,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create banner');
      }
      pushNotice({ variant: 'success', message: 'Marketing banner created.' });
      setNewBannerImageFile(null);
      setNewBannerImageUrl('');
      setNewBannerLinkUrl('');
      setNewBannerSortOrder('0');
      await loadStoreCatalog();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not create marketing banner.' });
    } finally {
      setBannerLoading(false);
    }
  }, [loadStoreCatalog, newBannerImageFile, newBannerImageUrl, newBannerLinkUrl, newBannerSortOrder, pushNotice, storeAuthFetch, uploadStoreBannerImage]);

  const handleSaveStoreBanner = React.useCallback(async (banner: StoreMarketingBanner) => {
    const linkTrimmed = String(banner.link_url || '').trim();
    const sortOrder = Math.max(0, Math.floor(Number(banner.sort_order || 0)));
    if (linkTrimmed && !isValidHttpUrl(linkTrimmed)) {
      pushNotice({ variant: 'error', message: 'Banner link must be a valid http(s) URL.' });
      return;
    }
    if (!isValidHttpUrl(String(banner.image_url || '').trim())) {
      pushNotice({ variant: 'error', message: 'Banner image URL must be a valid http(s) URL.' });
      return;
    }
    setBannerLoading(true);
    try {
      const res = await storeAuthFetch(`/api/admin/store/banners/${banner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: String(banner.image_url || '').trim(),
          link_url: linkTrimmed || null,
          sort_order: sortOrder,
          is_active: Boolean(banner.is_active),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to update banner');
      }
      const data = await res.json().catch(() => null);
      pushNotice({ variant: 'success', message: 'Marketing banner updated.' });
      if (data?.cleanup_warning) {
        pushNotice({ variant: 'info', message: `Banner updated, but old image cleanup failed: ${data.cleanup_warning}` });
      }
      await loadStoreCatalog();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not update banner.' });
    } finally {
      setBannerLoading(false);
    }
  }, [loadStoreCatalog, pushNotice, storeAuthFetch]);

  const handleDeleteStoreBanner = React.useCallback(async (banner: StoreMarketingBanner) => {
    if (banner.is_active) {
      pushNotice({ variant: 'error', message: 'Only inactive banners can be deleted.' });
      return;
    }
    setBannerLoading(true);
    try {
      const res = await storeAuthFetch(`/api/admin/store/banners/${banner.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete banner');
      }
      const data = await res.json().catch(() => null);
      pushNotice({ variant: 'success', message: 'Inactive banner deleted.' });
      if (data?.cleanup_warning) {
        pushNotice({ variant: 'info', message: `Banner deleted, but image cleanup failed: ${data.cleanup_warning}` });
      }
      await loadStoreCatalog();
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not delete banner.' });
    } finally {
      setBannerLoading(false);
    }
  }, [loadStoreCatalog, pushNotice, storeAuthFetch]);

  const showStorePublishDialog = React.useCallback((draft: CatalogDraft) => {
    setStorePublishDialog({ open: true, draft });
  }, []);

  const executeStorePublish = React.useCallback(async () => {
    const { draft } = storePublishDialog;
    if (!draft) return;
    setStorePublishDialog({ open: false, draft: null });
    setStoreLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const res = await supabase.functions.invoke(`admin-api/store/catalog/${draft.id}/publish`, {
        method: 'POST',
        body: { asset_name: draft.expected_asset_name },
      });
      if (res.error) {
        let errMsg = res.error.message;
        try {
          if (res.error.context && typeof res.error.context === 'object') {
            const parsed = await (res.error.context as any)?.json?.();
            if (parsed?.error) errMsg = parsed.error;
          }
        } catch {}
        pushNotice({ variant: 'error', message: `Could not publish this item. (${errMsg})` });
      } else {
        pushNotice({ variant: 'success', message: 'Catalog item published!' });
        void loadStoreCatalog();
      }
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Could not publish due to an unexpected issue.' });
    }
    setStoreLoading(false);
  }, [loadStoreCatalog, pushNotice, storePublishDialog]);

  const handleStoreQrFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateStoreQrFile(file);
    if (validationError) {
      pushNotice({ variant: 'error', message: validationError });
      event.target.value = '';
      return;
    }
    setStoreQrFile(file);
  }, [pushNotice]);

  const validateStoreConfigDraft = React.useCallback((config: StoreConfigDraft) => {
    const rawAccountPrice = String(config.account_price_php || '').trim();
    if (rawAccountPrice) {
      const parsed = Number(rawAccountPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('Account Price must be a non-negative number.');
      }
    }
    const rawBannerRotation = String(config.banner_rotation_ms || '').trim();
    const parsedBannerRotation = Number(rawBannerRotation);
    if (!rawBannerRotation || !Number.isFinite(parsedBannerRotation) || parsedBannerRotation < 3000 || parsedBannerRotation > 15000) {
      throw new Error('Banner Rotation must be between 3000 and 15000 milliseconds.');
    }
    const hourFields = [
      ['Account Auto Approval Start Hour', config.account_auto_approve_start_hour],
      ['Account Auto Approval End Hour', config.account_auto_approve_end_hour],
      ['Store Auto Approval Start Hour', config.store_auto_approve_start_hour],
      ['Store Auto Approval End Hour', config.store_auto_approve_end_hour],
    ] as const;
    for (const [label, value] of hourFields) {
      const parsed = Number(String(value || '').trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
        throw new Error(`${label} must be between 0 and 23.`);
      }
    }
    const durationFields = [
      ['Account Auto Approval Duration', config.account_auto_approve_duration_hours],
      ['Store Auto Approval Duration', config.store_auto_approve_duration_hours],
    ] as const;
    for (const [label, value] of durationFields) {
      const parsed = Number(String(value || '').trim());
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) {
        throw new Error(`${label} must be between 1 and 168 hours.`);
      }
    }
  }, []);

  const validateStoreAutomationDraft = React.useCallback((target: 'account' | 'store', config: StoreConfigDraft) => {
    if (target === 'account') {
      if (config.account_auto_approve_mode === 'schedule') {
        const hourFields = [
          ['Account Auto Approval Start Hour', config.account_auto_approve_start_hour],
          ['Account Auto Approval End Hour', config.account_auto_approve_end_hour],
        ] as const;
        for (const [label, value] of hourFields) {
          const parsed = Number(String(value || '').trim());
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
            throw new Error(`${label} must be between 0 and 23.`);
          }
        }
      } else if (config.account_auto_approve_mode === 'countdown') {
        const parsed = Number(String(config.account_auto_approve_duration_hours || '').trim());
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) {
          throw new Error('Account Auto Approval Duration must be between 1 and 168 hours.');
        }
      }
      return;
    }

    if (config.store_auto_approve_mode === 'schedule') {
      const hourFields = [
        ['Store Auto Approval Start Hour', config.store_auto_approve_start_hour],
        ['Store Auto Approval End Hour', config.store_auto_approve_end_hour],
      ] as const;
      for (const [label, value] of hourFields) {
        const parsed = Number(String(value || '').trim());
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
          throw new Error(`${label} must be between 0 and 23.`);
        }
      }
    } else if (config.store_auto_approve_mode === 'countdown') {
      const parsed = Number(String(config.store_auto_approve_duration_hours || '').trim());
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) {
        throw new Error('Store Auto Approval Duration must be between 1 and 168 hours.');
      }
    }
  }, []);

  const buildStoreConfigPayload = React.useCallback((config: StoreConfigDraft, qrImagePath: string) => {
    const rawAccountPrice = String(config.account_price_php || '').trim();
    const rawBannerRotation = String(config.banner_rotation_ms || '').trim();
    return {
      ...config,
      qr_image_path: qrImagePath,
      account_price_php: rawAccountPrice ? Number(rawAccountPrice) : null,
      banner_rotation_ms: Math.floor(Number(rawBannerRotation)),
      store_maintenance_message: String(config.store_maintenance_message || '').trim(),
      account_auto_approve_start_hour: Math.floor(Number(config.account_auto_approve_start_hour)),
      account_auto_approve_end_hour: Math.floor(Number(config.account_auto_approve_end_hour)),
      account_auto_approve_duration_hours: Math.floor(Number(config.account_auto_approve_duration_hours)),
      store_auto_approve_start_hour: Math.floor(Number(config.store_auto_approve_start_hour)),
      store_auto_approve_end_hour: Math.floor(Number(config.store_auto_approve_end_hour)),
      store_auto_approve_duration_hours: Math.floor(Number(config.store_auto_approve_duration_hours)),
    };
  }, []);

  const persistStoreConfig = React.useCallback(async (
    nextConfig: StoreConfigDraft,
    options?: { successMessage?: string }
  ): Promise<boolean> => {
    try {
      validateStoreConfigDraft(nextConfig);
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Configuration is invalid.' });
      return false;
    }

    setStoreLoading(true);
    let uploadedFileName = '';
    let finalQrPath = nextConfig.qr_image_path;
    try {
      if (storeQrFile) {
        const validationError = validateStoreQrFile(storeQrFile);
        if (validationError) throw new Error(validationError);
        const preparedFile = await prepareManagedImageUpload(storeQrFile, 'qr');
        const { supabase } = await import('@/lib/supabase');
        const ext = preparedFile.name.split('.').pop();
        uploadedFileName = `payment-qr-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('store-assets').upload(uploadedFileName, preparedFile, { upsert: true });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('store-assets').getPublicUrl(uploadedFileName);
        finalQrPath = publicUrl;
      }
      const payload = buildStoreConfigPayload(nextConfig, finalQrPath);
      const res = await storeAuthFetch('/api/admin/store/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Configuration could not be saved.');
      const savedConfig: StoreConfigDraft = {
        ...nextConfig,
        qr_image_path: finalQrPath,
        account_price_php: String(nextConfig.account_price_php || '').trim(),
        banner_rotation_ms: String(Math.floor(Number(nextConfig.banner_rotation_ms))),
        account_auto_approve_start_hour: String(Math.floor(Number(nextConfig.account_auto_approve_start_hour))),
        account_auto_approve_end_hour: String(Math.floor(Number(nextConfig.account_auto_approve_end_hour))),
        account_auto_approve_duration_hours: String(Math.floor(Number(nextConfig.account_auto_approve_duration_hours))),
        store_auto_approve_start_hour: String(Math.floor(Number(nextConfig.store_auto_approve_start_hour))),
        store_auto_approve_end_hour: String(Math.floor(Number(nextConfig.store_auto_approve_end_hour))),
        store_auto_approve_duration_hours: String(Math.floor(Number(nextConfig.store_auto_approve_duration_hours))),
      };
      setStoreConfig({
        ...savedConfig,
      });
      setStoreQrFile(null);
      pushNotice({ variant: 'success', message: options?.successMessage || 'Configuration saved successfully.' });
      return true;
    } catch (err: any) {
      if (uploadedFileName) {
        try {
          const { supabase } = await import('@/lib/supabase');
          await supabase.storage.from('store-assets').remove([uploadedFileName]);
        } catch {}
      }
      pushNotice({ variant: 'error', message: err?.message || 'Network error saving config' });
      return false;
    } finally {
      setStoreLoading(false);
    }
  }, [buildStoreConfigPayload, pushNotice, storeAuthFetch, storeQrFile, validateStoreConfigDraft]);

  const persistStoreAutomationConfig = React.useCallback(async (
    target: 'account' | 'store',
    nextConfig: StoreConfigDraft,
    successMessage: string
  ): Promise<boolean> => {
    try {
      validateStoreAutomationDraft(target, nextConfig);
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Configuration is invalid.' });
      return false;
    }

    const payload = target === 'account'
      ? {
        account_auto_approve_enabled: nextConfig.account_auto_approve_enabled,
        account_auto_approve_mode: nextConfig.account_auto_approve_mode,
        account_auto_approve_start_hour: Math.floor(Number(nextConfig.account_auto_approve_start_hour)),
        account_auto_approve_end_hour: Math.floor(Number(nextConfig.account_auto_approve_end_hour)),
        account_auto_approve_duration_hours: Math.floor(Number(nextConfig.account_auto_approve_duration_hours)),
        account_auto_approve_expires_at: nextConfig.account_auto_approve_expires_at,
      }
      : {
        store_auto_approve_enabled: nextConfig.store_auto_approve_enabled,
        store_auto_approve_mode: nextConfig.store_auto_approve_mode,
        store_auto_approve_start_hour: Math.floor(Number(nextConfig.store_auto_approve_start_hour)),
        store_auto_approve_end_hour: Math.floor(Number(nextConfig.store_auto_approve_end_hour)),
        store_auto_approve_duration_hours: Math.floor(Number(nextConfig.store_auto_approve_duration_hours)),
        store_auto_approve_expires_at: nextConfig.store_auto_approve_expires_at,
      };

    setStoreLoading(true);
    try {
      const res = await storeAuthFetch('/api/admin/store/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Automation settings could not be saved.');
      setStoreConfig(nextConfig);
      pushNotice({ variant: 'success', message: successMessage });
      return true;
    } catch (err: any) {
      pushNotice({ variant: 'error', message: err?.message || 'Network error saving automation settings' });
      return false;
    } finally {
      setStoreLoading(false);
    }
  }, [pushNotice, storeAuthFetch, validateStoreAutomationDraft]);

  const handleStoreConfigSave = React.useCallback(async () => {
    await persistStoreConfig(storeConfig);
  }, [persistStoreConfig, storeConfig]);

  const handleStoreAutoApprovalAction = React.useCallback(async (
    target: 'account' | 'store',
    action: 'start' | 'stop'
  ) => {
    const nextConfig: StoreConfigDraft = { ...storeConfig };
    if (target === 'account') {
      if (action === 'start') {
        nextConfig.account_auto_approve_enabled = true;
        if (nextConfig.account_auto_approve_mode === 'countdown') {
          const hours = Math.max(1, Math.min(168, Math.floor(Number(nextConfig.account_auto_approve_duration_hours || '24'))));
          nextConfig.account_auto_approve_duration_hours = String(hours);
          nextConfig.account_auto_approve_expires_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        } else {
          nextConfig.account_auto_approve_expires_at = null;
        }
      } else {
        nextConfig.account_auto_approve_enabled = false;
        nextConfig.account_auto_approve_expires_at = null;
      }
    } else {
      if (action === 'start') {
        nextConfig.store_auto_approve_enabled = true;
        if (nextConfig.store_auto_approve_mode === 'countdown') {
          const hours = Math.max(1, Math.min(168, Math.floor(Number(nextConfig.store_auto_approve_duration_hours || '24'))));
          nextConfig.store_auto_approve_duration_hours = String(hours);
          nextConfig.store_auto_approve_expires_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        } else {
          nextConfig.store_auto_approve_expires_at = null;
        }
      } else {
        nextConfig.store_auto_approve_enabled = false;
        nextConfig.store_auto_approve_expires_at = null;
      }
    }
    await persistStoreAutomationConfig(
      target,
      nextConfig,
      action === 'start'
        ? `${target === 'account' ? 'Account' : 'Store'} auto approval started.`
        : `${target === 'account' ? 'Account' : 'Store'} auto approval stopped.`
    );
  }, [persistStoreAutomationConfig, storeConfig]);

  const groupedRequests = React.useMemo(() => {
    const filtered = storeRequests.filter((request) => storeRequestFilter === 'pending' ? request.status === 'pending' : request.status !== 'pending');
    const batchMap = new Map<string, PurchaseRequest[]>();
    const noBatchList: PurchaseRequest[] = [];

    filtered.forEach((request) => {
      if (request.batch_id) {
        const list = batchMap.get(request.batch_id) || [];
        list.push(request);
        batchMap.set(request.batch_id, list);
      } else {
        noBatchList.push(request);
      }
    });

    const getItemMeta = (request: PurchaseRequest) => {
      const title = request.bank_catalog_items?.banks?.title || request.banks?.title || 'Unknown Bank';
      const rawPrice = request.bank_catalog_items?.price_php;
      let parsedPrice: number | null = null;
      if (typeof rawPrice === 'number' && Number.isFinite(rawPrice)) {
        parsedPrice = rawPrice;
      } else if (typeof rawPrice === 'string') {
        const cleaned = rawPrice.replace(/[^\d.,-]/g, '');
        const normalized = cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(/,/g, '');
        const asNumber = Number(normalized);
        parsedPrice = Number.isFinite(asNumber) && asNumber >= 0 ? asNumber : null;
      }
      const isPaid = Boolean(request.bank_catalog_items?.is_paid) || (parsedPrice !== null && parsedPrice > 0);
      return { title, isPaid, pricePhp: parsedPrice };
    };

    const result: BatchedRequest[] = [];
    batchMap.forEach((requests) => {
      const first = requests[0];
      const bankItems = requests.map(getItemMeta);
      const hasTbdAmount = bankItems.some((item) => item.isPaid && item.pricePhp === null);
      const totalAmountPhp = bankItems.reduce((sum, item) => sum + (item.isPaid ? (item.pricePhp ?? 0) : 0), 0);
      result.push({
        id: first.id,
        batch_id: first.batch_id,
        bankNames: bankItems.map((item) => item.title),
        bankItems,
        user_id: first.user_id,
        user_profile: first.user_profile,
        status: first.status,
        payment_channel: first.payment_channel,
        payer_name: first.payer_name || '',
        reference_no: first.reference_no || '',
        notes: first.notes || '',
        proof_path: first.proof_path,
        rejection_message: first.rejection_message,
        decision_email_status: first.decision_email_status || null,
        decision_email_error: first.decision_email_error || null,
        ocr_reference_no: first.ocr_reference_no || null,
        ocr_payer_name: first.ocr_payer_name || null,
        ocr_amount_php: typeof first.ocr_amount_php === 'number' ? first.ocr_amount_php : null,
        ocr_recipient_number: first.ocr_recipient_number || null,
        ocr_provider: first.ocr_provider || null,
        ocr_scanned_at: first.ocr_scanned_at || null,
        ocr_status: first.ocr_status || null,
        ocr_error_code: first.ocr_error_code || null,
        decision_source: first.decision_source || null,
        automation_result: first.automation_result || null,
        created_at: first.created_at,
        count: requests.length,
        totalAmountPhp,
        hasTbdAmount,
      });
    });

    noBatchList.forEach((request) => {
      const item = getItemMeta(request);
      result.push({
        id: request.id,
        batch_id: undefined,
        bankNames: [item.title],
        bankItems: [item],
        user_id: request.user_id,
        user_profile: request.user_profile,
        status: request.status,
        payment_channel: request.payment_channel,
        payer_name: request.payer_name || '',
        reference_no: request.reference_no || '',
        notes: request.notes || '',
        proof_path: request.proof_path,
        rejection_message: request.rejection_message,
        decision_email_status: request.decision_email_status || null,
        decision_email_error: request.decision_email_error || null,
        ocr_reference_no: request.ocr_reference_no || null,
        ocr_payer_name: request.ocr_payer_name || null,
        ocr_amount_php: typeof request.ocr_amount_php === 'number' ? request.ocr_amount_php : null,
        ocr_recipient_number: request.ocr_recipient_number || null,
        ocr_provider: request.ocr_provider || null,
        ocr_scanned_at: request.ocr_scanned_at || null,
        ocr_status: request.ocr_status || null,
        ocr_error_code: request.ocr_error_code || null,
        decision_source: request.decision_source || null,
        automation_result: request.automation_result || null,
        created_at: request.created_at,
        count: 1,
        totalAmountPhp: item.isPaid ? (item.pricePhp ?? 0) : 0,
        hasTbdAmount: item.isPaid && item.pricePhp === null,
      });
    });

    result.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    if (storeReqSearch) {
      const query = storeReqSearch.toLowerCase();
      return result.filter((request) =>
        request.bankNames.some((name) => name.toLowerCase().includes(query))
        || request.payer_name.toLowerCase().includes(query)
        || request.reference_no.toLowerCase().includes(query)
        || (request.ocr_reference_no || '').toLowerCase().includes(query)
        || (request.ocr_recipient_number || '').toLowerCase().includes(query)
        || (request.user_profile?.display_name || '').toLowerCase().includes(query)
        || (request.user_profile?.email || '').toLowerCase().includes(query));
    }
    return result;
  }, [storeReqSearch, storeRequestFilter, storeRequests]);

  const reqTotalPages = Math.max(1, Math.ceil(groupedRequests.length / PAGE_SIZE));
  const pagedRequests = groupedRequests.slice((storeReqPage - 1) * PAGE_SIZE, storeReqPage * PAGE_SIZE);

  const catalogBankOptions = React.useMemo(() => {
    const names = new Set<string>();
    storeDrafts.forEach((draft) => {
      const name = String(draft.bank?.title || '').trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [storeDrafts]);

  const filteredDrafts = React.useMemo(() => {
    const query = storeCatalogSearch.trim().toLowerCase();
    const statusRank = (status: CatalogDraft['status']) => {
      if (status === 'published') return 0;
      if (status === 'draft') return 1;
      return 2;
    };
    return storeDrafts
      .filter((draft) => {
        if (query) {
          const title = String(draft.bank?.title || '').toLowerCase();
          const asset = String(draft.expected_asset_name || '').toLowerCase();
          if (!title.includes(query) && !asset.includes(query)) return false;
        }
        if (storeCatalogBankFilter !== 'all' && String(draft.bank?.title || '') !== storeCatalogBankFilter) return false;
        if (storeCatalogStatusFilter !== 'all' && draft.status !== storeCatalogStatusFilter) return false;
        if (storeCatalogPaidFilter === 'paid' && !draft.is_paid) return false;
        if (storeCatalogPaidFilter === 'free' && draft.is_paid) return false;
        if (storeCatalogPinnedFilter === 'pinned' && !draft.is_pinned) return false;
        if (storeCatalogPinnedFilter === 'unpinned' && draft.is_pinned) return false;
        return true;
      })
      .sort((left, right) => {
        if (storeCatalogSort === 'title_asc') return String(left.bank?.title || '').localeCompare(String(right.bank?.title || ''));
        if (storeCatalogSort === 'title_desc') return String(right.bank?.title || '').localeCompare(String(left.bank?.title || ''));
        if (storeCatalogSort === 'price_high') return Number(right.price_php || 0) - Number(left.price_php || 0);
        if (storeCatalogSort === 'price_low') return Number(left.price_php || 0) - Number(right.price_php || 0);
        if (storeCatalogSort === 'status') {
          const byStatus = statusRank(left.status) - statusRank(right.status);
          if (byStatus !== 0) return byStatus;
          return String(left.bank?.title || '').localeCompare(String(right.bank?.title || ''));
        }
        if (storeCatalogSort === 'newest') {
          const leftTs = new Date((left as any).created_at || 0).getTime();
          const rightTs = new Date((right as any).created_at || 0).getTime();
          return rightTs - leftTs;
        }
        if (left.is_pinned && !right.is_pinned) return -1;
        if (!left.is_pinned && right.is_pinned) return 1;
        return String(left.bank?.title || '').localeCompare(String(right.bank?.title || ''));
      });
  }, [
    storeCatalogBankFilter,
    storeCatalogPaidFilter,
    storeCatalogPinnedFilter,
    storeCatalogSearch,
    storeCatalogSort,
    storeCatalogStatusFilter,
    storeDrafts,
  ]);

  const catalogTotalPages = Math.max(1, Math.ceil(filteredDrafts.length / PAGE_SIZE));
  const pagedDrafts = filteredDrafts.slice((storeCatalogPage - 1) * PAGE_SIZE, storeCatalogPage * PAGE_SIZE);
  const storeCatalogStats = React.useMemo(() => {
    const total = storeDrafts.length;
    const published = storeDrafts.filter((draft) => draft.status === 'published').length;
    const draft = storeDrafts.filter((draftItem) => draftItem.status !== 'published').length;
    const pinned = storeDrafts.filter((draftItem) => draftItem.is_pinned).length;
    const paid = storeDrafts.filter((draftItem) => draftItem.is_paid).length;
    return { total, published, draft, pinned, paid };
  }, [storeDrafts]);

  const hasStoreCatalogFilters = React.useMemo(
    () =>
      storeCatalogSearch.trim().length > 0
      || storeCatalogBankFilter !== 'all'
      || storeCatalogStatusFilter !== 'all'
      || storeCatalogPaidFilter !== 'all'
      || storeCatalogPinnedFilter !== 'all'
      || storeCatalogSort !== 'pinned_first',
    [
      storeCatalogBankFilter,
      storeCatalogPaidFilter,
      storeCatalogPinnedFilter,
      storeCatalogSearch,
      storeCatalogSort,
      storeCatalogStatusFilter,
    ],
  );

  const resetStoreCatalogFilters = React.useCallback(() => {
    setStoreCatalogSearch('');
    setStoreCatalogBankFilter('all');
    setStoreCatalogStatusFilter('all');
    setStoreCatalogPaidFilter('all');
    setStoreCatalogPinnedFilter('all');
    setStoreCatalogSort('pinned_first');
    setStoreCatalogPage(1);
  }, []);

  const loadedStoreBannerMap = React.useMemo(
    () => new Map(loadedStoreBanners.map((banner) => [banner.id, banner])),
    [loadedStoreBanners],
  );

  const dirtyStoreBannerIds = React.useMemo(() => {
    const next = new Set<string>();
    storeBanners.forEach((banner) => {
      const loaded = loadedStoreBannerMap.get(banner.id);
      if (!loaded || !areBannersEquivalent(banner, loaded)) {
        next.add(banner.id);
      }
    });
    return next;
  }, [loadedStoreBannerMap, storeBanners]);

  const storeBannerStats = React.useMemo(() => {
    const total = storeBanners.length;
    const active = storeBanners.filter((banner) => banner.is_active).length;
    const inactive = total - active;
    const dirty = dirtyStoreBannerIds.size;
    return { total, active, inactive, dirty };
  }, [dirtyStoreBannerIds, storeBanners]);

  const storePromotionStats = React.useMemo(() => {
    const total = storePromotions.length;
    const active = storePromotions.filter((promotion) => promotion.status === 'active').length;
    const scheduled = storePromotions.filter((promotion) => promotion.status === 'scheduled').length;
    const expired = storePromotions.filter((promotion) => promotion.status === 'expired').length;
    const inactive = storePromotions.filter((promotion) => promotion.status === 'inactive').length;
    return { total, active, scheduled, expired, inactive };
  }, [storePromotions]);

  const visibleStoreBanners = React.useMemo(
    () => storeBanners.filter((banner) => showInactiveBanners || banner.is_active || dirtyStoreBannerIds.has(banner.id)),
    [dirtyStoreBannerIds, showInactiveBanners, storeBanners],
  );

  React.useEffect(() => {
    if (storeCatalogBankFilter === 'all') return;
    if (!catalogBankOptions.includes(storeCatalogBankFilter)) {
      setStoreCatalogBankFilter('all');
      setStoreCatalogPage(1);
    }
  }, [catalogBankOptions, storeCatalogBankFilter]);

  React.useEffect(() => {
    if (storeCatalogPage > catalogTotalPages) {
      setStoreCatalogPage(catalogTotalPages);
    }
  }, [catalogTotalPages, storeCatalogPage]);

  React.useEffect(() => {
    if (!expandedStoreRequestId) return;
    if (!groupedRequests.some((request) => request.id === expandedStoreRequestId)) {
      setExpandedStoreRequestId(null);
    }
  }, [expandedStoreRequestId, groupedRequests]);

  return {
    bannerLoading,
    bannerUploadingIds,
    catalogBankOptions,
    catalogTotalPages,
    executeStorePublish,
    expandedStoreRequestId,
    filteredDrafts,
    handleCreateStoreBanner,
    handleDeleteStoreBanner,
    handleNewBannerImageChange,
    nudgeBannerSortOrder,
    handleSaveStoreBanner,
    handleStoreBannerImageReplace,
    handleStoreCatalogUpdate,
    handleStoreConfigSave,
    handleStoreAutoApprovalAction,
    persistStorePromotion,
    deleteStorePromotion,
    editStorePromotion,
    handleStoreQrFileChange,
    handleStoreRequestAction,
    handleStoreRequestRetryEmail,
    hasStoreCatalogFilters,
    loadStoreCatalog,
    loadStorePromotions,
    dirtyStoreBannerIds,
    editingPromotionId,
    newBannerImageFile,
    newBannerImageUrl,
    newBannerLinkUrl,
    newBannerPreviewUrl,
    newBannerSortOrder,
    pagedDrafts,
    pagedRequests,
    reqTotalPages,
    resetStoreCatalogFilters,
    resetBannerDraft,
    resetStorePromotionForm,
    setExpandedStoreRequestId,
    setNewBannerImageFile,
    setNewBannerImageUrl,
    setNewBannerLinkUrl,
    setNewBannerSortOrder,
    setShowInactiveBanners,
    setStoreCatalogBankFilter,
    setStoreCatalogPage,
    setStoreCatalogPaidFilter,
    setStoreCatalogPinnedFilter,
    setStoreCatalogSearch,
    setStoreCatalogSort,
    setStoreCatalogStatusFilter,
    setStoreConfig,
    setStorePublishDialog,
    setStoreReqPage,
    setStoreReqSearch,
    setStoreRequestFilter,
    setStoreRequestToReject,
    setStoreQrFile,
    showInactiveBanners,
    showStorePublishDialog,
    storeBanners,
    storeBannerStats,
    storeCatalogBankFilter,
    storeCatalogPage,
    storeCatalogPaidFilter,
    storeCatalogPinnedFilter,
    storeCatalogSearch,
    storeCatalogSort,
    storeCatalogStats,
    storeCatalogStatusFilter,
    storeConfig,
    storeDrafts,
    storeLoading,
    storePromotionForm,
    storePromotionStats,
    storePromotions,
    storePublishDialog,
    storeQrPreviewUrl,
    storeReqPage,
    storeReqSearch,
    storeRequestFilter,
    storeRequestToReject,
    storeRequests,
    setStorePromotionForm,
    updateBannerDraft,
    visibleStoreBanners,
  };
}
