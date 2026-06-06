import * as React from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyableValue } from '@/components/ui/copyable-value';
import { PaymentReceiptCard } from '@/components/ui/payment-receipt-card';
import { edgeFunctionUrl, getClientCompatibilityHeaders } from '@/lib/edge-api';
import { openWalletAppAfterCopy } from '@/lib/mobile-wallet-links';
import { supabase } from '@/lib/supabase';
import { useAuthActions, useAuthState } from '@/hooks/useAuth';
import {
  type AccountTierUiContent,
  accentRgb,
  DEFAULT_TIER_UI_CONTENT,
  getReadableTextColor,
  normalizeTierUiContent,
  resolveTierVideoSrc,
} from '@/lib/account-tier-content';

type TargetTier = 'pro' | 'pro_max';
type UpgradePlanTier = 'free' | TargetTier;
type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual';
type DialogStep = 'plans' | 'request';
type MobileSlideDirection = 'next' | 'prev';
type PlanView = {
  id: UpgradePlanTier;
  kind: 'free' | 'tier';
  tier?: UpgradeTierOption;
};

type UpgradeReceiptResult = {
  status: 'approved' | 'pending';
  planName: string;
  amountText: string;
  receiptReference: string;
  paymentReference: string;
  paymentChannel: string;
  submittedAt: string;
  message: string;
};

type UpgradeTierOption = {
  tier: TargetTier;
  displayName: string;
  description: string;
  pricePhp: number;
  promoDiscountPercent?: number;
  uiContent?: AccountTierUiContent | null;
  isActive: boolean;
  available: boolean;
  pendingRequest?: {
    id: string;
    receipt_reference?: string | null;
    created_at?: string | null;
    quote_price_php_snapshot?: number | null;
    source?: string | null;
  } | null;
  quote: {
    basePrice: number;
    creditPhp: number;
    quotePrice: number;
    promoDiscountPercent?: number;
  };
};

type PaymentConfig = {
  instructions?: string;
  gcash_number?: string;
  maya_number?: string;
  messenger_url?: string;
  qr_image_path?: string;
};

type CachedUpgradeOptions = {
  version: 3;
  userId: string;
  freeTier?: {
    tier: 'free';
    displayName: string;
    description: string;
    pricePhp: number;
    promoDiscountPercent?: number;
    uiContent?: AccountTierUiContent | null;
    isActive: boolean;
  } | null;
  tiers: UpgradeTierOption[];
  paymentConfig: PaymentConfig | null;
  fetchedAt: number;
};

interface AccountUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  pushNotice?: (notice: { variant: 'success' | 'error' | 'info'; message: string }) => void;
}

const UPGRADE_OPTIONS_CACHE_VERSION = 3;
const UPGRADE_OPTIONS_CACHE_PREFIX = 'vdjv-account-upgrade-options-v3';

const getUpgradeOptionsCacheKey = (userId: string): string => `${UPGRADE_OPTIONS_CACHE_PREFIX}:${userId}`;

const waitForSessionTick = (delayMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, delayMs));

const resolveCurrentAccessToken = async (): Promise<string | null> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    if (attempt === 1) {
      const refreshed = await supabase.auth.refreshSession().catch(() => null);
      if (refreshed?.data.session?.access_token) return refreshed.data.session.access_token;
    }
    await waitForSessionTick(250 + attempt * 150);
  }
  return null;
};

const readCachedUpgradeOptions = (userId: string | null | undefined): CachedUpgradeOptions | null => {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getUpgradeOptionsCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedUpgradeOptions>;
    if (parsed.version !== UPGRADE_OPTIONS_CACHE_VERSION) return null;
    if (parsed.userId !== userId || !Array.isArray(parsed.tiers) || !Number.isFinite(parsed.fetchedAt)) return null;
    return {
      version: UPGRADE_OPTIONS_CACHE_VERSION,
      userId,
      freeTier: (parsed.freeTier || null) as CachedUpgradeOptions['freeTier'],
      tiers: parsed.tiers as UpgradeTierOption[],
      paymentConfig: (parsed.paymentConfig || null) as PaymentConfig | null,
      fetchedAt: Number(parsed.fetchedAt),
    };
  } catch {
    return null;
  }
};

const writeCachedUpgradeOptions = (
  userId: string | null | undefined,
  freeTier: CachedUpgradeOptions['freeTier'],
  tiers: UpgradeTierOption[],
  paymentConfig: PaymentConfig | null,
): number => {
  const fetchedAt = Date.now();
  if (!userId || typeof window === 'undefined') return fetchedAt;
  try {
    const payload: CachedUpgradeOptions = {
      version: UPGRADE_OPTIONS_CACHE_VERSION,
      userId,
      freeTier,
      tiers,
      paymentConfig,
      fetchedAt,
    };
    window.localStorage.setItem(getUpgradeOptionsCacheKey(userId), JSON.stringify(payload));
  } catch {
    // Cache is a speed/offline optimization only. Submission remains server-authoritative.
  }
  return fetchedAt;
};

const formatPhp = (value: number): string =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const mapUpgradeError = (value: unknown): string => {
  const code = String(value || '').trim();
  switch (code) {
    case 'NOT_AUTHENTICATED':
      return 'Account session is still syncing. Please reopen upgrade pricing and submit again.';
    case 'ALREADY_ON_TIER':
      return 'Your account is already on this tier.';
    case 'ALREADY_ABOVE_TIER':
      return 'Your account already has a higher tier.';
    case 'PROOF_TOO_LARGE':
      return 'Payment proof is too large. Use a smaller image.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please try again later.';
    case 'UPGRADE_REQUEST_PENDING':
      return 'You already have a pending upgrade request. Wait for admin review before submitting another one.';
    default:
      return code || 'Upgrade request failed. Please try again.';
  }
};

const validateProofFile = (file: File | null): string | null => {
  if (!file) return 'Upload your receipt or payment proof.';
  if (file.size <= 0) return 'Selected proof file is empty.';
  if (file.size > 10 * 1024 * 1024) return 'Proof file is too large. Max is 10MB.';
  const name = file.name.toLowerCase();
  if (!/\.(png|jpg|jpeg|webp|gif|heic|heif)$/.test(name)) {
    return 'Unsupported proof image. Use PNG, JPG, WEBP, GIF, or HEIC.';
  }
  return null;
};

const tierLabel = (tier: TargetTier): string => tier === 'pro_max' ? 'PRO MAX' : 'PRO';
const DEFAULT_PROMO_DISCOUNT_PERCENT = 30;
const PAYMENT_CHANNEL_OPTIONS: Array<{ value: PaymentChannel; title: string; subtitle: string; accent: 'pink' | 'blue' | 'green' }> = [
  { value: 'image_proof', title: 'Receipt Upload', subtitle: 'Fastest admin review', accent: 'pink' },
  { value: 'gcash_manual', title: 'GCash Manual', subtitle: 'Enter sender and reference', accent: 'blue' },
  { value: 'maya_manual', title: 'Maya Manual', subtitle: 'Enter sender and reference', accent: 'green' },
];

const clampPromoDiscountPercent = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PROMO_DISCOUNT_PERCENT;
  return Math.min(90, Math.max(0, Math.round(parsed)));
};

const getPromoDiscountPercent = (tier: UpgradeTierOption | null | undefined): number =>
  clampPromoDiscountPercent(tier?.promoDiscountPercent ?? tier?.quote?.promoDiscountPercent);

const getBeforePromoPrice = (price: number, discountPercent: number): number => {
  if (!Number.isFinite(price) || price <= 0 || discountPercent <= 0 || discountPercent >= 100) return price;
  return Math.max(price, Math.round(price / (1 - discountPercent / 100)));
};

