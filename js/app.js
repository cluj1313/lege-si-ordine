// Controlerul aplicației: randare, navigare între taburi, poziție, selecție, FAB, ciclul de viață.
import { h, $, debounce, onLongPress } from './core/util.js';
import { t } from './core/i18n.js';
import { state, load, saveSettings, saveUI, liveTabs, visibleTabs, tabById, itemsOf, item, dataOf, canView, isOpen, ownerOf, locksChain, unlockTemp, relock, relockAll, trash, restore, purge, newItem, saveItem, saveMeta, emit, onChange, APP_VERSION } from './core/store.js';
import { openSettings } from './features/settings.js';
import { openSearch } from './features/search.js';
import { openFolders } from './features/folders.js';
import { openShare } from './features/share.js';
import { openLock, unlockWithBiometric } from './features/lock.js';
import { openVoice } from './voice/voice.js';
import { renderTab } from './tabs/views.js';
import { listTemporary } from './features/temporary.js';
import { toast, act } from './ui/toast.js';
import { confirm } from './ui/confirm.js';
import { openSheet } from './ui/sheet.js';

let currentTab = null;
let selected = new Set();
let lastRender = 0;

export function render() {
  lastRender = Date.now();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';
  const tabs = visibleTabs();
  if (!tabs.length) {
    root.append(h('div', { class: 'empty' }, t('noTabs')));
    return;
  }
  if (!currentTab || !tabs.find(t => t.id === currentTab.id)) {
    currentTab = tabs[0];
    state.ui.tab = currentTab.id;
    saveUI();
  }
  const tab = currentTab;
  const hdr = h('header', { class: 'hdr' });
  const logo = h('div', { class: 'logo', onclick: () => openSettings() },
    h('img', { src: 'icons/icon-192.png', alt: '', width: 40, height: 40 }),
    h('div', { class: 'logo-txt' },
      h('strong', {}, 'LEGE ȘI'),
      h('span', {}, 'ORDINE')
    )
  );
  const actions = h('div', { class: 'hdr-actions' },
    h('button', { class: 'icon-btn', title: t('search'), onclick: () => openSearch() }, '🔍'),
    h('button', { class: 'icon-btn', title: t('folders'), onclick: () => openFolders(tab) }, '📁'),
    h('button', { class: 'icon-btn', title: t('share'), onclick: () => openShare() }, '↗')
  );
  hdr.append(logo, actions);
  root.append(hdr);

  const tabbar = h('div', { class: 'tabbar' });
  for (const tb of tabs) {
    const btn = h('button', {
      class: 'tab' + (tb.id === tab.id ? ' on' : ''),
      onclick: () => { currentTab = tb; state.ui.tab = tb.id; saveUI(); render(); }
    }, tb.name);
    tabbar.append(btn);
  }
  root.append(tabbar);

  const main = h('main', { class: 'main', id: 'main' });
  root.append(main);
  renderTab(tab, main);

  renderTemporaryZone(tab);
  renderUrgentClock(tab);
  renderFABs(tab);
}

function renderFABs(tab) {
  const old = document.getElementById('fabs');
  if (old) old.remove();
  const fabs = h('div', { id: 'fabs', class: 'fabs' });
  const plus = h('button', { class: 'fab gold', title: t('add'), onclick: () => openPlus(tab) }, '+');
  const mic = h('button', { class: 'fab dark', title: t('record'), onclick: () => openVoice(tab) }, '🎤');
  fabs.append(plus, mic);
  document.body.append(fabs);
}

function openPlus(tab) {
  // simplificat: adaugă notiță rapidă
  newItem(tab.id, 'note', { title: '', body: '' }).then(it => {
    toast(t('noteAdded'));
    render();
  });
}

