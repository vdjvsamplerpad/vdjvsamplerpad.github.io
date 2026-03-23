import React from 'react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { AlertTriangle, Bug, Copy, Download, Home, Loader2, RefreshCw, X } from 'lucide-react';
import { forceFreshAppReload } from '@/lib/chunk-load-recovery';
import {
  buildSanitizedSupportSection,
  buildSupportLogText,
  copySupportLogText,
  exportSupportLogText,
} from '@/lib/supportDiagnostics';
import { getAudioTelemetry, type AudioTelemetrySession } from '@/lib/audio-telemetry';
import { resolveClientCrashReportPlatform, sendClientCrashReport } from '@/lib/client-crash-report';

interface GlobalErrorHandlerProps {
  children: React.ReactNode;
}

interface ErrorState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  errorId: string;
  showError: boolean;
}

type RecoveredRuntimeCrash = {
  errorId: string;
  message: string;
  name: string;
  stack: string | null;
  componentStack: string | null;
  url: string;
  userAgent: string;
  detectedAt: number;
  supportLogText: string;
};

type RecoveredPlaybackCrash = {
  sessionId: string;
  detectedAt: number;
  updatedAt: number;
  eventCount: number;
  recentEventPattern: string | null;
  latestEventType: string | null;
  supportLogText: string;
};

const GLOBAL_RUNTIME_RECOVERED_KEY = 'vdjv-global-runtime-recovered-v1';

const truncateText = (value: string, maxLength = 240): string =>
  value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;

const readRecoveredRuntimeCrash = (): RecoveredRuntimeCrash | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(GLOBAL_RUNTIME_RECOVERED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoveredRuntimeCrash;
    if (!parsed?.supportLogText || !parsed?.errorId) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeRecoveredRuntimeCrash = (value: RecoveredRuntimeCrash | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!value) {
      window.localStorage.removeItem(GLOBAL_RUNTIME_RECOVERED_KEY);
      return;
    }
    window.localStorage.setItem(GLOBAL_RUNTIME_RECOVERED_KEY, JSON.stringify(value));
  } catch {
  }
};

const buildRecentPlaybackPattern = (session: AudioTelemetrySession): string | null => {
  const parts = session.events
    .slice(-6)
    .map((event) => [event.level, event.type].filter(Boolean).join(':'))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('|') : null;
};

const buildRecoveredPlaybackCrash = (session: AudioTelemetrySession): RecoveredPlaybackCrash => {
  const latestEvent = session.events[session.events.length - 1] || null;
  const recentEventPattern = buildRecentPlaybackPattern(session);
  return {
    sessionId: session.sessionId,
    detectedAt: Date.now(),
    updatedAt: session.updatedAt,
    eventCount: session.events.length,
    recentEventPattern,
    latestEventType: latestEvent?.type || null,
    supportLogText: buildSupportLogText({
      title: 'Recovered Playback Crash',
      extraSections: [
        buildSanitizedSupportSection('Recovery Summary', {
          sessionId: session.sessionId,
          startedAt: new Date(session.startedAt).toISOString(),
          updatedAt: new Date(session.updatedAt).toISOString(),
          platform: session.platform,
          appVersion: session.appVersion,
          eventCount: session.events.length,
          counters: session.counters,
          recentEventPattern,
        }),
        buildSanitizedSupportSection('Recovered Audio Telemetry Session', session),
      ],
    }),
  };
};

const buildCurrentErrorSupportLog = (
  error: Error,
  errorInfo: React.ErrorInfo | null,
  errorId: string,
): string =>
  buildSupportLogText({
    title: 'Global Runtime Error',
    errorMessage: error.message,
    extraSections: [
      buildSanitizedSupportSection('Runtime Error Summary', {
        errorId,
        name: error.name,
        message: error.message,
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      }),
      buildSanitizedSupportSection('Runtime Error Details', {
        stack: error.stack || null,
        componentStack: errorInfo?.componentStack || null,
      }),
    ],
  });

