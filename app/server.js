// CostBot Arcade — dynamic-tier aix-proto app.
//
// Serves the arcade (landing page, Waste Hunter, Jukebox) from ./public and backs it with a
// per-player profile and leaderboards in Postgres.
//
// Identity is NOT ours to manage: the platform front door authenticates every request with
// MyID and injects the verified viewer as `x-aix-hub-id` (plus AD groups as `x-aix-groups`).
// We never see or store a credential — the hub id IS the primary key. That also means a score
// cannot be submitted as somebody else, which is what makes the leaderboard worth having.
//
// Fail-safe: if the database is unavailable the arcade still serves and falls back to an
// in-memory store, so a DB outage degrades the leaderboard rather than taking the games down.
// The client keeps its localStorage copy too, so play never depends on the network.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const nodePath = require('node:path');
const { getPool } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
// The image ships a copy of the arcade at ./public. For a local dev loop, point
// ARCADE_PUBLIC at the real source tree instead and skip copying altogether:
//   ARCADE_PUBLIC=~/projects/costbot-arcade node server.js
const PUBLIC_DIR = process.env.ARCADE_PUBLIC
  ? nodePath.resolve(process.env.ARCADE_PUBLIC)
  : nodePath.join(__dirname, 'public');
const MAX_BODY_BYTES = 512 * 1024; // profiles are small; cap hard
// Node's default header cap is 16 KB, and that is NOT enough here. The front door injects the
// viewer's full AD group list as `x-aix-groups`, so the request that reaches us is bigger than
// the one the browser sent — for a viewer in a few hundred groups the injected header alone
// clears 20 KB. Node's parser then rejects the request with a bare 431 before any of our code
// runs, so the whole arcade 431s for that person while everyone else is fine (which is exactly
// how this surfaced: two players locked out, nobody else). Set per-server rather than via
// `--max-http-header-size` on the CMD so the cap travels with the source and holds however the
// app is started — the Docker CMD, `npm start`, `npm run dev`, or the tests.
const MAX_HEADER_BYTES = 64 * 1024;
const BOARD_LIMIT = 25;
// Admin allowlist by MyID login id. Not a credential — just who may read the raw
// tables and reset the boards. The app is private today, so every viewer is
// already the owner; this keeps that true if it is ever opened up.
const ADMINS = (process.env.ARCADE_ADMINS || 'LEEB120')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter(Boolean);
// ...and by hub id, which is the ONLY identity the front door actually forwards.
// A PERNR is not a secret (it is the actor key in the platform's own audit trail),
// but keep it overridable so this never needs a code change to add someone.
const ADMIN_HUB_IDS = (process.env.ARCADE_ADMIN_HUB_IDS || '70009486')
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
let pool = null;
const mem = { players: new Map(), runs: [], sessions: [], resetEpoch: 0 };

// When the owner last wiped everything, in epoch ms; 0 = never.
//
// This exists because clearing the server is not enough. Every wallet is
// local-first: the browser keeps its own copy in localStorage and pushes it back
// up on the next page load, so a truncate alone gets silently undone by the first
// player to visit. Handing this stamp to the client lets it recognise "the server
// was reset after my copy was written" and drop its own state — the only version
// of a reset that reaches other people's browsers too.
let resetEpoch = 0;

