/* ============================================================================
 * CostBot: Dojo — ENGINE
 * ----------------------------------------------------------------------------
 * Standalone playable AND embeddable as a mini-game inside a larger host game.
 *
 * CostBot throws boards; you break them. Every board is a real waste term out
 * of the bill, it holds a lane for a few seconds and then drifts away still
 * billing. The gold board stops the clock and asks you an AWS savings question.
 * Your savings at the bell set your belt.
 *
 * The one thing here that exists nowhere else in the arcade is the input: a
 * webcam split into three lanes, so a chop in the room breaks a board on the
 * mat. It is optional in the strongest sense — the camera is asked for once,
 * a refusal is a supported state, and the arrow keys and the mouse run the
 * same three lanes. Nothing about the game is gated on it, because a cabinet
 * that only works with a camera is a cabinet most people never play.
 *
 *   const game = CostBotDojo.mount(el, {
 *     seconds: 30,                // round length; omit for the saved setting
 *     seed: 20260803,             // optional; deterministic boards
 *     showShell: true,            // false = drop straight into a round
 *     persist: true,              // localStorage meta progression
 *     meta: hostMetaObject,       // optional: host owns the save data instead
 *     assetBase: '../shared/assets/',
 *     returnLabel: 'Return to HQ',
 *     onComplete(result) {},      // fired at the end of every round
 *     onEvent(type, payload) {},  // 'ready' 'run:start' 'run:break'
 *                                 // 'run:trivia' 'run:achievement' 'run:end' 'exit'
 *   });
 *   game.destroy();
 *
 * result = { game:'costbot-dojo', outcome:'clear'|'quit', stageId, seed,
 *            dollarsSaved, tokensEarned, level, kills, quizCorrect, quizWrong,
 *            timeSurvived, streak, belt, certified, meta }
 *
 * `outcome` is never 'death': there is no way to lose the dojo, only to score
 * badly. A round that reaches the bell is 'clear'; walking out mid-round is
 * 'quit'. `level` is the belt index, 1-5, so it ranks the same direction as
 * every other cabinet's level.
 *
 * assetBase defaults to the SHARED asset folder rather than a local one. The
 * dojo has no art of its own yet, and copying costbot.png into a second place
 * to pretend otherwise would just be 121KB of lie.
 * ==========================================================================*/
