import * as React from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, Loader2, Upload } from 'lucide-react';
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
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof');
  const [payerName, setPayerName] = React.useState('');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
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
  const quotePrice = selected?.quote?.quotePrice ?? selected?.pricePhp ?? 0;
  const currentTierLabel = capabilities.effectiveTier === 'pro_max' ? 'PRO MAX' : capabilities.effectiveTier.toUpperCase();
  const freeDailyPlaysLabel = typeof capabilities.limits.defaultBankDailyPlays === 'number'
    ? String(capabilities.limits.defaultBankDailyPlays)
    : 'Unlimited';
  const ownedBankQuotaLabel = Number.isFinite(capabilities.limits.ownedBankQuota)
    ? String(capabilities.limits.ownedBankQuota)
    : '2';
  const isCurrentFreeTier = capabilities.effectiveTier === 'free';

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

  const shellClass = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100'
    : 'border-slate-200 bg-white text-slate-950';
  const cardClass = isDark
    ? 'border-slate-800 bg-slate-900/72'
    : 'border-slate-200 bg-white';
  const mutedCardClass = isDark
    ? 'border-slate-800 bg-slate-900/52'
    : 'border-slate-200 bg-slate-50';
  const inputClass = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400';

  const renderPlanCard = (tier: UpgradeTierOption) => {
    const isProMax = tier.tier === 'pro_max';
    const list = isProMax ? proMaxChecklist : proChecklist;
    const active = selectedTier === tier.tier;
    const pending = Boolean(tier.pendingRequest);
    const disabled = !tier.available || pending;
    const badge = pending ? 'Pending review' : isProMax ? 'Best value' : 'Recommended';
    return (
      <button
        key={tier.tier}
        type="button"
        onClick={() => selectPlan(tier)}
        className={`group relative flex min-h-[390px] flex-col overflow-hidden rounded-[1.75rem] border p-5 text-left transition sm:p-6 ${
          active
            ? 'border-emerald-400 bg-emerald-500/12 shadow-[0_0_0_2px_rgba(52,211,153,0.16),0_24px_70px_rgba(16,185,129,0.14)]'
            : `${cardClass} hover:-translate-y-0.5 hover:border-emerald-400/70 hover:shadow-2xl`
        } ${disabled ? 'opacity-75' : ''}`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-emerald-400/18 to-transparent" />
        {isProMax && <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-amber-400/20 blur-2xl" />}
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-500">{tierLabel(tier.tier)}</div>
            <div className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{tier.displayName}</div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
            pending
              ? 'bg-amber-500/15 text-amber-500'
              : isProMax
                ? 'bg-amber-500/15 text-amber-500'
                : 'bg-emerald-500/15 text-emerald-500'
          }`}>
            {badge}
          </span>
        </div>
        <div className="relative mt-5">
          <div className="flex items-end gap-2">
            <span className="text-4xl font-black tracking-tight sm:text-5xl">{formatPhp(tier.quote.quotePrice)}</span>
          </div>
          {tier.quote.creditPhp > 0 ? (
            <div className="mt-2 text-xs font-semibold text-emerald-500">
              {formatPhp(tier.quote.creditPhp)} previous paid Store credit deducted.
            </div>
          ) : (
            <div className="mt-2 text-xs opacity-65">One-time upgrade request, reviewed by admin.</div>
          )}
        </div>
        <p className="relative mt-4 text-sm leading-relaxed opacity-78">{tier.description}</p>
        {tier.pendingRequest && (
          <div className="relative mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
            Already submitted{tier.pendingRequest.receipt_reference ? `: ${tier.pendingRequest.receipt_reference}` : ''}. Wait for admin review before sending another request.
          </div>
        )}
        <div className="relative mt-5 space-y-2.5">
          {list.map((item) => (
            <div key={item} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-auto pt-6">
          <div className={`flex h-11 items-center justify-center rounded-full text-sm font-black transition ${
            disabled
              ? isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'
              : isProMax
                ? 'bg-amber-400 text-slate-950 group-hover:bg-amber-300'
                : 'bg-emerald-500 text-slate-950 group-hover:bg-emerald-400'
          }`}>
            {pending ? 'Pending Review' : tier.available ? `Get ${tierLabel(tier.tier)}` : 'Current Plan'}
            {!disabled && <ArrowRight className="ml-2 h-4 w-4" />}
          </div>
        </div>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`w-[96vw] max-h-[94vh] overflow-y-auto sm:max-w-5xl ${shellClass}`}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight sm:text-3xl">
            {step === 'plans' ? 'Pick your plan' : `Request ${selected ? tierLabel(selected.tier) : 'upgrade'}`}
          </DialogTitle>
          <DialogDescription>
            Current tier: {currentTierLabel}{profile?.display_name ? ` - ${profile.display_name}` : ''}.
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
          <div className="space-y-5">
            <div className={`overflow-hidden rounded-[1.75rem] border ${mutedCardClass}`}>
              <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
                <div className="p-5 sm:p-6">
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{currentTierLabel}</div>
                  <h3 className="mt-2 text-2xl font-black tracking-tight">You are currently on {currentTierLabel}</h3>
                  <p className="mt-3 text-sm leading-relaxed opacity-75">
                    {isCurrentFreeTier
                      ? 'FREE keeps the app usable for light practice: Default Bank daily plays, limited own banks, and store browsing only. Upgrade when you need event-ready features or Store bank access.'
                      : 'Your current plan stays active while the upgrade request is reviewed. Upgrade when you need higher limits or the PRO MAX Store bank grant.'}
                  </p>
                </div>
                <div className={`grid grid-cols-2 gap-0 border-t text-center md:border-l md:border-t-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <div className={`p-4 ${isDark ? 'border-slate-800' : 'border-slate-200'} border-r`}>
                    <div className="text-2xl font-black">{freeDailyPlaysLabel}</div>
                    <div className="text-xs opacity-65">Default Bank plays/day</div>
                  </div>
                  <div className="p-4">
                    <div className="text-2xl font-black">{ownedBankQuotaLabel}</div>
                    <div className="text-xs opacity-65">Own bank quota</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {tiers.map(renderPlanCard)}
            </div>

            <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${mutedCardClass}`}>
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
      </DialogContent>
    </Dialog>
  );
}
