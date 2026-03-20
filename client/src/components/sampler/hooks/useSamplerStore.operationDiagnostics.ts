export type OperationName =
  | 'bank_import'
  | 'bank_export'
  | 'admin_bank_export'
  | 'app_backup_export'
  | 'app_backup_restore'
  | 'bankstore_download';

export interface OperationStage {
  stage: string;
  at: string;
  details?: Record<string, unknown>;
}

export interface OperationDiagnostics {
  operationId: string;
  operation: OperationName;
  startedAt: string;
  endedAt?: string;
  platform: string;
  isCapacitorNative: boolean;
  isElectron: boolean;
  userId?: string | null;
  stages: OperationStage[];
  metrics: Record<string, number>;
  error?: {
    message: string;
    stack?: string;
  };
}

export type OperationDebugLevel = 'info' | 'error';
export type OperationDebugPhase = 'start' | 'stage' | 'heartbeat' | 'finish' | 'error';

export interface OperationDebugEntry {
  id: number;
  ts: number;
  iso: string;
  level: OperationDebugLevel;
  phase: OperationDebugPhase;
  operationId: string;
  operation: OperationName;
  details?: Record<string, unknown>;
}

type RuntimeDescriptor = {
  platform: string;
  isCapacitorNative: boolean;
  isElectron: boolean;
};

type OperationHeartbeatOptions = {
  intervalMs?: number;
  getDetails?: () => Record<string, unknown> | undefined;
};

type OperationActivityState = {
  startedMs: number;
  lastActivityMs: number;
  lastStage: string | null;
  stageCount: number;
};

const OPERATION_DEBUG_EVENT = 'vdjv-operation-debug';
const OPERATION_DEBUG_WINDOW_KEY = '__vdjvOperationTimeline';
const OPERATION_DEBUG_MAX_ENTRIES = 600;
const OPERATION_HEARTBEAT_INTERVAL_MS = 5000;

const operationActivityById = new Map<string, OperationActivityState>();
const operationHeartbeatStopById = new Map<string, () => void>();

let operationDebugSequence = 0;

const getNowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const getWindow = (): (Window & typeof globalThis) | null => {
  if (typeof window === 'undefined') return null;
  return window;
};

const inferRuntimeDescriptor = (): RuntimeDescriptor => {
  if (typeof window === 'undefined') {
    return {
      platform: 'unknown',
      isCapacitorNative: false,
      isElectron: false,
    };
  }
  const ua = window.navigator.userAgent || '';
  const capacitor = (window as any).Capacitor;
  const isCapacitorNative = capacitor?.isNativePlatform?.() === true;
  const isElectron = /Electron/i.test(ua);
  let platform = 'web';
  if (isCapacitorNative) {
    const capacitorPlatform = typeof capacitor?.getPlatform === 'function' ? String(capacitor.getPlatform()) : '';
    platform = capacitorPlatform ? `capacitor-${capacitorPlatform}` : 'capacitor';
  } else if (isElectron) {
    platform = 'electron';
  } else if (/iPad|iPhone|iPod/i.test(ua)) {
    platform = 'ios-web';
  } else if (/Android/i.test(ua)) {
    platform = 'android-web';
  }
  return {
    platform,
    isCapacitorNative,
    isElectron,
  };
};

