// Componentă comună pentru rânduri orizontale derulabile de pastile compacte (și pentru foldere):
// derulare stânga-dreapta, „+” mereu la capătul din dreapta, „⋯” pentru foaia de vizibilitate/ordine.
import { h, onLongPress } from '../core/util.js';
import { t } from '../core/i18n.js';
import { openModal } from './modal.js';
import { draggable } from './dnd.js';

// Modul „Mutare” (meniul din dreapta sus): tragerea pornește imediat, fără apăsare lungă.
export const dndMode = { on: false };

export function pillRow({ items, activeId, onPick, onAdd, onItemMenu, onManage, onReorder, drop = true, variant = 'pill', test = '' }) {
  const row = h('div', { class: 'pill-row pr-pill', 'data-test': test || null, role: 'tablist' });
  for (const it of items) {
    // Doar pastile compacte pe un rând (nume + contor); fără icoane de folder.
    const b = h('button', { class: 'pill subtab' + (it.id === activeId ? ' active' : '') + (it.fixed ? ' fixed' : ''), type: 'button', 'data-id': it.id, 'data-drop': drop && it.droppable !== false ? 'pill:' + it.id : null, onclick: () => onPick(it) },
      it.locked ? h('span', { class: 'pill-lock', 'aria-hidden': 'true' }, '🔒') : null,
      h('span', { class: 'pill-name' }, it.name), it.count != null ? h('span', { class: 'cnt' }, String(it.count)) : null);
    // apăsare lungă fără mișcare = meniul pastilei; apăsare lungă + tragere = reordonare
    if (!it.fixed && (onItemMenu || onReorder)) draggable(b, {
      axis: 'x', container: row, selector: '.subtab[data-id]:not(.fixed)', scroller: row,
      onHold: () => onItemMenu && onItemMenu(it),
      onReorder: onReorder ? ids => onReorder(ids) : null,
    });
    row.append(b);
  }
  if (onManage) {
    const m = h('button', { class: 'pr-manage', type: 'button', 'aria-label': t('manageVisible'), title: t('manageVisible'), onclick: () => onManage() }, '⋯');
    row.append(m);
  }
  const add = h('button', { class: 'pill subtab add pr-add', type: 'button', 'aria-label': t('add'), onclick: () => onAdd() }, '+');
  if (onManage) onLongPress(add, () => onManage());
  row.append(add);
  const act = row.querySelector('.active');
  if (act) requestAnimationFrame(() => { const r = act.getBoundingClientRect(), br = row.getBoundingClientRect(); if (r.right > br.right || r.left < br.left) row.scrollLeft += r.left - br.left - 12; });
  return row;
}

// Ordine nouă pentru elementele vizibile (ids); cele ascunse își păstrează locul relativ.
export function mergeOrder(all, ids) {
  const set = new Set(ids);
  const queue = ids.map(id => all.find(x => x.id === id)).filter(Boolean);
  return all.map(x => (set.has(x.id) ? queue.shift() : x));
}

// Reordonare verticală prin pointer events (trage de ≡).
export function dragReorder(handle, row, list, onDone) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    row.classList.add('dragging');
    const move = ev => {
      const y = ev.clientY;
      let placed = false;
      for (const r of [...list.children].filter(r => r !== row)) {
        const b = r.getBoundingClientRect();
        if (y < b.top + b.height / 2) { if (row.nextSibling !== r) list.insertBefore(row, r); placed = true; break; }
      }
      if (!placed && list.lastElementChild !== row) list.append(row);
      const sc = list.closest('.m-body'); if (sc) { const sb = sc.getBoundingClientRect(); if (y < sb.top + 40) sc.scrollTop -= 12; else if (y > sb.bottom - 40) sc.scrollTop += 12; }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      onDone([...list.children].map(r => r.dataset.id));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}

// Foaie de jos: ce elemente sunt active/vizibile (bife) și în ce ordine (≡). onSave primește [{id, visible}] în ordine.
export function visibilitySheet(title, items, onSave) {
  return new Promise(res => {
    const state = items.map(i => ({ ...i }));
    const list = h('div', { class: 'tab-order' });
    for (const it of state) {
      const cb = h('input', { type: 'checkbox', checked: it.visible !== false, 'aria-label': t('showItem'), onchange: e => { it.visible = e.target.checked; } });
      const handle = h('span', { class: 'drag', role: 'button', 'aria-label': t('dragToReorder') }, '≡');
      const row = h('div', { class: 'to-row', 'data-id': it.id }, handle, cb, h('span', { class: 'to-name' }, it.name));
      dragReorder(handle, row, list, () => {});
      list.append(row);
    }
    let saved = false;
    const m = openModal({
      title, kind: 'sheet', cls: 'vis-sheet',
      body: h('div', {}, h('p', { class: 'r2-meta' }, t('visibilityHint')), list),
      actions: [{ label: t('done'), cls: 'primary', onClick: async m => {
        const order = [...list.children].map(r => r.dataset.id);
        const out = order.map(id => state.find(s => s.id === id));
        saved = true; await onSave(out); res(true); m.close();
      } }],
      onClose: () => { if (!saved) res(false); },
    });
    m.el.dataset.test = 'visibility';
  });
}