const buildRecoveredRuntimeSupportLog = (input: {
  errorId: string;
  error: Error;
  errorInfo: React.ErrorInfo | null;
}): RecoveredRuntimeCrash => ({
  errorId: input.errorId,
  message: input.error.message || 'Unknown runtime error',
  name: input.error.name || 'Error',
  stack: input.error.stack || null,
  componentStack: input.errorInfo?.componentStack || null,
  url: typeof window !== 'undefined' ? window.location.href : 'unknown',
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  detectedAt: Date.now(),
  supportLogText: buildCurrentErrorSupportLog(input.error, input.errorInfo, input.errorId),
});

export function GlobalErrorHandler({ children }: GlobalErrorHandlerProps) {
  const [errorState, setErrorState] = React.useState<ErrorState>({
    error: null,
    errorInfo: null,
    errorId: '',
    showError: false,
  });
  const appVersion = (import.meta as any).env?.VITE_APP_VERSION || 'unknown';
  const telemetry = React.useMemo(() => getAudioTelemetry(appVersion), [appVersion]);
  const [recoveredRuntimeCrash, setRecoveredRuntimeCrash] = React.useState<RecoveredRuntimeCrash | null>(() => readRecoveredRuntimeCrash());
  const [recoveredPlaybackCrash, setRecoveredPlaybackCrash] = React.useState<RecoveredPlaybackCrash | null>(null);
  const [sendingCurrentReport, setSendingCurrentReport] = React.useState(false);
  const [sendingRecoveredReport, setSendingRecoveredReport] = React.useState(false);
  const [currentReportFeedback, setCurrentReportFeedback] = React.useState('');
  const [recoveredReportFeedback, setRecoveredReportFeedback] = React.useState('');

  React.useEffect(() => {
    const snapshot = telemetry.getRecoveredSessionSnapshot();
    setRecoveredPlaybackCrash(snapshot ? buildRecoveredPlaybackCrash(snapshot) : null);
    const unsubscribe = telemetry.subscribe(() => {
      const next = telemetry.getRecoveredSessionSnapshot();
      setRecoveredPlaybackCrash(next ? buildRecoveredPlaybackCrash(next) : null);
    });
    return unsubscribe;
  }, [telemetry]);

  const handleError = React.useCallback((error: Error, errorInfo?: React.ErrorInfo) => {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const recovered = buildRecoveredRuntimeSupportLog({
      errorId,
      error,
      errorInfo: errorInfo || null,
    });
    writeRecoveredRuntimeCrash(recovered);
    setRecoveredRuntimeCrash(recovered);
    setCurrentReportFeedback('');
    setErrorState({
      error,
      errorInfo: errorInfo || null,
      errorId,
      showError: true,
    });
  }, []);

  const handleUnhandledRejection = React.useCallback((event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    handleError(error);
  }, [handleError]);

  const handleWindowError = React.useCallback((event: ErrorEvent) => {
    const error = event.error || new Error(event.message);
    handleError(error);
  }, [handleError]);

  React.useEffect(() => {
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [handleUnhandledRejection, handleWindowError]);

  const clearRecoveredRuntimeCrash = React.useCallback(() => {
    writeRecoveredRuntimeCrash(null);
    setRecoveredRuntimeCrash(null);
    setRecoveredReportFeedback('');
  }, []);

  const clearRecoveredPlaybackCrash = React.useCallback(() => {
    telemetry.clearRecoveredSession();
    setRecoveredPlaybackCrash(null);
    setRecoveredReportFeedback('');
  }, [telemetry]);

  const handleReset = React.useCallback(() => {
    setCurrentReportFeedback('');
    setErrorState((prev) => ({ ...prev, showError: false }));
  }, []);

  const handleReload = React.useCallback(() => {
    void forceFreshAppReload();
  }, []);

  const handleGoHome = React.useCallback(() => {
    window.location.href = '/vdjv';
  }, []);

  const copyCurrentErrorReport = React.useCallback(async () => {
    if (!errorState.error) return;
    try {
      await copySupportLogText(buildCurrentErrorSupportLog(errorState.error, errorState.errorInfo, errorState.errorId));
      setCurrentReportFeedback('Report copied.');
    } catch {
      setCurrentReportFeedback('Failed to copy report.');
    }
  }, [errorState.error, errorState.errorId, errorState.errorInfo]);

  const exportCurrentErrorReport = React.useCallback(() => {
    if (!errorState.error) return;
    try {
      exportSupportLogText(
        buildCurrentErrorSupportLog(errorState.error, errorState.errorInfo, errorState.errorId),
        'global-runtime-error',
      );
      setCurrentReportFeedback('Report exported.');
    } catch {
      setCurrentReportFeedback('Failed to export report.');
    }
  }, [errorState.error, errorState.errorId, errorState.errorInfo]);

  const sendCurrentErrorReport = React.useCallback(async () => {
    if (!errorState.error || sendingCurrentReport) return;
    setSendingCurrentReport(true);
    setCurrentReportFeedback('');
    try {
      const payload = await sendClientCrashReport({
        domain: 'global_runtime',
        title: 'Global Runtime Error',
        supportLogText: buildCurrentErrorSupportLog(errorState.error, errorState.errorInfo, errorState.errorId),
        platform: resolveClientCrashReportPlatform(),
        appVersion,
        operation: 'global_runtime',
        phase: 'current_error',
        stage: errorState.error.name || 'error',
        recentEventPattern: truncateText(errorState.error.message || 'unknown-error', 180),
        detectedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      setCurrentReportFeedback(
        payload.repeatCount > 1
          ? `Report sent. Repeat count: ${payload.repeatCount}.`
          : 'Report sent.',
      );
    } catch (error: any) {
      setCurrentReportFeedback(error?.message || 'Failed to send report.');
    } finally {
      setSendingCurrentReport(false);
    }
  }, [appVersion, errorState.error, errorState.errorId, errorState.errorInfo, sendingCurrentReport]);

  const activeRecoveredNotice = recoveredRuntimeCrash
    ? {
        key: 'runtime' as const,
        title: 'Previous app error detected',
        description: recoveredRuntimeCrash.message,
        detail: `Reference ID: ${recoveredRuntimeCrash.errorId}`,
        supportLogText: recoveredRuntimeCrash.supportLogText,
        recentEventPattern: truncateText(recoveredRuntimeCrash.message, 180),
        operation: 'global_runtime',
        phase: 'recovered',
        stage: recoveredRuntimeCrash.name || 'error',
        detectedAt: recoveredRuntimeCrash.detectedAt,
        lastUpdatedAt: recoveredRuntimeCrash.detectedAt,
        entryCount: null as number | null,
      }
    : recoveredPlaybackCrash
      ? {
          key: 'playback' as const,
          title: 'Previous playback session likely crashed',
          description: recoveredPlaybackCrash.latestEventType
            ? `Last event: ${recoveredPlaybackCrash.latestEventType}`
            : 'Recovered audio telemetry from the previous session.',
          detail: `Recovered ${recoveredPlaybackCrash.eventCount} audio events.`,
          supportLogText: recoveredPlaybackCrash.supportLogText,
          recentEventPattern: recoveredPlaybackCrash.recentEventPattern,
          operation: 'audio_playback',
          phase: 'recovered',
          stage: recoveredPlaybackCrash.latestEventType || 'session_recovery',
          detectedAt: recoveredPlaybackCrash.detectedAt,
          lastUpdatedAt: recoveredPlaybackCrash.updatedAt,
          entryCount: recoveredPlaybackCrash.eventCount,
        }
      : null;

  const copyRecoveredReport = React.useCallback(async () => {
    if (!activeRecoveredNotice) return;
    try {
      await copySupportLogText(activeRecoveredNotice.supportLogText);
      setRecoveredReportFeedback('Report copied.');
    } catch {
      setRecoveredReportFeedback('Failed to copy report.');
    }
  }, [activeRecoveredNotice]);

  const exportRecoveredReport = React.useCallback(() => {
    if (!activeRecoveredNotice) return;
    try {
      exportSupportLogText(
        activeRecoveredNotice.supportLogText,
        activeRecoveredNotice.key === 'runtime' ? 'recovered-runtime-crash' : 'recovered-playback-crash',
      );
      setRecoveredReportFeedback('Report exported.');
    } catch {
      setRecoveredReportFeedback('Failed to export report.');
    }
  }, [activeRecoveredNotice]);

  const dismissRecoveredNotice = React.useCallback(() => {
    if (!activeRecoveredNotice) return;
    if (activeRecoveredNotice.key === 'runtime') clearRecoveredRuntimeCrash();
    else clearRecoveredPlaybackCrash();
  }, [activeRecoveredNotice, clearRecoveredPlaybackCrash, clearRecoveredRuntimeCrash]);

  const sendRecoveredReport = React.useCallback(async () => {
    if (!activeRecoveredNotice || sendingRecoveredReport) return;
    setSendingRecoveredReport(true);
    setRecoveredReportFeedback('');
    try {
      const payload = await sendClientCrashReport({
        domain: activeRecoveredNotice.key === 'runtime' ? 'global_runtime' : 'playback',
        title: activeRecoveredNotice.title,
        supportLogText: activeRecoveredNotice.supportLogText,
        platform: resolveClientCrashReportPlatform(),
        appVersion,
        operation: activeRecoveredNotice.operation,
        phase: activeRecoveredNotice.phase,
        stage: activeRecoveredNotice.stage,
        entryCount: activeRecoveredNotice.entryCount,
        recentEventPattern: activeRecoveredNotice.recentEventPattern,
        detectedAt: new Date(activeRecoveredNotice.detectedAt).toISOString(),
        lastUpdatedAt: new Date(activeRecoveredNotice.lastUpdatedAt).toISOString(),
      });
      setRecoveredReportFeedback(
        payload.repeatCount > 1
          ? `Report sent. Repeat count: ${payload.repeatCount}.`
          : 'Report sent.',
      );
    } catch (error: any) {
      setRecoveredReportFeedback(error?.message || 'Failed to send report.');
    } finally {
      setSendingRecoveredReport(false);
    }
  }, [activeRecoveredNotice, appVersion, sendingRecoveredReport]);

  if (errorState.showError && errorState.error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
        <Card className="relative w-full max-w-md">
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-2 top-2 h-8 w-8 p-0"
            onClick={() => setErrorState((prev) => ({ ...prev, showError: false }))}
          >
            <X className="h-4 w-4" />
          </Button>

          <CardHeader className="pr-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-xl">Something went wrong</CardTitle>
            <CardDescription>
              Something went wrong. Reference ID: {errorState.errorId}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                {errorState.error.message || 'We could not identify the issue.'}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button onClick={copyCurrentErrorReport} variant="outline" className="w-full">
                <Copy className="mr-2 h-4 w-4" />
                Copy Report
              </Button>
              <Button onClick={exportCurrentErrorReport} variant="outline" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            </div>

            <Button onClick={sendCurrentErrorReport} variant="secondary" className="w-full" disabled={sendingCurrentReport}>
              {sendingCurrentReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bug className="mr-2 h-4 w-4" />}
              Send Report
            </Button>

            {currentReportFeedback ? (
              <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {currentReportFeedback}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Button onClick={handleReset} variant="default" className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
              <Button onClick={handleReload} variant="outline" className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload Page
              </Button>
              <Button onClick={handleGoHome} variant="outline" className="w-full">
                <Home className="mr-2 h-4 w-4" />
                Go Home
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Show technical details (development only)
                </summary>
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                  {errorState.error.stack}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeRecoveredNotice) {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <Card className="relative w-full max-w-lg">
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-2 top-2 h-8 w-8 p-0"
              onClick={dismissRecoveredNotice}
              disabled={sendingRecoveredReport}
            >
              <X className="h-4 w-4" />
            </Button>

            <CardHeader className="pr-8">
              <CardTitle className="text-lg">{activeRecoveredNotice.title}</CardTitle>
              <CardDescription>{activeRecoveredNotice.description}</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <div>{activeRecoveredNotice.detail}</div>
                <div className="mt-1">
                  Detected: {new Date(activeRecoveredNotice.detectedAt).toLocaleString()}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button onClick={copyRecoveredReport} variant="outline" disabled={sendingRecoveredReport}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
                <Button onClick={exportRecoveredReport} variant="outline" disabled={sendingRecoveredReport}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
                <Button onClick={sendRecoveredReport} variant="secondary" disabled={sendingRecoveredReport}>
                  {sendingRecoveredReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bug className="mr-2 h-4 w-4" />}
                  Send
                </Button>
              </div>

              {recoveredReportFeedback ? (
                <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {recoveredReportFeedback}
                </div>
              ) : null}

              <Button onClick={dismissRecoveredNotice} variant="default" className="w-full" disabled={sendingRecoveredReport}>
                Dismiss
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
