import JSZip from 'jszip';
import { supabase } from './supabase';
import { BankMetadata } from '@/components/sampler/types/sampler';
import type { SamplerBank } from '@/components/sampler/types/sampler';

// Secret key for deriving passwords (in production, this should be in environment variables)
const SECRET_KEY = 'vdjv-sampler-secret-2024';
const ENCRYPTION_MAGIC = new TextEncoder().encode('VDJVENC2');
const ENCRYPTION_VERSION = 1;
const ENCRYPTION_SALT_BYTES = 16;
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_VERIFIER_BYTES = 16;
const ENCRYPTION_PBKDF2_ITERATIONS = 120_000;
const ENCRYPTION_HEADER_BYTES = ENCRYPTION_MAGIC.length + 1 + 1 + 1 + 1 + 4;

interface ParsedEncryptionEnvelope {
  salt: Uint8Array;
  iv: Uint8Array;
  verifier: Uint8Array;
  iterations: number;
  ciphertext: Uint8Array;
}

// Cache for derived keys to avoid repeated database calls
const keyCache = new Map<string, string>();

// Export keyCache for use in other modules
export { keyCache };

// LocalStorage keys for offline caching
const ACCESSIBLE_BANKS_CACHE_KEY = 'vdjv-accessible-banks';
const BANK_KEYS_CACHE_KEY = 'vdjv-bank-derived-keys';
const BANK_ACCESS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedAccessibleBanks {
  userId: string;
  bankIds: string[];
  timestamp: number;
}

interface CachedBankKeys {
  userId: string;
  keys: Record<string, string>; // bankId -> derivedKey
  timestamp: number;
}

export interface ResolvedBankMetadata {
  title: string;
  description: string;
  color?: string;
}

const metadataCache = new Map<string, ResolvedBankMetadata>();

// Helper to get cached accessible banks
function getCachedAccessibleBanks(userId: string, options?: { allowStale?: boolean }): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(ACCESSIBLE_BANKS_CACHE_KEY);
    if (!cached) return null;
    const data: CachedAccessibleBanks = JSON.parse(cached);
    // Check if cache is for the same user
    if (data.userId !== userId) return null;
    // Fresh cache is valid for 24 hours. Stale cache is allowed for offline fallback.
    if (!options?.allowStale && Date.now() - data.timestamp > BANK_ACCESS_CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(data.bankIds)) return null;
    return data.bankIds;
  } catch {
    return null;
  }
}

// Helper to cache accessible banks
function setCachedAccessibleBanks(userId: string, bankIds: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const data: CachedAccessibleBanks = { userId, bankIds, timestamp: Date.now() };
    localStorage.setItem(ACCESSIBLE_BANKS_CACHE_KEY, JSON.stringify(data));
  } catch {
  }
}

// Helper to get cached bank derived keys
function getCachedBankKeys(userId: string, options?: { allowStale?: boolean }): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(BANK_KEYS_CACHE_KEY);
    if (!cached) return null;
    const data: CachedBankKeys = JSON.parse(cached);
    if (data.userId !== userId) return null;
    // Fresh cache is valid for 24 hours. Stale cache is allowed for offline fallback.
    if (!options?.allowStale && Date.now() - data.timestamp > BANK_ACCESS_CACHE_MAX_AGE_MS) return null;
    if (!data.keys || typeof data.keys !== 'object') return null;
    return data.keys;
  } catch {
    return null;
  }
}

// Helper to cache bank derived keys
function setCachedBankKeys(userId: string, keys: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    const data: CachedBankKeys = { userId, keys, timestamp: Date.now() };
    localStorage.setItem(BANK_KEYS_CACHE_KEY, JSON.stringify(data));

  } catch {
  }
}

// Helper to update cached bank keys with a new key
function addToCachedBankKeys(userId: string, bankId: string, derivedKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    let data: CachedBankKeys;
    const cached = localStorage.getItem(BANK_KEYS_CACHE_KEY);
    if (cached) {
      data = JSON.parse(cached);
      if (data.userId === userId) {
        data.keys[bankId] = derivedKey;
        data.timestamp = Date.now();
      } else {
        data = { userId, keys: { [bankId]: derivedKey }, timestamp: Date.now() };
      }
    } else {
      data = { userId, keys: { [bankId]: derivedKey }, timestamp: Date.now() };
    }
    localStorage.setItem(BANK_KEYS_CACHE_KEY, JSON.stringify(data));
  } catch {
  }
}

