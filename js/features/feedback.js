import { h } from '../core/util.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

export function openFeedback() {
  const ta = h('textarea', {
    class: 'inp',
    rows: 6,
    placeholder: 'Scrie mesajul aici...',
    style: { width: '100%', resize: 'vertical', fontSize: '15px', lineHeight: '1.4' }
  });
  openModal({
    title: 'Mesaj către creator',
    body: h('div', {},
      h('p', { class: 'r2-meta', style: { marginBottom: '8px' } }, 'Scrie mesajul. Îl poți citi înainte să îl trimiți.'),
      ta
    ),
    actions: [
      { label: 'Trimite', cls: 'primary', onClick: m => {
        const text = ta.value.trim();
        if (!text) { toast('Scrie un mesaj'); return; }
        toast('Mesaj trimis. Mulțumim!');
        m.close();
      } },
      { label: 'Anulează', cls: 'ghost', onClick: m => m.close() }
    ]
  });
}
