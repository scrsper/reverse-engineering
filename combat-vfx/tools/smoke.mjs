// Headless smoke test: loads the playground, plays every recipe, fails on any console / shader error,
// and writes screenshots of each effect mid-flight.
//   node tools/smoke.mjs [outDir] [--elements fire,ice,...]
// Needs: npm install (three, playwright-core) and a Chromium headless shell (CHROMIUM_PATH, else found under /opt/pw-browsers).
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) || join(root, 'smoke-out'));
const elIdx = args.indexOf('--elements');
const elements = elIdx >= 0 ? args[elIdx + 1].split(',') : ['fire', 'ice', 'lightning', 'holy', 'dark', 'poison'];

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  const dir = existsSync(base) && readdirSync(base).find((d) => /^chromium_headless_shell-\d+$/.test(d));
  return dir ? join(base, dir, 'chrome-linux', 'headless_shell') : undefined;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.169.0/';

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// serve the project from a fake origin and three.js from node_modules (no network needed)
await page.route('**/*', async (route) => {
  const url = route.request().url();
  let file;
  if (url.startsWith(THREE_CDN)) file = join(root, 'node_modules/three', url.slice(THREE_CDN.length));
  else if (url.startsWith('http://vfx.local/')) file = join(root, new URL(url).pathname);
  else return route.abort();
  try { await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); }
  catch { await route.fulfill({ status: 404, body: 'not found' }); }
});

await page.goto('http://vfx.local/index.html');
await page.waitForFunction(() => window.__demo, null, { timeout: 30000 });
await page.evaluate(() => { __demo.stopLoop(); __demo.clearEnemies(); __demo.setZoom(0.55); __demo.tick(5); });

// [recipe, seconds into the effect to capture]
const SHOTS = [['slash', 0.12], ['hit', 0.08], ['thunder', 0.16], ['hammer', 0.38], ['hammer', 0.55], ['hammer', 1.4], ['shield', 0.8], ['aura', 0.8], ['dust', 0.15]];
let maxLive = 0;
for (const el of elements) {
  for (const [name, at] of SHOTS) {
    const live = await page.evaluate(([el, name, at]) => {
      __demo.setElement(el);
      for (const fx of [...__demo.vfx.live]) fx.dispose();
      __demo.vfx.live.clear();
      __demo.preview(name);
      __demo.tick(Math.round(at * 60));
      return __demo.vfx.live.size;
    }, [el, name, at]);
    maxLive = Math.max(maxLive, live);
    await page.screenshot({ path: join(outDir, `${el}-${name}-${at}.png`) });
  }
}

// every one-shot must finish and be disposed; looping ones must stop on request
const leftover = await page.evaluate(() => {
  __demo.vfx.stopAll(); __demo.tick(60 * 5);
  return [...__demo.vfx.live].map((f) => f.name);
});

await browser.close();
const problems = [...errors];
if (leftover.length) problems.push(`effects still alive after stopAll + 5 s: ${leftover.join(', ')}`);
if (maxLive === 0) problems.push('no effect was ever live');
console.log(`screenshots: ${outDir}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`ok: ${elements.length} elements × ${SHOTS.length} shots, no console errors`);
