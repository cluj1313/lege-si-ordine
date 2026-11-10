// Structură i18n: dicționar pe limbă; româna este completă și implicită.
import ro from '../../i18n/ro.js';
const dicts = { ro };
let lang = 'ro';
export const setLang = l => { if (dicts[l]) lang = l; };
export function t(key, vars) {
  let s = dicts[lang][key] ?? dicts.ro[key];
  if (s == null) { console.warn('i18n lipsă:', key); s = key; }
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}
export const months = () => t('months').split(',');
export const weekdays = () => t('weekdaysShort').split(',');
