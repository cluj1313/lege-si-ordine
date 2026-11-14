import { db, S } from '../core/db.js';

const KEY = 'lso_temp_notes';
let temps = [];
let hideTimer = null;

export function startTemporary() {
  try {
    const raw = localStorage.getItem(KEY);
    temps = raw ? JSON.parse(raw) : [];
  } catch { temps = []; }
}

export function listTemporary() {
  return temps.slice();
}

export function createTemporary(text, tabId, modes) {
  const rec = {
    id: 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    text: String(text || '').trim(),
    tab: tabId || null,
    modes: modes || ['read'],
    created: Date.now()
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
