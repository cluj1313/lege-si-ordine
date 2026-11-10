// Ferestre proprii (fără alert/confirm/prompt native), cu suport pentru butonul Înapoi.
import { h, $ } from '../core/util.js';
import { t } from '../core/i18n.js';

const stack = [];
// Butonul Înapoi (Android/browser) închide fereastra de sus. Folosim o singură intrare de istoric „gardă”
// (fără history.back() programatic, care putea ieși din aplicație la deschideri/închideri rapide).
let guard = false;
const pushGuard = () => { if (!guard) { history.pushState({ lsoModal: 1 }, ''); guard = true; } };
window.addEventListener('popstate', () => {
  guard = false;
  const top = stack[stack.length - 1];
  if (top) { if (top.onBack) { pushGuard(); top.onBack(); } else { top.close(true); if (stack.length) pushGuard(); } }
});

export function openModal({ title, body, actions = [], kind = 'dialog', onClose, dismissable = true, cls = '' } = {}) {
  const root = $('#modals');
  const box = h('div', { class: `m-box m-${kind} ${cls}`, role: 'dialog', 'aria-modal': 'true' });
  const overlay = h('div', { class: `m-overlay m-ov-${kind}` }, box);
  const m = { el: box, overlay, closed: false };
  if (title != null || kind === 'page') {
    const head = h('div', { class: 'm-head' },
      kind === 'page' ? h('button', { class: 'icon-btn m-back', 'aria-label': t('back'), onclick: () => m.close() }, '‹') : null,
      h('div', { class: 'm-title' }, title || ''));
    box.append(head);
  }
  const content = h('div', { class: 'm-body' }); if (body) content.append(body); box.append(content);
  m.body = content;
  if (actions.length) {
    const bar = h('div', { class: 'm-actions' });
    for (const a of actions) {
      const b = h('button', { class: 'btn ' + (a.cls || ''), type: 'button' }, a.label);
      b.addEventListener('click', async () => {
        if (b.dataset.busy) return; b.dataset.busy = '1'; b.classList.add('busy');
        try { await a.onClick(m); } finally { delete b.dataset.busy; b.classList.remove('busy'); }
      });
      bar.append(b);
    }
    box.append(bar); m.actions = bar;
  }
  m.close = (fromPop = false) => {
    if (m.closed) return; m.closed = true;
    const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
    const top = stack[stack.length - 1];
    if (top) top.overlay.classList.remove('buried');
    const instant = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant) overlay.remove();
    else {
      overlay.classList.add('closing');
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 160);
    }
    onClose && onClose();
  };
  if (dismissable) overlay.addEventListener('pointerdown', e => { if (e.target === overlay) m._down = true; });
  if (dismissable) overlay.addEventListener('click', e => { if (e.target === overlay && m._down) m.close(); m._down = false; });
  // o singură fereastră vizibilă: cele de dedesubt se ascund, ca să nu transpire prin animații în WebView
  for (const x of stack) x.overlay.classList.add('buried');
  overlay.style.zIndex = String(50 + stack.length * 2);
  root.append(overlay);
  stack.push(m);
  pushGuard();
  const openNow = () => { if (!m.closed) overlay.classList.add('open'); };
  openNow();
  requestAnimationFrame(() => requestAnimationFrame(openNow));
  setTimeout(openNow, 0);
  return m;
}
export const topModal = () => stack[stack.length - 1];
export const closeAll = () => [...stack].reverse().forEach(m => m.close());
export const modalsOpen = () => stack.length;

export function confirmDlg(msg, { yes = t('yes'), no = t('no'), danger = false, title = t('confirm') } = {}) {
  return new Promise(res => {
    let done = false;
    const m = openModal({
      title, body: h('p', { class: 'm-msg' }, msg),
      actions: [
        { label: no, cls: 'ghost', onClick: m => { done = true; res(false); m.close(); } },
        { label: yes, cls: danger ? 'danger' : 'primary', onClick: m => { done = true; res(true); m.close(); } },
      ],
      onClose: () => { if (!done) res(false); },
    });
    m.el.dataset.test = 'confirm';
  });
}

export function infoDlg(msg, title = '') {
  return new Promise(res => openModal({ title, body: h('p', { class: 'm-msg' }, msg), actions: [{ label: t('ok'), cls: 'primary', onClick: m => m.close() }], onClose: res }));
}

