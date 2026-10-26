import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function validPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) throw Object.assign(new Error('Password must contain 12–256 bytes.'), { status: 400 });
}
export async function hashPassword(password) {
  validPassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const [, salt, expected] = encoded.split('$');
  const actual = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function readSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('vs_session='));
  const value = cookie?.slice(11);
  return value && /^[a-f0-9]{64}$/.test(value) ? digest(value) : '';
}
export function sessionCookie(value, secure, expire = false) {
  return `vs_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expire ? 0 : 28800}${secure ? '; Secure' : ''}`;
}
