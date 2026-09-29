/* ============================================================================
 * CostBot: Dance Off! — CONTENT
 * ----------------------------------------------------------------------------
 * Everything a designer tunes without touching the engine: the five moves, the
 * playlist and who you face on each song, how a song is charted per difficulty,
 * the scoring and meter numbers, and what everybody says.
 *
 * A round is sixteen beats: the villain's eight-beat verse, then yours. Neither
 * half is a wait. On his verse you shadow him — hit his moves as he makes them —
 * and the squad takes a step toward the invoice under the noise of each one. On
 * yours you dance your own moves to keep him watching. The squad grabs the
 * invoice on the song's last beat, if they made it all the way.
 * ==========================================================================*/

// Each move is a little set of CostBot's dances (costbot-3d.js DANCES), cut to the beat.
// A note shorter than a beat and a half gets a snappy one; a long note gets a big one —
// backflips and spins need the room. The engine takes turns through each list.
// The Lifecycle Slide is a hold: press on the beat, keep it down for the tail.
export const MOVES = {
  L: { id: 'L', glyph: '←', name: 'The Rightsize', color: '#ff4fa3', dances: { short: ['twist', 'kick', 'hipthrust'], long: ['hipthrust', 'spin', 'twist'] } },
  R: { id: 'R', glyph: '→', name: 'Spot Instance', color: '#39d5ff', dances: { short: ['disco', 'kick', 'dab'], long: ['spin', 'disco', 'pirouette'] } },
  U: { id: 'U', glyph: '↑', name: 'Reserved Robot', color: '#ffc233', dances: { short: ['robot', 'hipthrust', 'kick'], long: ['backflip', 'jumpsplit', 'robot'] } },
  D: { id: 'D', glyph: '↓', name: 'Egress Chicken', color: '#8dff5a', dances: { short: ['chicken', 'hipthrust', 'kick'], long: ['jumpsplit', 'chicken', 'backflip'] } },
  S: { id: 'S', glyph: '␣', name: 'Lifecycle Slide', color: '#b77bff', dances: { short: ['moonwalk'], long: ['moonwalk', 'spin', 'moonwalk'] } },
};
export const MOVE_ORDER = ['L', 'R', 'U', 'D', 'S'];

// The keyboard: either hand — arrows or WASD — and Space for the slide.
export const KEYS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D', a: 'L', d: 'R', w: 'U', s: 'D', ' ': 'S' };
export const GROOVE_KEY = 'Enter';

export const ROUND_BEATS = 16;        // eight for his verse, eight for yours
export const HALF_BEATS = ROUND_BEATS / 2;

// Who you dance against: Max Tokens, CostBot's model in black chrome and red light (see
// makeVillain in do-stage.js), with a voice of his own.
export const VILLAIN = {
  id: 'max', name: 'Max Tokens', short: 'MAX', icon: '🤖',
  lines: {
    intro: ['I am Max Tokens. I have consumed every context window in this building.', 'Your budget is my training data, little bot.'],
    round: ['Predict THIS.', 'I generate ten thousand moves a second. You get eight.', 'Autocomplete: you, losing.',
      'Scaling up. Scaling up. Scaling UP.', 'I do not dance. I infer.', 'Temperature: maximum.'],
    glance: ['My sensors detect… movement.', 'Anomaly behind me. Investigating.', 'Who is spending tokens back there?'],
    suspicious: ['Why is my invoice… cheaper?', 'Recomputing. Something is missing.'],
    flawless: ['Unexpected output.', 'That was not in my training data.', 'Recalibrating…', 'Hallucination detected. Mine?'],
    busted: 'Busted! Your squad has been rate-limited.',
    songOver: 'Context window closed. The invoice stays in my weights.',
    loses: '…Error 404: invoice not found.',
  },
};

