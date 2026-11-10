// Selectoare de clienți și dosare: foaie a aplicației, cu căutare, fără <select> sau <datalist> native
// (în WebView-ul Android datalist-ul arată ca un select din care nu se poate alege).
import { h, norm } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, liveTabs, itemsOf, dataOf, canView, newItem, addTab } from '../core/store.js';
import { openModal, toast } from './modal.js';

export const CLIENT_PERSON = 'person';
export const CLIENT_FIRM = 'firm';
export const clientTypeOf = d => (d && d.clientType === CLIENT_FIRM ? CLIENT_FIRM : CLIENT_PERSON);
export const clientTypeLabel = typ => typ === CLIENT_FIRM ? t('clientFirm') : t('clientPerson');

export async function clientsTab() {
  return liveTabs().find(x => x.kind === 'client') || await addTab(t('tabClients'), 'client');
}
export async function casesTab() {
  return liveTabs().find(x => x.kind === 'case') || await addTab(t('tabCases'), 'case');
}

function visibleItems(kind) {
  return [...state.items.values()].filter(x => x.kind === kind && !x.trashedAt && canView(x));
}
export function clientRecords() {
  return visibleItems('client').map(it => {
    const d = dataOf(it) || {};
    return { it, name: d.name || t('untitled'), type: clientTypeOf(d), d };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ro'));
}
export function caseRecords() {
  return visibleItems('case').map(it => {
    const d = dataOf(it) || {};
    return { it, title: d.title || t('untitled'), number: d.number || '', client: d.client || '', d };
  }).sort((a, b) => a.title.localeCompare(b.title, 'ro'));
}

function openSheet({ title, test, draw }) {
  return new Promise(res => {
    let done = false;
    const body = h('div', { class: 'picker-sheet' });
    const finish = v => { if (done) return; done = true; res(v); m.close(); };
    const m = openModal({ title, body, kind: 'sheet', onClose: () => { if (!done) res(null); } });
    m.el.dataset.test = test;
    draw(body, finish, m);
  });
}

// Dialog unificat: nume + tip Persoană/Firmă + Da/Nu. Nu se creează nimic fără Da.
export function createClientDlg({ type = CLIENT_PERSON } = {}) {
  return new Promise(res => {
    let done = false;
    let typ = type === CLIENT_FIRM ? CLIENT_FIRM : CLIENT_PERSON;
    const inp = h('input', { class: 'inp', type: 'text', placeholder: typ === CLIENT_FIRM ? t('firmNamePh') : t('clientNamePh'), enterkeyhint: 'done', 'data-test': 'client-name' });
    const pills = h('div', { class: 'stage-pick' });
    const drawPills = () => {
      pills.innerHTML = '';
      for (const [v, lab, test] of [[CLIENT_PERSON, t('clientPerson'), 'client-type-person'], [CLIENT_FIRM, t('clientFirm'), 'client-type-firm']]) {
        pills.append(h('button', { type: 'button', class: 'pill' + (typ === v ? ' sel' : ''), 'data-test': test, onclick: () => { typ = v; inp.placeholder = typ === CLIENT_FIRM ? t('firmNamePh') : t('clientNamePh'); drawPills(); } }, lab));
      }
    };
    drawPills();
    const finish = (v, modal) => { if (done) return; done = true; res(v); modal.close(); };
    const modal = openModal({
      title: typ === CLIENT_FIRM ? t('createFirm') : t('createClient'),
      body: h('div', {},
        h('label', { class: 'fld' }, h('span', {}, t('clientType')), pills),
        h('label', { class: 'fld' }, h('span', {}, typ === CLIENT_FIRM ? t('fFirmName') : t('fNameSurname')), inp)),
      actions: [
        { label: t('no'), cls: 'ghost', onClick: m => finish(null, m) },
        { label: t('yes'), cls: 'primary', onClick: m => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } finish({ name: v, clientType: typ }, m); } },
      ],
      onClose: () => { if (!done) res(null); },
    });
    modal.el.dataset.test = 'create-client';
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(); if (v) finish({ name: v, clientType: typ }, modal); else inp.focus(); } });
    setTimeout(() => inp.focus(), 60);
  });
}

