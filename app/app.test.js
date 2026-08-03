// DB-free tests, runnable with `node --test` (no deps, no Postgres, no network). Covers the schema
// normalization contract (parity with the Go/Python/Rust starters) and the /health_check probe.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { handler } = require('./server');
const { normalizeSchema, appDbSecretId } = require('./db');

// Parity with the Go/Python/Rust starters: lowercase; non-[a-z0-9_] -> _; strip leading
// non-letters; cap 48; fall back to "app" when nothing remains. (Quoting, not tested here, lets a
// reserved word like "user" survive in DDL.)
test('normalizeSchema produces a safe SQL identifier', () => {
  const cases = [
    ['my-app', 'my_app'],
    ['My App', 'my_app'],
    ['1abc', 'abc'],
    ['___leading', 'leading'],
    ['', 'app'],
    ['42', 'app'],
    ['user', 'user'],
    ['a.b/c', 'a_b_c'],
    ['UPPER_snake-99', 'upper_snake_99'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(normalizeSchema(raw), want, `normalizeSchema(${JSON.stringify(raw)})`);
  }
  assert.equal(normalizeSchema('a'.repeat(60)).length, 48); // cap at 48 chars
});

// Per-app credential resolution (#471): an explicit ARN wins; else prefix + this app's raw slug;
// else undefined (the caller falls back to the legacy shared secret / no persistence).
test('appDbSecretId prefers APP_DB_SECRET_ARN, then derives from the prefix + slug', () => {
  // Save/restore ONLY the keys this test mutates. Never reassign process.env wholesale: that
  // swaps Node's special env proxy for a plain object and can degrade later tests in the worker.
  const keys = ['APP_SCHEMA', 'APP_DB_SECRET_ARN', 'APP_DB_SECRET_PREFIX'];
  const saved = keys.map((key) => [key, process.env[key]]);
  try {
    process.env.APP_SCHEMA = 'my-app';
    process.env.APP_DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:explicit';
    process.env.APP_DB_SECRET_PREFIX = 'aix-proto/apps-db';
    assert.equal(appDbSecretId(), 'arn:aws:secretsmanager:us-east-1:1:secret:explicit');

    delete process.env.APP_DB_SECRET_ARN;
    assert.equal(appDbSecretId(), 'aix-proto/apps-db/my-app'); // RAW slug, not the normalized schema

    delete process.env.APP_DB_SECRET_PREFIX;
    assert.equal(appDbSecretId(), undefined); // pre-#471 deploy -> legacy fallback
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /health_check returns 200 {"status":"ok"}', async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health_check`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Mudslides ranks on distance / near misses / top speed / tokens, which the
// shared arcade board (one dollar figure per stage) cannot express. This covers
// the per-game endpoint end to end against the DB-free memory store.
test('GET /api/leaderboards/<game> ranks each metric by each player\'s best run', async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const post = (hubId, result) => fetch(`http://127.0.0.1:${port}/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aix-hub-id': hubId },
    body: JSON.stringify({ result }),
  });
  try {
    const run = (o) => Object.assign(
      { game: 'mudslides', stageId: 'endless', outcome: 'death' }, o,
    );
    await post('alice', run({ distance: 900, nearMisses: 3, topSpeed: 1500, tokensEarned: 400 }));
    await post('alice', run({ distance: 2100, nearMisses: 1, topSpeed: 2900, tokensEarned: 150 }));
    await post('bob', run({ distance: 1500, nearMisses: 22, topSpeed: 2000, tokensEarned: 900 }));
    // a different game must not leak into this board
    await post('bob', run({ game: 'waste-hunter', distance: 99999, tokensEarned: 99999 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/leaderboards/mudslides`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.game, 'mudslides');
    assert.deepEqual(Object.keys(body.metrics).sort(),
      ['distance', 'heaviest', 'nearMisses', 'streak', 'tokens', 'topSpeed']);

    // best run per player, not latest: alice's 2100m beats bob's 1500m
    assert.deepEqual(body.metrics.distance.map((r) => [r.player, r.value]),
      [['alice', 2100], ['bob', 1500]]);
    // ...and her best token run is the 400 one, even though it was not her best distance
    assert.deepEqual(body.metrics.tokens.map((r) => [r.player, r.value]),
      [['bob', 900], ['alice', 400]]);
    assert.deepEqual(body.metrics.nearMisses.map((r) => [r.player, r.value]),
      [['bob', 22], ['alice', 3]]);
    assert.deepEqual(body.metrics.topSpeed.map((r) => [r.player, r.value]),
      [['alice', 2900], ['bob', 2000]]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/leaderboards/<game> ranks fishing on streak, and weight in kg', async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const post = (hubId, result) => fetch(`http://127.0.0.1:${port}/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aix-hub-id': hubId },
    body: JSON.stringify({ result }),
  });
  try {
    const trip = (o) => Object.assign(
      { game: 'holiday-in-colombia', stageId: 'lake', outcome: 'clear' }, o,
    );
    await post('cara', trip({ streak: 4, heaviest: 8.25, tokensEarned: 120 }));
    await post('cara', trip({ streak: 9, heaviest: 3.4, tokensEarned: 60 }));
    await post('dev', trip({ streak: 6, heaviest: 44.1, tokensEarned: 300 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/leaderboards/holiday-in-colombia`);
    assert.equal(res.status, 200);
    const body = await res.json();
    // best run per player: cara's 9 beats dev's 6
    assert.deepEqual(body.metrics.streak.map((r) => [r.player, r.value]),
      [['cara', 9], ['dev', 6]]);
    // stored in grams, handed back in kg — a caller never sees the unit trick
    assert.deepEqual(body.metrics.heaviest.map((r) => [r.player, r.value]),
      [['dev', 44.1], ['cara', 8.25]]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/leaderboards/<game> rejects a game name that is not a slug', async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/leaderboards/${encodeURIComponent("x'; DROP TABLE runs;--")}`);
    assert.equal(res.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// admin reset
// The default owner hub id, matching ARCADE_ADMIN_HUB_IDS' fallback. The front door
// strips x-aix-username, so hub id is the only identity that survives in production
// and therefore the only one worth testing the gate on.
// ---------------------------------------------------------------------------
const OWNER = '70009486';

// One test walks the whole sequence deliberately: the memory store is module state
// shared by every test in this file, so splitting these into independent cases would
// make them order-dependent on each other rather than self-contained.
test('POST /api/admin/reset gates on the owner, on scope, and on a typed confirmation', async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const as = (hubId, path, opts) => fetch(base + path, Object.assign({
    headers: { 'content-type': 'application/json', 'x-aix-hub-id': hubId },
  }, opts));
  const resetAs = (hubId, body) => as(hubId, '/api/admin/reset',
    { method: 'POST', body: JSON.stringify(body) });

  try {
    // seed: a player with a banked wallet, a run, and a session (touched by /api/me)
    await as('carol', '/api/me');
    await as('carol', '/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ profile: { games: { _wallet: { tokens: 40, banked: 250 } } } }),
    });
    await as('carol', '/api/score', {
      method: 'POST',
      body: JSON.stringify({ result: { game: 'mudslides', stageId: 'endless', outcome: 'death' } }),
    });

    // a player who is not the owner cannot reach it at all
    const denied = await resetAs('carol', { scope: 'runs' });
    assert.equal(denied.status, 403);

    // "all" without the typed token is refused, and changes nothing
    const unconfirmed = await resetAs(OWNER, { scope: 'all' });
    assert.equal(unconfirmed.status, 400);
    assert.match((await unconfirmed.json()).need, /"confirm":"RESET"/);
    const stillThere = await (await as(OWNER, '/api/admin/summary')).json();
    assert.ok(stillThere.players.some((p) => p.hub_id === 'carol'), 'carol survived a refused reset');

    // scope "runs" clears the ledger but leaves wallets and the fund standing
    const runsOnly = await resetAs(OWNER, { scope: 'runs' });
    assert.equal(runsOnly.status, 200);
    const ro = await runsOnly.json();
    assert.equal(ro.scope, 'runs');
    assert.equal(ro.cleared, 'runs');
    assert.equal(ro.after.runs, 0);
    assert.ok(ro.before.runs > 0, 'there was a run to clear');
    assert.ok(ro.after.players > 0, 'players are untouched by a runs-only reset');
    assert.equal(ro.resetEpoch, 0, 'a runs-only reset does not invalidate local wallets');
    // and the fund is still standing, because the profile blob was not touched
    assert.equal((await (await as('carol', '/api/me')).json()).pool.total, 250);

    // scope "all" with the token clears everything and stamps the epoch
    const wipe = await resetAs(OWNER, { scope: 'all', confirm: 'RESET' });
    assert.equal(wipe.status, 200);
    const w = await wipe.json();
    assert.equal(w.cleared, 'runs + sessions + players');
    assert.deepEqual(w.after, { players: 0, runs: 0, sessions: 0 });
    assert.ok(w.resetEpoch > 0, 'a full reset stamps an epoch');

    // ...and every client learns about it, which is what makes browsers drop their
    // local copy instead of pushing it back up
    const me = await (await as('carol', '/api/me')).json();
    assert.equal(me.resetEpoch, w.resetEpoch);
    assert.equal(me.pool.total, 0);
    assert.equal(me.hasServerProfile, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// `{players: true}` is how the endpoint was called before scopes existed. It has to
// keep meaning "everything", or an old bookmark silently becomes a runs-only reset.
test('POST /api/admin/reset still honours the pre-scope {players:true} spelling', async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const post = (body) => fetch(`http://127.0.0.1:${port}/api/admin/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aix-hub-id': OWNER },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await post({ players: true })).status, 400);   // still needs confirming
    const res = await post({ players: true, confirm: 'RESET' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).scope, 'all');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