// The playlist: our own disco track first, then CostBot Hero's main roster (the
// same ArcadeMusic tracks Hero plays). Charts come from each song's own lead line,
// so the notes you dance are the tune. Past 150bpm a song is danced in half-time —
// one dance beat per two of the song's — so a 200bpm banger stays dance-able.
// art: the song's CostBot Hero artwork (in shared/assets/), hung faintly on the back wall.
export const SONGS = [
  { key: 'do_medley', name: '🎲 Awesome Medley', sub: 'five random songs, a new mix every dance', medley: true },
  { key: 'do_awesome', name: 'Awesome Mixup', sub: '70s disco-funk · the house track' },
  { key: 'do_footloose', name: 'Footloose', sub: 'from footloose.mid', art: 'footloose.jpg' },
  { key: 'ch_small', name: "It's a Small Cost", art: 'cb_smallworld.jpg' },
  { key: 'ch_xmen', name: 'X-pense Men', art: 'cb_logan.jpg' },
  { key: 'ch_howfarowe', name: "How Far I'll Owe", art: 'cb_moana.jpg' },
  { key: 'ch_frozen', name: 'For the First Dime in Forever', art: 'cb_frozen.jpg' },
  { key: 'ch_imperial', name: 'Imperial Markup', art: 'darth_cb.png' },
  { key: 'ch_bruno', name: 'We Don’t Talk About Budget', art: 'cb_bruno.jpg' },
  { key: 'ch_guest', name: 'Bill Our Guest', art: 'cb_be_our_guest.jpg' },
  { key: 'ch_avengers', name: 'The Savengers', art: 'cb_snapped.jpg' },
  { key: 'ch_blindhero', name: 'Blind Spend', art: 'cb_justice.jpg' },
  { key: 'ch_priceali', name: 'Price Ali', art: 'cb_aladdin.jpg' },
  { key: 'ch_underthegcp', name: 'Under the GCP', art: 'cb_ariel.jpg' },
  // CostBot Hero's experimental roster, behind the 🧪 checkbox on the title — same tracks,
  // same flag as Hero's own experimental toggle
  { key: 'ch_fairyfountain', name: 'Finance Fairy', art: 'cb_fairy_fountaing.jpg', experimental: true },
  { key: 'ch_goldsaucer', name: 'Gold Sauce', art: 'cb7.png', experimental: true },
  { key: 'ch_lostwoods', name: 'Cost Woods', art: 'cb_lost_woods.jpg', experimental: true },
  { key: 'ch_fightOn', name: 'Write-Off!', art: 'cb_buster.jpg', experimental: true },
  { key: 'ch_legendOfCostbot', name: 'Legend of CostBot', art: 'legend_of_costbot.jpg', experimental: true },
  { key: 'ch_kalm', name: 'Kalm Before the Bill', art: 'cb_meteor.jpg', experimental: true },
  { key: 'ch_fiscalicia', name: 'Fiscalicia', art: 'expense33.jpg', experimental: true },
  { key: 'ch_gameofloans', name: 'Game of Loans', art: 'game_of_loans.jpg', experimental: true },
  { key: 'ch_tariffa', name: 'Tariffa', art: 'tarrifa.png', experimental: true },
  { key: 'ch_aerithrock', name: 'Flower Gil', art: 'cb_aerith.jpg', experimental: true },
  { key: 'ch_vamo', name: 'Vamo Alla Financio', art: 'cb_chocobo.jpg', experimental: true },
  { key: 'ch_stolentokens', name: 'Materia Girl', art: 'cb_yuffie.jpg', experimental: true },
  { key: 'ch_financialfantasy7', name: 'Financial Fantasy 7', art: 'cb_ff7.jpg', experimental: true },
  { key: 'ch_letthebillingbegin', name: 'Let the Billing Begin', art: 'cb_cloud.jpg', experimental: true },
  { key: 'ch_bloodytiers', name: 'Bloody Tiers', art: 'cb_alucard.jpg', experimental: true },
  { key: 'ch_rasputin', name: 'Costputin', art: 'cb_rasputin.jpg', experimental: true },
  { key: 'ch_hungarian', name: 'Hungarian Expense No. 5', art: 'cb_hungarian.jpg', experimental: true },
  { key: 'ch_rickroll', name: 'Never Gonna Bill You Up', art: 'cb_rickroll.jpg', experimental: true },
  { key: 'ch_pirate', name: 'Ledger of the Caribbean', art: 'cb_pirate.jpg', experimental: true },
  { key: 'ch_guile2', name: 'Wall Street Fighter', art: 'cb_guile.jpg', experimental: true },
  { key: 'ch_gerudo2', name: 'Gerudough Valley', art: 'cb_gerudo.jpg', experimental: true },
];


