/**
 * Opens every rendered sheet preview in Chromium, clicks through each tab,
 * captures screenshots and reports layout problems (console errors, horizontal
 * overflow, clipped content, tabs that fail to switch).
 *
 * Usage: npm run test:ui
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { renderPreviews, WINDOWS } from './render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const shotDir = path.join(here, 'screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

/** Serve the repository over HTTP so the preview pages can import ES modules. */
function startServer() {
  const server = createServer(async (req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = path.join(repoRoot, requested);

    // Refuse anything that escapes the repository root.
    if (!filePath.startsWith(repoRoot)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Launch Chromium, falling back to a locally installed Edge/Chrome when the
 * bundled browser has not been downloaded (common behind a TLS-inspecting proxy).
 */
async function launchBrowser() {
  const attempts = [undefined, 'msedge', 'chrome'];
  let lastError;
  for (const channel of attempts) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to launch a Chromium browser. Run "npx playwright install chromium".\n${lastError}`);
}

async function run() {
  await renderPreviews();
  await mkdir(shotDir, { recursive: true });

  const { server, port } = await startServer();
  const browser = await launchBrowser();
  const failures = [];

  try {
    for (const win of WINDOWS) {
      const page = await browser.newPage({ viewport: { width: win.width + 60, height: win.height + 100 } });
      const consoleErrors = [];
      page.on('pageerror', error => consoleErrors.push(String(error)));
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      // The harness has no favicon; that 404 is noise, not a sheet problem.
      page.route('**/favicon.ico', route => route.fulfill({ status: 200, body: '' }));

      await page.goto(`http://127.0.0.1:${port}/tools/preview/out/${win.slug}.html`);
      await page.waitForSelector('html[data-ready="true"]');

      // Battle mode hides the tab bar entirely, so only walk tabs that are on screen.
      const allTabs = await page.locator('.sheet-tabs .item').all();
      const tabs = [];
      for (const tab of allTabs) {
        if (await tab.isVisible()) tabs.push(tab);
      }

      // Visit every tab so each panel is screenshotted and measured.
      if (tabs.length) {
        for (const [index, tab] of tabs.entries()) {
          const tabId = await tab.getAttribute('data-tab');
          await tab.click();
          const isActive = await page.locator(`.tab[data-tab="${tabId}"]`).first().evaluate(
            el => el.classList.contains('active') && el.offsetParent !== null
          );
          if (!isActive) failures.push(`${win.slug}: tab "${tabId}" did not activate`);

          // The selected tab must be visually distinguishable from the rest.
          const contrast = await page.evaluate(selected => {
            const items = [...document.querySelectorAll('.sheet-tabs .item')]
              .filter(el => el.offsetParent !== null);
            const active = items.filter(el => el.classList.contains('active'));
            if (active.length !== 1) return `${active.length} tabs marked active`;
            const activeBg = getComputedStyle(active[0]).backgroundColor;
            const sameAsInactive = items
              .filter(el => !el.classList.contains('active'))
              .some(el => getComputedStyle(el).backgroundColor === activeBg);
            return sameAsInactive ? `tab "${selected}" looks identical to inactive tabs` : null;
          }, tabId);
          if (contrast) failures.push(`${win.slug}: ${contrast}`);

          await page.screenshot({ path: path.join(shotDir, `${win.slug}-${index}-${tabId}.png`) });
        }
      } else {
        await page.screenshot({ path: path.join(shotDir, `${win.slug}.png`) });
      }

      const layout = await page.evaluate(() => {
        const root = document.querySelector('.hol-sheet');
        const problems = [];
        if (root.scrollWidth > root.clientWidth + 1) {
          problems.push(`sheet overflows horizontally by ${root.scrollWidth - root.clientWidth}px`);
        }
        for (const el of root.querySelectorAll('input, select, .total, .charge-value')) {
          if (el.offsetParent === null) continue;
          if (el.scrollWidth > el.clientWidth + 2) {
            problems.push(`clipped control: ${el.name || el.className || el.tagName}`);
          }
        }
        return problems;
      });
      layout.forEach(problem => failures.push(`${win.slug}: ${problem}`));
      consoleErrors.forEach(error => failures.push(`${win.slug}: console error - ${error}`));

      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.error('\nUI check failures:');
    failures.forEach(failure => console.error(`  - ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${WINDOWS.length} sheet windows rendered cleanly. Screenshots: ${shotDir}`);
  }
}

await run();
