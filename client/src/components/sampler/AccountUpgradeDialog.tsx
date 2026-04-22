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
  reason?: string | null;
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

export function AccountUpgradeDialog({ open, onOpenChange, theme, reason, pushNotice }: AccountUpgradeDialogProps) {
  const { profile, capabilities } = useAuthState();
  const { refreshAccountCapabilities } = useAuthActions();
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [step, setStep] = React.useState<DialogStep>('plans');
  const [tiers, setTiers] = React.useState<UpgradeTierOption[]>([]);
  const [paymentConfig, setPaymentConfig] = React.useState<PaymentConfig | null>(null);
  const [selectedTier, setSelectedTier] = React.useState<TargetTier>('pro');
  const [mobilePlanIndex, setMobilePlanIndex] = React.useState(0);
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof');
  const [payerName, setPayerName] = React.useState('');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const planRailRef = React.useRef<HTMLDivElement | null>(null);
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

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setStep('plans');
    setMobilePlanIndex(0);
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
  const planViews = React.useMemo<PlanView[]>(() => [
    { id: 'free', kind: 'free' },
    ...tiers.map((tier) => ({ id: tier.tier, kind: 'tier' as const, tier })),
  ], [tiers]);
  const quotePrice = selected?.quote?.quotePrice ?? selected?.pricePhp ?? 0;
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

  const showMobilePlan = React.useCallback((nextIndex: number) => {
    if (!planViews.length) return;
    const normalized = (nextIndex + planViews.length) % planViews.length;
    setMobilePlanIndex(normalized);
    window.requestAnimationFrame(() => {
      const rail = planRailRef.current;
      const target = rail?.children.item(normalized) as HTMLElement | null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }, [planViews.length]);

  const shellClass = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100'
    : 'border-slate-200 bg-white text-slate-950';
  const cardClass = isDark
    ? 'border-slate-800 bg-slate-900/72'
    : 'border-slate-200 bg-white';
  const inputClass = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400';
  const dialogShellClass = step === 'plans'
    ? 'border-slate-900 bg-[#07090d] text-slate-100'
    : shellClass;

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
    const badge = isFree ? 'Current Access' : pending ? 'Pending review' : isProMax ? 'Best value' : 'Most popular';
    const accentClass = isFree
      ? 'from-slate-500/20 via-slate-500/10 to-slate-900/10 border-slate-500/30 shadow-slate-950/30'
      : isProMax
        ? 'from-sky-500/35 via-blue-600/20 to-slate-900/10 border-blue-500 shadow-blue-500/25'
        : 'from-pink-500/40 via-fuchsia-500/20 to-slate-900/10 border-pink-500 shadow-pink-500/25';
    const title = isFree ? 'FREE' : tierLabel(tier!.tier);
    const subtitle = isFree
      ? 'For trying VDJV before upgrading'
      : tier!.description;
    const price = isFree ? 'Free' : formatPhp(tier!.quote.quotePrice);
    const previousPrice = !isFree && tier!.quote.creditPhp > 0 ? formatPhp(tier!.quote.basePrice) : null;
    const cta = isFree ? 'Current Plan' : pending ? 'Pending Review' : `Get ${title}`;
    const ctaClass = isFree
      ? 'bg-white text-slate-950'
      : isProMax
        ? 'bg-blue-600 text-white shadow-[0_12px_34px_rgba(37,99,235,0.38)] group-hover:bg-blue-500'
        : 'bg-pink-600 text-white shadow-[0_12px_34px_rgba(219,39,119,0.38)] group-hover:bg-pink-500';
    return (
      <button
        key={plan.id}
        type="button"
        onClick={() => tier ? selectPlan(tier) : undefined}
        className={`group relative flex min-h-[520px] flex-col overflow-hidden rounded-[1.65rem] border bg-gradient-to-b p-4 text-left text-white shadow-2xl transition duration-300 sm:p-5 ${accentClass} ${
          active ? 'ring-2 ring-white/20' : ''
        } ${disabled ? 'cursor-default' : 'hover:-translate-y-1 hover:brightness-110'}`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(255,255,255,0.24),transparent_36%),radial-gradient(circle_at_88%_20%,rgba(255,255,255,0.14),transparent_28%)]" />
        <div className="pointer-events-none absolute inset-x-5 top-20 h-32 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">{title}</h3>
              {!isFree && (
                <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${isProMax ? 'bg-blue-300 text-blue-950' : 'bg-cyan-300 text-cyan-950'}`}>
                  VDJV 2.0
                </span>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-white/64">{subtitle}</p>
          </div>
          <span className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
            isProMax ? 'bg-blue-600 text-white' : isFree ? 'bg-white/12 text-white/80' : 'bg-pink-600 text-white'
          }`}>
            {badge}
          </span>
        </div>
        <div className="relative mt-5 rounded-2xl border border-white/8 bg-white/[0.075] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
          <div className="text-sm font-black">
            {isFree ? 'Daily trial access' : isProMax ? 'All current Store banks' : 'Full sampler tools'}
          </div>
          <div className="mt-2 text-sm leading-relaxed text-white/65">
            {isFree
              ? `${freeDailyPlaysLabel} Default Bank plays. Upgrade to remove daily play limits.`
              : isProMax
                ? 'PRO plus Store bank grant snapshot at approval time.'
                : 'Unlock checkout, free promos, search, mapping, backup, and editing.'}
          </div>
          <div className="mt-4 h-1.5 rounded-full bg-white/18">
            <div className={`h-full rounded-full ${isFree ? 'w-1/3 bg-white/55' : isProMax ? 'w-full bg-blue-400' : 'w-2/3 bg-pink-500'}`} />
          </div>
          <div className="mt-3 flex justify-between text-xs font-bold text-white/70">
            <span>{isFree ? 'Limited' : 'Unlocked'}</span>
            <span>{isProMax ? 'Maximum' : isFree ? 'Starter' : 'Pro'}</span>
          </div>
        </div>
        <div className="relative mt-5">
          <div className="flex flex-wrap items-end gap-2">
            {previousPrice && <span className="text-2xl font-black text-pink-500 line-through">{previousPrice}</span>}
            <span className="text-4xl font-black tracking-tight sm:text-5xl">{price}</span>
            {!isFree && <span className="pb-1 text-xs text-white/58">one-time request</span>}
          </div>
          {!isFree && tier!.quote.creditPhp > 0 ? (
            <div className="mt-2 inline-flex rounded-full bg-lime-300 px-2 py-0.5 text-[10px] font-black uppercase text-slate-950">
              {formatPhp(tier!.quote.creditPhp)} cheaper
            </div>
          ) : (
            <div className="mt-2 text-xs text-white/50">{isFree ? 'Upgrade offer available anytime.' : 'Admin reviews payment proof before activation.'}</div>
          )}
        </div>
        {pending && (
          <div className="relative mt-4 rounded-xl border border-amber-300/30 bg-amber-300/12 px-3 py-2 text-xs text-amber-100">
            Already submitted{tier!.pendingRequest?.receipt_reference ? `: ${tier!.pendingRequest.receipt_reference}` : ''}. Wait for admin review.
          </div>
        )}
        <div className="relative mt-5 space-y-2">
          {list.map((item) => (
            <div key={item} className="flex items-start gap-2.5 text-[13px] font-semibold text-white/92">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-5 rounded-2xl border border-white/8 bg-black/18 p-3">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-white/88">
            {isProMax ? 'Store Access' : isFree ? 'Locked Features' : 'Included Tools'}
          </div>
          <div className="space-y-2 text-xs text-white/66">
            <div className="flex items-center justify-between gap-3">
              <span>{isProMax ? 'Published Store banks' : 'Bank Store downloads'}</span>
              <span className={`rounded px-1.5 py-0.5 font-black ${isProMax ? 'bg-lime-300 text-slate-950' : isFree ? 'bg-white/10 text-white/55' : 'bg-lime-300 text-slate-950'}`}>
                {isProMax ? 'GRANTED' : isFree ? 'LOCKED' : 'ENABLED'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{isProMax ? 'Own bank quota' : 'Search / mappings'}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-black text-white">{isProMax ? '12' : isFree ? 'LOCKED' : 'ENABLED'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{isProMax ? 'Device bank cap' : 'Backup / repair'}</span>
              <span className="rounded bg-lime-300 px-1.5 py-0.5 font-black text-slate-950">{isProMax ? '150' : isFree ? 'LOCKED' : 'ENABLED'}</span>
            </div>
          </div>
        </div>
        <div className="relative mt-auto pt-6">
          <div className={`flex h-11 items-center justify-center rounded-full text-sm font-black transition ${
            disabled && !isFree ? 'bg-white/10 text-white/55' : ctaClass
          }`}>
            {cta}
            {!disabled && <ArrowRight className="ml-2 h-4 w-4" />}
          </div>
        </div>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`w-[98vw] max-h-[96vh] overflow-hidden p-0 sm:max-w-[1380px] ${dialogShellClass}`}>
        <div className="max-h-[96vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className={step === 'plans' ? 'items-center text-center' : undefined}>
          <DialogTitle className={step === 'plans'
            ? 'text-3xl font-black tracking-tight text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.16)] sm:text-5xl'
            : 'text-2xl font-black tracking-tight sm:text-3xl'}
          >
            {step === 'plans' ? 'PICK YOUR PLAN' : `Request ${selected ? tierLabel(selected.tier) : 'upgrade'}`}
          </DialogTitle>
          <DialogDescription className={step === 'plans' ? 'text-slate-400' : undefined}>
            {step === 'plans'
              ? 'Scale your sampler access with higher limits, Store downloads, and event-ready features.'
              : `Current tier: ${currentTierLabel}${profile?.display_name ? ` - ${profile.display_name}` : ''}.`}
          </DialogDescription>
        </DialogHeader>

        {reason && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <span className="font-semibold">Upgrade option:</span> {reason}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading upgrade options...
          </div>
        ) : step === 'plans' ? (
          <div className="relative mt-5 space-y-5">
            <div className="pointer-events-none absolute inset-x-0 top-20 mx-auto h-64 max-w-4xl rounded-full bg-pink-500/10 blur-3xl" />
            <div className="flex items-center justify-center">
              <div className="inline-flex items-center gap-3 rounded-full bg-lime-300/20 px-3 py-1.5 text-xs font-bold text-lime-300 ring-1 ring-lime-300/20">
                <span className="flex -space-x-2">
                  {['DJ', 'VJ', 'MC'].map((label) => (
                    <span key={label} className="flex h-7 w-7 items-center justify-center rounded-full border border-black/40 bg-slate-800 text-[9px] font-black text-white shadow-lg">
                      {label}
                    </span>
                  ))}
                </span>
                <span>Built for live event performers</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 text-xs font-black uppercase tracking-wide text-white/60">
              <span>Monthly</span>
              <span className="relative h-6 w-11 rounded-full bg-white/25 shadow-inner">
                <span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow" />
              </span>
              <span className="text-white">Annual</span>
              <span className="rounded-lg bg-pink-600 px-2.5 py-1 text-white">30% off</span>
            </div>

            <div className="relative -mx-4 md:mx-0">
              <div className="mb-3 flex items-center justify-center gap-2 text-xs text-white/70">
                <span className="rounded-full bg-white/10 px-3 py-1">Current tier: {currentTierLabel}</span>
              </div>
              <div
                ref={planRailRef}
                className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:grid md:grid-cols-1 md:overflow-visible md:px-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden"
              >
                {planViews.map((plan) => (
                  <div key={plan.id} className="w-[min(86vw,430px)] shrink-0 snap-center md:w-auto">
                    {renderPlanCard(plan)}
                  </div>
                ))}
              </div>
              <button
                type="button"
                aria-label="Previous plan"
                onClick={() => showMobilePlan(mobilePlanIndex - 1)}
                className="absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next plan"
                onClick={() => showMobilePlan(mobilePlanIndex + 1)}
                className="absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="mt-4 flex justify-center gap-1.5">
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

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-relaxed text-white/62 backdrop-blur">
              PRO MAX grants Store banks that are published at upgrade approval time. Future new releases are not automatically included unless admin grants them later.
            </div>

            {successMessage && (
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
                {successMessage}
              </div>
            )}
          </div>
        ) : selected ? (
          <div className="mx-auto max-w-2xl space-y-5">
            <div className={`rounded-[1.75rem] border p-5 shadow-sm ${cardClass}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-500">Selected plan</div>
                  <h3 className="mt-1 text-2xl font-black">{selected.displayName}</h3>
                  <p className="mt-1 text-sm opacity-75">{selected.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black">{formatPhp(quotePrice)}</div>
                  {selected.quote.creditPhp > 0 && <div className="text-xs text-emerald-500">-{formatPhp(selected.quote.creditPhp)} Store credit</div>}
                </div>
              </div>
            </div>

            {quotePrice > 0 ? (
              <>
                <div className={`rounded-xl border p-5 shadow-sm ${cardClass}`}>
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
                    <div className={`mt-4 whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm leading-relaxed ${isDark ? 'border-slate-800 bg-slate-950/60 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                      {paymentConfig.instructions}
                    </div>
                  )}

                  {(paymentConfig?.gcash_number || paymentConfig?.maya_number) && (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {paymentConfig.gcash_number && (
                        <div className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center ${isDark ? 'border-blue-500/30 bg-blue-900/20' : 'border-blue-100 bg-blue-50'}`}>
                          <span className="text-xs font-black uppercase tracking-wider text-blue-500">GCash</span>
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
                        <div className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center ${isDark ? 'border-green-500/30 bg-green-900/20' : 'border-green-100 bg-green-50'}`}>
                          <span className="text-xs font-black uppercase tracking-wider text-green-500">Maya</span>
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

                <div className={`rounded-xl border p-5 shadow-sm ${cardClass}`}>
                  <div className="grid gap-4">
                    <div className="space-y-1.5">
                      <Label>Payment Channel</Label>
                      <select
                        value={paymentChannel}
                        onChange={(event) => setPaymentChannel(event.target.value as PaymentChannel)}
                        className={`w-full rounded-md border p-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40 ${inputClass}`}
                      >
                        <option value="image_proof">Upload Official Receipt (Fast Approval)</option>
                        <option value="gcash_manual">GCash Manual</option>
                        <option value="maya_manual">Maya Manual</option>
                      </select>
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
                        {proofPreviewUrl && <img src={proofPreviewUrl} alt="Payment proof preview" className="h-14 w-14 rounded-md border object-cover" />}
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
                        className={`w-full resize-none rounded-md border p-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40 ${inputClass}`}
                        placeholder="Optional message for admin"
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className={`rounded-xl border p-4 text-sm ${isDark ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                No payment is required for this upgrade quote. Submit to apply or create an admin-reviewed request.
              </div>
            )}

            {successMessage && (
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
                {successMessage}
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setStep('plans')} disabled={submitting} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Plans
              </Button>
              <Button type="button" onClick={() => void submitUpgrade()} disabled={submitting || !selected.available} className="flex-1 bg-emerald-500 font-black text-slate-950 hover:bg-emerald-400">
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
