# CostBot: Waste Hunter 🤖💥

A roguelite survivor mini-game starring CostBot. Terminate waves of cloud waste,
collect the savings, and level up by picking real AWS cost-optimization levers.
Each level-up quizzes you on the lever you chose — **you keep the upgrade either
way, and a correct answer pays a cash bonus** that triples on a streak.

**Score is measured in dollars saved.** Stages are 3 minutes.

Built to be **standalone playable now** and **embeddable inside a larger host
game later** — the mini-game owns one stage and hands a result back to the host.

---

## Run it

No build step, no dependencies, no server required.

```bash
xdg-open ../index.html       # the Arcade landing page
xdg-open index.html          # straight into Waste Hunter
```

| File | What it is |
|---|---|
| `index.html` | Standalone game — title, how-to-play, stage select, Bot Bay, achievements |
| `embed-example.html` | Fake "host game" showing the integration contract |
| `wh-content.js` | **All balance, content, and trivia.** Tune the game here. |
| `wh-game.js` | Engine — loop, systems, rendering, UI, host API |
| `../shared/arcade-music.js` | **Shared** soundtrack engine (7 tracks, 5 themes) |
| `../shared/arcade-biomes.js` | **Shared** arena palettes + procedural scenery |
| `assets/` | CostBot sprite + panel art (copied from `internal/images/`) |
| `smoketest.js` | Headless Playwright test — plays a run, answers trivia, screenshots |

### Controls
`WASD` / arrows to move (or hold the mouse button to steer) · `Esc` pause · `M` mute.
On a quiz, press `1`–`4` or `A`–`D`. Weapons fire automatically — you only position.

---

## How a run works

1. **Survive the 3-minute stage clock** while waste spawns at an increasing rate.
2. **Collect green `$` orbs** — they are simultaneously your score and your XP.
3. **Level up → pick 1 of 3** upgrades, each a real FinOps lever.
4. **Answer the quiz for a cash bonus.** One question drawn from that upgrade's
   topic, on an 18-second timer. Right → **$5,000**, rising to **×1.5 / ×2 / ×3**
   for consecutive correct answers. Wrong or timed out → no bonus. Either way you
   keep the upgrade and get the correct answer with an explanation. Any key or
   click skips the explanation once you've read it.
5. **The boss spawns when the clock hits zero.** Kill it to clear the stage.
6. **Bank AI tokens** (dollars ÷ 1000, ×1.5 on a clear) and spend them in the
   **Bot Bay** on permanent upgrades that persist across runs. Spending draws
   down your balance; the lifetime total keeps counting and is what feeds the
   arcade's shared build fund.

Clearing a stage unlocks the next one.

### The trivia bank

93 questions across 12 topics, all sourced from the internal
[`skills/optional/cost-optimizations/SKILL.md`](../../skills/optional/cost-optimizations/SKILL.md)
guidance (Confluence PRODPLAT — *AWS Cost Optimization Strategies*), so the
numbers are the ones the team actually quotes:

> *Migrating an EC2 workload from Intel to Graviton typically saves about how much?*
> → **~20%.** AMD → Graviton ≈ 10%, Intel → AMD ≈ 10%.

> *A nonprod resource costing what fraction of its prod twin should be flagged?*
> → **More than 30%.** >50% is strong overprovisioning; more than prod is almost certainly a mistake.

Questions cover Graviton, Spot, commitments/RIs, S3 and EBS storage classes,
Extended Support, idle/orphaned resources, rightsizing, visibility and the CUR,
tagging, nonprod, automation, and elasticity. Each upgrade quizzes you on **its
own topic** — take the Graviton Beam, get a Graviton question.

Choice order is shuffled every time, so answer position is never memorable.

### Content in the prototype

- **3 stages** — The EC2 Graveyard → Storage Sprawl → The Megabill's Ledger
- **7 enemy types** — Idle EC2, Zombie EIP, Orphaned EBS, Untagged Blob (splits!),
  Idle GPU Node, Extended Support Hydra (ranged), The Anomaly (flees, worth $6,000)
- **3 bosses** — Idle Sprawl Prime, The Untagged Colossus, The Megabill
- **7 weapons / 7 passives**, each mapped to a trivia topic
- **7 permanent Bot Bay upgrades** — including **FinOps Certification**, which
  strikes wrong answers off every quiz
- **19 achievements** — including *Well Read* (clear a stage without missing a
  question) and *Practitioner* (25 correct answers lifetime)
- **Run recap** — every resource type you terminated, broken out by name
- **How to Play** — the run loop, pickups, controls and a **bestiary** of every
  enemy and boss, all generated from `wh-content.js` so it cannot drift

---

## Embedding in the larger game

The host picks the stage, the mini-game runs it, and the result comes back.

```js
const game = WasteHunter.mount('#some-container', {
  stageId: 'ec2-graveyard',   // which stage to run
  showShell: false,           // no title/stage-select — the host owns navigation
  seed: 20260801,             // optional: deterministic run (same seed = same board)
  persist: true,              // localStorage meta; false = fully sandboxed
  returnLabel: 'Return to HQ',

  onComplete(result) {
    hostState.cash += result.dollarsSaved;
  },

  onEvent(type, payload) {
    // 'ready' | 'run:start' | 'run:levelup' | 'run:trivia'
    // 'run:boss' | 'run:achievement' | 'run:end' | 'exit'
  },
});

game.destroy();   // unmount cleanly
```

