# CostBot Arcade

CostBot wants to build things for the company and needs AI tokens to do it. You play
games, you earn the tokens, it ships. One source tree, served two ways.

| | Where | What it gives you |
|---|---|---|
| **Static** | GitHub Pages — `/CostManagement/CostBot/arcade/` | The games. No accounts, no scores, no API. |
| **Dynamic** | aix-proto — `/a/costbot-arcade/` | The same games, plus MyID identity, per-player profiles and leaderboards. |

```
arcade/
  index.html            landing page
  leaderboard/          all boards (needs the dynamic app)
  usage/                who is playing, how often, how long, plus the reset
                        controls. Unlinked and owner-gated: the page 404s and
                        its API 403s for everyone else, so reach it by URL
  jukebox/              audition the shared soundtrack
  waste-hunter/         the game
  mudslides/            the endless runner
    assets/             its own art (the Mudslide glass, the wipeout shot)
  mudsliders/           redirect stub — the game's old name, old URL
  shared/
    assets/             art used by the landing page itself (CostBot, CostBotLand)
                        the token coin ships in three sizes — pick the one that
                        covers your display size at 2x and no bigger:
                        token-coin-64.png   inline coins and canvas HUD (≤32px)
                        token-coin-128.png  the landing page's .tok (56px)
                        token-coin.png      512px master, regenerate the rest from it
    arcade-music.js     soundtrack engine — 8 tracks, 6 themes
    arcade-biomes.js    arena palettes + procedural scenery
    arcade-sync.js      optional bridge to a server profile
  tools/
    sync-to-app.sh      copy this tree into the aix-proto app
```

**`arcade/` is the source of truth.** The aix-proto app serves a *copy* at
`examples/costbot-arcade/public/`, because a Docker build needs real files in its
context — a symlink into another repo would not survive `COPY`.

---

## How to develop and test locally

### The fast loop — run the app, edit the source directly

This is the one to use. The server can serve the real source tree instead of its
copy, so there is no syncing during development at all:

```bash
cd ~/aix-proto/examples/costbot-arcade
npm run dev                     # ARCADE_PUBLIC defaults to ~/projects/costbot/arcade
# -> http://localhost:3000
```

You get the whole arcade **plus the API** — profiles, score submission, live
leaderboards. Edit anything under `arcade/` and just refresh; nothing to rebuild
and nothing to copy. Without a database it falls back to an in-memory store, and
the leaderboards work against it, so you can exercise the full app offline.
The Usage board is owner-gated on hub id; locally the viewer is `local-dev`, so run
with `ARCADE_ADMIN_HUB_IDS=local-dev` to see it.

Locally there is no MyID front door, so the viewer falls back to a stable
`local-dev` identity. That is deliberate: it keeps the app exercisable without
pretending to be authenticated.

### Resetting the data

The Usage board carries a danger zone with two scopes, both owner-only:

| Scope | Clears | Leaves |
|---|---|---|
| `runs` | the run ledger, so leaderboards go back to empty | wallets, the build fund, display names, visits |
| `all`  | runs, sessions **and** players — every purse and the whole fund | nothing |

`all` needs the word `RESET` typed, because there is no backup: the Postgres is
in-cluster and nothing here is recoverable.

**A server-side wipe alone does not work, and that is the interesting part.** Every
wallet is local-first — it lives in `localStorage` and is pushed back up on the next
page load — so truncating `players` gets silently undone by the first player through
the door, and the owner sees a reset that "did not take". So `all` also stamps a
`reset_epoch` in `app_meta`, which rides out on `/api/me`; `arcade-sync.js` compares
it against its own stamp and drops every `costbot.*` key before any game reads one.
That is what makes a reset reach *other people's* browsers rather than only the
database. A `runs` reset deliberately does **not** stamp it — nobody's purse is
affected, so no browser needs invalidating.

`tools/reset-verify.js` proves the whole loop headlessly (seed a purse → bank it →
wipe → reload → assert the money is gone rather than restored), including the
non-owner 404/403 paths:

```bash
node tools/reset-verify.js      # needs the app checkout at ~/aix-proto
```

### Games only — no API needed

For pure gameplay or art work, skip the server:

