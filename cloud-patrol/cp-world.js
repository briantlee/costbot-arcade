/* ============================================================================
 * CostBot: Cloud Patrol — the world
 * ----------------------------------------------------------------------------
 * The Space Harrier half of the cabinet: the checkerboard ground that sells the
 * speed, the stages it is painted for, the things that rise out of it for you to
 * dodge, the Megabill serpent's body, the bonus-stage piggy bank, and CostBot's
 * robot voice. Everything here is scene-building; cp-game.js owns the rules.
 * ==========================================================================*/
import * as THREE from 'three';

// Stages cycle; each one repaints the ground, sky and fog and weights the
// obstacles. `boss` alternates the disc boss with the Megabill serpent.
export const STAGES = [
  { name: 'Ledger Plains',      a: 0x14305c, b: 0x1f7f88, sky: 0x060a1a, obstacles: ['rack', 'stack'],          boss: 'disc' },
  { name: 'S3 Sprawl',          a: 0x3a2610, b: 0xc98a2a, sky: 0x140b05, obstacles: ['stack', 'rack'],          boss: 'serpent' },
  { name: 'Kinesis Canyon',     a: 0x281446, b: 0x6b2fa0, sky: 0x0b0618, obstacles: ['spike', 'rack'],          boss: 'disc' },
  { name: 'Snapshot Graveyard', a: 0x1a2a1c, b: 0x3f6e3a, sky: 0x050c08, obstacles: ['stack', 'spike'],         boss: 'serpent' },
  { name: 'NAT Nebula',         a: 0x3a0f1c, b: 0xb3122e, sky: 0x10040a, obstacles: ['spike', 'rack', 'stack'], boss: 'disc' },
  { name: 'Reserved Ridge',     a: 0x0f3a3a, b: 0x2aa3a0, sky: 0x04100f, obstacles: ['rack', 'spike', 'stack'], boss: 'serpent' },
];
export const stageFor = (i) => STAGES[i % STAGES.length];
export const BONUS_EVERY = 3;          // a piggy-bank ride after every third stage

