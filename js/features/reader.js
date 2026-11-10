// Citire „tot ce se vede pe ecran”, cu bara care se mută sub cuvântul citit (karaoke), preluat din Notis
// (pachetul NOTIS „Citire cu voce”, p01/p02/p05; vezi lege-si-ordine-docs/notis-citire-voce.md):
//  • prepSeg / moveBar / hl / clearSeg (p02) — aici bara e una singură, fixă, poziționată după getBoundingClientRect,
//    ca să nu modificăm structura cardurilor; cuvintele devin span.w (.cur / .past), restaurate la oprire;
//  • scrollFollowWord NEW (p01) în locul scrollIntoView: rândul citit stă în treimea de sus a ferestrei sau a
//    containerului interior cu overflow; derularea manuală suspendă urmărirea ~4 s;
//  • speakBrowserSeg (p05): un segment pe rând, evenimente range/onboundary cu charIndex; fără ele în 700 ms,
//    temporizator după durata estimată a cuvintelor. Pe Android: LsoVoice.ttsSpeak + evenimentul „ttsEv” (onRangeStart).
//  • al doilea tap pe Citire (butonul de voce) oprește. Fără Pauză, ca în Notis.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state } from '../core/store.js';
import { toast } from '../ui/modal.js';
import * as nativeTts from '../voice/native-tts.js';

const R = { on: false, gen: 0, segs: [], wraps: [], mirrors: [], bar: null, active: null, bubble: null, handles: [], stopResolve: null };
export const isReading = () => R.on;

// ---- derulare după cuvânt (NEW din p01) ----
let followPause = 0;
const armFollowPause = () => { if (R.on) followPause = Date.now() + 4000; };
['wheel', 'touchmove'].forEach(ev => document.addEventListener(ev, armFollowPause, { passive: true }));
function scrollParent(el) {
  for (let n = el && el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll' || o === 'overlay') && n.scrollHeight > n.clientHeight + 2) return n;
  }
  return null;
}
const winScroll = { top: 0, until: 0 };
export function scrollFollowWord(el, opts = {}) {
  if (!el || !el.getBoundingClientRect || opts.paused) return;
  const r = el.getBoundingClientRect(), third = opts.third != null ? opts.third : 1 / 3, smooth = opts.smooth !== false;
  const sc = scrollParent(el);
  if (sc) {
    const cr = sc.getBoundingClientRect();
    // poziția față de unde AJUNGE derularea lină în curs (nu o repornim la fiecare cuvânt)
    const base = sc._rdUntil > Date.now() ? sc._rdTop : sc.scrollTop;
    const off = r.top - cr.top + sc.scrollTop - base; // poziția cuvântului în fereastra containerului, după derulare
    const clipped = off < 8 || off + r.height > cr.height - 8;
    const delta = off - cr.height * third;
    // urcă doar înainte (nu tragem textul înapoi când citirea e încă în treimea de sus)
    if (clipped || delta > cr.height * 0.05) {
      const top = Math.max(0, base + delta);
      sc._rdTop = top; sc._rdUntil = Date.now() + 450;
      if (smooth && sc.scrollTo) sc.scrollTo({ top, behavior: 'smooth' }); else sc.scrollTop = top;
    }
    // containerul interior trebuie să se vadă întreg (deasupra bulei de jos): îl urcăm și pe el, lin, sus pe ecran
    const vr = sc.getBoundingClientRect(), vh = window.innerHeight;
    if (vr.bottom > vh - 130 || vr.top < 56) {
      const outer = scrollParent(sc);
      const want = Math.min(vr.height + 140 > vh ? 56 : vh - 130 - vr.height, vh * 0.25);
      const d = vr.top - Math.max(56, want);
      if (Math.abs(d) > 4) {
        if (outer) outer.scrollTo({ top: outer.scrollTop + d, behavior: smooth ? 'smooth' : 'auto' });
        else window.scrollTo({ top: (window.pageYOffset || 0) + d, behavior: smooth ? 'smooth' : 'auto' });
      }
    }
  } else {
    const vh = window.innerHeight, cur = window.pageYOffset || document.documentElement.scrollTop;
    const base = winScroll.until > Date.now() ? winScroll.top : cur;
    const off = r.top + cur - base, delta = off - vh * third;
    if (off < 8 || off + r.height > vh - 8 || delta > vh * 0.08) {
      const y = Math.max(0, base + delta);
      winScroll.top = y; winScroll.until = Date.now() + 450;
      if (smooth) window.scrollTo({ top: y, behavior: 'smooth' }); else window.scrollTo(0, y);
    }
  }
}

