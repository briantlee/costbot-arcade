/* ============================================================================
 * Holiday in Colombia — ENGINE
 * ----------------------------------------------------------------------------
 * A fishing cabinet. Three skill checks per fish, each one a different shape:
 *
 *   CAST   a sweeping power meter, stopped with one press -> picks the depth
 *   BITE   a reaction window when the bobber goes under   -> clean hook or not
 *   REEL   a containment bar you hold to raise            -> lands it or loses it
 *
 * All three are one-dimensional, which is the whole reason this game is cheap:
 * no world, no collision, no camera. Every fish is a motion profile and a
 * payout, both of which live in hc-content.js.
 *
 *   HolidayInColombia.mount(container, { onComplete, onEvent, profile })
 * ==========================================================================*/
((global) => {
  'use strict';

  const C = global.HC_CONTENT;
  const VW = 1152;
  const VH = 648;
  const WATER_Y = VH * 0.42;          // the surface
  const LAKE_H = VH - WATER_Y;
  const TAU = Math.PI * 2;
  const STORE_KEY = 'costbot.holiday.v1';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // Deterministic 0..1 hash. Terrain detail must be stable frame to frame or
  // the whole mountain range crawls.
  const noise = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  // The arcade's shared purse. Absent only if the script failed to load, in
  // which case the game still runs — it just cannot pay out.
  const NO_WALLET = { tokens: 0, earn: () => 0, spend: () => false, bank: () => 0,
    init: () => ({}), onChange: () => () => {} };
  const wallet = () => global.ArcadeWallet || NO_WALLET;

  // ---- canvas helpers -------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
  }

  // Brushed metal, matching the DOM modals.
  //
  // Deliberately CRISP. The first version leaned on a 26px drop shadow, a broad
  // diagonal wash and a translucent face, and the three together read as fog
  // rather than as metal. Sharpness is what sells a machined surface: a tight
  // shadow, a near-opaque face, one hard specular line along the top inside
  // edge, and a bright 1px border with a dark one just inside it.
  function panel(ctx, x, y, w, h, r) {
    const k = r || 14;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(52,72,86,.97)');
    g.addColorStop(0.30, 'rgba(26,42,54,.98)');
    g.addColorStop(0.32, 'rgba(20,34,45,.98)');   // hard break = a rolled edge
    g.addColorStop(1, 'rgba(9,18,25,.99)');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, k > 0 ? h : h, k); ctx.fill();
    ctx.restore();

    // one tight specular streak across the top third, not a wash over the whole face
    ctx.save();
    roundRect(ctx, x, y, w, h, k); ctx.clip();
    const sh = ctx.createLinearGradient(0, y, 0, y + h * 0.32);
    sh.addColorStop(0, 'rgba(226,248,255,.20)');
    sh.addColorStop(1, 'rgba(226,248,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, w, h * 0.32);
    ctx.restore();

    // hard highlight inside the top edge, hard shade inside the bottom
    ctx.strokeStyle = 'rgba(214,246,255,.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + k * 0.8, y + 1.5); ctx.lineTo(x + w - k * 0.8, y + 1.5); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.moveTo(x + k * 0.8, y + h - 1.5); ctx.lineTo(x + w - k * 0.8, y + h - 1.5); ctx.stroke();
    // the bright rim, then a dark one immediately inside it
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, k);
    ctx.strokeStyle = 'rgba(150,206,232,.62)'; ctx.lineWidth = 1; ctx.stroke();
    roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, k - 1);
    ctx.strokeStyle = 'rgba(0,0,0,.38)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // lighten (>1) or darken (<1) a #rrggbb
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.round(clamp(v * k, 0, 255)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  // Local calendar day, not UTC — the free bait should land at the player's
  // midnight, not at some hour that drifts with their timezone.
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const ALL_CATCHES = () => C.FISH.concat(C.JUNK);
  // Ends of the rarity scale, for the perfect-cast weighting below.
  const RAREST = Math.min(...C.FISH.concat(C.JUNK).map((f) => f.rarity));
  const COMMONEST = Math.max(...C.FISH.concat(C.JUNK).map((f) => f.rarity));

  // Palette: the lake from the artwork — green hills, a blue-green surface,
  // and water that goes cold and dark fast.
  // Sampled off costbot_colombia.jpg: a pale hazy sky, blue-grey Andes with
  // cloud caught on them, terraced coffee green in three values, and water that
  // is green near the bank and blue-black out in the middle.
  const SKY = ['#5fb4d8', '#95d3e8', '#d8eeee', '#f3ecdc'];
  // Colour, not grey. Far ridges go dusty violet the way real distance does,
  // the middle sits blue-teal, and the nearest picks up green off the forest —
  // so the range reads as three different distances instead of three greys.
  const RIDGE = ['#93a0c4', '#6d8ba4', '#4d7a7c'];
  const RIDGE_LIT = ['rgba(255,224,178,', 'rgba(255,216,158,', 'rgba(255,228,150,'];
  const RIDGE_SHADE = ['rgba(78,66,120,', 'rgba(40,62,92,', 'rgba(22,58,62,'];
  const HILL = ['#4a8442', '#3c7038', '#2d5a2d', '#1f4522'];
  const PALM = { trunk: '#4a3a24', frond: '#2f6b33', frondLit: '#438c40' };

  function defaultProfile() {
    return {
      lifetimeTokens: 0,
      bait: 0,
      dex: {},                 // speciesId -> { caught, best (kg) }
      achievements: [],
      lastDaily: null,
      triviaSeen: [],
      triviaBait: 0,
      history: [],
      best: { tokens: 0, heaviest: 0, fish: 0, streak: 0 },
    };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return migrate(Object.assign(defaultProfile(), JSON.parse(raw)));
    } catch { return null; }
  }

  // Bait used to be {chum, lure, golden}. Anyone who played the tiered build has
  // that object in localStorage; fold it into a single count rather than
  // silently zeroing what they earned.
  //
  // This also repairs a save that already went wrong. When an un-migrated object
  // reached `p.bait = p.bait + n`, JS did not add — it CONCATENATED, giving
  // "[object Object]3456" after a four-question trivia streak. A string is not
  // > 0, so casting instantly failed the out-of-bait check and ended the run on
  // the first press of space. Anything unparseable resets to zero and the daily
  // top-up refills it on the same load.
  function migrate(p) {
    if (p && p.bait && typeof p.bait === 'object') {
      p.bait = Object.values(p.bait).reduce((n, v) => n + (Number(v) || 0), 0);
    }
    p.bait = baitNum(p.bait);
    return p;
  }

  // Every read and write of the bait count goes through these two. The bug above
  // was not a one-off typo — it was four separate call sites each assuming the
  // field was already a number.
  const baitNum = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  function saveLocal(p) {
    // Stamped so a server copy that missed a write cannot pass itself off as the
    // newer one — ArcadeSync.reconcile() reads this.
    p.savedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  }

  // The daily handout. Top-up rather than grant, so a week away does not become
  // a stockpile — every day starts the same whether you played yesterday or not.
  function grantDaily(p) {
    const d = today();
    if (!C.DAILY.everyLoad && p.lastDaily === d) return 0;
    const have = baitNum(p.bait);
    const given = C.DAILY.mode === 'grant'
      ? C.DAILY.freeBait
      : Math.max(0, C.DAILY.freeBait - have);
    addBait(p, given);
    p.lastDaily = d;
    return given;
  }

  const totalBait = (p) => baitNum(p.bait);
  const addBait = (p, n) => { p.bait = baitNum(baitNum(p.bait) + (Number(n) || 0)); return p.bait; };

  // ---------------------------------------------------------------------------
  // Which fish is on the line. The draw is filtered to the band the cast
  // actually reached, then weighted by rarity — so depth is the only thing that
  // gates a species, and rarity only decides which of the reachable ones shows.
  // ---------------------------------------------------------------------------
  // Nothing is ever locked out of the draw. A fish above your cast depth is only
  // mildly less likely; a fish below it is heavily discounted but never zero, so
  // a freak Opah off a mediocre cast stays possible — and a perfect cast into
  // the Abyss is how you make one likely.
  function drawWeight(fish, band, perfect) {
    const d = fish.band - band;
    const w = d <= 0
      ? fish.rarity * C.DRAW.shallowerFalloff ** -d
      : fish.rarity * C.DRAW.deeperFalloff ** d;
    if (!perfect || fish.band === 0) return w;
    // A perfect cast is worth the most to the rarest thing within reach.
    //
    // Two false starts are worth recording. Boosting only fish DEEPER than the
    // cast does nothing in the Abyss, because nothing is deeper than you there
    // — exactly where you are hunting a Fable. And boosting the whole band
    // equally is a no-op: every weight scales, so the shares never move. So the
    // multiplier is scaled by depth AND by how rare the fish is, which is the
    // only version that actually makes a perfect cast the way to find a Fable.
    const depth = fish.band / (C.BANDS.length - 1);
    const rareness = (COMMONEST - fish.rarity) / Math.max(1, COMMONEST - RAREST);
    return w * (1 + (C.DRAW.perfectCastBonus - 1) * depth * clamp(rareness, 0, 1));
  }

  function pickSpecies(band, rng, perfect) {
    const r = rng || Math.random;
    const pool = ALL_CATCHES();
    const weights = pool.map((f) => drawWeight(f, band, perfect));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = r() * total;
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  // How big the fish is, and the payout follows it exactly — so a personal-best
  // Opus is worth real tokens over an average one.
  //
  // Weight is mostly the CAST: `acc` is 1 for a cast on the mark and 0 for one
  // that only just stayed inside its zone, and it slides the nominal weight from
  // sizeAtEdge to sizeAtMark. Missing the mark used to cost nothing at all here
  // — every fish rolled the same ±20% whatever the cast — so accuracy paid only
  // in a rarity nudge nobody could see. Now it is the whole point: aim well and
  // land a bigger fish, aim loosely and it still bites, just small.
  //
  // `acc` defaults to a middling cast so an unqualified call still behaves.
  function rollCatch(def, rng, acc) {
    const r = rng || Math.random;
    const a = clamp(acc === undefined ? 0.5 : acc, 0, 1);
    const K = C.CAST;
    // A middling cast still averages the old nominal weight, so this redirects
    // the payout towards skill rather than inflating it.
    const base = K.sizeAtEdge + (K.sizeAtMark - K.sizeAtEdge) * a;
    // spread is symmetric about the earned size, and never dips below the floor
    const jitter = Math.max(0.5, base + (r() * 2 - 1) * K.sizeSpread);
    return {
      def,
      kg: +(def.kg * jitter).toFixed(def.kg < 2 ? 2 : 1),
      tokens: Math.round(def.tokens * jitter),
    };
  }

  // speed = how fast it comes in while you reel
  // runs  = how often and how long it bolts
  // pull  = how hard it loads the line, i.e. how fast tension builds
  function fightProfile(def) {
    const base = def.junk ? C.JUNK_FIGHT : (C.TIER_FIGHT[def.tier] || C.TIER_FIGHT.sonnet);
    return { speed: base.speed, runs: base.runs, pull: base.pull };
  }


  // ---------------------------------------------------------------------------
  // FISH PORTRAITS
  //   A real side-view per family, drawn on canvas — no image assets, same as
  //   the rest of the arcade. The four silhouettes are deliberately nothing like
  //   each other, because the catch card only feels like a reward if you can
  //   tell at a glance WHAT you pulled out of the lake: a slim herring, a
  //   sailfish with the sail up, the opah's dinner-plate body, and the long
  //   deep-water sablefish.
  // ---------------------------------------------------------------------------
  const PALETTE = {
    herring: { back: '#2f6f8c', mid: '#8fc4d8', belly: '#eaf6fb', fin: '#3f88a4', eye: '#0d1c26' },
    sailfish: { back: '#1e4b8c', mid: '#4f8fd0', belly: '#e6f1fb', fin: '#2a5fa8', eye: '#08131f' },
    opah: { back: '#8c3a4a', mid: '#c86a72', belly: '#f0d9d2', fin: '#e2483c', eye: '#1a0d10' },
    sablefish: { back: '#6b5320', mid: '#c79a3a', belly: '#f4e2ae', fin: '#8a6a24', eye: '#1a1408' },
  };

  function fishBody(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 3) {
      ctx.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
        pts[i + 2][0], pts[i + 2][1]);
    }
    ctx.closePath();
  }

  // Everything is drawn in a -1..1 box and scaled by the caller, so the same
  // routine serves a 150px catch card and a 44px fishdex thumbnail.
  function drawSpecies(ctx, art, size) {
    const P = PALETTE[art] || PALETTE.herring;
    const S = size / 2;
    ctx.save();
    ctx.scale(S, S);
    ctx.lineJoin = 'round';

    const grad = (y0, y1) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, P.back); g.addColorStop(0.52, P.mid); g.addColorStop(1, P.belly);
      return g;
    };
    const fin = (a, b, c) => {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
      ctx.closePath(); ctx.fillStyle = P.fin; ctx.fill();
    };
    const eye = (x, y, r) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = P.eye;
      ctx.beginPath(); ctx.arc(x + r * 0.15, y, r * 0.58, 0, TAU); ctx.fill();
    };

    if (art === 'sailfish') {
      // the sail goes down first so the body overlaps its base
      ctx.fillStyle = P.fin;
      ctx.beginPath();
      ctx.moveTo(-0.30, -0.14);
      ctx.bezierCurveTo(-0.16, -0.92, 0.30, -0.90, 0.42, -0.16);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.016;
      for (let i = -2; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(i * 0.13, -0.16);
        ctx.lineTo(i * 0.11, -0.72 + Math.abs(i) * 0.09); ctx.stroke();
      }
      fin([-0.62, 0.02], [-0.98, -0.34], [-0.94, 0.34]);              // tail
      fin([0.10, 0.16], [0.02, 0.52], [0.34, 0.22]);                  // pelvic
      ctx.fillStyle = grad(-0.24, 0.26);
      fishBody(ctx, [[0.98, -0.02],
        [0.62, -0.22], [0.10, -0.26], [-0.34, -0.16],
        [-0.56, -0.10], [-0.60, 0.10], [-0.34, 0.18],
        [0.14, 0.28], [0.66, 0.20], [0.98, -0.02]]);
      ctx.fill();
      eye(0.44, -0.06, 0.075);
    } else if (art === 'opah') {
      // a dinner plate with fins — the real thing genuinely looks like this
      fin([-0.52, 0.00], [-0.92, -0.30], [-0.90, 0.30]);
      ctx.fillStyle = grad(-0.66, 0.66);
      ctx.beginPath();
      ctx.ellipse(0.02, 0, 0.62, 0.66, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = P.fin;                                          // long dorsal + anal
      ctx.beginPath();
      ctx.moveTo(-0.10, -0.62); ctx.quadraticCurveTo(0.32, -0.96, 0.46, -0.44);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.10, 0.62); ctx.quadraticCurveTo(0.20, 0.92, 0.40, 0.46);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                                                 // pectoral
      ctx.ellipse(0.20, 0.10, 0.10, 0.26, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.34)';                         // the white spots
      for (let i = 0; i < 16; i++) {
        const a = i * 2.399, rr = 0.13 + (i % 5) * 0.10;
        ctx.beginPath();
        ctx.arc(0.02 + Math.cos(a) * rr * 0.9, Math.sin(a) * rr, 0.035, 0, TAU);
        ctx.fill();
      }
      eye(0.42, -0.16, 0.085);
    } else if (art === 'sablefish') {
      fin([-0.66, 0.00], [-0.99, -0.30], [-0.97, 0.30]);
      ctx.fillStyle = grad(-0.30, 0.30);
      fishBody(ctx, [[0.96, 0.02],
        [0.66, -0.24], [0.10, -0.30], [-0.40, -0.20],
        [-0.60, -0.14], [-0.64, 0.14], [-0.40, 0.20],
        [0.10, 0.30], [0.68, 0.22], [0.96, 0.02]]);
      ctx.fill();
      ctx.fillStyle = P.fin;                                           // two dorsals
      ctx.beginPath();
      ctx.moveTo(0.34, -0.26); ctx.quadraticCurveTo(0.22, -0.58, 0.02, -0.28);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.16, -0.27); ctx.quadraticCurveTo(-0.28, -0.52, -0.42, -0.20);
      ctx.closePath(); ctx.fill();
      fin([-0.10, 0.28], [-0.24, 0.54], [-0.38, 0.20]);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.moveTo(-0.58, 0.0); ctx.lineTo(0.78, -0.02); ctx.stroke();
      eye(0.60, -0.05, 0.07);
    } else {
      // herring — slim, forked tail, nothing showy
      fin([-0.50, 0.00], [-0.92, -0.34], [-0.90, 0.34]);
      ctx.fillStyle = grad(-0.28, 0.28);
      fishBody(ctx, [[0.92, 0.00],
        [0.60, -0.20], [0.10, -0.28], [-0.30, -0.16],
        [-0.48, -0.10], [-0.50, 0.10], [-0.30, 0.16],
        [0.10, 0.28], [0.62, 0.20], [0.92, 0.00]]);
      ctx.fill();
      fin([0.06, -0.26], [-0.06, -0.52], [-0.22, -0.20]);
      fin([-0.02, 0.26], [-0.14, 0.48], [-0.28, 0.18]);
      ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 0.022;
      ctx.beginPath(); ctx.moveTo(-0.44, 0.0); ctx.lineTo(0.74, -0.01); ctx.stroke();
      eye(0.56, -0.05, 0.07);
    }
    ctx.restore();
  }

  // Cached data URLs, so the fishdex can render eight thumbnails as plain <img>
  // without eight live canvases.
  const portraits = {};
  function portrait(def, px) {
    // Keyed by the SPECIES for junk, not by the (absent) `art` field. Every junk
    // item used to hash to the literal string "junk", so whichever one was drawn
    // first won the cache and the boot, the tyre and the crate all came back as
    // the zombie NAT gateway.
    const key = (def.art || 'junk-' + def.id) + ':' + px;
    if (portraits[key]) return portraits[key];
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    const x = c.getContext('2d');
    x.translate(px / 2, px / 2);
    if (def.art) drawSpecies(x, def.art, px * 0.92);
    else {                                    // junk gets its emoji, not a fish
      x.font = `${Math.round(px * 0.6)}px 'Segoe UI Emoji','Segoe UI',sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(def.icon || '📦', 0, px * 0.04);
    }
    portraits[key] = c.toDataURL('image/png');
    return portraits[key];
  }

  const CSS = `
  .hc-root{position:absolute;inset:0;overflow:hidden;background:#05131c;
    font:14px/1.5 'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8f3f7;}
  /* No CSS stretching — the backing store is sized to match, so 100% here is
     1:1 with real pixels rather than an upscale. */
  .hc-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .hc-ui{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
  .hc-ui.pass{pointer-events:none;background:none;}
  .hc-veil{position:absolute;inset:0;backdrop-filter:blur(4px) saturate(.85);
    background:radial-gradient(circle at 50% 38%,rgba(10,28,40,.70),rgba(2,8,13,.95));}
  /* Same recipe as the catch card, which is the template every modal follows:
     a two-layer face (diagonal white overlay over a vertical steel ramp), a
     bright silver bezel, a hard inset highlight along the top, and a one-shot
     sheen when it opens. */
  .hc-panel{position:relative;max-width:920px;width:min(92%,920px);max-height:88%;overflow:auto;
    background:
      linear-gradient(160deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,0) 42%),
      linear-gradient(180deg,#24363f 0%,#17272f 22%,#0c1a22 66%,#091419 100%);
    border:1px solid #6f9bad;border-radius:20px;padding:26px 30px;
    box-shadow:0 30px 80px rgba(0,0,0,.75),
      inset 0 1px 0 rgba(220,246,255,.55), inset 0 -2px 6px rgba(0,0,0,.55),
      0 0 0 1px rgba(6,16,22,.95), 0 0 44px rgba(90,190,230,.14);
    animation:hcpopin .28s cubic-bezier(.2,1.35,.5,1);}
  .hc-panel::after{content:'';position:absolute;inset:0;border-radius:20px;pointer-events:none;
    background:linear-gradient(115deg,transparent 34%,rgba(200,244,255,.16) 48%,transparent 62%);
    background-size:280% 100%;background-position:150% 0;
    animation:hcsheen 1.15s cubic-bezier(.3,.7,.4,1) 1;}
  .hc-panel.wide{width:min(96%,1040px);}
  .hc-panel h1{margin:0 0 4px;font-size:31px;letter-spacing:.4px;}
  .hc-panel h2{margin:0 0 14px;font-size:20px;}
  .hc-tag{color:#7fd4c4;font-weight:700;letter-spacing:.6px;font-size:12.5px;text-transform:uppercase;}
  .hc-sub{color:#9dbccb;margin:0 0 16px;font-size:14px;line-height:1.6;}
  .hc-hero{display:flex;gap:22px;align-items:center;margin-bottom:18px;}
  /* Direct child only. As a descendant selector this also caught the token coin
     nested in the stats block and stretched it to 236x15. */
  .hc-hero > img{width:236px;border-radius:12px;border:1px solid #2b6076;flex:none;
    box-shadow:0 12px 30px rgba(0,0,0,.5);}
  .hc-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;}
  .hc-btn{background:linear-gradient(180deg,#2a6a86,#123c50);border:1px solid #4d92ae;
    color:#eafaff;border-radius:10px;padding:10px 17px;
    font:700 14px 'Segoe UI',system-ui,sans-serif;cursor:pointer;
    box-shadow:inset 0 1px 0 rgba(200,240,255,.42),0 2px 6px rgba(0,0,0,.4);
    transition:filter .12s,transform .08s;}
  .hc-btn:hover{filter:brightness(1.22);}
  .hc-btn:active{transform:translateY(1px);}
  .hc-btn.go{background:linear-gradient(180deg,#2ba374,#136348);border-color:#4fd6a0;
    box-shadow:inset 0 1px 0 rgba(190,255,225,.45),0 2px 8px rgba(0,0,0,.4);}
  .hc-btn.ghost{background:transparent;border-color:#2c5f75;color:#a9cede;}
  .hc-btn:disabled{opacity:.42;cursor:not-allowed;}
  .hc-stats{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 6px;}
  .hc-stat{border-radius:12px;padding:8px 13px;font-size:12.5px;color:#8fb6c8;
    background:linear-gradient(180deg,#1d2f3a,#0b1a23);border:1px solid #3a6579;
    box-shadow:inset 0 1px 0 rgba(190,232,248,.26),inset 0 -1px 3px rgba(0,0,0,.45);}
  .hc-stat b{color:#fff;font-size:15px;display:block;}
  /* the arcade token, shared art — same coin in every cabinet */
  .hc-coin{width:15px;height:15px;vertical-align:-3px;margin-right:5px;}
  .hc-coin.lg{width:30px;height:30px;vertical-align:-6px;margin-right:8px;}
  .hc-grid{display:grid;gap:9px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));}
  .hc-card{border-radius:13px;padding:11px 13px;
    background:
      linear-gradient(160deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,0) 46%),
      linear-gradient(180deg,#1d2f3a,#0b1a23);
    border:1px solid #3a6579;
    box-shadow:inset 0 1px 0 rgba(190,232,248,.24),inset 0 -1px 3px rgba(0,0,0,.4),
      0 3px 10px rgba(0,0,0,.3);}
  .hc-card.locked{opacity:.42;}
  .hc-card .nm{font-weight:700;font-size:13.5px;display:flex;justify-content:space-between;gap:6px;}
  .hc-card .dt{color:#8fb2c4;font-size:11.5px;margin-top:3px;line-height:1.45;}
  .hc-card .sp{color:#7fd4c4;font-size:11px;font-weight:600;letter-spacing:.3px;margin-top:2px;}
  .hc-card .dexart{width:66px;height:66px;display:block;margin:-2px auto 4px;}
  /* Achievements follow Waste Hunter and Mudslides: locked ones dim to a padlock,
     earned ones light up. No tick — the row lighting IS the tick. */
  .hc-ach{display:flex;gap:10px;align-items:center;border-radius:12px;padding:10px 12px;
    background:linear-gradient(180deg,#1d2f3a,#0b1a23);border:1px solid #3a6579;
    box-shadow:inset 0 1px 0 rgba(190,232,248,.22);opacity:.42;}
  .hc-ach.on{opacity:1;border-color:#4fd6a0;
    background:linear-gradient(180deg,#17392c,#0b2019);
    box-shadow:inset 0 1px 0 rgba(150,255,205,.34),0 0 18px rgba(79,214,160,.16);}
  .hc-ach .ic{font-size:21px;flex:0 0 auto;}
  .hc-ach .n{font-size:13px;font-weight:700;}
  .hc-ach.on .n{color:#8ff0c0;}
  .hc-ach .d{font-size:10.5px;color:#8fb2c4;line-height:1.38;margin-top:1px;}
  /* an unlanded species shows its shape but not its colours — you can see the
     silhouette of what is down there without being told what it is */
  .hc-card .dexart.silhouette{filter:brightness(0) opacity(.35);}
  .hc-card.tier-fable{border-color:#c79a3a;background:linear-gradient(180deg,#2a2010,#0b2233);}
  .hc-card.tier-opus{border-color:#7a5ea8;}
  .hc-card.tier-sonnet{border-color:#3a7fa8;}
  .hc-card.tier-haiku{border-color:#3fa07a;}
  .hc-card.junk{border-color:#5d5a4a;}
  .hc-bait{display:flex;gap:10px;flex-wrap:wrap;}
  .hc-bait .b{flex:1 1 210px;border-radius:13px;padding:13px 15px;
    background:
      linear-gradient(160deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,0) 46%),
      linear-gradient(180deg,#1d2f3a,#0b1a23);
    border:1px solid #3a6579;
    box-shadow:inset 0 1px 0 rgba(190,232,248,.24),inset 0 -1px 3px rgba(0,0,0,.4);}
  .hc-bait .b h4{margin:0 0 3px;font-size:14.5px;}
  .hc-bait .b p{margin:0 0 9px;color:#8fb2c4;font-size:12px;line-height:1.45;}
  .hc-q{font-size:17px;font-weight:600;margin:6px 0 16px;line-height:1.5;}
  .hc-choice{display:block;width:100%;text-align:left;
    background:linear-gradient(180deg,#1d2f3a,#0b1a23);border:1px solid #3a6579;
    box-shadow:inset 0 1px 0 rgba(190,232,248,.24),inset 0 -1px 3px rgba(0,0,0,.4);
    color:#e8f3f7;border-radius:9px;padding:11px 14px;margin-bottom:8px;cursor:pointer;font-size:14px;
    transition:background .12s;}
  .hc-choice:hover:not(:disabled){background:#154257;}
  .hc-choice:disabled{cursor:default;}
  .hc-choice.right{background:#155e3f;border-color:#3fbd85;}
  .hc-choice.wrong{background:#5e1f25;border-color:#b8555f;}
  .hc-why{color:#9dbccb;font-size:13px;line-height:1.6;margin-top:10px;
    border-left:2px solid #2f7f9e;padding-left:12px;}
  .hc-toast{position:absolute;left:50%;top:16%;transform:translateX(-50%);
    background:rgba(6,26,38,.94);border:1px solid #2f7f9e;border-radius:24px;padding:9px 20px;
    font-weight:700;font-size:14px;pointer-events:none;animation:hcpop 2.4s ease forwards;}
  @keyframes hcpop{0%{opacity:0;transform:translate(-50%,10px);}12%{opacity:1;transform:translate(-50%,0);}
    78%{opacity:1;}100%{opacity:0;transform:translate(-50%,-12px);}}
  .hc-tip{color:#7f9fb0;font-size:12.5px;margin-top:14px;font-style:italic;}
  /* THE CATCH CARD — the payoff. Landing a fish used to be a two-second toast,
     which is a thin reward for a thirty-second fight with an Opah. */
  .hc-catch{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    pointer-events:auto;background:radial-gradient(circle at 50% 45%,rgba(8,30,44,.55),rgba(3,10,16,.86));
    animation:hcfade .22s ease;}
  @keyframes hcfade{from{opacity:0}to{opacity:1}}
  .hc-catch .cc{position:relative;width:min(92%,394px);text-align:center;padding:24px 26px 20px;
    background:
      linear-gradient(160deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,0) 42%),
      linear-gradient(180deg,#24363f 0%,#17272f 22%,#0c1a22 66%,#091419 100%);
    border:1px solid #6f9bad;border-radius:20px;
    box-shadow:0 30px 80px rgba(0,0,0,.75),
      inset 0 1px 0 rgba(220,246,255,.55), inset 0 -2px 6px rgba(0,0,0,.55),
      0 0 0 1px rgba(6,16,22,.95), 0 0 44px rgba(90,190,230,.14);
    animation:hcpopin .34s cubic-bezier(.2,1.5,.5,1);}
  /* A sweep of light across the bezel when it appears.
     Animating background-position rather than transform: translating the
     pseudo-element slid the highlight out past the card's rounded edge and left
     a bright wedge floating in mid-air. A moving background is clipped by the
     element box and its border-radius, so the sheen stays on the metal. */
  .hc-catch .cc::after{content:'';position:absolute;inset:0;border-radius:20px;pointer-events:none;
    background:linear-gradient(115deg,transparent 34%,rgba(200,244,255,.20) 48%,transparent 62%);
    background-size:280% 100%;background-position:150% 0;
    animation:hcsheen 1.15s cubic-bezier(.3,.7,.4,1) 1;}
  @keyframes hcsheen{from{background-position:150% 0}to{background-position:-50% 0}}
  @keyframes hcpopin{from{transform:scale(.82) translateY(14px);opacity:0}to{transform:none;opacity:1}}
  .hc-catch .cc.legend{border-color:#f0d089;
    background:
      linear-gradient(160deg,rgba(255,240,200,.16) 0%,rgba(255,255,255,0) 42%),
      linear-gradient(180deg,#3a3018 0%,#241c0e 30%,#0f1a22 100%);
    box-shadow:0 0 70px rgba(232,193,92,.34),0 30px 80px rgba(0,0,0,.75),
      inset 0 1px 0 rgba(255,236,180,.6), inset 0 -2px 6px rgba(0,0,0,.55);}
  .hc-catch .fishimg{width:158px;height:158px;display:block;margin:2px auto 6px;
    filter:drop-shadow(0 10px 20px rgba(0,0,0,.55));animation:hcswim 3.4s ease-in-out infinite;}
  @keyframes hcswim{0%,100%{transform:translateY(0) rotate(-2.5deg)}50%{transform:translateY(-8px) rotate(2.5deg)}}
  .hc-catch h2{margin:0;font-size:23px;letter-spacing:.2px;}
  .hc-catch .cc.legend h2{color:#ffd76b;}
  .hc-catch .sp{color:#7fd4c4;font-size:12.5px;font-weight:700;letter-spacing:.4px;margin-top:2px;}
  .hc-catch .facts{display:flex;gap:10px;justify-content:center;margin:15px 0 4px;}
  .hc-catch .fact{flex:1 1 0;border-radius:12px;padding:9px 6px;
    background:linear-gradient(180deg,#1d2f3a,#0b1a23);border:1px solid #3a6579;
    box-shadow:inset 0 1px 0 rgba(190,232,248,.26),inset 0 -1px 3px rgba(0,0,0,.45);}
  .hc-catch .fact span{display:block;font-size:10.5px;color:#7f9fb0;letter-spacing:.5px;text-transform:uppercase;}
  .hc-catch .fact b{display:block;font-size:20px;margin-top:2px;color:#fff;font-variant-numeric:tabular-nums;}
  .hc-catch .fact.tok b{color:#ffd98a;}
  .hc-catch .belly{color:#8fb2c4;font-size:11.5px;font-style:italic;margin-top:7px;}
  .hc-catch .bonus{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:11px;}
  .hc-catch .bonus i{font-style:normal;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;
    background:#123a2c;border:1px solid #2f8f6a;color:#8ff0c0;}
  .hc-catch .newtag{position:absolute;top:-11px;left:50%;transform:translateX(-50%);
    background:linear-gradient(180deg,#ffd76b,#f0a52c);color:#241403;font-size:10.5px;font-weight:900;
    letter-spacing:1.2px;padding:4px 13px;border-radius:20px;box-shadow:0 4px 14px rgba(240,165,44,.5);}
  /* The teaching slot. Reads as an aside, not as another stat — you should be
     able to skip it and still feel rewarded, or read it and learn something. */
  .hc-catch .tipbox{margin-top:14px;text-align:left;padding:11px 13px;border-radius:11px;
    background:linear-gradient(180deg,rgba(24,48,58,.9),rgba(10,24,32,.9));
    border:1px solid #2f6a7c;border-left:3px solid #4fd6c0;
    box-shadow:inset 0 1px 0 rgba(180,232,246,.18);}
  .hc-catch .tipbox span{display:block;font-size:10px;font-weight:800;letter-spacing:1.3px;
    text-transform:uppercase;color:#4fd6c0;margin-bottom:4px;}
  .hc-catch .tipbox p{margin:0;font-size:12.5px;line-height:1.55;color:#bdd8e4;}
  .hc-catch .cta{display:flex;gap:9px;margin-top:14px;}
  .hc-catch .cta .go{flex:1 1 auto;}
  .hc-catch .cta .ghost{flex:0 0 auto;}
  .hc-catch .hint{color:#5d7f90;font-size:11px;margin-top:8px;}

  /* the only clickable thing while a run is live */
  /* Always visible, on every screen, because there is nothing more annoying than
     hunting for the mute. Bottom-left, which nothing else uses now that the bait
     counter moved into the HUD strip. */
  .hc-mute{position:absolute;left:16px;bottom:14px;z-index:5;width:42px;height:42px;
    display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;
    border-radius:12px;border:1px solid #4d92ae;
    background:linear-gradient(180deg,#33505f 0%,#16262f 32%,#0b1620 100%);
    box-shadow:inset 0 1px 0 rgba(214,246,255,.5),0 3px 9px rgba(0,0,0,.5);
    transition:filter .12s,transform .08s;}
  .hc-mute:hover{filter:brightness(1.28);}
  .hc-mute:active{transform:translateY(1px);}
  .hc-mute .ic{font-size:18px;line-height:1;filter:saturate(.9);}
  .hc-mute.off{border-color:#8a5a5a;}
  .hc-mute.off .ic{opacity:.55;filter:grayscale(1);}

  /* Bottom-right: the top-right is the token readout and the bottom-left is the
     mute button, so this is the only corner that is actually free. */
  .hc-quit{position:absolute;bottom:14px;right:16px;pointer-events:auto;
    background:rgba(6,26,38,.82);border:1px solid #2b6076;color:#a9cede;
    font:700 12.5px 'Segoe UI',system-ui,sans-serif;padding:7px 14px;border-radius:20px;
    cursor:pointer;backdrop-filter:blur(4px);transition:background .14s,color .14s;}
  .hc-quit:hover{background:#5e2028;border-color:#b8555f;color:#ffd8d8;}
  .hc-tbl{width:100%;border-collapse:collapse;font-size:13px;}
  .hc-tbl th{text-align:left;color:#7fd4c4;font-size:11.5px;text-transform:uppercase;
    letter-spacing:.5px;padding:6px 8px;border-bottom:1px solid #24596f;}
  .hc-tbl td{padding:6px 8px;border-bottom:1px solid #12384a;}
  .hc-board th.n,.hc-board td.n{text-align:right;font-variant-numeric:tabular-nums;}
  .hc-board th.n{cursor:pointer;user-select:none;white-space:nowrap;}
  .hc-board th.n:hover{color:#eafaff;}
  .hc-board th.on{color:#ffd98a;}
  .hc-board td.on{color:#ffd98a;font-weight:700;}
  .hc-board .r{width:34px;color:#7f9fb0;text-align:right;}
  `;

  function injectCSS() {
    if (document.getElementById('hc-css')) return;
    const s = document.createElement('style');
    s.id = 'hc-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // AUDIO — same shape as the other cabinets so 'M' mutes the whole arcade.
  // ---------------------------------------------------------------------------
  function makeAudio() {
    let ctx = null, master = null, muted = false;
    function ensure() {
      if (ctx) return ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return ctx;
    }
    function tone(f, d, type, v, to, at) {
      if (muted) return;
      const c = ensure(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      const t0 = c.currentTime + (at || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + d);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v || 0.16, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + d + 0.02);
    }
    function noise(v, hp, d, lp) {
      if (muted) return;
      const c = ensure(); if (!c) return;
      const n = Math.max(1, Math.floor(c.sampleRate * (d || 0.05)));
      const b = c.createBuffer(1, n, c.sampleRate);
      const ch = b.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 1.6;
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter();
      f.type = lp ? 'lowpass' : 'highpass'; f.frequency.value = hp || 2400;
      const g = c.createGain(); g.gain.value = v;
      s.connect(f); f.connect(g); g.connect(master); s.start();
    }
    const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    return {
      nodes() { const c = ensure(); return c ? { ctx: c, master } : null; },
      // rod whoosh into the plop of the lure hitting water
      cast: () => { noise(0.10, 900, 0.16); tone(300, 0.18, 'sine', 0.08, 620); },
      plop: () => { noise(0.09, 700, 0.09, true); tone(520, 0.09, 'sine', 0.16, 190); },
      // the bobber goes under: two urgent knocks, impossible to miss
      bite: () => { tone(880, 0.09, 'triangle', 0.26, 1180);
        tone(1180, 0.11, 'triangle', 0.24, 1560, 0.11); noise(0.08, 1800, 0.1); },
      hook: () => { noise(0.12, 1200, 0.12); tone(420, 0.14, 'square', 0.16, 760); },
      clean: () => { [784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.16, 'triangle', 0.2, null, i * 0.05);
      }); },
      spook: () => tone(300, 0.16, 'sawtooth', 0.12, 130),
      // a soft tick per reel revolution while you are holding line
      reel: () => noise(0.035, 3200, 0.02),
      // landing a fish climbs the scale by how big it was
      land: (rank) => {
        const steps = Math.min(LADDER.length - 1, Math.round(rank * (LADDER.length - 1)));
        for (let i = 0; i <= steps; i += Math.max(1, Math.round(steps / 4) || 1)) {
          tone(880 * 2 ** (LADDER[i] / 12), 0.13, 'triangle', 0.2, null, i * 0.035);
        }
        noise(0.1, 800, 0.16, true);
      },
      legend: () => { noise(0.2, 500, 0.4, true);
        [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => {
          tone(f, 0.5, 'triangle', 0.22, null, i * 0.09);
          tone(f * 2, 0.4, 'sine', 0.1, null, i * 0.09 + 0.02);
        }); },
      junk: () => { noise(0.14, 420, 0.22, true); tone(150, 0.26, 'square', 0.12, 80); },
      lost: () => { noise(0.1, 600, 0.2, true); tone(340, 0.4, 'sawtooth', 0.16, 110); },
      buy: () => { tone(660, 0.1, 'triangle', 0.18); tone(990, 0.12, 'sine', 0.14, null, 0.07); },
      right: () => { [660, 880, 1320].forEach((f, i) => {
        tone(f, 0.16, 'triangle', 0.18, null, i * 0.05);
      }); },
      wrong: () => tone(220, 0.28, 'sawtooth', 0.14, 110),
      day: () => tone(590, 0.2, 'sine', 0.1, 880),
      toggle() {
        muted = !muted;
        const c = ensure();
        if (c && master) master.gain.setTargetAtTime(muted ? 0.0001 : 0.32, c.currentTime, 0.05);
        return muted;
      },
      resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    };
  }

  // ---------------------------------------------------------------------------
  function Game(container, opts) {
    const o = opts || {};
    injectCSS();
    this.host = typeof container === 'string' ? document.querySelector(container) : container;
    this.onComplete = o.onComplete || (() => {});
    this.onEvent = o.onEvent || (() => {});

    this.root = document.createElement('div');
    this.root.className = 'hc-root';
    this.canvas = document.createElement('canvas');
    this.ui = document.createElement('div');
    this.ui.className = 'hc-ui';
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.ui);

    // Outside this.ui on purpose: clearUI() and passUI() rebuild that element on
    // every screen change, and a mute button that vanishes when you start a run
    // is worse than no button at all.
    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'hc-mute';
    this.muteBtn.type = 'button';
    this.root.appendChild(this.muteBtn);
    this.host.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d');

    // migrate() on BOTH paths. It used to run only inside loadLocal(), so a
    // profile arriving from the server skipped it entirely — which is how the
    // legacy bait object survived long enough to get concatenated.
    this.p = migrate(o.profile
      ? Object.assign(defaultProfile(), o.profile)
      : (loadLocal() || defaultProfile()));
    this.dailyGiven = grantDaily(this.p);
    saveLocal(this.p);

    this.audio = makeAudio();
    const MUSIC = global.ArcadeMusic;
    this.music = MUSIC ? MUSIC.create(() => this.audio.nodes()) : null;
    if (this.music) this.music.setTheme('lagoon');

    this.img = {};
    ['dock'].forEach((k) => {
      const im = new Image();
      im.src = 'assets/' + k + '.jpg';
      this.img[k] = im;
    });
    const bot = new Image();
    bot.src = '../shared/assets/costbot.png';
    this.img.costbot = bot;
    // The arcade token. One piece of art for every token count in the arcade,
    // so the currency looks like the same thing in every cabinet.
    const coin = new Image();
    coin.src = '../shared/assets/token-coin-64.png';
    this.img.coin = coin;

    this.run = null;
    this.ambient = [];          // decorative fish cruising the bands
    for (let i = 0; i < 14; i++) this.ambient.push(this.makeAmbient(true));
    this.ripples = [];
    this.t = 0;

    // --- input --------------------------------------------------------------
    // One action key does everything, because every beat of the loop is a
    // single press or hold. Space is the rod.
    this.held = false;
    // Two different keys on purpose. SPACE taps through cast / strike / dismiss;
    // reeling is held on the ARROW keys. They used to share space, which meant a
    // burst of strike-taps carried straight into the catch card and skipped past
    // the fish you had just landed before you could read it.
    const TAP = [' ', 'enter'];
    const HOLD = ['arrowdown', 'arrowup', 's', 'w'];
    this._onKey = (e) => {
      const k = e.key.toLowerCase();
      if (TAP.includes(k) || HOLD.includes(k)) e.preventDefault();
      if (k === 'm') {
        this.muted = this.audio.toggle();
        if (this.music) this.music.setVolume(this.muted ? 0 : 1);
        this.paintMute();
        return;
      }
      // Always a way out. Mid-run this ends the trip early and keeps the haul;
      // on any other screen it walks back to the dock.
      if (k === 'escape') {
        if (this.run && !this.run.over) this.finish('you packed up early');
        else this.screenDock();
        return;
      }
      if (!this.run) return;
      if (HOLD.includes(k)) { this.held = true; return; }
      // During a fight SPACE reels as well — it is the obvious key and there is
      // nothing else to tap for. It is only barred from the catch card, which
      // is the one screen a stray strike-tap used to blow straight past.
      if (TAP.includes(k)) {
        if (this.run.phase === 'reel') { this.held = true; return; }
        this.press();
      }
    };
    this._onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (HOLD.includes(k) || TAP.includes(k)) this.held = false;
    };
    // Pointer works for everything: hold to reel, tap for the rest.
    this._onDown = (e) => {
      if (!this.ui.classList.contains('pass') || !this.run) return;
      e.preventDefault();
      this.audio.resume();
      if (this.run.phase === 'reel') this.held = true;
      else this.press();
    };
    this._onUp = () => { this.held = false; };
    global.addEventListener('keydown', this._onKey);
    global.addEventListener('keyup', this._onKeyUp);
    this.root.addEventListener('pointerdown', this._onDown);
    global.addEventListener('pointerup', this._onUp);

    this.muted = false;
    this.paintMute();
    this.muteBtn.onclick = (e) => {
      e.stopPropagation();
      this.muted = this.audio.toggle();
      if (this.music) this.music.setVolume(this.muted ? 0 : 1);
      this.paintMute();
    };

    // ---- crisp at any size --------------------------------------------------
    // The canvas used to be a fixed 1152x648 backing store stretched to fill the
    // container with CSS. On any screen bigger than that it was an upscale, so
    // 1px bevels and small text went soft; and on any container that was not
    // 16:9 the stretch was non-uniform, so everything came out elongated.
    //
    // Now the backing store matches the element's real pixel size (including
    // devicePixelRatio) and the context is scaled so the game still draws in
    // 1152x648 logical units. Aspect is preserved and the remainder letterboxed,
    // so nothing is ever distorted and nothing is ever resampled.
    this.view = { scale: 1, offX: 0, offY: 0, dpr: 1 };
    this.resize();
    this._ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this.resize()) : null;
    if (this._ro) this._ro.observe(this.root);
    this._onResize = () => this.resize();
    global.addEventListener('resize', this._onResize);

    this.last = performance.now();
    this._loop = () => {
      if (this.destroyed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      if (this.run) this.update(dt);
      this.updateAmbient(dt);
      this.draw();
      this.raf = requestAnimationFrame(this._loop);
    };
    this.raf = requestAnimationFrame(this._loop);

    this.screenDock();
    this.emit('ready', { bait: totalBait(this.p), daily: this.dailyGiven });
  }

  Game.prototype.resize = function () {
    const dpr = Math.min(3, global.devicePixelRatio || 1);
    const w = this.root.clientWidth || VW;
    const h = this.root.clientHeight || VH;
    const scale = Math.min(w / VW, h / VH);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.view = {
      scale, dpr,
      offX: (w - VW * scale) / 2,
      offY: (h - VH * scale) / 2,
    };
  };

  Game.prototype.paintMute = function () {
    const on = !this.muted;
    this.muteBtn.innerHTML = `<span class="ic">${on ? '🔊' : '🔇'}</span>`;
    this.muteBtn.title = on ? 'Mute the arcade (M)' : 'Unmute the arcade (M)';
    this.muteBtn.setAttribute('aria-label', this.muteBtn.title);
    this.muteBtn.classList.toggle('off', this.muted);
  };

  Game.prototype.emit = function (t, p) {
    try { this.onEvent(t, p || {}); } catch (e) { console.error(e); }
  };

  Game.prototype.destroy = function () {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this._ro) this._ro.disconnect();
    global.removeEventListener('resize', this._onResize);
    global.removeEventListener('keydown', this._onKey);
    global.removeEventListener('keyup', this._onKeyUp);
    global.removeEventListener('pointerup', this._onUp);
    if (this.music) this.music.stop();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  Game.prototype.clearUI = function () {
    this.ui.innerHTML = '';
    this.ui.classList.remove('pass');
  };

  // During a run the overlay is click-through so the canvas gets the input —
  // except for this one button, which has to stay reachable.
  Game.prototype.passUI = function () {
    this.ui.innerHTML = '<button class="hc-quit" id="hc-quit" title="End the holiday (Esc)">✕ Pack up</button>';
    this.ui.classList.add('pass');
    const b = this.ui.querySelector('#hc-quit');
    b.onpointerdown = (e) => { e.stopPropagation(); };
    b.onclick = (e) => {
      e.stopPropagation();
      if (this.run && !this.run.over) this.finish('you packed up early');
    };
  };

  Game.prototype.toast = function (text, ms) {
    const el = document.createElement('div');
    el.className = 'hc-toast';
    el.innerHTML = text;
    this.ui.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, ms || 2400);
  };

  // ---------------------------------------------------------------------------
  // SCREENS
  // ---------------------------------------------------------------------------
  Game.prototype.screenDock = function () {
    const p = this.p;
    if (this.music) this.music.setState('menu');
    this.clearUI();
    const dexCount = Object.keys(p.dex).length;
    const dexTotal = ALL_CATCHES().length;
    const daily = this.dailyGiven
      ? `<div class="hc-toast" style="position:static;transform:none;animation:none;display:inline-block;margin-bottom:12px">
           🪱 ${this.dailyGiven} free bait for today</div>` : '';
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel">
        <div class="hc-hero">
          <img src="assets/dock.jpg" alt="">
          <div>
            <div class="hc-tag">CostBot Arcade</div>
            <h1>Holiday in Colombia</h1>
            <p class="hc-sub">The fish here have been mysteriously eating all the AI
              tokens. Reel them out and reclaim the haul before it's back to work.</p>
            ${daily}
            <div class="hc-stats">
              <div class="hc-stat">Bait<b>${totalBait(p)}</b></div>
              <div class="hc-stat">Tokens<b><img class="hc-coin" src="../shared/assets/token-coin-64.png" alt="">${fmt(wallet().tokens)}</b></div>
              <div class="hc-stat">Fishdex<b>${dexCount}/${dexTotal}</b></div>
              <div class="hc-stat">Best streak<b>${fmt(p.best.streak || 0)}</b></div>
              <div class="hc-stat">Heaviest<b>${(p.best.heaviest || 0).toFixed(1)} kg</b></div>
            </div>
          </div>
        </div>
        <div class="hc-row">
          <button class="hc-btn go" id="hc-go" ${totalBait(p) ? '' : 'disabled'}>🎣 Go fishing</button>
          <button class="hc-btn" id="hc-shop">🪱 Bait shop</button>
          <button class="hc-btn" id="hc-triv">🎓 Trivia for bait</button>
          <button class="hc-btn ghost" id="hc-dex">📖 Fishdex</button>
          <button class="hc-btn ghost" id="hc-board">🏆 Records</button>
          <button class="hc-btn ghost" id="hc-ach">🏅 Achievements</button>
          <button class="hc-btn ghost" id="hc-how">❓ How to play</button>
        </div>
        ${totalBait(p) ? '' : '<p class="hc-tip">No bait. Answer a question or buy some — '
          + 'you cannot cast without it, which is also why you can never go into token debt.</p>'}
        <p class="hc-tip">💡 ${esc(C.TIPS[(Math.random() * C.TIPS.length) | 0])}</p>
      </div>`;
    this.ui.querySelector('#hc-go').onclick = () => this.start();
    this.ui.querySelector('#hc-shop').onclick = () => this.screenShop();
    this.ui.querySelector('#hc-triv').onclick = () => this.screenTrivia();
    this.ui.querySelector('#hc-dex').onclick = () => this.screenDex();
    this.ui.querySelector('#hc-board').onclick = () => this.screenBoard();
    this.ui.querySelector('#hc-ach').onclick = () => this.screenAchievements();
    this.ui.querySelector('#hc-how').onclick = () => this.screenBriefing();
  };

  Game.prototype.screenBriefing = function () {
    this.clearUI();
    const B = C.BRIEFING;
    const bands = C.BANDS.map((b) =>
      `<div class="hc-card"><div class="nm">${esc(b.name)}</div>
        <div class="dt">${ALL_CATCHES().filter((f) => f.band === b.id).length} species live here</div></div>`).join('');
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel wide">
        <div class="hc-tag">How to play</div>
        <h1>Holiday in Colombia</h1>
        ${B.story.map((s) => `<p class="hc-sub">${esc(s)}</p>`).join('')}
        <h2>The loop</h2>
        <div class="hc-grid">
          ${B.loop.map((s) => `<div class="hc-card"><div class="nm">${s.icon} ${esc(s.label)}</div>
            <div class="dt">${esc(s.note)}</div></div>`).join('')}
        </div>
        <h2 style="margin-top:20px">The lake</h2>
        <div class="hc-grid">${bands}</div>
        <h2 style="margin-top:20px">Controls</h2>
        <div class="hc-grid">
          <div class="hc-card"><div class="nm">SPACE</div>
            <div class="dt">Tap to cast, tap to strike — and hold it to reel.</div></div>
          <div class="hc-card"><div class="nm">↓ / ↑ (or S / W)</div>
            <div class="dt">Also reels, if you would rather keep space for striking.</div></div>
          <div class="hc-card"><div class="nm">ENTER</div>
            <div class="dt">Dismisses a catch card. Space cannot, on purpose — it is the
              reel key, and a stray tap should never skip the fish you just landed.</div></div>
          <div class="hc-card"><div class="nm">Esc</div>
            <div class="dt">Pack up. You keep everything already caught.</div></div>
          <div class="hc-card"><div class="nm">M</div>
            <div class="dt">Mute everything — or use the 🔊 button, bottom-left on every screen.</div></div>
        </div>
        <div class="hc-row"><button class="hc-btn go" id="hc-back">Back to the dock</button></div>
      </div>`;
    this.ui.querySelector('#hc-back').onclick = () => this.screenDock();
  };

  Game.prototype.screenDex = function () {
    this.clearUI();
    const p = this.p;
    const card = (f) => {
      const seen = p.dex[f.id];
      const tier = f.junk ? 'junk' : 'tier-' + f.tier;
      if (!seen) {
        return `<div class="hc-card locked ${tier}">
          <img class="dexart silhouette" src="${portrait(f, 132)}" alt="">
          <div class="nm"><span>???</span></div>
          <div class="dt">${esc(C.BANDS[f.band].name)} · not yet landed</div></div>`;
      }
      const rate = f.rate ? ` · $${f.rate[0]}/$${f.rate[1]} per Mtok` : '';
      // The species line is the punchline — without the real model name next to
      // it, "Haikuda" is just a word.
      const sp = f.species ? `<div class="sp">${esc(f.species)}</div>` : '';
      return `<div class="hc-card ${tier}">
        <img class="dexart" src="${portrait(f, 132)}" alt="">
        <div class="nm"><span>${esc(f.name)}</span>
          <span style="color:#7fd4c4">x${seen.caught}</span></div>
        ${sp}
        <div class="dt">Best ${seen.best} kg · ${fmt(f.tokens)} tokens${rate}<br>${esc(f.note)}</div></div>`;
    };
    const groups = [
      ['The lake', C.FISH],
      ['Not fish', C.JUNK],
    ];
    const caught = Object.keys(p.dex).length;
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel wide">
        <div class="hc-tag">${caught} of ${ALL_CATCHES().length} logged</div>
        <h1>📖 Fishdex</h1>
        <p class="hc-sub">Every fish in this lake is an Anthropic model. The newer it is,
          the more it has eaten — and the harder it fights.</p>
        ${groups.map(([t, list]) => `<h2 style="margin-top:16px">${t}</h2>
          <div class="hc-grid">${list.map(card).join('')}</div>`).join('')}
        <div class="hc-row"><button class="hc-btn go" id="hc-back">Back to the dock</button></div>
      </div>`;
    this.ui.querySelector('#hc-back').onclick = () => this.screenDock();
  };

  // Fishing has no dollars to rank on, so it ranks on the things fishing is
  // actually about. Longest streak is the honest skill measure — it cannot be
  // got by luck, only by not losing a fish. Heaviest is the brag.
  const BOARD_COLS = [
    { key: 'streak', label: 'Longest streak' },
    { key: 'heaviest', label: 'Heaviest', unit: 'kg' },
    { key: 'fish', label: 'Fish landed' },
    { key: 'tokens', label: 'Tokens' },
  ];

  Game.prototype.screenBoard = function (sortBy) {
    const sort = sortBy || this._boardSort || 'streak';
    this._boardSort = sort;
    this.clearUI();
    const wrap = document.createElement('div');
    wrap.className = 'hc-panel wide';
    this.ui.innerHTML = '<div class="hc-veil"></div>';
    this.ui.appendChild(wrap);

    const cell = (r, c) => {
      const v = r[c.key] || 0;
      return c.unit === 'kg' ? v.toFixed(1) + ' kg' : Math.round(v).toLocaleString();
    };
    const render = (rows, who, note) => {
      rows = rows.slice().sort((a, b) => (b[sort] || 0) - (a[sort] || 0)).slice(0, 25);
      wrap.innerHTML = `
        <div class="hc-tag">${esc(note)}</div>
        <h1>🏆 Records</h1>
        <table class="hc-tbl hc-board">
          <thead><tr><th class="r">#</th><th>${esc(who)}</th>
            ${BOARD_COLS.map((c) => `<th class="n ${c.key === sort ? 'on' : ''}"
              data-sort="${c.key}">${esc(c.label)}${c.key === sort ? ' ▾' : ''}</th>`).join('')}
          </tr></thead>
          <tbody>${rows.length ? rows.map((r, i) => `<tr>
            <td class="r">${i + 1}</td><td>${esc(r.who)}</td>
            ${BOARD_COLS.map((c) => `<td class="n ${c.key === sort ? 'on' : ''}">${cell(r, c)}</td>`).join('')}
          </tr>`).join('') : `<tr><td colspan="6" style="color:#8fb2c4">
            Nothing logged yet. Land a fish and you are the first name here.</td></tr>`}</tbody>
        </table>
        <div class="hc-row">
          <button class="hc-btn go" data-act="go">🎣 Go fishing</button>
          <button class="hc-btn ghost" data-act="dock">Back to the dock</button>
        </div>`;
    };

    wrap.addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (th) { this.screenBoard(th.dataset.sort); return; }
      if (e.target.closest('[data-act="go"]')) { this.audio.resume(); this.start(); }
      else if (e.target.closest('[data-act="dock"]')) this.screenDock();
    });

    const local = () => {
      const hist = (this.p.history || []).map((h, i) => ({
        who: new Date(h.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          + (i === 0 ? ' · latest' : ''),
        streak: h.streak, heaviest: h.heaviest, fish: h.fish, tokens: h.tokens,
      }));
      render(hist, 'Your trips',
        'Your own trips — sign in on the arcade app to rank against everyone.');
    };

    const sync = global.ArcadeSync;
    if (!sync || !sync.enabled || !sync.gameBoards) { local(); return; }
    sync.gameBoards('holiday-in-colombia').then((data) => {
      if (this.destroyed) return;
      if (!data || !data.metrics) { local(); return; }
      // The server ranks each metric independently; fold them into one row per
      // player so a single table can sort by any column.
      const byPlayer = new Map();
      for (const key of Object.keys(data.metrics)) {
        for (const row of data.metrics[key] || []) {
          const pl = byPlayer.get(row.player) || { who: row.player };
          pl[key] = Math.max(pl[key] || 0, row.value);
          byPlayer.set(row.player, pl);
        }
      }
      const rows = [...byPlayer.values()];
      if (!rows.length) { local(); return; }
      render(rows, 'Player', 'Everyone’s best on each metric. Click a column to sort.');
    }).catch(local);
  };

  Game.prototype.screenAchievements = function () {
    this.clearUI();
    const got = new Set(this.p.achievements);
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel wide">
        <div class="hc-tag">${got.size} of ${C.ACHIEVEMENTS.length} earned</div>
        <h1>🏅 Achievements</h1>
        <div class="hc-grid">
          ${C.ACHIEVEMENTS.map((a) => `<div class="hc-ach ${got.has(a.id) ? 'on' : ''}">
            <div class="ic">${got.has(a.id) ? a.icon : '🔒'}</div>
            <div><div class="n">${esc(a.name)}</div>
              <div class="d">${esc(a.desc)}</div></div></div>`).join('')}
        </div>
        <div class="hc-row"><button class="hc-btn go" id="hc-back">Back to the dock</button></div>
      </div>`;
    this.ui.querySelector('#hc-back').onclick = () => this.screenDock();
  };

  Game.prototype.screenShop = function () {
    this.clearUI();
    const p = this.p;
    const pack = (pk, i) => {
      const can = wallet().tokens >= pk.cost;
      const each = Math.round(pk.cost / pk.n);
      return `<div class="b">
        <h4>${C.BAIT.icon} ${pk.n} ${C.BAIT.name}${pk.n > 1 ? '' : ''}</h4>
        <p>${fmt(each)} tokens each${i ? ` · ${Math.round((1 - each / C.BAIT_PACKS[0].cost) * 100)}% off` : ''}</p>
        <button class="hc-btn" data-buy="${i}" ${can ? '' : 'disabled'}>Buy · ${fmt(pk.cost)} tokens</button>
      </div>`;
    };
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel">
        <div class="hc-tag"><img class="hc-coin" src="../shared/assets/token-coin-64.png" alt="">${fmt(wallet().tokens)} tokens on hand · ${C.BAIT.icon} ${totalBait(p)} bait</div>
        <h1>🪱 Bait shop</h1>
        <p class="hc-sub">Bait is just bait — it does not decide what you catch, only that
          you get to cast at all. What is down there is decided by your cast, and nothing
          else. You cannot fish without bait, which is exactly why a bad day at the lake
          can never put you in debt.</p>
        <div class="hc-bait">${C.BAIT_PACKS.map(pack).join('')}</div>
        <div class="hc-row">
          <button class="hc-btn" id="hc-triv">🎓 Trivia for free bait</button>
          <button class="hc-btn go" id="hc-back">Back to the dock</button>
        </div>
      </div>`;
    this.ui.querySelectorAll('[data-buy]').forEach((el) => {
      el.onclick = () => {
        const pk = C.BAIT_PACKS[+el.getAttribute('data-buy')];
        if (!pk || !wallet().spend(pk.cost)) return;
        addBait(this.p, pk.n);
        this.audio.buy();
        saveLocal(this.p);
        this.screenShop();
      };
    });
    this.ui.querySelector('#hc-triv').onclick = () => this.screenTrivia();
    this.ui.querySelector('#hc-back').onclick = () => this.screenDock();
  };

  // Trivia is the bottomless bait tap: no cost, no limit, just a question. It is
  // the reason a player who knows FinOps never hits a wall, and the reason the
  // token economy has a floor.
  Game.prototype.screenTrivia = function (streak) {
    const T = global.ArcadeTrivia;
    const R = C.TRIVIA_BAIT;
    const run = streak || 0;
    if (!T || !T.BANK.length) { this.screenDock(); return; }
    const seen = new Set(this.p.triviaSeen || []);
    const q = T.pick({ exclude: seen });
    if (!q) { this.screenDock(); return; }
    this.clearUI();
    const reward = Math.min(R.streakCap, R.reward + run * R.streakStep);
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel">
        <div class="hc-tag">${esc(q.topic.replace(/_/g, ' '))} · worth ${reward} bait${run ? ` · ${run} in a row` : ''}</div>
        <h1>🎓 Trivia for bait</h1>
        <div class="hc-q">${esc(q.q)}</div>
        <div id="hc-choices">
          ${q.c.map((ch, i) => `<button class="hc-choice" data-i="${i}"><span>${esc(ch)}</span></button>`).join('')}
        </div>
        <div id="hc-after"></div>
      </div>`;
    const done = (i) => {
      const right = i === q.a;
      this.ui.querySelectorAll('.hc-choice').forEach((el, ix) => {
        el.disabled = true;
        if (ix === q.a) el.classList.add('right');
        else if (ix === i) el.classList.add('wrong');
      });
      this.p.triviaSeen = Array.from(seen.add(T.key(q)));
      let gained = 0;
      if (right) {
        gained = reward;
        addBait(this.p, gained);
        this.p.triviaBait = (this.p.triviaBait || 0) + gained;
        this.audio.right();
        if (this.p.triviaBait >= 25) this.unlock('hc_scholar');
      } else {
        gained = R.wrongReward;
        this.audio.wrong();
      }
      saveLocal(this.p);
      const after = this.ui.querySelector('#hc-after');
      after.innerHTML = `
        <div class="hc-why">${right ? `<b style="color:#6fe0a8">+${gained} bait.</b> ` : '<b style="color:#ffa8a8">Not quite.</b> '}${esc(q.why || '')}</div>
        <div class="hc-row">
          <button class="hc-btn go" id="hc-next">Another question</button>
          <button class="hc-btn ghost" id="hc-done">Back to the dock</button>
        </div>`;
      after.querySelector('#hc-next').onclick = () => this.screenTrivia(right ? run + 1 : 0);
      after.querySelector('#hc-done').onclick = () => this.screenDock();
    };
    this.ui.querySelectorAll('.hc-choice').forEach((el) => {
      el.onclick = () => done(+el.getAttribute('data-i'));
    });
  };

  // ---------------------------------------------------------------------------
  // THE RUN
  // ---------------------------------------------------------------------------
  Game.prototype.start = function () {
    if (!totalBait(this.p)) { this.screenDock(); return; }
    this.audio.resume();
    if (this.music) this.music.setState('stage');
    this.run = {
      phase: 'idle',           // idle | cast | sink | wait | bite | reel | show
      tokens: 0, fish: 0, junk: 0, escaped: 0, cleanHooks: 0,
      streak: 0, bestStreak: 0, heaviest: 0, newSpecies: 0,
      caught: [],
      meter: 0, meterDir: 1,
      hooked: null, band: 0, spooks: 0,
      phaseT: 0, msg: '', msgT: 0,
      perfectCast: false, castAcc: 0.5, cleanHook: false,
      over: false,
    };
    this.passUI();
    this.emit('run:start', { bait: totalBait(this.p) });
  };

  Game.prototype.say = function (text) {
    if (!this.run) return;
    this.run.msg = text;
    this.run.msgT = 1.6;
  };

  // One key, five meanings — which is only legible because each phase has
  // exactly one thing you could possibly want to do.
  Game.prototype.press = function () {
    const r = this.run;
    if (!r || r.over) return;
    if (r.phase === 'card') return;          // the card has its own guarded handler
    if (r.phase === 'idle') this.doCast();
    else if (r.phase === 'cast') this.lockCast();
    else if (r.phase === 'wait') this.yankEarly();
    else if (r.phase === 'bite') this.hook();
    else if (r.phase === 'show') this.nextCast();
  };

  Game.prototype.release = () => { /* reel handles hold state in update() */ };

  Game.prototype.doCast = function () {
    const r = this.run;
    if (totalBait(this.p) < 1) { this.finish('out of bait'); return; }
    r.phase = 'cast'; r.phaseT = 0; r.meter = 0; r.meterDir = 1;
    this.audio.cast();
  };

  Game.prototype.lockCast = function () {
    const r = this.run;
    const zone = C.CAST.zones.find((z) => r.meter <= z.to) || C.CAST.zones[C.CAST.zones.length - 1];

    // Spend the bait the moment the line is in the water, win or lose.
    addBait(this.p, -1);
    saveLocal(this.p);

    if (zone.band < 0) {
      this.audio.junk();
      this.say('🪝 Snagged the line — bait gone');
      r.streak = 0;
      r.phase = 'show'; r.phaseT = 0; r.hooked = null;
      return;
    }
    r.band = zone.band;
    const centre = this.zoneCentre(zone);
    const off = Math.abs(r.meter - centre);
    r.perfectCast = off <= C.CAST.perfectPad;
    // Graded, not pass/fail: 1 on the mark, 0 at the zone edge. This is what
    // sizes the fish, so the read-out has to say which of the three you got —
    // otherwise the player has no way to learn that loose casts land small ones.
    r.castAcc = clamp(1 - off / this.zoneHalf(zone), 0, 1);
    const band = C.BANDS[r.band].name;
    if (r.perfectCast) this.say('🎯 Perfect cast · ' + band);
    else if (r.castAcc >= 0.55) this.say('👍 Good cast · ' + band);
    else this.say('🪶 Loose cast · ' + band + ' — expect a small one');

    r.phase = 'sink'; r.phaseT = 0;
    this.audio.plop();
    this.ripples.push({ x: this.lureX(), y: WATER_Y, r: 4, life: 1 });
  };

  Game.prototype.zoneCentre = (zone) => {
    const ix = C.CAST.zones.indexOf(zone);
    const from = ix > 0 ? C.CAST.zones[ix - 1].to : 0;
    return (from + zone.to) / 2;
  };

  // Centre to edge. Zones are not all the same width, so accuracy has to be
  // measured against the zone you actually landed in.
  Game.prototype.zoneHalf = (zone) => {
    const ix = C.CAST.zones.indexOf(zone);
    const from = ix > 0 ? C.CAST.zones[ix - 1].to : 0;
    return Math.max(1e-6, (zone.to - from) / 2);
  };

  Game.prototype.lureX = function () {
    const r = this.run;
    if (!r) return VW * 0.5;
    return VW * 0.30 + VW * 0.46 * (r.band + 0.5) / C.BANDS.length;
  };

  Game.prototype.lureY = function () {
    const r = this.run;
    if (!r) return WATER_Y;
    const b = C.BANDS[r.band];
    const depth = (b.from + b.to) / 2;
    const sink = r.phase === 'sink' ? clamp(r.phaseT / 0.7, 0, 1) : 1;
    // Kept off the bottom edge: the strike ring is drawn around the lure, and an
    // Abyss cast put it half off the canvas.
    return Math.min(WATER_Y + LAKE_H * depth * sink, VH - 118);
  };

  Game.prototype.yankEarly = function () {
    const r = this.run;
    r.spooks++;
    this.audio.spook();
    if (r.spooks > C.BITE.maxSpooks) {
      this.say('👻 Spooked it off for good');
      r.streak = 0;
      r.phase = 'show'; r.phaseT = 0; r.hooked = null;
      return;
    }
    // back to waiting, with the ring reset — the fish comes round again
    r.phase = 'wait'; r.phaseT = 0;
    r.waitFor = C.BITE.spookPenalty + Math.random() * (C.BITE.waitMax - C.BITE.waitMin);
    r.ring = C.BITE.ringFrom;
    this.say('Too early — it is circling');
  };

  Game.prototype.hook = function () {
    const r = this.run;
    const off = Math.abs((r.ring == null ? 1 : r.ring) - 1);
    // Struck while the ring is still wide open — that is a yank, not a hook.
    if (off > C.BITE.hitBand) { this.yankEarly(); return; }
    r.cleanHook = off <= C.BITE.perfectBand;
    // The fish that swam up IS the fish you hook — it was chosen when it started
    // its approach, so the silhouette you watched is never a bait-and-switch.
    const def = (r.comer && r.comer.def) || pickSpecies(r.band, null, r.perfectCast);
    const cat = rollCatch(def, null, r.castAcc);
    const f = fightProfile(def);

    // A clean hook starts you closer and with slack line — the reward is a
    // shorter fight, not a hidden number.
    const R = C.REEL;
    r.hooked = {
      cat, def, fight: f,
      dist: R.startDist - (r.cleanHook ? 0.14 : 0) - (r.perfectCast ? 0.06 : 0),
      tension: 0,
      running: false,
      runT: R.firstRunDelay,
      peakTension: 0,
    };
    r.phase = 'reel'; r.phaseT = 0;
    if (r.cleanHook) { this.audio.clean(); r.cleanHooks++; this.say('🎯 Clean hook!'); }
    else this.audio.hook();
    if (r.cleanHooks >= 3) this.unlock('hc_clean');
  };

  // A fish is chosen the moment the wait begins and swims in from the side at
  // the lure's depth. The bite is not an abstract timer any more: the ring only
  // opens when it actually reaches the bait, so the wait is something you watch
  // rather than something that happens to you.
  Game.prototype.summon = function () {
    const r = this.run;
    const def = pickSpecies(r.band, null, r.perfectCast);
    const fromRight = Math.random() < 0.62;
    r.comer = {
      def,
      from: fromRight ? VW + 70 : -70,
      x: fromRight ? VW + 70 : -70,
      y: this.lureY() + (Math.random() * 90 - 45),
      dir: fromRight ? -1 : 1,
      wob: Math.random() * TAU,
      leaving: false,
    };
  };

  Game.prototype.swim = function (dt) {
    const r = this.run;
    const c = r.comer;
    if (!c) return;
    c.wob += dt * 5;
    const tx = this.lureX(), ty = this.lureY() + 6;
    if (c.leaving) {
      c.x += c.dir * -260 * dt;
      return;
    }
    // Pace the approach to the wait: it should arrive as the bite is due, so
    // the two are never out of step no matter how long the wait rolled.
    const k = clamp(r.phaseT / Math.max(0.2, r.waitFor), 0, 1);
    const ease = k * k * (3 - 2 * k);
    c.x = c.from + (tx - c.from) * ease;
    c.y = c.y + (ty - c.y) * Math.min(1, dt * 2.4);
    c.dir = tx > c.x ? 1 : -1;
  };

  Game.prototype.nextCast = function () {
    const r = this.run;
    if (this._cardKey) { this._cardKey(); this._cardKey = null; }
    if (r.phase === 'card') this.passUI();       // put the click-through overlay back
    r.phase = 'idle'; r.phaseT = 0; r.hooked = null; r.comer = null;
    r.spooks = 0; r.perfectCast = false; r.castAcc = 0.5; r.cleanHook = false;
    if (!totalBait(this.p)) this.finish('out of bait');
  };

  // ---------------------------------------------------------------------------
  Game.prototype.update = function (dt) {
    const r = this.run;
    if (r.over) return;
    // The catch card holds the world still while it is up.
    if (r.phase === 'card') return;
    r.phaseT += dt;
    if (r.msgT > 0) r.msgT -= dt;

    if (r.phase === 'cast') {
      r.meter += r.meterDir * C.CAST.sweepSpeed * dt;
      if (r.meter >= 1) { r.meter = 1; r.meterDir = -1; }
      if (r.meter <= 0) { r.meter = 0; r.meterDir = 1; }
    } else if (r.phase === 'sink') {
      if (r.phaseT > 0.7) {
        r.phase = 'wait'; r.phaseT = 0;
        r.waitFor = C.BITE.waitMin + Math.random() * (C.BITE.waitMax - C.BITE.waitMin);
        this.summon();
      }
    } else if (r.phase === 'wait') {
      this.swim(dt);
      if (r.phaseT >= r.waitFor) {
        r.phase = 'bite'; r.phaseT = 0; r.ring = C.BITE.ringFrom;
        this.audio.bite();
        this.ripples.push({ x: this.lureX(), y: WATER_Y, r: 3, life: 1 });
      }
    } else if (r.phase === 'bite') {
      // the ring closes from ringFrom to 0; past the target it is a miss
      if (r.comer) {                       // nosing the bait while you decide
        r.comer.wob += dt * 9;
        r.comer.x += Math.sin(r.comer.wob) * 12 * dt;
      }
      r.ring = C.BITE.ringFrom * (1 - r.phaseT / C.BITE.shrinkTime);
      if (r.ring <= 1 - C.BITE.hitBand) {
        this.say('🪱 It took the bait and left');
        r.streak = 0;
        this.audio.lost();
        if (r.comer) r.comer.leaving = true;
        r.phase = 'show'; r.phaseT = 0; r.hooked = null;
      }
    } else if (r.phase === 'reel') {
      this.updateReel(dt);
    } else if (r.phase === 'show') {
      this.swim(dt);
      if (r.phaseT > 1.9) this.nextCast();
    }

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += 42 * dt; rp.life -= dt * 1.1;
      if (rp.life <= 0) this.ripples.splice(i, 1);
    }
  };

  // The containment bar. Box physics is a spring with no spring: thrust up while
  // held, gravity always. Everything else is the fish deciding where to be.
  // Hold to reel, release to let the line breathe. The only two numbers that
  // matter are how far out the fish still is and how hard the line is pulling.
  Game.prototype.updateReel = function (dt) {
    const r = this.run;
    const h = r.hooked;
    const R = C.REEL;
    const f = h.fight;

    // Runs. A fish with a high `runs` profile bolts often and for longer, which
    // is what makes a Fable a long fight rather than merely a strong one.
    h.runT -= dt;
    if (h.runT <= 0) {
      h.running = !h.running;
      const lerp = (lo, hi) => lo + (hi - lo) * f.runs;
      h.runT = h.running
        ? lerp(R.runMin, R.runMax) * (0.8 + Math.random() * 0.5)
        : (R.restMax - (R.restMax - R.restMin) * f.runs) * (0.7 + Math.random() * 0.7);
      if (h.running) this.audio.spook();
    }

    if (this.held) {
      h.dist -= R.reelRate * f.speed * (h.running ? R.runReelMult : 1) * dt;
      h.tension += R.tensionUp * f.pull * (h.running ? R.runTensionMult : 1) * dt;
      if (Math.random() < dt * 16) this.audio.reel();
    } else {
      h.dist += R.slipRate * (h.running ? 1.7 : 1) * dt;
      h.tension -= R.tensionDown * dt;
    }
    h.dist = clamp(h.dist, 0, R.lostDist);
    h.tension = clamp(h.tension, 0, 1.2);
    h.peakTension = Math.max(h.peakTension, h.tension);
    // `progress` is what the scene and the results screen read.
    h.progress = clamp(1 - h.dist, 0, 1);

    if (h.tension >= R.snapAt) this.loseFish('snap');
    else if (h.dist >= R.lostDist) this.loseFish('spool');
    else if (h.dist <= 0) this.land();
  };

  Game.prototype.land = function () {
    const r = this.run;
    const h = r.hooked;
    const def = h.def;
    const S = C.SCORING;

    let mult = 1 + Math.min(S.streakCap - 1, r.streak * S.streakStep);
    if (r.cleanHook) mult += S.cleanHookBonus;
    if (r.perfectCast) mult += S.perfectCastBonus;
    let tokens = Math.round(h.cat.tokens * mult);

    const seen = this.p.dex[def.id];
    const isNew = !seen;
    if (isNew) { tokens += S.firstCatchBonus; r.newSpecies++; }
    this.p.dex[def.id] = {
      caught: (seen ? seen.caught : 0) + 1,
      best: Math.max(seen ? seen.best : 0, h.cat.kg),
    };

    r.tokens += tokens;
    r.caught.push({ id: def.id, name: def.name, species: def.species || null,
      kg: h.cat.kg, tokens, junk: !!def.junk });
    if (def.junk) { r.junk++; this.audio.junk(); } else {
      r.fish++;
      r.streak++;
      r.bestStreak = Math.max(r.bestStreak, r.streak);
      r.heaviest = Math.max(r.heaviest, h.cat.kg);
      if (def.legendary) this.audio.legend();
      else this.audio.land(clamp(def.kg / 22, 0.1, 1));
    }

    r.phase = 'card'; r.phaseT = 0;
    this.checkAchievements();
    saveLocal(this.p);
    this.emit('catch', { id: def.id, kg: h.cat.kg, tokens });
    this.screenCatch({ def, kg: h.cat.kg, tokens, isNew, mult,
      clean: r.cleanHook, perfect: r.perfectCast, streak: r.streak });
  };

  const LOST_WHY = {
    snap: '🧵 Line snapped — you held it through the run',
    spool: '💨 It ran you out of line',
  };

  Game.prototype.loseFish = function (why) {
    const r = this.run;
    r.escaped++;
    r.streak = 0;
    this.audio.lost();
    this.say(LOST_WHY[why] || '💨 It threw the hook');
    r.phase = 'show'; r.phaseT = 0; r.hooked = null;
  };

  Game.prototype.unlock = function (id) {
    if (this.p.achievements.includes(id)) return false;
    const a = C.ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return false;
    this.p.achievements.push(id);
    saveLocal(this.p);
    this.toast(`🏅 ${a.icon} ${esc(a.name)} — ${esc(a.desc)}`, 3400);
    this.emit('achievement', { id });
    return true;
  };

  Game.prototype.checkAchievements = function () {
    const p = this.p, r = this.run;
    const has = (id) => !!p.dex[id];
    if (Object.keys(p.dex).length) this.unlock('hc_first');
    if (has('haiku45')) this.unlock('hc_haiku');
    if (has('sonnet5')) this.unlock('hc_sonnet');
    if (has('opus5')) this.unlock('hc_opus');
    if (has('fable5')) this.unlock('hc_fable');
    if (C.JUNK.every((f) => has(f.id))) this.unlock('hc_junk');
    if (ALL_CATCHES().every((f) => has(f.id))) this.unlock('hc_dex');
    if (r) {
      if (r.bestStreak >= 5) this.unlock('hc_streak5');
      if (r.tokens >= 250) this.unlock('hc_haul');
      if (r.fish >= 5 && r.escaped === 0) this.unlock('hc_nosnap');
    }
  };

  Game.prototype.finish = function (reason) {
    const r = this.run;
    if (!r || r.over) return;
    r.over = true;
    const p = this.p;
    // Into the shared arcade purse, not a private one. The haul is spendable
    // anywhere — bait here, upgrades in the Bot Bay, the casino when it opens —
    // until the player chooses to bank it into the build fund from the hub.
    wallet().earn(r.tokens, 'holiday-in-colombia');
    p.lifetimeTokens = (p.lifetimeTokens || 0) + r.tokens;
    p.best = {
      tokens: Math.max(p.best.tokens || 0, r.tokens),
      heaviest: Math.max(p.best.heaviest || 0, r.heaviest),
      fish: Math.max(p.best.fish || 0, r.fish),
      streak: Math.max(p.best.streak || 0, r.bestStreak),
    };
    p.history = (p.history || []);
    p.history.unshift({
      at: Date.now(), tokens: r.tokens, fish: r.fish, junk: r.junk,
      heaviest: r.heaviest, streak: r.bestStreak, escaped: r.escaped,
    });
    p.history = p.history.slice(0, C.SCORING.historyKept);
    this.checkAchievements();
    saveLocal(p);
    if (this.music) this.music.setState('menu');

    const result = {
      game: 'holiday-in-colombia',
      // `stageId`, not `stage` — the server reads stageId, so the old key meant
      // every fishing run was filed under the stage "unknown".
      stageId: 'lake',
      // The server only accepts clear/death/quit and silently rewrites anything
      // else to 'quit'. Running out of bait is finishing the trip; walking away
      // early is quitting it.
      outcome: reason === 'you packed up early' ? 'quit' : 'clear',
      score: r.tokens,
      tokens: r.tokens,
      tokensEarned: r.tokens,
      // Fishing saves nobody any money, so it reports none. It used to convert
      // its haul into dollars at a made-up rate just to have a number for the
      // shared board; the board now ranks fishing on streak, weight and fish
      // landed instead, which is what the cabinet's own board always did.
      dollarsSaved: 0,
      timeSurvived: Math.round(r.total ? r.total - r.time : 0),
      fish: r.fish, junk: r.junk, escaped: r.escaped,
      heaviest: r.heaviest, streak: r.bestStreak,
      newSpecies: r.newSpecies,
      reason,
      profile: p,
    };
    this.emit('run:end', result);
    this.screenResult(result, reason);
    try { this.onComplete(result); } catch (e) { console.error(e); }
  };

  // Shown on every landed catch. The clock is PAUSED behind it: this is the
  // reward, and taxing the player's time for succeeding is a strange thing to
  // do. Nothing can be fished while it is up, so pausing costs nothing.
  // One fact per catch, rotating. Tracked per species so landing three Haikuda
  // in a row teaches you three different things instead of the same one.
  const lastTip = {};
  function pickTip(def) {
    const pool = def.tips || [];
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    const fresh = pool.filter((t) => t !== lastTip[def.id]);
    const pick = fresh[(Math.random() * fresh.length) | 0];
    lastTip[def.id] = pick;
    return pick;
  }

  Game.prototype.screenCatch = function (c) {
    const legend = !!c.def.legendary;
    const tip = pickTip(c.def);
    const bonuses = [];
    if (c.clean) bonuses.push('🎯 Clean hook');
    if (c.perfect) bonuses.push('💪 Perfect cast');
    if (c.streak > 1) bonuses.push(`🔥 ${c.streak} in a row`);
    if (c.mult > 1.001) bonuses.push(`×${c.mult.toFixed(2)}`);

    this.ui.innerHTML = `
      <div class="hc-catch">
        <div class="cc ${legend ? 'legend' : ''}">
          ${c.isNew ? '<div class="newtag">NEW SPECIES</div>' : ''}
          <img class="fishimg" src="${portrait(c.def, 320)}" alt="">
          <h2>${esc(c.def.name)}</h2>
          ${c.def.species ? `<div class="sp">${esc(c.def.species)}</div>` : ''}
          <div class="facts">
            <div class="fact"><span>Weight</span><b>${c.kg} kg</b></div>
            <div class="fact tok"><span>Tokens</span><b>${fmt(c.tokens)}</b></div>
          </div>
          <div class="belly">${c.def.junk
            ? `Not a fish — but that is ${fmt(c.tokens)} tokens of waste off the bill.`
            : `${fmt(c.tokens)} AI tokens recovered from its belly.`}</div>
          ${bonuses.length ? `<div class="bonus">${bonuses.map((b) => `<i>${b}</i>`).join('')}</div>` : ''}
          ${tip ? `<div class="tipbox"><span>💡 Did you know</span><p>${esc(tip)}</p></div>` : ''}
          <div class="cta">
            <button class="hc-btn go" id="hc-next">Cast again</button>
            <button class="hc-btn ghost" id="hc-stop">✕ Pack up</button>
          </div>
          <div class="hint">ENTER or click to keep fishing</div>
        </div>
      </div>`;
    this.ui.classList.remove('pass');
    // A short deaf period. Even with reeling moved off space, a hurried player
    // can strike-tap into the card appearing — and skipping the reward you just
    // earned is the worst possible thing for this screen to do.
    const openedAt = performance.now();
    const go = () => {
      if (performance.now() - openedAt < 500) return;
      if (this.run && this.run.phase === 'card') this.nextCast();
    };
    this.ui.querySelector('#hc-next').onclick = go;
    // Stopping while you are ahead is a real decision, so it belongs on the
    // screen where you just found out how well you did.
    this.ui.querySelector('#hc-stop').onclick = (e) => {
      e.stopPropagation();
      if (performance.now() - openedAt < 500) return;
      if (this._cardKey) { this._cardKey(); this._cardKey = null; }
      if (this.run && !this.run.over) this.finish('you packed up early');
    };
    // ENTER only. SPACE is deliberately excluded: it is the reel key a beat
    // earlier, and letting it double as "dismiss" is exactly how you end up
    // never seeing what you caught.
    const key = (e) => {
      if (e.key.toLowerCase() !== 'enter') return;
      e.preventDefault();
      go();
    };
    global.addEventListener('keydown', key);
    this._cardKey = () => global.removeEventListener('keydown', key);
    this.ui.querySelector('.hc-catch').onclick = (e) => {
      if (e.target.closest('.cc') && !e.target.closest('#hc-next')) return;
      go();
    };
  };

  Game.prototype.screenResult = function (res, reason) {
    const r = this.run;
    this.clearUI();
    const rows = r.caught.length
      ? r.caught.map((c) => `<tr><td>${esc(c.name)}${c.species
            ? `<span style="color:#7f9fb0"> · ${esc(c.species)}</span>` : ''}</td><td>${c.kg} kg</td>
          <td style="color:#7fd4c4">+${fmt(c.tokens)}</td></tr>`).join('')
      : '<tr><td colspan="3" style="color:#8fb2c4">Nothing landed. It happens.</td></tr>';
    this.ui.innerHTML = `
      <div class="hc-veil"></div>
      <div class="hc-panel">
        <div class="hc-tag">Back to work — ${esc(reason)}</div>
        <h1><img class="hc-coin lg" src="../shared/assets/token-coin-64.png" alt="">${fmt(res.tokensEarned)} tokens reclaimed</h1>
        <div class="hc-stats">
          <div class="hc-stat">Fish<b>${res.fish}</b></div>
          <div class="hc-stat">Junk<b>${res.junk}</b></div>
          <div class="hc-stat">Heaviest<b>${res.heaviest || 0} kg</b></div>
          <div class="hc-stat">Best streak<b>${res.streak}</b></div>
          <div class="hc-stat">Got away<b>${res.escaped}</b></div>
          ${res.newSpecies ? `<div class="hc-stat">New species<b>${res.newSpecies}</b></div>` : ''}
        </div>
        <table class="hc-tbl" style="margin-top:14px">
          <thead><tr><th>Catch</th><th>Weight</th><th>Tokens</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="hc-tip">${fmt(res.tokensEarned)} tokens added to your arcade purse — spend them
          on bait, or bank them into CostBot's build fund from the arcade page.</p>
        <div class="hc-row">
          <button class="hc-btn go" id="hc-again" ${totalBait(this.p) ? '' : 'disabled'}>🎣 Another holiday</button>
          <button class="hc-btn" id="hc-triv">🎓 Trivia for bait</button>
          <button class="hc-btn ghost" id="hc-rec">🏆 Records</button>
          <button class="hc-btn ghost" id="hc-dock">Back to the dock</button>
        </div>
      </div>`;
    this.run = null;
    this.ui.querySelector('#hc-again').onclick = () => this.start();
    this.ui.querySelector('#hc-triv').onclick = () => this.screenTrivia();
    this.ui.querySelector('#hc-rec').onclick = () => this.screenBoard();
    this.ui.querySelector('#hc-dock').onclick = () => this.screenDock();
  };

  // ---------------------------------------------------------------------------
  // AMBIENT LAKE LIFE — purely decorative, but it is what makes the deep water
  // look worth casting into.
  // ---------------------------------------------------------------------------
  Game.prototype.makeAmbient = (spread) => {
    const band = (Math.random() * C.BANDS.length) | 0;
    const b = C.BANDS[band];
    return {
      x: spread ? Math.random() * VW : (Math.random() < 0.5 ? -60 : VW + 60),
      y: WATER_Y + LAKE_H * (b.from + Math.random() * (b.to - b.from)),
      size: 6 + band * 5 + Math.random() * 10,
      vx: (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 26 - band * 2),
      band,
      wob: Math.random() * TAU,
    };
  };

  Game.prototype.updateAmbient = function (dt) {
    for (let i = 0; i < this.ambient.length; i++) {
      const a = this.ambient[i];
      a.x += a.vx * dt;
      a.wob += dt * 2.2;
      if (a.x < -90 || a.x > VW + 90) this.ambient[i] = this.makeAmbient(false);
    }
  };

  // ---------------------------------------------------------------------------
  // DRAW
  // ---------------------------------------------------------------------------
  Game.prototype.draw = function () {
    const ctx = this.ctx;
    const v = this.view;
    // Reset, paint the letterbox, then move into logical 1152x648 space.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05131c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const k = v.scale * v.dpr;
    ctx.setTransform(k, 0, 0, k, v.offX * v.dpr, v.offY * v.dpr);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
    this.drawSky(ctx);
    this.drawLake(ctx);
    this.drawBoat(ctx);
    if (this.run) {
      this.drawLine(ctx);
      this.drawHud(ctx);
      const ph = this.run.phase;
      if (ph === 'cast') this.drawCastMeter(ctx);
      if (ph === 'reel') this.drawReel(ctx);
      if (ph === 'bite') this.drawBiteAlert(ctx);
      if (ph === 'idle') this.drawPrompt(ctx, 'SPACE to cast');
      if (this.run.msgT > 0) this.drawMsg(ctx);
    }
    ctx.restore();
  };

  Game.prototype.drawSky = function (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, WATER_Y);
    g.addColorStop(0, SKY[0]); g.addColorStop(0.42, SKY[1]);
    g.addColorStop(0.80, SKY[2]); g.addColorStop(1, SKY[3]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, WATER_Y);

    const sx = VW * 0.72, sy = WATER_Y - 150;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, 270);
    sun.addColorStop(0, 'rgba(255,250,226,.75)');
    sun.addColorStop(0.3, 'rgba(255,238,190,.26)');
    sun.addColorStop(1, 'rgba(255,232,170,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 280, sy - 280, 560, 560);

    const cloud = (cx, cy, sc, alpha) => {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      [[0, 0, 1], [-0.55, 0.18, 0.72], [0.62, 0.2, 0.66], [0.12, -0.28, 0.62], [-0.3, -0.16, 0.5]]
        .forEach(([dx, dy, r]) => {
          ctx.beginPath();
          ctx.ellipse(cx + dx * 62 * sc, cy + dy * 32 * sc, 54 * sc * r, 21 * sc * r, 0, 0, TAU);
          ctx.fill();
        });
    };
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 331 + this.t * (4 + i)) % (VW + 340)) - 170;
      cloud(cx, 40 + (i % 3) * 32, 0.95 + (i % 4) * 0.3, 0.34 - (i % 3) * 0.07);
    }

    // Andes: sharper and more angular than rolling hills, with a lit western
    // face and cloud snagged in the saddles — that is what the photo actually
    // shows, and it is what makes them read as mountains rather than bumps.
    const ridge = (baseY, amp, color, haze, freq, phase, lit, tint) => {
      const pts = [];
      for (let x = 0; x <= VW; x += 6) {
        const y = baseY
          - Math.abs(Math.sin(x * freq + phase)) * amp
          - Math.abs(Math.sin(x * freq * 0.41 + phase * 2.2)) * amp * 0.62
          - Math.abs(Math.sin(x * freq * 2.9 + phase)) * amp * 0.16;
        pts.push([x, y]);
      }
      // a vertical ramp inside the ridge itself: cool violet at the tops where
      // the sky reflects off the rock, warmer and greener down in the valley
      const vg = ctx.createLinearGradient(0, baseY - amp * 1.7, 0, WATER_Y);
      vg.addColorStop(0, shade(color, 1.14));
      vg.addColorStop(0.45, color);
      vg.addColorStop(1, shade(color, 0.7));
      ctx.fillStyle = vg;
      ctx.beginPath(); ctx.moveTo(0, WATER_Y);
      pts.forEach((p) => { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(VW, WATER_Y); ctx.closePath(); ctx.fill();

      // cold shadow pooling on the away-from-sun side
      ctx.save(); ctx.clip();
      const sg = ctx.createLinearGradient(0, 0, VW * 0.62, 0);
      sg.addColorStop(0, RIDGE_SHADE[tint] + (0.34 * (1 - haze)) + ')');
      sg.addColorStop(1, RIDGE_SHADE[tint] + '0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, baseY - amp * 2, VW, amp * 3 + (WATER_Y - baseY));
      ctx.restore();
      // Warm light falling from the sun's side. Done as one clipped gradient —
      // shading each rising column individually left visible 6px rectangles
      // stepping up the slope.
      if (lit) {
        ctx.save(); ctx.clip();
        const lg = ctx.createLinearGradient(VW * 0.30, 0, VW, 0);
        lg.addColorStop(0, RIDGE_LIT[tint] + '0)');
        lg.addColorStop(1, RIDGE_LIT[tint] + (lit * 3.4) + ')');
        ctx.fillStyle = lg;
        ctx.fillRect(0, baseY - amp * 2, VW, amp * 2 + (WATER_Y - baseY) + amp * 2);
        ctx.restore();
      }
      // ---- rock shading, all of it clipped to this ridge -------------------
      // Deliberately NO hard lines. The first attempt ruled long diagonal
      // strata across the whole range at a fixed spacing, and regular straight
      // lines across an irregular silhouette read as a rendering fault, not as
      // rock. Real distance flattens detail into soft value changes, so this is
      // all wide, low-alpha, low-frequency shading.
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, WATER_Y);
      pts.forEach((p) => { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(VW, WATER_Y); ctx.closePath();
      ctx.clip();

      // broad soft patches — the large-scale light and shade of a folded range
      ctx.globalAlpha = 0.055 * (1 - haze);
      for (let i = 0; i < 16; i++) {
        const px = noise(i * 4.7 + phase) * VW;
        const py = baseY - noise(i * 8.3 + phase) * amp * 1.2;
        const rw = 70 + noise(i * 2.9 + phase) * 190;
        const rh = 40 + noise(i * 6.1 + phase) * 90;
        const rg = ctx.createRadialGradient(px, py, 0, px, py, Math.max(rw, rh));
        const dark = i % 2 === 0;
        rg.addColorStop(0, dark ? 'rgba(6,14,20,.9)' : 'rgba(240,250,255,.75)');
        rg.addColorStop(1, dark ? 'rgba(6,14,20,0)' : 'rgba(240,250,255,0)');
        ctx.fillStyle = rg;
        ctx.save();
        ctx.translate(px, py); ctx.scale(1, rh / Math.max(rw, rh));
        ctx.beginPath(); ctx.arc(0, 0, Math.max(rw, rh), 0, TAU); ctx.fill();
        ctx.restore();
      }

      // soft shadow falling off the peaks, blurred rather than stroked
      ctx.globalAlpha = 0.5;
      ctx.shadowColor = 'rgba(8,16,22,.55)';
      ctx.shadowBlur = 22;
      for (let i = 3; i < pts.length - 3; i += 11) {
        const pk = pts[i];
        if (!(pk[1] < pts[i - 3][1] && pk[1] < pts[i + 3][1])) continue;   // peaks only
        ctx.strokeStyle = `rgba(10,20,28,${0.11 * (1 - haze)})`;
        ctx.lineWidth = 16 + noise(i) * 22;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pk[0] - 4, pk[1] + 8);
        ctx.quadraticCurveTo(pk[0] - 16, pk[1] + amp * 0.5, pk[0] - 26, WATER_Y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.lineCap = 'butt';

      // a hint of pale scree just under the ridgeline, following the crest
      ctx.globalAlpha = 0.16 * (1 - haze);
      ctx.strokeStyle = 'rgba(246,252,255,.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i) ctx.lineTo(p[0], p[1] + 3); else ctx.moveTo(p[0], p[1] + 3);
      });
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.restore();

      const hg = ctx.createLinearGradient(0, baseY - amp, 0, WATER_Y);
      hg.addColorStop(0, 'rgba(226,242,244,0)');
      hg.addColorStop(1, `rgba(230,244,244,${haze})`);
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.moveTo(0, WATER_Y);
      pts.forEach((p) => { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(VW, WATER_Y); ctx.closePath(); ctx.fill();
    };
    ridge(WATER_Y - 76, 138, RIDGE[0], 0.52, 0.0034, 0.6, 0.10, 0);
    ridge(WATER_Y - 48, 104, RIDGE[1], 0.33, 0.0048, 2.3, 0.09, 1);
    ridge(WATER_Y - 24, 70, RIDGE[2], 0.17, 0.0069, 4.2, 0.08, 2);

    // cloud lying in the saddles, the way it does in the photo
    for (let i = 0; i < 4; i++) {
      const cx = 120 + i * 300 + Math.sin(this.t * 0.08 + i) * 26;
      ctx.fillStyle = 'rgba(246,252,252,.34)';
      ctx.beginPath();
      ctx.ellipse(cx, WATER_Y - 44 - (i % 2) * 14, 128, 13, 0, 0, TAU);
      ctx.fill();
    }

    // terraced coffee slopes: four bands, each a shade darker toward the water
    for (let i = 0; i < 4; i++) {
      const hg = ctx.createLinearGradient(0, WATER_Y - 52 + i * 13, 0, WATER_Y);
      hg.addColorStop(0, HILL[i]);
      hg.addColorStop(1, HILL[Math.min(3, i + 1)]);
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.moveTo(0, WATER_Y);
      for (let x = 0; x <= VW; x += 6) {
        const y = WATER_Y - 42 + i * 12
          - Math.abs(Math.sin(x * 0.0036 + i * 2.1)) * (34 - i * 7)
          - Math.sin(x * 0.013 + i * 3) * 3.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(VW, WATER_Y); ctx.closePath(); ctx.fill();
      // scattered trees on the upper slopes, thinning as they go down
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, WATER_Y);
      for (let x = 0; x <= VW; x += 6) {
        const y = WATER_Y - 42 + i * 12
          - Math.abs(Math.sin(x * 0.0036 + i * 2.1)) * (34 - i * 7)
          - Math.sin(x * 0.013 + i * 3) * 3.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(VW, WATER_Y); ctx.closePath(); ctx.clip();
      ctx.globalAlpha = 0.30;
      for (let k = 0; k < 120; k++) {
        const nx = noise(k * 2.3 + i * 40) * VW;
        const ny = WATER_Y - 40 + i * 12 - noise(k * 5.1 + i) * 26;
        ctx.fillStyle = k % 3 ? '#16371c' : '#2f6b33';
        ctx.beginPath();
        ctx.ellipse(nx, ny, 3.4, 2.4, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // the terrace contour lines that make a coffee hillside look planted
      if (i < 3) {
        ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1;
        for (let k = 1; k <= 2; k++) {
          ctx.beginPath();
          for (let x = 0; x <= VW; x += 12) {
            const y = WATER_Y - 42 + i * 12 + k * 5
              - Math.abs(Math.sin(x * 0.0036 + i * 2.1)) * (34 - i * 7)
              - Math.sin(x * 0.013 + i * 3) * 3.5;
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      }
    }

    // palms along the far bank — the single most recognizable thing in the photo
    const palm = (px, py, sc, sway) => {
      ctx.save();
      ctx.translate(px, py); ctx.scale(sc, sc);
      ctx.strokeStyle = PALM.trunk; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sway * 5, -26, sway * 11, -50);
      ctx.stroke();
      const hx = sway * 11, hy = -50;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI + i * (Math.PI / 6) + Math.sin(this.t * 0.6 + i) * 0.04;
        ctx.strokeStyle = i % 2 ? PALM.frond : PALM.frondLit;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(hx + Math.cos(a) * 12, hy + Math.sin(a) * 12 - 6,
          hx + Math.cos(a) * 22, hy + Math.sin(a) * 20 + 5);
        ctx.stroke();
      }
      ctx.restore();
    };
    for (let i = 0; i < 9; i++) {
      const px = 60 + i * 137 + ((i * 53) % 40);
      palm(px, WATER_Y - 4, 0.62 + ((i * 7) % 5) * 0.10, (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.3));
    }

    // scrub at the waterline so the bank never ends on a ruled edge
    ctx.fillStyle = HILL[3];
    for (let x = 0; x < VW; x += 10) {
      const h = 5 + Math.abs(Math.sin(x * 0.23)) * 10;
      ctx.beginPath();
      ctx.ellipse(x, WATER_Y - 1, 8, h, 0, Math.PI, TAU);
      ctx.fill();
    }
  };

  Game.prototype.drawLake = function (ctx) {
    // Depth bands, drawn darkest last so the abyss reads as genuinely deep.
    for (const b of C.BANDS) {
      const y0 = WATER_Y + LAKE_H * b.from;
      const y1 = WATER_Y + LAKE_H * b.to;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, b.color);
      g.addColorStop(1, C.BANDS[Math.min(C.BANDS.length - 1, b.id + 1)].color);
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, VW, y1 - y0 + 1);
    }
    // The bank reflected in the near water — flat colour bands were the main
    // reason the lake read as a gradient rather than as water.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.scale(1, -1);
    ctx.translate(0, -WATER_Y * 2);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = HILL[i];
      ctx.beginPath(); ctx.moveTo(0, WATER_Y);
      for (let x = 0; x <= VW; x += 8) {
        const y = WATER_Y - 42 + i * 12
          - Math.abs(Math.sin(x * 0.0036 + i * 2.1)) * (34 - i * 7);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(VW, WATER_Y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // ...smeared, because a mirror-sharp reflection looks like a bug
    for (let i = 0; i < 26; i++) {
      const yy = WATER_Y + 3 + i * 3.2;
      ctx.fillStyle = `rgba(150,196,190,${0.05 - i * 0.0015})`;
      ctx.fillRect(Math.sin(this.t * 0.7 + i) * 7, yy, VW, 2);
    }

    // sun glitter running down the water under the sun
    const gx = VW * 0.72;
    for (let i = 0; i < 34; i++) {
      const yy = WATER_Y + 6 + i * 9;
      const spread = 26 + i * 5.5;
      const w = 8 + Math.abs(Math.sin(this.t * 1.6 + i * 1.3)) * 30;
      ctx.fillStyle = `rgba(255,250,222,${Math.max(0, 0.20 - i * 0.006)})`;
      ctx.fillRect(gx - spread / 2 + Math.sin(this.t * 0.9 + i) * spread * 0.4, yy, w, 2.2);
    }

    // a reflective sheen right at the surface
    ctx.fillStyle = 'rgba(232,252,255,.22)';
    ctx.fillRect(0, WATER_Y, VW, 2.5);
    for (let i = 0; i < 26; i++) {
      const x = ((i * 137 + this.t * 9) % (VW + 120)) - 60;
      const w = 30 + (i % 5) * 26;
      ctx.fillStyle = `rgba(235,252,255,${0.05 + (i % 3) * 0.02})`;
      ctx.fillRect(x, WATER_Y + 5 + (i % 4) * 9, w, 2);
    }

    for (const a of this.ambient) this.drawFish(ctx, a.x, a.y + Math.sin(a.wob) * 3,
      a.size, a.vx < 0 ? -1 : 1, `rgba(6,26,40,${0.32 - a.band * 0.05})`);

    for (const rp of this.ripples) {
      ctx.strokeStyle = `rgba(235,252,255,${0.42 * rp.life})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.3, 0, 0, TAU); ctx.stroke();
    }

    // Depth labels: a hairline rule, a small square marker and widely tracked
    // caps. The old version was chunky bold text floating on its own and looked
    // like debug output.
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = "600 9.5px 'Segoe UI',system-ui,sans-serif";
    ctx.letterSpacing = '2.6px';
    for (const b of C.BANDS) {
      const y = WATER_Y + LAKE_H * b.from + 18;
      const label = b.name.toUpperCase();
      const w = ctx.measureText(label).width;
      ctx.strokeStyle = 'rgba(214,244,252,.13)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(14, y + 9.5); ctx.lineTo(28 + w, y + 9.5); ctx.stroke();
      ctx.fillStyle = 'rgba(214,244,252,.34)';
      ctx.fillRect(14, y - 2.5, 5, 5);
      ctx.fillStyle = 'rgba(222,246,252,.42)';
      ctx.fillText(label, 27, y);
    }
    ctx.letterSpacing = '0px';
  };

  // A fish is an ellipse and a triangle. At these sizes nothing more reads.
  Game.prototype.drawFish = (ctx, x, y, size, dir, color) => {
    ctx.save();
    ctx.translate(x, y); ctx.scale(dir, 1);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(0, 0, size, size * 0.42, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-size * 0.85, 0);
    ctx.lineTo(-size * 1.5, -size * 0.45);
    ctx.lineTo(-size * 1.5, size * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  // The boat is drawn around the bot rather than under it: bot first, then the
  // near gunwale over his legs, so he reads as sitting IN the hull instead of
  // balanced on top of a brown bowl.
  Game.prototype.drawBoat = function (ctx) {
    const bx = VW * 0.17, by = WATER_Y;
    const bob = Math.sin(this.t * 1.1) * 2.4;      // a slow, tired holiday swell
    const rim = by - 14 + bob;

    // far gunwale, behind everything
    ctx.fillStyle = '#5d4629';
    ctx.beginPath();
    ctx.moveTo(bx - 104, rim - 6);
    ctx.quadraticCurveTo(bx, rim - 14, bx + 104, rim - 6);
    ctx.lineTo(bx + 104, rim + 2); ctx.lineTo(bx - 104, rim + 2);
    ctx.closePath(); ctx.fill();

    const bot = this.img.costbot;
    if (bot && bot.complete && bot.naturalWidth) {
      const h = 104, w = h * (bot.naturalWidth / bot.naturalHeight);
      ctx.drawImage(bot, bx - w / 2 - 6, rim - h + 22, w, h);
    }

    // hull: a shallow keel with a slight sheer, drawn over his legs
    const hull = ctx.createLinearGradient(0, rim, 0, rim + 34);
    hull.addColorStop(0, '#8a6d47');
    hull.addColorStop(1, '#4c3820');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(bx - 106, rim);
    ctx.lineTo(bx + 106, rim);
    ctx.quadraticCurveTo(bx + 78, rim + 30, bx + 6, rim + 32);
    ctx.quadraticCurveTo(bx - 74, rim + 30, bx - 106, rim);
    ctx.closePath(); ctx.fill();
    // the rubbing strake along the top edge
    ctx.fillStyle = '#a8865a';
    ctx.beginPath();
    ctx.moveTo(bx - 108, rim - 3);
    ctx.lineTo(bx + 108, rim - 3);
    ctx.lineTo(bx + 106, rim + 3);
    ctx.lineTo(bx - 106, rim + 3);
    ctx.closePath(); ctx.fill();
    // a thwart, so the eye reads it as a boat and not a crescent
    ctx.fillStyle = 'rgba(60,42,22,.55)';
    ctx.fillRect(bx + 28, rim + 2, 44, 5);

    // waterline shadow under the hull
    ctx.fillStyle = 'rgba(4,26,38,.28)';
    ctx.beginPath();
    ctx.ellipse(bx, rim + 32, 104, 7, 0, 0, TAU);
    ctx.fill();

    // the rod, angled out over the water toward the lure
    ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(bx + 16, rim - 34);
    ctx.quadraticCurveTo(bx + 94, rim - 84, bx + 152, rim - 96);
    ctx.stroke();
    this.rodTip = { x: bx + 152, y: rim - 96 };
  };

  Game.prototype.drawLine = function (ctx) {
    const r = this.run;
    if (r.phase === 'idle' || r.phase === 'cast') return;
    const tip = this.rodTip || { x: VW * 0.17 + 152, y: WATER_Y - 110 };
    const lx = this.lureX();
    const ly = this.lureY();
    // While fighting, the ONLY line is the taut one drawn to the fish below.
    // Drawing this slack one as well is what put two lines on screen at once.
    if (r.phase !== 'reel') {
      // Rod to float, then a straight dropper from the float down to the bait.
      // Running one curve all the way to the lure made the bobber look like it
      // was floating unattached beside the line.
      ctx.strokeStyle = 'rgba(240,252,255,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.quadraticCurveTo((tip.x + lx) / 2, tip.y + 26, lx, WATER_Y - 4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240,252,255,.34)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, WATER_Y + 2);
      ctx.lineTo(lx, ly);
      ctx.stroke();
    }

    // Bobber at the surface, ducking under on a bite — and gone entirely once
    // the fight starts, because a float still riding calmly on the water while
    // you are hauling a fish in looks like a bug.
    if (r.phase !== 'reel') {
      const dip = r.phase === 'bite' ? 8 + Math.sin(this.t * 30) * 2 : 0;
      ctx.fillStyle = '#e2483c';
      ctx.beginPath(); ctx.arc(lx, WATER_Y - 4 + dip, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f7f7f7';
      ctx.beginPath(); ctx.arc(lx, WATER_Y - 1 + dip, 6, 0, Math.PI); ctx.fill();
    }

    // the fish coming in to inspect the bait
    const c = r.comer;
    if (c && r.phase !== 'reel') {
      const size = 9 + c.def.kg * 0.42;
      ctx.save();
      if (c.def.legendary) { ctx.shadowColor = 'rgba(255,215,107,.55)'; ctx.shadowBlur = 14; }
      this.drawFish(ctx, c.x, c.y + Math.sin(c.wob) * 3, size, c.dir,
        c.def.legendary ? 'rgba(190,150,60,.72)' : 'rgba(8,30,44,.60)');
      ctx.restore();
    }

    if (r.phase !== 'reel') {
      ctx.fillStyle = 'rgba(255,236,150,.9)';
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, TAU); ctx.fill();
    } else if (r.hooked) {
      // The fish itself, hauled in toward the boat as you close the distance —
      // this IS the progress bar, which is why the panel no longer needs one.
      const h = r.hooked;
      const k = clamp(1 - h.dist, 0, 1);
      const fx = lx + (this.rodTip ? (this.rodTip.x - 40 - lx) : 0) * k;
      const fy2 = ly + (WATER_Y + 26 - ly) * k;
      const wob = Math.sin(this.t * (h.running ? 22 : 7)) * (h.running ? 7 : 2.5);
      ctx.save();
      if (h.def.legendary) { ctx.shadowColor = 'rgba(255,215,107,.7)'; ctx.shadowBlur = 16; }
      this.drawFish(ctx, fx, fy2 + wob, 11 + h.def.kg * 0.5, -1,
        h.def.legendary ? 'rgba(180,140,50,.8)' : 'rgba(8,30,44,.7)');
      ctx.restore();
      // the line goes taut and reddens as the tension climbs
      const tn = clamp(h.tension, 0, 1);
      ctx.strokeStyle = `rgba(${255},${Math.round(252 - tn * 160)},${Math.round(255 - tn * 190)},${0.5 + tn * 0.45})`;
      ctx.lineWidth = 1 + tn * 1.6;
      ctx.beginPath();
      ctx.moveTo(this.rodTip ? this.rodTip.x : lx, this.rodTip ? this.rodTip.y : WATER_Y);
      ctx.lineTo(fx, fy2 + wob);
      ctx.stroke();
    }
  };

  Game.prototype.drawHud = function (ctx) {
    const r = this.run;
    const pad = 14;
    ctx.font = "700 15px 'Segoe UI',system-ui,sans-serif";
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';

    // No clock any more — bait is the limit, so it takes the headline slot and
    // turns amber when it is nearly gone.
    const left = totalBait(this.p);
    const low = left <= 3;
    panel(ctx, pad, pad, 214, 54, 12);
    ctx.fillStyle = low ? '#ffb36b' : '#cfeaf5';
    ctx.font = "700 15px 'Segoe UI',system-ui,sans-serif";
    ctx.fillText(`${C.BAIT.icon} ${left} bait left`, pad + 12, pad + 8);
    ctx.font = "600 12px 'Segoe UI',system-ui,sans-serif";
    ctx.fillStyle = low ? '#e8874a' : '#7f9fb0';
    ctx.fillText(low ? 'nearly out — make them count' : 'fish as long as it lasts',
      pad + 12, pad + 30);

    // haul + streak
    ctx.textAlign = 'right';
    panel(ctx, VW - pad - 236, pad, 236, 54, 12);
    ctx.fillStyle = '#ffd98a';
    ctx.font = "800 20px 'Segoe UI',system-ui,sans-serif";
    ctx.fillText(fmt(r.tokens), VW - pad - 14, pad + 6);
    const coin = this.img.coin;
    if (coin && coin.complete && coin.naturalWidth) {
      const w = ctx.measureText(fmt(r.tokens)).width;
      ctx.drawImage(coin, VW - pad - 22 - w - 26, pad + 4, 24, 24);
    }
    ctx.font = "600 12.5px 'Segoe UI',system-ui,sans-serif";
    ctx.fillStyle = r.streak > 1 ? '#ff9d5c' : '#9dbccb';
    ctx.fillText(r.streak > 1 ? `🔥 ${r.streak} in a row · x${(1 + Math.min(C.SCORING.streakCap - 1,
      r.streak * C.SCORING.streakStep)).toFixed(2)}` : `${r.fish} landed`, VW - pad - 14, pad + 33);

  };

  Game.prototype.drawCastMeter = function (ctx) {
    const r = this.run;
    const w = 620, h = 38, x = (VW - w) / 2, y = VH - 132;

    panel(ctx, x - 20, y - 46, w + 40, h + 78, 18);

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = "800 12px 'Segoe UI',system-ui,sans-serif";
    ctx.fillStyle = 'rgba(196,232,248,.9)';
    ctx.letterSpacing = '2px';
    ctx.fillText('C A S T   P O W E R', VW / 2, y - 38);
    ctx.letterSpacing = '0px';

    // which zone the needle is over right now — highlighted, so the target is
    // obvious without reading the labels
    const live = C.CAST.zones.find((z) => r.meter <= z.to) || C.CAST.zones[C.CAST.zones.length - 1];

    ctx.save();
    roundRect(ctx, x, y, w, h, 10); ctx.clip();
    let from = 0;
    for (const z of C.CAST.zones) {
      const zx = x + w * from, zw = w * (z.to - from);
      const band = z.band >= 0 ? C.BANDS[z.band] : null;
      const on = z === live;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      if (band) {
        g.addColorStop(0, shade(band.color, on ? 1.5 : 1.06));
        g.addColorStop(1, shade(band.color, on ? 1.0 : 0.66));
      } else {
        g.addColorStop(0, on ? '#a33b3b' : '#5f2626');
        g.addColorStop(1, on ? '#5f2020' : '#3a1616');
      }
      ctx.fillStyle = g;
      ctx.fillRect(zx, y, zw, h);
      // The mark. A soft falloff across the zone shows which way the weight is
      // going — brightest at the centre, dimmest at the edges, because that is
      // exactly how the fish is sized. The hard line on top is the perfect
      // window itself, which is far too narrow to aim at as a gradient: a
      // fuzzy pillar was fine when it was half the zone wide and is useless now.
      if (band) {
        const c = x + w * this.zoneCentre(z);
        const half = w * this.zoneHalf(z);
        const fg = ctx.createLinearGradient(c - half, 0, c + half, 0);
        fg.addColorStop(0, 'rgba(255,255,255,0)');
        fg.addColorStop(0.5, on ? 'rgba(255,255,255,.34)' : 'rgba(255,255,255,.14)');
        fg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(c - half, y, half * 2, h);

        const pw = Math.max(1.5, w * C.CAST.perfectPad);
        ctx.fillStyle = on ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.4)';
        ctx.fillRect(c - pw / 2, y, pw, h);
        // notches top and bottom, so the line is findable at a glance
        ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,.55)';
        ctx.fillRect(c - pw, y, pw * 2, Math.max(2, h * 0.16));
        ctx.fillRect(c - pw, y + h - Math.max(2, h * 0.16), pw * 2, Math.max(2, h * 0.16));
      }
      ctx.fillStyle = 'rgba(4,16,24,.5)';
      ctx.fillRect(zx + zw - 1, y, 1.5, h);
      from = z.to;
    }
    // a glass highlight across the top third
    const gloss = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
    gloss.addColorStop(0, 'rgba(255,255,255,.26)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(x, y, w, h * 0.55);
    ctx.restore();

    // a machined rail around the track, same bevel language as the panel
    roundRect(ctx, x, y, w, h, 10);
    ctx.strokeStyle = 'rgba(214,244,255,.55)'; ctx.lineWidth = 2; ctx.stroke();
    roundRect(ctx, x + 1.6, y + 1.6, w - 3.2, h - 3.2, 9);
    ctx.strokeStyle = 'rgba(0,0,0,.42)'; ctx.lineWidth = 1.2; ctx.stroke();

    // labels under their zones, the live one lit
    from = 0;
    ctx.font = "700 10.5px 'Segoe UI',system-ui,sans-serif";
    for (const z of C.CAST.zones) {
      const zx = x + w * from, zw = w * (z.to - from);
      ctx.fillStyle = z === live ? '#eafaff' : 'rgba(160,196,214,.55)';
      ctx.fillText(z.label.toUpperCase(), zx + zw / 2, y + h + 9);
      from = z.to;
    }

    // the needle, with a short trail behind it in the direction of travel
    const nx = x + w * r.meter;
    for (let i = 5; i > 0; i--) {
      const tx = nx - r.meterDir * i * 7;
      if (tx < x || tx > x + w) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.05 * (6 - i)})`;
      ctx.fillRect(tx - 1.5, y + 3, 3, h - 6);
    }
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, nx - 2.5, y - 8, 5, h + 16, 2.5); ctx.fill();
    ctx.restore();
    // caps top and bottom so it reads as a slider, not a seam
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.moveTo(nx, y - 12); ctx.lineTo(nx - 6, y - 21);
    ctx.lineTo(nx + 6, y - 21); ctx.closePath(); ctx.fill();
  };

  // The closing ring. Drawn on the water at the bobber, so your eyes never
  // leave the spot where the fish actually is.
  Game.prototype.drawBiteAlert = function (ctx) {
    const r = this.run;
    const B = C.BITE;
    // At the lure, not the bobber. The fish swims to the bait, so the target has
    // to be on the bait — putting it at the surface float meant watching two
    // different places at once.
    const cx = this.lureX(), cy = this.lureY();
    const TARGET = 66;                      // px radius of the fixed ring
    const ring = clamp(r.ring == null ? B.ringFrom : r.ring, 0, B.ringFrom);
    const off = Math.abs(ring - 1);
    const live = off <= B.hitBand;
    const perfect = off <= B.perfectBand;

    ctx.save();
    // the hit band, as an actual annulus you can see
    ctx.beginPath();
    ctx.arc(cx, cy, TARGET * (1 + B.hitBand), 0, TAU);
    ctx.arc(cx, cy, TARGET * (1 - B.hitBand), 0, TAU, true);
    ctx.fillStyle = 'rgba(110,232,168,.16)';
    ctx.fill();
    // the clean-hook core
    ctx.beginPath();
    ctx.arc(cx, cy, TARGET * (1 + B.perfectBand), 0, TAU);
    ctx.arc(cx, cy, TARGET * (1 - B.perfectBand), 0, TAU, true);
    ctx.fillStyle = 'rgba(150,255,200,.30)';
    ctx.fill();
    // the target itself
    ctx.beginPath(); ctx.arc(cx, cy, TARGET, 0, TAU);
    ctx.strokeStyle = perfect ? '#b8ffd8' : '#6fe8a8';
    ctx.lineWidth = perfect ? 5.5 : 3.6;
    if (perfect) { ctx.shadowColor = 'rgba(140,255,200,.95)'; ctx.shadowBlur = 24; }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // the closing ring
    const rr = TARGET * ring;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU);
    ctx.strokeStyle = live ? '#ffffff' : 'rgba(255,240,190,.9)';
    ctx.lineWidth = live ? 6.5 : 4.4;
    ctx.shadowColor = live ? 'rgba(255,255,255,.95)' : 'rgba(255,220,120,.7)';
    ctx.shadowBlur = live ? 22 : 12;
    ctx.stroke();
    // four ticks riding the ring, so the motion is legible at any size
    ctx.shadowBlur = 0;
    ctx.strokeStyle = live ? 'rgba(255,255,255,.98)' : 'rgba(255,230,150,.88)';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + this.t * 0.9;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rr - 9), cy + Math.sin(a) * (rr - 9));
      ctx.lineTo(cx + Math.cos(a) * (rr + 9), cy + Math.sin(a) * (rr + 9));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.restore();

    // the call to action, above the ring and out of its way
    ctx.save();
    ctx.font = "900 26px 'Segoe UI',system-ui,sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = live ? 1 : 0.6 + 0.4 * Math.sin(this.t * 18);
    ctx.fillStyle = perfect ? '#b8ffd8' : (live ? '#ffffff' : '#ffe066');
    ctx.strokeStyle = 'rgba(4,18,28,.8)'; ctx.lineWidth = 5;
    const msg = live ? 'STRIKE!' : 'wait for it…';
    const my = Math.max(34, cy - TARGET * 2.5);
    ctx.strokeText(msg, cx, my);
    ctx.fillText(msg, cx, my);
    ctx.restore();
  };

  Game.prototype.drawReel = function (ctx) {
    const r = this.run, h = r.hooked;
    const R = C.REEL;
    const w = 560, gh = 26, x = (VW - w) / 2, y = VH - 116;

    panel(ctx, x - 22, y - 54, w + 44, gh + 96, 18);

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    // who is on the line
    ctx.font = "800 17px 'Segoe UI',system-ui,sans-serif";
    ctx.fillStyle = h.def.legendary ? '#ffd76b' : '#eafaff';
    ctx.fillText(h.def.name, VW / 2, y - 46);
    if (h.def.species) {
      ctx.font = "600 11.5px 'Segoe UI',system-ui,sans-serif";
      ctx.fillStyle = 'rgba(127,212,196,.95)';
      ctx.fillText(h.def.species, VW / 2, y - 26);
    }

    // ---- the tension gauge --------------------------------------------------
    ctx.save();
    roundRect(ctx, x, y, w, gh, 9); ctx.clip();
    ctx.fillStyle = 'rgba(6,24,36,.85)';
    ctx.fillRect(x, y, w, gh);
    // the zones, so "how much room have I got" is readable at a glance
    ctx.fillStyle = 'rgba(120,255,196,.10)';
    ctx.fillRect(x, y, w * R.safeTo, gh);
    ctx.fillStyle = 'rgba(255,196,90,.12)';
    ctx.fillRect(x + w * R.safeTo, y, w * (R.dangerFrom - R.safeTo), gh);
    ctx.fillStyle = 'rgba(255,90,90,.16)';
    ctx.fillRect(x + w * R.dangerFrom, y, w * (1 - R.dangerFrom), gh);

    const t = clamp(h.tension, 0, 1);
    const tg = ctx.createLinearGradient(x, 0, x + w, 0);
    tg.addColorStop(0, '#6fe8a8');
    tg.addColorStop(Math.max(0.01, R.safeTo), '#8dffc8');
    tg.addColorStop(Math.min(0.99, R.dangerFrom), '#ffcf6b');
    tg.addColorStop(1, '#ff6b5c');
    ctx.fillStyle = tg;
    ctx.fillRect(x, y, w * t, gh);
    // a pulsing wash once you are in the red — the only warning you need
    if (t > R.dangerFrom) {
      ctx.fillStyle = `rgba(255,70,60,${0.18 + 0.22 * Math.sin(this.t * 22)})`;
      ctx.fillRect(x, y, w, gh);
    }
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(x, y, w, gh * 0.4);
    ctx.restore();

    roundRect(ctx, x, y, w, gh, 9);
    ctx.strokeStyle = 'rgba(214,244,255,.55)'; ctx.lineWidth = 2; ctx.stroke();
    roundRect(ctx, x + 1.6, y + 1.6, w - 3.2, gh - 3.2, 8);
    ctx.strokeStyle = 'rgba(0,0,0,.42)'; ctx.lineWidth = 1.2; ctx.stroke();
    // the snap line
    ctx.strokeStyle = '#ff8a7a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w - 1, y - 5); ctx.lineTo(x + w - 1, y + gh + 5); ctx.stroke();

    ctx.font = "800 10.5px 'Segoe UI',system-ui,sans-serif";
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(180,214,230,.8)';
    ctx.letterSpacing = '1.4px';
    ctx.fillText('L I N E   T E N S I O N', x + 2, y + gh + 9);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff8a7a';
    ctx.fillText('SNAP', x + w - 2, y + gh + 9);

    // ---- how close it is ----------------------------------------------------
    const dw = w, dy = y + gh + 26;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(6,24,36,.7)';
    roundRect(ctx, x, dy, dw, 8, 4); ctx.fill();
    const closed = clamp(1 - h.dist, 0, 1);
    ctx.fillStyle = '#7fd6c4';
    roundRect(ctx, x, dy, Math.max(3, dw * closed), 8, 4); ctx.fill();

    // ---- the instruction, which changes with what the fish is doing ---------
    ctx.font = "800 14px 'Segoe UI',system-ui,sans-serif";
    if (h.running) {
      ctx.fillStyle = '#ff9d5c';
      ctx.fillText('IT IS RUNNING — LET GO', VW / 2, dy + 16);
    } else if (this.held) {
      ctx.fillStyle = '#8dffc8';
      ctx.fillText('reeling…', VW / 2, dy + 16);
    } else {
      ctx.fillStyle = '#cfeaf5';
      ctx.fillText('HOLD ↓ or SPACE to reel', VW / 2, dy + 16);
    }
  };

  Game.prototype.drawPrompt = (ctx, text) => {
    ctx.font = "800 15px 'Segoe UI',system-ui,sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = '1.6px';
    const w = ctx.measureText(text).width + 56;
    panel(ctx, (VW - w) / 2, VH - 122, w, 44, 14);
    // a soft key-cap glow so it reads as a prompt rather than a label
    ctx.save();
    ctx.shadowColor = 'rgba(150,222,246,.55)'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#e8f8ff';
    ctx.fillText(text, VW / 2, VH - 99);
    ctx.restore();
    ctx.letterSpacing = '0px';
  };

  Game.prototype.drawMsg = function (ctx) {
    const r = this.run;
    const plain = r.msg.replace(/<[^>]+>/g, '');
    ctx.font = "800 21px 'Segoe UI',system-ui,sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(plain).width + 46;
    const a = clamp(r.msgT / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    panel(ctx, (VW - w) / 2, VH * 0.30, w, 48, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(plain, VW / 2, VH * 0.30 + 24);
    ctx.restore();
  };

  // ---------------------------------------------------------------------------
  // Exposed for the smoke test: deterministic access to the draw tables.
  Game.prototype.pickSpecies = (band, rng, perfect) => pickSpecies(band, rng, perfect);
  Game.prototype.drawWeight = (fish, band, perfect) => drawWeight(fish, band, perfect);
  Game.prototype.rollCatch = (def, rng, acc) => rollCatch(def, rng, acc);
  Game.prototype.fightProfile = (def) => fightProfile(def);
  Game.prototype.totalBait = function () { return totalBait(this.p); };
  Game.prototype.portrait = (def, px) => portrait(def, px);
  Game.prototype.pickTip = (def) => pickTip(def);

  global.HolidayInColombia = {
    mount(container, opts) { return new Game(container, opts); },
    CONTENT: C,
    loadProfile: loadLocal,
  };
})(typeof window !== 'undefined' ? window : globalThis);