function removeFromCachedBankKeys(userId: string, bankId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const cached = localStorage.getItem(BANK_KEYS_CACHE_KEY);
    if (!cached) return;
    const data: CachedBankKeys = JSON.parse(cached);
    if (data.userId !== userId) return;
    if (!data.keys[bankId]) return;
    delete data.keys[bankId];
    data.timestamp = Date.now();
    localStorage.setItem(BANK_KEYS_CACHE_KEY, JSON.stringify(data));
  } catch {
  }
}

export function getCachedBankKeysForUser(userId: string): Record<string, string> {
  return getCachedBankKeys(userId, { allowStale: true }) || {};
}

/**
 * Derive password from bank ID using SHA-256
 */
export async function derivePassword(bankId: string): Promise<string> {
  const message = bankId + SECRET_KEY;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const startsWithMagic = (value: Uint8Array): boolean => {
  if (value.length < ENCRYPTION_MAGIC.length) return false;
  for (let i = 0; i < ENCRYPTION_MAGIC.length; i += 1) {
    if (value[i] !== ENCRYPTION_MAGIC[i]) return false;
  }
  return true;
};

const concatUint8Arrays = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const byteArraysEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left[i] ^ right[i];
  }
  return mismatch === 0;
};

const parseEncryptionEnvelope = (
  source: Uint8Array,
  options?: { allowPartialCiphertext?: boolean }
): ParsedEncryptionEnvelope | null => {
  if (source.length < ENCRYPTION_HEADER_BYTES || !startsWithMagic(source)) return null;
  let offset = ENCRYPTION_MAGIC.length;
  const version = source[offset++];
  if (version !== ENCRYPTION_VERSION) return null;
  const saltLen = source[offset++];
  const ivLen = source[offset++];
  const verifierLen = source[offset++];
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const iterations = view.getUint32(offset, false);
  offset += 4;
  if (saltLen <= 0 || ivLen <= 0 || verifierLen <= 0 || iterations <= 0) return null;
  const verifierOffset = offset + saltLen + ivLen;
  const ciphertextOffset = verifierOffset + verifierLen;
  if (source.length < verifierOffset + verifierLen) return null;
  if (!options?.allowPartialCiphertext && source.length <= ciphertextOffset) return null;
  return {
    salt: source.slice(offset, offset + saltLen),
    iv: source.slice(offset + saltLen, offset + saltLen + ivLen),
    verifier: source.slice(verifierOffset, verifierOffset + verifierLen),
    iterations,
    ciphertext: source.slice(ciphertextOffset),
  };
};

const deriveEncryptionMaterial = async (
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<{ aesKey: CryptoKey; verifier: Uint8Array }> => {
  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    384 // 32 bytes AES key + 16 bytes verifier
  );
  const material = new Uint8Array(bits);
  const aesRaw = material.slice(0, 32);
  const verifier = material.slice(32, 48);
  const aesKey = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { aesKey, verifier };
};

/**
 * Encrypt a zip file with a password
 */
export async function encryptZip(zip: JSZip, password: string): Promise<Blob> {
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const salt = crypto.getRandomValues(new Uint8Array(ENCRYPTION_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
  const { aesKey, verifier } = await deriveEncryptionMaterial(password, salt, ENCRYPTION_PBKDF2_ITERATIONS);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, zipBytes);
  const ciphertext = new Uint8Array(cipherBuffer);

  const header = new Uint8Array(ENCRYPTION_HEADER_BYTES);
  let offset = 0;
  header.set(ENCRYPTION_MAGIC, offset);
  offset += ENCRYPTION_MAGIC.length;
  header[offset++] = ENCRYPTION_VERSION;
  header[offset++] = salt.length;
  header[offset++] = iv.length;
  header[offset++] = verifier.length;
  new DataView(header.buffer).setUint32(offset, ENCRYPTION_PBKDF2_ITERATIONS, false);

  const envelope = concatUint8Arrays([header, salt, iv, verifier, ciphertext]);
  return new Blob([envelope], { type: 'application/octet-stream' });
}

/**
 * Decrypt a zip file with a password
 */
export async function decryptZip(encryptedBlob: Blob, password: string): Promise<Blob> {
  const probeBytes = new Uint8Array(
    await encryptedBlob
      .slice(0, ENCRYPTION_HEADER_BYTES + ENCRYPTION_SALT_BYTES + ENCRYPTION_IV_BYTES + ENCRYPTION_VERIFIER_BYTES)
      .arrayBuffer()
  );
  if (startsWithMagic(probeBytes)) {
    const source = new Uint8Array(await encryptedBlob.arrayBuffer());
    const envelope = parseEncryptionEnvelope(source);
    if (!envelope) throw new Error('Invalid encrypted payload');
    const { aesKey, verifier } = await deriveEncryptionMaterial(password, envelope.salt, envelope.iterations);
    if (!byteArraysEqual(verifier, envelope.verifier)) {
      throw new Error('Invalid password');
    }
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv },
      aesKey,
      envelope.ciphertext
    );
    return new Blob([new Uint8Array(plainBuffer)], { type: 'application/zip' });
  }
  throw new Error('Unsupported legacy encrypted bank format.');
}