// ---- bara și cuvintele (p02, adaptat) ----
function ensureBar() {
  if (!R.bar || !R.bar.isConnected) { R.bar = h('span', { class: 'kbar', 'data-test': 'kbar', 'aria-hidden': 'true' }); document.body.append(R.bar); }
  return R.bar;
}
function moveBar(span, instant) {
  const b = ensureBar();
  if (!span || !span.isConnected) { b.classList.remove('show'); return; }
  const r = span.getBoundingClientRect();
  if (instant) b.style.transition = 'none';
  b.style.width = Math.max(6, r.width) + 'px';
  b.style.transform = `translate(${Math.round(r.left)}px,${Math.round(r.bottom + 1)}px)`;
  b.classList.toggle('show', r.bottom > 0 && r.top < window.innerHeight);
  if (instant) { void b.offsetWidth; b.style.transition = ''; }
}
function hl(seg, i) {
  if (!seg || !R.on) return;
  if (R.active !== seg) { if (R.active) R.active.words.forEach(w => w.span && w.span.classList.replace('cur', 'past')); R.active = seg; seg.cur = -1; }
  if (i === seg.cur || i < 0 || i >= seg.words.length) return;
  seg.cur = i;
  seg.words.forEach((w, j) => { if (w.span) { w.span.classList.toggle('cur', j === i); w.span.classList.toggle('past', j < i); } });
  const sp = seg.words[i].span;
  moveBar(sp, false);
  scrollFollowWord(sp, { paused: Date.now() < followPause });
  // după derularea lină, bara urmează cuvântul
  setTimeout(() => { if (R.active === seg && seg.cur === i) moveBar(sp, true); }, 380);
}
const reflow = () => { if (R.on && R.active && R.active.cur >= 0) moveBar(R.active.words[R.active.cur].span, true); };
window.addEventListener('resize', reflow);
document.addEventListener('scroll', reflow, { passive: true, capture: true });

