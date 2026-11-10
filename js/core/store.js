// Starea aplicației: taburi, elemente, setări, chei de sesiune pentru lacăte și cache decriptat.
import { db, S } from './db.js';
import { uid } from './util.js';
import * as C from './crypto.js';

export const APP_VERSION = '1.0.3';

export const state = {
  settings: {},
  ui: { tab: null, scroll: {}, folder: {}, sub: {} },
  tabs: [],
  items: new Map(),
  keys: new Map(),    // ownerId -> CryptoKey (doar în memorie, pe sesiune)
  plain: new Map(),   // itemId -> date decriptate (doar în memorie)
};

export const DEFAULT_SETTINGS = {
  theme: 'light', trashDays: 30, voiceLang: 'ro-RO', voiceName: '', voiceRate: 1,
  newsHour: '08:00', lastAutoBackup: 0, lastAutoHash: '', version: APP_VERSION,
};

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (what) => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });

export async function load() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await db.kvGet('settings', {})) };
  state.ui = { tab: null, scroll: {}, folder: {}, sub: {}, ...(await db.kvGet('ui', {})) };
  state.tabs = (await db.all(S.tabs)).sort((a, b) => a.order - b.order);
  state.items = new Map((await db.all(S.items)).map(i => [i.id, i]));
}
export const saveSettings = () => db.kvSet('settings', state.settings);
export const saveUI = () => db.kvSet('ui', state.ui);

// ---------- Taburi ----------
export const tabById = id => state.tabs.find(t => t.id === id);
export const liveTabs = () => state.tabs.filter(t => !t.trashedAt).sort((a, b) => a.order - b.order);
export const visibleTabs = () => liveTabs().filter(t => t.visible !== false);
export async function saveTab(tab) { await db.put(S.tabs, tab); emit('tabs'); }
export async function saveTabsOrder() { state.tabs.forEach((t, i) => { if (t.order == null) t.order = i; }); await db.putMany(S.tabs, state.tabs); emit('tabs'); }
export async function addTab(name, kind, extra = {}) {
  const max = Math.max(0, ...state.tabs.map(t => t.order || 0));
  const tab = { id: uid('t'), name, kind, color: '', visible: true, order: max + 1, created: Date.now(), ...extra };
  state.tabs.push(tab); await saveTab(tab); return tab;
}

// ---------- Elemente ----------
export const item = id => state.items.get(id);
export function itemsOf(tabId, { folder, sub, trashed = false, kind } = {}) {
  const out = [];
  for (const it of state.items.values()) {
    if (it.tab !== tabId) continue;
    if (!!it.trashedAt !== trashed) continue;
    if (folder !== undefined && (it.folder || null) !== folder) continue;
    if (sub !== undefined && (it.sub || null) !== sub) continue;
    if (kind && it.kind !== kind) continue;
    out.push(it);
  }
  return out;
}
// Un element e vizibil (nu e ascuns de un dosar/tab șters).
export function isHiddenByTrash(it) {
  const tab = tabById(it.tab);
  if (!tab || tab.trashedAt) return true;
  let f = it.folder;
  while (f) { const fo = state.items.get(f); if (!fo) return true; if (fo.trashedAt) return true; f = fo.folder; }
  return false;
}
export function descendants(folderId) {
  const out = [];
  const walk = fid => { for (const it of state.items.values()) if (it.folder === fid) { out.push(it); if (it.kind === 'folder') walk(it.id); } };
  walk(folderId); return out;
}
// Numără tot ce e în folder, inclusiv subfolderele și conținutul lor (adâncime nelimitată).
export function countInFolder(folderId) {
  return descendants(folderId).filter(i => !i.trashedAt).length;
}
// Copiii direcți ai unui folder, din orice tab (înregistrările arhivate rămân în RECORDINGS, dar apar și aici).
export function itemsInFolder(folderId, { kind } = {}) {
  const out = [];
  for (const it of state.items.values()) {
    if (it.trashedAt) continue;
    if ((it.folder || null) !== folderId) continue;
    if (kind && it.kind !== kind) continue;
    out.push(it);
  }
  return out;
}