export function AccountUpgradeDialog({ open, onOpenChange, theme, pushNotice }: AccountUpgradeDialogProps) {
  const { user, profile, capabilities, loading: authLoading, authTransition } = useAuthState();
  const { getAuthenticatedAccessToken, refreshAccountCapabilities } = useAuthActions();
  const [loading, setLoading] = React.useState(false);
  const [optionsLoadMessage, setOptionsLoadMessage] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [submitting, setSubmitting] = React.useState(false);
  const [step, setStep] = React.useState<DialogStep>('plans');
  const [freeTier, setFreeTier] = React.useState<CachedUpgradeOptions['freeTier']>(null);
  const [tiers, setTiers] = React.useState<UpgradeTierOption[]>([]);
  const [paymentConfig, setPaymentConfig] = React.useState<PaymentConfig | null>(null);
  const [selectedTier, setSelectedTier] = React.useState<TargetTier>('pro');
  const [mobilePlanIndex, setMobilePlanIndex] = React.useState(0);
  const [mobileSlideDirection, setMobileSlideDirection] = React.useState<MobileSlideDirection>('next');
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof');
  const [payerName, setPayerName] = React.useState('');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = React.useState<string | null>(null);
  const [upgradeReceipt, setUpgradeReceipt] = React.useState<UpgradeReceiptResult | null>(null);
  const [optionsReloadKey, setOptionsReloadKey] = React.useState(0);
  const dialogBodyRef = React.useRef<HTMLDivElement | null>(null);
  const planRailShellRef = React.useRef<HTMLDivElement | null>(null);
  const planRailRef = React.useRef<HTMLDivElement | null>(null);
  const planRailScrollSyncRef = React.useRef<number | null>(null);
  const planRailAnimationRef = React.useRef<number | null>(null);
  const planRailProgrammaticScrollUntilRef = React.useRef(0);
  const skipNextPlanIndexAutoScrollRef = React.useRef(false);
  const selectedTierRef = React.useRef<TargetTier>(selectedTier);
  const isDark = theme === 'dark';

  React.useEffect(() => {
    selectedTierRef.current = selectedTier;
  }, [selectedTier]);

  React.useLayoutEffect(() => {
    if (!open) return;
    setMobileSlideDirection('next');
    setMobilePlanIndex(0);
    skipNextPlanIndexAutoScrollRef.current = false;
    dialogBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    planRailRef.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [open]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
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

  React.useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  React.useEffect(() => () => {
    if (planRailScrollSyncRef.current !== null) {
      window.clearTimeout(planRailScrollSyncRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleTierConfigUpdate = () => setOptionsReloadKey((value) => value + 1);
    window.addEventListener('vdjv-account-tier-config-updated', handleTierConfigUpdate);
    return () => window.removeEventListener('vdjv-account-tier-config-updated', handleTierConfigUpdate);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const userId = user?.id || profile?.id || null;
    const cached = readCachedUpgradeOptions(userId);
    const hasCachedOptions = Boolean(cached?.tiers?.length);
    const applyOptions = (
      nextFreeTier: CachedUpgradeOptions['freeTier'],
      nextTiers: UpgradeTierOption[],
      nextPaymentConfig: PaymentConfig | null,
    ) => {
      if (cancelled) return;
      setFreeTier(nextFreeTier);
      setTiers(nextTiers);
      setPaymentConfig(nextPaymentConfig);
      const firstAvailable = nextTiers.find((tier) => tier.available)?.tier || 'pro';
      const currentSelection = selectedTierRef.current;
      const nextSelected = nextTiers.some((tier) => tier.tier === currentSelection) ? currentSelection : firstAvailable;
      selectedTierRef.current = nextSelected;
      setSelectedTier(nextSelected);
    };

    setLoading(!hasCachedOptions);
    setOptionsLoadMessage(null);
    setStep('plans');
    setUpgradeReceipt(null);

    if (cached?.tiers?.length) {
      applyOptions(cached.freeTier || null, cached.tiers, cached.paymentConfig);
    }

    if (authLoading) {
      setLoading(true);
      return () => {
        cancelled = true;
      };
    }

    if (!online) {
      setLoading(false);
      setOptionsLoadMessage(hasCachedOptions ? '' : 'Reconnect to load upgrade pricing.');
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const token = await resolveCurrentAccessToken();
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const [optionsRes, paymentRes] = await Promise.all([
          fetch(edgeFunctionUrl('store-api', 'account/upgrade-options'), {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            headers: { ...getClientCompatibilityHeaders(), ...authHeaders },
          }),
          fetch(edgeFunctionUrl('store-api', 'payment-config'), { cache: 'no-store' }),
        ]);
        const optionsPayload = await optionsRes.json().catch(() => ({}));
        const optionsData = optionsPayload?.data && typeof optionsPayload.data === 'object' ? optionsPayload.data : optionsPayload;
        if (!optionsRes.ok) throw new Error(mapUpgradeError(optionsPayload?.error || optionsData?.error));
        const paymentPayload = await paymentRes.json().catch(() => ({}));
        const paymentData = paymentPayload?.data && typeof paymentPayload.data === 'object' ? paymentPayload.data : paymentPayload;
        const nextTiers = Array.isArray(optionsData?.tiers) ? optionsData.tiers as UpgradeTierOption[] : [];
        const nextFreeTier = (optionsData?.freeTier || null) as CachedUpgradeOptions['freeTier'];
        if (cancelled) return;
        const nextPaymentConfig = (paymentData?.config || null) as PaymentConfig | null;
        writeCachedUpgradeOptions(userId, nextFreeTier, nextTiers, nextPaymentConfig);
        applyOptions(nextFreeTier, nextTiers, nextPaymentConfig);
        setOptionsLoadMessage(null);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not load upgrade options.';
          setOptionsLoadMessage(hasCachedOptions ? '' : message);
          if (!hasCachedOptions) {
            pushNotice?.({ variant: 'error', message });
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, online, open, optionsReloadKey, profile?.id, pushNotice, user?.id]);

  const selected = tiers.find((tier) => tier.tier === selectedTier) || tiers[0] || null;
  const selectedIsProMax = selected?.tier === 'pro_max';
  const authSessionSyncing = authLoading || authTransition.status !== 'idle';
  const planViews = React.useMemo<PlanView[]>(() => [
    { id: 'free', kind: 'free' },
    ...tiers.map((tier) => ({ id: tier.tier, kind: 'tier' as const, tier })),
  ], [tiers]);
  const freeUiContent = React.useMemo(
    () => normalizeTierUiContent(freeTier?.uiContent, 'free'),
    [freeTier?.uiContent],
  );
  const selectedMobilePlan = planViews[Math.max(0, Math.min(mobilePlanIndex, planViews.length - 1))] || planViews[0];
  const quotePrice = selected?.quote?.quotePrice ?? selected?.pricePhp ?? 0;
  const heroPromoPercent = tiers.length
    ? Math.max(...tiers.map((tier) => getPromoDiscountPercent(tier)))
    : DEFAULT_PROMO_DISCOUNT_PERCENT;
  const currentTierLabel = capabilities.effectiveTier === 'pro_max' ? 'PRO MAX' : capabilities.effectiveTier.toUpperCase();
  const freeDailyPlaysLabel = typeof capabilities.limits.defaultBankDailyPlays === 'number'
    ? String(capabilities.limits.defaultBankDailyPlays)
    : 'Unlimited';
  const ownedBankQuotaLabel = Number.isFinite(capabilities.limits.ownedBankQuota)
    ? String(capabilities.limits.ownedBankQuota)
    : '2';

  const proChecklist = [
    'Unlimited Default Bank plays',
    'Bank Store checkout and free promotions',
    'Search, MIDI/keyboard mapping, backup and repair',
    'Full pad/bank edit controls and 4 deck channels',
  ];
  const proMaxChecklist = [
    'Everything in PRO',
    'All Store banks published at upgrade time are granted',
    'Higher own-bank and device bank caps',
    'Best option for heavy offline/event use',
  ];

  const submitUpgrade = React.useCallback(async () => {
    if (!selected || !selected.available || submitting) return;
    if (!online) {
      pushNotice?.({ variant: 'error', message: 'Reconnect before submitting an upgrade request.' });
      return;
    }
    if (quotePrice > 0 && paymentChannel === 'image_proof') {
      const proofError = validateProofFile(proofFile);
      if (proofError) {
        pushNotice?.({ variant: 'error', message: proofError });
        return;
      }
    }
    if (quotePrice > 0 && (paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual')) {
      if (!payerName.trim() || !referenceNo.trim()) {
        pushNotice?.({ variant: 'error', message: 'Enter payer name and payment reference.' });
        return;
      }
    }

    setSubmitting(true);
    try {
      const tokenResult = await getAuthenticatedAccessToken();
      const token = tokenResult.token;
      if (!token) throw new Error(tokenResult.message || 'Account session is still syncing. Please reopen upgrade pricing and submit again.');
      let proofPath: string | null = null;
      if (quotePrice > 0 && proofFile) {
        const uploadReq = await fetch(edgeFunctionUrl('store-api', 'account/upgrade-proof-upload-url'), {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            ...getClientCompatibilityHeaders(),
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: proofFile.name,
            contentType: proofFile.type || 'application/octet-stream',
            paymentChannel,
            sizeBytes: proofFile.size,
          }),
        });
        const uploadPayload = await uploadReq.json().catch(() => ({}));
        const uploadData = uploadPayload?.data && typeof uploadPayload.data === 'object' ? uploadPayload.data : uploadPayload;
        if (!uploadReq.ok) throw new Error(mapUpgradeError(uploadPayload?.error || uploadData?.error));
        const bucket = String(uploadData?.bucket || 'payment-proof');
        const path = String(uploadData?.path || '');
        const uploadToken = String(uploadData?.token || '');
        if (!path || !uploadToken) throw new Error('Could not prepare proof upload.');
        const upload = await supabase.storage.from(bucket).uploadToSignedUrl(path, uploadToken, proofFile);
        if (upload.error) throw new Error('Payment proof upload failed. Please try again.');
        proofPath = path;
      }

      const requestRes = await fetch(edgeFunctionUrl('store-api', 'account/upgrade-request'), {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          ...getClientCompatibilityHeaders(),
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetTier: selected.tier,
          paymentChannel: quotePrice <= 0 ? null : paymentChannel,
          payerName: payerName.trim() || null,
          referenceNo: referenceNo.trim() || null,
          notes: notes.trim() || null,
          proofPath,
        }),
      });
      const requestPayload = await requestRes.json().catch(() => ({}));
      const requestData = requestPayload?.data && typeof requestPayload.data === 'object' ? requestPayload.data : requestPayload;
      if (!requestRes.ok) throw new Error(mapUpgradeError(requestPayload?.error || requestData?.error));
      await refreshAccountCapabilities();
      const requestRow = ((requestData?.request && typeof requestData.request === 'object') ? requestData.request : {}) as Record<string, unknown>;
      const status = String((requestRow as any)?.status || 'pending');
      if (status !== 'approved' && selected?.tier) {
        setTiers((current) => current.map((tier) => (
          tier.tier === selected.tier
            ? {
              ...tier,
              available: false,
              pendingRequest: {
                id: String(requestRow.id || `${tier.tier}-pending`),
                receipt_reference: requestRow.receipt_reference ? String(requestRow.receipt_reference) : null,
                created_at: requestRow.created_at ? String(requestRow.created_at) : new Date().toISOString(),
                quote_price_php_snapshot: Number.isFinite(Number(requestRow.quote_price_php_snapshot))
                  ? Number(requestRow.quote_price_php_snapshot)
                  : null,
              },
            }
            : tier
        )));
      }
      setProofFile(null);
      setPayerName('');
      setReferenceNo('');
      setNotes('');
      setUpgradeReceipt({
        status: status === 'approved' ? 'approved' : 'pending',
        planName: selected.displayName || tierLabel(selected.tier),
        amountText: formatPhp(quotePrice),
        receiptReference: String(requestRow.receipt_reference || requestRow.id || 'Pending verification'),
        paymentReference: String(requestRow.reference_no || referenceNo.trim() || 'Not provided'),
        paymentChannel: String(requestRow.payment_channel || paymentChannel || 'upgrade'),
        submittedAt: requestRow.created_at ? String(requestRow.created_at) : new Date().toISOString(),
        message: status === 'approved'
          ? 'Your account tier is active.'
          : 'Your upgrade request is waiting for admin review for 24 hours. Message us on Facebook to follow up your request.',
      });
      pushNotice?.({ variant: 'success', message: status === 'approved' ? 'Upgrade applied.' : 'Upgrade request submitted.' });
    } catch (error) {
      pushNotice?.({ variant: 'error', message: error instanceof Error ? error.message : 'Upgrade request failed.' });
    } finally {
      setSubmitting(false);
    }
  }, [getAuthenticatedAccessToken, notes, online, payerName, paymentChannel, proofFile, pushNotice, quotePrice, refreshAccountCapabilities, referenceNo, selected, submitting]);

  const selectPlan = React.useCallback((tier: UpgradeTierOption) => {
    setSelectedTier(tier.tier);
    if (!tier.available || tier.pendingRequest) return;
    setUpgradeReceipt(null);
    setStep('request');
  }, []);

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
    const centeredLeft = rail.scrollLeft
      + targetRect.left
      - railRect.left
      - Math.max(0, (railRect.width - targetRect.width) / 2);
    const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const nextLeft = Math.max(0, Math.min(maxLeft, centeredLeft));
    planRailProgrammaticScrollUntilRef.current = Date.now() + (behavior === 'smooth' ? 360 : 120);
    if (behavior !== 'smooth') {
      rail.scrollLeft = nextLeft;
      return;
    }
    rail.scrollTo({ left: nextLeft, behavior: 'smooth' });
  }, []);

  const scrollDialogBodyToPlanRail = React.useCallback((behavior: ScrollBehavior) => {
    const body = dialogBodyRef.current;
    const shell = planRailShellRef.current;
    if (!body || !shell) return;
    const bodyRect = body.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const top = body.scrollTop + shellRect.top - bodyRect.top - 8;
    body.scrollTo({ top: Math.max(0, top), left: 0, behavior });
  }, []);

  React.useEffect(() => {
    if (mobilePlanIndex < planViews.length) return;
    setMobilePlanIndex(Math.max(0, planViews.length - 1));
  }, [mobilePlanIndex, planViews.length]);

  React.useEffect(() => {
    if (step !== 'plans' || loading || !planViews.length) return;
    if (skipNextPlanIndexAutoScrollRef.current) {
      skipNextPlanIndexAutoScrollRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollMobilePlanRailTo(mobilePlanIndex, 'auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, mobilePlanIndex, planViews.length, scrollMobilePlanRailTo, step]);

  const showMobilePlan = React.useCallback((nextIndex: number) => {
    if (!planViews.length) return;
    const normalized = (nextIndex + planViews.length) % planViews.length;
    const direction = nextIndex >= planViews.length
      ? 'next'
      : nextIndex < 0
        ? 'prev'
        : normalized > mobilePlanIndex ? 'next' : 'prev';
    setMobileSlideDirection(direction);
    skipNextPlanIndexAutoScrollRef.current = true;
    setMobilePlanIndex(normalized);
    window.requestAnimationFrame(() => {
      scrollDialogBodyToPlanRail('smooth');
      scrollMobilePlanRailTo(normalized, 'smooth');
    });
  }, [mobilePlanIndex, planViews.length, scrollDialogBodyToPlanRail, scrollMobilePlanRailTo]);

  const syncMobilePlanFromScroll = React.useCallback(() => {
    const rail = planRailRef.current;
    if (!rail || !planViews.length) return;
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
        setMobilePlanIndex(nearestIndex);
      }
    }, 90);
  }, [mobilePlanIndex, planViews.length]);

  const shellClass = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100'
    : 'border-slate-200 bg-white text-slate-950';
  const inputClass = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400';
  const dialogShellClass = step === 'plans'
    ? isDark
      ? 'border-slate-900 bg-[#07090d] text-slate-100'
      : 'border-slate-200 bg-[#f6f4ee] text-slate-950'
    : shellClass;
  const planTitleClass = isDark
    ? 'text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.16)]'
    : 'text-slate-950 drop-shadow-[0_10px_30px_rgba(15,23,42,0.12)]';
  const planDescriptionClass = isDark ? 'text-slate-400' : 'text-slate-600';
  const planAmbientGlowClass = isDark ? 'bg-pink-500/10' : 'bg-pink-500/14';
  const planMetaClass = isDark ? 'text-white/60' : 'text-slate-600';
  const currentTierPillClass = isDark ? 'bg-white/10 text-white/70' : 'bg-slate-950/8 text-slate-700';
  const planRailShellClass = isDark
    ? 'border-white/10 bg-white/[0.025]'
    : 'border-slate-950/10 bg-white/72 shadow-[0_24px_80px_rgba(15,23,42,0.12)]';
  const requestPanelClass = isDark
    ? 'border-white/10 bg-[#111116] text-white shadow-[0_24px_80px_rgba(0,0,0,0.3)]'
    : 'border-slate-950/10 bg-white text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.12)]';
  const requestSubtlePanelClass = isDark
    ? 'border-white/10 bg-white/[0.045] text-white'
    : 'border-slate-950/10 bg-slate-50 text-slate-950';
  const enabledBadgeClass = 'bg-[#b9ff12] text-slate-950 shadow-[0_0_18px_rgba(185,255,18,0.35)]';
  const requestAccentTextClass = selectedIsProMax ? 'text-[#68a0ff]' : 'text-[#f21984]';
  const requestAccentGlowClass = selectedIsProMax
    ? 'bg-[radial-gradient(90%_100%_at_95%_0%,rgba(29,77,245,0.24),transparent_54%),linear-gradient(112deg,rgba(255,255,255,0.12),transparent_30%)]'
    : 'bg-[radial-gradient(90%_100%_at_95%_0%,rgba(242,25,132,0.18),transparent_54%),linear-gradient(112deg,rgba(255,255,255,0.12),transparent_30%)]';
  const requestFocusRingClass = selectedIsProMax ? 'focus-visible:ring-[#1d4df5]/50' : 'focus-visible:ring-[#f21984]/50';
  const requestInputFocusClass = selectedIsProMax ? 'focus:ring-[#1d4df5]/40' : 'focus:ring-[#f21984]/40';
  const requestSubmitButtonClass = selectedIsProMax
    ? 'bg-[#1d4df5] font-black text-white shadow-[0_14px_36px_rgba(29,77,245,0.32)] hover:bg-[#2860ff]'
    : 'bg-[#ed0d7c] font-black text-white shadow-[0_14px_36px_rgba(237,13,124,0.32)] hover:bg-[#ff168c]';
  const skeletonShellClass = isDark
    ? 'border-white/10 bg-[#0b0e12] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]'
    : 'border-slate-950/10 bg-white/70 shadow-[0_20px_70px_rgba(15,23,42,0.10)]';
  const skeletonCardClass = isDark
    ? 'bg-white/[0.045]'
    : 'bg-slate-950/[0.045]';
  const skeletonBlockClass = isDark
    ? 'bg-white/[0.095]'
    : 'bg-slate-950/[0.10]';
  const skeletonFaintBlockClass = isDark
    ? 'bg-white/[0.06]'
    : 'bg-slate-950/[0.065]';
  const skeletonLineBorderClass = isDark ? 'border-white/10' : 'border-slate-950/10';

  const renderSkeletonPlanCard = (index: number) => (
    <div
      key={index}
      className={`relative flex min-h-[610px] flex-col gap-3 rounded-2xl p-4 md:min-h-[690px] ${skeletonCardClass} ${
        index === 1 ? isDark ? 'ring-1 ring-white/8' : 'ring-1 ring-slate-950/8' : ''
      }`}
    >
      {index === 1 && <div className={`absolute -top-3 left-1/2 h-7 w-36 -translate-x-1/2 rounded-full ${skeletonBlockClass}`} />}
      <div className="flex items-center gap-2 pt-3">
        <div className={`h-7 w-24 rounded ${skeletonBlockClass}`} />
        <div className={`h-6 w-16 rounded-full ${skeletonFaintBlockClass}`} />
      </div>
      <div className={`h-4 w-48 max-w-[80%] rounded ${skeletonFaintBlockClass}`} />
      <div className="mt-2 flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <div className={`h-6 w-12 rounded ${skeletonFaintBlockClass}`} />
          <div className={`h-10 w-20 rounded ${skeletonBlockClass}`} />
          <div className={`h-5 w-16 rounded ${skeletonFaintBlockClass}`} />
        </div>
        <div className={`h-4 w-32 rounded ${skeletonFaintBlockClass}`} />
      </div>
      <div className={`mt-2 h-12 w-full rounded-xl ${skeletonBlockClass}`} />
      <div className={`h-10 w-full rounded-lg ${skeletonFaintBlockClass}`} />
      <div className="mt-2 flex items-center gap-2">
        <div className={`h-5 w-5 rounded ${skeletonFaintBlockClass}`} />
        <div className={`h-5 w-32 rounded ${skeletonBlockClass}`} />
      </div>
      <div className={`ml-7 h-4 w-48 max-w-[70%] rounded ${skeletonFaintBlockClass}`} />
      <div className={`my-2 border-t ${skeletonLineBorderClass}`} />
      <div className="flex flex-col gap-3">
        {[65, 80, 55, 90, 70, 60, 85, 75].map((width, rowIndex) => (
          <div key={`main-${rowIndex}`} className="flex items-center justify-between gap-2">
            <div className="flex flex-1 items-center gap-2">
              <div className={`h-4 w-4 shrink-0 rounded ${skeletonFaintBlockClass}`} />
              <div className={`h-4 rounded ${skeletonFaintBlockClass}`} style={{ width: `${width}%` }} />
            </div>
            {rowIndex % 3 === 0 && <div className={`h-5 w-20 shrink-0 rounded-full ${skeletonFaintBlockClass}`} />}
          </div>
        ))}
      </div>
      <div className={`mt-4 h-5 w-36 rounded ${skeletonBlockClass}`} />
      <div className="flex flex-col gap-3">
        {[50, 60, 45, 70].map((width, rowIndex) => (
          <div key={`tools-${rowIndex}`} className="flex items-center justify-between gap-2">
            <div className="flex flex-1 items-center gap-2">
              <div className={`h-4 w-4 shrink-0 rounded ${skeletonFaintBlockClass}`} />
              <div className={`h-4 rounded ${skeletonFaintBlockClass}`} style={{ width: `${width}%` }} />
            </div>
            <div className={`h-5 w-24 shrink-0 rounded-full ${skeletonFaintBlockClass}`} />
          </div>
        ))}
      </div>
    </div>
  );

  const renderPlansLoadingSkeleton = () => (
    <div className={`mt-5 rounded-2xl border p-4 ${skeletonShellClass}`}>
      <div className="flex justify-center">
        <div className={`h-11 w-64 rounded-full ${skeletonBlockClass} animate-pulse`} />
      </div>
      <div className="mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-3 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
        {[0, 1, 2].map((index) => (
          <div key={index} className="w-[min(86vw,430px)] shrink-0 snap-center animate-pulse md:w-auto">
            {renderSkeletonPlanCard(index)}
          </div>
        ))}
      </div>
    </div>
  );

  const renderPlanCard = (plan: PlanView) => {
    const tier = plan.tier;
    const isFree = plan.kind === 'free';
    const isProMax = tier?.tier === 'pro_max';
    const uiContent = isFree
      ? freeUiContent
      : normalizeTierUiContent(tier?.uiContent, tier?.tier || 'pro');
    const list = uiContent.checklist.length
      ? uiContent.checklist
      : isFree
        ? DEFAULT_TIER_UI_CONTENT.free.checklist
        : isProMax ? proMaxChecklist : proChecklist;
    const isCurrentFree = isFree && capabilities.effectiveTier === 'free';
    const isCurrentPaidTier = Boolean(tier && capabilities.effectiveTier === tier.tier);
    const active = tier ? selectedTier === tier.tier : isCurrentFree;
    const pending = Boolean(tier?.pendingRequest);
    const disabled = isFree || isCurrentPaidTier || !tier?.available || pending;
    const headerLabel = uiContent.cardHeader.label || (isFree ? 'Base access' : isProMax ? 'Best value' : 'Most popular');
    const badge = isFree ? (isCurrentFree ? 'Current access' : 'Base access') : pending ? 'Pending review' : headerLabel;
    const promoPercent = tier ? getPromoDiscountPercent(tier) : 0;
    const title = isFree ? (freeTier?.displayName || 'FREE') : (tier!.displayName || tierLabel(tier!.tier));
    const subtitleRows = uiContent.shortDescriptions.length ? uiContent.shortDescriptions : [isFree ? 'For trying VDJV before upgrading' : tier!.description];
    const otherRows = uiContent.otherDescriptions.length ? uiContent.otherDescriptions : DEFAULT_TIER_UI_CONTENT[isFree ? 'free' : tier!.tier].otherDescriptions;
    const primaryOtherRow = otherRows[0] || { title: isFree ? 'Daily trial access' : isProMax ? 'All current Store banks' : 'Full sampler tools', body: '' };
    const inclusions = uiContent.inclusions.length ? uiContent.inclusions : DEFAULT_TIER_UI_CONTENT[isFree ? 'free' : tier!.tier].inclusions;
    const displayPrice = !isFree ? tier!.quote.quotePrice : 0;
    const price = isFree ? 'Free' : formatPhp(displayPrice);
    const previousPrice = !isFree && displayPrice > 0 && promoPercent > 0
      ? formatPhp(getBeforePromoPrice(displayPrice, promoPercent))
      : null;
    const cta = isFree ? (isCurrentFree ? 'Current Plan' : 'Base Access') : pending ? 'Pending Review' : isCurrentPaidTier ? 'Current Plan' : `Get ${title}`;
    const accentColor = uiContent.color;
    const accentTextColor = getReadableTextColor(accentColor);
    const paidCardStyle: React.CSSProperties = isFree ? {} : {
      borderColor: accentRgb(accentColor, isDark ? 0.28 : 0.22),
      background: isDark
        ? `radial-gradient(115% 82% at 92% 0%, ${accentRgb(accentColor, 0.18)}, transparent 58%), linear-gradient(180deg, rgba(17,17,22,0.98), rgba(14,16,20,0.98))`
        : `radial-gradient(115% 82% at 92% 0%, ${accentRgb(accentColor, 0.16)}, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,${isDark ? 0.08 : 0.85}), inset 0 0 48px ${accentRgb(accentColor, isDark ? 0.2 : 0.13)}`,
    };
    const paidHeroStyle: React.CSSProperties = isFree ? {} : {
      background: isDark
        ? `radial-gradient(120% 95% at 88% 0%, ${accentRgb(accentColor, 0.58)}, transparent 55%), radial-gradient(100% 90% at 12% 0%, rgba(255,255,255,0.18), transparent 42%), linear-gradient(180deg, ${accentRgb(accentColor, 0.32)}, rgba(23,22,30,0.98))`
        : `radial-gradient(120% 95% at 88% 0%, ${accentRgb(accentColor, 0.22)}, transparent 55%), radial-gradient(100% 90% at 12% 0%, rgba(255,255,255,0.95), transparent 42%), linear-gradient(180deg, ${accentRgb(accentColor, 0.12)}, rgba(255,255,255,0.92))`,
    };
    const paidButtonStyle: React.CSSProperties = !isFree && !disabled ? {
      backgroundColor: accentColor,
      color: accentTextColor,
      boxShadow: `0 14px 36px ${accentRgb(accentColor, 0.38)}`,
    } : {};
    const ctaClass = isFree
      ? isDark ? 'bg-white text-slate-950' : 'bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)]'
      : '';
    const shellClass = isFree
      ? isDark
        ? 'border-white/10 bg-[#15171a] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_38px_rgba(255,255,255,0.035)]'
        : 'border-slate-950/10 bg-[#eef0f3] text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_0_42px_rgba(15,23,42,0.08),0_18px_48px_rgba(15,23,42,0.10)]'
      : isDark
        ? 'border-white/10 bg-[#171318]'
        : 'border-slate-950/10 bg-white text-slate-950';
    const heroPanelClass = isFree
      ? isDark
        ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))]'
        : 'bg-[radial-gradient(115%_90%_at_90%_0%,rgba(242,25,132,0.10),transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.64),rgba(226,232,240,0.42))]'
      : '';
    const cardTextClass = isDark ? 'text-white' : 'text-slate-950';
    const subtitleClass = isDark ? 'text-white/58' : 'text-slate-600';
    const innerPanelClass = isDark ? 'bg-white/[0.075] text-white' : 'bg-white/72 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]';
    const secondaryTextClass = isDark ? 'text-white/65' : 'text-slate-600';
    const noteTextClass = isDark ? 'text-white/46' : 'text-slate-500';
    const featureTextClass = isDark ? 'text-white/92' : 'text-slate-800';
    const detailBoxClass = isDark ? 'border-white/7 bg-white/[0.04] text-white' : 'border-slate-950/8 bg-white/72 text-slate-950';
    const detailMutedClass = isDark ? 'text-white/66' : 'text-slate-600';
    const lockBadgeClass = isDark ? 'bg-white/10 text-white/55' : 'bg-slate-950/8 text-slate-500';
    const neutralBadgeClass = isDark ? 'border border-white/14 bg-white/10 text-white' : 'border border-slate-300 bg-slate-100 text-slate-700 shadow-sm';
    const currentPlanBadgeClass = isDark
      ? 'bg-[#b9ff12] text-slate-950 shadow-[0_0_18px_rgba(185,255,18,0.24)]'
      : 'bg-slate-950 text-white shadow-[0_0_18px_rgba(15,23,42,0.22)]';
    const disabledCtaClass = isDark ? 'bg-white/10 text-white/55' : 'border border-slate-300 bg-slate-100 text-slate-700 shadow-sm';
    const pendingNoticeClass = isDark
      ? 'border-amber-300/30 bg-amber-300/12 text-amber-100'
      : 'border-amber-300 bg-amber-50 text-amber-900 shadow-sm';
    const pendingNoticeLinkClass = isDark ? 'text-amber-50' : 'text-amber-950';

    return (
      <div
        key={plan.id}
        style={{ ['--tier-accent' as string]: accentColor, ...paidCardStyle }}
        className={`group relative flex min-h-[640px] flex-col overflow-hidden rounded-[15px] border text-left transition duration-300 md:min-h-[680px] ${cardTextClass} ${shellClass} ${
          active ? 'brightness-105' : ''
        } ${disabled ? 'cursor-default' : 'hover:-translate-y-1 hover:brightness-110'}`}
      >
        {uiContent.cardHeader.enabled ? (
          <div className="flex h-9 items-center justify-center text-[11px] font-black uppercase tracking-wide" style={{ backgroundColor: accentColor, color: accentTextColor }}>
            {isFree ? '' : isProMax ? '* ' : '+ '}{headerLabel}
          </div>
        ) : (
          <div className="h-9" aria-hidden="true" />
        )}

        <div className={`relative m-4 overflow-hidden rounded-[13px] border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ${isDark ? 'border-white/8' : 'border-slate-950/8'} ${heroPanelClass}`} style={paidHeroStyle}>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,rgba(255,255,255,0.18),transparent_24%,transparent_70%,rgba(255,255,255,0.08))]" />
          <div className="relative flex min-h-[34px] items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[28px] font-black uppercase leading-none tracking-tight">{title}</h3>
                {!isFree && uiContent.versionBadge.enabled && uiContent.versionBadge.label && (
                  <span className="rounded-[4px] bg-[#63dff0] px-2 py-0.5 text-[10px] font-black uppercase italic text-[#07242b] shadow-[0_0_18px_rgba(99,223,240,0.35)]">
                    {uiContent.versionBadge.label}
                  </span>
                )}
              </div>
              <div className={`mt-3 min-h-[42px] space-y-1 text-sm ${subtitleClass}`}>
                {subtitleRows.slice(0, 2).map((row) => (
                  <p key={row} className="line-clamp-1">{row}</p>
                ))}
              </div>
            </div>
            {isFree ? (
              <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${neutralBadgeClass}`}>{badge}</span>
            ) : (
              <span className={`shrink-0 whitespace-nowrap rounded-[4px] px-2 py-1 text-[10px] font-black uppercase ${
                isCurrentPaidTier
                  ? currentPlanBadgeClass
                  : ''
              }`} style={!isCurrentPaidTier ? { backgroundColor: accentColor, color: accentTextColor, boxShadow: `0 0 18px ${accentRgb(accentColor, 0.45)}` } : undefined}>
                {isCurrentPaidTier ? 'Current Plan' : `${promoPercent}% OFF`}
              </span>
            )}
          </div>

          <div className={`relative mt-5 rounded-[10px] p-4 ${innerPanelClass}`}>
            <div className="text-sm font-black">
              * {primaryOtherRow.title}
            </div>
            {primaryOtherRow.body && (
              <div className={`mt-2 min-h-[40px] text-sm leading-relaxed ${subtitleClass}`}>{primaryOtherRow.body}</div>
            )}
            <div className={`mt-4 h-1 rounded-full ${isDark ? 'bg-white/22' : 'bg-slate-950/12'}`}>
              <div
                className={`h-full rounded-full ${isFree ? 'bg-white/50' : ''}`}
                style={{
                  width: `${uiContent.meterPercent}%`,
                  ...(!isFree ? { backgroundColor: accentColor } : {}),
                }}
              />
            </div>
            <div className={`mt-4 flex justify-between text-xs font-bold ${secondaryTextClass}`}>
              <span>{isFree ? 'Limited' : 'Unlocked'}</span>
              <span>{isProMax ? 'Maximum' : isFree ? 'Starter' : 'Pro'}</span>
            </div>
          </div>
        </div>

        <div className="relative flex min-h-[166px] flex-col justify-end px-4">
          <div className="flex flex-wrap items-end gap-2">
            {previousPrice && <span className="text-[28px] font-black line-through decoration-2" style={{ color: accentColor }}>{previousPrice}</span>}
            <span className="text-[42px] font-black leading-none tracking-tight">{price}</span>
            {!isFree && <span className={`pb-1 text-xs ${noteTextClass}`}>one-time request</span>}
          </div>
          {!isFree && tier!.quote.creditPhp > 0 ? (
            <div className="mt-2 inline-flex rounded-[4px] bg-[#b9ff12] px-2 py-0.5 text-[10px] font-black uppercase text-slate-950">
              {formatPhp(tier!.quote.creditPhp)} store credit
            </div>
          ) : (
            <div className={`mt-2 text-xs ${noteTextClass}`}>{isFree ? 'Upgrade offer available anytime.' : 'Admin reviews payment proof before activation.'}</div>
          )}
          <button
            type="button"
            onClick={() => tier ? selectPlan(tier) : undefined}
            disabled={disabled}
            style={paidButtonStyle}
            className={`mt-4 flex h-12 w-full items-center justify-center rounded-[10px] text-sm font-black uppercase transition disabled:cursor-default ${
              disabled && !isFree ? disabledCtaClass : ctaClass
            }`}
          >
            {pending && !isFree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {cta}
            {!disabled && <ArrowRight className="ml-2 h-4 w-4" />}
          </button>
        </div>

        {pending && (
          <div className={`relative mx-4 mt-4 rounded-xl border px-3 py-2 text-xs leading-5 ${pendingNoticeClass}`}>
            Already submitted{tier!.pendingRequest?.receipt_reference ? `: ${tier!.pendingRequest.receipt_reference}` : ''}. Wait for admin review for 24 hours, or message us on{' '}
            {paymentConfig?.messenger_url ? (
              <a className={`font-black underline underline-offset-4 ${pendingNoticeLinkClass}`} href={paymentConfig.messenger_url} target="_blank" rel="noreferrer">
                Facebook
              </a>
            ) : (
              <span className={`font-black ${pendingNoticeLinkClass}`}>Facebook</span>
            )}{' '}
            to follow up your request.
          </div>
        )}

        <div className="relative mt-5 space-y-2 px-4">
          {list.map((item) => (
            <div key={item} className={`flex items-start gap-2.5 text-[13px] font-bold ${featureTextClass}`}>
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${isFree ? isDark ? 'text-white/70' : 'text-slate-500' : isProMax ? 'text-blue-400' : 'text-[#ff2b95]'}`}>
                <Check className="h-3.5 w-3.5" />
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        <div className={`relative mx-4 mt-5 rounded-[10px] border p-3 ${detailBoxClass}`}>
          <div className={`mb-2 text-[11px] font-black uppercase tracking-wider ${isDark ? 'text-white/88' : 'text-slate-700'}`}>
            {uiContent.inclusionTitle}
          </div>
          <div className={`space-y-2 text-xs ${detailMutedClass}`}>
            {inclusions.map((item) => (
              <div key={`${item.title}:${item.badge}`} className="flex items-center justify-between gap-3">
                <span>{item.title}</span>
                <span className={`rounded px-1.5 py-0.5 font-black ${item.enabled ? enabledBadgeClass : lockBadgeClass}`}>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`w-[98vw] max-h-[96vh] overflow-hidden p-0 sm:max-w-[1380px] ${dialogShellClass}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            dialogBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          });
        }}
      >
        <div ref={dialogBodyRef} className="max-h-[96vh] overflow-y-auto p-4 sm:p-6">
        {step === 'plans' && (
          <style>{`
            @media (max-width: 767px) {
              .vdjv-mobile-plan-card {
                transition: opacity 220ms ease, transform 260ms cubic-bezier(.2,.8,.2,1);
                transform: scale(.985);
                opacity: .86;
              }
              .vdjv-mobile-plan-card.vdjv-mobile-plan-card-active {
                opacity: 1;
                transform: scale(1);
              }
            }
          `}</style>
        )}
        {step === 'plans' && (
          <div className="relative -mx-4 -mt-4 mb-5 h-[280px] overflow-hidden rounded-t-lg md:hidden">
            <video
              src={resolveTierVideoSrc(freeUiContent)}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.44)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-[160px] bg-[radial-gradient(120%_100%_at_50%_100%,rgba(180,40,120,0.48)_0%,rgba(140,30,100,0.24)_50%,transparent_72%)]" />
            <div className="pointer-events-none absolute left-0 right-0 z-10 flex flex-col items-center gap-1 px-4 text-center text-white [top:calc(env(safe-area-inset-top,0px)+2.35rem)]">
              <p className="text-sm font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">Special Offer</p>
              <p className="select-none text-[clamp(42px,14vw,60px)] font-black uppercase leading-[1.05] text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.46)]">
                {heroPromoPercent}% OFF
              </p>
              <p className="text-sm font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">Pay less, play more</p>
            </div>
          </div>
        )}
        <DialogHeader className={step === 'plans' ? 'items-center text-center' : undefined}>
          <DialogTitle className={step === 'plans'
            ? `text-3xl font-black tracking-tight sm:text-5xl ${planTitleClass}`
            : 'text-2xl font-black tracking-tight sm:text-3xl'}
          >
            {step === 'plans' ? 'UPGRADE PRICING' : `Request ${selected ? tierLabel(selected.tier) : 'upgrade'}`}
          </DialogTitle>
          <DialogDescription className={step === 'plans' ? planDescriptionClass : undefined}>
            {step === 'plans'
              ? 'Scale your sampler access with higher limits, Store downloads, and event-ready features.'
              : `Current tier: ${currentTierLabel}${profile?.display_name ? ` - ${profile.display_name}` : ''}.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          renderPlansLoadingSkeleton()
        ) : step === 'plans' ? (
          <div className="relative mt-5 space-y-5">
            <div className={`pointer-events-none absolute inset-x-0 top-20 mx-auto h-64 max-w-4xl rounded-full blur-3xl ${planAmbientGlowClass}`} />
            <div className={`hidden items-center justify-center gap-3 text-xs font-black uppercase tracking-wide md:flex ${planMetaClass}`}>
              <span className="rounded-[8px] bg-[#f21984] px-3 py-1.5 text-white shadow-[0_0_28px_rgba(242,25,132,0.34)]">{heroPromoPercent}% off</span>
              <span>One-time upgrade pricing</span>
            </div>
            {optionsLoadMessage && (
              <div className={`mx-auto max-w-3xl rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
                isDark ? 'border-amber-400/35 bg-amber-400/10 text-amber-100' : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}>
                {optionsLoadMessage}
              </div>
            )}

            <div ref={planRailShellRef} className={`relative -mx-4 rounded-[1.6rem] border py-4 md:mx-0 md:border-0 md:bg-transparent md:px-0 md:shadow-none ${planRailShellClass}`}>
              <div className="mb-3 flex items-center justify-center gap-2 text-xs">
                <span className={`rounded-full px-3 py-1 ${currentTierPillClass}`}>Current tier: {currentTierLabel}</span>
              </div>
              <div
                ref={planRailRef}
                onScroll={syncMobilePlanFromScroll}
                className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-3 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
              >
                {planViews.map((plan, index) => (
                  <div
                    key={plan.id}
                    data-slide-direction={mobileSlideDirection}
                    className={`vdjv-mobile-plan-card w-[min(86vw,430px)] shrink-0 snap-center md:w-auto md:scale-100 md:opacity-100 md:filter-none ${
                      index === mobilePlanIndex ? 'vdjv-mobile-plan-card-active' : ''
                    }`}
                  >
                    {renderPlanCard(plan)}
                  </div>
                ))}
              </div>
              <button
                type="button"
                aria-label="Previous plan"
                onClick={() => showMobilePlan(mobilePlanIndex - 1)}
                className={`absolute left-1 top-24 z-10 flex h-10 w-10 items-center justify-center rounded-full border shadow-[0_14px_34px_rgba(15,23,42,0.24)] md:hidden ${
                  isDark
                    ? 'border-white/20 bg-white/18 text-white backdrop-blur'
                    : 'border-slate-900/10 bg-slate-950 text-white'
                }`}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next plan"
                onClick={() => showMobilePlan(mobilePlanIndex + 1)}
                className={`absolute right-1 top-24 z-10 flex h-10 w-10 items-center justify-center rounded-full border shadow-[0_14px_34px_rgba(15,23,42,0.24)] md:hidden ${
                  isDark
                    ? 'border-white/20 bg-white/18 text-white backdrop-blur'
                    : 'border-slate-900/10 bg-slate-950 text-white'
                }`}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="mt-4 flex justify-center gap-1.5 md:hidden">
                {planViews.map((plan, index) => (
                  <button
                    key={plan.id}
                    type="button"
                    aria-label={`Show plan ${index + 1}`}
                    onClick={() => showMobilePlan(index)}
                    className={`h-1.5 rounded-full transition-all ${index === mobilePlanIndex ? 'w-7 bg-pink-500' : 'w-2 bg-white/25'}`}
                  />
                ))}
              </div>
            </div>

          </div>
        ) : selected && upgradeReceipt ? (
          <div className="mx-auto max-w-xl py-4">
            <PaymentReceiptCard
              theme={theme}
              title={upgradeReceipt.status === 'approved' ? 'Approved' : 'Pending Approval'}
              status={upgradeReceipt.status === 'approved' ? 'success' : 'pending'}
              statusLabel={upgradeReceipt.status === 'approved' ? 'Approved' : 'Pending Approval'}
              subtitle={upgradeReceipt.message}
              amountLabel="Upgrade"
              amountValue={upgradeReceipt.amountText}
              lineItems={[
                { label: 'Plan', value: upgradeReceipt.planName },
                { label: 'VDJV Receipt No', value: upgradeReceipt.receiptReference, copyValue: upgradeReceipt.receiptReference },
                { label: 'Payment Reference', value: upgradeReceipt.paymentReference, copyValue: upgradeReceipt.paymentReference },
                { label: 'Payment Channel', value: upgradeReceipt.paymentChannel },
                { label: 'Submitted', value: new Date(upgradeReceipt.submittedAt).toLocaleString() },
              ]}
              receiptFileName={`account-upgrade-receipt-${new Date(upgradeReceipt.submittedAt).toISOString().replace(/[:.]/g, '-')}.png`}
              primaryAction={{
                label: 'Done',
                onClick: () => {
                  setUpgradeReceipt(null);
                  onOpenChange(false);
                },
              }}
              secondaryAction={paymentConfig?.messenger_url
                ? {
                  label: 'Message Us On Facebook',
                  onClick: () => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer'),
                }
                : undefined}
            />
          </div>
        ) : selected ? (
          <div className="mx-auto max-w-2xl space-y-5">
            <div className={`relative overflow-hidden rounded-[18px] border p-5 ${requestPanelClass}`}>
              <div className={`pointer-events-none absolute inset-0 ${requestAccentGlowClass}`} />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="relative">
                  <div className={`text-[11px] font-black uppercase tracking-[0.22em] ${requestAccentTextClass}`}>Selected plan</div>
                  <h3 className="mt-1 text-2xl font-black">{selected.displayName}</h3>
                  <p className="mt-1 text-sm opacity-75">{selected.description}</p>
                </div>
                <div className="relative text-right">
                  <div className="text-3xl font-black">{formatPhp(quotePrice)}</div>
                  {selected.quote.creditPhp > 0 && <div className="text-xs font-black text-[#b9ff12]">-{formatPhp(selected.quote.creditPhp)} Store credit</div>}
                </div>
              </div>
            </div>

            {!online && (
              <div className={`rounded-[14px] border px-4 py-3 text-sm ${
                isDark ? 'border-amber-400/35 bg-amber-400/10 text-amber-100' : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}>
                Reconnect before submitting an upgrade request.
              </div>
            )}

            {quotePrice > 0 ? (
              <>
                <div className={`rounded-[18px] border p-5 shadow-sm ${requestPanelClass}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">Payment Information</h3>
                      <p className="mt-1 text-sm leading-relaxed opacity-75">
                        Pay the quoted amount, then submit the receipt or transaction details for admin review.
                      </p>
                    </div>
                    {paymentConfig?.messenger_url && (
                      <Button type="button" variant="outline" size="sm" onClick={() => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer')}>
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Facebook Help
                      </Button>
                    )}
                  </div>

                  {paymentConfig?.instructions && (
                    <div className={`mt-4 whitespace-pre-wrap rounded-[12px] border px-3 py-2 text-sm leading-relaxed ${requestSubtlePanelClass}`}>
                      {paymentConfig.instructions}
                    </div>
                  )}

                  {(paymentConfig?.gcash_number || paymentConfig?.maya_number) && (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {paymentConfig.gcash_number && (
                        <div className={`flex flex-col items-center justify-center gap-1 rounded-[12px] border p-3 text-center ${isDark ? 'border-[#1d4df5]/35 bg-[#1d4df5]/14' : 'border-[#1d4df5]/20 bg-[#1d4df5]/8'}`}>
                          <span className="text-xs font-black uppercase tracking-wider text-[#1d4df5]">GCash</span>
                          <CopyableValue
                            value={paymentConfig.gcash_number}
                            label="GCash number"
                            wrap
                            className="max-w-full justify-center"
                            valueClassName={`font-mono text-lg font-medium break-all whitespace-normal text-center ${isDark ? 'text-white' : 'text-gray-900'}`}
                            buttonClassName={isDark ? 'text-blue-200 hover:bg-blue-400/15' : 'text-blue-700 hover:bg-blue-100'}
                            onCopied={() => openWalletAppAfterCopy('gcash')}
                          />
                        </div>
                      )}
                      {paymentConfig.maya_number && (
                        <div className={`flex flex-col items-center justify-center gap-1 rounded-[12px] border p-3 text-center ${isDark ? 'border-[#b9ff12]/35 bg-[#b9ff12]/10' : 'border-lime-400/40 bg-lime-200/30'}`}>
                          <span className="text-xs font-black uppercase tracking-wider text-lime-500">Maya</span>
                          <CopyableValue
                            value={paymentConfig.maya_number}
                            label="Maya number"
                            wrap
                            className="max-w-full justify-center"
                            valueClassName={`font-mono text-lg font-medium break-all whitespace-normal text-center ${isDark ? 'text-white' : 'text-gray-900'}`}
                            buttonClassName={isDark ? 'text-green-200 hover:bg-green-400/15' : 'text-green-700 hover:bg-green-100'}
                            onCopied={() => openWalletAppAfterCopy('maya')}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {paymentConfig?.qr_image_path && (
                    <div className={`mt-4 flex flex-col items-center justify-center border-t pt-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                      <span className="mb-3 text-sm font-medium opacity-75">Scan to pay</span>
                      <a href={paymentConfig.qr_image_path} target="_blank" rel="noopener noreferrer" className="rounded-xl border bg-white p-1 transition hover:opacity-90">
                        <img src={paymentConfig.qr_image_path} alt="Payment QR" className="h-[180px] w-[180px] rounded-xl object-cover shadow-sm" />
                      </a>
                    </div>
                  )}
                </div>

                <div className={`rounded-[18px] border p-5 shadow-sm ${requestPanelClass}`}>
                  <div className="grid gap-4">
                    <div className="space-y-1.5">
                      <Label>Payment Channel</Label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {PAYMENT_CHANNEL_OPTIONS.map((option) => {
                          const selectedChannel = paymentChannel === option.value;
                          const accentClass = selectedIsProMax
                            ? 'border-[#1d4df5] bg-[#1d4df5]/12 text-[#8fb0ff]'
                            : option.accent === 'green'
                              ? 'border-[#b9ff12] bg-[#b9ff12]/12 text-[#b9ff12]'
                              : option.accent === 'blue'
                                ? 'border-[#1d4df5] bg-[#1d4df5]/12 text-[#8fb0ff]'
                                : 'border-[#f21984] bg-[#f21984]/12 text-[#ff8fc4]';
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setPaymentChannel(option.value)}
                              className={`rounded-[12px] border p-3 text-left transition focus:outline-none focus-visible:ring-2 ${requestFocusRingClass} ${
                                selectedChannel
                                  ? accentClass
                                  : isDark
                                    ? 'border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.06]'
                                    : 'border-slate-950/10 bg-slate-50 text-slate-600 hover:bg-white'
                              }`}
                            >
                              <div className="text-xs font-black uppercase tracking-wide">{option.title}</div>
                              <div className="mt-1 text-[11px] opacity-75">{option.subtitle}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {(paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Payer Name <span className="text-red-500">*</span></Label>
                          <Input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Name used to send payment" className={inputClass} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Reference Number <span className="text-red-500">*</span></Label>
                          <Input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="Transaction reference" className={inputClass} />
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label>Upload Receipt / Image Proof {paymentChannel === 'image_proof' ? <span className="text-red-500">*</span> : <span className="text-xs font-normal opacity-60">(Optional)</span>}</Label>
                      <div className="flex items-center gap-3">
                        {proofPreviewUrl && <img src={proofPreviewUrl} alt="Payment proof preview" className="h-14 w-14 rounded-[10px] border object-cover" />}
                        <Input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                          required={paymentChannel === 'image_proof'}
                          onChange={(event) => setProofFile(event.target.files?.[0] || null)}
                          className={inputClass}
                        />
                        {proofFile && (
                          <Button type="button" variant="outline" size="sm" onClick={() => setProofFile(null)} className="shrink-0">
                            Remove
                          </Button>
                        )}
                      </div>
                      {proofFile && <div className="text-xs opacity-70">{proofFile.name}</div>}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Additional Notes (Optional)</Label>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        rows={3}
                        className={`w-full resize-none rounded-md border p-2.5 text-sm outline-none focus:ring-2 ${requestInputFocusClass} ${inputClass}`}
                        placeholder="Optional message for admin"
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className={`rounded-[14px] border p-4 text-sm ${isDark ? 'border-[#b9ff12]/35 bg-[#b9ff12]/10 text-lime-100' : 'border-lime-300 bg-lime-50 text-lime-900'}`}>
                No payment is required for this upgrade quote. Submit to apply or create an admin-reviewed request.
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setStep('plans')} disabled={submitting} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Plans
              </Button>
              <Button type="button" onClick={() => void submitUpgrade()} disabled={submitting || authSessionSyncing || !selected.available || !online} className={`flex-1 ${requestSubmitButtonClass}`}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : quotePrice > 0 ? <Upload className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                {submitting ? 'Submitting...' : authSessionSyncing ? 'Syncing Session...' : quotePrice > 0 ? 'Submit Upgrade Request' : 'Apply Upgrade'}
              </Button>
            </div>
          </div>
        ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