// ---------------------------------------------------------------------------
// the ground: an endless checkerboard, scrolled in the shader so it costs nothing
// ---------------------------------------------------------------------------
export function makeGround() {
  const uniforms = {
    uOff: { value: 0 },
    uA: { value: new THREE.Color(STAGES[0].a) },
    uB: { value: new THREE.Color(STAGES[0].b) },
    uFog: { value: new THREE.Color(STAGES[0].sky) },
    uGlow: { value: new THREE.Color(0x4fe3ff) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vW; varying float vD;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xz;
        vec4 mv = viewMatrix * wp;
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOff; uniform vec3 uA, uB, uFog, uGlow;
      varying vec2 vW; varying float vD;
      void main() {
        vec2 p = vec2(vW.x, vW.y - uOff) / 4.0;
        // anti-aliased checker: soften the square edges as they get small on screen
        vec2 w = fwidth(p) + 1e-4;
        vec2 s = clamp(0.5 + 0.5 * sin(p * 3.14159265) / (w * 3.14159265), 0.0, 1.0);
        float k = s.x * s.y + (1.0 - s.x) * (1.0 - s.y);
        vec3 col = mix(uA, uB, k);
        // a faint glow line on every tile edge, fading with distance
        vec2 g = abs(fract(p) - 0.5);
        float line = smoothstep(0.47, 0.5, max(g.x, g.y)) * (1.0 - smoothstep(10.0, 90.0, vD));
        col += uGlow * line * 0.35;
        float f = smoothstep(25.0, 210.0, vD);
        gl_FragColor = vec4(mix(col, uFog, f), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, -170);
  mesh.frustumCulled = false;
  return {
    mesh, uniforms,
    scroll(dz) { uniforms.uOff.value += dz; },
    paint(stage, k = 1) {
      uniforms.uA.value.lerp(new THREE.Color(stage.a), k);
      uniforms.uB.value.lerp(new THREE.Color(stage.b), k);
      uniforms.uFog.value.lerp(new THREE.Color(stage.sky), k);
    },
  };
}

// ---------------------------------------------------------------------------
// obstacles: things that rise out of the ground. Indestructible — dodge them.
// Each carries its footprint (half-width) and height for the collision test.
// ---------------------------------------------------------------------------
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export const invoiceTexture = () => canvasTex(256, 320, (g, w, h) => {
  g.fillStyle = '#f6f3ea'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#0d1b3a'; g.font = '800 30px system-ui,sans-serif'; g.fillText('INVOICE', 22, 46);
  g.fillStyle = '#9aa6bb';
  for (let y = 78; y < 250; y += 22) g.fillRect(22, y, 120 + ((y * 37) % 90), 8);
  g.fillStyle = '#0d1b3a'; g.font = '900 34px system-ui,sans-serif'; g.fillText('$$$', 150, 290);
  g.save(); g.translate(128, 170); g.rotate(-0.35);
  g.strokeStyle = '#d0263a'; g.lineWidth = 7; g.strokeRect(-92, -26, 184, 52);
  g.fillStyle = '#d0263a'; g.font = '900 34px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('OVERDUE', 0, 12);
  g.restore();
});

export function buildObstacles() {
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x1c2436, metalness: 0.6, roughness: 0.4 });
  const rackTrim = new THREE.MeshStandardMaterial({ color: 0x55627d, metalness: 0.8, roughness: 0.3 });
  const led = [glow(0.3, 2.2, 1.0), glow(2.4, 0.5, 0.3), glow(0.4, 1.4, 2.6)];
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc81e3a, emissive: 0x7a0a18, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.2 });
  const spikeTip = glow(3, 0.4, 0.6);
  const paper = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.85 });
  const paperEdge = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.9 });
  const invoice = invoiceTexture();
  const invoiceFace = new THREE.MeshStandardMaterial({ map: invoice, roughness: 0.8 });

  return {
    // a server rack tower with blinking LEDs — ~idle capacity you have to fly around
    rack() {
      const h = 5 + Math.random() * 4, g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, h, 1.8), rackMat); body.position.y = h / 2; g.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 2.0), rackTrim); cap.position.y = h; g.add(cap);
      for (let y = 0.6; y < h - 0.3; y += 0.55) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.02), led[Math.floor(Math.random() * 3)]);
        l.position.set(-0.7 + Math.random() * 1.4, y, 0.91); g.add(l);
      }
      g.userData = { half: 1.2, depth: 1.0, height: h };
      return g;
    },
    // a cost-spike obelisk — red, sharp, rising
    spike() {
      const h = 5.5 + Math.random() * 4, g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, h, 4), spikeMat); body.position.y = h / 2; body.rotation.y = Math.PI / 4; g.add(body);
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), spikeTip); tip.position.y = h + 0.1; g.add(tip);
      g.userData = { half: 0.8, depth: 0.8, height: h };
      return g;
    },
    // a toppling stack of invoices
    stack() {
      const n = 7 + Math.floor(Math.random() * 7), g = new THREE.Group();
      let y = 0;
      for (let i = 0; i < n; i++) {
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 3.0), [paperEdge, paperEdge, paper, paper, invoiceFace, paperEdge]);
        sheet.position.set((Math.random() - 0.5) * 0.35, y + 0.28, (Math.random() - 0.5) * 0.3);
        sheet.rotation.y = (Math.random() - 0.5) * 0.3;
        g.add(sheet); y += 0.56;
      }
      g.userData = { half: 1.3, depth: 1.6, height: y };
      return g;
    },
  };
}

// ---------------------------------------------------------------------------
// the Megabill serpent's body: a chain of overdue invoices
// ---------------------------------------------------------------------------
export function makeSerpentSegment() {
  if (!makeSerpentSegment.mat) {
    const tex = invoiceTexture();
    makeSerpentSegment.mat = [
      new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0x220000, emissiveIntensity: 0.4 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }),
    ];
    makeSerpentSegment.geo = new THREE.BoxGeometry(2.0, 2.5, 0.35);
  }
  const m = new THREE.Mesh(makeSerpentSegment.geo, makeSerpentSegment.mat.map((x) => x.clone()));
  return m;
}

