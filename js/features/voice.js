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

function speechRecCtor() {
  return (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
}

export const canDictate = () => !!(nativeStt.hasNativeStt() || speechRecCtor());
export const canSpeak = () => !!(nativeTts.hasNativeStt ? nativeTts.hasNativeTts() : (nativeTts.hasNativeTts() || (typeof window !== 'undefined' && 'speechSynthesis' in window)));

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

// Alege automat cea mai bună voce românească disponibilă dacă utilizatorul nu a ales una explicită
function pickBestVoice(list, lang, preferredName) {
  if (!Array.isArray(list) || !list.length) return null;
  if (preferredName) {
    const exact = list.find(v => v.name === preferredName);
    if (exact) return exact;
  }
  const pre = String(lang || 'ro-RO').slice(0, 2).toLowerCase();
  const matching = list.filter(v => String(v.lang || '').toLowerCase().startsWith(pre));
  if (!matching.length) return null;
  return (
    matching.find(v => /mihai|ioana|ro-ro-x|google|natural|neural|online/i.test(v.name || '')) ||
    matching.find(v => !/network/i.test(v.name || '')) ||
    matching[0]
  );
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
  const v = pickBestVoice(webVoices(), lang, voiceName);
  const chunks = chunksOf(text);
  speakSt.playing = true; speakSt.paused = false; speakSt.chunks = chunks; speakSt.index = 0; speakSt.engine = 'web';
  showSpeakBubble();
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = v ? v.lang : lang;
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = 1;
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
  const vv = await nativeVoices();
  if (!langOk) {
    const pre = lang.slice(0, 2);
    langOk = vv.some(x => (x.lang || '').slice(0, 2) === pre);
  }
  if (!langOk) { await showTtsHelp({ noLang: true }); return false; }
  const chosen = pickBestVoice(vv, lang, voiceName);
  const chunks = chunksOf(text);
  speakSt.playing = true; speakSt.paused = false; speakSt.chunks = chunks; speakSt.index = 0;
  speakSt.lang = chosen?.lang || lang;
  speakSt.rate = rate;
  speakSt.voiceName = chosen?.name || voiceName || '';
  speakSt.engine = 'native';
  showSpeakBubble();
  await playNativeFrom(0);
  return true;
}

async function playNativeFrom(i) {
  for (let k = i; k < speakSt.chunks.length; k++) {
    if (!speakSt.playing || speakSt.paused || speakSt.engine !== 'native') return;
    speakSt.index = k;
    try {
      const payload = {
        text: speakSt.chunks[k],
        lang: speakSt.lang,
        rate: speakSt.rate,
        pitch: 1,
        volume: 1,
        category: 'ambient',
        queueStrategy: 1,
      };
      if (speakSt.voiceName) payload.voiceName = speakSt.voiceName;
      await nativeTts.speak(payload);
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
  const rate = s.voiceRate == null ? 1.0 : s.voiceRate;
  const voiceName = s.voiceName || '';
  const ok = nativeTts.hasNativeTts() ? await speakNative(text, lang, rate, voiceName) : await speakWeb(text, lang, rate, voiceName);
  return ok;
}

export async function readScreenAloud(arg) {
  if (isReading() || speakSt.playing) { await stopSpeak(); return false; }
  await yieldMic();
  if (isDictating()) await stopDictation();
  const opts = !arg ? {} : (typeof arg === 'string' ? { text: arg } : arg);
  return readScreen({
    root: opts.root,
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
      return { native: false, voice: pickBestVoice(webVoices(), opts.lang, opts.voiceName) || null };
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
    try { speechSynthesis.resume(); } catch {}
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

let _dictIdleObs = null;
let _suppressIdle = false;
let capitalizeNext = false;
let lowercaseNext = false;
let pauseTimer = null;

function hideDictUi() {
  clearTimeout(pauseTimer);
  if (_dictIdleObs) { try { _dictIdleObs.disconnect(); } catch {} _dictIdleObs = null; }
  const p = document.getElementById('punct-pill');
  if (p) p.remove();
  bubble = null;
  document.body.classList.remove('dictating');
  detachViewportGuard();
  clearActivePunct();
  const el = getTarget && getTarget();
  if (el && el.style) { el.style.paddingBottom = ''; delete el.dataset.lsoPad; }
}

function showDictIdleBar(target) {
  if (_suppressIdle || rec) return;
  const el = target || (getTarget && getTarget());
  if (!el || !el.isConnected) return;
  hideDictUi();
  const bar = h('div', { class: 'punct-pill dict-idle', id: 'punct-pill', 'data-test': 'dict-bar' });
  const go = h('button', { type: 'button', class: 'dict-start', 'data-test': 'dict-start' }, '🎙 Dictează');
  go.addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    startDictation(el);
  });
  bar.append(go);

  // Dacă suntem într-un editor sau în Temporar, oferim și buton direct de Salvare lângă Dictează
  const modalSave = el.closest('.modal')?.querySelector('.m-actions .btn.primary');
  const tempSave = el.closest('.quick-bar')?.querySelector('[data-action="save-temp"]');
  const saveTarget = modalSave || tempSave;
  if (saveTarget) {
    const saveBtn = h('button', { type: 'button', class: 'dict-save-btn', 'data-test': 'dict-save' }, '✓ Salvează');
    saveBtn.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      hideDictUi();
      saveTarget.click();
    });
    bar.append(saveBtn);
  }

  document.body.append(bar);
  if (typeof placeDictBar === 'function') placeDictBar();
  const idleCheck = () => {
    if (!el.isConnected) { hideDictUi(); return; }
    const mods = document.getElementById('modals');
    if (!mods) return;
    for (const child of mods.children) {
      if (child.contains(el)) continue;
      if (child.querySelector('.m-overlay, .m-drawer, .m-box, .m-sheet')) { hideDictUi(); return; }
    }
  };
  _dictIdleObs = new MutationObserver(idleCheck);
  _dictIdleObs.observe(document.body, { childList: true, subtree: true });
}

function showDictBubble() {
  hideDictUi();
  const marks = ['-', '+', ',', '.', 'Enter'];
  const btns = marks.map(p => {
    const b = h('button', { type: 'button', class: 'punct-btn', 'data-punct': p, onpointerdown: e => e.preventDefault() }, p === 'Enter' ? '↵' : p);
    b.addEventListener('click', e => {
      e.preventDefault();
      const target = getTarget && getTarget();
      if (target) insertPunctuation(target, p, b);
    });
    return b;
  });
  bubble = h('div', { class: 'punct-pill', id: 'punct-pill', 'data-test': 'dict-bar', role: 'status' },
    h('span', { class: 'dict-dot', 'aria-hidden': 'true' }),
    h('button', { class: 'dict-stop', type: 'button', 'data-test': 'dict-stop', onpointerdown: e => e.preventDefault(), onclick: () => stopDictation() }, t('stop')),
    ...btns);
  document.body.append(bubble);
  document.body.classList.add('dictating');
  attachViewportGuard();
  placeDictBar();
  revealDictCaret(getTarget && getTarget());
}

function removePunctPill() { hideDictUi(); }
function setDictTxt() {}

let activePunctBtn = null;
function clearActivePunct() {
  document.querySelectorAll('.punct-btn.on').forEach(b => b.classList.remove('on'));
  activePunctBtn = null;
}
function markPunctActive(btn) {
  clearActivePunct();
  if (!btn) return;
  btn.classList.add('on', 'flash');
  activePunctBtn = btn;
  setTimeout(() => btn.classList.remove('flash'), 220);
}

let vvGuards = [];
function attachViewportGuard() {
  detachViewportGuard();
  const on = () => { placeDictBar(); revealDictCaret(getTarget && getTarget()); };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', on);
    window.visualViewport.addEventListener('scroll', on);
    vvGuards.push(['vv', on]);
  }
  window.addEventListener('resize', on);
  vvGuards.push(['win', on]);
}
function detachViewportGuard() {
  for (const [k, on] of vvGuards) {
    if (k === 'vv' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', on);
      window.visualViewport.removeEventListener('scroll', on);
    } else window.removeEventListener('resize', on);
  }
  vvGuards = [];
}

function placeDictBar() {
  const bar = document.getElementById('punct-pill');
  if (!bar) return;
  const vv = window.visualViewport;
  const gap = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
  bar.style.bottom = 'calc(' + Math.max(8, gap + 8) + 'px + env(safe-area-inset-bottom, 0px))';
}

function dictObstructionTop() {
  const vv = window.visualViewport;
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const bar = document.getElementById('punct-pill');
  const barTop = bar ? bar.getBoundingClientRect().top : viewBottom;
  return Math.min(viewBottom, barTop) - 8;
}

function caretClientRect(el) {
  if (!el) return null;
  const pos = el.selectionStart ?? (el.value || '').length;
  if (el.nodeName !== 'TEXTAREA' && el.nodeName !== 'INPUT') return el.getBoundingClientRect();
  const div = document.createElement('div');
  const s = getComputedStyle(el);
  ['boxSizing','fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','textAlign','width','wordSpacing','whiteSpace','wordWrap','overflowWrap'].forEach(p => { div.style[p] = s[p]; });
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.overflow = 'hidden';
  div.style.left = '0';
  div.style.top = '0';
  div.style.width = s.width;
  div.textContent = (el.value || '').slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  div.append(marker);
  document.body.append(div);
  const er = el.getBoundingClientRect(), dr = div.getBoundingClientRect(), mr = marker.getBoundingClientRect();
  const top = er.top - el.scrollTop + (mr.top - dr.top);
  const height = mr.height || parseFloat(s.lineHeight) || 20;
  div.remove();
  return { top, bottom: top + height, height };
}

function revealDictCaret(el) {
  if (!el || !document.body.classList.contains('dictating')) return;
  const bar = document.getElementById('punct-pill');
  const pad = Math.round((bar ? bar.getBoundingClientRect().height : 52) + 16);
  if (el.style && el.style.paddingBottom !== pad + 'px') el.style.paddingBottom = pad + 'px';
  const r = caretClientRect(el);
  if (!r) return;
  const limit = dictObstructionTop();
  const delta = r.bottom - limit;
  if (delta > 0 && el.scrollHeight > el.clientHeight + 2) el.scrollTop += delta;
  const sc = el.closest('.m-body') || el.closest('.m-page');
  const r2 = caretClientRect(el);
  if (sc && r2 && r2.bottom > limit) sc.scrollTop += r2.bottom - limit;
}

const SPOKEN_PUNCT = [
  [/semnul\s+întreb[aă]rii/gi, '?'],
  [/semnul\s+intrebarii/gi, '?'],
  [/semnul\s+exclam[aă]rii/gi, '!'],
  [/punct\s+[sș]i\s+virgul[aă]/gi, ';'],
  [/dou[aă]\s+puncte/gi, ':'],
  [/linie\s+nou[aă]/gi, '\n'],
  [/r[aâ]nd\s+nou/gi, '\n'],
  [/alineat\s+nou/gi, '\n'],
  [/\bquestion\s+mark\b/gi, '?'],
  [/\bexclamation\s+mark\b/gi, '!'],
  [/\bfull\s+stop\b/gi, '.'],
  [/\bnew\s+line\b/gi, '\n'],
  [/\bvirgule?\b/gi, ','],
  [/\bvirgul[aă]\b/gi, ','],
  [/\bpunct\b/gi, '.'],
  [/\bcomma\b/gi, ','],
  [/\bperiod\b/gi, '.'],
  [/\bcolon\b/gi, ':'],
  [/\bsemicolon\b/gi, ';'],
];

export function applySpokenPunct(txt) {
  let s = String(txt || '');
  for (const [re, ch] of SPOKEN_PUNCT) s = s.replace(re, ch);
  // Curăță spațiile înaintea semnelor de punctuație
  s = s.replace(/\s+([.,;:!?])/g, '$1');
  // După virgulă în interiorul textului, următorul cuvânt rămâne cu literă mică
  s = s.replace(/,\s+([A-ZĂÎÂȘȚ])(?=[a-zăîâșț])/g, (_, ch) => ', ' + ch.toLowerCase());
  // După punct (.), semn de întrebare (?) sau exclamare (!), trecem pe alineat nou
  s = s.replace(/([.!?])\s+(?=[^\s\n])/g, '$1\n');
  s = s.replace(/([,;:])(?!\s|$|\n)/g, '$1 ');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
}

function foldWords(s) {
  const t = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.replace(/ș|ş/g, 's').replace(/ț|ţ/g, 't')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}

function leftoverTranscript(base, incoming) {
  const raw = String(incoming || '').trim();
  if (!raw) return '';
  const bw = foldWords(base), tw = foldWords(raw);
  let n = 0;
  for (let k = Math.min(bw.length, tw.length); k > 0; k--) {
    if (bw.slice(-k).join(' ') === tw.slice(0, k).join(' ')) { n = k; break; }
  }
  if (!n) return raw;
  const parts = raw.trim().match(/\S+|\s+/g) || [];
  let left = n, out = [];
  for (const tok of parts) {
    if (/^\s+$/.test(tok)) { if (left <= 0) out.push(tok); continue; }
    if (left > 0) { left--; continue; }
    out.push(tok);
  }
  return out.join('').trim();
}

function isCumulativeOf(base, incoming) {
  const bw = foldWords(base), iw = foldWords(incoming);
  if (!iw.length) return false;
  const b = bw.join(' '), i = iw.join(' ');
  if (!b) return false;
  return i === b || i.startsWith(b) || b.endsWith(i) || b.startsWith(i);
}

function isPrefixPhrase(base, incoming) {
  const b = foldWords(base).join(' '), i = foldWords(incoming).join(' ');
  return !!i && (b === i || b.startsWith(i + ' '));
}

function schedulePauseNewline(el, st) {
  clearTimeout(pauseTimer);
  if (!el || el.nodeName !== 'TEXTAREA') return;
  pauseTimer = setTimeout(() => {
    if (!rec || !el || !el.isConnected) return;
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    if (!before.trim() || /\n\s*$/.test(before)) return;
    const after = el.value.slice(pos);
    let prefix = before.replace(/[ \t]+$/, '');
    if (!/[.!?]$/.test(prefix)) prefix += '.';
    prefix += '\n';
    st.applying = true;
    el.value = prefix + after;
    const newPos = prefix.length;
    try { el.setSelectionRange(newPos, newPos); } catch {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    st.applying = false;
    st.start = newPos;
    st.after = after;
    st.lastChunk = '';
    capitalizeNext = true;
    lowercaseNext = false;
    revealDictCaret(el);
  }, 1900);
}

function bindDictationField(el) {
  const st = { el, start: 0, after: '', applying: false, lastChunk: '' };
  const snap = () => {
    if (!el) return;
    const pos = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? pos;
    st.start = pos;
    st.after = el.value.slice(end);
    st.lastChunk = '';
  };
  const onInput = () => { if (!st.applying) snap(); };
  if (el) { snap(); el.addEventListener('input', onInput); }
  const detach = () => { clearTimeout(pauseTimer); if (el) el.removeEventListener('input', onInput); };
  const write = (chunk, commit, opts = {}) => {
    if (!el) return;
    clearTimeout(pauseTimer);
    const incoming = applySpokenPunct(chunk);
    if (!incoming) return;
    const before = el.value.slice(0, st.start);
    if (commit && incoming && isPrefixPhrase(before, incoming) && !(opts.newResult && foldWords(incoming).length === 1)) return;
    let use = leftoverTranscript(before, incoming);
    if (commit && !use && incoming) {
      if (opts.newResult && !isCumulativeOf(before, incoming)) use = incoming;
      else return;
    }
    if (!commit && !use) {
      el.value = before + afterSafe();
      try { el.setSelectionRange(before.length, before.length); } catch {}
      st.lastChunk = '';
      return;
    }
    // După virgulă (,), următorul cuvânt pornește cu literă mică
    if (use && (lowercaseNext || /,\s*$/.test(before))) {
      use = use.charAt(0).toLowerCase() + use.slice(1);
      if (commit) lowercaseNext = false;
    } else if (use && (capitalizeNext || !before.trim() || /[.!?\n]\s*$/.test(before))) {
      // După punct (.), alineat nou sau la început, pornește cu literă mare
      use = use.charAt(0).toUpperCase() + use.slice(1);
      if (commit) capitalizeNext = false;
    }
    // Dacă bucata dictată se termină cu punct, trecem automat pe alineat nou
    if (commit && /[.!?]$/.test(use) && el.nodeName === 'TEXTAREA') {
      use = use + '\n';
      capitalizeNext = true;
    }
    const sep = use && before && !/[\s\n]$/.test(before) && !/^[\s.,;:!?\n]/.test(use) ? ' ' : '';
    st.applying = true;
    el.value = before + sep + use + afterSafe();
    const pos = (before + sep + use).length;
    try { el.setSelectionRange(pos, pos); } catch {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    st.applying = false;
    st.lastChunk = use;
    if (commit) {
      st.start = pos;
      st.after = el.value.slice(pos);
      st.lastChunk = '';
      schedulePauseNewline(el, st);
    }
    clearActivePunct();
    revealDictCaret(el);
  };
  function afterSafe() { return st.after; }
  return {
    snap,
    flushInterim: () => {
      if (!el) return;
      const pos = el.selectionStart ?? el.value.length;
      st.start = pos;
      st.after = el.value.slice(pos);
      st.lastChunk = '';
    },
    paint: chunk => write(chunk, false),
    commit: (chunk, opts) => write(chunk, true, opts || {}),
    detach,
  };
}

export async function startDictation(target, { lang, onFinal, onEnd, onInterim, quiet = false, keepRecording = false } = {}) {
  if (!keepRecording) await yieldMic();
  if (!keepRecording && isSpeaking()) await stopSpeak();
  _suppressIdle = true;
  try { await stopDictation(); } finally { _suppressIdle = false; }
  if (nativeStt.hasNativeStt()) {
    await new Promise(r => setTimeout(r, 150));
    let ok = await startNativeDictation(target, { lang, onFinal, onEnd, quiet });
    if (!ok) {
      await new Promise(r => setTimeout(r, 250));
      ok = await startNativeDictation(target, { lang, onFinal, onEnd, quiet });
    }
    return ok;
  }
  if (!speechRecCtor()) { if (!quiet) toast(t('dictationMissing'), 4000); return false; }
  return startWebDictation(target, { lang, onFinal, onEnd, onInterim, quiet });
}

async function startNativeDictation(target, { lang, onFinal, onEnd, quiet }) {
  if (!(await nativeStt.available())) { if (!quiet) toast(t('dictationMissing'), 4000); return false; }
  if (!(await nativeStt.ensurePermission())) { if (!quiet) toast(t('micDenied'), 4000); return false; }

  if (!quiet) showDictBubble();
  const field = bindDictationField(target);
  const stateObj = { kind: 'native', _keep: true, _field: field, _onFinal: onFinal, _onEnd: onEnd, _last: () => last };
  rec = stateObj;
  let last = '';
  let lastFinal = '';
  let finalized = false;

  const applyPartial = (txt, ev) => {
    if (!txt) return;
    last = txt;
    const isFinal = !!(ev && (ev.kind === 'final' || ev.isFinal));
    if (!target) return;
    if (!isFinal) {
      field.paint(txt);
      finalized = false;
      return;
    }
    if (finalized && lastFinal && isCumulativeOf(lastFinal, txt) && !leftoverTranscript(lastFinal, txt)) return;
    const piece = leftoverTranscript(lastFinal, txt);
    if (!piece && lastFinal && isCumulativeOf(lastFinal, txt)) { finalized = true; return; }
    field.commit(piece || txt, { newResult: !piece && !isCumulativeOf(lastFinal, txt) });
    lastFinal = piece ? (lastFinal ? lastFinal + ' ' + piece : piece) : txt;
    finalized = true;
  };

  const runSession = async () => {
    last = '';
    lastFinal = '';
    finalized = false;
    nativeHandles = await nativeStt.start({
      language: lang || state.settings.voiceLang || 'ro-RO',
      maxResults: 1, partialResults: true, popup: false,
      onPartial: applyPartial,
      onState: status => {
        if (status !== 'stopped') return;
        if (target && last && !finalized) {
          field.commit(last);
          lastFinal = last;
          finalized = true;
        }
        if (rec === stateObj && stateObj._keep) {
          setTimeout(() => {
            if (rec === stateObj && stateObj._keep) {
              runSession().catch(() => {});
            }
          }, 140);
        }
      },
      onError: code => {
        const c = String(code || '').toLowerCase();
        if (rec === stateObj && stateObj._keep && (c.includes('nomatch') || c.includes('no-speech'))) {
          setTimeout(() => {
            if (rec === stateObj && stateObj._keep) runSession().catch(() => {});
          }, 160);
          return;
        }
        if (!quiet) toast(sttErrMsg(code), 4000);
      },
    });
  };

  try {
    await runSession();
  } catch (e) {
    rec = null; field.detach(); if (bubble) { bubble.remove(); bubble = null; }
    removePunctPill();
    if (!quiet) toast(sttErrMsg((e && e.message) || 'noservice'), 4000);
    return false;
  }
  return true;
}

function startWebDictation(target, { lang, onFinal, onEnd, onInterim, quiet }) {
  const Ctor = speechRecCtor();
  if (!Ctor) { if (!quiet) toast(t('dictationMissing'), 4000); return false; }
  const r = new Ctor();
  r.lang = lang || state.settings.voiceLang || 'ro-RO';
  r.continuous = true; r.interimResults = true;
  let interim = '';
  let nextIndex = 0;
  const seen = [];
  const field = bindDictationField(target);
  r._field = field;
  if (!quiet) showDictBubble();
  r.onresult = e => {
    interim = '';
    const results = e.results;
    const len = results.length;
    const from = Math.max(0, e.resultIndex | 0);
    if (len < nextIndex) nextIndex = from;
    if (len < seen.length) seen.length = len;
    for (let i = from; i < len; i++) {
      const res = results[i];
      const txt = (res[0] && res[0].transcript || '').trim();
      if (!txt) { if (res.isFinal && i >= nextIndex) nextIndex = i + 1; continue; }
      if (res.isFinal) {
        const prev = seen[i] || '';
        if (prev && (txt === prev || leftoverTranscript(prev, txt) === '')) {
          nextIndex = Math.max(nextIndex, i + 1);
          continue;
        }
        let piece = txt;
        let newResult = i >= nextIndex && !prev;
        if (prev && leftoverTranscript(prev, txt)) {
          piece = leftoverTranscript(prev, txt);
          newResult = false;
        }
        seen[i] = txt;
        if (target) field.commit(piece, { newResult });
        onFinal && onFinal(piece);
        nextIndex = Math.max(nextIndex, i + 1);
      } else if (i >= nextIndex || !seen[i]) {
        interim += (interim ? ' ' : '') + txt;
      }
    }
    if (interim && target) field.paint(interim);
    else if (!interim && target) field.paint('');
    onInterim && onInterim(interim);
  };
  r.onerror = e => { if (!quiet && e.error !== 'no-speech' && e.error !== 'aborted') toast(t('dictationError', { e: e.error }), 3500); };
  r.onend = () => {
    if (rec === r && r._keep) { try { r.start(); return; } catch {} }
    field.detach();
    if (rec === r) rec = null;
    if (rec == null) { hideDictUi(); showDictIdleBar(target); }
    onEnd && onEnd();
  };
  r._keep = true; rec = r;
  try { r.start(); } catch (e) { rec = null; field.detach(); if (bubble) { bubble.remove(); bubble = null; }
  removePunctPill(); toast(t('dictationMissing')); return false; }
  return true;
}

export async function stopDictation() {
  const r = rec;
  rec = null;
  try {
    if (r && r.kind === 'native') {
      r._keep = false;
      const last = r._last ? r._last() : '';
      if (last && r._onFinal) { try { r._onFinal(last); } catch {} }
      if (r._field) { try { r._field.detach(); } catch {} }
      const end = r._onEnd;
      try { await nativeStt.stop(); } catch {}
      nativeHandles = [];
      hideDictUi();
      try { end && end(); } catch {}
      return;
    }
    if (r) {
      r._keep = false;
      if (r._field) { try { r._field.detach(); } catch {} }
      try { if (typeof r.abort === 'function') r.abort(); else r.stop(); } catch { try { r.stop(); } catch {} }
    }
    try { await nativeStt.stop(); } catch {}
    nativeHandles = [];
  } finally {
    rec = null;
    nativeHandles = [];
    hideDictUi();
    showDictIdleBar(getTarget && getTarget());
  }
}

export function insertAtCursor(el, txt, { forceCapital = false } = {}) {
  if (!txt) return;
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  let before = el.value.slice(0, start);
  if (lowercaseNext || /,\s*$/.test(before)) {
    txt = txt.charAt(0).toLowerCase() + txt.slice(1);
    lowercaseNext = false;
  } else if (forceCapital || capitalizeNext || /[.!?\n]\s*$/.test(before) || !before.trim()) {
    txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    capitalizeNext = false;
  }
  const sep = before && !/[\s\n]$/.test(before) ? ' ' : '';
  const ins = sep + txt;
  el.setRangeText(ins, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertPunctuation(el, punct, btn) {
  if (!el) return;
  if (rec && rec._field && typeof rec._field.flushInterim === 'function') {
    rec._field.flushInterim();
  }
  let start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  if ((punct === ',' || punct === '.') && start > 0 && el.value[start - 1] === ' ') {
    el.setRangeText('', start - 1, start, 'end');
    start -= 1;
  }
  let ins = punct;
  const isEnter = punct === 'Enter';
  if (isEnter) {
    ins = '\n';
    capitalizeNext = true;
    lowercaseNext = false;
  } else if (punct === '.') {
    ins = el.nodeName === 'TEXTAREA' ? '.\n' : '. ';
    capitalizeNext = true;
    lowercaseNext = false;
  } else if (punct === ',') {
    ins = ', ';
    lowercaseNext = true;
    capitalizeNext = false;
  } else if (punct === '-' || punct === '+') {
    ins = ' ' + punct + ' ';
  }
  el.setRangeText(ins, start, Math.max(start, end), 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  markPunctActive(btn || document.querySelector('.punct-btn[data-punct="' + punct + '"]'));
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
  revealDictCaret(el);
}

export function canLiveTranscribe() {
  if (isNative()) return nativeStt.hasNativeTranscribe();
  return !!speechRecCtor();
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
  const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.1', value: String(s.voiceRate == null ? 1.0 : s.voiceRate) });
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
