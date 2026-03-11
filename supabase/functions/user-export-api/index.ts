import "@supabase/functions-js/edge-runtime.d.ts";
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import {
  createR2DirectUploadSession,
  finalizeR2DirectUploadSession,
  readR2DirectUploadSession,
} from "../_shared/r2-direct-upload.ts";
import { createPresignedPutUrl, headObject } from "../_shared/r2-storage.ts";
import { createServiceClient, getUserFromAuthHeader } from "../_shared/supabase.ts";
import { asNumber, asObject, asString, asUuid } from "../_shared/validate.ts";

const R2_BUCKET = asString(Deno.env.get("R2_BUCKET"), 200);
const R2_MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const R2_UPLOAD_URL_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, Number(asNumber(Deno.env.get("R2_UPLOAD_URL_TTL_SECONDS")) || 900)),
);
const R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS = Math.max(
  60,
  Math.min(3600, Number(asNumber(Deno.env.get("R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS")) || 900)),
);

const EXPORT_SNAPSHOT_TABLE = "user_bank_export_snapshots";
const SAMPLER_METADATA_SNAPSHOT_TABLE = "user_sampler_metadata_snapshots";

type ExportSnapshotStatus = "pending" | "uploaded" | "duplicate_no_change" | "failed";
type ExportSnapshotRow = {
  user_id: string;
  bank_id: string;
  export_operation_id: string;
  file_sha256: string | null;
  file_size_bytes: number;
  status: ExportSnapshotStatus;
  release_tag: string | null;
  release_id: number | null;
  asset_name: string | null;
  storage_provider: "r2" | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_etag: string | null;
  storage_uploaded_at: string | null;
  duplicate_of_export_operation_id: string | null;
  failure_reason: string | null;
  meta: Record<string, unknown>;
  created_at?: string | null;
};

type SamplerMetadataSnapshotRow = {
  user_id: string;
  snapshot_version: number;
  snapshot: Record<string, unknown>;
  snapshot_sha256: string | null;
  snapshot_size_bytes: number;
  updated_at?: string | null;
};

const requireAuthenticatedUser = async (
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  if (!user?.id) return { ok: false, response: json(401, { ok: false, error: "NOT_AUTHENTICATED" }, req) };
  return { ok: true, userId: user.id };
};

const requireR2Config = (req: Request): Response | null => {
  if (!R2_BUCKET) {
    return json(500, { ok: false, error: "R2_BUCKET_NOT_CONFIGURED" }, req);
  }
  return null;
};

const normalizeSha256 = (value: unknown): string | null => {
  const raw = asString(value, 128);
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return normalized;
};

const sha256HexFromText = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const isSnapshotTableMissing = (error: unknown): boolean => {
  const code = asString((error as { code?: unknown })?.code, 40);
  if (code === "42P01") return true;
  const message = asString((error as { message?: unknown })?.message, 800) || "";
  return /user_bank_export_snapshots/i.test(message) && /does not exist|not found/i.test(message);
};

const isSamplerMetadataSnapshotTableMissing = (error: unknown): boolean => {
  const code = asString((error as { code?: unknown })?.code, 40);
  if (code === "42P01") return true;
  const message = asString((error as { message?: unknown })?.message, 800) || "";
  return /user_sampler_metadata_snapshots/i.test(message) && /does not exist|not found/i.test(message);
};

const mapSnapshotRow = (row: any): ExportSnapshotRow => ({
  user_id: asUuid(row?.user_id) || "",
  bank_id: asString(row?.bank_id, 200) || "",
  export_operation_id: asUuid(row?.export_operation_id) || "",
  file_sha256: normalizeSha256(row?.file_sha256),
  file_size_bytes: Number(asNumber(row?.file_size_bytes) || 0),
  status: (asString(row?.status, 40) as ExportSnapshotStatus) || "pending",
  release_tag: asString(row?.release_tag, 300),
  release_id: Number.isFinite(Number(row?.release_id)) ? Number(row?.release_id) : null,
  asset_name: asString(row?.asset_name, 500),
  storage_provider: (asString(row?.storage_provider, 40) as "r2" | null) || null,
  storage_bucket: asString(row?.storage_bucket, 300),
  storage_key: asString(row?.storage_key, 2000),
  storage_etag: asString(row?.storage_etag, 300),
  storage_uploaded_at: asString(row?.storage_uploaded_at, 80),
  duplicate_of_export_operation_id: asUuid(row?.duplicate_of_export_operation_id),
  failure_reason: asString(row?.failure_reason, 2000),
  meta: asObject(row?.meta),
  created_at: asString(row?.created_at, 80),
});

