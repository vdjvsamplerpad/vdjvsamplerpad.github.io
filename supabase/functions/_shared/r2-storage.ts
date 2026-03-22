import { asNumber, asString } from "./validate.ts";

type PresignedUrlResult = {
  url: string;
  expiresAt: string;
  headers: Record<string, string>;
};

type HeadObjectResult = {
  exists: true;
  sizeBytes: number;
  etag: string | null;
  lastModified: string | null;
};

const DEFAULT_REGION = "auto";
const DEFAULT_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const toAmzDate = (value: Date): string => {
  const iso = value.toISOString();
  return iso.replace(/[:-]|\.\d{3}/g, "");
};

const toDateStamp = (value: Date): string => toAmzDate(value).slice(0, 8);

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const sha256Hex = async (value: string | Uint8Array): Promise<string> => {
  const bytes = typeof value === "string" ? utf8(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
};

const hmacSha256 = async (key: Uint8Array, value: string | Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = typeof value === "string" ? utf8(value) : value;
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, payload);
  return new Uint8Array(signature);
};

const sortQueryEntries = (entries: Array<[string, string]>): Array<[string, string]> =>
  entries.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
    return 0;
  });

const toCanonicalQuery = (entries: Array<[string, string]>): string =>
  sortQueryEntries(
    entries.map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)]),
  ).map(([key, value]) => `${key}=${value}`).join("&");

const normalizeObjectKey = (value: string): string =>
  value.split("/").map((segment) => encodeRfc3986(segment)).join("/");

const buildCanonicalUri = (bucket: string, objectKey: string): string =>
  `/${encodeRfc3986(bucket)}/${normalizeObjectKey(objectKey)}`;

const sanitizeEtag = (value: string | null): string | null => {
  if (!value) return null;
  return value.replace(/^"+|"+$/g, "").trim() || null;
};

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(asNumber(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const resolveR2Config = () => {
  const accountId = asString(Deno.env.get("R2_ACCOUNT_ID"), 120);
  const accessKeyId = asString(Deno.env.get("R2_ACCESS_KEY_ID"), 200);
  const secretAccessKey = asString(Deno.env.get("R2_SECRET_ACCESS_KEY"), 500);
  const endpointRaw = asString(Deno.env.get("R2_ENDPOINT"), 500) || (
    accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null
  );

  if (!accountId || !accessKeyId || !secretAccessKey || !endpointRaw) {
    throw new Error("R2_NOT_CONFIGURED");
  }

  const endpoint = new URL(endpointRaw);
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region: DEFAULT_REGION,
    service: "s3",
  };
};

const resolveSigningKey = async (
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> => {
  const kDate = await hmacSha256(utf8(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, "aws4_request");
};

const presignRequest = async (input: {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  bucket: string;
  objectKey: string;
  expiresSeconds: number;
  signedHeaders?: Record<string, string>;
}): Promise<PresignedUrlResult> => {
  const { accessKeyId, secretAccessKey, endpoint, region, service } = resolveR2Config();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const canonicalUri = buildCanonicalUri(input.bucket, input.objectKey);
  const safeExpires = Math.max(60, Math.min(3600, Math.floor(input.expiresSeconds)));
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const signedHeaderPairs: Array<[string, string]> = [["host", endpoint.host]];
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.signedHeaders || {})) {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = String(value || "").trim();
    if (!normalizedKey || !normalizedValue || normalizedKey === "host") continue;
    signedHeaderPairs.push([normalizedKey, normalizedValue]);
    responseHeaders[key] = normalizedValue;
  }
  signedHeaderPairs.sort((left, right) => left[0].localeCompare(right[0]));
  const signedHeaders = signedHeaderPairs.map(([key]) => key).join(";");
  const canonicalHeaders = signedHeaderPairs.map(([key, value]) => `${key}:${value}\n`).join("");

  const queryEntries: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(safeExpires)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = toCanonicalQuery(queryEntries);
  const canonicalRequest =
    `${input.method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hashedCanonicalRequest}`;
  const signingKey = await resolveSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));
  const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  const url = `${endpoint.origin}${canonicalUri}?${finalQuery}`;

  return {
    url,
    expiresAt: new Date(now.getTime() + safeExpires * 1000).toISOString(),
    headers: responseHeaders,
  };
};

export const createPresignedPutUrl = async (
  bucket: string,
  objectKey: string,
  expiresSeconds = readPositiveInt(Deno.env.get("R2_UPLOAD_URL_TTL_SECONDS"), 900),
  contentType = DEFAULT_UPLOAD_CONTENT_TYPE,
): Promise<PresignedUrlResult> => {
  const safeBucket = asString(bucket, 200);
  const safeObjectKey = asString(objectKey, 2000);
  if (!safeBucket || !safeObjectKey) throw new Error("Invalid R2 object target");
  return await presignRequest({
    method: "PUT",
    bucket: safeBucket,
    objectKey: safeObjectKey,
    expiresSeconds,
    signedHeaders: {
      "Content-Type": asString(contentType, 200) || DEFAULT_UPLOAD_CONTENT_TYPE,
    },
  });
};

export const createPresignedGetUrl = async (
  bucket: string,
  objectKey: string,
  expiresSeconds = readPositiveInt(Deno.env.get("R2_SIGNED_URL_TTL_SECONDS"), 300),
): Promise<PresignedUrlResult> => {
  const safeBucket = asString(bucket, 200);
  const safeObjectKey = asString(objectKey, 2000);
  if (!safeBucket || !safeObjectKey) throw new Error("Invalid R2 object target");
  return await presignRequest({
    method: "GET",
    bucket: safeBucket,
    objectKey: safeObjectKey,
    expiresSeconds,
  });
};

const createPresignedHeadUrl = async (
  bucket: string,
  objectKey: string,
  expiresSeconds = 300,
): Promise<PresignedUrlResult> => {
  const safeBucket = asString(bucket, 200);
  const safeObjectKey = asString(objectKey, 2000);
  if (!safeBucket || !safeObjectKey) throw new Error("Invalid R2 object target");
  return await presignRequest({
    method: "HEAD",
    bucket: safeBucket,
    objectKey: safeObjectKey,
    expiresSeconds,
  });
};

export const headObject = async (bucket: string, objectKey: string): Promise<HeadObjectResult | null> => {
  const signed = await createPresignedHeadUrl(bucket, objectKey, 300);
  const response = await fetch(signed.url, {
    method: "HEAD",
    cache: "no-store",
    redirect: "follow",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`R2_HEAD_FAILED_${response.status}`);
  }
  const rawSize = Number(response.headers.get("content-length") || "0");
  return {
    exists: true,
    sizeBytes: Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : 0,
    etag: sanitizeEtag(response.headers.get("etag")),
    lastModified: asString(response.headers.get("last-modified"), 120),
  };
};

export const deleteObject = async (
  bucket: string,
  objectKey: string,
  expiresSeconds = 300,
): Promise<{ deleted: boolean }> => {
  const signed = await presignRequest({
    method: "DELETE",
    bucket,
    objectKey,
    expiresSeconds,
  });
  const response = await fetch(signed.url, {
    method: "DELETE",
    cache: "no-store",
    redirect: "follow",
  });
  if (response.status === 404) return { deleted: false };
  if (!response.ok) {
    throw new Error(`R2_DELETE_FAILED_${response.status}`);
  }
  return { deleted: true };
};
