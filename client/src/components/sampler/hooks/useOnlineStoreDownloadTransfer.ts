import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { isElectronImportBridgeAvailable, isNativeBankImportAvailable } from '@/lib/native-bank-import';
import {
    OnlineBankStoreImportMeta,
    StoreDownloadDebugLevel,
    StoreDownloadedArtifact,
    StoreItem,
    TransferState,
} from '@/components/sampler/onlineStore.types';
import type { ImportBankSource } from './nativeBankImport.types';
import {
    emitOperationDebug,
    startOperationHeartbeat,
} from '@/components/sampler/hooks/useSamplerStore.operationDiagnostics';

type EffectiveUserLike = {
    id: string;
    email?: string | null;
} | null;

type UseOnlineStoreDownloadTransferArgs = {
    effectiveUser: EffectiveUserLike;
    requestLogin: (reason?: string) => void;
    transfers: Record<string, TransferState>;
    setTransfers: React.Dispatch<React.SetStateAction<Record<string, TransferState>>>;
    downloadedArtifactsRef: React.MutableRefObject<Record<string, StoreDownloadedArtifact>>;
    pushDownloadDebugLog: (level: StoreDownloadDebugLevel, event: string, details?: Record<string, unknown>) => void;
    showToast: (message: string, type: 'success' | 'error') => void;
    onImportBankFromStore: (
        source: ImportBankSource,
        meta: OnlineBankStoreImportMeta,
        onProgress?: (progress: number) => void
    ) => Promise<void>;
};

type HandleDownloadOptions = {
    preferCachedImportRetry?: boolean;
    refreshAssetsOnly?: boolean;
};

const toHex = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
};

const sha256HexFromBlob = async (blob: Blob): Promise<string> => {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('SHA256_UNAVAILABLE');
    }
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return toHex(digest);
};

const sanitizeUrlForLog = (value: string): string => {
    try {
        const parsed = new URL(value);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return String(value || '').slice(0, 200);
    }
};

const toErrorDetails = (error: unknown): Record<string, unknown> => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : null,
        };
    }
    return { message: String(error) };
};

const shouldInvalidateArtifactAfterImportError = (message: string): boolean => {
    const lowered = String(message || '').toLowerCase();
    if (!lowered) return false;
    return lowered.includes('invalid bank file')
        || lowered.includes('bank.json')
        || lowered.includes('corrupted')
        || lowered.includes('cannot decrypt')
        || lowered.includes('decrypt bank file')
        || lowered.includes('integrity check failed')
        || lowered.includes('no valid pads found');
};

