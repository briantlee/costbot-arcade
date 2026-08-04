/* ============================================================================
 * CostBot: Waste Hunter — CONTENT / BALANCE / TRIVIA
 * ----------------------------------------------------------------------------
 * Everything tunable lives in this file. The engine (wh-game.js) reads it and
 * never hardcodes balance. Edit numbers here to iterate on feel.
 *
 * Trivia questions and upgrade facts are sourced from the internal
 * "AWS Cost Optimization Strategies" guidance:
 *   skills/optional/cost-optimizations/SKILL.md
 *   (Confluence PRODPLAT — AWS Cost Optimization Strategies)
 * ==========================================================================*/
((global) => {
  'use strict';

  // ---------------------------------------------------------------------------
  // PLAYER BASE STATS
  // ---------------------------------------------------------------------------
  const PLAYER = {
    maxHp: 100,
    speed: 200,           // px/sec
    pickupRadius: 108,
    radius: 22,
    iframes: 0.85,        // seconds of invulnerability after a hit
    regen: 0,             // hp/sec
  };

  // ---------------------------------------------------------------------------
  // XP CURVE
  // Deliberately steep: early levels are cheap so the opening ramps fast, late
  // levels cost real money so you are not drafting every 8 seconds at the end.
  // Targets ~11-12 level-ups across a 3-minute stage.
  //   lvl 1 => ~$960     lvl 6 => ~$22K     lvl 12 => ~$147K (cumulative)
  // ---------------------------------------------------------------------------
  const XP = {
    forLevel: (lvl) => Math.round(55 + lvl ** 2.2 * 9),
    perDollar: 1 / 15,    // a $120 Idle EC2 => 8 xp
  };

  // Killing the boss used to end the run 900ms later, which stranded every orb
  // still on the floor — you watched a stage's worth of savings evaporate. This
  // is a victory lap: spawning has already stopped, so it is pure collection.
  const VICTORY_LAP = 3;   // seconds

  // Contact damage is gated by i-frames so a swarm cannot delete you instantly.
  // You take the biggest single toucher's damage, scaled slightly by crowd size.
  const CONTACT = { crowdBonus: 0.035, crowdCap: 2.0 };

  // ---------------------------------------------------------------------------
  // TRIVIA RULES
  //   mode 'gate'  = you must answer correctly to receive the upgrade you picked
  //   mode 'bonus' = you always get the upgrade; a correct answer adds cash
  // ---------------------------------------------------------------------------
  const TRIVIA_RULES = {
    mode: 'bonus',        // you always receive the upgrade you picked;
                          // a correct answer pays a cash bonus on top
    timeLimit: 0,         // seconds; 0 = no timer, take as long as you like
    correctBonus: 5000,   // base dollars awarded for a correct answer
    streakStep: 0.5,      // each consecutive correct answer adds this multiplier
    streakCap: 3,         // ...up to this cap (so 3rd+ in a row pays 3x)
    wrongConsolation: 0,  // dollars awarded on a miss
    revealMs: 2600,       // auto-advance after this long; any key/click skips it
    allowRepeats: false,  // reuse questions once the bank is exhausted
  };

  // ---------------------------------------------------------------------------
  // ENEMIES
  //   value  = dollars dropped (this is the score currency)
  //   weight = relative spawn chance inside a stage's table
  // ---------------------------------------------------------------------------
  const ENEMIES = {
    idle_ec2: {
      name: 'Idle EC2', glyph: '💤', color: '#5b6b8c', accent: '#8fa3cc',
      hp: 12, speed: 46, dmg: 4, radius: 17, value: 120,
      blurb: 'Running 24/7. Serving nobody.',
    },
    zombie_eip: {
      name: 'Zombie EIP', glyph: '📮', color: '#7b5ea7', accent: '#b79ee0',
      hp: 8, speed: 88, dmg: 3, radius: 13, value: 90,
      blurb: 'Unattached elastic IP. Billed hourly, forever.',
    },
    orphan_ebs: {
      name: 'Orphaned EBS', glyph: '💾', color: '#3f7f74', accent: '#7fd6c4',
      hp: 30, speed: 36, dmg: 7, radius: 22, value: 280,
      blurb: 'The instance died in 2023. The volume did not.',
    },
    untagged_blob: {
      name: 'Untagged Blob', glyph: '🏷️', color: '#8c6b3f', accent: '#e0b877',
      hp: 22, speed: 50, dmg: 6, radius: 20, value: 210,
      blurb: 'No owner. No team. No accountability.',
      splits: 2,          // spawns 2 smaller copies on death
    },
    idle_gpu: {
      name: 'Idle GPU Node', glyph: '🎮', color: '#a33f5f', accent: '#f08fae',
      hp: 60, speed: 32, dmg: 12, radius: 26, value: 950,
      blurb: 'p4d.24xlarge. Utilization: 3%.',
    },
    support_hydra: {
      name: 'Extended Support Hydra', glyph: '🐍', color: '#4b6b2f', accent: '#a8dc72',
      hp: 95, speed: 28, dmg: 10, radius: 30, value: 1500,
      blurb: 'Year 3 fees are double Year 1. It has three heads.',
      ranged: { cd: 2.8, speed: 175, dmg: 8, count: 3 },
    },
    anomaly: {
      name: 'The Anomaly', glyph: '📈', color: '#c23b3b', accent: '#ffb0b0',
      hp: 45, speed: 105, dmg: 8, radius: 19, value: 6000,
      blurb: 'Spiking. Fleeing. Worth a fortune if you catch it.',
      elite: true, flees: true,
    },
  };

  // ---------------------------------------------------------------------------
  // BOSSES
  // ---------------------------------------------------------------------------
  const BOSSES = {
    idle_sprawl: {
      name: 'IDLE SPRAWL PRIME', glyph: '🖥️', color: '#44557a', accent: '#9fb4e0',
      hp: 2400, speed: 40, dmg: 18, radius: 62, value: 42000,
      tagline: 'Nine hundred instances. One purpose: none.',
      spawns: { type: 'idle_ec2', cd: 3.4, count: 3 },
      radial: { cd: 4.6, count: 12, speed: 150, dmg: 10 },
    },
    untagged_colossus: {
      name: 'THE UNTAGGED COLOSSUS', glyph: '🗂️', color: '#8a6a2f', accent: '#f0cc7a',
      hp: 3900, speed: 46, dmg: 21, radius: 66, value: 78000,
      tagline: 'Cost center: unknown. Owner: unknown. Size: enormous.',
      spawns: { type: 'untagged_blob', cd: 3.0, count: 3 },
      radial: { cd: 4.0, count: 16, speed: 165, dmg: 12 },
    },
    megabill: {
      name: 'THE MEGABILL', glyph: '🧾', color: '#b03040', accent: '#ffa8b4',
      hp: 6400, speed: 52, dmg: 26, radius: 72, value: 150000,
      tagline: 'Every line item you ignored, in one invoice.',
      spawns: { type: 'idle_gpu', cd: 3.2, count: 2 },
      radial: { cd: 3.4, count: 20, speed: 185, dmg: 13 },
    },
  };

  // ---------------------------------------------------------------------------
  // STAGES — 3 minutes each; ramps compressed to match.
  // ---------------------------------------------------------------------------
  const STAGES = [
    {
      id: 'ec2-graveyard',
      name: 'The EC2 Graveyard',
      subtitle: 'us-east-1 · Zone of Perpetual Uptime',
      art: 'research_mode.png',
      duration: 180,
      floor: '#101725', grid: '#1b2942', fog: 'rgba(12,18,30,0.55)',
      // The opener is 10% hotter than it was: enemies carry 10% more HP and
      // arrive 10% faster. It is still the tutorial stage, just not a walkover.
      hpScale: (t) => (1 + t / 130) * 1.1,
      spawnRate: (t) => (0.85 + t / 30) * 1.1,
      table: [
        { type: 'idle_ec2', weight: 60, from: 0 },
        { type: 'zombie_eip', weight: 30, from: 18 },
        { type: 'orphan_ebs', weight: 22, from: 45 },
        { type: 'untagged_blob', weight: 16, from: 80 },
      ],
      elite: { type: 'anomaly', cd: 32, from: 25 },
      boss: 'idle_sprawl',
      reward: 'Unlocks Storage Sprawl',
    },
    {
      id: 'storage-sprawl',
      name: 'Storage Sprawl',
      subtitle: 'Snapshots all the way down',
      art: 'query_optimizer.png',
      duration: 180,
      floor: '#0d1a1c', grid: '#183034', fog: 'rgba(10,24,26,0.55)',
      hpScale: (t) => 1 + t / 100,
      spawnRate: (t) => 1.1 + t / 22,
      table: [
        { type: 'orphan_ebs', weight: 46, from: 0 },
        { type: 'untagged_blob', weight: 34, from: 0 },
        { type: 'idle_ec2', weight: 26, from: 0 },
        { type: 'zombie_eip', weight: 24, from: 20 },
        { type: 'support_hydra', weight: 12, from: 60 },
      ],
      elite: { type: 'anomaly', cd: 28, from: 18 },
      boss: 'untagged_colossus',
      reward: 'Unlocks The Ledger',
    },
    {
      id: 'the-ledger',
      name: "The Megabill's Ledger",
      subtitle: 'Month-end close. Nothing is reconciled.',
      art: 'alert_mode.png',
      duration: 180,
      floor: '#1a0f14', grid: '#33202a', fog: 'rgba(26,12,18,0.55)',
      hpScale: (t) => 1 + t / 75,
      spawnRate: (t) => 1.4 + t / 15,
      table: [
        { type: 'idle_gpu', weight: 30, from: 0 },
        { type: 'support_hydra', weight: 26, from: 0 },
        { type: 'untagged_blob', weight: 28, from: 0 },
        { type: 'orphan_ebs', weight: 24, from: 0 },
        { type: 'idle_ec2', weight: 20, from: 0 },
        { type: 'zombie_eip', weight: 20, from: 0 },
      ],
      elite: { type: 'anomaly', cd: 24, from: 15 },
      boss: 'megabill',
      reward: 'Prototype complete — more stages coming',
    },
  ];

  // ---------------------------------------------------------------------------
  // WEAPONS
  //   topic = which trivia category this upgrade quizzes you on
  //   fact  = the takeaway tip shown on the draft card
  // ---------------------------------------------------------------------------
  const WEAPONS = {
    rightsizer: {
      name: 'Rightsizer', icon: '🎯', starter: true, topic: 'rightsizing',
      blurb: 'Fires a precision bolt at the nearest waste.',
      fact: 'Ask three questions of every line item: can it be retired, can it be rightsized, can it be committed?',
      levels: [
        { cd: 0.50, dmg: 14, count: 1, speed: 520, pierce: 0, note: 'One bolt, on cooldown.' },
        { cd: 0.46, dmg: 18, count: 1, speed: 540, pierce: 0, note: '+damage' },
        { cd: 0.42, dmg: 21, count: 2, speed: 560, pierce: 0, note: '+1 bolt' },
        { cd: 0.40, dmg: 26, count: 2, speed: 580, pierce: 1, note: 'Bolts pierce 1' },
        { cd: 0.34, dmg: 32, count: 3, speed: 620, pierce: 1, note: '+1 bolt' },
        { cd: 0.28, dmg: 42, count: 4, speed: 660, pierce: 2, note: 'MAX · shredder' },
      ],
    },
    kill_idle: {
      name: 'Kill Idle', icon: '💥', topic: 'idle',
      blurb: 'Shockwave that terminates everything nearby.',
      fact: 'Deleting an orphaned volume or an idle instance is a 100% saving. Erased data is the cheapest data.',
      levels: [
        { cd: 3.2, dmg: 22, radius: 118, knock: 190, note: 'Nova pulse.' },
        { cd: 2.9, dmg: 30, radius: 136, knock: 205, note: '+radius' },
        { cd: 2.6, dmg: 40, radius: 154, knock: 220, note: '+damage' },
        { cd: 2.3, dmg: 54, radius: 176, knock: 240, note: '+radius' },
        { cd: 2.0, dmg: 72, radius: 200, knock: 265, note: '+damage' },
        { cd: 1.6, dmg: 96, radius: 232, knock: 300, note: 'MAX · room clearer' },
      ],
    },
    savings_plan: {
      name: 'Savings Plan', icon: '🛡️', topic: 'commitments',
      blurb: 'Committed orbs that circle you and grind on contact.',
      fact: 'Stable 12-month usage earns roughly 30% off with a 1-year RI — and about 50% on DynamoDB.',
      levels: [
        { count: 2, dmg: 13, radius: 88, spin: 2.2, note: '2 orbiting orbs.' },
        { count: 3, dmg: 16, radius: 92, spin: 2.3, note: '+1 orb' },
        { count: 3, dmg: 22, radius: 100, spin: 2.5, note: '+damage' },
        { count: 4, dmg: 28, radius: 108, spin: 2.6, note: '+1 orb' },
        { count: 5, dmg: 35, radius: 116, spin: 2.8, note: '+1 orb' },
        { count: 6, dmg: 46, radius: 128, spin: 3.1, note: 'MAX · full commitment' },
      ],
    },
    graviton_beam: {
      name: 'Graviton Beam', icon: '⚡', topic: 'graviton',
      blurb: 'Piercing beam fired the way you are moving.',
      fact: 'Intel → Graviton is about 20% off, AMD → Graviton about 10%.',
      levels: [
        { cd: 1.9, dmg: 26, width: 16, len: 460, note: 'Piercing beam.' },
        { cd: 1.7, dmg: 34, width: 20, len: 520, note: '+width' },
        { cd: 1.5, dmg: 45, width: 24, len: 580, note: '+damage' },
        { cd: 1.3, dmg: 58, width: 30, len: 650, note: '+width' },
        { cd: 1.1, dmg: 76, width: 36, len: 730, note: '+damage' },
        { cd: 0.9, dmg: 104, width: 46, len: 840, note: 'MAX · arm64 supremacy' },
      ],
    },
    s3_lifecycle: {
      name: 'S3 Lifecycle', icon: '🧊', topic: 'storage',
      blurb: 'Drops a cold-storage zone that decays anything inside.',
      fact: 'Intelligent Tiering cuts 40–68% off Standard with no performance impact. gp2 → gp3 saves ~20%.',
      levels: [
        { cd: 3.0, dps: 20, radius: 82, life: 4.0, slow: 0.55, note: 'Chilling field.' },
        { cd: 2.8, dps: 27, radius: 92, life: 4.4, slow: 0.52, note: '+radius' },
        { cd: 2.6, dps: 36, radius: 102, life: 4.8, slow: 0.48, note: '+damage' },
        { cd: 2.4, dps: 47, radius: 114, life: 5.2, slow: 0.44, note: '+radius' },
        { cd: 2.2, dps: 62, radius: 126, life: 5.6, slow: 0.40, note: '+damage' },
        { cd: 1.9, dps: 84, radius: 142, life: 6.2, slow: 0.34, note: 'MAX · deep freeze' },
      ],
    },
    spot_fleet: {
      name: 'Spot Fleet', icon: '🛰️', topic: 'spot',
      blurb: 'Cheap homing drones. Sometimes they get interrupted.',
      fact: 'Spot is up to 90% off — for fault-tolerant work: containers, batch, CI/CD, big data, ML.',
      levels: [
        { cd: 1.5, dmg: 30, count: 2, speed: 300, interrupt: 0.30, note: '30% eviction rate.' },
        { cd: 1.4, dmg: 38, count: 2, speed: 315, interrupt: 0.27, note: '+damage' },
        { cd: 1.3, dmg: 48, count: 3, speed: 330, interrupt: 0.24, note: '+1 drone' },
        { cd: 1.2, dmg: 60, count: 3, speed: 345, interrupt: 0.20, note: '+damage' },
        { cd: 1.1, dmg: 76, count: 4, speed: 360, interrupt: 0.16, note: '+1 drone' },
        { cd: 0.95, dmg: 98, count: 5, speed: 380, interrupt: 0.10, note: 'MAX · diversified pools' },
      ],
    },
    cur_scan: {
      name: 'CUR Scan', icon: '📡', topic: 'visibility',
      blurb: 'A rotating radar sweep that bills everything it touches.',
      fact: 'The CUR is the only source of truth. Cost Explorer ignores Disney discount rates — trends only.',
      levels: [
        { dmg: 16, len: 150, spin: 1.5, arc: 0.5, note: 'Rotating sweep.' },
        { dmg: 21, len: 170, spin: 1.6, arc: 0.55, note: '+length' },
        { dmg: 28, len: 190, spin: 1.7, arc: 0.6, note: '+damage' },
        { dmg: 37, len: 215, spin: 1.85, arc: 0.68, note: '+arc' },
        { dmg: 48, len: 240, spin: 2.0, arc: 0.76, note: '+damage' },
        { dmg: 64, len: 275, spin: 2.2, arc: 0.9, note: 'MAX · full visibility' },
      ],
    },
  };

  // ---------------------------------------------------------------------------
  // PASSIVES
  // ---------------------------------------------------------------------------
  const PASSIVES = {
    reserved_capacity: {
      name: 'Reserved Capacity', icon: '❤️', max: 5, topic: 'commitments',
      blurb: '+18 max HP and heal for the difference.',
      fact: 'Reserved Instances trade flexibility for a deep, predictable discount on steady-state usage.',
      apply: (p, lvl) => { p.maxHp = PLAYER.maxHp + 18 * lvl; },
    },
    auto_scaling: {
      name: 'Auto-Scaling', icon: '🏃', max: 5, topic: 'elasticity',
      blurb: '+9% movement speed.',
      fact: 'If a service falls over at 70% CPU, target ~50% and keep the buffer. Then scale nonprod to zero off-hours.',
      apply: (p, lvl) => { p.speed = PLAYER.speed * (1 + 0.09 * lvl); },
    },
    tag_compliance: {
      name: 'Tag Compliance', icon: '🧲', max: 5, topic: 'tagging',
      blurb: '+26% savings pickup radius.',
      fact: 'You cannot allocate what you cannot tag. Untagged spend has no owner and never gets optimized.',
      apply: (p, lvl) => { p.pickupRadius = PLAYER.pickupRadius * (1 + 0.26 * lvl); },
    },
    commitment_discount: {
      name: 'Commitment Discount', icon: '💪', max: 5, topic: 'extended_support',
      blurb: '+12% weapon damage.',
      fact: 'Extended Support is a pure surcharge — upgrading the engine version eliminates 100% of it.',
      apply: (p, lvl) => { p.dmgMult = 1 + 0.12 * lvl; },
    },
    automation: {
      name: 'Automation', icon: '⚙️', max: 5, topic: 'automation',
      blurb: '-8% weapon cooldowns.',
      fact: 'A saving that needs a human every month is not a saving. Lifecycle rules and log expiry run themselves.',
      apply: (p, lvl) => { p.cdMult = 0.92 ** lvl; },
    },
    finops_culture: {
      name: 'FinOps Culture', icon: '📊', max: 5, topic: 'visibility',
      blurb: '+15% dollars from every pickup.',
      fact: 'Cover the top 70–80% of spend. Small tips on small line items just drown out the big win.',
      apply: (p, lvl) => { p.goldMult = 1 + 0.15 * lvl; },
    },
    armor_plating: {
      name: 'Chargeback Armor', icon: '🪖', max: 5, topic: 'nonprod',
      blurb: '-9% damage taken.',
      fact: 'Nonprod costing >30% of prod is a red flag. Right-sizing it is low risk and often cuts 80–90%.',
      apply: (p, lvl) => { p.dr = 0.91 ** lvl; },
    },
  };

  // ---------------------------------------------------------------------------
  // TRIVIA BANK
  //   Lives in shared/arcade-trivia.js so every cabinet asks from the same bank
  //   — Waste Hunter on level-up, Holiday in Colombia to buy bait. Add questions
  //   there, not here. Empty if that script did not load, which the engine
  //   tolerates: no bank simply means no quiz.
  // ---------------------------------------------------------------------------
  const TRIVIA = (global.ArcadeTrivia && global.ArcadeTrivia.BANK) || [];

  // ---------------------------------------------------------------------------
  // PERMANENT META UPGRADES (bought with AI tokens between runs)
  // ---------------------------------------------------------------------------
  const META_UPGRADES = {
    chassis: {
      name: 'Reinforced Chassis', icon: '🛠️', max: 8,
      blurb: (l) => `+${l * 8} starting max HP`,
      cost: (l) => 150 + l * 130,
      apply: (p, l) => { p.maxHp += 8 * l; },
    },
    thrusters: {
      name: 'Cape Thrusters', icon: '🚀', max: 6,
      blurb: (l) => `+${l * 4}% movement speed`,
      cost: (l) => 200 + l * 175,
      apply: (p, l) => { p.speed *= 1 + 0.04 * l; },
    },
    calibration: {
      name: 'Bolt Calibration', icon: '🔧', max: 8,
      blurb: (l) => `+${l * 5}% damage`,
      cost: (l) => 220 + l * 190,
      apply: (p, l) => { p.dmgMult *= 1 + 0.05 * l; },
    },
    magnet: {
      name: 'Ledger Magnet', icon: '🧲', max: 6,
      blurb: (l) => `+${l * 10}% pickup radius`,
      cost: (l) => 160 + l * 140,
      apply: (p, l) => { p.pickupRadius *= 1 + 0.10 * l; },
    },
    headstart: {
      name: 'Warm Start', icon: '⭐', max: 4,
      blurb: (l) => `Begin each run at level ${1 + l}`,
      cost: (l) => 400 + l * 500,
      apply: () => {},
    },
    interest: {
      name: 'Compounding Interest', icon: '💹', max: 5,
      blurb: (l) => `+${l * 8}% tokens banked per run`,
      cost: (l) => 300 + l * 320,
      apply: () => {},
    },
    study: {
      name: 'FinOps Certification', icon: '📚', max: 3,
      blurb: (l) => `Removes ${l} wrong answer${l > 1 ? 's' : ''} from every quiz`,
      cost: (l) => 500 + l * 600,
      apply: () => {},
    },
  };

  // ---------------------------------------------------------------------------
  // PICKUPS
  // ---------------------------------------------------------------------------
  const PICKUPS = {
    heal: { name: 'Rightsized Instance', icon: '🩹', chance: 0.040, heal: 32 },
    magnet: { name: 'CUR Refresh', icon: '🧲', chance: 0.020 },
    nuke: { name: 'Terminate All', icon: '💣', chance: 0.010, dmg: 400 },
  };

  // ---------------------------------------------------------------------------
  // ACHIEVEMENTS
  // ---------------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'First Termination', icon: '🎯', desc: 'Terminate your first idle resource.' },
    { id: 'savings_10k', name: 'Rounding Error', icon: '💵', desc: 'Save $10,000 in one run.' },
    { id: 'savings_100k', name: 'Line Item Hero', icon: '💰', desc: 'Save $100,000 in one run.' },
    { id: 'savings_1m', name: 'Seven Figures', icon: '🏦', desc: 'Save $1,000,000 in one run.' },
    { id: 'level_10', name: 'Senior FinOps Bot', icon: '📈', desc: 'Reach level 10 in one run.' },
    { id: 'clear_ec2-graveyard', name: 'Graveyard Shift', icon: '🪦', desc: 'Clear The EC2 Graveyard.' },
    { id: 'clear_storage-sprawl', name: 'Spring Cleaning', icon: '🧹', desc: 'Clear Storage Sprawl.' },
    { id: 'clear_the-ledger', name: 'Books Balanced', icon: '📕', desc: "Clear The Megabill's Ledger." },
    { id: 'anomaly_hunter', name: 'Anomaly Hunter', icon: '🕵️', desc: 'Catch 5 Anomalies in one run.' },
    { id: 'turtle', name: 'Turtle Mode', icon: '🐢', desc: 'Clear a stage with zero Auto-Scaling.' },
    { id: 'still_did_it', name: 'Still Did It', icon: '💪', desc: 'Clear a stage below 15% HP.' },
    { id: 'graviton_pilgrim', name: 'Graviton Pilgrim', icon: '⚡', desc: 'Max out the Graviton Beam.' },
    { id: 'zero_unattached', name: 'Zero Unattached', icon: '💾', desc: 'Destroy 50 Orphaned EBS in one run.' },
    { id: 'full_house', name: 'Full Toolchain', icon: '🧰', desc: 'Carry 6 weapons at once.' },
    { id: 'flawless_boss', name: 'Untouchable', icon: '✨', desc: 'Beat a boss without taking a hit.' },
    { id: 'bank_100k', name: 'Treasury', icon: '🏛️', desc: 'Earn 100,000 AI tokens lifetime.' },
    { id: 'banker', name: 'Patron', icon: '🏦',
      desc: 'Bank 10,000 tokens into CostBot\'s build fund.' },
    { id: 'quiz_5', name: 'Certified', icon: '📗', desc: 'Answer 5 quiz questions correctly in one run.' },
    { id: 'quiz_perfect', name: 'Well Read', icon: '🎓', desc: 'Clear a stage without missing a question.' },
    { id: 'quiz_25', name: 'Practitioner', icon: '🧠', desc: 'Answer 25 questions correctly, lifetime.' },
  ];

  // ---------------------------------------------------------------------------
  // TIPS shown on loading / stage intro
  // ---------------------------------------------------------------------------
  const TIPS = [
    'Every level-up asks an AWS savings question. You keep the upgrade either way — a right answer pays cash.',
    'Answer three quiz questions in a row correctly and the cash bonus triples.',
    'Anomalies flee. Cut them off — they are worth $6,000 each.',
    'Untagged Blobs split when destroyed. Bring area damage.',
    'Standing still is how bots die. Keep circling.',
    'Kill Idle knocks enemies back — use it to escape a pile-up.',
    'Spot Fleet drones sometimes get interrupted. That is the joke, and the trade-off.',
    'Tag Compliance widens your pickup radius. Dollars are XP.',
    'The boss arrives when the stage clock runs out. Be ready.',
    'Buy FinOps Certification in the Bot Bay to strike wrong answers off every quiz.',
  ];

  // ---------------------------------------------------------------------------
  // HOW TO PLAY
  //   Prose only. Every table on the briefing screen — the bestiary, the pickups,
  //   the numbers — is generated from the data above, so this can never end up
  //   describing a game we do not actually ship.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // END-SCREEN ART
  //
  // A results screen you see dozens of times wants more than one picture. Pools
  // by outcome, because a win must never show the battered bot and a loss must
  // never show a victory lap. `narrow` is the one deterministic case: surviving
  // on a sliver of HP has its own image and it should always be that image.
  // ---------------------------------------------------------------------------
  const END_ART = {
    win: ['done', 'savings_found', 'inspire', 'automation_wizard',
      'max_speed_clean', 'lightbulb_moment'],
    narrow: ['still_did_it'],
    loss: ['beat_up', 'alert_mode', 'turtle_version'],
  };

  const BRIEFING = {
    story: [
      'CostBot wants to build things for the company, and building costs AI tokens. ' +
      'The cloud bill is where it goes to find them.',
      'Everything chasing you on the floor is real waste — an instance nobody turned ' +
      'off, a volume whose instance died two years ago, a GPU node running at 3%. ' +
      'Terminate it and the money it was burning becomes your score.',
    ],
    loop: [
      { icon: '🎯', label: 'Survive the stage clock',
        note: 'Waste spawns faster the longer you last. Weapons fire on their own — you only position.' },
      { icon: '💵', label: 'Collect the green $ orbs',
        note: 'They are your score and your XP at the same time. Dollars saved is the number that ranks you.' },
      { icon: '⭐', label: 'Level up, pick 1 of 3',
        note: 'Every upgrade is a real FinOps lever — Graviton, Spot, Savings Plans, lifecycle rules.' },
      { icon: '🎓', label: 'Answer the quiz for a cash bonus',
        note: 'One question on the lever you just took. You keep the upgrade either way.' },
      { icon: '💀', label: 'Kill the boss',
        note: 'It arrives when the clock hits zero. Clearing the stage unlocks the next one and pays a token bonus.' },
      { icon: '🪙', label: 'Spend the tokens, or bank them',
        note: 'Dollars saved convert to AI tokens at the end of a run. In the Bot Bay they buy permanent '
          + 'upgrades — or you bank them into CostBot\'s build fund instead, where every 10,000 ships '
          + 'another product. A token can do one or the other, never both.' },
    ],
    // trait flags on an enemy -> how the bestiary should label them
    traits: {
      elite: 'Elite', flees: 'Runs away', ranged: 'Shoots back', splits: 'Splits on death',
    },
  };

  global.WH_CONTENT = {
    PLAYER, XP, CONTACT, VICTORY_LAP, TRIVIA_RULES, TRIVIA, ENEMIES, BOSSES, STAGES,
    WEAPONS, PASSIVES, META_UPGRADES, PICKUPS, ACHIEVEMENTS, TIPS, BRIEFING, END_ART,
  };
})(typeof window !== 'undefined' ? window : globalThis);
