import { prepareManagedImageUpload } from '@/lib/image-upload';

type EnsureManagedStoreThumbnailInput = {
  bankId: string;
  thumbnailPath: string;
  inferImageExtFromPath: (value: string | undefined) => string;
};

type EnsureManagedStoreThumbnailResult = {
  url: string;
  uploaded: boolean;
  cleanup: () => Promise<void>;
};

const isHttpUrl = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const getObjectPathFromPublicUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const marker = '/storage/v1/object/public/store-assets/';
    if (!parsed.pathname.includes(marker)) return null;
    return decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length)).replace(/^\/+/, '');
  } catch {
    return null;
  }
};

export const ensureManagedStoreThumbnail = async (
  input: EnsureManagedStoreThumbnailInput,
): Promise<EnsureManagedStoreThumbnailResult> => {
  const normalizedPath = input.thumbnailPath.trim();
  if (!normalizedPath) {
    throw new Error('Thumbnail path is empty.');
  }

  if (isHttpUrl(normalizedPath)) {
    return {
      url: normalizedPath,
      uploaded: false,
      cleanup: async () => undefined,
    };
  }

  const response = await fetch(normalizedPath, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Thumbnail fetch failed (${response.status}).`);
  }

  const sourceBlob = await response.blob();
  if (sourceBlob.size <= 0) {
    throw new Error('Thumbnail file was empty.');
  }

  const hintedExt = input.inferImageExtFromPath(normalizedPath);
  const sourceExt = hintedExt && hintedExt !== 'bin' ? hintedExt : 'webp';
  const sourceFile = new File([sourceBlob], `bank-thumbnail.${sourceExt}`, {
    type: sourceBlob.type || 'image/webp',
  });
  const preparedFile = await prepareManagedImageUpload(sourceFile, 'thumbnail');
  const ext = (preparedFile.name.split('.').pop() || sourceExt || 'webp').toLowerCase();
  const suffix = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  const objectPath = `bank-thumbnails/${input.bankId}/${Date.now()}-${suffix}.${ext}`;

  const { supabase } = await import('@/lib/supabase');
  const upload = await supabase.storage
    .from('store-assets')
    .upload(objectPath, preparedFile, { upsert: false, cacheControl: '3600' });
  if (upload.error) {
    const uploadError = upload.error as Error | { message?: unknown };
    throw uploadError instanceof Error
      ? uploadError
      : new Error(String(uploadError.message || 'Thumbnail upload failed.'));
  }

  const { data: { publicUrl } } = supabase.storage.from('store-assets').getPublicUrl(objectPath);

  return {
    url: publicUrl,
    uploaded: true,
    cleanup: async () => {
      const cleanupPath = getObjectPathFromPublicUrl(publicUrl);
      if (!cleanupPath) return;
      await supabase.storage.from('store-assets').remove([cleanupPath]).catch(() => undefined);
    },
  };
};
