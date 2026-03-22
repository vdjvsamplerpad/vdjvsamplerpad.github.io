import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type ServiceClient = ReturnType<typeof createClient<any>>;

type RuntimeConfig = {
  dryRun: boolean;
  force: boolean;
  limit: number;
  reportPath: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2Endpoint: URL;
  storeApiBaseUrl: string;
  workspaceRoot: string;
};

type DbTarget =
  | { type: "catalog_thumbnail"; id: string; currentUrl: string }
  | { type: "store_qr"; id: string; currentUrl: string }
  | { type: "banner_image"; id: string; currentUrl: string };

type FileTarget = {
  type: "file";
  filePath: string;
  currentUrl: string;
};

type AssetReference = {
  objectKey: string;
  sourceUrl: string;
  targets: Array<DbTarget | FileTarget>;
};

type MigrationResult = {
  objectKey: string;
  sourceUrl: string;
  status: "migrated" | "skipped" | "failed";
  reason?: string;
  targetUrl: string;
  targetCount: number;
};

const TEXT_FILE_EXTENSIONS = new Set([".html", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".md"]);
const STORE_ASSET_URL_PATTERN = /https:\/\/[^\s"'`]+\/storage\/v1\/object\/public\/store-assets\/[^\s"'`)]+/g;

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const hashSha256Hex = (value: crypto.BinaryLike): string =>
  crypto.createHash("sha256").update(value).digest("hex");

const hmacSha256 = (key: crypto.BinaryLike, value: crypto.BinaryLike): Buffer =>
  crypto.createHmac("sha256", key).update(value).digest();

const toAmzDate = (date: Date): string => date.toISOString().replace(/[:-]|\.\d{3}/g, "");
const toDateStamp = (date: Date): string => toAmzDate(date).slice(0, 8);

const canonicalQuery = (entries: Array<[string, string]>): string =>
  entries
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((left, right) => {
      if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
      if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

const buildCanonicalUri = (bucket: string, objectKey: string): string =>
  `/${encodeRfc3986(bucket)}/${objectKey.split("/").map((part) => encodeRfc3986(part)).join("/")}`;

const buildAuthorizationHeaders = (input: {
  method: "PUT" | "HEAD";
  bucket: string;
  objectKey: string;
  endpoint: URL;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  contentType?: string;
  contentLength?: number;
}): Record<string, string> => {
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = buildCanonicalUri(input.bucket, input.objectKey);
  const canonicalHeadersList: Array<[string, string]> = [
    ["host", input.endpoint.host],
    ["x-amz-content-sha256", input.payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (input.contentType) canonicalHeadersList.push(["content-type", input.contentType]);
  if (Number.isFinite(input.contentLength)) canonicalHeadersList.push(["content-length", String(input.contentLength)]);
  canonicalHeadersList.sort((left, right) => left[0].localeCompare(right[0]));
  const signedHeaders = canonicalHeadersList.map(([key]) => key).join(";");
  const canonicalHeaders = canonicalHeadersList.map(([key, value]) => `${key}:${value}\n`).join("");
  const requestHash = hashSha256Hex(
    `${input.method}\n${canonicalUri}\n${canonicalQuery([])}\n${canonicalHeaders}\n${signedHeaders}\n${input.payloadHash}`,
  );
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${requestHash}`;
  const kDate = hmacSha256(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");
  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
  };
};

const required = (key: string): string => {
  const value = process.env[key]?.trim() || "";
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const requiredEither = (keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key]?.trim() || "";
    if (value) return value;
  }
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
};

const parseArgs = (): RuntimeConfig => {
  const args = new Set(process.argv.slice(2));
  const reportArg = process.argv.find((arg) => arg.startsWith("--report="));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
  const supabaseUrl = requiredEither(["APP_SUPABASE_URL", "SUPABASE_URL"]).replace(/\/+$/, "");
  const r2AccountId = required("R2_ACCOUNT_ID");
  return {
    dryRun: args.has("--dry-run"),
    force: args.has("--force"),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    reportPath: reportArg?.split("=")[1] || path.join("reports", `store-assets-r2-migration-${Date.now()}.json`),
    supabaseUrl,
    supabaseServiceRoleKey: requiredEither(["APP_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]),
    r2AccountId,
    r2AccessKeyId: required("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    r2Bucket: required("R2_BUCKET"),
    r2Endpoint: new URL(process.env.R2_ENDPOINT?.trim() || `https://${r2AccountId}.r2.cloudflarestorage.com`),
    storeApiBaseUrl: `${supabaseUrl}/functions/v1/store-api`,
    workspaceRoot: process.cwd(),
  };
};

const extractObjectKeyFromLegacyUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    const marker = "/storage/v1/object/public/store-assets/";
    if (!parsed.pathname.includes(marker)) return null;
    const objectKey = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length)).replace(/^\/+/, "");
    return objectKey || null;
  } catch {
    return null;
  }
};

