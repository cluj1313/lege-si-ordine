// RECORDINGS 🔴: înregistrare directă (MediaRecorder) cu transcriere live prin dictare, când browserul permite.
import { h, act, fmtDur, fmtTs } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, itemsOf, newItem, putMedia, ownerOf, dataOf, saveItem } from '../core/store.js';
import { toast, promptDlg } from '../ui/modal.js';
import { renderList } from '../ui/list.js';
import { startDictation, stopDictation, canDictate } from '../features/voice.js';
import { app } from '../ui/registry.js';

const R = { mr: null, chunks: [], start: 0, timer: null, transcript: '', live: true, tabId: null, stream: null, busy: false };
export const isRecording = () => !!R.mr;

function pickMime() {
  if (!window.MediaRecorder) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
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
  R.mr.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
  R.mr.start(1000);
  R.busy = false;
  if (R.live && canDictate()) startDictation(null, { quiet: true, onFinal: txt => { R.transcript += (R.transcript ? ' ' : '') + txt; updateLive(); } });
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
    const name = t('recDefaultName', { d: fmtTs(R.start) });
    const temp = { tab: R.tabId, kind: 'rec', folder: null };
    const mid = await putMedia(blob, name, blob.type, ownerOf(temp));
    await newItem(R.tabId, 'rec', { name, duration, mid, mime: blob.type, transcript: R.transcript.trim() });
    toast(t('recSaved'));
  } catch (e) { console.error(e); toast(t('recSaveFail'), 4000); }
  R.busy = false;
  app.render();
}

function updateLive() {
  const tm = document.querySelector('.rec-timer'); if (tm) tm.textContent = fmtDur((Date.now() - R.start) / 1000);
  const tr = document.querySelector('.rec-live'); if (tr) tr.textContent = R.transcript || (canDictate() && R.live ? t('recListening') : '');
}

export function renderRecordings(view, tab) {
  const recording = !!R.mr;
  const big = h('button', { class: 'rec-big' + (recording ? ' on' : ''), type: 'button', 'aria-label': recording ? t('recStop') : t('recStart'),
    onclick: e => act(e.currentTarget, () => (recording ? stopRecording() : startRecording(tab.id))) }, h('span', { class: 'rec-core' }));
  const liveCb = h('input', { type: 'checkbox', checked: R.live, disabled: recording || !canDictate(), onchange: e => { R.live = e.target.checked; } });
  view.append(h('div', { class: 'rec-head' },
    big,
    h('div', { class: 'rec-info' },
      h('div', { class: 'rec-state' }, recording ? t('recRecording') : t('recTap')),
      h('div', { class: 'rec-timer' }, recording ? fmtDur((Date.now() - R.start) / 1000) : '0:00'),
      h('label', { class: 'fld-check sm' }, liveCb, h('span', {}, canDictate() ? t('recLiveTranscript') : t('recNoTranscript'))))),
    );
  if (recording) view.append(h('div', { class: 'rec-live' }, R.transcript || t('recListening')));
  const list = h('div', { class: 'list' });
  view.append(list);
  renderList(list, itemsOf(tab.id), { kind: 'rec', empty: t('recEmpty') });
}

export async function renameRec(it) {
  const d = dataOf(it); if (!d) return;
  const n = await promptDlg(t('rename'), { value: d.name });
  if (n) { await saveItem(it, { ...d, name: n }); toast(t('savedOk')); }
}
