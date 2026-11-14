// Editor generic pentru elemente, construit din schema tipului (kinds.js).
import { h, act, fmtDate, toTs, uid } from '../core/util.js';
import { t } from '../core/i18n.js';
import { KINDS, STAGES, stageLabel, TAB_KINDS } from '../tabs/kinds.js';
import { state, tabById, dataOf, canView, saveItem, newItem, ownerOf, putMedia, getMedia, delMedia,
  lockWithPin, unlockPermanent, relock, liveTabs, relocate, isOpen } from '../core/store.js';
import { openModal, confirmDlg, pinDlg, sheet, toast, promptDlg } from './modal.js';
import { dateField, timeField } from './datetime.js';
import { ensureOpen } from './list.js';
import { pickFiles, compressImage, viewMedia } from '../features/media.js';
import { shareText, shareFile } from '../features/share.js';
import { readScreenAloud } from '../features/voice.js';
import { pickField, choiceField } from './pickers.js';
import { app } from './registry.js';
import { extOf } from './list.js';

// Editoare deschise: la trecerea în fundal, cele cu conținut blocat se salvează automat și se închid.
export const openEditors = new Set();

export function itemKindFor(tab, sub) {
  if (tab.kind === 'saved' && sub === 'descarcate') return 'document';
  return (TAB_KINDS[tab.kind] || TAB_KINDS.note).item;
}

