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
      const noteView = h('div', { class: 'tmp-note-text', 'data-test': 'tmp-note-text', style: { display: 'none', fontSize: '0.95rem', marginTop: '6px', whiteSpace: 'pre-wrap', opacity: 0.95 } }, it.text || '');
      const taNote = h('textarea', { class: 'tmp-note-ta', 'data-test': 'tmp-note-ta', 'data-tmp-id': it.id, placeholder: 'Scrie sau folosește microfonul activ din interior...', rows: 4 });
      taNote.value = it.text || '';
      taNote.style.display = 'none';
      const growTa = () => { taNote.style.height = 'auto'; taNote.style.height = Math.min(Math.max(taNote.scrollHeight, 72), 220) + 'px'; };
      taNote.addEventListener('input', () => {
        let v = taNote.value;
        if (v && /[a-zăîâșț]/.test(v[0])) {
          const pos = taNote.selectionStart;
          v = v[0].toUpperCase() + v.slice(1);
          taNote.value = v;
          try { taNote.setSelectionRange(pos, pos); } catch {}
        }
        updateTemporary(it.id, { text: taNote.value });
        growTa();
      });
      taNote.addEventListener('focus', () => setTarget(taNote));
      taNote.addEventListener('click', e => { e.stopPropagation(); setTarget(taNote); });

      // Bară internă activă cu Citire / Dictare / Înregistrare vocală direct în interiorul notiței
      const innerVoiceBar = h('div', { style: { display: 'none', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
        h('button', { type: 'button', class: 'tmp-btn', onclick: async e => {
          e.stopPropagation();
          const txt = (taNote && taNote.value) || it.text || '';
          if (!txt) { toast('Nu există text de citit.'); return; }
          noteView.textContent = txt;
          noteView.style.display = 'block';
          taNote.style.display = 'none';
          applyTmpPos(box);
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          await readScreenAloud({ root: noteView });
        } }, '🔊 Citește'),
        h('button', { type: 'button', class: 'tmp-btn', onclick: async e => {
          e.stopPropagation();
          if (isDictating()) { await stopDictation(); return; }
          setTarget(taNote);
          try { taNote.focus({ preventScroll: true }); } catch { try { taNote.focus(); } catch {} }
          const save = () => { try { updateTemporary(it.id, { text: taNote.value || '' }); } catch {} };
          await startDictation(taNote, { onEnd: save });
        } }, '🗣 Dictează'),
        h('button', { type: 'button', class: 'tmp-btn', onclick: async e => {
          e.stopPropagation();
          window._lsoTempRecId = it.id;
          if (typeof startRecording === 'function') {
            await startRecording(tab.id);
            toast('Înregistrare pornită. Oprește din microfon.');
          }
          updateTemporary(it.id, { text: ((taNote.value || it.text || '') + '\n🎙️ Înregistrare în curs…').trim() });
          render();
        } }, '🔴 Înregistrează')
      );

      left.append(noteView, taNote, innerVoiceBar);
      const openNote = () => {
        fullOpen = true;
        noteView.style.display = 'none';
        taNote.style.display = 'block';
        innerVoiceBar.style.display = 'flex';
        setTarget(taNote);
        growTa();
        applyTmpPos(box);
      };
      if (it.id === lastDictTempId || (!it.text && tmpExpanded)) {
        setTimeout(() => openNote(), 0);
      }
      if (it.mid) {
        const playerWrap = h('div', { style: { display: 'none', marginTop: '6px' } });
        const audio = h('audio', { controls: true, style: { width: '100%', height: '32px' }, preload: 'none' });
        audio.src = '';
        const loadAudio = async () => {
          if (audio.src) return;
          try {
            const { getMedia } = await import('./core/store.js');
            const m = await getMedia(it.mid);
            if (m && m.blob) audio.src = URL.createObjectURL(m.blob);
          } catch {}
        };
        const dur = it.duration ? Math.round(it.duration) + 's' : '';
        const info = h('div', { style: { fontSize: '0.75rem', opacity: 0.8, marginTop: '2px' } }, '🎙️ ' + dur + (it.transcript ? ' · ' + it.transcript.slice(0, 60) + (it.transcript.length > 60 ? '…' : '') : ''));
        const shareBtn = h('button', { type: 'button', style: {
          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '8px',
          border: '1px solid #d4af37', background: 'transparent', color: '#d4af37', marginTop: '4px'
        }, onclick: async (e) => {
          e.stopPropagation();
          try {
            const { getMedia } = await import('./core/store.js');
            const m = await getMedia(it.mid);
            if (m && m.blob && navigator.share) {
              const file = new File([m.blob], 'inregistrare.m4a', { type: m.mime || 'audio/mp4' });
              await navigator.share({ files: [file], title: it.text || 'Înregistrare' });
            } else toast('Share nu este disponibil');
          } catch {}
        } }, 'Share');
        playerWrap.append(audio, info, shareBtn);
        left.append(playerWrap);
        row._tmpOpenRec = () => { playerWrap.style.display = 'block'; loadAudio(); };
      }
      const openActions = async () => {
        const cur = (taNote && taNote.value) || it.text || '';
        const action = await sheet(cur.slice(0, 40) || 'Notiță', [
          { label: 'Citește', value: 'read', icon: '🔊', test: 'tmp-read' },
          { label: 'Editează', value: 'edit', icon: '✏️' },
          { label: 'Mută în alt tab', value: 'move', icon: '↔' },
          { label: 'Copiază', value: 'copy', icon: '📋' },
          { label: 'Share', value: 'share', icon: '📤' },
          { label: 'Șterge', value: 'del', icon: '🗑️', cls: 'danger' }
        ]);
        if (!action) return;
        if (action === 'read') {
          const txt = (taNote && taNote.value) || it.text || '';
          if (!txt) return;
          tmpExpanded = true;
          listEl.style.display = 'block';
          noteView.textContent = txt;
          noteView.style.display = 'block';
          if (taNote) taNote.style.display = 'none';
          applyTmpPos(box);
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          await readScreenAloud({ root: noteView });
        } else if (action === 'edit') {
          const newText = await promptDlg('Editează notița', { value: (taNote && taNote.value) || it.text || '', multiline: true });
          if (newText != null) {
            let t = newText.trim();
            if (t && /[a-zăîâșț]/.test(t[0])) t = t[0].toUpperCase() + t.slice(1);
            updateTemporary(it.id, { text: t });
            render();
          }
        } else if (action === 'move') {
          const otherTabs = visibleTabs().filter(x => x.id !== tab.id);
          if (!otherTabs.length) { toast('Nu există alt tab.'); return; }
          const destId = await sheet('Mută în', otherTabs.map(x => ({ label: x.name, value: x.id })));
          if (destId) {
            updateTemporary(it.id, { tab: destId });
            const destTab = tabById(destId);
            toast('Mutat în ' + (destTab ? destTab.name : 'tab'));
            render();
          }
        } else if (action === 'copy') {
          await copyText(cur);
        } else if (action === 'share') {
          await shareText('Notiță temporară', cur);
        } else if (action === 'del') {
          if (!(await confirmDlg('Ștergi notița temporară?', { danger: true }))) return;
          deleteTemporary(it.id);
          render();
        }
      };
      menuBtn.addEventListener('click', ev => { ev.stopPropagation(); openActions(); });
      row.addEventListener('click', ev => {
        if (ev.target === delBtn || ev.target === menuBtn || ev.target === taNote) return;
        if (!fullOpen) {
          openNote();
          if (row._tmpOpenRec) row._tmpOpenRec();
          return;
        }
        openActions();
      });
      listEl.append(row);
    });
  }
  box.append(listEl);
  document.body.append(box);
  applyTmpPos(box);
  bindTmpDrag(box, title);

  if (window.__lsoTmpUi) {
    document.removeEventListener('pointerdown', window.__lsoTmpUi.onOutside, true);
    document.removeEventListener('touchstart', window.__lsoTmpUi.ts, { passive: true });
    document.removeEventListener('touchend', window.__lsoTmpUi.te, { passive: true });
  }
  const onOutside = (e) => {
    if (!box.contains(e.target) && !e.target.closest('.fabs, .m-overlay, .punct-pill') && tmpExpanded) {
      tmpExpanded = false;
      listEl.style.display = 'none';
      applyTmpPos(box);
    }
  };
  let startY = 0;
  const ts = e => { startY = e.touches[0].clientY; };
  const te = e => {
    if (box.classList.contains('tmp-dragging')) return;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (dy > 50 && !tmpExpanded) {
      tmpExpanded = true;
      listEl.style.display = 'block';
      applyTmpPos(box);
    }
  };
  window.__lsoTmpUi = { onOutside, ts, te };
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 50);
  document.addEventListener('touchstart', ts, { passive: true });
  document.addEventListener('touchend', te, { passive: true });
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