// ---- extracția textului de pe ecran ----
const SKIP = 'button, select, script, style, svg, audio, video, canvas, .kbar, .fab, #fabs, .dict-bubble, .toast, [aria-hidden="true"], .chev, .sel-box, .rec-big, .lock-ic, input[type=checkbox], input[type=radio]';
const hasWord = s => /[\p{L}\p{N}]/u.test(s);
function isShown(el) {
  if (!el || !el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
}
function blockOf(node) {
  for (let n = node.parentElement; n; n = n.parentElement) {
    const d = getComputedStyle(n).display;
    if (!/^inline/.test(d) && d !== 'contents') return n;
  }
  return document.body;
}
// Ecranul curent: ultimul dialog/pagină deschisă, altfel lista tabului (#view).
function screenRoot() {
  const ovs = [...document.querySelectorAll('#modals .m-overlay')].filter(o => !o.classList.contains('closing'));
  const top = ovs[ovs.length - 1];
  if (top) { const box = top.querySelector('.m-box'); if (box && !box.classList.contains('m-sheet')) return box; }
  return document.querySelector('#view');
}
// Câmpurile de text (editorul unui document): o „oglindă” peste câmp, cu aceleași dimensiuni și font, care se poate
// derula în interior; la oprire dispare și câmpul rămâne neatins.
function mirrorOf(field) {
  const cs = getComputedStyle(field);
  const m = h('div', { class: 'rd-mirror' + (field.tagName === 'TEXTAREA' ? ' ta' : ''), 'data-test': 'rd-mirror' });
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRadius', 'textAlign'])
    m.style[k] = cs[k];
  // gazda = părintele direct, poziționat relativ, ca oglinda să se deruleze odată cu formularul
  const host = field.parentElement;
  if (getComputedStyle(host).position === 'static') { host.dataset.rdPos = '1'; host.style.position = 'relative'; }
  m.style.width = field.offsetWidth + 'px';
  m.style.height = field.offsetHeight + 'px';
  m.style.left = field.offsetLeft + 'px';
  m.style.top = field.offsetTop + 'px';
  m.textContent = field.value;
  host.append(m);
  m.scrollTop = field.scrollTop;
  R.mirrors.push({ m, host });
  return m;
}
function collect(root) {
  const fields = [...root.querySelectorAll('textarea, input:not([type]), input[type=text], input[type=search]')].filter(f => isShown(f) && hasWord(f.value || '') && !f.closest(SKIP));
  if (root !== document.querySelector('#view') && fields.length) fields.forEach(mirrorOf);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      const p = n.parentElement;
      if (!p || !hasWord(n.nodeValue) || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      if (p.closest('label') && R.mirrors.length && !p.closest('.rd-mirror')) return NodeFilter.FILTER_REJECT; // în editor: doar conținutul câmpurilor
      return isShown(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  if (R.mirrors.length) { const mset = new Set(R.mirrors.map(x => x.m)); for (let i = nodes.length - 1; i >= 0; i--) if (![...mset].some(m => m.contains(nodes[i]))) nodes.splice(i, 1); }
  // cuvintele: fiecare nod text devine span.rd-wrap cu span.w pe cuvinte
  const blocks = [];
  let curBlock = null, cur = null;
  for (const n of nodes) {
    const b = blockOf(n);
    if (b !== curBlock) { curBlock = b; cur = { el: b, words: [], cur: -1 }; blocks.push(cur); }
    const text = n.nodeValue;
    const wrap = document.createElement('span'); wrap.className = 'rd-wrap kw';
    const re = /\S+/g; let m, last = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) wrap.append(text.slice(last, m.index));
      const sp = document.createElement('span'); sp.className = 'w'; sp.textContent = m[0];
      wrap.append(sp);
      if (hasWord(m[0])) cur.words.push({ w: m[0].replace(/[▾▴🔒🔓⏰●]/gu, ''), span: sp });
      last = re.lastIndex;
    }
    if (last < text.length) wrap.append(text.slice(last));
    R.wraps.push({ wrap, orig: text });
    n.replaceWith(wrap);
  }
  // segmente de cel mult ~220 de caractere, tăiate la final de propoziție când se poate
  const segs = [];
  for (const b of blocks) {
    let s = null;
    b.words.forEach((w, i) => {
      if (!s) { s = { el: b.el, words: [], cur: -1 }; segs.push(s); }
      s.words.push(w);
      const len = s.words.reduce((a, x) => a + x.w.length + 1, 0);
      if ((len > 160 && /[.!?;:]$/.test(w.w)) || len > 220) s = null;
    });
  }
  segs.forEach(s => { let pos = 0; s.text = s.words.map(w => { w.s = pos; w.e = pos + w.w.length; pos = w.e + 1; return w.w; }).join(' '); });
  return segs.filter(s => s.words.length);
}
function restore() {
  for (const { wrap, orig } of R.wraps) { try { if (wrap.isConnected) wrap.replaceWith(document.createTextNode(orig)); } catch {} }
  for (const { m, host } of R.mirrors) { m.remove(); if (host.dataset.rdPos) { host.style.position = ''; delete host.dataset.rdPos; } }
  R.wraps = []; R.mirrors = []; R.active = null;
  if (R.bar) R.bar.classList.remove('show');
}
// primul segment vizibil: citirea începe de acolo și continuă până la final
function firstVisible(segs) {
  const top = (document.querySelector('#hdr, header')?.getBoundingClientRect().bottom) || 0;
  const i = segs.findIndex(s => { const sp = s.words[s.words.length - 1].span; const r = sp.getBoundingClientRect(); const sc = scrollParent(sp); const ct = sc ? Math.max(top, sc.getBoundingClientRect().top) : top; return r.bottom > ct + 2; });
  return i < 0 ? 0 : i;
}

// ---- motoarele (p05) ----
const wordMs = (w, rate) => Math.max(180, (70 * Math.min(14, w.length) + 140) / (rate || 1));
function speakSeg(seg, gen, opts) {
  return new Promise(resolve => {
    if (gen !== R.gen) { resolve(); return; }
    const rate = opts.rate;
    let got = false, started = false, done = false, timer = null, est = 0;
    seg.words.forEach(w => { est += wordMs(w.w, rate); });
    const fin = () => { if (done) return; done = true; clearTimeout(timer); clearTimeout(safety); resolve(); };
    const run = i => { if (gen !== R.gen || got || done || i >= seg.words.length) return; hl(seg, i); timer = setTimeout(() => run(i + 1), wordMs(seg.words[i].w, rate)); };
    const onStart = () => { if (started || gen !== R.gen) return; started = true; hl(seg, 0); setTimeout(() => { if (!got && !done && gen === R.gen) run(Math.max(0, seg.cur)); }, 700); };
    const onRange = ci => { if (gen !== R.gen) return; if (!got) { got = true; clearTimeout(timer); } let k = 0; while (k < seg.words.length - 1 && ci >= seg.words[k].e) k++; hl(seg, k); };
    const safety = setTimeout(fin, est * 2.5 + 8000);
    R.stopResolve = fin;
    if (opts.native) {
      const id = 'r' + gen + '_' + Math.random().toString(36).slice(2, 8);
      R.ttsId = id; R.onTts = ev => { if (!ev || ev.id !== id) return; if (ev.type === 'start') onStart(); else if (ev.type === 'range') onRange(+ev.s || 0); };
      nativeTts.speak({ text: seg.text, lang: opts.lang, rate, pitch: 1, voiceName: opts.voiceName, id }).then(fin, () => { opts.failed = true; fin(); });
      setTimeout(() => { if (!started && !done && gen === R.gen) onStart(); }, 1200);
    } else {
      const u = new SpeechSynthesisUtterance(seg.text);
      const v = opts.voice; u.lang = v ? v.lang : opts.lang; if (v) u.voice = v;
      u.rate = rate;
      u.onstart = onStart;
      u.onboundary = e => { if (e.name && e.name !== 'word') return; onRange(e.charIndex || 0); };
      u.onend = u.onerror = fin;
      speechSynthesis.speak(u);
      setTimeout(() => { if (!started && !done && gen === R.gen && speechSynthesis.speaking) onStart(); }, 1200);
    }
  });
}

function showBubble() {
  hideBubble();
  R.bubble = h('div', { class: 'dict-bubble', role: 'status', 'data-test': 'speak-bubble' },
    h('span', { class: 'dict-dot' }), h('span', { class: 'dict-txt' }, t('reading')),
    h('button', { class: 'btn sm', type: 'button', 'data-test': 'speak-stop', onclick: () => stopReading() }, t('stop')));
  document.body.append(R.bubble);
}
function hideBubble() { if (R.bubble) { R.bubble.remove(); R.bubble = null; } }

export async function stopReading() {
  if (!R.on) return;
  R.on = false; R.gen++;
  hideBubble();
  try { if (R.stopResolve) R.stopResolve(); } catch {}
  if (nativeTts.hasNativeTts()) await nativeTts.stop();
  if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch {} }
  for (const hd of R.handles) { try { await hd.remove(); } catch {} }
  R.handles = [];
  restore();
  document.body.classList.remove('reading');
}

