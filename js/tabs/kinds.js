// Definițiile tipurilor de elemente: câmpuri de editare, rândul 1, rândul 2, sortare, text pentru căutare.
import { h, fmtDate, toTs, isoToday, fmtTsDate, fmtDur } from '../core/util.js';
import { t } from '../core/i18n.js';

import { state } from '../core/store.js';
const hhmm = ts => { if (!ts) return ''; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
export const DEFAULT_REC_STATUSES = () => [t('recStNew'), t('recStWork'), t('recStDone'), t('recStArchived')];
export const recArchivedStatus = () => t('recStArchived');
export function recLen(sec) {
  sec = Math.round(sec || 0);
  return sec < 60 ? t('recSeconds', { n: sec }) : t('recMinutes', { n: Math.round(sec / 60) });
}
export function recTitle(d) {
  const c = String(d.client || '').trim();
  return c || recName(d);
}
export const recStatuses = () => (state.settings.recStatuses && state.settings.recStatuses.length ? state.settings.recStatuses : DEFAULT_REC_STATUSES());
// Nume afișat: numele dat de utilizator; altfel primele cuvinte din transcriere; altfel „Înregistrare HH:MM”.
export function recName(d) {
  if (d.name && d.name.trim()) return d.name.trim();
  const w = String(d.transcript || '').trim().split(/\s+/).filter(Boolean);
  if (w.length) return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '');
  return t('recUnnamed', { h: hhmm(d.at) });
}
export const STAGES = ['nou', 'lucru', 'programat', 'acte', 'suspendat', 'finalizat'];
export const stageLabel = s => (STAGES.includes(s) ? t('stage_' + s) : (s || ''));
export const stagePill = s => s ? h('span', { class: 'pill stage st-' + (STAGES.includes(s) ? s : 'x') }, stageLabel(s)) : null;
const firstLine = s => String(s || '').split('\n')[0].trim();
const restLines = s => String(s || '').split('\n').slice(1).join('\n').trim();
const when = (d) => d.date ? `${fmtDate(d.date)}${d.time ? ' • ' + d.time : ''}` : '';
const byTermen = (a, b) => (toTs(a.date, a.time) ?? 9e15) - (toTs(b.date, b.time) ?? 9e15);
const excerpt = (s, n = 140) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

