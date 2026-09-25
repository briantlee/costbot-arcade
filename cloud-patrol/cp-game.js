/* ============================================================================
 * CostBot: Cloud Patrol — the game
 * ----------------------------------------------------------------------------
 * A 3D rail shooter. CostBot flies into the screen through the cloud; waste
 * comes at him, coins come at him, and every so often a megabill vendor turns up
 * as a boss with its bill as a health bar. Shoot the waste, grab the coins, shrink
 * the bill.
 *
 *   import { mount } from './cp-game.js';
 *   const game = mount('#game', {
 *     profile,                 // optional saved profile (server slice)
 *     onEvent(type, payload),  // 'ready' | 'run:start' | 'run:end' | 'unlock' | …
 *     onComplete(result),      // fired at the end of every run
 *   });
 *
 * result = { game:'cloud-patrol', outcome:'death'|'quit', stageId:'endless', seed:0,
 *            dollarsSaved:0, tokensEarned, score, combo, kills, level, coins,
 *            quizCorrect:0, quizWrong:0, durationMs, profile }
 *
 * `dollarsSaved` is always 0: nothing here saves real money, and the arcade ranks
 * every cabinet on what it actually measures (see README). This one is score.
 *
 * Test hooks (URL): ?play=1 starts a run at once, ?boss=1 brings the first boss
 * in after 2s, ?vendor=<name> picks it, ?god=1 turns off damage, ?outfit=<id> previews an outfit. `window.cloudPatrol` exposes the
 * live state for headless checks.
 * ==========================================================================*/
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCostBot, OUTFITS, makeCoinFactory } from '../shared/costbot-3d.js';
import { VENDORS, ENEMIES, POWERUPS, BALANCE as B, BOSS_LINES, QUIPS, SECRETS } from './cp-content.js';

const GAME_ID = 'cloud-patrol';
const KEY = 'costbot.cloudpatrol.v1';
const VERSION = '0.1.0';
const BOT_SCALE = 0.6;
const FIELD = { x: 7, yMin: 0.2, yMax: 6 };
const HIT_Y = 0.8;          // player hitbox sits this far above the root
const HIT_R = 0.75;
const SPAWN_Z = -140;
const BOSS_R = 3.4;
const MUSIC_VOL = 0.45;

const NO_WALLET = { tokens: 0, earn: () => 0, spend: () => false, bank: () => 0, init: () => ({}), onChange: () => () => {} };
const wallet = () => window.ArcadeWallet || NO_WALLET;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = THREE.MathUtils.lerp;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------
function blankProfile() {
  return { version: 1, best: 0, bestCombo: 0, runs: 0, bosses: 0, unlocked: ['classic'], outfit: 'classic',
    secrets: [], muted: false, updatedAt: 0 };
}
export function loadProfile() {
  try { return { ...blankProfile(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return blankProfile(); }
}
function mergeProfiles(a, b) {
  if (!b) return a;
  return { ...a, best: Math.max(a.best || 0, b.best || 0), bestCombo: Math.max(a.bestCombo || 0, b.bestCombo || 0),
    runs: Math.max(a.runs || 0, b.runs || 0), bosses: Math.max(a.bosses || 0, b.bosses || 0),
    unlocked: [...new Set([...(a.unlocked || []), ...(b.unlocked || [])])],
    secrets: [...new Set([...(a.secrets || []), ...(b.secrets || [])])],
    outfit: (a.updatedAt || 0) >= (b.updatedAt || 0) ? a.outfit : b.outfit };
}

// ---------------------------------------------------------------------------
// audio: little synth sfx on one master, which the soundtrack also plays through
// ---------------------------------------------------------------------------
function makeAudio() {
  let ctx = null, master = null, muted = false;
  function ensure() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0.0001 : 0.32;
    master.connect(ctx.destination);
    return ctx;
  }
  function tone(freq, dur, type, gain, to, delay = 0) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain || 0.12, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, gain, freq, type = 'bandpass', to) {
    const c = ensure(); if (!c || muted) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq || 1500;
    if (to) f.frequency.exponentialRampToValueAtTime(to, c.currentTime + dur);
    const g = c.createGain(); g.gain.value = gain || 0.3;
    src.connect(f).connect(g).connect(master);
    src.start();
  }
  return {
    nodes() { const c = ensure(); return c ? { ctx: c, master } : null; },
    resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      const c = ensure();
      if (c && master) master.gain.setTargetAtTime(muted ? 0.0001 : 0.32, c.currentTime, 0.05);
    },
    // cha-ching: two bright bells over a register rattle
    coin: () => { tone(1318, 0.09, 'triangle', 0.13); tone(1976, 0.22, 'triangle', 0.12, null, 0.06); },
    laser: () => tone(1500, 0.09, 'square', 0.035, 380),
    pop: () => { noise(0.16, 0.3, 1800); tone(220, 0.12, 'square', 0.06, 90); },
    hurt: () => { tone(300, 0.35, 'sawtooth', 0.14, 60); noise(0.3, 0.3, 600); },
    shieldBreak: () => { tone(900, 0.25, 'triangle', 0.12, 300); noise(0.2, 0.2, 3000); },
    whoosh: () => noise(0.4, 0.35, 400, 'bandpass', 3000),
    power: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.07, null, i * 0.06)),
    beep: () => tone(1200, 0.05, 'sine', 0.06),
    click: () => tone(700, 0.06, 'square', 0.06, 900),
    alarm: () => { for (let i = 0; i < 3; i++) { tone(660, 0.16, 'sawtooth', 0.08, null, i * 0.36); tone(440, 0.16, 'sawtooth', 0.08, null, i * 0.36 + 0.18); } },
    bossHit: () => tone(260, 0.07, 'square', 0.05, 180),
    boom: () => { noise(1.1, 0.55, 500, 'lowpass', 60); tone(110, 0.9, 'sine', 0.3, 30); },
    fanfare: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, null, i * 0.09)),
    gameOver: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, null, i * 0.2)),
  };
}

// ---------------------------------------------------------------------------
// textures + meshes
// ---------------------------------------------------------------------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const softDot = () => canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const cloudTex = () => canvasTex(256, 128, (g) => {
  for (let i = 0; i < 14; i++) {
    const x = rand(50, 206), y = rand(50, 86), r = rand(24, 46);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
});
const emojiTex = (ch) => canvasTex(128, 128, (g) => {
  g.font = '92px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 72);
});
const textTex = (txt, color) => canvasTex(128, 64, (g) => {
  g.font = '800 44px system-ui,sans-serif'; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, 64, 34);
});

function badgeTexture(v) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = v.color; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
    g.fillStyle = v.color;
    if (v.path) {
      g.save(); g.translate(60, 60); g.scale(136 / 24, 136 / 24); g.fill(new Path2D(v.path)); g.restore();
    } else {
      const label = v.name.toUpperCase();
      let size = 72;
      do { g.font = `800 ${size}px system-ui, sans-serif`; size -= 4; } while (g.measureText(label).width > 180);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 128, 132);
    }
  });
}

const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

