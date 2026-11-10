// Pornire: încarcă datele locale, creează taburile la prima rulare, aplică tema, pornește UI-ul și serviciile.
import { load, state, saveUI, APP_VERSION } from './core/store.js';
import { seedIfNeeded, migrate } from './core/seed.js';
import { applyTheme, maybeRemindUrgents, listenInstallPrompt } from './features/settings.js';
import { startApp } from './app.js';
import { checkExpired } from './features/trash.js';
import { maybeDailyBackup, startWeeklyBackup } from './features/backup.js';
import { startAlarms } from './features/alarms.js';
import { topModal } from './ui/modal.js';
import { ui } from './ui/list.js';
import { app } from './ui/registry.js';

const isNative = () => {
  try { return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); }
  catch { return false; }
};

// Butonul Înapoi de pe Android: închide fereastra de sus sau iese din selecție; altfel activitatea trece în fundal.
export function handleBack() {
  const top = topModal();
  if (top) { if (top.onBack) top.onBack(); else top.close(); return true; }
  if (ui.selecting || ui.dragMode || app.tabDragOn()) { ui.selecting = false; ui.selected.clear(); app.endDragMode(); return true; }
  return false;
}

async function boot() {
  await load();
  if (await seedIfNeeded()) { await saveUI(); await load(); }
  await migrate();
  applyTheme();
  listenInstallPrompt();
  await startApp();
  document.body.classList.add('ready');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  setTimeout(async () => { await checkExpired(); await maybeDailyBackup(); maybeRemindUrgents(); }, 600);
  startWeeklyBackup();
  startAlarms();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isNative()) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  window.LSO = { version: APP_VERSION, state, handleBack };
}
boot().catch(e => {
  console.error(e);
  const el = document.getElementById('view');
  if (el) el.textContent = 'Eroare la pornire: ' + (e && e.message ? e.message : e);
});
