// Voce: citire (TTS nativ pe Android, speechSynthesis pe web) și dictare
// (recunoaștere nativă pe Android, Web Speech API pe web). Limba implicită: ro-RO.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, saveSettings } from '../core/store.js';
import { toast, openModal, confirmDlg } from '../ui/modal.js';
import { pickChoice } from '../ui/pickers.js';
import { isNative } from '../voice/native-cap.js';
import * as nativeTts from '../voice/native-tts.js';
import * as nativeStt from '../voice/native-stt.js';
import { app } from '../ui/registry.js';
import { readScreen, stopReading, isReading } from './reader.js';

export const LANGS = [
  ['ro-RO', 'Română'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'], ['es-ES', 'Español'], ['hu-HU', 'Magyar'], ['ru-RU', 'Русский'], ['uk-UA', 'Українська'],
];

export { isNative };

async function yieldMic() {
  try { if (app.isRecording && app.isRecording()) await app.stopRecording(); } catch {}
}

export function sttErrMsg(code) {
  const c = String(code || '').toLowerCase();
  const key = ['noservice', 'nomatch', 'network', 'busy', 'lang', 'perm'].find(k => c.includes(k));
  return key ? t('sttErr_' + key) : t('dictationError', { e: code || 'err' });
}


const WebSR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const canDictate = () => !!(nativeStt.hasNativeStt() || WebSR);
export const canSpeak = () => !!(nativeTts.hasNativeTts() || (typeof window !== 'undefined' && 'speechSynthesis' in window));

// ---- câmpul țintă pentru dictare (ultimul câmp de text atins) ----
let lastTarget = null;
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.matches && el.matches('textarea, input.voice-target, input[type=text].inp')) lastTarget = el;
});
export const getTarget = () => (lastTarget && document.contains(lastTarget) ? lastTarget : null);
export const setTarget = el => { lastTarget = el; };

// ---- Citire ----
const speakSt = { playing: false, paused: false, index: 0, chunks: [], lang: 'ro-RO', rate: 1, voiceName: '', bubble: null, engine: null };

function chunksOf(text) {
  return String(text).match(/[^.!?\n]{1,220}[.!?\n]*|\S+/g) || [text];
}
function emitSpeak(text) {
  try { window.dispatchEvent(new CustomEvent('lso-speak', { detail: { text } })); } catch {}
  window.__lsoLastSpeak = text;
}

function hideSpeakBubble() {
  if (speakSt.bubble) { speakSt.bubble.remove(); speakSt.bubble = null; }
}
function showSpeakBubble() {
  hideSpeakBubble();
  const pauseBtn = h('button', { class: 'btn sm', type: 'button', 'data-test': 'speak-pause', onclick: () => { if (speakSt.paused) resumeSpeak(); else pauseSpeak(); } }, t('pause'));
  const stopBtn = h('button', { class: 'btn sm', type: 'button', 'data-test': 'speak-stop', onclick: () => stopSpeak() }, t('stop'));
  speakSt.bubble = h('div', { class: 'dict-bubble', role: 'status', 'data-test': 'speak-bubble' },
    h('span', { class: 'dict-dot' }), h('span', { class: 'dict-txt', 'data-role': 'status' }, t('reading')), pauseBtn, stopBtn);
  speakSt._pauseBtn = pauseBtn;
  document.body.append(speakSt.bubble);
}
function setPauseLabel() {
  if (speakSt._pauseBtn) speakSt._pauseBtn.textContent = speakSt.paused ? t('resume') : t('pause');
  const st = speakSt.bubble && speakSt.bubble.querySelector('[data-role=status]');
  if (st) st.textContent = speakSt.paused ? t('speakPaused') : t('reading');
}

export function webVoices() { return ('speechSynthesis' in window) ? speechSynthesis.getVoices() : []; }
export async function nativeVoices() { return nativeTts.getVoices(); }
export async function voices() { return nativeTts.hasNativeTts() ? nativeVoices() : webVoices(); }
export function isSpeaking() {
  if (isReading()) return true;
  if (speakSt.playing && !speakSt.paused) return true;
  if (!nativeTts.hasNativeTts() && 'speechSynthesis' in window) return speechSynthesis.speaking || speechSynthesis.pending;
  return false;
}

async function showTtsHelp({ noEngine = false, noLang = false } = {}) {
  const msg = noEngine ? t('ttsNeedEngine') : t('ttsNeedRo');
  const actions = [
    { label: t('ok'), cls: 'ghost', onClick: m => m.close() },
  ];
  if (nativeTts.canOpenInstall()) actions.unshift({ label: t('ttsOpenInstall'), cls: 'primary', onClick: async m => { await nativeTts.openInstall(); m.close(); } });
  openModal({ title: t('ttsInstallVoice'), body: h('p', { class: 'm-msg' }, msg), actions });
}

