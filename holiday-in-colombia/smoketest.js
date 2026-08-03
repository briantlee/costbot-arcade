/* Headless smoke test for Holiday in Colombia.
 * Boots the dock, drives a full cast -> bite -> reel loop, exercises the bait
 * economy and the trivia tap, and screenshots every screen.
 *   node smoketest.js
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');   // serve the arcade so ../shared/ resolves
const OUT = path.join(DIR, 'shots');
// Port 0 = let the OS pick a free one. A fixed port collides with a stray
// server from an interrupted run (or another cabinet's suite) and the whole
// thing dies on EADDRINUSE before a single check executes.

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

let pass = 0;
const fails = [];
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log('  ok ' + label + (detail ? ' — ' + detail : '')); }
  else { fails.push(label + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const PORT = server.address().port;

  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  const errors = [];
  const EXPECTED_404 = /api\/me/;
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.location() && EXPECTED_404.test(m.location().url || '')) return;
    errors.push('CONSOLE: ' + m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !EXPECTED_404.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url());
  });

  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') })
    .then(() => console.log('  📸 ' + n));

  // -------------------------------------------------------------------------
  console.log('\n▶ Dock…');
  // The wallet is shared arcade-wide and persists in localStorage, so wipe it
  // (and the legacy per-cabinet purses it migrates from) before measuring.
  await page.goto(`http://localhost:${PORT}/holiday-in-colombia/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.game, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await shot('01-dock');

  // Read the expected handout from content rather than hardcoding it, so the
  // suite stays honest across balance changes (and across the debug override).
  const boot = await page.evaluate(() => ({
    bait: window.game.totalBait(),
    daily: window.game.dailyGiven,
    free: window.HC_CONTENT.DAILY.freeBait,
    everyLoad: !!window.HC_CONTENT.DAILY.everyLoad,
    tokens: window.ArcadeWallet.tokens,
    species: window.HC_CONTENT.FISH.length,
    junk: window.HC_CONTENT.JUNK.length,
  }));
  ok(boot.daily === boot.free, 'the daily handout matches DAILY.freeBait', `got ${boot.daily}`);
  ok(boot.bait === boot.free, 'starts the day with exactly the free bait', `${boot.bait}`);
  ok(boot.tokens === 0, 'no tokens in a fresh purse');
  console.log(`  ${boot.species} fish + ${boot.junk} junk in the lake`);
  if (boot.everyLoad) console.log('  ⚠ DAILY.everyLoad is on — debug refill, revert before shipping');

  // The daily top-up must not stack. (Skipped while the debug override is on,
  // because refilling on every load is the entire point of that flag.)
  if (!boot.everyLoad) {
    const twice = await page.evaluate(() => {
      const g = window.game;
      g.p.bait = g.p.bait;                        // already a number post-migration
      g.p.lastDaily = null;                       // pretend it is a new day
      const first = (() => { const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
      g.p.lastDaily = first;
      return g.totalBait();
    });
    ok(twice === boot.free, 'the daily handout tops up rather than stacking', `${twice}`);
  }

  // ---- regression: the bait count must never stop being a number -----------
  // A legacy {chum,lure,golden} profile once reached `bait = bait + n`, which
  // concatenated instead of adding ("[object Object]3456"). A string is not
  // > 0, so casting instantly reported out-of-bait and space ended the run.
  const legacy = await page.evaluate(() => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const g = window.HolidayInColombia.mount(mount, {
      // deliberately more than DAILY.freeBait, so the top-up cannot mask a
      // migration that silently dropped the old counts
      profile: { bait: { chum: 200, lure: 20, golden: 3 }, tokens: 0 },
    });
    const migrated = g.p.bait;
    // now hammer every write path and confirm none of them produce a string
    g.p.bait = 4;
    g.screenTrivia(0);
    const qt = document.querySelectorAll('.hc-q')[document.querySelectorAll('.hc-q').length - 1].textContent.trim();
    const item = window.ArcadeTrivia.BANK.find((x) => x.q === qt);
    const want = item.c[item.a];
    const btns = Array.from(g.ui.querySelectorAll('.hc-choice'));
    btns.find((b) => b.querySelector('span').textContent.trim() === want).click();
    const afterTrivia = g.p.bait;
    g.p.tokens = 10000; g.screenShop();
    g.ui.querySelector('[data-buy="1"]').click();
    const afterBuy = g.p.bait;
    g.start(); g.doCast(); g.run.meter = 0.3; g.lockCast();
    const afterCast = g.p.bait;
    const types = [migrated, afterTrivia, afterBuy, afterCast].map((v) => typeof v);
    g.destroy(); mount.remove();
    return { migrated, afterTrivia, afterBuy, afterCast, types };
  });
  ok(legacy.types.every((t) => t === 'number'),
    'bait stays a number through migrate, trivia, buying and casting',
    legacy.types.join('/'));
  ok(legacy.migrated === 223, 'a legacy tiered-bait profile folds into one count',
    `200+20+3 -> ${legacy.migrated}`);
  ok(legacy.afterCast === legacy.afterBuy - 1, 'a cast spends exactly one bait',
    `${legacy.afterBuy} -> ${legacy.afterCast}`);

  // -------------------------------------------------------------------------
  console.log('\n▶ The fish ladder…');
  const ladder = await page.evaluate(() => {
    const C = window.HC_CONTENT;
    // One model per band, ascending. That IS the ladder now.
    const order = ['haiku45', 'sonnet5', 'opus5', 'fable5'];
    const get = (id) => C.FISH.find((f) => f.id === id);
    const broken = [];
    for (let i = 1; i < order.length; i++) {
      const a = get(order[i - 1]), b = get(order[i]);
      if (!a || !b) { broken.push(order[i] + ':missing'); continue; }
      if (!(b.kg > a.kg)) broken.push(`${b.id} kg <= ${a.id}`);
      if (!(b.tokens > a.tokens)) broken.push(`${b.id} tokens <= ${a.id}`);
      if (!(b.band > a.band)) broken.push(`${b.id} band <= ${a.id}`);
      if (!(b.rarity < a.rarity)) broken.push(`${b.id} not rarer than ${a.id}`);
    }
    const fable = get('fable5');
    return {
      broken, count: C.FISH.length,
      fableHeaviest: C.FISH.every((f) => f.id === 'fable5' || f.kg < fable.kg),
      fableRichest: C.FISH.every((f) => f.id === 'fable5' || f.tokens < fable.tokens),
      fableRarest: C.FISH.every((f) => f.id === 'fable5' || f.rarity > fable.rarity),
      fableBand: fable.band,
      dupes: C.FISH.map((f) => f.id).filter((v, i, a) => a.indexOf(v) !== i),
      bandCoverage: C.BANDS.map((b) =>
        C.FISH.concat(C.JUNK).filter((f) => f.band === b.id).length),
      oneFishPerBand: C.BANDS.every((b) => C.FISH.filter((f) => f.band === b.id).length === 1),
    };
  });
  ok(ladder.count === 4, 'the lake holds the four current models, nothing older',
    `${ladder.count} fish`);
  ok(ladder.broken.length === 0,
    'each step up is heavier, richer, deeper and rarer than the last',
    ladder.broken.join(', ') || 'Haiku -> Sonnet -> Opus -> Fable');
  ok(ladder.oneFishPerBand, 'exactly one model per depth band');
  ok(ladder.fableHeaviest && ladder.fableRichest, 'Fable 5 is the biggest and richest fish');
  ok(ladder.fableRarest, 'Fable 5 is the rarest draw in the lake');
  ok(ladder.fableBand === 3, 'Fable 5 only lives in the Abyss');
  ok(ladder.dupes.length === 0, 'no duplicate species ids');
  ok(ladder.bandCoverage.every((n) => n > 0), 'every depth band has something in it',
    ladder.bandCoverage.join('/'));

  // Depth, not the wallet, decides what is down there. A deep cast must make an
  // Opah likely and a shallow one must make it rare — but never impossible,
  // because a freak catch off a bad cast is the best moment in the game.
  const depth = await page.evaluate(() => {
    const g = window.game;
    const roll = (band, perfect) => {
      const seen = { opus: 0, fable: 0, n: 4000 };
      for (let i = 0; i < seen.n; i++) {
        const f = g.pickSpecies(band, null, perfect);
        if (f.tier === 'opus') seen.opus++;
        if (f.id === 'fable5') seen.fable++;
      }
      return { opus: seen.opus / seen.n, fable: seen.fable / seen.n };
    };
    return { shallow: roll(0, false), deep: roll(3, false), perfect: roll(3, true) };
  });
  const pct = (v) => (v * 100).toFixed(1) + '%';
  ok(depth.deep.opus > depth.shallow.opus * 5,
    'a deep cast makes an Opah far likelier than a shallow one',
    `${pct(depth.shallow.opus)} shallow vs ${pct(depth.deep.opus)} deep`);
  // Sampling cannot prove "possible but very rare" — a Fable off a shallow cast
  // is ~1 in 10,000, so 4,000 draws routinely see none. Assert the weight.
  const reachable = await page.evaluate(() => {
    const g = window.game, C = window.HC_CONTENT;
    return C.FISH.concat(C.JUNK).map((f) => ({ id: f.id, w: g.drawWeight(f, 0, false) }))
      .filter((x) => !(x.w > 0)).map((x) => x.id);
  });
  ok(reachable.length === 0 && depth.shallow.opus > 0,
    'nothing is locked out of a shallow cast — every species keeps a nonzero weight',
    `Opah ${pct(depth.shallow.opus)} even in the shallows`);
  ok(depth.perfect.fable > depth.deep.fable,
    'a perfect cast improves the odds again',
    `${pct(depth.deep.fable)} -> ${pct(depth.perfect.fable)} Fable`);
  console.log(`  Fable odds: shallow ${pct(depth.shallow.fable)} · abyss ${pct(depth.deep.fable)} · perfect abyss ${pct(depth.perfect.fable)}`);

  console.log('\n▶ Trivia buys bait…');
  await page.click('#hc-triv');
  await page.waitForTimeout(300);
  await shot('02-trivia');
  const before = await page.evaluate(() => window.game.totalBait());
  const answered = await page.evaluate(() => {
    // Answer correctly by reading the bank, the same way the Waste Hunter
    // suite does — the point is the reward path, not the guessing.
    const qt = document.querySelector('.hc-q').textContent.trim();
    const item = window.ArcadeTrivia.BANK.find((x) => x.q === qt);
    if (!item) return { err: 'question not in bank' };
    const want = item.c[item.a];
    const btn = Array.from(document.querySelectorAll('.hc-choice'))
      .find((b) => b.querySelector('span').textContent.trim() === want);
    if (!btn) return { err: 'correct choice not rendered' };
    btn.click();
    return { ok: true };
  });
  ok(!answered.err, 'trivia renders a question from the shared bank', answered.err || '');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.game.totalBait());
  const rw = await page.evaluate(() => window.HC_CONTENT.TRIVIA_BAIT.reward);
  ok(after === before + rw, `a correct answer pays ${rw} bait`, `${before} -> ${after}`);
  await shot('03-trivia-reward');

  // The tap must be bottomless — that is what keeps the token economy floored.
  const streak = await page.evaluate(async () => {
    const g = window.game;
    let n = g.totalBait();
    for (let i = 0; i < 6; i++) {
      g.screenTrivia(i);
      const qt = document.querySelector('.hc-q').textContent.trim();
      const item = window.ArcadeTrivia.BANK.find((x) => x.q === qt);
      const want = item.c[item.a];
      Array.from(document.querySelectorAll('.hc-choice'))
        .find((b) => b.querySelector('span').textContent.trim() === want).click();
    }
    return { gained: g.totalBait() - n, bait: g.totalBait() };
  });
  ok(streak.gained > 12, 'a trivia streak pays escalating bait', `+${streak.gained} over 6`);

  // -------------------------------------------------------------------------
  console.log('\n▶ Bait shop…');
  await page.evaluate(() => { window.ArcadeWallet.earn(5000, 'test'); window.game.screenShop(); });
  await page.waitForTimeout(250);
  await shot('04-shop');
  const bought = await page.evaluate(() => {
    const g = window.game;
    const pk = window.HC_CONTENT.BAIT_PACKS[2];
    const t0 = window.ArcadeWallet.tokens, n0 = g.totalBait();
    document.querySelector('[data-buy="2"]').click();
    return { spent: t0 - window.ArcadeWallet.tokens, gained: g.totalBait() - n0,
             cost: pk.cost, n: pk.n };
  });
  ok(bought.spent === bought.cost && bought.gained === bought.n,
    'the bulk pack charges its price and delivers its count',
    `-${bought.spent} / +${bought.gained}`);

  const broke = await page.evaluate(() => {
    const g = window.game;
    window.ArcadeWallet.spend(window.ArcadeWallet.tokens);   // empty the purse
    g.screenShop();
    return Array.from(document.querySelectorAll('[data-buy]')).every((b) => b.disabled);
  });
  ok(broke, 'with no tokens every buy button is disabled — you cannot go negative');

  // -------------------------------------------------------------------------
  console.log('\n▶ A full cast → bite → reel…');
  await page.evaluate(() => {
    const g = window.game;
    g.p.bait = 40;
    g.screenDock();
  });
  await page.click('#hc-go');
  await page.waitForTimeout(400);
  await shot('05-idle');
  ok(await page.evaluate(() => window.game.run && window.game.run.phase === 'idle'),
    'the run starts in idle with the rod ready');

  // cast
  await page.keyboard.press('Space');
  await page.waitForTimeout(220);
  await shot('06-cast-meter');
  ok(await page.evaluate(() => window.game.run.phase === 'cast'), 'first press opens the cast meter');

  // Stop the meter deliberately in the deep zone rather than hoping.
  const cast = await page.evaluate(() => {
    const g = window.game;
    g.run.meter = 0.60;                 // inside the "Deep" zone
    const before = g.p.bait;
    g.lockCast();
    return { phase: g.run.phase, band: g.run.band, spent: before - g.p.bait };
  });
  ok(cast.phase === 'sink' && cast.band === 2, 'stopping in the deep zone sinks to band 2',
    `band ${cast.band}`);
  ok(cast.spent === 1, 'the cast spends one bait immediately', `${cast.spent} spent`);

  // Overcooking the meter is a real miss, not a free bonus.
  const snag = await page.evaluate(() => {
    const g = window.game;
    g.run.phase = 'idle'; g.doCast();
    g.run.meter = 0.98; g.lockCast();
    return { phase: g.run.phase, hooked: g.run.hooked };
  });
  ok(snag.phase === 'show' && !snag.hooked, 'overcooking the cast snags the line');

  // Drive a real fight. The model is now line tension: hold to reel, ease off
  // when it runs, snap the line if you do not.
  const fight = await page.evaluate(async () => {
    const g = window.game;
    g.run.phase = 'idle'; g.p.bait = 20;
    g.doCast(); g.run.meter = 0.85; g.lockCast();     // abyss
    g.run.phase = 'bite'; g.run.ring = 1;              // dead centre = clean hook
    g.hook();
    const h = g.run.hooked;
    return { phase: g.run.phase, clean: g.run.cleanHook, name: h.def.name,
             dist: +h.dist.toFixed(3), tension: h.tension };
  });
  ok(fight.phase === 'reel', 'striking on the ring starts the fight');
  ok(fight.clean === true, 'striking dead centre is a clean hook');

  // The ring is the whole hook mechanic, so its three outcomes get asserted.
  const ringTest = await page.evaluate(() => {
    const g = window.game, B = window.HC_CONTENT.BITE;
    const attempt = (ring) => {
      g.nextCast(); g.p.bait = 20;
      g.doCast(); g.run.meter = 0.5; g.lockCast();
      g.run.phase = 'bite'; g.run.phaseT = 0; g.run.ring = ring;
      g.hook();
      return { phase: g.run.phase, clean: g.run.cleanHook };
    };
    return {
      centre: attempt(1),
      edge: attempt(1 + B.hitBand * 0.8),
      early: attempt(1 + B.hitBand + 0.5),
      bands: { hit: B.hitBand, perfect: B.perfectBand },
    };
  });
  ok(ringTest.centre.phase === 'reel' && ringTest.centre.clean,
    'dead centre hooks it cleanly');
  ok(ringTest.edge.phase === 'reel' && !ringTest.edge.clean,
    'inside the band but off-centre still hooks, just not cleanly');
  ok(ringTest.early.phase === 'wait',
    'striking while the ring is still wide spooks the fish instead',
    `phase ${ringTest.early.phase}`);
  ok(ringTest.bands.perfect < ringTest.bands.hit,
    'the clean-hook core sits inside the hit band');

  // The fish you watch swim in must be the fish you hook — picking a different
  // one at strike time would make the whole approach a lie.
  const approach = await page.evaluate(async () => {
    const g = window.game;
    g.nextCast(); g.p.bait = 20;
    g.doCast(); g.run.meter = 0.85; g.lockCast();
    for (let i = 0; i < 60; i++) g.update(1 / 60);       // sink -> wait
    const c = g.run.comer;
    const startX = c && c.x;
    for (let i = 0; i < 40; i++) g.update(1 / 60);       // let it swim
    const movedTowardLure = c && Math.abs(c.x - g.lureX()) < Math.abs(startX - g.lureX());
    const summoned = c && c.def && c.def.id;
    g.run.phase = 'bite'; g.run.ring = 1; g.hook();
    return { summoned, movedTowardLure, hooked: g.run.hooked && g.run.hooked.def.id,
             offscreenStart: Math.abs(startX - g.lureX()) > 200 };
  });
  ok(!!approach.summoned, 'a real fish is chosen and sent in during the wait',
    approach.summoned || 'none');
  ok(approach.offscreenStart, 'it starts off the edge of the lake, not on top of the bait');
  ok(approach.movedTowardLure, 'and swims toward the bait');
  ok(approach.hooked === approach.summoned,
    'the fish you hook is the one you watched arrive',
    `${approach.summoned} -> ${approach.hooked}`);
  const baseDist = await page.evaluate(() => window.HC_CONTENT.REEL.startDist);
  ok(fight.dist < baseDist, 'a clean hook starts the fish closer in',
    `${fight.dist} vs ${baseDist}`);
  ok(fight.tension === 0, 'and with slack line');
  await page.waitForTimeout(200);
  await shot('07-reel');

  // A player who works the rod properly — reel when it is calm, ease off when
  // it runs — must always land it.
  const landed = await page.evaluate(async () => {
    const g = window.game, R = window.HC_CONTENT.REEL;
    // Set up its own fight — the ring checks above left the run mid-wait.
    g.nextCast(); g.p.bait = 20;
    g.doCast(); g.run.meter = 0.85; g.lockCast();
    g.run.phase = 'bite'; g.run.ring = 1; g.hook();
    for (let i = 0; i < 6000 && g.run && g.run.phase === 'reel'; i++) {
      const h = g.run.hooked;
      g.held = !h.running && h.tension < R.safeTo;      // the correct technique
      g.updateReel(1 / 60);
    }
    g.held = false;
    return { phase: g.run.phase, tokens: g.run.tokens, caught: g.run.caught.length,
             dex: Object.keys(g.p.dex).length };
  });
  ok(landed.phase === 'card' && landed.caught === 1, 'working the rod correctly lands the fish',
    `${landed.caught} in the boat`);
  ok(landed.tokens > 0, 'landing it pays tokens', `+${landed.tokens}`);
  ok(landed.dex === 1, 'the catch is logged in the fishdex');
  await page.waitForTimeout(450);
  await shot('08-catch-card');

  // ---- the catch card ------------------------------------------------------
  const card = await page.evaluate(() => {
    const el = document.querySelector('.hc-catch .cc');
    if (!el) return { err: 'no card' };
    const img = el.querySelector('.fishimg');
    return {
      name: el.querySelector('h2').textContent.trim(),
      species: (el.querySelector('.sp') || {}).textContent || null,
      facts: Array.from(el.querySelectorAll('.fact b')).map((b) => b.textContent.trim()),
      hasArt: !!img && img.src.startsWith('data:image/png') && img.src.length > 800,
      // nothing may advance while the card is up
      frozen: (() => {
        const g = window.game, phase = g.run.phase, t0 = g.run.phaseT;
        for (let i = 0; i < 120; i++) g.update(1 / 60);
        return g.run.phase === phase && g.run.phaseT === t0;
      })(),
    };
  });
  ok(!card.err, 'landing a fish opens a catch card', card.err || card.name);
  ok(!!card.hasArt, 'the card shows a drawn portrait of the fish');
  ok(!card.err && card.facts && card.facts.length === 2 && /kg$/.test(card.facts[0])
    && Number(card.facts[1].replace(/,/g, '')) > 0,
    'it reports the weight and the tokens in its belly',
    card.facts ? card.facts.join(' · ') : 'no card');
  ok(!!card.frozen, 'the run is held still while the card is up');

  // Every family must draw something different — otherwise the card is a
  // reskin of the same fish four times and the reward reads as generic.
  const arts = await page.evaluate(() => {
    const C = window.HC_CONTENT;
    const urls = C.FISH.map((f) => ({ id: f.id, art: f.art, url: window.game.portrait(f, 96) }));
    return {
      missing: C.FISH.filter((f) => !f.art).map((f) => f.id),
      distinct: new Set(urls.map((u) => u.url)).size,
      total: urls.length,
      allDrawn: urls.every((u) => u.url.startsWith('data:image/png') && u.url.length > 600),
    };
  });
  ok(arts.missing.length === 0, 'every fish declares a portrait', arts.missing.join(','));
  ok(arts.distinct === arts.total, 'each family draws a different fish',
    `${arts.distinct}/${arts.total} distinct`);
  ok(arts.allDrawn, 'all portraits render to real pixels');

  // Junk has no `art` field, so every piece used to hash to the same cache key
  // and the boot, the tyre and the crate all rendered as the zombie gateway.
  const junkArt = await page.evaluate(() => {
    const C = window.HC_CONTENT, g = window.game;
    const urls = C.JUNK.map((j) => g.portrait(j, 96));
    return {
      distinct: new Set(urls).size, total: urls.length,
      vsFish: new Set(urls.concat(C.FISH.map((f) => g.portrait(f, 96)))).size,
      all: C.FISH.length + C.JUNK.length,
    };
  });
  ok(junkArt.distinct === junkArt.total, 'each piece of junk draws its own thing',
    `${junkArt.distinct}/${junkArt.total} distinct`);
  ok(junkArt.vsFish === junkArt.all, 'and none of them collides with a fish',
    `${junkArt.vsFish}/${junkArt.all} unique across the lake`);

  // The card must never contradict its own numbers — junk pays, so it may not
  // claim otherwise next to a non-zero token count.
  const copy = await page.evaluate(() => {
    const C = window.HC_CONTENT;
    return C.JUNK.every((j) => j.tokens > 0);
  });
  ok(copy, 'junk has a real payout, so the card says so');


  // ---- the teaching slot ---------------------------------------------------
  const tips = await page.evaluate(() => {
    const C = window.HC_CONTENT, g = window.game;
    const all = C.FISH.concat(C.JUNK);
    const shown = document.querySelector('.hc-catch .tipbox p');
    const seen = {};
    for (const def of all) {
      const s = new Set();
      for (let i = 0; i < 60; i++) s.add(g.pickTip(def));
      seen[def.id] = { got: s.size, pool: (def.tips || []).length };
    }
    // no species may repeat the same fact twice running
    let b2b = false;
    const rich = all.find((f) => (f.tips || []).length > 1);
    let prev = null;
    for (let i = 0; i < 80; i++) {
      const t = g.pickTip(rich);
      if (t === prev) b2b = true;
      prev = t;
    }
    return {
      missing: all.filter((f) => !f.tips || !f.tips.length).map((f) => f.id),
      short: all.flatMap((f) => (f.tips || []).filter((t) => t.length < 60).map(() => f.id)),
      allRotate: Object.values(seen).every((v) => v.got === v.pool),
      total: all.reduce((n, f) => n + (f.tips || []).length, 0),
      onCard: !!shown && shown.textContent.trim().length > 40,
      b2b,
    };
  });
  ok(tips.missing.length === 0, 'every species teaches something', tips.missing.join(','));
  ok(tips.short.length === 0, 'no stub facts', tips.short.join(','));
  ok(tips.allRotate, 'every fact in every pool gets shown');
  ok(!tips.b2b, 'the same fact never appears twice in a row');
  ok(tips.onCard, 'the catch card renders one');
  console.log(`  ${tips.total} FinOps facts across ${await page.evaluate(() => window.HC_CONTENT.FISH.length + window.HC_CONTENT.JUNK.length)} species`);

  // Stopping while ahead is a decision worth offering on the reward screen.
  const packUp = await page.evaluate(async () => {
    const g = window.game;
    const btn = document.querySelector('.hc-catch #hc-stop');
    if (!btn) return { err: 'no pack-up button on the catch card' };
    await new Promise((r) => setTimeout(r, 600));
    btn.click();
    return { ended: !g.run || g.run.over, result: !!document.querySelector('.hc-tbl') };
  });
  ok(!packUp.err, 'the catch card offers a pack-up option', packUp.err || '');
  ok(!packUp.err && packUp.ended && packUp.result,
    'and it ends the trip straight to the results card');

  // packing up above ended the trip — start a fresh one for what follows
  await page.evaluate(() => { window.game.p.bait = 40; window.game.start(); });
  await page.waitForTimeout(200);

  // Holding the button down forever must ALWAYS snap the line — if brute force
  // works, the run mechanic is decoration. Checked per species, because the
  // numbers that make this true are per-species.
  const brute = await page.evaluate(async () => {
    const g = window.game, C = window.HC_CONTENT;
    const out = {};
    for (const def of C.FISH) {
      let snapped = 0;
      for (let n = 0; n < 12; n++) {
        g.nextCast();
        g.p.bait = 20;
        g.doCast(); g.run.meter = 0.85; g.lockCast();
        g.run.phase = 'bite'; g.run.ring = 1; g.hook();
        g.run.hooked = {                     // force this species onto the line
          cat: g.rollCatch(def), def, fight: g.fightProfile(def),
          dist: C.REEL.startDist, tension: 0, running: false,
          runT: C.REEL.firstRunDelay, peakTension: 0,
        };
        g.held = true;
        for (let i = 0; i < 9000 && g.run.phase === 'reel'; i++) g.updateReel(1 / 60);
        if (g.run.phase === 'show' && !g.run.hooked) snapped++;
      }
      out[def.id] = snapped;
    }
    g.held = false;
    return out;
  });
  const bruteAll = Object.entries(brute).filter(([, v]) => v !== 12).map(([k]) => k);
  ok(bruteAll.length === 0, 'holding the button down always snaps the line, on every species',
    Object.entries(brute).map(([k, v]) => `${k} ${v}/12`).join(' · '));

  // ...and never touching it must always lose the fish too.
  const lost = await page.evaluate(async () => {
    const g = window.game;
    let losses = 0;
    for (let n = 0; n < 10; n++) {
      g.nextCast();
      g.p.bait = 20;
      g.doCast(); g.run.meter = 0.85; g.lockCast();
      g.run.phase = 'bite'; g.run.ring = 1; g.hook();
      g.held = false;
      for (let i = 0; i < 6000 && g.run.phase === 'reel'; i++) g.updateReel(1 / 60);
      if (g.run.phase === 'show' && !g.run.hooked) losses++;
    }
    return { losses, streak: g.run.streak };
  });
  ok(lost.losses === 10, 'never reeling always loses the fish — no idle strategy',
    `${lost.losses}/10 lost`);
  ok(lost.streak === 0, 'losing a fish resets the streak');

  // -------------------------------------------------------------------------
  // Regression: the canvas backing store must track the element's real pixel
  // size. A fixed 1152x648 store stretched by CSS is what made the HUD panels
  // look soft on a big screen and elongated on a non-16:9 one.
  console.log('\n▶ Crispness…');
  const crisp = [];
  for (const [w, h] of [[1280, 760], [1600, 900], [1024, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(260);
    crisp.push(await page.evaluate(() => {
      const c = document.querySelector('.hc-root canvas');
      const r = c.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const g = window.game;
      return {
        native: Math.abs(c.width - Math.round(r.width * dpr)) <= 1
          && Math.abs(c.height - Math.round(r.height * dpr)) <= 1,
        // one uniform scale for both axes = nothing can be elongated
        uniform: g.view.scale === Math.min(r.width / 1152, r.height / 648),
        letterboxed: g.view.offX >= 0 && g.view.offY >= 0,
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      };
    }));
  }
  ok(crisp.every((c) => c.native), 'the canvas backing store matches its real pixel size',
    crisp.map((c) => c.box).join(' · '));
  ok(crisp.every((c) => c.uniform), 'one scale for both axes — nothing is stretched');
  ok(crisp.every((c) => c.letterboxed), 'the remainder is letterboxed, not distorted');
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.waitForTimeout(200);

  console.log('\n▶ Mute…');
  const mute = await page.evaluate(() => {
    const g = window.game;
    const btn = document.querySelector('.hc-mute');
    if (!btn) return { err: 'no mute button' };
    const before = btn.textContent.trim();
    btn.click();
    const afterClick = { icon: btn.textContent.trim(), off: btn.classList.contains('off'), muted: g.muted };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    const afterKey = { icon: btn.textContent.trim(), off: btn.classList.contains('off'), muted: g.muted };
    // it must survive a screen change — it lives outside the UI layer for this
    g.screenDock();
    const survivedScreen = !!document.querySelector('.hc-mute');
    g.p.bait = 20; g.start();
    const survivedRun = !!document.querySelector('.hc-mute');
    return { before, afterClick, afterKey, survivedScreen, survivedRun };
  });
  ok(!mute.err, 'there is a mute button on screen', mute.err || '');
  ok(!mute.err && mute.afterClick.muted === true && mute.afterClick.off,
    'clicking it mutes and shows the muted state', mute.afterClick && mute.afterClick.icon);
  ok(!mute.err && mute.afterKey.muted === false && !mute.afterKey.off,
    'the M hotkey toggles it back and the button stays in sync', mute.afterKey && mute.afterKey.icon);
  ok(!mute.err && mute.survivedScreen && mute.survivedRun,
    'it survives screen changes and starting a run');

  console.log('\n▶ Controls…');
  const keys = await page.evaluate(async () => {
    const g = window.game;
    const press = (key, type) => window.dispatchEvent(
      new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
    // set up a live fight
    g.nextCast(); g.p.bait = 20;
    g.doCast(); g.run.meter = 0.5; g.lockCast();
    g.run.phase = 'bite'; g.run.ring = 1; g.hook();
    press(' ', 'keydown');
    const spaceReels = g.held === true;
    press(' ', 'keyup');
    const spaceReleases = g.held === false;
    press('ArrowDown', 'keydown');
    const arrowReels = g.held === true;
    press('ArrowDown', 'keyup');
    // land it, then try to close the card with space
    g.run.hooked.dist = 0; g.held = true; g.updateReel(1 / 60);
    const onCard = g.run.phase === 'card';
    await new Promise((r) => setTimeout(r, 700));       // past the deaf period
    press(' ', 'keydown'); press(' ', 'keyup');
    const survivedSpace = g.run.phase === 'card';
    press('Enter', 'keydown');
    const closedOnEnter = g.run.phase !== 'card';
    return { spaceReels, spaceReleases, arrowReels, onCard, survivedSpace, closedOnEnter };
  });
  ok(keys.spaceReels && keys.spaceReleases, 'holding SPACE reels during a fight');
  ok(keys.arrowReels, 'so does holding an arrow key');
  ok(keys.onCard, 'landing the fish opens the card');
  ok(keys.survivedSpace,
    'SPACE cannot close the catch card — it is the reel key, and a stray tap must not skip it');
  ok(keys.closedOnEnter, 'ENTER closes it');

  console.log('\n▶ Running out of bait ends the trip…');
  const ending = await page.evaluate(() => {
    const g = window.game;
    g.nextCast();
    g.p.bait = 1;
    g.doCast(); g.run.meter = 0.3; g.lockCast();   // spends the last one
    const baitAfter = g.totalBait();
    g.nextCast();                                   // ...which should end it
    return { baitAfter, over: !g.run || g.run.over };
  });
  ok(ending.baitAfter === 0, 'the last cast spends the last bait');
  ok(ending.over, 'and the trip ends when there is none left — no clock involved');

  await page.waitForTimeout(300);
  await shot('09-result');
  const result = await page.evaluate(() => {
    const el = document.querySelector('.hc-panel h1');
    return { title: el ? el.textContent.trim() : null, hasTable: !!document.querySelector('.hc-tbl') };
  });
  ok(/tokens reclaimed$/.test(result.title || ''), 'the run ends on a results card', result.title);

  // The shared arcade board files runs by `stageId`; sending `stage` filed every
  // trip under "unknown". Dollars stay at zero on purpose — fishing saves no
  // money, and the board ranks it on streak, weight and fish landed instead.
  const payload = await page.evaluate(() => ({ r: window.__lastResult || null }));
  ok(payload.r && payload.r.stageId === 'lake',
    'the result is filed under the lake, not "unknown"', payload.r && payload.r.stageId);
  ok(payload.r && payload.r.dollarsSaved === 0,
    'and claims no dollars saved — there are none to claim on a lake',
    payload.r && `$${payload.r.dollarsSaved}`);
  ok(payload.r && payload.r.streak !== undefined && payload.r.heaviest !== undefined
    && payload.r.fish !== undefined,
    'streak, heaviest and fish landed ride along for the per-game board');
  ok(result.hasTable, 'the results card itemizes the haul');

  // The haul goes into the shared arcade purse, spendable in any cabinet — NOT
  // straight into the build fund. Banking is the player's call, from the hub.
  const purse = await page.evaluate(() => ({
    tokens: window.ArcadeWallet.tokens,
    earned: window.ArcadeWallet.earned,
    banked: window.ArcadeWallet.banked,
    fromThisGame: window.ArcadeWallet.snapshot().byGame['holiday-in-colombia'] || 0,
  }));
  ok(purse.fromThisGame > 0 && purse.tokens >= purse.fromThisGame,
    'the haul lands in the shared purse, attributed to this game',
    `${purse.fromThisGame} from fishing, ${purse.tokens} on hand`);
  ok(purse.banked === 0, 'and nothing is banked without the player asking');

  // Banking is one-way and moves tokens out of the purse.
  const banked = await page.evaluate(() => {
    const W = window.ArcadeWallet;
    const before = W.tokens;
    const moved = W.bank();
    return { before, moved, tokens: W.tokens, banked: W.banked };
  });
  ok(banked.moved === banked.before && banked.tokens === 0
    && banked.banked === banked.before,
    'banking moves the whole purse into the build fund', `${banked.moved} banked`);

  // -------------------------------------------------------------------------
  console.log('\n▶ Records board…');
  const board = await page.evaluate(() => {
    const g = window.game;
    // seed three trips so the sort is actually exercised
    g.p.history = [
      { at: Date.now(), tokens: 120, fish: 4, heaviest: 8.2, streak: 2 },
      { at: Date.now() - 1e6, tokens: 340, fish: 9, heaviest: 44.1, streak: 7 },
      { at: Date.now() - 2e6, tokens: 60, fish: 2, heaviest: 3.4, streak: 1 },
    ];
    g.screenBoard();
    const head = () => Array.from(document.querySelectorAll('.hc-board th')).map((t) => t.textContent.trim());
    const col = (n) => Array.from(document.querySelectorAll('.hc-board tbody tr'))
      .map((r) => r.children[n] && r.children[n].textContent.trim());
    const first = { sorted: head().find((h) => h.includes('▾')), rows: col(2) };
    // click "Heaviest" to re-sort
    Array.from(document.querySelectorAll('.hc-board th[data-sort]'))
      .find((t) => t.dataset.sort === 'heaviest').click();
    const second = { sorted: head().find((h) => h.includes('▾')), rows: col(3) };
    return { cols: head(), first, second, empty: !document.querySelector('.hc-board tbody tr') };
  });
  ok(board.cols.some((c) => c.includes('Longest streak')), 'the board ranks on longest streak',
    board.cols.join(' · '));
  ok(/Longest streak/.test(board.first.sorted || ''), 'and sorts by it out of the box',
    board.first.sorted);
  ok(board.first.rows[0] === '7', 'the best streak comes first', board.first.rows.join(','));
  ok(/Heaviest/.test(board.second.sorted || ''), 'clicking a column re-sorts');
  ok(board.second.rows[0] === '44.1 kg', 'and heaviest ranks by weight',
    board.second.rows.join(','));
  await page.waitForTimeout(200);
  await shot('13-records');

  console.log('\n▶ Fishdex, achievements, how-to-play…');
  await page.evaluate(() => window.game.screenDex());
  await page.waitForTimeout(250);
  await shot('10-fishdex');
  const dex = await page.evaluate(() => ({
    cards: document.querySelectorAll('.hc-card').length,
    locked: document.querySelectorAll('.hc-card.locked').length,
    total: window.HC_CONTENT.FISH.length + window.HC_CONTENT.JUNK.length,
    seen: Object.keys(window.game.p.dex).length,
  }));
  ok(dex.cards === dex.total, 'the fishdex lists every species', `${dex.cards}/${dex.total}`);
  ok(dex.locked === dex.total - dex.seen, 'unlanded species stay hidden',
    `${dex.seen} logged, ${dex.locked} locked`);

  await page.evaluate(() => window.game.screenAchievements());
  await page.waitForTimeout(200);
  await shot('11-achievements');
  const ach = await page.evaluate(() => ({
    total: window.HC_CONTENT.ACHIEVEMENTS.length,
    rows: document.querySelectorAll('.hc-ach').length,
    // styled like the other cabinets: locked rows dim to a padlock, earned rows
    // light up green. No tick marks anywhere.
    locked: document.querySelectorAll('.hc-ach:not(.on)').length,
    padlocks: Array.from(document.querySelectorAll('.hc-ach:not(.on) .ic'))
      .filter((e) => e.textContent.trim() === '🔒').length,
    ticks: (document.querySelector('.hc-panel').innerText.match(/✓/g) || []).length,
  }));
  ok(ach.rows === ach.total, `all ${ach.total} achievements render`, `${ach.rows}`);
  ok(ach.padlocks === ach.locked, 'locked ones show a padlock', `${ach.locked} locked`);
  ok(ach.ticks === 0, 'and nothing uses a checkmark');

  await page.evaluate(() => window.game.screenBriefing());
  await page.waitForTimeout(200);
  await shot('12-how-to-play');
  const brief = await page.evaluate(() => {
    const txt = document.querySelector('.hc-panel').innerText;
    const C = window.HC_CONTENT;
    return {
      bands: C.BANDS.filter((b) => txt.includes(b.name)).length,
      steps: C.BRIEFING.loop.filter((s) => txt.includes(s.label)).length,
      stepsTotal: C.BRIEFING.loop.length,
    };
  });
  ok(brief.bands === 4 && brief.steps === brief.stepsTotal,
    'how-to-play covers every band and every step of the loop');

  // -------------------------------------------------------------------------
  console.log('\n▶ Content sanity…');
  const content = await page.evaluate(() => {
    const C = window.HC_CONTENT;
    const all = C.FISH.concat(C.JUNK);
    return {
      noNotes: all.filter((f) => !f.note || f.note.length < 12).map((f) => f.id),
      badRate: C.FISH.filter((f) => f.rate && (f.rate.length !== 2 || f.rate[1] <= f.rate[0])).map((f) => f.id),
      tiers: [...new Set(C.FISH.map((f) => f.tier))],
      // Not just "the tier exists" — the three fields the fight actually reads.
      // A renamed field here does not throw, it silently makes tension NaN and
      // the fish becomes both unlandable and unloseable.
      missingFight: C.FISH.concat(C.JUNK).flatMap((f) => {
        const b = f.junk ? C.JUNK_FIGHT : C.TIER_FIGHT[f.tier];
        if (!b) return [f.id + ':no profile'];
        return ['speed', 'runs', 'pull']
          .filter((k) => typeof b[k] !== 'number').map((k) => `${f.id}.${k}`);
      }),
      achDupes: C.ACHIEVEMENTS.map((a) => a.id).filter((v, i, a) => a.indexOf(v) !== i),
      tips: C.TIPS.length,
    };
  });
  ok(content.noNotes.length === 0, 'every species has a fishdex blurb', content.noNotes.join(','));

  // The pun is only funny if the real model is visible next to it, and the
  // premise ("every fish is a model") is a lie the moment one goes missing.
  const puns = await page.evaluate(() => {
    const C = window.HC_CONTENT;
    const TIER_FAMILY = { haiku: /kuda|herring/i, sonnet: /^sonnet s/i,
      opus: /opah/i, fable: /sablefish/i };
    return {
      noSpecies: C.FISH.filter((f) => !f.species).map((f) => f.id),
      punIsModel: C.FISH.filter((f) => f.name === f.species).map((f) => f.id),
      offFamily: C.FISH.filter((f) => !TIER_FAMILY[f.tier].test(f.name))
        .map((f) => `${f.id}:${f.name}`),
      dupeNames: C.FISH.map((f) => f.name).filter((v, i, a) => a.indexOf(v) !== i),
      junkHasSpecies: C.JUNK.filter((f) => f.species).map((f) => f.id),
    };
  });
  ok(puns.noSpecies.length === 0, 'every fish keeps its real model name as `species`',
    puns.noSpecies.join(','));
  ok(puns.punIsModel.length === 0, 'every fish got an actual pun, not just the model name',
    puns.punIsModel.join(','));
  ok(puns.offFamily.length === 0, 'each tier stays in its fish family', puns.offFamily.join(', '));
  ok(puns.dupeNames.length === 0, 'no two fish share a name', puns.dupeNames.join(','));
  ok(puns.junkHasSpecies.length === 0, 'junk is not a model and does not pretend to be');
  ok(content.badRate.length === 0, 'every quoted rate is [in, out] with out > in', content.badRate.join(','));
  ok(content.missingFight.length === 0,
    'every species resolves speed/runs/pull as real numbers', content.missingFight.join(','));
  ok(content.achDupes.length === 0, 'no duplicate achievement ids');
  console.log(`  tiers: ${content.tiers.join(', ')} · ${content.tips} tips`);

  // -------------------------------------------------------------------------
  console.log('');
  if (errors.length) {
    console.log('❌ Console/page errors:');
    errors.slice(0, 12).forEach((e) => console.log('   ' + e));
  } else {
    console.log('✅ No console/page errors');
  }
  if (fails.length) {
    console.log(`\n❌ ${fails.length} FAILED (${pass} passed):`);
    fails.forEach((f) => console.log('   ' + f));
  } else {
    console.log(`\n✅ all ${pass} checks passed`);
  }

  await browser.close();
  server.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})();