export async function openEditor(tabId, it = null, opts = {}) {
  const tab = tabById(tabId);
  if (!tab) return;
  if (it && !canView(it)) { if (!(await ensureOpen(it))) return; }
  if (!it && tab.lock && !isOpen(tab)) return;
  const kind = it ? it.kind : (opts.kind || itemKindFor(tab, opts.sub));
  const K = KINDS[kind] || KINDS.note;
  const data = structuredClone(it ? dataOf(it) : { ...K.newData(), ...(opts.preset || {}) });
  const temp = it || { tab: tab.id, kind, folder: opts.folder || null, sub: opts.sub || null };
  const added = [], removed = [];
  let dirty = false, saved = false;
  const getters = [];
  const form = h('div', { class: 'ed-form' });
  form.addEventListener('input', () => { dirty = true; });

  const lists = {
    clients: () => [...state.items.values()].filter(x => x.kind === 'client' && !x.trashedAt && canView(x)).map(x => dataOf(x).name).filter(Boolean),
    cases: () => [...state.items.values()].filter(x => x.kind === 'case' && !x.trashedAt && canView(x)).map(x => dataOf(x).title).filter(Boolean),
    caseNumbers: () => [...state.items.values()].filter(x => x.kind === 'case' && !x.trashedAt && canView(x)).map(x => dataOf(x).number).filter(Boolean),
  };

  let row = null;
  for (const f of K.fields || []) {
    const label = f.label();
    let el;
    if ((f.type === 'text' || f.type === 'pick') && f.list) {
      const pf = pickField({ value: data[f.k] || '', list: f.list, label, test: (f.list === 'clients' ? 'client-pick' : f.list === 'caseNumbers' ? 'case-number-pick' : 'case-pick') });
      el = pf.el;
      getters.push(() => { data[f.k] = pf.get(); return true; });
    } else if (f.type === 'text' || f.type === 'url' || f.type === 'tel' || f.type === 'email') {
      const inp = h('input', { class: 'inp' + (f.type === 'text' ? ' voice-target' : ''), type: f.type === 'text' ? 'text' : f.type, 'data-k': f.k, autocomplete: 'off', enterkeyhint: 'next' });
      inp.value = data[f.k] || '';
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
      const extra = f.type === 'tel' && data[f.k] ? h('a', { class: 'icon-btn sm', href: 'tel:' + data[f.k] }, '📞') : f.type === 'email' && data[f.k] ? h('a', { class: 'icon-btn sm', href: 'mailto:' + data[f.k] }, '✉') : f.type === 'url' && /^https?:/.test(data[f.k] || '') ? h('a', { class: 'icon-btn sm', href: data[f.k], target: '_blank', rel: 'noopener noreferrer' }, '↗') : null;
      el = h('label', { class: 'fld' }, h('span', {}, label), extra ? h('div', { class: 'row-inp' }, inp, extra) : inp);
      getters.push(() => { data[f.k] = inp.value.trim(); return true; });
    const ocrBtn = h('button', { class: 'btn ghost sm', type: 'button', style: { marginTop: '8px' } }, 'OCR / Scan 📷');
    ocrBtn.addEventListener('click', async () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        toast('OCR local nu e disponibil. Poți folosi Adobe Scan / Google Lens și apoi Share → LEGE ȘI ORDINE.');
        // fallback: citește text simplu dacă e disponibil
      };
      inp.click();
    });
    if (f.type === 'textarea') ta.parentNode.append(ocrBtn);
      ta.value = data[f.k] || '';
      el = h('label', { class: 'fld' }, h('span', {}, label), ta);
      getters.push(() => { data[f.k] = ta.value.replace(/\s+$/, ''); return true; });
      if (f.main) setTimeout(() => { if (!it) ta.focus(); }, 120);
    } else if (f.type === 'date') {
      const df = dateField(data[f.k] || '', { label }); el = df.el;
      getters.push(() => { if (!df.valid()) { df.inp.classList.add('bad'); toast(t('badDate')); return false; } data[f.k] = df.get(); return true; });
    } else if (f.type === 'time') {
      const tf = timeField(data[f.k] || '', { label }); el = tf.el;
      getters.push(() => { if (!tf.valid()) { tf.inp.classList.add('bad'); toast(t('badTime')); return false; } data[f.k] = tf.get(); return true; });
    } else if (f.type === 'select') {
      const cf = choiceField({ value: data[f.k] || '', options: f.options, label, test: 'choice-' + f.k });
      el = cf.el;
      getters.push(() => { data[f.k] = cf.get(); return true; });
    } else if (f.type === 'check') {
      const cb = h('input', { type: 'checkbox', 'data-k': f.k }); cb.checked = !!data[f.k];
      el = h('label', { class: 'fld-check' }, cb, h('span', {}, label));
      getters.push(() => { data[f.k] = cb.checked; return true; });
    } else if (f.type === 'enum') {
      let cur = data[f.k] || f.def || '';
      const pills = h('div', { class: 'stage-pick' });
      const draw = () => {
        pills.innerHTML = '';
        (f.options() || []).forEach(o => {
          const v = o.value, lab = o.label;
          pills.append(h('button', { type: 'button', class: 'pill' + (cur === v ? ' sel' : ''), 'data-test': 'enum-' + f.k + '-' + v, onclick: () => { cur = v; dirty = true; draw(); } }, lab));
        });
      };
      draw();
      el = h('div', { class: 'fld' }, h('span', {}, label), pills);
      getters.push(() => { data[f.k] = cur; return true; });
    } else if (f.type === 'stage') {
      let cur = data[f.k] || '';
      const pills = h('div', { class: 'stage-pick' });
      const draw = () => { pills.innerHTML = ''; STAGES.forEach(s => pills.append(h('button', { type: 'button', class: 'pill stage st-' + s + (cur === s ? ' sel' : ''), onclick: () => { cur = s; dirty = true; draw(); } }, stageLabel(s)))); };
      draw();
      el = h('div', { class: 'fld' }, h('span', {}, label), pills);
      getters.push(() => { data[f.k] = cur; return true; });
    } else if (f.type === 'subtasks') {
      el = subtasksField(data, label, () => { dirty = true; });
    } else if (f.type === 'files') {
      el = filesField(data, label, temp, added, removed, () => { dirty = true; });
    }
    if (f.half) {
      if (!row) { row = h('div', { class: 'fld-row' }); form.append(row); }
      row.append(el); if (row.children.length >= 2) row = null;
    } else { row = null; form.append(el); }
  }

  const title = it ? K.title(data) : t('newOf', { k: K.label() });
  const close = async () => {
    if (!saved) for (const mid of added) await delMedia(mid);
    if (it && it.lock) relock(it);
  };
  const m = openModal({
    title, body: form, kind: 'page', cls: 'editor', dismissable: false, onClose: () => { close(); app.render(); },
    actions: [
      it ? { label: '⋮', cls: 'ghost more', onClick: () => moreMenu() } : null,
      { label: t('cancel'), cls: 'ghost', onClick: async m => { if (dirty && !(await confirmDlg(t('discardChanges')))) return; m.close(); } },
      { label: t('save'), cls: 'primary', onClick: m => doSave(m) },
    ].filter(Boolean),
  });
  m.el.dataset.test = 'editor';
  const handle = { isLocked: () => !!ownerOf(it || temp), autosave: async () => { if (dirty && await collect()) await doSave(m); else m.close(); } };
  openEditors.add(handle);
  app.speakEditor = async () => { if (!(await collect())) return ''; return plainText(K, data); };
  const prevClose = m.close; m.close = (...a) => { if (app.speakEditor) delete app.speakEditor; openEditors.delete(handle); prevClose(...a); };
  // butonul Înapoi cere confirmare dacă există modificări
  const head = m.el.querySelector('.m-back');
  const tryClose = async () => { if (dirty && !(await confirmDlg(t('discardChanges')))) return; m.close(); };
  m.onBack = tryClose;
  if (head) { const nb = head.cloneNode(true); head.replaceWith(nb); nb.addEventListener('click', tryClose); }

  async function collect() {
    for (const g of getters) if (!g()) return false;
    return true;
  }
  let saving = false;
  async function doSave(m) {
    if (saving) return;
    if (!(await collect())) return;
    saving = true;
    try {
      const alarmAt = K.alarm ? K.alarm(data) : null;
      if (alarmAt && alarmAt < Date.now()) toast(t('alarmPast'), 3500);
      let rec;
      if (it) { delete it.snoozeAt; delete it.firedAt; it.alarmAt = alarmAt && alarmAt > Date.now() ? alarmAt : null; rec = await saveItem(it, data); }
      else rec = await newItem(tab.id, kind, data, { folder: opts.folder || null, sub: opts.sub || null, cat: opts.cat || null, alarmAt: alarmAt && alarmAt > Date.now() ? alarmAt : null });
      for (const mid of removed) await delMedia(mid);
      saved = true; dirty = false;
      toast(t('savedOk'));
      m.close();
      app.afterSave && app.afterSave(rec);
    } finally { saving = false; }
  }
  async function moreMenu() {
    const own = it.lock;
    const v = await sheet(K.title(data), [
      { label: t('readAloud'), value: 'read', icon: '🔊' },
      { label: t('share'), value: 'share', icon: '📤' },
      { label: t('moveTo'), value: 'move', icon: '↔' },
      own ? { label: t('unlockPermanent'), value: 'unlock', icon: '🔓' } : { label: t('lockPin'), value: 'lock', icon: '🔒' },
      { label: t('delete'), value: 'del', icon: '🗑', cls: 'danger' },
    ]);
    if (v === 'read') { await collect(); readScreenAloud(); }
    else if (v === 'share') { await collect(); shareText(K.title(data), plainText(K, data)); }
    else if (v === 'move') {
      if (dirty) { toast(t('saveFirst')); return; }
      m.close(); await moveItem(it);
    }
    else if (v === 'lock') {
      if (dirty) { if (!(await collect())) return; await saveItem(it, data); dirty = false; }
      const pin = await pinDlg(t('lockPin'), { confirm: true });
      if (!pin) return;
      await lockWithPin(it, pin); toast(t('lockedOk'));
    } else if (v === 'unlock') {
      const ok = await pinDlg(t('unlockPermanent'), { verify: pin => unlockPermanent(it, pin) });
      if (ok) toast(t('unlockedOk'));
    } else if (v === 'del') {
      if (await app.deleteItem(it)) { saved = true; m.close(); }
    }
  }
  return m;
}

