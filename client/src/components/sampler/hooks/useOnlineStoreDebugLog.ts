import * as React from 'react';
import {
    STORE_DOWNLOAD_DEBUG_MAX_ENTRIES,
    StoreDownloadDebugEntry,
    StoreDownloadDebugLevel,
} from '@/components/sampler/onlineStore.types';

type UseOnlineStoreDebugLogArgs = {
    open: boolean;
    effectiveUserId: string | null;
    enabled: boolean;
    showToast: (message: string, type: 'success' | 'error') => void;
};

export function useOnlineStoreDebugLog({
    open,
    effectiveUserId,
    enabled,
    showToast,
}: UseOnlineStoreDebugLogArgs) {
    const [downloadDebugEntries, setDownloadDebugEntries] = React.useState<StoreDownloadDebugEntry[]>([]);
    const downloadDebugSeqRef = React.useRef(0);

    const pushDownloadDebugLog = React.useCallback((level: StoreDownloadDebugLevel, event: string, details?: Record<string, unknown>) => {
        if (!enabled) return;
        const ts = Date.now();
        const id = downloadDebugSeqRef.current + 1;
        downloadDebugSeqRef.current = id;
        const entry: StoreDownloadDebugEntry = { id, ts, level, event, details };
        setDownloadDebugEntries((prev) => {
            const next = [...prev, entry];
            if (next.length > STORE_DOWNLOAD_DEBUG_MAX_ENTRIES) {
                return next.slice(next.length - STORE_DOWNLOAD_DEBUG_MAX_ENTRIES);
            }
            return next;
        });
        const payload = {
            ...entry,
            iso: new Date(ts).toISOString(),
        };
        if (level === 'error') {
            console.error('[BankStoreDownloadDebug]', payload);
        }
    }, [enabled]);

    const downloadDebugText = React.useMemo(() => {
        if (downloadDebugEntries.length === 0) return 'No debug logs yet.';
        return downloadDebugEntries.map((entry) => {
            const stamp = new Date(entry.ts).toISOString();
            const details = entry.details ? ` ${JSON.stringify(entry.details)}` : '';
            return `${stamp} [${entry.level.toUpperCase()}] ${entry.event}${details}`;
        }).join('\n');
    }, [downloadDebugEntries]);

    const copyDownloadDebugLog = React.useCallback(async () => {
        if (!enabled) return;
        try {
            await navigator.clipboard.writeText(downloadDebugText);
            showToast('Store debug log copied.', 'success');
            return;
        } catch {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = downloadDebugText;
                textarea.setAttribute('readonly', 'true');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
                showToast('Store debug log copied.', 'success');
                return;
            } catch {
                showToast('Failed to copy store debug log.', 'error');
            }
        }
    }, [downloadDebugText, enabled, showToast]);

    const exportDownloadDebugLog = React.useCallback(() => {
        if (!enabled) return;
        try {
            const fileName = `store-download-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
            const blob = new Blob([downloadDebugText], { type: 'text/plain;charset=utf-8' });
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
            showToast('Store debug log exported.', 'success');
        } catch {
            showToast('Failed to export store debug log.', 'error');
        }
    }, [downloadDebugText, enabled, showToast]);

    const clearDownloadDebugLog = React.useCallback(() => {
        if (!enabled) return;
        setDownloadDebugEntries([]);
    }, [enabled]);

    React.useEffect(() => {
        if (!enabled || !open) return;
        pushDownloadDebugLog('info', 'dialog_open', {
            origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
            online: typeof navigator !== 'undefined' ? navigator.onLine : null,
            userId: effectiveUserId || 'guest',
            runtime: (window as any)?.Capacitor?.isNativePlatform?.() ? 'capacitor' : 'web',
            platform: (window as any)?.Capacitor?.getPlatform?.() || 'web',
            isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
            hasCryptoSubtle: typeof crypto !== 'undefined' && Boolean(crypto.subtle),
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        });
    }, [enabled, open, effectiveUserId, pushDownloadDebugLog]);

    React.useEffect(() => {
        if (!enabled || !open) return;
        const handleImportStart = () => {
            pushDownloadDebugLog('info', 'import_event', { kind: 'start' });
        };
        const handleImportEnd = () => {
            pushDownloadDebugLog('info', 'import_event', { kind: 'end' });
        };
        const handleImportStage = (event: Event) => {
            const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
            pushDownloadDebugLog('info', 'import_stage', {
                stage: typeof detail.stage === 'string' ? detail.stage : null,
                message: typeof detail.message === 'string' ? detail.message : null,
                progress: typeof detail.progress === 'number' ? detail.progress : null,
                elapsedMs: typeof detail.elapsedMs === 'number' ? detail.elapsedMs : null,
            });
        };
        window.addEventListener('vdjv-import-start', handleImportStart as EventListener);
        window.addEventListener('vdjv-import-end', handleImportEnd as EventListener);
        window.addEventListener('vdjv-import-stage', handleImportStage as EventListener);
        return () => {
            window.removeEventListener('vdjv-import-start', handleImportStart as EventListener);
            window.removeEventListener('vdjv-import-end', handleImportEnd as EventListener);
            window.removeEventListener('vdjv-import-stage', handleImportStage as EventListener);
        };
    }, [enabled, open, pushDownloadDebugLog]);

    React.useEffect(() => {
        if (enabled) return;
        setDownloadDebugEntries([]);
        downloadDebugSeqRef.current = 0;
    }, [enabled]);

    return {
        downloadDebugEntries,
        downloadDebugText,
        pushDownloadDebugLog,
        copyDownloadDebugLog,
        exportDownloadDebugLog,
        clearDownloadDebugLog,
    };
}
