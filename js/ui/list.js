// Liste cu 2 rânduri: inițial doar rândul 1; atingerea lui deschide/închide rândul 2; atingerea rândului 2 deschide elementul.
import { h, fmtDate, fmtTsDate, fmtDur, act, onLongPress } from '../core/util.js';
import { t } from '../core/i18n.js';
import { KINDS, stagePill, recLen } from '../tabs/kinds.js';
import { state, dataOf, canView, locksChain, isOpen, unlockTemp, relock, saveItem, newItem, liveTabs, getMedia, trash } from '../core/store.js';
import { pinDlg, toast, promptDlg, sheet, confirmDlg } from './modal.js';
import { pickColor, openAspectSheet, applyColorToItems, applyAspectToItem, applyCardLook } from '../features/appearance.js';
import { app } from './registry.js';
import { shareText, shareRecording } from '../features/share.js';
import { draggable } from './dnd.js';

export const ui = { expanded: new Set(), selecting: false, dragMode: false, selected: new Set() };

const TAG_PALETTE = [
  { name: 'Galben pal', bg: '#fef3c7', fg: '#78350f', border: '#fde68a' },
  { name: 'Verde pal', bg: '#dcfce7', fg: '#14532d', border: '#bbf7d0' },
  { name: 'Albastru pal', bg: '#dbeafe', fg: '#1e3a8a', border: '#bfdbfe' },
  { name: 'Roz pal', bg: '#fce7f3', fg: '#831843', border: '#fbcfe8' },
  { name: 'Lavandă pal', bg: '#f3e8ff', fg: '#581c87', border: '#e9d5ff' },
  { name: 'Piersică pal', bg: '#ffedd5', fg: '#7c2d12', border: '#fed7aa' },
  { name: 'Mentă pal', bg: '#ccfbf1', fg: '#134e4a', border: '#99f6e4' },
  { name: 'Gri pal', bg: '#f1f5f9', fg: '#334155', border: '#cbd5e1' }
];

function getSavedTagColors() {
  try { return JSON.parse(localStorage.getItem('lso_tag_colors') || '{}'); } catch { return {}; }
}

function saveTagColors(map) {
  try { localStorage.setItem('lso_tag_colors', JSON.stringify(map)); } catch {}
}

