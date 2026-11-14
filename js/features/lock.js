import { state, saveSettings } from '../core/store.js';
import { toast } from '../ui/modal.js';

export function startLock() {
  // Placeholder for now – full PIN/pattern can be expanded later
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
  toast('Pattern (în dezvoltare)');
}

export async function clearLock() {
  delete state.settings.appPin;
  await saveSettings();
  toast('Lock eliminat');
}