const ensureWindowHelpers = (): void => {
  const currentWindow = getWindow();
  if (!currentWindow) return;
  const debugWindow = currentWindow as Window & typeof globalThis & {
    [OPERATION_DEBUG_WINDOW_KEY]?: OperationDebugEntry[];
    debugOperationTimeline?: () => OperationDebugEntry[];
    debugOperationTimelineText?: () => string;
    clearOperationTimeline?: () => void;
  };
  if (!Array.isArray(debugWindow[OPERATION_DEBUG_WINDOW_KEY])) {
    debugWindow[OPERATION_DEBUG_WINDOW_KEY] = [];
  }
  debugWindow.debugOperationTimeline = () => debugWindow[OPERATION_DEBUG_WINDOW_KEY] || [];
  debugWindow.debugOperationTimelineText = () =>
    (debugWindow[OPERATION_DEBUG_WINDOW_KEY] || [])
      .map((entry) => {
        const details = entry.details ? ` ${JSON.stringify(entry.details)}` : '';
        return `${entry.iso} [${entry.level.toUpperCase()}] ${entry.operation}/${entry.phase}#${entry.operationId}${details}`;
      })
      .join('\n');
  debugWindow.clearOperationTimeline = () => {
    debugWindow[OPERATION_DEBUG_WINDOW_KEY] = [];
  };
};

const readTimelineEntries = (): OperationDebugEntry[] => {
  const currentWindow = getWindow();
  if (!currentWindow) return [];
  const debugWindow = currentWindow as Window & typeof globalThis & {
    [OPERATION_DEBUG_WINDOW_KEY]?: OperationDebugEntry[];
  };
  return Array.isArray(debugWindow[OPERATION_DEBUG_WINDOW_KEY]) ? debugWindow[OPERATION_DEBUG_WINDOW_KEY]! : [];
};

const writeTimelineEntries = (entries: OperationDebugEntry[]): void => {
  const currentWindow = getWindow();
  if (!currentWindow) return;
  const debugWindow = currentWindow as Window & typeof globalThis & {
    [OPERATION_DEBUG_WINDOW_KEY]?: OperationDebugEntry[];
  };
  debugWindow[OPERATION_DEBUG_WINDOW_KEY] = entries.slice(Math.max(0, entries.length - OPERATION_DEBUG_MAX_ENTRIES));
};

const touchOperationActivity = (operationId: string, stage: string | null = null): OperationActivityState | null => {
  const state = operationActivityById.get(operationId);
  if (!state) return null;
  state.lastActivityMs = getNowMs();
  if (stage) {
    state.lastStage = stage;
    state.stageCount += 1;
  }
  return state;
};

export const emitOperationDebug = (input: {
  operationId: string;
  operation: OperationName;
  phase: OperationDebugPhase;
  level?: OperationDebugLevel;
  details?: Record<string, unknown>;
}): OperationDebugEntry => {
  ensureWindowHelpers();
  const currentWindow = getWindow();
  const nextId = operationDebugSequence + 1;
  operationDebugSequence = nextId;
  const ts = Date.now();
  const entry: OperationDebugEntry = {
    id: nextId,
    ts,
    iso: new Date(ts).toISOString(),
    level: input.level || 'info',
    phase: input.phase,
    operationId: input.operationId,
    operation: input.operation,
    details: input.details,
  };
  writeTimelineEntries([...readTimelineEntries(), entry]);
  if (currentWindow) {
    try {
      currentWindow.dispatchEvent(new CustomEvent(OPERATION_DEBUG_EVENT, { detail: entry }));
    } catch {
      // Ignore event dispatch issues.
    }
  }
  if (input.phase === 'stage' && typeof input.details?.stage === 'string') {
    touchOperationActivity(input.operationId, input.details.stage);
  } else if (input.phase !== 'heartbeat') {
    touchOperationActivity(input.operationId);
  }
  return entry;
};

export const createOperationDiagnostics = (
  operation: OperationName,
  userId: string | null | undefined,
  runtime: RuntimeDescriptor
): OperationDiagnostics => {
  const diagnostics: OperationDiagnostics = {
    operationId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    startedAt: new Date().toISOString(),
    platform: runtime.platform,
    isCapacitorNative: runtime.isCapacitorNative,
    isElectron: runtime.isElectron,
    userId: userId || null,
    stages: [],
    metrics: {},
  };
  operationActivityById.set(diagnostics.operationId, {
    startedMs: getNowMs(),
    lastActivityMs: getNowMs(),
    lastStage: null,
    stageCount: 0,
  });
  emitOperationDebug({
    operationId: diagnostics.operationId,
    operation,
    phase: 'start',
    details: {
      platform: runtime.platform,
      isCapacitorNative: runtime.isCapacitorNative,
      isElectron: runtime.isElectron,
      userId: userId || null,
    },
  });
  return diagnostics;
};

