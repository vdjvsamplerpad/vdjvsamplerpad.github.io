import * as React from 'react';
import { resolveClientCrashReportPlatform, sendClientCrashReport } from '@/lib/client-crash-report';
import {
    STORE_DOWNLOAD_DEBUG_MAX_ENTRIES,
    StoreDownloadDebugEntry,
    StoreDownloadDebugLevel,
} from '@/components/sampler/onlineStore.types';
import { buildSupportLogText, buildSanitizedSupportSection, copySupportLogText, exportSupportLogText } from '@/lib/supportDiagnostics';

type PersistedCrashActiveOperation = {
    operation: 'bankstore_download' | 'bank_import';
    operationId: string | null;
    phase: string | null;
    stage: string | null;
    startedAt: number;
    lastUpdatedAt: number;
};

type PersistedStoreCrashState = {
    version: 1;
    sessionId: string;
    userId: string | null;
    updatedAt: number;
    pageHideAt: number | null;
    activeOperation: PersistedCrashActiveOperation | null;
    entries: StoreDownloadDebugEntry[];
};

type RecoveredDownloadCrash = {
    previousSessionId: string;
    detectedAt: number;
    lastUpdatedAt: number;
    lastPageHideAt: number | null;
    lastOperation: 'bankstore_download' | 'bank_import' | null;
    lastPhase: string | null;
    lastStage: string | null;
    entryCount: number;
    recentEventPattern: string | null;
    supportLogText: string;
};

const STORE_DOWNLOAD_LIVE_STATE_KEY_PREFIX = 'vdjv-store-download-live-v1';
const STORE_DOWNLOAD_RECOVERED_REPORT_KEY_PREFIX = 'vdjv-store-download-recovered-v1';
const STORE_DOWNLOAD_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const createSessionId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const getLiveStateStorageKey = (userId: string | null): string => `${STORE_DOWNLOAD_LIVE_STATE_KEY_PREFIX}:${userId || 'guest'}`;
const getRecoveredReportStorageKey = (userId: string | null): string => `${STORE_DOWNLOAD_RECOVERED_REPORT_KEY_PREFIX}:${userId || 'guest'}`;

const readJsonStorage = <T,>(key: string): T | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

const writeJsonStorage = (key: string, value: unknown): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
    }
};

const removeStorageKey = (key: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(key);
    } catch {
    }
};

const isStoreOperation = (value: unknown): value is 'bankstore_download' | 'bank_import' =>
    value === 'bankstore_download' || value === 'bank_import';

const buildRecentEventPattern = (entries: StoreDownloadDebugEntry[]): string | null => {
    const parts = entries.slice(-6).map((entry) => {
        const operation = typeof entry.details?.operation === 'string' ? entry.details.operation : '';
        const phase = typeof entry.details?.phase === 'string' ? entry.details.phase : '';
        const details = entry.details?.details && typeof entry.details.details === 'object'
            ? entry.details.details as Record<string, unknown>
            : null;
        const nestedStage = typeof details?.stage === 'string'
            ? details.stage
            : typeof entry.details?.stage === 'string'
                ? entry.details.stage
                : '';
        return [entry.level, entry.event, operation, phase, nestedStage]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(':');
    }).filter(Boolean);
    return parts.length > 0 ? parts.join('|') : null;
};

