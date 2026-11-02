import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacHex = (key: string, value: string): string => createHmac('sha256', key).update(value).digest('hex');

/** Constant-time comparison of two hex digests. */
export const safeEqualHex = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** AES-256-GCM with a random 96-bit IV per value. Output: base64url(iv | tag | ciphertext). */
export const encrypt = (plain: string, keyHex: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
};

export const decrypt = (sealed: string, keyHex: string): string => {
  const buf = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
};
