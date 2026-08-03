/* Regression check for the Bot Bay purse.
 *
 * The Bot Bay once read TWO different balances: the header showed the shared
 * arcade wallet while every buy/bank button gated on `meta.tokens`, a dead
 * pre-wallet field that ArcadeWallet zeroes on migration and never credits
 * again. Players saw a real balance and could buy nothing.
 *
 * This reproduces exactly that state — tokens in the wallet, the legacy field
 * zeroed, as a migrated player actually has it — and asserts the shop is live.
 *   node botbay-check.js
 */
const { chromium } = require('/home/briant/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
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

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Seed the exact post-migration shape: wallet holds the tokens, the cabinet's
  // legacy ledger is zeroed and flagged migrated.
  // addInitScript re-runs on EVERY navigation, so it must seed only once —
  // otherwise the reload check below silently re-seeds and always "passes".
  await page.addInitScript(() => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    localStorage.setItem('costbot.arcade.wallet.v1', JSON.stringify({
      tokens: 8000, banked: 0, earned: 8000, byGame: { 'waste-hunter': 8000 }, migrated: true,
    }));
    localStorage.setItem('costbot.wastehunter.v1', JSON.stringify({
      version: 2, tokens: 0, lifetimeTokens: 8000, banked: 0, lifetimeDollars: 0,
      runs: 1, upgrades: {}, achievements: {}, best: {}, cleared: {},
    }));
  });

  await page.goto(`http://127.0.0.1:${PORT}/waste-hunter/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game, null, { timeout: 15000 });

  console.log('\n▶ Post-migration player: 8,000 in the wallet, legacy field zeroed');
  const seeded = await page.evaluate(() => ({
    wallet: window.ArcadeWallet.tokens,
    legacy: (window.game.meta || {}).tokens,
  }));
  ok(seeded.wallet === 8000, `wallet on hand = ${seeded.wallet}`);
  ok(!seeded.legacy, `legacy meta.tokens = ${seeded.legacy} (dead field, as after migration)`);

  console.log('\n▶ Bot Bay reflects the wallet, not the dead field');
  await page.evaluate(() => window.game.screenBay());
  await page.waitForSelector('.wh-shop', { timeout: 5000 });

  const shop = await page.evaluate(() => {
    const buys = Array.from(document.querySelectorAll('[data-buy]'));
    const banks = Array.from(document.querySelectorAll('[data-bank]'));
    return {
      header: (document.querySelector('.wh-scroll b') || {}).textContent,
      buys: buys.length,
      buysEnabled: buys.filter((b) => !b.disabled).length,
      banksEnabled: banks.filter((b) => !b.disabled).length,
      firstAffordable: (() => {
        const b = buys.find((x) => !x.disabled);
        return b ? b.dataset.buy : null;
      })(),
    };
  });
  ok(shop.header === '8,000', `header shows ${shop.header}`);
  ok(shop.buysEnabled > 0, `${shop.buysEnabled}/${shop.buys} upgrades affordable — the actual bug: this was 0`);
  ok(shop.banksEnabled > 0, `${shop.banksEnabled} bank buttons live — also 0 before`);

  console.log('\n▶ Buying really moves tokens out of the shared wallet');
  const before = await page.evaluate(() => window.ArcadeWallet.tokens);
  await page.click(`[data-buy="${shop.firstAffordable}"]`);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    tokens: window.ArcadeWallet.tokens,
    lvl: (window.game.meta.upgrades || {})[
      document.body.dataset.__unused || ''
    ],
    upgrades: Object.assign({}, window.game.meta.upgrades),
  }));
  ok(after.tokens < before, `wallet went ${before} -> ${after.tokens}`);
  ok((after.upgrades[shop.firstAffordable] || 0) === 1,
    `"${shop.firstAffordable}" is now level ${after.upgrades[shop.firstAffordable] || 0}`);

  console.log('\n▶ Purse survives a reload (localStorage really is the source)');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.game, null, { timeout: 15000 });
  const reloaded = await page.evaluate(() => window.ArcadeWallet.tokens);
  ok(reloaded === after.tokens, `still ${reloaded} after reload`);

  console.log('\n▶ A player with nothing still cannot buy');
  await page.evaluate(() => { window.ArcadeWallet.bank(); });   // give it all away
  await page.evaluate(() => window.game.screenBay());
  await page.waitForSelector('.wh-shop', { timeout: 5000 });
  const broke = await page.evaluate(() => ({
    tokens: window.ArcadeWallet.tokens,
    buysEnabled: Array.from(document.querySelectorAll('[data-buy]')).filter((b) => !b.disabled).length,
  }));
  ok(broke.tokens === 0 && broke.buysEnabled === 0,
    `0 on hand -> ${broke.buysEnabled} affordable (the gate still works, it just reads the right purse)`);

  ok(errors.length === 0, errors.length ? 'page errors: ' + errors.join('; ') : 'no page errors');

  await browser.close();
  server.close();
  console.log(fails ? `\n❌ ${fails} check(s) failed` : '\n✅ Bot Bay purse checks all passed');
  process.exit(fails ? 1 : 0);
})();