const buildStoreAssetRedirectUrl = (config: RuntimeConfig, objectKey: string): string =>
  `${config.storeApiBaseUrl}/asset?path=${encodeURIComponent(objectKey)}`;

const uploadToR2 = async (
  config: RuntimeConfig,
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ etag: string | null; sizeBytes: number }> => {
  const payloadHash = hashSha256Hex(Buffer.from(bytes));
  const headers = buildAuthorizationHeaders({
    method: "PUT",
    bucket: config.r2Bucket,
    objectKey,
    endpoint: config.r2Endpoint,
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    payloadHash,
    contentType,
    contentLength: bytes.byteLength,
  });
  const uploadUrl = `${config.r2Endpoint.origin}${buildCanonicalUri(config.r2Bucket, objectKey)}`;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 upload failed (${response.status}) ${text.slice(0, 300)}`);
  }
  const etag = response.headers.get("etag")?.replace(/^"+|"+$/g, "") || null;
  return { etag, sizeBytes: bytes.byteLength };
};

const headR2Object = async (
  config: RuntimeConfig,
  objectKey: string,
): Promise<{ sizeBytes: number; etag: string | null } | null> => {
  const payloadHash = hashSha256Hex(Buffer.alloc(0));
  const headers = buildAuthorizationHeaders({
    method: "HEAD",
    bucket: config.r2Bucket,
    objectKey,
    endpoint: config.r2Endpoint,
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    payloadHash,
  });
  const headUrl = `${config.r2Endpoint.origin}${buildCanonicalUri(config.r2Bucket, objectKey)}`;
  const response = await fetch(headUrl, { method: "HEAD", headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 head failed (${response.status}) ${text.slice(0, 300)}`);
  }
  const sizeBytes = Number(response.headers.get("content-length") || 0);
  const etag = response.headers.get("etag")?.replace(/^"+|"+$/g, "") || null;
  return { sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0, etag };
};

const ensureDir = async (targetPath: string): Promise<void> => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

const listRepoFiles = async (rootDir: string): Promise<string[]> => {
  const output: string[] = [];
  const visit = async (currentPath: string) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "release" || entry.name === ".git") continue;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!TEXT_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      output.push(fullPath);
    }
  };
  await visit(rootDir);
  return output;
};

const collectFileTargets = async (config: RuntimeConfig): Promise<FileTarget[]> => {
  const targets: FileTarget[] = [];
  const clientRoot = path.join(config.workspaceRoot, "client");
  const files = await listRepoFiles(clientRoot);
  for (const filePath of files) {
    const text = await fs.readFile(filePath, "utf8").catch(() => null);
    if (!text) continue;
    const matches = text.match(STORE_ASSET_URL_PATTERN) || [];
    const uniqueMatches = Array.from(new Set(matches)) as string[];
    for (const currentUrl of uniqueMatches) {
      targets.push({
        type: "file",
        filePath,
        currentUrl,
      });
    }
  }
  return targets;
};

const collectDbTargets = async (supabase: ServiceClient): Promise<DbTarget[]> => {
  const results: DbTarget[] = [];

  const catalogQuery = await supabase
    .from("bank_catalog_items")
    .select("id,thumbnail_path")
    .not("thumbnail_path", "is", null);
  if (catalogQuery.error) throw new Error(`Failed to list catalog thumbnails: ${catalogQuery.error.message}`);
  for (const row of catalogQuery.data || []) {
    const currentUrl = String(row?.thumbnail_path || "").trim();
    if (!extractObjectKeyFromLegacyUrl(currentUrl)) continue;
    results.push({ type: "catalog_thumbnail", id: String(row.id), currentUrl });
  }

  const qrQuery = await supabase
    .from("store_payment_settings")
    .select("id,qr_image_path")
    .not("qr_image_path", "is", null);
  if (qrQuery.error) throw new Error(`Failed to list QR images: ${qrQuery.error.message}`);
  for (const row of qrQuery.data || []) {
    const currentUrl = String(row?.qr_image_path || "").trim();
    if (!extractObjectKeyFromLegacyUrl(currentUrl)) continue;
    results.push({ type: "store_qr", id: String(row.id), currentUrl });
  }

  const bannerQuery = await supabase
    .from("store_marketing_banners")
    .select("id,image_url")
    .not("image_url", "is", null);
  if (bannerQuery.error) throw new Error(`Failed to list banner images: ${bannerQuery.error.message}`);
  for (const row of bannerQuery.data || []) {
    const currentUrl = String(row?.image_url || "").trim();
    if (!extractObjectKeyFromLegacyUrl(currentUrl)) continue;
    results.push({ type: "banner_image", id: String(row.id), currentUrl });
  }

  return results;
};

