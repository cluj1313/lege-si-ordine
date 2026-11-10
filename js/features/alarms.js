// Alarme în aplicație: verificare periodică cât aplicația e deschisă (fereastră cu Amână/Oprește).
// În APK, alarmele sunt programate și nativ (notify.js), deci sună și cu aplicația închisă.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, dataOf, canView, saveMeta, isHiddenByTrash } from '../core/store.js';
import { KINDS } from '../tabs/kinds.js';
import { openModal } from '../ui/modal.js';
import { app } from '../ui/registry.js';
import { nativeNotif, startNativeNotif, clearDelivered } from './notify.js';
export { requestNotif } from './notify.js';

let ctx = null, beepTimer = null, ringing = new Set();
function beep() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.type = 'sine'; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35);
  } catch {}
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}

export function startAlarms() {
  setInterval(check, 15000);
  setTimeout(check, 3000);
  startNativeNotif().catch(e => console.warn('notificări native', e));
}

function check() {
  const now = Date.now();
  for (const it of state.items.values()) {
    if (!it.alarmAt || it.trashedAt || isHiddenByTrash(it)) continue;
    const due = it.snoozeAt || it.alarmAt;
    if (due > now || it.firedAt >= due || ringing.has(it.id)) continue;
    if (now - due > 12 * 3600000) { it.firedAt = due; saveMeta(it); continue; } // prea vechi: nu mai sună
    ring(it, due);
  }
}

function ring(it, due) {
  ringing.add(it.id);
  const title = canView(it) ? (KINDS[it.kind] || KINDS.note).title(dataOf(it)) : t('lockedItem');
  beep(); clearInterval(beepTimer); beepTimer = setInterval(beep, 2500);
  if (!nativeNotif() && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(t('alarmTitle'), { body: title, icon: 'icons/icon-192.png', tag: it.id }); } catch {}
  }
  const finish = async (snoozeMin) => {
    clearInterval(beepTimer); ringing.delete(it.id); clearDelivered(it.id);
    if (snoozeMin) it.snoozeAt = Date.now() + snoozeMin * 60000; else { it.firedAt = due; delete it.snoozeAt; }
    if (!snoozeMin) it.firedAt = Math.max(it.firedAt || 0, due);
    await saveMeta(it);
  };
  openModal({
    title: '⏰ ' + t('alarmTitle'), dismissable: false, cls: 'alarm-modal',
    body: h('div', {}, h('p', { class: 'alarm-t' }, title), h('p', { class: 'r2-meta' }, new Date(due).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }))),
    actions: [
      { label: t('snooze', { n: 10 }), cls: 'ghost', onClick: async m => { await finish(10); m.close(); } },
      { label: t('snooze', { n: 20 }), cls: 'ghost', onClick: async m => { await finish(20); m.close(); } },
      { label: t('snooze', { n: 30 }), cls: 'ghost', onClick: async m => { await finish(30); m.close(); } },
      { label: t('stop'), cls: 'primary', onClick: async m => { await finish(0); m.close(); app.reveal(it.id); } },
    ],
  });
}