const mapSamplerMetadataSnapshotRow = (row: any): SamplerMetadataSnapshotRow => ({
  user_id: asUuid(row?.user_id) || "",
  snapshot_version: Number(asNumber(row?.snapshot_version) || 1),
  snapshot: asObject(row?.snapshot),
  snapshot_sha256: normalizeSha256(row?.snapshot_sha256),
  snapshot_size_bytes: Number(asNumber(row?.snapshot_size_bytes) || 0),
  updated_at: asString(row?.updated_at, 80),
});

const readSnapshotByOperation = async (
  userId: string,
  exportOperationId: string,
): Promise<ExportSnapshotRow | null> => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from(EXPORT_SNAPSHOT_TABLE)
    .select(
      "user_id, bank_id, export_operation_id, file_sha256, file_size_bytes, status, release_tag, release_id, asset_name, storage_provider, storage_bucket, storage_key, storage_etag, storage_uploaded_at, duplicate_of_export_operation_id, failure_reason, meta, created_at",
    )
    .eq("user_id", userId)
    .eq("export_operation_id", exportOperationId)
    .maybeSingle();
  if (error) {
    if (isSnapshotTableMissing(error)) return null;
    throw new Error(error.message || "Failed to read export snapshot");
  }
  if (!data) return null;
  return mapSnapshotRow(data);
};

const readLatestSuccessfulSnapshot = async (
  userId: string,
  bankId: string,
): Promise<ExportSnapshotRow | null> => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from(EXPORT_SNAPSHOT_TABLE)
    .select(
      "user_id, bank_id, export_operation_id, file_sha256, file_size_bytes, status, release_tag, release_id, asset_name, storage_provider, storage_bucket, storage_key, storage_etag, storage_uploaded_at, duplicate_of_export_operation_id, failure_reason, meta, created_at",
    )
    .eq("user_id", userId)
    .eq("bank_id", bankId)
    .in("status", ["uploaded", "duplicate_no_change"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isSnapshotTableMissing(error)) return null;
    throw new Error(error.message || "Failed to read latest export snapshot");
  }
  if (!data) return null;
  return mapSnapshotRow(data);
};

const upsertSnapshot = async (row: ExportSnapshotRow): Promise<void> => {
  const admin = createServiceClient();
  const payload = {
    user_id: row.user_id,
    bank_id: row.bank_id,
    export_operation_id: row.export_operation_id,
    file_sha256: row.file_sha256 || null,
    file_size_bytes: Math.max(1, Math.floor(Number(row.file_size_bytes) || 0)),
    status: row.status,
    release_tag: row.release_tag || null,
    release_id: Number.isFinite(Number(row.release_id)) ? Math.floor(Number(row.release_id)) : null,
    asset_name: row.asset_name || null,
    storage_provider: row.storage_provider || null,
    storage_bucket: row.storage_bucket || null,
    storage_key: row.storage_key || null,
    storage_etag: row.storage_etag || null,
    storage_uploaded_at: row.storage_uploaded_at || null,
    duplicate_of_export_operation_id: row.duplicate_of_export_operation_id || null,
    failure_reason: row.failure_reason || null,
    meta: asObject(row.meta),
  };

  const { error } = await admin
    .from(EXPORT_SNAPSHOT_TABLE)
    .upsert(payload, { onConflict: "export_operation_id" });
  if (error && !isSnapshotTableMissing(error)) {
    throw new Error(error.message || "Failed to upsert export snapshot");
  }
};