function allExistingTags() {
  const set = new Set();
  for (const it of state.items.values()) {
    if (it.trashedAt || !canView(it)) continue;
    const d = dataOf(it);
    if (d && Array.isArray(d.tags)) {
      for (const tg of d.tags) if (tg && String(tg).trim()) set.add(String(tg).trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ro', { sensitivity: 'base' }));
}

export async function openTagsPicker(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [items].filter(Boolean);
  if (!list.length) return false;

  const existingTags = allExistingTags();
  const colorMap = getSavedTagColors();
  const activeSet = new Set();

  if (list.length === 1) {
    const d = dataOf(list[0]);
    if (d && Array.isArray(d.tags)) d.tags.forEach(tg => activeSet.add(String(tg).trim()));
  } else {
    const firstD = dataOf(list[0]);
    const firstTags = new Set(Array.isArray(firstD?.tags) ? firstD.tags.map(x => String(x).trim()) : []);
    for (const tg of firstTags) {
      if (list.every(it => Array.isArray(dataOf(it)?.tags) && dataOf(it).tags.includes(tg))) activeSet.add(tg);
    }
  }

  let selectedColorIdx = 0;

  return new Promise(resolve => {
    const old = document.getElementById('lso-tags-overlay');
    if (old) old.remove();

    const overlay = h('div', {
      id: 'lso-tags-overlay',
      style: {
        position: 'fixed', inset: '0', zIndex: 150, background: 'rgba(23,21,18,0.52)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '12px'
      }
    });

    const box = h('div', {
      style: {
        width: '100%', maxWidth: '460px', maxHeight: '85vh', overflowY: 'auto',
        background: '#f6f3eb', color: '#1f1b13', border: '1.5px solid #c9a243',
        borderRadius: '18px', padding: '14px', boxShadow: '0 14px 36px rgba(0,0,0,0.32)',
        display: 'grid', gap: '10px'
      }
    });

    const head = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h('strong', { style: { fontSize: '1.05rem', color: '#171512' } },
        list.length > 1 ? `Etichete (${list.length} selectate)` : 'Etichete'),
      h('button', {
        type: 'button',
        style: { width: '32px', height: '32px', borderRadius: '999px', border: '1px solid #d4c6a3', background: '#fff', fontSize: '18px', cursor: 'pointer' },
        onclick: () => { overlay.remove(); resolve(false); }
      }, '×')
    );

    const chipsWrap = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '30px' } });
    const knownSet = new Set([...existingTags, ...activeSet]);

    function renderChips() {
      chipsWrap.innerHTML = '';
      if (!knownSet.size) {
        chipsWrap.append(h('div', { style: { fontSize: '0.84rem', color: '#665d4c' } }, 'Nicio etichetă creată încă. Scrie mai jos una nouă.'));
        return;
      }
      for (const tg of [...knownSet].sort((a, b) => a.localeCompare(b, 'ro', { sensitivity: 'base' }))) {
        const isOn = activeSet.has(tg);
        const pal = TAG_PALETTE[colorMap[tg] ?? 0] || TAG_PALETTE[0];
        const chip = h('button', {
          type: 'button',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '5px 10px', borderRadius: '999px', fontSize: '0.85rem', fontWeight: isOn ? '700' : '500',
            background: isOn ? pal.bg : '#fff',
            color: isOn ? pal.fg : '#4a4232',
            border: isOn ? `1.5px solid ${pal.fg}` : '1px solid #d4c6a3',
            cursor: 'pointer'
          },
          onclick: () => {
            if (activeSet.has(tg)) activeSet.delete(tg);
            else {
              activeSet.add(tg);
              if (colorMap[tg] == null) colorMap[tg] = selectedColorIdx;
            }
            renderChips();
          }
        }, (isOn ? '✓ ' : '+ ') + tg);
        chipsWrap.append(chip);
      }
    }

    const paletteRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: '0.8rem', color: '#5c5343', marginRight: '2px' } }, 'Culoare:')
    );
    const swatchBtns = [];
    TAG_PALETTE.forEach((p, idx) => {
      const sw = h('button', {
        type: 'button', title: p.name,
        style: {
          width: '24px', height: '24px', borderRadius: '999px', background: p.bg,
          border: idx === selectedColorIdx ? `2px solid ${p.fg}` : `1px solid ${p.border}`,
          cursor: 'pointer'
        },
        onclick: () => {
          selectedColorIdx = idx;
          swatchBtns.forEach((b, j) => { b.style.border = j === idx ? `2px solid ${TAG_PALETTE[j].fg}` : `1px solid ${TAG_PALETTE[j].border}`; });
        }
      });
      swatchBtns.push(sw);
      paletteRow.append(sw);
    });

    const newInput = h('input', {
      type: 'text', placeholder: 'Etichetă nouă...', autocomplete: 'off',
      style: {
        flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '10px',
        border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.92rem'
      }
    });

    const addNewBtn = h('button', {
      type: 'button',
      style: {
        padding: '8px 12px', borderRadius: '10px', border: '1px solid #c9a243',
        background: '#fffdf7', color: '#171512', fontWeight: '600', cursor: 'pointer'
      },
      onclick: () => {
        const parts = newInput.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return;
        for (const p of parts) {
          knownSet.add(p);
          activeSet.add(p);
          colorMap[p] = selectedColorIdx;
        }
        newInput.value = '';
        renderChips();
      }
    }, 'Adaugă');

    newInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addNewBtn.click(); }
    });

    const addRow = h('div', { style: { display: 'flex', gap: '6px' } }, newInput, addNewBtn);

    const saveBtn = h('button', {
      type: 'button',
      style: {
        padding: '10px 14px', borderRadius: '12px', border: 'none', background: '#c9a243',
        color: '#171512', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer'
      },
      onclick: async () => {
        if (newInput.value.trim()) addNewBtn.click();
        saveTagColors(colorMap);
        const chosen = [...activeSet];
        for (const it of list) {
          const d = dataOf(it) || {};
          if (list.length === 1) {
            await saveItem(it, { ...d, tags: chosen });
          } else {
            const prev = Array.isArray(d.tags) ? d.tags : [];
            const merged = [...new Set([...prev, ...chosen])];
            await saveItem(it, { ...d, tags: merged });
          }
        }
        toast('Etichete salvate');
        overlay.remove();
        resolve(true);
      }
    }, 'Salvează etichetele');

    renderChips();
    box.append(head, chipsWrap, paletteRow, addRow, saveBtn);
    overlay.append(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    document.body.append(overlay);
  });
}

export async function askUnlock(obj, title) {
  const ok = await pinDlg(title || t('unlock'), { verify: pin => unlockTemp(obj, pin) });
  return !!ok;
}

