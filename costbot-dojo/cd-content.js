/* ============================================================================
 * CostBot: Dojo — CONTENT / BALANCE / TRIVIA
 * ----------------------------------------------------------------------------
 * Everything tunable lives in this file. The engine (cd-game.js) reads it and
 * never hardcodes balance. Edit numbers here to iterate on feel.
 *
 * Two things are load-bearing and worth stating outright.
 *
 * FIRST: every board face is a real waste term. The mat is a vocabulary drill
 * disguised as a reflex game, so a term nobody can source does not belong on
 * it. Each tier below carries the file its vocabulary came from, and the terms
 * that already exist as Waste Hunter enemies (Untagged Blob, Orphaned EBS,
 * Zombie EIP, Idle EC2, The Anomaly, Idle Sprawl Prime) are deliberately the
 * same words in both cabinets — a player should not have to learn the arcade's
 * waste twice.
 *
 * SECOND: difficulty is not a property of a question. The prototype laddered
 * its questions into four tiers and dealt one tier per Savings Check, which
 * meant a question was "hard" forever. Here the bank is flat, exactly like
 * shared/arcade-trivia.js, and the escalation lives in TRIVIA_RULES as a
 * streak multiplier — the same knob every other cabinet turns.
 *
 *   CD_CONTENT.ROUND.baseTtlMs        // how long a board holds its slot
 *   CD_CONTENT.BOARDS                 // the waste vocabulary, by tier
 *   CD_CONTENT.BELTS                  // savings -> rank at the bell
 *   CD_CONTENT.TRIVIA_RULES.mode      // 'bonus' | 'gate'
 *   CD_CONTENT.TRIVIA                 // shared bank + the dojo's KB questions
 * ==========================================================================*/
