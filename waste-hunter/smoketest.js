/* Headless smoke test for CostBot: Waste Hunter.
 * Boots the game, drives it, answers trivia, screenshots each screen, and
 * reports console errors.
 *   node smoketest.js
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');   // serve the arcade so ../shared/ resolves
const OUT = path.join(DIR, 'shots');
const PORT = 8791;

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  // ArcadeSync deliberately probes /api/me and disables itself when nothing answers,
  // which is the normal path on static hosting — so that one 404 is expected, not a failure.
  const EXPECTED_404 = /api\/me/;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.location() && EXPECTED_404.test(m.location().url || '')) return;
    errors.push('CONSOLE: ' + m.text());
  });
  page.on('requestfailed', (r) => { if (!EXPECTED_404.test(r.url())) errors.push('REQFAIL: ' + r.url()); });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  📸 ' + name);
  };
  const probe = () => page.evaluate(() => {
    const g = window.game;
    if (!g) return { err: 'no game instance' };
    if (!g.run) return { screen: 'menu' };
    const r = g.run;
    return {
      screen: 'run', t: +r.t.toFixed(1), hp: Math.round(r.p.hp), maxHp: Math.round(r.p.maxHp),
      level: r.p.level, dollars: Math.round(r.dollars), kills: r.kills,
      enemies: r.enemies.length, orbs: r.orbs.length,
      weapons: Object.keys(r.p.weapons),
      quiz: r.stats.quizCorrect + '/' + (r.stats.quizCorrect + r.stats.quizWrong),
      drafting: g.drafting, over: r.over, outcome: r.outcome,
      boss: r.boss ? r.boss.def.name : null,
    };
  });

  // Answers the on-screen question by looking the correct choice up in the
  // content bank — this also verifies the shuffle/render path stays consistent.
  const answerQuiz = (wantCorrect) => page.evaluate((correct) => {
    const qEl = document.querySelector('.wh-quiz-q');
    if (!qEl) return { err: 'no question on screen' };
    const qt = qEl.textContent.trim();
    const item = WH_CONTENT.TRIVIA.find((x) => x.q === qt);
    if (!item) return { err: 'question not found in bank: ' + qt.slice(0, 60) };
    const want = item.c[item.a];
    const btns = Array.from(document.querySelectorAll('.wh-choice'));
    const right = btns.find((b) => b.querySelector('span').textContent.trim() === want);
    if (!right) return { err: 'correct choice not rendered: ' + want };
    const target = correct ? right : btns.find((b) => b !== right && !b.disabled);
    if (!target) return { err: 'no alternative choice' };
    target.click();
    return { ok: true, answered: correct ? 'correct' : 'wrong' };
  }, wantCorrect);

  // Full level-up cycle: choose an upgrade, answer its quiz, wait out the reveal.
  let drafts = 0, quizOk = 0, quizBad = 0;
  const resolveLevelUp = async (shots) => {
    if (!(await page.$('.wh-pick'))) return false;
    if (shots) await shot('04-levelup-draft');
    const picks = await page.$$('.wh-pick');
    await picks[drafts % picks.length].click();
    await page.waitForTimeout(260);
    if (shots) await shot('05-trivia-question');

    const wantCorrect = drafts % 4 !== 3;          // deliberately miss ~1 in 4
    const res = await answerQuiz(wantCorrect);
    if (res.err) { warnings.push('quiz: ' + res.err); console.log('  ⚠️  ' + res.err); }
    else if (wantCorrect) quizOk++; else quizBad++;

    await page.waitForTimeout(500);
    if (shots) await shot('06-trivia-reveal');
    const reveal = await page.evaluate(() => WH_CONTENT.TRIVIA_RULES.revealMs);
    await page.waitForTimeout(reveal + 400);
    drafts++;
    return true;
  };

  console.log('\n▶ Loading title screen…');
  await page.goto(`http://localhost:${PORT}/waste-hunter/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot('01-title');

  console.log('▶ Stage select…');
  await page.click('[data-act="play"]');
  await page.waitForTimeout(600);
  await shot('02-stages');

  console.log('▶ Starting stage 1…');
  // Drive the run off a fixed seed so pacing runs stay comparable to each other.
  await page.evaluate(() => window.game.startRun('ec2-graveyard', 20260801));
  await page.waitForTimeout(1000);
  await shot('03-intro-banner');

  // A crude-but-real autopilot: steer to the nearest savings orb, back off when
  // an enemy gets close. Drives the game's own pointer-steering path. This is a
  // far better pacing proxy than mashing direction keys.
  const startAutopilot = () => page.evaluate(() => {
    if (window.__ap) clearInterval(window.__ap);
    window.__ap = setInterval(() => {
      const g = window.game;
      if (!g || !g.run || g.run.over || g.drafting) return;
      const r = g.run, p = r.p;
      let near = null, nd = 1e9;
      for (const e of r.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < nd) { nd = d; near = e; }
      }
      let tx, ty;
      if (near && nd < 110) {            // flee
        tx = p.x - (near.x - p.x) * 3;
        ty = p.y - (near.y - p.y) * 3;
      } else {                            // collect
        let best = null, bd = 1e9;
        for (const o of r.orbs) {
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d < bd) { bd = d; best = o; }
        }
        if (best) { tx = best.x; ty = best.y; }
        else if (near) { tx = near.x; ty = near.y; }   // no orbs: go hunt
        else { tx = 1300; ty = 875; }
      }
      tx = Math.max(60, Math.min(2540, tx));
      ty = Math.max(60, Math.min(1690, ty));
      g.pointer.x = tx - r.cam.x;
      g.pointer.y = ty - r.cam.y;
      g.pointer.down = true;
    }, 60);
  });
  await startAutopilot();

  // FULL=1 plays the entire stage on autopilot — slower, but the only way to
  // see the late-stage difficulty curve.
  const FULL = !!process.env.FULL;
  const ITERS = FULL ? 300 : 70;
  console.log(`▶ Playing on autopilot… (${FULL ? 'FULL stage' : 'short sample'})`);
  let lastLog = -99;
  for (let i = 0; i < ITERS; i++) {
    await page.waitForTimeout(700);
    await resolveLevelUp(drafts === 0);
    if (i === 30) await shot('07-combat');
    const s = await probe();
    if (FULL && s.t - lastLog >= 20) {
      lastLog = s.t;
      console.log(`   t=${s.t}s  lvl=${s.level}  hp=${s.hp}/${s.maxHp}  enemies=${s.enemies}  $${s.dollars}  quiz=${s.quiz}`);
    }
    if (s.over) break;
    if (s.boss) { console.log('   boss arrived naturally at t=' + s.t); break; }
  }

  const mid = await probe();
  console.log('  state:', JSON.stringify(mid));
  console.log(`  level-ups: ${drafts}  ·  quiz answered right: ${quizOk}, wrong on purpose: ${quizBad}`);
  if (mid.over) console.log('  ⚠️  died during the autopilot window');

  if (mid.over) {
    console.log('▶ Restarting for boss test…');
    await page.click('[data-act="again"]');
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => { const p = window.game.run.p; p.maxHp = 100000; p.hp = 100000; });

  console.log('▶ Fast-forwarding to boss…');
  await page.evaluate(() => { window.game.run.t = window.game.run.stage.duration - 1.2; });
  let bossState = null;
  for (let i = 0; i < 30; i++) {
    await resolveLevelUp(false);
    await page.waitForTimeout(300);
    bossState = await probe();
    if (bossState.boss) break;
  }
  await shot('08-boss');
  console.log('  boss:', bossState.boss, '| enemies:', bossState.enemies);
  if (!bossState.boss) { errors.push('boss did not spawn'); }

  console.log('▶ TERMINATE ALL flash…');
  await page.evaluate(() => { window.game.run.flash = { life: 1.5, max: 1.5 }; });
  await page.waitForTimeout(220);
  await shot('08b-terminate-all');

  console.log('▶ Killing boss → victory lap → stage clear…');
  // Killing the boss opens a short collection lap rather than ending the run on
  // the spot. That mattered: a clear used to strand every orb still on the floor.
  const lap = await page.evaluate(async () => {
    const g = window.game;
    const b = g.run.boss; if (b) b.hp = -1;
    for (let i = 0; i < 30; i++) g.update(1 / 60);      // half a second in
    const mid = { lap: g.run.lap, over: g.run.over, orbs: g.run.orbs.length };
    // sweep the remaining orbs onto the player, which is what the lap is for
    const p = g.run.p;
    g.run.orbs.forEach((o) => { o.x = p.x; o.y = p.y; });
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const swept = { orbs: g.run.orbs.length, dollars: Math.round(g.run.dollars) };
    for (let i = 0; i < 60 * 4; i++) { if (g.run.over) break; g.update(1 / 60); }
    return { mid, swept, over: g.run.over, outcome: g.run.outcome,
             lapLength: window.WH_CONTENT.VICTORY_LAP };
  });
  const lapOk = lap.mid.lap > 0 && !lap.mid.over;
  console.log('  lap:', lap.lapLength + 's ·',
    lapOk ? '✅ run stays live during it' : '❌ run ended immediately',
    '· orbs ' + lap.mid.orbs + ' -> ' + lap.swept.orbs,
    '· ends ' + (lap.outcome || '?'));
  if (!lapOk) errors.push('boss kill did not open a collection lap');
  if (lap.swept.orbs >= lap.mid.orbs) errors.push('orbs could not be collected during the lap');
  if (lap.outcome !== 'clear') errors.push('victory lap did not end in a clear');
  await page.waitForTimeout(600);
  await resolveLevelUp(false);
  await page.waitForTimeout(2200);
  await shot('09-stage-clear');
  const cleared = await probe();
  console.log('  state:', JSON.stringify(cleared));
  console.log('  outcome:', cleared.outcome === 'clear' ? '✅ clear' : '❌ ' + cleared.outcome);
  if (cleared.outcome !== 'clear') errors.push('stage did not clear');

  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('costbot.wastehunter.v1')));
  console.log('  meta:', JSON.stringify(meta));

  const stagesBtn = await page.$('[data-act="stages"]');
  if (stagesBtn) { await stagesBtn.click(); await page.waitForTimeout(500); await shot('10-stages-unlocked'); }
  await page.click('[data-act="back"]');
  await page.waitForTimeout(400);
  await page.click('[data-act="bay"]');
  await page.waitForTimeout(400);
  await shot('11-bot-bay');
  await page.click('[data-act="back"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="achs"]');
  await page.waitForTimeout(400);
  await shot('12-achievements');

  // --- how to play ----------------------------------------------------------
  // The bestiary is generated from the balance data, so assert it actually
  // covers it — a new enemy that never reaches this screen is the failure mode.
  console.log('▶ How to Play…');
  await page.click('[data-act="back"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="how"]');
  await page.waitForTimeout(400);
  await shot('12b-how-to-play');
  const brief = await page.evaluate(() => {
    const C = window.WH_CONTENT;
    const txt = document.querySelector('.wh-brief').innerText;
    return {
      sections: document.querySelectorAll('.wh-brief section').length,
      cards: document.querySelectorAll('.wh-be').length,
      mobs: Object.values(C.ENEMIES).filter((e) => txt.includes(e.name)).length,
      mobsTotal: Object.keys(C.ENEMIES).length,
      bosses: Object.values(C.BOSSES).filter((e) => txt.includes(e.name)).length,
      bossesTotal: Object.keys(C.BOSSES).length,
      pickups: Object.values(C.PICKUPS).filter((x) => txt.includes(x.name)).length,
      pickupsTotal: Object.keys(C.PICKUPS).length,
      junk: /undefined|NaN|\[object/.test(txt),
    };
  });
  console.log(`  bestiary: ${brief.mobs}/${brief.mobsTotal} enemies, ` +
    `${brief.bosses}/${brief.bossesTotal} bosses, ${brief.pickups}/${brief.pickupsTotal} pickups ` +
    `· ${brief.sections} sections`);
  if (brief.mobs !== brief.mobsTotal) errors.push('briefing omits an enemy');
  if (brief.bosses !== brief.bossesTotal) errors.push('briefing omits a boss');
  if (brief.pickups !== brief.pickupsTotal) errors.push('briefing omits a pickup');
  if (brief.junk) errors.push('briefing rendered undefined/NaN');
  await page.click('[data-act="back"]');
  await page.waitForTimeout(300);

  console.log('▶ Host-embed demo…');
  await page.goto(`http://localhost:${PORT}/waste-hunter/embed-example.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#stagebtns button');
  await page.waitForTimeout(2500);
  await shot('13-embedded');
  console.log('  mounted inside host:', await page.evaluate(() => !!(window.game && window.game.run)));

  // content sanity: every upgrade topic must have questions behind it
  // End-screen art rotates by outcome. A win must never show the battered bot and
  // a loss must never show a victory lap, so the pools have to stay disjoint.
  console.log('\n▶ End-screen art…');
  const art = await page.evaluate(() => {
    const g = window.game, C = WH_CONTENT;
    const seq = { win: [], loss: [], narrow: [] };
    for (let i = 0; i < 40; i++) {
      for (const pool of ['win', 'loss', 'narrow']) seq[pool].push(g.pickArt(pool));
    }
    const uniq = (a) => [...new Set(a)];
    const b2b = (a) => a.some((v, i) => i > 0 && v === a[i - 1]);
    return {
      win: uniq(seq.win).length, winPool: C.END_ART.win.length,
      loss: uniq(seq.loss).length, lossPool: C.END_ART.loss.length,
      narrow: uniq(seq.narrow),
      repeats: b2b(seq.win) || b2b(seq.loss),
      overlap: C.END_ART.win.filter((x) => C.END_ART.loss.includes(x)),
      missing: [...C.END_ART.win, ...C.END_ART.loss, ...C.END_ART.narrow]
        .filter((n) => !(g.img[n] && g.img[n].naturalWidth > 0)),
    };
  });
  const artOk = art.win === art.winPool && art.loss === art.lossPool
    && art.narrow.length === 1 && !art.repeats && !art.overlap.length && !art.missing.length;
  console.log(`  win ${art.win}/${art.winPool} · loss ${art.loss}/${art.lossPool}`
    + ` · narrow ${art.narrow.join(',')} · back-to-back ${art.repeats}`);
  if (!artOk) {
    errors.push('END ART: ' + JSON.stringify(art));
    console.log('  ❌ end-screen art rotation');
  } else {
    console.log('  ✅ every image rotates, pools disjoint, all decode');
  }

  console.log('\n▶ Content check…');
  const content = await page.evaluate(() => {
    const C = WH_CONTENT;
    const topics = {};
    C.TRIVIA.forEach((q) => { topics[q.topic] = (topics[q.topic] || 0) + 1; });
    const upgrades = [];
    Object.entries(C.WEAPONS).forEach(([id, w]) => { upgrades.push({ id, topic: w.topic }); });
    Object.entries(C.PASSIVES).forEach(([id, p]) => { upgrades.push({ id, topic: p.topic }); });
    const bad = C.TRIVIA.filter((q) => !q.q || !q.why || !Array.isArray(q.c) ||
      q.c.length < 2 || q.a == null || q.a < 0 || q.a >= q.c.length).map((q) => q.q);
    const byText = {};
    C.TRIVIA.forEach((q) => { byText[q.q] = (byText[q.q] || 0) + 1; });
    const dupes = Object.keys(byText).filter((k) => byText[k] > 1);
    const dupChoices = C.TRIVIA.filter((q) => new Set(q.c).size !== q.c.length).map((q) => q.q);
    return { total: C.TRIVIA.length, topics, upgrades, malformed: bad, dupes, dupChoices,
             missing: upgrades.filter((u) => !topics[u.topic]) };
  });
  console.log(`  ${content.total} questions across ${Object.keys(content.topics).length} topics`);
  console.log('  ' + Object.entries(content.topics).map(([k, v]) => `${k}:${v}`).join('  '));
  if (content.malformed.length) { errors.push('malformed questions: ' + content.malformed.join(' | ')); }
  if (content.dupes.length) { errors.push('duplicate question prompts: ' + content.dupes.join(' | ')); }
  if (content.dupChoices.length) { errors.push('duplicate choices within: ' + content.dupChoices.join(' | ')); }
  if (!content.dupes.length && !content.dupChoices.length) console.log('  ✅ no duplicate prompts or choices');
  if (content.missing.length) {
    errors.push('upgrades with no questions: ' + content.missing.map((u) => `${u.id}(${u.topic})`).join(', '));
  } else {
    console.log('  ✅ every upgrade topic has questions');
  }

  const music = await page.evaluate(() => {
    if (!window.ArcadeMusic) return { err: 'ArcadeMusic not loaded' };
    if (!window.ArcadeBiomes) return { err: 'ArcadeBiomes not loaded' };
    const g = window.game;
    const bad = [];
    Object.entries(ArcadeMusic.THEMES).forEach(([name, map]) => {
      ['menu', 'stage', 'boss'].forEach((slot) => {
        if (!map[slot] || !ArcadeMusic.TRACKS[map[slot]]) bad.push(`${name}.${slot}`);
      });
      if (!map.biome || !ArcadeBiomes.BIOMES[map.biome]) bad.push(`${name}.biome`);
    });
    return { tracks: Object.keys(ArcadeMusic.TRACKS), themes: Object.keys(ArcadeMusic.THEMES),
             biomes: Object.keys(ArcadeBiomes.BIOMES), bad,
             live: !!(g && g.music), track: g && g.music && g.music.track };
  });
  if (music.err) errors.push(music.err);
  else {
    console.log(`  tracks (${music.tracks.length}): ${music.tracks.join(', ')}`);
    console.log(`  biomes (${music.biomes.length}): ${music.biomes.join(', ')}`);
    console.log(`  themes (${music.themes.length}): ${music.themes.join(', ')} | attached: ${music.live}`);
    if (music.bad.length) errors.push('themes with unresolved slots: ' + music.bad.join(', '));
    else console.log('  ✅ every theme resolves menu/stage/boss + biome');
  }

  console.log('\n' + (errors.length ? '❌ FAILURES:' : '✅ No console/page errors'));
  errors.slice(0, 20).forEach((e) => { console.log('   ' + e); });
  if (warnings.length) { console.log('⚠️  warnings:'); warnings.slice(0, 10).forEach((w) => { console.log('   ' + w); }); }

  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
