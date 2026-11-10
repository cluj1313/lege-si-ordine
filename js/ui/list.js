// Liste cu 2 rânduri: inițial doar rândul 1; atingerea lui deschide/închide rândul 2; atingerea rândului 2 deschide elementul.
import { h, fmtDate, fmtTsDate, fmtDur, act } from '../core/util.js';
import { t } from '../core/i18n.js';
import { KINDS, stagePill, recLen } from '../tabs/kinds.js';
import { state, dataOf, canView, locksChain, isOpen, unlockTemp, relock, saveItem, newItem, liveTabs, getMedia } from '../core/store.js';
import { pinDlg, toast } from './modal.js';
import { app } from './registry.js';
import { shareText, shareRecording } from '../features/share.js';
import { draggable } from './dnd.js';

export const ui = { expanded: new Set(), selecting: false, dragMode: false, selected: new Set() };

export async function askUnlock(obj, title) {
  const ok = await pinDlg(title || t('unlock'), { verify: pin => unlockTemp(obj, pin) });
  return !!ok;
}
// Deblochează pe rând toate lacătele care acoperă elementul.
export async function ensureOpen(it) {
  for (const l of locksChain(it).reverse()) {
    if (isOpen(l)) continue;
    if (!(await askUnlock(l, t('unlockNamed', { n: l.tab ? (l.kind === 'folder' ? (dataOf(l)?.name || t('kindFolder')) : t('lockedItem')) : l.name })))) return false;
  }
  return canView(it);
}

// Sortarea aleasă din meniul din dreapta sus, salvată pe tab (lso_kv › ui.sort).
export const SORT_MODES = ['alpha', 'manual', 'created', 'modified'];
export const sortModeOf = tabId => { const m = (state.ui.sort || {})[tabId]; return SORT_MODES.includes(m) ? m : 'manual'; };
const titleOf = it => { const d = dataOf(it); return d ? String((KINDS[it.kind] || KINDS.note).title(d) || '') : ''; };
export function byMode(mode) {
  if (mode === 'alpha') return (a, b) => titleOf(a).localeCompare(titleOf(b), 'ro', { sensitivity: 'base', numeric: true });
  if (mode === 'created') return (a, b) => (b.created || 0) - (a.created || 0);
  if (mode === 'modified') return (a, b) => (b.updated || 0) - (a.updated || 0);
  return null;
}
// Ordonează o listă simplă (ex. elementele unei zile) după modul tabului; „Manual” păstrează ordinea dată.
export function sortByTab(items, tabId) {
  const mode = sortModeOf(tabId);
  const cmp = byMode(mode);
  if (cmp) return items.slice().sort(cmp);
  const man = manualOf(tabId);
  return man ? items.slice().sort((a, b) => (man.get(a.id) ?? -1) - (man.get(b.id) ?? -1)) : items;
}

// Ordinea manuală (drag and drop), salvată pe tab în lso_kv › ui.manual.
export const manualOf = tabId => { const arr = (state.ui.manual || {})[tabId]; return arr && arr.length ? new Map(arr.map((id, i) => [id, i])) : null; };
export function saveManual(tabId, ids) {
  let base = ((state.ui.manual || {})[tabId] || []).filter(id => state.items.has(id));
  const missing = ids.filter(id => !base.includes(id));
  base = [...missing, ...base];
  const set = new Set(ids), q = [...ids];
  base = base.map(id => (set.has(id) ? q.shift() : id));
  state.ui.manual = { ...(state.ui.manual || {}), [tabId]: base };
}

