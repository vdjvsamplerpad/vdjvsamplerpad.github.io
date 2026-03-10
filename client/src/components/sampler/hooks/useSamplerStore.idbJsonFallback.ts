import { getBlobFromDB, saveBlobToDB } from './useSamplerStore.idbStorage';

export const readIdbJsonFallback = async (id: string): Promise<string | null> => {
  try {
    const blob = await getBlobFromDB(id);
    if (!blob) return null;
    return await blob.text();
  } catch {
    return null;
  }
};

export const writeIdbJsonFallback = async (id: string, value: string): Promise<void> => {
  try {
    const blob = new Blob([value], { type: 'application/json' });
    await saveBlobToDB(id, blob, false);
  } catch {
  }
};