export function useOnlineStoreDownloadTransfer({
    effectiveUser,
    requestLogin,
    transfers,
    setTransfers,
    downloadedArtifactsRef,
    pushDownloadDebugLog,
    showToast,
    onImportBankFromStore,
}: UseOnlineStoreDownloadTransferArgs) {
    const abortControllersRef = React.useRef<Record<string, AbortController>>({});

    const normalizeProgress = React.useCallback((value: unknown): number => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        const normalized = numeric <= 1 ? numeric * 100 : numeric;
        return Math.max(0, Math.min(100, Math.round(normalized)));
    }, []);

    const handleDownload = React.useCallback(async (item: StoreItem, options?: HandleDownloadOptions) => {
        if (!effectiveUser) {
            pushDownloadDebugLog('error', 'download_blocked_not_authenticated', {
                catalogItemId: item.id,
                bankId: item.bank_id,
                bankTitle: item.bank.title,
            });
            requestLogin();
            return;
        }

        if (transfers[item.id]?.phase === 'downloading' || transfers[item.id]?.phase === 'importing') {
            pushDownloadDebugLog('info', 'download_ignored_already_running', {
                catalogItemId: item.id,
                bankId: item.bank_id,
                phase: transfers[item.id]?.phase || null,
            });
            return;
        }

        const previousTransfer = transfers[item.id];
        const cachedArtifact = downloadedArtifactsRef.current[item.id];
        const canRetryImportWithoutRedownload = Boolean(
            options?.preferCachedImportRetry !== false
            && previousTransfer?.phase === 'error'
            && previousTransfer?.errorStage === 'import'
            && cachedArtifact?.blob,
        );

        let failedStage: TransferState['errorStage'] = 'download';
        const startedAt = Date.now();
        const operationId = `store-${item.id}-${startedAt.toString(36)}`;
        const heartbeatState = {
            phase: 'starting',
            progress: 0,
            bankId: item.bank_id,
            catalogItemId: item.id,
        };
        const stopHeartbeat = startOperationHeartbeat(
            { operationId, operation: 'bankstore_download' },
            {
                getDetails: () => ({
                    ...heartbeatState,
                    durationMs: Date.now() - startedAt,
                }),
            }
        );
        try {
            const controller = new AbortController();
            abortControllersRef.current[item.id] = controller;
            let blob: Blob | null = null;
            let fileName = `${item.bank.title}.bank`;
            let importedBankDerivedKey: string | null = null;
            let importedEntitlementToken: string | null = null;
            let importedEntitlementTokenKid: string | null = null;
            let importedEntitlementTokenIssuedAt: string | null = null;
            let importedEntitlementTokenExpiresAt: string | null = null;
            emitOperationDebug({
                operationId,
                operation: 'bankstore_download',
                phase: 'start',
                details: {
                    bankId: item.bank_id,
                    bankTitle: item.bank.title,
                    catalogItemId: item.id,
                    expectedSha256: (item.sha256 || '').trim().toLowerCase() || null,
                },
            });
            pushDownloadDebugLog('info', 'download_start', {
                catalogItemId: item.id,
                bankId: item.bank_id,
                bankTitle: item.bank.title,
                expectedSha256: (item.sha256 || '').trim().toLowerCase() || null,
                preferCachedImportRetry: options?.preferCachedImportRetry !== false,
            });

            if (canRetryImportWithoutRedownload && cachedArtifact) {
                failedStage = 'import';
                blob = cachedArtifact.blob;
                fileName = cachedArtifact.fileName || fileName;
                heartbeatState.phase = 'importing';
                pushDownloadDebugLog('info', 'download_use_cached_artifact_for_retry', {
                    catalogItemId: item.id,
                    bankId: item.bank_id,
                    cachedBytes: cachedArtifact.blob.size,
                    cachedAt: new Date(cachedArtifact.savedAt).toISOString(),
                });
                emitOperationDebug({
                    operationId,
                    operation: 'bankstore_download',
                    phase: 'stage',
                    details: {
                        stage: 'retry-import-from-cache',
                        bankId: item.bank_id,
                        catalogItemId: item.id,
                        cachedBytes: cachedArtifact.blob.size,
                    },
                });
                setTransfers(prev => ({
                    ...prev,
                    [item.id]: {
                        phase: 'importing',
                        progress: 0,
                        message: 'Retrying import...',
                        error: undefined,
                        errorStage: undefined,
                        startedAt,
                        updatedAt: startedAt,
                    }
                }));
            } else {
                heartbeatState.phase = 'downloading';
                setTransfers(prev => ({
                    ...prev,
                    [item.id]: {
                        phase: 'downloading',
                        progress: 0,
                        message: undefined,
                        error: undefined,
                        errorStage: undefined,
                        startedAt,
                        updatedAt: startedAt
                    }
                }));

                const { supabase } = await import('@/lib/supabase');
                const session = await supabase.auth.getSession();
                const token = session.data.session?.access_token;
                emitOperationDebug({
                    operationId,
                    operation: 'bankstore_download',
                    phase: 'stage',
                    details: {
                        stage: 'session-checked',
                        bankId: item.bank_id,
                        catalogItemId: item.id,
                        hasToken: Boolean(token),
                    },
                });
                pushDownloadDebugLog('info', 'download_session_checked', {
                    catalogItemId: item.id,
                    hasToken: Boolean(token),
                });

                if (!token) throw new Error('Please sign in to continue.');

                const downloadHeaders = { Authorization: `Bearer ${token}` };
                if (item.id) {
                    const keyTicketUrl = edgeFunctionUrl('store-api', `download-key/${item.id}`);
                    pushDownloadDebugLog('info', 'download_key_request', {
                        catalogItemId: item.id,
                        keyTicketUrl: sanitizeUrlForLog(keyTicketUrl),
                    });
                    try {
                        const keyRes = await fetch(keyTicketUrl, {
                            headers: downloadHeaders,
                            cache: 'no-store',
                            credentials: 'omit',
                            signal: controller.signal,
                        });
                        pushDownloadDebugLog('info', 'download_key_response', {
                            catalogItemId: item.id,
                            status: keyRes.status,
                            ok: keyRes.ok,
                            type: keyRes.type,
                            contentType: keyRes.headers.get('content-type') || null,
                        });
                        if (keyRes.ok) {
                            const keyPayload = await keyRes.json().catch(() => ({}));
                            const keyData = keyPayload?.data && typeof keyPayload.data === 'object'
                                ? keyPayload.data
                                : keyPayload;
                            const rawDerivedKey = typeof keyData?.derivedKey === 'string' ? keyData.derivedKey.trim() : '';
                            const rawEntitlementToken = typeof keyData?.entitlementToken === 'string'
                                ? keyData.entitlementToken.trim()
                                : '';
                            const entitlementTokenKid = typeof keyData?.entitlementTokenKeyId === 'string'
                                ? keyData.entitlementTokenKeyId.trim()
                                : '';
                            const entitlementTokenIssuedAt = typeof keyData?.entitlementTokenIssuedAt === 'string'
                                ? keyData.entitlementTokenIssuedAt.trim()
                                : '';
                            const entitlementTokenExpiresAt = typeof keyData?.entitlementTokenExpiresAt === 'string'
                                ? keyData.entitlementTokenExpiresAt.trim()
                                : '';
                            importedBankDerivedKey = rawDerivedKey || null;
                            importedEntitlementToken = rawEntitlementToken || null;
                            importedEntitlementTokenKid = entitlementTokenKid || null;
                            importedEntitlementTokenIssuedAt = entitlementTokenIssuedAt || null;
                            importedEntitlementTokenExpiresAt = entitlementTokenExpiresAt || null;
                            pushDownloadDebugLog('info', 'download_key_received', {
                                catalogItemId: item.id,
                                protected: Boolean(keyData?.protected),
                                hasDerivedKey: Boolean(importedBankDerivedKey),
                                hasEntitlementToken: Boolean(importedEntitlementToken),
                            });
                        } else {
                            const keyErrPayload = await keyRes.json().catch(() => ({}));
                            pushDownloadDebugLog('error', 'download_key_failed', {
                                catalogItemId: item.id,
                                status: keyRes.status,
                                error: String(keyErrPayload?.error || 'download key request failed'),
                            });
                        }
                    } catch (keyError) {
                        pushDownloadDebugLog('error', 'download_key_fetch_error', {
                            catalogItemId: item.id,
                            ...toErrorDetails(keyError),
                        });
                    }
                }

                const downloadTransport = isNativeBankImportAvailable()
                    ? 'native'
                    : (isElectronImportBridgeAvailable() ? 'electron' : 'signed_url');
                const ticketUrl = edgeFunctionUrl('store-api', `download/${item.id}?transport=${downloadTransport}`);
                emitOperationDebug({
                    operationId,
                    operation: 'bankstore_download',
                    phase: 'stage',
                    details: {
                        stage: 'download-ticket-request',
                        bankId: item.bank_id,
                        catalogItemId: item.id,
                        transport: downloadTransport,
                    },
                });
                pushDownloadDebugLog('info', 'download_ticket_request', {
                    catalogItemId: item.id,
                    transport: downloadTransport,
                    ticketUrl: sanitizeUrlForLog(ticketUrl),
                });
                const ticketRes = await fetch(
                    ticketUrl,
                    { headers: downloadHeaders, cache: 'no-store', credentials: 'omit', signal: controller.signal }
                );
                pushDownloadDebugLog('info', 'download_ticket_response', {
                    catalogItemId: item.id,
                    status: ticketRes.status,
                    ok: ticketRes.ok,
                    type: ticketRes.type,
                    contentType: ticketRes.headers.get('content-type') || null,
                });
                if (!ticketRes.ok) {
                    const errType = await ticketRes.json().catch(() => ({}));
                    const message = errType?.error || 'Download failed';
                    pushDownloadDebugLog('error', 'download_ticket_failed', {
                        catalogItemId: item.id,
                        status: ticketRes.status,
                        error: message,
                    });
                    throw new Error(message);
                }
                const ticketPayload = await ticketRes.json().catch(() => ({}));
                const signedDownloadUrl = typeof ticketPayload?.downloadUrl === 'string'
                    ? ticketPayload.downloadUrl
                    : (typeof ticketPayload?.data?.downloadUrl === 'string' ? ticketPayload.data.downloadUrl : '');
                if (!signedDownloadUrl) throw new Error('Signed download URL missing');
                pushDownloadDebugLog('info', 'download_signed_url_received', {
                    catalogItemId: item.id,
                    signedUrl: sanitizeUrlForLog(signedDownloadUrl),
                    urlExpiresAt: String(ticketPayload?.urlExpiresAt || ticketPayload?.data?.urlExpiresAt || ''),
                });

                if (isNativeBankImportAvailable() || isElectronImportBridgeAvailable()) {
                    failedStage = 'import';
                    heartbeatState.phase = 'importing';
                    heartbeatState.progress = 6;
                    setTransfers(prev => ({
                        ...prev,
                        [item.id]: {
                            ...prev[item.id],
                            phase: 'importing',
                            progress: 6,
                            message: 'Importing on device...',
                            error: undefined,
                            errorStage: undefined,
                            updatedAt: Date.now()
                        }
                    }));

                    await onImportBankFromStore(
                        isNativeBankImportAvailable()
                          ? {
                              kind: 'android-store',
                              signedUrl: signedDownloadUrl,
                              bankId: item.bank_id,
                              catalogItemId: item.id,
                              fileName,
                              expectedSha256: item.sha256 || undefined,
                            }
                          : {
                              kind: 'electron-store',
                              signedUrl: signedDownloadUrl,
                              bankId: item.bank_id,
                              catalogItemId: item.id,
                              fileName,
                              expectedSha256: item.sha256 || undefined,
                            },
                        {
                            bankId: item.bank_id,
                            bankName: item.bank.title,
                            catalogItemId: item.id,
                            targetBankId: item.snapshot_target_bank_id || undefined,
                            refreshAssetsOnly: options?.refreshAssetsOnly === true,
                            catalogSha256: item.sha256 || undefined,
                            thumbnailUrl: item.thumbnail_path || undefined,
                            derivedKey: importedBankDerivedKey || undefined,
                            entitlementToken: importedEntitlementToken || undefined,
                            entitlementTokenKid: importedEntitlementTokenKid || undefined,
                            entitlementTokenIssuedAt: importedEntitlementTokenIssuedAt || undefined,
                            entitlementTokenExpiresAt: importedEntitlementTokenExpiresAt || undefined,
                        },
                        (progress) => {
                            const normalized = normalizeProgress(progress);
                            heartbeatState.phase = 'importing';
                            heartbeatState.progress = normalized;
                            setTransfers(prev => ({
                                ...prev,
                                [item.id]: {
                                    ...prev[item.id],
                                    phase: 'importing',
                                    progress: normalized,
                                    updatedAt: Date.now()
                                }
                            }));
                        }
                    );

                    blob = new Blob([], { type: 'application/octet-stream' });
                } else {

                const res = await fetch(signedDownloadUrl, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
                pushDownloadDebugLog('info', 'download_asset_response', {
                    catalogItemId: item.id,
                    status: res.status,
                    ok: res.ok,
                    type: res.type,
                    contentType: res.headers.get('content-type') || null,
                    contentLength: res.headers.get('content-length') || null,
                });
                if (!res.ok) throw new Error('Download failed');

                const contentLength = res.headers.get('content-length');
                const total = contentLength ? parseInt(contentLength, 10) : 0;
                let loaded = 0;

                if (!res.body) throw new Error('ReadableStream not supported');
                const reader = res.body.getReader();
                const chunks: Uint8Array[] = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    if (total > 0) {
                        const progress = Math.min(100, Math.round((loaded / total) * 100));
                        heartbeatState.progress = progress;
                        setTransfers(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], phase: 'downloading', progress, updatedAt: Date.now() }
                        }));
                    }
                }
                pushDownloadDebugLog('info', 'download_stream_complete', {
                    catalogItemId: item.id,
                    loadedBytes: loaded,
                    totalBytes: total > 0 ? total : null,
                    chunkCount: chunks.length,
                });
                emitOperationDebug({
                    operationId,
                    operation: 'bankstore_download',
                    phase: 'stage',
                    details: {
                        stage: 'download-stream-complete',
                        bankId: item.bank_id,
                        catalogItemId: item.id,
                        loadedBytes: loaded,
                        totalBytes: total > 0 ? total : null,
                    },
                });

                const downloadedBlob = new Blob(chunks, { type: 'application/octet-stream' });

                failedStage = 'checksum';
                const expectedSha = (item.sha256 || '').trim().toLowerCase();
                if (expectedSha) {
                    const actualSha = await sha256HexFromBlob(downloadedBlob);
                    if (actualSha !== expectedSha) {
                        pushDownloadDebugLog('error', 'download_checksum_failed', {
                            catalogItemId: item.id,
                            expectedSha256: expectedSha,
                            actualSha256: actualSha,
                        });
                        throw new Error('Integrity check failed');
                    }
                    pushDownloadDebugLog('info', 'download_checksum_ok', {
                        catalogItemId: item.id,
                        sha256: expectedSha,
                    });
                }

                blob = downloadedBlob;
                downloadedArtifactsRef.current[item.id] = {
                    blob: downloadedBlob,
                    fileName,
                    savedAt: Date.now(),
                    sha256: expectedSha || null,
                };
                failedStage = 'import';
                heartbeatState.phase = 'importing';
                heartbeatState.progress = 0;
                setTransfers(prev => ({
                    ...prev,
                    [item.id]: {
                        ...prev[item.id],
                        phase: 'importing',
                        progress: 0,
                        message: undefined,
                        error: undefined,
                        errorStage: undefined,
                        updatedAt: Date.now()
                    }
                }));
                }
            }

            if (!blob) throw new Error('Downloaded file is empty');
            emitOperationDebug({
                operationId,
                operation: 'bankstore_download',
                phase: 'stage',
                details: {
                    stage: 'import-start',
                    bankId: item.bank_id,
                    catalogItemId: item.id,
                    blobBytes: blob.size,
                },
            });
            pushDownloadDebugLog('info', 'download_import_start', {
                catalogItemId: item.id,
                bankId: item.bank_id,
                blobBytes: blob.size,
                fileName,
                hasPreferredDerivedKey: Boolean(importedBankDerivedKey),
                hasEntitlementToken: Boolean(importedEntitlementToken),
            });
            if (blob.size > 0) {
                const file = new File([blob], fileName, { type: 'application/octet-stream' });

                await onImportBankFromStore(
                    file,
                    {
                        bankId: item.bank_id,
                        bankName: item.bank.title,
                        catalogItemId: item.id,
                        targetBankId: item.snapshot_target_bank_id || undefined,
                        refreshAssetsOnly: options?.refreshAssetsOnly === true,
                        catalogSha256: item.sha256 || undefined,
                        thumbnailUrl: item.thumbnail_path || undefined,
                        derivedKey: importedBankDerivedKey || undefined,
                        entitlementToken: importedEntitlementToken || undefined,
                        entitlementTokenKid: importedEntitlementTokenKid || undefined,
                        entitlementTokenIssuedAt: importedEntitlementTokenIssuedAt || undefined,
                        entitlementTokenExpiresAt: importedEntitlementTokenExpiresAt || undefined,
                    },
                    (progress) => {
                        heartbeatState.phase = 'importing';
                        heartbeatState.progress = normalizeProgress(progress);
                        setTransfers(prev => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], phase: 'importing', progress: normalizeProgress(progress), updatedAt: Date.now() }
                        }));
                    }
                );
            }

            setTransfers(prev => ({
                ...prev,
                [item.id]: {
                    ...prev[item.id],
                    phase: 'success',
                    progress: 100,
                    message: undefined,
                    error: undefined,
                    errorStage: undefined,
                    updatedAt: Date.now()
                }
            }));
            delete downloadedArtifactsRef.current[item.id];
            emitOperationDebug({
                operationId,
                operation: 'bankstore_download',
                phase: 'finish',
                details: {
                    bankId: item.bank_id,
                    catalogItemId: item.id,
                    durationMs: Date.now() - startedAt,
                },
            });
            pushDownloadDebugLog('info', 'download_import_success', {
                catalogItemId: item.id,
                bankId: item.bank_id,
                durationMs: Date.now() - startedAt,
            });
            stopHeartbeat();

        } catch (err: any) {
            if (err?.name === 'AbortError') {
                emitOperationDebug({
                    operationId,
                    operation: 'bankstore_download',
                    phase: 'error',
                    level: 'error',
                    details: {
                        bankId: item.bank_id,
                        catalogItemId: item.id,
                        failedStage,
                        message: 'Download aborted',
                    },
                });
                pushDownloadDebugLog('info', 'download_cancelled', {
                    catalogItemId: item.id,
                    bankId: item.bank_id,
                    failedStage,
                });
                delete downloadedArtifactsRef.current[item.id];
                setTransfers(prev => {
                    const next = { ...prev };
                    delete next[item.id];
                    return next;
                });
                showToast('Download cancelled.', 'success');
                stopHeartbeat();
                return;
            }
            const errorMessage = err?.message || 'Download failed';
            emitOperationDebug({
                operationId,
                operation: 'bankstore_download',
                phase: 'error',
                level: 'error',
                details: {
                    bankId: item.bank_id,
                    catalogItemId: item.id,
                    failedStage,
                    message: errorMessage,
                },
            });
            pushDownloadDebugLog('error', 'download_failed', {
                catalogItemId: item.id,
                bankId: item.bank_id,
                failedStage,
                errorMessage,
                ...toErrorDetails(err),
            });
            if (failedStage !== 'import' || shouldInvalidateArtifactAfterImportError(errorMessage)) {
                delete downloadedArtifactsRef.current[item.id];
            }
            setTransfers(prev => ({
                ...prev,
                [item.id]: {
                    ...prev[item.id],
                    phase: 'error',
                    progress: 0,
                    error: errorMessage,
                    errorStage: failedStage,
                    updatedAt: Date.now()
                }
            }));
            if (failedStage === 'import') {
                showToast('Import failed. Tap Try Again to retry import.', 'error');
            } else if (failedStage === 'checksum') {
                showToast('Downloaded file failed integrity check. Re-download required.', 'error');
            } else {
                showToast('Download failed. Please try again.', 'error');
            }
            stopHeartbeat();
        }
        finally {
            delete abortControllersRef.current[item.id];
        }
    }, [
        effectiveUser,
        onImportBankFromStore,
        pushDownloadDebugLog,
        requestLogin,
        setTransfers,
        showToast,
        transfers,
        downloadedArtifactsRef,
        normalizeProgress,
    ]);

    const cancelDownload = React.useCallback((itemId: string) => {
        const controller = abortControllersRef.current[itemId];
        if (!controller) return;
        controller.abort();
    }, []);

    React.useEffect(() => {
        return () => {
            Object.values(abortControllersRef.current).forEach((controller) => controller.abort());
            abortControllersRef.current = {};
        };
    }, []);

    return {
        normalizeProgress,
        handleDownload,
        cancelDownload,
    };
}
