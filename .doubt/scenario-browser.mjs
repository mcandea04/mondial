/**
 * Browser checks for the theme toggle feature.
 * Called by scenario.sh with BASE URL as first argument.
 * Exits 0 if all checks pass, 1 otherwise.
 */
// Playwright is installed globally; resolve it regardless of the project's node_modules
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const PLAYWRIGHT_GLOBAL = '/Users/mcandea/.nvm/versions/node/v20.19.4/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PLAYWRIGHT_GLOBAL);

const BASE = process.argv[2];
if (!BASE) { console.error('Usage: node scenario-browser.mjs <base-url>'); process.exit(1); }

let pass = 0, fail = 0;
const ok  = (name) => { console.log('PASS: ' + name); pass++; };
const bad = (name, detail) => { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); fail++; };

const browser = await chromium.launch();

/** Open a page with given colorScheme and optional localStorage seed. */
async function openPage(url, { colorScheme = 'light', storage = {} } = {}) {
  const ctx = await browser.newContext({
    colorScheme,
    storageState: {
      origins: [{
        origin: BASE,
        localStorage: Object.entries(storage).map(([name, value]) => ({ name, value })),
      }],
    },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, ctx };
}

// C1: device-light, no saved choice -> light theme, sun icon, aria-pressed=false
{
  const { page, ctx } = await openPage(BASE + '/index.html', { colorScheme: 'light' });
  await page.waitForSelector('.theme-toggle');
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  const icon      = await page.textContent('.theme-toggle');
  const pressed   = await page.getAttribute('.theme-toggle', 'aria-pressed');
  const label     = await page.getAttribute('.theme-toggle', 'aria-label');
  if (dataTheme !== 'dark' && icon.includes('☀') && pressed === 'false')
    ok('C1 device-light no saved choice: light theme, sun icon, aria-pressed=false');
  else
    bad('C1 device-light no saved choice', `data-theme="${dataTheme}" icon="${icon}" pressed=${pressed}`);
  if (label === 'Schimbă tema')
    ok('C1 aria-label is correct Romanian');
  else
    bad('C1 aria-label wrong', String(label));
  await ctx.close();
}

// C2: device-dark, no saved choice -> dark theme, moon icon, aria-pressed=true
{
  const { page, ctx } = await openPage(BASE + '/index.html', { colorScheme: 'dark' });
  await page.waitForSelector('.theme-toggle');
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  const icon      = await page.textContent('.theme-toggle');
  const pressed   = await page.getAttribute('.theme-toggle', 'aria-pressed');
  if (dataTheme !== 'light' && icon.includes('🌙') && pressed === 'true')
    ok('C2 device-dark no saved choice: dark theme, moon icon, aria-pressed=true');
  else
    bad('C2 device-dark no saved choice', `data-theme="${dataTheme}" icon="${icon}" pressed=${pressed}`);
  await ctx.close();
}

// C3: tap toggle -> theme flips, icon updates, localStorage.theme set
{
  const { page, ctx } = await openPage(BASE + '/index.html', { colorScheme: 'dark' });
  await page.waitForSelector('.theme-toggle');
  await page.click('.theme-toggle');
  const afterClick = {
    dataTheme: await page.evaluate(() => document.documentElement.dataset.theme),
    icon:      await page.textContent('.theme-toggle'),
    pressed:   await page.getAttribute('.theme-toggle', 'aria-pressed'),
    stored:    await page.evaluate(() => localStorage.getItem('theme')),
  };
  if (afterClick.dataTheme === 'light' && afterClick.icon.includes('☀') &&
      afterClick.pressed === 'false' && afterClick.stored === 'light')
    ok('C3 tap toggle dark->light: data-theme=light, sun, aria-pressed=false, localStorage=light');
  else
    bad('C3 tap toggle dark->light', JSON.stringify(afterClick));

  await page.click('.theme-toggle');
  const afterSecond = {
    dataTheme: await page.evaluate(() => document.documentElement.dataset.theme),
    icon:      await page.textContent('.theme-toggle'),
    pressed:   await page.getAttribute('.theme-toggle', 'aria-pressed'),
    stored:    await page.evaluate(() => localStorage.getItem('theme')),
  };
  if (afterSecond.dataTheme === 'dark' && afterSecond.icon.includes('🌙') &&
      afterSecond.pressed === 'true' && afterSecond.stored === 'dark')
    ok('C3 tap toggle light->dark: data-theme=dark, moon, aria-pressed=true, localStorage=dark');
  else
    bad('C3 tap toggle light->dark', JSON.stringify(afterSecond));
  await ctx.close();
}

// C4: reload with saved choice -> correct theme applied; no-flash inline script before stylesheet
{
  const { page, ctx } = await openPage(BASE + '/index.html', {
    colorScheme: 'dark',
    storage: { theme: 'light' },
  });
  await page.waitForSelector('.theme-toggle');
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const icon      = await page.textContent('.theme-toggle');
  if (dataTheme === 'light' && icon.includes('☀'))
    ok('C4 saved choice wins on reload: data-theme=light, sun icon (device is dark)');
  else
    bad('C4 saved choice on reload', `data-theme="${dataTheme}" icon="${icon}"`);

  const headHTML       = await page.evaluate(() => document.head.innerHTML);
  const scriptIdx      = headHTML.indexOf("localStorage.getItem('theme')");
  const stylesheetIdx  = headHTML.indexOf('<link rel="stylesheet"');
  if (scriptIdx !== -1 && scriptIdx < stylesheetIdx)
    ok('C4 no-flash inline script appears in <head> before the stylesheet link');
  else
    bad('C4 no-flash script placement', `scriptIdx=${scriptIdx} stylesheetIdx=${stylesheetIdx}`);
  await ctx.close();
}

// C5: cross-page persistence: saved dark persists on both index and arhiva
{
  const { page, ctx } = await openPage(BASE + '/index.html', {
    colorScheme: 'light',
    storage: { theme: 'dark' },
  });
  await page.waitForSelector('.theme-toggle');
  const indexTheme = await page.evaluate(() => document.documentElement.dataset.theme);

  await page.goto(BASE + '/arhiva.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.theme-toggle');
  const arhivaTheme  = await page.evaluate(() => document.documentElement.dataset.theme);
  const arhivaIcon   = await page.textContent('.theme-toggle');
  const arhivaStored = await page.evaluate(() => localStorage.getItem('theme'));

  if (indexTheme === 'dark' && arhivaTheme === 'dark' &&
      arhivaIcon.includes('🌙') && arhivaStored === 'dark')
    ok('C5 cross-page: saved dark persists on both index and arhiva');
  else
    bad('C5 cross-page persistence', `index=${indexTheme} arhiva=${arhivaTheme} icon=${arhivaIcon} stored=${arhivaStored}`);
  await ctx.close();
}

// C6: clear localStorage -> follows device (device-light, no key -> sun icon, no data-theme=dark)
{
  const ctx = await browser.newContext({
    colorScheme: 'light',
    storageState: { origins: [{ origin: BASE, localStorage: [] }] },
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.theme-toggle');
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  const icon      = await page.textContent('.theme-toggle');
  if (dataTheme !== 'dark' && icon.includes('☀'))
    ok('C6 cleared localStorage: follows device-light, sun icon');
  else
    bad('C6 cleared localStorage', `data-theme="${dataTheme}" icon="${icon}"`);
  await ctx.close();
}

// C7: error/loading state (missing latest.json) -> toggle still present in topbar
{
  const { page, ctx } = await openPage(BASE + '/index.html', { colorScheme: 'light' });
  await page.route('**/data/latest.json', (route) => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const toggleExists = await page.isVisible('.theme-toggle');
  const errorMsg     = await page.isVisible('.empty-state');
  if (toggleExists && errorMsg)
    ok('C7 error/loading state: toggle present in topbar, error message shown');
  else
    bad('C7 error/loading state', `toggleExists=${toggleExists} errorMsg=${errorMsg}`);
  await ctx.close();
}

// C8: stale value 'auto' -> ignored, follows device (device-light -> sun, no data-theme=dark)
{
  const { page, ctx } = await openPage(BASE + '/index.html', {
    colorScheme: 'light',
    storage: { theme: 'auto' },
  });
  await page.waitForSelector('.theme-toggle');
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  const icon      = await page.textContent('.theme-toggle');
  if (dataTheme !== 'dark' && icon.includes('☀'))
    ok('C8 stale value "auto" ignored: follows device-light, sun icon');
  else
    bad('C8 stale value ignored', `data-theme="${dataTheme}" icon="${icon}"`);
  await ctx.close();
}

// Idempotency: double mountToggle call leaves exactly one toggle button
{
  const { page, ctx } = await openPage(BASE + '/index.html', { colorScheme: 'light' });
  await page.waitForSelector('.theme-toggle');
  const count = await page.evaluate(async () => {
    const topbar = document.getElementById('topbar');
    const m = await import('./assets/theme.js');
    m.mountToggle(topbar);
    m.mountToggle(topbar);
    return topbar.querySelectorAll('.theme-toggle').length;
  });
  if (count === 1)
    ok('Idempotency: double mountToggle call leaves exactly one toggle button');
  else
    bad('Idempotency: double mountToggle produced multiple buttons', 'count=' + count);
  await ctx.close();
}

// Structural: arhiva toggle is inside .meta, not inside #app
{
  const { page, ctx } = await openPage(BASE + '/arhiva.html', { colorScheme: 'light' });
  await page.waitForSelector('.meta .theme-toggle');
  const inMeta = await page.isVisible('.meta .theme-toggle');
  const inApp  = await page.evaluate(() => !!document.querySelector('#app .theme-toggle'));
  if (inMeta && !inApp)
    ok('Structural: arhiva toggle is inside .meta, not inside #app');
  else
    bad('Structural: arhiva toggle location wrong', `inMeta=${inMeta} inApp=${inApp}`);
  await ctx.close();
}

await browser.close();

console.log(`SUMMARY ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
