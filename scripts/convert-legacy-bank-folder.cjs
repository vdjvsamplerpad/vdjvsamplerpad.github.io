const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const LEGACY_SECRET_KEY = 'vdjv-sampler-secret-2024';
const LEGACY_SHARED_PASSWORD = 'vdjv-export-disabled-2024-secure';

const CURRENT_MAGIC = Buffer.from('VDJVENC2', 'utf8');
const CURRENT_VERSION = 1;
const CURRENT_SALT_BYTES = 16;
const CURRENT_IV_BYTES = 12;
const CURRENT_VERIFIER_BYTES = 16;
const CURRENT_PBKDF2_ITERATIONS = 120_000;

function parseEnvFile(filePath) {
  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2];
  }
  return env;
}

function hasZipMagic(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (
      (buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08)
    )
  );
}

function hasCurrentMagic(buffer) {
  return buffer.length >= CURRENT_MAGIC.length && buffer.subarray(0, CURRENT_MAGIC.length).equals(CURRENT_MAGIC);
}

function deriveLegacyPassword(bankId) {
  return crypto.createHash('sha256').update(bankId + LEGACY_SECRET_KEY).digest('hex');
}

function xorDecryptHeaderMatchesZip(buffer, password) {
  const passwordBytes = Buffer.from(password, 'utf8');
  if (passwordBytes.length === 0 || buffer.length < 4) return false;
  const probe = Buffer.from(buffer.subarray(0, 4));
  for (let i = 0; i < probe.length; i += 1) {
    probe[i] ^= passwordBytes[i % passwordBytes.length];
  }
  return hasZipMagic(probe);
}

function xorDecryptWholeBuffer(buffer, password) {
  const passwordBytes = Buffer.from(password, 'utf8');
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i += 1) {
    out[i] ^= passwordBytes[i % passwordBytes.length];
  }
  return out;
}

