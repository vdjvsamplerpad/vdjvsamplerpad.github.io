import * as React from 'react';
import { RefreshCw, Save, Search, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type AdminPageScaffoldProps = {
  panelClass: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: React.ReactNode;
  controls?: React.ReactNode;
  stickySave?: AdminStickySaveBarProps;
  embedded?: boolean;
  children: React.ReactNode;
};

type AdminStatsStripItem = {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  toneClass?: string;
};

type AdminControlsBarProps = {
  left?: React.ReactNode;
  right?: React.ReactNode;
};

type AdminActionClusterProps = {
  children: React.ReactNode;
  className?: string;
};

type AdminRefreshButtonProps = {
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  className?: string;
  onClick: () => void;
};

type AdminSectionTabsProps<T extends string> = {
  sections: Array<{ key: T; label: string }>;
  active: T;
  onChange: (next: T) => void;
  label?: string;
  className?: string;
};

type AdminStickySaveBarProps = {
  dirty: boolean;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
  savingLabel?: string;
  message?: React.ReactNode;
  onSave: () => void;
};

type AdminToolbarProps = {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    onSubmit?: () => void;
  };
  primaryFilters?: React.ReactNode;
  moreFilters?: React.ReactNode;
  resultLabel?: React.ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  className?: string;
};

type AdminReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export function AdminPageScaffold({
  panelClass,
  title,
  description,
  actions,
  stats,
  controls,
  stickySave,
  embedded = false,
  children,
}: AdminPageScaffoldProps) {
  const actionAnchorRef = React.useRef<HTMLDivElement | null>(null);
  if (embedded) {
    return (
      <div className="space-y-5">
        {stats}
        {controls}
        {children}
      </div>
    );
  }
  return (
    <div className={`relative isolate !h-auto !max-h-none flex-none overflow-hidden rounded-[26px] border ${panelClass}`}>
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-[26px] bg-[linear-gradient(180deg,rgba(255,255,255,0.48),rgba(255,255,255,0)_180px)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0)_190px)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[26px]">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-fuchsia-500/8 blur-3xl dark:bg-fuchsia-500/10" />
        <div className="absolute -bottom-14 -left-12 h-44 w-44 rounded-full bg-blue-500/8 blur-3xl dark:bg-blue-500/10" />
      </div>
      <div className="relative space-y-5 p-4 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1.5 min-w-0">
            <div className="text-lg font-black tracking-tight md:text-[1.35rem]">{title}</div>
            {description ? <div className="max-w-3xl text-sm leading-relaxed opacity-75">{description}</div> : null}
          </div>
          {actions ? <div ref={actionAnchorRef}><AdminActionCluster>{actions}</AdminActionCluster></div> : null}
        </div>
        {stats}
        {controls}
        {children}
      </div>
      {stickySave ? <AdminStickySaveBar {...stickySave} anchorRef={actionAnchorRef} /> : null}
    </div>
  );
}

