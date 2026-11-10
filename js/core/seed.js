// Prima pornire: taburile inițiale, linkuri oficiale verificate și câteva date de exemplu (marcate, eliminabile din Setări).
import { db } from './db.js';
import { state, addTab, newItem } from './store.js';
import { isoFromDate } from './util.js';
import { t } from './i18n.js';
import { DEFAULT_CATS, mkCats, lawCatFor } from '../tabs/cats.js';
import { saveTab, saveMeta, dataOf } from './store.js';

// Migrare pentru date create de versiuni anterioare (nu șterge nimic).
export async function migrate() {
  for (const tab of state.tabs) {
    if (tab.kind === 'law' && /monitorul oficial/i.test(tab.name)) { tab.kind = 'mo'; await saveTab(tab); }
    if ((tab.kind === 'law' || tab.kind === 'document') && !tab.cats) {
      tab.cats = mkCats(DEFAULT_CATS[tab.kind]());
      await saveTab(tab);
      if (tab.kind === 'law') for (const it of state.items.values()) if (it.tab === tab.id && it.official && !it.cat) { it.cat = lawCatFor(tab.cats, dataOf(it)?.title || ''); await saveMeta(it); }
    }
  }
}

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoFromDate(d); };

// Linkuri verificate (răspuns 200 și titlu corect pe sursa oficială) la 10/11/2026.
export const OFFICIAL_LAWS = [
  { title: 'Constituția României', source: 'Portal Legislativ (legislatie.just.ro)', url: 'https://legislatie.just.ro/Public/DetaliiDocument/47355', actDate: '1991-11-21', notes: 'Republicată în Monitorul Oficial nr. 767 din 31/10/2003.' },
  { title: 'Constituția României – textul pe site-ul Curții Constituționale', source: 'Curtea Constituțională (ccr.ro)', url: 'https://www.ccr.ro/constitutia-romaniei/', actDate: '1991-11-21', notes: '' },
  { title: 'Codul civil (Legea nr. 287/2009)', source: 'Portal Legislativ (legislatie.just.ro)', url: 'https://legislatie.just.ro/Public/DetaliiDocument/109884', actDate: '2009-07-17', notes: '' },
  { title: 'Codul de procedură civilă (Legea nr. 134/2010)', source: 'Portal Legislativ (legislatie.just.ro)', url: 'https://legislatie.just.ro/Public/DetaliiDocument/140271', actDate: '2010-07-01', notes: '' },
  { title: 'Codul penal (Legea nr. 286/2009)', source: 'Portal Legislativ (legislatie.just.ro)', url: 'https://legislatie.just.ro/Public/DetaliiDocument/109855', actDate: '2009-07-17', notes: '' },
  { title: 'Codul de procedură penală (Legea nr. 135/2010)', source: 'Portal Legislativ (legislatie.just.ro)', url: 'https://legislatie.just.ro/Public/DetaliiDocument/120611', actDate: '2010-07-01', notes: '' },
  { title: 'Legea societăților nr. 31/1990 (republicată)', source: 'Portal Legislativ (legislatie.just.ro)', url: 'https://legislatie.just.ro/Public/DetaliiDocument/800', actDate: '1990-11-16', notes: 'Republicată în Monitorul Oficial nr. 1066 din 17/11/2004.' },
  { title: 'Portal Legislativ – căutare acte normative', source: 'Ministerul Justiției (legislatie.just.ro)', url: 'https://legislatie.just.ro/', actDate: '', notes: 'Căutare după număr, an, tip de act sau cuvinte.' },
];
export const OFFICIAL_MO = [
  { title: 'Monitorul Oficial al României – site oficial', source: 'Monitorul Oficial R.A. (monitoruloficial.ro)', url: 'https://www.monitoruloficial.ro/', actDate: '', notes: '' },
  { title: 'e-Monitor – consultare gratuită Monitorul Oficial', source: 'Monitorul Oficial R.A. (monitoruloficial.ro)', url: 'https://monitoruloficial.ro/e-monitor/', actDate: '', notes: 'Partea I și alte părți, consultare online.' },
];

