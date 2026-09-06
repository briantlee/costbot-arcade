/* ============================================================================
 * CostBot Arcade — SHARED SOUNDTRACK ENGINE
 * ----------------------------------------------------------------------------
 * A procedural sequencer shared by every game in the arcade. No audio files:
 * every kick, hat, bass note and lead line is synthesized in WebAudio at
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
    // 16 bars in E minor, in four four-bar sections, so the loop is a song and
    // not a vamp:  A  Em C G D  |  A' Em C D B  |  B  Am Em C B  |  C  Em G D B
    // The B section is where the drums drop out; the last bar is the fill back in.
    downhill: [{ root: 40, tones: [0, 3, 7] }, { root: 36, tones: [0, 4, 7] },
               { root: 43, tones: [0, 4, 7] }, { root: 38, tones: [0, 4, 7] },
               { root: 40, tones: [0, 3, 7] }, { root: 36, tones: [0, 4, 7] },
               { root: 38, tones: [0, 4, 7] }, { root: 35, tones: [0, 4, 7] },
               { root: 33, tones: [0, 3, 7] }, { root: 40, tones: [0, 3, 7] },
               { root: 36, tones: [0, 4, 7] }, { root: 35, tones: [0, 4, 7] },
               { root: 40, tones: [0, 3, 7] }, { root: 43, tones: [0, 4, 7] },
               { root: 38, tones: [0, 4, 7] }, { root: 35, tones: [0, 4, 7] }],
    // Eight bars of warm F major with jazz sevenths — I vi ii V | I iii IV V.
    // Major throughout and it resolves home every eight bars, which is what
    // makes it cheerful rather than wistful. The sevenths and ninths are what
    // stop it from sounding like a nursery rhyme.
    lagoon:   [{ root: 41, tones: [0, 4, 7, 11] },   // Fmaj7
               { root: 38, tones: [0, 3, 7, 10] },   // Dm7
               { root: 43, tones: [0, 3, 7, 10] },   // Gm7
               { root: 36, tones: [0, 4, 7, 10] },   // C7
               { root: 41, tones: [0, 4, 7, 11] },   // Fmaj7
               { root: 45, tones: [0, 3, 7, 10] },   // Am7
               { root: 46, tones: [0, 4, 7, 11] },   // Bbmaj7
               { root: 36, tones: [0, 4, 7, 10] }],  // C7
    chamber:  [{ root: 38, tones: [0, 3, 7, 10, 14] },   // Dm9
               { root: 34, tones: [0, 4, 7, 11] },       // Bbmaj7
               { root: 31, tones: [0, 3, 7, 10] },       // Gm7
               { root: 33, tones: [0, 4, 7, 10] }],      // A7
    // Dojo — A minor with a bright bVII/bVI lift for a bouncy, martial vamp.
    // The chords only have to give the pentatonic lead somewhere to land: Am G F G.
    dojo:     [{ root: 45, tones: [0, 3, 7] }, { root: 43, tones: [0, 4, 7] },
               { root: 41, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] }],   // Am G F G
    // Dojo trivia — i bVI V i. The E major in bar 3 is the "…?" tension that a
    // think-cue leans on, resolving home on the last bar. Am F E Am.
    dojoThink:[{ root: 45, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] },
               { root: 40, tones: [0, 4, 7] }, { root: 45, tones: [0, 3, 7] }],   // Am F E Am
    // CostBot Hero — Graviton Groove. A driving E-minor loop, brighter than the
    // industrial boss: Em C G D lifts on the G and turns on the D. Gives the
    // rhythm chart a wide contour so the melody sweeps across all five lanes.
    chGraviton:[{ root: 40, tones: [0, 3, 7] }, { root: 36, tones: [0, 4, 7] },
               { root: 43, tones: [0, 4, 7] }, { root: 38, tones: [0, 4, 7] }],   // Em C G D
    // CostBot Hero — "Imperial Markup". 16 bars in G minor: A the theme, B the
    // lyrical middle, C the big octave-up statement, D dark bridge + fill.
    chImperial:[{ root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },  // A: Gm Gm
               { root: 39, tones: [0, 4, 7] }, { root: 38, tones: [0, 4, 7] },   //    Eb D
               { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // B: Gm Gm
               { root: 39, tones: [0, 4, 7] }, { root: 38, tones: [0, 4, 7] },   //    Eb D
               { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // C: Cm Cm
               { root: 43, tones: [0, 3, 7] }, { root: 38, tones: [0, 4, 7] },   //    Gm D
               { root: 39, tones: [0, 4, 7] }, { root: 38, tones: [0, 4, 7] },   // D: Eb D
               { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] }],  //    Gm Gm
    // CostBot Hero — "The Savengers". The Avengers bass ostinato D–Eb–E–Bb, dropped
    // an octave and voiced as power chords for the rocked-up cut; same four roots
    // repeat under all four sections (matching the MIDI).
    chAvengers:[{ root: 38, tones: [0, 7] }, { root: 39, tones: [0, 7] },   // D Eb
               { root: 40, tones: [0, 7] }, { root: 34, tones: [0, 7] },    // E Bb
               { root: 38, tones: [0, 7] }, { root: 39, tones: [0, 7] },
               { root: 40, tones: [0, 7] }, { root: 34, tones: [0, 7] },
               { root: 38, tones: [0, 7] }, { root: 39, tones: [0, 7] },
               { root: 40, tones: [0, 7] }, { root: 34, tones: [0, 7] },
               { root: 38, tones: [0, 7] }, { root: 39, tones: [0, 7] },
               { root: 40, tones: [0, 7] }, { root: 34, tones: [0, 7] }],
    // CostBot Hero — "It's a Small Cost". It's a Small World in C major, simple
    // I–V harmony under the electro-light-parade arrangement.
    chSmall:  [{ root: 48, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // C C
               { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },  // G G
               { root: 48, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // C C
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // G C
               { root: 48, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // C C
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // G C
               { root: 48, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },  // C G
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] }], // G C
    // CostBot Hero — "Electrical Spendarade". Main St. Electrical Parade (Baroque
    // Hoedown) in G major: a G–C hoedown vamp with a D–A lift in the B section.
    chParade: [{ root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // G C
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },
               { root: 50, tones: [0, 4, 7] }, { root: 45, tones: [0, 4, 7] },  // D A (B section)
               { root: 50, tones: [0, 4, 7] }, { root: 45, tones: [0, 4, 7] },
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },  // G C
               { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] }],
    // CostBot Hero — "Fiscal Jeopardy". The "Think!" vamp: an A–D turnaround,
    // then the whole thing up a minor third (C–F) — the classic key change.
    chJeopardy:[{ root: 45, tones: [0, 4, 7] }, { root: 50, tones: [0, 4, 7] },  // A D
               { root: 45, tones: [0, 4, 7] }, { root: 50, tones: [0, 4, 7] },
               { root: 45, tones: [0, 4, 7] }, { root: 50, tones: [0, 4, 7] },
               { root: 50, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },
               { root: 48, tones: [0, 4, 7] }, { root: 53, tones: [0, 4, 7] },  // C F (up a 3rd)
               { root: 48, tones: [0, 4, 7] }, { root: 53, tones: [0, 4, 7] },
               { root: 48, tones: [0, 4, 7] }, { root: 53, tones: [0, 4, 7] },
               { root: 53, tones: [0, 4, 7] }, { root: 46, tones: [0, 4, 7] }],
    // "Blind Spend" (dd.mid), dropped an octave and sped up for a faster, more
    // frantic feel. i–VI–iv–i in C minor — Cm Ab Fm Cm, two bars each,
    // twice through the 16-bar loop. Matches the source's bass, an octave down.
    blindHero:[{ root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },  // Cm Cm
               { root: 32, tones: [0, 4, 7] }, { root: 32, tones: [0, 4, 7] },  // Ab Ab
               { root: 29, tones: [0, 3, 7] }, { root: 29, tones: [0, 3, 7] },  // Fm Fm
               { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },  // Cm Cm
               { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },  // Cm Cm
               { root: 32, tones: [0, 4, 7] }, { root: 32, tones: [0, 4, 7] },  // Ab Ab
               { root: 29, tones: [0, 3, 7] }, { root: 29, tones: [0, 3, 7] },  // Fm Fm
               { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] }], // Cm Cm
    // CostBot Hero — "Great Fairy Fountain". Transcribed from a music-box MIDI
    // arrangement: the bottom two notes of each broken chord in the lead give
    // the harmony directly — G minor, dipping through a diminished passing
    // chord (E and later C) on the way to F and D minor, so it keeps the
    // fountain's magic-sparkle wobble instead of resolving too plainly.
    chFairy:  [{ root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },  // Gm Gm
               { root: 41, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },  // F F
               { root: 40, tones: [0, 3, 6] }, { root: 40, tones: [0, 3, 6] },  // Edim Edim
               { root: 38, tones: [0, 3, 7] }, { root: 38, tones: [0, 3, 7] },  // Dm Dm
               { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },  // Gm Gm
               { root: 36, tones: [0, 3, 6] }, { root: 36, tones: [0, 3, 6] },  // Cdim Cdim
               { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },  // Gm Gm
               { root: 40, tones: [0, 3, 6] }, { root: 40, tones: [0, 3, 6] }], // Edim Edim
    // CostBot Hero — "The Gold Saucer". Transcribed from MIDI: 22 bars, the
    // source's own loop unit (a "Loop" marker in the file marks this exact
    // span repeating). G major throughout the A section (bars 1-8, 2x a
    // 4-bar phrase over a G pedal walking bass), a diatonic bridge through
    // D-Bm-Am-D-D-Bm-Em-Em (bars 9-16), then G/Em for the final statement
    // (bars 17-22) — all read straight off the bass track's own roots.
    chGoldSaucer: [
      { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // G G
      { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // G G
      { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // G G
      { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // G G
      { root: 38, tones: [0, 4, 7] }, { root: 47, tones: [0, 3, 7] },   // D Bm
      { root: 45, tones: [0, 4, 7] }, { root: 38, tones: [0, 4, 7] },   // A D
      { root: 38, tones: [0, 4, 7] }, { root: 47, tones: [0, 3, 7] },   // D Bm
      { root: 40, tones: [0, 3, 7] }, { root: 40, tones: [0, 3, 7] },   // Em Em
      { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // G G
      { root: 40, tones: [0, 3, 7] }, { root: 40, tones: [0, 3, 7] },   // Em Em
      { root: 43, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // G G
    ],
    // CostBot Hero — "Lost Woods". Transcribed from MIDI: 17 bars, read off
    // the Pizzicato ostinato's own roots. F-F-C-C-F-F-C-C for the 8-bar A
    // section (the flute's call-and-rest phrase, played twice), a 6-bar
    // Dm-Am wandering bridge under the flute's silent bars, then G-Em for the
    // closing tag.
    lostWoods: [
      { root: 41, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // F F
      { root: 48, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },   // C C
      { root: 41, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // F F
      { root: 48, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] },   // C C
      { root: 38, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Dm Am
      { root: 38, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Dm Am
      { root: 38, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Dm Am
      { root: 38, tones: [0, 3, 7] },                                  // Dm
      { root: 43, tones: [0, 4, 7] },                                  // G
      { root: 40, tones: [0, 3, 7] },                                  // Em
    ],
    // CostBot Hero — "X-pense". Transcribed from MIDI, all 30 bars including
    // the 2-bar "Metro Bass" solo intro (bars 1-2) — the Strings/lead melody
    // is silent there in the source, so it's the driving bass ostinato alone
    // up front, same part it plays under the tune for the rest of the song
    // (see L.xmenBass and TRACKS.ch_xmen's bassLine). C minor pedal for the A
    // section (bars 3-8, 16-21), a brief Fm lift (bars 9-10, 22-23), then a
    // chromatic G-Ab-Fm-G turnaround bridge (bars 13-16, 26-29) straight off
    // the bass's own walk — all read off the Synth Bass track's root on beat
    // 1 of each bar (the bass itself alternates root/bVI within most bars;
    // see the fully transcribed L.xmenBass for that detail).
    xmen: [
      { root: 36, tones: [0, 3, 7] }, { root: 32, tones: [0, 4, 7] },     // Cm Ab — intro
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 41, tones: [0, 3, 7] }, { root: 41, tones: [0, 3, 7] },   // Fm Fm
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 31, tones: [0, 3, 7] }, { root: 32, tones: [0, 4, 7] },   // Gm Ab
      { root: 29, tones: [0, 3, 7] }, { root: 31, tones: [0, 3, 7] },   // Fm Gm
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 41, tones: [0, 3, 7] }, { root: 41, tones: [0, 3, 7] },   // Fm Fm
      { root: 36, tones: [0, 3, 7] }, { root: 36, tones: [0, 3, 7] },   // Cm Cm
      { root: 31, tones: [0, 3, 7] }, { root: 32, tones: [0, 4, 7] },   // Gm Ab
      { root: 29, tones: [0, 3, 7] }, { root: 31, tones: [0, 3, 7] },   // Fm Gm
      { root: 36, tones: [0, 3, 7] }, { root: 24, tones: [0, 3, 7] },   // Cm Cm
    ],
    // CostBot Hero — "Fight On!". Transcribed from MIDI: the source's own
    // 16-bar opening (a 3-bar pedal + 1-bar chromatic walk-up, four times) —
    // Am for bars 1-4, Cm for 5-8, Gm for 9-12, Bm for 13-16 — read off the
    // Bass Guitar track's own roots.
    ffFightOn: [
      { root: 45, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Am Am
      { root: 45, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Am Am
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // Gm Gm
      { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // Gm Gm
      { root: 47, tones: [0, 3, 7] }, { root: 47, tones: [0, 3, 7] },   // Bm Bm
      { root: 47, tones: [0, 3, 7] }, { root: 47, tones: [0, 3, 7] },   // Bm Bm
    ],
    // CostBot Hero — "Legend of CostBot". Transcribed from MIDI: a solo
    // electric piano performance (bass note + a parallel 2-note chord, both
    // hands on one track), 22 bars — the source's own 45-bar file starts
    // repeating bars 10-13 verbatim at bar 22 (with ~40s left in the file),
    // so the excerpt ends right before that repeat instead of playing into
    // it. Root read off the bass note that repeats most often in each bar;
    // quality (major/minor) read off whichever third actually sounds against
    // it. Mostly major with a chromatic descending bass sequence
    // (Bb-Ab-Gb...), dipping minor at bar 10.
    legendOfCostbot: [
      { root: 46, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },   // Bb Ab
      { root: 42, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // Gb F
      { root: 46, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },   // Bb Ab
      { root: 42, tones: [0, 4, 7] }, { root: 49, tones: [0, 4, 7] },   // Gb C#
      { root: 47, tones: [0, 4, 7] }, { root: 46, tones: [0, 3, 7] },   // B Bbm
      { root: 48, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // C F
      { root: 46, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },   // Bb Ab
      { root: 42, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // Gb F
      { root: 40, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // E F
      { root: 40, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // E F
      { root: 47, tones: [0, 4, 7] }, { root: 46, tones: [0, 3, 7] },   // B Bbm
    ],
    // CostBot Hero — "Kalm Before the Bill". Transcribed from MIDI (FF7 ·
    // Kalm), then pumped up per feedback rather than played straight: real
    // 17-bar chord progression and bass pattern (root read off the first
    // bass note of each bar), but at a revved-up tempo with dance drums and
    // a synth lead instead of the source's own sleepy solo-piano tempo and
    // tone (see TRACKS.ch_kalm). G-Em-Am-Bm-C-G-Am-Am, twice, plus a 1-bar
    // tag — a classic descending-then-circling folk progression.
    kalm: [
      { root: 43, tones: [0, 4, 7] }, { root: 40, tones: [0, 3, 7] },   // G Em
      { root: 45, tones: [0, 3, 7] }, { root: 47, tones: [0, 3, 7] },   // Am Bm
      { root: 48, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // C G
      { root: 45, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Am Am
      { root: 43, tones: [0, 4, 7] }, { root: 40, tones: [0, 3, 7] },   // G Em
      { root: 45, tones: [0, 3, 7] }, { root: 47, tones: [0, 3, 7] },   // Am Bm
      { root: 48, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // C G
      { root: 45, tones: [0, 3, 7] }, { root: 43, tones: [0, 4, 7] },   // Am G
      { root: 43, tones: [0, 4, 7] },                                  // G (1-bar tag)
    ],
    // CostBot Hero — "Fiscalicia". Transcribed from MIDI. No track name,
    // lyrics, or other identifying text in the source file (one track,
    // "Electric Piano", program 5, ~3 minutes) — key and harmony are the
    // only evidence, so the root here is read off the source's own lowest
    // bass note each bar (same approach as ch_kalm/ch_gameofloans), same C
    // natural minor as ch_gameofloans. i-i-i-i (bars 0-3) states the tonic,
    // iv-iv (4-5) into III-III (6-7) is the first turn, iv-iv (8-9) resolves
    // back to i-i (10-11); bVII-bVI (12-13) climbs into a repeat of the
    // III-III/iv-iv turn (14-17); III-V (18-19) is the only cadence with the
    // raised leading tone (B natural, the one accidental in the whole
    // excerpt) and resolves back to i (20), recapping the opening quietly.
    // Bars 21-31 restate bVII-III-bVI-iv-V-V-i-bVII-III-V-iv once more before
    // the excerpt cuts off mid-phrase on iv (bar 31) — the source is a full
    // ~3-minute piece and this is only its first 32 bars, not the whole thing.
    fiscalicia: [
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 41, tones: [0, 3, 7] }, { root: 41, tones: [0, 3, 7] },   // Fm Fm
      { root: 39, tones: [0, 4, 7] }, { root: 39, tones: [0, 4, 7] },   // Eb Eb
      { root: 41, tones: [0, 3, 7] }, { root: 41, tones: [0, 3, 7] },   // Fm Fm
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 46, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },   // Bb Ab
      { root: 39, tones: [0, 4, 7] }, { root: 39, tones: [0, 4, 7] },   // Eb Eb
      { root: 41, tones: [0, 3, 7] }, { root: 41, tones: [0, 3, 7] },   // Fm Fm
      { root: 39, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },   // Eb G
      { root: 48, tones: [0, 3, 7] }, { root: 46, tones: [0, 4, 7] },   // Cm Bb
      { root: 39, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },   // Eb Ab
      { root: 41, tones: [0, 3, 7] }, { root: 43, tones: [0, 4, 7] },   // Fm G
      { root: 43, tones: [0, 4, 7] }, { root: 48, tones: [0, 3, 7] },   // G Cm
      { root: 46, tones: [0, 4, 7] }, { root: 39, tones: [0, 4, 7] },   // Bb Eb
      { root: 43, tones: [0, 4, 7] }, { root: 41, tones: [0, 3, 7] },   // G Fm
    ],
    // CostBot Hero — "Game of Loans". Transcribed from MIDI (Game of Thrones ·
    // main title theme): the low string ostinato's own harmony — five bars of
    // i, then the answering v-VII-VII-v figure (three times through, i-i
    // restated first the two times it isn't the very first bar) — then the
    // melody's rising middle section walks VI-III-iv-VI-iv-v-VI-III-VI-VI-iv
    // before landing back on i. All diatonic triads of C natural minor; root
    // read off the first bass note of each bar (same approach as ch_kalm).
    gameOfLoans: [
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 48, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Cm Cm
      { root: 48, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // Cm Gm
      { root: 46, tones: [0, 4, 7] }, { root: 46, tones: [0, 4, 7] },   // Bb Bb
      { root: 43, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Gm Cm
      { root: 48, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // Cm Gm
      { root: 46, tones: [0, 4, 7] }, { root: 46, tones: [0, 4, 7] },   // Bb Bb
      { root: 43, tones: [0, 3, 7] }, { root: 48, tones: [0, 3, 7] },   // Gm Cm
      { root: 48, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // Cm Gm
      { root: 46, tones: [0, 4, 7] }, { root: 46, tones: [0, 4, 7] },   // Bb Bb
      { root: 43, tones: [0, 3, 7] }, { root: 44, tones: [0, 4, 7] },   // Gm Ab
      { root: 39, tones: [0, 4, 7] }, { root: 41, tones: [0, 3, 7] },   // Eb Fm
      { root: 44, tones: [0, 4, 7] }, { root: 41, tones: [0, 3, 7] },   // Ab Fm
      { root: 43, tones: [0, 3, 7] }, { root: 44, tones: [0, 4, 7] },   // Gm Ab
      { root: 39, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },   // Eb Ab
      { root: 44, tones: [0, 4, 7] }, { root: 41, tones: [0, 3, 7] },   // Ab Fm
      { root: 48, tones: [0, 3, 7] },                                  // Cm
    ],
    // CostBot Hero — "Tariffa". Transcribed from MIDI (tifa.mid, a solo "Grand
    // Piano" performance track — no separate melody/bass tracks to splice, so
    // register and attack timing are what separate tune from accompaniment
    // here, same problem as ch_kalm/ch_legendOfCostbot's solo-piano sources).
    // The source's declared tempo (72bpm) checks out as real — note-onsets
    // land cleanly on its own 8th-note grid (192 ticks at ticks_per_beat=384),
    // no sign of the retrigger-quantization artifact ch_gameofloans had, so no
    // collapsing was needed either: this transcription's onset-then-rest shape
    // falls out directly from reading note-on events, not a workaround.
    // The file is a full 85-bar, 4:43 arrangement — bars 0-19 are just the
    // famous rolling piano-arpeggio intro (no independent melody yet, single
    // broken-chord line ascending bass-to-treble each bar); the tune itself
    // only enters at bar 20 (the arpeggiated pickup into the hook, F2-D3-A3-
    // D4-F4-A4-A5, outlining D minor). This loop is bars 21-40 of the source
    // (20 bars) — bar 20's pickup is deliberately EXCLUDED from the looped
    // content: it's a one-time intro flourish, and looping it in made it
    // recur mid-song every time the loop restarted, reading as a jarring
    // "speeds up for a few notes" right after the cadence at the end of bar
    // 40 (confirmed by ear — the pickup is a continuous run of 8th-notes
    // butting straight up against bar 40's held final note, no breathing
    // room). Dropping it means every loop restart goes straight from that
    // cadence back into the hook, matching how the source's own hook repeats
    // (bar 37) elsewhere in this excerpt. Bars 21-31 state the hook and its
    // answering phrase, bars 30-31 are the excerpt's emotional peak (the
    // melody leaps to F6/D6, the highest notes in the whole file), bars
    // 32-40 are a second idea that resolves back into a restatement of the
    // hook (bar 37 is a note-for-note repeat of bar 21 — confirms this
    // really is the source's real recurring melodic hook, not a
    // transcription error) plus a variant close (bar 39 tops out on C6
    // instead of Bb5). Roots read off each bar's first-attacked bass note;
    // quality read off whichever third is actually sounding in that bar
    // (several bars carry no 3rd at all in the sustained accompaniment —
    // those default to the diatonic F-major quality for that scale degree).
    // Bbm at bar 34 and the D major "backdoor" chords at bars 21/37 (Eb) and
    // 36 (D) are genuine chromatic reaches in the source, not typos.
    tariffa: [
      { root: 39, tones: [0, 4, 7] },                                  // Eb   (bar 21 hook)
      { root: 38, tones: [0, 3, 7] }, { root: 43, tones: [0, 4, 7] },   // Dm  G
      { root: 48, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // C   F
      { root: 41, tones: [0, 4, 7] }, { root: 41, tones: [0, 4, 7] },   // F   F
      { root: 43, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] },   // Gm  F
      { root: 45, tones: [0, 3, 7] }, { root: 46, tones: [0, 4, 7] },   // Am  Bb   (bars 30-31, the peak)
      { root: 43, tones: [0, 3, 7] }, { root: 43, tones: [0, 3, 7] },   // Gm  Gm
      { root: 46, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] },   // Bbm Am
      { root: 38, tones: [0, 4, 7] }, { root: 39, tones: [0, 4, 7] },   // D   Eb   (bar 37 hook restatement)
      { root: 38, tones: [0, 3, 7] }, { root: 39, tones: [0, 4, 7] },   // Dm  Eb   (bar 39 hook variant, tops on C6)
      { root: 38, tones: [0, 3, 7] },                                  // Dm       (bar 40, cadence back toward the top)
    ],
    // "Under the GCP" — "Under the Sea" (The Little Mermaid), cost-punned.
    // Generated from under_the_gcp.mid by arcade/tools/mid2chart.js: a single-
    // track piano arrangement. Cut to the source's bars 1-32 (the intro theme
    // + verse + build) — the run ended a touch long at the full 43, and bar 32
    // lands on a Db tonic cadence just before the dense F5 climax, so it's a
    // clean loop boundary. Roots are the lowest (left-hand) note per bar — Db
    // major, mostly Db/Ab/Gb (I/V/IV) with a few passing chords. The major/
    // minor here is the tool's guess from the sounding 3rd; the handful of
    // `min` bars are first-draft and worth an ear-check.
    underthegcp: [
      { root: 37, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] }, { root: 44, tones: [0, 4, 7] },  // bars 1-4
      { root: 49, tones: [0, 4, 7] }, { root: 65, tones: [0, 3, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] },  // bars 5-8
      { root: 49, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 49, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] },  // bars 9-12
      { root: 53, tones: [0, 3, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 53, tones: [0, 3, 7] }, { root: 56, tones: [0, 4, 7] },  // bars 13-16
      { root: 54, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 61, tones: [0, 4, 7] },  // bars 17-20
      { root: 54, tones: [0, 4, 7] }, { root: 61, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 61, tones: [0, 4, 7] },  // bars 21-24
      { root: 61, tones: [0, 4, 7] }, { root: 54, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] },  // bars 25-28
      { root: 61, tones: [0, 4, 7] }, { root: 54, tones: [0, 4, 7] }, { root: 56, tones: [0, 4, 7] }, { root: 61, tones: [0, 4, 7] },  // bars 29-32
    ],
    // "Flower Gil" — Aerith's Theme (FF7), source bars 1-70 (~1:20 at 210bpm).
    // Roots octave-normalized; quality is the tool's guess.
    aerithrock: [
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 1)
      { root: 36, tones: [0, 4, 7] },  // C3 maj  (source bar 2)
      { root: 40, tones: [0, 4, 7] },  // E1 maj  (source bar 3)
      { root: 36, tones: [0, 4, 7] },  // C3 maj  (source bar 4)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 5)
      { root: 47, tones: [0, 3, 7] },  // B2 min  (source bar 6)
      { root: 40, tones: [0, 4, 7] },  // E1 maj  (source bar 7)
      { root: 40, tones: [0, 4, 7] },  // E2 maj  (source bar 8)
      { root: 42, tones: [0, 3, 7] },  // F#1 min  (source bar 9)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 10)
      { root: 36, tones: [0, 4, 7] },  // C1 maj  (source bar 11)
      { root: 36, tones: [0, 4, 7] },  // C1 maj  (source bar 12)
      { root: 36, tones: [0, 4, 7] },  // C1 maj  (source bar 13)
      { root: 38, tones: [0, 3, 7] },  // D1 min  (source bar 14)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 15)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 16)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 17)
      { root: 37, tones: [0, 3, 7] },  // C#1 min  (source bar 18)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 19)
      { root: 37, tones: [0, 3, 7] },  // C#2 min  (source bar 20)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 21)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 22)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 23)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 24)
      { root: 38, tones: [0, 4, 7] },  // D2 maj  (source bar 25)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 26)
      { root: 40, tones: [0, 3, 7] },  // E1 min  (source bar 27)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 28)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 29)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 30)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 31)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 32)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 33)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 34)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 35)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 36)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 37)
      { root: 37, tones: [0, 3, 7] },  // C#1 min  (source bar 38)
      { root: 37, tones: [0, 3, 7] },  // C#1 min  (source bar 39)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 40)
      { root: 38, tones: [0, 4, 7] },  // D2 maj  (source bar 41)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 42)
      { root: 40, tones: [0, 3, 7] },  // E1 min  (source bar 43)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 44)
      { root: 40, tones: [0, 4, 7] },  // E1 maj  (source bar 45)
      { root: 42, tones: [0, 3, 7] },  // F#1 min  (source bar 46)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 47)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 48)
      { root: 37, tones: [0, 4, 7] },  // C#2 maj  (source bar 49)
      { root: 37, tones: [0, 4, 7] },  // C#1 maj  (source bar 50)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 51)
      { root: 40, tones: [0, 3, 7] },  // E1 min  (source bar 52)
      { root: 40, tones: [0, 3, 7] },  // E2 min  (source bar 53)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 54)
      { root: 40, tones: [0, 3, 7] },  // E1 min  (source bar 55)
      { root: 47, tones: [0, 4, 7] },  // B1 maj  (source bar 56)
      { root: 43, tones: [0, 4, 7] },  // G1 maj  (source bar 57)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 58)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 59)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 60)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 61)
      { root: 38, tones: [0, 4, 7] },  // D2 maj  (source bar 62)
      { root: 37, tones: [0, 4, 7] },  // C#3 maj  (source bar 63)
      { root: 40, tones: [0, 3, 7] },  // E1 min  (source bar 64)
      { root: 42, tones: [0, 3, 7] },  // F#1 min  (source bar 65)
      { root: 43, tones: [0, 4, 7] },  // G1 maj  (source bar 66)
      { root: 38, tones: [0, 4, 7] },  // D2 maj  (source bar 67)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 68)
      { root: 47, tones: [0, 3, 7] },  // B1 min  (source bar 69)
      { root: 38, tones: [0, 4, 7] },  // D1 maj  (source bar 70)
    ],
    // "Vamo Alla Financio" — Vamo' Alla Flamenco (FF9), full 64 bars.
    // Chords ESTIMATED from the melody (best-fitting A-minor flamenco chord
    // per bar: Am/Dm/Em/E/F/G/C by chord-tone coverage) so the backing
    // matches the tune, instead of the tool's lowest-note guess.
    vamo: [
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 0)
      { root: 41, tones: [0, 4, 7] },  // F  (bar 1)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 2)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 3)
      { root: 41, tones: [0, 4, 7] },  // F  (bar 4)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 5)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 6)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 7)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 8)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 9)
      { root: 43, tones: [0, 4, 7] },  // G  (bar 10)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 11)
      { root: 43, tones: [0, 4, 7] },  // G  (bar 12)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 13)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 14)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 15)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 16)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 17)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 18)
      { root: 40, tones: [0, 3, 7] },  // Em  (bar 19)
      { root: 43, tones: [0, 4, 7] },  // G  (bar 20)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 21)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 22)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 23)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 24)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 25)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 26)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 27)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 28)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 29)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 30)
      { root: 41, tones: [0, 4, 7] },  // F  (bar 31)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 32)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 33)
      { root: 40, tones: [0, 3, 7] },  // Em  (bar 34)
      { root: 43, tones: [0, 4, 7] },  // G  (bar 35)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 36)
      { root: 41, tones: [0, 4, 7] },  // F  (bar 37)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 38)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 39)
      { root: 41, tones: [0, 4, 7] },  // F  (bar 40)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 41)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 42)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 43)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 44)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 45)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 46)
      { root: 40, tones: [0, 3, 7] },  // Em  (bar 47)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 48)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 49)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 50)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 51)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 52)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 53)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 54)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 55)
      { root: 40, tones: [0, 4, 7] },  // E  (bar 56)
      { root: 38, tones: [0, 3, 7] },  // Dm  (bar 57)
      { root: 40, tones: [0, 3, 7] },  // Em  (bar 58)
      { root: 43, tones: [0, 4, 7] },  // G  (bar 59)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 60)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 61)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 62)
      { root: 45, tones: [0, 3, 7] },  // Am  (bar 63)
    ],
    // "Stolen Tokens" — Yuffie's Theme (FF7), source bars 1-31: verse +
    // development + chorus, ending just before the repeated 2nd round (~1:09).
    stolentokens: [
      { root: 43, tones: [0, 4, 7] },  // G2 maj  (source bar 1)
      { root: 45, tones: [0, 3, 7] },  // A2 min  (source bar 2)
      { root: 43, tones: [0, 4, 7] },  // G2 maj  (source bar 3)
      { root: 45, tones: [0, 3, 7] },  // A2 min  (source bar 4)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 5)
      { root: 48, tones: [0, 4, 7] },  // C3 maj  (source bar 6)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 7)
      { root: 54, tones: [0, 3, 7] },  // F#3 min  (source bar 8)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 9)
      { root: 48, tones: [0, 4, 7] },  // C3 maj  (source bar 10)
      { root: 47, tones: [0, 4, 7] },  // B2 maj  (source bar 11)
      { root: 47, tones: [0, 4, 7] },  // B2 maj  (source bar 12)
      { root: 48, tones: [0, 4, 7] },  // C3 maj  (source bar 13)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 14)
      { root: 48, tones: [0, 4, 7] },  // C3 maj  (source bar 15)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 16)
      { root: 48, tones: [0, 4, 7] },  // C3 maj  (source bar 17)
      { root: 47, tones: [0, 3, 7] },  // B2 min  (source bar 18)
      { root: 45, tones: [0, 4, 7] },  // A2 maj  (source bar 19)
      { root: 45, tones: [0, 3, 7] },  // A2 min  (source bar 20)
      { root: 50, tones: [0, 4, 7] },  // D3 maj  (source bar 21)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 22)
      { root: 60, tones: [0, 4, 7] },  // C4 maj  (source bar 23)
      { root: 59, tones: [0, 3, 7] },  // B3 min  (source bar 24)
      { root: 60, tones: [0, 4, 7] },  // C4 maj  (source bar 25)
      { root: 59, tones: [0, 3, 7] },  // B3 min  (source bar 26)
      { root: 60, tones: [0, 4, 7] },  // C4 maj  (source bar 27)
      { root: 59, tones: [0, 4, 7] },  // B3 maj  (source bar 28)
      { root: 79, tones: [0, 4, 7] },  // G5 maj  (source bar 29)
      { root: 55, tones: [0, 4, 7] },  // G3 maj  (source bar 30)
      { root: 50, tones: [0, 4, 7] },  // D3 maj  (source bar 31)
    ],
    // "Price Ali" — Prince Ali (Aladdin), source bars 16-74 (~1:20), intro
    // trimmed and tail cut to end on the Bb tonic. Roots octave-normalized.
    priceali: [
      { root: 46, tones: [0, 3, 7] },  // A#3 min  (source bar 16)
      { root: 46, tones: [0, 4, 7] },  // A#3 maj  (source bar 17)
      { root: 36, tones: [0, 4, 7] },  // C3 maj  (source bar 18)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 19)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 20)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 21)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 22)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 23)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 24)
      { root: 39, tones: [0, 4, 7] },  // D#2 maj  (source bar 25)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 26)
      { root: 36, tones: [0, 4, 7] },  // C2 maj  (source bar 27)
      { root: 36, tones: [0, 4, 7] },  // C3 maj  (source bar 28)
      { root: 41, tones: [0, 3, 7] },  // F2 min  (source bar 29)
      { root: 41, tones: [0, 4, 7] },  // F3 maj  (source bar 30)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 31)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 32)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 33)
      { root: 46, tones: [0, 3, 7] },  // A#2 min  (source bar 34)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 35)
      { root: 38, tones: [0, 4, 7] },  // D2 maj  (source bar 36)
      { root: 39, tones: [0, 4, 7] },  // D#2 maj  (source bar 37)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 38)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 39)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 40)
      { root: 37, tones: [0, 4, 7] },  // C#2 maj  (source bar 41)
      { root: 42, tones: [0, 4, 7] },  // F#2 maj  (source bar 42)
      { root: 43, tones: [0, 3, 7] },  // G2 min  (source bar 43)
      { root: 36, tones: [0, 4, 7] },  // C2 maj  (source bar 44)
      { root: 39, tones: [0, 4, 7] },  // D#4 maj  (source bar 45)
      { root: 41, tones: [0, 4, 7] },  // F3 maj  (source bar 46)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 47)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 48)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 49)
      { root: 46, tones: [0, 3, 7] },  // A#2 min  (source bar 50)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 51)
      { root: 38, tones: [0, 4, 7] },  // D2 maj  (source bar 52)
      { root: 39, tones: [0, 4, 7] },  // D#2 maj  (source bar 53)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 54)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 55)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 56)
      { root: 37, tones: [0, 4, 7] },  // C#3 maj  (source bar 57)
      { root: 42, tones: [0, 4, 7] },  // F#2 maj  (source bar 58)
      { root: 36, tones: [0, 4, 7] },  // C2 maj  (source bar 59)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 60)
      { root: 41, tones: [0, 4, 7] },  // F2 maj  (source bar 61)
      { root: 46, tones: [0, 3, 7] },  // A#2 min  (source bar 62)
      { root: 39, tones: [0, 4, 7] },  // D#2 maj  (source bar 63)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 64)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 65)
      { root: 45, tones: [0, 4, 7] },  // A2 maj  (source bar 66)
      { root: 39, tones: [0, 4, 7] },  // D#2 maj  (source bar 67)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 68)
      { root: 36, tones: [0, 4, 7] },  // C3 maj  (source bar 69)
      { root: 46, tones: [0, 4, 7] },  // A#2 maj  (source bar 70)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 71)
      { root: 39, tones: [0, 3, 7] },  // D#2 min  (source bar 72)
      { root: 46, tones: [0, 3, 7] },  // A#2 min  (source bar 73)
      { root: 46, tones: [0, 3, 7] },  // A#2 min  (source bar 74)
    ],
  };

  // ===========================================================================
  // LEAD LINES  (one slot per 16th step; 64 steps = 4 bars)
  // ===========================================================================
  const L = {
    // "Nothing Doing" — a bossa head. Three notes a bar, all of them late, all
    // of them falling: the melody never hurries and never lands on the beat,
    // which is the entire trick to sounding lazy without sounding slow. Bars
    // 1-4 walk down and bars 5-8 answer an octave up, so it reads as a verse
    // and a chorus rather than a loop.
    lagoon: [
      // Fmaj7 — C A F, entering on the "and" of 2
      _, _, _, _, 72, _, _, 69, _, _, 65, _, _, _, _, _,
      // Dm7 — the same shape, one step up the scale
      _, _, _, _, 74, _, _, 72, _, _, 69, _, _, _, _, _,
      // Gm7 — and again, lower
      _, _, _, _, 70, _, _, 69, _, _, 67, _, _, _, _, _,
      // C7 — the phrase turns and climbs back
      _, _, 67, _, 69, _, 70, _, 72, _, _, _, _, _, _, _,
      // Fmaj7 — the answer, an octave up
      _, _, _, _, 77, _, _, 76, _, _, 72, _, _, _, _, _,
      // Am7
      _, _, _, _, 76, _, _, 72, _, _, 69, _, _, _, _, _,
      // Bbmaj7 — the one bar that reaches
      _, _, 70, _, 72, _, 74, _, 77, _, _, _, _, _, _, _,
      // C7 — down, then the leading tone home to F
      _, _, _, _, 74, _, 72, _, 70, _, _, _, 76, _, _, _,
    ],
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
    // 16 bars in E minor. A syncopated hook rather than a wall of 16ths — the
    // sequencer already runs 16th bass and arp underneath, so the lead is what
    // has to be singable. A: hook. A': hook answered, ending on the dominant.
    // B: drums drop, the line floats up. C: the hook an octave up, then a
    // headlong descending run back into bar 1.
    mudslide: [
      // -- A ------------------------------------------------------------------
      76, _, _, 76, _, 79, _, _, 83, _, _, 81, _, _, 79, _,
      76, _, _, _, _, 72, _, 74, _, _, 76, _, _, _, _, _,
      74, _, _, 74, _, 71, _, _, 74, _, _, 79, _, _, 78, _,
      76, _, _, _, _, 78, _, _, 81, _, _, _, _, _, _, _,
      // -- A' -----------------------------------------------------------------
      76, _, _, 76, _, 79, _, _, 83, _, _, 86, _, _, 83, _,
      84, _, _, _, _, 81, _, 79, _, _, 76, _, _, _, _, _,
      78, _, _, 78, _, 81, _, _, 86, _, _, 85, _, _, 83, _,
      83, _, _, 82, _, 78, _, _, 75, _, _, _, 74, _, _, _,
      // -- B (the kit drops out here) -----------------------------------------
      _, _, 81, _, _, _, 84, _, _, _, 88, _, _, _, _, _,
      _, _, 79, _, _, _, 83, _, _, _, 88, _, _, _, 91, _,
      88, _, _, 84, _, 81, _, _, 79, _, _, 76, _, _, 74, _,
      75, _, _, 78, _, 83, _, _, 87, _, _, _, 90, _, _, _,
      // -- C ------------------------------------------------------------------
      88, _, _, 88, _, 91, _, _, 95, _, _, 93, _, _, 91, _,
      88, _, _, _, _, 86, _, 83, _, _, 86, _, _, _, 88, _,
      90, _, _, 90, _, 86, _, _, 83, _, _, 81, _, _, 78, _,
      83, _, 82, _, 81, _, 79, _, 78, _, 76, _, 75, _, 74, _,
    ],
    // Sparse, wistful chamber melody over extended minor harmony.
    chamber: [
      74, _, _, 77, _, 81, _, _, 79, _, 77, _, 74, _, _, _,
      77, _, _, 81, _, 84, _, _, 82, _, 79, _, 77, _, 74, _,
      70, _, _, 74, _, 77, _, _, 81, _, 79, _, 76, _, _, _,
      76, _, _, 72, _, 69, _, 72, 74, _, _, _, 77, _, _, _,
    ],
    // Cute chiptune kung-fu. Strictly A-minor pentatonic (A C D E G) so it reads
    // as wuxia over the Am-G-F-G bounce: a rise, a climb that lands on G, a fall,
    // then a little run home. Square-wave lead, so it lands 8-bit.
    dojo: [
      69, _, 72, _, 76, _, 74, _, 72, _, _, 69, _, _, 67, _,
      69, _, _, 72, _, 74, _, _, 76, _, _, _, 79, _, _, _,
      81, _, 79, _, 76, _, 74, _, 72, _, _, 69, _, _, _, _,
      72, _, 74, _, 76, _, 79, _, 76, _, 74, _, 72, _, 69, _,
    ],
    // The trivia think-cue: a homage to a game-show timer, but voiced in the
    // Japanese "in" scale on A (A Bb D E F). The half-steps Bb->A and F->E are
    // the whole flavour. A steady, pensive phrase that climbs on the dominant
    // (bar 3) and settles back on A, looping like a clock you can't ignore.
    dojoThink: [
      69, _, _, _, 74, _, _, _, 76, _, 77, _, 76, _, _, _,
      74, _, _, _, 70, _, _, _, 69, _, _, _, _, _, _, _,
      76, _, _, _, 77, _, _, _, 81, _, 77, _, 76, _, _, _,
      74, _, 70, _, 69, _, _, _, _, _, _, _, _, _, _, _,
    ],
    // CostBot Hero — "Megabill Mash". A funky A-minor head over Am F C G: stabby,
    // syncopated, and it ranges 65->79 so the falling-note chart derived from it
    // sweeps the whole highway. Verse (bars 1-2) then a climbing turnaround.
    chMegabill: [
      // Am — funk stabs, A up to E and back
      69, _, 72, _, 76, _, 74, 72, _, 69, _, 67, 69, _, _, _,
      // F — lift toward the octave
      65, _, 69, _, 72, _, 77, _, 76, _, 72, _, _, 69, _, _,
      // C — bright answer
      72, _, 76, _, 79, _, 76, 74, _, 72, _, 71, 72, _, _, _,
      // G — climbing turnaround back to the top
      67, _, 71, _, 74, _, 79, _, 78, _, 74, _, 71, _, 74, _,
    ],
    // CostBot Hero — "Graviton Groove". Fast E-minor drive over Em C G D with a
    // blue note; wide leaps so the hard chart hits every lane. The B->D climb in
    // the last bar is the hook that resolves back to the top of the loop.
    chGraviton: [
      // Em — gallop up the triad
      64, _, 67, _, 71, _, 74, _, 71, _, 67, _, 64, _, _, _,
      // C — turn and fall, blue note on the way down
      72, _, _, 71, _, 67, _, 64, _, 67, _, 71, _, 72, _, _,
      // G — reach for the octave
      74, _, 71, _, 67, _, 71, _, 74, _, 79, _, 76, _, 74, _,
      // D — the climb-and-drop hook
      66, _, 69, _, 74, _, 78, _, 76, _, 74, _, 69, _, 66, _,
    ],
    // CostBot Hero — "Imperial Markup". 16 bars. A: the theme (G G G / Eb–Bb, the
    // dotted Bb on the 'a' of 4 is the menace). B: the lyrical middle rises and
    // leans on the leading tone. C: the big statement an octave up. D: a dark
    // sparse bridge (kit drops) then a fill back to the march. Held notes = long cuts.
    chImperial: [
      // -- A: the theme -------------------------------------------------------
      67, _, _, _, 67, _, _, _, 67, _, _, _, 63, _, _, 70,      // Gm  G G G Eb Bb
      67, _, _, _, 63, _, _, 70, 67, _, _, _, _, _, _, _,       // Gm  G Eb Bb G (ring)
      74, _, _, _, 74, _, _, _, 74, _, _, _, 75, _, _, 70,      // Eb  D D D Eb Bb
      67, _, _, _, 63, _, _, 70, 67, _, _, _, _, _, _, _,       // D   G Eb Bb G
      // -- B: the lyrical middle ---------------------------------------------
      70, _, _, _, 72, _, _, _, 74, _, _, _, 75, _, _, 74,      // Gm  Bb C D Eb D
      72, _, _, _, 70, _, _, _, 67, _, _, _, 63, _, _, _,       // Gm  C Bb G Eb
      70, _, _, _, 72, _, _, _, 74, _, _, _, 79, _, _, 75,      // Eb  Bb C D G Eb
      74, _, _, _, 70, _, _, _, 67, _, _, _, 66, _, _, _,       // D   D Bb G F# (tension)
      // -- C: the big statement, octave up -----------------------------------
      79, _, _, _, 79, _, _, _, 79, _, _, _, 75, _, _, 82,      // Cm  G G G Eb Bb (up 8ve)
      79, _, _, _, 75, _, _, 82, 79, _, _, _, _, _, _, _,       // Cm  G Eb Bb G
      86, _, _, _, 86, _, _, _, 86, _, _, _, 87, _, _, 82,      // Gm  D D D Eb Bb (peak 87)
      79, _, _, _, 75, _, _, 82, 79, _, _, _, _, _, _, _,       // D   G Eb Bb G
      // -- D: dark bridge (kit drops) then fill ------------------------------
      63, _, _, _, _, _, _, _, 58, _, _, _, _, _, _, _,         // Eb  Eb ... Bb (sparse)
      62, _, _, _, _, _, _, _, 66, _, _, _, _, _, _, _,         // D   D ... F# (sparse)
      67, _, _, _, 67, _, _, _, 67, _, _, _, 63, _, _, 70,      // Gm  the theme returns
      67, _, _, _, 63, _, _, 70, 63, _, 66, _, 67, _, _, _,     // Gm  fill/turnaround
    ],
    // CostBot Hero — "The Savengers". The actual Avengers theme (Silvestri),
    // transcribed from MIDI into a faithful 16-bar loop: the low ostinato intro,
    // the heroic melody, the same melody an octave up, then the melody again.
    // Rocked up in the track config (fast, double-kick, distorted).
    chAvengers: [
      // ostinato intro
      62, 62, 62, _, _, _, 62, 62, 62, _, _, _, 62, 62, 62, 62,
      63, 63, 63, _, _, _, 63, 63, 64, _, _, _, 64, 64, 64, 64,
      65, 65, 65, _, _, _, 65, 65, 64, _, _, _, 64, 64, 64, 64,
      63, 63, 63, _, _, _, 63, 63, 58, _, _, _, 60, _, _, _,
      // the theme
      67, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      74, _, _, _, 72, _, _, 70, 70, _, _, _, 72, _, _, 74,
      74, _, _, _, 67, _, _, _, _, _, _, _, _, _, _, _,
      74, _, _, _, 72, _, _, 70, 70, _, _, _, 69, _, _, _,
      // the theme, an octave up (triumphant)
      79, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      86, _, _, _, 84, _, _, 82, 82, _, _, _, 84, _, _, 86,
      86, _, _, _, 79, _, _, _, _, _, _, _, _, _, _, _,
      86, _, _, _, 84, _, _, 82, 82, _, _, _, 81, _, _, _,
      // the theme again, resolving into the loop
      67, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      74, _, _, _, 72, _, _, 70, 70, _, _, _, 72, _, _, 74,
      74, _, _, _, 67, _, _, _, _, _, _, _, _, _, _, _,
      74, _, _, _, 72, _, _, 70, 70, _, _, _, 69, _, _, _,
    ],
    // CostBot Hero — "It's a Small Cost". It's a Small World, transcribed from MIDI:
    // the verse then the "…small world after all" chorus, in C major. Arranged as an
    // electro light parade in the track config (four-on-floor, 16th arp, sub bass).
    chSmall: [
      _, _, _, _, 64, _, 65, _, 67, _, _, _, 76, _, _, _,   // verse
      72, _, _, _, 74, _, 72, _, 72, _, _, _, 71, _, _, _,
      71, _, _, _, 62, _, 64, _, 65, _, _, _, 74, _, _, _,
      71, _, _, _, 72, _, 71, _, 69, _, _, _, 67, _, _, _,
      67, _, _, _, 64, _, 65, _, 67, _, _, _, 72, _, 74, _,
      76, _, _, _, 74, _, 72, _, 69, _, _, _, 74, _, 76, _,
      77, _, _, _, 76, _, 74, _, 67, _, _, _, 77, _, _, _,
      76, _, _, _, 74, _, _, _, 72, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, 72, _, _, _, _, _, 72, _,     // chorus
      76, _, _, _, 72, _, _, _, 74, _, _, _, _, _, 74, _,
      74, _, _, _, _, _, _, _, 74, _, _, _, _, _, 74, _,
      77, _, _, _, 74, _, _, _, 76, _, _, _, _, _, 76, _,
      76, _, _, _, _, _, _, _, 76, _, _, _, _, _, 76, _,
      79, _, _, _, 76, _, _, _, 77, _, _, _, _, _, 77, _,
      77, _, _, _, 76, _, 74, _, 67, _, _, _, _, _, _, _,
      71, _, _, _, _, _, _, _, 72, _, _, _, _, _, _, _,
    ],
    // CostBot Hero — "Electrical Spendarade". The Main St. Electrical Parade theme
    // (Baroque Hoedown), transcribed from MIDI (dropped an octave) as an A-A-B-A
    // loop. Busy 16th runs = the bouncy parade sparkle; arranged electro in config.
    chParade: [
      67, _, 71, 72, 74, _, 67, _, 64, _, 69, 67, 66, 64, 66, 62,
      67, _, 67, 69, 71, 69, 67, 66, 64, _, 69, _, 66, 64, 66, 62,
      67, _, 71, 72, 74, _, 67, _, 64, _, 69, 67, 66, 64, 66, 62,
      67, 69, 71, 67, 69, 71, 69, 67, 66, 64, 66, 62, 67, _, _, _,
      67, _, 71, 72, 74, _, 67, _, 64, _, 69, 67, 66, 64, 66, 62,
      67, _, 67, 69, 71, 69, 67, 66, 64, _, 69, _, 66, 64, 66, 62,
      67, _, 71, 72, 74, _, 67, _, 64, _, 69, 67, 66, 64, 66, 62,
      67, 69, 71, 67, 69, 71, 69, 67, 66, 64, 66, 62, 67, _, _, _,
      79, _, 79, _, 78, _, 74, _, 76, _, 69, _, 74, _, _, _,
      71, _, 67, _, 69, _, 66, _, 67, _, 64, _, 62, _, _, _,
      71, _, _, _, 69, _, 74, _, 76, _, 73, _, 74, _, _, _,
      71, _, 67, _, 69, _, 66, _, 67, _, 64, _, 62, _, _, _,
      67, _, 71, 72, 74, _, 67, _, 64, _, 69, 67, 66, 64, 66, 62,
      67, _, 67, 69, 71, 69, 67, 66, 64, _, 69, _, 66, 64, 66, 62,
      67, _, 71, 72, 74, _, 67, _, 64, _, 69, 67, 66, 64, 66, 62,
      67, 69, 71, 67, 69, 71, 69, 67, 66, 64, 66, 62, 67, _, _, _,
    ],
    // CostBot Hero — "Fiscal Jeopardy". The Jeopardy "Think!" theme from MIDI: the
    // main vamp, then the same phrase up a minor third (the trademark key change).
    chJeopardy: [
      79, _, _, _, 84, _, _, _, 79, _, _, _, 72, _, 72, _,
      79, _, _, _, 84, _, _, _, 79, _, _, _, 71, _, _, _,
      79, _, _, _, 84, _, _, _, 79, _, _, _, 84, _, _, _,
      88, _, _, _, _, _, 86, _, 84, _, 83, _, 81, _, 80, _,
      79, _, _, _, 84, _, _, _, 79, _, _, _, 72, _, 72, _,
      79, _, _, _, 84, _, _, _, 79, _, _, _, _, _, _, _,
      84, _, _, _, _, _, 81, _, 79, _, _, _, 77, _, _, _,
      76, _, _, _, 74, _, _, _, 72, _, _, _, _, _, _, _,
      82, _, _, _, 87, _, _, _, 82, _, _, _, 75, _, 75, _,
      82, _, _, _, 87, _, _, _, 82, _, _, _, 74, _, _, _,
      82, _, _, _, 87, _, _, _, 82, _, _, _, 87, _, _, _,
      91, _, _, _, _, _, 89, _, 87, _, 86, _, 84, _, 83, _,
      82, _, _, _, 87, _, _, _, 82, _, _, _, 75, _, 75, _,
      82, _, _, _, 87, _, _, _, 82, _, _, _, _, _, _, _,
      87, _, _, _, _, _, 84, _, 82, _, _, _, 80, _, _, _,
      79, _, _, _, _, _, _, _, 77, _, _, _, _, _, _, _,
    ],
    // "Blind Spend" (dd.mid), transcribed from MIDI and dropped an octave for a
    // deeper, less shrill lead: an 8-bar 8th-note ostinato (G–Eb–D–C, the top
    // note lifting a semitone under the Ab/Fm bars), then the sparse, held-note
    // theme that answers it. Faithful to the source's rests, an octave down.
    blindHero: [
      // -- ostinato, bars 1-8 (top note tracks the chord: G over Cm, G# over Ab/Fm) --
      55, _, 51, _, 50, _, 48, _, 55, _, 51, _, 50, _, 48, _,
      55, _, 51, _, 50, _, 48, _, 55, _, 51, _, 50, _, 48, _,
      56, _, 51, _, 50, _, 48, _, 56, _, 51, _, 50, _, 48, _,
      56, _, 51, _, 50, _, 48, _, 56, _, 51, _, 50, _, 48, _,
      56, _, 51, _, 50, _, 48, _, 56, _, 51, _, 50, _, 48, _,
      56, _, 51, _, 50, _, 48, _, 56, _, 51, _, 50, _, 48, _,
      55, _, 51, _, 50, _, 48, _, 55, _, 51, _, 50, _, 48, _,
      55, _, 51, _, 50, _, 48, _, 55, _, 51, _, 50, _, 48, _,
      // -- the theme, bars 9-16 (sparse, held) ------------------------------
      63, _, _, _, _, _, _, _, 62, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      63, _, _, _, 67, _, _, _, 65, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      65, _, _, _, _, _, _, _, 60, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      63, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      62, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
    ],
    // "Great Fairy Fountain" (music-box arrangement), transcribed from MIDI note
    // for note: a constant 8th-note broken-chord cascade (the source's own
    // "music box" track), 16 bars, looping straight back to the top. The last
    // group's tail is completed to close the loop cleanly (the source file cuts
    // off mid-chord at the loop point).
    chFairy: [
      81, _, 74, _, 70, _, 67, _, 79, _, 74, _, 70, _, 67, _,
      78, _, 74, _, 70, _, 67, _, 79, _, 74, _, 70, _, 67, _,
      79, _, 72, _, 69, _, 65, _, 77, _, 72, _, 69, _, 65, _,
      76, _, 72, _, 69, _, 65, _, 77, _, 72, _, 69, _, 65, _,
      77, _, 70, _, 67, _, 64, _, 76, _, 70, _, 67, _, 64, _,
      75, _, 70, _, 67, _, 64, _, 76, _, 70, _, 67, _, 64, _,
      76, _, 69, _, 65, _, 62, _, 74, _, 69, _, 65, _, 62, _,
      73, _, 69, _, 65, _, 62, _, 74, _, 69, _, 65, _, 62, _,
      81, _, 74, _, 70, _, 67, _, 79, _, 74, _, 70, _, 67, _,
      78, _, 74, _, 70, _, 67, _, 79, _, 74, _, 70, _, 67, _,
      82, _, 75, _, 72, _, 66, _, 81, _, 75, _, 72, _, 66, _,
      80, _, 75, _, 72, _, 66, _, 81, _, 75, _, 72, _, 66, _,
      84, _, 74, _, 70, _, 67, _, 82, _, 74, _, 70, _, 67, _,
      81, _, 74, _, 70, _, 67, _, 82, _, 74, _, 70, _, 67, _,
      81, _, 70, _, 67, _, 64, _, 79, _, 70, _, 67, _, 64, _,
      77, _, 70, _, 67, _, 64, _, 76, _, 70, _, 67, _, 64, _,
    ],
    // "The Gold Saucer", transcribed from MIDI (dropped an octave — the source
    // sat up around C6-E7, too shrill at pitch). The file carries a second
    // melodic layer alongside this one (a smoother scalar line, doubled by
    // Strings + a 2-step delay echo) that reads as more conventionally
    // "tune-like" on paper, but ear-checked against the source it's the
    // decorative countermelody — THIS wide-leap, chromatic-inflected line
    // (Clarinet/Synth/Synth-oct, all three doubling it) is the real hook.
    // 22 bars: an 8-bar A section (a 4-bar phrase stated twice) over the G
    // pedal, an 8-bar diatonic bridge, then a 6-bar close that echoes the top
    // of the A section.
    chGoldSaucer: [
      74, _, 79, _, 78, _, 79, 81, 83, _, 79, _, 81, 83, 84, 88,
      86, _, 79, _, 86, _, 79, _, 81, 79, 78, 79, 81, _, 76, _,
      74, _, 79, _, 78, _, 79, 81, 83, _, 79, _, 81, _, 83, 84,
      86, _, 79, _, 88, _, 79, _, 83, 81, 79, 78, 79, _, _, _,
      74, _, 79, _, 78, _, 79, 81, 83, _, 79, _, 81, 83, 84, 88,
      86, _, 79, _, 86, _, 79, _, 81, 79, 78, 79, 81, _, 76, _,
      74, _, 79, _, 78, _, 79, 81, 83, _, 79, _, 81, _, 83, 84,
      86, _, 79, _, 88, _, 79, _, 83, 81, 79, 78, 79, _, _, _,
      78, 79, 81, 83, 81, _, 86, _, 85, _, 88, _, 81, _, 83, 85,
      86, _, 83, _, 81, _, 79, _, 78, _, 76, 79, 78, _, 74, _,
      73, _, 74, _, 76, _, _, 74, 76, _, 78, _, 79, _, _, 78,
      79, _, 81, _, 83, 81, 79, 78, 76, 78, 79, 78, 76, _, _, _,
      78, 79, 81, 83, 81, _, 86, _, 85, _, 88, _, 81, _, 83, 85,
      86, _, 83, _, 81, _, 79, _, 78, _, 79, _, 81, _, _, _,
      76, _, 79, _, 78, _, 74, _, 76, _, _, _, _, _, _, 74,
      76, _, 79, _, 78, _, 74, _, 76, _, _, _, 76, _, _, _,
      79, _, 83, _, 81, _, 78, _, 79, _, _, _, _, _, _, 78,
      79, _, 83, _, 81, _, 78, _, 79, _, _, _, 79, _, _, _,
      76, _, 79, _, 78, _, 74, _, 76, _, _, _, _, _, _, 74,
      76, _, 79, _, 78, _, 74, _, 76, _, _, _, 76, _, _, _,
      79, _, 83, _, 81, _, 78, _, 79, _, _, _, _, _, _, 78,
      79, _, 83, _, 81, 83, 84, 88, 86, _, 79, _, 78, _, _, _,
    ],
    // "Lost Woods", transcribed from MIDI, dropped an octave for the
    // "deeper, guitar" register requested — see voices.lead: 'dist' on the
    // track config below. An earlier pass also filled the long rests (esp.
    // the two full bars where only the source's Pizzicato ostinato carried
    // on) with invented connecting melody; that read as unwanted, so this is
    // back to the real transcription's own silences. The piano-voiced arp on
    // the track config still keeps some motion through those bars.
    lostWoods: [
      65, _, 69, _, 71, _, _, _, 65, _, 69, _, 71, _, _, _,
      65, _, 69, _, 71, _, 76, _, 74, _, _, _, 71, _, 72, _,
      71, _, 67, _, 64, _, _, _, _, _, _, _, _, _, 62, _,
      64, _, 67, _, 64, _, _, _, _, _, _, _, _, _, _, _,
      65, _, 69, _, 71, _, _, _, 65, _, 69, _, 71, _, _, _,
      65, _, 69, _, 71, _, 76, _, 74, _, _, _, 71, _, 72, _,
      76, _, 71, _, 67, _, _, _, _, _, _, _, _, _, 71, _,
      67, _, 62, _, 64, _, _, _, _, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      62, _, 64, _, 65, _, _, _, 67, _, 69, _, 71, _, _, _,
      72, _, 74, _, 79, _, _, _, _, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      62, _, 60, _, 65, _, 64, _, 67, _, 65, _, 69, _, 67, _,
      71, _, 69, _, 72, _, 71, _, 74, _, 72, _, 76, 77, 76, 74,
      76, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
    ],
    // "X-pense", transcribed from MIDI. Bars 1-2 are the file's own intro —
    // the Strings lead hasn't entered yet, only the "Metro Bass" ostinato
    // plays (see L.xmenBass) — so those two bars here are that same ostinato
    // duplicated into the lead line, making it the charted, playable opening
    // hook instead of dead air before the real melody starts (it keeps
    // playing underneath afterward regardless — see bassLine on
    // TRACKS.ch_xmen — this is just so the iconic riff is also something you
    // hit, not just something you hear). From bar 3 on it's the real hook:
    // the file's melody lives in the Strings track — a chord-pad intro (bars
    // 3-8, held C6/G6/E7 stabs) that resolves into the wide-leap riff proper
    // (bar 9 on), stated twice, an 8th-note descending-scale bridge (bars
    // 13-16, played twice more later), and a closing tag echoing the riff's
    // open.
    xmen: [
      _, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      84, _, _, _, 84, _, _, _, 84, _, _, _, 84, _, _, _,
      84, _, _, _, 84, _, _, _, 84, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 79, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 80, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 87, _, _, _, _, _, _, _, _, _,
      86, _, 84, _, 79, _, _, 80, 84, _, _, _, 77, 84, 89, _,
      91, _, _, _, 89, _, 84, _, _, _, _, _, 77, 84, 89, _,
      91, _, _, _, 89, _, 85, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 87, _, _, _, _, _, _, _, _, _,
      86, _, 84, _, 79, _, _, 80, 84, _, _, _, _, _, _, _,
      80, 79, _, 77, 80, 79, _, 77, 80, 79, _, 77, 80, 79, _, 77,
      82, 80, _, 79, 82, 80, _, 79, 82, 80, _, 79, 82, 80, _, 79,
      84, 82, _, 80, 84, 82, _, 80, 84, 82, _, 80, 82, 84, _, _,
      91, _, _, _, _, _, _, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 79, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 80, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 87, _, _, _, _, _, _, _, _, _,
      86, _, 84, _, 79, _, _, 80, 84, _, _, _, 77, 84, 89, _,
      91, _, _, _, 89, _, 84, _, _, _, _, _, 77, 84, 89, _,
      91, _, _, _, 89, _, 85, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 87, _, _, _, _, _, _, _, _, _,
      86, _, 84, _, 79, _, _, 80, 84, _, _, _, _, _, _, _,
      80, 79, _, 77, 80, 79, _, 77, 80, _, _, 82, 84, 82, _, 80,
      82, 80, _, 79, 82, 80, _, 79, 82, _, _, 84, 86, _, 84, 82,
      84, _, 82, 80, 84, _, 82, 80, 87, _, 86, 84, 86, _, 87, _,
      91, _, _, _, _, _, _, _, _, _, _, _, 72, 79, 84, 87,
      86, _, _, _, 84, _, 87, _, _, _, _, _, 91, _, _, _,
      84, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
    ],
    // "Metro Bass" — the Synth Bass track's own ostinato (that's its actual
    // GarageBand track name in the source file), transcribed note-for-note
    // rather than reduced to a per-bar root: a steady 8th-note pulse that
    // alternates the bar's root with its bVI every half-bar (C/Ab, F/Db,
    // etc.) — the "metronome" it's named for. Runs alone for bars 1-2 (the
    // Strings lead hasn't entered yet) and then continues unchanged as the
    // rhythm bed under the whole song — see bassLine on TRACKS.ch_xmen.
    xmenBass: [
      _, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      41, 41, 41, 41, 41, 41, 41, 41, 37, 37, 37, 37, 37, 37, 37, 37,
      41, 41, 41, 41, 41, 41, 41, 41, 37, 37, 37, 37, 37, 37, 37, 37,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
      32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
      29, 29, 29, 29, 29, 29, 29, 29, 26, 26, 26, 26, 26, 26, 26, 26,
      31, 31, 31, 31, 31, 31, 31, 31, 31, _, _, _, _, _, _, _,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      41, 41, 41, 41, 41, 41, 41, 41, 37, 37, 37, 37, 37, 37, 37, 37,
      41, 41, 41, 41, 41, 41, 41, 41, 37, 37, 37, 37, 37, 37, 37, 37,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
      32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
      29, 29, 29, 29, 29, 29, 29, 29, 26, 26, 26, 26, 26, 26, 26, 26,
      31, 31, 31, 31, 31, 31, 31, 31, 31, _, _, _, _, _, _, _,
      36, 36, 36, 36, 36, 36, 36, 36, 32, 32, 32, 32, 32, 32, 32, 32,
      24, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
    ],
    // "Fight On!", transcribed from MIDI. Full instrumentation, not a single
    // isolated track: each step takes the HIGHEST note sounding across every
    // melodic layer (Electric Guitar, French Horn, Smooth Synth, Distortion
    // Guitar, Violin, 8-Bit Sine) — the source doubles its big hits across
    // several instruments in unison, so no single track has the whole tune on
    // its own. 16 bars: a quiet, rising 8th-note ostinato (bars 1-8, the pedal
    // walking Am->Cm) that erupts into the famous unison brass/string hits
    // (bars 9-16 — long tied notes here, syncopated 16ths in the source).
    ffFightOn: [
      45, 45, _, 45, 48, _, _, _, 45, 45, _, 45, 50, _, _, _,
      45, 45, _, 45, 51, 50, _, 48, 50, 48, _, 47, 48, _, _, 47,
      45, 45, _, 45, 48, _, _, _, 45, 45, _, 45, 50, _, _, _,
      45, 45, _, 45, 51, 50, _, 48, 50, 48, _, 47, 48, _, _, 47,
      48, 48, _, 48, 51, _, _, _, 48, 48, _, 48, 53, _, _, _,
      48, 48, _, 48, 54, 53, _, 51, 53, 51, _, 50, 51, _, _, 50,
      48, 48, _, 48, 51, _, _, _, 48, 48, _, 48, 53, _, _, _,
      48, 48, _, 48, 54, 53, _, 51, 69, 70, 71, 50, 72, 73, 74, 75,
      76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76,
      76, 76, 76, 76, 76, 76, _, 48, 78, 48, _, 78, 48, 78, _, 47,
      76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76,
      76, 76, 76, 76, 76, 76, _, 48, 78, 48, _, 78, 48, 78, _, 47,
      79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79,
      79, 79, 79, 79, 79, 79, _, 51, 81, 51, _, 81, 51, 81, _, 50,
      79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79, 79,
      79, 79, 79, 79, 79, 79, _, 51, 81, 51, _, 81, 51, 81, _, 50,
    ],
    // "Legend of CostBot", transcribed from MIDI. Solo electric piano, one
    // track: each step takes the TOP note sounding (the bass note and the
    // parallel 2-note chord below it are the accompaniment — see P above).
    // 22 bars: a rocking chromatic-descent A section (bars 1-16) opens into a
    // freer B section (bars 17-22) with an actual single-note scale run
    // (around bar 20) instead of the block chords. Ends here, one bar before
    // the source's own bars 22-25 repeat bars 10-13 verbatim (see P above).
    legendOfCostbot: [
      70, _, _, _, 46, 46, _, 46, 46, _, _, 70, 70, 70, _, 70,
      70, _, _, 68, 70, 44, _, 44, 44, _, _, 70, 70, 70, _, 70,
      70, _, _, 68, 70, 42, _, 42, 42, _, _, 70, 70, 70, _, 70,
      70, _, 65, 65, 65, _, 65, 65, 65, _, 65, 65, 65, _, 65, _,
      70, _, _, _, 65, 62, _, 60, 62, _, 70, _, 70, 72, 74, 75,
      77, _, 70, _, 70, 72, 74, 75, 44, _, 77, _, 77, 78, _, 80,
      82, _, 66, _, 66, 68, 70, 72, 73, _, 82, 73, 82, 80, _, 78,
      80, _, _, 78, 77, 68, _, 66, 68, _, _, 68, 77, 68, _, 68,
      75, _, 75, 77, 78, 47, 66, 68, 70, _, _, _, 77, 47, 75, 47,
      73, _, 73, 75, 77, 46, 65, 66, 68, _, _, _, 75, _, 73, 46,
      72, _, 72, 74, 76, _, 64, 65, 67, _, 67, 69, 79, _, 72, 48,
      77, _, 65, 65, 65, _, 65, 65, 65, _, 65, 65, 65, _, 65, _,
      70, _, _, _, 65, _, 62, 60, 62, _, 70, _, 70, 72, 74, 75,
      77, _, 70, _, 70, 72, 74, 75, 44, _, 77, _, 77, _, 78, 80,
      82, _, _, _, 42, _, 42, 40, 42, _, _, _, 85, _, _, _,
      84, _, _, _, 81, _, 41, 39, 41, _, _, _, 77, _, _, _,
      78, _, 46, 49, 52, _, 58, 61, 64, _, _, _, 82, _, _, _,
      81, _, _, _, 77, _, 41, 41, 41, _, _, _, 77, _, _, _,
      78, _, 46, 49, 52, _, 58, 61, 64, _, _, _, 82, _, _, _,
      81, _, _, _, 77, _, 41, 41, 41, _, _, _, 74, _, _, _,
      75, _, _, _, 47, _, 47, 46, 47, _, _, _, 78, _, 47, 47,
      77, _, _, _, 73, _, 46, 44, 46, _, _, _, 70, _, 46, 46,
    ],
    // "Kalm Before the Bill", transcribed from MIDI (FF7 · Kalm). The source
    // is a solo fingerstyle-guitar arrangement on one track — this is the
    // upper voice (register >= 70), the actual tune, note-for-note. The full
    // 17-bar source (the whole file — it's short) rather than an excerpt.
    kalm: [
      81, _, 79, _, 78, _, 79, _, 81, _, _, _, 71, _, 74, _,
      78, _, 76, _, 76, _, _, _, _, _, _, _, _, _, _, _,
      76, _, 83, _, 81, _, 79, _, 81, _, _, _, _, _, 83, 85,
      86, _, 83, _, 83, _, _, _, _, _, _, _, _, _, _, _,
      83, _, 84, _, 83, _, 81, _, 79, _, _, _, 81, _, _, _,
      83, _, 71, _, 72, _, 74, _, 78, _, 76, _, _, _, _, _,
      _, _, 76, _, 78, _, 79, _, 81, _, _, _, _, _, _, _,
      _, _, 79, _, 81, _, 83, _, 84, _, _, _, _, _, _, _,
      81, _, 79, _, 78, _, 79, _, 81, _, _, _, 71, _, 74, _,
      78, _, 76, _, 76, _, _, _, 73, _, _, _, _, _, _, _,
      76, _, 83, _, 81, _, 79, _, 81, _, _, _, _, _, 83, 85,
      86, _, 83, _, 83, _, _, _, _, _, _, _, _, _, _, _,
      83, _, 84, _, 83, _, 81, _, 79, _, _, _, 81, _, _, _,
      83, _, 71, _, 72, _, 74, _, 78, _, 76, _, _, _, _, _,
      76, _, 83, _, 81, _, 79, _, 81, _, _, _, _, _, 78, _,
      78, _, 79, _, 79, _, _, _, _, _, _, _, _, _, _, _,
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
    ],
    // The left-hand accompaniment for "Kalm Before the Bill" — the source's
    // own alternating Travis-picking bass (register < 70), transcribed
    // note-for-note; tuned to a heavily-filtered, muffled "lofi bass" tone
    // via bassLine (see TRACKS.ch_kalm) rather than a bright acoustic pluck.
    kalmBass: [
      43, _, 55, _, 59, _, 55, _, 67, _, 55, _, 59, _, 55, _,
      40, _, 55, _, 59, _, 55, _, 64, _, 55, _, 59, _, 55, _,
      45, _, 57, _, 60, _, 64, _, 38, _, 57, _, 62, _, 66, _,
      47, _, 59, _, 62, _, 59, _, 66, _, 59, _, 62, _, 59, _,
      48, _, 60, _, 64, _, 67, _, 48, _, 58, _, 63, _, 67, _,
      43, _, 55, _, 59, _, 67, _, 40, _, 55, _, 59, _, 64, _,
      45, _, 57, _, 60, _, 57, _, 64, _, 57, _, 60, _, 57, _,
      45, _, 51, _, 57, _, 60, _, 50, _, 57, _, 60, _, 66, _,
      43, _, 55, _, 59, _, 55, _, 67, _, 55, _, 59, _, 55, _,
      40, _, 55, _, 59, _, 55, _, 64, _, 55, _, 59, _, 55, _,
      45, _, 57, _, 60, _, 64, _, 38, _, 57, _, 62, _, 66, _,
      47, _, 59, _, 62, _, 59, _, 66, _, 59, _, 62, _, 59, _,
      48, _, 60, _, 64, _, 67, _, 48, _, 58, _, 63, _, 67, _,
      43, _, 55, _, 59, _, 67, _, 40, _, 55, _, 59, _, 64, _,
      45, _, 57, _, 60, _, 64, _, 50, _, 57, _, 62, _, 66, _,
      43, _, 55, _, 59, _, 55, _, 67, _, 55, _, 59, _, 55, _,
      43, _, 55, _, 59, _, 55, _, 67, _, 55, _, 59, _, 55, _,
    ],
    // "Fiscalicia" — straight off the source's top note each step (the
    // source is a single polyphonic piano track, not separate instrument
    // tracks like ch_gameofloans, so there's no second voice to splice in
    // for the two sparse bars below; the sustain-pedalled arpeggio itself
    // never repeats an identical pitch back-to-back anywhere in these 32
    // bars, so — unlike ch_gameofloans/ch_kalm's source files — there's no
    // quantization-retrigger artifact here to collapse; every onset below is
    // already a genuine, distinct melodic event straight off the MIDI).
    // Bars 0-3 (i): the sparse, high opening — a falling C6-G5-F5 arpeggio
    // each bar, answered by a low D4/Eb4 close. Bars 4-9 (iv-iv/III-III/
    // iv-iv): the texture thickens as the phrase turns over. Bars 10-11 (i)
    // return to the opening register. Bars 12-13 (bVII-bVI) are the widest
    // statement so far (up to D6/Eb6). Bars 14-17 repeat the 6-9 turn.
    // Bars 18-19 (III-V) are the cadence — bar 19 is almost silent (a single
    // D5 dyad), the one real "breath" in the excerpt, resolving quietly to
    // the bar-20 (i) recap, itself just as sparse. Bars 21-31 build back up
    // through the same turnaround harmony, climbing into the top of the
    // register (D6/Eb6 recur constantly) right where the excerpt cuts off.
    // Onset-to-onset gap histogram (138 gaps between the 139 onsets, in
    // 16th-note steps): 1:11, 2:29, 3:59, 4:14, 5:5, 6:3, 7:4, 8:1, 9:3,
    // 10:6, 11:1, 12:1, 19:1. Median gap is 3 steps (typical); 13 gaps of
    // 8+ steps (bars 6-7, 9-12, 18-22, 24-26, 28-29 — spread across the
    // piece, not one isolated spot) total 137 steps, 26.8% of the excerpt's
    // runtime — a genuinely sparse chart in places, not a chart-thinning
    // artifact (same picture holds at every minGap, including Ultra's 1,
    // which keeps all 139 real onsets). See TRACKS.ch_fiscalicia's "Round 3"
    // comment for how this was used to pick a tempo fix over a sustain-only
    // one.
    fiscalicia: [
      84, _, _, 79, _, _, 77, _, 62, _, _, _, 63, _, _, _,  // bar 0
      _, _, _, 84, _, 82, _, _, 75, _, _, 63, _, _, 65, _,  // bar 1
      _, _, _, _, _, 79, _, _, 77, _, 68, _, _, 62, _, _,  // bar 2
      63, _, _, 65, _, 67, 75, _, _, 74, _, 67, _, _, 75, 63,  // bar 3
      _, _, 74, _, _, 75, _, _, _, _, 72, 79, _, _, _, _,  // bar 4
      75, _, 77, _, _, 60, _, _, 65, _, _, _, _, 80, _, _,  // bar 5
      79, _, 77, _, _, 75, _, _, 74, _, _, 70, _, _, _, _,  // bar 6
      _, _, _, _, _, 67, _, _, _, _, 75, _, 74, _, _, 67,  // bar 7
      _, _, 64, _, _, 73, _, _, 72, _, _, _, _, _, 68, _,  // bar 8
      72, _, 77, _, 80, _, _, 84, _, _, 74, 86, _, _, _, _,  // bar 9
      _, _, _, _, 84, _, _, 83, _, _, 72, 79, 84, _, _, _,  // bar 10
      _, _, _, _, _, _, _, 79, _, _, 65, 70, 77, _, _, _,  // bar 11
      _, _, _, _, _, _, 86, _, 84, _, _, 65, 75, _, _, _,  // bar 12
      _, _, 67, _, _, _, _, _, _, 82, _, _, 80, _, _, 72,  // bar 13
      _, _, 84, _, 79, _, 77, _, 75, _, _, 74, _, _, 72, _,  // bar 14
      _, 72, _, 75, _, _, 79, _, 84, _, 87, _, _, 77, 86, _,  // bar 15
      _, _, _, _, 60, _, _, 62, _, 87, _, _, 86, _, 62, _,  // bar 16
      _, 65, _, 71, _, 74, _, _, 77, _, _, 79, _, 80, _, _,  // bar 17
      79, _, _, 77, _, _, _, _, _, _, _, _, _, _, _, 75,  // bar 18
      _, _, _, _, _, _, _, _, 74, _, _, _, _, _, _, _,  // bar 19
      _, _, _, _, _, _, _, _, _, _, _, 79, _, _, 84, _,  // bar 20
      _, _, 87, _, _, 86, _, _, _, _, _, _, _, _, _, 87,  // bar 21
      _, 86, _, _, 79, _, _, _, _, _, _, _, _, _, 82, _,  // bar 22
      _, _, 84, _, _, _, _, _, _, 67, _, _, _, 65, _, _,  // bar 23
      _, 68, _, _, 77, _, _, _, 80, _, _, 84, _, _, 80, 84,  // bar 24
      _, _, _, _, _, _, _, 83, _, _, 84, _, 86, _, _, _,  // bar 25
      _, _, _, _, _, _, 84, _, _, _, 83, _, _, 62, _, _,  // bar 26
      _, 67, _, _, _, 65, _, _, _, 63, _, _, 79, _, _, _,  // bar 27
      84, _, _, 87, _, _, _, 86, _, _, _, _, _, _, _, _,  // bar 28
      87, _, 86, _, _, 79, _, _, _, _, _, _, _, _, _, 82,  // bar 29
      _, _, _, 83, _, _, 79, _, 83, _, 84, _, _, 86, _, 87,  // bar 30
      _, _, 87, _, _, _, _, 72, _, _, 68, _, _, _, 65, _,  // bar 31
    ],
    // "Game of Loans", transcribed from MIDI (Game of Thrones · main title
    // theme). Violin carries the tune, and whenever it drops out Cello is
    // actually still sounding underneath (continuing the same line, not
    // resting), so that continuation is spliced in instead (up an octave, so
    // it reads as the same voice throughout) — a per-STEP splice, not
    // per-bar, since bars 4, 5, 11 and 13 have Violin resting for only part
    // of the bar while Cello carries it the rest of the way; no gap anywhere
    // in the whole 33 bars.
    // The source MIDI retriggers every held pitch every single step (a
    // quantization artifact of whatever tool generated it — even a
    // multi-beat sustained tone comes out as N identical repeated note_ons,
    // not one long one), so a literal transcription reads as a note onset
    // almost everywhere and buries the actual tune under that noise: any
    // difficulty's minGap thinning ends up picking whichever repeat happens
    // to fall in its window as often as it picks a real change in pitch, so
    // the chart tracks "one note every N steps" (the beat) rather than the
    // melody. Collapsed here to one onset per real pitch change — the
    // repeated G-G/C-C of the low hook becomes one G, one C (still its own
    // onset, just once) and the long tones in the rising middle section
    // (bars 21-32) become genuine held notes — so every kept note at every
    // difficulty is guaranteed to be a real melodic event, and minGap only
    // ever decides how many of those events survive, never trades one for a
    // same-pitch repeat.
    // 8-bar ostinato hook (G-C-Eb-F, straight off the source), the same hook
    // a fourth wider under the Bb/Gm turnarounds, the whole hook an octave up
    // (bars 15-20, the "triumphant" restatement), then the rising stepwise
    // middle section over the VI-III-iv chords. 33 bars — the source's own
    // length, a single pass already runs ~90s (see ch_gameofloans).
    // Bars 21-32 switch primary voice to Cello (up an octave, to land in the
    // same 55-86 range as the rest): Violin just holds one long pad tone per
    // bar here, but Cello never stops moving underneath it — a real,
    // independent arpeggio/countermelody, not filler — and charting Violin's
    // static pad instead (the first attempt) made this whole 12-bar stretch
    // (over a third of the song) read as the song grinding to a near-halt:
    // 15 onsets across 192 steps vs. ~8-11 onsets/bar everywhere else. Cello
    // keeps it moving (132 onsets) and lands the same 55-86 register as the
    // rest of the piece. Violin fills in the two spots where Cello itself
    // rests (bar 27 beats 1-2, bar 30's three rests) — same per-step splice
    // as bars 4-14 above, just with the roles swapped for this section.
    gameOfLoans: [
      // -- bars 0-2: the ostinato hook (Violin) --------------------------------
      67, _, 60, _, 63, 65, 67, _, 60, _, 63, 65, 67, _, 60, _,
      63, 65, 67, _, 60, _, 63, 65, 67, _, 60, _, 64, 65, 67, _,
      60, _, 64, 65, 67, _, 60, _, 64, 65, 67, _, 60, _, 64, 65,
      // -- bar 3: the hook widens under Gm (Violin) ----------------------------
      67, _, _, _, _, _, 60, _, _, _, _, _, 63, 65, 67, _,
      // -- bars 4-5: Cello carries the hook down a fourth (+8ve) while Violin --
      // -- rests, then Violin re-enters mid-bar-4 with the answering figure ----
      _, _, 60, _, _, _, 63, 65, 62, _, 55, _, 58, 60, 62, _,
      55, _, 58, 60, 62, _, 55, _, 58, 60, 62, _, 55, _, 58, _,
      // -- bars 6-8: Cello answers again, lower still (spliced in, +8ve) -------
      65, _, _, _, _, _, 58, _, _, _, _, _, 63, 62, 65, _,
      _, _, 58, _, _, _, _, _, 72, _, 65, _, 68, 70, 72, _,
      65, _, 68, 70, 72, _, 65, _, 68, 70, 72, _, 65, _, 68, 60,
      // -- bars 9-11: the hook returns, Cello carries the tail of bar 11 (+8ve) -
      67, _, _, _, _, _, 60, _, _, _, _, _, 63, 65, 67, _,
      _, _, 60, _, _, _, 63, 65, 62, _, 55, _, 58, 60, 62, _,
      55, _, 58, 60, 62, _, 55, _, 58, 60, 62, _, 55, _, 58, _,
      // -- bars 12-14: the wider turn; Cello carries the tail of bar 13 (+8ve) -
      65, _, _, _, _, _, 58, _, _, _, _, _, 63, 62, 65, _,
      _, _, 58, _, _, _, _, _, 63, 62, 60, 65, 68, 70, 72, _,
      65, _, 68, 70, 72, _, 65, _, 68, 70, 72, _, 65, _, 68, 60,
      // -- bars 15-20: the hook, an octave up (Violin, "triumphant") ----------
      79, _, _, _, _, _, 72, _, _, _, _, _, 75, 77, 79, _,
      _, _, 72, _, _, _, 75, 77, 74, _, 67, _, 70, 72, 74, _,
      67, _, 70, 72, 74, _, 79, _, 82, 84, 86, _, 79, _, 82, _,
      77, _, _, _, _, _, 70, _, _, _, _, _, 74, _, _, 75,
      _, _, 74, _, _, 70, _, _, 72, _, 67, _, 68, 70, 72, _,
      67, _, 68, 70, 72, _, 79, _, 80, 82, 84, _, 79, _, 80, 82,
      // -- bars 21-32: the rising middle section (Cello countermelody, +8ve) --
      63, _, _, _, 68, 70, 72, _, 63, _, 70, 72, 70, _, 63, _,
      67, 68, 70, _, 63, _, 67, 68, 67, _, 60, _, 65, 67, 68, _,
      60, _, 67, 68, 67, _, 60, _, 63, 65, 67, _, 60, _, 67, 68,
      56, _, 63, _, 56, _, 63, _, 56, _, 63, _, 65, 56, 65, 56,
      65, 56, 65, 56, 65, 56, 65, 56, 72, _, 67, _, 68, 70, 72, _,
      67, _, 68, 70, 72, 60, 79, _, 80, 82, 84, _, 79, _, 80, 82,
      84, _, 75, _, 80, 82, 84, _, 75, _, 82, 84, 82, _, 75, _,
      79, 80, 82, _, 75, _, 79, 80, 79, _, 72, _, 77, 79, 80, _,
      72, _, 79, 80, 79, _, 72, _, 75, 77, 79, _, 72, _, 79, 80,
      68, _, 75, _, 68, _, 75, _, 68, _, 75, _, 77, 68, 77, 68,
      77, 68, 77, 68, 77, 68, 77, 68, 72, _, 67, _, 68, 70, 72, _,
      67, _, 68, 70, 72, _, 67, _, 68, 70, 72, _, 67, _, 68, 82,
    ],
    // "Tariffa", transcribed from MIDI (tifa.mid), bars 21-40 of the source
    // (see P.tariffa for why bar 20's arpeggiated pickup is excluded from the
    // loop). One track, both hands, so the melody is read off the TOP note
    // of each new attack rather than a named instrument — but taking the
    // literal top of every attack verbatim would wrongly chart inner-voice/
    // bass motion as "tune" during the bars where the real melody is a long
    // held note or resting (e.g. bar 22: F5 rings for 8 steps while a bass
    // line re-enters underneath it at register 50-65 — those low attacks are
    // rests here, not new melody notes, since F5 is still sounding above
    // them). So each step below is the top attack ONLY when it's actually in
    // the tune's own register (roughly D5 and up for this excerpt) or is the
    // sole voice sounding; lower attacks that land while a held high note is
    // still ringing are read as rests, matching what the ear actually tracks
    // as "the melody" versus the accompaniment moving underneath it. Bars 21
    // and 37 are identical (the hook restated verbatim, confirmed against
    // the source) and bar 39 is the same hook with a higher C6 turn at its
    // climax instead of Bb5 — both transcribed note-for-note from those
    // exact bars, not copy-pasted as a shortcut.
    tariffa: [
      // bar 21 — the hook: A-G-F#-G, a chromatic Bb turn, back down to A-G
      81, _, 79, _, 78, _, 79, _, 82, _, _, _, 81, _, 79, _,
      // bar 22 — answering phrase, G5 falling to a held F5 (rests under it)
      79, _, _, _, 77, _, _, _, _, _, _, _, _, _, _, _,
      // bar 23 — accompaniment carries alone for a bar and a half, then the
      // melody re-enters right at the end (G5, F5)
      _, _, _, _, _, _, _, _, _, _, _, _, 79, _, 77, _,
      // bar 24 — F5 holds, then a descending run: E5-C5-A5-G5
      77, _, _, _, _, _, _, _, 76, _, 72, _, 81, _, 79, _,
      // bar 25 — A5 down to a held C5, back up through C5-A5-G5
      81, _, 72, _, _, _, _, _, _, _, 72, _, 81, _, 79, _,
      // bar 26 — same shape a step up: A5, held C#5, C#5-D#5-C#5
      81, _, 73, _, _, _, _, _, _, _, 73, _, 75, _, 73, _,
      // bar 27 — a single long C5, held almost the whole bar, re-struck at the end
      72, _, _, _, _, _, _, _, _, _, _, _, _, _, 72, _,
      // bar 28 — the connecting phrase dips down (Bb4-A4-F4) before climbing
      // back up into the next statement (C5-A5-G5)
      70, _, _, _, 69, _, _, _, 65, _, 72, _, 81, _, 79, _,
      // bar 29 — repeats bar 25's shape exactly (the source's own pedal figure)
      81, _, 72, _, _, _, _, _, _, _, 72, _, 81, _, 79, _,
      // bar 30 — the climb to the excerpt's peak: A5, C6, A5, then the leap to F6/E6
      81, _, 84, _, _, _, _, _, _, _, 81, _, 89, _, 88, _,
      // bar 31 — the peak resolves: a held D6, falling through D5-D4-C5-D4
      86, _, _, _, _, _, _, _, 74, _, 62, _, 72, _, 62, _,
      // bar 32 — new idea, held Bb4, then climbs D5-Bb5-A5
      70, _, _, _, _, _, _, _, _, _, 74, _, 82, _, 81, _,
      // bar 33 — Bb5 down to held D5, back up D5-Bb5-A5
      82, _, 74, _, _, _, _, _, _, _, 74, _, 82, _, 81, _,
      // bar 34 — Bb5 down to held G5, back up G5-F5-G5
      82, _, 79, _, _, _, _, _, _, _, 79, _, 77, _, 79, _,
      // bar 35 — held A5 then held G5, one attack each — the idea thins out
      81, _, _, _, _, _, _, _, 79, _, _, _, _, _, _, _,
      // bar 36 — a long held F#5, then a single A5 upbeat into the hook's return
      78, _, _, _, _, _, _, _, _, _, _, _, 81, _, _, _,
      // bar 37 — the hook restated verbatim (identical to bar 21 in the source)
      81, _, 79, _, 78, _, 79, _, 82, _, _, _, 81, _, 79, _,
      // bar 38 — G5 to a held F5, then climbing back up A5-Bb5
      79, _, _, _, 77, _, _, _, _, _, _, _, 81, _, 82, _,
      // bar 39 — the hook's climactic variant: same A-G-F#-G, but turns on C6
      81, _, 79, _, 78, _, 79, _, 84, _, 81, _, 79, _, 81, _,
      // bar 40 — the cadence out: G5, a quick A5 grace-turn, held F5, D5, F5
      79, _, _, 81, 77, _, _, _, _, _, _, _, 74, _, 77, _,
    ],
    // "Under the GCP" — the "Under the Sea" melody, transcribed from
    // under_the_gcp.mid by arcade/tools/mid2chart.js with --min-dur 48. The
    // source is a single-track piano arrangement in which every melody note
    // (dur 96 = a 16th) is shadowed by a short dur-24 bass/echo note struck a
    // 64th later and OFF the 16th grid; --min-dur drops those ornaments so only
    // the real, on-grid melody notes remain (they land cleanly on the 8th-note
    // grid, the tune's natural calypso pulse). Cut to the source's bars 1-32
    // (see P.underthegcp for why): 187 onsets, 36.5% of steps. Exact.
    underthegcp: [
      _, _, 49, _, 56, _, 61, _, 65, _, _, _, 65, _, _, _,  // bar 0 (source bar 1)
      65, _, 63, _, _, _, 66, _, _, _, 65, _, _, _, 61, _,  // bar 1 (source bar 2)
      _, _, 49, _, 53, _, 56, _, 61, _, _, _, 61, _, _, _,  // bar 2 (source bar 3)
      61, _, 60, _, _, _, 63, _, _, _, 61, _, _, _, _, _,  // bar 3 (source bar 4)
      _, _, 65, _, 68, _, 73, _, 77, _, _, _, 77, _, _, _,  // bar 4 (source bar 5)
      77, _, 75, _, _, _, 78, _, _, _, 77, _, _, _, 73, _,  // bar 5 (source bar 6)
      _, _, 61, _, 65, _, 68, _, 73, _, 56, _, 73, _, _, _,  // bar 6 (source bar 7)
      73, _, 72, _, _, _, 75, _, _, _, 73, 75, 73, 75, 73, 75,  // bar 7 (source bar 8)
      73, 75, 61, _, _, _, 73, _, 73, _, 61, _, 73, _, 61, _,  // bar 8 (source bar 9)
      73, _, 72, _, 56, _, 75, _, _, _, 73, _, _, _, 68, _,  // bar 9 (source bar 10)
      65, _, 61, _, _, _, 65, _, 68, _, 61, _, 68, _, 61, _,  // bar 10 (source bar 11)
      68, _, 63, _, _, _, 68, _, 56, _, 65, _, _, _, _, _,  // bar 11 (source bar 12)
      56, _, 61, _, _, _, 68, _, 73, _, 61, _, 73, _, 65, _,  // bar 12 (source bar 13)
      68, _, 72, _, _, _, 75, _, 68, _, 73, _, _, _, 68, _,  // bar 13 (source bar 14)
      56, _, 61, _, _, _, 68, _, 65, _, 56, _, 68, _, 65, _,  // bar 14 (source bar 15)
      68, _, 63, _, _, _, 68, _, 56, _, 65, _, _, _, _, _,  // bar 15 (source bar 16)
      61, _, 61, _, 58, _, 66, _, 70, _, 54, _, 73, _, 61, _,  // bar 16 (source bar 17)
      70, _, 68, _, 56, _, 73, _, 68, _, 68, _, 56, _, 73, _,  // bar 17 (source bar 18)
      _, _, 66, _, 56, _, 66, _, 75, _, 56, _, 75, _, 56, _,  // bar 18 (source bar 19)
      73, _, 77, _, _, _, 75, _, 61, _, 73, _, _, _, 61, _,  // bar 19 (source bar 20)
      _, _, 54, _, _, _, 66, _, 70, _, _, _, 73, _, _, _,  // bar 20 (source bar 21)
      70, _, 68, _, _, _, 73, _, _, _, 68, _, _, _, 73, _,  // bar 21 (source bar 22)
      _, _, 56, _, _, _, 68, _, 75, _, 68, _, 75, _, 68, _,  // bar 22 (source bar 23)
      73, _, 77, _, _, _, 75, _, _, _, 73, _, _, _, 61, _,  // bar 23 (source bar 24)
      _, _, 61, _, 68, _, 73, _, 77, _, _, _, 75, _, 73, _,  // bar 24 (source bar 25)
      _, _, 70, _, _, _, 61, _, 70, _, _, _, 70, _, _, _,  // bar 25 (source bar 26)
      70, _, 68, _, _, _, 65, _, 77, _, _, _, 75, _, 73, _,  // bar 26 (source bar 27)
      56, _, 75, _, _, _, 66, _, 68, _, _, _, 68, _, 66, _,  // bar 27 (source bar 28)
      _, _, 65, _, _, _, 68, _, 77, _, _, _, 75, _, 73, _,  // bar 28 (source bar 29)
      _, _, 70, _, _, _, 68, _, 77, _, 66, _, 75, _, 73, _,  // bar 29 (source bar 30)
      _, _, 70, _, 63, _, 68, _, 77, _, 56, _, 75, _, 73, _,  // bar 30 (source bar 31)
      _, _, 77, _, _, _, _, _, 68, _, _, _, _, _, 73, _,  // bar 31 (source bar 32)
    ],
    // "Flower Gil" — Aerith's Theme (FF7), bars 1-70 (~1:20), top melody with
    // --min-pitch 48: keeps the theme clean but pulls in the lower inner voice
    // so the sparse ballad stretches fill in (no empty bars, ~16% of steps).
    aerithrock: [
      66, _, _, _, 69, _, _, _, 74, _, _, _, _, _, _, _,  // bar 0 (source bar 1)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 1 (source bar 2)
      72, _, _, _, 69, _, _, _, 64, _, _, _, _, _, _, _,  // bar 2 (source bar 3)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 3 (source bar 4)
      66, _, _, _, 69, _, _, _, 74, _, _, _, 73, _, _, _,  // bar 4 (source bar 5)
      76, _, _, _, 74, _, _, _, 71, _, _, _, 73, _, _, _,  // bar 5 (source bar 6)
      69, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 6 (source bar 7)
      64, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 7 (source bar 8)
      66, _, _, _, 69, _, _, _, 74, _, _, _, _, _, _, _,  // bar 8 (source bar 9)
      57, _, _, _, _, _, _, _, 57, _, _, _, _, _, _, _,  // bar 9 (source bar 10)
      72, _, _, _, 69, _, _, _, 64, _, _, _, _, _, _, _,  // bar 10 (source bar 11)
      52, _, _, _, _, _, _, _, 48, _, _, _, 62, _, 64, _,  // bar 11 (source bar 12)
      62, _, _, _, _, _, _, _, 53, _, _, _, _, _, _, _,  // bar 12 (source bar 13)
      65, _, _, _, 64, _, _, _, 62, _, _, _, 64, _, _, _,  // bar 13 (source bar 14)
      62, _, _, _, _, _, _, _, 50, _, _, _, _, _, _, _,  // bar 14 (source bar 15)
      50, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 15 (source bar 16)
      62, _, _, _, _, _, _, _, 50, _, _, _, 52, _, _, _,  // bar 16 (source bar 17)
      54, _, _, _, 50, _, _, _, 49, _, _, _, 52, _, _, _,  // bar 17 (source bar 18)
      50, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 18 (source bar 19)
      _, _, _, _, _, _, _, _, 62, _, _, _, 64, _, _, _,  // bar 19 (source bar 20)
      66, _, _, _, _, _, _, _, 50, _, _, _, _, _, _, _,  // bar 20 (source bar 21)
      54, _, _, _, _, _, _, _, 66, _, _, _, 67, _, _, _,  // bar 21 (source bar 22)
      69, _, _, _, _, _, _, _, 49, _, _, _, _, _, _, _,  // bar 22 (source bar 23)
      54, _, _, _, _, _, _, _, 71, _, _, _, 73, _, _, _,  // bar 23 (source bar 24)
      74, _, _, _, _, _, _, _, 71, _, _, _, _, _, _, _,  // bar 24 (source bar 25)
      50, _, _, _, _, _, _, _, 67, _, _, _, _, _, _, _,  // bar 25 (source bar 26)
      69, _, 71, _, 69, _, _, _, 52, _, _, _, _, _, _, _,  // bar 26 (source bar 27)
      54, _, _, _, _, _, _, _, 57, _, _, _, 54, _, _, _,  // bar 27 (source bar 28)
      49, _, _, _, _, _, _, _, _, _, _, _, 49, _, _, _,  // bar 28 (source bar 29)
      73, _, _, _, _, _, _, _, _, _, _, _, 49, _, _, _,  // bar 29 (source bar 30)
      71, _, _, _, _, _, _, _, _, _, _, _, 49, _, _, _,  // bar 30 (source bar 31)
      69, _, _, _, _, _, _, _, 59, _, _, _, 57, _, _, _,  // bar 31 (source bar 32)
      50, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 32 (source bar 33)
      71, _, _, _, _, _, _, _, _, _, _, _, 50, _, _, _,  // bar 33 (source bar 34)
      69, _, _, _, _, _, _, _, _, _, _, _, 50, _, _, _,  // bar 34 (source bar 35)
      67, _, _, _, _, _, _, _, 57, _, _, _, 54, _, _, _,  // bar 35 (source bar 36)
      49, _, _, _, _, _, _, _, _, _, _, _, 49, _, _, _,  // bar 36 (source bar 37)
      54, 76, _, _, _, _, _, _, _, _, _, _, 49, _, _, _,  // bar 37 (source bar 38)
      _, 74, _, _, _, _, _, _, _, _, _, _, 49, _, _, _,  // bar 38 (source bar 39)
      73, _, _, _, _, _, _, _, 59, _, _, _, 61, _, _, _,  // bar 39 (source bar 40)
      62, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 40 (source bar 41)
      _, _, _, _, 50, _, _, _, 62, _, _, _, _, _, _, _,  // bar 41 (source bar 42)
      _, _, _, _, _, _, _, _, 74, _, _, _, _, _, _, _,  // bar 42 (source bar 43)
      73, _, _, _, _, _, _, _, 71, _, _, _, _, _, _, _,  // bar 43 (source bar 44)
      69, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 44 (source bar 45)
      66, _, _, _, _, _, _, _, 54, _, _, _, _, _, _, _,  // bar 45 (source bar 46)
      _, _, _, _, 50, _, _, _, 74, _, _, _, 50, _, _, _,  // bar 46 (source bar 47)
      73, _, _, _, 50, _, _, _, 71, _, _, _, _, _, _, _,  // bar 47 (source bar 48)
      73, _, _, _, _, _, _, _, _, _, _, _, 78, _, _, _,  // bar 48 (source bar 49)
      78, _, _, _, _, _, _, _, 49, _, _, _, 54, _, _, _,  // bar 49 (source bar 50)
      _, _, _, _, _, _, _, _, 74, _, _, _, _, _, _, _,  // bar 50 (source bar 51)
      73, _, _, _, _, _, _, _, 71, _, _, _, _, _, _, _,  // bar 51 (source bar 52)
      69, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 52 (source bar 53)
      64, _, _, _, 50, _, _, _, 55, _, _, _, 62, _, _, _,  // bar 53 (source bar 54)
      62, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 54 (source bar 55)
      61, _, _, _, _, _, _, _, 64, _, _, _, _, _, _, _,  // bar 55 (source bar 56)
      67, _, _, _, 66, _, _, _, 64, _, _, _, 59, _, _, _,  // bar 56 (source bar 57)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 57 (source bar 58)
      50, _, _, _, 55, _, _, _, 59, _, _, _, 62, _, _, _,  // bar 58 (source bar 59)
      67, _, _, _, 66, _, _, _, 62, _, _, _, 64, _, _, _,  // bar 59 (source bar 60)
      62, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 60 (source bar 61)
      50, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 61 (source bar 62)
      _, _, _, _, _, _, _, _, 74, _, _, _, _, _, _, _,  // bar 62 (source bar 63)
      73, _, _, _, _, _, _, _, 71, _, _, _, _, _, _, _,  // bar 63 (source bar 64)
      69, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 64 (source bar 65)
      64, _, _, _, _, _, _, _, _, _, _, _, 64, _, 66, _,  // bar 65 (source bar 66)
      67, _, _, _, 66, _, _, _, 64, _, _, _, 62, _, _, _,  // bar 66 (source bar 67)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 67 (source bar 68)
      55, _, _, _, _, _, _, _, 83, _, _, _, 81, _, _, _,  // bar 68 (source bar 69)
      79, _, _, _, 74, _, _, _, 71, _, _, _, 67, _, _, _,  // bar 69 (source bar 70)
    ],
    // "Vamo Alla Financio" — Vamo' Alla Flamenco (FF9), full 64-bar arrangement.
    // Busy flamenco (~47% of steps); single-track piano, top note per step.
    vamo: [
      72, 76, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 0 (source bar 1)
      _, _, _, _, _, _, _, _, 72, 77, _, _, _, _, _, _,  // bar 1 (source bar 2)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 2 (source bar 3)
      72, 78, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 3 (source bar 4)
      _, _, _, _, _, _, _, _, 72, 77, _, _, _, _, _, _,  // bar 4 (source bar 5)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 5 (source bar 6)
      72, 76, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 6 (source bar 7)
      _, _, _, _, _, _, _, _, 76, _, 69, _, 72, _, 64, _,  // bar 7 (source bar 8)
      71, _, 70, _, 69, 64, 68, _, 69, _, 72, 64, 71, _, 69, _,  // bar 8 (source bar 9)
      71, 64, _, _, 68, _, 64, _, 66, _, 68, _, 69, 64, 68, _,  // bar 9 (source bar 10)
      69, _, 72, 64, 71, _, 69, _, 74, 62, _, _, 71, _, 67, _,  // bar 10 (source bar 11)
      _, _, _, _, 72, 64, 71, _, 72, _, 76, 64, 74, _, 72, _,  // bar 11 (source bar 12)
      74, 62, _, _, 71, _, 67, 62, 69, _, 71, _, 72, 60, _, _,  // bar 12 (source bar 13)
      71, _, 52, 59, 69, _, 68, _, 69, _, 64, _, 64, _, 57, _,  // bar 13 (source bar 14)
      64, _, 64, _, 57, _, 65, _, 65, _, 57, _, 65, _, 65, _,  // bar 14 (source bar 15)
      56, _, 64, _, 64, _, 56, _, 64, _, 64, _, 52, _, 64, _,  // bar 15 (source bar 16)
      64, _, 64, _, 66, _, 68, _, 69, _, 68, _, 69, _, 72, _,  // bar 16 (source bar 17)
      71, _, 69, _, 71, _, 59, _, 68, _, 64, _, 66, _, 68, _,  // bar 17 (source bar 18)
      69, _, 68, _, 69, _, 72, _, 71, _, 69, _, 74, _, 62, _,  // bar 18 (source bar 19)
      71, _, 67, _, 57, _, 59, _, 72, _, 71, _, 72, _, 76, _,  // bar 19 (source bar 20)
      74, _, 72, _, 74, _, 62, _, 71, _, 67, _, 69, _, 71, _,  // bar 20 (source bar 21)
      72, _, 60, _, 71, _, 53, _, 69, _, 68, _, 69, _, 64, _,  // bar 21 (source bar 22)
      64, _, 57, _, 64, _, 64, _, 57, _, 65, _, 65, _, 57, _,  // bar 22 (source bar 23)
      65, _, 65, _, 56, _, 64, _, 64, _, 56, _, 64, _, 64, _,  // bar 23 (source bar 24)
      52, _, 64, _, 64, _, 52, _, 54, _, 56, _, 57, _, 60, _,  // bar 24 (source bar 25)
      64, _, 69, _, _, _, 69, _, 68, _, 66, _, 68, _, 69, _,  // bar 25 (source bar 26)
      _, _, 69, _, 71, _, 69, _, 71, _, 69, _, 71, _, 69, _,  // bar 26 (source bar 27)
      68, _, 66, _, 68, _, 69, _, 60, _, 64, _, 57, _, 60, _,  // bar 27 (source bar 28)
      64, _, 69, _, _, _, 69, _, 68, _, 66, _, 68, _, 69, _,  // bar 28 (source bar 29)
      _, _, 69, _, 74, _, 72, _, 71, _, 69, _, 71, _, 69, _,  // bar 29 (source bar 30)
      74, _, 71, _, 68, _, 71, _, 68, _, 64, _, 68, _, 64, _,  // bar 30 (source bar 31)
      65, _, 66, _, 67, _, 68, _, 69, _, 68, _, 69, _, 72, _,  // bar 31 (source bar 32)
      71, _, 69, _, 71, _, 59, _, 68, _, 64, _, 66, _, 68, _,  // bar 32 (source bar 33)
      69, _, 68, _, 69, _, 72, _, 71, _, 69, _, 74, _, 62, _,  // bar 33 (source bar 34)
      71, _, 67, _, 57, _, 59, _, 72, _, 71, _, 72, _, 76, _,  // bar 34 (source bar 35)
      74, _, 72, _, 74, _, 59, _, 71, _, 67, _, 69, _, 71, _,  // bar 35 (source bar 36)
      72, _, 57, _, 71, _, 52, _, 69, _, 68, _, 81, _, 76, _,  // bar 36 (source bar 37)
      72, _, 81, _, 76, _, 72, _, 77, 57, 74, _, 69, _, 77, _,  // bar 37 (source bar 38)
      74, _, 69, _, 76, _, 71, _, 68, _, 76, _, 71, _, 68, _,  // bar 38 (source bar 39)
      81, _, 64, _, 64, _, 80, _, 66, _, 68, _, 81, _, 76, _,  // bar 39 (source bar 40)
      72, _, 81, _, 76, _, 72, _, 77, 57, 74, _, 69, _, 77, _,  // bar 40 (source bar 41)
      74, _, 69, _, 76, _, 71, _, 68, _, 76, _, 71, _, 80, _,  // bar 41 (source bar 42)
      81, _, 69, 72, 76, _, 81, _, _, _, _, _, 64, _, 69, 73,  // bar 42 (source bar 43)
      76, _, 81, _, 80, _, 78, _, 77, _, 76, _, 77, _, 74, _,  // bar 43 (source bar 44)
      76, _, 77, _, 76, _, _, _, 64, _, 72, 64, 74, 60, 76, _,  // bar 44 (source bar 45)
      74, _, 62, _, 58, _, 53, _, 50, _, 58, _, 57, _, 69, 73,  // bar 45 (source bar 46)
      76, _, 81, _, 80, _, 78, _, 77, _, 76, _, 77, _, 74, _,  // bar 46 (source bar 47)
      76, _, 77, _, 79, _, _, _, 76, _, 76, 67, 77, 64, 79, _,  // bar 47 (source bar 48)
      81, _, 79, _, 81, _, 81, _, 83, _, 81, _, 64, 59, _, 64,  // bar 48 (source bar 49)
      59, _, 64, _, 64, _, 64, _, 65, 60, _, 65, 60, _, 65, _,  // bar 49 (source bar 50)
      65, _, 65, _, 67, 62, _, 67, 62, _, 65, 60, _, 65, 60, _,  // bar 50 (source bar 51)
      64, 59, _, 64, 59, _, 64, _, 68, 69, 68, 66, 64, 59, _, 64,  // bar 51 (source bar 52)
      59, _, 64, _, 64, _, 64, _, 65, 60, _, 65, 60, _, 65, _,  // bar 52 (source bar 53)
      65, _, 65, _, 67, 62, _, 67, 62, _, 65, 60, _, 65, 60, _,  // bar 53 (source bar 54)
      64, _, 71, _, 68, _, 71, _, 68, _, 64, _, 68, _, 64, _,  // bar 54 (source bar 55)
      59, _, 64, _, 66, _, 68, _, 69, _, 68, _, 69, _, 72, _,  // bar 55 (source bar 56)
      71, _, 69, _, 71, _, _, _, 68, _, 64, _, _, _, _, _,  // bar 56 (source bar 57)
      69, _, 68, _, 69, _, 72, _, 71, _, 69, _, 74, _, 62, _,  // bar 57 (source bar 58)
      71, _, 67, _, 57, _, 59, _, 72, _, 71, _, 72, _, 76, _,  // bar 58 (source bar 59)
      74, _, 72, _, 74, _, 59, _, 71, _, 67, _, 69, _, 71, _,  // bar 59 (source bar 60)
      72, _, 57, _, 71, _, 52, _, 69, _, 68, _, 72, _, 57, _,  // bar 60 (source bar 61)
      71, _, 52, _, 69, _, 68, _, 72, _, 57, _, 71, _, 52, _,  // bar 61 (source bar 62)
      69, _, 68, _, 69, _, 60, 64, 57, _, 60, 64, 69, _, 72, 76,  // bar 62 (source bar 63)
      69, _, 72, 76, 81, _, 72, 76, 81, _, _, _, 57, _, _, _,  // bar 63 (source bar 64)
    ],
    // "Stolen Tokens" — Yuffie's Theme (FF7), bars 1-31, ends on the chorus
    // before the redundant repeat. de-swung (--quantize 8), --min-pitch 72.
    stolentokens: [
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 0 (source bar 1)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 1 (source bar 2)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 2 (source bar 3)
      _, _, _, _, _, _, _, _, _, _, 79, _, 81, _, 83, _,  // bar 3 (source bar 4)
      _, _, _, _, _, _, _, _, _, _, _, _, 86, _, 83, _,  // bar 4 (source bar 5)
      _, _, _, _, 83, _, 84, _, 83, _, 79, _, 81, _, 83, _,  // bar 5 (source bar 6)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 6 (source bar 7)
      _, _, _, _, _, _, _, _, _, _, 79, _, 81, _, 83, _,  // bar 7 (source bar 8)
      _, _, _, _, _, _, _, _, _, _, _, _, 86, _, 83, _,  // bar 8 (source bar 9)
      _, _, _, _, 83, _, 84, _, 83, _, 79, _, 81, _, 83, _,  // bar 9 (source bar 10)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 10 (source bar 11)
      _, _, _, _, _, _, _, _, _, _, 91, _, 90, _, 88, _,  // bar 11 (source bar 12)
      _, _, _, _, 88, _, 90, _, 88, _, 86, _, _, _, 83, _,  // bar 12 (source bar 13)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 13 (source bar 14)
      79, _, _, _, _, _, 76, _, 79, _, 81, _, _, _, 83, _,  // bar 14 (source bar 15)
      _, _, _, _, _, _, _, _, _, _, 91, _, 90, _, 88, _,  // bar 15 (source bar 16)
      _, _, _, _, 88, _, 90, _, 88, _, 86, _, _, _, 83, _,  // bar 16 (source bar 17)
      _, _, _, _, 83, _, 88, _, 83, _, 81, _, 79, _, 81, _,  // bar 17 (source bar 18)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 18 (source bar 19)
      _, _, _, _, _, _, _, _, 83, _, _, _, 78, _, _, _,  // bar 19 (source bar 20)
      79, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 20 (source bar 21)
      _, _, _, _, _, _, _, _, _, _, 79, _, 83, _, 86, _,  // bar 21 (source bar 22)
      88, _, _, _, 88, _, _, _, 84, _, _, _, 81, _, _, _,  // bar 22 (source bar 23)
      83, _, 86, _, _, _, _, _, _, _, 79, _, 83, _, 86, _,  // bar 23 (source bar 24)
      88, _, _, _, 88, _, _, _, 84, _, _, _, _, _, 81, _,  // bar 24 (source bar 25)
      83, _, 86, _, _, _, _, _, _, _, 79, _, 83, _, 86, _,  // bar 25 (source bar 26)
      88, _, _, _, 88, _, _, _, 90, _, _, _, _, _, 88, _,  // bar 26 (source bar 27)
      87, _, 88, _, 90, _, 91, _, _, _, _, _, _, _, _, _,  // bar 27 (source bar 28)
      _, _, _, _, _, _, _, _, _, _, 83, _, 81, _, 79, _,  // bar 28 (source bar 29)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 29 (source bar 30)
      84, _, _, _, 83, _, _, _, 78, _, 81, _, _, _, 79, _,  // bar 30 (source bar 31)
    ],
    // "Price Ali" — Prince Ali (Aladdin), bars 16-74 (~1:20), merged top line
    // across tracks 0,2,3,4,5 (--lead 0,2,3,4,5), ends on A#4/Bb.
    priceali: [
      _, _, _, _, 70, _, _, _, 72, _, _, _, 73, _, _, _,  // bar 0 (source bar 16)
      70, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 1 (source bar 17)
      _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,  // bar 2 (source bar 18)
      58, _, _, _, 65, _, 65, _, 58, _, _, _, 65, _, 65, _,  // bar 3 (source bar 19)
      58, _, _, _, 65, _, _, _, 66, _, _, _, 65, _, _, _,  // bar 4 (source bar 20)
      53, _, _, _, 60, _, 60, _, 53, _, _, _, 60, _, 60, _,  // bar 5 (source bar 21)
      53, _, _, _, 60, _, _, _, 61, _, _, _, 60, _, _, _,  // bar 6 (source bar 22)
      58, _, _, _, 65, _, 65, _, 58, _, _, _, 65, _, 65, _,  // bar 7 (source bar 23)
      58, _, _, _, 65, _, _, _, 66, _, _, _, 65, _, _, _,  // bar 8 (source bar 24)
      63, _, _, _, 63, _, 63, _, _, _, _, _, 65, _, _, _,  // bar 9 (source bar 25)
      _, _, _, _, 66, _, 66, _, _, _, _, _, 61, _, _, _,  // bar 10 (source bar 26)
      60, _, _, _, 67, _, 67, _, 60, _, _, _, 67, _, _, _,  // bar 11 (source bar 27)
      60, _, _, _, 67, _, 67, _, 60, _, _, _, 67, _, 60, _,  // bar 12 (source bar 28)
      65, _, 65, _, _, _, 65, _, 67, _, _, _, 68, _, _, _,  // bar 13 (source bar 29)
      69, _, _, _, _, _, _, _, 65, _, 66, _, 67, _, 70, _,  // bar 14 (source bar 30)
      77, _, _, _, _, _, 75, _, _, _, 77, _, 75, _, _, _,  // bar 15 (source bar 31)
      73, _, _, _, _, _, 72, _, _, _, 73, _, 72, _, _, _,  // bar 16 (source bar 32)
      70, _, _, _, 65, _, 65, _, _, _, _, _, 63, _, _, _,  // bar 17 (source bar 33)
      _, _, _, _, 65, _, _, _, 64, _, _, _, 65, _, _, _,  // bar 18 (source bar 34)
      70, _, _, _, 65, _, 68, _, _, _, 70, _, 68, _, _, _,  // bar 19 (source bar 35)
      66, _, _, _, 62, _, 65, _, _, _, 66, _, 65, _, _, _,  // bar 20 (source bar 36)
      63, _, _, _, 63, _, 63, _, _, _, _, _, 65, _, _, _,  // bar 21 (source bar 37)
      _, _, _, _, 66, _, 66, _, _, _, _, _, 66, _, _, _,  // bar 22 (source bar 38)
      66, _, 66, _, 63, _, 65, _, _, _, 66, _, 65, _, _, _,  // bar 23 (source bar 39)
      61, _, _, _, 65, _, 65, _, _, _, _, _, 70, _, _, _,  // bar 24 (source bar 40)
      70, _, 70, _, 65, _, 68, _, _, _, 70, _, 68, _, _, _,  // bar 25 (source bar 41)
      66, _, _, _, 61, _, 61, _, _, _, _, _, 73, _, _, _,  // bar 26 (source bar 42)
      73, _, 73, _, 70, _, 72, _, _, _, 73, _, 72, _, 73, _,  // bar 27 (source bar 43)
      _, _, 72, _, 73, _, _, _, 71, _, _, _, 72, _, _, _,  // bar 28 (source bar 44)
      77, _, _, _, 75, _, _, _, 75, _, _, _, 75, _, _, _,  // bar 29 (source bar 45)
      75, _, _, _, _, _, _, _, 65, _, _, _, 65, _, _, _,  // bar 30 (source bar 46)
      77, _, _, _, _, _, 75, _, _, _, 77, _, 75, _, _, _,  // bar 31 (source bar 47)
      73, _, _, _, _, _, 72, _, _, _, 73, _, 72, _, _, _,  // bar 32 (source bar 48)
      70, _, _, _, 65, _, 65, _, _, _, _, _, 63, _, _, _,  // bar 33 (source bar 49)
      _, _, _, _, 65, _, _, _, 64, _, _, _, 65, _, _, _,  // bar 34 (source bar 50)
      70, _, _, _, 65, _, 68, _, _, _, 70, _, 68, _, _, _,  // bar 35 (source bar 51)
      66, _, _, _, 62, _, 65, _, _, _, 66, _, 65, _, _, _,  // bar 36 (source bar 52)
      63, _, _, _, 63, _, 63, _, _, _, _, _, 65, _, _, _,  // bar 37 (source bar 53)
      _, _, _, _, 66, _, 66, _, _, _, _, _, 66, _, 66, _,  // bar 38 (source bar 54)
      _, _, 66, _, 63, _, 65, _, _, _, 66, _, 65, _, _, _,  // bar 39 (source bar 55)
      61, _, _, _, 61, _, _, _, _, _, _, _, 70, _, 70, _,  // bar 40 (source bar 56)
      _, _, 70, _, 65, _, 68, _, _, _, 70, _, 68, _, _, _,  // bar 41 (source bar 57)
      66, _, _, _, 61, _, _, _, _, _, _, _, 73, _, 73, _,  // bar 42 (source bar 58)
      _, _, 73, _, 70, _, 72, _, _, _, 73, _, 70, _, 72, _,  // bar 43 (source bar 59)
      77, _, _, _, 65, _, _, _, 73, _, _, _, 69, _, _, _,  // bar 44 (source bar 60)
      70, _, _, _, 65, _, 65, _, _, _, _, _, 65, _, _, _,  // bar 45 (source bar 61)
      _, _, _, _, 65, _, _, _, 69, _, _, _, 70, _, _, _,  // bar 46 (source bar 62)
      72, _, _, _, _, _, 70, _, _, _, _, _, 69, _, _, _,  // bar 47 (source bar 63)
      70, _, _, _, _, _, 72, _, _, _, _, _, 73, _, _, _,  // bar 48 (source bar 64)
      70, _, _, _, _, _, 65, _, 65, _, _, _, _, _, _, _,  // bar 49 (source bar 65)
      _, _, _, _, _, _, _, _, 69, _, _, _, 70, _, _, _,  // bar 50 (source bar 66)
      72, _, _, _, _, _, 70, _, _, _, _, _, 69, _, _, _,  // bar 51 (source bar 67)
      70, _, _, _, _, _, 72, _, _, _, _, _, 70, _, _, _,  // bar 52 (source bar 68)
      73, _, _, _, _, _, _, _, 69, _, _, _, _, _, _, _,  // bar 53 (source bar 69)
      65, _, _, _, _, _, _, _, 69, _, _, _, 70, _, _, _,  // bar 54 (source bar 70)
      72, _, _, _, 66, _, 70, _, _, _, _, _, 69, _, _, _,  // bar 55 (source bar 71)
      70, _, _, _, 66, _, 72, _, _, _, _, _, 73, _, _, _,  // bar 56 (source bar 72)
      70, _, _, _, 61, _, 65, _, _, _, _, _, 63, _, _, _,  // bar 57 (source bar 73)
      _, _, _, _, 65, _, _, _, _, _, _, _, 70, _, _, _,  // bar 58 (source bar 74)
    ],
  };

  // ===========================================================================
  // TRACKS
  //   drums: 'four' | 'double' | 'march' | 'rock' | 'chamber' | 'break' | 'bossa' | 'heartbeat' | false
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

    // ---- endless-runner drive for Mudslides ---------------------------------
    mudslide: {
      title: 'Mudslide', influence: 'Breakbeat runner', bpm: 174, key: 'E minor',
      desc: '16-bar song, ~22s: hook, answer, a two-bar breakdown, then the hook '
          + 'an octave up and a snare fill back to the top.',
      prog: P.downhill, lead: L.mudslide, drums: 'break', pad: 'power', bars: 16,
      breakBars: [8, 9], fillBar: 15, crashBars: [8, 12],   // bar 0 crashes via the kit
      arpEvery: 1, bassEvery: 1, gain: 1.0, voices: { lead: 'dist' },
    },

    // ---- influenced by Clair Obscur: Expedition 33 --------------------------
    lagoon: {
      title: 'Nothing Doing', influence: 'Bossa nova', bpm: 76, key: 'F major 7',
      desc: 'Lake bossa. Brushed clave, warm sevenths and a melody that is never in a hurry.',
      prog: P.lagoon, lead: L.lagoon, drums: 'bossa', pad: 'strings',
      arpEvery: 4, bassEvery: 8, gain: 0.68, bars: 8,
      voices: { lead: 'piano', arp: 'piano' },
    },
    boathouse: {
      title: 'Nothing Doing (dock)', influence: 'Bossa nova', bpm: 76, key: 'F major 7',
      desc: 'The same tune with the kit put away — pad, piano and nothing else.',
      prog: P.lagoon, lead: L.lagoon, drums: false, pad: 'strings',
      arpEvery: 8, bassEvery: 0, gain: 0.60, bars: 8,
      voices: { lead: 'piano', arp: 'piano' },
    },
    expedition: {
      title: 'Depreciation', influence: 'Clair Obscur · Expedition 33', bpm: 108, key: 'D minor 9',
      desc: 'French chamber drive. Rolling 16th piano over extended harmony, strings, soft pulse.',
      prog: P.chamber, lead: L.chamber, drums: 'chamber', pad: 'strings',
      arpEvery: 1, bassEvery: 4, gain: 0.78, voices: { lead: 'piano', arp: 'piano' },
    },

    // ---- 8-bit kung-fu for the Dojo -----------------------------------------
    dojo_menu: {
      title: 'Dojo (still)', influence: '8-bit · wuxia', bpm: 108, key: 'A minor pentatonic',
      desc: 'Cabinet screen. A soft square arp over strings, no kit — the mat before the bell.',
      prog: P.dojo, lead: null, drums: false, pad: 'strings',
      arpEvery: 4, bassEvery: 0, gain: 0.5, voices: { arp: 'square' },
    },
    dojo: {
      title: 'Dojo', influence: '8-bit · Kung Fu Panda', bpm: 132, key: 'A minor pentatonic',
      desc: 'Bouncy chiptune kung-fu. Square lead on the A-minor pentatonic over a '
          + 'four-on-the-floor kit and a square arp.',
      prog: P.dojo, lead: L.dojo, drums: 'four', pad: 'strings',
      arpEvery: 2, bassEvery: 2, gain: 0.9, voices: { lead: 'chip', arp: 'square' },
    },
    // Plays only while a Savings Check is on screen: the tune drops into "think"
    // mode — a game-show timer voiced in the Japanese in-scale. No kit; the arp
    // is the ticking clock and the square lead carries the pensive line.
    dojo_trivia: {
      title: 'Dojo (think)', influence: '8-bit · wuxia × game-show timer', bpm: 100,
      key: 'A Japanese in-scale',
      desc: 'The check overlay cue. Square lead on the A in-scale over a ticking square '
          + 'arp and soft strings, climbing on the dominant and resolving home. Mixed '
          + 'about 2.5 dB under the mat track so it stays out of the way of thinking.',
      prog: P.dojoThink, lead: L.dojoThink, drums: false, pad: 'strings',
      arpEvery: 2, bassEvery: 8, gain: 0.54, voices: { lead: 'chip', arp: 'square' },
    },

    // ---- CostBot Hero — the rhythm cabinet ----------------------------------
    // The title track. Funky four-on-the-floor synthwave; the falling-note chart
    // is generated from this song's own lead line, so the player plays the tune.
    ch_megabill: {
      title: 'Megabill Mash', influence: 'Synthwave funk', bpm: 126, key: 'A minor',
      desc: 'CostBot Hero title track. Stabby saw lead over Am–F–C–G, four-on-the-floor '
          + 'kit, sub bass and a 16th arp. Cut the spend on the beat.',
      prog: P.aeolian, lead: L.chMegabill, drums: 'four', pad: 'saw',
      arpEvery: 2, bassEvery: 2, gain: 0.9, voices: { lead: 'saw' },
    },
    // The hard track. Faster, double-kick, distorted lead — the anomaly boss song.
    ch_graviton: {
      title: 'Graviton Groove', influence: 'Driving synth', bpm: 140, key: 'E minor',
      desc: 'CostBot Hero hard track. Double-kick drive, 16th bass gallop and a '
          + 'distorted saw lead over Em–C–G–D. Rightsize to the beat.',
      prog: P.chGraviton, lead: L.chGraviton, drums: 'double', pad: 'saw',
      arpEvery: 1, bassEvery: 1, gain: 0.95, voices: { lead: 'dist' },
    },
    // Villain march — the Imperial March lane. 16-bar song: heavy brass power
    // chords and a martial kit through the theme, a lyrical middle, a big octave-up
    // statement, then a dark bridge where the kit drops and a fill back in.
    ch_imperial: {
      title: 'Imperial Markup', influence: 'Star Wars · Imperial March', bpm: 118, key: 'G minor',
      desc: 'CostBot Hero villain march, ~37s: the menacing G–G–G / Eb–Bb theme, a lyrical middle, '
          + 'a huge octave-up statement, then a dark bridge that drops out before the march returns.',
      prog: P.chImperial, lead: L.chImperial, drums: 'march', pad: 'power', bars: 16,
      breakBars: [12, 13], fillBar: 15, crashBars: [8, 12],
      arpEvery: 0, bassEvery: 2, gain: 0.79, voices: { lead: 'brass' },
    },
    // The Avengers theme, rocked up — transcribed from MIDI, then cranked: fast,
    // double-kick gallop, 16th power-chord bass and a distorted lead over the
    // ostinato intro, the heroic melody and its octave-up statement.
    ch_avengers: {
      title: 'The Savengers', influence: 'Avengers theme (Silvestri), rocked up', bpm: 148, key: 'D',
      desc: 'The Avengers theme cranked to 11: the low ostinato intro, the heroic melody and its '
          + 'octave-up statement over a double-kick gallop, 16th power-chord bass and a distorted lead.',
      prog: P.chAvengers, lead: L.chAvengers, drums: 'double', pad: 'power', bars: 16,
      fillBar: 15, crashBars: [0, 8],
      arpEvery: 0, bassEvery: 1, gain: 0.44, voices: { lead: 'dist' },
    },
    // It's a Small World, reimagined as an electro light parade — bright four-on-
    // the-floor pulse, a 16th synth arp twinkling like the parade lights, and a
    // strong sub bass under the transcribed tune.
    ch_small: {
      title: "It's a Small Cost", influence: "It's a Small World, electro light-parade", bpm: 126, key: 'C major',
      desc: "It's a Small World as an electro light parade: a bright four-on-the-floor pulse, a 16th "
          + "synth arpeggio twinkling like the lights, and a strong sub bass under the melody.",
      prog: P.chSmall, lead: L.chSmall, drums: 'four', pad: 'saw', bars: 16,
      fillBar: 15, crashBars: [0, 8],
      arpEvery: 1, bassEvery: 2, gain: 1.0, voices: { lead: 'saw' },
    },
    // Main St. Electrical Parade in the same electro-light-parade style — bright
    // four-on-the-floor, strong sub bass, saw lead carrying the bouncy hoedown runs.
    // No extra arp: the melody is already a stream of 16ths.
    ch_parade: {
      title: 'Electrical Spendarade', influence: 'Main St. Electrical Parade (Baroque Hoedown), electro', bpm: 124, key: 'G major',
      desc: 'The Main Street Electrical Parade theme as an electro light parade: four-on-the-floor, a '
          + 'strong sub bass and a saw lead ripping the bouncy hoedown runs. The parade rolls down the highway.',
      prog: P.chParade, lead: L.chParade, drums: 'four', pad: 'saw', bars: 16,
      fillBar: 15, crashBars: [0, 8],
      arpEvery: 0, bassEvery: 2, gain: 0.9, voices: { lead: 'saw' },
    },
    // Jeopardy "Think!" theme, given the upbeat-electro treatment — driving four-on-
    // the-floor, a strong sub bass and a saw lead on the vamp, up a third at the half.
    ch_jeopardy: {
      title: 'Fiscal Jeopardy', influence: "Jeopardy 'Think!' theme, electro", bpm: 132, key: 'A / C',
      desc: 'The Jeopardy Think! theme, cranked up: a driving four-on-the-floor pulse, a strong sub '
          + 'bass and a saw lead on the vamp — then the whole thing jumps up a third. Beat the clock.',
      prog: P.chJeopardy, lead: L.chJeopardy, drums: 'four', pad: 'saw', bars: 16,
      fillBar: 15, crashBars: [0, 8],
      arpEvery: 2, bassEvery: 2, gain: 0.9, voices: { lead: 'saw' },
    },
    // Daredevil, given the same treatment as The Savengers: transcribed from MIDI,
    // then cranked and dropped an octave — frantic tempo, a deep bass, and a
    // relentless lub-dub heartbeat kick under a dark string pad, distorted lead
    // on the 8-bar ostinato hook, then the sparse theme answers it.
    ch_blindhero: {
      title: 'Blind Spend', influence: 'Daredevil, dark ostinato', bpm: 156, key: 'C minor',
      desc: 'Daredevil theme, cranked up and pitched down: a frantic 8-bar 8th-note ostinato hook '
          + 'driving over a deep bass and a pounding lub-dub heartbeat kick, dark strings, '
          + 'i–VI–iv–i in C minor, before a sparse, moody theme answers it.',
      prog: P.blindHero, lead: L.blindHero, drums: 'heartbeat', pad: 'strings', bars: 16,
      fillBar: 15, crashBars: [0, 8],
      arpEvery: 1, bassEvery: 1, gain: 0.44, voices: { lead: 'dist' },
      bassGain: 0.48, bassSubGain: 1.0, bassCutoffStart: 480, bassCutoffEnd: 110,
    },
    // "Great Fairy Fountain", transcribed from a music-box MIDI arrangement,
    // remixed as a lofi-house club edit: a four-on-the-floor kick, a constant
    // deep sub-bass pulse (heavily filtered for that muffled lofi low end),
    // and a square arp doubling the chord under the lead for extra motion.
    // Slower than the source (112 vs. the source's 140) and a saw lead instead
    // of the delicate chip bell — reads as driving rather than dainty, and the
    // slower tempo eases the chart (same dense 8th-note stream, more time
    // between onsets).
    ch_fairyfountain: {
      title: 'Finance Fairy', influence: 'Zelda · Great Fairy Fountain, lofi house remix', bpm: 112, key: 'G minor',
      prog: P.chFairy, lead: L.chFairy, drums: 'four', pad: 'strings', bars: 16,
      arpEvery: 2, bassEvery: 2, gain: 0.85, voices: { lead: 'saw', arp: 'square' },
      bassGain: 0.44, bassSubGain: 1.0, bassCutoffStart: 600, bassCutoffEnd: 120,
    },
    // "The Gold Saucer", transcribed from MIDI. Back to a plain baseline
    // arrangement (the "rocked up" pass — 136bpm, double-kick, then 112bpm,
    // distortion — kept obscuring the tune) at the source's own tempo, with a
    // neutral four-on-the-floor kit and a clean saw lead, so the chart can be
    // judged on the notes themselves. 22 bars (the source's own loop length)
    // instead of the usual 16.
    ch_goldsaucer: {
      title: 'Gold Sauce', influence: 'FF7 · The Gold Saucer', bpm: 104, key: 'G major',
      prog: P.chGoldSaucer, lead: L.chGoldSaucer, drums: 'four', pad: 'saw', bars: 22,
      arpEvery: 0, bassEvery: 2, gain: 1.0, voices: { lead: 'saw' },
    },
    // "Lost Woods", transcribed from MIDI, reworked per feedback: the plain
    // chip-lead baseline read as too flutey/high, so the lead is now 'dist'
    // (an electric-guitar-ish overdriven tone) matching the octave-dropped
    // melody in L.lostWoods — reads as a guitar or bass-guitar lead instead
    // of a piccolo. Piano-voiced arp still cycles the chord tones as a
    // pizzicato-like rhythm layer under it.
    ch_lostwoods: {
      title: 'Cost Woods', influence: 'Zelda · Lost Woods', bpm: 145, key: 'C major',
      prog: P.lostWoods, lead: L.lostWoods, drums: 'four', pad: 'strings', bars: 17,
      arpEvery: 2, bassEvery: 2, gain: 0.64, voices: { lead: 'dist', arp: 'piano' },
    },
    // "X-pense", transcribed from MIDI. The source is a full rock-band
    // arrangement (distortion guitar, synth bass, drum kit); a power-chord
    // pad and 'rock' drums keep that crunch under the lead, voiced 'dist' to
    // match the guitar rather than reading as a soft orchestral line.
    // bassLine: L.xmenBass replaces the usual bassEvery root-pulse with the
    // source's own "Metro Bass" ostinato, note-for-note — it plays alone for
    // the first 2 bars (the real solo intro) and then carries on unchanged as
    // the rhythm bed under the rest of the song, per feedback. arpEvery: 0
    // (no square-wave arp) so that ostinato and the dist lead/power pad
    // aren't competing with a brighter synth layer — keeps it reading as
    // guitar, not chiptune.
    ch_xmen: {
      title: 'X-pense Men', influence: "X-Men '97, distortion riff", bpm: 120, key: 'C minor',
      prog: P.xmen, lead: L.xmen, bassLine: L.xmenBass, drums: 'rock', pad: 'power', bars: 30,
      arpEvery: 0, gain: 0.37, voices: { lead: 'dist' },
      // Louder + more sub than the bass() defaults (0.30/0.55) — it's the
      // song's signature riff, so it should read as a forward, driving
      // presence under the guitar/drums, not a background pulse.
      bassGain: 0.5, bassSubGain: 0.95, bassCutoffStart: 900, bassCutoffEnd: 220,
    },
    // "Fight On!", transcribed from MIDI (see L.ffFightOn for how the lead
    // was built from the full ensemble rather than one track). 'brass' lead
    // voice for the big unison hits (French Horn is the loudest single
    // instrument in that unison), a 'strings' pad for the orchestral wash
    // under it, and 'rock' drums for the source's actual kit part.
    ch_fightOn: {
      title: 'Write-Off!', influence: 'FF7 · Battle Theme', bpm: 170, key: 'A minor',
      prog: P.ffFightOn, lead: L.ffFightOn, drums: 'rock', pad: 'strings', bars: 16,
      arpEvery: 0, bassEvery: 2, gain: 0.74, voices: { lead: 'brass' },
    },
    // "Legend of CostBot", transcribed from MIDI. Solo piano source, so an
    // all-piano voicing (lead + arp) keeps the character; 'chamber' drums
    // (soft, sparse kit) add just enough pulse for the chart without turning
    // a piano piece into a rock song, and a light 'strings' pad fills out the
    // held chords the two hands were already implying.
    ch_legendOfCostbot: {
      title: 'Legend of CostBot', influence: 'Zelda, solo piano', bpm: 144, key: 'Bb major',
      prog: P.legendOfCostbot, lead: L.legendOfCostbot, drums: 'chamber', pad: 'strings', bars: 22,
      arpEvery: 2, bassEvery: 2, gain: 1.0, voices: { lead: 'piano', arp: 'piano' },
    },
    // "Kalm Before the Bill", transcribed from MIDI (FF7 · Kalm) then pumped
    // up per feedback: the source is a slow (66bpm) solo fingerstyle-guitar
    // piece, played straight here would read as sleepy. Revved to 104bpm,
    // 'four' dance drums, and a brighter 'saw' lead instead of the source's
    // own acoustic tone. bassLine: L.kalmBass carries the real transcribed
    // Travis-picking bass, but heavily lowpassed (same "muffled lofi low
    // end" recipe as Finance Fairy) instead of a bright acoustic pluck —
    // that's the "lofi bass" without losing the actual bassline. arpEvery: 2
    // adds motion under the lead for extra energy.
    ch_kalm: {
      title: 'Kalm Before the Bill', influence: 'FF7 · Kalm, revved & lofi-bassed', bpm: 104, key: 'G major',
      prog: P.kalm, lead: L.kalm, bassLine: L.kalmBass, drums: 'four', pad: 'strings', bars: 17,
      arpEvery: 2, gain: 0.96, voices: { lead: 'saw', arp: 'square' },
      bassGain: 0.44, bassSubGain: 1.0, bassCutoffStart: 600, bassCutoffEnd: 120,
    },
    // "Fiscalicia" — the original piece "Alicia", inspired by Clair Obscur:
    // Expedition 33 (same influence as TRACKS.expedition/"Depreciation"
    // above — hence art: 'expense33.jpg' on the SONGS entry). Transcribed
    // from MIDI; the source file has no track name, lyrics, or other
    // identifying text (one track, "Electric Piano", program 5, ~3 minutes
    // long) beyond its own key/tempo/texture: C natural minor, a rolling
    // sustain-pedalled broken-chord figure spanning almost two octaves a
    // bar. voices.lead: 'piano' keeps the solo-keyboard character (same call
    // as ch_legendOfCostbot); 'chamber' drums add just enough pulse without
    // turning a solo-piano ballad into a rock song; 'strings' pad for a
    // little wash under the chords. 32 bars is this excerpt's own length,
    // not the source's — see L.fiscalicia.
    // Mix balance (feedback: backing beat read as too loud/fast, piano
    // should be the star): 'chamber' is already the sparsest drum pattern in
    // the roster (kick on beats 1/3, soft snare on 2/4 — see playStep's
    // 'chamber' case) so the "rushed" feeling wasn't note density, it was
    // raw loudness — kickRaw's peak (0.85, unscaled) is ~8x the piano lead's
    // default peak (0.11), tuned for rock/synthwave tracks, not a solo-piano
    // ballad. drumGain/padGain/leadGain are new per-track knobs (default 1,
    // so every other track is unaffected — see playStep's drumMul/padMul/
    // leadMul) mirroring the existing bassGain/bassSubGain pattern on the
    // bass layer: drumGain: 0.45 pulls kick/snare/hat well back, padGain:
    // 0.75 keeps the strings wash from competing.
    // Round 2 (feedback: melody still reads short/staccato even after the
    // gain boost, "loud AND long"; bass 10-20% softer): the staccato read
    // wasn't gain, it was note DURATION. playStep's lead call passed
    // `stepDur * (cfg.drums ? 3 : 6)` as the piano() voice's `dur` — and
    // piano()'s own gain envelope decays fully to silence over exactly that
    // `dur` (see piano()'s `exponentialRampToValueAtTime(0.0001, t + dur)`),
    // independent of gain. With drums truthy ('chamber'), that was stepDur*3
    // (~0.43s at the source's own 104bpm) — so every note rang for under
    // half a second no matter how long the actual melodic gap to the next
    // note was. leadSustainMul (new knob, default 1, only touches playStep's
    // `sustainMul` — every other track is unaffected) fixed that by
    // stretching the ring independent of gain. leadGain bumped 1.6 -> 2.2
    // (piano peak 0.11 -> 0.242) per "still too quiet, push louder".
    // bassGain/bassSubGain added at ~83% of bass()'s own defaults (0.30/0.55
    // -> 0.25/0.46, a 16-17% cut) so the bass sits back for the louder,
    // longer piano.
    // Round 3 (feedback: "even longer notes, OR closer together/faster —
    // it's too spaced out"): investigated whether this is audio (ring vs.
    // gap) or chart (genuinely sparse real onsets) before picking a fix — see
    // the gap histogram in L.fiscalicia's own comment. Verdict: mostly
    // chart. L.fiscalicia's 139 onsets have a MEDIAN gap of only 3 steps
    // (0.43s at 104bpm) — perfectly normal — but 13 of the 138 onset-to-onset
    // gaps are 8-19 steps (1.15-2.74s), and together those long gaps eat
    // 26.8% of the excerpt's total runtime (19.76s of 73.8s). That rules out
    // Option A (push leadSustainMul alone): the ring/gap ratio in step units
    // is bpm-independent (both scale by the same stepDur), so a mul big
    // enough to meaningfully cover the ~19-step worst gap (mul ~6.3) would
    // make the ring ~19 steps long against the 73 "typical" 3-4 step gaps
    // that make up 45% of the song's transitions — smearing the majority of
    // the tune to fix a minority of it. Also checked for a second MIDI track
    // to splice in (the Game of Loans Cello fix) — alicia2.mid only ever had
    // the one "Electric Piano" track/channel (confirmed during the original
    // transcription), so there's nothing real to splice; inventing notes
    // isn't on the table. And minGap doesn't help either — it only decides
    // how many of the 139 REAL onsets survive per difficulty; it can't
    // shorten a gap that has no onset in it at any minGap setting, so the
    // 26.8%-long-gap number is a property of the transcription itself, not
    // the chart thinning (confirmed: at Ultra's minGap 1, ALL 139 onsets
    // survive and the long gaps are still there).
    // So: bpm 104 -> 130 (x1.25, a clean, moderate revv — the same fix
    // ch_kalm used for an analogous "too sparse/slow" complaint on ITS
    // source, just proportionally smaller here since 104 wasn't nearly as
    // slow as Kalm's 66bpm source). This compresses every real gap
    // uniformly, including the long tail (2.74s -> 2.19s worst case; 0.53s
    // -> 0.43s average), without inventing or reordering a single note.
    // Calibration: post-revv, fiscalicia's avg gap (0.43s) lands almost
    // exactly on ch_kalm's own (0.43s) — kalm being the closest sibling
    // precedent for "revved to fix sparse/slow" — while its max gap (2.19s)
    // stays well under ch_gameofloans' (4.09s) and ch_lostwoods' (4.55s),
    // both unflagged in the existing roster despite bigger gaps than ours.
    // bars*16*(60/bpm/4) at the new bpm is 512*(60/130/4) ≈ 59.1s — just
    // under the roster's usual ~60s floor but in line with ch_xmen's
    // accepted ~56s single pass, so maxLoops stays 1 (no change needed).
    // leadSustainMul bumped 3.5 -> 4.5 alongside the revv: since stepDur
    // shrinks at the higher bpm, holding the multiplier at 3.5 would have
    // quietly SHORTENED the round-2 ring back down (stepDur*3*3.5 ≈ 1.20s
    // at 130bpm, vs. the 1.51s it was at 104bpm) — undoing "longer notes"
    // right as the tempo fix landed. 4.5 restores and modestly extends it:
    // stepDur*3*4.5 ≈ 1.56s. Mush check (ring/gap ratio, bpm-independent):
    // the single-step gaps (11 of 138, 8%, isolated rather than run
    // together — this isn't a fast 16th-note passage) are still the
    // densest case at ~13.5 ring-steps vs. 1 gap-step, but exponential decay
    // to piano()'s near-zero target (0.0001) means the audible tail (down to
    // roughly -40dB) is really only ~59% of the nominal duration, so the
    // practical overlap is closer to 8 steps of decaying tail, not a full
    // 13.5 — reads as pedal-lush on these rare isolated moments, not
    // sustained mud, while the far more common 3-4 step gaps (45% of
    // transitions) get a comfortably-covering, not smearing, ring.
    ch_fiscalicia: {
      title: 'Fiscalicia', influence: 'Expedition 33, piano ballad', bpm: 130, key: 'C minor',
      prog: P.fiscalicia, lead: L.fiscalicia, drums: 'chamber', pad: 'strings', bars: 32,
      arpEvery: 0, bassEvery: 1, gain: 1.0, voices: { lead: 'piano' },
      drumGain: 0.45, padGain: 0.75, leadGain: 2.2, leadSustainMul: 4.5,
      bassGain: 0.25, bassSubGain: 0.46,
    },
    // "Game of Loans", transcribed from MIDI (Game of Thrones · main title
    // theme, C minor, at the source's own pulse). 'brass' lead for the
    // horn-like hook, 'strings' pad for the orchestral wash under it, and
    // 'heartbeat' drums for a driving, ominous pulse (see L.gameOfLoans for
    // how the one-line lead splices in Cello's answering phrases). 33 bars —
    // the source's own length — already runs ~90s in a single pass, so
    // maxLoops: 1 (see TRACKS meta; set on the CostBot Hero song entry).
    ch_gameofloans: {
      title: 'Game of Loans', influence: 'Game of Thrones, main title theme', bpm: 88, key: 'C minor',
      prog: P.gameOfLoans, lead: L.gameOfLoans, drums: 'heartbeat', pad: 'strings', bars: 33,
      arpEvery: 0, bassEvery: 1, gain: 0.65, voices: { lead: 'brass' },
    },
    // "Tariffa", transcribed from MIDI (FF7 · Tifa's Theme), but a deliberately
    // unfaithful dance-club rendition rather than a gentle arrangement (per
    // feedback: recent additions leaned on the melody as the star with light
    // backing — this one goes the other way). The source is a slow (72bpm)
    // solo-piano ballad; revved to 128 (a plain club/house tempo, ~1.8x) —
    // more of a jump than ch_kalm's 66->104 revamp, since "dance club" was
    // asked for more directly than "revved up" was there. 'four' drums, a
    // 'saw' lead + 'square' arp (electronic, not the source's piano tone —
    // same swap ch_fairyfountain/ch_goldsaucer made) and a 'saw' pad instead
    // of strings, so the whole thing reads as an electronic club track with
    // the transcribed tune riding on top, not a piano piece with a beat added.
    // bassGain/bassSubGain/bassCutoffStart/bassCutoffEnd push louder and
    // subbier than the bass() defaults (0.30/0.55/760/190), same recipe as
    // ch_kalm/ch_fairyfountain's lofi bass — but with a brighter cutoff (850
    // vs. their 600) since this wants a present, forward club sub, not a
    // muffled lofi one: "more bass", not "darker bass".
    ch_tariffa: {
      title: 'Tariffa', influence: "FF7 · Tifa's Theme, dance club remix", bpm: 128, key: 'F major / D minor',
      prog: P.tariffa, lead: L.tariffa, drums: 'four', pad: 'saw', bars: 20,
      arpEvery: 2, bassEvery: 2, gain: 0.82, voices: { lead: 'saw', arp: 'square' },
      bassGain: 0.48, bassSubGain: 0.92, bassCutoffStart: 850, bassCutoffEnd: 200,
    },
    // "Under the GCP" — "Under the Sea" (The Little Mermaid, 1989), cost-punned.
    // Generated from under_the_gcp.mid by arcade/tools/mid2chart.js (see
    // P.underthegcp / L.underthegcp). Db major calypso; 'chip' lead for a
    // bright, playful, steel-drum-ish tone rather than the rock 'dist'. First
    // draft straight off the MIDI — tempo (the source's own 200bpm is fast),
    // voices, gains, and P's min/maj guesses are all fair game to tune by ear
    // in playtest, exactly as ch_spenderman was.
    ch_underthegcp: {
      title: 'Under the GCP', influence: 'Under the Sea (The Little Mermaid, 1989)', bpm: 200, key: 'Db major',
      prog: P.underthegcp, lead: L.underthegcp, drums: 'rock', pad: 'power', bars: 32,
      arpEvery: 0, bassEvery: 1, gain: 0.42, voices: { lead: 'chip' },
      drumGain: 1.1, bassGain: 0.5, bassSubGain: 1.0,
    },
    // Three playtest entries generated by arcade/tools/mid2chart.js — voices,
    // gains, tempos, and P's min/maj guesses are all first-draft, to tune by
    // ear like ch_spenderman / ch_underthegcp were.
    ch_aerithrock: {
      // Aerith's Theme sped up to 210bpm (source 146) so the sparse/held-note
      // stretches move (141 bars ≈ 2:41), with a continuous 'saw' arp (arpEvery 2)
      // as a background bed so the quiet parts aren't dead air. pad: null — the
      // arp flows the chord tones instead of the every-bar block chord.
      title: 'Flower Gil', influence: "Aerith's Theme (Final Fantasy VII)", bpm: 210, key: 'D',
      prog: P.aerithrock, lead: L.aerithrock, drums: 'rock', pad: null, bars: 70,
      arpEvery: 2, bassEvery: 1, gain: 0.42, voices: { lead: 'dist', arp: 'saw' },
      drumGain: 1.2, bassGain: 0.5, bassSubGain: 1.0,
    },
    ch_vamo: {
      title: 'Vamo Alla Financio', influence: "Vamo' Alla Flamenco (Final Fantasy IX)", bpm: 147, key: 'A minor',
      prog: P.vamo, lead: L.vamo, drums: 'rock', pad: 'power', bars: 64,
      arpEvery: 0, bassEvery: 1, gain: 0.42, voices: { lead: 'chip' },
      drumGain: 1.2, bassGain: 0.5, bassSubGain: 1.0,
    },
    ch_stolentokens: {
      title: 'Stolen Tokens', influence: "Yuffie's Theme (Final Fantasy VII)", bpm: 108, key: 'G',
      prog: P.stolentokens, lead: L.stolentokens, drums: 'rock', pad: 'power', bars: 31,
      arpEvery: 0, bassEvery: 1, gain: 0.42, voices: { lead: 'chip' },
      drumGain: 1.2, bassGain: 0.5, bassSubGain: 1.0,
    },
    ch_priceali: {
      title: 'Price Ali', influence: '', bpm: 177, key: '',
      prog: P.priceali, lead: L.priceali, drums: 'rock', pad: 'power', bars: 59,
      arpEvery: 0, bassEvery: 1, gain: 0.42, voices: { lead: 'dist' },
      drumGain: 1.2, bassGain: 0.5, bassSubGain: 1.0,
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
    // Fishing has no boss, so all three slots stay in the same key — the kit
    // arriving when you push off from the dock is the only change.
    lagoon:     { label: 'Lake Bossa',     biome: 'field',
                  menu: 'boathouse',  stage: 'lagoon',     boss: 'lagoon' },
    // The dojo drives its own slots directly: menu on the cabinet, stage on the
    // mat, and the 'boss' slot repurposed as the trivia think-cue.
    dojo:       { label: 'Dojo',           biome: 'field',
                  menu: 'dojo_menu',  stage: 'dojo',       boss: 'dojo_trivia' },
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
    // kickRaw/snareRaw/hatRaw/crashRaw take an optional trailing `mul` (default
    // 1) that scales the hit's peak gain — playStep() shadows these with local
    // kick/snare/hat/crash wrappers that inject cfg.drumGain, so every drum
    // pattern's call sites below are untouched and every existing track (which
    // has no drumGain set) sounds exactly as before.
    function kickRaw(t, hard, mul) {
      mul = mul == null ? 1 : mul;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(hard ? 185 : 150, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
      env(g, t, 0.004, hard ? 0.26 : 0.2, (hard ? 1.0 : 0.85) * mul);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.34);
    }
    function snareRaw(t, soft, mul) {
      mul = mul == null ? 1 : mul;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(0.18);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1300;
      const g = ctx.createGain(); env(g, t, 0.003, 0.15, (soft ? 0.16 : 0.42) * mul);
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(190, t);
      env(og, t, 0.003, 0.09, (soft ? 0.09 : 0.22) * mul);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.14);
    }
    function hatRaw(t, open, accent, mul) {
      mul = mul == null ? 1 : mul;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(open ? 0.13 : 0.035);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7600;
      const g = ctx.createGain();
      env(g, t, 0.002, open ? 0.12 : 0.03, (accent ? 0.20 : 0.11) * mul);
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
    }
    function crashRaw(t, mul) {
      mul = mul == null ? 1 : mul;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf(0.9);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5200;
      const g = ctx.createGain(); env(g, t, 0.004, 0.85, 0.20 * mul);
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
    }

    // ---- tonal voices -------------------------------------------------------
    function bass(t, midi, dur, o) {
      o = o || {};
      const gain = o.gain != null ? o.gain : 0.30;
      const subGain = o.subGain != null ? o.subGain : 0.55;
      const cutoffStart = o.cutoffStart != null ? o.cutoffStart : 760;
      const cutoffEnd = o.cutoffEnd != null ? o.cutoffEnd : 190;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoffStart, t);
      f.frequency.exponentialRampToValueAtTime(cutoffEnd, t + Math.max(0.05, dur * 0.9));
      f.Q.value = 7;
      const g = ctx.createGain(); env(g, t, 0.006, dur, gain);
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = mtof(midi);
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = mtof(midi - 12);
      const sg = ctx.createGain(); sg.gain.value = subGain;
      osc.connect(f); sub.connect(sg); sg.connect(f); f.connect(g); g.connect(out);
      osc.start(t); sub.start(t); osc.stop(t + dur + 0.1); sub.stop(t + dur + 0.1);
    }
    function arpNote(t, midi, voice) {
      if (voice === 'piano') return piano(t, midi, 0.7, 0.055);
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(midi);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2700;
      const g = ctx.createGain(); env(g, t, 0.004, 0.11, 0.085);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    }
    function leadSaw(t, midi, dur, mul) {
      mul = mul == null ? 1 : mul;
      const g = ctx.createGain(); env(g, t, 0.012, dur, 0.13 * mul);
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
    function leadDist(t, midi, dur, mul) {
      mul = mul == null ? 1 : mul;
      const g = ctx.createGain(); env(g, t, 0.006, dur, 0.16 * mul);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2800; f.Q.value = 2;
      [-11, 0, 11].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = cents;
        o.connect(f); o.start(t); o.stop(t + dur + 0.1);
      });
      f.connect(g); g.connect(shaper); g.connect(delay);
    }
    function leadBrass(t, midi, dur, mul) {
      mul = mul == null ? 1 : mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15 * mul, t + 0.05);      // slower brass attack
      g.gain.setValueAtTime(0.15 * mul, t + dur * 0.6);
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
    function leadChip(t, midi, dur, mul) {
      // A single square wave with a fast attack, a short sustain and a touch of
      // vibrato — a hand-played NES lead. Runs through the delay like the other
      // arcade leads so it sits in the same space.
      mul = mul == null ? 1 : mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15 * mul, t + 0.006);
      g.gain.setValueAtTime(0.15 * mul, t + Math.max(0.03, dur * 0.55));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(midi);
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
      const lg = ctx.createGain(); lg.gain.value = 4.5;   // cents of vibrato
      lfo.connect(lg); lg.connect(o.detune);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 4200;
      o.connect(f); f.connect(g); g.connect(out); g.connect(delay);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.08); lfo.stop(t + dur + 0.08);
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
    function padChord(t, chord, dur, kind, mul) {
      mul = mul == null ? 1 : mul;
      if (kind === 'power') return powerChord(t, chord, dur, mul);
      const g = ctx.createGain();
      const peak = (kind === 'strings' ? 0.065 : 0.05) * mul;
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
    function powerChord(t, chord, dur, mul) {
      mul = mul == null ? 1 : mul;
      const g = ctx.createGain(); env(g, t, 0.01, dur * 0.9, 0.11 * mul);
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

    const LEADS = { saw: leadSaw, dist: leadDist, brass: leadBrass, chip: leadChip,
                    piano: (t, m, d, mul) => piano(t, m, d, 0.11 * (mul == null ? 1 : mul)) };

    // ---- sequencer ----------------------------------------------------------
    function playStep(i, t) {
      const bar = Math.floor(i / STEPS_PER_BAR);
      const inBar = i % STEPS_PER_BAR;
      const chord = cfg.prog[bar % cfg.prog.length];
      const stepDur = 60 / cfg.bpm / 4;
      const v = cfg.voices || {};

      // Per-layer mix knobs, same idea as bassGain/bassSubGain on the bass
      // layer below: default to 1 (no change) so every existing track — none
      // of which set these — sounds exactly as before. kick/snare/hat/crash
      // are shadowed here (not edited at each call site in the switch below)
      // so drumGain reaches every drum pattern's existing calls for free.
      const drumMul = cfg.drumGain != null ? cfg.drumGain : 1;
      const padMul  = cfg.padGain  != null ? cfg.padGain  : 1;
      const leadMul = cfg.leadGain != null ? cfg.leadGain : 1;
      const kick  = (tt, hard) => kickRaw(tt, hard, drumMul);
      const snare = (tt, soft) => snareRaw(tt, soft, drumMul);
      const hat   = (tt, open, accent) => hatRaw(tt, open, accent, drumMul);
      const crash = (tt) => crashRaw(tt, drumMul);

      // A long loop needs shape, not just length. `breakBars` drops the kit and
      // the bass for a bar or two so the loop breathes; `fillBar` runs a snare
      // crescendo into the next section; `crashBars` marks the downbeats that
      // start one. All three are optional — a track that omits them behaves
      // exactly as it did before.
      const quiet = cfg.breakBars ? cfg.breakBars.indexOf(bar) !== -1 : false;
      const filling = cfg.fillBar === bar;

      if (cfg.pad && inBar === 0) padChord(t, chord, stepDur * STEPS_PER_BAR * 0.98, cfg.pad, padMul);

      if (quiet) {
        // keep the pulse alive with an open hat on the backbeat, nothing more
        if (inBar === 4 || inBar === 12) hat(t, true, false);
      } else if (filling) {
        if (inBar === 0 || inBar === 8) kick(t, true);
        // accelerating roll: 8ths, then 16ths, getting louder into the loop point
        if (inBar < 8 ? inBar % 4 === 0 : inBar % 2 === 0) snare(t, inBar < 8);
        if (inBar >= 12) snare(t, false);
        hat(t, false, inBar % 4 === 0);
      } else switch (cfg.drums) {
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
        case 'bossa':
          // Soft surdo on 1 and 3, a shaker in 8ths, and the two-bar bossa
          // clave tapped on the rim. The clave is what makes it lazy rather
          // than merely slow — nothing lands where a rock beat would put it.
          if (inBar === 0 || inBar === 8) kick(t, false);
          if (inBar % 2 === 0) hat(t, false, false);
          if (bar % 2 === 0
            ? (inBar === 0 || inBar === 6 || inBar === 12)
            : (inBar === 2 || inBar === 8)) snare(t, true);
          break;
        case 'rock':
          if (inBar === 0 || inBar === 8 || inBar === 11) kick(t, false);
          if (inBar === 4 || inBar === 12) snare(t);
          if (inBar % 2 === 0) hat(t, inBar === 14, inBar % 4 === 0);
          if (bar === 0 && inBar === 0) crash(t);
          break;
        case 'heartbeat':
          // A literal lub-dub pulse, once per beat, every beat of every bar —
          // the dominant, unmistakable element of the cue. "Lub" is a hard low
          // kick on the beat; "dub" is a softer second kick one 16th later;
          // the remaining two 16ths of the beat rest before the next lub.
          if (inBar % 4 === 0) kick(t, true);   // lub
          if (inBar % 4 === 1) kick(t, false);  // dub
          if (inBar === 4 || inBar === 12) snare(t);
          if (inBar % 4 === 2) hat(t, false, false);
          if (bar === 0 && inBar === 0) crash(t);
          break;
        default: break;
      }

      if (inBar === 0 && cfg.crashBars && cfg.crashBars.indexOf(bar) !== -1) crash(t);

      if (cfg.bassLine && !quiet) {
        const bn = cfg.bassLine[i % cfg.bassLine.length];
        if (bn != null) {
          bass(t, bn, stepDur * 0.92, {
            gain: cfg.bassGain, subGain: cfg.bassSubGain,
            cutoffStart: cfg.bassCutoffStart, cutoffEnd: cfg.bassCutoffEnd,
          });
        }
      } else if (cfg.bassEvery && !quiet && i % cfg.bassEvery === 0) {
        const oct = (inBar % 8 === 4) ? 12 : 0;
        bass(t, chord.root + oct, stepDur * cfg.bassEvery * 0.92, {
          gain: cfg.bassGain, subGain: cfg.bassSubGain,
          cutoffStart: cfg.bassCutoffStart, cutoffEnd: cfg.bassCutoffEnd,
        });
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
        // leadSustainMul (default 1, so every track without it behaves exactly
        // as before) stretches the note's own ring time independent of gain —
        // gain controls how LOUD the decay is, this controls how LONG it is.
        const sustainMul = cfg.leadSustainMul != null ? cfg.leadSustainMul : 1;
        if (n != null) (LEADS[v.lead] || leadSaw)(t, n, stepDur * (cfg.drums ? 3 : 6) * sustainMul, leadMul);
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
