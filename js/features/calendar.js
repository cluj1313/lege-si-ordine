// Calendar lună/săptămână/an/zi, luni prima, zile ocupate (termene, taskuri cu dată, alarme).
import { h, fmtDate, isoToday } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, dataOf, canView, tabById } from '../core/store.js';
import { KINDS } from '../tabs/kinds.js';
import { openModal } from '../ui/modal.js';
import { app } from '../ui/registry.js';

const DOW = () => t('weekdaysShort').split(',');
const MONTHS = () => t('monthsLong').split(',');

const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parseIso = iso => {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return { y, m: m - 1, d };
};
const addDays = (iso, n) => {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m, d + n);
  return isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
};
const startOfWeek = iso => {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m, d);
  const wd = (dt.getDay() + 6) % 7; // Monday = 0
  dt.setDate(dt.getDate() - wd);
  return isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
};

export function datedItems() {
  const map = new Map();
  const push = (iso, rec) => {
    if (!iso) return;
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(rec);
  };
  for (const it of state.items.values()) {
    if (it.trashedAt || !canView(it)) continue;
    const d = dataOf(it);
    if (!d) continue;
    if (d.date) push(d.date, { it, d, type: it.kind });
  }
  try {
    const alarms = JSON.parse(localStorage.getItem('lso_alarms') || '[]');
    const today = isoToday();
    for (const a of alarms) if (a && a.time && !a.fired) push(a.date || today, { alarm: a, type: 'alarm' });
  } catch {}
  return map;
}

function itemTitle(rec) {
  if (rec.type === 'alarm') return t('calendarAlarm', { h: rec.alarm.time });
  const K = KINDS[rec.it.kind];
  const name = K && K.title ? K.title(rec.d) : (rec.d.title || rec.d.name || rec.d.text || t('untitled'));
  const time = rec.d.time ? ' • ' + rec.d.time : (rec.d.alarm ? ' • ⏰' : '');
  return String(name).split('\n')[0] + time;
}