export async function ensureOpen(it) {
  for (const l of locksChain(it).reverse()) {
    if (isOpen(l)) continue;
    if (!(await askUnlock(l, t('unlockNamed', { n: l.tab ? (l.kind === 'folder' ? (dataOf(l)?.name || t('kindFolder')) : t('lockedItem')) : l.name })))) return false;
  }
  return canView(it);
}

export const SORT_MODES = ['alpha', 'manual', 'created', 'modified', 'processDate', 'clientName'];
export const sortModeOf = tabId => { const m = (state.ui.sort || {})[tabId]; return SORT_MODES.includes(m) ? m : 'manual'; };
const titleOf = it => { const d = dataOf(it); return d ? String((KINDS[it.kind] || KINDS.note).title(d) || '') : ''; };
export function byMode(mode) {
  if (mode === 'alpha') return (a, b) => titleOf(a).localeCompare(titleOf(b), 'ro', { sensitivity: 'base', numeric: true });
  if (mode === 'created') return (a, b) => (b.created || 0) - (a.created || 0);
  if (mode === 'modified') return (a, b) => (b.updated || 0) - (a.updated || 0);
  if (mode === 'processDate') return (a, b) => {
    const da = dataOf(a)?.processDate || dataOf(a)?.date || '';
    const db = dataOf(b)?.processDate || dataOf(b)?.date || '';
    return da.localeCompare(db);
  };
  if (mode === 'clientName') return (a, b) => {
    const ca = (dataOf(a)?.client || dataOf(a)?.name || '').toLowerCase();
    const cb = (dataOf(b)?.client || dataOf(b)?.name || '').toLowerCase();
    return ca.localeCompare(cb, 'ro');
  };
  return null;
}

export function sortByTab(items, tabId) {
  const mode = sortModeOf(tabId);
  const cmp = byMode(mode);
  if (cmp) return items.slice().sort(cmp);
  const man = manualOf(tabId);
  return man ? items.slice().sort((a, b) => (man.get(a.id) ?? -1) - (man.get(b.id) ?? -1)) : items;
}

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
    if (!!da?.pinned !== !!db?.pinned) return da?.pinned ? -1 : 1;
    if (manual) {
      if (kindName === 'task' && !!da.done !== !!db.done) return da.done ? 1 : -1;
      if (K.past) { const pa = !!K.past(da), pb = !!K.past(db); if (pa !== pb) return pa ? 1 : -1; }
      const ia = manual.get(a.id) ?? -1, ib = manual.get(b.id) ?? -1;
      if (ia !== ib) return ia - ib;
    }
    if (cmp) {
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
    if (it.kind === 'separator') {
      wrap.append(separatorCard(it));
      continue;
    }
    const d = canView(it) ? dataOf(it) : null;
    if (d && it.kind === 'task' && d.done && !doneSep) { doneSep = true; wrap.append(h('div', { class: 'sep-label' }, t('doneTasks'))); }
    if (d && KINDS[it.kind]?.past?.(d) && !pastSep) { pastSep = true; wrap.append(h('div', { class: 'sep-label' }, t('pastDeadlines'))); }
    wrap.append(card(it));
  }
}

function separatorCard(it) {
  const d = dataOf(it) || {};
  const el = h('div', { class: 'card separator', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: d.bg || 'transparent', border: 'none' } },
    h('hr', { style: { flex: 1, border: 'none', borderTop: '1px solid #d4af37', opacity: 0.5 } }),
    h('span', { style: { fontSize: '0.85rem', color: '#d4af37', whiteSpace: 'nowrap' } }, d.text || '—'),
    h('hr', { style: { flex: 1, border: 'none', borderTop: '1px solid #d4af37', opacity: 0.5 } })
  );
  onLongPress(el, async () => {
    const v = await sheet('Separator', [
      { label: 'Redenumește', value: 'ren' },
      { label: 'Schimbă fundal', value: 'bg' },
      { label: 'Șterge', value: 'del', cls: 'danger' }
    ]);
    if (v === 'ren') {
      const n = await promptDlg('Text', { value: d.text || '', multiline: true });
      if (n != null) await saveItem(it, { ...d, text: n });
    } else if (v === 'bg') {
      const c = prompt('Culoare fundal (#hex)', d.bg || '#f7efd4');
      if (c) await saveItem(it, { ...d, bg: c });
    } else if (v === 'del') {
      if (await confirmDlg('Ștergi separatorul?')) await trash(it);
    }
    app.render();
  });
  return el;
}