export function AdminTierConfigLoadingSkeleton({ theme = 'dark' }: { theme?: 'light' | 'dark' }) {
  const shellClass = theme === 'dark'
    ? 'border-white/10 bg-[#0b0e12]'
    : 'border-slate-950/10 bg-white/70';
  const cardClass = theme === 'dark' ? 'bg-white/[0.045]' : 'bg-slate-950/[0.045]';
  const blockClass = theme === 'dark' ? 'bg-white/[0.095]' : 'bg-slate-950/[0.10]';
  const faintClass = theme === 'dark' ? 'bg-white/[0.06]' : 'bg-slate-950/[0.065]';

  return (
    <div className={`rounded-2xl border p-4 ${shellClass}`}>
      <div className="grid gap-3 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className={`min-h-[520px] animate-pulse rounded-2xl p-4 ${cardClass}`}>
            <div className="flex items-center justify-between gap-2">
              <div className={`h-7 w-28 rounded ${blockClass}`} />
              <div className={`h-6 w-16 rounded-full ${faintClass}`} />
            </div>
            <div className={`mt-3 h-4 w-44 max-w-[80%] rounded ${faintClass}`} />
            <div className="mt-5 space-y-3">
              <div className={`h-9 rounded-lg ${blockClass}`} />
              <div className={`h-9 rounded-lg ${faintClass}`} />
              <div className={`h-12 rounded-lg ${blockClass}`} />
              <div className={`h-16 rounded-lg ${faintClass}`} />
            </div>
            <div className="mt-5 space-y-2">
              {[72, 58, 84, 66, 78].map((width, rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-2">
                  <div className={`h-4 w-4 rounded ${faintClass}`} />
                  <div className={`h-4 rounded ${faintClass}`} style={{ width: `${width}%` }} />
                </div>
              ))}
            </div>
            <div className={`mt-6 h-5 w-36 rounded ${blockClass}`} />
            <div className="mt-3 space-y-2">
              {[62, 74, 55].map((width, rowIndex) => (
                <div key={rowIndex} className="flex items-center justify-between gap-2">
                  <div className={`h-4 rounded ${faintClass}`} style={{ width: `${width}%` }} />
                  <div className={`h-5 w-20 rounded-full ${faintClass}`} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminStatsStrip({ items }: { items: AdminStatsStripItem[] }) {
  if (items.length === 0) return null;
  const visibleItems = items.slice(0, 4);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {visibleItems.map((item) => (
        <div
          key={item.label}
          className="relative overflow-hidden rounded-[18px] border px-3.5 py-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.42))] shadow-[0_18px_42px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.92)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] dark:shadow-[0_18px_42px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.06)]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18),transparent_42%,transparent_70%,rgba(255,255,255,0.08))] dark:bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_42%,transparent_70%,rgba(255,255,255,0.03))]" />
          <div className="relative">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-65">{item.label}</div>
            <div className={`mt-1.5 text-xl font-black tracking-tight ${item.toneClass || ''}`}>{item.value}</div>
            {item.detail ? <div className="mt-1 text-[11px] leading-relaxed opacity-65">{item.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminActionCluster({ children, className }: AdminActionClusterProps) {
  return (
    <div className={`inline-flex flex-wrap items-center justify-end gap-2 rounded-[18px] border border-white/12 bg-white/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${className || ''}`}>
      {children}
    </div>
  );
}

export function AdminRefreshButton({
  loading = false,
  disabled = false,
  label = 'Refresh',
  size = 'sm',
  className,
  onClick,
}: AdminRefreshButtonProps) {
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      onClick={onClick}
      disabled={disabled || loading}
      className={`rounded-[14px] px-3 ${className || ''}`}
    >
      <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      {label}
    </Button>
  );
}

export function AdminControlsBar({ left, right }: AdminControlsBarProps) {
  if (!left && !right) return null;
  return (
    <div className="rounded-[20px] border px-3 py-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.66),rgba(255,255,255,0.42))] shadow-[0_18px_40px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.88)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] dark:shadow-[0_18px_40px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        {left ? <div className="flex-1 min-w-0">{left}</div> : <div />}
        {right ? <div className="xl:max-w-[320px] w-full xl:w-auto">{right}</div> : null}
      </div>
    </div>
  );
}

export function AdminSectionTabs<T extends string>({
  sections,
  active,
  onChange,
  label,
  className,
}: AdminSectionTabsProps<T>) {
  const activeIndex = Math.max(0, sections.findIndex((section) => section.key === active));
  const sliderStyle = {
    ['--admin-tab-count' as string]: sections.length,
    ['--admin-tab-index' as string]: activeIndex,
  } as React.CSSProperties;

  return (
    <div className={className}>
      {label ? <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div> : null}
      <div
        role="tablist"
        className="relative grid min-h-10 overflow-hidden rounded-full border border-white/20 bg-white/65 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:bg-white/[0.055] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        style={{
          ...sliderStyle,
          gridTemplateColumns: `repeat(${Math.max(1, sections.length)}, minmax(0, 1fr))`,
        }}
      >
        <span
          aria-hidden="true"
          className="absolute bottom-1 top-1 rounded-full bg-[#B9FF12] shadow-[0_10px_24px_rgba(185,255,18,0.28)] transition-transform duration-300 ease-out"
          style={{
            left: '0.25rem',
            width: `calc((100% - 0.5rem) / ${Math.max(1, sections.length)})`,
            transform: `translateX(calc(${activeIndex} * 100%))`,
          }}
        />
        {sections.map((section) => {
          const selected = active === section.key;
          return (
            <button
              key={section.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`relative z-10 min-h-8 rounded-full px-3 text-xs font-bold transition-colors ${selected ? 'text-slate-950' : 'text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white'}`}
              onClick={() => onChange(section.key)}
            >
              <span className="block truncate">{section.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminToolbar({
  search,
  primaryFilters,
  moreFilters,
  resultLabel,
  activeFilterCount = 0,
  onClearFilters,
  className,
}: AdminToolbarProps) {
  return (
    <AdminControlsBar
      left={(
        <div className={`flex flex-col gap-3 xl:flex-row xl:items-center ${className || ''}`}>
          {search ? (
            <div className="relative min-w-0 flex-1 xl:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
              <Input
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') search.onSubmit?.();
                }}
                placeholder={search.placeholder || 'Search...'}
                className="h-9 w-full pl-9 text-sm"
              />
            </div>
          ) : null}
          {primaryFilters ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{primaryFilters}</div> : null}
        </div>
      )}
      right={(
        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          {resultLabel ? <span className="rounded-full border px-2.5 py-1 text-xs opacity-75">{resultLabel}</span> : null}
          {moreFilters ? (
            <details className="group relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-[14px] border bg-white/60 px-3 text-xs font-semibold shadow-sm transition hover:bg-white dark:bg-white/[0.04] dark:hover:bg-white/[0.08]">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                More Filters
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-[#B9FF12] px-1.5 py-0.5 text-[10px] font-black text-slate-950">{activeFilterCount}</span>
                ) : null}
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-[min(88vw,420px)] rounded-2xl border bg-white p-3 shadow-2xl dark:bg-gray-950">
                {moreFilters}
              </div>
            </details>
          ) : null}
          {onClearFilters && activeFilterCount > 0 ? (
            <Button type="button" size="sm" variant="outline" className="rounded-[14px]" onClick={onClearFilters}>
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null}
        </div>
      )}
    />
  );
}

function AdminStickySaveBar({
  dirty,
  saving = false,
  disabled = false,
  label = 'Save Changes',
  savingLabel = 'Saving...',
  message,
  onSave,
  anchorRef,
}: AdminStickySaveBarProps & { anchorRef: React.RefObject<HTMLDivElement | null> }) {
  const [anchorVisible, setAnchorVisible] = React.useState(true);

  React.useEffect(() => {
    const node = anchorRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setAnchorVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setAnchorVisible(entry?.isIntersecting ?? false),
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchorRef]);

  if (!dirty || anchorVisible) return null;

  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[210] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-[#B9FF12]/45 bg-slate-950/90 p-2 text-white shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-2 text-xs text-white/74">{message || 'Unsaved changes are local until saved.'}</div>
        <Button
          type="button"
          variant="success"
          className="rounded-[14px] sm:min-w-40"
          disabled={disabled || saving}
          onClick={onSave}
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? savingLabel : label}
        </Button>
      </div>
    </div>
  );
}

export function AdminReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  summary,
  children,
  footer,
  className,
}: AdminReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className || 'sm:max-w-4xl'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4">
          {summary ? <div className="rounded-[18px] border p-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(255,255,255,0.44))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))]">{summary}</div> : null}
          <div className="max-h-[70vh] overflow-y-auto pr-1">{children}</div>
        </div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

export function AdminNavIcon({
  icon: Icon,
  active,
}: {
  icon: LucideIcon;
  active?: boolean;
}) {
  return <Icon className={`h-4 w-4 shrink-0 ${active ? '' : 'opacity-80'}`} />;
}
