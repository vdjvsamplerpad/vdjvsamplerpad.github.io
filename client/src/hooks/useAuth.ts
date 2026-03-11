import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { User, AuthError, Session } from '@supabase/supabase-js'
import { clearUserBankCache, refreshAccessibleBanksCache } from '@/lib/bank-utils'
import {
  ensureActivityRuntime,
  SessionConflictError,
  checkSessionValidity,
  logSignoutActivity,
  sendActivityHeartbeat,
  sendHeartbeatBeacon,
} from '@/lib/activityLogger'

// Keys for localStorage caching
const USER_CACHE_KEY = 'vdjv-cached-user';
const PROFILE_CACHE_KEY = 'vdjv-cached-profile';
const BAN_CACHE_KEY = 'vdjv-cached-ban';
const OFFLINE_SIGNOUT_PENDING_KEY = 'vdjv-offline-signout-pending';
const SESSION_CONFLICT_REASON_KEY = 'vdjv-session-conflict-reason';
const SESSION_ENFORCEMENT_EVENT_KEY = 'vdjv-session-enforcement-event';
const HIDE_PROTECTED_BANKS_KEY = 'vdjv-hide-protected-banks';
const PROFILE_SELECT = 'id, role, display_name, owned_bank_quota, owned_bank_pad_cap, device_total_bank_cap';

export interface Profile {
  id: string
  role: 'admin' | 'user'
  display_name: string
  owned_bank_quota?: number | null
  owned_bank_pad_cap?: number | null
  device_total_bank_cap?: number | null
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
  banned: boolean
  offlineTrustedSession: boolean
  lastSessionValidationAt: number | null
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
  signOut: () => Promise<{ error?: AuthError | null }>
  requestPasswordReset: (email: string) => Promise<{ error?: AuthError | null }>
  verifyPasswordResetCode: (email: string, code: string) => Promise<{ error?: AuthError | null }>
  updatePassword: (newPassword: string) => Promise<{ error?: AuthError | null }>
  clearSessionConflictReason: () => void
}

type AuthContextValue = AuthState & AuthActions
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