async function speakWeb(text, lang, rate, voiceName) {
  if (!('speechSynthesis' in window)) { await showTtsHelp({ noEngine: true }); return false; }
  speechSynthesis.cancel();
  const v = webVoices().find(x => x.name === voiceName);
  const chunks = chunksOf(text);
  speakSt.playing = true; speakSt.paused = false; speakSt.chunks = chunks; speakSt.index = 0; speakSt.engine = 'web';
  showSpeakBubble();
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = v ? v.lang : lang; if (v) u.voice = v;
    u.rate = rate;
    u.onend = () => { if (i === chunks.length - 1 && speakSt.engine === 'web') { speakSt.playing = false; hideSpeakBubble(); } };
    u.onerror = () => { speakSt.playing = false; hideSpeakBubble(); };
    speechSynthesis.speak(u);
  });
  return true;
}

async function speakNative(text, lang, rate, voiceName) {
  const langInfo = await nativeTts.isLanguageSupported(lang);
  let langOk = langInfo.supported !== false, hasEngine = langInfo.hasEngine;
  if (langInfo.supported === null) langOk = true;
  if (!hasEngine) { await showTtsHelp({ noEngine: true }); return false; }
  if (!langOk) {
    // mai verificăm vocile: unele motoare raportează altfel BCP-47
    const vv = await nativeVoices();
    const pre = lang.slice(0, 2);
    langOk = vv.some(x => (x.lang || '').slice(0, 2) === pre);
  }
  if (!langOk) { await showTtsHelp({ noLang: true }); return false; }
  const chunks = chunksOf(text);
  speakSt.playing = true; speakSt.paused = false; speakSt.chunks = chunks; speakSt.index = 0;
  speakSt.lang = lang; speakSt.rate = rate; speakSt.voiceName = voiceName; speakSt.engine = 'native';
  showSpeakBubble();
  await playNativeFrom(0);
  return true;
}

async function playNativeFrom(i) {
  for (let k = i; k < speakSt.chunks.length; k++) {
    if (!speakSt.playing || speakSt.paused || speakSt.engine !== 'native') return;
    speakSt.index = k;
    try {
      await nativeTts.speak({
        text: speakSt.chunks[k],
        lang: speakSt.lang,
        rate: speakSt.rate,
        pitch: 1,
        volume: 1,
        voiceName: speakSt.voiceName,
        category: 'ambient',
        queueStrategy: 1,
      });
    } catch (e) {
      speakSt.playing = false; hideSpeakBubble();
      await showTtsHelp({ noEngine: true });
      return;
    }
  }
  if (speakSt.playing && !speakSt.paused) { speakSt.playing = false; hideSpeakBubble(); }
}

export async function speak(text) {
  text = String(text || '').trim();
  if (!text) { toast(t('nothingToRead')); return false; }
  if (speakSt.playing) { await stopSpeak(); return false; }
  await yieldMic();
  if (isDictating()) await stopDictation();
  emitSpeak(text);
  const s = state.settings;
  const lang = s.voiceLang || 'ro-RO';
  const rate = s.voiceRate == null ? 1.25 : s.voiceRate;
  const voiceName = s.voiceName || '';
  const ok = nativeTts.hasNativeTts() ? await speakNative(text, lang, rate, voiceName) : await speakWeb(text, lang, rate, voiceName);
  return ok;
}

// Citire 📖 din meniul Voce: tot ce se vede pe ecran, cu bara sub cuvântul citit (reader.js, preluat din Notis).
// Al doilea tap pe Citire / pe butonul de voce oprește.
export async function readScreenAloud() {
  if (isReading() || speakSt.playing) { await stopSpeak(); return false; }
  await yieldMic();
  if (isDictating()) await stopDictation();
  return readScreen({
    emit: emitSpeak,
    engineCheck: async opts => {
      if (nativeTts.hasNativeTts()) {
        const info = await nativeTts.isLanguageSupported(opts.lang);
        if (!info.hasEngine) { await showTtsHelp({ noEngine: true }); return null; }
        let ok = info.supported !== false;
        if (!ok) { const vv = await nativeVoices(); ok = vv.some(x => (x.lang || '').slice(0, 2) === opts.lang.slice(0, 2)); }
        if (!ok) { await showTtsHelp({ noLang: true }); return null; }
        return { native: true };
      }
      if (!('speechSynthesis' in window)) { await showTtsHelp({ noEngine: true }); return null; }
      return { native: false, voice: webVoices().find(x => x.name === opts.voiceName) || null };
    },
  });
}