/**
 * Validate a password by decrypting only the ZIP header (avoids full-file decrypt)
 */
export async function isZipPasswordMatch(encryptedBlob: Blob, password: string): Promise<boolean> {
  try {
    const probeBytes = new Uint8Array(
      await encryptedBlob
        .slice(0, ENCRYPTION_HEADER_BYTES + ENCRYPTION_SALT_BYTES + ENCRYPTION_IV_BYTES + ENCRYPTION_VERIFIER_BYTES)
        .arrayBuffer()
    );
    if (startsWithMagic(probeBytes)) {
      const envelope = parseEncryptionEnvelope(probeBytes, { allowPartialCiphertext: true });
      if (!envelope) return false;
      const { verifier } = await deriveEncryptionMaterial(password, envelope.salt, envelope.iterations);
      return byteArraysEqual(verifier, envelope.verifier);
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Get derived key for a bank from cache or database
 * Falls back to localStorage cache when offline
 */
export async function getDerivedKey(bankId: string, userId: string): Promise<string | null> {
  const cacheKey = `${userId}-${bankId}`;
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  let allowStaleFallback = !isOnline;

  try {
    if (isOnline) {
      const { data: access, error } = await supabase
        .from('user_bank_access')
        .select('id')
        .eq('user_id', userId)
        .eq('bank_id', bankId)
        .maybeSingle();

      if (error) {
        allowStaleFallback = true;
      } else if (!access) {
        keyCache.delete(cacheKey);
        removeFromCachedBankKeys(userId, bankId);
        return null;
      }

      const { data: bank, error: bankError } = await supabase
        .from('banks')
        .select('derived_key')
        .eq('id', bankId)
        .maybeSingle();

      if (bankError) {
        allowStaleFallback = true;
      } else if (!bank?.derived_key) {
        keyCache.delete(cacheKey);
        removeFromCachedBankKeys(userId, bankId);
        return null;
      }

      if (bank?.derived_key) {
        keyCache.set(cacheKey, bank.derived_key);
        addToCachedBankKeys(userId, bankId, bank.derived_key);
        return bank.derived_key;
      }
    }
  } catch (error) {
    allowStaleFallback = true;
  }

  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey)!;
  }
  const cachedKeys = getCachedBankKeys(userId, { allowStale: allowStaleFallback });
  if (cachedKeys && cachedKeys[bankId]) {
    const derivedKey = cachedKeys[bankId];
    keyCache.set(cacheKey, derivedKey);
    return derivedKey;
  }

  return null;
}

/**
 * Grant user access to a bank
 */
export async function grantBankAccess(userId: string, bankId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_bank_access')
      .insert({
        user_id: userId,
        bank_id: bankId
      });

    if (error) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Extract metadata from bank file
 */
export async function extractBankMetadata(zip: JSZip): Promise<BankMetadata | null> {
  try {
    const metadataFile = zip.file('metadata.json');
    if (!metadataFile) {
      return null;
    }

    const metadataText = await metadataFile.async('string');
    const parsed = JSON.parse(metadataText);
    return parsed;
  } catch (error) {
    return null;
  }
}

/**
 * Add metadata to bank file
 */
export function addBankMetadata(zip: JSZip, metadata: BankMetadata): void {
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
}

/**
 * Clear key cache (useful for logout)
 */
export function clearKeyCache(): void {
  keyCache.clear();
  metadataCache.clear();
}

// Helpers
export function parseBankIdFromFileName(fileName: string): string | null {
  // find UUID in the filename
  const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/;
  const match = fileName.match(uuidRegex);
  return match ? match[0] : null;
}

/**
 * Refresh the user's accessible banks cache
 * Call this when user logs in or when app starts
 */
export async function refreshAccessibleBanksCache(userId: string): Promise<void> {
  try {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!isOnline) return;

    // Fetch all accessible banks
    const { data: accessData, error: accessError } = await supabase
      .from('user_bank_access')
      .select('bank_id')
      .eq('user_id', userId);
    
    if (accessError || !accessData) {
      return;
    }
    
    const bankIds = Array.from(
      new Set(
        accessData
          .map((row: any) => (typeof row?.bank_id === 'string' ? row.bank_id : ''))
          .filter((bankId): bankId is string => bankId.length > 0)
      )
    );
    setCachedAccessibleBanks(userId, bankIds);
    pruneCachedBankAccess(userId, bankIds);

    if (bankIds.length === 0) {
      setCachedBankKeys(userId, {});
      return;
    }

    const { data: bankRows, error: bankError } = await supabase
      .from('banks')
      .select('id, derived_key')
      .in('id', bankIds);

    const keysToCache: Record<string, string> = {};
    if (!bankError && Array.isArray(bankRows)) {
      bankRows.forEach((row: any) => {
        const bankId = typeof row?.id === 'string' ? row.id : '';
        const derivedKey = typeof row?.derived_key === 'string' ? row.derived_key : '';
        if (!bankId || !derivedKey) return;
        keysToCache[bankId] = derivedKey;
        keyCache.set(`${userId}-${bankId}`, derivedKey);
      });
    }

    if (Object.keys(keysToCache).length > 0) {
      setCachedBankKeys(userId, keysToCache);
    } else {
      setCachedBankKeys(userId, {});
    }
  } catch {
  }
}

export function pruneCachedBankAccess(userId: string, allowedBankIds: string[]): void {
  if (typeof window === 'undefined') return;
  const allowed = new Set(allowedBankIds);
  const staleKeys: string[] = [];

  for (const cacheKey of keyCache.keys()) {
    if (!cacheKey.startsWith(`${userId}-`)) continue;
    const bankId = cacheKey.slice(userId.length + 1);
    if (!allowed.has(bankId)) staleKeys.push(cacheKey);
  }
  staleKeys.forEach((key) => keyCache.delete(key));

  const cachedKeys = getCachedBankKeys(userId) || {};
  const nextKeys: Record<string, string> = {};
  Object.entries(cachedKeys).forEach(([bankId, value]) => {
    if (allowed.has(bankId)) nextKeys[bankId] = value;
  });
  setCachedBankKeys(userId, nextKeys);
  setCachedAccessibleBanks(userId, allowedBankIds);
}

export function clearUserBankCache(userId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!userId) {
      localStorage.removeItem(ACCESSIBLE_BANKS_CACHE_KEY);
      localStorage.removeItem(BANK_KEYS_CACHE_KEY);
      keyCache.clear();
      return;
    }

    const currentAccessible = getCachedAccessibleBanks(userId);
    if (currentAccessible) localStorage.removeItem(ACCESSIBLE_BANKS_CACHE_KEY);

    const currentKeys = getCachedBankKeys(userId);
    if (currentKeys) localStorage.removeItem(BANK_KEYS_CACHE_KEY);

    for (const cacheKey of keyCache.keys()) {
      if (cacheKey.startsWith(`${userId}-`)) {
        keyCache.delete(cacheKey);
      }
    }
  } catch {
  }
}

