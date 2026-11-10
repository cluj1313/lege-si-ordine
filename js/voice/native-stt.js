// Adapter recunoaștere vorbire nativă. Preferă LsoVoice (alegerea motorului
// Google, evită com.google.android.as, dialog RECOGNIZE_SPEECH după eșec).
import { plugin, cap } from './native-cap.js';

export function lsoVoice() { return plugin('LsoVoice') || null; }
export function sttEngine() { return lsoVoice() || plugin('SpeechRecognition') || null; }
export function hasNativeStt() { return !!sttEngine(); }

export async function available() {
  const P = sttEngine();
  if (!P) return false;
  try { const r = await P.available(); return !!(r && r.available); } catch { return false; }
}

export async function ensurePermission() {
  const P = sttEngine();
  if (!P) return false;
  try {
    let perm = await P.checkPermissions();
    const key = perm.speechRecognition != null ? 'speechRecognition' : 'mic';
    if (perm[key] !== 'granted' && perm.speechRecognition !== 'granted') perm = await P.requestPermissions();
    return perm.speechRecognition === 'granted' || perm.mic === 'granted';
  } catch {
    return false;
  }
}

function lastOf(acc, ev) {
  return (ev && (ev.accumulatedText || ev.text || (ev.matches && ev.matches[0])) || acc || '').trim();
}

export async function start({ language, maxResults = 1, partialResults = true, popup = false, onPartial, onState, onError } = {}) {
  const P = sttEngine();
  if (!P) throw new Error('no-stt');
  if (P.removeAllListeners) try { await P.removeAllListeners(); } catch {}

  let last = '';
  const apply = (txt, ev) => {
    last = lastOf(last, { text: txt, ...ev });
    if (onPartial && last) onPartial(last, ev);
  };

  // Rezultat ținut cât WebView e pauzat (dialog RECOGNIZE_SPEECH) și livrat la resume.
  window.__lsoStt = (kind, text) => {
    try {
      if (kind === 'partial' || kind === 'final') apply(text, { text, accumulatedText: text });
      if (kind === 'end' && onState) onState('stopped', { status: 'stopped' });
      if (kind === 'err' && onError) onError(String(text || 'noservice'));
      if (kind === 'final' && !String(text || '').trim() && last && onPartial) onPartial(last, { text: last });
    } catch {}
    return 'ok';
  };

  const handles = [];
  if (P.addListener) {
    handles.push(await P.addListener('partialResults', ev => {
      const txt = lastOf(last, ev);
      if (txt) apply(txt, ev);
    }));
    handles.push(await P.addListener('stt', ev => {
      const kind = ev && ev.kind;
      if (kind === 'partial' || kind === 'final') apply(ev.text, ev);
      if (kind === 'end' && onState) onState('stopped', ev);
      if (kind === 'err' && onError) onError(String(ev.text || ev.kind || 'noservice'));
    }));
    handles.push(await P.addListener('listeningState', ev => { if (onState) onState(ev.status, ev); }));
    handles.push(await P.addListener('sttError', ev => { if (onError) onError(String(ev.text || ev.kind || 'noservice')); }));
  }

  try {
    await P.start({ language, maxResults, partialResults, popup: false });
  } catch (e) {
    const code = (e && (e.message || e.code || e.error)) || 'noservice';
    if (onError) onError(String(code).replace(/^Error: /, ''));
    throw e;
  }
  return handles.filter(Boolean);
}

export async function stop() {
  const P = sttEngine();
  if (!P) return;
  try { await (P.sttStop ? P.sttStop() : P.stop()); } catch {}
  try { await P.removeAllListeners?.(); } catch {}
}

// Transcriere continuă pentru RECORDINGS (LsoVoice.transcribeStart/Stop; recunoașterea se repornește nativ).
export const hasNativeTranscribe = () => !!(lsoVoice() && lsoVoice().transcribeStart);
let trHandle = null;
export async function transcribeStart({ language, onPartial, onFinal, onError } = {}) {
  const P = lsoVoice();
  if (trHandle) { try { await trHandle.remove(); } catch {} trHandle = null; }
  trHandle = await P.addListener('transcribe', ev => {
    const k = ev && ev.kind, txt = String((ev && ev.text) || '').trim();
    if (k === 'partial' && txt) onPartial && onPartial(txt);
    else if (k === 'final') onFinal && onFinal(txt);
    else if (k === 'err') onError && onError(txt || 'noservice');
  });
  await P.transcribeStart({ language });
}
export async function transcribeStop() {
  const P = lsoVoice();
  let last = '';
  try { const r = await P.transcribeStop(); last = String((r && r.last) || '').trim(); } catch {}
  if (trHandle) { try { await trHandle.remove(); } catch {} trHandle = null; }
  return last;
}