// grid: the finest spacing a note can land on, in dance beats (0.5 = 8th notes).
// minGap thins dense runs; max/min cap a verse. moves: 3 = ← ↑ → only (4 adds ↓).
// missCost: suspicion a missed move adds (see BALANCE.suspicion). win: timing windows in seconds (perfect, great, good).
/* The Awesome Medley: five songs picked at random, the most tuneful eight bars of each
 * (the window with the most melody notes), stitched into one track at one tempo so the
 * beat clock never has to change mid-song. Each section keeps its own chords; a crash
 * marks every change. A three-bar lead-in of the disco groove, no tune, lines the song
 * changes up with the rounds (the chart's intro is twelve beats, a round sixteen).
 *   const { track, segs } = buildMedley(ArcadeMusic.TRACKS, keys);   // segs: [{ key, bar }]
 */
export const MEDLEY = { key: 'do_medley', bpm: 128, songs: 5, bars: 8, introBars: 3 };
export function buildMedley(TRACKS, keys, rnd = Math.random) {
  const pool = keys.filter((k) => TRACKS[k] && TRACKS[k].lead && TRACKS[k].lead.length >= 16 && TRACKS[k].prog);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const lead = [], prog = [], crashBars = [], segs = [];
  const groove = (TRACKS.do_lobby || TRACKS.do_awesome).prog;
  for (let b = 0; b < MEDLEY.introBars; b++) { prog.push(groove[b % groove.length]); for (let st = 0; st < 16; st++) lead.push(null); }
  for (const key of pool.slice(0, MEDLEY.songs)) {
    const T = TRACKS[key], bars = Math.floor(T.lead.length / 16);
    const count = (bar) => T.lead.slice((bar % bars) * 16, (bar % bars) * 16 + 16).filter((n) => n != null).length;
    let best = 0, bestN = -1;
    for (let w = 0; w < bars; w++) {
      let n = 0;
      for (let i = 0; i < MEDLEY.bars; i++) n += count(w + i);
      if (n > bestN) { bestN = n; best = w; }
    }
    segs.push({ key, bar: prog.length });
    crashBars.push(prog.length);
    for (let i = 0; i < MEDLEY.bars; i++) {
      const bar = (best + i) % bars;
      for (let st = 0; st < 16; st++) lead.push(T.lead[bar * 16 + st]);
      prog.push(T.prog[bar % T.prog.length]);
    }
  }
  return {
    segs,
    track: {
      title: 'Awesome Medley', influence: 'a random mixtape', bpm: MEDLEY.bpm, key: 'all of them',
      desc: 'Dance Off! medley: five songs, eight bars each, re-rolled every dance.',
      prog, lead, drums: 'disco', pad: 'strings', bars: prog.length, crashBars,
      arpEvery: 0, bassEvery: 2, gain: 0.8, voices: { lead: 'brass' },
    },
  };
}

export const DIFFS = {
  normal: { label: 'Normal', color: '#f5c451', grid: 1, minGap: 1, max: 8, min: 6, moves: 4, slides: true, missCost: 6, win: [0.075, 0.135, 0.2] },
  hard: { label: 'Hard', color: '#ff5d6c', grid: 0.5, minGap: 0.5, max: 12, min: 8, moves: 4, slides: true, missCost: 8, win: [0.06, 0.115, 0.17] },
  expert: { label: 'Expert', color: '#c04dff', grid: 0.5, minGap: 0.5, max: 16, min: 13, moves: 4, slides: true, missCost: 10, win: [0.05, 0.095, 0.14] },
};
export const DIFF_ORDER = ['normal', 'hard', 'expert'];

