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
  const SONGS = [
    { key: 'ch_avengers', name: 'The Savengers',   sub: 'Avengers, rocked · 148', tag: 'NEW' },
    { key: 'ch_imperial', name: 'Imperial Markup', sub: 'Villain march · 104',    tag: '' },
  ];

  const DIFFS = {
    // fall   = seconds a note takes to reach the line (bigger = slower/easier).
    // minGap = minimum spacing in 16th steps between kept notes. Every kept note
    //          is a REAL melody onset, so the chart always tracks the tune; a
    //          bigger gap just thins dense runs (easier) without moving notes.
    easy:   { label: 'Easy',   lanes: 3, fall: 2.15, minGap: 4, holdGap: 99, traps: false, missCost: 5,  color: '#39d98a' },
    medium: { label: 'Medium', lanes: 4, fall: 1.90, minGap: 3, holdGap: 8,  traps: false, missCost: 7,  color: '#f5c451' },
    hard:   { label: 'Hard',   lanes: 5, fall: 1.28, minGap: 1, holdGap: 4,  traps: true,  missCost: 10, color: '#ff5d6c' },
  };

  // Lanes are vendors — colour + name read left-to-right across the highway.
  const PALETTE = ['#ff9900', '#4285f4', '#00b7ff', '#ff3621', '#29b5e8'];
  const VENDORS = ['AWS', 'GCP', 'Azure', 'Databricks', 'Snowflake'];
  // savings-lever icons shown on the note faces (rightsize, delete idle, schedule
  // off, commit/RI, cold storage, cleanup, consolidate, cut)
  const SAVINGS = ['📉', '🗑️', '⏸️', '🔒', '❄️', '🧹', '📦', '🔻'];
  const KEYS = { 3: ['s', 'd', 'f'], 4: ['a', 's', 'd', 'f'], 5: ['a', 's', 'd', 'f', 'g'] };

  // FinOps-flavoured judgment names.
  const JUDGE = { perfect: 'OPTIMIZED!', great: 'RIGHTSIZED', ok: 'TRIMMED', miss: 'OVERRUN', trap: "PROD — DON'T CUT" };
  const COMBO_CALLS = { 10: 'ON THE BOOKS', 25: 'QUARTERLY SAVINGS!', 50: 'FISCAL LEGEND!' };

  const BILL_MAX = 100;
  const TARGET_SECS = 105;    // aimed note span; capped so a whole run stays under ~2 min
  const MAX_NOTE_SECS = 110;  // hard cap on chart length regardless of loop rounding
  const PREROLL = 2.6;        // seconds of countdown before the first note

  const STORE_KEY = 'costbot.hero.v1';

  // ---- small helpers -------------------------------------------------------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const fmtK = (n) => n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n);

  // CostBot mascot, drawn as the DJ/host reacting to the run.
  const hostImg = new Image(); let hostReady = false;
  hostImg.onload = () => { hostReady = true; };
  hostImg.src = '../shared/assets/costbot.png';

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
    function drawStars() {
      const t = performance.now() / 1000;
      // a couple of faint nebulae for depth
      const neb = (nx, ny, nr, col) => {
        const gg = ctx2d.createRadialGradient(nx, ny, 0, nx, ny, nr);
        gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx2d.fillStyle = gg; ctx2d.fillRect(0, 0, W, H);
      };
      neb(W * 0.5, H * 0.16, Math.max(W, H) * 0.4, 'rgba(96,70,190,0.12)');
      neb(W * 0.82, H * 0.72, Math.max(W, H) * 0.34, 'rgba(40,120,180,0.08)');
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

    // ---- persistent meta ----
    const store = loadStore();
    const meta = Object.assign({ records: {}, plays: 0, lastSong: 0, lastDiff: 'medium', calibMs: 0 },
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
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
      sfxBus = actx.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
      if (global.ArcadeMusic) music = global.ArcadeMusic.create(() => ({ ctx: actx, master }));
    }
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
      gold:    () => { blip(1046, 0.12, 'triangle', 0.5, 1568); blip(1568, 0.12, 'sine', 0.3, 2093); },
      combo:   () => { blip(784, 0.08, 'triangle', 0.4, 1046); },
      ui:      () => blip(520, 0.05, 'square', 0.25),
    };

    // ---- game state ----
    let state = 'menu';         // menu | count | play | result
    let songIdx = clamp(meta.lastSong | 0, 0, SONGS.length - 1);
    let diffKey = DIFFS[meta.lastDiff] ? meta.lastDiff : 'medium';
    let run = null;             // active run object
    const keysDown = new Set(); // lane keys currently held
    const pointers = new Map(); // pointerId -> laneIndex

    // ---- chart build ------------------------------------------------------
    // `lat` shifts every note by the audio output latency so a tile reaches the
    // line exactly when you HEAR its note, not when it was scheduled.
    function buildChart(track, diff, firstStep0, startStepAbs, lat) {
      const LL = (track.bars || 4) * 16;
      const lead = track.lead || [];
      const stepDur = 60 / track.bpm / 4;
      const loopSecs = LL * stepDur;
      const loops = Math.max(2, Math.ceil(TARGET_SECS / loopSecs));
      const total = Math.min(loops * LL, Math.floor(MAX_NOTE_SECS / stepDur));
      // Stop spawning notes ~4s before the end and cut on a bar boundary, so the
      // song winds down with a clean, note-free outro instead of tiles right up to
      // the last second (which read as mismatched with the music).
      const tailSteps = Math.max(16, Math.round(4 / stepDur));
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
      for (let i = 0; i < kept.length; i++) {
        const k = kept[i];
        let lo = Infinity, hi = -Infinity;
        for (let j = Math.max(0, i - W); j <= Math.min(kept.length - 1, i + W); j++) {
          const p = kept[j].midi; if (p < lo) lo = p; if (p > hi) hi = p;
        }
        let lane = hi > lo ? Math.round((k.midi - lo) / (hi - lo) * (diff.lanes - 1)) : (diff.lanes >> 1);
        lane = clamp(lane, 0, diff.lanes - 1);
        if (lane === prevLane && diff.lanes > 1) {
          lane = lane >= diff.lanes - 1 ? lane - 1 : lane + 1;   // spread consecutive repeats
        }
        prevLane = lane;
        const gold = (k.midi === globalHi);
        const gap = gapAt(k.src);
        const holdEnd = gap >= diff.holdGap ? k.time + Math.min(gap, 10) * stepDur : 0;
        let spend = 250 + (Math.abs(k.midi * 7 + lane * 53) % 40) * 75;
        if (gold) spend *= 4;
        const icon = gold ? '💰' : SAVINGS[Math.abs(k.midi + lane) % SAVINGS.length];
        notes.push({
          time: k.time, lane, midi: k.midi, spend, icon,
          type: gold ? 'gold' : (holdEnd ? 'hold' : 'tap'),
          holdEnd, judged: false, held: false, holdScored: false,
        });
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
      // end a few seconds after the last note lands, so the finish is a clean,
      // note-free wind-down rather than tiles right up to the results screen
      const outroEnd = firstStep0 + (startStepAbs + noteCut) * stepDur + lat + 3.0;
      return { notes, stepDur, endTime: outroEnd };
    }

    // ---- start a song -----------------------------------------------------
    function startSong() {
      initAudio();
      const song = SONGS[songIdx];
      const track = global.ArcadeMusic && global.ArcadeMusic.TRACKS[song.key];
      if (!track) return;
      meta.lastSong = songIdx; meta.lastDiff = diffKey; persist();

      const diff = DIFFS[diffKey];
      const stepDur = 60 / track.bpm / 4;
      const LL = (track.bars || 4) * 16;

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

        // shift visuals + judging to when audio is actually heard (output latency),
        // plus the player's own calibration offset (menu-adjustable)
        const lat = (actx.outputLatency || actx.baseLatency || 0.02) + (meta.calibMs || 0) / 1000;

        const chart = buildChart(track, diff, firstStep0, startStepAbs, lat);
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
          pops: [], parts: [], shake: 0, tint: 0, hostBob: 0,
          failed: false,
        };
        state = 'count';
        emit('run:start', { song: song.key, diff: diffKey });
      });
    }

    function endSong() {
      if (!run || state === 'result') return;
      if (music) music.stop();
      const r = run;
      const c = r.counts;
      const acc = r.total ? (c.perfect + c.great * 0.7 + c.ok * 0.4) / r.total : 0;
      let grade = r.failed ? 'F'
        : acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.70 ? 'B' : acc >= 0.50 ? 'C' : 'D';
      const tokens = Math.max(0, Math.floor(r.score / 500));
      if (global.ArcadeWallet && tokens) global.ArcadeWallet.earn(tokens, 'costbot-hero');

      // record best (by score) per song+difficulty
      const rec = meta.records[r.song.key] || (meta.records[r.song.key] = {});
      const prev = rec[diffKey];
      const better = !prev || r.score > prev.score;
      if (better) rec[diffKey] = { score: r.score, grade, combo: r.maxCombo, acc: Math.round(acc * 100) };
      meta.plays++; persist();

      run.result = { grade, acc: Math.round(acc * 100), tokens, best: better };
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
      if (!run) return;
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
      if (!best) return;

      if (best.type === 'trap') {
        best.judged = true; run.counts.trap++; run.combo = 0; run.mult = 1;
        run.bill = clamp(run.bill + 14, 0, BILL_MAX);
        pop(run, lane, JUDGE.trap, '#ff5d6c'); shake(run, 10); SFX.trap();
        checkFail(); return;
      }

      const j = bestDt <= 0.045 ? 'perfect' : bestDt <= 0.09 ? 'great' : 'ok';
      const base = j === 'perfect' ? 1500 : j === 'great' ? 900 : 400;
      const goldX = best.type === 'gold' ? 3 : 1;
      run.combo++; run.maxCombo = Math.max(run.maxCombo, run.combo);
      const newMult = multFor(run.combo);
      if (newMult > run.mult) { run.mult = newMult; SFX.combo(); }
      run.mult = newMult;
      if (COMBO_CALLS[run.combo]) { run.callout = { text: COMBO_CALLS[run.combo], life: 1.4 }; shake(run, 6); }
      const gain = base * run.mult * goldX;
      run.score += gain;
      run.counts[j]++;
      run.bill = clamp(run.bill - (j === 'perfect' ? 2 : j === 'great' ? 1 : 0), 0, BILL_MAX);
      run.tint = Math.min(1, run.tint + 0.12);

      const label = best.type === 'gold' ? '💰 SAVINGS PLAN' : JUDGE[j];
      pop(run, lane, label + '  +' + fmt$(gain), best.type === 'gold' ? '#ffd76a' : LANE_COLOR(run, lane));
      burst(run, lane, best.type === 'gold' ? 22 : j === 'perfect' ? 14 : 8);
      if (best.type === 'gold') SFX.gold(); else SFX[j]();
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
        return;
      }
      if (state === 'result') {
        if (!down) return;
        if (k === 'enter' || k === ' ') { startSong(); }
        else if (k === 'escape' || k === 'backspace') { state = 'menu'; run = null; }
        return;
      }
      if (state === 'play' || state === 'count') {
        if (k === 'escape') { if (music) music.stop(); state = 'menu'; run = null; emit('run:end', {}); return; }
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
              run.bill = clamp(run.bill + run.diff.missCost, 0, BILL_MAX);
              run.tint = Math.max(0, run.tint - 0.2);
              pop(run, n.lane, JUDGE.miss, '#7d8aa8'); SFX.miss(); checkFail();
            }
          }
        }
        // hold completion
        for (const n of run.chart.notes) {
          if (n.type === 'hold' && n.judged && !n.holdScored && now >= n.holdEnd) {
            n.holdScored = true;
            if (n.held) { const g = 2000 * run.mult; run.score += g; pop(run, n.lane, 'HOLD +' + fmt$(g), '#8fe' ); burst(run, n.lane, 10); SFX.great(); }
          }
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
      for (const p of run.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 640 * dt; p.life -= dt * 1.3; }
      run.parts = run.parts.filter(p => p.life > 0);
    }

    function draw() {
      ctx2d.clearRect(0, 0, W, H);
      // background
      const bg = ctx2d.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0f22'); bg.addColorStop(1, '#05060f');
      ctx2d.fillStyle = bg; ctx2d.fillRect(0, 0, W, H);
      drawStars();

      if (state === 'menu') { drawMenu(); drawOverlay(); return; }
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
        // vendor label above the target
        ctx2d.fillStyle = hexA(PALETTE[i], 0.95); ctx2d.font = '800 11px Segoe UI, system-ui, sans-serif';
        ctx2d.fillText(VENDORS[i].toUpperCase(), cx, hy - 30);
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
          const col = gold ? '#ffd76a' : PALETTE[n.lane];
          const tlen = 82 * s;                       // comet trail toward the horizon
          const tg = ctx2d.createLinearGradient(0, y - tlen, 0, y);
          tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, hexA(col, 0.30));
          ctx2d.fillStyle = tg; ctx2d.fillRect(cx - rW * 0.24, y - tlen, rW * 0.48, tlen);
          ctx2d.shadowColor = col; ctx2d.shadowBlur = (gold ? 18 : 9) * s;
          ctx2d.fillStyle = col; rrect(cx - rW / 2, y - rH / 2, rW, rH, 6); ctx2d.fill();
          ctx2d.shadowBlur = 0;
          ctx2d.fillStyle = 'rgba(255,255,255,.85)'; rrect(cx - rW / 2, y - rH / 2, rW, 4 * s + 1, 2); ctx2d.fill();
          ctx2d.textAlign = 'center';
          if (s > 0.72) {
            // near: savings-type icon + the spend to cut
            ctx2d.font = Math.round(15 * s) + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx2d.fillText(n.icon, cx - rW * 0.22, y + 5 * s);
            ctx2d.fillStyle = gold ? '#5a4300' : 'rgba(6,12,22,.9)';
            ctx2d.font = '800 ' + Math.round(12 * s) + 'px Segoe UI, system-ui, sans-serif';
            ctx2d.fillText(fmtK(n.spend), cx + rW * 0.14, y + 4 * s);
          } else if (s > 0.45) {
            // farther: just the icon
            ctx2d.font = Math.round(16 * s) + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx2d.fillText(n.icon, cx, y + 5 * s);
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
      ctx2d.shadowBlur = 12 + run.tint * 22 + hot * 28;
      ctx2d.globalAlpha = 0.55 + Math.min(0.45, run.tint + 0.15);
      ctx2d.drawImage(hostImg, cx - size / 2, cy - size / 2, size, size);
      ctx2d.restore();
      ctx2d.textAlign = 'center'; ctx2d.font = '800 12px Segoe UI, system-ui, sans-serif';
      ctx2d.fillStyle = hot > 0.75 ? '#ff5d6c' : '#8194b6';
      const say = hot > 0.75 ? 'BUDGET!!' : run.combo >= 50 ? 'LEGENDARY' : run.combo >= 25 ? "LET'S GO!"
        : run.combo >= 10 ? 'nice cuts' : 'cut the spend!';
      ctx2d.fillText(say, cx, cy + size / 2 + 18);
    }

    // ---- hud ----
    function drawHud() {
      if (!run) return;
      // song progress line across the very top (fills left->right as the song plays)
      const prog = clamp((actx.currentTime - run.beginTime) / Math.max(0.001, run.chart.endTime - run.beginTime), 0, 1);
      ctx2d.fillStyle = 'rgba(255,255,255,.07)'; ctx2d.fillRect(0, 0, W, 4);
      const pgrad = ctx2d.createLinearGradient(0, 0, W, 0);
      pgrad.addColorStop(0, '#7fd6c4'); pgrad.addColorStop(1, '#ffd76a');
      ctx2d.fillStyle = pgrad; ctx2d.fillRect(0, 0, W * prog, 4);

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

      // score, top-right
      ctx2d.textAlign = 'right';
      ctx2d.fillStyle = '#ffd76a'; ctx2d.font = '800 30px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(fmt$(run.score), W - 18, 34);
      ctx2d.fillStyle = '#8ea3cc'; ctx2d.font = '600 12px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText('SAVED', W - 18, 50);

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
      ctx2d.fillStyle = 'rgba(5,6,15,.82)'; ctx2d.fillRect(0, 0, W, H);
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = run.failed ? '#ff5d6c' : '#ffd76a';
      ctx2d.font = '800 20px Segoe UI'; ctx2d.fillText(run.failed ? 'BUDGET BLOWN' : 'SONG CLEAR', cx, 96);
      // grade
      const gc = r.grade === 'S' ? '#ffd76a' : r.grade === 'F' ? '#ff5d6c' : '#39d98a';
      ctx2d.fillStyle = gc; ctx2d.font = '800 120px Segoe UI, system-ui, sans-serif';
      ctx2d.fillText(r.grade, cx, 220);
      // stats
      ctx2d.font = '700 22px Segoe UI'; ctx2d.fillStyle = '#fff';
      ctx2d.fillText(fmt$(run.score) + ' saved', cx, 268);
      ctx2d.font = '600 15px Segoe UI'; ctx2d.fillStyle = '#c4d0e8';
      ctx2d.fillText('Accuracy ' + r.acc + '%   ·   Max combo ' + run.maxCombo +
        '   ·   +' + r.tokens + ' 🪙', cx, 296);
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

    requestAnimationFrame(frame);
    emit('ready', {});

    return {
      get meta() { return meta; },
      destroy() { if (music) music.stop(); cv.remove(); },
    };
  }

  global.CostBotHero = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
