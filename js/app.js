// Controlerul aplicației: randare, navigare între taburi, poziție, selecție, FAB, ciclul de viață.
import { h, $, debounce, onLongPress } from './core/util.js';
import { t } from './core/i18n.js';
import { state, tabById, visibleTabs, liveTabs, saveUI, onChange, isOpen, relock, relockAll, item as getItem, trash, isHiddenByTrash, canView, dataOf, itemsOf, trashedAll, saveMeta, saveItem, relocate, unlockTemp } from './core/store.js';
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
  const view = document.getElementById('view');
  if (!view || view.dataset.swipeBound) return;
  view.dataset.swipeBound = '1';
  let startX = 0, startY = 0, tracking = false;
  view.addEventListener('pointerdown', e => {
    if (modalsOpen() || isSpeaking() || ui.selecting || ui.dragMode) return;
    if (e.clientY < 96) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, button, .tmp-zone, #urgent-clock')) return;
    startX = e.clientX;
    startY = e.clientY;
    tracking = true;
  }, { passive: true });
  view.addEventListener('pointerup', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = Math.abs(e.clientY - startY);
    if (Math.abs(dx) > 64 && Math.abs(dx) > dy * 1.35) {
      const tabs = visibleTabs();
      const cur = currentTab();
      if (!cur || !tabs.length) return;
      const idx = tabs.findIndex(t => t.id === cur.id);
      if (dx < 0 && idx < tabs.length - 1) goTab(tabs[idx + 1].id);
      if (dx > 0 && idx > 0) goTab(tabs[idx - 1].id);
    }
  }, { passive: true });
  view.addEventListener('pointercancel', () => { tracking = false; }, { passive: true });
}
function goTab(id, keepScroll) {
  const prev = currentTab();
  if (prev) state.ui.scroll[prev.id] = Math.round(window.scrollY);
  const next = id ? tabById(id) : visibleTabs()[0];
  // reblocare la ieșirea dintr-un tab blocat
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
  // Temporar separat pentru fiecare tab activ
  const items = listTemporary(tab.id);
  const box = h('div', { id: 'temporary-zone', class: 'tmp-zone', 'data-test': 'temporary-zone' });

  const listEl = h('div', { class: 'tmp-list', style: { display: tmpExpanded ? 'block' : 'none', marginTop: '8px' } });

  const header = h('div', { class: 'tmp-head' });
  const title = h('strong', { class: 'tmp-title', 'data-test': 'tmp-title' }, 'Temporar');
  title.onclick = (e) => {
    e.stopPropagation();
    tmpExpanded = !tmpExpanded;
    listEl.style.display = tmpExpanded ? 'block' : 'none';
    applyTmpPos(box);
  };
  header.append(title);

  // Ordinea butoanelor: +, Dictează, Înregistrează
  const labels = { read: 'Citește', dict: 'Dictează', rec: 'Înregistrează' };
  const addBtn = h('button', { class: 'tmp-add', type: 'button', 'data-test': 'tmp-add', title: 'Adaugă notiță', onclick: async (e) => {
    e.stopPropagation();
    const txt = await promptDlg('Notiță rapidă');
    if (txt && txt.trim()) {
      let t = txt.trim();
      if (t && /[a-zăîâșț]/.test(t[0])) t = t[0].toUpperCase() + t.slice(1);
      createTemporary(t, tab.id, ['read']);
      tmpExpanded = true;
      render();
    }
  } }, '+');
  header.append(addBtn);

  const dictBtn = h('button', { class: 'tmp-btn', type: 'button', title: 'Dictează', 'data-test': 'tmp-dict', onclick: async (e) => {
    e.stopPropagation();
    if (isDictating()) { await stopDictation(); return; }
    let rec = lastDictTempId && listTemporary(tab.id).find(x => x.id === lastDictTempId);
    if (!rec) rec = createTemporary('', tab.id, ['dict']);
    lastDictTempId = rec.id;
    tmpExpanded = true;
    render();
    await new Promise(r => setTimeout(r, 80));
    const ta = document.querySelector('[data-tmp-id="' + rec.id + '"] textarea') || document.querySelector('[data-test=tmp-note-ta]');
    if (!ta) { toast('Nu pot deschide câmpul de dictare.'); return; }
    setTarget(ta);
    try { ta.focus({ preventScroll: true }); } catch { try { ta.focus(); } catch {} }
    const save = () => { try { updateTemporary(rec.id, { text: ta.value || '' }); } catch {} };
    ta.addEventListener('input', save);
    const ok = await startDictation(ta, { onEnd: save });
    if (!ok) save();
  } }, 'Dictează');
  header.append(dictBtn);

  const recBtn = h('button', { class: 'tmp-btn', type: 'button', title: 'Înregistrează', 'data-test': 'tmp-rec', onclick: async (e) => {
    e.stopPropagation();
    const rec = createTemporary('🎙️ Înregistrare…', tab.id, ['rec']);
    if (!rec) return;
    tmpExpanded = true;
    listEl.style.display = 'block';
    window._lsoTempRecId = rec.id;
    if (typeof startRecording === 'function') {
      await startRecording(tab.id);
      toast('Înregistrare pornită. Oprește din butonul de microfon.');
    }
    updateTemporary(rec.id, { text: '🎙️ Înregistrare în curs…' });
    render();
  } }, 'Înregistrează');
  header.append(recBtn);
  box.append(header);

  if (!items.length) {
    listEl.append(h('div', { style: { opacity: 0.5, fontSize: '0.85rem', padding: '6px 0' } }, 'Nicio notiță temporară în ' + (tab.name || 'acest tab')));
  } else {
    items.forEach(it => {
      const lines = (it.text || '').split('\n');
      const rowTitle = lines[0] || '(gol)';
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
      const taNote = h('textarea', { class: 'tmp-note-ta', 'data-test': 'tmp-note-ta', 'data-tmp-id': it.id, rows: 4 });
      taNote.value = it.text || '';
      taNote.style.display = 'none';
      const growTa = () => { taNote.style.height = 'auto'; taNote.style.height = Math.min(Math.max(taNote.scrollHeight, 72), 220) + 'px'; };
      taNote.addEventListener('input', () => { updateTemporary(it.id, { text: taNote.value }); growTa(); });
      taNote.addEventListener('click', e => e.stopPropagation());
      left.append(noteView, taNote);
      const openNote = () => {
        fullOpen = true;
        noteView.style.display = 'none';
        taNote.style.display = 'block';
        growTa();
      };
      if (it.id === lastDictTempId || (it.modes && it.modes.includes('dict') && tmpExpanded && !it.text)) {
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
    if (!box.contains(e.target) && tmpExpanded) {
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

  // Formular: Nume și prenume + Notă (la atingerea numelui) + Sala (nr.) + Ora
  const iName = h('input', { type: 'text', placeholder: 'Nume și prenume (atinge pentru notă)', autocomplete: 'off', style: {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: '10px',
    border: '1.5px solid #d4c6a3', background: '#fff', color: '#1f1b13', fontSize: '0.95rem'
  } });

  const noteWrap = h('div', { style: { display: 'none' } });
  const iNote = h('input', { type: 'text', placeholder: 'Notă mică: despre ce este vorba când sună alarma...', autocomplete: 'off', style: {
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
      // Fiecare alarmă pe un singur rând; nota nu se vede implicit, ci se deschide/închide la atingerea numelui
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
    const person = iName.value.trim();
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
    position: 'fixed', bottom: '14px', left: '12px',
    background: 'rgba(23,21,18,0.95)', color: '#d4af37', border: '1.5px solid #c9a243',
    borderRadius: '14px', padding: '7px 12px', fontFamily: 'Roboto Condensed, sans-serif',
    zIndex: 45, cursor: 'pointer', textAlign: 'left', minWidth: '88px',
    boxShadow: '0 6px 18px rgba(0,0,0,0.22)'
  } });
  clk.append(h('div', { style: { fontSize: '1.2rem', fontWeight: 700, lineHeight: 1.05, color: '#f4b942' } }, timeStr));
  clk.append(h('div', { style: { fontSize: '0.72rem', opacity: 0.8, marginTop: '2px', color: '#e6decb' } }, nextLabel));

  let pressT = 0, long = false;
  clk.add