function sortItems(items, kindName, mode = 'manual', tabId = null) {
  const K = KINDS[kindName] || {};
  const vis = items.filter(canView), hid = items.filter(i => !canView(i));
  const cmp = byMode(mode);
  const manual = mode === 'manual' && tabId ? manualOf(tabId) : null;
  vis.sort((a, b) => {
    const da = dataOf(a), db = dataOf(b);
    if (manual) {
      if (kindName === 'task' && !!da.done !== !!db.done) return da.done ? 1 : -1;
      if (K.past) { const pa = !!K.past(da), pb = !!K.past(db); if (pa !== pb) return pa ? 1 : -1; }
      const ia = manual.get(a.id) ?? -1, ib = manual.get(b.id) ?? -1;
      if (ia !== ib) return ia - ib;
      // elementele noi (fără loc salvat) rămân sus, în ordinea implicită
    }
    if (cmp) {
      // sarcinile bifate și termenele trecute rămân la final, apoi ordinea aleasă
      if (kindName === 'task' && !!da.done !== !!db.done) return da.done ? 1 : -1;
      if (K.past) { const pa = !!K.past(da), pb = !!K.past(db); if (pa !== pb) return pa ? 1 : -1; }
      return cmp(a, b) || 0;
    }
    if (kindName === 'law') return (a.order || 0) - (b.order || 0);
    if (kindName === 'task' && !!da.done !== !!db.done) return da.done ? 1 : -1;
    if (kindName === 'task' && da.done) return b.updated - a.updated;
    if (K.past) { const pa = !!K.past(da), pb = !!K.past(db); if (pa !== pb) return pa ? 1 : -1; if (pa) return -(K.sort(da, db)); }
    if (K.sort) { const r = K.sort(da, db); if (r) return r; }
    return (b.updated || 0) - (a.updated || 0);
  });
  return [...vis, ...hid];
}

export function renderList(wrap, items, { kind, empty, tabId } = {}) {
  wrap.innerHTML = '';
  if (!items.length) { wrap.append(h('div', { class: 'empty' }, empty || t('emptyList'))); return; }
  const sorted = sortItems(items, kind, tabId ? sortModeOf(tabId) : 'manual', tabId);
  let doneSep = false, pastSep = false;
  for (const it of sorted) {
    const d = canView(it) ? dataOf(it) : null;
    if (d && it.kind === 'task' && d.done && !doneSep) { doneSep = true; wrap.append(h('div', { class: 'sep-label' }, t('doneTasks'))); }
    if (d && KINDS[it.kind]?.past?.(d) && !pastSep) { pastSep = true; wrap.append(h('div', { class: 'sep-label' }, t('pastDeadlines'))); }
    wrap.append(card(it));
  }
}

