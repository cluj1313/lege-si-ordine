// Ecranele taburilor: listă generică, Salvate (subtaburi), Foldere, Ultimele noutăți.
import { h, act, onLongPress, fmtDate, norm } from '../core/util.js';
import { t } from '../core/i18n.js';
import { locksChain } from '../core/store.js';
import { state, itemsOf, itemsInFolder, countInFolder, dataOf, canView, isOpen, newItem, saveItem, saveTab, unlockTemp, relock, descendants, item as getItem,
  lockWithPin, unlockPermanent, trash, saveUI, saveMeta } from '../core/store.js';
import { renderList, card, ui } from '../ui/list.js';
import { pinDlg, promptDlg, sheet, toast, confirmDlg } from '../ui/modal.js';
import { timeField } from '../ui/datetime.js';
import { app } from '../ui/registry.js';
import { waLink, mailLink } from '../features/share.js';
import { db } from '../core/db.js';
import { createFolder } from '../ui/folderpick.js';
import { recTitle } from './kinds.js';
import { catRow, curCat } from './cats.js';
import { pillRow, visibilitySheet } from '../ui/pillrow.js';
import { renderDayGroups } from '../ui/daygroups.js';
import { KINDS } from './kinds.js';
import { isoFromDate } from '../core/util.js';

export function renderLocked(view, obj, name) {
  view.append(h('div', { class: 'locked-screen' },
    h('div', { class: 'lk-ic' }, '🔒'),
    h('div', { class: 'lk-t' }, t('isLocked', { n: name })),
    h('button', { class: 'btn primary', type: 'button', 'data-test': 'unlock-tab', onclick: async () => {
      const ok = await pinDlg(t('unlockNamed', { n: name }), { verify: pin => unlockTemp(obj, pin) });
      if (ok) app.render();
    } }, t('unlock'))));
}

export const hasCats = tab => tab.kind === 'law' || tab.kind === 'document';
export function renderGeneric(view, tab) {
  if (tab.kind === 'law') view.append(h('div', { class: 'hint' }, t('lawHint')));
  let items = itemsOf(tab.id, { folder: null });
  if (hasCats(tab)) {
    view.append(catRow(tab, tab.kind === 'document' ? 'folder' : 'pill'));
    const c = curCat(tab);
    if (c !== 'all') items = items.filter(i => i.cat === c);
  }
  const list = h('div', { class: 'list' });
  view.append(list);
  renderList(list, items, { kind: tab.kind === 'note' ? 'note' : tab.kind });
}

// ---- Monitorul Oficial: organizat pe zile (data publicării) ----
export function renderMO(view, tab) {
  const all = itemsOf(tab.id);
  const official = all.filter(i => i.official && canView(i));
  view.append(h('div', { class: 'hint' }, t('moHint')));
  if (official.length) view.append(h('div', { class: 'mo-sources' }, official.map(i => { const d = dataOf(i); return h('a', { class: 'pill src', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, d.title.replace(/ –.*$/, '') + ' ↗'); })));
  const mine = all.filter(i => !i.official);
  const list = h('div', { class: 'days' });
  view.append(list);
  renderDayGroups(list, mine, {
    key: tab.id, empty: t('moEmpty'),
    dateOf: it => { const d = dataOf(it); return (d && d.actDate) || isoFromDate(new Date(it.created)); },
    summary: items => items.map(i => (canView(i) ? KINDS.law.title(dataOf(i)) : '🔒')).join(' · '),
    renderItem: it => card(it),
  });
}

// ---- Salvate: subtaburi Salvate, Descărcate, + ----
export function savedSubs(tab) {
  return tab.subs && tab.subs.length ? tab.subs : [{ id: 'salvate', name: t('subSaved') }, { id: 'descarcate', name: t('subDownloaded') }];
}
export function renderSaved(view, tab) {
  const subs = savedSubs(tab);
  const vis = subs.filter(x => x.visible !== false);
  let cur = state.ui.sub[tab.id] || vis[0]?.id || subs[0].id;
  if (!subs.find(s => s.id === cur)) cur = subs[0].id;
  view.append(pillRow({
    items: vis.map(s => ({ id: s.id, name: s.name, count: itemsOf(tab.id, { sub: s.id }).length, fixed: ['salvate', 'descarcate'].includes(s.id) })),
    activeId: cur, test: 'saved-row',
    onPick: s => { state.ui.sub[tab.id] = s.id; saveUI(); app.render(); },
    onAdd: async () => { const n = await promptDlg(t('addSubtab')); if (!n) return; tab.subs = [...subs, { id: 's' + Date.now().toString(36), name: n, visible: true }]; await saveTab(tab); },
    onManage: () => visibilitySheet(t('manageVisible'), subs, async out => { tab.subs = out.map(o => ({ ...subs.find(s => s.id === o.id), visible: o.visible })); await saveTab(tab); }),
    onItemMenu: s => subMenu(tab, subs.find(x => x.id === s.id)),
  }));
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
const folderName = f => { const d = dataOf(f); return d && locksChain(f).every(isOpen) ? d.name : t('lockedItem'); };
const countIn = f => countInFolder(f.id);
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
  const allRoots = roots;
  view.append(pillRow({
    items: allRoots.filter(f => !f.hidden).map(f => ({ id: f.id, name: folderName(f), count: countIn(f), locked: !!f.lock })),
    activeId: activeRoot && activeRoot.id, variant: 'folder', test: 'folder-row',
    onPick: f => enterFolder(tab, getItem(f.id)),
    onAdd: () => newFolder(tab, null),
    onManage: () => visibilitySheet(t('manageVisible'), allRoots.map(f => ({ id: f.id, name: folderName(f), visible: !f.hidden })), async out => {
      for (const [i, o] of out.entries()) { const f = getItem(o.id); f.order = i; f.hidden = !o.visible; await saveMeta(f); }
      if (activeRoot && activeRoot.hidden) state.ui.folder[tab.id] = null;
    }),
    onItemMenu: f => folderMenu(tab, getItem(f.id)),
  }));

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
  const kids = (here ? itemsInFolder(here) : itemsOf(tab.id, { folder: null })).filter(i => i.kind !== 'folder');
  const recsAll = kids.filter(i => i.kind === 'rec');
  const notes = kids.filter(i => i.kind !== 'rec');
  if (here) {
    const box = h('div', { class: 'arch-search' });
    const inp = h('input', { class: 'inp', type: 'search', placeholder: t('archiveSearchPh'), 'data-test': 'archive-search', enterkeyhint: 'search' });
    box.append(inp);
    panel.append(box);
    const list = h('div', { class: 'list', 'data-test': 'folder-items' });
    panel.append(list);
    const drawList = () => {
      list.innerHTML = '';
      const q = norm(inp.value);
      const recs = q ? recsAll.filter(it => { const d = canView(it) && dataOf(it); return d && norm([recTitle(d), d.client || '', d.caseNumber || '', d.transcript || '', d.name || ''].join(' ')).includes(q); }) : recsAll;
      const items = q ? recs : [...recs, ...notes];
      if (!items.length) list.append(h('div', { class: 'empty' }, recsAll.length && q ? t('noArchiveHits') : (subs.length ? '' : t('emptyFolder'))));
      else items.forEach(it => list.append(card(it)));
    };
    inp.addEventListener('input', drawList);
    drawList();
  } else {
    const list = h('div', { class: 'list' });
    renderList(list, notes, { kind: 'note', empty: t('foldersRootHint') });
    panel.append(list);
  }
  view.append(panel);
}
export async function newFolder(tab, parent) {
  const f = await createFolder(tab, parent);
  if (f) app.render();
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