```bash
cd arcade && python3 -m http.server 8080     # -> http://localhost:8080
```

Or just open `arcade/waste-hunter/index.html` off the filesystem. `arcade-sync.js`
probes for an API, finds none, and silently disables itself — a 404 on `/api/me` in
the console is the expected, healthy path here.

### Automated checks

```bash
cd arcade/waste-hunter && node smoketest.js      # ~90s: full game suite
FULL=1 node smoketest.js                         # plays a whole stage; use for pacing work
cd arcade/mudslides && node smoketest.js         # ~15s: runner suite
cd ~/aix-proto/examples/costbot-arcade && npm test
```

The Waste Hunter suite drives a real headless run, answers the quiz from the content
bank, forces the boss and stage-clear paths, walks every menu including How to Play
(asserting its bestiary covers every enemy, boss and pickup the balance data defines),
checks that every theme resolves its tracks and biome, and fails on any console error.

Mudslides also has a per-game leaderboard — distance, near misses, top speed and
tokens, sortable by column. That needs three columns the shared arcade board never
had, so `runs` gained `distance` / `near_misses` / `top_speed` (additive migration,
existing rows carry zeros) and the app serves `GET /api/leaderboards/<game>`, one
ranked list per metric. **The client and the app have to deploy together**; against
an older app the endpoint 404s, the fetch fails and the board silently falls back to
your own local run history, which is also what static hosting always shows.

The Mudslides suite drives a run, checks the mud spray and wake are emitting, verifies
the Mudslide power-up banks a shield, walks the how-to-play screen (asserting it lists
every token and power-up the balance data actually defines), forces a wipeout and checks
it names the vendor that caused it, and validates the soundtrack's shape (bar counts,
note range, break/fill bars) for every track — the music engine is shared, so a change
made for one game has to keep the others well-formed.

Both write screenshots to their own `shots/`, which is gitignored and excluded from
the app image.

### Before you deploy

```bash
cd arcade && ./tools/sync-to-app.sh          # copy source -> app, verify Dockerfile paths
cd ~/aix-proto && aix-proto check --apps-dir ~/aix-proto/examples
aix-proto deploy costbot-arcade --tier dynamic --db postgres
aix-proto status costbot-arcade --wait
```

`sync-to-app.sh --check` reports drift without changing anything and exits non-zero
if the two copies have diverged — useful as a pre-deploy guard.

### What local checks do NOT cover

`aix-proto run` executes the app **directly, not through Docker**, so nothing local
exercises the image. A Dockerfile that references a file you deleted, or forgets to
`COPY` a directory, passes every local gate and fails in CI — or worse, builds green
and serves 404s. `sync-to-app.sh` now verifies every `COPY` source resolves, which
catches the first case; the second is why `public/` is copied explicitly.

---

## How the pieces fit

**Identity is the platform's.** aix-proto authenticates at the front door with MyID
and injects the verified viewer as `x-aix-hub-id` (AD groups as `x-aix-groups`).
There is no login to build, no credential stored, and a score cannot be submitted as
somebody else — which is what makes the leaderboard worth having.

**Sync is optional by design.** `arcade-sync.js` resolves its API base from its own
script URL (pages sit at different depths, and aix-proto nests everything under
`/a/<slug>/`), probes once, and disables itself if nothing answers. The same files
run unchanged in both places. On first sign-in it imports existing `localStorage`
progress so nothing already earned is lost.

**Failure degrades, it does not break.** No database → in-memory store. No API →
local-only play. The client keeps its `localStorage` copy either way, so a run never
depends on the network.

## Adding a game

1. Make a folder next to `waste-hunter/`.
2. Include the shared scripts:
   ```html
   <script src="../shared/arcade-music.js"></script>
   <script src="../shared/arcade-biomes.js"></script>
   <script src="../shared/arcade-sync.js"></script>
   ```
3. Report results through `ArcadeSync.submit(result, profile)` using the same shape
   Waste Hunter emits (`stageId`, `outcome`, `dollarsSaved`, `quizCorrect`, …) and it
   lands on the leaderboards automatically.
4. Add a card to `index.html`.

Soundtrack, biomes, identity, profiles and scoring all come for free.
