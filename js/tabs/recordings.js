// RECORDINGS 🔴: înregistrare directă (MediaRecorder) cu transcriere live prin dictare, când browserul permite.
import { h, act, fmtDur, fmtTs } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, itemsOf, newItem, putMedia, ownerOf, dataOf, saveItem, canView, saveUI, saveMeta, descendants, item as getItem, liveTabs } from '../core/store.js';
import { toast, promptDlg, openModal } from '../ui/modal.js';
import { card } from '../ui/list.js';
import { renderDayGroups } from '../ui/daygroups.js';
import { recName, recTitle, recStatuses, recArchivedStatus } from './kinds.js';
import { sheet } from '../ui/modal.js';
import { saveSettings } from '../core/store.js';
import { pickFolder, folderNameOf, foldersTab, createFolder } from '../ui/folderpick.js';
import { pillRow, visibilitySheet } from '../ui/pillrow.js';
import { folderMenu } from './views.js';
import { isoFromDate } from '../core/util.js';
import { startDictation, stopDictation, canLiveTranscribe } from '../features/voice.js';
import { pickField } from '../ui/pickers.js';
import { app } from '../ui/registry.js';

const R = { mr: null, chunks: [], start: 0, timer: null, transcript: '', live: true, tabId: null, stream: null, busy: false, folder: null };
export const isRecording = () => !!R.mr;

function pickMime() {
  if (!window.MediaRecorder) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
}


function recFilter(tab) {
  const v = state.ui.sub[tab.id];
  return v && v !== 'all' ? v : 'all';
}
function recsOfFolder(folderId) {
  const ids = new Set([folderId, ...descendants(folderId).filter(i => i.kind === 'folder').map(i => i.id)]);
  return [...state.items.values()].filter(i => i.kind === 'rec' && !i.trashedAt && ids.has(i.folder));
}

function recFolderRow(tab) {
  const foldTab = liveTabs().find(x => x.kind === 'folders');
  const roots = foldTab ? itemsOf(foldTab.id, { folder: null, kind: 'folder' }).sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
  const cur = recFilter(tab);
  const all = itemsOf(tab.id);
  const items = [
    { id: 'all', name: t('catAll'), fixed: true, count: all.length },
    ...roots.filter(f => !f.hidden).map(f => ({ id: f.id, name: folderNameOf(f), count: recsOfFolder(f.id).length, locked: !!f.lock })),
  ];
  const active = roots.some(f => f.id === cur && !f.hidden) ? cur : 'all';
  return pillRow({
    items, activeId: active, variant: 'folder', test: 'rec-folder-row',
    onPick: c => {
      state.ui.sub[tab.id] = c.id;
      if (R.mr) R.folder = c.id === 'all' ? null : c.id;
      saveUI(); app.render();
    },
    onAdd: async () => {
      const ft = await foldersTab();
      const f = await createFolder(ft, null);
      if (f) { state.ui.sub[tab.id] = f.id; if (R.mr) R.folder = f.id; await saveUI(); app.render(); }
    },
    onManage: () => visibilitySheet(t('manageVisible'), roots.map(f => ({ id: f.id, name: folderNameOf(f), visible: !f.hidden })), async out => {
      for (const [i, o] of out.entries()) { const f = getItem(o.id); f.order = i; f.hidden = !o.visible; await saveMeta(f); }
      if (active !== 'all' && getItem(active)?.hidden) state.ui.sub[tab.id] = 'all';
      app.render();
    }),
    onItemMenu: c => foldTab && folderMenu(foldTab, getItem(c.id)),
  });
}

export async function startRecording(tabId) {
  if (R.mr || R.busy) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast(t('recMissing'), 4000); return; }
  R.busy = true;
  try {
    R.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { R.busy = false; toast(t('micDenied'), 4000); return; }
  const mime = pickMime();
  R.mr = new MediaRecorder(R.stream, mime ? { mimeType: mime } : undefined);
  R.chunks = []; R.transcript = ''; R.start = Date.now(); R.tabId = tabId;
  const recTab = liveTabs().find(x => x.id === tabId);
  const pref = recTab ? recFilter(recTab) : 'all';
  R.folder = pref !== 'all' ? pref : null;
  R.mr.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
  R.mr.start(1000);
  R.busy = false;
  if (R.live && canLiveTranscribe()) startDictation(null, { quiet: true, onFinal: txt => { R.transcript += (R.transcript ? ' ' : '') + txt; updateLive(); } });
  R.timer = setInterval(updateLive, 500);
  app.render();
}

export async function stopRecording() {
  if (!R.mr || R.busy) return;
  R.busy = true;
  const mr = R.mr;
  const done = new Promise(res => { mr.onstop = res; });
  mr.stop(); stopDictation();
  await done;
  R.stream.getTracks().forEach(tr => tr.stop());
  clearInterval(R.timer);
  const duration = (Date.now() - R.start) / 1000;
  const blob = new Blob(R.chunks, { type: mr.mimeType || 'audio/webm' });
  R.mr = null;
  try {
    const temp = { tab: R.tabId, kind: 'rec', folder: null };
    const mid = await putMedia(blob, t('recDefaultName', { d: fmtTs(R.start) }), blob.type, ownerOf(temp));
    const folder = R.folder || null;
    const status = folder ? recArchivedStatus() : (recStatuses()[0] || '');
    await newItem(R.tabId, 'rec', { name: '', duration, mid, mime: blob.type, transcript: R.transcript.trim(), at: R.start, status }, { folder });
    toast(t('recSaved'));
  } catch (e) { console.error(e); toast(t('recSaveFail'), 4000); }
  R.busy = false;
  app.render();
}

