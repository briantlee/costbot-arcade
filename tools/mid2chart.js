#!/usr/bin/env node
/*
 * mid2chart.js — turn a Standard MIDI File into a CostBot Hero song.
 *
 * CostBot Hero songs are pure data in arcade/shared/arcade-music.js: a lead
 * line L.<key> (one MIDI note per 16th step, 16 steps/bar, null = rest), a
 * chord progression P.<key> (one { root, tones } per bar), and a mix config
 * TRACKS.ch_<key>. The game (arcade/costbot-hero/ch-game.js) generates the
 * falling gems straight from L.<key> and assigns lanes from pitch on its own,
 * so all a new song really needs is that 16-step lead grid plus a bpm and a
 * bar count. This tool reads a .mid and emits paste-ready L / P / TRACKS
 * blocks plus the ch-game.js roster line, on that exact grid.
 *
 * Dependency-free (its own minimal SMF parser). Node only.
 *
 *   INSPECT (no --lead): list the file's tracks so you can pick which one is
 *   the melody and which is the bass —
 *       node mid2chart.js song.mid
 *
 *   CONVERT (once you've picked tracks) —
 *       node mid2chart.js song.mid --lead 2 --bass 1 \
 *            --key mysong --name "My Song" --bars 33:40 --bpm 150
 *
 *   --lead N        track index of the melody (required to convert)
 *   --bass N        track index of the bass/root (optional; drives P roots)
 *   --key SLUG      identifier base -> L.SLUG / P.SLUG / TRACKS.ch_SLUG
 *   --name "TEXT"   display name for the roster + TRACKS.title
 *   --bars A:B      source bar range to extract, 1-indexed inclusive
 *                   (default: every bar that has a lead note)
 *   --bpm N         override the emitted bpm (default: the file's own tempo)
 *   --transpose N   shift every emitted pitch by N semitones (e.g. -12)
 *   --min-pitch M   drop lead notes below MIDI M — isolates a melody riding on
 *                   top of a low accompaniment (stride bass, power chords)
 *   --quantize N    snap onsets to the nearest 1/N note before gridding
 *                   (default 16). Use 8 to de-swing a shuffle/triplet tune the
 *                   straight 16-step grid can't hold — inspect mode's duration
 *                   histogram showing values like ppq/3 (a triplet) is the tell.
 *   --min-dur N     drop lead notes shorter than N ticks before quantizing —
 *                   filters grace notes / bass-echo ornaments that would
 *                   otherwise land off-grid and displace the real melody.
 *                   Inspect mode prints a duration histogram to pick N from;
 *                   a clean bimodal split (e.g. 24 vs 96) means "set N between
 *                   them". Applies to the lead only; P roots still see every note.
 *   --selftest      parse a synthesized in-memory MIDI and convert it, to
 *                   prove the pipeline works without a real file
 *
 * The emitted L is exact and ready to play. P's roots come from the bass track
 * and its major/minor guess from which third is sounding — always eyeball the
 * "TODO" it prints and set the real chord qualities by ear. TRACKS is a
 * sensible rock skeleton (dist lead / power pad / rock drums); tune voices,
 * gains, maxLoops, and any intro to taste, exactly as the hand-authored songs
 * in arcade-music.js already do.
 */
'use strict';

const fs = require('fs');

// ---------------------------------------------------------------------------
// Minimal Standard MIDI File reader (format 0/1, PPQ division).
// ---------------------------------------------------------------------------

