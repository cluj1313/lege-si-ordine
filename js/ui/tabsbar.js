// Bara de taburi ovale: un rând, derulabilă orizontal, fixată sus; apăsare lungă = meniu tab; „+” = tab nou.
import { h, onLongPress } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, visibleTabs, liveTabs, saveTab, saveTabsOrder, addTab, trash, itemsOf, lockWithPin, unlockPermanent, isOpen, relock } from '../core/store.js';
import { TAB_KINDS, userTabKinds } from '../tabs/kinds.js';
import { sheet, promptDlg, confirmDlg, pinDlg, toast, openModal } from './modal.js';
import { app } from './registry.js';

export const COLORS = ['', '#c9a24a', '#b5523b', '#3f7d5a', '#3b6aa0', '#7a4ea3', '#5a5f6a', '#c2417a'];

export function renderTabBar(bar, activeId, badges = {}) {
  bar.innerHTML = '';
  for (const tab of visibleTabs()) {
    const b = h('button', { class: 'tab-pill' + (tab.id === activeId ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': String(tab.id === activeId), 'data-id': tab.id, 'data-kind': tab.kind, onclick: () => app.goTab(tab.id) },
      tab.lock ? h('span', { class: 'tp-lock' }, isOpen(tab) ? '🔓' : '🔒') : null,
      h('span', { class: 'tp-name' }, tab.name),
      badges[tab.id] ? h('span', { class: 'badge' }, String(badges[tab.id])) : null);
    if (tab.color) b.style.setProperty('--tab-color', tab.color);
    onLongPress(b, () => tabMenu(tab));
    bar.append(b);
  }
  bar.append(h('button', { class: 'tab-pill add', type: 'button', 'aria-label': t('newTab'), onclick: () => newTabFlow() }, '+'));
  const act = bar.querySelector('.tab-pill.active');
  if (act) requestAnimationFrame(() => { const r = act.getBoundingClientRect(), br = bar.getBoundingClientRect(); if (r.left < br.left || r.right > br.right) bar.scrollLeft += r.left - br.left - 16; });
}

export async function newTabFlow() {
  const kind = await sheet(t('newTabType'), userTabKinds.map(k => ({ label: TAB_KINDS[k].label(), value: k })));
  if (!kind) return;
  const name = await promptDlg(t('newTab'), { placeholder: t('tabNamePh'), value: TAB_KINDS[kind].label() });
  if (!name) return;
  const tab = await addTab(name, kind);
  app.goTab(tab.id);
}

export async function moveTab(tab, dir) {
  const list = liveTabs();
  const i = list.findIndex(x => x.id === tab.id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => { x.order = k; });
  await saveTabsOrder();
}

export async function tabMenu(tab) {
  const v = await sheet(tab.name, [
    { label: t('rename'), value: 'ren', icon: '✎' },
    { label: t('color'), value: 'color', icon: '🎨' },
    { label: t('moveLeft'), value: 'left', icon: '◀' },
    { label: t('moveRight'), value: 'right', icon: '▶' },
    tab.lock ? { label: t('unlockPermanent'), value: 'unlock', icon: '🔓' } : { label: t('lockPin'), value: 'lock', icon: '🔒' },
    tab.lock && isOpen(tab) ? { label: t('relockNow'), value: 'relock', icon: '🔒' } : null,
    { label: t('hideTab'), value: 'hide', icon: '👁' },
    { label: t('delete'), value: 'del', icon: '🗑', cls: 'danger' },
  ]);
  if (v === 'ren') { const n = await promptDlg(t('rename'), { value: tab.name }); if (n) { tab.name = n; await saveTab(tab); } }
  else if (v === 'color') await colorPick(tab);
  else if (v === 'left' || v === 'right') { await moveTab(tab, v === 'left' ? -1 : 1); toast(t('moved')); }
  else if (v === 'lock') {
    if (!isOpen(tab)) return;
    const pin = await pinDlg(t('lockPin'), { confirm: true }); if (!pin) return;
    try { await lockWithPin(tab, pin); toast(t('lockedTabOk')); } catch { toast(t('unlockInnerFirst'), 3500); }
  } else if (v === 'unlock') {
    const ok = await pinDlg(t('unlockPermanent'), { verify: pin => unlockPermanent(tab, pin).catch(() => false) });
    if (ok) toast(t('unlockedOk'));
  } else if (v === 'relock') { relock(tab); }
  else if (v === 'hide') { tab.visible = false; await saveTab(tab); toast(t('tabHidden')); if (state.ui.tab === tab.id) app.goTab(null); }
  else if (v === 'del') {
    const n = itemsOf(tab.id).length;
    if (await confirmDlg(t('confirmTrashTab', { n: tab.name, c: n }), { danger: true })) {
      await trash(tab); toast(t('movedToTrash')); if (state.ui.tab === tab.id) app.goTab(null);
    }
  }
  app.render();
}

function colorPick(tab) {
  return new Promise(res => {
    const box = h('div', { class: 'colors' });
    const m = openModal({ title: t('color'), body: box, onClose: res });
    COLORS.forEach(c => box.append(h('button', { class: 'color-dot' + (tab.color === c ? ' sel' : ''), type: 'button', style: { background: c || 'var(--card)' }, 'aria-label': c || t('noColor'),
      onclick: async () => { tab.color = c; await saveTab(tab); m.close(); } }, c ? '' : '∅')));
  });
}