export async function pauseSpeak() {
  if (!speakSt.playing || speakSt.paused) return;
  speakSt.paused = true;
  setPauseLabel();
  if (speakSt.engine === 'native') {
    await nativeTts.stop();
  } else if ('speechSynthesis' in window) {
    try { speechSynthesis.pause(); } catch { speechSynthesis.cancel(); }
  }
}

export async function resumeSpeak() {
  if (!speakSt.playing || !speakSt.paused) return;
  speakSt.paused = false;
  setPauseLabel();
  if (speakSt.engine === 'native') await playNativeFrom(speakSt.index);
  else if ('speechSynthesis' in window) {
    try { speechSynthesis.resume(); } catch { /* re-speak remaining not practical */ }
  }
}

export async function stopSpeak() {
  if (isReading()) await stopReading();
  speakSt.playing = false; speakSt.paused = false;
  hideSpeakBubble();
  if (nativeTts.hasNativeTts()) await nativeTts.stop();
  if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch {} }
}

// ---- Dictare ----
let rec = null, bubble = null, nativeHandles = [];
export const isDictating = () => !!rec;

function showDictBubble() {
  bubble = h('div', { class: 'dict-bubble', role: 'status' }, h('span', { class: 'dict-dot' }), h('span', { class: 'dict-txt' }, t('listening')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => stopDictation() }, t('stop')));
  document.body.append(bubble);
}
function setDictTxt(s) { if (bubble) bubble.querySelector('.dict-txt').textContent = s || t('listening'); }

export async function startDictation(target, { lang, onFinal, onEnd, onInterim, quiet = false, keepRecording = false } = {}) {
  // Transcrierea live din timpul înregistrării folosește același microfon; nu o oprim.
  if (!keepRecording) await yieldMic();
  if (!keepRecording && isSpeaking()) await stopSpeak();
  if (rec) await stopDictation();
  if (nativeStt.hasNativeStt()) return startNativeDictation(target, { lang, onFinal, onEnd, quiet });
  if (!WebSR) { if (!quiet) toast(t('dictationMissing'), 4000); return false; }
  return startWebDictation(target, { lang, onFinal, onEnd, onInterim, quiet });
}

async function startNativeDictation(target, { lang, onFinal, onEnd, quiet }) {
  if (!(await nativeStt.available())) { if (!quiet) toast(t('dictationMissing'), 4000); return false; }
  if (!(await nativeStt.ensurePermission())) { if (!quiet) toast(t('micDenied'), 4000); return false; }

  if (!quiet) showDictBubble();
  rec = { kind: 'native', _keep: true };
  let last = '';
  const applyPartial = txt => {
    if (!txt) return;
    last = txt;
    if (target) {
      const start = rec._start ?? (target.selectionStart ?? target.value.length);
      rec._start = start;
      const after = rec._after ?? target.value.slice(target.selectionEnd ?? start);
      rec._after = after;
      const before = target.value.slice(0, start);
      const sep = before && !/\s$/.test(before) ? ' ' : '';
      target.value = before + sep + txt + after;
      const pos = (before + sep + txt).length;
      try { target.setSelectionRange(pos, pos); } catch {}
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setDictTxt(txt);
  };
  try {
    nativeHandles = await nativeStt.start({
      language: lang || state.settings.voiceLang || 'ro-RO',
      maxResults: 1, partialResults: true, popup: false,
      onPartial: applyPartial,
      onState: status => {
        if (status === 'stopped' && rec && rec.kind === 'native' && rec._keep) rec._keep = false;
      },
      onError: code => { if (!quiet) toast(sttErrMsg(code), 4000); },
    });
  } catch (e) {
    rec = null; if (bubble) { bubble.remove(); bubble = null; }
    if (!quiet) toast(sttErrMsg((e && e.message) || 'noservice'), 4000);
    return false;
  }
  rec._onFinal = onFinal; rec._onEnd = onEnd; rec._last = () => last;
  return true;
}

function startWebDictation(target, { lang, onFinal, onEnd, onInterim, quiet }) {
  const r = new WebSR();
  r.lang = lang || state.settings.voiceLang || 'ro-RO';
  r.continuous = true; r.interimResults = true;
  let interim = '';
  if (!quiet) showDictBubble();
  r.onresult = e => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        const txt = res[0].transcript.trim();
        if (target) insertAtCursor(target, txt);
        onFinal && onFinal(txt);
      } else interim += res[0].transcript;
    }
    setDictTxt(interim || t('listening'));
    onInterim && onInterim(interim);
  };
  r.onerror = e => { if (!quiet && e.error !== 'no-speech' && e.error !== 'aborted') toast(t('dictationError', { e: e.error }), 3500); };
  r.onend = () => {
    if (rec === r && r._keep) { try { r.start(); return; } catch {} }
    if (rec === r) rec = null;
    if (bubble) { bubble.remove(); bubble = null; }
    onEnd && onEnd();
  };
  r._keep = true; rec = r;
  try { r.start(); } catch (e) { rec = null; if (bubble) { bubble.remove(); bubble = null; } toast(t('dictationMissing')); return false; }
  return true;
}

