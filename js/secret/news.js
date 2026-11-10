// „Mesaje de la creator” – partea utilizatorului (port din Notis js/news.js).
// Citește fișierul public de pe GitHub Pages; fără interval recurent pe web (Android are NewsReceiver, 6 h).
import { h } from '../core/util.js';
import { openModal, confirmDlg, toast, modalsOpen } from '../ui/modal.js';
import { isNative } from './server.js';

export const NEWS_URL = 'https://cluj1313.github.io/lso-mesaje/creator.json';
const K = 'lso_news', KS = 'lso_newsSeen', KB = 'lso_newsBox';
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const N = () => (isNative() ? window.Capacitor?.Plugins?.LsoSystem : null);
const listeners = new Set();
export const onNews = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const render = () => listeners.forEach(fn => { try { fn(); } catch (_) {} });

export const newsOn = () => !!get(K, false);
export const newsBox = () => get(KB, []);
export async function setNews(on, { poll: now = true } = {}) {
  put(K, !!on);
  try { const n = N(); if (n && n.newsSet) await n.newsSet({ on: !!on, lang: 'ro', poll: !!now }); } catch (_) {}
  if (on && now) poll();
  render();
}
export async function deleteNews(id) {
  if (!(await confirmDlg('Ștergi mesajul?', { yes: 'Da', no: 'Nu', danger: true }))) return false;
  put(KB, newsBox().filter(m => m.id !== id)); // doar local; fișierul public rămâne
  render(); toast('Mesaj șters');
  return true;
}

let polling = false;
export function poll() {
  if (!newsOn() || polling) return Promise.resolve();
  polling = true;
  return fetch(NEWS_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(j => {
    const a = (j && j.messages) || [], S = get(KS, []), first = !get('lso_newsPrimed', false), fresh = [];
    let B = get(KB, []);
    const n = N();
    a.forEach(m => {
      if (!m || !m.id || S.indexOf(m.id) >= 0) return;
      S.push(m.id); B.push(m);
      if (!first) fresh.push(m);
      try { if (n && n.newsSeen) n.newsSeen({ id: String(m.id), primed: true }); } catch (_) {}
    });
    B = B.slice(-50);
    put(KS, S); put(KB, B); put('lso_newsPrimed', true);
    render(); card(fresh);
    if (!n && fresh.length && window.Notification && Notification.permission === 'granted' && document.hidden) {
      fresh.forEach(m => { try { new Notification(m.title || 'Mesaj nou de la creator', { body: m.body || '', icon: 'icons/icon-192.png' }); } catch (_) {} });
    }
  }).catch(() => {}).finally(() => { polling = false; });
}

// Cardul plutitor „Mesaj nou de la creator”
function card(fresh) {
  if (!fresh || !fresh.length) return;
  const old = document.getElementById('newsCard'); if (old) old.remove();
  const m = fresh[fresh.length - 1];
  const close = () => el.remove();
  const el = h('div', { id: 'newsCard', class: 'news-card', 'data-test': 'news-card', role: 'status' },
    h('div', { class: 'nc-top' }, h('span', { class: 'nc-k' }, '📣 Mesaj nou de la creator' + (fresh.length > 1 ? ` (+${fresh.length - 1})` : '')),
      h('button', { type: 'button', class: 'nc-x', 'aria-label': 'Închide', onclick: close }, '×')),
    h('div', { class: 'nc-t' }, m.title || ''),
    h('div', { class: 'nc-b' }, m.body || ''));
  document.body.appendChild(el);
}

// Onboarding: o singură dată, bifa implicit pornită.
function onboarding() {
  if (get('lso_newsOb', false)) return;
  if (modalsOpen()) { put('lso_newsObPend', true); setTimeout(onboarding, 4000); return; }
  const cb = h('input', { type: 'checkbox', checked: true, 'data-test': 'news-ob-check' });
  let done = false;
  const finish = () => { if (done) return; done = true; put('lso_newsOb', true); put('lso_newsObPend', false); setNews(cb.checked); };
  const m = openModal({
    title: '📣 Mesaje de la creator',
    body: h('div', {},
      h('p', {}, 'Din când în când creatorul aplicației trimite anunțuri scurte: noutăți, sfaturi și actualizări. Le poți opri aici sau oricând din Setări.'),
      h('label', { class: 'fld-check' }, cb, h('span', {}, 'Doresc să primesc mesaje de la creator'))),
    actions: [{ label: 'Continuă', cls: 'primary', onClick: mm => mm.close() }],
    dismissable: false,
    onClose: finish,
  });
  m.el.dataset.test = 'news-onboarding';
}

export function startNews() {
  // Re-armează receptorul nativ la pornire (fără poll imediat; poll-ul web de mai jos ține „seen” sincron).
  if (newsOn()) { try { const n = N(); if (n && n.newsSet) n.newsSet({ on: true, lang: 'ro', poll: false }); } catch (_) {} }
  setTimeout(poll, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  setTimeout(onboarding, 1800);
}
