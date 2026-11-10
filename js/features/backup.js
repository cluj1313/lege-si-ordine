// Backup manual (export/import JSON cu media) și backup intern automat, silențios (ultimele 5).
import { h, act, fmtTs, downloadBlob, blobToB64, b64ToBytes, bytesToB64, uid } from '../core/util.js';
import { t } from '../core/i18n.js';
import { db, S } from '../core/db.js';
import { state, APP_VERSION, saveSettings } from '../core/store.js';
import { confirmDlg, toast, openModal } from '../ui/modal.js';
import { pickFiles } from './media.js';

const KEEP = 5;

async function rawSnapshot() {
  return {
    app: 'lege-si-ordine', format: 1, version: APP_VERSION, created: Date.now(),
    settings: await db.kvGet('settings', {}), ui: await db.kvGet('ui', {}),
    kv: { news_results: await db.kvGet('news_results', []), seeded: await db.kvGet('seeded', false) },
    tabs: await db.all(S.tabs), items: await db.all(S.items), media: await db.all(S.media),
  };
}
const dataHash = snap => {
  let s = snap.tabs.length + ':' + snap.items.length + ':' + snap.media.length;
  for (const i of snap.items) s += i.id + (i.updated || 0) + (i.trashedAt || 0);
  for (const tb of snap.tabs) s += tb.id + tb.order + tb.name + (tb.trashedAt || 0) + (tb.visible === false ? 0 : 1);
  let hsh = 0; for (let i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) | 0;
  return String(hsh);
};

async function restoreRaw(snap) {
  await db.clear(S.tabs); await db.clear(S.items); await db.clear(S.media);
  await db.putMany(S.tabs, snap.tabs || []);
  await db.putMany(S.items, snap.items || []);
  await db.putMany(S.media, snap.media || []);
  await db.kvSet('settings', { ...(snap.settings || {}), lastAutoBackup: state.settings.lastAutoBackup });
  await db.kvSet('ui', snap.ui || {});
  if (snap.kv) { await db.kvSet('news_results', snap.kv.news_results || []); await db.kvSet('seeded', true); }
}

// ---- Backup intern automat (silențios) ----
export async function autoBackup(reason = 'auto', force = false) {
  try {
    const snap = await rawSnapshot();
    const hash = dataHash(snap);
    if (!force && hash === state.settings.lastAutoHash) return false;
    await db.put(S.backups, { id: uid('b'), created: Date.now(), reason, version: APP_VERSION, counts: { tabs: snap.tabs.length, items: snap.items.length, media: snap.media.length }, snap });
    const all = (await db.all(S.backups)).sort((a, b) => b.created - a.created);
    for (const old of all.slice(KEEP)) await db.del(S.backups, old.id);
    state.settings.lastAutoBackup = Date.now(); state.settings.lastAutoHash = hash; await saveSettings();
    return true;
  } catch (e) { console.warn('autoBackup', e); return false; }
}
export async function maybeDailyBackup() {
  const versionChanged = state.settings.version !== APP_VERSION;
  if (versionChanged) { await autoBackup('update', true); state.settings.version = APP_VERSION; await saveSettings(); return; }
  if (Date.now() - (state.settings.lastAutoBackup || 0) > 20 * 3600000) await autoBackup('auto');
}
export async function listInternal() { return (await db.all(S.backups)).sort((a, b) => b.created - a.created); }
export async function restoreInternal(b) {
  if (!(await confirmDlg(t('confirmRestore', { d: fmtTs(b.created), n: b.counts.items }), { danger: true }))) return false;
  await autoBackup('before-restore', true);
  await restoreRaw(b.snap);
  toast(t('restoredReload'));
  setTimeout(() => location.reload(), 500);
  return true;
}

// ---- Export / import manual ----
export async function exportJSON() {
  const snap = await rawSnapshot();
  const media = [];
  for (const m of snap.media) {
    const o = { id: m.id, name: m.name, mime: m.mime, size: m.size };
    if (m.blob) o.b64 = await blobToB64(m.blob);
    if (m.enc) o.enc = { o: m.enc.o, iv: m.enc.iv, ct: bytesToB64(m.enc.ct) };
    media.push(o);
  }
  const out = { ...snap, media };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  const name = `lege-si-ordine-backup-${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  downloadBlob(blob, name);
  toast(t('backupSaved'));
  return name;
}

export async function importJSON(file) {
  if (!file) { [file] = await pickFiles({ accept: 'application/json,.json' }); if (!file) return false; }
  let snap;
  try { snap = JSON.parse(await file.text()); } catch { toast(t('backupBad'), 3500); return false; }
  if (!snap || snap.app !== 'lege-si-ordine' || !Array.isArray(snap.items) || !Array.isArray(snap.tabs)) { toast(t('backupBad'), 3500); return false; }
  if (!(await confirmDlg(t('confirmImport', { d: fmtTs(snap.created), n: snap.items.length, m: (snap.media || []).length }), { danger: true }))) return false;
  await autoBackup('before-import', true);
  snap.media = (snap.media || []).map(m => {
    const r = { id: m.id, name: m.name, mime: m.mime, size: m.size };
    if (m.b64 != null) r.blob = new Blob([b64ToBytes(m.b64)], { type: m.mime });
    if (m.enc) r.enc = { o: m.enc.o, iv: m.enc.iv, ct: b64ToBytes(m.enc.ct).buffer };
    return r;
  });
  await restoreRaw(snap);
  toast(t('restoredReload'));
  setTimeout(() => location.reload(), 500);
  return true;
}

export function backupSection() {
  const list = h('div', { class: 'bk-list' });
  const draw = async () => {
    list.innerHTML = '';
    const all = await listInternal();
    if (!all.length) list.append(h('div', { class: 'r2-meta' }, t('noInternalBackups')));
    all.forEach(b => list.append(h('div', { class: 'bk-row' },
      h('div', {}, h('div', {}, fmtTs(b.created)), h('div', { class: 'r2-meta' }, `${t('bkReason_' + (b.reason || 'auto'))} • ${t('nItems', { n: b.counts.items })}`)),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, () => restoreInternal(b)) }, t('restore')))));
  };
  draw();
  return h('div', {},
    h('p', { class: 'r2-meta' }, t('backupManualHint')),
    h('div', { class: 'row-btns' },
      h('button', { class: 'btn', type: 'button', 'data-test': 'export', onclick: e => act(e.currentTarget, exportJSON) }, t('backupExport')),
      h('button', { class: 'btn ghost', type: 'button', 'data-test': 'import', onclick: e => act(e.currentTarget, () => importJSON()) }, t('backupImport'))),
    h('h3', { class: 'sub-h' }, t('backupAuto')),
    h('p', { class: 'r2-meta' }, t('backupAutoHint')),
    list);
}