// ---------- Lacăte ----------
// Proprietarul cheii care criptează datele unui element: lacătul propriu > cel mai apropiat folder blocat > tabul blocat.
export function ownerOf(it) {
  if (it.lock && it.kind !== 'folder') return it;
  let f = it.folder;
  while (f) { const fo = state.items.get(f); if (fo && fo.lock) return fo; f = fo && fo.folder; }
  const tab = tabById(it.tab);
  return tab && tab.lock ? tab : null;
}
// Toate lacătele care acoperă elementul (porți de acces).
export function locksChain(it) {
  const chain = [];
  if (it.lock && it.kind !== 'folder') chain.push(it); // numele folderului rămâne vizibil; lacătul lui păzește conținutul
  let f = it.folder;
  while (f) { const fo = state.items.get(f); if (fo && fo.lock) chain.push(fo); f = fo && fo.folder; }
  const tab = tabById(it.tab); if (tab && tab.lock) chain.push(tab);
  return chain;
}
export const isOpen = obj => !obj.lock || state.keys.has(obj.id);
export function canView(it) {
  if (!locksChain(it).every(isOpen)) return false;
  return dataOf(it) != null;
}
export function dataOf(it) {
  if (!it) return null;
  if (!it.sec) return it.data || {};
  return state.plain.get(it.id) || null;
}

async function sealRecord(it, data) {
  const owner = ownerOf(it);
  const rec = { ...it };
  delete rec.data; delete rec.sec;
  rec.mediaIds = mediaIdsOf(data);
  if (owner) {
    const key = state.keys.get(owner.id);
    if (!key) throw new Error('locked');
    rec.sec = { o: owner.id, ...(await C.encJSON(key, data)) };
    state.plain.set(it.id, data);
  } else {
    rec.data = data;
    state.plain.delete(it.id);
  }
  return rec;
}
// Actualizează obiectul din memorie pe loc (referințele rămân valide).
function applyRec(it, rec) {
  delete it.data; delete it.sec;
  Object.assign(it, rec);
  state.items.set(it.id, it);
}
export async function saveItem(it, data, { silent = false } = {}) {
  if (data === undefined) data = dataOf(it);
  if (data == null) throw new Error('locked');
  it.updated = Date.now();
  const rec = await sealRecord(it, data);
  applyRec(it, rec);
  await db.put(S.items, rec);
  if (!silent) emit('items');
  return it;
}
let seq = 0;
export async function newItem(tabId, kind, data, extra = {}) {
  const it = { id: uid('i'), tab: tabId, kind, created: Date.now(), updated: Date.now(), order: Date.now() * 1000 + (seq++ % 1000), ...extra };
  return saveItem(it, data);
}
// Salvează metadate structurale (fără a atinge conținutul criptat).
export async function saveMeta(it) { state.items.set(it.id, it); await db.put(S.items, it); emit('items'); }

export async function decryptOwned(ownerId) {
  const key = state.keys.get(ownerId); if (!key) return;
  for (const it of state.items.values()) {
    if (it.sec && it.sec.o === ownerId && !state.plain.has(it.id)) {
      try { state.plain.set(it.id, await C.decJSON(key, it.sec)); } catch (e) { console.warn('decrypt', it.id, e); }
    }
  }
}
export async function unlockTemp(obj, pin) {
  const key = await C.verifyPin(obj.lock, pin);
  if (!key) return false;
  state.keys.set(obj.id, key);
  await decryptOwned(obj.id);
  emit('lock');
  return true;
}
// Reblocare: șterge cheia și conținutul decriptat (inclusiv lacătele interioare ale unui tab/folder).
export function relock(obj) {
  const ids = new Set([obj.id]);
  if (obj.kind === 'folder') descendants(obj.id).forEach(d => ids.add(d.id));
  else if (!obj.tab) for (const it of state.items.values()) if (it.tab === obj.id) ids.add(it.id);
  for (const id of ids) state.keys.delete(id);
  for (const it of state.items.values()) if (it.sec && !state.keys.has(it.sec.o)) state.plain.delete(it.id);
  emit('lock');
}
export function relockAll() {
  if (!state.keys.size) return;
  state.keys.clear(); state.plain.clear(); emit('lock');
}