### Result payload

```js
{
  outcome: 'clear' | 'death' | 'quit',
  stageId, seed,
  dollarsSaved: 214340,
  tokensEarned: 321,
  timeSurvived: 181,
  kills: 786,
  killsByType: { idle_ec2: 512, orphan_ebs: 141, idle_sprawl: 1, … },
  level: 13,
  quizCorrect: 9, quizWrong: 3,
  weapons: [{ id, name, level }, ...],
  achievementsUnlocked: ['quiz_5', ...],
  meta: { /* full persistent profile */ }
}
```

`run:trivia` fires per question with `{ topic, correct, granted, upgrade }` — so
the host game can track what a player actually knows and, later, feed that into
its own progression.

### Other API surface

```js
WasteHunter.STAGES        // stage table — host can render its own map/level select
WasteHunter.CONTENT       // all content data (enemies, weapons, trivia…)
WasteHunter.loadMeta()    // read the saved profile
WasteHunter.resetMeta()   // wipe progression
```

Open `embed-example.html` to see all of this wired up against a pretend host.

---

## Iterating

**Balance, content and trivia live entirely in `wh-content.js`.** Nothing in the
engine hardcodes numbers.

| Want to change | Edit |
|---|---|
| Pace of level-ups | `XP.forLevel`, `XP.perDollar` |
| Stage length | each stage's `duration` (currently 180s) |
| Difficulty ramp | each stage's `spawnRate(t)` and `hpScale(t)` |
| How lethal swarms are | `CONTACT`, `PLAYER.iframes`, enemy `dmg` |
| Quiz stakes | `TRIVIA_RULES` — see below |
| Add a question | append to `TRIVIA` with a `topic` that an upgrade uses |
| Weapon feel | `WEAPONS[x].levels[]` — each entry is a full stat block |
| Add a stage | append to `STAGES` (host can launch it by `id` immediately) |

### Quiz stakes

```js
const TRIVIA_RULES = {
  mode: 'bonus',        // 'bonus' = always get the upgrade; correct pays cash
                        // 'gate'  = must answer correctly or forfeit the upgrade
  timeLimit: 18,        // seconds; 0 disables the timer
  correctBonus: 5000,   // base dollars for a correct answer
  streakStep: 0.5,      // each consecutive correct answer adds this multiplier
  streakCap: 3,         // ...capped here, so 3rd+ in a row pays 3x
  wrongConsolation: 0,  // dollars on a miss
  revealMs: 2600,       // auto-advance; any key/click skips it sooner
};
```

Both modes are implemented and tested. `'gate'` makes a wrong answer forfeit the
upgrade entirely — a harsher, higher-stakes variant if you ever want it.

### Verifying a change

```bash
node smoketest.js          # fast: ~60s sample of a run
FULL=1 node smoketest.js   # plays a whole 3-minute stage — use for pacing work
```

Boots headless Chromium, plays on autopilot, **answers the quiz by looking the
correct choice up in the content bank** (which also verifies the shuffle/render
path), deliberately misses ~1 in 4, forces the boss and stage-clear paths, walks
every menu, exercises the embed demo, checks that every upgrade topic has
questions behind it, asserts the How to Play bestiary lists every enemy, boss and
pickup the balance data defines, and fails on any console error.

`FULL=1` plays a whole stage on a fixed seed and prints the pacing curve:

```
t=22.2s   lvl=2   enemies=4    $6,680     quiz=1/1
t=43.4s   lvl=4   enemies=6    $27,810    quiz=3/3
t=63.6s   lvl=6   enemies=7    $44,319    quiz=4/5
t=104.6s  lvl=8   enemies=68   $80,295    quiz=6/7
t=145.3s  lvl=11  enemies=70   $145,527   quiz=8/10
t=180.9s  lvl=13  — boss arrived, 12 level-ups, 6 weapons
```

The bot steers to the nearest savings orb and backs off when an enemy closes
within 110px. That makes it a good **pacing** oracle but a poor **difficulty**
one — it dodges more perfectly than any human, so it finishes at full HP. Judge
difficulty by playing, not by this number.

---

## Known gaps / next up

- **Difficulty needs a real playtest.** The autopilot dodges perfectly, so it
  cannot tell you whether the current settings are too easy. Enemy damage, spawn
  rates and HP scaling were all cut, and the player now starts with 120 HP.
- Stages 2 and 3 have had no human playtesting.
- Enemy type icons use emoji, which render differently across platforms. The
  procedural bodies (colour + eyes) carry the identity; emoji are a bonus.
- No mobile touch joystick yet — drag-to-steer works, but it is untuned.
- Bot Bay is flat upgrades rather than a branching FinOps-pillar skill tree.
- All three bosses share one behaviour set (chase + minions + radial).
- Meta progression is `localStorage` only — no shared leaderboard yet.
