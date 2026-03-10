import { supabase, supabaseUrl } from '@/lib/supabase';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, '');
const isTruthy = (value: string) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
const isLocalUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  } catch {
    return false;
  }
};

const configuredBase = (import.meta as any).env?.VITE_EDGE_FUNCTIONS_URL as string | undefined;
const allowRemoteSupabaseInDev = isTruthy(String((import.meta as any).env?.VITE_ALLOW_REMOTE_SUPABASE_IN_DEV || '').trim());
const isDev = Boolean((import.meta as any).env?.DEV);
export const edgeFunctionsBaseUrl = trimTrailingSlash(
  configuredBase && configuredBase.trim().length > 0
    ? configuredBase
    : `${supabaseUrl}/functions/v1`
);

if (isDev && !isLocalUrl(edgeFunctionsBaseUrl) && !allowRemoteSupabaseInDev) {
  throw new Error(
    'Blocked remote Edge Functions in local development. Point VITE_EDGE_FUNCTIONS_URL to local Supabase or set VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=true for explicit cloud testing.'
  );
}

export const edgeFunctionUrl = (functionName: string, route = '') => {
  const suffix = route ? `/${trimLeadingSlash(route)}` : '';
  return `${edgeFunctionsBaseUrl}/${functionName}${suffix}`;
};

export const getAuthToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
};

export const getAuthHeaders = async (requireAuth = false): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  const token = await getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (requireAuth && !token) {
    throw new Error('Not authenticated');
  }
  return headers;
};

