// Câmpuri proprii de dată (DD/MM/YYYY, indiferent de localizare) și oră (HH:MM).
import { h, fmtDate, parseDMY, isoFromDate, validTime } from '../core/util.js';
import { t, months, weekdays } from '../core/i18n.js';
import { openModal } from './modal.js';

export function dateField(iso = '', { label = t('date') } = {}) {
  const inp = h('input', { class: 'inp date-inp', type: 'text', inputmode: 'numeric', placeholder: 'ZZ/LL/AAAA', maxlength: 10, autocomplete: 'off' });
  inp.value = fmtDate(iso);
  inp.addEventListener('input', () => {
    let d = inp.value.replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) d = d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    else if (d.length > 2) d = d.slice(0, 2) + '/' + d.slice(2);
    inp.value = d; inp.classList.remove('bad');
  });
  inp.addEventListener('blur', () => { if (inp.value && !parseDMY(inp.value)) inp.classList.add('bad'); });
  const cal = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('calendar'), onclick: () => calendar(parseDMY(inp.value) || '', v => { inp.value = fmtDate(v); inp.classList.remove('bad'); }) }, '📅');
  const clr = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('clear'), onclick: () => { inp.value = ''; inp.classList.remove('bad'); } }, '×');
  const el = h('label', { class: 'fld' }, h('span', {}, label), h('div', { class: 'row-inp' }, inp, cal, clr));
  return { el, inp, get: () => (inp.value ? parseDMY(inp.value) : ''), valid: () => !inp.value || !!parseDMY(inp.value) };
}

export function timeField(val = '', { label = t('time') } = {}) {
  const inp = h('input', { class: 'inp time-inp', type: 'text', inputmode: 'numeric', placeholder: 'HH:MM', maxlength: 5, autocomplete: 'off' });
  inp.value = val || '';
  inp.addEventListener('input', () => {
    let d = inp.value.replace(/\D/g, '').slice(0, 4);
    if (d.length > 2) d = d.slice(0, 2) + ':' + d.slice(2);
    inp.value = d; inp.classList.remove('bad');
  });
  inp.addEventListener('blur', () => { if (inp.value && !validTime(inp.value)) inp.classList.add('bad'); });
  const el = h('label', { class: 'fld fld-time' }, h('span', {}, label), inp);
  return { el, inp, get: () => (validTime(inp.value) ? inp.value : ''), valid: () => !inp.value || validTime(inp.value) };
}

export function calendar(iso, onPick) {
  let cur = iso ? new Date(iso + 'T00:00') : new Date();
  cur.setDate(1);
  const grid = h('div', { class: 'cal-grid' });
  const title = h('div', { class: 'cal-title' });
  const m = openModal({
    title: t('pickDate'), cls: 'cal-modal',
    body: h('div', { class: 'cal' },
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', type: 'button', onclick: () => { cur.setMonth(cur.getMonth() - 1); draw(); } }, '‹'),
        title,
        h('button', { class: 'icon-btn', type: 'button', onclick: () => { cur.setMonth(cur.getMonth() + 1); draw(); } }, '›')),
      grid),
    actions: [{ label: t('today'), cls: 'ghost', onClick: m => { onPick(isoFromDate(new Date())); m.close(); } }, { label: t('cancel'), cls: 'ghost', onClick: m => m.close() }],
  });
  function draw() {
    title.textContent = `${months()[cur.getMonth()]} ${cur.getFullYear()}`;
    grid.innerHTML = '';
    weekdays().forEach(w => grid.append(h('span', { class: 'cal-wd' }, w)));
    const first = (cur.getDay() + 6) % 7;
    for (let i = 0; i < first; i++) grid.append(h('span'));
    const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const today = isoFromDate(new Date());
    for (let d = 1; d <= days; d++) {
      const v = isoFromDate(new Date(cur.getFullYear(), cur.getMonth(), d));
      grid.append(h('button', { type: 'button', class: 'cal-d' + (v === today ? ' today' : '') + (v === iso ? ' sel' : ''), onclick: () => { onPick(v); m.close(); } }, d));
    }
  }
  draw();
}
