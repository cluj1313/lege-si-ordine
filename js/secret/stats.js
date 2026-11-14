// 📊 Statistici și coduri – port din Notis js/stats.js (partea de admin), deschis doar din Zona secretă.
// LSO: fără „Cod secret” separat. Prima dată se setează parola de admin (claim, o singură dată); ea se păstrează
// pe telefon criptată AES-GCM cu cheia zonei (parola + caracterul secret, același KDF ca tokenul) în lso_adpw.
// Când sesiunea admin (sessionStorage lso_adtok, 12 h pe server) lipsește sau a expirat, aplicația se loghează singură.
import { toast } from '../ui/modal.js';
import { shareFile } from '../features/share.js';
import { writePublicFile } from '../features/backup.js';
import { isNative } from './server.js';
import { post, get, statOn, setStat } from './server.js';
import { sealWithZone, openWithZone, zoneSession } from './zone.js';

const KA = 'lso_adpw';
let tok = null, codes = [];
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NET = 'Fără conexiune la internet';

function box(h) {
  let host = $('crx');
  if (!host) { host = document.createElement('div'); host.id = 'crx'; document.body.appendChild(host); }
  let o = $('adx');
  if (!o) { o = document.createElement('div'); o.id = 'adx'; o.dataset.test = 'stats'; host.appendChild(o); }
  o.innerHTML = '<div class="crc"><h3><span>📊 Statistici și coduri</span><button type="button" id="adX" aria-label="×">×</button></h3>' +
    h + '<div class="cre" id="adE"></div></div>';
  const back = () => { if (o && o.parentNode) o.remove(); };
  $('adX').onclick = back;
  o.onclick = e => { if (e.target === o) back(); };
}
function er(t) { const e = $('adE'); if (e) e.textContent = t || ''; }
function pw(id, ph) {
  return '<div class="crf"><input id="' + id + '" type="password" placeholder="' + ph + '" autocomplete="off" autocapitalize="off" spellcheck="false"></div>';
}
const saveTok = t => { tok = t; try { if (t) sessionStorage.setItem('lso_adtok', t); else sessionStorage.removeItem('lso_adtok'); } catch (_) {} };

export function openStats() {
  if (!zoneSession()) return; // doar din zona deblocată
  box('<div class="hint">…</div>');
  try { if (!tok) tok = sessionStorage.getItem('lso_adtok') || null; } catch (_) {}
  get('/admin/state').then(s => {
    if (tok) return dash();
    if (!(s && s.claimed)) return claim();
    return autoLogin();
  }).catch(() => er(NET));
}

function claim() {
  box('<div class="hint">Prima dată: alege parola de admin (minim 10 caractere). Se salvează doar un hash pe server. O poate seta o singură dată. Pe acest telefon se păstrează criptată cu parola și caracterul Zonei secrete, ca să nu o mai tastezi.</div>' +
    pw('adP1', 'Parolă admin') + pw('adP2', 'Repetă parola') +
    '<div class="crb"><button type="button" id="adGo">Setează</button></div>');
  $('adGo').onclick = () => {
    const a = $('adP1').value, b = $('adP2').value;
    if (a.length < 10) return er('Minim 10 caractere');
    if (a !== b) return er('Parolele nu coincid');
    er('…');
    post('/admin/claim', { pass: a }).then(r => {
      if (!r.ok) return er(r.e === 'claimed' ? 'Parola e deja setată' : 'Eroare');
      return doLogin(a, true);
    }).catch(() => er(NET));
  };
}

// → true dacă a intrat
function doLogin(a, remember) {
  return post('/admin/login', { pass: a }).then(async r => {
    if (r.ok) {
      saveTok(r.t);
      if (remember) { try { await sealWithZone(KA, a); } catch (_) {} }
      dash(); return true;
    }
    er(r.e === 'rate' ? 'Prea multe încercări. Încearcă peste o oră.' : 'Parolă greșită');
    return false;
  });
}

async function autoLogin() {
  let a = null;
  try { a = await openWithZone(KA); } catch (_) { a = null; }
  if (!a) {
    // fără parolă salvată – nu mai cere reintroducere, trece direct la dash dacă e posibil
    return dash();
  }
  er('…');
  try {
    const r = await post('/admin/login', { pass: a });
    if (r.ok) { saveTok(r.t); return dash(); }
    if (r.e === 'rate') { login(''); return er('Prea multe încercări. Încearcă peste o oră.'); }
    // parolă invalidă – nu mai forțează reintroducere
    return dash();
  } catch (_) { return dash(); }
}

// Doar când pe acest telefon nu există parola salvată (ex. telefon nou) – o singură dată, apoi se reține criptat.
function login(note) {
  box((note ? '<div class="hint">' + esc(note) + '</div>' : '<div class="hint">Introdu parola de admin o singură dată; se păstrează criptată pe acest telefon.</div>') +
    pw('adP1', 'Parolă admin') +
    '<div class="crb"><button type="button" id="adGo">Intră</button></div>');
  $('adGo').onclick = () => { er('…'); doLogin($('adP1').value, true).catch(() => er(NET)); };
}

