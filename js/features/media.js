// Media locală: comprimare poze, alegere fișiere, vizualizator.
import { h } from '../core/util.js';
import { t } from '../core/i18n.js';
import { openModal } from '../ui/modal.js';

export function pickFiles({ accept = '*/*', capture = false, multiple = false } = {}) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (capture) inp.setAttribute('capture', 'environment');
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { res([]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

// Redimensionează pozele mari (max 1800 px, JPEG 0.85) pentru a economisi spațiu.
export async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp)/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = h('canvas', { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

export function viewMedia(m, name) {
  const url = URL.createObjectURL(m.blob);
  let body;
  if (/^image\//.test(m.mime)) body = h('img', { class: 'viewer-img', src: url, alt: name });
  else if (/^audio\//.test(m.mime)) body = h('audio', { controls: true, src: url, class: 'rec-audio' });
  else if (/^video\//.test(m.mime)) body = h('video', { controls: true, src: url, class: 'viewer-img' });
  else body = h('div', { class: 'm-msg' }, t('fileNoPreview'));
  openModal({ title: name, body, kind: 'page', cls: 'viewer', onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
    actions: [{ label: t('openDownload'), cls: 'ghost', onClick: () => { const a = h('a', { href: url, download: name, target: '_blank' }); document.body.append(a); a.click(); a.remove(); } }] });
}