/* Chart a song for a difficulty. Returns everything the engine needs, in dance beats:
 *   { unit, beatSec, intro, rounds: [{ call: [{at,len,move,hold?}], resp: [...] }] }
 * A verse is the melody's onsets inside its eight beats, snapped to the grid and
 * thinned; each note's move follows the tune's contour (low notes duck, high notes
 * reach up), and the longest note of a verse becomes a held Lifecycle Slide. */
export function buildChart(track, diffId) {
  const D = DIFFS[diffId] || DIFFS.normal;
  const unit = track.bpm > 150 ? 2 : 1;
  const beatSec = (60 / track.bpm) * unit;
  const stepsPerBeat = 4 * unit;                    // the lead line is written in 16ths
  const lead = track.lead || [];
  const intro = unit === 2 ? 8 : 12;
  const songSec = (track.bars || 4) * 16 * (60 / track.bpm / 4);
  const target = Math.min(90, Math.max(60, songSec));
  const nRounds = Math.min(10, Math.max(4, Math.floor((target - intro * beatSec) / (ROUND_BEATS * beatSec))));
  const set = D.moves === 3 ? ['L', 'R', 'U'] : ['D', 'L', 'R', 'U'];
  const noteAt = (st) => (lead.length ? lead[((st % lead.length) + lead.length) % lead.length] : null);

  function verse(b0) {
    const cand = [];
    for (let at = 0; at < HALF_BEATS - 1e-9; at += D.grid) {
      const s0 = Math.round((b0 + at) * stepsPerBeat), s1 = Math.round((b0 + at + D.grid) * stepsPerBeat);
      for (let st = s0; st < s1; st++) {
        const n = noteAt(st);
        if (n != null) { cand.push({ at, pitch: n, strong: at % 2 === 0 ? 2 : at % 1 === 0 ? 1 : 0 }); break; }
      }
    }
    let kept = [];
    for (const c of cand) if (!kept.length || c.at - kept[kept.length - 1].at >= D.minGap - 1e-9) kept.push(c);
    if (kept.length > D.max) kept = [...kept].sort((a, b) => b.strong - a.strong || a.at - b.at).slice(0, D.max).sort((a, b) => a.at - b.at);
    // a quiet stretch of the tune still gets danced: fill up to the difficulty's minimum,
    // strongest spots first — the downbeats, then the other beats, then the 8ths between
    const FILL = [0, 4, 2, 6, 1, 3, 5, 7, 0.5, 4.5, 2.5, 6.5, 1.5, 3.5, 5.5, 7.5];
    for (const at of FILL) {
      if (kept.length >= D.min) break;
      if (at % D.grid !== 0) continue;
      if (!kept.some((k) => Math.abs(k.at - at) < D.minGap - 1e-9)) kept.push({ at, pitch: null, strong: at % 2 === 0 ? 2 : at % 1 === 0 ? 1 : 0 });
    }
    kept.sort((a, b) => a.at - b.at);
    const pitches = [...new Set(kept.map((k) => k.pitch).filter((p) => p != null))].sort((a, b) => a - b);
    let longest = -1, longLen = 0;
    const notes = kept.map((k, i) => {
      const len = Math.min(2, (i + 1 < kept.length ? kept[i + 1].at : HALF_BEATS) - k.at);
      // a filled-in note has no pitch to follow: pick its move by where it sits, so the set still varies
      const q = k.pitch == null || pitches.length < 2 ? ((b0 * 7 + k.at * 10 + i * 3) % 11) / 11 : pitches.indexOf(k.pitch) / (pitches.length - 1);
      if (len > longLen) { longLen = len; longest = i; }
      return { at: k.at, len, move: set[Math.min(set.length - 1, Math.floor(q * set.length))] };
    });
    if (D.slides && longLen >= 2 && notes.length > 2) { notes[longest].move = 'S'; notes[longest].hold = true; }
    return notes;
  }

  const rounds = [];
  for (let r = 0; r < nRounds; r++) {
    const r0 = intro + r * ROUND_BEATS;
    rounds.push({ call: verse(r0), resp: verse(r0 + HALF_BEATS) });
  }
  return { unit, beatSec, intro, rounds };
}

