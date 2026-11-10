// Setări: Taburi (arătare, reordonare cu ≡), Design (teme), Voce, Alarme, Coș, Backup, Date de exemplu, Versiune.
import { h, act } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, liveTabs, saveTab, saveTabsOrder, saveSettings, saveUI, APP_VERSION, purge } from '../core/store.js';
import { openModal, confirmDlg, toast } from '../ui/modal.js';
import { tabMenu, newTabFlow } from '../ui/tabsbar.js';
import { voiceMenu, LANGS, canDictate, canSpeak } from './voice.js';
import { requestNotif } from './alarms.js';
import { backupSection } from './backup.js';
import { openTrash } from './trash.js';
import { TAB_KINDS } from '../tabs/kinds.js';
import { app } from '../ui/registry.js';

export function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === 'navy' ? 'navy' : 'light';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = state.settings.theme === 'navy' ? '#0f1a2e' : '#f7f5f0';
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

// Reordonare verticală cu ≡ prin pointer events.
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
      // derulare automată la margini
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

export function openSettings() {
  const s = state.settings;
  const themeRow = h('div', { class: 'theme-pick' }, [['light', t('themeLight')], ['navy', t('themeNavy')]].map(([v, n]) =>
    h('button', { class: 'theme-opt th-' + v + (s.theme === v ? ' sel' : ''), type: 'button', 'data-theme': v, onclick: async e => { const box = e.currentTarget.parentNode; s.theme = v; applyTheme(); box.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('sel', b.dataset.theme === v)); await saveSettings(); } },
      h('span', { class: 'th-swatch' }), n)));
  const days = h('input', { class: 'inp', type: 'number', min: '1', max: '3650', value: String(s.trashDays), inputmode: 'numeric', 'data-test': 'trash-days' });
  const notifState = h('span', { class: 'r2-meta' }, 'Notification' in window ? t('notif_' + Notification.permission) : t('notif_unsupported'));
  const hasSample = [...state.items.values()].some(i => i.sample);
  const body = h('div', { class: 'settings' },
    section('tabs', t('setTabs'), tabsSection()),
    section('design', t('setDesign'), themeRow),
    section('voice', t('setVoice'), h('div', {},
      h('p', { class: 'r2-meta' }, t('voiceCurrent', { l: (LANGS.find(l => l[0] === s.voiceLang) || [0, s.voiceLang])[1] })),
      h('p', { class: 'r2-meta' }, `${t('voiceRead')}: ${canSpeak() ? t('available') : t('unavailable')} • ${t('voiceDictation')}: ${canDictate() ? t('available') : t('unavailable')}`),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => voiceMenu() }, t('voiceSettings')))),
    section('alarms', t('setAlarms'), h('div', {},
      h('p', { class: 'r2-meta' }, t('alarmsHint')), notifState,
      h('button', { class: 'btn ghost', type: 'button', onclick: async () => { const r = await requestNotif(); notifState.textContent = t('notif_' + r); } }, t('allowNotif')))),
    section('trash', t('setTrash'), h('div', {},
      h('label', { class: 'fld' }, h('span', {}, t('trashDays')), h('div', { class: 'row-inp' }, days,
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { const n = Math.max(1, Math.min(3650, Math.round(+days.value || 30))); s.trashDays = n; days.value = n; await saveSettings(); toast(t('savedOk')); } }, t('save')))),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openTrash() }, t('openTrash')))),
    section('backup', t('setBackup'), backupSection()),
    hasSample ? section('sample', t('setSample'), h('div', {}, h('p', { class: 'r2-meta' }, t('sampleHint')),
      h('button', { class: 'btn danger-ghost', type: 'button', onclick: e => act(e.currentTarget, async () => {
        if (!(await confirmDlg(t('confirmRemoveSample'), { danger: true }))) return;
        for (const it of [...state.items.values()].filter(i => i.sample)) if (state.items.has(it.id)) await purge(it);
        toast(t('sampleRemoved')); app.render();
      }) }, t('removeSample')))) : null,
    section('about', t('setAbout'), h('div', {}, h('p', {}, `LEGE ȘI ORDINE • ${t('version')} ${APP_VERSION}`), h('p', { class: 'r2-meta' }, t('aboutHint')))),
  );
  const m = openModal({ title: t('settings'), body, kind: 'page', cls: 'settings-page', onClose: () => app.render() });
  m.el.dataset.test = 'settings';
}
