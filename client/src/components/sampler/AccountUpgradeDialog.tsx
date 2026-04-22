import * as React from 'react';
import { ArrowRight, Check, ExternalLink, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { supabase } from '@/lib/supabase';
import { useAuthActions, useAuthState } from '@/hooks/useAuth';

type TargetTier = 'pro' | 'pro_max';
type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual';

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

export function AccountUpgradeDialog({ open, onOpenChange, theme, reason, pushNotice }: AccountUpgradeDialogProps) {
  const { user, profile, capabilities } = useAuthState();
  const { refreshAccountCapabilities } = useAuthActions();
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [tiers, setTiers] = React.useState<UpgradeTierOption[]>([]);
  const [paymentConfig, setPaymentConfig] = React.useState<PaymentConfig | null>(null);
  const [selectedTier, setSelectedTier] = React.useState<TargetTier>('pro');
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof');
  const [payerName, setPayerName] = React.useState('');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const isDark = theme === 'dark';

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
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

  const proChecklist = [
    'Bank Store checkout and free promotions',
    'Search, MIDI/keyboard mapping, backup and repair',
    'Full pad/bank edit controls and 4 deck channels',
  ];
  const proMaxChecklist = [
    'Everything in PRO',
    'All Store banks published at upgrade time are granted',
    'Higher own-bank and device bank caps',
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-4xl ${isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'bg-white'}`}>
        <DialogHeader>
          <DialogTitle>Upgrade Account</DialogTitle>
          <DialogDescription>
            Current tier: {currentTierLabel}{profile?.display_name ? ` - ${profile.display_name}` : ''}.
          </DialogDescription>
        </DialogHeader>

        {reason && (
          <div className={`rounded-xl border px-3 py-2 text-sm ${isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {reason}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading upgrade options...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className={`rounded-2xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/70' : 'border-slate-200 bg-slate-50'}`}>
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">FREE</div>
                <div className="mt-2 text-xl font-bold">You are here</div>
                <p className="mt-2 text-sm opacity-80">Default Bank daily plays, limited own sampler banks, and locked Store downloads.</p>
              </div>
              {tiers.map((tier) => {
                const active = selectedTier === tier.tier;
                const list = tier.tier === 'pro_max' ? proMaxChecklist : proChecklist;
                return (
                  <button
                    key={tier.tier}
                    type="button"
                    onClick={() => setSelectedTier(tier.tier)}
                    disabled={!tier.available}
                    className={`rounded-2xl border p-4 text-left transition ${active
                      ? 'border-emerald-400 bg-emerald-500/12 shadow-[0_0_0_2px_rgba(52,211,153,0.18)]'
                      : isDark ? 'border-slate-800 bg-slate-900/70 hover:border-slate-600' : 'border-slate-200 bg-white hover:border-slate-300'
                    } disabled:opacity-55`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-500">{tier.displayName}</div>
                      {tier.pendingRequest ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-500">Pending</span>
                      ) : !tier.available && <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px]">Current</span>}
                    </div>
                    <div className="mt-2 text-2xl font-black">{formatPhp(tier.quote.quotePrice)}</div>
                    {tier.quote.creditPhp > 0 && (
                      <div className="mt-1 text-[11px] text-emerald-500">Includes {formatPhp(tier.quote.creditPhp)} store credit deduction</div>
                    )}
                    {tier.pendingRequest && (
                      <div className="mt-1 text-[11px] text-amber-500">
                        Pending admin review{tier.pendingRequest.receipt_reference ? `: ${tier.pendingRequest.receipt_reference}` : ''}.
                      </div>
                    )}
                    <p className="mt-2 text-sm opacity-80">{tier.description}</p>
                    <div className="mt-3 space-y-1.5">
                      {list.map((item) => (
                        <div key={item} className="flex items-start gap-2 text-xs">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && selected.available && (
              <div className={`rounded-2xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/70' : 'border-slate-200 bg-slate-50'}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Request {selected.displayName}</div>
                    <div className="text-xs opacity-70">Quote: {formatPhp(quotePrice)}</div>
                  </div>
                  {paymentConfig?.messenger_url && (
                    <Button type="button" variant="outline" size="sm" onClick={() => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer')}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Facebook Help
                    </Button>
                  )}
                </div>

                {quotePrice > 0 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Payment Channel</Label>
                      <select
                        value={paymentChannel}
                        onChange={(event) => setPaymentChannel(event.target.value as PaymentChannel)}
                        className={`h-9 w-full rounded-md border px-3 text-sm ${isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-300 bg-white text-slate-900'}`}
                      >
                        <option value="image_proof">Upload Receipt</option>
                        <option value="gcash_manual">GCash Manual</option>
                        <option value="maya_manual">Maya Manual</option>
                      </select>
                      {paymentConfig?.instructions && (
                        <p className="whitespace-pre-wrap text-xs opacity-75">{paymentConfig.instructions}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Payment Proof</Label>
                      <Input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                        onChange={(event) => setProofFile(event.target.files?.[0] || null)}
                      />
                      {proofFile && <div className="text-xs opacity-70">{proofFile.name}</div>}
                    </div>
                    {(paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && (
                      <>
                        <div className="space-y-2">
                          <Label>Payer Name</Label>
                          <Input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Name used to send payment" />
                        </div>
                        <div className="space-y-2">
                          <Label>Reference Number</Label>
                          <Input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="Transaction reference" />
                        </div>
                      </>
                    )}
                    <div className="space-y-2 md:col-span-2">
                      <Label>Notes (optional)</Label>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        className={`min-h-20 w-full rounded-md border px-3 py-2 text-sm ${isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-300 bg-white text-slate-900'}`}
                        placeholder="Optional message for admin"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <Button onClick={() => void submitUpgrade()} disabled={submitting}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : quotePrice > 0 ? <Upload className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                    {submitting ? 'Submitting...' : quotePrice > 0 ? 'Submit Upgrade Request' : 'Apply Upgrade'}
                  </Button>
                </div>
              </div>
            )}

            {successMessage && (
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
                {successMessage}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
