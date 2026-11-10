// Zona secretă / Meniul creator – port fidel din Notis v222 (js/hdr.js), aprobat de Iosif.
// Gest: apăsare lungă 6 s pe logo sau pe titlul LEGE ȘI ORDINE (atingerea scurtă deschide Setările).
// Parola + caracterul secret nu se salvează în clar: PBKDF2-SHA-256, 200 000 iterații; tokenul de publicare
// e criptat AES-GCM cu cheie derivată din aceeași parolă + caracter. Fără timeout; ieșirea cere Da/Nu.
import { confirmDlg, toast, topModal } from '../ui/modal.js';
import { openStats } from './stats.js';

const KH = 'lso_crsec', KT = 'lso_crtok', IT = 200000;
const REPO = 'cluj1313/lso-mesaje', FILE = 'creator.json';
let sess = null, swallow = 0, draft = { t: '', b: '', te: '', be: '' };
// sess, după deblocare: { pw: '<PAROLA_TA>', ch: '<CARACTERUL_SECRET>' } – doar în memorie
export const zoneSession = () => sess;

const TR = s => s;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const enc = new TextEncoder();
export const h64 = u => btoa(String.fromCharCode.apply(null, new Uint8Array(u)));
export const d64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const u8b64 = s => btoa(unescape(encodeURIComponent(s)));
const b64u8 = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ''))));

function base(pw, ch) {
  return crypto.subtle.importKey('raw', enc.encode(pw + '\u241F' + ch), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}
function hash(pw, ch, salt, it) {
  return base(pw, ch).then(k => crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, k, 256)).then(h64);
}
export function aes(pw, ch, salt, it) {
  return base(pw, ch).then(k => crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
}
// Criptare/decriptare cu cheia zonei (parola + caracter) – folosite pentru token și pentru parola de admin salvată.
export async function sealWithZone(key, text) {
  if (!sess) throw new Error('no-session');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await aes(sess.pw, sess.ch, salt, IT);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(text));
  put(key, { salt: h64(salt), iv: h64(iv), ct: h64(ct), iter: IT });
}
export async function openWithZone(key) {
  const T = get(key);
  if (!T || !sess) return null;
  const k = await aes(sess.pw, sess.ch, d64(T.salt), T.iter || IT);
  const b = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d64(T.iv) }, k, d64(T.ct));
  return new TextDecoder().decode(b);
}
// localStorage[KH] = { salt: '<SALT_B64>', hash: '<HASH_B64>', iter: 200000 }
// localStorage[KT] = { salt: '<SALT_B64>', iv: '<IV_B64>', ct: '<CT_B64>', iter: 200000 }

