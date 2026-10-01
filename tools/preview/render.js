/**
 * Renders every sheet template with mock data into standalone HTML pages so the
 * UI can be inspected (and screenshotted by Playwright) without a Foundry server.
 *
 * Usage: npm run preview
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Handlebars from 'handlebars';

import { actorContext, weaponContext, refineContext, consumableContext, skillContext, forecastContext, actionMenuContext } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
export const outDir = path.join(here, 'out');

Handlebars.registerHelper('includes', (array, value) => Array.isArray(array) && array.includes(value));
Handlebars.registerHelper('join', (array, separator) => (Array.isArray(array) ? array.join(separator) : ''));
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('add', (a, b) => Number(a ?? 0) + Number(b ?? 0));

// Stand-in for Foundry's built-in helper, used by the generated terrain dropdowns.
Handlebars.registerHelper('selectOptions', (choices, options) => {
  const selected = String(options?.hash?.selected ?? '');
  const markup = Object.entries(choices ?? {})
    .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
    .join('');
  return new Handlebars.SafeString(markup);
});

/** Every window the system can open, with the classes Foundry applies to each. */
export const WINDOWS = [
  {
    slug: 'actor-normal',
    title: 'HoL Character Sheet',
    icon: 'user',
    template: 'character-sheet.html',
    classes: 'actor-sheet character-sheet',
    context: actorContext,
    width: 1100,
    height: 760
  },
  {
    slug: 'actor-battle',
    title: 'HoL Character Sheet (Battle Mode)',
    icon: 'khanda',
    template: 'character-sheet.html',
    classes: 'actor-sheet character-sheet battle-active',
    context: actorContext,
    width: 1100,
    height: 760
  },
  {
    slug: 'weapon',
    title: 'HoL Weapon Sheet',
    icon: 'khanda',
    template: 'weapon-sheet.html',
    classes: 'item-sheet weapon-sheet',
    context: weaponContext,
    width: 720,
    height: 620
  },
  {
    slug: 'weapon-compendium',
    title: 'HoL Weapon Sheet (Compendium)',
    icon: 'khanda',
    template: 'weapon-sheet.html',
    classes: 'item-sheet weapon-sheet compendium-item-readonly',
    context: weaponContext,
    width: 720,
    height: 620,
    disabled: true
  },
  {
    slug: 'refine',
    title: 'HoL Refine Sheet',
    icon: 'gem',
    template: 'refine-sheet.html',
    classes: 'item-sheet refine-sheet',
    context: refineContext,
    width: 720,
    height: 620
  },
  {
    slug: 'consumable',
    title: 'HoL Consumable Sheet',
    icon: 'flask',
    template: 'consumable-sheet.html',
    classes: 'item-sheet consumable-sheet',
    context: consumableContext,
    width: 720,
    height: 620
  },
  {
    slug: 'skill',
    title: 'HoL Skill Sheet',
    icon: 'bolt',
    template: 'skill-sheet.html',
    classes: 'item-sheet skill-sheet',
    context: skillContext,
    width: 720,
    height: 620
  },
  {
    slug: 'combat-forecast',
    title: 'Combat Forecast',
    icon: 'khanda',
    template: 'combat-forecast.html',
    dir: 'apps',
    classes: 'combat-forecast',
    context: forecastContext,
    width: 620,
    height: 460
  },
  {
    slug: 'action-menu',
    title: 'Actions',
    icon: 'bolt',
    template: 'action-menu.html',
    dir: 'apps',
    classes: 'action-menu',
    context: actionMenuContext,
    width: 420,
    height: 640
  }
];

/** Minimal stand-in for the parts of Foundry's application frame our CSS relies on. */
const HARNESS_CSS = `
  * { box-sizing: border-box; }
  /* Freeze transitions so screenshots capture settled state, not mid-animation. */
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
  body {
    margin: 0;
    padding: 24px;
    background: #2b2b2b;
    font-family: "Signika", "Segoe UI", sans-serif;
    font-size: 14px;
  }
  .application {
    display: flex;
    flex-direction: column;
    margin: 0 auto;
    border: 1px solid #000;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.6);
  }
  .window-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 32px;
    padding: 0 10px;
    background: #16181d;
    color: #e8e8e8;
    font-size: 13px;
    font-weight: 600;
  }
  .window-title { flex: 1; }
  .window-content { flex: 1; min-height: 0; }
  .fa-placeholder {
    display: inline-block;
    width: 14px;
    text-align: center;
    opacity: 0.8;
  }
`;

const page = (win, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${win.title}</title>
<link rel="stylesheet" href="/hol.css" />
<style>${HARNESS_CSS}</style>
</head>
<body>
<div class="application heroes-of-lite hol-sheet ${win.classes}" style="width:${win.width}px;height:${win.height}px">
  <header class="window-header">
    <span class="fa-placeholder">&#9670;</span>
    <span class="window-title">${win.title}</span>
    <span class="fa-placeholder">&times;</span>
  </header>
  <div class="window-content standard-form">
${body}
  </div>
</div>
<script type="module">
  // Exercise the real tab controller rather than a copy of it.
  import { activateSheetTabs } from '/dist/modules/helpers.js';
  const root = document.querySelector('.hol-sheet');
  activateSheetTabs({ element: root });

  const hpFill = root.querySelector('.battle-hp-fill');
  if (hpFill) {
    const percent = Number(hpFill.dataset.hpPercent) || 0;
    hpFill.style.width = Math.min(100, Math.max(0, percent)) + '%';
    hpFill.style.backgroundColor = percent > 50 ? '#27824f' : percent > 25 ? '#c98a27' : '#b3362c';
  }

  if (${Boolean(win.disabled)}) {
    root.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
  }

  document.documentElement.dataset.ready = 'true';
</script>
</body>
</html>
`;

const indexPage = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Heroes of Lite - sheet preview</title>
<style>${HARNESS_CSS} body{color:#eee} a{color:#e8d49a;display:block;padding:4px 0}</style>
</head><body>
<h1>Heroes of Lite sheet preview</h1>
${WINDOWS.map(w => `<a href="/tools/preview/out/${w.slug}.html">${w.title}</a>`).join('\n')}
</body></html>
`;

export async function renderPreviews() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const win of WINDOWS) {
    const source = await readFile(path.join(repoRoot, 'templates', win.dir ?? 'sheets', win.template), 'utf8');
    const body = Handlebars.compile(source)(win.context);
    await writeFile(path.join(outDir, `${win.slug}.html`), page(win, body), 'utf8');
  }
  await writeFile(path.join(outDir, 'index.html'), indexPage, 'utf8');
  return WINDOWS.map(win => win.slug);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const slugs = await renderPreviews();
  console.log(`Rendered ${slugs.length} preview pages into ${outDir}`);
}