export const KINDS = {
  task: {
    label: () => t('kindTask'),
    newData: () => ({ text: '', date: isoToday(), time: '', alarm: false, done: false, subs: [], files: [] }),
    title: d => firstLine(d.text) || t('untitled'),
    fields: [
      { k: 'text', type: 'textarea', label: () => t('fTaskText'), main: true, rows: 5 },
      { k: 'date', type: 'date', label: () => t('fDate'), half: true },
      { k: 'time', type: 'time', label: () => t('fStartTime'), half: true },
      { k: 'alarm', type: 'check', label: () => t('fAlarmAtTime') },
      { k: 'subs', type: 'subtasks', label: () => t('fSubtasks') },
      { k: 'files', type: 'files', label: () => t('fPhotos') },
    ],
    alarm: d => (d.alarm && d.date && !d.done ? toTs(d.date, d.time || '09:00') : null),
    search: d => [d.text, ...(d.subs || []).map(s => s.text), ...(d.files || []).map(f => f.name)].join(' \n '),
  },
  note: {
    label: () => t('kindNote'),
    newData: () => ({ title: '', text: '', files: [] }),
    title: d => d.title || firstLine(d.text) || t('untitled'),
    fields: [
      { k: 'title', type: 'text', label: () => t('fTitle') },
      { k: 'text', type: 'textarea', label: () => t('fText'), main: true, rows: 8 },
      { k: 'files', type: 'files', label: () => t('fAttachments') },
    ],
    row2: (it, d) => h('div', { class: 'r2-col' }, d.text ? h('div', { class: 'r2-text' }, excerpt(d.text, 220)) : null,
      h('div', { class: 'r2-meta' }, fmtTsDate(it.updated), d.files?.length ? ` • 📎 ${d.files.length}` : '')),
    search: d => [d.title, d.text, ...(d.files || []).map(f => f.name)].join(' \n '),
  },
  case: {
    label: () => t('kindCase'),
    newData: () => ({ title: '', number: '', client: '', court: '', date: '', time: '', stage: 'nou', alarm: false, notes: '', files: [] }),
    title: d => d.title || t('untitled'),
    fields: [
      { k: 'title', type: 'text', label: () => t('fCaseTitle'), main1: true },
      { k: 'number', type: 'text', label: () => t('fCaseNumber') },
      { k: 'client', type: 'text', label: () => t('fClient'), list: 'clients' },
      { k: 'court', type: 'text', label: () => t('fCourt') },
      { k: 'date', type: 'date', label: () => t('fTermen'), half: true },
      { k: 'time', type: 'time', label: () => t('fTime'), half: true },
      { k: 'alarm', type: 'check', label: () => t('fAlarmTermen') },
      { k: 'stage', type: 'stage', label: () => t('fStage') },
      { k: 'notes', type: 'textarea', label: () => t('fNotes'), main: true, rows: 5 },
      { k: 'files', type: 'files', label: () => t('fDocs') },
    ],
    row2: (it, d) => h('div', { class: 'r2-split' },
      h('div', { class: 'r2-col' }, h('div', { class: 'r2-when' }, d.date ? t('termenAt', { w: when(d) }) : t('noTermen')),
        (d.court || d.number) ? h('div', { class: 'r2-meta' }, [d.number, d.court].filter(Boolean).join(' • ')) : null,
        d.client ? h('div', { class: 'r2-meta' }, t('clientIs', { c: d.client })) : null),
      stagePill(d.stage)),
    sort: (a, b) => byTermen(a, b),
    alarm: d => (d.alarm && d.date ? toTs(d.date, d.time || '09:00') : null),
    search: d => [d.title, d.number, d.client, d.court, stageLabel(d.stage), d.notes, ...(d.files || []).map(f => f.name)].join(' \n '),
  },
  client: {
    label: () => t('kindClient'),
    newData: () => ({ name: '', represents: '', phone: '', email: '', address: '', caseTitle: '', date: '', time: '', stage: 'nou', notes: '', files: [] }),
    title: d => [d.name || t('untitled'), d.represents].filter(Boolean).join(' – '),
    fields: [
      { k: 'name', type: 'text', label: () => t('fNameSurname') },
      { k: 'represents', type: 'text', label: () => t('fRepresents') },
      { k: 'caseTitle', type: 'text', label: () => t('fCase'), list: 'cases' },
      { k: 'date', type: 'date', label: () => t('fTermen'), half: true },
      { k: 'time', type: 'time', label: () => t('fTime'), half: true },
      { k: 'stage', type: 'stage', label: () => t('fStage') },
      { k: 'phone', type: 'tel', label: () => t('fPhone') },
      { k: 'email', type: 'email', label: () => t('fEmail') },
      { k: 'address', type: 'text', label: () => t('fAddress') },
      { k: 'notes', type: 'textarea', label: () => t('fNotes'), main: true, rows: 4 },
      { k: 'files', type: 'files', label: () => t('fDocs') },
    ],
    row2: (it, d) => h('div', { class: 'r2-split' },
      h('div', { class: 'r2-col' }, h('div', { class: 'r2-when' }, d.date ? t('termenAt', { w: when(d) }) : t('noTermen')),
        d.caseTitle ? h('div', { class: 'r2-meta' }, d.caseTitle) : null),
      stagePill(d.stage)),
    sort: (a, b) => byTermen(a, b),
    search: d => [d.name, d.represents, d.caseTitle, d.phone, d.email, d.address, stageLabel(d.stage), d.notes].join(' \n '),
  },
  deadline: {
    label: () => t('kindDeadline'),
    newData: () => ({ title: '', caseTitle: '', court: '', date: isoToday(), time: '', alarm: true, notes: '' }),
    title: d => d.title || t('untitled'),
    lead: d => h('span', { class: 'r1-date' }, d.date ? fmtDate(d.date).slice(0, 5) + (d.time ? ' ' + d.time : '') : '—'),
    fields: [
      { k: 'title', type: 'text', label: () => t('fDeadlineTitle') },
      { k: 'caseTitle', type: 'text', label: () => t('fCase'), list: 'cases' },
      { k: 'court', type: 'text', label: () => t('fCourt') },
      { k: 'date', type: 'date', label: () => t('fDate'), half: true },
      { k: 'time', type: 'time', label: () => t('fTime'), half: true },
      { k: 'alarm', type: 'check', label: () => t('fAlarmTermen') },
      { k: 'notes', type: 'textarea', label: () => t('fNotes'), main: true, rows: 4 },
    ],
    row2: (it, d) => h('div', { class: 'r2-split' },
      h('div', { class: 'r2-col' }, h('div', { class: 'r2-when' }, when(d)),
        (d.caseTitle || d.court) ? h('div', { class: 'r2-meta' }, [d.caseTitle, d.court].filter(Boolean).join(' • ')) : null,
        d.notes ? h('div', { class: 'r2-text' }, excerpt(d.notes)) : null),
      d.alarm ? h('span', { class: 'pill' }, '⏰') : null),
    sort: (a, b) => byTermen(a, b),
    alarm: d => (d.alarm && d.date ? toTs(d.date, d.time || '09:00') : null),
    past: d => d.date && (toTs(d.date, d.time || '23:59') < Date.now()),
    search: d => [d.title, d.caseTitle, d.court, d.notes].join(' \n '),
  },
  document: {
    label: () => t('kindDocument'),
    newData: () => ({ title: '', caseTitle: '', notes: '', files: [] }),
    title: d => d.title || t('untitled'),
    fields: [
      { k: 'title', type: 'text', label: () => t('fDocTitle') },
      { k: 'caseTitle', type: 'text', label: () => t('fCase'), list: 'cases' },
      { k: 'files', type: 'files', label: () => t('fFiles') },
      { k: 'notes', type: 'textarea', label: () => t('fNotes'), main: true, rows: 4 },
    ],
    row2: (it, d) => h('div', { class: 'r2-col' },
      d.caseTitle ? h('div', { class: 'r2-meta' }, d.caseTitle) : null,
      h('div', { class: 'r2-meta' }, `📎 ${t('nFiles', { n: (d.files || []).length })} • ${fmtTsDate(it.updated)}`),
      d.notes ? h('div', { class: 'r2-text' }, excerpt(d.notes)) : null),
    search: d => [d.title, d.caseTitle, d.notes, ...(d.files || []).map(f => f.name)].join(' \n '),
  },
  law: {
    label: () => t('kindLaw'),
    newData: () => ({ title: '', source: '', url: 'https://', actDate: '', notes: '' }),
    title: d => d.title || t('untitled'),
    fields: [
      { k: 'title', type: 'text', label: () => t('fTitle') },
      { k: 'source', type: 'text', label: () => t('fSource') },
      { k: 'url', type: 'url', label: () => t('fLink') },
      { k: 'actDate', type: 'date', label: () => t('fActDate') },
      { k: 'notes', type: 'textarea', label: () => t('fNotes'), main: true, rows: 4 },
    ],
    row2: null, // completat în list.js (are butoane de acțiune)
    search: d => [d.title, d.source, d.url, d.notes].join(' \n '),
  },
  term: {
    label: () => t('kindTerm'),
    newData: () => ({ group: 'w', text: '' }),
    title: d => d.text,
    search: d => d.text,
  },
  folder: {
    label: () => t('kindFolder'),
    newData: () => ({ name: '' }),
    title: d => d.name || t('untitled'),
    search: d => d.name,
  },
  rec: {
    label: () => t('kindRec'),
    newData: () => ({ name: '', client: '', caseNumber: '', duration: 0, mid: null, transcript: '', mime: '', at: Date.now(), status: t('recStNew') }),
    title: d => recTitle(d),
    fields: [
      { k: 'name', type: 'text', label: () => t('fName') },
      { k: 'client', type: 'text', label: () => t('fNameSurname'), list: 'clients' },
      { k: 'caseNumber', type: 'text', label: () => t('fCaseNumber'), list: 'caseNumbers' },
      { k: 'status', type: 'select', label: () => t('fRecStatus'), options: () => recStatuses() },
      { k: 'transcript', type: 'textarea', label: () => t('fTranscript'), main: true, rows: 8 },
    ],
    search: d => [recTitle(d), recName(d), d.client, d.caseNumber, d.status, d.transcript].join(' \n '),
    meta: d => fmtDur(d.duration),
  },
};
KINDS.task.sort = (a, b) => byTermen(a, b);

// Tipurile de tab posibile și ce element creează fiecare.
export const TAB_KINDS = {
  task: { item: 'task', label: () => t('tkTasks') },
  note: { item: 'note', label: () => t('tkNotes') },
  case: { item: 'case', label: () => t('tkCases') },
  client: { item: 'client', label: () => t('tkClients') },
  deadline: { item: 'deadline', label: () => t('tkDeadlines') },
  document: { item: 'document', label: () => t('tkDocuments') },
  law: { item: 'law', label: () => t('tkLaws') },
  news: { item: 'term', label: () => t('tkNews'), special: true },
  saved: { item: 'note', label: () => t('tkSaved') },
  mo: { item: 'law', label: () => t('tkMO') },
  folders: { item: 'note', label: () => t('tkFolders'), special: true },
  rec: { item: 'rec', label: () => t('tkRec'), special: true },
};
export const userTabKinds = ['note', 'task', 'case', 'client', 'deadline', 'document', 'law', 'mo', 'folders'];
