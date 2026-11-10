// Backup manual (istoric ~20, export/import/trimite) și backup automat intern
// (ultimele 5, înainte de update/restaurare) + copie săptămânală silențioasă pe Android.
import { h, act, fmtTs, downloadBlob, blobToB64, b64ToBytes, bytesToB64, uid } from '../core/util.js';
import { t } from '../core/i18n.js';
import { db, S } from '../core/db.js';
import { state, APP_VERSION, saveSettings } from '../core/store.js';
import { confirmDlg, toast } from '../ui/modal.js';
import { pickFiles } from './media.js';
import { isNative } from '../voice/native-cap.js';
import { shareFile } from './share.js';

const KEEP_AUTO = 5;
const KEEP_MANUAL = 20;
const KEEP_WEEKLY_FILES = 4;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const FOLDER = 'LEGE-SI-ORDINE';
const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const fsPlugin = () => cap()?.Plugins?.Filesystem || null;
const sharePlugin = () => cap()?.Plugins?.Share || null;

// Notă: backup-ul cuprinde doar IndexedDB (setări, ui, taburi, elemente, media). Cheile Zonei secrete și ale
// serverului (lso_crsec, lso_crtok, lso_adpw, lso_adtok, lso_iid, lso_newsBox etc.) stau în localStorage/sessionStorage
// și NU intră niciodată în backup.
async function rawSnapshot() {
  return {
    app: 'lege-si-ordine', format: 1, version: APP_VERSION, created: Date.now(),
    settings: await db.kvGet('settings', {}), ui: await db.kvGet('ui', {}),
    kv: { news_results: await db.kvGet('news_results', []), seeded: await db.kvGet('seeded', false) },
    tabs: await db.all(S.tabs), items: await db.all(S.items), media: await db.all(S.media),
  };
}
export const dataHash = snap => {
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

function backupName(prefix = 'backup') {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `lege-si-ordine-${prefix}-${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

async function packMedia(snap, { omitLarge = true } = {}) {
  const media = [];
  const omitted = [];
  for (const m of snap.media) {
    const size = m.size || (m.blob && m.blob.size) || (m.enc && m.enc.ct && m.enc.ct.byteLength) || 0;
    if (omitLarge && size > MAX_MEDIA_BYTES) {
      omitted.push({ id: m.id, name: m.name, size });
      continue;
    }
    const o = { id: m.id, name: m.name, mime: m.mime, size: m.size };
    if (m.blob) o.b64 = await blobToB64(m.blob);
    if (m.enc) o.enc = { o: m.enc.o, iv: m.enc.iv, ct: bytesToB64(m.enc.ct) };
    media.push(o);
  }
  return { ...snap, media, omittedMedia: omitted.length ? omitted : undefined };
}
function unpackMedia(snap) {
  snap.media = (snap.media || []).map(m => {
    const r = { id: m.id, name: m.name, mime: m.mime, size: m.size };
    if (m.b64 != null) r.blob = new Blob([b64ToBytes(m.b64)], { type: m.mime });
    if (m.enc) r.enc = { o: m.enc.o, iv: m.enc.iv, ct: b64ToBytes(m.enc.ct).buffer };
    return r;
  });
  return snap;
}

async function pruneBackups() {
  const all = (await db.all(S.backups)).sort((a, b) => b.created - a.created);
  const auto = all.filter(b => b.kind !== 'manual');
  const man = all.filter(b => b.kind === 'manual');
  for (const old of auto.slice(KEEP_AUTO)) await db.del(S.backups, old.id);
  for (const old of man.slice(KEEP_MANUAL)) await db.del(S.backups, old.id);
}

// ---- Backup intern automat (silențios) ----
export async function autoBackup(reason = 'auto', force = false) {
  try {
    const snap = await rawSnapshot();
    const hash = dataHash(snap);
    if (!force && hash === state.settings.lastAutoHash) return false;
    await db.put(S.backups, { id: uid('b'), kind: 'auto', created: Date.now(), reason, version: APP_VERSION, counts: { tabs: snap.tabs.length, items: snap.items.length, media: snap.media.length }, snap });
    await pruneBackups();
    state.settings.lastAutoBackup = Date.now(); state.settings.lastAutoHash = hash; await saveSettings();
    return true;
  } catch (e) { console.warn('autoBackup', e); return false; }
}
export async function maybeDailyBackup() {
  const versionChanged = state.settings.version !== APP_VERSION;
  if (versionChanged) { await autoBackup('update', true); state.settings.version = APP_VERSION; await saveSettings(); return; }
  if (Date.now() - (state.settings.lastAutoBackup || 0) > 20 * 3600000) await autoBackup('auto');
}
export async function listInternal() {
  return (await db.all(S.backups)).filter(b => b.kind !== 'manual').sort((a, b) => b.created - a.created);
}
export async function listManual() {
  return (await db.all(S.backups)).filter(b => b.kind === 'manual').sort((a, b) => b.created - a.created);
}
export async function restoreInternal(b) {
  if (!(await confirmDlg(t('confirmRestore', { d: fmtTs(b.created), n: (b.counts && b.counts.items) || (b.snap && b.snap.items && b.snap.items.length) || 0 }), { danger: true }))) return false;
  await autoBackup('before-restore', true);
  const snap = b.snap.media && b.snap.media[0] && (b.snap.media[0].b64 != null || b.snap.media[0].enc) && !b.snap.media[0].blob
    ? unpackMedia({ ...b.snap, media: b.snap.media.map(x => ({ ...x })) })
    : b.snap;
  await restoreRaw(snap);
  toast(t('restoredReload'));
  setTimeout(() => location.reload(), 500);
  return true;
}

// ---- Fișiere pe dispozitiv (Android: Descărcări/Documente/LEGE-SI-ORDINE) ----
export async function writePublicFile(name, text) {
  const FS = fsPlugin();
  if (!FS) return null;
  const data = bytesToB64(new TextEncoder().encode(text));
  const dirs = isNative() ? ['EXTERNAL_STORAGE', 'DOCUMENTS', 'DATA'] : ['DOCUMENTS'];
  const pathsFor = dir => dir === 'EXTERNAL_STORAGE'
    ? [`Download/${FOLDER}/${name}`, `DOWNLOAD/${FOLDER}/${name}`]
    : [`${FOLDER}/${name}`];
  for (const directory of dirs) {
    for (const path of pathsFor(directory)) {
      try {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : FOLDER;
        try { await FS.mkdir({ path: parent, directory, recursive: true }); } catch {}
        await FS.writeFile({ path, data, directory, recursive: true });
        let uri = '';
        try { const r = await FS.getUri({ path, directory }); uri = r.uri || r.nativeURI || ''; } catch {}
        return { path, directory, uri };
      } catch (e) { console.warn('writePublicFile', directory, path, e); }
    }
  }
  return null;
}
async function listWeeklyFiles() {
  const FS = fsPlugin();
  if (!FS) return [];
  const found = [];
  for (const directory of ['EXTERNAL_STORAGE', 'DOCUMENTS', 'DATA']) {
    const roots = directory === 'EXTERNAL_STORAGE' ? [`Download/${FOLDER}`, `DOWNLOAD/${FOLDER}`] : [FOLDER];
    for (const path of roots) {
      try {
        const r = await FS.readdir({ path, directory });
        const files = (r.files || r).map(f => (typeof f === 'string' ? f : f.name)).filter(n => /lege-si-ordine-saptamanal-/.test(n));
        for (const name of files) found.push({ path: `${path}/${name}`, directory, name });
      } catch {}
    }
    if (found.length) break;
  }
  return found;
}
async function pruneWeeklyFiles() {
  const FS = fsPlugin();
  if (!FS) return;
  const files = (await listWeeklyFiles()).sort((a, b) => a.name < b.name ? 1 : -1);
  for (const old of files.slice(KEEP_WEEKLY_FILES)) {
    try { await FS.deleteFile({ path: old.path, directory: old.directory }); } catch {}
  }
}

function blobFromPacked(out) {
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function exportJSON() {
  const packed = await packMedia(await rawSnapshot());
  const name = backupName('backup');
  const text = JSON.stringify(packed);
  await db.put(S.backups, {
    id: uid('b'), kind: 'manual', created: packed.created, reason: 'manual', version: APP_VERSION,
    counts: { tabs: packed.tabs.length, items: packed.items.length, media: packed.media.length },
    name, snap: packed, omitted: packed.omittedMedia || [],
  });
  await pruneBackups();
  const written = await writePublicFile(name, text);
  if (!written) downloadBlob(blobFromPacked(packed), name);
  if (packed.omittedMedia && packed.omittedMedia.length) toast(t('backupOmitted', { n: packed.omittedMedia.length }), 4000);
  else toast(written ? t('backupSavedPlace') : t('backupSaved'));
  return name;
}

export async function importJSON(file) {
  if (!file) { [file] = await pickFiles({ accept: 'application/json,.json' }); if (!file) return false; }
  let snap;
  try { snap = JSON.parse(await file.text()); } catch { toast(t('backupBad'), 3500); return false; }
  if (!snap || snap.app !== 'lege-si-ordine' || !Array.isArray(snap.items) || !Array.isArray(snap.tabs)) { toast(t('backupBad'), 3500); return false; }
  if (!(await confirmDlg(t('confirmImport', { d: fmtTs(snap.created), n: snap.items.length, m: (snap.media || []).length }), { danger: true }))) return false;
  await autoBackup('before-import', true);
  unpackMedia(snap);
  await restoreRaw(snap);
  toast(t('restoredReload'));
  setTimeout(() => location.reload(), 500);
  return true;
}

async function sendBackup(b) {
  let packed = b.snap;
  if (!packed || packed.media && packed.media[0] && packed.media[0].blob) packed = await packMedia(packed, { omitLarge: true });
  const name = b.name || backupName('backup');
  const blob = blobFromPacked(packed);
  if (packed.omittedMedia && packed.omittedMedia.length) toast(t('backupOmitted', { n: packed.omittedMedia.length }), 4000);
  const Sh = sharePlugin();
  if (Sh && b.fileUri) {
    try { await Sh.share({ title: name, text: t('setBackup'), files: [b.fileUri], dialogTitle: t('backupSend') }); return; } catch (e) { if (e && e.message && /abort|cancel/i.test(e.message)) return; }
  }
  await shareFile(blob, name, t('setBackup'));
}

async function deleteManual(b, redraw) {
  if (!(await confirmDlg(t('confirmDeleteBackup', { d: fmtTs(b.created) }), { danger: true }))) return;
  await db.del(S.backups, b.id);
  toast(t('deletedOk'));
  if (redraw) redraw();
}

// ---- Copie săptămânală silențioasă (doar Android nativ) ----
export async function maybeWeeklyBackup() {
  if (!isNative()) return false;
  if (state.settings.weeklyBackup === false) return false;
  const now = Date.now();
  const lastCheck = state.settings.lastWeeklyCheck || 0;
  const lastWrite = state.settings.lastWeeklyWrite || 0;
  if (now - lastCheck < 6 * 3600000 - 1000) return false;
  const snap = await rawSnapshot();
  const hash = dataHash(snap);
  state.settings.lastWeeklyCheck = now;
  if (hash === (state.settings.lastWeeklyHash || '') && lastWrite && now - lastWrite < 7 * 86400000) {
    await saveSettings();
    return false;
  }
  if (lastWrite && now - lastWrite < 7 * 86400000) { await saveSettings(); return false; }
  const run = async () => {
    try {
      const packed = await packMedia(snap);
      const name = backupName('saptamanal').replace(/-\d{4}\.json$/, '.json');
      const written = await writePublicFile(name, JSON.stringify(packed));
      if (written) {
        state.settings.lastWeeklyHash = hash;
        state.settings.lastWeeklyWrite = Date.now();
        await saveSettings();
        await pruneWeeklyFiles();
      } else await saveSettings();
    } catch (e) { console.warn('weeklyBackup', e); await saveSettings(); }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: 8000 });
  else setTimeout(run, 400);
  return true;
}
export function startWeeklyBackup() {
  if (!isNative()) return;
  setTimeout(() => maybeWeeklyBackup(), 45000);
  setInterval(() => maybeWeeklyBackup(), 6 * 3600000);
}

export function backupSection() {
  const manualList = h('div', { class: 'bk-list', 'data-test': 'bk-manual-list' });
  const autoList = h('div', { class: 'bk-list', 'data-test': 'bk-auto-list' });
  const drawManual = async () => {
    manualList.innerHTML = '';
    const all = await listManual();
    if (!all.length) manualList.append(h('div', { class: 'r2-meta' }, t('noManualBackups')));
    all.forEach(b => manualList.append(h('div', { class: 'bk-row' },
      h('div', {}, h('div', {}, fmtTs(b.created)), h('div', { class: 'r2-meta' }, `${t('nItems', { n: b.counts.items })}${b.omitted && b.omitted.length ? ' • ' + t('backupOmittedShort', { n: b.omitted.length }) : ''}`)),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'bk-restore-manual', onclick: e => act(e.currentTarget, () => restoreInternal(b)) }, t('restore')),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, () => sendBackup(b)) }, t('backupSend')),
        h('button', { class: 'btn sm danger-ghost', type: 'button', onclick: e => act(e.currentTarget, () => deleteManual(b, drawManual)) }, t('delete'))))));
  };
  const drawAuto = async () => {
    autoList.innerHTML = '';
    const all = await listInternal();
    if (!all.length) autoList.append(h('div', { class: 'r2-meta' }, t('noInternalBackups')));
    all.forEach(b => autoList.append(h('div', { class: 'bk-row' },
      h('div', {}, h('div', {}, fmtTs(b.created)), h('div', { class: 'r2-meta' }, `${t('bkReason_' + (b.reason || 'auto'))} • ${t('nItems', { n: b.counts.items })}`)),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, () => restoreInternal(b)) }, t('restore')))));
  };
  drawManual(); drawAuto();

  const weeklyOn = state.settings.weeklyBackup !== false;
  const weeklyRow = h('label', { class: 'fld-check' },
    h('input', { type: 'checkbox', 'data-test': 'weekly-backup', checked: weeklyOn, disabled: !isNative(), onchange: async e => { state.settings.weeklyBackup = e.target.checked; await saveSettings(); } }),
    h('span', {}, t('backupWeekly')));
  const weeklyHint = h('p', { class: 'r2-meta' }, isNative() ? t('backupWeeklyHint') : t('backupWeeklyWeb'));
  if (isNative() && state.settings.lastWeeklyWrite) {
    weeklyHint.append(h('span', {}, ' ' + t('backupWeeklyLast', { d: fmtTs(state.settings.lastWeeklyWrite) })));
  }

  const sub = (id, title, ...kids) => {
    const open = (state.ui.settingsOpen || {})['bk-' + id] !== false;
    const d = h('details', { class: 'set-sub', open, 'data-sec': 'bk-' + id, 'data-test': 'bk-' + id }, h('summary', {}, title), h('div', { class: 'set-body' }, ...kids));
    d.addEventListener('toggle', () => { state.ui.settingsOpen = { ...(state.ui.settingsOpen || {}), ['bk-' + id]: d.open }; });
    return d;
  };

  return h('div', {},
    sub('manual', t('backupManual'),
      h('p', { class: 'r2-meta' }, t('backupManualHint')),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', type: 'button', 'data-test': 'export', onclick: e => act(e.currentTarget, async () => { await exportJSON(); drawManual(); }) }, t('backupExport')),
        h('button', { class: 'btn ghost', type: 'button', 'data-test': 'import', onclick: e => act(e.currentTarget, () => importJSON()) }, t('backupImport'))),
      manualList),
    sub('auto', t('backupAuto'),
      h('p', { class: 'r2-meta' }, t('backupAutoHint')),
      h('button', { class: 'btn ghost', type: 'button', 'data-test': 'bk-auto-now', onclick: e => act(e.currentTarget, async () => { await autoBackup('manual-auto', true); toast(t('backupAutoDone')); drawAuto(); }) }, t('backupAutoNow')),
      autoList,
      h('h3', { class: 'sub-h' }, t('backupWeeklyTitle')),
      weeklyRow, weeklyHint));
}
