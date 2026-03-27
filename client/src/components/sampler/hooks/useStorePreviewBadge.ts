import * as React from 'react';
import { fetchStorePreviewBanks, useGuestStorePreviewBanks, type GuestStorePreviewBank } from './useGuestStorePreviewBanks';

const STORE_PREVIEW_SEEN_KEY_PREFIX = 'vdjv-store-preview-seen-v1:';
const STORE_PREVIEW_SEEN_EVENT = 'vdjv-store-preview-seen-changed';

const buildStorePreviewSignature = (items: GuestStorePreviewBank[]): string => (
  items
    .slice(0, 10)
    .map((item) => `${item.bankId}:${item.catalogItemId}:${item.order}`)
    .join('|')
);

export function useStorePreviewBadge(input: {
  effectiveUser: { id?: string | null } | null;
  profileId?: string | null;
}) {
  const { effectiveUser, profileId } = input;
  const { previewBanks } = useGuestStorePreviewBanks(effectiveUser);
  const [signedInPreviewBanks, setSignedInPreviewBanks] = React.useState<GuestStorePreviewBank[]>([]);
  const storePreviewItems = effectiveUser ? [] : previewBanks;
  const badgePreviewItems = effectiveUser ? signedInPreviewBanks : previewBanks;
  const storePreviewSignature = React.useMemo(
    () => buildStorePreviewSignature(badgePreviewItems),
    [badgePreviewItems],
  );
  const storePreviewSeenKey = React.useMemo(
    () => `${STORE_PREVIEW_SEEN_KEY_PREFIX}${profileId || effectiveUser?.id || 'guest'}`,
    [effectiveUser?.id, profileId],
  );
  const [seenStorePreviewSignature, setSeenStorePreviewSignature] = React.useState('');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setSeenStorePreviewSignature(window.localStorage.getItem(storePreviewSeenKey) || '');
    } catch {
      setSeenStorePreviewSignature('');
    }
  }, [storePreviewSeenKey]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSeenChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; signature?: string }>).detail;
      if (!detail || detail.key !== storePreviewSeenKey) return;
      setSeenStorePreviewSignature(typeof detail.signature === 'string' ? detail.signature : '');
    };
    window.addEventListener(STORE_PREVIEW_SEEN_EVENT, handleSeenChange as EventListener);
    return () => {
      window.removeEventListener(STORE_PREVIEW_SEEN_EVENT, handleSeenChange as EventListener);
    };
  }, [storePreviewSeenKey]);

  React.useEffect(() => {
    if (!effectiveUser) {
      setSignedInPreviewBanks([]);
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    let cancelled = false;
    const load = async () => {
      try {
        const fetched = await fetchStorePreviewBanks();
        if (cancelled || fetched.maintenanceEnabled) return;
        setSignedInPreviewBanks(fetched.items);
      } catch {
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [effectiveUser]);

  const markStorePreviewSeen = React.useCallback(() => {
    if (!storePreviewSignature || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storePreviewSeenKey, storePreviewSignature);
    } catch {
    }
    setSeenStorePreviewSignature(storePreviewSignature);
    window.dispatchEvent(new CustomEvent(STORE_PREVIEW_SEEN_EVENT, {
      detail: { key: storePreviewSeenKey, signature: storePreviewSignature },
    }));
  }, [storePreviewSeenKey, storePreviewSignature]);

  return {
    storePreviewItems,
    showStoreNewBadge: Boolean(storePreviewSignature) && storePreviewSignature !== seenStorePreviewSignature,
    markStorePreviewSeen,
  };
}
