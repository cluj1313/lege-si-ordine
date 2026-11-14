import { toast } from '../ui/modal.js';

export function openFeedback() {
  const msg = prompt('Mesaj către creator:');
  if (msg) toast('Mesaj trimis (stub)');
}