export function card(it) {
  const K = KINDS[it.kind] || KINDS.note;
  const viewable = canView(it);
  const d = viewable ? dataOf(it) : null;
  const open = ui.expanded.has(it.id) && viewable;
  const el = h('div', { class: 'card' + (open ? ' open' : '') + (d && d.done ? ' done' : '') + (d && K.past?.(d) ? ' past' : ''), 'data-id': it.id, 'data-kind': it.kind });
  const tab = state.tabs.find(x => x.id === it.tab);
  if (tab && tab.color) el.style.setProperty('--accent', tab.color);

  if (ui.selecting) {
    const sel = ui.selected.has(it.id);
    el.classList.toggle('selected', sel);
    el.append(h('div', { class: 'r1', onclick: () => { sel ? ui.selected.delete(it.id) : ui.selected.add(it.id); app.render(); } },
      h('span', { class: 'sel-box' + (sel ? ' on' : '') }, sel ? '✓' : ''), h('span', { class: 'r1t' }, d ? K.title(d) : t('lockedItem'))));
    return el;
  }

  if (!viewable) {
    el.classList.add('locked');
    el.append(h('div', { class: 'r1', onclick: async () => { if (await ensureOpen(it)) { ui.expanded.add(it.id); app.render(); } } },
      h('span', { class: 'lock-ic' }, '🔒'), h('span', { class: 'r1t' }, t('lockedItem')), h('span', { class: 'r1-meta' }, fmtTsDate(it.updated))));
    return el;
  }

  // ---- Rândul 1 ----
  const r1 = h('div', { class: 'r1', role: 'button', 'aria-expanded': String(open), tabindex: 0 });
  if (it.kind === 'task') {
    r1.append(h('button', { class: 'circ' + (d.done ? ' on' : ''), type: 'button', 'aria-label': t('markDone'), onclick: e => { e.stopPropagation(); act(e.currentTarget, () => saveItem(it, { ...d, done: !d.done })); } }, d.done ? '✓' : ''));
  }
  if (K.lead) r1.append(K.lead(d));
  if (it.kind === 'rec') r1.append(h('span', { class: 'rec-dot' }, '●'));
  r1.append(h('span', { class: 'r1t' }, K.title(d)));
  const meta = h('span', { class: 'r1-meta' });
  if (it.lock) meta.append('🔓');
  if (it.alarmAt && it.alarmAt > Date.now()) meta.append('⏰');
  if (it.kind === 'rec') { /* durata, starea și ștergerea apar pe rândul 2 */ }
  if (it.kind === 'task' && d.date) meta.append(h('span', { class: 'r1-small' }, fmtDate(d.date).slice(0, 5) + (d.time ? ' ' + d.time : '')));
  if (meta.childNodes.length) r1.append(meta);
  r1.append(h('span', { class: 'chev' }, open ? '▴' : '▾'));
  const toggle = () => {
    if (ui.expanded.has(it.id)) { ui.expanded.delete(it.id); if (it.lock) relock(it); } else ui.expanded.add(it.id);
    app.render();
  };
  r1.addEventListener('click', toggle);
  r1.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  el.append(r1);
  // drag and drop: apăsare lungă pe rândul 1 (sau mânerul ≡ în modul Mutare) – reordonare sau mutare pe o pastilă/folder/tab
  let grip = r1;
  if (ui.dragMode) { grip = h('span', { class: 'dnd-handle', role: 'button', 'aria-label': t('dragToReorder'), 'data-test': 'drag-handle' }, '≡'); r1.prepend(grip); }
  draggable(el, {
    handle: grip, axis: 'y', container: () => el.parentNode, selector: ':scope > .card[data-id]:not(.folder-row)',
    immediate: () => !!ui.dragMode,
    onReorder: ids => app.reorderItems(ids),
    onDrop: tg => app.dropItem(it, tg),
    canDrop: tg => app.canDropItem(it, tg),
    onCancel: () => app.render(),
  });

  // ---- Rândul 2 ----
  if (open) {
    const r2 = h('div', { class: 'r2', role: 'button', tabindex: 0, 'aria-label': t('openItem') });
    r2.append(row2(it, d, K));
    r2.addEventListener('click', e => { if (e.target.closest('a,button,audio,input')) return; app.openEditor(it.tab, it); });
    el.append(r2);
  }
  return el;
}

function row2(it, d, K) {
  if (it.kind === 'task') return taskRow2(it, d);
  if (it.kind === 'law') return lawRow2(it, d);
  if (it.kind === 'rec') return recRow2(it, d);
  if (K.row2) return K.row2(it, d);
  return h('div', { class: 'r2-meta' }, fmtTsDate(it.updated));
}

function taskRow2(it, d) {
  const rest = String(d.text || '').split('\n').slice(1).join('\n').trim();
  const box = h('div', { class: 'r2-col' });
  if (rest) box.append(h('div', { class: 'r2-text pre' }, rest));
  box.append(h('div', { class: 'r2-meta' }, d.date ? `${fmtDate(d.date)}${d.time ? ' • ' + d.time : ''}` : t('noDate'), d.alarm ? ' • ⏰' : '', d.files?.length ? ` • 📷 ${d.files.length}` : ''));
  if (d.subs && d.subs.length) {
    const ul = h('div', { class: 'subs' });
    d.subs.forEach((s, i) => {
      ul.append(h('div', { class: 'sub' + (s.done ? ' done' : '') },
        h('button', { class: 'circ sm' + (s.done ? ' on' : ''), type: 'button', 'aria-label': t('markDone'), onclick: e => {
          e.stopPropagation();
          const subs = d.subs.map((x, j) => j === i ? { ...x, done: !x.done } : x);
          act(e.currentTarget, () => saveItem(it, { ...d, subs }));
        } }, s.done ? '✓' : ''),
        h('span', { class: 'sub-t' }, s.text)));
    });
    box.append(ul);
  }
  return box;
}

