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
// FORMATS
//   gb1:<base64( iv[12 bytes] | ciphertext | gcm-tag[16 bytes] )>
//     Shared-key AES-256-GCM. Used for assignment specs (both directions)
//     and for submissions when the spec carries no course public key.
//
//   gb2:<base64( wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag )>
//     Hardened public-key envelope. A random AES-256-GCM content key is
//     wrapped with the course RSA public key (RSA-OAEP, SHA-256, MGF1-SHA256,
//     empty label). Used for submissions when the spec carries
//     `coursePublicKey`. Encode-only here — this app never holds a private
//     key and never decrypts gb2.
//
//     The envelope is defined over BYTES (`encryptBytesGb2`) and the JSON form
//     is that function plus `JSON.stringify` plus base64 plus the tag. The
//     images in a submission use the byte form directly and are written into
//     the ZIP raw: base64 would add a third to a ~9 MB archive for nothing.
//     **One implementation of the envelope, not two that must agree.**
//
// KEY
//   The gb1 key must match GradeBridge-Assignment-Maker/services/cryptoService.ts
//   and CCAssignmentMaker/crypto_utils.py exactly.
//   See those files for key rotation instructions.
//   gb2 uses no shared secret: the SPKI PEM public key travels in the spec.
// =====================================================

const KEY_HEX = '4a7f3c2e9b1d8f5a0e6c4b3d9f2a7e1b5d8c3f9a2e7b4d0c6f8a3e1b5d9c2f4e';
const ENCODING_PREFIX = 'gb1:';
const GB2_PREFIX = 'gb2:';

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

// -----------------------------------------------------
// gb2 — public-key envelope (encode only)
// -----------------------------------------------------

const pemToDer = (pem: string): ArrayBuffer => {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  if (!body) {
    throw new Error('Course public key is empty');
  }
  const bytes = base64ToUint8(body);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * Raised when the spec's course public key cannot be used. Carries a message
 * that is safe to show the student verbatim; the technical detail goes to the
 * console. Named so callers can present it without the generic
 * "refresh and try again" advice, which would not help here.
 */
export const GB2_KEY_ERROR = 'Gb2KeyError';

const gb2KeyError = (what: string, err: unknown): Error => {
  console.error(`gb2: ${what}`, err);
  const e = new Error(
    `The course encryption key in this assignment file could not be ${what}. ` +
    `Your submission was NOT created — no file was downloaded.\n\n` +
    `Please contact your instructor for a corrected assignment file.`
  );
  e.name = GB2_KEY_ERROR;
  return e;
};

/**
 * Identity fields that must never appear in a gb2 payload. Identity is taken
 * from Gradescope's authenticated submitter metadata instead.
 */
export const GB2_PII_FIELDS = ['student_name', 'email', 'sid', 'student_id'] as const;

/** Strip the gb2 PII fields from a submission payload. Does not mutate the input. */
export const deidentifyForGb2 = (payload: object): Record<string, unknown> => {
  const out = { ...payload } as Record<string, unknown>;
  for (const field of GB2_PII_FIELDS) {
    delete out[field];
  }
  return out;
};

/**
 * The gb2 envelope, over raw bytes.
 *
 *   wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag
 *
 * **This is the whole format.** `encryptJsonGb2` is this function with
 * `JSON.stringify`, base64 and the `gb2:` tag around it, and an image entry in
 * a submission ZIP is these bytes with nothing around them at all. There is one
 * implementation because two would have to be kept in agreement by whoever
 * remembered, and the consumer that opens both is the same consumer.
 *
 * **A fresh content key and a fresh IV every call.** The alternative — one
 * content key for the whole submission, one RSA operation instead of seventeen
 * — was specified and then withdrawn: it is a format the autograder does not
 * implement, and it trades a few milliseconds of RSA for an interop contract
 * that has to be written, agreed and tested. Seventeen RSA-2048 unwraps is a
 * few milliseconds.
 *
 * @param plaintext           The bytes to seal. Not copied, not inspected.
 * @param coursePublicKeyPem  RSA public key in SPKI PEM form, from the spec.
 */
export const encryptBytesGb2 = async (
  plaintext: Uint8Array, coursePublicKeyPem: string,
): Promise<Uint8Array> => {
  // 1. Import the course public key (RSA-OAEP; WebCrypto ties MGF1 to the OAEP hash).
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'spki',
      pemToDer(coursePublicKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  } catch (err) {
    throw gb2KeyError('read', err);
  }

  // 2. Random AES-256-GCM content key, exported raw for wrapping.
  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawContentKey = await crypto.subtle.exportKey('raw', contentKey);

  // 3-4. AES-256-GCM encrypt (12-byte IV, 128-bit tag appended, no AAD).
  //
  // The IV is generated HERE and cannot be passed in. Reusing a GCM IV under
  // one key is catastrophic rather than merely weak — it leaks the XOR of the
  // two plaintexts and, with it, the authentication subkey — so there is no
  // parameter for a caller to get wrong.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextPlusTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, plaintext as BufferSource)
  );

  // 5. RSA-OAEP wrap the raw 32 content-key bytes.
  let wrappedKey: Uint8Array;
  try {
    wrappedKey = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawContentKey)
    );
  } catch (err) {
    throw gb2KeyError('used', err);
  }

  // 6. wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag
  const envelope = new Uint8Array(2 + wrappedKey.length + iv.length + ciphertextPlusTag.length);
  envelope[0] = (wrappedKey.length >> 8) & 0xff;
  envelope[1] = wrappedKey.length & 0xff;
  envelope.set(wrappedKey, 2);
  envelope.set(iv, 2 + wrappedKey.length);
  envelope.set(ciphertextPlusTag, 2 + wrappedKey.length + iv.length);
  return envelope;
};

/**
 * Encode an object as a gb2: public-key envelope — `encryptBytesGb2` over the
 * serialised object, base64'd and tagged.
 *
 * @param obj                 Plain JSON payload (must already be de-identified).
 * @param coursePublicKeyPem  RSA public key in SPKI PEM form, from the spec.
 */
export const encryptJsonGb2 = async (obj: unknown, coursePublicKeyPem: string): Promise<string> => {
  const envelope = await encryptBytesGb2(
    new TextEncoder().encode(JSON.stringify(obj)), coursePublicKeyPem);
  // 7. Standard padded base64, gb2: prefix.
  return GB2_PREFIX + uint8ToBase64(envelope);
};

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
