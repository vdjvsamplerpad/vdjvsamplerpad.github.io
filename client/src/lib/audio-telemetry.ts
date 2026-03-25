export type AudioTelemetryLevel = 'info' | 'warn' | 'error';

export interface AudioTelemetryEvent {
  at: number;
  type: string;
  level: AudioTelemetryLevel;
  data?: Record<string, unknown>;
}

interface AudioTelemetryCounters {
  warmQueued: number;
  warmStarted: number;
  warmSucceeded: number;
  warmFailed: number;
  playRequested: number;
  playStarted: number;
  errors: number;
  evictions: number;
}

export interface AudioTelemetrySession {
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  cleanExit: boolean;
  platform: string;
  appVersion: string;
  events: AudioTelemetryEvent[];
  counters: AudioTelemetryCounters;
}

export interface AudioTelemetryUiState {
  sessionId: string;
  appVersion: string;
  eventCount: number;
  counters: AudioTelemetryCounters;
  latestHeartbeat: {
    contextState: string;
    playingCount: number;
    loadedTransports: number;
    transportBudget: number;
    lastEvictedPadId: string | null;
  } | null;
  recoveredCrash: {
    sessionId: string;
    startedAt: number;
    updatedAt: number;
    eventCount: number;
  } | null;
  recentLines: string[];
}

const cloneSession = (session: AudioTelemetrySession | null): AudioTelemetrySession | null => {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    cleanExit: session.cleanExit,
    platform: session.platform,
    appVersion: session.appVersion,
    events: session.events.map((entry) => ({
      at: entry.at,
      type: entry.type,
      level: entry.level,
      data: entry.data ? { ...entry.data } : undefined,
    })),
    counters: { ...session.counters },
  };
};

const STORAGE_CURRENT_KEY = 'vdjv_audio_diag_current_session_v1';
const STORAGE_RECOVERED_KEY = 'vdjv_audio_diag_recovered_session_v1';
const MAX_EVENTS = 400;
const DEFAULT_RECENT_LINES = 12;

const DEFAULT_COUNTERS = (): AudioTelemetryCounters => ({
  warmQueued: 0,
  warmStarted: 0,
  warmSucceeded: 0,
  warmFailed: 0,
  playRequested: 0,
  playStarted: 0,
  errors: 0,
  evictions: 0
});

const safeNow = (): number => Date.now();

const shortId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
};

const resolvePlatform = (): string => {
  if (typeof window === 'undefined') return 'unknown';
  const isCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (isCapacitor) {
    if (/iPad|iPhone|iPod/.test(ua)) return 'capacitor-ios';
    if (/Android/.test(ua)) return 'capacitor-android';
    return 'capacitor-native';
  }
  if (/Electron/i.test(ua)) return 'electron';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios-web';
  if (/Android/.test(ua)) return 'android-web';
  return 'desktop-web';
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const sanitizeData = (data?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 16).map((item) => {
        if (
          item === null ||
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
        ) {
          return item;
        }
        return String(item);
      });
      return;
    }
    out[key] = String(value);
  });
  return out;
};

const formatEventLine = (event: AudioTelemetryEvent): string => {
  const time = new Date(event.at).toLocaleTimeString('en-US', { hour12: false });
  const levelTag = event.level === 'error' ? 'ERR' : event.level === 'warn' ? 'WRN' : 'INF';
  if (!event.data) return `${time} ${levelTag} ${event.type}`;
  const keys = [
    'padId',
    'bankId',
    'action',
    'quarantinedPads',
    'lastBlockedPadId',
    'lastBlockedReason',
    'runId',
    'index',
    'total',
    'queueLength',
    'warmed',
    'failureCount',
    'remainingMs',
    'reason',
    'playingCount',
    'loadedTransports',
    'totalTransportCap',
    'transportBudget',
    'lastEvictedPadId',
    'contextState',
    'message'
  ];
  const parts: string[] = [];
  keys.forEach((key) => {
    if (!(key in event.data!)) return;
    const value = event.data![key];
    parts.push(`${key}=${String(value)}`);
  });
  return `${time} ${levelTag} ${event.type}${parts.length > 0 ? ` | ${parts.join(' ')}` : ''}`;
};

export class AudioTelemetryStore {
  private session: AudioTelemetrySession;
  private recoveredCrashSession: AudioTelemetrySession | null = null;
  private listeners = new Set<() => void>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private latestHeartbeatData: AudioTelemetryUiState['latestHeartbeat'] = null;
  private initializedGlobalHooks = false;