function useAuthValue(): AuthState & AuthActions {
  const cachedBan = getCachedBan()
  const cachedUser = cachedBan ? null : getCachedUser()
  const cachedProfile = cachedBan ? null : getCachedProfile()

  const [state, setState] = React.useState<AuthState>({
    user: cachedUser,
    profile: cachedProfile,
    loading: true,
    authTransition: {
      status: 'idle',
      email: null,
    },
    sessionConflictReason: getCachedSessionConflictReason(),
    banned: cachedBan,
    offlineTrustedSession: Boolean(cachedUser && (typeof navigator !== 'undefined' ? !navigator.onLine : false)),
    lastSessionValidationAt: null,
  })
  
  // Track which user we've already refreshed cache for
  const cacheRefreshedForUserIdRef = React.useRef<string | null>(null)
  const sessionConflictLockedRef = React.useRef(false)
  const authTransitionStatusRef = React.useRef<AuthState['authTransition']['status']>('idle')

  React.useEffect(() => {
    authTransitionStatusRef.current = state.authTransition.status
  }, [state.authTransition.status])

  React.useEffect(() => {
    ensureActivityRuntime()
  }, [])

  const setBannedState = React.useCallback((banned: boolean) => {
    cacheBanState(banned)
    setState((s) => (s.banned === banned ? s : { ...s, banned }))
  }, [])

  const setSessionConflictReason = React.useCallback((reason: string | null) => {
    setCachedSessionConflictReason(reason)
    setState((s) => (s.sessionConflictReason === reason ? s : { ...s, sessionConflictReason: reason }))
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
      lastSessionValidationAt: null,
    }))
    try {
      await supabase.auth.signOut({ scope: 'global' })
    } catch {
    }
  }, [])

  const enforceSessionConflict = React.useCallback(async (reason?: string) => {
    if (sessionConflictLockedRef.current) return
    sessionConflictLockedRef.current = true
    const message = reason || 'This account was used on another device. You were signed out on this device.'
    const currentUser = state.user || getCachedUser()
    setPendingOfflineSignout(false)
    setHideProtectedBanksLock(true)
    setSessionConflictReason(message)
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
      lastSessionValidationAt: null,
    }))
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
    }
  }, [setSessionConflictReason, state.user])

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
      .upsert({ id: user.id, display_name: displayName, role: 'user' }, { onConflict: 'id' })
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
          lastSessionValidationAt: null
        }))
        return
      }
      if (session?.user) {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        const transientAuthError = isTransientNetworkError(authError)
        const fallbackCachedUser = getCachedUser() || session.user
        const authUser = authData?.user || (transientAuthError ? fallbackCachedUser : null)

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
        setHideProtectedBanksLock(false)
        setSessionConflictReason(null)

        const { data: profile, error } = await loadProfile(authUser.id)

        if (error) {
          if (isTransientNetworkError(error)) {
            const fallbackProfile = getCachedProfile()
            cacheUserData(authUser, fallbackProfile)
            setState((s) => ({
              ...s,
              user: authUser,
              profile: fallbackProfile,
              loading: false,
              authTransition: {
                status: 'idle',
                email: null,
              },
              offlineTrustedSession: true
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
              lastSessionValidationAt: null
            }))
          }
        } else {
          const resolvedProfile = profile ? (profile as Profile) : await ensureProfile(authUser)
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
            lastSessionValidationAt: Date.now()
          }))
        }
        
        // Refresh accessible banks cache ONLY once per user session (not on every auth state change)
        if (cacheRefreshedForUserIdRef.current !== authUser.id) {
          cacheRefreshedForUserIdRef.current = authUser.id
          refreshAccessibleBanksCache(authUser.id).catch(() => {})
        }
      } else {
        const fallbackUser = getCachedUser()
        const fallbackProfile = getCachedProfile()
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

        if (isOffline && fallbackUser) {
          setHideProtectedBanksLock(false)
          cacheUserData(fallbackUser, fallbackProfile)
          setState((s) => ({
            ...s,
            user: fallbackUser,
            profile: fallbackProfile,
            loading: false,
            authTransition: {
              status: 'idle',
              email: null,
            },
            offlineTrustedSession: true
          }))
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
          lastSessionValidationAt: null
        }))
      }
    }

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        fetchSessionAndProfile(session)
      })
      .catch((error) => {
        if (isTransientNetworkError(error) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          const fallbackUser = getCachedUser()
          const fallbackProfile = getCachedProfile()
          if (fallbackUser) {
            setHideProtectedBanksLock(false)
            setState((s) => ({
              ...s,
              user: fallbackUser,
              profile: fallbackProfile,
              loading: false,
              authTransition: {
                status: 'idle',
                email: null,
              },
              offlineTrustedSession: true
            }))
            return
          }
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
          lastSessionValidationAt: null
        }))
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      fetchSessionAndProfile(session)
    })

    return () => subscription.unsubscribe()
  }, [ensureProfile, enforceBan, setBannedState, setSessionConflictReason])

  React.useEffect(() => {
    if (!state.user || state.banned) return
    if (state.profile?.role === 'admin') return
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
          void enforceSessionConflict(err.message)
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
          void enforceSessionConflict(err.message)
        }
      })

    const interval = window.setInterval(heartbeat, 180_000)
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
            void enforceSessionConflict(err.message)
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
            void enforceSessionConflict(err.message)
          }
        })
      refreshAccessibleBanksCache(state.user!.id).catch(() => {})
      void (async () => {
        try {
          const { data, error } = await loadProfile(state.user!.id)
          if (error || !data) return
          cacheUserData(state.user!, data)
          setState((s) => ({
            ...s,
            profile: data
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
    sessionConflictLockedRef.current = false
    setAuthTransition('signing_in', email)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data?.user) {
      setHideProtectedBanksLock(false)
      setState((s) => ({
        ...s,
        offlineTrustedSession: false
      }))
    } else {
      setAuthTransition('idle')
    }
    if (isBanError(error)) {
      await enforceBan()
    }
    return { error, data: { user: data.user } }
  }, [enforceBan, setAuthTransition, setSessionConflictReason])

  const signOut = React.useCallback(async () => {
    if (authTransitionStatusRef.current === 'signing_out') {
      return { error: null }
    }
    const activeUser = state.user || getCachedUser()
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPendingOfflineSignout(true)
      setHideProtectedBanksLock(true)
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
    const { error } = await supabase.auth.signOut()
    if (error) {
      setAuthTransition('idle')
    }
    setPendingOfflineSignout(false)
    setHideProtectedBanksLock(true)
    // Clear cached user data on sign out
    cacheUserData(null, null)
    clearUserBankCache(activeUser?.id)
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

  const verifyPasswordResetCode = React.useCallback(async (email: string, code: string) => {
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

  const clearSessionConflictReason = React.useCallback(() => {
    setSessionConflictReason(null)
  }, [setSessionConflictReason])

  return {
    ...state,
    signIn,
    signOut,
    requestPasswordReset,
    verifyPasswordResetCode,
    updatePassword,
    clearSessionConflictReason,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useAuthValue()
  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
