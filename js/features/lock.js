import { state, saveSettings } from '../core/store.js';
import { toast } from '../ui/modal.js';

export function startLock() {
  console.log('Lock system started (stub)');
}

export async function setPin(pin) {
  state.settings.appPin = pin;
  await saveSettings();
  return true;
}

export async function openPatternSetup() {
  toast('Pattern setup (în dezvoltare)');
}

export async function clearLock() {
  delete state.settings.appPin;
  await saveSettings();
  toast('Lock șters');
}
