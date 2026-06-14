import * as React from 'react';
import { LoadingSpinner } from '@/components/ui/loading';
import { cn } from '@/lib/utils';

interface ModalBusyOverlayProps {
  show: boolean;
  title: string;
  description?: string;
  theme?: 'light' | 'dark';
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ModalBusyOverlay({
  show,
  title,
  description,
  theme = 'light',
  className,
  actionLabel,
  onAction,
}: ModalBusyOverlayProps) {
  if (!show) return null;

  const isDark = theme === 'dark';

  return (
    <div
      className={cn(
        'absolute inset-0 z-40 flex items-center justify-center px-5 backdrop-blur-sm',
        isDark ? 'bg-black/72' : 'bg-slate-950/38',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-[24px] border px-6 py-7 text-center shadow-[0_26px_80px_rgba(239,68,68,0.24)]',
          isDark
            ? 'border-red-300/20 bg-[linear-gradient(180deg,#1b1010_0%,#0f1115_100%)] text-white'
            : 'border-red-200 bg-[linear-gradient(180deg,#fff7f5_0%,#ffffff_100%)] text-slate-950',
        )}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] border border-red-300/25 bg-red-500/12 shadow-[0_0_42px_rgba(239,68,68,0.25)]">
          <LoadingSpinner size="lg" className="h-10 w-10 border-4 border-red-200/40 border-t-red-500" />
        </div>
        <div className="mt-4 text-base font-black">{title}</div>
        {description ? (
          <div className={cn('mt-2 text-sm leading-relaxed', isDark ? 'text-gray-300' : 'text-gray-600')}>
            {description}
          </div>
        ) : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className={cn(
              'mt-5 inline-flex h-10 items-center justify-center rounded-xl border px-4 text-xs font-black uppercase tracking-wide transition',
              isDark
                ? 'border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]'
                : 'border-slate-950/15 bg-white/80 text-slate-900 hover:bg-white',
            )}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
