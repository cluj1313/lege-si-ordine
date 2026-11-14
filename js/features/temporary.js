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
  pruneExpired();
}

function pruneExpired() {
  const now = Date.now();
  const before = temps.length;
  temps = temps.filter(t => !t.expires || t.expires > now);
  if (temps.length !== before) {
    localStorage.setItem(KEY, JSON.stringify(temps));
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
  if (!rec.text) return null;
  temps.unshift(rec);
  localStorage.setItem(KEY, JSON.stringify(temps));
  return rec;
}

export function deleteTemporary(id) {
  temps = temps.filter(t => t.id !== id);
  localStorage.setItem(KEY, JSON.stringify(temps));
}

export function updateTemporary(id, patch) {
  const t = temps.find(x => x.id === id);
  if (t) {
    Object.assign(t, patch);
    // dacă se schimbă textul, nu resetăm expirarea
    localStorage.setItem(KEY, JSON.stringify(temps));
  }
}

export function scheduleHide(callback, ms = 2500) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(callback, ms);
}

export function cancelHide() {
  clearTimeout(hideTimer);
}
