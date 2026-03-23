import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CopyableValue } from '@/components/ui/copyable-value'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PaymentReceiptCard } from '@/components/ui/payment-receipt-card'
import { isPasswordRecoveryMode, setPasswordRecoveryMode, useAuthActions, useAuthState } from '@/hooks/useAuth'
import { ensureActivityRuntime, logActivityEvent } from '@/lib/activityLogger'
import { edgeFunctionUrl } from '@/lib/edge-api'
import { optimizeReceiptProofFile, runReceiptOcr } from '@/lib/receipt-ocr'
import { supabase } from '@/lib/supabase'
import { ArrowRight, Download, Eye, EyeOff, ExternalLink, Loader2, X } from 'lucide-react'

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme?: 'light' | 'dark'
  appReturnUrl?: string
  pushNotice?: (opts: { variant: 'success' | 'error' | 'info'; message: string }) => void
}

type Mode = 'signin' | 'buy' | 'forgot' | 'reset'
type PaymentChannel = 'image_proof' | 'gcash_manual' | 'maya_manual'

type PaymentConfig = {
  instructions?: string
  gcash_number?: string
  maya_number?: string
  messenger_url?: string
  qr_image_path?: string
  account_price_php?: number | null
}

type BuyStep = 'account' | 'payment'
type BuyReceiptState = {
  amountText: string
  submittedAt: string
  receiptNo: string
  paymentReference: string
  message: string
  status?: 'success' | 'pending'
  statusLabel?: string
}

type SignInPendingState = {
  email: string
  checkedAt: string
  message: string
}

const ACCOUNT_PROOF_MAX_BYTES = 10 * 1024 * 1024
const ACCOUNT_PROOF_ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'])
const ACCOUNT_PROOF_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])
const RESET_CODE_MAX_ATTEMPTS = 5
const RESET_CODE_LOCKOUT_MINUTES = 10
const RESET_CODE_LOCKOUT_MS = RESET_CODE_LOCKOUT_MINUTES * 60 * 1000

function getResetVerifyAttemptKey(email: string): string {
  return `password_reset_verify_${email.trim().toLowerCase()}`
}

function readResetVerifyAttemptState(email: string): { failures: number; blockedUntil: number | null } {
  if (typeof window === 'undefined') return { failures: 0, blockedUntil: null }
  try {
    const raw = localStorage.getItem(getResetVerifyAttemptKey(email))
    if (!raw) return { failures: 0, blockedUntil: null }
    const parsed = JSON.parse(raw) as { failures?: number; blockedUntil?: number | null }
    return {
      failures: Number.isFinite(parsed?.failures) ? Math.max(0, Number(parsed.failures)) : 0,
      blockedUntil: typeof parsed?.blockedUntil === 'number' ? parsed.blockedUntil : null,
    }
  } catch {
    return { failures: 0, blockedUntil: null }
  }
}

function writeResetVerifyAttemptState(email: string, next: { failures: number; blockedUntil: number | null }): void {
  if (typeof window === 'undefined') return
  try {
    if (next.failures <= 0 && !next.blockedUntil) {
      localStorage.removeItem(getResetVerifyAttemptKey(email))
      return
    }
    localStorage.setItem(getResetVerifyAttemptKey(email), JSON.stringify(next))
  } catch {
  }
}

function normalizeAuthErrorMessage(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid email or password') || m.includes('invalid credentials')) {
    return 'Incorrect email or password. Please try again.'
  }
  if (m.includes('banned') || m.includes('suspended') || m.includes('disabled')) {
    return 'Your account is banned. Please contact support in Facebook Messenger.'
  }
  if (m.includes('email') && m.includes('invalid')) return 'Email address is invalid.'
  if (m.includes('already registered') || m.includes('already exists')) return 'This email is already registered.'
  if (m.includes('rate limit')) return 'Too many attempts. Please try again later.'
  if (
    m.includes('token has expired') ||
    m.includes('token may be expired') ||
    m.includes('invalid token') ||
    m.includes('otp expired') ||
    m.includes('otp') && m.includes('expired')
  ) {
    return 'Reset code is invalid or expired. Request a new code and try again.'
  }
  if (
    m.includes('same password') ||
    m.includes('different from the old password') ||
    m.includes('new password should be different')
  ) {
    return 'New password must be different from your current password. Enter a different password and try again.'
  }
  if (m.includes('please wait') && m.includes('minute')) return msg
  if (m.includes('unable to verify email')) return 'Unable to verify email. Please try again.'
  return msg || 'We could not complete that right now. Please try again.'
}

