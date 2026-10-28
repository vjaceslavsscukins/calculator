// Пароли (scrypt с солью) и случайные токены. В базе токены лежат только хешем sha256.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer, opts = PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, KEYLEN, opts, (e, k) => (e ? reject(e) : resolve(k))));
}

/** Формат: scrypt$N$r$p$соль$хеш (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    // тратим то же время, чтобы по задержке нельзя было понять, есть ли такая почта
    await scryptAsync(password, randomBytes(16));
    return false;
  }
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), { N: +N, r: +r, p: +p, maxmem: PARAMS.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const newToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
