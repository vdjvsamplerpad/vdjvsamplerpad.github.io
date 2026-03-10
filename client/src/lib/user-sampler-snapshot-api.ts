import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';
import type { SamplerMetadataSnapshot } from '@/components/sampler/hooks/useSamplerStore.snapshotMetadata';

type SnapshotEnvelope = {
  ok?: boolean;
  data?: {
    snapshot?: SamplerMetadataSnapshot | null;
    savedAt?: string | null;
  };
  snapshot?: SamplerMetadataSnapshot | null;
  savedAt?: string | null;
  error?: string;
};

const parseSnapshotPayload = (payload: SnapshotEnvelope): { snapshot: SamplerMetadataSnapshot | null; savedAt: string | null } => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    snapshot: (data?.snapshot || null) as SamplerMetadataSnapshot | null,
    savedAt: typeof data?.savedAt === 'string' ? data.savedAt : null,
  };
};

export const saveUserSamplerMetadataSnapshot = async (snapshot: SamplerMetadataSnapshot): Promise<{ savedAt: string | null }> => {
  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('user-export-api', 'save-sampler-snapshot'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ snapshot }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Sampler snapshot save failed (${response.status})`);
  }
  const parsed = parseSnapshotPayload(payload as SnapshotEnvelope);
  return { savedAt: parsed.savedAt };
};

export const getLatestUserSamplerMetadataSnapshot = async (): Promise<{ snapshot: SamplerMetadataSnapshot | null; savedAt: string | null }> => {
  const headers = await getAuthHeaders(true);
  const response = await fetch(edgeFunctionUrl('user-export-api', 'latest-sampler-snapshot'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Sampler snapshot read failed (${response.status})`);
  }
  return parseSnapshotPayload(payload as SnapshotEnvelope);
};
