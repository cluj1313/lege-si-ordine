import { state } from '../core/store.js';

let timer;
let overlay;

export function startScreensaver() {
  const reset = () => {
    clearTimeout(timer);
    if (overlay) { overlay.remove(); overlay = null; }
    const min = Number(state.settings.ssTimeout) || 0;
    if (min <= 0) return;
    timer = setTimeout(showSS, min * 60 * 1000);
  };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => 
    document.addEventListener(ev, reset, { passive: true })
  );
  reset();
}

function showSS() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'ss-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: #0b1a33; color: #d4af37;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: Cinzel, serif; z-index: 99999; text-align: center; padding: 20px;
  `;
  overlay.innerHTML = `
    <div style="font-size: 3rem; margin-bottom: 20px;">⚖️</div>
    <div style="font-size: 2.2rem; letter-spacing: 2px;">LEGE ȘI ORDINE</div>
    <div style="margin-top: 30px; font-size: 1rem; opacity: 0.8; max-width: 280px;">
      ${state.settings.ssTips !== false ? 'Apasă oriunde pentru a continua' : ''}
    </div>
  `;
  overlay.onclick = () => { overlay.remove(); overlay = null; startScreensaver(); };
  document.body.append(overlay);
}
