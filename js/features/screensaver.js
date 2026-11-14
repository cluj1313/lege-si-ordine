// Minimal screensaver
import { state } from '../core/store.js';

let timer;

export function startScreensaver() {
  const reset = () => {
    clearTimeout(timer);
    const min = state.settings.ssTimeout || 0;
    if (min <= 0) return;
    timer = setTimeout(showSS, min * 60 * 1000);
  };
  ['pointerdown', 'keydown', 'scroll'].forEach(ev => document.addEventListener(ev, reset, { passive: true }));
  reset();
}

function showSS() {
  // Simple overlay stub
  let ov = document.getElementById('ss-overlay');
  if (ov) return;
  ov = document.createElement('div');
  ov.id = 'ss-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:#0b1a33;color:#d4af37;display:flex;align-items:center;justify-content:center;font-family:Cinzel,serif;font-size:2rem;z-index:9999;';
  ov.textContent = 'LEGE ȘI ORDINE';
  ov.onclick = () => { ov.remove(); startScreensaver(); };
  document.body.append(ov);
}
