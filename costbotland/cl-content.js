/*
 * CostBotLand — content & balance bank
 * ------------------------------------------------------------------
 * A Disneyland-flavored park-triage game. CostBot (caped, $-shield) keeps a
 * four-land park alive: rides break, guests drop hats on the tracks, queues get
 * hungry — and every land has its own happiness meter draining in real time.
 * Sprint between incidents, or ride the loop train around the central castle
 * when the fire is on the far side.
 *
 * Everything a designer might tune lives here; cl-game.js reads it all from
 * CostBotLandContent. Flavor-only: the park, the lands and the jokes are made
 * up, and nothing here is a real cost figure. The board ranks on guests kept
 * happy, not dollars.
 */
(function (global) {
  'use strict';

  // Logical playfield; the engine authors everything in these units and scales
  // to whatever canvas it gets, so one layout serves phone and monitor.
  const FIELD = { w: 1000, h: 720 };

  // The castle sits dead-centre and is SOLID — you cannot walk through it, so you
  // route around the ring. Registered to the painted castle's footprint.
  const CASTLE = { x: 388, y: 252, w: 224, h: 150 };

  // The ring track is a SPEED LANE (see CHEF.trackBoost). Rectangular loop in the
  // plaza between castle and lands, registered to the painted track.
  const TRACK = { x: 300, y: 256, w: 404, h: 250 };

  // Four themed lands in the corners. Each has its own happiness meter and an
  // attraction anchor where incidents pop. `corner` (0=TL 1=TR 2=BR 3=BL) is the
  // nearest ring corner, used by the vector-fallback scenery.
  const LANDS = [
    { id: 'token',    name: 'Tokenland',       emoji: '🎢', color: '#3b82f6',
      rect: { x: 26, y: 118, w: 300, h: 196 },  attract: { x: 172, y: 200 }, corner: 0 },
    { id: 'cache',    name: 'Cache Mountain',  emoji: '⛰️', color: '#a855f7',
      rect: { x: 674, y: 118, w: 300, h: 196 }, attract: { x: 856, y: 190 }, corner: 1 },
    { id: 'frontier', name: 'Frontier Cloud',  emoji: '🤠', color: '#f59e0b',
      rect: { x: 26, y: 408, w: 300, h: 196 },  attract: { x: 165, y: 520 }, corner: 3 },
    { id: 'small',    name: "It's a Small Bill", emoji: '🚤', color: '#14b8a6',
      rect: { x: 674, y: 408, w: 300, h: 196 }, attract: { x: 852, y: 520 }, corner: 2 },
  ];

  // Incident types — the "recipes". `hold` is the seconds locked resolving it
  // (0 = instant grab). `sev` is how fast an unresolved incident drains its land.
  const INCIDENTS = {
    breakdown:   { id: 'breakdown',   label: 'Reset ride',  emoji: '🛠️', icon: '🎢', hold: 0.75, sev: 4.3, score: 800, verb: 'FIX' },
    obstruction: { id: 'obstruction', label: 'Clear track', emoji: '🧢', icon: '🧢', hold: 0.0,  sev: 3.4, score: 450, verb: 'GRAB' },
    hungry:      { id: 'hungry',      label: 'Serve food',  emoji: '🍔', icon: '🍔', hold: 0.35, sev: 2.7, score: 550, verb: 'SERVE' },
    spill:       { id: 'spill',       label: 'Clean up',    emoji: '🧹', icon: '🗑️', hold: 0.3,  sev: 2.1, score: 350, verb: 'CLEAN' },
  };
  // Which incident types are legal to spawn from a given day phase onward.
  const INCIDENT_POOL = ['breakdown', 'obstruction', 'hungry', 'spill'];

  // The day cycle sets the mood and a score multiplier; the finale is the payoff
  // window. Goal spawn cadence is flat (see SCORING.goalEvery), not per-phase.
  const PHASES = [
    { id: 'open',    at: 0,  name: 'Gates Open',  scoreMult: 1,    tint: '#12203a' },
    { id: 'midday',  at: 24, name: 'Midday Rush', scoreMult: 1,    tint: '#161228' },
    { id: 'parade',  at: 52, name: 'Parade!',     scoreMult: 1.25, tint: '#241033' },
    { id: 'finale',  at: 76, name: '🎆 Fireworks', scoreMult: 2,   tint: '#2a0f2e' },
  ];

  const SCORING = {
    roundSeconds: 90,
    // One new goal appears every this-many seconds in a random OPEN slot — any of
    // the 4 lands or the lost-child slot — so the player often waits for the next
    // one to pop, and several can be open at once. (The ticket line is separate.)
    goalEvery: 3,
    landStart: 100,          // each land opens fully happy
    landMax: 100,
    baseDecay: 1.15,         // happiness a land with an ACTIVE incident loses per second
    recoverRate: 3.5,        // happiness an idle (running-fine) land recovers per second
    repairGain: 26,          // happiness restored when an incident is resolved
    // Rides no longer close. Instead, every circle goal carries its OWN countdown:
    // clear it before the ring runs out or it vanishes and you lose park cash.
    goalTtl: 5.5,            // seconds a circle goal stays up before it's missed
    goalMissPenalty: 450,    // park cash lost when a goal times out unresolved
    // Final-stretch rush: for the last `rushWindow` seconds every countdown ticks
    // `finaleRush`× faster (goals, tickets, the lost child, churro spawns) — the
    // day's clock itself is unchanged, it just gets frantic.
    rushWindow: 30,
    finaleRush: 1.7,
    comboStep: 0.2,          // multiplier added per unbroken resolve
    comboMax: 4,
    // Tokens accrue LIVE as park cash (G.score) is earned, one token per this many
    // dollars of net score — see cl-game.js's tokenWatermark logic. Originally
    // $1,000/token (tuned for ~15 tokens/min cross-arcade parity); raised to a
    // flat ~100 tokens/min target per direct user request — a good ~90s round
    // nets roughly $12k-$28k, so at $140/token that's ~85-200 tokens/round,
    // ~100/min at the middle of that range.
    dollarsPerToken: 140,
    // Monetary penalties — park cash you LOSE when things aren't handled in time.
    childPenalty: 1400,      // a lost child gives up and leaves unescorted
    ticketPenalty: 500,      // a guest abandons the ticket line
  };

  // No rideable train anymore — the ring track is a SPEED LANE. When CostBot is
  // on the rails he moves `trackBoost`× faster, so routing around the loop beats
  // cutting across the plaza. `laneHalf` is how far off the rail still counts as on it.
  const CHEF = { walk: 300, r: 24, pickR: 42, trackBoost: 1.8, laneHalf: 46 };

  // The churro power-up: a speed boost you grab off the plaza.
  const CHURRO = { every: 17, boost: 1.6, dur: 6, emoji: '🌯', r: 30 };

  // The ticket booth is its OWN section (5th happiness meter). A line of guests
  // builds at the turnstiles; stand at the booth and scan to admit the front of
  // the line. The longer the line, the faster the gate's patience drains — heavy
  // at Gates Open. Let it hit zero and the gate jams (a closure, like a land).
  const GATE = {
    x: 500, y: 690, gap: 40, cap: 7, r: 62, dir: -1, // at the painted entrance; line queues left

    spawnOpen: 2.0,          // a new guest joins this often during Gates Open
    spawnOther: 3.8,         // ...and this often the rest of the day
    drainBase: 0.9,          // gate happiness lost per second at an empty booth
    drainPerGuest: 0.7,      // ...plus this much per guest currently in line
    scanGain: 9,             // happiness restored per guest admitted
    score: 260,              // cash earned per guest admitted
    // Only the front guest is on the clock — scan them within `patience`
    // seconds or they walk out (a cash penalty) and the line shuffles up.
    // There's no on-screen countdown for this one; the pressure is real,
    // the readout isn't (removed per playtest feedback).
    patience: 5,
    start: 100,
  };

  // Lost child: a pick-up-and-carry escort. A child appears (lost at the gate)
  // needing to reach a specific land. Lift them, cross the park — walk or take
  // the train — and drop them at the target attraction before their patience runs
  // out. You can't fix incidents while your hands are full.
  const CHILD = {
    every: 15, patience: 22, gain: 34, score: 1500, r: 42, emoji: '🧒',
    spawn: { x: 636, y: 656 },
  };

  global.CostBotLandContent = {
    FIELD, CASTLE, TRACK, LANDS, INCIDENTS, INCIDENT_POOL, PHASES, SCORING, CHEF, CHURRO, GATE, CHILD,
    // Perimeter of the train loop and a clockwise param s∈[0,perim) → point on it.
    trackPerim() { return 2 * (TRACK.w + TRACK.h); },
    trackXY(s) {
      const { x, y, w, h } = TRACK; const p = 2 * (w + h);
      s = ((s % p) + p) % p;
      if (s < w) return { x: x + s, y };
      if (s < w + h) return { x: x + w, y: y + (s - w) };
      if (s < w + h + w) return { x: x + w - (s - (w + h)), y: y + h };
      return { x, y: y + h - (s - (w + h + w)) };
    },
    // s of each corner station, clockwise from TL.
    stationS(corner) {
      const { w, h } = TRACK;
      return [0, w, w + h, w + h + w][corner];
    },
    phaseAt(t) { let p = PHASES[0]; for (const ph of PHASES) if (t >= ph.at) p = ph; return p; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
