import { db, S } from '../core/db.js';

let temps = [];

export function startTemporary() {
  try {
    const raw = localStorage.getItem('lso_temp');
    temps = raw ? JSON.parse(raw) : [];
  } catch { temps = []; }
}

export function listTemporary() {
  return temps;
}

export function createTemporary(kind, data) {
  const rec = {
    id: 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    kind,
    data,
    created: Date.now(),
    tab: null
  };
  temps.push(rec);
  localStorage.setItem('lso_temp', JSON.stringify(temps));
  return rec;
}

export function deleteTemporary(id) {
  temps = temps.filter(t => t.id !== id);
  localStorage.setItem('lso_temp', JSON.stringify(temps));
}
