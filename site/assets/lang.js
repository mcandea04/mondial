import { mountSegmented } from './segmented.js';

const LANG_KEY = 'lang';

/** The active language: a validated saved choice, else Romanian (the default). */
export function currentLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ro' || saved === 'en') return saved;
  } catch (_) {}
  return 'ro';
}

/**
 * Mounts a RO/EN segmented toggle in `container`. On change it persists the
 * choice, updates <html lang>, and calls onChange(newLang). Idempotent.
 */
export function mountLangToggle(container, onChange) {
  return mountSegmented(
    container,
    'lang',
    [
      { value: 'ro', label: 'RO', title: 'Română' },
      { value: 'en', label: 'EN', title: 'English' },
    ],
    currentLang,
    (lang) => {
      try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
      document.documentElement.lang = lang;
      onChange?.(lang);
    },
  );
}