  constructor(appVersion: string) {
    this.recoveredCrashSession = this.readSession(STORAGE_RECOVERED_KEY);
    const previous = this.readSession(STORAGE_CURRENT_KEY);
    if (previous && !previous.cleanExit) {
      this.recoveredCrashSession = previous;
      this.persistRecovered();
    }
    this.session = {
      sessionId: shortId(),
      startedAt: safeNow(),
      updatedAt: safeNow(),
      cleanExit: false,
      platform: resolvePlatform(),
      appVersion,
      events: [],
      counters: DEFAULT_COUNTERS()
    };
    this.log('session_start', {
      platform: this.session.platform,
      appVersion: this.session.appVersion
    });
    this.installGlobalHooks();
    this.persistNow();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getUiState(recentLineCount: number = DEFAULT_RECENT_LINES): AudioTelemetryUiState {
    const recentLines = this.session.events
      .slice(-Math.max(1, recentLineCount))
      .map((entry) => formatEventLine(entry));
    return {
      sessionId: this.session.sessionId,
      appVersion: this.session.appVersion,
      eventCount: this.session.events.length,
      counters: { ...this.session.counters },
      latestHeartbeat: this.latestHeartbeatData ? { ...this.latestHeartbeatData } : null,
      recoveredCrash: this.recoveredCrashSession
        ? {
            sessionId: this.recoveredCrashSession.sessionId,
            startedAt: this.recoveredCrashSession.startedAt,
            updatedAt: this.recoveredCrashSession.updatedAt,
            eventCount: this.recoveredCrashSession.events.length
          }
        : null,
      recentLines
    };
  }

  log(type: string, data?: Record<string, unknown>, level: AudioTelemetryLevel = 'info', flushNow = false): void {
    const sanitized = sanitizeData(data);
    const event: AudioTelemetryEvent = {
      at: safeNow(),
      type,
      level,
      data: sanitized
    };
    this.session.events.push(event);
    if (this.session.events.length > MAX_EVENTS) {
      this.session.events.splice(0, this.session.events.length - MAX_EVENTS);
    }
    this.session.updatedAt = event.at;
    this.bumpCounters(event);
    if (type === 'heartbeat') {
      this.latestHeartbeatData = {
        contextState: String(sanitized?.contextState || 'unknown'),
        playingCount: Number(sanitized?.playingCount || 0),
        loadedTransports: Number(sanitized?.loadedTransports || 0),
        transportBudget: Number(sanitized?.transportBudget || 0),
        lastEvictedPadId: sanitized?.lastEvictedPadId ? String(sanitized.lastEvictedPadId) : null
      };
    }
    if (flushNow) this.persistNow();
    else this.schedulePersist();
    this.notify();
  }

  markCleanExit(reason: string): void {
    this.session.cleanExit = true;
    this.session.updatedAt = safeNow();
    this.log('session_end', { reason }, 'info', true);
    this.persistNow();
  }

  markSessionActive(reason: string): void {
    if (!this.session.cleanExit) return;
    this.session.cleanExit = false;
    this.session.updatedAt = safeNow();
    this.log('session_resume', { reason }, 'info', true);
    this.persistNow();
  }

  exportCurrentSession(): boolean {
    return this.exportSessionBlob(this.session, `audio-diag-${this.session.sessionId}.json`);
  }

  exportRecoveredSession(): boolean {
    if (!this.recoveredCrashSession) return false;
    return this.exportSessionBlob(
      this.recoveredCrashSession,
      `audio-diag-recovered-${this.recoveredCrashSession.sessionId}.json`
    );
  }

  getRecoveredSessionSnapshot(): AudioTelemetrySession | null {
    return cloneSession(this.recoveredCrashSession);
  }

  getCurrentSessionSnapshot(): AudioTelemetrySession {
    return cloneSession(this.session)!;
  }

  clearRecoveredSession(): void {
    this.recoveredCrashSession = null;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_RECOVERED_KEY);
      } catch {
      }
    }
    this.notify();
  }

  private bumpCounters(event: AudioTelemetryEvent): void {
    const counters = this.session.counters;
    switch (event.type) {
      case 'warmup_queue_built':
        counters.warmQueued += Number(event.data?.queueLength || 0);
        break;
      case 'warmup_item_start':
        counters.warmStarted += 1;
        break;
      case 'warmup_item_result':
        if (event.data?.warmed) counters.warmSucceeded += 1;
        else counters.warmFailed += 1;
        break;
      case 'pad_play_request':
        counters.playRequested += 1;
        break;
      case 'pad_play_started':
        counters.playStarted += 1;
        break;
      case 'transport_evict':
        counters.evictions += 1;
        break;
      default:
        break;
    }
    if (event.level === 'error') {
      counters.errors += 1;
    }
  }

  private readSession(key: string): AudioTelemetrySession | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AudioTelemetrySession;
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.sessionId !== 'string') return null;
      if (!Array.isArray(parsed.events)) return null;
      const counters = parsed.counters || DEFAULT_COUNTERS();
      return {
        sessionId: parsed.sessionId,
        startedAt: Number(parsed.startedAt || 0),
        updatedAt: Number(parsed.updatedAt || 0),
        cleanExit: Boolean(parsed.cleanExit),
        platform: String(parsed.platform || 'unknown'),
        appVersion: String(parsed.appVersion || 'unknown'),
        events: parsed.events
          .slice(-MAX_EVENTS)
          .map((entry) => ({
            at: Number(entry.at || safeNow()),
            type: String(entry.type || 'unknown'),
            level: entry.level === 'warn' || entry.level === 'error' ? entry.level : 'info',
            data: asRecord(entry.data)
          })),
        counters: {
          warmQueued: Number(counters.warmQueued || 0),
          warmStarted: Number(counters.warmStarted || 0),
          warmSucceeded: Number(counters.warmSucceeded || 0),
          warmFailed: Number(counters.warmFailed || 0),
          playRequested: Number(counters.playRequested || 0),
          playStarted: Number(counters.playStarted || 0),
          errors: Number(counters.errors || 0),
          evictions: Number(counters.evictions || 0)
        }
      };
    } catch {
      return null;
    }
  }

  private schedulePersist(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.persistNow();
    }, 400);
  }

  private persistNow(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_CURRENT_KEY, JSON.stringify(this.session));
      this.persistRecovered();
    } catch {
    }
  }

  private persistRecovered(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.recoveredCrashSession) {
        window.localStorage.removeItem(STORAGE_RECOVERED_KEY);
        return;
      }
      window.localStorage.setItem(STORAGE_RECOVERED_KEY, JSON.stringify(this.recoveredCrashSession));
    } catch {
    }
  }

  private exportSessionBlob(session: AudioTelemetrySession, filename: string): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
      const blob = new Blob([JSON.stringify(session, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch {
      return false;
    }
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
      }
    });
  }

  private installGlobalHooks(): void {
    if (this.initializedGlobalHooks || typeof window === 'undefined') return;
    this.initializedGlobalHooks = true;

    const handleCleanExit = (reason: string) => {
      this.markCleanExit(reason);
    };

    const handleResume = (reason: string) => {
      this.markSessionActive(reason);
    };

    window.addEventListener('beforeunload', () => {
      handleCleanExit('beforeunload');
    });

    window.addEventListener('pagehide', () => {
      handleCleanExit('pagehide');
    });

    window.addEventListener('pageshow', () => {
      handleResume('pageshow');
    });

    window.addEventListener('focus', () => {
      handleResume('focus');
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          handleCleanExit('visibility_hidden');
          return;
        }
        if (document.visibilityState === 'visible') {
          handleResume('visibility_visible');
        }
      });
    }

    window.addEventListener('error', (event) => {
      this.log(
        'window_error',
        {
          message: event.message || 'unknown',
          filename: event.filename || '',
          lineno: event.lineno || 0,
          colno: event.colno || 0
        },
        'error',
        true
      );
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.log(
        'unhandled_rejection',
        {
          reason: String((event as PromiseRejectionEvent).reason || 'unknown')
        },
        'error',
        true
      );
    });

    window.addEventListener('online', () => this.log('network_online', { online: true }, 'info'));
    window.addEventListener('offline', () => this.log('network_offline', { online: false }, 'warn'));
  }
}

let telemetryStoreSingleton: AudioTelemetryStore | null = null;

export function getAudioTelemetry(appVersion: string = 'unknown'): AudioTelemetryStore {
  if (!telemetryStoreSingleton) {
    telemetryStoreSingleton = new AudioTelemetryStore(appVersion);
  }
  return telemetryStoreSingleton;
}
