/* Headless smoke test for CostBot Mudsliders.
 * Boots the game, drives a real run, forces a Mudslide power-up and a wipeout,
 * screenshots each screen and fails on any console error.
 *   node smoketest.js
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');   // serve the arcade so ../shared/ resolves
const OUT = path.join(DIR, 'shots');
const PORT = 8793;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

const fail = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail.push(name);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  // ArcadeSync deliberately probes /api/me and disables itself when nothing
  // answers, so that one 404 is the healthy static-hosting path, not a failure.
  // The console message text does not carry the URL — match on the location.
  const EXPECTED = /api\/me/;
  page.on('console', (m) => {
    const url = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !EXPECTED.test(url) && !EXPECTED.test(m.text())) {
      errors.push('CONSOLE: ' + m.text() + ' @ ' + url);
    }
  });
  page.on('requestfailed', (r) => {
    if (!/api\/me/.test(r.url())) errors.push('REQFAIL: ' + r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/api\/me/.test(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  await page.goto(`http://localhost:${PORT}/mudsliders/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game && window.game.img);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '01-title.png') });

  // the sprite has to actually load — a broken path here is silent on canvas
  const art = await page.evaluate(() => {
    const im = window.game.img.mudslide;
    return { complete: im.complete, w: im.naturalWidth, src: im.src };
  });
  check('mudslide sprite loads', art.complete && art.w > 0, art.src);

  const heroGlass = await page.evaluate(() => {
    const el = document.querySelector('.ms-glass');
    return el ? { w: el.naturalWidth, src: el.src } : null;
  });
  check('title screen shows the glass', !!heroGlass && heroGlass.w > 0);

  // --- drive a run ---------------------------------------------------------
  await page.evaluate(() => window.game.start());
  await page.waitForTimeout(1400);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');   // slide — the splashiest state
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(OUT, '02-slide.png') });

  const spray = await page.evaluate(() => ({
    drops: window.game.run.spray.length,
    ripples: window.game.run.ripples.length,
  }));
  check('mud spray is emitting', spray.drops > 20, `${spray.drops} drops`);
  check('wake ripples are emitting', spray.ripples > 2, `${spray.ripples} ripples`);

  await page.keyboard.press('ArrowUp');     // jump, then land -> landing burst
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '03-air.png') });

  // --- the Mudslide power-up ------------------------------------------------
  const shield = await page.evaluate(() => {
    const g = window.game;
    // The drive above is a real, unshielded run and may well have ended on a
    // hazard by now. From here the test needs a clear hill, so: fresh run if
    // needed, no further rows, and nothing already on the road.
    if (!g.run || g.run.over) g.start();
    g.spawnRow = () => {};
    g.run.objs = g.run.objs.filter((o) => o.kind !== 'obs');
    g.run.shields = 0;
    g.run.objs.push({ kind: 'pow', id: 'mudslide', lane: g.run.lane, z: g.run.z + 300, got: false });
    return new Promise((res) => setTimeout(() => res({
      shields: g.run.shields, over: g.run.over, drops: g.run.spray.length,
    }), 900));
  });
  check('Mudslide power-up banks a shield', shield.shields === 1, JSON.stringify(shield));

  // park one in front of the camera so the screenshot has it on screen
  await page.evaluate(() => {
    const g = window.game;
    g.run.objs.push({ kind: 'pow', id: 'mudslide', lane: 1, z: g.run.z + 620, got: false });
  });
  await page.waitForTimeout(280);
  await page.screenshot({ path: path.join(OUT, '04-powerup.png') });

  // --- wipeout --------------------------------------------------------------
  await page.evaluate(() => {
    const g = window.game;
    g.run.shields = 0;
    g.run.invuln = 0;
    g.crash(window.MS_CONTENT.OBSTACLES.idle_ec2);
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, '05-over.png') });
  check('wipeout screen renders', await page.locator('.ms-panel').count() === 1);

  // --- the soundtrack -------------------------------------------------------
  const music = await page.evaluate(() => {
    const T = window.ArcadeMusic.TRACKS.mudslide;
    const bars = T.bars;
    return {
      bars,
      leadSteps: T.lead.length,
      progBars: T.prog.length,
      seconds: +(bars * 16 * (60 / T.bpm / 4)).toFixed(1),
      leadInRange: T.lead.every((n) => n === null || (n > 40 && n < 108)),
      breakInRange: T.breakBars.every((b) => b < bars),
      fillInRange: T.fillBar < bars,
    };
  });
  check('16-bar loop', music.bars === 16 && music.progBars === 16);
  check('lead covers every bar', music.leadSteps === music.bars * 16, `${music.leadSteps} steps`);
  check('lead notes in range', music.leadInRange);
  check('break/fill bars in range', music.breakInRange && music.fillInRange);
  console.log(`        loop length: ${music.seconds}s`);

  // every other track must still resolve — the engine changes are shared
  const tracks = await page.evaluate(() => Object.keys(window.ArcadeMusic.TRACKS)
    .map((k) => {
      const t = window.ArcadeMusic.TRACKS[k];
      return { k, ok: !!t.prog && !!t.bpm && (!t.lead || t.lead.length % 16 === 0) };
    }).filter((t) => !t.ok).map((t) => t.k));
  check('all tracks still well-formed', tracks.length === 0, tracks.join(','));

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  server.close();
  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall checks passed');
  process.exit(fail.length ? 1 : 0);
})();
