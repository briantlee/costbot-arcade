/* ==========================================================================
 * Board Meeting — a Jeopardy-style game show for the CostBot Arcade.
 *
 * Pick a tile off the board and race the clock: answer fast for the full payout,
 * because it decays as the timer runs and vanishes if it hits zero. "The
 * Commitment" tiles are Daily Doubles — WAGER before you see the clue, and a miss
 * comes out of your own bank (the Reserved-Instance bet in miniature). Correct
 * streaks overclock the payout. It closes on Final Forecast: pick a category,
 * wager your bank, one clue, one timer.
 *
 * DOM-rendered (trivia is text and buttons, not a canvas), but wired the same way
 * every cabinet is: ArcadeMusic for the soundtrack, ArcadeWallet for tokens,
 * ArcadeSync for the leaderboard. Mount with BoardMeeting.mount('#el', opts).
 * Content lives in bm-content.js (BoardMeetingContent).
 * ======================================================================== */
(function (global) {
  'use strict';

  const STORE_KEY = 'costbot.boardmeeting.v1';
  const VALUES = [400, 800, 1200, 1600];    // row tiers, easy → hard (4×4 board)
  const CLUE_SECS = 10;                      // per-clue clock
  const FINAL_SECS = 15;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
  function saveStore(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch {} }

  // Overclock: consecutive correct answers multiply the payout.
  const OVERCLOCK = [1, 1, 1.25, 1.5, 1.75, 2];
  const overclockOf = (streak) => OVERCLOCK[Math.min(streak, OVERCLOCK.length - 1)];

  // Host lines, by moment.
  const SAY = {
    correct: ['Optimized.', 'Booked it.', 'Under budget.', 'Clean cut.', 'That’ll ship.'],
    wrong: ['Ouch — over budget.', 'That’s waste.', 'Write it off.', 'Not this time.'],
    timeout: ['Time — the clue’s gone.', 'The clock wins that one.', 'Out of time.'],
  };
  const pick1 = (a) => a[(Math.random() * a.length) | 0];

  function mount(sel, opts) {
    opts = opts || {};
    const host = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const emit = (t, p) => { try { opts.onEvent && opts.onEvent(t, p); } catch {} };

    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'bm-root';
    host.appendChild(root);
    injectStyle();

    const store = loadStore();
    // `totalEarned` is the cumulative sum of every round's banked score — the
    // number the leaderboard ranks on. It only ever grows.
    const meta = Object.assign({ best: 0, plays: 0, wins: 0, totalEarned: 0, muted: false }, opts.meta || store.meta || {});
    function persist() { if (opts.persist === false) return; store.meta = meta; saveStore(store); }

    // Sound toggle lives on the host (not inside root), so screen re-renders that
    // rewrite root.innerHTML never wipe it. Escape quits the current game.
    const soundBtn = document.createElement('button');
    soundBtn.className = 'bm-sound'; soundBtn.type = 'button';
    host.appendChild(soundBtn);
    function paintSound() { soundBtn.textContent = meta.muted ? '🔇' : '🔊'; soundBtn.title = (meta.muted ? 'Sound off' : 'Sound on') + ' (M)'; }
    function applyMute() { if (master) master.gain.value = meta.muted ? 0 : 0.9; }
    function toggleMuted() { meta.muted = !meta.muted; persist(); if (!meta.muted && !actx) initAudio(); applyMute(); paintSound(); }
    soundBtn.onclick = toggleMuted;
    paintSound();

    function quitToMenu() {
      stopMusic(); cancelAnimationFrame(raf);
      if (run) run.clue = null;
      state = 'menu'; emit('run:end', {}); render();
    }
    function onKeyGlobal(e) {
      if (e.key === 'Escape' && state !== 'menu') { e.preventDefault(); SFX.ui(); quitToMenu(); }
      else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) { toggleMuted(); }
    }
    global.addEventListener('keydown', onKeyGlobal);

    // ---- audio (own context for sfx; ArcadeMusic for the soundtrack) --------
    let actx = null, master = null, sfxBus = null, musicBus = null;
    function initAudio() {
      if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain(); master.gain.value = meta.muted ? 0 : 0.9; master.connect(actx.destination);
      sfxBus = actx.createGain(); sfxBus.gain.value = 0.5; sfxBus.connect(master);
      musicBus = actx.createGain(); musicBus.gain.value = 0.42; musicBus.connect(master);
    }
    function blip(freq, dur, type, gain, slideTo) {
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.35, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
    }
    const SFX = {
      ui: () => blip(520, 0.05, 'square', 0.22),
      // Selecting a clue off the board — a rising two-note "board select".
      select: () => { blip(440, 0.07, 'square', 0.3, 587); setTimeout(() => blip(659, 0.09, 'triangle', 0.28, 880), 65); },
      // Clue reveal — a soft chime that says "here's your question".
      reveal: () => { blip(523, 0.10, 'triangle', 0.32, 784); setTimeout(() => blip(1046, 0.12, 'sine', 0.22), 80); },
      // Correct — the classic bright game-show "ding ding ding".
      correct: () => { [880, 1174, 1568].forEach((f, i) => setTimeout(() => blip(f, 0.11, 'triangle', 0.42, f * 1.2), i * 70)); },
      // Wrong — the flat "eehhh" buzzer.
      wrong: () => { blip(196, 0.32, 'sawtooth', 0.42, 120); setTimeout(() => blip(155, 0.30, 'square', 0.3, 100), 20); },
      tick: () => blip(1200, 0.03, 'square', 0.16),
      overclock: () => { blip(784, 0.08, 'triangle', 0.35, 1046); setTimeout(() => blip(1046, 0.08, 'sine', 0.3, 1568), 70); },
      ship: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'triangle', 0.35), i * 90)); },
      final: () => { blip(330, 0.5, 'sawtooth', 0.25, 660); },
    };

    // ---- original game-show "think" cue --------------------------------------
    // NOT the copyrighted Jeopardy theme. A jaunty I–vi–IV–V bed with a music-box
    // hook and a soft clock tick — the countdown feel, composed fresh. 32 eighth
    // steps (4 bars); loops. Faster tempo in Final for tension.
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const _bassSeq = [36, 40, 43, 40,  45, 48, 52, 48,  41, 45, 48, 45,  43, 47, 50, 47];
    const GS_BASS = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? _bassSeq[i / 2] : null));
    const GS_LEAD = [
      72, null, 76, null, 79, null, 76, null,   // C: C5 E5 G5 E5
      72, null, 74, null, 76, null, null, null, // Am: C5 D5 E5
      77, null, 76, null, 72, null, null, null, // F: F5 E5 C5
      74, null, 71, null, 67, null, null, null, // G: D5 B4 G4
    ];
    // A quiet off-beat arpeggio (the swung "&" of each beat) — the bounce that
    // gives quiz-show music its forward motion. Chord tones over I–vi–IV–V.
    const GS_LEAD2 = [
      null, 64, null, 67, null, 72, null, 67,   // C
      null, 69, null, 72, null, 76, null, 72,   // Am
      null, 65, null, 69, null, 72, null, 69,   // F
      null, 67, null, 71, null, 74, null, 71,   // G
    ];
    let musicOn = false, musicTimer = null, musicStep = 0, musicNext = 0, musicBPM = 116;
    function mnote(midi, t, dur, type, gain) {
      if (!actx) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(midiHz(midi), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.02);
    }
    function mtick(t) {
      if (!actx) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(2100, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.05);
    }
    // Music-box / celesta pluck: fundamental + octave + twelfth, fast decay.
    // That bright plinky tone is what reads as "quiz show" to the ear.
    function mbell(midi, t, gain) {
      if (!actx) return;
      const f = midiHz(midi);
      const parts = [[f, gain, 0.55, 'triangle'], [f * 2, gain * 0.42, 0.34, 'sine'], [f * 3, gain * 0.13, 0.18, 'sine']];
      for (const [freq, g, dur, type] of parts) {
        const o = actx.createOscillator(), gn = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(g, t + 0.006);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn); gn.connect(musicBus); o.start(t); o.stop(t + dur + 0.02);
      }
    }
    function musicScheduler() {
      if (!musicOn || !actx) return;
      const eighth = 60 / musicBPM / 2;
      while (musicNext < actx.currentTime + 0.13) {
        const s = musicStep % 32;
        // Swing: the off-beat "&" lands late — the loose bounce of the genre.
        const swing = (s % 2 === 1) ? eighth * 0.22 : 0;
        const at = musicNext + swing;
        // "Boom-chick": a short, punchy root on the beat, then a light octave pop
        // on the "&" — that alternation is what makes it spring rather than plod.
        if (GS_BASS[s] != null) mnote(GS_BASS[s], at, eighth * 0.7, 'triangle', 0.17);
        else if (s % 2 === 1 && GS_BASS[s - 1] != null) mnote(GS_BASS[s - 1] + 12, at, eighth * 0.42, 'triangle', 0.07);
        if (GS_LEAD[s] != null) mbell(GS_LEAD[s], at, 0.12);
        if (GS_LEAD2[s] != null) mbell(GS_LEAD2[s], at, 0.07);   // off-beat arpeggio, up front
        if (s % 2 === 0) mtick(musicNext);          // clock tick stays dead on the beat
        musicNext += eighth; musicStep++;
      }
    }
    function playTrack(bpm) {
      if (!actx) return;
      musicBPM = bpm || 116; musicOn = true; musicStep = 0; musicNext = actx.currentTime + 0.06;
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = setInterval(musicScheduler, 25);
      musicScheduler();
    }
    function stopMusic() { musicOn = false; if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

    // ---- run state ----------------------------------------------------------
    let state = 'menu';           // menu | board | clue | final | result
    let run = null;
    let raf = 0, lastT = 0;

    const C = global.BoardMeetingContent;

    function newRun() {
      const cats = shuffle(C.CATEGORIES.slice()).slice(0, 4);
      const tiles = [];
      cats.forEach((cat, col) => VALUES.forEach((val, row) => {
        // Each tier holds several clues; draw one at random so a tile is a
        // different question next game.
        const pool = cat.tiers[row];
        const clue = Array.isArray(pool) ? pick1(pool) : pool;
        tiles.push({ col, row, cat, value: val, clue, done: false, commitment: false });
      }));
      // Two Commitment tiles on a 4×4 board, on the pricier rows (never the freebie).
      const bigTiles = shuffle(tiles.filter((t) => t.row >= 1));
      bigTiles.slice(0, 2).forEach((t) => { t.commitment = true; });
      run = {
        cats, tiles,
        score: 0, streak: 0, maxStreak: 0,
        remaining: tiles.length,
        clue: null,          // active clue view
      };
    }

    // ======================================================================
    // screens
    // ======================================================================
    function render() {
      if (state === 'menu') return renderMenu();
      if (state === 'board') return renderBoard();
      if (state === 'clue') return renderClue();
      if (state === 'final') return renderFinal();
      if (state === 'result') return renderResult();
    }

    function scoreBar() {
      const oc = overclockOf(run.streak);
      return `
        <div class="bm-scorebar">
          <div class="bm-you"><span class="bm-lbl">BANKED</span><b>${fmt$(run.score)}</b></div>
          <div class="bm-oc ${oc > 1 ? 'hot' : ''}">
            <span>OVERCLOCK</span>
            <div class="bm-ocbar"><i style="width:${((oc - 1) / 1) * 100}%"></i></div>
            <b>×${oc}</b>
          </div>
        </div>`;
    }

    function renderMenu() {
      stopMusic();
      root.innerHTML = `
        <div class="bm-screen bm-menu">
          <img class="bm-mascot" src="../shared/assets/costbot.png" alt="">
          <h1>Board&nbsp;Meeting</h1>
          <p class="bm-tag">CostBot's cloud-cost game show. You versus the clock.</p>
          <ul class="bm-rules">
            <li>💸 Answer fast — the payout <b>decays</b> as the clock runs.</li>
            <li>⏱️ Run the clock out and the clue is <b>gone</b> — no bank.</li>
            <li>🔒 A <b>Commitment</b> tile makes you wager first — nail it or <b>lose the wager</b>.</li>
            <li>🔥 Correct streaks <b>overclock</b> your payout up to ×2.</li>
            <li>🏁 It ends on <b>Final Forecast</b> — one clue, your whole bank on the line.</li>
          </ul>
          <button class="bm-btn bm-play">▶ &nbsp;Call the meeting to order</button>
          <div class="bm-best">${meta.best
            ? 'Best round <b>' + fmt$(meta.best) + '</b> &nbsp;·&nbsp; total earned <b>' + fmt$(meta.totalEarned || 0) + '</b>'
            : 'No score yet — go get one.'}</div>
          <div class="bm-best" style="opacity:.65;font-size:12px;">🔊 top-right toggles sound (M) &nbsp;·&nbsp; Esc quits a game</div>
        </div>`;
      root.querySelector('.bm-play').onclick = () => { initAudio(); startGame(); };
    }

    function startGame() {
      newRun();
      state = 'board';
      playTrack(136);
      SFX.reveal();
      emit('run:start', {});
      render();
    }

    function renderBoard() {
      const cols = run.cats.map((c) => `<div class="bm-cat"><span class="bm-icon">${c.icon}</span>${c.name}</div>`).join('');
      let grid = '';
      for (let row = 0; row < VALUES.length; row++) {
        for (let col = 0; col < run.cats.length; col++) {
          const t = run.tiles.find((x) => x.col === col && x.row === row);
          if (t.done) grid += `<div class="bm-tile done">✓</div>`;
          else grid += `<button class="bm-tile" data-col="${col}" data-row="${row}">${t.commitment ? '🔒' : '$' + t.value}</button>`;
        }
      }
      root.innerHTML = `
        <div class="bm-screen bm-board">
          ${scoreBar()}
          <div class="bm-cats">${cols}</div>
          <div class="bm-grid">${grid}</div>
          <div class="bm-hint">Pick a clue. ${run.remaining === run.tiles.length ? 'Higher rows pay more, but the questions bite back.' : run.remaining + ' left before Final Forecast.'}</div>
        </div>`;
      root.querySelectorAll('.bm-tile[data-col]').forEach((el) => {
        el.onclick = () => { SFX.select(); openTile(+el.dataset.col, +el.dataset.row); };
      });
    }

    // ---- opening a tile -----------------------------------------------------
    function openTile(col, row) {
      const t = run.tiles.find((x) => x.col === col && x.row === row);
      if (!t || t.done) return;
      if (t.commitment) return openCommitment(t);
      launchClue(t, t.value);
    }

    // The Commitment: wager a multiple of the tile value before the clue shows.
    function openCommitment(t) {
      state = 'clue';
      SFX.final();
      root.innerHTML = `
        <div class="bm-screen bm-commit">
          <div class="bm-commit-badge">🔒 THE COMMITMENT</div>
          <h2>${t.cat.icon} ${t.cat.name}</h2>
          <p>Wager before you see the clue. Nail it for the payout — miss it and the wager comes out of your bank.</p>
          <div class="bm-wagers">
            <button class="bm-btn bm-wager" data-m="1">×1<small>${fmt$(t.value)}</small></button>
            <button class="bm-btn bm-wager" data-m="2">×2<small>${fmt$(t.value * 2)}</small></button>
            <button class="bm-btn bm-wager hot" data-m="3">×3<small>${fmt$(t.value * 3)}</small></button>
          </div>
          <div class="bm-hint">Bigger commitment, bigger swing. Just like a Reserved Instance.</div>
        </div>`;
      root.querySelectorAll('.bm-wager').forEach((el) => {
        el.onclick = () => { SFX.ui(); launchClue(t, t.value * (+el.dataset.m), +el.dataset.m); };
      });
    }

    // ---- the clue (the heart of it) ----------------------------------------
    function launchClue(t, stake, wagerMult) {
      state = 'clue';
      const choices = t.clue.c.map((text, i) => ({ text, correct: i === t.clue.a }));
      shuffle(choices);
      run.clue = {
        tile: t, stake, wagerMult: wagerMult || 0,
        time: 0, dur: CLUE_SECS,
        phase: 'live',             // live | resolved
        answered: false, choices,
        lastTickSec: 99,
      };
      SFX.reveal();
      renderClue();
      startClock();
    }

    // payout for answering *now*, before overclock — decays 1.0 → 0.5 over the clock
    function livePayout(cl) {
      const f = 1 - 0.5 * (cl.time / cl.dur);
      return Math.max(1, Math.round(cl.stake * f * overclockOf(run.streak)));
    }

    function renderClue() {
      const cl = run.clue, t = cl.tile;
      const pay = livePayout(cl);
      const answers = cl.choices.map((ch, i) =>
        `<button class="bm-ans" data-i="${i}" ${cl.phase === 'resolved' ? 'disabled' : ''}>${ch.text}</button>`).join('');
      root.innerHTML = `
        <div class="bm-screen bm-clue">
          ${scoreBar()}
          <div class="bm-cluehead">
            <span class="bm-clue-cat">${t.cat.icon} ${t.cat.name}</span>
            <span class="bm-payout" id="bm-payout">${cl.wagerMult ? '×' + cl.wagerMult + ' · ' : ''}${fmt$(pay)}</span>
          </div>
          <div class="bm-timer"><i id="bm-timerbar" style="width:100%"></i></div>
          <div class="bm-q">${t.clue.q}</div>
          <div class="bm-answers" id="bm-answers">${answers}</div>
          <div class="bm-feedback" id="bm-feedback"></div>
        </div>`;
      wireAnswers();
    }

    function wireAnswers() {
      root.querySelectorAll('.bm-ans').forEach((el) => {
        el.onclick = () => answer(+el.dataset.i, el);
      });
    }

    function startClock() {
      lastT = performance.now();
      cancelAnimationFrame(raf);
      const step = (now) => {
        const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
        tickClue(dt);
        if (state === 'clue' && run.clue && run.clue.phase !== 'resolved') raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function tickClue(dt) {
      const cl = run.clue;
      if (!cl || cl.phase === 'resolved') return;
      cl.time += dt;

      // live payout + timer bar
      const bar = document.getElementById('bm-timerbar');
      const payEl = document.getElementById('bm-payout');
      const frac = clamp(1 - cl.time / cl.dur, 0, 1);
      if (bar) { bar.style.width = (frac * 100) + '%'; bar.className = frac < 0.3 ? 'danger' : frac < 0.6 ? 'warn' : ''; }
      if (payEl) payEl.textContent = (cl.wagerMult ? '×' + cl.wagerMult + ' · ' : '') + fmt$(livePayout(cl));

      // last-3-seconds tick
      const secLeft = Math.ceil(cl.dur - cl.time);
      if (secLeft <= 3 && secLeft > 0 && secLeft !== cl.lastTickSec) { cl.lastTickSec = secLeft; SFX.tick(); }

      // timeout — the clue is gone
      if (cl.time >= cl.dur) { resolveClue('timeout'); }
    }

    function answer(i, el) {
      const cl = run.clue;
      if (!cl || cl.phase === 'resolved' || cl.answered) return;
      cl.answered = true;
      const correct = cl.choices[i].correct;
      // reveal correct/incorrect on the buttons
      root.querySelectorAll('.bm-ans').forEach((b, idx) => {
        b.disabled = true;
        if (cl.choices[idx].correct) b.classList.add('right');
        else if (idx === i) b.classList.add('wrong');
      });
      resolveClue(correct ? 'correct' : 'wrong', i);
    }

    function resolveClue(kind, chosen) {
      const cl = run.clue;
      if (!cl || cl.phase === 'resolved') return;
      cl.phase = 'resolved';
      cancelAnimationFrame(raf);
      const t = cl.tile;
      const fb = document.getElementById('bm-feedback');
      const pay = livePayout(cl);
      // A Commitment is a Daily Double: miss it and the wager comes out of your
      // own bank. A normal miss just banks nothing — no penalty.
      const penalty = cl.wagerMult ? cl.stake : 0;
      let note = '';

      if (kind === 'correct') {
        run.score += pay;
        run.streak++;
        run.maxStreak = Math.max(run.maxStreak, run.streak);
        const oc = overclockOf(run.streak);
        SFX.correct();
        if (oc > overclockOf(run.streak - 1) && oc > 1) SFX.overclock();
        note = `<span class="ok">✔ ${pick1(SAY.correct)}</span> +${fmt$(pay)}${oc > 1 ? ' · ×' + oc + ' overclock' : ''}`;
      } else {
        run.streak = 0;
        SFX.wrong();
        if (penalty) run.score = Math.max(0, run.score - penalty);
        const lead = kind === 'wrong' ? '✗ ' + pick1(SAY.wrong) : '⏰ ' + pick1(SAY.timeout);
        if (kind !== 'wrong') markAnswerReveal();
        note = `<span class="bad">${lead}</span>${penalty ? ' −' + fmt$(penalty) + ' (commitment)' : ''}`;
      }
      if (fb) fb.innerHTML = `${note}<div class="bm-why">${t.clue.why}</div>`;

      t.done = true;
      run.remaining--;
      // let the reader see the answer, then advance
      setTimeout(() => {
        if (run.remaining <= 0) startFinal();
        else { state = 'board'; render(); }
      }, kind === 'correct' ? 1500 : 2200);
    }

    // reveal which answer was right when the player never locked one in
    function markAnswerReveal() {
      root.querySelectorAll('.bm-ans').forEach((b, idx) => {
        b.disabled = true;
        if (run.clue.choices[idx].correct) b.classList.add('right');
      });
    }

    // ---- Final Forecast -----------------------------------------------------
    function startFinal() {
      state = 'final';
      SFX.final();
      playTrack(172);   // faster tempo tightens the Final Forecast
      const picks = shuffle(C.FINALS.slice()).slice(0, 3);
      run.final = { picks, chosen: null, wager: Math.min(run.score, Math.max(200, Math.round(run.score / 2))), phase: 'pick' };
      renderFinal();
    }

    function renderFinal() {
      const F = run.final;
      if (F.phase === 'pick') {
        root.innerHTML = `
          <div class="bm-screen bm-final">
            ${scoreBar()}
            <div class="bm-final-badge">🏁 FINAL FORECAST</div>
            <p>Pick your category, then wager your bank on one last clue. Nail it to double up, miss it and it's gone.</p>
            <div class="bm-final-cats">
              ${F.picks.map((f, i) => `<button class="bm-btn bm-fcat" data-i="${i}">${f.cat}</button>`).join('')}
            </div>
          </div>`;
        root.querySelectorAll('.bm-fcat').forEach((el) => {
          el.onclick = () => { SFX.ui(); F.chosen = F.picks[+el.dataset.i]; F.phase = 'wager'; renderFinal(); };
        });
      } else if (F.phase === 'wager') {
        const maxW = Math.max(0, run.score);
        root.innerHTML = `
          <div class="bm-screen bm-final">
            ${scoreBar()}
            <div class="bm-final-badge">🏁 ${F.chosen.cat}</div>
            <p>How much of your <b>${fmt$(run.score)}</b> do you commit?</p>
            <div class="bm-wageramt" id="bm-wageramt">${fmt$(F.wager)}</div>
            <input class="bm-slider" type="range" min="0" max="${maxW}" step="${Math.max(1, Math.round(maxW / 40))}" value="${F.wager}">
            <div class="bm-wagerquick">
              <button class="bm-btn ghost" data-w="0">Nothing</button>
              <button class="bm-btn ghost" data-w="${Math.round(maxW / 2)}">Half</button>
              <button class="bm-btn ghost hot" data-w="${maxW}">All in</button>
            </div>
            <button class="bm-btn bm-lockwager">🔒 Lock it in</button>
          </div>`;
        const amt = root.querySelector('#bm-wageramt');
        const sl = root.querySelector('.bm-slider');
        sl.oninput = () => { F.wager = +sl.value; amt.textContent = fmt$(F.wager); };
        root.querySelectorAll('.bm-wagerquick .bm-btn').forEach((el) => {
          el.onclick = () => { F.wager = +el.dataset.w; sl.value = F.wager; amt.textContent = fmt$(F.wager); SFX.ui(); };
        });
        root.querySelector('.bm-lockwager').onclick = () => { SFX.ui(); F.phase = 'clue'; launchFinalClue(); };
      } else {
        renderFinalClue();
      }
    }

    function launchFinalClue() {
      const F = run.final;
      const choices = F.chosen.c.map((text, i) => ({ text, correct: i === F.chosen.a }));
      shuffle(choices);
      F.clue = { time: 0, dur: FINAL_SECS, phase: 'live', answered: false, choices, lastTickSec: 99 };
      SFX.reveal();
      renderFinalClue();
      lastT = performance.now();
      cancelAnimationFrame(raf);
      const step = (now) => {
        const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
        const cl = F.clue;
        if (!cl || cl.phase === 'resolved') return;
        cl.time += dt;
        const bar = document.getElementById('bm-timerbar');
        const frac = clamp(1 - cl.time / cl.dur, 0, 1);
        if (bar) { bar.style.width = (frac * 100) + '%'; bar.className = frac < 0.3 ? 'danger' : frac < 0.6 ? 'warn' : ''; }
        const secLeft = Math.ceil(cl.dur - cl.time);
        if (secLeft <= 3 && secLeft > 0 && secLeft !== cl.lastTickSec) { cl.lastTickSec = secLeft; SFX.tick(); }
        if (cl.time >= cl.dur) { resolveFinal(false, -1); return; }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function renderFinalClue() {
      const F = run.final, cl = F.clue;
      root.innerHTML = `
        <div class="bm-screen bm-clue final">
          ${scoreBar()}
          <div class="bm-cluehead">
            <span class="bm-clue-cat">🏁 ${F.chosen.cat}</span>
            <span class="bm-payout">Wager ${fmt$(F.wager)}</span>
          </div>
          <div class="bm-timer"><i id="bm-timerbar" style="width:100%"></i></div>
          <div class="bm-q">${F.chosen.q}</div>
          <div class="bm-answers">${cl.choices.map((ch, i) => `<button class="bm-ans" data-i="${i}">${ch.text}</button>`).join('')}</div>
          <div class="bm-feedback" id="bm-feedback"></div>
        </div>`;
      root.querySelectorAll('.bm-ans').forEach((el) => {
        el.onclick = () => {
          const cl2 = F.clue;
          if (cl2.answered || cl2.phase === 'resolved') return;
          cl2.answered = true;
          const correct = cl2.choices[+el.dataset.i].correct;
          root.querySelectorAll('.bm-ans').forEach((b, idx) => {
            b.disabled = true;
            if (cl2.choices[idx].correct) b.classList.add('right');
            else if (idx === +el.dataset.i) b.classList.add('wrong');
          });
          resolveFinal(correct, +el.dataset.i);
        };
      });
    }

    function resolveFinal(correct, chosen) {
      const F = run.final, cl = F.clue;
      if (cl.phase === 'resolved') return;
      cl.phase = 'resolved';
      cancelAnimationFrame(raf);
      const fb = document.getElementById('bm-feedback');
      if (correct) { run.score += F.wager; SFX.correct(); }
      else {
        run.score = Math.max(0, run.score - F.wager);
        SFX.wrong();
        root.querySelectorAll('.bm-ans').forEach((b, idx) => { if (cl.choices[idx].correct) b.classList.add('right'); });
      }
      if (fb) fb.innerHTML = `<span class="${correct ? 'ok' : 'bad'}">${correct ? '✔ Forecast confirmed' : '✗ Forecast missed'}</span> ${correct ? '+' : '−'}${fmt$(F.wager)}<div class="bm-why">${F.chosen.why}</div>`;
      setTimeout(finish, 2400);
    }

    // ---- result -------------------------------------------------------------
    function finish() {
      stopMusic();
      const tokens = Math.max(0, Math.floor(run.score / 500));
      if (global.ArcadeWallet && tokens) global.ArcadeWallet.earn(tokens, 'board-meeting');
      meta.plays++;
      meta.totalEarned = (meta.totalEarned || 0) + run.score;
      const best = run.score > (meta.best || 0);
      if (best) { meta.best = run.score; meta.wins++; }   // "wins" now = personal-best games
      persist();
      run.outcome = { tokens, best };
      state = 'result';
      emit('run:end', {});

      const payload = {
        game: 'board-meeting',
        stageId: run.cats.map((c) => c.id).sort().join('+'),
        outcome: 'clear',         // solo run: finishing the board is a clear
        tokensEarned: tokens,
        dollarsSaved: 0,          // fun-first: this cabinet does not save real money
        score: run.score,
        streak: run.maxStreak,
        // The leaderboard ranks on cumulative earnings. It is monotonic, so the
        // server's MAX-per-player is exactly the player's running total.
        totalEarned: meta.totalEarned,
      };
      try { opts.onComplete && opts.onComplete(payload); } catch {}
      render();
    }

    function renderResult() {
      const o = run.outcome;
      root.innerHTML = `
        <div class="bm-screen bm-result">
          <div class="bm-result-verdict win">${o.best ? '🏆 New personal best!' : '🏁 Meeting adjourned'}</div>
          <div class="bm-result-scores">
            <div class="you"><span>FINAL SCORE</span><b>${fmt$(run.score)}</b></div>
          </div>
          <div class="bm-result-meta">
            Best streak ×${overclockOf(run.maxStreak)} (${run.maxStreak} in a row) &nbsp;·&nbsp; <b>+${o.tokens} 🪙</b>
            ${o.best && meta.plays > 1 ? '<div class="bm-newbest">★ NEW PERSONAL BEST</div>' : ''}
          </div>
          <div class="bm-result-btns">
            <button class="bm-btn bm-again">↻ &nbsp;Play again</button>
            <button class="bm-btn ghost bm-menu">Main stage</button>
          </div>
        </div>`;
      if (o.tokens) SFX.ship();
      root.querySelector('.bm-again').onclick = () => { SFX.ui(); startGame(); };
      root.querySelector('.bm-menu').onclick = () => { SFX.ui(); state = 'menu'; render(); };
    }

    // ---- styles -------------------------------------------------------------
    function injectStyle() {
      if (document.getElementById('bm-style')) return;
      const s = document.createElement('style');
      s.id = 'bm-style';
      s.textContent = BM_CSS;
      document.head.appendChild(s);
    }

    render();
    emit('ready', {});
    return {
      get meta() { return meta; },
      destroy() {
        cancelAnimationFrame(raf); stopMusic();
        global.removeEventListener('keydown', onKeyGlobal);
        soundBtn.remove(); root.remove();
      },
    };
  }

  const BM_CSS = `
  /* Jeopardy!-style palette: deep-blue board, gold values, condensed caps. */
  .bm-root{--jblue:#060CE9;--jblue-d:#0611b0;--jnavy:#040726;--jgold:#d9a441;--jgold-lt:#f5cd63;
    position:absolute;inset:0;font-family:'Helvetica Neue',Arial,system-ui,sans-serif;color:#fff;
    display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:14px;box-sizing:border-box;}
  .bm-cond{font-family:'Oswald','Arial Narrow','Helvetica Neue',Arial,sans-serif;}
  .bm-screen{width:100%;max-width:760px;margin:auto;display:flex;flex-direction:column;gap:14px;}
  .bm-btn{cursor:pointer;border:none;border-radius:8px;padding:14px 20px;font:800 16px 'Helvetica Neue',Arial,sans-serif;
    background:linear-gradient(180deg,#f5cd63,#d9a441);color:#161007;box-shadow:0 5px 0 #8a6516,0 8px 18px rgba(0,0,0,.5);
    text-transform:uppercase;letter-spacing:1px;transition:transform .08s,filter .12s;}
  .bm-btn:hover{filter:brightness(1.06);transform:translateY(-1px);}
  .bm-btn:active{transform:translateY(3px);box-shadow:0 2px 0 #8a6516,0 4px 10px rgba(0,0,0,.5);}
  .bm-btn.ghost{background:rgba(255,255,255,.1);color:#dbe4ff;box-shadow:none;border:1px solid #2a3aa8;}
  .bm-btn.hot{background:linear-gradient(180deg,#ffd76a,#e08a2a);}

  /* sound toggle — fixed top-right, mirrors the shell's back button */
  .bm-sound{position:fixed;top:12px;right:14px;z-index:7;width:38px;height:38px;border-radius:50%;
    border:1px solid #2a3aa8;background:rgba(6,16,80,.8);color:#fff;font-size:17px;cursor:pointer;
    backdrop-filter:blur(4px);transition:background .14s,border-color .14s,transform .08s;}
  .bm-sound:hover{background:#0a1a8a;border-color:#d9a441;transform:scale(1.06);}
  .bm-sound:active{transform:scale(.94);}

  /* menu */
  .bm-menu{align-items:center;text-align:center;}
  .bm-mascot{width:84px;filter:drop-shadow(0 6px 18px rgba(90,120,255,.5));animation:bmfloat 3s ease-in-out infinite;}
  @keyframes bmfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
  .bm-menu h1{margin:2px 0 0;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-size:56px;font-weight:700;
    letter-spacing:1px;text-transform:uppercase;color:var(--jgold-lt);
    text-shadow:2px 3px 0 #06104f,4px 6px 10px rgba(0,0,0,.6);}
  .bm-tag{margin:0;color:#bcc8ff;font-size:15px;max-width:460px;}
  .bm-rules{list-style:none;padding:0;margin:6px 0;text-align:left;display:flex;flex-direction:column;gap:7px;
    background:var(--jblue);border:2px solid #2a3aa8;border-radius:12px;padding:16px 18px;font-size:14px;color:#eef2ff;max-width:480px;
    box-shadow:0 10px 26px rgba(0,0,0,.5);}
  .bm-rules b{color:var(--jgold-lt);}
  .bm-play{font-size:18px;padding:16px 26px;}
  .bm-best{color:#9fb0e8;font-size:13px;}
  .bm-best b{color:var(--jgold-lt);}

  /* scorebar */
  .bm-scorebar{display:flex;align-items:center;gap:10px;background:var(--jnavy);border:2px solid #22308f;
    border-radius:10px;padding:9px 12px;}
  .bm-scorebar .bm-lbl{display:block;font-size:9px;letter-spacing:1.5px;color:#8896d8;text-transform:uppercase;}
  .bm-you b{color:var(--jgold-lt);font-size:22px;font-variant-numeric:tabular-nums;}
  .bm-oc{flex:1;text-align:right;font-size:9px;letter-spacing:1.5px;color:#8896d8;text-transform:uppercase;}
  .bm-oc b{display:inline;color:#7f8cc8;font-size:14px;margin-left:6px;}
  .bm-oc.hot b{color:var(--jgold-lt);}
  .bm-ocbar{height:5px;border-radius:3px;background:rgba(255,255,255,.12);margin:3px auto;overflow:hidden;}
  .bm-ocbar i{display:block;height:100%;background:linear-gradient(90deg,#ffd76a,#e08a2a);transition:width .3s;}

  /* board */
  .bm-cats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
  .bm-cat{background:var(--jblue);border:1px solid #06104f;border-radius:4px;padding:10px 6px;text-align:center;
    font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-weight:700;font-size:13px;line-height:1.15;letter-spacing:.3px;
    text-transform:uppercase;min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;
    color:#fff;text-shadow:1px 1px 0 #05093a;}
  .bm-icon{font-size:19px;display:block;margin-bottom:3px;}
  .bm-grid{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr;gap:6px;}
  .bm-tile{aspect-ratio:16/9;border:none;border-radius:4px;cursor:pointer;
    font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-weight:700;font-size:30px;letter-spacing:.5px;
    color:var(--jgold);background:var(--jblue);box-shadow:inset 0 0 0 1px #06104f;
    text-shadow:2px 2px 0 #05093a,3px 3px 4px rgba(0,0,0,.5);transition:transform .1s,filter .12s;}
  .bm-tile:hover{transform:scale(1.05);filter:brightness(1.15);color:var(--jgold-lt);z-index:1;}
  .bm-tile.done{color:transparent;background:#05093a;cursor:default;box-shadow:inset 0 0 0 1px #101a5a;text-shadow:none;}
  .bm-hint{text-align:center;color:#9fb0e8;font-size:12.5px;}

  /* commitment */
  .bm-commit{text-align:center;align-items:center;}
  .bm-commit-badge,.bm-final-badge{align-self:center;background:linear-gradient(180deg,#ffd76a,#e08a2a);color:#231402;
    font-family:'Oswald',Arial,sans-serif;font-weight:700;font-size:14px;letter-spacing:2px;padding:7px 18px;border-radius:20px;text-transform:uppercase;}
  .bm-commit h2{margin:4px 0;font-size:26px;}
  .bm-commit p{color:#bcc8ff;margin:0;max-width:440px;}
  .bm-wagers{display:flex;gap:10px;justify-content:center;margin:6px 0;}
  .bm-wager{display:flex;flex-direction:column;align-items:center;min-width:96px;font-size:24px;}
  .bm-wager small{font-size:12px;font-weight:600;opacity:.85;margin-top:2px;}

  /* clue */
  .bm-cluehead{display:flex;align-items:center;justify-content:space-between;}
  .bm-clue-cat{font-family:'Oswald',Arial,sans-serif;font-weight:700;font-size:15px;letter-spacing:.5px;color:var(--jgold-lt);text-transform:uppercase;}
  .bm-payout{font-family:'Oswald',Arial,sans-serif;font-weight:700;font-size:24px;color:var(--jgold-lt);font-variant-numeric:tabular-nums;}
  .bm-timer{height:10px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;}
  .bm-timer i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#f5cd63,#d9a441);transition:width .08s linear;}
  .bm-timer i.warn{background:linear-gradient(90deg,#ffd76a,#ff9a3d);}
  .bm-timer i.danger{background:linear-gradient(90deg,#ff8a5a,#ff5d6c);}
  /* The clue itself — white caps on Jeopardy blue, the signature look. */
  .bm-q{background:var(--jblue);border:2px solid #22308f;border-radius:8px;padding:26px 22px;font-size:21px;
    font-weight:700;line-height:1.32;text-align:center;min-height:70px;text-transform:uppercase;letter-spacing:.4px;
    color:#fff;text-shadow:1px 2px 0 #05093a;display:flex;align-items:center;justify-content:center;
    box-shadow:0 10px 26px rgba(0,0,0,.5);}
  .bm-answers{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .bm-ans{cursor:pointer;border:2px solid #2a3aa8;background:var(--jblue-d);color:#fff;border-radius:7px;
    padding:15px 14px;font:700 15px 'Helvetica Neue',Arial,sans-serif;text-align:center;transition:transform .08s,background .12s,border-color .12s;}
  .bm-ans:hover:not(:disabled){background:#1024d8;border-color:var(--jgold);transform:translateY(-1px);}
  .bm-ans:disabled{cursor:default;opacity:.85;}
  .bm-ans.right{background:linear-gradient(180deg,#1f9a55,#137a3d);border-color:#3fd98a;color:#fff;opacity:1;}
  .bm-ans.wrong{background:linear-gradient(180deg,#c23247,#8a1f2c);border-color:#ff5d6c;color:#fff;opacity:1;}
  .bm-feedback{min-height:24px;text-align:center;font-size:14.5px;font-weight:700;}
  .bm-feedback .ok{color:var(--jgold-lt);}
  .bm-feedback .bad{color:#ff8a9c;}
  .bm-why{margin-top:6px;font-size:12.5px;font-weight:500;color:#aebbee;line-height:1.4;}

  /* final */
  .bm-final{text-align:center;align-items:center;}
  .bm-final p{color:#bcc8ff;margin:2px 0;max-width:460px;}
  .bm-final-cats{display:flex;flex-direction:column;gap:10px;width:100%;max-width:420px;}
  .bm-fcat{font-size:17px;}
  .bm-wageramt{font-family:'Oswald',Arial,sans-serif;font-size:46px;font-weight:700;color:var(--jgold-lt);font-variant-numeric:tabular-nums;}
  .bm-slider{width:100%;max-width:440px;accent-color:var(--jgold);height:6px;}
  .bm-wagerquick{display:flex;gap:8px;}
  .bm-lockwager{margin-top:4px;}

  /* result */
  .bm-result{text-align:center;align-items:center;gap:18px;}
  .bm-result-verdict{font-family:'Oswald',Arial,sans-serif;font-size:34px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}
  .bm-result-verdict.win{color:var(--jgold-lt);text-shadow:2px 2px 0 #06104f;}
  .bm-result-verdict.lose{color:#ff8a9c;}
  .bm-result-scores{display:flex;align-items:center;gap:22px;}
  .bm-result-scores>div{display:flex;flex-direction:column;}
  .bm-result-scores span{font-size:11px;letter-spacing:1.5px;color:#8896d8;text-transform:uppercase;}
  .bm-result-scores .you b{font-family:'Oswald',Arial,sans-serif;font-size:40px;color:var(--jgold-lt);}
  .bm-result-meta{color:#bcc8ff;font-size:14px;}
  .bm-result-meta b{color:var(--jgold-lt);}
  .bm-newbest{color:var(--jgold-lt);font-weight:800;margin-top:6px;}
  .bm-result-btns{display:flex;gap:12px;}

  @media(max-width:560px){
    .bm-menu h1{font-size:42px;}
    .bm-answers{grid-template-columns:1fr;}
    .bm-cat{font-size:11px;min-height:48px;}
    .bm-tile{font-size:20px;}
    .bm-result-scores{gap:12px;}
  }`;

  global.BoardMeeting = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
