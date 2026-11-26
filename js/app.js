// Controlerul aplicației: randare, navigare între taburi, poziție, selecție, FAB, ciclul de viață.
import { h, $, debounce, onLongPress } from './core/util.js';
import { t } from './core/i18n.js';
import { state, tabById, visibleTabs, liveTabs, saveUI, onChange, isOpen, relock, relockAll, item as getItem, trash, isHiddenByTrash, canView, dataOf, itemsOf, trashedAll, saveMeta, saveItem, newItem, relocate, unlockTemp } from './core/store.js';
import { db, S } from './core/db.js';
import { app } from './ui/registry.js';
import { renderTabBar, tabDrag } from './ui/tabsbar.js';
import { ui, ensureOpen, sortModeOf, SORT_MODES, saveManual } from './ui/list.js';
import { pickFolder, folderNameOf } from './ui/folderpick.js';
import { openEditor, openEditors, moveItem } from './ui/editor.js';
import { confirmDlg, toast, sheet, closeAll, modalsOpen, dropMenu, pinDlg, promptDlg } from './ui/modal.js';
import { renderGeneric, renderSaved, renderFolders, renderNews, renderLocked, currentFolder, newFolder, newsResults, renderMO, hasCats, savedSubs } from './tabs/views.js';
import { curCat, getCats } from './tabs/cats.js';
import { isoToday } from './core/util.js';
import { renderRecordings, startRecording, renameRec, archiveRec, recStatus, isRecording, stopRecording, transcribeRec } from './tabs/recordings.js';
import { openSearch } from './features/search.js';
import { openTrash } from './features/trash.js';
import { openSettings, applyTheme } from './features/settings.js';
import { readScreenAloud, stopSpeak, isSpeaking, startDictation, stopDictation, isDictating, getTarget, setTarget, voiceMenu } from './features/voice.js';
import { KINDS, TAB_KINDS } from './tabs/kinds.js';
import { renderWidgets } from './features/widgets.js';
import { saveSettings } from './core/store.js';
import { copyText, shareText } from './features/share.js';
import { openCalendar } from './features/calendar.js';
import { pickColor, applyColorToItems } from './features/appearance.js';
import { persistLso } from './features/appearance.js';

let newsCache = [];

function toTitleCaseRo(str) {
  return String(str || '').replace(/(^|[\s\-])([a-zăîâșț])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function autoCapFirst(str) {
  const s = String(str || '');
  if (!s) return s;
  return s.replace(/^(\s*)([a-zăîâșț])/, (_, sp, ch) => sp + ch.toUpperCase());
}

export function currentTab() {
  let tab = tabById(state.ui.tab);
  if (!tab || tab.trashedAt || tab.visible === false) tab = visibleTabs()[0] || null;
  return tab;
}

const saveScroll = debounce(() => { const tb = currentTab(); if (tb) { state.ui.scroll[tb.id] = Math.round(window.scrollY); saveUI(); } }, 250);
window.addEventListener('scroll', () => { if (!rendering) saveScroll(); }, { passive: true });
let rendering = false;

export function render() {
  rendering = true;
  const tab = currentTab();
  const unseen = newsCache.filter(r => !r.seen).length;
  const newsTab = liveTabs().find(x => x.kind === 'news');
  renderTabBar($('#tabbar'), tab && tab.id, newsTab && unseen ? { [newsTab.id]: unseen } : {});
  const view = $('#view');
  const y = window.scrollY;
  view.innerHTML = '';
  view.dataset.kind = tab ? tab.kind : '';
  document.body.classList.toggle('selecting', ui.selecting);
  if (!tab) { view.append(h('div', { class: 'empty' }, t('noTabs'))); renderFab(null); rendering = false; return; }
  if (tab.lock && !isOpen(tab)) renderLocked(view, tab, tab.name);
  else if (tab.kind === 'news') renderNews(view, tab, newsCache);
  else if (tab.kind === 'folders') renderFolders(view, tab);
  else if (tab.kind === 'saved') renderSaved(view, tab);
  else if (tab.kind === 'rec') renderRecordings(view, tab);
  else if (tab.kind === 'mo') renderMO(view, tab);
  else renderGeneric(view, tab);
  renderFab(tab);
  renderSelBar();
  const oldTmp = document.getElementById('temporary-zone');
  if (oldTmp) oldTmp.remove();
  renderUrgentClock(tab);
  renderWidgets();
  enableSwipeTabs();
  enableEmptySpaceMenu();
  window.scrollTo(0, y);
  rendering = false;
}

// Ținere scurtă pe spațiu gol → meniu aspect
function enableEmptySpaceMenu() {
  const view = document.getElementById('view');
  if (!view || view.dataset.emptyMenu) return;
  view.dataset.emptyMenu = '1';
  let timer;
  view.addEventListener('pointerdown', e => {
    if (e.target.closest('.card, button, a, input, .fab, .pill, .news-sec-header')) return;
    timer = setTimeout(async () => {
      const tab = currentTab();
      if (!tab) return;
      const v = await sheet('Aspect', [
        { label: 'Mărime font', value: 'font' },
        { label: 'Culoare font', value: 'color' },
        { label: 'Spațiere rânduri', value: 'spacing' },
        { label: 'Schimbă fundal', value: 'bg' },
        { label: 'Resetare', value: 'reset', cls: 'danger' }
      ]);
      if (v === 'font') {
        const s = prompt('Mărime font (sm / md / lg)', state.settings.fontScale || 'md');
        if (s) { state.settings.fontScale = s; applyTheme(); await saveSettings(); }
      } else if (v === 'color') {
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.onchange = async () => { state.settings.textColor = picker.value; applyTheme(); await saveSettings(); };
        picker.click();
      } else if (v === 'spacing') {
        const sp = prompt('Spațiere (1.0 - 2.0)', '1.3');
        if (sp) { state.settings.lineHeight = sp; applyTheme(); await saveSettings(); }
      } else if (v === 'bg') {
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.onchange = async () => { state.settings.bgColor = picker.value; state.settings.bgType = 'color'; applyTheme(); await saveSettings(); };
        picker.click();
      } else if (v === 'reset') {
        delete state.settings.textColor;
        delete state.settings.lineHeight;
        state.settings.fontScale = 'md';
        state.settings.bgType = 'light';
        applyTheme(); await saveSettings();
      }
      app.render();
    }, 500);
  });
  view.addEventListener('pointerup', () => clearTimeout(timer));
  view.addEventListener('pointercancel', () => clearTimeout(timer));
  view.addEventListener('pointermove', () => clearTimeout(timer));
}

function enableSwipeTabs() {
  if (document.body.dataset.swipeTabsBound) return;
  document.body.dataset.swipeTabsBound = '1';
  let startX = 0, startY = 0, tracking = false;
  document.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
    if (modalsOpen() || isSpeaking() || ui.selecting || ui.dragMode) return;
    const t0 = e.touches[0];
    if (t0.clientY < 110 || t0.clientY > window.innerHeight - 95) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, button, .tabbar, .pill-row, .subtabs, #urgent-clock, .fabs')) return;
    startX = t0.clientX;
    startY = t0.clientY;
    tracking = true;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!tracking || !e.changedTouches || !e.changedTouches.length) return;
    tracking = false;
    const t1 = e.changedTouches[0];
    const dx = t1.clientX - startX;
    const dy = Math.abs(t1.clientY - startY);
    if (Math.abs(dx) > 54 && Math.abs(dx) > dy * 1.25) {
      const tabs = visibleTabs();
      const cur = currentTab();
      if (!cur || !tabs.length) return;
      const idx = tabs.findIndex(x => x.id === cur.id);
      if (dx < 0 && idx < tabs.length - 1) goTab(tabs[idx + 1].id);
      if (dx > 0 && idx > 0) goTab(tabs[idx - 1].id);
    }
  }, { passive: true });
  document.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
}

