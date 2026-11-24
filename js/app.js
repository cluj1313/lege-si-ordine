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
import { listTemporary, createTemporary, deleteTemporary, updateTemporary } from './features/temporary.js';
import { saveSettings } from './core/store.js';
import { copyText, shareText } from './features/share.js';
import { openCalendar } from './features/calendar.js';
import { pickColor, applyColorToItems } from './features/appearance.js';
import { persistLso } from './features/appearance.js';

let newsCache = [];

function toTitleCaseRo(str) {
  return String(str || '').replace(/(^|[\s\-])([a-zăîâșț])/g, (_, sep, ch) => sep + ch.toUpperCase());
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
  renderTemporaryZone(tab);
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
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, button, .tabbar, .pill-row, .subtabs, .tmp-zone, #urgent-clock, .fabs')) return;
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

// Duce direct la element (din căutare sau alarmă), îl deschide și îl evidențiază.
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

let tmpExpanded = false;
let lastDictTempId = null;
const TMP_POS_KEY = 'lso_tmp_pos';
const TMP_GAP = 10;

function fabTopY() {
  const f = document.getElementById('fabs') || document.querySelector('.fabs');
  if (f) {
    const r = f.getBoundingClientRect();
    if (r.height) return r.top;
  }
  return window.innerHeight - 74;
}

function headerBottomY() {
  const tab = document.getElementById('tabbar');
  const hdr = document.querySelector('.top') || document.getElementById('hdr') || document.querySelector('header');
  const b1 = tab ? tab.getBoundingClientRect().bottom : 0;
  const b2 = hdr ? hdr.getBoundingClientRect().bottom : 0;
  return Math.max(b1, b2, 72);
}

function defaultTmpBottom() {
  return Math.max(0, window.innerHeight - fabTopY() + TMP_GAP);
}

function clampTmpBottom(bottom, boxH) {
  const minB = defaultTmpBottom();
  const maxB = window.innerHeight - headerBottomY() - Math.max(48, boxH || 56) - 8;
  return Math.max(minB, Math.min(Number(bottom) || minB, Math.max(minB, maxB)));
}

function savedTmpBottom() {
  try {
    const j = JSON.parse(localStorage.getItem(TMP_POS_KEY) || 'null');
    if (j && typeof j.bottom === 'number' && Number.isFinite(j.bottom)) return j.bottom;
  } catch {}
  return null;
}

function saveTmpBottom(bottom) {
  try { localStorage.setItem(TMP_POS_KEY, JSON.stringify({ bottom: Math.round(bottom) })); } catch {}
}

function applyTmpPos(box) {
  if (!box) return;
  const hgt = box.getBoundingClientRect().height || box.offsetHeight || 56;
  const raw = savedTmpBottom();
  const bottom = clampTmpBottom(raw == null ? defaultTmpBottom() : raw, hgt);
  box.style.bottom = bottom + 'px';
  const topLimit = headerBottomY() + 8;
  const boxBottomY = window.innerHeight - bottom;
  box.style.maxHeight = Math.max(56, boxBottomY - topLimit) + 'px';
}

function bindTmpDrag(box, title) {
  let pressTimer = 0;
  let drag = null;
  let origin = null;
  let skipClick = false;
  const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; } };
  const endDrag = () => {
    if (!drag) return;
    const bottom = clampTmpBottom(drag.bottom, box.getBoundingClientRect().height);
    saveTmpBottom(bottom);
    box.style.bottom = bottom + 'px';
    box.classList.remove('tmp-dragging');
    applyTmpPos(box);
    skipClick = true;
    drag = null;
  };
  title.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    origin = { x: e.clientX, y: e.clientY };
    const y0 = e.clientY;
    const id = e.pointerId;
    const startBottom = parseFloat(box.style.bottom) || defaultTmpBottom();
    clearPress();
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      drag = { y0, startBottom, bottom: startBottom };
      box.classList.add('tmp-dragging');
      try { title.setPointerCapture(id); } catch {}
      try { if (navigator.vibrate) navigator.vibrate(12); } catch {}
    }, 550);
  });
  title.addEventListener('pointermove', e => {
    if (pressTimer && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) clearPress();
    if (!drag) return;
    e.preventDefault();
    const dy = drag.y0 - e.clientY;
    drag.bottom = clampTmpBottom(drag.startBottom + dy, box.getBoundingClientRect().height);
    box.style.bottom = drag.bottom + 'px';
    const topLimit = headerBottomY() + 8;
    const boxBottomY = window.innerHeight - drag.bottom;
    box.style.maxHeight = Math.max(56, boxBottomY - topLimit) + 'px';
  });
  const stop = () => { clearPress(); if (drag) endDrag(); };
  title.addEventListener('pointerup', stop);
  title.addEventListener('pointercancel', stop);
  title.addEventListener('click', e => {
    if (skipClick) { e.preventDefault(); e.stopPropagation(); skipClick = false; }
  }, true);
  if (!window.__lsoTmpResize) {
    window.__lsoTmpResize = () => {
      const el = document.getElementById('temporary-zone');
      if (el) applyTmpPos(el);
    };
    window.addEventListener('resize', window.__lsoTmpResize);
  }
}