const readLatestSamplerMetadataSnapshot = async (userId: string): Promise<SamplerMetadataSnapshotRow | null> => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from(SAMPLER_METADATA_SNAPSHOT_TABLE)
    .select("user_id, snapshot_version, snapshot, snapshot_sha256, snapshot_size_bytes, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isSamplerMetadataSnapshotTableMissing(error)) return null;
    throw new Error(error.message || "Failed to read sampler metadata snapshot");
  }
  if (!data) return null;
  return mapSamplerMetadataSnapshotRow(data);
};

const upsertSamplerMetadataSnapshot = async (row: SamplerMetadataSnapshotRow): Promise<void> => {
  const admin = createServiceClient();
  const payload = {
    user_id: row.user_id,
    snapshot_version: Math.max(1, Math.floor(Number(row.snapshot_version) || 1)),
    snapshot: asObject(row.snapshot),
    snapshot_sha256: row.snapshot_sha256 || null,
    snapshot_size_bytes: Math.max(0, Math.floor(Number(row.snapshot_size_bytes) || 0)),
  };
  const { error } = await admin
    .from(SAMPLER_METADATA_SNAPSHOT_TABLE)
    .upsert(payload, { onConflict: "user_id" });
  if (error && !isSamplerMetadataSnapshotTableMissing(error)) {
    throw new Error(error.message || "Failed to save sampler metadata snapshot");
  }
};

const hasR2StorageRef = (row: ExportSnapshotRow | null): boolean => {
  if (!row) return false;
  return row.storage_provider === "r2" && Boolean(row.storage_bucket) && Boolean(row.storage_key);
};

const getAssetNameFromObjectKey = (objectKey: string | null): string | null => {
  if (!objectKey) return null;
  const segments = objectKey.split("/").filter(Boolean);
  if (!segments.length) return null;
  return segments[segments.length - 1] || null;
};

