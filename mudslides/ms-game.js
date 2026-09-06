/* ============================================================================
 * CostBot Mudslides — ENGINE
 * ----------------------------------------------------------------------------
 * Behind-the-back pseudo-3D endless runner. No 3D engine: the hill is a stack
 * of projected trapezoids and every object is a sprite scaled by its distance.
 *
 *   Mudslides.mount(container, { onComplete, onEvent, profile })
 *
 * Projection. The camera sits camBack behind CostBot at camH above the slope,
 * looking down it. For anything at world distance z:
 *     dz     = z - camZ
 *     scale  = FOCAL / dz
 *     screenX = VW/2 + worldX * scale
 *     screenY = HORIZON + (camH - (hill(z) - hill(camZ))) * scale
 * The hill term is what gives crests and dips — the road physically rolls, so
 * hazards crest into view instead of fading in.
 * ==========================================================================*/
((global) => {
  'use strict';

  const C = global.MS_CONTENT;

  // The arcade's shared purse — tokens are earned in any cabinet and spent in
  // any cabinet. Absent only if the script failed to load, in which case the
  // game still runs; it just cannot pay out.
  const NO_WALLET = { tokens: 0, earn: () => 0, spend: () => false, bank: () => 0,
    init: () => ({}), onChange: () => () => {} };
  const wallet = () => global.ArcadeWallet || NO_WALLET;
  const VW = 1152;
  const VH = 648;
  // Camera height and horizon are a pair. Raising CAM_H alone looks down harder
  // but also pushes the whole road — and CostBot with it — toward the bottom of
  // the frame, so the horizon comes up by the same amount the bot would have
  // dropped (CAM_H delta x the scale at CAM_BACK). Net effect: more road surface
  // and less sky, with the player parked where they already were.
  const HORIZON = VH * 0.253;
  const FOCAL = 700;
  const CAM_H = 253;
  const CAM_BACK = 520;   // further back = more convergence = a narrower feel
  const SEG = 55; // road segment length in world units
  const ROAD_HALF = 1.42; // road half-width, in lane widths
  const TAU = Math.PI * 2;
  const STORE_KEY = 'costbot.mudslides.v1';
  const STORE_KEY_OLD = 'costbot.mudsliders.v1';   // the name before the rename

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Wet-mud palette, from the reference: churned brown, darker in the ruts,
  // with a slick sheen where the water sits.
  const MUD = {
    dark: '#33220f', mid: '#452e18', light: '#573a20',
    wet: 'rgba(150,120,86,.20)', rut: 'rgba(28,18,10,.42)',
    splat: 'rgba(30,20,12,.5)', rock: '#6a6157', rockDark: '#4a443c',
  };
  const JUNGLE = ['#16301c', '#183420', '#24512c'];

  // Rolling hill profile. Two waves so the slope never feels periodic.
  const hill = (z) => Math.sin(z * 0.00085) * 150 + Math.sin(z * 0.00219) * 62;
  // stable pseudo-random per world position — mud detail must not crawl
  function noise(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function defaultProfile() {
    return { totalTokens: 0, lifetimeTokens: 0, banked: 0, best: 0, bestDistance: 0,
      runs: 0, achievements: {}, history: [] };
  }

  function loadLocal() {
    try {
      // Read the old key once for anyone who played before the rename; the next
      // save writes it back under the new one and the old copy is dropped.
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY_OLD);
      return raw ? Object.assign(defaultProfile(), JSON.parse(raw)) : defaultProfile();
    } catch {
      return defaultProfile();
    }
  }
  function saveLocal(p) {
    try {
      // Stamped so a server copy that missed a write cannot pass itself off as
      // the newer one — ArcadeSync.reconcile() reads this.
      p.savedAt = Date.now();
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
      localStorage.removeItem(STORE_KEY_OLD);
    } catch { /* private mode */ }
  }

  // Everything a run needs from outside itself. This used to be earned by
  // building app modules; the premise is now simply to collect tokens, so these
  // are flat and the same for everybody.
  function perks() {
    return {
      startShields: C.WORLD.startShields,
      maxShields: C.WORLD.maxShields,
      pickupMul: 1,
      tokenMul: 1,
      startSpeedBonus: 0,
    };
  }

  const CSS = `
.ms-root{position:relative;width:100%;height:100%;background:#05070d;overflow:hidden;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8eef8;user-select:none;}
.ms-frame{position:absolute;transform-origin:top left;width:${VW}px;height:${VH}px;}
.ms-canvas{position:absolute;inset:0;width:${VW}px;height:${VH}px;display:block;touch-action:none;}
.ms-ui{position:absolute;inset:0;pointer-events:none;}
.ms-ui > *{pointer-events:auto;}
.ms-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:radial-gradient(ellipse at 50% 40%,rgba(24,16,10,.94),rgba(4,6,12,.985));
  backdrop-filter:blur(3px);text-align:center;overflow-y:auto;padding:18px 20px;}
/* the summary can outgrow the viewport; scroll it rather than clipping the buttons */
.ms-screen > *{flex:0 0 auto;}
.ms-screen::-webkit-scrollbar{width:8px}
.ms-screen::-webkit-scrollbar-thumb{background:#4a3a28;border-radius:4px}
.ms-title{font-size:56px;font-weight:800;margin:0;letter-spacing:-1.5px;
  background:linear-gradient(180deg,#ffd76b,#ff9e2c 60%,#c8631a);-webkit-background-clip:text;
  background-clip:text;color:transparent;}
.ms-sub{font-size:16px;color:#a9927a;margin:8px 0 0;}
.ms-hero{width:132px;animation:ms-bob 2.4s ease-in-out infinite;
  filter:drop-shadow(0 12px 26px rgba(255,150,60,.4));}
@keyframes ms-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-10px) rotate(4deg)}}
/* CostBot riding the drink the hill is named after */
.ms-heroes{display:flex;align-items:flex-end;justify-content:center;gap:2px;}
.ms-glass{width:90px;animation:ms-tilt 2.4s ease-in-out infinite .3s;
  filter:drop-shadow(0 10px 20px rgba(0,0,0,.6));}
@keyframes ms-tilt{0%,100%{transform:translateY(4px) rotate(7deg)}50%{transform:translateY(-6px) rotate(-5deg)}}
/* the wipeout shot — a photo tile, so it gets a frame rather than a drop shadow */
/* 186px is the largest that keeps the whole result screen inside the viewport */
.ms-wipe{width:186px;border-radius:14px;border:1px solid #4a3a28;display:block;
  box-shadow:0 18px 44px rgba(0,0,0,.65);}
.ms-btn{background:linear-gradient(180deg,#f0a52c,#d4821a);border:1px solid #ffc866;color:#241403;
  padding:14px 34px;border-radius:11px;font-size:17px;font-weight:750;cursor:pointer;font-family:inherit;
  box-shadow:0 4px 0 #8a5410,0 8px 20px rgba(220,140,30,.3);transition:.14s;}
.ms-btn:hover{transform:translateY(-2px);box-shadow:0 6px 0 #8a5410,0 12px 26px rgba(220,140,30,.4);}
.ms-btn.ghost{background:rgba(255,255,255,.06);border-color:#4a3a28;color:#e0cdb4;box-shadow:none;
  padding:10px 20px;font-size:14px;}
.ms-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:16px;}
.ms-keys{margin-top:20px;font-size:13px;color:#8a7a68;}
.ms-kbd{display:inline-block;background:#241a12;border:1px solid #4a3a28;border-bottom-width:2px;
  border-radius:5px;padding:1px 8px;font-family:ui-monospace,monospace;font-size:12px;color:#e0cdb4;margin:0 2px;}
.ms-panel{background:linear-gradient(180deg,#1d1610,#0d0a07);border:1px solid #4a3a28;border-radius:16px;
  padding:16px 26px;min-width:440px;box-shadow:0 24px 60px rgba(0,0,0,.6);margin-top:14px;}
.ms-stat{display:flex;justify-content:space-between;padding:5px 0;font-size:14.5px;border-bottom:1px solid #2b2119;}
.ms-stat:last-child{border-bottom:none;}
/* the arcade token, shared art — the same coin in every cabinet */
.ms-coin{width:15px;height:15px;vertical-align:-3px;margin-right:5px;}
.ms-coin.lg{width:22px;height:22px;vertical-align:-5px;margin-right:6px;}
.ms-stat b{color:#ffd76b;font-variant-numeric:tabular-nums;}
.ms-hint{color:#7d6b58;font-size:11.5px;font-style:normal;margin-left:6px;}
.ms-big{font-size:40px;font-weight:800;color:#ffd76b;text-align:center;font-variant-numeric:tabular-nums;
  text-shadow:0 4px 22px rgba(240,165,44,.3);margin:2px 0 4px;}
.ms-blurb{max-width:620px;margin:10px 0 0;font-size:14px;line-height:1.6;color:#8d7a66;}
.ms-bank{margin-top:14px;background:linear-gradient(180deg,#1d1610,#0d0a07);border:1px solid #4a3a28;
  border-radius:12px;padding:9px 20px;}
.ms-bank-row{display:flex;gap:12px;align-items:center;font-size:13.5px;color:#a9927a;}
.ms-bank-row b{color:#ffd76b;font-variant-numeric:tabular-nums;}
.ms-bank-sep{width:1px;height:14px;background:#4a3a28;}
/* --- how to play --- */
.ms-brief-title{font-size:27px;margin:0;color:#ffd76b;font-weight:800;letter-spacing:-.5px;}
.ms-brief{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;max-width:960px;margin-top:10px;
  text-align:left;align-items:start;}
.ms-brief section{background:linear-gradient(180deg,#1a1410,#0c0906);border:1px solid #3a2d20;
  border-radius:13px;padding:11px 15px;}
.ms-brief h4{margin:0 0 8px;font-size:11.5px;letter-spacing:1.4px;color:#f0a52c;text-transform:uppercase;}
.ms-brief p{margin:0 0 7px;font-size:13px;line-height:1.55;color:#bda88f;}
.ms-brief p:last-child{margin-bottom:0;}
.ms-brief-row{display:flex;gap:9px;align-items:baseline;font-size:13px;line-height:1.5;
  color:#bda88f;margin-bottom:5px;}
.ms-brief-row b{color:#e8dcc8;}
.ms-brief-row i{color:#8a7a68;font-size:12px;}
.ms-dot{flex:0 0 auto;width:11px;height:11px;border-radius:50%;transform:translateY(1px);}
.ms-pico{flex:0 0 auto;width:22px;height:22px;border:1px solid;border-radius:6px;display:inline-flex;
  align-items:center;justify-content:center;font-size:12px;background:#120d09;}
.ms-fine{font-size:12px !important;color:#8a7a68 !important;margin-top:8px !important;}
/* --- achievements --- */
.ms-achs{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px;max-width:800px;margin-top:14px;
  text-align:left;}
.ms-ach{display:flex;gap:11px;align-items:center;background:#140f0b;border:1px solid #2e241a;
  border-radius:11px;padding:9px 13px;opacity:.55;}
.ms-ach.on{opacity:1;border-color:#6ee7a0;background:linear-gradient(180deg,#13251a,#0d1410);}
.ms-ach-i{font-size:21px;flex:0 0 auto;filter:grayscale(1);}
.ms-ach.on .ms-ach-i{filter:none;}
.ms-ach b{display:block;font-size:13.5px;color:#e8dcc8;}
.ms-ach.on b{color:#8ff0ad;}
.ms-ach i{display:block;font-size:11.5px;color:#8a7a68;font-style:normal;margin-top:1px;}
/* --- leaderboard --- */
.ms-board{margin-top:12px;width:100%;max-width:820px;background:linear-gradient(180deg,#1a1410,#0c0906);
  border:1px solid #3a2d20;border-radius:13px;overflow:hidden;}
.ms-board table{width:100%;border-collapse:collapse;}
.ms-board th{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a7a68;font-weight:700;
  padding:9px 14px;border-bottom:1px solid #2e241a;text-align:left;}
.ms-board th.n{text-align:right;cursor:pointer;user-select:none;}
.ms-board th.n:hover{color:#ffd76b;}
.ms-board th.on{color:#f0a52c;}
.ms-board td{padding:8px 14px;font-size:13.5px;border-bottom:1px solid #1e1811;color:#bda88f;}
.ms-board td.n{text-align:right;font-variant-numeric:tabular-nums;}
.ms-board td.on{color:#ffd76b;font-weight:700;}
.ms-board td.r,.ms-board th.r{width:44px;color:#7d6b58;font-weight:700;}
.ms-board tr:last-child td{border-bottom:none;}
.ms-board-empty{text-align:center !important;color:#7d6b58 !important;padding:26px 14px !important;}
@keyframes ms-pop{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
.ms-toasts{position:absolute;top:70px;right:16px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.ms-toast{background:linear-gradient(180deg,#2a2312,#191308);border:1px solid #f0a52c;border-radius:10px;
  padding:8px 13px;font-size:12.5px;color:#ffd76b;font-weight:650;animation:ms-slide .3s ease;}
@keyframes ms-slide{from{transform:translateX(50px);opacity:0}to{transform:translateX(0);opacity:1}}
`;

  function injectCSS() {
    if (document.getElementById('ms-style')) return;
    const s = document.createElement('style');
    s.id = 'ms-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ===========================================================================
  function Game(container, opts) {
    injectCSS();
    this.opts = opts || {};
    this.onComplete = this.opts.onComplete || (() => {});
    this.onEvent = this.opts.onEvent || (() => {});
    this.assetBase = this.opts.assetBase || '../waste-hunter/assets/';
    this.spriteBase = this.opts.spriteBase || 'assets/';
    this.profile = Object.assign(defaultProfile(), this.opts.profile || loadLocal());
    this.destroyed = false;
    this.toasts = [];

    const root = document.createElement('div');
    root.className = 'ms-root';
    root.innerHTML = `<div class="ms-frame">
      <canvas class="ms-canvas" width="${VW}" height="${VH}"></canvas>
      <div class="ms-ui"></div></div>`;
    container.innerHTML = '';
    container.appendChild(root);
    this.root = root;
    this.frame = root.querySelector('.ms-frame');
    this.canvas = root.querySelector('.ms-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ui = root.querySelector('.ms-ui');

    this.img = {};
    // The arcade token — shared art, so the currency looks the same in every
    // cabinet. It lives beside the other shared assets, not in either game's pile.
    this.img.coin = new Image();
    this.img.coin.src = '../shared/assets/token-coin-64.png';
    ['costbot', 'inspire', 'max_speed_clean'].forEach((k) => {
      const im = new Image();
      im.src = this.assetBase + k + '.png';
      this.img[k] = im;
    });
    // Mudslides' own art lives next to the game, not in Waste Hunter's asset pile.
    ['mudslide', 'slider'].forEach((k) => {
      const im = new Image();
      im.src = this.spriteBase + k + '.png';
      this.img[k] = im;
    });

    // --- audio: shares the arcade bus so M mutes everything -----------------
    this.audio = makeAudio();
    const MUSIC = global.ArcadeMusic;
    this.music = MUSIC ? MUSIC.create(() => this.audio.nodes()) : null;

    // --- input ---------------------------------------------------------------
    this._onKey = (e) => {
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      if (k === 'm') { this.audio.toggle(); return; }
      if (!this.run || this.run.over) {
        if (k === ' ' || k === 'enter') this.start();
        return;
      }
      if (k === 'arrowleft' || k === 'a') this.shift(-1);
      else if (k === 'arrowright' || k === 'd') this.shift(1);
      else if (k === 'arrowup' || k === 'w' || k === ' ') this.jump();
      else if (k === 'arrowdown' || k === 's') this.slide();
    };
    window.addEventListener('keydown', this._onKey);

    // touch: one continuous hold, not a swipe-release-swipe-release cycle.
    // The reference point re-centers every time a direction fires, so
    // rocking a thumb left/right/up/down in a single unbroken touch chains
    // lane-shifts, jumps and slides without ever lifting.
    const DRAG_THRESH = 26;
    this._drag = { active: false, id: null, x: 0, y: 0 };
    this._onDown = (e) => {
      this.audio.resume();
      if (this.music) this.music.setState('stage');
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!this.run || this.run.over) { this.start(); return; }
      this._drag.active = true; this._drag.id = e.pointerId;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      if (this.canvas.setPointerCapture) { try { this.canvas.setPointerCapture(e.pointerId); } catch (_e) {} }
    };
    this._onDragMove = (e) => {
      const d = this._drag;
      if (!d.active || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) < DRAG_THRESH && Math.abs(dy) < DRAG_THRESH) return;
      if (Math.abs(dx) > Math.abs(dy)) this.shift(dx > 0 ? 1 : -1);
      else if (dy < 0) this.jump();
      else this.slide();
      // re-center so the next flick fires from wherever the thumb is now,
      // instead of requiring a return to the original touch-down point
      d.x = e.clientX; d.y = e.clientY;
    };
    this._onDragEnd = (e) => {
      const d = this._drag;
      if (d.active && (!e || e.pointerId === d.id)) { d.active = false; d.id = null; }
    };
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onDragMove);
    this.canvas.addEventListener('pointerup', this._onDragEnd);
    this.canvas.addEventListener('pointercancel', this._onDragEnd);

    this._resize = () => {
      const r = container.getBoundingClientRect();
      const s = Math.min(r.width / VW, r.height / VH);
      this.frame.style.transform = `scale(${s})`;
      this.frame.style.left = `${(r.width - VW * s) / 2}px`;
      this.frame.style.top = `${(r.height - VH * s) / 2}px`;
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();

    this.run = null;
    this.last = performance.now();
    this._tick = (now) => {
      if (this.destroyed) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      dt = Math.min(dt, 0.05);
      if (this.run && !this.run.over) this.update(dt);
      this.render();
      requestAnimationFrame(this._tick);
    };
    requestAnimationFrame(this._tick);

    this.screenTitle();
  }

  // --- tiny synth, same shape as Waste Hunter's so music can share the bus ---
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
      o.type = type || 'square';
      o.frequency.setValueAtTime(f, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + d);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v || 0.16, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + d + 0.02);
    }
    // short filtered-noise transient — gives a pickup a physical "tick" so it
    // cuts through the music instead of sitting behind it
    function tick(v, hp, d) {
      if (muted) return;
      const c = ensure(); if (!c) return;
      const n = Math.max(1, Math.floor(c.sampleRate * (d || 0.05)));
      const b = c.createBuffer(1, n, c.sampleRate);
      const ch = b.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 3800;
      const g = c.createGain(); g.gain.value = v;
      s.connect(f); f.connect(g); g.connect(master); s.start();
    }
    // A coin ladder: consecutive pickups climb the scale and reset when you go
    // quiet, so a good line through a token trail sounds like a run of wins.
    const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    let chain = 0, chainAt = 0;
    return {
      nodes() { const c = ensure(); return c ? { ctx: c, master } : null; },
      token() {
        const now = performance.now();
        chain = now - chainAt < 900 ? Math.min(chain + 1, LADDER.length - 1) : 0;
        chainAt = now;
        const f = 1046.5 * 2 ** (LADDER[chain] / 12);
        tick(0.14, 5200, 0.035);
        tone(f, 0.10, 'triangle', 0.30, f * 1.5);           // body
        tone(f * 2, 0.085, 'sine', 0.20, f * 3);            // sparkle on top
        tone(f * 1.5, 0.07, 'sine', 0.11, f * 2.25, 0.035); // a fifth, a hair late
      },
      big: () => { tick(0.2, 3200, 0.08); tone(760, 0.16, 'triangle', 0.3, 1240);
        tone(1140, 0.2, 'sine', 0.2, 1900, 0.05); },
      jump: () => tone(420, 0.14, 'square', 0.07, 780),
      slide: () => tone(300, 0.16, 'sawtooth', 0.06, 160),
      power: () => { [660, 880, 1180, 1560].forEach((f, i) => {
        tone(f, 0.18, 'triangle', 0.2, null, i * 0.055);
        tone(f * 2, 0.12, 'sine', 0.09, null, i * 0.055);
      }); },
      // the glass: a wet gulp, then the shield ring
      drink: () => { tick(0.14, 900, 0.12); tone(240, 0.16, 'sine', 0.22, 520);
        [784, 1046, 1568].forEach((f, i) => { tone(f, 0.3, 'triangle', 0.16, null, 0.14 + i * 0.06); }); },
      // a wipeout still has to land harder than a coin does
      crash: () => { tick(0.22, 600, 0.3); tone(180, 0.5, 'sawtooth', 0.28, 50); },
      shield: () => tone(520, 0.3, 'sine', 0.14, 900),
      splash: (v) => tick(0.07 * (v || 1), 1400, 0.16),
      toggle() {
        muted = !muted;
        const c = ensure();
        if (c && master) master.gain.setTargetAtTime(muted ? 0.0001 : 0.32, c.currentTime, 0.05);
        return muted;
      },
      resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    };
  }

  Game.prototype.emit = function (t, p) { try { this.onEvent(t, p || {}); } catch (e) { console.error(e); } };

  Game.prototype.destroy = function () {
    this.destroyed = true;
    if (this.music) this.music.stop();
    window.removeEventListener('keydown', this._onKey);
    if (this._ro) this._ro.disconnect();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  // ===========================================================================
  // SCREENS
  // ===========================================================================
  Game.prototype.clearUI = function () { this.ui.innerHTML = ''; };

  // Your lifetime haul. There is no build to finish any more — the tokens
  // themselves are the point, here and in every other cabinet.
  Game.prototype.bank = function () {
    const p = this.profile;
    const total = Math.floor(p.totalTokens || 0);
    return `<div class="ms-bank">
      <div class="ms-bank-row">
        <span><img class="ms-coin" src="../shared/assets/token-coin-64.png" alt=""><b>${total.toLocaleString()}</b> tokens collected all-time</span>
        <span class="ms-bank-sep"></span>
        <span>best run <b>${Math.floor(p.best || 0).toLocaleString()}</b></span>
        <span class="ms-bank-sep"></span>
        <span><b>${(p.runs || 0).toLocaleString()}</b> ${p.runs === 1 ? 'run' : 'runs'}</span>
      </div>
    </div>`;
  };

  Game.prototype.screenTitle = function () {
    this.run = null;
    this.clearUI();
    if (this.music) this.music.playTrack('menu');
    const tip = C.TIPS[(Math.random() * C.TIPS.length) | 0];
    const el = document.createElement('div');
    el.className = 'ms-screen';
    el.innerHTML = `
      <div class="ms-heroes">
        <img class="ms-hero" src="${this.assetBase}costbot.png" alt="">
        <img class="ms-glass" src="${this.spriteBase}mudslide.png" alt="">
      </div>
      <h1 class="ms-title">CostBot Mudslides</h1>
      <p class="ms-sub">Slide the hill. Collect the tokens. Enjoy the mudslides.</p>
      <p class="ms-blurb">The arcade runs on AI tokens, and the hill is where they
         wash down. Every vendor on the megabill has planted a sign in the mud.</p>
      ${this.bank()}
      <div class="ms-row">
        <button class="ms-btn" data-act="go">▶ Drop In</button>
        <button class="ms-btn ghost" data-act="how">How to play</button>
        <button class="ms-btn ghost" data-act="achievements">🏅 Achievements</button>
        <button class="ms-btn ghost" data-act="board">📊 Leaderboard</button>
      </div>
      <div class="ms-keys">
        <span class="ms-kbd">← →</span> switch lane &nbsp;
        <span class="ms-kbd">↑ / Space</span> jump &nbsp;
        <span class="ms-kbd">↓</span> slide &nbsp;
        <span class="ms-kbd">M</span> mute
      </div>
      <p class="ms-sub" style="font-size:13px;font-style:italic;margin-top:14px">💡 ${esc(tip)}</p>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="go"]')) { this.audio.resume(); this.start(); }
      else if (e.target.closest('[data-act="how"]')) this.screenBriefing();
      else if (e.target.closest('[data-act="achievements"]')) this.screenAchievements();
      else if (e.target.closest('[data-act="board"]')) this.screenBoard();
    });
  };

  // ---------------------------------------------------------------------------
  // HOW TO PLAY. The prose comes from C.BRIEFING; every table on this screen is
  // generated from the balance data, so it cannot describe a game we do not ship.
  // ---------------------------------------------------------------------------
  Game.prototype.screenBriefing = function () {
    const B = C.BRIEFING;
    const el = document.createElement('div');
    this.clearUI();
    el.className = 'ms-screen';

    const tokens = Object.keys(C.TOKENS).map((k) => {
      const t = C.TOKENS[k];
      return `<div class="ms-brief-row">
        <i class="ms-dot" style="background:${t.color};box-shadow:0 0 10px ${t.glow}"></i>
        <span><b>${esc(t.name)}</b> — ${t.value} ${t.value === 1 ? 'token' : 'tokens'}${
        t.streakBonus ? `, in trails; clear one for +${t.streakBonus}` : ''}</span>
      </div>`;
    }).join('');

    const hazards = B.hazards.map((h) => {
      const names = Object.keys(C.OBSTACLES)
        .filter((k) => C.OBSTACLES[k].kind === h.kind && !C.OBSTACLES[k].vendor)
        .map((k) => C.OBSTACLES[k].name);
      return `<div class="ms-brief-row">
        <span class="ms-kbd">${h.key}</span>
        <span><b>${esc(h.label)}</b> — ${esc(h.note)}${
        names.length ? ` <i>(${names.map(esc).join(', ')})</i>` : ''}</span>
      </div>`;
    }).join('');

    const powers = Object.keys(C.POWERUPS).map((k) => {
      const p = C.POWERUPS[k];
      return `<div class="ms-brief-row">
        <span class="ms-pico" style="border-color:${p.color}">${p.icon}</span>
        <span><b style="color:${p.color}">${esc(p.name)}</b> — ${esc(p.blurb)}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <h2 class="ms-brief-title">How to play</h2>
      <div class="ms-brief">
        <section>
          <h4>Why the hill</h4>
          ${B.story.map((p) => `<p>${esc(p)}</p>`).join('')}
        </section>
        <section>
          <h4>Tokens — the score</h4>
          ${tokens}
          <p class="ms-fine">You also earn a token every ${C.SCORING.distanceTokensPer}m survived,
             +${C.SCORING.nearMissTokens} for each near miss, and double on every pickup
             above ${C.SCORING.speedBonusAt} speed. Tokens bank to the arcade even when you crash.</p>
        </section>
        <section>
          <h4>What is in the way</h4>
          ${hazards}
          <p class="ms-fine">The signs are the real megabill: ${
        C.VENDORS.slice(0, 5).map((v) => esc(v.name)).join(', ')} and more.
             Whichever one gets you is named on the wipeout screen.</p>
        </section>
        <section>
          <h4>Power-ups</h4>
          ${powers}
          <p class="ms-fine">Drinking a Mudslide gives you a shield — it absorbs one
             wipeout and keeps the run alive. They stack ${C.WORLD.maxShields} high.</p>
        </section>
      </div>
      <div class="ms-row">
        <button class="ms-btn" data-act="go">▶ Drop In</button>
        <button class="ms-btn ghost" data-act="menu">Back</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="go"]')) { this.audio.resume(); this.start(); }
      else if (e.target.closest('[data-act="menu"]')) this.screenTitle();
    });
  };

  // ---------------------------------------------------------------------------
  // ACHIEVEMENTS. Earned ones light up; the rest stay legible so they read as
  // goals rather than blanks.
  // ---------------------------------------------------------------------------
  Game.prototype.screenAchievements = function () {
    const got = this.profile.achievements || {};
    const done = C.ACHIEVEMENTS.filter((a) => got[a.id]).length;
    const el = document.createElement('div');
    this.clearUI();
    el.className = 'ms-screen';
    el.innerHTML = `
      <h2 class="ms-brief-title">Achievements</h2>
      <p class="ms-sub">${done} of ${C.ACHIEVEMENTS.length} earned</p>
      <div class="ms-achs">
        ${C.ACHIEVEMENTS.map((a) => `<div class="ms-ach ${got[a.id] ? 'on' : ''}">
          <span class="ms-ach-i">${got[a.id] ? a.icon : '🔒'}</span>
          <span>
            <b>${esc(a.name)}</b>
            <i>${esc(a.desc)}</i>
          </span>
        </div>`).join('')}
      </div>
      <div class="ms-row">
        <button class="ms-btn" data-act="go">▶ Drop In</button>
        <button class="ms-btn ghost" data-act="menu">Back</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="go"]')) { this.audio.resume(); this.start(); }
      else if (e.target.closest('[data-act="menu"]')) this.screenTitle();
    });
  };

  // ---------------------------------------------------------------------------
  // LEADERBOARD. Four metrics, one sortable table, click a column to rank by it.
  //
  // Two sources, same shape. On the dynamic app the server ranks every player's
  // best on each metric; on static hosting there is no API, so it falls back to
  // your own run history — which is also all there is to show before anyone
  // else has played.
  // ---------------------------------------------------------------------------
  const BOARD_COLS = [
    { key: 'tokens', label: 'Tokens' },
    { key: 'distance', label: 'Distance', unit: 'm' },
    { key: 'nearMisses', label: 'Near misses' },
    { key: 'topSpeed', label: 'Top speed' },
  ];

  Game.prototype.screenBoard = function (sortBy) {
    const sort = sortBy || this._boardSort || 'tokens';
    this._boardSort = sort;
    const el = document.createElement('div');
    this.clearUI();
    el.className = 'ms-screen';
    el.innerHTML = `<h2 class="ms-brief-title">Leaderboard</h2>
      <p class="ms-sub">Loading…</p>`;
    this.ui.appendChild(el);

    const render = (rows, who, note) => {
      rows = rows.slice().sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
      el.innerHTML = `
        <h2 class="ms-brief-title">Leaderboard</h2>
        <p class="ms-sub">${esc(note)}</p>
        <div class="ms-board">
          <table>
            <thead><tr>
              <th class="r">#</th><th>${esc(who)}</th>
              ${BOARD_COLS.map((c) => `<th class="n ${c.key === sort ? 'on' : ''}"
                data-sort="${c.key}">${esc(c.label)}${c.key === sort ? ' ▾' : ''}</th>`).join('')}
            </tr></thead>
            <tbody>${rows.length ? rows.map((r, i) => `<tr>
              <td class="r">${i + 1}</td>
              <td>${esc(r.who)}</td>
              ${BOARD_COLS.map((c) => `<td class="n ${c.key === sort ? 'on' : ''}">${
                (r[c.key] || 0).toLocaleString()}${c.unit ? ' ' + c.unit : ''}</td>`).join('')}
            </tr>`).join('') : `<tr><td colspan="6" class="ms-board-empty">
              No runs yet. Drop in and you are the first name here.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="ms-row">
          <button class="ms-btn" data-act="go">▶ Drop In</button>
          <button class="ms-btn ghost" data-act="menu">Back</button>
        </div>`;
    };

    el.addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (th) { this.screenBoard(th.dataset.sort); return; }
      if (e.target.closest('[data-act="go"]')) { this.audio.resume(); this.start(); }
      else if (e.target.closest('[data-act="menu"]')) this.screenTitle();
    });

    const local = () => {
      const hist = (this.profile.history || []).map((h, i) => ({
        who: new Date(h.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          + (i === 0 ? ' · latest' : ''),
        tokens: h.tokens, distance: h.distance,
        nearMisses: h.nearMisses, topSpeed: h.topSpeed,
      }));
      render(hist, 'Your runs', 'Your own runs — sign in on the arcade app to rank against everyone.');
    };

    const sync = global.ArcadeSync;
    if (!sync || !sync.enabled || !sync.gameBoards) { local(); return; }
    sync.gameBoards('mudslides').then((data) => {
      if (this.destroyed) return;
      if (!data || !data.metrics) { local(); return; }
      // The server ranks each metric independently; fold them into one row per
      // player so a single table can be sorted by any column.
      const byPlayer = new Map();
      for (const key of Object.keys(data.metrics)) {
        for (const row of data.metrics[key] || []) {
          const p = byPlayer.get(row.player) || { who: row.player };
          p[key] = Math.max(p[key] || 0, row.value);
          byPlayer.set(row.player, p);
        }
      }
      const rows = [...byPlayer.values()];
      if (!rows.length) { local(); return; }
      render(rows, 'Player', 'Everyone’s best on each metric. Click a column to sort.');
    }).catch(local);
  };

  // A wipeout screen you will see hundreds of times wants more than one picture.
  // Rotated at random rather than cycled: a cycle is predictable enough that the
  // third one stops registering.
  const WIPEOUT_SHOTS = ['wipeout.jpg', 'wipeout-surgery.jpg', 'wipeout-megabill.jpg'];
  let lastShot = null;
  // Never the same shot twice running. Pure random over three pictures repeats
  // about a third of the time, which reads as "it isn't rotating".
  const pickShot = () => {
    const choices = WIPEOUT_SHOTS.filter((s) => s !== lastShot);
    lastShot = choices[(Math.random() * choices.length) | 0];
    return lastShot;
  };

  Game.prototype.screenOver = function (res) {
    this.clearUI();
    if (this.music) this.music.playTrack('menu');
    const el = document.createElement('div');
    el.className = 'ms-screen';
    el.innerHTML = `
      <img class="ms-wipe" src="${this.spriteBase}${pickShot()}"
           alt="CostBot, not having his best run">
      <h2 style="font-size:30px;margin:8px 0 2px;color:#ff8a8a">WIPEOUT</h2>
      <p class="ms-sub">${esc(res.cause)}</p>
      <div class="ms-panel">
        <div style="text-align:center;font-size:12px;color:#a9927a;letter-spacing:1.2px">TOKENS COLLECTED</div>
        <div class="ms-big">${res.tokens.toLocaleString()}</div>
        <div class="ms-stat"><span>📏 Distance</span><b>${res.distance.toLocaleString()} m</b></div>
        <div class="ms-stat"><span>🌬️ Near misses</span><b>${res.nearMisses}</b></div>
        <div class="ms-stat"><span>⚡ Top speed</span><b>${Math.round(res.topSpeed)}</b></div>
        ${res.best ? '<div class="ms-stat"><span>🏅 New personal best</span><b>yes</b></div>' : ''}
      </div>
      ${this.bank()}
      <div class="ms-row">
        <button class="ms-btn" data-act="again">↻ Again</button>
        <button class="ms-btn ghost" data-act="board">📊 Leaderboard</button>
        <button class="ms-btn ghost" data-act="menu">Menu</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'again') this.start();
      else if (a.dataset.act === 'board') this.screenBoard();
      else this.screenTitle();
    });
  };

  Game.prototype.toast = function (text) {
    let box = this.root.querySelector('.ms-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ms-toasts'; this.ui.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'ms-toast';
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .35s'; t.style.opacity = '0';
      setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 380);
    }, 2200);
  };

  // ===========================================================================
  // RUN
  // ===========================================================================
  Game.prototype.start = function () {
    const pk = perks();
    this.clearUI();
    if (this.music) this.music.playTrack('mudslide');
    this.run = {
      z: 0, speed: C.WORLD.startSpeed + pk.startSpeedBonus, topSpeed: 0,
      lane: 1, laneFrom: 1, laneT: 1,
      y: 0, vy: 0, jumping: false, sliding: 0,
      shields: pk.startShields, maxShields: pk.maxShields,
      tokens: 0, nearMisses: 0, distance: 0, t: 0,
      objs: [], fx: [], floats: [],
      spray: [], ripples: [], sprayAcc: 0, rippleAcc: 0, wasJumping: false,
      nextRowZ: C.DIFFICULTY.firstRowZ, nextPowerZ: C.DIFFICULTY.powerupEvery,
      power: {}, tarUntil: 0, invuln: 0,
      shake: 0, over: false, cause: '', perks: pk,
      cachedStreak: 0, lastShiftZ: -1e9,
    };
    this.emit('run:start', {});
  };

  Game.prototype.shift = function (dir) {
    const r = this.run;
    if (!r || r.over) return;
    const to = clamp(r.lane + dir, 0, 2);
    if (to === r.lane) return;
    r.laneFrom = this.laneX(r) / C.WORLD.laneWidth + 1;
    r.lane = to;
    r.laneT = 0;
    r.lastShiftZ = r.z;
  };
  Game.prototype.laneX = (r) => {
    const from = (r.laneFrom - 1) * C.WORLD.laneWidth;
    const to = (r.lane - 1) * C.WORLD.laneWidth;
    const t = clamp(r.laneT, 0, 1);
    return from + (to - from) * (t * t * (3 - 2 * t));
  };
  Game.prototype.jump = function () {
    const r = this.run;
    if (!r || r.over || r.jumping) return;
    const boost = r.power.graviton ? 1.22 : 1;
    r.vy = C.WORLD.jump.impulse * boost;
    r.jumping = true;
    r.sliding = 0;
    this.audio.jump();
  };
  Game.prototype.slide = function () {
    const r = this.run;
    if (!r || r.over || r.sliding > 0) return;
    if (r.jumping) { r.vy = Math.min(r.vy, -400); return; }  // fast-fall
    r.sliding = C.WORLD.slideTime;
    this.audio.slide();
  };

  // --- spawning --------------------------------------------------------------
  // A vendor obstacle picks its brand here, once, so the sign you read at 2,000
  // metres is the same one the wipeout screen blames.
  Game.prototype.makeObstacle = (type, lane, atZ) => {
    const def = C.OBSTACLES[type];
    const o = { kind: 'obs', type, def, lane, z: atZ, hit: false, passed: false };
    if (def.vendor) o.vendor = C.VENDORS[(Math.random() * C.VENDORS.length) | 0];
    return o;
  };

  Game.prototype.spawnRow = function (atZ) {
    const r = this.run;
    const m = r.distance;
    const avail = C.SPAWN_TABLE.filter((x) => m >= x.from && x.type !== 'billing_gap');
    const lanes = [0, 1, 2];

    // A chasm is a hole in the hill, not a thing in a lane — it spans the road,
    // so it is spawned on its own and every lane must jump it. Tokens float over
    // it as bait, which is the whole point of a gap.
    if (m >= C.DIFFICULTY.chasmFrom && Math.random() < C.DIFFICULTY.chasmChance) {
      r.objs.push({
        kind: 'obs', type: 'billing_gap', def: C.OBSTACLES.billing_gap,
        lane: 1, z: atZ, full: true, hit: false, passed: false,
      });
      for (const lane of lanes) {
        if (Math.random() < 0.5) {
          r.objs.push({ kind: 'tok', tok: 'output', lane, z: atZ, got: false });
        }
      }
      return;
    }

    // Only a 'block' kind actually closes a lane — jump/slide/tar are all passable
    // in place. So a row may contain several hazards, but never more than one true
    // block, and at least one lane always stays block-free. That keeps a row
    // readable at speed instead of turning it into a coin flip.
    const passable = avail.filter((x) => C.OBSTACLES[x.type].kind !== 'block');
    const blockers = avail.filter((x) => C.OBSTACLES[x.type].kind === 'block');
    const pick = (pool) => {
      if (!pool.length) return null;
      const total = pool.reduce((a, x) => a + x.weight, 0);
      let roll = Math.random() * total;
      for (const x of pool) {
        roll -= x.weight;
        if (roll <= 0) return x.type;
      }
      return pool[pool.length - 1].type;
    };

    const used = [];
    // one hard block, in a random lane
    if (blockers.length && Math.random() < 0.8) {
      const lane = lanes.splice((Math.random() * lanes.length) | 0, 1)[0];
      const type = pick(blockers);
      r.objs.push(this.makeObstacle(type, lane, atZ));
      used.push(lane);
    }
    // passable hazards elsewhere — density climbs with distance
    const extra = m < 500 ? 0 : m < 1400 ? 1 : 2;
    for (let i = 0; i < extra && lanes.length > 1 && passable.length; i++) {
      if (Math.random() > 0.55) continue;
      const lane = lanes.splice((Math.random() * lanes.length) | 0, 1)[0];
      const type = pick(passable);
      r.objs.push(this.makeObstacle(type, lane, atZ));
      used.push(lane);
    }

    // tokens in whatever is left open
    for (const lane of lanes) {
      if (Math.random() > C.DIFFICULTY.tokenChance) continue;
      if (Math.random() < C.DIFFICULTY.trailChance) {
        for (let i = 0; i < 6; i++) {
          r.objs.push({ kind: 'tok', tok: 'cached', lane, z: atZ - 220 + i * 90, got: false, trail: true });
        }
      } else {
        const t = Math.random() < 0.18 ? 'output' : 'input';
        r.objs.push({ kind: 'tok', tok: t, lane, z: atZ, got: false });
      }
    }
  };

  Game.prototype.spawnPower = function (atZ) {
    const keys = Object.keys(C.POWERUPS);
    const total = keys.reduce((a, k) => a + (C.POWERUPS[k].weight || 1), 0);
    let roll = Math.random() * total;
    let id = keys[keys.length - 1];
    for (const k of keys) {
      roll -= C.POWERUPS[k].weight || 1;
      if (roll <= 0) { id = k; break; }
    }
    this.run.objs.push({ kind: 'pow', id, lane: (Math.random() * 3) | 0, z: atZ, got: false });
  };

  // ===========================================================================
  Game.prototype.update = function (dt) {
    const r = this.run;
    const W = C.WORLD;
    r.t += dt;                      // wall-clock of the run, for the usage rollup

    // speed
    const tarred = r.tarUntil > 0;
    if (tarred) r.tarUntil -= dt;
    r.speed = Math.min(W.maxSpeed, r.speed + W.accel * dt);
    let eff = r.speed;
    if (tarred) eff *= C.OBSTACLES.support_tar.slow;
    if (r.power.batch) eff *= 0.72;
    if (r.power.spot) eff *= 1.5;
    if (r.power.graviton) eff *= 1.12;
    r.topSpeed = Math.max(r.topSpeed, eff);
    if (eff >= W.maxSpeed - 1) this.unlock('ms_topspeed');

    r.z += eff * dt;
    r.distance = Math.floor(r.z / 10);

    // lane interpolation
    if (r.laneT < 1) r.laneT = Math.min(1, r.laneT + dt / W.laneShiftTime);

    // vertical
    if (r.jumping) {
      r.vy -= W.jump.gravity * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) { r.y = 0; r.vy = 0; r.jumping = false; }
    }
    if (r.sliding > 0) r.sliding -= dt;
    if (r.invuln > 0) r.invuln -= dt;
    if (r.shake > 0) r.shake = Math.max(0, r.shake - dt * 40);

    // power timers
    for (const k of Object.keys(r.power)) {
      r.power[k] -= dt;
      if (r.power[k] <= 0) delete r.power[k];
    }

    // spawn ahead
    while (r.nextRowZ < r.z + W.drawDistance) {
      this.spawnRow(r.nextRowZ);
      // space the next row by how long the player gets to read it, at the speed
      // they will actually be doing when they arrive
      r.nextRowZ += Math.max(C.DIFFICULTY.minGap, eff * C.DIFFICULTY.reactionAt(r.distance));
    }
    if (r.z + W.drawDistance > r.nextPowerZ) {
      this.spawnPower(r.nextPowerZ);
      r.nextPowerZ += C.DIFFICULTY.powerupEvery;
    }

    // distance tokens
    const dTok = (eff * dt) / 10 / C.SCORING.distanceTokensPer;
    r.tokens += dTok * r.perks.tokenMul;

    // interactions
    const px = this.laneX(r);
    const pickR = 120 * r.perks.pickupMul * (r.power.cache ? 3.2 : 1);
    for (let i = r.objs.length - 1; i >= 0; i--) {
      const o = r.objs[i];
      if (o.z < r.z - 400) { r.objs.splice(i, 1); continue; }
      const dz = o.z - r.z;
      const ox = (o.lane - 1) * W.laneWidth;

      if (o.kind === 'tok' && !o.got) {
        const magnet = r.power.cache && Math.abs(dz) < 900;
        if ((Math.abs(dz) < 90 && Math.abs(ox - px) < pickR) || (magnet && Math.abs(dz) < 120)) {
          o.got = true;
          const def = C.TOKENS[o.tok];
          let v = def.value * r.perks.tokenMul;
          if (r.power.batch) v *= 2;
          if (r.topSpeed > C.SCORING.speedBonusAt) v *= 2;
          r.tokens += v;
          if (o.trail) {
            r.cachedStreak++;
            if (r.cachedStreak >= 6) {
              r.tokens += C.TOKENS.cached.streakBonus;
              r.cachedStreak = 0;
              this.float(px, 'TRAIL CLEARED +' + C.TOKENS.cached.streakBonus, '#a06bff');
              this.audio.big();
            }
          }
          this.audio.token();
          continue;
        }
      }

      if (o.kind === 'pow' && !o.got && Math.abs(dz) < 100 && Math.abs(ox - px) < 150) {
        o.got = true;
        this.takePower(o.id);
        continue;
      }

      if (o.kind === 'obs' && !o.hit) {
        const sameLane = o.full || (o.lane === r.lane && r.laneT > 0.45);
        // near miss: a hazard in an adjacent lane that we skimmed past
        if (!o.passed && dz < 0) {
          o.passed = true;
          // A near miss is a DODGE: the hazard ended up in an adjacent lane and you
          // moved out of its way recently. Just happening to be elsewhere pays nothing.
          const adjacent = Math.abs(o.lane - r.lane) === 1;
          const dodged = r.z - r.lastShiftZ < C.SCORING.dodgeWindow;
          if (!o.full && !sameLane && adjacent && dodged) {
            r.nearMisses++;
            r.tokens += C.SCORING.nearMissTokens * r.perks.tokenMul;
            this.float(px, 'NEAR MISS', '#ffd76b');
            if (r.nearMisses >= 25) this.unlock('ms_nearmiss');
          }
        }
        if (Math.abs(dz) < 70 && sameLane) {
          const k = o.def.kind;
          let survived = false;
          if (k === 'jump' || k === 'chasm') survived = r.y > (k === 'chasm' ? 40 : 60);
          else if (k === 'slide') survived = r.sliding > 0;
          else if (k === 'tar') {
            o.hit = true;
            r.tarUntil = o.def.dur;
            this.float(px, 'TAR PIT', '#8a6a3f');
            continue;
          }
          if (!survived) { o.hit = true; this.crash(o.def, o); }
          else o.hit = true;
        }
      }
    }

    for (let i = r.floats.length - 1; i >= 0; i--) {
      const f = r.floats[i];
      f.life -= dt; f.y -= 40 * dt;
      if (f.life <= 0) r.floats.splice(i, 1);
    }

    this.updateSpray(dt, eff);

    if (r.distance >= 1000 && r.shields === r.perks.startShields && !r.usedShield) this.unlock('ms_nohit');
    if (r.distance >= 2000) this.unlock('ms_2km');
    if (r.tokens >= 1000) this.unlock('ms_1k');
  };

  Game.prototype.float = function (x, text, color) {
    this.run.floats.push({ x, text, color, life: 1.0, max: 1.0, y: 0 });
  };

  // ===========================================================================
  // MUD SPRAY
  // ---------------------------------------------------------------------------
  // The bot sits at a near-fixed spot on the canvas, so the splash is simulated
  // in screen pixels — cheaper than a projected 3D particle field, and easier to
  // tune. The wake ripples are the exception: those are anchored in the world so
  // they rush away with the road instead of sliding around under the player.
  // ===========================================================================
  // mostly dark clods, with a few wet highlights mixed in
  const DROP_TONES = ['#5a3d21', '#4a3218', '#3c2814', '#6b4a28', '#7d5a33', '#9c7b4e'];
  const MAX_DROPS = 420;

  Game.prototype.botScreen = function () {
    const r = this.run;
    return this.project(r.z, r.z - CAM_BACK, this.laneX(r), r.y);
  };

  Game.prototype.drop = function (pr, sp, ang, size, life) {
    const r = this.run;
    if (r.spray.length >= MAX_DROPS) return;
    r.spray.push({
      x: pr.x + (Math.random() * 2 - 1) * 40 * pr.s,
      y: pr.y + (4 + Math.random() * 8) * pr.s,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      rad: size,
      life, max: life,
      col: DROP_TONES[(Math.random() * DROP_TONES.length) | 0],
      front: Math.random() < 0.42,
    });
  };

  Game.prototype.burst = function (n, power) {
    const r = this.run;
    const pr = this.botScreen();
    if (!pr) return;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() * 2 - 1) * 1.5;
      this.drop(pr, (170 + Math.random() * 480) * power, ang,
        2 + Math.random() * 7 * power, 0.32 + Math.random() * 0.5);
    }
    r.ripples.push({ z: r.z - 20, x: this.laneX(r), t: 0, max: 0.7, big: 1.1 + power });
  };

  Game.prototype.updateSpray = function (dt, speed) {
    const r = this.run;
    const pr = this.botScreen();

    // coming down out of a jump throws a proper sheet of it
    if (r.wasJumping && !r.jumping) { this.burst(38, 1.9); this.audio.splash(1.5); }
    r.wasJumping = r.jumping;

    if (pr && !r.jumping) {
      const fast = clamp(speed / C.WORLD.maxSpeed, 0, 1);
      const sliding = r.sliding > 0;
      // a hard lane cut digs an edge in, and that is what really throws mud
      const cut = clamp(Math.abs((r.lane - 1) * C.WORLD.laneWidth - this.laneX(r))
        / C.WORLD.laneWidth, 0, 1);
      const dir = (r.lane - 1) - this.laneX(r) / C.WORLD.laneWidth;
      r.sprayAcc += (90 + fast * 210 + cut * 230 + (sliding ? 120 : 0)) * dt;
      while (r.sprayAcc >= 1) {
        r.sprayAcc -= 1;
        // mud leaves on the outside of the turn; straight-lining, it goes both ways
        const lean = cut > 0.06 ? -Math.sign(dir) : (Math.random() < 0.5 ? -1 : 1);
        const ang = -Math.PI / 2 + lean * (0.5 + Math.random() * (sliding ? 0.95 : 0.7));
        this.drop(pr, (210 + Math.random() * 430) * (0.55 + fast * 0.9), ang,
          1.4 + Math.random() * (sliding ? 6 : 4.6), 0.3 + Math.random() * 0.5);
      }
      r.rippleAcc += dt;
      const every = sliding ? 0.028 : 0.05;
      while (r.rippleAcc >= every) {
        r.rippleAcc -= every;
        r.ripples.push({ z: r.z - 20, x: this.laneX(r), t: 0, max: 0.55, big: sliding ? 1.5 : 1 });
      }
    }

    const G = 1050;   // screen px/s² — tuned for hang time, not for realism
    for (let i = r.spray.length - 1; i >= 0; i--) {
      const p = r.spray[i];
      p.life -= dt;
      p.vy += G * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0 || p.y > VH + 30) r.spray.splice(i, 1);
    }
    for (let i = r.ripples.length - 1; i >= 0; i--) {
      const w = r.ripples[i];
      w.t += dt;
      if (w.t >= w.max || w.z < r.z - CAM_BACK + 30) r.ripples.splice(i, 1);
    }
  };

  Game.prototype.takePower = function (id) {
    const r = this.run;
    const def = C.POWERUPS[id];
    // dur 0 means it is not a timed effect — it banks a shield instead
    const isShield = def.dur === 0;
    if (id === 'mudslide') this.audio.drink(); else this.audio.power();
    if (isShield) {
      const before = r.shields;
      r.shields = Math.min(r.maxShields, r.shields + 1);
      if (id === 'mudslide') this.burst(60, 1.5);
      this.toast(r.shields > before
        ? `${def.icon} ${def.name} — ${r.shields} held`
        : `${def.icon} ${def.name} — already full`);
    } else {
      r.power[id] = def.dur;
      this.toast(`${def.icon} ${def.name} — ${def.blurb}`);
    }
    this.emit('run:power', { id });
  };

  // "CostBot's fun was interrupted by a cost spike in the Datadog spend."
  // Every hazard can phrase itself several ways; the vendor ones draw from the
  // shared pool and fill in the brand on the sign that actually got you.
  Game.prototype.causeOf = (def, o) => {
    const pool = (o && o.vendor ? C.VENDOR_CAUSES : def.causes) || [];
    let noun = pool.length
      ? pool[(Math.random() * pool.length) | 0]
      : 'something expensive';
    if (o && o.vendor) noun = noun.replace('{vendor}', o.vendor.name);
    return `CostBot's fun was interrupted by ${noun}.`;
  };

  Game.prototype.crash = function (def, o) {
    const r = this.run;
    if (r.invuln > 0) return;
    if (r.shields > 0) {
      r.shields--;
      r.usedShield = true;
      r.invuln = C.WORLD.crashGrace;
      r.shake = 16;
      this.audio.shield();
      this.float(this.laneX(r), '🥤 MUDSLIDE USED', '#e0b877');
      return;
    }
    r.over = true;
    r.cause = this.causeOf(def, o);
    r.shake = 26;
    this.audio.crash();
    this.finish();
  };

  Game.prototype.unlock = function (id) {
    if (!this.profile.achievements) this.profile.achievements = {};
    if (this.profile.achievements[id]) return;
    const a = C.ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.profile.achievements[id] = Date.now();
    this.toast(`${a.icon} ${a.name}`);
    this.emit('run:achievement', { id, name: a.name });
  };

  Game.prototype.finish = function () {
    const r = this.run;
    const p = this.profile;
    const tokens = Math.floor(r.tokens);

    p.totalTokens = (p.totalTokens || 0) + tokens;
    // Into the shared arcade purse. Banking into the build fund is a choice the
    // player makes on the hub, not something a run does on their behalf.
    wallet().earn(tokens, 'mudslides');
    // `lifetimeTokens` is what every cabinet calls its running total. `banked` is
    // what the arcade's build fund counts — there is nothing to spend tokens on
    // here, so on this hill everything you collect is banked by definition.
    p.lifetimeTokens = p.totalTokens;
    p.runs = (p.runs || 0) + 1;
    const best = tokens > (p.best || 0);
    if (best) p.best = tokens;
    if (r.distance > (p.bestDistance || 0)) p.bestDistance = r.distance;
    this.unlock('ms_first');
    if (p.totalTokens >= 10000) this.unlock('ms_10k');

    // Local run history. The server board only exists on the dynamic app, so
    // without this the leaderboard would be empty on static hosting — and this
    // is also what "your runs" is ranked from when nobody else has played.
    p.history = (p.history || []);
    p.history.unshift({
      t: Date.now(),
      tokens,
      distance: r.distance,
      nearMisses: r.nearMisses,
      topSpeed: Math.round(r.topSpeed),
    });
    p.history = p.history.slice(0, C.SCORING.historyKept);

    saveLocal(p);

    const res = {
      game: 'mudslides',
      stageId: 'endless',
      outcome: 'death',
      tokens,
      // every cabinet reports its haul under the same name, so the arcade pool
      // can sum one field across all of them
      tokensEarned: tokens,
      timeSurvived: Math.round(r.t),
      distance: r.distance,
      nearMisses: r.nearMisses,
      topSpeed: r.topSpeed,
      // No dollars. Nothing on this hill saves money — you dodge vendors and
      // collect tokens — so converting the haul into a fake savings figure only
      // put an invented number on the arcade board. Distance is the real score.
      dollarsSaved: 0,
      level: 1,
      kills: 0,
      quizCorrect: 0,
      quizWrong: 0,
      best,
      cause: r.cause,
      profile: p,
    };
    this.emit('run:end', res);
    this.onComplete(res);
    setTimeout(() => { if (!this.destroyed) this.screenOver(res); }, 700);
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================
  Game.prototype.project = (z, camZ, worldX, worldY) => {
    const dz = z - camZ;
    if (dz < 1) return null;
    const scale = FOCAL / dz;
    return {
      x: VW / 2 + (worldX || 0) * scale,
      y: HORIZON + (CAM_H - (hill(z) - hill(camZ)) - (worldY || 0)) * scale,
      s: scale,
    };
  };

  Game.prototype.render = function () {
    const ctx = this.ctx;
    const r = this.run;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // sky
    // overcast, rain-soaked jungle sky
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 80);
    sky.addColorStop(0, '#9aa3a0');
    sky.addColorStop(0.55, '#7d8a83');
    sky.addColorStop(1, '#4d5f4a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VW, HORIZON + 80);
    // far hillside of jungle behind the horizon
    ctx.fillStyle = '#2c4230';
    ctx.beginPath();
    ctx.moveTo(0, HORIZON + 22);
    for (let x = 0; x <= VW; x += 40) {
      ctx.lineTo(x, HORIZON - 26 + Math.sin(x * 0.011) * 16 + Math.sin(x * 0.031) * 9);
    }
    ctx.lineTo(VW, HORIZON + 40); ctx.lineTo(0, HORIZON + 40);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1d3020';
    ctx.fillRect(0, HORIZON + 26, VW, VH - HORIZON - 26);

    if (!r) { this.drawHaze(ctx); return; }

    const camZ = r.z - CAM_BACK;
    const shakeX = r.shake ? (Math.random() * 2 - 1) * r.shake : 0;
    ctx.save();
    ctx.translate(shakeX, r.shake ? (Math.random() * 2 - 1) * r.shake * 0.5 : 0);

    // --- the hill: trapezoid strips from far to near ------------------------
    const startZ = Math.floor(camZ / SEG) * SEG;
    const halfRoad = C.WORLD.laneWidth * ROAD_HALF;
    const chasms = r.objs.filter((o) => o.kind === 'obs' && o.def.kind === 'chasm');
    for (let i = Math.floor(C.WORLD.drawDistance / SEG); i >= 0; i--) {
      const z0 = startZ + i * SEG;
      const z1 = z0 + SEG;
      const a = this.project(z0, camZ, 0, 0);
      const b = this.project(z1, camZ, 0, 0);
      if (!a || !b) continue;
      const seg = Math.floor(z0 / SEG);
      const n = noise(seg);
      const wa = halfRoad * a.s, wb = halfRoad * b.s;

      // jungle floor — a single tone with only a whisper of variation; the earlier
      // 3-colour alternation banded into visible stripes at this segment length
      ctx.fillStyle = seg % 2 ? JUNGLE[0] : JUNGLE[1];
      ctx.beginPath();
      ctx.moveTo(0, a.y); ctx.lineTo(VW, a.y); ctx.lineTo(VW, b.y); ctx.lineTo(0, b.y);
      ctx.closePath(); ctx.fill();

      const inChasm = chasms.some((c) => Math.abs(c.z - (z0 + SEG / 2)) < C.OBSTACLES.billing_gap.w / 2);
      if (inChasm) {
        ctx.fillStyle = '#07090e';
        ctx.beginPath();
        ctx.moveTo(VW / 2 - wa, a.y); ctx.lineTo(VW / 2 + wa, a.y);
        ctx.lineTo(VW / 2 + wb, b.y); ctx.lineTo(VW / 2 - wb, b.y);
        ctx.closePath(); ctx.fill();
        continue;
      }

      // churned mud: three tones interleaved so the surface never looks flat
      ctx.fillStyle = n < 0.36 ? MUD.dark : n < 0.72 ? MUD.mid : MUD.light;
      ctx.beginPath();
      ctx.moveTo(VW / 2 - wa, a.y); ctx.lineTo(VW / 2 + wa, a.y);
      ctx.lineTo(VW / 2 + wb, b.y); ctx.lineTo(VW / 2 - wb, b.y);
      ctx.closePath(); ctx.fill();

      // ruts gouged down the lane lines
      ctx.strokeStyle = MUD.rut;
      ctx.lineWidth = Math.max(1, 26 * a.s);
      for (const lx of [-0.5, 0.5]) {
        const xa = VW / 2 + lx * C.WORLD.laneWidth * a.s;
        const xb = VW / 2 + lx * C.WORLD.laneWidth * b.s;
        ctx.beginPath(); ctx.moveTo(xa, a.y); ctx.lineTo(xb, b.y); ctx.stroke();
      }

      // wet sheen where water pools, and splatter clods
      if (a.s > 0.12) {
        if (n > 0.62) {
          ctx.fillStyle = MUD.wet;
          const sw = wa * (0.3 + n * 0.4);
          ctx.beginPath();
          ctx.ellipse(VW / 2 + (n - 0.5) * wa, (a.y + b.y) / 2, sw, Math.max(1, (a.y - b.y) * 0.8), 0, 0, TAU);
          ctx.fill();
        }
        const clods = 3;
        for (let c = 0; c < clods; c++) {
          const nn = noise(seg * 7 + c);
          ctx.fillStyle = nn > 0.5 ? MUD.splat : MUD.dark;
          const cx = VW / 2 + (nn * 2 - 1) * wa * 0.92;
          ctx.beginPath();
          ctx.ellipse(cx, a.y, 9 * a.s * (0.5 + nn), 4 * a.s * (0.5 + nn), 0, 0, TAU);
          ctx.fill();
        }
        // Trees stand off the shoulder, behind the ferns. They are drawn in the
        // same far-to-near strip pass, so a nearer strip's ground never paints
        // over a farther tree — the depth sorting comes free from the loop order.
        for (const side of [-1, 1]) {
          const tn = noise(seg * 3.7 + (side > 0 ? 61 : 23));
          if (tn < 0.86) continue;                       // roughly one every 7 strips
          const tx = VW / 2 + side * wa * (1.5 + tn * 1.3);
          if (tx < -260 || tx > VW + 260) continue;      // swept past the edge
          this.drawTree(ctx, tx, a.y, a.s, tn, side);
        }
        // ferns and palms crowding the shoulders
        for (const side of [-1, 1]) {
          const fn = noise(seg * 13 + (side > 0 ? 91 : 7));
          if (fn < 0.42) continue;
          const fx = VW / 2 + side * (wa * (1.06 + fn * 0.5));
          const fh = (70 + fn * 120) * a.s;
          const fw = (46 + fn * 60) * a.s;
          if (fh < 3) continue;
          ctx.fillStyle = fn > 0.8 ? '#2f5c34' : '#254a29';
          // a few overlapping fronds fanning up and outward
          for (let f = 0; f < 5; f++) {
            const ang = -Math.PI / 2 + (f - 2) * 0.36 + side * 0.16;
            ctx.beginPath();
            ctx.moveTo(fx, a.y);
            ctx.quadraticCurveTo(
              fx + Math.cos(ang) * fw * 0.7, a.y + Math.sin(ang) * fh * 0.8,
              fx + Math.cos(ang) * fw, a.y + Math.sin(ang) * fh,
            );
            ctx.lineTo(fx, a.y);
            ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = '#1a3520';
          ctx.beginPath();
          ctx.ellipse(fx, a.y, fw * 0.16, fh * 0.07, 0, 0, TAU);
          ctx.fill();
        }

        // embedded rocks near the shoulders
        if (n > 0.83) {
          const rx = VW / 2 + (n > 0.915 ? 1 : -1) * wa * (0.72 + n * 0.2);
          ctx.fillStyle = MUD.rock;
          ctx.beginPath(); ctx.ellipse(rx, a.y, 15 * a.s, 9 * a.s, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = MUD.rockDark;
          ctx.beginPath(); ctx.ellipse(rx, a.y + 3 * a.s, 15 * a.s, 4 * a.s, 0, 0, TAU); ctx.fill();
        }
      }
    }

    this.drawFlow(ctx, camZ);
    this.drawRipples(ctx, r, camZ);

    // --- objects, far to near -----------------------------------------------
    const sorted = r.objs.slice().sort((o1, o2) => o2.z - o1.z);
    for (const o of sorted) {
      const pr = this.project(o.z, camZ, (o.lane - 1) * C.WORLD.laneWidth, 0);
      if (!pr || pr.s > 4) continue;
      if (o.kind === 'tok' && !o.got) this.drawToken(ctx, o, pr);
      else if (o.kind === 'pow' && !o.got) this.drawPower(ctx, o, pr, this.img);
      else if (o.kind === 'obs' && o.def.kind !== 'chasm') this.drawObstacle(ctx, o, pr);
    }

    this.drawSpray(ctx, r, false);
    this.drawBot(ctx, r, camZ);
    this.drawSpray(ctx, r, true);

    // floats
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of r.floats) {
      const a = clamp(f.life / f.max, 0, 1);
      const pr = this.project(r.z + 60, camZ, f.x, 120 + (1 - a) * 90);
      if (!pr) continue;
      ctx.globalAlpha = a;
      ctx.font = 'bold 22px "Segoe UI",system-ui,sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(f.text, pr.x, pr.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, pr.x, pr.y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    this.drawRain(ctx, r.topSpeed);
    this.drawHaze(ctx);
    this.drawHUD(ctx, r);
  };

  // Two species, picked by the same stable noise that placed the tree, so a given
  // spot on the hill always grows the same thing however often you slide past it.
  Game.prototype.drawTree = (ctx, x, y, s, n) => {
    const v = noise(n * 911.7);              // size + species, decoupled from placement
    const h = (300 + v * 430) * s;
    if (h < 7) return;
    const lean = (v - 0.5) * 0.3;
    const topX = x + Math.sin(lean) * h * 0.34;
    const topY = y - h;
    const tw = Math.max(0.8, h * 0.042);

    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(x, y, tw * 2.8, tw, 0, 0, TAU); ctx.fill();

    // trunk — tapered and slightly curved, never a rectangle
    ctx.fillStyle = v > 0.5 ? '#31251a' : '#271d14';
    ctx.beginPath();
    ctx.moveTo(x - tw, y);
    ctx.quadraticCurveTo(x + (topX - x) * 0.35, y - h * 0.55, topX - tw * 0.38, topY);
    ctx.lineTo(topX + tw * 0.38, topY);
    ctx.quadraticCurveTo(x + tw + (topX - x) * 0.35, y - h * 0.55, x + tw, y);
    ctx.closePath(); ctx.fill();

    if (v > 0.5) {
      // palm: fronds arcing off the crown and drooping at the tips
      const fl = h * 0.5;
      for (let f = 0; f < 7; f++) {
        const ang = -Math.PI / 2 + (f - 3) * 0.46;
        const ex = topX + Math.cos(ang) * fl;
        const ey = topY + Math.sin(ang) * fl * 0.55 + fl * 0.26;
        ctx.fillStyle = f % 2 ? '#1f4526' : '#173520';
        ctx.beginPath();
        ctx.moveTo(topX, topY);
        ctx.quadraticCurveTo(topX + Math.cos(ang) * fl * 0.6, topY + Math.sin(ang) * fl * 0.75,
          ex, ey);
        ctx.quadraticCurveTo(topX + Math.cos(ang) * fl * 0.5, topY + Math.sin(ang) * fl * 0.42,
          topX, topY);
        ctx.closePath(); ctx.fill();
      }
    } else {
      // broadleaf: a clump of overlapping canopy blobs
      const cw = h * 0.4;
      for (let c = 0; c < 5; c++) {
        const cn = noise(v * 100 + c * 7.3);
        ctx.fillStyle = c % 2 ? '#1c3f25' : '#142f1b';
        ctx.beginPath();
        ctx.ellipse(topX + (cn - 0.5) * cw * 1.35, topY + h * 0.1 + (cn - 0.5) * cw * 0.55,
          cw * (0.5 + cn * 0.45), cw * (0.38 + cn * 0.3), 0, 0, TAU);
        ctx.fill();
      }
    }
  };

  Game.prototype.drawRain = (ctx, speed) => {
    const t = performance.now() / 1000;
    ctx.strokeStyle = 'rgba(190,205,205,.20)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const seed = i * 37.13;
      const x = (noise(seed) * VW + t * 90) % VW;
      const y = (noise(seed + 5) * VH + t * (620 + speed * 0.18)) % VH;
      const len = 14 + noise(seed + 9) * 18;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + len);
    }
    ctx.stroke();
  };

  // The hill is a moving slurry, not a texture: sheets of wet mud creep downhill
  // slower than the player, so you feel yourself overtaking the flow. Each sheet
  // is anchored to a world-space grid cell and fades in and out across its cycle,
  // which is what keeps it from popping when it wraps.
  Game.prototype.drawFlow = function (ctx, camZ) {
    const CYCLE = 460;
    const phase = ((performance.now() / 1000 * 205) % CYCLE) / CYCLE;
    const fade = Math.sin(phase * Math.PI);
    const half = C.WORLD.laneWidth * ROAD_HALF;
    const base0 = Math.floor(camZ / CYCLE) * CYCLE;
    const steps = Math.ceil(C.WORLD.drawDistance / CYCLE);
    for (let k = 1; k <= steps; k++) {
      const base = base0 + k * CYCLE;
      for (let j = 0; j < 3; j++) {
        const na = noise(base * 0.017 + j * 11.3);
        const nb = noise(base * 0.031 + j * 5.7);
        const pr = this.project(base - phase * CYCLE + na * 110, camZ,
          (nb * 2 - 1) * half * 0.9, 0);
        if (!pr || pr.s > 2.4) continue;
        const w = (96 + na * 150) * pr.s;   // long and shallow — a streak, not a puddle
        const h = (13 + nb * 19) * pr.s;
        if (w < 2.5) continue;
        ctx.globalAlpha = fade * 0.32 * clamp(pr.s * 3.5, 0, 1);
        ctx.fillStyle = na > 0.5 ? MUD.light : MUD.mid;
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y, w, h, 0, 0, TAU); ctx.fill();
        // a bright lip on the downhill edge — that is what reads as *wet*
        ctx.globalAlpha *= 0.85;
        ctx.fillStyle = 'rgba(206,180,140,.55)';
        ctx.beginPath();
        ctx.ellipse(pr.x, pr.y + h * 0.55, w * 0.7, h * 0.28, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawRipples = function (ctx, r, camZ) {
    for (const w of r.ripples) {
      const pr = this.project(w.z, camZ, w.x, 0);
      if (!pr) continue;
      const k = clamp(w.t / w.max, 0, 1);
      const rad = (30 + k * 112) * w.big * pr.s;
      if (rad < 1.5) continue;
      // a shallow trench of churned mud...
      ctx.globalAlpha = (1 - k) * 0.26;
      ctx.fillStyle = MUD.dark;
      ctx.beginPath(); ctx.ellipse(pr.x, pr.y, rad * 0.86, rad * 0.24, 0, 0, TAU); ctx.fill();
      // ...with a wet rim on the near edge only. A closed ring reads as a crop
      // circle; half of one reads as a wave the player just pushed out.
      ctx.globalAlpha = (1 - k) * 0.3;
      ctx.strokeStyle = 'rgba(190,164,126,.9)';
      ctx.lineWidth = Math.max(1, 3.2 * pr.s * (1 - k));
      ctx.beginPath();
      ctx.ellipse(pr.x, pr.y, rad, rad * 0.28, 0, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawSpray = (ctx, r, front) => {
    for (const p of r.spray) {
      if (p.front !== front) continue;
      const a = clamp(p.life / p.max, 0, 1);
      const sp = Math.hypot(p.vx, p.vy);
      ctx.globalAlpha = Math.min(1, a * 1.3) * 0.9;
      ctx.fillStyle = p.col;
      ctx.beginPath();
      // stretch each clod along its own travel, so fast mud reads as a streak
      ctx.ellipse(p.x, p.y, p.rad * (1 + sp / 1300), p.rad,
        Math.atan2(p.vy, p.vx), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawHaze = (ctx) => {
    const g = ctx.createRadialGradient(VW / 2, VH * 0.45, VH * 0.3, VW / 2, VH * 0.5, VH * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(10,16,12,.70)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  };

  Game.prototype.drawToken = (ctx, o, pr) => {
    const def = C.TOKENS[o.tok];
    const rr = def.r * pr.s;
    if (rr < 1.2) return;
    const bob = Math.sin(performance.now() / 260 + o.z) * 6 * pr.s;
    const y = pr.y - 58 * pr.s + bob;
    ctx.fillStyle = def.color;
    ctx.shadowColor = def.glow; ctx.shadowBlur = 16 * Math.min(1, pr.s);
    ctx.beginPath(); ctx.arc(pr.x, y, rr, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    if (rr > 7) {
      ctx.fillStyle = 'rgba(10,14,20,.75)';
      ctx.font = `bold ${rr * 1.1}px ui-monospace,monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('{}', pr.x, y + rr * 0.06);
    }
  };

  Game.prototype.drawPower = (ctx, o, pr, img) => {
    const def = C.POWERUPS[o.id];
    const s = 46 * pr.s;
    if (s < 3) return;
    const y = pr.y - 70 * pr.s;
    const spin = (performance.now() / 400) % TAU;
    ctx.save();
    ctx.translate(pr.x, y);
    ctx.rotate(Math.sin(spin) * 0.25);

    // an art-backed power-up draws its own sprite over a halo, no crate around it
    const art = def.sprite && img && img[def.sprite];
    if (art && art.complete && art.naturalWidth) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.35);
      g.addColorStop(0, 'rgba(240,205,140,.6)');
      g.addColorStop(0.55, 'rgba(224,184,119,.22)');
      g.addColorStop(1, 'rgba(224,184,119,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, s * 1.35, 0, TAU); ctx.fill();
      const d = s * 2;
      ctx.shadowColor = def.color; ctx.shadowBlur = 18 * Math.min(1, pr.s);
      ctx.drawImage(art, -d / 2, -d / 2, d, d);
      ctx.shadowBlur = 0;
      ctx.restore();
      return;
    }

    ctx.fillStyle = 'rgba(10,14,20,.7)';
    ctx.strokeStyle = def.color; ctx.lineWidth = Math.max(1.5, 3 * pr.s);
    ctx.shadowColor = def.color; ctx.shadowBlur = 20 * Math.min(1, pr.s);
    ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.24); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    if (s > 16) {
      ctx.font = `${s * 0.6}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, 0, 1);
    }
    ctx.restore();
  };

  // Vendor marks are single-path 24x24 outlines, so Path2D draws them straight
  // onto the canvas at any scale — no image assets, nothing to preload, crisp
  // from the horizon to your face. Cached per vendor because parsing the path
  // on every frame would be silly.
  Game.prototype.vendorIcon = function (v) {
    if (!v || !v.path) return null;
    if (!this._icons) this._icons = {};
    if (!(v.id in this._icons)) {
      try { this._icons[v.id] = new Path2D(v.path); } catch { this._icons[v.id] = null; }
    }
    return this._icons[v.id];
  };

  // Draw a 24x24 icon path centred on (x, y) at `size` pixels. A vendor with no
  // published mark gets a monogram badge instead — every sign carries something,
  // so none of them ever reads as unfinished art.
  Game.prototype.drawVendorMark = function (ctx, v, x, y, size) {
    if (!v || size < 5) return false;
    const p = this.vendorIcon(v);
    ctx.save();
    if (p) {
      ctx.translate(x, y);
      ctx.scale(size / 24, size / 24);
      ctx.translate(-12, -12);
      ctx.fillStyle = v.color;
      ctx.fill(p);
    } else {
      const r = size * 0.46;
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.42);
      ctx.fill();
      ctx.fillStyle = '#0d1119';
      ctx.font = `800 ${size * 0.62}px 'Segoe UI',system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.name[0].toUpperCase(), x, y + size * 0.03);
    }
    ctx.restore();
    return true;
  };

  Game.prototype.drawObstacle = function (ctx, o, pr) {
    const d = o.def;
    const w = d.w * pr.s;
    const h = d.h * pr.s;
    if (w < 2) return;

    ctx.save();
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(pr.x, pr.y, w * 0.5, w * 0.14, 0, 0, TAU); ctx.fill();

    if (d.art === 'rock') this.drawRock(ctx, o, pr, w, h);
    else if (d.art === 'gantry') this.drawGantry(ctx, o, pr, w, h);
    else if (d.art === 'sign') this.drawSign(ctx, o, pr, w, h);
    else this.drawSlab(ctx, o, pr, w, h);
    ctx.restore();
  };

  // Bedrock. A lumpy dome rather than a box — the silhouette is the only thing
  // you can read at speed, so it has to say "rock" instantly.
  Game.prototype.drawRock = (ctx, o, pr, w, h) => {
    const seed = Math.floor(o.z * 0.017);
    const N = 11;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI;
      const rr = 0.8 + noise(seed + i * 3.1) * 0.32;
      const x = pr.x - Math.cos(t) * w * 0.5 * rr;
      const y = pr.y - Math.sin(t) * h * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = o.def.color;
    ctx.fill();
    ctx.strokeStyle = o.def.accent;
    ctx.lineWidth = Math.max(1, 2 * pr.s);
    ctx.stroke();
    // a lit facet up top and a crevice, so it reads as stone and not a blob
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath();
    ctx.ellipse(pr.x - w * 0.14, pr.y - h * 0.62, w * 0.2, h * 0.22, -0.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = Math.max(1, 2.4 * pr.s);
    ctx.beginPath();
    ctx.moveTo(pr.x + w * 0.06, pr.y);
    ctx.lineTo(pr.x + w * 0.16, pr.y - h * 0.52);
    ctx.lineTo(pr.x + w * 0.3, pr.y - h * 0.7);
    ctx.stroke();
    // half-sunk in the mud
    ctx.fillStyle = 'rgba(40,27,15,.55)';
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, w * 0.5, h * 0.1, 0, 0, TAU);
    ctx.fill();

    // A quarry stamp, chiselled rather than printed — light edge under a dark
    // face. Only once the rock is big enough for it to be legible; at distance
    // it would just be grey mush on a grey rock.
    if (w > 96) {
      ctx.save();
      ctx.translate(pr.x, pr.y - h * 0.4);
      ctx.rotate(-0.07);
      ctx.font = `800 ${Math.min(w * 0.09, h * 0.2)}px 'Segoe UI',system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // The dome's silhouette narrows toward the top and each rock is lumped by
      // noise, so keep well inside the nominal width or the stamp hangs off it.
      const fit = w * 0.58;
      ctx.fillStyle = 'rgba(255,255,255,.11)';
      ctx.fillText('AWS BEDROCK', 0, Math.max(1, h * 0.014), fit);
      ctx.fillStyle = 'rgba(26,18,10,.38)';
      ctx.fillText('AWS BEDROCK', 0, 0, fit);
      ctx.restore();
    }
  };

  // A vendor's contract: a hoarding boarded all the way down into the mud.
  //
  // The silhouette IS the instruction, and this one used to lie. It was a panel
  // held up on two thin posts with the bottom third left as open daylight —
  // which is the universal runner's shorthand for "slide under me" — while the
  // obstacle is a full-lane block that kills you for trying. Sliding worked on
  // the shorter Renewal gantry and not on the taller Contract, which read as the
  // slide being broken on tall signs rather than as two different hazards.
  //
  // So: no gap, no posts, no daylight. Solid from the mud to the top, the way
  // the briefing has always described it — "a signed contract fills the lane".
  Game.prototype.drawSign = function (ctx, o, pr, w, h) {
    const d = o.def;
    const v = o.vendor;
    const bh = h * 0.58;                    // brand panel, up where it stays legible
    const top = pr.y - h;
    const rr = Math.min(12 * pr.s, bh * 0.18);

    // The boarding below the panel — same body, darker, planked. Drawn first and
    // full height so there is never a seam of background showing through.
    ctx.fillStyle = '#241c12';
    ctx.beginPath();
    ctx.roundRect(pr.x - w / 2, top, w, h, rr);
    ctx.fill();

    // vertical plank seams, so the lower half reads as timber and not a shadow
    ctx.strokeStyle = 'rgba(0,0,0,.34)';
    ctx.lineWidth = Math.max(1, 1.6 * pr.s);
    for (let i = 1; i < 4; i++) {
      const x = pr.x - w / 2 + (w * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, top + bh);
      ctx.lineTo(x, pr.y);
      ctx.stroke();
    }
    // a lit top edge on the boarding, and mud caked along the bottom
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(pr.x - w / 2, top + bh, w, Math.max(1, h * 0.02));
    ctx.fillStyle = 'rgba(40,27,15,.6)';
    ctx.fillRect(pr.x - w / 2, pr.y - h * 0.07, w, h * 0.07);

    // the brand panel
    ctx.fillStyle = d.color;
    ctx.strokeStyle = v ? v.color : d.accent;
    ctx.lineWidth = Math.max(1.5, 3.5 * pr.s);
    ctx.beginPath();
    ctx.roundRect(pr.x - w / 2, top, w, bh, rr);
    ctx.fill(); ctx.stroke();

    // half-sunk in the hill, like the bedrock — it is planted, not standing
    ctx.fillStyle = 'rgba(40,27,15,.55)';
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, w * 0.54, h * 0.045, 0, 0, TAU);
    ctx.fill();

    this.signFace(ctx, v, pr.x, top, w, bh);
  };

  // The renewal: a banner overhead on two legs, with daylight underneath. This
  // is the ONLY vendor hazard you get under, so it wears the whole gap — a
  // thinner banner on taller legs, well clear of a sliding bot.
  Game.prototype.drawGantry = function (ctx, o, pr, w, h) {
    const d = o.def;
    const v = o.vendor;
    const bh = h * 0.36;
    const top = pr.y - h;
    const pw = Math.max(1.4, w * 0.055);

    ctx.fillStyle = '#3a2e22';
    for (const s of [-1, 1]) {
      ctx.fillRect(pr.x + s * (w * 0.5 - pw) - pw / 2, top + bh, pw, h - bh);
    }
    ctx.fillStyle = d.color;
    ctx.strokeStyle = v ? v.color : d.accent;
    ctx.lineWidth = Math.max(1.5, 3.5 * pr.s);
    ctx.beginPath();
    ctx.roundRect(pr.x - w / 2, top, w, bh, Math.min(9 * pr.s, bh * 0.22));
    ctx.fill(); ctx.stroke();

    this.signFace(ctx, v, pr.x, top, w, bh);
  };

  // Shared face for both sign shapes: the mark if we have one, the wordmark
  // either way — a logo alone is unreadable by the time it is big enough to hit.
  // Mark and name sit as one block centred on the board.
  Game.prototype.signFace = function (ctx, v, cx, top, w, bh) {
    if (!v || w < 34) return;
    ctx.textAlign = 'center';
    const iconSize = Math.min(bh * 0.5, w * 0.36);
    const drew = this.drawVendorMark(ctx, v, cx, top + bh * 0.33, iconSize);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = v.color;
    const nameSize = Math.min(w * 0.17, bh * 0.3);
    // maxWidth keeps a long wordmark inside the board — "Databricks" at sign
    // width would otherwise run off both edges
    ctx.font = `700 ${nameSize}px 'Segoe UI',system-ui,sans-serif`;
    ctx.fillText(v.name, cx, top + bh * (drew ? 0.74 : 0.5), w * 0.86);
  };

  // Everything else — the tar slick — keeps the plain slab treatment.
  Game.prototype.drawSlab = (ctx, o, pr, w, h) => {
    const d = o.def;
    ctx.fillStyle = d.color;
    ctx.strokeStyle = d.accent;
    ctx.lineWidth = Math.max(1.5, 3 * pr.s);
    ctx.beginPath();
    ctx.roundRect(pr.x - w / 2, pr.y - h, w, h, Math.min(14 * pr.s, h * 0.3));
    ctx.fill(); ctx.stroke();
    if (w > 26 && d.glyph) {
      ctx.font = `${Math.min(w * 0.4, h * 1.4)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.glyph, pr.x, pr.y - h * 0.5);
    }
  };

  Game.prototype.drawBot = function (ctx, r, camZ) {
    const px = this.laneX(r);
    const pr = this.project(r.z, camZ, px, r.y);
    if (!pr) return;
    const size = 112 * pr.s;   // scale with the projection, like everything else
    const squash = r.sliding > 0 ? 0.55 : 1;
    ctx.save();
    // The wake: two sheets of mud peeling off either side, the way a body sliding
    // through wet slurry pushes it up and out. The loose clods come from the
    // particle system; this is the continuous part of it.
    if (!r.jumping) {
      const t = performance.now() / 1000;
      const fast = clamp(r.topSpeed / C.WORLD.maxSpeed, 0.25, 1);
      // everything here is a fraction of the bot's own drawn size, so the wake
      // stays in proportion however the projection scales
      const S = size * (r.sliding > 0 ? 1.14 : 1);
      // Each sheet is a run of overlapping clods rather than one smooth shape —
      // a clean crescent reads as a wing, a lumpy one reads as thrown mud.
      const LOBES = 8;
      for (const side of [-1, 1]) {
        const len = S * (0.62 + fast * 0.34);
        const rise = S * (0.3 + fast * 0.18);
        for (let i = 0; i < LOBES; i++) {
          const u = (i + 0.6) / LOBES;
          const wob = Math.sin(t * 13 + i * 1.7 + (side > 0 ? 2.1 : 0)) * S * 0.035;
          const bx = pr.x + side * len * u;
          const by = pr.y + S * 0.1 - rise * (0.12 + 0.88 * u ** 0.6) + wob;
          const rr = S * (0.15 - 0.09 * u) * (0.82 + noise(i * 5.3 + side) * 0.5);
          if (rr < 1) continue;
          ctx.fillStyle = i % 2 ? 'rgba(66,46,26,.7)' : 'rgba(92,70,44,.62)';
          ctx.beginPath();
          ctx.ellipse(bx, by, rr * 1.45, rr, side * 0.5, 0, TAU);
          ctx.fill();
        }
      }
      // wet slick under the slide
      ctx.fillStyle = 'rgba(150,122,86,.18)';
      ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 8, S * 0.56, S * 0.11, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y + 4, 44, 13, 0, 0, TAU);
    ctx.fill();

    // pr.y already carries the jump height (r.y went in as worldY) — do not add it twice
    ctx.translate(pr.x, pr.y - size * 0.42 * squash);
    ctx.scale(1, squash);
    if (r.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0) ctx.globalAlpha = 0.5;
    // lean into the turn
    ctx.rotate(((r.lane - 1) - (this.laneX(r) / C.WORLD.laneWidth)) * -0.55);
    // Seen from behind, which is the only view that makes sense with the camera
    // sitting over his shoulder. Falls back to the front-facing arcade CostBot if
    // the sprite has not decoded yet.
    const img = (this.img.slider.complete && this.img.slider.naturalWidth)
      ? this.img.slider : this.img.costbot;
    ctx.shadowColor = 'rgba(255,170,80,.5)'; ctx.shadowBlur = 22;
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -size / 2, -size / 2, size, size);
    else { ctx.fillStyle = '#4aa3ff'; ctx.beginPath(); ctx.arc(0, 0, 40, 0, TAU); ctx.fill(); }
    ctx.shadowBlur = 0;
    // caked-on mud — fixed positions so it reads as dirt, not noise
    for (let i = 0; i < 9; i++) {
      const nx = noise(i * 3.1) - 0.5;
      const ny = noise(i * 7.7) - 0.5;
      ctx.fillStyle = `rgba(${62 + (noise(i) * 30 | 0)},${44 + (noise(i + 2) * 20 | 0)},26,.72)`;
      ctx.beginPath();
      ctx.ellipse(nx * size * 0.66, ny * size * 0.6 + size * 0.08,
        3 + noise(i + 4) * 7, 2 + noise(i + 6) * 5, noise(i) * TAU, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  Game.prototype.drawHUD = function (ctx, r) {
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(8,6,4,.72)';
    ctx.fillRect(0, 0, VW, 56);
    ctx.fillStyle = '#f0a52c';
    ctx.fillRect(0, 55, VW, 1.5);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9927a'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText('TOKENS', 18, 9);
    ctx.fillStyle = '#ffd76b'; ctx.font = 'bold 25px ui-monospace,monospace';
    const coin = this.img.coin;
    const coinOn = coin && coin.complete && coin.naturalWidth;
    if (coinOn) ctx.drawImage(coin, 18, 21, 22, 22);
    ctx.fillText(Math.floor(r.tokens).toLocaleString(), coinOn ? 46 : 18, 22);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#a9927a'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText('DISTANCE', VW / 2, 9);
    ctx.fillStyle = '#e8eef8'; ctx.font = 'bold 25px ui-monospace,monospace';
    ctx.fillText(`${r.distance} m`, VW / 2, 22);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#a9927a'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText('SPEED', VW - 18, 9);
    ctx.fillStyle = r.power.spot ? '#ff9e2c' : '#7fd6c4';
    ctx.font = 'bold 25px ui-monospace,monospace';
    ctx.fillText(String(Math.round(r.topSpeed)), VW - 18, 22);

    // Shields in hand. They are Mudslides now, so show the glass rather than a
    // shield glyph — the HUD should look like the thing you picked up.
    const glass = this.img.mudslide;
    for (let i = 0; i < r.shields; i++) {
      const x = 18 + i * 30;
      if (glass && glass.complete && glass.naturalWidth) {
        ctx.drawImage(glass, x, VH - 50, 28, 28);
      } else {
        ctx.font = '20px serif'; ctx.textAlign = 'left';
        ctx.fillText('🥤', x, VH - 40);
      }
    }
    // active powers
    const act = Object.keys(r.power);
    act.forEach((k, i) => {
      const def = C.POWERUPS[k];
      const x = VW - 40 - (act.length - 1 - i) * 46;
      ctx.fillStyle = 'rgba(8,6,4,.8)';
      ctx.beginPath(); ctx.roundRect(x - 19, VH - 52, 38, 38, 9); ctx.fill();
      ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = '19px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, x, VH - 36);
      ctx.fillStyle = def.color;
      ctx.fillRect(x - 19, VH - 16, 38 * clamp(r.power[k] / def.dur, 0, 1), 3);
      ctx.textBaseline = 'top';
    });
  };

  // ===========================================================================
  global.Mudslides = {
    mount(container, opts) {
      if (typeof container === 'string') container = document.querySelector(container);
      if (!container) throw new Error('Mudslides.mount: container not found');
      return new Game(container, opts || {});
    },
    CONTENT: C,
    loadProfile: loadLocal,
    resetProfile() { try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
