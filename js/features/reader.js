// Citire „tot ce se vede pe ecran”, cu bara aurie care alunecă fluid sub cuvântul citit.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state } from '../core/store.js';
import { toast } from '../ui/modal.js';
import * as nativeTts from '../voice/native-tts.js';

const R = {
  on: false,
  gen: 0,
  segs: [],
  wraps: [],
  mirrors: [],
  bar: null,
  active: null,
  bubble: null,
  handles: [],
  stopResolve: null,
  trackRaf: 0,
  trackUntil: 0,
};

export const isReading = () => R.on;

let followPause = 0;
let lastLineTop = null;

const armFollowPause = () => {
  if (R.on) followPause = Date.now() + 4000;
};
['wheel', 'touchmove'].forEach(ev =>
  document.addEventListener(ev, armFollowPause, { passive: true })
);

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
  const r = el.getBoundingClientRect();
  if (
    lastLineTop !== null &&
    Math.abs(r.top - lastLineTop) < 6 &&
    r.top >= 56 &&
    r.bottom <= window.innerHeight - 110
  ) {
    return;
  }
  lastLineTop = r.top;

  const third = opts.third != null ? opts.third : 1 / 3;
  const smooth = opts.smooth !== false;
  const sc = scrollParent(el);

  if (sc) {
    const cr = sc.getBoundingClientRect();
    const base = sc._rdUntil > Date.now() ? sc._rdTop : sc.scrollTop;
    const off = r.top - cr.top + sc.scrollTop - base;
    const clipped = off < 8 || off + r.height > cr.height - 8;
    const delta = off - cr.height * third;

    if (clipped || delta > cr.height * 0.05) {
      const top = Math.max(0, base + delta);
      sc._rdTop = top;
      sc._rdUntil = Date.now() + 450;
      if (smooth && sc.scrollTo) sc.scrollTo({ top, behavior: 'smooth' });
      else sc.scrollTop = top;
      startBarTracking(460);
    }

    const vr = sc.getBoundingClientRect();
    const vh = window.innerHeight;
    if (vr.bottom > vh - 130 || vr.top < 56) {
      const outer = scrollParent(sc);
      const want = Math.min(vr.height + 140 > vh ? 56 : vh - 130 - vr.height, vh * 0.25);
      const d = vr.top - Math.max(56, want);
      if (Math.abs(d) > 4) {
        if (outer) outer.scrollTo({ top: outer.scrollTop + d, behavior: smooth ? 'smooth' : 'auto' });
        else window.scrollTo({ top: (window.pageYOffset || 0) + d, behavior: smooth ? 'smooth' : 'auto' });
        startBarTracking(460);
      }
    }
  } else {
    const vh = window.innerHeight;
    const cur = window.pageYOffset || document.documentElement.scrollTop;
    const base = winScroll.until > Date.now() ? winScroll.top : cur;
    const off = r.top + cur - base;
    const delta = off - vh * third;

    if (off < 8 || off + r.height > vh - 8 || delta > vh * 0.08) {
      const y = Math.max(0, base + delta);
      winScroll.top = y;
      winScroll.until = Date.now() + 450;
      if (smooth) window.scrollTo({ top: y, behavior: 'smooth' });
      else window.scrollTo(0, y);
      startBarTracking(460);
    }
  }
}

function ensureBar() {
  if (!R.bar || !R.bar.isConnected) {
    R.bar = h('span', { class: 'kbar', 'data-test': 'kbar', 'aria-hidden': 'true' });
    document.body.append(R.bar);
  }
  return R.bar;
}

function moveBar(span, instant) {
  const b = ensureBar();
  if (!span || !span.isConnected) {
    b.classList.remove('show');
    return;
  }
  const r = span.getBoundingClientRect();
  if (instant) b.style.transition = 'none';
  b.style.width = Math.max(6, Math.round(r.width)) + 'px';
  b.style.transform = `translate3d(${Math.round(r.left)}px, ${Math.round(r.bottom + 1)}px, 0)`;
  b.classList.toggle('show', r.bottom > 0 && r.top < window.innerHeight);
  if (instant) {
    void b.offsetWidth;
    b.style.transition = '';
  }
}

