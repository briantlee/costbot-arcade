/* ==========================================================================
 * Quiz Show — a Jeopardy-style game show for the CostBot Arcade.
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
 * ArcadeSync for the leaderboard. Mount with QuizShow.mount('#el', opts).
 * Content lives in qs-content.js (QuizShowContent).
 * ======================================================================== */
((global) => {
  'use strict';

  const STORE_KEY = 'costbot.quizshow.v1';
  const VALUES = [400, 800, 1200, 1600];    // row tiers, easy → hard (4×4 board)
  const CLUE_SECS = 10;                      // per-clue clock
  const FINAL_SECS = 15;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const _rand = (lo, hi) => lo + Math.random() * (hi - lo);

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
    // Ambient decoration lives on the host (outside root, like the sound
    // toggle) so it survives root.innerHTML being rewritten every screen
    // change, and fills the dead space around the centered card.
    const ambient = document.createElement('div');
    ambient.className = 'qs-ambient';
    ambient.innerHTML = `
      <span class="qs-amb qs-amb1">💸</span>
      <span class="qs-amb qs-amb2">☁️</span>
      <span class="qs-amb qs-amb3">✨</span>
      <span class="qs-amb qs-amb4">🪙</span>
      <span class="qs-amb qs-amb5">📊</span>`;
    host.appendChild(ambient);
    const root = document.createElement('div');
    root.className = 'qs-root';
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
    soundBtn.className = 'qs-sound'; soundBtn.type = 'button';
    host.appendChild(soundBtn);
    function paintSound() { soundBtn.textContent = meta.muted ? '🔇' : '🔊'; soundBtn.title = (meta.muted ? 'Sound off' : 'Sound on') + ' (M)'; }
    function applyMute() { if (master) master.gain.value = meta.muted ? 0 : 0.45; }
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
    // Delegated so it keeps working across every re-render of root.innerHTML —
    // the scorebar (and its quit button) is redrawn on every screen change.
    root.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.qs-quit')) { SFX.ui(); quitToMenu(); }
    });

    // ---- audio (own context for sfx; ArcadeMusic for the soundtrack) --------
    let actx = null, master = null, sfxBus = null, music = null;
    function initAudio() {
      if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain(); master.gain.value = meta.muted ? 0 : 0.45; master.connect(actx.destination);
      sfxBus = actx.createGain(); sfxBus.gain.value = 0.5; sfxBus.connect(master);
      if (global.ArcadeMusic) music = global.ArcadeMusic.create(() => ({ ctx: actx, master }));
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
      correct: () => { [880, 1174, 1568].forEach((f, i) => { setTimeout(() => blip(f, 0.11, 'triangle', 0.42, f * 1.2), i * 70); }); },
      // Wrong — the flat "eehhh" buzzer.
      wrong: () => { blip(196, 0.32, 'sawtooth', 0.42, 120); setTimeout(() => blip(155, 0.30, 'square', 0.3, 100), 20); },
      tick: () => blip(1200, 0.03, 'square', 0.16),
      overclock: () => { blip(784, 0.08, 'triangle', 0.35, 1046); setTimeout(() => blip(1046, 0.08, 'sine', 0.3, 1568), 70); },
      ship: () => { [523, 659, 784, 1046].forEach((f, i) => { setTimeout(() => blip(f, 0.14, 'triangle', 0.35), i * 90); }); },
      final: () => { blip(330, 0.5, 'sawtooth', 0.25, 660); },
    };

    // ---- soundtrack: ArcadeMusic's "Fiscal Jeopardy" (the Think! cue) --------
    function playTrack() { if (music) music.playTrack('ch_jeopardy'); }
    function stopMusic() { if (music) music.stop(); }

    // ---- run state ----------------------------------------------------------
    let state = 'menu';           // menu | board | clue | final | result
    let run = null;
    let raf = 0, lastT = 0;

    const C = global.QuizShowContent;

    // Per-category accent so the board isn't 16 identical blue rectangles.
    // Keyed to the category's position in the full content pool (not the
    // 4 drawn this game), so a given category always reads the same color.
    const CAT_PALETTE = [
      { top: '#4a63ff', tint: 'rgba(74,99,255,.24)' },
      { top: '#2fd9ff', tint: 'rgba(47,217,255,.22)' },
      { top: '#3fe0a0', tint: 'rgba(63,224,160,.20)' },
      { top: '#c77bff', tint: 'rgba(199,123,255,.22)' },
      { top: '#ffd76a', tint: 'rgba(255,215,106,.22)' },
      { top: '#ff8a5a', tint: 'rgba(255,138,90,.22)' },
    ];
    function catAccent(cat) {
      const idx = C.CATEGORIES.findIndex((c) => c.id === cat.id);
      return CAT_PALETTE[(idx < 0 ? 0 : idx) % CAT_PALETTE.length];
    }

    // ---- juice helpers: shake / score-pop / overclock toast -----------------
    function shakeRoot(kind) {
      const cls = kind === 'sm' ? 'qs-shake-sm' : kind === 'hard' ? 'qs-shake-hard' : 'qs-shake-md';
      root.classList.remove('qs-shake-sm', 'qs-shake-md', 'qs-shake-hard');
      void root.offsetWidth; // restart animation even if the same class is reused back-to-back
      root.classList.add(cls);
      clearTimeout(shakeRoot._t);
      const dur = kind === 'sm' ? 280 : kind === 'hard' ? 600 : 400;
      shakeRoot._t = setTimeout(() => root.classList.remove(cls), dur);
    }
    function flashVignette() {
      root.classList.remove('qs-vignette');
      void root.offsetWidth;
      root.classList.add('qs-vignette');
      clearTimeout(flashVignette._t);
      flashVignette._t = setTimeout(() => root.classList.remove('qs-vignette'), 650);
    }
    function bumpScore(bad) {
      const el = root.querySelector('.qs-you b');
      if (el) {
        el.textContent = fmt$(run.score);
        el.classList.remove('qs-pop', 'qs-pop-bad');
        void el.offsetWidth;
        el.classList.add(bad ? 'qs-pop-bad' : 'qs-pop');
      }
      // Podium "screen" overlay — same live number, painted onto the blank
      // panel of cb_jep_transparent.png. Purely cosmetic, mirrors .qs-you b.
      const pod = root.querySelector('.qs-podium-score');
      if (pod) {
        pod.textContent = fmt$(run.score);
        pod.classList.remove('qs-pop', 'qs-pop-bad');
        void pod.offsetWidth;
        pod.classList.add(bad ? 'qs-pop-bad' : 'qs-pop');
      }
    }
    function showOverclockToast(oc) {
      const old = root.querySelector('.qs-overclock-toast');
      if (old) old.remove();
      const el = document.createElement('div');
      el.className = 'qs-overclock-toast';
      el.textContent = `×${oc} OVERCLOCK!`;
      root.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => el.classList.add('fade'), 900);
      setTimeout(() => el.remove(), 1450);
    }

    function newRun() {
      const cats = shuffle(C.CATEGORIES.slice()).slice(0, 3);
      const tiles = [];
      cats.forEach((cat, col) => { VALUES.forEach((val, row) => {
        // Each tier holds several clues; draw one at random so a tile is a
        // different question next game.
        const pool = cat.tiers[row];
        const clue = Array.isArray(pool) ? pick1(pool) : pool;
        tiles.push({ col, row, cat, value: val, clue, done: false, commitment: false });
      }); });
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

    // Decorative game-show podium flanking the board/clue card. The blank
    // blue panel in the source art (below "CostBot!", above the shield
    // logo) gets the live score painted on top of it — cosmetic only, kept
    // in sync with .qs-you b by bumpScore().
    function podiumDecor() {
      return `
        <div class="qs-podium-decor">
          <img class="qs-board-decor" src="../shared/assets/cb_jep_transparent.png" alt="">
          <div class="qs-podium-score">${fmt$(run.score)}</div>
        </div>`;
    }

    function scoreBar() {
      const oc = overclockOf(run.streak);
      return `
        <div class="qs-scorebar">
          <button class="qs-quit" type="button" title="Quit to Quiz Show menu (Esc)">✕</button>
          <div class="qs-you"><span class="qs-lbl">BANKED</span><b>${fmt$(run.score)}</b></div>
          <div class="qs-oc ${oc > 1 ? 'hot' : ''}">
            <span>OVERCLOCK</span>
            <div class="qs-ocbar"><i style="width:${((oc - 1) / 1) * 100}%"></i></div>
            <b>×${oc}</b>
          </div>
        </div>`;
    }

    function renderMenu() {
      stopMusic();
      root.innerHTML = `
        <div class="qs-screen qs-menu">
          <img class="qs-mascot" src="../shared/assets/costbot_jeopardy.jpg" alt="">
          <h1>CostBot&nbsp;Quiz&nbsp;Show</h1>
          <p class="qs-tag">CostBot's cloud-cost game show — you versus the clock.</p>
          <div class="qs-lbl">HOW TO PLAY</div>
          <div class="qs-how">
            <div class="qs-card"><div class="k">💸 Beat the clock</div><div class="d">Pick a clue off the board and answer fast — the payout decays every second you dither.</div></div>
            <div class="qs-card"><div class="k">⏱️ Don't stall</div><div class="d">Let the clock run out and the clue is gone — no bank. A wrong buzz costs you too.</div></div>
            <div class="qs-card"><div class="k">🔒 Commitment tiles</div><div class="d">Wager first, then answer — nail it for a bonus, miss it and lose the wager.</div></div>
            <div class="qs-card"><div class="k">🔥 Overclock</div><div class="d">Correct streaks overclock your payout up to ×2. Keep the run alive.</div></div>
            <div class="qs-card"><div class="k">🏁 Final Forecast</div><div class="d">The last clue — bet your whole bank on one answer to close the show.</div></div>
            <div class="qs-card"><div class="k">🎛️ Controls</div><div class="d">Click a tile, then an answer. 🔊 top-right or M mutes · Esc quits a game.</div></div>
          </div>
          <button class="qs-btn qs-play hot">▶ &nbsp;Start the show</button>
          <a class="qs-board" href="../leaderboard/index.html#quiz-show">🏆 Leaderboard</a>
          <div class="qs-best">${meta.best
            ? 'Best round <b>' + fmt$(meta.best) + '</b> &nbsp;·&nbsp; total earned <b>' + fmt$(meta.totalEarned || 0) + '</b>'
            : 'No score yet — go get one.'}</div>
        </div>`;
      root.querySelector('.qs-play').onclick = () => { initAudio(); startGame(); };
    }

    function startGame() {
      newRun();
      state = 'board';
      playTrack();
      SFX.reveal();
      emit('run:start', {});
      render();
    }

    function renderBoard() {
      const accents = run.cats.map(catAccent);
      const cols = run.cats.map((c, i) => {
        const ac = accents[i];
        return `<div class="qs-cat" style="--cat-accent:${ac.top};--cat-tint:${ac.tint};animation-delay:${i * 30}ms"><span class="qs-icon">${c.icon}</span>${c.name}</div>`;
      }).join('');
      let grid = '';
      let idx = 0;
      for (let row = 0; row < VALUES.length; row++) {
        for (let col = 0; col < run.cats.length; col++) {
          const t = run.tiles.find((x) => x.col === col && x.row === row);
          const ac = accents[col];
          const style = `--cat-accent:${ac.top};--cat-tint:${ac.tint};animation-delay:${idx * 22}ms`;
          if (t.done) grid += `<div class="qs-tile done" style="${style}">✓</div>`;
          else grid += `<button class="qs-tile" data-col="${col}" data-row="${row}" style="${style}">${t.commitment ? '🔒' : '$' + t.value}</button>`;
          idx++;
        }
      }
      root.innerHTML = `
        <div class="qs-screen qs-board" style="--qs-cols:${run.cats.length}">
          ${podiumDecor()}
          ${scoreBar()}
          <div class="qs-cats">${cols}</div>
          <div class="qs-grid">${grid}</div>
          <div class="qs-hint">Pick a clue. ${run.remaining === run.tiles.length ? 'Higher rows pay more, but the questions bite back.' : run.remaining + ' left before Final Forecast.'}</div>
        </div>`;
      root.querySelectorAll('.qs-tile[data-col]').forEach((el) => {
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
        <div class="qs-screen qs-commit">
          <div class="qs-commit-badge">🔒 THE COMMITMENT</div>
          <h2>${t.cat.icon} ${t.cat.name}</h2>
          <p>Wager before you see the clue. Nail it for the payout — miss it and the wager comes out of your bank.</p>
          <div class="qs-wagers">
            <button class="qs-btn qs-wager" data-m="1">×1<small>${fmt$(t.value)}</small></button>
            <button class="qs-btn qs-wager" data-m="2">×2<small>${fmt$(t.value * 2)}</small></button>
            <button class="qs-btn qs-wager hot" data-m="3">×3<small>${fmt$(t.value * 3)}</small></button>
          </div>
          <div class="qs-hint">Bigger commitment, bigger swing. Just like a Reserved Instance.</div>
        </div>`;
      root.querySelectorAll('.qs-wager').forEach((el) => {
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
        `<button class="qs-ans" data-i="${i}" ${cl.phase === 'resolved' ? 'disabled' : ''}>${ch.text}</button>`).join('');
      root.innerHTML = `
        <div class="qs-screen qs-clue">
          ${podiumDecor()}
          ${scoreBar()}
          <div class="qs-cluehead">
            <span class="qs-clue-cat">${t.cat.icon} ${t.cat.name}</span>
            <span class="qs-payout" id="qs-payout">${cl.wagerMult ? '×' + cl.wagerMult + ' · ' : ''}${fmt$(pay)}</span>
          </div>
          <div class="qs-timer"><i id="qs-timerbar" style="width:100%"></i></div>
          <div class="qs-q">${t.clue.q}</div>
          <div class="qs-answers" id="qs-answers">${answers}</div>
          <div class="qs-feedback" id="qs-feedback"></div>
        </div>`;
      wireAnswers();
    }

    function wireAnswers() {
      root.querySelectorAll('.qs-ans').forEach((el) => {
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
      const bar = document.getElementById('qs-timerbar');
      const payEl = document.getElementById('qs-payout');
      const frac = clamp(1 - cl.time / cl.dur, 0, 1);
      if (bar) { bar.style.width = (frac * 100) + '%'; bar.className = frac < 0.3 ? 'danger' : frac < 0.6 ? 'warn' : ''; }
      if (payEl) payEl.textContent = (cl.wagerMult ? '×' + cl.wagerMult + ' · ' : '') + fmt$(livePayout(cl));

      // last-3-seconds tick
      const secLeft = Math.ceil(cl.dur - cl.time);
      if (secLeft <= 3 && secLeft > 0 && secLeft !== cl.lastTickSec) { cl.lastTickSec = secLeft; SFX.tick(); }

      // timeout — the clue is gone
      if (cl.time >= cl.dur) { resolveClue('timeout'); }
    }

    function answer(i, _el) {
      const cl = run.clue;
      if (!cl || cl.phase === 'resolved' || cl.answered) return;
      cl.answered = true;
      const correct = cl.choices[i].correct;
      // reveal correct/incorrect on the buttons
      root.querySelectorAll('.qs-ans').forEach((b, idx) => {
        b.disabled = true;
        if (cl.choices[idx].correct) b.classList.add('right');
        else if (idx === i) b.classList.add('wrong');
      });
      resolveClue(correct ? 'correct' : 'wrong', i);
    }

    function resolveClue(kind, _chosen) {
      const cl = run.clue;
      if (!cl || cl.phase === 'resolved') return;
      cl.phase = 'resolved';
      cancelAnimationFrame(raf);
      const t = cl.tile;
      const fb = document.getElementById('qs-feedback');
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
        shakeRoot('sm');
        bumpScore();
        if (oc > overclockOf(run.streak - 1) && oc > 1) { SFX.overclock(); showOverclockToast(oc); }
        note = `<span class="ok">✔ ${pick1(SAY.correct)}</span> +${fmt$(pay)}${oc > 1 ? ' · ×' + oc + ' overclock' : ''}`;
      } else {
        run.streak = 0;
        SFX.wrong();
        if (penalty) run.score = Math.max(0, run.score - penalty);
        // Commitment (Daily-Double) losses are higher-stakes than a routine
        // miss/timeout — read that harder in the shake + a red vignette flash.
        if (penalty) { shakeRoot('hard'); flashVignette(); } else { shakeRoot('md'); }
        if (penalty) bumpScore(true);
        const lead = kind === 'wrong' ? '✗ ' + pick1(SAY.wrong) : '⏰ ' + pick1(SAY.timeout);
        if (kind !== 'wrong') markAnswerReveal();
        note = `<span class="bad">${lead}</span>${penalty ? ' −' + fmt$(penalty) + ' (commitment)' : ''}`;
      }
      if (fb) fb.innerHTML = `${note}<div class="qs-why">${t.clue.why}</div>`;

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
      root.querySelectorAll('.qs-ans').forEach((b, idx) => {
        b.disabled = true;
        if (run.clue.choices[idx].correct) b.classList.add('right');
      });
    }

    // ---- Final Forecast -----------------------------------------------------
    function startFinal() {
      state = 'final';
      SFX.final();
      playTrack();
      const picks = shuffle(C.FINALS.slice()).slice(0, 3);
      run.final = { picks, chosen: null, wager: Math.min(run.score, Math.max(200, Math.round(run.score / 2))), phase: 'pick' };
      renderFinal();
    }

    function renderFinal() {
      const F = run.final;
      if (F.phase === 'pick') {
        root.innerHTML = `
          <div class="qs-screen qs-final">
            ${scoreBar()}
            <div class="qs-final-badge">🏁 FINAL FORECAST</div>
            <p>Pick your category, then wager your bank on one last clue. Nail it to double up, miss it and it's gone.</p>
            <div class="qs-final-cats">
              ${F.picks.map((f, i) => `<button class="qs-btn qs-fcat" data-i="${i}">${f.cat}</button>`).join('')}
            </div>
          </div>`;
        root.querySelectorAll('.qs-fcat').forEach((el) => {
          el.onclick = () => { SFX.ui(); F.chosen = F.picks[+el.dataset.i]; F.phase = 'wager'; renderFinal(); };
        });
      } else if (F.phase === 'wager') {
        const maxW = Math.max(0, run.score);
        root.innerHTML = `
          <div class="qs-screen qs-final">
            ${scoreBar()}
            <div class="qs-final-badge">🏁 ${F.chosen.cat}</div>
            <p>How much of your <b>${fmt$(run.score)}</b> do you commit?</p>
            <div class="qs-wageramt" id="qs-wageramt">${fmt$(F.wager)}</div>
            <input class="qs-slider" type="range" min="0" max="${maxW}" step="${Math.max(1, Math.round(maxW / 40))}" value="${F.wager}">
            <div class="qs-wagerquick">
              <button class="qs-btn ghost" data-w="0">Nothing</button>
              <button class="qs-btn ghost" data-w="${Math.round(maxW / 2)}">Half</button>
              <button class="qs-btn ghost hot" data-w="${maxW}">All in</button>
            </div>
            <button class="qs-btn qs-lockwager">🔒 Lock it in</button>
          </div>`;
        const amt = root.querySelector('#qs-wageramt');
        const sl = root.querySelector('.qs-slider');
        sl.oninput = () => { F.wager = +sl.value; amt.textContent = fmt$(F.wager); };
        root.querySelectorAll('.qs-wagerquick .qs-btn').forEach((el) => {
          el.onclick = () => { F.wager = +el.dataset.w; sl.value = F.wager; amt.textContent = fmt$(F.wager); SFX.ui(); };
        });
        root.querySelector('.qs-lockwager').onclick = () => { SFX.ui(); F.phase = 'clue'; launchFinalClue(); };
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
        const bar = document.getElementById('qs-timerbar');
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
        <div class="qs-screen qs-clue final">
          ${scoreBar()}
          <div class="qs-cluehead">
            <span class="qs-clue-cat">🏁 ${F.chosen.cat}</span>
            <span class="qs-payout">Wager ${fmt$(F.wager)}</span>
          </div>
          <div class="qs-timer"><i id="qs-timerbar" style="width:100%"></i></div>
          <div class="qs-q">${F.chosen.q}</div>
          <div class="qs-answers">${cl.choices.map((ch, i) => `<button class="qs-ans" data-i="${i}">${ch.text}</button>`).join('')}</div>
          <div class="qs-feedback" id="qs-feedback"></div>
        </div>`;
      root.querySelectorAll('.qs-ans').forEach((el) => {
        el.onclick = () => {
          const cl2 = F.clue;
          if (cl2.answered || cl2.phase === 'resolved') return;
          cl2.answered = true;
          const correct = cl2.choices[+el.dataset.i].correct;
          root.querySelectorAll('.qs-ans').forEach((b, idx) => {
            b.disabled = true;
            if (cl2.choices[idx].correct) b.classList.add('right');
            else if (idx === +el.dataset.i) b.classList.add('wrong');
          });
          resolveFinal(correct, +el.dataset.i);
        };
      });
    }

    function resolveFinal(correct, _chosen) {
      const F = run.final, cl = F.clue;
      if (cl.phase === 'resolved') return;
      cl.phase = 'resolved';
      cancelAnimationFrame(raf);
      const fb = document.getElementById('qs-feedback');
      if (correct) { run.score += F.wager; SFX.correct(); }
      else {
        run.score = Math.max(0, run.score - F.wager);
        SFX.wrong();
        root.querySelectorAll('.qs-ans').forEach((b, idx) => { if (cl.choices[idx].correct) b.classList.add('right'); });
      }
      if (fb) fb.innerHTML = `<span class="${correct ? 'ok' : 'bad'}">${correct ? '✔ Forecast confirmed' : '✗ Forecast missed'}</span> ${correct ? '+' : '−'}${fmt$(F.wager)}<div class="qs-why">${F.chosen.why}</div>`;
      setTimeout(finish, 2400);
    }

    // ---- result -------------------------------------------------------------
    function finish() {
      stopMusic();
      const tokens = Math.max(0, Math.floor(run.score / 62));
      if (global.ArcadeWallet && tokens) global.ArcadeWallet.earn(tokens, 'quiz-show');
      meta.plays++;
      meta.totalEarned = (meta.totalEarned || 0) + run.score;
      const best = run.score > (meta.best || 0);
      if (best) { meta.best = run.score; meta.wins++; }   // "wins" now = personal-best games
      persist();
      run.outcome = { tokens, best };
      state = 'result';
      emit('run:end', {});

      const payload = {
        game: 'quiz-show',
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
        <div class="qs-screen qs-result">
          <div class="qs-result-verdict win">${o.best ? '🏆 New personal best!' : '🎬 That’s a wrap!'}</div>
          <div class="qs-result-scores">
            <div class="you"><span>FINAL SCORE</span><b>${fmt$(run.score)}</b>
              <small class="qs-lifetime">Lifetime earned: ${fmt$(meta.totalEarned || 0)}</small>
            </div>
          </div>
          <div class="qs-result-meta">
            Best streak ×${overclockOf(run.maxStreak)} (${run.maxStreak} in a row) &nbsp;·&nbsp;
            <b>+${o.tokens} <img src="../shared/assets/token-coin-64.png" alt="" style="height:1em;width:1em;vertical-align:-0.15em"></b>
            ${o.best && meta.plays > 1 ? '<div class="qs-newbest">★ NEW PERSONAL BEST</div>' : ''}
          </div>
          <div class="qs-result-btns">
            <button class="qs-btn qs-again">↻ &nbsp;Play again</button>
            <button class="qs-btn ghost qs-menu">Main stage</button>
          </div>
        </div>`;
      if (o.tokens) SFX.ship();
      root.querySelector('.qs-again').onclick = () => { SFX.ui(); startGame(); };
      root.querySelector('.qs-menu').onclick = () => { SFX.ui(); state = 'menu'; render(); };
    }

    // ---- styles -------------------------------------------------------------
    function injectStyle() {
      if (document.getElementById('qs-style')) return;
      const s = document.createElement('style');
      s.id = 'qs-style';
      s.textContent = QS_CSS;
      document.head.appendChild(s);
    }

    render();
    emit('ready', {});
    return {
      get meta() { return meta; },
      destroy() {
        cancelAnimationFrame(raf); stopMusic();
        global.removeEventListener('keydown', onKeyGlobal);
        soundBtn.remove(); ambient.remove(); root.remove();
      },
    };
  }

  const QS_CSS = `
  /* Jeopardy!-style palette: deep-blue board, gold values, condensed caps. */
  .qs-root{--jblue:#060CE9;--jblue-d:#0611b0;--jnavy:#040726;--jgold:#d9a441;--jgold-lt:#f5cd63;
    position:absolute;inset:0;z-index:1;font-family:'Helvetica Neue',Arial,system-ui,sans-serif;color:#fff;
    display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:14px;box-sizing:border-box;}

  /* screen-shake + high-stakes vignette (resolveClue juice) */
  @keyframes qs-shake-sm{0%,100%{transform:translate(0,0)}30%{transform:translate(-3px,1px)}60%{transform:translate(2px,-2px)}}
  @keyframes qs-shake-md{0%,100%{transform:translate(0,0)}20%{transform:translate(-6px,2px)}40%{transform:translate(5px,-3px)}60%{transform:translate(-4px,3px)}80%{transform:translate(3px,-2px)}}
  @keyframes qs-shake-hard{0%,100%{transform:translate(0,0)}15%{transform:translate(-11px,5px)}30%{transform:translate(10px,-7px)}45%{transform:translate(-9px,6px)}60%{transform:translate(8px,-5px)}75%{transform:translate(-5px,3px)}90%{transform:translate(3px,-2px)}}
  .qs-root.qs-shake-sm{animation:qs-shake-sm .28s ease-in-out;}
  .qs-root.qs-shake-md{animation:qs-shake-md .4s ease-in-out;}
  .qs-root.qs-shake-hard{animation:qs-shake-hard .6s ease-in-out;}
  @keyframes qs-vignette-flash{0%{opacity:0}15%{opacity:1}100%{opacity:0}}
  .qs-root.qs-vignette::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:8;
    background:radial-gradient(ellipse at center,rgba(255,40,60,0) 38%,rgba(255,20,40,.5) 100%);
    animation:qs-vignette-flash .65s ease-out;}

  /* ambient motion behind the central card — fills the dead space, stays subtle */
  .qs-ambient{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;}
  .qs-amb{position:absolute;font-size:32px;opacity:.13;animation:qs-amb-float 8s ease-in-out infinite;}
  .qs-amb1{top:9%;left:6%;font-size:30px;animation-duration:8.5s;}
  .qs-amb2{top:72%;left:9%;font-size:24px;animation-duration:9.5s;animation-delay:-2.4s;}
  .qs-amb3{top:12%;right:7%;font-size:28px;animation-duration:7.5s;animation-delay:-4.1s;}
  .qs-amb4{top:62%;right:8%;font-size:22px;animation-duration:6.8s;animation-delay:-1.2s;}
  .qs-amb5{bottom:6%;left:46%;font-size:22px;animation-duration:10.5s;animation-delay:-3.3s;}
  @keyframes qs-amb-float{0%,100%{transform:translateY(0) translateX(0) rotate(0deg);}33%{transform:translateY(-18px) translateX(7px) rotate(5deg);}66%{transform:translateY(11px) translateX(-9px) rotate(-4deg);}}
  @media(max-width:700px){.qs-ambient{display:none;}}
  .qs-cond{font-family:'Oswald','Arial Narrow','Helvetica Neue',Arial,sans-serif;}
  .qs-screen{position:relative;width:100%;max-width:760px;margin:auto;display:flex;flex-direction:column;gap:14px;}

  /* game-show set piece flanking the board/clue card — decorative, plus a
     live-score readout painted onto the podium screen's blank blue panel
     (below "CostBot!", above the shield logo in cb_jep_transparent.png). */
  .qs-podium-decor{position:absolute;top:50%;left:calc(100% + 22px);
    width:min(280px,23vw);pointer-events:none;animation:qs-podium-bob 4s ease-in-out infinite;}
  @media(max-width:1150px){.qs-podium-decor{display:none;}}
  /* the bob lives on the wrapper (not the image) so the score overlay — a sibling
     positioned by percentage inside this same box — rides along with it instead
     of drifting out of the blue panel as the podium moves. */
  @keyframes qs-podium-bob{0%,100%{transform:translateY(-50%)}50%{transform:translateY(calc(-50% - 9px))}}
  .qs-board-decor{display:block;width:100%;height:auto;max-height:74vh;object-fit:contain;
    filter:drop-shadow(0 10px 22px rgba(0,0,0,.55));}
  .qs-podium-score{position:absolute;top:50.5%;left:50%;transform:translate(-50%,-50%);
    width:42%;text-align:center;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-weight:700;
    letter-spacing:.5px;color:var(--jgold-lt);text-shadow:0 0 5px rgba(0,0,0,.8),0 1px 2px rgba(0,0,0,.9);
    font-size:clamp(12px,2vw,22px);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1;}
  .qs-podium-score.qs-pop{animation:qs-score-pop .5s ease;}
  .qs-podium-score.qs-pop-bad{animation:qs-score-pop-bad .5s ease;}
  .qs-btn{cursor:pointer;border:none;border-radius:8px;padding:14px 20px;font:800 16px 'Helvetica Neue',Arial,sans-serif;
    background:linear-gradient(180deg,#f5cd63,#d9a441);color:#161007;box-shadow:0 5px 0 #8a6516,0 8px 18px rgba(0,0,0,.5);
    text-transform:uppercase;letter-spacing:1px;transition:transform .08s,filter .12s;}
  .qs-btn:hover{filter:brightness(1.06);transform:translateY(-1px);}
  .qs-btn:active{transform:translateY(3px);box-shadow:0 2px 0 #8a6516,0 4px 10px rgba(0,0,0,.5);}
  .qs-btn.ghost{background:rgba(255,255,255,.1);color:#dbe4ff;box-shadow:none;border:1px solid #2a3aa8;}
  .qs-btn.hot{background:linear-gradient(180deg,#ffd76a,#e08a2a);}

  /* sound toggle — fixed top-right, mirrors the shell's back button */
  .qs-sound{position:fixed;top:12px;right:14px;z-index:7;width:38px;height:38px;border-radius:50%;
    border:1px solid #2a3aa8;background:rgba(6,16,80,.8);color:#fff;font-size:17px;cursor:pointer;
    backdrop-filter:blur(4px);transition:background .14s,border-color .14s,transform .08s;}
  .qs-sound:hover{background:#0a1a8a;border-color:#d9a441;transform:scale(1.06);}
  .qs-sound:active{transform:scale(.94);}

  /* menu */
  .qs-menu{align-items:center;text-align:center;}
  .qs-mascot{width:min(440px,82vw);height:auto;border-radius:14px;filter:drop-shadow(0 6px 18px rgba(90,120,255,.5));animation:bmfloat 3s ease-in-out infinite;}
  @keyframes bmfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
  .qs-menu h1{margin:2px 0 0;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-size:56px;font-weight:700;
    letter-spacing:1px;text-transform:uppercase;color:var(--jgold-lt);
    text-shadow:2px 3px 0 #06104f,4px 6px 10px rgba(0,0,0,.6);}
  .qs-tag{margin:0;color:#bcc8ff;font-size:15px;max-width:460px;}
  .qs-rules{list-style:none;padding:0;margin:6px 0;text-align:left;display:flex;flex-direction:column;gap:7px;
    background:var(--jblue);border:2px solid #2a3aa8;border-radius:12px;padding:16px 18px;font-size:14px;color:#eef2ff;max-width:480px;
    box-shadow:0 10px 26px rgba(0,0,0,.5);}
  .qs-rules b{color:var(--jgold-lt);}
  .qs-play{font-size:18px;padding:16px 26px;}
  .qs-best{color:#9fb0e8;font-size:13px;}
  .qs-best b{color:var(--jgold-lt);}
  .qs-lbl{font-size:11px;font-weight:800;letter-spacing:1.6px;color:#8fa0dc;align-self:flex-start;}
  .qs-how{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;text-align:left;}
  @media(max-width:560px){.qs-how{grid-template-columns:1fr;}}
  .qs-card{padding:9px 12px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid #2a3aa8;}
  .qs-card .k{font-weight:800;font-size:12.5px;color:#eaf0ff;margin-bottom:2px;}
  .qs-card .d{font-size:11.5px;color:#aeb9e6;line-height:1.4;}
  .qs-board{text-decoration:none;color:#bcc8ff;font-weight:700;font-size:13px;padding:8px 18px;border-radius:9px;
    border:1px solid #2a3aa8;background:rgba(255,255,255,.05);transition:border-color .12s,color .12s;}
  .qs-board:hover{border-color:#6b7fe0;color:#fff;}

  /* scorebar */
  .qs-scorebar{display:flex;align-items:flex-end;gap:10px;background:var(--jnavy);border:2px solid #22308f;
    border-radius:10px;padding:9px 12px;}
  .qs-scorebar .qs-lbl{display:block;font-size:9px;letter-spacing:1.5px;color:#8896d8;text-transform:uppercase;}
  /* explicit in-round exit — surfaces the Esc-quit-to-menu path that otherwise
     has no visible affordance once a round is underway */
  .qs-quit{flex:0 0 auto;width:26px;height:26px;border-radius:50%;cursor:pointer;align-self:center;
    border:1px solid #2a3aa8;background:rgba(255,255,255,.06);color:#9fb0e8;font-size:13px;line-height:1;
    display:flex;align-items:center;justify-content:center;padding:0;transition:background .12s,border-color .12s,color .12s;}
  .qs-quit:hover{background:#8a1f2c;border-color:#ff5d6c;color:#fff;}

  .qs-you b{color:var(--jgold-lt);font-size:22px;font-variant-numeric:tabular-nums;}
  @keyframes qs-score-pop{0%{transform:scale(1)}30%{transform:scale(1.38);color:#fff;}100%{transform:scale(1)}}
  @keyframes qs-score-pop-bad{0%{transform:scale(1)}30%{transform:scale(1.3);color:#ff8a9c;}100%{transform:scale(1)}}
  .qs-you b.qs-pop{animation:qs-score-pop .5s ease;}
  .qs-you b.qs-pop-bad{animation:qs-score-pop-bad .5s ease;}

  /* overclock toast — the visual half of SFX.overclock() */
  .qs-overclock-toast{position:absolute;top:16%;left:50%;transform:translate(-50%,-10px) scale(.82);z-index:6;
    font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-weight:800;font-size:26px;letter-spacing:1.5px;
    text-transform:uppercase;color:var(--jgold-lt);text-shadow:2px 3px 0 #06104f,0 0 20px rgba(255,215,106,.75);
    background:rgba(6,16,80,.88);border:2px solid var(--jgold);border-radius:12px;padding:9px 22px;
    opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;white-space:nowrap;}
  .qs-overclock-toast.show{opacity:1;transform:translate(-50%,0) scale(1);}
  .qs-overclock-toast.fade{opacity:0;transform:translate(-50%,-16px) scale(.92);transition:opacity .5s ease,transform .5s ease;}
  .qs-oc{flex:1;text-align:right;font-size:9px;letter-spacing:1.5px;color:#8896d8;text-transform:uppercase;}
  .qs-oc b{display:inline;color:#7f8cc8;font-size:14px;margin-left:6px;}
  .qs-oc.hot b{color:var(--jgold-lt);}
  .qs-ocbar{height:5px;border-radius:3px;background:rgba(255,255,255,.12);margin:3px auto;overflow:hidden;}
  .qs-ocbar i{display:block;height:100%;background:linear-gradient(90deg,#ffd76a,#e08a2a);transition:width .3s;}

  /* board */
  .qs-cats{display:grid;grid-template-columns:repeat(var(--qs-cols,4),1fr);gap:6px;}
  @keyframes qs-tile-in{from{opacity:0;transform:translateY(9px) scale(.95);}to{opacity:1;transform:translateY(0) scale(1);}}
  .qs-cat{background-color:var(--jblue);background-image:linear-gradient(180deg,var(--cat-tint,transparent),transparent 75%);
    border:1px solid #06104f;box-shadow:inset 0 3px 0 var(--cat-accent,transparent);border-radius:4px;padding:10px 6px;text-align:center;
    font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-weight:700;font-size:13px;line-height:1.15;letter-spacing:.3px;
    text-transform:uppercase;min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;
    color:#fff;text-shadow:1px 1px 0 #05093a;opacity:0;animation:qs-tile-in .32s ease both;}
  .qs-icon{font-size:19px;display:block;margin-bottom:3px;}
  .qs-grid{display:grid;grid-template-columns:repeat(var(--qs-cols,4),1fr);grid-auto-rows:1fr;gap:6px;}
  .qs-tile{aspect-ratio:16/9;border:none;border-radius:4px;cursor:pointer;
    font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-weight:700;font-size:30px;letter-spacing:.5px;
    color:var(--jgold);background-color:var(--jblue);background-image:linear-gradient(180deg,var(--cat-tint,transparent),transparent 60%);
    box-shadow:inset 0 0 0 1px #06104f,inset 0 3px 0 var(--cat-accent,transparent);
    text-shadow:2px 2px 0 #05093a,3px 3px 4px rgba(0,0,0,.5);transition:transform .1s,filter .12s;
    opacity:0;animation:qs-tile-in .32s ease both;}
  .qs-tile:hover{transform:scale(1.05);filter:brightness(1.15);color:var(--jgold-lt);z-index:1;}
  .qs-tile.done{color:transparent;background-color:#05093a;background-image:none;cursor:default;
    box-shadow:inset 0 0 0 1px #101a5a;text-shadow:none;}
  .qs-hint{text-align:center;color:#9fb0e8;font-size:12.5px;}

  /* commitment */
  .qs-commit{text-align:center;align-items:center;}
  .qs-commit-badge,.qs-final-badge{align-self:center;background:linear-gradient(180deg,#ffd76a,#e08a2a);color:#231402;
    font-family:'Oswald',Arial,sans-serif;font-weight:700;font-size:14px;letter-spacing:2px;padding:7px 18px;border-radius:20px;text-transform:uppercase;}
  .qs-commit h2{margin:4px 0;font-size:26px;}
  .qs-commit p{color:#bcc8ff;margin:0;max-width:440px;}
  .qs-wagers{display:flex;gap:10px;justify-content:center;margin:6px 0;}
  .qs-wager{display:flex;flex-direction:column;align-items:center;min-width:96px;font-size:24px;}
  .qs-wager small{font-size:12px;font-weight:600;opacity:.85;margin-top:2px;}

  /* clue */
  .qs-cluehead{display:flex;align-items:center;justify-content:space-between;}
  .qs-clue-cat{font-family:'Oswald',Arial,sans-serif;font-weight:700;font-size:15px;letter-spacing:.5px;color:var(--jgold-lt);text-transform:uppercase;}
  .qs-payout{font-family:'Oswald',Arial,sans-serif;font-weight:700;font-size:24px;color:var(--jgold-lt);font-variant-numeric:tabular-nums;}
  .qs-timer{height:10px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;}
  .qs-timer i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#f5cd63,#d9a441);transition:width .08s linear;}
  .qs-timer i.warn{background:linear-gradient(90deg,#ffd76a,#ff9a3d);}
  @keyframes qs-timer-pulse{0%,100%{opacity:1;transform:scaleY(1);}50%{opacity:.5;transform:scaleY(1.7);}}
  .qs-timer i.danger{background:linear-gradient(90deg,#ff8a5a,#ff5d6c);animation:qs-timer-pulse 1s ease-in-out infinite;transform-origin:center;}
  /* The clue itself — white caps on Jeopardy blue, the signature look. */
  .qs-q{background:var(--jblue);border:2px solid #22308f;border-radius:8px;padding:26px 22px;font-size:21px;
    font-weight:700;line-height:1.32;text-align:center;min-height:70px;text-transform:uppercase;letter-spacing:.4px;
    color:#fff;text-shadow:1px 2px 0 #05093a;display:flex;align-items:center;justify-content:center;
    box-shadow:0 10px 26px rgba(0,0,0,.5);}
  .qs-answers{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .qs-ans{cursor:pointer;border:2px solid #2a3aa8;background:var(--jblue-d);color:#fff;border-radius:7px;
    padding:15px 14px;font:700 15px 'Helvetica Neue',Arial,sans-serif;text-align:center;transition:transform .08s,background .12s,border-color .12s;}
  .qs-ans:hover:not(:disabled){background:#1024d8;border-color:var(--jgold);transform:translateY(-1px);}
  .qs-ans:disabled{cursor:default;opacity:.85;}
  .qs-ans.right{background:linear-gradient(180deg,#1f9a55,#137a3d);border-color:#3fd98a;color:#fff;opacity:1;}
  .qs-ans.wrong{background:linear-gradient(180deg,#c23247,#8a1f2c);border-color:#ff5d6c;color:#fff;opacity:1;}
  .qs-feedback{min-height:24px;text-align:center;font-size:14.5px;font-weight:700;}
  .qs-feedback .ok{color:var(--jgold-lt);}
  .qs-feedback .bad{color:#ff8a9c;}
  .qs-why{margin-top:6px;font-size:12.5px;font-weight:500;color:#aebbee;line-height:1.4;}

  /* final */
  .qs-final{text-align:center;align-items:center;}
  .qs-final p{color:#bcc8ff;margin:2px 0;max-width:460px;}
  .qs-final-cats{display:flex;flex-direction:column;gap:10px;width:100%;max-width:420px;}
  .qs-fcat{font-size:17px;}
  .qs-wageramt{font-family:'Oswald',Arial,sans-serif;font-size:46px;font-weight:700;color:var(--jgold-lt);font-variant-numeric:tabular-nums;}
  .qs-slider{width:100%;max-width:440px;accent-color:var(--jgold);height:6px;}
  .qs-wagerquick{display:flex;gap:8px;}
  .qs-lockwager{margin-top:4px;}

  /* result */
  .qs-result{text-align:center;align-items:center;gap:18px;}
  .qs-result-verdict{font-family:'Oswald',Arial,sans-serif;font-size:34px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}
  .qs-result-verdict.win{color:var(--jgold-lt);text-shadow:2px 2px 0 #06104f;}
  .qs-result-verdict.lose{color:#ff8a9c;}
  .qs-result-scores{display:flex;align-items:center;gap:22px;}
  .qs-result-scores>div{display:flex;flex-direction:column;}
  .qs-result-scores span{font-size:11px;letter-spacing:1.5px;color:#8896d8;text-transform:uppercase;}
  .qs-result-scores .you b{font-family:'Oswald',Arial,sans-serif;font-size:40px;color:var(--jgold-lt);}
  .qs-result-scores .qs-lifetime{display:block;margin-top:2px;font-size:12px;font-weight:600;letter-spacing:.2px;
    text-transform:none;color:#8fa0dc;}
  .qs-result-meta{color:#bcc8ff;font-size:14px;}
  .qs-result-meta b{color:var(--jgold-lt);}
  .qs-newbest{color:var(--jgold-lt);font-weight:800;margin-top:6px;}
  .qs-result-btns{display:flex;gap:12px;}

  @media(max-width:560px){
    .qs-menu h1{font-size:42px;}
    .qs-answers{grid-template-columns:1fr;}
    .qs-cat{font-size:11px;min-height:48px;}
    .qs-tile{font-size:20px;}
    .qs-result-scores{gap:12px;}
  }`;

  global.QuizShow = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
