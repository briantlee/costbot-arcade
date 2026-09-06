/* ==========================================================================
 * CostBot Hero — a Guitar-Hero-style rhythm cabinet for the CostBot Arcade.
 *
 * Lanes are vendors; falling notes are spend you cut on the beat. The chart for
 * each song is generated from that song's own lead line in arcade-music.js, so
 * the notes you hit ARE the melody, and they are scheduled against the same
 * AudioContext clock the music plays on — the highway stays locked to the beat.
 *
 * Self-contained: Canvas 2D + Web Audio, no assets, no build step. Include
 * arcade-music.js (required) and, if you want tokens + the leaderboard,
 * arcade-wallet.js and arcade-sync.js.  Mount with CostBotHero.mount('#el', opts).
 * ======================================================================== */
((global) => {
  'use strict';

  // ---- songs (keys into ArcadeMusic.TRACKS) --------------------------------
  // The two new tracks lead; the rest are existing arcade bangers that already
  // carry a singable lead line, so they chart cleanly.
  // biome: per-song backdrop key, drawn behind the highway via ArcadeBiomes
  // (see arcade/shared/arcade-biomes.js) — picked to match each song's vibe:
  // warm sunset arena for the hero anthem, ashen dusk for the villain march,
  // cool blue datacenter (glowing LED racks) for the neon electro parade.
  const SONGS = [
    // art: optional filename (in ../shared/assets/) for a real per-song
    // illustration, drawn as a full-canvas "wallpaper" background (cover-fit,
    // dimmed + scrimmed for legibility — see drawSongArt()) instead of the
    // plain biome color/glow wash. Songs with no `art` keep the wash unaffected.
    { key: 'ch_avengers', name: 'The Savengers',   sub: 'Avengers, rocked · 78s',   tag: '', biome: 'arena', art: 'cb_snapped.jpg' },
    // Slow quarter-note march — sparse by nature, so Hard speeds the approach and
    // drops the freebie holds (all taps) to bring it up to the other two.
    // chordSize: on notes that land on the FIRST step of a bar — the exact
    // moment arcade-music.js's own playStep() strikes the real backing pad
    // chord for that bar (see isChordEligible() in buildChart) — expand that
    // note into a chord of this many DISTINCT lanes/pitches (real harmony
    // tones, see pickHarmonyNotes()) instead of one, for the player to hit
    // with multiple keys simultaneously. Easy has no override (stays 0/off,
    // single notes only). Normal chords every bar-start note as a 2-note
    // chord; Hard chords the same bar-start notes as a 3-note chord — the two
    // differ only in chord SIZE, not in which/how many notes qualify, since
    // the bar cadence itself already paces the chords evenly (no streak cap
    // needed).
    // maxLoops: 2 (not the shared MAX_LOOPS of 3) — even at the shared cap this
    // was the longest song in the roster (~1:51 vs ~1:14-1:31 for the others);
    // dropping one loop brings it to ~1:14, in line with the rest.
    // preroll: extra lead-in before the first note is judged — the shared 2.6s
    // is fine for a single-note opener, but bar 0's downbeat is ALWAYS a chord
    // now (2-3 keys at once), so the standard countdown left no time to get
    // fingers ready for it as the very first input in the whole game.
    { key: 'ch_imperial', name: 'Imperial Markup', sub: 'Star Wars, villain march · 65s', tag: '', biome: 'dusk', art: 'darth_cb.png',
      maxLoops: 2, preroll: 4.2,
      medium: { chordSize: 2 },
      hard: { fall: 1.15, holdGap: 99, missCost: 10, chordSize: 3 } },
    { key: 'ch_small',    name: "It's a Small Cost", sub: 'Disneyland, electro light parade · 91s', tag: '', biome: 'datacenter', art: 'cb_smallworld.jpg' },
    // Foundry (cool industrial steel) instead of dusk — keeps this visually
    // distinct from Imperial Markup's purple ashen dusk while still reading dark/gritty.
    // The ostinato's real onsets land every 2 steps (8th notes), so the shared
    // Normal minGap of 3 collapses to the exact same thinned-to-every-4-steps
    // chart as Easy's minGap of 4 (neither can land on a gap of 3 in 2-step-
    // spaced data) — Normal was accidentally as easy as Easy. minGap: 2 fixes
    // that by keeping every real 8th-note onset, tightened fall/missCost so it
    // reads as a genuine step up. Hard already keeps every onset at the shared
    // minGap of 2, so there's no more density to claim; the escalation comes
    // from a much faster fall and a harsher missCost — deliberately harder than
    // the other songs' Hard, since this one is meant to be the roster's darkest.
    { key: 'ch_blindhero', name: 'Blind Spend', sub: 'Daredevil, dark ostinato · 74s', tag: '', biome: 'foundry', art: 'cb_justice.jpg',
      medium: { fall: 2.0, minGap: 3, missCost: 7 },
      hard:   { fall: 1.05, minGap: 1, missCost: 12 } },
    // 28 bars (the source's own loop length, minus its silent 2-bar intro)
    // runs ~56s on its own, so maxLoops: 1. Onsets are dense (217 of 480
    // steps, mostly 1-2 step gaps), so the shared Normal minGap of 3 barely
    // thins anything past Easy's minGap of 4 (44.2% kept vs. 42.9%) — same
    // collapse other songs in this roster hit. minGap: 2 fixes Normal (69.6%
    // kept); Hard then needs minGap: 1 to keep escalating past Normal, which
    // leaves it at the same 100%-kept density as Ultra's own shared minGap: 1
    // — left as-is (no chords/holds added) per feedback that Ultra already
    // plays hard enough as-is.
    { key: 'ch_xmen', name: 'X-pense Men', sub: "X-Men '97, distortion riff · 60s", tag: '', biome: 'foundry', art: 'cb_logan.jpg', artDim: 0.3,
      maxLoops: 1,
      medium: { minGap: 2 },
      hard:   { minGap: 1 } },
    // Playtest entry — no art yet. Lofi-house remix (see arcade-music.js) —
    // slowed from the source's 140 to 112 to ease the relentless 8th-note
    // stream. Same density issue as Blind Spend above (onsets every 2 steps),
    // so Normal still needs minGap: 2 or it collapses to Easy's chart; both
    // Normal and Hard also get a slower fall than the shared default so the
    // slower tempo actually buys the player some breathing room. maxLoops: 2
    // (not the shared 3) trims the run to ~68s — the shared 3 loops ran ~1:36,
    // way past the ~60s this song wants; 2 loops still ends on the tune's own
    // loop seam (a full pass, not a mid-phrase cut) and the existing outro
    // fade covers the last ~2.8s into that point.
    { key: 'ch_fairyfountain', name: 'Finance Fairy', sub: 'Zelda, lofi house · 69s', tag: '', biome: 'field', art: 'cb_fairy_fountaing.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 2,
      medium: { minGap: 2, fall: 2.05 },
      hard:   { fall: 1.55 } },
    // Playtest entry — no art yet. Back to a plain baseline arrangement (see
    // arcade-music.js) at the source's own 104bpm — the "rocked up" attempts
    // kept obscuring the tune, so starting over from something neutral.
    // maxLoops: 1 (not the shared 3) — the source's own loop unit is 22 bars
    // (vs. 16 for the rest of the roster) and runs ~51s on its own; more
    // passes read as too long for this one.
    // Difficulty tiers shifted per feedback: the shared Normal (minGap: 3)
    // was thinning this song's real onsets down to where it read as missing
    // beats, while the shared Hard (minGap: 2) tracked the tune correctly.
    // So: old Normal's feel becomes Easy, old Hard's feel becomes Normal, and
    // Hard is now a genuinely new tier — minGap: 1 keeps EVERY real onset,
    // no thinning at all, so it's as true to the song's actual beat as the
    // chart can get (same fall/minGap/missCost recipe as Blind Spend's Hard).
    { key: 'ch_goldsaucer', name: 'Gold Sauce', sub: 'FF7, fairground band · 51s', tag: '', biome: 'arena', art: 'cb7.png', artDim: 0.3,
      experimental: true,
      maxLoops: 1,
      easy:   { fall: 1.90, minGap: 3, holdGap: 8, missCost: 7 },
      medium: { fall: 1.45, minGap: 2, holdGap: 5, missCost: 9 },
      hard:   { fall: 1.05, minGap: 1, missCost: 12 } },
    // Lead is a dropped-octave distorted guitar/bass tone (see arcade-music.js)
    // instead of the flutey chip lead from the plain baseline — that part
    // landed well. The invented connecting melody added for the
    // transcription's long rests didn't, so it's back to the real
    // transcription's own silences. 17 bars (the source's own length)
    // instead of the usual 16; maxLoops: 2 keeps a single loop's ~28s from
    // feeling too short.
    { key: 'ch_lostwoods', name: 'Cost Woods', sub: 'Zelda, guitar · 56s', tag: '', biome: 'field', art: 'cb_lost_woods.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 2 },
    // Playtest entry — no art yet. 16 bars at 170bpm loop in ~22.6s, so the
    // shared MAX_LOOPS of 3 already lands at a normal ~68s — no override needed.
    { key: 'ch_fightOn', name: 'Write-Off!', sub: 'FF7, battle theme · 68s', tag: '', biome: 'arena', art: 'cb_buster.jpg', artDim: 0.3,
      experimental: true },
    // Playtest entry — no art yet. 22 bars at 144bpm loop in ~36.7s (trimmed
    // to end right before the source file's own bar-22 repeat); the shared
    // MAX_LOOPS of 3 would run ~110s, so maxLoops: 2 brings it to ~73s —
    // coincidentally close to the original file's own ~73.4s length.
    { key: 'ch_legendOfCostbot', name: 'Legend of CostBot', sub: 'Zelda, solo piano · 73s', tag: '', biome: 'field', art: 'legend_of_costbot.jpg', artDim: 0.35,
      experimental: true,
      maxLoops: 2 },
    // Playtest entry — no art yet. 17 bars at 104bpm loop in ~39.2s; maxLoops: 2
    // brings a run to ~78.5s, in line with the rest of the roster.
    { key: 'ch_kalm', name: 'Kalm Before the Bill', sub: 'FF7, revved lofi bass · 78s', tag: '', biome: 'field', art: 'cb_meteor.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 2 },
    // "Fiscalicia" — the original piece "Alicia", inspired by Clair Obscur:
    // Expedition 33 (see TRACKS.ch_fiscalicia for the source MIDI's own
    // key/texture evidence and the "Round 3" comment for why bpm is 130,
    // not the source's own 104; art: 'expense33.jpg' is the Expedition 33
    // nod). 32 bars at 130bpm (this excerpt's own length, not the full
    // ~3-minute source) is ~59s in a single pass — just under the roster's
    // usual ~60s floor but in line with ch_xmen's accepted ~56s — so
    // maxLoops stays 1.
    // Round 4 (feedback: "get the game notes matching the melody the best
    // we can" — fidelity prioritized over an escalating density ladder).
    // easy/medium/hard all get minGap: 1 (Ultra already defaults there), so
    // EVERY difficulty keeps all 139 real onsets (100%, up from the shared
    // defaults' 57.6/75.5/93.5%) — same move as ch_gameofloans converging
    // Normal/Hard/Ultra to 1, just carried one step further to include Easy
    // too, since this per-round ask explicitly asks for max fidelity as the
    // priority. Checked whether Easy (only 3 lanes vs. 4 for the rest)
    // needed to stay held back the way ch_gameofloans' Easy did (minGap: 2,
    // 75-79%): buildChart's pitchToLane already displaces same-lane repeats
    // to an adjacent lane (see `if (lane === prevLane && diff.lanes > 1)`),
    // so fewer lanes doesn't force awkward same-key double-hits the way it
    // might without that spread logic, and the song's own full-fidelity
    // pace is gentle (139 onsets/512 steps, ~0.34s average gap at 130bpm) —
    // not dense enough to read as overwhelming even fully kept. No clear
    // reason to hold Easy back here, so it converges with the rest. The
    // progression across tiers now comes entirely from the shared DIFFS'
    // own fall/holdGap/missCost (unchanged, not overridden): fall eases
    // 2.15 -> 1.0 (more reaction time on Easy), holdGap 99 -> 4 means
    // Easy gets zero hold notes while Ultra gets the most (0/13/25/39 across
    // easy/medium/hard/ultra), and missCost climbs 5 -> 15 — a real,
    // feelable ladder without holding back note accuracy on any tier.
    { key: 'ch_fiscalicia', name: 'Fiscalicia', sub: 'Expedition 33, piano ballad · 59s', tag: '', biome: 'field', art: 'expense33.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 1,
      easy:   { minGap: 1 },
      medium: { minGap: 1 },
      hard:   { minGap: 1 } },
    // 33 bars at 88bpm (the source's own pulse) is already a single ~90s pass
    // through the whole main title theme — in line with the roster's longest
    // (Avengers, ~1:51) — so maxLoops: 1.
    // L.gameOfLoans is collapsed to one onset per real pitch change (see its
    // own comment) specifically so minGap thinning never trades a real note
    // for a same-pitch repeat — every difficulty here is 100% real melody,
    // never "the beat". minGap still trades note COUNT for difficulty: Easy
    // at the shared 4 collapses to a mere 40% of the real note-changes (long
    // stretches read as missing beats), so it's loosened to 2 (75% kept) —
    // still visibly sparser than the rest, just not mangled. Normal and Hard
    // are both bumped to 1 (matching Ultra, 100% kept, same note set as each
    // other and Ultra) — this song's real melody just doesn't have enough
    // events to make a meaningful 3-way density split above Easy, so Normal/
    // Hard/Ultra differ from here by fall speed, holdGap and missCost only
    // (same trade as Gold Saucer's Hard).
    // Easy also gets a taste of holds here (unlike the shared holdGap: 99,
    // which is "never") — a hold's head is judged exactly like a tap and
    // releasing early costs nothing (no bill hit, no combo break, you just
    // miss the bonus), so it's a strictly lower-risk mechanic, not a harder
    // one; the shared roster still gates it off Easy because tracking "am I
    // still holding this" while reading the next note is real multitasking.
    // holdGap: 6 catches the 6-step gaps in the hook-widens-under-Gm turns
    // (bars 3, 6, 9, 12, 15, 18) — 14 gentle, occasional holds — without
    // reaching the busier stretches, so Easy stays visibly calmer than the
    // tiers above it (Hard/Ultra pick up the same 14 via their own minGap/
    // holdGap plus more from elsewhere: 14 and 23 respectively).
    { key: 'ch_gameofloans', name: 'Game of Loans', sub: 'Game of Thrones, epic march · 90s', tag: '', biome: 'dusk', art: 'game_of_loans.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 1,
      easy:   { minGap: 2, holdGap: 6 },
      medium: { minGap: 1 },
      hard:   { minGap: 1 } },
    // Dance-club rendition of FF7's Tifa's Theme (see arcade-music.js) — 20
    // bars at 128bpm loop in ~37.5s (bar 20's arpeggiated intro pickup is
    // deliberately excluded from the loop; see L.tariffa — looping it in made
    // it recur mid-song every restart, reading as a jarring "speeds up for a
    // few notes" right after the cadence at the end of the excerpt); the
    // shared MAX_LOOPS of 3 would run ~112.5s, past the roster's usual
    // ~60-110s, so maxLoops: 2 brings it to ~75s, in line with Kalm Before
    // the Bill. The tune's real onsets are 8th-note spaced (every 2 steps)
    // almost throughout, so the shared Normal minGap of 3 collapses to the
    // exact same 59% of onsets as Easy's minGap of 4 — the same collision
    // Blind Spend's data hit. minGap: 2 fixes it (99% kept, same set Hard
    // already keeps at its own shared minGap) — Normal and Hard end up
    // tracking the same notes here, differing only by fall speed and
    // missCost, same trade as Game of Loans' Normal/Hard above.
    { key: 'ch_tariffa', name: 'Tariffa', sub: "FF7 · Tifa's Theme, dance club remix · 75s", tag: '', biome: 'datacenter', art: 'tarrifa.png', artDim: 0.3,
      experimental: true,
      maxLoops: 2,
      medium: { minGap: 2 } },
    // Curated roster (no art yet — falls back to the biome wash). Cut to the
    // source's bars 1-32 (the full 43 ran a little long) — see P.underthegcp/
    // L.underthegcp; bar 32 is a Db tonic cadence just before the dense F5
    // climax, a clean loop boundary. 32 bars at 200bpm is ~38s a pass;
    // maxLoops: 2 brings a run to ~77s, in line with ch_spenderman. Generated
    // off under_the_gcp.mid by arcade/tools/mid2chart.js.
    { key: 'ch_underthegcp', name: 'Under the GCP', sub: 'Under the Sea (Little Mermaid) · 77s', tag: '', biome: 'arena', art: 'cb_ariel.jpg', artDim: 0.3,
      maxLoops: 2 },
    // Price Ali — Prince Ali (Aladdin), full MIDI once through (maxLoops 1, ~3:13).
    // Main roster (non-experimental) per request. Generated by mid2chart.js.
    { key: 'ch_priceali', name: 'Price Ali', sub: 'Aladdin · Prince Ali · 1:20', tag: '', biome: 'arena', art: 'cb_aladdin.jpg', artDim: 0.3,
      maxLoops: 1 },
    // Three playtest entries generated by arcade/tools/mid2chart.js. Each now
    // charts its FULL MIDI and plays once through (maxLoops 1), so a run is the
    // whole song — not a repeating loop. Flower Gil is long/gentle (a ballad,
    // ~3:52); the other two are dense flamenco/ragtime.
    { key: 'ch_aerithrock', name: 'Flower Gil', sub: "FF7 · Aerith's Theme · 1:20", tag: '', biome: 'arena', art: 'cb_aerith.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 1 },
    { key: 'ch_vamo', name: 'Vamo Alla Financio', sub: 'FF9 · flamenco romp · 1:40', tag: '', biome: 'arena', art: 'cb_chocobo.jpg', artDim: 0.3,
      experimental: true,
      maxLoops: 1 },
    { key: 'ch_stolentokens', name: 'Materia Girl', sub: "FF7 · Yuffie's Theme, ragtime · 1:03", tag: '', biome: 'arena', art: 'cb_yuffie.jpg', artDim: 0.3,
      experimental: true,
      // Feedback: too easy. The transcription itself isn't sparse (89 real
      // melody onsets in the charted window) — the shared Normal minGap (3)
      // was just thinning ~40% of them out (53 of 89 kept); Hard's minGap
      // (2) already keeps effectively all of them (84 of 89 — some sit only
      // 1 step apart, hence not literally 89). Override brings Normal up to
      // Hard's spacing for this song specifically, same pattern ch_imperial/
      // ch_blindHero use, so more of the real transcription surfaces as
      // tappable notes without inventing any.
      medium: { minGap: 2 },
      maxLoops: 1 },
    // Disney batch (from MIDI via mid2chart.js).
    { key: 'ch_howfarowe', name: "How Far I'll Owe", sub: 'Moana · How Far I\'ll Go · 1:04', tag: '', biome: 'arena', art: 'cb_moana.jpg', artDim: 0.3,
      maxLoops: 1 },
    { key: 'ch_frozen', name: "For the First Dime in Forever", sub: 'Frozen · ballad · 1:02', tag: '', biome: 'arena', art: 'cb_frozen.jpg', artDim: 0.3,
      maxLoops: 1 },
    { key: 'ch_guest', name: 'Bill Our Guest', sub: 'Beauty and the Beast · Be Our Guest · 1:01', tag: '', biome: 'arena', art: 'cb_be_our_guest.jpg', artDim: 0.3,
      maxLoops: 1 },
  ];

  const DIFFS = {
    // fall   = seconds a note takes to reach the line (bigger = slower/easier).
    // minGap = minimum spacing in 16th steps between kept notes. Every kept note
    //          is a REAL melody onset, so the chart always tracks the tune; a
    //          bigger gap just thins dense runs (easier) without moving notes.
    easy:   { label: 'Easy',   lanes: 3, fall: 2.15, minGap: 4, holdGap: 99, traps: false, missCost: 5,  color: '#39d98a' },
    medium: { label: 'Normal', lanes: 4, fall: 1.90, minGap: 3, holdGap: 8,  traps: false, missCost: 7,  color: '#f5c451' },
    hard:   { label: 'Hard',   lanes: 4, fall: 1.45, minGap: 2, holdGap: 5,  traps: true,  missCost: 9,  color: '#ff5d6c' },
    // Experimental-only tier, unlocked by the same toggle that reveals the
    // experimental songs (see meta.experimental). minGap: 1 keeps literally
    // every real onset in the transcription — no thinning at all — plus a
    // faster fall and a harsher missCost so it's a genuine step up from Hard,
    // not just the same chart with less time.
    ultra:  { label: 'Ultra',  lanes: 4, fall: 1.0,  minGap: 1, holdGap: 4,  traps: true,  missCost: 15, color: '#c04dff' },
  };

  // Lanes are vendors — colour + name read left-to-right across the highway.
  // Distinct hues per lane (a nod to each vendor's brand, but spread around the
  // wheel so adjacent lanes never read as the same colour): AWS orange, GCP blue,
  // Azure teal, Databricks red, Snowflake ice-blue.
  // A BUDGET BLOWN screen you will see hundreds of times wants more than one
  // picture — same idea (and same three images) as Mudslides' WIPEOUT_SHOTS.
  // Rotated at random rather than cycled: a cycle is predictable enough that
  // the third one stops registering. Never the same shot twice running (pure
  // random over three repeats about a third of the time, which reads as "it
  // isn't rotating").
  const WIPEOUT_SHOTS = ['wipeout.jpg', 'wipeout-surgery.jpg', 'wipeout-megabill.jpg'];
  let lastWipeoutShot = null;
  function pickWipeoutShot() {
    const choices = WIPEOUT_SHOTS.filter((s) => s !== lastWipeoutShot);
    lastWipeoutShot = choices[(Math.random() * choices.length) | 0];
    return lastWipeoutShot;
  }
  // SONG CLEAR mirror of the above — six CostBot Hero victory poses, rotated
  // the same never-twice-running way so a good run doesn't feel repetitive.
  const VICTORY_SHOTS = ['cb-victory-1.png', 'cb-victory-2.png', 'cb-victory-3.png',
    'cb-victory-4.png', 'cb-victory-5.png', 'cb-victory-6.png'];
  let lastVictoryShot = null;
  function pickVictoryShot() {
    const choices = VICTORY_SHOTS.filter((s) => s !== lastVictoryShot);
    lastVictoryShot = choices[(Math.random() * choices.length) | 0];
    return lastVictoryShot;
  }
  const PALETTE = ['#ff9900', '#4285f4', '#00e0b8', '#ff3b30'];
  const VENDORS = ['AWS', 'GCP', 'Azure', 'Databricks'];
  // stylized (non-trademark) vendor glyphs shown on brand-coloured badges
  const BADGES = ['a', 'G', '▲', 'D'];
  // Real vendor logo paths (24x24 SVG), reused from mudslides ms-content.js.
  // AWS has no mark in that set, so it keeps the monogram badge below.
  const VENDOR_PATHS = [
    null,                                   // AWS (monogram fallback)
    "M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-2.821-4.552l-.043.043.006-.05A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c1.244-.04 2.518.368 3.486 1.15a5.186 5.186 0 0 1 1.862 4.078v.518c3.53-.07 3.53 5.262 0 5.193h-5.193l-.008.009v-.04H6.785a2.59 2.59 0 0 1-1.067-.23h.001a2.597 2.597 0 1 1 3.437-3.437l3.013-3.012A6.747 6.747 0 0 0 8.11 8.24c.018-.01.04-.026.054-.023a5.186 5.186 0 0 1 3.67-1.69z",        // GCP
    "M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14v.002L17.35 1.76A1.62 1.62 0 0 0 15.816.657H8.184A1.62 1.62 0 0 0 6.65 1.76L.086 21.204a1.62 1.62 0 0 0 1.536 2.139h4.741a1.62 1.62 0 0 0 1.535-1.103l.977-2.892l4.947 3.675c.28.208.618.32.966.32m-3.084-12.531l3.624 10.739a.54.54 0 0 1-.51.713v-.001h-.03a.54.54 0 0 1-.322-.106l-9.287-6.9h4.853m6.313 7.006c.116-.326.13-.694.007-1.058L9.79 1.76l-.007-.02h6.034a.54.54 0 0 1 .512.366l6.562 19.445a.54.54 0 0 1-.338.684",      // Azure
    "M.95 14.184L12 20.403l9.919-5.55v2.21L12 22.662l-10.484-5.96-.565.308v.77L12 24l11.05-6.218v-4.317l-.515-.309L12 19.118l-9.867-5.653v-2.21L12 16.805l11.05-6.218V6.32l-.515-.308L12 11.974 2.647 6.681 12 1.388l7.76 4.368.668-.411v-.566L12 0 .95 6.27v.72L12 13.207l9.919-5.55v2.26L12 15.52 1.516 9.56l-.565.308Z", // Databricks
  ];
  const VENDOR_ICONS = VENDOR_PATHS.map(p => { try { return p ? new Path2D(p) : null; } catch { return null; } });
  // savings-lever icons shown on the note faces (rightsize, delete idle, schedule
  // off, commit/RI, cold storage, cleanup, consolidate, cut)
  const SAVINGS = ['📉', '🗑️', '⏸️', '🔒', '❄️', '🧹', '📦', '🔻'];
  const KEYS = { 3: ['s', 'd', 'f'], 4: ['a', 's', 'd', 'f'] };
  // Rebindable: meta.laneKeys (persisted, defaults to KEYS[4]) replaces the
  // hardcoded 4-key array at run start; 3-lane keeps deriving as "drop the
  // first key" (see startSong's `keys:` line) so there's still only one
  // binding to store. Keys a rebind must never take, because onKey() already
  // gives them meaning in every state (menu nav, calibration, mute, transport).
  const RESERVED_KEYS = new Set(['m', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '[', ']', 'enter', ' ', 'escape', 'backspace']);

  // FinOps-flavoured judgment names.
  const JUDGE = { perfect: 'OPTIMIZED!', great: 'RIGHTSIZED', ok: 'TRIMMED', miss: 'OVERRUN', trap: "PROD — DON'T CUT",
    wrongLane: 'WRONG LANE', mistimed: 'MISTIMED' };
  const COMBO_CALLS = { 10: 'ON THE BOOKS', 25: 'QUARTERLY SAVINGS!', 50: 'FISCAL LEGEND!' };

  // Real FinOps tips — surfaced on good moments so the game teaches while you play.
  const TIPS = [
    'Rightsize idle EC2 — most instances run under 40% CPU.',
    'Savings Plans / Reserved Instances cut steady compute up to ~72%.',
    'Delete unattached EBS volumes and stale snapshots — you pay for them idle.',
    'Schedule non-prod off nights & weekends for ~65% fewer hours.',
    'Tier cold S3 data to Infrequent Access or Glacier.',
    'Graviton (ARM) runs the same work for ~20% less.',
    'Kill idle NAT gateways and load balancers with no targets.',
    'Auto-suspend Snowflake & BigQuery so warehouses never idle.',
    'Tag everything — you can’t cut what you can’t attribute.',
    'Right-size Databricks clusters and turn on autoscaling.',
    'Use Spot / preemptible VMs for fault-tolerant jobs — up to ~90% off.',
    'Set budgets & anomaly alerts so spend surprises get caught early.',
  ];
  // per-vendor tips (index-aligned with VENDORS), shown when you cut that lane
  const VENDOR_TIPS = [
    'AWS: Graviton, Savings Plans and S3 lifecycle rules are the big three.',
    'GCP: set Committed Use Discounts and BigQuery slot reservations.',
    'Azure: use Reservations + Hybrid Benefit; deallocate idle VMs.',
    'Databricks: autoscale, auto-terminate clusters, and use spot workers.',
  ];
  // savings-plan / commitment tips, shown on gold "Savings Plan" notes and holds
  const PLAN_TIPS = [
    'Savings Plans lock in up to ~72% off for a 1- or 3-year commit.',
    'Reserved Instances suit steady, predictable workloads.',
    'Commit your steady baseline; keep bursty load on on-demand or spot.',
    'The longer the commitment, the deeper the discount.',
  ];
  // "Did you know?" stats shown on the song-select screen (between runs)
  const DYK = [
    'Idle resources are roughly 30% of typical cloud spend.',
    'Untagged spend is spend you can’t optimize.',
    'Non-prod rarely needs to run nights or weekends.',
    'A forgotten NAT gateway can cost $1,000+/yr doing nothing.',
    'Most EC2 instances run under 40% CPU — room to rightsize.',
  ];

  const BILL_MAX = 100;
  const TARGET_SECS = 105;    // aimed note span; the loop cap below is what actually bounds length
  const MAX_LOOPS = 3;        // every song repeats its bar-loop at most this many times
  const PREROLL = 2.6;        // seconds of countdown before the first note

  const STORE_KEY = 'costbot.hero.v1';
  // Matches arcade-music.js's own STEPS_PER_BAR / playStep() convention exactly
  // (bar = Math.floor(step / STEPS_PER_BAR), chord = track.prog[bar % prog.length])
  // so a chord note's harmony always lines up with the bar the backing track
  // is actually playing.
  const STEPS_PER_BAR = 16;

  // ---- small helpers -------------------------------------------------------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const fmtK = (n) => n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n);

  // CostBot mascot, drawn as the DJ/host reacting to the run. Superhero-pose
  // art (same image already used for this game's boot-loading icon) — NOT
  // the plain costbot.png used by the boot icon's favicon/back-link, which
  // stays untouched.
  const hostImg = new Image(); let hostReady = false;
  hostImg.onload = () => { hostReady = true; };
  hostImg.src = '../shared/assets/cb_hero.png';

  // Token coin — same art as the rest of the arcade (e.g. Mudslides' "tokens
  // collected all-time"), not the 🪙 emoji.
  const coinImg = new Image(); let coinReady = false;
  coinImg.onload = () => { coinReady = true; };
  coinImg.src = '../shared/assets/token-coin-64.png';

  // x50-combo flash art (same "CB T-1000" piece Waste Hunter's Terminate All
  // nuke pickup flashes full-screen).
  const t1000Img = new Image(); let t1000Ready = false;
  t1000Img.onload = () => { t1000Ready = true; };
  t1000Img.src = '../shared/assets/cb_t1000.png';

  // Per-song full-background artwork (SONGS[i].art). Loaded lazily on first
  // reference and cached by filename so switching songs (or retrying) never
  // re-fetches. Songs with no `art` never touch this cache.
  const artCache = new Map();
  function getArtImage(file) {
    if (!file) return null;
    let entry = artCache.get(file);
    if (!entry) {
      const img = new Image();
      entry = { img, ready: false };
      img.onload = () => { entry.ready = true; };
      img.src = '../shared/assets/' + file;
      artCache.set(file, entry);
    }
    return entry;
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function saveStore(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch {} }

  // ======================================================================
  // mount
  // ======================================================================
  function mount(sel, opts) {
    opts = opts || {};
    const host = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const emit = (t, p) => { try { opts.onEvent && opts.onEvent(t, p); } catch {} };

    // ---- canvas ----
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    host.appendChild(cv);
    const ctx2d = cv.getContext('2d');
    let W = 0, H = 0, DPR = 1;
    function resize() {
      DPR = Math.min(2, global.devicePixelRatio || 1);
      W = host.clientWidth || 800; H = host.clientHeight || 600;
      cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
      ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    global.addEventListener('resize', resize);

    // ---- outer-space starfield backdrop ----
    const stars = [];
    for (let i = 0; i < 160; i++) stars.push({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3,
      tw: Math.random() * 2 + 0.4, ph: Math.random() * 6.283,
      c: Math.random() < 0.16 ? '#bcd0ff' : (Math.random() < 0.18 ? '#ffe4bc' : '#ffffff'),
    });
    // skipNebula: true when a song biome already supplies its own sky gradient —
    // the purple/blue nebula blobs are tuned for the plain space backdrop and
    // clash with e.g. the sunset arena or field skies, so they're dropped there.
    // The twinkling star dots stay in both cases — cheap, subtle, reads fine
    // over any dark floor and keeps a consistent "arcade at night" feel.
    function drawStars(skipNebula) {
      const t = performance.now() / 1000;
      if (!skipNebula) {
        // a couple of faint nebulae for depth
        const neb = (nx, ny, nr, col) => {
          const gg = ctx2d.createRadialGradient(nx, ny, 0, nx, ny, nr);
          gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx2d.fillStyle = gg; ctx2d.fillRect(0, 0, W, H);
        };
        neb(W * 0.5, H * 0.16, Math.max(W, H) * 0.4, 'rgba(96,70,190,0.12)');
        neb(W * 0.82, H * 0.72, Math.max(W, H) * 0.34, 'rgba(40,120,180,0.08)');
      }
      // drifting, twinkling stars
      for (const s of stars) {
        const a = 0.30 + 0.45 * Math.sin(t * s.tw + s.ph);
        if (a <= 0.02) continue;
        const yy = ((s.y + t * 0.006) % 1) * H;
        ctx2d.globalAlpha = a; ctx2d.fillStyle = s.c;
        ctx2d.beginPath(); ctx2d.arc(s.x * W, yy, s.r, 0, 6.283); ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;
    }

    // song-specific backdrop: biome floor colour + sky wash only. Scenery props
    // (crates/trees/racks/etc.) are intentionally NOT drawn here — playtesting
    // feedback was that the color/glow reads well but the generated scenery
    // objects don't. `props` is still accepted (and startSong still generates
    // bioProps) so this stays cheap to re-enable, or to swap in real artwork
    // later, without rebuilding the biome plumbing; it's just unused for now.
    // Falls back to the plain gradient if biomes didn't load or the song has
    // no biome assigned.
    function drawBiomeBackground(bio, _props) {
      ctx2d.fillStyle = bio.floor; ctx2d.fillRect(0, 0, W, H);
      if (bio.sky) {
        const sg = ctx2d.createLinearGradient(0, 0, 0, H);
        sg.addColorStop(0, bio.sky[0]); sg.addColorStop(1, bio.sky[1]);
        ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = sg; ctx2d.fillRect(0, 0, W, H); ctx2d.globalAlpha = 1;
      }
    }

    // ---- persistent meta ----
    const store = loadStore();
    const meta = Object.assign({ records: {}, plays: 0, lastSong: 0, lastDiff: 'medium', calibMs: 0, muted: false,
      experimental: false, laneKeys: KEYS[4].slice() },
      opts.meta || store.meta || {});
    function persist() {
      if (opts.persist === false) return;
      store.meta = meta; saveStore(store);
    }

    // Experimental songs/difficulty, gated behind the menu's toggle
    // (meta.experimental, persisted). Both helpers read live off meta so
    // toggling immediately changes what song-up/down and diff-left/right
    // cycle through, as well as what the menu renders.
    function visibleSongs() { return SONGS.filter((s) => !s.experimental || meta.experimental); }
    function diffOrder() { return meta.experimental ? ['easy', 'medium', 'hard', 'ultra'] : ['easy', 'medium', 'hard']; }

    // The song list is one unified, searchable, scrollable column: curated
    // songs first (alphabetical by name), then experimental ones (also
    // alphabetical, shown inline with an EXP badge) — but only when
    // meta.experimental is on. A live search box narrows by name/subtitle.
    // menuSongs() is the single source of truth for BOTH the rendered rows and
    // up/down keyboard nav, so the two can never drift (e.g. arrow keys skipping
    // a filtered-out row). songQuery is the current search text, empty when not
    // filtering.
    let songQuery = '';
    function menuSongs() {
      const vis = visibleSongs();
      const curated = vis.filter((s) => !s.experimental).sort((a, b) => a.name.localeCompare(b.name));
      const exp = vis.filter((s) => s.experimental).sort((a, b) => a.name.localeCompare(b.name));
      let ordered = curated.concat(exp);
      const q = songQuery.trim().toLowerCase();
      if (q) ordered = ordered.filter((s) => (s.name + ' ' + (s.sub || '')).toLowerCase().includes(q));
      return ordered;
    }

    // ---- audio ----
    let actx = null, master = null, music = null, sfxBus = null;
    function initAudio() {
      if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext;
      actx = new AC();
      master = actx.createGain(); master.gain.value = meta.muted ? 0 : 0.9; master.connect(actx.destination);
      sfxBus = actx.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
      if (global.ArcadeMusic) music = global.ArcadeMusic.create(() => ({ ctx: actx, master }));
    }
    // mute rides the master bus, so it kills music + SFX together and survives reloads
    function applyMute() { if (master) master.gain.value = meta.muted ? 0 : 0.9; }
    function toggleMute() { meta.muted = !meta.muted; applyMute(); persist(); emit('mute', { muted: !!meta.muted }); return !!meta.muted; }
    // crisp one-shot feedback blips, kept out of the music mix
    function blip(freq, dur, type, gain, slideTo) {
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.4, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
    }
    const SFX = {
      perfect: () => { blip(880, 0.10, 'triangle', 0.5, 1320); blip(1760, 0.08, 'sine', 0.25); },
      great:   () => blip(660, 0.09, 'triangle', 0.4, 880),
      ok:      () => blip(440, 0.08, 'square', 0.3),
      miss:    () => blip(150, 0.16, 'sawtooth', 0.35, 70),
      trap:    () => blip(110, 0.22, 'sawtooth', 0.45, 55),
      // two distinct "you goofed, but not as badly as a real miss" cues, so a
      // player can tell "I pressed wrong" apart from "a note got away from me":
      // a mid square blip for pressing the wrong lane, a quick high whiff for
      // pressing with nothing anywhere in range. Confirmed via live oscillator
      // instrumentation that both fire correctly through the full sfxBus/master
      // chain (they're just rarely TRIGGERED in normal accurate play, since a
      // press only reaches this branch when nothing is in that lane within the
      // 150ms window at all — most real misses are note timeouts, which use
      // SFX.miss instead). Gain bumped a second time regardless, past the other
      // penalty cues' level, since low-frequency square blips read as duller
      // than the higher-pitched judgment chimes at the same amplitude.
      wrongLane: () => blip(200, 0.12, 'square', 0.55, 90),
      mistimed:  () => blip(320, 0.07, 'square', 0.45, 260),
      gold:    () => { blip(1046, 0.12, 'triangle', 0.5, 1568); blip(1568, 0.12, 'sine', 0.3, 2093); },
      combo:   () => { blip(784, 0.08, 'triangle', 0.4, 1046); },
      ui:      () => blip(520, 0.05, 'square', 0.25),
    };

    // ---- SONG CLEAR fanfare (applause + cheer + a little victory chime) -----
    // Procedural, same as everything else here — no samples, so "clapping" and
    // "cheering" are stylized noise-synthesis approximations, not real crowd
    // audio: a clap is the classic multi-transient trick (a few tightly-spaced
    // bandpassed noise bursts, which is what actually makes a burst of noise
    // read as a hand-clap and not a hiss), and a "cheer" is a bright noise
    // swell with a rising-then-settling bandpass sweep standing in for a
    // wordless crowd "whoo".
    function fanfareNoiseBuf(dur) {
      const n = Math.max(1, Math.floor(actx.sampleRate * dur));
      const b = actx.createBuffer(1, n, actx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      return b;
    }
    function clapHit(t, gain) {
      [0, 0.008, 0.018].forEach((delay, i) => {
        const s = actx.createBufferSource(); s.buffer = fanfareNoiseBuf(0.05);
        const f = actx.createBiquadFilter(); f.type = 'bandpass';
        f.frequency.value = 1200 + Math.random() * 900; f.Q.value = 1.1;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t + delay);
        g.gain.exponentialRampToValueAtTime(gain * (i === 0 ? 1 : 0.7), t + delay + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.07);
        s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t + delay);
      });
    }
    function chime(delay, freq, dur, slideTo) {
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.65, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.03);
    }
    function playFanfare() {
      if (!actx) return;
      const t0 = actx.currentTime;
      // Applause: ~56 randomly-timed claps over ~3s (up from 40/2.2s — bigger
      // crowd, and stretched to roughly match the now-longer fireworks show).
      // Math.random()**1.5 biases timing early (denser at the start, thinning
      // toward the end), the shape a real round of applause has — an abrupt
      // onset, then tapering off.
      for (let i = 0; i < 56; i++) {
        clapHit(t0 + Math.random() ** 1.5 * 3.0, 0.30 + Math.random() * 0.28);
      }
      // Cheer: one long noise swell, its bandpass sweeping up then settling —
      // reads as a wordless crowd "whoo" under the applause.
      const s = actx.createBufferSource(); s.buffer = fanfareNoiseBuf(1.8);
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
      f.frequency.setValueAtTime(500, t0);
      f.frequency.exponentialRampToValueAtTime(2600, t0 + 1.1);
      f.frequency.exponentialRampToValueAtTime(900, t0 + 1.8);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t0);
      // A quick ascending C-E-G-C-C "ta-da" arpeggio on top, landing on the
      // octave twice (a fuller flourish than the plain 4-note version).
      [523.25, 659.25, 784.0, 1046.5, 1318.5].forEach((freq, i) => { chime(i * 0.09, freq, 0.3); });
    }

    // ---- game state ----
    let state = 'menu';         // menu | count | play | result
    // Default selection is always The Savengers on Normal — the title screen
    // opens there every load rather than remembering the last pick.
    let songIdx = 0;
    let diffKey = 'medium';
    let run = null;             // active run object
    const keysDown = new Set(); // lane keys currently held
    const pointers = new Map(); // pointerId -> laneIndex

    // Map a MIDI pitch to a lane using the exact same rolling pitch-window
    // scheme as the primary melody note (Pass 2 below): lower pitch -> lower
    // lane, higher pitch -> higher lane, scaled against the local [lo, hi]
    // window. Factored out so chord harmony tones land in a lane consistent
    // with how every other note on the highway is placed, instead of some
    // separate ad hoc scheme.
    function pitchToLane(midi, lo, hi, lanes) {
      const lane = hi > lo ? Math.round((midi - lo) / (hi - lo) * (lanes - 1)) : (lanes >> 1);
      return clamp(lane, 0, lanes - 1);
    }

    // Find the nearest free lane to `desired` for a chord's harmony voice:
    // not already claimed by this same chord (`usedLanes`), and not within
    // ~0.15s of an unrelated note in another lane (so a chord can never
    // silently overlap an unrelated note — also what keeps chords from ever
    // landing on a Hard trap slot, since the trap pass below already
    // clash-checks against every note in `notes`, chords included). Falls
    // back outward one lane at a time; returns -1 if the highway is jammed,
    // in which case the caller just drops that harmony voice.
    function pickFreeLane(desired, lanes, usedLanes, existingNotes, time) {
      for (let d = 0; d < lanes; d++) {
        const tryLanes = d === 0 ? [desired] : [desired - d, desired + d];
        for (const l of tryLanes) {
          if (l < 0 || l >= lanes) continue;
          if (usedLanes.indexOf(l) !== -1) continue;
          const busy = existingNotes.some(n => n.lane === l && Math.abs(n.time - time) < 0.15);
          if (!busy) return l;
        }
      }
      return -1;
    }

    // Pick REAL harmony tones from the song's own chord progression
    // (track.prog, the same data arcade-music.js's playStep() uses to voice
    // the backing pad/bass) for a chord note, instead of duplicating the
    // melody pitch. `extraCount` is how many ADDITIONAL voices beyond the
    // melody note itself (1 for a 2-note chord, 2 for a 3-note chord).
    // Returns an array of { midi, lane } for the extra voices only — the
    // primary note keeps its own midi/lane untouched.
    function pickHarmonyNotes(track, k, lane, extraCount, lo, hi, diff, existingNotes) {
      if (!track.prog || !track.prog.length) return [];
      const bar = Math.floor(k.src / STEPS_PER_BAR);
      const chord = track.prog[bar % track.prog.length];
      if (!chord || !chord.tones || !chord.tones.length) return [];
      const melodyClass = ((k.midi % 12) + 12) % 12;
      // Prefer tones that are NOT the same pitch class as the melody note, so
      // a harmony voice is always genuinely different — if the melody note IS
      // the chord root, this naturally prefers the third then the fifth,
      // since P.chImperial writes tones root-first (e.g. [0, 3, 7]).
      const ordered = chord.tones.filter((t) => (((chord.root + t) % 12) + 12) % 12 !== melodyClass);
      const picks = ordered.slice(0, extraCount);
      const out = [];
      const usedLanes = [lane];
      for (const t of picks) {
        const pitchClass = chord.root + t;
        // place this tone in whichever octave lands closest to the melody
        // note, so the harmony sits in a musically sensible register near
        // the lead line rather than an arbitrary octave
        let bestMidi = pitchClass, bestDist = Infinity;
        for (let o = -3; o <= 3; o++) {
          const cand = pitchClass + o * 12;
          const dist = Math.abs(cand - k.midi);
          if (dist < bestDist) { bestDist = dist; bestMidi = cand; }
        }
        const desiredLane = pitchToLane(bestMidi, lo, hi, diff.lanes);
        const lane = pickFreeLane(desiredLane, diff.lanes, usedLanes, existingNotes, k.time);
        if (lane === -1) continue;   // highway jammed here — just drop this voice
        usedLanes.push(lane);
        out.push({ midi: bestMidi, lane });
      }
      return out;
    }

    // spend/icon are cosmetic but derived from a note's midi+lane, so a chord
    // voice with its own real pitch needs its own real spend/icon rather than
    // inheriting the melody note's numbers verbatim.
    function spendFor(midi, lane, gold) {
      let spend = 40 + (Math.abs(midi * 7 + lane * 53) % 40) * 12;
      if (gold) spend *= 4;
      return spend;
    }
    function iconFor(midi, lane, gold) {
      return gold ? '💰' : SAVINGS[Math.abs(midi + lane) % SAVINGS.length];
    }

    // ---- chart build ------------------------------------------------------
    // `lat` shifts every note by the audio output latency so a tile reaches the
    // line exactly when you HEAR its note, not when it was scheduled.
    function buildChart(track, diff, firstStep0, startStepAbs, lat, maxLoopsOverride) {
      const LL = (track.bars || 4) * 16;
      const lead = track.lead || [];
      const stepDur = 60 / track.bpm / 4;
      const loopSecs = LL * stepDur;
      // whole loops only, so the melody completes its phrases and the song ends on a
      // musical boundary instead of being chopped mid-phrase (which read as abrupt).
      // Real-audio tracks (track.audioSrc) are a single fixed-length recording, not
      // a synth loop to repeat until ~TARGET_SECS — always chart exactly one pass.
      // Every synth song is capped at MAX_LOOPS regardless of tempo, so a fast song
      // no longer runs longer than a slow one just to reach TARGET_SECS.
      const loops = track.audioSrc ? 1 : Math.min(Math.max(2, Math.ceil(TARGET_SECS / loopSecs)), maxLoopsOverride || MAX_LOOPS);
      const total = loops * LL;
      // stop spawning notes ~2.5s before the musical end for a clean, note-free outro
      const tailSteps = Math.max(16, Math.round(2.5 / stepDur));
      let noteCut = Math.floor((total - tailSteps) / 16) * 16;
      if (noteCut < 16) noteCut = total;

      let globalHi = -Infinity;
      for (const m of lead) if (m != null && m > globalHi) globalHi = m;
      if (!Number.isFinite(globalHi)) globalHi = 72;

      // gap (in steps) from src to the next non-null lead step
      const gapAt = (src) => { let k = 1; while (k < LL && lead[(src + k) % LL] == null) k++; return k; };

      // Pass 1: keep real melody onsets, thinned only by the difficulty's minGap.
      // No ramp — every kept note is a note you actually hear, so chart == tune.
      // Exception: on a chorded song, a bar-start note is the real backing pad-
      // chord hit (see isChordEligible below) and must never be swallowed by
      // minGap thinning just because the previous bar's tail note sits close to
      // it — that hit happens in the music every single bar, chart included.
      const kept = [];
      let lastKept = -Infinity;
      for (let S = 0; S < noteCut; S++) {
        const src = (startStepAbs + S) % LL;
        const m = lead[src];
        if (m == null) continue;
        const isBarStart = diff.chordSize >= 2 && src % STEPS_PER_BAR === 0;
        if (S - lastKept < diff.minGap && !isBarStart) continue;
        lastKept = S;
        kept.push({ src, midi: m, time: firstStep0 + (startStepAbs + S) * stepDur + lat });
      }

      // Pass 2: assign lanes from a ROLLING pitch window, so every section spreads
      // across all lanes (a low verse no longer leaves the top lane idle). Repeats
      // are nudged off the previous lane so activity never bunches in one column.
      const W = 6;
      const notes = [];
      let prevLane = -1;
      // A note is a real "chord moment" in the composition if and only if it
      // falls on the FIRST step of a bar (src % STEPS_PER_BAR === 0) — that's
      // exactly when arcade-music.js's own playStep() strikes the real backing
      // pad chord for this bar (see `if (cfg.pad && inBar === 0) padChord(...)`
      // — unconditional, every bar, including break bars). Every bar of
      // chImperial's lead has a real melody note at step 0, so this lines the
      // chord candidates up one-to-one with the bar cadence the ear actually
      // hears the pad chord land on — no streak/stride cap needed, since the
      // bar boundary itself paces the chords evenly through the whole song.
      function isChordEligible(src) {
        if (src % STEPS_PER_BAR !== 0) return false;
        return lead[src] != null;
      }
      for (let i = 0; i < kept.length; i++) {
        const k = kept[i];
        let lo = Infinity, hi = -Infinity;
        for (let j = Math.max(0, i - W); j <= Math.min(kept.length - 1, i + W); j++) {
          const p = kept[j].midi; if (p < lo) lo = p; if (p > hi) hi = p;
        }
        let lane = pitchToLane(k.midi, lo, hi, diff.lanes);
        if (lane === prevLane && diff.lanes > 1) {
          lane = lane >= diff.lanes - 1 ? lane - 1 : lane + 1;   // spread consecutive repeats
        }
        prevLane = lane;
        const gold = (k.midi === globalHi);
        const gap = gapAt(k.src);
        const holdEnd = gap >= diff.holdGap ? k.time + Math.min(gap, 10) * stepDur : 0;
        const spend = spendFor(k.midi, lane, gold);
        const icon = iconFor(k.midi, lane, gold);
        const noteType = gold ? 'gold' : (holdEnd ? 'hold' : 'tap');
        const primary = {
          time: k.time, lane, midi: k.midi, spend, icon,
          type: noteType, holdEnd, judged: false, held: false, holdScored: false,
        };
        notes.push(primary);

        // ---- chord expansion (gated by diff.chordSize — Imperial Markup only) --
        // Only plain single-hit taps that are chord-eligible per isChordEligible()
        // above — landing on the bar-start step where the real backing pad chord
        // strikes — expand into a chord; every other step in the bar, plus any
        // gold/hold note, always stays single-lane so those other mechanics stay
        // legible. The extra voice(s) are REAL harmony tones drawn from
        // track.prog (the same chord progression driving the backing pad/bass
        // for this bar), not copies of the melody pitch — see pickHarmonyNotes().
        if (diff.chordSize >= 2 && noteType === 'tap' && isChordEligible(k.src)) {
          const extras = pickHarmonyNotes(track, k, lane, diff.chordSize - 1, lo, hi, diff, notes);
          for (const extra of extras) {
            notes.push(Object.assign({}, primary, {
              lane: extra.lane, midi: extra.midi,
              spend: spendFor(extra.midi, extra.lane, false),
              icon: iconFor(extra.midi, extra.lane, false),
            }));
          }
        }
      }

      // sparse "do-not-hit" traps on Hard, placed on empty grid slots
      if (diff.traps) {
        for (let S = 24; S < noteCut; S += 41) {
          const time = firstStep0 + (startStepAbs + S) * stepDur + lat;
          const lane = (S * 7) % diff.lanes;
          const clash = notes.some(n => n.lane === lane && Math.abs(n.time - time) < 0.14);
          if (!clash) notes.push({ time, lane, midi: 0, type: 'trap', holdEnd: 0, judged: false });
        }
      }

      notes.sort((a, b) => a.time - b.time);
      // end on the loop boundary (a downbeat), just after the last phrase resolves,
      // so the finish feels intentional; the music fades out into this point
      const outroEnd = firstStep0 + (startStepAbs + total) * stepDur + lat + 0.4;
      const lastNote = notes.length ? notes[notes.length - 1].time : firstStep0;
      return { notes, stepDur, endTime: outroEnd, lastNote };
    }

    // ---- start a song -----------------------------------------------------
    // AudioBuffer cache for real-audio songs (assets/*.mp3), keyed by src, so a
    // Retry/replay doesn't re-fetch + re-decode the file every time.
    const audioBufCache = new Map();
    let audioStartToken = 0;   // invalidates an in-flight decode if the player backs out
    function loadAudioBuffer(src) {
      if (audioBufCache.has(src)) return Promise.resolve(audioBufCache.get(src));
      return fetch(src).then((r) => r.arrayBuffer())
        .then((ab) => actx.decodeAudioData(ab))
        .then((buf) => { audioBufCache.set(src, buf); return buf; })
        .catch((err) => { console.error('[CostBotHero] failed to load', src, err); return null; });
    }

    function startSong() {
      initAudio();
      const song = SONGS[songIdx];
      const isAudioSong = !!song.audioSrc;
      // Real-audio songs have no ArcadeMusic.TRACKS entry — the SONGS object
      // itself already carries {bpm, bars, lead}, the same shape buildChart()
      // reads off a synth track, so it can be used as the "track" directly.
      const track = isAudioSong ? song : (global.ArcadeMusic && global.ArcadeMusic.TRACKS[song.key]);
      if (!track) return;
      meta.lastSong = songIdx; meta.lastDiff = diffKey; persist();

      // per-song, per-difficulty tuning (e.g. Imperial Markup's hard, Blind Spend's
      // medium/hard) layers over the shared base difficulty. A song with no
      // override for the current difficulty key falls straight through to the
      // shared DIFFS entry unchanged.
      const diff = Object.assign({}, DIFFS[diffKey], song[diffKey] || {});
      const stepDur = 60 / track.bpm / 4;

      // Shared tail-end of song start, once we know exactly when "step 0" plays
      // (firstStep0) and which step the chart should start from (startStepAbs).
      // Used by both the synth path (anchored to ArcadeMusic's own clock) and
      // the real-audio path (anchored to our own scheduled AudioBufferSourceNode).
      function beginRun(firstStep0, startStepAbs) {
        // shift visuals + judging to when audio is actually heard (output latency),
        // plus the player's own calibration offset (menu-adjustable)
        const lat = (actx.outputLatency || actx.baseLatency || 0.02) + (meta.calibMs || 0) / 1000;

        const chart = buildChart(track, diff, firstStep0, startStepAbs, lat, song.maxLoops);
        // per-song backdrop: one biome + one generated prop set, made once at
        // song start (not per-frame). The highway trapezoid (see geom()) is
        // widest at the bottom and only narrows going up, so it never reaches
        // past its own [x0, x0+w] band at any height; the left gutter is
        // already spoken for by the host + FinOps tip. Confining props to the
        // free right gutter (shifted in from a biome "world" sized to that
        // strip) guarantees they can never cover notes, the host, or the HUD,
        // whatever the density a biome ships with.
        const bio = global.ArcadeBiomes ? global.ArcadeBiomes.get(song.biome) : null;
        let bioProps = [];
        if (global.ArcadeBiomes && bio) {
          const hwy = geom(diff.lanes);
          const gutterX = hwy.x0 + hwy.w + 12;
          const gutterW = Math.max(60, W - gutterX - 8);
          const density = Math.max(5, Math.round((gutterW * H) / 8000));
          const gutterBio = Object.assign({}, bio, { density });
          bioProps = global.ArcadeBiomes.generate(Math.random, gutterW, H, gutterBio)
            .map((p) => Object.assign({}, p, { x: p.x + gutterX }));
        }
        run = {
          song, track, diff, chart,
          // 3-lane drops the leftmost key, same relationship KEYS[3]/KEYS[4]
          // used to encode directly — see meta.laneKeys' comment up top.
          keys: meta.laneKeys.slice(4 - diff.lanes),
          beginTime: firstStep0 + startStepAbs * stepDur + lat,
          beatRef: firstStep0 + lat, beatDur: stepDur * 4,   // for beat-synced visuals
          score: 0, combo: 0, maxCombo: 0, mult: 1,
          bill: 0, tokens: 0,
          counts: { perfect: 0, great: 0, ok: 0, miss: 0, trap: 0 },
          total: chart.notes.filter(n => n.type !== 'trap').length,
          laneFlash: new Array(diff.lanes).fill(0),
          pops: [], parts: [], shake: 0, tint: 0, hostBob: 0, tip: null, tipN: 0, anom: false, flash: null,
          // hot-streak visuals: heat eases toward the current combo tier (see
          // multFor) so notes/highway "catch fire" smoothly rather than
          // snapping in/out at the exact combo thresholds; embers are the
          // ambient sparks that drift up off the highway while heat is up.
          heat: 0, embers: [], emberAcc: 0, emberAcc2: 0,
          failed: false,
          bio, bioProps,
          audioSrcNode: null, audioGain: null,   // set below for real-audio songs
        };
        state = 'count';
        emit('run:start', { song: song.key, diff: diffKey });
      }

      if (isAudioSong) {
        // Real MP3 track: no ArcadeMusic scheduler to anchor against, so decode
        // once (cached) and schedule a plain AudioBufferSourceNode ourselves at a
        // precisely known actx.currentTime. That keeps the SAME clock driving
        // both playback and note judgment as the synth songs (actx.currentTime) —
        // no separate <audio>-element clock to reconcile or drift against, and
        // Web Audio's sample-accurate start() is at least as precise for sync as
        // reading back an <audio> element's currentTime.
        const token = ++audioStartToken;
        loadAudioBuffer(song.audioSrc).then((buf) => {
          if (!buf || token !== audioStartToken) return;   // stale: menu changed / re-started mid-decode
          const gain = actx.createGain(); gain.gain.value = 0.8; gain.connect(master);
          const src = actx.createBufferSource(); src.buffer = buf; src.connect(gain);
          const firstStep0 = actx.currentTime + PREROLL;   // audio + step 0 start together
          src.start(firstStep0);
          beginRun(firstStep0, 0);
          run.audioSrcNode = src; run.audioGain = gain;
        });
      } else {
        // Kick the music off, then read the scheduler's clock to anchor the chart.
        if (music) music.setVolume(0.8);
        if (music) music.playTrack(song.key);

        // Read the anchor on the next frame (start() has run by then).
        requestAnimationFrame(() => {
          let firstStep0, startStepAbs;
          const now = actx.currentTime;
          if (music && music.debug) {
            const d = music.debug();
            const nextTime = d.nextTime || (now + 0.08);
            const step = d.step || 0;
            firstStep0 = nextTime - step * stepDur;              // when step 0 of this loop played
          } else {
            firstStep0 = now + 0.08;
          }
          // first charted step = first whole grid step at least PREROLL ahead
          // (song.preroll overrides the shared default when a song needs more
          // lead-in — see ch_imperial's chord-on-the-downbeat note)
          const preroll = song.preroll || PREROLL;
          startStepAbs = Math.ceil((now + preroll - firstStep0) / stepDur);
          if (startStepAbs < 0) startStepAbs = 0;
          beginRun(firstStep0, startStepAbs);
        });
      }
    }

    // stop whichever audio is backing the current run: the shared ArcadeMusic
    // synth (music.stop()) for the synth-track songs, or our own
    // AudioBufferSourceNode for a real-audio song (see isAudioSong above —
    // no current SONGS entry uses this path, but the plumbing stays generic
    // and reusable for a future one).
    function stopRunAudio(r) {
      if (music) music.stop();
      if (r && r.audioSrcNode) { try { r.audioSrcNode.stop(); } catch {} }
    }

    function endSong() {
      if (!run || state === 'result') return;
      stopRunAudio(run);
      const r = run;
      const c = r.counts;
      const acc = r.total ? (c.perfect + c.great * 0.7 + c.ok * 0.4) / r.total : 0;
      // Grade off the ROUNDED percentage, not the raw fraction — the result
      // screen shows Math.round(acc*100), so e.g. acc=0.947 displays "95%"
      // but raw acc < 0.95 would grade it A, reading as a bug ("got 95%,
      // still A tier?"). Rounding first keeps the grade and the number
      // the player actually sees in agreement at every boundary.
      const accPct = Math.round(acc * 100);
      const grade = r.failed ? 'F'
        : accPct >= 95 ? 'S' : accPct >= 85 ? 'A' : accPct >= 70 ? 'B' : accPct >= 50 ? 'C' : 'D';
      const tokens = Math.max(0, Math.floor(r.score / 250));
      if (global.ArcadeWallet && tokens) global.ArcadeWallet.earn(tokens, 'costbot-hero');

      // record best per song+difficulty. Rank by grade first, score as a
      // tiebreaker within the same grade — score alone isn't safe because a
      // failed run's combo multiplier can out-score a lower-combo clear,
      // which used to let a stale 'F' record survive a later real 'B'/'A'/'S'.
      const GRADE_RANK = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
      if (!meta.records[r.song.key]) meta.records[r.song.key] = {};
      const rec = meta.records[r.song.key];
      const prev = rec[diffKey];
      const better = !prev
        || GRADE_RANK[grade] > GRADE_RANK[prev.grade]
        || (GRADE_RANK[grade] === GRADE_RANK[prev.grade] && r.score > prev.score);
      if (better) rec[diffKey] = { score: r.score, grade, combo: r.maxCombo, acc: accPct };
      meta.plays++; persist();

      // "lesson of the run" — tie the takeaway to how it went. On failure this
      // used to always be the same hardcoded "Budget blown" line; rotates
      // through TIPS now (keyed off meta.plays, not r.tipN — a fast fail can
      // leave r.tipN at 0 every time, which wouldn't rotate at all).
      const missRatio = r.total ? c.miss / r.total : 0;
      const lesson = r.failed
        ? 'Budget blown. ' + TIPS[meta.plays % TIPS.length]
        : missRatio > 0.25
          ? 'Consistency compounds: steady small cuts beat big one-offs.'
          : TIPS[(r.tipN + r.maxCombo) % TIPS.length];
      run.result = { grade, acc: accPct, tokens, best: better, tip: lesson,
        wipeoutShot: r.failed ? pickWipeoutShot() : null,
        victoryShot: r.failed ? null : pickVictoryShot() };
      run.resultAt = performance.now();   // for the crossfade into the results screen
      state = 'result';
      // SONG CLEAR only — a budget-blown fail ending early shouldn't cheer.
      if (!r.failed) { playFanfare(); scheduleFireworks(r); }
      emit('run:end', { song: r.song.key, diff: diffKey });

      const payload = {
        game: 'costbot-hero',
        stageId: r.song.key + ':' + diffKey,
        outcome: r.failed ? 'fail' : 'clear',
        tokensEarned: tokens,
        dollarsSaved: 0,          // fun-first: this cabinet does not save real money
        score: r.score, combo: r.maxCombo, accuracy: accPct,
      };
      try { opts.onComplete && opts.onComplete(payload); } catch {}
    }

    // ---- input ------------------------------------------------------------
    function multFor(combo) { return combo >= 50 ? 8 : combo >= 25 ? 4 : combo >= 10 ? 2 : 1; }

    function judgeHit(lane) {
      if (!run || state !== 'play') return;   // never during countdown/result/menu
      const now = actx.currentTime;
      run.laneFlash[lane] = 1;
      // nearest unjudged note in this lane within the OK window
      let best = null, bestDt = 0.15;
      for (const n of run.chart.notes) {
        if (n.judged || n.lane !== lane) continue;
        const dt = Math.abs(n.time - now);
        if (dt < bestDt) { bestDt = dt; best = n; }
        if (n.time - now > 0.16) break; // sorted; nothing closer ahead
      }
      if (!best) {
        // A press with nothing to score in ITS OWN lane is a mistake — but which
        // kind depends on whether some OTHER lane genuinely has a live note right
        // now. Traps don't count (they're meant to be avoided, not hit) and
        // already-judged notes don't count, so this can't misfire against a
        // chord note a different lane-press already legitimately scored, and
        // can't collide with the separate trap-penalty path above.
        let otherLive = false;
        for (const n of run.chart.notes) {
          if (n.judged || n.lane === lane || n.type === 'trap') continue;
          if (Math.abs(n.time - now) < 0.15) { otherLive = true; break; }
        }
        run.combo = 0; run.mult = 1;
        run.tint = Math.max(0, run.tint - 0.15);
        if (otherLive) {
          // "the wrong key at the right time" — scaled below a full miss, but a
          // real, felt cost so mashing every lane stops being a free strategy.
          run.bill = clamp(run.bill + run.diff.missCost * 0.6, 0, BILL_MAX);
          pop(run, lane, JUDGE.wrongLane, '#ff8a5c'); SFX.wrongLane();
        } else {
          // "hitting the key at the wrong time" — the lightest of the three
          // miss-family penalties, since nothing was on-screen to react to.
          run.bill = clamp(run.bill + run.diff.missCost * 0.4, 0, BILL_MAX);
          pop(run, lane, JUDGE.mistimed, '#7d8aa8'); SFX.mistimed();
        }
        checkFail();
        return;
      }

      if (best.type === 'trap') {
        best.judged = true; run.counts.trap++; run.combo = 0; run.mult = 1;
        run.bill = clamp(run.bill + 14, 0, BILL_MAX);
        pop(run, lane, JUDGE.trap, '#ff5d6c'); shake(run, 10); SFX.trap();
        checkFail(); return;
      }

      const j = bestDt <= 0.045 ? 'perfect' : bestDt <= 0.09 ? 'great' : 'ok';
      const base = j === 'perfect' ? 150 : j === 'great' ? 90 : 40;
      const goldX = best.type === 'gold' ? 3 : 1;
      run.combo++; run.maxCombo = Math.max(run.maxCombo, run.combo);
      const newMult = multFor(run.combo);
      if (newMult > run.mult) { run.mult = newMult; SFX.combo(); }
      run.mult = newMult;
      if (COMBO_CALLS[run.combo]) {
        run.callout = { text: COMBO_CALLS[run.combo], life: 1.4 }; shake(run, 6);
        // teach on a good streak — alternate a vendor tip (for the lane you cut) and a general one
        showTip(run, (run.tipN++ % 2 === 0) ? VENDOR_TIPS[lane] : TIPS[run.tipN % TIPS.length]);
      }
      // Every x50 milestone (50, 100, 150, ...) gets the big moment: a harder
      // shake + the full-screen CB-T1000 flash, same trick as Waste Hunter's
      // "Terminate All" nuke pickup. Independent of COMBO_CALLS above, which
      // only has callout text for 10/25/50 — this re-fires every 50 regardless.
      if (run.combo > 0 && run.combo % 50 === 0) { shake(run, 16); run.flash = { life: 1.2, max: 1.2 }; }
      let gain = base * run.mult * goldX;
      if (anomOn(now)) gain = Math.round(gain * 1.5);   // anomaly finale: cuts pay more
      run.score += gain;
      run.counts[j]++;
      run.bill = clamp(run.bill - (j === 'perfect' ? 2 : j === 'great' ? 1 : 0), 0, BILL_MAX);
      run.tint = Math.min(1, run.tint + 0.12);

      const label = best.type === 'gold' ? '💰 SAVINGS PLAN' : JUDGE[j];
      pop(run, lane, label + '  +' + fmt$(gain), best.type === 'gold' ? '#ffd76a' : LANE_COLOR(run, lane));
      burst(run, lane, best.type === 'gold' ? 22 : j === 'perfect' ? 14 : 8);
      if (best.type === 'gold') { SFX.gold(); showTip(run, PLAN_TIPS[run.tipN++ % PLAN_TIPS.length]); }
      else SFX[j]();
      if (j === 'perfect') shake(run, 4);

      if (best.type === 'hold') { best.held = true; best.judged = true; }
      else best.judged = true;
    }

    function laneDown(lane) {
      if (state === 'play') { judgeHit(lane); return; }
    }
    function laneUp(lane) {
      if (!run) return;
      // releasing a hold: if released well before the tail, it just stops early.
      for (const n of run.chart.notes) if (n.type === 'hold' && n.held && n.lane === lane) n.held = false;
    }

    // keyboard
    function onKey(down, e) {
      const k = (e.key || '').toLowerCase();
      // Rebind-listening intercepts everything, including 'm' — a rebind
      // target IS allowed to be checked against the reserved list (which
      // rejects 'm'), so it must reach tryRebindLane rather than mute first.
      if (rebindLane !== null) {
        if (!down) return;
        e.preventDefault();
        if (k === 'escape') { stopListening(); return; }
        tryRebindLane(rebindLane, k);
        return;
      }
      if (down && k === 'm') { toggleMute(); return; }   // mute hotkey, any state
      // Overlay open but no lane armed yet: swallow input so it can't leak
      // through to song/difficulty nav underneath; Escape closes it.
      if (rebindOpen) {
        if (down && k === 'escape') closeRebindOverlay();
        return;
      }
      if (state === 'menu') {
        if (!down) return;
        if (k === 'arrowup' || k === 'arrowdown') {
          const vis = menuSongs();
          if (!vis.length) return;   // search matched nothing — nothing to move to
          let i = vis.indexOf(SONGS[songIdx]);
          if (i === -1) i = 0;
          i = (i + vis.length + (k === 'arrowup' ? -1 : 1)) % vis.length;
          songIdx = SONGS.indexOf(vis[i]); SFX.ui();
        } else if (k === 'arrowleft' || k === 'arrowright') {
          const order = diffOrder();
          const i = order.indexOf(diffKey) + (k === 'arrowright' ? 1 : -1);
          diffKey = order[clamp(i, 0, order.length - 1)]; SFX.ui();
        } else if (k === '[' || k === ']') {
          meta.calibMs = clamp((meta.calibMs || 0) + (k === ']' ? 5 : -5), -300, 300); persist(); SFX.ui();
        } else if (k === 'enter' || k === ' ') { e.preventDefault(); startSong(); }
        syncMenu();
        return;
      }
      if (state === 'result') {
        if (!down) return;
        if (k === 'enter' || k === ' ') { startSong(); }
        else if (k === 'escape' || k === 'backspace') { state = 'menu'; run = null; }
        return;
      }
      if (state === 'play' || state === 'count') {
        if (k === 'escape') { stopRunAudio(run); state = 'menu'; run = null; emit('run:end', {}); return; }
        if (!run) return;
        const lane = run.keys.indexOf(k);
        if (lane === -1) return;
        e.preventDefault();
        if (down) { if (!keysDown.has(k)) { keysDown.add(k); laneDown(lane); } }
        else { keysDown.delete(k); laneUp(lane); }
      }
    }
    function onKeyDown(e) { onKey(true, e); }
    function onKeyUp(e) { onKey(false, e); }
    global.addEventListener('keydown', onKeyDown);
    global.addEventListener('keyup', onKeyUp);

    // pointer / touch
    function laneAt(x) {
      if (!run) return -1;
      const g = geom(run.diff.lanes);
      if (x < g.x0 || x > g.x0 + g.w) return -1;
      return clamp(Math.floor((x - g.x0) / g.lw), 0, run.diff.lanes - 1);
    }
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      const x = e.offsetX, y = e.offsetY;
      if (state === 'result') { handleResultClick(x, y); return; }
      if (state === 'play') {
        const lane = laneAt(x);
        if (lane !== -1) { pointers.set(e.pointerId, lane); laneDown(lane); }
      }
    });
    cv.addEventListener('pointerup', (e) => {
      const lane = pointers.get(e.pointerId);
      if (lane != null) { laneUp(lane); pointers.delete(e.pointerId); }
    });
    cv.addEventListener('pointercancel', (e) => {
      const lane = pointers.get(e.pointerId);
      if (lane != null) { laneUp(lane); pointers.delete(e.pointerId); }
    });

    // ---- juice helpers ----
    function LANE_COLOR(_r, l) { return PALETTE[l % PALETTE.length]; }
    function pop(r, lane, text, color, dy) {
      const g = geom(r.diff.lanes);
      r.pops.push({ x: g.x0 + g.lw * (lane + 0.5), y: hitY() + (dy || -30), text, color, life: 1 });
    }
    // Tips now rotate under the host in the left gutter (see drawHost); the old
    // event-driven top-of-screen popups were removed. Kept as a no-op so the
    // call sites (combos, gold notes, holds, anomaly) still read cleanly.
    function showTip() {}
    function burst(r, lane, n) {
      const g = geom(r.diff.lanes);
      const cx = g.x0 + g.lw * (lane + 0.5);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI - Math.PI / 2;
        r.parts.push({ x: cx, y: hitY(), vx: Math.cos(a) * (60 + Math.random() * 160),
          vy: -Math.abs(Math.sin(a)) * (120 + Math.random() * 200) - 40,
          life: 1, color: PALETTE[lane % PALETTE.length] });
      }
    }
    function shake(r, amt) { r.shake = Math.min(16, r.shake + amt); }
    function checkFail() { if (run && run.bill >= BILL_MAX) { run.failed = true; endSong(); } }

    // ---- SONG CLEAR fireworks ------------------------------------------------
    // Same r.parts array/physics the hit-bursts already use (see burst() above)
    // — a full 360° radial spray instead of burst()'s upward-biased one, and
    // not anchored to a lane, so a firework can land anywhere on the canvas.
    const FIREWORK_COLORS = PALETTE.concat(['#ffd76a', '#ffffff', '#ff6ec7']);
    // size/firework/decay are per-particle so this shares run.parts' physics
    // with the plain hit-bursts (burst() above) without changing their look:
    // a hit-burst particle has no `size`/`firework`/`decay` set, so it falls
    // through to the existing defaults everywhere those are read.
    function spawnFirework(r, x, y) {
      const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
      const n = 46 + Math.floor(Math.random() * 20);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 90 + Math.random() * 260;
        r.parts.push({
          x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1, color,
          size: 6 + Math.random() * 4, firework: true, decay: 0.7,
        });
      }
    }
    // Queues a scattered fireworks show rather than one simultaneous flash: a
    // handful to a couple-dozen bursts at random screen positions, staggered
    // over ~4.5s so it reads as an ongoing celebration. r.fireworks is drained
    // in update(dt) (see the "decay effects" block, which already runs
    // whenever a run exists, result screen included) so this keeps firing
    // after endSong() has already switched state to 'result'.
    // Count scales with the run's grade (set on r.result just before this is
    // called — see endSong()) so a clean S-tier run gets the full show (19,
    // same count as before this became grade-scaled) while lower grades get a
    // progressively smaller one — still a celebration for clearing the song,
    // just not the fireworks a top run earned.
    const FIREWORK_COUNTS = { S: 19, A: 14, B: 10, C: 6, D: 3 };
    function scheduleFireworks(r) {
      r.fireworks = [];
      r.fireworksElapsed = 0;
      const grade = r.result && r.result.grade;
      const count = FIREWORK_COUNTS[grade] != null ? FIREWORK_COUNTS[grade] : 10;
      for (let i = 0; i < count; i++) {
        r.fireworks.push({
          t: (i / count) * 4.5 + Math.random() * 0.25,
          x: W * (0.08 + Math.random() * 0.84),
          y: H * (0.1 + Math.random() * 0.45),
        });
      }
      r.fireworks.sort((a, b) => a.t - b.t);
    }
    // the final ~12s of notes are a "cost anomaly" — cuts pay 1.5x, misses hurt more
    const ANOM_LEN = 12;
    function anomOn(now) { return !!(run && run.chart && now >= run.chart.lastNote - ANOM_LEN && now < run.chart.lastNote + 0.3); }

    // ---- geometry ----
    function geom(lanes) {
      const w = Math.min(W * 0.9, 560);
      const x0 = (W - w) / 2;
      return { x0, w, lw: w / lanes };
    }
    function hitY() { return H - 118; }

    // =====================================================================
    // update + draw
    // =====================================================================
    let last = performance.now();
    let raf = 0;
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      update(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }

    function update(dt) {
      if (state === 'count' && run) {
        if (actx.currentTime >= run.beginTime - 0.02) {
          state = 'play';
          // Anchor the moment play actually begins. If the frame loop was
          // throttled (background tab) the audio clock may already be well past
          // beginTime; notes before this instant were never the player's to hit,
          // so they are retired silently rather than counted as misses.
          run.playStart = actx.currentTime; run.lastNow = run.playStart;
          for (const n of run.chart.notes) {
            if (n.time < run.playStart - 0.02) { n.judged = true; if (n.type === 'hold') n.holdScored = true; }
          }
        }
      }
      if (!run) return;
      const now = actx ? actx.currentTime : 0;

      if (state === 'play') {
        // cost-anomaly finale kicks in for the last stretch of notes
        if (!run.anom && anomOn(now)) {
          run.anom = true;
          run.callout = { text: '⚠ COST ANOMALY', life: 2.2 }; shake(run, 9);
          showTip(run, 'Anomaly detection catches runaway spend before it compounds.');
        }
        // A jump in the audio clock means the frame loop stalled — the tab was
        // backgrounded or throttled. Notes that passed during a stall were never the
        // player's to hit, so retire them silently instead of raining down misses.
        // Frame gaps are ~16ms at 60fps (even ~100ms on a weak machine), so this
        // 0.25s floor never trips in real play — only when frames actually stop.
        const gap = now - (run.lastNow != null ? run.lastNow : now);
        run.lastNow = now;
        if (gap > 0.25) {
          for (const n of run.chart.notes) {
            if (!n.judged && n.time < now - 0.02) { n.judged = true; if (n.type === 'hold') n.holdScored = true; }
          }
        } else {
          // misses: unjudged real notes that fell past the window
          for (const n of run.chart.notes) {
            if (state !== 'play') break;   // a fail ended the run mid-scan
            if (n.judged) continue;
            if (n.type === 'trap') { if (now - n.time > 0.15) n.judged = true; continue; } // avoided = good
            if (now - n.time > 0.15) {
              n.judged = true; run.counts.miss++; run.combo = 0; run.mult = 1;
              run.bill = clamp(run.bill + run.diff.missCost * (anomOn(now) ? 1.5 : 1), 0, BILL_MAX);
              run.tint = Math.max(0, run.tint - 0.2);
              pop(run, n.lane, JUDGE.miss, '#7d8aa8'); SFX.miss(); checkFail();
            }
          }
        }
        // hold completion
        for (const n of run.chart.notes) {
          if (n.type === 'hold' && n.judged && !n.holdScored && now >= n.holdEnd) {
            n.holdScored = true;
            // hold bonus scales with how long it was held, so long holds pay off
            if (n.held) { const secs = n.holdEnd - n.time; const g = Math.round((60 + secs * 90) * run.mult / 5) * 5; run.score += g; pop(run, n.lane, 'COMMITMENT +' + fmt$(g), '#8fe'); burst(run, n.lane, 10); SFX.great(); showTip(run, PLAN_TIPS[run.tipN++ % PLAN_TIPS.length]); }
          }
        }
        // fade the music out over the final ~2.8s so the song doesn't cut abruptly
        if (now > run.chart.endTime - 2.8) {
          const vol = 0.8 * clamp((run.chart.endTime - now) / 2.8, 0, 1);
          if (music) music.setVolume(vol);
          if (run.audioGain) run.audioGain.gain.value = vol;
        }
        if (now > run.chart.endTime) { endSong(); }
      }

      // decay effects
      for (let i = 0; i < run.laneFlash.length; i++) run.laneFlash[i] = Math.max(0, run.laneFlash[i] - dt * 4);
      run.shake = Math.max(0, run.shake - dt * 40);
      run.tint = Math.max(0, run.tint - dt * 0.25);
      run.hostBob += dt * (2 + run.combo * 0.05);
      for (const p of run.pops) { p.life -= dt * 1.2; p.y -= dt * 34; }
      run.pops = run.pops.filter(p => p.life > 0);
      if (run.callout) { run.callout.life -= dt; if (run.callout.life <= 0) run.callout = null; }
      if (run.flash) { run.flash.life -= dt; if (run.flash.life <= 0) run.flash = null; }
      if (run.tip) { run.tip.life -= dt; if (run.tip.life <= 0) run.tip = null; }
      for (const p of run.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 640 * dt; p.life -= dt * (p.decay || 1.3); }
      run.parts = run.parts.filter(p => p.life > 0);
      if (run.fireworks && run.fireworks.length) {
        run.fireworksElapsed += dt;
        while (run.fireworks.length && run.fireworks[0].t <= run.fireworksElapsed) {
          const fw = run.fireworks.shift();
          spawnFirework(run, fw.x, fw.y);
        }
      }

      // hot-streak heat: eased toward the CURRENT combo tier (not the peak),
      // so a miss that resets run.mult back to 1 cools the highway back down
      // instead of leaving it permanently on fire after one good streak.
      const heatTarget = run.mult >= 8 ? 1 : run.mult >= 4 ? 0.6 : run.mult >= 2 ? 0.28 : 0;
      run.heat += (heatTarget - run.heat) * clamp(dt * 2.5, 0, 1);
      // fever tier: a small constant tremor on top of the normal hit/combo
      // shake, so the screen stays visibly "alive" the whole time you're at
      // ×8 instead of only jolting on individual hits.
      if (run.mult >= 8 && state === 'play') run.shake = Math.max(run.shake, 2.2);
      if (run.heat > 0.02 && state === 'play') {
        run.emberAcc += dt * (5 + run.heat * 30);
        while (run.emberAcc > 1) {
          run.emberAcc -= 1;
          const g = geom(run.diff.lanes);
          run.embers.push({
            x: g.x0 + Math.random() * g.w, y: hitY() + Math.random() * 18 - 6,
            vx: (Math.random() - 0.5) * 22, vy: -(50 + Math.random() * 90 + run.heat * 90),
            life: 1, maxLife: 0.7 + Math.random() * 0.8, sway: Math.random() * 6.283,
            r: (1.6 + Math.random() * 2.6) * (0.5 + run.heat),
          });
        }
        // fever tier (top combo): the WHOLE screen catches, not just the
        // highway — embers rise off the bottom edge across the full width,
        // the "cabinet itself is on fire" payoff for reaching ×8.
        if (run.mult >= 8) {
          run.emberAcc2 += dt * 14;
          while (run.emberAcc2 > 1) {
            run.emberAcc2 -= 1;
            run.embers.push({
              x: Math.random() * W, y: H + Math.random() * 20,
              vx: (Math.random() - 0.5) * 14, vy: -(70 + Math.random() * 120),
              life: 1, maxLife: 1.1 + Math.random() * 0.9, sway: Math.random() * 6.283,
              r: 1.8 + Math.random() * 3,
            });
          }
        }
      }
      for (const e of run.embers) {
        e.x += e.vx * dt + Math.sin(performance.now() / 1000 + e.sway) * 6 * dt;
        e.y += e.vy * dt;
        e.life -= dt / e.maxLife;
      }
      run.embers = run.embers.filter(e => e.life > 0);
    }

    function draw() {
      ctx2d.clearRect(0, 0, W, H);
      // background — an in-progress run with a loaded biome gets that song's
      // distinct backdrop; the menu (and any biome-less fallback) keeps the
      // original flat space gradient + starfield.
      if (run && run.bio) {
        drawBiomeBackground(run.bio, run.bioProps);
        drawStars(true);
      } else {
        const bg = ctx2d.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0a0f22'); bg.addColorStop(1, '#05060f');
        ctx2d.fillStyle = bg; ctx2d.fillRect(0, 0, W, H);
        drawStars(false);
      }
      drawSongArt();   // per-song full-canvas wallpaper art, over the wash, if any

      if (state === 'menu') {
        if (menuEl) { menuEl.style.display = 'flex'; if (!wasMenu) { syncMenu(); wasMenu = true; } }
        return;
      }
      if (menuEl && wasMenu) { menuEl.style.display = 'none'; wasMenu = false; }
      if (!run) return;

      ctx2d.save();
      if (run.shake > 0) ctx2d.translate((Math.random() - 0.5) * run.shake, (Math.random() - 0.5) * run.shake);
      drawHighway();
      drawFlash();   // x50-combo CB-T1000 flash, over the highway
      if (state === 'result') drawResult();
      drawFireworks();   // on top of the result panel, not under it
      ctx2d.restore();

      if (state === 'count') drawCountdown();
      drawHud();
      drawOverlay();
    }

    // CRT arcade vibe: a soft vignette + scanlines over everything
    function drawOverlay() {
      const vg = ctx2d.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.32, W / 2, H * 0.5, Math.max(W, H) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx2d.fillStyle = vg; ctx2d.fillRect(0, 0, W, H);
      ctx2d.fillStyle = 'rgba(0,0,0,0.10)';
      for (let y = 0; y < H; y += 3) ctx2d.fillRect(0, y, W, 1);
    }

    // ---- highway ----
    function drawHighway() {
      const g = geom(run.diff.lanes), hy = hitY();
      const nowB = actx.currentTime;
      const phase = run.beatDur ? ((((nowB - run.beatRef) / run.beatDur) % 1) + 1) % 1 : 0;
      const pulse = (1 - phase) * (1 - phase);   // 1 right on the beat, decays
      const fall = run.diff.fall, laneN = run.diff.lanes;
      const HZ = 96, NARROW = 0.34;              // horizon y and its width factor there
      // perspective: f is time-progress (1 at spawn/far, 0 at the line/near)
      const scaleAt = (f) => { f = clamp(f, 0, 1.15); return NARROW / (NARROW + f * (1 - NARROW)); };
      const yAt = (s) => hy + (HZ - hy) * ((1 - s) / (1 - NARROW));
      const pxp = (fx, s) => W / 2 + (fx - W / 2) * s;
      const cxFull = (lane) => g.x0 + g.lw * (lane + 0.5);
      const edgeFull = (i) => g.x0 + g.lw * i;
      const topEdge = (i) => pxp(edgeFull(i), NARROW);

      // greener glow with the streak
      if (run.tint > 0) {
        ctx2d.fillStyle = 'rgba(57,217,138,' + (run.tint * 0.10).toFixed(3) + ')';
        ctx2d.fillRect(0, 0, W, H);
      }
      // lane bodies as converging trapezoids toward the vanishing line
      for (let i = 0; i < laneN; i++) {
        const grad = ctx2d.createLinearGradient(0, HZ, 0, hy);
        grad.addColorStop(0, 'rgba(255,255,255,0.02)');
        grad.addColorStop(1, hexA(PALETTE[i], 0.10 + run.laneFlash[i] * 0.4));
        ctx2d.fillStyle = grad;
        ctx2d.beginPath();
        ctx2d.moveTo(edgeFull(i), hy + 40); ctx2d.lineTo(edgeFull(i + 1), hy + 40);
        ctx2d.lineTo(topEdge(i + 1), HZ); ctx2d.lineTo(topEdge(i), HZ);
        ctx2d.closePath(); ctx2d.fill();
      }
      // converging dividers
      ctx2d.strokeStyle = 'rgba(150,175,255,.12)'; ctx2d.lineWidth = 1;
      for (let i = 0; i <= laneN; i++) {
        ctx2d.beginPath(); ctx2d.moveTo(edgeFull(i), hy + 40); ctx2d.lineTo(topEdge(i), HZ); ctx2d.stroke();
      }

      // beat grid — perspective rungs that ride down in time with the music
      const b0 = Math.floor((nowB - run.beatRef) / run.beatDur);
      for (let b = b0; b < b0 + 24; b++) {
        const bt = run.beatRef + b * run.beatDur;
        const f = (bt - nowB) / fall;
        if (f < 0 || f > 1.02) continue;
        const s = scaleAt(f), y = yAt(s);
        const down = (((b % 4) + 4) % 4) === 0;
        ctx2d.strokeStyle = down ? 'rgba(150,175,255,.18)' : 'rgba(150,175,255,.06)';
        ctx2d.lineWidth = down ? 1.3 : 1;
        ctx2d.beginPath(); ctx2d.moveTo(pxp(g.x0, s), y); ctx2d.lineTo(pxp(g.x0 + g.w, s), y); ctx2d.stroke();
      }

      // pulsing horizon glow at the vanishing line
      const hg = ctx2d.createLinearGradient(0, HZ - 26, 0, HZ + 90);
      hg.addColorStop(0, 'rgba(124,92,255,0)');
      hg.addColorStop(0.35, 'rgba(124,92,255,' + (0.16 + pulse * 0.18).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(124,92,255,0)');
      ctx2d.fillStyle = hg;
      ctx2d.fillRect(pxp(g.x0, NARROW), HZ - 26, pxp(g.x0 + g.w, NARROW) - pxp(g.x0, NARROW), 116);

      // hit line + key targets — glows on the beat
      ctx2d.strokeStyle = '#ffffff'; ctx2d.globalAlpha = 0.35 + pulse * 0.4;
      ctx2d.lineWidth = 2 + pulse * 3; ctx2d.shadowColor = '#9db4ff'; ctx2d.shadowBlur = 6 + pulse * 16;
      ctx2d.beginPath(); ctx2d.moveTo(g.x0, hy); ctx2d.lineTo(g.x0 + g.w, hy); ctx2d.stroke();
      ctx2d.shadowBlur = 0; ctx2d.globalAlpha = 1;
      for (let i = 0; i < run.diff.lanes; i++) {
        const cx = g.x0 + g.lw * (i + 0.5);
        const down = keysDown.has(run.keys[i]) || [...pointers.values()].includes(i);
        ctx2d.strokeStyle = PALETTE[i]; ctx2d.lineWidth = 3;
        ctx2d.fillStyle = down ? hexA(PALETTE[i], 0.6) : hexA(PALETTE[i], 0.12 + run.laneFlash[i] * 0.5);
        rrect(cx - g.lw * 0.4, hy - 20, g.lw * 0.8, 40, 9); ctx2d.fill(); ctx2d.stroke();
        ctx2d.fillStyle = down ? '#06121a' : '#dfe8f7'; ctx2d.textAlign = 'center';
        ctx2d.font = '800 16px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(run.keys[i].toUpperCase(), cx, hy + 6);
        // vendor logo + name, below the target (out of the note path)
        const vlabel = VENDORS[i].toUpperCase();
        const base = hy + 44;
        ctx2d.font = '800 10px Segoe UI, system-ui, sans-serif';
        const tw = ctx2d.measureText(vlabel).width;
        const bs = 16, gp = 5, gw = bs + gp + tw, gx = cx - gw / 2;
        const icon = VENDOR_ICONS[i];
        if (icon) {
          // real vendor logo (from mudslides), drawn in the lane colour
          ctx2d.save();
          ctx2d.translate(gx + bs / 2, base - 5);
          ctx2d.scale(bs / 24, bs / 24);
          ctx2d.translate(-12, -12);
          ctx2d.fillStyle = PALETTE[i];
          ctx2d.fill(icon);
          ctx2d.restore();
        } else {
          // AWS has no logo in the set — a brand-coloured chip with a monogram
          ctx2d.fillStyle = PALETTE[i]; rrect(gx, base - 13, bs, bs, 4); ctx2d.fill();
          ctx2d.fillStyle = '#06121a'; ctx2d.textAlign = 'center';
          ctx2d.font = '800 11px Segoe UI, system-ui, sans-serif';
          ctx2d.fillText(BADGES[i], gx + bs / 2, base - 1);
        }
        // name
        ctx2d.textAlign = 'left'; ctx2d.fillStyle = hexA(PALETTE[i], 0.95);
        ctx2d.font = '800 10px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(vlabel, gx + bs + gp, base);
      }

      // notes — projected in perspective, drawn far -> near so nearer ones overlap
      const now = actx.currentTime;
      const vis = [];
      for (const n of run.chart.notes) {
        if (n.type === 'hold') { if (n.holdEnd - now < -0.12 || n.time - now > fall + 0.05) continue; }
        else { if (n.judged || n.time - now > fall + 0.05 || now - n.time > 0.2) continue; }
        vis.push(n);
      }
      vis.sort((a, b) => b.time - a.time);

      // chord link: when 2+ visible notes share the exact same `time` (a chord),
      // draw a soft connecting bar behind them so they read as "these cross the
      // line together" rather than as unrelated notes that happen to line up.
      const chordGroups = new Map();
      for (const n of vis) {
        if (n.type === 'trap') continue;
        const arr = chordGroups.get(n.time); if (arr) arr.push(n); else chordGroups.set(n.time, [n]);
      }
      for (const arr of chordGroups.values()) {
        if (arr.length < 2) continue;
        const ct = arr[0].time;
        const f = (ct - now) / fall;
        const s = scaleAt(f), y = yAt(s);
        let minC = Infinity, maxC = -Infinity;
        for (const n of arr) { const ccx = pxp(cxFull(n.lane), s); if (ccx < minC) minC = ccx; if (ccx > maxC) maxC = ccx; }
        const rH = 26 * s + 3;
        const lg = ctx2d.createLinearGradient(minC, 0, maxC, 0);
        lg.addColorStop(0, hexA(PALETTE[arr[0].lane], 0.4));
        lg.addColorStop(1, hexA(PALETTE[arr[arr.length - 1].lane], 0.4));
        ctx2d.fillStyle = lg;
        ctx2d.fillRect(minC, y - rH * 0.22, maxC - minC, rH * 0.44);
      }

      for (const n of vis) {
        const f = (n.time - now) / fall;
        const s = scaleAt(f), y = yAt(s);
        const cx = pxp(cxFull(n.lane), s);
        const rW = g.lw * 0.72 * s, rH = 26 * s + 3;

        if (n.type === 'hold') {
          const ft = (n.holdEnd - now) / fall;
          const st = scaleAt(ft), yt = yAt(st), tcx = pxp(cxFull(n.lane), st);
          const th = g.lw * 0.72 * st * 0.32;
          ctx2d.fillStyle = hexA(PALETTE[n.lane], n.held ? 0.6 : 0.3);
          ctx2d.beginPath();
          ctx2d.moveTo(cx - rW * 0.32, Math.min(y, hy)); ctx2d.lineTo(cx + rW * 0.32, Math.min(y, hy));
          ctx2d.lineTo(tcx + th, yt); ctx2d.lineTo(tcx - th, yt);
          ctx2d.closePath(); ctx2d.fill();
          if (n.judged) continue;
        }

        if (n.type === 'trap') {
          ctx2d.fillStyle = '#2a0b10'; ctx2d.strokeStyle = '#ff5d6c'; ctx2d.lineWidth = 2;
          rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.fill(); ctx2d.stroke();
          if (s > 0.55) {
            ctx2d.fillStyle = '#ff5d6c'; ctx2d.textAlign = 'center';
            ctx2d.font = '800 ' + Math.round(16 * s) + 'px Segoe UI'; ctx2d.fillText('✕', cx, y + 5 * s);
          }
        } else {
          const gold = n.type === 'gold';
          // The note's OWN colour never changes with heat — lane identity has
          // to stay readable at ×8 combo, not wash into one orange blob. Only
          // a SEPARATE "glow" colour escalates toward flame-orange; it drives
          // the aura/trail/shadow below, never the fill.
          const col = gold ? '#ffd76a' : PALETTE[n.lane];
          const glowCol = (!gold && run.heat > 0.02) ? blendHex(col, '#ff5a1e', Math.min(0.8, run.heat * 0.85)) : col;
          // fire flicker: once heat is present, pulses the glow so hot notes
          // read as visibly alive/burning rather than a static tinted colour
          // (each note flickers slightly out of phase via lane+time offsets).
          const flick = run.heat > 0.02 ? 0.78 + 0.22 * Math.sin(now * 13 + n.lane * 2.4 + n.time * 11) : 1;

          // heat aura: a soft radial glow BEHIND the note, escalating with the
          // combo tier — this is where "hotter" shows up, not in the fill.
          if (!gold && run.heat > 0.05) {
            const auraR = (rW * 0.8 + run.heat * rW * 0.9) * flick;
            const ag = ctx2d.createRadialGradient(cx, y, 0, cx, y, auraR);
            ag.addColorStop(0, hexA(glowCol, 0.32 * run.heat));
            ag.addColorStop(1, hexA(glowCol, 0));
            ctx2d.fillStyle = ag;
            ctx2d.beginPath(); ctx2d.arc(cx, y, auraR, 0, 6.283); ctx2d.fill();
          }

          const tlen = (82 + run.heat * 26) * s;      // comet trail toward the horizon, longer while hot
          const tg = ctx2d.createLinearGradient(0, y - tlen, 0, y);
          tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, hexA(glowCol, 0.30 + run.heat * 0.15));
          ctx2d.fillStyle = tg; ctx2d.fillRect(cx - rW * 0.24, y - tlen, rW * 0.48, tlen);
          ctx2d.shadowColor = glowCol;
          ctx2d.shadowBlur = (gold ? 22 : (9 + run.heat * 20) * flick) * s;
          // gem-style vertical gradient (bright facet on top, saturated colour
          // at the base) instead of a flat fill, plus a thin dark outline for
          // contrast — reads more like a polished gem than a solid-colour pill.
          // Highlight blends toward the note's OWN colour, never glowCol, so
          // lane identity survives at any heat.
          const gemTop = blendHex(col, '#ffffff', gold ? 0.55 : 0.32);
          const gg = ctx2d.createLinearGradient(0, y - rH / 2, 0, y + rH / 2);
          gg.addColorStop(0, gemTop); gg.addColorStop(1, col);
          ctx2d.fillStyle = gg; rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.fill();
          ctx2d.shadowBlur = 0;
          ctx2d.strokeStyle = 'rgba(6,12,22,.5)'; ctx2d.lineWidth = Math.max(1, 1.3 * s);
          rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.stroke();
          if (gold) {                                // gold rim marks the bonus note
            ctx2d.strokeStyle = '#ffd76a'; ctx2d.lineWidth = Math.max(1.5, 2.6 * s);
            rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.stroke();
          }
          // flame cap: once heat crosses into the top half of its range
          // (roughly combo ×4+), ONE continuous flame licks along the full
          // top edge of the note. Two layers — a wider dim-orange envelope
          // and a narrower bright core sitting on top — drawn with additive
          // ('lighter') blending, which is what actually reads as "fire":
          // plain alpha-blended overlapping orange just muddies into brown,
          // additive brightens instead, and the two-tone (orange body / hot
          // core) is what real flame silhouettes look like.
          if (!gold && run.heat > 0.5) {
            const capT = Math.min(1, (run.heat - 0.5) / 0.5);
            const flameW = rW * 0.94;
            const baseY = y - rH / 2 + 1;
            const seed = n.lane * 2.7 + n.time * 4.1;

            const flamePath = (w, h, seedOff) => {
              const segs = 16;
              ctx2d.beginPath();
              ctx2d.moveTo(cx - w / 2, baseY);
              for (let i = 0; i <= segs; i++) {
                const t = i / segs;
                const px = cx - w / 2 + w * t;
                const env = Math.sin(t * Math.PI);   // tapers to points at both corners
                const flick = 0.55
                  + 0.30 * Math.sin(now * 11 + seed + seedOff + t * 9)
                  + 0.20 * Math.sin(now * 23 + seed * 1.6 + seedOff + t * 21);
                ctx2d.lineTo(px, baseY - h * env * Math.max(0.25, flick));
              }
              ctx2d.lineTo(cx + w / 2, baseY);
              ctx2d.closePath();
            };

            ctx2d.save();
            ctx2d.globalCompositeOperation = 'lighter';

            const outerH = (14 + capT * 16) * s;
            flamePath(flameW, outerH, 0);
            const og = ctx2d.createLinearGradient(0, baseY - outerH, 0, baseY);
            og.addColorStop(0, 'rgba(255,150,50,' + (0.05 * capT).toFixed(3) + ')');
            og.addColorStop(1, 'rgba(255,80,20,' + (0.55 * capT).toFixed(3) + ')');
            ctx2d.fillStyle = og; ctx2d.fill();

            const innerH = outerH * 0.68;
            flamePath(flameW * 0.6, innerH, 1.9);
            const ig = ctx2d.createLinearGradient(0, baseY - innerH, 0, baseY);
            ig.addColorStop(0, 'rgba(255,244,190,' + (0.1 * capT).toFixed(3) + ')');
            ig.addColorStop(1, 'rgba(255,170,60,' + (0.6 * capT).toFixed(3) + ')');
            ctx2d.fillStyle = ig; ctx2d.fill();

            ctx2d.restore();
          }
          ctx2d.fillStyle = gold ? '#ffe9a8' : 'rgba(255,255,255,.85)';
          rrect(cx - rW / 2, y - rH / 2, rW, 4 * s + 1, 2); ctx2d.fill();
          ctx2d.textAlign = 'center';
          const vic = VENDOR_ICONS[n.lane];
          // block face: 🔒 on holds (Commitment/RI lever), 💰 on gold (Savings Plan),
          // otherwise the vendor's own logo (emoji fallback for AWS)
          const lever = n.type === 'hold' ? '🔒' : gold ? '💰' : null;
          const drawFace = (lx, ly, sz) => {
            if (lever) {
              ctx2d.font = sz + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
              ctx2d.fillText(lever, lx, ly + sz * 0.35);
            } else if (vic) {
              ctx2d.save(); ctx2d.translate(lx, ly); ctx2d.scale(sz / 24, sz / 24); ctx2d.translate(-12, -12);
              ctx2d.fillStyle = 'rgba(6,12,22,.82)'; ctx2d.fill(vic); ctx2d.restore();
            } else {
              ctx2d.font = sz + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
              ctx2d.fillStyle = 'rgba(6,12,22,.85)'; ctx2d.fillText(n.icon, lx, ly + sz * 0.35);
            }
          };
          if (s > 0.72) {
            drawFace(cx - rW * 0.24, y, Math.round(16 * s));
            ctx2d.fillStyle = 'rgba(6,12,22,.9)';
            ctx2d.font = '800 ' + Math.round(12 * s) + 'px Segoe UI, system-ui, sans-serif';
            ctx2d.fillText(fmtK(n.spend), cx + rW * 0.14, y + 4 * s);
          } else if (s > 0.45) {
            drawFace(cx, y, Math.round(17 * s));
          }
        }
      }

      drawEmbers();
      drawHost();

      // particles + pops (fireworks are flagged and drawn separately, on top
      // of the result screen — see drawFireworks(), called after drawResult())
      for (const p of run.parts) {
        if (p.firework) continue;
        ctx2d.globalAlpha = Math.max(0, p.life); ctx2d.fillStyle = p.color;
        ctx2d.fillRect(p.x, p.y, 4, 4);
      }
      ctx2d.globalAlpha = 1;
      ctx2d.textAlign = 'center';
      for (const p of run.pops) {
        ctx2d.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx2d.fillStyle = p.color; ctx2d.font = '800 18px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(p.text, p.x, p.y);
      }
      ctx2d.globalAlpha = 1;
    }

    // ---- hot-streak embers: ambient sparks drifting up off the highway while
    // a combo tier is active (see the heat easing in update()). Purely
    // decorative — no gameplay effect, just the "streak's on fire" payoff.
    function drawEmbers() {
      if (!run || !run.embers.length) return;
      ctx2d.save();
      // additive-ish blending so overlapping embers brighten into each other
      // like real flame does, instead of just stacking flat opaque dots.
      ctx2d.globalCompositeOperation = 'lighter';
      for (const e of run.embers) {
        const a = Math.max(0, Math.min(1, e.life));
        if (a <= 0) continue;
        const rad = Math.max(0.6, e.r * a);
        // small radial gradient per ember — hot yellow-white core cooling to
        // orange-red at the edge — reads as an actual flame lick, not a flat dot.
        const g = ctx2d.createRadialGradient(e.x, e.y, 0, e.x, e.y, rad * 1.8);
        g.addColorStop(0, 'rgba(255,244,200,' + (a * 0.95).toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(255,170,60,' + (a * 0.75).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,70,20,0)');
        ctx2d.fillStyle = g;
        ctx2d.beginPath(); ctx2d.arc(e.x, e.y, rad * 1.8, 0, 6.283); ctx2d.fill();
      }
      ctx2d.restore();
    }

    // ---- the CostBot host, reacting in the left gutter ----
    function drawHost() {
      if (!hostReady || !run) return;
      const g = geom(run.diff.lanes);
      if (g.x0 < 108) return;                 // no room on narrow / mobile
      const cx = g.x0 / 2;
      const size = 74 + Math.min(26, run.combo * 0.4);
      const bob = Math.sin(run.hostBob) * (4 + Math.min(14, run.combo * 0.12));
      const cy = H * 0.5 + bob;
      const hot = run.bill / BILL_MAX;
      const heat = run.heat || 0;
      ctx2d.save();
      const baseGlow = hot > 0.6 ? '#ff5d6c' : '#39d98a';
      // the host catches fire too — its glow blends toward flame-orange with
      // the same run.heat driving the highway/notes, instead of only ever
      // reading danger-red (bill) or calm-green (default).
      ctx2d.shadowColor = heat > 0.1 ? blendHex(baseGlow, '#ff7a1e', Math.min(0.85, heat)) : baseGlow;
      // baseline raised from 12 -> 20 so the hero art reads as clearly glowing
      // even at zero combo/bill-heat, not just once things heat up.
      ctx2d.shadowBlur = 20 + run.tint * 20 + hot * 26 + heat * 22;
      ctx2d.globalAlpha = 0.55 + Math.min(0.45, run.tint + 0.15);
      ctx2d.drawImage(hostImg, cx - size / 2, cy - size / 2, size, size);
      ctx2d.restore();
      ctx2d.textAlign = 'center'; ctx2d.font = '800 12px Segoe UI, system-ui, sans-serif';
      ctx2d.fillStyle = hot > 0.75 ? '#ff5d6c' : '#8194b6';
      const say = hot > 0.75 ? 'BUDGET!!' : run.combo >= 50 ? 'LEGENDARY' : run.combo >= 25 ? "LET'S GO!"
        : run.combo >= 10 ? 'nice cuts' : 'cut the spend!';
      ctx2d.fillText(say, cx, cy + size / 2 + 18);

      // rotating FinOps tip beneath the host, cycling every 5s — this replaces
      // the old top-of-screen popups that fired when something good happened.
      const maxW = g.x0 - 16;
      if (maxW > 96) {
        let ty = cy + size / 2 + 46;
        ctx2d.fillStyle = '#8fbfb2'; ctx2d.font = '800 12px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText('💡 FINOPS TIP', cx, ty); ty += 20;
        ctx2d.fillStyle = '#c3cee6'; ctx2d.font = '600 14px Segoe UI, system-ui, sans-serif';
        const tip = TIPS[Math.floor(performance.now() / 5000) % TIPS.length];
        for (const ln of wrapText(tip, maxW)) { ctx2d.fillText(ln, cx, ty); ty += 18; }
      }
    }

    // Score display: big, and stacked above the host character in the left
    // gutter (same horizontal centre as drawHost's cx = g.x0/2) instead of a
    // top-right corner. Mirrors drawHost's own size/position math so the
    // readout always lands just above the host's head regardless of combo
    // (host size/bob grow with combo). On narrow layouts with no left gutter
    // (same threshold drawHost uses to skip drawing the host at all), it
    // falls back to a compact top-right treatment so there's still a score
    // shown somewhere.
    function drawScoreHud() {
      const g = geom(run.diff.lanes);
      if (g.x0 >= 108) {
        const cx = g.x0 / 2;
        const hostSize = 74 + Math.min(26, run.combo * 0.4);
        const bob = Math.sin(run.hostBob) * (4 + Math.min(14, run.combo * 0.12));
        const hostTop = H * 0.5 + bob - hostSize / 2;
        const size = Math.round(clamp(g.x0 * 0.42, 28, 46));
        const cy = hostTop - 30;
        // label sits a font-size-proportional gap above the score's baseline, so a
        // tall/large score number's ascent can never climb into the "SAVED" text
        // (a fixed offset broke once `size` grew past ~40px).
        ctx2d.textAlign = 'center';
        ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '700 13px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText('SAVED', cx, cy - size * 0.8 - 6);
        ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '800 ' + size + 'px Segoe UI, system-ui, sans-serif';
        ctx2d.shadowColor = 'rgba(255,215,106,.55)'; ctx2d.shadowBlur = 16;
        ctx2d.fillText(fmt$(run.score), cx, cy);
        ctx2d.shadowBlur = 0;
      } else {
        // narrow layout: no left gutter for the host, so keep a compact
        // top-right readout, nudged below the top progress bar / time-remaining
        // pill (see drawHud) so the two never overlap.
        ctx2d.textAlign = 'right';
        ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '800 32px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(fmt$(run.score), W - 14, 88);
        ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '700 12px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText('SAVED', W - 14, 104);
      }
    }

    // Per-song "wallpaper" background (SONGS[i].art): the illustration is
    // scaled to CONTAIN within the canvas (CSS background-size:contain — the
    // whole image always visible, aspect preserved, letterboxed/pillarboxed
    // rather than cropped — per feedback that cover-fit was cropping too much
    // off portrait/non-16:9 art) and drawn vividly (but not full-opacity) with
    // a light darkening scrim on top, so it reads as present "wallpaper" art
    // rather than a washed-out corner illustration, while the highway/notes/
    // HUD drawn after it stay legible. Runs BEHIND everything gameplay-
    // related: called right after the biome floor/sky wash (see draw()),
    // before drawHighway. A solid base fill (that song's biome floor colour,
    // or a dark neutral if no biome) is painted first so contain-fit's
    // letterbox bars read as intentional, not a bug — it also doubles as the
    // loading/failure safety net. Songs with no `art` are untouched: this
    // function just returns immediately and the plain wash shows through.
    function drawSongArt() {
      if (!run || !run.song || !run.song.art) return;
      const bio = global.ArcadeBiomes ? global.ArcadeBiomes.get(run.song.biome) : null;
      ctx2d.fillStyle = (bio && bio.floor) || '#0b0d14';
      ctx2d.fillRect(0, 0, W, H);

      const entry = getArtImage(run.song.art);
      if (!entry || !entry.ready) return;
      const img = entry.img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      // contain-fit: scale so the whole image fits inside W×H, letterboxing
      // whichever axis doesn't match rather than cropping it away.
      const scale = Math.min(W / iw, H / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (W - dw) / 2, dy = (H - dh) / 2;

      // artDim: same per-song extra-darkening knob as the menu wash (see
      // updateArtWash) — for images that read as too bright/busy at the
      // default 0.65 opacity + light scrim (e.g. legend_of_costbot.jpg).
      const dim = run.song.artDim || 0;
      ctx2d.save();
      ctx2d.globalAlpha = Math.max(0.25, 0.65 - dim);
      ctx2d.drawImage(img, dx, dy, dw, dh);
      ctx2d.restore();

      // light dark scrim, heavier toward the edges than the centre, so the
      // highway/notes/HUD keep reliable contrast regardless of how bright or
      // busy the source image is — kept subtle so the art still reads as
      // vivid "wallpaper" rather than faded. artDim boosts both stops for
      // songs whose art needs to sit further back.
      const scrim = ctx2d.createRadialGradient(
        W / 2, H * 0.45, Math.min(W, H) * 0.18,
        W / 2, H * 0.5, Math.max(W, H) * 0.75);
      scrim.addColorStop(0, 'rgba(5,6,15,' + Math.min(0.6, 0.12 + dim) + ')');
      scrim.addColorStop(1, 'rgba(5,6,15,' + Math.min(0.8, 0.32 + dim) + ')');
      ctx2d.fillStyle = scrim;
      ctx2d.fillRect(0, 0, W, H);
    }

    // ---- hud ----
    function drawHud() {
      if (!run) return;
      // cost-anomaly finale: pulse a red alert border around the playfield
      if (state === 'play' && anomOn(actx.currentTime)) {
        const ap = 0.35 + 0.35 * Math.sin(actx.currentTime * 8);
        ctx2d.strokeStyle = 'rgba(255,93,108,' + ap.toFixed(2) + ')'; ctx2d.lineWidth = 6;
        ctx2d.strokeRect(3, 3, W - 6, H - 6);
      }
      // song progress: a thick bar across the very top (fills left->right as the
      // song plays), plus an actual mm:ss countdown so progress is a readable
      // number, not just an inferred fill fraction on a thin line. The bar was
      // 4px and playtesting called it hard to see / hard to read time-left from.
      const barH = 9;
      const prog = clamp((actx.currentTime - run.beginTime) / Math.max(0.001, run.chart.endTime - run.beginTime), 0, 1);
      ctx2d.fillStyle = 'rgba(255,255,255,.09)'; ctx2d.fillRect(0, 0, W, barH);
      const pgrad = ctx2d.createLinearGradient(0, 0, W, 0);
      pgrad.addColorStop(0, '#7fd6c4'); pgrad.addColorStop(1, '#ffd76a');
      ctx2d.fillStyle = pgrad; ctx2d.fillRect(0, 0, W * prog, barH);
      // Two time pills mirrored just below the progress bar: ELAPSED on the
      // top-left, time REMAINING on the top-right. The song/diff/bill block
      // below is shifted down to clear the left pill. The score sits in the left
      // gutter (wide) or top-right below these pills (narrow, see drawScoreHud),
      // so neither pill collides with it.
      const fmtClock = (s) => { const m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ':' + (x < 10 ? '0' : '') + x; };
      const remainSecs = Math.max(0, run.chart.endTime - actx.currentTime);
      const elapsedSecs = Math.max(0, actx.currentTime - run.beginTime);
      ctx2d.font = '800 16px Segoe UI, system-ui, sans-serif';
      // elapsed, top-left (dimmer — it's the secondary readout)
      ctx2d.fillStyle = 'rgba(5,6,15,.55)'; rrect(14, barH + 5, 64, 24, 7); ctx2d.fill();
      ctx2d.textAlign = 'left'; ctx2d.fillStyle = '#9fb4d8';
      ctx2d.fillText(fmtClock(elapsedSecs), 20, barH + 23);
      // remaining, top-right
      ctx2d.fillStyle = 'rgba(5,6,15,.55)'; rrect(W - 78, barH + 5, 64, 24, 7); ctx2d.fill();
      ctx2d.textAlign = 'right'; ctx2d.fillStyle = '#ffe9a8';
      ctx2d.fillText(fmtClock(remainSecs), W - 20, barH + 23);

      // top-left: song + difficulty, then the bill meter — sits below the
      // elapsed pill now (grouped, no stray text)
      ctx2d.textAlign = 'left';
      ctx2d.fillStyle = '#dfe8f7'; ctx2d.font = '700 15px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(run.song.name, 18, 54);
      ctx2d.fillStyle = run.diff.color; ctx2d.font = '700 11px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(run.diff.label.toUpperCase(), 18, 70);

      const bw = Math.min(W * 0.42, 260), bx = 18, by = 82;
      ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '700 10px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('THE BILL', bx, by - 4);
      ctx2d.fillStyle = 'rgba(255,255,255,.08)'; rrect(bx, by, bw, 12, 6); ctx2d.fill();
      const fillR = run.bill / BILL_MAX;
      const col = fillR > 0.75 ? '#ff5d6c' : fillR > 0.5 ? '#f5c451' : '#39d98a';
      ctx2d.fillStyle = col; rrect(bx, by, Math.max(2, bw * fillR), 12, 6); ctx2d.fill();
      if (fillR > 0.75) {
        ctx2d.fillStyle = '#ff5d6c'; ctx2d.font = '800 11px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText('⚠ BUDGET AT RISK', bx + bw + 10, by + 11);
      }

      drawScoreHud();

      // combo + multiplier, centred
      ctx2d.textAlign = 'center';
      if (run.combo > 1) {
        ctx2d.fillStyle = '#fff'; ctx2d.font = '800 34px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(run.combo, W / 2, 44);
        ctx2d.fillStyle = run.mult > 1 ? '#ffd76a' : '#8ea3cc'; ctx2d.font = '800 16px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText('×' + run.mult + ' combo' + (run.mult >= 8 ? '  🔥 ON FIRE' : ''), W / 2, 64);
      }

      // hot-streak fever glow: a warm vignette that eases in/out with run.heat
      // (see update()) rather than snapping at multFor's discrete thresholds,
      // plus a pulsing gold border once the top combo tier (×8) is reached —
      // the "streak's on fire" payoff the anomaly-alert border pattern already
      // established for a different, red/urgent state.
      if (run.heat > 0.02) {
        const pulse = 0.5 + 0.5 * Math.sin(actx.currentTime * (4 + run.heat * 4));
        const alpha = run.heat * (0.14 + pulse * 0.16);
        const vg = ctx2d.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.22, W / 2, H / 2, Math.max(W, H) * 0.72);
        vg.addColorStop(0, 'rgba(255,120,40,0)');
        vg.addColorStop(0.6, 'rgba(255,110,30,' + (alpha * 0.7).toFixed(3) + ')');
        vg.addColorStop(1, 'rgba(255,70,20,' + alpha.toFixed(3) + ')');
        ctx2d.fillStyle = vg; ctx2d.fillRect(0, 0, W, H);
        if (run.mult >= 8) {
          const bp = 0.45 + 0.4 * Math.sin(actx.currentTime * 9);
          ctx2d.strokeStyle = 'rgba(255,180,60,' + bp.toFixed(2) + ')'; ctx2d.lineWidth = 7;
          ctx2d.shadowColor = 'rgba(255,140,40,.8)'; ctx2d.shadowBlur = 18;
          ctx2d.strokeRect(3, 3, W - 6, H - 6);
          ctx2d.shadowBlur = 0;
        }
      }

      // big FinOps callout on combo milestones
      if (run.callout) {
        ctx2d.globalAlpha = Math.min(1, run.callout.life);
        ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '800 40px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(run.callout.text, W / 2, H * 0.36);
        ctx2d.globalAlpha = 1;
      }

      // (FinOps tips moved to the left gutter under the host — see drawHost.)
    }

    function drawCountdown() {
      if (!run) return;
      const remain = run.beginTime - actx.currentTime;
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = 'rgba(5,6,15,.5)'; ctx2d.fillRect(0, 0, W, H);
      ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '800 22px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('GET READY', W / 2, H / 2 - 60);
      const n = Math.ceil(remain);
      if (n <= 3 && n > 0) {
        ctx2d.fillStyle = '#fff'; ctx2d.font = '800 88px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(n, W / 2, H / 2 + 20);
      }
    }

    let resultHit = [];
    function drawResult() {
      if (!run || !run.result) return;
      resultHit = [];
      const r = run.result, cx = W / 2;
      // crossfade the results in over the highway so the finish isn't an abrupt snap
      const fa = clamp((performance.now() - (run.resultAt || 0)) / 900, 0, 1);
      ctx2d.globalAlpha = fa;
      ctx2d.fillStyle = 'rgba(5,6,15,.82)'; ctx2d.fillRect(0, 0, W, H);
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = run.failed ? '#ff5d6c' : '#ffd76a';
      ctx2d.font = '800 20px Segoe UI'; ctx2d.fillText(run.failed ? 'BUDGET BLOWN' : 'SONG CLEAR', cx, 96);
      // song + difficulty played
      ctx2d.font = '600 13px Segoe UI'; ctx2d.fillStyle = '#8ea3cc';
      ctx2d.fillText(run.song.name + '  ·  ' + run.diff.label.toUpperCase(), cx, 118);
      // grade
      const gc = r.grade === 'S' ? '#ffd76a' : r.grade === 'F' ? '#ff5d6c' : '#39d98a';
      ctx2d.fillStyle = gc; ctx2d.font = '800 120px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(r.grade, cx, 220);
      // stats
      ctx2d.font = '700 22px Segoe UI'; ctx2d.fillStyle = '#fff';
      ctx2d.fillText(fmt$(run.score) + ' saved', cx, 268);
      ctx2d.font = '600 15px Segoe UI'; ctx2d.fillStyle = '#c4d0e8';
      {
        const statsText = 'Accuracy ' + r.acc + '%   ·   Max combo ' + run.maxCombo + '   ·   +' + r.tokens;
        const iconSize = 15, gap = 5;
        const textW = ctx2d.measureText(statsText).width;
        const startX = cx - (textW + gap + iconSize) / 2;
        ctx2d.textAlign = 'left';
        ctx2d.fillText(statsText, startX, 296);
        if (coinReady) ctx2d.drawImage(coinImg, startX + textW + gap, 296 - iconSize + 3, iconSize, iconSize);
        ctx2d.textAlign = 'center';
      }
      ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '600 13px Segoe UI';
      const c = run.counts;
      ctx2d.fillText('Perfect ' + c.perfect + ' · Great ' + c.great + ' · OK ' + c.ok +
        ' · Miss ' + c.miss + (c.trap ? ' · Traps ' + c.trap : ''), cx, 320);
      if (r.best) { ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '800 14px Segoe UI'; ctx2d.fillText('★ NEW BEST', cx, 344); }

      // buttons
      const bw = 170, gap = 16, totalW = bw * 2 + gap, bx = cx - totalW / 2, by = 372;
      ctx2d.fillStyle = '#ffd76a'; rrect(bx, by, bw, 46, 11); ctx2d.fill();
      ctx2d.fillStyle = '#06121a'; ctx2d.font = '800 17px Segoe UI'; ctx2d.fillText('↻ Retry', bx + bw / 2, by + 30);
      resultHit.push({ x: bx, y: by, w: bw, h: 46, kind: 'retry' });
      ctx2d.fillStyle = 'rgba(255,255,255,.1)'; rrect(bx + bw + gap, by, bw, 46, 11); ctx2d.fill();
      ctx2d.fillStyle = '#dfe8f7'; ctx2d.fillText('Song select', bx + bw + gap + bw / 2, by + 30);
      resultHit.push({ x: bx + bw + gap, y: by, w: bw, h: 46, kind: 'menu' });

      // a cost-saving tip to take away
      if (r.tip) {
        ctx2d.font = '700 13px Segoe UI, system-ui, sans-serif';
        const tw = ctx2d.measureText('💡  ' + r.tip).width + 28;
        const tbw = Math.min(W - 60, tw), tbx = cx - tbw / 2, tby = by + 66;
        ctx2d.fillStyle = 'rgba(127,214,196,.12)'; rrect(tbx, tby, tbw, 32, 8); ctx2d.fill();
        ctx2d.strokeStyle = 'rgba(127,214,196,.5)'; ctx2d.lineWidth = 1; rrect(tbx, tby, tbw, 32, 8); ctx2d.stroke();
        ctx2d.fillStyle = '#cfe9e2'; ctx2d.textAlign = 'center';
        ctx2d.fillText('💡  ' + r.tip, cx, tby + 21);
      }
      // On a fail, the wipeout shot goes under the tip, in the otherwise-empty
      // lower half of the results screen (same "contain"-fit + rounded-clip
      // treatment as the per-song wallpaper art in drawSongArt()).
      if (run.failed && r.wipeoutShot) {
        const entry = getArtImage(r.wipeoutShot);
        if (entry && entry.ready) {
          const top = by + 66 + 32 + 16, bottom = H - 160;
          const maxW = Math.min(W - 80, 260), maxH = Math.max(40, bottom - top);
          const ar = entry.img.naturalWidth / entry.img.naturalHeight;
          let dw = maxW, dh = dw / ar;
          if (dh > maxH) { dh = maxH; dw = dh * ar; }
          const dx = cx - dw / 2, dy = top;
          ctx2d.save();
          rrect(dx, dy, dw, dh, 10); ctx2d.clip();
          ctx2d.drawImage(entry.img, dx, dy, dw, dh);
          ctx2d.restore();
          ctx2d.strokeStyle = 'rgba(255,255,255,.18)'; ctx2d.lineWidth = 1.5;
          rrect(dx, dy, dw, dh, 10); ctx2d.stroke();
        }
      }
      // SONG CLEAR — a victory pose glows and gently pulses under the tip,
      // the same empty real-estate the wipeout shot uses on a fail. No boxed
      // frame here: these are transparent character cutouts, not photos, so
      // the glow should hug the silhouette rather than a rounded card.
      if (!run.failed && r.victoryShot) {
        const entry = getArtImage(r.victoryShot);
        if (entry && entry.ready) {
          const top = by + 66 + 32 + 16, bottom = H - 160;
          const maxW = Math.min(W - 80, 220), maxH = Math.max(40, bottom - top);
          const ar = entry.img.naturalWidth / entry.img.naturalHeight;
          let dw = maxW, dh = dw / ar;
          if (dh > maxH) { dh = maxH; dw = dh * ar; }
          const cy = top + dh / 2;
          const t = (performance.now() - (run.resultAt || 0)) / 1000;
          const pulse = Math.sin(t * (2 * Math.PI / 1.6));       // -1..1, ~1.6s period
          const scale = 1 + 0.05 * pulse;
          ctx2d.save();
          ctx2d.translate(cx, cy);
          ctx2d.scale(scale, scale);
          ctx2d.shadowColor = 'rgba(255,215,106,.85)';
          ctx2d.shadowBlur = 18 + 10 * pulse;                     // breathing glow, 8-28px
          ctx2d.drawImage(entry.img, -dw / 2, -dh / 2, dw, dh);
          // a second pass punches the glow up without doubling the opaque
          // artwork (shadowBlur alone reads faint against the dark backdrop)
          ctx2d.shadowBlur = 28 + 14 * pulse;
          ctx2d.globalAlpha = fa * 0.6;
          ctx2d.drawImage(entry.img, -dw / 2, -dh / 2, dw, dh);
          ctx2d.restore();
        }
      }
      ctx2d.globalAlpha = 1;
    }
    // Full-screen x50-combo flash: a red-tinted overlay + the CB-T1000 art
    // popping in and shuddering, same recipe as Waste Hunter's "Terminate
    // All" nuke flash (drawFlash() there) — a red rgba wash scaled by the
    // fade, the art scaled in with a glow, cross-faded out over its own life.
    function drawFlash() {
      if (!run || !run.flash) return;
      const f = run.flash;
      const a = clamp(f.life / f.max, 0, 1);
      const progress = 1 - a;
      ctx2d.fillStyle = 'rgba(255,64,42,' + (0.38 * a) + ')';
      ctx2d.fillRect(0, 0, W, H);
      if (!t1000Ready) return;
      const pop = 0.82 + 0.18 * Math.min(1, progress * 7);
      const shudder = a > 0.75 ? (Math.random() * 2 - 1) * 6 * a : 0;
      ctx2d.save();
      // Capped well below fully opaque — this is meant to distract over the
      // highway, not block the notes falling under it.
      ctx2d.globalAlpha = Math.min(0.43, a * 1.1);
      ctx2d.translate(W / 2 + shudder, H / 2);
      ctx2d.scale(pop, pop);
      const sc = Math.min(W * 0.46 / t1000Img.naturalWidth, H * 0.42 / t1000Img.naturalHeight);
      const iw = t1000Img.naturalWidth * sc, ih = t1000Img.naturalHeight * sc;
      ctx2d.shadowColor = '#ff3b3b'; ctx2d.shadowBlur = 46;
      ctx2d.drawImage(t1000Img, -iw / 2, -ih / 2, iw, ih);
      ctx2d.shadowBlur = 0;
      ctx2d.restore();
    }
    // Fireworks particles are flagged (spawnFirework()) and skipped by the
    // regular particle loop in drawHighway() specifically so they can be drawn
    // HERE instead — after drawResult()'s dark panel, not before it — so a
    // SONG CLEAR celebration reads on top of the score screen, not smothered
    // under its ~82%-opaque backdrop. Bigger than a hit-burst particle: a
    // tight, low-alpha glow (small + faint, not a haze) behind a crisp solid
    // core, plus a small bright-white hot-center dot for definition — three
    // thin layers read as a sharp spark, not a blurry blob.
    function drawFireworks() {
      if (!run) return;
      for (const p of run.parts) {
        if (!p.firework) continue;
        const a = Math.max(0, p.life);
        ctx2d.globalAlpha = a * 0.28; ctx2d.fillStyle = p.color;
        ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.size * 1.25, 0, Math.PI * 2); ctx2d.fill();
        ctx2d.globalAlpha = a; ctx2d.fillStyle = p.color;
        ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx2d.fill();
        ctx2d.globalAlpha = a; ctx2d.fillStyle = '#fff';
        ctx2d.beginPath(); ctx2d.arc(p.x, p.y, p.size * 0.35, 0, Math.PI * 2); ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;
    }
    function handleResultClick(x, y) {
      for (const h of resultHit) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        if (h.kind === 'retry') startSong();
        else { state = 'menu'; run = null; }
        return;
      }
    }

    // ---- canvas draw utils ----
    function rrect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx2d.beginPath();
      ctx2d.moveTo(x + r, y);
      ctx2d.arcTo(x + w, y, x + w, y + h, r);
      ctx2d.arcTo(x + w, y + h, x, y + h, r);
      ctx2d.arcTo(x, y + h, x, y, r);
      ctx2d.arcTo(x, y, x + w, y, r);
      ctx2d.closePath();
    }
    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    // linear-interpolate two hex colours by t (0 = a, 1 = b) — used to blend
    // notes toward flame-orange as the hot-streak heat rises.
    function blendHex(a, b, t) {
      t = clamp(t, 0, 1);
      const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
      const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
      const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
      const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
      // MUST stay '#rrggbb' hex, not 'rgb(...)' — callers (hexA(), and chained
      // blendHex() calls for the note gem gradient) parse via hex.slice(1) +
      // parseInt(...,16), which silently produces NaN on an 'rgb(...)' string.
      const h = (n) => clamp(n, 0, 255).toString(16).padStart(2, '0');
      return '#' + h(r) + h(g) + h(bl);
    }
    // word-wrap a string to a pixel width, using the ctx's current font
    function wrapText(text, maxW) {
      const words = String(text).split(' '); const lines = []; let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (line && ctx2d.measureText(t).width > maxW) { lines.push(line); line = w; }
        else line = t;
      }
      if (line) lines.push(line);
      return lines;
    }

    // ---- DOM title screen -------------------------------------------------
    // Canvas draws the starfield backdrop; the menu itself is a DOM overlay
    // (banner + song/difficulty + how-to), matching the other cabinets. Shown
    // only in the 'menu' state and hidden the instant a run starts.
    let menuEl = null, wasMenu = false;
    // Rebind UI state: rebindOpen is the overlay's visibility, rebindLane is
    // the lane index currently "listening" for its next keydown (null when
    // none is armed). Both live here, not on `run`/`state`, because the
    // overlay only exists in the menu — nothing needs to reach it mid-run.
    let rebindOpen = false, rebindLane = null, rebindErrTimer = null;
    // Assigned once buildMenu() runs (it owns the overlay's DOM); onKey()
    // above only ever calls these through the closure, never inlines the
    // overlay's internals, so it doesn't care that they're defined later.
    let stopListening = () => {}, tryRebindLane = () => {}, closeRebindOverlay = () => {};
    function buildMenu() {
      if (!document.getElementById('ch-menu-style')) {
        const st = document.createElement('style'); st.id = 'ch-menu-style';
        st.textContent = `
        .ch-menu{position:absolute;inset:0;z-index:4;display:none;flex-direction:column;
          align-items:center;overflow:auto;padding:22px 16px 40px;box-sizing:border-box;
          font-family:'Segoe UI',system-ui,sans-serif;color:#dfe8f7;-webkit-overflow-scrolling:touch;}
        .ch-menu .ch-veil{position:fixed;inset:0;z-index:-1;
          background:radial-gradient(circle at 50% -10%,rgba(30,38,90,.55),rgba(5,6,15,.9));
          transition:background .25s ease;}
        .ch-menu .ch-artwash{position:fixed;inset:0;z-index:-2;background-size:contain;
          background-position:center;background-repeat:no-repeat;opacity:0;transition:opacity .25s ease;}
        .ch-menu.has-art .ch-veil{background:radial-gradient(circle at 50% -10%,rgba(20,26,60,.22),rgba(5,6,15,.5));}
        .ch-panel{width:min(780px,100%);display:flex;flex-direction:column;gap:16px;}
        .ch-hero{border-radius:16px;overflow:hidden;border:1px solid #2b3f66;
          box-shadow:0 14px 44px rgba(0,0,0,.55);}
        .ch-hero img{width:100%;display:block;}
        .ch-head{text-align:center;}
        .ch-head h1{margin:0;font-size:30px;font-weight:800;color:#ffd76a;letter-spacing:.4px;}
        .ch-head p{margin:5px 0 0;color:#8ea3cc;font-size:28px;}
        .ch-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
        @media(max-width:640px){.ch-cols{grid-template-columns:1fr;}}
        .ch-lbl{font-size:11px;font-weight:800;letter-spacing:1.6px;color:#8194b6;margin-bottom:8px;}
        .ch-song-controls{display:flex;gap:8px;align-items:stretch;margin-bottom:9px;flex-wrap:wrap;}
        .ch-search{flex:1 1 140px;min-width:0;padding:9px 12px;border-radius:10px;
          border:1px solid #26324f;background:rgba(255,255,255,.05);color:#eaf1ff;
          font-family:inherit;font-size:16px;outline:none;transition:border-color .12s;}
        .ch-search::placeholder{color:#5b6b8c;}
        .ch-search:focus{border-color:#5a7cb5;}
        .ch-exp{display:flex;align-items:center;gap:7px;padding:8px 12px;
          border-radius:10px;border:1px solid #26324f;background:rgba(255,255,255,.03);
          font-size:12px;color:#8ea3cc;cursor:pointer;user-select:none;white-space:nowrap;}
        .ch-exp input{accent-color:#c04dff;cursor:pointer;}
        /* One unified, scrollable song column: curated rows first, then (when
           the toggle is on) experimental rows inline with an EXP badge. Height
           is capped so DIFFICULTY, PLAY, and the how-to cards stay on screen as
           the library grows; the box scrolls on its own (touch-friendly), and
           clamp() keeps it sane on short / mobile viewports. syncMenu() scrolls
           the selected row into view for keyboard nav. */
        .ch-songs{display:flex;flex-direction:column;gap:8px;
          max-height:clamp(220px,42vh,360px);overflow-y:auto;overscroll-behavior:contain;
          -webkit-overflow-scrolling:touch;padding-right:4px;}
        .ch-songs::-webkit-scrollbar{width:8px;}
        .ch-songs::-webkit-scrollbar-thumb{background:#2b3f66;border-radius:4px;}
        .ch-songs::-webkit-scrollbar-track{background:transparent;}
        .ch-song-empty{font-size:12px;color:#8194b6;padding:8px 2px;}
        .ch-song{display:flex;justify-content:space-between;align-items:center;gap:10px;
          padding:10px 14px;border-radius:11px;border:1px solid #26324f;background:rgba(255,255,255,.03);
          cursor:pointer;transition:border-color .12s,background .12s;}
        .ch-song:hover{border-color:#5a7cb5;}
        .ch-song.sel{border-color:#ffd76a;background:rgba(255,215,106,.12);}
        .ch-song .nm{font-weight:700;font-size:15px;color:#eaf1ff;}
        .ch-song .sub{font-size:12px;color:#8194b6;margin-top:1px;}
        .ch-song .best{font-size:12px;font-weight:700;color:#ffd76a;white-space:nowrap;}
        /* Experimental rows sit inline in the one unified song list (after the
           curated ones), shown only when the toggle is on. A dashed purple
           border + the EXP badge below mark them apart from curated songs. */
        .ch-song.exp{border-style:dashed;border-color:#6a3f96;background:rgba(192,77,255,.05);}
        .ch-song.exp:hover{border-color:#c04dff;}
        .ch-song.exp.sel{border-color:#ffd76a;background:rgba(255,215,106,.12);}
        .ch-song.exp .nm{display:flex;align-items:center;gap:5px;}
        .ch-song.exp .nm::after{content:'EXP';font-size:9px;font-weight:800;letter-spacing:.6px;
          color:#c04dff;border:1px solid #6a3f96;border-radius:5px;padding:1px 4px;}
        .ch-diffs-row{display:flex;gap:10px;align-items:stretch;}
        .ch-diffs{display:flex;gap:8px;flex:1;}
        .ch-diff{flex:1;padding:11px 0;border-radius:10px;border:1px solid #26324f;
          background:rgba(255,255,255,.04);text-align:center;font-weight:800;font-size:14px;
          color:#c4d0e8;cursor:pointer;transition:.12s;}
        .ch-how{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        @media(max-width:460px){.ch-how{grid-template-columns:1fr;}}
        .ch-card{padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid #1e2942;}
        .ch-card .k{font-weight:800;font-size:12px;color:#eaf1ff;margin-bottom:2px;}
        .ch-card .d{font-size:11px;color:#8ea3cc;line-height:1.38;}
        .ch-play{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:6px;
          padding:0 38px;border:2px solid rgba(255,255,255,.35);border-radius:12px;
          background:#2fa8ff;color:#06121a;font-weight:900;font-size:18px;letter-spacing:.3px;cursor:pointer;
          box-shadow:0 10px 28px rgba(47,168,255,.55);transition:transform .1s,box-shadow .15s;white-space:nowrap;}
        .ch-play:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(47,168,255,.7);}
        .ch-board{align-self:center;text-decoration:none;color:#c4d0e8;font-weight:700;font-size:13px;
          padding:8px 18px;border-radius:9px;border:1px solid #2b3f66;background:rgba(255,255,255,.04);
          transition:border-color .12s,color .12s;}
        .ch-board:hover{border-color:#5a7cb5;color:#fff;}
        .ch-calib{display:flex;align-items:center;justify-content:center;gap:10px;color:#8194b6;font-size:12px;flex-wrap:wrap;}
        .ch-calib button{width:30px;height:28px;border-radius:8px;border:1px solid #2b3f66;
          background:rgba(255,255,255,.06);color:#dfe8f7;font-weight:800;font-size:16px;cursor:pointer;}
        .ch-calib b{color:#c4d0e8;min-width:62px;text-align:center;}
        .ch-foot{text-align:center;color:#5b6b8c;font-size:11px;}
        .ch-controls-rebind{display:block;margin-top:4px;font:inherit;font-size:11px;font-weight:700;
          color:#ffd76a;background:none;border:none;padding:0;cursor:pointer;
          text-decoration:underline;text-underline-offset:2px;}
        .ch-controls-rebind:hover{color:#fff;}
        .ch-rebind-overlay{position:fixed;inset:0;z-index:6;display:none;align-items:center;
          justify-content:center;background:rgba(5,6,15,.72);padding:20px;box-sizing:border-box;}
        .ch-rebind-panel{width:min(420px,100%);background:#0f1626;border:1px solid #26324f;
          border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);
          display:flex;flex-direction:column;gap:14px;}
        .ch-rebind-head{display:flex;align-items:center;justify-content:space-between;}
        .ch-rebind-close{background:rgba(255,255,255,.06);border:1px solid #26324f;color:#c4d0e8;
          border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px;line-height:1;}
        .ch-rebind-close:hover{border-color:#5a7cb5;color:#fff;}
        .ch-rebind-rows{display:flex;flex-direction:column;gap:8px;}
        .ch-rebind-row{display:flex;align-items:center;justify-content:space-between;gap:10px;
          padding:9px 12px;border-radius:10px;border:1px solid #26324f;background:rgba(255,255,255,.03);}
        .ch-rebind-vendor{font-weight:700;font-size:13px;}
        .ch-rebind-key{min-width:56px;padding:7px 0;border-radius:8px;border:1px solid #26324f;
          background:rgba(255,255,255,.06);color:#eaf1ff;font-weight:800;font-size:14px;cursor:pointer;
          transition:border-color .12s,background .12s;}
        .ch-rebind-key:hover{border-color:#ffd76a;}
        .ch-rebind-key.listening{border-color:#ffd76a;animation:ch-rebind-pulse 1s ease-in-out infinite;}
        @keyframes ch-rebind-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,215,106,.5);}
          50%{box-shadow:0 0 0 5px rgba(255,215,106,0);}}
        .ch-rebind-err{min-height:16px;font-size:12px;color:#ff5d6c;text-align:center;}
        .ch-rebind-actions{display:flex;justify-content:space-between;gap:10px;}
        .ch-rebind-reset{flex:1;padding:9px 0;border-radius:9px;border:1px solid #26324f;
          background:rgba(255,255,255,.04);color:#c4d0e8;font-weight:700;font-size:12px;cursor:pointer;}
        .ch-rebind-reset:hover{border-color:#5a7cb5;color:#fff;}
        .ch-rebind-done{flex:1;padding:9px 0;border-radius:9px;border:2px solid rgba(255,255,255,.35);
          background:#ffd76a;color:#06121a;font-weight:900;font-size:12px;cursor:pointer;}
        .ch-rebind-done:hover{transform:translateY(-1px);}`;
        document.head.appendChild(st);
      }
      menuEl = document.createElement('div');
      menuEl.className = 'ch-menu';
      menuEl.innerHTML = `
        <div class="ch-artwash" id="ch-artwash"></div>
        <div class="ch-veil"></div>
        <div class="ch-panel">
          <div class="ch-hero"><img src="../shared/assets/cb_hero_banner_wide_logos.jpg" alt="CostBot Hero"></div>
          <div class="ch-head">
            <h1>CostBot Hero</h1>
            <p>Cut the spend on the beat — every note you nail is money off the cloud bill.</p>
          </div>
          <div class="ch-cols">
            <div>
              <div class="ch-lbl">SONG</div>
              <div class="ch-song-controls">
                <input type="text" id="ch-search" class="ch-search" placeholder="Search songs…" autocomplete="off" spellcheck="false" aria-label="Search songs">
                <label class="ch-exp"><input type="checkbox" id="ch-exp-check"> 🧪 <span>Experimental</span></label>
              </div>
              <div class="ch-songs" id="ch-songs"></div>
              <div class="ch-song-empty" id="ch-song-empty" hidden></div>
              <div class="ch-lbl" style="margin-top:16px">DIFFICULTY</div>
              <div class="ch-diffs-row">
                <div class="ch-diffs" id="ch-diffs"></div>
                <button class="ch-play" id="ch-play">▶&nbsp;PLAY</button>
              </div>
            </div>
            <div>
              <div class="ch-lbl">HOW TO PLAY</div>
              <div class="ch-how">
                <div class="ch-card"><div class="k">🎯 Hit on the beat</div><div class="d">Notes fall down vendor lanes — AWS, GCP, Azure, Databricks. Tap the lane key as each note crosses the line.</div></div>
                <div class="ch-card"><div class="k">⌨️ Controls</div><div class="d" id="ch-controls-text">A S D F, or tap the lanes on a touchscreen. Press M to mute.</div><button class="ch-controls-rebind" id="ch-rebind-open" type="button">Rebind keys</button></div>
                <div class="ch-card"><div class="k">🔒 Holds = commitments</div><div class="d">Hold through the tail to lock in a Savings Plan / RI. Longer holds pay more.</div></div>
                <div class="ch-card"><div class="k">💰 Gold notes</div><div class="d">The song's peak note pays ×3 — a big savings win. Build combos for up to ×8.</div></div>
                <div class="ch-card"><div class="k">📈 Mind the bill</div><div class="d">Misses balloon the bill meter. Blow the budget and the run ends early.</div></div>
                <div class="ch-card"><div class="k">🚫 Don't cut PROD</div><div class="d">On Hard, ✕ trap notes are production — hit one and the bill jumps. Let them fall past.</div></div>
              </div>
            </div>
          </div>
          <a class="ch-board" href="../leaderboard/index.html#costbot-hero">🏆 Leaderboard</a>
          <div class="ch-calib">
            <span>Audio sync</span>
            <button id="ch-cal-down">−</button><b id="ch-cal-val">0 ms</b><button id="ch-cal-up">+</button>
            <span style="opacity:.7">tiles landing early? +&nbsp;&nbsp;·&nbsp;&nbsp;late? −</span>
          </div>
          <div class="ch-foot">↑↓ song&nbsp;·&nbsp;←→ difficulty&nbsp;·&nbsp;Enter to play&nbsp;·&nbsp;high scores post to the arcade leaderboard</div>
        </div>
        <div class="ch-rebind-overlay" id="ch-rebind-overlay">
          <div class="ch-rebind-panel">
            <div class="ch-rebind-head">
              <div class="ch-lbl">⌨ REBIND LANE KEYS</div>
              <button class="ch-rebind-close" id="ch-rebind-close" type="button">✕</button>
            </div>
            <div class="ch-rebind-rows" id="ch-rebind-rows"></div>
            <div class="ch-rebind-err" id="ch-rebind-err"></div>
            <div class="ch-rebind-actions">
              <button class="ch-rebind-reset" id="ch-rebind-reset" type="button">Reset to default</button>
              <button class="ch-rebind-done" id="ch-rebind-done" type="button">Done</button>
            </div>
          </div>
        </div>`;
      host.appendChild(menuEl);

      const songsWrap = menuEl.querySelector('#ch-songs');
      const songEmptyEl = menuEl.querySelector('#ch-song-empty');
      const searchEl = menuEl.querySelector('#ch-search');
      const diffsWrap = menuEl.querySelector('#ch-diffs');
      // Rebuilt (not just re-styled) whenever the experimental toggle flips or
      // the search text changes, since the SET of rows changes, not just which
      // one is selected. menuSongs() owns the order + filtering (see its defn):
      // curated first, experimental inline after (toggle-gated, EXP-badged),
      // narrowed by the search box — one column, rendered into #ch-songs.
      function makeSongRow(s) {
        const i = SONGS.indexOf(s);
        const el = document.createElement('div');
        el.className = 'ch-song' + (s.experimental ? ' exp' : ''); el.dataset.i = i;
        el.innerHTML = `<div><div class="nm">${s.name}</div><div class="sub">${s.sub}</div></div><div class="best" data-best></div>`;
        el.onclick = () => { songIdx = i; SFX.ui(); syncMenu(); };
        return el;
      }
      function renderSongRows() {
        songsWrap.innerHTML = '';
        const list = menuSongs();
        list.forEach((s) => { songsWrap.appendChild(makeSongRow(s)); });
        // If the current selection got filtered out (or hidden by the toggle),
        // move it to the first still-visible row so PLAY/nav never point at a
        // row that isn't on screen.
        if (list.length && !list.includes(SONGS[songIdx])) songIdx = SONGS.indexOf(list[0]);
        if (songEmptyEl) {
          songEmptyEl.hidden = list.length > 0;
          if (!list.length) songEmptyEl.textContent = `No songs match “${songQuery.trim()}”.`;
        }
      }
      function renderDiffButtons() {
        diffsWrap.innerHTML = '';
        diffOrder().forEach((dk) => {
          const el = document.createElement('div');
          el.className = 'ch-diff'; el.dataset.dk = dk; el.textContent = DIFFS[dk].label;
          el.onclick = () => { diffKey = dk; SFX.ui(); syncMenu(); };
          diffsWrap.appendChild(el);
        });
      }
      renderSongRows();
      renderDiffButtons();
      const expCheck = menuEl.querySelector('#ch-exp-check');
      expCheck.checked = !!meta.experimental;
      expCheck.onchange = () => {
        meta.experimental = expCheck.checked;
        persist();
        // hiding: bounce off an experimental song/the Ultra tier back to a
        // safe default instead of leaving the selection pointing at
        // something no longer shown
        if (!meta.experimental) {
          if (SONGS[songIdx] && SONGS[songIdx].experimental) songIdx = 0;
          if (diffKey === 'ultra') diffKey = 'hard';
        }
        renderSongRows();
        renderDiffButtons();
        syncMenu();
        SFX.ui();
      };
      // Live search box. Keydowns are kept from bubbling to the global game
      // handler (onKeyDown on window) so typing a letter, space, or arrow in
      // the box edits text instead of muting / starting the song / moving the
      // selection. Enter still starts the song (a convenience), so it's allowed
      // through by not stopping it.
      searchEl.addEventListener('input', () => { songQuery = searchEl.value; renderSongRows(); syncMenu(); });
      searchEl.addEventListener('keydown', (e) => { if (e.key !== 'Enter') e.stopPropagation(); });

      menuEl.querySelector('#ch-play').onclick = () => { initAudio(); startSong(); };
      menuEl.querySelector('#ch-cal-down').onclick = () => { meta.calibMs = clamp((meta.calibMs || 0) - 5, -300, 300); persist(); SFX.ui(); syncMenu(); };
      menuEl.querySelector('#ch-cal-up').onclick = () => { meta.calibMs = clamp((meta.calibMs || 0) + 5, -300, 300); persist(); SFX.ui(); syncMenu(); };

      // ---- key rebinding ----
      // Reads live off meta.laneKeys (persisted); onKey()'s rebindLane branch
      // (top of the file) is what actually captures the next keydown once a
      // lane is armed here.
      const rebindRows = menuEl.querySelector('#ch-rebind-rows');
      const rebindErr = menuEl.querySelector('#ch-rebind-err');
      const rebindOverlay = menuEl.querySelector('#ch-rebind-overlay');
      function controlsText() {
        return meta.laneKeys.map((k) => k.toUpperCase()).join(' ') + ', or tap the lanes on a touchscreen. Press M to mute.';
      }
      function updateControlsCard() {
        const el = menuEl.querySelector('#ch-controls-text');
        if (el) el.textContent = controlsText();
      }
      function renderRebindRows() {
        rebindRows.innerHTML = '';
        for (let i = 0; i < 4; i++) {
          const listening = rebindLane === i;
          const row = document.createElement('div');
          row.className = 'ch-rebind-row';
          row.innerHTML = `<span class="ch-rebind-vendor" style="color:${PALETTE[i]}">${VENDORS[i]}</span>
            <button class="ch-rebind-key${listening ? ' listening' : ''}" type="button">${listening ? '…' : meta.laneKeys[i].toUpperCase()}</button>`;
          row.querySelector('button').onclick = () => {
            clearTimeout(rebindErrTimer); rebindErr.textContent = '';
            rebindLane = i; renderRebindRows(); SFX.ui();
          };
          rebindRows.appendChild(row);
        }
      }
      function showRebindError(msg) {
        rebindErr.textContent = msg;
        clearTimeout(rebindErrTimer);
        rebindErrTimer = setTimeout(() => { rebindErr.textContent = ''; }, 2200);
      }
      // Exposed so onKey() (defined earlier, before these closures exist) can
      // call back into the menu without reaching into its internals directly.
      stopListening = () => { rebindLane = null; renderRebindRows(); };
      tryRebindLane = (lane, k) => {
        if (RESERVED_KEYS.has(k)) { showRebindError('That key is reserved — try another.'); stopListening(); return; }
        if (k.length !== 1) { showRebindError('Pick a single letter or symbol key.'); stopListening(); return; }
        if (k !== meta.laneKeys[lane] && meta.laneKeys.some((existing, i) => i !== lane && existing === k)) {
          showRebindError('Already used by another lane.'); stopListening(); return;
        }
        meta.laneKeys[lane] = k;
        persist();
        stopListening();
        updateControlsCard();
        SFX.ui();
      };
      function openRebindOverlay() {
        rebindOpen = true; rebindLane = null;
        rebindErr.textContent = ''; clearTimeout(rebindErrTimer);
        renderRebindRows();
        rebindOverlay.style.display = 'flex';
        SFX.ui();
      }
      closeRebindOverlay = () => {
        rebindOpen = false; rebindLane = null;
        rebindOverlay.style.display = 'none';
        SFX.ui();
      };
      menuEl.querySelector('#ch-rebind-open').onclick = () => openRebindOverlay();
      menuEl.querySelector('#ch-rebind-close').onclick = () => closeRebindOverlay();
      menuEl.querySelector('#ch-rebind-done').onclick = () => closeRebindOverlay();
      // click on the dimmed backdrop (not the panel itself) closes, same as Done
      rebindOverlay.onclick = (e) => { if (e.target === rebindOverlay) closeRebindOverlay(); };
      menuEl.querySelector('#ch-rebind-reset').onclick = () => {
        meta.laneKeys = KEYS[4].slice();
        persist();
        stopListening();
        updateControlsCard();
        SFX.ui();
      };
      updateControlsCard();
    }
    // Selected-song artwork wash behind the whole menu (ch-artwash, under the
    // existing ch-veil vignette) — updates live as songIdx changes, whether
    // that's a click or an arrow-key nav (both funnel through syncMenu()).
    // Cross-fades between songs by fading the wash out, swapping the
    // background-image + biome-floor fallback colour, then fading back in.
    // Songs with no `art` (none currently, but SONGS entries aren't required
    // to have one) just hide the wash and fall back to the plain veil.
    let artWashFile;
    function updateArtWash() {
      const wash = menuEl.querySelector('#ch-artwash');
      if (!wash) return;
      const song = SONGS[songIdx];
      const file = song && song.art;
      if (file === artWashFile) return;
      const apply = () => {
        artWashFile = file;
        if (!file) {
          wash.style.opacity = '0';
          menuEl.classList.remove('has-art');
          return;
        }
        const bio = global.ArcadeBiomes ? global.ArcadeBiomes.get(song.biome) : null;
        wash.style.backgroundColor = (bio && bio.floor) || '#0b0d14';
        // artDim: extra darkening for images that read as too bright/busy
        // against the menu text at the default scrim (e.g. legend_of_costbot.jpg,
        // a vivid full-colour painted cover). 0 (default) keeps the original look.
        const dim = song.artDim || 0;
        const a1 = Math.min(0.9, 0.35 + dim), a2 = Math.min(0.94, 0.58 + dim);
        wash.style.backgroundImage =
          'linear-gradient(rgba(5,6,15,' + a1 + '),rgba(8,10,20,' + a2 + ')), url("../shared/assets/' + file + '")';
        wash.style.opacity = String(1 - dim * 0.25);
        menuEl.classList.add('has-art');
      };
      if (artWashFile === undefined) { apply(); return; } // first paint: no fade needed
      wash.style.opacity = '0';
      setTimeout(apply, 180);
    }
    function syncMenu() {
      if (!menuEl) return;
      updateArtWash();
      menuEl.querySelectorAll('.ch-song').forEach((el) => {
        const i = +el.dataset.i;
        const sel = i === songIdx;
        el.classList.toggle('sel', sel);
        // Keep the selection visible as it moves through the capped-height
        // scroll box (arrow-key nav past the fold). 'nearest' is a no-op when
        // the row is already on screen, so clicks don't cause a jump.
        if (sel) el.scrollIntoView({ block: 'nearest' });
        const rec = meta.records[SONGS[i].key] && meta.records[SONGS[i].key][diffKey];
        el.querySelector('[data-best]').textContent = rec ? rec.grade + ' · ' + fmt$(rec.score) : '';
      });
      menuEl.querySelectorAll('.ch-diff').forEach((el) => {
        const dk = el.dataset.dk, sel = dk === diffKey;
        el.classList.toggle('sel', sel);
        el.style.background = sel ? DIFFS[dk].color : '';
        el.style.borderColor = sel ? DIFFS[dk].color : '';
        el.style.color = sel ? '#06121a' : '';
      });
      const cv = menuEl.querySelector('#ch-cal-val');
      if (cv) cv.textContent = (meta.calibMs > 0 ? '+' : '') + (meta.calibMs || 0) + ' ms';
    }
    buildMenu();

    raf = requestAnimationFrame(frame);
    emit('ready', {});

    return {
      get meta() { return meta; },
      get muted() { return !!meta.muted; },
      toggleMute,
      destroy() {
        cancelAnimationFrame(raf);
        stopRunAudio(run);
        global.removeEventListener('keydown', onKeyDown);
        global.removeEventListener('keyup', onKeyUp);
        global.removeEventListener('resize', resize);
        cv.remove();
      },
    };
  }

  global.CostBotHero = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
