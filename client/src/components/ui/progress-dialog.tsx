import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Download, Upload, CheckCircle, AlertCircle, Clock, ShieldCheck, Check, Copy } from 'lucide-react';
import { copyTextToClipboard } from '@/components/ui/copyable-value';

interface ProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  progress: number;
  status: 'loading' | 'success' | 'error';
  type: 'export' | 'import';
  theme?: 'light' | 'dark';
  errorMessage?: string;
  onRetry?: () => void;
  onLogin?: () => void;
  etaSeconds?: number | null;
  statusMessage?: string;
  logLines?: string[];
  debugOperations?: string[];
  showWarning?: boolean;
  hideCloseButton?: boolean;
  useHistory?: boolean;
}

type OperationDebugEntryLike = {
  operation?: string;
  iso?: string;
  level?: string;
  phase?: string;
  operationId?: string;
  details?: Record<string, unknown>;
};

const buildOperationTimelineText = (operations?: string[]): string => {
  if (typeof window === 'undefined') return '';
  const debugWindow = window as Window & typeof globalThis & {
    __vdjvOperationTimeline?: OperationDebugEntryLike[];
  };
  const allEntries = Array.isArray(debugWindow.__vdjvOperationTimeline)
    ? debugWindow.__vdjvOperationTimeline
    : [];
  const normalizedOperations = Array.isArray(operations)
    ? operations.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const relevantEntries = normalizedOperations.length > 0
    ? allEntries.filter((entry) => normalizedOperations.includes(String(entry.operation || '')))
    : allEntries;
  if (relevantEntries.length === 0) return '';
  return relevantEntries
    .map((entry) => {
      const iso = typeof entry.iso === 'string' ? entry.iso : new Date().toISOString();
      const level = typeof entry.level === 'string' ? entry.level.toUpperCase() : 'INFO';
      const operation = typeof entry.operation === 'string' ? entry.operation : 'unknown_operation';
      const phase = typeof entry.phase === 'string' ? entry.phase : 'event';
      const operationId = typeof entry.operationId === 'string' ? entry.operationId : 'unknown';
      const details = entry.details ? ` ${JSON.stringify(entry.details)}` : '';
      return `${iso} [${level}] ${operation}/${phase}#${operationId}${details}`;
    })
    .join('\n');
};

