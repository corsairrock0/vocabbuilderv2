// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (memory-hard; OWASP-recommended parameters N=2^17, r=8, p=1).
 * Format: scrypt$N$r$p$saltBase64$hashBase64 — parameters are stored so they can be raised later.
 */
const DEFAULT_N = Number(process.env.VB_SCRYPT_N || 131072);
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string, N = DEFAULT_N): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * N * R + 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nS, rS, pS, saltB64, hashB64] = parts;
  const N = Number(nS);
  const r = Number(rS);
  const p = Number(pS);
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A dummy verification so failed logins for unknown usernames take the same time. */
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Use at least 12 characters.');
  if (password.length > 1024) problems.push('Use at most 1024 characters.');
  if (/^(.)\1+$/.test(password)) problems.push('Do not repeat a single character.');
  if (['password1234', '123456789012', 'qwertyuiopas'].includes(password.toLowerCase())) problems.push('This password is too common.');
  return problems;
}