export async function createClient({ type } = {}) {
  const got = await createClientDlg({ type });
  if (!got) return null;
  const tab = await clientsTab();
  const it = await newItem(tab.id, 'client', {
    name: got.name, clientType: got.clientType, represents: '', phone: '', email: '', address: '',
    caseTitle: '', date: '', time: '', stage: 'nou', notes: '', files: [],
  });
  toast(t('savedOk'));
  return { it, name: got.name, type: got.clientType };
}

export function createCaseDlg() {
  return new Promise(res => {
    let done = false;
    const title = h('input', { class: 'inp', type: 'text', placeholder: t('fCaseTitle'), enterkeyhint: 'next', 'data-test': 'case-title' });
    const number = h('input', { class: 'inp', type: 'text', placeholder: t('fCaseNumber'), enterkeyhint: 'done', 'data-test': 'case-number' });
    const finish = (v, modal) => { if (done) return; done = true; res(v); modal.close(); };
    const modal = openModal({
      title: t('createCase'),
      body: h('div', {},
        h('label', { class: 'fld' }, h('span', {}, t('fCaseTitle')), title),
        h('label', { class: 'fld' }, h('span', {}, t('fCaseNumber')), number)),
      actions: [
        { label: t('no'), cls: 'ghost', onClick: m => finish(null, m) },
        { label: t('yes'), cls: 'primary', onClick: m => { const v = title.value.trim(); if (!v) { title.focus(); return; } finish({ title: v, number: number.value.trim() }, m); } },
      ],
      onClose: () => { if (!done) res(null); },
    });
    modal.el.dataset.test = 'create-case';
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); number.focus(); } });
    number.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = title.value.trim(); if (v) finish({ title: v, number: number.value.trim() }, modal); else title.focus(); } });
    setTimeout(() => title.focus(), 60);
  });
}

export async function createCase() {
  const got = await createCaseDlg();
  if (!got) return null;
  const tab = await casesTab();
  const it = await newItem(tab.id, 'case', {
    title: got.title, number: got.number, client: '', court: '', date: '', time: '', stage: 'nou', alarm: false, notes: '', files: [],
  });
  toast(t('savedOk'));
  return { it, title: got.title, number: got.number };
}

export function pickClient({ value = '' } = {}) {
  return openSheet({
    title: t('pickClient'),
    test: 'client-pick-sheet',
    draw: (body, finish) => {
      const search = h('input', { class: 'inp', type: 'search', placeholder: t('clientSearchPh'), 'data-test': 'client-pick-search', enterkeyhint: 'search' });
      const list = h('div', { class: 'picker-list' });
      const acts = h('div', { class: 'picker-acts' });
      acts.append(h('button', { class: 'btn ghost', type: 'button', 'data-test': 'client-new', onclick: async () => {
        const c = await createClient({ type: CLIENT_PERSON });
        if (c) finish(c.name);
      } }, t('clientNew')));
      acts.append(h('button', { class: 'btn ghost', type: 'button', 'data-test': 'client-new-firm', onclick: async () => {
        const c = await createClient({ type: CLIENT_FIRM });
        if (c) finish(c.name);
      } }, t('firmNew')));
      const drawList = () => {
        list.innerHTML = '';
        const q = norm(search.value);
        const all = clientRecords();
        const rows = q ? all.filter(c => norm([c.name, c.d.represents, c.d.notes, clientTypeLabel(c.type)].join(' ')).includes(q)) : all;
        if (value) list.append(h('button', { class: 'sheet-opt', type: 'button', 'data-test': 'client-clear', onclick: () => finish('') }, t('pickNone')));
        if (!rows.length) list.append(h('div', { class: 'hint' }, all.length ? t('noClientHits') : t('noClientsHint')));
        rows.forEach(c => {
          list.append(h('button', { class: 'sheet-opt' + (c.name === value ? ' on' : ''), type: 'button', 'data-name': c.name, onclick: () => finish(c.name) },
            h('span', {}, c.name), h('span', { class: 'so-ic' }, clientTypeLabel(c.type))));
        });
      };
      search.addEventListener('input', drawList);
      body.append(search, list, acts);
      drawList();
      setTimeout(() => search.focus(), 60);
    },
  });
}

