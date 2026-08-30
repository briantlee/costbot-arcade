/* ============================================================================
 * CostBot: Waste Hunter — ENGINE
 * ----------------------------------------------------------------------------
 * Standalone playable AND embeddable as a mini-game inside a larger host game.
 *
 *   const game = WasteHunter.mount(el, {
 *     stageId: 'ec2-graveyard',   // omit + showShell:true for the built-in shell
 *     seed: 20260801,             // optional; deterministic runs (same seed = same board)
 *     showShell: false,           // false = drop straight into one stage
 *     persist: true,              // localStorage meta progression
 *     meta: hostMetaObject,       // optional: host owns the save data instead
 *     returnLabel: 'Return to HQ',
 *     onComplete(result) {},      // fired at end of every run
 *     onEvent(type, payload) {},  // 'ready' 'run:start' 'run:levelup'
 *                                 // 'run:boss' 'run:achievement' 'run:end' 'exit'
 *   });
 *   game.destroy();
 *
 * result = { outcome:'clear'|'death'|'quit', stageId, seed, dollarsSaved,
 *            tokensEarned, timeSurvived, kills, level, weapons[],
 *            achievementsUnlocked[], meta }
 * ==========================================================================*/
((global) => {
  'use strict';

  const C = global.WH_CONTENT;

  // The arcade's shared purse — tokens are earned in any cabinet and spent in
  // any cabinet. Absent only if the script failed to load, in which case the
  // game still runs; it just cannot pay out.
  const NO_WALLET = { tokens: 0, earn: () => 0, spend: () => false, bank: () => 0,
    init: () => ({}), onChange: () => () => {} };
  const wallet = () => global.ArcadeWallet || NO_WALLET;
  const VERSION = '0.1.0';
  const VW = 1152, VH = 648;                  // logical viewport
  const WORLD_W = 2600, WORLD_H = 1750;
  const STORE_KEY = 'costbot.wastehunter.v1';
  const TAU = Math.PI * 2;

  // ===========================================================================
  // Utility
  // ===========================================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  function money(n) {
    n = Math.round(n);
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return '$' + n.toLocaleString('en-US');
  }
  function moneyExact(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function mmss(s) {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ===========================================================================
  // Persistence
  // ===========================================================================
  function defaultMeta() {
    return {
      version: 2, tokens: 0, lifetimeTokens: 0, banked: 0, lifetimeDollars: 0, runs: 0,
      quizCorrect: 0, upgrades: {}, achievements: {}, best: {}, cleared: {},
      seenQuestions: {}, theme: 'synthwave',
    };
  }
  // v1 called the currency "Cost Avoidance Credits". The arcade now runs on one
  // currency — AI tokens — so old saves carry their balance over 1:1 rather than
  // waking up broke.
  function migrateMeta(m) {
    if (m && m.credits !== undefined && m.tokens === undefined) {
      m.tokens = m.credits;
      m.lifetimeTokens = m.lifetimeCredits || m.credits;
      delete m.credits; delete m.lifetimeCredits;
      m.version = 2;
    }
    return m;
  }
  function loadMeta(persist) {
    if (!persist) return defaultMeta();
    try {
      const raw = global.localStorage && localStorage.getItem(STORE_KEY);
      if (!raw) return defaultMeta();
      const m = Object.assign(defaultMeta(), migrateMeta(JSON.parse(raw)));
      // a theme this cabinet no longer offers would leave the picker with nothing lit
      if (m.theme === 'mudslide') m.theme = 'synthwave';
      return m;
    } catch { return defaultMeta(); }
  }
  function saveMeta(meta, persist) {
    if (!persist) return;
    // Stamped so a server copy that missed a write cannot pass itself off as the
    // newer one — ArcadeSync.reconcile() reads this. A never-saved profile stays
    // unstamped on purpose: it has nothing to be newer than.
    meta.savedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(meta)); } catch { /* private mode */ }
  }

  // ===========================================================================
  // Audio — tiny WebAudio synth, zero asset files
  // ===========================================================================
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
    function tone(freq, dur, type, vol, slideTo) {
      if (muted) return;
      const c = ensure(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), c.currentTime + dur);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, c.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    }
    function noise(dur, vol, freq) {
      if (muted) return;
      const c = ensure(); if (!c) return;
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 900;
      const g = c.createGain(); g.gain.value = vol || 0.15;
      src.connect(f); f.connect(g); g.connect(master); src.start();
    }
    return {
      shoot: () => tone(760, 0.06, 'square', 0.06, 420),
      hit: () => noise(0.05, 0.05, 1400),
      kill: () => tone(300, 0.14, 'triangle', 0.11, 120),
      coin: () => tone(1180, 0.07, 'sine', 0.09, 1720),
      hurt: () => tone(190, 0.24, 'sawtooth', 0.16, 70),
      nova: () => { tone(160, 0.3, 'sine', 0.16, 60); noise(0.22, 0.1, 500); },
      level: () => { [523, 659, 784, 1046].forEach((f, i) => { setTimeout(() => tone(f, 0.22, 'triangle', 0.13), i * 70); }); },
      boss: () => { tone(90, 1.1, 'sawtooth', 0.2, 42); noise(0.9, 0.1, 260); },
      win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => { setTimeout(() => tone(f, 0.35, 'sine', 0.15), i * 110); }); },
      lose: () => { [440, 392, 330, 262].forEach((f, i) => { setTimeout(() => tone(f, 0.4, 'triangle', 0.14), i * 150); }); },
      ach: () => { [880, 1174].forEach((f, i) => { setTimeout(() => tone(f, 0.2, 'sine', 0.12), i * 90); }); },
      // exposed so the shared music sequencer can hang off the same master bus
      nodes() { const c = ensure(); return c ? { ctx: c, master } : null; },
      toggle() {
        muted = !muted;
        const c = ensure();
        // gate the master bus, not just the sfx calls, so music mutes too
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
.wh-root{position:relative;width:100%;height:100%;background:#06080e;overflow:hidden;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8eef8;user-select:none;
  display:flex;align-items:center;justify-content:center;}
.wh-frame{position:relative;transform-origin:top left;width:${VW}px;height:${VH}px;}
.wh-canvas{position:absolute;inset:0;width:${VW}px;height:${VH}px;display:block;image-rendering:auto;}
.wh-ui{position:absolute;inset:0;pointer-events:none;}
.wh-ui > *{pointer-events:auto;}
.wh-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 40%,rgba(20,32,58,.94),rgba(4,6,12,.985));backdrop-filter:blur(3px);}
.wh-hide{display:none !important;}
.wh-title{font-size:62px;font-weight:800;letter-spacing:-1.5px;margin:0;
  background:linear-gradient(180deg,#ffd76b,#ff9e2c 60%,#e07b1a);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 6px 26px rgba(255,160,40,.22);}
.wh-sub{font-size:17px;color:#93a4c4;margin:6px 0 0;letter-spacing:.4px;}
.wh-hero{width:150px;height:150px;object-fit:contain;filter:drop-shadow(0 12px 26px rgba(60,140,255,.4));
  animation:wh-bob 2.6s ease-in-out infinite;}
@keyframes wh-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
.wh-btn{background:linear-gradient(180deg,#27406e,#1a2b4c);border:1px solid #3f5f96;color:#eaf1ff;
  padding:13px 30px;border-radius:11px;font-size:16px;font-weight:650;cursor:pointer;transition:.14s;
  box-shadow:0 4px 0 #14203a,0 8px 20px rgba(0,0,0,.4);}
.wh-btn:hover{background:linear-gradient(180deg,#33528c,#21365e);transform:translateY(-2px);box-shadow:0 6px 0 #14203a,0 12px 26px rgba(0,0,0,.45);}
.wh-btn:active{transform:translateY(2px);box-shadow:0 2px 0 #14203a;}
.wh-btn.primary{background:linear-gradient(180deg,#f0a52c,#d4821a);border-color:#ffc866;color:#241403;box-shadow:0 4px 0 #8a5410,0 8px 20px rgba(220,140,30,.3);}
.wh-btn.primary:hover{background:linear-gradient(180deg,#ffbd4a,#e89322);box-shadow:0 6px 0 #8a5410,0 12px 26px rgba(220,140,30,.4);}
.wh-btn.ghost{background:rgba(255,255,255,.05);border-color:#31456b;box-shadow:none;padding:9px 18px;font-size:14px;}
.wh-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}
.wh-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center;}
.wh-themes{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:18px;align-items:center;}
.wh-chip{background:rgba(255,255,255,.04);border:1px solid #31456b;color:#a9bad6;padding:7px 14px;
  border-radius:20px;font-size:12.5px;font-weight:650;cursor:pointer;transition:.14s;font-family:inherit;}
.wh-chip:hover{background:#22355c;color:#fff;border-color:#5a7cb5;}
.wh-chip.on{background:linear-gradient(180deg,#f0a52c,#d4821a);border-color:#ffc866;color:#241403;}
.wh-chip small{display:block;font-size:10px;font-weight:500;opacity:.75;margin-top:1px;}

/* stage select */
.wh-stages{display:flex;gap:18px;margin:26px 0 8px;}
.wh-card{width:250px;background:linear-gradient(180deg,#151f36,#0e1524);border:1px solid #2b3f66;border-radius:15px;
  overflow:hidden;cursor:pointer;transition:.16s;position:relative;}
.wh-card:hover{transform:translateY(-6px);border-color:#f0a52c;box-shadow:0 16px 34px rgba(0,0,0,.55);}
.wh-card.locked{opacity:.45;cursor:not-allowed;filter:grayscale(.8);}
.wh-card.locked:hover{transform:none;border-color:#2b3f66;box-shadow:none;}
.wh-card img{width:100%;height:118px;object-fit:cover;display:block;}
.wh-card-b{padding:12px 14px 15px;}
.wh-card h3{margin:0 0 3px;font-size:16.5px;}
.wh-card p{margin:0;font-size:12.5px;color:#8c9dbd;line-height:1.45;}
.wh-badge{position:absolute;top:9px;right:9px;background:rgba(6,10,18,.86);border:1px solid #3f5f96;
  padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.4px;}
.wh-badge.clear{background:#1d4a2c;border-color:#3fa060;color:#8ff0ad;}
.wh-best{font-size:11.5px;color:#f0a52c;margin-top:7px;font-weight:650;}

/* level-up draft */
.wh-draft{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:rgba(5,9,17,.9);backdrop-filter:blur(5px);}
.wh-draft h2{font-size:33px;margin:0;color:#ffd76b;letter-spacing:.5px;}
.wh-draft .wh-sub{margin-bottom:20px;}
.wh-picks{display:flex;gap:16px;}
.wh-pick{width:262px;background:linear-gradient(180deg,#182541,#0f1729);border:2px solid #33507f;border-radius:14px;
  padding:18px;cursor:pointer;transition:.15s;text-align:left;display:flex;flex-direction:column;gap:7px;}
.wh-pick:hover{transform:translateY(-7px) scale(1.02);border-color:#ffd76b;box-shadow:0 18px 38px rgba(0,0,0,.6);}
.wh-pick .ic{font-size:38px;line-height:1;}
.wh-pick .nm{font-size:18px;font-weight:750;}
.wh-pick .lv{font-size:11.5px;font-weight:750;letter-spacing:.7px;color:#7fd6c4;text-transform:uppercase;}
.wh-pick .lv.new{color:#ffd76b;}
.wh-pick .nt{font-size:13.5px;color:#c3d0e6;line-height:1.45;}
.wh-pick .ft{font-size:11.5px;color:#7e8fae;font-style:italic;line-height:1.4;border-top:1px solid #263a5c;padding-top:8px;margin-top:2px;}

/* trivia */
.wh-quiz{width:770px;background:linear-gradient(180deg,#16203a,#0d1424);border:2px solid #3f5f96;
  border-radius:16px;padding:20px 24px 18px;box-shadow:0 26px 64px rgba(0,0,0,.65);}
.wh-quiz-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;}
.wh-quiz-tag{font-size:11.5px;font-weight:800;letter-spacing:1.5px;color:#7fd6c4;}
.wh-quiz-prize{font-size:12.5px;font-weight:700;color:#ffd76b;background:rgba(240,165,44,.13);
  border:1px solid #6b5320;padding:4px 11px;border-radius:20px;}
.wh-quiz-timer{height:5px;background:#1b2740;border-radius:3px;overflow:hidden;margin-bottom:15px;}
.wh-quiz-timer i{display:block;height:100%;background:linear-gradient(90deg,#6ee7a0,#ffd76b);
  transition:width .1s linear;}
.wh-quiz-timer.low i{background:linear-gradient(90deg,#ff8a8a,#ff3b3b);}
.wh-quiz-q{font-size:20px;line-height:1.38;margin:0 0 15px;font-weight:650;}
.wh-quiz-choices{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
.wh-choice{display:flex;gap:11px;align-items:center;text-align:left;background:#182541;border:1.5px solid #33507f;
  color:#dce7f8;padding:12px 14px;border-radius:10px;font-size:14px;cursor:pointer;transition:.12s;
  font-family:inherit;line-height:1.35;}
.wh-choice:hover:not(:disabled){background:#22355c;border-color:#7fd6c4;transform:translateX(3px);}
.wh-choice b{flex:0 0 24px;height:24px;border-radius:6px;background:#2b3f66;display:flex;align-items:center;
  justify-content:center;font-size:12px;font-weight:800;color:#a9bad6;}
.wh-choice:disabled{cursor:not-allowed;}
.wh-choice.struck{opacity:.28;text-decoration:line-through;}
.wh-choice.right{background:#123a26;border-color:#4ade80;color:#c7f5da;}
.wh-choice.right b{background:#4ade80;color:#06210f;}
.wh-choice.wrong{background:#3a1418;border-color:#ff6b6b;color:#ffd0d0;}
.wh-choice.wrong b{background:#ff6b6b;color:#2a0508;}
.wh-quiz-foot{font-size:12px;color:#7e8fae;margin-top:13px;text-align:center;font-style:italic;}
.wh-why{margin-top:14px;padding:13px 15px;border-radius:10px;font-size:13.5px;line-height:1.5;
  animation:wh-slide .3s ease;}
.wh-why.ok{background:rgba(74,222,128,.10);border:1px solid #2e7d4f;color:#c7f5da;}
.wh-why.no{background:rgba(255,107,107,.10);border:1px solid #8a3535;color:#ffd0d0;}
.wh-why b{display:block;margin-bottom:4px;font-size:14.5px;}
.wh-continue{margin-top:9px;font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:.6;
  text-align:right;animation:wh-pulse 1.4s ease-in-out infinite;}
@keyframes wh-pulse{0%,100%{opacity:.35}50%{opacity:.8}}

/* results */
.wh-panel{background:linear-gradient(180deg,#141d33,#0c1220);border:1px solid #2b3f66;border-radius:16px;
  padding:24px 30px;min-width:470px;box-shadow:0 24px 60px rgba(0,0,0,.6);}
.wh-stat{display:flex;justify-content:space-between;padding:7px 0;font-size:14.5px;border-bottom:1px solid #1e2c47;}
.wh-stat:last-child{border-bottom:none;}
/* the arcade token, shared art — the same coin in every cabinet */
.wh-coin{width:15px;height:15px;vertical-align:-3px;margin-right:5px;}
.wh-coin.lg{width:22px;height:22px;vertical-align:-5px;margin-right:6px;}
.wh-stat.nb{border-bottom:none;padding-bottom:2px;}
.wh-kills{padding:0 0 7px 16px;border-bottom:1px solid #1e2c47;}
.wh-kill{display:flex;justify-content:space-between;padding:2.5px 0;font-size:13px;color:#8ea1c2;}
.wh-kill b{font-variant-numeric:tabular-nums;color:#cddaf0;font-size:13px;font-weight:700;}
.wh-stat b{font-variant-numeric:tabular-nums;color:#ffd76b;font-size:15.5px;}
.wh-big{font-size:46px;font-weight:800;color:#6ee7a0;text-align:center;font-variant-numeric:tabular-nums;
  text-shadow:0 4px 22px rgba(80,230,150,.28);margin:2px 0 4px;}

/* bot bay */
.wh-shop{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0;max-width:760px;}
/* Banking is the counterweight to the shop below it, so it reads as the other
   thing you can do with a balance rather than a footnote to buying. */
.wh-bank{margin:14px 0 0;max-width:760px;text-align:left;border:1px solid #2e7d4f;
  border-radius:14px;padding:13px 16px;background:linear-gradient(180deg,#12241a,#0b1410);}
.wh-bank-t{font-size:14px;font-weight:750;color:#8ff0ad;}
.wh-bank-d{font-size:12.5px;color:#9ab8a6;line-height:1.55;margin-top:4px;}
.wh-bank-d b{color:#c7f5da;font-variant-numeric:tabular-nums;}
.wh-bank-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
.wh-bankbtn{background:#12291d;border:1px solid #3fa060;color:#8ff0ad;border-radius:9px;
  padding:7px 13px;font:700 12.5px inherit;cursor:pointer;font-variant-numeric:tabular-nums;}
.wh-bankbtn:hover:not(:disabled){background:#1a3a28;color:#c7f5da;}
.wh-bankbtn.all{background:#173a26;border-color:#6ee7a0;}
.wh-bankbtn:disabled{opacity:.38;cursor:default;}
.wh-item{background:#131c30;border:1px solid #2b3f66;border-radius:11px;padding:13px;text-align:left;}
.wh-item .t{font-size:14.5px;font-weight:700;margin-bottom:3px;}
.wh-item .d{font-size:12px;color:#8c9dbd;margin-bottom:9px;min-height:30px;line-height:1.4;}
.wh-item .pips{display:flex;gap:3px;margin-bottom:9px;}
.wh-item .pip{width:11px;height:5px;border-radius:3px;background:#26364f;}
.wh-item .pip.on{background:#f0a52c;}
.wh-buy{width:100%;background:#1d3358;border:1px solid #3f5f96;color:#dce7f8;padding:7px;border-radius:7px;
  font-size:12.5px;font-weight:650;cursor:pointer;}
.wh-buy:hover:not(:disabled){background:#27467a;}
.wh-buy:disabled{opacity:.35;cursor:not-allowed;}

/* achievements */
.wh-achs{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;max-width:820px;max-height:330px;overflow-y:auto;padding:4px;}
.wh-ach{background:#131c30;border:1px solid #24344f;border-radius:9px;padding:9px 11px;display:flex;gap:9px;align-items:center;opacity:.42;}
.wh-ach.on{opacity:1;border-color:#f0a52c;background:#1d1a12;}
.wh-ach .ic{font-size:21px;}
.wh-ach .n{font-size:12.5px;font-weight:700;}
.wh-ach .d{font-size:10.5px;color:#8c9dbd;line-height:1.35;}

/* how to play + bestiary */
.wh-brief{max-width:860px;text-align:left;display:flex;flex-direction:column;gap:20px;margin-top:4px;}
.wh-brief section{background:#111a2c;border:1px solid #22314c;border-radius:13px;padding:15px 18px;}
.wh-brief h4{margin:0 0 10px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#7fd6c4;}
.wh-brief p{margin:0 0 8px;font-size:13.5px;line-height:1.6;color:#b9c6dd;}
.wh-brief p:last-child{margin-bottom:0;}
.wh-fine{font-size:12px;color:#7e8fae;line-height:1.55;margin-top:10px;font-style:italic;}
.wh-fine b{color:#ffd76b;font-style:normal;}
.wh-step{display:flex;gap:11px;align-items:flex-start;padding:6px 0;}
.wh-step .ic{font-size:19px;width:26px;flex:0 0 auto;text-align:center;}
.wh-step .n{font-size:13.5px;font-weight:700;color:#dce7f8;}
.wh-step .d{font-size:12px;color:#8c9dbd;line-height:1.45;}
.wh-best{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;}
.wh-be{display:flex;gap:11px;align-items:flex-start;background:#131c30;border:1px solid #24344f;
  border-radius:10px;padding:10px 12px;}
.wh-be.boss{border-color:#7a3038;background:#1c1216;grid-column:1 / -1;}
.wh-be .g{font-size:21px;width:36px;height:36px;border-radius:9px;flex:0 0 auto;display:flex;
  align-items:center;justify-content:center;border:1px solid;}
.wh-be .n{font-size:13.5px;font-weight:700;}
.wh-be .b{font-size:11.5px;color:#8c9dbd;line-height:1.45;margin-top:1px;}
.wh-be .s{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:6px;font-size:10.5px;color:#7e8fae;}
.wh-be .s b{color:#ffd76b;font-variant-numeric:tabular-nums;}
.wh-tag{font-size:9.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:1px 7px;
  border-radius:20px;background:#1b2740;border:1px solid #35496e;color:#a9bad6;}

/* toasts */
.wh-toasts{position:absolute;top:74px;right:16px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.wh-toast{background:linear-gradient(180deg,#2a2312,#191308);border:1px solid #f0a52c;border-radius:10px;
  padding:9px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.5);
  animation:wh-slide .35s cubic-bezier(.2,1.3,.4,1);}
@keyframes wh-slide{from{transform:translateX(60px);opacity:0}to{transform:translateX(0);opacity:1}}
.wh-toast .ic{font-size:22px;}
.wh-toast .n{font-size:13px;font-weight:750;color:#ffd76b;}
.wh-toast .d{font-size:11px;color:#b9c6dd;}

/* misc */
.wh-corner{position:absolute;top:12px;right:14px;display:flex;gap:8px;}
.wh-icnbtn{background:rgba(10,16,28,.75);border:1px solid #2b3f66;color:#b9c6dd;width:34px;height:34px;
  border-radius:8px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.wh-icnbtn:hover{background:#1d2b45;color:#fff;}
.wh-tip{font-size:13px;color:#7e8fae;margin-top:16px;font-style:italic;max-width:520px;text-align:center;}
.wh-seed{font-size:11px;color:#5d6d8a;margin-top:10px;font-family:ui-monospace,monospace;}
.wh-kbd{display:inline-block;background:#1b2740;border:1px solid #35496e;border-bottom-width:2px;border-radius:5px;
  padding:1px 7px;font-size:12px;font-family:ui-monospace,monospace;color:#c3d0e6;margin:0 2px;}
/* A flex parent with justify-content:center clips overflow at BOTH ends, so a
   tall result screen loses its hero art off the top as well as its buttons off
   the bottom — and the top is unreachable however far you scroll. Everything
   tall goes in this scroller instead.
   max-height is min(container, VH-40): the fixed value alone still overflowed
   whenever the window was shorter than the game's logical height. */
.wh-scroll{overflow-y:auto;max-height:min(100%, ${VH - 40}px);padding:20px;
  display:flex;flex-direction:column;align-items:center;}
/* The result screen pins its actions: the stats scroll, Run Again does not.
   Burying the primary button below a fold is how a stage clear ends up looking
   like it has no way out of it. */
.wh-result{justify-content:flex-start;padding:0 0 14px;}
.wh-result .wh-scroll{flex:1 1 auto;min-height:0;max-height:none;}
.wh-scroll::-webkit-scrollbar{width:8px}.wh-scroll::-webkit-scrollbar-thumb{background:#2b3f66;border-radius:4px}
`;

  function injectCSS() {
    if (document.getElementById('wh-style')) return;
    const s = document.createElement('style');
    s.id = 'wh-style';
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
    this.onEvent = opts.onEvent || (() => {});
    this.onComplete = opts.onComplete || (() => {});
    this.showShell = opts.showShell !== false;
    this.returnLabel = opts.returnLabel || 'Exit';
    this.audio = makeAudio();
    const MUSIC = global.ArcadeMusic || global.WHMusic;
    this.music = MUSIC ? MUSIC.create(() => this.audio.nodes()) : null;
    this._musicState = null;
    if (this.music) this.music.setTheme(this.meta.theme || 'synthwave');
    this.destroyed = false;

    // ---- DOM ----------------------------------------------------------------
    const root = document.createElement('div');
    root.className = 'wh-root';
    root.innerHTML = `
      <div class="wh-frame">
        <canvas class="wh-canvas" width="${VW}" height="${VH}"></canvas>
        <div class="wh-ui"></div>
      </div>`;
    container.innerHTML = '';
    container.appendChild(root);

    this.root = root;
    this.frame = root.querySelector('.wh-frame');
    this.canvas = root.querySelector('.wh-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ui = root.querySelector('.wh-ui');

    // ---- assets -------------------------------------------------------------
    this.assetBase = opts.assetBase || 'assets/';
    this.img = {};
    // 'terminate_all' is swappable — drop your own assets/terminate_all.png in
    // and the Terminate All pickup flashes it full-screen.
    ['costbot', 'inspire', 'lightbulb_moment', 'savings_found', 'automation_wizard',
      'beat_up', 'still_did_it', 'alert_mode', 'query_optimizer', 'research_mode',
      'max_speed_clean', 'done', 'turtle_version', 'terminate_all'].forEach((k) => {
        const im = new Image();
        im.src = this.assetBase + k + '.png';
        this.img[k] = im;
      });

    // ---- input --------------------------------------------------------------
    this.keys = {};
    this.pointer = { x: 0, y: 0, down: false };
    this._onKeyDown = (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key === 'Escape') this.togglePause();
      if (e.key.toLowerCase() === 'm') this.toggleMute();
    };
    this._onKeyUp = (e) => { this.keys[e.key.toLowerCase()] = false; };
    this._onPointer = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.x = (e.clientX - r.left) / r.width * VW;
      this.pointer.y = (e.clientY - r.top) / r.height * VH;
    };
    this._onDown = (e) => {
      this.pointer.down = true; this._onPointer(e); this.audio.resume();
      // autoplay is blocked until a user gesture — re-apply the wanted track now
      if (this.music && this._musicState) this.music.setState(this._musicState);
    };
    this._onUp = () => { this.pointer.down = false; };
    this._onBlur = () => { if (this.run && !this.run.over && !this.paused && !this.drafting) this.setPause(true); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.canvas.addEventListener('pointermove', this._onPointer);
    this.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointerup', this._onUp);

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

    // ---- loop ---------------------------------------------------------------
    this.paused = false;
    this.drafting = false;
    this.run = null;
    this.toasts = [];
    this.lastT = performance.now();
    this._tick = (now) => {
      if (this.destroyed) return;
      let dt = (now - this.lastT) / 1000;
      this.lastT = now;
      dt = Math.min(dt, 0.1);
      if (this.run && !this.paused && !this.drafting && !this.run.over) {
        let steps = 0;
        this.acc = (this.acc || 0) + dt;
        while (this.acc >= 1 / 60 && steps < 5) { this.update(1 / 60); this.acc -= 1 / 60; steps++; }
        if (steps >= 5) this.acc = 0;
      }
      this.render();
      requestAnimationFrame(this._tick);
    };
    requestAnimationFrame(this._tick);

    // ---- boot ---------------------------------------------------------------
    this.rngSeed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    if (this.showShell) this.screenTitle();
    else this.startRun(opts.stageId || C.STAGES[0].id, this.rngSeed);

    this.emit('ready', { version: VERSION });
  }

  Instance.prototype.emit = function (t, p) { try { this.onEvent(t, p || {}); } catch (e) { console.error(e); } };

  Instance.prototype.setMusic = function (track) {
    this._musicState = track;
    if (this.music) this.music.setState(track);
  };

  Instance.prototype.destroy = function () {
    this.destroyed = true;
    if (this.music) this.music.stop();
    if (this._quizCleanup) { this._quizCleanup(); this._quizCleanup = null; }
    if (this._quizReveal) { clearTimeout(this._quizReveal); this._quizReveal = null; }
    if (this._quizCleanup) { this._quizCleanup(); this._quizCleanup = null; }
    if (this._quizReveal) { clearTimeout(this._quizReveal); this._quizReveal = null; }
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pointerup', this._onUp);
    if (this._ro) this._ro.disconnect();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  Instance.prototype.toggleMute = function () {
    const m = this.audio.toggle();
    this.toast(m ? '🔇' : '🔊', m ? 'Muted' : 'Sound on', '');
  };

  // ===========================================================================
  // SCREENS (DOM)
  // ===========================================================================
  Instance.prototype.clearUI = function () {
    // a quiz may own a timer + a window keydown listener; never leak them
    if (this._quizCleanup) { this._quizCleanup(); this._quizCleanup = null; }
    if (this._quizReveal) { clearTimeout(this._quizReveal); this._quizReveal = null; }
    this.ui.innerHTML = '';
  };

  Instance.prototype.corner = function () {
    return `<div class="wh-corner">
      <button class="wh-icnbtn" data-act="mute" title="Mute (M)">${this.audio.muted ? '🔇' : '🔊'}</button>
    </div>`;
  };

  Instance.prototype.screenTitle = function () {
    const m = this.meta;
    this.run = null;
    this.setMusic('menu');
    this.clearUI();
    const tip = C.TIPS[(Math.random() * C.TIPS.length) | 0];
    const el = document.createElement('div');
    el.className = 'wh-screen';
    el.innerHTML = `
      ${this.corner()}
      <img class="wh-hero" src="${this.assetBase}costbot.png" alt="CostBot">
      <h1 class="wh-title">CostBot: Waste Hunter</h1>
      <p class="wh-sub">Terminate the waste. Bank the savings. Repeat.</p>
      <div class="wh-row" style="margin-top:30px">
        <button class="wh-btn primary" data-act="play">▶  Play</button>
        <button class="wh-btn" data-act="how">📖  How to Play</button>
        <button class="wh-btn" data-act="bay">🛠️  Bot Bay</button>
        <button class="wh-btn" data-act="achs">🏆  Achievements</button>
      </div>
      <div class="wh-row" style="margin-top:20px;font-size:13.5px;color:#93a4c4">
        <span><img class="wh-coin" src="../shared/assets/token-coin-64.png" alt=""><b style="color:#ffd76b">${wallet().tokens.toLocaleString()}</b> tokens</span>
        <span>·</span><span>🎮 ${m.runs} runs</span>
        <span>·</span><span>📈 ${money(m.lifetimeDollars)} lifetime saved</span>
      </div>
      <div class="wh-themes">${this.themeChips()}</div>
      <p class="wh-tip">💡 ${esc(tip)}</p>
      <div class="wh-seed">v${VERSION} &nbsp;·&nbsp; <span class="wh-kbd">WASD</span> move &nbsp;
        <span class="wh-kbd">Esc</span> pause &nbsp; <span class="wh-kbd">M</span> mute</div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const th = e.target.closest('[data-theme]');
      if (th) { this.audio.resume(); this.setTheme(th.dataset.theme); this.screenTitle(); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      this.audio.resume();
      const act = a.dataset.act;
      if (act === 'play') this.screenStages();
      else if (act === 'how') this.screenBriefing();
      else if (act === 'bay') this.screenBay();
      else if (act === 'achs') this.screenAchievements();
      else if (act === 'mute') { this.toggleMute(); this.screenTitle(); }
    });
  };

  // ===========================================================================
  // HOW TO PLAY — prose lives in C.BRIEFING; the bestiary and the pickup list are
  // generated from the balance data, so the screen cannot drift from the game.
  // ===========================================================================
  function bestiaryCard(def, isBoss) {
    const traits = Object.keys(C.BRIEFING.traits)
      .filter((k) => def[k])
      .map((k) => `<span class="wh-tag">${esc(C.BRIEFING.traits[k])}</span>`);
    if (isBoss && def.spawns) {
      const spawn = C.ENEMIES[def.spawns.type];
      if (spawn) traits.push(`<span class="wh-tag">Summons ${esc(spawn.name)}</span>`);
    }
    if (isBoss && def.radial) traits.push('<span class="wh-tag">Bullet rings</span>');
    return `<div class="wh-be${isBoss ? ' boss' : ''}">
      <span class="g" style="border-color:${def.accent};background:${def.color}33;
        color:${def.accent}">${def.glyph}</span>
      <div>
        <div class="n" style="color:${def.accent}">${esc(def.name)}</div>
        <div class="b">${esc(def.blurb || def.tagline || '')}</div>
        <div class="s"><span><b>${def.hp.toLocaleString()}</b> HP</span>
          <span>·</span><span>drops <b>${moneyExact(def.value)}</b></span>
          ${traits.join('')}</div>
      </div>
    </div>`;
  }

  Instance.prototype.screenBriefing = function () {
    const B = C.BRIEFING;
    this.clearUI();
    const el = document.createElement('div');
    el.className = 'wh-screen';

    const steps = B.loop.map((s) => `<div class="wh-step"><span class="ic">${s.icon}</span>
      <div><div class="n">${esc(s.label)}</div><div class="d">${esc(s.note)}</div></div></div>`).join('');

    // weakest first, so the list reads as an escalation
    const mobs = Object.keys(C.ENEMIES)
      .sort((a, b) => C.ENEMIES[a].value - C.ENEMIES[b].value)
      .map((k) => bestiaryCard(C.ENEMIES[k], false)).join('');
    const bosses = Object.keys(C.BOSSES)
      .sort((a, b) => C.BOSSES[a].value - C.BOSSES[b].value)
      .map((k) => bestiaryCard(C.BOSSES[k], true)).join('');

    const pickups = Object.keys(C.PICKUPS).map((k) => {
      const p = C.PICKUPS[k];
      const what = p.heal ? `restores ${p.heal} HP`
        : p.dmg ? `${p.dmg} damage to everything on screen`
          : 'pulls every orb on the floor to you';
      return `<div class="wh-step"><span class="ic">${p.icon}</span>
        <div><div class="n">${esc(p.name)}</div>
        <div class="d">${what} · drops from about ${(p.chance * 100).toFixed(1)}% of kills</div></div></div>`;
    }).join('');

    const T = C.TRIVIA_RULES;
    el.innerHTML = `
      ${this.corner()}
      <div class="wh-scroll">
        <h2 style="font-size:30px;margin:0">📖 How to Play</h2>
        <p class="wh-sub">Terminate the waste. Bank the savings. Repeat.</p>
        <div class="wh-brief">
          <section>
            <h4>Why you are down here</h4>
            ${B.story.map((p) => `<p>${esc(p)}</p>`).join('')}
          </section>
          <section>
            <h4>How a run works</h4>
            ${steps}
            <p class="wh-fine">Stages run <b>${mmss(C.STAGES[0].duration)}</b>. A correct quiz answer
               pays <b>${moneyExact(T.correctBonus)}</b>, rising to <b>×${T.streakCap}</b> on a streak${
      T.timeLimit ? `, on a <b>${T.timeLimit}s</b> timer` : ' — and there is no timer, so think it through'}.
               Tokens banked = dollars ÷ 1,000, <b>×1.5</b> if you clear.</p>
          </section>
          <section>
            <h4>Bestiary — ${Object.keys(C.ENEMIES).length} kinds of waste</h4>
            <div class="wh-best">${mobs}</div>
            <p class="wh-fine">Everything drops what it was costing you. The Anomaly is worth
               <b>${moneyExact(C.ENEMIES.anomaly.value)}</b> and will run from you — chase it.</p>
          </section>
          <section>
            <h4>Bosses</h4>
            <div class="wh-best">${bosses}</div>
            <p class="wh-fine">One waits at the end of every stage. Kill it to clear.</p>
          </section>
          <section>
            <h4>Pickups</h4>
            ${pickups}
          </section>
          <section>
            <h4>Controls</h4>
            <p><span class="wh-kbd">WASD</span> or <span class="wh-kbd">↑←↓→</span> to move —
               or just hold the mouse button and steer. <span class="wh-kbd">Esc</span> pause,
               <span class="wh-kbd">M</span> mute. On a quiz, <span class="wh-kbd">1</span>–<span
               class="wh-kbd">4</span> or <span class="wh-kbd">A</span>–<span class="wh-kbd">D</span>.</p>
          </section>
        </div>
        <div class="wh-row" style="margin-top:22px">
          <button class="wh-btn primary" data-act="play">▶  Play</button>
          <button class="wh-btn ghost" data-act="back">← Back</button>
        </div>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      this.audio.resume();
      if (a.dataset.act === 'play') this.screenStages();
      else if (a.dataset.act === 'back') this.screenTitle();
      else if (a.dataset.act === 'mute') { this.toggleMute(); this.screenBriefing(); }
    });
  };

  // Theme = soundtrack + biome. Chips on the title screen so the pairing can be
  // auditioned without editing code.
  // 'mudslide' is Mudslides' own theme and stays in the shared engine for it —
  // it just does not belong in this cabinet's picker.
  const THEMES_HIDDEN = ['mudslide'];

  Instance.prototype.themeChips = function () {
    const MUSIC = global.ArcadeMusic || global.WHMusic;
    if (!MUSIC) return '';
    const active = this.meta.theme || 'synthwave';
    return '<span style="font-size:12px;color:#7e8fae;margin-right:2px">THEME</span>' +
      Object.entries(MUSIC.THEMES)
        .filter(([id]) => !THEMES_HIDDEN.includes(id))
        .map(([id, t]) => {
          const bio = global.ArcadeBiomes && global.ArcadeBiomes.get(t.biome);
          return `<button class="wh-chip ${id === active ? 'on' : ''}" data-theme="${id}">
            ${esc(t.label || id)}<small>${esc(bio ? bio.name : '')}</small></button>`;
        }).join('');
  };

  Instance.prototype.setTheme = function (id) {
    this.meta.theme = id;
    saveMeta(this.meta, this.persist);
    if (this.music) this.music.setTheme(id);
    if (this.run) this.run.bio = this.biome(this.run.stage);
  };

  Instance.prototype.stageUnlocked = function (i) {
    if (i === 0) return true;
    return !!this.meta.cleared[C.STAGES[i - 1].id];
  };

  Instance.prototype.screenStages = function () {
    this.clearUI();
    const cards = C.STAGES.map((s, i) => {
      const unlocked = this.stageUnlocked(i);
      const best = this.meta.best[s.id];
      const cleared = this.meta.cleared[s.id];
      return `<div class="wh-card ${unlocked ? '' : 'locked'}" data-stage="${s.id}" data-ok="${unlocked ? 1 : 0}">
        <span class="wh-badge ${cleared ? 'clear' : ''}">${cleared ? '✓ CLEARED' : unlocked ? mmss(s.duration) : '🔒 LOCKED'}</span>
        <img src="${this.assetBase}${s.art}" alt="">
        <div class="wh-card-b">
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.subtitle)}</p>
          ${best ? `<div class="wh-best">Best: ${money(best)}</div>` : '<div class="wh-best">&nbsp;</div>'}
        </div>
      </div>`;
    }).join('');
    const el = document.createElement('div');
    el.className = 'wh-screen';
    el.innerHTML = `
      ${this.corner()}
      <h2 style="font-size:32px;margin:0 0 2px">Select Contract</h2>
      <p class="wh-sub">Each run is one stage. Survive the clock, then kill the boss.</p>
      <div class="wh-stages">${cards}</div>
      <div class="wh-row" style="margin-top:18px">
        <button class="wh-btn ghost" data-act="back">← Back</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const card = e.target.closest('[data-stage]');
      if (card) {
        if (card.dataset.ok !== '1') return;
        this.audio.resume();
        this.startRun(card.dataset.stage, (Math.random() * 1e9) | 0);
        return;
      }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'back') this.screenTitle();
      else if (a.dataset.act === 'mute') { this.toggleMute(); this.screenStages(); }
    });
  };

  // Preset banking amounts. Small enough that a first-timer can give something,
  // large enough that a stacked balance does not need twenty clicks.
  const BANK_STEPS = [250, 1000, 5000];

  Instance.prototype.screenBay = function () {
    const m = this.meta;
    this.clearUI();
    // The purse is the ARCADE wallet, never `m.tokens`. That field is a dead
    // pre-wallet ledger: the shared wallet folds it in once and zeroes it at the
    // source, and nothing credits it again, so gating on it disabled every
    // button in here while the header showed a real balance.
    const have = wallet().tokens;
    const items = Object.entries(C.META_UPGRADES).map(([id, u]) => {
      const lvl = m.upgrades[id] || 0;
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const pips = Array.from({ length: u.max }, (_, i) => `<div class="pip ${i < lvl ? 'on' : ''}"></div>`).join('');
      return `<div class="wh-item">
        <div class="t">${u.icon} ${esc(u.name)}</div>
        <div class="d">${esc(u.blurb(lvl + (maxed ? 0 : 1)))}</div>
        <div class="pips">${pips}</div>
        <button class="wh-buy" data-buy="${id}" ${maxed || have < cost ? 'disabled' : ''}>
          ${maxed ? 'MAXED' : '<img class="wh-coin" src="../shared/assets/token-coin-64.png" alt="">' + cost.toLocaleString()}</button>
      </div>`;
    }).join('');
    const el = document.createElement('div');
    el.className = 'wh-screen';
    el.innerHTML = `<div class="wh-scroll">
      <h2 style="font-size:30px;margin:0">🛠️ Bot Bay</h2>
      <p class="wh-sub">Spend tokens on yourself, or bank them for CostBot. Not both.</p>
      <div style="font-size:19px;margin-top:12px"><img class="wh-coin lg" src="../shared/assets/token-coin-64.png" alt=""><b style="color:#ffd76b">${wallet().tokens.toLocaleString()}</b> AI tokens on hand</div>
      <div class="wh-bank">
        <div class="wh-bank-t">🤖 CostBot's build fund</div>
        <div class="wh-bank-d">Banked tokens leave your balance for good and go to the
          arcade's fund — every 10,000 banked ships another product.
          You have banked <b>${(m.banked || 0).toLocaleString()}</b> so far.</div>
        <div class="wh-bank-row">
          ${BANK_STEPS.map((n) => `<button class="wh-bankbtn" data-bank="${n}"
            ${have < n ? 'disabled' : ''}>🏦 ${n.toLocaleString()}</button>`).join('')}
          <button class="wh-bankbtn all" data-bank="all" ${have < 1 ? 'disabled' : ''}>
            🏦 Bank all</button>
        </div>
      </div>
      <div class="wh-shop">${items}</div>
      <button class="wh-btn ghost" data-act="back">← Back</button>
    </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const bank = e.target.closest('[data-bank]');
      if (bank) {
        // Re-read rather than reuse `have` — another tab may have spent since render.
        const onHand = wallet().tokens;
        const want = bank.dataset.bank === 'all' ? onHand : Number(bank.dataset.bank);
        const give = Math.min(onHand, want);
        if (give > 0) {
          if (!wallet().spend(give)) return;
          m.banked = (m.banked || 0) + give;
          saveMeta(m, this.persist);
          this.audio.coin();
          if (m.banked >= 10000) this.unlock('banker');
          this.screenBay();
        }
        return;
      }
      const b = e.target.closest('[data-buy]');
      if (b) {
        const id = b.dataset.buy, u = C.META_UPGRADES[id];
        const lvl = m.upgrades[id] || 0;
        const cost = u.cost(lvl);
        if (lvl < u.max && wallet().tokens >= cost) {
          if (!wallet().spend(cost)) return;
          m.upgrades[id] = lvl + 1;
          saveMeta(m, this.persist); this.audio.coin(); this.screenBay();
        }
        return;
      }
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'back') this.screenTitle();
    });
  };

  Instance.prototype.screenAchievements = function () {
    const m = this.meta;
    this.clearUI();
    const got = Object.keys(m.achievements).length;
    const list = C.ACHIEVEMENTS.map((a) => `
      <div class="wh-ach ${m.achievements[a.id] ? 'on' : ''}">
        <div class="ic">${m.achievements[a.id] ? a.icon : '🔒'}</div>
        <div><div class="n">${esc(a.name)}</div><div class="d">${esc(a.desc)}</div></div>
      </div>`).join('');
    const el = document.createElement('div');
    el.className = 'wh-screen';
    el.innerHTML = `<div class="wh-scroll">
      <h2 style="font-size:30px;margin:0">🏆 Achievements</h2>
      <p class="wh-sub">${got} / ${C.ACHIEVEMENTS.length} unlocked</p>
      <div class="wh-achs" style="margin:18px 0">${list}</div>
      <button class="wh-btn ghost" data-act="back">← Back</button>
    </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'back') this.screenTitle();
    });
  };

  // ===========================================================================
  // RUN LIFECYCLE
  // ===========================================================================
  // A theme pairs a soundtrack with a biome (see arcade-biomes.js); the stage's
  // own colours are the fallback when neither shared module is loaded.
  Instance.prototype.biome = function (stage) {
    const MUSIC = global.ArcadeMusic || global.WHMusic;
    const t = MUSIC && MUSIC.THEMES[this.meta.theme || 'synthwave'];
    if (global.ArcadeBiomes && t) return global.ArcadeBiomes.get(t.biome);
    return { floor: stage.floor, grid: stage.grid, fog: stage.fog,
             sky: null, props: 'racks', propAlpha: 0.55, density: 78 };
  };

  Instance.prototype.startRun = function (stageId, seed) {
    const stage = C.STAGES.find((s) => s.id === stageId) || C.STAGES[0];
    const rnd = mulberry32(seed);
    const up = this.meta.upgrades || {};

    const p = {
      x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0,
      hp: 0, maxHp: C.PLAYER.maxHp, speed: C.PLAYER.speed,
      pickupRadius: C.PLAYER.pickupRadius, radius: C.PLAYER.radius,
      dmgMult: 1, cdMult: 1, goldMult: 1, dr: 1,
      face: 1, hitT: 0, invT: 0,
      level: 1, xp: 0, xpNext: C.XP.forLevel(1),
      weapons: { rightsizer: 1 }, passives: {},
    };
    // permanent meta upgrades
    Object.entries(C.META_UPGRADES).forEach(([id, u]) => {
      const l = up[id] || 0; if (l > 0) u.apply(p, l);
    });
    p.hp = p.maxHp;

    this.run = {
      stage, seed, rnd, p,
      t: 0, over: false, outcome: null,
      enemies: [], bullets: [], ebullets: [], orbs: [], pickups: [],
      fx: [], floaters: [], zones: [], drones: [],
      cam: { x: 0, y: 0, shake: 0 },
      spawnAcc: 0, eliteT: 0,
      boss: null, bossQueued: false, bossHitless: true,
      dollars: 0, kills: 0, killsByType: {}, combo: 0, comboT: 0,
      cooldowns: {}, orbAngle: 0, scanAngle: 0,
      stats: { anomalies: 0, ebs: 0, hits: 0, quizCorrect: 0, quizWrong: 0 },
      unlocked: [],
      bannerT: 0, bannerText: '', bannerSub: '',
      startedAt: Date.now(),
      props: [],
    };
    // scenery for the active biome, so the floor reads as a place not a void
    this.run.bio = this.biome(stage);
    this.run.props = global.ArcadeBiomes
      ? global.ArcadeBiomes.generate(rnd, WORLD_W, WORLD_H, this.run.bio)
      : [];
    // warm start
    const warm = up.headstart || 0;
    for (let i = 0; i < warm; i++) this.levelUpImmediate();

    this.paused = false; this.drafting = false;
    this.setMusic('stage');
    this.clearUI();
    this.banner(stage.name, stage.subtitle, 3);
    this.emit('run:start', { stageId: stage.id, seed });
  };

  Instance.prototype.banner = function (text, sub, dur) {
    this.run.bannerText = text; this.run.bannerSub = sub || '';
    this.run.bannerT = dur || 2.5;
  };

  Instance.prototype.endRun = function (outcome) {
    const r = this.run;
    if (r.over) return;
    r.over = true; r.outcome = outcome;

    const m = this.meta;
    const interest = 1 + 0.08 * (m.upgrades.interest || 0);
    const clearBonus = outcome === 'clear' ? 1.5 : 1;
    // $425 saved = 1 token. History: $1,000 -> $500 on measurement -> $250 to
    // make a cleared run pay "three minutes of work". But $250 measured out to
    // ~170 tokens/min for a middling clear (a mid-run ~$80K in kill/quiz
    // dollars against the XP curve in wh-content.js, not the ~$147K "maxed
    // pace" figure in that file's own comment) — 1.7x the ~100/min every other
    // cabinet now targets. $425 lands the same run at ~100/min.
    const tokens = Math.round((r.dollars / 425) * interest * clearBonus);

    // The spendable balance lives in the shared arcade wallet, NOT in `m.tokens`
    // — that field predates the wallet and is dead (see screenBay). `m` keeps
    // only the records: `lifetimeTokens` never goes down and says what you
    // earned; `banked` is what you gave CostBot's build fund instead of spending
    // on yourself, and that is the only one the fund counts.
    wallet().earn(tokens, 'waste-hunter');
    m.lifetimeTokens += tokens;
    m.lifetimeDollars += r.dollars;
    m.runs += 1;
    if (!m.best[r.stage.id] || r.dollars > m.best[r.stage.id]) m.best[r.stage.id] = Math.round(r.dollars);
    if (outcome === 'clear') m.cleared[r.stage.id] = true;

    // end-of-run achievements
    if (r.dollars >= 10000) this.unlock('savings_10k');
    if (r.dollars >= 100000) this.unlock('savings_100k');
    if (r.dollars >= 1000000) this.unlock('savings_1m');
    if (m.lifetimeTokens >= 100000) this.unlock('bank_100k');
    if (outcome === 'clear') {
      this.unlock('clear_' + r.stage.id);
      if (!r.p.passives.auto_scaling) this.unlock('turtle');
      if (r.p.hp / r.p.maxHp < 0.15) this.unlock('still_did_it');
      if (r.stats.quizWrong === 0 && r.stats.quizCorrect > 0) this.unlock('quiz_perfect');
    }
    saveMeta(m, this.persist);

    outcome === 'clear' ? this.audio.win() : this.audio.lose();

    const result = {
      outcome, stageId: r.stage.id, seed: r.seed,
      dollarsSaved: Math.round(r.dollars), tokensEarned: tokens,
      timeSurvived: Math.round(r.t), kills: r.kills,
      killsByType: Object.assign({}, r.killsByType), level: r.p.level,
      quizCorrect: r.stats.quizCorrect, quizWrong: r.stats.quizWrong,
      weapons: Object.entries(r.p.weapons).map(([k, v]) => ({ id: k, name: C.WEAPONS[k].name, level: v })),
      achievementsUnlocked: r.unlocked.slice(),
      meta: this.meta,
    };
    this.lastResult = result;
    this.emit('run:end', result);
    this.onComplete(result);
    this.screenResult(result);
  };

  // What did you actually kill? The single kill count says "482" and means
  // nothing; the breakdown is the part that reads like a FinOps win report.
  function killBreakdown(res) {
    return Object.keys(res.killsByType || {})
      .map((id) => ({ def: C.ENEMIES[id] || C.BOSSES[id], n: res.killsByType[id] }))
      .filter((x) => x.def)
      .sort((a, b) => b.n - a.n)
      .map((x) => `<div class="wh-kill"><span>${x.def.glyph} ${esc(x.def.name)}</span>` +
                  `<b>${x.n.toLocaleString()}</b></div>`)
      .join('');
  }

  // Never the same picture twice running. Pure random over a small pool repeats
  // often enough that it reads as "no rotation at all" — which is exactly how it
  // looked before there was any.
  const lastArt = {};
  function pickArt(pool) {
    const list = C.END_ART[pool] || C.END_ART.loss;
    if (list.length === 1) return list[0];
    const choices = list.filter((n) => n !== lastArt[pool]);
    const pick = choices[(Math.random() * choices.length) | 0];
    lastArt[pool] = pick;
    return pick;
  }

  Instance.prototype.pickArt = (pool) => pickArt(pool);   // exposed for the suite

  Instance.prototype.screenResult = function (res) {
    const r = this.run, win = res.outcome === 'clear';
    const kills = killBreakdown(res);
    this.setMusic('menu');
    const art = pickArt(win
      ? (r.p.hp / r.p.maxHp < 0.15 ? 'narrow' : 'win')
      : 'loss');
    this.clearUI();
    const el = document.createElement('div');
    el.className = 'wh-screen wh-result';
    el.innerHTML = `
      <div class="wh-scroll">
      <img class="wh-hero" style="animation:none;width:132px;height:132px;border-radius:14px;object-fit:cover"
           src="${this.assetBase}${art}.png" alt="">
      <h2 style="font-size:34px;margin:14px 0 2px;color:${win ? '#6ee7a0' : '#ff8a8a'}">
        ${win ? 'STAGE CLEARED' : 'CHASSIS DESTROYED'}</h2>
      <p class="wh-sub" style="margin-bottom:14px">${esc(r.stage.name)}</p>
      <div class="wh-panel">
        <div style="text-align:center;font-size:12.5px;color:#93a4c4;letter-spacing:1.2px">SAVINGS REALIZED</div>
        <div class="wh-big">${moneyExact(res.dollarsSaved)}</div>
        <div class="wh-stat"><span>⏱️ Time survived</span><b>${mmss(res.timeSurvived)}</b></div>
        <div class="wh-stat${kills ? ' nb' : ''}"><span>💀 Resources terminated</span><b>${res.kills.toLocaleString()}</b></div>
        ${kills ? `<div class="wh-kills">${kills}</div>` : ''}
        <div class="wh-stat"><span>⭐ Level reached</span><b>${res.level}</b></div>
        <div class="wh-stat"><span>🎓 Quiz answers</span><b>${res.quizCorrect} / ${res.quizCorrect + res.quizWrong}${
          res.quizWrong === 0 && res.quizCorrect > 0 ? ' <span style="color:#6ee7a0">perfect</span>' : ''}</b></div>
        <div class="wh-stat"><span><img class="wh-coin" src="../shared/assets/token-coin-64.png" alt="">AI tokens banked${win ? ' <span style="color:#6ee7a0">(×1.5 clear bonus)</span>' : ''}</span>
          <b>+${res.tokensEarned.toLocaleString()}</b></div>
        ${res.achievementsUnlocked.length ? `<div class="wh-stat"><span>🏆 New achievements</span><b>${res.achievementsUnlocked.length}</b></div>` : ''}
      </div>
      </div>
      <div class="wh-row" style="margin-top:20px">
<button class="wh-btn primary" data-act="again">↻  Run Again</button>
        ${this.showShell ? '<button class="wh-btn" data-act="stages">📋  Contracts</button>' : ''}
        <button class="wh-btn ghost" data-act="exit">${esc(this.showShell ? 'Main Menu' : this.returnLabel)}</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'again') this.startRun(r.stage.id, (Math.random() * 1e9) | 0);
      else if (act === 'stages') this.screenStages();
      else if (act === 'exit') {
        if (this.showShell) this.screenTitle();
        else { this.clearUI(); this.emit('exit', this.lastResult); }
      }
    });
  };

  // ===========================================================================
  // PAUSE
  // ===========================================================================
  Instance.prototype.togglePause = function () {
    if (!this.run || this.run.over || this.drafting) return;
    this.setPause(!this.paused);
  };
  Instance.prototype.setPause = function (on) {
    this.paused = on;
    if (!on) { this.clearUI(); return; }
    const r = this.run;
    const wl = Object.entries(r.p.weapons).map(([k, v]) =>
      `<div class="wh-stat"><span>${C.WEAPONS[k].icon} ${C.WEAPONS[k].name}</span><b>Lv ${v}</b></div>`).join('');
    const pl = Object.entries(r.p.passives).map(([k, v]) =>
      `<div class="wh-stat"><span>${C.PASSIVES[k].icon} ${C.PASSIVES[k].name}</span><b>Lv ${v}</b></div>`).join('');
    const el = document.createElement('div');
    el.className = 'wh-screen';
    el.innerHTML = `
      <h2 style="font-size:32px;margin:0 0 14px">⏸️ Paused</h2>
      <div class="wh-panel" style="min-width:400px">
        <div style="font-size:12px;color:#93a4c4;letter-spacing:1px;margin-bottom:6px">LOADOUT</div>
        ${wl}${pl || ''}
      </div>
      <div class="wh-row" style="margin-top:18px">
        <button class="wh-btn primary" data-act="resume">▶ Resume</button>
        <button class="wh-btn ghost" data-act="quit">Abandon Run</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'resume') this.setPause(false);
      else { this.paused = false; this.endRun('quit'); }
    });
  };

  // ===========================================================================
  // ACHIEVEMENTS / TOASTS
  // ===========================================================================
  Instance.prototype.unlock = function (id) {
    if (this.meta.achievements[id]) return;
    const a = C.ACHIEVEMENTS.find((x) => x.id === id); if (!a) return;
    this.meta.achievements[id] = Date.now();
    saveMeta(this.meta, this.persist);
    if (this.run) this.run.unlocked.push(id);
    this.toast(a.icon, a.name, a.desc);
    this.audio.ach();
    this.emit('run:achievement', { id, name: a.name });
  };

  Instance.prototype.toast = function (icon, name, desc) {
    let box = this.root.querySelector('.wh-toasts');
    if (!box) {
      box = document.createElement('div'); box.className = 'wh-toasts';
      this.ui.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'wh-toast';
    t.innerHTML = `<div class="ic">${icon}</div><div><div class="n">${esc(name)}</div>
      ${desc ? `<div class="d">${esc(desc)}</div>` : ''}</div>`;
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .4s,transform .4s';
      t.style.opacity = '0'; t.style.transform = 'translateX(50px)';
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 420);
    }, 3600);
  };

  // ===========================================================================
  // LEVEL UP / DRAFT
  // ===========================================================================
  Instance.prototype.levelUpImmediate = function () {
    const p = this.run.p;
    p.level++; p.xp -= p.xpNext; if (p.xp < 0) p.xp = 0;
    p.xpNext = C.XP.forLevel(p.level);
  };

  Instance.prototype.rollDraft = function () {
    const r = this.run, p = r.p, pool = [];
    const wCount = Object.keys(p.weapons).length;
    Object.entries(C.WEAPONS).forEach(([id, w]) => {
      const lvl = p.weapons[id] || 0;
      if (lvl === 0) { if (wCount < 6) pool.push({ kind: 'weapon', id, w, lvl: 0, weight: 10 }); }
      else if (lvl < w.levels.length) pool.push({ kind: 'weapon', id, w, lvl, weight: 16 });
    });
    Object.entries(C.PASSIVES).forEach(([id, ps]) => {
      const lvl = p.passives[id] || 0;
      if (lvl < ps.max) pool.push({ kind: 'passive', id, w: ps, lvl, weight: lvl === 0 ? 9 : 13 });
    });
    const picks = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const total = pool.reduce((a, x) => a + x.weight, 0);
      let roll = r.rnd() * total, idx = 0;
      for (let j = 0; j < pool.length; j++) { roll -= pool[j].weight; if (roll <= 0) { idx = j; break; } }
      picks.push(pool.splice(idx, 1)[0]);
    }
    return picks;
  };

  Instance.prototype.showDraft = function () {
    const r = this.run;
    const picks = this.rollDraft();
    if (!picks.length) { this.drafting = false; return; }
    this.drafting = true;
    this.audio.level();
    this.emit('run:levelup', { level: r.p.level, options: picks.map((x) => x.id) });

    const arts = ['lightbulb_moment', 'savings_found', 'automation_wizard'];
    const art = arts[(r.p.level - 1) % arts.length];

    const cards = picks.map((pk, i) => {
      const isNew = pk.lvl === 0;
      const note = pk.kind === 'weapon' ? pk.w.levels[pk.lvl].note : pk.w.blurb;
      return `<div class="wh-pick" data-i="${i}">
        <div class="ic">${pk.w.icon}</div>
        <div class="lv ${isNew ? 'new' : ''}">${isNew ? (pk.kind === 'weapon' ? '★ New Weapon' : '★ New Passive') : 'Level ' + (pk.lvl + 1)}</div>
        <div class="nm">${esc(pk.w.name)}</div>
        <div class="nt">${esc(isNew && pk.kind === 'weapon' ? pk.w.blurb : note)}</div>
        <div class="ft">${esc(pk.w.fact)}</div>
      </div>`;
    }).join('');

    const el = document.createElement('div');
    el.className = 'wh-draft';
    el.innerHTML = `
      <img src="${this.assetBase}${art}.png" style="width:104px;height:104px;object-fit:cover;border-radius:12px;
        margin-bottom:10px;box-shadow:0 10px 30px rgba(0,0,0,.5)" alt="">
      <h2>LEVEL ${r.p.level}</h2>
      <p class="wh-sub">Choose an optimization</p>
      <div class="wh-picks">${cards}</div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-i]'); if (!c) return;
      this.clearUI();
      this.showTrivia(picks[+c.dataset.i]);
    });
  };

  // Called once a level-up is fully resolved (upgrade claimed or forfeited).
  Instance.prototype.finishDraft = function () {
    const r = this.run;
    this.clearUI();
    this.drafting = false;
    if (!r || r.over) return;
    // queue another draft if we levelled again during the pause
    if (r.p.xp >= r.p.xpNext) { this.levelUpImmediate(); this.showDraft(); }
  };

  // ===========================================================================
  // TRIVIA — you must answer correctly to claim the upgrade you picked
  // ===========================================================================
  // Stable id for a question, so "already seen" survives edits to the bank
  // (array indices shift whenever questions are added).
  function qKey(q) {
    let h = 0;
    for (let i = 0; i < q.q.length; i++) h = (h * 31 + q.q.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  Instance.prototype.pickQuestion = function (topic) {
    const r = this.run;
    r.asked = r.asked || new Set();
    if (!this.meta.seenQuestions) this.meta.seenQuestions = {};
    const seen = this.meta.seenQuestions;
    const indexed = C.TRIVIA.map((q, i) => ({ q, i, k: qKey(q) }));
    const fresh = indexed.filter((x) => !r.asked.has(x.i));

    // Prefer on-topic questions never asked in ANY run, then on-topic repeats,
    // then anything unseen. This is what stops the bank feeling repetitive.
    const tiers = [
      fresh.filter((x) => x.q.topic === topic && !seen[x.k]),
      fresh.filter((x) => x.q.topic === topic),
      fresh.filter((x) => !seen[x.k]),
      fresh,
      indexed,
    ];
    const pool = tiers.find((t) => t.length) || indexed;
    const sel = pool[(r.rnd() * pool.length) | 0];
    r.asked.add(sel.i);
    seen[sel.k] = (seen[sel.k] || 0) + 1;
    return sel.q;
  };

  Instance.prototype.showTrivia = function (pick) {
    const self = this, r = this.run, R = C.TRIVIA_RULES;
    const q = this.pickQuestion(pick.w.topic);

    // shuffle the choices so answer position is never memorable
    const order = q.c.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (r.rnd() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const correctPos = order.indexOf(q.a);

    // FinOps Certification strikes wrong answers off the board
    const strikes = Math.min(
      this.meta.upgrades.study || 0,
      Math.max(0, order.length - 2)
    );
    const struck = new Set();
    const wrongPositions = order.map((_, i) => i).filter((i) => i !== correctPos);
    for (let i = 0; i < strikes && wrongPositions.length; i++) {
      struck.add(wrongPositions.splice((r.rnd() * wrongPositions.length) | 0, 1)[0]);
    }

    const prizeLabel = pick.lvl === 0
      ? `${pick.w.icon} ${pick.w.name}`
      : `${pick.w.icon} ${pick.w.name} Lv ${pick.lvl + 1}`;
    const letters = ['A', 'B', 'C', 'D'];

    const el = document.createElement('div');
    el.className = 'wh-draft';
    el.innerHTML = `
      <div class="wh-quiz">
        <div class="wh-quiz-head">
          <span class="wh-quiz-tag">🎓 AWS SAVINGS CHECK</span>
          <span class="wh-quiz-prize">${prizeLabel}</span>
        </div>
        <div class="wh-quiz-timer"><i style="width:100%"></i></div>
        <h3 class="wh-quiz-q">${esc(q.q)}</h3>
        <div class="wh-quiz-choices">
          ${order.map((orig, pos) => `
            <button class="wh-choice ${struck.has(pos) ? 'struck' : ''}" data-p="${pos}"
                    ${struck.has(pos) ? 'disabled' : ''}>
              <b>${letters[pos]}</b><span>${esc(q.c[orig])}</span>
            </button>`).join('')}
        </div>
        <div class="wh-quiz-foot">${R.mode === 'gate'
          ? 'Answer correctly to claim the upgrade.'
          : 'A correct answer pays a knowledge bonus.'}</div>
      </div>`;
    this.ui.appendChild(el);

    const bar = el.querySelector('.wh-quiz-timer i');
    const barBox = el.querySelector('.wh-quiz-timer');
    let remaining = R.timeLimit;
    let resolved = false;

    if (R.timeLimit > 0) {
      const started = performance.now();
      this._quizTimer = setInterval(() => {
        remaining = R.timeLimit - (performance.now() - started) / 1000;
        const frac = clamp(remaining / R.timeLimit, 0, 1);
        bar.style.width = (frac * 100) + '%';
        barBox.classList.toggle('low', frac < 0.34);
        if (remaining <= 0) resolve(-1);
      }, 100);
    } else {
      barBox.style.display = 'none';
    }

    function stopTimer() {
      if (self._quizTimer) { clearInterval(self._quizTimer); self._quizTimer = null; }
    }

    function resolve(chosenPos) {
      if (resolved) return;
      resolved = true;
      stopTimer();
      const correct = chosenPos === correctPos;
      const timedOut = chosenPos === -1;

      // lock the board and reveal
      el.querySelectorAll('.wh-choice').forEach((b) => {
        b.disabled = true;
        const pos = +b.dataset.p;
        if (pos === correctPos) b.classList.add('right');
        else if (pos === chosenPos) b.classList.add('wrong');
      });
      bar.style.width = '0%';

      const granted = correct || R.mode === 'bonus';
      if (granted) self.applyPick(pick);

      let headline;
      if (correct) {
        r.quizStreak = (r.quizStreak || 0) + 1;
        const mult = Math.min(R.streakCap || 1, 1 + (R.streakStep || 0) * (r.quizStreak - 1));
        const payout = Math.round(R.correctBonus * mult);
        const streakTag = mult > 1 ? ` · ${r.quizStreak} in a row ×${mult}` : '';
        headline = R.mode === 'bonus'
          ? `Correct — knowledge bonus ${moneyExact(payout)}${streakTag}`
          : `Correct — ${pick.w.name} claimed · +${moneyExact(payout)}${streakTag}`;
        r.dollars += payout;
        self.audio.level();
        self.floater(r.p.x, r.p.y - 44, '+' + moneyExact(payout), '#6ee7a0', 19);
      } else {
        r.quizStreak = 0;
        if (R.mode === 'bonus') {
          headline = timedOut
            ? `Out of time — ${pick.w.name} granted anyway, no bonus`
            : `Not quite — ${pick.w.name} granted anyway, no bonus`;
        } else {
          headline = timedOut
            ? `Out of time — ${pick.w.name} forfeited`
            : `Not quite — ${pick.w.name} forfeited`;
        }
        r.dollars += R.wrongConsolation;
        self.audio.hurt();
      }

      // track
      const st = r.stats;
      if (correct) {
        st.quizCorrect++;
        self.meta.quizCorrect = (self.meta.quizCorrect || 0) + 1;
        if (st.quizCorrect >= 5) self.unlock('quiz_5');
        if (self.meta.quizCorrect >= 25) self.unlock('quiz_25');
      } else {
        st.quizWrong++;
      }
      saveMeta(self.meta, self.persist);
      self.emit('run:trivia', { topic: q.topic, correct, granted, upgrade: pick.id });

      const why = document.createElement('div');
      why.className = 'wh-why ' + (correct ? 'ok' : 'no');
      why.innerHTML = `<b>${esc(headline)}</b>${esc(q.why)}
        <div class="wh-continue">press any key to continue ▸</div>`;
      el.querySelector('.wh-quiz').appendChild(why);

      // Auto-advance, but let an impatient player skip straight through — with
      // faster levelling these reveals otherwise eat a big slice of the stage.
      let advanced = false;
      const advance = () => {
        if (advanced) return;
        advanced = true;
        window.removeEventListener('keydown', onSkip);
        window.removeEventListener('pointerdown', onSkip);
        self.finishDraft();
      };
      const onSkip = () => advance();
      setTimeout(() => {
        if (advanced || self.destroyed) return;
        window.addEventListener('keydown', onSkip);
        window.addEventListener('pointerdown', onSkip);
      }, 280);   // brief grace so the answering click does not skip the reveal

      self._quizCleanup = () => {
        stopTimer();
        window.removeEventListener('keydown', self._quizKeys);
        window.removeEventListener('keydown', onSkip);
        window.removeEventListener('pointerdown', onSkip);
        advanced = true;
      };
      self._quizReveal = setTimeout(() => { self._quizReveal = null; advance(); }, R.revealMs);
    }

    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b || b.disabled) return;
      resolve(+b.dataset.p);
    });

    // keyboard: 1-4 / A-D
    this._quizKeys = (e) => {
      if (resolved) return;
      const k = e.key.toLowerCase();
      const idx = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
      if (idx < 0 || idx >= order.length) return;
      if (struck.has(idx)) return;
      resolve(idx);
    };
    window.addEventListener('keydown', this._quizKeys);
    this._quizCleanup = () => {
      stopTimer();
      window.removeEventListener('keydown', self._quizKeys);
    };
  };

  Instance.prototype.applyPick = function (pk) {
    const p = this.run.p;
    if (pk.kind === 'weapon') {
      p.weapons[pk.id] = (p.weapons[pk.id] || 0) + 1;
      if (pk.id === 'graviton_beam' && p.weapons[pk.id] >= C.WEAPONS.graviton_beam.levels.length) this.unlock('graviton_pilgrim');
      if (Object.keys(p.weapons).length >= 6) this.unlock('full_house');
    } else {
      const before = p.maxHp;
      p.passives[pk.id] = (p.passives[pk.id] || 0) + 1;
      C.PASSIVES[pk.id].apply(p, p.passives[pk.id]);
      if (pk.id === 'reserved_capacity') p.hp += (p.maxHp - before);
      if (pk.id === 'tag_compliance' && p.passives[pk.id] >= C.PASSIVES.tag_compliance.max) this.unlock('tag_compliance');
    }
  };

  // ===========================================================================
  // UPDATE
  // ===========================================================================
  Instance.prototype.update = function (dt) {
    const r = this.run, p = r.p, S = r.stage;
    r.t += dt;

    // per-enemy hit-cooldown maps are keyed by enemy id; drop them periodically
    // so a long run does not accumulate thousands of dead keys.
    if (r.t - (r._pruneT || 0) > 10) { r._pruneT = r.t; r.orbHits = {}; r.scanHits = {}; }

    // ---- input / movement ---------------------------------------------------
    let ix = 0, iy = 0;
    const k = this.keys;
    if (k['a'] || k['arrowleft']) ix -= 1;
    if (k['d'] || k['arrowright']) ix += 1;
    if (k['w'] || k['arrowup']) iy -= 1;
    if (k['s'] || k['arrowdown']) iy += 1;
    if (!ix && !iy && this.pointer.down) {
      const wx = this.pointer.x + r.cam.x, wy = this.pointer.y + r.cam.y;
      const dx = wx - p.x, dy = wy - p.y, d = Math.hypot(dx, dy);
      if (d > 12) { ix = dx / d; iy = dy / d; }
    }
    const il = Math.hypot(ix, iy) || 1;
    p.vx = (ix / il) * p.speed; p.vy = (iy / il) * p.speed;
    if (ix) p.face = ix > 0 ? 1 : -1;
    p.x = clamp(p.x + p.vx * dt, 40, WORLD_W - 40);
    p.y = clamp(p.y + p.vy * dt, 40, WORLD_H - 40);
    if (p.invT > 0) p.invT -= dt;
    if (p.hitT > 0) p.hitT -= dt;
    if (r.comboT > 0) { r.comboT -= dt; if (r.comboT <= 0) r.combo = 0; }
    if (r.bannerT > 0) r.bannerT -= dt;
    if (r.lap > 0) {
      r.lap -= dt;
      if (r.lap <= 0) { r.lap = 0; this.endRun('clear'); return; }
    }

    // ---- camera -------------------------------------------------------------
    r.cam.x = clamp(p.x - VW / 2, 0, WORLD_W - VW);
    r.cam.y = clamp(p.y - VH / 2, 0, WORLD_H - VH);
    if (r.cam.shake > 0) r.cam.shake = Math.max(0, r.cam.shake - dt * 42);

    // ---- spawning -----------------------------------------------------------
    if (!r.boss && !r.bossQueued) {
      r.spawnAcc += S.spawnRate(r.t) * dt;
      while (r.spawnAcc >= 1 && r.enemies.length < 300) { r.spawnAcc -= 1; this.spawnEnemy(); }
      if (S.elite && r.t >= S.elite.from) {
        r.eliteT += dt;
        if (r.eliteT >= S.elite.cd) { r.eliteT = 0; this.spawnEnemy(S.elite.type); }
      }
      if (r.t >= S.duration) { r.bossQueued = true; this.spawnBoss(); }
    }

    // ---- weapons ------------------------------------------------------------
    this.fireWeapons(dt);

    // ---- crowd separation (grid) -------------------------------------------
    this.separate(dt);

    // ---- enemies ------------------------------------------------------------
    let contactDmg = 0, contactCount = 0;
    for (let i = r.enemies.length - 1; i >= 0; i--) {
      const e = r.enemies[i];
      if (e.hitT > 0) e.hitT -= dt;
      if (e.slowT > 0) { e.slowT -= dt; } else { e.slowMul = 1; }
      if (e.knockX || e.knockY) {
        e.x += e.knockX * dt; e.y += e.knockY * dt;
        e.knockX *= 0.86; e.knockY *= 0.86;
        if (Math.abs(e.knockX) < 3) e.knockX = 0;
        if (Math.abs(e.knockY) < 3) e.knockY = 0;
      }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const dir = e.def.flees && d < 340 ? -1 : 1;
      const sp = e.def.speed * (e.slowMul || 1) * dir;
      e.x += (dx / d) * sp * dt;
      e.y += (dy / d) * sp * dt;
      e.x = clamp(e.x, 20, WORLD_W - 20); e.y = clamp(e.y, 20, WORLD_H - 20);
      e.wob = (e.wob || 0) + dt * 6;

      // ranged attack
      if (e.def.ranged) {
        e.rcd = (e.rcd || e.def.ranged.cd) - dt;
        if (e.rcd <= 0 && d < 560) {
          e.rcd = e.def.ranged.cd;
          const n = e.def.ranged.count, base = Math.atan2(dy, dx);
          for (let j = 0; j < n; j++) {
            const a = base + (j - (n - 1) / 2) * 0.22;
            r.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * e.def.ranged.speed, vy: Math.sin(a) * e.def.ranged.speed, dmg: e.def.ranged.dmg, life: 4, r: 7 });
          }
        }
      }
      // boss behaviours
      if (e.isBoss) this.updateBoss(e, dt);

      // contact damage — collected, then applied once through i-frames below
      if (d < e.r + p.radius) {
        contactDmg = Math.max(contactDmg, e.def.dmg);
        contactCount++;
      }
      if (e.hp <= 0) { this.killEnemy(i); }
    }
    if (contactDmg > 0) {
      const crowd = Math.min(C.CONTACT.crowdCap, 1 + C.CONTACT.crowdBonus * (contactCount - 1));
      this.damagePlayer(contactDmg * crowd, true);
    }

    // ---- player bullets -----------------------------------------------------
    for (let i = r.bullets.length - 1; i >= 0; i--) {
      const b = r.bullets[i];
      if (b.homing) {
        let best = null, bd = 1e9;
        for (const e of r.enemies) { const dd = dist2(b.x, b.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; } }
        if (best) {
          const a = Math.atan2(best.y - b.y, best.x - b.x);
          const ca = Math.atan2(b.vy, b.vx);
          let da = a - ca; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
          const na = ca + clamp(da, -3.6 * dt, 3.6 * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { r.bullets.splice(i, 1); continue; }
      let dead = false;
      for (let j = r.enemies.length - 1; j >= 0; j--) {
        const e = r.enemies[j];
        if (b.hitSet && b.hitSet.has(e.id)) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          this.hurtEnemy(e, b.dmg);
          if (b.pierce > 0) {
            b.pierce--;
            if (!b.hitSet) b.hitSet = new Set();
            b.hitSet.add(e.id);
          }
          else { dead = true; }
          break;
        }
      }
      if (dead) r.bullets.splice(i, 1);
    }

    // ---- enemy bullets ------------------------------------------------------
    for (let i = r.ebullets.length - 1; i >= 0; i--) {
      const b = r.ebullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { r.ebullets.splice(i, 1); continue; }
      if (dist2(b.x, b.y, p.x, p.y) < (p.radius + b.r) * (p.radius + b.r)) {
        this.damagePlayer(b.dmg, true); r.ebullets.splice(i, 1);
      }
    }

    // ---- lifecycle zones ----------------------------------------------------
    for (let i = r.zones.length - 1; i >= 0; i--) {
      const z = r.zones[i];
      z.life -= dt;
      if (z.life <= 0) { r.zones.splice(i, 1); continue; }
      for (const e of r.enemies) {
        if (dist2(z.x, z.y, e.x, e.y) < (z.r + e.r) * (z.r + e.r)) {
          this.hurtEnemy(e, z.dps * dt, true);
          e.slowMul = z.slow; e.slowT = 0.4;
        }
      }
    }

    // ---- orbs / pickups -----------------------------------------------------
    const pr = p.pickupRadius, pr2 = pr * pr;
    for (let i = r.orbs.length - 1; i >= 0; i--) {
      const o = r.orbs[i];
      const dd = dist2(o.x, o.y, p.x, p.y);
      if (dd < pr2 || o.magnet) {
        const d = Math.sqrt(dd) || 1;
        const pull = o.magnet ? 620 : lerp(700, 190, d / pr);
        o.x += (p.x - o.x) / d * pull * dt;
        o.y += (p.y - o.y) / d * pull * dt;
        if (d < 26) {
          const gain = o.value * p.goldMult;
          r.dollars += gain;
          p.xp += gain * C.XP.perDollar;
          r.combo++; r.comboT = 2.4;
          this.audio.coin();
          r.orbs.splice(i, 1);
          if (p.xp >= p.xpNext && !this.drafting) { this.levelUpImmediate(); this.showDraft(); }
          continue;
        }
      }
      o.b = (o.b || 0) + dt * 5;
    }
    for (let i = r.pickups.length - 1; i >= 0; i--) {
      const u = r.pickups[i];
      u.b = (u.b || 0) + dt * 4;
      if (dist2(u.x, u.y, p.x, p.y) < pr2) {
        if (u.kind === 'heal') {
          p.hp = Math.min(p.maxHp, p.hp + C.PICKUPS.heal.heal);
          this.floater(p.x, p.y - 30, '+' + C.PICKUPS.heal.heal + ' HP', '#6ee7a0');
        } else if (u.kind === 'magnet') {
          r.orbs.forEach((o) => { o.magnet = true; });
          this.floater(p.x, p.y - 30, 'CUR REFRESH', '#7fd6c4');
        } else if (u.kind === 'nuke') {
          r.enemies.forEach((e) => { if (!e.isBoss) this.hurtEnemy(e, C.PICKUPS.nuke.dmg); });
          this.shake(22); this.audio.nova();
          r.flash = { life: 1.5, max: 1.5 };
        }
        this.audio.coin();
        r.pickups.splice(i, 1);
      }
    }

    // ---- fx -----------------------------------------------------------------
    for (let i = r.fx.length - 1; i >= 0; i--) {
      const f = r.fx[i];
      f.life -= dt;
      if (f.vx != null) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; }
      if (f.life <= 0) r.fx.splice(i, 1);
    }
    for (let i = r.floaters.length - 1; i >= 0; i--) {
      const f = r.floaters[i];
      f.life -= dt; f.y -= 34 * dt;
      if (f.life <= 0) r.floaters.splice(i, 1);
    }
    if (r.flash) { r.flash.life -= dt; if (r.flash.life <= 0) r.flash = null; }

    // ---- level-up check (in case xp gained outside orb pickup) --------------
    if (p.xp >= p.xpNext && !this.drafting) { this.levelUpImmediate(); this.showDraft(); }
    if (p.level >= 10) this.unlock('level_10');

    // ---- death --------------------------------------------------------------
    if (p.hp <= 0) this.endRun('death');
  };

  // ---------------------------------------------------------------------------
  // Cheap uniform-grid separation so swarms spread out instead of stacking into
  // a single indistinguishable blob.
  Instance.prototype.separate = function (dt) {
    const r = this.run, list = r.enemies;
    if (list.length < 2) return;
    const CELL = 70;
    const grid = new Map();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const key = ((e.x / CELL) | 0) + ':' + ((e.y / CELL) | 0);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(e);
    }
    const push = 74;
    for (const bucket of grid.values()) {
      for (let a = 0; a < bucket.length; a++) {
        for (let b = a + 1; b < bucket.length; b++) {
          const e1 = bucket[a], e2 = bucket[b];
          if (e1.isBoss || e2.isBoss) continue;
          const dx = e2.x - e1.x, dy = e2.y - e1.y;
          const min = e1.r + e2.r;
          const d2 = dx * dx + dy * dy;
          if (d2 > min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const f = ((min - d) / min) * push * dt;
          const nx = dx / d, ny = dy / d;
          e1.x -= nx * f; e1.y -= ny * f;
          e2.x += nx * f; e2.y += ny * f;
        }
      }
    }
  };

  Instance.prototype.shake = function (n) { this.run.cam.shake = Math.max(this.run.cam.shake, n); };

  Instance.prototype.floater = function (x, y, text, color, size) {
    this.run.floaters.push({ x, y, text, color: color || '#fff', size: size || 15, life: 0.9, max: 0.9 });
  };

  Instance.prototype.damagePlayer = function (amount, isBullet) {
    const r = this.run, p = r.p;
    if (isBullet) { if (p.invT > 0) return; p.invT = C.PLAYER.iframes; }
    const dmg = amount * p.dr;
    p.hp -= dmg;
    p.hitT = 0.18;
    r.stats.hits++;
    if (r.boss) r.bossHitless = false;
    if (isBullet || dmg > 2) { this.audio.hurt(); this.shake(8); }
  };

  Instance.prototype.hurtEnemy = function (e, dmg, silent) {
    const p = this.run.p;
    const d = dmg * p.dmgMult;
    e.hp -= d;
    e.hitT = 0.09;
    if (!silent) {
      this.audio.hit();
      if (d >= 1) this.floater(e.x + (Math.random() * 16 - 8), e.y - e.r, Math.round(d), '#ffe9a8', 13);
    }
  };

  Instance.prototype.spawnEnemy = function (forceType) {
    const r = this.run, S = r.stage;
    let type = forceType;
    if (!type) {
      const avail = S.table.filter((x) => r.t >= x.from);
      if (!avail.length) return;
      const total = avail.reduce((a, x) => a + x.weight, 0);
      let roll = r.rnd() * total;
      for (const x of avail) { roll -= x.weight; if (roll <= 0) { type = x.type; break; } }
      type = type || avail[0].type;
    }
    const def = C.ENEMIES[type];
    // spawn on a ring just outside the camera view
    const a = r.rnd() * TAU;
    const rad = 720 + r.rnd() * 160;
    const x = clamp(r.p.x + Math.cos(a) * rad, 30, WORLD_W - 30);
    const y = clamp(r.p.y + Math.sin(a) * rad, 30, WORLD_H - 30);
    this.addEnemy(type, def, x, y, S.hpScale(r.t));
  };

  function nextEnemyId(r) {
    r._eid = (r._eid || 0) + 1;
    return r._eid;
  }

  Instance.prototype.addEnemy = function (type, def, x, y, scale, sizeMul) {
    const r = this.run;
    const e = {
      id: nextEnemyId(r), type, def, x, y,
      hp: def.hp * scale, maxHp: def.hp * scale,
      r: def.radius * (sizeMul || 1), sizeMul: sizeMul || 1,
      hitT: 0, slowMul: 1, slowT: 0, knockX: 0, knockY: 0,
      value: def.value * (sizeMul || 1),
    };
    r.enemies.push(e);
    return e;
  };

  Instance.prototype.spawnBoss = function () {
    const r = this.run, def = C.BOSSES[r.stage.boss];
    const a = r.rnd() * TAU;
    const e = this.addEnemy('boss', def, clamp(r.p.x + Math.cos(a) * 620, 100, WORLD_W - 100),
      clamp(r.p.y + Math.sin(a) * 620, 100, WORLD_H - 100), 1);
    e.isBoss = true; e.r = def.radius;
    r.boss = e;
    r.bossHitless = true;
    this.setMusic('boss');
    this.banner(def.name, def.tagline, 4);
    this.audio.boss();
    this.shake(24);
    this.emit('run:boss', { boss: r.stage.boss, name: def.name });
  };

  Instance.prototype.updateBoss = function (e, dt) {
    const r = this.run, def = e.def;
    if (def.spawns) {
      e.scd = (e.scd || def.spawns.cd) - dt;
      if (e.scd <= 0) {
        e.scd = def.spawns.cd;
        const md = C.ENEMIES[def.spawns.type];
        for (let i = 0; i < def.spawns.count; i++) {
          const a = r.rnd() * TAU;
          this.addEnemy(def.spawns.type, md, e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, r.stage.hpScale(r.t));
        }
      }
    }
    if (def.radial) {
      e.rcd2 = (e.rcd2 || def.radial.cd) - dt;
      if (e.rcd2 <= 0) {
        e.rcd2 = def.radial.cd;
        const off = r.rnd() * TAU;
        for (let i = 0; i < def.radial.count; i++) {
          const a = off + (i / def.radial.count) * TAU;
          r.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * def.radial.speed, vy: Math.sin(a) * def.radial.speed, dmg: def.radial.dmg, life: 5, r: 9 });
        }
        this.shake(6);
      }
    }
  };

  Instance.prototype.killEnemy = function (idx) {
    const r = this.run, e = r.enemies[idx];
    r.enemies.splice(idx, 1);
    r.kills++;
    // Bosses all share the type 'boss', so key them by the stage's boss id — the
    // recap wants "IDLE SPRAWL PRIME ×1", not a line that just says "boss".
    const kkey = e.isBoss ? r.stage.boss : e.type;
    r.killsByType[kkey] = (r.killsByType[kkey] || 0) + 1;
    this.audio.kill();
    this.unlock('first_blood');

    if (e.type === 'anomaly') { r.stats.anomalies++; if (r.stats.anomalies >= 5) this.unlock('anomaly_hunter'); }
    if (e.type === 'orphan_ebs') { r.stats.ebs++; if (r.stats.ebs >= 50) this.unlock('zero_unattached'); }

    // burst fx
    for (let i = 0; i < (e.isBoss ? 40 : 7); i++) {
      const a = r.rnd() * TAU, sp = 60 + r.rnd() * (e.isBoss ? 340 : 170);
      r.fx.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + r.rnd() * 0.4, max: 0.9, color: e.def.accent, size: 3 + r.rnd() * 4 });
    }

    // splitting
    if (e.def.splits && e.sizeMul >= 1) {
      for (let i = 0; i < e.def.splits; i++) {
        const a = r.rnd() * TAU;
        const c = this.addEnemy(e.type, e.def, e.x + Math.cos(a) * 26, e.y + Math.sin(a) * 26, r.stage.hpScale(r.t) * 0.45, 0.6);
        c.knockX = Math.cos(a) * 190; c.knockY = Math.sin(a) * 190;
      }
    }

    // savings orbs
    const n = e.isBoss ? 26 : e.def.elite ? 7 : 1;
    const per = e.value / n;
    for (let i = 0; i < n; i++) {
      const a = r.rnd() * TAU, sp = r.rnd() * (e.isBoss ? 130 : 34);
      r.orbs.push({ x: e.x + Math.cos(a) * sp, y: e.y + Math.sin(a) * sp, value: per, big: per >= 500 });
    }

    // bonus pickups
    const roll = r.rnd();
    if (roll < C.PICKUPS.nuke.chance) r.pickups.push({ x: e.x, y: e.y, kind: 'nuke' });
    else if (roll < C.PICKUPS.nuke.chance + C.PICKUPS.magnet.chance) r.pickups.push({ x: e.x, y: e.y, kind: 'magnet' });
    else if (roll < C.PICKUPS.nuke.chance + C.PICKUPS.magnet.chance + C.PICKUPS.heal.chance) r.pickups.push({ x: e.x, y: e.y, kind: 'heal' });

    if (e.def.elite) this.floater(e.x, e.y - 30, moneyExact(e.value), '#ff9e2c', 20);

    if (e.isBoss) {
      this.shake(30);
      if (r.bossHitless) this.unlock('flawless_boss');
      r.boss = null;
      // A short lap to sweep up what the fight left on the floor. Spawning is
      // already halted by bossQueued, so nothing new arrives during it.
      r.lap = C.VICTORY_LAP;
      this.banner('BOSS DOWN', 'Grab everything still on the floor');
    }
  };

  // ===========================================================================
  // WEAPONS
  // ===========================================================================
  Instance.prototype.nearest = function (x, y, maxD) {
    const r = this.run; let best = null, bd = maxD ? maxD * maxD : 1e12;
    for (const e of r.enemies) { const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
    return best;
  };

  Instance.prototype.fireWeapons = function (dt) {
    const r = this.run, p = r.p, cd = r.cooldowns;
    const step = (id, base) => {
      cd[id] = (cd[id] || 0) - dt;
      if (cd[id] <= 0) { cd[id] = base * p.cdMult; return true; }
      return false;
    };

    // Rightsizer
    if (p.weapons.rightsizer) {
      const w = C.WEAPONS.rightsizer.levels[p.weapons.rightsizer - 1];
      if (step('rightsizer', w.cd)) {
        const t = this.nearest(p.x, p.y, 900);
        if (t) {
          const base = Math.atan2(t.y - p.y, t.x - p.x);
          for (let i = 0; i < w.count; i++) {
            const a = base + (i - (w.count - 1) / 2) * 0.15;
            r.bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg: w.dmg, r: 6, life: 1.6, pierce: w.pierce, kind: 'bolt' });
          }
          this.audio.shoot();
        }
      }
    }

    // Kill Idle (nova)
    if (p.weapons.kill_idle) {
      const w = C.WEAPONS.kill_idle.levels[p.weapons.kill_idle - 1];
      if (step('kill_idle', w.cd)) {
        r.fx.push({ x: p.x, y: p.y, life: 0.42, max: 0.42, ring: w.radius, color: '#ff9e2c' });
        for (const e of r.enemies) {
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < w.radius + e.r) {
            this.hurtEnemy(e, w.dmg);
            if (!e.isBoss) { const a = Math.atan2(e.y - p.y, e.x - p.x); e.knockX = Math.cos(a) * w.knock; e.knockY = Math.sin(a) * w.knock; }
          }
        }
        this.audio.nova(); this.shake(7);
      }
    }

    // Savings Plan (orbiting)
    if (p.weapons.savings_plan) {
      const w = C.WEAPONS.savings_plan.levels[p.weapons.savings_plan - 1];
      r.orbAngle += w.spin * dt;
      r.orbHits = r.orbHits || {};
      for (let i = 0; i < w.count; i++) {
        const a = r.orbAngle + (i / w.count) * TAU;
        const ox = p.x + Math.cos(a) * w.radius, oy = p.y + Math.sin(a) * w.radius;
        for (const e of r.enemies) {
          if (dist2(ox, oy, e.x, e.y) < (e.r + 15) * (e.r + 15)) {
            const key = e.id;
            if (!r.orbHits[key] || r.t - r.orbHits[key] > 0.35) {
              r.orbHits[key] = r.t; this.hurtEnemy(e, w.dmg);
            }
          }
        }
      }
    }

    // Graviton Beam
    if (p.weapons.graviton_beam) {
      const w = C.WEAPONS.graviton_beam.levels[p.weapons.graviton_beam - 1];
      if (step('graviton_beam', w.cd)) {
        let a;
        if (p.vx || p.vy) a = Math.atan2(p.vy, p.vx);
        else { const t = this.nearest(p.x, p.y, 900); a = t ? Math.atan2(t.y - p.y, t.x - p.x) : (p.face > 0 ? 0 : Math.PI); }
        r.fx.push({ x: p.x, y: p.y, a, life: 0.22, max: 0.22, beam: { len: w.len, width: w.width }, color: '#7fd6c4' });
        const cx = Math.cos(a), cy = Math.sin(a);
        for (const e of r.enemies) {
          const rx = e.x - p.x, ry = e.y - p.y;
          const along = rx * cx + ry * cy;
          if (along < 0 || along > w.len) continue;
          const perp = Math.abs(-rx * cy + ry * cx);
          if (perp < w.width / 2 + e.r) this.hurtEnemy(e, w.dmg);
        }
        this.audio.shoot(); this.shake(4);
      }
    }

    // S3 Lifecycle zone
    if (p.weapons.s3_lifecycle) {
      const w = C.WEAPONS.s3_lifecycle.levels[p.weapons.s3_lifecycle - 1];
      if (step('s3_lifecycle', w.cd)) {
        r.zones.push({ x: p.x, y: p.y, r: w.radius, dps: w.dps, life: w.life, max: w.life, slow: w.slow });
      }
    }

    // Spot Fleet drones
    if (p.weapons.spot_fleet) {
      const w = C.WEAPONS.spot_fleet.levels[p.weapons.spot_fleet - 1];
      if (step('spot_fleet', w.cd)) {
        for (let i = 0; i < w.count; i++) {
          if (r.rnd() < w.interrupt) {
            this.floater(p.x + (r.rnd() * 50 - 25), p.y - 22, 'INTERRUPTED', '#ff8a8a', 11);
            continue;
          }
          const a = r.rnd() * TAU;
          r.bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg: w.dmg, r: 8, life: 3.2, pierce: 0, homing: true, kind: 'drone' });
        }
        this.audio.shoot();
      }
    }

    // CUR Scan (rotating arc)
    if (p.weapons.cur_scan) {
      const w = C.WEAPONS.cur_scan.levels[p.weapons.cur_scan - 1];
      r.scanAngle += w.spin * dt;
      r.scanHits = r.scanHits || {};
      const half = w.arc / 2;
      for (const e of r.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > w.len + e.r) continue;
        let da = Math.atan2(e.y - p.y, e.x - p.x) - r.scanAngle;
        while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        if (Math.abs(da) < half) {
          if (!r.scanHits[e.id] || r.t - r.scanHits[e.id] > 0.5) {
            r.scanHits[e.id] = r.t; this.hurtEnemy(e, w.dmg, true);
          }
        }
      }
    }
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================
  Instance.prototype.render = function () {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.run) {
      // menu backdrop
      ctx.fillStyle = '#080c14'; ctx.fillRect(0, 0, VW, VH);
      const t = performance.now() / 1000;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 40; i++) {
        const x = ((i * 137.5 + t * 12) % (VW + 60)) - 30;
        const y = ((i * 219.7 + t * 5) % (VH + 60)) - 30;
        ctx.fillStyle = i % 3 ? '#16233c' : '#1d3050';
        ctx.beginPath(); ctx.arc(x, y, 2 + (i % 4), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }

    const r = this.run, p = r.p, S = r.stage;
    const sh = r.cam.shake;
    const ox = sh ? (Math.random() * 2 - 1) * sh : 0;
    const oy = sh ? (Math.random() * 2 - 1) * sh : 0;
    const camX = r.cam.x + ox, camY = r.cam.y + oy;

    // floor — the biome overrides the stage's own palette
    const B = r.bio || { floor: S.floor, grid: S.grid, fog: S.fog, props: 'racks', propAlpha: 0.55 };
    ctx.fillStyle = B.floor; ctx.fillRect(0, 0, VW, VH);
    if (B.sky) {
      const sg = ctx.createLinearGradient(0, 0, 0, VH);
      sg.addColorStop(0, B.sky[0]); sg.addColorStop(1, B.sky[1]);
      ctx.globalAlpha = 0.35; ctx.fillStyle = sg; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1;
    }

    // grid
    if (B.grid) {
      ctx.strokeStyle = B.grid; ctx.lineWidth = 1;
      const gs = 80;
      ctx.beginPath();
      for (let x = -(camX % gs); x < VW; x += gs) { ctx.moveTo(x | 0, 0); ctx.lineTo(x | 0, VH); }
      for (let y = -(camY % gs); y < VH; y += gs) { ctx.moveTo(0, y | 0); ctx.lineTo(VW, y | 0); }
      ctx.stroke();
    }

    // world border
    ctx.strokeStyle = '#f0a52c44'; ctx.lineWidth = 4;
    ctx.strokeRect(-camX, -camY, WORLD_W, WORLD_H);

    ctx.save();
    ctx.translate(-camX, -camY);

    // scenery — culled to the visible band, held back so enemies stay the
    // highest-contrast thing on screen
    const t = r.t;
    if (global.ArcadeBiomes) {
      ctx.globalAlpha = B.propAlpha;
      for (const pr of r.props) {
        if (pr.x < camX - 120 || pr.x > camX + VW + 120 ||
            pr.y < camY - 150 || pr.y > camY + VH + 150) continue;
        global.ArcadeBiomes.drawProp(ctx, pr, B, t);
      }
      ctx.globalAlpha = 1;
    }

    // zones
    for (const z of r.zones) {
      const a = clamp(z.life / z.max, 0, 1);
      const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
      g.addColorStop(0, `rgba(127,214,196,${0.26 * a})`);
      g.addColorStop(1, 'rgba(127,214,196,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(160,240,225,${0.5 * a})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    }

    // orbs
    for (const o of r.orbs) {
      const s = o.big ? 9 : 6;
      const b = Math.sin((o.b || 0)) * 1.6;
      ctx.fillStyle = o.big ? '#ffd76b' : '#6ee7a0';
      ctx.shadowColor = o.big ? '#ffd76b' : '#6ee7a0'; ctx.shadowBlur = 11;
      ctx.beginPath(); ctx.arc(o.x, o.y + b, s, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b2018'; ctx.font = `bold ${s + 3}px ui-monospace,monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', o.x, o.y + b + 0.5);
    }

    // pickups
    for (const u of r.pickups) {
      const b = Math.sin(u.b || 0) * 3;
      ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 12;
      ctx.fillText(C.PICKUPS[u.kind].icon, u.x, u.y + b);
      ctx.shadowBlur = 0;
    }

    // savings-plan orbs (drawn under player)
    if (p.weapons.savings_plan) {
      const w = C.WEAPONS.savings_plan.levels[p.weapons.savings_plan - 1];
      for (let i = 0; i < w.count; i++) {
        const a = r.orbAngle + (i / w.count) * TAU;
        const x = p.x + Math.cos(a) * w.radius, y = p.y + Math.sin(a) * w.radius;
        ctx.fillStyle = '#4aa3ff'; ctx.shadowColor = '#4aa3ff'; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(x, y, 13, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#dff0ff'; ctx.font = 'bold 13px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('$', x, y);
      }
    }

    // CUR scan arc
    if (p.weapons.cur_scan) {
      const w = C.WEAPONS.cur_scan.levels[p.weapons.cur_scan - 1];
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, w.len);
      g.addColorStop(0, 'rgba(110,231,160,0.30)');
      g.addColorStop(1, 'rgba(110,231,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, w.len, r.scanAngle - w.arc / 2, r.scanAngle + w.arc / 2);
      ctx.closePath(); ctx.fill();
    }

    // enemies
    for (const e of r.enemies) this.drawEnemy(ctx, e);

    // enemy bullets
    for (const b of r.ebullets) {
      ctx.fillStyle = '#ff6b6b'; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // player bullets
    for (const b of r.bullets) {
      if (b.kind === 'drone') {
        ctx.fillStyle = '#c9a3ff'; ctx.shadowColor = '#a06bff'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#2a1348'; ctx.font = 'bold 9px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', b.x, b.y);
      } else {
        const a = Math.atan2(b.vy, b.vx);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
        ctx.fillStyle = '#ffd76b'; ctx.shadowColor = '#ffb02c'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.ellipse(0, 0, 11, 4.5, 0, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0; ctx.restore();
      }
    }

    // fx
    for (const f of r.fx) {
      const a = clamp(f.life / f.max, 0, 1);
      if (f.ring) {
        ctx.strokeStyle = f.color; ctx.globalAlpha = a * 0.85;
        ctx.lineWidth = 4 + (1 - a) * 8;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.ring * (1 - a * 0.15), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.beam) {
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
        ctx.globalAlpha = a;
        const g = ctx.createLinearGradient(0, 0, f.beam.len, 0);
        g.addColorStop(0, 'rgba(200,255,245,0.95)');
        g.addColorStop(1, 'rgba(127,214,196,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, -f.beam.width / 2, f.beam.len, f.beam.width);
        ctx.globalAlpha = 1; ctx.restore();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.size * a, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // player
    this.drawPlayer(ctx, p);

    // floaters
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of r.floaters) {
      const a = clamp(f.life / f.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `bold ${f.size}px 'Segoe UI',system-ui,sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // vignette
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.32, VW / 2, VH / 2, VH * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, (r.bio && r.bio.fog) || S.fog);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);

    this.drawFlash(ctx);
    this.drawHUD(ctx);
  };

  // Full-screen "TERMINATE ALL" blast. Uses assets/terminate_all.png when it
  // exists; degrades to the text treatment alone when it does not.
  Instance.prototype.drawFlash = function (ctx) {
    const f = this.run.flash;
    if (!f) return;
    const a = clamp(f.life / f.max, 0, 1);
    const progress = 1 - a;

    ctx.fillStyle = `rgba(255,64,42,${0.40 * a})`;
    ctx.fillRect(0, 0, VW, VH);

    const img = this.img.terminate_all;
    const hasImg = img && img.complete && img.naturalWidth > 0;
    const pop = 0.82 + 0.18 * Math.min(1, progress * 7);
    const shudder = a > 0.75 ? (Math.random() * 2 - 1) * 6 * a : 0;

    ctx.save();
    ctx.globalAlpha = Math.min(1, a * 1.7);
    ctx.translate(VW / 2 + shudder, VH / 2);
    ctx.scale(pop, pop);

    let textY = 0;
    if (hasImg) {
      const sc = Math.min(VW * 0.46 / img.naturalWidth, VH * 0.60 / img.naturalHeight);
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 46;
      ctx.drawImage(img, -w / 2, -h / 2 - 34, w, h);
      ctx.shadowBlur = 0;
      textY = h / 2 + 6;
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 62px "Segoe UI",system-ui,sans-serif';
    ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(0,0,0,.82)';
    ctx.strokeText('TERMINATE ALL', 0, textY);
    const g = ctx.createLinearGradient(0, textY - 32, 0, textY + 32);
    g.addColorStop(0, '#fff3b0'); g.addColorStop(1, '#ff8c1a');
    ctx.fillStyle = g;
    ctx.fillText('TERMINATE ALL', 0, textY);
    ctx.restore();
  };

  // ---------------------------------------------------------------------------
  Instance.prototype.drawEnemy = function (ctx, e) {
    const d = e.def;
    const wob = Math.sin(e.wob || 0) * (e.r * 0.06);
    const p = this.run.p;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.85, e.r * 0.8, e.r * 0.3, 0, 0, TAU); ctx.fill();

    // body
    ctx.save();
    ctx.translate(e.x, e.y);
    const flash = e.hitT > 0;
    ctx.fillStyle = flash ? '#ffffff' : d.color;
    ctx.strokeStyle = flash ? '#ffffff' : d.accent;
    ctx.lineWidth = e.isBoss ? 5 : 3;
    if (e.slowMul < 1) { ctx.shadowColor = '#7fd6c4'; ctx.shadowBlur = 14; }
    ctx.beginPath();
    const rr = e.r + wob;
    if (e.isBoss) {
      // chunky rounded square for bosses
      const s = rr * 1.05;
      ctx.roundRect(-s, -s * 0.85, s * 2, s * 1.7, s * 0.28);
    } else {
      ctx.arc(0, 0, rr, 0, TAU);
    }
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // eyes tracking the player
    const ea = Math.atan2(p.y - e.y, p.x - e.x);
    const eox = Math.cos(ea) * rr * 0.13, eoy = Math.sin(ea) * rr * 0.13;
    const es = Math.max(3, rr * 0.19);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-rr * 0.32, -rr * 0.14, es, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(rr * 0.32, -rr * 0.14, es, 0, TAU); ctx.fill();
    ctx.fillStyle = flash ? '#888' : '#101828';
    ctx.beginPath(); ctx.arc(-rr * 0.32 + eox, -rr * 0.14 + eoy, es * 0.52, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(rr * 0.32 + eox, -rr * 0.14 + eoy, es * 0.52, 0, TAU); ctx.fill();

    // little frown
    ctx.strokeStyle = flash ? '#888' : '#101828';
    ctx.lineWidth = Math.max(1.5, rr * 0.08);
    ctx.beginPath();
    ctx.arc(0, rr * 0.55, rr * 0.3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.restore();

    // glyph badge
    ctx.font = `${Math.max(13, e.r * 0.85)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.glyph, e.x, e.y - e.r - (e.isBoss ? 22 : 12));

    // hp bar (non-boss, damaged only)
    if (!e.isBoss && e.hp < e.maxHp) {
      const w = e.r * 2, h = 3.5;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(e.x - w / 2, e.y + e.r + 6, w, h);
      ctx.fillStyle = '#ff7b7b';
      ctx.fillRect(e.x - w / 2, e.y + e.r + 6, w * clamp(e.hp / e.maxHp, 0, 1), h);
    }
  };

  Instance.prototype.drawPlayer = function (ctx, p) {
    const img = this.img.costbot;
    const size = 66;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 26, 24, 9, 0, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y);
    const bob = Math.sin(this.run.t * 5) * 2.5;
    ctx.translate(0, bob);
    if (p.face < 0) ctx.scale(-1, 1);
    if (p.invT > 0 && Math.floor(this.run.t * 18) % 2 === 0) ctx.globalAlpha = 0.45;
    if (p.hitT > 0) { ctx.shadowColor = '#ff4d4d'; ctx.shadowBlur = 26; }
    else { ctx.shadowColor = 'rgba(74,163,255,.55)'; ctx.shadowBlur = 16; }
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -size / 2, -size / 2, size, size);
    else { ctx.fillStyle = '#4aa3ff'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill(); }
    ctx.restore();
  };

  // ---------------------------------------------------------------------------
  Instance.prototype.drawHUD = function (ctx) {
    const r = this.run, p = r.p, S = r.stage;
    ctx.textBaseline = 'top';

    // --- top bar
    ctx.fillStyle = 'rgba(6,10,18,.72)';
    ctx.fillRect(0, 0, VW, 58);
    ctx.fillStyle = '#f0a52c'; ctx.fillRect(0, 57, VW, 1.5);

    // score
    ctx.textAlign = 'left';
    ctx.fillStyle = '#93a4c4'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText('SAVINGS REALIZED', 18, 9);
    ctx.fillStyle = '#6ee7a0'; ctx.font = 'bold 25px ui-monospace,monospace';
    ctx.fillText(moneyExact(r.dollars), 18, 23);

    // combo
    if (r.combo > 4) {
      ctx.fillStyle = '#ffd76b'; ctx.font = 'bold 14px "Segoe UI",system-ui,sans-serif';
      ctx.fillText(`×${r.combo} streak`, 18 + ctx.measureText(moneyExact(r.dollars)).width + 190, 30);
    }

    // timer / boss
    ctx.textAlign = 'center';
    if (r.boss) {
      ctx.fillStyle = '#ff8a8a'; ctx.font = 'bold 13px "Segoe UI",system-ui,sans-serif';
      ctx.fillText(r.boss.def.name, VW / 2, 8);
      const bw = 420, bh = 13, bx = VW / 2 - bw / 2, by = 27;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx, by, bw, bh);
      const f = clamp(r.boss.hp / r.boss.maxHp, 0, 1);
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, '#ff4d4d'); g.addColorStop(1, '#ffa07a');
      ctx.fillStyle = g; ctx.fillRect(bx, by, bw * f, bh);
      ctx.strokeStyle = '#ff8a8a'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
    } else {
      const left = Math.max(0, S.duration - r.t);
      ctx.fillStyle = '#93a4c4'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
      ctx.fillText(left <= 30 ? 'BOSS INCOMING' : 'STAGE TIME', VW / 2, 9);
      ctx.fillStyle = left <= 30 ? '#ff8a8a' : '#e8eef8';
      ctx.font = 'bold 25px ui-monospace,monospace';
      ctx.fillText(mmss(left), VW / 2, 23);
    }

    // level + kills
    ctx.textAlign = 'right';
    ctx.fillStyle = '#93a4c4'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText('LEVEL', VW - 18, 9);
    ctx.fillStyle = '#ffd76b'; ctx.font = 'bold 25px ui-monospace,monospace';
    ctx.fillText(String(p.level), VW - 18, 23);
    ctx.fillStyle = '#93a4c4'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText(`💀 ${r.kills}`, VW - 78, 26);

    // --- xp bar
    const xf = clamp(p.xp / p.xpNext, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 58, VW, 6);
    const xg = ctx.createLinearGradient(0, 0, VW, 0);
    xg.addColorStop(0, '#ffd76b'); xg.addColorStop(1, '#ff9e2c');
    ctx.fillStyle = xg; ctx.fillRect(0, 58, VW * xf, 6);

    // --- hp bar (bottom left)
    const hw = 260, hh = 20, hx = 18, hy = VH - 42;
    ctx.fillStyle = 'rgba(6,10,18,.8)'; ctx.fillRect(hx - 3, hy - 3, hw + 6, hh + 6);
    ctx.fillStyle = '#22182a'; ctx.fillRect(hx, hy, hw, hh);
    const hf = clamp(p.hp / p.maxHp, 0, 1);
    const hg = ctx.createLinearGradient(hx, 0, hx + hw, 0);
    if (hf > 0.35) { hg.addColorStop(0, '#4ade80'); hg.addColorStop(1, '#22c55e'); }
    else { hg.addColorStop(0, '#ff6b6b'); hg.addColorStop(1, '#ff3b3b'); }
    ctx.fillStyle = hg; ctx.fillRect(hx, hy, hw * hf, hh);
    ctx.strokeStyle = '#3f5f96'; ctx.lineWidth = 1.5; ctx.strokeRect(hx, hy, hw, hh);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px ui-monospace,monospace';
    ctx.fillText(`${Math.max(0, Math.ceil(p.hp))} / ${Math.round(p.maxHp)}`, hx + hw / 2, hy + hh / 2 + 0.5);

    // --- loadout icons (bottom right)
    const ids = Object.keys(p.weapons);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ids.forEach((id, i) => {
      const x = VW - 34 - (ids.length - 1 - i) * 44, y = VH - 32;
      ctx.fillStyle = 'rgba(6,10,18,.8)';
      ctx.beginPath(); ctx.roundRect(x - 18, y - 18, 36, 36, 8); ctx.fill();
      ctx.strokeStyle = '#3f5f96'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '19px serif'; ctx.fillText(C.WEAPONS[id].icon, x, y - 3);
      ctx.font = 'bold 9px ui-monospace,monospace'; ctx.fillStyle = '#ffd76b';
      ctx.fillText('L' + p.weapons[id], x, y + 12);
    });

    // --- minimap
    const mw = 132, mh = 88, mx = VW - mw - 16, my = 74;
    ctx.fillStyle = 'rgba(6,10,18,.65)'; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = '#2b3f66'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, mw, mh);
    const sx = mw / WORLD_W, sy = mh / WORLD_H;
    for (const e of r.enemies) {
      ctx.fillStyle = e.isBoss ? '#ff3b3b' : e.def.elite ? '#ff9e2c' : '#5b6b8c';
      const s = e.isBoss ? 4 : e.def.elite ? 3 : 1.5;
      ctx.fillRect(mx + e.x * sx - s / 2, my + e.y * sy - s / 2, s, s);
    }
    ctx.fillStyle = '#4aa3ff';
    ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy, 3, 0, TAU); ctx.fill();

    // --- banner
    if (r.lap > 0) {
      const secs = Math.ceil(r.lap);
      const pulse = 1 - (r.lap % 1);          // swells as each second closes
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(78 + pulse * 26)}px 'Segoe UI',system-ui,sans-serif`;
      ctx.fillStyle = `rgba(110,231,160,${0.32 + pulse * 0.4})`;
      ctx.fillText(String(secs), VW / 2, VH * 0.30);
      ctx.font = "800 15px 'Segoe UI',system-ui,sans-serif";
      ctx.fillStyle = 'rgba(190,255,215,.88)';
      ctx.letterSpacing = '2px';
      ctx.fillText('COLLECT!', VW / 2, VH * 0.30 + 58);
      ctx.letterSpacing = '0px';
      ctx.restore();
    }

    if (r.bannerT > 0) {
      const a = clamp(r.bannerT > 0.6 ? 1 : r.bannerT / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(6,10,18,.78)';
      ctx.fillRect(0, VH / 2 - 66, VW, 118);
      ctx.fillStyle = '#f0a52c'; ctx.fillRect(0, VH / 2 - 66, VW, 2);
      ctx.fillRect(0, VH / 2 + 50, VW, 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd76b'; ctx.font = 'bold 40px "Segoe UI",system-ui,sans-serif';
      ctx.fillText(r.bannerText, VW / 2, VH / 2 - 18);
      ctx.fillStyle = '#a9bad6'; ctx.font = '16px "Segoe UI",system-ui,sans-serif';
      ctx.fillText(r.bannerSub, VW / 2, VH / 2 + 20);
      ctx.globalAlpha = 1;
    }
  };

  // ===========================================================================
  // Public API
  // ===========================================================================
  const WasteHunter = {
    VERSION,
    STAGES: C.STAGES,
    CONTENT: C,
    mount(container, opts) {
      if (typeof container === 'string') container = document.querySelector(container);
      if (!container) throw new Error('WasteHunter.mount: container not found');
      return new Instance(container, opts || {});
    },
    loadMeta: () => loadMeta(true),
    resetMeta() { try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ } },
    money, mmss,
  };

  global.WasteHunter = WasteHunter;
})(typeof window !== 'undefined' ? window : globalThis);