// ---------------------------------------------------------------------------
// the bonus-stage mount: a flying piggy bank
// ---------------------------------------------------------------------------
export function makePiggy() {
  const pink = new THREE.MeshPhysicalMaterial({ color: 0xff8fb3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 });
  const pinkDark = new THREE.MeshPhysicalMaterial({ color: 0xe0628a, roughness: 0.4, clearcoat: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1020, roughness: 0.6 });
  const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf7bd1c, metalness: 1, roughness: 0.25 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), pink); body.scale.set(1.35, 1.05, 1.7); g.add(body);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.35, 24), pinkDark);
  snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.05, -1.72); g.add(snout);
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), dark); n.position.set(s * 0.14, 0.05, -1.9); g.add(n);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 12), pinkDark); ear.position.set(s * 0.65, 0.95, -0.9); ear.rotation.set(-0.4, 0, s * 0.3); g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), dark); eye.position.set(s * 0.45, 0.45, -1.45); g.add(eye);
    for (const z of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.6, 12), pinkDark); leg.position.set(s * 0.7, -0.95, z); g.add(leg);
    }
  }
  const wings = [-1, 1].map((s) => {
    const w = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), wingMat);
    w.scale.set(0.95, 0.12, 0.5); w.position.set(s * 1.55, 0.35, 0);
    g.add(w);
    return w;
  });
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.12), dark); slot.position.set(0, 1.06, 0.3); g.add(slot);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 24), gold); coin.rotation.x = Math.PI / 2; coin.position.set(0, 1.2, 0.3); g.add(coin);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 16, Math.PI * 1.6), pinkDark); tail.position.set(0, 0.3, 1.75); g.add(tail);
  g.userData.flap = (t) => { wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.sin(t * 16) * 0.5; }); coin.rotation.z = t * 5; };
  return g;
}