export const createAdHocOperationDiagnostics = (
  operation: OperationName,
  userId?: string | null
): OperationDiagnostics => createOperationDiagnostics(operation, userId, inferRuntimeDescriptor());

export const addOperationStage = (
  diagnostics: OperationDiagnostics,
  stage: string,
  details?: Record<string, unknown>
): void => {
  diagnostics.stages.push({ stage, at: new Date().toISOString(), details });
  emitOperationDebug({
    operationId: diagnostics.operationId,
    operation: diagnostics.operation,
    phase: 'stage',
    details: {
      stage,
      ...details,
    },
  });
};

export const startOperationHeartbeat = (
  diagnosticsOrInput: OperationDiagnostics | { operationId: string; operation: OperationName },
  options?: OperationHeartbeatOptions
): (() => void) => {
  const operationId = diagnosticsOrInput.operationId;
  const operation = diagnosticsOrInput.operation;
  const intervalMs = Math.max(1000, options?.intervalMs || OPERATION_HEARTBEAT_INTERVAL_MS);

  const previousStop = operationHeartbeatStopById.get(operationId);
  if (previousStop) {
    previousStop();
  }

  const timerId = globalThis.setInterval(() => {
    const state = operationActivityById.get(operationId);
    const nowMs = getNowMs();
    const details = options?.getDetails?.() || {};
    emitOperationDebug({
      operationId,
      operation,
      phase: 'heartbeat',
      details: {
        elapsedMs: state ? Math.round(nowMs - state.startedMs) : undefined,
        sinceLastActivityMs: state ? Math.round(nowMs - state.lastActivityMs) : undefined,
        lastStage: state?.lastStage || null,
        stageCount: state?.stageCount || 0,
        ...details,
      },
    });
  }, intervalMs);

  const stop = () => {
    globalThis.clearInterval(timerId);
    operationHeartbeatStopById.delete(operationId);
  };
  operationHeartbeatStopById.set(operationId, stop);
  return stop;
};

export const finishOperationDiagnostics = (
  diagnostics: OperationDiagnostics,
  details?: Record<string, unknown>
): void => {
  diagnostics.endedAt = new Date().toISOString();
  const state = operationActivityById.get(diagnostics.operationId);
  emitOperationDebug({
    operationId: diagnostics.operationId,
    operation: diagnostics.operation,
    phase: 'finish',
    details: {
      elapsedMs: state ? Math.round(getNowMs() - state.startedMs) : undefined,
      stageCount: state?.stageCount || diagnostics.stages.length,
      ...details,
    },
  });
  operationHeartbeatStopById.get(diagnostics.operationId)?.();
  operationActivityById.delete(diagnostics.operationId);
};

export const failOperationDiagnostics = (
  diagnostics: OperationDiagnostics,
  error: unknown,
  details?: Record<string, unknown>
): void => {
  diagnostics.endedAt = new Date().toISOString();
  diagnostics.error = sanitizeOperationError(error);
  const state = operationActivityById.get(diagnostics.operationId);
  emitOperationDebug({
    operationId: diagnostics.operationId,
    operation: diagnostics.operation,
    phase: 'error',
    level: 'error',
    details: {
      elapsedMs: state ? Math.round(getNowMs() - state.startedMs) : undefined,
      stageCount: state?.stageCount || diagnostics.stages.length,
      message: diagnostics.error.message,
      ...details,
    },
  });
  operationHeartbeatStopById.get(diagnostics.operationId)?.();
  operationActivityById.delete(diagnostics.operationId);
};

export const sanitizeOperationError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ? error.stack.slice(0, 4000) : undefined,
    };
  }
  return { message: String(error) };
};
