// Controlerul aplicației: randare, navigare între taburi, poziție, selecție, FAB, ciclul de viață.
import { h, $, debounce, onLongPress } from './core/util.js';
import { t } from './core/i18n.js';
import { state, tabById, visibleTabs, liveTabs, saveUI, onChange, isOpen, relock, relockAll, item as getItem, trash, isHiddenByTrash, canView, dataOf, itemsOf, trashedAll, saveMeta, relocate, unlockTemp } from './core/store.js';
import { db, S } from './core/db.js';
import { app } from './ui/registry.js';
import { renderTabBar, tabDrag } from './ui/tabsbar.js';
import { ui, ensureOpen, sortModeOf, SORT_MODES, saveManual } from './ui/list.js';
import { pickFolder, folderNameOf } from './ui/folderpick.js';
import { openEditor, openEditors, moveItem } from './ui/editor.js';
import { confirmDlg, toast, sheet, closeAll, modalsOpen, dropMenu, pinDlg } from './ui/modal.js';
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
  let startX = 0, startY = 0;
  view.addEventListener('pointerdown', e => { startX = e.clientX; startY = e.clientY; }, { passive: true });
  view.addEventListener('pointerup', e => {
    const dx = e.clientX - startX;
    const dy = Math.abs(e.clientY - startY);
    if (Math.abs(dx) > 60 && dy < 40) {
      const tabs = visibleTabs();
      const cur = currentTab();
      if (!cur || !tabs.length) return;
      const idx = tabs.findIndex(t => t.id === cur.id);
      if (dx < 0 && idx < tabs.length - 1) goTab(tabs[idx + 1].id);
      if (dx > 0 && idx > 0) goTab(tabs[idx - 1].id);
    }
  }, { passive: true });
}
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

