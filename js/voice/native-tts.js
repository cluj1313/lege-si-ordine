// Adapter TTS nativ (Android). Interfața rămâne stabilă ca să putem
// înlocui motorul când avem abordarea confirmată (plugin, interogări, fallback).
import { plugin } from './native-cap.js';

const NAME = 'TextToSpeech';

export function ttsEngine() { return plugin(NAME); }
export function hasNativeTts() { return !!ttsEngine(); }

export async function getVoices() {
  const P = ttsEngine();
  if (!P) return [];
  try { const r = await P.getSupportedVoices(); return r.voices || []; } catch { return []; }
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

export async function speak({ text, lang, rate = 1, pitch = 1, volume = 1, voiceName = '', category = 'ambient', queueStrategy = 1 } = {}) {
  const P = ttsEngine();
  if (!P) throw new Error('no-tts');
  await P.speak({
    text, lang, rate, pitch, volume, category, queueStrategy,
    ...(voiceName ? { voiceName } : {}),
  });
}

export async function stop() {
  const P = ttsEngine();
  if (!P) return;
  try { await P.stop(); } catch {}
}

export function canOpenInstall() { return typeof ttsEngine()?.openInstall === 'function'; }

export async function openInstall() {
  const P = ttsEngine();
  if (!P?.openInstall) return false;
  try { await P.openInstall(); return true; } catch { return false; }
}
