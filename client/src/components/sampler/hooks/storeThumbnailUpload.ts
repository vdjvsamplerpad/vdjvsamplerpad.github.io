import { prepareManagedImageUpload } from '@/lib/image-upload';
import { uploadManagedStoreAsset } from '@/lib/store-asset-upload';

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
  const uploaded = await uploadManagedStoreAsset(preparedFile, {
    kind: 'thumbnail',
    bankId: input.bankId,
  });

  return {
    url: uploaded.url,
    uploaded: true,
    cleanup: uploaded.cleanup,
  };
};
