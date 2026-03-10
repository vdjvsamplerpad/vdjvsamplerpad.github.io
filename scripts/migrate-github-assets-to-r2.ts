import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type CatalogRow = {
  id: string;
  is_published: boolean;
  expected_asset_name: string | null;
  github_release_tag: string | null;
  github_asset_name: string | null;
  file_size_bytes: number | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_provider: string | null;
};

type MigrationItemResult = {
  catalogItemId: string;
  status: "migrated" | "skipped" | "failed";
  reason?: string;
  source?: {
    releaseTag: string;
    assetName: string;
    sizeBytes: number;
  };
  target?: {
    bucket: string;
    objectKey: string;
    sizeBytes: number;
    etag: string | null;
  };
};

type RuntimeConfig = {
  dryRun: boolean;
  force: boolean;
  limit: number;
  reportPath: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  githubOwner: string;
  githubRepo: string;
  githubToken: string | null;
  githubAppId: string | null;
  githubAppInstallationId: string | null;
  githubAppPrivateKeyPem: string | null;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2Endpoint: URL;
};

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
  const r2AccountId = required("R2_ACCOUNT_ID");
  const githubToken = process.env.GITHUB_TOKEN?.trim() || null;
  const githubAppId = process.env.GITHUB_APP_ID?.trim() || null;
  const githubAppInstallationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim() || null;
  const githubAppPrivateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY_PEM?.trim() || null;

  return {
    dryRun: args.has("--dry-run"),
    force: args.has("--force"),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    reportPath: reportArg?.split("=")[1] || path.join("reports", `r2-migration-${Date.now()}.json`),
    supabaseUrl: requiredEither(["APP_SUPABASE_URL", "SUPABASE_URL"]),
    supabaseServiceRoleKey: requiredEither(["APP_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]),
    githubOwner: requiredEither(["GITHUB_EXPORT_OWNER", "GITHUB_OWNER"]),
    githubRepo: requiredEither(["GITHUB_EXPORT_REPO", "GITHUB_REPO"]),
    githubToken,
    githubAppId,
    githubAppInstallationId,
    githubAppPrivateKeyPem,
    r2AccountId,
    r2AccessKeyId: required("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    r2Bucket: required("R2_BUCKET"),
    r2Endpoint: new URL(process.env.R2_ENDPOINT?.trim() || `https://${r2AccountId}.r2.cloudflarestorage.com`),
  };
};

const githubHeaders = (token: string | null): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  ...(token ? { Authorization: `token ${token}` } : {}),
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "vdjv-r2-migration",
});

