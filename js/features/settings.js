// Setări: un singur loc – panou lateral din stânga, deschis prin atingerea logo-ului sau a textului
// LEGE ȘI ORDINE (ca în Notis); secțiuni pliabile, backup manual/automat, setările LSO păstrate.
import { h, act } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, liveTabs, saveTab, saveTabsOrder, saveSettings, saveUI, APP_VERSION, purge, itemsOf, dataOf, canView } from '../core/store.js';
import { openModal, confirmDlg, toast, infoDlg } from '../ui/modal.js';
import { tabMenu, newTabFlow, renderTabBar } from '../ui/tabsbar.js';
import { voiceMenu, LANGS, canDictate, canSpeak } from './voice.js';
import { requestNotif, notifStatus, exactStatus, openExactSettings, openNotifSettings, sendTest, nativeNotif } from './notify.js';
import { backupSection } from './backup.js';
import { openTrash } from './trash.js';
import { TAB_KINDS } from '../tabs/kinds.js';
import { app } from '../ui/registry.js';
import { isNative } from '../voice/native-cap.js';
import { privacyBody, creatorBody, codeBlock } from '../secret/settings-parts.js';

export function applyTheme() {
  const s = state.settings || {};
  document.documentElement.dataset.theme = s.theme === 'navy' ? 'navy' : 'light';
  document.documentElement.dataset.tabStyle = s.tabStyle === 'box' ? 'box' : 'pill';
  document.documentElement.dataset.font = s.fontScale === 'sm' || s.fontScale === 'lg' ? s.fontScale : 'md';
  document.documentElement.dataset.outline = s.cardOutline === false ? 'off' : 'on';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = s.theme === 'navy' ? '#0f1a2e' : '#f7f5f0';

  // Fundal
  const body = document.body;
  body.style.backgroundImage = '';
  body.style.backgroundColor = '';
  if (s.bgType === 'dark') body.style.backgroundColor = '#0b1a33';
  else if (s.bgType === 'papyrus') body.style.backgroundColor = '#f4e4bc';
  else if (s.bgType === 'color' && s.bgColor) body.style.backgroundColor = s.bgColor;
  else if (s.bgType === 'gallery' && s.bgImage) {
    body.style.backgroundImage = `url(${s.bgImage})`;
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
  }
  if (s.textColor) {
    const view = document.getElementById('view');
    if (view) view.style.color = s.textColor;
    body.style.color = '';
  } else {
    const view = document.getElementById('view');
    if (view) view.style.color = '';
  }
  if (s.lineHeight) body.style.lineHeight = s.lineHeight;
  if (s.noteGap != null) document.documentElement.style.setProperty('--note-gap', s.noteGap + 'px');
}

function section(id, title, body) {
  const open = (state.ui.settingsOpen || {})[id];
  const d = h('details', { class: 'set-sec', open: !!open, 'data-sec': id }, h('summary', {}, title), h('div', { class: 'set-body' }, body));
  d.addEventListener('toggle', () => { state.ui.settingsOpen = { ...(state.ui.settingsOpen || {}), [id]: d.open }; saveUI(); });
  return d;
}

function tabsSection() {
  const list = h('div', { class: 'tab-order', 'data-test': 'tab-order' });
  const draw = () => {
    list.innerHTML = '';
    liveTabs().forEach(tab => {
      const cb = h('input', { type: 'checkbox', checked: tab.visible !== false, 'aria-label': t('showTab'), onchange: async e => { tab.visible = e.target.checked; await saveTab(tab); } });
      const handle = h('span', { class: 'drag', 'aria-label': t('dragToReorder'), role: 'button' }, '≡');
      const row = h('div', { class: 'to-row', 'data-id': tab.id }, handle, cb,
        h('span', { class: 'to-dot', style: { background: tab.color || 'transparent' } }),
        h('button', { class: 'to-name', type: 'button', onclick: async () => { await tabMenu(tab); draw(); } }, tab.name, tab.lock ? ' 🔒' : ''),
        h('span', { class: 'r2-meta' }, (TAB_KINDS[tab.kind] || {}).label?.() || ''));
      dragRow(handle, row, list);
      list.append(row);
    });
  };
  draw();
  return h('div', {}, h('p', { class: 'r2-meta' }, t('tabsHint')), list,
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await newTabFlow(); draw(); } }, '+ ' + t('newTab')));
}

