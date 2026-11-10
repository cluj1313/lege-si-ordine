// Bucățile din Setări: Confidențialitate (contor anonim), Comunică cu creatorul aplicației, „Ai un cod?”.
import { h } from '../core/util.js';
import { toast } from '../ui/modal.js';
import { statOn, setStat, redeem, supTxt } from './server.js';
import { newsOn, setNews, newsBox, deleteNews, onNews } from './news.js';

export function privacyBody() {
  const cb = h('input', { type: 'checkbox', 'data-test': 'stat-toggle', checked: statOn(),
    onchange: e => { setStat(e.target.checked); toast(e.target.checked ? 'Contor pornit' : 'Contor oprit'); } });
  return h('div', { 'data-test': 'privacy-sec' },
    h('label', { class: 'fld-check' }, cb, h('span', {}, 'Contor anonim de instalări')),
    h('p', { class: 'r2-meta' }, 'Trimite doar o numărătoare anonimă (țara, versiunea aplicației). Fără nume, notițe sau IP.'));
}

const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ''); };
export function creatorBody() {
  const list = h('div', { class: 'news-list', 'data-test': 'news-list' });
  const draw = () => {
    list.innerHTML = '';
    const a = newsBox().slice().reverse();
    if (!a.length) { list.append(h('p', { class: 'r2-meta' }, 'Niciun mesaj')); return; }
    a.forEach(m => list.append(h('div', { class: 'news-item', 'data-id': m.id },
      h('div', { class: 'ni-d' }, dmy(m.date)),
      h('div', { class: 'ni-t' }, m.title || ''),
      h('div', { class: 'ni-b' }, m.body || ''),
      h('button', { class: 'btn sm danger-ghost', type: 'button', onclick: () => deleteNews(m.id) }, 'Șterge'))));
  };
  draw();
  const off = onNews(() => { if (!list.isConnected) { off(); return; } draw(); });
  const cb = h('input', { type: 'checkbox', 'data-test': 'news-toggle', checked: newsOn(), onchange: e => setNews(e.target.checked) });
  return h('div', {},
    h('label', { class: 'fld-check' }, cb, h('span', {}, 'Doresc să primesc mesaje de la creator')),
    h('p', { class: 'r2-meta' }, 'Anunțuri scurte de la creatorul aplicației: noutăți, sfaturi și actualizări. Ștergerea de aici e doar pe acest telefon.'),
    list);
}

export function codeBlock() {
  const st = h('p', { class: 'r2-meta', 'data-test': 'super-status' }, supTxt());
  const inp = h('input', { type: 'text', placeholder: 'Introdu codul', 'data-test': 'code-input', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
  const go = h('button', { class: 'btn sm', type: 'button', 'data-test': 'code-go', onclick: async () => {
    go.disabled = true;
    const r = await redeem(inp.value);
    go.disabled = false;
    toast(r.msg);
    if (r.ok) { st.textContent = supTxt(); inp.value = ''; form.hidden = true; }
  } }, 'Activează');
  const form = h('div', { class: 'row-inp', hidden: true }, inp, go);
  const btn = h('button', { class: 'btn ghost', type: 'button', 'data-test': 'have-code', onclick: () => { form.hidden = !form.hidden; if (!form.hidden) inp.focus(); } }, 'Ai un cod?');
  return h('div', { class: 'code-block' }, st, btn, form);
}
