import * as React from 'react';
import { useAuth, getCachedProfile, getCachedUser, type Profile } from '@/hooks/useAuth';

const DEFAULT_OWNED_BANK_QUOTA = 6;
const DEFAULT_OWNED_BANK_PAD_CAP = 64;
const DEFAULT_DEVICE_TOTAL_BANK_CAP = 120;
const MIN_OWNED_BANK_QUOTA = 1;
const MAX_OWNED_BANK_QUOTA = 500;
const MIN_OWNED_BANK_PAD_CAP = 1;
const MAX_OWNED_BANK_PAD_CAP = 256;
const MIN_DEVICE_TOTAL_BANK_CAP = 10;
const MAX_DEVICE_TOTAL_BANK_CAP = 1000;

const normalizeIntegerLimit = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
};

export type BankQuotaPolicy = {
  ownedBankQuota: number;
  ownedBankPadCap: number;
  deviceTotalBankCap: number;
};

export type SamplerAuthSessionMode = 'guest_locked' | 'trusted_offline' | 'authenticated';

export const resolveBankQuotaPolicy = (profile: Profile | null | undefined): BankQuotaPolicy => ({
  ownedBankQuota: normalizeIntegerLimit(
    profile?.owned_bank_quota,
    DEFAULT_OWNED_BANK_QUOTA,
    MIN_OWNED_BANK_QUOTA,
    MAX_OWNED_BANK_QUOTA
  ),
  ownedBankPadCap: normalizeIntegerLimit(
    profile?.owned_bank_pad_cap,
    DEFAULT_OWNED_BANK_PAD_CAP,
    MIN_OWNED_BANK_PAD_CAP,
    MAX_OWNED_BANK_PAD_CAP
  ),
  deviceTotalBankCap: normalizeIntegerLimit(
    profile?.device_total_bank_cap,
    DEFAULT_DEVICE_TOTAL_BANK_CAP,
    MIN_DEVICE_TOTAL_BANK_CAP,
    MAX_DEVICE_TOTAL_BANK_CAP
  ),
});

export const useSamplerStoreSession = () => {
  const { user, profile, loading, sessionConflictReason, offlineTrustedSession } = useAuth();
  const effectiveProfile = React.useMemo<Profile | null>(() => profile || getCachedProfile(), [profile]);
  const quotaPolicy = React.useMemo(() => resolveBankQuotaPolicy(effectiveProfile), [effectiveProfile]);
  const authSession = React.useMemo((): { mode: SamplerAuthSessionMode; user: ReturnType<typeof getCachedUser> } => {
    const cachedUser = getCachedUser();
    if (user?.id) return { mode: 'authenticated', user };
    if (offlineTrustedSession && cachedUser?.id) return { mode: 'trusted_offline', user: cachedUser };
    return { mode: 'guest_locked', user: null };
  }, [offlineTrustedSession, user]);

  return {
    user,
    profile,
    loading,
    sessionConflictReason,
    offlineTrustedSession,
    effectiveProfile,
    quotaPolicy,
    authSessionMode: authSession.mode,
    authSessionUserId: authSession.user?.id || null,
    isGuestLockedSession: authSession.mode === 'guest_locked',
  };
};

