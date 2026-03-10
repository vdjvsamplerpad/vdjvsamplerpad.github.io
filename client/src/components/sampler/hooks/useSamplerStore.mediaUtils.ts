export const normalizeBase64Data = (raw: string): string => {
  const commaIndex = raw.indexOf(',');
  if (commaIndex >= 0) return raw.slice(commaIndex + 1);
  return raw;
};

export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        resolve(normalizeBase64Data(String(reader.result || '')));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export const extFromMime = (mime: string, type: 'audio' | 'image'): string => {
  const lower = (mime || '').toLowerCase();
  if (type === 'audio') {
    if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
    if (lower.includes('wav')) return 'wav';
    if (lower.includes('ogg')) return 'ogg';
    if (lower.includes('aac')) return 'aac';
    if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a';
    return 'bin';
  }
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'bin';
};

export const mimeFromExt = (ext: string, type: 'audio' | 'image'): string => {
  const lower = ext.toLowerCase();
  if (type === 'audio') {
    if (lower === 'mp3') return 'audio/mpeg';
    if (lower === 'wav') return 'audio/wav';
    if (lower === 'ogg') return 'audio/ogg';
    if (lower === 'aac') return 'audio/aac';
    if (lower === 'm4a') return 'audio/mp4';
    return 'application/octet-stream';
  }
  if (lower === 'png') return 'image/png';
  if (lower === 'jpg' || lower === 'jpeg') return 'image/jpeg';
  if (lower === 'webp') return 'image/webp';
  if (lower === 'gif') return 'image/gif';
  return 'application/octet-stream';
};

export const inferImageExtFromPath = (pathOrUrl: string): string => {
  const fallback = 'jpg';
  if (!pathOrUrl) return fallback;
  let target = pathOrUrl;
  try {
    target = new URL(pathOrUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').pathname;
  } catch {
    target = pathOrUrl;
  }
  const match = target.match(/\.([a-zA-Z0-9]{2,5})(?:$|[?#])/);
  const rawExt = match?.[1]?.toLowerCase() || '';
  if (rawExt === 'jpeg') return 'jpg';
  if (rawExt === 'jpg' || rawExt === 'png' || rawExt === 'webp' || rawExt === 'gif') return rawExt;
  return fallback;
};

export const parseStorageKeyExt = (storageKey: string): string => {
  const idx = storageKey.lastIndexOf('.');
  if (idx < 0) return 'bin';
  return storageKey.slice(idx + 1);
};