function dragRow(handle, row, list) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch {}
    row.classList.add('dragging');
    const move = ev => {
      const y = ev.clientY;
      const rows = [...list.children].filter(r => r !== row);
      let placed = false;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (y < b.top + b.height / 2) { if (row.nextSibling !== r) list.insertBefore(row, r); placed = true; break; }
      }
      if (!placed && list.lastElementChild !== row) list.append(row);
      const sc = list.closest('.m-body'); if (sc) { const sb = sc.getBoundingClientRect(); if (y < sb.top + 40) sc.scrollTop -= 12; else if (y > sb.bottom - 40) sc.scrollTop += 12; }
    };
    const up = async () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      const ids = [...list.children].map(r => r.dataset.id);
      const all = liveTabs();
      ids.forEach((id, i) => { const tb = all.find(x => x.id === id); if (tb) tb.order = i; });
      await saveTabsOrder();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}

function designSection() {
  const s = state.settings;
  const themeRow = h('div', { class: 'theme-pick' }, [['light', t('themeLight')], ['navy', t('themeNavy')]].map(([v, n]) =>
    h('button', { class: 'theme-opt th-' + v + (s.theme === v ? ' sel' : ''), type: 'button', 'data-theme': v, onclick: async e => { const box = e.currentTarget.parentNode; s.theme = v; applyTheme(); box.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('sel', b.dataset.theme === v)); await saveSettings(); } },
      h('span', { class: 'th-swatch' }), n)));
  const styleRow = h('div', { class: 'row-btns' },
    [['pill', t('tabStylePill')], ['box', t('tabStyleBox')]].map(([v, n]) =>
      h('button', { class: 'btn sm' + (s.tabStyle === v || (!s.tabStyle && v === 'pill') ? ' primary' : ' ghost'), type: 'button', 'data-test': 'tab-style-' + v, onclick: async e => {
        s.tabStyle = v; applyTheme();
        e.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b === e.currentTarget));
        e.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('ghost', b !== e.currentTarget));
        await saveSettings();
        const bar = document.getElementById('tabbar'); if (bar) renderTabBar(bar, state.ui.tab);
      } }, n)));
  const fontRow = h('div', { class: 'row-btns' },
    [['sm', t('fontSm')], ['md', t('fontMd')], ['lg', t('fontLg')]].map(([v, n]) =>
      h('button', { class: 'btn sm' + ((s.fontScale || 'md') === v ? ' primary' : ' ghost'), type: 'button', 'data-test': 'font-' + v, onclick: async e => {
        s.fontScale = v; applyTheme();
        e.currentTarget.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('primary', b === e.currentTarget); b.classList.toggle('ghost', b !== e.currentTarget); });
        await saveSettings();
      } }, n)));
  // Fundaluri
  const bgRow = h('div', { class: 'row-btns' },
    [['light', 'Light'], ['dark', 'Dark'], ['papyrus', 'Papirus'], ['color', 'Culoare'], ['gallery', 'Galerie']].map(([v, n]) =>
      h('button', { class: 'btn sm' + ((s.bgType || 'light') === v ? ' primary' : ' ghost'), type: 'button', onclick: async e => {
        s.bgType = v;
        if (v === 'color') {
          const picker = h('input', { type: 'color', value: s.bgColor || '#f7efd4', style: { width: 0, height: 0, opacity: 0, position: 'absolute' } });
          document.body.append(picker);
          picker.addEventListener('input', async () => {
            s.bgColor = picker.value;
            applyTheme();
            await saveSettings();
          });
          picker.addEventListener('change', () => picker.remove());
          picker.click();
        }
        if (v === 'gallery') {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          inp.onchange = async () => {
            const file = inp.files[0];
            if (file) {
              const url = URL.createObjectURL(file);
              s.bgImage = url;
              applyTheme();
              await saveSettings();
            }
          };
          inp.click();
        }
        applyTheme();
        await saveSettings();
        e.currentTarget.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('primary', b === e.currentTarget); b.classList.toggle('ghost', b !== e.currentTarget); });
      } }, n)));

  // Protecție ecran