function buildFactories() {
  const dot = softDot();
  const zzz = textTex('Zzz', '#9fd8ff');
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.8, roughness: 0.35 });
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x4a5264, metalness: 0.7, roughness: 0.4 });
  const idleLamp = glow(1.6, 0.8, 0.2);
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, emissive: 0x6d8cff, emissiveIntensity: 0.7,
    transparent: true, opacity: 0.82, roughness: 0.5 });
  const black = new THREE.MeshBasicMaterial({ color: 0x0b0f1c });
  const natMat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff1f2e, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffd0d4, emissive: 0xff6070, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3 });

  const ghostProfile = [];
  for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI / 2; ghostProfile.push(new THREE.Vector2(Math.sin(a) * 0.7, 0.3 + Math.cos(a) * 0.7)); }
  ghostProfile.reverse();
  ghostProfile.push(new THREE.Vector2(0.72, -0.5), new THREE.Vector2(0.001, -0.5));
  const ghostGeo = new THREE.LatheGeometry(ghostProfile, 32);
  { // wavy hem
    const p = ghostGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < -0.3) p.setY(i, p.getY(i) + Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 6) * 0.12);
    }
    ghostGeo.computeVertexNormals();
  }
  const ico = new THREE.IcosahedronGeometry(0.6, 0);
  const icoVerts = [];
  { const p = ico.attributes.position; const seen = new Set();
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const k = v.toArray().map((n) => n.toFixed(2)).join(); if (!seen.has(k)) { seen.add(k); icoVerts.push(v); } } }
  const coneGeo = new THREE.ConeGeometry(0.16, 0.5, 8).translate(0, 0.25, 0);

  const coin = makeCoinFactory();
  return {
    dot,
    coin: () => { const c = coin(); c.scale.setScalar(1.6); return c; },
    ebs() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 28), metal); g.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 28), metalDark); top.position.y = 0.28; g.add(top);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), idleLamp); lamp.position.set(0.55, 0.1, 0.4); g.add(lamp);
      const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: zzz, transparent: true, depthWrite: false }));
      z.scale.set(1.4, 0.7, 1); z.position.y = 0.95; g.add(z);
      return g;
    },
    ghost() {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(ghostGeo, ghostMat));
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), black); e.position.set(s * 0.22, 0.55, 0.62); e.scale.set(1, 1.5, 0.6); g.add(e); }
      return g;
    },
    nat() {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(ico, natMat));
      for (const v of icoVerts) {
        const s = new THREE.Mesh(coneGeo, spikeMat);
        s.position.copy(v); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()); g.add(s);
      }
      return g;
    },
    spike() {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), glow(3, 0.35, 0.7)));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff4466, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(1.8); g.add(halo);
      return g;
    },
    laser: (() => {
      const geo = new THREE.CapsuleGeometry(0.07, 1.3, 4, 8).rotateX(Math.PI / 2);
      const mat = glow(0.45, 1.5, 1.8);
      return () => new THREE.Mesh(geo, mat);
    })(),
    powerup(kind) {
      const def = POWERUPS[kind];
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16),
        new THREE.MeshPhysicalMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.5, transparent: true, opacity: 0.35, roughness: 0.1, clearcoat: 1 })));
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex(def.icon), transparent: true, depthWrite: false }));
      icon.scale.setScalar(1.05); g.add(icon);
      return g;
    },
    boss(v) {
      const g = new THREE.Group();
      const R = BOSS_R;
      const map = badgeTexture(v);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.4, 56, 1, true).rotateX(Math.PI / 2),
        new THREE.MeshPhysicalMaterial({ color: v.color, roughness: 0.3, metalness: 0.4, clearcoat: 1, side: THREE.DoubleSide })));
      const faceMat = new THREE.MeshBasicMaterial({ map, toneMapped: false });
      for (const s of [1, -1]) {
        const f = new THREE.Mesh(new THREE.CircleGeometry(R, 56), faceMat);
        f.position.z = s * 0.2; if (s < 0) f.rotation.y = Math.PI; g.add(f);
      }
      const aura = new THREE.Mesh(new THREE.TorusGeometry(R + 0.35, 0.12, 10, 64), glow(2.6, 0.3, 0.5));
      g.add(aura);
      g.userData.faceMat = faceMat;
      g.userData.aura = aura;
      return g;
    },
  };
}

