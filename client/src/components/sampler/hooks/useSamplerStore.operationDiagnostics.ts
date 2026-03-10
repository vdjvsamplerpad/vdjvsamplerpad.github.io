export type OperationName = 'bank_export' | 'admin_bank_export' | 'app_backup_export' | 'app_backup_restore';

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

export const createOperationDiagnostics = (
  operation: OperationName,
  userId: string | null | undefined,
  runtime: { platform: string; isCapacitorNative: boolean; isElectron: boolean }
): OperationDiagnostics => ({
  operationId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  operation,
  startedAt: new Date().toISOString(),
  platform: runtime.platform,
  isCapacitorNative: runtime.isCapacitorNative,
  isElectron: runtime.isElectron,
  userId: userId || null,
  stages: [],
  metrics: {},
});

export const addOperationStage = (
  diagnostics: OperationDiagnostics,
  stage: string,
  details?: Record<string, unknown>
): void => {
  diagnostics.stages.push({ stage, at: new Date().toISOString(), details });
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

