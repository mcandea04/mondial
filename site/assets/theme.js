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
 * Mounts a theme toggle button inside `container`. Idempotent: a second call
 * on the same container is a no-op.
 * @param {HTMLElement} container
 */
export function mountToggle(container) {
  if (container.querySelector('.theme-toggle')) return;

  const btn = document.createElement('button');
  btn.className = 'theme-toggle';
  btn.setAttribute('aria-label', 'Schimbă tema');

  function sync() {
    const dark = currentTheme() === 'dark';
    btn.textContent = dark ? '🌙' : '☀️';
    btn.setAttribute('aria-pressed', String(dark));
  }

  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {}
    sync();
  });

  container.append(btn);
  sync();

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
