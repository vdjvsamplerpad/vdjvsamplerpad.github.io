const ENCRYPTION_MAGIC = new TextEncoder().encode('VDJVENC2');
const ENCRYPTION_VERSION = 1;
const ENCRYPTION_SALT_BYTES = 16;
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_VERIFIER_BYTES = 16;
const ENCRYPTION_PBKDF2_ITERATIONS = 120_000;
const ENCRYPTION_HEADER_BYTES = ENCRYPTION_MAGIC.length + 1 + 1 + 1 + 1 + 4;

export interface ParsedEncryptionEnvelope {
  salt: Uint8Array;
  iv: Uint8Array;
  verifier: Uint8Array;
  iterations: number;
  ciphertext: Uint8Array;
}

export const encryptionEnvelopeConstants = {
  magicBytes: ENCRYPTION_MAGIC,
  magicString: 'VDJVENC2',
  version: ENCRYPTION_VERSION,
  saltBytes: ENCRYPTION_SALT_BYTES,
  ivBytes: ENCRYPTION_IV_BYTES,
  verifierBytes: ENCRYPTION_VERIFIER_BYTES,
  iterations: ENCRYPTION_PBKDF2_ITERATIONS,
  headerBytes: ENCRYPTION_HEADER_BYTES,
};

export const startsWithBankEncryptionMagic = (value: Uint8Array): boolean => {
  if (value.length < ENCRYPTION_MAGIC.length) return false;
  for (let i = 0; i < ENCRYPTION_MAGIC.length; i += 1) {
    if (value[i] !== ENCRYPTION_MAGIC[i]) return false;
  }
  return true;
};

export const concatUint8Arrays = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const byteArraysEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left[i] ^ right[i];
  }
  return mismatch === 0;
};

export const parseEncryptionEnvelope = (
  source: Uint8Array,
  options?: { allowPartialCiphertext?: boolean }
): ParsedEncryptionEnvelope | null => {
  if (source.length < ENCRYPTION_HEADER_BYTES || !startsWithBankEncryptionMagic(source)) return null;
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

export const deriveEncryptionMaterial = async (
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<{ aesKey: CryptoKey; verifier: Uint8Array }> => {
  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    384
  );
  const material = new Uint8Array(bits);
  const aesRaw = material.slice(0, 32);
  const verifier = material.slice(32, 48);
  const aesKey = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { aesKey, verifier };
};

export const decryptEncryptedBankBlob = async (encryptedBlob: Blob, password: string): Promise<Blob> => {
  const probeBytes = new Uint8Array(
    await encryptedBlob
      .slice(0, ENCRYPTION_HEADER_BYTES + ENCRYPTION_SALT_BYTES + ENCRYPTION_IV_BYTES + ENCRYPTION_VERIFIER_BYTES)
      .arrayBuffer()
  );
  if (!startsWithBankEncryptionMagic(probeBytes)) {
    throw new Error('Unsupported legacy encrypted bank format.');
  }
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
};

export const doesEncryptedBankPasswordMatch = async (encryptedBlob: Blob, password: string): Promise<boolean> => {
  try {
    const probeBytes = new Uint8Array(
      await encryptedBlob
        .slice(0, ENCRYPTION_HEADER_BYTES + ENCRYPTION_SALT_BYTES + ENCRYPTION_IV_BYTES + ENCRYPTION_VERIFIER_BYTES)
        .arrayBuffer()
    );
    if (!startsWithBankEncryptionMagic(probeBytes)) {
      return false;
    }
    const envelope = parseEncryptionEnvelope(probeBytes, { allowPartialCiphertext: true });
    if (!envelope) return false;
    const { verifier } = await deriveEncryptionMaterial(password, envelope.salt, envelope.iterations);
    return byteArraysEqual(verifier, envelope.verifier);
  } catch {
    return false;
  }
};
