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
    <div className={`rounded-2xl border p-4 md:p-5 space-y-5 ${panelClass}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1 min-w-0">
          <div className="text-base font-semibold">{title}</div>
          {description ? <div className="text-sm opacity-75 max-w-3xl">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {stats}
      {controls}
      {children}
    </div>
  );
}

export function AdminStatsStrip({ items }: { items: AdminStatsStripItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border px-3 py-2.5 bg-black/[0.02] dark:bg-white/[0.03]">
          <div className="text-[11px] uppercase tracking-wide opacity-70">{item.label}</div>
          <div className={`mt-1 text-lg font-semibold ${item.toneClass || ''}`}>{item.value}</div>
          {item.detail ? <div className="mt-1 text-[11px] opacity-65">{item.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function AdminControlsBar({ left, right }: AdminControlsBarProps) {
  if (!left && !right) return null;
  return (
    <div className="rounded-2xl border px-3 py-3 bg-black/[0.02] dark:bg-white/[0.02]">
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
    <div className="flex flex-wrap gap-2">
      {sections.map((section) => (
        <Button
          key={section.key}
          type="button"
          size="sm"
          variant={active === section.key ? 'default' : 'outline'}
          className={active === section.key ? 'shadow-sm' : ''}
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
          {summary ? <div className="rounded-xl border p-3 bg-black/[0.02] dark:bg-white/[0.03]">{summary}</div> : null}
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
