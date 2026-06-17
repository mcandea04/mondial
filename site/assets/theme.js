import { mountSegmented } from './segmented.js';

const THEME_KEY = 'theme';

/**
 * Returns the theme currently in effect: the validated saved choice if present,
 * otherwise the device preference. Falls back to 'light' if matchMedia is unavailable.
 * @returns {'light'|'dark'}
 */
export function currentTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  if (typeof matchMedia !== 'undefined') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Mounts a light/dark segmented toggle inside `container`. Persists the choice,
 * sets <html data-theme>, and re-syncs on OS theme change when no explicit
 * choice is stored. Idempotent.
 */
export function mountToggle(container) {
  const { sync } = mountSegmented(
    container,
    'theme',
    [
      { value: 'light', label: '☀', title: 'Temă luminoasă' },
      { value: 'dark', label: '☾', title: 'Temă întunecată' },
    ],
    currentTheme,
    (theme) => {
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    },
  );

  const mq = typeof matchMedia !== 'undefined'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;
  if (mq) {
    mq.addEventListener('change', () => {
      try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') return;
      } catch (_) {}
      sync();
    });
  }
}