export function plainText(K, d) {
  const parts = [];
  for (const f of K.fields || []) {
    const v = d[f.k];
    if (v == null || v === '' || v === false) continue;
    if (f.type === 'date') parts.push(`${f.label()}: ${fmtDate(v)}`);
    else if (f.type === 'check') parts.push(f.label());
    else if (f.type === 'stage') parts.push(`${f.label()}: ${stageLabel(v)}`);
    else if (f.type === 'subtasks') v.forEach(s => parts.push(`${s.done ? '✓' : '○'} ${s.text}`));
    else if (f.type === 'files') { if (v.length) parts.push(`${f.label()}: ${v.map(x => x.name).join(', ')}`); }
    else if (f.type === 'textarea' || f.main1) parts.push(String(v));
    else parts.push(`${f.label()}: ${v}`);
  }
  return parts.join('\n');
}

function subtasksField(data, label, onDirty) {
  data.subs = data.subs || [];
  const list = h('div', { class: 'subs ed' });
  const draw = () => {
    list.innerHTML = '';
    data.subs.forEach((s, i) => {
      const inp = h('input', { class: 'inp sub-inp voice-target', type: 'text', value: s.text });
      inp.addEventListener('input', () => { s.text = inp.value; onDirty(); });
      list.append(h('div', { class: 'sub' + (s.done ? ' done' : '') },
        h('button', { class: 'circ sm' + (s.done ? ' on' : ''), type: 'button', onclick: () => { s.done = !s.done; onDirty(); draw(); } }, s.done ? '✓' : ''),
        inp,
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('delete'), onclick: async () => { if (await confirmDlg(t('confirmDeleteSub'))) { data.subs.splice(i, 1); onDirty(); draw(); } } }, '×')));
    });
  };
  const add = h('input', { class: 'inp', type: 'text', placeholder: t('addSubtask'), enterkeyhint: 'done' });
  const doAdd = () => { const v = add.value.trim(); if (!v) return; data.subs.push({ id: uid('s'), text: v, done: false }); add.value = ''; onDirty(); draw(); add.focus(); };
  add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  draw();
  return h('div', { class: 'fld' }, h('span', {}, label), list, h('div', { class: 'row-inp' }, add, h('button', { class: 'btn sm', type: 'button', onclick: doAdd }, '+')));
}

