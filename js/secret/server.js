// Serverul LSO de statistici și coduri (Cloudflare Worker propriu, contract identic cu Notis).
// Partea publică: contor anonim de instalări (o dată pe zi) și răscumpărarea „Ai un cod?”.
import { APP_VERSION } from '../core/store.js';

export const W = 'https://lso-stats.cluj1313.workers.dev';
export const ls = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch (_) {}
  return null;
};
export function post(p, b, tok) {
  const c = window.AbortController ? new AbortController() : null;
  const t = setTimeout(() => { c && c.abort(); }, 9000);
  const h = { 'content-type': 'application/json' };
  if (tok) h.authorization = 'Bearer ' + tok;
  return fetch(W + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}), signal: c && c.signal, cache: 'no-store' })
    .then(r => { clearTimeout(t); return r.json(); });
}
export function get(p, tok) {
  return fetch(W + p, { headers: tok ? { authorization: 'Bearer ' + tok } : {}, cache: 'no-store' }).then(r => r.json());
}
const isNative = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (_) { return false; } };
const today = () => new Date().toISOString().slice(0, 10);
const ver = () => APP_VERSION;
const src = () => 'apk'; // APK direct de pe GitHub (nu Play)

export function iid() {
  let i = ls('lso_iid');
  if (!i || !/^[A-Za-z0-9_-]{16,64}$/.test(i)) {
    const b = crypto.getRandomValues(new Uint8Array(18));
    i = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    ls('lso_iid', i);
  }
  return i;
}
export const statOn = () => ls('lso_stat_off') !== '1';
export function setStat(on) { ls('lso_stat_off', on ? null : '1'); if (on) ping(); }
export function ping() {
  if (!statOn() || ls('lso_ping_day') === today() || navigator.onLine === false || /nt_test=1/.test(location.search)) return;
  try { post('/ping', { id: iid(), v: ver(), src: src() }).then(r => { if (r && r.ok) ls('lso_ping_day', today()); }).catch(() => {}); } catch (_) {}
}

// Super Class (coduri)
export function sup() {
  try { const s = JSON.parse(ls('lso_super') || 'null'); return s && (!s.exp || s.exp > Date.now()) ? s : null; } catch (_) { return null; }
}
const dmy = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
export function supTxt() {
  const s = sup(); if (!s) return '';
  return s.exp ? 'Super Class activ până la ' + dmy(new Date(s.exp)) : 'Super Class activ pe viață';
}
// → { ok:true, msg } sau { ok:false, msg }
export async function redeem(raw) {
  const code = String(raw || '').toUpperCase().replace(/\s/g, '');
  if (code.length < 6) return { ok: false, msg: 'Cod invalid' };
  let r;
  try { r = await post('/redeem', { code, id: iid() }); } catch (_) { return { ok: false, msg: 'Fără conexiune la internet' }; }
  if (r && r.ok) {
    ls('lso_super', JSON.stringify({ exp: r.exp || 0, code }));
    window.LSO_SUPER = true;
    return { ok: true, msg: 'Cod activat: Super Class' };
  }
  const e = r && r.e;
  return { ok: false, msg: e === 'used' ? 'Codul a fost deja folosit' : e === 'expired' ? 'Codul a expirat' : 'Cod invalid' };
}
window.LSO_SUPER = !!sup();

export function startPing() {
  setTimeout(ping, 5000);
  window.addEventListener('online', () => setTimeout(ping, 3000));
}
export { isNative };