function goTab(id, keepScroll) {
  const prev = currentTab();
  if (prev) state.ui.scroll[prev.id] = Math.round(window.scrollY);
  const next = id ? tabById(id) : visibleTabs()[0];
  if (prev && next && prev.id !== next.id) {
    if (prev.lock && isOpen(prev)) relock(prev);
    const cf = prev.kind === 'folders' && currentFolder(prev);
    if (cf && cf.lock) { relock(cf); state.ui.folder[prev.id] = cf.folder || null; }
    ui.selecting = false; ui.dragMode = false; ui.selected.clear();
  }
  state.ui.tab = next ? next.id : null;
  saveUI();
  render();
  if (!keepScroll) window.scrollTo(0, (next && state.ui.scroll[next.id]) || 0);
}

export async function reveal(id) {
  const it = getItem(id);
  if (!it) return;
  if (it.trashedAt || isHiddenByTrash(it)) { openTrash(it.trashedAt ? it.id : null); return; }
  const tab = tabById(it.tab);
  if (tab.visible === false) { tab.visible = true; await (await import('./core/store.js')).saveTab(tab); }
  if (!(await ensureOpen(it))) return;
  if (tab.kind === 'folders') state.ui.folder[tab.id] = it.kind === 'folder' ? it.id : (it.folder || null);
  if (tab.kind === 'saved' && it.sub) state.ui.sub[tab.id] = it.sub;
  if (it.kind !== 'folder' && it.kind !== 'term') ui.expanded.add(it.id);
  goTab(tab.id, { keepScroll: true });
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }
  });
}

export async function deleteItem(it) {
  const K = KINDS[it.kind] || KINDS.note;
  const name = canView(it) ? K.title(dataOf(it)) : t('lockedItem');
  if (!(await confirmDlg(t('confirmTrash', { n: name }), { danger: true }))) return false;
  await trash(it);
  ui.expanded.delete(it.id);
  toast(t('movedToTrash'));
  return true;
}

let clockTimer = 0;
function isClockOn() {
  if (state.settings && state.settings.showClock === false) return false;
  try { if (localStorage.getItem('lso_showClock') === '0') return false; } catch {}
  return true;
}
async function setClockOn(on) {
  state.settings.showClock = !!on;
  try { localStorage.setItem('lso_showClock', on ? '1' : '0'); } catch {}
  await saveSettings();
}

function todayIsoLocal() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