((global) => {
  'use strict';

  const C = global.CD_CONTENT;

  // The arcade's shared purse — tokens are earned in any cabinet and spent in
  // any cabinet. Absent only if the script failed to load, in which case the
  // game still runs; it just cannot pay out.
  const NO_WALLET = { tokens: 0, earn: () => 0, spend: () => false, bank: () => 0,
    init: () => ({}), onChange: () => () => {} };
  const wallet = () => global.ArcadeWallet || NO_WALLET;

  const VERSION = '0.1.0';
  const VW = 1152, VH = 648;                  // logical viewport, 16:9
  const MUSIC_VOL = 0.5;                       // normal soundtrack level
  const MUSIC_DUCK = MUSIC_VOL * 0.7079;       // -3 dB, for the results screen
  const MATERIALIZE_MS = 2600;                 // player assembles over the countdown
  const FADE_MS = 750;                         // player + dojo fade to black at the end
  // Cinematic bookend beats (COSTMAN-3737 reduced A/C):
  const INTRO_FADE_MS = 750;                   // dojo fades IN from black at round start
  const INTRO_HOLD_MS = 300;                   // beat of stillness on the dojo before the gong
  const OUTRO_RETURN_MS = 850;                 // webcam dissolves out / dojo materialises back
  const OUTRO_HOLD_MS = 300;                   // beat of stillness on the dojo before the gong
  const GONG_LEAD_MS = 560;                    // let the gong bloom before the next beat starts
  const RESULTS_DIM = 0.5;                     // round-end fade stops here (NOT full black) so the
                                               // dimmed dojo becomes the results-screen backdrop
  // deterministic per-pixel noise for the transporter dissolve (matches the
  // approved prototype: bottom-up bias so the figure assembles from the mat up)
  const dissolveThr = (x, y) => (Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.72 + (1 - y / VH) * 0.28;
  // CostBot elastic-arm chop timing (extend → impact → retract) + overshoot ease
  const STORE_KEY = 'costbot.dojo.v1';
  const LETTERS = ['A', 'B', 'C', 'D'];

  // ===========================================================================
  // Utility
  // ===========================================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const mmss = (s) => {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The tier owns the colour; every board inherits it so the two can never drift.
  const TIER = {};
  C.TIERS.forEach((t) => { TIER[t.key] = t; });
  C.BOARDS.forEach((b) => {
    if (!b.tier) return;
    b.color = TIER[b.tier].color;
    b.ink = TIER[b.tier].ink;
  });
  const SMASHABLE = C.BOARDS.filter((b) => !b.check);

  // ===========================================================================
  // Persistence
  // One key, prefixed `costbot.` so the owner-reset sweep in arcade-sync.js
  // finds it. A key it cannot see survives a server wipe and syncs the stale
  // progress straight back up, which is how a reset "does not work".
  // ===========================================================================
  const BLANK_META = () => ({
    runs: 0, best: 0, bestStreak: 0, lifetimeDollars: 0, lifetimeTokens: 0,
    quizCorrect: 0, checks: 0, belt: 0, achievements: {},
    // sensitivity default sits low: a booth is a busy, moving room, so the mat
    // wants a real swing to fire, not a passer-by. A quiet room can turn it up.
    setup: { seconds: C.ROUND.seconds, sensitivity: 4, boardSpeed: 5 },
    records: [],
  });

  function loadMeta(persist) {
    const m = BLANK_META();
    if (!persist) return m;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        Object.assign(m, o);
        m.setup = Object.assign(BLANK_META().setup, o.setup || {});
        m.achievements = o.achievements || {};
        m.records = Array.isArray(o.records) ? o.records : [];
      }
    } catch { /* corrupt or unavailable storage must never take the cabinet down */ }
    return m;
  }

  function saveMeta(meta, persist) {
    if (!persist) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(meta)); } catch { /* private mode */ }
  }

  // ===========================================================================
  // Audio — synthesized, so the cabinet is a folder of text
  // ===========================================================================
  function makeAudio() {
    let ctx = null, master = null, muted = false;
    function ensure() {
      if (ctx) return ctx;
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return ctx;
    }
    function tone(freq, dur, type, gain, to) {
      const c = ensure(); if (!c || muted) return;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (to) o.frequency.exponentialRampToValueAtTime(to, c.currentTime + dur);
      g.gain.setValueAtTime(gain || 0.12, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
      o.connect(g).connect(master);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    }
    function noise(dur, gain, freq) {
      const c = ensure(); if (!c || muted) return;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1500;
      const g = c.createGain(); g.gain.value = gain || 0.3;
      src.connect(f).connect(g).connect(master);
      src.start();
    }
    return {
      count: () => tone(440, 0.14, 'square', 0.2),
      go: () => tone(880, 0.28, 'square', 0.22),
      // A break is a snap, not a beep. Heavy tiers get a sparkle on top.
      brk: (big) => {
        noise(0.18, 0.34, 1500);
        if (big) [880, 1175, 1568].forEach((f, i) => { setTimeout(() => tone(f, 0.25, 'triangle', 0.12), i * 60); });
      },
      good: () => [659, 880, 1318].forEach((f, i) => { setTimeout(() => tone(f, 0.3, 'square', 0.11), i * 70); }),
      bad: () => { tone(311, 0.16, 'sawtooth', 0.13); setTimeout(() => tone(233, 0.24, 'sawtooth', 0.12), 100); },
      // A landed punch: a noise snap over a short low thud that drops in pitch.
      punch: () => { noise(0.1, 0.5, 800); tone(160, 0.13, 'square', 0.22, 60); },
      drift: () => { noise(0.14, 0.12, 420); tone(174, 0.2, 'sine', 0.08); },
      tick: (f) => tone(f, 0.11, 'square', 0.12),
      // Korean jing (징): a struck brass gong. A noise transient for the mallet,
      // a low inharmonic cluster that sags slightly (the wobble), close-detuned
      // partials that beat into a metallic shimmer, and a late bloom — all over a
      // long decay. Synthesised, no asset.
      gong: () => {
        noise(0.16, 0.22, 900);                              // mallet strike
        tone(138, 3.2, 'sine', 0.15, 128);                   // fundamental, sags
        tone(146, 3.2, 'sine', 0.06, 136);                   // close detune -> beating
        tone(207, 3.0, 'sine', 0.10, 200);                   // ~1.5x
        tone(278, 2.6, 'sine', 0.08, 272);                   // inharmonic upper
        tone(355, 2.2, 'sine', 0.06, 349);                   // shimmer
        tone(141, 2.8, 'triangle', 0.05, 131);               // brassy body
        setTimeout(() => {                                   // late shimmer bloom
          tone(420, 1.6, 'sine', 0.05, 405);
          tone(560, 1.3, 'sine', 0.035, 548);
          noise(0.5, 0.05, 3200);
        }, 180);
      },
      win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => { setTimeout(() => tone(f, 0.35, 'sine', 0.13), i * 110); }),
      // transporter materialize: a rising shimmer that lands on a bright chime
      materialize: () => { for (let i = 0; i < 7; i += 1) setTimeout(() => tone(300 + i * 190, 0.12, 'triangle', 0.06), i * 45); setTimeout(() => { tone(1568, 0.4, 'sine', 0.12); noise(0.16, 0.18, 2600); }, 340); },
      // power-down as the dojo fades to black
      powerdown: () => { tone(660, 0.5, 'sine', 0.12, 120); setTimeout(() => tone(220, 0.4, 'sine', 0.08, 70), 120); },
      ach: () => [880, 1174].forEach((f, i) => { setTimeout(() => tone(f, 0.2, 'sine', 0.11), i * 90); }),
      nodes() { const c = ensure(); return c ? { ctx: c, master } : null; },
      toggle() {
        muted = !muted;
        const c = ensure();
        if (c && master) master.gain.setTargetAtTime(muted ? 0.0001 : 0.32, c.currentTime, 0.05);
        return muted;
      },
      get muted() { return muted; },
      resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    };
  }

  // ===========================================================================
  // Styles (injected once)
  // ===========================================================================
  const CSS = `
.cd-root{--gold:#f0a52c;--line:#2b3f66;--fg:#e8eef8;--muted:#93a4c4;--teal:#7fd6c4;
  --panel:#131c30;--green:#6ee7a0;
  position:relative;width:100%;height:100%;background:#04060b;overflow:hidden;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:var(--fg);user-select:none;
  display:flex;align-items:center;justify-content:center;}
/* An author rule beats the hidden attribute, and two things in the prototype
   lost that fight: the Certified badge and the summary buttons both showed
   while still marked hidden. This is the guard, and it is deliberately the
   first rule in the sheet so nothing after it can win by accident. */
.cd-root [hidden]{display:none !important;}
.cd-frame{position:relative;transform-origin:top left;width:${VW}px;height:${VH}px;}
.cd-canvas{position:absolute;inset:0;width:${VW}px;height:${VH}px;display:block;}
.cd-ui{position:absolute;inset:0;pointer-events:none;}
.cd-ui > *{pointer-events:auto;}
.cd-hide{display:none !important;}

.cd-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:14px;padding:26px 34px;text-align:center;
  background:radial-gradient(ellipse at 50% 40%,rgba(20,32,58,.94),rgba(4,6,12,.985));
  backdrop-filter:blur(3px);overflow:auto;}
.cd-title{font-size:58px;font-weight:800;letter-spacing:-1.4px;margin:0;
  background:linear-gradient(180deg,#ffd76b,#ff9e2c 60%,#e07b1a);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 6px 26px rgba(255,160,40,.22);}
.cd-eyebrow{font-size:12px;font-weight:800;letter-spacing:3px;color:var(--teal);
  text-transform:uppercase;margin:0;}
.cd-sub{font-size:16px;color:var(--muted);margin:0;max-width:660px;line-height:1.55;}
.cd-hero{width:132px;height:132px;object-fit:contain;
  filter:drop-shadow(0 12px 26px rgba(60,140,255,.4));animation:cd-bob 2.6s ease-in-out infinite;}
@keyframes cd-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}

.cd-btn{background:linear-gradient(180deg,#27406e,#1a2b4c);border:1px solid #3f5f96;color:#eaf1ff;
  padding:12px 26px;border-radius:9px;font:650 15px inherit;cursor:pointer;transition:.14s;
  box-shadow:0 4px 0 #14203a,0 8px 20px rgba(0,0,0,.4);}
.cd-btn:hover{background:linear-gradient(180deg,#33528c,#21365e);transform:translateY(-2px);}
.cd-btn:active{transform:translateY(2px);box-shadow:0 2px 0 #14203a;}
.cd-btn.primary{background:linear-gradient(180deg,#f0a52c,#d4821a);border-color:#ffc866;
  color:#241403;box-shadow:0 4px 0 #8a5410,0 8px 20px rgba(220,140,30,.3);}
.cd-btn.ghost{background:rgba(255,255,255,.05);border-color:#31456b;box-shadow:none;
  padding:9px 18px;font-size:13.5px;}
.cd-row{display:flex;gap:11px;flex-wrap:wrap;justify-content:center;}

.cd-chip{background:rgba(255,255,255,.04);border:1px solid #31456b;color:#a9bad6;
  padding:6px 13px;border-radius:20px;font:650 12px inherit;}
.cd-chip b{color:var(--gold);font-variant-numeric:tabular-nums;}

.cd-panel{background:linear-gradient(180deg,#141d33,#0c1220);border:1px solid var(--line);
  border-radius:15px;padding:15px 19px;text-align:left;max-width:760px;width:100%;}
.cd-panel h4{margin:0 0 8px;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;color:var(--teal);}
.cd-panel p{margin:0 0 8px;font-size:13.5px;color:#a9bad6;line-height:1.6;}
.cd-panel p:last-child{margin-bottom:0;}
.cd-grid2{display:grid;grid-template-columns:1fr 1fr;gap:13px;max-width:790px;width:100%;}
.cd-kv{list-style:none;margin:0;padding:0;font-size:13px;color:#a9bad6;line-height:1.75;}
.cd-kv b{color:var(--fg);}
.cd-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;
  vertical-align:middle;}
.cd-fine{font-size:12px;color:#5d6d8a;line-height:1.6;margin:8px 0 0;}

/* ---- title: the cabinet "card" — art left, the brief on the right ---- */
.cd-card{display:grid;grid-template-columns:378px 1fr;gap:32px;align-items:center;
  width:min(1015px,94%);text-align:left;
  background:linear-gradient(180deg,rgba(21,31,54,.94),rgba(11,17,30,.96));
  border:1px solid #2b3f66;border-radius:22px;padding:30px 34px;
  box-shadow:0 34px 80px rgba(0,0,0,.55);}
.cd-card-art{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;border-radius:15px;
  border:1px solid #35507f;box-shadow:0 16px 34px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.03);}
.cd-card-body{display:flex;flex-direction:column;gap:14px;min-width:0;}
.cd-card-body .cd-eyebrow{margin:0;}
.cd-card-body .cd-title{font-size:47px;line-height:1;letter-spacing:-1px;}
.cd-card-body .cd-sub{margin:0;max-width:none;font-size:14.5px;color:#9fb0cf;line-height:1.5;}
.cd-card-body .cd-row{justify-content:flex-start;gap:10px;}
.cd-stats{display:flex;gap:10px;flex-wrap:wrap;}
.cd-stat{background:rgba(255,255,255,.03);border:1px solid #2b3f66;border-radius:12px;
  padding:9px 14px 10px;min-width:74px;}
.cd-stat em{display:block;font-style:normal;font-size:10px;letter-spacing:.7px;
  text-transform:uppercase;color:#7c8daf;margin-bottom:4px;}
.cd-stat b{font-size:19px;font-weight:800;color:var(--fg);font-variant-numeric:tabular-nums;}
.cd-stat b.gold{color:var(--gold);}
.cd-keys{display:flex;gap:17px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:#8395b5;}
.cd-keys span{display:inline-flex;gap:6px;align-items:center;}
.cd-kbd{display:inline-block;background:#182640;border:1px solid #35507f;border-bottom-width:2px;
  border-radius:6px;padding:2px 7px;font:700 12px inherit;color:#cfe0ff;min-width:14px;text-align:center;}
.cd-tip{font-size:12.5px;color:#6f80a0;font-style:italic;margin:0;}

.cd-field{display:block;text-align:left;margin-bottom:13px;}
.cd-field span{display:block;font-size:13px;color:#a9bad6;margin-bottom:6px;}
.cd-field span b{color:var(--gold);font-variant-numeric:tabular-nums;}
.cd-field input[type=range]{width:100%;accent-color:#f0a52c;}
.cd-note{font-size:11.5px;color:#5d6d8a;margin-top:4px;line-height:1.5;}
.cd-status{font-size:13px;color:var(--muted);margin:0 0 10px;}
.cd-status.ok{color:var(--green);} .cd-status.no{color:#ff9e9e;}
.cd-meters{display:flex;gap:12px;align-items:flex-end;height:64px;margin:4px 0 10px;}
.cd-meter{flex:1 1 0;position:relative;height:58px;background:#0b1322;border:1px solid #23324f;
  border-radius:5px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;}
.cd-meter i{display:block;background:linear-gradient(180deg,var(--teal),#f0a52c);height:0;
  transition:height .08s linear;}
.cd-meter.on i{background:linear-gradient(180deg,#ffd76b,#f0a52c);}
.cd-meter em{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-style:normal;
  font-size:9.5px;letter-spacing:.6px;color:#5d6d8a;text-transform:uppercase;}
.cd-meter::after{content:'';position:absolute;left:0;right:0;bottom:29px;border-top:1px dashed #3f5f96;}

.cd-table{border-collapse:collapse;width:100%;max-width:760px;font-size:13.5px;}
.cd-table th{text-align:left;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;
  color:#5d6d8a;padding:0 10px 8px;border-bottom:1px solid var(--line);font-weight:800;}
.cd-table td{padding:8px 10px;border-bottom:1px solid #1e2c47;color:#a9bad6;}
.cd-table tr:first-child td{color:var(--fg);}
.cd-table tr:first-child td:nth-child(3){color:var(--gold);font-weight:800;}
.cd-table td.empty{text-align:center;color:#5d6d8a;padding:22px 0;}

/* ---- countdown ---- */
.cd-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(4,6,12,.5);}
.cd-count b{font-size:150px;font-weight:800;color:var(--gold);
  text-shadow:0 0 44px rgba(240,165,44,.5);animation:cd-pop .4s ease-out;}
.cd-count b.go{font-size:104px;color:var(--green);text-shadow:0 0 44px rgba(110,231,160,.5);}
@keyframes cd-pop{from{transform:scale(1.7);opacity:0}to{transform:scale(1);opacity:1}}
.cd-count.cd-reentry{flex-direction:column;gap:2px;}
.cd-reentry-label{font:800 15px 'Segoe UI',system-ui,sans-serif;letter-spacing:3.5px;
  text-transform:uppercase;color:#93a4c4;text-shadow:0 2px 12px rgba(4,6,12,.8);}

/* ---- savings check ---- */
.cd-veil{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:13px;background:rgba(4,6,12,.72);backdrop-filter:blur(3px);padding:20px;}
/* Results screen: a lighter scrim than the quiz veil so the dimmed dojo shows
   through as the backdrop (the opaque summary card carries the text). */
.cd-veil.cd-veil-results{background:rgba(4,6,12,.28);}
/* The prompt sits in a small panel dead-centre; the answers are punched at the
   corners (see .cd-coin), so this stays narrow and out of their way. */
.cd-quiz-center{position:absolute;top:34px;left:50%;transform:translateX(-50%);
  width:600px;max-width:80%;background:linear-gradient(180deg,#16203a,#0d1424);
  border:2px solid #3f5f96;border-radius:16px;padding:18px 22px 16px;text-align:center;
  box-shadow:0 26px 64px rgba(0,0,0,.65);z-index:2;}
.cd-quiz-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:11px;}
.cd-quiz-tag{font-size:11.5px;font-weight:800;letter-spacing:1.5px;color:var(--teal);}
.cd-quiz-prize{font-size:12.5px;font-weight:700;color:#ffd76b;background:rgba(240,165,44,.13);
  border:1px solid #6b5320;padding:4px 11px;border-radius:20px;white-space:nowrap;}
.cd-quiz-timer{height:5px;background:#1b2740;border-radius:5px;overflow:hidden;margin-bottom:14px;}
.cd-quiz-timer i{display:block;height:100%;background:linear-gradient(90deg,#6ee7a0,#ffd76b);}
.cd-quiz-timer.low i{background:linear-gradient(90deg,#ff8a8a,#ff3b3b);}
.cd-quiz-q{font-size:21px;line-height:1.34;margin:0 0 8px;font-weight:700;}

/* The three answers are gold "POW!" coins, one per lane (left/centre/right) —
   chop the lane of your answer, the same gesture as breaking a board. Absolute,
   lane-centred, near the bottom; label sits above the coin. */
.cd-coin{position:absolute;bottom:52px;width:320px;max-width:31%;transform:translateX(-50%);
  display:flex;flex-direction:column-reverse;align-items:center;gap:10px;
  background:none;border:none;padding:0;cursor:pointer;color:#eaf1ff;font:inherit;z-index:3;}
.cd-coin-l{left:16.66%;}
.cd-coin-c{left:50%;}
.cd-coin-r{left:83.34%;}
.cd-coin:hover:not(:disabled) .cd-pow{transform:scale(1.09) rotate(-4deg);}
.cd-coin:active:not(:disabled) .cd-pow{transform:scale(.9);}
/* the spiky POW! starburst */
.cd-pow{position:relative;width:96px;height:96px;display:flex;align-items:center;justify-content:center;
  transition:transform .1s;background:radial-gradient(circle at 50% 38%,#ffe89a,#f0a52c 58%,#c9781a);
  clip-path:polygon(50% 0,61% 22%,86% 12%,79% 39%,100% 50%,79% 61%,86% 88%,61% 78%,50% 100%,39% 78%,14% 88%,21% 61%,0 50%,21% 39%,14% 12%,39% 22%);
  filter:drop-shadow(0 6px 14px rgba(240,165,44,.45));}
/* the coin face nested inside the burst, letter stamped on it */
.cd-coin-face{width:62px;height:62px;border-radius:50%;
  background:radial-gradient(circle at 40% 32%,#fff2c4,#f6b73c 55%,#cf861d);
  border:2px solid #8a5a12;box-shadow:inset 0 2px 5px rgba(255,255,255,.6),inset 0 -4px 8px rgba(120,70,10,.5);
  display:flex;align-items:center;justify-content:center;}
.cd-coin-face b{font-size:31px;font-weight:900;color:#7a4a08;text-shadow:0 1px 0 rgba(255,255,255,.4);}
.cd-coin-label{font-size:15px;font-weight:650;color:#dce7f8;line-height:1.25;
  background:rgba(10,16,30,.74);border:1px solid #33507f;border-radius:9px;padding:7px 12px;}
.cd-coin.struck{opacity:.3;}
.cd-coin.struck .cd-coin-label{text-decoration:line-through;}
.cd-coin.right .cd-coin-label{background:#123a26;border-color:#4ade80;color:#c7f5da;}
.cd-coin.right .cd-pow{filter:drop-shadow(0 0 16px rgba(74,222,128,.85));animation:cd-coinpop .4s ease-out;}
.cd-coin.wrong .cd-coin-label{background:#3a1418;border-color:#ff6b6b;color:#ffd0d0;}
.cd-coin.wrong .cd-pow{filter:grayscale(.55) drop-shadow(0 4px 10px rgba(0,0,0,.5));}
@keyframes cd-coinpop{0%{transform:scale(1)}40%{transform:scale(1.28)}100%{transform:scale(1.09)}}
/* live punch feedback: motion landing in a corner lights that coin as it charges */
.cd-coin{--charge:0;transition:opacity .35s ease,filter .35s ease;}
/* asleep = the compose grace right after a check opens: dimmed, greyed and
   unpunchable so a leftover swing can't answer before the player is ready. */
.cd-coin.asleep{opacity:.38;filter:grayscale(.85);pointer-events:none;}
.cd-coin.charging .cd-pow{filter:drop-shadow(0 0 calc(6px + var(--charge)*24px) rgba(255,222,120,calc(.4 + var(--charge)*.6)));}
.cd-coin.charging .cd-coin-face{box-shadow:inset 0 2px 5px rgba(255,255,255,.6),inset 0 -4px 8px rgba(120,70,10,.5),0 0 calc(var(--charge)*14px) rgba(255,222,120,.9);}
.cd-quiz-dbg{margin-top:11px;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--teal);
  opacity:.8;letter-spacing:.2px;}
.cd-quiz-foot{font-size:12px;color:#7e8fae;margin-top:13px;text-align:center;font-style:italic;}
.cd-why{margin-top:14px;padding:13px 15px;border-radius:9px;font-size:13.5px;line-height:1.5;}
.cd-why b{display:block;margin-bottom:5px;font-size:14.5px;}
.cd-why.ok{background:rgba(74,222,128,.10);border:1px solid #2e7d4f;color:#c7f5da;}
.cd-why.no{background:rgba(255,107,107,.10);border:1px solid #8a3535;color:#ffd0d0;}
/* The source line is the edutainment payoff: it says where the fact came from,
   which is the difference between a quiz and a lesson. */
.cd-src{margin-top:9px;font-size:11.5px;color:#5d6d8a;display:flex;align-items:center;gap:7px;
  flex-wrap:wrap;}
.cd-src span{font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;
  background:rgba(127,214,196,.12);border:1px solid #2f6b60;color:var(--teal);
  padding:2px 8px;border-radius:20px;}
.cd-src span.aws{background:rgba(240,165,44,.12);border-color:#6b5320;color:#ffd76b;}
.cd-continue{margin-top:10px;font-size:11.5px;color:#5d6d8a;text-align:center;letter-spacing:.4px;}
.cd-cert{display:flex;align-items:center;gap:12px;background:linear-gradient(180deg,#12241a,#0b1410);
  border:1px solid #2e7d4f;border-radius:15px;padding:11px 17px;max-width:770px;}
.cd-cert em{font-size:26px;font-style:normal;}
.cd-cert b{display:block;font-size:14px;color:var(--green);}
.cd-cert i{font-style:normal;font-size:12px;color:#7e8fae;}

/* ---- count-out ---- */
.cd-sum{width:640px;max-width:100%;background:linear-gradient(180deg,#141d33,#0c1220);
  border:1px solid var(--line);border-radius:16px;padding:22px 26px;
  box-shadow:0 26px 64px rgba(0,0,0,.65);}
.cd-sum h3{margin:0;font-size:30px;font-weight:800;}
.cd-sum .cd-sub{margin:5px 0 15px;font-size:13.5px;}
.cd-srow{display:flex;justify-content:space-between;align-items:center;gap:14px;
  padding:8px 0;border-bottom:1px solid #1e2c47;font-size:13.5px;color:#a9bad6;
  opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s;}
.cd-srow.show{opacity:1;transform:none;}
.cd-srow b{color:var(--fg);font-variant-numeric:tabular-nums;}
.cd-srow.bonus b{color:var(--green);}
.cd-srow-det{display:block;font-size:11px;color:#5d6d8a;margin-top:2px;}
.cd-fig{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
  margin-top:14px;padding-top:13px;border-top:1px solid #23324f;}
.cd-fig span{font-size:12.5px;letter-spacing:1.2px;text-transform:uppercase;color:#5d6d8a;font-weight:800;}
.cd-fig b{font-size:36px;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums;}
.cd-tok{margin:9px 0 0;font-size:12.5px;color:#7e8fae;}
.cd-tok b{color:var(--green);}
.cd-belt{display:flex;align-items:center;gap:13px;margin-top:14px;padding:12px 15px;
  border-radius:15px;background:#0b1322;border:1px solid #23324f;}
.cd-belt i{flex:0 0 auto;width:46px;height:15px;border-radius:5px;border:1px solid rgba(255,255,255,.22);}
.cd-belt-b{flex:1 1 auto;min-width:0;text-align:left;}
.cd-belt-b b{display:block;font-size:17px;}
.cd-belt-b span{font-size:12px;color:var(--teal);letter-spacing:.4px;}

/* ---- pause ---- */
.cd-pause{text-align:center;}
.cd-pause h3{margin:0 0 5px;font-size:28px;}
.cd-pause p{margin:0 0 15px;font-size:13.5px;color:var(--muted);}
`;

  function injectCSS() {
    if (document.getElementById('cd-style')) return;
    const s = document.createElement('style');
    s.id = 'cd-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ===========================================================================
  // Instance
  // ===========================================================================
  function Instance(container, opts) {
    opts = opts || {};
    injectCSS();

    this.opts = opts;
    this.persist = opts.persist !== false;
    this.meta = opts.meta || loadMeta(this.persist);
    if (!this.meta.setup) this.meta.setup = BLANK_META().setup;
    if (!this.meta.achievements) this.meta.achievements = {};
    if (!Array.isArray(this.meta.records)) this.meta.records = [];
    this.onEvent = opts.onEvent || (() => {});
    this.onComplete = opts.onComplete || (() => {});
    this.showShell = opts.showShell !== false;
    this.returnLabel = opts.returnLabel || 'Exit';
    this.audio = makeAudio();
    const MUSIC = global.ArcadeMusic;
    this.music = MUSIC ? MUSIC.create(() => this.audio.nodes()) : null;
    if (this.music) this.music.setTheme('dojo');
    this._musicSlot = null;
    this._quizSkip = null;
    // The raw per-lane motion readout under a Savings Check is a tuning aid, not
    // cabinet polish: off by default, on with ?debug=1 (or opts.debug) so we can
    // still diagnose a camera in the field without shipping numbers to players.
    this._debug = opts.debug === true
      || (typeof location !== 'undefined' && /[?&]debug=1(?:&|$)/.test(location.search));
    this.destroyed = false;
    if (opts.seconds) this.meta.setup.seconds = clamp(opts.seconds, 15, 60);

    // ---- DOM ----------------------------------------------------------------
    const root = document.createElement('div');
    root.className = 'cd-root';
    root.innerHTML = `
      <div class="cd-frame">
        <canvas class="cd-canvas" width="${VW}" height="${VH}"></canvas>
        <div class="cd-ui"></div>
      </div>`;
    container.innerHTML = '';
    container.appendChild(root);

    this.root = root;
    this.frame = root.querySelector('.cd-frame');
    this.canvas = root.querySelector('.cd-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ui = root.querySelector('.cd-ui');

    // ---- assets -------------------------------------------------------------
    this.assetBase = opts.assetBase || '../shared/assets/';
    this.hero = new Image();
    this.hero.src = this.assetBase + 'costbot.png';
    // the rendered dojo stage (backdrop for the CostBot mode; intro for "me")
    this._stage = new Image();
    this._stage.src = this.assetBase + 'costbot-dojo-stage.jpg';
    // the karate CostBot avatar who stands on the mat and chops in CostBot mode
    this._revealAt = 0;                          // materialize clock (set at countdown)
    this._fadeAt = 0;                            // fade-to-black clock (set at round end)
    this._introFadeAt = 0;                       // dojo fade-IN-from-black clock (round start)
    this._returnAt = 0;                          // webcam->dojo return clock (round end)

    // ---- input --------------------------------------------------------------
    this.motion = global.CDMotion
      ? global.CDMotion.create({ lanes: C.ROUND.lanes })
      : { start: () => Promise.resolve(false), stop() {}, sample() {}, chops: () => [],
        isLive: () => false, lanes: [0, 0, 0], state: 'blocked', laneCount: C.ROUND.lanes };

    this._onKeyDown = (e) => this.onKey(e);
    this._onDown = (e) => this.onPointer(e);
    this._onBlur = () => { if (this.state === 'play') this.setPause(true); };
    // An automated tab and a real player who alt-tabs look identical here, so
    // the pause is deliberate — it just means a headless driver has to click
    // Resume, which the smoke test does.
    this._onVis = () => { if (document.hidden && this.state === 'play') this.setPause(true); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVis);
    this.canvas.addEventListener('pointerdown', this._onDown);

    // ---- resize -------------------------------------------------------------
    this._resize = () => {
      const r = container.getBoundingClientRect();
      const s = Math.min(r.width / VW, r.height / VH);
      this.frame.style.transform = `scale(${s})`;
      this.frame.style.left = ((r.width - VW * s) / 2) + 'px';
      this.frame.style.top = ((r.height - VH * s) / 2) + 'px';
      this.frame.style.position = 'absolute';
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();

    // ---- run state ----------------------------------------------------------
    this.state = 'idle';       // idle | countdown | play | check | paused | over
    this.run = null;
    this.sensei = { bob: 0, pulse: 0, line: '', lineLeft: 0 };
    this._timers = [];

    // ---- loop ---------------------------------------------------------------
    this.lastT = performance.now();
    this._tick = (now) => {
      if (this.destroyed) return;
      const dt = Math.min(50, now - this.lastT);
      this.lastT = now;
      this.update(dt, now);
      this.render(now);
      requestAnimationFrame(this._tick);
    };
    requestAnimationFrame(this._tick);

    // ---- boot ---------------------------------------------------------------
    this.rngSeed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    if (this.showShell) this.screenTitle();
    else this.startRound(this.rngSeed);

    this.emit('ready', { version: VERSION });
  }

  Instance.prototype.emit = function (t, p) {
    try { this.onEvent(t, p || {}); } catch (e) { console.error(e); }
  };

  Instance.prototype.later = function (fn, ms) {
    const id = setTimeout(() => { if (!this.destroyed) fn(); }, ms);
    this._timers.push(id);
    return id;
  };

  Instance.prototype.clearTimers = function () {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  };

  Instance.prototype.destroy = function () {
    this.destroyed = true;
    this.clearTimers();
    if (this.music) this.music.stop();
    this.motion.stop();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVis);
    // A Savings Check reveal may have left its skip listeners on window; clearing
    // timers cancels the auto-advance but never runs advance(), so detach here.
    if (this._quizSkip) {
      window.removeEventListener('keydown', this._quizSkip);
      window.removeEventListener('pointerdown', this._quizSkip);
      this._quizSkip = null;
    }
    if (this._ro) this._ro.disconnect();
    this.root.remove();
  };

  // ===========================================================================
  // Screens
  // ===========================================================================
  Instance.prototype.clearUI = function () { this.ui.innerHTML = ''; };

  Instance.prototype.screen = function (cls, html) {
    this.clearUI();
    const el = document.createElement('div');
    el.className = 'cd-screen ' + (cls || '');
    el.innerHTML = html;
    this.ui.appendChild(el);
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => this.act(b.dataset.act, b));
    });
    return el;
  };

  // menu | stage | boss (boss = the trivia think-cue). Remembered so the first
  // real gesture — which is what unlocks the audio context — can (re)start
  // whatever slot the screen already asked for.
  Instance.prototype.setMusic = function (slot) {
    this._musicSlot = slot;
    if (this.music) this.music.setState(slot);
  };

  Instance.prototype.act = function (action) {
    this.audio.resume();
    if (this.music && this._musicSlot) this.music.setState(this._musicSlot);
    if (action === 'start') { this.startRound(); return; }
    if (action === 'howto') { this.screenHowTo(); return; }
    if (action === 'setup') { this.screenSetup(); return; }
    if (action === 'records') { this.screenRecords(); return; }
    if (action === 'title') { this.leaveRound(); return; }
    if (action === 'resume') { this.setPause(false); return; }
    if (action === 'cam') {
      // getUserMedia can sit on a permission prompt for an arbitrary time. Only
      // refresh Setup when it resolves if that screen is still up — the player
      // may have gone Back, stepped on the mat, or the instance may be gone.
      // The 'cam' button exists only on Setup, so its presence is the guard.
      this.motion.start().then(() => {
        if (!this.destroyed && this.ui.querySelector('[data-act="cam"]')) this.screenSetup();
      });
      this.screenSetup();
      return;
    }
    if (action === 'clear-records') {
      this.meta.records = [];
      saveMeta(this.meta, this.persist);
      this.screenRecords();
      return;
    }
    if (action === 'exit') { this.emit('exit', {}); return; }
  };

  Instance.prototype.camLine = function () {
    const s = this.motion.state;
    if (s === 'ready') return ['ok', 'Camera ready. Stand back and chop.'];
    if (s === 'blocked') return ['no', 'No camera — the arrow keys run the same three lanes.'];
    if (s === 'requesting') return ['', 'Requesting camera…'];
    return ['', 'The camera starts when you step on the mat.'];
  };

  Instance.prototype.screenTitle = function () {
    this.state = 'idle';
    this._fadeAt = 0;
    this._revealAt = 0;
    this._introFadeAt = 0;
    this._returnAt = 0;
    if (this.music) this.music.setVolume(MUSIC_VOL);   // undo any results-screen duck
    this.setMusic('menu');
    const m = this.meta;
    const belt = C.BELTS[clamp(m.belt || 0, 0, C.BELTS.length - 1)];
    const cam = this.camLine();
    const tip = C.TIPS[(Math.random() * C.TIPS.length) | 0];
    this.screen('', `
      <div class="cd-card">
        <img class="cd-card-art" src="${this.assetBase}costbot-dojo.jpg" alt="CostBot Dojo">
        <div class="cd-card-body">
          <p class="cd-eyebrow">CostBot Arcade</p>
          <h1 class="cd-title">CostBot Dojo</h1>
          <p class="cd-sub">CostBot throws the waste; you break it. Every board is a real pattern
            out of the bill — it holds a lane for a few seconds, then drifts away still billing.
            The gold board freezes the clock for a Savings Check — answer right and win bonus time.</p>
          <div class="cd-stats">
            <div class="cd-stat"><em>Best</em><b class="gold">${money(m.best || 0)}</b></div>
            <div class="cd-stat"><em>Rank</em><b style="color:${belt.color}">${esc(belt.name)}</b></div>
            <div class="cd-stat"><em>Tokens</em><b class="gold">${wallet().tokens.toLocaleString('en-US')}</b></div>
            <div class="cd-stat"><em>Checks passed</em><b>${m.quizCorrect || 0}</b></div>
            <div class="cd-stat"><em>Best streak</em><b>${m.bestStreak || 0}</b></div>
          </div>
          <div class="cd-row">
            <button class="cd-btn primary" data-act="start">▶  Step On The Mat</button>
            <button class="cd-btn" data-act="howto">❓ How to play</button>
            <button class="cd-btn" data-act="setup">⚙️ Dojo setup</button>
            <button class="cd-btn" data-act="records">🏆 Records</button>
            ${this.showShell ? '' : `<button class="cd-btn ghost" data-act="exit">${esc(this.returnLabel)}</button>`}
          </div>
          <div class="cd-keys">
            <span><kbd class="cd-kbd">←</kbd><kbd class="cd-kbd">↑</kbd><kbd class="cd-kbd">→</kbd> chop a lane</span>
            <span><kbd class="cd-kbd">A</kbd><kbd class="cd-kbd">W</kbd><kbd class="cd-kbd">D</kbd> too</span>
            <span>📷 camera chop</span>
            <span>🖱️ click a board</span>
          </div>
          <p class="cd-tip">💡 ${esc(tip)}</p>
          <p class="cd-status ${cam[0]}" style="margin:0;font-size:12.5px">${esc(cam[1])}</p>
        </div>
      </div>`);
  };

  Instance.prototype.screenHowTo = function () {
    const tiers = C.TIERS.map((t) => {
      const names = SMASHABLE.filter((b) => b.tier === t.key).map((b) => b.label).join(', ');
      return `<li><span class="cd-sw" style="background:${t.color}"></span><b>${esc(t.label)}</b> — ${esc(names)}</li>`;
    }).join('');
    const belts = C.BELTS.map((b) => `<li><span class="cd-sw" style="background:${b.color}"></span>`
      + `<b>${esc(b.name)}</b> — ${esc(b.title)} · ${money(b.at)}</li>`).join('');
    this.screen('', `
      <h2 class="cd-title" style="font-size:38px">How to play</h2>
      <div class="cd-grid2">
        <div class="cd-panel">
          <h4>What comes at you</h4>
          <ul class="cd-kv">${tiers}
            <li><span class="cd-sw" style="background:#ffd76b"></span><b>Savings Check</b> — break it and the round pauses for a question.</li>
          </ul>
        </div>
        <div class="cd-panel">
          <h4>Ranking out</h4>
          <ul class="cd-kv">${belts}</ul>
          <p class="cd-fine">Pass ${C.SCORING.certifyAt} Savings Checks in one run to certify.</p>
        </div>
        <div class="cd-panel">
          <h4>Savings — the score</h4>
          <p>Break a board and its savings land immediately. Streak steps up every
             ${C.SCORING.streakStep} boards to a ceiling of ×${C.SCORING.maxMultiplier}, and it dies the
             moment one drifts away unclaimed — waste you ignore costs you the run.</p>
          <p>Checks stay off the mat for the first ${Math.round((C.TRIVIA_RULES.earliestCheckMs || 0) / 1000)} seconds so the
             opening is yours to build a streak. Pass one for a ${money(C.TRIVIA_RULES.correctBonus)} knowledge bonus, a
             Commitment Discount of ${C.SCORING.boostSeconds} seconds at ${C.SCORING.boostMultiplier}× savings${C.TRIVIA_RULES.correctBonusSeconds > 0
    ? `, and +${C.TRIVIA_RULES.correctBonusSeconds} seconds back on the clock` : ''}.
             Miss one and every board drifts away faster for the rest of the round.</p>
        </div>
        <div class="cd-panel">
          <h4>Controls</h4>
          <ul class="cd-kv">
            <li><b>CAM</b> — chop left, centre or right. Your whole arm, not your wrist.</li>
            <li><b>← ↑ →</b> — the same three lanes, no camera needed. AWD works too.</li>
            <li><b>Click</b> — or just click a board.</li>
            <li><b>Savings Check</b> — punch the corner coin you want. A B C D (or 1–4) and a click work too.</li>
            <li><b>P</b> or <b>Esc</b> — pause. <b>M</b> — mute.</li>
          </ul>
        </div>
      </div>
      <div class="cd-row">
        <button class="cd-btn primary" data-act="start">▶  Step On The Mat</button>
        <button class="cd-btn" data-act="title">Back</button>
      </div>`);
  };

  Instance.prototype.screenSetup = function () {
    const s = this.meta.setup;
    const cam = this.camLine();
    const el = this.screen('', `
      <h2 class="cd-title" style="font-size:38px">Dojo setup</h2>
      <p class="cd-sub">Tune the mat to the room. Booth staff can set this once and leave it —
        it is remembered in this browser.</p>
      <div class="cd-grid2">
        <div class="cd-panel">
          <h4>Camera</h4>
          <p class="cd-status ${cam[0]}">${esc(cam[1])}</p>
          <div class="cd-meters">
            <div class="cd-meter"><i></i><em>Left</em></div>
            <div class="cd-meter"><i></i><em>Centre</em></div>
            <div class="cd-meter"><i></i><em>Right</em></div>
          </div>
          <p class="cd-note">A chop should spike one bar past the dashed line; standing still
            should leave all three below it.</p>
          <div class="cd-row" style="justify-content:flex-start;margin-top:11px">
            <button class="cd-btn ghost" data-act="cam">Start camera</button>
          </div>
        </div>
        <div class="cd-panel">
          <h4>Difficulty</h4>
          <label class="cd-field"><span>Round length — <b data-v="seconds">${s.seconds}</b> seconds</span>
            <input type="range" data-set="seconds" min="15" max="60" step="5" value="${s.seconds}"></label>
          <label class="cd-field"><span>Camera sensitivity — <b data-v="sensitivity">${s.sensitivity}</b></span>
            <input type="range" data-set="sensitivity" min="1" max="10" step="1" value="${s.sensitivity}">
            <span class="cd-note">Higher fires on a smaller movement. Turn it down for a dim or crowded room.</span></label>
          <label class="cd-field"><span>Board speed — <b data-v="boardSpeed">${s.boardSpeed}</b></span>
            <input type="range" data-set="boardSpeed" min="1" max="10" step="1" value="${s.boardSpeed}">
            <span class="cd-note">How fast boards arrive and how quickly they drift away again.</span></label>
        </div>
      </div>
      <div class="cd-row">
        <button class="cd-btn primary" data-act="start">▶  Step On The Mat</button>
        <button class="cd-btn" data-act="title">Back</button>
      </div>`);

    el.querySelectorAll('[data-set]').forEach((input) => {
      input.addEventListener('input', () => {
        const k = input.dataset.set;
        this.meta.setup[k] = Number(input.value);
        const out = el.querySelector(`[data-v="${k}"]`);
        if (out) out.textContent = input.value;
        saveMeta(this.meta, this.persist);
      });
    });
    this._meters = el.querySelectorAll('.cd-meter');
  };

  Instance.prototype.screenRecords = function () {
    const rows = this.meta.records;
    const body = rows.length
      ? rows.map((r, i) => {
        const when = new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<tr><td>${i + 1}</td><td>${esc(when)}${r.certified ? ' ✦' : ''}</td>`
          + `<td>${money(r.savings)}</td><td>${esc(r.belt)}</td><td>${r.reclaimed}</td>`
          + `<td>${r.checks}</td><td>${r.tokens.toLocaleString('en-US')}</td></tr>`;
      }).join('')
      : '<tr><td class="empty" colspan="7">No runs yet. The mat is open.</td></tr>';
    this.screen('', `
      <h2 class="cd-title" style="font-size:38px">Records</h2>
      <p class="cd-sub">Best runs on this cabinet. Stored in this browser, and on the arcade
        profile when one is available. The camera is never recorded.</p>
      <table class="cd-table">
        <thead><tr><th>#</th><th>Run</th><th>Savings</th><th>Rank</th><th>Reclaimed</th>
          <th>Checks</th><th>Tokens</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="cd-row">
        <button class="cd-btn" data-act="title">Back to the cabinet</button>
        <button class="cd-btn ghost" data-act="clear-records">Clear</button>
      </div>`);
  };

  // ===========================================================================
  // Round
  // ===========================================================================
  Instance.prototype.startRound = async function (seedOverride) {
    this.audio.resume();
    // Music starts immediately and rides through the whole round. The dojo fades
    // IN from black, holds a beat for the gong, then dissolves into the webcam
    // over the countdown. Lift any results-screen duck back to full for the run.
    if (this.music) this.music.setVolume(MUSIC_VOL);
    this.setMusic('stage');
    this.motion.resetCalibration();      // relearn the room's noise floor this round
    this._introFadeAt = performance.now();   // dojo fades in from black
    this._revealAt = 0;                      // webcam stays hidden until the gong beat
    this._fadeAt = 0;                        // clear any previous fade-to-black
    this._returnAt = 0;                      // clear any previous webcam->dojo return
    this.clearTimers();
    this.clearUI();

    // Advance the seed every round. Reusing one seed replays the identical board
    // spawns AND the identical trivia draw order — which is what made the Savings
    // Checks feel like a tiny fixed set across "play again". An explicit
    // seedOverride still pins a run for reproducible / testing use.
    this.rngSeed = seedOverride != null
      ? seedOverride
      : (Math.imul(this.rngSeed, 1664525) + 1013904223) >>> 0;
    const seed = this.rngSeed;
    const s = this.meta.setup;
    const rnd = mulberry32(seed);
    this.run = {
      seed,
      rnd,
      seconds: s.seconds,
      elapsed: 0,
      spawnTimer: 0,
      graceUntil: 0,
      boards: [],
      chips: [],
      pops: [],
      laneFlash: new Array(C.ROUND.lanes).fill(0),
      laneReadyAt: new Array(C.ROUND.lanes).fill(0),
      counts: {},
      drifts: {},
      base: 0, bonus: 0, knowledge: 0,
      reclaimed: 0, missed: 0, tokens: 0,
      streak: 0, bestStreak: 0,
      quizCorrect: 0, quizWrong: 0, quizStreak: 0,
      certified: false,
      boostLeft: 0,
      ttlPenalty: 1,
      seen: new Set(),
      unlocked: [],
      over: false,
      outcome: null,
    };
    SMASHABLE.forEach((b) => { this.run.counts[b.key] = 0; this.run.drifts[b.key] = 0; });
    this.sensei.line = ''; this.sensei.lineLeft = 0;

    this.state = 'countdown';
    this.emit('run:start', { seed, seconds: s.seconds });

    // Ask for the camera now so the permission prompt lands before the count,
    // not in the middle of a swing. A prompt nobody answers must not hold the
    // round hostage, so the wait is capped — if permission lands later the
    // lanes simply start working mid-round.
    const count = document.createElement('div');
    count.className = 'cd-count';
    count.innerHTML = '<b>···</b>';
    count.style.visibility = 'hidden';   // stays hidden through the dojo fade-in + gong
    this.ui.appendChild(count);

    if (this.motion.state !== 'ready' && this.motion.state !== 'blocked') {
      await Promise.race([
        this.motion.start(),
        new Promise((r) => { this.later(r, C.ROUND.camWaitMs); }),
      ]);
    }
    if (this.destroyed || this.state !== 'countdown') return;

    const b = count.querySelector('b');
    let n = 3;
    const step = () => {
      if (this.destroyed || this.state !== 'countdown') return;
      if (n > 0) {
        b.textContent = String(n);
        b.classList.remove('go');
        b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
        this.audio.tick(440);
        n -= 1;
        this.later(step, 760);
      } else {
        b.textContent = 'GO';
        b.classList.add('go');
        this.audio.go();
        this.later(() => {
          count.remove();
          this.state = 'play';
          this.run.graceUntil = performance.now() + C.ROUND.graceMs;
        }, 480);
      }
    };

    // Intro bookend: the dojo has faded in from black — hold a beat, strike the
    // gong, then simultaneously start the countdown and dissolve the dojo into
    // the webcam. Music is already playing from the top of startRound.
    this.later(() => {
      if (this.destroyed || this.state !== 'countdown') return;
      this.audio.gong();
      this.later(() => {
        if (this.destroyed || this.state !== 'countdown') return;
        this._revealAt = performance.now();   // dojo dissolves -> webcam materialises
        this.audio.materialize();
        count.style.visibility = '';          // the 3-2-1 appears now
        step();
      }, GONG_LEAD_MS);
    }, INTRO_FADE_MS + INTRO_HOLD_MS);
  };

  Instance.prototype.leaveRound = function () {
    if (this.run && !this.run.over && this.state !== 'idle') this.endRound('quit');
    this.clearTimers();
    // endRound() only releases the camera at the END of the outro timer chain,
    // and the clearTimers() above just cancelled that chain — so on a mid-round
    // quit we must stop motion synchronously or the webcam stream (and its
    // indicator light) leaks until destroy(). stop() is a no-op if idle.
    this.motion.stop();
    this.state = 'idle';
    this.run = null;
    this.screenTitle();
  };

  Instance.prototype.setPause = function (on) {
    if (on && this.state === 'play') {
      this.state = 'paused';
      const el = document.createElement('div');
      el.className = 'cd-veil';
      el.innerHTML = `<div class="cd-sum cd-pause" style="width:400px">
        <h3>Paused</h3><p>The meter is still running in real life.</p>
        <div class="cd-row">
          <button class="cd-btn primary" data-act="resume">Resume</button>
          <button class="cd-btn ghost" data-act="title">Leave the mat</button>
        </div></div>`;
      el.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => this.act(btn.dataset.act));
      });
      this.ui.appendChild(el);
    } else if (!on && this.state === 'paused') {
      this.clearUI();
      this.state = 'play';
      this.run.graceUntil = performance.now() + C.ROUND.graceMs;
    }
  };

  // ---- boards ---------------------------------------------------------------
  Instance.prototype.pickBoard = function () {
    const r = this.run;
    // Hold the Savings Check out of the pool for the opening seconds — a check
    // that stops the clock before the player has a streak worth defending just
    // kills momentum (see TRIVIA_RULES.earliestCheckMs).
    const gate = C.TRIVIA_RULES.earliestCheckMs || 0;
    const checkReady = r.elapsed >= gate;
    let total = 0;
    C.BOARDS.forEach((b) => { if (!b.check || checkReady) total += b.weight; });
    let x = r.rnd() * total;
    for (const b of C.BOARDS) {
      if (b.check && !checkReady) continue;
      if (x < b.weight) return b;
      x -= b.weight;
    }
    return C.BOARDS[0];
  };

  // Boards are words, so they must never overlap. Every lane has four rows;
  // this hunts for a free one and gives up rather than stacking two words.
  Instance.prototype.findSlot = function () {
    const r = this.run;
    const laneW = VW / C.ROUND.lanes;
    const slots = [];
    for (let l = 0; l < C.ROUND.lanes; l += 1) {
      for (let band = 0; band < C.ROUND.bands.length; band += 1) slots.push([l, band]);
    }
    for (let i = slots.length - 1; i > 0; i -= 1) {
      const j = (r.rnd() * (i + 1)) | 0;
      const t = slots[i]; slots[i] = slots[j]; slots[j] = t;
    }
    for (const [lane, band] of slots) {
      const y = VH * C.ROUND.bands[band];
      let clear = true;
      for (const b of r.boards) {
        if (b.dead || b.lane !== lane) continue;
        if (Math.abs(b.y - y) < 96) { clear = false; break; }
      }
      if (clear) {
        return {
          lane,
          x: laneW * lane + laneW * (0.5 + (r.rnd() - 0.5) * 0.16),
          y: y + (r.rnd() - 0.5) * 12,
        };
      }
    }
    return null;
  };

  Instance.prototype.spawnBoard = function () {
    const r = this.run;
    const slot = this.findSlot();
    if (!slot) return;
    const type = this.pickBoard();
    const baseTtl = C.ROUND.baseTtlMs / C.ROUND.speedFactor(this.meta.setup.boardSpeed);
    r.boards.push({
      lane: slot.lane, x: slot.x, y: slot.y, r: 62, type,
      born: performance.now(),
      ttl: baseTtl * type.ttl * r.ttlPenalty,
      dead: false,
    });
  };

  Instance.prototype.shatter = function (board) {
    const r = this.run;
    const big = board.type.art || board.type.check;
    const n = big ? 22 : 13;
    for (let i = 0; i < n; i += 1) {
      const a = r.rnd() * Math.PI * 2;
      const sp = 3 + r.rnd() * 7;
      r.chips.push({
        x: board.x, y: board.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
        rot: r.rnd() * 6, vr: (r.rnd() - 0.5) * 0.4, life: 1,
        col: (i % 4 === 0) ? '#ffffff' : board.type.color,
        sz: 5 + r.rnd() * 8,
      });
    }
  };

  Instance.prototype.say = function (key) {
    const lines = C.CALLOUTS[key];
    if (!lines) return;
    this.sensei.line = lines[(Math.random() * lines.length) | 0];
    this.sensei.lineLeft = 1700;
  };

  Instance.prototype.multiplier = function () {
    return Math.min(C.SCORING.maxMultiplier, 1 + Math.floor(this.run.streak / C.SCORING.streakStep));
  };

  Instance.prototype.total = function () {
    const r = this.run;
    return r.base + r.bonus + r.knowledge;
  };

  Instance.prototype.breakBoard = function (board) {
    const r = this.run;
    if (board.dead || this.state !== 'play') return;
    board.dead = true;
    r.laneFlash[board.lane] = 1;
    this.shatter(board);
    this.sensei.pulse = 1;

    if (board.type.check) {
      r.pops.push({ x: board.x, y: board.y, txt: 'SAVINGS CHECK', life: 1, gold: true });
      this.audio.brk(true);
      this.say('check');
      this.openCheck();
      return;
    }

    const mult = this.multiplier();
    const boosted = r.boostLeft > 0 ? C.SCORING.boostMultiplier : 1;
    const face = board.type.savings;
    const paid = face * mult * boosted;

    r.base += face;
    r.bonus += paid - face;
    r.counts[board.type.key] += 1;
    r.reclaimed += 1;
    r.streak += 1;
    r.bestStreak = Math.max(r.bestStreak, r.streak);
    if (r.bestStreak >= 40) this.unlock('streak_40');
    if (board.type.key === 'prime') this.unlock('boss_break');

    const tag = (mult > 1 || boosted > 1) ? ' ×' + (mult * boosted) : '';
    r.pops.push({ x: board.x, y: board.y, txt: '+' + money(paid) + tag, life: 1, gold: !!board.type.art });
    this.audio.brk(!!board.type.art);
    if (r.rnd() < 0.5 || board.type.art) this.say(board.type.key);
    this.emit('run:break', { key: board.type.key, paid, streak: r.streak });
  };

  // One rate limit shared by the camera, the keys and the mouse, so hammering a
  // key is never better than a clean chop. The camera has its own longer
  // cooldown on top of this in cd-motion.js.
  Instance.prototype.laneReady = function (lane) {
    const r = this.run;
    const now = performance.now();
    if (this.state !== 'play' || now < r.graceUntil || now < r.laneReadyAt[lane]) return false;
    r.laneReadyAt[lane] = now + C.ROUND.laneCooldownMs;
    return true;
  };

  Instance.prototype.chopLane = function (lane) {
    if (!this.laneReady(lane)) return;
    const r = this.run;
    r.laneFlash[lane] = 1;
    // Take the one closest to drifting, so the board that is pulsing red is the
    // board a chop saves. With four rows per lane, "newest" would feel arbitrary.
    const now = performance.now();
    let target = null, worst = -1;
    for (const b of r.boards) {
      if (b.dead || b.lane !== lane) continue;
      const wear = (now - b.born) / b.ttl;
      if (wear > worst) { worst = wear; target = b; }
    }
    if (target) this.breakBoard(target);
  };

  // ===========================================================================
  // Savings Check
  // ===========================================================================
  Instance.prototype.pickQuestion = function () {
    const r = this.run;
    const bank = C.TRIVIA;               // shared bank + this dojo's own KB questions
    if (!bank.length) return null;
    // Borrow the shared key() so a question's "already asked" identity reads the
    // same here as in any other cabinet. We deliberately draw locally rather than
    // via ArcadeTrivia.pick(): pick() only sees the shared BANK, so it would never
    // serve the dojo's KB questions that C.TRIVIA appends. This seeded draw also
    // keeps a run reproducible from its rngSeed.
    const keyOf = (global.ArcadeTrivia && global.ArcadeTrivia.key) || ((q) => q.q);
    const unseen = bank.filter((q) => !r.seen.has(keyOf(q)));
    const pool = unseen.length ? unseen : (C.TRIVIA_RULES.allowRepeats ? bank : unseen);
    if (!pool.length) return null;
    return pool[(r.rnd() * pool.length) | 0];
  };

  Instance.prototype.openCheck = function () {
    const r = this.run;
    const R = C.TRIVIA_RULES;
    const q = this.pickQuestion();
    if (!q) { this.state = 'play'; return; }
    const keyOf = (global.ArcadeTrivia && global.ArcadeTrivia.key) || ((x) => x.q);
    r.seen.add(keyOf(q));
    this.state = 'check';
    // Don't let the chop that broke the gold board carry through as an answer:
    // hold every input off until the player has had a moment to drop their arms.
    this._checkArmedAt = performance.now() + (R.armMs || 1300);
    this.setMusic('boss');   // drop into the Japanese "think" cue while stopped

    // Three lanes, so we show the correct answer plus up to two distractors —
    // one per lane (left/centre/right), the same three lanes the player already
    // chops. order[pos] is the ORIGINAL choice index shown at display position
    // pos; keeping `a` as the bank's index means the screen and the bank can't
    // drift apart. (The camera can tell left/centre/right apart reliably but not
    // top/bottom, so four corners would ask it to read a dimension it can't.)
    const others = q.c.map((_, i) => i).filter((i) => i !== q.a);
    for (let i = others.length - 1; i > 0; i -= 1) {
      const j = (r.rnd() * (i + 1)) | 0;
      const t = others[i]; others[i] = others[j]; others[j] = t;
    }
    // Every question in the shared bank has four choices, so this always yields
    // three coins; warn loudly if a future question has too few, since a short
    // `order` would leave a lane with no coin to chop.
    if (q.c.length < 3) console.warn('[CostBotDojo] trivia question has <3 choices — a lane will render empty:', q.q);
    const order = [q.a, ...others.slice(0, 2)];   // correct + two distractors
    for (let i = order.length - 1; i > 0; i -= 1) {   // ...shuffled across the lanes
      const j = (r.rnd() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const correctPos = order.indexOf(q.a);

    const mult = Math.min(R.streakCap || 1, 1 + (R.streakStep || 0) * (r.quizStreak || 0));
    const prize = Math.round(R.correctBonus * mult);

    // Answers sit in the three lanes: A left, B centre, C right. Chop the lane of
    // your answer, exactly like breaking a board.
    const LANE = ['l', 'c', 'r'];

    const el = document.createElement('div');
    el.className = 'cd-veil';
    el.innerHTML = `
      <div class="cd-quiz-center">
        <div class="cd-quiz-head">
          <span class="cd-quiz-tag">🎓 AWS SAVINGS CHECK</span>
          <span class="cd-quiz-prize">${money(prize)} + ${C.SCORING.boostSeconds}s discount${R.correctBonusSeconds > 0 ? ` + ${R.correctBonusSeconds}s clock` : ''}</span>
        </div>
        <div class="cd-quiz-timer"><i style="width:100%"></i></div>
        <h3 class="cd-quiz-q">${esc(q.q)}</h3>
        <div class="cd-quiz-foot">${R.mode === 'gate'
    ? 'Chop the lane of the right answer to claim the Commitment Discount.'
    : 'Chop the lane of the right answer for a knowledge bonus.'}</div>
      </div>
      ${order.map((orig, pos) => `
        <button class="cd-coin cd-coin-${LANE[pos]} asleep" data-p="${pos}">
          <span class="cd-pow"><span class="cd-coin-face"><b>${LETTERS[pos]}</b></span></span>
          <span class="cd-coin-label">${esc(q.c[orig])}</span>
        </button>`).join('')}`;
    this.ui.appendChild(el);

    // Live punch feedback: the loop lights each coin by how much camera motion
    // is landing in its corner, and a small readout shows the raw numbers so we
    // can see whether the camera is live and what a punch actually registers.
    this._coins = Array.from(el.querySelectorAll('.cd-coin'));
    this._checkDbg = document.createElement('div');
    this._checkDbg.className = 'cd-quiz-dbg';
    el.querySelector('.cd-quiz-center').appendChild(this._checkDbg);

    const bar = el.querySelector('.cd-quiz-timer i');
    const barBox = el.querySelector('.cd-quiz-timer');
    let resolved = false;

    if (R.timeLimit > 0) {
      const started = performance.now();
      this._quizTimer = setInterval(() => {
        const remaining = R.timeLimit - (performance.now() - started) / 1000;
        const frac = clamp(remaining / R.timeLimit, 0, 1);
        bar.style.width = (frac * 100) + '%';
        barBox.classList.toggle('low', frac < 0.34);
        if (remaining <= 0) resolve(-1);
      }, 100);
    } else {
      barBox.hidden = true;
    }

    const self = this;
    const stopTimer = () => {
      if (self._quizTimer) { clearInterval(self._quizTimer); self._quizTimer = null; }
    };

    function resolve(chosenPos) {
      if (resolved || self.destroyed) return;
      resolved = true;
      stopTimer();
      const correct = chosenPos === correctPos;
      const timedOut = chosenPos === -1;
      if (!timedOut) self.audio.punch();   // the coin takes the hit (skip on a timeout)

      el.querySelectorAll('.cd-coin').forEach((b) => {
        b.disabled = true;
        b.classList.remove('charging');
        const pos = +b.dataset.p;
        if (pos === correctPos) b.classList.add('right');
        else if (pos === chosenPos) b.classList.add('wrong');
        else b.classList.add('struck');
      });
      if (self._checkDbg) self._checkDbg.remove();
      bar.style.width = '0%';

      let headline;
      if (correct) {
        r.quizStreak = (r.quizStreak || 0) + 1;
        const m2 = Math.min(R.streakCap || 1, 1 + (R.streakStep || 0) * (r.quizStreak - 1));
        const payout = Math.round(R.correctBonus * m2);
        const streakTag = m2 > 1 ? ` · ${r.quizStreak} in a row ×${m2}` : '';
        r.knowledge += payout;
        r.quizCorrect += 1;
        r.boostLeft = C.SCORING.boostSeconds * 1000;
        // Buy time back on the round clock — the only way to make a round run
        // long. r.seconds is the round length the timer counts up to.
        const addSec = R.correctBonusSeconds || 0;
        if (addSec > 0) r.seconds += addSec;
        self.meta.quizCorrect = (self.meta.quizCorrect || 0) + 1;
        headline = `Correct — knowledge bonus ${money(payout)}, Commitment Discount for `
          + `${C.SCORING.boostSeconds}s${addSec > 0 ? `, +${addSec}s on the clock` : ''}${streakTag}`;
        // Elevated "you won the bonus" fanfare on a correct punch (not just good()).
        setTimeout(() => self.audio.win(), 90);
        self.say('boost');
        r.pops.push({ x: VW / 2, y: VH * 0.42, txt: '+' + money(payout), life: 1, gold: true });
        if (addSec > 0) r.pops.push({ x: VW / 2, y: VH * 0.42 - 42, txt: `+${addSec}s`, life: 1, gold: true });
        if (r.quizCorrect >= C.SCORING.certifyAt && !r.certified) {
          r.certified = true;
          self.unlock('certified');
          self.say('certified');
        }
      } else {
        r.quizStreak = 0;
        r.quizWrong += 1;
        r.knowledge += R.wrongConsolation;
        // The dojo's version of taking damage: every board on the mat from here
        // holds its lane for less time.
        r.ttlPenalty = Math.max(R.ttlPenaltyFloor, r.ttlPenalty * R.ttlPenalty);
        headline = timedOut
          ? 'Out of time — the waste drifts faster now'
          : 'Not this time — the waste drifts faster now';
        self.audio.bad();
      }

      saveMeta(self.meta, self.persist);
      self.emit('run:trivia', { topic: q.topic, correct, source: q.source || null });

      const fromKb = String(q.source || '').indexOf('/') !== -1;
      const why = document.createElement('div');
      why.className = 'cd-why ' + (correct ? 'ok' : 'no');
      why.innerHTML = `<b>${esc(headline)}</b>${esc(q.why)}`
        + (q.source ? `<div class="cd-src"><span class="${fromKb ? '' : 'aws'}">`
          + `${fromKb ? 'CostBot KB' : 'AWS'}</span>${esc(q.source)}</div>` : '')
        + '<div class="cd-continue">press any key to continue ▸</div>';
      const center = el.querySelector('.cd-quiz-center');
      center.appendChild(why);

      if (r.certified) {
        const cert = document.createElement('div');
        cert.className = 'cd-cert';
        cert.innerHTML = '<em>📗</em><div><b>Certified</b>'
          + `<i>${C.SCORING.certifyAt} Savings Checks passed in one run.</i></div>`;
        center.appendChild(cert);
      }

      // Auto-advance, but let an impatient player skip straight through.
      let advanced = false;
      const advance = () => {
        if (advanced) return;
        advanced = true;
        window.removeEventListener('keydown', onSkip);
        window.removeEventListener('pointerdown', onSkip);
        self._quizSkip = null;
        self.closeCheck();
      };
      const onSkip = () => advance();
      self._quizAdvance = advance;
      // Hold the feedback for a beat before it can be skipped, so the answering
      // punch/click can't cut it short — you always get time to read the why.
      self.later(() => {
        if (advanced || self.destroyed) return;
        window.addEventListener('keydown', onSkip);
        window.addEventListener('pointerdown', onSkip);
        // Expose the handler so destroy() can detach it if the game is torn
        // down while the reveal is still on screen (advance() may never run).
        self._quizSkip = onSkip;
      }, R.revealMinMs || 1500);
      // A wrong (or timed-out) answer holds the feedback longer so there's time
      // to read the correct answer + why before the re-entry countdown. A skip
      // is still allowed after revealMinMs for anyone who's ready sooner.
      self.later(advance, R.revealMs + (correct ? 0 : (R.wrongExtraMs || 0)));
    }

    el.querySelectorAll('.cd-coin').forEach((b) => {
      b.addEventListener('click', () => {
        if (performance.now() < (self._checkArmedAt || 0)) return;   // coins still asleep
        resolve(+b.dataset.p);
      });
    });
    this._quizResolve = resolve;
    this._quizAdvance = null;
  };

  Instance.prototype.closeCheck = function () {
    if (this.state !== 'check') return;
    this._quizResolve = null;
    this._quizAdvance = null;
    this._quizSkip = null;
    this._coins = null;
    this._checkDbg = null;
    this.clearUI();
    // Don't drop the player straight back onto a live mat — a board could be
    // one frame from spawning. A short "re-entering the dojo" count gives the
    // eyes a beat to find the lanes again before the clock restarts.
    this.resumeCountdown();
  };

  // A brief 2..1..GO before play resumes after a Savings Check. The round stays
  // frozen in the 'countdown' state throughout: the clock does not tick, boards
  // hold their lanes and never drift, and no swing registers — exactly as the
  // check overlay froze it — so the count is pure breathing room, not lost time.
  Instance.prototype.resumeCountdown = function () {
    if (this.destroyed || !this.run) return;
    this.state = 'countdown';
    this.setMusic('stage');   // the kung-fu tune returns as you re-enter the mat

    const count = document.createElement('div');
    count.className = 'cd-count cd-reentry';
    count.innerHTML = '<span class="cd-reentry-label">Re-entering the dojo</span><b>2</b>';
    this.ui.appendChild(count);

    const b = count.querySelector('b');
    let n = 2;
    const step = () => {
      if (this.destroyed || this.state !== 'countdown') { count.remove(); return; }
      if (n > 0) {
        b.textContent = String(n);
        b.classList.remove('go');
        b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
        this.audio.tick(440);
        n -= 1;
        this.later(step, 760);
      } else {
        b.textContent = 'GO';
        b.classList.add('go');
        this.audio.go();
        this.later(() => {
          if (this.destroyed || !this.run || this.state !== 'countdown') return;
          count.remove();
          this.state = 'play';
          this.run.graceUntil = performance.now() + C.ROUND.graceMs;
        }, 480);
      }
    };
    step();
  };

  // ===========================================================================
  // The bell, and the count-out
  // ===========================================================================
  Instance.prototype.beltFor = (savings) => {
    let idx = 0;
    C.BELTS.forEach((b, i) => { if (savings >= b.at) idx = i; });
    return idx;
  };

  Instance.prototype.unlock = function (id) {
    if (!this.run || this.meta.achievements[id]) return;
    this.meta.achievements[id] = Date.now();
    this.run.unlocked.push(id);
    const a = C.ACHIEVEMENTS.find((x) => x.id === id);
    this.audio.ach();
    this.emit('run:achievement', { id, name: a ? a.name : id });
  };

  Instance.prototype.endRound = function (outcome) {
    const r = this.run;
    if (!r || r.over) return;
    r.over = true;
    r.outcome = outcome;
    this.state = 'over';
    this.clearTimers();
    // Outro bookend: the music keeps playing while the webcam dissolves back into
    // the dojo. The fade-to-black (and music fade) come later, after the gong.
    this._returnAt = performance.now();   // webcam dissolves out / dojo materialises back
    this._revealAt = 0;                   // leave the intro reveal path

    const total = this.total();
    const clean = r.missed === 0 && r.reclaimed > 0;
    const cleanBonus = clean ? C.SCORING.cleanMatBonus : 1;
    const tokens = Math.max(0, Math.round((total / C.SCORING.dollarsPerToken) * cleanBonus));
    r.tokens = tokens;

    const beltIdx = this.beltFor(total);
    const belt = C.BELTS[beltIdx];

    if (outcome === 'clear') {
      if (clean) this.unlock('clean_mat');
      ['yellow_belt', 'blue_belt', 'red_belt', 'black_belt'].forEach((id, i) => {
        if (beltIdx >= i + 1) this.unlock(id);
      });
    }

    // The shared purse. Every cabinet feeds one wallet, so this is the only
    // token counter the dojo has — there is no local one to keep in step.
    wallet().earn(tokens, 'costbot-dojo');

    const m = this.meta;
    m.runs += 1;
    m.lifetimeDollars += total;
    m.lifetimeTokens += tokens;
    m.checks += r.quizCorrect;
    if (total > (m.best || 0)) m.best = Math.round(total);
    if (r.bestStreak > (m.bestStreak || 0)) m.bestStreak = r.bestStreak;
    if (beltIdx > (m.belt || 0)) m.belt = beltIdx;
    m.records.push({
      savings: Math.round(total), reclaimed: r.reclaimed, checks: r.quizCorrect,
      tokens, streak: r.bestStreak, belt: belt.name, certified: r.certified, at: Date.now(),
    });
    m.records.sort((a, b) => b.savings - a.savings);
    m.records = m.records.slice(0, 10);
    saveMeta(m, this.persist);

    const result = {
      game: 'costbot-dojo',
      outcome,
      stageId: 'the-mat',
      seed: r.seed,
      dollarsSaved: Math.round(total),
      tokensEarned: tokens,
      level: beltIdx + 1,
      kills: r.reclaimed,
      quizCorrect: r.quizCorrect,
      quizWrong: r.quizWrong,
      timeSurvived: Math.round(r.elapsed / 1000),
      streak: r.bestStreak,
      belt: belt.name,
      certified: r.certified,
      achievementsUnlocked: r.unlocked.slice(),
      meta: m,
    };
    this.lastResult = result;
    this.emit('run:end', result);
    this.onComplete(result);

    // Outro sequence: dojo returns -> hold a beat -> gong -> fade the dojo AND the
    // music to black together -> results once the screen is fully black.
    this.later(() => {
      if (this.destroyed) return;
      this.audio.gong();
      this.later(() => {
        if (this.destroyed) return;
        this._fadeAt = performance.now();   // dojo fades to black
        this.audio.powerdown();
        this.fadeMusicOut(FADE_MS);         // music fades with the dojo
        this.later(() => {
          this.motion.stop();
          if (outcome === 'clear') this.screenCountOut(result, belt, clean);
        }, FADE_MS);
      }, GONG_LEAD_MS);
    }, OUTRO_RETURN_MS + OUTRO_HOLD_MS);
  };

  // Ramp the soundtrack down over `ms` so it fades with the dojo at round end.
  // Uses tracked timers so it clears cleanly on destroy.
  Instance.prototype.fadeMusicOut = function (ms) {
    if (!this.music) return;
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      this.later(() => { if (this.music) this.music.setVolume(MUSIC_VOL * (1 - i / steps)); }, (ms / steps) * i);
    }
  };

  Instance.prototype.screenCountOut = function (result, belt, clean) {
    const r = this.run;
    // The gong already rang in the outro; here the theme comes back up from the
    // fade to a soft duck so the tally isn't silent. Full level on the next run.
    if (this.music) this.music.setVolume(MUSIC_DUCK);
    this.clearUI();

    const el = document.createElement('div');
    el.className = 'cd-veil cd-veil-results';
    el.innerHTML = `<div class="cd-sum">
      <h3>${r.certified ? 'Time — certified' : 'Time'}</h3>
      <p class="cd-sub">${r.reclaimed} of ${r.reclaimed + r.missed} reclaimed · ${r.missed} drifted away · `
      + `${r.quizCorrect} of ${C.SCORING.certifyAt} checks</p>
      <div class="cd-rows"></div></div>`;
    this.ui.appendChild(el);
    const rowsEl = el.querySelector('.cd-rows');
    const card = el.querySelector('.cd-sum');

    // One row per tier that actually came up, naming what you broke, so the
    // count-out still adds up to the figure without twenty-one rows of zeroes.
    const rows = [];
    const tones = [420, 540, 660, 780, 900];
    const appeared = (b) => (r.counts[b.key] || 0) + (r.drifts[b.key] || 0);
    C.TIERS.forEach((tier, i) => {
      const hit = SMASHABLE.filter((b) => b.tier === tier.key && appeared(b) > 0);
      if (!hit.length) return;
      const n = hit.reduce((s, b) => s + r.counts[b.key], 0);
      const total = hit.reduce((s, b) => s + appeared(b), 0);
      const sub = hit.reduce((s, b) => s + r.counts[b.key] * b.savings, 0);
      const named = hit
        .sort((a, b) => appeared(b) * b.savings - appeared(a) * a.savings)
        .map((b) => b.label + (appeared(b) > 1 ? ' ×' + appeared(b) : ''));
      const shown = named.slice(0, 2).join(', ') + (named.length > 2 ? ' +' + (named.length - 2) + ' more' : '');
      rows.push({
        sw: tier.color,
        label: `${esc(tier.label)}<span class="cd-srow-det">${esc(shown)}</span>`,
        math: `${n} of ${total} reclaimed = <b>${money(sub)}</b>`,
        tone: tones[i],
      });
    });
    if (!rows.length) {
      rows.push({ sw: '#5b6b8c', label: 'Nothing reclaimed', math: `<b>${money(0)}</b>`, tone: 300 });
    }
    rows.push({
      sw: '#ffd76b', cls: 'bonus', label: 'Savings Checks passed',
      math: `${r.quizCorrect} passed = <b>${money(r.knowledge)}</b>`,
      tone: r.quizCorrect > 0 ? 980 : 300,
    });
    rows.push({
      sw: '#6ee7a0', cls: 'bonus', label: 'Streak and discount bonus',
      math: `+ <b>${money(r.bonus)}</b>`,
      tone: r.bonus > 0 ? 1060 : 300,
    });

    const stepMs = 620;
    rows.forEach((row, i) => {
      this.later(() => {
        const d = document.createElement('div');
        d.className = 'cd-srow' + (row.cls ? ' ' + row.cls : '');
        d.innerHTML = `<span><span class="cd-sw" style="background:${row.sw}"></span>${row.label}</span>`
          + `<span>${row.math}</span>`;
        rowsEl.appendChild(d);
        requestAnimationFrame(() => d.classList.add('show'));
        this.audio.tick(row.tone);
      }, 400 + i * stepMs);
    });

    this.later(() => {
      const fig = document.createElement('div');
      fig.className = 'cd-fig';
      fig.innerHTML = '<span>Savings realized</span><b>' + money(0) + '</b>';
      card.appendChild(fig);
      this.countUp(fig.querySelector('b'), result.dollarsSaved, 900);

      const tok = document.createElement('p');
      tok.className = 'cd-tok';
      tok.innerHTML = clean
        ? `<b>${result.tokensEarned.toLocaleString('en-US')} tokens</b> into the arcade purse — `
          + `×${C.SCORING.cleanMatBonus} for a clean mat, nothing drifted away.`
        : `<b>${result.tokensEarned.toLocaleString('en-US')} tokens</b> into the arcade purse.`;
      card.appendChild(tok);
    }, 400 + rows.length * stepMs + 260);

    this.later(() => {
      this.audio.win();
      const b = document.createElement('div');
      b.className = 'cd-belt';
      b.innerHTML = `<i style="background:${belt.color}"></i><div class="cd-belt-b">`
        + `<b>${esc(belt.name)}</b><span>${esc(belt.title)}</span></div>`;
      card.appendChild(b);
    }, 400 + rows.length * stepMs + 1000);

    this.later(() => {
      const row = document.createElement('div');
      row.className = 'cd-row';
      row.style.marginTop = '16px';
      row.innerHTML = '<button class="cd-btn primary" data-act="start">Run it again</button>'
        + `<button class="cd-btn" data-act="title">${esc(this.showShell ? 'Back to the cabinet' : this.returnLabel)}</button>`;
      row.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.dataset.act === 'start') { this.run = null; this.state = 'idle'; }
          this.act(btn.dataset.act);
        });
      });
      card.appendChild(row);
    }, 400 + rows.length * stepMs + 2000);
  };

  Instance.prototype.countUp = function (el, target, ms) {
    const start = performance.now();
    const step = (now) => {
      if (this.destroyed) return;
      const p = Math.min(1, (now - start) / ms);
      el.textContent = money(target * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ===========================================================================
  // Update
  // ===========================================================================
  // Higher sensitivity = MORE sensitive = a LOWER motion threshold. (The slider
  // used to run backwards — a higher number needed a bigger swing.) Chops and the
  // setup meters must read the exact same number, so both come through here.
  Instance.prototype.chopThreshold = function () {
    return 0.074 - this.meta.setup.sensitivity * 0.006;   // s1→0.068 (big swing) … s10→0.014 (hair-trigger)
  };
  Instance.prototype.update = function (dt, now) {
    const r = this.run;

    // During the 3-2-1 the room is still, so learn its noise floor; otherwise
    // just sample. (Setup shows live meters while idle, hence the _meters check.)
    if (this.state === 'countdown') this.motion.calibrate();
    else if (this.state !== 'idle' || this._meters) this.motion.sample();
    if (this._meters && this.ui.querySelector('.cd-meter')) this.renderMeters();
    else this._meters = null;

    if (r && this.state === 'play') {
      r.elapsed += dt;
      if (r.boostLeft > 0) r.boostLeft = Math.max(0, r.boostLeft - dt);

      r.spawnTimer -= dt;
      const alive = r.boards.filter((b) => !b.dead).length;
      if (r.spawnTimer <= 0 && alive < C.ROUND.maxLive) {
        this.spawnBoard();
        r.spawnTimer = C.ROUND.spawnMs(this.meta.setup.boardSpeed);
      }

      const thr = this.chopThreshold();
      this.motion.chops(thr, dt).forEach((lane) => { this.chopLane(lane); });

      for (const b of r.boards) {
        if (b.dead) continue;
        if (now - b.born > b.ttl) {
          b.dead = true;
          if (b.type.check) continue;   // a missed question is not a missed board
          r.missed += 1;
          r.drifts[b.type.key] = (r.drifts[b.type.key] || 0) + 1;
          r.streak = 0;
          r.pops.push({ x: b.x, y: b.y, txt: 'drifted', life: 1, drift: true });
          this.audio.drift();
          if (r.rnd() < 0.35) this.say('miss');
        }
      }
      r.boards = r.boards.filter((b) => !b.dead);

      if (r.elapsed >= r.seconds * 1000) this.endRound('clear');
    }

    // A Savings Check is answered by chopping the lane of your answer — the same
    // reliable left/centre/right chop as play. Feedback lights the coin the camera
    // sees motion in; the answer is gated by an arming delay so the swing that
    // broke the gold board doesn't carry through. Skip once answered (coins off).
    if (r && this.state === 'check' && this._quizResolve && this._coins && !this._coins[0].disabled) {
      const thr = this.chopThreshold();
      const armed = now >= (this._checkArmedAt || 0);
      this.checkFeedback(thr, armed, now);
      if (armed) {
        const hits = this.motion.chops(thr, dt);
        // a chop in a lane with a coin answers it (ignore an empty lane)
        const pick = hits.find((lane) => lane < this._coins.length);
        if (pick !== undefined) this._quizResolve(pick);
      }
    }

    if (r) {
      for (const c of r.chips) { c.x += c.vx; c.y += c.vy; c.vy += 0.5; c.rot += c.vr; c.life -= 0.02; }
      r.chips = r.chips.filter((c) => c.life > 0);
      for (const p of r.pops) p.life -= 0.018;
      r.pops = r.pops.filter((p) => p.life > 0);
      for (let l = 0; l < r.laneFlash.length; l += 1) {
        r.laneFlash[l] = Math.max(0, r.laneFlash[l] - dt / 260);
      }
    }

    this.sensei.bob += dt / 420;
    this.sensei.pulse = Math.max(0, this.sensei.pulse - dt / 240);
    if (this.sensei.lineLeft > 0) this.sensei.lineLeft -= dt;
  };

  // Per-frame during a Savings Check: light each coin by how much motion the
  // camera sees in its corner, and print the raw quadrant levels so a punch that
  // isn't registering can be diagnosed (camera off? below the fire line?).
  Instance.prototype.checkFeedback = function (thr, armed, now) {
    const live = this.motion.isLive();
    const ln = this.motion.lanes;   // a coin sits in its lane, so pos === lane index
    for (const b of this._coins) {
      const pos = +b.dataset.p;
      const lvl = (armed && live) ? (ln[pos] || 0) : 0;
      b.style.setProperty('--charge', clamp(lvl / thr, 0, 1).toFixed(2));
      b.classList.toggle('charging', armed && live && lvl > thr * 0.4);
      // Coins sleep until armed: dimmed, greyed, and — with the guards in the
      // click/key handlers — unchoppable, so a leftover swing can't answer.
      b.classList.toggle('asleep', !armed);
    }
    if (this._checkDbg) {
      if (!armed) {
        // Compose-grace countdown — real player guidance, always shown.
        const secs = Math.max(0, (this._checkArmedAt - now) / 1000);
        this._checkDbg.textContent = `steady — drop your arms · coins wake in ${secs.toFixed(1)}s`;
      } else if (!live) {
        // Camera-off hint — also player guidance, always shown.
        this._checkDbg.textContent = 'cam OFF — turn the camera on in Dojo setup to chop (click / A B C still work)';
      } else {
        // Raw per-lane numbers: a field tuning aid, hidden unless ?debug=1 so the
        // cabinet never shows a diagnostic readout to players.
        this._checkDbg.textContent = this._debug
          ? `cam ● L ${(ln[0] || 0).toFixed(3)}  C ${(ln[1] || 0).toFixed(3)}  R ${(ln[2] || 0).toFixed(3)}  ·  fire > ${thr.toFixed(3)}`
          : '';
      }
    }
  };

  Instance.prototype.renderMeters = function () {
    const bars = this.ui.querySelectorAll('.cd-meter');
    const thr = this.chopThreshold();
    for (let l = 0; l < bars.length; l += 1) {
      const level = this.motion.lanes[l] || 0;
      bars[l].querySelector('i').style.height = Math.round(clamp(level / (thr * 2), 0, 1) * 58) + 'px';
      bars[l].classList.toggle('on', level > thr);
    }
  };

  // ===========================================================================
  // Render
  // ===========================================================================
  const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";

  Instance.prototype.roundRect = function (x, y, w, h, rad) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };

  Instance.prototype.render = function (now) {
    const ctx = this.ctx;
    const r = this.run;
    ctx.clearRect(0, 0, VW, VH);
    this.drawBackdrop(now);
    this.drawSensei();
    if (r && this.state !== 'idle') {
      // Boards and HUD belong to live play — once the round is over the mat is
      // just the dojo backdrop for the results, so drop them (chips/pops linger
      // and fade on their own).
      if (this.state !== 'over') for (const b of r.boards) if (!b.dead) this.drawBoard(b, now);
      this.drawChips();
      this.drawPops();
      if (this.state !== 'over') this.drawHud();
    }
    // the dojo fades IN from black at the very start of the round...
    if (this._introFadeAt) {
      const i = clamp((now - this._introFadeAt) / INTRO_FADE_MS, 0, 1);
      if (i < 1) { ctx.globalAlpha = 1 - i; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH); }
    }
    // ...and at round end the mat dims toward — but not all the way to — black
    // (RESULTS_DIM), so the dimmed dojo IS the results-screen backdrop. The opaque
    // summary card carries the text, so every line stays legible over it.
    if (this._fadeAt) {
      const f = clamp((now - this._fadeAt) / FADE_MS, 0, 1) * RESULTS_DIM;
      if (f > 0) { ctx.globalAlpha = f; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH); }
    }
    ctx.globalAlpha = 1;
  };

  // cover-fit a source of aspect `vr` into the VW×VH viewport
  Instance.prototype.coverFit = (vr) => {
    const sr = VW / VH; let dw = VW, dh = VH, dx = 0, dy = 0;
    if (vr > sr) { dh = VH; dw = VH * vr; dx = -(dw - VW) / 2; } else { dw = VW; dh = VW / vr; dy = -(dh - VH) / 2; }
    return { dx, dy, dw, dh };
  };

  Instance.prototype.drawBackdrop = function (now) {
    const ctx = this.ctx;
    const r = this.run;
    const stageReady = this._stage && this._stage.complete && this._stage.naturalWidth;
    const grad = () => {
      const g = ctx.createRadialGradient(VW / 2, VH * 0.28, 40, VW / 2, VH * 0.55, VH);
      g.addColorStop(0, '#16233d'); g.addColorStop(1, '#04060b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    };
    const drawDojo = () => { if (stageReady) ctx.drawImage(this._stage, 0, 0, VW, VH); else grad(); };

    // Cinematic bookend — the dojo frames a round of the status-quo webcam view:
    //   reveal 0->1  dojo dissolves INTO the webcam over the countdown (intro)
    //   ret    0->1  webcam dissolves BACK into the dojo at round end (outro)
    // (The dojo's own fade in/out of black is applied in render(), over everything.)
    const reveal = this._revealAt ? clamp((now - this._revealAt) / MATERIALIZE_MS, 0, 1) : 0;
    const ret = this._returnAt ? clamp((now - this._returnAt) / OUTRO_RETURN_MS, 0, 1) : 0;
    // The "status-quo view": the webcam when it's live, else the gradient — the
    // same no-camera backdrop keyboard players already get. drawWebcam derefs the
    // video, so it must never be called unless the camera is actually up.
    const live = this.motion.isLive();

    if (this._returnAt) {
      // OUTRO: status-quo underneath, the dojo crossfades back in on top.
      if (live) this.drawWebcam(now, 1); else grad();
      if (ret > 0) { ctx.save(); ctx.globalAlpha = ret; drawDojo(); ctx.restore(); }
    } else if (reveal >= 1) {
      // PLAY: the status-quo view.
      if (live) this.drawWebcam(now, 1); else grad();
    } else {
      // INTRO: the dojo, dissolving into the status-quo view as the countdown runs.
      drawDojo();
      if (reveal > 0) {
        if (live) this.drawWebcam(now, reveal);                                  // webcam's own sparkle materialise
        else { ctx.save(); ctx.globalAlpha = reveal; grad(); ctx.restore(); }    // gradient crossfade
      }
    }

    const laneW = VW / C.ROUND.lanes;
    if (r) {
      for (let l = 0; l < C.ROUND.lanes; l += 1) {
        if (r.laneFlash[l] > 0) {
          ctx.fillStyle = `rgba(240,165,44,${(0.10 * r.laneFlash[l]).toFixed(3)})`;
          ctx.fillRect(laneW * l, 0, laneW, VH);
        }
      }
    }
    ctx.strokeStyle = 'rgba(147,164,196,.10)';
    ctx.lineWidth = 2;
    for (let l = 1; l < C.ROUND.lanes; l += 1) {
      ctx.beginPath();
      ctx.moveTo(laneW * l, 0);
      ctx.lineTo(laneW * l, VH);
      ctx.stroke();
    }

    if (r && r.boostLeft > 0) {
      ctx.strokeStyle = 'rgba(255,215,107,.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, VW - 4, VH - 4);
    }

    if (this.state === 'idle') {
      ctx.fillStyle = 'rgba(93,109,138,.45)';
      ctx.font = `800 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.letterSpacing = '3px';
      ctx.fillText('THE MAT IS OPEN', VW / 2, VH * 0.62);
      ctx.letterSpacing = '0px';
    }
  };

  // The full-frame webcam view. reveal<1 => it materialises in over the dojo.
  Instance.prototype.drawWebcam = function (_now, reveal) {
    const ctx = this.ctx;
    const v = this.motion.video;
    const d = this.coverFit(v.videoWidth / v.videoHeight);
    if (reveal >= 1) {
      ctx.save(); ctx.translate(VW, 0); ctx.scale(-1, 1);
      ctx.globalAlpha = 0.62; ctx.drawImage(v, d.dx, d.dy, d.dw, d.dh); ctx.restore();
      ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(4,6,11,.58)'; ctx.fillRect(0, 0, VW, VH);
      return;
    }
    if (!this._webCv) this._webCv = document.createElement('canvas');
    const pc = this._webCv;
    if (pc.width !== VW) { pc.width = VW; pc.height = VH; }
    const pg = pc.getContext('2d', { willReadFrequently: true });
    pg.clearRect(0, 0, VW, VH);
    pg.save(); pg.translate(VW, 0); pg.scale(-1, 1); pg.globalAlpha = 0.62;
    pg.drawImage(v, d.dx, d.dy, d.dw, d.dh); pg.restore(); pg.globalAlpha = 1;
    this.applyMaterialize(pg, reveal);
    ctx.drawImage(pc, 0, 0);
    this.drawSparkle(reveal);
    ctx.fillStyle = 'rgba(4,6,11,.58)'; ctx.fillRect(0, 0, VW, VH);
  };

  // Per-pixel transporter dissolve on the player layer — only while assembling
  // (reveal < 1), so steady play pays nothing. Pixels past the frontier vanish;
  // pixels at the frontier flash cyan energy.
  Instance.prototype.applyMaterialize = (pg, reveal) => {
    const img = pg.getImageData(0, 0, VW, VH);
    const dt = img.data;
    const front = 0.14;
    for (let y = 0; y < VH; y += 1) {
      for (let x = 0; x < VW; x += 1) {
        const i = (y * VW + x) * 4;
        if (dt[i + 3] === 0) continue;
        const thr = dissolveThr(x, y);
        if (thr > reveal) { dt[i + 3] = 0; }
        else if (thr > reveal - front) { dt[i] = 150; dt[i + 1] = 232; dt[i + 2] = 220; }
      }
    }
    pg.putImageData(img, 0, 0);
  };

  // Gold/cyan sparkle motes riding the materialize frontier.
  Instance.prototype.drawSparkle = function (reveal) {
    const ctx = this.ctx;
    const front = 0.14;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let n = 0; n < 420; n += 1) {
      const x = Math.random() * VW, y = Math.random() * VH;
      if (Math.abs(dissolveThr(x | 0, y | 0) - reveal) < front) {
        ctx.globalAlpha = 0.5 + Math.random() * 0.5;
        ctx.fillStyle = Math.random() < 0.7 ? '#8ff0e6' : '#ffd76b';
        const s = 1 + Math.random() * 2.4;
        ctx.fillRect(x, y, s, s);
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
  };

  // Greedy wrap that refuses rather than overflowing the board.
  Instance.prototype.wrapWords = function (words, maxW, maxLines) {
    const ctx = this.ctx;
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (ctx.measureText(w).width > maxW) return null;
      const probe = cur ? cur + ' ' + w : w;
      if (ctx.measureText(probe).width <= maxW) { cur = probe; continue; }
      lines.push(cur);
      if (lines.length >= maxLines) return null;
      cur = w;
    }
    if (cur) lines.push(cur);
    return lines.length <= maxLines ? lines : null;
  };

  // Biggest type that fits the word inside the board, wrapping if it has to.
  Instance.prototype.fitLabel = function (text, maxW, maxH, maxSize, minSize) {
    const ctx = this.ctx;
    const words = text.toUpperCase().split(/\s+/);
    for (let size = maxSize; size >= minSize; size -= 1) {
      ctx.font = `800 ${size}px ${FONT}`;
      const lh = size * 1.08;
      const lines = this.wrapWords(words, maxW, Math.max(1, Math.min(2, Math.floor(maxH / lh))));
      if (lines) return { size, lines, lh };
    }
    ctx.font = `800 ${minSize}px ${FONT}`;
    return { size: minSize, lines: [text.toUpperCase()], lh: minSize * 1.08 };
  };

  /* The word IS the object. Everything on the board exists to make it readable
     at a glance: a light plaque, the tier colour, and type in that tier's ink —
     dark on the light tiers, light on the dark ones — so contrast never depends
     on which tier came up. */
  Instance.prototype.drawBoard = function (b, now) {
    const ctx = this.ctx;
    const type = b.type;
    const age = Math.max(0, now - b.born);
    const t = Math.min(1, age / 160);
    const pop = Math.max(0.5, 1 - (1 - t) ** 3);
    const bw = b.r * 2.35 * pop;
    const bh = b.r * 1.70 * pop;

    // A board about to drift away pulses, so the eye catches it.
    const left = 1 - age / b.ttl;
    const urgent = left < 0.28;
    const throb = urgent ? 0.5 + 0.5 * Math.sin(now / 90) : 0;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(0,0,0,.42)';
    this.roundRect(-bw / 2 + 4, -bh / 2 + 9, bw, bh, 13);
    ctx.fill();

    ctx.fillStyle = urgent ? 'rgba(255,226,230,.98)' : '#e8eef8';
    this.roundRect(-bw / 2, -bh / 2, bw, bh, 13);
    ctx.fill();

    if (urgent) {
      ctx.strokeStyle = `rgba(194,59,59,${(0.35 + throb * 0.55).toFixed(3)})`;
      ctx.lineWidth = 3;
      this.roundRect(-bw / 2 - 1, -bh / 2 - 1, bw + 2, bh + 2, 14);
      ctx.stroke();
    }

    const inset = Math.max(5, bw * 0.075);
    const pw = bw - 2 * inset, ph = bh - 2 * inset;
    ctx.fillStyle = type.color;
    this.roundRect(-pw / 2, -ph / 2, pw, ph, 9);
    ctx.fill();

    // the seam it breaks along, faint enough to leave the word alone
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-pw / 2, 0);
    ctx.lineTo(pw / 2, 0);
    ctx.stroke();

    // CostBot stands behind the boss word; the gold check keeps its question mark
    if (type.art && this.hero.complete && this.hero.naturalWidth) {
      let dh = ph * 0.9;
      let dw = dh * this.hero.naturalWidth / this.hero.naturalHeight;
      if (dw > pw * 0.8) { dw = pw * 0.8; dh = dw * this.hero.naturalHeight / this.hero.naturalWidth; }
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.hero, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else if (type.check) {
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = '#241403';
      ctx.font = `800 ${Math.round(ph * 1.0)}px ${FONT}`;
      ctx.fillText('?', 0, 1);
      ctx.restore();
    }

    const foot = 13;
    const fit = this.fitLabel(type.label, pw - 16, ph - foot - 6, 21, 10);
    const block = fit.lines.length * fit.lh;
    const top = -(ph - foot) / 2 + (ph - foot - block) / 2 + fit.lh / 2;
    ctx.font = `800 ${fit.size}px ${FONT}`;
    ctx.fillStyle = type.ink;
    for (let i = 0; i < fit.lines.length; i += 1) ctx.fillText(fit.lines[i], 0, top + i * fit.lh);

    ctx.font = `700 10px ${FONT}`;
    ctx.globalAlpha = 0.66;
    ctx.fillText(type.check ? 'STOPS THE CLOCK' : money(type.savings), 0, ph / 2 - 8);
    ctx.globalAlpha = 1;

    ctx.restore();
  };

  Instance.prototype.drawChips = function () {
    const ctx = this.ctx;
    for (const c of this.run.chips) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = Math.max(0, c.life);
      ctx.fillStyle = c.col;
      ctx.fillRect(-c.sz / 2, -c.sz / 2, c.sz, c.sz * 0.6);
      ctx.restore();
    }
  };

  Instance.prototype.drawPops = function () {
    const ctx = this.ctx;
    for (const p of this.run.pops) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.drift) {
        ctx.fillStyle = '#c23b3b';
        ctx.font = `800 20px ${FONT}`;
      } else {
        ctx.fillStyle = p.gold ? '#ffd76b' : '#6ee7a0';
        ctx.font = `800 ${p.gold ? 28 : 24}px ${FONT}`;
      }
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 5;
      const y = p.y - (1 - p.life) * 64;
      ctx.strokeText(p.txt, p.x, y);
      ctx.fillText(p.txt, p.x, y);
      ctx.restore();
    }
  };

  Instance.prototype.drawSensei = function () {
    const ctx = this.ctx;
    if (!this.hero.complete || !this.hero.naturalWidth) return;
    const size = 84 + this.sensei.pulse * 10;
    const x = 22;
    const y = VH - size - 18 + Math.sin(this.sensei.bob) * 4;

    ctx.save();
    ctx.globalAlpha = this.state === 'idle' ? 0.5 : 0.9;
    ctx.drawImage(this.hero, x, y, size, size);
    ctx.restore();

    if (this.sensei.lineLeft > 0 && this.sensei.line) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.sensei.lineLeft / 400);
      ctx.font = `600 13px ${FONT}`;
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(this.sensei.line).width + 22;
      const bx = x + size + 8;
      const by = y + size * 0.34;
      ctx.fillStyle = 'rgba(19,28,48,.94)';
      this.roundRect(bx, by - 15, w, 30, 9);
      ctx.fill();
      ctx.strokeStyle = '#2b3f66';
      ctx.lineWidth = 1;
      this.roundRect(bx, by - 15, w, 30, 9);
      ctx.stroke();
      ctx.fillStyle = '#e8eef8';
      ctx.textAlign = 'left';
      ctx.fillText(this.sensei.line, bx + 11, by);
      ctx.restore();
    }
  };

  /* The HUD is drawn, not DOM: it has to sit inside the scaled viewport so it
     shrinks with the mat rather than floating over it at browser size. */
  Instance.prototype.drawHud = function () {
    const ctx = this.ctx;
    const r = this.run;
    const H = 66;

    ctx.save();
    ctx.fillStyle = 'rgba(6,10,18,.72)';
    ctx.fillRect(0, 0, VW, H);
    ctx.fillStyle = '#2b3f66';
    ctx.fillRect(0, H, VW, 1);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5d6d8a';
    ctx.font = `800 10px ${FONT}`;
    ctx.letterSpacing = '1.4px';
    ctx.fillText('SAVINGS REALIZED', 22, 19);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = '#f0a52c';
    ctx.font = `800 27px ${FONT}`;
    ctx.fillText(money(this.total()), 22, 43);

    // time bar
    const remain = Math.max(0, r.seconds * 1000 - r.elapsed);
    const frac = clamp(remain / (r.seconds * 1000), 0, 1);
    const barW = 260, barX = VW - barW - 22;
    ctx.fillStyle = '#0b1322';
    this.roundRect(barX, 40, barW, 5, 5);
    ctx.fill();
    ctx.fillStyle = frac < 0.18 ? '#c23b3b' : '#7fd6c4';
    this.roundRect(barX, 40, Math.max(2, barW * frac), 5, 5);
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.fillStyle = frac < 0.18 ? '#ff9e9e' : '#e8eef8';
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(mmss(remain / 1000), VW - 22, 23);

    // centre: streak and the discount
    ctx.textAlign = 'center';
    const mult = this.multiplier();
    ctx.fillStyle = mult > 1 ? '#f0a52c' : '#93a4c4';
    ctx.font = `800 17px ${FONT}`;
    ctx.fillText('×' + mult + ' streak', VW / 2, 20);
    if (r.boostLeft > 0) {
      ctx.fillStyle = '#6ee7a0';
      ctx.font = `700 13px ${FONT}`;
      ctx.fillText('COMMITMENT DISCOUNT · ' + (r.boostLeft / 1000).toFixed(1) + 's', VW / 2, 44);
    } else {
      ctx.fillStyle = '#5d6d8a';
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText(`${r.reclaimed} reclaimed · ${r.missed} drifted · ${r.quizCorrect} checks`, VW / 2, 44);
    }

    // input mode, bottom right — re-read every frame, because permission can
    // be granted mid-round
    ctx.textAlign = 'right';
    ctx.font = `600 11.5px ${FONT}`;
    ctx.fillStyle = 'rgba(93,109,138,.85)';
    ctx.fillText(this.motion.isLive()
      ? 'Camera live — chop left, centre or right'
      : 'No camera — lanes are ← ↑ → (or click a board)', VW - 22, VH - 16);
    ctx.restore();
  };

  // ===========================================================================
  // Input
  // ===========================================================================
  Instance.prototype.onKey = function (e) {
    const key = e.key.toLowerCase();

    if (this.state === 'check') {
      // Answer by lane, same keys as chopping: left/A/1, centre/W/B/2, right/D/C/3.
      // (A/B/C line up because the coins are A-left, B-centre, C-right.)
      let pos = null;
      if (key === 'arrowleft' || key === 'a' || key === '1') pos = 0;
      else if (key === 'arrowup' || key === 'w' || key === 'b' || key === '2') pos = 1;
      else if (key === 'arrowright' || key === 'd' || key === 'c' || key === '3') pos = 2;
      // Honour the compose grace: keys don't answer until the coins wake either.
      if (pos !== null && this._coins && pos < this._coins.length && this._quizResolve
          && performance.now() >= (this._checkArmedAt || 0)) {
        this._quizResolve(pos); e.preventDefault();
      }
      return;
    }

    if (key === 'm') { this.audio.toggle(); return; }
    if (key === 'p' || key === 'escape') {
      if (this.state === 'play') this.setPause(true);
      else if (this.state === 'paused') this.setPause(false);
      e.preventDefault();
      return;
    }

    if (this.state !== 'play') return;

    let lane = null;
    if (key === 'arrowleft' || key === 'a') lane = 0;
    else if (key === 'arrowup' || key === 'w' || key === ' ' || key === 's' || key === 'arrowdown') lane = 1;
    else if (key === 'arrowright' || key === 'd') lane = 2;
    else if (key === '1' || key === '2' || key === '3') lane = Number(key) - 1;

    if (lane !== null) {
      this.chopLane(clamp(lane, 0, C.ROUND.lanes - 1));
      e.preventDefault();
    }
  };

  // Clicking a board is the universal fallback: no camera, no keyboard needed.
  Instance.prototype.onPointer = function (e) {
    this.audio.resume();
    if (this.music && this._musicSlot) this.music.setState(this._musicSlot);
    if (this.state !== 'play') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * VW;
    const y = (e.clientY - rect.top) / rect.height * VH;
    let best = null, bestD = Infinity;
    for (const b of this.run.boards) {
      if (b.dead) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < b.r * 1.7 && d < bestD) { bestD = d; best = b; }
    }
    if (best && this.laneReady(best.lane)) this.breakBoard(best);
  };

  // ===========================================================================
  // Public API
  // ===========================================================================
  const CostBotDojo = {
    VERSION,
    CONTENT: C,
    mount(container, opts) {
      if (typeof container === 'string') container = document.querySelector(container);
      if (!container) throw new Error('CostBotDojo.mount: container not found');
      return new Instance(container, opts || {});
    },
    loadMeta: () => loadMeta(true),
    resetMeta() { try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ } },
    money, mmss, STORE_KEY,
  };

  global.CostBotDojo = CostBotDojo;
})(typeof window !== 'undefined' ? window : globalThis);
