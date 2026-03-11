import express from 'express';
import dotenv from 'dotenv';
import { setupStaticServing } from './static-serve.js';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Load .env from the project root (one level up from server directory)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
// Admin Supabase client (service role) for secure admin operations
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const DISCORD_WEBHOOK_AUTH = process.env.DISCORD_WEBHOOK_AUTH as string;
const DISCORD_WEBHOOK_EXPORT = process.env.DISCORD_WEBHOOK_EXPORT as string;
const DISCORD_WEBHOOK_IMPORT = process.env.DISCORD_WEBHOOK_IMPORT as string;

const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
const ENABLE_LEGACY_EXPRESS_API = String(process.env.ENABLE_LEGACY_EXPRESS_API || '').toLowerCase() === 'true';

// Body parsing middleware - MUST be before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isLegacyApiPath = (apiPath: string): boolean => {
  return (
    apiPath.startsWith('/api/admin/') ||
    apiPath.startsWith('/api/store/') ||
    apiPath.startsWith('/api/activity/') ||
    apiPath.startsWith('/api/webhook/')
  );
};

const toEdgeFunctionRoute = (apiPath: string): string | null => {
  if (apiPath.startsWith('/api/admin/store/')) {
    return `store-api/admin/store/${apiPath.slice('/api/admin/store/'.length)}`;
  }
  if (apiPath.startsWith('/api/store/')) {
    return `store-api/${apiPath.slice('/api/store/'.length)}`;
  }
  if (apiPath.startsWith('/api/activity/')) {
    return `activity-api/${apiPath.slice('/api/activity/'.length)}`;
  }
  if (apiPath.startsWith('/api/webhook/')) {
    return `webhook-api/${apiPath.slice('/api/webhook/'.length)}`;
  }
  if (apiPath.startsWith('/api/admin/')) {
    return `admin-api/${apiPath.slice('/api/admin/'.length)}`;
  }
  return null;
};

const legacyApiMigrationUrl = (apiPath: string): string | null => {
  const route = toEdgeFunctionRoute(apiPath);
  if (!route || !SUPABASE_URL) return null;
  const trimmed = SUPABASE_URL.replace(/\/+$/, '');
  return `${trimmed}/functions/v1/${route}`;
};

app.use('/api', (req, res, next) => {
  if (ENABLE_LEGACY_EXPRESS_API) return next();
  const apiPath = `/api${req.path}`;
  if (!isLegacyApiPath(apiPath)) return next();
  res.status(410).json({
    error: 'LEGACY_API_DISABLED',
    message: 'Legacy local Express API route is disabled. Use Supabase Edge Functions.',
    route: apiPath,
    migrate_to: legacyApiMigrationUrl(apiPath),
  });
  return;
});

const parseClientIp = (req: Request): string | null => {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || '');
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim() || '';
  const normalized = first.replace('::ffff:', '');
  return normalized || null;
};

const isPrivateIp = (ip: string): boolean => {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.3')
  );
};

const fetchGeo = async (ip: string): Promise<Record<string, string> | null> => {
  try {
    if (!ip || isPrivateIp(ip)) return null;
    const resp = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { method: 'GET' });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.error) return null;
    return {
      city: data?.city || '',
      region: data?.region || '',
      country: data?.country_name || data?.country || '',
      timezone: data?.timezone || '',
      org: data?.org || data?.org_name || '',
    };
  } catch {
    return null;
  }
};

const postDiscordWebhook = async (url: string, content: string) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