function formatAlarmDateRo(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

function formatRepeatLabel(a) {
  const every = Math.max(1, parseInt(a.repeatEvery, 10) || 1);
  if (a.repeatType === 'hours') return every === 1 ? 'La fiecare oră' : `La ${every} ore`;
  if (a.repeatType === 'days') return every === 1 ? 'Zilnic' : `La ${every} zile`;
  return '';
}

function alarmTimestamp(a) {
  const dateStr = (a && /^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) ? a.date : todayIsoLocal();
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = String(a.time || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
}

function advanceRecurringAlarm(a, nowMs) {
  const every = Math.max(1, parseInt(a.repeatEvery, 10) || 1);
  const stepMs = a.repeatType === 'hours' ? every * 3600000 : every * 86400000;
  let nextMs = alarmTimestamp(a);
  if (isNaN(nextMs)) nextMs = nowMs;
  while (nextMs <= nowMs) nextMs += stepMs;
  const dt = new Date(nextMs);
  a.date = [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0')
  ].join('-');
  a.time = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
  a.fired = false;
}

function syncWidgetAlarmState(list) {
  const alarms = Array.isArray(list) ? list : loadQuickAlarms();
  const activeAlarms = alarms
    .filter(a => a && a.time && !a.fired)
    .sort((a, b) => alarmTimestamp(a) - alarmTimestamp(b));
  const inactiveCount = alarms.filter(a => a && a.fired).length;
  const activeCount = activeAlarms.length;
  const next = activeAlarms[0] || null;
  const payload = {
    activeCount,
    inactiveCount,
    ringColor: activeCount > 0 ? 'green' : 'red',
    nextTime: next ? next.time : '',
    nextDate: next ? (next.date || todayIsoLocal()) : '',
    nextPerson: next ? (next.person || '') : '',
    updatedAt: Date.now()
  };
  try { localStorage.setItem('lso_widget_state', JSON.stringify(payload)); } catch {}
  try {
    if (window.LsoWidgetBridge && typeof window.LsoWidgetBridge.updateWidget === 'function') {
      window.LsoWidgetBridge.updateWidget(JSON.stringify(payload));
    }
  } catch {}
  return payload;
}

function loadQuickAlarms() {
  try {
    const list = JSON.parse(localStorage.getItem('lso_alarms') || '[]');
    if (!Array.isArray(list)) return [];
    const fallbackDate = todayIsoLocal();
    return list.map(a => ({
      ...a,
      date: (a && /^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) ? a.date : fallbackDate,
      repeatType: (a && (a.repeatType === 'hours' || a.repeatType === 'days')) ? a.repeatType : 'none',
      repeatEvery: (a && a.repeatEvery) ? Math.max(1, parseInt(a.repeatEvery, 10) || 1) : 1
    }));
  } catch {
    return [];
  }
}

function saveQuickAlarms(list) {
  try { localStorage.setItem('lso_alarms', JSON.stringify(list)); } catch {}
  syncWidgetAlarmState(list);
}

function showAlarmBanner(a) {
  const old = document.getElementById('lso-alarm-ringing');
  if (old) old.remove();
  const dateTxt = formatAlarmDateRo(a.date);
  const repTxt = formatRepeatLabel(a);
  const metaParts = [a.person || 'Alarmă', dateTxt, repTxt].filter(Boolean);
  const banner = h('div', {
    id: 'lso-alarm-ringing',
    style: {
      position: 'fixed', top: '14px', left: '12px', right: '12px', zIndex: '1200',
      background: '#171512', color: '#fffdf9', border: '2px solid #f4b942',
      borderRadius: '16px', padding: '14px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column', gap: '8px'
    }
  },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
      h('strong', { style: { fontSize: '1.1rem', color: '#f4b942' } }, `⏰ ALARMĂ · ${a.time}`),
      h('button', {
        type: 'button', class: 'btn sm primary',
        style: { background: '#f4b942', color: '#171512', border: 'none', fontWeight: '700' },
        onclick: () => banner.remove()
      }, 'OK')
    ),
    h('div', { style: { fontSize: '1rem', fontWeight: '700' } }, metaParts.join(' · ')),
    a.note ? h('div', { style: { fontSize: '0.92rem', opacity: '0.9', background: 'rgba(255,255,255,0.08)', padding: '8px 10px', borderRadius: '8px' } }, a.note) : null
  );
  document.body.append(banner);
}

function openQuickAlarmDialog(tab) {
  const existing = document.getElementById('lso-qa-overlay');
  if (existing) existing.remove();

  const now = new Date();
  now.setMinutes(now.getMinutes() + 15);
  const defDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const defTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const overlay = h('div', { id: 'lso-qa-overlay', style: {
    position: 'fixed', inset: '0', zIndex: 140, background: 'rgba(23,21,18,0.52)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '12px'
  } });

  const box = h('div', { style: {
    width: '100%', maxWidth: '460px', maxHeight: '85vh', overflowY: 'auto',
    background: '#f6f3eb', color: '#1f1b13', border: '1.5px solid #c9a243',
    borderRadius: '18px', padding: '14px', boxShadow: '0 14px 36px rgba(0,0,0,0.32)',
    display: 'grid', gap: '10px'
  } });

  const head = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
    h('strong', { style: { fontSize: '1.08rem', color: '#171512' } }, 'Alarme rapide'),
    h('button', { type: 'button', style: {
      width: '32px', height: '32px', borderRadius: '999px', border: '1px solid #d4c6a3',
      background: '#fff', fontSize: '18px', cursor: 'pointer'
    }, onclick: () => overlay.remove() }, '×')
  );

  const iName = h('input', { type: 'text', autocapitalize: 'words', placeholder: 'Nume și prenume (atinge pentru notă)', autocomplete: 'off', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem'
  } });
  iName.addEventListener('input', () => {
    const pos = iName.selectionStart;
    const tc = toTitleCaseRo(iName.value);
    if (tc !== iName.value) {
      iName.value = tc;
      try { iName.setSelectionRange(pos, pos); } catch {}
    }
  });

  const noteWrap = h('div', { style: { display: 'none' } });
  const iNote = h('input', { type: 'text', autocapitalize: 'sentences', placeholder: 'Notă mică: despre ce este vorba când sună alarma...', autocomplete: 'off', style: {
    width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: '10px',
    border: '1.5px solid #c9a243', background: '#fffdf7', color: '#1f1b13', fontSize: '0.88rem'
  } });
  iNote.addEventListener('input', () => {
    const capped = autoCapFirst(iNote.value);
    if (capped !== iNote.value) {
      const pos = iNote.selectionStart;
      iNote.value = capped;
      try { iNote.setSelectionRange(pos, pos); } catch {}
    }
  });
  noteWrap.append(iNote);
  iName.addEventListener('click', () => { noteWrap.style.display = 'block'; });
  iName.addEventListener('focus', () => { noteWrap.style.display = 'block'; });

  const iDate = h('input', { type: 'date', value: defDate, 'aria-label': 'Data alarmei', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem'
  } });

  const iTime = h('input', { type: 'time', value: defTime, 'aria-label': 'Ora alarmei', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem'
  } });

  const gridDateTime = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, iDate, iTime);

  const iRepeatType = h('select', { 'aria-label': 'Repetiție alarmă', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.93rem'
  } },
    h('option', { value: 'none' }, 'Fără repetiție'),
    h('option', { value: 'hours' }, 'Repetă la (ore)'),
    h('option', { value: 'days' }, 'Repetă la (zile)')
  );

  const iRepeatEvery = h('input', { type: 'number', min: '1', max: '365', value: '1', inputMode: 'numeric', placeholder: 'Nr.', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem',
    display: 'none'
  } });

  const gridRepeat = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr', gap: '8px' } }, iRepeatType, iRepeatEvery);
  iRepeatType.addEventListener('change', () => {
    const hasRep = iRepeatType.value !== 'none';
    iRepeatEvery.style.display = hasRep ? 'block' : 'none';
    gridRepeat.style.gridTemplateColumns = hasRep ? '2fr 1fr' : '1fr';
  });

  const saveBtn = h('button', { type: 'button', style: {
    padding: '10px 14px', borderRadius: '12px', border: 'none', background: '#c9a243',
    color: '#171512', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer'
  } }, 'Salvează alarma');

  const listWrap = h('div', { style: { display: 'grid', gap: '6px', marginTop: '4px' } });

  function drawAlarmsList() {
    listWrap.innerHTML = '';
    const alarms = loadQuickAlarms().sort((a, b) => {
      if (!!a.fired !== !!b.fired) return a.fired ? 1 : -1;
      return alarmTimestamp(a) - alarmTimestamp(b);
    });
    if (!alarms.length) {
      listWrap.append(h('div', { style: { fontSize: '0.84rem', color: '#665d4c', padding: '4px 2px' } }, 'Nicio alarmă salvată.'));
      return;
    }
    alarms.forEach(item => {
      const isInactive = !!item.fired;
      const row = h('div', { style: {
        display: 'flex', flexDirection: 'column', borderRadius: '10px',
        background: isInactive ? '#f4efe3' : '#fff',
        border: isInactive ? '1px solid #dfd3bc' : '1px solid #e5dcc9',
        opacity: isInactive ? '0.78' : '1',
        overflow: 'hidden'
      } });

      const line = h('div', { style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px', minHeight: '38px', padding: '6px 8px 6px 10px'
      } });

      const dateStr = formatAlarmDateRo(item.date);
      const repStr = formatRepeatLabel(item);
      const badgeText = [dateStr, repStr].filter(Boolean).join(' · ');

      const trigger = h('button', { type: 'button', 'aria-expanded': 'false', style: {
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px',
        padding: 0, border: 'none', background: 'transparent', color: '#1f1b13',
        textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden'
      } },
        h('span', { style: { fontWeight: 700, fontSize: '0.9rem', color: isInactive ? '#8b3a3a' : '#171512', flexShrink: 0 } }, item.time || '--:--'),
        h('span', { style: { fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.person || 'Alarmă'),
        badgeText ? h('span', { style: { fontSize: '0.76rem', color: '#665d4c', flexShrink: 0, marginLeft: 'auto' } }, badgeText) : null
      );

      const drawer = h('div', { style: { display: 'none', padding: '0 10px 8px 10px' } },
        h('div', { style: {
          fontSize: '0.82rem', color: '#4a4232', background: '#f8f3e6',
          padding: '6px 8px', borderRadius: '8px', borderLeft: '2.5px solid #c9a243',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'
        } },
          h('span', {}, item.note || 'Nicio notă adăugată.'),
          isInactive ? h('button', {
            type: 'button',
            style: {
              padding: '4px 8px', borderRadius: '8px', border: '1px solid #c9a243',
              background: '#fff', color: '#171512', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0
            },
            onclick: () => {
              const all = loadQuickAlarms();
              const found = all.find(x => x.id === item.id);
              if (found) {
                found.fired = false;
                if (alarmTimestamp(found) <= Date.now()) found.date = todayIsoLocal();
                saveQuickAlarms(all);
                drawAlarmsList();
                renderUrgentClock(tab);
              }
            }
          }, 'Reactivează') : null
        )
      );

      trigger.addEventListener('click', () => {
        const willOpen = drawer.style.display === 'none';
        drawer.style.display = willOpen ? 'block' : 'none';
        trigger.setAttribute('aria-expanded', String(willOpen));
      });

      const delBtn = h('button', { type: 'button', title: 'Șterge', style: {
        width: '28px', height: '28px', borderRadius: '999px', border: '1px solid #e2d8c3',
        background: '#faf7f0', color: '#5c5343', fontSize: '15px', cursor: 'pointer', flexShrink: 0
      }, onclick: () => {
        const next = loadQuickAlarms().filter(x => x.id !== item.id);
        saveQuickAlarms(next);
        drawAlarmsList();
        renderUrgentClock(tab);
      } }, '×');

      line.append(trigger, delBtn);
      row.append(line, drawer);
      listWrap.append(row);
    });
  }

  saveBtn.addEventListener('click', () => {
    const person = toTitleCaseRo(iName.value.trim());
    const date = iDate.value || todayIsoLocal();
    const rawTime = iTime.value.trim();
    const time = normalizeAlarm(rawTime) || rawTime;
    const repeatType = iRepeatType.value || 'none';
    const repeatEvery = repeatType === 'none' ? 1 : Math.max(1, parseInt(iRepeatEvery.value, 10) || 1);
    const note = autoCapFirst(iNote.value.trim());
    if (!time) { toast('Alege ora alarmei'); return; }
    const alarms = loadQuickAlarms();
    alarms.push({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      person: person || 'Alarmă',
      date,
      time,
      repeatType,
      repeatEvery,
      note,
      fired: false
    });
    saveQuickAlarms(alarms);
    iName.value = '';
    iNote.value = '';
    iRepeatType.value = 'none';
    iRepeatEvery.value = '1';
    iRepeatEvery.style.display = 'none';
    gridRepeat.style.gridTemplateColumns = '1fr';
    noteWrap.style.display = 'none';
    toast(`Alarmă salvată: ${formatAlarmDateRo(date)}, ${time}`);
    drawAlarmsList();
    renderUrgentClock(tab);
  });

  drawAlarmsList();
  box.append(head, iName, noteWrap, gridDateTime, gridRepeat, saveBtn, listWrap);
  overlay.append(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  setTimeout(() => iName.focus(), 40);
}

function renderUrgentClock(tab) {
  const old = document.getElementById('urgent-clock');
  if (old) old.remove();
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = 0; }
  const allAlarms = loadQuickAlarms();
  syncWidgetAlarmState(allAlarms);
  if (!isClockOn()) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  let nextLabel = 'fără alarmă';
  try {
    const alarms = allAlarms
      .filter(a => a && a.time && !a.fired)
      .sort((a, b) => alarmTimestamp(a) - alarmTimestamp(b));
    if (alarms.length) {
      const a = alarms[0];
      const shortDate = a.date ? a.date.slice(8, 10) + '.' + a.date.slice(5, 7) : '';
      nextLabel = '⏰ ' + a.time + (shortDate ? ' · ' + shortDate : '');
    }
  } catch {}
  const clk = h('div', { id: 'urgent-clock', style: {
    background: 'rgba(23,21,18,0.95)', color: '#d4af37', border: '1.5px solid #c9a243',
    cursor: 'pointer', textAlign: 'left', minWidth: '94px', zIndex: '65',
    boxShadow: '0 6px 18px rgba(0,0,0,0.22)'
  } });
  clk.append(h('div', { style: { fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.05, color: '#f4b942' } }, timeStr));
  clk.append(h('div', { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '2px', color: '#e6decb' } }, nextLabel));

  let pressT = 0, long = false;
  clk.addEventListener('pointerdown', () => {
    long = false;
    pressT = setTimeout(async () => {
      long = true;
      await setClockOn(false);
      toast(t('showClock') + ': Nu');
      render();
    }, 650);
  });
  clk.addEventListener('pointerup', () => clearTimeout(pressT));
  clk.addEventListener('pointercancel', () => clearTimeout(pressT));
  clk.addEventListener('click', e => {
    if (long) { e.stopPropagation(); e.preventDefault(); return; }
    openQuickAlarmDialog(tab);
  });
  document.body.append(clk);
  clockTimer = setTimeout(() => renderUrgentClock(tab), 15000);
}

