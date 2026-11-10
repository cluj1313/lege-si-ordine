// RECORDINGS 🔴: audio-ul se înregistrează MEREU. Bifa „Transcriere live în timpul înregistrării” (lso_rec_transcribe,
// implicit pusă) adaugă textul live: pe telefon, înregistrarea nativă (LsoVoice.recStart → .aac) trimite aceleași
// eșantioane la recunoaștere (Android 13+, EXTRA_AUDIO_SOURCE); altfel recunoașterea ascultă microfonul în paralel, iar
// dacă ar afecta înregistrarea, doar transcrierea live se oprește. Pe web: MediaRecorder + Web Speech.
// Fiecare înregistrare cu audio are butonul „Transcrie” (transcriere ulterioară a întregului fișier, local pe telefon).
import { h, act, fmtDur, fmtTs } from '../core/util.js';
import { t } from '../core/i18n.js';
import { getMedia, state, itemsOf, newItem, putMedia, ownerOf, dataOf, saveItem, canView, saveUI, saveMeta, descendants, item as getItem, liveTabs } from '../core/store.js';
import { toast, promptDlg, openModal } from '../ui/modal.js';
import { card, sortByTab, extOf } from '../ui/list.js';
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

const R = { on: false, mode: 'audio', live: '', liveOff: false, mr: null, chunks: [], start: 0, timer: null, transcript: '', partial: '', tabId: null, stream: null, busy: false, folder: null };
export const isRecording = () => R.on;
const TR_KEY = 'lso_rec_transcribe';
export const transcribeOn = () => { try { return localStorage.getItem(TR_KEY) !== '0'; } catch { return true; } };
const setTranscribe = on => { try { localStorage.setItem(TR_KEY, on ? '1' : '0'); } catch {} };
const addText = txt => { txt = String(txt || '').trim(); if (txt) R.transcript += (R.transcript ? ' ' : '') + txt; };
const liveText = () => [R.transcript, R.partial].filter(Boolean).join(' ');
const liveBoxText = () => { const x = liveText(); return R.liveOff ? (x ? x + ' — ' : '') + t('recLiveOff') : (x || t('recListening')); };

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
  R.live = ''; R.liveOff = false;
  // Telefon + bifă: înregistrare nativă (audio în fișier) + transcriere live din aceleași eșantioane.
  if (wantText && isNative() && nativeStt.hasNativeRec()) {
    R.busy = true;
    if (!(await nativeStt.ensurePermission())) { R.busy = false; toast(t('micDenied'), 4000); return; }
    try {
      await nativeStt.recStart({
        language: state.settings.voiceLang || 'ro-RO', live: true,
        onPartial: txt => { R.partial = txt; updateLive(); },
        onFinal: txt => { addText(txt || R.partial); R.partial = ''; updateLive(); },
        onMode: m => { R.live = m; },
        onError: code => { R.liveOff = true; R.live = 'off'; updateLive(); if (!/^live-off/.test(code)) console.warn('live', code); },
      });
      R.mode = 'native'; beginCommon(tabId);
      R.busy = false; app.render(); return;
    } catch (e) {
      // nu a pornit înregistrarea nativă: continuăm cu înregistrarea din WebView (audio, fără live)
      R.busy = false; R.liveOff = true;
      console.warn('recStart', e && e.message);
    }
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
  // Pe telefon microfonul e ocupat de înregistrare: textul se obține după, cu „Transcrie”.
  if (wantText && !isNative() && !R.liveOff) {
    const ok = await startDictation(null, { quiet: true, keepRecording: true,
      onInterim: txt => { R.partial = txt; updateLive(); },
      onFinal: txt => { addText(txt); R.partial = ''; updateLive(); } });
    if (!ok) { R.liveOff = true; updateLive(); }
  } else if (wantText) R.liveOff = true;
  app.render();
}

