export type PersistedHotcueTuple = [number | null, number | null, number | null, number | null];

export interface PersistedDeckLoadedPadRef {
  bankId: string;
  padId: string;
}

export interface PersistedDeckLayoutEntry {
  channelId: number;
  loadedPadRef: PersistedDeckLoadedPadRef | null;
  hotcuesMs: PersistedHotcueTuple;
  collapsed: boolean;
  channelVolume: number;
  positionMs: number;
  wasPlaying: boolean;
  savedAt: number;
}

export const DECK_LAYOUT_SCHEMA_VERSION = 2;

const normalizeHotcues = (input: unknown): PersistedHotcueTuple => {
  if (!Array.isArray(input)) {
    return [null, null, null, null];
  }
  const values = input
    .slice(0, 4)
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? Math.max(0, item) : null));
  while (values.length < 4) values.push(null);
  return values as PersistedHotcueTuple;
};

const normalizeLoadedPadRef = (input: unknown): PersistedDeckLoadedPadRef | null => {
  if (!input || typeof input !== 'object') return null;
  const value = input as { bankId?: unknown; padId?: unknown };
  if (typeof value.bankId !== 'string' || typeof value.padId !== 'string') {
    return null;
  }
  return { bankId: value.bankId, padId: value.padId };
};

export function normalizeDeckLayoutEntries(input: unknown): PersistedDeckLayoutEntry[] {
  if (!Array.isArray(input)) return [];
  const now = Date.now();
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry as Record<string, unknown>;
      const channelId = Number(value.channelId);
      if (!Number.isFinite(channelId) || channelId < 1) return null;

      const channelVolumeRaw = Number(value.channelVolume);
      const channelVolume = Number.isFinite(channelVolumeRaw)
        ? Math.max(0, Math.min(1, channelVolumeRaw))
        : 1;

      const positionRaw = Number(value.positionMs);
      const positionMs = Number.isFinite(positionRaw) ? Math.max(0, positionRaw) : 0;
      const savedAtRaw = Number(value.savedAt);
      const savedAt = Number.isFinite(savedAtRaw) ? savedAtRaw : now;

      return {
        channelId: Math.floor(channelId),
        loadedPadRef: normalizeLoadedPadRef(value.loadedPadRef),
        hotcuesMs: normalizeHotcues(value.hotcuesMs),
        collapsed: Boolean(value.collapsed),
        channelVolume,
        positionMs,
        wasPlaying: Boolean(value.wasPlaying),
        savedAt
      } satisfies PersistedDeckLayoutEntry;
    })
    .filter((item): item is PersistedDeckLayoutEntry => item !== null);
}