// ---------------------------------------------------------------------------
// CostBot's voice: eSpeak (meSpeak.js, vendored, GPL — see shared/vendor/mespeak)
// renders each line to audio, and the cabinet's own WebAudio graph makes it
// CostBot: a touch faster and higher (kid), a ring modulator blended under the
// clean voice (robot, still intelligible), a short metallic comb (synth), and a
// thinner band (androgynous). Plays through the game master, so M mutes it.
// If the engine can't load, falls back to browser speech.
// ---------------------------------------------------------------------------
// Presets for the (temporary) Voice Lab. espeak = eSpeak's own knobs (pitch 0–99,
// speed wpm, variant); rate = playback speed-up (pitch + tempo); ringHz/ringMix =
// the robot; comb* = tin-can shimmer. engine:'browser' uses built-in speech instead: browserVoice
// names a voice (or a list, first available wins) and fallback an eSpeak preset for when none exist.
export const DEFAULT_VOICE = 'zarvox';
export const VOICE_PRESETS = [
  // the default: browser speech, first voice this browser has — macOS's Zarvox, then Chrome's
  // Google US English — and if neither, CostBot (classic) below rather than the OS default voice.
  { id: 'zarvox', name: 'Zarvox → Google US English → CostBot (default)', engine: 'browser', browserVoice: ['Zarvox', 'Google US English'], pitch: 1, rate: 1, fallback: 'costbot' },
  // tuned in the lab to 80% pitch, 50% speed, 20% robot; Zarvox's fallback
  { id: 'costbot', name: 'CostBot (classic)', espeak: { pitch: 79, speed: 165, variant: 'f2' }, rate: 1.12, ringHz: 52, ringMix: 0.16, combMs: 6, combFeedback: 0.32, combMix: 0.08 },
  { id: 'chip', name: 'Chiptune Buddy', espeak: { pitch: 84, speed: 165, variant: 'klatt2' }, rate: 1.3, ringHz: 110, ringMix: 0.4, combMs: 3, combFeedback: 0.4, combMix: 0.2 },
  { id: 'littlebot', name: 'Little Bot', espeak: { pitch: 82, speed: 170, variant: 'f5' }, rate: 1.2, ringHz: 70, ringMix: 0.3, combMs: 5, combFeedback: 0.25, combMix: 0.15 },
  { id: 'sprite', name: 'Sprite', espeak: { pitch: 92, speed: 182, variant: 'f4' }, rate: 1.25, ringHz: 90, ringMix: 0.22, combMs: 4, combFeedback: 0.2, combMix: 0.1 },
  { id: 'retro', name: 'Retro Computer', espeak: { pitch: 50, speed: 150, variant: 'klatt' }, rate: 1.0, ringHz: 0, ringMix: 0, combMs: 8, combFeedback: 0.2, combMix: 0.12 },
  { id: 'klattkid', name: 'Klatt Kid', espeak: { pitch: 86, speed: 165, variant: 'klatt3' }, rate: 1.16, ringHz: 46, ringMix: 0.25, combMs: 6, combFeedback: 0.25, combMix: 0.15 },
  { id: 'tincan', name: 'Tin Can', espeak: { pitch: 60, speed: 150, variant: 'm3' }, rate: 1.1, ringHz: 62, ringMix: 0.58, combMs: 7, combFeedback: 0.5, combMix: 0.45 },
  { id: 'dalek', name: 'Dalek-lite', espeak: { pitch: 38, speed: 140, variant: 'm1' }, rate: 1.0, ringHz: 30, ringMix: 0.75, combMs: 9, combFeedback: 0.35, combMix: 0.25 },
  { id: 'soft', name: 'Soft Synth', espeak: { pitch: 72, speed: 150, variant: 'whisperf' }, rate: 1.1, ringHz: 50, ringMix: 0.3, combMs: 6, combFeedback: 0.3, combMix: 0.3 },
  { id: 'croak', name: 'Croak Bot', espeak: { pitch: 70, speed: 152, variant: 'croak' }, rate: 1.15, ringHz: 55, ringMix: 0.35, combMs: 6, combFeedback: 0.3, combMix: 0.2 },
  { id: 'clean', name: 'Clean Kid (no robot)', espeak: { pitch: 86, speed: 165, variant: 'f3' }, rate: 1.15, ringHz: 0, ringMix: 0, combMs: 6, combFeedback: 0, combMix: 0 },
  { id: 'browser', name: 'Browser speech (built-in)', engine: 'browser', pitch: 1.5, rate: 1.1 },
];
let VOICE = { ...VOICE_PRESETS[0], level: 0.7 };
let meSpeakReady = null;
function loadMeSpeak() {
  if (meSpeakReady) return meSpeakReady;
  const base = new URL('../shared/vendor/mespeak/', import.meta.url).href;
  meSpeakReady = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = base + 'mespeak.js';
    sc.onload = resolve; sc.onerror = reject;
    document.head.appendChild(sc);
  }).then(() => Promise.all([fetch(base + 'mespeak_config.json').then((r) => r.json()), fetch(base + 'voices/en-us.json').then((r) => r.json())]))
    .then(([cfg, voice]) => { window.meSpeak.loadConfig(cfg); window.meSpeak.loadVoice(voice); return window.meSpeak; });
  return meSpeakReady;
}

