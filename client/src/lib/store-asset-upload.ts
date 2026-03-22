import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export type ManagedStoreAssetKind = 'thumbnail' | 'qr' | 'banner';

type UploadPayload = {
  kind: ManagedStoreAssetKind;
  fileName: string;
  fileSize: number;
  contentType: string;
  bankId?: string | null;
};

type UploadResponse = {
  uploadUrl: string;
  uploadMethod?: string;
  uploadHeaders?: Record<string, string>;
  assetUrl: string;
  objectKey: string;
};

const parseJson = async (response: Response): Promise<any> => {
  return await response.json().catch(() => ({}));
};

const getErrorMessage = (payload: any, fallback: string): string => {
  return String(payload?.error || payload?.data?.error || fallback);
};

export const uploadManagedStoreAsset = async (
  file: File,
  input: { kind: ManagedStoreAssetKind; bankId?: string | null },
): Promise<{ url: string; objectKey: string; cleanup: () => Promise<void> }> => {
  const headers = await getAuthHeaders(true);
  const payload: UploadPayload = {
    kind: input.kind,
    fileName: file.name || `${input.kind}.bin`,
    fileSize: file.size,
    contentType: file.type || 'application/octet-stream',
    bankId: input.bankId || null,
  };
  const startResponse = await fetch(edgeFunctionUrl('store-api', 'admin/store/assets/upload'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const startPayload = await parseJson(startResponse);
  if (!startResponse.ok || startPayload?.ok === false) {
    throw new Error(getErrorMessage(startPayload, 'Store asset upload could not be started.'));
  }
  const data: UploadResponse = startPayload?.data && typeof startPayload.data === 'object'
    ? startPayload.data as UploadResponse
    : startPayload as UploadResponse;
  if (!data?.uploadUrl || !data?.assetUrl || !data?.objectKey) {
    throw new Error('Store asset upload response is incomplete.');
  }

  const uploadHeaders = new Headers(data.uploadHeaders || {});
  if (!uploadHeaders.has('Content-Type') && file.type) {
    uploadHeaders.set('Content-Type', file.type);
  }
  const uploadMethod = String(data.uploadMethod || 'PUT').toUpperCase();
  const uploadResponse = await fetch(data.uploadUrl, {
    method: uploadMethod,
    headers: uploadHeaders,
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Store asset upload failed (${uploadResponse.status}).`);
  }

  const cleanup = async () => {
    const cleanupHeaders = await getAuthHeaders(true);
    const response = await fetch(edgeFunctionUrl('store-api', 'admin/store/assets/delete'), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        ...cleanupHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ objectKey: data.objectKey }),
    });
    if (!response.ok) {
      const cleanupPayload = await parseJson(response);
      throw new Error(getErrorMessage(cleanupPayload, 'Store asset cleanup failed.'));
    }
  };

  return {
    url: data.assetUrl,
    objectKey: data.objectKey,
    cleanup,
  };
};
