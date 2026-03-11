import { createClient } from '@supabase/supabase-js'

const readEnv = (key: string): string => {
  const value = String((import.meta as any).env?.[key] || '').trim()
  return value
}

const isTruthy = (value: string): boolean => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())

const isLocalSupabaseUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
  } catch {
    return false
  }
}

export const supabaseUrl = readEnv('VITE_SUPABASE_URL')
export const supabaseAnonKey = readEnv('VITE_SUPABASE_ANON_KEY')
const allowRemoteSupabaseInDev = isTruthy(readEnv('VITE_ALLOW_REMOTE_SUPABASE_IN_DEV'))
const isDev = Boolean((import.meta as any).env?.DEV)

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL in frontend environment.')
}
if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY in frontend environment.')
}
if (isDev && !isLocalSupabaseUrl(supabaseUrl) && !allowRemoteSupabaseInDev) {
  throw new Error(
    'Blocked remote Supabase in local development. Point VITE_SUPABASE_URL to local Supabase or set VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=true for explicit cloud testing.'
  )
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