function filesField(data, label, temp, added, removed, onDirty) {
  data.files = data.files || [];
  const list = h('div', { class: 'files' });
  const draw = () => {
    list.innerHTML = '';
    if (!data.files.length) list.append(h('div', { class: 'r2-meta' }, t('noFiles')));
    data.files.forEach((f, i) => {
      list.append(h('div', { class: 'file-row' },
        h('button', { class: 'file-open', type: 'button', onclick: async () => { const m = await getMedia(f.mid); if (m) viewMedia(m, f.name); else toast(t('mediaMissing')); } },
          h('span', { class: 'f-ic' }, /^image/.test(f.mime) ? '🖼' : /^audio/.test(f.mime) ? '🎙' : '📄'), h('span', { class: 'f-name' }, f.name)),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': t('more'), onclick: async () => {
          const v = await sheet(f.name, [{ label: t('rename'), value: 'ren', icon: '✎' }, { label: t('share'), value: 'share', icon: '📤' }, { label: t('delete'), value: 'del', icon: '🗑', cls: 'danger' }]);
          if (v === 'ren') { const n = await promptDlg(t('rename'), { value: f.name }); if (n) { f.name = n; onDirty(); draw(); } }
          else if (v === 'share') { const m = await getMedia(f.mid); if (m) shareFile(m.blob, f.name + (/\.\w{2,4}$/.test(f.name) ? '' : extOf(m.mime)), f.name); }
          else if (v === 'del' && await confirmDlg(t('confirmDeleteFile', { n: f.name }), { danger: true })) { removed.push(f.mid); data.files.splice(i, 1); onDirty(); draw(); }
        } }, '⋮')));
    });
  };
  const addFiles = async (files, askName) => {
    for (const file of files) {
      const blob = /^image\//.test(file.type) ? await compressImage(file) : file;
      let name = file.name || t('photo');
      if (askName) { const n = await promptDlg(t('photoName'), { value: name.replace(/\.\w+$/, '') }); if (!n) continue; name = n; }
      try {
        const mid = await putMedia(blob, name, blob.type || file.type, ownerOf(temp));
        added.push(mid); data.files.push({ mid, name, mime: blob.type || file.type });
        onDirty(); draw();
      } catch (e) { console.error(e); toast(t('fileSaveFail')); }
    }
  };
  draw();
  return h('div', { class: 'fld' }, h('span', {}, label), list,
    h('div', { class: 'row-btns' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, async () => addFiles(await pickFiles({ accept: 'image/*' }), true)) }, t('photoNamed')),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, async () => addFiles(await pickFiles({ accept: 'image/*', capture: true }), true)) }, t('takePhoto')),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: e => act(e.currentTarget, async () => addFiles(await pickFiles({ multiple: true }), false)) }, t('attachFile'))));
}

export async function moveItem(it) {
  const targets = liveTabs().filter(x => x.id !== it.tab && ((TAB_KINDS[x.kind] || {}).item === it.kind || (it.kind === 'note' && (x.kind === 'folders' || x.kind === 'saved'))));
  const v = await sheet(t('moveTo'), targets.map(x => ({ label: x.name, value: x.id })));
  if (!v) return false;
  const dest = tabById(v);
  if (dest.lock && !isOpen(dest)) { const ok = await pinDlg(t('unlockNamed', { n: dest.name }), { verify: async pin => (await import('../core/store.js')).unlockTemp(dest, pin) }); if (!ok) return false; }
  await relocate(it, { tab: dest.id, folder: null, cat: null, sub: dest.kind === 'saved' ? 'salvate' : null });
  toast(t('movedTo', { n: dest.name }));
  return true;
}