function startBarTracking(durationMs = 450) {
  R.trackUntil = Math.max(R.trackUntil, Date.now() + durationMs);
  if (R.trackRaf) return;
  const tick = () => {
    R.trackRaf = 0;
    if (!R.on || !R.active || R.active.cur < 0) return;
    const sp = R.active.words[R.active.cur]?.span;
    if (sp) moveBar(sp, true);
    if (Date.now() < R.trackUntil) {
      R.trackRaf = requestAnimationFrame(tick);
    }
  };
  R.trackRaf = requestAnimationFrame(tick);
}

function hl(seg, i) {
  if (!seg || !R.on) return;
  if (R.active !== seg) {
    if (R.active) {
      R.active.words.forEach(w => {
        if (w.span) {
          w.span.classList.remove('cur');
          w.span.classList.add('past');
        }
      });
    }
    R.active = seg;
    seg.cur = -1;
    lastLineTop = null;
  }
  if (i === seg.cur || i < 0 || i >= seg.words.length) return;
  seg.cur = i;
  for (let j = 0; j < seg.words.length; j++) {
    const sp = seg.words[j].span;
    if (!sp) continue;
    sp.classList.toggle('cur', j === i);
    sp.classList.toggle('past', j < i);
  }
  const sp = seg.words[i].span;
  moveBar(sp, false);
  scrollFollowWord(sp, { paused: Date.now() < followPause });
}

const reflow = () => {
  if (R.on && R.active && R.active.cur >= 0) {
    moveBar(R.active.words[R.active.cur].span, true);
  }
};
window.addEventListener('resize', reflow);
document.addEventListener('scroll', reflow, { passive: true, capture: true });

const SKIP =
  'button, select, script, style, svg, audio, video, canvas, .kbar, .fab, #fabs, .dict-bubble, .toast, [aria-hidden="true"], .chev, .sel-box, .rec-big, .lock-ic, input[type=checkbox], input[type=radio]';
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

function screenRoot() {
  const ovs = [...document.querySelectorAll('#modals .m-overlay')].filter(o => !o.classList.contains('closing'));
  const top = ovs[ovs.length - 1];
  if (top) {
    const box = top.querySelector('.m-box');
    if (box && !box.classList.contains('m-sheet')) return box;
  }
  return document.querySelector('#view');
}

function mirrorOf(field) {
  const cs = getComputedStyle(field);
  const m = h('div', {
    class: 'rd-mirror' + (field.tagName === 'TEXTAREA' ? ' ta' : ''),
    'data-test': 'rd-mirror',
  });
  for (const k of [
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRadius',
    'textAlign',
    'whiteSpace',
    'overflowWrap',
  ]) {
    m.style[k] = cs[k];
  }
  const host = field.parentElement;
  if (getComputedStyle(host).position === 'static') {
    host.dataset.rdPos = '1';
    host.style.position = 'relative';
  }
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
  const fields = [
    ...root.querySelectorAll('textarea, input:not([type]), input[type=text], input[type=search]'),
  ].filter(f => isShown(f) && hasWord(f.value || '') && !f.closest(SKIP));

  if (root !== document.querySelector('#view') && fields.length) fields.forEach(mirrorOf);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      const p = n.parentElement;
      if (!p || !hasWord(n.nodeValue) || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      if (p.closest('label') && R.mirrors.length && !p.closest('.rd-mirror')) return NodeFilter.FILTER_REJECT;
      return isShown(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);

  if (R.mirrors.length) {
    const mset = new Set(R.mirrors.map(x => x.m));
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (![...mset].some(m => m.contains(nodes[i]))) nodes.splice(i, 1);
    }
  }

  const blocks = [];
  let curBlock = null;
  let cur = null;

  for (const n of nodes) {
    const b = blockOf(n);
    if (b !== curBlock) {
      curBlock = b;
      cur = { el: b, words: [], cur: -1 };
      blocks.push(cur);
    }
    const text = n.nodeValue;
    const wrap = document.createElement('span');
    wrap.className = 'rd-wrap kw';
    const re = /\S+/g;
    let m;
    let last = 0;

    while ((m = re.exec(text))) {
      if (m.index > last) wrap.append(text.slice(last, m.index));
      const sp = document.createElement('span');
      sp.className = 'w';
      sp.textContent = m[0];
      wrap.append(sp);

      const clean = m[0].replace(/[▾▴🔒🔓⏰●]/gu, '').trim();
      if (clean && hasWord(clean)) {
        cur.words.push({ w: clean, span: sp });
      }
      last = re.lastIndex;
    }
    if (last < text.length) wrap.append(text.slice(last));
    R.wraps.push({ wrap, orig: text });
    n.replaceWith(wrap);
  }

  const segs = [];
  for (const b of blocks) {
    let s = null;
    b.words.forEach(w => {
      if (!s) {
        s = { el: b.el, words: [], cur: -1 };
        segs.push(s);
      }
      s.words.push(w);
      const len = s.words.reduce((a, x) => a + x.w.length + 1, 0);
      if ((len > 150 && /[.!?;:]$/.test(w.w)) || len > 220) s = null;
    });
  }

  segs.forEach(s => {
    let pos = 0;
    s.text = s.words
      .map(w => {
        w.s = pos;
        w.e = pos + w.w.length;
        pos = w.e + 1;
        return w.w;
      })
      .join(' ');
  });

  return segs.filter(s => s.words.length);
}