// ---------- Gestul de 6 secunde, inel cyan, vibrație, înghițirea click-ului ----------
export function startSecretGesture() {
  const ico = document.querySelector('[data-test=hdr-emblem]');
  const ttl = document.querySelector('[data-test=hdr-title]');
  if (!ico || !window.crypto || !crypto.subtle) return; // fără crypto.subtle zona nu există
  ico.setAttribute('draggable', 'false');
  ico.style.touchAction = 'none';
  ico.addEventListener('dragstart', e => e.preventDefault());
  ico.addEventListener('contextmenu', e => e.preventDefault());
  let tm = 0, x0 = 0, y0 = 0, t0 = 0, ring = null, raf = 0;
  const HOLD = 6000;
  function ringShow() {
    const r = ico.getBoundingClientRect(), d = Math.max(r.width, r.height) + 14;
    ring = document.createElement('div'); ring.id = 'crRing';
    ring.style.cssText = 'position:fixed;pointer-events:none;z-index:40;border-radius:50%;left:' +
      (r.left + r.width / 2 - d / 2) + 'px;top:' + (r.top + r.height / 2 - d / 2) + 'px;width:' + d + 'px;height:' + d + 'px;' +
      '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px));' +
      'mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px));opacity:.85';
    document.body.appendChild(ring);
    (function f() {
      if (!ring) return;
      const k = Math.min(1, (Date.now() - t0) / HOLD) * 360;
      ring.style.background = 'conic-gradient(#3fd8ff ' + k + 'deg,rgba(255,255,255,.12) 0)';
      raf = requestAnimationFrame(f);
    })();
  }
  function stop() { clearTimeout(tm); tm = 0; cancelAnimationFrame(raf); if (ring) { ring.remove(); ring = null; } }
  function start(x, y) {
    if (tm) return; x0 = x; y0 = y; t0 = Date.now();
    tm = setTimeout(() => {
      stop(); swallow = Date.now();
      try { navigator.vibrate && navigator.vibrate(60); } catch (_) {}
      open();
    }, HOLD);
    setTimeout(() => { if (tm && !ring) ringShow(); }, 350);
  }
  const mv = (x, y) => { if (tm && (Math.abs(x - x0) > 15 || Math.abs(y - y0) > 15)) stop(); };
  const HT = [ico].concat(ttl ? [ttl] : []);
  if (ttl) {
    ttl.style.touchAction = 'none';
    ttl.style.userSelect = ttl.style.webkitUserSelect = 'none';
    ttl.style.webkitTouchCallout = 'none';
    ttl.addEventListener('contextmenu', e => e.preventDefault());
  }
  HT.forEach(el => {
    el.addEventListener('pointerdown', e => start(e.clientX, e.clientY));
    el.addEventListener('touchstart', e => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }, { passive: true });
  });
  document.addEventListener('pointermove', e => mv(e.clientX, e.clientY), true);
  document.addEventListener('touchmove', e => { const t = e.touches[0]; if (t) mv(t.clientX, t.clientY); }, { passive: true, capture: true });
  ['pointerup', 'touchend', 'mouseup'].forEach(ev => document.addEventListener(ev, () => { if (tm) stop(); }, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  // după gest: atingerile pe logo/titlu sunt ignorate 4 s (nu deschid Setările)
  document.addEventListener('click', e => {
    if (swallow && Date.now() - swallow < 4000 && (HT.some(el => el.contains(e.target)) || e.target === $('crx'))) {
      // și „click-ul fantomă” de la ridicarea degetului, care ar cădea pe fundalul zonei
      e.stopImmediatePropagation(); e.preventDefault(); swallow = 0;
    }
  }, true);
  // Escape (Notis: aceeași logică ca Înapoi)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (topModal()) return;
    if ($('adx') || $('crx')) { e.preventDefault(); secretBack(); }
  }, true);
}

// ---------- UI ----------
function fld(id, ph, type, eye) {
  return '<div class="crf"><input id="' + id + '" type="' + (type || 'text') + '" placeholder="' + esc(ph) +
    '" autocomplete="off" autocapitalize="off" spellcheck="false"' + (id === 'crCh' ? ' maxlength="4"' : '') + '>' +
    (eye ? '<button type="button" class="eye" data-f="' + id + '" aria-label="' + esc(TR('Arată / ascunde')) + '">👁</button>' : '') + '</div>';
}
function hide() { const o = $('crx'); if (o) o.remove(); }
function exit() { sess = null; draft = { t: '', b: '', te: '', be: '' }; const a = $('adx'); if (a) a.remove(); hide(); }
function wantLeave() { if (!sess) { hide(); return; } ask(TR('Vrei să ieși din Zona secretă?'), () => exit()); }
function saveDraft() { if ($('crT')) draft = { t: $('crT').value, b: $('crB').value, te: $('crTe').value, be: $('crBe').value }; }
function bindShell(o) {
  if (!o || o._crBound) return; o._crBound = 1;
  o.addEventListener('click', e => { if (e.target !== o) return; if ($('adx')) return; wantLeave(); });
}
function ui(title, body) {
  let o = $('crx');
  if (!o) { o = document.createElement('div'); o.id = 'crx'; o.dataset.test = 'secret-zone'; document.body.appendChild(o); }
  bindShell(o);
  const ad = $('adx');
  o.innerHTML = '<div class="crc"><h3><span>🔐 ' + esc(title) + '</span><button type="button" id="crX" aria-label="' +
    esc(TR('Închide')) + '">×</button></h3>' + body + '<div class="cre" id="crE"></div></div>';
  if (ad) o.appendChild(ad);
  $('crX').onclick = () => { if (sess) wantLeave(); else hide(); };
  o.querySelectorAll('.eye').forEach(b => {
    b.onclick = () => { const i = $(b.dataset.f), sh = i.type === 'password'; i.type = sh ? 'text' : 'password'; b.classList.toggle('on', sh); };
  });
}
function err(t) { const e = $('crE'); if (e) e.textContent = t || ''; }
// Dialogul Da/Nu al aplicației (deasupra zonei), niciodată confirm() nativ.
function ask(txt, yes) { confirmDlg(txt, { yes: TR('Da'), no: TR('Nu') }).then(ok => { if (ok) yes(); }); }

