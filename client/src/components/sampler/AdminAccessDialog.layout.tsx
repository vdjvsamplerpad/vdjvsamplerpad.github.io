import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type AdminPageScaffoldProps = {
  panelClass: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: React.ReactNode;
  controls?: React.ReactNode;
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

type AdminSectionTabsProps<T extends string> = {
  sections: Array<{ key: T; label: string }>;
  active: T;
  onChange: (next: T) => void;
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
  children,
}: AdminPageScaffoldProps) {
  return (
    <div className={`relative rounded-[26px] border ${panelClass}`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.5),transparent_22%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_18%)]" />
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-500/12" />
        <div className="absolute bottom-0 left-0 h-36 w-36 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/12" />
      </div>
      <div className="relative space-y-5 p-4 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1.5 min-w-0">
            <div className="text-lg font-black tracking-tight md:text-[1.35rem]">{title}</div>
            {description ? <div className="max-w-3xl text-sm leading-relaxed opacity-75">{description}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2 rounded-full border border-white/10 bg-white/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">{actions}</div> : null}
        </div>
        {stats}
        {controls}
        {children}
      </div>
    </div>
  );
}

export function AdminStatsStrip({ items }: { items: AdminStatsStripItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
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
}: AdminSectionTabsProps<T>) {
  return (
    <div className="inline-flex flex-wrap gap-2 rounded-full border border-white/15 bg-white/45 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {sections.map((section) => (
        <Button
          key={section.key}
          type="button"
          size="sm"
          variant={active === section.key ? 'default' : 'outline'}
          className={active === section.key ? 'shadow-sm' : 'border-transparent bg-transparent'}
          onClick={() => onChange(section.key)}
        >
          {section.label}
        </Button>
      ))}
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
