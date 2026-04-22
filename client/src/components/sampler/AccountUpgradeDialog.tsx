import * as React from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyableValue } from '@/components/ui/copyable-value';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { openWalletAppAfterCopy } from '@/lib/mobile-wallet-links';
import { supabase } from '@/lib/supabase';
import { useAuthActions, useAuthState } from '@/hooks/useAuth';

type TargetTier = 'pro' | 'pro_max';
type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual';
type DialogStep = 'plans' | 'request';
type MobileSlideDirection = 'next' | 'prev';
type PlanView = {
  id: 'free' | TargetTier;
  kind: 'free' | 'tier';
  tier?: UpgradeTierOption;
};

type UpgradeTierOption = {
  tier: TargetTier;
  displayName: string;
  description: string;
  pricePhp: number;
  promoDiscountPercent?: number;
  isActive: boolean;
  available: boolean;
  pendingRequest?: {
    id: string;
    receipt_reference?: string | null;
    created_at?: string | null;
    quote_price_php_snapshot?: number | null;
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

interface AccountUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  pushNotice?: (notice: { variant: 'success' | 'error' | 'info'; message: string }) => void;
}

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
      return 'Sign in before requesting an upgrade.';
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
  const { profile, capabilities } = useAuthState();
  const { refreshAccountCapabilities } = useAuthActions();
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [step, setStep] = React.useState<DialogStep>('plans');
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
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const planRailRef = React.useRef<HTMLDivElement | null>(null);
  const planRailScrollSyncRef = React.useRef<number | null>(null);
  const isDark = theme === 'dark';

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
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setStep('plans');
    setSuccessMessage(null);
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Sign in before requesting an upgrade.');
        const [optionsRes, paymentRes] = await Promise.all([
          fetch(edgeFunctionUrl('store-api', 'account/upgrade-options'), {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(edgeFunctionUrl('store-api', 'payment-config'), { cache: 'no-store' }),
        ]);
        const optionsPayload = await optionsRes.json().catch(() => ({}));
        const optionsData = optionsPayload?.data && typeof optionsPayload.data === 'object' ? optionsPayload.data : optionsPayload;
        if (!optionsRes.ok) throw new Error(mapUpgradeError(optionsPayload?.error || optionsData?.error));
        const paymentPayload = await paymentRes.json().catch(() => ({}));
        const paymentData = paymentPayload?.data && typeof paymentPayload.data === 'object' ? paymentPayload.data : paymentPayload;
        const nextTiers = Array.isArray(optionsData?.tiers) ? optionsData.tiers as UpgradeTierOption[] : [];
        if (cancelled) return;
        setTiers(nextTiers);
        setPaymentConfig((paymentData?.config || null) as PaymentConfig | null);
        const firstAvailable = nextTiers.find((tier) => tier.available)?.tier || 'pro';
        setSelectedTier(firstAvailable);
        setMobilePlanIndex(Math.max(0, nextTiers.findIndex((tier) => tier.tier === firstAvailable) + 1));
      } catch (error) {
        if (!cancelled) {
          pushNotice?.({ variant: 'error', message: error instanceof Error ? error.message : 'Could not load upgrade options.' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pushNotice]);

  const selected = tiers.find((tier) => tier.tier === selectedTier) || tiers[0] || null;
  const selectedIsProMax = selected?.tier === 'pro_max';
  const planViews = React.useMemo<PlanView[]>(() => [
    { id: 'free', kind: 'free' },
    ...tiers.map((tier) => ({ id: tier.tier, kind: 'tier' as const, tier })),
  ], [tiers]);
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
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sign in before requesting an upgrade.');
      let proofPath: string | null = null;
      if (quotePrice > 0 && proofFile) {
        const uploadReq = await fetch(edgeFunctionUrl('store-api', 'account/upgrade-proof-upload-url'), {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          headers: {
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
      const status = String((requestData?.request as any)?.status || 'pending');
      setProofFile(null);
      setPayerName('');
      setReferenceNo('');
      setNotes('');
      setSuccessMessage(status === 'approved'
        ? 'Upgrade applied. Your account tier has been updated.'
        : 'Upgrade request submitted. Admin will review your payment proof.');
      pushNotice?.({ variant: 'success', message: status === 'approved' ? 'Upgrade applied.' : 'Upgrade request submitted.' });
    } catch (error) {
      pushNotice?.({ variant: 'error', message: error instanceof Error ? error.message : 'Upgrade request failed.' });
    } finally {
      setSubmitting(false);
    }
  }, [notes, payerName, paymentChannel, proofFile, pushNotice, quotePrice, refreshAccountCapabilities, referenceNo, selected, submitting]);

  const selectPlan = React.useCallback((tier: UpgradeTierOption) => {
    setSelectedTier(tier.tier);
    if (!tier.available || tier.pendingRequest) return;
    setSuccessMessage(null);
    setStep('request');
  }, []);

  React.useEffect(() => {
    if (mobilePlanIndex < planViews.length) return;
    setMobilePlanIndex(Math.max(0, planViews.length - 1));
  }, [mobilePlanIndex, planViews.length]);

  React.useEffect(() => {
    if (step !== 'plans' || loading || !planViews.length) return;
    const frame = window.requestAnimationFrame(() => {
      const rail = planRailRef.current;
      const target = rail?.children.item(mobilePlanIndex) as HTMLElement | null;
      target?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, mobilePlanIndex, planViews.length, step]);

  const showMobilePlan = React.useCallback((nextIndex: number) => {
    if (!planViews.length) return;
    const normalized = (nextIndex + planViews.length) % planViews.length;
    const forwardDistance = (normalized - mobilePlanIndex + planViews.length) % planViews.length;
    const backwardDistance = (mobilePlanIndex - normalized + planViews.length) % planViews.length;
    setMobileSlideDirection(forwardDistance <= backwardDistance ? 'next' : 'prev');
    setMobilePlanIndex(normalized);
    window.requestAnimationFrame(() => {
      const rail = planRailRef.current;
      const target = rail?.children.item(normalized) as HTMLElement | null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }, [mobilePlanIndex, planViews.length]);

  const syncMobilePlanFromScroll = React.useCallback(() => {
    const rail = planRailRef.current;
    if (!rail || !planViews.length) return;
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
  const planFootnoteClass = isDark
    ? 'border-white/10 bg-white/[0.04] text-white/62'
    : 'border-slate-950/10 bg-white/82 text-slate-600 shadow-[0_18px_54px_rgba(15,23,42,0.08)]';
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

  const renderPlanCard = (plan: PlanView) => {
    const tier = plan.tier;
    const isFree = plan.kind === 'free';
    const isProMax = tier?.tier === 'pro_max';
    const list = isFree
      ? [
        `${freeDailyPlaysLabel} Default Bank plays/day`,
        `${ownedBankQuotaLabel} own sampler banks`,
        'Store browsing only',
        'Locked checkout and free promotions',
      ]
      : isProMax ? proMaxChecklist : proChecklist;
    const active = tier ? selectedTier === tier.tier : capabilities.effectiveTier === 'free';
    const pending = Boolean(tier?.pendingRequest);
    const disabled = isFree || !tier?.available || pending;
    const badge = isFree ? 'Current access' : pending ? 'Pending review' : isProMax ? 'Best value' : 'Most popular';
    const promoPercent = tier ? getPromoDiscountPercent(tier) : 0;
    const title = isFree ? 'FREE' : tierLabel(tier!.tier);
    const subtitle = isFree ? 'For trying VDJV before upgrading' : tier!.description;
    const displayPrice = !isFree ? tier!.quote.quotePrice : 0;
    const price = isFree ? 'Free' : formatPhp(displayPrice);
    const previousPrice = !isFree && displayPrice > 0 && promoPercent > 0
      ? formatPhp(getBeforePromoPrice(displayPrice, promoPercent))
      : null;
    const cta = isFree ? 'Current Plan' : pending ? 'Pending Review' : `Get ${title}`;
    const ctaClass = isFree
      ? isDark ? 'bg-white text-slate-950' : 'bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)]'
      : isProMax
        ? 'bg-[#1d4df5] text-white shadow-[0_14px_36px_rgba(29,78,245,0.38)] group-hover:bg-[#2860ff]'
        : 'bg-[#ed0d7c] text-white shadow-[0_14px_36px_rgba(237,13,124,0.42)] group-hover:bg-[#ff168c]';
    const shellClass = isFree
      ? isDark
        ? 'border-white/10 bg-[#15171a] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_38px_rgba(255,255,255,0.035)]'
        : 'border-slate-950/10 bg-white text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_38px_rgba(15,23,42,0.04)]'
      : isProMax
        ? isDark
          ? 'border-white/10 bg-[#10151f] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_48px_rgba(31,85,255,0.2)]'
          : 'border-slate-950/10 bg-[#eef4ff] text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_48px_rgba(31,85,255,0.14)]'
        : isDark
          ? 'border-white/10 bg-[#171318] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_48px_rgba(244,24,133,0.2)]'
          : 'border-slate-950/10 bg-[#fff1f7] text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_48px_rgba(244,24,133,0.14)]';
    const heroPanelClass = isFree
      ? isDark
        ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))]'
        : 'bg-[linear-gradient(180deg,rgba(15,23,42,0.06),rgba(15,23,42,0.02))]'
      : isProMax
        ? isDark
          ? 'bg-[radial-gradient(110%_90%_at_95%_0%,rgba(49,104,255,0.52),transparent_54%),radial-gradient(100%_86%_at_18%_4%,rgba(255,255,255,0.17),transparent_44%),linear-gradient(180deg,rgba(24,54,150,0.9),rgba(18,21,34,0.96))]'
          : 'bg-[radial-gradient(110%_90%_at_95%_0%,rgba(49,104,255,0.22),transparent_54%),radial-gradient(100%_86%_at_18%_4%,rgba(255,255,255,0.9),transparent_44%),linear-gradient(180deg,rgba(219,232,255,0.98),rgba(255,255,255,0.92))]'
        : isDark
          ? 'bg-[radial-gradient(120%_95%_at_88%_0%,rgba(255,20,132,0.62),transparent_55%),radial-gradient(100%_90%_at_12%_0%,rgba(255,255,255,0.18),transparent_42%),linear-gradient(180deg,rgba(112,19,78,0.96),rgba(27,20,30,0.98))]'
          : 'bg-[radial-gradient(120%_95%_at_88%_0%,rgba(255,20,132,0.22),transparent_55%),radial-gradient(100%_90%_at_12%_0%,rgba(255,255,255,0.95),transparent_42%),linear-gradient(180deg,rgba(255,219,237,0.98),rgba(255,255,255,0.92))]';
    const cardTextClass = isDark ? 'text-white' : 'text-slate-950';
    const subtitleClass = isDark ? 'text-white/58' : 'text-slate-600';
    const innerPanelClass = isDark ? 'bg-white/[0.075] text-white' : 'bg-white/72 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]';
    const mutedTextClass = isDark ? 'text-white/58' : 'text-slate-600';
    const secondaryTextClass = isDark ? 'text-white/65' : 'text-slate-600';
    const noteTextClass = isDark ? 'text-white/46' : 'text-slate-500';
    const featureTextClass = isDark ? 'text-white/92' : 'text-slate-800';
    const detailBoxClass = isDark ? 'border-white/7 bg-white/[0.04] text-white' : 'border-slate-950/8 bg-white/72 text-slate-950';
    const detailMutedClass = isDark ? 'text-white/66' : 'text-slate-600';
    const lockBadgeClass = isDark ? 'bg-white/10 text-white/55' : 'bg-slate-950/8 text-slate-500';
    const neutralBadgeClass = isDark ? 'bg-white/10 text-white' : 'bg-slate-950/8 text-slate-700';
    const disabledCtaClass = isDark ? 'bg-white/10 text-white/55' : 'bg-slate-950/8 text-slate-500';

    return (
      <div
        key={plan.id}
        className={`group relative flex min-h-[640px] flex-col overflow-hidden rounded-[15px] border text-left transition duration-300 md:min-h-[680px] ${cardTextClass} ${shellClass} ${
          active ? 'brightness-105' : ''
        } ${disabled ? 'cursor-default' : 'hover:-translate-y-1 hover:brightness-110'}`}
      >
        {!isFree && (
          <div className={`flex h-9 items-center justify-center text-[11px] font-black uppercase tracking-wide ${
            isProMax ? 'bg-[#2155ff]' : 'bg-[#f21984]'
          }`}>
            {isProMax ? '* ' : '+ '}{badge}
          </div>
        )}

        <div className={`relative m-4 overflow-hidden rounded-[13px] border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ${isDark ? 'border-white/8' : 'border-slate-950/8'} ${heroPanelClass}`}>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(112deg,rgba(255,255,255,0.18),transparent_24%,transparent_70%,rgba(255,255,255,0.08))]" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[28px] font-black uppercase leading-none tracking-tight">{title}</h3>
                {!isFree && (
                  <span className="rounded-[4px] bg-[#63dff0] px-2 py-0.5 text-[10px] font-black uppercase italic text-[#07242b] shadow-[0_0_18px_rgba(99,223,240,0.35)]">
                    VDJV 2.0
                  </span>
                )}
              </div>
              <p className={`mt-3 line-clamp-2 text-sm ${subtitleClass}`}>{subtitle}</p>
            </div>
            {isFree ? (
              <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${neutralBadgeClass}`}>{badge}</span>
            ) : (
              <span className="rounded-[4px] bg-[#f21984] px-2 py-1 text-[10px] font-black uppercase text-white shadow-[0_0_18px_rgba(242,25,132,0.45)]">
                {promoPercent}% OFF
              </span>
            )}
          </div>

          <div className={`relative mt-5 rounded-[10px] p-4 ${innerPanelClass}`}>
            <div className="text-sm font-black">
              * {isFree ? 'Daily trial access' : isProMax ? 'All current Store banks' : 'Full sampler tools'}
            </div>
            <div className={`mt-2 text-sm leading-relaxed ${mutedTextClass}`}>
              {isFree
                ? `${freeDailyPlaysLabel} Default Bank plays. Upgrade to remove daily play limits.`
                : isProMax
                  ? 'PRO plus Store bank grant snapshot at approval time.'
                  : 'Unlock checkout, free promos, search, mapping, backup, and editing.'}
            </div>
            <div className={`mt-4 h-1 rounded-full ${isDark ? 'bg-white/22' : 'bg-slate-950/12'}`}>
              <div className={`h-full rounded-full ${isFree ? 'w-1/3 bg-white/50' : isProMax ? 'w-full bg-[#6aa0ff]' : 'w-2/3 bg-[#f24ca2]'}`} />
            </div>
            <div className={`mt-4 flex justify-between text-xs font-bold ${secondaryTextClass}`}>
              <span>{isFree ? 'Limited' : 'Unlocked'}</span>
              <span>{isProMax ? 'Maximum' : isFree ? 'Starter' : 'Pro'}</span>
            </div>
          </div>
        </div>

        <div className="relative px-4">
          <div className="flex flex-wrap items-end gap-2">
            {previousPrice && <span className="text-[28px] font-black text-[#f21984] line-through decoration-2">{previousPrice}</span>}
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
        </div>

        {pending && (
          <div className="relative mx-4 mt-4 rounded-xl border border-amber-300/30 bg-amber-300/12 px-3 py-2 text-xs text-amber-100">
            Already submitted{tier!.pendingRequest?.receipt_reference ? `: ${tier!.pendingRequest.receipt_reference}` : ''}. Wait for admin review.
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
            {isProMax ? 'Store Access' : isFree ? 'Locked Features' : 'Included Tools'}
          </div>
          <div className={`space-y-2 text-xs ${detailMutedClass}`}>
            <div className="flex items-center justify-between gap-3">
              <span>{isProMax ? 'Published Store banks' : 'Bank Store downloads'}</span>
              <span className={`rounded px-1.5 py-0.5 font-black ${isProMax ? enabledBadgeClass : isFree ? lockBadgeClass : enabledBadgeClass}`}>
                {isProMax ? 'GRANTED' : isFree ? 'LOCKED' : 'ENABLED'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{isProMax ? 'Own bank quota' : 'Search / mappings'}</span>
              <span className={`rounded px-1.5 py-0.5 font-black ${isFree ? lockBadgeClass : neutralBadgeClass}`}>{isProMax ? '12' : isFree ? 'LOCKED' : 'ENABLED'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{isProMax ? 'Device bank cap' : 'Backup / repair'}</span>
              <span className={`rounded px-1.5 py-0.5 font-black ${isFree ? lockBadgeClass : enabledBadgeClass}`}>{isProMax ? '150' : isFree ? 'LOCKED' : 'ENABLED'}</span>
            </div>
          </div>
        </div>

        <div className="relative mt-auto px-4 pb-4 pt-6">
          <button
            type="button"
            onClick={() => tier ? selectPlan(tier) : undefined}
            disabled={disabled}
            className={`flex h-12 w-full items-center justify-center rounded-[10px] text-sm font-black transition disabled:cursor-default ${
            disabled && !isFree ? disabledCtaClass : ctaClass
          }`}>
            {cta}
            {!disabled && <ArrowRight className="ml-2 h-4 w-4" />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`w-[98vw] max-h-[96vh] overflow-hidden p-0 sm:max-w-[1380px] ${dialogShellClass}`}>
        <div className="max-h-[96vh] overflow-y-auto p-4 sm:p-6">
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
              src="/assets/preview.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.44)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-[160px] bg-[radial-gradient(120%_100%_at_50%_100%,rgba(180,40,120,0.48)_0%,rgba(140,30,100,0.24)_50%,transparent_72%)]" />
            <div className="absolute left-0 right-0 top-11 flex flex-col items-center gap-1 text-center">
              <p className="text-sm font-semibold text-white/78">Special Offer</p>
              <p className="select-none text-[60px] font-black uppercase leading-[68px] tracking-[-0.05em] text-transparent drop-shadow-[0_4px_16px_rgba(0,0,0,0.26)] [background-clip:text] [-webkit-text-fill-color:transparent] [background-image:linear-gradient(182deg,rgb(255,255,255)_50%,rgba(255,255,255,0.6)_74%)]">
                {heroPromoPercent}% OFF
              </p>
              <p className="text-sm font-semibold text-white/78">Pay less, play more</p>
            </div>
          </div>
        )}
        <DialogHeader className={step === 'plans' ? 'items-center text-center' : undefined}>
          <DialogTitle className={step === 'plans'
            ? `text-3xl font-black tracking-tight sm:text-5xl ${planTitleClass}`
            : 'text-2xl font-black tracking-tight sm:text-3xl'}
          >
            {step === 'plans' ? 'PICK YOUR PLAN' : `Request ${selected ? tierLabel(selected.tier) : 'upgrade'}`}
          </DialogTitle>
          <DialogDescription className={step === 'plans' ? planDescriptionClass : undefined}>
            {step === 'plans'
              ? 'Scale your sampler access with higher limits, Store downloads, and event-ready features.'
              : `Current tier: ${currentTierLabel}${profile?.display_name ? ` - ${profile.display_name}` : ''}.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading upgrade options...
          </div>
        ) : step === 'plans' ? (
          <div className="relative mt-5 space-y-5">
            <div className={`pointer-events-none absolute inset-x-0 top-20 mx-auto h-64 max-w-4xl rounded-full blur-3xl ${planAmbientGlowClass}`} />
            <div className={`hidden items-center justify-center gap-3 text-xs font-black uppercase tracking-wide md:flex ${planMetaClass}`}>
              <span className="rounded-[8px] bg-[#f21984] px-3 py-1.5 text-white shadow-[0_0_28px_rgba(242,25,132,0.34)]">{heroPromoPercent}% off</span>
              <span>One-time upgrade pricing</span>
            </div>

            <div className={`relative -mx-4 rounded-[1.6rem] border py-4 md:mx-0 md:border-0 md:bg-transparent md:px-0 md:shadow-none ${planRailShellClass}`}>
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
                className="absolute left-1 top-[36%] z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur md:hidden"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next plan"
                onClick={() => showMobilePlan(mobilePlanIndex + 1)}
                className="absolute right-1 top-[36%] z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur md:hidden"
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

            <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed backdrop-blur ${planFootnoteClass}`}>
              PRO MAX grants Store banks that are published at upgrade approval time. Future new releases are not automatically included unless admin grants them later.
            </div>

            {successMessage && (
              <div className="rounded-xl border border-[#b9ff12]/40 bg-[#b9ff12]/10 px-3 py-2 text-sm font-semibold text-lime-400">
                {successMessage}
              </div>
            )}
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

            {successMessage && (
              <div className="rounded-xl border border-[#b9ff12]/40 bg-[#b9ff12]/10 px-3 py-2 text-sm font-semibold text-lime-400">
                {successMessage}
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setStep('plans')} disabled={submitting} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Plans
              </Button>
              <Button type="button" onClick={() => void submitUpgrade()} disabled={submitting || !selected.available} className={`flex-1 ${requestSubmitButtonClass}`}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : quotePrice > 0 ? <Upload className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                {submitting ? 'Submitting...' : quotePrice > 0 ? 'Submit Upgrade Request' : 'Apply Upgrade'}
              </Button>
            </div>
          </div>
        ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
