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
  const pts = [];
  const box = h('div', { class: 'm-overlay', onclick: e => { if (e.target === box) box.remove(); } },
    h('div', { class: 'm-box', style: { padding: '16px', maxWidth: '280px', background: '#1a1a1a', color: '#eee', borderRadius: '16px', textAlign: 'center' } },
      h('div', { style: { fontWeight: 600, marginBottom: '12px' } }, 'Desenează pattern (4 din 9)'),
      h('div', { id: 'pat-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(3, 48px)', gap: '16px', justifyContent: 'center', margin: '12px 0' } },
        ...[0,1,2,3,4,5,6,7,8].map(i => h('div', { 
          'data-i': i,
          style: { width: '48px', height: '48px', borderRadius: '50%', border: '2px solid #555', background: '#222', cursor: 'pointer' },
          onclick: (e) => {
            const el = e.currentTarget;
            const idx = +el.dataset.i;
            if (pts.includes(idx)) return;
            pts.push(idx);
            el.style.background = '#d4af37';
            el.style.borderColor = '#d4af37';
            if (pts.length >= 4) {
              state.settings.appPattern = pts.join(',');
              saveSettings();
              toast('Pattern salvat');
              box.remove();
            }
          }
        }))),
      h('button', { class: 'btn sm ghost', type: 'button', style: { color: '#aaa', marginTop: '8px' }, onclick: () => box.remove() }, 'Anulează')));
  document.body.append(box);
}

export async function clearLock() {
  if (!(await confirmDlg('Ștergi Lock-ul? Va trebui să setezi din nou PIN-ul.', { danger: true }))) return;
  delete state.settings.appPin;
  delete state.settings.appPattern;
  await saveSettings();
  toast('Lock eliminat');
}

export async function unlockWithBiometric() {
  try {
    const { Bio } = await import('@capacitor/core').then(m => m.Plugins || {});
    if (Bio && Bio.auth) {
      await Bio.auth({ title: 'Deblochează', cancel: 'Anulează' });
      toast('Deblocat cu amprentă');
      return true;
    }
  } catch (e) { /* fall through */ }
  toast('Amprentă nu este disponibilă sau a fost anulată.');
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
