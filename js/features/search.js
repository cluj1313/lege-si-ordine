// Căutare globală live: ignoră diacriticele, cuvinte combinate prin AND, potrivire parțială, include rândurile secundare și Coșul.
import { h, norm, debounce, fmtTsDate } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, tabById, dataOf, canView, locksChain, isOpen, unlockTemp, isHiddenByTrash, item as getItem } from '../core/store.js';
import { KINDS, TAB_KINDS } from '../tabs/kinds.js';
import { openModal, pinDlg } from '../ui/modal.js';
import { app } from '../ui/registry.js';

function pathOf(it) {
  const tab = tabById(it.tab);
  const parts = [tab ? tab.name : '?'];
  const chain = []; let f = it.folder && getItem(it.folder);
  while (f) { chain.unshift(canView(f) ? dataOf(f).name : '🔒'); f = f.folder && getItem(f.folder); }
  if (it.sub && tab && tab.kind === 'saved') { const s = (tab.subs || []).find(x => x.id === it.sub); chain.unshift(s ? s.name : (it.sub === 'descarcate' ? t('subDownloaded') : t('subSaved'))); }
  return [...parts, ...chain].join(' › ');
}
function snippet(text, words) {
  const n = norm(text);
  let pos = -1; for (const w of words) { const p = n.indexOf(w); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  if (pos < 0) return '';
  const start = Math.max(0, pos - 40);
  const raw = text.slice(start, start + 140).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + raw + (start + 140 < text.length ? '…' : '');
}
function highlight(text, words) {
  // evidențiază potrivirile (fără diacritice) păstrând textul original
  const n = norm(text); const marks = new Array(text.length).fill(false);
  for (const w of words) { let p = n.indexOf(w); while (p >= 0) { for (let i = p; i < p + w.length; i++) marks[i] = true; p = n.indexOf(w, p + 1); } }
  const out = []; let buf = '', on = false;
  for (let i = 0; i < text.length; i++) { if (marks[i] !== on) { if (buf) out.push(on ? h('mark', {}, buf) : buf); buf = ''; on = marks[i]; } buf += text[i]; }
  if (buf) out.push(on ? h('mark', {}, buf) : buf);
  return out;
}

function fuzzyMatch(text, word) {
  const n = norm(text);
  if (n.includes(word)) return true;
  // toleranță simplă: permite 1-2 caractere lipsă/în plus
  if (word.length < 3) return false;
  const len = word.length;
  for (let i = 0; i <= n.length - len + 1; i++) {
    const slice = n.slice(i, i + len);
    let diff = 0;
    for (let j = 0; j < len; j++) if (slice[j] !== word[j]) diff++;
    if (diff <= 1) return true;
  }
  return false;
}

export function runSearch(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const res = { tabs: [], items: [], lockedOwners: new Map(), lockedCount: 0 };
  if (!words.length) return res;
  const match = txt => { const n = norm(txt); return words.every(w => fuzzyMatch(n, w)); };
  for (const tab of state.tabs) {
    if (match(tab.name + ' ' + ((TAB_KINDS[tab.kind] || {}).label?.() || ''))) res.tabs.push(tab);
  }
  for (const it of state.items.values()) {
    if (!canView(it)) {
      res.lockedCount++;
      for (const l of locksChain(it)) if (!isOpen(l) || (l === it)) { res.lockedOwners.set(l.id, l); break; }
      continue;
    }
    const d = dataOf(it); const K = KINDS[it.kind] || KINDS.note;
    const text = (K.search ? K.search(d) : JSON.stringify(d)) || '';
    const title = K.title(d) || '';
    if (!match(title + '\n' + text + '\n' + pathOf(it))) continue;
    const inTrash = !!it.trashedAt || isHiddenByTrash(it);
    res.items.push({ it, title, snip: snippet(text, words), path: pathOf(it), inTrash });
  }
  res.items.sort((a, b) => (a.inTrash - b.inTrash) || (b.it.updated - a.it.updated));
  res.words = words;
  return res;
}

export function openSearch() {
  const inp = h('input', { class: 'inp search-inp', type: 'search', placeholder: t('searchPh'), autocomplete: 'off', enterkeyhint: 'search', 'data-test': 'search-input' });
  const out = h('div', { class: 'search-out' });
  const m = openModal({ title: t('search'), body: h('div', {}, inp, out), kind: 'page', cls: 'search-page' });
  m.el.dataset.test = 'search';
  const draw = () => {
    out.innerHTML = '';
    const q = inp.value.trim();
    if (!q) { out.append(h('div', { class: 'r2-meta pad' }, t('searchHelp'))); return; }
    const r = runSearch(q);
    if (r.tabs.length) {
      out.append(h('div', { class: 'sep-label' }, t('searchTabs')));
      r.tabs.forEach(tab => out.append(h('button', { class: 'sr', type: 'button', onclick: () => { m.close(); if (tab.trashedAt) app.openTrash(); else app.goTab(tab.id); } },
        h('div', { class: 'sr-t' }, highlight(tab.name, r.words), tab.trashedAt ? h('span', { class: 'pill trash-mark' }, t('inTrash')) : null))));
    }
    // grupare pe categorii
    const groups = {};
    r.items.forEach(x => {
      const cat = x.it.kind || 'note';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(x);
    });
    for (const [cat, list] of Object.entries(groups)) {
      out.append(h('div', { class: 'sep-label' }, (KINDS[cat] || {}).label?.() || cat));
      list.slice(0, 50).forEach(x => out.append(h('button', { class: 'sr' + (x.inTrash ? ' in-trash' : ''), type: 'button', 'data-id': x.it.id, onclick: () => { m.close(); app.reveal(x.it.id); } },
        h('div', { class: 'sr-t' }, highlight(x.title, r.words), x.inTrash ? h('span', { class: 'pill trash-mark' }, t('inTrash')) : null),
        x.snip ? h('div', { class: 'sr-s' }, highlight(x.snip, r.words)) : null,
        h('div', { class: 'sr-p' }, x.path, ' • ', fmtTsDate(x.it.updated)))));
    }
    if (r.lockedCount) {
      const box = h('div', { class: 'hint locked-hint' }, h('div', {}, t('searchLocked', { n: r.lockedCount })));
      for (const o of r.lockedOwners.values()) {
        const name = o.tab ? (o.kind === 'folder' ? (canView(o) ? dataOf(o).name : t('kindFolder')) : t('lockedItem')) : o.name;
        box.append(h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          const ok = await pinDlg(t('unlockNamed', { n: name }), { verify: pin => unlockTemp(o, pin) });
          if (ok) draw();
        } }, '🔒 ' + t('searchUnlockIn', { n: name })));
      }
      out.append(box);
    }
  };
  inp.addEventListener('input', debounce(draw, 120));
  draw();
  setTimeout(() => inp.focus(), 80);
}