function normalizeAlarm(raw) {
  const s = String(raw || '').trim().replace(/[.,\s]/g, '');
  if (!s) return null;
  let h, m;
  if (/^\d{3,4}$/.test(s)) {
    if (s.length === 3) { h = s.slice(0,1); m = s.slice(1); }
    else { h = s.slice(0,2); m = s.slice(2); }
  } else if (/^\d{1,2}:\d{2}$/.test(raw)) {
    [h, m] = raw.split(':');
  } else return null;
  h = parseInt(h, 10); m = parseInt(m, 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Checker de alarmă – verifică data și ora, aplică repetiția la X ore/zile sau trece în inactivă
setInterval(() => {
  try {
    const now = new Date();
    const nowMs = now.getTime();
    const today = todayIsoLocal();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const cur = hh + ':' + mm;
    const alarms = loadQuickAlarms();
    let changed = false;
    for (const a of alarms) {
      if (!a || a.fired) continue;
      const dueDate = a.date || today;
      const isDueNow = dueDate === today && a.time === cur;
      const isOverdue = alarmTimestamp(a) < nowMs - 60000;
      if (isDueNow || isOverdue) {
        changed = true;
        if (isDueNow) {
          showAlarmBanner({ ...a });
          try { if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 400]); } catch {}
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = 880; g.gain.value = 0.35;
            o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 750);
          } catch {}
        }
        if (a.repeatType === 'hours' || a.repeatType === 'days') {
          advanceRecurringAlarm(a, nowMs);
        } else {
          a.fired = true;
        }
      }
    }
    if (changed) {
      saveQuickAlarms(alarms);
      const tb = currentTab();
      if (tb) renderUrgentClock(tb);
    }
  } catch {}
}, 5000);
// ---- FAB-uri Overlay: „+” și Microfonul peste toate paginile și dosarele ----
function renderFab(tab) {
  const fabs = $('#fabs');
  fabs.innerHTML = '';
  if (ui.selecting || ui.dragMode || modalsOpen()) return;
  if (tab && !(tab.lock && !isOpen(tab)) && tab.kind !== 'news') {
    fabs.append(h('button', { class: 'fab add', type: 'button', 'aria-label': t('add'), 'data-test': 'fab-add', onclick: () => fabAdd(tab) }, '+'));
  }
  const vb = h('button', { class: 'fab voice' + (isDictating() ? ' live' : '') + (isRecording() ? ' rec' : ''), type: 'button', 'aria-label': t('voice'), 'data-test': 'fab-voice', onclick: () => voiceFab(tab) }, '🎙');
  onLongPress(vb, () => voiceMenu());
  fabs.append(vb);
}

