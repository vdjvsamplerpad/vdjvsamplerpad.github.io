import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import type { SortDirection } from '@/lib/admin-api';
import { ChevronLeft, ChevronRight, EyeOff, Globe, ImageIcon, Loader2, Save, Upload } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { prepareManagedImageUpload } from '@/lib/image-upload';
import { uploadManagedStoreAsset } from '@/lib/store-asset-upload';
import type {
  AdminDialogTheme,
  CatalogDraft,
  HomeTrendRows,
} from './AdminAccessDialog.shared';

const PROOF_SIGNED_URL_TTL_SECONDS = 20 * 60;
const PROOF_SIGNED_URL_CACHE_TTL_MS = (PROOF_SIGNED_URL_TTL_SECONDS - 60) * 1000;
const proofSignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string };
export type PushNoticeInput = Omit<Notice, 'id'>;

export function useNotices() {
  const [notices, setNotices] = React.useState<Notice[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setNotices((arr) => arr.filter((notice) => notice.id !== id));
  }, []);

  const pushNotice = React.useCallback((notice: PushNoticeInput) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now() + Math.random());
    setNotices((arr) => [{ id, ...notice }, ...arr]);
    window.setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  return { notices, pushNotice, dismiss };
}

export function NoticesPortal({
  notices,
  dismiss,
  theme,
}: {
  notices: Notice[];
  dismiss: (id: string) => void;
  theme: AdminDialogTheme;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed top-0 left-0 right-0 z-[2147483647] flex justify-center pointer-events-none">
      <div className="w-full max-w-xl px-3">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`pointer-events-auto mt-3 rounded-lg border px-4 py-2 shadow-lg ${notice.variant === 'success'
              ? (theme === 'dark' ? 'bg-green-600/90 border-green-500 text-white' : 'bg-green-600 border-green-700 text-white')
              : notice.variant === 'error'
                ? (theme === 'dark' ? 'bg-red-600/90 border-red-500 text-white' : 'bg-red-600 border-red-700 text-white')
                : (theme === 'dark' ? 'bg-gray-800/90 border-gray-700 text-white' : 'bg-gray-900 border-gray-800 text-white')
              }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 text-sm">{notice.message}</div>
              <button className="text-white/80 hover:text-white" onClick={() => dismiss(notice.id)} aria-label="Dismiss">x</button>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export const SortHeader = ({
  title,
  active,
  direction,
  onClick,
}: {
  title: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 font-medium">
    {title}
    <span className="text-xs opacity-70">{active ? (direction === 'asc' ? '^' : 'v') : '*'}</span>
  </button>
);

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="h-7 px-2">
        <ChevronLeft className="w-3 h-3" />
      </Button>
      <span className="text-xs opacity-70">Page {page} of {totalPages}</span>
      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="h-7 px-2">
        <ChevronRight className="w-3 h-3" />
      </Button>
    </div>
  );
}

export function MiniLineAreaChart({
  points,
  seriesA,
  seriesB,
  seriesALabel,
  seriesBLabel,
  theme,
}: {
  points: string[];
  seriesA: number[];
  seriesB: number[];
  seriesALabel: string;
  seriesBLabel: string;
  theme: AdminDialogTheme;
}) {
  const width = 640;
  const height = 220;
  const padX = 28;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const safeCount = Math.max(1, points.length - 1);
  const allValues = [...seriesA, ...seriesB];
  const maxValue = Math.max(1, ...allValues);

  const toXY = (value: number, index: number) => {
    const x = padX + (index / safeCount) * plotW;
    const y = padY + plotH - (value / maxValue) * plotH;
    return { x, y };
  };

  const toLinePath = (values: number[]) => values
    .map((value, index) => {
      const { x, y } = toXY(value, index);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const toAreaPath = (values: number[]) => {
    const line = toLinePath(values);
    const end = toXY(values[values.length - 1] || 0, values.length - 1 || 0);
    const start = toXY(values[0] || 0, 0);
    return `${line} L ${end.x} ${padY + plotH} L ${start.x} ${padY + plotH} Z`;
  };

  const gridColor = theme === 'dark' ? 'rgba(148,163,184,0.25)' : 'rgba(100,116,139,0.2)';
  const axisText = theme === 'dark' ? '#cbd5e1' : '#475569';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44">
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = padY + (tick / 4) * plotH;
        return <line key={`g-${tick}`} x1={padX} y1={y} x2={padX + plotW} y2={y} stroke={gridColor} strokeWidth="1" />;
      })}
      <path d={toAreaPath(seriesA)} fill="rgba(16,185,129,0.18)" />
      <path d={toAreaPath(seriesB)} fill="rgba(239,68,68,0.14)" />
      <path d={toLinePath(seriesA)} fill="none" stroke="#10b981" strokeWidth="2.2" />
      <path d={toLinePath(seriesB)} fill="none" stroke="#ef4444" strokeWidth="2.2" />
      {points.map((label, index) => {
        const { x } = toXY(0, index);
        return (
          <text key={`x-${label}-${index}`} x={x} y={height - 2} textAnchor="middle" fontSize="10" fill={axisText}>
            {label}
          </text>
        );
      })}
      <text x={padX} y={12} fontSize="10" fill="#10b981">{seriesALabel}</text>
      <text x={padX + 90} y={12} fontSize="10" fill="#ef4444">{seriesBLabel}</text>
    </svg>
  );
}

export function MiniStackedBarChart({
  points,
  success,
  failed,
  successLabel,
  failedLabel,
  theme,
}: {
  points: string[];
  success: number[];
  failed: number[];
  successLabel: string;
  failedLabel: string;
  theme: AdminDialogTheme;
}) {
  const width = 640;
  const height = 220;
  const padX = 28;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const axisText = theme === 'dark' ? '#cbd5e1' : '#475569';
  const gridColor = theme === 'dark' ? 'rgba(148,163,184,0.25)' : 'rgba(100,116,139,0.2)';
  const groupWidth = plotW / Math.max(1, points.length);
  const barWidth = Math.max(6, groupWidth * 0.45);
  const totals = points.map((_, index) => Number(success[index] || 0) + Number(failed[index] || 0));
  const maxValue = Math.max(1, ...totals);
  const toY = (value: number) => padY + plotH - (value / maxValue) * plotH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44">
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = padY + (tick / 4) * plotH;
        return <line key={`s-g-${tick}`} x1={padX} y1={y} x2={padX + plotW} y2={y} stroke={gridColor} strokeWidth="1" />;
      })}
      {points.map((label, index) => {
        const okValue = Number(success[index] || 0);
        const failValue = Number(failed[index] || 0);
        const totalValue = okValue + failValue;
        const x = padX + index * groupWidth + (groupWidth - barWidth) / 2;
        const totalY = toY(totalValue);
        const successY = toY(okValue);
        const successHeight = padY + plotH - successY;
        const failedHeight = Math.max(0, successY - totalY);
        return (
          <g key={`stack-${label}-${index}`}>
            <rect x={x} y={successY} width={barWidth} height={successHeight} fill="#10b981" rx="2" />
            <rect x={x} y={totalY} width={barWidth} height={failedHeight} fill="#ef4444" rx="2" />
            <text x={x + barWidth / 2} y={height - 2} textAnchor="middle" fontSize="10" fill={axisText}>
              {label}
            </text>
          </g>
        );
      })}
      <text x={padX} y={12} fontSize="10" fill="#10b981">{successLabel}</text>
      <text x={padX + 96} y={12} fontSize="10" fill="#ef4444">{failedLabel}</text>
    </svg>
  );
}

export function MiniGroupedBarChart({
  points,
  authSuccess,
  authFailed,
  imports,
  seriesALabel = 'Auth OK',
  seriesBLabel = 'Auth Failed',
  seriesCLabel = 'Import',
  theme,
}: {
  points: string[];
  authSuccess: number[];
  authFailed: number[];
  imports: number[];
  seriesALabel?: string;
  seriesBLabel?: string;
  seriesCLabel?: string;
  theme: AdminDialogTheme;
}) {
  const chartRows = React.useMemo(
    () =>
      points.map((label, index) => ({
        label,
        a: Number(authSuccess[index] || 0),
        b: Number(authFailed[index] || 0),
        c: Number(imports[index] || 0),
      })),
    [points, authSuccess, authFailed, imports],
  );
  const tooltipStyle = theme === 'dark'
    ? { backgroundColor: '#111827', borderColor: '#374151', color: '#f9fafb' }
    : { backgroundColor: '#ffffff', borderColor: '#d1d5db', color: '#111827' };

  if (chartRows.length === 0) {
    return <div className="h-64 rounded border border-dashed flex items-center justify-center text-xs opacity-70">No trend data in this range.</div>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartRows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#334155' : '#cbd5e1'} />
          <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={22} />
          <YAxis allowDecimals={false} />
          <RechartsTooltip contentStyle={tooltipStyle} />
          <Legend />
          <Bar dataKey="a" name={seriesALabel} fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={16} />
          <Bar dataKey="b" name={seriesBLabel} fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={16} />
          <Bar dataKey="c" name={seriesCLabel} fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={16} />
          <Brush dataKey="label" height={20} travellerWidth={8} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RevenueAdvancedChart({
  rows,
  theme,
  formatMoney,
}: {
  rows: HomeTrendRows;
  theme: AdminDialogTheme;
  formatMoney: (value: number) => string;
}) {
  const chartRows = React.useMemo(
    () =>
      rows.map((row) => {
        const dateValue = String(row.date || '');
        const [year, month, day] = dateValue.split('-');
        const label = year && month && day ? `${month}/${day}` : dateValue;
        return {
          dateValue,
          label,
          total: Number(row.totalRevenueApproved || 0),
          store: Number(row.storeRevenueApproved || 0),
          account: Number(row.accountRevenueApproved || 0),
        };
      }),
    [rows],
  );

  if (chartRows.length === 0) {
    return <div className="h-64 rounded border border-dashed flex items-center justify-center text-xs opacity-70">No revenue data in this range.</div>;
  }

  const visibleTotal = chartRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const rangeStart = chartRows[0]?.dateValue || '-';
  const rangeEnd = chartRows[chartRows.length - 1]?.dateValue || '-';
  const tooltipStyle = theme === 'dark'
    ? { backgroundColor: '#111827', borderColor: '#374151', color: '#f9fafb' }
    : { backgroundColor: '#ffffff', borderColor: '#d1d5db', color: '#111827' };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="text-xs rounded border px-2 py-2 flex flex-col justify-center">
          <span className="opacity-70">Range</span>
          <span className="font-medium">{rangeStart} to {rangeEnd}</span>
        </div>
        <div className="text-xs rounded border px-2 py-2 flex flex-col justify-center">
          <span className="opacity-70">Visible Revenue</span>
          <span className="font-semibold">{formatMoney(visibleTotal)}</span>
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartRows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#334155' : '#cbd5e1'} />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={20} />
            <YAxis tickFormatter={(value) => {
              const numeric = Number(value || 0);
              if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
              if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
              return `${numeric}`;
            }} />
            <RechartsTooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: any) => [formatMoney(Number(value || 0)), String(name)]}
              labelFormatter={(label: any) => `Date: ${String(label || '-')}`}
            />
            <Legend />
            <Area type="monotone" dataKey="total" name="Total Revenue" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2.2} />
            <Area type="monotone" dataKey="store" name="Store Revenue" stroke="#22c55e" fill="#22c55e" fillOpacity={0.12} strokeWidth={1.8} />
            <Area type="monotone" dataKey="account" name="Account Revenue" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.12} strokeWidth={1.8} />
            <Brush dataKey="label" height={22} travellerWidth={8} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ExportHealthPieChart({
  successTotal,
  failedTotal,
  theme,
}: {
  successTotal: number;
  failedTotal: number;
  theme: AdminDialogTheme;
}) {
  const data = [
    { name: 'Export Success', value: Number(successTotal || 0), color: '#10b981' },
    { name: 'Export Failed', value: Number(failedTotal || 0), color: '#ef4444' },
  ].filter((row) => row.value > 0);
  if (data.length === 0) {
    return <div className="h-64 rounded border border-dashed flex items-center justify-center text-xs opacity-70">No export activity in selected range.</div>;
  }
  const tooltipStyle = theme === 'dark'
    ? { backgroundColor: '#111827', borderColor: '#374151', color: '#f9fafb' }
    : { backgroundColor: '#ffffff', borderColor: '#d1d5db', color: '#111827' };
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={86}
            paddingAngle={2}
            label={false}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Legend />
          <RechartsTooltip contentStyle={tooltipStyle} formatter={(value: any) => [Number(value || 0), 'Count']} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProofImagePreview({ path }: { path: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [shouldLoad, setShouldLoad] = React.useState(false);
  const previewRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    const node = previewRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: '160px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!shouldLoad && !expanded) return;
    const cached = proofSignedUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      setUrl(cached.url);
      setError(false);
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data, error: signedUrlError } = await supabase.storage.from('payment-proof').createSignedUrl(path, PROOF_SIGNED_URL_TTL_SECONDS);
        if (signedUrlError) throw signedUrlError;
        if (mounted && data?.signedUrl) {
          proofSignedUrlCache.set(path, {
            url: data.signedUrl,
            expiresAt: Date.now() + PROOF_SIGNED_URL_CACHE_TTL_MS,
          });
          setUrl(data.signedUrl);
        }
      } catch {
        if (mounted) setError(true);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [expanded, path, shouldLoad]);

  if (error) return <span className="text-xs text-red-400">Failed to load</span>;
  if (!url) {
    return (
      <button
        ref={previewRef}
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 inline-flex h-12 w-12 items-center justify-center rounded border border-dashed text-[10px] opacity-80 hover:opacity-100"
      >
        <Loader2 className="w-4 h-4 animate-spin inline" />
      </button>
    );
  }

  return (
    <>
      <button
        ref={previewRef}
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 block rounded border overflow-hidden hover:opacity-80 transition-opacity"
      >
        <img
          src={url}
          alt="Proof"
          loading="lazy"
          decoding="async"
          className="w-12 h-12 object-cover"
        />
      </button>
      {expanded && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70" onClick={() => setExpanded(false)}>
          <img src={url} alt="Proof" decoding="async" className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  );
}

export function CatalogCard({
  draft,
  isDark,
  onUpdate,
  onPublish,
  pushNotice,
  onReload,
}: {
  draft: CatalogDraft;
  isDark: boolean;
  onUpdate: (id: string, updates: Record<string, any>) => void;
  onPublish: (draft: CatalogDraft) => void;
  pushNotice: (notice: { variant: 'success' | 'error'; message: string }) => void;
  onReload: () => void;
}) {
  const [isPaid, setIsPaid] = React.useState(draft.is_paid);
  const [isPinned, setIsPinned] = React.useState(Boolean(draft.is_pinned));
  const [pricePhp, setPricePhp] = React.useState(draft.price_php === null ? '' : draft.price_php.toString());
  const [thumbFile, setThumbFile] = React.useState<File | null>(null);
  const [thumbUploading, setThumbUploading] = React.useState(false);
  const [thumbPreviewUrl, setThumbPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    setIsPaid(draft.is_paid);
    setIsPinned(Boolean(draft.is_pinned));
    setPricePhp(draft.price_php === null ? '' : draft.price_php.toString());
  }, [draft]);

  React.useEffect(() => {
    if (!thumbFile) {
      setThumbPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(thumbFile);
    setThumbPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [thumbFile]);

  const hasChanges =
    isPaid !== draft.is_paid
    || isPinned !== Boolean(draft.is_pinned)
    || (pricePhp === '' ? null : Number(pricePhp)) !== draft.price_php;

  const handleSave = () => {
    onUpdate(draft.id, {
      is_paid: isPaid,
      is_pinned: isPinned,
      price_php: isPaid ? (pricePhp === '' ? null : Number(pricePhp)) : null,
      requires_grant: isPaid,
    });
  };

  const handleUnpublish = () => {
    onUpdate(draft.id, { status: 'draft' });
  };

  const handleThumbUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setThumbFile(file);
    setThumbUploading(true);
    let cleanupUploaded: (() => Promise<void>) | null = null;
    try {
      const preparedFile = await prepareManagedImageUpload(file, 'thumbnail');
      const uploaded = await uploadManagedStoreAsset(preparedFile, {
        kind: 'thumbnail',
        bankId: draft.bank_id,
      });
      cleanupUploaded = uploaded.cleanup;
      const { supabase } = await import('@/lib/supabase');
      await supabase.from('bank_catalog_items').update({ thumbnail_path: uploaded.url }).eq('id', draft.id);
      cleanupUploaded = null;
      pushNotice({ variant: 'success', message: 'Thumbnail updated!' });
      onReload();
    } catch (error: any) {
      if (cleanupUploaded) {
        try {
          await cleanupUploaded();
        } catch {}
      }
      pushNotice({ variant: 'error', message: `Thumbnail upload failed: ${error.message}` });
    } finally {
      setThumbUploading(false);
      setThumbFile(null);
      event.target.value = '';
    }
  };

  const isPublished = draft.status === 'published';
  const currentThumb = thumbPreviewUrl || draft.thumbnail_path;
  const savedPriceLabel = draft.is_paid
    ? (draft.price_php !== null ? `PHP ${draft.price_php.toLocaleString()}` : 'Price not set')
    : 'Free';

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${isDark ? 'bg-gray-800/60 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-200 shadow-sm hover:shadow-md'}`}>
      <div className={`h-1 w-full ${isPublished ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`} />
      <div className="flex gap-3 p-3.5">
        <label className="shrink-0 cursor-pointer group relative">
          {currentThumb ? <img src={currentThumb} alt="" className="w-16 h-16 rounded-lg object-cover border" /> : <div className={`w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center ${isDark ? 'border-gray-600 text-gray-600' : 'border-gray-300 text-gray-400'}`}><ImageIcon className="w-5 h-5" /></div>}
          <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">{thumbUploading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Upload className="w-4 h-4 text-white" />}</div>
          <input type="file" accept="image/*" className="hidden" onChange={handleThumbUpload} disabled={thumbUploading} />
        </label>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className={`font-semibold text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`} title={draft.bank?.title}>{draft.bank?.title || 'Unknown Bank'}</h4>
            {draft.is_pinned && <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">Pinned</span>}
            <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${isPublished ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'}`}>{isPublished ? 'Live' : 'Draft'}</span>
          </div>
          <div className={`text-[11px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{savedPriceLabel}</div>
          <div className={`text-[10px] mt-1 font-mono truncate ${isDark ? 'text-gray-500' : 'text-gray-500'}`} title={draft.expected_asset_name}>{draft.expected_asset_name}</div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" checked={isPaid} onChange={(event) => setIsPaid(event.target.checked)} className="w-3.5 h-3.5 rounded accent-indigo-600" /><span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Paid</span></label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} className="w-3.5 h-3.5 rounded accent-indigo-600" /><span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Pinned</span></label>
            {isPaid && <div className="flex items-center gap-1"><span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>PHP</span><input type="number" value={pricePhp} onChange={(event) => setPricePhp(event.target.value)} className={`w-20 rounded border px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500/50 ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`} placeholder="0.00" /></div>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {!isPublished && <Button size="sm" onClick={() => onPublish(draft)} className="h-6 px-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px]"><Globe className="w-3 h-3 mr-1" /> Publish</Button>}
            {isPublished && <Button size="sm" variant="outline" onClick={handleUnpublish} className={`h-6 px-2 text-[11px] ${isDark ? 'border-gray-600 hover:bg-gray-700' : ''}`}><EyeOff className="w-3 h-3 mr-1" /> Unpublish</Button>}
            {hasChanges && <Button size="sm" onClick={handleSave} className="h-6 px-2 bg-blue-600 hover:bg-blue-500 text-white text-[11px]"><Save className="w-3 h-3 mr-1" /> Save</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