export function open() { if (sess) return main(); if (get(KH)) unlock(); else setup(); }
function main() { if (!sess) { hide(); return; } if (!get(KT)) return tokForm(); compose(); }

function setup() {
  ui(TR('Meniu creator'),
    fld('crP1', TR('Parolă'), 'password', 1) +
    fld('crP2', TR('Repetă parola'), 'password', 1) +
    fld('crCh', TR('Caracter secret'), 'password', 1) +
    '<div class="hint">' + esc(TR('Minim 8 caractere')) + '</div>' +
    '<div class="crb"><button type="button" id="crGo">' + esc(TR('Creează')) + '</button></div>');
  $('crGo').onclick = () => {
    const a = $('crP1').value, b = $('crP2').value, c = $('crCh').value;
    if (a.length < 8) return err(TR('Minim 8 caractere'));
    if (a !== b) return err(TR('Parolele nu coincid'));
    if (!c) return err(TR('Alege un caracter secret'));
    const salt = crypto.getRandomValues(new Uint8Array(16)); err('…');
    hash(a, c, salt, IT).then(h => {
      put(KH, { salt: h64(salt), hash: h, iter: IT });
      sess = { pw: a, ch: c };
      main();
    });
  };
}

function unlock() {
  ui(TR('Meniu creator'),
    fld('crP1', TR('Parolă'), 'password', 1) +
    fld('crCh', TR('Caracter secret'), 'password', 1) +
    '<div class="crb">' +
      '<button type="button" class="alt" id="crRs">' + esc(TR('Resetează')) + '</button>' +
      '<button type="button" id="crGo">' + esc(TR('Deblochează')) + '</button>' +
    '</div>');
  $('crRs').onclick = () => {
    ask(TR('Resetezi meniul creator? Parola și tokenul se șterg de pe acest dispozitiv.'), () => {
      try { localStorage.removeItem(KH); localStorage.removeItem(KT); localStorage.removeItem('lso_adpw'); } catch (_) {}
      setup();
    });
  };
  $('crGo').onclick = () => {
    const a = $('crP1').value, c = $('crCh').value, H = get(KH); err('…');
    hash(a, c, d64(H.salt), H.iter || IT).then(h => {
      if (h !== H.hash) return err(TR('Parolă sau caracter greșit'));
      sess = { pw: a, ch: c };
      main();
    });
  };
}

