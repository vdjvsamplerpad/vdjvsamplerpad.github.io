import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export interface PrepareUserExportUploadResult {
  mode?: 'r2_direct' | string;
  exportOperationId: string;
  uploadMethod?: 'PUT' | string;
  uploadHeaders?: Record<string, string> | null;
  bucket?: string | null;
  objectKey?: string | null;
  urlExpiresAt?: string | null;
  releaseTag?: string | null;
  releaseId?: number | null;
  assetName?: string | null;
  fileSha256?: string | null;
  skipUpload?: boolean;
  skipReason?: string | null;
  duplicateOfExportOperationId?: string | null;
  sessionId?: string | null;
  uploadUrl?: string | null;
}

interface StartAdminCatalogUploadPublishResult {
  mode?: 'r2_direct' | string;
  sessionId?: string | null;
  uploadUrl?: string | null;
  uploadMethod?: 'PUT' | string;
  uploadHeaders?: Record<string, string> | null;
  bucket?: string | null;
  objectKey?: string | null;
  urlExpiresAt?: string | null;
  releaseTag?: string | null;
  releaseId?: number | null;
  assetName?: string | null;
  fileSize?: number | null;
  assetProtection?: 'encrypted' | 'public';
}

interface StartDefaultBankReleaseUploadResult {
  mode?: 'r2_direct' | string;
  sessionId?: string | null;
  version?: number | null;
  uploadUrl?: string | null;
  uploadMethod?: 'PUT' | string;
  uploadHeaders?: Record<string, string> | null;
  bucket?: string | null;
  objectKey?: string | null;
  urlExpiresAt?: string | null;
  assetName?: string | null;
  fileSize?: number | null;
}

export interface AdminCatalogUploadPublishResult {
  releaseTag?: string | null;
  assetName: string;
  fileSize: number;
}

export interface DefaultBankReleaseUploadResult {
  version: number;
  assetName: string;
  fileSize: number;
  release: Record<string, unknown>;
}

export const invokeUserExportApi = async <T,>(route: string, body: Record<string, unknown>): Promise<T> => {
  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('user-export-api', route), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    if (response.status === 410 || String(payload?.error || '') === 'UPLOAD_RELAY_REMOVED') {
      throw new Error('Please update app to continue upload.');
    }
    throw new Error(payload?.error || `User export API failed (${response.status})`);
  }
  return payload as T;
};

export const isNonRetryableGithubUploadError = (error: unknown): boolean => {
  const message = String(error instanceof Error ? error.message : error || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('upload_relay_removed') ||
    message.includes('please update app to continue upload') ||
    message.includes('session_expired') ||
    message.includes('session_already_used')
  );
};

export const coerceUploadHeaders = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    out[key] = raw;
  }
  return out;
};

