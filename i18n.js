/* DARK SCHOOL — localization hub.
   English is the base/primary language and the fallback for every missing key.
   Full packs: English, العربية, Español, Français, Deutsch, Türkçe, Русский, Português. */
import es from './lang/es.js';
import fr from './lang/fr.js';
import de from './lang/de.js';
import tr from './lang/tr.js';
import ru from './lang/ru.js';
import pt from './lang/pt.js';

export const LANGS = [
  { code: 'en', native: 'English', en: 'English', flag: '🇬🇧', dir: 'ltr' },
  { code: 'ar', native: 'العربية', en: 'Arabic', flag: '🇸🇦', dir: 'rtl' },
  { code: 'es', native: 'Español', en: 'Spanish', flag: '🇪🇸', dir: 'ltr' },
  { code: 'fr', native: 'Français', en: 'French', flag: '🇫🇷', dir: 'ltr' },
  { code: 'de', native: 'Deutsch', en: 'German', flag: '🇩🇪', dir: 'ltr' },
  { code: 'tr', native: 'Türkçe', en: 'Turkish', flag: '🇹🇷', dir: 'ltr' },
  { code: 'ru', native: 'Русский', en: 'Russian', flag: '🇷🇺', dir: 'ltr' },
  { code: 'pt', native: 'Português (BR)', en: 'Portuguese', flag: '🇧🇷', dir: 'ltr' },
];

export const EXTRA_LANGS = { es, fr, de, tr, ru, pt };
import { LEGEND_STRINGS as LEG } from './lang/extra.js';
import { PACK2 } from './lang/pack2.js';

/* merge the legendary strings with the v2.1 additions, per language */
export const LEGEND_STRINGS = (() => {
  const out = {};
  for (const code of new Set([...Object.keys(LEG), ...Object.keys(PACK2)])) out[code] = Object.assign({}, LEG[code] || {}, PACK2[code] || {});
  return out;
})();

export function dirOf(code) { const l = LANGS.find((x) => x.code === code); return l ? l.dir : 'ltr'; }
export function langInfo(code) { return LANGS.find((x) => x.code === code) || LANGS[0]; }
