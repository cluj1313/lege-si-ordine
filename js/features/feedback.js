import { toast } from '../ui/modal.js';

export function openFeedback() {
  const msg = prompt('Mesaj către creator:');
  if (msg && msg.trim()) {
    toast('Mesaj trimis. Mulțumim!');
  }
}
