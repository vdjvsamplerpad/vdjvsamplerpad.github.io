import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { User, AuthError, Session } from '@supabase/supabase-js'
import { edgeFunctionUrl, getClientCompatibilityHeaders, markAuthClientCompatibility } from '@/lib/edge-api'
import { clearUserBankCache, refreshAccessibleBanksCache } from '@/lib/bank-utils'
import {
  type AccountCapabilitySnapshot,
  fallbackCapabilitiesForProfile,
  normalizeAccountCapabilitySnapshot,
  readCachedCapabilities,
  writeCachedCapabilities,
} from '@/lib/account-capabilities'
import {
  claimCurrentSession,
  ensureActivityRuntime,
  type SessionConflictDetails,
  type SessionClaimDeviceInfo,
  SessionConflictError,
  checkSessionValidity,
  logActivityEvent,
  logSignoutActivity,
  previewSessionClaim,
  sendActivityHeartbeat,
  sendHeartbeatBeacon,
} from '@/lib/activityLogger'
import { identifyProductUser, resetProductAnalytics } from '@/lib/productAnalytics'
import { getCapacitorAppPlugin, isNativeCapacitorRuntime } from '@/lib/capacitor-app-plugin'

// Keys for localStorage caching
const USER_CACHE_KEY = 'vdjv-cached-user';
const PROFILE_CACHE_KEY = 'vdjv-cached-profile';
const BAN_CACHE_KEY = 'vdjv-cached-ban';
const OFFLINE_SIGNOUT_PENDING_KEY = 'vdjv-offline-signout-pending';
const SESSION_CONFLICT_REASON_KEY = 'vdjv-session-conflict-reason';
const SESSION_CONFLICT_DETAILS_KEY = 'vdjv-session-conflict-details';
const SESSION_ENFORCEMENT_EVENT_KEY = 'vdjv-session-enforcement-event';
const HIDE_PROTECTED_BANKS_KEY = 'vdjv-hide-protected-banks';
const PASSWORD_RECOVERY_MODE_KEY = 'vdjv-password-recovery-mode';
const GOOGLE_OAUTH_LOGIN_PENDING_KEY = 'vdjv-google-oauth-login-pending';
const PROFILE_SELECT = 'id, role, display_name, account_tier, tier_source, tier_updated_at, owned_bank_quota, owned_bank_pad_cap, device_total_bank_cap, welcome_email_sent_at';
const AUTH_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const GOOGLE_OAUTH_LOGIN_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_CAPACITOR_AUTH_REDIRECT_URL = 'com.powerworkout.vdjv://auth/callback';

const getCapacitorAuthRedirectUrl = (): string => {
  const configured = String((import.meta as any).env?.VITE_CAPACITOR_AUTH_REDIRECT_URL || '').trim();
  return configured || DEFAULT_CAPACITOR_AUTH_REDIRECT_URL;
};

const isCapacitorAuthCallbackUrl = (url: string): boolean => {
  const normalized = String(url || '').trim();
  if (!normalized) return false;
  const redirectUrl = getCapacitorAuthRedirectUrl();
  return normalized.startsWith(redirectUrl) || normalized.startsWith(DEFAULT_CAPACITOR_AUTH_REDIRECT_URL);
};

const getCallbackParams = (url: string): URLSearchParams => {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  if (hash) {
    const hashParams = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
    hashParams.forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
  }
  return params;
};

const closeNativeOAuthBrowser = async (): Promise<void> => {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
  }
};

const isElectronOAuthRuntime = (): boolean => (
  typeof window !== 'undefined' && typeof window.electronAPI?.openExternalOAuthUrl === 'function'
);

const isStandaloneIosPwaRuntime = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone && /iPad|iPhone|iPod/i.test(navigator.userAgent || '');
};

export const isPasswordRecoveryMode = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(PASSWORD_RECOVERY_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export const setPasswordRecoveryMode = (enabled: boolean): void => {
  if (typeof window === 'undefined') return
  try {
    if (enabled) window.sessionStorage.setItem(PASSWORD_RECOVERY_MODE_KEY, '1')
    else window.sessionStorage.removeItem(PASSWORD_RECOVERY_MODE_KEY)
  } catch {
  }
}

const setGoogleOAuthLoginPending = (pending: boolean): void => {
  if (typeof window === 'undefined') return
  try {
    if (pending) window.sessionStorage.setItem(GOOGLE_OAUTH_LOGIN_PENDING_KEY, String(Date.now()))
    else window.sessionStorage.removeItem(GOOGLE_OAUTH_LOGIN_PENDING_KEY)
  } catch {
  }
}

const isGoogleOAuthLoginPending = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_OAUTH_LOGIN_PENDING_KEY)
    if (!raw) return false
    const createdAt = Number(raw)
    if (Number.isFinite(createdAt) && Date.now() - createdAt <= GOOGLE_OAUTH_LOGIN_PENDING_MAX_AGE_MS) {
      return true
    }
    window.sessionStorage.removeItem(GOOGLE_OAUTH_LOGIN_PENDING_KEY)
    return false
  } catch {
    return false
  }
}

const getAuthProvider = (user: User | null): string | null => {
  if (!user) return null
  const metadata = (user as any).app_metadata || {}
  const provider = typeof metadata.provider === 'string' ? metadata.provider.toLowerCase() : ''
  if (provider) return provider

  const providers = Array.isArray(metadata.providers) ? metadata.providers : []
  const googleProvider = providers.find((entry: unknown) => String(entry || '').toLowerCase() === 'google')
  if (googleProvider) return 'google'

  const identities = Array.isArray((user as any).identities) ? (user as any).identities : []
  const googleIdentity = identities.find((identity: any) => String(identity?.provider || '').toLowerCase() === 'google')
  return googleIdentity ? 'google' : null
}

export interface Profile {
  id: string
  role: 'admin' | 'user'
  display_name: string
  account_tier?: 'free' | 'pro' | 'pro_max' | null
  effective_account_tier?: 'free' | 'pro' | 'pro_max' | null
  tier_source?: string | null
  tier_updated_at?: string | null
  owned_bank_quota?: number | null
  owned_bank_pad_cap?: number | null
  device_total_bank_cap?: number | null
  welcome_email_sent_at?: string | null
}

export type PendingSessionClaim = {
  userId: string
  email: string | null
  message: string
  currentDevice: SessionClaimDeviceInfo | null
  requestedAt: number
  provider: string | null
}

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  authTransition: {
    status: 'idle' | 'signing_in' | 'signing_out'
    email: string | null
  }
  sessionConflictReason: string | null
  sessionConflictDetails: SessionConflictDetails | null
  pendingSessionClaim: PendingSessionClaim | null
  banned: boolean
  offlineTrustedSession: boolean
  lastSessionValidationAt: number | null
  capabilities: AccountCapabilitySnapshot
}

export type AuthAccessTokenResult = {
  token: string | null
  reason?: 'auth_loading' | 'offline_session' | 'session_conflict' | 'session_sync_required' | 'not_authenticated'
  message?: string
}

// Helper to get cached user from localStorage (for offline/sync issues)
export function getCachedUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Helper to get cached profile from localStorage
export function getCachedProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Helper to get cached ban flag from localStorage
export function getCachedBan(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cached = localStorage.getItem(BAN_CACHE_KEY);
    return cached === '1' || cached === 'true';
  } catch {
    return false;
  }
}

// Helper to cache user data
function cacheUserData(user: User | null, profile: Profile | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
    }
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
  }
}

function cacheBanState(banned: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (banned) {
      localStorage.setItem(BAN_CACHE_KEY, '1');
    } else {
      localStorage.removeItem(BAN_CACHE_KEY);
    }
  } catch {
  }
}

interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: AuthError | null; data?: { user: User | null } }>
  continueOffline: () => Promise<{ error?: AuthError | null; data?: { user: User | null } }>
  signInWithGoogle: (redirectTo?: string) => Promise<{ error?: AuthError | null }>
  cancelGoogleSignIn: () => Promise<void>
  signOut: () => Promise<{ error?: AuthError | null }>
  getAuthenticatedAccessToken: () => Promise<AuthAccessTokenResult>
  deleteAccount: (options: { phrase: string; acknowledge: boolean; password?: string; otp?: string }) => Promise<{ error?: AuthError | null }>
  refreshAccountCapabilities: () => Promise<AccountCapabilitySnapshot>
  requestPasswordReset: (email: string) => Promise<{ error?: AuthError | null }>
  verifyPasswordResetCode: (email: string, code: string) => Promise<{ error?: AuthError | null }>
  updatePassword: (newPassword: string) => Promise<{ error?: AuthError | null }>
  updateDisplayName: (displayName: string) => Promise<{ error?: AuthError | null; profile?: Profile | null }>
  clearSessionConflictReason: () => void
  confirmSessionClaim: () => Promise<{ error?: AuthError | null }>
  cancelSessionClaim: () => Promise<void>
}

type AuthContextValue = AuthState & AuthActions
type AuthProviderValue = {
  state: AuthState
  actions: AuthActions
  combined: AuthContextValue
}

const AuthStateContext = React.createContext<AuthState | null>(null)
const AuthActionsContext = React.createContext<AuthActions | null>(null)
const AuthContext = React.createContext<AuthContextValue | null>(null)

const getPendingOfflineSignout = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(OFFLINE_SIGNOUT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
};

const setPendingOfflineSignout = (pending: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (pending) localStorage.setItem(OFFLINE_SIGNOUT_PENDING_KEY, '1');
    else localStorage.removeItem(OFFLINE_SIGNOUT_PENDING_KEY);
  } catch {
  }
};

const getCachedSessionConflictReason = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(SESSION_CONFLICT_REASON_KEY);
  } catch {
    return null;
  }
};

const setCachedSessionConflictReason = (reason: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!reason) localStorage.removeItem(SESSION_CONFLICT_REASON_KEY);
    else localStorage.setItem(SESSION_CONFLICT_REASON_KEY, reason);
  } catch {
  }
};

const getCachedSessionConflictDetails = (): SessionConflictDetails | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_CONFLICT_DETAILS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as SessionConflictDetails : null;
  } catch {
    return null;
  }
};

const setCachedSessionConflictDetails = (details: SessionConflictDetails | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!details) localStorage.removeItem(SESSION_CONFLICT_DETAILS_KEY);
    else localStorage.setItem(SESSION_CONFLICT_DETAILS_KEY, JSON.stringify(details));
  } catch {
  }
};

const canTrustCachedOfflineUser = (): boolean => {
  if (!getCachedUser()?.id) return false
  if (getCachedBan()) return false
  if (getPendingOfflineSignout()) return false
  if (getCachedSessionConflictReason()) return false
  return true
}

export const hasTrustedCachedOfflineUser = (): boolean => canTrustCachedOfflineUser()

const emitSessionEnforcementEvent = (reason: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_ENFORCEMENT_EVENT_KEY, JSON.stringify({ reason, ts: Date.now() }));
  } catch {
  }
};

const setHideProtectedBanksLock = (locked: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (locked) localStorage.setItem(HIDE_PROTECTED_BANKS_KEY, '1');
    else localStorage.removeItem(HIDE_PROTECTED_BANKS_KEY);
  } catch {
  }
};

function isBanError(error: { message?: string | null; status?: number; code?: string | null } | null | undefined): boolean {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  const code = (error.code || '').toLowerCase()
  const status = error.status
  return (
    message.includes('banned') ||
    message.includes('ban') ||
    message.includes('suspended') ||
    code.includes('banned') ||
    code.includes('suspended') ||
    status === 403
  )
}

function isTransientNetworkError(
  error:
    | {
        message?: string | null
        status?: number
        code?: string | null
        name?: string | null
      }
    | null
    | undefined
): boolean {
  if (!error) return false
  if (error.status === 401 || error.status === 403) return false
  if (error.status === 0) return true
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true

  const haystack = `${error.name || ''} ${error.code || ''} ${error.message || ''}`.toLowerCase()
  return (
    haystack.includes('failed to fetch') ||
    haystack.includes('fetch failed') ||
    haystack.includes('networkerror') ||
    haystack.includes('network request failed') ||
    haystack.includes('load failed') ||
    haystack.includes('timeout') ||
    haystack.includes('aborterror')
  )
}

function isUserBanned(user: User | null): boolean {
  if (!user) return false
  const bannedUntil =
    (user as any).banned_until ||
    (user as any).app_metadata?.banned_until ||
    (user as any).user_metadata?.banned_until
  if (!bannedUntil) return false
  const banDate = new Date(bannedUntil)
  return !Number.isNaN(banDate.getTime()) && banDate > new Date()
}

async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle()

  return {
    data: data ? (data as Profile) : null,
    error,
  }
}

