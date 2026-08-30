/*
 * CostBotLand — engine
 * ==================================================================
 * A fixed-screen park-triage rush. CostBot patrols four lands ringing a solid
 * central castle; rides break, guests drop things on the track, queues get
 * hungry, and every land has its own happiness meter draining in real time.
 * Clear incidents to refill meters and build combos; let a land hit zero and it
 * goes dark. A loop train circles the castle — ride it to reach the far side, or
 * sprint when the fire is close. Survive the day to the fireworks finale.
 *
 *   CostBotLand.mount(container, { onComplete, onEvent, meta, persist })
 *
 * Resolution-independent (authored in logical FIELD units, scaled to canvas).
 * Unified input: WASD/arrows + an action key on desktop; a thumb joystick +
 * action tap on touch. The action is always contextual — fix the incident
 * you're standing on, board/leave the train you're next to.
 */
(function (global) {
  'use strict';

  const C = global.CostBotLandContent;
  const F = C.FIELD, S = C.SCORING;

  // little-person palettes for the ticket queue, so the line reads as a crowd
  const GUEST_SHIRTS = ['#e06666', '#6fa8dc', '#93c47d', '#ffd966', '#c27ba0', '#76a5af', '#f6b26b', '#b48ead'];
  const GUEST_SKINS = ['#f1d2b0', '#e6b88f', '#c98d5a', '#a3673b', '#7a4a24'];
  const GUEST_HAIR = ['#2a1c14', '#5b3a1e', '#141414', '#7a6a55', '#d9c27a'];
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ---- helpers -------------------------------------------------------------
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function rrect(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) { ctx.beginPath(); return; }
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- audio: blips on a master bus + the shared ArcadeMusic soundtrack --------
  function makeAudio() {
    let ac = null, master = null, music = null, muted = false;
    const ok = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
    function actx() {
      if (!ok) return null;
      if (!ac) {
        const A = global.AudioContext || global.webkitAudioContext; ac = new A();
        master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function blip(freq, dur, type, gain) {
      const a = actx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = gain == null ? 0.06 : gain;
      o.connect(g); g.connect(master);
      const t = a.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    }
    // A short burst of filtered white noise, scheduled at absolute AudioContext
    // time `t` — used for percussive "thunk"/"boom"/crackle textures that a plain
    // oscillator can't produce (cash-drawer thunk, firework boom + sparkle tail).
    function noiseBurst(a, t, dur, freq, gain, filterType) {
      const n = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, n, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 1.4;
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = filterType || 'lowpass'; f.frequency.value = freq || 1200;
      const g = a.createGain(); g.gain.value = gain == null ? 0.15 : gain;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t);
    }
    function ensureMusic() {
      const a = actx(); if (!a || !global.ArcadeMusic) return null;
      if (!music) music = global.ArcadeMusic.create(() => ({ ctx: a, master }));
      return music;
    }
    return {
      fix(combo) {
        const a = actx(); if (!a) return;
        const c = Math.min(6, combo);
        const root = 880 + c * 70; // bright, climbs with combo
        const t0 = a.currentTime;
        const coinNote = (freq, delay, dur, peak) => {
          const t = t0 + delay;
          const o1 = a.createOscillator(), o2 = a.createOscillator();
          const g = a.createGain(), sparkle = a.createGain();
          o1.type = 'square'; o1.frequency.value = freq;
          o2.type = 'triangle'; o2.frequency.value = freq * 2;
          sparkle.gain.value = 0.35;
          o1.connect(g); o2.connect(sparkle); sparkle.connect(g);
          g.connect(master);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o1.start(t); o1.stop(t + dur);
          o2.start(t); o2.stop(t + dur);
        };
        coinNote(root, 0, 0.09, 0.13);
        coinNote(root * 1.5, 0.07, 0.12, 0.16);
      },
      grab() { blip(540, 0.07, 'triangle', 0.05); },
      board() { blip(300, 0.12, 'square', 0.05); },
      churro() { blip(760, 0.08, 'triangle', 0.06); setTimeout(() => blip(1010, 0.1, 'triangle', 0.05), 70); },
      down() { blip(120, 0.4, 'sawtooth', 0.07); },
      // Acting with nothing nearby to act on — a quick flat "no" buzz. Lighter
      // than down() on purpose: whiffing a keypress is a much smaller mistake
      // than losing a goal/child/ticket, so it shouldn't sound as costly.
      whiff() { blip(180, 0.09, 'square', 0.1, 130); },
      // Ticket gate admit: a low mechanical "cha-CHUNK" — a squat bell/ding
      // followed a beat later by a short lowpassed noise "drawer thunk".
      // Deliberately lower and more mechanical than the bright coin fix().
      cashRegister() {
        const a = actx(); if (!a) return;
        const t0 = a.currentTime;
        // A clean two-strike till bell — "cha-CHING". The previous version
        // paired the bell with low-passed noise bursts meant to read as a
        // drawer/mechanism, but in practice that landed as a dull percussive
        // knock (reported: "a pickaxe on a rock"), not a register. Dropping
        // the noise entirely and leaning on just the bright bell strikes.
        [[1568, 0, 0.16, 0.24], [2093, 0.09, 0.20, 0.20]].forEach(([freq, delay, dur, peak]) => {
          const t = t0 + delay;
          const o = a.createOscillator(), g = a.createGain();
          o.type = 'triangle'; o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(g); g.connect(master);
          o.start(t); o.stop(t + dur + 0.02);
        });
      },
      // Token milestone: a light two-note "ding-ding", quicker and airier than
      // fix()'s coin-combo chime and cheer()'s four-note fanfare, so a token
      // landing mid-run reads as its own small event, not a duplicate of either.
      token() {
        const a = actx(); if (!a) return;
        const t0 = a.currentTime;
        [1318.5, 1760].forEach((freq, i) => {
          const t = t0 + i * 0.055;
          const o = a.createOscillator(), g = a.createGain();
          o.type = 'sine'; o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
          o.connect(g); g.connect(master);
          o.start(t); o.stop(t + 0.1);
        });
      },
      // Lost child reunited: a quick bright ascending arpeggio — more "hooray"
      // than a cash reward, distinct from both fix() and cashRegister().
      cheer() {
        const a = actx(); if (!a) return;
        const t0 = a.currentTime;
        [660, 880, 1046.5, 1318.5].forEach((freq, i) => {
          const t = t0 + i * 0.07;
          const o = a.createOscillator(), g = a.createGain();
          o.type = 'triangle'; o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          o.connect(g); g.connect(master);
          o.start(t); o.stop(t + 0.18);
        });
      },
      // Finale firework: a rising launch whistle, a percussive boom a beat
      // later, and a brief decaying sparkle tail — paired 1:1 with a visual burst.
      firework() {
        const a = actx(); if (!a) return;
        const t0 = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(500, t0);
        o.frequency.exponentialRampToValueAtTime(1600, t0 + 0.32);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        o.connect(g); g.connect(master);
        o.start(t0); o.stop(t0 + 0.32);
        const boomT = t0 + 0.34;
        noiseBurst(a, boomT, 0.26, 850, 0.22, 'lowpass');        // boom
        noiseBurst(a, boomT + 0.04, 0.4, 3400, 0.05, 'highpass'); // sparkle/crackle tail
      },
      resume() { actx(); },
      playMusic(key) { const m = ensureMusic(); if (m) { m.setVolume(0.6); m.playTrack(key); } },
      stopMusic() { if (music) music.stop(); },
      setMuted(v) { muted = !!v; if (master) master.gain.value = muted ? 0 : 1; return muted; },
      isMuted() { return muted; },
    };
  }

  // ==========================================================================
  function mount(target, opts) {
    opts = opts || {};
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('CostBotLand.mount: container not found');
    host.innerHTML = '';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const audio = makeAudio();

    const onEvent = opts.onEvent || (() => {});
    const onComplete = opts.onComplete || (() => {});

    // ---- persistent profile (bests) ----------------------------------------
    const LS_KEY = 'costbot.land.meta';
    function defaultMeta() { return { bestGuests: 0, bestStars: 0, bestCombo: 0, bestUptime: 0, plays: 0, muted: false }; }
    function loadMeta() {
      if (opts.meta) return Object.assign(defaultMeta(), opts.meta);
      if (opts.persist) { try { const raw = global.localStorage && localStorage.getItem(LS_KEY);
        if (raw) return Object.assign(defaultMeta(), JSON.parse(raw)); } catch (e) {} }
      return defaultMeta();
    }
    function saveMeta() { if (!opts.persist) return;
      try { global.localStorage && localStorage.setItem(LS_KEY, JSON.stringify(api.meta)); } catch (e) {} }

    // ---- chef sprite --------------------------------------------------------
    const chefImg = new Image();
    let chefReady = false;
    chefImg.onload = () => { chefReady = true; };
    chefImg.src = '../shared/assets/costbot.png';

    // The painted park basemap. When it's loaded we draw it instead of the vector
    // park furniture (castle, track, lands, scenery) and register the live overlays
    // — meters, incidents, the train car, the chef — on top of it.
    const mapImg = new Image();
    let mapReady = false;
    mapImg.onload = () => { mapReady = true; };
    mapImg.src = 'assets/costbotland2.jpg';

    // ---- viewport / transform ----------------------------------------------
    const view = { scale: 1, offX: 0, offY: 0, cw: 0, ch: 0, dpr: 1 };
    const HUD_H = 54;
    function resize() {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
      view.cw = Math.max(1, rect.width); view.ch = Math.max(1, rect.height); view.dpr = dpr;
      canvas.width = Math.round(view.cw * dpr); canvas.height = Math.round(view.ch * dpr);
      const availH = Math.max(1, view.ch - HUD_H);
      view.scale = Math.min(view.cw / F.w, availH / F.h);
      view.offX = (view.cw - F.w * view.scale) / 2;
      view.offY = HUD_H + (availH - F.h * view.scale) / 2;
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host); else global.addEventListener('resize', resize);
    resize();

    // ---- input --------------------------------------------------------------
    const keys = {};
    let touchMode = false;
    const stick = { active: false, id: null, bx: 0, by: 0, kx: 0, ky: 0, max: 60 };
    function keyVec() {
      let x = 0, y = 0;
      if (keys['arrowleft'] || keys['a']) x -= 1;
      if (keys['arrowright'] || keys['d']) x += 1;
      if (keys['arrowup'] || keys['w']) y -= 1;
      if (keys['arrowdown'] || keys['s']) y += 1;
      return { x, y };
    }
    function stickVec() {
      if (!stick.active) return { x: 0, y: 0 };
      const dx = stick.kx - stick.bx, dy = stick.ky - stick.by, m = Math.hypot(dx, dy) || 1;
      const f = Math.min(1, m / stick.max);
      return { x: (dx / m) * f, y: (dy / m) * f };
    }
    function moveVec() {
      const k = keyVec(), s = stickVec();
      let x = k.x + s.x, y = k.y + s.y; const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      return { x, y };
    }
    function onKeyDown(e) {
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) || k === 'spacebar') e.preventDefault();
      if (k === 'escape') { quitToMenu(); return; }
      if (k === 'm') { toggleMute(); return; }
      if (k === ' ' || k === 'spacebar' || k === 'enter' || k === 'e') {
        // Space is the action button mashed throughout a run — don't let a
        // leftover press instantly restart from the results screen. Click/tap
        // (or Enter/E) still restarts; only Space is swallowed here.
        const isSpace = k === ' ' || k === 'spacebar';
        if (isSpace && G.state === 'over') { keys['_act'] = true; return; }
        if (!keys['_act']) primaryAction(); keys['_act'] = true; return;
      }
      keys[k] = true; audio.resume();
    }
    function onKeyUp(e) {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'spacebar' || k === 'enter' || k === 'e') { keys['_act'] = false; return; }
      keys[k] = false;
    }
    global.addEventListener('keydown', onKeyDown);
    global.addEventListener('keyup', onKeyUp);
    function pointerPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function onPointerDown(e) {
      const touchLike = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (touchLike) touchMode = true; audio.resume();
      const p = pointerPos(e);
      if (touchLike && p.x < view.cw * 0.5 && G.state === 'playing') {
        stick.active = true; stick.id = e.pointerId; stick.bx = p.x; stick.by = p.y; stick.kx = p.x; stick.ky = p.y;
      } else { primaryAction(); }
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
      e.preventDefault();
    }
    function onPointerMove(e) { if (stick.active && e.pointerId === stick.id) { const p = pointerPos(e); stick.kx = p.x; stick.ky = p.y; } }
    function onPointerUp(e) { if (stick.active && e.pointerId === stick.id) { stick.active = false; stick.id = null; } }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    // ==========================================================================
    const PERIM = C.trackPerim();
    const G = {
      state: 'menu', t: 0, last: now(),
      chef: { x: 500, y: 600, held: null, prep: null, onTrack: false, boost: 0, carryChild: null },
      lands: [],            // {def, happy, incident, downT}
      gate: { happy: C.GATE.start, line: [], spawnT: 1.5, jamT: 0, frontT: C.GATE.patience },
      child: null,
      churro: null, churroT: C.CHURRO.every,
      goalT: 1.5, phase: C.PHASES[0],
      // scoring
      guests: 0, score: 0, combo: 0, longestCombo: 0, peakStars: 0, burnFloats: [],
      // tokenWatermark is the highest $dollarsPerToken step already paid out (see
      // awardTokens below); tokensEarned is the running lifetime total of tokens
      // actually paid this run — reported at round end instead of a lump sum.
      tokenWatermark: 0, tokensEarned: 0,
      openLandSec: 0, totalLandSec: 0,
      floats: [], sparks: [],
      result: null, hint: null,
    };

    function reset() {
      G.t = 0; G.chef = { x: 500, y: 600, held: null, prep: null, onTrack: false, boost: 0, carryChild: null };
      G.lands = C.LANDS.map((def) => ({ def, happy: S.landStart, incident: null, downT: 0 }));
      G.gate = { happy: C.GATE.start, line: [], spawnT: 1.5, jamT: 0, frontT: C.GATE.patience };
      G.child = null;
      G.churro = null; G.churroT = C.CHURRO.every;
      G.goalT = 1.5; G.phase = C.PHASES[0];
      G.guests = 0; G.score = 0; G.combo = 0; G.longestCombo = 0; G.peakStars = 0;
      G.tokenWatermark = 0; G.tokensEarned = 0;
      G.openLandSec = 0; G.totalLandSec = 0;
      G.floats = []; G.sparks = []; G.result = null; G.hint = null;
    }
    function startRun() { reset(); G.state = 'playing'; G.last = now(); audio.resume(); audio.playMusic('ch_parade'); onEvent('run:start', {}); }
    // Esc bails out of a run back to the intro (no score recorded).
    function quitToMenu() { if (G.state !== 'playing') return; audio.stopMusic(); G.state = 'menu'; G.hint = null; onEvent('run:end', {}); }
    function toggleMute() { const m = audio.setMuted(!audio.isMuted()); api.meta.muted = m; saveMeta(); onEvent('mute', { muted: m }); return m; }

    function addFloat(x, y, text, color, big) { G.floats.push({ x, y, text, color: color || '#fff', life: 1, big: !!big }); }

    // Tokens accrue LIVE, in step with park cash, instead of waiting for the
    // results screen: every S.dollarsPerToken of net G.score pays out a token the
    // instant the player crosses a new watermark. The watermark only ever climbs
    // — a penalty that drags the score back down doesn't claw back tokens already
    // paid, it just delays the next payout until the score recovers past the old
    // high point. Called after every G.score increase.
    function awardTokens() {
      const level = Math.floor(G.score / S.dollarsPerToken);
      if (level <= G.tokenWatermark) return;
      const n = level - G.tokenWatermark;
      G.tokenWatermark = level;
      G.tokensEarned += n;
      if (global.ArcadeWallet) global.ArcadeWallet.earn(n, 'costbotland');
      addFloat(G.chef.x, G.chef.y - 50, '+' + n + ' 🪙', '#7dd3fc', true);
      audio.token();
    }
    function burst(x, y, color, n) {
      for (let i = 0; i < (n || 10); i++) {
        const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
        G.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7 + Math.random() * 0.5, color });
      }
    }

    // ---- stars / rating -----------------------------------------------------
    // The gate is the 5th section, so it counts toward the park's rating too.
    function avgHappy() { let s = G.gate.happy; for (const l of G.lands) s += l.happy; return s / (G.lands.length + 1); }
    function stars() { return clamp(avgHappy() / 20, 0, 5); }

    // ---- spawning -----------------------------------------------------------
    // One unified goal spawner: every SCORING.goalEvery seconds a goal appears in
    // a random OPEN slot — any of the 4 lands (needs no active incident and not
    // closed) or the lost-child slot (if there's no child out). Several can be
    // open at once, but the flat cadence means the player often waits for the next.
    function spawnGoal() {
      const slots = [];
      G.lands.forEach((l) => { if (l.downT <= 0 && !l.incident) slots.push(l); });
      if (!G.child) slots.push('child');
      if (!slots.length) return;
      const slot = slots[(Math.random() * slots.length) | 0];
      if (slot === 'child') { spawnChild(); return; }
      const pool = C.INCIDENT_POOL;
      slot.incident = { type: C.INCIDENTS[pool[(Math.random() * pool.length) | 0]], ttl: S.goalTtl, ttlMax: S.goalTtl };
    }

    // ---- interaction --------------------------------------------------------
    // distance from a point to the ring track's outline (its four edges)
    function segDist(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1;
      let t = ((px - x1) * dx + (py - y1) * dy) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    function distToTrack(px, py) {
      const t = C.TRACK, x2 = t.x + t.w, y2 = t.y + t.h;
      return Math.min(
        segDist(px, py, t.x, t.y, x2, t.y), segDist(px, py, x2, t.y, x2, y2),
        segDist(px, py, x2, y2, t.x, y2), segDist(px, py, t.x, y2, t.x, t.y));
    }
    function nearChild() {
      return G.child && G.child.state === 'waiting' &&
        dist2(G.chef.x, G.chef.y, G.child.x, G.child.y) < C.CHILD.r * C.CHILD.r;
    }
    function nearGate() {
      return G.gate.jamT <= 0 && G.gate.line.length > 0 &&
        dist2(G.chef.x, G.chef.y, C.GATE.x, C.GATE.y) < C.GATE.r * C.GATE.r;
    }
    function resolveHint() {
      if (G.chef.prep) { G.hint = null; return; }
      // hands full with the lost child: you can only drop them off (no fixing)
      if (G.chef.carryChild) {
        const land = G.lands[G.chef.carryChild.target], a = land.def.attract;
        if (land.downT <= 0 && dist2(G.chef.x, G.chef.y, a.x, a.y) < C.CHEF.pickR * C.CHEF.pickR) {
          G.hint = { kind: 'child_drop' }; return;
        }
        G.hint = null; return;
      }
      // an incident under the chef?
      let best = null, bd = Infinity;
      for (const l of G.lands) {
        if (!l.incident || l.downT > 0) continue;
        const a = l.def.attract, d = dist2(G.chef.x, G.chef.y, a.x, a.y);
        if (d < C.CHEF.pickR * C.CHEF.pickR && d < bd) { bd = d; best = l; }
      }
      if (best) { G.hint = { kind: 'fix', land: best }; return; }
      if (nearChild()) { G.hint = { kind: 'child_pickup' }; return; }
      if (nearGate()) { G.hint = { kind: 'scan' }; return; }
      G.hint = null;
    }

    function primaryAction() {
      if (G.state === 'menu' || G.state === 'over') { startRun(); return; }
      if (G.state !== 'playing') return;
      const h = G.hint; if (!h) { audio.whiff(); return; }
      if (h.kind === 'scan') scanGate();
      else if (h.kind === 'child_pickup') pickupChild();
      else if (h.kind === 'child_drop') dropChild();
      else if (h.kind === 'fix') {
        const inc = h.land.incident; if (!inc) return;
        if (inc.type.hold > 0) { G.chef.prep = { dur: inc.type.hold, t: 0, land: h.land }; }
        else resolveIncident(h.land);
      }
    }

    function resolveIncident(land) {
      const inc = land.incident; if (!inc) return;
      land.incident = null;
      land.happy = Math.min(S.landMax, land.happy + S.repairGain);
      G.combo += 1; G.longestCombo = Math.max(G.longestCombo, G.combo);
      const mult = Math.min(S.comboMax, 1 + (G.combo - 1) * S.comboStep);
      const gain = Math.round(inc.type.score * mult * G.phase.scoreMult);
      G.score += gain; G.guests += 1;
      const a = land.def.attract;
      addFloat(a.x, a.y - 30, '+' + gain.toLocaleString(), '#fde047', true);
      if (mult >= 1.5) addFloat(a.x, a.y - 62, 'x' + mult.toFixed(1) + ' COMBO', '#fbbf24');
      burst(a.x, a.y, land.def.color, 12);
      audio.fix(Math.min(6, G.combo));
      awardTokens();
    }

    // A circle goal timed out unresolved: it vanishes and the park loses cash.
    // Rides no longer close — this is the only consequence of ignoring a goal.
    function goalMissed(land) {
      land.incident = null;
      G.combo = 0;
      G.score -= S.goalMissPenalty;
      const a = land.def.attract;
      addFloat(a.x, a.y - 20, 'MISSED', '#f87171', true);
      addFloat(a.x, a.y - 46, '-$' + S.goalMissPenalty.toLocaleString(), '#f87171', true);
      burst(a.x, a.y, '#f87171', 12);
      audio.down();
    }

    // ---- ticket gate --------------------------------------------------------
    function scanGate() {
      if (!G.gate.line.length) return;
      G.gate.line.shift();                       // admit the front of the line
      G.gate.frontT = C.GATE.patience;           // fresh clock for the next guest up
      G.gate.happy = Math.min(S.landMax, G.gate.happy + C.GATE.scanGain);
      G.guests += 1; G.score += Math.round(C.GATE.score * G.phase.scoreMult);
      addFloat(C.GATE.x + 30, C.GATE.y - 26, '🎟 +' + C.GATE.score, '#7fd8c4');
      audio.cashRegister();
      awardTokens();
    }

    // ---- lost child escort --------------------------------------------------
    function spawnChild() {
      const target = (Math.random() * G.lands.length) | 0;
      G.child = { x: C.CHILD.spawn.x, y: C.CHILD.spawn.y, target, state: 'waiting',
        patience: C.CHILD.patience, max: C.CHILD.patience };
    }
    function pickupChild() {
      if (!G.child || G.child.state !== 'waiting') return;
      G.child.state = 'carried'; G.chef.carryChild = G.child; audio.board();
      addFloat(G.chef.x, G.chef.y - 40, 'GOT YOU!', '#fde68a');
    }
    function dropChild() {
      const c = G.chef.carryChild; if (!c) return;
      const land = G.lands[c.target];
      G.chef.carryChild = null; G.child = null;
      G.combo += 1; G.longestCombo = Math.max(G.longestCombo, G.combo);
      const mult = Math.min(S.comboMax, 1 + (G.combo - 1) * S.comboStep);
      const gain = Math.round(C.CHILD.score * mult * G.phase.scoreMult);
      G.score += gain; G.guests += 1;
      if (land && land.downT <= 0) land.happy = Math.min(S.landMax, land.happy + C.CHILD.gain);
      const a = land ? land.def.attract : { x: G.chef.x, y: G.chef.y };
      addFloat(a.x, a.y - 34, '🧒 REUNITED +' + gain.toLocaleString(), '#fde047', true);
      burst(a.x, a.y, '#fde047', 16); audio.cheer();
      awardTokens();
    }
    function loseChild() {
      const c = G.child; if (!c) return;
      const fx = c.state === 'carried' ? G.chef.x : c.x, fy = c.state === 'carried' ? G.chef.y : c.y;
      G.chef.carryChild = null; G.child = null; G.combo = 0;
      G.score -= S.childPenalty;                 // monetary penalty
      addFloat(fx, fy - 30, 'CHILD LOST', '#f87171', true);
      addFloat(fx, fy - 56, '-$' + S.childPenalty.toLocaleString(), '#f87171', true);
      audio.down();
    }

    // ---- movement + castle collision ---------------------------------------
    function blockedByCastle(x, y) {
      const c = C.CASTLE, r = C.CHEF.r;
      return x > c.x - r && x < c.x + c.w + r && y > c.y - r && y < c.y + c.h + r;
    }
    function moveChef(dt) {
      const v = moveVec();
      // the ring track is a speed lane — on the rails you move trackBoost× faster
      G.chef.onTrack = distToTrack(G.chef.x, G.chef.y) < C.CHEF.laneHalf;
      let sp = C.CHEF.walk * (G.chef.boost > 0 ? C.CHURRO.boost : 1) * (G.chef.onTrack ? C.CHEF.trackBoost : 1);
      const nx = clamp(G.chef.x + v.x * sp * dt, C.CHEF.r, F.w - C.CHEF.r);
      const ny = clamp(G.chef.y + v.y * sp * dt, HUD_H_L() + C.CHEF.r, F.h - C.CHEF.r);
      // The castle blocks you UNLESS the spot you're moving to is on the track —
      // so you can ride the rails right behind the castle, but can't cut through
      // its interior. Axis-separated so you slide along the wall instead of sticking.
      const free = (x, y) => !blockedByCastle(x, y) || distToTrack(x, y) < C.CHEF.laneHalf;
      if (free(nx, G.chef.y)) G.chef.x = nx;
      if (free(G.chef.x, ny)) G.chef.y = ny;
    }
    // top logical inset so the park sits below the rating banner
    function HUD_H_L() { return 96; }

    // ---- update -------------------------------------------------------------
    function update(dt) {
      if (G.state !== 'playing') return;
      G.t += dt;
      G.phase = C.phaseAt(G.t);

      // final-stretch rush: for the last window, every countdown ticks faster so
      // the closing stretch gets frantic. The day clock (G.t) itself is untouched.
      const rush = G.t >= S.roundSeconds - S.rushWindow ? S.finaleRush : 1;
      G.rush = rush > 1;

      // churro spawn / pickup / boost timer
      G.churroT -= dt * rush;
      if (G.churroT <= 0 && !G.churro) {
        G.churro = { x: 470 + Math.random() * 60, y: 250 + Math.random() * 220 };
        // avoid dropping it inside the castle
        if (blockedByCastle(G.churro.x, G.churro.y)) G.churro.x = C.CASTLE.x - 40;
        G.churroT = C.CHURRO.every;
      }
      if (G.chef.boost > 0) G.chef.boost -= dt;

      // prep lock, else move
      if (G.chef.prep) {
        G.chef.prep.t += dt;
        if (G.chef.prep.t >= G.chef.prep.dur) { const l = G.chef.prep.land; G.chef.prep = null; if (l.incident) resolveIncident(l); }
      } else {
        moveChef(dt);
        if (G.churro && dist2(G.chef.x, G.chef.y, G.churro.x, G.churro.y) < C.CHURRO.r * C.CHURRO.r) {
          G.chef.boost = C.CHURRO.dur; G.churro = null; audio.churro();
          addFloat(G.chef.x, G.chef.y - 34, 'CHURRO BOOST!', '#fb923c', true);
        }
      }

      // one goal every goalEvery seconds, into a random open land or the child slot
      G.goalT -= dt * rush;
      if (G.goalT <= 0) { spawnGoal(); G.goalT = S.goalEvery; }

      // ticket gate: a line builds, and ONLY the front guest is on the clock.
      // Scan them in time or they walk out, the line shuffles up, and the timer
      // resets for whoever is now at the front. The gate never jams shut.
      // (No on-screen countdown for this one — the pressure is real, the readout isn't.)
      const gate = G.gate;
      gate.spawnT -= dt * rush;
      if (gate.spawnT <= 0) {
        if (gate.line.length < C.GATE.cap) {
          gate.line.push({ shirt: pick(GUEST_SHIRTS), skin: pick(GUEST_SKINS), hair: pick(GUEST_HAIR) });
          if (gate.line.length === 1) gate.frontT = C.GATE.patience;   // first arrival starts the clock
        }
        gate.spawnT = G.phase.id === 'open' ? C.GATE.spawnOpen : C.GATE.spawnOther;
      }
      if (gate.line.length > 0) {
        gate.frontT -= dt * rush;
        if (gate.frontT <= 0) {
          gate.line.shift();
          G.score -= S.ticketPenalty; gate.happy = Math.max(0, gate.happy - 6); G.combo = 0;
          addFloat(C.GATE.x, C.GATE.y - 60, '-$' + S.ticketPenalty.toLocaleString() + ' walked out', '#f87171', true);
          audio.down();
          gate.frontT = C.GATE.patience;                               // next guest, fresh clock
        }
      }
      gate.happy = clamp(gate.happy - (C.GATE.drainBase + C.GATE.drainPerGuest * gate.line.length) * dt, 0, S.landMax);

      // lost child: tick patience, follow the chef while carried (spawned via spawnGoal)
      if (G.child) {
        G.child.patience -= dt * rush;
        if (G.child.state === 'carried') { G.child.x = G.chef.x; G.child.y = G.chef.y - 44; }
        if (G.child.patience <= 0) loseChild();
      }

      // land meters — rides never close now. A land with an active circle goal is
      // "something's wrong" and slips; an idle land is running fine and recovers.
      // The goal's OWN countdown (ttl) is the timer — let it lapse and it's a miss.
      for (const l of G.lands) {
        if (l.incident) {
          l.incident.ttl -= dt * rush;
          l.happy = clamp(l.happy - S.baseDecay * dt, 0, S.landMax);
          if (l.incident.ttl <= 0) goalMissed(l);
        } else {
          l.happy = clamp(l.happy + S.recoverRate * dt, 0, S.landMax);
        }
      }
      G.openLandSec += dt; G.totalLandSec += dt;   // nothing closes ⇒ uptime is 100%
      G.peakStars = Math.max(G.peakStars, stars());

      // finale fireworks
      if (G.phase.id === 'finale' && Math.random() < dt * 6) {
        const fx = 120 + Math.random() * 760, fy = 120 + Math.random() * 180;
        burst(fx, fy, ['#fbbf24', '#f472b6', '#60a5fa', '#34d399'][(Math.random() * 4) | 0], 14);
        audio.firework();
      }

      // particles / floats
      for (const f of G.floats) { f.life -= dt * 1.1; f.y -= dt * 24; }
      G.floats = G.floats.filter((f) => f.life > 0);
      for (const s of G.sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 120 * dt; }
      G.sparks = G.sparks.filter((s) => s.life > 0);

      resolveHint();
      if (G.t >= S.roundSeconds) endRun('complete');
    }

    function endRun(outcome) {
      if (G.state !== 'playing') return;
      audio.stopMusic();
      G.state = 'over';
      const uptime = G.totalLandSec > 0 ? Math.round((G.openLandSec / G.totalLandSec) * 100) : 100;
      api.meta.plays = (api.meta.plays || 0) + 1;
      api.meta.bestGuests = Math.max(api.meta.bestGuests || 0, G.guests);
      api.meta.bestStars = Math.max(api.meta.bestStars || 0, +G.peakStars.toFixed(1));
      api.meta.bestCombo = Math.max(api.meta.bestCombo || 0, G.longestCombo);
      api.meta.bestUptime = Math.max(api.meta.bestUptime || 0, uptime);
      saveMeta();
      const result = {
        stageId: 'park', outcome, dollarsSaved: 0,
        // Tokens already landed in the wallet in real time via awardTokens() as
        // G.score crossed each $dollarsPerToken step — this just reports the
        // lifetime total for this run, it does not pay out again.
        tokensEarned: G.tokensEarned,
        guests: G.guests, stars: +G.peakStars.toFixed(1), combo: G.longestCombo,
        uptime, score: G.score,
      };
      G.result = result;
      onEvent('run:end', result);
      try { onComplete(result); } catch (e) { console.error(e); }
    }

    // ==========================================================================
    // Draw
    // ==========================================================================
    function draw() {
      const dpr = view.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, view.cw, view.ch);
      if (mapReady) {
        // ambient backdrop: a darkened cover-scaled copy of the map fills the
        // letterbox bands with the art's own colours instead of flat black
        const s = Math.max(view.cw / mapImg.width, view.ch / mapImg.height);
        const dw = mapImg.width * s, dh = mapImg.height * s;
        ctx.drawImage(mapImg, (view.cw - dw) / 2, (view.ch - dh) / 2, dw, dh);
        ctx.fillStyle = 'rgba(6,4,12,0.74)'; ctx.fillRect(0, 0, view.cw, view.ch);
        if (G.state === 'playing') { ctx.fillStyle = G.phase.tint; ctx.globalAlpha = 0.22;
          ctx.fillRect(0, 0, view.cw, view.ch); ctx.globalAlpha = 1; }
      } else {
        const bg = ctx.createLinearGradient(0, 0, 0, view.ch);
        const tint = (G.state === 'playing' ? G.phase.tint : '#12203a');
        bg.addColorStop(0, tint); bg.addColorStop(1, '#080510');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, view.cw, view.ch);
      }

      ctx.save();
      ctx.translate(view.offX, view.offY); ctx.scale(view.scale, view.scale);
      drawPark();
      ctx.restore();

      drawHUD();
      if (touchMode && G.state === 'playing') drawTouch();
      if (G.state === 'menu') {
        if (introEl) { introEl.style.display = 'flex'; if (!introShown) { syncIntro(); introShown = true; } }
      } else if (introEl && introShown) { introEl.style.display = 'none'; introShown = false; }
      if (G.state === 'over') drawOver();
    }

    function drawPark() {
      if (mapReady) { drawImageMap(); return drawImageOverlays(); }
      // ---- vector fallback (used until the basemap image loads) ----
      // ground
      ctx.fillStyle = '#14102a'; rrect(ctx, 6, 100, F.w - 12, F.h - 108, 24); ctx.fill();
      drawGroundDetail();
      // walkways from the ring out to each land
      drawPaths();
      // lands
      for (const l of G.lands) drawLand(l);
      // scenery in the plaza gaps (behind the track/castle)
      drawScenery();
      // ring track (speed lane)
      drawTrack();
      // castle
      drawCastle();
      // ticket gate + its queue
      drawGate();
      // churro
      if (G.churro) { ctx.font = '30px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(C.CHURRO.emoji, G.churro.x, G.churro.y); }
      // incidents
      for (const l of G.lands) if (l.incident && l.downT <= 0) drawIncident(l);
      // lost child (waiting on the ground; carried one is drawn with the chef)
      if (G.child && G.child.state === 'waiting') drawChild();
      // while carrying, mark the destination land so it's obvious where to go
      if (G.chef.carryChild) drawChildTarget(G.lands[G.chef.carryChild.target]);
      // chef
      drawChef();
      // sparks + floats
      for (const s of G.sparks) { ctx.globalAlpha = clamp(s.life, 0, 1); ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of G.floats) { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.color;
        ctx.font = (f.big ? '800 26px' : '700 18px') + ' system-ui,sans-serif'; ctx.fillText(f.text, f.x, f.y); }
      ctx.globalAlpha = 1;
    }

    // ---- painted-basemap mode ----------------------------------------------
    function drawImageMap() {
      // fill the logical field with the painting (its 1024×768 ≈ our 1000×720)
      ctx.drawImage(mapImg, 0, 0, F.w, F.h);
    }
    function drawSparksFloats() {
      for (const s of G.sparks) { ctx.globalAlpha = clamp(s.life, 0, 1); ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of G.floats) { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.color;
        ctx.font = (f.big ? '800 26px' : '700 18px') + ' system-ui,sans-serif'; ctx.fillText(f.text, f.x, f.y); }
      ctx.globalAlpha = 1;
    }
    // Only the live/interactive layer draws over the painting.
    function drawImageOverlays() {
      drawSpeedLane();
      drawGate();
      if (G.churro) { ctx.font = '30px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(C.CHURRO.emoji, G.churro.x, G.churro.y); }
      // (land happiness bars removed — rides never close, so the ★ rating in the
      // HUD is the only health readout the player needs.)
      for (const l of G.lands) if (l.incident && l.downT <= 0) drawIncident(l);
      if (G.child && G.child.state === 'waiting') drawChild();
      if (G.chef.carryChild) drawChildTarget(G.lands[G.chef.carryChild.target]);
      drawChef();
      drawSparksFloats();
    }
    // Compact meter for a land, drawn on the painting (no name — the art has it).
    function drawLandMeter(l) {
      const r = l.def.rect, down = l.downT > 0;
      const cx = r.x + r.w / 2, my = r.y + r.h - 14, bw = Math.min(150, r.w - 24);
      ctx.save();
      ctx.fillStyle = 'rgba(8,5,16,0.62)'; rrect(ctx, cx - bw / 2 - 5, my - 15, bw + 10, 26, 9); ctx.fill();
      ctx.restore();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '15px system-ui'; ctx.fillText(l.def.emoji, cx - bw / 2, my - 2);
      const mx = cx - bw / 2 + 24, mw = bw - 24, f = clamp(l.happy / S.landMax, 0, 1);
      ctx.fillStyle = '#120c22'; rrect(ctx, mx, my - 7, mw, 10, 5); ctx.fill();
      ctx.fillStyle = down ? '#6b7280' : f > 0.5 ? '#34d399' : f > 0.25 ? '#fbbf24' : '#f87171';
      if (f > 0) { rrect(ctx, mx, my - 7, mw * f, 10, 5); ctx.fill(); }
      if (down) { ctx.textAlign = 'center'; ctx.fillStyle = '#f87171'; ctx.font = '700 11px system-ui,sans-serif';
        ctx.fillText('CLOSED · ' + Math.ceil(l.downT) + 's', cx, my - 24); }
    }

    // subtle plaza texture + a few sky twinkles up top
    function drawGroundDetail() {
      ctx.save();
      // faint tile grid on the plaza
      ctx.globalAlpha = 0.05; ctx.strokeStyle = '#8a6fc0'; ctx.lineWidth = 1;
      for (let x = 40; x < F.w - 20; x += 60) { ctx.beginPath(); ctx.moveTo(x, 104); ctx.lineTo(x, F.h - 14); ctx.stroke(); }
      ctx.restore();
    }

    // warm walkways from each corner station out toward its land
    function drawPaths() {
      ctx.save();
      ctx.strokeStyle = 'rgba(180,150,90,0.16)'; ctx.lineWidth = 26; ctx.lineCap = 'round';
      for (const l of G.lands) {
        const st = C.trackXY(C.stationS(l.def.corner)); const a = l.def.attract;
        ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      }
      // a path from the entrance up into the ring
      ctx.beginPath(); ctx.moveTo(F.w / 2, F.h - 24); ctx.lineTo(F.w / 2, C.TRACK.y + C.TRACK.h); ctx.stroke();
      ctx.restore();
    }

    // decorations in the empty plaza gaps — non-interactive flavour
    function drawScenery() {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // ferris wheel up top, between the two upper lands
      ctx.font = '46px system-ui'; ctx.globalAlpha = 0.95; ctx.fillText('🎡', F.w / 2, 168); ctx.globalAlpha = 1;
      // trees tucked at the plaza corners
      ctx.font = '24px system-ui';
      for (const [x, y] of [[352, 360], [648, 360], [352, 468], [648, 468]]) ctx.fillText('🌲', x, y);
      // entrance arch at the bottom
      ctx.fillStyle = '#2a1c44'; rrect(ctx, F.w / 2 - 74, F.h - 40, 148, 30, 10); ctx.fill();
      ctx.strokeStyle = '#6b53a0'; ctx.lineWidth = 2; rrect(ctx, F.w / 2 - 74, F.h - 40, 148, 30, 10); ctx.stroke();
      ctx.fillStyle = '#e6d4ff'; ctx.font = '700 13px system-ui,sans-serif'; ctx.fillText('🎪 MAIN GATE', F.w / 2, F.h - 25);
    }

    // a faint themed motif drawn inside a land's body
    function landMotif(l) {
      const r = l.def.rect, mx = r.x + r.w / 2, my = r.y + r.h / 2 + 6;
      ctx.save(); ctx.globalAlpha = 0.14; ctx.strokeStyle = l.def.color; ctx.lineWidth = 6; ctx.lineCap = 'round';
      if (l.def.id === 'token') {            // coaster hills
        ctx.beginPath(); ctx.moveTo(mx - 78, my + 26);
        ctx.quadraticCurveTo(mx - 40, my - 40, mx - 6, my + 20);
        ctx.quadraticCurveTo(mx + 30, my - 30, mx + 78, my + 24); ctx.stroke();
      } else if (l.def.id === 'cache') {     // mountain
        ctx.beginPath(); ctx.moveTo(mx - 70, my + 30); ctx.lineTo(mx - 10, my - 40);
        ctx.lineTo(mx + 20, my + 4); ctx.lineTo(mx + 44, my - 24); ctx.lineTo(mx + 78, my + 30); ctx.stroke();
      } else if (l.def.id === 'frontier') {  // cactus
        ctx.beginPath(); ctx.moveTo(mx, my + 34); ctx.lineTo(mx, my - 34);
        ctx.moveTo(mx, my - 6); ctx.lineTo(mx - 26, my - 6); ctx.moveTo(mx - 26, my - 6); ctx.lineTo(mx - 26, my - 26);
        ctx.moveTo(mx, my - 18); ctx.lineTo(mx + 24, my - 18); ctx.moveTo(mx + 24, my - 18); ctx.lineTo(mx + 24, my - 40); ctx.stroke();
      } else {                                // water waves
        for (let i = -1; i <= 1; i++) { ctx.beginPath();
          ctx.moveTo(mx - 74, my + i * 22);
          ctx.quadraticCurveTo(mx - 37, my + i * 22 - 12, mx, my + i * 22);
          ctx.quadraticCurveTo(mx + 37, my + i * 22 + 12, mx + 74, my + i * 22); ctx.stroke(); }
      }
      ctx.restore();
    }

    function drawLand(l) {
      const r = l.def.rect, down = l.downT > 0;
      ctx.save();
      ctx.globalAlpha = down ? 0.4 : 1;
      ctx.fillStyle = down ? '#1a1226' : '#221a3c';
      rrect(ctx, r.x, r.y, r.w, r.h, 18); ctx.fill();
      ctx.strokeStyle = down ? '#3a2440' : l.def.color; ctx.lineWidth = 2.5;
      rrect(ctx, r.x, r.y, r.w, r.h, 18); ctx.stroke();
      ctx.restore();
      if (!down) landMotif(l);
      // land label
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = '26px system-ui'; ctx.fillText(l.def.emoji, r.x + 14, r.y + 12);
      ctx.font = '700 15px system-ui,sans-serif'; ctx.fillStyle = down ? '#7a6294' : '#e0d0f0';
      ctx.fillText(l.def.name, r.x + 48, r.y + 18);
      // happiness meter
      const mx = r.x + 14, my = r.y + r.h - 22, mw = r.w - 28;
      ctx.fillStyle = '#120c22'; rrect(ctx, mx, my, mw, 12, 6); ctx.fill();
      const f = clamp(l.happy / S.landMax, 0, 1);
      ctx.fillStyle = down ? '#4b5563' : f > 0.5 ? '#34d399' : f > 0.25 ? '#fbbf24' : '#f87171';
      if (f > 0) { rrect(ctx, mx, my, mw * f, 12, 6); ctx.fill(); }
      if (down) { ctx.textAlign = 'center'; ctx.fillStyle = '#f87171'; ctx.font = '700 13px system-ui,sans-serif';
        ctx.fillText('CLOSED · reopening ' + Math.ceil(l.downT) + 's', r.x + r.w / 2, my - 12); }
    }

    function drawTrack() {
      const t = C.TRACK;
      // roadbed
      ctx.strokeStyle = '#3a2f52'; ctx.lineWidth = 12;
      rrect(ctx, t.x, t.y, t.w, t.h, 40); ctx.stroke();
      // railroad ties, spaced along the loop (tangent found by sampling)
      ctx.strokeStyle = '#5b4a78'; ctx.lineWidth = 3;
      for (let s = 0; s < PERIM; s += 22) {
        const p = C.trackXY(s), q = C.trackXY(s + 2);
        const dx = q.x - p.x, dy = q.y - p.y, m = Math.hypot(dx, dy) || 1;
        const nx = -dy / m, ny = dx / m; // perpendicular
        ctx.beginPath(); ctx.moveTo(p.x - nx * 7, p.y - ny * 7); ctx.lineTo(p.x + nx * 7, p.y + ny * 7); ctx.stroke();
      }
      // rails
      ctx.strokeStyle = '#7a6699'; ctx.lineWidth = 2;
      rrect(ctx, t.x, t.y, t.w, t.h, 40); ctx.stroke();
      // festive string lights, twinkling
      for (let s = 10; s < PERIM; s += 40) {
        const p = C.trackXY(s), tw = 0.55 + 0.45 * Math.sin(now() / 300 + s);
        ctx.globalAlpha = tw; ctx.fillStyle = ['#fbbf24', '#f472b6', '#60a5fa'][((s / 40) | 0) % 3];
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // corner station platforms, one by each land
      for (const l of G.lands) {
        const st = C.trackXY(C.stationS(l.def.corner));
        ctx.fillStyle = '#4a3a28'; rrect(ctx, st.x - 16, st.y - 10, 32, 20, 5); ctx.fill();
        ctx.fillStyle = '#caa87a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🚉', st.x, st.y);
      }
    }

    function drawCastle() {
      const c = C.CASTLE, mid = c.x + c.w / 2;
      // side + centre towers behind the keep
      const tower = (tx, tw, top, roof) => {
        ctx.fillStyle = '#332658'; rrect(ctx, tx - tw / 2, top, tw, c.y + c.h - top, 6); ctx.fill();
        ctx.strokeStyle = '#5b4a8c'; ctx.lineWidth = 2; rrect(ctx, tx - tw / 2, top, tw, c.y + c.h - top, 6); ctx.stroke();
        // conical roof + flag
        ctx.fillStyle = roof; ctx.beginPath();
        ctx.moveTo(tx - tw / 2 - 3, top); ctx.lineTo(tx, top - 26); ctx.lineTo(tx + tw / 2 + 3, top); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, top - 26); ctx.lineTo(tx, top - 42); ctx.stroke();
        const wav = Math.sin(now() / 260) * 3;
        ctx.fillStyle = '#f472b6'; ctx.beginPath();
        ctx.moveTo(tx, top - 42); ctx.lineTo(tx + 16 + wav, top - 38); ctx.lineTo(tx, top - 33); ctx.closePath(); ctx.fill();
      };
      tower(c.x + 26, 36, c.y + 8, '#7c3aed');
      tower(c.x + c.w - 26, 36, c.y + 8, '#7c3aed');
      // keep
      ctx.fillStyle = '#2b2150'; rrect(ctx, c.x + 40, c.y + 26, c.w - 80, c.h - 26, 8); ctx.fill();
      ctx.strokeStyle = '#5b4a8c'; ctx.lineWidth = 3; rrect(ctx, c.x + 40, c.y + 26, c.w - 80, c.h - 26, 8); ctx.stroke();
      // battlements along the keep top
      ctx.fillStyle = '#332658';
      for (let bx = c.x + 46; bx < c.x + c.w - 52; bx += 22) { rrect(ctx, bx, c.y + 18, 12, 12, 2); ctx.fill(); }
      // centre spire
      tower(mid, 30, c.y - 6, '#a855f7');
      // gate
      ctx.fillStyle = '#160f2c'; rrect(ctx, mid - 22, c.y + c.h - 44, 44, 44, 10); ctx.fill();
      ctx.strokeStyle = '#6b53a0'; ctx.lineWidth = 2; rrect(ctx, mid - 22, c.y + c.h - 44, 44, 44, 10); ctx.stroke();
      // label
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 13px system-ui,sans-serif'; ctx.fillStyle = '#c9b8ec';
      ctx.fillText('Castle CostBot', mid, c.y + c.h - 58);
    }

    // The ring rail is a SPEED LANE — a glowing dashed loop that lights up while
    // CostBot is riding it, with chevrons drifting clockwise to sell the "fast" read.
    function drawSpeedLane() {
      const t = C.TRACK, on = G.chef.onTrack;
      ctx.save();
      ctx.globalAlpha = on ? 0.85 : 0.32;
      ctx.strokeStyle = on ? '#7fe8ff' : '#cbb3f0'; ctx.lineWidth = on ? 5 : 3;
      if (on) { ctx.shadowColor = '#7fe8ff'; ctx.shadowBlur = 16; }
      ctx.setLineDash([10, 12]); ctx.lineDashOffset = -(now() / 40) % 22;
      rrect(ctx, t.x, t.y, t.w, t.h, 70); ctx.stroke();
      ctx.restore();
    }

    function drawIncident(l) {
      const a = l.def.attract, inc = l.incident;
      const pulse = 1 + Math.sin(now() / 120) * 0.12;
      const fixing = G.chef.prep && G.chef.prep.land === l;
      const hot = G.hint && G.hint.kind === 'fix' && G.hint.land === l;
      const R = 34;
      const frac = clamp((inc.ttl != null ? inc.ttl : inc.ttlMax) / (inc.ttlMax || 1), 0, 1);
      const tcol = frac > 0.5 ? '#34d399' : frac > 0.25 ? '#fbbf24' : '#f87171';
      const low = frac <= 0.25;
      const flash = low ? 0.55 + 0.45 * Math.sin(now() / 90) : 1;
      // a big glowing disc so goals pop off the busy painted park
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.shadowColor = l.def.color; ctx.shadowBlur = hot ? 32 : 22;
      ctx.fillStyle = 'rgba(20,12,40,0.92)';
      ctx.beginPath(); ctx.arc(a.x, a.y, R * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = hot ? 26 : 12;
      ctx.strokeStyle = hot ? '#fde047' : l.def.color; ctx.lineWidth = hot ? 5 : 3.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, R * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // countdown ring — depletes clockwise; turns amber then red and pulses low
      ctx.save();
      ctx.strokeStyle = tcol; ctx.lineWidth = 5; ctx.lineCap = 'round';
      if (low) { ctx.shadowColor = tcol; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.arc(a.x, a.y, R + 9, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '30px system-ui'; ctx.fillText(inc.type.icon, a.x, a.y - 2);
      ctx.font = '20px system-ui'; ctx.fillText('❗', a.x + 30, a.y - 28);
      ctx.font = '800 13px system-ui,sans-serif'; ctx.fillStyle = '#f6ecff';
      ctx.fillText(inc.type.label, a.x, a.y + 52);
      // prep ring while resolving a hold incident (sits just outside the timer)
      if (fixing) { const p = clamp(G.chef.prep.t / G.chef.prep.dur, 0, 1);
        ctx.beginPath(); ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 6;
        ctx.arc(a.x, a.y, R + 16, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke(); }
    }

    function drawGate() {
      const g = C.GATE, jam = G.gate.jamT > 0, hot = G.hint && G.hint.kind === 'scan';
      // booth
      ctx.save();
      if (hot) { ctx.shadowColor = '#7fd8c4'; ctx.shadowBlur = 20; }
      ctx.fillStyle = jam ? '#3a2130' : '#243a48'; rrect(ctx, g.x - 30, g.y - 26, 60, 52, 10); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = jam ? '#f87171' : hot ? '#7fd8c4' : '#3f6b7a'; ctx.lineWidth = hot ? 3 : 2;
      rrect(ctx, g.x - 30, g.y - 26, 60, 52, 10); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '24px system-ui'; ctx.fillText('🎟️', g.x, g.y - 6);
      ctx.font = '700 10px system-ui,sans-serif'; ctx.fillStyle = jam ? '#f87171' : '#9fd8cc';
      ctx.fillText(jam ? 'JAMMED ' + Math.ceil(G.gate.jamT) + 's' : 'TICKETS', g.x, g.y + 16);
      // the line of guests waiting to get in — drawn as little people
      const dir = g.dir || 1;
      for (let i = 0; i < G.gate.line.length; i++) {
        const guest = G.gate.line[i];
        const gx = g.x + dir * (38 + i * g.gap);
        const shirt = guest.shirt || GUEST_SHIRTS[i % GUEST_SHIRTS.length];
        const skin = guest.skin || GUEST_SKINS[i % GUEST_SKINS.length];
        const hair = guest.hair || GUEST_HAIR[i % GUEST_HAIR.length];
        const y = g.y + Math.sin(now() / 320 + i * 1.3) * 1.6; // gentle idle bob
        ctx.fillStyle = '#2f2436';                              // legs
        rrect(ctx, gx - 5, y + 7, 3.6, 7, 1.6); ctx.fill(); rrect(ctx, gx + 1.4, y + 7, 3.6, 7, 1.6); ctx.fill();
        ctx.fillStyle = shirt;                                  // body / shirt
        rrect(ctx, gx - 7, y - 3, 14, 13, 5); ctx.fill();
        ctx.fillStyle = skin;                                   // head
        ctx.beginPath(); ctx.arc(gx, y - 9, 5.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hair;                                   // hair (top half)
        ctx.beginPath(); ctx.arc(gx, y - 9, 5.9, Math.PI, 2 * Math.PI); ctx.fill();
      }
      // front-of-line countdown — only the first guest is on the clock. Same
      // color-and-pulse language as the circle goals' countdown ring (green →
      // amber → red, glowing and flashing when low), just kept as a bar.
      if (G.gate.line.length > 0) {
        const fx = g.x + dir * 38, f = clamp(G.gate.frontT / C.GATE.patience, 0, 1);
        const bcol = f > 0.5 ? '#34d399' : f > 0.25 ? '#fbbf24' : '#f87171';
        const lowT = f <= 0.25, flashT = lowT ? 0.55 + 0.45 * Math.sin(now() / 90) : 1;
        ctx.fillStyle = 'rgba(8,5,16,0.7)'; rrect(ctx, fx - 16, g.y - 30, 32, 6, 3); ctx.fill();
        if (f > 0) {
          ctx.save();
          ctx.globalAlpha = flashT;
          if (lowT) { ctx.shadowColor = bcol; ctx.shadowBlur = 14; }
          ctx.fillStyle = bcol; rrect(ctx, fx - 16, g.y - 30, 32 * f, 6, 3); ctx.fill();
          ctx.restore();
        }
        if (f <= 0.35) { ctx.fillStyle = '#f87171'; ctx.font = '800 13px system-ui,sans-serif';
          ctx.textAlign = 'center'; ctx.fillText('!', fx, g.y - 40); }
      }
      ctx.textAlign = 'center';
      if (G.gate.line.length >= C.GATE.cap) { ctx.fillStyle = '#f87171'; ctx.font = '700 11px system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.fillText('LINE FULL!', g.x + dir * (36 + C.GATE.cap * g.gap), g.y - 22); }
      // gate happiness meter ABOVE the booth (it sits at the bottom edge)
      const mw = 62, mx = g.x - mw / 2, my = g.y - 44, f = clamp(G.gate.happy / S.landMax, 0, 1);
      ctx.fillStyle = 'rgba(8,5,16,0.6)'; rrect(ctx, mx - 4, my - 4, mw + 8, 15, 5); ctx.fill();
      ctx.fillStyle = '#120c22'; rrect(ctx, mx, my, mw, 7, 3); ctx.fill();
      ctx.fillStyle = jam ? '#4b5563' : f > 0.5 ? '#34d399' : f > 0.25 ? '#fbbf24' : '#f87171';
      if (f > 0) { rrect(ctx, mx, my, mw * f, 7, 3); ctx.fill(); }
    }

    function drawChild() {
      const c = G.child, land = G.lands[c.target];
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // the child + a "lost" pulse ring
      const pulse = 1 + Math.sin(now() / 160) * 0.1;
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, 22 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '26px system-ui'; ctx.fillText(C.CHILD.emoji, c.x, c.y);
      ctx.font = '16px system-ui'; ctx.fillText('❓', c.x + 20, c.y - 20);
      // where they need to go
      ctx.font = '700 11px system-ui,sans-serif'; ctx.fillStyle = '#fde68a';
      ctx.fillText('take to ' + land.def.emoji + ' ' + land.def.name, c.x, c.y + 34);
      // patience bar
      const f = clamp(c.patience / c.max, 0, 1);
      ctx.fillStyle = '#3a2450'; rrect(ctx, c.x - 26, c.y + 42, 52, 6, 3); ctx.fill();
      ctx.fillStyle = f > 0.5 ? '#34d399' : f > 0.25 ? '#fbbf24' : '#f87171';
      if (f > 0) { rrect(ctx, c.x - 26, c.y + 42, 52 * f, 6, 3); ctx.fill(); }
    }

    // a bouncing pin + child icon over the land the carried child needs to reach
    function drawChildTarget(land) {
      if (!land) return;
      const a = land.def.attract, bob = Math.sin(now() / 220) * 5;
      // halo ring on the attraction
      const pulse = 1 + Math.sin(now() / 200) * 0.12;
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(a.x, a.y, 40 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      // pin floating above it
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '30px system-ui'; ctx.fillText('📍', a.x, a.y - 52 + bob);
      ctx.font = '18px system-ui'; ctx.fillText(C.CHILD.emoji, a.x, a.y - 52 + bob);
      // "drop here" tag
      ctx.font = '800 12px system-ui,sans-serif'; ctx.fillStyle = '#fde047';
      ctx.fillText('DROP HERE', a.x, a.y - 78 + bob);
    }

    function drawChef() {
      const c = G.chef;
      // drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(c.x, c.y + 22, 21, 7, 0, 0, Math.PI * 2); ctx.fill();
      // PLAYER RING — a pulsing glow so you never lose CostBot among the painted mascots
      const rp = 1 + Math.sin(now() / 260) * 0.08;
      ctx.save();
      ctx.shadowColor = '#38e1ff'; ctx.shadowBlur = 14;
      ctx.strokeStyle = c.onTrack ? '#7fe8ff' : '#38e1ff'; ctx.lineWidth = 3.5; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(c.x, c.y + 14, 20 * rp, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // speed streaks while riding the track lane
      if (c.onTrack) {
        ctx.strokeStyle = 'rgba(127,232,255,0.7)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { const o = ((now() / 40 + i * 9) % 26) - 4;
          ctx.beginPath(); ctx.moveTo(c.x - 26 + o, c.y - 8 + i * 8); ctx.lineTo(c.x - 12 + o, c.y - 8 + i * 8); ctx.stroke(); }
      }
      if (c.boost > 0) { ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(c.x, c.y, C.CHEF.r + 10, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      if (chefReady) { const s = 56; ctx.drawImage(chefImg, c.x - s / 2, c.y - s / 2 - 4, s, s); }
      else { ctx.fillStyle = '#7cc4ff'; ctx.beginPath(); ctx.arc(c.x, c.y, C.CHEF.r, 0, Math.PI * 2); ctx.fill(); }
      // carried lost child, with an arrow pointing at their destination
      if (c.carryChild) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '22px system-ui'; ctx.fillText(C.CHILD.emoji, c.x, c.y - 40);
        const land = G.lands[c.carryChild.target], a = land.def.attract;
        const ang = Math.atan2(a.y - c.y, a.x - c.x);
        ctx.save(); ctx.translate(c.x, c.y - 58); ctx.rotate(ang);
        ctx.fillStyle = land.def.color; ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(0, -5); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.font = '700 11px system-ui,sans-serif'; ctx.fillStyle = '#fde68a';
        ctx.fillText('→ ' + land.def.name, c.x, c.y - 72);
      }
      // action prompt
      if (G.hint && !c.prep) {
        const label = G.hint.kind === 'scan' ? 'SCAN 🎟️' : G.hint.kind === 'child_pickup' ? 'LIFT 🧒'
          : G.hint.kind === 'child_drop' ? 'DROP OFF'
          : (G.hint.land && G.hint.land.incident ? G.hint.land.incident.type.verb : 'FIX');
        const bob = Math.sin(now() / 200) * 2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 14px system-ui,sans-serif';
        const w = ctx.measureText(label).width + 24;
        ctx.fillStyle = 'rgba(8,5,16,0.85)'; rrect(ctx, c.x - w / 2, c.y + 26 + bob, w, 22, 11); ctx.fill();
        ctx.fillStyle = '#fde68a'; ctx.fillText(label, c.x, c.y + 37 + bob);
      }
    }

    // ---- HUD ----------------------------------------------------------------
    function drawHUD() {
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(10,7,18,0.92)'; ctx.fillRect(0, 0, view.cw, HUD_H);
      ctx.fillStyle = '#2a1c3a'; ctx.fillRect(0, HUD_H - 2, view.cw, 2);
      const pad = 14;
      const left = Math.max(0, S.roundSeconds - G.t);
      ctx.textAlign = 'left'; ctx.font = '800 21px system-ui,sans-serif';
      ctx.fillStyle = left < 12 && G.state === 'playing' ? '#f87171' : '#fef3c7';
      ctx.fillText('⏱ ' + Math.ceil(left) + 's', pad, HUD_H / 2);
      // stars (park rating) center
      const sv = G.state === 'playing' ? stars() : 0;
      ctx.textAlign = 'center'; ctx.font = '20px system-ui';
      let starStr = '';
      for (let i = 0; i < 5; i++) starStr += i < Math.round(sv) ? '★' : '☆';
      ctx.fillStyle = '#fbbf24'; ctx.fillText(starStr, view.cw / 2, HUD_H / 2 - 8);
      const phaseTxt = G.state === 'playing' ? (G.rush ? '⚡ FINAL RUSH' : G.phase.name) : '';
      ctx.fillStyle = G.rush ? '#fbbf24' : '#cbb3e0'; ctx.font = '700 13px system-ui,sans-serif';
      ctx.fillText('🎟 ' + G.guests + ' guests   ·   ' + phaseTxt, view.cw / 2, HUD_H / 2 + 12);
      // park cash (right) — always shown; red when you're in the red. Nudged left
      // while playing to leave room for the fixed #quit button (DOM overlay) that
      // sits in this same corner during a run.
      ctx.textAlign = 'right';
      const combo = G.combo > 1;
      const padR = pad + (G.state === 'playing' ? 44 : 0);
      ctx.fillStyle = G.score < 0 ? '#f87171' : '#6ee7a0'; ctx.font = '800 17px system-ui,sans-serif';
      ctx.fillText('💰 ' + money(G.score), view.cw - padR, HUD_H / 2 + (combo ? -8 : 0));
      if (combo) { const mult = Math.min(S.comboMax, 1 + (G.combo - 1) * S.comboStep);
        ctx.fillStyle = '#fbbf24'; ctx.font = '800 12px system-ui,sans-serif';
        ctx.fillText('COMBO x' + mult.toFixed(1), view.cw - padR, HUD_H / 2 + 11); }
    }
    function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString(); }

    function drawTouch() {
      if (stick.active) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.arc(stick.bx, stick.by, stick.max, 0, Math.PI * 2); ctx.fill();
        const dx = clamp(stick.kx - stick.bx, -stick.max, stick.max), dy = clamp(stick.ky - stick.by, -stick.max, stick.max);
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(stick.bx + dx, stick.by + dy, 26, 0, Math.PI * 2); ctx.fill();
      } else { ctx.globalAlpha = 0.5; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#8a6fa8'; ctx.font = '600 13px system-ui,sans-serif'; ctx.fillText('◐ drag to move', view.cw * 0.25, view.ch - 34); ctx.globalAlpha = 1; }
      ctx.globalAlpha = 0.6; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(253,230,138,0.18)'; ctx.beginPath(); ctx.arc(view.cw - 64, view.ch - 74, 44, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fde68a'; ctx.font = '700 14px system-ui,sans-serif'; ctx.fillText('TAP', view.cw - 64, view.ch - 74); ctx.globalAlpha = 1;
    }

    function panel(cx, cy, w, h) {
      ctx.fillStyle = 'rgba(8,5,16,0.86)'; ctx.fillRect(0, 0, view.cw, view.ch);
      ctx.fillStyle = '#180f24'; rrect(ctx, cx - w / 2, cy - h / 2, w, h, 22); ctx.fill();
      ctx.strokeStyle = '#4a3a72'; ctx.lineWidth = 2; rrect(ctx, cx - w / 2, cy - h / 2, w, h, 22); ctx.stroke();
    }
    function drawMenu() {
      const cx = view.cw / 2, cy = view.ch / 2, w = Math.min(440, view.cw - 40), h = 360;
      panel(cx, cy, w, h);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde68a'; ctx.font = '800 34px system-ui,sans-serif'; ctx.fillText('🎢 CostBotLand', cx, cy - 128);
      ctx.fillStyle = '#cbb3e0'; ctx.font = '500 15px system-ui,sans-serif'; ctx.fillText('Keep the park happy. Nothing stays broken.', cx, cy - 94);
      ctx.fillStyle = '#9a7fb8'; ctx.font = '400 13px system-ui,sans-serif';
      ctx.fillText('Clear each ❗ before the land empties. Scan 🎟️ the gate line.', cx, cy - 66);
      ctx.fillText('Carry a lost 🧒 to the marked ride. Can’t cross the castle.', cx, cy - 48);
      ctx.fillText('Hop on the ⚡ track for a speed boost around the ring.', cx, cy - 30);
      ctx.fillText('Grab a 🌯 for a boost. Survive to the 🎆 finale.', cx, cy - 12);
      ctx.fillStyle = '#7a6294'; ctx.font = '400 12px system-ui,sans-serif';
      ctx.fillText('Move: WASD / arrows · Act: Space   (or drag + tap)', cx, cy + 12);
      ctx.fillStyle = '#e9d5ff'; ctx.font = '600 13px system-ui,sans-serif';
      ctx.fillText('Best: 🎟 ' + (api.meta.bestGuests || 0) + '   ★ ' + (api.meta.bestStars || 0) + '   uptime ' + (api.meta.bestUptime || 0) + '%', cx, cy + 44);
      ctx.fillStyle = '#7c3aed'; rrect(ctx, cx - 92, cy + 70, 184, 52, 26); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui,sans-serif'; ctx.fillText('▶ OPEN PARK', cx, cy + 97);
    }
    function drawOver() {
      const r = G.result || {};
      const cx = view.cw / 2, cy = view.ch / 2, w = Math.min(440, view.cw - 40), h = 400;
      panel(cx, cy, w, h);
      ctx.textAlign = 'center';
      ctx.fillStyle = r.outcome === 'closed' ? '#f87171' : '#fde68a'; ctx.font = '800 28px system-ui,sans-serif';
      ctx.fillText(r.outcome === 'closed' ? '🚧 Park Shut Down' : '🎆 Day Complete!', cx, cy - 146);
      // star rating big
      ctx.font = '34px system-ui'; ctx.fillStyle = '#fbbf24';
      let ss = ''; for (let i = 0; i < 5; i++) ss += i < Math.round(r.stars || 0) ? '★' : '☆';
      ctx.fillText(ss, cx, cy - 98);
      const rows = [
        ['🎟 Guests kept happy', (r.guests || 0)],
        ['★ Peak rating', (r.stars || 0) + ' / 5'],
        ['🔥 Best combo', 'x' + (r.combo || 0)],
        ['💰 Park cash', money(r.score || 0)],
        ['🪙 Tokens earned', (r.tokensEarned || 0)],
      ];
      ctx.font = '600 15px system-ui,sans-serif'; let ry = cy - 48;
      for (const [k, v] of rows) {
        ctx.textAlign = 'left'; ctx.fillStyle = '#b79ccb'; ctx.fillText(k, cx - w / 2 + 40, ry);
        ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(String(v), cx + w / 2 - 40, ry);
        ry += 28;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7c3aed'; rrect(ctx, cx - 100, cy + 138, 200, 50, 25); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 18px system-ui,sans-serif'; ctx.fillText('▶ OPEN AGAIN', cx, cy + 164);
    }

    // ---- DOM intro screen ---------------------------------------------------
    // The canvas draws the park; the intro is a DOM overlay (banner + how-to),
    // matching the other cabinets. Shown only in the 'menu' state.
    let introEl = null, introShown = false;
    function buildIntro() {
      if (!document.getElementById('cl-intro-style')) {
        const st = document.createElement('style'); st.id = 'cl-intro-style';
        st.textContent = `
        .cl-intro{position:absolute;inset:0;z-index:4;display:none;flex-direction:column;
          align-items:center;overflow:auto;padding:22px 16px 40px;box-sizing:border-box;
          font-family:'Segoe UI',system-ui,sans-serif;color:#ece3f7;-webkit-overflow-scrolling:touch;}
        .cl-intro .cl-veil{position:fixed;inset:0;z-index:-1;
          background:radial-gradient(circle at 50% -10%,rgba(60,30,90,.6),rgba(8,5,16,.92));}
        .cl-panel{width:min(760px,100%);display:flex;flex-direction:column;gap:16px;}
        .cl-hero{border-radius:16px;overflow:hidden;border:1px solid #4a3a72;box-shadow:0 14px 44px rgba(0,0,0,.55);}
        .cl-hero img{width:100%;display:block;}
        .cl-head{text-align:center;}
        .cl-head h1{margin:0;font-size:30px;font-weight:800;color:#fde68a;letter-spacing:.4px;}
        .cl-head p{margin:5px 0 0;color:#c3a9dc;font-size:14px;}
        .cl-lbl{font-size:11px;font-weight:800;letter-spacing:1.6px;color:#a888c8;margin-bottom:8px;}
        .cl-how{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        @media(max-width:560px){.cl-how{grid-template-columns:1fr;}}
        .cl-card{padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid #2f2447;}
        .cl-card .k{font-weight:800;font-size:12px;color:#f3ecff;margin-bottom:2px;}
        .cl-card .d{font-size:11px;color:#c3a9dc;line-height:1.4;}
        .cl-best{text-align:center;color:#e9d5ff;font-size:13px;font-weight:600;}
        .cl-play{align-self:center;margin-top:2px;padding:14px 52px;border:none;border-radius:26px;
          background:#7c3aed;color:#fff;font-weight:800;font-size:19px;cursor:pointer;
          box-shadow:0 8px 24px rgba(124,58,237,.4);transition:transform .1s;}
        .cl-play:hover{transform:translateY(-2px);}
        .cl-board{align-self:center;text-decoration:none;color:#c3a9dc;font-weight:700;font-size:13px;
          padding:8px 18px;border-radius:9px;border:1px solid #4a3a72;background:rgba(255,255,255,.04);
          transition:border-color .12s,color .12s;}
        .cl-board:hover{border-color:#8a5aa0;color:#fff;}
        .cl-foot{text-align:center;color:#7a6294;font-size:11px;}`;
        document.head.appendChild(st);
      }
      introEl = document.createElement('div');
      introEl.className = 'cl-intro';
      introEl.innerHTML = `
        <div class="cl-veil"></div>
        <div class="cl-panel">
          <div class="cl-hero"><img src="../shared/assets/costbotland.jpg" alt="CostBotLand"></div>
          <div class="cl-head">
            <h1>🎢 CostBotLand</h1>
            <p>Keep the park humming. Clear every incident before its timer runs out.</p>
          </div>
          <div>
            <div class="cl-lbl">HOW TO PLAY</div>
            <div class="cl-how">
              <div class="cl-card"><div class="k">🕹️ Move &amp; act</div><div class="d">WASD / arrows to move, Space (or tap) to act. Esc quits, M mutes.</div></div>
              <div class="cl-card"><div class="k">⭕ Circle goals</div><div class="d">Incidents pop as glowing circles with a countdown ring. Reach one and act before the ring empties.</div></div>
              <div class="cl-card"><div class="k">⏳ Beat the timer</div><div class="d">Miss a goal's timer and it vanishes — and the park loses cash. Rides never close, so just keep clearing.</div></div>
              <div class="cl-card"><div class="k">🎟️ Ticket line</div><div class="d">Scan the guest at the front of the line to admit them and earn cash. The line shuffles up.</div></div>
              <div class="cl-card"><div class="k">🧒 Lost child</div><div class="d">Lift a lost child and carry them to the marked ride before their patience runs out. Hands full = can't fix.</div></div>
              <div class="cl-card"><div class="k">⚡ Speed lane &amp; 🌯</div><div class="d">Ride the glowing ring track to move faster; grab a churro for a boost. Can't cross the castle.</div></div>
            </div>
          </div>
          <div class="cl-best" id="cl-best"></div>
          <button class="cl-play" id="cl-play">▶  OPEN PARK</button>
          <a class="cl-board" href="../leaderboard/index.html#costbotland">🏆 Leaderboard</a>
          <div class="cl-foot">Survive the day to the 🎆 fireworks finale · high scores post to the arcade leaderboard</div>
        </div>`;
      host.appendChild(introEl);
      introEl.querySelector('#cl-play').onclick = () => startRun();
    }
    function syncIntro() {
      if (!introEl) return;
      const m = api.meta;
      introEl.querySelector('#cl-best').textContent =
        'Best: 🎟 ' + (m.bestGuests || 0) + '   ★ ' + (m.bestStars || 0) + '   best combo x' + (m.bestCombo || 0);
    }

    // ---- loop ---------------------------------------------------------------
    let raf = null, alive = true;
    function frame() {
      if (!alive) return;
      const t = now(); let dt = (t - G.last) / 1000; G.last = t;
      if (dt > 0.1) dt = 0.1;
      update(dt); draw();
      raf = global.requestAnimationFrame(frame);
    }
    G.last = now(); raf = global.requestAnimationFrame(frame);
    onEvent('ready', {});

    const api = {
      meta: loadMeta(),
      start: startRun,
      get state() { return G.state; },
      get muted() { return audio.isMuted(); },
      toggleMute,
      quit: quitToMenu,
      _debug: G,
      act: primaryAction,
      destroy() {
        alive = false;
        if (raf) global.cancelAnimationFrame(raf);
        audio.stopMusic();
        global.removeEventListener('keydown', onKeyDown);
        global.removeEventListener('keyup', onKeyUp);
        if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
        host.innerHTML = '';
      },
    };
    audio.setMuted(!!api.meta.muted);   // honour a persisted mute before first sound
    buildIntro();
    return api;
  }

  global.CostBotLand = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
