/* ============================================================================
 * CostBot Arcade — SHARED SOUNDTRACK ENGINE
 * ----------------------------------------------------------------------------
 * A procedural sequencer shared by every game in the arcade. No audio files:
 * every kick, hat, bass note and lead line is synthesised in WebAudio at
 * runtime, so a game only has to include this one script.
 *
 * Any arcade game can use it:
 *   <script src="../shared/arcade-music.js"></script>
 *   const music = ArcadeMusic.create(() => ({ ctx, master }));
 *   music.setTheme('overworld');
 *   music.setState('stage');
 *
 * All melodies here are ORIGINAL compositions written in the *style* of their
 * stated influence (tempo, key, rhythm, instrumentation, harmonic language).
 * None of them quote or transcribe the referenced works.
 *
 * TRACKS  — individual arrangements you can audition (see music-test.html)
 * THEMES  — maps a theme name to which track plays for menu / stage / boss
 *
 *   const music = WHMusic.create(() => audio.nodes());   // {ctx, master}
 *   music.setTheme('airbuster');
 *   music.setState('stage');      // resolves through the theme
 *   music.playTrack('overworld'); // audition one directly
 * ==========================================================================*/
((global) => {
  'use strict';

  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  const STEPS_PER_BAR = 16;   // 16th notes
  const BARS = 4;
  const DEFAULT_BARS = BARS;   // a track may override with `bars`
  const _ = null;

  // ===========================================================================
  // CHORD LOOPS  (root midi + semitone offsets)
  // ===========================================================================
  const P = {
    aeolian:  [{ root: 45, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] },
               { root: 48, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] }],   // Am F C G
    dorianBoss:[{ root: 38, tones: [0, 3, 7] }, { root: 46, tones: [0, 4, 7] },
               { root: 43, tones: [0, 3, 7] }, { root: 45, tones: [0, 4, 7] }],   // Dm Bb Gm A
    industrial:[{ root: 40, tones: [0, 3, 7] }, { root: 36, tones: [0, 4, 7] },
               { root: 38, tones: [0, 4, 7] }, { root: 35, tones: [0, 4, 7] }],   // Em C D B
    heroic:   [{ root: 48, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },
               { root: 45, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] }],   // C G Am F
    anthem:   [{ root: 38, tones: [0, 4, 7] }, { root: 45, tones: [0, 4, 7] },
               { root: 47, tones: [0, 3, 7] }, { root: 43, tones: [0, 4, 7] }],   // D A Bm G
    // 8 bars: Em Bm A G | Em C D B — the second half lifts, so the loop has shape
    downhill: [{ root: 40, tones: [0, 3, 7] }, { root: 47, tones: [0, 3, 7] },
               { root: 45, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },
               { root: 40, tones: [0, 3, 7] }, { root: 36, tones: [0, 4, 7] },
               { root: 38, tones: [0, 4, 7] }, { root: 35, tones: [0, 4, 7] }],
    chamber:  [{ root: 38, tones: [0, 3, 7, 10, 14] },   // Dm9
               { root: 34, tones: [0, 4, 7, 11] },       // Bbmaj7
               { root: 31, tones: [0, 3, 7, 10] },       // Gm7
               { root: 33, tones: [0, 4, 7, 10] }],      // A7
  };

  // ===========================================================================
  // LEAD LINES  (one slot per 16th step; 64 steps = 4 bars)
  // ===========================================================================
  const L = {
    stage: [
      76, _, _, 72, _, 74, _, _, 72, _, 69, _, _, _, 67, _,
      69, _, _, 72, _, 69, _, _, 65, _, _, _, 67, _, _, _,
      72, _, 76, _, 79, _, 76, _, 72, _, _, _, _, _, 74, _,
      74, _, _, 71, _, 74, _, 79, 78, _, _, _, _, _, _, _,
    ],
    boss: [
      74, _, 75, _, 74, _, 70, _, 74, _, _, 77, _, 76, _, _,
      70, _, 71, _, 70, _, 65, _, 70, _, _, 74, _, 73, _, _,
      67, _, 68, _, 67, _, 62, _, 67, _, _, 70, _, 69, _, _,
      69, _, 70, _, 69, _, 73, _, 76, _, _, _, 78, _, 80, _,
    ],
    // Driving industrial boss riff, E minor with a flat-5 blue note.
    industrial: [
      64, _, 67, _, 64, _, _, 71, 69, _, 67, _, 64, _, 70, _,
      60, _, 64, _, 67, _, _, 64, 62, _, 60, _, 64, _, _, _,
      62, _, 66, _, 69, _, _, 66, 64, _, 62, _, 66, _, _, _,
      59, _, 63, _, 66, _, _, 71, 70, _, 69, _, 66, _, 63, _,
    ],
    // Bright heroic march, C major, dotted leaps.
    heroic: [
      72, _, _, _, 76, _, 79, _, 84, _, _, 79, 76, _, _, _,
      74, _, _, _, 78, _, 81, _, 86, _, _, 81, 78, _, _, _,
      72, _, 76, _, 81, _, _, 79, 76, _, 72, _, _, _, 74, _,
      77, _, _, 74, 72, _, _, _, 74, _, 76, _, 79, _, _, _,
    ],
    // Anthemic arena melody, D major, syncopated and singable.
    anthem: [
      78, _, _, 81, _, 83, _, _, 81, _, 78, _, 74, _, _, _,
      76, _, _, 78, _, 81, _, _, 78, _, 76, _, 73, _, _, _,
      74, _, 78, _, 81, _, 83, _, 81, _, _, 78, _, _, _, _,
      79, _, _, 76, _, 74, _, _, 78, _, _, _, 81, _, _, _,
    ],
    // Relentless 16th runner line — meant to be felt more than followed.
    mudslide: [
      // bars 1-4 — the hook
      76, _, 79, _, 83, _, 79, _, 76, _, 83, _, 79, _, 76, _,
      74, _, 78, _, 81, _, 78, _, 74, _, 81, _, 78, _, 74, _,
      73, _, 76, _, 81, _, 76, _, 73, _, 81, _, 76, _, 73, _,
      71, _, 74, _, 79, _, 74, _, 78, _, 79, _, 81, _, 83, _,
      // bars 5-8 — answer it an octave up, then fall back down
      88, _, _, 86, _, 83, _, _, 88, _, _, 91, _, 88, _, 83,
      84, _, _, 81, _, 79, _, _, 84, _, _, 88, _, 84, _, 79,
      86, _, 83, _, 79, _, 76, _, 74, _, 76, _, 79, _, 83, _,
      83, _, 82, _, 79, _, 78, _, 76, _, 74, _, 71, _, 67, _,
    ],
    // Sparse, wistful chamber melody over extended minor harmony.
    chamber: [
      74, _, _, 77, _, 81, _, _, 79, _, 77, _, 74, _, _, _,
      77, _, _, 81, _, 84, _, _, 82, _, 79, _, 77, _, 74, _,
      70, _, _, 74, _, 77, _, _, 81, _, 79, _, 76, _, _, _,
      76, _, _, 72, _, 69, _, 72, 74, _, _, _, 77, _, _, _,
    ],
  };

  // ===========================================================================
  // TRACKS
  //   drums: 'four' | 'double' | 'march' | 'rock' | 'chamber' | 'break' | false
  //   voices: which synth is used for lead / pad
  // ===========================================================================
  const TRACKS = {
    menu: {
      title: 'Menu', influence: 'Synthwave', bpm: 96, key: 'A minor',
      desc: 'Pads and a sparse arp, no drums. Title and result screens.',
      prog: P.aeolian, lead: null, drums: false, pad: 'saw',
      arpEvery: 4, bassEvery: 0, gain: 0.55, voices: {},
    },
    stage: {
      title: 'Stage', influence: 'Synthwave', bpm: 128, key: 'A minor',
      desc: 'Four-on-the-floor, sub bass, 16th arp, lead through a dotted-eighth delay.',
      prog: P.aeolian, lead: L.stage, drums: 'four', pad: 'saw',
      arpEvery: 2, bassEvery: 2, gain: 0.85, voices: { lead: 'saw' },
    },
    boss: {
      title: 'Boss', influence: 'Synthwave', bpm: 150, key: 'D minor',
      desc: 'Double kick, 16th hats, chromatic menace line.',
      prog: P.dorianBoss, lead: L.boss, drums: 'double', pad: 'saw',
      arpEvery: 1, bassEvery: 1, gain: 1.0, voices: { lead: 'saw' },
    },

    // ---- influenced by the FF7 "Airbuster" boss fight ----------------------
    airbuster: {
      title: 'Scrap Titan', influence: 'FF7 · Airbuster', bpm: 158, key: 'E minor',
      desc: 'Industrial boss rock. Distorted lead, 16th bass gallop, double kick, power chords.',
      prog: P.industrial, lead: L.industrial, drums: 'double', pad: 'power',
      arpEvery: 0, bassEvery: 1, gain: 1.0, voices: { lead: 'dist' },
    },

    // ---- influenced by Zelda overworld themes -------------------------------
    overworld: {
      title: 'Ledger Fields', influence: 'Zelda · Overworld', bpm: 124, key: 'C major',
      desc: 'Heroic adventure march. Brass lead, harp arpeggios, snare on the backbeat.',
      prog: P.heroic, lead: L.heroic, drums: 'march', pad: 'strings',
      arpEvery: 2, bassEvery: 4, gain: 0.9, voices: { lead: 'brass' },
    },

    // ---- influenced by Guile's Theme ---------------------------------------
    sonicboom: {
      title: 'Invoice Boom', influence: "Street Fighter · Guile's Theme", bpm: 138, key: 'D major',
      desc: '80s arena anthem. Big singable lead over power chords and a rock backbeat.',
      prog: P.anthem, lead: L.anthem, drums: 'rock', pad: 'power',
      arpEvery: 4, bassEvery: 2, gain: 0.95, voices: { lead: 'brass' },
    },

    // ---- endless-runner drive for Mudsliders --------------------------------
    mudslide: {
      title: 'Mudslide', influence: 'Breakbeat runner', bpm: 174, key: 'E minor',
      desc: '8-bar loop: relentless 16ths, breakbeat kit, distorted lead that answers itself an octave up.',
      prog: P.downhill, lead: L.mudslide, drums: 'break', pad: 'power', bars: 8,
      arpEvery: 1, bassEvery: 1, gain: 1.0, voices: { lead: 'dist' },
    },

    // ---- influenced by Clair Obscur: Expedition 33 --------------------------
    expedition: {
      title: 'Depreciation', influence: 'Clair Obscur · Expedition 33', bpm: 108, key: 'D minor 9',
      desc: 'French chamber drive. Rolling 16th piano over extended harmony, strings, soft pulse.',
      prog: P.chamber, lead: L.chamber, drums: 'chamber', pad: 'strings',
      arpEvery: 1, bassEvery: 4, gain: 0.78, voices: { lead: 'piano', arp: 'piano' },
    },
  };

  // Which track plays in which situation, per theme.
  // `biome` names an entry in WH_CONTENT.BIOMES, so picking a theme changes the
  // arena's look as well as its soundtrack.
  const THEMES = {
    synthwave:  { label: 'Synthwave',     biome: 'datacenter',
                  menu: 'menu',       stage: 'stage',      boss: 'boss' },
    airbuster:  { label: 'Scrap Foundry', biome: 'foundry',
                  menu: 'menu',       stage: 'airbuster',  boss: 'airbuster' },
    overworld:  { label: 'Ledger Fields', biome: 'field',
                  menu: 'expedition', stage: 'overworld',  boss: 'airbuster' },
    sonicboom:  { label: 'Invoice Boom',  biome: 'arena',
                  menu: 'menu',       stage: 'sonicboom',  boss: 'airbuster' },
    mudslide:   { label: 'Mudslide',      biome: 'foundry',
                  menu: 'menu',       stage: 'mudslide',   boss: 'airbuster' },
    expedition: { label: 'Depreciation',  biome: 'dusk',
                  menu: 'expedition', stage: 'expedition', boss: 'boss' },
  };

  function create(getNodes) {
    let ctx = null, out = null, delay = null, shaper = null;
    let timer = null, playing = false;
    let state = 'silent', trackName = 'stage', pending = null, pendingFast = false;
    let step = 0, nextTime = 0, cfg = TRACKS.stage;
    let volume = 0.5, theme = 'synthwave';

    function distCurve(amount) {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        c[i] = Math.tanh(x * amount);
      }
      return c;
    }

    function build() {
      const n = getNodes && getNodes();
      if (!n || !n.ctx) return false;
      if (ctx === n.ctx && out) return true;
      ctx = n.ctx;
      out = ctx.createGain();
      out.gain.value = volume;
      out.connect(n.master);

      shaper = ctx.createWaveShaper();
      shaper.curve = distCurve(9);
      shaper.oversample = '2x';
      const shGain = ctx.createGain(); shGain.gain.value = 0.5;
      shaper.connect(shGain); shGain.connect(out);

      delay = ctx.createDelay(1.0);
      const fb = ctx.createGain(); fb.gain.value = 0.34;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      const dg = ctx.createGain(); dg.gain.value = 0.32;
      delay.connect(lp); lp.connect(fb); fb.connect(delay);
      delay.connect(dg); dg.connect(out);
      return true;
    }

    // ---- helpers ------------------------------------------------------------
    function env(g, t, a, d, peak) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function noiseBuf(dur) {
      const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      return b;
    }

    // ---- percussion ---------------------------------------------------------
    function kick(t, hard) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(hard ? 185 : 150, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
      env(g, t, 0.004, hard ? 0.26 : 0.2, hard ? 1.0 : 0.85);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.34);
    }
    function snare(t, soft) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(0.18);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1300;
      const g = ctx.createGain(); env(g, t, 0.003, 0.15, soft ? 0.16 : 0.42);
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
      env(og, t, 0.003, 0.09, soft ? 0.09 : 0.22);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.14);
    }
    function hat(t, open, accent) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(open ? 0.13 : 0.035);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7600;
      const g = ctx.createGain();
      env(g, t, 0.002, open ? 0.12 : 0.03, accent ? 0.20 : 0.11);
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
    }
    function crash(t) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(0.9);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5200;
      const g = ctx.createGain(); env(g, t, 0.004, 0.85, 0.20);
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
    }

    // ---- tonal voices -------------------------------------------------------
    function bass(t, midi, dur) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(760, t);
      f.frequency.exponentialRampToValueAtTime(190, t + Math.max(0.05, dur * 0.9));
      f.Q.value = 7;
      const g = ctx.createGain(); env(g, t, 0.006, dur, 0.30);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi);
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = mtof(midi - 12);
      const sg = ctx.createGain(); sg.gain.value = 0.55;
      o.connect(f); sub.connect(sg); sg.connect(f); f.connect(g); g.connect(out);
      o.start(t); sub.start(t); o.stop(t + dur + 0.1); sub.stop(t + dur + 0.1);
    }
    function arpNote(t, midi, voice) {
      if (voice === 'piano') return piano(t, midi, 0.7, 0.055);
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(midi);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2700;
      const g = ctx.createGain(); env(g, t, 0.004, 0.11, 0.085);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    }
    function leadSaw(t, midi, dur) {
      const g = ctx.createGain(); env(g, t, 0.012, dur, 0.13);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(3400, t);
      f.frequency.exponentialRampToValueAtTime(1500, t + dur);
      [-7, 7].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = cents;
        o.connect(f); o.start(t); o.stop(t + dur + 0.12);
      });
      f.connect(g); g.connect(out); g.connect(delay);
    }
    function leadDist(t, midi, dur) {
      const g = ctx.createGain(); env(g, t, 0.006, dur, 0.16);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2800; f.Q.value = 2;
      [-11, 0, 11].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = cents;
        o.connect(f); o.start(t); o.stop(t + dur + 0.1);
      });
      f.connect(g); g.connect(shaper); g.connect(delay);
    }
    function leadBrass(t, midi, dur) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.05);      // slower brass attack
      g.gain.setValueAtTime(0.15, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.linearRampToValueAtTime(2900, t + 0.09);
      f.Q.value = 3;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = mtof(midi);
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = mtof(midi);
      o2.detune.value = 6;
      const o2g = ctx.createGain(); o2g.gain.value = 0.4;
      o1.connect(f); o2.connect(o2g); o2g.connect(f); f.connect(g); g.connect(out); g.connect(delay);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
    function piano(t, midi, dur, peak) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak || 0.11, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
      const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = mtof(midi);
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(midi + 12);
      const o2g = ctx.createGain(); o2g.gain.value = 0.28;
      o1.connect(f); o2.connect(o2g); o2g.connect(f); f.connect(g); g.connect(out); g.connect(delay);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
    function padChord(t, chord, dur, kind) {
      if (kind === 'power') return powerChord(t, chord, dur);
      const g = ctx.createGain();
      const peak = kind === 'strings' ? 0.065 : 0.05;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + dur * (kind === 'strings' ? 0.5 : 0.35));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.value = kind === 'strings' ? 1500 : 950;
      const spread = kind === 'strings' ? [-9, -3, 3, 9] : [-5, 5];
      chord.tones.forEach((s) => {
        spread.forEach((cents) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = mtof(chord.root + s + 12); o.detune.value = cents;
          o.connect(f); o.start(t); o.stop(t + dur + 0.2);
        });
      });
      f.connect(g); g.connect(out);
    }
    function powerChord(t, chord, dur) {
      const g = ctx.createGain(); env(g, t, 0.01, dur * 0.9, 0.11);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      [0, 7, 12].forEach((s) => {
        [-8, 8].forEach((cents) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = mtof(chord.root + s + 12); o.detune.value = cents;
          o.connect(f); o.start(t); o.stop(t + dur + 0.1);
        });
      });
      f.connect(g); g.connect(shaper);
    }

    const LEADS = { saw: leadSaw, dist: leadDist, brass: leadBrass,
                    piano: (t, m, d) => piano(t, m, d) };

    // ---- sequencer ----------------------------------------------------------
    function playStep(i, t) {
      const bar = Math.floor(i / STEPS_PER_BAR);
      const inBar = i % STEPS_PER_BAR;
      const chord = cfg.prog[bar % cfg.prog.length];
      const stepDur = 60 / cfg.bpm / 4;
      const v = cfg.voices || {};

      if (cfg.pad && inBar === 0) padChord(t, chord, stepDur * STEPS_PER_BAR * 0.98, cfg.pad);

      switch (cfg.drums) {
        case 'four':
          if (inBar % 4 === 0) kick(t, false);
          if (inBar === 14) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t);
          if (inBar % 2 === 0) hat(t, inBar === 10, inBar % 4 === 0);
          break;
        case 'double':
          if (inBar % 4 === 0) kick(t, true);
          if (inBar === 6 || inBar === 14) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t);
          hat(t, false, inBar % 4 === 0);
          if (bar === 0 && inBar === 0) crash(t);
          break;
        case 'march':
          if (inBar === 0 || inBar === 8) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t);
          if (inBar === 3 || inBar === 11) snare(t, true);   // flam pickup
          if (bar === 0 && inBar === 0) crash(t);
          break;
        case 'break':
          if (inBar === 0 || inBar === 10) kick(t, true);
          if (inBar === 6) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t);
          if (inBar === 7 || inBar === 15) snare(t, true);   // ghost notes
          hat(t, inBar === 14, inBar % 4 === 0);
          if (bar === 0 && inBar === 0) crash(t);
          break;
        case 'chamber':
          if (inBar === 0 || inBar === 8) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t, true);
          break;
        case 'rock':
          if (inBar === 0 || inBar === 8 || inBar === 11) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t);
          if (inBar % 2 === 0) hat(t, inBar === 14, inBar % 4 === 0);
          if (bar === 0 && inBar === 0) crash(t);
          break;
        default: break;
      }

      if (cfg.bassEvery && i % cfg.bassEvery === 0) {
        const oct = (inBar % 8 === 4) ? 12 : 0;
        bass(t, chord.root + oct, stepDur * cfg.bassEvery * 0.92);
      }

      if (cfg.arpEvery && i % cfg.arpEvery === 0) {
        const seq = chord.tones;
        const idx = Math.floor(i / cfg.arpEvery);
        const tone = seq[idx % seq.length];
        const oct = 24 + (Math.floor(idx / seq.length) % 2) * 12;
        arpNote(t, chord.root + tone + oct, v.arp);
      }

      if (cfg.lead) {
        const n = cfg.lead[i % cfg.lead.length];
        if (n != null) (LEADS[v.lead] || leadSaw)(t, n, stepDur * (cfg.drums ? 3 : 6));
      }
    }

    function tick() {
      if (!playing || !ctx) return;
      while (nextTime < ctx.currentTime + 0.15) {
        // boss entrances land on the next beat; everything else waits for the bar
        const quant = pendingFast ? 4 : STEPS_PER_BAR;
        if (pending && step % quant === 0) {
          const nextTrack = pending; pending = null; pendingFast = false;
          if (nextTrack === 'silent') { stopNow(); return; }
          trackName = nextTrack;
          cfg = TRACKS[trackName] || TRACKS.stage;
          if (out) out.gain.setTargetAtTime(volume * cfg.gain, ctx.currentTime, 0.15);
          step = 0;
        }
        try { playStep(step, nextTime); } catch { /* never let audio kill the frame */ }
        nextTime += 60 / cfg.bpm / 4;
        step = (step + 1) % ((cfg.bars || DEFAULT_BARS) * STEPS_PER_BAR);
      }
      timer = setTimeout(tick, 25);
    }

    function stopNow() {
      playing = false;
      if (timer) { clearTimeout(timer); timer = null; }
      if (out && ctx) out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
    }

    function start(track) {
      if (!build()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!playing) {
        trackName = track;
        cfg = TRACKS[track] || TRACKS.stage;
        out.gain.setValueAtTime(0.0001, ctx.currentTime);
        out.gain.setTargetAtTime(volume * cfg.gain, ctx.currentTime, 0.4);
        step = 0;
        nextTime = ctx.currentTime + 0.08;
        playing = true;
        tick();
      } else if (track !== trackName) {
        pending = track;     // swaps on the next musical boundary
      }
    }

    return {
      get state() { return state; },
      get track() { return trackName; },
      get theme() { return theme; },
      debug() {
        return { state, track: trackName, pending, playing, step, timer: !!timer,
                 nextTime: +nextTime.toFixed(2),
                 ctxTime: ctx ? +ctx.currentTime.toFixed(2) : null,
                 ctxState: ctx ? ctx.state : null };
      },
      setTheme(name) {
        if (!THEMES[name]) return;
        theme = name;
        if (state !== 'silent') this.setState(state);   // re-resolve current slot
      },
      // slot is 'menu' | 'stage' | 'boss'
      setState(slot) {
        if (slot === 'silent') {
          state = 'silent'; pending = null; pendingFast = false;
          if (playing) stopNow();
          return;
        }
        const map = THEMES[theme] || THEMES.synthwave;
        const track = map[slot] || slot;
        state = slot;
        if (!playing) { start(track); return; }
        if (track !== trackName) { pending = track; pendingFast = (slot === 'boss'); }
      },
      // audition a specific arrangement, ignoring the theme map
      playTrack(name) {
        if (!TRACKS[name]) return;
        state = 'custom';
        if (!playing) { start(name); return; }
        if (name !== trackName) { pending = name; pendingFast = true; }
      },
      setVolume(v) {
        volume = Math.max(0, Math.min(1, v));
        if (out && ctx) out.gain.setTargetAtTime(volume * cfg.gain, ctx.currentTime, 0.1);
      },
      stop() { state = 'silent'; pending = null; pendingFast = false; stopNow(); },
    };
  }

  global.ArcadeMusic = { create, TRACKS, THEMES };
  global.WHMusic = global.ArcadeMusic;   // legacy alias for Waste Hunter
})(typeof window !== 'undefined' ? window : globalThis);
