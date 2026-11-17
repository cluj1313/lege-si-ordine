// Culoare de accent și Aspect (font, fundal, spațiere) pe element; ultimele valori devin implicitul următorului element.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { state, saveSettings, saveMeta } from '../core/store.js';
import { openModal, toast } from '../ui/modal.js';

export const PALETTE = ['#c0392b', '#d35400', '#b8913a', '#3f7d5a', '#2e86c1', '#1a5276', '#6c3483', '#1c2833'];

export function persistLso(key, val) {
  try { localStorage.setItem(key, val == null ? '' : (typeof val === 'string' ? val : JSON.stringify(val))); } catch {}
}
export function readLso(key, def) {
  try {
    const v = localStorage.getItem(key);
    if (v == null || v === '') return def;
    if (def && typeof def === 'object') { try { return JSON.parse(v); } catch { return def; } }
    return v;
  } catch { return def; }
}

export function rememberDefaults({ color, aspect } = {}) {
  if (color !== undefined) {
    state.settings.defaultColor = color || '';
    persistLso('lso_defaultColor', color || '');
  }
  if (aspect !== undefined) {
    state.settings.defaultAspect = aspect ? { ...aspect } : null;
    persistLso('lso_defaultAspect', aspect || '');
  }
  return saveSettings();
}

export function colorDots(current, onPick, { none = true } = {}) {
  const row = h('div', { class: 'colors', 'data-test': 'color-dots' });
  const add = (c, label) => {
    const b = h('button', {
      class: 'color-dot' + ((current || '') === (c || '') ? ' sel' : ''),
      type: 'button',
      style: { background: c || 'transparent' },
      title: label || c,
      'data-color': c || '',
      'aria-label': label || c,
    });
    if (!c) b.append(h('span', { class: 'color-none' }, '×'));
    b.onclick = e => { e.stopPropagation(); onPick(c || ''); };
    row.append(b);
  };
  if (none) add('', t('noColor'));
  PALETTE.forEach(c => add(c));
  return row;
}

export function applyCardLook(el, it) {
  const color = it && it.color;
  if (color) el.style.setProperty('--accent', color);
  const a = it && it.aspect;
  if (!a) return;
  if (a.bgColor) el.style.background = a.bgColor;
  if (a.fontColor) el.style.color = a.fontColor;
  if (a.fontSize) el.style.fontSize = (/^\d+$/.test(String(a.fontSize)) ? a.fontSize + 'px' : a.fontSize);
  if (a.lineHeight) el.style.lineHeight = String(a.lineHeight);
}

export async function pickColor(current) {
  return new Promise(res => {
    let done = false;
    const finish = (v, m) => { if (done) return; done = true; res(v); m.close(); };
    const body = h('div', { class: 'aspect-body' },
      h('p', { class: 'r2-meta' }, t('colorHint')),
      colorDots(current || '', c => finish(c, m)));
    const m = openModal({
      title: t('color'),
      body,
      kind: 'sheet',
      onClose: () => { if (!done) res(null); },
    });
    m.el.dataset.test = 'color-sheet';
  });
}

function aspectState(it) {
  const a = { ...(it && it.aspect || state.settings.defaultAspect || {}) };
  return {
    fontSize: a.fontSize || 16,
    fontColor: a.fontColor || '',
    bgColor: a.bgColor || '',
    lineHeight: a.lineHeight || 1.4,
  };
}

export async function openAspectSheet(it) {
  return new Promise(res => {
    let done = false;
    const cur = aspectState(it);
    const preview = h('div', { class: 'aspect-preview', 'data-test': 'aspect-preview' }, t('aspectPreview'));
    const paint = () => {
      preview.style.fontSize = (+cur.fontSize || 16) + 'px';
      preview.style.color = cur.fontColor || '';
      preview.style.background = cur.bgColor || '';
      preview.style.lineHeight = String(cur.lineHeight || 1.4);
    };
    paint();
    const size = h('input', { class: 'inp', type: 'range', min: '12', max: '28', step: '1', value: String(cur.fontSize), 'data-test': 'aspect-size' });
    const sizeVal = h('span', { class: 'r2-meta' }, cur.fontSize + ' px');
    size.oninput = () => { cur.fontSize = +size.value; sizeVal.textContent = cur.fontSize + ' px'; paint(); };
    const space = h('input', { class: 'inp', type: 'range', min: '1', max: '2.2', step: '0.1', value: String(cur.lineHeight), 'data-test': 'aspect-space' });
    const spaceVal = h('span', { class: 'r2-meta' }, String(cur.lineHeight));
    space.oninput = () => { cur.lineHeight = Math.round(+space.value * 10) / 10; spaceVal.textContent = String(cur.lineHeight); paint(); };
    let fontRow, bgRow;
    const drawFont = () => {
      const n = colorDots(cur.fontColor, c => { cur.fontColor = c; paint(); drawFont(); }, { none: true });
      n.dataset.test = 'aspect-font-color';
      if (fontRow) fontRow.replaceWith(n);
      fontRow = n;
    };
    const drawBg = () => {
      const n = colorDots(cur.bgColor, c => { cur.bgColor = c; paint(); drawBg(); }, { none: true });
      n.dataset.test = 'aspect-bg-color';
      if (bgRow) bgRow.replaceWith(n);
      bgRow = n;
    };
    drawFont(); drawBg();
    const body = h('div', { class: 'aspect-body' },
      preview,
      h('label', { class: 'fld' }, h('span', {}, t('aspectFontSize')), h('div', { class: 'aspect-range' }, size, sizeVal)),
      h('label', { class: 'fld' }, h('span', {}, t('aspectFontColor')), fontRow),
      h('label', { class: 'fld' }, h('span', {}, t('aspectBgColor')), bgRow),
      h('label', { class: 'fld' }, h('span', {}, t('aspectLineHeight')), h('div', { class: 'aspect-range' }, space, spaceVal))
    );
    const finish = (v, m) => { if (done) return; done = true; res(v); m.close(); };
    const m = openModal({
      title: t('aspect'),
      body,
      kind: 'sheet',
      actions: [
        { label: t('cancel'), cls: 'ghost', onClick: m => finish(null, m) },
        { label: t('save'), cls: 'primary', onClick: m => finish({ ...cur }, m) },
      ],
      onClose: () => { if (!done) res(null); },
    });
    m.el.dataset.test = 'aspect-sheet';
  });
}

export async function applyColorToItems(items, color) {
  for (const it of items) {
    it.color = color || '';
    await saveMeta(it);
  }
  await rememberDefaults({ color: color || '' });
}

export async function applyAspectToItem(it, aspect) {
  it.aspect = aspect ? { ...aspect } : null;
  await saveMeta(it);
  await rememberDefaults({ aspect });
}
