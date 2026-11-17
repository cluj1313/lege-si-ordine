// Pornire: încarcă datele locale, creează taburile la prima rulare, aplică tema, pornește UI-ul și serviciile.
import { load, state, saveUI, APP_VERSION } from './core/store.js';
import { seedIfNeeded, migrate } from './core/seed.js';
import { applyTheme, maybeRemindUrgents, listenInstallPrompt } from './features/settings.js';
import { startApp, render } from './app.js';
import { checkExpired } from './features/trash.js';
import { maybeDailyBackup, startWeeklyBackup, startBackgroundBackup, autoBackup, offerRestoreIfEmpty } from './features/backup.js';
import { startAlarms } from './features/alarms.js';
import { topModal } from './ui/modal.js';
import { ui } from './ui/list.js';
import { app } from './ui/registry.js';
import { startSecretGesture, secretBack } from './secret/zone.js';
import { startPing } from './secret/server.js';
import { startLock } from './features/lock.js';
import { startScreensaver } from './features/screensaver.js';
import { startTemporary } from './features/temporary.js';
import { startNews } from './secret/news.js';

const isNative = () => {
  try { return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); }
  catch { return false; }
};

// Butonul Înapoi de pe Android: închide fereastra de sus sau iese din selecție; altfel activitatea trece în fundal.
export function handleBack() {
  const top = topModal();
  if (top) { if (top.onBack) top.onBack(); else top.close(); return true; }
  if (secretBack()) return true;
  if (ui.selecting || ui.dragMode || app.tabDragOn()) { ui.selecting = false; ui.selected.clear(); app.endDragMode(); return true; }
  return false;
}

function isDataEmpty() {
  return state.tabs.length === 0 && state.items.size === 0;
}

async function boot() {
  try {
    await load();
    const empty = isDataEmpty();
    if (empty) {
      applyTheme();
      listenInstallPrompt();
      await startApp();
      document.body.classList.add('ready');
      if (await offerRestoreIfEmpty()) return;
    }
    if (await seedIfNeeded()) { await saveUI(); await load(); if (empty && typeof render === 'function') render(); }
    // Copie completă pe disc + IndexedDB înainte de orice migrare, și la pornire.
    await autoBackup('start', false);
    await migrate();
    if (!empty) {
      applyTheme();
      listenInstallPrompt();
      await startApp();
      document.body.classList.add('ready');
    } else if (typeof render === 'function') render();
  } catch (err) {
    console.error('BOOT ERROR', err);
    const view = document.getElementById('view');
    if (view) view.innerHTML = '<div style="padding:20px;color:#c00;font-size:14px">Eroare la pornire:<br><pre>' + (err && err.stack ? err.stack : err) + '</pre></div>';
    return;
  }
  startTemporary(); // încarcă Temporar înainte de primul render
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  setTimeout(async () => {
    await checkExpired();
    await maybeDailyBackup();
    maybeRemindUrgents();
    if (typeof render === 'function') render();
  }, 200);
  startWeeklyBackup();
  startBackgroundBackup();
  startAlarms();
  startScreensaver();
  startLock();
  startSecretGesture();
  startPing();
  startNews();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isNative()) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  window.LSO = { version: APP_VERSION, state, handleBack, render };
}
boot().catch(e => {
  console.error(e);
  const el = document.getElementById('view');
  if (el) el.textContent = 'Eroare la pornire: ' + (e && e.message ? e.message : e);
});