async function initStore() {
  const p = await getPool();
  if (!p) {
    console.warn('arcade: no database configured — using in-memory store');
    return;
  }
  try {
    await p.query(`CREATE TABLE IF NOT EXISTS players (
      hub_id TEXT PRIMARY KEY,
      display_name TEXT,
      email TEXT,
      team TEXT,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await p.query(`CREATE TABLE IF NOT EXISTS runs (
      id BIGSERIAL PRIMARY KEY,
      hub_id TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT 'waste-hunter',
      stage_id TEXT NOT NULL,
      seed BIGINT,
      daily_key TEXT,
      outcome TEXT NOT NULL,
      dollars BIGINT NOT NULL DEFAULT 0,
      credits BIGINT NOT NULL DEFAULT 0,
      level INT NOT NULL DEFAULT 0,
      kills INT NOT NULL DEFAULT 0,
      quiz_correct INT NOT NULL DEFAULT 0,
      quiz_wrong INT NOT NULL DEFAULT 0,
      team TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    // additive migration for tables created before email was captured
    await p.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT');
    // the per-run currency is AI tokens now; old rows carry their credits over 1:1
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS tokens BIGINT NOT NULL DEFAULT 0');
    await p.query('UPDATE runs SET tokens = credits WHERE tokens = 0 AND credits > 0');
    // how long a run actually lasted, for the usage rollup (0 = pre-column run)
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS duration_s INT NOT NULL DEFAULT 0');
    // One row per visit. The app never sees a login — the front door authenticates
    // and we only get headers — but every page calls /api/me exactly once, so that
    // is the heartbeat. Hits inside SESSION_GAP_MIN coalesce into one session.
    await p.query(`CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      hub_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      page_views INT NOT NULL DEFAULT 1)`);
    await p.query('CREATE INDEX IF NOT EXISTS sessions_hub_last ON sessions (hub_id, last_seen DESC)');
    // Mudslides ranks on things Waste Hunter never had. Additive so existing
    // rows simply carry zeros rather than needing a backfill.
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS distance INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS near_misses INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS top_speed INT NOT NULL DEFAULT 0');
    // Holiday in Colombia ranks on things neither of the others had. Weight is
    // stored in GRAMS so the column stays an integer like every other metric;
    // the board divides it back down for display.
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS streak INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS heaviest_g INT NOT NULL DEFAULT 0');
    // Fish landed. The cabinet has always sent it and its own board has always had
    // a column for it, but there was nowhere to put it — so that column read 0 for
    // everybody the moment the board came from the server instead of localStorage.
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS fish INT NOT NULL DEFAULT 0');
    await p.query('CREATE INDEX IF NOT EXISTS runs_game_streak ON runs (game, streak DESC)');
    // Board Meeting ranks on cumulative earnings. The client sends its running
    // total (monotonic), so a per-player MAX of this column IS that player's
    // total — no special SUM query, it rides the same pipeline as every metric.
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS total_earned BIGINT NOT NULL DEFAULT 0');
    await p.query('CREATE INDEX IF NOT EXISTS runs_game_total_earned ON runs (game, total_earned DESC)');
    // CostBotLand ranks on park-triage metrics. Park rating is a 0–5 star value
    // with one decimal, kept as an integer ×10 (like heaviest's grams) and divided
    // back down for display; the rest are plain counts/percentages.
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS guests INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS stars_x10 INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS uptime_pct INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS combo INT NOT NULL DEFAULT 0');
    await p.query('CREATE INDEX IF NOT EXISTS runs_game_guests ON runs (game, guests DESC)');
    // CostBot Hero ranks on the run score (the spend cut on the beat) plus
    // accuracy; combo and tokens ride the shared columns above.
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS score BIGINT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS accuracy_pct INT NOT NULL DEFAULT 0');
    await p.query('CREATE INDEX IF NOT EXISTS runs_game_score ON runs (game, score DESC)');
    // One row per housekeeping fact. Only `reset_epoch` lives here today; it is a
    // table rather than an env var because it has to survive a pod restart and be
    // readable by both replicas.
    await p.query(`CREATE TABLE IF NOT EXISTS app_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await p.query('CREATE INDEX IF NOT EXISTS runs_stage_dollars ON runs (stage_id, dollars DESC)');
    await p.query('CREATE INDEX IF NOT EXISTS runs_game_distance ON runs (game, distance DESC)');
    await p.query('CREATE INDEX IF NOT EXISTS runs_game_tokens ON runs (game, tokens DESC)');
    // Read the epoch BEFORE publishing the pool. Everything after `pool = p` is live
    // to the rest of the app, so a throw past that line would land in the catch below,
    // end the client, and leave the module-level `pool` still pointing at it — every
    // later query would then fail before falling back to memory, for the life of the
    // process, instead of failing straight to memory the way this catch intends.
    const seen = await p.query("SELECT v FROM app_meta WHERE k = 'reset_epoch'");
    resetEpoch = seen.rowCount ? Number(seen.rows[0].v) || 0 : 0;
    pool = p; // publish only after init succeeds
    console.log('arcade: database ready');
  } catch (err) {
    console.error('arcade: table init failed, using memory:', err.message);
    pool = null;    // belt and braces: never leave a published handle to an ended pool
    await p.end().catch(() => {});
  }
}

// Stamp "everything was wiped just now". The clock is Postgres's, not the pod's,
// so two replicas cannot disagree and a skewed container cannot stamp the future.
async function bumpResetEpoch() {
  if (!pool) {
    mem.resetEpoch = Date.now();
    return mem.resetEpoch;
  }
  const out = await pool.query(
    `INSERT INTO app_meta (k, v, updated_at)
     VALUES ('reset_epoch', (EXTRACT(EPOCH FROM now()) * 1000)::bigint::text, now())
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()
     RETURNING v`,
  );
  resetEpoch = Number(out.rows[0].v) || 0;
  return resetEpoch;
}

const currentResetEpoch = () => (pool ? resetEpoch : mem.resetEpoch);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
// The hub id is a PERNR (e.g. 70009486) — correct as a key, useless as a label. The front
// door also forwards the OIDC email claim and the MyID login id, so derive something human
// from those instead of ever showing the employee number.
//   briant.lee@disney.com -> "Briant Lee"
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  if (!local) return null;
  const parts = local
    .split(/[._-]+/)
    .filter((w) => w && !/^\d+$/.test(w))
    // strip a trailing disambiguation suffix some accounts carry (e.g. "lee2")
    .map((w) => w.replace(/\d+$/, ''))
    .filter(Boolean);
  if (!parts.length) return null;
  return parts
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Some accounts are provisioned with a trailing ".nd" — laura.bria.nd@disney.com — which
// nameFromEmail turns into a "Nd" that reads as part of the surname on a leaderboard. It is
// an account-type marker, not a name, so it comes off on the way OUT. Nothing STORED changes:
// players.display_name keeps whatever was provisioned or typed, and this is applied only to
// labels the app emits. Requires a separator before it, so someone actually called "Nd"
// keeps their name.
const ACCOUNT_SUFFIX = /[\s._-]+nd$/i;
function displayLabel(name) {
  const s = String(name || '');
  if (!s) return null;
  return s.replace(ACCOUNT_SUFFIX, '').trim() || s;
}

// One name-resolution rule for every label the app emits, so the boards, the usage table
// and /api/me cannot disagree — the leaderboard highlights your own row by matching the
// name string, so a suffix stripped in one place and not the other stops that working.
// A hub id is a PERNR and is only ever the last resort.
function playerLabel(row, hubId) {
  const raw = row
    ? row.display_name || (row.email ? String(row.email).split('@')[0] : null)
    : null;
  return displayLabel(raw) || hubId;
}

function viewer(req) {
  const hubId = String(req.headers['x-aix-hub-id'] || '').trim();
  const groups = String(req.headers['x-aix-groups'] || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  const email = String(req.headers['x-aix-email'] || '').trim();
  const username = String(req.headers['x-aix-username'] || '').trim();
  // Local preview has no front door ahead of us; fall back to a stable dev identity so the
  // app is exercisable locally without pretending to be authenticated.
  return {
    hubId: hubId || 'local-dev',
    groups,
    email: email || null,
    username: username || null,
    derivedName: nameFromEmail(email),
    authenticated: Boolean(hubId),
  };
}

// The Daily Bill uses the same YYYYMMDD seed the game derives client-side.
function num(v, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : 0;
}

function json(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ---------------------------------------------------------------------------
// profile + runs
// ---------------------------------------------------------------------------
async function loadPlayer(hubId) {
  if (!pool) return mem.players.get(hubId) || null;
  try {
    const { rows } = await pool.query(
      'SELECT hub_id, display_name, email, team, profile FROM players WHERE hub_id = $1',
      [hubId],
    );
    return rows[0] || null;
  } catch (err) {
    console.error('arcade: loadPlayer failed:', err.message);
    return mem.players.get(hubId) || null;
  }
}

async function savePlayer(hubId, opts) {
  const row = {
    hub_id: hubId,
    display_name: opts.displayName || null,
    email: opts.email || null,
    team: opts.team || null,
    profile: opts.profile || {},
  };
  if (!pool) {
    const prev = mem.players.get(hubId) || {};
    mem.players.set(hubId, {
      ...prev,
      ...row,
      display_name: row.display_name || prev.display_name || null,
      email: row.email || prev.email || null,
      team: row.team || prev.team || null,
    });
    return mem.players.get(hubId);
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO players (hub_id, display_name, email, team, profile)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (hub_id) DO UPDATE
         SET profile = EXCLUDED.profile,
             display_name = COALESCE(EXCLUDED.display_name, players.display_name),
             email = COALESCE(EXCLUDED.email, players.email),
             team = COALESCE(EXCLUDED.team, players.team),
             updated_at = now()
       RETURNING hub_id, display_name, email, team, profile`,
      [hubId, row.display_name, row.email, row.team, JSON.stringify(row.profile)],
    );
    return rows[0];
  } catch (err) {
    console.error('arcade: savePlayer failed:', err.message);
    mem.players.set(hubId, row);
    return row;
  }
}

async function recordRun(hubId, team, r) {
  const seed = num(r.seed);
  const run = {
    hub_id: hubId,
    team: team || null,
    game: String(r.game || 'waste-hunter').slice(0, 40),
    stage_id: String(r.stageId || 'unknown').slice(0, 60),
    seed,
    // 'fail' is CostBot Hero's outcome for a song failed on misses (r.failed) — everyone
    // else's failure state is 'death'. Omitting it silently rewrote every failed Hero run
    // to 'quit', indistinguishable from a player who just walked away.
    outcome: ['clear', 'death', 'quit', 'fail'].includes(r.outcome) ? r.outcome : 'quit',
    dollars: num(r.dollarsSaved, 1e12),
    tokens: num(r.tokensEarned !== undefined ? r.tokensEarned : r.creditsEarned, 1e9),
    level: num(r.level, 999),
    kills: num(r.kills, 1e6),
    quiz_correct: num(r.quizCorrect, 1e4),
    quiz_wrong: num(r.quizWrong, 1e4),
    // both cabinets report seconds survived; clamp so one bad client cannot
    // poison the minutes-played rollup with a day-long run
    duration_s: num(r.timeSurvived, 86400),
    distance: num(r.distance, 1e7),
    near_misses: num(r.nearMisses, 1e6),
    top_speed: num(r.topSpeed, 1e6),
    streak: num(r.streak, 1e4),
    heaviest_g: num(Math.round((Number(r.heaviest) || 0) * 1000), 1e7),
    fish: num(r.fish, 1e6),
    // CostBotLand metrics; stars is 0–5 with one decimal, stored ×10.
    guests: num(r.guests, 1e6),
    stars_x10: num(Math.round((Number(r.stars) || 0) * 10), 100),
    uptime_pct: num(r.uptime, 100),
    combo: num(r.combo, 1e4),
    // Board Meeting: the player's cumulative earnings (monotonic).
    total_earned: num(r.totalEarned, 1e12),
    // CostBot Hero: best single-run score + accuracy (0–100).
    score: num(r.score, 1e12),
    accuracy_pct: num(r.accuracy, 100),
  };
  if (!pool) {
    mem.runs.push(run);
    return run;
  }
  try {
    await pool.query(
      `INSERT INTO runs (hub_id, game, stage_id, seed, outcome, dollars, tokens,
                         level, kills, quiz_correct, quiz_wrong, team,
                         distance, near_misses, top_speed, duration_s,
                         streak, heaviest_g, fish,
                         guests, stars_x10, uptime_pct, combo, total_earned,
                         score, accuracy_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [run.hub_id, run.game, run.stage_id, run.seed, run.outcome, run.dollars,
        run.tokens, run.level, run.kills, run.quiz_correct, run.quiz_wrong, run.team,
        run.distance, run.near_misses, run.top_speed, run.duration_s,
        run.streak, run.heaviest_g, run.fish,
        run.guests, run.stars_x10, run.uptime_pct, run.combo, run.total_earned,
        run.score, run.accuracy_pct],
    );
  } catch (err) {
    console.error('arcade: recordRun failed:', err.message);
    mem.runs.push(run);
  }
  return run;
}

// ---------------------------------------------------------------------------
// SESSIONS + USAGE
// The app never observes a login: the front door authenticates and forwards only
// x-aix-hub-id. But every page in the arcade calls /api/me exactly once on load,
// so that call is the heartbeat. Hits from the same player inside SESSION_GAP_MIN
// fold into one session, which is what makes "visits" and "time in the arcade"
// answerable without the app ever touching the auth flow.
// ---------------------------------------------------------------------------
const SESSION_GAP_MIN = 30;

async function touchSession(hubId) {
  if (!hubId) return;
  if (!pool) {
    const last = mem.sessions.filter((x) => x.hub_id === hubId).pop();
    const cutoff = Date.now() - SESSION_GAP_MIN * 60000;
    if (last && new Date(last.last_seen).getTime() > cutoff) {
      last.last_seen = new Date().toISOString();
      last.page_views += 1;
    } else {
      const now = new Date().toISOString();
      mem.sessions.push({ hub_id: hubId, started_at: now, last_seen: now, page_views: 1 });
    }
    return;
  }
  try {
    // Extend the newest session if it is still inside the window, else open a new
    // one. Single statement so two tabs racing cannot both insert.
    const r = await pool.query(
      `UPDATE sessions SET last_seen = now(), page_views = page_views + 1
        WHERE id = (SELECT id FROM sessions WHERE hub_id = $1
                     ORDER BY last_seen DESC LIMIT 1)
          AND last_seen > now() - make_interval(mins => $2::int)
        RETURNING id`, [hubId, SESSION_GAP_MIN]);
    if (!r.rowCount) await pool.query('INSERT INTO sessions (hub_id) VALUES ($1)', [hubId]);
  } catch (err) {
    console.error('arcade: touchSession failed:', err.message);
  }
}

// Per-player usage. Deliberately NO team rollup — the arcade dropped the concept.
async function usage() {
  if (!pool) {
    const byPlayer = new Map();
    for (const r of mem.runs) {
      const u = byPlayer.get(r.hub_id)
        || { hub_id: r.hub_id, runs: 0, seconds: 0, tokens: 0, games: {},
             quiz_correct: 0, quiz_asked: 0, visits: 0, page_views: 0, in_app_s: 0 };
      u.runs += 1;
      u.seconds += r.duration_s || 0;
      u.tokens += r.tokens || 0;
      u.quiz_correct += r.quiz_correct || 0;
      u.quiz_asked += (r.quiz_correct || 0) + (r.quiz_wrong || 0);
      u.games[r.game] = (u.games[r.game] || 0) + 1;
      byPlayer.set(r.hub_id, u);
    }
    for (const x of mem.sessions) {
      const u = byPlayer.get(x.hub_id)
        || { hub_id: x.hub_id, runs: 0, seconds: 0, tokens: 0, games: {},
             quiz_correct: 0, quiz_asked: 0, visits: 0, page_views: 0, in_app_s: 0 };
      u.visits += 1;
      u.page_views += x.page_views;
      u.in_app_s += Math.max(0,
        (new Date(x.last_seen).getTime() - new Date(x.started_at).getTime()) / 1000);
      u.last_seen = x.last_seen;
      u.first_seen = u.first_seen || x.started_at;
      byPlayer.set(x.hub_id, u);
    }
    const names = new Map([...mem.players.values()]
      .map((p) => [p.hub_id, playerLabel(p, p.hub_id)]));
    return {
      store: 'memory',
      players: [...byPlayer.values()]
        .map((u) => ({ ...u, player: names.get(u.hub_id) || u.hub_id }))
        .sort((a, b) => b.seconds - a.seconds),
    };
  }
  try {
    const q = await pool.query(
      `WITH r AS (
         SELECT hub_id, COUNT(*) AS runs, COALESCE(SUM(duration_s),0) AS seconds,
                COALESCE(SUM(tokens),0) AS tokens,
                COALESCE(SUM(quiz_correct),0) AS quiz_correct,
                COALESCE(SUM(quiz_correct + quiz_wrong),0) AS quiz_asked,
                MIN(created_at) AS first_run, MAX(created_at) AS last_run
           FROM runs GROUP BY hub_id),
       g AS (
         SELECT hub_id, jsonb_object_agg(game, n) AS games
           FROM (SELECT hub_id, game, COUNT(*) AS n FROM runs GROUP BY hub_id, game) pg
          GROUP BY hub_id),
       s AS (
         SELECT hub_id, COUNT(*) AS visits, COALESCE(SUM(page_views),0) AS page_views,
                COALESCE(SUM(EXTRACT(EPOCH FROM (last_seen - started_at))),0)::bigint AS in_app_s,
                MIN(started_at) AS first_seen, MAX(last_seen) AS last_seen
           FROM sessions GROUP BY hub_id)
       SELECT COALESCE(r.hub_id, s.hub_id) AS hub_id,
              p.display_name, p.email,
              COALESCE(r.runs,0) AS runs, COALESCE(r.seconds,0) AS seconds,
              COALESCE(r.tokens,0) AS tokens, g.games,
              COALESCE(r.quiz_correct,0) AS quiz_correct, COALESCE(r.quiz_asked,0) AS quiz_asked,
              COALESCE(s.visits,0) AS visits, COALESCE(s.page_views,0) AS page_views,
              COALESCE(s.in_app_s,0) AS in_app_s,
              LEAST(r.first_run, s.first_seen) AS first_seen,
              GREATEST(r.last_run, s.last_seen) AS last_seen
         FROM r FULL OUTER JOIN s ON s.hub_id = r.hub_id
         LEFT JOIN g ON g.hub_id = r.hub_id
         LEFT JOIN players p ON p.hub_id = COALESCE(r.hub_id, s.hub_id)
        ORDER BY seconds DESC NULLS LAST`);
    return {
      store: 'postgres',
      players: q.rows.map((x) => ({
        hub_id: x.hub_id,
        player: playerLabel(x, x.hub_id),
        runs: Number(x.runs),
        seconds: Number(x.seconds),
        tokens: Number(x.tokens),
        games: x.games || {},
        quiz_correct: Number(x.quiz_correct),
        quiz_asked: Number(x.quiz_asked),
        visits: Number(x.visits),
        page_views: Number(x.page_views),
        in_app_s: Number(x.in_app_s),
        first_seen: x.first_seen,
        last_seen: x.last_seen,
      })),
    };
  } catch (err) {
    console.error('arcade: usage failed:', err.message);
    return { store: 'postgres', players: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// leaderboards
// ---------------------------------------------------------------------------
async function nameMap(hubIds) {
  const ids = [...new Set(hubIds)];
  if (!ids.length || !pool) return {};
  try {
    const { rows } = await pool.query(
      'SELECT hub_id, display_name, email FROM players WHERE hub_id = ANY($1)',
      [ids],
    );
    // email is the fallback identity when no name was derived or set — a hub id
    // is a PERNR and must never be a label
    return Object.fromEntries(rows.map((r) => [r.hub_id, playerLabel(r, r.hub_id)]));
  } catch {
    return {};
  }
}

function memBoards() {
  // Mirror the SQL path's name resolution, otherwise local dev shows raw hub ids
  // (PERNRs) where production shows people.
  const label = (hubId) => playerLabel(mem.players.get(hubId), hubId);
  const best = new Map();
  for (const r of mem.runs) {
    const k = `${r.game}/${r.stage_id}|${r.hub_id}`;
    if (!best.has(k) || best.get(k).dollars < r.dollars) {
      best.set(k, { stage: `${r.game}/${r.stage_id}`, player: label(r.hub_id), dollars: r.dollars });
    }
  }
  const stages = {};
  for (const v of best.values()) {
    if (!stages[v.stage]) stages[v.stage] = [];
    stages[v.stage].push({ player: v.player, dollars: v.dollars });
  }
  for (const k of Object.keys(stages)) stages[k].sort((a, b) => b.dollars - a.dollars);
  // The quiz board mirrors the SQL above so a DB-free local run exercises it too.
  const perPlayer = new Map();
  for (const r of mem.runs) {
    const q = perPlayer.get(r.hub_id) || { player: label(r.hub_id), correct: 0, asked: 0 };
    q.correct += r.quiz_correct;
    q.asked += r.quiz_correct + r.quiz_wrong;
    perPlayer.set(r.hub_id, q);
  }
  const quiz = [...perPlayer.values()]
    .filter((q) => q.asked >= 10)
    .map((q) => ({ ...q, pct: Math.round((q.correct / q.asked) * 100) }))
    .sort((a, b) => b.pct - a.pct || b.correct - a.correct)
    .slice(0, BOARD_LIMIT);

  return {
    stages,
    quiz,
    source: 'memory',
  };
}

// Row counts for the three tables, so a reset can report what it actually removed
// rather than just claiming success. Never throws: it is only ever used to describe
// another operation, and must not be the reason that operation fails.
async function counts() {
  if (!pool) {
    return { players: mem.players.size, runs: mem.runs.length, sessions: mem.sessions.length };
  }
  try {
    const q = await pool.query(`SELECT (SELECT COUNT(*) FROM players) AS players,
                                      (SELECT COUNT(*) FROM runs) AS runs,
                                      (SELECT COUNT(*) FROM sessions) AS sessions`);
    const r = q.rows[0];
    return { players: Number(r.players), runs: Number(r.runs), sessions: Number(r.sessions) };
  } catch (err) {
    console.error('arcade: counts failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI TOKEN POOL
// Every cabinet banks tokens into one shared fund — that is the arcade's whole
// premise. `mine` is the player's own contribution, `total` is everybody's.
// ---------------------------------------------------------------------------
// The build fund counts BANKED tokens, not earned ones. A player who spends a
// run's haul on Bot Bay upgrades gave CostBot nothing, and the fund should say
// so — otherwise the choice the Bot Bay offers is not a choice. Each game keeps
// its own `banked` inside the player's profile blob, so this reads the JSONB
// rather than the run ledger and needs no schema change.
async function tokenPool(hubId) {
  if (!pool) {
    let total = 0, mine = 0, players = 0;
    for (const [id, p] of mem.players) {
      const games = (p.profile && p.profile.games) || {};
      const sum = Object.values(games).reduce((t, g) => t + (Number(g && g.banked) || 0), 0);
      total += sum;
      if (sum > 0) players += 1;
      if (id === hubId) mine = sum;
    }
    return { total, mine, players };
  }
  try {
    const q = await pool.query(
      `SELECT COALESCE(SUM((g.value->>'banked')::bigint), 0) AS total,
              COALESCE(SUM((g.value->>'banked')::bigint)
                       FILTER (WHERE p.hub_id = $1), 0) AS mine,
              COUNT(DISTINCT p.hub_id)
                FILTER (WHERE COALESCE((g.value->>'banked')::bigint, 0) > 0) AS players
         FROM players p, jsonb_each(p.profile->'games') g`, [hubId]);
    const r = q.rows[0] || {};
    return { total: Number(r.total || 0), mine: Number(r.mine || 0), players: Number(r.players || 0) };
  } catch (err) {
    console.error('arcade: tokenPool failed:', err.message);
    return { total: 0, mine: 0, players: 0 };
  }
}

// ---------------------------------------------------------------------------
// per-game boards
//
// The arcade board ranks every game on one shared currency (dollars). A game
// with its own metrics needs its own board, so this returns one ranked list per
// metric and lets the client decide which to show. Each list is a player's BEST
// run on that metric, not their latest.
// ---------------------------------------------------------------------------
const GAME_METRICS = {
  tokens: { col: 'tokens', label: 'Tokens collected' },
  distance: { col: 'distance', label: 'Distance' },
  nearMisses: { col: 'near_misses', label: 'Near misses' },
  topSpeed: { col: 'top_speed', label: 'Top speed' },
  streak: { col: 'streak', label: 'Longest streak' },
  // `div` converts a stored integer back to its display unit. Weight is kept in
  // grams in the column so it sorts and indexes like every other metric, and
  // comes back out in kg so no caller has to know that.
  heaviest: { col: 'heaviest_g', label: 'Heaviest', div: 1000 },
  fish: { col: 'fish', label: 'Fish landed' },
  // CostBotLand. Others carry 0 in these columns and are filtered out by the
  // `> 0` guard, so the metrics only surface on the park's own board.
  guests: { col: 'guests', label: 'Guests kept happy' },
  stars: { col: 'stars_x10', label: 'Park rating', div: 10 },
  uptime: { col: 'uptime_pct', label: 'Ride uptime %' },
  combo: { col: 'combo', label: 'Best combo' },
  // Board Meeting. Monotonic client total, so MAX-per-player is the running sum.
  totalEarned: { col: 'total_earned', label: 'Total earnings' },
  // CostBot Hero. Others carry 0 in these columns and are filtered by the `> 0`
  // guard, so they only surface on the rhythm cabinet's own board.
  score: { col: 'score', label: 'Best score' },
  accuracy: { col: 'accuracy_pct', label: 'Accuracy %' },
};

// CostBot Hero's board wants the SONG + DIFFICULTY of each player's top score,
// which a per-metric MAX throws away. So it gets its own per-player best-RUN
// board that carries the run's stage_id (encoded as "<songKey>:<diffKey>").
// Kept in sync BY HAND with the SONGS list in costbot-hero/ch-game.js — that file is
// client-only (browser), this one is server-only (Node), and neither can require() the
// other, so a new song added there needs its name added here too or it falls back to
// showing the raw key (that happened: ch_blindhero/ch_xmen shipped without an entry).
const HERO_SONG_NAMES = {
  ch_avengers: 'The Savengers',
  ch_imperial: 'Imperial Markup',
  ch_small: "It's a Small Cost",
  ch_blindhero: 'Blind Spend',
  ch_xmen: 'X-pense Men',
  ch_fairyfountain: 'Finance Fairy',
  ch_goldsaucer: 'Gold Sauce',
  ch_lostwoods: 'Cost Woods',
  ch_fightOn: 'Write-Off!',
  ch_legendOfCostbot: 'Legend of CostBot',
  ch_kalm: 'Kalm Before the Bill',
  ch_fiscalicia: 'Fiscalicia',
  ch_gameofloans: 'Game of Loans',
  ch_tariffa: 'Tariffa',
};
const HERO_DIFF_NAMES = { easy: 'Easy', medium: 'Normal', hard: 'Hard', ultra: 'Ultra' };
function heroRow(stageId, score, combo, accuracy, tokens, player) {
  const parts = String(stageId || '').split(':');
  return {
    player, score, combo, accuracy, tokens,
    song: HERO_SONG_NAMES[parts[0]] || parts[0] || '—',
    difficulty: HERO_DIFF_NAMES[parts[1]] || parts[1] || '—',
  };
}
function memHeroRecords() {
  const label = (hubId) => playerLabel(mem.players.get(hubId), hubId);
  // Keyed by player + song + difficulty, NOT just player: the leaderboard filters to
  // one song+difficulty at a time, so collapsing to a player's single all-time-best
  // run made every other song they'd played invisible under its own filter.
  const best = new Map();
  for (const r of mem.runs) {
    if (r.game !== 'costbot-hero') continue;
    const v = Number(r.score || 0);
    if (v <= 0) continue;
    const key = `${r.hub_id}:${r.stage_id}`;
    const cur = best.get(key);
    if (!cur || cur.score < v) {
      best.set(key, heroRow(r.stage_id, v, Number(r.combo || 0),
        Number(r.accuracy_pct || 0), Number(r.tokens || 0), label(r.hub_id)));
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, BOARD_LIMIT);
}
async function heroRecords() {
  const q = await pool.query(
    `SELECT DISTINCT ON (hub_id, stage_id) hub_id, score, stage_id, combo, accuracy_pct, tokens
       FROM runs WHERE game = 'costbot-hero' AND score > 0
      ORDER BY hub_id, stage_id, score DESC`);
  const names = await nameMap(q.rows.map((r) => r.hub_id));
  return q.rows
    .map((r) => heroRow(r.stage_id, Number(r.score), Number(r.combo || 0),
      Number(r.accuracy_pct || 0), Number(r.tokens || 0), names[r.hub_id] || r.hub_id))
    .sort((a, b) => b.score - a.score).slice(0, BOARD_LIMIT);
}

function memGameBoards(game) {
  const label = (hubId) => playerLabel(mem.players.get(hubId), hubId);
  const out = {};
  for (const [key, m] of Object.entries(GAME_METRICS)) {
    const best = new Map();
    for (const r of mem.runs) {
      if (r.game !== game) continue;
      const cur = best.get(r.hub_id);
      const v = Number(r[m.col] || 0) / (m.div || 1);
      if (!cur || cur.value < v) best.set(r.hub_id, { player: label(r.hub_id), value: v });
    }
    out[key] = [...best.values()]
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, BOARD_LIMIT);
  }
  const records = game === 'costbot-hero' ? memHeroRecords() : undefined;
  return { game, metrics: out, records, source: 'memory' };
}

async function gameBoards(game) {
  if (!pool) return memGameBoards(game);
  try {
    const keys = Object.keys(GAME_METRICS);
    const rows = await Promise.all(keys.map((k) => pool.query(
      `SELECT hub_id, MAX(${GAME_METRICS[k].col}) AS best
         FROM runs WHERE game = $1
        GROUP BY hub_id HAVING MAX(${GAME_METRICS[k].col}) > 0
        ORDER BY best DESC LIMIT $2`, [game, BOARD_LIMIT],
    )));
    const names = await nameMap(rows.flatMap((r) => r.rows).map((r) => r.hub_id));
    const metrics = {};
    keys.forEach((k, i) => {
      const div = GAME_METRICS[k].div || 1;
      metrics[k] = rows[i].rows.map((r) => ({
        player: names[r.hub_id] || r.hub_id,
        value: Number(r.best) / div,
      }));
    });
    const records = game === 'costbot-hero' ? await heroRecords() : undefined;
    return { game, metrics, records, source: 'db' };
  } catch (err) {
    console.error('arcade: gameBoards failed:', err.message);
    return memGameBoards(game);
  }
}

async function boards() {
  if (!pool) return memBoards();
  try {
    const [stages, quiz] = await Promise.all([
      pool.query(`SELECT game, stage_id, hub_id, MAX(dollars) AS best
                  FROM runs GROUP BY game, stage_id, hub_id
                  ORDER BY game, stage_id, best DESC`),
      pool.query(`SELECT hub_id, SUM(quiz_correct) AS correct,
                         SUM(quiz_correct + quiz_wrong) AS asked
                  FROM runs GROUP BY hub_id
                  HAVING SUM(quiz_correct + quiz_wrong) >= 10
                  ORDER BY (SUM(quiz_correct)::float
                            / NULLIF(SUM(quiz_correct + quiz_wrong), 0)) DESC,
                           SUM(quiz_correct) DESC
                  LIMIT $1`, [BOARD_LIMIT]),
    ]);
    const names = await nameMap(
      [...stages.rows, ...quiz.rows].map((r) => r.hub_id),
    );
    // keyed "<game>/<stage>" so two games never share a board
    const byStage = {};
    for (const r of stages.rows) {
      const key = `${r.game}/${r.stage_id}`;
      if (!byStage[key]) byStage[key] = [];
      if (byStage[key].length < BOARD_LIMIT) {
        byStage[key].push({ player: names[r.hub_id] || r.hub_id, dollars: Number(r.best) });
      }
    }
    return {
      stages: byStage,
      quiz: quiz.rows.map((r) => ({
        player: names[r.hub_id] || r.hub_id,
        correct: Number(r.correct),
        asked: Number(r.asked),
        pct: Math.round((Number(r.correct) / Number(r.asked)) * 100),
      })),
      source: 'db',
    };
  } catch (err) {
    console.error('arcade: boards failed:', err.message);
    return memBoards();
  }
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------
async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const full = nodePath.join(PUBLIC_DIR, rel);
  // never escape the public root
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + nodePath.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  try {
    const st = await fsp.stat(full);
    if (st.isDirectory()) {
      res.writeHead(302, { location: urlPath.replace(/\/?$/, '/') });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[nodePath.extname(full).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': nodePath.extname(full) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(full).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
async function handler(req, res) {
  // Cheaply cap the request body before reading it.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    json(res, 413, { error: 'payload too large' });
    req.destroy();
    return;
  }

  const urlPath = new URL(req.url, 'http://localhost').pathname;

  if (urlPath === '/health_check') return json(res, 200, { status: 'ok' });

  if (urlPath.startsWith('/api/')) {
    const v = viewer(req);

    if (urlPath === '/api/hello') {
      return json(res, 200, { hello: 'costbot-arcade', lang: 'node' });
    }

    if (urlPath === '/api/me' && req.method === 'GET') {
      const row = await loadPlayer(v.hubId);
      // A name the player set themselves always wins; otherwise take the one derived from
      // their email. Persist it so leaderboards show people, not employee numbers.
      const stored = row && row.display_name;
      const name = stored || v.derivedName || null;
      if (!stored && name) {
        await savePlayer(v.hubId, {
          profile: (row && row.profile) || {},
          displayName: name,
          email: v.email || undefined,
          team: (row && row.team) || v.groups[0] || undefined,
        });
      }
      await touchSession(v.hubId);
      return json(res, 200, {
        hubId: v.hubId,
        authenticated: v.authenticated,
        groups: v.groups,
        // Stripped like every board label, and it HAS to be: the leaderboard highlights
        // your own row by matching this string against the names on the board, so leaving
        // the suffix on here would stop anyone with an ".nd" account ever finding
        // themselves. What was persisted above is the underived name, untouched.
        displayName: displayLabel(name),
        nameSource: stored && stored !== v.derivedName
          ? 'set-by-player'
          : v.derivedName
            ? 'email'
            : stored
              ? 'set-by-player'
              : 'none',
        // surfaced so a mis-derived name is diagnosable without reading pod logs
        identity: { email: v.email, username: v.username },
        team: (row && row.team) || v.groups[0] || null,
        profile: (row && row.profile) || null,
        hasServerProfile: Boolean(row),
        isAdmin: ADMIN_HUB_IDS.includes(String(v.hubId || ''))
          || ADMINS.includes(String(v.username || '').toUpperCase()),
        pool: await tokenPool(v.hubId),
        // the client compares this against its own stamp and wipes localStorage
        // when the server was reset more recently — see arcade-sync.js
        resetEpoch: currentResetEpoch(),
      });
    }

    if (urlPath === '/api/profile' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (!body.profile || typeof body.profile !== 'object') {
        return json(res, 400, { error: 'body must be {"profile": {...}}' });
      }
      const saved = await savePlayer(v.hubId, {
        profile: body.profile,
        displayName:
          typeof body.displayName === 'string' ? body.displayName.slice(0, 80) : undefined,
        email: v.email || undefined,
        team: typeof body.team === 'string' ? body.team.slice(0, 80) : v.groups[0] || undefined,
      });
      return json(res, 200, { ok: true, team: saved.team, displayName: saved.display_name });
    }

    if (urlPath === '/api/score' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const row = await loadPlayer(v.hubId);
      const team = (row && row.team) || v.groups[0] || null;
      const run = await recordRun(v.hubId, team, body.result || body);
      if (body.profile && typeof body.profile === 'object') {
        await savePlayer(v.hubId, { profile: body.profile, team, email: v.email || undefined });
      }
      return json(res, 200, { ok: true, recorded: { stage: run.stage_id, dollars: run.dollars } });
    }

    if (urlPath === '/api/leaderboards' && req.method === 'GET') {
      return json(res, 200, await boards());
    }

    // /api/leaderboards/<game> — that game's own metrics, one list each
    if (urlPath.startsWith('/api/leaderboards/') && req.method === 'GET') {
      const game = decodeURIComponent(urlPath.slice('/api/leaderboards/'.length)).slice(0, 40);
      if (!/^[a-z0-9-]+$/.test(game)) return json(res, 400, { error: 'bad game' });
      return json(res, 200, await gameBoards(game));
    }

    // ---- admin: read the raw tables and reset the boards --------------------
    // There is no way to reach this Postgres from a laptop (it is in-cluster, and
    // the credential comes from Secrets Manager via the pod's IRSA role), so the
    // app itself is the query surface.
    // The front door strips x-aix-username (it is in IDENTITY_HEADERS and only
    // hub-id + groups are re-asserted), so gating on the login id alone meant every
    // /api/admin/* call 403'd in production. Hub id is what actually arrives; the
    // username branch stays for local preview, where the dev seam does supply it.
    const isAdmin = ADMIN_HUB_IDS.includes(String(v.hubId || ''))
      || ADMINS.includes(String(v.username || '').toUpperCase());

    if (urlPath.startsWith('/api/admin/')) {
      if (!isAdmin) return json(res, 403, { error: 'not an admin', you: v.hubId });

      // Per-player usage: visits, time in the arcade, runs, minutes played by game.
      if (urlPath === '/api/admin/usage' && req.method === 'GET') {
        return json(res, 200, await usage());
      }

      if (urlPath === '/api/admin/summary' && req.method === 'GET') {
        if (!pool) {
          return json(res, 200, {
            store: 'memory',
            players: [...mem.players.values()],
            runs: mem.runs.slice(-50),
          });
        }
        const [players, runs, counts] = await Promise.all([
          pool.query('SELECT hub_id, display_name, email, team, updated_at FROM players ORDER BY updated_at DESC LIMIT 100'),
          pool.query('SELECT id, hub_id, stage_id, outcome, dollars, level, quiz_correct, quiz_wrong, team, created_at FROM runs ORDER BY id DESC LIMIT 50'),
          pool.query('SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM runs) AS runs'),
        ]);
        return json(res, 200, {
          store: 'postgres',
          schema: process.env.APP_SCHEMA || 'costbot_arcade',
          counts: counts.rows[0],
          players: players.rows,
          recentRuns: runs.rows,
        });
      }

      // Read-only SQL against THIS app's schema. The role cannot see another app's
      // tables, and anything that is not a single SELECT is refused outright.
      if (urlPath === '/api/admin/query' && req.method === 'POST') {
        // validate the input BEFORE checking the pool, so the guard is exercised
        // (and testable) whether or not a database happens to be attached
        const body = await readJsonBody(req);
        const sql = String(body.sql || '').trim().replace(/;+$/, '');
        if (!/^select\s/i.test(sql) || /;/.test(sql)) {
          return json(res, 400, { error: 'a single SELECT statement only' });
        }
        if (!pool) return json(res, 503, { error: 'no database attached' });
        try {
          const out = await pool.query({ text: sql, rowMode: 'array' });
          return json(res, 200, {
            columns: out.fields.map((f) => f.name),
            rows: out.rows.slice(0, 500),
            rowCount: out.rowCount,
          });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }

      // Two scopes, because they are different decisions:
      //   runs  — leaderboards and run history. Wallets, the build fund and names survive.
      //   all   — runs + sessions + players. Every purse, the fund, every visit, gone.
      //
      // `all` additionally stamps resetEpoch, which is what makes it reach OTHER
      // people's browsers. Truncating `players` on its own is undone by the next
      // visitor: their local wallet is pushed straight back up.
      //
      // `sessions` was added with the usage board, after this endpoint existed, and
      // used to survive a "full" reset — leaving the Usage page showing visits
      // against zero runs.
      if (urlPath === '/api/admin/reset' && req.method === 'POST') {
        const body = await readJsonBody(req);
        // `players: true` is the pre-scope spelling of `scope: 'all'` — still honoured.
        const scope = (body.scope === 'all' || body.players === true) ? 'all' : 'runs';
        // Unrecoverable and instant: there is no snapshot of this database to go back
        // to. A typed token means a mistyped body cannot wipe the fund.
        if (scope === 'all' && body.confirm !== 'RESET') {
          return json(res, 400, {
            error: 'scope "all" wipes every wallet and the build fund, and cannot be undone',
            need: 'resend with {"scope":"all","confirm":"RESET"}',
          });
        }
        const before = await counts();
        try {
          if (!pool) {
            mem.runs.length = 0;
            if (scope === 'all') { mem.players.clear(); mem.sessions.length = 0; }
          } else if (scope === 'all') {
            // one statement, so a failure cannot leave runs cleared and players kept
            await pool.query('TRUNCATE runs, sessions, players');
          } else {
            await pool.query('TRUNCATE runs');
          }
          const epoch = scope === 'all' ? await bumpResetEpoch() : currentResetEpoch();
          const after = await counts();
          console.log(`arcade: reset scope=${scope} by ${v.hubId}`,
            JSON.stringify({ before, after, epoch }));
          return json(res, 200, {
            ok: true,
            scope,
            store: pool ? 'postgres' : 'memory',
            cleared: scope === 'all' ? 'runs + sessions + players' : 'runs',
            before,
            after,
            resetEpoch: epoch,
            note: scope === 'all'
              ? 'each browser drops its local copy on its next page load'
              : 'wallets, the build fund and display names were left alone',
          });
        } catch (err) {
          return json(res, 500, { error: err.message });
        }
      }

      return json(res, 404, { error: 'unknown admin endpoint' });
    }

    return json(res, 404, { error: 'unknown endpoint' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method not allowed' });
  }

  // The Usage board is named per-player data, so the PAGE is gated too, not just
  // its API. Without this the shell is served to anyone signed in — harmless (the
  // table stays empty on a 403) but it advertises a board they cannot open.
  // 404 rather than 403: there is nothing here for them, and saying "forbidden"
  // only confirms it exists.
  if (/^\/usage(\/|$)/.test(urlPath)) {
    const v = viewer(req);
    const maySee = ADMIN_HUB_IDS.includes(String(v.hubId || ''))
      || ADMINS.includes(String(v.username || '').toUpperCase());
    if (!maySee) return json(res, 404, { error: 'not found' });
  }

  return serveStatic(res, urlPath);
}

const server = http.createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (req, res) => {
  handler(req, res).catch((err) => {
    console.error('arcade: unhandled error:', err);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    else res.end();
  });
});
// Bound slow/stuck clients so a request can't hold a connection open forever.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

// A header-overflow rejection happens inside the parser, so it never reaches `handler` and Node
// answers it with a 431 that appears in NO log — the failure is invisible from `aix-proto logs`
// and unattributable to a person, which is what made the original lockout hard to place. Log it,
// then send the same 431 by hand (there is no `res` to write through at this point). Any other
// client error stays a silent socket destroy, as Node would do.
server.on('clientError', (err, socket) => {
  if (err.code === 'HPE_HEADER_OVERFLOW') {
    console.error(`arcade: 431 request headers over ${MAX_HEADER_BYTES} bytes — raise MAX_HEADER_BYTES`);
    if (socket.writable) {
      socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n');
      return;
    }
  }
  socket.destroy();
});

// Graceful shutdown: stop accepting, drain in-flight, then close the pool.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`arcade: ${signal} received, shutting down`);
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => process.exit(0));
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}

if (require.main === module) {
  // Listen FIRST so /health_check is ready immediately — the DB init (a Secrets Manager
  // round-trip) must not block readiness. Handlers use memory until the store attaches.
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CostBot Arcade listening on ${PORT}`);
    initStore().catch((err) => console.error('arcade: store init error:', err.message));
  });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { handler, server, viewer, num, displayLabel, playerLabel };
