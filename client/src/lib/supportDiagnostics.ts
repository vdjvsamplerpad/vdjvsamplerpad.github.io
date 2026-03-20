import { copyTextToClipboard } from '@/components/ui/copyable-value'

type OperationDebugEntryLike = {
  operation?: string
  iso?: string
  level?: string
  phase?: string
  operationId?: string
  details?: Record<string, unknown>
}

type SupportLogSection = {
  title: string
  body: string
}

const SUPPORT_LOG_FILE_PREFIX = 'vdjv-support-log'
const MAX_STRING_LENGTH = 1200
const REDACTED_VALUE = '[redacted]'
const SENSITIVE_KEY_PATTERNS = [
  'authorization',
  'entitlementtoken',
  'derivedkey',
  'signedurl',
  'downloadurl',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'secret',
  'password',
]

const truncateString = (value: string): string =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value

const sanitizeUrl = (value: string): string => {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return value
  }
}

const sanitizeText = (value: string): string => {
  let next = String(value || '')
  next = next.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
  next = next.replace(/https?:\/\/\S+/gi, (match) => sanitizeUrl(match))
  return truncateString(next)
}

const shouldRedactKey = (key: string): boolean => {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern.replace(/[^a-z0-9]/gi, '').toLowerCase()))
}

const sanitizeSupportValue = (value: unknown, keyHint = ''): unknown => {
  if (value == null) return value
  if (shouldRedactKey(keyHint)) return REDACTED_VALUE
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return sanitizeUrl(value)
    return sanitizeText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSupportValue(entry, keyHint))
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeText(value.message),
    }
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeSupportValue(nestedValue, key)
    }
    return result
  }
  return sanitizeText(String(value))
}

const buildOperationTimelineText = (operations?: string[]): string => {
  if (typeof window === 'undefined') return ''
  const debugWindow = window as Window & typeof globalThis & {
    __vdjvOperationTimeline?: OperationDebugEntryLike[]
  }
  const allEntries = Array.isArray(debugWindow.__vdjvOperationTimeline)
    ? debugWindow.__vdjvOperationTimeline
    : []
  const normalizedOperations = Array.isArray(operations)
    ? operations.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const relevantEntries = normalizedOperations.length > 0
    ? allEntries.filter((entry) => normalizedOperations.includes(String(entry.operation || '')))
    : allEntries
  if (relevantEntries.length === 0) return ''
  return relevantEntries
    .map((entry) => {
      const iso = typeof entry.iso === 'string' ? entry.iso : new Date().toISOString()
      const level = typeof entry.level === 'string' ? entry.level.toUpperCase() : 'INFO'
      const operation = typeof entry.operation === 'string' ? entry.operation : 'unknown_operation'
      const phase = typeof entry.phase === 'string' ? entry.phase : 'event'
      const operationId = typeof entry.operationId === 'string' ? entry.operationId : 'unknown'
      const details = entry.details ? ` ${JSON.stringify(sanitizeSupportValue(entry.details))}` : ''
      return `${iso} [${level}] ${operation}/${phase}#${operationId}${details}`
    })
    .join('\n')
}

export const buildSupportLogText = (input: {
  title: string
  errorMessage?: string | null
  logLines?: string[]
  debugOperations?: string[]
  extraSections?: SupportLogSection[]
}): string => {
  const sections: SupportLogSection[] = [
    {
      title: 'Summary',
      body: [
        `Title: ${sanitizeText(input.title)}`,
        `Time: ${new Date().toISOString()}`,
        `URL: ${typeof window !== 'undefined' ? sanitizeUrl(window.location.href) : 'unknown'}`,
        `User Agent: ${typeof navigator !== 'undefined' ? sanitizeText(navigator.userAgent) : 'unknown'}`,
        input.errorMessage ? `Error: ${sanitizeText(input.errorMessage)}` : '',
      ].filter(Boolean).join('\n'),
    },
  ]

  const visibleLogText = Array.isArray(input.logLines) && input.logLines.length > 0
    ? input.logLines.map((line) => sanitizeText(line)).join('\n')
    : ''
  const debugTimelineText = buildOperationTimelineText(input.debugOperations)

  if (visibleLogText) {
    sections.push({ title: 'Activity Log', body: visibleLogText })
  }
  if (debugTimelineText) {
    sections.push({ title: 'Operation Timeline', body: debugTimelineText })
  }
  for (const section of input.extraSections || []) {
    if (!section.body.trim()) continue
    sections.push({
      title: sanitizeText(section.title),
      body: section.body,
    })
  }

  return sections
    .map((section) => `${section.title}\n${section.body}`)
    .join('\n\n')
}

export const copySupportLogText = async (text: string): Promise<void> => {
  if (!text.trim()) return
  await copyTextToClipboard(text)
}

export const exportSupportLogText = (text: string, filePrefix = SUPPORT_LOG_FILE_PREFIX): void => {
  if (!text.trim() || typeof document === 'undefined') return
  const fileName = `${filePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

export const buildSanitizedSupportSection = (title: string, details: unknown): SupportLogSection => ({
  title,
  body: JSON.stringify(sanitizeSupportValue(details), null, 2),
})
