// Controlerul aplicației: randare, navigare între taburi, poziție, selecție, FAB, ciclul de viață.
import { h, $, debounce, onLongPress } from './core/util.js';
import { t } from './core/i18n.js';
import { state, tabById, visibleTabs, liveTabs, saveUI, onChange, isOpen, relock, relockAll, item as getItem, trash, isHiddenByTrash, canView, dataOf, itemsOf } from './core/store.js';
import { db } from './core/db.js';
import { app } from './ui/registry.js';
import { renderTabBar } from './ui/tabsbar.js';
import { ui, ensureOpen } from './ui/list.js';
import { openEditor, openEditors, moveItem } from './ui/editor.js';
import { confirmDlg, toast, sheet, closeAll, modalsOpen } from './ui/modal.js';
import { renderGeneric, renderSaved, renderFolders, renderNews, renderLocked, currentFolder, newFolder, newsResults, renderMO, hasCats } from './tabs/views.js';
import { curCat } from './tabs/cats.js';
import { isoToday } from './core/util.js';
import { renderRecordings, startRecording, renameRec, archiveRec, recStatus, isRecording, stopRecording } from './tabs/recordings.js';
import { openSearch } from './features/search.js';
import { openTrash } from './features/trash.js';
import { openSettings } from './features/settings.js';
import { speak, stopSpeak, isSpeaking, startDictation, stopDictation, isDictating, getTarget, setTarget, voiceMenu } from './features/voice.js';
import { KINDS } from './tabs/kinds.js';

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
  window.scrollTo(0, y);
  rendering = false;
}

export function goTab(id, { keepScroll = false } = {}) {
  const prev = currentTab();
  if (prev) state.ui.scroll[prev.id] = Math.round(window.scrollY);
  const next = id ? tabById(id) : visibleTabs()[0];
  // reblocare la ieșirea dintr-un tab blocat
  if (prev && next && prev.id !== next.id) {
    if (prev.lock && isOpen(prev)) relock(prev);
    const cf = prev.kind === 'folders' && currentFolder(prev);
    if (cf && cf.lock) { relock(cf); state.ui.folder[prev.id] = cf.folder || null; }
    ui.selecting = false; ui.selected.clear();
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

// ---- FAB-uri: „+” (adaugă) și butonul de voce jos-dreapta ----
function renderFab(tab) {
  const fabs = $('#fabs');
  fabs.innerHTML = '';
  if (!tab || ui.selecting) return;
  const locked = tab.lock && !isOpen(tab);
  if (!locked && tab.kind !== 'news') {
    fabs.append(h('button', { class: 'fab add', type: 'button', 'aria-label': t('add'), 'data-test': 'fab-add', onclick: () => fabAdd(tab) }, '+'));
  }
  const vb = h('button', { class: 'fab voice' + (isDictating() ? ' live' : '') + (isRecording() ? ' rec' : ''), type: 'button', 'aria-label': t('voice'), 'data-test': 'fab-voice', onclick: () => voiceFab(tab) }, '🎙');
  onLongPress(vb, () => voiceMenu());
  fabs.append(vb);
}

async function fabAdd(tab) {
  if (tab.kind === 'folders') {
    const cur = currentFolder(tab);
    const v = await sheet(t('add'), [{ label: t('newNote'), value: 'note', icon: '📝' }, { label: cur ? t('newSubfolder') : t('newFolder'), value: 'folder', icon: '📁' }]);
    if (v === 'note') openEditor(tab.id, null, { folder: cur ? cur.id : null, kind: 'note' });
    if (v === 'folder') newFolder(tab, cur);
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
  if (v === 'read') speak(readableText(tab));
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
    if (startDictation(target)) render();
  } else if (v === 'rec') {
    const rt = liveTabs().find(x => x.kind === 'rec');
    if (isRecording()) { stopRecording(); return; }
    if (rt) { goTab(rt.id); startRecording(rt.id); } else toast(t('noRecTab'));
  } else if (v === 'set') voiceMenu();
}

function readableText(tab) {
  const ed = document.querySelector('.m-overlay:last-child .editor, .m-overlay:last-child .m-box.editor');
  if (ed) return [...ed.querySelectorAll('.voice-target')].map(x => x.value).filter(Boolean).join('.\n');
  const open = [...document.querySelectorAll('#view .card.open')];
  const src = open.length ? open : [...document.querySelectorAll('#view .card, #view .news-row, #view h2')];
  return src.map(el => el.innerText.replace(/[▾▴🔒🔓⏰●]/g, '')).join('.\n');
}

// ---- Selecție multiplă ----
function renderSelBar() {
  const bar = $('#selbar');
  bar.innerHTML = '';
  if (!ui.selecting) { bar.hidden = true; return; }
  bar.hidden = false;
  const tab = currentTab();
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
    h('button', { class: 'btn sm ghost', type: 'button', disabled: ui.selected.size !== 1, onclick: async () => { const it = getItem([...ui.selected][0]); if (it && await moveItem(it)) { ui.selected.clear(); ui.selecting = false; render(); } } }, t('moveTo')),
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => { ui.selecting = false; ui.selected.clear(); render(); } }, t('done')));
}

function header() {
  for (const [id, k] of [['hdr-search', 'search'], ['hdr-folders', 'tkFolders'], ['hdr-select', 'selectOn'], ['hdr-menu', 'menu']]) { const b = $('#' + id); b.setAttribute('aria-label', t(k)); b.title = t(k); }
  $('#hdr-search').onclick = () => openSearch();
  $('#hdr-folders').onclick = () => { const f = liveTabs().find(x => x.kind === 'folders'); if (f) { if (f.visible === false) { f.visible = true; } goTab(f.id); } };
  $('#hdr-select').onclick = () => { ui.selecting = !ui.selecting; ui.selected.clear(); render(); toast(ui.selecting ? t('selectOn') : t('selectOff')); };
  $('#hdr-menu').onclick = async () => {
    const v = await sheet(t('menu'), [
      { label: t('settings'), value: 'set', icon: '⚙' },
      { label: t('trash'), value: 'trash', icon: '🗑' },
      { label: t('voiceSettings'), value: 'voice', icon: '🎙' },
    ]);
    if (v === 'set') openSettings(); else if (v === 'trash') openTrash(); else if (v === 'voice') voiceMenu();
  };
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
  Object.assign(app, { render, goTab, reveal, deleteItem, openEditor, openTrash, openSettings, openSearch, currentTab, renameRec, archiveRec, recStatus, startRecording });
  header();
  newsCache = await newsResults();
  onChange(() => { if (!rendering) render(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); });
  window.addEventListener('pagehide', () => { onHidden(); });
  render();
  const tb = currentTab();
  if (tb) requestAnimationFrame(() => window.scrollTo(0, state.ui.scroll[tb.id] || 0));
}