((global) => {
  'use strict';

  // ---------------------------------------------------------------------------
  // ROUND
  // A round is short on purpose: this started life as a booth cabinet, where
  // the queue behind you is part of the design. Thirty seconds is long enough
  // to build a streak and short enough that losing one does not sting.
  // ---------------------------------------------------------------------------
  const ROUND = {
    seconds: 30,          // 15..60, set in Dojo Setup
    lanes: 3,
    maxLive: 7,           // boards on the mat at once

    // Pacing. The original booth game spawned every 625ms with the top tier
    // living ~1100ms, which read as noise: boards appeared and vanished before
    // the word on them could be read, so the vocabulary — the entire point —
    // never landed. Both numbers are now materially slower, and no board lives
    // less than 0.8x the base dwell.
    spawnMs: (speed) => Math.max(320, 1500 - speed * 105),   // 975ms at speed 5
    baseTtlMs: 4200,      // dwell at speedFactor 1, scaled per board by `ttl`
    speedFactor: (speed) => 0.55 + speed * 0.09,             // 1.0 at speed 5

    // Boards land on rows so two words can never overlap and become unreadable.
    // Four bands over a 648px-tall viewport, kept clear of the HUD strip at the
    // top and the sensei standing bottom-left.
    bands: [0.24, 0.42, 0.60, 0.78],

    graceMs: 420,         // deaf period after any overlay closes
    camWaitMs: 3500,      // longest the countdown waits on a permission prompt
    laneCooldownMs: 150,  // floor on how fast one lane can be struck
  };

  // ---------------------------------------------------------------------------
  // SCORING
  // Savings are the score, exactly as in Waste Hunter — dollars of waste that
  // was genuinely reclaimed. Tokens are a by-product and go to the shared purse.
  // ---------------------------------------------------------------------------
  const SCORING = {
    reclaimToken: 1,      // tokens per board broken
    checkTokens: 5,       // tokens for passing a Savings Check
    boostSeconds: 5,      // Commitment Discount, earned only by answering right
    boostMultiplier: 2,
    streakStep: 8,        // boards per extra multiplier
    maxMultiplier: 5,
    certifyAt: 5,         // Savings Checks passed in one run to certify

    // Tokens, calibrated against Waste Hunter rather than invented. Waste
    // Hunter pays one token per $250 saved over a 180-second stage. The dojo
    // reaches a comparable dollar figure in 30 seconds, so paying at the same
    // rate would make it the fastest token farm in the arcade by a factor of
    // six. Tripling the divisor puts tokens-per-MINUTE in the same band as
    // Waste Hunter, which is the number that actually has to be fair — the
    // purse is shared, so a cabinet that overpays devalues every other one.
    dollarsPerToken: 750,
    cleanMatBonus: 1.5,   // nothing drifted away — mirrors WH's clearBonus
  };

  // ---------------------------------------------------------------------------
  // TIERS
  // The tier owns the colour, so the mat reads as a heat map: gold drift is
  // everywhere, slate is the thing you drop everything for. `ink` is the text
  // colour the word is drawn in — light plaques take dark type and dark plaques
  // take light type, so contrast never depends on which tier came up.
  // ---------------------------------------------------------------------------
  const TIERS = [
    { key: 'drift', label: 'Everyday drift', color: '#f0a52c', ink: '#241403' },
    { key: 'forgotten', label: 'Forgotten', color: '#4a72b8', ink: '#eaf1ff' },
    { key: 'practice', label: 'Bad practice', color: '#7fd6c4', ink: '#0b2b26' },
    { key: 'money', label: 'Real money', color: '#c23b3b', ink: '#ffe8e8' },
    { key: 'boss', label: 'Boss', color: '#5b6b8c', ink: '#eaf1ff' },
  ];

  // ---------------------------------------------------------------------------
  // BOARDS — the waste vocabulary
  //   savings = dollars reclaiming it is worth, before any multiplier
  //   weight  = relative spawn chance
  //   ttl     = dwell as a multiple of ROUND.baseTtlMs (never below 0.80)
  //
  // Sources, by tier:
  //   drift      shared/arcade-trivia.js (untagged spend, log retention,
  //              snapshots); skills/optional/monthly-aws/SKILL.md (UNMAPPED)
  //   forgotten  shared/arcade-trivia.js (orphaned EBS, unattached EIPs,
  //              gp2 -> gp3, NAT/EC2-Other);
  //              knowledge-base/slack/slack-archive-cost-optimization.md (Cross-AZ)
  //   practice   rules/conventions.md (never report unblended cost);
  //              knowledge-base/databricks-pipelines.md (Classic tables);
  //              knowledge-base/cost-management-support-digest-2026-08-03.md
  //              (Looker 90-day inactivity disables the seat);
  //              skills/aws-costs/SKILL.md (yp_service_id attribution)
  //   money      knowledge-base/census.md (Redis 6 extended support);
  //              knowledge-base/slack/slack-archive-sql-technical.md
  //              (Databricks interactive clusters, job_id IS NULL);
  //              skills/README.md (kinesis-ghost-consumers)
  //   boss       arcade/waste-hunter/wh-content.js (The Anomaly, Idle Sprawl Prime)
  // ---------------------------------------------------------------------------
  const BOARDS = [
    { key: 'untagged', tier: 'drift', label: 'Untagged Blob', savings: 600, weight: 14, ttl: 1.50 },
    { key: 'unmapped', tier: 'drift', label: 'UNMAPPED Spend', savings: 750, weight: 11, ttl: 1.45 },
    { key: 'retention', tier: 'drift', label: 'Never Expire', savings: 900, weight: 10, ttl: 1.45 },
    { key: 'snapshot', tier: 'drift', label: 'Snapshot Sprawl', savings: 1000, weight: 9, ttl: 1.40 },

    { key: 'ebs', tier: 'forgotten', label: 'Orphaned EBS', savings: 1700, weight: 9, ttl: 1.30 },
    { key: 'eip', tier: 'forgotten', label: 'Zombie EIP', savings: 1900, weight: 8, ttl: 1.28 },
    { key: 'gp2', tier: 'forgotten', label: 'gp2 Volume', savings: 2100, weight: 7, ttl: 1.25 },
    { key: 'crossaz', tier: 'forgotten', label: 'Cross-AZ Chatter', savings: 2300, weight: 6, ttl: 1.22 },
    { key: 'nat', tier: 'forgotten', label: 'NAT Bytes', savings: 2500, weight: 6, ttl: 1.20 },

    { key: 'unblended', tier: 'practice', label: 'Unblended Cost', savings: 3000, weight: 6, ttl: 1.15 },
    { key: 'classic', tier: 'practice', label: 'Classic Table', savings: 3250, weight: 5, ttl: 1.15 },
    { key: 'looker', tier: 'practice', label: 'Stale Looker Seat', savings: 3500, weight: 5, ttl: 1.12 },
    { key: 'sagemaker', tier: 'practice', label: 'Untagged SageMaker', savings: 3750, weight: 5, ttl: 1.10 },

    { key: 'ec2', tier: 'money', label: 'Idle EC2', savings: 4500, weight: 5, ttl: 1.05 },
    { key: 'interact', tier: 'money', label: 'Interactive Cluster', savings: 5000, weight: 4, ttl: 1.00 },
    { key: 'ghost', tier: 'money', label: 'Ghost Consumer', savings: 5750, weight: 4, ttl: 1.00 },
    { key: 'eks', tier: 'money', label: 'EKS Extended Support', savings: 6500, weight: 3, ttl: 0.95 },
    { key: 'rds', tier: 'money', label: 'RDS MySQL 5.7', savings: 7500, weight: 3, ttl: 0.92 },
    { key: 'redis', tier: 'money', label: 'Redis 6', savings: 9000, weight: 3, ttl: 0.90 },

    { key: 'anomaly', tier: 'boss', label: 'The Anomaly', savings: 13000, weight: 2, ttl: 0.85 },
    { key: 'prime', tier: 'boss', label: 'Idle Sprawl Prime', savings: 20000, weight: 1, ttl: 0.80, art: true },

    // Not waste — the gold board stops the clock and asks you something.
    { key: 'check', label: 'Savings Check', color: '#ffd76b', ink: '#241403', savings: 0, weight: 7, ttl: 1.35, check: true },
  ];

  // ---------------------------------------------------------------------------
  // BELTS — highest threshold met wins
  // Calibrated against a 30 second round at the default speed: boards arrive
  // about every 975ms, so roughly 30 reach the mat, and observed reflex-only
  // (zero-check) runs land in the ~$160K-$240K band. REFLEX sets the belt: that
  // band now spreads Yellow -> Blue, so a sloppy clean run and a great clean run
  // read differently. A correct Savings Check is a bonus worth about half a belt
  // (its knowledge bonus + a boost window + a little clock time), so it takes two
  // good checks to move a full belt — a single check nudges, it doesn't vault.
  // Red is a great reflex run plus a check or two; Black is near-perfect reflex
  // AND several checks. (Recalibrated from the check-dominated ladder: a clean
  // 30-board run used to cap at Yellow while one check jumped straight to Red.)
  // ---------------------------------------------------------------------------
  const BELTS = [
    { at: 0, name: 'White belt', title: 'Cost Aware', color: '#e8eef8' },
    { at: 110000, name: 'Yellow belt', title: 'Tag Disciple', color: '#f0a52c' },
    { at: 210000, name: 'Blue belt', title: 'Waste Hunter', color: '#4a72b8' },
    { at: 340000, name: 'Red belt', title: 'Commitment Strategist', color: '#c23b3b' },
    { at: 520000, name: 'Black belt', title: 'FinOps Sensei', color: '#1b2740' },
  ];

  // ---------------------------------------------------------------------------
  // TRIVIA RULES
  //   mode 'gate'  = a wrong answer costs you the Commitment Discount entirely
  //   mode 'bonus' = you always keep playing; a correct answer pays on top
  //
  // 'gate' here, unlike Waste Hunter's 'bonus', because the dojo has no upgrade
  // to withhold: the Savings Check IS the reward, so making it free would make
  // it decoration. Missing one also shortens every board's dwell, which is the
  // dojo's version of taking damage.
  // ---------------------------------------------------------------------------
  const TRIVIA_RULES = {
    mode: 'gate',
    timeLimit: 0,         // seconds; 0 = no timer, the clock is stopped anyway
    correctBonus: 5000,   // base dollars awarded for a correct answer

    // A Savings Check inside the first few seconds is a momentum tax: the run
    // has not built a streak worth protecting yet, and stopping the clock to
    // read a question before the player has found a rhythm just kills the
    // opening. So the gold board is held out of the spawn pool until the round
    // has been going long enough to be worth interrupting.
    earliestCheckMs: 12000,

    // A correct answer pays dollars and a boost window, and buys a little time
    // back on the round clock. Kept small on purpose: the extra seconds land at
    // end-game multipliers, so every second here is worth a lot — a check should
    // be worth about half a belt, not a two-belt jump on its own.
    correctBonusSeconds: 3,

    streakStep: 0.5,      // each consecutive correct answer adds this multiplier
    streakCap: 3,         // ...up to this cap (so 3rd+ in a row pays 3x)
    wrongConsolation: 0,
    revealMs: 2600,       // auto-advance after this long (on a correct answer)
    wrongExtraMs: 2000,   // ...plus this long when the answer was NOT correct, so
                          // there's extra time to read the right answer + why
    revealMinMs: 1500,    // ...but hold the feedback at least this long first — a
                          // stray key/punch right after answering can't skip it,
                          // so you always get a beat to read why before the count
    // Grace after a check appears before any answer registers. The player just
    // broke the gold board mid-swing on adrenaline; this lets them drop their
    // arms and read the question so a leftover motion can't punch a false answer.
    armMs: 1300,
    allowRepeats: false,
    ttlPenalty: 0.92,     // a miss multiplies every board's dwell by this...
    ttlPenaltyFloor: 0.7, // ...down to this floor
  };

  // ---------------------------------------------------------------------------
  // TRIVIA
  // The shared bank first — shared/arcade-trivia.js is where a question reaches
  // every cabinet, so anything portable belongs there and not here. What
  // follows is only what the shared bank cannot hold: facts that are true of
  // THIS organisation and are sourced from the CostBot knowledge base.
  //
  // Shape is his, plus one additive optional field:
  //   { topic, q, c: [choices], a: <index into c>, why, source }
  //
  // `source` cites the file the fact came from and renders as a badge after
  // answering — "CostBot KB" when it looks like a repo path, "AWS" otherwise.
  // Every path below is verified present on main; a fact we cannot source does
  // not ship, which is why two prototype questions were rewritten rather than
  // carried over (a tag-propagation lag and a Finout menu path, neither of
  // which survives a check against the knowledge base).
  //
  // Two topics are new. `unit_economics` and `ai_spend` have no home in his
  // taxonomy and are not going to grow one by force — everything else maps
  // onto an existing topic.
  // ---------------------------------------------------------------------------
  const DOJO_TRIVIA = [
    // --- idle ---------------------------------------------------------------
    {
      topic: 'idle',
      q: 'Which Elastic IP address actually costs you money?',
      c: ['One attached to a running instance', 'One attached to a stopped instance',
        'Elastic IPs are always free', 'Only IPv6 addresses are charged'],
      a: 1,
      why: 'AWS bills idle Elastic IPs by the hour. Attached to something running is the only free state.',
      source: 'AWS pricing fundamentals',
    },
    {
      topic: 'idle',
      q: 'A stopped EC2 instance still generates charges for which of these?',
      c: ['Instance hours', 'Data transfer out', 'Attached EBS volumes and Elastic IPs', 'Nothing at all'],
      a: 2,
      why: 'Stopping halts instance hours but never storage. Stopped-and-forgotten is a storage bill in disguise.',
      source: 'AWS pricing fundamentals',
    },

    // --- storage ------------------------------------------------------------
    {
      topic: 'storage',
      q: 'You terminate an EC2 instance with DeleteOnTermination set to false. What keeps billing?',
      c: ['Nothing — storage follows the instance', 'The attached EBS volume, at the full per-GB rate',
        'Only the snapshot', 'The security group'],
      a: 1,
      why: 'A detached EBS volume bills at the same per-GB rate forever. It is the quietest line item in the CUR.',
      source: 'AWS pricing fundamentals',
    },
    {
      topic: 'storage',
      q: 'What actually drives the cost of an incremental EBS snapshot chain?',
      c: ['The full volume size, on every snapshot', 'Only the changed blocks not already stored',
        'A flat fee per snapshot', 'The instance type it came from'],
      a: 1,
      why: 'Snapshots bill on unique changed blocks, so deleting the wrong one just re-parents data and frees very little.',
      source: 'AWS pricing fundamentals',
    },

    // --- automation ---------------------------------------------------------
    {
      topic: 'automation',
      q: 'A CloudWatch log group is set to Never Expire. What is the cost profile?',
      c: ['Ingestion only — storage is free', 'Ingestion once, then storage per GB every month forever',
        'A flat fee per log group', 'Storage is free below 100 GB'],
      a: 1,
      why: 'Ingestion is a one-time hit; retention is the annuity. Setting a retention policy is the cheapest win in the account.',
      source: 'AWS pricing fundamentals',
    },

    // --- tagging ------------------------------------------------------------
    {
      topic: 'tagging',
      q: 'Spend that matches no team, service or account rule lands where in the monthly AWS report?',
      c: ['It is dropped from the report entirely', 'In the UNMAPPED bucket',
        'It is billed to the payer account only', 'AWS auto-assigns the resource creator as owner'],
      a: 1,
      why: 'Everything that falls through the mapping rules ends up as UNMAPPED — spend that is everybody\u2019s and therefore nobody\u2019s.',
      source: 'skills/optional/monthly-aws/SKILL.md',
    },
    {
      topic: 'tagging',
      q: 'Which pair of tags carries YellowPages attribution in the CUR?',
      c: ['owner and environment', 'yp_team_id and yp_service_id', 'cost_center and project', 'Name and Application'],
      a: 1,
      why: 'yp_team_id and yp_service_id are the attribution keys. Without them the spend has no owner to show it to.',
      source: 'skills/aws-costs/SKILL.md',
    },
    {
      topic: 'tagging',
      q: 'A team sees a large Mariner line item they never provisioned. What is it?',
      c: ['A billing error to dispute', 'Their share of the shared EKS platform',
        'A Reserved Instance purchase', 'Inter-region data transfer'],
      a: 1,
      why: 'Mariner cost re-allocation splits shared EC2 cost across teams using Datadog pod-level CPU and memory — not a CUR tag.',
      source: 'skills/aws-costs/SKILL.md',
    },
    {
      topic: 'tagging',
      q: 'In cost attribution here, what does AFS stand for?',
      c: ['Account, Fleet, Service', 'Alliance, Fleet, Squad', 'Allocation, Forecast, Spend', 'Amortized Full Spend'],
      a: 1,
      why: 'Alliance is the top level, Fleet groups squads within it, and Squad is the individual team.',
      source: 'knowledge-base/afs.md',
    },

    // --- visibility ---------------------------------------------------------
    {
      topic: 'visibility',
      q: 'Which cost figure is the one engineering can actually control?',
      c: ['disney_invoice_cost', 'disney_engineering_cost', 'unblended_cost', 'blended_cost'],
      a: 1,
      why: 'Engineering cost is the controllable number; invoice cost is what Finance pays AWS, commitments and all. Show both by default.',
      source: 'rules/conventions.md',
    },
    {
      topic: 'visibility',
      q: 'Which column should never be used for cost reporting here?',
      c: ['disney_invoice_cost', 'disney_engineering_cost', 'unblended_cost', 'Both Disney cost columns together'],
      a: 2,
      why: 'Report disney_invoice_cost and disney_engineering_cost. Unblended ignores every Disney discount and flatters nobody.',
      source: 'rules/conventions.md',
    },
    {
      topic: 'visibility',
      q: 'You need daily granularity for a spike investigation. Which view?',
      c: ['aws_gold_monthly_vw', 'de_integrated_cur_vw', 'AWS Cost Explorer', 'Any table in the Classic workspace'],
      a: 1,
      why: 'Monthly aggregations belong in aws_gold_monthly_vw because it is far faster. The daily CUR is for daily questions.',
      source: 'rules/conventions.md',
    },
    {
      topic: 'visibility',
      q: 'When does the Classic Databricks platform retire?',
      c: ['It already has', 'August 31, 2026', 'December 31, 2026', 'There is no set date'],
      a: 1,
      why: 'Until then Classic tables still answer queries, which is exactly the trap. Unity is authoritative; Classic is merely available.',
      source: 'knowledge-base/databricks-pipelines.md',
    },
    {
      topic: 'visibility',
      q: 'Databricks, Looker and Finout disagree on a number. What is the most likely explanation?',
      c: ['They use different data sources', 'They are all sourced from the same CUR, so it is a filter or date-range difference',
        'Finout applies its own discounts', 'Looker rounds to the nearest thousand'],
      a: 1,
      why: 'All three read the same AWS CUR, so numbers should reconcile. A gap is a question about your filters, not about the tool.',
      source: 'knowledge-base/cost-visibility-tools.md',
    },
    {
      topic: 'visibility',
      q: 'Which cost visibility tool is aimed at senior leadership and leads on virtual tagging?',
      c: ['Databricks', 'Looker (DCyphr)', 'Finout', 'AWS Cost Explorer'],
      a: 2,
      why: 'Finout is the leadership-facing tool: MegaBill for multi-cloud, and instant virtual tagging that allocates spend with no code change.',
      source: 'knowledge-base/cost-visibility-tools.md',
    },

    // --- commitments --------------------------------------------------------
    {
      topic: 'commitments',
      q: 'Which commitment covers Lambda and Fargate in addition to EC2?',
      c: ['Standard Reserved Instances', 'Compute Savings Plans', 'EC2 Instance Savings Plans', 'Convertible Reserved Instances'],
      a: 1,
      why: 'Compute Savings Plans flex across EC2, Fargate and Lambda. EC2 Instance SPs discount deeper but lock the family and region.',
      source: 'AWS pricing fundamentals',
    },
    {
      topic: 'commitments',
      q: 'Savings Plan utilization is 100% but coverage is 40%. What does that mean?',
      c: ['You over-committed and are wasting the plan', 'Every committed dollar is used, but most eligible spend is still on demand',
        'The plan is misconfigured', 'Coverage and utilization always match'],
      a: 1,
      why: 'Full utilization with low coverage is the buy signal. You are leaving discount on the table, not wasting it.',
      source: 'AWS pricing fundamentals',
    },
    {
      topic: 'commitments',
      q: 'An All Upfront RI is purchased in January. Which view spreads that cost across the term?',
      c: ['Unblended cost', 'Amortized cost', 'Blended cost', 'Net unblended cost'],
      a: 1,
      why: 'Unblended shows the January spike. Amortized is the only honest view when charging teams back.',
      source: 'AWS pricing fundamentals',
    },

    // --- extended support ---------------------------------------------------
    {
      topic: 'extended_support',
      q: 'ElastiCache nodes left on Redis OSS v6 past end of standard support pay what surcharge?',
      c: ['A flat 10% for the life of the node', '+80% in years 1\u20132, then +160% in year 3',
        'Double the reserved rate', 'Nothing — support simply ends'],
      a: 1,
      why: 'Redis OSS v6 reaches end of standard support on 2027-01-31. From 2027-02-01 the surcharge applies per node-hour on top of node cost.',
      source: 'knowledge-base/census.md',
    },
    {
      topic: 'extended_support',
      q: 'Why can a commitment discount never rescue an extended support charge?',
      c: ['It applies only to storage', 'The surcharge is calculated on the on-demand rate regardless of RI or SP coverage',
        'It is billed by a third party', 'It is refunded automatically'],
      a: 1,
      why: 'AWS applies it to the on-demand rate whatever your coverage, so an RI-covered node hurts more. Upgrading off the version is free.',
      source: 'knowledge-base/census.md',
    },

    // --- spot ---------------------------------------------------------------
    {
      topic: 'spot',
      q: 'What is the correct workload profile for Spot capacity?',
      c: ['Stateful databases with strict SLAs', 'Interruption-tolerant batch and stateless workers',
        'Anything that must run exactly once', 'Licensed software billed per core'],
      a: 1,
      why: 'Spot trades up to 90% off for a two-minute eviction notice. Design for the eviction and the discount is free money.',
      source: 'AWS pricing fundamentals',
    },

    // --- unit economics -----------------------------------------------------
    {
      topic: 'unit_economics',
      q: 'How is the Streaming Cost Metric index value calculated?',
      c: ['Total AWS spend divided by headcount', 'AWS cost to serve divided by subscriber count',
        'Engineering cost divided by invoice cost', 'Monthly spend divided by streams delivered'],
      a: 1,
      why: 'SCM is cost per subscriber — measuring cost against the thing that actually drives it, across Disney+, Hulu and ESPN+.',
      source: 'knowledge-base/scm.md',
    },

    // --- AI spend -----------------------------------------------------------
    {
      topic: 'ai_spend',
      q: 'How is an AWS account whose name starts with bedrock- treated in AI cost reporting?',
      c: ['Excluded — it is infrastructure overhead', 'As 100% AI spend, whatever the product code',
        'Split evenly across all teams', 'Counted only if it is tagged'],
      a: 1,
      why: 'The bedrock-* accounts are pure AI, so the whole account counts. Dedup matters: AmazonBedrock usage inside one matches two rules at once.',
      source: 'knowledge-base/unified-ai-cost-view.md',
    },
    {
      topic: 'ai_spend',
      q: 'What is the Ham Sandwich dashboard good for?',
      c: ['The authoritative source for AI cost calculations', 'Validating AI cost figures, never calculating them',
        'Provisioning Bedrock capacity', 'Tracking EC2 rightsizing'],
      a: 1,
      why: 'It reads the Watcher Snowflake instance for Cursor, Claude, GitHub Copilot and Q Developer. Sanity-check with it; do not compute from it.',
      source: 'knowledge-base/glossary.md',
    },
  ];

  // The shared bank is the default pool and the dojo's KB questions extend it.
  // Empty if arcade-trivia.js did not load, which the engine tolerates: no bank
  // simply means the gold boards stop appearing.
  const SHARED = (global.ArcadeTrivia && global.ArcadeTrivia.BANK) || [];
  const TRIVIA = SHARED.concat(DOJO_TRIVIA);

  // ---------------------------------------------------------------------------
  // ACHIEVEMENTS
  // Separated from the bank the way wh-content.js separates them: a question is
  // content, an achievement is progression, and they change for different
  // reasons.
  // ---------------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { id: 'certified', name: 'Certified', icon: '📗', desc: 'Pass 5 Savings Checks in one run.' },
    { id: 'clean_mat', name: 'Clean Mat', icon: '✨', desc: 'Finish a round with nothing drifted away.' },
    { id: 'yellow_belt', name: 'Tag Disciple', icon: '🟡', desc: 'Reach Yellow belt.' },
    { id: 'blue_belt', name: 'Waste Hunter', icon: '🔵', desc: 'Reach Blue belt.' },
    { id: 'red_belt', name: 'Commitment Strategist', icon: '🔴', desc: 'Reach Red belt.' },
    { id: 'black_belt', name: 'FinOps Sensei', icon: '⬛', desc: 'Reach Black belt.' },
    { id: 'streak_40', name: 'Unbroken', icon: '🥋', desc: 'Break 40 boards without letting one drift.' },
    { id: 'boss_break', name: 'Prime Cut', icon: '💥', desc: 'Break Idle Sprawl Prime.' },
  ];

  // ---------------------------------------------------------------------------
  // CALLOUTS — CostBot's line after an event. He teaches by naming the thing,
  // so every line is the takeaway for the board that was just broken.
  // ---------------------------------------------------------------------------
  const CALLOUTS = {
    untagged: ['Untagged means unmapped.', 'Somebody else was paying for that.'],
    unmapped: ['UNMAPPED is where untagged spend lands.', 'No tag, no owner, no budget.'],
    retention: ['A log group with no retention keeps everything.', 'Set a retention. Forever is expensive.'],
    snapshot: ['Snapshots outlive the volume they came from.', 'Nobody prunes a snapshot chain.'],

    ebs: ['That volume outlived its instance.', 'Detached and still billing.'],
    eip: ['Idle addresses bill by the hour.', 'Attached and running is the only free state.'],
    gp2: ['gp3 does the same job for less per gig.', 'That volume never got migrated.'],
    crossaz: ['Cross-AZ traffic bills in both directions.', 'That hides inside EC2-Other.'],
    nat: ['NAT gateway charges per gig processed.', 'EC2-Other is where that one lives.'],

    unblended: ['Never report on unblended cost.', 'Invoice or engineering cost. Nothing else.'],
    classic: ['Classic serves stale data. Pivot to Unity.', 'That platform retires in August.'],
    looker: ['Ninety days idle and the seat disables itself.', 'Reclaim the seat before it reclaims you.'],
    sagemaker: ['Untagged notebooks land nowhere.', 'Tag it or nobody owns it.'],

    ec2: ['Nobody launched that this quarter.', 'Idle capacity is still capacity you bought.'],
    interact: ['An interactive cluster ran all day again.', 'Job ID is null. Nobody scheduled that.'],
    ghost: ['A registered consumer that never reads is pure waste.', 'Validate against Datadog, then deregister.'],
    eks: ['Extended support is a surcharge, not a service.', 'Upgrade the cluster and the fee disappears.'],
    rds: ['Old engine versions bill extended support.', 'Upgrade beats paying the surcharge.'],
    redis: ['Redis 6 carries an eighty percent surcharge.', 'End of standard support is January 2027. Move.'],

    anomaly: ['Anomaly caught before it compounded.', 'That is the one you want to find early.'],
    prime: ['Idle Sprawl Prime. Black belt board.', 'That is the biggest thing on the mat.'],

    check: ['Savings Check. Clock stops.'],
    miss: ['It drifted. Still billing.', 'That one got away.'],
    boost: ['Commitment discount. Go.'],
    certified: ['Certified. Five for five.'],
  };

  // ---------------------------------------------------------------------------
  // TIPS shown on the cabinet screen
  // ---------------------------------------------------------------------------
  const TIPS = [
    'Every board is a real waste pattern out of the bill. Breaking it is the drill.',
    'Streak steps up every eight boards to five times — and dies the moment one drifts away.',
    `The gold board freezes the clock for a Savings Check — answer right and win bonus time: ${SCORING.boostSeconds} seconds at ${SCORING.boostMultiplier}× savings and ${TRIVIA_RULES.correctBonusSeconds} seconds back on the clock.`,
    'Miss a Savings Check and every board drifts away faster for the rest of the round.',
    'No camera? The arrow keys run the same three lanes, and you can click a board directly.',
    'Finish with nothing drifted and your tokens double.',
  ];

  global.CD_CONTENT = {
    ROUND, SCORING, TIERS, BOARDS, BELTS, TRIVIA_RULES, TRIVIA, DOJO_TRIVIA,
    ACHIEVEMENTS, CALLOUTS, TIPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
