import { db, S } from '../core/db.js';

const KEY = 'lso_temp_notes';
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
let temps = [];
let hideTimer = null;

export function startTemporary() {
  try {
    const raw = localStorage.getItem(KEY);
    temps = raw ? JSON.parse(raw) : [];
  } catch {
    temps = [];
  }
  // Dacă localStorage e gol, încearcă din IndexedDB
  if (!temps.length) {
    db.kvGet('temp_notes', [])
      .then(fromDb => {
        if (Array.isArray(fromDb) && fromDb.length) {
          temps = fromDb;
          persist();
          if (typeof window !== 'undefined' && window.LSO && window.LSO.render) window.LSO.render();
        }
      })
      .catch(() => {});
  }
  pruneExpired();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(temps));
  } catch {}
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

export function listTemporary(tabId) {
  pruneExpired();
  if (!tabId) return temps.slice();
  return temps.filter(t => t.tab === tabId);
}

export function listTemporaryByTab(tabId) {
  return listTemporary(tabId);
}

export function createTemporary(text, tabId, modes) {
  const now = Date.now();
  const rec = {
    id: 'temp_' + now + '_' + Math.random().toString(36).slice(2, 7),
    text: String(text || '').trim(),
    tab: tabId || 'tasks',
    modes: modes || ['read'],
    created: now,
    updatedAt: now,
    expires: now + DAYS_30,
  };
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
    Object.assign(t, patch, { updatedAt: Date.now() });
    persist();
  }
  return t || null;
}

export function editTemporaryText(id, newText) {
  return updateTemporary(id, { text: String(newText ?? '').trim() });
}

export function moveTemporaryToTab(id, targetTab) {
  if (!targetTab) return null;
  return updateTemporary(id, { tab: targetTab });
}

export function takeTemporaryForMove(id) {
  const item = temps.find(x => x.id === id) || null;
  if (item) {
    temps = temps.filter(x => x.id !== id);
    persist();
  }
  return item;
}

export function scheduleHide(callback, ms = 2500) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(callback, ms);
}

export function cancelHide() {
  clearTimeout(hideTimer);
}
