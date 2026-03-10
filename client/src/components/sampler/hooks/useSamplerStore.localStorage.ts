export const getLocalStorageItemSafe = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
};

export const setLocalStorageItemSafe = (key: string, value: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_error) {
    return false;
  }
};