const buildRecoveredCrashFromState = (state: PersistedStoreCrashState): RecoveredDownloadCrash => {
    const recentEventPattern = buildRecentEventPattern(state.entries);
    const details = {
        previousSessionId: state.sessionId,
        lastUpdatedAt: new Date(state.updatedAt).toISOString(),
        pageHideAt: state.pageHideAt ? new Date(state.pageHideAt).toISOString() : null,
        activeOperation: state.activeOperation,
        entryCount: state.entries.length,
        recentEventPattern,
    };
    return {
        previousSessionId: state.sessionId,
        detectedAt: Date.now(),
        lastUpdatedAt: state.updatedAt,
        lastPageHideAt: state.pageHideAt,
        lastOperation: state.activeOperation?.operation || null,
        lastPhase: state.activeOperation?.phase || null,
        lastStage: state.activeOperation?.stage || null,
        entryCount: state.entries.length,
        recentEventPattern,
        supportLogText: buildSupportLogText({
            title: 'Recovered Bank Store Crash',
            extraSections: [
                buildSanitizedSupportSection('Recovery Summary', details),
                ...(state.entries.length > 0 ? [buildSanitizedSupportSection('Store Download Debug Log', state.entries)] : []),
            ],
        }),
    };
};

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
    const [recoveredDownloadCrash, setRecoveredDownloadCrash] = React.useState<RecoveredDownloadCrash | null>(null);
    const [sendingRecoveredReport, setSendingRecoveredReport] = React.useState(false);
    const downloadDebugSeqRef = React.useRef(0);
    const sessionIdRef = React.useRef(createSessionId());
    const entriesRef = React.useRef<StoreDownloadDebugEntry[]>([]);
    const activeOperationRef = React.useRef<PersistedCrashActiveOperation | null>(null);
    const storageKeys = React.useMemo(() => ({
        live: getLiveStateStorageKey(effectiveUserId),
        recovered: getRecoveredReportStorageKey(effectiveUserId),
    }), [effectiveUserId]);

    const persistLiveState = React.useCallback((overrides?: Partial<PersistedStoreCrashState>) => {
        if (!enabled) return;
        const nextState: PersistedStoreCrashState = {
            version: 1,
            sessionId: sessionIdRef.current,
            userId: effectiveUserId,
            updatedAt: Date.now(),
            pageHideAt: null,
            activeOperation: activeOperationRef.current,
            entries: entriesRef.current,
            ...(overrides || {}),
        };
        writeJsonStorage(storageKeys.live, nextState);
    }, [effectiveUserId, enabled, storageKeys.live]);

    const setActiveOperation = React.useCallback((nextOperation: PersistedCrashActiveOperation | null) => {
        activeOperationRef.current = nextOperation;
        persistLiveState({
            activeOperation: nextOperation,
            updatedAt: nextOperation?.lastUpdatedAt || Date.now(),
            pageHideAt: null,
        });
    }, [persistLiveState]);

    const pushDownloadDebugLog = React.useCallback((level: StoreDownloadDebugLevel, event: string, details?: Record<string, unknown>) => {
        if (!enabled) return;
        const ts = Date.now();
        const id = downloadDebugSeqRef.current + 1;
        downloadDebugSeqRef.current = id;
        const entry: StoreDownloadDebugEntry = { id, ts, level, event, details };
        setDownloadDebugEntries((prev) => {
            const next = [...prev, entry];
            if (next.length > STORE_DOWNLOAD_DEBUG_MAX_ENTRIES) {
                const sliced = next.slice(next.length - STORE_DOWNLOAD_DEBUG_MAX_ENTRIES);
                entriesRef.current = sliced;
                persistLiveState({ entries: sliced, updatedAt: ts, pageHideAt: null });
                return sliced;
            }
            entriesRef.current = next;
            persistLiveState({ entries: next, updatedAt: ts, pageHideAt: null });
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

    const downloadSupportLogText = React.useMemo(() => buildSupportLogText({
        title: 'Bank Store Download Failure',
        extraSections: downloadDebugEntries.length > 0
            ? [buildSanitizedSupportSection('Store Download Debug Log', downloadDebugEntries)]
            : [],
    }), [downloadDebugEntries]);

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

    const copyDownloadSupportLog = React.useCallback(async () => {
        if (!enabled) return;
        try {
            await copySupportLogText(downloadSupportLogText);
            showToast('Support log copied.', 'success');
        } catch {
            showToast('Failed to copy support log.', 'error');
        }
    }, [downloadSupportLogText, enabled, showToast]);

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

    const exportDownloadSupportLog = React.useCallback(() => {
        if (!enabled) return;
        try {
            exportSupportLogText(downloadSupportLogText, 'store-download-support');
            showToast('Support log exported.', 'success');
        } catch {
            showToast('Failed to export support log.', 'error');
        }
    }, [downloadSupportLogText, enabled, showToast]);

    const clearDownloadDebugLog = React.useCallback(() => {
        if (!enabled) return;
        setDownloadDebugEntries([]);
        entriesRef.current = [];
        persistLiveState({ entries: [], pageHideAt: null });
    }, [enabled]);

    const copyRecoveredSupportLog = React.useCallback(async () => {
        if (!enabled || !recoveredDownloadCrash) return;
        try {
            await copySupportLogText(recoveredDownloadCrash.supportLogText);
            showToast('Recovered crash report copied.', 'success');
        } catch {
            showToast('Failed to copy recovered crash report.', 'error');
        }
    }, [enabled, recoveredDownloadCrash, showToast]);

    const exportRecoveredSupportLog = React.useCallback(() => {
        if (!enabled || !recoveredDownloadCrash) return;
        try {
            exportSupportLogText(recoveredDownloadCrash.supportLogText, 'store-download-recovered');
            showToast('Recovered crash report exported.', 'success');
        } catch {
            showToast('Failed to export recovered crash report.', 'error');
        }
    }, [enabled, recoveredDownloadCrash, showToast]);

    const dismissRecoveredDownloadCrash = React.useCallback(() => {
        setRecoveredDownloadCrash(null);
        removeStorageKey(storageKeys.recovered);
    }, [storageKeys.recovered]);

    const sendRecoveredCrashReport = React.useCallback(async () => {
        if (!enabled || !recoveredDownloadCrash || sendingRecoveredReport) return;
        setSendingRecoveredReport(true);
        try {
            const data = await sendClientCrashReport({
                domain: 'bank_store',
                title: 'Recovered Bank Store Crash',
                supportLogText: recoveredDownloadCrash.supportLogText,
                platform: resolveClientCrashReportPlatform(),
                appVersion: (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_APP_VERSION || null,
                operation: recoveredDownloadCrash.lastOperation,
                phase: recoveredDownloadCrash.lastPhase,
                stage: recoveredDownloadCrash.lastStage,
                entryCount: recoveredDownloadCrash.entryCount,
                recentEventPattern: recoveredDownloadCrash.recentEventPattern,
                detectedAt: new Date(recoveredDownloadCrash.detectedAt).toISOString(),
                lastUpdatedAt: new Date(recoveredDownloadCrash.lastUpdatedAt).toISOString(),
            });
            const repeatCount = Number(data?.repeatCount || 1);
            showToast(
                repeatCount > 1
                    ? `Crash report sent. Repeat count: ${repeatCount}.`
                    : 'Crash report sent.',
                'success',
            );
            dismissRecoveredDownloadCrash();
        } catch (error: any) {
            showToast(error?.message || 'Failed to send crash report.', 'error');
        } finally {
            setSendingRecoveredReport(false);
        }
    }, [dismissRecoveredDownloadCrash, enabled, recoveredDownloadCrash, sendingRecoveredReport, showToast]);

    React.useEffect(() => {
        if (!enabled) {
            setRecoveredDownloadCrash(null);
            setSendingRecoveredReport(false);
            return;
        }
        const existingRecovered = readJsonStorage<RecoveredDownloadCrash>(storageKeys.recovered);
        if (existingRecovered?.supportLogText) {
            setRecoveredDownloadCrash(existingRecovered);
        }
        const previousState = readJsonStorage<PersistedStoreCrashState>(storageKeys.live);
        if (
            previousState
            && previousState.sessionId !== sessionIdRef.current
            && previousState.activeOperation
            && previousState.updatedAt > 0
            && Date.now() - previousState.updatedAt <= STORE_DOWNLOAD_RECOVERY_MAX_AGE_MS
            && !previousState.pageHideAt
        ) {
            const recovered = buildRecoveredCrashFromState(previousState);
            setRecoveredDownloadCrash(recovered);
            writeJsonStorage(storageKeys.recovered, recovered);
        }
        writeJsonStorage(storageKeys.live, {
            version: 1,
            sessionId: sessionIdRef.current,
            userId: effectiveUserId,
            updatedAt: Date.now(),
            pageHideAt: null,
            activeOperation: null,
            entries: [],
        } satisfies PersistedStoreCrashState);
    }, [effectiveUserId, enabled, storageKeys.live, storageKeys.recovered]);

    React.useEffect(() => {
        if (!enabled) return;
        const markPageHide = () => {
            persistLiveState({ pageHideAt: Date.now() });
        };
        window.addEventListener('pagehide', markPageHide);
        return () => {
            window.removeEventListener('pagehide', markPageHide);
        };
    }, [enabled, persistLiveState]);

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
            setActiveOperation({
                operation: 'bank_import',
                operationId: null,
                phase: 'start',
                stage: 'import_start',
                startedAt: Date.now(),
                lastUpdatedAt: Date.now(),
            });
        };
        const handleImportEnd = () => {
            pushDownloadDebugLog('info', 'import_event', { kind: 'end' });
            if (activeOperationRef.current?.operation === 'bank_import') {
                setActiveOperation(null);
            }
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
        const handleOperationDebug = (event: Event) => {
            const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
            const operation = typeof detail.operation === 'string' ? detail.operation : null;
            if (!operation || !String(operation).startsWith('bankstore') && operation !== 'bank_import') return;
            const phase = typeof detail.phase === 'string' ? detail.phase : null;
            pushDownloadDebugLog(phase === 'error' ? 'error' : 'info', 'operation_debug', {
                operation,
                phase,
                operationId: typeof detail.operationId === 'string' ? detail.operationId : null,
                details: detail.details && typeof detail.details === 'object' ? detail.details : null,
            });
            if (!isStoreOperation(operation) || !phase) return;
            const current = activeOperationRef.current;
            if (phase === 'start') {
                setActiveOperation({
                    operation,
                    operationId: typeof detail.operationId === 'string' ? detail.operationId : null,
                    phase,
                    stage: typeof (detail.details as Record<string, unknown> | undefined)?.stage === 'string'
                        ? String((detail.details as Record<string, unknown>).stage)
                        : null,
                    startedAt: Date.now(),
                    lastUpdatedAt: Date.now(),
                });
                return;
            }
            if (phase === 'stage' || phase === 'heartbeat') {
                const startedAt = current?.operation === operation ? current.startedAt : Date.now();
                setActiveOperation({
                    operation,
                    operationId: typeof detail.operationId === 'string' ? detail.operationId : current?.operationId || null,
                    phase,
                    stage: typeof (detail.details as Record<string, unknown> | undefined)?.stage === 'string'
                        ? String((detail.details as Record<string, unknown>).stage)
                        : current?.stage || null,
                    startedAt,
                    lastUpdatedAt: Date.now(),
                });
                return;
            }
            if (phase === 'finish' || phase === 'error') {
                setActiveOperation(null);
            }
        };
        window.addEventListener('vdjv-import-start', handleImportStart as EventListener);
        window.addEventListener('vdjv-import-end', handleImportEnd as EventListener);
        window.addEventListener('vdjv-import-stage', handleImportStage as EventListener);
        window.addEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
        return () => {
            window.removeEventListener('vdjv-import-start', handleImportStart as EventListener);
            window.removeEventListener('vdjv-import-end', handleImportEnd as EventListener);
            window.removeEventListener('vdjv-import-stage', handleImportStage as EventListener);
            window.removeEventListener('vdjv-operation-debug', handleOperationDebug as EventListener);
        };
    }, [enabled, open, pushDownloadDebugLog]);

    React.useEffect(() => {
        if (enabled) return;
        setDownloadDebugEntries([]);
        entriesRef.current = [];
        downloadDebugSeqRef.current = 0;
        activeOperationRef.current = null;
        setRecoveredDownloadCrash(null);
        setSendingRecoveredReport(false);
    }, [enabled]);

    return {
        downloadDebugEntries,
        downloadDebugText,
        downloadSupportLogText,
        recoveredDownloadCrash,
        sendingRecoveredReport,
        pushDownloadDebugLog,
        copyDownloadDebugLog,
        copyDownloadSupportLog,
        exportDownloadDebugLog,
        exportDownloadSupportLog,
        copyRecoveredSupportLog,
        exportRecoveredSupportLog,
        sendRecoveredCrashReport,
        dismissRecoveredDownloadCrash,
        clearDownloadDebugLog,
    };
}
