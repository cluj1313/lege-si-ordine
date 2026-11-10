// Notificări și alarme native (APK): @capacitor/local-notifications + canal propriu + alarme exacte.
// În browser rămâne Notification API (doar cât pagina e deschisă).
import { t } from '../core/i18n.js';
import { state, dataOf, locksChain, isHiddenByTrash, saveMeta, onChange } from '../core/store.js';
import { KINDS } from '../tabs/kinds.js';
import { isNative, plugin } from '../voice/native-cap.js';
import { app } from '../ui/registry.js';
import { debounce } from '../core/util.js';

export const CHANNEL = 'lso_alarme';
const TEST_ID = 900001;
const LN = () => plugin('LocalNotifications');
const SYS = () => plugin('LsoSystem');
export const nativeNotif = () => isNative() && !!LN();

// ID numeric stabil (Android cere int) din id-ul elementului.
export function nid(id) {
  let h = 0;
  for (const c of String(id)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 2000000000) + 1000;
}

// Starea permisiunii: 'granted' | 'denied' | 'prompt' | 'unsupported'
export async function notifStatus() {
  if (nativeNotif()) {
    try { const r = await LN().checkPermissions(); return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt'; }
    catch { return 'unsupported'; }
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

// Alarme exacte (Android 12+): 'granted' | 'denied' | null (nu se aplică)
export async function exactStatus() {
  if (!nativeNotif()) return null;
  try { const r = await LN().checkExactNotificationSetting(); return r.exact_alarm === 'granted' ? 'granted' : 'denied'; }
  catch { return null; }
}
export async function openExactSettings() {
  if (!nativeNotif()) return;
  try { await LN().changeExactNotificationSetting(); } catch {}
}

export async function openNotifSettings() {
  try { if (SYS()) { await SYS().openNotificationSettings(); return true; } } catch {}
  return false;
}

// La atingerea „Permite notificările”: cere permisiunea (Android 13+); dacă a fost refuzată definitiv, deschide setările aplicației.
export async function requestNotif() {
  if (nativeNotif()) {
    const before = await notifStatus();
    if (before === 'granted') { await ensureChannel(); return 'granted'; }
    if (before === 'denied') { await openNotifSettings(); return 'settings'; }
    let after = 'denied';
    try { const r = await LN().requestPermissions(); after = r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt'; } catch {}
    if (after === 'granted') { await ensureChannel(); syncNative(); }
    return after;
  }
  if (!('Notification' in window)) return 'unsupported';
  const r = await Notification.requestPermission();
  return r === 'default' ? 'prompt' : r;
}

let channelOk = false;
export async function ensureChannel() {
  if (!nativeNotif() || channelOk) return;
  try {
    await LN().createChannel({ id: CHANNEL, name: t('notifChannel'), description: t('notifChannelDesc'), importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#C9A24A' });
    channelOk = true;
  } catch (e) { console.warn('canal notificări', e); }
}

export async function sendTest() {
  const st = await notifStatus();
  if (st !== 'granted') return st;
  if (nativeNotif()) {
    await ensureChannel();
    await LN().schedule({ notifications: [{ id: TEST_ID, title: 'LEGE ȘI ORDINE', body: t('notifTestBody'), channelId: CHANNEL, smallIcon: 'ic_stat_lso', iconColor: '#C9A24A', schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true }, isExactNotification: false, extra: { test: true } }] });
    return 'sent';
  }
  try { new Notification('LEGE ȘI ORDINE', { body: t('notifTestBody'), icon: 'icons/icon-192.png', tag: 'lso-test' }); return 'sent'; } catch { return 'unsupported'; }
}

// Titlul din notificare: elementele blocate nu își arată conținutul pe ecranul de blocare.
function alarmBody(it) {
  if (locksChain(it).length) return t('lockedItem');
  const d = dataOf(it);
  return d ? (KINDS[it.kind] || KINDS.note).title(d) : t('lockedItem');
}
const dueOf = it => it.snoozeAt || it.alarmAt;

// Programează nativ toate alarmele viitoare (sună și cu aplicația închisă). Idempotent.
let syncing = false, again = false;
export async function syncNative() {
  if (!nativeNotif()) return;
  if (syncing) { again = true; return; }
  syncing = true;
  try {
    if ((await notifStatus()) !== 'granted') return;
    await ensureChannel();
    // Fără permisiunea de alarme exacte nu deschidem ecranul de setări din fundal: programăm inexact (cădere grațioasă).
    const exact = (await exactStatus()) !== 'denied';
    const now = Date.now();
    const want = [];
    for (const it of state.items.values()) {
      if (!it.alarmAt || it.trashedAt || isHiddenByTrash(it)) continue;
      const due = dueOf(it);
      if (!due || due <= now + 1000 || (it.firedAt || 0) >= due) continue;
      want.push({ id: nid(it.id), title: '⏰ ' + t('alarmTitle'), body: alarmBody(it), channelId: CHANNEL, smallIcon: 'ic_stat_lso', iconColor: '#C9A24A',
        schedule: { at: new Date(due), allowWhileIdle: true }, isExactNotification: exact, extra: { id: it.id, due }, autoCancel: true });
    }
    const wantIds = new Set(want.map(n => n.id));
    let pending = [];
    try { pending = (await LN().getPending()).notifications || []; } catch {}
    const stale = pending.filter(n => n.id !== TEST_ID && !wantIds.has(n.id));
    if (stale.length) await LN().cancel({ notifications: stale.map(n => ({ id: n.id })) });
    const key = n => `${n.id}:${+n.schedule.at}:${n.body}`;
    const have = new Set(pending.map(n => `${n.id}:${n.schedule && n.schedule.at ? +new Date(n.schedule.at) : 0}:${n.body}`));
    const todo = want.filter(n => !have.has(key(n)));
    if (todo.length) await LN().schedule({ notifications: todo });
  } catch (e) { console.warn('programare alarme', e); }
  finally { syncing = false; if (again) { again = false; syncNative(); } }
}

// Alarmele deja afișate de sistem cât aplicația era închisă nu mai sună încă o dată în aplicație.
async function markDelivered() {
  try {
    const list = (await LN().getDeliveredNotifications()).notifications || [];
    for (const n of list) {
      const id = n.extra && n.extra.id; const due = n.extra && n.extra.due;
      const it = id && state.items.get(id);
      if (it && due && (it.firedAt || 0) < due && due <= Date.now()) { it.firedAt = due; delete it.snoozeAt; await saveMeta(it); }
    }
  } catch {}
}
export async function clearDelivered(itemId) {
  if (!nativeNotif()) return;
  try { await LN().removeDeliveredNotifications({ notifications: [{ id: nid(itemId) }] }); } catch {}
}

export async function startNativeNotif() {
  if (!nativeNotif()) return;
  try {
    await LN().addListener('localNotificationActionPerformed', e => {
      const id = e && e.notification && e.notification.extra && e.notification.extra.id;
      if (id) setTimeout(() => app.reveal(id), 300);
    });
  } catch {}
  await markDelivered();
  syncNative();
  const later = debounce(syncNative, 800);
  onChange(() => later());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { markDelivered(); later(); } });
}