async function fabAdd(tab) {
  if (tab.kind === 'folders') {
    const cur = currentFolder(tab);
    const v = await sheet(t('add'), [
      { label: t('newNote'), value: 'note', icon: '📝' },
      { label: cur ? t('newSubfolder') : t('newFolder'), value: 'folder', icon: '+' },
      { label: 'Separator', value: 'separator', icon: '—' }
    ]);
    if (v === 'note') openEditor(tab.id, null, { folder: cur ? cur.id : null, kind: 'note' });
    if (v === 'folder') newFolder(tab, cur);
    if (v === 'password') { const { openPasswordEditor } = await import('./features/passwords.js'); openPasswordEditor(); }
    if (v === 'separator') await newItem(tab.id, 'separator', { text: 'Secțiune' }, { folder: cur ? cur.id : null });
  } else if (tab.kind === 'saved') {
    const sub = state.ui.sub[tab.id] || 'salvate';
    openEditor(tab.id, null, { sub });
  } else if (tab.kind === 'rec') {
    isRecording() ? stopRecording() : startRecording(tab.id);
  } else if (tab.kind === 'mo') openEditor(tab.id, null, { kind: 'law', preset: { actDate: isoToday(), source: 'Monitorul Oficial' } });
  else if (hasCats(tab)) { const c = curCat(tab); openEditor(tab.id, null, { cat: c === 'all' ? null : c }); }
  else openEditor(tab.id, null);
}

