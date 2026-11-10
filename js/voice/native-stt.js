// Adapter recunoaștere vorbire nativă. Preferă LsoVoice (alegerea motorului
// Google, evită com.google.android.as, dialog RECOGNIZE_SPEECH după eșec).
import { plugin } from './native-cap.js';

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