function rows(a) { return (a || []).map(x => '<span>' + esc(x.k || '—') + '</span><b>' + x.n + '</b>').join(''); }
const iso = t => new Date(t).toISOString().slice(0, 10);
function list() {
  return codes.slice(0, 300).map(x => {
    const ty = x.days ? x.days + 'z' : 'viață';
    const st = x.used ? ('folosit ' + iso(x.used) + (x.days ? ' → exp ' + iso(x.used + x.days * 864e5) : '')) : 'nefolosit';
    return x.code + '  ' + ty + '  ' + st;
  }).join('\n');
}

function dash() {
  box('<div class="hint">…</div>');
  Promise.all([get('/admin/stats', tok), get('/admin/codes', tok)]).then(v => {
    const s = v[0], c = v[1];
    if (!s.ok || !c.ok) { saveTok(null); return autoLogin(); }
    codes = c.codes || [];
    const used = codes.filter(x => x.used).length;
    box(
      '<div class="ads">Instalări (total)</div><div class="adt" data-test="ad-total">' + s.total + '</div>' +
      '<div class="hint">Dezinstalările nu pot fi măsurate de aplicație — le vezi în Google Play Console. Numărul de mai sus include doar cei cu contorul pornit.</div>' +
      '<div class="ads">Activi pe zi</div><div class="adg">' + rows(s.active) + '</div>' +
      '<div class="ads">Pe țări</div><div class="adg">' + rows(s.country) + '</div>' +
      '<div class="ads">Pe versiuni</div><div class="adg">' + rows(s.ver) + '</div>' +
      '<div class="ads">Sursă</div><div class="adg">' + rows(s.src) + '</div>' +
      '<div class="ads">Contor pe acest telefon</div>' +
      '<label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:300">' +
        '<input type="checkbox" id="adStat"' + (statOn() ? ' checked' : '') + '> Trimite numărătoarea anonimă de pe acest dispozitiv</label>' +
      '<div class="ads">Generează coduri</div>' +
      '<div class="crb" style="justify-content:flex-start">' +
        '<input id="adN" class="adn" type="number" min="1" max="500" value="10" style="width:80px">' +
        '<select id="adD"><option value="0">Pe viață</option><option value="30">30 zile</option><option value="90">90 zile</option><option value="365">365 zile</option></select>' +
        '<button type="button" id="adGen">Generează</button>' +
      '</div>' +
      '<div class="ads" data-test="ad-sum">Coduri: ' + codes.length + ' · folosite ' + used + ' · nefolosite ' + (codes.length - used) + '</div>' +
      '<div class="adl" id="adL">' + esc(list()) + '</div>' +
      '<div class="crb">' +
        '<button type="button" class="alt" id="adOut">Ieși</button>' +
        '<button type="button" class="alt" id="adCp">Copiază nefolosite</button>' +
        '<button type="button" id="adCsv">Export CSV</button>' +
      '</div>');
    $('adStat').onchange = function () {
      const on = this.checked;
      setStat(on);
      const sw = document.querySelector('[data-test=stat-toggle]'); if (sw) sw.checked = on;
      toast(on ? 'Contor pornit' : 'Contor oprit');
    };
    $('adGen').onclick = () => {
      const n = Math.max(0, Math.min(500, parseInt($('adN').value, 10) || 0));
      if (!n) return er('1–500');
      $('adGen').disabled = true; er('…');
      post('/admin/gen', { n, days: +$('adD').value }, tok).then(r => {
        if (!r.ok) { $('adGen').disabled = false; return er('Eroare'); }
        toast(r.codes.length + ' coduri');
        dash();
      }).catch(() => { $('adGen').disabled = false; er(NET); });
    };
    $('adCp').onclick = () => {
      const t = codes.filter(x => !x.used).map(x => x.code).join('\n');
      try { navigator.clipboard.writeText(t).then(() => toast('Copiat')); } catch (_) {}
    };
    $('adCsv').onclick = () => {
      const t = 'code,type,status,used,expires\n' + codes.map(x => {
        const e = x.used && x.days ? iso(x.used + x.days * 864e5) : '';
        return [x.code, x.days ? x.days + 'd' : 'lifetime', x.used ? 'used' : 'unused', x.used ? iso(x.used) : '', e].join(',');
      }).join('\n') + '\n';
      const n = 'lege-coduri-' + new Date().toISOString().slice(0, 10) + '.csv';
      if (isNative()) {
        writePublicFile(n, t).then(async w => {
          const SH = window.Capacitor?.Plugins?.Share;
          if (w && w.uri && SH) { try { await SH.share({ title: n, url: w.uri }); return; } catch (_) {} }
          toast(w ? 'Salvat în Descărcări/LEGE-SI-ORDINE' : 'Eroare');
        });
      } else shareFile(new Blob([t], { type: 'text/csv' }), n, n).catch(() => {});
    };
    $('adOut').onclick = () => { const o = $('adx'); if (o) o.remove(); };
  }).catch(() => er(NET));
}