const toBase64Url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const createGithubAppJwt = (appId: string, privateKeyPem: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const unsigned = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${unsigned}.${toBase64Url(signature)}`;
};

const resolveGithubAuthToken = async (config: RuntimeConfig): Promise<string | null> => {
  if (config.githubToken) return config.githubToken;
  if (!config.githubAppId || !config.githubAppInstallationId || !config.githubAppPrivateKeyPem) return null;

  try {
    const appJwt = createGithubAppJwt(config.githubAppId, config.githubAppPrivateKeyPem);
    const tokenResp = await fetch(
      `https://api.github.com/app/installations/${encodeURIComponent(config.githubAppInstallationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "vdjv-r2-migration",
        },
      },
    );
    if (!tokenResp.ok) {
      const text = await tokenResp.text().catch(() => "");
      throw new Error(`GitHub installation token failed (${tokenResp.status}) ${text.slice(0, 300)}`);
    }
    const payload = await tokenResp.json().catch(() => ({} as any));
    const token = String(payload?.token || "").trim();
    if (!token) throw new Error("GitHub installation token missing in response");
    return token;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`GitHub app auth unavailable, continuing without auth: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

const fetchGithubAssetBytes = async (config: RuntimeConfig, githubToken: string | null, releaseTag: string, assetName: string): Promise<{
  bytes: Uint8Array;
  sizeBytes: number;
}> => {
  const releaseUrl = `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/releases/tags/${encodeURIComponent(releaseTag)}`;
  const releaseResp = await fetch(releaseUrl, { headers: githubHeaders(githubToken) });
  if (!releaseResp.ok) {
    const text = await releaseResp.text().catch(() => "");
    throw new Error(`GitHub release lookup failed (${releaseResp.status}) ${text.slice(0, 300)}`);
  }
  const releaseData = await releaseResp.json();
  const assets = Array.isArray(releaseData?.assets) ? releaseData.assets : [];
  const matched = assets.find((entry: any) => String(entry?.name || "") === assetName);
  if (!matched) throw new Error(`GitHub asset not found: ${releaseTag}/${assetName}`);

  const assetApiUrl = String(matched?.url || "");
  if (!assetApiUrl) throw new Error(`Missing GitHub asset API url: ${releaseTag}/${assetName}`);

  const downloadResp = await fetch(assetApiUrl, {
    headers: {
      ...githubHeaders(githubToken),
      Accept: "application/octet-stream",
    },
    redirect: "follow",
  });
  if (!downloadResp.ok) {
    const text = await downloadResp.text().catch(() => "");
    throw new Error(`GitHub asset download failed (${downloadResp.status}) ${text.slice(0, 300)}`);
  }
  const arrayBuffer = await downloadResp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  return { bytes, sizeBytes: bytes.byteLength };
};

const uploadToR2 = async (
  config: RuntimeConfig,
  objectKey: string,
  bytes: Uint8Array,
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
    contentType: "application/octet-stream",
    contentLength: bytes.byteLength,
  });
  const uploadUrl = `${config.r2Endpoint.origin}${buildCanonicalUri(config.r2Bucket, objectKey)}`;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
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
  const response = await fetch(headUrl, {
    method: "HEAD",
    headers,
  });
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
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
};

const run = async () => {
  const config = parseArgs();
  const githubToken = await resolveGithubAuthToken(config);
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const query = supabase
    .from("bank_catalog_items")
    .select(
      "id,is_published,expected_asset_name,github_release_tag,github_asset_name,file_size_bytes,storage_bucket,storage_key,storage_provider",
    )
    .eq("is_published", true)
    .order("created_at", { ascending: true });
  const { data, error } = config.limit > 0 ? await query.limit(config.limit) : await query;
  if (error) throw new Error(`Failed to list catalog rows: ${error.message}`);

  const rows = (data || []) as CatalogRow[];
  const results: MigrationItemResult[] = [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const existingStorageReady = Boolean(row.storage_bucket && row.storage_key && row.storage_provider === "r2");
    if (existingStorageReady && !config.force) {
      skipped += 1;
      results.push({
        catalogItemId: row.id,
        status: "skipped",
        reason: "already_migrated",
      });
      continue;
    }

    const releaseTag = String(row.github_release_tag || "").trim();
    const assetName = String(row.github_asset_name || row.expected_asset_name || "").trim();
    if (!releaseTag || !assetName) {
      failed += 1;
      results.push({
        catalogItemId: row.id,
        status: "failed",
        reason: "missing_github_metadata",
      });
      continue;
    }

    const objectKey = `catalog/${row.id}/${assetName}`;
    try {
      const githubAsset = await fetchGithubAssetBytes(config, githubToken, releaseTag, assetName);
      if (config.dryRun) {
        skipped += 1;
        results.push({
          catalogItemId: row.id,
          status: "skipped",
          reason: "dry_run",
          source: {
            releaseTag,
            assetName,
            sizeBytes: githubAsset.sizeBytes,
          },
          target: {
            bucket: config.r2Bucket,
            objectKey,
            sizeBytes: githubAsset.sizeBytes,
            etag: null,
          },
        });
        continue;
      }

      await uploadToR2(config, objectKey, githubAsset.bytes);
      const head = await headR2Object(config, objectKey);
      if (!head || head.sizeBytes <= 0 || head.sizeBytes !== githubAsset.sizeBytes) {
        throw new Error("uploaded_object_verification_failed");
      }

      const { error: updateError } = await supabase
        .from("bank_catalog_items")
        .update({
          storage_provider: "r2",
          storage_bucket: config.r2Bucket,
          storage_key: objectKey,
          storage_etag: head.etag,
          storage_uploaded_at: new Date().toISOString(),
          file_size_bytes: head.sizeBytes,
        })
        .eq("id", row.id);
      if (updateError) throw new Error(`catalog_update_failed: ${updateError.message}`);

      migrated += 1;
      results.push({
        catalogItemId: row.id,
        status: "migrated",
        source: {
          releaseTag,
          assetName,
          sizeBytes: githubAsset.sizeBytes,
        },
        target: {
          bucket: config.r2Bucket,
          objectKey,
          sizeBytes: head.sizeBytes,
          etag: head.etag,
        },
      });
    } catch (error) {
      failed += 1;
      results.push({
        catalogItemId: row.id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        source: {
          releaseTag,
          assetName,
          sizeBytes: Number(row.file_size_bytes || 0),
        },
        target: {
          bucket: config.r2Bucket,
          objectKey,
          sizeBytes: 0,
          etag: null,
        },
      });
    }
  }

  const report = {
    startedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    force: config.force,
    limit: config.limit,
    summary: {
      total: rows.length,
      migrated,
      skipped,
      failed,
    },
    results,
  };

  await ensureDir(config.reportPath);
  await fs.writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Migration finished: total=${rows.length} migrated=${migrated} skipped=${skipped} failed=${failed}`);
  // eslint-disable-next-line no-console
  console.log(`Report written: ${config.reportPath}`);

  if (failed > 0) process.exitCode = 2;
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