// ---- v1.0.7 RECORDINGS: audio MEREU (LsoVoice.recStart/recStop) + transcriere live / ulterioară ----
// Pe Android 13+ recunoașterea primește aceleași eșantioane ca fișierul (EXTRA_AUDIO_SOURCE); altfel ascultă
// microfonul în paralel, iar dacă înregistrarea ar fi afectată, transcrierea live se oprește (audio continuă).
export const hasNativeRec = () => !!(lsoVoice() && lsoVoice().recStart);
export const hasFileTranscribe = () => !!(lsoVoice() && lsoVoice().fileTranscribeStart);
export async function recCaps() { try { return (await lsoVoice().recCaps()) || {}; } catch { return {}; } }
let recHandle = null;
export async function recStart({ language, live, onPartial, onFinal, onMode, onError } = {}) {
  const P = lsoVoice();
  if (recHandle) { try { await recHandle.remove(); } catch {} recHandle = null; }
  recHandle = await P.addListener('transcribe', ev => {
    const k = ev && ev.kind, txt = String((ev && ev.text) || '').trim();
    if (k === 'partial' && txt) onPartial && onPartial(txt);
    else if (k === 'final') onFinal && onFinal(txt);
    else if (k === 'mode') onMode && onMode(txt);
    else if (k === 'err') onError && onError(txt || 'noservice');
  });
  try { return await P.recStart({ language, live: !!live }); }
  catch (e) { try { await recHandle.remove(); } catch {} recHandle = null; throw e; }
}
export async function recStop() {
  let r = {};
  try { r = (await lsoVoice().recStop()) || {}; } catch {}
  if (recHandle) { try { await recHandle.remove(); } catch {} recHandle = null; }
  return r;
}
export async function recOrphans() { try { return ((await lsoVoice().recOrphans()) || {}).files || []; } catch { return []; } }
export async function recDelete(path) { try { await lsoVoice().recDelete({ path }); } catch {} }
// fișierul nativ → Blob (serverul local Capacitor), fără base64 prin punte
export async function fileBlob(path, mime) {
  const C = cap();
  const url = C && C.convertFileSrc ? C.convertFileSrc(path) : path;
  const r = await fetch(url);
  if (!r.ok) throw new Error('fetch ' + r.status);
  const b = await r.blob();
  if (!b.size) throw new Error('empty');
  return mime && b.type !== mime ? new Blob([b], { type: mime }) : b;
}
const b64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
// Blob → fișier temporar nativ (pe bucăți de 512 KB)
export async function blobToNative(blob, name) {
  const P = lsoVoice(); const CH = 512 * 1024; let path = '';
  for (let off = 0; off < blob.size || off === 0; off += CH) {
    const r = await P.tmpWrite({ name, data: await b64(blob.slice(off, off + CH)), append: off > 0 });
    path = r.path;
    if (!blob.size) break;
  }
  return path;
}
let ftHandle = null;
// Transcrie un fișier audio. Întoarce { ok, code }. onFinal primește bucățile finale, onPartial textul provizoriu.
export async function fileTranscribe({ path, language, onPartial, onFinal, onProgress, onMode } = {}) {
  const P = lsoVoice();
  if (ftHandle) { try { await ftHandle.remove(); } catch {} ftHandle = null; }
  let resolve; const done = new Promise(r => { resolve = r; });
  ftHandle = await P.addListener('filetr', ev => {
    const k = ev && ev.kind, txt = String((ev && ev.text) || '').trim();
    if (k === 'partial' && txt) onPartial && onPartial(txt);
    else if (k === 'final') onFinal && onFinal(txt);
    else if (k === 'progress') onProgress && onProgress(Number(ev.p) || 0);
    else if (k === 'mode') onMode && onMode(txt);
    else if (k === 'done') resolve({ ok: true });
    else if (k === 'err') resolve({ ok: false, code: txt || 'noservice' });
  });
  try { await P.fileTranscribeStart({ path, language }); }
  catch (e) { resolve({ ok: false, code: String((e && (e.message || e.code)) || 'noservice').replace(/^Error: /, '') }); }
  const out = await done;
  if (ftHandle) { try { await ftHandle.remove(); } catch {} ftHandle = null; }
  return out;
}
export async function fileTranscribeStop() { try { await lsoVoice().fileTranscribeStop(); } catch {} }
