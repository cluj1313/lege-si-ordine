// Coș: ștergerile merg aici; retenție setabilă (implicit 30 zile); la expirare utilizatorul decide.
import { h, act, fmtTsDate } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, trashedAll, restore, purge, dataOf, canView, tabById, saveSettings, liveTabs, addTab, relocate, newItem, itemsOf, saveMeta, saveTab } from '../core/store.js';
import { KINDS } from '../tabs/kinds.js';
import { openModal, confirmDlg, toast, promptDlg } from '../ui/modal.js';
import { app } from '../ui/registry.js';

const DAY = 86400000;
const nameOf = o => (o.tab ? (canView(o) ? (KINDS[o.kind] || KINDS.note).title(dataOf(o)) : t('lockedItem')) : o.name);
const daysLeft = o => Math.ceil(((o.trashedAt + (o.keepDays || state.settings.trashDays) * DAY) - Date.now()) / DAY);

export function openTrash(highlightId) {
  const body = h('div', { class: 'trash' });
  const m = openModal({ title: t('trash'), body, kind: 'page', cls: 'trash-page' });
  m.el.dataset.test = 'trash';
  const draw = () => {
    body.innerHTML = '';
    body.append(h('div', { class: 'hint' }, t('trashHint', { d: state.settings.trashDays })));
    const all = trashedAll();
    if (!all.length) { body.append(h('div', { class: 'empty' }, t('trashEmpty'))); return; }
    all.forEach(o => {
      const tab = o.tab ? tabById(o.tab) : null;
      const kindLabel = o.tab ? (KINDS[o.kind] || KINDS.note).label() : t('kindTab');
      const row = h('div', { class: 'card trash-row' + (o.id === highlightId ? ' flash' : ''), 'data-id': o.id },
        h('div', { class: 'r1' }, h('span', { class: 'r1t' }, nameOf(o)), h('span', { class: 'r1-meta' }, t('daysLeft', { n: Math.max(0, daysLeft(o)) }))),
        h('div', { class: 'r2' },
          h('div', { class: 'r2-meta' }, `${kindLabel}${tab ? ' • ' + tab.name : ''} • ${t('deletedOn', { d: fmtTsDate(o.trashedAt) })}`),
          h('div', { class: 'r2-actions' },
            h('button', { class: 'btn sm', type: 'button', 'data-test': 'restore', onclick: e => act(e.currentTarget, async () => { await restore(o); toast(t('restored')); draw(); app.render(); }) }, t('restore')),
            h('button', { class: 'btn sm danger-ghost', type: 'button', onclick: e => act(e.currentTarget, async () => {
              if (!(await confirmDlg(t('confirmPurge', { n: nameOf(o) }), { danger: true }))) return;
              await purge(o); toast(t('purged')); draw();
            }) }, t('deleteForever')))));
      body.append(row);
      if (o.id === highlightId) setTimeout(() => row.scrollIntoView({ block: 'center' }), 50);
    });
    body.append(h('button', { class: 'btn danger-ghost wide', type: 'button', onclick: e => act(e.currentTarget, async () => {
      if (!(await confirmDlg(t('confirmEmptyTrash', { n: all.length }), { danger: true }))) return;
      for (const o of trashedAll()) await purge(o);
      toast(t('purged')); draw();
    }) }, t('emptyTrash')));
  };
  draw();
}

// La pornire: elementele expirate nu se șterg singure; aplicația întreabă.
export async function checkExpired() {
  const exp = trashedAll().filter(o => daysLeft(o) <= 0);
  if (!exp.length) return;
  const days = h('input', { class: 'inp', type: 'number', min: '1', max: '3650', value: '30', inputmode: 'numeric' });
  await new Promise(res => openModal({
    title: t('trashExpiredTitle'),
    body: h('div', {}, h('p', { class: 'm-msg' }, t('trashExpired', { n: exp.length })),
      h('ul', { class: 'exp-list' }, exp.slice(0, 8).map(o => h('li', {}, nameOf(o)))),
      h('label', { class: 'fld' }, h('span', {}, t('extendDays')), days)),
    onClose: res, dismissable: false,
    actions: [
      { label: t('extend'), cls: 'ghost', onClick: async m => { const n = Math.max(1, +days.value || 30); for (const o of exp) { o.keepDays = (o.keepDays || state.settings.trashDays) + n; o.tab ? await saveMeta(o) : await saveTab(o); } toast(t('extended', { n })); m.close(); } },
      { label: t('moveToKept'), cls: 'ghost', onClick: async m => { await moveToKept(exp); toast(t('movedKept')); m.close(); } },
      { label: t('deleteForever'), cls: 'danger', onClick: async m => { if (!(await confirmDlg(t('confirmPurgeN', { n: exp.length }), { danger: true }))) return; for (const o of exp) await purge(o); toast(t('purged')); m.close(); } },
    ],
  }));
}

// Mută elementele expirate într-un folder „Păstrate” din tabul Foldere (taburile șterse sunt restaurate).
async function moveToKept(list) {
  let ft = liveTabs().find(x => x.kind === 'folders') || await addTab(t('tkFolders'), 'folders');
  let kept = itemsOf(ft.id, { folder: null, kind: 'folder' }).find(f => canView(f) && dataOf(f).name === t('keptFolder'));
  if (!kept) kept = await newItem(ft.id, 'folder', { name: t('keptFolder') });
  for (const o of list) {
    if (!o.tab) { await restore(o); continue; }
    delete o.trashedAt; delete o.keepDays;
    try { await relocate(o, { tab: ft.id, folder: kept.id, sub: null }); } catch { await restore(o); }
  }
  app.render();
}
