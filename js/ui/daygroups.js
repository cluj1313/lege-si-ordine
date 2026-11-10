// Listă grupată pe zile (ca tabul Medicamente din Notis): un rând pe dată – data DD/MM/YYYY în stânga,
// un rezumat pe un singur rând în dreapta; atingerea deschide/închide toate elementele zilei.
import { h, fmtDate } from '../core/util.js';
import { ui } from './list.js';
import { app } from './registry.js';

export function renderDayGroups(wrap, items, { key, dateOf, summary, renderItem, empty, order }) {
  wrap.innerHTML = '';
  if (!items.length) { wrap.append(h('div', { class: 'empty' }, empty)); return; }
  const groups = new Map();
  for (const it of items) { const d = dateOf(it) || '0000-00-00'; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(it); }
  const days = [...groups.keys()].sort().reverse();
  for (const d of days) {
    const list = groups.get(d);
    const k = `day:${key}:${d}`;
    const open = ui.expanded.has(k) || ui.selecting; // în selecție/mutare zilele sunt deschise
    const row = h('div', { class: 'day-row', role: 'button', tabindex: 0, 'aria-expanded': String(open), 'data-day': d },
      h('span', { class: 'day-date' }, d === '0000-00-00' ? '—' : fmtDate(d)),
      h('span', { class: 'day-sum' }, summary(list)),
      h('span', { class: 'chev' }, open ? '▴' : '▾'));
    const toggle = () => { open ? ui.expanded.delete(k) : ui.expanded.add(k); app.render(); };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    const box = h('div', { class: 'day-group' + (open ? ' open' : ''), 'data-day': d }, row);
    if (open) { const body = h('div', { class: 'day-body list' }); (order ? order(list) : list).forEach(it => body.append(renderItem(it))); box.append(body); }
    wrap.append(box);
  }
}
