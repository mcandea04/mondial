/* Framework-free segmented control. Renders a rounded track of toggle buttons;
   the active one is filled (.is-active, aria-pressed=true). Used by lang.js and
   theme.js, which own the storage; this module owns only the DOM. */

/** The value a click should select, or null if the clicked segment is already active. */
export function nextOnClick(clickedValue, activeValue) {
  return clickedValue === activeValue ? null : clickedValue;
}

/**
 * Mounts a segmented control in `container`. Idempotent per (container, className):
 * a second mount for the same className returns a { sync } bound to the existing DOM.
 * @param {HTMLElement} container
 * @param {string} className - distinct per control (e.g. 'lang', 'theme')
 * @param {Array<{value:string,label:string,title:string}>} options
 * @param {() => string} getActive - getter re-read on every sync
 * @param {(value:string) => void} onSelect - called only when the choice changes
 * @returns {{ sync: () => void }}
 */
export function mountSegmented(container, className, options, getActive, onSelect) {
  const existing = container.querySelector('.segmented.' + className);
  if (existing) {
    return { sync: () => paint(existing, getActive()) };
  }

  const group = document.createElement('div');
  group.className = 'segmented ' + className;

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segment';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.title = opt.title;
    btn.setAttribute('aria-label', opt.title);
    btn.addEventListener('click', () => {
      const next = nextOnClick(opt.value, getActive());
      if (next === null) return;
      onSelect(next);
      paint(group, getActive());
    });
    group.append(btn);
  }

  container.append(group);
  const sync = () => paint(group, getActive());
  sync();
  return { sync };
}

function paint(group, activeValue) {
  for (const btn of group.querySelectorAll('.segment')) {
    const active = btn.dataset.value === activeValue;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}
