// Selector de foldere (inclusiv imbricare nelimitată) și dialogul Creează Folder / Subfolder (nume + Da/Nu).
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { liveTabs, itemsOf, itemsInFolder, countInFolder, dataOf, canView, isOpen, newItem, item as getItem, addTab } from '../core/store.js';
import { openModal, pinDlg, toast } from './modal.js';
import { unlockTemp } from '../core/store.js';

export function folderNameOf(f) {
  if (!f) return '';
  const d = dataOf(f);
  return d && canView(f) ? (d.name || t('untitled')) : t('lockedItem');
}

export async function foldersTab() {
  return liveTabs().find(x => x.kind === 'folders') || await addTab(t('tabFolders'), 'folders');
}

// Un singur dialog: câmpul de nume și confirmarea Da/Nu. Nu se creează nimic fără Da.
export function createFolderDlg({ title, hint } = {}) {
  return new Promise(res => {
    let done = false;
    const inp = h('input', { class: 'inp', type: 'text', placeholder: t('folderNamePh'), enterkeyhint: 'done', 'data-test': 'folder-name' });
    const finish = (v, m) => { if (done) return; done = true; res(v); m.close(); };
    const m = openModal({
      title: title || t('createFolder'),
      body: h('div', {}, hint ? h('p', { class: 'm-msg' }, hint) : null, h('label', { class: 'fld' }, h('span', {}, t('folderNamePh')), inp)),
      actions: [
        { label: t('no'), cls: 'ghost', onClick: m => finish(null, m) },
        { label: t('yes'), cls: 'primary', onClick: m => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } finish(v, m); } },
      ],
      onClose: () => { if (!done) res(null); },
    });
    m.el.dataset.test = 'create-folder';
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(); if (v) finish(v, m); else inp.focus(); } });
    setTimeout(() => inp.focus(), 60);
  });
}

export async function createFolder(tab, parent) {
  const name = await createFolderDlg({
    title: parent ? t('createSubfolder') : t('createFolder'),
    hint: parent ? t('createSubfolderAsk', { n: folderNameOf(parent) }) : t('createFolderAsk'),
  });
  if (!name) return null;
  const f = await newItem(tab.id, 'folder', { name }, { folder: parent ? parent.id : null });
  toast(t('savedOk'));
  return f;
}

async function ensureOpenFolder(f) {
  if (!f || !f.lock || isOpen(f)) return canView(f);
  const ok = await pinDlg(t('unlockNamed', { n: folderNameOf(f) }), { verify: pin => unlockTemp(f, pin) });
  return !!ok && canView(f);
}

// Alege un folder din arborele tabului Foldere. Întoarce folderul sau null.
export async function pickFolder({ title, confirmLabel } = {}) {
  const tab = await foldersTab();
  return new Promise(res => {
    let here = null; // folder curent sau null = rădăcină
    let done = false;
    const body = h('div', { class: 'folder-pick' });
    const finish = (v, m) => { if (done) return; done = true; res(v); m.close(); };
    const m = openModal({
      title: title || t('archiveIn'),
      body, kind: 'page', cls: 'folder-pick-page',
      onClose: () => { if (!done) res(null); },
    });
    m.el.dataset.test = 'folder-pick';
    const draw = async () => {
      body.innerHTML = '';
      const crumbs = h('div', { class: 'crumbs' });
      crumbs.append(h('button', { class: 'crumb', type: 'button', onclick: () => { here = null; draw(); } }, t('tkFolders')));
      const chain = []; let x = here; while (x) { chain.unshift(x); x = x.folder && getItem(x.folder); }
      chain.forEach(f => {
        crumbs.append(h('span', { class: 'crumb-sep' }, '›'));
        crumbs.append(h('button', { class: 'crumb', type: 'button', onclick: () => { here = f; draw(); } }, folderNameOf(f)));
      });
      if (here) crumbs.prepend(h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('back'), onclick: () => { here = here.folder ? getItem(here.folder) : null; draw(); } }, '‹'));
      body.append(crumbs);

      const parentId = here ? here.id : null;
      const subs = itemsOf(tab.id, { folder: parentId, kind: 'folder' }).sort((a, b) => (a.order || 0) - (b.order || 0));
      const list = h('div', { class: 'fp-list' });
      if (!subs.length && !here) {
        list.append(h('div', { class: 'hint' }, t('noFoldersHint')));
      }
      for (const f of subs) {
        const locked = !!f.lock && !isOpen(f);
        list.append(h('button', { class: 'card folder-row fp-item', type: 'button', 'data-id': f.id, onclick: async () => {
          if (locked && !(await ensureOpenFolder(f))) return;
          here = f; draw();
        } },
          h('div', { class: 'r1' },
            h('img', { class: 'fr-ic', src: 'icons/folder.png', alt: '' }),
            h('span', { class: 'r1t' }, folderNameOf(f)),
            locked ? h('span', {}, '🔒') : null,
            h('span', { class: 'r1-meta' }, String(countInFolder(f.id))))));
      }
      body.append(list);

      const acts = h('div', { class: 'fp-acts' });
      acts.append(h('button', { class: 'btn ghost', type: 'button', 'data-test': here ? 'fp-new-sub' : 'fp-new',
        onclick: async () => {
          const created = await createFolder(tab, here);
          if (created) { here = created; draw(); }
        } }, here ? t('createSubfolder') : t('createFolder')));
      if (here) {
        acts.append(h('button', { class: 'btn primary', type: 'button', 'data-test': 'fp-here',
          onclick: () => finish(here, m) }, confirmLabel || t('archiveHere')));
      }
      body.append(acts);
    };
    const back = m.el.querySelector('.m-back');
    if (back) back.addEventListener('click', e => { /* default close */ });
    draw();
  });
}
