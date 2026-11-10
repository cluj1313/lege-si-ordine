// Ecranele taburilor: listă generică, Salvate (subtaburi), Foldere, Ultimele noutăți.
import { h, act, onLongPress, fmtDate } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, itemsOf, dataOf, canView, isOpen, newItem, saveItem, saveTab, unlockTemp, relock, descendants, item as getItem,
  lockWithPin, unlockPermanent, trash, saveUI } from '../core/store.js';
import { renderList, card, ui } from '../ui/list.js';
import { pinDlg, promptDlg, sheet, toast, confirmDlg } from '../ui/modal.js';
import { timeField } from '../ui/datetime.js';
import { app } from '../ui/registry.js';
import { waLink, mailLink } from '../features/share.js';
import { db } from '../core/db.js';

export function renderLocked(view, obj, name) {
  view.append(h('div', { class: 'locked-screen' },
    h('div', { class: 'lk-ic' }, '🔒'),
    h('div', { class: 'lk-t' }, t('isLocked', { n: name })),
    h('button', { class: 'btn primary', type: 'button', 'data-test': 'unlock-tab', onclick: async () => {
      const ok = await pinDlg(t('unlockNamed', { n: name }), { verify: pin => unlockTemp(obj, pin) });
      if (ok) app.render();
    } }, t('unlock'))));
}

export function renderGeneric(view, tab) {
  if (tab.kind === 'law') view.append(h('div', { class: 'hint' }, t('lawHint')));
  const list = h('div', { class: 'list' });
  view.append(list);
  renderList(list, itemsOf(tab.id, { folder: null }), { kind: tab.kind === 'note' ? 'note' : tab.kind });
}

// ---- Salvate: subtaburi Salvate, Descărcate, + ----
export function savedSubs(tab) {
  return tab.subs && tab.subs.length ? tab.subs : [{ id: 'salvate', name: t('subSaved') }, { id: 'descarcate', name: t('subDownloaded') }];
}
export function renderSaved(view, tab) {
  const subs = savedSubs(tab);
  let cur = state.ui.sub[tab.id] || subs[0].id;
  if (!subs.find(s => s.id === cur)) cur = subs[0].id;
  const bar = h('div', { class: 'subtabs' });
  subs.forEach(s => {
    const b = h('button', { class: 'pill subtab' + (s.id === cur ? ' active' : ''), type: 'button', onclick: () => { state.ui.sub[tab.id] = s.id; saveUI(); app.render(); } },
      s.name, h('span', { class: 'cnt' }, String(itemsOf(tab.id, { sub: s.id }).length)));
    if (!['salvate', 'descarcate'].includes(s.id)) onLongPress(b, () => subMenu(tab, s));
    bar.append(b);
  });
  bar.append(h('button', { class: 'pill subtab add', type: 'button', 'aria-label': t('addSubtab'), onclick: async () => {
    const n = await promptDlg(t('addSubtab')); if (!n) return;
    tab.subs = [...subs, { id: 's' + Date.now().toString(36), name: n }]; await saveTab(tab); app.render();
  } }, '+'));
  view.append(bar);
  const list = h('div', { class: 'list' });
  view.append(list);
  renderList(list, itemsOf(tab.id, { sub: cur }), { kind: 'note', empty: cur === 'descarcate' ? t('emptyDownloaded') : t('emptySaved') });
}
async function subMenu(tab, s) {
  const v = await sheet(s.name, [{ label: t('rename'), value: 'ren', icon: '✎' }, { label: t('delete'), value: 'del', icon: '🗑', cls: 'danger' }]);
  if (v === 'ren') { const n = await promptDlg(t('rename'), { value: s.name }); if (n) { s.name = n; await saveTab(tab); app.render(); } }
  if (v === 'del' && await confirmDlg(t('confirmDeleteSubtab', { n: s.name }), { danger: true })) {
    for (const it of itemsOf(tab.id, { sub: s.id })) { it.sub = 'salvate'; await db.put('lso_items', it); }
    tab.subs = savedSubs(tab).filter(x => x.id !== s.id); await saveTab(tab); app.render();
  }
}

