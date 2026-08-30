/* ============================================================================
 * Holiday in Colombia — CONTENT / BALANCE / FISH
 * ----------------------------------------------------------------------------
 * Everything tunable lives in this file. The engine (hc-game.js) reads it and
 * never hardcodes balance. Edit numbers here to iterate on feel.
 *
 * The premise: CostBot is on holiday, but the fish have been mysteriously
 * eating all the AI tokens. Reel them out and reclaim the haul before the
 * holiday ends.
 *
 * THE FISH ARE THE MODELS. Every species is a real Anthropic model, and the
 * ladder runs oldest/smallest to newest/heaviest — a Claude Instant minnow up
 * to an Opus 5, with Fable 5 as the legendary catch.
 *
 * Each one carries two names. `name` is the fish — the pun you see on the line
 * and in the fishdex. `species` is the model it actually is, shown underneath,
 * because the joke only works if you can see what is being punned on. The
 * families were picked so the fish is real and the size is honest:
 *   Claude -> Cod        (Instacod, Unicod, Duocod)
 *   Haiku  -> Herring    small, silver, schooling, cheap
 *   Sonnet -> S-fish     Shad through Sailfish, ascending
 *   Opus   -> Opah       a genuinely enormous deep-water fish
 *   Fable  -> Sablefish  deep, rare, and the priciest thing on the menu
 *
 * A note on why the ladder is generation-ordered and not price-ordered: real
 * list prices do NOT increase monotonically. Claude 3 Opus and Opus 4.0 billed
 * ~$15/$75 per Mtok, while Opus 4.5 through 5 all list at $5/$25 — the tier got
 * cheaper as it got better. Ordering fish by price would put the oldest Opus at
 * the top of the food chain, which reads as a bug. So: weight and payout follow
 * the generation, and the real rate rides along in `rate` as flavour.
 * ==========================================================================*/