const ssTimeout = h("input", { class: "inp", type: "number", min: "0", max: "60", value: s.ssTimeout || 3, style: { maxWidth: "80px" } });
  ssTimeout.addEventListener('change', async () => { s.ssTimeout = Math.max(0, Math.min(60, +ssTimeout.value || 0)); await saveSettings(); });
  const ssSpeed = h('div', { class: 'row-btns' },
    [['lent', 'Lent'], ['normal', 'Normal'], ['rapid', 'Rapid']].map(([v, n]) =>
      h('button', { class: 'btn sm' + ((s.ssSpeed || 'normal') === v ? ' primary' : ' ghost'), type: 'button', onclick: async e => {
        s.ssSpeed = v; saveSettings();
        e.currentTarget.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('primary', b === e.currentTarget); b.classList.toggle('ghost', b !== e.currentTarget); });
      } }, n)));
  const ssTips = h('label', { class: 'fld-check' },
    h('input', { type: 'checkbox', checked: s.ssTips !== false, onchange: async e => { s.ssTips = e.target.checked; await saveSettings(); } }),
    h('span', {}, 'Afișează sfaturi'));

  // Setări fine
  const fineRow = h('div', { style: { marginTop: '12px' } },
    h('h3', { class: 'sub-h' }, 'Setări fine'),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
      h('span', {}, 'Spațiu între notițe'),
      h('span', { id: 'vNrp', style: { fontWeight: 600 } }, (s.noteGap || 8) + 'px')),
    h('input', { type: 'range', min: 0, max: 16, value: s.noteGap || 8, style: { width: '100%' },
      oninput: e => { s.noteGap = +e.target.value; document.documentElement.style.setProperty('--note-gap', s.noteGap + 'px'); document.getElementById('vNrp').textContent = s.noteGap + 'px'; saveSettings(); } })
  );

  const divider = (title) => h('div', { class: 'set-divider' }, h('span', {}, title));

  return h('div', {},
    divider('Design'),
    h('h3', { class: 'sub-h' }, t('setThemes')), themeRow,
    h('h3', { class: 'sub-h' }, 'Fundal'), bgRow,
    h('h3', { class: 'sub-h' }, t('setTabStyle')), styleRow,
    h('h3', { class: 'sub-h' }, t('setFont')), fontRow,
    fineRow,
    divider('Dosare'),
    h('label', { class: 'fld-check' },
      h('input', { type: 'checkbox', checked: s.showPF !== false, onchange: async e => { s.showPF = e.target.checked; await saveSettings(); } }),
      h('span', {}, 'Afișează Persoane fizice')),
    h('label', { class: 'fld-check' },
      h('input', { type: 'checkbox', checked: s.showFirme !== false, onchange: async e => { s.showFirme = e.target.checked; await saveSettings(); } }),
      h('span', {}, 'Afișează firme')),
    h('label', { class: 'fld-check' },
      h('input', { type: 'checkbox', checked: s.showAmbele !== false, onchange: async e => { s.showAmbele = e.target.checked; await saveSettings(); } }),
      h('span', {}, 'Afișează ambele')),
    h('label', { class: 'fld-check' },
      h('input', { type: 'checkbox', checked: !!s.autoHideFolders, onchange: async e => { s.autoHideFolders = e.target.checked; await saveSettings(); } }),
      h('span', {}, 'Auto-ascunde bara de foldere')),
    divider('Lock'),
    h('div', { class: 'row-btns' },
      [['rapid', 'Rapid'], ['manual', 'Manual'], ['session', 'Sesiune']].map(([v, n]) =>
        h('button', { class: 'btn sm' + ((s.lockMode || 'background') === v ? ' primary' : ' ghost'), type: 'button', onclick: async e => {
          s.lockMode = v; await saveSettings();
          e.currentTarget.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('primary', b === e.currentTarget); b.classList.toggle('ghost', b !== e.currentTarget); });
        } }, n))),
    h('label', { class: 'fld' }, h('span', {}, 'PIN (4-6 cifre)'), h('input', { class: 'inp', type: 'password', inputmode: 'numeric', maxlength: 6, placeholder: state.settings.appPin ? '••••' : 'ne setat', 'data-test': 'app-pin', onchange: async e => { if (e.target.value.length >= 4) { const { setPin } = await import('./lock.js'); setPin(e.target.value); toast('PIN setat'); e.target.value = ''; } } })),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { const { openPatternSetup } = await import('./lock.js'); openPatternSetup(); } }, 'Desenează pattern (9 puncte)'),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { const { clearLock } = await import('./lock.js'); clearLock(); } }, 'Șterge Lock'),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { const { unlockWithBiometric } = await import('./lock.js'); unlockWithBiometric(); } }, 'Deblochează cu amprentă 🫆'),
    divider('Protecție ecran'),
    h('label', { class: 'fld' }, h('span', {}, 'Minute fără atingere (0 = oprit)'), ssTimeout),
    h('div', { class: 'row-btns' }, ssSpeed),
    ssTips,
    h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { s.ssTimeout = Math.max(0, Math.min(60, +ssTimeout.value || 0)); await saveSettings(); toast(t('savedOk')); } }, 'Salvează timp'));
}

