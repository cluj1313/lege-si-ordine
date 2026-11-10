// Criptare reală: PBKDF2 (SHA-256) derivă cheia din PIN, AES-GCM criptează conținutul.
import { bytesToB64, b64ToBytes } from './util.js';
const ITER = 150000;
const enc = new TextEncoder(), dec = new TextDecoder();
const CHECK = 'LSO-PIN-OK';

export const hasCrypto = () => !!(window.crypto && crypto.subtle);

export async function deriveKey(pin, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: bytesToB64(iv), ct };
}
export async function decBytes(key, ivB64, ct) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, ct);
}
export async function encJSON(key, obj) {
  const r = await encBytes(key, enc.encode(JSON.stringify(obj)));
  return { iv: r.iv, ct: bytesToB64(r.ct) };
}
export async function decJSON(key, sec) {
  const buf = await decBytes(key, sec.iv, b64ToBytes(sec.ct));
  return JSON.parse(dec.decode(buf));
}
// Creează descriptorul de lacăt (sare + verificare criptată) și cheia.
export async function newLock(pin) {
  const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(pin, salt);
  const check = await encJSON(key, CHECK);
  return { lock: { salt, check }, key };
}
// Verifică PIN-ul; întoarce cheia sau null.
export async function verifyPin(lock, pin) {
  try {
    const key = await deriveKey(pin, lock.salt);
    const v = await decJSON(key, lock.check);
    return v === CHECK ? key : null;
  } catch { return null; }
}
