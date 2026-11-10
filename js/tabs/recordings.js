// RECORDINGS 🔴: înregistrare directă (MediaRecorder). Bifa „Transcrie în text tot ce este audio” (lso_rec_transcribe):
// pe Android, recunoașterea vorbirii nativă continuă ține microfonul (un singur utilizator permis) și scrie textul live;
// pe web, MediaRecorder + Web Speech în paralel. Nebifat: doar audio, ca înainte.
import { h, act, fmtDur, fmtTs } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, itemsOf, newItem, putMedia, ownerOf, dataOf, saveItem, canView, saveUI, saveMeta, descendants, item as getItem, liveTabs } from '../core/store.js';
import { toast, promptDlg, openModal } from '../ui/modal.js';
import { card, sortByTab } from '../ui/list.js';
import { renderDayGroups } from '../ui/daygroups.js';
import { recName, recTitle, recStatuses, recArchivedStatus } from './kinds.js';
import { sheet } from '../ui/modal.js';
import { saveSettings } from '../core/store.js';
import { pickFolder, folderNameOf, recFoldersOf, ensureRecFolders, createRecFolder } from '../ui/folderpick.js';
import { pillRow, visibilitySheet, mergeOrder } from '../ui/pillrow.js';
import { folderMenu } from './views.js';
import { isoFromDate } from '../core/util.js';
import { startDictation, stopDictation, isSpeaking, stopSpeak, isDictating, isNative, sttErrMsg } from '../features/voice.js';
import * as nativeStt from '../voice/native-stt.js';
import { pickField } from '../ui/pickers.js';
import { app } from '../ui/registry.js';

const R = { on: false, mode: 'audio', mr: null, chunks: [], start: 0, timer: null, transcript: '', partial: '', tabId: null, stream: null, busy: false, folder: null };
export const isRecording = () => R.on;
const TR_KEY = 'lso_rec_transcribe';
export const transcribeOn = () => { try { return localStorage.getItem(TR_KEY) === '1'; } catch { return false; } };
const setTranscribe = on => { try { localStorage.setItem(TR_KEY, on ? '1' : '0'); } catch {} };
const addText = txt => { txt = String(txt || '').trim(); if (txt) R.transcript += (R.transcript ? ' ' : '') + txt; };
const liveText = () => [R.transcript, R.partial].filter(Boolean).join(' ');

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
  const roots = recFoldersOf(tab);
  const cur = recFilter(tab);
  const all = itemsOf(tab.id).filter(i => i.kind === 'rec');
  const items = [
    { id: 'all', name: t('catAll'), fixed: true, count: all.length },
    ...roots.filter(f => !f.hidden).map(f => ({ id: f.id, name: folderNameOf(f), count: recsOfFolder(f.id).length, locked: !!f.lock })),
  ];
  const active = roots.some(f => f.id === cur && !f.hidden) ? cur : 'all';
  return pillRow({
    items, activeId: active, test: 'rec-folder-row',
    onPick: c => {
      state.ui.sub[tab.id] = c.id;
      if (R.on) R.folder = c.id === 'all' ? null : c.id;
      saveUI(); app.render();
    },
    onAdd: async () => {
      const f = await createRecFolder(tab, null);
      if (f) { state.ui.sub[tab.id] = f.id; if (R.on) R.folder = f.id; await saveUI(); app.render(); }
    },
    onReorder: async ids => { const all = mergeOrder(roots, ids); for (const [i, f] of all.entries()) { f.order = i; await saveMeta(f); } },
    onManage: () => visibilitySheet(t('manageVisible'), roots.map(f => ({ id: f.id, name: folderNameOf(f), visible: !f.hidden })), async out => {
      for (const [i, o] of out.entries()) { const f = getItem(o.id); f.order = i; f.hidden = !o.visible; await saveMeta(f); }
      if (active !== 'all' && getItem(active)?.hidden) state.ui.sub[tab.id] = 'all';
      app.render();
    }),
    onItemMenu: c => folderMenu(tab, getItem(c.id)),
  });
}

