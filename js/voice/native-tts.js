// Adapter TTS nativ (Android). Preferă podul propriu LsoVoice (QUEUE_FLUSH,
// timeout de siguranță, ecran de instalare vocilor). Dacă lipsește, folosește
// pluginul Capacitor TextToSpeech, apoi nimic (fallback web în voice.js).
import { plugin } from './native-cap.js';

export function lsoVoice() { return plugin('LsoVoice') || null; }
export function ttsEngine() { return lsoVoice() || plugin('TextToSpeech') || null; }
export function hasNativeTts() { return !!ttsEngine(); }

export async function getVoices() {
  const P = ttsEngine();
  if (!P) return [];
  try {
    const r = await (P.getSupportedVoices ? P.getSupportedVoices() : P.ttsVoices?.());
    return (r && (r.voices || r)) || [];
  } catch { return []; }
}

export async function isLanguageSupported(lang) {
  const P = ttsEngine();
  if (!P) return { hasEngine: false, supported: false };
  if (!P.isLanguageSupported) return { hasEngine: true, supported: null };
  try {
    const r = await P.isLanguageSupported({ lang });
    return { hasEngine: true, supported: !!(r && r.supported) };
  } catch {
    return { hasEngine: false, supported: false };
  }
}

// id: evenimentele „ttsEv” { id, type: start|range|done, s, e } (onRangeStart) pentru bara de sub cuvânt.
export async function speak({ text, lang, rate = 1.25, pitch = 1, volume = 1, voiceName = '', category = 'ambient', queueStrategy = 0, id = '' } = {}) {
  const L = lsoVoice();
  if (L && L.ttsSpeak) {
    await L.ttsSpeak({ text, lang, rate, pitch, voiceName: voiceName || '', id: id || '' });
    return;
  }
  const P = ttsEngine();
  if (!P) throw new Error('no-tts');
  await P.speak({
    text, lang, rate, pitch, volume, category,
    queueStrategy: 0, // QUEUE_FLUSH
    ...(voiceName ? { voiceName } : {}),
  });
}

export async function stop() {
  const P = ttsEngine();
  if (!P) return;
  try { await (P.ttsStop ? P.ttsStop() : P.stop()); } catch {}
}

export function canOpenInstall() {
  const L = lsoVoice();
  if (L && L.ttsInstall) return true;
  return typeof ttsEngine()?.openInstall === 'function';
}

export async function openInstall() {
  const L = lsoVoice();
  if (L && L.ttsInstall) {
    try { await L.ttsInstall(); return true; } catch { return false; }
  }
  const P = ttsEngine();
  if (!P?.openInstall) return false;
  try { await P.openInstall(); return true; } catch { return false; }
}