const postDiscordWebhookWithTextFile = async (
  url: string,
  content: string,
  fileName: string,
  fileText: string
) => {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content }));
  form.append('file', new Blob([fileText], { type: 'text/plain' }), fileName);

  const resp = await fetch(url, {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

type ActivityEventType =
  | 'auth.login'
  | 'auth.signup'
  | 'auth.signout'
  | 'bank.export'
  | 'bank.import';

type ActivityStatus = 'success' | 'failed';

type DevicePayload = {
  fingerprint?: string | null;
  name?: string | null;
  model?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  raw?: Record<string, unknown> | null;
};

type ActivityEventPayload = {
  requestId: string;
  eventType: ActivityEventType;
  status: ActivityStatus;
  userId?: string | null;
  email?: string | null;
  sessionKey?: string | null;
  device?: DevicePayload | null;
  bankId?: string | null;
  bankName?: string | null;
  padCount?: number | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown> | null;
};

const ACTIVITY_EVENT_TYPES: ActivityEventType[] = [
  'auth.login',
  'auth.signup',
  'auth.signout',
  'bank.export',
  'bank.import',
];
const ACTIVITY_STATUS_VALUES: ActivityStatus[] = ['success', 'failed'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asString = (value: unknown, maxLen = 500): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const readPositiveInt = (value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number => {
  const parsed = asNumber(value);
  if (!parsed || parsed <= 0) return fallback;
  const floored = Math.floor(parsed);
  return Math.min(max, Math.max(min, floored));
};

const asPriceNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    normalized = cleaned.replace(/,/g, '');
  } else if (!cleaned.includes('.') && cleaned.includes(',')) {
    normalized = cleaned.replace(/,/g, '');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const asUuid = (value: unknown): string | null => {
  const s = asString(value, 80);
  if (!s) return null;
  return UUID_RE.test(s) ? s : null;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const isActivityEventType = (value: unknown): value is ActivityEventType =>
  typeof value === 'string' && ACTIVITY_EVENT_TYPES.includes(value as ActivityEventType);

const isActivityStatus = (value: unknown): value is ActivityStatus =>
  typeof value === 'string' && ACTIVITY_STATUS_VALUES.includes(value as ActivityStatus);

const normalizeDevicePayload = (value: unknown): DevicePayload => {
  const raw = asObject(value);
  return {
    fingerprint: asString(raw.fingerprint, 256),
    name: asString(raw.name, 200),
    model: asString(raw.model, 200),
    platform: asString(raw.platform, 120),
    browser: asString(raw.browser, 120),
    os: asString(raw.os, 120),
    raw: asObject(raw.raw),
  };
};

const resolveCatalogPrice = (row: any): number | null => {
  return asPriceNumber(row?.price_php ?? row?.price_label);
};

const extractPadNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const normalized = asString(item, 140);
    if (normalized) names.push(normalized);
    if (names.length >= 5000) break;
  }
  return names;
};

const mapDeviceForDisplay = (device: DevicePayload): string => {
  return (
    device.name ||
    device.model ||
    [device.platform, device.os, device.browser].filter(Boolean).join(' / ') ||
    'unknown'
  );
};

const writeActivityLog = async (payload: ActivityEventPayload) => {
  if (!adminSupabase) throw new Error('Admin client not configured');

  const metaForStorage = asObject(payload.meta);
  const insertPayload: Record<string, unknown> = {
    request_id: payload.requestId,
    event_type: payload.eventType,
    status: payload.status,
    user_id: payload.userId || null,
    email: payload.email || null,
    session_key: payload.sessionKey || null,
    device_fingerprint: payload.device?.fingerprint || null,
    device_name: payload.device?.name || null,
    device_model: payload.device?.model || null,
    platform: payload.device?.platform || null,
    browser: payload.device?.browser || null,
    os: payload.device?.os || null,
    bank_id: payload.bankId || null,
    bank_uuid: asUuid(payload.bankId),
    bank_name: payload.bankName || null,
    pad_count: payload.padCount ?? null,
    error_message: payload.errorMessage || null,
    meta: metaForStorage,
  };

  let insertResult = await adminSupabase
    .from('activity_logs')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertResult.error && /bank_uuid/i.test(insertResult.error.message || '')) {
    const { bank_uuid: _skip, ...fallbackPayload } = insertPayload;
    insertResult = await adminSupabase
      .from('activity_logs')
      .insert(fallbackPayload)
      .select('id')
      .single();
  }

  const error = insertResult.error;

  if (!error) return { deduped: false };
  if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
    return { deduped: true };
  }
  throw new Error(error.message);
};

const upsertActiveSession = async (payload: {
  sessionKey: string;
  userId: string;
  email?: string | null;
  device: DevicePayload;
  ip?: string | null;
  lastEvent?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  if (!adminSupabase) throw new Error('Admin client not configured');

  const rpcPayload = {
    p_session_key: payload.sessionKey,
    p_user_id: payload.userId,
    p_email: payload.email || null,
    p_device_fingerprint: payload.device.fingerprint || 'unknown',
    p_device_name: payload.device.name || null,
    p_device_model: payload.device.model || null,
    p_platform: payload.device.platform || null,
    p_browser: payload.device.browser || null,
    p_os: payload.device.os || null,
    p_ip: payload.ip || null,
    p_last_event: payload.lastEvent || null,
    p_meta: asObject(payload.meta),
  };

  const { error } = await adminSupabase.rpc('upsert_active_session', rpcPayload);
  if (!error) return;

  const fallback = await adminSupabase
    .from('active_sessions')
    .upsert(
      {
        session_key: payload.sessionKey,
        user_id: payload.userId,
        email: payload.email || null,
        device_fingerprint: payload.device.fingerprint || 'unknown',
        device_name: payload.device.name || null,
        device_model: payload.device.model || null,
        platform: payload.device.platform || null,
        browser: payload.device.browser || null,
        os: payload.device.os || null,
        ip: payload.ip || null,
        last_seen_at: new Date().toISOString(),
        is_online: true,
        last_event: payload.lastEvent || null,
        meta: asObject(payload.meta),
      },
      { onConflict: 'session_key' }
    );

  if (fallback.error) {
    throw new Error(fallback.error.message || error.message);
  }
};

const markSessionOffline = async (sessionKey: string, lastEvent = 'auth.signout') => {
  if (!adminSupabase) throw new Error('Admin client not configured');

  const { error } = await adminSupabase.rpc('mark_session_offline', {
    p_session_key: sessionKey,
    p_last_event: lastEvent,
  });
  if (!error) return;

  const fallback = await adminSupabase
    .from('active_sessions')
    .update({
      is_online: false,
      last_seen_at: new Date().toISOString(),
      last_event: lastEvent,
    })
    .eq('session_key', sessionKey);

  if (fallback.error) {
    throw new Error(fallback.error.message || error.message);
  }
};

const sendDiscordAuthEvent = async (
  payload: {
    eventType: ActivityEventType;
    email: string;
    device: DevicePayload;
    status?: ActivityStatus;
    errorMessage?: string | null;
  },
  req: Request
) => {
  if (!DISCORD_WEBHOOK_AUTH) return;
  const clientIp = parseClientIp(req) || 'unknown';
  const geo = clientIp !== 'unknown' ? await fetchGeo(clientIp) : null;
  const eventName = payload.eventType.replace('auth.', '').toUpperCase();
  const lines = [
    `**Auth Event:** ${eventName}`,
    payload.status ? `**Status:** ${payload.status.toUpperCase()}` : '',
    `**Email:** ${payload.email}`,
    `**IP:** ${clientIp}`,
    `**Device:** ${mapDeviceForDisplay(payload.device)}`,
    payload.device?.model ? `**Model:** ${payload.device.model}` : '',
    payload.device?.platform ? `**Platform:** ${payload.device.platform}` : '',
    payload.device?.browser ? `**Browser:** ${payload.device.browser}` : '',
    payload.device?.os ? `**OS:** ${payload.device.os}` : '',
    payload.errorMessage ? `**Failed Message:** ${payload.errorMessage}` : '',
    geo?.city || geo?.region || geo?.country
      ? `**Location:** ${[geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ')}`
      : '',
    geo?.timezone ? `**Geo TZ:** ${geo.timezone}` : '',
    geo?.org ? `**Org:** ${geo.org}` : '',
  ].filter(Boolean);
  await postDiscordWebhook(DISCORD_WEBHOOK_AUTH, lines.join('\n'));
};

const sendDiscordExportEvent = async (payload: {
  status?: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  errorMessage?: string | null;
}) => {
  if (!DISCORD_WEBHOOK_EXPORT) return;
  const lines = [
    '**Bank Export:**',
    payload.status ? `**Status:** ${payload.status.toUpperCase()}` : '',
    `**Email:** ${payload.email}`,
    `**Bank:** ${payload.bankName}`,
    `**Pad Count:** ${payload.padNames.length}`,
    payload.status === 'failed' && payload.errorMessage ? `**Failed Message:** ${payload.errorMessage}` : '',
    '**Pad List:** attached as file',
  ];
  const sanitizedBankName =
    String(payload.bankName).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'bank';
  const padListText = [
    `Bank: ${payload.bankName}`,
    `Email: ${payload.email}`,
    `Pad Count: ${payload.padNames.length}`,
    '',
    ...(payload.padNames.length ? payload.padNames.map((name) => `- ${name}`) : ['- (no pads)']),
  ].join('\n');
  await postDiscordWebhookWithTextFile(
    DISCORD_WEBHOOK_EXPORT,
    lines.join('\n'),
    `export_${sanitizedBankName}_pads.txt`,
    padListText
  );
};

const sendDiscordImportEvent = async (payload: {
  status: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  includePadList: boolean;
  errorMessage?: string | null;
}) => {
  if (!DISCORD_WEBHOOK_IMPORT) return;
  const normalizedStatus = payload.status.toUpperCase();
  const shouldShowPads = payload.includePadList && payload.padNames.length > 0;
  const lines = [
    '**Bank Import:**',
    `**Status:** ${normalizedStatus}`,
    `**Email:** ${payload.email}`,
    `**Bank:** ${payload.bankName}`,
    normalizedStatus === 'FAILED' && payload.errorMessage ? `**Failed Message:** ${payload.errorMessage}` : '',
    shouldShowPads ? `**Pad Count:** ${payload.padNames.length}` : '',
    shouldShowPads ? '**Pad List:** attached as file' : '',
  ].filter(Boolean);

  if (!shouldShowPads) {
    await postDiscordWebhook(DISCORD_WEBHOOK_IMPORT, lines.join('\n'));
    return;
  }

  const sanitizedBankName =
    String(payload.bankName).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'bank';
  const padListText = [
    `Bank: ${payload.bankName}`,
    `Email: ${payload.email}`,
    `Status: ${normalizedStatus}`,
    '',
    payload.padNames.map((name) => `- ${name}`).join('\n'),
  ].join('\n');
  await postDiscordWebhookWithTextFile(
    DISCORD_WEBHOOK_IMPORT,
    lines.join('\n'),
    `import_${sanitizedBankName}_pads.txt`,
    padListText
  );
};

const getProfileRole = async (userId: string): Promise<'admin' | 'user' | null> => {
  if (!adminSupabase) return null;
  try {
    const { data, error } = await adminSupabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.role) return null;
    return data.role === 'admin' ? 'admin' : 'user';
  } catch {
    return null;
  }
};

const isAdminUser = async (userId: string | null): Promise<boolean> => {
  if (!userId) return false;
  const role = await getProfileRole(userId);
  return role === 'admin';
};

const getUserIdFromAuthorizationHeader = async (authorizationHeader: unknown): Promise<string | null> => {
  if (!adminSupabase) return null;
  if (typeof authorizationHeader !== 'string') return null;
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error) return null;
  return data?.user?.id || null;
};

const requireAdminRequestUser = async (req: any, res: any): Promise<string | null> => {
  if (!adminSupabase) {
    res.status(500).json({ error: 'Admin client not configured' });
    return null;
  }

  const userId = await getUserIdFromAuthorizationHeader(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    return null;
  }

  const isAdmin = await isAdminUser(userId);
  if (!isAdmin) {
    res.status(403).json({ error: 'NOT_AUTHORIZED' });
    return null;
  }

  return userId;
};

const requireAuthenticatedRequestUser = async (req: any, res: any): Promise<string | null> => {
  if (!adminSupabase) {
    res.status(500).json({ error: 'Admin client not configured' });
    return null;
  }
  const userId = await getUserIdFromAuthorizationHeader(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    return null;
  }
  return userId;
};

// Admin endpoint: List users (basic pagination & search)
app.get('/api/admin/users', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const q = String(req.query.q || '').toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.max(1, Math.min(100, Number(req.query.perPage || 100)));

    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage });
    if (error) return res.status(500).json({ error: error.message });

    const mapped = (data?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      banned_until: (u as any).banned_until || null,
      display_name: (u.user_metadata as any)?.display_name || u.email?.split('@')[0] || 'User',
    }));

    const filtered = q
      ? mapped.filter((u) =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.display_name || '').toLowerCase().includes(q) ||
        (u.id || '').toLowerCase().includes(q)
      )
      : mapped;

    res.json({ users: filtered, page, perPage });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Create user (auto-confirmed)