function renderTemporaryZone(tab) {
  const old = document.getElementById('temporary-zone');
  if (old) old.remove();
  if (!tab) return;
  const items = listTemporary();
  const box = h('div', { id: 'temporary-zone', style: {
    position: 'fixed', bottom: '92px', left: '0', right: '0', zIndex: 35,
    background: 'rgba(11,26,51,0.95)', borderTop: '1px solid #d4af37', borderBottom: '1px solid #d4af37',
    padding: '12px 16px', maxHeight: '55vh', overflowY: 'auto', color: '#f7efd4',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontSize: '16px'
  } });

  let expanded = false;
  const listEl = h('div', { style: { display: 'none', marginTop: '8px' } });

  const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
  const title = h('strong', { style: { fontSize: '1.25rem', flex: 1, cursor: 'pointer', letterSpacing: '0.02em' } }, 'Temporar');
  title.onclick = (e) => {
    e.stopPropagation();
    expanded = !expanded;
    listEl.style.display = expanded ? 'block' : 'none';
  };
  header.append(title);

  const labels = { read: 'Citește', dict: 'Dictează', rec: 'Înregistrează' };
  // Dictează: creează notiță în Temporar și pornește dictarea în ea
  const dictBtn = h('button', { type: 'button', title: 'Dictează', style: {
    fontSize: '0.95rem', padding: '4px 10px', borderRadius: '8px',
    background: 'transparent', border: '1px solid #d4af37', color: '#d4af37', cursor: 'pointer'
  } }, 'Dictează');
  dictBtn.onclick = (e) => { e.stopPropagation(); /* TODO dict */ };
  const recBtn = h('button', { type: 'button', title: 'Înregistrează', style: {
    fontSize: '0.95rem', padding: '4px 10px', borderRadius: '8px',
    background: 'transparent', border: '1px solid #d4af37', color: '#d4af37', cursor: 'pointer'
  } }, 'Înregistrează');
  recBtn.onclick = (e) => { e.stopPropagation(); openVoice(tab); };
  const plusBtn = h('button', { type: 'button', title: 'Adaugă', style: {
    width: '32px', height: '32px', borderRadius: '50%', background: '#d4af37', color: '#0b1a33',
    border: 'none', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
  } }, '+');
  plusBtn.onclick = (e) => { e.stopPropagation(); openPlus(tab); };
  header.append(dictBtn, recBtn, plusBtn);
  box.append(header, listEl);

  // listă items
  for (const it of items) {
    const row = h('div', { style: { padding: '8px 0', borderBottom: '1px solid rgba(212,175,55,0.2)' } }, it.title || '(fără titlu)');
    listEl.append(row);
  }

  document.body.append(box);

  // click outside to collapse
  const onOutside = (e) => {
    if (!box.contains(e.target) && expanded) {
      expanded = false;
      listEl.style.display = 'none';
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 50);

  // Zona Temporar se deschide DOAR la tap pe linia "Temporar". Nu la swipe.
}


function renderUrgentClock(tab) {
  const old = document.getElementById('urgent-clock');
  if (old) old.remove();
  if (state.settings && state.settings.hideClock) return;
  // Ceasul apare pe toate taburile
  const pos = JSON.parse(localStorage.getItem('lso_clock_pos') || '{"top":"72","right":"12"}');
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  // următoarea alarmă (simplu, din localStorage sau items)
  let nextAlarm = '';
  try {
    const alarms = JSON.parse(localStorage.getItem('lso_alarms') || '[]');
    const future = alarms.filter(a => a && a.time).sort((a, b) => a.time.localeCompare(b.time));
    if (future.length) nextAlarm = future[0].time;
  } catch {}
  const clk = h('div', { id: 'urgent-clock', style: {
    position: 'fixed', top: (pos.top || 72) + 'px', right: (pos.right || 12) + 'px',
    background: 'rgba(11,26,51,0.94)', color: '#d4af37', border: '1px solid #d4af37',
    borderRadius: '14px', padding: '6px 12px', fontFamily: 'Cinzel, serif',
    zIndex: 50, touchAction: 'none', cursor: 'grab', textAlign: 'center', minWidth: '72px'
  } });
  clk.append(h('div', { style: { fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.1 } }, timeStr));
  clk.append(h('div', { style: { fontSize: '0.7rem', opacity: 0.85, marginTop: 2 } }, nextAlarm ? nextAlarm : 'fără alarmă'));
  // drag
  let dragging = false, startX, startY, startTop, startRight;
  clk.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startTop = parseInt(clk.style.top) || 72;
    startRight = parseInt(clk.style.right) || 12;
    clk.setPointerCapture(e.pointerId);
    clk.style.cursor = 'grabbing';
  });
  clk.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = startX - e.clientX;
    const dy = e.clientY - startY;
    clk.style.top = Math.max(8, startTop + dy) + 'px';
    clk.style.right = Math.max(8, startRight + dx) + 'px';
  });
  clk.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    clk.style.cursor = 'grab';
    localStorage.setItem('lso_clock_pos', JSON.stringify({ top: parseInt(clk.style.top), right: parseInt(clk.style.right) }));
  });
  document.body.append(clk);
}

// swipe / long press etc – păstrate din versiunea anterioară
function setupGestures() {
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, input, textarea, select, .fab, .tabbar, #temporary-zone, .hdr, .m-overlay, .sheet, #urgent-clock')) return;
    // long press logic handled elsewhere
  }, true);
}

export async function boot() {
  await load();
  // migrare setări
  if (state.settings.version !== APP_VERSION) {
    state.settings.version = APP_VERSION;
    await saveSettings();
  }
  currentTab = tabById(state.ui.tab) || visibleTabs()[0];
  setupGestures();
  render();
  onChange(() => { if (Date.now() - lastRender > 80) render(); });
  // biometric auto-unlock if needed
  if (state.settings.lockMode === 'background') {
    // handled in lock.js
  }
}

// export for external
window.__LSO_RENDER = render;
