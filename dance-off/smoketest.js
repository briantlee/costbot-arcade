#!/usr/bin/env node
/* Dance Off! smoke test — drives two real headless dance-offs.
 *
 *   cd arcade/dance-off && node smoketest.js      # ~4 min (three full songs, in real time)
 *
 * Run 1 is a bot that dances every move back on its beat: the squad has to get the
 * invoice out and the run has to end 'clear'. Run 2 dances every other move: Ronin
 * has to look round, spot the squad and end it 'fail'. Run 3 is the perfect bot on a
 * CostBot Hero song danced in half-time on Hard, so the chart generator and the tempo
 * mapping get a song that is not the default. Runs 1 and 2 play the default song, the
 * Awesome Medley, so a freshly rolled mix is exercised every time.
 * Fails on any console error
 * (the /api/me 404 on static hosting is the healthy path, and is ignored).
 * Screenshots land in ./shots/ (gitignored).
 *
 * Playwright: the same install the other cabinets' tests use, or any `playwright` /
 * `playwright-core` on the require path. CHROME=/path/to/chrome overrides the browser.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  for (const id of ['/home/briant/node_modules/playwright', 'playwright', 'playwright-core']) {
    try { return require(id); } catch { /* next */ }
  }
  console.error('playwright not found — npm i playwright (or playwright-core with CHROME=...)');
  process.exit(2);
}
const { chromium } = loadPlaywright();

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

async function dance(browser, port, mode, setup = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  if (setup) await page.addInitScript((st) => { localStorage.setItem('costbot.danceoff.v1', JSON.stringify(st)); }, setup);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/api/me')) errors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/dance-off/index.html`);
  await page.waitForFunction(() => window.game && window.game.phase === 'title', null, { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, `${mode}-title.png`) });
  await page.click('[data-act="start"]');
  // the bot: press each note's move as its beat arrives (every other one, to lose) —
  // sneak notes take any key, so the move's own key does for both
  await page.evaluate((m) => {
    let n = 0;
    const tick = () => {
      const g = window.game, run = g.run;
      if (run) {
        const b = g.beat();
        for (const note of run.notes) {
          if (note.judged || note._sent || b < note.beat - 0.02) continue;
          note._sent = true; n += 1;
          if (m === 'win' || n % 2 === 0) g.hit(note.move);
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  }, mode);
  await sleep(14000);
  await page.screenshot({ path: path.join(SHOTS, `${mode}-play.png`) });
  const result = await page.evaluate(() => new Promise((resolve) => {
    const iv = setInterval(() => { if (window.game.phase === 'over') { clearInterval(iv); resolve(window.game.profile); } }, 250);
  }));
  const title = await page.textContent('.do-otitle');
  await page.screenshot({ path: path.join(SHOTS, `${mode}-over.png`) });
  await page.close();
  return { result, errors, title };
}

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const win = await dance(browser, port, 'win');
    check(win.result.wins === 1, `perfect bot pulls off the heist (wins=${win.result.wins}, best=${win.result.best})`);
    check(win.result.best > 0 && win.result.bestCombo >= 8, `perfect bot scores and combos (combo ${win.result.bestCombo})`);
    check(win.errors.length === 0, `no console errors on the win run ${win.errors.slice(0, 3).join(' | ')}`);
    const lose = await dance(browser, port, 'lose');
    check(lose.result.wins === 0 && lose.result.runs === 1, `half-right bot is caught or runs out of song (runs=${lose.result.runs}, wins=${lose.result.wins})`);
    check(lose.errors.length === 0, `no console errors on the lose run ${lose.errors.slice(0, 3).join(' | ')}`);
    const hero = await dance(browser, port, 'win', { song: 'ch_underthegcp', diff: 'hard' });
    const rec = hero.result.songs && hero.result.songs['ch_underthegcp:hard'];
    check(hero.result.wins === 1 && rec && rec.best > 0, `perfect bot clears a half-time Hero song on Hard (best=${rec && rec.best})`);
    check(hero.errors.length === 0, `no console errors on the Hero-song run ${hero.errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    check(false, `run crashed: ${e.message}`);
  }
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
});