// a pool of additive sparks for explosions and pickups
function makeSparks(dot, n = 700) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3), life = new Float32Array(n);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.5, map: dot, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let next = 0;
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
  const c = new THREE.Color();
  return {
    points,
    burst(at, color, count = 30, speed = 8) {
      c.set(color);
      for (let k = 0; k < count; k++) {
        const i = next; next = (next + 1) % n;
        pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
        const d = new THREE.Vector3().randomDirection().multiplyScalar(speed * rand(0.3, 1));
        vel[i * 3] = d.x; vel[i * 3 + 1] = d.y; vel[i * 3 + 2] = d.z;
        life[i] = rand(0.5, 1.0);
        col[i * 3] = c.r * 2; col[i * 3 + 1] = c.g * 2; col[i * 3 + 2] = c.b * 2;
      }
    },
    update(dt, drift) {
      for (let i = 0; i < n; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        const f = life[i] <= 0 ? 0 : 0.96;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += (vel[i * 3 + 2] + drift) * dt;
        vel[i * 3] *= f; vel[i * 3 + 1] *= f; vel[i * 3 + 2] *= f;
        col[i * 3] *= 0.96; col[i * 3 + 1] *= 0.96; col[i * 3 + 2] *= 0.96;
        if (life[i] <= 0) pos[i * 3 + 1] = -999;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const CSS = `
.cp-root{position:absolute;inset:0;overflow:hidden;background:#050814;font-family:'Segoe UI',system-ui,sans-serif;color:#e8eefc;
  --gold:#f5b800;--line:#2b3f66;--muted:#93a4c4;--cyan:#4fe3ff;--card:rgba(10,16,32,.78);user-select:none}
.cp-root canvas{position:absolute;inset:0;display:block}
.cp-ui{position:absolute;inset:0;pointer-events:none}
.cp-ui button{pointer-events:auto;font:700 15px 'Segoe UI',system-ui,sans-serif;color:#e8eefc;background:rgba(20,32,60,.85);
  border:1px solid #3b5a92;border-radius:12px;padding:11px 18px;cursor:pointer;transition:transform .1s,background .15s,border-color .15s}
.cp-ui button:hover{background:#23406e;border-color:var(--cyan);transform:translateY(-1px)}
.cp-ui button.primary{background:linear-gradient(180deg,#2f6bd0,#1d4fa0);border-color:#6aa8ff;font-size:18px;padding:13px 26px}
.cp-ui button:disabled{opacity:.45;cursor:default;transform:none}
.cp-screen{position:absolute;inset:0;display:none;pointer-events:none}
.cp-screen.on{display:block}
.cp-panel{position:absolute;left:6%;top:50%;transform:translateY(-50%);width:min(440px,44vw);pointer-events:auto}
.cp-logo{font-size:15px;letter-spacing:.3em;text-transform:uppercase;color:var(--cyan);font-weight:800}
.cp-logo b{display:block;font-size:clamp(38px,5.4vw,64px);letter-spacing:.02em;color:#fff;line-height:1.02;text-transform:none;
  text-shadow:0 0 24px rgba(79,227,255,.45)}
.cp-tag{color:var(--muted);font-size:15px;line-height:1.5;margin:14px 0 22px}
.cp-btns{display:flex;flex-wrap:wrap;gap:10px}
.cp-stats{margin-top:22px;display:flex;gap:18px;color:var(--muted);font-size:13px}
.cp-stats b{display:block;color:#fff;font-size:20px}
.cp-stats .tok b{color:var(--gold)}
.cp-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px 24px;backdrop-filter:blur(8px);
  max-height:88vh;overflow:auto;box-sizing:border-box}
.cp-card h2{margin:0 0 6px;font-size:26px}
.cp-card .sub{color:var(--muted);font-size:14px;margin-bottom:14px}
.cp-lockers{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 18px}
.cp-fit{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:rgba(20,32,60,.5);cursor:pointer;pointer-events:auto}
.cp-fit:hover{border-color:var(--cyan)}
.cp-fit.on{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
.cp-fit .n{font-weight:700}
.cp-fit .s{font-size:12px;color:var(--muted);margin-top:3px}
.cp-fit.locked .n{color:#8b98b5}
.cp-howto{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin:6px 0 16px}
.cp-howto kbd{background:#1b2a4a;border:1px solid #3b5a92;border-radius:6px;padding:1px 7px;font:600 12px ui-monospace,monospace}
.cp-howto .h{grid-column:1/-1;color:var(--cyan);font-weight:800;font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin-top:8px}
.cp-howto .d{color:var(--muted)}
.cp-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,90vw);text-align:center;pointer-events:auto}
.cp-results{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:16px 0 20px}
.cp-results div{background:rgba(20,32,60,.6);border-radius:10px;padding:10px}
.cp-results b{display:block;font-size:22px}
.cp-results .big{grid-column:1/-1}
.cp-results .big b{font-size:40px;color:var(--gold)}
.cp-hud{position:absolute;inset:0;display:none}
.cp-hud.on{display:block}
.cp-score{position:absolute;left:18px;top:14px;font-weight:800;font-size:30px;text-shadow:0 2px 8px #000}
.cp-score small{display:block;font-size:13px;color:var(--cyan);letter-spacing:.08em}
.cp-right{position:absolute;right:18px;top:14px;text-align:right;text-shadow:0 2px 8px #000}
.cp-hearts{font-size:26px;letter-spacing:4px}
.cp-tok{color:var(--gold);font-weight:700;font-size:15px;margin-top:2px}
.cp-boss{position:absolute;left:50%;top:16px;transform:translateX(-50%);width:min(520px,60vw);display:none;text-align:center}
.cp-boss.on{display:block}
.cp-boss .nm{font-weight:800;font-size:14px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;text-shadow:0 2px 6px #000}
.cp-boss .bar{height:12px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;border:1px solid rgba(255,255,255,.2)}
.cp-boss .fill{height:100%;background:linear-gradient(90deg,#ff3355,#ff9a3c);transition:width .12s}
.cp-pups{position:absolute;left:18px;bottom:16px;display:flex;gap:8px}
.cp-pup{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:13px;font-weight:700}
.cp-keys{position:absolute;right:18px;bottom:16px;color:var(--muted);font-size:12px;text-align:right;line-height:1.7}
.cp-keys kbd{background:#1b2a4a;border:1px solid #3b5a92;border-radius:5px;padding:0 6px;font:600 11px ui-monospace,monospace;color:#cfe0ff}
.cp-banner{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%) scale(.9);font-weight:900;font-size:clamp(26px,4vw,46px);
  text-align:center;opacity:0;transition:opacity .25s,transform .25s;text-shadow:0 0 22px rgba(0,0,0,.8);white-space:nowrap}
.cp-banner.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
.cp-banner small{display:block;font-size:.42em;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase}
.cp-toast{position:absolute;left:50%;top:70px;transform:translateX(-50%);background:var(--card);border:1px solid var(--gold);
  border-radius:12px;padding:9px 16px;font-weight:700;opacity:0;transition:opacity .3s}
.cp-toast.on{opacity:1}
.cp-bubble{position:absolute;transform:translate(-50%,-100%);background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:7px 13px;font-size:14px;font-weight:600;white-space:nowrap;opacity:0;transition:opacity .25s}
.cp-bubble.on{opacity:1}
.cp-pop{position:absolute;transform:translate(-50%,-50%);font-weight:900;font-size:18px;text-shadow:0 2px 6px #000;white-space:nowrap}
.cp-flash{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 40%,rgba(255,40,70,.55));opacity:0;transition:opacity .35s}
.cp-flash.on{opacity:1;transition:none}
.cp-mute{position:absolute;right:18px;top:78px;pointer-events:auto;font-size:13px !important;padding:6px 10px !important}
`;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------
export function mount(target, opts = {}) {
  const container = typeof target === 'string' ? document.querySelector(target) : target;
  const params = new URLSearchParams(location.search);
  const onEvent = opts.onEvent || (() => {});
  const onComplete = opts.onComplete || (() => {});
  let profile = mergeProfiles(loadProfile(), opts.profile);
  const save = () => {
    profile.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* private mode */ }
  };
  save();
  wallet().init && wallet().init();

  // ---- DOM ----
  if (!document.getElementById('cp-style')) {
    const st = document.createElement('style'); st.id = 'cp-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const root = el('<div class="cp-root"></div>');
  container.innerHTML = '';
  container.appendChild(root);
  const ui = el('<div class="cp-ui"></div>');

  const scrTitle = el(`<div class="cp-screen"><div class="cp-panel">
    <div class="cp-logo">CostBot<b>Cloud Patrol</b></div>
    <div class="cp-tag">Fly the cloud. Shoot down the waste, grab the coins, and shrink every megabill vendor's bill
      before it shrinks your budget.</div>
    <div class="cp-btns"><button class="primary" data-a="play">▶ Play</button><button data-a="locker">👕 Locker</button>
      <button data-a="howto">❓ How to play</button></div>
    <div class="cp-stats"><div>Best score<b data-v="best">0</b></div><div>Bosses beaten<b data-v="bosses">0</b></div>
      <div class="tok">Tokens on hand<b data-v="tokens">0</b></div></div>
  </div></div>`);
  const scrLocker = el(`<div class="cp-screen"><div class="cp-panel"><div class="cp-card">
    <h2>👕 Locker</h2><div class="sub">Hover to try one on. Outfits cost arcade tokens — and a couple are secret.</div>
    <div class="cp-lockers"></div>
    <div class="cp-btns"><button data-a="back">← Back</button></div>
    <div class="cp-stats"><div class="tok">Tokens on hand<b data-v="tokens">0</b></div></div>
  </div></div></div>`);
  const enemyRows = Object.values(ENEMIES).map((e) => `<span>${e.name}</span><span class="d">${e.blurb}</span>`).join('');
  const pupRows = Object.values(POWERUPS).map((p) => `<span>${p.icon} ${p.name}</span><span class="d">${p.blurb}</span>`).join('');
  const scrHow = el(`<div class="cp-screen"><div class="cp-panel" style="width:min(560px,56vw)"><div class="cp-card">
    <h2>❓ How to play</h2>
    <div class="cp-howto">
      <div class="h">Controls</div>
      <span><kbd>WASD</kbd> / <kbd>←↑↓→</kbd></span><span class="d">Fly</span>
      <span><kbd>Space</kbd> / hold mouse</span><span class="d">Savings laser</span>
      <span><kbd>Shift</kbd></span><span class="d">Dash — a burst of speed you can't be hit during</span>
      <span><kbd>Esc</kbd></span><span class="d">Pause</span>
      <span><kbd>M</kbd></span><span class="d">Mute</span>
      <div class="h">Waste</div>${enemyRows}
      <div class="h">Power-ups</div>${pupRows}
      <div class="h">Bosses</div>
      <span>Vendor bills</span><span class="d">Every ${B.bossEvery}s a megabill vendor flies in. Its bill is its health bar — every hit shrinks it. Dodge the spend spikes.</span>
      <div class="h">Combo</div>
      <span>×${B.comboMaxMult} max</span><span class="d">Every ${B.comboStep} coins or kills in a row adds ×0.5. Getting hit resets it.</span>
      <div class="h">Psst</div>
      <span>🤫</span><span class="d">There are secrets. Some of them are very old.</span>
    </div>
    <div class="cp-btns"><button data-a="back">← Back</button></div>
  </div></div></div>`);
  const scrPause = el(`<div class="cp-screen"><div class="cp-center cp-card"><h2>Paused</h2>
    <div class="sub">The cloud will wait. It always bills by the hour anyway.</div>
    <div class="cp-btns" style="justify-content:center"><button class="primary" data-a="resume">▶ Resume</button><button data-a="quit">Quit run</button></div>
  </div></div>`);
  const scrOver = el(`<div class="cp-screen"><div class="cp-center cp-card">
    <h2 data-v="overTitle">Run over</h2><div class="sub" data-v="overSub"></div>
    <div class="cp-results">
      <div class="big">Score<b data-v="rScore">0</b></div>
      <div>Coins<b data-v="rCoins">0</b></div><div>Waste cleared<b data-v="rKills">0</b></div><div>Bosses<b data-v="rBosses">0</b></div>
      <div>Best combo<b data-v="rCombo">0</b></div><div>Time<b data-v="rTime">0</b></div><div>Tokens<b data-v="rTokens" style="color:var(--gold)">0</b></div>
    </div>
    <div class="cp-btns" style="justify-content:center"><button class="primary" data-a="play">↻ Fly again</button><button data-a="menu">Menu</button></div>
  </div></div>`);
  const hud = el(`<div class="cp-hud">
    <div class="cp-score"><span data-v="score">0</span><small data-v="mult">×1</small></div>
    <div class="cp-right"><div class="cp-hearts" data-v="hearts"></div><div class="cp-tok" data-v="runTok">+0 tokens</div></div>
    <div class="cp-boss"><div class="nm" data-v="bossName"></div><div class="bar"><div class="fill" data-v="bossFill"></div></div></div>
    <div class="cp-pups" data-v="pups"></div>
    <div class="cp-keys"><kbd>WASD</kbd> fly · <kbd>Space</kbd> laser · <kbd>Shift</kbd> dash · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute</div>
  </div>`);
  const flash = el('<div class="cp-flash"></div>');
  const banner = el('<div class="cp-banner"></div>');
  const toast = el('<div class="cp-toast"></div>');
  const bubble = el('<div class="cp-bubble"></div>');
  const muteBtn = el('<button class="cp-mute" title="Mute (M)">🔊</button>');
  const pops = el('<div></div>');
  [flash, pops, hud, scrTitle, scrLocker, scrHow, scrPause, scrOver, banner, toast, bubble, muteBtn].forEach((n) => ui.appendChild(n));
  const V = (name) => ui.querySelectorAll(`[data-v="${name}"]`);
  const setV = (name, txt) => V(name).forEach((n) => { if (n.textContent !== String(txt)) n.textContent = txt; });

  // ---- renderer + scene ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  root.appendChild(renderer.domElement);
  root.appendChild(ui);

  const scene = new THREE.Scene();
  const SKY = 0x060a1a;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.FogExp2(SKY, 0.012);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x223355, 0.55));
  // kept under 1.0 on white plastic so only the true glows (eyes, lasers, spikes) cross the bloom threshold
  const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(4, 8, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x4fb3ff, 1.1); rim.position.set(-5, 3, -6); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
  const camPos = new THREE.Vector3(0, 1.9, 7), camLook = new THREE.Vector3(0, 1.5, 0);
  camera.position.copy(camPos);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.45, 1.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // ---- the flythrough: star streaks, drifting clouds, a couple of nebulae ----
  const STARS = 1400;
  const starPos = new Float32Array(STARS * 6);
  const starSeed = (i, z) => {
    let x, y;
    do { x = rand(-70, 70); y = rand(-35, 45); } while (Math.abs(x) < 9 && y > -3 && y < 10);
    starPos.set([x, y, z, x, y, z - 0.5], i * 6);
  };
  for (let i = 0; i < STARS; i++) starSeed(i, rand(-220, 10));
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.3, 1.5, 1.9), transparent: true, opacity: 0.85, fog: false, toneMapped: false });
  const stars = new THREE.LineSegments(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  const clouds = [];
  const cTex = [cloudTex(), cloudTex(), cloudTex()];
  for (let i = 0; i < 22; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pick(cTex), transparent: true, opacity: rand(0.18, 0.4), depthWrite: false, color: 0xbcd4ff }));
    const side = i % 2 ? 1 : -1;
    s.position.set(side * rand(12, 40), rand(-12, 16), rand(-200, 10));
    s.scale.set(rand(18, 34), rand(8, 14), 1);
    scene.add(s); clouds.push(s);
  }
  for (const [x, y, c, sc] of [[-60, 25, 0x5b3fbf, 110], [70, -5, 0x1e6fd0, 130], [5, 45, 0x2aa3a0, 90]]) {
    const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: c, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
    n.position.set(x, y, -260); n.scale.setScalar(sc); scene.add(n);
  }

  // ---- CostBot ----
  const bot = createCostBot({ style: 'glossy', shadows: false });
  bot.root.scale.setScalar(BOT_SCALE);
  scene.add(bot.root);
  bot.setOutfit(params.get('outfit') || profile.outfit);
  const shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.3, 2.2), transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
  shieldBubble.visible = false;
  scene.add(shieldBubble);

  const F = buildFactories();
  const sparks = makeSparks(F.dot);
  scene.add(sparks.points);

  // ---- audio ----
  const audio = makeAudio();
  audio.setMuted(!!profile.muted);
  muteBtn.textContent = profile.muted ? '🔇' : '🔊';
  const music = window.ArcadeMusic ? window.ArcadeMusic.create(() => audio.nodes()) : null;
  if (music) { music.setTheme('synthwave'); music.setVolume(MUSIC_VOL); }
  const musicSlot = (slot) => { if (music) music.setState(slot); };
  function toggleMute() {
    profile.muted = !profile.muted; save();
    audio.setMuted(profile.muted);
    muteBtn.textContent = profile.muted ? '🔇' : '🔊';
  }
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });

  // ---- state ----
  let screen = 'title';
  let run = null;
  let t = 0;
  let idleFor = 0, nextAntic = 7;
  let bubbleT = 0, toastT = 0, bannerT = 0;
  const keys = new Set();
  let mouseFire = false;
  const secretBuf = [];
  let rainT = 0;

  function show(name) {
    screen = name;
    for (const [n, node] of [['title', scrTitle], ['locker', scrLocker], ['howto', scrHow], ['paused', scrPause], ['over', scrOver]]) {
      node.classList.toggle('on', n === name);
    }
    hud.classList.toggle('on', name === 'play' || name === 'paused');
    if (name === 'title' || name === 'locker' || name === 'howto') {
      setV('best', fmt(profile.best)); setV('bosses', fmt(profile.bosses)); setV('tokens', fmt(wallet().tokens));
      musicSlot('menu');
    }
    if (name === 'locker') renderLocker();
  }

  function say(text, secs = 2.2) { bubble.textContent = text; bubble.classList.add('on'); bubbleT = secs; }
  function toastMsg(text, secs = 3) { toast.textContent = text; toast.classList.add('on'); toastT = secs; }
  function bannerMsg(html, secs = 2.2) { banner.innerHTML = html; banner.classList.add('on'); bannerT = secs; }

  const popList = [];
  function pop(worldPos, text, color = '#fff') {
    const n = el(`<div class="cp-pop" style="color:${color}">${text}</div>`);
    pops.appendChild(n);
    popList.push({ n, p: worldPos.clone(), life: 0.9 });
  }

  // ---- locker ----
  function renderLocker() {
    const grid = scrLocker.querySelector('.cp-lockers');
    grid.innerHTML = '';
    for (const o of OUTFITS) {
      const owned = profile.unlocked.includes(o.id);
      const price = o.unlock.tokens || 0;
      const status = owned ? (profile.outfit === o.id ? '✓ Equipped' : 'Click to equip')
        : o.unlock.secret ? '🔒 Secret' : `🔒 ${fmt(price)} tokens — click to buy`;
      const card = el(`<div class="cp-fit ${owned ? '' : 'locked'} ${profile.outfit === o.id ? 'on' : ''}">
        <div class="n">${o.label}</div><div class="s">${status}</div></div>`);
      card.addEventListener('mouseenter', () => { bot.setOutfit(o.id); audio.beep(); });
      card.addEventListener('mouseleave', () => bot.setOutfit(profile.outfit));
      card.addEventListener('click', () => {
        if (!owned) {
          if (o.unlock.secret) { toastMsg('That one is a secret. 🤫'); return; }
          if (!wallet().spend(price)) { toastMsg(`Not enough tokens — ${fmt(price)} needed.`); audio.hurt(); return; }
          profile.unlocked.push(o.id);
          audio.fanfare();
          onEvent('unlock', { outfit: o.id, price });
        } else audio.click();
        profile.outfit = o.id; save();
        bot.setOutfit(o.id);
        bot.cheer();
        setV('tokens', fmt(wallet().tokens));
        renderLocker();
      });
      grid.appendChild(card);
    }
  }

  // ---- secrets ----
  function secretKey(k) {
    secretBuf.push(k.length === 1 ? k.toLowerCase() : k);
    if (secretBuf.length > 12) secretBuf.shift();
    for (const [id, s] of Object.entries(SECRETS)) {
      const tail = secretBuf.slice(-s.seq.length);
      if (tail.length === s.seq.length && tail.every((v, i) => v === s.seq[i])) {
        secretBuf.length = 0;
        triggerSecret(id, s);
      }
    }
  }
  function triggerSecret(id, s) {
    audio.fanfare();
    toastMsg(s.toast, 3.5);
    if (!profile.secrets.includes(id)) profile.secrets.push(id);
    if (s.outfit) {
      if (!profile.unlocked.includes(s.outfit)) profile.unlocked.push(s.outfit);
      profile.outfit = s.outfit;
      bot.setOutfit(s.outfit);
      bot.cheer();
      if (screen === 'locker') renderLocker();
    }
    if (id === 'finops' && screen === 'play') rainT = 5;
    save();
    onEvent('secret', { id });
  }

  // ---- input ----
  const MOVE = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, a: 1, d: 1, w: 1, s: 1, ' ': 1 };
  function onKeyDown(e) {
    audio.resume();
    idleFor = 0;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (MOVE[k] && screen === 'play') e.preventDefault();
    if (!e.repeat) secretKey(e.key);
    keys.add(k);
    if (k === 'm') toggleMute();
    if (screen === 'play') {
      if (k === 'Escape') pause();
      if (k === 'Shift') dash();
    } else if (screen === 'paused') {
      if (k === 'Escape') resume();
    } else if (screen === 'title') {
      if (k === 'Enter') startRun();
    } else if (screen === 'over') {
      if (k === 'Enter') startRun();
    } else if (k === 'Escape') show('title');
  }
  function onKeyUp(e) { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); }
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  renderer.domElement.addEventListener('pointerdown', () => { audio.resume(); idleFor = 0; if (screen === 'play') mouseFire = true; });
  addEventListener('pointerup', () => { mouseFire = false; });
  addEventListener('pointermove', () => { idleFor = 0; });
  addEventListener('blur', () => { keys.clear(); mouseFire = false; if (screen === 'play') pause(); });

  ui.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    audio.resume(); audio.click();
    const a = b.dataset.a;
    if (a === 'play') startRun();
    else if (a === 'locker') show('locker');
    else if (a === 'howto') show('howto');
    else if (a === 'back' || a === 'menu') { bot.setOutfit(profile.outfit); show('title'); }
    else if (a === 'resume') resume();
    else if (a === 'quit') endRun('quit');
  });
  ui.addEventListener('mouseover', (e) => { if (e.target.closest && e.target.closest('button') && !e.target.closest('button').contains(e.relatedTarget)) audio.beep(); });

  // ---- run ----
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const godMode = params.get('god') === '1';     // test hook: nothing can hurt him
  const pickedVendor = VENDORS.findIndex((v) => v.name === params.get('vendor'));
  function newRun() {
    return {
      time: 0, speed: B.startSpeed, score: 0, coins: 0, kills: 0, bosses: 0, combo: 0, bestCombo: 0,
      lives: B.lives, invuln: 0, px: 0, py: 2.4, vx: 0, vy: 0,
      fireCd: 0, dashCd: 0, dashT: 0, spawnT: 1.2, coinT: 0.4, pupT: B.powerupEvery * 0.6,
      bossT: params.get('boss') ? 2 : B.bossEvery, boss: null, bossIndex: pickedVendor >= 0 ? pickedVendor : Math.floor(Math.random() * VENDORS.length),
      pups: { shield: 0, magnet: 0, spot: 0 },
      things: [], lasers: [], spikes: [], shake: 0, bonusTokens: 0,
    };
  }
  function clearRun() {
    if (!run) return;
    for (const x of [...run.things, ...run.lasers, ...run.spikes]) scene.remove(x.mesh);
    if (run.boss) scene.remove(run.boss.mesh);
    run = null;
  }
  function startRun() {
    clearRun();
    audio.resume();
    run = newRun();
    bot.setOutfit(profile.outfit);
    show('play');
    musicSlot('stage');
    if (music) music.setVolume(MUSIC_VOL);
    say(pick(QUIPS.start));
    onEvent('run:start', { outfit: profile.outfit });
  }
  function pause() { if (screen !== 'play') return; show('paused'); if (music) music.setVolume(MUSIC_VOL * 0.4); }
  function resume() { if (screen !== 'paused') return; show('play'); if (music) music.setVolume(MUSIC_VOL); }

  const mult = () => Math.min(B.comboMaxMult, 1 + Math.floor(run.combo / B.comboStep) * 0.5);
  function addScore(n, at, color) {
    const m = mult();
    run.score += n * m;
    if (at) pop(at, `+${fmt(n * m)}`, color);
  }
  function bumpCombo() {
    run.combo += 1;
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    if (run.combo % B.comboStep === 0 && mult() <= B.comboMaxMult) pop(playerCenter(tmp2), `COMBO ×${mult()}`, '#4fe3ff');
  }
  const playerCenter = (out) => out.set(run.px, run.py + HIT_Y, 0);

  function tokensFor(r) {
    return Math.floor(r.coins * B.tokensPerCoin + r.bonusTokens + r.score / B.scorePerToken);
  }

  function endRun(outcome) {
    if (!run) return;
    const r = run;
    const tokens = tokensFor(r);
    if (tokens > 0) wallet().earn(tokens, GAME_ID);
    const newBest = r.score > profile.best;
    profile.best = Math.max(profile.best, Math.round(r.score));
    profile.bestCombo = Math.max(profile.bestCombo, r.bestCombo);
    profile.runs += 1;
    profile.bosses += r.bosses;
    save();
    const result = {
      game: GAME_ID, version: VERSION, outcome, stageId: 'endless', seed: 0, dollarsSaved: 0,
      tokensEarned: tokens, score: Math.round(r.score), combo: r.bestCombo, kills: r.kills, level: r.bosses,
      coins: r.coins, quizCorrect: 0, quizWrong: 0, durationMs: Math.round(r.time * 1000), profile: { ...profile },
    };
    setV('overTitle', outcome === 'quit' ? 'Run ended' : newBest ? '🏆 New best!' : 'Grounded!');
    setV('overSub', outcome === 'quit' ? 'Tokens earned so far still count.' : `${pick(['The waste won this round.', 'Even heroes get invoiced.', 'Budget exceeded.'])}`);
    setV('rScore', fmt(r.score)); setV('rCoins', fmt(r.coins)); setV('rKills', fmt(r.kills)); setV('rBosses', fmt(r.bosses));
    setV('rCombo', fmt(r.bestCombo)); setV('rTime', `${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}`);
    setV('rTokens', `+${fmt(tokens)}`);
    clearRun();
    show('over');
    musicSlot('menu');
    if (music) music.setVolume(MUSIC_VOL * 0.7);
    if (outcome !== 'quit') audio.gameOver();
    ui.querySelector('.cp-boss').classList.remove('on');
    onEvent('run:end', result);
    onComplete(result);
  }

  // ---- spawning ----
  function spawnThing(kind, x, y, z = SPAWN_Z) {
    let mesh, hp = 1, r = 0.9;
    if (kind === 'coin') { mesh = F.coin(); r = 0.8; }
    else if (kind in ENEMIES) { mesh = F[kind](); hp = ENEMIES[kind].hp; r = ENEMIES[kind].radius; }
    else { mesh = F.powerup(kind); r = 0.95; }
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const th = { kind, mesh, hp, r, baseX: x, baseY: y, phase: rand(0, 6.28), vz: 0, vx: 0, vy: 0 };
    run.things.push(th);
    return th;
  }
  function spawnCoinRow() {
    const n = 5 + Math.floor(Math.random() * 4);
    const x0 = rand(-FIELD.x + 1, FIELD.x - 1), y0 = rand(1.2, 6);
    const shape = pick(['line', 'arc', 'wave']);
    for (let i = 0; i < n; i++) {
      const x = shape === 'line' ? x0 : clamp(x0 + Math.sin(i * 0.7) * 2.2, -FIELD.x, FIELD.x);
      const y = shape === 'arc' ? clamp(y0 + Math.sin(i / (n - 1) * Math.PI) * 1.6, 1, 6.8) : y0;
      spawnThing('coin', x, y, SPAWN_Z - i * 3.2);
    }
  }
  function spawnWaste() {
    const lvl = run.time / 60;
    const roll = Math.random();
    const kind = roll < 0.45 - lvl * 0.08 ? 'ebs' : roll < 0.8 - lvl * 0.05 ? 'ghost' : 'nat';
    spawnThing(kind, rand(-FIELD.x, FIELD.x), rand(1, 6.8));
  }
  function spawnBoss() {
    const v = VENDORS[run.bossIndex % VENDORS.length];
    run.bossIndex += 1;
    const level = run.bosses;
    const mesh = F.boss(v);
    mesh.position.set(0, 3.5, -180);
    scene.add(mesh);
    const max = B.bossHp + B.bossHpStep * level;
    run.boss = { v, mesh, hp: max, max, t: 0, fireT: 2.2, level, hitFlash: 0 };
    ui.querySelector('.cp-boss').classList.add('on');
    setV('bossName', `⚠️ ${v.name} — the bill`);
    bannerMsg(`⚠️ INCOMING BILL<small>${v.name}</small>`, 2.4);
    audio.alarm();
    musicSlot('boss');
  }
  function killBoss() {
    const b = run.boss;
    sparks.burst(b.mesh.position, b.v.color, 120, 16);
    sparks.burst(b.mesh.position, '#ffd23a', 80, 12);
    for (let i = 0; i < 14; i++) {
      const c = spawnThing('coin', b.mesh.position.x + rand(-2, 2), b.mesh.position.y + rand(-1.5, 1.5), b.mesh.position.z + rand(-3, 3));
      c.vx = rand(-3, 3); c.vy = rand(-1, 1);
    }
    addScore(1000 * (b.level + 1), b.mesh.position, '#ffd23a');
    run.bosses += 1;
    run.bonusTokens += B.bossTokens;
    bannerMsg(`💥 ${b.v.name}<small>${pick(BOSS_LINES)}</small>`, 2.6);
    audio.boom();
    bot.cheer();
    say('Bill: shrunk. ✅');
    scene.remove(b.mesh);
    run.boss = null;
    run.bossT = B.bossEvery;
    ui.querySelector('.cp-boss').classList.remove('on');
    musicSlot('stage');
  }

  function fire() {
    const r = run;
    const gravi = bot.outfit === 'graviton', mega = bot.outfit === 'mega';
    r.fireCd = B.fireEvery * (gravi ? 0.72 : 1);
    bot.armUp.fist.getWorldPosition(tmp);
    const origins = mega ? [-0.35, 0.35] : [0];
    const spreads = r.pups.spot > 0 ? [-6, 0, 6] : [0];
    for (const ox of origins) {
      for (const sx of spreads) {
        const m = F.laser();
        m.position.set(tmp.x + ox, tmp.y, tmp.z - 2.2);   // start ahead of him so the bolts don't bloom over the bot
        scene.add(m);
        r.lasers.push({ mesh: m, vx: sx, life: 1.4 });
      }
    }
    audio.laser();
  }
  function dash() {
    if (!run || run.dashCd > 0) return;
    run.dashT = B.dashTime; run.dashCd = B.dashCooldown;
    audio.whoosh();
  }
  function hurt() {
    const r = run;
    if (r.invuln > 0 || r.dashT > 0 || godMode) return;
    if (r.pups.shield > 0) {
      r.pups.shield = 0; r.invuln = 0.8;
      audio.shieldBreak();
      sparks.burst(playerCenter(tmp), '#4fb3ff', 50, 10);
      toastMsg('🛡️ Savings Plan absorbed it', 1.6);
      return;
    }
    r.lives -= 1; r.invuln = B.invulnTime; r.combo = 0; r.shake = 0.5;
    audio.hurt();
    flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 60);
    sparks.burst(playerCenter(tmp), '#ff4466', 40, 9);
    if (r.lives <= 0) { endRun('death'); return; }
    say(pick(QUIPS.hurt), 1.6);
  }
  function grab(th) {
    const r = run;
    if (th.kind === 'coin') {
      r.coins += 1; bumpCombo(); addScore(B.coinPoints);
      sparks.burst(th.mesh.position, '#ffd23a', 10, 4);
      audio.coin();
    } else {
      const def = POWERUPS[th.kind];
      r.pups[th.kind] = def.seconds;
      sparks.burst(th.mesh.position, def.color, 40, 8);
      toastMsg(`${def.icon} ${def.name}!`, 1.6);
      audio.power();
    }
  }

  // ---- per-frame run update ----
  function updateRun(dt) {
    const r = run;
    r.time += dt;
    r.speed = Math.min(B.maxSpeed, B.startSpeed + B.speedRamp * r.time) * (r.dashT > 0 ? 1.8 : 1);
    const gravi = bot.outfit === 'graviton';
    const ix = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    const iy = (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('s') ? 1 : 0);
    if (ix || iy) idleFor = 0;
    const agility = (gravi ? 1.2 : 1) * (r.dashT > 0 ? 1.5 : 1);
    r.vx = lerp(r.vx, ix * 10 * agility, 0.18);
    r.vy = lerp(r.vy, iy * 7.5 * agility, 0.18);
    r.px = clamp(r.px + r.vx * dt, -FIELD.x, FIELD.x);
    r.py = clamp(r.py + r.vy * dt, FIELD.yMin, FIELD.yMax);
    r.invuln = Math.max(0, r.invuln - dt);
    r.dashT = Math.max(0, r.dashT - dt);
    r.dashCd = Math.max(0, r.dashCd - dt);
    r.fireCd = Math.max(0, r.fireCd - dt);
    for (const k of Object.keys(r.pups)) r.pups[k] = Math.max(0, r.pups[k] - dt);
    if ((keys.has(' ') || mouseFire) && r.fireCd <= 0) fire();

    // spawns
    const bossUp = !!r.boss;
    r.spawnT -= dt * (bossUp ? 0.35 : 1);
    if (r.spawnT <= 0) { spawnWaste(); r.spawnT = Math.max(B.spawnFloor, B.spawnEvery - r.time * 0.004) * rand(0.7, 1.3); }
    r.coinT -= dt;
    if (r.coinT <= 0) { spawnCoinRow(); r.coinT = B.coinEvery * rand(3, 6); }
    r.pupT -= dt;
    if (r.pupT <= 0) { spawnThing(pick(Object.keys(POWERUPS)), rand(-FIELD.x + 1, FIELD.x - 1), rand(1.5, 6)); r.pupT = B.powerupEvery * rand(0.8, 1.3); }
    if (!bossUp) { r.bossT -= dt; if (r.bossT <= 0) spawnBoss(); }
    if (rainT > 0) {
      rainT -= dt;
      if (Math.random() < dt * 14) spawnThing('coin', clamp(r.px + rand(-3, 3), -FIELD.x, FIELD.x), clamp(r.py + HIT_Y + rand(-2, 2), 1, 6.8), -60);
    }

    const pc = playerCenter(tmp);
    // things
    for (let i = r.things.length - 1; i >= 0; i--) {
      const th = r.things[i];
      const m = th.mesh;
      m.position.z += (r.speed + th.vz) * dt;
      m.position.x += th.vx * dt; m.position.y += th.vy * dt;
      th.vx *= 0.97; th.vy *= 0.97;
      if (th.kind === 'coin') {
        m.rotation.y += dt * 4;
        if (r.pups.magnet > 0 && m.position.distanceTo(pc) < 11) {
          m.position.x = lerp(m.position.x, pc.x, 0.08); m.position.y = lerp(m.position.y, pc.y, 0.08);
          m.position.z = lerp(m.position.z, 0, 0.04);
        }
      } else if (th.kind === 'ebs') {
        m.rotation.x += dt * 1.2; m.rotation.z += dt * 0.7;
      } else if (th.kind === 'ghost') {
        m.position.x = th.baseX + Math.sin(t * 2 + th.phase) * 2.4;
        m.position.y = th.baseY + Math.sin(t * 3 + th.phase) * 0.35;
        m.rotation.y = Math.sin(t * 2 + th.phase) * 0.4;
      } else if (th.kind === 'nat') {
        m.rotation.x += dt * 2; m.rotation.y += dt * 2.6;
        if (m.position.z > -70 && m.position.z < -4) {
          m.position.x = lerp(m.position.x, pc.x, dt * 0.9); m.position.y = lerp(m.position.y, pc.y, dt * 0.9);
        }
      } else {
        m.rotation.y += dt;
        m.position.y = th.baseY + Math.sin(t * 2 + th.phase) * 0.3;
      }
      const dz = Math.abs(m.position.z - pc.z);
      if (dz < 1.6 && m.position.distanceTo(pc) < th.r + HIT_R) {
        if (th.kind in ENEMIES) { sparks.burst(m.position, '#ff8a5a', 26, 7); hurt(); }
        else grab(th);
        scene.remove(m); r.things.splice(i, 1);
        if (!run) return;
        continue;
      }
      if (m.position.z > 14) { scene.remove(m); r.things.splice(i, 1); }
    }

    // lasers
    for (let i = r.lasers.length - 1; i >= 0; i--) {
      const L = r.lasers[i];
      L.life -= dt;
      L.mesh.position.z -= 95 * dt;
      L.mesh.position.x += L.vx * dt;
      let hit = false;
      for (let j = r.things.length - 1; j >= 0 && !hit; j--) {
        const th = r.things[j];
        if (!(th.kind in ENEMIES)) continue;
        if (L.mesh.position.distanceTo(th.mesh.position) < th.r + 0.4) {
          hit = true;
          th.hp -= 1;
          if (th.hp <= 0) {
            const def = ENEMIES[th.kind];
            r.kills += 1; bumpCombo(); addScore(def.points, th.mesh.position, '#7ff6ff');
            sparks.burst(th.mesh.position, th.kind === 'nat' ? '#ff4455' : th.kind === 'ghost' ? '#a9c4ff' : '#c0c8d8', 40, 9);
            audio.pop();
            scene.remove(th.mesh); r.things.splice(j, 1);
          } else { sparks.burst(th.mesh.position, '#ffffff', 8, 4); audio.bossHit(); }
        }
      }
      const b = r.boss;
      if (!hit && b && L.mesh.position.distanceTo(b.mesh.position) < (BOSS_R + 0.2) * b.mesh.scale.x) {
        hit = true;
        b.hp -= 1; b.hitFlash = 0.08;
        sparks.burst(L.mesh.position, '#ffd23a', 6, 5);
        audio.bossHit();
        if (b.hp <= 0) killBoss();
      }
      if (hit || L.life <= 0) { scene.remove(L.mesh); r.lasers.splice(i, 1); }
    }

    // boss
    const b = r.boss;
    if (b) {
      b.t += dt;
      const m = b.mesh;
      const targetZ = -27;
      m.position.z = lerp(m.position.z, targetZ, dt * 0.9);
      m.position.x = Math.sin(b.t * 0.7) * 5;
      m.position.y = 3.6 + Math.sin(b.t * 1.1) * 1.8;
      m.rotation.y = Math.sin(b.t * 1.3) * 0.5;
      m.rotation.z = Math.sin(b.t * 0.8) * 0.15;
      m.scale.setScalar(0.45 + 0.55 * b.hp / b.max);
      b.hitFlash = Math.max(0, b.hitFlash - dt);
      m.userData.faceMat.color.setRGB(1, b.hitFlash > 0 ? 0.55 : 1, b.hitFlash > 0 ? 0.55 : 1);   // flash red on a hit
      m.userData.aura.rotation.z += dt * 2;
      b.fireT -= dt;
      if (b.fireT <= 0 && m.position.z > -60) {
        b.fireT = Math.max(0.45, 1.25 - b.level * 0.1) * rand(0.8, 1.2);
        const volley = 1 + Math.min(2, Math.floor(b.level / 2));
        for (let k = 0; k < volley; k++) {
          const s = F.spike();
          s.position.copy(m.position);
          scene.add(s);
          const aim = tmp2.copy(pc).add(new THREE.Vector3(rand(-1.5, 1.5) * k, rand(-1, 1) * k, 0)).sub(m.position).normalize().multiplyScalar(30 + b.level * 2.5);
          r.spikes.push({ mesh: s, v: aim.clone() });
        }
      }
      const pct = Math.max(0, b.hp / b.max * 100);
      V('bossFill').forEach((n) => { n.style.width = `${pct}%`; });
    }
    for (let i = r.spikes.length - 1; i >= 0; i--) {
      const S = r.spikes[i];
      S.mesh.position.addScaledVector(S.v, dt);
      if (S.mesh.position.distanceTo(pc) < 0.4 + HIT_R) {
        scene.remove(S.mesh); r.spikes.splice(i, 1); hurt();
        if (!run) return;
        continue;
      }
      if (S.mesh.position.z > 14) { scene.remove(S.mesh); r.spikes.splice(i, 1); }
    }

    // HUD
    setV('score', fmt(r.score));
    setV('mult', `×${mult()} · combo ${r.combo}`);
    setV('hearts', '❤️'.repeat(Math.max(0, r.lives)) + '🖤'.repeat(Math.max(0, B.lives - r.lives)));
    setV('runTok', `+${fmt(tokensFor(r))} tokens`);
    const pupHtml = Object.entries(r.pups).filter(([, s]) => s > 0)
      .map(([k, s]) => `<div class="cp-pup">${POWERUPS[k].icon} ${POWERUPS[k].name} ${Math.ceil(s)}s</div>`).join('')
      + (r.dashCd > 0 ? '' : '<div class="cp-pup">💨 Dash ready</div>');
    const pupsEl = V('pups')[0];
    if (pupsEl.innerHTML !== pupHtml) pupsEl.innerHTML = pupHtml;

    if (idleFor > 7 && !bot.busy) { bot.antic(pick(['yawn', 'tablet'])); say(pick(QUIPS.idle), 2); idleFor = 0; }
  }

  // ---- frame ----
  const clock = new THREE.Clock();
  let alive = true;
  function frame() {
    if (!alive) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    idleFor += dt;
    const playing = screen === 'play' && run;
    if (playing) updateRun(dt);
    const r = run;
    const flySpeed = r && (screen === 'play' || screen === 'paused') ? (screen === 'play' ? r.speed : 0) : 7;

    // flythrough
    const sp = starGeo.attributes.position.array;
    const len = 0.3 + flySpeed * 0.07;
    for (let i = 0; i < STARS; i++) {
      let z = sp[i * 6 + 2] + flySpeed * dt;
      if (z > 12) { starSeed(i, -220); z = -220; }
      sp[i * 6 + 2] = z; sp[i * 6 + 5] = z - len;
    }
    starGeo.attributes.position.needsUpdate = true;
    for (const c of clouds) { c.position.z += flySpeed * 0.8 * dt; if (c.position.z > 20) c.position.z -= 230; }
    sparks.update(dt, screen === 'play' ? flySpeed * 0.5 : 0);

    // CostBot + camera
    const inRun = r && (screen === 'play' || screen === 'paused');
    if (inRun) {
      bot.root.rotation.y = lerp(bot.root.rotation.y, Math.PI, 0.1);
      bot.update(t, dt, { baseY: r.py, leanX: 0.7, leanZ: r.vx * 0.035, lookX: -r.vx * 0.05, billow: 1 + r.speed / 40 });
      bot.root.position.x = r.px; bot.root.position.z = 0;
      bot.root.visible = r.invuln <= 0 || Math.floor(t * 12) % 2 === 0;
      camPos.set(r.px * 0.45, 4.8 + r.py * 0.35, 11.5);
      camLook.set(r.px * 0.55, 2.9 + r.py * 0.45, -22);
      if (r.shake > 0) { r.shake = Math.max(0, r.shake - dt); camPos.x += rand(-1, 1) * r.shake; camPos.y += rand(-1, 1) * r.shake; }
      shieldBubble.visible = r.pups.shield > 0;
      if (shieldBubble.visible) { playerCenter(shieldBubble.position); shieldBubble.scale.setScalar(1 + Math.sin(t * 6) * 0.04); }
    } else {
      // menus: face the camera, standing off to the right of the panel
      bot.root.visible = true;
      shieldBubble.visible = false;
      bot.root.rotation.y = lerp(bot.root.rotation.y, -0.35, 0.08);
      bot.update(t, dt, { baseY: 0.2 });
      bot.root.position.x = lerp(bot.root.position.x, 1.9, 0.08);
      bot.root.position.z = 0;
      camPos.set(0, 2.0, 7.2);
      camLook.set(0, 1.4, 0);
      if (idleFor > nextAntic && !bot.busy) {
        bot.antic(pick(['yawn', 'tablet', 'loop']));
        if (Math.random() < 0.6) say(pick(QUIPS.idle), 2);
        idleFor = 0; nextAntic = rand(7, 11);
      }
    }
    camera.position.lerp(camPos, inRun ? 0.12 : 0.05);
    const look = camera.userData.look || (camera.userData.look = camLook.clone());
    look.lerp(camLook, inRun ? 0.12 : 0.05);
    camera.lookAt(look);

    // overlays that track the world
    bubbleT = Math.max(0, bubbleT - dt); if (bubbleT === 0) bubble.classList.remove('on');
    toastT = Math.max(0, toastT - dt); if (toastT === 0) toast.classList.remove('on');
    bannerT = Math.max(0, bannerT - dt); if (bannerT === 0) banner.classList.remove('on');
    bot.head.localToWorld(tmp.set(0, 1.9, 0)).project(camera);
    bubble.style.left = `${(tmp.x + 1) / 2 * root.clientWidth}px`;
    bubble.style.top = `${(1 - tmp.y) / 2 * root.clientHeight}px`;
    for (let i = popList.length - 1; i >= 0; i--) {
      const p = popList[i];
      p.life -= dt; p.p.y += dt * 1.5;
      tmp.copy(p.p).project(camera);
      p.n.style.left = `${(tmp.x + 1) / 2 * root.clientWidth}px`;
      p.n.style.top = `${(1 - tmp.y) / 2 * root.clientHeight}px`;
      p.n.style.opacity = Math.min(1, p.life * 2.5);
      if (p.life <= 0) { p.n.remove(); popList.splice(i, 1); }
    }

    composer.render();
  }

  show('title');
  frame();
  onEvent('ready', { version: VERSION });
  if (params.get('play')) startRun();

  const api = {
    get profile() { return profile; },
    get state() { return { screen, run: run && { score: run.score, lives: run.lives, time: run.time, boss: run.boss && run.boss.v.name, things: run.things.length } }; },
    start: startRun,
    secret: (id) => SECRETS[id] && triggerSecret(id, SECRETS[id]),
    destroy() {
      alive = false;
      clearRun();
      if (music) music.stop();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('resize', resize);
      renderer.dispose();
      container.innerHTML = '';
    },
  };
  window.cloudPatrol = api;
  return api;
}