function tkClean(v) { return String(v || '').replace(/[\s\u200B-\u200D\u2060\uFEFF"'`]/g, ''); }

function tokForm() {
  ui(TR('Meniu creator'),
    '<div class="hint">' + esc(TR('Lipește tokenul GitHub (o singură dată)')) + '</div>' +
    fld('crTk', 'github_pat_…', 'password', 1) +
    '<div class="crb"><button type="button" class="alt" id="crAd" aria-label="📊">📊</button><button type="button" id="crGo">' + esc(TR('Salvează tokenul')) + '</button></div>');
  $('crAd').onclick = () => openStats();
  $('crGo').onclick = () => {
    const t = tkClean($('crTk').value); // t trebuie să fie '<TOKEN_PUBLICARE>'
    if (t.length < 20 || !/^(github_pat_|ghp_|gho_)[A-Za-z0-9_]+$/.test(t)) return err(TR('Token invalid sau expirat — șterge tokenul și introdu unul nou'));
    sealWithZone(KT, t).then(() => {
      toast(TR('Tokenul e salvat criptat pe acest dispozitiv'));
      compose();
    });
  };
}

function token() { return openWithZone(KT).then(tkClean); } // → '<TOKEN_PUBLICARE>'

function ghHeaders(tok) { return { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function ghFile() {
  const url = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE; let hd, sha;
  return token().then(x => {
    hd = ghHeaders(x);
    return fetch(url + '?ref=main&t=' + Date.now(), { headers: hd, cache: 'no-store' });
  }).then(r => { if (!r.ok) throw new Error('GET ' + r.status); return r.json(); }).then(f => {
    sha = f.sha;
    let j; try { j = JSON.parse(b64u8(f.content)); } catch (_) { j = { messages: [] }; }
    if (!j || !Array.isArray(j.messages)) j = { messages: [] };
    return { url, hd, sha, j };
  });
}

function crMsg(e) {
  const m = String((e && e.message) || e), c = +(m.match(/\b(\d{3})\b/) || [])[1];
  if (c === 401) return TR('Token invalid sau expirat — șterge tokenul și introdu unul nou');
  if (c === 403) return TR('Tokenul nu are permisiunea Contents: Read and write pe ' + REPO);
  if (c === 404) return TR('Repository-ul ' + REPO + ' nu e accesibil cu acest token');
  if (c === 409 || c === 422) return TR('Conflict la salvare, încearcă din nou');
  if (/OperationError|decrypt/i.test(m)) return TR('Tokenul nu poate fi decriptat — șterge tokenul și introdu unul nou');
  if (!c) return TR('Fără conexiune la internet');
  return TR('Trimiterea a eșuat');
}

function inbox() {
  ui(TR('Mesaje'),
    '<div class="hint">' + esc(TR('Istoricul mesajelor trimise. Rămân până le ștergi.')) + '</div>' +
    '<div class="crms" id="crList"><div class="crempty">…</div></div>' +
    '<div class="crb"><button type="button" class="alt" id="crBack">' + esc(TR('Înapoi')) + '</button></div>');
  $('crBack').onclick = () => compose();
  ghFile().then(g => {
    const box = $('crList'); if (!box) return;
    const a = g.j.messages.slice().reverse();
    if (!a.length) { box.innerHTML = '<div class="crempty">' + esc(TR('Niciun mesaj')) + '</div>'; return; }
    box.innerHTML = a.map(m => '<div class="crmi" data-id="' + esc(m.id || '') + '"><div class="cd">' + esc(m.date || '') +
      '</div><div class="ct">' + esc(m.title || '') + '</div><div class="cb">' + esc(m.body || '') +
      '</div><button type="button" class="cdl" data-del="' + esc(m.id || '') + '">' + esc(TR('Șterge')) + '</button></div>').join('');
    box.onclick = e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      const id = b.getAttribute('data-del');
      ask(TR('Ștergi mesajul?'), () => delMsg(id));
    };
  }).catch(e => err(crMsg(e) + ' (' + ((e && e.message) || e) + ')'));
}

function delMsg(id) {
  if (!id) return; err(TR('Se șterge…'));
  ghFile().then(g => {
    g.j.messages = g.j.messages.filter(m => m.id !== id);
    return fetch(g.url, { method: 'PUT', headers: g.hd, body: JSON.stringify({ message: 'news: delete ' + id, content: u8b64(JSON.stringify(g.j, null, 1) + '\n'), sha: g.sha, branch: 'main' }) });
  }).then(r => {
    if (!r.ok) throw new Error('PUT ' + r.status);
    toast(TR('Mesaj șters')); inbox();
  }).catch(e => err(crMsg(e) + ' (' + ((e && e.message) || e) + ')'));
}

function compose() {
  ui(TR('Meniu creator'),
    fld('crT', TR('Titlu')) +
    '<textarea id="crB" placeholder="' + esc(TR('Mesaj')) + '"></textarea>' +
    fld('crTe', TR('Titlu EN (opțional)')) +
    '<textarea id="crBe" placeholder="' + esc(TR('Mesaj EN (opțional)')) + '"></textarea>' +
    '<div class="crb">' +
      '<button type="button" class="alt" id="crAd" aria-label="📊">📊</button>' +
      '<button type="button" class="alt" id="crMs">' + esc(TR('Mesaje')) + '</button>' +
      '<button type="button" class="alt" id="crDt">' + esc(TR('Șterge tokenul')) + '</button>' +
      '<button type="button" class="alt" id="crOut">' + esc(TR('Ieșire')) + '</button>' +
      '<button type="button" id="crGo">' + esc(TR('Trimite')) + '</button>' +
    '</div>');
  if ($('crT')) { $('crT').value = draft.t || ''; $('crB').value = draft.b || ''; $('crTe').value = draft.te || ''; $('crBe').value = draft.be || ''; }
  $('crAd').onclick = () => { saveDraft(); openStats(); };
  $('crMs').onclick = () => { saveDraft(); inbox(); };
  $('crOut').onclick = wantLeave;
  $('crDt').onclick = () => { ask(TR('Șterge tokenul') + '?', () => { try { localStorage.removeItem(KT); } catch (_) {} tokForm(); }); };
  $('crGo').onclick = () => {
    const t = $('crT').value.trim(), b = $('crB').value.trim(), te = $('crTe').value.trim(), be = $('crBe').value.trim();
    if (!t || !b) return err(TR('Completează titlul și mesajul'));
    const go = $('crGo'); go.disabled = true; err(TR('Se trimite…'));
    const url = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE; let hd;
    token().then(x => {
      hd = ghHeaders(x);
      return fetch(url + '?ref=main&t=' + Date.now(), { headers: hd, cache: 'no-store' });
    }).then(r => { if (!r.ok) throw new Error('GET ' + r.status); return r.json(); }).then(f => {
      let j; try { j = JSON.parse(b64u8(f.content)); } catch (_) { j = { messages: [] }; }
      if (!j || !Array.isArray(j.messages)) j = { messages: [] };
      const now = new Date(), m = { id: 'm' + Math.floor(now.getTime() / 1000), date: now.toISOString().slice(0, 10), title: t, body: b };
      if (te || be) m.lang = { en: { title: te || t, body: be || b } };
      j.messages.push(m);
      return fetch(url, { method: 'PUT', headers: hd, body: JSON.stringify({ message: 'news: ' + t.slice(0, 60), content: u8b64(JSON.stringify(j, null, 1) + '\n'), sha: f.sha, branch: 'main' }) });
    }).then(r => {
      if (!r.ok) throw new Error('PUT ' + r.status);
      toast(TR('Mesaj trimis tuturor'));
      ['crT', 'crB', 'crTe', 'crBe'].forEach(i => { $(i).value = ''; });
      draft = { t: '', b: '', te: '', be: '' };
      err(''); go.disabled = false;
    }).catch(e => { go.disabled = false; err(crMsg(e) + ' (' + ((e && e.message) || e) + ')'); });
  };
}

// Înapoi (Android) / Escape: nu ies din zonă fără confirmare, dacă ești autentificat.
export function secretBack() {
  if (topModal()) return false;
  if ($('adx')) { const x = $('adX'); if (x) x.click(); else $('adx').remove(); return true; }
  if (!$('crx')) return false;
  if ($('crBack')) { $('crBack').click(); return true; }
  if (!sess) { hide(); return true; }
  wantLeave(); return true;
}