// ---- Foldere ----
const folderName = f => (canView(f) ? dataOf(f).name : t('lockedItem'));
const countIn = f => itemsOf(f.tab, { folder: f.id }).length;
export function currentFolder(tab) {
  const id = state.ui.folder[tab.id];
  const f = id && getItem(id);
  if (f && !f.trashedAt && f.tab === tab.id && f.kind === 'folder') return f;
  return null;
}
export async function enterFolder(tab, f) {
  const prev = currentFolder(tab);
  if (f && f.lock && !isOpen(f)) {
    const ok = await pinDlg(t('unlockNamed', { n: folderName(f) }), { verify: pin => unlockTemp(f, pin) });
    if (!ok) return;
  }
  // reblocare la ieșirea dintr-un folder blocat (dacă nu intrăm într-un subfolder al lui)
  if (prev && prev.lock && (!f || !isInside(f, prev))) relock(prev);
  state.ui.folder[tab.id] = f ? f.id : null; saveUI(); app.render();
}
function isInside(f, anc) { let x = f; while (x) { if (x.id === anc.id) return true; x = x.folder && getItem(x.folder); } return false; }

export function renderFolders(view, tab) {
  const roots = itemsOf(tab.id, { folder: null, kind: 'folder' }).sort((a, b) => (a.order || 0) - (b.order || 0));
  let cur = currentFolder(tab);
  if (cur && !canView(cur)) cur = null;
  if (cur && cur.lock && !isOpen(cur)) cur = null;
  const rootOf = f => { let x = f; while (x && x.folder) x = getItem(x.folder); return x; };
  const activeRoot = cur ? rootOf(cur) : null;
  const strip = h('div', { class: 'folder-strip' + (roots.length > 3 ? ' scroll' : '') });
  roots.forEach(f => {
    const b = h('button', { class: 'folder-tile' + (activeRoot && activeRoot.id === f.id ? ' active' : ''), type: 'button', 'data-id': f.id, onclick: () => enterFolder(tab, f) },
      h('span', { class: 'ft-ic' }, h('img', { src: 'icons/folder.png', alt: '' }), f.lock ? h('i', { class: 'ft-lock' }, '🔒') : null),
      h('span', { class: 'ft-name' }, folderName(f), h('span', { class: 'cnt' }, String(countIn(f)))));
    onLongPress(b, () => folderMenu(tab, f));
    strip.append(b);
  });
  strip.append(h('button', { class: 'folder-add', type: 'button', 'aria-label': t('newFolder'), onclick: () => newFolder(tab, null) }, '+'));
  view.append(strip);

  const panel = h('div', { class: 'folder-panel' });
  const crumbs = h('div', { class: 'crumbs' });
  crumbs.append(h('button', { class: 'crumb', type: 'button', onclick: () => enterFolder(tab, null) }, t('tkFolders')));
  const chain = []; let x = cur; while (x) { chain.unshift(x); x = x.folder && getItem(x.folder); }
  chain.forEach(f => { crumbs.append(h('span', { class: 'crumb-sep' }, '›')); crumbs.append(h('button', { class: 'crumb', type: 'button', onclick: () => enterFolder(tab, f) }, folderName(f))); });
  if (cur) crumbs.prepend(h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('back'), onclick: () => enterFolder(tab, cur.folder ? getItem(cur.folder) : null) }, '‹'));
  panel.append(crumbs);
  const here = cur ? cur.id : null;
  const subs = itemsOf(tab.id, { folder: here, kind: 'folder' });
  if (here) subs.forEach(f => {
    const row = h('div', { class: 'card folder-row', 'data-id': f.id, onclick: () => enterFolder(tab, f) },
      h('div', { class: 'r1' }, h('img', { class: 'fr-ic', src: 'icons/folder.png', alt: '' }), h('span', { class: 'r1t' }, folderName(f)), f.lock ? h('span', {}, '🔒') : null, h('span', { class: 'r1-meta' }, String(countIn(f)))));
    onLongPress(row, () => folderMenu(tab, f));
    panel.append(row);
  });
  const notes = itemsOf(tab.id, { folder: here }).filter(i => i.kind !== 'folder');
  const list = h('div', { class: 'list' });
  renderList(list, notes, { kind: 'note', empty: subs.length && here ? '' : (here ? t('emptyFolder') : t('foldersRootHint')) });
  panel.append(list);
  view.append(panel);
}
export async function newFolder(tab, parent) {
  const n = await promptDlg(t('newFolder'), { placeholder: t('folderNamePh') });
  if (!n) return;
  await newItem(tab.id, 'folder', { name: n }, { folder: parent ? parent.id : null });
  toast(t('savedOk'));
}
async function folderMenu(tab, f) {
  if (!canView(f)) return;
  const v = await sheet(folderName(f), [
    { label: t('rename'), value: 'ren', icon: '✎' },
    f.lock ? { label: t('unlockPermanent'), value: 'unlock', icon: '🔓' } : { label: t('lockPin'), value: 'lock', icon: '🔒' },
    { label: t('delete'), value: 'del', icon: '🗑', cls: 'danger' },
  ]);
  if (v === 'ren') { const n = await promptDlg(t('rename'), { value: folderName(f) }); if (n) await saveItem(f, { ...dataOf(f), name: n }); }
  else if (v === 'lock') {
    // pentru a cripta conținutul, folderul trebuie să fie accesibil acum
    const pin = await pinDlg(t('lockPin'), { confirm: true }); if (!pin) return;
    try { await lockWithPin(f, pin); relock(f); if (currentFolder(tab)?.id === f.id || isInside(currentFolder(tab), f)) { state.ui.folder[tab.id] = f.folder || null; } toast(t('lockedOk')); app.render(); }
    catch { toast(t('unlockInnerFirst'), 3500); }
  } else if (v === 'unlock') {
    const ok = await pinDlg(t('unlockPermanent'), { verify: pin => unlockPermanent(f, pin).catch(() => false) }); if (ok) toast(t('unlockedOk'));
  } else if (v === 'del') {
    const n = descendants(f.id).length;
    if (await confirmDlg(t('confirmTrashFolder', { n: folderName(f), c: n }), { danger: true })) { await trash(f); if (currentFolder(tab)?.id === f.id) state.ui.folder[tab.id] = f.folder || null; toast(t('movedToTrash')); app.render(); }
  }
}