function beginCommon(tabId) {
  R.transcript = ''; R.partial = ''; R.start = Date.now(); R.tabId = tabId; R.on = true;
  const recTab = liveTabs().find(x => x.id === tabId);
  const pref = recTab ? recFilter(recTab) : 'all';
  R.folder = pref !== 'all' ? pref : null;
  R.timer = setInterval(updateLive, 500);
}

export async function startRecording(tabId) {
  if (R.on || R.busy) return;
  if (isSpeaking()) await stopSpeak();
  if (isDictating()) await stopDictation();
  const wantText = transcribeOn();
  // Telefon + bifă: transcriere nativă continuă (textul are prioritate față de fișierul audio).
  if (wantText && isNative() && nativeStt.hasNativeTranscribe()) {
    R.busy = true;
    if (!(await nativeStt.ensurePermission())) { R.busy = false; toast(t('micDenied'), 4000); return; }
    R.mode = 'text'; beginCommon(tabId);
    try {
      await nativeStt.transcribeStart({
        language: state.settings.voiceLang || 'ro-RO',
        onPartial: txt => { R.partial = txt; updateLive(); },
        onFinal: txt => { addText(txt || R.partial); R.partial = ''; updateLive(); },
        onError: code => toast(sttErrMsg(code), 4000),
      });
    } catch (e) {
      clearInterval(R.timer); R.on = false; R.busy = false;
      toast(sttErrMsg((e && e.message) || 'noservice'), 4000); app.render(); return;
    }
    R.busy = false; app.render(); return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast(t('recMissing'), 4000); return; }
  R.busy = true;
  try {
    R.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { R.busy = false; toast(t('micDenied'), 4000); return; }
  const mime = pickMime();
  R.mr = new MediaRecorder(R.stream, mime ? { mimeType: mime } : undefined);
  R.chunks = []; R.mode = 'audio';
  R.mr.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
  R.mr.start(1000);
  beginCommon(tabId);
  R.busy = false;
  if (wantText) {
    const ok = await startDictation(null, { quiet: true, keepRecording: true,
      onInterim: txt => { R.partial = txt; updateLive(); },
      onFinal: txt => { addText(txt); R.partial = ''; updateLive(); } });
    if (!ok) toast(t('dictationMissing'), 4000);
  }
  app.render();
}

export async function stopRecording() {
  if (!R.on || R.busy) return;
  R.busy = true;
  const duration = (Date.now() - R.start) / 1000;
  clearInterval(R.timer);
  let mid = null, mime = '';
  if (R.mode === 'text') {
    const last = await nativeStt.transcribeStop();
    addText(R.partial || last); R.partial = '';
  } else {
    const mr = R.mr;
    const done = new Promise(res => { mr.onstop = res; });
    mr.stop(); await stopDictation();
    await done;
    addText(R.partial); R.partial = '';
    R.stream.getTracks().forEach(tr => tr.stop());
    const blob = new Blob(R.chunks, { type: mr.mimeType || 'audio/webm' });
    R.mr = null;
    try {
      const temp = { tab: R.tabId, kind: 'rec', folder: null };
      mid = await putMedia(blob, t('recDefaultName', { d: fmtTs(R.start) }), blob.type, ownerOf(temp));
      mime = blob.type;
    } catch (e) { console.error(e); }
  }
  R.on = false;
  try {
    if (R.mode === 'audio' && !mid) throw new Error('media');
    const folder = R.folder || null;
    const status = folder ? recArchivedStatus() : (recStatuses()[0] || '');
    await newItem(R.tabId, 'rec', { name: '', duration, mid, mime, transcript: R.transcript.trim(), at: R.start, status }, { folder });
    toast(t('recSaved'));
  } catch (e) { console.error(e); toast(t('recSaveFail'), 4000); }
  R.busy = false;
  app.render();
}

function updateLive() {
  const tm = document.querySelector('.rec-timer'); if (tm) tm.textContent = fmtDur((Date.now() - R.start) / 1000);
  const tr = document.querySelector('.rec-live'); if (tr) tr.textContent = liveText() || t('recListening');
}

export function renderRecordings(view, tab) {
  ensureRecFolders(tab).then(created => { if (created && !R.on) app.render(); });
  const recording = R.on;
  const big = h('button', { class: 'rec-big' + (recording ? ' on' : ''), type: 'button', 'aria-label': recording ? t('recStop') : t('recStart'),
    onclick: e => act(e.currentTarget, () => (recording ? stopRecording() : startRecording(tab.id))) }, h('span', { class: 'rec-core' }));
  const liveCb = h('input', { type: 'checkbox', 'data-test': 'rec-transcribe', checked: transcribeOn(), disabled: recording, onchange: e => setTranscribe(e.target.checked) });
  view.append(h('div', { class: 'rec-head' },
    big,
    h('div', { class: 'rec-info' },
      h('div', { class: 'rec-state' }, recording ? t('recRecording') : t('recTap')),
      h('div', { class: 'rec-timer' }, recording ? fmtDur((Date.now() - R.start) / 1000) : '0:00'),
      h('label', { class: 'fld-check sm' }, liveCb, h('span', {}, t('recLiveTranscript'))))),
    );
  if (recording && transcribeOn()) view.append(h('div', { class: 'rec-live', 'data-test': 'rec-live' }, liveText() || t('recListening')));
  view.append(recFolderRow(tab));
  const list = h('div', { class: 'days' });
  view.append(list);
  const filt = recFilter(tab);
  let items = itemsOf(tab.id).filter(i => i.kind === 'rec');
  if (filt !== 'all') {
    const ids = new Set([filt, ...descendants(filt).filter(i => i.kind === 'folder').map(i => i.id)]);
    items = items.filter(i => ids.has(i.folder));
  }
  const at = it => { const d = dataOf(it); return (d && d.at) || it.created; };
  if (filt !== 'all') {
    const qWrap = h('div', { class: 'rec-folder-search' });
    const q = h('input', { class: 'inp', type: 'search', placeholder: t('archiveSearchPh'), 'data-test': 'archive-search', value: state.ui.recSearch || '' });
    const apply = () => {
      const needle = (q.value || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      state.ui.recSearch = q.value;
      const hit = it => {
        if (!needle) return true;
        const d = dataOf(it) || {};
        const blob = [d.name, d.client, d.caseNumber, d.transcript, d.status].filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        return blob.includes(needle);
      };
      const shown = needle ? items.filter(hit) : items;
      list.innerHTML = '';
      renderDayGroups(list, shown, {
        key: tab.id, empty: needle ? t('noRecHits') : t('recEmpty'),
        dateOf: it => isoFromDate(new Date(at(it))),
        summary: arr => h('span', { class: 'day-chips' }, arr.slice().sort((a, b) => at(a) - at(b)).map(it => h('span', { class: 'chip' }, dataOf(it) ? recTitle(dataOf(it)) : '🔒'))),
        renderItem: it => card(it), order: arr => sortByTab(arr, tab.id),
      });
    };
    q.addEventListener('input', apply);
    qWrap.append(q);
    view.insertBefore(qWrap, list);
    // first draw happens below, then apply if query
    setTimeout(() => { if (q.value) apply(); }, 0);
  }
  renderDayGroups(list, items, {
    key: tab.id, empty: t('recEmpty'),
    dateOf: it => isoFromDate(new Date(at(it))),
    summary: arr => h('span', { class: 'day-chips' }, arr.slice().sort((a, b) => at(a) - at(b)).map(it => h('span', { class: 'chip' }, dataOf(it) ? recTitle(dataOf(it)) : '🔒'))),
    renderItem: it => card(it), order: arr => sortByTab(arr, tab.id),
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
  const recTab = liveTabs().find(x => x.id === it.tab) || liveTabs().find(x => x.kind === 'rec');
  const folder = await pickFolder({ title: t('archiveIn'), confirmLabel: t('archiveHere'), tab: recTab });
  if (!folder) return;
  it.folder = folder.id;
  await saveItem(it, { ...d, status: recArchivedStatus() });
  toast(t('archiveOk', { n: folderNameOf(folder) }));
  app.render();
}
