import { db, S } from '../core/db.js';

const KEY = 'lso_temp_notes';
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
let temps = [];
let hideTimer = null;

export function startTemporary() {
  try {
    const raw = localStorage.getItem(KEY);
    temps = raw ? JSON.parse(raw) : [];
  } catch { temps = []; }
  // Dacă localStorage e gol, încearcă din IndexedDB
  if (!temps.length) {
    db.kvGet('temp_notes', []).then(fromDb => {
      if (Array.isArray(fromDb) && fromDb.length) {
        temps = fromDb;
        persist();
        if (typeof window !== 'undefined' && window.LSO && window.LSO.render) window.LSO.render();
      }
    }).catch(() => {});
  }
  pruneExpired();
}

function persist() {
  persist();
  db.kvSet('temp_notes', temps).catch(() => {});
}

function pruneExpired() {
  const now = Date.now();
  const before = temps.length;
  temps = temps.filter(t => !t.expires || t.expires > now);
  if (temps.length !== before) {
    persist();
  }
}

export function listTemporary() {
  pruneExpired();
  return temps.slice();
}

export function createTemporary(text, tabId, modes) {
  const now = Date.now();
  const rec = {
    id: 'temp_' + now + '_' + Math.random().toString(36).slice(2, 7),
    text: String(text || '').trim(),
    tab: tabId || null,
    modes: modes || ['read'],
    created: now,
    expires: now + DAYS_30
  };
  // allow empty for quick dict/rec start
  temps.unshift(rec);
  persist();
  return rec;
}

export function deleteTemporary(id) {
  temps = temps.filter(t => t.id !== id);
  persist();
}

export function updateTemporary(id, patch) {
  const t = temps.find(x => x.id === id);
  if (t) {
    Object.assign(t, patch);
    // dacă se schimbă textul, nu resetăm expirarea
    persist();
  }
}

export function scheduleHide(callback, ms = 2500) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(callback, ms);
}

export function cancelHide() {
  clearTimeout(hideTimer);
}
