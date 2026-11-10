// Adapter recunoaștere vorbire nativă (Android). Interfața rămâne stabilă
// ca să putem înlocui motorul când avem abordarea confirmată.
import { plugin } from './native-cap.js';

const NAME = 'SpeechRecognition';

export function sttEngine() { return plugin(NAME); }
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
    if (perm.speechRecognition !== 'granted') perm = await P.requestPermissions();
    return perm.speechRecognition === 'granted';
  } catch {
    return false;
  }
}

export async function start({ language, maxResults = 1, partialResults = true, popup = false, onPartial, onState } = {}) {
  const P = sttEngine();
  if (!P) throw new Error('no-stt');
  if (P.removeAllListeners) await P.removeAllListeners();
  const handles = [];
  if (onPartial) {
    handles.push(await P.addListener('partialResults', ev => {
      const txt = (ev.accumulatedText || (ev.matches && ev.matches[0]) || '').trim();
      onPartial(txt, ev);
    }));
  }
  if (onState) {
    handles.push(await P.addListener('listeningState', ev => { onState(ev.status, ev); }));
  }
  await P.start({ language, maxResults, partialResults, popup });
  return handles.filter(Boolean);
}

export async function stop() {
  const P = sttEngine();
  if (!P) return;
  try { await P.stop(); } catch {}
  try { await P.removeAllListeners?.(); } catch {}
}
