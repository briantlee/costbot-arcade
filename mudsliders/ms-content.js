/* ============================================================================
 * CostBot Mudsliders — CONTENT / BALANCE
 * ----------------------------------------------------------------------------
 * CostBot slides down a muddy hill collecting AI tokens to build the ultimate
 * FinOps app. Three lanes, jump, slide. Endless, escalating.
 *
 * Every tunable lives here; ms-game.js hardcodes no balance.
 * ==========================================================================*/
((global) => {
  'use strict';

  // ---------------------------------------------------------------------------
  // WORLD / FEEL
  //   z is distance down the hill in world units. Speed is z-units per second.
  // ---------------------------------------------------------------------------
  const WORLD = {
    lanes: [-1, 0, 1],
    laneWidth: 320,          // world units between lane centres
    drawDistance: 5200,      // how far ahead we render
    startSpeed: 900,
    maxSpeed: 3000,
    accel: 13,               // speed gained per second survived
    laneShiftTime: 0.14,     // seconds to slide between lanes
    jump: { impulse: 1180, gravity: 3000, maxHold: 0.16 },
    slideTime: 0.55,
    // A crash costs you the run unless a Reserved Instance shield absorbs it.
    crashGrace: 0.9,         // seconds of invulnerability after a shield saves you
  };

  // ---------------------------------------------------------------------------
  // TOKENS — the score, and the currency that builds the app
  // ---------------------------------------------------------------------------
  const TOKENS = {
    input: { name: 'Input token', value: 1, color: '#7fd6c4', glow: '#3fa891', r: 15 },
    output: { name: 'Output token', value: 5, color: '#ffd76b', glow: '#f0a52c', r: 19 },
    cached: { name: 'Cached token', value: 2, color: '#a06bff', glow: '#7b3fe0', r: 15,
      // cached tokens arrive in trails; clearing a whole trail pays the streak
      streakBonus: 12 },
  };

  // Tokens are the score. This is the rate they convert at for the arcade's
  // shared wallet and the dollar-denominated leaderboards.
  const DOLLARS_PER_TOKEN = 25;

  // ---------------------------------------------------------------------------
  // OBSTACLES
  //   kind: 'jump'  — low, clear it by jumping
  //         'slide' — high, get under it by sliding
  //         'block' — full height, change lane or die
  //         'chasm' — a gap in the hill, jump or fall
  //         'tar'   — no crash, but it drags you to a crawl
  // ---------------------------------------------------------------------------
  const OBSTACLES = {
    idle_ec2: { name: 'Idle EC2', kind: 'block', glyph: '💤', color: '#5b6b8c', accent: '#8fa3cc',
      w: 200, h: 200, blurb: 'Running 24/7. Serving nobody.' },
    ebs_boulder: { name: 'Orphaned EBS', kind: 'jump', glyph: '💾', color: '#3f7f74', accent: '#7fd6c4',
      w: 230, h: 95, blurb: 'The instance died in 2023. The volume rolled on.' },
    rate_limit: { name: 'Rate Limit', kind: 'slide', glyph: '🚧', color: '#a33f5f', accent: '#f08fae',
      w: 300, h: 130, blurb: '429. Get under it.' },
    untagged_crate: { name: 'Untagged Crate', kind: 'block', glyph: '🏷️', color: '#8c6b3f', accent: '#e0b877',
      w: 190, h: 185, blurb: 'No owner, no cost centre, no way through.' },
    egress_fan: { name: 'Egress Draft', kind: 'jump', glyph: '💨', color: '#4b6b8f', accent: '#a8c8ec',
      w: 250, h: 80, blurb: 'Data leaving the region, at a price.' },
    support_tar: { name: 'Extended Support Tar', kind: 'tar', glyph: '🛢️', color: '#4b3b2f', accent: '#8a6a3f',
      w: 300, h: 40, slow: 0.45, dur: 1.1, blurb: 'Year 3 fees. Everything slows down.' },
    billing_gap: { name: 'Billing Gap', kind: 'chasm', glyph: '🕳️', color: '#0a0d14', accent: '#2b3f66',
      w: 340, h: 0, blurb: 'Month-end close. Mind the gap.' },
  };

  // What can appear, and from what distance travelled (metres) it starts.
  const SPAWN_TABLE = [
    { type: 'idle_ec2', weight: 34, from: 0 },
    { type: 'ebs_boulder', weight: 30, from: 0 },
    { type: 'rate_limit', weight: 22, from: 260 },
    { type: 'untagged_crate', weight: 24, from: 420 },
    { type: 'billing_gap', weight: 18, from: 620 },
    { type: 'egress_fan', weight: 20, from: 900 },
    { type: 'support_tar', weight: 14, from: 1200 },
  ];

  // Hazard density ramps with distance; never so dense that all three lanes close.
  // Hazard spacing is expressed in SECONDS OF WARNING, not world units. Spacing by
  // distance looks fine at the start speed and becomes unplayable at the top one —
  // the same 420-unit gap is 1.4s at 300/s and 0.14s at 3000/s.
  const DIFFICULTY = {
    reactionAt: (m) => Math.max(0.78, 1.55 - m * 0.00035),  // seconds to read a row
    minGap: 430,                                            // world-unit floor
    firstRowZ: 2600,                                        // ~3s of clear road to settle in
    maxBlockedAt: (m) => (m < 400 ? 1 : 2),                 // never all three
    chasmFrom: 620,
    chasmChance: 0.16,
    tokenChance: 0.72,
    trailChance: 0.30,
    powerupEvery: 2600,
  };

  // ---------------------------------------------------------------------------
  // POWER-UPS — every one is a real cost lever
  // ---------------------------------------------------------------------------
  const POWERUPS = {
    batch: { name: 'Batch API', icon: '📦', dur: 8, color: '#7fd6c4',
      blurb: 'Double tokens, everything slows down.',
      fact: 'Batch processing trades latency for roughly half the price.' },
    cache: { name: 'Prompt Cache', icon: '🧲', dur: 9, color: '#a06bff',
      blurb: 'Pulls every token on the hill toward you.',
      fact: 'Cached input tokens cost a fraction of fresh ones.' },
    graviton: { name: 'Graviton Skates', icon: '⚡', dur: 7, color: '#ffd76b',
      blurb: 'Faster, and you jump further.',
      fact: 'Graviton: ~20% better price-performance than x86.' },
    reserved: { name: 'RI Shield', icon: '🛡️', dur: 0, color: '#6ee7a0',
      blurb: 'Absorbs one crash. Stacks up to three.',
      fact: 'A commitment protects you against one bad month.' },
    spot: { name: 'Spot Burst', icon: '🚀', dur: 6, color: '#ff9e2c',
      blurb: 'Huge speed burst — but Spot can be reclaimed.',
      fact: 'Up to 90% off, if you can tolerate interruption.' },
  };

  // ---------------------------------------------------------------------------
  // THE BUILD — tokens accumulate across runs toward the ultimate FinOps app.
  // Each module grants a permanent perk, which is the reason to run again.
  // ---------------------------------------------------------------------------
  const MODULES = [
    { id: 'ingest', name: 'CUR Ingest', icon: '🗃️', cost: 400,
      perk: 'Start each run with 1 RI Shield',
      blurb: 'Nothing works until the bill is in the warehouse.' },
    { id: 'explorer', name: 'Cost Explorer', icon: '🔍', cost: 1200,
      perk: '+25% token pickup radius',
      blurb: 'You cannot cut what you cannot see.' },
    { id: 'tagging', name: 'Tag Compliance', icon: '🏷️', cost: 2600,
      perk: 'Untagged Crates appear 30% less often',
      blurb: 'Ownership, finally.' },
    { id: 'anomaly', name: 'Anomaly Detection', icon: '📈', cost: 4800,
      perk: 'Hazards flash a warning one row earlier',
      blurb: 'See the spike before it lands.' },
    { id: 'commitments', name: 'Commitment Engine', icon: '🛡️', cost: 8200,
      perk: 'RI Shields stack to 3',
      blurb: 'Buy the discount, keep the flexibility.' },
    { id: 'chargeback', name: 'Chargeback Engine', icon: '🧾', cost: 13500,
      perk: '+15% tokens from every pickup',
      blurb: 'Now the teams can see their own numbers.' },
    { id: 'autopilot', name: 'FinOps Autopilot', icon: '🤖', cost: 21000,
      perk: 'Start each run at a higher speed for a bigger score multiplier',
      blurb: 'The ultimate FinOps app. It runs itself.' },
  ];

  // ---------------------------------------------------------------------------
  // SCORING EXTRAS
  // ---------------------------------------------------------------------------
  const SCORING = {
    dodgeWindow: 900,        // world units since the lane change that still counts as a dodge
    nearMissTokens: 3,
    distanceTokensPer: 30,   // a token every N metres survived
    speedBonusAt: 2200,      // above this speed, pickups pay double
  };

  const ACHIEVEMENTS = [
    { id: 'ms_first', name: 'First Descent', icon: '🛷', desc: 'Finish your first run.' },
    { id: 'ms_1k', name: 'Token Economy', icon: '🪙', desc: 'Collect 1,000 tokens in one run.' },
    { id: 'ms_2km', name: 'Long Hauler', icon: '📏', desc: 'Survive 2,000 metres.' },
    { id: 'ms_nearmiss', name: 'Paper Thin', icon: '🌬️', desc: '25 near misses in one run.' },
    { id: 'ms_nohit', name: 'Clean Sheet', icon: '✨', desc: 'Reach 1,000m without using a shield.' },
    { id: 'ms_topspeed', name: 'Terminal Velocity', icon: '🚀', desc: 'Hit maximum speed.' },
    { id: 'ms_built', name: 'Ultimate FinOps App', icon: '🤖', desc: 'Unlock every module.' },
  ];

  const TIPS = [
    'Cached tokens come in trails — clear a whole one for a streak bonus.',
    'Tar pits will not kill you. They will cost you every token ahead of you.',
    'Graviton Skates make your jumps longer. Use them on chasm-heavy stretches.',
    'A near miss pays. Dodging early pays nothing.',
    'Spot Burst is the fastest way down, and the fastest way into a crate.',
    'Tokens you collect are banked toward the app even when you crash.',
  ];

  global.MS_CONTENT = {
    WORLD, TOKENS, DOLLARS_PER_TOKEN, OBSTACLES, SPAWN_TABLE, DIFFICULTY,
    POWERUPS, MODULES, SCORING, ACHIEVEMENTS, TIPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