// ---- Ultimele noutăți ----
const GROUPS = [['w', 'newsWords'], ['p', 'newsPhrases'], ['l', 'newsLaws']];
export async function newsResults() { return (await db.kvGet('news_results', [])) || []; }
export function renderNews(view, tab, results = []) {
  view.append(h('div', { class: 'page-title' }, h('h1', {}, t('tkNews')), h('div', { class: 'r2-meta' }, t('newsSub'))));
  view.append(h('div', { class: 'hint stage2' }, t('newsStage2')));
  const tf = timeField(state.settings.newsHour || '08:00', { label: t('newsHour') });
  view.append(h('div', { class: 'news-hour' }, tf.el, h('button', { class: 'btn sm', type: 'button', onclick: async e => act(e.currentTarget, async () => {
    const v = tf.get(); if (!v) { toast(t('badTime')); return; }
    state.settings.newsHour = v; await (await import('../core/store.js')).saveSettings(); toast(t('newsHourSaved', { h: v }));
  }) }, t('save'))));
  const terms = itemsOf(tab.id, { kind: 'term' }).filter(canView);
  GROUPS.forEach(([g, key], gi) => {
    const sec = h('section', { class: 'news-sec', 'data-group': g });
    sec.append(h('h2', {}, t(key)));
    const mine = terms.filter(x => dataOf(x).group === g).sort((a, b) => a.created - b.created);
    if (!mine.length) sec.append(h('div', { class: 'r2-meta pad' }, t('newsNoTerms')));
    mine.forEach(it => {
      const d = dataOf(it);
      const res = results.filter(r => r.termId === it.id);
      const shareTxt = `${d.text}\n` + (res.length ? res.map(r => `${r.source} • ${fmtDate(r.date)} • ${r.url}`).join('\n') : t('newsNoResultsYet'));
      sec.append(h('div', { class: 'news-row', 'data-id': it.id },
        h('div', { class: 'nr-term' }, d.text),
        h('div', { class: 'nr-res' }, res.length ? res.map(r => h('a', { class: 'pill src', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `${r.source} • ${fmtDate(r.date)} ↗`)) : h('span', { class: 'r2-meta' }, t('newsNoResultsYet'))),
        h('div', { class: 'nr-act' },
          h('a', { class: 'icon-btn sm', href: waLink(shareTxt), target: '_blank', rel: 'noopener', 'aria-label': 'WhatsApp' }, '💬'),
          h('a', { class: 'icon-btn sm', href: mailLink(t('tkNews') + ': ' + d.text, shareTxt), 'aria-label': t('email') }, '✉'),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('delete'), onclick: () => app.deleteItem(it) }, '×'))));
    });
    const inp = h('input', { class: 'inp', type: 'text', placeholder: t('newsAddPh'), enterkeyhint: 'done' });
    const add = async () => { const v = inp.value.trim(); if (!v) return; await newItem(tab.id, 'term', { group: g, text: v }); toast(t('savedOk')); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    sec.append(h('div', { class: 'row-inp add-term' }, inp, h('button', { class: 'btn sm', type: 'button', onclick: e => act(e.currentTarget, add) }, '+')));
    view.append(sec);
  });
}