async function loadAccountCapabilities(userId: string, profile: Profile | null): Promise<AccountCapabilitySnapshot> {
  const cached = readCachedCapabilities(userId)
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return cached || fallbackCapabilitiesForProfile(profile)
    const response = await fetch(edgeFunctionUrl('store-api', 'account/me'), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { ...getClientCompatibilityHeaders(), Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return cached || fallbackCapabilitiesForProfile(profile)
    const payload = await response.json().catch(() => ({}))
    const accountData = payload?.data && typeof payload.data === 'object' ? payload.data : payload
    const capabilities = accountData?.capabilities as AccountCapabilitySnapshot | undefined
    if (!capabilities?.features || !capabilities?.limits) return cached || fallbackCapabilitiesForProfile(profile)
    const normalizedCapabilities = normalizeAccountCapabilitySnapshot(capabilities, fallbackCapabilitiesForProfile(profile))
    writeCachedCapabilities(userId, normalizedCapabilities)
    return normalizedCapabilities
  } catch {
    return cached || fallbackCapabilitiesForProfile(profile)
  }
}

function useAuthValue(): AuthProviderValue {
  const cachedBan = getCachedBan()
  const cachedUser = cachedBan ? null : getCachedUser()
  const cachedProfile = cachedBan ? null : getCachedProfile()
  const initialGoogleOAuthPending = isGoogleOAuthLoginPending()
  const cachedCapabilities = cachedUser?.id
    ? readCachedCapabilities(cachedUser.id) || fallbackCapabilitiesForProfile(cachedProfile)
    : fallbackCapabilitiesForProfile(null)

  const [state, setState] = React.useState<AuthState>({
    user: cachedUser,
    profile: cachedProfile,
    loading: true,
    authTransition: {
      status: initialGoogleOAuthPending ? 'signing_in' : 'idle',
      email: initialGoogleOAuthPending ? 'Google' : null,
    },
    sessionConflictReason: getCachedSessionConflictReason(),
    sessionConflictDetails: getCachedSessionConflictDetails(),
    pendingSessionClaim: null,
    banned: cachedBan,
    offlineTrustedSession: Boolean(cachedUser && (typeof navigator !== 'undefined' ? !navigator.onLine : false)),
    lastSessionValidationAt: null,
    capabilities: cachedCapabilities,
  })
  
  // Track which user we've already refreshed cache for
  const cacheRefreshedForUserIdRef = React.useRef<string | null>(null)
  const sessionConflictLockedRef = React.useRef(false)
  const signOutInProgressRef = React.useRef(false)
  const authTransitionStatusRef = React.useRef<AuthState['authTransition']['status']>('idle')
  const stateRef = React.useRef(state)
  const fetchSessionAndProfileRef = React.useRef<((session: Session | null) => Promise<void>) | null>(null)
  const sessionClaimAlreadyConfirmedUserIdRef = React.useRef<string | null>(null)
  const pendingSessionClaimRef = React.useRef<PendingSessionClaim | null>(null)

  React.useEffect(() => {
    stateRef.current = state
    authTransitionStatusRef.current = state.authTransition.status
    pendingSessionClaimRef.current = state.pendingSessionClaim
  }, [state])

  React.useEffect(() => {
    if (state.user) return
    if (state.capabilities.effectiveTier === 'guest') return
    setState((s) => ({
      ...s,
      capabilities: fallbackCapabilitiesForProfile(null),
    }))
  }, [state.capabilities.effectiveTier, state.user])

  React.useEffect(() => {
    ensureActivityRuntime()
  }, [])

  const lastAnalyticsUserIdRef = React.useRef<string | null>(null)

  const setPendingSessionClaim = React.useCallback((claim: PendingSessionClaim | null) => {
    pendingSessionClaimRef.current = claim
    setState((s) => (s.pendingSessionClaim === claim ? s : { ...s, pendingSessionClaim: claim }))
  }, [])

  React.useEffect(() => {
    const currentUserId = state.user?.id || null
    if (!currentUserId) {
      if (lastAnalyticsUserIdRef.current) {
        resetProductAnalytics()
        lastAnalyticsUserIdRef.current = null
      }
      return
    }

    identifyProductUser(currentUserId, {
      role: state.profile?.role || null,
      display_name: state.profile?.display_name || null,
      account_tier: state.capabilities.effectiveTier,
    })
    lastAnalyticsUserIdRef.current = currentUserId
  }, [state.capabilities.effectiveTier, state.profile?.display_name, state.profile?.role, state.user?.id])

  const setBannedState = React.useCallback((banned: boolean) => {
    cacheBanState(banned)
    setState((s) => (s.banned === banned ? s : { ...s, banned }))
  }, [])

  const setSessionConflictReason = React.useCallback((reason: string | null, details: SessionConflictDetails | null = null) => {
    setCachedSessionConflictReason(reason)
    setCachedSessionConflictDetails(reason ? details : null)
    setState((s) => (
      s.sessionConflictReason === reason && s.sessionConflictDetails === (reason ? details : null)
        ? s
        : {
            ...s,
            sessionConflictReason: reason,
            sessionConflictDetails: reason ? details : null,
          }
    ))
  }, [])

  const setAuthTransition = React.useCallback((status: AuthState['authTransition']['status'], email: string | null = null) => {
    authTransitionStatusRef.current = status
    setState((s) => (
      s.authTransition.status === status && s.authTransition.email === email
        ? s
        : {
            ...s,
            authTransition: { status, email },
          }
    ))
  }, [])

  const trustCachedOfflineSession = React.useCallback((): boolean => {
    if (signOutInProgressRef.current) return false
    if (!canTrustCachedOfflineUser()) return false
    const fallbackUser = getCachedUser()
    if (!fallbackUser?.id) return false
    const fallbackProfile = getCachedProfile()
    const fallbackCapabilities = readCachedCapabilities(fallbackUser.id) || fallbackCapabilitiesForProfile(fallbackProfile)
    setHideProtectedBanksLock(false)
    cacheUserData(fallbackUser, fallbackProfile)
    cacheRefreshedForUserIdRef.current = fallbackUser.id
    setState((s) => ({
      ...s,
      user: fallbackUser,
      profile: fallbackProfile,
      loading: false,
      authTransition: {
        status: 'idle',
        email: null,
      },
      offlineTrustedSession: true,
      pendingSessionClaim: null,
      capabilities: fallbackCapabilities,
    }))
    return true
  }, [])

  const enforceBan = React.useCallback(async () => {
    cacheBanState(true)
    setHideProtectedBanksLock(true)
    cacheUserData(null, null)
    clearUserBankCache()
    cacheRefreshedForUserIdRef.current = null
    setState((s) => ({
      ...s,
      user: null,
      profile: null,
      loading: false,
      authTransition: {
        status: 'idle',
        email: null,
      },
      banned: true,
      offlineTrustedSession: false,
      sessionConflictDetails: null,
      pendingSessionClaim: null,
      lastSessionValidationAt: null,
    }))
    try {
      await supabase.auth.signOut({ scope: 'global' })
    } catch {
    }
  }, [])

  const enforceSessionConflict = React.useCallback(async (reason?: string, details?: SessionConflictDetails | null) => {
    if (sessionConflictLockedRef.current) return
    sessionConflictLockedRef.current = true
    const message = reason || 'This account was used on another device. You were signed out on this device.'
    const currentUser = state.user || getCachedUser()
    setPendingOfflineSignout(false)
    setHideProtectedBanksLock(true)
    setSessionConflictReason(message, details || null)
    emitSessionEnforcementEvent(message)
    cacheUserData(null, null)
    clearUserBankCache(currentUser?.id)
    cacheRefreshedForUserIdRef.current = null
    setState((s) => ({
      ...s,
      user: null,
      profile: null,
      loading: false,
      authTransition: {
        status: 'idle',
        email: null,
      },
      offlineTrustedSession: false,
      sessionConflictDetails: details || null,
      lastSessionValidationAt: null,
    }))
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
    }
  }, [setSessionConflictReason, state.user])

  const ensureSessionClaim = React.useCallback(async (authUser: User): Promise<'ready' | 'pending'> => {
    if (!authUser?.id) return 'ready'
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'ready'

    const provider = getAuthProvider(authUser) || (isGoogleOAuthLoginPending() ? 'google' : null)
    const cachedUser = getCachedUser()
    const shouldGate =
      authTransitionStatusRef.current === 'signing_in' ||
      isGoogleOAuthLoginPending() ||
      !cachedUser?.id ||
      cachedUser.id !== authUser.id

    if (!shouldGate) return 'ready'

    if (sessionClaimAlreadyConfirmedUserIdRef.current === authUser.id) {
      sessionClaimAlreadyConfirmedUserIdRef.current = null
      setGoogleOAuthLoginPending(false)
      return 'ready'
    }

    const buildPending = (input: {
      message?: string | null
      currentDevice?: SessionClaimDeviceInfo | null
    }): PendingSessionClaim => ({
      userId: authUser.id,
      email: authUser.email || null,
      message: input.message || 'This account is already active on another device. Log it out first to continue here?',
      currentDevice: input.currentDevice || null,
      requestedAt: Date.now(),
      provider,
    })

    try {
      const preview = await previewSessionClaim({
        userId: authUser.id,
        email: authUser.email || null,
        meta: {
          source: 'useAuth.sessionClaim.preview',
          provider,
        },
      })
      if (preview.conflict || preview.requiresConfirmation) {
        setPendingSessionClaim(buildPending({
          message: preview.message,
          currentDevice: preview.currentDevice,
        }))
        setState((s) => ({
          ...s,
          user: null,
          profile: null,
          loading: false,
          authTransition: {
            status: 'idle',
            email: null,
          },
          offlineTrustedSession: false,
          lastSessionValidationAt: null,
        }))
        authTransitionStatusRef.current = 'idle'
        return 'pending'
      }

      const claim = await claimCurrentSession({
        userId: authUser.id,
        email: authUser.email || null,
        force: false,
        meta: {
          source: 'useAuth.sessionClaim',
          provider,
          stalePreviousSession: preview.stale === true,
        },
      })
      if (claim.conflict || claim.requiresConfirmation) {
        setPendingSessionClaim(buildPending({
          message: claim.message,
          currentDevice: claim.currentDevice,
        }))
        setState((s) => ({
          ...s,
          user: null,
          profile: null,
          loading: false,
          authTransition: {
            status: 'idle',
            email: null,
          },
          offlineTrustedSession: false,
          lastSessionValidationAt: null,
        }))
        authTransitionStatusRef.current = 'idle'
        return 'pending'
      }
      setPendingSessionClaim(null)
      setGoogleOAuthLoginPending(false)
      return 'ready'
    } catch (error) {
      if (isTransientNetworkError(error as any)) return 'ready'
      throw error
    }
  }, [setPendingSessionClaim])

  const ensureProfile = React.useCallback(async (user: User) => {
    const { data: existing, error: selectErr } = await supabase
      .from('profiles')
      .select(PROFILE_SELECT)
      .eq('id', user.id)
      .maybeSingle()

    if (selectErr) {
      return null
    }
    if (existing) return existing as Profile

    const displayName =
      (user.user_metadata?.display_name as string | undefined) ||
      user.email?.split('@')[0] ||
      'User'

    const { data: created, error: upsertErr } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        display_name: displayName,
        role: 'user',
        account_tier: 'free',
        tier_source: 'signup',
        owned_bank_quota: 2,
        owned_bank_pad_cap: 25,
        device_total_bank_cap: 10,
      }, { onConflict: 'id' })
      .select(PROFILE_SELECT)
      .single()

    if (upsertErr) {
      return null
    }
    return created as Profile
  }, [])

  React.useEffect(() => {
    if (getCachedBan()) {
      supabase.auth.signOut({ scope: 'global' }).catch((err) => {
      })
    }

    // Session/profile
    const fetchSessionAndProfile = async (session: Session | null) => {
      if (sessionConflictLockedRef.current) {
        cacheUserData(null, null)
        clearUserBankCache()
        cacheRefreshedForUserIdRef.current = null
        setState((s) => ({
          ...s,
          user: null,
          profile: null,
          loading: false,
          authTransition: {
            status: 'idle',
            email: null,
          },
          offlineTrustedSession: false,
          pendingSessionClaim: null,
          lastSessionValidationAt: null
        }))
        return
      }
      if (session?.user) {
        if (isPasswordRecoveryMode()) {
          cacheUserData(null, null)
          setHideProtectedBanksLock(true)
          clearUserBankCache()
          cacheRefreshedForUserIdRef.current = null
          setState((s) => ({
            ...s,
            user: null,
            profile: null,
            loading: false,
            authTransition: {
              status: 'idle',
              email: null,
            },
            offlineTrustedSession: false,
            pendingSessionClaim: null,
            lastSessionValidationAt: null,
          }))
          return
        }
        const { data: authData, error: authError } = await supabase.auth.getUser()
        const transientAuthError = isTransientNetworkError(authError)
        const fallbackCachedUser = getCachedUser() || session.user
        const authUser = authData?.user || (transientAuthError ? fallbackCachedUser : null)

        if (!authUser && transientAuthError && trustCachedOfflineSession()) {
          return
        }
        if (!authUser || authError?.status === 401 || authError?.status === 403) {
          cacheUserData(null, null)
          clearUserBankCache()
          cacheRefreshedForUserIdRef.current = null
          setState((s) => ({
            ...s,
            user: null,
            profile: null,
            loading: false,
            authTransition: {
              status: 'idle',
              email: null,
            },
            offlineTrustedSession: false,
            pendingSessionClaim: null,
            lastSessionValidationAt: null
          }))
          return
        }
        if (isUserBanned(authUser)) {
          await enforceBan()
          return
        }
        if (isBanError(authError)) {
          await enforceBan()
          return
        }
        if (authError) {
          if (transientAuthError) {
          } else {
          }
        } else {
          setBannedState(false)
        }
        const sessionClaimStatus = await ensureSessionClaim(authUser)
        if (sessionClaimStatus === 'pending') {
          return
        }
        setHideProtectedBanksLock(false)
        setSessionConflictReason(null)

        const { data: profile, error } = await loadProfile(authUser.id)

        if (error) {
          if (isTransientNetworkError(error)) {
            const fallbackProfile = getCachedProfile()
            const fallbackCapabilities = readCachedCapabilities(authUser.id) || fallbackCapabilitiesForProfile(fallbackProfile)
            cacheUserData(authUser, fallbackProfile)
            cacheRefreshedForUserIdRef.current = authUser.id
            setState((s) => ({
              ...s,
              user: authUser,
              profile: fallbackProfile,
              loading: false,
              authTransition: {
                status: 'idle',
                email: null,
              },
              offlineTrustedSession: true,
              pendingSessionClaim: null,
              capabilities: fallbackCapabilities,
            }))
          } else {
            cacheUserData(null, null)
            clearUserBankCache()
            cacheRefreshedForUserIdRef.current = null
            setState((s) => ({
              ...s,
              user: null,
              profile: null,
              loading: false,
              authTransition: {
                status: 'idle',
                email: null,
              },
              offlineTrustedSession: false,
              pendingSessionClaim: null,
              lastSessionValidationAt: null
            }))
          }
        } else {
          const resolvedProfile = profile ? (profile as Profile) : await ensureProfile(authUser)
          const resolvedCapabilities = await loadAccountCapabilities(authUser.id, resolvedProfile)
          cacheUserData(authUser, resolvedProfile)
          setState((s) => ({
            ...s,
            user: authUser,
            profile: resolvedProfile,
            loading: false,
            authTransition: {
              status: 'idle',
              email: null,
            },
            offlineTrustedSession: false,
            pendingSessionClaim: null,
            lastSessionValidationAt: Date.now(),
            capabilities: resolvedCapabilities,
          }))
        }
        
        // Refresh accessible banks cache ONLY once per user session (not on every auth state change)
        if (cacheRefreshedForUserIdRef.current !== authUser.id) {
          cacheRefreshedForUserIdRef.current = authUser.id
          refreshAccessibleBanksCache(authUser.id).catch(() => {})
        }
      } else {
        if (isGoogleOAuthLoginPending()) {
          setState((s) => ({
            ...s,
            user: s.user,
            profile: s.profile,
            loading: true,
            authTransition: {
              status: 'signing_in',
              email: 'Google',
            },
            offlineTrustedSession: false,
          }))
          return
        }

        // Native webviews and iOS A2HS can report "online" in deadspots while
        // Supabase cannot restore a session. Do not hide downloaded banks unless
        // an explicit enforcement path invalidated the cached user.
        if (trustCachedOfflineSession()) {
          return
        }

        cacheUserData(null, null)
        setHideProtectedBanksLock(true)
        clearUserBankCache()
        cacheRefreshedForUserIdRef.current = null
        setState((s) => ({
          ...s,
          user: null,
          profile: null,
          loading: false,
          authTransition: {
            status: 'idle',
            email: null,
          },
          offlineTrustedSession: false,
          pendingSessionClaim: null,
          lastSessionValidationAt: null
        }))
      }
    }
    fetchSessionAndProfileRef.current = fetchSessionAndProfile

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        fetchSessionAndProfile(session)
      })
      .catch((error) => {
        if (isTransientNetworkError(error) && trustCachedOfflineSession()) {
          return
        }
        cacheUserData(null, null)
        setHideProtectedBanksLock(true)
        clearUserBankCache()
        cacheRefreshedForUserIdRef.current = null
        setState((s) => ({
          ...s,
          user: null,
          profile: null,
          loading: false,
          authTransition: {
            status: 'idle',
            email: null,
          },
          offlineTrustedSession: false,
          pendingSessionClaim: null,
          lastSessionValidationAt: null
        }))
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      fetchSessionAndProfile(session)
    })

    return () => subscription.unsubscribe()
  }, [ensureProfile, ensureSessionClaim, enforceBan, setBannedState, setSessionConflictReason, trustCachedOfflineSession])

  React.useEffect(() => {
    if (state.authTransition.status !== 'signing_in') return
    if (!isGoogleOAuthLoginPending()) return

    const timeoutId = window.setTimeout(() => {
      if (!isGoogleOAuthLoginPending()) return
      setGoogleOAuthLoginPending(false)
      setState((s) => (
        s.user
          ? s
          : {
              ...s,
              loading: false,
              authTransition: {
                status: 'idle',
                email: null,
              },
              pendingSessionClaim: null,
            }
      ))
    }, 30_000)

    return () => window.clearTimeout(timeoutId)
  }, [state.authTransition.status])

  const cancelGoogleSignIn = React.useCallback(async () => {
    if (!isGoogleOAuthLoginPending() && authTransitionStatusRef.current !== 'signing_in') return
    setGoogleOAuthLoginPending(false)
    setAuthTransition('idle')
    await closeNativeOAuthBrowser()
    void logActivityEvent({
      eventType: 'auth.login',
      status: 'failed',
      email: null,
      errorMessage: 'Google sign-in was cancelled before a session was created.',
      meta: {
        source: 'useAuth.googleOAuthCancel',
        provider: 'google',
      },
    }).catch(() => {})
  }, [setAuthTransition])

  React.useEffect(() => {
    if (!isNativeCapacitorRuntime()) return
    let listenerHandle: { remove?: () => Promise<void> | void } | null = null
    let disposed = false

    const setup = async () => {
      try {
        const { Browser } = await import('@capacitor/browser')
        const nextHandle = await Browser.addListener('browserFinished', async () => {
          const pending = isGoogleOAuthLoginPending()
          if (!pending) return
          const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } as any }))
          if (data?.session) return
          setGoogleOAuthLoginPending(false)
          setAuthTransition('idle')
          void logActivityEvent({
            eventType: 'auth.login',
            status: 'failed',
            email: null,
            errorMessage: 'Google sign-in browser closed before completion.',
            meta: {
              source: 'useAuth.googleOAuthBrowserFinished',
              provider: 'google',
            },
          }).catch(() => {})
        })
        if (disposed) {
          void nextHandle?.remove?.()
          return
        }
        listenerHandle = nextHandle
      } catch {
      }
    }
    void setup()

    return () => {
      disposed = true
      void listenerHandle?.remove?.()
    }
  }, [setAuthTransition])

  React.useEffect(() => {
    if (isNativeCapacitorRuntime()) return
    if (typeof window === 'undefined') return
    let checkTimer: number | null = null

    const clearCheckTimer = () => {
      if (checkTimer !== null) {
        window.clearTimeout(checkTimer)
        checkTimer = null
      }
    }

    const scheduleOAuthReturnCheck = () => {
      if (!isGoogleOAuthLoginPending()) return
      if (document.visibilityState === 'hidden') return
      clearCheckTimer()
      checkTimer = window.setTimeout(async () => {
        if (!isGoogleOAuthLoginPending()) return
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } as any }))
        if (data?.session) return
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        void logActivityEvent({
          eventType: 'auth.login',
          status: 'failed',
          email: null,
          errorMessage: 'Google sign-in did not return a session.',
          meta: {
            source: 'useAuth.googleOAuthFocusReturn',
            provider: 'google',
          },
        }).catch(() => {})
      }, 1800)
    }

    window.addEventListener('focus', scheduleOAuthReturnCheck)
    window.addEventListener('pageshow', scheduleOAuthReturnCheck)
    document.addEventListener('visibilitychange', scheduleOAuthReturnCheck)
    return () => {
      clearCheckTimer()
      window.removeEventListener('focus', scheduleOAuthReturnCheck)
      window.removeEventListener('pageshow', scheduleOAuthReturnCheck)
      document.removeEventListener('visibilitychange', scheduleOAuthReturnCheck)
    }
  }, [setAuthTransition])

  const handleOAuthCallbackUrl = React.useCallback(async (
    url: string,
    source: string,
    options?: { closeNativeBrowser?: boolean },
  ) => {
    const normalizedUrl = String(url || '').trim()
    if (!normalizedUrl) return

    if (options?.closeNativeBrowser) {
      await closeNativeOAuthBrowser()
    }

    try {
      const params = getCallbackParams(normalizedUrl)
      const authError =
        params.get('error_description') ||
        params.get('error') ||
        params.get('error_code')

      if (authError) {
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        void logActivityEvent({
          eventType: 'auth.login',
          status: 'failed',
          email: null,
          errorMessage: authError,
          meta: {
            source,
            provider: 'google',
          },
        }).catch(() => {})
        return
      }

      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const code = params.get('code')
      const authResult = accessToken && refreshToken
        ? await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
        : code
          ? await supabase.auth.exchangeCodeForSession(code)
          : null

      if (!authResult) {
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        void logActivityEvent({
          eventType: 'auth.login',
          status: 'failed',
          email: null,
          errorMessage: 'OAuth callback did not include a session token or code.',
          meta: {
            source,
            provider: 'google',
          },
        }).catch(() => {})
        return
      }

      if (authResult.error) {
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        void logActivityEvent({
          eventType: 'auth.login',
          status: 'failed',
          email: null,
          errorMessage: authResult.error.message,
          meta: {
            source,
            provider: 'google',
          },
        }).catch(() => {})
        if (isBanError(authResult.error)) {
          await enforceBan()
        }
        return
      }

      if (authResult.data.session) {
        await fetchSessionAndProfileRef.current?.(authResult.data.session)
      }
    } catch (error) {
      setGoogleOAuthLoginPending(false)
      setAuthTransition('idle')
      void logActivityEvent({
        eventType: 'auth.login',
        status: 'failed',
        email: null,
        errorMessage: error instanceof Error ? error.message : 'OAuth callback failed.',
        meta: {
          source,
          provider: 'google',
        },
      }).catch(() => {})
    }
  }, [enforceBan, setAuthTransition])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const subscribe = window.electronAPI?.onExternalAuthCallback
    if (typeof subscribe !== 'function') return
    const unsubscribe = subscribe((payload) => {
      const url = typeof payload === 'string' ? payload : String(payload?.url || '')
      void handleOAuthCallbackUrl(url, 'useAuth.electronOAuthCallback')
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [handleOAuthCallbackUrl])

  React.useEffect(() => {
    const app = getCapacitorAppPlugin()
    if (!app?.addListener) return

    let listenerHandle: { remove?: () => Promise<void> | void } | null = null
    let disposed = false

    const handleNativeAuthCallback = async (payload?: { url?: string }) => {
      const url = String(payload?.url || '').trim()
      if (!isCapacitorAuthCallbackUrl(url)) return
      await handleOAuthCallbackUrl(url, 'useAuth.nativeOAuthCallback', { closeNativeBrowser: true })
    }

    const nextHandle = app.addListener('appUrlOpen', handleNativeAuthCallback)
    Promise.resolve(nextHandle)
      .then((handle) => {
        if (disposed) {
          void handle?.remove?.()
          return
        }
        listenerHandle = handle
      })
      .catch(() => {})

    return () => {
      disposed = true
      void listenerHandle?.remove?.()
    }
  }, [handleOAuthCallbackUrl])

  React.useEffect(() => {
    if (!state.user || state.banned) return
    if (state.profile?.role === 'admin') return
    if (isPasswordRecoveryMode()) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setState((s) => ({
        ...s,
        offlineTrustedSession: true
      }))
      return
    }

    const heartbeat = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void sendActivityHeartbeat({
        userId: state.user!.id,
        email: state.user!.email || null,
        lastEvent: 'heartbeat',
        meta: {
          visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        },
      }).catch((err) => {
        if (err instanceof SessionConflictError) {
          void enforceSessionConflict(err.message, err.details)
          return
        }
        const message = String((err as any)?.message || err || '')
        const transientNetworkError =
          message.includes('Failed to fetch') ||
          message.includes('NetworkError') ||
          message.includes('Load failed') ||
          message.includes('TypeError: Failed to fetch')
        if (!transientNetworkError) {
        }
      })
    }

    void checkSessionValidity({
      userId: state.user!.id,
      email: state.user!.email || null,
      lastEvent: 'startup-check',
      meta: { visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown' },
    })
      .then(() => {
        setState((s) => ({
          ...s,
          offlineTrustedSession: false,
          lastSessionValidationAt: Date.now()
        }))
      })
      .catch((err) => {
        if (err instanceof SessionConflictError) {
          void enforceSessionConflict(err.message, err.details)
        }
      })

    const interval = window.setInterval(heartbeat, AUTH_HEARTBEAT_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      heartbeat()
      void checkSessionValidity({
        userId: state.user!.id,
        email: state.user!.email || null,
        lastEvent: 'visibility-check',
        meta: { visibility: document.visibilityState },
      })
        .then(() => {
          setState((s) => ({
            ...s,
            offlineTrustedSession: false,
            lastSessionValidationAt: Date.now()
          }))
        })
        .catch((err) => {
          if (err instanceof SessionConflictError) {
            void enforceSessionConflict(err.message, err.details)
          }
        })
    }
    const onPageHide = () => {
      sendHeartbeatBeacon({
        userId: state.user?.id,
        email: state.user?.email || null,
        lastEvent: 'pagehide',
        meta: { visibility: document.visibilityState },
      })
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onPageHide)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onPageHide)
    }
  }, [state.user?.id, state.user?.email, state.banned, state.profile?.role, enforceSessionConflict])

  React.useEffect(() => {
    if (!state.user || state.banned) return
    if (state.profile?.role === 'admin') return
    if (isPasswordRecoveryMode()) return
    const onOnline = () => {
      void checkSessionValidity({
        userId: state.user!.id,
        email: state.user!.email || null,
        lastEvent: 'reconnect-check',
        meta: { visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown' },
      })
        .then(() => {
          setState((s) => ({
            ...s,
            offlineTrustedSession: false,
            lastSessionValidationAt: Date.now()
          }))
        })
        .catch((err) => {
          if (err instanceof SessionConflictError) {
            void enforceSessionConflict(err.message, err.details)
          }
        })
      refreshAccessibleBanksCache(state.user!.id).catch(() => {})
      void (async () => {
        try {
          const { data, error } = await loadProfile(state.user!.id)
          if (error || !data) return
          const capabilities = await loadAccountCapabilities(state.user!.id, data)
          cacheUserData(state.user!, data)
          setState((s) => ({
            ...s,
            profile: data,
            capabilities,
          }))
        } catch {
        }
      })()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [state.user?.id, state.user?.email, state.banned, state.profile?.role, enforceSessionConflict])

  React.useEffect(() => {
    if (!state.user || state.banned) return
    if (!getPendingOfflineSignout()) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    const currentUser = state.user
    const finalizeDeferredSignout = async () => {
      const { error } = await supabase.auth.signOut()
      cacheUserData(null, null)
      setHideProtectedBanksLock(true)
      clearUserBankCache(currentUser.id)
      setPendingOfflineSignout(false)
      setState((s) => ({
        ...s,
        user: null,
        profile: null,
        loading: false,
        authTransition: {
          status: 'idle',
          email: null,
        },
        offlineTrustedSession: false,
        pendingSessionClaim: null,
        lastSessionValidationAt: null
      }))
      void logSignoutActivity({
        status: error ? 'failed' : 'success',
        userId: currentUser.id,
        email: currentUser.email || null,
        errorMessage: error?.message || null,
        meta: {
          source: 'useAuth.signOut.offline-finalize',
        },
      }).catch((err) => {
      })
      emitSessionEnforcementEvent('deferred-signout-finalized')
    }

    void finalizeDeferredSignout()
  }, [state.user?.id, state.banned])

  const signIn = React.useCallback(async (email: string, password: string) => {
    if (authTransitionStatusRef.current !== 'idle') {
      return {
        error: {
          message: 'Authentication is already in progress. Please wait.',
        } as AuthError,
        data: { user: null },
      }
    }
    setSessionConflictReason(null)
    setPasswordRecoveryMode(false)
    sessionConflictLockedRef.current = false
    setAuthTransition('signing_in', email)
    try {
      await markAuthClientCompatibility(email)
    } catch (error) {
      setAuthTransition('idle')
      return {
        error: {
          message: error instanceof Error ? error.message : 'Please update the app before signing in.',
        } as AuthError,
        data: { user: null },
      }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data?.user) {
      setHideProtectedBanksLock(false)
      setState((s) => ({
        ...s,
        offlineTrustedSession: false,
        pendingSessionClaim: null,
      }))
    } else {
      setAuthTransition('idle')
    }
    if (isBanError(error)) {
      await enforceBan()
    }
    return { error, data: { user: data.user } }
  }, [enforceBan, setAuthTransition, setSessionConflictReason])

  const continueOffline = React.useCallback(async () => {
    if (authTransitionStatusRef.current !== 'idle') {
      return {
        error: {
          message: 'Authentication is already in progress. Please wait.',
        } as AuthError,
        data: { user: null },
      }
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      return {
        error: {
          message: 'Offline access is only available when this device has no internet connection.',
        } as AuthError,
        data: { user: null },
      }
    }
    const cachedUser = getCachedUser()
    if (!cachedUser?.id || !trustCachedOfflineSession()) {
      return {
        error: {
          message: 'No trusted offline account is saved on this device. Connect to the internet and sign in once.',
        } as AuthError,
        data: { user: null },
      }
    }
    return { error: null, data: { user: cachedUser } }
  }, [trustCachedOfflineSession])

  const signInWithGoogle = React.useCallback(async (redirectTo?: string) => {
    if (authTransitionStatusRef.current !== 'idle') {
      return {
        error: {
          message: 'Authentication is already in progress. Please wait.',
        } as AuthError,
      }
    }
    setSessionConflictReason(null)
    setPasswordRecoveryMode(false)
    sessionConflictLockedRef.current = false
    setAuthTransition('signing_in', 'Google')
    setGoogleOAuthLoginPending(true)
    const nativeOAuth = isNativeCapacitorRuntime()
    const iosStandalonePwa = isStandaloneIosPwaRuntime()
    const electronOAuth = !nativeOAuth && !iosStandalonePwa && isElectronOAuthRuntime()
    // iOS Add-to-Home-Screen must keep OAuth in the PWA window until a Universal Link
    // handoff exists; external Safari would land the session outside the standalone app.
    const externalOAuth = nativeOAuth || electronOAuth
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: externalOAuth ? getCapacitorAuthRedirectUrl() : redirectTo,
        skipBrowserRedirect: externalOAuth,
        queryParams: {
          prompt: 'select_account',
        },
      },
    })
    if (error) {
      setGoogleOAuthLoginPending(false)
      setAuthTransition('idle')
      void logActivityEvent({
        eventType: 'auth.login',
        status: 'failed',
        email: null,
        errorMessage: error.message,
        meta: {
          source: 'useAuth.googleOAuth',
          provider: 'google',
        },
      }).catch(() => {})
      if (isBanError(error)) {
        await enforceBan()
      }
    }
    if (!error && electronOAuth) {
      const authUrl = data?.url
      if (!authUrl) {
        const electronError = {
          message: 'Google sign-in could not open. Please try again.',
        } as AuthError
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        return { error: electronError }
      }
      try {
        const result = await window.electronAPI?.openExternalOAuthUrl?.({ url: authUrl })
        if (!result?.ok) {
          throw new Error(result?.reason || 'external_browser_failed')
        }
      } catch (openError) {
        const electronError = {
          message: openError instanceof Error ? openError.message : 'Google sign-in could not open. Please try again.',
        } as AuthError
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        return { error: electronError }
      }
    } else if (!error && nativeOAuth) {
      const authUrl = data?.url
      if (!authUrl) {
        const nativeError = {
          message: 'Google sign-in could not open. Please try again.',
        } as AuthError
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        return { error: nativeError }
      }
      try {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url: authUrl })
      } catch (openError) {
        const nativeError = {
          message: openError instanceof Error ? openError.message : 'Google sign-in could not open. Please try again.',
        } as AuthError
        setGoogleOAuthLoginPending(false)
        setAuthTransition('idle')
        return { error: nativeError }
      }
    }
    return { error }
  }, [enforceBan, setAuthTransition, setSessionConflictReason])

  const signOut = React.useCallback(async () => {
    if (authTransitionStatusRef.current === 'signing_out') {
      return { error: null }
    }
    const activeUser = state.user || getCachedUser()
    setPasswordRecoveryMode(false)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPendingOfflineSignout(true)
      setHideProtectedBanksLock(true)
      cacheUserData(null, null)
      clearUserBankCache(activeUser?.id)
      cacheRefreshedForUserIdRef.current = null
      setState((s) => ({
        ...s,
        user: null,
        profile: null,
        loading: false,
        authTransition: {
          status: 'idle',
          email: null,
        },
        offlineTrustedSession: false,
        pendingSessionClaim: null,
        lastSessionValidationAt: null,
      }))
      void logSignoutActivity({
        status: 'success',
        userId: activeUser?.id || null,
        email: activeUser?.email || null,
        meta: {
          source: 'useAuth.signOut.offline-deferred',
          deferred: true,
        },
      }).catch((err) => {
      })
      return { error: null }
    }
    setAuthTransition('signing_out', activeUser?.email || null)
    signOutInProgressRef.current = true
    const { error } = await supabase.auth.signOut()
    if (error) {
      signOutInProgressRef.current = false
      setAuthTransition('idle')
      return { error }
    }
    setPendingOfflineSignout(false)
    setHideProtectedBanksLock(true)
    // Clear cached user data on sign out
    cacheUserData(null, null)
    clearUserBankCache(activeUser?.id)
    cacheRefreshedForUserIdRef.current = null
    setState((s) => ({
      ...s,
      user: null,
      profile: null,
      loading: false,
      authTransition: {
        status: 'idle',
        email: null,
      },
      offlineTrustedSession: false,
      pendingSessionClaim: null,
      lastSessionValidationAt: null,
    }))
    signOutInProgressRef.current = false
    void logSignoutActivity({
      status: error ? 'failed' : 'success',
      userId: activeUser?.id || null,
      email: activeUser?.email || null,
      errorMessage: error?.message || null,
      meta: {
        source: 'useAuth.signOut',
      },
    }).catch((err) => {
    })
    return { error }
  }, [setAuthTransition, state.user])

  const getAuthenticatedAccessToken = React.useCallback(async (): Promise<AuthAccessTokenResult> => {
    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt += 1) {
      const currentState = stateRef.current
      if (!currentState.loading && authTransitionStatusRef.current === 'idle') break
      await new Promise((resolve) => window.setTimeout(resolve, 160 + waitAttempt * 60))
    }

    const currentState = stateRef.current
    if (currentState.loading || authTransitionStatusRef.current !== 'idle') {
      return {
        token: null,
        reason: 'auth_loading',
        message: 'Account session is still loading. Please wait a moment and try again.',
      }
    }
    if (currentState.sessionConflictReason) {
      return {
        token: null,
        reason: 'session_conflict',
        message: currentState.sessionConflictReason,
      }
    }
    if (currentState.pendingSessionClaim) {
      return {
        token: null,
        reason: 'session_sync_required',
        message: 'Confirm this login before submitting an upgrade request.',
      }
    }
    if (currentState.offlineTrustedSession || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return {
        token: null,
        reason: 'offline_session',
        message: 'Reconnect before submitting an upgrade request.',
      }
    }

    const expectedUserId = currentState.user?.id || getCachedUser()?.id || null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
      const sessionUserId = data.session?.user?.id || null
      const token = data.session?.access_token || null
      if (token && (!expectedUserId || sessionUserId === expectedUserId)) {
        return { token }
      }
      if (attempt === 1 || attempt === 3) {
        const refreshed = await supabase.auth.refreshSession().catch(() => null)
        const refreshedUserId = refreshed?.data.session?.user?.id || null
        const refreshedToken = refreshed?.data.session?.access_token || null
        if (refreshedToken && (!expectedUserId || refreshedUserId === expectedUserId)) {
          return { token: refreshedToken }
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 180 + attempt * 140))
    }

    if (expectedUserId) {
      return {
        token: null,
        reason: 'session_sync_required',
        message: 'Account session is still syncing. Please reopen upgrade pricing or refresh the app, then submit again.',
      }
    }
    return {
      token: null,
      reason: 'not_authenticated',
      message: 'Please sign in before submitting an upgrade request.',
    }
  }, [])

  const deleteAccount = React.useCallback(async (options: { phrase: string; acknowledge: boolean; password?: string; otp?: string }) => {
    if (authTransitionStatusRef.current !== 'idle') {
      return {
        error: {
          message: 'Authentication is already in progress. Please wait.',
        } as AuthError,
      }
    }

    const activeUser = state.user || getCachedUser()
    if (!activeUser?.id) {
      return {
        error: {
          message: 'You need to sign in first.',
        } as AuthError,
      }
    }

    if (String(options.phrase || '').trim().toUpperCase() !== 'DELETE' || options.acknowledge !== true) {
      return {
        error: {
          message: 'Deletion confirmation is incomplete.',
        } as AuthError,
      }
    }

    if (options.password) {
      if (!activeUser.email) {
        return {
          error: {
            message: 'Email is required to verify your password.',
          } as AuthError,
        }
      }
      const { data: reauthData, error: reauthError } = await supabase.auth.signInWithPassword({
        email: activeUser.email,
        password: options.password,
      })
      if (reauthError) {
        return {
          error: {
            message: 'Current password is incorrect.',
          } as AuthError,
        }
      }
      if (reauthData.user?.id && reauthData.user.id !== activeUser.id) {
        return {
          error: {
            message: 'Password verification did not match the signed-in account.',
          } as AuthError,
        }
      }
    }

    setPasswordRecoveryMode(false)
    setSessionConflictReason(null)
    setAuthTransition('signing_out', activeUser.email || null)
    signOutInProgressRef.current = true

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in again before deleting this account.')

      const response = await fetch(edgeFunctionUrl('store-api', 'account/delete'), {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirm: true,
          phrase: options.phrase,
          acknowledge: options.acknowledge,
          password: options.password || undefined,
          otp: options.otp || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(payload?.error || payload?.message || 'Account deletion failed.'))
      }

      setPendingOfflineSignout(false)
      setHideProtectedBanksLock(true)
      cacheBanState(false)
      cacheUserData(null, null)
      clearUserBankCache(activeUser.id)
      cacheRefreshedForUserIdRef.current = null
      setState((s) => ({
        ...s,
        user: null,
        profile: null,
        loading: false,
        authTransition: {
          status: 'idle',
          email: null,
        },
        sessionConflictReason: null,
        sessionConflictDetails: null,
        banned: false,
        offlineTrustedSession: false,
        pendingSessionClaim: null,
        lastSessionValidationAt: null,
        capabilities: fallbackCapabilitiesForProfile(null),
      }))
      resetProductAnalytics()
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch {
      }
      signOutInProgressRef.current = false
      return { error: null }
    } catch (error) {
      signOutInProgressRef.current = false
      setAuthTransition('idle')
      return {
        error: {
          message: error instanceof Error ? error.message : 'Account deletion failed.',
        } as AuthError,
      }
    }
  }, [setAuthTransition, setSessionConflictReason, state.user])

  const requestPasswordReset = React.useCallback(async (email: string) => {
    try {
      // Check if a recent reset was already sent (within last 5 minutes)
      const recentResetKey = `password_reset_${email}`
      const lastResetTime = localStorage.getItem(recentResetKey)
      const now = Date.now()
      const fiveMinutes = 5 * 60 * 1000 // 5 minutes in milliseconds

      if (lastResetTime && (now - parseInt(lastResetTime)) < fiveMinutes) {
        const remainingTime = Math.ceil((fiveMinutes - (now - parseInt(lastResetTime))) / 1000 / 60)
        return { 
          error: { 
            message: `Please wait ${remainingTime} minute${remainingTime > 1 ? 's' : ''} before requesting another reset.` 
          } as AuthError 
        }
      }

      // Store the reset request time first
      localStorage.setItem(recentResetKey, now.toString())

      const { error } = await supabase.auth.resetPasswordForEmail(email)

      if (error) {
        // Remove the stored time if the request failed
        localStorage.removeItem(recentResetKey)
        
        // Do not leak whether the email exists.
        if (error.message.includes('User not found') ||
            error.message.includes('No user found')) {
          return { error: null }
        }
        
        return { error }
      }

      return { error: null }
    } catch (error) {
      return { error: { message: 'Failed to send reset email. Please try again.' } as AuthError }
    }
  }, [])

  const refreshAccountCapabilities = React.useCallback(async () => {
    const activeUser = state.user || getCachedUser()
    if (!activeUser?.id) {
      const guestCapabilities = fallbackCapabilitiesForProfile(null)
      setState((s) => ({ ...s, capabilities: guestCapabilities }))
      return guestCapabilities
    }
    const activeProfile = state.profile || getCachedProfile()
    const capabilities = await loadAccountCapabilities(activeUser.id, activeProfile)
    setState((s) => ({ ...s, capabilities }))
    return capabilities
  }, [state.profile, state.user])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handleTierConfigUpdate = () => {
      const activeUser = state.user || getCachedUser()
      if (activeUser?.id) writeCachedCapabilities(activeUser.id, null)
      void refreshAccountCapabilities()
    }
    window.addEventListener('vdjv-account-tier-config-updated', handleTierConfigUpdate)
    return () => window.removeEventListener('vdjv-account-tier-config-updated', handleTierConfigUpdate)
  }, [refreshAccountCapabilities, state.user])

  const verifyPasswordResetCode = React.useCallback(async (email: string, code: string) => {
    try {
      await markAuthClientCompatibility(email)
    } catch (error) {
      return {
        error: {
          message: error instanceof Error ? error.message : 'Please update the app before signing in.',
        } as AuthError,
      }
    }
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'recovery',
    })
    return { error }
  }, [])

  const updatePassword = React.useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error }
  }, [])

  const updateDisplayName = React.useCallback(async (displayName: string) => {
    const activeUser = state.user
    if (!activeUser) {
      return { error: { message: 'You need to sign in first.' } as AuthError, profile: null }
    }

    const normalizedDisplayName = displayName.trim()
    if (normalizedDisplayName.length < 2) {
      return { error: { message: 'Display name must be at least 2 characters.' } as AuthError, profile: null }
    }
    if (normalizedDisplayName.length > 50) {
      return { error: { message: 'Display name must be 50 characters or less.' } as AuthError, profile: null }
    }

    const nextRole = state.profile?.role || 'user'
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: activeUser.id, display_name: normalizedDisplayName, role: nextRole }, { onConflict: 'id' })
      .select(PROFILE_SELECT)
      .single()

    if (error || !data) {
      return { error: (error || { message: 'Profile could not be updated.' }) as AuthError, profile: null }
    }

    const nextProfile = data as Profile
    cacheUserData(activeUser, nextProfile)
    setState((s) => ({
      ...s,
      profile: nextProfile,
    }))

    await supabase.auth.updateUser({
      data: {
        ...(activeUser.user_metadata || {}),
        display_name: normalizedDisplayName,
      },
    }).catch(() => {})

    return { error: null, profile: nextProfile }
  }, [state.profile?.role, state.user])

  const confirmSessionClaim = React.useCallback(async () => {
    const pending = pendingSessionClaimRef.current
    if (!pending?.userId) {
      return { error: null }
    }

    setAuthTransition('signing_in', pending.email || null)
    try {
      const claim = await claimCurrentSession({
        userId: pending.userId,
        email: pending.email,
        force: true,
        expectedCurrentDeviceSessionId: pending.currentDevice?.deviceSessionId || null,
        meta: {
          source: 'useAuth.sessionClaim.confirm',
          provider: pending.provider || null,
        },
      })
      if (claim.conflict || claim.requiresConfirmation) {
        const nextPending: PendingSessionClaim = {
          ...pending,
          message: claim.message || 'The active device changed while confirming. Review and try again.',
          currentDevice: claim.currentDevice || pending.currentDevice,
          requestedAt: Date.now(),
        }
        setPendingSessionClaim(nextPending)
        setAuthTransition('idle')
        return {
          error: {
            message: nextPending.message,
          } as AuthError,
        }
      }

      sessionClaimAlreadyConfirmedUserIdRef.current = pending.userId
      setPendingSessionClaim(null)
      setGoogleOAuthLoginPending(false)
      const { data } = await supabase.auth.getSession()
      await fetchSessionAndProfileRef.current?.(data.session)
      return { error: null }
    } catch (error) {
      setAuthTransition('idle')
      return {
        error: {
          message: error instanceof Error ? error.message : 'Could not continue this login. Please try again.',
        } as AuthError,
      }
    }
  }, [setAuthTransition, setPendingSessionClaim])

  const cancelSessionClaim = React.useCallback(async () => {
    const pending = pendingSessionClaimRef.current
    setPendingSessionClaim(null)
    setGoogleOAuthLoginPending(false)
    setPasswordRecoveryMode(false)
    sessionClaimAlreadyConfirmedUserIdRef.current = null
    setAuthTransition('signing_out', pending?.email || null)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
    }
    cacheUserData(null, null)
    setHideProtectedBanksLock(true)
    clearUserBankCache(pending?.userId)
    cacheRefreshedForUserIdRef.current = null
    setState((s) => ({
      ...s,
      user: null,
      profile: null,
      loading: false,
      authTransition: {
        status: 'idle',
        email: null,
      },
      offlineTrustedSession: false,
      pendingSessionClaim: null,
      lastSessionValidationAt: null,
      capabilities: fallbackCapabilitiesForProfile(null),
    }))
    authTransitionStatusRef.current = 'idle'
  }, [setAuthTransition, setPendingSessionClaim])

  const clearSessionConflictReason = React.useCallback(() => {
    setSessionConflictReason(null)
  }, [setSessionConflictReason])

  const actions = React.useMemo<AuthActions>(() => ({
    signIn,
    continueOffline,
    signInWithGoogle,
    cancelGoogleSignIn,
    signOut,
    getAuthenticatedAccessToken,
    deleteAccount,
    refreshAccountCapabilities,
    requestPasswordReset,
    verifyPasswordResetCode,
    updatePassword,
    updateDisplayName,
    clearSessionConflictReason,
    confirmSessionClaim,
    cancelSessionClaim,
  }), [
    cancelGoogleSignIn,
    cancelSessionClaim,
    clearSessionConflictReason,
    confirmSessionClaim,
    continueOffline,
    deleteAccount,
    getAuthenticatedAccessToken,
    requestPasswordReset,
    refreshAccountCapabilities,
    signIn,
    signInWithGoogle,
    signOut,
    updateDisplayName,
    updatePassword,
    verifyPasswordResetCode,
  ])

  const combined = React.useMemo<AuthContextValue>(() => ({
    ...state,
    ...actions,
  }), [actions, state])

  return {
    state,
    actions,
    combined,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { state, actions, combined } = useAuthValue()

  return React.createElement(
    AuthStateContext.Provider,
    { value: state },
    React.createElement(
      AuthActionsContext.Provider,
      { value: actions },
      React.createElement(AuthContext.Provider, { value: combined }, children)
    )
  )
}

export function useAuthState(): AuthState {
  const context = React.useContext(AuthStateContext)
  if (!context) {
    throw new Error('useAuthState must be used within AuthProvider')
  }
  return context
}

export function useAuthActions(): AuthActions {
  const context = React.useContext(AuthActionsContext)
  if (!context) {
    throw new Error('useAuthActions must be used within AuthProvider')
  }
  return context
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