export async function seedIfNeeded() {
  if (await db.kvGet('seeded', false)) return false;
  const T = {};
  T.task = await addTab(t('tabTasks'), 'task');
  T.urg = await addTab(t('tabUrgent'), 'note', { urgent: true });
  T.case = await addTab(t('tabCases'), 'case');
  T.client = await addTab(t('tabClients'), 'client');
  T.dead = await addTab(t('tabDeadlines'), 'deadline');
  T.doc = await addTab(t('tabDocuments'), 'document', { cats: mkCats(DEFAULT_CATS.document()) });
  T.law = await addTab(t('tabLaws'), 'law', { cats: mkCats(DEFAULT_CATS.law()) });
  T.mo = await addTab(t('tabMO'), 'mo');
  T.news = await addTab(t('tabNews'), 'news');
  T.saved = await addTab(t('tabSaved'), 'saved', { subs: [{ id: 'salvate', name: t('subSaved') }, { id: 'descarcate', name: t('subDownloaded') }] });
  T.fold = await addTab(t('tabFolders'), 'folders');
  T.rec = await addTab(t('tabRec'), 'rec');

  for (const l of OFFICIAL_LAWS) await newItem(T.law.id, 'law', l, { official: true, cat: lawCatFor(T.law.cats, l.title) });
  for (const l of OFFICIAL_MO) await newItem(T.mo.id, 'law', l, { official: true });
  await newItem(T.doc.id, 'document', { title: 'Împuternicire avocațială (exemplu)', caseTitle: 'Popescu vs. Construcții Nord SRL (exemplu)', notes: '', files: [] }, { ...{ sample: true }, cat: T.doc.cats[0].id });
  const f1 = await newItem(T.fold.id, 'folder', { name: 'Folder 1' }, { order: 1 });
  await newItem(T.fold.id, 'folder', { name: 'Folder 2' }, { order: 2 });
  await newItem(T.fold.id, 'folder', { name: 'Folder 3' }, { order: 3 });

  const S = { sample: true };
  await newItem(T.task.id, 'task', { text: 'Pregătire pledoarie (exemplu)\nRecitește probele din dosar\nVerifică termenul de apel', date: day(1), time: '10:00', alarm: false, done: false,
    subs: [{ id: 's1', text: 'Recitește probele', done: true }, { id: 's2', text: 'Notează întrebările pentru martori', done: false }, { id: 's3', text: 'Pregătește concluziile scrise', done: false }], files: [] }, S);
  await newItem(T.task.id, 'task', { text: 'Sună clientul Ionescu (exemplu)', date: day(0), time: '16:30', alarm: false, done: false, subs: [], files: [] }, S);
  await newItem(T.urg.id, 'note', { title: 'Depunere întâmpinare (exemplu)', text: 'Termen de depunere: mâine până la 12:00.\nAtașează dovada comunicării.', files: [] }, S);
  await newItem(T.case.id, 'case', { title: 'Popescu vs. Construcții Nord SRL (exemplu)', number: '1234/299/2026 (exemplu)', client: 'Ion Popescu (exemplu)', court: 'Judecătoria Sectorului 1 (exemplu)', date: day(2), time: '09:30', stage: 'lucru', alarm: false, notes: 'Dosar de exemplu – poate fi șters din Setări › Date de exemplu.', files: [] }, S);
  await newItem(T.case.id, 'case', { title: 'Ionescu – contestație fiscală (exemplu)', number: '', client: 'Maria Ionescu (exemplu)', court: 'Tribunalul București (exemplu)', date: day(8), time: '11:00', stage: 'programat', alarm: false, notes: '', files: [] }, S);
  await newItem(T.client.id, 'client', { name: 'Ion Popescu (exemplu)', clientType: 'person', represents: 'reclamant', caseTitle: 'Popescu vs. Construcții Nord SRL (exemplu)', date: day(2), time: '09:30', stage: 'lucru', phone: '', email: '', address: '', notes: '', files: [] }, S);
  await newItem(T.client.id, 'client', { name: 'Maria Ionescu (exemplu)', clientType: 'person', represents: 'contestatoare', caseTitle: 'Ionescu – contestație fiscală (exemplu)', date: day(8), time: '11:00', stage: 'acte', phone: '', email: '', address: '', notes: '', files: [] }, S);
  await newItem(T.dead.id, 'deadline', { title: 'Termen judecată Popescu (exemplu)', caseTitle: 'Popescu vs. Construcții Nord SRL (exemplu)', court: 'Judecătoria Sectorului 1 (exemplu)', date: day(2), time: '09:30', alarm: false, notes: '' }, S);
  await newItem(T.dead.id, 'deadline', { title: 'Depunere concluzii scrise (exemplu)', caseTitle: 'Ionescu – contestație fiscală (exemplu)', court: '', date: day(5), time: '12:00', alarm: false, notes: '' }, S);
  await newItem(T.doc.id, 'document', { title: 'Cerere de chemare în judecată (exemplu)', caseTitle: 'Popescu vs. Construcții Nord SRL (exemplu)', notes: 'Atașează aici poze sau fișiere cu nume.', files: [] }, { ...S, cat: T.doc.cats[1].id });
  await newItem(T.fold.id, 'note', { title: 'Notă internă – checklist audieri (exemplu)', text: '1. Lista martorilor\n2. Întrebări\n3. Documente de prezentat', files: [] }, { ...S, folder: f1.id });
  await newItem(T.news.id, 'term', { group: 'w', text: 'contract' }, S);
  await newItem(T.news.id, 'term', { group: 'p', text: 'drept de retenție' }, S);
  await newItem(T.news.id, 'term', { group: 'l', text: 'Legea 31/1990' }, S);

  state.ui.tab = T.task.id;
  await db.kvSet('seeded', true);
  return true;
}