// Elementele ale căror date depind de lacătul obiectului.
// (exclude elementele protejate de un lacăt mai apropiat: propriu sau al unui folder interior)
function affectedBy(obj) {
  let cand;
  if (obj.kind === 'folder' && obj.tab) cand = descendants(obj.id);
  else if (obj.tab) return [obj];
  else cand = [...state.items.values()].filter(it => it.tab === obj.id);
  return cand.filter(it => {
    if (it.lock && it.kind !== 'folder') return false;
    let f = it.folder;
    while (f && f !== obj.id) { const fo = state.items.get(f); if (!fo) break; if (fo.lock) return false; f = fo.folder; }
    return true;
  });
}
export function mediaIdsOf(data) {
  const out = [];
  const files = arr => (arr || []).forEach(f => f && f.mid && out.push(f.mid));
  if (!data) return out;
  files(data.files); if (data.mid) out.push(data.mid);
  (data.subs || []).forEach(s => files(s.files));
  return out;
}
async function snapshot(items) {
  const snap = [];
  for (const it of items) {
    const data = dataOf(it);
    if (data == null) throw new Error('locked');
    const media = [];
    for (const mid of mediaIdsOf(data)) { const m = await getMedia(mid); if (m) media.push({ mid, ...m }); }
    snap.push({ id: it.id, data, media });
  }
  return snap;
}
async function reseal(snap) {
  for (const s of snap) {
    const it = state.items.get(s.id);
    const rec = await sealRecord(it, s.data);
    applyRec(it, rec); await db.put(S.items, rec);
    for (const m of s.media) await putMedia(m.blob, m.name, m.mime, ownerOf(it), m.mid);
  }
}
async function persistOwner(obj) { if (obj.tab) { state.items.set(obj.id, obj); await db.put(S.items, obj); } else await db.put(S.tabs, obj); }

export async function lockWithPin(obj, pin) {
  const snap = await snapshot(affectedBy(obj));
  const { lock, key } = await C.newLock(pin);
  obj.lock = lock; state.keys.set(obj.id, key);
  await persistOwner(obj);
  await reseal(snap);
  emit('lock'); return true;
}
export async function unlockPermanent(obj, pin) {
  const key = await C.verifyPin(obj.lock, pin);
  if (!key) return false;
  state.keys.set(obj.id, key); await decryptOwned(obj.id);
  const snap = await snapshot(affectedBy(obj));
  obj.lock = null; state.keys.delete(obj.id);
  await persistOwner(obj);
  await reseal(snap);
  emit('lock'); return true;
}

// ---------- Media (IndexedDB, criptată când elementul e sub lacăt) ----------
export async function putMedia(blob, name, mime, owner = null, id = uid('m')) {
  const rec = { id, name, mime: mime || blob.type || 'application/octet-stream', size: blob.size };
  if (owner) {
    const key = state.keys.get(owner.id); if (!key) throw new Error('locked');
    const r = await C.encBytes(key, await blob.arrayBuffer());
    rec.enc = { o: owner.id, iv: r.iv, ct: r.ct };
  } else rec.blob = blob;
  await db.put(S.media, rec);
  return id;
}
export async function getMedia(mid) {
  const r = await db.get(S.media, mid); if (!r) return null;
  if (r.blob) return { blob: r.blob, name: r.name, mime: r.mime };
  const key = state.keys.get(r.enc.o); if (!key) return null;
  const buf = await C.decBytes(key, r.enc.iv, r.enc.ct);
  return { blob: new Blob([buf], { type: r.mime }), name: r.name, mime: r.mime };
}
export const delMedia = mid => db.del(S.media, mid);

// ---------- Coș ----------
export async function trash(obj) {
  obj.trashedAt = Date.now();
  if (obj.tab) await saveMeta(obj); else await saveTab(obj);
}
export async function restore(obj) {
  delete obj.trashedAt;
  if (obj.tab) {
    // dacă folderul/tabul părinte nu mai există, readu elementul la rădăcină
    if (obj.folder && !state.items.get(obj.folder)) obj.folder = null;
    await saveMeta(obj);
  } else await saveTab(obj);
}
export async function purge(obj) {
  const list = obj.tab ? (obj.kind === 'folder' ? [obj, ...descendants(obj.id)] : [obj]) : [...state.items.values()].filter(i => i.tab === obj.id);
  for (const it of list) {
    for (const m of (it.mediaIds || [])) await delMedia(m);
    state.items.delete(it.id); state.plain.delete(it.id); await db.del(S.items, it.id);
  }
  if (!obj.tab) { state.tabs = state.tabs.filter(t => t.id !== obj.id); await db.del(S.tabs, obj.id); }
  emit('items'); emit('tabs');
}
export function trashedAll() {
  const out = [];
  for (const t of state.tabs) if (t.trashedAt) out.push(t);
  for (const it of state.items.values()) if (it.trashedAt) out.push(it);
  return out.sort((a, b) => b.trashedAt - a.trashedAt);
}

// Mută un element (și conținutul unui folder) cu recriptare conform noului proprietar al cheii.
export async function relocate(it, changes) {
  const list = it.kind === 'folder' ? [it, ...descendants(it.id)] : [it];
  const snap = await snapshot(list);
  Object.assign(it, changes);
  if (it.kind === 'folder') for (const d of descendants(it.id)) d.tab = it.tab;
  await reseal(snap);
  emit('items');
}
