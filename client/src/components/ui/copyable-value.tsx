import * as React from 'react';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type CopyableValueProps = {
  value: string;
  label?: string;
  className?: string;
  valueClassName?: string;
  buttonClassName?: string;
  onCopied?: () => void;
  wrap?: boolean;
};

export async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!ok) throw new Error('copy_failed');
}

export function CopyableValue({
  value,
  label = 'value',
  className,
  valueClassName,
  buttonClassName,
  onCopied,
  wrap = false,
}: CopyableValueProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = React.useCallback(async () => {
    if (!value) return;
    await copyTextToClipboard(value);
    setCopied(true);
    onCopied?.();
  }, [onCopied, value]);

  return (
    <span className={cn('inline-flex max-w-full gap-1.5 align-middle', wrap ? 'items-start' : 'items-center', className)}>
      <span
        className={cn('vdjv-selectable min-w-0', wrap ? 'break-all whitespace-normal leading-tight' : 'truncate', valueClassName)}
        data-allow-double-tap="true"
        title={value}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('h-6 w-6 shrink-0 rounded-full opacity-75 hover:opacity-100', wrap ? 'self-start' : null, buttonClassName)}
        onClick={() => void handleCopy()}
        title={copied ? `Copied ${label}` : `Copy ${label}`}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </span>
  );
}