export function openCalendar() {
  const today = isoToday();
  const st = { mode: 'month', cursor: today, selected: today };
  const body = h('div', { class: 'cal', 'data-test': 'calendar' });
  const m = openModal({
    title: t('calendar'),
    body,
    kind: 'page',
    cls: 'cal-page',
    onClose: () => {},
  });
  m.el.dataset.test = 'calendar-page';

  const draw = () => {
    body.innerHTML = '';
    const { y, m: mo } = parseIso(st.cursor);
    const modes = h('div', { class: 'cal-modes', role: 'tablist' },
      ...[['year', t('calYear')], ['month', t('calMonth')], ['week', t('calWeek')], ['day', t('calDay')]].map(([k, lab]) =>
        h('button', { class: 'cal-mode' + (st.mode === k ? ' on' : ''), type: 'button', 'data-test': 'cal-mode-' + k, onclick: () => { st.mode = k; draw(); } }, lab)
      )
    );
    const nav = h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn sm', type: 'button', 'data-test': 'cal-prev', onclick: () => { shift(-1); } }, '‹'),
      h('div', { class: 'cal-title', 'data-test': 'cal-title' }, heading()),
      h('button', { class: 'icon-btn sm', type: 'button', 'data-test': 'cal-next', onclick: () => { shift(1); } }, '›'),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'cal-today-btn', onclick: () => { st.cursor = today; st.selected = today; draw(); } }, t('calToday'))
    );
    body.append(modes, nav);
    const busy = datedItems();
    if (st.mode === 'year') body.append(yearGrid(y, busy));
    else if (st.mode === 'week') body.append(weekGrid(st.cursor, busy), dayList(st.selected, busy));
    else if (st.mode === 'day') body.append(dayList(st.selected, busy));
    else body.append(monthGrid(y, mo, busy), dayList(st.selected, busy));
  };

  function heading() {
    const { y, m } = parseIso(st.mode === 'day' || st.mode === 'week' ? st.selected : st.cursor);
    if (st.mode === 'year') return String(y);
    if (st.mode === 'day') return fmtDate(st.selected);
    if (st.mode === 'week') return t('calWeekOf', { d: fmtDate(startOfWeek(st.selected)) });
    return MONTHS()[m] + ' ' + y;
  }
  function shift(dir) {
    const { y, m, d } = parseIso(st.mode === 'day' || st.mode === 'week' ? st.selected : st.cursor);
    let dt = new Date(y, m, d);
    if (st.mode === 'year') dt = new Date(y + dir, 0, 1);
    else if (st.mode === 'month') dt = new Date(y, m + dir, 1);
    else if (st.mode === 'week') dt = new Date(y, m, d + dir * 7);
    else dt = new Date(y, m, d + dir);
    const iso = isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
    st.cursor = iso; st.selected = iso; draw();
  }

  function yearGrid(year, busy) {
    const wrap = h('div', { class: 'cal-year' });
    for (let m = 0; m < 12; m++) {
      const has = [...busy.keys()].some(iso => iso.startsWith(`${year}-${String(m + 1).padStart(2, '0')}-`));
      const b = h('button', { class: 'cal-year-m' + (has ? ' busy' : '') + (year === parseIso(today).y && m === parseIso(today).m ? ' today' : ''), type: 'button', onclick: () => { st.cursor = isoOf(year, m, 1); st.selected = st.cursor; st.mode = 'month'; draw(); } }, MONTHS()[m]);
      wrap.append(b);
    }
    return wrap;
  }

  function monthGrid(year, month, busy) {
    const wrap = h('div', { class: 'cal-month' });
    const dow = h('div', { class: 'cal-dow' });
    DOW().forEach(n => dow.append(h('div', {}, n)));
    wrap.append(dow);
    const first = new Date(year, month, 1);
    const startPad = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const grid = h('div', { class: 'cal-grid' });
    for (let i = 0; i < startPad; i++) grid.append(h('div', { class: 'cal-cell empty' }));
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(year, month, d);
      const ev = busy.get(iso) || [];
      const isToday = iso === today;
      const isSel = iso === st.selected;
      const color = ev[0] && ev[0].it && ev[0].it.color;
      const cell = h('button', {
        class: 'cal-cell' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + (ev.length ? ' busy' : ''),
        type: 'button',
        'data-iso': iso,
        'data-test': isToday ? 'cal-today' : 'cal-day',
        onclick: () => { st.selected = iso; st.cursor = iso; draw(); },
      }, h('span', { class: 'cal-num' }, String(d)));
      if (ev.length) {
        const badge = h('span', { class: 'cal-badge', style: color ? { background: color } : {} });
        cell.append(badge);
      }
      grid.append(cell);
    }
    wrap.append(grid);
    return wrap;
  }

  function weekGrid(iso, busy) {
    const start = startOfWeek(iso);
    const wrap = h('div', { class: 'cal-week' });
    const dow = h('div', { class: 'cal-dow' });
    DOW().forEach(n => dow.append(h('div', {}, n)));
    wrap.append(dow);
    const grid = h('div', { class: 'cal-grid cal-grid-week' });
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const ev = busy.get(day) || [];
      const { d } = parseIso(day);
      const cell = h('button', {
        class: 'cal-cell' + (day === today ? ' today' : '') + (day === st.selected ? ' sel' : '') + (ev.length ? ' busy' : ''),
        type: 'button', 'data-iso': day, 'data-test': 'cal-day',
        onclick: () => { st.selected = day; st.cursor = day; draw(); },
      }, h('span', { class: 'cal-num' }, String(d)));
      if (ev.length) cell.append(h('span', { class: 'cal-badge' }));
      grid.append(cell);
    }
    wrap.append(grid);
    return wrap;
  }

  function dayList(iso, busy) {
    const ev = busy.get(iso) || [];
    const box = h('div', { class: 'cal-list', 'data-test': 'cal-list' });
    box.append(h('div', { class: 'cal-list-h' }, fmtDate(iso)));
    if (!ev.length) {
      box.append(h('div', { class: 'r2-meta', 'data-test': 'cal-empty' }, t('calEmpty')));
      return box;
    }
    ev.forEach(rec => {
      const row = h('button', { class: 'cal-item', type: 'button', onclick: () => {
        if (rec.it) {
          m.close();
          const tab = tabById(rec.it.tab);
          if (tab && app.goTab) app.goTab(tab.id);
          if (app.openEditor) app.openEditor(rec.it.tab, rec.it);
        }
      } }, itemTitle(rec));
      box.append(row);
    });
    return box;
  }

  draw();
}