function isInvalidCredentialErrorMessage(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('invalid login') || m.includes('invalid email or password') || m.includes('invalid credentials')
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function getFileExt(name: string): string {
  return String(name.split('.').pop() || '').toLowerCase()
}

function validateProofFile(file: File): string | null {
  if (!file) return 'Please upload your proof of payment.'
  if (file.size <= 0) return 'Selected proof file is empty.'
  if (file.size > ACCOUNT_PROOF_MAX_BYTES) {
    return `Proof file is too large. Max is ${Math.ceil(ACCOUNT_PROOF_MAX_BYTES / (1024 * 1024))}MB.`
  }
  const ext = getFileExt(file.name)
  const mime = String(file.type || '').toLowerCase()
  const extAllowed = ACCOUNT_PROOF_ALLOWED_EXTENSIONS.has(ext)
  const mimeAllowed = !mime || ACCOUNT_PROOF_ALLOWED_MIME_TYPES.has(mime)
  if (!extAllowed || !mimeAllowed) {
    return 'Unsupported image format. Please upload PNG, JPG, WEBP, GIF, or HEIC/HEIF.'
  }
  return null
}

function mapRegistrationError(code: string, payload: Record<string, unknown>): string {
  if (code === 'EMAIL_ALREADY_REGISTERED') {
    return 'This email is already registered and approved. Please log in instead.'
  }
  if (code === 'ACCOUNT_REGISTRATION_PENDING') {
    return 'This email already has a pending registration. Please wait for review or check your email.'
  }
  if (code === 'WEAK_PASSWORD') {
    const minLength = Number(payload?.min_length || 8)
    return `Password must be at least ${minLength} characters.`
  }
  if (code === 'PASSWORD_MISMATCH') {
    return 'Passwords do not match.'
  }
  if (code === 'PROOF_TOO_LARGE') {
    const maxBytes = Number(payload?.max_bytes || ACCOUNT_PROOF_MAX_BYTES)
    return `Proof file is too large. Max is ${Math.ceil(maxBytes / (1024 * 1024))}MB.`
  }
  if (code === 'RATE_LIMITED') {
    return 'Too many requests right now. Please try again later.'
  }
  if (code === 'INVALID_PROOF_PATH') {
    return 'Uploaded proof could not be verified. Please upload again.'
  }
  return code || 'We could not submit your registration. Please try again.'
}

function formatPhp(value: number): string {
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function LoginModal({ open, onOpenChange, theme = 'light', appReturnUrl, pushNotice }: LoginModalProps) {
  const [signInError, setSignInError] = React.useState<string | null>(null)
  const [signInCooldownSeconds, setSignInCooldownSeconds] = React.useState(0)
  const [failedSignInAttempts, setFailedSignInAttempts] = React.useState(0)
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [mode, setMode] = React.useState<Mode>('signin')
  const [loading, setLoading] = React.useState(false)
  const [awaitingSignInSync, setAwaitingSignInSync] = React.useState(false)
  const [resetCooldown, setResetCooldown] = React.useState<number>(0)
  const [allowLoginWhileBanned, setAllowLoginWhileBanned] = React.useState(false)

  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)
  const [showResetPassword, setShowResetPassword] = React.useState(false)
  const [showResetConfirmPassword, setShowResetConfirmPassword] = React.useState(false)

  const [paymentConfig, setPaymentConfig] = React.useState<PaymentConfig | null>(null)
  const [paymentConfigLoading, setPaymentConfigLoading] = React.useState(false)
  const [buyStep, setBuyStep] = React.useState<BuyStep>('account')
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>('image_proof')
  const [payerName, setPayerName] = React.useState('')
  const [referenceNo, setReferenceNo] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [proofFile, setProofFile] = React.useState<File | null>(null)
  const [proofPreviewUrl, setProofPreviewUrl] = React.useState<string | null>(null)
  const [proofOcrLoading, setProofOcrLoading] = React.useState(false)
  const [buyReceipt, setBuyReceipt] = React.useState<BuyReceiptState | null>(null)
  const [signInPendingState, setSignInPendingState] = React.useState<SignInPendingState | null>(null)
  const [expandedQrUrl, setExpandedQrUrl] = React.useState<string | null>(null)
  const [resetCode, setResetCode] = React.useState('')
  const [resetCodeFailures, setResetCodeFailures] = React.useState(0)
  const [resetCodeBlockedSeconds, setResetCodeBlockedSeconds] = React.useState(0)
  const [resetCodeVerified, setResetCodeVerified] = React.useState(false)
  const proofOcrSeqRef = React.useRef(0)

  const {
    user,
    authTransition,
    sessionConflictReason,
    banned,
  } = useAuthState()
  const {
    signIn,
    requestPasswordReset,
    verifyPasswordResetCode,
    updatePassword,
    clearSessionConflictReason,
  } = useAuthActions()

  const colorText = theme === 'dark' ? 'text-white' : 'text-gray-900'
  const panelClass = `sm:max-w-xl ${theme === 'dark' ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`
  const isDark = theme === 'dark'
  const isSignInSyncing = authTransition.status === 'signing_in'
  const isSignInBusy = loading || awaitingSignInSync || isSignInSyncing
  const isLoginSubmitting = mode === 'signin' && isSignInBusy
  const isBuySubmitting = mode === 'buy' && buyStep === 'payment' && loading

  const logLoginAttempt = React.useCallback((input: {
    status: 'success' | 'failed'
    email: string
    userId?: string
    errorMessage?: string
  }) => {
    void logActivityEvent({
      eventType: 'auth.login',
      status: input.status,
      userId: input.userId || null,
      email: input.email,
      errorMessage: input.errorMessage || null,
      meta: { source: 'LoginModal' },
    }).catch(() => {})
  }, [])

  const postPublicStoreApi = React.useCallback(async (route: string, body: Record<string, unknown>) => {
    const res = await fetch(edgeFunctionUrl('store-api', route), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const data = (payload?.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>
    const code = String(payload?.error || data?.error || '').trim()
    return { res, payload, data, code }
  }, [])

  const downloadQrImage = React.useCallback(async (url: string) => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = 'vdjv-payment-qr'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      return
    } catch {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.click()
    }
  }, [])

  React.useEffect(() => {
    ensureActivityRuntime()
  }, [])

  React.useEffect(() => {
    if (!open) {
      if (isPasswordRecoveryMode()) {
        void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      }
      setPasswordRecoveryMode(false)
      setLoading(false)
      setAwaitingSignInSync(false)
      setSignInError(null)
      setSignInCooldownSeconds(0)
      setFailedSignInAttempts(0)
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setMode('signin')
      setResetCooldown(0)
      setShowPassword(false)
      setShowConfirmPassword(false)
      setShowResetPassword(false)
      setShowResetConfirmPassword(false)
      setBuyStep('account')
      setPaymentChannel('image_proof')
      setPayerName('')
      setReferenceNo('')
      setNotes('')
      setResetCode('')
      setProofFile(null)
      setProofPreviewUrl(null)
      setProofOcrLoading(false)
      setBuyReceipt(null)
      setSignInPendingState(null)
      setExpandedQrUrl(null)
      setResetCodeFailures(0)
      setResetCodeBlockedSeconds(0)
      setResetCodeVerified(false)
      if (banned) setAllowLoginWhileBanned(false)
    }
  }, [open, banned])

  React.useEffect(() => {
    if (!awaitingSignInSync) return
    if (authTransition.status !== 'idle') return

    if (user) {
      setLoading(false)
      setAwaitingSignInSync(false)
      pushNotice?.({ variant: 'success', message: 'Logged in successfully.' })
      onOpenChange(false)
      return
    }

    setLoading(false)
    setAwaitingSignInSync(false)
    pushNotice?.({ variant: 'error', message: 'Sign-in sync did not finish. Please try again.' })
  }, [authTransition.status, awaitingSignInSync, onOpenChange, pushNotice, user])

  React.useEffect(() => {
    if (open && email) {
      const recentResetKey = `password_reset_${email}`
      const lastResetTime = localStorage.getItem(recentResetKey)
      if (lastResetTime) {
        const now = Date.now()
        const fiveMinutes = 5 * 60 * 1000
        const timeRemaining = Math.max(0, fiveMinutes - (now - Number(lastResetTime)))
        if (timeRemaining > 0) {
          setResetCooldown(Math.ceil(timeRemaining / 1000 / 60))
        }
      }
    }
  }, [open, email])

  React.useEffect(() => {
    if (resetCooldown > 0) {
      const timer = window.setTimeout(() => {
        setResetCooldown((prev) => Math.max(0, prev - 1))
      }, 60000)
      return () => window.clearTimeout(timer)
    }
  }, [resetCooldown])

  React.useEffect(() => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setResetCodeFailures(0)
      setResetCodeBlockedSeconds(0)
      return
    }
    const syncResetVerifyState = () => {
      const attemptState = readResetVerifyAttemptState(normalizedEmail)
      setResetCodeFailures(attemptState.failures)
      if (attemptState.blockedUntil && attemptState.blockedUntil > Date.now()) {
        setResetCodeBlockedSeconds(Math.ceil((attemptState.blockedUntil - Date.now()) / 1000))
        return
      }
      if (attemptState.blockedUntil) {
        writeResetVerifyAttemptState(normalizedEmail, { failures: attemptState.failures, blockedUntil: null })
      }
      setResetCodeBlockedSeconds(0)
    }
    syncResetVerifyState()
    if (mode !== 'reset') return
    const timer = window.setInterval(syncResetVerifyState, 1000)
    return () => window.clearInterval(timer)
  }, [email, mode])

  React.useEffect(() => {
    if (signInCooldownSeconds <= 0) return
    const timer = window.setTimeout(() => {
      setSignInCooldownSeconds((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [signInCooldownSeconds])

  React.useEffect(() => {
    if (!sessionConflictReason) return
    if (mode === 'reset' || isPasswordRecoveryMode()) {
      clearSessionConflictReason()
      return
    }
    if (!open) onOpenChange(true)
    pushNotice?.({ variant: 'error', message: sessionConflictReason })
    clearSessionConflictReason()
  }, [sessionConflictReason, onOpenChange, open, pushNotice, clearSessionConflictReason, mode])

  React.useEffect(() => {
    if (!banned) setAllowLoginWhileBanned(false)
  }, [banned])

  React.useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(proofFile)
    setProofPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [proofFile])

  React.useEffect(() => {
    if (paymentChannel === 'image_proof') {
      proofOcrSeqRef.current += 1
      setProofOcrLoading(false)
      setPayerName('')
      setReferenceNo('')
    }
  }, [paymentChannel])

  const accountPriceText = React.useMemo(() => {
    const raw = paymentConfig?.account_price_php
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return formatPhp(raw)
    }
    return 'To be confirmed'
  }, [paymentConfig?.account_price_php])

  const handleBuyProofFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0] || null
      if (!nextFile) {
        proofOcrSeqRef.current += 1
        setProofFile(null)
        setReferenceNo('')
        setPayerName('')
        setProofOcrLoading(false)
        return
      }
      const proofError = validateProofFile(nextFile)
      if (proofError) {
        proofOcrSeqRef.current += 1
        setProofOcrLoading(false)
        pushNotice?.({ variant: 'error', message: proofError })
        event.target.value = ''
        return
      }
      setReferenceNo('')
      setPayerName('')
      if (paymentChannel !== 'image_proof') {
        setProofFile(nextFile)
        proofOcrSeqRef.current += 1
        setProofOcrLoading(false)
        return
      }

      const seq = proofOcrSeqRef.current + 1
      proofOcrSeqRef.current = seq
      setProofOcrLoading(true)
      void (async () => {
        const preparedFile = await optimizeReceiptProofFile(nextFile).catch(() => nextFile)
        if (proofOcrSeqRef.current !== seq) return
        setProofFile(preparedFile)
        const result = await runReceiptOcr({
          file: preparedFile,
          context: 'account_registration',
          email: email.trim().toLowerCase() || null,
          subject: email.trim().toLowerCase() || null,
          // Avoid immediate server OCR call; submit flow only escalates to backend OCR when automation is enabled.
          fallbackToServer: false,
        })
        if (proofOcrSeqRef.current !== seq) return
        if (result.detected.referenceNo) setReferenceNo(result.detected.referenceNo)
        else setReferenceNo('')
        if (result.detected.payerName) setPayerName(result.detected.payerName)
        setProofOcrLoading(false)
      })()
    },
    [email, paymentChannel, pushNotice],
  )

  const handleBuyNext = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      const normalizedEmail = email.trim().toLowerCase()
      if (!isValidEmail(normalizedEmail)) {
        pushNotice?.({ variant: 'error', message: 'Enter a valid email address.' })
        return
      }
      if (password.length < 8) {
        pushNotice?.({ variant: 'error', message: 'Password must be at least 8 characters.' })
        return
      }
      if (password !== confirmPassword) {
        pushNotice?.({ variant: 'error', message: 'Passwords do not match.' })
        return
      }
      setBuyStep('payment')
    },
    [confirmPassword, email, password, pushNotice],
  )

  React.useEffect(() => {
    if (!open || (mode !== 'buy' && mode !== 'signin')) return
    let active = true
    setPaymentConfigLoading(true)
    fetch(edgeFunctionUrl('store-api', 'payment-config'))
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const data = (payload?.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>
        if (!active) return
        if (!res.ok || payload?.ok === false) {
          setPaymentConfig(null)
          return
        }
        setPaymentConfig((data?.config as PaymentConfig | null) || null)
      })
      .catch(() => {
        if (active) setPaymentConfig(null)
      })
      .finally(() => {
        if (active) setPaymentConfigLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, mode])

  const RecoveryLandingHelper = () => null

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) {
      pushNotice?.({ variant: 'error', message: 'Email and password are required.' })
      return
    }
    if (signInCooldownSeconds > 0) {
      setSignInError(`Please wait ${signInCooldownSeconds}s before trying again.`)
      return
    }

    setSignInError(null)
    setSignInPendingState(null)
    setLoading(true)
    let waitForAuthSync = false
    try {
      const { error, data } = await signIn(normalizedEmail, password)
      if (error) {
        logLoginAttempt({ status: 'failed', email: normalizedEmail, errorMessage: error.message })

        if (isInvalidCredentialErrorMessage(error.message)) {
          const hint = await postPublicStoreApi('account-registration/login-hint', { email: normalizedEmail })
          if (hint.res.ok && String(hint.code || '') === '' && typeof hint.data?.status === 'string') {
            const status = String(hint.data.status)
            if (status === 'pending') {
              setSignInError(null)
              setPassword('')
              setSignInPendingState({
                email: normalizedEmail,
                checkedAt: new Date().toISOString(),
                message: 'Your registration is still under review. Please wait up to 24 hours and check your email for approval updates.',
              })
            } else if (status === 'rejected') {
              setSignInError(null)
              const reason = String(hint.data.rejection_message || '').trim()
              pushNotice?.({
                variant: 'error',
                message: reason
                  ? `Your registration was not approved: ${reason}. You can submit a new account request with the same email.`
                  : 'Your registration was not approved. You can submit a new account request with the same email.',
              })
            } else if (status === 'none') {
              const nextAttempts = failedSignInAttempts + 1
              const nextCooldown = nextAttempts >= 5 ? 30 : 3
              setFailedSignInAttempts(nextAttempts)
              setSignInCooldownSeconds(nextCooldown)
              setSignInError(
                nextAttempts >= 5
                  ? `Incorrect email or password. Too many failed attempts. Try again in ${nextCooldown}s.`
                  : 'Incorrect email or password. Please try again.',
              )
            } else {
              const nextAttempts = failedSignInAttempts + 1
              const nextCooldown = nextAttempts >= 5 ? 30 : 3
              setFailedSignInAttempts(nextAttempts)
              setSignInCooldownSeconds(nextCooldown)
              setSignInError(
                nextAttempts >= 5
                  ? `Incorrect email or password. Too many failed attempts. Try again in ${nextCooldown}s.`
                  : 'Incorrect email or password. Please try again.',
              )
            }
          } else {
            const nextAttempts = failedSignInAttempts + 1
            const nextCooldown = nextAttempts >= 5 ? 30 : 3
            setFailedSignInAttempts(nextAttempts)
            setSignInCooldownSeconds(nextCooldown)
            setSignInError(
              nextAttempts >= 5
                ? `Incorrect email or password. Too many failed attempts. Try again in ${nextCooldown}s.`
                : 'Incorrect email or password. Please try again.',
            )
          }
        } else {
          setSignInError(null)
          pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(error.message) })
        }
        return
      }

      setSignInError(null)
      setFailedSignInAttempts(0)
      setSignInCooldownSeconds(0)
      logLoginAttempt({ status: 'success', email: normalizedEmail, userId: data?.user?.id || undefined })
      waitForAuthSync = true
      setAwaitingSignInSync(true)
    } catch {
      pushNotice?.({ variant: 'error', message: 'We could not complete that right now. Please try again.' })
    } finally {
      if (!waitForAuthSync) {
        setLoading(false)
      }
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      pushNotice?.({ variant: 'error', message: 'Please enter your email.' })
      return
    }

    setLoading(true)
    try {
      const { error } = await requestPasswordReset(email.trim().toLowerCase())
      if (error) {
        pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(error.message) })
        if (error.message.includes('Please wait')) {
          const match = error.message.match(/(\d+)/)
          if (match) setResetCooldown(Number(match[1]))
        }
      } else {
        pushNotice?.({ variant: 'success', message: 'If the email is registered, a reset code was sent. Check your email and enter the code here.' })
        setPasswordRecoveryMode(false)
        setResetCodeVerified(false)
        setMode('reset')
        setResetCooldown(5)
      }
    } catch {
      pushNotice?.({ variant: 'error', message: 'We could not complete that right now. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const discardRecoverySession = React.useCallback(async () => {
    setPasswordRecoveryMode(false)
    setResetCodeVerified(false)
    clearSessionConflictReason()
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
    }
  }, [clearSessionConflictReason])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedResetCode = resetCode.trim()
    if (!isValidEmail(normalizedEmail)) {
      pushNotice?.({ variant: 'error', message: 'Enter a valid email address.' })
      return
    }
    if (!normalizedResetCode) {
      pushNotice?.({ variant: 'error', message: 'Enter the reset code from your email or spam folder.' })
      return
    }
    if (password.length < 8) {
      pushNotice?.({ variant: 'error', message: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirmPassword) {
      pushNotice?.({ variant: 'error', message: 'Passwords do not match.' })
      return
    }
    if (resetCodeBlockedSeconds > 0) {
      const waitMinutes = Math.ceil(resetCodeBlockedSeconds / 60)
      pushNotice?.({ variant: 'error', message: `Too many invalid reset code attempts. Please wait ${waitMinutes} minute${waitMinutes > 1 ? 's' : ''} before trying again.` })
      return
    }

    setLoading(true)
    try {
      if (!resetCodeVerified) {
        setPasswordRecoveryMode(true)
        const { error: verifyError } = await verifyPasswordResetCode(normalizedEmail, normalizedResetCode)
        if (verifyError) {
          setPasswordRecoveryMode(false)
          const currentAttemptState = readResetVerifyAttemptState(normalizedEmail)
          const nextFailures = currentAttemptState.failures + 1
          const blockedUntil = nextFailures >= RESET_CODE_MAX_ATTEMPTS ? Date.now() + RESET_CODE_LOCKOUT_MS : null
          writeResetVerifyAttemptState(normalizedEmail, { failures: nextFailures, blockedUntil })
          setResetCodeFailures(nextFailures)
          setResetCodeBlockedSeconds(blockedUntil ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0)
          pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(verifyError.message) })
          return
        }
        setResetCodeVerified(true)
      }
      writeResetVerifyAttemptState(normalizedEmail, { failures: 0, blockedUntil: null })
      setResetCodeFailures(0)
      setResetCodeBlockedSeconds(0)
      const { error } = await updatePassword(password)
      if (error) {
        const normalizedError = normalizeAuthErrorMessage(error.message)
        pushNotice?.({
          variant: 'error',
          message: `${normalizedError} You can try again with a different password without requesting a new reset code.`,
        })
      } else {
        await discardRecoverySession()
        setMode('signin')
        onOpenChange(false)
        pushNotice?.({ variant: 'success', message: 'Password updated. Please sign in with your new password.' })
      }
    } catch {
      pushNotice?.({ variant: 'error', message: 'We could not complete that right now. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const handleResendResetCode = React.useCallback(async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      pushNotice?.({ variant: 'error', message: 'Enter a valid email address.' })
      return
    }
    if (resetCooldown > 0) {
      pushNotice?.({ variant: 'error', message: `Please wait ${resetCooldown} minute${resetCooldown > 1 ? 's' : ''} before requesting another reset.` })
      return
    }
    setLoading(true)
    try {
      const { error } = await requestPasswordReset(normalizedEmail)
      if (error) {
        pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(error.message) })
        if (error.message.includes('Please wait')) {
          const match = error.message.match(/(\d+)/)
          if (match) setResetCooldown(Number(match[1]))
        }
        return
      }
      pushNotice?.({ variant: 'success', message: 'If the email is registered, a new reset code was sent.' })
      await discardRecoverySession()
      setResetCodeVerified(false)
      setResetCooldown(5)
    } catch {
      pushNotice?.({ variant: 'error', message: 'We could not complete that right now. Please try again.' })
    } finally {
      setLoading(false)
    }
  }, [discardRecoverySession, email, pushNotice, requestPasswordReset, resetCooldown])

  const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && isSignInBusy) {
      return
    }
    if (!nextOpen && (mode === 'reset' || resetCodeVerified || isPasswordRecoveryMode())) {
      void discardRecoverySession()
    }
    if (!nextOpen && banned) setAllowLoginWhileBanned(false)
    onOpenChange(nextOpen)
  }, [banned, discardRecoverySession, isSignInBusy, mode, onOpenChange, resetCodeVerified])

  const handleBuySubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPassword = password
    const normalizedConfirmPassword = confirmPassword
    const normalizedPayerName = payerName.trim()
    const normalizedReferenceNo = referenceNo.trim()
    const normalizedNotes = notes.trim()

    if (!isValidEmail(normalizedEmail)) {
      pushNotice?.({ variant: 'error', message: 'Enter a valid email address.' })
      return
    }
    if (normalizedPassword.length < 8) {
      pushNotice?.({ variant: 'error', message: 'Password must be at least 8 characters.' })
      return
    }
    if (normalizedPassword !== normalizedConfirmPassword) {
      pushNotice?.({ variant: 'error', message: 'Passwords do not match.' })
      return
    }

    if ((paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && !normalizedPayerName) {
      pushNotice?.({ variant: 'error', message: 'Please enter the account name used for payment.' })
      return
    }
    if ((paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && !normalizedReferenceNo) {
      pushNotice?.({ variant: 'error', message: 'Please enter your payment reference/transaction number.' })
      return
    }

    if (paymentChannel === 'image_proof' && !proofFile) {
      pushNotice?.({ variant: 'error', message: 'Please upload proof of payment.' })
      return
    }

    if (proofFile) {
      const proofError = validateProofFile(proofFile)
      if (proofError) {
        pushNotice?.({ variant: 'error', message: proofError })
        return
      }
    }

    setLoading(true)
    try {
      let proofPath: string | null = null

      if (proofFile) {
        const uploadReq = await postPublicStoreApi('account-registration/proof-upload-url', {
          email: normalizedEmail,
          fileName: proofFile.name,
          contentType: proofFile.type || 'application/octet-stream',
          paymentChannel,
          sizeBytes: proofFile.size,
        })

        if (!uploadReq.res.ok || uploadReq.code) {
          pushNotice?.({ variant: 'error', message: mapRegistrationError(uploadReq.code, uploadReq.payload) })
          return
        }

        const bucket = String(uploadReq.data?.bucket || 'payment-proof')
        const path = String(uploadReq.data?.path || '')
        const token = String(uploadReq.data?.token || '')
        if (!path || !token) {
          pushNotice?.({ variant: 'error', message: 'We could not prepare your proof upload. Please try again.' })
          return
        }

        const upload = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, proofFile)
        if (upload.error) {
          pushNotice?.({ variant: 'error', message: 'Your proof upload did not complete. Please try again.' })
          return
        }
        proofPath = path
      }

      const submitRes = await postPublicStoreApi('account-registration/submit', {
        email: normalizedEmail,
        password: normalizedPassword,
        confirmPassword: normalizedConfirmPassword,
        paymentChannel,
        payerName: normalizedPayerName || null,
        referenceNo: normalizedReferenceNo || null,
        notes: normalizedNotes || null,
        proofPath,
      })

      if (!submitRes.res.ok || submitRes.code) {
        pushNotice?.({ variant: 'error', message: mapRegistrationError(submitRes.code, submitRes.payload) })
        return
      }

      const waitMessage = String(
        submitRes.data?.wait_message ||
          'Your account request is under confirmation. Please wait up to 24 hours and check your email for updates.',
      )
      const noResultMessage = paymentConfig?.messenger_url
        ? 'If no result after 24 hours, message us on Facebook Messenger.'
        : 'If no result after 24 hours, please contact us on Facebook Messenger.'
      const submitStatus = String(submitRes.data?.status || 'pending')
      const isApproved = submitStatus === 'approved'

      setBuyReceipt({
        amountText: accountPriceText,
        submittedAt: new Date().toISOString(),
        receiptNo: String(submitRes.data?.receipt_reference || submitRes.data?.requestId || 'Pending verification'),
        paymentReference: String(
          submitRes.data?.reference_no ||
            normalizedReferenceNo ||
            (paymentChannel === 'image_proof' ? 'Not detected' : 'Not provided'),
        ),
        message: isApproved
          ? 'Your payment passed verification and your account is now approved. You can sign in right away.'
          : `${waitMessage} ${noResultMessage}`,
        status: isApproved ? 'success' : 'pending',
        statusLabel: isApproved ? 'Approved' : 'Pending Approval',
      })
      setPassword('')
      setConfirmPassword('')
      setPayerName('')
      setReferenceNo('')
      setNotes('')
      setProofFile(null)
    } catch {
      pushNotice?.({ variant: 'error', message: 'Registration was not submitted. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const Title = () => {
    switch (mode) {
      case 'buy':
        return <>Registration</>
      case 'forgot':
        return <>Forgot Password</>
      case 'reset':
        return <>Reset Password</>
      default:
        return <>Login</>
    }
  }

  if (banned && !allowLoginWhileBanned) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 px-6">
        <div className="w-full max-w-md rounded-lg border border-red-500/40 bg-gray-900 p-6 text-center text-white shadow-lg">
          <div className="text-lg font-semibold">Account Temporarily Restricted</div>
          <p className="mt-2 text-sm text-gray-300">
            Your account is banned. If you believe this is a mistake, please contact support in Facebook Messenger.
          </p>
          <div className="mt-4">
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                setAllowLoginWhileBanned(true)
                setMode('signin')
                setPassword('')
                setConfirmPassword('')
                onOpenChange(true)
              }}
            >
              Continue to Sign In
            </Button>
          </div>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-gray-700 bg-gray-800 text-white hover:bg-gray-700"
              onClick={() => {
                setAllowLoginWhileBanned(false)
                onOpenChange(false)
              }}
            >
              Close
            </Button>
          </div>
          {appReturnUrl && (
            <div className="mt-4">
              <a className="underline text-sm" href={appReturnUrl}>
                Return to the app
              </a>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent className={panelClass} aria-describedby={undefined} hideCloseButton>
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className={colorText}>
              <Title />
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`h-8 w-8 shrink-0 ${isDark ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
              onClick={() => handleDialogOpenChange(false)}
              disabled={isSignInBusy}
              aria-label="Close login dialog"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <DialogDescription className="sr-only">
          {mode === 'signin' && 'Sign in to your account.'}
          {mode === 'buy' && 'Submit account registration with payment details.'}
          {mode === 'forgot' && 'Request a password reset code via email.'}
          {mode === 'reset' && 'Enter your reset code and choose a new password for your account.'}
        </DialogDescription>

        <RecoveryLandingHelper />

        {mode === 'reset' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className={`rounded-lg border p-3 text-sm ${isDark ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`}>
              {resetCodeVerified
                ? 'Reset code verified. You can now keep trying a different new password without requesting another code.'
                : 'Enter the reset code from your email or spam folder, then choose a new password.'}
            </div>
            {resetCodeBlockedSeconds > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Too many invalid reset code attempts. Please wait {Math.ceil(resetCodeBlockedSeconds / 60)} minute{Math.ceil(resetCodeBlockedSeconds / 60) > 1 ? 's' : ''} before trying again.
              </div>
            )}
            {resetCodeBlockedSeconds <= 0 && resetCodeFailures > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
                Invalid reset code attempts: {resetCodeFailures}/{RESET_CODE_MAX_ATTEMPTS}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="resetEmail" className={colorText}>
                Email
              </Label>
              <Input
                id="resetEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                disabled={loading || resetCodeVerified}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resetCode" className={colorText}>
                Reset Code
              </Label>
              <Input
                id="resetCode"
                type="text"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\s+/g, ''))}
                placeholder="Enter the code from your email"
                required
                disabled={loading || resetCodeVerified}
                autoComplete="one-time-code"
                inputMode="text"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword" className={colorText}>
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showResetPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a new password"
                  required
                  disabled={loading}
                  minLength={8}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                  onClick={() => setShowResetPassword((v) => !v)}
                  aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                >
                  {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword" className={colorText}>
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirmNewPassword"
                  type={showResetConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  required
                  disabled={loading}
                  minLength={8}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                  onClick={() => setShowResetConfirmPassword((v) => !v)}
                  aria-label={showResetConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showResetConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Button type="submit" className="w-full" disabled={loading || !password || !confirmPassword || !email || !resetCode || resetCodeBlockedSeconds > 0}>
                {loading ? 'Updating...' : 'Update Password'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  void handleResendResetCode()
                }}
                disabled={loading || !email || resetCooldown > 0}
              >
                {resetCooldown > 0 ? `Resend in ${resetCooldown} minute${resetCooldown > 1 ? 's' : ''}` : 'Resend reset code'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  void discardRecoverySession()
                  setMode('signin')
                }}
                disabled={loading}
              >
                Back to Login
              </Button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgotEmail" className={colorText}>
                Email
              </Label>
              <Input
                id="forgotEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                disabled={isSignInBusy}
                autoComplete="email"
              />
            </div>

            {resetCooldown > 0 && (
              <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
                Please wait {resetCooldown} minute{resetCooldown > 1 ? 's' : ''} before requesting another reset.
              </div>
            )}

            <div className="space-y-2">
              <Button type="submit" className="w-full" disabled={loading || !email || resetCooldown > 0}>
                {loading ? 'Sending...' : 'Send reset code'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setMode('signin')
                }}
                disabled={loading}
              >
                Back to Login
              </Button>
            </div>
          </form>
        )}

        {mode === 'signin' && (
          signInPendingState ? (
            <PaymentReceiptCard
              theme={theme}
              title="Registration Pending"
              status="pending"
              statusLabel="Pending Approval"
              subtitle={signInPendingState.message}
              amountLabel="Current Status"
              amountValue="Waiting for Review"
              lineItems={[
                { label: 'Email', value: signInPendingState.email },
                { label: 'Checked', value: new Date(signInPendingState.checkedAt).toLocaleString() },
                { label: 'Next Step', value: 'Wait for approval email, then sign in again.' },
              ]}
              receiptFileName={`registration-pending-${new Date(signInPendingState.checkedAt).toISOString().replace(/[:.]/g, '-')}.png`}
              primaryAction={{
                label: 'Back to Login',
                onClick: () => setSignInPendingState(null),
              }}
              secondaryAction={paymentConfig?.messenger_url
                ? {
                    label: 'Message us on Facebook',
                    onClick: () => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer'),
                  }
                : undefined}
            />
          ) : (
            <form
              id="signin-form"
              data-testid="signin-form"
              onSubmit={handleSignIn}
              className="relative space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="signinEmail" className={colorText}>
                  Email
                </Label>
                <Input
                  id="signinEmail"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (signInError) setSignInError(null)
                  }}
                  placeholder="Enter your email"
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signinPassword" className={colorText}>
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="signinPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      if (signInError) setSignInError(null)
                    }}
                    placeholder="Enter your password"
                    required
                    disabled={isSignInBusy || signInCooldownSeconds > 0}
                    minLength={6}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {signInError ? (
                  <div className={`text-sm ${theme === 'dark' ? 'text-rose-300' : 'text-rose-600'}`} aria-live="polite">
                    {signInError}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="link"
                  className="px-0 text-sm"
                  onClick={() => setMode('forgot')}
                  disabled={isSignInBusy}
                >
                  Forgot password?
                </Button>
                <Button
                  type="button"
                  className={`text-xs ${isDark ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                  onClick={() => {
                    setMode('buy')
                    setSignInError(null)
                    setSignInPendingState(null)
                    setBuyStep('account')
                    setPassword('')
                    setConfirmPassword('')
                    setPayerName('')
                    setReferenceNo('')
                    setNotes('')
                    setProofFile(null)
                    setBuyReceipt(null)
                  }}
                  disabled={isSignInBusy}
                >
                  Create Account
                </Button>
              </div>

              <Button
                id="signin-submit"
                data-testid="signin-submit"
                name="signin-submit"
                type="submit"
                className="w-full"
                disabled={isSignInBusy || signInCooldownSeconds > 0 || !email || !password}
              >
                {isSignInBusy ? 'Signing in...' : signInCooldownSeconds > 0 ? `Try again in ${signInCooldownSeconds}s` : 'Log In'}
              </Button>

              {isLoginSubmitting && (
                <div className={`absolute inset-0 z-20 flex items-center justify-center rounded-2xl backdrop-blur-sm ${isDark ? 'bg-gray-950/72' : 'bg-white/72'}`}>
                  <div className={`mx-4 w-full max-w-sm rounded-2xl border px-6 py-7 text-center shadow-2xl ${isDark ? 'border-white/10 bg-gray-900/95 text-white' : 'border-gray-200 bg-white/95 text-gray-900'}`}>
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10">
                      <LoadingSpinner size="lg" className="h-10 w-10 border-4 border-indigo-200/40 border-t-indigo-500" />
                    </div>
                    <div className="mt-4 text-base font-semibold">Signing you in...</div>
                    <div className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Please wait while we check your account and sync your access.
                    </div>
                  </div>
                </div>
              )}
            </form>
          )
        )}

        {mode === 'buy' && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {buyReceipt ? (
              <PaymentReceiptCard
                theme={theme}
                title="Payment Success"
                status={buyReceipt.status || 'pending'}
                statusLabel={buyReceipt.statusLabel || 'Pending Approval'}
                subtitle={buyReceipt.message}
                amountLabel="Total Payment"
                amountValue={buyReceipt.amountText}
                lineItems={[
                  { label: 'Payment for', value: 'VDJV Account' },
                  { label: 'VDJV Receipt No', value: buyReceipt.receiptNo },
                  { label: 'Payment Reference', value: buyReceipt.paymentReference },
                  { label: 'Submitted', value: new Date(buyReceipt.submittedAt).toLocaleString() },
                ]}
                receiptFileName={`vdjv-account-receipt-${new Date(buyReceipt.submittedAt).toISOString().replace(/[:.]/g, '-')}.png`}
                primaryAction={{
                  label: 'Done',
                  onClick: () => {
                    setMode('signin')
                    setBuyStep('account')
                    setBuyReceipt(null)
                  },
                }}
                secondaryAction={paymentConfig?.messenger_url
                  ? {
                      label: 'Message us on Facebook',
                      onClick: () => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer'),
                    }
                  : undefined}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${buyStep === 'account' ? (isDark ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-indigo-300 bg-indigo-50 text-indigo-700') : (isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500')}`}>1. Account Setup</div>
                  <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${buyStep === 'payment' ? (isDark ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200' : 'border-emerald-300 bg-emerald-50 text-emerald-700') : (isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500')}`}>2. Payment Proof</div>
                </div>
                <form onSubmit={buyStep === 'account' ? handleBuyNext : handleBuySubmit} className="relative space-y-3">
                  {buyStep === 'account' && (
                    <>
                      {paymentConfig?.messenger_url && (
                        <div className={`rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100' : 'border-cyan-200 bg-cyan-50 text-cyan-800'}`}>
                          <button
                            type="button"
                            onClick={() => window.open(paymentConfig.messenger_url, '_blank', 'noopener,noreferrer')}
                            className={`font-semibold underline underline-offset-4 ${isDark ? 'text-white' : 'text-cyan-900'}`}
                          >
                            Message us on Facebook
                          </button>
                          {' '}for help.
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="buyEmail" className={colorText}>Email</Label>
                        <Input
                          id="buyEmail"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email"
                          required
                          disabled={loading}
                          autoComplete="email"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="buyPassword" className={colorText}>Password</Label>
                          <div className="relative">
                            <Input
                              id="buyPassword"
                              type={showPassword ? 'text' : 'password'}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="Minimum 8 characters"
                              required
                              disabled={loading}
                              minLength={8}
                              autoComplete="new-password"
                              className="pr-10"
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                              onClick={() => setShowPassword((v) => !v)}
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="buyConfirmPassword" className={colorText}>Confirm Password</Label>
                          <div className="relative">
                            <Input
                              id="buyConfirmPassword"
                              type={showConfirmPassword ? 'text' : 'password'}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="Confirm password"
                              required
                              disabled={loading}
                              minLength={8}
                              autoComplete="new-password"
                              className="pr-10"
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                              onClick={() => setShowConfirmPassword((v) => !v)}
                              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                            >
                              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {buyStep === 'payment' && (
                    <>
                  <div className={`p-4 rounded-xl border ${isDark ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
                    <div className="text-xs uppercase tracking-[0.16em] opacity-75">Account Price</div>
                    <div className="text-2xl font-bold mt-1">{accountPriceText}</div>
                  </div>

                  <div className={`p-5 rounded-xl border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'} shadow-sm`}>
                    <h3 className={`font-semibold text-lg mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Payment Information</h3>
                    {paymentConfigLoading ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Loading payment details...
                      </div>
                    ) : (
                      <>
                        <div className={`text-sm whitespace-pre-wrap leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {paymentConfig?.instructions || 'Please follow the instructions below before submitting registration.'}
                        </div>
                        {(paymentConfig?.gcash_number || paymentConfig?.maya_number) && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {paymentConfig?.gcash_number && (
                              <div className={`p-2.5 rounded-lg border flex flex-col gap-1 items-center justify-center text-center ${isDark ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-100'}`}>
                                <span className="text-[11px] font-bold text-blue-500 uppercase tracking-wider">GCash</span>
                                <CopyableValue
                                  value={paymentConfig.gcash_number}
                                  label="GCash number"
                                  wrap
                                  className="max-w-full justify-center"
                                  valueClassName={`font-mono text-sm font-medium break-all whitespace-normal text-center ${isDark ? 'text-white' : 'text-gray-900'}`}
                                  buttonClassName={isDark ? 'text-blue-200 hover:bg-blue-400/15' : 'text-blue-700 hover:bg-blue-100'}
                                />
                              </div>
                            )}
                            {paymentConfig?.maya_number && (
                              <div className={`p-2.5 rounded-lg border flex flex-col gap-1 items-center justify-center text-center ${isDark ? 'bg-green-900/20 border-green-500/30' : 'bg-green-50 border-green-100'}`}>
                                <span className="text-[11px] font-bold text-green-500 uppercase tracking-wider">Maya</span>
                                <CopyableValue
                                  value={paymentConfig.maya_number}
                                  label="Maya number"
                                  wrap
                                  className="max-w-full justify-center"
                                  valueClassName={`font-mono text-sm font-medium break-all whitespace-normal text-center ${isDark ? 'text-white' : 'text-gray-900'}`}
                                  buttonClassName={isDark ? 'text-green-200 hover:bg-green-400/15' : 'text-green-700 hover:bg-green-100'}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {paymentConfig?.messenger_url && (
                          <div className="mt-3 flex justify-center">
                            <a
                              href={paymentConfig.messenger_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-1.5 text-sm font-medium ${isDark ? 'text-indigo-300 hover:text-indigo-200' : 'text-indigo-700 hover:text-indigo-800'}`}
                            >
                              Message us on Facebook <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        )}
                        {paymentConfig?.qr_image_path && (
                          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                            <div className="flex flex-col items-center gap-2">
                              <span className={`text-sm font-medium tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Scan to Pay</span>
                              <button
                                type="button"
                                onClick={() => setExpandedQrUrl(paymentConfig.qr_image_path || null)}
                                className="flex max-w-[min(70vw,220px)] max-h-[260px] items-center justify-center rounded-xl border bg-white p-2 hover:opacity-90 transition-opacity"
                              >
                                <img
                                  src={paymentConfig.qr_image_path}
                                  alt="Payment QR"
                                  className="block max-w-[min(64vw,200px)] max-h-[240px] h-auto w-auto rounded-lg object-contain"
                                />
                              </button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => void downloadQrImage(paymentConfig.qr_image_path!)}
                              >
                                <Download className="w-3.5 h-3.5 mr-1" />
                                Download QR
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="buyChannel" className={colorText}>Payment Channel</Label>
                    <select
                      id="buyChannel"
                      value={paymentChannel}
                      onChange={(e) => setPaymentChannel(e.target.value as PaymentChannel)}
                      className={`w-full rounded-md border px-3 py-2 text-sm outline-none ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                      disabled={loading}
                    >
                      <option value="image_proof">Upload Official Receipt (Fast Approval)</option>
                      <option value="gcash_manual">GCash (Manual)</option>
                      <option value="maya_manual">Maya (Manual)</option>
                    </select>
                  </div>

                    {(paymentChannel === 'gcash_manual' || paymentChannel === 'maya_manual') && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="buyPayerName" className={colorText}>
                            Account Name <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="buyPayerName"
                            value={payerName}
                            onChange={(e) => setPayerName(e.target.value)}
                            placeholder="e.g. Juan Dela Cruz"
                            required
                            disabled={loading}
                          />
                          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>The name used to send payment.</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="buyReferenceNo" className={colorText}>
                            Reference / Transaction Number <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="buyReferenceNo"
                            value={referenceNo}
                            onChange={(e) => setReferenceNo(e.target.value)}
                            placeholder="e.g. 1002348572"
                            required
                            disabled={loading}
                          />
                        </div>
                      </div>
                    )}

                  <div className="space-y-1.5">
                    <Label htmlFor="buyProof" className={colorText}>
                      Upload Receipt / Image Proof {paymentChannel === 'image_proof' ? '(Required)' : '(Optional)'}
                    </Label>
                    {paymentChannel === 'image_proof' && (
                      <>
                        <input type="hidden" name="buyReferenceNoHidden" value={referenceNo} readOnly />
                        {proofOcrLoading && (
                          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Detecting reference number from receipt...
                          </p>
                        )}
                      </>
                    )}
                    <div className="flex items-center gap-2">
                      {proofPreviewUrl && <img src={proofPreviewUrl} alt="Payment proof preview" className="w-12 h-12 rounded border object-cover" />}
                      <Input
                        id="buyProof"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                        onChange={handleBuyProofFileChange}
                        required={paymentChannel === 'image_proof'}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="buyNotes" className={colorText}>Notes (Optional)</Label>
                    <textarea
                      id="buyNotes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      disabled={loading}
                      className={`w-full rounded-md border p-2 text-sm outline-none resize-none ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                      placeholder="Additional details for admin review"
                    />
                  </div>
                    </>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        if (buyStep === 'payment') {
                          setBuyStep('account')
                          return
                        }
                        setMode('signin')
                      }}
                      disabled={loading}
                    >
                      {buyStep === 'payment' ? 'Back' : 'Back to Login'}
                    </Button>
                    <Button
                      type="submit"
                      className={`flex-1 ${isDark ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                      disabled={loading}
                    >
                      {buyStep === 'payment'
                        ? <ArrowRight className="w-4 h-4 mr-2" />
                        : <ArrowRight className="w-4 h-4 mr-2" />}
                      {buyStep === 'payment'
                        ? 'Submit Registration'
                        : 'Next: Payment'}
                    </Button>
                  </div>
                  {isBuySubmitting && (
                    <div className={`absolute inset-0 z-20 flex items-center justify-center rounded-2xl backdrop-blur-sm ${isDark ? 'bg-gray-950/72' : 'bg-white/72'}`}>
                      <div className={`mx-4 w-full max-w-sm rounded-2xl border px-6 py-7 text-center shadow-2xl ${isDark ? 'border-white/10 bg-gray-900/95 text-white' : 'border-gray-200 bg-white/95 text-gray-900'}`}>
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10">
                          <LoadingSpinner size="lg" className="h-10 w-10 border-4 border-indigo-200/40 border-t-indigo-500" />
                        </div>
                        <div className="mt-4 text-base font-semibold">Submitting your account request...</div>
                        <div className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          Please wait while we save your request, run payment checks, and prepare your receipt.
                        </div>
                      </div>
                    </div>
                  )}
                </form>
              </>
            )}
            {expandedQrUrl && (
              <div className="fixed inset-0 z-[220] bg-black/75 flex items-center justify-center p-4" onClick={() => setExpandedQrUrl(null)}>
                <div className="relative flex max-w-[95vw] max-h-[90vh] flex-col items-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex max-w-[min(92vw,40rem)] max-h-[82vh] items-center justify-center rounded-xl border bg-white p-3 shadow-2xl">
                    <img
                      src={expandedQrUrl}
                      alt="Expanded payment QR"
                      className="block max-w-[min(88vw,36rem)] max-h-[76vh] h-auto w-auto object-contain"
                    />
                  </div>
                  <div className="mt-2 flex justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="bg-white text-gray-900 border-gray-300 hover:bg-gray-100"
                      onClick={() => void downloadQrImage(expandedQrUrl)}
                    >
                      <Download className="w-3.5 h-3.5 mr-1" />
                      Download QR
                    </Button>
                    <Button type="button" size="sm" onClick={() => setExpandedQrUrl(null)}>
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