async function checkUpdate(statusEl) {
  statusEl.textContent = t('updateChecking');
  try {
    const r = await fetch('https://api.github.com/repos/cluj1313/lege-si-ordine/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('http');
    const j = await r.json();
    const tag = String(j.tag_name || '').replace(/^v/, '');
    if (tag && tag !== APP_VERSION) statusEl.textContent = t('updateAvailable', { v: tag });
    else statusEl.textContent = t('updateCurrent', { v: APP_VERSION });
  } catch {
    statusEl.textContent = t('updateCheckFail');
  }
}

// Alarme și notificări: stare reală (Permise / Refuzate / Neîntrebat), cerere de permisiune, test.
function alarmsSection() {
  const hideClock = h('label', { class: 'fld-check' },
    h('input', { type: 'checkbox', checked: !!s.hideClock, onchange: async e => { s.hideClock = e.target.checked; await saveSettings(); const { render } = await import('../app.js'); render(); } }),
    h('span', {}, 'Ascunde ceasul'));

  const native = nativeNotif();
  const status = h('div', { class: 'notif-status', 'data-test': 'notif-status' });
  const allow = h('button', { class: 'btn primary', type: 'button', 'data-test': 'notif-allow' }, t('allowNotif'));
  const test = h('button', { class: 'btn ghost', type: 'button', 'data-test': 'notif-test' }, t('notifTest'));
  const btns = h('div', { class: 'notif-btns' }, allow, test);
  const extra = h('div', { class: 'notif-btns' });
  const draw = async () => {
    const st = await notifStatus();
    const ex = await exactStatus();
    status.innerHTML = '';
    status.dataset.state = st;
    status.append(h('span', { class: 'pill ' + (st === 'granted' ? 'ok' : st === 'denied' ? 'bad' : ''), 'data-test': 'notif-state' }, t('notifState_' + st)));
    if (ex) status.append(h('span', { class: 'pill ' + (ex === 'granted' ? 'ok' : 'bad'), 'data-test': 'exact-state' }, t('exactState_' + ex)));
    allow.hidden = st === 'granted' || st === 'unsupported';
    allow.textContent = st === 'denied' && native ? t('notifOpenSettings') : t('allowNotif');
    test.disabled = st !== 'granted';
    extra.innerHTML = '';
    if (native && ex === 'denied') extra.append(h('button', { class: 'btn ghost', type: 'button', 'data-test': 'exact-open', onclick: async () => { await openExactSettings(); } }, t('exactOpen')));
    if (native && st === 'granted') extra.append(h('button', { class: 'btn ghost', type: 'button', 'data-test': 'notif-open-settings', onclick: () => openNotifSettings() }, t('notifOpenSettings')));
  };
  allow.addEventListener('click', () => act(allow, async () => {
    const r = await requestNotif();
    if (r === 'denied') toast(native ? t('notifDeniedNative') : t('notifDeniedWeb'), 4500);
    if (r === 'granted') toast(t('notifGrantedOk'));
    await draw();
  }));
  test.addEventListener('click', () => act(test, async () => {
    const r = await sendTest();
    toast(r === 'sent' ? t('notifTestSent') : t('notifTestNeedAllow'), 3500);
  }));
  // revenire din setările Android: actualizează starea
  const onVis = () => { if (!document.hidden && status.isConnected) draw(); else if (!status.isConnected) document.removeEventListener('visibilitychange', onVis); };
  document.addEventListener('visibilitychange', onVis);
  draw();
  return h('div', { 'data-test': 'alarms-sec' },
    hideClock,
    h('p', { class: 'r2-meta' }, native ? t('alarmsHintNative') : t('alarmsHintWeb')),
    status, btns, extra);
}

export function openSettings() {
  const s = state.settings;
  const nameInp = h('input', { class: 'inp', type: 'text', value: s.displayName || '', autocomplete: 'name', 'data-test': 'set-name', placeholder: t('setNamePh') });
  nameInp.addEventListener('change', async () => { s.displayName = nameInp.value.trim(); await saveSettings(); });
  const remind = h('label', { class: 'fld-check' },
    h('input', { type: 'checkbox', 'data-test': 'remind-urgents', checked: !!s.remindUrgents, onchange: async e => { s.remindUrgents = e.target.checked; await saveSettings(); } }),
    h('span', {}, t('remindUrgents')));

  const days = h('input', { class: 'inp', type: 'number', min: '1', max: '3650', value: String(s.trashDays), inputmode: 'numeric', 'data-test': 'trash-days' });
  const hasSample = [...state.items.values()].some(i => i.sample);
  const updateStatus = h('p', { class: 'r2-meta', 'data-test': 'update-status' }, `${t('version')} ${APP_VERSION}`);

  let installBtn = null;
  if (window.__lsoInstall) {
    installBtn = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      try { await window.__lsoInstall.prompt(); const r = await window.__lsoInstall.userChoice; if (r && r.outcome === 'accepted') { installBtn.remove(); window.__lsoInstall = null; } } catch {}
    } }, t('installApp'));
  }

  const body = h('div', { class: 'settings' },
    h('label', { class: 'fld' }, h('span', {}, t('setName')), nameInp),
    remind,
    section('voice', t('setVoice'), h('div', {},
      h('p', { class: 'r2-meta' }, t('voiceCurrent', { l: (LANGS.find(l => l[0] === s.voiceLang) || [0, s.voiceLang])[1] })),
      h('p', { class: 'r2-meta' }, `${t('voiceRead')}: ${canSpeak() ? t('available') : t('unavailable')} • ${t('voiceDictation')}: ${canDictate() ? t('available') : t('unavailable')}`),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => voiceMenu() }, t('voiceSettings')))),
    section('tabs', t('setTabs'), tabsSection()),
    section('design', t('setDesign'), designSection()),
    section('alarms', t('setAlarms'), alarmsSection()),
    section('trash', t('setTrash'), h('div', {},
      h('label', { class: 'fld' }, h('span', {}, t('trashDays')), h('div', { class: 'row-inp' }, days,
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { const n = Math.max(1, Math.min(3650, Math.round(+days.value || 30))); s.trashDays = n; days.value = n; await saveSettings(); toast(t('savedOk')); } }, t('save')))),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openTrash() }, t('openTrash')))),
    section('backup', t('setBackup'), backupSection()),
    section('privacy', 'Confidențialitate', privacyBody()),
    section('creator', 'Comunică cu creatorul aplicației', creatorBody()),
    hasSample ? section('sample', t('setSample'), h('div', {}, h('p', { class: 'r2-meta' }, t('sampleHint')),
      h('button', { class: 'btn danger-ghost', type: 'button', onclick: e => act(e.currentTarget, async () => {
        if (!(await confirmDlg(t('confirmRemoveSample'), { danger: true }))) return;
        for (const it of [...state.items.values()].filter(i => i.sample)) if (state.items.has(it.id)) await purge(it);
        toast(t('sampleRemoved')); app.render();
      }) }, t('removeSample')))) : null,
    installBtn,
    section('share-invite', 'Share', h('div', { class: 'sh-wrap' },
      h('div', { class: 'sh-row', onclick: e => { const b = e.currentTarget.nextElementSibling; b.hidden = !b.hidden; e.currentTarget.classList.toggle('open', !b.hidden); } },
        h('img', { class: 'sh-app', src: 'icons/icon-512.png', alt: 'LEGE ȘI ORDINE', width: 52, height: 52 }),
        h('span', { class: 'sh-l' }, 'SHARE ', h('span', { class: 'ux' }, 'LEGE ȘI ORDINE')),
        h('i', { class: 'sparr' })
      ),
      h('div', { class: 'sh-box', hidden: true },
        // Fără cod
        h('div', { class: 'sh-opt' },
          h('p', { class: 'sh-tx' }, 'Dacă cunoști pe cineva care ar avea nevoie de această aplicație, dă un simplu Share. Destinatarul primește linkul de descărcare.'),
          h('div', { class: 'sh-line' },
            h('span', { class: 'sh-opt-h' }, 'Fără cod'),
            h('button', { class: 'sh-go', type: 'button', title: 'Share', onclick: () => doShare(3) }, shareIcon(), h('span', { class: 'sh-go-l' }, 'Share'))
          ),
          h('div', { class: 'sh-periods' },
            ...[[3,'3 luni'],[6,'6 luni'],[9,'9 luni'],[12,'1 an']].map(([m,l]) =>
              h('button', { class: 'sh-p' + (m===3?' on':''), type: 'button', disabled: m!==3 }, l)
            )
          )
        ),
        // Cu cod
        h('div', { class: 'sh-opt' },
          h('p', { class: 'sh-tx' }, 'Introdu codul primit și alege perioada. Apoi dă Share.'),
          h('div', { class: 'sh-line' },
            h('span', { class: 'sh-opt-h' }, 'Cu cod'),
            h('button', { class: 'sh-go', type: 'button', title: 'Share', onclick: () => doShareWithCode() }, shareIcon(), h('span', { class: 'sh-go-l' }, 'Share'))
          ),
          h('div', { class: 'sh-periods', id: 'shPeriods' },
            ...[[3,'3 luni'],[6,'6 luni'],[9,'9 luni'],[12,'1 an']].map(([m,l]) =>
              h('button', { class: 'sh-p' + (m===3?' on':''), type: 'button', disabled: m!==3,
                'data-m': m, onclick: e => { if (m!==3) return; e.currentTarget.parentElement.querySelectorAll('.sh-p').forEach(b=>b.classList.toggle('on', b===e.currentTarget)); } }, l)
            )
          ),
          codeBlock()
        )
      )
    )),
    section('about', t('setAbout'), h('div', {},
      h('p', {}, `LEGE ȘI ORDINE • ${t('version')} ${APP_VERSION}`),
      h('p', { class: 'r2-meta' }, t('aboutHint')),
      codeBlock(),
      updateStatus,
      h('button', { class: 'btn ghost', type: 'button', 'data-test': 'check-update', onclick: () => checkUpdate(updateStatus) }, t('checkUpdate')))),
  );
  const m = openModal({ title: t('settings'), body, kind: 'drawer', cls: 'settings-page settings-drawer', onClose: () => app.render() });
  m.el.dataset.test = 'settings';
}