export const BALANCE = {
  // timing windows live on each difficulty (DIFFS.win)
  points: { perfect: 300, great: 200, good: 100 },
  comboCap: 24,                    // the multiplier tops out at x2 here
  // Suspicion, 0-100 — CostBot Hero's bill meter, as the villain's hunch that something is up.
  // A miss adds the difficulty's missCost; a clank (wrong arrow on his verse) most of that;
  // a shadow step skipped half (the squad stumbles with no noise to cover it); a step while
  // he is looking straight at the squad a lot. Hits drain it. At 100 he has
  // them: busted. It always drains back down, so one bad stretch is never the end.
  suspicion: { clank: 0.6, skip: 0.5, moved: 15, offbeat: 2, drain: { perfect: 2, great: 1, good: 0 }, flawless: 10, max: 100 },
  lookAbove: 60,                   // this suspicious, he checks behind him on his own, once a verse
  clankLookAbove: 40,              // a clank this suspicious makes him turn round to see what it was
  // heist progress, 0-100: at 100 the squad waits at the pedestal, and grabs on the last beat.
  // Sneak steps are scaled to the chart: shadowing stepShare of his moves at Great gets
  // the squad there by the last beat; each of your own moves adds moveShare of a step.
  stepShare: 0.6, moveShare: 0.15,
  sneak: { perfect: 1.15, great: 1, good: 0.7 },
  flawless: { score: 1000 },       // a whole verse of yours at Great or better (and suspicion.flawless off the meter)
  // holds: points per beat held, a bonus for holding to the end, and how early (in beats)
  // you may let go and still count as held; a held sneak slide is worth half a step more
  hold: { tickPerBeat: 80, bonus: 250, grace: 0.35, heist: 0.5 },
  // the Groove meter fills on hits; full, Enter spends it on a Freestyle: `beats` beats in which
  // any arrow is the right one, points are multiplied, and suspicion cannot rise
  groove: { fill: { perfect: 5, great: 4, good: 2, held: 3 }, miss: -8, beats: 16, mult: 2 },
  floorAhead: 4,                   // the same, for the row on the dance floor (its ring sits mid-screen)
  laneAhead: 5,                    // beats of notes visible before they reach the hit line (fewer on a narrow screen)
  glanceBeats: 2,
  tokensPerScore: 1 / 60,
  heistBonus: 100,
};

export const GRADES = [
  { min: 0.95, grade: 'S', line: 'Legendary. He will be telling his therapist about this.' },
  { min: 0.85, grade: 'A', line: 'Awesome mix. The squad did not even have to tiptoe.' },
  { min: 0.7, grade: 'B', line: 'Solid groove. A few rounding errors.' },
  { min: 0.5, grade: 'C', line: 'You danced. Technically.' },
  { min: 0, grade: 'D', line: 'That was less a dance-off, more a dance-oops.' },
];

// what CostBot and the room say, whoever the villain is
export const LINES = {
  costbotIntro: ['Dance-off, bro. You and me. 🕺', 'Put down the invoice. Let’s settle this on the floor.'],
  costbotHype: ['Hooked on a savings feeling! 🎶', 'Can’t stop this feeling! 💃', 'Right-sized and ready! ✨', 'Come and get your spend! 🎵'],
  groove: ['Freestyle! 🌈', 'Let’s groove tonight! ✨', 'Feel the savings! 💃'],
  yourTurn: ['Your turn!', 'Top that!', 'Beat THAT.', 'Go on, then.'],
};
