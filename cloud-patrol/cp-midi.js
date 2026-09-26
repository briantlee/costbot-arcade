/* ============================================================================
 * CostBot: Cloud Patrol — a tiny MIDI player
 * ----------------------------------------------------------------------------
 * Plays a Standard MIDI File through WebAudio: every channel gets a small synth
 * voice picked from its General MIDI program, channel 10 gets a synthesized kit.
 * No samples and no dependencies — it is the same oscillators-and-filters sound
 * as the rest of the arcade, just reading a real arrangement instead of a chart.
 *
 * It speaks the slice of the ArcadeMusic API the cabinet uses, so it drops in:
 *   const music = createMidiMusic(() => audio.nodes(), url);
 *   music.setState('stage'); music.setVolume(0.4); music.stop();
 * 'silent' stops; any other slot plays (the song is the whole soundtrack).
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// SMF parser → [{ t, dur, note, vel, ch }] in seconds, tempo map applied
// ---------------------------------------------------------------------------
export function parseMidi(buf) {
  const b = new DataView(buf);
  let p = 0;
  const u32 = () => { const v = b.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = b.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0, c; do { c = b.getUint8(p++); v = (v << 7) | (c & 127); } while (c & 128); return v; };
  if (u32() !== 0x4d546864) throw new Error('not a MIDI file');
  u32(); u16();
  const ntracks = u16(), div = u16();
  const events = [];      // { tick, kind, ... } across all tracks
  for (let tr = 0; tr < ntracks; tr++) {
    if (u32() !== 0x4d54726b) throw new Error('bad track chunk');
    const end = u32() + p;
    let tick = 0, run = 0;
    while (p < end) {
      tick += vlq();
      let st = b.getUint8(p);
      if (st & 0x80) p++; else st = run;
      if (st === 0xff) {
        const ty = b.getUint8(p++), len = vlq();
        if (ty === 0x51) events.push({ tick, kind: 'tempo', us: (b.getUint8(p) << 16) | (b.getUint8(p + 1) << 8) | b.getUint8(p + 2) });
        p += len;
      } else if (st === 0xf0 || st === 0xf7) {
        p += vlq();
      } else {
        run = st;
        const hi = st >> 4, ch = st & 15;
        const d1 = b.getUint8(p++);
        const d2 = hi === 0xc || hi === 0xd ? 0 : b.getUint8(p++);
        if (hi === 0x9 && d2 > 0) events.push({ tick, kind: 'on', ch, note: d1, vel: d2 });
        else if (hi === 0x8 || (hi === 0x9 && d2 === 0)) events.push({ tick, kind: 'off', ch, note: d1 });
        else if (hi === 0xc) events.push({ tick, kind: 'prog', ch, prog: d1 });
      }
    }
    p = end;
  }
  events.sort((a, c) => a.tick - c.tick || (a.kind === 'tempo' ? -1 : 0));
  // ticks → seconds through the tempo map
  let us = 500000, lastTick = 0, sec = 0;
  const programs = {};
  const open = new Map();
  const notes = [];
  for (const e of events) {
    sec += ((e.tick - lastTick) * us) / div / 1e6;
    lastTick = e.tick;
    if (e.kind === 'tempo') us = e.us;
    else if (e.kind === 'prog') programs[e.ch] = e.prog;
    else if (e.kind === 'on') {
      const k = e.ch * 128 + e.note;
      if (open.has(k)) { const n = open.get(k); n.dur = Math.max(0.02, sec - n.t); }
      const n = { t: sec, dur: 0.25, note: e.note, vel: e.vel / 127, ch: e.ch };
      open.set(k, n); notes.push(n);
    } else if (e.kind === 'off') {
      const k = e.ch * 128 + e.note, n = open.get(k);
      if (n) { n.dur = Math.max(0.02, sec - n.t); open.delete(k); }
    }
  }
  const length = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  return { notes, programs, length };
}

// ---------------------------------------------------------------------------
// voices: a General MIDI program family → a little synth patch
// ---------------------------------------------------------------------------
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
function patchFor(prog) {
  if (prog >= 32 && prog <= 39) return { wave: 'sawtooth', cut: 900, a: 0.005, r: 0.08, gain: 0.16, oct: 0 };           // bass
  if (prog >= 40 && prog <= 51) return { wave: 'sawtooth', cut: 2600, a: 0.05, r: 0.22, gain: 0.05, detune: 9 };          // strings / ensemble
  if (prog >= 56 && prog <= 63) return { wave: 'sawtooth', cut: 2200, a: 0.02, r: 0.12, gain: 0.07, sweep: true };        // brass
  if (prog === 80) return { wave: 'square', cut: 5000, a: 0.004, r: 0.06, gain: 0.06, vib: true };                        // square lead
  if (prog >= 81 && prog <= 87) return { wave: 'sawtooth', cut: 3800, a: 0.004, r: 0.07, gain: 0.06, vib: true };         // saw leads
  if (prog >= 88 && prog <= 95) return { wave: 'triangle', cut: 3000, a: 0.12, r: 0.4, gain: 0.07, detune: 5 };           // pads
  return { wave: 'triangle', cut: 3000, a: 0.01, r: 0.12, gain: 0.07 };
}

export function createMidiMusic(getNodes, url) {
  let song = null, loading = null, playing = false, volume = 0.5;
  let out = null, noiseBuf = null, startAt = 0, cursor = 0, timer = null, state = 'silent';

  const build = () => {
    const n = getNodes && getNodes();
    if (!n) return null;
    if (!out) {
      out = n.ctx.createGain();
      out.gain.value = volume;
      // a touch of glue: gentle low-pass so the stacked saws don't fizz
      const lp = n.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
      out.connect(lp).connect(n.master);
      const len = n.ctx.sampleRate;
      noiseBuf = n.ctx.createBuffer(1, len, n.ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return n.ctx;
  };
  const load = () => {
    if (song || loading) return loading;
    loading = fetch(url).then((r) => r.arrayBuffer()).then((buf) => { song = parseMidi(buf); }).catch(() => { song = null; });
    return loading;
  };

  function tone(ctx, n, t, prog) {
    const pt = patchFor(prog);
    const end = t + Math.max(0.05, n.dur);
    const g = ctx.createGain();
    const peak = pt.gain * (0.45 + 0.55 * n.vel);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + pt.a);
    g.gain.setValueAtTime(peak * 0.85, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + pt.r);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(pt.sweep ? pt.cut * 0.35 : pt.cut, t);
    if (pt.sweep) f.frequency.linearRampToValueAtTime(pt.cut, t + 0.12);
    f.connect(g).connect(out);
    const oscs = pt.detune ? [-pt.detune, pt.detune] : [0];
    for (const cents of oscs) {
      const o = ctx.createOscillator(); o.type = pt.wave;
      o.frequency.value = hz(n.note);
      o.detune.value = cents;
      if (pt.vib && n.dur > 0.25) {
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(7, t + 0.25);
        lfo.connect(lg).connect(o.detune); lfo.start(t); lfo.stop(end + pt.r);
      }
      o.connect(f); o.start(t); o.stop(end + pt.r + 0.02);
    }
  }
  function drum(ctx, n, t) {
    const v = 0.5 + 0.5 * n.vel;
    const noise = (dur, type, freq, q, gain) => {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    };
    const thump = (f0, f1, dur, gain) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
    };
    const k = n.note;
    if (k === 35 || k === 36) thump(150, 42, 0.28, 0.9);                                        // kick
    else if (k === 38 || k === 40) { noise(0.18, 'bandpass', 1800, 0.8, 0.5); thump(210, 160, 0.08, 0.35); }   // snare
    else if (k === 42 || k === 44) noise(0.05, 'highpass', 7500, 0.7, 0.28);                      // closed hat
    else if (k === 46) noise(0.3, 'highpass', 7000, 0.7, 0.22);                                    // open hat
    else if (k === 49 || k === 57 || k === 52 || k === 55) noise(1.1, 'highpass', 5000, 0.5, 0.25); // crash
    else if (k === 51 || k === 53 || k === 59) noise(0.35, 'bandpass', 6500, 2, 0.14);             // ride
    else if (k >= 41 && k <= 50) thump(90 + (k - 41) * 22, 55 + (k - 41) * 12, 0.3, 0.6);          // toms
    else noise(0.04, 'bandpass', 3000, 1, 0.2);                                                     // everything else: a click
  }

  function tick() {
    const ctx = build();
    if (!ctx || !song || !playing) return;
    const ahead = ctx.currentTime + 0.25;
    // schedule every note whose start falls before the lookahead, looping the song
    for (;;) {
      if (cursor >= song.notes.length) { cursor = 0; startAt += song.length + 0.4; }
      const n = song.notes[cursor];
      const at = startAt + n.t;
      if (at > ahead) break;
      if (at >= ctx.currentTime - 0.05) {
        if (n.ch === 9) drum(ctx, n, at);
        else tone(ctx, n, at, song.programs[n.ch] ?? 0);
      }
      cursor += 1;
    }
  }
  function start() {
    const ctx = build();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    load().then(() => {
      if (!song || playing || state === 'silent') return;
      playing = true; cursor = 0; startAt = ctx.currentTime + 0.1;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(volume, ctx.currentTime, 0.3);
      tick();
      timer = setInterval(tick, 60);
    });
  }
  function stopNow() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    const n = getNodes && getNodes();
    if (out && n) out.gain.setTargetAtTime(0.0001, n.ctx.currentTime, 0.08);
  }
  return {
    get state() { return state; },
    get debug() { return { loaded: !!song, playing, cursor, notes: song ? song.notes.length : 0 }; },
    setTheme() { /* one song, one theme */ },
    setState(slot) {
      if (slot === 'silent') { state = 'silent'; stopNow(); return; }
      state = slot;
      if (!playing) start();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      const n = getNodes && getNodes();
      if (out && n && playing) out.gain.setTargetAtTime(volume, n.ctx.currentTime, 0.1);
    },
    stop() { state = 'silent'; stopNow(); },
  };
}
