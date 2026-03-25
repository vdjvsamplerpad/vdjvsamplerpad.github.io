import * as React from 'react'
import { Check, Clock3, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyableValue } from '@/components/ui/copyable-value'

const RECEIPT_EXPORT_FOLDER_NAME = 'VDJV-Receipts'
const ANDROID_DOWNLOAD_ROOT = '/storage/emulated/0/Download'

export type PaymentReceiptLineItem = {
  label: string
  value: string
  hint?: string
  copyValue?: string
}

export type PaymentReceiptAction = {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface PaymentReceiptCardProps {
  title: string
  subtitle: string
  amountLabel: string
  amountValue: string
  lineItems: PaymentReceiptLineItem[]
  status?: 'success' | 'pending'
  statusLabel?: string
  primaryAction: PaymentReceiptAction
  secondaryAction?: PaymentReceiptAction
  receiptFileName?: string
  theme?: 'light' | 'dark'
}

export function PaymentReceiptCard({
  title,
  subtitle,
  amountLabel,
  amountValue,
  lineItems,
  status = 'success',
  statusLabel,
  primaryAction,
  secondaryAction,
  receiptFileName = 'payment-receipt.png',
  theme = 'light',
}: PaymentReceiptCardProps) {
  const isDark = theme === 'dark'
  const isPending = status === 'pending'
  const receiptRef = React.useRef<HTMLDivElement | null>(null)
  const [downloading, setDownloading] = React.useState(false)
  const nativePlatform = React.useMemo(() => {
    if (typeof window === 'undefined') return null
    const capacitor = window as Window & {
      Capacitor?: {
        isNativePlatform?: () => boolean
        getPlatform?: () => string
      }
    }
    if (!capacitor.Capacitor?.isNativePlatform?.()) return null
    return capacitor.Capacitor.getPlatform?.() || 'native'
  }, [])

  const saveBlobToNativeFilesystem = React.useCallback(
    async (blob: Blob) => {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          const result = typeof reader.result === 'string' ? reader.result : ''
          const base64 = result.split(',')[1]
          if (!base64) {
            reject(new Error('EMPTY_BASE64'))
            return
          }
          resolve(base64)
        }
        reader.onerror = () => reject(reader.error || new Error('FILE_READER_ERROR'))
        reader.readAsDataURL(blob)
      })

      if (nativePlatform === 'android') {
        try {
          const permissionStatus = await Filesystem.checkPermissions()
          if (permissionStatus.publicStorage !== 'granted') {
            await Filesystem.requestPermissions()
          }
        } catch {
        }

        try {
          await Filesystem.writeFile({
            path: `${ANDROID_DOWNLOAD_ROOT}/${RECEIPT_EXPORT_FOLDER_NAME}/${receiptFileName}`,
            data: base64Data,
            recursive: true,
          })
          return
        } catch {
        }
      }

      await Filesystem.writeFile({
        path: `${RECEIPT_EXPORT_FOLDER_NAME}/${receiptFileName}`,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      })
    },
    [nativePlatform, receiptFileName],
  )

  const downloadBlob = React.useCallback(
    async (blob: Blob) => {
      if (nativePlatform) {
        await saveBlobToNativeFilesystem(blob)
        return
      }

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = receiptFileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()

      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
      const isTouchMac =
        typeof navigator !== 'undefined' &&
        /Macintosh/i.test(userAgent) &&
        (navigator.maxTouchPoints || 0) > 1
      const isIos = /iPad|iPhone|iPod/i.test(userAgent) || isTouchMac
      const isAndroid = /Android/i.test(userAgent)
      if (isIos || isAndroid) {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      window.setTimeout(() => URL.revokeObjectURL(url), isIos || isAndroid ? 30000 : 1000)
    },
    [nativePlatform, receiptFileName, saveBlobToNativeFilesystem],
  )

  const renderDomReceiptBlob = React.useCallback(async (): Promise<Blob | null> => {
    const root = receiptRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    const width = Math.max(320, Math.ceil(rect.width))
    const height = Math.max(320, Math.ceil(rect.height))
    const cloned = root.cloneNode(true) as HTMLElement
    cloned.querySelectorAll('.vdjv-receipt-export-hidden').forEach((node) => node.remove())
    cloned.style.margin = '0'
    cloned.style.width = `${width}px`

    const wrapper = document.createElement('div')
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    wrapper.appendChild(cloned)
    const serialized = new XMLSerializer().serializeToString(wrapper)
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject>
</svg>`
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, width, height)
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      return pngBlob
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [])

  const renderFallbackReceiptBlob = React.useCallback(async (): Promise<Blob | null> => {
    const width = 1000
    const subtitleRows = Math.max(1, Math.ceil(subtitle.length / 48))
    const baseHeight = 760 + subtitleRows * 34 + lineItems.length * 72 + (statusLabel ? 42 : 0)
    const height = Math.max(960, baseHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const accent = isPending ? '#f59e0b' : '#10b981'
    const bgTop = isDark ? '#111827' : '#ffffff'
    const bgBottom = isDark ? '#1f2937' : (isPending ? '#fffbeb' : '#f0fdf4')
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, bgTop)
    gradient.addColorStop(1, bgBottom)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(width / 2, 120, 48, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 46px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(isPending ? '◷' : String.fromCharCode(10003), width / 2, 136)

    let titleY = 240
    if (statusLabel) {
      ctx.fillStyle = accent
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(statusLabel.toUpperCase(), width / 2, 212)
      titleY = 258
    }

    ctx.fillStyle = isDark ? '#f9fafb' : '#111827'
    ctx.font = 'bold 52px sans-serif'
    ctx.fillText(title, width / 2, titleY)

    ctx.fillStyle = isDark ? '#d1d5db' : '#4b5563'
    ctx.font = '32px sans-serif'
    const subtitleChunks = subtitle.match(/.{1,48}(\s|$)/g) || [subtitle]
    subtitleChunks.forEach((chunk, index) => {
      ctx.fillText(chunk.trim(), width / 2, titleY + 52 + index * 38)
    })

    const amountStartY = titleY + 130 + subtitleRows * 34
    ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280'
    ctx.font = '22px sans-serif'
    ctx.fillText(amountLabel.toUpperCase(), width / 2, amountStartY)
    ctx.fillStyle = isDark ? '#f9fafb' : '#111827'
    ctx.font = 'bold 64px sans-serif'
    ctx.fillText(amountValue, width / 2, amountStartY + 74)

    let rowY = amountStartY + 150
    ctx.strokeStyle = isDark ? '#4b5563' : '#d1d5db'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 8])
    ctx.beginPath()
    ctx.moveTo(120, rowY)
    ctx.lineTo(width - 120, rowY)
    ctx.stroke()
    ctx.setLineDash([])
    rowY += 36

    lineItems.forEach((item) => {
      ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280'
      ctx.font = '21px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(item.label.toUpperCase(), 120, rowY)
      if (item.hint) {
        ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af'
        ctx.font = '18px sans-serif'
        ctx.fillText(item.hint, 120, rowY + 26)
      }

      ctx.fillStyle = isDark ? '#f9fafb' : '#111827'
      ctx.font = 'bold 24px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(item.value, width - 120, rowY + 4)
      rowY += item.hint ? 74 : 60
    })
    ctx.textAlign = 'center'

    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return pngBlob
  }, [amountLabel, amountValue, isDark, isPending, lineItems, statusLabel, subtitle, title])

  const downloadReceipt = React.useCallback(async () => {
    if (downloading || typeof window === 'undefined' || typeof document === 'undefined') return
    setDownloading(true)
    let blob: Blob | null = null
    try {
      blob = await renderDomReceiptBlob()
    } catch {}
    try {
      if (!blob) blob = await renderFallbackReceiptBlob()
    } catch {}
    try {
      if (blob) await downloadBlob(blob)
    } finally {
      setDownloading(false)
    }
  }, [downloadBlob, downloading, renderDomReceiptBlob, renderFallbackReceiptBlob])

  return (
    <div
      className={`mx-auto w-full max-w-md rounded-[28px] border p-5 shadow-xl ${
        isPending
          ? (isDark
            ? 'border-amber-500/30 bg-gradient-to-b from-gray-900 to-gray-800 text-white'
            : 'border-amber-100 bg-gradient-to-b from-white to-amber-50/50 text-gray-900')
          : (isDark
            ? 'border-emerald-500/30 bg-gradient-to-b from-gray-900 to-gray-800 text-white'
            : 'border-emerald-100 bg-gradient-to-b from-white to-emerald-50/40 text-gray-900')
      }`}
    >
      <div ref={receiptRef}>
        <div className="flex justify-center">
          <div className="relative h-20 w-20">
            <div className={`absolute inset-0 rounded-full motion-safe:animate-ping ${isPending ? 'bg-amber-400/30' : 'bg-emerald-400/30'}`} />
            <div className={`absolute inset-2 rounded-full ${isPending ? 'bg-amber-500/25' : 'bg-emerald-500/25'}`} />
            <div className={`absolute inset-[18px] rounded-full text-white shadow-sm flex items-center justify-center motion-safe:animate-pulse ${isPending ? 'bg-amber-500' : 'bg-emerald-500'}`}>
              {isPending ? <Clock3 className="h-5 w-5" /> : <Check className="h-5 w-5" />}
            </div>
          </div>
        </div>

        <div className="mt-2 text-center">
          {statusLabel ? (
            <div className={`mb-2 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
              isPending
                ? (isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800')
                : (isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-800')
            }`}>
              {statusLabel}
            </div>
          ) : null}
          <div className="text-2xl font-semibold">{title}</div>
          <div className={`mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{subtitle}</div>
        </div>

        <div className="mt-4 text-center">
          <div className={`text-xs uppercase tracking-[0.16em] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{amountLabel}</div>
          <div className="mt-1 text-3xl font-bold">{amountValue}</div>
        </div>

        <div className={`my-4 border-t border-dashed ${isDark ? 'border-gray-600' : 'border-gray-300'}`} />

        <div
          className={`space-y-2 rounded-xl border p-3 text-sm ${
            isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white/90'
          }`}
        >
          {lineItems.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0 sm:max-w-[48%]">
                <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{item.label}</div>
                {item.hint ? <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{item.hint}</div> : null}
              </div>
              <div className="min-w-0 text-left font-medium sm:flex-1 sm:text-right">
                {item.copyValue ? (
                  <CopyableValue
                    value={item.copyValue}
                    label={item.label}
                    wrap
                    className="max-w-full sm:ml-auto sm:justify-end"
                    valueClassName="text-inherit font-medium"
                    buttonClassName="vdjv-receipt-export-hidden h-5 w-5"
                  />
                ) : <span className="break-all">{item.value}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Button
          type="button"
          className={`w-full text-white ${isPending ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
        >
          {primaryAction.label}
        </Button>
        {secondaryAction ? (
          <Button type="button" variant="ghost" className="w-full" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled}>
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className={`w-full ${
            isPending
              ? (isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100')
              : (isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20' : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100')
          }`}
          onClick={() => void downloadReceipt()}
          disabled={downloading}
        >
          <Download className="h-4 w-4 mr-2" />
          {downloading ? 'Preparing...' : 'Download Receipt'}
        </Button>
      </div>
    </div>
  )
}