export function clearUserScopedAccessCaches(userId?: string): void {
  clearUserBankCache(userId);
}

export function isProtectedImportedBank(bank: Pick<SamplerBank, 'isAdminBank' | 'sourceBankId' | 'bankMetadata'>): boolean {
  const metadataBankId = bank.bankMetadata?.bankId;
  return Boolean(bank.isAdminBank || metadataBankId || bank.sourceBankId);
}

export function pruneProtectedBanksFromCache(banks: SamplerBank[]): SamplerBank[] {
  const pruned = banks.filter((bank) => !isProtectedImportedBank(bank));
  return pruned;
}

export async function resolveAdminBankMetadata(bankId: string): Promise<ResolvedBankMetadata | null> {
  if (!bankId) return null;
  if (metadataCache.has(bankId)) return metadataCache.get(bankId)!;

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }
    const { data, error } = await supabase
      .from('banks')
      .select('title, description, color')
      .eq('id', bankId)
      .maybeSingle();

    if (error || !data?.title) return null;
    const resolved: ResolvedBankMetadata = {
      title: String(data.title),
      description: String(data.description || ''),
      color: typeof data.color === 'string' ? data.color : undefined,
    };
    metadataCache.set(bankId, resolved);
    return resolved;
  } catch (error) {
    return null;
  }
}

