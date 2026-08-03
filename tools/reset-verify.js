/* Proves the reset actually resets — including the half that lives in the browser.
 *
 * The gap this exists to close: clearing the server is not enough, because every
 * wallet is local-first and gets pushed back up on the next page load. So this
 * seeds a purse, banks it, wipes the server, reloads, and asserts the money is
 * really gone rather than restored from localStorage.
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');

const APP = '/home/briant/aix-proto/examples/costbot-arcade';
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { fail += 1; console.log('  FAIL ' + label); }
};

(async () => {
  const srv = spawn('node', [path.join(APP, 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      ARCADE_PUBLIC: path.join(APP, 'public'),
      ARCADE_ADMIN_HUB_IDS: 'local-dev',      // the local dev identity is the owner here
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => process.stdout.write('    [srv] ' + d));
  srv.stderr.on('data', (d) => process.stdout.write('    [srv] ' + d));
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Three failed requests are the POINT of parts of this test, not a defect:
  // /whoami has no control plane in front of a local server, the unconfirmed reset
  // is supposed to 400, and the non-owner page load is supposed to 404.
  const expected = /whoami|favicon|status of (400|404)/;
  page.on('console', (m) => {
    if (m.type() === 'error' && !expected.test(m.text())) errors.push(m.text());
  });

  try {
    console.log('\n▶ Seed a purse and bank it');
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => window.ArcadeWallet && window.ArcadeSync);
    await page.evaluate(async () => {
      window.ArcadeWallet.earn(1200, 'mudslides');
      window.ArcadeWallet.earn(800, 'holiday-in-colombia');
      window.ArcadeWallet.bank(1500);          // most of it to the fund, some on hand
    });
    await page.waitForTimeout(400);            // let the debounced profile push flush
    let w = await page.evaluate(() => window.ArcadeWallet.snapshot());
    ok(w.banked === 1500 && w.tokens === 500, `seeded — ${w.banked} banked, ${w.tokens} on hand`);

    // reload so the purse is proven to persist at all (otherwise the test below is vacuous)
    await page.reload();
    await page.waitForFunction(() => window.ArcadeWallet);
    await page.evaluate(() => window.ArcadeWallet.init());
    w = await page.evaluate(() => window.ArcadeWallet.snapshot());
    ok(w.banked === 1500, 'and it survives a reload — so localStorage really is the source');

    const seenByServer = await page.evaluate(async () =>
      (await (await fetch('api/me', { credentials: 'same-origin' })).json()).pool);
    ok(seenByServer.total === 1500, `the server sees the fund too — ${seenByServer.total}`);

    console.log('\n▶ A runs-only reset must NOT touch the money');
    let r = await page.evaluate(async () => (await (await fetch('api/admin/reset', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: '{"scope":"runs"}',
    })).json()));
    ok(r.ok && r.scope === 'runs', 'runs reset accepted');
    ok(r.resetEpoch === 0, 'and it does not stamp an epoch, so no browser is invalidated');
    await page.reload();
    await page.waitForFunction(() => window.ArcadeWallet);
    await page.evaluate(() => window.ArcadeWallet.init());
    w = await page.evaluate(() => window.ArcadeWallet.snapshot());
    ok(w.banked === 1500 && w.tokens === 500, 'the purse and the fund are untouched');

    console.log('\n▶ "all" without the typed token changes nothing');
    r = await page.evaluate(async () => {
      const res = await fetch('api/admin/reset', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: '{"scope":"all"}',
      });
      return { status: res.status, body: await res.json() };
    });
    ok(r.status === 400, 'refused with 400');
    ok(/confirm/.test(JSON.stringify(r.body)), 'and it says how to confirm');
    const stillFunded = await page.evaluate(async () =>
      (await (await fetch('api/me', { credentials: 'same-origin' })).json()).pool.total);
    ok(stillFunded === 1500, 'fund still standing after the refusal');

    console.log('\n▶ The full wipe, and the browser honouring it');
    r = await page.evaluate(async () => (await (await fetch('api/admin/reset', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"scope":"all","confirm":"RESET"}',
    })).json()));
    ok(r.ok && r.cleared === 'runs + sessions + players', `cleared ${r.cleared}`);
    ok(r.before.players > 0 && r.after.players === 0, 'counts show the players table emptied');
    ok(r.resetEpoch > 0, 'epoch stamped');

    // THE point of this file: reload and confirm the browser drops its copy instead
    // of pushing 1500 banked tokens straight back into a freshly emptied database.
    await page.reload();
    await page.waitForFunction(() => window.ArcadeWallet && window.ArcadeSync);
    await page.evaluate(async () => { await window.ArcadeSync.init(); window.ArcadeWallet.init(); });
    w = await page.evaluate(() => window.ArcadeWallet.snapshot());
    ok(w.banked === 0 && w.tokens === 0 && w.earned === 0,
      `the local purse is gone — ${w.banked} banked, ${w.tokens} on hand, ${w.earned} earned`);

    // The wallet re-writes its own (now empty) key immediately after the purge, so the
    // test is "nothing carries a number", not "no keys exist".
    const left = await page.evaluate(() => Object.keys(localStorage)
      .filter((k) => k.indexOf('costbot.') === 0 && k !== 'costbot.arcade.reset')
      .map((k) => [k, localStorage.getItem(k)]));
    ok(!left.some(([, v]) => /[1-9]/.test(String(v))),
      'no local key carries a surviving figure: ' + JSON.stringify(left));

    const after = await page.evaluate(async () =>
      (await (await fetch('api/me', { credentials: 'same-origin' })).json()).pool.total);
    ok(after === 0, `and nothing was pushed back up — server fund is ${after}`);

    // the stamp must stop it re-firing: earn again, reload, keep it
    await page.evaluate(() => window.ArcadeWallet.earn(77, 'mudslides'));
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => window.ArcadeWallet && window.ArcadeSync);
    await page.evaluate(async () => { await window.ArcadeSync.init(); window.ArcadeWallet.init(); });
    w = await page.evaluate(() => window.ArcadeWallet.snapshot());
    ok(w.tokens === 77, `the purge runs once, not every load — ${w.tokens} on hand after re-earning`);

    console.log('\n▶ The Usage page danger zone');
    await page.goto(BASE + '/usage/index.html');
    await page.waitForSelector('#danger:not([hidden])', { timeout: 5000 });
    ok(await page.isVisible('#danger'), 'danger zone is shown to the owner');
    ok(await page.isDisabled('#reset-all'), 'the wipe button starts disabled');
    await page.fill('#confirm-box', 'reset me');
    ok(await page.isDisabled('#reset-all'), 'and stays disabled for the wrong word');
    await page.fill('#confirm-box', 'reset');
    ok(!(await page.isDisabled('#reset-all')), 'arms on the right word, case-insensitively');
    await page.screenshot({ path: '/tmp/reset-danger-zone.png', fullPage: true });
    console.log('    📸 /tmp/reset-danger-zone.png');

    console.log('\n▶ A non-owner sees none of it');
    const other = await browser.newContext({ extraHTTPHeaders: { 'x-aix-hub-id': 'someone-else' } });
    const op = await other.newPage();
    const res = await op.goto(BASE + '/usage/index.html');
    ok(res.status() === 404, `the page itself 404s for them — got ${res.status()}`);
    const apiStatus = await op.evaluate(async () => {
      const r2 = await fetch('/api/admin/reset', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: '{"scope":"all","confirm":"RESET"}',
      });
      return r2.status;
    });
    ok(apiStatus === 403, `and the reset API refuses them — ${apiStatus}`);
    await other.close();

    console.log(errors.length ? '\n❌ console errors:\n' + errors.join('\n') : '\n✅ No console/page errors');
    if (errors.length) fail += 1;
  } catch (err) {
    console.log('\n💥 ' + err.message);
    fail += 1;
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