export async function stopDictation() {
  if (!rec) return;
  const r = rec;
  if (r.kind === 'native') {
    r._keep = false;
    const last = r._last ? r._last() : '';
    if (last && r._onFinal) r._onFinal(last);
    await nativeStt.stop();
    nativeHandles = [];
    const end = r._onEnd;
    rec = null;
    if (bubble) { bubble.remove(); bubble = null; }
    end && end();
    return;
  }
  r._keep = false;
  try { r.stop(); } catch {}
  rec = null;
  if (bubble) { bubble.remove(); bubble = null; }
}

export function insertAtCursor(el, txt) {
  if (!txt) return;
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  const ins = sep + txt;
  el.setRangeText(ins, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Transcrierea în timpul înregistrării: pe Android prin transcriere nativă continuă (LsoVoice),
// pe web (Chrome) Web Speech în paralel cu MediaRecorder.
export function canLiveTranscribe() {
  if (isNative()) return nativeStt.hasNativeTranscribe();
  return !!WebSR;
}

// ---- Alegere limbă și voce (apăsare lungă pe butonul de voce) ----
export async function voiceMenu() {
  const s = state.settings;
  const langBtn = h('button', { class: 'inp pick-btn', type: 'button', 'data-test': 'voice-lang' });
  const voiceBtn = h('button', { class: 'inp pick-btn', type: 'button', 'data-test': 'voice-voice' });
  let lang = s.voiceLang || 'ro-RO';
  let voiceName = s.voiceName || '';
  const langLabel = v => (LANGS.find(x => x[0] === v) || [v, v])[1];
  const drawLang = () => { langBtn.textContent = langLabel(lang); };
  let voiceList = [];
  const drawVoice = () => { voiceBtn.textContent = voiceName || t('voiceAuto'); };
  const fillVoices = async () => {
    const all = await voices();
    const pre = lang.slice(0, 2);
    voiceList = all.filter(v => (v.lang || '').slice(0, 2) === pre);
    if (voiceName && !voiceList.some(v => v.name === voiceName)) voiceName = '';
    drawVoice();
  };
  drawLang();
  await fillVoices();
  langBtn.addEventListener('click', async () => {
    const v = await pickChoice({ title: t('voiceLang'), options: LANGS.map(([value, label]) => ({ value, label })), value: lang });
    if (v == null) return;
    lang = v; drawLang(); await fillVoices();
  });
  voiceBtn.addEventListener('click', async () => {
    const opts = [{ value: '', label: t('voiceAuto') }, ...voiceList.map(v => ({ value: v.name, label: `${v.name} (${v.lang})` }))];
    const v = await pickChoice({ title: t('voiceVoice'), options: opts, value: voiceName });
    if (v == null) return;
    voiceName = v; drawVoice();
  });
  const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.1', value: String(s.voiceRate == null ? 1.25 : s.voiceRate) });
  const body = h('div', {},
    h('label', { class: 'fld' }, h('span', {}, t('voiceLang')), langBtn),
    h('label', { class: 'fld' }, h('span', {}, t('voiceVoice')), voiceBtn),
    h('label', { class: 'fld' }, h('span', {}, t('voiceRate')), rate),
    !canSpeak() ? h('p', { class: 'r2-meta' }, t('ttsNeedEngine')) : null,
    !canDictate() ? h('p', { class: 'r2-meta' }, t('dictationMissing')) : null);
  openModal({ title: t('voiceSettings'), body, actions: [
    { label: t('test'), cls: 'ghost', onClick: () => { s.voiceLang = lang; s.voiceName = voiceName; s.voiceRate = +rate.value; speak(t('voiceSample')); } },
    { label: t('save'), cls: 'primary', onClick: async m => { s.voiceLang = lang; s.voiceName = voiceName; s.voiceRate = +rate.value; await saveSettings(); toast(t('savedOk')); m.close(); } },
  ] });
}
