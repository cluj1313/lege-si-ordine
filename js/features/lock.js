import { state, saveSettings } from '../core/store.js';
import { toast, confirmDlg, promptDlg } from '../ui/modal.js';

export function startLock() { console.log('Lock ready'); }

export async function setPin(pin) {
  if (!pin || pin.length < 4) return false;
  state.settings.appPin = pin;
  await saveSettings();
  toast('PIN setat');
  return true;
}

export async function openPatternSetup() {
  toast('Desenează pattern-ul (în dezvoltare)');
}

export async function clearLock() {
  if (!(await confirmDlg('Ștergi Lock-ul? Va trebui să setezi din nou PIN-ul.', { danger: true }))) return;
  delete state.settings.appPin;
  delete state.settings.appPattern;
  await saveSettings();
  toast('Lock eliminat');
}

export async function unlockWithBiometric() {
  toast('Deblocare cu amprentă (în dezvoltare)');
  return false;
}

export async function lockItem(item) {
  const method = await promptDlg('Cum vrei să blochezi?', {
    options: [
      { label: 'PIN 📌', value: 'pin' },
      { label: 'Pattern (4 din 9) ', value: 'pattern' },
      { label: 'Amprentă 🫆', value: 'bio' }
    ]
  });
  if (!method) return;
  if (method === 'pin') {
    const pin = await promptDlg('Introdu PIN (4-6 cifre)', { type: 'password' });
    if (pin && pin.length >= 4) {
      item.lock = 'pin';
      item.lockData = pin;
      await saveSettings();
      toast('Blocat cu PIN');
    }
  } else if (method === 'pattern') {
    toast('Pattern (în dezvoltare)');
  } else if (method === 'bio') {
    item.lock = 'bio';
    await saveSettings();
    toast('Blocat cu amprentă');
  }
}