export async function stopRecording() {
  if (!R.on || R.busy) return;
  R.busy = true;
  let duration = (Date.now() - R.start) / 1000;
  clearInterval(R.timer);
  let mid = null, mime = '', pendingFile = '';
  const extra = [];
  const temp = { tab: R.tabId, kind: 'rec', folder: null };
  if (R.mode === 'native') {
    const r = await nativeStt.recStop();
    addText(R.partial || r.last); R.partial = '';
    if (r.seconds > 0) duration = r.seconds;
    const files = Array.isArray(r.files) ? r.files : [];
    for (const [i, f] of files.entries()) {
      try {
        const blob = await nativeStt.fileBlob(f.path, f.mime);
        const id = await putMedia(blob, t('recDefaultName', { d: fmtTs(R.start) }) + extOf(f.mime), f.mime, ownerOf(temp));
        if (i === 0) { mid = id; mime = f.mime; } else extra.push({ mid: id, mime: f.mime, duration: f.duration });
        await nativeStt.recDelete(f.path);
      } catch (e) {
        // fișierul rămâne pe telefon și se atașează automat la următoarea deschidere (nu se pierde)
        console.error(e);
        if (i === 0) pendingFile = f.name;
      }
    }
    if (!files.length) console.warn('recStop: niciun fișier');
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
      mid = await putMedia(blob, t('recDefaultName', { d: fmtTs(R.start) }), blob.type, ownerOf(temp));
      mime = blob.type;
    } catch (e) { console.error(e); }
  }
  R.on = false;
  try {
    if (!mid && !pendingFile) throw new Error('media');
    const folder = R.folder || null;
    const status = folder ? recArchivedStatus() : (recStatuses()[0] || '');
    const data = { name: '', duration, mid, mime, transcript: R.transcript.trim(), at: R.start, status };
    if (pendingFile) data.pendingFile = pendingFile;
    await newItem(R.tabId, 'rec', data, { folder });
    for (const x of extra) await newItem(R.tabId, 'rec', { name: t('recPart2'), duration: x.duration || 0, mid: x.mid, mime: x.mime, transcript: '', at: R.start + 1, status }, { folder });
    toast(pendingFile ? t('recSavedPending') : t('recSaved'), pendingFile ? 4000 : 2400);
  } catch (e) { console.error(e); toast(t('recSaveFail'), 4000); }
  R.busy = false;
  app.render();
}

// Fișiere audio rămase pe telefon (aplicația închisă în timpul înregistrării sau import eșuat): le atașăm / salvăm.
let orphansChecked = false;
export async function recoverOrphans(tab) {
  if (orphansChecked || R.on || !isNative() || !nativeStt.hasNativeRec()) return 0;
  orphansChecked = true;
  const files = await nativeStt.recOrphans();
  let n = 0;
  for (const f of files) {
    try {
      const blob = await nativeStt.fileBlob(f.path, f.mime);
      const host = [...state.items.values()].find(i => i.kind === 'rec' && !i.trashedAt && dataOf(i)?.pendingFile === f.name);
      if (host) {
        const d = dataOf(host);
        const mid = await putMedia(blob, t('recDefaultName', { d: fmtTs(f.at) }) + extOf(f.mime), f.mime, ownerOf(host));
        const nd = { ...d, mid, mime: f.mime, duration: d.duration || f.duration };
        delete nd.pendingFile;
        await saveItem(host, nd);
      } else {
        const temp = { tab: tab.id, kind: 'rec', folder: null };
        const mid = await putMedia(blob, t('recDefaultName', { d: fmtTs(f.at) }) + extOf(f.mime), f.mime, ownerOf(temp));
        await newItem(tab.id, 'rec', { name: t('recRecoveredName'), duration: f.duration || 0, mid, mime: f.mime, transcript: '', at: f.at || Date.now(), status: recStatuses()[0] || '' });
      }
      await nativeStt.recDelete(f.path);
      n++;
    } catch (e) { console.error('orphan', e); }
  }
  if (n) { toast(t('recRecovered', { n }), 4000); app.render(); }
  return n;
}

