#!/usr/bin/env node
/* Cloud Patrol smoke test — drives a real headless run.
 *
 *   cd arcade/cloud-patrol && node smoketest.js      # ~40s
 *
 * Boots the title screen, walks the locker and how-to, flies a run (moving and
 * firing), forces a boss, fires every secret code, then dies on purpose and
 * checks a result came out with a score and tokens. Fails on any console error.
 * Screenshots land in ./shots/ (gitignored).
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/cloud-patrol/index.html`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\/me|404/.test(m.text())) errors.push(m.text()); });

  await page.goto(base);
  await page.waitForFunction(() => window.cloudPatrol, null, { timeout: 20000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(SHOTS, '01-title.png') });
  check((await page.evaluate(() => window.cloudPatrol.state.screen)) === 'title', 'boots to the title screen');

  await page.click('button[data-a="locker"]');
  await sleep(600);
  const fits = await page.$$eval('.cp-fit', (n) => n.length);
  check(fits >= 6, `locker lists every outfit (${fits})`);
  await page.hover('.cp-fit:nth-child(2)');
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '02-locker.png') });
  await page.click('.cp-screen.on button[data-a="back"]');
  await page.click('button[data-a="howto"]');
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, '03-howto.png') });
  await page.click('.cp-screen.on button[data-a="back"]');

  // secrets, typed on the title screen
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
  await sleep(300);
  check((await page.evaluate(() => window.cloudPatrol.profile.unlocked.includes('mega'))), 'Konami code unlocks Mega CostBot');
  await page.keyboard.type('graviton');
  await sleep(300);
  check((await page.evaluate(() => window.cloudPatrol.profile.outfit)) === 'graviton', 'typing "graviton" equips Graviton Green');
  await sleep(800);
  await page.screenshot({ path: path.join(SHOTS, '04-secret.png') });

  // fly a run
  await page.click('button[data-a="play"]');
  await sleep(500);
  check((await page.evaluate(() => window.cloudPatrol.state.screen)) === 'play', 'Play starts a run');
  await page.keyboard.down(' ');
  await page.keyboard.down('ArrowLeft');
  await sleep(1500);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  await sleep(1200);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Shift');
  await page.keyboard.type('finops');
  await sleep(2500);
  await page.screenshot({ path: path.join(SHOTS, '05-flight.png') });
  const s1 = await page.evaluate(() => window.cloudPatrol.state.run);
  check(s1 && s1.things > 0, `waste and coins are spawning (${s1 && s1.things} on screen)`);
  // things take a few seconds to reach him, and headless frames are slow
  await page.waitForFunction(() => window.cloudPatrol.state.run && window.cloudPatrol.state.run.score > 0, null, { timeout: 15000 }).catch(() => {});
  const s1b = await page.evaluate(() => window.cloudPatrol.state.run);
  check(s1b && s1b.score > 0, `score is counting (${s1b && Math.round(s1b.score)})`);
  check((await page.evaluate(() => window.cloudPatrol.state.screen)) === 'play', 'typing a secret mid-run does not pause');

  // boss: reload straight into a run with the boss due in 2s
  await page.keyboard.up(' ');
  await page.goto(`${base}?play=1&boss=1`);
  await page.waitForFunction(() => window.cloudPatrol && window.cloudPatrol.state.screen === 'play', null, { timeout: 20000 });
  await page.keyboard.down(' ');
  await page.waitForFunction(() => window.cloudPatrol.state.run && window.cloudPatrol.state.run.boss, null, { timeout: 15000 }).catch(() => {});
  await sleep(3500);
  await page.screenshot({ path: path.join(SHOTS, '06-boss.png') });
  const s2 = await page.evaluate(() => window.cloudPatrol.state.run);
  check(!!(s2 && s2.boss), `a vendor boss shows up (${s2 && s2.boss})`);

  // pause / resume
  await page.keyboard.press('Escape');
  await sleep(300);
  check((await page.evaluate(() => window.cloudPatrol.state.screen)) === 'paused', 'Esc pauses');
  await page.screenshot({ path: path.join(SHOTS, '07-paused.png') });
  await page.keyboard.press('Escape');

  // die on purpose: stop dodging and wait for the bill to land (or quit after 40s)
  await page.keyboard.up(' ');
  const died = await page.waitForFunction(() => window.cloudPatrol.state.screen === 'over', null, { timeout: 40000 }).then(() => true).catch(() => false);
  if (!died) { await page.keyboard.press('Escape'); await page.click('button[data-a="quit"]'); }
  await sleep(800);
  await page.screenshot({ path: path.join(SHOTS, '08-results.png') });
  check((await page.evaluate(() => window.cloudPatrol.state.screen)) === 'over', `run ends on the results screen (${died ? 'died' : 'quit'})`);
  const prof = await page.evaluate(() => window.cloudPatrol.profile);
  check(prof.runs >= 1, `the run is recorded in the profile (runs ${prof.runs}, best ${prof.best})`);

  check(errors.length === 0, `no console errors${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
