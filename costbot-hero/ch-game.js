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
(function (global) {
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
    { key: 'ch_avengers', name: 'The Savengers',   sub: 'Avengers, rocked · 148',   tag: '', biome: 'arena', art: 'cb_snapped.jpg' },
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
    { key: 'ch_imperial', name: 'Imperial Markup', sub: 'Villain march · 118',      tag: '', biome: 'dusk', art: 'darth_cb.png',
      maxLoops: 2,
      medium: { chordSize: 2 },
      hard: { fall: 1.15, holdGap: 99, missCost: 10, chordSize: 3 } },
    { key: 'ch_small',    name: "It's a Small Cost", sub: 'Electro light parade · 126', tag: '', biome: 'datacenter', art: 'cb_smallworld.jpg' },
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
    { key: 'ch_blindhero', name: 'Blind Spend', sub: 'Daredevil, dark ostinato · 156', tag: '', biome: 'foundry', art: 'cb_justice.jpg',
      medium: { fall: 2.0, minGap: 3, missCost: 7 },
      hard:   { fall: 1.05, minGap: 1, missCost: 12 } },
  ];

  const DIFFS = {
    // fall   = seconds a note takes to reach the line (bigger = slower/easier).
    // minGap = minimum spacing in 16th steps between kept notes. Every kept note
    //          is a REAL melody onset, so the chart always tracks the tune; a
    //          bigger gap just thins dense runs (easier) without moving notes.
    easy:   { label: 'Easy',   lanes: 3, fall: 2.15, minGap: 4, holdGap: 99, traps: false, missCost: 5,  color: '#39d98a' },
    medium: { label: 'Normal', lanes: 4, fall: 1.90, minGap: 3, holdGap: 8,  traps: false, missCost: 7,  color: '#f5c451' },
    hard:   { label: 'Hard',   lanes: 4, fall: 1.45, minGap: 2, holdGap: 5,  traps: true,  missCost: 9,  color: '#ff5d6c' },
  };

  // Lanes are vendors — colour + name read left-to-right across the highway.
  // Distinct hues per lane (a nod to each vendor's brand, but spread around the
  // wheel so adjacent lanes never read as the same colour): AWS orange, GCP blue,
  // Azure teal, Databricks red, Snowflake ice-blue.
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
    function drawBiomeBackground(bio, props) {
      ctx2d.fillStyle = bio.floor; ctx2d.fillRect(0, 0, W, H);
      if (bio.sky) {
        const sg = ctx2d.createLinearGradient(0, 0, 0, H);
        sg.addColorStop(0, bio.sky[0]); sg.addColorStop(1, bio.sky[1]);
        ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = sg; ctx2d.fillRect(0, 0, W, H); ctx2d.globalAlpha = 1;
      }
    }

    // ---- persistent meta ----
    const store = loadStore();
    const meta = Object.assign({ records: {}, plays: 0, lastSong: 0, lastDiff: 'medium', calibMs: 0, muted: false },
      opts.meta || store.meta || {});
    function persist() {
      if (opts.persist === false) return;
      store.meta = meta; saveStore(store);
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
      if (!isFinite(globalHi)) globalHi = 72;

      // gap (in steps) from src to the next non-null lead step
      const gapAt = (src) => { let k = 1; while (k < LL && lead[(src + k) % LL] == null) k++; return k; };

      // Pass 1: keep real melody onsets, thinned only by the difficulty's minGap.
      // No ramp — every kept note is a note you actually hear, so chart == tune.
      const kept = [];
      let lastKept = -Infinity;
      for (let S = 0; S < noteCut; S++) {
        const src = (startStepAbs + S) % LL;
        const m = lead[src];
        if (m == null) continue;
        if (S - lastKept < diff.minGap) continue;
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
          keys: KEYS[diff.lanes],
          beginTime: firstStep0 + startStepAbs * stepDur + lat,
          beatRef: firstStep0 + lat, beatDur: stepDur * 4,   // for beat-synced visuals
          score: 0, combo: 0, maxCombo: 0, mult: 1,
          bill: 0, tokens: 0,
          counts: { perfect: 0, great: 0, ok: 0, miss: 0, trap: 0 },
          total: chart.notes.filter(n => n.type !== 'trap').length,
          laneFlash: new Array(diff.lanes).fill(0),
          pops: [], parts: [], shake: 0, tint: 0, hostBob: 0, tip: null, tipN: 0, anom: false,
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
          startStepAbs = Math.ceil((now + PREROLL - firstStep0) / stepDur);
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
      let grade = r.failed ? 'F'
        : acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.70 ? 'B' : acc >= 0.50 ? 'C' : 'D';
      const tokens = Math.max(0, Math.floor(r.score / 250));
      if (global.ArcadeWallet && tokens) global.ArcadeWallet.earn(tokens, 'costbot-hero');

      // record best (by score) per song+difficulty
      const rec = meta.records[r.song.key] || (meta.records[r.song.key] = {});
      const prev = rec[diffKey];
      const better = !prev || r.score > prev.score;
      if (better) rec[diffKey] = { score: r.score, grade, combo: r.maxCombo, acc: Math.round(acc * 100) };
      meta.plays++; persist();

      // "lesson of the run" — tie the takeaway to how it went
      const missRatio = r.total ? c.miss / r.total : 0;
      const lesson = r.failed
        ? 'Budget blown — set anomaly alerts so runaway spend is caught fast.'
        : missRatio > 0.25
          ? 'Consistency compounds: steady small cuts beat big one-offs.'
          : TIPS[(r.tipN + r.maxCombo) % TIPS.length];
      run.result = { grade, acc: Math.round(acc * 100), tokens, best: better, tip: lesson };
      run.resultAt = performance.now();   // for the crossfade into the results screen
      state = 'result';
      emit('run:end', { song: r.song.key, diff: diffKey });

      const payload = {
        game: 'costbot-hero',
        stageId: r.song.key + ':' + diffKey,
        outcome: r.failed ? 'fail' : 'clear',
        tokensEarned: tokens,
        dollarsSaved: 0,          // fun-first: this cabinet does not save real money
        score: r.score, combo: r.maxCombo, accuracy: Math.round(acc * 100),
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
      if (down && k === 'm') { toggleMute(); return; }   // mute hotkey, any state
      if (state === 'menu') {
        if (!down) return;
        if (k === 'arrowup') { songIdx = (songIdx + SONGS.length - 1) % SONGS.length; SFX.ui(); }
        else if (k === 'arrowdown') { songIdx = (songIdx + 1) % SONGS.length; SFX.ui(); }
        else if (k === 'arrowleft' || k === 'arrowright') {
          const order = ['easy', 'medium', 'hard'];
          let i = order.indexOf(diffKey) + (k === 'arrowright' ? 1 : -1);
          diffKey = order[clamp(i, 0, 2)]; SFX.ui();
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
    global.addEventListener('keydown', (e) => onKey(true, e));
    global.addEventListener('keyup', (e) => onKey(false, e));

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
      if (state === 'menu') { handleMenuClick(x, y); return; }
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
    function LANE_COLOR() { const r = arguments[0], l = arguments[1]; return PALETTE[l % PALETTE.length]; }
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
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      update(dt);
      draw();
      requestAnimationFrame(frame);
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
      if (run.tip) { run.tip.life -= dt; if (run.tip.life <= 0) run.tip = null; }
      for (const p of run.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 640 * dt; p.life -= dt * 1.3; }
      run.parts = run.parts.filter(p => p.life > 0);
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
      if (state === 'result') drawResult();
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

    // ---- menu ----
    let menuHit = [];
    function drawMenu() {
      menuHit = [];
      const cx = W / 2;
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = '#ffd76a';
      ctx2d.font = '800 46px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('CostBot Hero', cx, 92);
      ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '600 15px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('Cut the spend on the beat. Miss and the bill balloons.', cx, 120);

      // song list
      const top = 160, rowH = 58, listW = Math.min(W * 0.86, 460), lx = cx - listW / 2;
      for (let i = 0; i < SONGS.length; i++) {
        const y = top + i * rowH;
        const sel = i === songIdx;
        ctx2d.fillStyle = sel ? 'rgba(255,215,106,.14)' : 'rgba(255,255,255,.04)';
        rrect(lx, y, listW, rowH - 10, 10); ctx2d.fill();
        ctx2d.strokeStyle = sel ? '#ffd76a' : '#26324f'; ctx2d.lineWidth = sel ? 2 : 1;
        rrect(lx, y, listW, rowH - 10, 10); ctx2d.stroke();
        ctx2d.textAlign = 'left';
        ctx2d.fillStyle = sel ? '#fff' : '#c4d0e8'; ctx2d.font = '700 20px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(SONGS[i].name, lx + 18, y + 26);
        ctx2d.fillStyle = '#8194b6'; ctx2d.font = '500 13px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(SONGS[i].sub, lx + 18, y + 43);
        if (SONGS[i].tag) {
          ctx2d.fillStyle = '#39d98a'; ctx2d.font = '800 12px Segoe UI, system-ui, sans-serif';
          ctx2d.textAlign = 'right'; ctx2d.fillText(SONGS[i].tag, lx + listW - 16, y + 22);
        }
        // best score for current diff
        const rec = meta.records[SONGS[i].key] && meta.records[SONGS[i].key][diffKey];
        if (rec) {
          ctx2d.textAlign = 'right'; ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '700 13px Segoe UI, system-ui, sans-serif';
          ctx2d.fillText(rec.grade + ' · ' + fmt$(rec.score), lx + listW - 16, y + 42);
        }
        menuHit.push({ x: lx, y, w: listW, h: rowH - 10, kind: 'song', i });
      }

      // difficulty
      const dy = top + SONGS.length * rowH + 16;
      ctx2d.textAlign = 'center'; ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '600 14px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('DIFFICULTY', cx, dy);
      const order = ['easy', 'medium', 'hard'];
      const bw = 108, gap = 12, totalW = bw * 3 + gap * 2, bx = cx - totalW / 2, by = dy + 12;
      order.forEach((dk, i) => {
        const x = bx + i * (bw + gap), sel = dk === diffKey, d = DIFFS[dk];
        ctx2d.fillStyle = sel ? d.color : 'rgba(255,255,255,.05)';
        rrect(x, by, bw, 40, 9); ctx2d.fill();
        ctx2d.fillStyle = sel ? '#06121a' : '#c4d0e8'; ctx2d.font = '800 16px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(d.label, x + bw / 2, by + 26);
        menuHit.push({ x, y: by, w: bw, h: 40, kind: 'diff', dk });
      });

      // start button
      const sbW = 220, sbX = cx - sbW / 2, sbY = by + 60;
      ctx2d.fillStyle = '#ffd76a'; rrect(sbX, sbY, sbW, 48, 12); ctx2d.fill();
      ctx2d.fillStyle = '#06121a'; ctx2d.font = '800 20px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('▶  PLAY', cx, sbY + 31);
      menuHit.push({ x: sbX, y: sbY, w: sbW, h: 48, kind: 'start' });

      // audio sync calibration
      const yc = sbY + 74;
      ctx2d.textAlign = 'center'; ctx2d.fillStyle = '#8194b6'; ctx2d.font = '700 11px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('AUDIO SYNC', cx, yc - 8);
      const cbw = 32, cvw = 96, cgap = 8, ctot = cbw * 2 + cvw + cgap * 2, cxs = cx - ctot / 2;
      ctx2d.fillStyle = 'rgba(255,255,255,.08)'; rrect(cxs, yc, cbw, 30, 8); ctx2d.fill();
      ctx2d.fillStyle = '#dfe8f7'; ctx2d.font = '800 18px Segoe UI'; ctx2d.fillText('−', cxs + cbw / 2, yc + 21);
      menuHit.push({ x: cxs, y: yc, w: cbw, h: 30, kind: 'calib', d: -5 });
      ctx2d.fillStyle = '#c4d0e8'; ctx2d.font = '800 15px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(((meta.calibMs > 0 ? '+' : '') + (meta.calibMs || 0) + ' ms'), cx, yc + 21);
      const pxb = cxs + cbw + cgap + cvw + cgap;
      ctx2d.fillStyle = 'rgba(255,255,255,.08)'; rrect(pxb, yc, cbw, 30, 8); ctx2d.fill();
      ctx2d.fillStyle = '#dfe8f7'; ctx2d.font = '800 18px Segoe UI'; ctx2d.fillText('+', pxb + cbw / 2, yc + 21);
      menuHit.push({ x: pxb, y: yc, w: cbw, h: 30, kind: 'calib', d: 5 });

      ctx2d.fillStyle = '#5b6b8c'; ctx2d.font = '500 11px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('tiles landing early? +   ·   late? −   ·   (or press [ and ])', cx, yc + 48);
      ctx2d.fillText('↑↓ song · ←→ difficulty · Enter to play', cx, yc + 66);

      // rotating "Did you know?" FinOps stat
      const dyk = DYK[Math.floor(performance.now() / 6000) % DYK.length];
      ctx2d.fillStyle = '#cfe9e2'; ctx2d.font = '600 12px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('💡  Did you know?  ' + dyk, cx, yc + 96);
    }
    function handleMenuClick(x, y) {
      for (const h of menuHit) {
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
          if (h.kind === 'song') { songIdx = h.i; SFX.ui(); }
          else if (h.kind === 'diff') { diffKey = h.dk; SFX.ui(); }
          else if (h.kind === 'calib') { meta.calibMs = clamp((meta.calibMs || 0) + h.d, -300, 300); persist(); SFX.ui(); }
          else if (h.kind === 'start') { initAudio(); startSong(); }
          return;
        }
      }
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
          const col = PALETTE[n.lane];               // gold notes keep the lane colour...
          const tlen = 82 * s;                       // comet trail toward the horizon
          const tg = ctx2d.createLinearGradient(0, y - tlen, 0, y);
          tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, hexA(gold ? '#ffd76a' : col, 0.30));
          ctx2d.fillStyle = tg; ctx2d.fillRect(cx - rW * 0.24, y - tlen, rW * 0.48, tlen);
          // ...but glow gold so they still read as the ×3 bonus
          ctx2d.shadowColor = gold ? '#ffd76a' : col; ctx2d.shadowBlur = (gold ? 22 : 9) * s;
          ctx2d.fillStyle = col; rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.fill();
          ctx2d.shadowBlur = 0;
          if (gold) {                                // gold rim marks the bonus note
            ctx2d.strokeStyle = '#ffd76a'; ctx2d.lineWidth = Math.max(1.5, 2.6 * s);
            rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.stroke();
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

      drawHost();

      // particles + pops
      for (const p of run.parts) {
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
      ctx2d.save();
      ctx2d.shadowColor = hot > 0.6 ? '#ff5d6c' : '#39d98a';
      // baseline raised from 12 -> 20 so the hero art reads as clearly glowing
      // even at zero combo/bill-heat, not just once things heat up.
      ctx2d.shadowBlur = 20 + run.tint * 20 + hot * 26;
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

      ctx2d.save();
      ctx2d.globalAlpha = 0.65;
      ctx2d.drawImage(img, dx, dy, dw, dh);
      ctx2d.restore();

      // light dark scrim, heavier toward the edges than the centre, so the
      // highway/notes/HUD keep reliable contrast regardless of how bright or
      // busy the source image is — kept subtle so the art still reads as
      // vivid "wallpaper" rather than faded.
      const scrim = ctx2d.createRadialGradient(
        W / 2, H * 0.45, Math.min(W, H) * 0.18,
        W / 2, H * 0.5, Math.max(W, H) * 0.75);
      scrim.addColorStop(0, 'rgba(5,6,15,.12)');
      scrim.addColorStop(1, 'rgba(5,6,15,.32)');
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
      // time-remaining pill, top-right — clear of the top-left song/diff/bill
      // block and (in the normal wide layout) clear of the score, which now
      // lives above the host on the left instead of this corner.
      const remainSecs = Math.max(0, run.chart.endTime - actx.currentTime);
      const mm = Math.floor(remainSecs / 60), ss = Math.floor(remainSecs % 60);
      const timeStr = mm + ':' + (ss < 10 ? '0' : '') + ss;
      ctx2d.fillStyle = 'rgba(5,6,15,.55)'; rrect(W - 78, barH + 5, 64, 24, 7); ctx2d.fill();
      ctx2d.textAlign = 'right'; ctx2d.fillStyle = '#ffe9a8';
      ctx2d.font = '800 16px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(timeStr, W - 20, barH + 23);

      // top-left: song + difficulty, then the bill meter (grouped, no stray text)
      ctx2d.textAlign = 'left';
      ctx2d.fillStyle = '#dfe8f7'; ctx2d.font = '700 15px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(run.song.name, 18, 26);
      ctx2d.fillStyle = run.diff.color; ctx2d.font = '700 11px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(run.diff.label.toUpperCase(), 18, 42);

      const bw = Math.min(W * 0.42, 260), bx = 18, by = 54;
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
        ctx2d.fillText('×' + run.mult + ' combo', W / 2, 64);
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
        .ch-songs{display:flex;flex-direction:column;gap:8px;}
        .ch-song{display:flex;justify-content:space-between;align-items:center;gap:10px;
          padding:10px 14px;border-radius:11px;border:1px solid #26324f;background:rgba(255,255,255,.03);
          cursor:pointer;transition:border-color .12s,background .12s;}
        .ch-song:hover{border-color:#5a7cb5;}
        .ch-song.sel{border-color:#ffd76a;background:rgba(255,215,106,.12);}
        .ch-song .nm{font-weight:700;font-size:15px;color:#eaf1ff;}
        .ch-song .sub{font-size:12px;color:#8194b6;margin-top:1px;}
        .ch-song .best{font-size:12px;font-weight:700;color:#ffd76a;white-space:nowrap;}
        .ch-diffs{display:flex;gap:8px;}
        .ch-diff{flex:1;padding:11px 0;border-radius:10px;border:1px solid #26324f;
          background:rgba(255,255,255,.04);text-align:center;font-weight:800;font-size:14px;
          color:#c4d0e8;cursor:pointer;transition:.12s;}
        .ch-how{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        @media(max-width:460px){.ch-how{grid-template-columns:1fr;}}
        .ch-card{padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid #1e2942;}
        .ch-card .k{font-weight:800;font-size:12px;color:#eaf1ff;margin-bottom:2px;}
        .ch-card .d{font-size:11px;color:#8ea3cc;line-height:1.38;}
        .ch-play{align-self:center;margin-top:2px;padding:14px 50px;border:none;border-radius:12px;
          background:#ffd76a;color:#06121a;font-weight:800;font-size:19px;cursor:pointer;
          box-shadow:0 8px 24px rgba(255,215,106,.3);transition:transform .1s;}
        .ch-play:hover{transform:translateY(-2px);}
        .ch-board{align-self:center;text-decoration:none;color:#c4d0e8;font-weight:700;font-size:13px;
          padding:8px 18px;border-radius:9px;border:1px solid #2b3f66;background:rgba(255,255,255,.04);
          transition:border-color .12s,color .12s;}
        .ch-board:hover{border-color:#5a7cb5;color:#fff;}
        .ch-calib{display:flex;align-items:center;justify-content:center;gap:10px;color:#8194b6;font-size:12px;flex-wrap:wrap;}
        .ch-calib button{width:30px;height:28px;border-radius:8px;border:1px solid #2b3f66;
          background:rgba(255,255,255,.06);color:#dfe8f7;font-weight:800;font-size:16px;cursor:pointer;}
        .ch-calib b{color:#c4d0e8;min-width:62px;text-align:center;}
        .ch-foot{text-align:center;color:#5b6b8c;font-size:11px;}`;
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
              <div class="ch-songs" id="ch-songs"></div>
              <div class="ch-lbl" style="margin-top:16px">DIFFICULTY</div>
              <div class="ch-diffs" id="ch-diffs"></div>
            </div>
            <div>
              <div class="ch-lbl">HOW TO PLAY</div>
              <div class="ch-how">
                <div class="ch-card"><div class="k">🎯 Hit on the beat</div><div class="d">Notes fall down vendor lanes — AWS, GCP, Azure, Databricks. Tap the lane key as each note crosses the line.</div></div>
                <div class="ch-card"><div class="k">⌨️ Controls</div><div class="d">A S D F, or tap the lanes on a touchscreen. Press M to mute.</div></div>
                <div class="ch-card"><div class="k">🔒 Holds = commitments</div><div class="d">Hold through the tail to lock in a Savings Plan / RI. Longer holds pay more.</div></div>
                <div class="ch-card"><div class="k">💰 Gold notes</div><div class="d">The song's peak note pays ×3 — a big savings win. Build combos for up to ×8.</div></div>
                <div class="ch-card"><div class="k">📈 Mind the bill</div><div class="d">Misses balloon the bill meter. Blow the budget and the run ends early.</div></div>
                <div class="ch-card"><div class="k">🚫 Don't cut PROD</div><div class="d">On Hard, ✕ trap notes are production — hit one and the bill jumps. Let them fall past.</div></div>
              </div>
            </div>
          </div>
          <button class="ch-play" id="ch-play">▶&nbsp;&nbsp;PLAY</button>
          <a class="ch-board" href="../leaderboard/index.html#costbot-hero">🏆 Leaderboard</a>
          <div class="ch-calib">
            <span>Audio sync</span>
            <button id="ch-cal-down">−</button><b id="ch-cal-val">0 ms</b><button id="ch-cal-up">+</button>
            <span style="opacity:.7">tiles landing early? +&nbsp;&nbsp;·&nbsp;&nbsp;late? −</span>
          </div>
          <div class="ch-foot">↑↓ song&nbsp;·&nbsp;←→ difficulty&nbsp;·&nbsp;Enter to play&nbsp;·&nbsp;high scores post to the arcade leaderboard</div>
        </div>`;
      host.appendChild(menuEl);

      const songsWrap = menuEl.querySelector('#ch-songs');
      SONGS.forEach((s, i) => {
        const el = document.createElement('div');
        el.className = 'ch-song'; el.dataset.i = i;
        el.innerHTML = `<div><div class="nm">${s.name}</div><div class="sub">${s.sub}</div></div><div class="best" data-best></div>`;
        el.onclick = () => { songIdx = i; SFX.ui(); syncMenu(); };
        songsWrap.appendChild(el);
      });
      const diffsWrap = menuEl.querySelector('#ch-diffs');
      ['easy', 'medium', 'hard'].forEach((dk) => {
        const el = document.createElement('div');
        el.className = 'ch-diff'; el.dataset.dk = dk; el.textContent = DIFFS[dk].label;
        el.onclick = () => { diffKey = dk; SFX.ui(); syncMenu(); };
        diffsWrap.appendChild(el);
      });
      menuEl.querySelector('#ch-play').onclick = () => { initAudio(); startSong(); };
      menuEl.querySelector('#ch-cal-down').onclick = () => { meta.calibMs = clamp((meta.calibMs || 0) - 5, -300, 300); persist(); SFX.ui(); syncMenu(); };
      menuEl.querySelector('#ch-cal-up').onclick = () => { meta.calibMs = clamp((meta.calibMs || 0) + 5, -300, 300); persist(); SFX.ui(); syncMenu(); };
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
        wash.style.backgroundImage =
          'linear-gradient(rgba(5,6,15,.35),rgba(8,10,20,.58)), url("../shared/assets/' + file + '")';
        wash.style.opacity = '1';
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
        el.classList.toggle('sel', i === songIdx);
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

    requestAnimationFrame(frame);
    emit('ready', {});

    return {
      get meta() { return meta; },
      get muted() { return !!meta.muted; },
      toggleMute,
      destroy() { stopRunAudio(run); cv.remove(); },
    };
  }

  global.CostBotHero = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
