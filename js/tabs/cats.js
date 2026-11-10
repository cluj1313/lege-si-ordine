// Categorii pe tab (foldere în Documente, subcategorii în Legi): adăugare nelimitată, vizibilitate, ordine; salvate în IndexedDB (în înregistrarea tabului).
import { h, uid } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, saveTab, itemsOf, saveUI, saveMeta } from '../core/store.js';
import { pillRow, visibilitySheet, mergeOrder } from '../ui/pillrow.js';
import { promptDlg, sheet, confirmDlg, toast } from '../ui/modal.js';
import { app } from '../ui/registry.js';

export const DEFAULT_CATS = {
  law: () => [t('catConstitution'), t('catCodes'), t('catLaws'), t('catPortals')],
  document: () => [t('catClientActs'), t('catRequests'), t('catEvidence')],
};
export const mkCats = names => names.map((name, i) => ({ id: uid('c'), name, visible: true, order: i }));
export const getCats = tab => (tab.cats || []).slice().sort((a, b) => a.order - b.order);
export const curCat = tab => { const c = state.ui.sub[tab.id]; return c && (c === 'all' || getCats(tab).some(x => x.id === c)) ? c : 'all'; };

// Pentru linkurile oficiale inițiale: categoria după titlu.
export function lawCatFor(cats, title) {
  const by = n => cats.find(c => c.name === n)?.id || null;
  if (/constitu/i.test(title)) return by(t('catConstitution'));
  if (/^cod/i.test(title)) return by(t('catCodes'));
  if (/portal/i.test(title)) return by(t('catPortals'));
  return by(t('catLaws'));
}

export function catRow(tab, variant) {
  const cats = getCats(tab);
  const cur = curCat(tab);
  const all = itemsOf(tab.id);
  const items = [{ id: 'all', name: t('catAll'), fixed: true, count: all.length },
    ...cats.filter(c => c.visible !== false).map(c => ({ id: c.id, name: c.name, count: all.filter(i => i.cat === c.id).length }))];
  return pillRow({
    items, activeId: cur, variant, test: 'cat-row',
    onPick: c => { state.ui.sub[tab.id] = c.id; saveUI(); app.render(); },
    onAdd: async () => {
      const n = await promptDlg(variant === 'folder' ? t('newFolder') : t('newCategory')); if (!n) return;
      const c = { id: uid('c'), name: n, visible: true, order: cats.length };
      tab.cats = [...cats, c]; state.ui.sub[tab.id] = c.id; await saveUI(); await saveTab(tab);
    },
    onReorder: async ids => { mergeOrder(cats, ids).forEach((c, i) => { tab.cats.find(x => x.id === c.id).order = i; }); await saveTab(tab); },
    onManage: () => visibilitySheet(t('manageVisible'), cats, async out => {
      out.forEach((c, i) => { const o = tab.cats.find(x => x.id === c.id); o.visible = c.visible; o.order = i; });
      if (cur !== 'all' && tab.cats.find(x => x.id === cur)?.visible === false) state.ui.sub[tab.id] = 'all';
      await saveTab(tab);
    }),
    onItemMenu: async c => {
      const v = await sheet(c.name, [{ label: t('rename'), value: 'ren', icon: '✎' }, { label: t('hide'), value: 'hide', icon: '👁' }, { label: t('delete'), value: 'del', icon: '🗑', cls: 'danger' }]);
      const o = tab.cats.find(x => x.id === c.id);
      if (v === 'ren') { const n = await promptDlg(t('rename'), { value: o.name }); if (n) { o.name = n; await saveTab(tab); } }
      else if (v === 'hide') { o.visible = false; if (cur === c.id) state.ui.sub[tab.id] = 'all'; await saveTab(tab); }
      else if (v === 'del' && await confirmDlg(t('confirmDeleteCat', { n: o.name }), { danger: true })) {
        for (const it of all.filter(i => i.cat === c.id)) { it.cat = null; await saveMeta(it); }
        tab.cats = tab.cats.filter(x => x.id !== c.id); if (cur === c.id) state.ui.sub[tab.id] = 'all';
        await saveTab(tab); toast(t('catDeleted'));
      }
    },
  });
}
