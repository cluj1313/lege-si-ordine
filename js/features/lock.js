import { state, saveSettings } from '../core/store.js';
import { toast, confirmDlg } from '../ui/modal.js';

export function startLock() {
  console.log('Lock system ready');
}

export async function setPin(pin) {
  if (!pin || pin.length < 4) return false;
  state.settings.appPin = pin;
  await saveSettings();
  toast('PIN setat');
  return true;
}

export async function openPatternSetup() {
  toast('Desenează pattern-ul (în dezvoltare)');
  // Placeholder for 9-dot pattern
}

export async function clearLock() {
  if (!(await confirmDlg('Ștergi Lock-ul? Va trebui să setezi din nou PIN-ul.', { danger: true }))) return;
  delete state.settings.appPin;
  delete state.settings.appPattern;
  await saveSettings();
  toast('Lock eliminat');
}

export async function unlockWithBiometric() {
  // Placeholder for fingerprint – Capacitor BiometricAuth can be added later
  toast('Deblocare cu amprentă (în dezvoltare)');
  return false;
}
