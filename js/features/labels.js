// Etichete colorate
import { h } from '../core/util.js';
import { state, saveMeta } from '../core/store.js';
import { toast } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';

const PAL = ['#e5484d','#f76b15','#f5b400','#30a46c','#12a594','#0090ff','#6e56cf','#d6409f','#8d8d8d','#a0522d'];

export function getLabels() {
  try { return JSON.parse(localStorage.getItem('lso_labels') || '[]'); } catch { return []; }
}
function saveLabels(a) { localStorage.setItem('lso_labels', JSON.stringify(a)); }

export function openLabels(it) {
  const all = getLabels();
  const selected = new Set(it.labels || []);
  const body = h('div', {},
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' } },
      ...all.map(l => h('button', {
        type: 'button', class: 'btn ' + (selected.has(l.id) ? 'primary' : 'ghost'),
        style: { background: l.color, color: '#fff', borderColor: l.color },
        onclick: e => { if (selected.has(l.id)) selected.delete(l.id); else selected.add(l.id); e.target.classList.toggle('primary'); }
      }, l.name))
    ),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
      h('input', { id: 'newLab', placeholder: 'Nume etichetă nouă', style: { flex: 1 } }),
      h('input', { type: 'color', id: 'newCol', value: PAL[0], style: { width: '40px', height: '36px', padding: 0 } }),
      h('button', { class: 'btn', onclick: () => {
        const name = document.getElementById('newLab').value.trim();
        const color = document.getElementById('newCol').value;
        if (!name) return;
        const id = 'lb' + Date.now();
        all.push({ id, name, color });
        saveLabels(all);
        selected.add(id);
        openLabels(it); // re-open
      } }, 'Adaugă')
    )
  );
  openModal({
    title: 'Etichete',
    body,
    actions: [
      { label: 'Salvează', cls: 'primary', onClick: async m => {
        it.labels = [...selected];
        await saveMeta(it);
        toast('Etichete salvate');
        m.close();
      } },
      { label: 'Închide', cls: 'ghost', onClick: m => m.close() }
    ]
  });
}

export function renderLabelChips(it) {
  if (!it.labels?.length) return null;
  const all = getLabels();
  const chips = it.labels.map(id => all.find(l => l.id === id)).filter(Boolean);
  if (!chips.length) return null;
  return h('div', { class: 'label-chips' }, ...chips.map(l =>
    h('span', { class: 'label-chip', style: { background: l.color } }, l.name)
  ));
}