const groupReferences = (targets: Array<DbTarget | FileTarget>): AssetReference[] => {
  const grouped = new Map<string, AssetReference>();
  for (const target of targets) {
    const objectKey = extractObjectKeyFromLegacyUrl(target.currentUrl);
    if (!objectKey) continue;
    const existing = grouped.get(objectKey);
    if (existing) {
      existing.targets.push(target);
      continue;
    }
    grouped.set(objectKey, {
      objectKey,
      sourceUrl: target.currentUrl,
      targets: [target],
    });
  }
  return Array.from(grouped.values()).sort((left, right) => left.objectKey.localeCompare(right.objectKey));
};

const updateDbTarget = async (
  supabase: ServiceClient,
  target: DbTarget,
  nextUrl: string,
): Promise<void> => {
  if (target.type === "catalog_thumbnail") {
    const { error } = await supabase.from("bank_catalog_items").update({ thumbnail_path: nextUrl }).eq("id", target.id);
    if (error) throw new Error(`Catalog thumbnail update failed for ${target.id}: ${error.message}`);
    return;
  }
  if (target.type === "store_qr") {
    const { error } = await supabase.from("store_payment_settings").update({ qr_image_path: nextUrl }).eq("id", target.id);
    if (error) throw new Error(`Store QR update failed for ${target.id}: ${error.message}`);
    return;
  }
  const { error } = await supabase.from("store_marketing_banners").update({ image_url: nextUrl }).eq("id", target.id);
  if (error) throw new Error(`Banner image update failed for ${target.id}: ${error.message}`);
};

const rewriteFileTarget = async (target: FileTarget, nextUrl: string): Promise<void> => {
  const original = await fs.readFile(target.filePath, "utf8");
  const updated = original.split(target.currentUrl).join(nextUrl);
  if (updated === original) return;
  await fs.writeFile(target.filePath, updated, "utf8");
};

const fetchSourceBytes = async (sourceUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> => {
  const response = await fetch(sourceUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Source download failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    contentType: String(response.headers.get("content-type") || "application/octet-stream"),
  };
};

const run = async () => {
  const config = parseArgs();
  const supabase = createClient<any>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const dbTargets = await collectDbTargets(supabase);
  const fileTargets = await collectFileTargets(config);
  let references = groupReferences([...dbTargets, ...fileTargets]);
  if (config.limit > 0) references = references.slice(0, config.limit);

  const results: MigrationResult[] = [];

  for (const reference of references) {
    const targetUrl = buildStoreAssetRedirectUrl(config, reference.objectKey);
    try {
      const existing = await headR2Object(config, reference.objectKey);
      if (!existing || config.force) {
        const source = await fetchSourceBytes(reference.sourceUrl);
        if (!config.dryRun) {
          await uploadToR2(config, reference.objectKey, source.bytes, source.contentType);
        }
      }

      if (!config.dryRun) {
        for (const target of reference.targets) {
          if (target.type === "file") {
            await rewriteFileTarget(target, targetUrl);
          } else {
            await updateDbTarget(supabase, target, targetUrl);
          }
        }
      }

      results.push({
        objectKey: reference.objectKey,
        sourceUrl: reference.sourceUrl,
        status: existing && !config.force ? "skipped" : "migrated",
        targetUrl,
        targetCount: reference.targets.length,
      });
      // eslint-disable-next-line no-console
      console.log(`${existing && !config.force ? "SKIP" : "OK"} ${reference.objectKey} -> ${targetUrl}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({
        objectKey: reference.objectKey,
        sourceUrl: reference.sourceUrl,
        status: "failed",
        reason,
        targetUrl,
        targetCount: reference.targets.length,
      });
      // eslint-disable-next-line no-console
      console.error(`FAIL ${reference.objectKey}: ${reason}`);
    }
  }

  await ensureDir(config.reportPath);
  await fs.writeFile(config.reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    force: config.force,
    total: results.length,
    migrated: results.filter((item) => item.status === "migrated").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  }, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Report written to ${config.reportPath}`);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