// Read a variable-length quantity; returns [value, nextPos].
function readVLQ(buf, pos) {
  let value = 0;
  for (;;) {
    const b = buf[pos++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return [value, pos];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(m) {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

function parseMidi(buf) {
  if (buf.toString('ascii', 0, 4) !== 'MThd') throw new Error('not a MIDI file (missing MThd header)');
  const format = buf.readUInt16BE(8);
  const ntracks = buf.readUInt16BE(10);
  const division = buf.readInt16BE(12);
  if (division <= 0) throw new Error('SMPTE time division is not supported — need a PPQ (ticks-per-quarter) MIDI file');
  const ppq = division;

  let tempoBPM = 120;      // first tempo wins, for display/default
  let tempoSeen = false;
  let timeSig = [4, 4];    // first time-sig wins
  const tracks = [];

  let pos = 14;
  for (let t = 0; t < ntracks; t++) {
    if (buf.toString('ascii', pos, pos + 4) !== 'MTrk') throw new Error(`track ${t}: missing MTrk chunk`);
    const len = buf.readUInt32BE(pos + 4);
    let p = pos + 8;
    const end = p + len;

    let tick = 0;
    let running = 0;
    let name = '';
    const notes = [];              // { tick, pitch, vel, dur }
    const channels = new Set();
    const active = new Map();      // "chan:pitch" -> index into notes (awaiting note-off)

    while (p < end) {
      let dt;
      [dt, p] = readVLQ(buf, p);
      tick += dt;

      let status = buf[p];
      if (status & 0x80) { p++; running = status; } else { status = running; } // running status

      const type = status & 0xf0;
      const chan = status & 0x0f;

      if (status === 0xff) {                    // meta
        const metaType = buf[p++];
        let mlen;
        [mlen, p] = readVLQ(buf, p);
        const data = buf.subarray(p, p + mlen);
        if (metaType === 0x03 && !name) name = data.toString('utf8');
        else if (metaType === 0x51 && !tempoSeen) {
          const us = (data[0] << 16) | (data[1] << 8) | data[2];
          tempoBPM = Math.round(60000000 / us);
          tempoSeen = true;
        } else if (metaType === 0x58 && timeSig[0] === 4 && timeSig[1] === 4) {
          timeSig = [data[0], 1 << data[1]];
        }
        p += mlen;
      } else if (status === 0xf0 || status === 0xf7) { // sysex — skip
        let slen;
        [slen, p] = readVLQ(buf, p);
        p += slen;
      } else if (type === 0x90) {               // note on
        const pitch = buf[p++]; const vel = buf[p++];
        channels.add(chan);
        if (vel > 0) {
          active.set(chan + ':' + pitch, notes.length);
          notes.push({ tick, pitch, vel, dur: 0 });
        } else {                                // vel 0 == note off
          const k = chan + ':' + pitch, i = active.get(k);
          if (i != null) { notes[i].dur = tick - notes[i].tick; active.delete(k); }
        }
      } else if (type === 0x80) {               // note off
        const pitch = buf[p++]; p++;            // skip velocity
        const k = chan + ':' + pitch, i = active.get(k);
        if (i != null) { notes[i].dur = tick - notes[i].tick; active.delete(k); }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        p += 2;                                 // 2-byte channel messages
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1;                                 // 1-byte channel messages
      } else {
        p++;                                    // unknown — step past defensively
      }
    }

    tracks.push({ index: t, name, notes, channels: [...channels] });
    pos = end;
  }

  return { format, ppq, tempoBPM, timeSig, tracks };
}

// ---------------------------------------------------------------------------
// Inspect: describe each track so a human can pick lead + bass.
// ---------------------------------------------------------------------------

function inspect(mid, file) {
  console.log(`\n${file}`);
  console.log(`  format ${mid.format}, ${mid.ppq} ticks/quarter, tempo ~${mid.tempoBPM} bpm, time sig ${mid.timeSig[0]}/${mid.timeSig[1]}`);
  if (mid.timeSig[0] !== 4 || mid.timeSig[1] !== 4) {
    console.log(`  ⚠  not 4/4 — CostBot Hero is locked to 16 steps (a 4/4 bar); the extraction below assumes 4/4.`);
  }
  const ticksPerBar = mid.ppq * 4;
  console.log(`\n  idx  notes  pitch range        avg   bars  name`);
  console.log(`  ---  -----  -----------------  ----  ----  ----`);
  for (const tr of mid.tracks) {
    if (!tr.notes.length) {
      console.log(`  ${String(tr.index).padStart(3)}      0  (no notes — control/meta track)   ${tr.name || ''}`);
      continue;
    }
    let lo = Infinity, hi = -Infinity, sum = 0, maxTick = 0;
    for (const n of tr.notes) { if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; sum += n.pitch; maxTick = Math.max(maxTick, n.tick); }
    const avg = Math.round(sum / tr.notes.length);
    const bars = Math.floor(maxTick / ticksPerBar) + 1;
    console.log(`  ${String(tr.index).padStart(3)}  ${String(tr.notes.length).padStart(5)}  ${(noteName(lo) + '–' + noteName(hi)).padEnd(17)}  ${String(avg).padStart(4)}  ${String(bars).padStart(4)}  ${tr.name || ''}`);
  }
  // Note-duration histogram across all tracks — a clean bimodal split (a short
  // cluster and a long cluster) usually means the short notes are grace/echo
  // ornaments; set --min-dur between the two clusters to drop them from the lead.
  const durs = {};
  for (const tr of mid.tracks) for (const n of tr.notes) { const b = n.dur; durs[b] = (durs[b] || 0) + 1; }
  const durEntries = Object.entries(durs).map(([d, c]) => [+d, c]).sort((a, b) => a[0] - b[0]);
  if (durEntries.length) {
    console.log(`\n  note durations (ticks:count, 16th=${mid.ppq / 4}t): ${durEntries.map(([d, c]) => `${d}:${c}`).join('  ')}`);
  }

  // Heuristic suggestion: highest-average track with real melodic motion = lead;
  // lowest-average = bass. Only over tracks that actually have notes.
  const withNotes = mid.tracks.filter((t) => t.notes.length);
  if (withNotes.length) {
    const byAvg = [...withNotes].sort((a, b) => avgPitch(a) - avgPitch(b));
    console.log(`\n  suggestion: --lead ${byAvg[byAvg.length - 1].index}  --bass ${byAvg[0].index}   (highest-pitched track as melody, lowest as bass)`);
  }
  console.log(`\n  then: node mid2chart.js ${file} --lead <idx> --bass <idx> --key myslug --name "My Song" [--bars A:B]\n`);
}

function avgPitch(tr) {
  let s = 0; for (const n of tr.notes) s += n.pitch; return s / tr.notes.length;
}

// ---------------------------------------------------------------------------
// Convert: build the L grid, guess P, emit paste-ready blocks.
// ---------------------------------------------------------------------------

function convert(mid, opt) {
  const ticksPerStep = mid.ppq / 4;              // 16th note
  const stepsToBar = 16;

  // --lead accepts one track index OR a comma-separated list. With a list, the
  // lead is the HIGHEST note across ALL listed tracks at each step — for an
  // arrangement where the tune is passed between instruments (violin, then
  // flute, then piano), no single track carries it the whole way, and a merged
  // top line follows the melody wherever it goes with no dead space.
  const leadIdxs = String(opt.lead).split(',').map((s) => +s.trim());
  const leadNotes = [];
  for (const idx of leadIdxs) {
    const tr = mid.tracks[idx];
    if (tr) leadNotes.push(...tr.notes);
  }
  if (!leadNotes.length) throw new Error(`--lead ${opt.lead} is not a track (or tracks) with notes (run inspect)`);
  const bassTr = opt.bass != null ? mid.tracks[opt.bass] : null;

  // Monophonic lead grid: at each 16th step keep the HIGHEST onset (leads sit
  // on top). step -> pitch. Notes shorter than --min-dur are skipped first —
  // grace notes and bass-echo ornaments are typically both short AND off-grid,
  // so quantizing them just collides with and displaces the real melody.
  const minDur = opt.minDur || 0;
  // --min-pitch M keeps only lead notes at or above MIDI M. In a stride/band
  // arrangement the melody rides on top of a constant low accompaniment
  // (oom-pah bass, power chords), so "highest note per step" grabs the comp
  // whenever the melody rests. A pitch floor above the accompaniment isolates
  // the melody and leaves a clean rest where only the comp is sounding.
  const minPitch = opt.minPitch || 0;
  // --quantize N snaps each onset to the nearest 1/N note BEFORE it's placed on
  // the 16-step grid. The default (N=16) is a plain round to the nearest 16th.
  // Use a coarser grid to de-swing a shuffle / triplet tune the 16-step grid
  // can't represent: --quantize 8 pulls every onset to the nearest straight
  // 8th, so a triplet feel becomes clean straight-eighths (on even steps only)
  // instead of the jittery 39%-off-grid mess a straight 16th round would make.
  const snapTicks = opt.quantize ? (mid.ppq * 4 / opt.quantize) : 0;
  const snap = (t) => (snapTicks ? Math.round(t / snapTicks) * snapTicks : t);
  const leadByStep = new Map();
  let maxStep = 0;
  for (const n of leadNotes) {
    if (n.dur < minDur || n.pitch < minPitch) continue;
    const step = Math.round(snap(n.tick) / ticksPerStep);
    maxStep = Math.max(maxStep, step);
    const cur = leadByStep.get(step);
    if (cur == null || n.pitch > cur) leadByStep.set(step, n.pitch);
  }

  // Bar range (1-indexed inclusive). Default: first..last bar that has a lead note.
  const lastBar = Math.floor(maxStep / stepsToBar);
  let barA = 0, barB = lastBar;
  if (opt.bars) {
    barA = opt.bars[0] - 1; barB = opt.bars[1] - 1;
    if (barA < 0 || barB < barA) throw new Error('--bars A:B must be 1-indexed with A<=B');
  }
  const nBars = barB - barA + 1;
  const tr = opt.transpose || 0;

  // --- L grid --------------------------------------------------------------
  const Lrows = [];
  let onsetCount = 0, gLo = Infinity, gHi = -Infinity;
  for (let bar = barA; bar <= barB; bar++) {
    const cells = [];
    for (let s = 0; s < stepsToBar; s++) {
      const p = leadByStep.get(bar * stepsToBar + s);
      if (p == null) { cells.push('_'); }
      else {
        const v = p + tr; cells.push(String(v));
        onsetCount++; if (v < gLo) gLo = v; if (v > gHi) gHi = v;
      }
    }
    Lrows.push(`      ${cells.join(', ')},  // bar ${bar - barA} (source bar ${bar + 1})`);
  }

  // --- P per bar (roots from bass, quality guessed from the sounding 3rd) ---
  const Prows = [];
  for (let bar = barA; bar <= barB; bar++) {
    const barStartTick = bar * mid.ppq * 4, barEndTick = (bar + 1) * mid.ppq * 4;
    // root: the LOWEST bass note onset in the bar. On a dedicated bass track
    // that's the root; on a single combined track (a piano arrangement where
    // --bass == --lead) it's the left-hand root rather than a stray high melody
    // note, which "closest to the downbeat" would wrongly grab. Falls back to
    // the lowest lead note (down an octave) when the bass track is silent here.
    let root = null;
    if (bassTr) {
      let lo = Infinity;
      for (const n of bassTr.notes) {
        if (n.tick >= barStartTick && n.tick < barEndTick && n.pitch < lo) lo = n.pitch;
      }
      if (Number.isFinite(lo)) root = lo;
    }
    if (root == null) {
      let lo = Infinity;
      for (let s = 0; s < stepsToBar; s++) { const p = leadByStep.get(bar * stepsToBar + s); if (p != null && p < lo) lo = p; }
      root = Number.isFinite(lo) ? lo - 12 : 48;
    }
    // quality: gather pitch classes sounding anywhere this bar (lead + bass),
    // measured against the root's pitch class. Minor 3rd present & major 3rd
    // absent -> minor; else major. Always flagged for a human ear-check.
    const pcs = new Set();
    for (let s = 0; s < stepsToBar; s++) { const p = leadByStep.get(bar * stepsToBar + s); if (p != null) pcs.add(((p - root) % 12 + 12) % 12); }
    if (bassTr) for (const n of bassTr.notes) if (n.tick < barEndTick && n.tick + Math.max(n.dur, 1) > barStartTick) pcs.add(((n.pitch - root) % 12 + 12) % 12);
    const minor = pcs.has(3) && !pcs.has(4);
    const tones = minor ? '[0, 3, 7]' : '[0, 4, 7]';
    const q = minor ? 'min' : 'maj';
    Prows.push(`      { root: ${root + tr}, tones: ${tones} },  // ${noteName(root + tr)} ${q}  (source bar ${bar + 1})`);
  }

  const key = opt.key || 'newsong';
  const name = opt.name || key;
  const bpm = opt.bpm || mid.tempoBPM;
  const firstRoot = null; // shown in TODO
  const density = ((onsetCount / (nBars * 16)) * 100).toFixed(1);

  // --- emit ----------------------------------------------------------------
  const out = [];
  out.push(`// ============================================================================`);
  out.push(`// "${name}" — generated by arcade/tools/mid2chart.js`);
  out.push(`// source bars ${barA + 1}-${barB + 1} (${nBars} bars), ${bpm} bpm, ${onsetCount} lead onsets (${density}% of steps)`);
  out.push(`// lead pitch range ${Number.isFinite(gLo) ? noteName(gLo) + '–' + noteName(gHi) : 'n/a'}`);
  out.push(`// TODO: verify P.${key} chord qualities by ear (roots are from the bass track,`);
  out.push(`//       major/minor is a guess from the sounding 3rd) and tune the TRACKS mix.`);
  out.push(`// ============================================================================`);
  out.push(``);
  out.push(`// --- into PROGRESSIONS (P) in arcade-music.js -------------------------------`);
  out.push(`    ${key}: [`);
  out.push(...Prows);
  out.push(`    ],`);
  out.push(``);
  out.push(`// --- into LEADS (L) in arcade-music.js --------------------------------------`);
  out.push(`    ${key}: [`);
  out.push(...Lrows);
  out.push(`    ],`);
  out.push(``);
  out.push(`// --- into TRACKS in arcade-music.js -----------------------------------------`);
  out.push(`    ch_${key}: {`);
  out.push(`      title: '${name}', influence: '', bpm: ${bpm}, key: '',`);
  out.push(`      prog: P.${key}, lead: L.${key}, drums: 'rock', pad: 'power', bars: ${nBars},`);
  out.push(`      arpEvery: 0, bassEvery: 1, gain: 0.42, voices: { lead: 'dist' },`);
  out.push(`      drumGain: 1.2, bassGain: 0.5, bassSubGain: 1.0,`);
  out.push(`    },`);
  out.push(``);
  out.push(`// --- into the SONGS roster in arcade/costbot-hero/ch-game.js ----------------`);
  out.push(`    { key: 'ch_${key}', name: '${name}', sub: '', tag: '', biome: 'arena',`);
  out.push(`      experimental: true,`);
  out.push(`      maxLoops: 4 },`);
  console.log(out.join('\n'));
}

// ---------------------------------------------------------------------------
// --selftest: synthesize a tiny 2-track MIDI in memory and run the pipeline,
// so the parser + converter can be smoke-tested without a real file.
// ---------------------------------------------------------------------------

function writeVLQ(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

function selftestBuffer() {
  const PPQ = 96, stepTicks = PPQ / 4; // 24
  const bars = 2;
  // melody: a rising C-major run, one note every 16th, over 2 bars (32 notes).
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const meta = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // tempo 500000us = 120bpm
  const timesig = [0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08];

  function trackChunk(evBytes) {
    const end = [0x00, 0xff, 0x2f, 0x00];
    const body = evBytes.concat(end);
    const len = body.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff].concat(body);
  }

  // track 0: meta only (tempo/timesig) + a track name
  const nameEv = [0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x6d, 0x70]; // "Temp"
  const t0 = trackChunk(nameEv.concat(meta, timesig));

  // track 1: bass — one whole-bar C2 per bar (root)
  let b1 = [];
  for (let bar = 0; bar < bars; bar++) {
    b1 = b1.concat([0x00, 0x90, 36, 100]);                 // C2 on
    b1 = b1.concat(writeVLQ(PPQ * 4), [0x80, 36, 0]);      // off after a bar
  }
  const t1 = trackChunk(b1);

  // track 2: melody — a note every 16th step
  let b2 = [];
  for (let i = 0; i < bars * 16; i++) {
    const pitch = scale[i % scale.length];
    b2 = b2.concat([0x00, 0x90, pitch, 100]);
    b2 = b2.concat(writeVLQ(stepTicks), [0x80, pitch, 0]);
  }
  const t2 = trackChunk(b2);

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, (PPQ >> 8) & 0xff, PPQ & 0xff];
  return Buffer.from(header.concat(t0, t1, t2));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') o.selftest = true;
    else if (a === '--lead') o.lead = argv[++i];   // string: one index or "0,2,4" list
    else if (a === '--bass') o.bass = +argv[++i];
    else if (a === '--key') o.key = argv[++i];
    else if (a === '--name') o.name = argv[++i];
    else if (a === '--bpm') o.bpm = +argv[++i];
    else if (a === '--transpose') o.transpose = +argv[++i];
    else if (a === '--min-dur') o.minDur = +argv[++i];
    else if (a === '--quantize') o.quantize = +argv[++i];
    else if (a === '--min-pitch') o.minPitch = +argv[++i];
    else if (a === '--bars') { const m = /^(\d+):(\d+)$/.exec(argv[++i] || ''); if (!m) throw new Error('--bars must be A:B'); o.bars = [+m[1], +m[2]]; }
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else o._.push(a);
  }
  return o;
}

function main() {
  let opt;
  try { opt = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('error: ' + e.message); process.exit(2); }

  if (opt.selftest) {
    console.log('--- selftest: synthesized 2-bar C-major MIDI ---');
    const mid = parseMidi(selftestBuffer());
    inspect(mid, '<selftest>');
    convert(mid, { lead: 2, bass: 1, key: 'selftest', name: 'Self Test', bars: [1, 2] });
    return;
  }

  const file = opt._[0];
  if (!file) {
    console.error('usage: node mid2chart.js <file.mid> [--lead N --bass N --key slug --name "…" --bars A:B --bpm N --transpose N]');
    console.error('       node mid2chart.js --selftest');
    process.exit(2);
  }

  let mid;
  try { mid = parseMidi(fs.readFileSync(file)); }
  catch (e) { console.error('error parsing ' + file + ': ' + e.message); process.exit(1); }

  if (opt.lead == null) inspect(mid, file);
  else convert(mid, opt);
}

main();