async function voiceFab(tab) {
  if (isDictating()) { stopDictation(); render(); return; }
  if (isSpeaking()) { stopSpeak(); return; }
  const v = await sheet(t('voice'), [
    { label: t('voiceRead'), value: 'read', icon: '🔊' },
    { label: t('voiceDictation'), value: 'dict', icon: '🗣' },
    { label: isRecording() ? t('recStop') : t('voiceRecord'), value: 'rec', icon: '🔴' },
    { label: t('voiceSettings'), value: 'set', icon: '⚙' },
  ]);
  if (v === 'read') {
    await readScreenAloud();
  }
  else if (v === 'dict') {
    let target = getTarget();
    if (!target || !document.body.contains(target)) {
      const openTa = document.querySelector('.m-overlay:not(.buried) textarea, .m-overlay:not(.buried) input[type="text"]');
      if (openTa) { target = openTa; setTarget(target); }
    }
    if (!target && tab && !(tab.lock && !isOpen(tab)) && !['news', 'rec'].includes(tab.kind)) {
      if (tab.kind === 'folders') await openEditor(tab.id, null, { folder: currentFolder(tab)?.id || null, kind: 'note' });
      else await openEditor(tab.id, null, tab.kind === 'saved' ? { sub: state.ui.sub[tab.id] || 'salvate' } : {});
      target = document.querySelector('.editor textarea.voice-target');
      if (target) setTarget(target);
    }
    if (!target) { toast(t('dictNoTarget'), 3000); return; }
    target.focus();
    if (await startDictation(target)) render();
  } else if (v === 'rec') {
    const rt = liveTabs().find(x => x.kind === 'rec');
    if (isRecording()) { stopRecording(); return; }
    if (rt) { goTab(rt.id); startRecording(rt.id); } else toast(t('noRecTab'));
  } else if (v === 'set') voiceMenu();
}

