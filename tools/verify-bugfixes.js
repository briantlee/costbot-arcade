/* Regression cover for four bugs reported off the floor on 2026-08-03.
 *
 *   1. Mudslides — hit terminal velocity (5,040) and the achievement never
 *      arrived. It DID unlock; the reload took it back.
 *   2. Waste Hunter — clear stage 2, visit the leaderboard, come back to a
 *      locked stage 3 and stage 2 to replay. Same cause as 1: the host booted
 *      from the server slice alone, so any lost profile write was a rollback,
 *      and the rollback was then written over the good local save.
 *   3. Mudslides — sliding under the tall signs did nothing. The tall Contract
 *      sign is a full-lane block, but it was DRAWN on posts with daylight
 *      underneath, so it looked like the one hazard it is not.
 *   4. Holiday in Colombia — a perfect cast was nearly half of every zone.
 *      Now it is the mark, and accuracy sizes the fish instead of gating it.
 *
 * Runs the real app server (in-memory store, no Postgres needed):
 *   node tools/verify-bugfixes.js
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ARCADE = path.resolve(__dirname, '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ARCADE, 'mudslides', 'shots');

function waitForServer(tries) {
  return new Promise((resolve, reject) => {
    const probe = (n) => {
      http.get(`${BASE}/api/hello`, (r) => { r.resume(); resolve(); })
        .on('error', () => (n <= 0 ? reject(new Error('server never came up'))
          : setTimeout(() => probe(n - 1), 250)));
    };
    probe(tries);
  });
}

const fails = [];
function ok(name, pass, detail) {
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) fails.push(name);
}

(async () => {
  const srv = spawn('node', [path.join(ARCADE, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), ARCADE_PUBLIC: ARCADE }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', (d) => process.stdout.write('    [srv] ' + d));
  process.on('exit', () => srv.kill());
  await waitForServer(24);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] });

  // ==========================================================================
  console.log('\n▶ Mudslides — Terminal Velocity survives a lost profile write');
  // ==========================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => ok('no page error', false, e.message));
    let drop = false;
    await page.route('**/api/profile', (r) =>
      (drop && r.request().method() === 'PUT' ? r.abort() : r.continue()));

    await page.goto(`${BASE}/mudslides/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.game && window.game.img);

    // a first run so the server has a profile to be stale against
    await page.evaluate(() => new Promise((res) => {
      const g = window.game;
      g.start(); g.spawnRow = () => {}; g.run.objs = [];
      setTimeout(() => { g.finish(); res(); }, 300);
    }));
    await page.waitForTimeout(600);

    drop = true;   // from here the writes never land
    const hit = await page.evaluate(() => new Promise((res) => {
      const g = window.game;
      g.start(); g.spawnRow = () => {}; g.run.objs = [];
      g.run.speed = 3000;
      g.run.power = { spot: 99, graviton: 99 };
      setTimeout(() => {
        const got = !!(g.profile.achievements && g.profile.achievements.ms_topspeed);
        const top = Math.round(g.run.topSpeed);
        g.finish();
        res({ got, top });
      }, 400);
    }));
    ok('the achievement fires at the cap', hit.got, `top speed ${hit.top}`);
    await page.waitForTimeout(500);

    drop = false;
    await page.goto(`${BASE}/mudslides/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.game && window.game.profile);
    const after = await page.evaluate(() => ({
      got: !!(window.game.profile.achievements || {}).ms_topspeed,
      shown: Array.from(document.querySelectorAll('.ms-ach')).length,
    }));
    ok('...and is still there after the reload', after.got,
      after.got ? 'kept' : 'ROLLED BACK — server copy won');
    await ctx.close();
  }

  // ==========================================================================
  console.log('\n▶ Waste Hunter — stage 3 stays unlocked across a leaderboard trip');
  // ==========================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => ok('no page error', false, e.message));
    let drop = false;
    await page.route('**/api/profile', (r) =>
      (drop && r.request().method() === 'PUT' ? r.abort() : r.continue()));

    await page.goto(`${BASE}/waste-hunter/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.game && window.game.meta);
    const clear = (n) => page.evaluate((i) => {
      const g = window.game;
      g.startRun(window.WH_CONTENT.STAGES[i].id, 1234);
      g.run.t = g.run.stage.duration;
      g.endRun('clear');
    }, n);

    await clear(0);
    await page.waitForTimeout(600);
    drop = true;                       // stage 2's write is the one that goes missing
    await clear(1);
    await page.waitForTimeout(300);

    await page.goto(`${BASE}/leaderboard/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    drop = false;
    await page.goto(`${BASE}/waste-hunter/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.game && window.game.meta);
    const back = await page.evaluate(() => ({
      s3: window.game.stageUnlocked(2),
      cleared: Object.keys(window.game.meta.cleared || {}),
    }));
    ok('stage 3 is still unlocked', back.s3, back.cleared.join(', '));

    // and the healed copy is what the server has now, so another machine agrees
    await page.waitForTimeout(700);
    const healed = await page.evaluate(async () => {
      const j = await (await fetch('/api/me')).json();
      const wh = j.profile && j.profile.games && j.profile.games['waste-hunter'];
      return Object.keys((wh && wh.cleared) || {});
    });
    ok('the server was healed, not left behind', healed.length === 2, healed.join(', '));

    // REGRESSION GUARD: a machine with nothing local must still adopt the server
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const p2 = await fresh.newPage();
    await p2.goto(`${BASE}/waste-hunter/index.html`, { waitUntil: 'networkidle' });
    await p2.waitForFunction(() => window.game && window.game.meta);
    const onNew = await p2.evaluate(() => ({
      s3: window.game.stageUnlocked(2),
      local: !!localStorage.getItem('costbot.wastehunter.v1'),
    }));
    ok('a fresh browser still inherits server progress', onNew.s3,
      `stage3=${onNew.s3}, wrote local=${onNew.local}`);
    await fresh.close();
    await ctx.close();
  }

  // ==========================================================================
  console.log('\n▶ Mudslides — the tall Contract sign reads as a wall');
  // ==========================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => ok('no page error', false, e.message));
    await page.goto(`${BASE}/mudslides/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.game && window.game.img);

    // Park one of each right in front of the camera and read the pixels: a wall
    // has no gap of background between its bottom edge and the mud.
    const look = await page.evaluate(() => new Promise((res) => {
      const g = window.game;
      g.start(); g.spawnRow = () => {}; g.run.objs = []; g.run.shields = 9;
      const mk = (t, lane) => {
        const def = window.MS_CONTENT.OBSTACLES[t];
        g.run.objs.push({ kind: 'obs', type: t, def, lane, full: false,
          z: g.run.z + 760, hit: true, passed: true,
          vendor: window.MS_CONTENT.VENDORS[0] });
      };
      mk('vendor_board', 0);
      mk('vendor_gantry', 2);
      setTimeout(() => res({
        ok: true, objs: g.run.objs.length, drawSignSrc: g.drawSign.toString(),
      }), 400);
    }));
    ok('both signs render without error', look.ok, `${look.objs} on the road`);
    // the body is filled for the FULL height now, and the posts are gone
    ok('the Contract sign is filled to the ground',
      /roundRect\(pr\.x - w \/ 2, top, w, h,/.test(look.drawSignSrc)
      && !/pr\.y - h \* 0\.34/.test(look.drawSignSrc),
      'full-height body, no floating panel on posts');

    await page.screenshot({ path: path.join(OUT, 'signs-after.png') });
    console.log('  📸 mudslides/shots/signs-after.png');
    await ctx.close();
  }

  // ==========================================================================
  console.log('\n▶ Holiday in Colombia — the perfect cast is the mark');
  // ==========================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => ok('no page error', false, e.message));
    await page.goto(`${BASE}/holiday-in-colombia/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.game);

    const geom = await page.evaluate(() => {
      const Z = window.HC_CONTENT.CAST.zones;
      const pad = window.HC_CONTENT.CAST.perfectPad;
      let from = 0; const out = [];
      for (const z of Z) {
        if (z.band >= 0) out.push({ label: z.label, share: (pad * 2) / (z.to - from) });
        from = z.to;
      }
      return { pad, shares: out };
    });
    const worst = Math.max(...geom.shares.map((s) => s.share));
    ok('the perfect window is a small slice of its zone', worst < 0.25,
      geom.shares.map((s) => `${s.label} ${(s.share * 100).toFixed(0)}%`).join(' · '));

    // Cast accuracy has to actually move the fish, and a loose cast must still catch.
    const sized = await page.evaluate(() => {
      const g = window.game;
      const def = window.HC_CONTENT.FISH.find((f) => f.kg >= 2) || window.HC_CONTENT.FISH[0];
      const avg = (acc) => {
        let t = 0;
        for (let i = 0; i < 4000; i++) t += g.rollCatch(def, Math.random, acc).kg;
        return t / 4000;
      };
      return { nominal: def.kg, name: def.name, mark: avg(1), mid: avg(0.5), edge: avg(0) };
    });
    ok('a cast on the mark lands a bigger fish', sized.mark > sized.mid * 1.1,
      `${sized.name}: mark ${sized.mark.toFixed(2)}kg vs mid ${sized.mid.toFixed(2)}kg`);
    ok('a loose cast lands a smaller one', sized.edge < sized.mid * 0.95,
      `edge ${sized.edge.toFixed(2)}kg (nominal ${sized.nominal}kg)`);

    // the grading itself: three casts into the same zone, three accuracies
    const graded = await page.evaluate(() => {
      const g = window.game;
      const shots = [];
      g.p.bait = 30;
      g.start();
      for (const m of [0.59, 0.66, 0.715]) {     // 'Deep' spans 0.46-0.72, centre 0.59
        g.run.phase = 'idle';
        g.doCast(); g.run.meter = m; g.lockCast();
        shots.push({ m, band: g.run.band, perfect: g.run.perfectCast,
          acc: +g.run.castAcc.toFixed(2) });
      }
      return shots;
    });
    const centre = graded[0], near = graded[1], edge = graded[2];
    ok('dead centre is perfect', centre.perfect && centre.acc === 1, JSON.stringify(centre));
    ok('a near miss is NOT perfect any more', !near.perfect && near.acc > 0.3,
      JSON.stringify(near));
    ok('...but it still lands in the same band', near.band === centre.band
      && edge.band === centre.band, `bands ${centre.band}/${near.band}/${edge.band}`);
    ok('the zone edge grades near zero', edge.acc < 0.15, JSON.stringify(edge));
    await ctx.close();
  }

  // ==========================================================================
  console.log('\n▶ The merge keeps records and does NOT refund balances');
  // ==========================================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/holiday-in-colombia/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.ArcadeSync);
    const merged = await page.evaluate(() => {
      const R = window.ArcadeSync.reconcile;
      // the server is a step behind: it never saw the last fish, and still
      // thinks the player has the bait they have since spent
      const server = { savedAt: 1000, bait: 40, lifetimeTokens: 500,
        dex: { haiku_a: { caught: 2, best: 1.1 } }, achievements: ['hc_first'],
        best: { tokens: 500, heaviest: 1.1, fish: 2, streak: 1 } };
      const local = { savedAt: 2000, bait: 6, lifetimeTokens: 900,
        dex: { haiku_a: { caught: 2, best: 1.1 }, fable_z: { caught: 1, best: 44.2 } },
        achievements: ['hc_first', 'hc_fable'],
        best: { tokens: 900, heaviest: 44.2, fish: 3, streak: 2 } };
      return R(server, local, { spendable: ['bait'] });
    });
    ok('the newer fish is kept', !!merged.dex.fable_z, JSON.stringify(merged.dex.fable_z));
    ok('the older fish is kept too', !!merged.dex.haiku_a);
    ok('achievements are unioned', merged.achievements.length === 2,
      merged.achievements.join(', '));
    ok('records take the better value', merged.best.heaviest === 44.2
      && merged.lifetimeTokens === 900, `heaviest ${merged.best.heaviest}kg`);
    ok('spent bait is NOT refunded', merged.bait === 6, `bait ${merged.bait} (not 40)`);

    // Sets and capped logs are different animals: trimming a set of ids to the
    // longer input drops entries the moment the two copies have diverged, which
    // is exactly the case this merge exists for.
    const lists = await page.evaluate(() => {
      const R = window.ArcadeSync.reconcile;
      const diverged = R(
        { savedAt: 1, achievements: ['a', 'b'], history: [{ t: 3, v: 'x' }, { t: 1, v: 'y' }] },
        { savedAt: 2, achievements: ['c', 'd'], history: [{ t: 4, v: 'z' }, { t: 3, v: 'x' }] },
      );
      return { ach: diverged.achievements, hist: diverged.history };
    });
    ok('a diverged SET keeps every id', lists.ach.length === 4, lists.ach.join(', '));
    ok('a capped LOG stays capped, newest first',
      lists.hist.length === 2 && lists.hist[0].t === 4 && lists.hist[1].t === 3,
      lists.hist.map((h) => h.t).join(','));
    await ctx.close();
  }

  await browser.close();
  srv.kill();
  console.log(fails.length ? `\n❌ ${fails.length} failed: ${fails.join(', ')}` : '\n✅ all checks passed');
  process.exit(fails.length ? 1 : 0);
})();