function restore() {
  if (R.trackRaf) {
    cancelAnimationFrame(R.trackRaf);
    R.trackRaf = 0;
  }
  R.trackUntil = 0;
  for (const { wrap, orig } of R.wraps) {
    try {
      if (wrap.isConnected) wrap.replaceWith(document.createTextNode(orig));
    } catch {}
  }
  for (const { m, host } of R.mirrors) {
    m.remove();
    if (host.dataset.rdPos) {
      host.style.position = '';
      delete host.dataset.rdPos;
    }
  }
  R.wraps = [];
  R.mirrors = [];
  R.active = null;
  lastLineTop = null;
  if (R.bar) R.bar.classList.remove('show');
}

function firstVisible(segs) {
  const top = document.querySelector('#hdr, header')?.getBoundingClientRect().bottom || 0;
  const i = segs.findIndex(s => {
    const sp = s.words[s.words.length - 1].span;
    const r = sp.getBoundingClientRect();
    const sc = scrollParent(sp);
    const ct = sc ? Math.max(top, sc.getBoundingClientRect().top) : top;
    return r.bottom > ct + 2;
  });
  return i < 0 ? 0 : i;
}

function wordMs(w, rate) {
  const r = rate || 1;
  let base = (66 * Math.min(14, w.length) + 135) / r;
  if (/[,;:\u2013\u2014]$/.test(w)) base += 110 / r;
  else if (/[.!?]$/.test(w)) base += 210 / r;
  return Math.max(165, base);
}

function speakSeg(seg, gen, opts) {
  return new Promise(resolve => {
    if (gen !== R.gen) {
      resolve();
      return;
    }
    const rate = opts.rate;
    let got = false;
    let started = false;
    let done = false;
    let timer = null;
    let startAt = 0;
    let maxCi = -1;
    let est = 0;

    seg.words.forEach(w => {
      est += wordMs(w.w, rate);
    });

    const fin = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(safety);
      if (R.ttsId === segId) R.onTts = null;
      resolve();
    };

    const run = i => {
      if (gen !== R.gen || got || done || i >= seg.words.length) return;
      hl(seg, i);
      timer = setTimeout(() => run(i + 1), wordMs(seg.words[i].w, rate));
    };

    const onStart = () => {
      if (started || gen !== R.gen) return;
      started = true;
      startAt = Date.now();
      hl(seg, 0);
      setTimeout(() => {
        if (got || done || gen !== R.gen) return;
        const elapsed = Date.now() - startAt;
        let acc = 0;
        let idx = 0;
        while (idx < seg.words.length - 1 && acc + wordMs(seg.words[idx].w, rate) < elapsed) {
          acc += wordMs(seg.words[idx].w, rate);
          idx++;
        }
        run(Math.max(idx, seg.cur));
      }, 650);
    };

    const onRange = ci => {
      if (gen !== R.gen || done) return;
      if (!got) {
        got = true;
        clearTimeout(timer);
      }
      if (ci < maxCi) return;
      maxCi = ci;

      let k = Math.max(0, seg.cur);
      while (k < seg.words.length - 1 && ci >= seg.words[k].e) k++;
      hl(seg, k);
    };

    const safety = setTimeout(fin, est * 2.5 + 8000);
    R.stopResolve = fin;
    const segId = 'r' + gen + '_' + Math.random().toString(36).slice(2, 8);

    if (opts.native) {
      R.ttsId = segId;
      R.onTts = ev => {
        if (!ev || ev.id !== segId) return;
        if (ev.type === 'start') onStart();
        else if (ev.type === 'range') onRange(+ev.s || 0);
      };
      nativeTts
        .speak({ text: seg.text, lang: opts.lang, rate, pitch: 1, voiceName: opts.voiceName, id: segId })
        .then(fin, () => {
          opts.failed = true;
          fin();
        });
      setTimeout(() => {
        if (!started && !done && gen === R.gen) onStart();
      }, 1100);
    } else {
      const u = new SpeechSynthesisUtterance(seg.text);
      const v = opts.voice;
      u.lang = v ? v.lang : opts.lang;
      if (v) u.voice = v;
      u.rate = rate;
      u.onstart = onStart;
      u.onboundary = e => {
        if (e.name && e.name !== 'word') return;
        onRange(e.charIndex || 0);
      };
      u.onend = u.onerror = fin;
      speechSynthesis.speak(u);
      setTimeout(() => {
        if (!started && !done && gen === R.gen && speechSynthesis.speaking) onStart();
      }, 1100);
    }
  });
}

