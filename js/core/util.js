// Utilitare comune: DOM, date DD/MM/YYYY, normalizare diacritice, id-uri, protecție la dublu-tap.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const uid = (p = 'i') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Normalizare pentru căutare: fără diacritice (inclusiv ş/ţ cu sedilă), litere mici.
export function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[şș]/g, 's').replace(/[ţț]/g, 't')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---- Date: intern ISO YYYY-MM-DD, afișat mereu DD/MM/YYYY ----
const pad = n => String(n).padStart(2, '0');
export function isoToday() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function isoFromDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
export function parseDMY(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
export function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }
export function fmtTs(ts) { if (!ts) return ''; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fmtTsDate(ts) { if (!ts) return ''; const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
export function toTs(iso, time) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const [hh, mm] = validTime(time) ? time.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh, mm).getTime();
}
export function fmtDur(sec) { sec = Math.round(sec || 0); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; }

// Execută o comandă o singură dată: butonul arată imediat că lucrează și nu poate fi apăsat dublu.
export async function act(btn, fn) {
  if (btn && btn.dataset.busy === '1') return;
  if (btn) { btn.dataset.busy = '1'; btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  finally { if (btn) { delete btn.dataset.busy; btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); } }
}

// Apăsare lungă (pointer events), cu anulare la mișcare.
export function onLongPress(el, fn, ms = 550) {
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', e => {
    fired = false; sx = e.clientX; sy = e.clientY; clearTimeout(t);
    t = setTimeout(() => { fired = true; fn(e); }, ms);
  });
  const cancel = () => clearTimeout(t);
  el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', e => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
}

export function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
}
export function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
export function bytesToB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

export function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
