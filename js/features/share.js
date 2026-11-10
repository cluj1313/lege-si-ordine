// Partajare: prin sistemul telefonului când există; altfel WhatsApp / e-mail / copiere / descărcare.
import { h, downloadBlob } from '../core/util.js';
import { t } from '../core/i18n.js';
import { sheet, toast } from '../ui/modal.js';
import { getMedia } from '../core/store.js';
import { recTitle } from '../tabs/kinds.js';

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

const recExt = mime => (/ogg/.test(mime) ? '.ogg' : /mp4|aac|m4a/.test(mime) ? '.m4a' : /webm/.test(mime) ? '.webm' : '.webm');

export async function shareRecording(it, d) {
  const v = await sheet(t('shareRecTitle'), [
    { label: t('shareTextKind'), value: 'text', icon: '📄' },
    { label: t('shareVoice'), value: 'voice', icon: '🎙' },
    { label: t('shareBoth'), value: 'both', icon: '📤' },
  ]);
  if (!v) return;
  const title = recTitle(d);
  const text = [title, d.caseNumber ? (t('fCaseNumber') + ': ' + d.caseNumber) : '', d.transcript || ''].filter(x => x !== '').join('\n').trim();
  const wantFile = v === 'voice' || v === 'both';
  const wantText = v === 'text' || v === 'both';
  let file = null;
  if (wantFile) {
    const media = d.mid ? await getMedia(d.mid) : null;
    if (!media) { toast(t('mediaMissing')); if (!wantText) return; }
    else file = new File([media.blob], (d.name || title || 'inregistrare') + recExt(media.mime), { type: media.mime });
  }
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      const payload = { files: [file], title };
      if (wantText && text) payload.text = text;
      await navigator.share(payload);
      return;
    }
    if (!file && wantText && navigator.share) {
      await navigator.share({ title, text });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  if (wantText && text) await copyText(text);
  if (file) { downloadBlob(file, file.name); toast(t('downloaded')); }
}
