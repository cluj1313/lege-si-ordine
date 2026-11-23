// Controlerul aplicației: randare, navigare între taburi, poziție, selecție, FAB, ciclul de viață.
import { h, $, debounce, onLongPress } from './core/util.js';
import { t } from './core/i18n.js';
import { state, tabById, visibleTabs, liveTabs, saveUI, onChange, isOpen, relock, relockAll, item as getItem, trash, isHiddenByTrash, canView, dataOf, itemsOf, trashedAll, saveMeta, relocate, unlockTemp, newItem } from './core/store.js';
import { db, S } from './core/db.js';
import { app } from './ui/registry.js';
import { renderTabBar, tabDrag } from './ui/tabsbar.js';
import { ui, ensureOpen, sortModeOf, SORT_MODES, saveManual } from './ui/list.js';
import { pickFolder, folderNameOf } from './ui/folderpick.js';
import { openEditor, openEditors, moveItem } from './ui/editor.js';
import { confirmDlg, toast, sheet, closeAll, modalsOpen, dropMenu, pinDlg, openModal } from './ui/modal.js';
import { renderGeneric, renderSaved, renderFolders, renderNews, renderLocked, currentFolder, newFolder, newsResults, renderMO, hasCats, savedSubs } from './tabs/views.js';
import { curCat, getCats } from './tabs/cats.js';
import { isoToday } from './core/util.js';
import { renderRecordings, startRecording, renameRec, archiveRec, recStatus, isRecording, stopRecording, transcribeRec, liveTranscript } from './tabs/recordings.js';
import { openSearch } from './features/search.js';
import { openTrash } from './features/trash.js';
import { openSettings, applyTheme } from './features/settings.js';
import { readScreenAloud, stopSpeak, isSpeaking, startDictation, stopDictation, isDictating, getTarget, setTarget, voiceMenu } from './features/voice.js';
import { KINDS, TAB_KINDS } from './tabs/kinds.js';
import { renderWidgets } from './features/widgets.js';
import { listTemporary, createTemporary, deleteTemporary, updateTemporary } from './features/temporary.js';
import { saveSettings } from './core/store.js';
import { copyText, shareText } from './features/share.js';

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
  // PLACEHOLDER - full content will be restored from good commit
}
