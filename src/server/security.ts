import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// ----------------------------------------------------------------- passwords
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;

/** scrypt hash in the form scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return ['scrypt', N, R, P, salt.toString('base64url'), h.toString('base64url')].join('$');
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the work, so timing does not reveal whether the account exists.
  const parts = (stored ?? DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const h = await scryptAsync(pw.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return stored !== null && timingSafeEqual(h, expected);
}
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`;

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(pw: unknown, email?: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (email && pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) return 'Do not use your email address in your password.';
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|wachtwoord)/i.test(pw)) return 'This password is too easy to guess.';
  return null;
}

// -------------------------------------------------------------------- tokens
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// --------------------------------------------------- secrets at rest (AES-GCM)
export function encrypt(plain: string, secret: string): string {
  const key = createHash('sha256').update('opencookie:enc:' + secret).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function decrypt(data: string, secret: string): string {
  const key = createHash('sha256').update('opencookie:enc:' + secret).digest();
  const b = Buffer.from(data, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- TOTP (RFC 6238)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (t = Date.now()) => Math.floor(t / 1000 / 30);

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Checks a 6-digit code against the current step ±1 (clock drift).
 * Returns the matched step, or null. Steps at or before `lastStep` are rejected so a code cannot be reused.
 */
export function verifyTotp(secretB32: string, code: string, lastStep = 0, now = Date.now()): number | null {
  const c = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const step = totpStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue;
    const expected = hotp(key, s);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
  }
  return null;
}

export function totpUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ----------------------------------------------------------- recovery codes
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normaliseRecoveryCode = (c: string) => String(c).toLowerCase().replace(/[^a-z2-7]/g, '');

// ---------------------------------------------------------------- rate limit
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  /** Counts a hit; returns false when the key is over the limit. */
  hit(key: string): boolean {
    const t = Date.now();
    const r = this.hits.get(key);
    if (!r || r.reset < t) {
      this.hits.set(key, { n: 1, reset: t + this.windowMs });
      if (this.hits.size > 100_000) this.hits.clear();
      return true;
    }
    return ++r.n <= this.max;
  }
  blocked(key: string): boolean {
    const r = this.hits.get(key);
    return !!r && r.reset >= Date.now() && r.n >= this.max;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