// ---- Selecție multiplă (mutare, culoare, etichete, fixare, ștergere) ----
function renderSelBar() {
  const bar = $('#selbar');
  bar.innerHTML = '';
  if (!ui.selecting && !ui.dragMode) { bar.hidden = true; return; }
  bar.hidden = false;
  if (ui.dragMode) {
    bar.append(
      h('span', { class: 'sel-hint' }, t('dragModeHint')),
      h('button', { class: 'btn sm primary', type: 'button', 'data-test': 'drag-done', onclick: () => endDragMode() }, t('done')));
    return;
  }
  const selectedItems = () => [...ui.selected].map(getItem).filter(Boolean);
  bar.append(
    h('span', { class: 'sel-count' }, t('nSelected', { n: ui.selected.size })),
    h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'sel-move', disabled: !ui.selected.size, onclick: async () => {
      const ids = selectedItems(); if (!ids.length) return;
      const dest = await pickFolder({ title: t('menuMove'), confirmLabel: t('move') });
      if (!dest) return;
      const folderId = dest.id || dest.folder || null;
      const tabId = dest.tab || (dest.id && getItem(dest.id) && getItem(dest.id).tab) || currentTab()?.id;
      for (const it of ids) await relocate(it, { tab: tabId || it.tab, folder: folderId });
      ui.selected.clear(); ui.selecting = false; toast(t('movedN', { n: ids.length, d: folderNameOf(dest) || '' })); render();
    } }, t('move')),
    h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'sel-color', disabled: !ui.selected.size, onclick: async () => {
      const ids = selectedItems(); if (!ids.length) return;
      const c = await pickColor(ids[0].color || '');
      if (c == null) return;
      await applyColorToItems(ids, c); toast(t('savedOk')); render();
    } }, t('color')),
    h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'sel-tags', disabled: !ui.selected.size, onclick: async () => {
      const ids = selectedItems(); if (!ids.length) return;
      const mod = await import('./ui/list.js');
      if (typeof mod.openTagsPicker === 'function') {
        const ok = await mod.openTagsPicker(ids);
        if (ok) { ui.selected.clear(); ui.selecting = false; render(); }
      }
    } }, 'Etichete'),
    h('button', { class: 'btn sm ghost', type: 'button', 'data-test': 'sel-pin', disabled: !ui.selected.size, onclick: async () => {
      const ids = selectedItems(); if (!ids.length) return;
      for (const it of ids) { const d = dataOf(it) || {}; await saveItem(it, { ...d, pinned: true }); }
      toast(t('pinnedOn')); render();
    } }, '📌'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { document.querySelectorAll('#view .card[data-id]').forEach(c => { const it = getItem(c.dataset.id); if (it) ui.selected.add(c.dataset.id); }); render(); } }, t('selectAll')),
    h('button', { class: 'btn sm ghost', type: 'button', disabled: !ui.selected.size, onclick: async () => {
      const ids = selectedItems();
      if (!ids.length) return;
      if (!(await confirmDlg(t('confirmTrashN', { n: ids.length }), { danger: true }))) return;
      for (const it of ids) await trash(it);
      ui.selected.clear(); ui.selecting = false; toast(t('movedToTrash')); render();
    } }, t('delete')),
    h('button', { class: 'btn sm primary', type: 'button', 'data-test': 'sel-cancel', onclick: () => { ui.selecting = false; ui.selected.clear(); render(); } }, t('anuleaza')));
}

function header() {
  for (const [id, k] of [['hdr-search', 'search'], ['hdr-folders', 'tkFolders'], ['hdr-select', 'selectOn'], ['hdr-settings', 'settings'], ['hdr-menu', 'menu']]) { const b = $('#' + id); if (!b) continue; b.setAttribute('aria-label', t(k)); b.title = t(k); }
  $('#hdr-search').onclick = () => openSearch();
  // Butonul Folder de sus: creează direct Folder nou (pe Foldere) sau Dosar nou (pe Dosare)
  $('#hdr-folders').onclick = async () => {
    const tab = currentTab();
    if (tab && tab.kind === 'folders') {
      await newFolder(tab, currentFolder(tab));
    } else if (tab && tab.kind === 'case') {
      await openEditor(tab.id, null);
    } else {
      const caseTab = liveTabs().find(x => x.kind === 'case');
      const foldTab = liveTabs().find(x => x.kind === 'folders');
      const opts = [];
      if (caseTab) opts.push({ label: 'Dosar nou', value: 'case', icon: '📁' });
      if (foldTab) opts.push({ label: 'Folder nou', value: 'folder', icon: '📂' });
      if (!opts.length) return;
      const choice = opts.length === 1 ? opts[0].value : await sheet('Creează', opts);
      if (choice === 'case' && caseTab) {
        if (caseTab.visible === false) caseTab.visible = true;
        goTab(caseTab.id);
        await openEditor(caseTab.id, null);
      } else if (choice === 'folder' && foldTab) {
        if (foldTab.visible === false) foldTab.visible = true;
        goTab(foldTab.id);
        await newFolder(foldTab, currentFolder(foldTab));
      }
    }
  };
  $('#hdr-select').onclick = () => { ui.selecting = !ui.selecting; ui.dragMode = false; ui.selected.clear(); render(); toast(ui.selecting ? t('selectOn') : t('selectOff')); };
  const calBtn = $('#hdr-calendar');
  if (calBtn) { calBtn.onclick = () => openCalendar(); calBtn.setAttribute('aria-label', t('calendar')); calBtn.title = t('calendar'); }
  $('#hdr-brand').onclick = () => { if (!modalsOpen()) openSettings(); };
  $('#hdr-menu').onclick = async e => {
    const tab = currentTab();
    const mode = tab ? sortModeOf(tab.id) : 'manual';
    const sortable = !!tab && !(tab.lock && !isOpen(tab)) && tab.kind !== 'news';
    const v = await dropMenu(e.currentTarget, [
      { label: t('menuTrash', { n: trashedAll().length }), value: 'trash', icon: '🗑️', test: 'menu-trash' },
      { label: t('menuMove'), value: 'move', icon: '⇄', test: 'menu-move', disabled: !sortable },
      { header: t('menuSort') },
      ...SORT_MODES.map(m => ({ label: t({ alpha: 'sortAlpha', manual: 'sortManual', created: 'sortCreated', modified: 'sortModified' }[m]), value: 'sort:' + m, check: m === mode, test: 'sort-' + m, disabled: !sortable })),
    ], { test: 'hdr-dropmenu' });
    if (!v) return;
    if (v === 'trash') openTrash();
    else if (v === 'move') startDragMode();
    else if (v.startsWith('sort:') && tab) {
      state.ui.sort = { ...(state.ui.sort || {}), [tab.id]: v.slice(5) };
      await saveUI(); render();
    }
  };
}

