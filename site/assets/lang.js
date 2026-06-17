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
 * Mounts a RO/EN toggle button in `container`. On change it persists the choice,
 * updates <html lang>, and calls onChange(newLang). Idempotent: a second call on
 * the same container is a no-op.
 */
export function mountLangToggle(container, onChange) {
  if (container.querySelector('.lang-toggle')) return;

  const btn = document.createElement('button');
  btn.className = 'lang-toggle';
  btn.setAttribute('aria-label', 'Change language / Schimbă limba');

  function sync() {
    const lang = currentLang();
    // Button shows the language you'd switch TO.
    btn.textContent = lang === 'ro' ? 'EN' : 'RO';
    btn.setAttribute('aria-pressed', String(lang === 'en'));
    document.documentElement.lang = lang;
  }

  btn.addEventListener('click', () => {
    const next = currentLang() === 'ro' ? 'en' : 'ro';
    try { localStorage.setItem(LANG_KEY, next); } catch (_) {}
    sync();
    onChange?.(next);
  });

  container.append(btn);
  sync();
}