function renderTemporaryZone(tab) {
  const old = document.getElementById('temporary-zone');
  if (old) old.remove();
  if (!tab) return;
  if (ui.selecting) return;
  const items = listTemporary(tab.id);
  const box = h('div', { id: 'temporary-zone', class: 'tmp-zone', 'data-test': 'temporary-zone' });

  const listEl = h('div', { class: 'tmp-list', style: { display: tmpExpanded ? 'block' : 'none', marginTop: '8px' } });

  const header = h('div', { class: 'tmp-head' });
  const title = h('strong', { class: 'tmp-title', 'data-test': 'tmp-title' }, 'Temporar' + (items.length ? ` (${items.length})` : ''));
  title.onclick = (e) => {
    e.stopPropagation();
    tmpExpanded = !tmpExpanded;
    listEl.style.display = tmpExpanded ? 'block' : 'none';
    applyTmpPos(box);
  };
  header.append(title);

  // În Temporar rămâne DOAR semnul '+' pentru a deschide/crea rapid o notiță/fișier temporar
  const labels = { read: 'Citește', dict: 'Dictează', rec: 'Înregistrează' };
  const addBtn = h('button', { class: 'tmp-add', type: 'button', 'data-test': 'tmp-add', title: 'Notiță / fișier temporar nou', onclick: async (e) => {
    e.stopPropagation();
    const rec = createTemporary('', tab.id, ['read']);
    lastDictTempId = rec.id;
    tmpExpanded = true;
    render();
    await new Promise(r => setTimeout(r, 60));
    const ta = document.querySelector('[data-tmp-id="' + rec.id + '"] textarea') || document.querySelector('[data-test=tmp-note-ta]');
    if (ta) {
      setTarget(ta);
      try { ta.focus({ preventScroll: true }); } catch { try { ta.focus(); } catch {} }
    }
  } }, '+');
  header.append(addBtn);
  box.append(header);

  if (!items.length) {
    listEl.append(h('div', { style: { opacity: 0.6, fontSize: '0.88rem', padding: '6px 0' } }, 'Apasă + pentru o notiță temporară (în interior ai Citește, Dictează și Înregistrează).'));
  } else {
    items.forEach(it => {
      const lines = (it.text || '').split('\n');
      const rowTitle = lines[0] || '(notiță nouă)';
      const row = h('div', { class: 'tmp-item', style: {
        padding: '10px 4px', borderBottom: '1px solid rgba(212,175,55,0.25)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer'
      } });
      const left = h('div', { style: { flex: 1, minWidth: 0 } });
      const textSpan = h('div', { class: 'tmp-item-title', style: { fontSize: '1.05rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 } }, rowTitle);
      left.append(textSpan);
      if (it.modes && it.modes.length) {
        const modeLabel = it.modes.map(m => labels[m] || m).join(' · ');
        left.append(h('div', { style: { fontSize: '0.7rem', opacity: 0.7, marginTop: '2px' } }, modeLabel));
      }
      row.append(left);

      const delBtn = h('button', { type: 'button', style: {
        background: 'none', border: 'none', color: '#d4af37', fontSize: '16px', padding: '0 6px'
      }, onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmDlg('Ștergi notița temporară?', { danger: true }))) return;
        deleteTemporary(it.id);
        render();
      } }, '✕');
      const menuBtn = h('button', { type: 'button', class: 'tmp-item-menu', 'data-test': 'tmp-item-menu', 'aria-label': 'Acțiuni', title: 'Acțiuni' }, '⋯');
      const acts = h('div', { style: { display: 'flex', alignItems: 'flex-start', flexShrink: 0 } });
      acts.append(menuBtn, delBtn);
      row.append(acts);

      let fullOpen = false;
      const noteView = h('div', { class: 'tmp-note-text', 'data-test': 'tmp-note-text', style: { display: 'none', fontSize:
