import { edgeFunctionUrl } from '@/lib/edge-api'

export type ReceiptOcrContext = 'account_registration' | 'bank_store'

export interface ReceiptOcrDetected {
  referenceNo: string | null
  payerName: string | null
  amountPhp: number | null
  recipientNumber: string | null
  rawText: string
  confidence: number | null
}

export interface ReceiptOcrResult {
  ok: boolean
  detected: ReceiptOcrDetected
  provider?: string
  elapsedMs?: number
  errorCode?: string
}

export const runReceiptOcr = async (input: {
  file: File
  context: ReceiptOcrContext
  email?: string | null
  subject?: string | null
  fallbackToServer?: boolean
}): Promise<ReceiptOcrResult> => {
  const clientResult = await runClientReceiptOcr(input.file)
  if (clientResult.detected.referenceNo) {
    return {
      ...clientResult,
      provider: 'client_tesseract',
    }
  }

  if (input.fallbackToServer === false) {
    return {
      ...clientResult,
      provider: 'client_tesseract',
    }
  }

  const serverResult = await runServerReceiptOcr(input)
  if (serverResult.ok || !clientResult.detected.rawText) return serverResult
  return {
    ...clientResult,
    provider: 'client_tesseract',
    errorCode: serverResult.errorCode || clientResult.errorCode,
  }
}

const normalizeReceiptText = (value: string): string =>
  value
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

const detectReferenceNo = (rawText: string): string | null => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
  const keywordRegex = /\b(ref(?:erence)?|transaction|txn|trx|trace)\b/i
  const tokenRegex = /([A-Z0-9][A-Z0-9-]{5,31})/g

  for (const line of lines) {
    if (!keywordRegex.test(line)) continue
    const matches = line.toUpperCase().match(tokenRegex) || []
    const picked = matches.find((token) => /\d/.test(token) && token.length >= 6)
    if (picked) return picked
  }

  const allMatches = rawText.toUpperCase().match(tokenRegex) || []
  const scored = allMatches
    .filter((token) => /\d/.test(token))
    .filter((token) => token.length >= 8)
    .sort((a, b) => b.length - a.length)
  return scored[0] || null
}

const detectPayerName = (rawText: string): string | null => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
  const keyedRegex = /\b(account\s*name|sender|from|name)\b\s*[:\-]?\s*([A-Za-z][A-Za-z .,'-]{2,60})$/i
  for (const line of lines) {
    const match = line.match(keyedRegex)
    if (match?.[2]) return match[2].trim()
  }
  return null
}

const normalizePhMobileNumber = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value : String(value || '')
  if (!raw.trim()) return null
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('09')) return `63${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('63')) return digits
  return null
}

const detectReceiptRecipientNumber = (rawText: string): string | null => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
  const phoneRegex = /(?:\+?63|0)\s*9(?:[\s-]*\d){9}/g
  const positiveKeywordRegex = /\b(?:to|recipient|receiver|receive|received by|send to|sent to|account|account number|mobile|mobile number|number|gcash|maya)\b/i
  const negativeKeywordRegex = /\b(?:from|sender|reference|ref|transaction|amount|total|paid|payment|balance|available)\b/i

  type Candidate = { value: string; score: number }
  const scoredCandidates: Candidate[] = []

  for (const line of lines) {
    const matches = line.match(phoneRegex) || []
    if (matches.length === 0) continue
    const hasPositive = positiveKeywordRegex.test(line)
    const hasNegative = negativeKeywordRegex.test(line)
    for (const match of matches) {
      const normalized = normalizePhMobileNumber(match)
      if (!normalized) continue
      let score = 0
      if (hasPositive) score += 5
      if (/\b(?:gcash|maya)\b/i.test(line)) score += 2
      if (/account\s*number|mobile\s*number|recipient|receiver|send\s*to|sent\s*to/i.test(line)) score += 2
      if (hasNegative) score -= 3
      scoredCandidates.push({ value: normalized, score })
    }
  }

  const positiveCandidates = scoredCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value))
  if (positiveCandidates.length > 0) return positiveCandidates[0].value

  const fallbackCandidates = Array.from(
    new Set(
      lines
        .flatMap((line) => line.match(phoneRegex) || [])
        .map((match) => normalizePhMobileNumber(match))
        .filter(Boolean) as string[],
    ),
  )
  if (fallbackCandidates.length === 1) return fallbackCandidates[0]
  return null
}

const detectReceiptAmount = (rawText: string): number | null => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
  const positiveKeywordRegex = /\b(amount|total|paid|payment|grand\s*total|total\s*amount|amount\s*paid|payment\s*amount)\b/i
  const negativeKeywordRegex = /\b(balance|available|fee|service\s*fee|charge|discount|cashback|change|before|after)\b/i
  const amountTokenRegex = /(?:PHP|P|\u20b1)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2})?)/gi
  const standaloneAmountLineRegex = /^-?\s*(?:PHP|P|\u20b1)\s*[0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})\s*$/i

  const parseAmountToken = (token: string): number | null => {
    const cleaned = token.replace(/[,\s]/g, '')
    const parsed = Number(cleaned)
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return Math.round(parsed * 100) / 100
  }

  const getLineCandidates = (line: string): number[] => {
    const candidates: number[] = []
    let match: RegExpExecArray | null
    while ((match = amountTokenRegex.exec(line)) !== null) {
      const parsed = parseAmountToken(match[1] || '')
      if (parsed !== null) candidates.push(parsed)
    }
    amountTokenRegex.lastIndex = 0
    return candidates
  }

  type Candidate = { value: number; score: number }
  const scoredCandidates: Candidate[] = []
  for (const line of lines) {
    const candidates = getLineCandidates(line)
    if (candidates.length === 0) continue
    const hasPositive = positiveKeywordRegex.test(line)
    const hasNegative = negativeKeywordRegex.test(line)
    const isStandaloneAmountLine = standaloneAmountLineRegex.test(line)
    const isDebitStyleAmountLine = /^-\s*(?:PHP|P|\u20b1)/i.test(line)
    const letterlessAmountLine = line.replace(/(?:PHP|P|\u20b1|[\d,\s.\-])/gi, '').trim().length === 0
    for (const value of candidates) {
      let score = 0
      if (hasPositive) score += 5
      if (/grand\s*total|total\s*amount|amount\s*paid/i.test(line)) score += 2
      if (/(php|\u20b1|\bpaid\b)/i.test(line)) score += 1
      if (isStandaloneAmountLine) score += 5
      if (isDebitStyleAmountLine) score += 2
      if (letterlessAmountLine) score += 2
      if (hasNegative) score -= 4
      scoredCandidates.push({ value, score })
    }
  }

  const positiveCandidates = scoredCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.value - left.value)
  if (positiveCandidates.length > 0) return positiveCandidates[0].value

  const fallbackCandidates = lines
    .flatMap((line) => getLineCandidates(line))
    .filter((value) => value > 0)
  const uniqueFallbackCandidates = Array.from(new Set(fallbackCandidates))
  if (uniqueFallbackCandidates.length === 1) return uniqueFallbackCandidates[0]
  return null
}

const runClientReceiptOcr = async (file: File): Promise<ReceiptOcrResult> => {
  const startedAt = Date.now()
  try {
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng')
    try {
      const output = await worker.recognize(file)
      const rawText = normalizeReceiptText(String(output?.data?.text || ''))
      const confidenceRaw = Number(output?.data?.confidence)
      return {
        ok: rawText.length > 0,
        detected: {
          referenceNo: detectReferenceNo(rawText),
          payerName: detectPayerName(rawText),
          amountPhp: detectReceiptAmount(rawText),
          recipientNumber: detectReceiptRecipientNumber(rawText),
          rawText,
          confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : null,
        },
        elapsedMs: Date.now() - startedAt,
      }
    } finally {
      await worker.terminate()
    }
  } catch {
    return {
      ok: false,
      detected: {
        referenceNo: null,
        payerName: null,
        amountPhp: null,
        recipientNumber: null,
        rawText: '',
        confidence: null,
      },
      elapsedMs: Date.now() - startedAt,
      errorCode: 'CLIENT_OCR_FAILED',
    }
  }
}

const runServerReceiptOcr = async (input: {
  file: File
  context: ReceiptOcrContext
  email?: string | null
  subject?: string | null
}): Promise<ReceiptOcrResult> => {
  const formData = new FormData()
  formData.append('file', input.file)
  formData.append('context', input.context)
  if (input.email) formData.append('email', input.email)
  if (input.subject) formData.append('subject', input.subject)

  try {
    const response = await fetch(edgeFunctionUrl('store-api', 'receipt-ocr'), {
      method: 'POST',
      body: formData,
    })

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    const data = (payload?.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>
    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        detected: {
          referenceNo: null,
          payerName: null,
          amountPhp: null,
          recipientNumber: null,
          rawText: '',
          confidence: null,
        },
        provider: typeof data.provider === 'string' ? data.provider : undefined,
        elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : undefined,
        errorCode: String(payload?.error || data?.error || 'OCR_FAILED'),
      }
    }

    const detected = (data.detected && typeof data.detected === 'object' ? data.detected : {}) as Record<string, unknown>
    return {
      ok: true,
      detected: {
        referenceNo: typeof detected.referenceNo === 'string' && detected.referenceNo.trim() ? detected.referenceNo.trim() : null,
        payerName: typeof detected.payerName === 'string' && detected.payerName.trim() ? detected.payerName.trim() : null,
        amountPhp: typeof detected.amountPhp === 'number' ? detected.amountPhp : null,
        recipientNumber: typeof detected.recipientNumber === 'string' && detected.recipientNumber.trim()
          ? detected.recipientNumber.trim()
          : null,
        rawText: typeof detected.rawText === 'string' ? detected.rawText : '',
        confidence: typeof detected.confidence === 'number' ? detected.confidence : null,
      },
      provider: typeof data.provider === 'string' ? data.provider : undefined,
      elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : undefined,
    }
  } catch {
    return {
      ok: false,
      detected: {
        referenceNo: null,
        payerName: null,
        amountPhp: null,
        recipientNumber: null,
        rawText: '',
        confidence: null,
      },
      errorCode: 'OCR_FAILED',
    }
  }
}
