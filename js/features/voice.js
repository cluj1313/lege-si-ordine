// Voce: citire (speechSynthesis), dictare (Web Speech API) inserată la cursor, alegere limbă/voce.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, saveSettings } from '../core/store.js';
import { toast, sheet, openModal } from '../ui/modal.js';

export const LANGS = [
  ['ro-RO', 'Română'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'], ['es-ES', 'Español'], ['hu-HU', 'Magyar'], ['ru-RU', 'Русский'], ['uk-UA', 'Українська'],
];
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = () => !!SR;
export const canSpeak = () => 'speechSynthesis' in window;

// ---- câmpul țintă pentru dictare (ultimul câmp de text atins) ----
let lastTarget = null;
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.matches && el.matches('textarea, input.voice-target, input[type=text].inp')) lastTarget = el;
});
export const getTarget = () => (lastTarget && document.contains(lastTarget) ? lastTarget : null);
export const setTarget = el => { lastTarget = el; };

// ---- Citire ----
export function voices() { return canSpeak() ? speechSynthesis.getVoices() : []; }
export function isSpeaking() { return canSpeak() && (speechSynthesis.speaking || speechSynthesis.pending); }
export function speak(text) {
  if (!canSpeak()) { toast(t('ttsMissing'), 3500); return false; }
  speechSynthesis.cancel();
  text = String(text || '').trim();
  if (!text) { toast(t('nothingToRead')); return false; }
  const s = state.settings;
  // fragmente scurte: unele motoare Android se opresc la texte lungi
  const chunks = text.match(/[^.!?\n]{1,220}[.!?\n]*|\S+/g) || [text];
  const v = voices().find(x => x.name === s.voiceName);
  chunks.forEach(c => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = v ? v.lang : s.voiceLang; if (v) u.voice = v;
    u.rate = s.voiceRate || 1;
    speechSynthesis.speak(u);
  });
  toast(t('reading'));
  return true;
}
export function stopSpeak() { if (canSpeak()) speechSynthesis.cancel(); }

// ---- Dictare ----
let rec = null, bubble = null;
export const isDictating = () => !!rec;
export function startDictation(target, { lang, onFinal, onEnd, quiet = false } = {}) {
  if (!SR) { if (!quiet) toast(t('dictationMissing'), 4000); return false; }
  if (rec) stopDictation();
  const r = new SR();
  r.lang = lang || state.settings.voiceLang || 'ro-RO';
  r.continuous = true; r.interimResults = true;
  let interim = '';
  if (!quiet) {
    bubble = h('div', { class: 'dict-bubble', role: 'status' }, h('span', { class: 'dict-dot' }), h('span', { class: 'dict-txt' }, t('listening')),
      h('button', { class: 'btn sm', type: 'button', onclick: () => stopDictation() }, t('stop')));
    document.body.append(bubble);
  }
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
    if (bubble) bubble.querySelector('.dict-txt').textContent = interim || t('listening');
  };
  r.onerror = e => { if (!quiet && e.error !== 'no-speech' && e.error !== 'aborted') toast(t('dictationError', { e: e.error }), 3500); };
  r.onend = () => {
    // Android oprește uneori recunoașterea după o pauză: o repornim cât timp utilizatorul nu a oprit
    if (rec === r && r._keep) { try { r.start(); return; } catch {} }
    if (rec === r) rec = null;
    if (bubble) { bubble.remove(); bubble = null; }
    onEnd && onEnd();
  };
  r._keep = true; rec = r;
  try { r.start(); } catch (e) { rec = null; if (bubble) { bubble.remove(); bubble = null; } toast(t('dictationMissing')); return false; }
  return true;
}
export function stopDictation() {
  if (!rec) return;
  const r = rec; r._keep = false;
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

// ---- Alegere limbă și voce (apăsare lungă pe butonul de voce) ----
export async function voiceMenu() {
  const s = state.settings;
  const langSel = h('select', { class: 'inp', 'data-test': 'voice-lang' }, LANGS.map(([v, n]) => h('option', { value: v, selected: v === s.voiceLang }, n)));
  const voiceSel = h('select', { class: 'inp' });
  const fill = () => {
    voiceSel.innerHTML = '';
    voiceSel.append(h('option', { value: '' }, t('voiceAuto')));
    const pre = langSel.value.slice(0, 2);
    voices().filter(v => v.lang.slice(0, 2) === pre).forEach(v => voiceSel.append(h('option', { value: v.name, selected: v.name === s.voiceName }, `${v.name} (${v.lang})`)));
  };
  fill();
  if (canSpeak()) speechSynthesis.onvoiceschanged = fill;
  langSel.addEventListener('change', fill);
  const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.1', value: String(s.voiceRate || 1) });
  const body = h('div', {},
    h('label', { class: 'fld' }, h('span', {}, t('voiceLang')), langSel),
    h('label', { class: 'fld' }, h('span', {}, t('voiceVoice')), voiceSel),
    h('label', { class: 'fld' }, h('span', {}, t('voiceRate')), rate),
    !canSpeak() ? h('p', { class: 'r2-meta' }, t('ttsMissing')) : null,
    !canDictate() ? h('p', { class: 'r2-meta' }, t('dictationMissing')) : null);
  openModal({ title: t('voiceSettings'), body, actions: [
    { label: t('test'), cls: 'ghost', onClick: () => { s.voiceLang = langSel.value; s.voiceName = voiceSel.value; s.voiceRate = +rate.value; speak(t('voiceSample')); } },
    { label: t('save'), cls: 'primary', onClick: async m => { s.voiceLang = langSel.value; s.voiceName = voiceSel.value; s.voiceRate = +rate.value; await saveSettings(); toast(t('savedOk')); m.close(); } },
  ] });
}