// ---- Mutare prin drag and drop ----
function startDragMode() { ui.dragMode = true; ui.selecting = false; ui.selected.clear(); render(); toast(t('dragModeHint'), 3500); }
export function endDragMode() { ui.dragMode = false; tabDrag.on = false; render(); }

async function reorderItems(ids) {
  const tab = currentTab(); if (!tab) return;
  if (sortModeOf(tab.id) !== 'manual') { toast(t('reorderNeedsManual'), 3000); render(); return; }
  saveManual(tab.id, ids);
  await saveUI(); render();
}

const tabAccepts = (dest, it) => (TAB_KINDS[dest.kind] || {}).item === it.kind || (it.kind === 'note' && (dest.kind === 'folders' || dest.kind === 'saved'));
function parseDrop(tg) {
  const [type, id] = String(tg.dataset.drop || '').split(':');
  const row = tg.closest('[data-test]');
  return { type, id, row: row ? row.dataset.test : '' };
}
function canDropItem(it, tg) {
  const { type, id, row } = parseDrop(tg);
  if (type === 'tab') { const dest = tabById(id); return !!dest && dest.id !== it.tab && tabAccepts(dest, it); }
  if (type === 'folder') return it.folder !== id && it.id !== id;
  if (type === 'pill') {
    if (row === 'cat-row') return (it.cat || 'all') !== id;
    if (row === 'saved-row') return (it.sub || 'salvate') !== id;
    if (row === 'folder-row') return it.folder !== id && it.id !== id;
    if (row === 'rec-folder-row') return id === 'all' ? !!it.folder : it.folder !== id;
  }
  return false;
}
async function dropItem(it, tg) {
  if (!canDropItem(it, tg)) { toast(t('dropNotAllowed')); render(); return; }
  const { type, id, row } = parseDrop(tg);
  const name = (tg.querySelector('.pill-name, .tp-name, .r1t') || tg).textContent.trim();
  if (!(await confirmDlg(t('moveConfirm', { n: 1, d: name })))) { render(); return; }
  const intoFolder = async fid => {
    const f = getItem(fid);
    if (f && f.lock && !isOpen(f)) { const ok = await pinDlg(t('unlockNamed', { n: folderNameOf(f) }), { verify: pin => unlockTemp(f, pin) }); if (!ok) return false; }
    await relocate(it, { folder: fid }); return true;
  };
  let ok = true;
  if (type === 'tab') {
    const dest = tabById(id);
    if (dest.lock && !isOpen(dest)) { ok = !!(await pinDlg(t('unlockNamed', { n: dest.name }), { verify: pin => unlockTemp(dest, pin) })); }
    if (ok) await relocate(it, { tab: dest.id, folder: null, cat: null, sub: dest.kind === 'saved' ? 'salvate' : null });
  } else if (type === 'folder' || row === 'folder-row') ok = await intoFolder(id);
  else if (row === 'cat-row') { it.cat = id === 'all' ? null : id; await saveMeta(it); }
  else if (row === 'saved-row') { it.sub = id; await saveMeta(it); }
  else if (row === 'rec-folder-row') { if (id === 'all') await relocate(it, { folder: null }); else ok = await intoFolder(id); }
  if (ok) toast(t('movedN', { n: 1, d: name }), 3000);
  render();
}

async function onHidden() {
  const tb = currentTab(); if (tb) state.ui.scroll[tb.id] = Math.round(window.scrollY);
  await saveUI();
  if (!state.keys.size) return;
  for (const e of [...openEditors]) if (e.isLocked()) { try { await e.autosave(); } catch (err) { console.warn(err); } }
  relockAll();
}

export async function startApp() {
  Object.assign(app, { reorderItems, dropItem, canDropItem, endDragMode, tabDragOn: () => tabDrag.on, render, goTab, reveal, deleteItem, openEditor, openTrash, openSettings, openSearch, currentTab, renameRec, archiveRec, recStatus, startRecording, stopRecording, isRecording, transcribeRec });
  header();
  newsCache = await newsResults();
  onChange(() => { if (!rendering) render(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); });
  window.addEventListener('pagehide', () => { onHidden(); });

  try { history.pushState({ lsoTrap: 1 }, ''); } catch {}
  window.addEventListener('popstate', () => {
    try { history.pushState({ lsoTrap: 1 }, ''); } catch {}
    if (modalsOpen()) { closeAll(); render(); }
  });

  render();
  const tb = currentTab();
  if (tb) requestAnimationFrame(() => window.scrollTo(0, state.ui.scroll[tb.id] || 0));
}
