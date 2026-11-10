// Liste cu 2 rânduri: inițial doar rândul 1; atingerea lui deschide/închide rândul 2; atingerea rândului 2 deschide elementul.
import { h, fmtDate, fmtTsDate, fmtDur, act } from '../core/util.js';
import { t } from '../core/i18n.js';
import { KINDS, stagePill } from '../tabs/kinds.js';
import { state, dataOf, canView, locksChain, isOpen, unlockTemp, relock, saveItem, newItem, liveTabs, getMedia } from '../core/store.js';
import { pinDlg, toast } from './modal.js';
import { app } from './registry.js';
import { shareText, shareFile } from '../features/share.js';

export const ui = { expanded: new Set(), selecting: false, selected: new Set() };

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

function sortItems(items, kindName) {
  const K = KINDS[kindName] || {};
  const vis = items.filter(canView), hid = items.filter(i => !canView(i));
  vis.sort((a, b) => {
    const da = dataOf(a), db = dataOf(b);
    if (kindName === 'law') return (a.order || 0) - (b.order || 0);
    if (kindName === 'task' && !!da.done !== !!db.done) return da.done ? 1 : -1;
    if (kindName === 'task' && da.done) return b.updated - a.updated;
    if (K.past) { const pa = !!K.past(da), pb = !!K.past(db); if (pa !== pb) return pa ? 1 : -1; if (pa) return -(K.sort(da, db)); }
    if (K.sort) { const r = K.sort(da, db); if (r) return r; }
    return (b.updated || 0) - (a.updated || 0);
  });
  return [...vis, ...hid];
}

export function renderList(wrap, items, { kind, empty } = {}) {
  wrap.innerHTML = '';
  if (!items.length) { wrap.append(h('div', { class: 'empty' }, empty || t('emptyList'))); return; }
  const sorted = sortItems(items, kind);
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
  if (it.kind === 'rec') { if (d.status) meta.append(h('span', { class: 'pill rec-st' }, d.status)); meta.append(fmtDur(d.duration)); }
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

function recRow2(it, d) {
  const audio = h('audio', { controls: true, preload: 'none', class: 'rec-audio' });
  getMedia(d.mid).then(m => { if (m) audio.src = URL.createObjectURL(m.blob); else audio.replaceWith(h('div', { class: 'r2-meta' }, t('mediaMissing'))); });
  return h('div', { class: 'r2-col' },
    h('div', { class: 'r2-meta' }, `${fmtTsDate(d.at || it.created)} • ${fmtDur(d.duration)}`),
    audio,
    d.transcript ? h('div', { class: 'r2-text pre' }, d.transcript) : h('div', { class: 'r2-meta' }, t('noTranscript')),
    h('div', { class: 'r2-actions' },
      h('div', { class: 'r2-actions-main' },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => app.renameRec(it) }, t('rename')),
        h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'rec-status', onclick: () => app.recStatus(it) }, t('recStatusBtn', { s: d.status || '—' })),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { const m = await getMedia(d.mid); if (m) shareFile(m.blob, (d.name || 'inregistrare') + extOf(m.mime), d.name); } }, t('share'))),
      h('button', { class: 'icon-btn sm trash', type: 'button', 'aria-label': t('delete'), 'data-test': 'rec-delete', onclick: () => app.deleteItem(it) }, '🗑️')));
}
export const extOf = mime => (/ogg/.test(mime) ? '.ogg' : /mp4|aac|m4a/.test(mime) ? '.m4a' : /webm/.test(mime) ? '.webm' : /jpeg/.test(mime) ? '.jpg' : /png/.test(mime) ? '.png' : /pdf/.test(mime) ? '.pdf' : '');
