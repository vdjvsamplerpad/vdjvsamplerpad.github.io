import * as React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Download, ExternalLink, Info, Loader2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CopyableValue } from '@/components/ui/copyable-value';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaymentReceiptCard } from '@/components/ui/payment-receipt-card';
import {
  DEFAULT_LANDING_DOWNLOAD_CONFIG,
  normalizeLandingDownloadConfig,
  type LandingDownloadConfig,
  type PlatformKey,
  type VersionKey,
} from '@/components/landing/download-config';
import { VersionSelector } from '@/components/landing/VersionSelector';
import { edgeFunctionUrl } from '@/lib/edge-api';
import {
  type AccountTierUiContent,
  DEFAULT_TIER_VIDEO_SRC,
  DEFAULT_TIER_UI_CONTENT,
  normalizeInstallerTierUiContent,
  normalizeTierUiContent,
  resolveTierVideoSrc,
} from '@/lib/account-tier-content';
import { openWalletAppAfterCopy } from '@/lib/mobile-wallet-links';
import { captureProductEvent } from '@/lib/productAnalytics';
import { getBuyPagePath, getInstallerRedirectPath, getLandingPagePath, getPrivacyPagePath, getTermsPagePath } from '@/lib/runtime-routes';
import { supabase } from '@/lib/supabase';

type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual';
type InstallerVersion = 'V2' | 'V3';
type V1Plan = 'free' | 'pro' | 'pro_max';
type ProPurchaseMode = '' | 'standard_update' | 'update_only';
type PricingCardTier = 'free' | 'pro' | 'pro_max' | 'standard';
type InstallerPricingTier = 'standard' | 'pro' | 'pro_max';
type MobileSlideDirection = 'next' | 'prev';

type PublicAccountTierOption = {
  tier: V1Plan;
  displayName: string;
  description: string;
  pricePhp: number;
  promoDiscountPercent?: number;
  uiContent?: AccountTierUiContent | null;
  isActive: boolean;
  quote?: {
    basePrice: number;
    discountPercent: number;
    discountPhp: number;
    quotePrice: number;
    creditPhp?: number;
  };
};

type InstallerProduct = {
  id?: string;
  version: InstallerVersion;
  skuCode: string;
  productType: 'standard' | 'update' | 'promax';
  displayName: string;
  description: string;
  pricePhp: number;
  enabled: boolean;
  sortOrder: number;
  allowAutoApprove: boolean;
  heroImageUrl: string;
  downloadLinkOverride: string;
  grantedEntitlements: string[];
};

type InstallerTierConfig = {
  id?: string;
  version: InstallerVersion;
  tier: InstallerPricingTier;
  displayName: string;
  description: string;
  uiContent?: AccountTierUiContent | null;
  isActive?: boolean;
};

type BuyConfigResponse = {
  config: LandingDownloadConfig;
  paymentConfig: {
    instructions?: string;
    gcash_number?: string;
    maya_number?: string;
    messenger_url?: string;
    qr_image_path?: string;
  };
  freeTier?: PublicAccountTierOption | null;
  accountTiers?: PublicAccountTierOption[];
  v2v3Products: InstallerProduct[];
  installerTierConfigs?: InstallerTierConfig[];
};

type SubmitResult =
  | {
    version: 'V1';
    status: 'approved' | 'pending';
    email: string;
    receiptReference: string;
    paymentReference: string;
    message: string;
  }
  | {
    version: InstallerVersion;
    status: 'approved' | 'pending';
    email: string;
    receiptReference: string;
    paymentReference: string;
    message: string;
    purchaseLabel: string;
    licenseCode?: string;
    installerDownloadLink?: string;
    installerDownloadLinks?: Partial<Record<PlatformKey, string>>;
  };

const PAYMENT_CHANNEL_OPTIONS: Array<{ value: PaymentChannel; title: string; subtitle: string; accent: 'pink' | 'blue' | 'green' }> = [
  { value: 'image_proof', title: 'Receipt Upload', subtitle: 'Fastest admin review', accent: 'pink' },
  { value: 'gcash_manual', title: 'GCash Manual', subtitle: 'Enter sender and reference', accent: 'blue' },
  { value: 'maya_manual', title: 'Maya Manual', subtitle: 'Enter sender and reference', accent: 'green' },
];

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

const VERSION_PREVIEW_VIDEO: Record<VersionKey, string> = {
  V1: '/assets/v1-preview.mp4',
  V2: '/assets/v2-preview.mp4',
  V3: '/assets/v3-preview.mp4',
};

const platformButtonLabel: Record<PlatformKey, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Desktop',
  macos: 'macOS',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getFileExt(name: string): string {
  return String(name.split('.').pop() || '').toLowerCase();
}

function validateProofFile(file: File): string | null {
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
}

function mapRegistrationError(code: string, payload: Record<string, unknown>): string {
  if (code === 'EMAIL_ALREADY_REGISTERED') return 'This email is already registered and approved. Please log in instead.';
  if (code === 'ACCOUNT_REGISTRATION_PENDING') return 'This email already has a pending registration. Please wait for review or check your email.';
  if (code === 'INSTALLER_PURCHASE_PENDING') return 'This purchase already has a pending request. Please check your email or message us on Facebook with the receipt reference.';
  if (code === 'WEAK_PASSWORD') {
    const minLength = Number(payload?.min_length || 8);
    return `Password must be at least ${minLength} characters.`;
  }
  if (code === 'PASSWORD_MISMATCH') return 'Passwords do not match.';
  if (code === 'PROOF_TOO_LARGE') return 'Proof file is too large.';
  if (code === 'INVALID_PROOF_PATH') return 'Uploaded proof could not be verified. Please upload again.';
  if (code === 'RATE_LIMITED') return 'Too many requests right now. Please try again later.';
  if (code === 'INSTALLER_BUY_PRODUCT_NOT_FOUND') return 'This item is not available right now.';
  return code || 'We could not submit your request. Please try again.';
}

function formatPhp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'To be confirmed';
  if (value <= 0) return 'Free';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value);
}

function sumProducts(products: InstallerProduct[]): number {
  return products.reduce((total, product) => total + (Number(product.pricePhp) || 0), 0);
}

function getPromoDiscountPercent(tier: { promoDiscountPercent?: number; quote?: { discountPercent?: number } } | null | undefined): number {
  const explicit = Number(tier?.promoDiscountPercent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.round(explicit));
  const quoted = Number(tier?.quote?.discountPercent);
  return Number.isFinite(quoted) ? Math.max(0, Math.round(quoted)) : 0;
}