export function ProgressDialog({
  open,
  onOpenChange,
  title,
  description,
  progress,
  status,
  type,
  theme = 'light',
  errorMessage,
  onRetry,
  onLogin,
  etaSeconds,
  statusMessage,
  logLines,
  debugOperations,
  showWarning,
  hideCloseButton = false,
  useHistory = true
}: ProgressDialogProps) {
  const [copiedLogs, setCopiedLogs] = React.useState(false);

  React.useEffect(() => {
    if (!copiedLogs) return;
    const timer = window.setTimeout(() => setCopiedLogs(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedLogs]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    // Keep dialog visible while processing to prevent accidental close on backdrop click.
    if (!nextOpen && status === 'loading') return;
    onOpenChange(nextOpen);
  };

  const handleCopyLogs = React.useCallback(async () => {
    const visibleLogText = Array.isArray(logLines) && logLines.length > 0 ? logLines.join('\n') : '';
    const debugTimelineText = buildOperationTimelineText(debugOperations);
    const parts = [
      visibleLogText ? `Activity Log\n${visibleLogText}` : '',
      debugTimelineText ? `Operation Timeline\n${debugTimelineText}` : '',
    ].filter(Boolean);
    if (parts.length === 0) return;
    await copyTextToClipboard(parts.join('\n\n'));
    setCopiedLogs(true);
  }, [debugOperations, logLines]);
  
  // Check if error message indicates login is required
  const needsLogin = errorMessage && (
    errorMessage.toLowerCase().includes('sign in') ||
    errorMessage.toLowerCase().includes('login required') ||
    errorMessage.toLowerCase().includes('please sign in')
  );
  
  const formatTime = (seconds: number) => {
    if (seconds === Infinity) return 'Calculating...';
    if (seconds < 2) return 'Almost there...';
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const getIcon = () => {
    if (status === 'success') {
      return <CheckCircle className="w-6 h-6 text-green-500" />;
    }
    if (status === 'error') {
      return <AlertCircle className="w-6 h-6 text-red-500" />;
    }
    if (status === 'loading' && progress < 20 && type === 'import') {
      return <ShieldCheck className="w-6 h-6 text-blue-500 animate-pulse" />;
    }
    return type === 'export' 
      ? <Download className="w-6 h-6 text-blue-500" />
      : <Upload className="w-6 h-6 text-blue-500" />;
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange} useHistory={useHistory}>
      {/* Inject styles for the flowing animation */}
      <style>{`
        @keyframes flow-glow {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-flow-glow {
          animation: flow-glow 1.5s infinite linear;
        }
      `}</style>

      <DialogContent
        hideCloseButton={hideCloseButton}
        className={`sm:max-w-md backdrop-blur-md transition-colors duration-200 ${
        theme === 'dark' ? 'bg-gray-800/95 border-gray-600' : 'bg-white/95 border-gray-300'
      }`}
        onEscapeKeyDown={(event) => {
          if (status === 'loading') event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (status === 'loading') event.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              status === 'success' 
                ? 'bg-green-100 dark:bg-green-900/30'
                : status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-blue-100 dark:bg-blue-900/30'
            }`}>
              {getIcon()}
            </div>
            <div className="flex-1">
              <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
                {title}
              </DialogTitle>
              {status === 'loading' && statusMessage && (
                <p className={`text-xs mt-1 font-medium ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>
                  {statusMessage}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>
        
        <div className="space-y-4">
          {description && !statusMessage && (
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              {description}
            </p>
          )}

          {status === 'loading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                  Progress
                </span>
                <span className={`font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {Math.round(progress)}%
                </span>
              </div>
              
              <div className="relative">
                {/* Base Progress Component */}
                <Progress 
                  value={progress} 
                  className="h-2 overflow-hidden"
                />
                
                {/* Flowing Glow Overlay */}
                {/* This div matches the width of the progress fill exactly */}
                <div 
                  className="absolute top-0 left-0 h-full overflow-hidden rounded-full pointer-events-none transition-all duration-300 ease-in-out"
                  style={{ width: `${progress}%` }}
                >
                  {/* This gradient moves across the filled area */}
                  <div className="w-full h-full animate-flow-glow bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                </div>
              </div>

              <div className="flex justify-between items-center text-xs mt-1">
                 {etaSeconds !== undefined && etaSeconds !== null && (
                  <div className={`flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    <Clock className="w-3 h-3" />
                    <span>Est. remaining: {formatTime(etaSeconds)}</span>
                  </div>
                )}
              </div>

              {showWarning && (
                <div className={`mt-2 p-2 rounded text-xs font-medium flex gap-2 items-start animate-in fade-in slide-in-from-top-1 ${
                  theme === 'dark' ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-50 text-amber-700'
                }`}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <p>Verification may take a little longer. Please keep this app open.</p>
                </div>
              )}

            </div>
          )}

          {Array.isArray(logLines) && logLines.length > 0 && (
            <div className={`rounded border p-2 ${
              theme === 'dark'
                ? 'bg-gray-900/40 border-gray-700'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  Activity Log
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => void handleCopyLogs()}
                >
                  {copiedLogs ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLogs ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className={`max-h-28 overflow-y-auto text-[11px] leading-relaxed ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {logLines.map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className={`p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800`}>
              <p className="text-sm text-green-800 dark:text-green-200">
                {errorMessage && status === 'success' ? errorMessage : (type === 'export' ? 'Bank exported successfully!' : 'Bank imported successfully!')}
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className={`p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800`}>
              <p className="text-sm text-red-800 dark:text-red-200">
                {errorMessage || 'Could not complete this action for the bank. Please try again.'}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {status === 'loading' ? (
              <Button
                onClick={() => onOpenChange(false)}
                variant="outline"
                className="w-full"
                disabled
              >
                Please wait...
              </Button>
            ) : status === 'error' && (needsLogin ? onLogin : onRetry) ? (
              <>
                <Button
                  onClick={needsLogin ? onLogin : onRetry}
                  variant="default"
                  className="flex-1"
                >
                  {needsLogin ? 'Sign In' : 'Retry'}
                </Button>
                <Button
                  onClick={() => onOpenChange(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                onClick={() => onOpenChange(false)}
                className="w-full"
              >
                {status === 'success' ? 'Done' : 'Close'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