/**
 * Citește ce e pe ecran (lista tabului sau documentul deschis), de la primul element vizibil până la final.
 * engineCheck(text) → { native, voice } sau null dacă nu se poate citi (mesajul a fost deja arătat).
 */
export async function readScreen({ engineCheck, emit } = {}) {
  if (R.on) { await stopReading(); return false; }
  const root = screenRoot();
  if (!root) { toast(t('nothingToRead')); return false; }
  const segs = collect(root);
  if (!segs.length) { restore(); toast(t('nothingToRead')); return false; }
  const start = firstVisible(segs);
  const text = segs.slice(start).map(s => s.text).join('.\n');
  if (emit) emit(text);
  const s = state.settings;
  const opts = { lang: s.voiceLang || 'ro-RO', rate: s.voiceRate == null ? 1.25 : s.voiceRate, voiceName: s.voiceName || '' };
  const eng = engineCheck ? await engineCheck(opts) : null;
  if (!eng) { restore(); return false; }
  Object.assign(opts, eng);
  R.on = true; R.gen++; R.segs = segs; followPause = 0;
  const gen = R.gen;
  document.body.classList.add('reading');
  showBubble();
  if (opts.native) {
    const L = nativeTts.lsoVoice();
    if (L && L.addListener) { try { R.handles.push(await L.addListener('ttsEv', ev => R.onTts && R.onTts(ev))); } catch {} }
  } else { try { speechSynthesis.cancel(); } catch {} }
  for (let i = start; i < segs.length; i++) {
    if (gen !== R.gen) return true;
    await speakSeg(segs[i], gen, opts);
    if (opts.failed) { toast(t('ttsMissing'), 4000); break; }
  }
  if (gen === R.gen) await stopReading();
  return true;
}