export function promptDlg(title, { value = '', placeholder = '', label = '', multiline = false } = {}) {
  return new Promise(res => {
    let done = false;
    const inp = multiline ? h('textarea', { class: 'inp', rows: 4, placeholder }) : h('input', { class: 'inp', type: 'text', placeholder, enterkeyhint: 'done' });
    inp.value = value;
    const ok = m => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } done = true; res(v); m.close(); };
    const m = openModal({
      title, body: h('label', { class: 'fld' }, label ? h('span', {}, label) : null, inp),
      actions: [{ label: t('cancel'), cls: 'ghost', onClick: m => { done = true; res(null); m.close(); } }, { label: t('save'), cls: 'primary', onClick: ok }],
      onClose: () => { if (!done) res(null); },
    });
    if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(m); } });
    setTimeout(() => inp.focus(), 60);
  });
}

// Meniu de opțiuni (foaie de jos).
export function sheet(title, options) {
  return new Promise(res => {
    let done = false;
    const list = h('div', { class: 'sheet-list' });
    const m = openModal({ title, body: list, kind: 'sheet', onClose: () => { if (!done) res(null); } });
    m.el.dataset.test = 'sheet';
    for (const o of options) {
      if (!o) continue;
      list.append(h('button', { class: 'sheet-opt ' + (o.cls || ''), type: 'button', 'data-v': o.value, onclick: () => { done = true; res(o.value); m.close(); } },
        o.icon ? h('span', { class: 'so-ic' }, o.icon) : null, h('span', {}, o.label)));
    }
  });
}

export function toast(msg, ms = 2400) {
  const box = $('#toasts');
  const text = String(msg);
  // Un singur toast vizibil: același text își prelungește afișarea; un text nou îl înlocuiește pe cel vechi.
  const same = [...box.children].reverse().find(e => e.dataset.msg === text);
  if (same) {
    clearTimeout(same._hid); clearTimeout(same._rm);
    same._hid = setTimeout(() => { same.classList.remove('show'); same._rm = setTimeout(() => same.remove(), 300); }, ms);
    return same;
  }
  while (box.children.length) {
    const old = box.firstChild;
    clearTimeout(old._hid); clearTimeout(old._rm);
    old.remove();
  }
  const el = h('div', { class: 'toast', role: 'status', 'data-msg': text, 'data-test': 'toast' }, text);
  box.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el._hid = setTimeout(() => { el.classList.remove('show'); el._rm = setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

// Tastatură PIN de 4 cifre. verify(pin) -> true/false (opțional); întoarce PIN-ul sau null.
let failCount = 0, lockUntil = 0;
export function pinDlg(title, { confirm = false, verify = null, sub = '' } = {}) {
  return new Promise(res => {
    let pin = '', first = null, done = false, busy = false;
    const dots = h('div', { class: 'pin-dots' }, [0, 1, 2, 3].map(() => h('i')));
    const msg = h('div', { class: 'pin-msg' }, sub || (confirm ? t('pinChoose') : t('pinEnter')));
    const pad = h('div', { class: 'pin-pad' });
    const body = h('div', { class: 'pin-wrap' }, msg, dots, pad);
    const m = openModal({ title, body, cls: 'pin-modal', onClose: () => { if (!done) res(null); } });
    m.el.dataset.test = 'pin';
    const draw = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const press = async k => {
      if (busy) return;
      if (k === '⌫') { pin = pin.slice(0, -1); draw(); return; }
      if (pin.length >= 4) return;
      pin += k; draw();
      if (pin.length < 4) return;
      if (confirm) {
        if (!first) { first = pin; pin = ''; msg.textContent = t('pinConfirm'); setTimeout(draw, 120); return; }
        if (first !== pin) { msg.textContent = t('pinMismatch'); first = null; pin = ''; dots.classList.add('shake'); setTimeout(() => { dots.classList.remove('shake'); draw(); }, 400); return; }
        done = true; res(pin); m.close(); return;
      }
      if (verify) {
        const wait = lockUntil - Date.now();
        if (wait > 0) { msg.textContent = t('pinWait', { s: Math.ceil(wait / 1000) }); pin = ''; draw(); return; }
        busy = true; msg.textContent = t('pinChecking'); body.classList.add('busy');
        const ok = await verify(pin);
        busy = false; body.classList.remove('busy');
        if (!ok) {
          failCount++; if (failCount >= 3) lockUntil = Date.now() + Math.min(60, 2 ** (failCount - 2)) * 1000;
          msg.textContent = t('pinWrong'); pin = ''; dots.classList.add('shake'); setTimeout(() => { dots.classList.remove('shake'); draw(); }, 400); return;
        }
        failCount = 0;
      }
      done = true; res(pin); m.close();
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
      pad.append(k ? h('button', { class: 'pin-key', type: 'button', 'data-k': k, onclick: () => press(k) }, k) : h('span'));
    }
    m.el.addEventListener('keydown', e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); });
    m.el.tabIndex = -1; setTimeout(() => m.el.focus(), 50);
  });
}
