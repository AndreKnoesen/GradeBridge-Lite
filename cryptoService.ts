// =====================================================
// GradeBridge Encoding Service — Student Submission
// =====================================================
// AES-256-GCM symmetric encryption using the Web Crypto API.
//
// PURPOSE
//   • Decodes assignment_spec.json when the student uploads it
//     (encoded by Assignment Maker at export time).
//   • Encodes submission.json before the student downloads it for
//     Gradescope upload, so the file cannot be edited in a text editor
//     between download and submission.
//
// FORMAT
//   gb1:<base64( iv[12 bytes] | ciphertext | gcm-tag[16 bytes] )>
//
// KEY
//   Must match GradeBridge-Assignment-Maker/services/cryptoService.ts
//   and CCAssignmentMaker/crypto_utils.py exactly.
//   See those files for key rotation instructions.
// =====================================================

const KEY_HEX = '4a7f3c2e9b1d8f5a0e6c4b3d9f2a7e1b5d8c3f9a2e7b4d0c6f8a3e1b5d9c2f4e';
const ENCODING_PREFIX = 'gb1:';

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

const getCryptoKey = (): Promise<CryptoKey> => {
  const keyBytes = hexToBytes(KEY_HEX);
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

const uint8ToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToUint8 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export const isEncoded = (s: string): boolean =>
  s.trimStart().startsWith(ENCODING_PREFIX);

export const encryptJson = async (obj: unknown): Promise<string> => {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);

  return ENCODING_PREFIX + uint8ToBase64(combined);
};

export const decryptJson = async (encoded: string): Promise<unknown> => {
  const trimmed = encoded.trim();
  if (!trimmed.startsWith(ENCODING_PREFIX)) {
    throw new Error('Not a GradeBridge encoded file (missing gb1: prefix)');
  }

  const key = await getCryptoKey();
  const combined = base64ToUint8(trimmed.slice(ENCODING_PREFIX.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('Decryption failed — file may be corrupted or tampered with');
  }

  return JSON.parse(new TextDecoder().decode(decrypted));
};
