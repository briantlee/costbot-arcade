/* Headless smoke test for CostBot Mudslides.
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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json' };

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

  await page.goto(`http://localhost:${PORT}/mudslides/index.html`, { waitUntil: 'networkidle' });
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

  // The player sprite is a rear view drawn behind the camera's shoulder. If it
  // fails to decode the bot silently falls back to the front-facing arcade art,
  // which looks almost right and would never be noticed.
  const slider = await page.evaluate(() => {
    const im = window.game.img.slider;
    return { complete: im.complete, w: im.naturalWidth, src: im.src };
  });
  check('rear-view slider sprite loads', slider.complete && slider.w > 0, slider.src);

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
  // the early-warning rectangle around approaching hazards is gone for good
  const noWarnBox = await page.evaluate(() => {
    const g = window.game;
    return !('earlyWarn' in g.run.perks)
      && !/strokeRect/.test(g.drawObstacle.toString());
  });
  check('no warning box around obstacles', noWarnBox);
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

  // --- how to play ----------------------------------------------------------
  await page.evaluate(() => window.game.screenBriefing());
  await page.waitForTimeout(160);
  await page.screenshot({ path: path.join(OUT, '05-howto.png') });
  const brief = await page.evaluate(() => {
    const C = window.MS_CONTENT;
    const txt = document.querySelector('.ms-brief').innerText;
    return {
      sections: document.querySelectorAll('.ms-brief section').length,
      powersListed: Object.keys(C.POWERUPS).filter((k) => txt.includes(C.POWERUPS[k].name)).length,
      powersTotal: Object.keys(C.POWERUPS).length,
      tokensListed: Object.keys(C.TOKENS).filter((k) => txt.includes(C.TOKENS[k].name)).length,
      tokensTotal: Object.keys(C.TOKENS).length,
      saysShield: /shield/i.test(txt),
      saysMudslide: /Mudslide/.test(txt),
      stale: /module|Ultimate FinOps App|build the app|RI Shield/i.test(document.body.innerText),
      shields: Object.keys(C.POWERUPS).filter((k) => C.POWERUPS[k].dur === 0).length,
      shieldNames: Object.keys(C.POWERUPS).filter((k) => C.POWERUPS[k].dur === 0).join(','),
    };
  });
  check('briefing has all four sections', brief.sections === 4);
  check('briefing lists every power-up', brief.powersListed === brief.powersTotal,
    `${brief.powersListed}/${brief.powersTotal}`);
  check('briefing lists every token', brief.tokensListed === brief.tokensTotal,
    `${brief.tokensListed}/${brief.tokensTotal}`);
  check('briefing explains the Mudslide shield', brief.saysShield && brief.saysMudslide);
  check('the Mudslide is the only shield', brief.shields === 1, brief.shieldNames);
  check('no app-building copy left', !brief.stale);
  const briefFits = await page.evaluate(() => {
    const s = document.querySelector('.ms-screen');
    return { scroll: s.scrollHeight, view: s.clientHeight };
  });
  check('briefing fits without scrolling', briefFits.scroll <= briefFits.view,
    `${briefFits.scroll} / ${briefFits.view}`);

  // Every vendor has to put SOMETHING on its sign — a real mark where one exists,
  // a monogram badge where the vendor publishes none.
  const marks = await page.evaluate(() => {
    const g = window.game;
    const c = document.createElement('canvas').getContext('2d');
    return window.MS_CONTENT.VENDORS.map((v) => ({
      name: v.name,
      drew: g.drawVendorMark(c, v, 40, 40, 40),
      real: !!g.vendorIcon(v),
      claimsPath: !!v.path,
    }));
  });
  check('every vendor sign draws a mark', marks.every((m) => m.drew),
    marks.filter((m) => !m.drew).map((m) => m.name).join(','));
  check('every declared path parses', marks.every((m) => m.real === m.claimsPath),
    marks.filter((m) => m.claimsPath && !m.real).map((m) => m.name).join(','));
  console.log(`        marks: ${marks.filter((m) => m.real).length} real, `
    + `${marks.filter((m) => !m.real).length} monogram`);

  // --- achievements ---------------------------------------------------------
  await page.evaluate(() => {
    window.game.unlock('ms_first');   // deterministic: one earned, the rest locked
    window.game.screenAchievements();
  });
  await page.waitForTimeout(140);
  await page.screenshot({ path: path.join(OUT, '07-achievements.png') });
  const achs = await page.evaluate(() => {
    const C = window.MS_CONTENT;
    const txt = document.querySelector('.ms-achs').innerText;
    return {
      tiles: document.querySelectorAll('.ms-ach').length,
      total: C.ACHIEVEMENTS.length,
      earned: document.querySelectorAll('.ms-ach.on').length,
      allNamed: C.ACHIEVEMENTS.every((a) => txt.includes(a.name)),
      fits: (() => { const s = document.querySelector('.ms-screen');
        return s.scrollHeight <= s.clientHeight; })(),
    };
  });
  check('every achievement has a tile', achs.tiles === achs.total, `${achs.tiles}/${achs.total}`);
  check('achievement names all render', achs.allNamed);
  check('earned ones are lit', achs.earned === 1, `${achs.earned} earned`);
  check('unearned ones stay locked', achs.tiles - achs.earned === achs.total - 1);
  check('achievements screen fits', achs.fits);

  // --- leaderboard ----------------------------------------------------------
  // No API on the static harness, so this exercises the local-history fallback.
  // Seeded rather than relying on whether the drive above happened to wipe out.
  await page.evaluate(() => {
    window.game.profile.history = [
      { t: 1785600000000, tokens: 100, distance: 500, nearMisses: 2, topSpeed: 1200 },
      { t: 1785600000000, tokens: 300, distance: 200, nearMisses: 9, topSpeed: 2500 },
      { t: 1785600000000, tokens: 50, distance: 1900, nearMisses: 0, topSpeed: 2900 },
    ];
    window.game.screenBoard();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '08-board.png') });
  const board = await page.evaluate(() => ({
    cols: [...document.querySelectorAll('.ms-board th.n')].map((t) => t.textContent.trim()),
    rows: document.querySelectorAll('.ms-board tbody tr').length,
    empty: !!document.querySelector('.ms-board-empty'),
    sorted: document.querySelector('.ms-board th.n.on').dataset.sort,
  }));
  check('board has all four metrics', board.cols.length === 4, board.cols.join(' | '));
  check('board shows the run history', board.rows === 3 && !board.empty, `${board.rows} rows`);
  check('board defaults to tokens', board.sorted === 'tokens');

  // clicking a header must actually re-rank, not just highlight
  const resorted = await page.evaluate(async () => {
    const th = [...document.querySelectorAll('.ms-board th.n')]
      .find((t) => t.dataset.sort === 'distance');
    th.click();
    await new Promise((r) => setTimeout(r, 120));
    const col = [...document.querySelectorAll('.ms-board tbody tr')]
      .map((tr) => Number(tr.children[3].textContent.replace(/[^0-9]/g, '')));
    return { sorted: document.querySelector('.ms-board th.n.on').dataset.sort, col };
  });
  check('clicking a column re-sorts', resorted.sorted === 'distance');
  check('distance column is descending',
    resorted.col.join(',') === '1900,500,200', resorted.col.join(','));

  // the empty state is its own path and has to survive a sort click too
  const emptyBoard = await page.evaluate(async () => {
    window.game.profile.history = [];
    window.game.screenBoard('tokens');
    await new Promise((r) => setTimeout(r, 120));
    return { empty: !!document.querySelector('.ms-board-empty'),
      cells: document.querySelectorAll('.ms-board tbody tr td').length };
  });
  check('empty board shows a placeholder', emptyBoard.empty && emptyBoard.cells === 1);

  // --- wipeout, blamed on a named vendor ------------------------------------
  await page.evaluate(() => {
    const g = window.game;
    g.start();
    g.run.shields = 0;
    g.run.invuln = 0;
    const o = g.makeObstacle('vendor_board', 1, g.run.z + 100);
    o.vendor = window.MS_CONTENT.VENDORS.find((v) => v.id === 'datadog');
    g.crash(o.def, o);
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, '06-over.png') });
  check('wipeout screen renders', await page.locator('.ms-panel').count() === 1);
  const noArcadeBoard = await page.evaluate(() =>
    !/Arcade leaderboard|Banked to the arcade/i.test(document.body.innerText));
  check('arcade leaderboard row is gone from the results', noArcadeBoard);
  const cause = await page.evaluate(() => document.querySelector('.ms-screen .ms-sub').textContent.trim());
  check('wipeout names the vendor that got you',
    /^CostBot's fun was interrupted by .*Datadog.*\.$/.test(cause), cause);

  // The same hazard has to be able to phrase itself more than one way, and a
  // vendor line must never ship with the {vendor} placeholder still in it.
  const phrasing = await page.evaluate(() => {
    const g = window.game;
    const C = window.MS_CONTENT;
    const dd = C.VENDORS.find((v) => v.id === 'datadog');
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      seen.add(g.causeOf(C.OBSTACLES.vendor_board, { vendor: dd }));
    }
    const rock = new Set();
    for (let i = 0; i < 300; i++) rock.add(g.causeOf(C.OBSTACLES.bedrock, null));
    return {
      vendorVariants: seen.size,
      vendorPool: C.VENDOR_CAUSES.length,
      leftovers: [...seen, ...rock].filter((t) => t.includes('{vendor}')).length,
      allNameVendor: [...seen].every((t) => t.includes('Datadog')),
      rockVariants: rock.size,
      rockSaysAws: [...rock].every((t) => /AWS Bedrock|inference charges/.test(t)),
    };
  });
  check('vendor wipeouts vary', phrasing.vendorVariants === phrasing.vendorPool,
    `${phrasing.vendorVariants}/${phrasing.vendorPool} phrasings`);
  check('every vendor phrasing names the vendor', phrasing.allNameVendor);
  check('no {vendor} placeholder escapes', phrasing.leftovers === 0);
  check('bedrock wipeouts vary and say AWS Bedrock',
    phrasing.rockVariants === 3 && phrasing.rockSaysAws);

  // a broken <img> on a results screen is silent — assert it actually decoded
  const wipe = await page.evaluate(() => {
    const el = document.querySelector('.ms-wipe');
    return el ? { w: el.naturalWidth, h: el.naturalHeight, src: el.src } : null;
  });
  check('wipeout photo loads', !!wipe && wipe.w > 0, wipe && `${wipe.w}x${wipe.h}`);

  // The screen rotates between several shots. Every one has to decode — a typo in
  // any filename is otherwise invisible until that one happens to come up.
  const shots = await page.evaluate(async () => {
    const g = window.game;
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      g.screenOver({ cause: 'x', tokens: 1, distance: 1, nearMisses: 0,
        topSpeed: 1, best: false });
      seen.add(document.querySelector('.ms-wipe').getAttribute('src'));
    }
    const loaded = await Promise.all([...seen].map((src) => new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ src, ok: im.naturalWidth > 0 });
      im.onerror = () => res({ src, ok: false });
      im.src = src;
    })));
    return loaded;
  });
  check('all wipeout shots rotate in', shots.length === 3, `${shots.length} distinct`);
  const norepeat = await page.evaluate(() => {
    const g = window.game;
    const seq = [];
    for (let i = 0; i < 60; i++) {
      g.screenOver({ cause: 'x', tokens: 1, distance: 1, nearMisses: 0,
        topSpeed: 1, best: false });
      seq.push(document.querySelector('.ms-wipe').getAttribute('src'));
    }
    return seq.some((v, i) => i > 0 && v === seq[i - 1]);
  });
  check('wipeout shot never repeats back to back', !norepeat);
  check('every wipeout shot decodes', shots.every((s) => s.ok),
    shots.filter((s) => !s.ok).map((s) => s.src).join(','));
  // The screen is a scroll container by design (an unlock banner can push it
  // over), but the ordinary result — stats, build bar, buttons — has to be
  // readable without scrolling, which a too-large photo silently breaks.
  // Force the tallest ordinary layout rather than whatever this run happened to
  // produce: personal-best row present, no unlock banner.
  const fits = await page.evaluate(() => {
    window.game.screenOver({
      cause: "CostBot's fun was interrupted by the Datadog Contract.",
      tokens: 1234, distance: 2048, nearMisses: 12, topSpeed: 2600, best: true,
    });
    const s = document.querySelector('.ms-screen');
    return { scroll: s.scrollHeight, view: s.clientHeight };
  });
  check('wipeout screen fits without scrolling', fits.scroll <= fits.view,
    `${fits.scroll} / ${fits.view}`);

  // --- the arcade bank ------------------------------------------------------
  // A run's tokens have to reach the arcade-wide bank. Two halves to that: the
  // result must carry `tokensEarned` (the field every cabinet reports and the
  // server's pool sums), and the local profile must carry `lifetimeTokens` (what
  // the arcade page totals when there is no API).
  const bank = await page.evaluate(async () => {
    const g = window.game;
    const seen = [];
    const prevProfile = g.profile.totalTokens || 0;
    const orig = g.onComplete;
    g.onComplete = (r) => { seen.push(r); orig(r); };
    g.start();
    g.run.tokens = 250;
    g.run.shields = 0;
    g.run.invuln = 0;
    g.crash(window.MS_CONTENT.OBSTACLES.bedrock, null);
    await new Promise((r) => setTimeout(r, 900));
    g.onComplete = orig;
    const stored = JSON.parse(localStorage.getItem('costbot.mudslides.v1') || '{}');
    return {
      tokens: seen[0] && seen[0].tokens,
      tokensEarned: seen[0] && seen[0].tokensEarned,
      grew: (g.profile.totalTokens || 0) - prevProfile,
      lifetime: g.profile.lifetimeTokens,
      total: g.profile.totalTokens,
      storedLifetime: stored.lifetimeTokens,
    };
  });
  check('run reports tokensEarned for the arcade pool',
    bank.tokensEarned === bank.tokens && bank.tokens === 250, JSON.stringify(bank));
  check('run adds to the lifetime bank', bank.grew === 250, `+${bank.grew}`);
  check('lifetimeTokens mirrors the running total',
    bank.lifetime === bank.total && bank.storedLifetime === bank.total,
    `${bank.storedLifetime} / ${bank.total}`);

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

  // Last, because it leaves the Mudslides page: the arcade screen has to show
  // the build fund, with no API in play. Tokens from a run now land in the
  // SHARED purse rather than being auto-banked, so bank them first — that is
  // the player's own two-step, and this proves both halves of it.
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const purse = await page.evaluate(() => {
    const W = window.ArcadeWallet;
    const onHand = W.tokens;          // whatever the run above paid in
    W.earn(Math.max(0, 250 - onHand), 'mudslides');
    W.bank();                          // the player's choice, made explicitly
    return { banked: W.banked, tokens: W.tokens };
  });
  await page.waitForTimeout(300);
  // fund-num is progress toward the NEXT product, not the lifetime total — the
  // tally carries the rest, so the bank has to be read back from both.
  const hub = await page.evaluate(() => {
    const ship = document.getElementById('fund-ship').textContent;
    const m = ship.match(/([\d,]+)\s+shipped/);
    return {
      on: !!document.querySelector('#fund.on'),
      toward: Number((document.getElementById('fund-num').textContent || '0').replace(/,/g, '')),
      shipped: m ? Number(m[1].replace(/,/g, '')) : 0,
      goal: document.getElementById('fund-num').nextElementSibling.textContent,
    };
  });
  const bankTotal = hub.shipped * 10000 + hub.toward;
  check('a run pays the shared purse, and banking moves it to the fund',
    purse.tokens === 0 && purse.banked >= 250, `${purse.banked} banked, purse empty`);
  check('arcade screen shows the bank without an API', hub.on && bankTotal >= 250,
    `${bankTotal} tokens (${hub.shipped} shipped + ${hub.toward})`);
  check('the bank ships a product every 10,000 tokens',
    /10,000 tokens/.test(hub.goal) && hub.toward < 10000, hub.goal);

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  server.close();
  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall checks passed');
  process.exit(fail.length ? 1 : 0);
})();