function showBubble() {
  hideBubble();
  R.bubble = h(
    'div',
    { class: 'dict-bubble', role: 'status', 'data-test': 'speak-bubble' },
    h('span', { class: 'dict-dot' }),
    h('span', { class: 'dict-txt' }, t('reading')),
    h('button', { class: 'btn sm', type: 'button', 'data-test': 'speak-stop', onclick: () => stopReading() }, t('stop'))
  );
  document.body.append(R.bubble);
}

function hideBubble() {
  if (R.bubble) {
    R.bubble.remove();
    R.bubble = null;
  }
}

export async function stopReading() {
  if (!R.on) return;
  R.on = false;
  R.gen++;
  R.onTts = null;
  hideBubble();
  try {
    if (R.stopResolve) R.stopResolve();
  } catch {}
  if (nativeTts.hasNativeTts()) await nativeTts.stop();
  if ('speechSynthesis' in window) {
    try {
      speechSynthesis.cancel();
    } catch {}
  }
  for (const hd of R.handles) {
    try {
      await hd.remove();
    } catch {}
  }
  R.handles = [];
  restore();
  document.body.classList.remove('reading');
}

export async function readScreen({ engineCheck, emit, root } = {}) {
  if (R.on) {
    await stopReading();
    return false;
  }
  const useRoot = root || screenRoot();
  if (!useRoot) {
    toast(t('nothingToRead'));
    return false;
  }
  const segs = collect(useRoot);
  if (!segs.length) {
    restore();
    toast(t('nothingToRead'));
    return false;
  }
  const start = root ? 0 : firstVisible(segs);
  const text = segs
    .slice(start)
    .map(s => s.text)
    .join('.\n');
  if (emit) emit(text);

  const s = state.settings;
  const opts = {
    lang: s.voiceLang || 'ro-RO',
    rate: s.voiceRate == null ? 1.25 : s.voiceRate,
    voiceName: s.voiceName || '',
  };
  const eng = engineCheck ? await engineCheck(opts) : null;
  if (!eng) {
    restore();
    return false;
  }
  Object.assign(opts, eng);

  R.on = true;
  R.gen++;
  R.segs = segs;
  followPause = 0;
  lastLineTop = null;
  const gen = R.gen;

  document.body.classList.add('reading');
  showBubble();

  if (opts.native) {
    const L = nativeTts.lsoVoice();
    if (L && L.addListener) {
      try {
        R.handles.push(await L.addListener('ttsEv', ev => R.onTts && R.onTts(ev)));
      } catch {}
    }
  } else {
    try {
      speechSynthesis.cancel();
    } catch {}
  }

  for (let i = start; i < segs.length; i++) {
    if (gen !== R.gen) return true;
    await speakSeg(segs[i], gen, opts);
    if (opts.failed) {
      toast(t('ttsMissing'), 4000);
      break;
    }
  }
  if (gen === R.gen) await stopReading();
  return true;
}