function updateLive() {
  const tm = document.querySelector('.rec-timer'); if (tm) tm.textContent = fmtDur((Date.now() - R.start) / 1000);
  const tr = document.querySelector('.rec-live'); if (tr) tr.textContent = R.transcript || (canLiveTranscribe() && R.live ? t('recListening') : '');
}

export function renderRecordings(view, tab) {
  const recording = !!R.mr;
  const big = h('button', { class: 'rec-big' + (recording ? ' on' : ''), type: 'button', 'aria-label': recording ? t('recStop') : t('recStart'),
    onclick: e => act(e.currentTarget, () => (recording ? stopRecording() : startRecording(tab.id))) }, h('span', { class: 'rec-core' }));
  const liveOk = canLiveTranscribe();
  const liveCb = h('input', { type: 'checkbox', checked: R.live && liveOk, disabled: recording || !liveOk, onchange: e => { R.live = e.target.checked; } });
  view.append(h('div', { class: 'rec-head' },
    big,
    h('div', { class: 'rec-info' },
      h('div', { class: 'rec-state' }, recording ? t('recRecording') : t('recTap')),
      h('div', { class: 'rec-timer' }, recording ? fmtDur((Date.now() - R.start) / 1000) : '0:00'),
      h('label', { class: 'fld-check sm' }, liveCb, h('span', {}, liveOk ? t('recLiveTranscript') : t('recLiveUnavailable'))))),
    );
  if (recording) view.append(h('div', { class: 'rec-live' }, R.transcript || t('recListening')));
  view.append(recFolderRow(tab));
  const list = h('div', { class: 'days' });
  view.append(list);
  const filt = recFilter(tab);
  let items = itemsOf(tab.id);
  if (filt !== 'all') {
    const ids = new Set([filt, ...descendants(filt).filter(i => i.kind === 'folder').map(i => i.id)]);
    items = items.filter(i => ids.has(i.folder));
  }
  const at = it => { const d = dataOf(it); return (d && d.at) || it.created; };
  renderDayGroups(list, items, {
    key: tab.id, empty: t('recEmpty'),
    dateOf: it => isoFromDate(new Date(at(it))),
    summary: arr => h('span', { class: 'day-chips' }, arr.slice().sort((a, b) => at(a) - at(b)).map(it => h('span', { class: 'chip' }, dataOf(it) ? recTitle(dataOf(it)) : '🔒'))),
    renderItem: it => card(it),
  });
}

export async function recStatus(it) {
  const d = dataOf(it); if (!d) return;
  const v = await sheet(t('fRecStatus'), [...recStatuses().map(s => ({ label: s, value: 's:' + s, icon: d.status === s ? '●' : '○' })), { label: t('recEditStatuses'), value: 'edit', icon: '✎' }]);
  if (!v) return;
  if (v === 'edit') {
    const txt = await promptDlg(t('recEditStatuses'), { value: recStatuses().join('\n'), multiline: true, label: t('recStatusesHint') });
    if (!txt) return;
    state.settings.recStatuses = [...new Set(txt.split('\n').map(x => x.trim()).filter(Boolean))];
    await saveSettings(); toast(t('savedOk')); app.render(); return;
  }
  await saveItem(it, { ...d, status: v.slice(2) }); toast(t('savedOk'));
}

export async function renameRec(it) {
  const d = dataOf(it); if (!d) return;
  const nameInp = h('input', { class: 'inp', type: 'text', 'data-test': 'rec-edit-name' });
  nameInp.value = d.name || '';
  const clientF = pickField({ value: d.client || '', list: 'clients', label: t('fClientOrFirm'), test: 'rec-edit-client' });
  const caseF = pickField({ value: d.caseNumber || '', list: 'caseNumbers', label: t('fCaseNumber'), test: 'rec-edit-case' });
  const body = h('div', {},
    h('label', { class: 'fld' }, h('span', {}, t('fName')), nameInp),
    clientF.el,
    caseF.el,
  );
  const ok = await new Promise(res => {
    let done = false;
    const finish = (v, m) => { if (done) return; done = true; res(v); m.close(); };
    const m = openModal({
      title: t('rename'), body,
      actions: [
        { label: t('no'), cls: 'ghost', onClick: m => finish(null, m) },
        { label: t('yes'), cls: 'primary', onClick: m => finish({ name: nameInp.value.trim(), client: clientF.get(), caseNumber: caseF.get() }, m) },
      ],
      onClose: () => { if (!done) res(null); },
    });
    m.el.dataset.test = 'rec-edit';
  });
  if (!ok) return;
  await saveItem(it, { ...d, name: ok.name, client: ok.client, caseNumber: ok.caseNumber });
  toast(t('savedOk'));
}

export async function archiveRec(it) {
  const d = dataOf(it); if (!d) return;
  const folder = await pickFolder({ title: t('archiveIn'), confirmLabel: t('archiveHere') });
  if (!folder) return;
  it.folder = folder.id;
  await saveItem(it, { ...d, status: recArchivedStatus() });
  toast(t('archiveOk', { n: folderNameOf(folder) }));
  app.render();
}
