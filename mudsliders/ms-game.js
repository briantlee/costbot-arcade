/* ============================================================================
 * CostBot Mudsliders — ENGINE
 * ----------------------------------------------------------------------------
 * Behind-the-back pseudo-3D endless runner. No 3D engine: the hill is a stack
 * of projected trapezoids and every object is a sprite scaled by its distance.
 *
 *   Mudsliders.mount(container, { onComplete, onEvent, profile })
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
  const VW = 1152;
  const VH = 648;
  const HORIZON = VH * 0.32;
  const FOCAL = 700;
  const CAM_H = 163;
  const CAM_BACK = 400;
  const SEG = 55; // road segment length in world units
  const TAU = Math.PI * 2;
  const STORE_KEY = 'costbot.mudsliders.v1';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Rolling hill profile. Two waves so the slope never feels periodic.
  const hill = (z) => Math.sin(z * 0.00085) * 150 + Math.sin(z * 0.00219) * 62;

  function defaultProfile() {
    return { totalTokens: 0, modules: {}, best: 0, bestDistance: 0, runs: 0, achievements: {} };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? Object.assign(defaultProfile(), JSON.parse(raw)) : defaultProfile();
    } catch {
      return defaultProfile();
    }
  }
  function saveLocal(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  }

  // --- perks unlocked by the build ------------------------------------------
  function perks(profile) {
    const has = (id) => Boolean(profile.modules && profile.modules[id]);
    return {
      startShields: has('ingest') ? 1 : 0,
      maxShields: has('commitments') ? 3 : 1,
      pickupMul: has('explorer') ? 1.25 : 1,
      crateBias: has('tagging') ? 0.7 : 1,
      earlyWarn: has('anomaly'),
      tokenMul: has('chargeback') ? 1.15 : 1,
      startSpeedBonus: has('autopilot') ? 380 : 0,
    };
  }

  const CSS = `
.ms-root{position:relative;width:100%;height:100%;background:#05070d;overflow:hidden;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8eef8;user-select:none;}
.ms-frame{position:absolute;transform-origin:top left;width:${VW}px;height:${VH}px;}
.ms-canvas{position:absolute;inset:0;width:${VW}px;height:${VH}px;display:block;}
.ms-ui{position:absolute;inset:0;pointer-events:none;}
.ms-ui > *{pointer-events:auto;}
.ms-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:radial-gradient(ellipse at 50% 40%,rgba(24,16,10,.94),rgba(4,6,12,.985));
  backdrop-filter:blur(3px);text-align:center;}
.ms-title{font-size:56px;font-weight:800;margin:0;letter-spacing:-1.5px;
  background:linear-gradient(180deg,#ffd76b,#ff9e2c 60%,#c8631a);-webkit-background-clip:text;
  background-clip:text;color:transparent;}
.ms-sub{font-size:16px;color:#a9927a;margin:8px 0 0;}
.ms-hero{width:132px;animation:ms-bob 2.4s ease-in-out infinite;
  filter:drop-shadow(0 12px 26px rgba(255,150,60,.4));}
@keyframes ms-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-10px) rotate(4deg)}}
.ms-btn{background:linear-gradient(180deg,#f0a52c,#d4821a);border:1px solid #ffc866;color:#241403;
  padding:14px 34px;border-radius:11px;font-size:17px;font-weight:750;cursor:pointer;font-family:inherit;
  box-shadow:0 4px 0 #8a5410,0 8px 20px rgba(220,140,30,.3);transition:.14s;}
.ms-btn:hover{transform:translateY(-2px);box-shadow:0 6px 0 #8a5410,0 12px 26px rgba(220,140,30,.4);}
.ms-btn.ghost{background:rgba(255,255,255,.06);border-color:#4a3a28;color:#e0cdb4;box-shadow:none;
  padding:10px 20px;font-size:14px;}
.ms-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:22px;}
.ms-keys{margin-top:20px;font-size:13px;color:#8a7a68;}
.ms-kbd{display:inline-block;background:#241a12;border:1px solid #4a3a28;border-bottom-width:2px;
  border-radius:5px;padding:1px 8px;font-family:ui-monospace,monospace;font-size:12px;color:#e0cdb4;margin:0 2px;}
.ms-panel{background:linear-gradient(180deg,#1d1610,#0d0a07);border:1px solid #4a3a28;border-radius:16px;
  padding:22px 28px;min-width:460px;box-shadow:0 24px 60px rgba(0,0,0,.6);margin-top:14px;}
.ms-stat{display:flex;justify-content:space-between;padding:7px 0;font-size:14.5px;border-bottom:1px solid #2b2119;}
.ms-stat:last-child{border-bottom:none;}
.ms-stat b{color:#ffd76b;font-variant-numeric:tabular-nums;}
.ms-big{font-size:46px;font-weight:800;color:#ffd76b;text-align:center;font-variant-numeric:tabular-nums;
  text-shadow:0 4px 22px rgba(240,165,44,.3);margin:2px 0 4px;}
.ms-build{margin-top:16px;width:100%;max-width:560px;}
.ms-build h4{margin:0 0 8px;font-size:12px;letter-spacing:1.4px;color:#a9927a;text-transform:uppercase;}
.ms-bar{height:12px;background:#241a12;border:1px solid #4a3a28;border-radius:8px;overflow:hidden;}
.ms-bar i{display:block;height:100%;background:linear-gradient(90deg,#7fd6c4,#ffd76b);transition:width .5s;}
.ms-next{font-size:12.5px;color:#a9927a;margin-top:7px;}
.ms-next b{color:#7fd6c4;}
.ms-mods{display:flex;gap:7px;flex-wrap:wrap;justify-content:center;margin-top:12px;}
.ms-mod{background:#1a1310;border:1px solid #33261c;border-radius:20px;padding:5px 12px;font-size:12px;
  color:#6b5a48;display:flex;gap:6px;align-items:center;}
.ms-mod.on{border-color:#6ee7a0;background:#12241a;color:#8ff0ad;}
.ms-unlock{margin-top:14px;background:rgba(110,231,160,.1);border:1px solid #2e7d4f;border-radius:12px;
  padding:12px 16px;font-size:14px;color:#c7f5da;animation:ms-pop .4s cubic-bezier(.2,1.4,.4,1);}
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
    ['costbot', 'beat_up', 'inspire', 'max_speed_clean'].forEach((k) => {
      const im = new Image();
      im.src = this.assetBase + k + '.png';
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

    // touch / swipe
    let tx = 0, ty = 0, tt = 0;
    this._onTouchStart = (e) => {
      const t = e.changedTouches[0];
      tx = t.clientX; ty = t.clientY; tt = Date.now();
      this.audio.resume();
    };
    this._onTouchEnd = (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - tx, dy = t.clientY - ty;
      if (Date.now() - tt > 700) return;
      if (!this.run || this.run.over) { this.start(); return; }
      if (Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > 30) this.shift(dx > 0 ? 1 : -1);
      } else if (dy < -30) this.jump();
      else if (dy > 30) this.slide();
    };
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
    this.canvas.addEventListener('touchend', this._onTouchEnd, { passive: true });
    this._onDown = () => { this.audio.resume(); if (this.music) this.music.setState('stage'); };
    this.canvas.addEventListener('pointerdown', this._onDown);

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
    function tone(f, d, type, v, to) {
      if (muted) return;
      const c = ensure(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f, c.currentTime);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), c.currentTime + d);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(v || 0.16, c.currentTime + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g); g.connect(master); o.start(); o.stop(c.currentTime + d + 0.02);
    }
    return {
      nodes() { const c = ensure(); return c ? { ctx: c, master } : null; },
      token: () => tone(1180, 0.05, 'sine', 0.07, 1620),
      big: () => tone(760, 0.12, 'triangle', 0.12, 1240),
      jump: () => tone(420, 0.14, 'square', 0.07, 780),
      slide: () => tone(300, 0.16, 'sawtooth', 0.06, 160),
      power: () => { [660, 880, 1180].forEach((f, i) => {
        setTimeout(() => tone(f, 0.16, 'triangle', 0.11), i * 60);
      }); },
      crash: () => { tone(180, 0.5, 'sawtooth', 0.2, 50); },
      shield: () => tone(520, 0.3, 'sine', 0.14, 900),
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

  Game.prototype.buildBar = function () {
    const p = this.profile;
    const next = C.MODULES.find((m) => !(p.modules && p.modules[m.id]));
    const done = C.MODULES.filter((m) => p.modules && p.modules[m.id]).length;
    const pct = next ? clamp((p.totalTokens / next.cost) * 100, 0, 100) : 100;
    return `<div class="ms-build">
      <h4>The Ultimate FinOps App — ${done}/${C.MODULES.length} modules</h4>
      <div class="ms-bar"><i style="width:${pct}%"></i></div>
      <div class="ms-next">${next
        ? `<b>${esc(next.icon + ' ' + next.name)}</b> at ${next.cost.toLocaleString()} tokens
           · you have ${Math.floor(p.totalTokens).toLocaleString()}`
        : 'Every module built. The app runs itself.'}</div>
      <div class="ms-mods">${C.MODULES.map((m) => `<span class="ms-mod ${
        p.modules && p.modules[m.id] ? 'on' : ''}">${m.icon} ${esc(m.name)}</span>`).join('')}</div>
    </div>`;
  };

  Game.prototype.screenTitle = function () {
    this.run = null;
    this.clearUI();
    if (this.music) this.music.setState('menu');
    const tip = C.TIPS[(Math.random() * C.TIPS.length) | 0];
    const el = document.createElement('div');
    el.className = 'ms-screen';
    el.innerHTML = `
      <img class="ms-hero" src="${this.assetBase}costbot.png" alt="">
      <h1 class="ms-title">CostBot Mudsliders</h1>
      <p class="ms-sub">Slide the hill. Collect the tokens. Build the app.</p>
      ${this.buildBar()}
      <div class="ms-row"><button class="ms-btn" data-act="go">▶ Drop In</button></div>
      <div class="ms-keys">
        <span class="ms-kbd">← →</span> switch lane &nbsp;
        <span class="ms-kbd">↑ / Space</span> jump &nbsp;
        <span class="ms-kbd">↓</span> slide &nbsp;
        <span class="ms-kbd">M</span> mute
      </div>
      <p class="ms-sub" style="font-size:13px;font-style:italic;margin-top:16px">💡 ${esc(tip)}</p>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="go"]')) { this.audio.resume(); this.start(); }
    });
  };

  Game.prototype.screenOver = function (res) {
    this.clearUI();
    if (this.music) this.music.setState('menu');
    const el = document.createElement('div');
    el.className = 'ms-screen';
    el.innerHTML = `
      <img class="ms-hero" style="animation:none;width:118px;border-radius:12px;object-fit:cover"
           src="${this.assetBase}beat_up.png" alt="">
      <h2 style="font-size:34px;margin:12px 0 2px;color:#ff8a8a">WIPEOUT</h2>
      <p class="ms-sub">${esc(res.cause)}</p>
      <div class="ms-panel">
        <div style="text-align:center;font-size:12px;color:#a9927a;letter-spacing:1.2px">TOKENS COLLECTED</div>
        <div class="ms-big">${res.tokens.toLocaleString()}</div>
        <div class="ms-stat"><span>📏 Distance</span><b>${res.distance.toLocaleString()} m</b></div>
        <div class="ms-stat"><span>🌬️ Near misses</span><b>${res.nearMisses}</b></div>
        <div class="ms-stat"><span>⚡ Top speed</span><b>${Math.round(res.topSpeed)}</b></div>
        <div class="ms-stat"><span>💰 Banked to the arcade</span><b>$${res.dollars.toLocaleString()}</b></div>
        ${res.best ? '<div class="ms-stat"><span>🏅 New personal best</span><b>yes</b></div>' : ''}
      </div>
      ${res.unlocked.length ? `<div class="ms-unlock">🎉 Unlocked
        <b>${res.unlocked.map((m) => esc(m.icon + ' ' + m.name)).join(', ')}</b> —
        ${esc(res.unlocked.map((m) => m.perk).join(' · '))}</div>` : ''}
      ${this.buildBar()}
      <div class="ms-row">
        <button class="ms-btn" data-act="again">↻ Again</button>
        <button class="ms-btn ghost" data-act="menu">Menu</button>
      </div>`;
    this.ui.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'again') this.start();
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
    const pk = perks(this.profile);
    this.clearUI();
    if (this.music) this.music.setState('stage');
    this.run = {
      z: 0, speed: C.WORLD.startSpeed + pk.startSpeedBonus, topSpeed: 0,
      lane: 1, laneFrom: 1, laneT: 1,
      y: 0, vy: 0, jumping: false, sliding: 0,
      shields: pk.startShields, maxShields: pk.maxShields,
      tokens: 0, nearMisses: 0, distance: 0,
      objs: [], fx: [], floats: [],
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
      const total = pool.reduce((a, x) => {
        const bias = x.type === 'untagged_crate' ? r.perks.crateBias : 1;
        return a + x.weight * bias;
      }, 0);
      let roll = Math.random() * total;
      for (const x of pool) {
        const bias = x.type === 'untagged_crate' ? r.perks.crateBias : 1;
        roll -= x.weight * bias;
        if (roll <= 0) return x.type;
      }
      return pool[pool.length - 1].type;
    };

    const used = [];
    // one hard block, in a random lane
    if (blockers.length && Math.random() < 0.8) {
      const lane = lanes.splice((Math.random() * lanes.length) | 0, 1)[0];
      const type = pick(blockers);
      r.objs.push({ kind: 'obs', type, def: C.OBSTACLES[type], lane, z: atZ, hit: false, passed: false });
      used.push(lane);
    }
    // passable hazards elsewhere — density climbs with distance
    const extra = m < 500 ? 0 : m < 1400 ? 1 : 2;
    for (let i = 0; i < extra && lanes.length > 1 && passable.length; i++) {
      if (Math.random() > 0.55) continue;
      const lane = lanes.splice((Math.random() * lanes.length) | 0, 1)[0];
      const type = pick(passable);
      r.objs.push({
        kind: 'obs', type, def: C.OBSTACLES[type], lane, z: atZ,
        hit: false, passed: false,
      });
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
    const id = keys[(Math.random() * keys.length) | 0];
    this.run.objs.push({ kind: 'pow', id, lane: (Math.random() * 3) | 0, z: atZ, got: false });
  };

  // ===========================================================================
  Game.prototype.update = function (dt) {
    const r = this.run;
    const W = C.WORLD;

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
          if (!survived) { o.hit = true; this.crash(o.def); }
          else o.hit = true;
        }
      }
    }

    for (let i = r.floats.length - 1; i >= 0; i--) {
      const f = r.floats[i];
      f.life -= dt; f.y -= 40 * dt;
      if (f.life <= 0) r.floats.splice(i, 1);
    }

    if (r.distance >= 1000 && r.shields === r.perks.startShields && !r.usedShield) this.unlock('ms_nohit');
    if (r.distance >= 2000) this.unlock('ms_2km');
    if (r.tokens >= 1000) this.unlock('ms_1k');
  };

  Game.prototype.float = function (x, text, color) {
    this.run.floats.push({ x, text, color, life: 1.0, max: 1.0, y: 0 });
  };

  Game.prototype.takePower = function (id) {
    const r = this.run;
    const def = C.POWERUPS[id];
    this.audio.power();
    if (id === 'reserved') {
      r.shields = Math.min(r.maxShields, r.shields + 1);
      this.toast(`${def.icon} ${def.name} — ${r.shields} held`);
    } else {
      r.power[id] = def.dur;
      this.toast(`${def.icon} ${def.name} — ${def.blurb}`);
    }
    this.emit('run:power', { id });
  };

  Game.prototype.crash = function (def) {
    const r = this.run;
    if (r.invuln > 0) return;
    if (r.shields > 0) {
      r.shields--;
      r.usedShield = true;
      r.invuln = C.WORLD.crashGrace;
      r.shake = 16;
      this.audio.shield();
      this.float(this.laneX(r), '🛡️ SHIELD USED', '#6ee7a0');
      return;
    }
    r.over = true;
    r.cause = def.blurb || 'You hit something expensive.';
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
    p.runs = (p.runs || 0) + 1;
    const best = tokens > (p.best || 0);
    if (best) p.best = tokens;
    if (r.distance > (p.bestDistance || 0)) p.bestDistance = r.distance;
    this.unlock('ms_first');

    // module unlocks are cumulative against lifetime tokens
    const unlocked = [];
    p.modules = p.modules || {};
    for (const m of C.MODULES) {
      if (!p.modules[m.id] && p.totalTokens >= m.cost) {
        p.modules[m.id] = Date.now();
        unlocked.push(m);
      }
    }
    if (C.MODULES.every((m) => p.modules[m.id])) this.unlock('ms_built');

    saveLocal(p);

    const dollars = tokens * C.DOLLARS_PER_TOKEN;
    const res = {
      game: 'mudsliders',
      stageId: 'endless',
      outcome: 'death',
      tokens,
      distance: r.distance,
      nearMisses: r.nearMisses,
      topSpeed: r.topSpeed,
      dollarsSaved: dollars,
      dollars,
      level: Object.keys(p.modules).length,
      kills: 0,
      quizCorrect: 0,
      quizWrong: 0,
      best,
      unlocked,
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
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 60);
    sky.addColorStop(0, '#2b1d13');
    sky.addColorStop(1, '#6b4526');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VW, HORIZON + 60);
    ctx.fillStyle = '#160f0a';
    ctx.fillRect(0, HORIZON + 40, VW, VH - HORIZON - 40);

    if (!r) { this.drawHaze(ctx); return; }

    const camZ = r.z - CAM_BACK;
    const shakeX = r.shake ? (Math.random() * 2 - 1) * r.shake : 0;
    ctx.save();
    ctx.translate(shakeX, r.shake ? (Math.random() * 2 - 1) * r.shake * 0.5 : 0);

    // --- the hill: trapezoid strips from far to near ------------------------
    const startZ = Math.floor(camZ / SEG) * SEG;
    const halfRoad = C.WORLD.laneWidth * 1.85;
    const chasms = r.objs.filter((o) => o.kind === 'obs' && o.def.kind === 'chasm');
    for (let i = Math.floor(C.WORLD.drawDistance / SEG); i >= 0; i--) {
      const z0 = startZ + i * SEG;
      const z1 = z0 + SEG;
      const a = this.project(z0, camZ, 0, 0);
      const b = this.project(z1, camZ, 0, 0);
      if (!a || !b) continue;
      const inChasm = chasms.some((c) => Math.abs(c.z - (z0 + SEG / 2)) < C.OBSTACLES.billing_gap.w / 2);
      const wa = halfRoad * a.s, wb = halfRoad * b.s;
      const dark = (Math.floor(z0 / SEG) % 2) === 0;
      // shoulders
      ctx.fillStyle = dark ? '#1d2a16' : '#22301a';
      ctx.beginPath();
      ctx.moveTo(0, a.y); ctx.lineTo(VW, a.y); ctx.lineTo(VW, b.y); ctx.lineTo(0, b.y);
      ctx.closePath(); ctx.fill();
      if (inChasm) {
        ctx.fillStyle = '#07090e';
        ctx.beginPath();
        ctx.moveTo(VW / 2 - wa, a.y); ctx.lineTo(VW / 2 + wa, a.y);
        ctx.lineTo(VW / 2 + wb, b.y); ctx.lineTo(VW / 2 - wb, b.y);
        ctx.closePath(); ctx.fill();
        continue;
      }
      // mud
      ctx.fillStyle = dark ? '#4a3421' : '#553c26';
      ctx.beginPath();
      ctx.moveTo(VW / 2 - wa, a.y); ctx.lineTo(VW / 2 + wa, a.y);
      ctx.lineTo(VW / 2 + wb, b.y); ctx.lineTo(VW / 2 - wb, b.y);
      ctx.closePath(); ctx.fill();
      // lane grooves
      if (dark) {
        ctx.strokeStyle = 'rgba(255,220,180,.06)';
        ctx.lineWidth = 1.5;
        for (const lx of [-0.5, 0.5]) {
          const xa = VW / 2 + lx * C.WORLD.laneWidth * a.s;
          const xb = VW / 2 + lx * C.WORLD.laneWidth * b.s;
          ctx.beginPath(); ctx.moveTo(xa, a.y); ctx.lineTo(xb, b.y); ctx.stroke();
        }
      }
    }

    // --- objects, far to near -----------------------------------------------
    const sorted = r.objs.slice().sort((o1, o2) => o2.z - o1.z);
    for (const o of sorted) {
      const pr = this.project(o.z, camZ, (o.lane - 1) * C.WORLD.laneWidth, 0);
      if (!pr || pr.s > 4) continue;
      if (o.kind === 'tok' && !o.got) this.drawToken(ctx, o, pr);
      else if (o.kind === 'pow' && !o.got) this.drawPower(ctx, o, pr);
      else if (o.kind === 'obs' && o.def.kind !== 'chasm') this.drawObstacle(ctx, o, pr, r);
    }

    this.drawBot(ctx, r, camZ);

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
    this.drawHaze(ctx);
    this.drawHUD(ctx, r);
  };

  Game.prototype.drawHaze = (ctx) => {
    const g = ctx.createRadialGradient(VW / 2, VH * 0.45, VH * 0.3, VW / 2, VH * 0.5, VH * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(12,7,4,.72)');
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

  Game.prototype.drawPower = (ctx, o, pr) => {
    const def = C.POWERUPS[o.id];
    const s = 46 * pr.s;
    if (s < 3) return;
    const y = pr.y - 70 * pr.s;
    const spin = (performance.now() / 400) % TAU;
    ctx.save();
    ctx.translate(pr.x, y);
    ctx.rotate(Math.sin(spin) * 0.25);
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

  Game.prototype.drawObstacle = (ctx, o, pr, r) => {
    const d = o.def;
    const w = d.w * pr.s;
    const h = d.h * pr.s;
    if (w < 2) return;
    const baseY = pr.y;
    const warn = r.perks.earlyWarn && o.z - r.z < 1600 && o.z - r.z > 900;

    ctx.save();
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.ellipse(pr.x, baseY, w * 0.5, w * 0.14, 0, 0, TAU); ctx.fill();

    ctx.fillStyle = d.color;
    ctx.strokeStyle = warn ? '#ffd76b' : d.accent;
    ctx.lineWidth = Math.max(1.5, 3 * pr.s);
    ctx.beginPath();
    ctx.roundRect(pr.x - w / 2, baseY - h, w, h, Math.min(14 * pr.s, h * 0.3));
    ctx.fill(); ctx.stroke();

    // a slide-under hazard is drawn raised, so the gap beneath reads instantly
    if (d.kind === 'slide') {
      ctx.clearRect(pr.x - w / 2 - 2, baseY - h * 0.42, w + 4, h * 0.42);
    }
    if (w > 26) {
      ctx.font = `${Math.min(w * 0.4, h * 0.7)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.glyph, pr.x, baseY - h * (d.kind === 'slide' ? 0.72 : 0.5));
    }
    if (warn) {
      ctx.strokeStyle = 'rgba(255,215,107,.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(pr.x - w * 0.62, baseY - h * 1.2, w * 1.24, h * 1.3);
    }
    ctx.restore();
  };

  Game.prototype.drawBot = function (ctx, r, camZ) {
    const px = this.laneX(r);
    const pr = this.project(r.z, camZ, px, r.y);
    if (!pr) return;
    const size = 128;
    const squash = r.sliding > 0 ? 0.55 : 1;
    ctx.save();
    // mud spray
    if (!r.jumping) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU;
        ctx.fillStyle = `rgba(90,64,40,${0.25 + Math.random() * 0.3})`;
        ctx.beginPath();
        ctx.arc(pr.x + Math.cos(a) * (30 + Math.random() * 46),
          pr.y + 6 + Math.abs(Math.sin(a)) * 12, 3 + Math.random() * 6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y + 4, 44, 13, 0, 0, TAU);
    ctx.fill();

    ctx.translate(pr.x, pr.y - size * 0.42 * squash - r.y * 0.55);
    ctx.scale(1, squash);
    if (r.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0) ctx.globalAlpha = 0.5;
    // lean into the turn
    ctx.rotate(((r.lane - 1) - (this.laneX(r) / C.WORLD.laneWidth)) * -0.55);
    const img = this.img.costbot;
    ctx.shadowColor = 'rgba(255,170,80,.5)'; ctx.shadowBlur = 22;
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -size / 2, -size / 2, size, size);
    else { ctx.fillStyle = '#4aa3ff'; ctx.beginPath(); ctx.arc(0, 0, 40, 0, TAU); ctx.fill(); }
    ctx.restore();
  };

  Game.prototype.drawHUD = (ctx, r) => {
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(8,6,4,.72)';
    ctx.fillRect(0, 0, VW, 56);
    ctx.fillStyle = '#f0a52c';
    ctx.fillRect(0, 55, VW, 1.5);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9927a'; ctx.font = '11px "Segoe UI",system-ui,sans-serif';
    ctx.fillText('TOKENS', 18, 9);
    ctx.fillStyle = '#ffd76b'; ctx.font = 'bold 25px ui-monospace,monospace';
    ctx.fillText(Math.floor(r.tokens).toLocaleString(), 18, 22);

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

    // shields
    for (let i = 0; i < r.shields; i++) {
      ctx.font = '20px serif'; ctx.textAlign = 'left';
      ctx.fillText('🛡️', 18 + i * 26, VH - 40);
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
  global.Mudsliders = {
    mount(container, opts) {
      if (typeof container === 'string') container = document.querySelector(container);
      if (!container) throw new Error('Mudsliders.mount: container not found');
      return new Game(container, opts || {});
    },
    CONTENT: C,
    loadProfile: loadLocal,
    resetProfile() { try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