function normalizeTitle(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/OLD[.\s#_-]*/gi, ' ')
    .replace(/[_#.-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseBankIdFromFileName(fileName) {
  const match = String(fileName || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0].toLowerCase() : null;
}

async function fetchAllBanks(supabaseUrl, serviceRoleKey) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  const pageSize = 1000;
  let offset = 0;
  const rows = [];

  while (true) {
    const url = new URL('/rest/v1/banks', supabaseUrl);
    url.searchParams.set('select', 'id,title,deleted_at');
    url.searchParams.set('order', 'created_at.asc');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch banks: ${response.status} ${await response.text()}`);
    }
    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows
    .filter((row) => row && typeof row.id === 'string' && row.id.trim())
    .map((row) => ({
      id: row.id.trim().toLowerCase(),
      title: typeof row.title === 'string' ? row.title : '',
      normalizedTitle: normalizeTitle(row.title || ''),
    }));
}

function buildCandidateBankIds(fileName, banks) {
  const candidates = [];
  const seen = new Set();
  const add = (id) => {
    const normalized = String(id || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const hintedId = parseBankIdFromFileName(fileName);
  if (hintedId) add(hintedId);

  const normalizedFileTitle = normalizeTitle(path.basename(fileName, path.extname(fileName)));
  if (normalizedFileTitle) {
    for (const bank of banks) {
      if (!bank.normalizedTitle) continue;
      if (bank.normalizedTitle === normalizedFileTitle) add(bank.id);
    }
    for (const bank of banks) {
      if (!bank.normalizedTitle) continue;
      if (
        bank.normalizedTitle.includes(normalizedFileTitle) ||
        normalizedFileTitle.includes(bank.normalizedTitle)
      ) {
        add(bank.id);
      }
    }
  }

  for (const bank of banks) add(bank.id);
  return candidates;
}

async function validateZipBytes(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const bankJsonEntry = zip.file('bank.json');
  if (!bankJsonEntry) {
    throw new Error('bank.json missing after decrypt');
  }
  const bankJsonText = await bankJsonEntry.async('string');
  const bankData = JSON.parse(bankJsonText);
  if (!bankData || typeof bankData !== 'object' || !Array.isArray(bankData.pads)) {
    throw new Error('bank.json invalid after decrypt');
  }
  let metadata = null;
  const metadataEntry = zip.file('metadata.json');
  if (metadataEntry) {
    try {
      metadata = JSON.parse(await metadataEntry.async('string'));
    } catch {
      metadata = null;
    }
  }
  return { zip, bankData, metadata };
}

async function tryLegacyDecrypt(buffer, fileName, banks) {
  if (xorDecryptHeaderMatchesZip(buffer, LEGACY_SHARED_PASSWORD)) {
    const decrypted = xorDecryptWholeBuffer(buffer, LEGACY_SHARED_PASSWORD);
    const validated = await validateZipBytes(decrypted);
    return {
      decryptedBytes: decrypted,
      password: LEGACY_SHARED_PASSWORD,
      passwordSource: 'shared',
      matchedBankId: typeof validated.metadata?.bankId === 'string' ? validated.metadata.bankId : null,
      validated,
    };
  }

  const candidateBankIds = buildCandidateBankIds(fileName, banks);
  for (const bankId of candidateBankIds) {
    const password = deriveLegacyPassword(bankId);
    if (!xorDecryptHeaderMatchesZip(buffer, password)) continue;
    try {
      const decrypted = xorDecryptWholeBuffer(buffer, password);
      const validated = await validateZipBytes(decrypted);
      return {
        decryptedBytes: decrypted,
        password,
        passwordSource: 'derived',
        matchedBankId: bankId,
        validated,
      };
    } catch {
      continue;
    }
  }

  throw new Error('No matching legacy XOR key found');
}

function deriveCurrentEncryptionMaterial(password, salt) {
  const material = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, CURRENT_PBKDF2_ITERATIONS, 48, 'sha256');
  return {
    aesKey: material.subarray(0, 32),
    verifier: material.subarray(32, 48),
  };
}

function buildCurrentEnvelopeHeader(salt, iv, verifier) {
  const header = Buffer.alloc(CURRENT_MAGIC.length + 1 + 1 + 1 + 1 + 4);
  let offset = 0;
  CURRENT_MAGIC.copy(header, offset);
  offset += CURRENT_MAGIC.length;
  header[offset++] = CURRENT_VERSION;
  header[offset++] = salt.length;
  header[offset++] = iv.length;
  header[offset++] = verifier.length;
  header.writeUInt32BE(CURRENT_PBKDF2_ITERATIONS, offset);
  return Buffer.concat([header, salt, iv, verifier]);
}

function writeCurrentEncryptedEnvelope(zipBytes, outputPath, password) {
  const salt = crypto.randomBytes(CURRENT_SALT_BYTES);
  const iv = crypto.randomBytes(CURRENT_IV_BYTES);
  const { aesKey, verifier } = deriveCurrentEncryptionMaterial(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const header = buildCurrentEnvelopeHeader(salt, iv, verifier);

  const stream = fs.createWriteStream(outputPath);
  stream.write(header);
  stream.write(cipher.update(zipBytes));
  stream.write(cipher.final());
  stream.write(cipher.getAuthTag());
  stream.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function convertOneFile(filePath, outputPath, banks) {
  const buffer = fs.readFileSync(filePath);
  const baseName = path.basename(filePath);

  if (hasZipMagic(buffer)) {
    const validated = await validateZipBytes(buffer);
    fs.writeFileSync(outputPath, buffer);
    return {
      file: baseName,
      mode: 'plain-zip',
      output: outputPath,
      title: validated.metadata?.title || validated.bankData?.name || baseName,
      matchedBankId: validated.metadata?.bankId || null,
    };
  }

  if (hasCurrentMagic(buffer)) {
    fs.writeFileSync(outputPath, buffer);
    return {
      file: baseName,
      mode: 'current-vdjvenc2',
      output: outputPath,
      title: baseName,
      matchedBankId: null,
    };
  }

  const legacy = await tryLegacyDecrypt(buffer, baseName, banks);
  const metadata = legacy.validated.metadata || {};
  const shouldEncrypt = Boolean(metadata.password);

  if (shouldEncrypt) {
    await writeCurrentEncryptedEnvelope(legacy.decryptedBytes, outputPath, legacy.password);
  } else {
    fs.writeFileSync(outputPath, legacy.decryptedBytes);
  }

  return {
    file: baseName,
    mode: shouldEncrypt ? `legacy-xor->vdjvenc2(${legacy.passwordSource})` : 'legacy-xor->plain-zip',
    output: outputPath,
    title: metadata.title || legacy.validated.bankData?.name || baseName,
    matchedBankId: metadata.bankId || legacy.matchedBankId || null,
    exportable: typeof metadata.exportable === 'boolean' ? metadata.exportable : null,
    transferable: typeof metadata.transferable === 'boolean' ? metadata.transferable : null,
  };
}

async function main() {
  const sourceDir = process.argv[2] || 'D:\\EXTERNAL VDJV';
  const outputDir = process.argv[3] || path.join(sourceDir, 'converted-current-format');

  const env = parseEnvFile(path.resolve(__dirname, '..', '.env'));
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env');
  }

  const banks = await fetchAllBanks(supabaseUrl, serviceRoleKey);
  const files = fs.readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith('.bank'))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No .bank files found in ${sourceDir}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];

  for (const name of files) {
    const inputPath = path.join(sourceDir, name);
    const outputPath = path.join(outputDir, name);
    try {
      const result = await convertOneFile(inputPath, outputPath, banks);
      results.push({ ...result, status: 'ok' });
      console.log(`OK  ${name} -> ${result.mode}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ file: name, status: 'error', error: message });
      console.error(`ERR ${name} -> ${message}`);
    }
  }

  const reportPath = path.join(outputDir, 'conversion-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    sourceDir,
    outputDir,
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    convertedCount: results.filter((row) => row.status === 'ok').length,
    failedCount: results.filter((row) => row.status === 'error').length,
    results,
  }, null, 2));

  const failed = results.filter((row) => row.status === 'error');
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
