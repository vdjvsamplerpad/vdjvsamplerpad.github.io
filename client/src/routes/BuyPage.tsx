import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, Loader2 } from 'lucide-react';

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
import { openWalletAppAfterCopy } from '@/lib/mobile-wallet-links';
import { getLandingPagePath } from '@/lib/runtime-routes';
import { supabase } from '@/lib/supabase';

type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual';
type InstallerVersion = 'V2' | 'V3';

type BuyConfigResponse = {
  config: LandingDownloadConfig;
  paymentConfig: {
    instructions?: string;
    gcash_number?: string;
    maya_number?: string;
    messenger_url?: string;
    qr_image_path?: string;
    account_price_php?: number | null;
  };
  v2v3Products: Array<{
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
  }>;
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

const PAYMENT_CHANNEL_OPTIONS: Array<{ value: PaymentChannel; label: string }> = [
  { value: 'image_proof', label: 'Upload receipt image' },
  { value: 'gcash_manual', label: 'GCash manual entry' },
  { value: 'maya_manual', label: 'Maya manual entry' },
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
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BuyPage() {
  const landingPagePath = React.useMemo(() => getLandingPagePath(), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selectedVersion, setSelectedVersion] = React.useState<VersionKey>('V1');
  const [config, setConfig] = React.useState<BuyConfigResponse>({
    config: normalizeLandingDownloadConfig(DEFAULT_LANDING_DOWNLOAD_CONFIG),
    paymentConfig: {},
    v2v3Products: [],
  });

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof');
  const [payerName, setPayerName] = React.useState('');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [expandedQrUrl, setExpandedQrUrl] = React.useState<string | null>(null);
  const [selectedSkus, setSelectedSkus] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  const [versionDescriptionExpanded, setVersionDescriptionExpanded] = React.useState(false);

  React.useEffect(() => {
    const requestedVersion = String(searchParams.get('version') || '').toUpperCase();
    if (requestedVersion === 'V1' || requestedVersion === 'V2' || requestedVersion === 'V3') {
      setSelectedVersion(requestedVersion as VersionKey);
    }
  }, [searchParams]);

  React.useEffect(() => {
    setVersionDescriptionExpanded(false);
  }, [selectedVersion]);

  const versionProducts = React.useMemo(
    () => config.v2v3Products.filter((item) => item.version === selectedVersion),
    [config.v2v3Products, selectedVersion],
  );
  const selectedProducts = React.useMemo(
    () => versionProducts.filter((item) => selectedSkus.includes(item.skuCode)),
    [selectedSkus, versionProducts],
  );
  const selectedPrimaryProduct = selectedProducts[0] || null;
  const selectedUpdatesOnly = React.useMemo(
    () => selectedProducts.filter((item) => item.productType === 'update'),
    [selectedProducts],
  );
  const activeBuySection = config.config.buySections[selectedVersion];
  const activeVersionDescription = config.config.versionDescriptions[selectedVersion];
  const messengerUrl = String(config.paymentConfig.messenger_url || '').trim();
  const v1Links = config.config.downloadLinks.V1;
  const handleVersionChange = React.useCallback((version: VersionKey) => {
    setSelectedVersion(version);
    setSearchParams(version === 'V1' ? {} : { version });
    setResult(null);
    setError('');
  }, [setSearchParams]);

  React.useEffect(() => {
    let active = true;
    fetch(edgeFunctionUrl('store-api', 'buy-config'))
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        const data = payload?.data ?? payload;
        if (!active) return;
        if (!res.ok) {
          setError(String(payload?.error || data?.error || 'Buy page config could not be loaded. Please refresh.'));
          return;
        }
        setConfig({
          config: normalizeLandingDownloadConfig(data?.config || DEFAULT_LANDING_DOWNLOAD_CONFIG),
          paymentConfig: data?.paymentConfig || {},
          v2v3Products: Array.isArray(data?.v2v3Products) ? data.v2v3Products : [],
        });
      })
      .catch(() => {
        if (active) setError('Buy page config could not be loaded. Please refresh.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (selectedVersion === 'V1') {
      setSelectedSkus([]);
      return;
    }
    setSelectedSkus((current) => current.filter((skuCode) => versionProducts.some((item) => item.skuCode === skuCode)));
  }, [config.v2v3Products, selectedVersion, versionProducts]);

  const handleProductToggle = React.useCallback((product: BuyConfigResponse['v2v3Products'][number]) => {
    setSelectedSkus((current) => {
      const currentStandard = current.filter((skuCode) => (
        versionProducts.some((item) => item.skuCode === skuCode && item.productType === 'standard')
      ));
      if (product.productType === 'update') {
        const currentUpdates = current.filter((skuCode) => (
          versionProducts.some((item) => item.skuCode === skuCode && item.productType === 'update')
        ));
        if (currentUpdates.includes(product.skuCode)) {
          return [...currentStandard, ...currentUpdates.filter((skuCode) => skuCode !== product.skuCode)];
        }
        return [...currentStandard, ...currentUpdates, product.skuCode].sort((left, right) => {
          const leftOrder = versionProducts.find((item) => item.skuCode === left)?.sortOrder ?? 0;
          const rightOrder = versionProducts.find((item) => item.skuCode === right)?.sortOrder ?? 0;
          return leftOrder - rightOrder;
        });
      }
      if (product.productType === 'standard') {
        if (currentStandard.includes(product.skuCode)) {
          return current.filter((skuCode) => skuCode !== product.skuCode);
        }
        const currentUpdates = current.filter((skuCode) => (
          versionProducts.some((item) => item.skuCode === skuCode && item.productType === 'update')
        ));
        return [product.skuCode, ...currentUpdates].sort((left, right) => {
          const leftOrder = versionProducts.find((item) => item.skuCode === left)?.sortOrder ?? 0;
          const rightOrder = versionProducts.find((item) => item.skuCode === right)?.sortOrder ?? 0;
          return leftOrder - rightOrder;
        });
      }
      return [product.skuCode];
    });
  }, [versionProducts]);

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPayerName = payerName.trim();
    const normalizedReferenceNo = referenceNo.trim();
    const normalizedNotes = notes.trim();

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
        });
        if (!submitRes.res.ok || submitRes.code) {
          throw new Error(mapRegistrationError(submitRes.code, submitRes.payload));
        }
        const isApproved = String(submitRes.data?.status || 'pending') === 'approved';
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
              : `${selectedProducts.length} ${selectedVersion} updates`)
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
    ? formatPhp(config.paymentConfig.account_price_php ?? null)
    : formatPhp(selectedProducts.reduce((total, product) => total + (Number(product.pricePhp) || 0), 0) || null);
  const hasPublishedProducts = selectedVersion === 'V1' || versionProducts.length > 0;
  const submitDisabled = submitting || (selectedVersion !== 'V1' && selectedProducts.length === 0);
  const versionDescriptionNeedsToggle = activeVersionDescription.desc.length > 280;
  const visibleVersionDescription = versionDescriptionNeedsToggle && !versionDescriptionExpanded
    ? `${activeVersionDescription.desc.slice(0, 280).trimEnd()}...`
    : activeVersionDescription.desc;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_30%),linear-gradient(180deg,_#fffdf7_0%,_#f7f7fb_100%)] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
          <Link to={landingPagePath} className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="VDJV logo" className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain p-1" />
            <span className="text-lg font-semibold tracking-[0.015em] text-slate-950">VDJV Sampler Pad App</span>
          </Link>
          <Button asChild className="border border-slate-300 bg-slate-900 text-white hover:bg-slate-800">
            <Link to={landingPagePath}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back Home
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-8 md:px-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] md:min-h-[340px]">
            <div className="mb-6">
              <VersionSelector value={selectedVersion} onChange={handleVersionChange} />
            </div>

            <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100">
                <img
                  src={activeBuySection.imageUrl || '/assets/logo.png'}
                  alt={`${selectedVersion} buy`}
                  className="h-full min-h-[220px] w-full object-cover"
                />
              </div>
              <div className="flex min-h-[300px] flex-col justify-center space-y-3">
                <h1 className="text-3xl font-black tracking-tight text-slate-950">{activeBuySection.title}</h1>
                <p className="text-sm leading-7 text-slate-600">{activeBuySection.description}</p>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold">{activeVersionDescription.title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{visibleVersionDescription}</p>
                  {versionDescriptionNeedsToggle ? (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 hover:text-amber-800"
                      onClick={() => setVersionDescriptionExpanded((current) => !current)}
                    >
                      {versionDescriptionExpanded ? 'Show less' : 'Read more'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {selectedVersion !== 'V1' && (
            <div className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <div className="mb-4 text-lg font-semibold">Choose What To Buy</div>
              {versionProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No {selectedVersion} offers are published yet. Message us on Facebook if you want to buy this version now.
                </div>
              ) : (
                <div className="grid gap-3">
                  {versionProducts.map((product) => {
                    const active = selectedSkus.includes(product.skuCode);
                    return (
                      <button
                        key={product.skuCode}
                        type="button"
                        onClick={() => handleProductToggle(product)}
                        className={`rounded-2xl border p-4 text-left transition ${
                          active
                            ? 'border-amber-400 bg-amber-50 shadow'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold">{product.displayName}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-slate-950">{formatPhp(product.pricePhp)}</div>
                            <div className="text-[11px] text-slate-500">{product.productType}</div>
                          </div>
                        </div>
                        {product.description ? <p className="mt-2 text-sm text-slate-600">{product.description}</p> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading buy page...
              </div>
            ) : result ? (
              <div className="space-y-4">
                <PaymentReceiptCard
                  theme="light"
                  title={result.status === 'approved' ? 'Approved' : 'Pending Approval'}
                  subtitle={result.message}
                  amountLabel="Purchase"
                  amountValue={result.version === 'V1' ? 'VDJV V1' : result.purchaseLabel}
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
                      setError('');
                    },
                  }}
                  secondaryAction={messengerUrl
                    ? { label: 'Message Us On Facebook', onClick: () => window.open(messengerUrl, '_blank', 'noopener,noreferrer') }
                    : undefined}
                />

                {result.version === 'V1' && result.status === 'approved' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold">You can log in now</div>
                    <div className="mb-4 text-sm text-slate-600">{result.email}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(['android', 'ios', 'windows', 'macos'] as PlatformKey[]).map((platform) => (
                        <Button
                          key={platform}
                          type="button"
                          variant="outline"
                          className="justify-between"
                          onClick={() => window.open(v1Links[platform], '_blank', 'noopener,noreferrer')}
                        >
                          <span>{platformButtonLabel[platform]}</span>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {result.version !== 'V1' && result.status === 'approved' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-sm font-semibold">License Ready</div>
                    {result.licenseCode ? <CopyableValue value={result.licenseCode} label="license code" wrap /> : null}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {(['android', 'ios', 'windows', 'macos'] as PlatformKey[])
                        .filter((platform) => Boolean(result.installerDownloadLinks?.[platform] || config.config.downloadLinks[result.version][platform]))
                        .map((platform) => {
                          const link = String(result.installerDownloadLinks?.[platform] || config.config.downloadLinks[result.version][platform] || '');
                          return (
                            <Button
                              key={`installer-${platform}`}
                              type="button"
                              variant="outline"
                              className="justify-between"
                              onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
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
                  <div className="text-lg font-semibold">Registration</div>
                  {selectedVersion !== 'V1' && selectedUpdatesOnly.length > 1 ? (
                    <div className="mt-2 text-sm text-slate-600">
                      Buying {selectedUpdatesOnly.length} updates in one transaction.
                    </div>
                  ) : null}
                  {selectedVersion !== 'V1' && selectedPrimaryProduct?.productType === 'standard' && selectedUpdatesOnly.length > 0 ? (
                    <div className="mt-2 text-sm text-slate-600">
                      Buying Standard with {selectedUpdatesOnly.length} selected update{selectedUpdatesOnly.length === 1 ? '' : 's'}.
                    </div>
                  ) : null}
                </div>

                {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                </div>

                {selectedVersion === 'V1' && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Password</Label>
                      <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
                    </div>
                    <div className="space-y-1">
                      <Label>Confirm Password</Label>
                      <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat password" />
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Payment</div>
                  <div className="mb-3 text-2xl font-black">{selectedPriceText}</div>
                  <p className="mb-4 text-sm text-slate-600">{config.paymentConfig.instructions || 'Follow the payment details below and submit your proof.'}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {config.paymentConfig.gcash_number ? (
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 flex flex-col gap-1 items-center justify-center text-center">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-500">GCash</div>
                        <div className="mt-2">
                          <CopyableValue
                            value={config.paymentConfig.gcash_number}
                            label="GCash number"
                            wrap
                            className="max-w-full justify-center"
                            valueClassName="font-mono text-lg font-medium break-all whitespace-normal text-center text-gray-900"
                            buttonClassName="text-blue-700 hover:bg-blue-100"
                          />
                        </div>
                      </div>
                    ) : null}
                    {config.paymentConfig.maya_number ? (
                      <div className="rounded-xl border border-green-100 bg-green-50 p-3 flex flex-col gap-1 items-center justify-center text-center">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-green-500">Maya</div>
                        <div className="mt-2">
                          <CopyableValue
                            value={config.paymentConfig.maya_number}
                            label="Maya number"
                            wrap
                            onCopied={() => openWalletAppAfterCopy('maya')}
                            className="max-w-full justify-center"
                            valueClassName="font-mono text-lg font-medium break-all whitespace-normal text-center text-gray-900"
                            buttonClassName="text-green-700 hover:bg-green-100"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {config.paymentConfig.qr_image_path ? (
                    <div className="mt-4 flex flex-col items-center justify-center pt-4 border-t border-gray-100">
                      <span className="text-sm font-medium tracking-wide text-slate-600">Scan to Pay</span>
                      <button
                        type="button"
                        onClick={() => setExpandedQrUrl(config.paymentConfig.qr_image_path || null)}
                        className="mt-3 flex max-w-[min(70vw,220px)] max-h-[260px] items-center justify-center rounded-xl border bg-white p-2 hover:opacity-90 transition-opacity"
                      >
                        <img
                          src={config.paymentConfig.qr_image_path}
                          alt="Payment QR"
                          className="block max-w-[min(64vw,200px)] max-h-[240px] h-auto w-auto rounded-lg object-contain"
                        />
                      </button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 h-8 border-slate-900 bg-slate-900 px-3 text-xs text-white hover:bg-slate-800 hover:text-white"
                        onClick={() => void downloadQrImage(config.paymentConfig.qr_image_path!)}
                      >
                        <Download className="w-3.5 h-3.5 mr-1" />
                        Download QR
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <Label>Payment Method</Label>
                  <select className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" value={paymentChannel} onChange={(event) => setPaymentChannel(event.target.value as PaymentChannel)}>
                    {PAYMENT_CHANNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>

                {(paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Account Name Used For Payment</Label>
                      <Input value={payerName} onChange={(event) => setPayerName(event.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Reference / Transaction No.</Label>
                      <Input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <Label>Upload Receipt / Proof</Label>
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                    onChange={(event) => setProofFile(event.target.files?.[0] || null)}
                    className="file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800 text-slate-700"
                  />
                  {proofFile ? <div className="text-xs text-slate-500">{proofFile.name}</div> : null}
                </div>

                <div className="space-y-1">
                  <Label>Optional Notes</Label>
                  <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional extra info" />
                </div>

                {!hasPublishedProducts ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Publish at least one {selectedVersion} SKU in Admin Access before buyers can submit this checkout.
                  </div>
                ) : null}

                <Button type="submit" className="w-full" disabled={submitDisabled}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Submit Purchase
                </Button>

                {messengerUrl ? (
                  <div className="text-center text-xs text-slate-500">
                    If email is not accessible, keep your receipt reference and message us on{' '}
                    <a className="font-semibold text-amber-700 underline underline-offset-4" href={messengerUrl} target="_blank" rel="noreferrer">
                      Facebook Messenger
                    </a>.
                  </div>
                ) : null}
              </form>
            )}
          </div>
        </div>
      </section>
      {expandedQrUrl && (
        <div className="fixed inset-0 z-[220] bg-black/75 flex items-center justify-center p-4" onClick={() => setExpandedQrUrl(null)}>
          <div className="relative flex max-w-[95vw] max-h-[90vh] flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex max-w-[min(92vw,40rem)] max-h-[82vh] items-center justify-center rounded-xl border bg-white p-3 shadow-2xl">
              <img
                src={expandedQrUrl}
                alt="Expanded payment QR"
                className="block max-w-[min(88vw,36rem)] max-h-[76vh] h-auto w-auto object-contain"
              />
            </div>
            <div className="mt-2 flex justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-slate-900 bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
                onClick={() => void downloadQrImage(expandedQrUrl)}
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Download QR
              </Button>
              <Button type="button" size="sm" onClick={() => setExpandedQrUrl(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
