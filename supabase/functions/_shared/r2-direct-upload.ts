import { createServiceClient } from "./supabase.ts";
import { asNumber, asObject, asString, asUuid } from "./validate.ts";

const R2_DIRECT_UPLOAD_SESSION_TABLE = "r2_direct_upload_sessions";

export type R2DirectUploadScope = "user_export" | "admin_catalog" | "default_bank_release";
export type R2DirectUploadSessionStatus = "issued" | "completed" | "failed" | "expired";

export type R2DirectUploadSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
  scope: R2DirectUploadScope;
  actorUserId: string;
  exportOperationId: string | null;
  catalogItemId: string | null;
  bankId: string | null;
  storageBucket: string;
  storageKey: string;
  expectedFileSizeBytes: number;
  expectedSha256: string | null;
  status: R2DirectUploadSessionStatus;
  failureReason: string | null;
  meta: Record<string, unknown>;
};

export type R2DirectUploadFinalizeCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_ALREADY_USED"
  | "SESSION_SCOPE_MISMATCH";

const mapR2DirectUploadSession = (row: any): R2DirectUploadSession => ({
  id: asUuid(row?.id) || "",
  createdAt: asString(row?.created_at, 80) || "",
  updatedAt: asString(row?.updated_at, 80) || "",
  expiresAt: asString(row?.expires_at, 80) || "",
  completedAt: asString(row?.completed_at, 80),
  scope: (asString(row?.scope, 40) as R2DirectUploadScope) || "user_export",
  actorUserId: asUuid(row?.actor_user_id) || "",
  exportOperationId: asUuid(row?.export_operation_id),
  catalogItemId: asUuid(row?.catalog_item_id),
  bankId: asUuid(row?.bank_id),
  storageBucket: asString(row?.storage_bucket, 300) || "",
  storageKey: asString(row?.storage_key, 2000) || "",
  expectedFileSizeBytes: Number(asNumber(row?.expected_file_size_bytes) || 0),
  expectedSha256: asString(row?.expected_sha256, 128),
  status: (asString(row?.status, 40) as R2DirectUploadSessionStatus) || "issued",
  failureReason: asString(row?.failure_reason, 2000),
  meta: asObject(row?.meta),
});

const isSessionTableMissing = (error: unknown): boolean => {
  const code = asString((error as { code?: unknown })?.code, 40);
  if (code === "42P01") return true;
  const message = asString((error as { message?: unknown })?.message, 600) || "";
  return /r2_direct_upload_sessions/i.test(message) && /does not exist|not found/i.test(message);
};

export const createR2DirectUploadSession = async (input: {
  scope: R2DirectUploadScope;
  actorUserId: string;
  expiresAtIso: string;
  storageBucket: string;
  storageKey: string;
  expectedFileSizeBytes: number;
  expectedSha256?: string | null;
  exportOperationId?: string | null;
  catalogItemId?: string | null;
  bankId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<R2DirectUploadSession> => {
  const admin = createServiceClient();
  const payload = {
    scope: input.scope,
    actor_user_id: input.actorUserId,
    expires_at: input.expiresAtIso,
    storage_bucket: input.storageBucket,
    storage_key: input.storageKey,
    expected_file_size_bytes: Math.max(1, Math.floor(Number(input.expectedFileSizeBytes) || 0)),
    expected_sha256: asString(input.expectedSha256, 128) || null,
    export_operation_id: asUuid(input.exportOperationId) || null,
    catalog_item_id: asUuid(input.catalogItemId) || null,
    bank_id: asUuid(input.bankId) || null,
    status: "issued",
    meta: asObject(input.meta),
  };
  const { data, error } = await admin
    .from(R2_DIRECT_UPLOAD_SESSION_TABLE)
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message || "Failed to create direct upload session");
  return mapR2DirectUploadSession(data);
};

export const readR2DirectUploadSession = async (
  sessionId: string,
): Promise<R2DirectUploadSession | null> => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from(R2_DIRECT_UPLOAD_SESSION_TABLE)
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    if (isSessionTableMissing(error)) return null;
    throw new Error(error.message || "Failed to read direct upload session");
  }
  if (!data) return null;
  return mapR2DirectUploadSession(data);
};

const markSessionExpired = async (sessionId: string): Promise<void> => {
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();
  await admin
    .from(R2_DIRECT_UPLOAD_SESSION_TABLE)
    .update({
      status: "expired",
      completed_at: nowIso,
      failure_reason: "Session expired",
    })
    .eq("id", sessionId)
    .eq("status", "issued");
};

export const finalizeR2DirectUploadSession = async (input: {
  sessionId: string;
  actorUserId: string;
  scope: R2DirectUploadScope;
  nextStatus: Exclude<R2DirectUploadSessionStatus, "issued" | "expired">;
  failureReason?: string | null;
}): Promise<{ ok: true; session: R2DirectUploadSession } | { ok: false; code: R2DirectUploadFinalizeCode }> => {
  const nowIso = new Date().toISOString();
  const admin = createServiceClient();
  const { data, error } = await admin
    .from(R2_DIRECT_UPLOAD_SESSION_TABLE)
    .update({
      status: input.nextStatus,
      completed_at: nowIso,
      failure_reason: asString(input.failureReason, 2000) || null,
    })
    .eq("id", input.sessionId)
    .eq("actor_user_id", input.actorUserId)
    .eq("scope", input.scope)
    .eq("status", "issued")
    .gt("expires_at", nowIso)
    .select("*")
    .maybeSingle();
  if (error && !isSessionTableMissing(error)) {
    throw new Error(error.message || "Failed to finalize direct upload session");
  }
  if (data) return { ok: true, session: mapR2DirectUploadSession(data) };

  const existing = await readR2DirectUploadSession(input.sessionId);
  if (!existing || existing.actorUserId !== input.actorUserId) {
    return { ok: false, code: "SESSION_NOT_FOUND" };
  }
  if (existing.scope !== input.scope) {
    return { ok: false, code: "SESSION_SCOPE_MISMATCH" };
  }
  if (existing.status !== "issued") {
    return { ok: false, code: "SESSION_ALREADY_USED" };
  }
  if (Date.now() >= new Date(existing.expiresAt).getTime()) {
    await markSessionExpired(existing.id);
    return { ok: false, code: "SESSION_EXPIRED" };
  }
  return { ok: false, code: "SESSION_ALREADY_USED" };
};