function lawRow2(it, d) {
  return h('div', { class: 'r2-col' },
    h('div', { class: 'r2-line' }, d.source ? h('span', { class: 'pill src' }, d.source) : null,
      d.actDate ? h('span', { class: 'r2-meta' }, t('actFrom', { d: fmtDate(d.actDate) })) : null),
    d.notes ? h('div', { class: 'r2-text' }, d.notes) : null,
    h('div', { class: 'r2-actions' },
      d.url && /^https?:\/\//.test(d.url) ? h('a', { class: 'btn sm', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, t('openLink')) : null,
      h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, () => saveToSaved(it, d)) }, t('saveLink')),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => shareText(d.title, `${d.title}\n${d.source || ''}${d.actDate ? ' • ' + fmtDate(d.actDate) : ''}\n${d.url || ''}`) }, t('share'))));
}

export async function saveToSaved(it, d) {
  const saved = liveTabs().find(x => x.kind === 'saved');
  if (!saved) { toast(t('noSavedTab')); return; }
  const dup = [...state.items.values()].find(x => x.tab === saved.id && !x.trashedAt && x.kind === 'law' && dataOf(x)?.url === d.url);
  if (dup) { toast(t('alreadySaved')); return; }
  await newItem(saved.id, 'law', { ...d }, { sub: 'salvate' });
  toast(t('savedOk'));
}

// Icoană Share Android/Material (trei puncte legate), desenată ca SVG cu același stil de linioară ca butoanele din antet.
// Nu am găsit o descriere sau o captură exactă a icoanei din Notis în referința comportamentală sau în atașamente.
function shareIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const el = (name, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  svg.append(
    el('circle', { cx: '18', cy: '5', r: '2.4' }),
    el('circle', { cx: '6', cy: '12', r: '2.4' }),
    el('circle', { cx: '18', cy: '19', r: '2.4' }),
    el('path', { d: 'M8.2 10.7L15.7 6.4' }),
    el('path', { d: 'M8.2 13.3L15.7 17.6' }),
  );
  return svg;
}

function recRow2(it, d) {
  // Înregistrările făcute doar ca text (transcriere pe telefon) nu au fișier audio.
  const audio = d.mid ? h('audio', { controls: true, preload: 'none', class: 'rec-audio' }) : null;
  if (audio) getMedia(d.mid).then(m => { if (m) audio.src = URL.createObjectURL(m.blob); else audio.replaceWith(h('div', { class: 'r2-meta' }, t('mediaMissing'))); });
  return h('div', { class: 'r2-col' },
    h('div', { class: 'rec-r2-head' },
      h('span', { class: 'rec-r2-case', 'data-test': 'rec-case' }, d.caseNumber || t('recNoCase')),
      h('span', { class: 'rec-r2-len', 'data-test': 'rec-len' }, recLen(d.duration)),
      h('span', { class: 'pill rec-st', 'data-test': 'rec-row-status' }, d.status || '—'),
      h('button', { class: 'icon-btn sm trash', type: 'button', 'aria-label': t('delete'), 'data-test': 'rec-row-delete', onclick: () => app.deleteItem(it) }, '🗑️')),
    h('div', { class: 'r2-meta' }, fmtTsDate(d.at || it.created)),
    audio,
    d.transcript ? h('div', { class: 'r2-text pre' }, d.transcript) : h('div', { class: 'r2-meta' }, t('noTranscript')),
    h('div', { class: 'r2-actions rec-actions' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => app.renameRec(it) }, t('rename')),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'rec-archive', onclick: () => app.archiveRec(it) }, t('archive')),
      h('button', { class: 'icon-btn share', type: 'button', 'aria-label': t('share'), title: t('share'), 'data-test': 'rec-share', onclick: () => shareRecording(it, d) }, shareIcon()),
      h('button', { class: 'icon-btn trash', type: 'button', 'aria-label': t('delete'), 'data-test': 'rec-delete', onclick: () => app.deleteItem(it) }, '🗑️')));
}
export const extOf = mime => (/ogg/.test(mime) ? '.ogg' : /mp4|aac|m4a/.test(mime) ? '.m4a' : /webm/.test(mime) ? '.webm' : /jpeg/.test(mime) ? '.jpg' : /png/.test(mime) ? '.png' : /pdf/.test(mime) ? '.pdf' : '');