export function makeVoice(getNodes) {
  let muted = false, engine = null, current = null, busyUntil = 0;
  loadMeSpeak().then((m) => { engine = m; }).catch(() => { engine = null; });
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const stopCurrent = () => { if (current) { try { current.stop(); } catch { /* ended */ } current = null; } if (synth) synth.cancel(); busyUntil = 0; };

  function play(ctx, master, audioBuf, V) {
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.playbackRate.value = V.rate;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6200;
    const out = ctx.createGain(); out.gain.value = V.level;
    src.connect(hp);
    // clean voice
    const dry = ctx.createGain(); dry.gain.value = 1 - (V.ringMix || 0) * 0.5;
    hp.connect(dry).connect(lp);
    // ring modulator: the voice multiplied by a low sine — the classic robot
    const ring = ctx.createGain(); ring.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = V.ringHz || 1;
    lfo.connect(ring.gain);
    const ringOut = ctx.createGain(); ringOut.gain.value = V.ringHz ? V.ringMix : 0;
    hp.connect(ring).connect(ringOut).connect(lp);
    // a short comb for that tin-can shimmer
    const dl = ctx.createDelay(0.05); dl.delayTime.value = (V.combMs || 6) / 1000;
    const fb = ctx.createGain(); fb.gain.value = V.combFeedback || 0;
    const comb = ctx.createGain(); comb.gain.value = V.combMix || 0;
    hp.connect(dl); dl.connect(fb).connect(dl); dl.connect(comb).connect(lp);
    lp.connect(out).connect(master);
    const t = ctx.currentTime + 0.02;
    src.start(t); lfo.start(t);
    const dur = audioBuf.duration / V.rate;
    lfo.stop(t + dur + 0.3);
    busyUntil = t + dur;
    current = src;
    src.onended = () => { if (current === src) current = null; };
  }

  let browserVoice = VOICE.browserVoice || null;   // the default preset's voices, even before setPreset()
  // Chrome fills the voice list lazily: ask early so it's there by the first line
  if (synth) { synth.getVoices(); synth.addEventListener?.('voiceschanged', () => synth.getVoices()); }
  // first of the named voices (a name or a list) this browser has
  const pickBrowserVoice = (names) => {
    if (!names || !synth) return null;
    const vs = synth.getVoices();
    for (const n of [].concat(names)) { const v = vs.find((x) => x.name === n); if (v) return v; }
    return null;
  };
  const presetVoice = (id) => {
    const base = VOICE_PRESETS.find((x) => x.id === id) || VOICE_PRESETS[0];
    return { ...base, espeak: { ...(base.espeak || {}) }, level: 0.7 };
  };
  return {
    setMuted(m) { muted = m; if (m) stopCurrent(); },
    // Voice Lab: pick a preset (plus optional overrides: { pitch, speed, robot } as 0–1 sliders)
    setPreset(id, tweak = {}) {
      VOICE = presetVoice(id);
      if (tweak.pitch != null && VOICE.espeak) VOICE.espeak.pitch = Math.round(tweak.pitch * 99);
      if (tweak.speed != null && VOICE.espeak) VOICE.espeak.speed = Math.round(110 + tweak.speed * 110);
      if (tweak.robot != null && VOICE.espeak) { VOICE.ringMix = tweak.robot * 0.8; VOICE.ringHz = VOICE.ringHz || 52; VOICE.combMix = tweak.robot * 0.4; }
      browserVoice = tweak.browserVoice || VOICE.browserVoice || null;
      return VOICE;
    },
    get preset() { return VOICE; },
    get ready() { return !!engine; },
    // `urgent` lines cut in; the rest wait for quiet and are skipped if he's mid-sentence
    say(text, { urgent = false } = {}) {
      if (muted) return;
      const n = getNodes && getNodes();
      if (!n) return;
      const { ctx, master } = n;
      if (!urgent && ctx.currentTime < busyUntil) return;
      if (urgent) stopCurrent();
      const bv = pickBrowserVoice(browserVoice);
      // none of the named browser voices on this OS: use the preset's eSpeak fallback instead
      const V = VOICE.engine === 'browser' && VOICE.fallback && !bv ? presetVoice(VOICE.fallback) : VOICE;
      if (engine && V.engine !== 'browser') {
        // eSpeak spells out some capitalised words mid-sentence ("Cloud Zone" → "Z-O-N-E"),
        // so Title-case words go in lowercase; ALL-CAPS acronyms are left alone.
        const said = text.replace(/\b[A-Z][a-z]+\b/g, (w) => w.toLowerCase());
        const wav = engine.speak(said, { rawdata: 'array', wordgap: 1, ...V.espeak });
        if (!wav) return;
        const bytes = wav instanceof ArrayBuffer ? wav : new Uint8Array(wav).buffer;
        busyUntil = ctx.currentTime + 0.5;          // hold the slot while it decodes
        ctx.decodeAudioData(bytes.slice(0)).then((buf) => { if (!muted) play(ctx, master, buf, V); }).catch(() => {});
      } else if (synth) {                             // engine not loaded (yet): plain browser speech
        const u = new SpeechSynthesisUtterance(text);
        u.pitch = V.pitch || 1.5; u.rate = V.rate || 1.1; u.volume = 0.5;
        if (bv) u.voice = bv;
        synth.speak(u);
        busyUntil = ctx.currentTime + 0.08 * text.length;
      }
    },
    stop: stopCurrent,
  };
}
