// Componentă comună pentru rânduri orizontale derulabile (pastile sau foldere):
// derulare stânga-dreapta, „+” mereu la capătul din dreapta, „⋯” pentru foaia de vizibilitate/ordine.
import { h, onLongPress } from '../core/util.js';
import { t } from '../core/i18n.js';
import { openModal } from './modal.js';

export function pillRow({ items, activeId, onPick, onAdd, onItemMenu, onManage, variant = 'pill', test = '' }) {
  const row = h('div', { class: `pill-row pr-${variant}`, 'data-test': test || null, role: 'tablist' });
  for (const it of items) {
    let b;
    if (variant === 'folder') {
      b = h('button', { class: 'folder-tile' + (it.id === activeId ? ' active' : ''), type: 'button', 'data-id': it.id, onclick: () => onPick(it) },
        h('span', { class: 'ft-ic' }, h('img', { src: 'icons/folder.png', alt: '' }), it.locked ? h('i', { class: 'ft-lock' }, '🔒') : null),
        h('span', { class: 'ft-name' }, h('span', { class: 'ft-label' }, it.name), it.count != null ? h('span', { class: 'cnt' }, String(it.count)) : null));
    } else {
      b = h('button', { class: 'pill subtab' + (it.id === activeId ? ' active' : ''), type: 'button', 'data-id': it.id, onclick: () => onPick(it) },
        it.name, it.count != null ? h('span', { class: 'cnt' }, String(it.count)) : null);
    }
    if (onItemMenu && !it.fixed) onLongPress(b, () => onItemMenu(it));
    row.append(b);
  }
  if (onManage) {
    const m = h('button', { class: 'pr-manage', type: 'button', 'aria-label': t('manageVisible'), title: t('manageVisible'), onclick: () => onManage() }, '⋯');
    row.append(m);
  }
  const add = h('button', { class: variant === 'folder' ? 'folder-add pr-add' : 'pill subtab add pr-add', type: 'button', 'aria-label': t('add'), onclick: () => onAdd() }, '+');
  if (onManage) onLongPress(add, () => onManage());
  row.append(add);
  const act = row.querySelector('.active');
  if (act) requestAnimationFrame(() => { const r = act.getBoundingClientRect(), br = row.getBoundingClientRect(); if (r.right > br.right || r.left < br.left) row.scrollLeft += r.left - br.left - 12; });
  return row;
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