const uploadDirectAsset = async (input: {
  uploadUrl: string;
  uploadMethod?: string | null;
  uploadHeaders?: Record<string, string> | null;
  exportBlob: Blob;
}): Promise<{ etag: string | null; fileSize: number }> => {
  const method = String(input.uploadMethod || 'PUT').toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(input.uploadHeaders || {})) {
    headers.set(key, value);
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  const response = await fetch(input.uploadUrl, {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers,
    body: input.exportBlob,
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Direct upload failed (${response.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`);
  }
  return {
    etag: response.headers.get('etag'),
    fileSize: input.exportBlob.size,
  };
};

export const uploadUserExportAsset = async (input: {
  exportOperationId: string;
  sessionId: string;
  uploadUrl: string;
  uploadMethod?: string | null;
  uploadHeaders?: Record<string, string> | null;
  bucket?: string | null;
  objectKey?: string | null;
  releaseTag: string;
  releaseId: number;
  assetName: string;
  exportBlob: Blob;
}): Promise<{ releaseTag: string; releaseId: number; assetName: string; fileSize: number; etag: string | null }> => {
  const direct = await uploadDirectAsset({
    uploadUrl: input.uploadUrl,
    uploadMethod: input.uploadMethod,
    uploadHeaders: input.uploadHeaders,
    exportBlob: input.exportBlob,
  });
  return {
    releaseTag: input.releaseTag,
    releaseId: input.releaseId,
    assetName: input.assetName,
    fileSize: direct.fileSize,
    etag: direct.etag,
  };
};

export const uploadAdminCatalogAsset = async (input: {
  catalogItemId: string;
  operationType?: 'create' | 'update';
  assetName: string;
  exportBlob: Blob;
  assetProtection: 'encrypted' | 'public';
}): Promise<AdminCatalogUploadPublishResult> => {
  const headers = await getAuthHeaders(true);
  const startResponse = await fetch(edgeFunctionUrl('admin-api', `store/catalog/${input.catalogItemId}/start-upload-publish`), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assetName: input.assetName,
      fileSize: input.exportBlob.size,
      assetProtection: input.assetProtection,
      operationType: input.operationType || 'create',
    }),
  });
  const startPayload = await startResponse.json().catch(() => ({} as StartAdminCatalogUploadPublishResult & { ok?: boolean; error?: string }));
  if (!startResponse.ok || startPayload?.ok === false) {
    if (startResponse.status === 410 || String(startPayload?.error || '') === 'UPLOAD_RELAY_REMOVED') {
      throw new Error('Please update app to continue upload.');
    }
    throw new Error(startPayload?.error || `Admin catalog upload failed (${startResponse.status})`);
  }
  const startData = startPayload?.data && typeof startPayload.data === 'object'
    ? startPayload.data as StartAdminCatalogUploadPublishResult
    : startPayload;
  const uploadUrl = typeof startData?.uploadUrl === 'string' ? startData.uploadUrl : '';
  const uploadMethod = typeof startData?.uploadMethod === 'string' ? startData.uploadMethod : 'PUT';
  const uploadHeaders = coerceUploadHeaders(startData?.uploadHeaders);
  const sessionId = typeof startData?.sessionId === 'string' ? startData.sessionId : '';
  const bucket = typeof startData?.bucket === 'string' ? startData.bucket : '';
  const objectKey = typeof startData?.objectKey === 'string' ? startData.objectKey : '';
  const expectedAssetName = typeof startData?.assetName === 'string' ? startData.assetName : input.assetName;
  if (!uploadUrl || !sessionId || !bucket || !objectKey) {
    throw new Error('Invalid start-upload-publish response');
  }

  let directUploadEtag: string | null = null;
  try {
    const upload = await uploadDirectAsset({
      uploadUrl,
      uploadMethod,
      uploadHeaders,
      exportBlob: input.exportBlob,
    });
    directUploadEtag = upload.etag;
  } catch (uploadError) {
    await fetch(edgeFunctionUrl('admin-api', `store/catalog/${input.catalogItemId}/complete-upload-publish`), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        status: 'failed',
        failureReason: uploadError instanceof Error ? uploadError.message : String(uploadError),
        etag: directUploadEtag,
      }),
    }).catch(() => undefined);
    throw uploadError;
  }

  const completeResponse = await fetch(edgeFunctionUrl('admin-api', `store/catalog/${input.catalogItemId}/complete-upload-publish`), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      status: 'success',
      etag: directUploadEtag,
    }),
  });
  const completePayload = await completeResponse.json().catch(() => ({} as { ok?: boolean; error?: string; data?: unknown }));
  if (!completeResponse.ok || completePayload?.ok === false) {
    throw new Error(completePayload?.error || `Admin catalog complete upload failed (${completeResponse.status})`);
  }
  const data = completePayload?.data && typeof completePayload.data === 'object'
    ? completePayload.data as Record<string, unknown>
    : completePayload as Record<string, unknown>;
  return {
    releaseTag: null,
    assetName: typeof data?.assetName === 'string' ? data.assetName : expectedAssetName,
    fileSize: Number(data?.fileSize || input.exportBlob.size),
  };
};

export const patchAdminCatalogItem = async (input: {
  catalogItemId: string;
  updates: Record<string, unknown>;
}): Promise<Record<string, unknown>> => {
  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('store-api', `admin/store/catalog/${input.catalogItemId}`), {
    method: 'PATCH',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.updates),
  });
  const payload = await response.json().catch(() => ({} as { ok?: boolean; error?: string; data?: unknown }));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Catalog patch failed (${response.status})`);
  }
  return (payload?.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>;
};

export const uploadDefaultBankReleaseArchive = async (input: {
  sourceBankRuntimeId?: string | null;
  sourceBankTitle: string;
  sourceBankPadCount: number;
  assetName: string;
  exportBlob: Blob;
  fileSha256?: string | null;
  releaseNotes?: string | null;
  minAppVersion?: string | null;
}): Promise<DefaultBankReleaseUploadResult> => {
  const headers = await getAuthHeaders(true);
  const startResponse = await fetch(edgeFunctionUrl('admin-api', 'default-bank/start-upload'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceBankRuntimeId: input.sourceBankRuntimeId || null,
      sourceBankTitle: input.sourceBankTitle,
      sourceBankPadCount: input.sourceBankPadCount,
      assetName: input.assetName,
      fileSize: input.exportBlob.size,
      fileSha256: input.fileSha256 || null,
      releaseNotes: input.releaseNotes || null,
      minAppVersion: input.minAppVersion || null,
    }),
  });
  const startPayload = await startResponse.json().catch(() => ({} as StartDefaultBankReleaseUploadResult & { ok?: boolean; error?: string }));
  if (!startResponse.ok || startPayload?.ok === false) {
    throw new Error(startPayload?.error || `Default bank upload failed (${startResponse.status})`);
  }
  const startData = startPayload?.data && typeof startPayload.data === 'object'
    ? startPayload.data as StartDefaultBankReleaseUploadResult
    : startPayload;
  const uploadUrl = typeof startData?.uploadUrl === 'string' ? startData.uploadUrl : '';
  const uploadMethod = typeof startData?.uploadMethod === 'string' ? startData.uploadMethod : 'PUT';
  const uploadHeaders = coerceUploadHeaders(startData?.uploadHeaders);
  const sessionId = typeof startData?.sessionId === 'string' ? startData.sessionId : '';
  const version = Number(startData?.version || 0);
  const expectedAssetName = typeof startData?.assetName === 'string' ? startData.assetName : input.assetName;
  if (!uploadUrl || !sessionId || !version) {
    throw new Error('Invalid default bank upload session response');
  }

  let directUploadEtag: string | null = null;
  try {
    const upload = await uploadDirectAsset({
      uploadUrl,
      uploadMethod,
      uploadHeaders,
      exportBlob: input.exportBlob,
    });
    directUploadEtag = upload.etag;
  } catch (uploadError) {
    await fetch(edgeFunctionUrl('admin-api', 'default-bank/complete-upload'), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        status: 'failed',
        failureReason: uploadError instanceof Error ? uploadError.message : String(uploadError),
        etag: directUploadEtag,
      }),
    }).catch(() => undefined);
    throw uploadError;
  }

  const completeResponse = await fetch(edgeFunctionUrl('admin-api', 'default-bank/complete-upload'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      status: 'success',
      etag: directUploadEtag,
    }),
  });
  const completePayload = await completeResponse.json().catch(() => ({} as { ok?: boolean; error?: string; data?: unknown }));
  if (!completeResponse.ok || completePayload?.ok === false) {
    throw new Error(completePayload?.error || `Default bank complete upload failed (${completeResponse.status})`);
  }
  const data = completePayload?.data && typeof completePayload.data === 'object'
    ? completePayload.data as Record<string, unknown>
    : completePayload as Record<string, unknown>;
  return {
    version,
    assetName: typeof data?.assetName === 'string' ? data.assetName : expectedAssetName,
    fileSize: Number(data?.fileSize || input.exportBlob.size),
    release: (data?.release && typeof data.release === 'object') ? data.release as Record<string, unknown> : {},
  };
};
