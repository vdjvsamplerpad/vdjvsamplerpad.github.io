export const readLastOpenBankIdFromCache = (
  cacheKey: string,
  ownerId: string | null
): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { byOwner?: Record<string, string | null>; guest?: string | null };
    if (ownerId) {
      const byOwner = parsed?.byOwner || {};
      const value = byOwner[ownerId];
      return typeof value === 'string' && value.trim() ? value : null;
    }
    const guest = parsed?.guest;
    return typeof guest === 'string' && guest.trim() ? guest : null;
  } catch {
    return null;
  }
};

export const writeLastOpenBankIdToCache = (
  cacheKey: string,
  ownerId: string | null,
  bankId: string | null
): void => {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(cacheKey);
    const parsed = raw ? (JSON.parse(raw) as { byOwner?: Record<string, string | null>; guest?: string | null }) : {};
    const byOwner = { ...(parsed.byOwner || {}) };
    if (ownerId) {
      byOwner[ownerId] = bankId || null;
    } else {
      parsed.guest = bankId || null;
    }
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        ...parsed,
        byOwner,
      })
    );
  } catch {
    // best effort only
  }
};

