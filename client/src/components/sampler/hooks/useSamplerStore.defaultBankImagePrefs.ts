export type DefaultBankPadImagePreference = 'none';

type DefaultBankImagePreferenceState = {
  byOwner?: Record<string, Record<string, DefaultBankPadImagePreference>>;
  guest?: Record<string, DefaultBankPadImagePreference>;
};

const readPreferenceState = (storageKey: string): DefaultBankImagePreferenceState => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DefaultBankImagePreferenceState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writePreferenceState = (storageKey: string, state: DefaultBankImagePreferenceState): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Best effort only.
  }
};

const getOwnerPreferences = (
  state: DefaultBankImagePreferenceState,
  ownerId: string | null
): Record<string, DefaultBankPadImagePreference> => {
  if (ownerId) {
    return state.byOwner?.[ownerId] || {};
  }
  return state.guest || {};
};

export const readDefaultBankPadImagePreference = (
  storageKey: string,
  ownerId: string | null,
  padId: string
): DefaultBankPadImagePreference | null => {
  if (!padId) return null;
  const preferences = getOwnerPreferences(readPreferenceState(storageKey), ownerId);
  return preferences[padId] || null;
};

export const writeDefaultBankPadImagePreference = (
  storageKey: string,
  ownerId: string | null,
  padId: string,
  preference: DefaultBankPadImagePreference | null
): void => {
  if (!padId) return;
  const state = readPreferenceState(storageKey);

  if (ownerId) {
    const byOwner = { ...(state.byOwner || {}) };
    const nextOwnerPreferences = { ...(byOwner[ownerId] || {}) };
    if (preference) {
      nextOwnerPreferences[padId] = preference;
    } else {
      delete nextOwnerPreferences[padId];
    }

    if (Object.keys(nextOwnerPreferences).length > 0) {
      byOwner[ownerId] = nextOwnerPreferences;
    } else {
      delete byOwner[ownerId];
    }

    writePreferenceState(storageKey, {
      ...state,
      byOwner,
    });
    return;
  }

  const guestPreferences = { ...(state.guest || {}) };
  if (preference) {
    guestPreferences[padId] = preference;
  } else {
    delete guestPreferences[padId];
  }

  const nextState: DefaultBankImagePreferenceState = {
    ...state,
  };
  if (Object.keys(guestPreferences).length > 0) {
    nextState.guest = guestPreferences;
  } else {
    delete nextState.guest;
  }
  writePreferenceState(storageKey, nextState);
};
