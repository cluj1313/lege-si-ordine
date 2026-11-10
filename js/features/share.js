// Partajare: prin sistemul telefonului când există; altfel WhatsApp / e-mail / copiere / descărcare.
import { h, downloadBlob } from '../core/util.js';
import { t } from '../core/i18n.js';
import { sheet, toast } from '../ui/modal.js';

export const waLink = text => 'https://wa.me/?text=' + encodeURIComponent(text);
export const mailLink = (subject, body) => `mailto:?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('copied')); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(t('copied')); } catch { toast(t('copyFailed')); } ta.remove();
  }
}

export async function shareText(title, text) {
  const v = await sheet(t('share'), [
    navigator.share ? { label: t('shareSystem'), value: 'sys', icon: '📤' } : null,
    { label: 'WhatsApp', value: 'wa', icon: '💬' },
    { label: t('email'), value: 'mail', icon: '✉' },
    { label: t('copyText'), value: 'copy', icon: '📋' },
  ]);
  if (v === 'sys') { try { await navigator.share({ title, text }); } catch (e) { if (e.name !== 'AbortError') copyText(text); } }
  else if (v === 'wa') window.open(waLink(text), '_blank', 'noopener');
  else if (v === 'mail') location.href = mailLink(title, text);
  else if (v === 'copy') copyText(text);
}

export async function shareFile(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(blob, name); toast(t('downloaded'));
}