function renderTagsRow(d) {
  if (!d || !Array.isArray(d.tags) || !d.tags.length) return null;
  const colorMap = getSavedTagColors();
  const row = h('div', { class: 'tag-row', style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' } });
  d.tags.forEach(tg => {
    const pal = TAG_PALETTE[colorMap[tg] ?? 0] || TAG_PALETTE[0];
    row.append(h('span', {
      class: 'tag-chip',
      style: {
        background: pal.bg, color: pal.fg, border: `1px solid ${pal.border}`,
        borderRadius: '999px', padding: '1px 7px', fontSize: '0.74rem', fontWeight: '600'
      }
    }, tg));
  });
  return row;
}

export function card(it) {
  const K = KINDS[it.kind] || KINDS.note;
  const viewable = canView(it);
  const d = viewable ? dataOf(it) : null;
  const open = ui.expanded.has(it.id) && viewable;
  const el = h('div', { class: 'card' + (open ? ' open' : '') + (d && d.done ? ' done' : '') + (d && K.past?.(d) ? ' past' : ''), 'data-id': it.id, 'data-kind': it.kind });
  const tab = state.tabs.find(x => x.id === it.tab);
  if (tab && tab.color) el.style.setProperty('--accent', tab.color);
  applyCardLook(el, it);

  if (ui.selecting) {
    const sel = ui.selected.has(it.id);
    el.classList.toggle('selected', sel);
    const titleCol = h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
      h('div', { class: 'r1t' }, d ? K.title(d) : t('lockedItem')),
      renderTagsRow(d)
    );
    const gripSel = h('span', { class: 'dnd-handle', role: 'button', 'aria-label': t('dragToReorder') }, '≡');
    const r1Sel = h('div', { class: 'r1', onclick: () => { sel ? ui.selected.delete(it.id) : ui.selected.add(it.id); app.render(); } },
      gripSel,
      h('span', { class: 'sel-box' + (sel ? ' on' : '') }, sel ? '✓' : ''),
      titleCol
    );
    el.append(r1Sel);
    draggable(el, {
      handle: gripSel, axis: 'y', container: () => el.parentNode, selector: ':scope > .card[data-id]',
      immediate: () => true,
      onReorder: ids => app.reorderItems(ids),
      onDrop: tg => app.dropItem(it, tg),
      canDrop: tg => app.canDropItem(it, tg),
      onCancel: () => app.render(),
    });
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

  const titleWrap = h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
    h('div', { class: 'r1t' }, K.title(d)),
    renderTagsRow(d)
  );
  r1.append(titleWrap);

  const meta = h('span', { class: 'r1-meta' });
  if (it.lock) meta.append('🔓');
  if (it.alarmAt && it.alarmAt > Date.now()) meta.append('⏰');
  if (it.kind === 'task' && d.date) meta.append(h('span', { class: 'r1-small' }, fmtDate(d.date).slice(0, 5) + (d.time ? ' ' + d.time : '')));
  if (meta.childNodes.length) r1.append(meta);

  const dots = h('button', { class: 'icon-btn sm', type: 'button', style: { marginLeft: 'auto' }, 'aria-label': 'Meniu' }, '⋮');
  dots.addEventListener('click', e => { e.stopPropagation(); openItemMenu(it); });
  r1.append(dots);

  const toggle = () => {
    if (ui.expanded.has(it.id)) { ui.expanded.delete(it.id); if (it.lock) relock(it); } else ui.expanded.add(it.id);
    app.render();
  };
  r1.addEventListener('click', toggle);
  r1.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  el.append(r1);

  // Drag and drop activ pe orice document, dosar sau folder (direct de pe card)
  let grip = r1;
  if (ui.dragMode) { grip = h('span', { class: 'dnd-handle', role: 'button', 'aria-label': t('dragToReorder'), 'data-test': 'drag-handle' }, '≡'); r1.prepend(grip); }
  draggable(el, {
    handle: grip, axis: 'y', container: () => el.parentNode, selector: ':scope > .card[data-id]',
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

  if (d && d.pinned) {
    r1.prepend(h('span', { style: { marginRight: '6px', color: '#d4af37' } }, '📌'));
  }

  // Apăsare lungă: bifează elementul și activează selecția multiplă (mutare, culoare, etichete)
  if (!ui.dragMode) {
    onLongPress(el, () => {
      ui.selecting = true;
      ui.selected.add(it.id);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch {}
      app.render();
    }, 450);
  }

  return el;
}

async function openItemMenu(it) {
  const d = dataOf(it);
  const K = KINDS[it.kind] || KINDS.note;
  const current = d ? (K.title ? K.title(d) : d.name || d.text || '') : '';
  const v = await sheet('Acțiuni', [
    { label: 'Redenumește', value: 'ren', icon: '✏️' },
    { label: d?.pinned ? 'Desfixează' : 'Fixează sus', value: 'pin', icon: '📌' },
    { label: 'Alarmă', value: 'alarm', icon: '⏰' },
    { label: 'Share', value: 'share', icon: shareIcon() },
    { label: it.lock ? 'Deblochează' : 'Blochează', value: 'lock', icon: '🔒' },
    { label: 'Etichete', value: 'tags', icon: '🏷️' },
    { label: t('color'), value: 'color', icon: '🎨' },
    { label: t('aspect'), value: 'aspect', icon: 'Aa' },
    { label: 'Șterge', value: 'del', icon: '🗑', cls: 'danger' }
  ]);
  if (v === 'ren') {
    const n = await promptDlg('Redenumește', { value: current });
    if (n && n.trim()) {
      if (it.kind === 'folder') await saveItem(it, { ...d, name: n.trim() });
      else if (d) await saveItem(it, { ...d, name: n.trim(), text: n.trim() });
      toast('Redenumit');
    }
  } else if (v === 'pin') {
    await saveItem(it, { ...d, pinned: !d?.pinned });
    toast(d?.pinned ? 'Desfixat' : 'Fixat sus');
  } else if (v === 'alarm') toast('Alarmă (în dezvoltare)');
  else if (v === 'share') shareText(d?.title || d?.name || '', d?.text || '');
  else if (v === 'lock') toast('Blocare (folosește meniul existent)');
  else if (v === 'tags') {
    await openTagsPicker([it]);
  } else if (v === 'color') {
    const c = await pickColor(it.color || '');
    if (c != null) { await applyColorToItems([it], c); toast(t('savedOk')); }
  } else if (v === 'aspect') {
    const a = await openAspectSheet(it);
    if (a) { await applyAspectToItem(it, a); toast(t('savedOk')); }
  } else if (v === 'del') {
    if (await confirmDlg('Ștergi?', { danger: true })) await trash(it);
  }
  app.render();
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

function shareIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
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
  const audio = d.mid ? h('audio', { controls: true, preload: 'none', class: 'rec-audio' }) : (d.pendingFile ? h('div', { class: 'r2-meta' }, t('recPendingFile')) : null);
  if (audio) getMedia(d.mid).then(m => { if (m) audio.src = URL.createObjectURL(m.blob); else audio.replaceWith(h('div', { class: 'r2-meta' }, t('mediaMissing'))); });
  return h('div', { class: 'r2-col' },
    h('div', { class: 'rec-r2-head' },
      h('span', { class: 'rec-r2-case', 'data-test': 'rec-case' }, d.caseNumber || t('recNoCase')),
      h('span', { class: 'rec-r2-len', 'data-test': 'rec-len' }, recLen(d.duration)),
      h('span', { class: 'pill rec-st', 'data-test': 'rec-row-status' }, d.status || '—'),
      h('button', { class: 'icon-btn sm trash', type: 'button', 'aria-label': t('delete'), 'data-test': 'rec-row-delete', onclick: () => app.deleteItem(it) }, '🗑️')),
    h('div', { class: 'r2-meta' }, fmtTsDate(d.at || it.created)),
    audio,
    d.transcript ? h('div', { class: 'r2-text pre', 'data-test': 'rec-transcript' }, d.transcript) : h('div', { class: 'r2-meta' }, t('noTranscript')),
    d.mid ? h('div', { class: 'rec-tr-row' }, h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'rec-transcribe-file', onclick: e => act(e.currentTarget, () => app.transcribeRec(it)) }, '📝 ' + t('recTranscribeBtn'))) : null,
    h('div', { class: 'r2-actions rec-actions' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => app.renameRec(it) }, t('rename')),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'rec-archive', onclick: () => app.archiveRec(it) }, t('archive')),
      h('button', { class: 'icon-btn share', type: 'button', 'aria-label': t('share'), title: t('share'), 'data-test': 'rec-share', onclick: () => shareRecording(it, d) }, shareIcon()),
      h('button', { class: 'icon-btn trash', type: 'button', 'aria-label': t('delete'), 'data-test': 'rec-delete', onclick: () => app.deleteItem(it) }, '🗑️')));
}
export const extOf = mime => (/ogg/.test(mime) ? '.ogg' : /^audio\/aac/.test(mime) ? '.aac' : /wav/.test(mime) ? '.wav' : /mp4|aac|m4a/.test(mime) ? '.m4a' : /webm/.test(mime) ? '.webm' : /jpeg/.test(mime) ? '.jpg' : /png/.test(mime) ? '.png' : /pdf/.test(mime) ? '.pdf' : '');