export function pickCase({ value = '', mode = 'title' } = {}) {
  const valOf = c => (mode === 'number' ? c.number : c.title);
  return openSheet({
    title: t('pickCase'),
    test: 'case-pick-sheet',
    draw: (body, finish) => {
      const search = h('input', { class: 'inp', type: 'search', placeholder: t('caseSearchPh'), 'data-test': 'case-pick-search', enterkeyhint: 'search' });
      const list = h('div', { class: 'picker-list' });
      const acts = h('div', { class: 'picker-acts' });
      acts.append(h('button', { class: 'btn ghost', type: 'button', 'data-test': 'case-new', onclick: async () => {
        const c = await createCase();
        if (c) finish(valOf(c) || c.title);
      } }, t('caseNew')));
      const drawList = () => {
        list.innerHTML = '';
        const q = norm(search.value);
        const all = caseRecords();
        const rows = q ? all.filter(c => norm([c.title, c.number, c.client].join(' ')).includes(q)) : all;
        const usable = mode === 'number' ? rows.filter(c => c.number) : rows;
        if (value) list.append(h('button', { class: 'sheet-opt', type: 'button', 'data-test': 'case-clear', onclick: () => finish('') }, t('pickNone')));
        if (!usable.length) list.append(h('div', { class: 'hint' }, all.length ? t('noCaseHits') : t('noCasesHint')));
        usable.forEach(c => {
          const v = valOf(c);
          list.append(h('button', { class: 'sheet-opt' + (v === value ? ' on' : ''), type: 'button', onclick: () => finish(v) },
            h('span', {}, mode === 'number' ? (c.number + (c.title ? ' · ' + c.title : '')) : (c.title + (c.number ? ' · ' + c.number : '')))));
        });
      };
      search.addEventListener('input', drawList);
      body.append(search, list, acts);
      drawList();
      setTimeout(() => search.focus(), 60);
    },
  });
}

// Câmp de formular: buton care deschide foaia (nu input list / select nativ).
export function pickField({ value = '', list, label, test, onChange } = {}) {
  let cur = value || '';
  const btn = h('button', { class: 'inp pick-btn' + (cur ? '' : ' placeholder'), type: 'button', 'data-test': test || (list + '-pick') });
  const draw = () => {
    btn.textContent = cur || t('pickPlaceholder');
    btn.classList.toggle('placeholder', !cur);
  };
  draw();
  btn.addEventListener('click', async () => {
    const picked = list === 'clients' ? await pickClient({ value: cur })
      : list === 'caseNumbers' ? await pickCase({ value: cur, mode: 'number' })
      : await pickCase({ value: cur, mode: 'title' });
    if (picked == null) return;
    cur = picked;
    draw();
    onChange && onChange(cur);
  });
  return { el: h('label', { class: 'fld' }, h('span', {}, label), btn), get: () => cur, set: v => { cur = v || ''; draw(); }, btn };
}

// Alegere dintr-o listă scurtă (stări, limbi), tot prin foaia aplicației, fără <select>.
export async function pickChoice({ title, options, value }) {
  return new Promise(res => {
    let done = false;
    const list = h('div', { class: 'sheet-list' });
    const m = openModal({ title, body: list, kind: 'sheet', onClose: () => { if (!done) res(null); } });
    m.el.dataset.test = 'choice-sheet';
    for (const o of options) {
      const val = typeof o === 'object' ? o.value : o;
      const lab = typeof o === 'object' ? o.label : o;
      list.append(h('button', { class: 'sheet-opt' + (val === value ? ' on' : ''), type: 'button', 'data-v': val, onclick: () => { done = true; res(val); m.close(); } }, lab));
    }
  });
}

export function choiceField({ value = '', options, label, test, onChange } = {}) {
  let cur = value || '';
  const opts = () => (typeof options === 'function' ? options() : options);
  const labelOf = v => {
    const o = opts().find(x => (typeof x === 'object' ? x.value : x) === v);
    return o == null ? (v || t('pickPlaceholder')) : (typeof o === 'object' ? o.label : o);
  };
  const btn = h('button', { class: 'inp pick-btn' + (cur ? '' : ' placeholder'), type: 'button', 'data-test': test || 'choice-pick' });
  const draw = () => { btn.textContent = cur ? labelOf(cur) : t('pickPlaceholder'); btn.classList.toggle('placeholder', !cur); };
  draw();
  btn.addEventListener('click', async () => {
    const picked = await pickChoice({ title: label, options: opts(), value: cur });
    if (picked == null) return;
    cur = picked;
    draw();
    onChange && onChange(cur);
  });
  return { el: h('label', { class: 'fld' }, h('span', {}, label), btn), get: () => cur, set: v => { cur = v || ''; draw(); } };
}