export async function maybeRemindUrgents() {
  const s = state.settings;
  if (!s.remindUrgents) return;
  const day = new Date(); const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
  if (s.lastUrgentRemind === key) return;
  const urgTab = liveTabs().find(x => x.urgent || x.kind === 'note' && /urgen/i.test(x.name));
  let n = 0;
  if (urgTab) n = itemsOf(urgTab.id).filter(it => !it.trashedAt && canView(it)).length;
  for (const it of state.items.values()) {
    if (it.kind !== 'task' || it.trashedAt) continue;
    const d = dataOf(it);
    if (d && d.done) continue;
    if (d && d.date === key.replace(/-(\d)-/, '-0$1-').split('').join('') ) { /* skip brittle */ }
    // today by ISO date
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    if (d && d.date === iso) n++;
  }
  if (!n) return;
  s.lastUrgentRemind = key;
  await saveSettings();
  toast(t('urgentRemind', { n }), 4000);
}

export function listenInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__lsoInstall = e; });
}


function shareIcon() {
  return h('svg', { viewBox: '0 0 24 24', width: 28, height: 28, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    h('circle', { cx: 18, cy: 5, r: 3 }),
    h('circle', { cx: 6, cy: 12, r: 3 }),
    h('circle', { cx: 18, cy: 19, r: 3 }),
    h('line', { x1: 8.6, y1: 13.5, x2: 15.4, y2: 17.5 }),
    h('line', { x1: 15.4, y1: 6.5, x2: 8.6, y2: 10.5 })
  );
}

async function doShare(months) {
  const label = months === 12 ? '1 an' : months + ' luni';
  const U = 'https://cluj1313.github.io/lege-si-ordine/apk/';
  const text = `LEGE ȘI ORDINE\nAplicație pentru avocați.\nValabilă ${label}.\n${U}`;
  const { shareText } = await import('./share.js');
  await shareText('LEGE ȘI ORDINE', text);
}


async function doShareWithCode() {
  const sel = document.querySelector('.sh-p.on');
  const m = sel ? Number(sel.dataset.m) || 3 : 3;
  await doShare(m);
}

async function openShareValidity() {
  const { openModal } = await import('../ui/modal.js');
  const { zoneSession } = await import('../secret/zone.js');
  const isOwner = !!zoneSession();
  const opts = [[3, '3 luni'], [6, '6 luni'], [9, '9 luni'], [12, '1 an']];
  let sel = 3;
  const body = h('div', {},
    h('p', { class: 'r2-meta' }, 'Valabilitate pentru destinatar'),
    h('div', { class: 'row-inp', style: { flexWrap: 'wrap', gap: '8px', margin: '10px 0' } },
      ...opts.map(([m, l]) => {
        const disabled = !isOwner && m !== 3;
        return h('button', {
          class: 'btn sm' + (m === sel ? ' primary' : ''),
          type: 'button',
          disabled,
          style: disabled ? { opacity: .45, cursor: 'not-allowed' } : {},
          title: disabled ? 'Doar 3 luni disponibil' : '',
          onclick: e => {
            if (disabled) return;
            sel = m;
            e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b === e.currentTarget));
          }
        }, l);
      })
    ),
    h('p', { class: 'r2-meta' }, isOwner
      ? 'Ești în Zona secretă: poți alege orice perioadă.'
      : 'Pentru distribuire: doar 3 luni. Perioadele mai lungi sunt pentru creator.'),
    h('p', { class: 'r2-meta' }, 'După expirare, datele rămân pe telefon; se pot citi și exporta. Nu se șterge nimic.'),
    h('button', { class: 'btn primary', type: 'button', style: { marginTop: '12px' }, onclick: async () => {
      const months = sel === 12 ? '1 an' : sel + ' luni';
      const U = 'https://cluj1313.github.io/lege-si-ordine/apk/';
      const text = `LEGE ȘI ORDINE\nAplicație pentru avocați.\nValabilă ${months}.\n${U}`;
      const { shareText } = await import('./share.js');
      await shareText('LEGE ȘI ORDINE', text);
      document.querySelector('[data-test=share-validity]')?.remove();
    } }, 'Trimite')
  );
  const m = openModal({ title: 'Distribuie LEGE ȘI ORDINE', body, kind: 'dialog' });
  if (m && m.el) m.el.dataset.test = 'share-validity';
}