const buildAssetName = (bankName: string, userId: string, exportOperationId: string) => {
  const slug = String(bankName || "bank")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "bank";
  const userShort = userId.replace(/-/g, "").slice(0, 8) || "user";
  const opShort = exportOperationId.replace(/-/g, "").slice(0, 8) || "op";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${slug}__uid_${userShort}__op_${opShort}__ts_${stamp}.bank`;
};

const buildUserExportObjectKey = (userId: string, exportOperationId: string, assetName: string): string => {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `user-export/${userId}/${yyyy}/${mm}/${exportOperationId}/${assetName}`;
};

const prepareUpload = async (req: Request, body: Record<string, unknown>, userId: string) => {
  const exportOperationId = asUuid(body.exportOperationId);
  const bankId = asString(body.bankId, 200);
  const bankName = asString(body.bankName, 200) || "bank";
  const fileSize = asNumber(body.fileSize);
  const fileSha256 = normalizeSha256(body.fileSha256);

  if (!exportOperationId) return badRequest("Missing or invalid exportOperationId", req);
  if (!bankId) return badRequest("Missing bankId", req);
  if (!Number.isFinite(fileSize) || Number(fileSize) <= 0) return badRequest("Missing or invalid fileSize", req);
  if (Number(fileSize) >= R2_MAX_ASSET_BYTES) {
    return json(413, { ok: false, error: "FILE_TOO_LARGE", maxBytes: R2_MAX_ASSET_BYTES }, req);
  }

  const existing = await readSnapshotByOperation(userId, exportOperationId);
  let targetBucket = R2_BUCKET || "";
  let targetObjectKey = "";
  let targetAssetName = "";

  if (existing) {
    const existingAssetName = existing.asset_name || getAssetNameFromObjectKey(existing.storage_key) || null;
    if (
      hasR2StorageRef(existing) &&
      (existing.status === "uploaded" || existing.status === "duplicate_no_change")
    ) {
      return json(200, {
        ok: true,
        mode: "r2_direct",
        exportOperationId,
        fileSha256: fileSha256 || existing.file_sha256 || null,
        skipUpload: true,
        skipReason: existing.status === "duplicate_no_change" ? "no_change_hash" : "already_uploaded",
        duplicateOfExportOperationId: existing.duplicate_of_export_operation_id || null,
        bucket: existing.storage_bucket,
        objectKey: existing.storage_key,
        assetName: existingAssetName,
      }, req);
    }

    if (hasR2StorageRef(existing) && existing.status === "pending") {
      targetBucket = String(existing.storage_bucket || targetBucket);
      targetObjectKey = String(existing.storage_key || "");
      targetAssetName = existingAssetName || "";

      await upsertSnapshot({
        user_id: userId,
        bank_id: bankId,
        export_operation_id: exportOperationId,
        file_sha256: fileSha256 || existing.file_sha256 || null,
        file_size_bytes: Number(fileSize),
        status: "pending",
        release_tag: existing.release_tag,
        release_id: existing.release_id,
        asset_name: targetAssetName || existing.asset_name || null,
        storage_provider: "r2",
        storage_bucket: targetBucket,
        storage_key: targetObjectKey,
        storage_etag: null,
        storage_uploaded_at: null,
        duplicate_of_export_operation_id: existing.duplicate_of_export_operation_id || null,
        failure_reason: null,
        meta: {
          ...(existing.meta || {}),
          source: "prepare-upload",
          bankName,
          dedupe: "pending_reuse",
        },
      });
    }
  }

  if (!targetObjectKey && fileSha256) {
    const latest = await readLatestSuccessfulSnapshot(userId, bankId);
    const canReuseLatest = Boolean(
      latest &&
      latest.file_sha256 &&
      latest.file_sha256 === fileSha256 &&
      hasR2StorageRef(latest),
    );
    if (canReuseLatest && latest) {
      const latestAssetName = latest.asset_name || getAssetNameFromObjectKey(latest.storage_key) || null;
      await upsertSnapshot({
        user_id: userId,
        bank_id: bankId,
        export_operation_id: exportOperationId,
        file_sha256: fileSha256,
        file_size_bytes: Number(fileSize),
        status: "duplicate_no_change",
        release_tag: latest.release_tag,
        release_id: latest.release_id,
        asset_name: latestAssetName,
        storage_provider: "r2",
        storage_bucket: latest.storage_bucket,
        storage_key: latest.storage_key,
        storage_etag: latest.storage_etag,
        storage_uploaded_at: latest.storage_uploaded_at,
        duplicate_of_export_operation_id: latest.export_operation_id,
        failure_reason: null,
        meta: {
          source: "prepare-upload",
          bankName,
          dedupe: "hash_match_latest",
        },
      });
      return json(200, {
        ok: true,
        mode: "r2_direct",
        exportOperationId,
        fileSha256,
        skipUpload: true,
        skipReason: "no_change_hash",
        duplicateOfExportOperationId: latest.export_operation_id,
        bucket: latest.storage_bucket,
        objectKey: latest.storage_key,
        assetName: latestAssetName,
      }, req);
    }
  }

  if (!targetObjectKey) {
    const assetName = buildAssetName(bankName, userId, exportOperationId);
    targetAssetName = assetName;
    targetObjectKey = buildUserExportObjectKey(userId, exportOperationId, assetName);

    await upsertSnapshot({
      user_id: userId,
      bank_id: bankId,
      export_operation_id: exportOperationId,
      file_sha256: fileSha256,
      file_size_bytes: Number(fileSize),
      status: "pending",
      release_tag: null,
      release_id: null,
      asset_name: assetName,
      storage_provider: "r2",
      storage_bucket: targetBucket,
      storage_key: targetObjectKey,
      storage_etag: null,
      storage_uploaded_at: null,
      duplicate_of_export_operation_id: null,
      failure_reason: null,
      meta: {
        source: "prepare-upload",
        bankName,
        dedupe: "none",
      },
    });
  }

  const sessionExpiresMs = Date.now() + R2_DIRECT_UPLOAD_SESSION_TTL_SECONDS * 1000;
  const maxUploadWindow = Math.max(60, Math.min(R2_UPLOAD_URL_TTL_SECONDS, Math.floor((sessionExpiresMs - Date.now()) / 1000)));

  const session = await createR2DirectUploadSession({
    scope: "user_export",
    actorUserId: userId,
    exportOperationId,
    bankId,
    storageBucket: targetBucket,
    storageKey: targetObjectKey,
    expectedFileSizeBytes: Number(fileSize),
    expectedSha256: fileSha256 || null,
    expiresAtIso: new Date(sessionExpiresMs).toISOString(),
    meta: {
      source: "prepare-upload",
      bankName,
    },
  });

  const uploadTarget = await createPresignedPutUrl(targetBucket, targetObjectKey, maxUploadWindow, "application/octet-stream");

  return json(200, {
    ok: true,
    mode: "r2_direct",
    exportOperationId,
    fileSha256: fileSha256 || null,
    skipUpload: false,
    sessionId: session.id,
    uploadUrl: uploadTarget.url,
    uploadMethod: "PUT",
    uploadHeaders: uploadTarget.headers,
    bucket: targetBucket,
    objectKey: targetObjectKey,
    assetName: targetAssetName || getAssetNameFromObjectKey(targetObjectKey),
    urlExpiresAt: uploadTarget.expiresAt,
  }, req);
};

const uploadAsset = async (req: Request, _userId: string) => {
  return json(410, { ok: false, error: "UPLOAD_RELAY_REMOVED" }, req);
};

const completeUpload = async (req: Request, body: Record<string, unknown>, userId: string) => {
  const sessionId = asUuid(body.sessionId);
  const exportOperationId = asUuid(body.exportOperationId);
  const status = asString(body.status, 40);
  const failureReason = asString(body.failureReason, 2000);
  const fileSha256 = normalizeSha256(body.fileSha256);
  const reportedEtag = asString(body.etag, 300);

  if (!sessionId) return badRequest("Missing or invalid sessionId", req);
  if (status !== "success" && status !== "failed") return badRequest("Missing or invalid status", req);

  const session = await readR2DirectUploadSession(sessionId);
  if (!session || session.actorUserId !== userId || session.scope !== "user_export") {
    return json(404, { ok: false, error: "SESSION_NOT_FOUND" }, req);
  }
  if (exportOperationId && session.exportOperationId && exportOperationId !== session.exportOperationId) {
    return json(400, { ok: false, error: "EXPORT_OPERATION_MISMATCH" }, req);
  }

  const effectiveExportOperationId = session.exportOperationId || exportOperationId;
  const existing = effectiveExportOperationId ? await readSnapshotByOperation(userId, effectiveExportOperationId) : null;
  const effectiveBankId = session.bankId || existing?.bank_id || null;

  const mapFinalizeError = (code: string): Response => {
    if (code === "SESSION_EXPIRED") return json(410, { ok: false, error: code }, req);
    if (code === "SESSION_ALREADY_USED") return json(409, { ok: false, error: code }, req);
    if (code === "SESSION_SCOPE_MISMATCH") return json(400, { ok: false, error: code }, req);
    return json(404, { ok: false, error: code }, req);
  };

  if (status === "failed") {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: userId,
      scope: "user_export",
      nextStatus: "failed",
      failureReason: failureReason || "upload_failed",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);

    if (effectiveExportOperationId && effectiveBankId) {
      await upsertSnapshot({
        user_id: userId,
        bank_id: effectiveBankId,
        export_operation_id: effectiveExportOperationId,
        file_sha256: fileSha256 || existing?.file_sha256 || session.expectedSha256 || null,
        file_size_bytes: Number(session.expectedFileSizeBytes || existing?.file_size_bytes || 1),
        status: "failed",
        release_tag: existing?.release_tag || null,
        release_id: existing?.release_id || null,
        asset_name: existing?.asset_name || getAssetNameFromObjectKey(session.storageKey),
        storage_provider: "r2",
        storage_bucket: session.storageBucket,
        storage_key: session.storageKey,
        storage_etag: existing?.storage_etag || null,
        storage_uploaded_at: existing?.storage_uploaded_at || null,
        duplicate_of_export_operation_id: existing?.duplicate_of_export_operation_id || null,
        failure_reason: failureReason || "upload_failed",
        meta: {
          ...(existing?.meta || {}),
          source: "complete-upload",
          reportStatus: "failed",
          sessionId: session.id,
        },
      });
    }
    return json(200, { ok: true, exportOperationId: effectiveExportOperationId, verified: false, status }, req);
  }

  const object = await headObject(session.storageBucket, session.storageKey);
  if (!object) {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: userId,
      scope: "user_export",
      nextStatus: "failed",
      failureReason: "ASSET_NOT_FOUND",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);

    if (effectiveExportOperationId && effectiveBankId) {
      await upsertSnapshot({
        user_id: userId,
        bank_id: effectiveBankId,
        export_operation_id: effectiveExportOperationId,
        file_sha256: fileSha256 || existing?.file_sha256 || session.expectedSha256 || null,
        file_size_bytes: Number(session.expectedFileSizeBytes || existing?.file_size_bytes || 1),
        status: "failed",
        release_tag: existing?.release_tag || null,
        release_id: existing?.release_id || null,
        asset_name: existing?.asset_name || getAssetNameFromObjectKey(session.storageKey),
        storage_provider: "r2",
        storage_bucket: session.storageBucket,
        storage_key: session.storageKey,
        storage_etag: null,
        storage_uploaded_at: null,
        duplicate_of_export_operation_id: existing?.duplicate_of_export_operation_id || null,
        failure_reason: "ASSET_NOT_FOUND",
        meta: {
          ...(existing?.meta || {}),
          source: "complete-upload",
          reportStatus: "failed",
          sessionId: session.id,
        },
      });
    }
    return json(404, { ok: false, error: "ASSET_NOT_FOUND", exportOperationId: effectiveExportOperationId }, req);
  }

  if (object.sizeBytes <= 0 || object.sizeBytes !== Number(session.expectedFileSizeBytes || 0)) {
    const finalized = await finalizeR2DirectUploadSession({
      sessionId: session.id,
      actorUserId: userId,
      scope: "user_export",
      nextStatus: "failed",
      failureReason: "ASSET_SIZE_MISMATCH",
    });
    if (!finalized.ok) return mapFinalizeError(finalized.code);

    if (effectiveExportOperationId && effectiveBankId) {
      await upsertSnapshot({
        user_id: userId,
        bank_id: effectiveBankId,
        export_operation_id: effectiveExportOperationId,
        file_sha256: fileSha256 || existing?.file_sha256 || session.expectedSha256 || null,
        file_size_bytes: Number(session.expectedFileSizeBytes || existing?.file_size_bytes || 1),
        status: "failed",
        release_tag: existing?.release_tag || null,
        release_id: existing?.release_id || null,
        asset_name: existing?.asset_name || getAssetNameFromObjectKey(session.storageKey),
        storage_provider: "r2",
        storage_bucket: session.storageBucket,
        storage_key: session.storageKey,
        storage_etag: object.etag,
        storage_uploaded_at: object.lastModified,
        duplicate_of_export_operation_id: existing?.duplicate_of_export_operation_id || null,
        failure_reason: "ASSET_SIZE_MISMATCH",
        meta: {
          ...(existing?.meta || {}),
          source: "complete-upload",
          reportStatus: "failed",
          r2AssetSize: object.sizeBytes,
          sessionId: session.id,
        },
      });
    }
    return json(409, { ok: false, error: "ASSET_SIZE_MISMATCH", exportOperationId: effectiveExportOperationId }, req);
  }

  const finalized = await finalizeR2DirectUploadSession({
    sessionId: session.id,
    actorUserId: userId,
    scope: "user_export",
    nextStatus: "completed",
  });
  if (!finalized.ok) return mapFinalizeError(finalized.code);

  if (effectiveExportOperationId && effectiveBankId) {
    await upsertSnapshot({
      user_id: userId,
      bank_id: effectiveBankId,
      export_operation_id: effectiveExportOperationId,
      file_sha256: fileSha256 || existing?.file_sha256 || session.expectedSha256 || null,
      file_size_bytes: object.sizeBytes || Number(session.expectedFileSizeBytes || existing?.file_size_bytes || 1),
      status: "uploaded",
      release_tag: existing?.release_tag || null,
      release_id: existing?.release_id || null,
      asset_name: existing?.asset_name || getAssetNameFromObjectKey(session.storageKey),
      storage_provider: "r2",
      storage_bucket: session.storageBucket,
      storage_key: session.storageKey,
      storage_etag: object.etag,
      storage_uploaded_at: new Date().toISOString(),
      duplicate_of_export_operation_id: existing?.duplicate_of_export_operation_id || null,
      failure_reason: null,
      meta: {
        ...(existing?.meta || {}),
        source: "complete-upload",
        reportStatus: "success",
        sessionId: session.id,
        r2Etag: object.etag,
        r2LastModified: object.lastModified,
        reportedEtag,
      },
    });
  }

  return json(200, {
    ok: true,
    exportOperationId: effectiveExportOperationId,
    verified: true,
    status,
    bucket: session.storageBucket,
    objectKey: session.storageKey,
    fileSize: object.sizeBytes,
    etag: object.etag,
  }, req);
};

const saveSamplerSnapshot = async (req: Request, body: Record<string, unknown>, userId: string) => {
  const snapshot = asObject(body.snapshot);
  if (!snapshot || Number(snapshot.version || 0) < 1) {
    return badRequest("Missing or invalid snapshot", req);
  }
  if (asString(snapshot.userId, 80) !== userId) {
    return json(400, { ok: false, error: "SNAPSHOT_USER_MISMATCH" }, req);
  }
  const serialized = JSON.stringify(snapshot);
  const sha = await sha256HexFromText(serialized);
  await upsertSamplerMetadataSnapshot({
    user_id: userId,
    snapshot_version: Number(snapshot.version || 1),
    snapshot,
    snapshot_sha256: sha,
    snapshot_size_bytes: serialized.length,
  });
  const latest = await readLatestSamplerMetadataSnapshot(userId);
  return json(200, {
    ok: true,
    data: {
      snapshot: latest?.snapshot || snapshot,
      savedAt: latest?.updated_at || new Date().toISOString(),
    },
  }, req);
};

const latestSamplerSnapshot = async (req: Request, userId: string) => {
  const latest = await readLatestSamplerMetadataSnapshot(userId);
  return json(200, {
    ok: true,
    data: {
      snapshot: latest?.snapshot || null,
      savedAt: latest?.updated_at || null,
    },
  }, req);
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" }, req);
    const auth = await requireAuthenticatedUser(req);
    if (!auth.ok) return auth.response;

    const route = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
    if (route === "save-sampler-snapshot") {
      const body = await req.json().catch(() => ({}));
      return await saveSamplerSnapshot(req, body, auth.userId);
    }
    if (route === "latest-sampler-snapshot") {
      return await latestSamplerSnapshot(req, auth.userId);
    }

    const configError = requireR2Config(req);
    if (configError) return configError;

    if (route === "prepare-upload") {
      const body = await req.json().catch(() => ({}));
      return await prepareUpload(req, body, auth.userId);
    }
    if (route === "upload-asset") {
      return await uploadAsset(req, auth.userId);
    }
    if (route === "complete-upload" || route === "report-upload-result") {
      const body = await req.json().catch(() => ({}));
      return await completeUpload(req, body, auth.userId);
    }
    return json(404, { ok: false, error: "UNKNOWN_ROUTE" }, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { ok: false, error: message }, req);
  }
});