function getBeforePromoPrice(price: number, discountPercent: number): number {
  if (!Number.isFinite(price) || price <= 0 || discountPercent <= 0 || discountPercent >= 100) return price;
  return Math.max(price, Math.round(price / (1 - discountPercent / 100)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function accentRgb(hex: string, alpha: number, fallback = 'rgba(242,25,132,0.35)'): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.max(0, Math.min(1, alpha))})`;
}

function normalizePricingCardTier(value: unknown): PricingCardTier {
  if (value === 'free' || value === 'pro' || value === 'pro_max' || value === 'standard') return value;
  return 'pro';
}

function ensureInstallerProDynamicInclusions(inclusions: AccountTierUiContent['inclusions']): AccountTierUiContent['inclusions'] {
  if (inclusions.some((item) => /selected updates/i.test(item.title))) return inclusions;
  return [...inclusions, { title: 'Selected updates', badge: 'OPTIONAL', enabled: false }];
}

export default function BuyPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const landingPagePath = React.useMemo(() => getLandingPagePath(), []);
  const privacyPagePath = React.useMemo(() => getPrivacyPagePath(), []);
  const termsPagePath = React.useMemo(() => getTermsPagePath(), []);
  const pricingPath = React.useMemo(() => getBuyPagePath(), []);
  const checkoutPath = React.useMemo(() => `${getBuyPagePath()}/checkout`, []);
  const isCheckoutPage = location.pathname.replace(/\/$/, '') === checkoutPath;
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selectedVersion, setSelectedVersion] = React.useState<VersionKey>('V1');
  const [selectedV1Plan, setSelectedV1Plan] = React.useState<V1Plan>('pro');
  const [mobilePlanIndex, setMobilePlanIndex] = React.useState(0);
  const [mobileSlideDirection, setMobileSlideDirection] = React.useState<MobileSlideDirection>('next');
  const [showMobilePreview, setShowMobilePreview] = React.useState(false);
  const [checkoutStarted, setCheckoutStarted] = React.useState(false);
  const [config, setConfig] = React.useState<BuyConfigResponse>({
    config: normalizeLandingDownloadConfig(DEFAULT_LANDING_DOWNLOAD_CONFIG),
    paymentConfig: {},
    freeTier: null,
    accountTiers: [],
    v2v3Products: [],
    installerTierConfigs: [],
  });

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof');
  const [payerName, setPayerName] = React.useState('');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = React.useState<string | null>(null);
  const [expandedQrUrl, setExpandedQrUrl] = React.useState<string | null>(null);
  const [qrImageLoaded, setQrImageLoaded] = React.useState(false);
  const [qrImageFailed, setQrImageFailed] = React.useState(false);
  const [qrDownloadBusy, setQrDownloadBusy] = React.useState(false);
  const [selectedSkus, setSelectedSkus] = React.useState<string[]>([]);
  const [proModeByVersion, setProModeByVersion] = React.useState<Record<InstallerVersion, ProPurchaseMode>>({ V2: '', V3: '' });
  const [proUpdateSkusByVersion, setProUpdateSkusByVersion] = React.useState<Record<InstallerVersion, string[]>>({ V2: [], V3: [] });
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  const [pricingNotice, setPricingNotice] = React.useState<{ variant: 'error' | 'info' | 'success'; message: string } | null>(null);
  const planRailRef = React.useRef<HTMLDivElement | null>(null);
  const planRailShellRef = React.useRef<HTMLDivElement | null>(null);
  const planRailScrollSyncRef = React.useRef<number | null>(null);
  const planRailAnimationRef = React.useRef<number | null>(null);
  const planRailProgrammaticScrollUntilRef = React.useRef(0);
  const installerBuyStartedRef = React.useRef<Record<InstallerVersion, boolean>>({ V2: false, V3: false });

  React.useEffect(() => {
    const requestedVersion = String(searchParams.get('version') || '').toUpperCase();
    if (requestedVersion === 'V1' || requestedVersion === 'V2' || requestedVersion === 'V3') {
      setSelectedVersion(requestedVersion as VersionKey);
    }
  }, [searchParams]);

  React.useEffect(() => {
    if (!isCheckoutPage) return;
    const requestedPlan = String(searchParams.get('plan') || '').toLowerCase();
    if (requestedPlan === 'free' || requestedPlan === 'pro' || requestedPlan === 'pro_max') {
      setSelectedV1Plan(requestedPlan as V1Plan);
    }
    const mode = String(searchParams.get('mode') || '');
    if ((selectedVersion === 'V2' || selectedVersion === 'V3') && (mode === 'standard_update' || mode === 'update_only')) {
      setProModeByVersion((current) => ({ ...current, [selectedVersion]: mode }));
    }
    const skus = String(searchParams.get('skus') || '')
      .split(',')
      .map((sku) => sku.trim())
      .filter(Boolean);
    if (skus.length) setSelectedSkus(skus);
    setCheckoutStarted(true);
  }, [isCheckoutPage, searchParams, selectedVersion]);

  React.useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setShowMobilePreview(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  React.useEffect(() => {
    return () => {
      if (planRailAnimationRef.current !== null) {
        window.cancelAnimationFrame(planRailAnimationRef.current);
      }
      if (planRailScrollSyncRef.current !== null) {
        window.clearTimeout(planRailScrollSyncRef.current);
      }
    };
  }, []);

  const pushPricingNotice = React.useCallback((variant: 'error' | 'info' | 'success', message: string) => {
    setPricingNotice({ variant, message });
  }, []);

  React.useEffect(() => {
    if (!pricingNotice) return;
    const timeout = window.setTimeout(() => setPricingNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [pricingNotice]);

  React.useEffect(() => {
    setQrImageLoaded(false);
    setQrImageFailed(false);
  }, [config.paymentConfig.qr_image_path]);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [buyResponse, accountResponse] = await Promise.all([
          fetch(edgeFunctionUrl('store-api', 'buy-config'), { cache: 'no-store' }),
          fetch(edgeFunctionUrl('store-api', 'account/upgrade-options'), { cache: 'no-store' }).catch(() => null),
        ]);
        const payload = await buyResponse.json().catch(() => ({}));
        const data = payload?.data ?? payload;
        if (!active) return;
        if (!buyResponse.ok) {
          setError(String(payload?.error || data?.error || 'Pricing config could not be loaded. Please refresh.'));
          return;
        }
        let publicFreeTier = data?.freeTier || null;
        let publicAccountTiers = Array.isArray(data?.accountTiers) ? data.accountTiers : [];
        if (accountResponse?.ok) {
          const accountPayload = await accountResponse.json().catch(() => ({}));
          const accountData = accountPayload?.data ?? accountPayload;
          publicFreeTier = accountData?.freeTier || publicFreeTier;
          publicAccountTiers = Array.isArray(accountData?.tiers) ? accountData.tiers : publicAccountTiers;
        }
        if (!active) return;
        setConfig({
          config: normalizeLandingDownloadConfig(data?.config || DEFAULT_LANDING_DOWNLOAD_CONFIG),
          paymentConfig: data?.paymentConfig || {},
          freeTier: publicFreeTier,
          accountTiers: publicAccountTiers,
          v2v3Products: Array.isArray(data?.v2v3Products) ? data.v2v3Products : [],
          installerTierConfigs: Array.isArray(data?.installerTierConfigs) ? data.installerTierConfigs : [],
        });
      } catch {
        if (active) setError('Pricing config could not be loaded. Please refresh.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const versionProducts = React.useMemo(
    () => config.v2v3Products
      .filter((item) => item.version === selectedVersion)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)),
    [config.v2v3Products, selectedVersion],
  );
  const selectedProducts = React.useMemo(
    () => versionProducts.filter((item) => selectedSkus.includes(item.skuCode)),
    [selectedSkus, versionProducts],
  );
  const selectedPrimaryProduct = selectedProducts[0] || null;
  const standardProduct = React.useMemo(() => versionProducts.find((item) => item.productType === 'standard') || null, [versionProducts]);
  const promaxProduct = React.useMemo(() => versionProducts.find((item) => item.productType === 'promax') || null, [versionProducts]);
  const updateProducts = React.useMemo(() => versionProducts.filter((item) => item.productType === 'update'), [versionProducts]);
  const getInstallerTierConfig = React.useCallback((tier: InstallerPricingTier) => (
    config.installerTierConfigs?.find((item) => item.version === selectedVersion && item.tier === tier && item.isActive !== false) || null
  ), [config.installerTierConfigs, selectedVersion]);
  const activeBuySection = config.config.buySections[selectedVersion];
  const activeVersionDescription = config.config.versionDescriptions[selectedVersion];
  const messengerUrl = String(config.paymentConfig.messenger_url || '').trim();
  const v1Links = config.config.downloadLinks.V1;
  const proMode = selectedVersion === 'V1' ? '' : proModeByVersion[selectedVersion as InstallerVersion];
  const proUpdateSkus = selectedVersion === 'V1' ? [] : proUpdateSkusByVersion[selectedVersion as InstallerVersion];
  const proSelectedUpdates = updateProducts.filter((product) => proUpdateSkus.includes(product.skuCode));
  const v1FreeTier = React.useMemo(
    () => config.freeTier || {
      tier: 'free' as const,
      displayName: 'FREE',
      description: 'For trying VDJV before upgrading',
      pricePhp: 0,
      uiContent: DEFAULT_TIER_UI_CONTENT.free,
      isActive: true,
      quote: { basePrice: 0, discountPercent: 0, discountPhp: 0, quotePrice: 0 },
    },
    [config.freeTier],
  );
  const v1ProTier = React.useMemo(
    () => config.accountTiers?.find((tier) => tier.tier === 'pro') || {
      tier: 'pro' as const,
      displayName: 'PRO',
      description: activeBuySection.description || 'Full VDJV feature set.',
      pricePhp: 0,
      uiContent: DEFAULT_TIER_UI_CONTENT.pro,
      isActive: true,
      quote: {
        basePrice: 0,
        discountPercent: 0,
        discountPhp: 0,
        quotePrice: 0,
      },
    },
    [activeBuySection.description, config.accountTiers],
  );
  const v1ProMaxTier = React.useMemo(
    () => config.accountTiers?.find((tier) => tier.tier === 'pro_max') || {
      tier: 'pro_max' as const,
      displayName: 'PRO MAX',
      description: 'Everything in PRO plus maximum Store access.',
      pricePhp: 0,
      uiContent: DEFAULT_TIER_UI_CONTENT.pro_max,
      isActive: true,
      quote: { basePrice: 0, discountPercent: 0, discountPhp: 0, quotePrice: 0 },
    },
    [config.accountTiers],
  );
  const proSelectedProducts = React.useMemo(() => {
    if (selectedVersion === 'V1') return [];
    if (!proMode) return proSelectedUpdates;
    if (proMode === 'standard_update' && standardProduct) return [standardProduct, ...proSelectedUpdates];
    return proSelectedUpdates;
  }, [proMode, proSelectedUpdates, selectedVersion, standardProduct]);

  React.useEffect(() => {
    if (selectedVersion === 'V1') {
      setSelectedSkus([]);
      return;
    }
    setSelectedSkus((current) => current.filter((skuCode) => versionProducts.some((item) => item.skuCode === skuCode)));
  }, [selectedVersion, versionProducts]);

  React.useEffect(() => {
    if (selectedVersion === 'V1') return;
    const version = selectedVersion as InstallerVersion;
    if (selectedSkus.length > 0 && !installerBuyStartedRef.current[version]) {
      captureProductEvent('installer_buy_started', {
        version,
        selected_count: selectedSkus.length,
      });
      installerBuyStartedRef.current[version] = true;
      return;
    }
    if (selectedSkus.length === 0) {
      installerBuyStartedRef.current[version] = false;
    }
  }, [selectedSkus.length, selectedVersion]);

  const handleVersionChange = React.useCallback((version: VersionKey) => {
    setSelectedVersion(version);
    navigate(version === 'V1' ? pricingPath : `${pricingPath}?version=${version}`);
    setCheckoutStarted(false);
    setResult(null);
    setError('');
  }, [navigate, pricingPath]);

  const postPublicStoreApi = React.useCallback(async (route: string, body: Record<string, unknown>) => {
    const res = await fetch(edgeFunctionUrl('store-api', route), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    const data = payload?.data ?? payload;
    const code = String(payload?.error || data?.error || '');
    return { res, payload, data, code };
  }, []);

  const downloadQrImage = React.useCallback(async (url: string) => {
    setQrDownloadBusy(true);
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
    } finally {
      setQrDownloadBusy(false);
    }
  }, []);

  const resetForm = () => {
    setPassword('');
    setConfirmPassword('');
    setPayerName('');
    setReferenceNo('');
    setNotes('');
    setProofFile(null);
  };

  const uploadProof = async () => {
    if (!proofFile) return null;
    const validationError = validateProofFile(proofFile);
    if (validationError) throw new Error(validationError);

    const uploadReq = await postPublicStoreApi(
      selectedVersion === 'V1' ? 'account-registration/proof-upload-url' : 'installer-request/proof-upload-url',
      {
        email: email.trim().toLowerCase(),
        fileName: proofFile.name,
        contentType: proofFile.type || 'application/octet-stream',
        paymentChannel,
        sizeBytes: proofFile.size,
      },
    );

    if (!uploadReq.res.ok || uploadReq.code) {
      throw new Error(mapRegistrationError(uploadReq.code, uploadReq.payload));
    }

    const bucket = String(uploadReq.data?.bucket || 'payment-proof');
    const path = String(uploadReq.data?.path || '');
    const token = String(uploadReq.data?.token || '');
    if (!path || !token) throw new Error('We could not prepare your proof upload. Please try again.');

    const upload = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, proofFile);
    if (upload.error) throw new Error('Your proof upload did not complete. Please try again.');
    return path;
  };

  const selectFreeV1 = React.useCallback(() => {
    setSelectedV1Plan('free');
    setCheckoutStarted(false);
    setError('');
    const firstConfiguredPlatform = (['android', 'ios', 'windows'] as PlatformKey[])
      .find((platform) => Boolean(String(v1Links[platform] || '').trim()));
    const target = firstConfiguredPlatform
      ? getInstallerRedirectPath('V1', firstConfiguredPlatform)
      : getLandingPagePath();
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [v1Links.android, v1Links.ios, v1Links.windows]);

  const startV1Checkout = React.useCallback((plan: V1Plan) => {
    setSelectedV1Plan(plan);
    setError('');
    setResult(null);
    if (plan === 'free') {
      selectFreeV1();
      return;
    }
    setCheckoutStarted(true);
    setSelectedSkus([]);
    navigate(`${checkoutPath}?version=V1&plan=${plan}`);
  }, [checkoutPath, navigate, selectFreeV1]);

  const startInstallerCheckout = React.useCallback((kind: 'standard' | 'pro' | 'promax') => {
    if (selectedVersion === 'V1') return;
    setResult(null);
    setError('');
    const version = selectedVersion as InstallerVersion;

    if (kind === 'standard') {
      if (!standardProduct) {
        pushPricingNotice('error', `${version} Standard is not available yet.`);
        return;
      }
      setSelectedSkus([standardProduct.skuCode]);
      setCheckoutStarted(true);
      navigate(`${checkoutPath}?version=${version}&skus=${encodeURIComponent(standardProduct.skuCode)}&kind=standard`);
      return;
    }

    if (kind === 'promax') {
      if (!promaxProduct) {
        pushPricingNotice('error', `${version} PRO MAX is not available yet.`);
        return;
      }
      setSelectedSkus([promaxProduct.skuCode]);
      setCheckoutStarted(true);
      navigate(`${checkoutPath}?version=${version}&skus=${encodeURIComponent(promaxProduct.skuCode)}&kind=promax`);
      return;
    }

    if (!proMode) {
      pushPricingNotice('error', 'Choose Standard + Update or Update Only before getting PRO.');
      return;
    }
    if (proSelectedUpdates.length === 0) {
      pushPricingNotice('error', 'Select at least one update for PRO.');
      return;
    }
    if (proMode === 'standard_update' && !standardProduct) {
      pushPricingNotice('error', `${version} Standard is not available for this bundle.`);
      return;
    }
    const nextSkus = proSelectedProducts.map((product) => product.skuCode);
    setSelectedSkus(nextSkus);
    setCheckoutStarted(true);
    navigate(`${checkoutPath}?version=${version}&mode=${proMode}&kind=pro&skus=${encodeURIComponent(nextSkus.join(','))}`);
  }, [checkoutPath, navigate, proMode, proSelectedProducts, proSelectedUpdates.length, promaxProduct, pushPricingNotice, selectedVersion, standardProduct]);

  const toggleProUpdate = React.useCallback((product: InstallerProduct) => {
    if (selectedVersion === 'V1') return;
    const version = selectedVersion as InstallerVersion;
    setProUpdateSkusByVersion((current) => {
      const existing = current[version] || [];
      const next = existing.includes(product.skuCode)
        ? existing.filter((skuCode) => skuCode !== product.skuCode)
        : [...existing, product.skuCode];
      const sorted = next.sort((left, right) => {
        const leftOrder = versionProducts.find((item) => item.skuCode === left)?.sortOrder ?? 0;
        const rightOrder = versionProducts.find((item) => item.skuCode === right)?.sortOrder ?? 0;
        return leftOrder - rightOrder;
      });
      return { ...current, [version]: sorted };
    });
  }, [selectedVersion, versionProducts]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPayerName = payerName.trim();
    const normalizedReferenceNo = referenceNo.trim();
    const requestedV1TierName = selectedV1Plan === 'pro_max'
      ? (v1ProMaxTier.displayName || 'PRO MAX')
      : (v1ProTier.displayName || 'PRO');
    const planNote = selectedVersion === 'V1'
      ? `Requested V1 ${requestedV1TierName} plan.`
      : `Requested ${selectedVersion} ${selectedProducts.map((product) => product.displayName).join(' + ')}.`;
    const normalizedNotes = [planNote, notes.trim()].filter(Boolean).join(' ');

    if (!checkoutStarted) {
      pushPricingNotice('error', 'Choose a pricing card first.');
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if ((paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && !normalizedPayerName) {
      setError('Please enter the account name used for payment.');
      return;
    }
    if ((paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && !normalizedReferenceNo) {
      setError('Please enter your payment reference or transaction number.');
      return;
    }
    if (paymentChannel === 'image_proof' && !proofFile) {
      setError('Please upload proof of payment.');
      return;
    }
    if (selectedVersion === 'V1') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    } else if (selectedProducts.length === 0) {
      setError('Select what you want to buy first.');
      return;
    }

    setSubmitting(true);
    try {
      const proofPath = await uploadProof();
      if (selectedVersion === 'V1') {
        const submitRes = await postPublicStoreApi('account-registration/submit', {
          email: normalizedEmail,
          password,
          confirmPassword,
          paymentChannel,
          payerName: normalizedPayerName || null,
          referenceNo: normalizedReferenceNo || null,
          notes: normalizedNotes || null,
          proofPath,
          targetTier: selectedV1Plan === 'pro_max' ? 'pro_max' : 'pro',
        });
        if (!submitRes.res.ok || submitRes.code) {
          throw new Error(mapRegistrationError(submitRes.code, submitRes.payload));
        }
        const isApproved = String(submitRes.data?.status || 'pending') === 'approved';
        captureProductEvent('payment_proof_submitted', {
          request_type: 'account',
          payment_channel: paymentChannel,
          status: isApproved ? 'approved' : 'pending',
          version: 'V1',
          plan: selectedV1Plan,
        });
        setResult({
          version: 'V1',
          status: isApproved ? 'approved' : 'pending',
          email: normalizedEmail,
          receiptReference: String(submitRes.data?.receipt_reference || submitRes.data?.requestId || 'Pending verification'),
          paymentReference: String(submitRes.data?.reference_no || normalizedReferenceNo || 'Not provided'),
          message: isApproved
            ? 'Your payment passed verification and your V1 account is ready. You can log in now and use the platform links below.'
            : `${String(submitRes.data?.wait_message || 'Your account request is waiting for admin review.')} If needed, send the receipt reference to Facebook Messenger for status.`,
        });
      } else {
        const submitRes = await postPublicStoreApi('installer-request/submit', {
          email: normalizedEmail,
          version: selectedVersion,
          skuCodes: selectedProducts.map((product) => product.skuCode),
          paymentChannel,
          payerName: normalizedPayerName || null,
          referenceNo: normalizedReferenceNo || null,
          notes: normalizedNotes || null,
          proofPath,
        });
        if (!submitRes.res.ok || submitRes.code) {
          throw new Error(mapRegistrationError(submitRes.code, submitRes.payload));
        }
        const isApproved = String(submitRes.data?.status || 'pending') === 'approved';
        captureProductEvent('payment_proof_submitted', {
          request_type: 'installer',
          payment_channel: paymentChannel,
          status: isApproved ? 'approved' : 'pending',
          version: selectedVersion,
          selected_count: selectedProducts.length,
          total_php: sumProducts(selectedProducts),
        });
        captureProductEvent('installer_buy_submitted', {
          version: selectedVersion,
          payment_channel: paymentChannel,
          status: isApproved ? 'approved' : 'pending',
          selected_count: selectedProducts.length,
          has_update: selectedProducts.some((product) => product.productType === 'update'),
          has_standard: selectedProducts.some((product) => product.productType === 'standard'),
          has_promax: selectedProducts.some((product) => product.productType === 'promax'),
        });
        setResult({
          version: selectedVersion as InstallerVersion,
          status: isApproved ? 'approved' : 'pending',
          email: normalizedEmail,
          receiptReference: String(submitRes.data?.receipt_reference || submitRes.data?.requestId || 'Pending verification'),
          paymentReference: String(submitRes.data?.reference_no || normalizedReferenceNo || 'Not provided'),
          message: isApproved
            ? 'Your payment passed verification and your license is ready below. A copy was also sent to your email.'
            : `${String(submitRes.data?.wait_message || 'Your purchase request is waiting for admin review.')} If needed, send the receipt reference to Facebook Messenger for status.`,
          purchaseLabel: String(
            submitRes.data?.purchase_label
            || (selectedProducts.length === 1
              ? selectedProducts[0]?.displayName
              : `${selectedProducts.length} ${selectedVersion} items`)
            || activeBuySection.title,
          ),
          licenseCode: String(submitRes.data?.issued_license_code || ''),
          installerDownloadLink: String(
            submitRes.data?.installer_download_link
            || selectedPrimaryProduct?.downloadLinkOverride
            || config.config.downloadLinks[selectedVersion as InstallerVersion].windows
            || '',
          ),
          installerDownloadLinks: Object.fromEntries(
            (['android', 'ios', 'windows', 'macos'] as PlatformKey[])
              .map((platform) => [
                platform,
                String(
                  submitRes.data?.installer_download_links?.[platform]
                  || config.config.downloadLinks[selectedVersion as InstallerVersion][platform]
                  || '',
                ),
              ]),
          ) as Partial<Record<PlatformKey, string>>,
        });
      }
      resetForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Your purchase was not submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPriceText = selectedVersion === 'V1'
    ? formatPhp(selectedV1Plan === 'pro_max'
      ? (v1ProMaxTier.quote?.quotePrice ?? v1ProMaxTier.pricePhp)
      : (v1ProTier.quote?.quotePrice ?? v1ProTier.pricePhp))
    : formatPhp(sumProducts(selectedProducts) || null);
  const selectedCheckoutTitle = selectedVersion === 'V1'
    ? `V1 ${selectedV1Plan === 'pro_max' ? (v1ProMaxTier.displayName || 'PRO MAX') : (v1ProTier.displayName || 'PRO')}`
    : selectedProducts.length === 1
      ? selectedProducts[0].displayName
      : `${selectedVersion} ${selectedProducts.length} items`;
  const hasPublishedProducts = selectedVersion === 'V1' || versionProducts.length > 0;
  const submitDisabled = submitting || !checkoutStarted || (selectedVersion !== 'V1' && selectedProducts.length === 0);
  const darkInputClass = 'border-white/15 bg-white/[0.08] text-white placeholder:text-white/32 focus-visible:ring-[#f21984] focus-visible:ring-offset-0';

  const renderPreview = () => {
    if (!showMobilePreview) return null;
    const v1PreviewContent = normalizeTierUiContent(v1ProTier.uiContent || v1FreeTier.uiContent, 'pro');
    const installerPreviewContent = selectedVersion === 'V1'
      ? null
      : normalizeInstallerTierUiContent(getInstallerTierConfig('standard')?.uiContent, 'standard');
    const installerVideoSrc = installerPreviewContent ? resolveTierVideoSrc(installerPreviewContent) : '';
    const previewVideoSrc = selectedVersion === 'V1'
      ? resolveTierVideoSrc(v1PreviewContent)
      : installerVideoSrc && installerVideoSrc !== DEFAULT_TIER_VIDEO_SRC
        ? installerVideoSrc
        : VERSION_PREVIEW_VIDEO[selectedVersion];
    return (
    <div className="relative -mx-4 -mt-2 mb-5 h-[280px] overflow-hidden rounded-b-[24px] bg-slate-950 shadow-[0_24px_70px_rgba(0,0,0,0.32)] md:hidden">
      <div className="absolute inset-0 overflow-hidden bg-slate-950">
        <video
          key={`${selectedVersion}:${previewVideoSrc}`}
          src={previewVideoSrc}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.12)_0%,rgba(0,0,0,0.44)_64%,rgba(0,0,0,0.78)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[160px] bg-[radial-gradient(120%_100%_at_50%_100%,rgba(180,40,120,0.48)_0%,rgba(140,30,100,0.24)_50%,transparent_72%)]" />
      <div className="pointer-events-none absolute left-0 right-0 z-10 flex flex-col items-center gap-1 px-4 text-center text-white [top:calc(env(safe-area-inset-top,0px)+2.35rem)]">
        <p className="text-sm font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">{selectedVersion} Preview</p>
        <p className="select-none text-[clamp(34px,11vw,52px)] font-black uppercase leading-[1.05] text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.46)]">
          {activeVersionDescription.title}
        </p>
        <p className="max-w-xs text-sm font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">Premium pricing</p>
      </div>
    </div>
    );
  };

  const renderPlanShell = (props: {
    id: string;
    title: string;
    subtitle: string;
    price: string;
    previousPrice?: string | null;
    badge?: string;
    versionBadge?: string;
    variant: PricingCardTier;
    accentColor?: string;
    meterPercent?: number;
    otherTitle?: string;
    otherBody?: string;
    features: string[];
    inclusionTitle?: string;
    inclusions?: Array<{ title: string; badge: string; enabled: boolean }>;
    cta: string;
    disabled?: boolean;
    selected?: boolean;
    onClick: () => void;
    children?: React.ReactNode;
  }) => {
    const normalizedVariant = normalizePricingCardTier(props.variant);
    const isProMax = normalizedVariant === 'pro_max';
    const isPro = props.variant === 'pro';
    const isFree = props.variant === 'free';
    const accentColor = props.accentColor || (isProMax ? '#2155ff' : isPro ? '#f21984' : props.variant === 'standard' ? '#f59e0b' : '#64748b');
    const meterPercent = Math.max(0, Math.min(100, Math.round(props.meterPercent ?? (isProMax ? 100 : isPro ? 66 : props.variant === 'standard' ? 50 : 33))));
    const inclusions = props.inclusions?.length
      ? props.inclusions
      : DEFAULT_TIER_UI_CONTENT[isProMax ? 'pro_max' : isPro ? 'pro' : 'free'].inclusions;
    const shellStyle: React.CSSProperties = isFree ? {} : {
      borderColor: accentRgb(accentColor, 0.26),
      background: `radial-gradient(115% 82% at 92% 0%, ${accentRgb(accentColor, 0.18)}, transparent 58%), linear-gradient(180deg, rgba(17,17,22,0.98), rgba(8,10,14,0.98))`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 48px ${accentRgb(accentColor, 0.2)}`,
    };
    const heroStyle: React.CSSProperties = isFree ? {} : {
      background: `radial-gradient(120% 95% at 88% 0%, ${accentRgb(accentColor, 0.58)}, transparent 55%), radial-gradient(100% 90% at 12% 0%, rgba(255,255,255,0.18), transparent 42%), linear-gradient(180deg, ${accentRgb(accentColor, 0.32)}, rgba(23,22,30,0.98))`,
    };
    const disabledButtonClass = 'bg-white/10 text-white/55';
    const buttonStyle: React.CSSProperties = !isFree && !props.disabled ? {
      backgroundColor: accentColor,
      boxShadow: `0 14px 36px ${accentRgb(accentColor, 0.38)}`,
    } : {};

    return (
      <div
        style={{ ['--tier-accent' as string]: accentColor, ...shellStyle }}
        className={`group relative flex min-h-[640px] flex-col overflow-hidden rounded-[15px] border text-left text-white transition duration-300 md:min-h-[680px] ${
          isFree ? 'border-white/10 bg-[#15171a] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_38px_rgba(255,255,255,0.035)]' : 'border-white/10'
        } ${props.selected ? 'brightness-110 ring-2 ring-white/10' : ''} ${props.disabled ? 'opacity-72' : 'hover:-translate-y-1 hover:brightness-110'}`}
      >
        {props.badge ? (
          <div className="flex h-9 items-center justify-center text-[11px] font-black uppercase tracking-wide text-white" style={{ backgroundColor: accentColor }}>
            {props.badge}
          </div>
        ) : (
          <div className="h-9" aria-hidden="true" />
        )}
        <div className="relative m-4 overflow-hidden rounded-[13px] border border-white/8 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" style={heroStyle}>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,rgba(255,255,255,0.18),transparent_24%,transparent_70%,rgba(255,255,255,0.08))]" />
          <div className="relative flex min-h-[34px] items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[28px] font-black uppercase leading-none tracking-tight">{props.title}</h3>
                {props.versionBadge ? (
                  <span className="rounded-[4px] bg-[#63dff0] px-2 py-0.5 text-[10px] font-black uppercase italic text-[#07242b] shadow-[0_0_18px_rgba(99,223,240,0.35)]">
                    {props.versionBadge}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 min-h-[42px] line-clamp-2 text-sm leading-5 text-white/58">{props.subtitle}</p>
            </div>
            {!isFree ? (
              <span className="shrink-0 whitespace-nowrap rounded-[4px] px-2 py-1 text-[10px] font-black uppercase text-white" style={{ backgroundColor: accentColor, boxShadow: `0 0 18px ${accentRgb(accentColor, 0.45)}` }}>
                {selectedVersion}
              </span>
            ) : null}
          </div>
          <div className="relative mt-5 rounded-[10px] bg-white/[0.075] p-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black">* {props.otherTitle || (isProMax ? 'Maximum access' : isPro ? 'Full sampler tools' : props.variant === 'standard' ? 'Core installer' : 'Starter access')}</div>
                {props.otherBody ? <div className="mt-2 min-h-[40px] text-sm leading-relaxed text-white/58">{props.otherBody}</div> : null}
              </div>
            </div>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/22">
              <div
                className={`h-full rounded-full ${props.variant === 'pro' && selectedVersion !== 'V1' ? 'transition-all duration-500 ease-out' : ''}`}
                style={{ width: `${meterPercent}%`, backgroundColor: accentColor, boxShadow: `0 0 18px ${accentRgb(accentColor, 0.35)}` }}
              />
            </div>
            <div className="mt-4 flex justify-between text-xs font-bold text-white/65">
              <span>{isFree ? 'Limited' : 'Unlocked'}</span>
              <span>{isProMax ? 'Maximum' : isFree ? 'Starter' : props.variant === 'standard' ? 'Standard' : 'Pro'}</span>
            </div>
          </div>
        </div>
        <div className="relative flex min-h-[166px] flex-col justify-end px-4">
          <div className="flex flex-wrap items-end gap-2">
            {props.previousPrice ? <span className="text-[28px] font-black line-through decoration-2" style={{ color: accentColor }}>{props.previousPrice}</span> : null}
            <span className="text-[42px] font-black leading-none tracking-tight">{props.price}</span>
            {!isFree && <span className="pb-1 text-xs text-white/46">one-time request</span>}
          </div>
          <div className="mt-2 text-xs text-white/46">{props.variant === 'free' ? 'No payment checkout.' : 'Payment proof is reviewed by admin.'}</div>
          <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            style={buttonStyle}
            className={`mt-4 flex h-12 w-full items-center justify-center rounded-[10px] text-sm font-black uppercase transition disabled:cursor-not-allowed ${props.disabled ? disabledButtonClass : isFree ? 'bg-white text-slate-950' : 'text-white'}`}
          >
            {props.cta}
            {!props.disabled ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
          </button>
        </div>
        {props.children}
        <div className="relative mt-5 space-y-2 px-4">
          {props.features.map((item) => (
            <div key={item} className="flex items-start gap-2.5 text-[13px] font-bold text-white/92">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ color: isFree ? 'rgba(255,255,255,0.7)' : accentColor }}>
                <Check className="h-3.5 w-3.5" />
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="relative mx-4 mt-5 rounded-[10px] border border-white/7 bg-white/[0.04] p-3 text-white">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-white/88">
            {props.inclusionTitle || (isProMax ? 'Store Access' : 'Included Tools')}
          </div>
          <div className="space-y-2 text-xs text-white/66">
            {inclusions.map((item) => (
              <div key={`${props.id}:${item.title}:${item.badge}`} className="flex items-center justify-between gap-3">
                <span>{item.title}</span>
                <span className={`rounded px-1.5 py-0.5 font-black ${item.enabled ? 'bg-[#b9ff12] text-slate-950 shadow-[0_0_18px_rgba(185,255,18,0.35)]' : 'bg-white/10 text-white/55'}`}>
                  {item.badge}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-auto pb-4" />
      </div>
    );
  };

  const scrollMobilePlanRailTo = React.useCallback((index: number, behavior: ScrollBehavior) => {
    const rail = planRailRef.current;
    const target = rail?.children.item(index) as HTMLElement | null;
    if (!rail || !target) return;
    if (planRailAnimationRef.current !== null) {
      window.cancelAnimationFrame(planRailAnimationRef.current);
      planRailAnimationRef.current = null;
    }
    const railRect = rail.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centeredLeft = rail.scrollLeft + targetRect.left - railRect.left - Math.max(0, (railRect.width - targetRect.width) / 2);
    const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const nextLeft = Math.max(0, Math.min(maxLeft, centeredLeft));
    planRailProgrammaticScrollUntilRef.current = Date.now() + (behavior === 'smooth' ? 420 : 120);
    if (behavior !== 'smooth') {
      rail.scrollLeft = nextLeft;
      return;
    }
    rail.scrollTo({ left: nextLeft, behavior: 'smooth' });
  }, []);

  const scrollPageToPlanRailTop = React.useCallback((behavior: ScrollBehavior) => {
    const shell = planRailShellRef.current;
    if (!shell) return;
    const top = window.scrollY + shell.getBoundingClientRect().top - 12;
    window.scrollTo({ top: Math.max(0, top), left: 0, behavior });
  }, []);

  const syncMobilePlanFromScroll = React.useCallback((cardCount: number) => {
    const rail = planRailRef.current;
    if (!rail || !cardCount) return;
    if (Date.now() < planRailProgrammaticScrollUntilRef.current) return;
    if (planRailScrollSyncRef.current !== null) {
      window.clearTimeout(planRailScrollSyncRef.current);
    }
    planRailScrollSyncRef.current = window.setTimeout(() => {
      const railRect = rail.getBoundingClientRect();
      const railCenter = railRect.left + railRect.width / 2;
      let nearestIndex = mobilePlanIndex;
      let nearestDistance = Number.POSITIVE_INFINITY;
      Array.from(rail.children).forEach((child, index) => {
        const childRect = (child as HTMLElement).getBoundingClientRect();
        const childCenter = childRect.left + childRect.width / 2;
        const distance = Math.abs(childCenter - railCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      if (nearestIndex !== mobilePlanIndex) {
        setMobileSlideDirection(nearestIndex > mobilePlanIndex ? 'next' : 'prev');
        setMobilePlanIndex(Math.max(0, Math.min(cardCount - 1, nearestIndex)));
      }
    }, 90);
  }, [mobilePlanIndex]);

  const showMobilePlan = React.useCallback((nextIndex: number, cardCount: number) => {
    if (!cardCount) return;
    const normalized = (nextIndex + cardCount) % cardCount;
    if (normalized === mobilePlanIndex && nextIndex === mobilePlanIndex) return;
    const direction = nextIndex >= cardCount
      ? 'next'
      : nextIndex < 0
        ? 'prev'
        : normalized > mobilePlanIndex ? 'next' : 'prev';
    setMobileSlideDirection(direction);
    setMobilePlanIndex(normalized);
    scrollPageToPlanRailTop('smooth');
    window.requestAnimationFrame(() => {
      scrollMobilePlanRailTo(normalized, 'smooth');
    });
  }, [mobilePlanIndex, scrollMobilePlanRailTo, scrollPageToPlanRailTop]);

  const renderPlanCarousel = (cards: React.ReactNode[]) => (
    <div ref={planRailShellRef} className="relative rounded-[1.6rem] border border-white/10 bg-white/[0.025] py-4 md:border-0 md:bg-transparent md:py-0">
      <div
        ref={planRailRef}
        onScroll={() => syncMobilePlanFromScroll(cards.length)}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-3 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((card, index) => (
          <div
            key={index}
            data-slide-direction={mobileSlideDirection}
            className={`vdjv-pricing-mobile-plan-card w-[min(86vw,430px)] shrink-0 snap-center md:w-auto md:scale-100 md:opacity-100 ${
              index === mobilePlanIndex ? 'vdjv-pricing-mobile-plan-card-active' : ''
            }`}
          >
            {card}
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-label="Previous plan"
        disabled={cards.length <= 1}
        onClick={() => showMobilePlan(mobilePlanIndex - 1, cards.length)}
        className="absolute left-1 top-24 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/18 text-white shadow-[0_14px_34px_rgba(0,0,0,0.3)] backdrop-blur transition disabled:opacity-35 md:hidden"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Next plan"
        disabled={cards.length <= 1}
        onClick={() => showMobilePlan(mobilePlanIndex + 1, cards.length)}
        className="absolute right-1 top-24 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/18 text-white shadow-[0_14px_34px_rgba(0,0,0,0.3)] backdrop-blur transition disabled:opacity-35 md:hidden"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
      <div className="mt-4 flex justify-center gap-1.5 md:hidden">
        {cards.map((_, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Show plan ${index + 1}`}
            onClick={() => showMobilePlan(index, cards.length)}
            className={`h-1.5 rounded-full transition-all ${index === mobilePlanIndex ? 'w-7 bg-pink-500' : 'w-2 bg-white/25'}`}
          />
        ))}
      </div>
    </div>
  );

  const renderV1Plans = () => {
    const freeContent = normalizeTierUiContent(v1FreeTier.uiContent, 'free');
    const proContent = normalizeTierUiContent(v1ProTier.uiContent, 'pro');
    const proMaxContent = normalizeTierUiContent(v1ProMaxTier.uiContent, 'pro_max');
    const proPrice = Number(v1ProTier.quote?.quotePrice ?? v1ProTier.pricePhp);
    const proPromo = getPromoDiscountPercent(v1ProTier);
    const proMaxPrice = Number(v1ProMaxTier.quote?.quotePrice ?? v1ProMaxTier.pricePhp);
    const proMaxPromo = getPromoDiscountPercent(v1ProMaxTier);
    return renderPlanCarousel([
      renderPlanShell({
        id: 'v1-free',
        title: v1FreeTier.displayName || 'FREE',
        subtitle: freeContent.shortDescriptions[0] || v1FreeTier.description || 'Try the standalone V1 flow before creating a paid account.',
        price: 'Free',
        badge: freeContent.cardHeader.enabled ? freeContent.cardHeader.label || 'Base access' : undefined,
        variant: 'free',
        accentColor: freeContent.color,
        meterPercent: freeContent.meterPercent,
        otherTitle: freeContent.otherDescriptions[0]?.title,
        otherBody: freeContent.otherDescriptions[0]?.body,
        features: freeContent.checklist,
        inclusionTitle: freeContent.inclusionTitle,
        inclusions: freeContent.inclusions,
        cta: 'Register Free',
        selected: selectedV1Plan === 'free',
        onClick: selectFreeV1,
      }),
      renderPlanShell({
        id: 'v1-pro',
        title: v1ProTier.displayName || 'PRO',
        subtitle: proContent.shortDescriptions[0] || v1ProTier.description || activeBuySection.description || 'Create a V1 account with admin-reviewed payment proof.',
        price: formatPhp(proPrice),
        previousPrice: proPromo > 0 ? formatPhp(getBeforePromoPrice(proPrice, proPromo)) : null,
        badge: proContent.cardHeader.enabled ? proContent.cardHeader.label || 'Most popular' : undefined,
        versionBadge: proContent.versionBadge.enabled ? proContent.versionBadge.label : undefined,
        variant: 'pro',
        accentColor: proContent.color,
        meterPercent: proContent.meterPercent,
        otherTitle: proContent.otherDescriptions[0]?.title,
        otherBody: proContent.otherDescriptions[0]?.body,
        features: proContent.checklist,
        inclusionTitle: proContent.inclusionTitle,
        inclusions: proContent.inclusions,
        cta: `Get V1 ${v1ProTier.displayName || 'PRO'}`,
        selected: selectedV1Plan === 'pro' && checkoutStarted,
        onClick: () => startV1Checkout('pro'),
      }),
      renderPlanShell({
        id: 'v1-pro-max',
        title: v1ProMaxTier.displayName || 'PRO MAX',
        subtitle: proMaxContent.shortDescriptions[0] || v1ProMaxTier.description || 'For users who need the highest V1 access path and direct guidance.',
        price: proMaxPrice > 0 ? formatPhp(proMaxPrice) : 'Contact',
        previousPrice: proMaxPromo > 0 && proMaxPrice > 0 ? formatPhp(getBeforePromoPrice(proMaxPrice, proMaxPromo)) : null,
        badge: proMaxContent.cardHeader.enabled ? proMaxContent.cardHeader.label || 'Best value' : undefined,
        versionBadge: proMaxContent.versionBadge.enabled ? proMaxContent.versionBadge.label : undefined,
        variant: 'pro_max',
        accentColor: proMaxContent.color,
        meterPercent: proMaxContent.meterPercent,
        otherTitle: proMaxContent.otherDescriptions[0]?.title,
        otherBody: proMaxContent.otherDescriptions[0]?.body,
        features: proMaxContent.checklist,
        inclusionTitle: proMaxContent.inclusionTitle,
        inclusions: proMaxContent.inclusions,
        cta: `Get V1 ${v1ProMaxTier.displayName || 'PRO MAX'}`,
        selected: selectedV1Plan === 'pro_max' && checkoutStarted,
        onClick: () => startV1Checkout('pro_max'),
      }),
    ]);
  };

  const renderInstallerPlans = () => {
    const standardTierConfig = getInstallerTierConfig('standard');
    const proTierConfig = getInstallerTierConfig('pro');
    const proMaxTierConfig = getInstallerTierConfig('pro_max');
    const standardContent = normalizeInstallerTierUiContent(standardTierConfig?.uiContent, 'standard');
    const proContent = normalizeInstallerTierUiContent(proTierConfig?.uiContent, 'pro');
    const proMaxContent = normalizeInstallerTierUiContent(proMaxTierConfig?.uiContent, 'pro_max');
    const updateRatio = updateProducts.length > 0 ? proSelectedUpdates.length / updateProducts.length : 0;
    const configuredProMeter = Number(proContent.meterPercent);
    const proMeterBase = Number.isFinite(configuredProMeter) ? configuredProMeter : 34;
    const proMeterPercent = proMode
      ? Math.min(100, Math.round((proMode === 'standard_update' ? Math.max(proMeterBase, 58) : Math.max(34, proMeterBase - 24)) + updateRatio * (proMode === 'standard_update' ? 42 : 66)))
      : proMeterBase;
    const proPrice = proSelectedProducts.length ? sumProducts(proSelectedProducts) : null;
    const standardDisplayName = standardTierConfig?.displayName || standardProduct?.displayName || 'STANDARD';
    const proDisplayName = proTierConfig?.displayName || 'PRO';
    const proMaxDisplayName = proMaxTierConfig?.displayName || promaxProduct?.displayName || 'PRO MAX';

    return renderPlanCarousel([
      renderPlanShell({
        id: `${selectedVersion.toLowerCase()}-standard`,
        title: standardDisplayName,
        subtitle: standardContent.shortDescriptions[0] || standardTierConfig?.description || standardProduct?.description || `Core ${selectedVersion} installer package.`,
        price: formatPhp(standardProduct?.pricePhp ?? null),
        badge: standardContent.cardHeader.enabled ? standardContent.cardHeader.label || 'Standard' : undefined,
        versionBadge: standardContent.versionBadge.enabled ? standardContent.versionBadge.label || selectedVersion : undefined,
        variant: 'standard',
        accentColor: standardContent.color,
        meterPercent: standardContent.meterPercent,
        otherTitle: standardContent.otherDescriptions[0]?.title,
        otherBody: standardContent.otherDescriptions[0]?.body,
        features: standardContent.checklist,
        inclusionTitle: standardContent.inclusionTitle,
        inclusions: standardContent.inclusions,
        cta: `Get ${selectedVersion} Standard`,
        selected: selectedProducts.length === 1 && selectedProducts[0]?.productType === 'standard',
        disabled: !standardProduct,
        onClick: () => startInstallerCheckout('standard'),
      }),
      renderPlanShell({
        id: `${selectedVersion.toLowerCase()}-pro`,
        title: proDisplayName,
        subtitle: proContent.shortDescriptions[0] || proTierConfig?.description || 'Build a PRO request from Standard plus selected updates, or choose Update Only if Standard is already installed.',
        price: proPrice !== null ? formatPhp(proPrice) : 'Select',
        badge: proContent.cardHeader.enabled ? proContent.cardHeader.label || 'Flexible' : undefined,
        versionBadge: proContent.versionBadge.enabled ? proContent.versionBadge.label || selectedVersion : undefined,
        variant: 'pro',
        accentColor: proContent.color,
        meterPercent: proMeterPercent,
        otherTitle: proContent.otherDescriptions[0]?.title || (proMode === 'update_only' ? 'Update Only' : 'Standard + Update'),
        otherBody: proContent.otherDescriptions[0]?.body || (proMode === 'update_only'
          ? 'For users who already have Standard installed and only need selected update packages.'
          : 'Bundle Standard with one or more update packages in one checkout request.'),
        features: proContent.checklist,
        inclusionTitle: proContent.inclusionTitle,
        inclusions: ensureInstallerProDynamicInclusions(proContent.inclusions).map((item) => {
          if (/selected updates/i.test(item.title)) {
            return { ...item, badge: `${proSelectedUpdates.length}/${Math.max(1, updateProducts.length)}`, enabled: proSelectedUpdates.length > 0 };
          }
          if (/standard/i.test(item.title)) {
            return { ...item, badge: proMode === 'update_only' ? 'OWNED' : item.badge, enabled: true };
          }
          return item;
        }),
        cta: `Get ${selectedVersion} ${proDisplayName}`,
        selected: selectedProducts.some((product) => product.productType === 'update') && !selectedProducts.some((product) => product.productType === 'promax'),
        disabled: updateProducts.length === 0,
        onClick: () => startInstallerCheckout('pro'),
        children: (
          <div className="mx-4 mt-4 rounded-[12px] border border-white/10 bg-white/[0.055] p-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'standard_update' as const, label: 'Standard + Update', title: 'Choose this if you are a new user and do not have any VDJV installed yet.' },
                { value: 'update_only' as const, label: 'Update Only', title: 'Use this if you already installed the Standard package.' },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.title}
                  onClick={() => {
                    if (selectedVersion === 'V1') return;
                    setProModeByVersion((current) => ({ ...current, [selectedVersion as InstallerVersion]: option.value }));
                    setCheckoutStarted(false);
                    setError('');
                  }}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left text-xs font-black uppercase transition ${
                    proMode === option.value
                      ? 'border-[#f21984] bg-[#f21984]/20 text-white shadow-[0_0_22px_rgba(242,25,132,0.24)]'
                      : 'border-white/10 bg-black/18 text-white/64 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span>{option.label}</span>
                  <Info className="h-3.5 w-3.5 shrink-0 opacity-80" />
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {updateProducts.length ? updateProducts.map((product) => {
                const active = proUpdateSkus.includes(product.skuCode);
                return (
                  <button
                    key={product.skuCode}
                    type="button"
                    onClick={() => {
                      toggleProUpdate(product);
                      setCheckoutStarted(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-left text-xs transition ${
                      active
                        ? 'border-[#f21984] bg-[#f21984]/18 text-white shadow-[0_0_18px_rgba(242,25,132,0.22)]'
                        : 'border-white/10 bg-black/18 text-white/62 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="min-w-0 font-bold">{product.displayName}</span>
                    <span className="shrink-0 font-black">{formatPhp(product.pricePhp)}</span>
                  </button>
                );
              }) : (
                <div className="rounded-[10px] border border-dashed border-white/15 px-3 py-3 text-xs text-white/52">
                  No update SKUs are published for {selectedVersion}.
                </div>
              )}
            </div>
          </div>
        ),
      }),
      renderPlanShell({
        id: `${selectedVersion.toLowerCase()}-pro-max`,
        title: proMaxDisplayName,
        subtitle: proMaxContent.shortDescriptions[0] || proMaxTierConfig?.description || promaxProduct?.description || `Maximum ${selectedVersion} installer package.`,
        price: formatPhp(promaxProduct?.pricePhp ?? null),
        badge: proMaxContent.cardHeader.enabled ? proMaxContent.cardHeader.label || 'Best value' : undefined,
        versionBadge: proMaxContent.versionBadge.enabled ? proMaxContent.versionBadge.label || selectedVersion : undefined,
        variant: 'pro_max',
        accentColor: proMaxContent.color,
        meterPercent: proMaxContent.meterPercent,
        otherTitle: proMaxContent.otherDescriptions[0]?.title,
        otherBody: proMaxContent.otherDescriptions[0]?.body,
        features: proMaxContent.checklist,
        inclusionTitle: proMaxContent.inclusionTitle,
        inclusions: proMaxContent.inclusions,
        cta: `Get ${selectedVersion} PRO MAX`,
        selected: selectedProducts.length === 1 && selectedProducts[0]?.productType === 'promax',
        disabled: !promaxProduct,
        onClick: () => startInstallerCheckout('promax'),
      }),
    ]);
  };

  const renderCheckout = () => (
    <div className="rounded-[18px] border border-white/10 bg-[#0e1016] p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)]">
      {loading ? (
        <div className="flex items-center justify-center py-20 text-white/55">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading pricing...
        </div>
      ) : result ? (
        <div className="space-y-4">
          <PaymentReceiptCard
            theme="dark"
            title={result.status === 'approved' ? 'Approved' : 'Pending Approval'}
            subtitle={result.message}
            amountLabel="Purchase"
            amountValue={result.version === 'V1' ? selectedCheckoutTitle : result.purchaseLabel}
            status={result.status === 'approved' ? 'success' : 'pending'}
            statusLabel={result.status === 'approved' ? 'Approved' : 'Pending Approval'}
            lineItems={[
              { label: 'Email', value: result.email },
              { label: 'Receipt Reference', value: result.receiptReference, copyValue: result.receiptReference },
              { label: 'Payment Reference', value: result.paymentReference || '-' },
              ...(result.version !== 'V1' && result.status === 'approved' && result.licenseCode
                ? [{ label: 'License Code', value: result.licenseCode, copyValue: result.licenseCode }]
                : []),
            ]}
            primaryAction={{
              label: result.status === 'approved' ? 'Start New Purchase' : 'Submit Another Receipt',
              onClick: () => {
                setResult(null);
                setCheckoutStarted(false);
                setError('');
              },
            }}
            secondaryAction={messengerUrl
              ? { label: 'Message Us On Facebook', onClick: () => window.open(messengerUrl, '_blank', 'noopener,noreferrer') }
              : undefined}
          />

          {result.version === 'V1' && result.status === 'approved' && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
              <div className="mb-3 text-sm font-semibold">You can log in now</div>
              <div className="mb-4 text-sm text-white/58">{result.email}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['android', 'ios', 'windows', 'macos'] as PlatformKey[]).map((platform) => (
                  <Button
                    key={platform}
                    type="button"
                    variant="outline"
                    className="justify-between border-white/10 bg-white/10 text-white hover:bg-white/16 hover:text-white"
                    onClick={() => window.open(getInstallerRedirectPath('V1', platform), '_blank', 'noopener,noreferrer')}
                  >
                    <span>{platformButtonLabel[platform]}</span>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                ))}
              </div>
            </div>
          )}

          {result.version !== 'V1' && result.status === 'approved' && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
              <div className="mb-2 text-sm font-semibold">License Ready</div>
              {result.licenseCode ? <CopyableValue value={result.licenseCode} label="license code" wrap /> : null}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(['android', 'ios', 'windows', 'macos'] as PlatformKey[])
                  .filter((platform) => Boolean(result.installerDownloadLinks?.[platform] || config.config.downloadLinks[result.version][platform]))
                  .map((platform) => {
                    return (
                      <Button
                        key={`installer-${platform}`}
                        type="button"
                        variant="outline"
                        className="justify-between border-white/10 bg-white/10 text-white hover:bg-white/16 hover:text-white"
                        onClick={() => window.open(getInstallerRedirectPath(result.version, platform), '_blank', 'noopener,noreferrer')}
                      >
                        <span>{platformButtonLabel[platform]}</span>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.22em] text-[#f21984]">Checkout</div>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-black">{checkoutStarted ? selectedCheckoutTitle : 'Choose a plan'}</div>
                <div className="mt-1 text-sm text-white/55">{checkoutStarted ? 'Submit payment details for admin review.' : 'Use a GET button on a pricing card to continue.'}</div>
              </div>
              <div className="text-right text-3xl font-black">{checkoutStarted ? selectedPriceText : '-'}</div>
            </div>
          </div>

          {error ? <div className="rounded-xl border border-rose-400/30 bg-rose-500/12 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

          <div className="space-y-1">
            <Label className="text-white/72">Email</Label>
            <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className={darkInputClass} />
          </div>

          {selectedVersion === 'V1' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-white/72">Password</Label>
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className={darkInputClass} />
              </div>
              <div className="space-y-1">
                <Label className="text-white/72">Confirm Password</Label>
                <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat password" className={darkInputClass} />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Payment</div>
            <p className="mb-4 text-sm text-white/58">{config.paymentConfig.instructions || 'Follow the payment details below and submit your proof.'}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {config.paymentConfig.gcash_number ? (
                <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-blue-300/20 bg-blue-500/10 p-3 text-center">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-500">GCash</div>
                  <CopyableValue
                    value={config.paymentConfig.gcash_number}
                    label="GCash number"
                    wrap
                    onCopied={() => openWalletAppAfterCopy('gcash')}
                    className="max-w-full justify-center"
                    valueClassName="font-mono text-lg font-medium break-all whitespace-normal text-center text-white"
                    buttonClassName="text-blue-200 hover:bg-blue-500/20"
                  />
                </div>
              ) : null}
              {config.paymentConfig.maya_number ? (
                <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-lime-300/20 bg-lime-500/10 p-3 text-center">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-green-500">Maya</div>
                  <CopyableValue
                    value={config.paymentConfig.maya_number}
                    label="Maya number"
                    wrap
                    onCopied={() => openWalletAppAfterCopy('maya')}
                    className="max-w-full justify-center"
                    valueClassName="font-mono text-lg font-medium break-all whitespace-normal text-center text-white"
                    buttonClassName="text-lime-200 hover:bg-lime-500/20"
                  />
                </div>
              ) : null}
            </div>
            {config.paymentConfig.qr_image_path ? (
              <div className="mt-4 flex flex-col items-center justify-center border-t border-white/10 pt-4">
                <span className="text-sm font-medium tracking-wide text-white/58">Scan to Pay</span>
                <button
                  type="button"
                  onClick={() => setExpandedQrUrl(config.paymentConfig.qr_image_path || null)}
                  className="relative mt-3 flex min-h-[220px] w-[min(70vw,220px)] max-w-[min(70vw,220px)] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white p-2 transition-opacity hover:opacity-90"
                >
                  {!qrImageLoaded && !qrImageFailed ? (
                    <div className="absolute inset-2 flex flex-col items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                      <span className="text-xs font-semibold">Loading QR...</span>
                    </div>
                  ) : null}
                  {qrImageFailed ? (
                    <div className="absolute inset-2 flex flex-col items-center justify-center rounded-lg bg-rose-50 px-3 text-center text-xs font-semibold text-rose-600">
                      QR image did not load. Use Download QR or refresh.
                    </div>
                  ) : null}
                  <img
                    src={config.paymentConfig.qr_image_path}
                    alt="Payment QR"
                    onLoad={() => {
                      setQrImageLoaded(true);
                      setQrImageFailed(false);
                    }}
                    onError={() => setQrImageFailed(true)}
                    className={`block h-auto max-h-[240px] w-auto max-w-[min(64vw,200px)] rounded-lg object-contain transition-opacity ${qrImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  />
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-8 border-white/10 bg-white/10 px-3 text-xs text-white hover:bg-white/16 hover:text-white"
                  disabled={qrDownloadBusy}
                  onClick={() => void downloadQrImage(config.paymentConfig.qr_image_path!)}
                >
                  {qrDownloadBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                  {qrDownloadBusy ? 'Preparing QR...' : 'Download QR'}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/72">Payment Channel</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {PAYMENT_CHANNEL_OPTIONS.map((option) => {
                const selectedChannel = paymentChannel === option.value;
                const activeClass = option.accent === 'green'
                  ? 'border-lime-300/60 bg-lime-500/16 text-lime-100'
                  : option.accent === 'blue'
                    ? 'border-blue-300/60 bg-blue-500/16 text-blue-100'
                    : 'border-[#f21984] bg-[#f21984]/18 text-white';
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPaymentChannel(option.value)}
                    className={`rounded-[12px] border p-3 text-left transition ${selectedChannel ? activeClass : 'border-white/10 bg-white/[0.055] text-white/58 hover:bg-white/10 hover:text-white'}`}
                  >
                    <div className="text-xs font-black uppercase tracking-wide">{option.title}</div>
                    <div className="mt-1 text-[11px] opacity-75">{option.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {(paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-white/72">Account Name Used For Payment</Label>
                <Input value={payerName} onChange={(event) => setPayerName(event.target.value)} className={darkInputClass} />
              </div>
              <div className="space-y-1">
                <Label className="text-white/72">Reference / Transaction No.</Label>
                <Input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} className={darkInputClass} />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-white/72">Upload Receipt / Proof</Label>
            <div className="flex items-center gap-3">
              {proofPreviewUrl ? <img src={proofPreviewUrl} alt="Payment proof preview" className="h-14 w-14 rounded-[10px] border border-white/15 object-cover" /> : null}
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                onChange={(event) => setProofFile(event.target.files?.[0] || null)}
                className="border-white/15 bg-white/[0.08] text-white file:mr-3 file:rounded-md file:border-0 file:bg-[#f21984] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#ff168c]"
              />
            </div>
            {proofFile ? <div className="text-xs text-white/45">{proofFile.name}</div> : null}
          </div>

          <div className="space-y-1">
            <Label className="text-white/72">Optional Notes</Label>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional extra info" className={darkInputClass} />
          </div>

          {!hasPublishedProducts ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.045] px-3 py-3 text-sm text-white/58">
              Publish at least one {selectedVersion} SKU in Admin Access before buyers can submit this checkout.
            </div>
          ) : null}

          <Button type="submit" className="w-full bg-[#ed0d7c] font-black text-white shadow-[0_14px_36px_rgba(237,13,124,0.32)] hover:bg-[#ff168c]" disabled={submitDisabled}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {submitting ? 'Submitting...' : checkoutStarted ? `Get ${selectedCheckoutTitle}` : 'Choose a Plan First'}
          </Button>

          {messengerUrl ? (
            <div className="text-center text-xs text-white/45">
              Keep your receipt reference and message us on{' '}
              <a className="font-semibold text-amber-200 underline underline-offset-4" href={messengerUrl} target="_blank" rel="noreferrer">
                Facebook Messenger
              </a>.
            </div>
          ) : null}
        </form>
      )}
    </div>
  );

  const renderPricingSkeleton = () => (
    <div className="relative rounded-[1.6rem] border border-white/10 bg-white/[0.025] py-4 md:border-0 md:bg-transparent md:py-0">
      <div className="flex gap-4 overflow-hidden px-6 md:grid md:grid-cols-3 md:px-0">
        {[0, 1, 2].map((index) => (
          <div key={index} className="w-[min(86vw,430px)] shrink-0 md:w-auto">
            <div className="min-h-[640px] animate-pulse rounded-[15px] border border-white/10 bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="h-9 rounded bg-white/10" />
              <div className="mt-4 h-52 rounded-[13px] bg-white/10" />
              <div className="mt-5 h-8 w-36 rounded bg-white/10" />
              <div className="mt-4 h-12 rounded-[10px] bg-white/10" />
              <div className="mt-8 space-y-3">
                <div className="h-3 rounded bg-white/10" />
                <div className="h-3 rounded bg-white/10" />
                <div className="h-3 w-4/5 rounded bg-white/10" />
              </div>
              <div className="mt-8 h-28 rounded-[10px] bg-white/10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-[#07090d] text-white">
      <style>{`
        .lp-version-label {
          color: rgba(255,255,255,0.52);
        }
        .lp-version-options {
          background: rgba(255,255,255,0.075);
          border-color: rgba(255,255,255,0.12);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .lp-version-liquid {
          background: linear-gradient(135deg, #f21984, #ef4444);
          box-shadow: 0 10px 28px rgba(242,25,132,0.32);
        }
        .lp-version-option {
          color: rgba(255,255,255,0.62);
        }
        .lp-version-option:hover,
        .lp-version-option.is-active {
          color: #fff;
        }
        @media (max-width: 767px) {
          .vdjv-pricing-mobile-plan-card {
            opacity: 0.72;
            transform: translateX(0) scale(0.965);
            transition: opacity 220ms ease, transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 220ms ease;
            filter: saturate(0.78);
          }
          .vdjv-pricing-mobile-plan-card-active {
            opacity: 1;
            transform: translateX(0) scale(1);
            filter: saturate(1);
          }
          .vdjv-pricing-mobile-plan-card[data-slide-direction="next"]:not(.vdjv-pricing-mobile-plan-card-active) {
            transform: translateX(-6px) scale(0.965);
          }
          .vdjv-pricing-mobile-plan-card[data-slide-direction="prev"]:not(.vdjv-pricing-mobile-plan-card-active) {
            transform: translateX(6px) scale(0.965);
          }
        }
      `}</style>
      <header className="border-b border-white/10 bg-[#07090d]/82 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
          <Link to={landingPagePath} className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="VDJV logo" className="h-10 w-10 rounded-xl border border-white/10 bg-white object-contain p-1" />
            <span className="text-lg font-semibold tracking-[0.015em] text-white">VDJV Sampler Pad App</span>
          </Link>
          <Button asChild className="border border-white/10 bg-white/10 text-white hover:bg-white/16 hover:text-white">
            <Link to={landingPagePath}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back Home
            </Link>
          </Button>
        </div>
      </header>

      <section className="relative mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[420px] bg-[radial-gradient(72%_58%_at_50%_0%,rgba(242,25,132,0.24),transparent_68%)]" />
        {!isCheckoutPage ? renderPreview() : null}
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#f21984]">VDJV Pricing</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-6xl">
            {isCheckoutPage ? 'Checkout' : 'Choose Your Version'}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-white/58">
            {isCheckoutPage
              ? 'Submit payment details for admin review and keep the receipt reference after sending.'
              : 'Select a version, compare the pricing cards, then continue with the checkout flow that matches your setup.'}
          </p>
        </div>

        {isCheckoutPage ? (
          <div className="mx-auto mt-8 max-w-3xl">
            <Button
              type="button"
              variant="outline"
              className="mb-4 border-white/10 bg-white/10 text-white hover:bg-white/16 hover:text-white"
              onClick={() => navigate(selectedVersion === 'V1' ? pricingPath : `${pricingPath}?version=${selectedVersion}`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to pricing
            </Button>
            {renderCheckout()}
          </div>
        ) : (
          <div>
            <div className="mx-auto mt-7 max-w-xl rounded-[18px] border border-white/10 bg-white/[0.045] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <VersionSelector value={selectedVersion} onChange={handleVersionChange} />
            </div>

            {error && !checkoutStarted ? (
              <div className="mx-auto mt-5 max-w-3xl rounded-xl border border-rose-400/30 bg-rose-500/12 px-3 py-2 text-sm text-rose-100">{error}</div>
            ) : null}

            <div className="relative mt-8 space-y-6">
              {loading ? renderPricingSkeleton() : selectedVersion === 'V1' ? renderV1Plans() : renderInstallerPlans()}

              <div className="rounded-[18px] border border-white/10 bg-white/[0.045] p-5 text-sm leading-7 text-white/58 shadow-[0_18px_54px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="text-sm font-black uppercase tracking-[0.18em] text-white">{activeBuySection.title}</div>
                <p className="mt-2">{activeBuySection.description}</p>
                <p className="mt-3">{activeVersionDescription.desc}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {expandedQrUrl && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4" onClick={() => setExpandedQrUrl(null)}>
          <div className="relative flex max-h-[90vh] max-w-[95vw] flex-col items-center" onClick={(event) => event.stopPropagation()}>
            <div className="flex max-h-[82vh] max-w-[min(92vw,40rem)] items-center justify-center rounded-xl border bg-white p-3 shadow-2xl">
              <img
                src={expandedQrUrl}
                alt="Expanded payment QR"
                className="block h-auto max-h-[76vh] w-auto max-w-[min(88vw,36rem)] object-contain"
              />
            </div>
            <div className="mt-2 flex justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-slate-900 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
                disabled={qrDownloadBusy}
                onClick={() => void downloadQrImage(expandedQrUrl)}
              >
                {qrDownloadBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                {qrDownloadBusy ? 'Preparing QR...' : 'Download QR'}
              </Button>
              <Button type="button" size="sm" onClick={() => setExpandedQrUrl(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {pricingNotice ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-[230] flex justify-center pointer-events-none">
          <div
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-[14px] border px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur ${
              pricingNotice.variant === 'error'
                ? 'border-rose-300/30 bg-rose-500/88'
                : pricingNotice.variant === 'success'
                  ? 'border-emerald-300/30 bg-emerald-600/88'
                  : 'border-white/15 bg-slate-900/90'
            }`}
            role="status"
          >
            <span>{pricingNotice.message}</span>
            <button type="button" className="ml-2 text-white/75 hover:text-white" onClick={() => setPricingNotice(null)}>Dismiss</button>
          </div>
        </div>
      ) : null}

      <footer className="px-5 pb-8 text-center text-xs text-white/45">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link className="hover:text-white" to={privacyPagePath}>Privacy Policy</Link>
          <Link className="hover:text-white" to={termsPagePath}>Terms of Service</Link>
        </div>
      </footer>
    </main>
  );
}