function renderTemporaryZone(tab) {
  const zone = document.getElementById('temp-zone');
  if (zone) zone.remove();
  if (!tab || (tab.kind === 'folders' && currentFolder(tab))) return; // dispare când e deschis un dosar
  const items = listTemporary().filter(it => it.tab === tab.id || !it.tab);
  const box = h('div', { id: 'temp-zone', style: { position: 'fixed', bottom: '70px', left: 0, right: 0, background: 'rgba(11,26,51,0.95)', color: '#f7efd4', maxHeight: '40vh', overflowY: 'auto', borderTop: '1px solid #d4af37', zIndex: 50, padding: '8px 12px' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
      h('strong', {}, 'Temporar'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { const txt = prompt('Notiță rapidă'); if (txt) { const rec = createTemporary('note', { text: txt }); rec.tab = tab.id; db.put(S.items, rec); render(); } } }, '+')
    )
  );
  items.forEach((it, idx) => {
    const full = (it.data && it.data.text) || it.subtype || '';
    const short = full.split('\n')[0] || full;
    const line = h('div', { style: { padding: '6px 0', borderBottom: '1px solid rgba(212,175,55,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', { style: { flex: 1, cursor: 'pointer' }, onclick: e => {
        if (idx === 0) {
          // prima linie: toggle expand all
          box.dataset.expanded = box.dataset.expanded === '1' ? '0' : '1';
          render();
        } else if (e.target.tagName !== 'BUTTON') {
          // de la a doua linie: deschide tot textul sau editor
          if (box.dataset.expanded === '1') openEditor(tab.id, it.id);
          else { box.dataset.expanded = '1'; render(); }
        }
      } }, short),
      h('button', { type: 'button', style: { background: 'none', border: 'none', color: '#d4af37', marginLeft: '8px' }, onclick: () => { deleteTemporary(it.id); render(); } }, '✕')
    );
    if (box.dataset.expanded === '1' && idx > 0) {
      line.querySelector('span').textContent = full;
    }
    box.append(line);
  });
  if (!items.length) box.append(h('div', { style: { opacity: 0.6, fontSize: '0.9rem' } }, 'Nicio notiță temporară'));
  document.body.append(box);
}

function renderUrgentClock(tab) {
  const old = document.getElementById('urgent-clock');
  if (old) old.remove();
  if (!tab || tab.name !== 'Urgențe') return;
  const clk = h('button', { id: 'urgent-clock', type: 'button', style: { position: 'fixed', bottom: '80px', right: '16px', background: 'rgba(11,26,51,0.9)', color: '#d4af37', border: '1px solid #d4af37', borderRadius: '12px', padding: '8px 12px', fontFamily: 'Cinzel, serif', fontSize: '1.1rem', zIndex: 40 } },
    new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
  );
  clk.addEventListener('click', () => {
    const t = prompt('Setează alarmă (HH:MM)', '09:00');
    if (t && /^\d{1,2}:\d{2}$/.test(t)) {
      toast('Alarmă setată la ' + t);
      // aici se poate lega de sistemul de alarme existent
    }
  });
  document.body.append(clk);
  // actualizare la fiecare minut
  setTimeout(() => renderUrgentClock(tab), 60000);
}

// ---- FAB-uri: „+” (adaugă) și butonul de voce jos-dreapta ----
function renderFab(tab) {
  const fabs = $('#fabs');
  fabs.innerHTML = '';
  if (ui.selecting || ui.dragMode) return;
  // + doar când e permis
  if (tab && !(tab.lock && !isOpen(tab)) && tab.kind !== 'news') {
    fabs.append(h('button', { class: 'fab add', type: 'button', 'aria-label': t('add'), 'data-test': 'fab-add', onclick: () => fabAdd(tab) }, '+'));
  }
  // microfon pe absolut fiecare pagină
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
    // tot ce se vede pe ecran (lista sau documentul deschis), cu bara sub cuvânt; al doilea tap oprește
    await readScreenAloud();
  }
  else if (v === 'dict') {
    let target = getTarget();
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


// ---- Selecție multiplă ----
function renderSelBar() {
  const bar = $('#selbar');
  bar.innerHTML = '';
  if (!ui.selecting && !ui.dragMode) { bar.hidden = true; return; }
  bar.hidden = false;
  const tab = currentTab();
  if (ui.dragMode) {
    bar.append(
      h('span', { class: 'sel-hint' }, t('dragModeHint')),
      h('button', { class: 'btn sm primary', type: 'button', 'data-test': 'drag-done', onclick: () => endDragMode() }, t('done')));
    return;
  }
  bar.append(
    h('span', { class: 'sel-count' }, t('nSelected', { n: ui.selected.size })),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { document.querySelectorAll('#view .card[data-id]').forEach(c => { const it = getItem(c.dataset.id); if (it && it.kind !== 'folder') ui.selected.add(c.dataset.id); }); render(); } }, t('selectAll')),
    h('button', { class: 'btn sm ghost', type: 'button', disabled: !ui.selected.size, onclick: async () => {
      const ids = [...ui.selected].map(getItem).filter(Boolean);
      if (!ids.length) return;
      if (!(await confirmDlg(t('confirmTrashN', { n: ids.length }), { danger: true }))) return;
      for (const it of ids) await trash(it);
      ui.selected.clear(); ui.selecting = false; toast(t('movedToTrash')); render();
    } }, t('delete')),
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => { ui.selecting = false; ui.selected.clear(); render(); } }, t('done')));
}

function header() {
  for (const [id, k] of [['hdr-search', 'search'], ['hdr-folders', 'tkFolders'], ['hdr-select', 'selectOn'], ['hdr-settings', 'settings'], ['hdr-menu', 'menu']]) { const b = $('#' + id); if (!b) continue; b.setAttribute('aria-label', t(k)); b.title = t(k); }
  $('#hdr-search').onclick = () => openSearch();
  $('#hdr-folders').onclick = async () => {
    const tab = currentTab();
    if (tab && tab.kind === 'folders') {
      await newFolder(tab, currentFolder(tab));
    } else {
      const f = liveTabs().find(x => x.kind === 'folders');
      if (f) { if (f.visible === false) f.visible = true; goTab(f.id); }
    }
  };
  $('#hdr-select').onclick = () => { ui.selecting = !ui.selecting; ui.dragMode = false; ui.selected.clear(); render(); toast(ui.selecting ? t('selectOn') : t('selectOff')); };
  // Setări: un singur loc – logo-ul sau textul LEGE ȘI ORDINE deschide panoul din stânga.
  $('#hdr-brand').onclick = () => { if (!modalsOpen()) openSettings(); };
  // Ultimul buton din dreapta sus: Coș de gunoi, Mutare și Sortare (ca în Notis).
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
// Meniul „Mutare” pornește modul cu mânere ≡ (tragere imediată); altfel: apăsare lungă + tragere.
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
  const tab = currentTab();
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

// La trecerea în fundal: salvează poziția, salvează automat editoarele cu conținut blocat, reblochează tot.
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