function loadQuickAlarms() {
  try {
    const list = JSON.parse(localStorage.getItem('lso_alarms') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveQuickAlarms(list) {
  try { localStorage.setItem('lso_alarms', JSON.stringify(list)); } catch {}
}

function openQuickAlarmDialog(tab) {
  const existing = document.getElementById('lso-qa-overlay');
  if (existing) existing.remove();

  const now = new Date();
  now.setMinutes(now.getMinutes() + 15);
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

  // Formular: Nume și prenume cu majuscule automate la fiecare cuvânt
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
  noteWrap.append(iNote);
  iName.addEventListener('click', () => { noteWrap.style.display = 'block'; });
  iName.addEventListener('focus', () => { noteWrap.style.display = 'block'; });

  const iRoom = h('input', { type: 'text', inputMode: 'numeric', placeholder: 'Sala (nr.)', autocomplete: 'off', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem'
  } });

  const iTime = h('input', { type: 'time', value: defTime, style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem'
  } });

  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, iRoom, iTime);

  const saveBtn = h('button', { type: 'button', style: {
    padding: '10px 14px', borderRadius: '12px', border: 'none', background: '#c9a243',
    color: '#171512', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer'
  } }, 'Salvează alarma');

  const listWrap = h('div', { style: { display: 'grid', gap: '6px', marginTop: '4px' } });

  function drawAlarmsList() {
    listWrap.innerHTML = '';
    const alarms = loadQuickAlarms().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    if (!alarms.length) {
      listWrap.append(h('div', { style: { fontSize: '0.84rem', color: '#665d4c', padding: '4px 2px' } }, 'Nicio alarmă salvată.'));
      return;
    }
    alarms.forEach(item => {
      const row = h('div', { style: {
        display: 'flex', flexDirection: 'column', borderRadius: '10px',
        background: '#fff', border: '1px solid #e5dcc9', overflow: 'hidden'
      } });

      const line = h('div', { style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px', minHeight: '38px', padding: '6px 8px 6px 10px'
      } });

      const trigger = h('button', { type: 'button', 'aria-expanded': 'false', style: {
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px',
        padding: 0, border: 'none', background: 'transparent', color: '#1f1b13',
        textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden'
      } },
        h('span', { style: { fontWeight: 700, fontSize: '0.9rem', color: '#171512', flexShrink: 0 } }, item.time || '--:--'),
        h('span', { style: { fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.person || 'Alarmă'),
        item.room ? h('span', { style: { fontSize: '0.8rem', color: '#665d4c', flexShrink: 0, marginLeft: 'auto' } }, 'Sala ' + item.room) : null
      );

      const drawer = h('div', { style: { display: 'none', padding: '0 10px 8px 10px' } },
        h('div', { style: {
          fontSize: '0.82rem', color: '#4a4232', background: '#f8f3e6',
          padding: '6px 8px', borderRadius: '8px', borderLeft: '2.5px solid #c9a243',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        } }, item.note || 'Nicio notă adăugată.')
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
    const room = iRoom.value.trim();
    const rawTime = iTime.value.trim();
    const time = normalizeAlarm(rawTime) || rawTime;
    const note = iNote.value.trim();
    if (!time) { toast('Alege ora alarmei'); return; }
    const alarms = loadQuickAlarms();
    alarms.push({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      person: person || 'Alarmă',
      room,
      time,
      note,
      fired: false
    });
    saveQuickAlarms(alarms);
    iName.value = '';
    iRoom.value = '';
    iNote.value = '';
    noteWrap.style.display = 'none';
    toast('Alarmă salvată pentru ' + time);
    drawAlarmsList();
    renderUrgentClock(tab);
  });

  drawAlarmsList();
  box.append(head, iName, noteWrap, grid, saveBtn, listWrap);
  overlay.append(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  setTimeout(() => iName.focus(), 40);
}

function renderUrgentClock(tab) {
  const old = document.getElementById('urgent-clock');
  if (old) old.remove();
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = 0; }
  if (!isClockOn()) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  let nextLabel = 'fără alarmă';
  try {
    const alarms = loadQuickAlarms().filter(a => a && a.time).sort((a, b) => a.time.localeCompare(b.time));
    if (alarms.length) {
      const a = alarms[0];
      nextLabel = '⏰ ' + a.time + (a.room ? ' · S.' + a.room : '');
    }
  } catch {}
  const clk = h('div', { id: 'urgent-clock', style: {
    background: 'rgba(23,21,18,0.95)', color: '#d4af37', border: '1.5px solid #c9a243',
    cursor: 'pointer', textAlign: 'left', minWidth: '94px',
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
  clockTimer = setTimeout(() => renderUrgentClock(tab), 30000);
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

// Checker de alarmă – rulează la fiecare 10s
setInterval(() => {
  try {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const cur = hh + ':' + mm;
    const alarms = loadQuickAlarms();
    let changed = false;
    for (const a of alarms) {
      if (a && a.time === cur && !a.fired) {
        a.fired = true;
        changed = true;
        const details = [
          '⏰ ' + a.time,
          a.person || '',
          a.room ? 'Sala ' + a.room : '',
          a.note ? '— ' + a.note : ''
        ].filter(Boolean).join(' · ');
        toast(details, 10000);
        try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]); } catch {}
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = 880; g.gain.value = 0.3;
          o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 600);
        } catch {}
      }
    }
    if (changed) saveQuickAlarms(alarms);
  } catch {}
}, 10000);

// ---- FAB-uri Overlay: „+” și Microfonul peste toate paginile și dosarele ----
function renderFab(tab) {
  const fabs = $('#fabs');
  fabs.innerHTML = '';
  if (ui.selecting || ui.dragMode) return;
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
      const openTa = document.querySelector('.m-overlay:not(.buried) textarea, .m-overlay:not(.buried) input[type="text"], .tmp-note-ta[style*="block"]');
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
      const firstData = dataOf(ids[0]) || {};
      const existing = Array.isArray(firstData.tags) ? firstData.tags.join(', ') : '';
      const raw = await promptDlg('Etichete (separate prin virgulă)', { value: existing });
      if (raw == null) return;
      const tags = raw.split(',').map(s => toTitleCaseRo(s.trim())).filter(Boolean);
      for (const it of ids) {
        const d = dataOf(it) || {};
        await saveItem(it, { ...d, tags });
      }
      toast('Etichete actualizate'); render();
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
  render();
  const tb = currentTab();
  if (tb) requestAnimationFrame(() => window.scrollTo(0, state.ui.scroll[tb.id] || 0));
}