app.post('/api/admin/users/create', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayNameInput = String(req.body?.displayName || '').trim();

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const displayName = displayNameInput || email.split('@')[0] || 'User';
    const { data: created, error: createErr } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    } as any);
    if (createErr || !created?.user) {
      return res.status(500).json({ error: createErr?.message || 'Failed to create user' });
    }

    const userId = created.user.id;
    const { error: profileErr } = await adminSupabase
      .from('profiles')
      .upsert(
        { id: userId, display_name: displayName, role: 'user' },
        { onConflict: 'id' }
      );
    if (profileErr) {
      return res.status(500).json({ error: `User created, profile setup failed: ${profileErr.message}` });
    }

    return res.json({
      ok: true,
      user: {
        id: userId,
        email: created.user.email,
        display_name: displayName,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Delete user
app.post('/api/admin/users/:id/delete', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { error } = await adminSupabase.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Ban user (disable)
app.post('/api/admin/users/:id/ban', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { hours = 24 } = req.body; // Default to 24 hours if not specified

    // Calculate ban end time
    const banEndTime = new Date();
    banEndTime.setHours(banEndTime.getHours() + hours);

    const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
      banned_until: banEndTime.toISOString()
    } as any);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Unban user
app.post('/api/admin/users/:id/unban', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { error } = await adminSupabase.auth.admin.updateUserById(userId, { banned_until: null } as any);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Send password reset (email)
app.post('/api/admin/users/:id/reset-password', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { data, error } = await adminSupabase.auth.admin.getUserById(userId);
    if (error || !data?.user) return res.status(404).json({ error: error?.message || 'User not found' });
    const email = data.user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error: resetErr } = await anon.auth.resetPasswordForEmail(email);
    if (resetErr) return res.status(500).json({ error: resetErr.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/activity/event', async (req: any, res: any) => {
  try {
    const actorUserId = await requireAuthenticatedRequestUser(req, res);
    if (!actorUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');

    const body = req.body || {};
    const requestId = asUuid(body.requestId);
    const eventType = body.eventType;
    const status = body.status;
    if (!requestId) return res.status(400).json({ error: 'Missing or invalid requestId' });
    if (!isActivityEventType(eventType)) return res.status(400).json({ error: 'Invalid eventType' });
    if (!isActivityStatus(status)) return res.status(400).json({ error: 'Invalid status' });

    const bodyUserId = asUuid(body.userId);
    if (bodyUserId && bodyUserId !== actorUserId) {
      return res.status(403).json({ error: 'ACTOR_MISMATCH' });
    }
    const userId = actorUserId;
    const sessionKey = asUuid(body.sessionKey);
    const device = normalizeDevicePayload(body.device);
    const bankName = asString(body.bankName, 200);
    const bankId = asString(body.bankId, 200);
    const errorMessage = asString(body.errorMessage, 2000);
    const meta = asObject(body.meta);
    const padNames = extractPadNames(body.padNames);
    const explicitPadCount = asNumber(body.padCount);
    const padCount = explicitPadCount ?? (padNames.length > 0 ? padNames.length : null);
    const email = asString(body.email, 320);
    const ip = parseClientIp(req);
    if (await isAdminUser(userId)) {
      return res.json({ ok: true, skippedAdmin: true });
    }

    const result = await writeActivityLog({
      requestId,
      eventType,
      status,
      userId,
      email,
      sessionKey,
      device,
      bankId,
      bankName,
      padCount,
      errorMessage,
      meta: {
        ...meta,
        padNamesCount: padNames.length,
        includePadList: Boolean(meta.includePadList),
      },
    });

    if (result.deduped) {
      return res.json({ ok: true, deduped: true });
    }

    if (status === 'success') {
      if (eventType === 'auth.signout') {
        if (sessionKey) await markSessionOffline(sessionKey, 'auth.signout');
      } else if (sessionKey && userId) {
        await upsertActiveSession({
          sessionKey,
          userId,
          email,
          device,
          ip,
          lastEvent: eventType,
          meta,
        });
      }
    }

    let discordError: string | null = null;
    try {
      if (eventType.startsWith('auth.')) {
        await sendDiscordAuthEvent({ eventType, email: email || 'unknown', device, status, errorMessage }, req);
      } else if (eventType === 'bank.export') {
        await sendDiscordExportEvent({
          status,
          email: email || 'unknown',
          bankName: bankName || 'unknown',
          padNames,
          errorMessage,
        });
      } else if (eventType === 'bank.import') {
        await sendDiscordImportEvent({
          status,
          email: email || 'unknown',
          bankName: bankName || 'unknown',
          padNames,
          includePadList: Boolean(meta.includePadList),
          errorMessage,
        });
      }
    } catch (err: any) {
      discordError = err?.message || 'Discord fanout failed';
    }

    res.json({ ok: true, discordError });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/activity/heartbeat', async (req: any, res: any) => {
  try {
    const actorUserId = await requireAuthenticatedRequestUser(req, res);
    if (!actorUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    const sessionKey = asUuid(body.sessionKey);
    const bodyUserId = asUuid(body.userId);
    if (!sessionKey) return res.status(400).json({ error: 'Missing or invalid sessionKey' });
    if (bodyUserId && bodyUserId !== actorUserId) return res.status(403).json({ error: 'ACTOR_MISMATCH' });
    const userId = actorUserId;

    const device = normalizeDevicePayload(body.device);
    if (await isAdminUser(userId)) {
      return res.json({ ok: true, skippedAdmin: true });
    }
    await upsertActiveSession({
      sessionKey,
      userId,
      email: asString(body.email, 320),
      device,
      ip: parseClientIp(req),
      lastEvent: asString(body.lastEvent, 60) || 'heartbeat',
      meta: asObject(body.meta),
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/activity/signout', async (req: any, res: any) => {
  try {
    const actorUserId = await requireAuthenticatedRequestUser(req, res);
    if (!actorUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    const requestId = asUuid(body.requestId);
    const sessionKey = asUuid(body.sessionKey);
    const bodyUserId = asUuid(body.userId);
    const status = isActivityStatus(body.status) ? body.status : 'success';
    if (!requestId) return res.status(400).json({ error: 'Missing or invalid requestId' });
    if (!sessionKey) return res.status(400).json({ error: 'Missing or invalid sessionKey' });
    if (bodyUserId && bodyUserId !== actorUserId) return res.status(403).json({ error: 'ACTOR_MISMATCH' });
    const userId = actorUserId;

    const email = asString(body.email, 320);
    const device = normalizeDevicePayload(body.device);
    const errorMessage = asString(body.errorMessage, 2000);
    if (await isAdminUser(userId)) {
      return res.json({ ok: true, skippedAdmin: true });
    }

    const result = await writeActivityLog({
      requestId,
      eventType: 'auth.signout',
      status,
      userId,
      email,
      sessionKey,
      device,
      errorMessage,
      meta: asObject(body.meta),
    });

    if (!result.deduped && status === 'success') {
      await markSessionOffline(sessionKey, 'auth.signout');
    }

    let discordError: string | null = null;
    try {
      if (!result.deduped) {
        await sendDiscordAuthEvent(
          {
            eventType: 'auth.signout',
            email: email || 'unknown',
            device,
            status,
            errorMessage,
          },
          req
        );
      }
    } catch (err: any) {
      discordError = err?.message || 'Discord fanout failed';
    }

    res.json({ ok: true, deduped: result.deduped, discordError });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.get('/api/admin/active-sessions', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');
    const q = asString(req.query.q, 120)?.toLowerCase() || '';
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));

    const { data: sessions, error: sessionsError } = await adminSupabase
      .from('v_active_sessions_now')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (sessionsError) return res.status(500).json({ error: sessionsError.message });

    const rows = Array.isArray(sessions) ? sessions : [];
    const { data: admins } = await adminSupabase.from('profiles').select('id').eq('role', 'admin');
    const adminIds = new Set((admins || []).map((a: any) => a.id));
    const nonAdminRows = rows.filter((row: any) => !adminIds.has(row?.user_id));
    const filtered = q
      ? nonAdminRows.filter((row: any) => {
        const text = [
          row?.email,
          row?.device_name,
          row?.device_model,
          row?.platform,
          row?.browser,
          row?.os,
          row?.session_key,
          row?.user_id,
          row?.device_fingerprint,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(q);
      })
      : nonAdminRows;

    const uniqueActiveUsers = new Set(filtered.map((row: any) => row.user_id)).size;

    res.json({
      counts: {
        activeSessions: filtered.length,
        activeUsers: uniqueActiveUsers,
      },
      sessions: filtered,
      total: filtered.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Bank store endpoints

const STORE_DOWNLOAD_RATE_LIMIT = readPositiveInt(process.env.STORE_DOWNLOAD_RATE_LIMIT, 20, 1, 10000);
const STORE_DOWNLOAD_RATE_WINDOW_SECONDS = readPositiveInt(process.env.STORE_DOWNLOAD_RATE_WINDOW_SECONDS, 3600, 1, 86400);
const STORE_PURCHASE_RATE_LIMIT = readPositiveInt(process.env.STORE_PURCHASE_RATE_LIMIT, 12, 1, 10000);
const STORE_PURCHASE_RATE_WINDOW_SECONDS = readPositiveInt(process.env.STORE_PURCHASE_RATE_WINDOW_SECONDS, 3600, 1, 86400);
const STORE_MAX_PURCHASE_ITEMS = readPositiveInt(process.env.STORE_MAX_PURCHASE_ITEMS, 20, 1, 200);
const STORE_MAX_DOWNLOAD_BYTES = readPositiveInt(process.env.STORE_MAX_DOWNLOAD_BYTES, 268435456, 1, 2147483647);
const ADMIN_STORE_PAGE_SIZE_DEFAULT = readPositiveInt(process.env.ADMIN_STORE_PAGE_SIZE_DEFAULT, 100, 1, 250);
const ADMIN_STORE_PAGE_SIZE_MAX = readPositiveInt(process.env.ADMIN_STORE_PAGE_SIZE_MAX, 250, 1, 500);
const PAYMENT_CHANNEL_VALUES = new Set(['image_proof', 'gcash_manual', 'maya_manual']);
const INMEMORY_RATE_LIMIT_MAX_KEYS = readPositiveInt(process.env.INMEMORY_RATE_LIMIT_MAX_KEYS, 5000, 100, 50000);
const USER_IDENTITY_CACHE_TTL_SECONDS = readPositiveInt(process.env.USER_IDENTITY_CACHE_TTL_SECONDS, 300, 30, 86400);
const USER_IDENTITY_CACHE_MAX_ENTRIES = readPositiveInt(process.env.USER_IDENTITY_CACHE_MAX_ENTRIES, 5000, 100, 100000);
const ENABLE_LEGACY_WEBHOOKS = String(process.env.ENABLE_LEGACY_WEBHOOKS || '').toLowerCase() === 'true';

type InMemoryRateBucket = { count: number; expiresAt: number };
const inMemoryRateLimits = new Map<string, InMemoryRateBucket>();

const consumeInMemoryRateLimit = (
  scope: string,
  subject: string,
  maxHits: number,
  windowSeconds: number
): { allowed: boolean; retryAfterSeconds: number } => {
  const now = Date.now();
  const key = `${scope}:${subject}`;
  const windowMs = windowSeconds * 1000;
  let bucket = inMemoryRateLimits.get(key);
  if (!bucket || now > bucket.expiresAt) {
    bucket = { count: 0, expiresAt: now + windowMs };
  }

  if (bucket.count >= maxHits) {
    const retryMs = Math.max(0, bucket.expiresAt - now);
    return { allowed: false, retryAfterSeconds: Math.ceil(retryMs / 1000) };
  }

  bucket.count += 1;
  inMemoryRateLimits.set(key, bucket);
  if (inMemoryRateLimits.size > INMEMORY_RATE_LIMIT_MAX_KEYS) {
    for (const [entryKey, entry] of inMemoryRateLimits.entries()) {
      if (now > entry.expiresAt) inMemoryRateLimits.delete(entryKey);
      if (inMemoryRateLimits.size <= INMEMORY_RATE_LIMIT_MAX_KEYS) break;
    }
    while (inMemoryRateLimits.size > INMEMORY_RATE_LIMIT_MAX_KEYS) {
      const oldestKey = inMemoryRateLimits.keys().next().value;
      if (!oldestKey) break;
      inMemoryRateLimits.delete(oldestKey);
    }
  }

  if (Math.random() < 0.05) {
    for (const [entryKey, entry] of inMemoryRateLimits.entries()) {
      if (now > entry.expiresAt) inMemoryRateLimits.delete(entryKey);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
};

const WEBHOOK_SIGNING_SECRET = asString(process.env.WEBHOOK_SIGNING_SECRET, 5000);
const WEBHOOK_MAX_SKEW_SECONDS = readPositiveInt(process.env.WEBHOOK_MAX_SKEW_SECONDS, 300, 30, 3600);
const WEBHOOK_RATE_LIMIT = readPositiveInt(process.env.WEBHOOK_RATE_LIMIT, 120, 1, 10000);
const WEBHOOK_RATE_WINDOW_SECONDS = readPositiveInt(process.env.WEBHOOK_RATE_WINDOW_SECONDS, 3600, 1, 86400);
const RATE_LIMIT_FAIL_CLOSED_SCOPES = new Set(
  String(
    process.env.RATE_LIMIT_FAIL_CLOSED_SCOPES
    || 'webhook.auth_event,webhook.export_bank,webhook.import_bank,store.purchase_request,store.download,admin.store.publish'
  )
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
);

const warnedRateLimitFallbacks = new Set<string>();

const consumeRateLimit = async (
  scope: string,
  subject: string,
  maxHits: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> => {
  const failClosed = RATE_LIMIT_FAIL_CLOSED_SCOPES.has(scope);
  if (adminSupabase) {
    const rpcResult = await adminSupabase.rpc('consume_api_rate_limit', {
      p_scope: scope,
      p_subject: subject,
      p_limit: maxHits,
      p_window_seconds: windowSeconds,
    });
    if (!rpcResult.error) {
      const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
      return {
        allowed: Boolean(row?.allowed),
        retryAfterSeconds: Number(row?.retry_after_seconds || 0),
      };
    }
    if (failClosed) {
      return { allowed: false, retryAfterSeconds: Math.max(1, windowSeconds) };
    }
    if (!warnedRateLimitFallbacks.has(scope)) {
      warnedRateLimitFallbacks.add(scope);
    }
  }
  return consumeInMemoryRateLimit(scope, subject, maxHits, windowSeconds);
};

const normalizeWebhookSignature = (value: string | null): string | null => {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.toLowerCase().startsWith('sha256=')) {
    return raw.slice(7).trim().toLowerCase();
  }
  return raw.toLowerCase();
};

const secureCompareHex = (expectedHex: string, receivedHex: string): boolean => {
  if (!/^[a-f0-9]+$/i.test(expectedHex) || !/^[a-f0-9]+$/i.test(receivedHex)) return false;
  if (expectedHex.length !== receivedHex.length) return false;
  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const receivedBuffer = Buffer.from(receivedHex, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
};

const verifyWebhookSignature = (req: Request): { ok: true } | { ok: false; error: string } => {
  if (!WEBHOOK_SIGNING_SECRET) return { ok: false, error: 'WEBHOOK_DISABLED' };

  const timestampHeader = asString(req.headers['x-webhook-timestamp'], 40);
  const signatureHeader = normalizeWebhookSignature(asString(req.headers['x-webhook-signature'], 500));
  if (!timestampHeader || !signatureHeader) return { ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' };

  const parsedTimestamp = Number(timestampHeader);
  if (!Number.isFinite(parsedTimestamp)) return { ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.abs(nowSeconds - Math.floor(parsedTimestamp));
  if (ageSeconds > WEBHOOK_MAX_SKEW_SECONDS) return { ok: false, error: 'WEBHOOK_SIGNATURE_EXPIRED' };

  const canonicalBody = JSON.stringify(req.body ?? {});
  const signedPayload = `${Math.floor(parsedTimestamp)}.${canonicalBody}`;
  const expected = createHmac('sha256', WEBHOOK_SIGNING_SECRET).update(signedPayload).digest('hex');
  if (!secureCompareHex(expected, signatureHeader)) return { ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' };

  return { ok: true };
};

const legacyWebhookMigrationUrl = (route: string): string | null => {
  if (!SUPABASE_URL) return null;
  const trimmed = SUPABASE_URL.replace(/\/+$/, '');
  return `${trimmed}/functions/v1/webhook-api/${route}`;
};

const rejectDisabledLegacyWebhook = (res: any, route: string): boolean => {
  if (ENABLE_LEGACY_WEBHOOKS) return false;
  return res.status(410).json({
    error: 'LEGACY_WEBHOOK_DISABLED',
    message: 'Use Supabase Edge webhook endpoint instead.',
    migrate_to: legacyWebhookMigrationUrl(route),
  });
};

type CachedUserIdentity = {
  display_name: string;
  email: string;
  expiresAt: number;
};
const userIdentityCache = new Map<string, CachedUserIdentity>();

const getCachedUserIdentity = (userId: string): { display_name: string; email: string } | null => {
  const cached = userIdentityCache.get(userId);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    userIdentityCache.delete(userId);
    return null;
  }
  return { display_name: cached.display_name, email: cached.email };
};

const setCachedUserIdentity = (userId: string, identity: { display_name: string; email: string }) => {
  userIdentityCache.set(userId, {
    display_name: identity.display_name || '',
    email: identity.email || '',
    expiresAt: Date.now() + (USER_IDENTITY_CACHE_TTL_SECONDS * 1000),
  });
  while (userIdentityCache.size > USER_IDENTITY_CACHE_MAX_ENTRIES) {
    const oldestKey = userIdentityCache.keys().next().value;
    if (!oldestKey) break;
    userIdentityCache.delete(oldestKey);
  }
  if (Math.random() < 0.02) {
    const now = Date.now();
    for (const [cachedUserId, value] of userIdentityCache.entries()) {
      if (now > value.expiresAt) userIdentityCache.delete(cachedUserId);
    }
  }
};

const getFirstRelationRow = (value: any) => (Array.isArray(value) ? value[0] : value);

const normalizeAdminCatalogItem = (item: any) => {
  const bank = getFirstRelationRow(item?.banks);
  const rawStatus = asString(item?.status, 20)?.toLowerCase();
  const status =
    rawStatus === 'draft' || rawStatus === 'published' || rawStatus === 'archived'
      ? rawStatus
      : item?.is_published
        ? 'published'
        : 'draft';

  return {
    ...item,
    status,
    price_php: resolveCatalogPrice(item),
    bank: {
      title: bank?.title || 'Unknown Bank',
    },
  };
};

const buildUserIdentityMap = async (
  userIds: string[]
): Promise<Record<string, { display_name: string; email: string }>> => {
  const userProfiles: Record<string, { display_name: string; email: string }> = {};
  if (!adminSupabase || userIds.length === 0) return userProfiles;
  const unresolvedUserIds: string[] = [];

  for (const userId of userIds) {
    const cached = getCachedUserIdentity(userId);
    if (cached) {
      userProfiles[userId] = cached;
      continue;
    }
    unresolvedUserIds.push(userId);
  }

  if (unresolvedUserIds.length === 0) return userProfiles;

  const { data: profiles, error: profilesError } = await adminSupabase
    .from('profiles')
    .select('id, display_name')
    .in('id', unresolvedUserIds);
  if (profilesError) throw new Error(profilesError.message);

  (profiles || []).forEach((p: any) => {
    userProfiles[p.id] = { display_name: p.display_name || '', email: '' };
  });

  await Promise.all(unresolvedUserIds.map(async (userId) => {
    const { data, error } = await adminSupabase.auth.admin.getUserById(userId);
    if (error || !data?.user) return;
    if (!userProfiles[userId]) userProfiles[userId] = { display_name: '', email: '' };
    userProfiles[userId].email = data.user.email || '';
  }));

  for (const userId of unresolvedUserIds) {
    const identity = userProfiles[userId] || { display_name: '', email: '' };
    userProfiles[userId] = identity;
    setCachedUserIdentity(userId, identity);
  }

  return userProfiles;
};

// Admin Store: List purchase requests
app.get('/api/admin/store/requests', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    const page = readPositiveInt(req.query.page, 1, 1, 1000000);
    const perPage = readPositiveInt(req.query.perPage ?? req.query.limit, ADMIN_STORE_PAGE_SIZE_DEFAULT, 1, ADMIN_STORE_PAGE_SIZE_MAX);
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const selectWithSnapshots = `
      id,
      catalog_item_id,
      user_id,
      bank_id,
      batch_id,
      status,
      payment_channel,
      payer_name,
      reference_no,
      notes,
      proof_path,
      rejection_message,
      is_paid_snapshot,
      price_label_snapshot,
      price_php_snapshot,
      created_at,
      banks ( title )
    `;
    const selectWithoutSnapshots = `
      id,
      catalog_item_id,
      user_id,
      bank_id,
      batch_id,
      status,
      payment_channel,
      payer_name,
      reference_no,
      notes,
      proof_path,
      rejection_message,
      created_at,
      banks ( title )
    `;

    let requestQuery: any = await adminSupabase
      .from('bank_purchase_requests')
      .select(selectWithSnapshots, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (requestQuery.error && /is_paid_snapshot|price_label_snapshot|price_php_snapshot/i.test(requestQuery.error.message || '')) {
      requestQuery = await adminSupabase
        .from('bank_purchase_requests')
        .select(selectWithoutSnapshots, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
    }

    if (requestQuery.error) return res.status(500).json({ error: requestQuery.error.message });
    const data: any[] = requestQuery.data || [];
    const total = Number(requestQuery.count ?? data.length);

    // Collect unique user IDs to fetch profile info
    const userIds = [...new Set(data.map((r: any) => r.user_id).filter(Boolean))];
    let userProfiles: Record<string, { display_name: string; email: string }> = {};
    if (userIds.length > 0) {
      try {
        userProfiles = await buildUserIdentityMap(userIds);
      } catch (profileErr: any) {
        return res.status(500).json({ error: profileErr?.message || 'Failed to resolve request user identities' });
      }
    }

    const catalogItemIds = [...new Set(data.map((row: any) => row.catalog_item_id).filter(Boolean))];
    const bankIds = [...new Set(data.map((row: any) => row.bank_id).filter(Boolean))];
    let catalogItemMap: Record<string, any> = {};
    let catalogByBankMap: Record<string, any> = {};

    if (catalogItemIds.length > 0) {
      let catalogQuery: any = await adminSupabase
        .from('bank_catalog_items')
        .select(`
          id,
          bank_id,
          is_published,
          is_paid,
          price_label,
          price_php,
          banks ( title )
        `)
        .in('id', catalogItemIds);
      if (catalogQuery.error && /price_php/i.test(catalogQuery.error.message || '')) {
        catalogQuery = await adminSupabase
          .from('bank_catalog_items')
          .select(`
            id,
            bank_id,
            is_published,
            is_paid,
            price_label,
            banks ( title )
          `)
          .in('id', catalogItemIds);
      }

      if (catalogQuery.error) return res.status(500).json({ error: catalogQuery.error.message });

      const catalogRows = catalogQuery.data;
      if (catalogRows) {
        catalogRows.forEach((catalogRow: any) => {
          catalogItemMap[catalogRow.id] = catalogRow;
        });
      }
    }

    if (bankIds.length > 0) {
      let catalogByBankQuery: any = await adminSupabase
        .from('bank_catalog_items')
        .select(`
          id,
          bank_id,
          is_published,
          is_paid,
          price_label,
          price_php,
          banks ( title )
        `)
        .in('bank_id', bankIds)
        .order('created_at', { ascending: false });
      if (catalogByBankQuery.error && /price_php/i.test(catalogByBankQuery.error.message || '')) {
        catalogByBankQuery = await adminSupabase
          .from('bank_catalog_items')
          .select(`
            id,
            bank_id,
            is_published,
            is_paid,
            price_label,
            banks ( title )
          `)
          .in('bank_id', bankIds)
          .order('created_at', { ascending: false });
      }

      if (catalogByBankQuery.error) return res.status(500).json({ error: catalogByBankQuery.error.message });

      const catalogRowsByBank = catalogByBankQuery.data;
      if (catalogRowsByBank) {
        catalogRowsByBank.forEach((catalogRow: any) => {
          if (!catalogRow?.bank_id) return;
          const existing = catalogByBankMap[catalogRow.bank_id];
          if (!existing) {
            catalogByBankMap[catalogRow.bank_id] = catalogRow;
            return;
          }

          const currentScore = catalogRow.is_published ? 2 : 1;
          const existingScore = existing.is_published ? 2 : 1;

          if (currentScore > existingScore) {
            catalogByBankMap[catalogRow.bank_id] = catalogRow;
          }
        });
      }
    }

    const requests = data.map((row: any) => {
      const catalogItem = catalogItemMap[row.catalog_item_id] || catalogByBankMap[row.bank_id] || null;
      const catalogBank = getFirstRelationRow(catalogItem?.banks);
      const fallbackBank = getFirstRelationRow(row.banks);
      const bankTitle = catalogBank?.title || fallbackBank?.title || 'Unknown Bank';
      const parsedSnapshotPrice = asPriceNumber(row.price_php_snapshot ?? row.price_label_snapshot);
      const parsedCatalogPrice = resolveCatalogPrice(catalogItem);
      const parsedPrice = parsedSnapshotPrice ?? parsedCatalogPrice;
      const isPaid =
        typeof row.is_paid_snapshot === 'boolean'
          ? row.is_paid_snapshot
          : (Boolean(catalogItem?.is_paid) || (parsedPrice !== null && parsedPrice > 0));
      const userProfile = userProfiles[row.user_id] || null;
      return {
        ...row,
        bank_catalog_items: {
          is_paid: isPaid,
          price_php: parsedPrice,
          banks: { title: bankTitle },
        },
        user_profile: userProfile,
      };
    });

    res.json({ requests, page, perPage, total });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin Store: Approve or reject purchase request (batch-aware)
app.post('/api/admin/store/requests/:requestId', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;

    const requestId = asUuid(req.params.requestId);
    if (!requestId) return res.status(400).json({ error: 'Invalid request id' });

    const action = String(req.body?.action || '').toLowerCase();
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const rejectionMessage = action === 'reject' ? String(req.body?.rejection_message || '') : null;

    const { data: requestRow, error: requestError } = await adminSupabase
      .from('bank_purchase_requests')
      .select('id, user_id, bank_id, status, batch_id')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!requestRow) return res.status(404).json({ error: 'Request not found' });
    if (requestRow.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }

    // Find all rows in the same batch (or just this one if no batch_id)
    let batchRows: any[] = [requestRow];
    if (requestRow.batch_id) {
      const { data: batchData } = await adminSupabase
        .from('bank_purchase_requests')
        .select('id, user_id, bank_id, status')
        .eq('batch_id', requestRow.batch_id)
        .eq('status', 'pending');
      if (batchData && batchData.length > 0) batchRows = batchData;
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected';

    // Grant access for each approved row
    if (action === 'approve') {
      for (const row of batchRows) {
        await adminSupabase
          .from('user_bank_access')
          .upsert(
            { user_id: row.user_id, bank_id: row.bank_id },
            { onConflict: 'user_id,bank_id' }
          );
      }
    }

    // Update all batch rows
    const rowIds = batchRows.map(r => r.id);
    const reviewPayload: Record<string, unknown> = {
      status: nextStatus,
      reviewed_by: adminUserId,
      reviewed_at: new Date().toISOString(),
    };
    if (rejectionMessage) reviewPayload.rejection_message = rejectionMessage;

    let updateResult = await adminSupabase
      .from('bank_purchase_requests')
      .update(reviewPayload)
      .in('id', rowIds);

    // Backward compatibility for older schemas without reviewer columns.
    if (updateResult.error && /reviewed_(by|at)/i.test(updateResult.error.message || '')) {
      const fallback: Record<string, unknown> = { status: nextStatus };
      if (rejectionMessage) fallback.rejection_message = rejectionMessage;
      updateResult = await adminSupabase
        .from('bank_purchase_requests')
        .update(fallback)
        .in('id', rowIds);
    }

    if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });

    res.json({ ok: true, ids: rowIds, status: nextStatus });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin Store: List catalog
app.get('/api/admin/store/catalog', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;
    const page = readPositiveInt(req.query.page, 1, 1, 1000000);
    const perPage = readPositiveInt(req.query.perPage ?? req.query.limit, ADMIN_STORE_PAGE_SIZE_DEFAULT, 1, ADMIN_STORE_PAGE_SIZE_MAX);
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error, count } = await adminSupabase
      .from('bank_catalog_items')
      .select(`
        *,
        banks ( title, deleted_at )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json({ error: error.message });
    const visible = (data || []).filter((item: any) => {
      const bank = getFirstRelationRow(item?.banks);
      return !bank?.deleted_at;
    });
    res.json({ items: visible.map(normalizeAdminCatalogItem), page, perPage, total: Number(count ?? visible.length) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin Store: Update catalog item fields
app.patch('/api/admin/store/catalog/:catalogItemId', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;

    const catalogItemId = asUuid(req.params.catalogItemId);
    if (!catalogItemId) return res.status(400).json({ error: 'Invalid catalog item id' });

    const body = req.body || {};
    const updates: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const nextStatus = String(body.status || '').toLowerCase();
      if (!['draft', 'published', 'archived'].includes(nextStatus)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.is_published = nextStatus === 'published';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'is_paid')) {
      if (typeof body.is_paid !== 'boolean') return res.status(400).json({ error: 'is_paid must be boolean' });
      updates.is_paid = body.is_paid;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'requires_grant')) {
      if (typeof body.requires_grant !== 'boolean') return res.status(400).json({ error: 'requires_grant must be boolean' });
      updates.requires_grant = body.requires_grant;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'price_php')) {
      if (body.price_php === null || body.price_php === '') {
        updates.price_php = null;
        if (!Object.prototype.hasOwnProperty.call(body, 'price_label')) {
          updates.price_label = null;
        }
      } else {
        const parsedPrice = Number(body.price_php);
        if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
          return res.status(400).json({ error: 'price_php must be a valid non-negative number' });
        }
        updates.price_php = parsedPrice;
        if (!Object.prototype.hasOwnProperty.call(body, 'price_label')) {
          updates.price_label = String(parsedPrice);
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'expected_asset_name')) {
      const expectedAssetName = asString(body.expected_asset_name, 500);
      if (!expectedAssetName) return res.status(400).json({ error: 'expected_asset_name must be a non-empty string' });
      updates.expected_asset_name = expectedAssetName;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    let updatePayload = { ...updates };
    let updateResult = await adminSupabase
      .from('bank_catalog_items')
      .update(updatePayload)
      .eq('id', catalogItemId)
      .select(`
        *,
        banks ( title )
      `)
      .maybeSingle();

    if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
    if (!updateResult.data) return res.status(404).json({ error: 'Catalog item not found' });

    res.json({ ok: true, item: normalizeAdminCatalogItem(updateResult.data) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin Store: Read payment config
app.get('/api/admin/store/config', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;

    const { data, error } = await adminSupabase
      .from('store_payment_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ config: data || null });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin Store: Update payment config
app.post('/api/admin/store/config', async (req: any, res: any) => {
  try {
    const adminUserId = await requireAdminRequestUser(req, res);
    if (!adminUserId) return;

    const body = req.body || {};
    const configPayload: Record<string, unknown> = {
      id: 'default',
      is_active: true,
      instructions: asString(body.instructions, 5000),
      gcash_number: asString(body.gcash_number, 80),
      maya_number: asString(body.maya_number, 80),
      messenger_url: asString(body.messenger_url, 500),
      qr_image_path: asString(body.qr_image_path, 1000),
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    };

    let upsertResult = await adminSupabase
      .from('store_payment_settings')
      .upsert(configPayload, { onConflict: 'id' })
      .select('*')
      .single();

    // Backward compatibility for schemas without updated_by.
    if (upsertResult.error && /updated_by/i.test(upsertResult.error.message || '')) {
      const { updated_by: _ignored, ...fallbackPayload } = configPayload;
      upsertResult = await adminSupabase
        .from('store_payment_settings')
        .upsert(fallbackPayload, { onConflict: 'id' })
        .select('*')
        .single();
    }

    if (upsertResult.error) return res.status(500).json({ error: upsertResult.error.message });
    res.json({ ok: true, config: upsertResult.data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// 1. Get Catalog with User Status
app.get('/api/store/catalog', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'System not configured' });

    const authHeader = req.headers.authorization;
    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data } = await adminSupabase.auth.getUser(token);
      userId = data?.user?.id || null;
    }

    // Get published catalog items and their joined bank metadata
    const { data: catalogItems, error: catalogError } = await adminSupabase
      .from('bank_catalog_items')
      .select(`
        *,
        banks (
          id, title, description, color, created_at, created_by, deleted_at
        )
      `)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (catalogError) return res.status(500).json({ error: catalogError.message });

    let userGrants = new Set<string>();
    let pendingRequests = new Set<string>();
    let approvedRequests = new Set<string>();
    let rejectedRequests = new Map<string, string>(); // bank_id -> rejection_message

    if (userId) {
      const { data: accessData } = await adminSupabase
        .from('user_bank_access')
        .select('bank_id')
        .eq('user_id', userId);

      if (accessData) {
        userGrants = new Set(accessData.map(a => a.bank_id));
      }

      const { data: requestData } = await adminSupabase
        .from('bank_purchase_requests')
        .select('bank_id, status, rejection_message')
        .eq('user_id', userId);

      if (requestData) {
        requestData.forEach((r: any) => {
          if (r.status === 'pending') pendingRequests.add(r.bank_id);
          if (r.status === 'approved') approvedRequests.add(r.bank_id);
          if (r.status === 'rejected') rejectedRequests.set(r.bank_id, r.rejection_message || '');
        });
      }
    }

    const resolvedCatalog = (catalogItems || []).map(item => {
      const bank = Array.isArray(item.banks) ? item.banks[0] : item.banks;
      if (!bank || bank.deleted_at) return null;
      const bankId = item.bank_id;
      let status = 'buy';
      let rejectionMessage: string | null = null;

      if (!item.is_paid || !item.requires_grant) {
        status = 'free_download';
      } else if (userId) {
        if (userGrants.has(bankId) || approvedRequests.has(bankId)) {
          status = 'granted_download';
        } else if (pendingRequests.has(bankId)) {
          status = 'pending';
        } else if (rejectedRequests.has(bankId)) {
          status = 'rejected';
          rejectionMessage = rejectedRequests.get(bankId) || null;
        }
      }

      return {
        ...item,
        price_php: resolveCatalogPrice(item),
        status,
        rejection_message: rejectionMessage,
        bank
      };
    }).filter(Boolean);

    res.json({ items: resolvedCatalog });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// 2. Get Payment Config
app.get('/api/store/payment-config', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'System not configured' });
    const { data: config, error } = await adminSupabase
      .from('store_payment_settings')
      .select('*')
      .eq('id', 'default')
      .eq('is_active', true)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ config: config || null });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// 3. Submit Purchase Request (supports cart checkout via items[] array)
app.post('/api/store/purchase-request', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'System not configured' });
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    const token = authHeader.replace('Bearer ', '');
    const { data: authData } = await adminSupabase.auth.getUser(token);
    const userId = authData?.user?.id;
    if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });

    const purchaseLimit = await consumeRateLimit(
      'store.purchase_request',
      userId,
      STORE_PURCHASE_RATE_LIMIT,
      STORE_PURCHASE_RATE_WINDOW_SECONDS
    );
    if (!purchaseLimit.allowed) {
      return res.status(429).json({ error: 'RATE_LIMITED', retry_after_seconds: purchaseLimit.retryAfterSeconds });
    }

    const { bankId, catalogItemId, items, paymentChannel, payerName, referenceNo, proofPath, notes } = req.body || {};
    const normalizedPaymentChannel = asString(paymentChannel, 40);
    const normalizedPayerName = asString(payerName, 120);
    const normalizedReferenceNo = asString(referenceNo, 120);
    const normalizedProofPath = asString(proofPath, 500);
    const normalizedNotes = asString(notes, 1000);

    if (normalizedPaymentChannel && !PAYMENT_CHANNEL_VALUES.has(normalizedPaymentChannel)) {
      return res.status(400).json({ error: 'Invalid paymentChannel' });
    }
    if (normalizedProofPath && !normalizedProofPath.startsWith(`${userId}/`)) {
      return res.status(400).json({ error: 'proofPath must be inside your own folder' });
    }
    if (
      normalizedProofPath &&
      !/\.(png|jpg|jpeg|webp|gif|heic|heif)$/i.test(normalizedProofPath)
    ) {
      return res.status(400).json({ error: 'proofPath must be an image file' });
    }
    if (normalizedPaymentChannel === 'image_proof' && !normalizedProofPath) {
      return res.status(400).json({ error: 'proofPath is required for image_proof' });
    }

    // Support both single item (backward compat) and cart checkout
    const itemList: Array<{ bankId: string; catalogItemId?: string }> =
      Array.isArray(items) && items.length > 0
        ? items
        : bankId
          ? [{ bankId, catalogItemId }]
          : [];

    if (itemList.length === 0) return res.status(400).json({ error: 'Missing bankId or items' });
    if (itemList.length > STORE_MAX_PURCHASE_ITEMS) {
      return res.status(413).json({ error: 'TOO_MANY_ITEMS', max_items: STORE_MAX_PURCHASE_ITEMS });
    }

    const normalizedItems: Array<{ bankId: string; catalogItemId: string }> = [];
    const seenBankIds = new Set<string>();
    for (const item of itemList) {
      const normalizedBankId = asUuid(item?.bankId);
      const normalizedCatalogItemId = asUuid(item?.catalogItemId);
      if (!normalizedBankId || !normalizedCatalogItemId) {
        return res.status(400).json({ error: 'Each item must include valid bankId and catalogItemId' });
      }
      if (seenBankIds.has(normalizedBankId)) {
        return res.status(400).json({ error: 'Duplicate bank in purchase request is not allowed' });
      }
      seenBankIds.add(normalizedBankId);
      normalizedItems.push({ bankId: normalizedBankId, catalogItemId: normalizedCatalogItemId });
    }

    const catalogItemIds = [...new Set(normalizedItems.map((item) => item.catalogItemId))];
    let catalogQuery: any = await adminSupabase
      .from('bank_catalog_items')
      .select('id, bank_id, is_paid, price_label, price_php, is_published')
      .in('id', catalogItemIds);

    if (catalogQuery.error && /price_php/i.test(catalogQuery.error.message || '')) {
      catalogQuery = await adminSupabase
        .from('bank_catalog_items')
        .select('id, bank_id, is_paid, price_label, is_published')
        .in('id', catalogItemIds);
    }

    if (catalogQuery.error) return res.status(500).json({ error: catalogQuery.error.message });
    const catalogRows = catalogQuery.data;

    const catalogById = new Map<string, any>();
    for (const row of catalogRows || []) {
      catalogById.set(row.id, row);
    }

    for (const item of normalizedItems) {
      const catalogRow = catalogById.get(item.catalogItemId);
      if (!catalogRow) return res.status(400).json({ error: `Catalog item not found: ${item.catalogItemId}` });
      if (catalogRow.bank_id !== item.bankId) {
        return res.status(400).json({ error: `Catalog item ${item.catalogItemId} does not match bank ${item.bankId}` });
      }
      if (!catalogRow.is_published) {
        return res.status(400).json({ error: `Catalog item is not published: ${item.catalogItemId}` });
      }
    }

    const requestedBankIds = [...new Set(normalizedItems.map((item) => item.bankId))];
    const { data: bankRows, error: bankRowsError } = await adminSupabase
      .from('banks')
      .select('id, deleted_at')
      .in('id', requestedBankIds);
    if (bankRowsError) return res.status(500).json({ error: bankRowsError.message });

    const deletedBankIds = new Set((bankRows || []).filter((b: any) => Boolean(b.deleted_at)).map((b: any) => b.id));
    for (const item of normalizedItems) {
      if (deletedBankIds.has(item.bankId)) {
        return res.status(400).json({ error: `Bank is archived: ${item.bankId}` });
      }
    }

    // Generate a batch_id for this checkout
    const batchId = crypto.randomUUID();

    const rowsToInsert = normalizedItems.map((item) => {
      const catalogRow = catalogById.get(item.catalogItemId);
      return {
      user_id: userId,
      bank_id: item.bankId,
      catalog_item_id: item.catalogItemId,
      is_paid_snapshot: Boolean(catalogRow?.is_paid),
      price_label_snapshot: catalogRow?.price_label || null,
      price_php_snapshot: resolveCatalogPrice(catalogRow),
      batch_id: batchId,
      status: 'pending',
      payment_channel: normalizedPaymentChannel || null,
      payer_name: normalizedPayerName || null,
      reference_no: normalizedReferenceNo || null,
      proof_path: normalizedProofPath || null,
      notes: normalizedNotes || null
      };
    });

    let insertResult = await adminSupabase
      .from('bank_purchase_requests')
      .insert(rowsToInsert)
      .select('id');

    if (insertResult.error && /is_paid_snapshot|price_label_snapshot|price_php_snapshot/i.test(insertResult.error.message || '')) {
      const fallbackRowsToInsert = rowsToInsert.map((row) => {
        const { is_paid_snapshot: _isPaidSnapshot, price_label_snapshot: _priceLabelSnapshot, price_php_snapshot: _pricePhpSnapshot, ...fallbackRow } = row;
        return fallbackRow;
      });
      insertResult = await adminSupabase
        .from('bank_purchase_requests')
        .insert(fallbackRowsToInsert)
        .select('id');
    }

    if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
    res.json({ ok: true, batchId, requestIds: (insertResult.data || []).map((r: any) => r.id) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// 4. Legacy download route delegated to the R2-backed Edge Function
app.get('/api/store/download/:catalogItemId', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'System not configured' });
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });

    const token = authHeader.replace('Bearer ', '');
    const { data: authData } = await adminSupabase.auth.getUser(token);
    const userId = authData?.user?.id;
    if (!userId) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });

    const downloadLimit = await consumeRateLimit(
      'store.download',
      userId,
      STORE_DOWNLOAD_RATE_LIMIT,
      STORE_DOWNLOAD_RATE_WINDOW_SECONDS
    );
    if (!downloadLimit.allowed) {
      return res.status(429).json({ error: 'RATE_LIMITED', retry_after_seconds: downloadLimit.retryAfterSeconds });
    }

    const catalogItemId = asUuid(req.params.catalogItemId);
    if (!catalogItemId) return res.status(400).json({ error: 'Invalid catalog item id' });
    const migrationTarget = legacyApiMigrationUrl(`/api/store/download/${catalogItemId}`);
    if (!migrationTarget) {
      return res.status(500).json({ error: 'EDGE_DOWNLOAD_ROUTE_UNAVAILABLE' });
    }

    const edgeUrl = new URL(migrationTarget);
    edgeUrl.searchParams.set('transport', 'signed_url');

    const edgeResp = await fetch(edgeUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    });
    const edgePayload = await edgeResp.json().catch(() => ({} as Record<string, unknown>));
    if (!edgeResp.ok) {
      return res.status(edgeResp.status >= 400 ? edgeResp.status : 502).json(edgePayload);
    }

    const payloadData = (edgePayload && typeof edgePayload === 'object' && 'data' in edgePayload && edgePayload.data && typeof edgePayload.data === 'object')
      ? edgePayload.data as Record<string, unknown>
      : edgePayload;
    const downloadUrl = typeof payloadData?.downloadUrl === 'string' ? payloadData.downloadUrl : '';
    if (!downloadUrl) {
      return res.status(502).json({ error: 'DOWNLOAD_URL_MISSING' });
    }

    return res.redirect(302, downloadUrl);

  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Unknown error' });
    }
  }
});

// Legacy webhook endpoints retained for backwards compatibility
app.post('/api/webhook/auth-event', async (req: any, res: any) => {
  try {
    if (rejectDisabledLegacyWebhook(res, 'auth-event')) return;
    const signatureCheck = verifyWebhookSignature(req);
    if ('error' in signatureCheck) {
      if (signatureCheck.error === 'WEBHOOK_DISABLED') return res.status(503).json({ error: signatureCheck.error });
      return res.status(401).json({ error: signatureCheck.error });
    }
    const webhookSubject = parseClientIp(req) || 'unknown';
    const webhookLimit = await consumeRateLimit(
      'webhook.auth_event',
      webhookSubject,
      WEBHOOK_RATE_LIMIT,
      WEBHOOK_RATE_WINDOW_SECONDS
    );
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'RATE_LIMITED', retry_after_seconds: webhookLimit.retryAfterSeconds });
    }

    const { event, email, device } = req.body || {};
    if (!event || !email) return res.status(400).json({ error: 'Missing event or email' });
    const rawEvent = String(event).toLowerCase();
    const mapped: ActivityEventType =
      rawEvent === 'signup' ? 'auth.signup' : rawEvent === 'signout' ? 'auth.signout' : 'auth.login';
    await sendDiscordAuthEvent(
      {
        eventType: mapped,
        email: String(email),
        device: normalizeDevicePayload({
          fingerprint: asString(device?.fingerprint, 256),
          name: asString(device?.device || device?.platform || device?.ua, 200),
          model: asString(device?.model, 200),
          platform: asString(device?.platform, 120),
          browser: asString(device?.browser, 120),
          os: asString(device?.os, 120),
          raw: asObject(device),
        }),
      },
      req
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/webhook/export-bank', async (req: any, res: any) => {
  try {
    if (rejectDisabledLegacyWebhook(res, 'export-bank')) return;
    const signatureCheck = verifyWebhookSignature(req);
    if ('error' in signatureCheck) {
      if (signatureCheck.error === 'WEBHOOK_DISABLED') return res.status(503).json({ error: signatureCheck.error });
      return res.status(401).json({ error: signatureCheck.error });
    }
    const webhookSubject = parseClientIp(req) || 'unknown';
    const webhookLimit = await consumeRateLimit(
      'webhook.export_bank',
      webhookSubject,
      WEBHOOK_RATE_LIMIT,
      WEBHOOK_RATE_WINDOW_SECONDS
    );
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'RATE_LIMITED', retry_after_seconds: webhookLimit.retryAfterSeconds });
    }

    const { email, bankName, padNames } = req.body || {};
    if (!email || !bankName || !Array.isArray(padNames)) {
      return res.status(400).json({ error: 'Missing email, bankName, or padNames' });
    }
    await sendDiscordExportEvent({
      email: String(email),
      bankName: String(bankName),
      padNames: extractPadNames(padNames),
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/webhook/import-bank', async (req: any, res: any) => {
  try {
    if (rejectDisabledLegacyWebhook(res, 'import-bank')) return;
    const signatureCheck = verifyWebhookSignature(req);
    if ('error' in signatureCheck) {
      if (signatureCheck.error === 'WEBHOOK_DISABLED') return res.status(503).json({ error: signatureCheck.error });
      return res.status(401).json({ error: signatureCheck.error });
    }
    const webhookSubject = parseClientIp(req) || 'unknown';
    const webhookLimit = await consumeRateLimit(
      'webhook.import_bank',
      webhookSubject,
      WEBHOOK_RATE_LIMIT,
      WEBHOOK_RATE_WINDOW_SECONDS
    );
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'RATE_LIMITED', retry_after_seconds: webhookLimit.retryAfterSeconds });
    }

    const { status, email, bankName, padNames, includePadList, errorMessage } = req.body || {};
    if (!status || !email || !bankName) {
      return res.status(400).json({ error: 'Missing status, email, or bankName' });
    }

    const normalizedStatus: ActivityStatus =
      String(status).toLowerCase() === 'failed' ? 'failed' : 'success';
    await sendDiscordImportEvent({
      status: normalizedStatus,
      email: String(email),
      bankName: String(bankName),
      padNames: extractPadNames(padNames),
      includePadList: Boolean(includePadList),
      errorMessage: asString(errorMessage, 2000),
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// example endpoint
// app.get('/api/hello', (req: express.Request, res: express.Response) => {
//   res.json({ message: 'Hello World!' });
// });

// Export a function to start the server
export async function startServer(port) {
  try {
    if (process.env.NODE_ENV === 'production') {
      setupStaticServing(app);
    }
    app.listen(port);
  } catch {
    process.exit(1);
  }
}

// Start the server directly if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(process.env.PORT || 3001);
}