// „Transcrie”: tot audio-ul din fișierul înregistrării → text (local, pe telefon), apoi corectezi și salvezi.
export async function transcribeRec(it) {
  const d = dataOf(it); if (!d || !d.mid) return;
  if (R.on) { toast(t('recTrBusy'), 3000); return; }
  if (!isNative() || !nativeStt.hasFileTranscribe()) { toast(t('recTrPhoneOnly'), 5000); return; }
  const caps = await nativeStt.recCaps();
  if (caps.inject === false) { toast(t('recTrSdk'), 6000); return; }
  if (!(await nativeStt.ensurePermission())) { toast(t('micDenied'), 4000); return; }
  const status = h('div', { class: 'r2-meta', 'data-test': 'tr-status' }, t('recTrPreparing'));
  const bar = h('div', { class: 'tr-bar' }, h('span', { class: 'tr-fill', style: 'width:0%' }));
  const ta = h('textarea', { class: 'inp', rows: 9, readonly: true, 'data-test': 'tr-text', placeholder: t('recTrPh') });
  const note = h('div', { class: 'r2-meta' }, d.transcript ? t('recTrReplaceNote') : '');
  let text = '', partial = '', running = true, path = '', closed = false;
  const show = () => { if (running) ta.value = [text, partial].filter(Boolean).join(' '); };
  const finishUi = (msg) => {
    running = false;
    status.textContent = msg;
    ta.readOnly = false;
    ta.value = [text, partial].filter(Boolean).join(' ').trim();
    const stopBtn = m.el.querySelector('[data-test=tr-stop]'); if (stopBtn) stopBtn.textContent = t('cancel');
    const saveBtn = m.el.querySelector('[data-test=tr-save]'); if (saveBtn) saveBtn.disabled = false;
  };
  const m = openModal({
    title: t('recTranscribeBtn'), body: h('div', { class: 'tr-box' }, status, bar, ta, note), dismissable: false,
    actions: [
      { label: t('recTrStop'), cls: 'ghost', onClick: async mm => { if (running) { await nativeStt.fileTranscribeStop(); return; } mm.close(); } },
      { label: t('save'), cls: 'primary', onClick: async mm => {
        const cur = dataOf(it) || d;
        await saveItem(it, { ...cur, transcript: ta.value.trim() });
        toast(t('savedOk')); mm.close(); app.render();
      } },
    ],
    onClose: () => { closed = true; if (running) nativeStt.fileTranscribeStop(); },
  });
  m.el.dataset.test = 'tr-modal';
  const [stopB, saveB] = m.el.querySelectorAll('.m-actions .btn');
  stopB.dataset.test = 'tr-stop'; saveB.dataset.test = 'tr-save'; saveB.disabled = true;
  try {
    const media = await getMedia(d.mid);
    if (!media) { finishUi(t('mediaMissing')); return; }
    path = await nativeStt.blobToNative(media.blob, 'tr_' + it.id + extOf(media.mime || d.mime || ''));
    if (closed) return;
    status.textContent = t('recTrRunning');
    const res = await nativeStt.fileTranscribe({
      path, language: state.settings.voiceLang || 'ro-RO',
      onPartial: txt => { partial = txt; show(); },
      onFinal: txt => { txt = String(txt || partial).trim(); partial = ''; if (txt) text += (text ? ' ' : '') + txt; show(); },
      onProgress: p => { bar.firstChild.style.width = Math.round(p * 100) + '%'; status.textContent = t('recTrRunningP', { p: Math.round(p * 100) }); },
    });
    if (res.ok) { bar.firstChild.style.width = '100%'; finishUi(text || partial ? t('recTrDone') : t('recTrEmpty')); }
    else finishUi(trErr(res.code));
  } catch (e) {
    console.error(e); finishUi(trErr('noservice'));
  } finally {
    if (path) nativeStt.recDelete(path);
  }
}
const trErr = code => {
  const c = String(code || '');
  if (c.includes('unsupported')) return t('recTrUnsupported');
  if (c.includes('sdk')) return t('recTrSdk');
  if (c.includes('decode')) return t('recTrDecode');
  return sttErrMsg(c);
};

function updateLive() {
  const tm = document.querySelector('.rec-timer'); if (tm) tm.textContent = fmtDur((Date.now() - R.start) / 1000);
  const tr = document.querySelector('.rec-live'); if (tr) tr.textContent = liveBoxText();
}

export function renderRecordings(view, tab) {
  ensureRecFolders(tab).then(created => { if (created && !R.on) app.render(); });
  if (!orphansChecked) recoverOrphans(tab).catch(e => console.error(e));
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
  if (recording && transcribeOn()) view.append(h('div', { class: 'rec-live' + (R.liveOff ? ' off' : ''), 'data-test': 'rec-live' }, liveBoxText()));
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