((global) => {
  'use strict';

  // ---------------------------------------------------------------------------
  // NO CLOCK
  //   There used to be a session timer — seven days, then a flat 180 seconds.
  //   Both did the same unhelpful thing: they rushed the one part of fishing
  //   that is supposed to be unhurried, and they punished you for spending
  //   thirty seconds on the Sablefish you had been hunting all session.
  //
  //   Bait is the limit now, and it is a better one. It is visible, it is
  //   spendable, you can always earn more, and running out is a consequence of
  //   your own misses rather than of a number ticking down in the corner.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // BAIT
  //   Bait is just bait. One kind, one purpose: it is a hard gate on casting, so
  //   a session can never put you in token debt, and that is the whole of it.
  //
  //   An earlier draft tiered bait by depth, which quietly meant "you cannot
  //   catch an Opus until you pay". That is a worse game — it puts the best
  //   moments behind a wallet instead of behind a skill. Depth is now purely a
  //   function of how well you cast.
  // ---------------------------------------------------------------------------
  const BAIT = { name: 'Bait', icon: '🪱' };

  // Priced against the new payouts: a bait costs about a third of an average
  // catch, so fishing is comfortably profitable but not free money.
  const BAIT_PACKS = [
    { n: 1, cost: 5 },
    { n: 5, cost: 21 },         // ~16% off
    { n: 25, cost: 90 },        // ~28% off
  ];

  // Top up TO this each day rather than adding it, so bait cannot be stockpiled
  // by not playing — every day starts the same way whether you fished yesterday
  // or not.
  const DAILY = {
    // >>> TEMPORARY DEBUG SETTINGS — revert to freeBait: 10, everyLoad: false <<<
    freeBait: 100,
    everyLoad: true,        // ignore the once-a-day rule so a reload always refills
    // <<< end temporary >>>
    mode: 'topUp',          // 'topUp' | 'grant'
  };

  // Trivia is the bottomless bait tap. Deliberately generous on a streak: the
  // point is to reward knowing the material, not to meter it.
  const TRIVIA_BAIT = {
    reward: 3,              // bait per correct answer
    streakStep: 1,          // each consecutive correct answer adds this much
    streakCap: 6,           // ...up to this many per answer
    wrongReward: 0,
    revealMs: 3200,
  };

  // ---------------------------------------------------------------------------
  // DEPTH BANDS
  //   Where the line lands, decided entirely by the cast. One lever, all skill.
  // ---------------------------------------------------------------------------
  const BANDS = [
    { id: 0, name: 'The Shallows', color: '#3fa8c4', from: 0.00, to: 0.28 },
    { id: 1, name: 'The Shelf', color: '#2f7f9e', from: 0.28, to: 0.52 },
    { id: 2, name: 'Deep Water', color: '#1d4f70', from: 0.52, to: 0.78 },
    { id: 3, name: 'The Abyss', color: '#122f4a', from: 0.78, to: 1.00 },
  ];

  // ---------------------------------------------------------------------------
  // CAST
  //   A power meter sweeping left to right; press to stop it. The zone you stop
  //   in picks the band. Overshooting is a real miss — the far edge is a snagged
  //   line, not a bonus, so mashing at full power is punished.
  // ---------------------------------------------------------------------------
  const CAST = {
    sweepSpeed: 0.52,       // full sweeps per second — a readable target, not a reflex test
    zones: [
      { to: 0.22, band: 0, label: 'Short' },
      { to: 0.46, band: 1, label: 'The Shelf' },
      { to: 0.72, band: 2, label: 'Deep' },
      { to: 0.94, band: 3, label: 'The Abyss' },
      { to: 1.00, band: -1, label: 'Snagged!' },   // overcooked it
    ],
    // A perfect cast is the MARK, not the neighbourhood. At 0.055 the window was
    // ±5.5% of the whole bar against zones only 22-26% wide — so nearly half of
    // every zone scored perfect and the bonus stopped meaning anything. This is
    // about a fifth of a zone: you have to actually hit the line.
    perfectPad: 0.025,      // within this of a zone's centre = a perfect cast
    perfectBoxBonus: 0.10,  // ...which widens the reel box by this fraction
    // Missing the mark is not a failed cast — it lands, it catches, it just
    // catches SMALLER. Accuracy runs 1 at the mark to 0 at the zone edge and
    // scales the fish, so every cast is graded rather than passed or failed.
    sizeAtMark: 1.22,       // weight multiplier for a dead-centre cast
    sizeAtEdge: 0.80,       // ...and for one that barely stayed in the zone
    sizeSpread: 0.14,       // natural variation on top, so no two are identical
  };

  // ---------------------------------------------------------------------------
  // THE DRAW
  //   Which fish is actually down there. A fish shallower than your cast is
  //   always plausible — minnows swim everywhere. A fish DEEPER than your cast
  //   is not impossible, just unlikely, which is what makes a freak Opus off a
  //   mediocre cast the best moment in the game. Nothing is ever locked out.
  // ---------------------------------------------------------------------------
  const DRAW = {
    shallowerFalloff: 0.70, // weight multiplier per band ABOVE the cast depth
    deeperFalloff: 0.17,    // ...and per band BELOW it — rare, never zero
    perfectCastBonus: 2.4,  // a perfect cast multiplies the deeper-than-cast odds
  };

  // ---------------------------------------------------------------------------
  // THE HOOK — a closing ring, not an invisible window
  //   The first version was a 0.9s reaction window: you were told to press, and
  //   whether you were "clean" depended on a number you could not see. This is
  //   the same skill made visible — a ring closes on a fixed target and you
  //   strike when they line up. Nail the centre and it is a clean hook.
  //
  //   `ring` runs from ringFrom down to 0. The target sits at 1.0, so the whole
  //   mechanic is |ring - 1|.
  // ---------------------------------------------------------------------------
  const BITE = {
    waitMin: 0.7,
    waitMax: 2.6,
    ringFrom: 3.0,          // starting radius, as a multiple of the target ring
    shrinkTime: 1.45,       // seconds for the ring to close all the way to nothing
    hitBand: 0.40,          // |ring-1| within this hooks the fish
    perfectBand: 0.15,      // ...and within this it is a clean hook
    cleanHookProgress: 0.18, // head start on the fight
    cleanHookBox: 0.10,
    spookPenalty: 0.55,     // seconds added to the wait after striking too early
    maxSpooks: 3,           // a fourth early strike and the fish is gone
  };

  // ---------------------------------------------------------------------------
  // THE FIGHT — line tension, not a containment bar
  //   The first version was Stardew's box-chases-fish. It reads well on paper
  //   and feels like operating a lift: you fight the physics toy, not the fish,
  //   and the catch bar slides backwards for reasons you cannot see.
  //
  //   This is the Sega Bass / Dave the Diver model instead. Hold to reel and the
  //   fish comes in, but the line tightens. Let go and the tension bleeds off
  //   while the fish takes a little line back. Every so often it RUNS — then
  //   holding costs triple the tension and gains almost nothing, so you ease
  //   off and wait it out.
  //
  //   Why it feels smoother: one continuous value under one button, progress
  //   that only moves the way you pushed it, and a give-and-take rhythm instead
  //   of a chase. Snap the line and it is your fault, and you know why.
  // ---------------------------------------------------------------------------
  const REEL = {
    reelRate: 0.42,         // distance closed per second while holding
    slipRate: 0.055,        // distance the fish takes back while you rest
    tensionUp: 0.60,        // tension gained per second while holding
    tensionDown: 1.08,      // tension shed per second while resting
    runTensionMult: 2.5,    // holding through a run is what snaps the line
    runReelMult: 0.22,      // ...and it barely gains you anything
    runMin: 0.5, runMax: 1.1,      // how long a run lasts, by fight profile
    restMin: 0.9, restMax: 2.3,    // ...and the gap between them
    firstRunDelay: 0.9,     // a beat of easy reeling before the first run
    startDist: 1,
    snapAt: 1,
    lostDist: 1.18,         // let it run this far and the spool is empty
    safeTo: 0.70,           // the gauge goes amber above this
    dangerFrom: 0.88,       // ...and red here
  };

  // ---------------------------------------------------------------------------
  // FISH
  //   tier    — drives the fight profile (haiku darts, opus hauls)
  //   band    — how deep it lives; the draw only offers fish at your depth
  //   kg      — display weight
  //   tokens  — payout, before the streak multiplier
  //   rarity  — relative draw weight inside its band
  //   rate    — real list price $/Mtok in/out, for the fishdex blurb
  //   tips    — real FinOps facts about that model or that piece of waste, shown
  //             one at a time on the catch card. This is the point of the arcade:
  //             every catch should teach something true. Keep them accurate.
  //   art     — which silhouette the engine draws for the catch card. Real
  //             species, picked so the four are unmistakable at a glance: a
  //             slim herring, a sailfish with its sail up, the opah's dinner
  //             plate of a body, and a long deep-water sablefish.
  //   fight   — { speed, erratic, dive } motion profile for the reel bar
  // ---------------------------------------------------------------------------
  // Measured over 400 trials each, not guessed: with correct technique these
  // land in about 3s / 5s / 7s / 10.5s, and holding the button down snaps the
  // line 100% of the time on all four.
  //
  // The escalation is deliberately in PRESSURE, not duration. An earlier pass
  // made a Fable slow (speed 0.52) and it took 28 seconds — a sixth of the
  // holiday spent watching a bar, which is tedium wearing difficulty's coat. A
  // big fish now comes in at nearly the same rate; what makes it hard is that
  // it loads the line three times faster and bolts twice as often, so the
  // windows you get are short and frequent. Tense, not long.
  const TIER_FIGHT = {
    haiku: { speed: 1.15, runs: 0.30, pull: 0.60 },   // in the boat before you worry
    sonnet: { speed: 0.90, runs: 0.44, pull: 1.05 },  // steady and strong
    opus: { speed: 0.80, runs: 0.58, pull: 1.52 },    // heavy, and hard on the line
    fable: { speed: 0.74, runs: 0.70, pull: 1.85 },   // runs constantly; tiny windows
  };

  const FISH = [
    // One model per depth band. Cast shallow and you get Haiku; the Abyss is
    // where the Fable lives. Four fish, four bands, and the ladder is the whole
    // tutorial — you never have to be told that deeper is better.
    { id: 'haiku45', name: 'Haikuda', species: 'Haiku 4.5', tier: 'haiku', band: 0, art: 'herring',
      kg: 1.4, tokens: 2, rarity: 24, rate: [1, 5],
      tips: [
        'Haiku 4.5 lists at $1/$5 per million tokens — a fifth of Sonnet on input '
          + 'and a fifth on output. Most classification, extraction and routing work '
          + 'does not need a bigger model.',
        'Prompt caching bills cache READS at about a tenth of the input rate. If you '
          + 'send the same long system prompt every call, caching it is usually the '
          + 'single biggest saving available.',
        'The Batch API runs non-urgent work at roughly half price. Anything that does '
          + 'not need an answer in the next few seconds is a candidate.',
      ],
      note: 'Small, fast and everywhere. Darts the moment you look at it. $1/$5 per Mtok.' },
    { id: 'sonnet5', name: 'Sonnet Sailfish', species: 'Sonnet 5', tier: 'sonnet', band: 1, art: 'sailfish',
      kg: 6.5, tokens: 6, rarity: 18, rate: [3, 15],
      tips: [
        'Sonnet has held the same $3/$15 per million tokens across generations — the '
          + 'model got better, the price did not move.',
        'Bedrock is partner-priced, so first-party promotional rates do not apply '
          + 'there. Two teams on "the same model" can genuinely have different unit '
          + 'costs depending on the route.',
        'Output tokens cost five times input on this tier. Asking for a shorter answer '
          + 'is a real cost lever, not a rounding error.',
      ],
      note: 'The workhorse. Fights in a straight line and rarely lets go. $3/$15 per Mtok.' },
    { id: 'opus5', name: 'King Opah', species: 'Opus 5', tier: 'opus', band: 2, art: 'opah',
      kg: 21, tokens: 14, rarity: 11, rate: [5, 25],
      tips: [
        'Opus lists at $5/$25 per million tokens today. Claude 3 Opus and Opus 4.0 '
          + 'billed around $15/$75 — the tier got roughly three times cheaper as it '
          + 'got better.',
        'Because prices fall, a cost model with hardcoded per-version rates silently '
          + 'over-bills. A new model that matches no branch is the most common cause '
          + 'of a surprise line item.',
        'Cache writes cost about 1.25x the input rate and reads about 0.1x. Caching '
          + 'pays for itself after roughly two reads of the same prefix.',
      ],
      note: 'Deep water. Slow, enormous, and it sounds the moment it feels the hook. $5/$25 per Mtok.' },
    { id: 'fable5', name: 'The Fabled Sablefish', species: 'Fable 5', tier: 'fable', band: 3, art: 'sablefish',
      kg: 44, tokens: 46, rarity: 4, legendary: true, rate: [10, 50],
      tips: [
        'Fable 5 lists at $10/$50 per million tokens — twice Opus, and ten times '
          + 'Haiku. Reserve it for the work that genuinely needs it.',
        'A new model GENERATION is the dangerous one for cost tracking: it matches no '
          + 'existing rate rule, so it quietly falls through to whatever the default '
          + 'is and bills wrong in whichever direction that default sits.',
        'Model choice is the largest single lever in an AI bill. Routing the easy 80% '
          + 'of calls down a tier usually beats any amount of prompt tuning.',
      ],
      note: 'The one they talk about at the dock. $10/$50 per Mtok — twice an Opus, '
        + 'and it fights like it knows.' },
  ];

  // Not everything on the hook is a fish. Junk pays a little rather than
  // nothing: you did technically remove waste from the environment, and a dead
  // cast is a miserable way to spend your last bait.
  const JUNK = [
    { id: 'ebs', name: 'Unattached EBS Volume', icon: '🥾', band: 0, kg: 2.0,
      tokens: 1, rarity: 10, junk: true,
      tips: [
        'A gp3 volume bills at about $0.08 per GB-month whether or not anything is '
          + 'attached to it. A 500 GB orphan is roughly $40 every month, forever.',
        'Unattached volumes are the classic cleanup win: nothing depends on them, so '
          + 'deleting them carries almost no risk once you have a snapshot.',
      ],
      note: 'Its instance died two years ago. Still billing.' },
    { id: 'tire', name: 'Idle Instance', icon: '🛞', band: 0, kg: 3.5,
      tokens: 1, rarity: 8, junk: true,
      tips: [
        'An instance at 1% CPU costs exactly the same as one at 90%. Utilization is '
          + 'not billed — provisioned capacity is.',
        'Rightsizing before committing matters: a Savings Plan on an oversized fleet '
          + 'just locks in the waste for one to three years.',
      ],
      note: 'Running at 0.4% CPU since the last reorg.' },
    { id: 'natgw', name: 'Zombie NAT Gateway', icon: '🧟', band: 1, kg: 4.0,
      tokens: 2, rarity: 7, junk: true,
      tips: [
        'A NAT Gateway costs roughly $0.045 an hour — about $32 a month — before a '
          + 'single byte passes through it, plus a per-GB data processing charge on '
          + 'top.',
        'One NAT Gateway per availability zone multiplies fast. Gateway VPC endpoints '
          + 'for S3 and DynamoDB carry no hourly charge and take that traffic off the '
          + 'NAT entirely.',
      ],
      note: 'Nothing routes through it. It charges by the hour anyway.' },
    { id: 'untagged', name: 'Untagged Resource', icon: '📦', band: 2, kg: 1.0,
      tokens: 3, rarity: 5, junk: true,
      tips: [
        'Untagged resources do not stop costing money, they just stop being anyone\'s '
          + 'problem. Unallocated spend is the hardest kind to reduce because nobody '
          + 'gets the bill.',
        'Tag at creation, in the IaC template. Retrospective tagging campaigns almost '
          + 'never finish, because the person who created the resource has usually '
          + 'moved teams.',
      ],
      note: 'No owner, no team, no cost centre. Somebody is paying for it.' },
  ];

  // Junk is easy to land — it does not fight, it just sits there being expensive.
  const JUNK_FIGHT = { speed: 0.30, runs: 0.05, pull: 0.35 };

  // ---------------------------------------------------------------------------
  // SCORING
  // ---------------------------------------------------------------------------
  const SCORING = {
    // Balanced by MEASURED tokens-per-minute, not by vibes. That earlier pass
    // (Waste Hunter's conversion doubled, these fish/junk `tokens` cut about a
    // third) landed fishing near 230/min for a competent Abyss/Deep-Water
    // angler — a rarity-weighted average catch of ~20 tokens every ~10s cycle
    // (cast + bite + hook + fight, per the TIER_FIGHT timings above), lifted by
    // streak/clean-hook/perfect-cast mult. That is still ~2.3x the ~100/min
    // every other cabinet now targets, alongside CostBot Hero, CostBotLand and
    // the Quiz Show. Every FISH/JUNK `tokens` value (and firstCatchBonus) is
    // divided by ~2.3 again here, landing the same angler near 100/min.
    streakStep: 0.15,
    streakCap: 2.5,
    cleanHookBonus: 0.10,   // extra multiplier for a clean hook
    perfectCastBonus: 0.10,
    firstCatchBonus: 11,    // one-off, the first time you land a new species
    historyKept: 50,
  };

  // ---------------------------------------------------------------------------
  // ACHIEVEMENTS
  // ---------------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { id: 'hc_first', name: 'First Cast', icon: '🎣', desc: 'Land your first fish.' },
    { id: 'hc_haiku', name: 'Small Fry', icon: '🐟', desc: 'Land a Haikuda.' },
    { id: 'hc_sonnet', name: 'Workhorse', icon: '🐠', desc: 'Land a Sonnet Sailfish.' },
    { id: 'hc_opus', name: 'Deep Water', icon: '🐡', desc: 'Land a King Opah.' },
    { id: 'hc_fable', name: 'The One They Talk About', icon: '🦈', desc: 'Land the Fabled Sablefish.' },
    { id: 'hc_dex', name: 'Completionist', icon: '📖', desc: 'Log every species in the fishdex.' },
    { id: 'hc_streak5', name: 'In The Zone', icon: '🔥', desc: 'Land 5 fish in a row.' },
    { id: 'hc_clean', name: 'Clean Hook', icon: '🎯', desc: 'Land 3 fish on clean hooks in one holiday.' },
    { id: 'hc_nosnap', name: 'Soft Hands', icon: '🧵', desc: 'Land 5 fish without snapping a line.' },
    { id: 'hc_scholar', name: 'Scholar', icon: '🎓', desc: 'Earn 25 bait from trivia.' },
    { id: 'hc_haul', name: 'Big Haul', icon: '🪣', desc: 'Take 250 tokens in one trip.' },
    { id: 'hc_junk', name: 'Lake Cleanup', icon: '♻️', desc: 'Fish out all four pieces of junk.' },
  ];

  const TIPS = [
    'The cast is everything. Depth decides which model is down there, and only your cast sets the depth.',
    'Hook in the first third of the bite window for a clean hook — it starts the fish closer in.',
    'When it runs, let go. Holding through a run is what snaps the line.',
    'Tension bleeds off fast when you rest. Short pulls beat one long one.',
    'A streak multiplies everything. Five small fish in a row beats one lucky big one.',
    'Out of bait? Answer trivia. It never runs out and it never costs a token.',
    'Junk does not fight. If the line stays slack, it is a boot.',
    'A Fabled Sablefish can turn up on any cast. It is just far likelier off a perfect one into the Abyss.',
    'There is no clock. You fish until the bait runs out — or until you pack up.',
  ];

  const BRIEFING = {
    story: [
      'CostBot is on Holiday in Colombia. One boat, no laptop, nowhere to be.',
      'The trouble is the fish. Every one of them has been eating AI tokens — the '
        + 'same tokens the arcade needs to ship anything — and they are not giving '
        + 'them back voluntarily.',
      'Every fish in this lake is a model, and the bigger the model, the more it '
        + 'has eaten. Reel them out, take the tokens back, and be done before the '
        + 'holiday is.',
    ],
    loop: [
      { icon: '🪱', label: 'Get bait before you can fish',
        note: 'Ten free every day. Buy more with tokens, or answer a FinOps question '
          + 'for it — trivia never runs out, so you can always fish for free.' },
      { icon: '💪', label: 'Cast — stop the power meter on the mark',
        note: 'Which zone you stop in sets the depth, and depth is the only thing that makes '
          + 'an Opah likely. How close you get to the white line sets the SIZE: on the mark '
          + 'lands a big one, loose still catches but it will be small. Overcook it and you '
          + 'snag the line.' },
      { icon: '❗', label: 'Hook — wait for the bobber to go under',
        note: 'Hit it in the first third of the window for a clean hook. Yank early and '
          + 'you spook it; too late and it takes your bait.' },
      { icon: '🎣', label: 'Fight it — hold ↓ to reel, ease off when it runs',
        note: 'Reeling brings it in but tightens the line. Let go and the tension bleeds '
          + 'off while it takes a little back. Hold through a run and you snap it.' },
      { icon: '🪙', label: 'Keep the haul, or bank it',
        note: 'Every fish coughs up the tokens it ate, into your arcade purse. Spend them '
          + 'on bait here or upgrades anywhere — or bank them from the arcade page into '
          + 'CostBot\'s build fund, where every 10,000 ships another product.' },
    ],
  };

  global.HC_CONTENT = {
    BAIT, BAIT_PACKS, DAILY, TRIVIA_BAIT, BANDS, CAST, DRAW, BITE, REEL,
    TIER_FIGHT, FISH, JUNK, JUNK_FIGHT, SCORING, ACHIEVEMENTS, TIPS, BRIEFING,
  };
})(typeof window !== 'undefined' ? window : globalThis);
