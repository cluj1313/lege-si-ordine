// Pornire: încarcă datele locale, creează taburile la prima rulare, aplică tema, pornește UI-ul și serviciile.
import { load, state, saveUI, APP_VERSION } from './core/store.js';
import { seedIfNeeded } from './core/seed.js';
import { applyTheme } from './features/settings.js';
import { startApp } from './app.js';
import { checkExpired } from './features/trash.js';
import { maybeDailyBackup } from './features/backup.js';
import { startAlarms } from './features/alarms.js';

async function boot() {
  await load();
  if (await seedIfNeeded()) { await saveUI(); await load(); }
  applyTheme();
  await startApp();
  document.body.classList.add('ready');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  setTimeout(async () => { await checkExpired(); await maybeDailyBackup(); }, 600);
  startAlarms();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  window.LSO = { version: APP_VERSION, state };
}
boot().catch(e => {
  console.error(e);
  const el = document.getElementById('view');
  if (el) el.textContent = 'Eroare la pornire: ' + (e && e.message ? e.message : e);
});
