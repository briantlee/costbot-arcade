/* ============================================================================
 * CostBotLand 3D — the park map as an explorable three.js diorama
 * ----------------------------------------------------------------------------
 * The painted map (assets/costbotland2.jpg) rebuilt in 3D. Everything is laid
 * out from CostBotLandContent — the same FIELD / CASTLE / TRACK / LANDS / GATE
 * numbers the 2D game plays on — so the diorama and the game agree on where
 * things are. One field unit (1000x720) is a tenth of a world unit; the park is
 * 100 x 72 world units, gate at +Z (the bottom of the map), castle dead centre.
 *
 *   import { mount } from './cl-3d.js';
 *   const park = mount('#park', { onEvent(type, payload) {} });
 *   park.focus('cache');   // 'overview' | 'castle' | any LANDS id
 *
 * Controls: drag to orbit, scroll / pinch to zoom, right-drag (or shift-drag)
 * to pan, click a land to fly there, click CostBot to make him dance.
 * Keys: 0 overview, 1-4 lands, 5 castle, T tour, F fireworks.
 * Flavor-only, like the game: no real cost figures anywhere.
 * ==========================================================================*/
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCostBot, makeCoinFactory, DANCES } from '../shared/costbot-3d.js';

const C = window.CostBotLandContent;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// field (x, y) → world (X, Z)
const WX = (x) => (x - C.FIELD.w / 2) / 10;
const WZ = (y) => (y - C.FIELD.h / 2) / 10;
const rectW = (r) => ({ x0: WX(r.x), x1: WX(r.x + r.w), z0: WZ(r.y), z1: WZ(r.y + r.h),
  cx: WX(r.x + r.w / 2), cz: WZ(r.y + r.h / 2), w: r.w / 10, d: r.h / 10 });

// deterministic scatter, so the park looks the same on every load
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- materials ----
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true, ...o });
// unlit and allowed past 1.0 so bloom picks it up — lamps, neon, windows
const glow = (color, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

// ---- canvas textures ----
function canvasTex(w, h, paint, { repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const pavingTex = (base, seed, repeat) => canvasTex(256, 256, (g, w, h) => {
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 380; i++) {
    const s = 6 + r() * 14;
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.05})`;
    g.fillRect(r() * w, r() * h, s, s * (0.6 + r() * 0.6));
  }
}, { repeat });
const gridTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#5aa8ff'; g.lineWidth = 3;
  for (let i = 0; i <= 8; i++) { const p = (i / 8) * w; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
}, { repeat: [4, 3] });
const rackTex = () => canvasTex(64, 256, (g, w, h) => {
  const r = rng(7);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let y = 10; y < h - 6; y += 14) {
    g.fillStyle = '#1a1830'; g.fillRect(6, y, w - 12, 9);
    for (let x = 10; x < w - 10; x += 9) {
      if (r() < 0.55) { g.fillStyle = ['#3cff9a', '#4fb3ff', '#b56cff', '#ffcf5a'][Math.floor(r() * 4)]; g.fillRect(x, y + 3, 4, 3); }
    }
  }
});
const shieldTex = () => canvasTex(256, 300, (g) => {
  const shield = (inset) => {
    g.beginPath(); g.moveTo(128, 8 + inset); g.lineTo(240 - inset, 44 + inset);
    g.quadraticCurveTo(236 - inset, 210, 128, 292 - inset * 1.6);
    g.quadraticCurveTo(20 + inset, 210, 16 + inset, 44 + inset); g.closePath();
  };
  shield(0); g.fillStyle = '#f4b41a'; g.fill();
  shield(18); g.fillStyle = '#2350b8'; g.fill();
  g.font = 'bold 170px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffd24a'; g.fillText('$', 128, 150);
});
const signTex = (text, bg, fg, w = 256, h = 64) => canvasTex(w, h, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
  g.font = `bold ${Math.floor(h * 0.55)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 2);
});
const labelTex = (text, color) => canvasTex(640, 128, (g, w, h) => {
  g.font = 'bold 64px "Segoe UI", system-ui, sans-serif';
  const tw = Math.min(w - 20, g.measureText(text).width + 70);
  const x = (w - tw) / 2;
  g.fillStyle = 'rgba(16,10,26,.82)'; g.strokeStyle = color; g.lineWidth = 5;
  g.beginPath(); g.roundRect(x, 14, tw, h - 28, 50); g.fill(); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = '#fff'; g.fillText(text, w / 2, h / 2 + 3);
});
const skyTex = () => canvasTex(4, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#05030f'); gr.addColorStop(0.55, '#1a0f38'); gr.addColorStop(0.8, '#3b1e5e'); gr.addColorStop(1, '#4a2660');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// a flat slab you can stand things on: rounded outline, `depth` thick, top at y=depth
const slab = (w, d, r, depth) => new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth, bevelEnabled: false }).rotateX(-Math.PI / 2);

function instanced(geo, mat, mats) {
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mx, i) => { m.setMatrixAt(i, mx); });
  m.instanceMatrix.needsUpdate = true;
  return m;
}
const TRS = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

export function mount(container, opts = {}) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  const emit = (type, payload) => { if (opts.onEvent) opts.onEvent(type, payload); };

  // ---- renderer, scene, post ----
  const renderer = new THREE.WebGLRenderer({ antialias: !TOUCH });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !TOUCH;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTex();
  scene.fog = new THREE.Fog(0x2a1848, 170, 360);
  // a dim studio reflection so the gold coins and CostBot's chrome read as metal, not brown plastic
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  scene.add(new THREE.HemisphereLight(0x9aa8ff, 0x2a1d3a, 1.1));
  const moon = new THREE.DirectionalLight(0xd4dcff, 1.5);
  moon.position.set(-40, 70, 45);
  moon.castShadow = !TOUCH;
  Object.assign(moon.shadow.camera, { left: -62, right: 62, top: 50, bottom: -50, near: 10, far: 200 });
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.bias = -0.0008;
  scene.add(moon);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 900);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.8, 0.5, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const world = new THREE.Group();
  scene.add(world);
  const add = (obj, parent = world) => { parent.add(obj); return obj; };
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = world) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return add(m, parent); };
  const animators = [];          // (t, dt) => void, run every frame
  const hitTargets = [];         // meshes a click can land on → userData.focus / userData.bot
  const labels = [];

  // ---- ground: the park slab, the woods around it, the paths ----
  const PARK = { w: C.FIELD.w / 10, d: C.FIELD.h / 10 };
  const grass = mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2),
    std(0x14261f, { map: pavingTex('#1b3326', 3, [60, 60]) }), 0, -0.3, 0);
  grass.receiveShadow = true;
  const plaza = mesh(slab(PARK.w + 4, PARK.d + 4, 3, 0.3), std(0x4a4262, { map: pavingTex('#5b5277', 11, [10, 8]) }), 0, -0.3, 0);
  plaza.receiveShadow = true;
  const pathMat = std(0x7c6f8a, { map: pavingTex('#8a7d98', 19, [2, 12]) });
  const path = (x, z, w, d) => { const m = mesh(slab(w, d, Math.min(w, d) / 2.2, 0.06), pathMat, x, 0, z); m.receiveShadow = true; };
  path(0, 20, 6, 32);                    // Main Street, gate → castle
  path(0, 0.8, PARK.w - 6, 4.2);         // the east-west promenade (Tokenland ↔ Cache Mountain)
  path(0, 19, PARK.w - 34, 3.6);         // south walk (Frontier ↔ Lagoon)
  path(0, -19, 4, 18);                   // back lawn, castle → banner gate

  // castle island: lawn + hedge collar (the track runs around it, the lands around that)
  const CAS = rectW(C.CASTLE);
  const lawn = mesh(new THREE.CylinderGeometry(1, 1, 0.12, 48).scale(15, 1, 10.5), std(0x1f5236), CAS.cx, 0.08, CAS.cz + 1);
  lawn.receiveShadow = true;
  mesh(new THREE.TorusGeometry(1, 0.045, 6, 64).rotateX(Math.PI / 2).scale(15, 12, 10.5), std(0x173f2a), CAS.cx, 0.35, CAS.cz + 1);

  // ---- the castle ----
  const castle = add(new THREE.Group());
  castle.position.set(CAS.cx, 0, CAS.cz);
  {
    const wall = std(0xe8d2a6), tower = std(0xdcc392), roof = std(0x2c4aa0, { roughness: 0.6 }), gold = std(0xf4b41a, { metalness: 0.8, roughness: 0.3 });
    const stone = std(0x5a5470);
    const g = castle;
    mesh(new THREE.BoxGeometry(21, 1.2, 13.5), stone, 0, 0.6, 0, g);
    mesh(new THREE.BoxGeometry(17, 4.5, 2.4), wall, 0, 3.45, 4.6, g);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(2.4, 4.5, 10), wall, s * 7.4, 3.45, 0, g);
    mesh(new THREE.BoxGeometry(11, 8, 7), wall, 0, 5.2, -0.5, g);
    mesh(new THREE.ConeGeometry(5, 3.6, 4, 1).rotateY(Math.PI / 4).scale(1.45, 1, 0.95), roof, 0, 11, -0.5, g);
    const spire = (x, z, r, h, cone, base = 1.2) => {
      mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 14), tower, x, base + h / 2, z, g);
      mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.35, 14), stone, x, base + h, z, g);
      mesh(new THREE.ConeGeometry(r * 1.35, cone, 14), roof, x, base + h + cone / 2, z, g);
      mesh(new THREE.SphereGeometry(r * 0.22, 10, 8), gold, x, base + h + cone + 0.1, z, g);
      return base + h + cone;
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) spire(sx * 8.4, sz * 4.8, 1.4, 7, 4);
    for (const sx of [-1, 1]) { spire(sx * 4.3, 3.2, 1.05, 10, 4.5); spire(sx * 4.6, -3.6, 1.3, 12, 5.2); spire(sx * 2.2, -4.2, 0.7, 13.5, 3.4); }
    const top = spire(0, -1, 2, 14, 8.5);
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), stone, 0, top + 1.5, -1, g);
    const flag = mesh(new THREE.PlaneGeometry(1.8, 1), new THREE.MeshStandardMaterial({ color: 0x2f6bd0, side: THREE.DoubleSide }), 0.95, top + 2.4, -1, g);
    animators.push((t) => { flag.rotation.y = Math.sin(t * 2.2) * 0.35; });
    // the gate arch and the shield over it
    const dark = new THREE.MeshStandardMaterial({ color: 0x120c1c, roughness: 1 });
    mesh(new THREE.BoxGeometry(3, 2.8, 0.2), dark, 0, 2.6, 5.85, g);
    mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2), dark, 0, 4, 5.85, g);
    const shield = mesh(new THREE.PlaneGeometry(3.3, 3.9), new THREE.MeshBasicMaterial({ map: shieldTex(), transparent: true, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) }), 0, 7.4, 3.02, g);
    shield.userData.focus = 'castle';
    hitTargets.push(shield);
    for (const s of [-1, 1]) mesh(new THREE.PlaneGeometry(1.1, 3.4), std(0x2350b8, { side: THREE.DoubleSide }), s * 3.1, 6.6, 3.02, g);
    // lit windows
    const win = [];
    for (const x of [-4.3, -1.6, 1.6, 4.3]) for (const y of [5.6, 8.2]) if (Math.abs(x) > 2 || y < 6) win.push(TRS(x, y, 3.03));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [4.5, 6.5]) win.push(TRS(sx * 8.4, y, sz * 4.8 + 1.42));
    for (const sx of [-1, 1]) for (const y of [6, 8.3, 10.2]) win.push(TRS(sx * 4.3, y, 4.27));
    for (const y of [6, 9, 12]) win.push(TRS(0, y, 1.02));
    add(instanced(new THREE.BoxGeometry(0.42, 0.7, 0.08), glow(0xffc86a, 1.8), win), g);
    const warm = new THREE.PointLight(0xffb86a, 60, 26, 1.6); warm.position.set(0, 5, 9); g.add(warm);
    const hit = mesh(new THREE.BoxGeometry(18, 20, 12), new THREE.MeshBasicMaterial({ visible: false }), 0, 10, 0, g);
    hit.userData.focus = 'castle'; hitTargets.push(hit);
  }

  // ---- the ring track + the train ----
  const TR = rectW(C.TRACK);
  const loop = (() => {
    const r = 5, s = new THREE.Shape();
    s.moveTo(TR.x0 + r, TR.z0); s.lineTo(TR.x1 - r, TR.z0); s.absarc(TR.x1 - r, TR.z0 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(TR.x1, TR.z1 - r); s.absarc(TR.x1 - r, TR.z1 - r, r, 0, Math.PI / 2, false);
    s.lineTo(TR.x0 + r, TR.z1); s.absarc(TR.x0 + r, TR.z1 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(TR.x0, TR.z0 + r); s.absarc(TR.x0 + r, TR.z0 + r, r, Math.PI, Math.PI * 1.5, false);
    return s.getSpacedPoints(480).slice(0, -1).map((p) => new THREE.Vector2(p.x, p.y));
  })();
  const offsetLoop = (off, y) => loop.map((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
    const tx = b.x - a.x, tz = b.y - a.y, len = Math.hypot(tx, tz) || 1;
    return new THREE.Vector3(p.x + (tz / len) * off, y, p.y - (tx / len) * off);   // +off = outward
  });
  const trackCurve = new THREE.CatmullRomCurve3(offsetLoop(0, 0.35), true);
  {
    const rail = std(0xa9a1b8, { metalness: 0.8, roughness: 0.35, flatShading: false });
    for (const o of [-0.6, 0.6]) add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(offsetLoop(o, 0.4), true), 480, 0.1, 5, true), rail));
    mesh(new THREE.TubeGeometry(trackCurve, 480, 1.1, 4, true).scale(1, 0.12, 1), std(0x2c2436), 0, 0.2, 0);
    const ties = [];
    const n = Math.floor(trackCurve.getLength() / 0.9);
    for (let i = 0; i < n; i++) {
      const u = i / n, p = trackCurve.getPointAt(u), tg = trackCurve.getTangentAt(u);
      ties.push(TRS(p.x, 0.28, p.z, 1, 1, 1, Math.atan2(tg.x, tg.z)));
    }
    add(instanced(new THREE.BoxGeometry(1.8, 0.14, 0.32), std(0x5b3a24), ties));
  }
  const train = [];
  {
    const body = std(0x6b3f24), trim = std(0xf4b41a, { metalness: 0.6, roughness: 0.4 }), roofM = std(0x2c2238), win = glow(0xffd07a, 1.6);
    const engine = new THREE.Group();
    mesh(new THREE.BoxGeometry(1.7, 0.4, 3.4), trim, 0, 0.65, 0, engine);
    mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.1, 12).rotateX(Math.PI / 2), std(0x2c4a3a, { metalness: 0.5, roughness: 0.4 }), 0, 1.45, 0.55, engine);
    mesh(new THREE.BoxGeometry(1.6, 1.6, 1.2), body, 0, 1.65, -1.05, engine);
    mesh(new THREE.BoxGeometry(1.8, 0.18, 1.5), roofM, 0, 2.55, -1.05, engine);
    mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.9, 10), roofM, 0, 2.35, 1.2, engine);
    mesh(new THREE.SphereGeometry(0.22, 10, 8), glow(0xfff2c0, 3), 0, 1.5, 1.72, engine);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.05, 0.5, 0.7), win, s * 0.81, 1.9, -1.05, engine);
    train.push(engine);
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group();
      mesh(new THREE.BoxGeometry(1.7, 1.5, 2.9), body, 0, 1.35, 0, car);
      mesh(new THREE.BoxGeometry(1.9, 0.2, 3.1), roofM, 0, 2.2, 0, car);
      mesh(new THREE.BoxGeometry(1.75, 0.12, 2.95), trim, 0, 0.62, 0, car);
      for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.05, 0.55, 2.2), win, s * 0.86, 1.55, 0, car);
      train.push(car);
    }
    for (const c of train) add(c);
    const L = trackCurve.getLength();
    animators.push((t) => {
      const head = (t * 0.035) % 1;
      train.forEach((c, i) => {
        const u = (head - (i * 3.4) / L + 1) % 1, p = trackCurve.getPointAt(u), tg = trackCurve.getTangentAt(u);
        c.position.set(p.x, 0.1, p.z);
        c.rotation.y = Math.atan2(tg.x, tg.z);
      });
    });
  }

  // ---- lamps + string lights ----
  const lampPos = [];
  {
    const lampCurve = new THREE.CatmullRomCurve3(offsetLoop(2.4, 0), true);
    for (let i = 0; i < 30; i++) { const p = lampCurve.getPointAt(i / 30); lampPos.push([p.x, p.z]); }
    for (let z = 8; z <= 30; z += 5.5) for (const s of [-1, 1]) lampPos.push([s * 4, z]);
    for (let x = 24; x <= 46; x += 6) for (const s of [-1, 1]) lampPos.push([s * x, -1.8]);
    add(instanced(new THREE.CylinderGeometry(0.09, 0.14, 3.2, 6), std(0x1b1626, { metalness: 0.6 }), lampPos.map(([x, z]) => TRS(x, 1.6, z))));
    add(instanced(new THREE.SphereGeometry(0.28, 10, 8), glow(0xffcf7a, 2.6), lampPos.map(([x, z]) => TRS(x, 3.35, z))));
    // festoon bulbs slung between the ring lamps
    const bulbs = [];
    const ring = lampPos.slice(0, 30);
    ring.forEach(([ax, az], i) => {
      const [bx, bz] = ring[(i + 1) % ring.length];
      for (let k = 1; k < 7; k++) { const f = k / 7; bulbs.push(lerp(ax, bx, f), 3.2 - Math.sin(f * Math.PI) * 0.7, lerp(az, bz, f)); }
    });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    add(new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(2.4, 2, 1.1), size: 0.32, toneMapped: false })));
  }

  // ---- trees: a woods ring outside the fence, scattered ones inside ----
  const LANDR = Object.fromEntries(C.LANDS.map((l) => [l.id, rectW(l.rect)]));
  {
    const r = rng(42), inside = [], outside = [];
    const inRect = (x, z, q, pad) => x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad;
    const nearTrack = (x, z) => {
      const dx = Math.max(TR.x0 - x, 0, x - TR.x1), dz = Math.max(TR.z0 - z, 0, z - TR.z1);
      const outside = Math.hypot(dx, dz), inner = Math.min(x - TR.x0, TR.x1 - x, z - TR.z0, TR.z1 - z);
      return dx || dz ? outside < 3.4 : inner < 3.4;
    };
    const blocked = (x, z) => Object.values(LANDR).some((q) => inRect(x, z, q, 1)) || nearTrack(x, z)
      || Math.abs(x) < 4.5 || Math.abs(z - 0.8) < 3.6 || (Math.abs(z - 19) < 3 && Math.abs(x) < 34)
      || Math.hypot((x - CAS.cx) / 12, (z - CAS.cz) / 8.5) < 1 || z > 27 || Math.hypot(x - 9, z - 20) < 6.5;
    for (let tries = 0; inside.length < 70 && tries < 4000; tries++) {
      const x = (r() - 0.5) * (PARK.w - 4), z = (r() - 0.5) * (PARK.d - 4);
      if (!blocked(x, z)) inside.push([x, z, 0.8 + r() * 0.7]);
    }
    for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; inside.push([CAS.cx + Math.cos(a) * 13.3, CAS.cz + 1 + Math.sin(a) * 9.2, 0.55 + r() * 0.2]); }
    for (let i = 0; i < 420; i++) {
      const x = (r() - 0.5) * 260, z = (r() - 0.5) * 200;
      if (Math.abs(x) < PARK.w / 2 + 4 && Math.abs(z) < PARK.d / 2 + 4) continue;
      outside.push([x, z, 1.4 + r() * 1.6]);
    }
    const all = [...inside, ...outside];
    const leaves = instanced(new THREE.IcosahedronGeometry(1, 0), std(0x2f6b3c), all.map(([x, z, s]) => TRS(x, 1.9 * s, z, 1.3 * s, 1.6 * s, 1.3 * s, r() * TAU)));
    const cols = [0x2f6b3c, 0x245a34, 0x3a7a42, 0x1f4f30];
    all.forEach((_, i) => { leaves.setColorAt(i, new THREE.Color(cols[i % cols.length])); });
    add(leaves);
    add(instanced(new THREE.CylinderGeometry(0.16, 0.22, 1, 5), std(0x4a3222), all.map(([x, z, s]) => TRS(x, 0.5 * s, z, s, s, s))));
  }

  // ---- mountains + stars behind everything ----
  {
    const r = rng(9);
    for (let i = 0; i < 11; i++) {
      const x = -170 + i * 34 + r() * 14, h = 26 + r() * 30;
      mesh(new THREE.ConeGeometry(18 + r() * 14, h, 6 + Math.floor(r() * 3)), std(0x2b1d4d), x, h / 2 - 1, -120 - r() * 40).rotation.y = r() * TAU;
    }
    const pts = [];
    for (let i = 0; i < 1600; i++) {
      const a = r() * TAU, e = 0.08 + Math.acos(1 - r()) * 0.9;
      pts.push(Math.cos(a) * Math.cos(e) * 420, Math.sin(e) * 420, Math.sin(a) * Math.cos(e) * 420);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false })), scene);
  }

  // ---- the lands ----
  const landLights = { token: [0x3d7bff, 90], cache: [0xb56cff, 40], frontier: [0xffc070, 45], small: [0x2ee6d0, 60] };
  const coin = makeCoinFactory();
  const rackMat = [std(0x221d38), std(0x221d38), std(0x2e2748), std(0x221d38),
    new THREE.MeshStandardMaterial({ color: 0x151226, emissive: 0xffffff, emissiveMap: rackTex(), emissiveIntensity: 1.4, roughness: 0.6 }), std(0x221d38)];
  const rack = (x, z, w, h, d, ry = 0) => { const m = mesh(new THREE.BoxGeometry(w, h, d), rackMat, x, h / 2, z); m.rotation.y = ry; return m; };
  const neonTube = (pts, color, r = 0.28, k = 2.4) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    mesh(new THREE.TubeGeometry(curve, 120, r, 8), glow(color, k));
    const end = curve.getPointAt(1), tg = curve.getTangentAt(1);
    const head = mesh(new THREE.ConeGeometry(r * 3.2, r * 5, 12), glow(color, k), end.x, end.y, end.z);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tg);
  };
  const statue = (x, z, outfit, face = 0, h = 1.8, scale = 1.25) => {
    mesh(new THREE.CylinderGeometry(1.2, 1.45, h, 16), std(0x8d86a3), x, h / 2, z);
    const bot = createCostBot({ style: 'glossy', shadows: !TOUCH });
    bot.root.scale.setScalar(scale);
    bot.root.position.set(x, h, z);
    bot.root.rotation.y = face;
    if (outfit) bot.setOutfit(outfit);
    add(bot.root);
    bot.root.traverse((o) => { if (o.isMesh) { o.userData.bot = bot; hitTargets.push(o); } });
    const phase = x * 0.37 + z;
    animators.push((t, dt) => bot.update(t + phase, dt, { baseY: h + 1.1 * scale, still: true }));
    return bot;
  };

  for (const l of C.LANDS) {
    const q = LANDR[l.id];
    const patchMat = l.id === 'token'
      ? new THREE.MeshStandardMaterial({ color: 0x14285e, emissive: 0x3d7bff, emissiveMap: gridTex(), emissiveIntensity: 0.55, roughness: 0.7 })
      : std({ cache: 0x3e2670, frontier: 0xa87a45, small: 0x145a48 }[l.id], { map: pavingTex({ cache: '#4a2f82', frontier: '#c9955a', small: '#1a6450' }[l.id], l.id.length * 7, [3, 2]) });
    const patch = mesh(slab(q.w - 1, q.d - 1, 4, 0.34), patchMat, q.cx, 0, q.cz);
    patch.receiveShadow = true;
    patch.userData.focus = l.id; hitTargets.push(patch);
    const pl = new THREE.PointLight(landLights[l.id][0], landLights[l.id][1], 40, 1.4); pl.position.set(q.cx - Math.sign(q.cx) * 6, 13, q.cz + 4); add(pl);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(`${l.emoji}  ${l.name}`, l.color), depthTest: false, transparent: true }));
    label.scale.set(15, 3, 1);
    label.position.set(q.cx, l.id === 'cache' ? 22 : 15, q.cz);
    label.renderOrder = 10;
    label.userData.focus = l.id; hitTargets.push(label); labels.push(label);
    add(label);
  }

  // Tokenland — neon coaster, a rising-chart arrow, giant coins, arcade cabinets
  {
    const q = LANDR.token;
    const cx = q.cx + 1, cz = q.cz - 1;
    const pts = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * 11.5, 1.6 + 6.5 * Math.max(0, Math.sin(a)) ** 2 + 2.6 * Math.max(0, Math.sin(a * 3 + 1)), cz + Math.sin(a) * 6.8 * (1 + 0.2 * Math.sin(2 * a))));
    }
    const coaster = new THREE.CatmullRomCurve3(pts, true);
    mesh(new THREE.TubeGeometry(coaster, 300, 0.24, 8, true), glow(0x3fa0ff, 2.6));
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => p.clone().add(new THREE.Vector3(0, -0.6, 0))), true), 300, 0.12, 6, true), glow(0x1f5ad0, 1.6));
    const legs = [];
    for (let i = 0; i < 56; i++) { const p = coaster.getPointAt(i / 56); legs.push(TRS(p.x, p.y / 2, p.z, 1, p.y, 1)); }
    add(instanced(new THREE.CylinderGeometry(0.07, 0.07, 1, 5), glow(0x2a6fe0, 1.2), legs));
    const car = mesh(new THREE.BoxGeometry(1, 0.7, 1.8), glow(0x9fd4ff, 2.2));
    animators.push((t) => {
      const u = (t * 0.07) % 1, p = coaster.getPointAt(u), tg = coaster.getTangentAt(u);
      car.position.set(p.x, p.y + 0.55, p.z);
      car.lookAt(p.x + tg.x, p.y + 0.55 + tg.y, p.z + tg.z);
    });
    neonTube([[q.x0 + 2, 1, q.z1 - 2], [q.x0 + 7, 6, q.z1 - 5], [q.x0 + 11, 4, q.z0 + 11], [q.x0 + 17, 11, q.z0 + 7], [q.x0 + 21, 9, q.z0 + 5], [q.x1 - 3, 17, q.z0 + 1]], 0x4fc3ff);
    const coins = [];
    for (const [dx, dz, s] of [[-4, 3.5, 4.5], [3, 2.4, 4], [7.5, 4.8, 2.6]]) {
      mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.4, 12), glow(0x3d7bff, 1.3), cx + dx, 0.7, cz + dz);
      const c = coin(); c.scale.setScalar(s); c.position.set(cx + dx, 1.4 + s * 0.3, cz + dz); add(c); coins.push(c);
    }
    animators.push((t) => coins.forEach((c, i) => { c.rotation.y = t * (0.9 + i * 0.25); c.position.y = 1.4 + c.scale.x * 0.3 + Math.sin(t * 1.4 + i) * 0.3; }));
    const cab = std(0x1d3a8a), screen = glow(0x7fd6ff, 1.9);
    for (const [dx, dz, ry] of [[-10, 5.5, 0.4], [-7.5, 7, 0.2], [9.5, -3.5, -0.6], [11, 1, -0.9]]) {
      const g = add(new THREE.Group()); g.position.set(cx + dx, 0.34, cz + dz); g.rotation.y = ry;
      mesh(new THREE.BoxGeometry(1.4, 2.8, 1.2), cab, 0, 1.4, 0, g);
      mesh(new THREE.PlaneGeometry(1.05, 0.8), screen, 0, 2.05, 0.61, g);
      mesh(new THREE.BoxGeometry(1.4, 0.25, 0.8), std(0xf4b41a), 0, 1.35, 0.8, g);
    }
    statue(q.x0 + 3.5, q.z1 + 1.5, null, 0.5, 1.4, 1.05);
  }

  // Cache Mountain — snow-capped peak, glowing crystals, server racks, the flume
  {
    const q = LANDR.cache;
    const mountain = (x, z, r, h, seed) => {
      const geo = new THREE.ConeGeometry(r, h, 11, 6).toNonIndexed();
      const pos = geo.attributes.position, rr = rng(seed), cols = [];
      const jit = new Map();
      for (let i = 0; i < pos.count; i++) {
        const k = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
        if (!jit.has(k)) jit.set(k, [1 + (rr() - 0.5) * 0.35, (rr() - 0.5) * 1.2]);
        const [s, dy] = jit.get(k), y = pos.getY(i);
        const top = y > h / 2 - 0.01;
        pos.setXYZ(i, pos.getX(i) * (top ? 1 : s), y + (top ? 0 : dy), pos.getZ(i) * (top ? 1 : s));
      }
      for (let i = 0; i < pos.count; i += 3) {
        const yy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 / h + 0.5;
        const c = new THREE.Color(yy > 0.58 ? 0xd9d6ee : yy > 0.4 ? 0x8e82b0 : 0x584a80);
        for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      return mesh(geo, std(0xffffff, { vertexColors: true }), x, h / 2 + 0.2, z);
    };
    mountain(q.cx + 5, q.cz - 3, 9, 18, 3);
    mountain(q.cx - 1.5, q.cz - 5.5, 5.5, 10, 5);
    const r = rng(77), crystal = glow(0xb56cff, 1.5), crystals = [];
    for (let i = 0; i < 16; i++) {
      const a = r() * TAU, d = 7 + r() * 5;
      const s = 0.5 + r() * 0.9;
      crystals.push(TRS(q.cx + 5 + Math.cos(a) * d, s * 1.6, q.cz - 3 + Math.sin(a) * d * 0.6, s * 0.55, s * 2, s * 0.55, r() * TAU, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6));
    }
    add(instanced(new THREE.OctahedronGeometry(1, 0), crystal, crystals.filter((m) => { const p = new THREE.Vector3().setFromMatrixPosition(m); return p.x < q.x1 - 1 && p.z > q.z0 + 1 && p.z < q.z1 - 1; })));
    rack(q.x0 + 4, q.cz - 2, 2.6, 6, 2, 0.2); rack(q.x0 + 7, q.cz - 4, 2.6, 7.5, 2, 0.1); rack(q.x0 + 4.5, q.cz + 3, 2.6, 4.5, 2, 0.3);
    const flume = new THREE.CatmullRomCurve3([[q.cx + 3, 10, q.cz - 1], [q.cx + 7, 7, q.cz + 2], [q.cx + 11, 4.5, q.cz + 0], [q.cx + 12.5, 2.5, q.cz + 4], [q.cx + 10, 0.8, q.cz + 7.5]].map((p) => new THREE.Vector3(...p)));
    mesh(new THREE.TubeGeometry(flume, 90, 1, 10), new THREE.MeshStandardMaterial({ color: 0x55c8ff, emissive: 0x1a6aa8, emissiveIntensity: 0.8, transparent: true, opacity: 0.75, roughness: 0.2 }));
    const log = mesh(new THREE.CapsuleGeometry(0.55, 1.4, 4, 8).rotateX(Math.PI / 2), std(0x7a4a2a));
    animators.push((t) => { const u = (t * 0.18) % 1, p = flume.getPointAt(u), tg = flume.getTangentAt(u); log.position.set(p.x, p.y + 0.2, p.z); log.lookAt(p.x + tg.x, p.y + 0.2 + tg.y, p.z + tg.z); });
    neonTube([[q.cx + 2, 1, q.z1 - 1.5], [q.cx + 6, 6, q.z1 - 3], [q.cx + 8, 4.5, q.cz + 1], [q.cx + 12, 12, q.cz - 3], [q.x1 - 1.5, 15, q.cz - 5]], 0xd070ff, 0.3);
  }

  // Frontier Cloud — false-front saloon + "servers" store, water tower with a cloud on top
  {
    const q = LANDR.frontier;
    const wood = std(0x6b4226), woodDk = std(0x4a2c18), porch = std(0x3a2414);
    const store = (x, z, name, w, h) => {
      const g = add(new THREE.Group()); g.position.set(x, 0.34, z); g.rotation.y = 0.25;
      mesh(new THREE.BoxGeometry(w, h, 5), wood, 0, h / 2, 0, g);
      mesh(new THREE.BoxGeometry(w + 0.4, h + 2.2, 0.3), woodDk, 0, (h + 2.2) / 2, 2.6, g);
      const tex = signTex(name, '#2a1608', '#f4d49a');
      mesh(new THREE.PlaneGeometry(w * 0.8, 1.1), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: tex }), 0, h + 1, 2.76, g);
      mesh(new THREE.BoxGeometry(w + 0.6, 0.18, 1.8), porch, 0, h * 0.55, 3.6, g);
      for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.1, 0.1, h * 0.55, 6), porch, s * (w / 2), h * 0.275, 4.3, g);
      for (const s of [-1, 1]) mesh(new THREE.PlaneGeometry(0.9, 1.2), glow(0xffb45a, 1.5), s * w * 0.28, 1.2, 2.77, g);
    };
    store(q.x0 + 5, q.cz - 3.5, 'SALOON', 6, 5);
    store(q.x0 + 12.5, q.cz - 5.5, 'SERVERS', 6.5, 6);
    const tx = q.cx + 5, tz = q.cz - 5.5;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mesh(new THREE.CylinderGeometry(0.13, 0.16, 7.5, 6), woodDk, tx + sx * 1.3, 3.75, tz + sz * 1.3);
    mesh(new THREE.CylinderGeometry(2.3, 2.3, 3, 14), wood, tx, 8.9, tz);
    mesh(new THREE.ConeGeometry(2.6, 1.4, 14), woodDk, tx, 11.1, tz);
    const puff = add(new THREE.Group()); puff.position.set(tx, 12.8, tz);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xd4d0e6, emissive: 0xfff2e0, emissiveIntensity: 0.04, roughness: 1 });
    for (const [x, y, z, s] of [[0, 0.5, 0, 1.9], [-1.8, 0, 0.3, 1.4], [1.8, 0.1, -0.2, 1.5], [0.6, 1.4, 0.4, 1.3], [-0.9, 1.1, -0.6, 1.2]]) mesh(new THREE.SphereGeometry(s, 12, 10), cloudMat, x, y, z, puff);
    animators.push((t) => { puff.position.y = 12.8 + Math.sin(t * 0.9) * 0.3; puff.rotation.y = t * 0.1; });
    rack(q.cx + 1, q.cz + 5, 2.4, 5, 2.4, -0.2);
    const cactus = std(0x3e7a3a), r = rng(15);
    for (let i = 0; i < 9; i++) {
      const x = q.x0 + 2 + r() * (q.w - 4), z = q.cz + 1 + r() * (q.d / 2 - 2), s = 0.7 + r() * 0.6;
      if (Math.hypot(x - (q.cx + 1), z - (q.cz + 5)) < 3) continue;
      const g = add(new THREE.Group()); g.position.set(x, 0.34, z); g.scale.setScalar(s);
      mesh(new THREE.CapsuleGeometry(0.4, 2.4, 4, 8), cactus, 0, 1.6, 0, g);
      mesh(new THREE.CapsuleGeometry(0.25, 0.8, 4, 8), cactus, 0.6, 1.9, 0, g).rotation.z = -0.5;
      mesh(new THREE.CapsuleGeometry(0.25, 0.7, 4, 8), cactus, -0.55, 1.5, 0, g).rotation.z = 0.6;
    }
    const weeds = [];
    for (let i = 0; i < 3; i++) weeds.push(mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, wireframe: true }), 0, 1, 0));
    animators.push((t) => weeds.forEach((w, i) => {
      const u = ((t * 0.05 + i / 3) % 1);
      w.position.set(lerp(q.x0 + 2, q.x1 - 2, u), 1.05 + Math.abs(Math.sin(t * 3 + i)) * 0.5, q.z1 - 2.5 - i * 1.3);
      w.rotation.z = -t * 3;
    }));
    const posts = [], rails = [];
    for (let x = q.x0 + 0.5; x < q.x1; x += 2) posts.push(TRS(x, 0.9, q.z1 + 0.4));
    for (const y of [0.7, 1.3]) rails.push(TRS(q.cx, y, q.z1 + 0.4, q.w, 1, 1));
    add(instanced(new THREE.BoxGeometry(0.22, 1.8, 0.22), woodDk, posts));
    add(instanced(new THREE.BoxGeometry(1, 0.14, 0.12), woodDk, rails));
    statue(q.x0 + 3.5, q.z1 - 3.2, 'detective', 0.6, 1.4, 1.05);
  }

  // It's a Small Bill (Lagoon) — a moat ring with boats, floating receipts, CostBot on the island
  {
    const q = LANDR.small;
    const lx = q.cx, lz = q.cz + 0.8;
    const water = mesh(new THREE.RingGeometry(5.2, 10.8, 72).rotateX(-Math.PI / 2).scale(1, 1, 0.74),
      new THREE.MeshStandardMaterial({ color: 0x139c90, emissive: 0x0b8f86, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 }), lx, 0.4, lz);
    animators.push((t) => { water.material.emissiveIntensity = 0.5 + Math.sin(t * 1.3) * 0.12; });
    mesh(new THREE.TorusGeometry(10.9, 0.3, 6, 72).rotateX(Math.PI / 2).scale(1, 0.74, 1), std(0x5b8f86), lx, 0.45, lz);
    mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.7, 40).scale(1, 1, 0.74), std(0x2b7a4a), lx, 0.35, lz);
    const boats = [];
    const hull = std(0x8a4b2a), rim = std(0xf4b41a);
    for (let i = 0; i < 6; i++) {
      const g = add(new THREE.Group());
      mesh(new THREE.BoxGeometry(1.2, 0.5, 2.4), hull, 0, 0.25, 0, g);
      mesh(new THREE.BoxGeometry(1.3, 0.12, 2.5), rim, 0, 0.55, 0, g);
      mesh(new THREE.SphereGeometry(0.38, 10, 8), std([0xe2edf7, 0xff8a6a, 0x9fe3ee][i % 3]), 0, 0.95, 0.2, g);
      boats.push(g);
    }
    animators.push((t) => boats.forEach((b, i) => {
      const a = t * 0.12 + (i / boats.length) * TAU;
      b.position.set(lx + Math.cos(a) * 8, 0.45 + Math.sin(t * 2 + i) * 0.06, lz + Math.sin(a) * 8 * 0.74);
      b.rotation.y = -a;
    }));
    const r = rng(33), receipts = [];
    const paper = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, emissive: 0x9a9a90, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const a = r() * TAU, d = 6 + r() * 4;
      const m = mesh(new THREE.PlaneGeometry(0.7, 1.3).rotateX(-Math.PI / 2), paper, lx + Math.cos(a) * d, 0.5, lz + Math.sin(a) * d * 0.74);
      m.userData.a = a; receipts.push(m);
    }
    animators.push((t) => receipts.forEach((m, i) => { m.rotation.y = m.userData.a + t * 0.3; m.position.y = 0.5 + Math.sin(t * 1.7 + i) * 0.08; }));
    const arch = std(0x1f9e8e, { metalness: 0.3 });
    mesh(new THREE.TorusGeometry(3.4, 0.35, 8, 24, Math.PI), arch, lx, 0.4, q.z0 + 1.6);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.45, 10, 8), glow(0x2ee6d0, 2.2), lx + s * 3.4, 0.9, q.z0 + 1.6);
    const head = add(new THREE.Group()); head.position.set(q.x1 - 4.5, 0.34, q.z0 + 3.4); head.rotation.y = -0.5;
    mesh(new THREE.BoxGeometry(4.4, 3.6, 3.4), std(0x2aa37a, { flatShading: false }), 0, 1.8, 0, head);
    mesh(new THREE.BoxGeometry(3.4, 2.6, 2.6), std(0x1f7a5a), 0, 4.8, 0, head);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.42, 10, 8), glow(0x7fffe0, 2.4), s * 0.8, 5, 1.32, head);
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), std(0x1f7a5a), 0, 6.7, 0, head);
    mesh(new THREE.SphereGeometry(0.28, 10, 8), glow(0xff5a8a, 2.4), 0, 7.4, 0, head);
    const c = coin(); c.scale.setScalar(3.2); c.position.set(0, 2, 1.8); head.add(c);
    statue(lx, lz, null, 0, 1.2, 1.25);
  }

  // ---- ferris wheel, topiaries, the front gate, the back banner ----
  const wheel = add(new THREE.Group());
  {
    const wx = WX(590), wz = WZ(562), R = 4.6, hub = 6.2;
    const steel = std(0x9a8fb0, { metalness: 0.7, roughness: 0.35 });
    for (const s of [-1, 1]) for (const lean of [-1, 1]) {
      const leg = mesh(new THREE.CylinderGeometry(0.12, 0.14, hub + 0.4, 6), steel, wx + lean * 1.6, hub / 2, wz + s * 0.9);
      leg.rotation.z = lean * 0.26;
    }
    wheel.position.set(wx, hub, wz);
    mesh(new THREE.TorusGeometry(R, 0.14, 8, 48), steel, 0, 0, 0, wheel);
    mesh(new THREE.TorusGeometry(R * 0.35, 0.1, 6, 24), steel, 0, 0, 0, wheel);
    const spokes = [], bulbs = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; spokes.push(TRS(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0, 1, R, 1, 0, 0, a - Math.PI / 2)); }
    for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; bulbs.push(Math.cos(a) * R, Math.sin(a) * R, 0.2); }
    add(instanced(new THREE.CylinderGeometry(0.05, 0.05, 1, 4), steel, spokes), wheel);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    add(new THREE.Points(bg, new THREE.PointsMaterial({ color: new THREE.Color(2.6, 2, 0.9), size: 0.34, toneMapped: false })), wheel);
    const gondolas = [];
    const gCols = [0x3b82f6, 0xa855f7, 0xf59e0b, 0x14b8a6];
    for (let i = 0; i < 8; i++) {
      const g = add(new THREE.Group()); mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), std(gCols[i % 4]), 0, -0.55, 0, g); gondolas.push(g);
    }
    animators.push((t) => {
      wheel.rotation.z = t * 0.18;
      gondolas.forEach((g, i) => {
        const a = (i / gondolas.length) * TAU + t * 0.18;
        g.position.set(wx + Math.cos(a) * R, hub + Math.sin(a) * R, wz + 0.45);
      });
    });
  }
  const topiary = (x, z, ry) => {
    const g = add(new THREE.Group()); g.position.set(x, 0, z); g.rotation.y = ry;
    const leaf = std(0x2f8a45);
    mesh(new THREE.BoxGeometry(2.4, 1, 2.4), std(0x6d6380), 0, 0.5, 0, g);
    mesh(new THREE.SphereGeometry(1.2, 12, 10), leaf, 0, 2.3, 0, g);
    mesh(new THREE.SphereGeometry(1.35, 12, 10).scale(1.2, 1, 1), leaf, 0, 4.3, 0, g);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.5, 10, 8), leaf, s * 1.4, 2.8 + (s > 0 ? 0.9 : 0), 0, g);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), leaf, 0, 6, 0, g);
    mesh(new THREE.SphereGeometry(0.25, 8, 6), leaf, 0, 6.5, 0, g);
  };
  topiary(WX(410), WZ(170), 0.3);
  topiary(WX(430), WZ(548), -0.2);
  {
    const gz = WZ(C.GATE.y) - 0.5;
    const stoneM = std(0x6d6380), iron = std(0x1e1a2a, { metalness: 0.7, roughness: 0.4 });
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(1.4, 6, 1.4), stoneM, s * 3.9, 3, gz);
      mesh(new THREE.SphereGeometry(0.45, 10, 8), glow(0xffcf7a, 2.6), s * 3.9, 6.5, gz);
    }
    const bars = [];
    for (let x = -3.1; x <= 3.1; x += 0.45) bars.push(TRS(x, 2.4 + Math.cos((x / 3.2) * Math.PI / 2) * 0.8, gz, 1, 4.8 + Math.cos((x / 3.2) * Math.PI / 2) * 1.6, 1));
    add(instanced(new THREE.CylinderGeometry(0.06, 0.06, 1, 5), iron, bars));
    mesh(new THREE.BoxGeometry(6.4, 0.2, 0.2), iron, 0, 1.2, gz);
    const sign = mesh(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshBasicMaterial({ map: shieldTex(), transparent: true, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) }), 0, 7.1, gz);
    sign.userData.focus = 'overview'; hitTargets.push(sign);
    const posts = [], rails = [];
    for (const s of [-1, 1]) {
      for (let x = 5; x < PARK.w / 2 + 1; x += 1.6) posts.push(TRS(s * x, 1, gz));
      for (const y of [0.6, 1.7]) rails.push(TRS(s * (PARK.w / 4 + 2.5), y, gz, PARK.w / 2 - 4, 1, 1));
    }
    add(instanced(new THREE.CylinderGeometry(0.07, 0.07, 2, 5), iron, posts));
    add(instanced(new THREE.BoxGeometry(1, 0.1, 0.1), iron, rails));
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.4, 1.1, 1.4), iron, s * 1.6, 0.55, gz + 2.6);
    const gateBots = [statue(-7.6, gz - 1.4, null, 0.15, 2, 1.35), statue(7.6, gz - 1.4, null, -0.15, 2, 1.35)];
    let waveAt = 4;
    animators.push((t) => { if (t > waveAt) { gateBots[Math.floor(t) % 2].antic('wave'); waveAt = t + 6 + Math.random() * 5; } });
  }
  {
    const bz = WZ(C.TRACK.y) - 16, poleM = std(0x2a2238, { metalness: 0.5 });
    for (const x of [-15, 15]) mesh(new THREE.CylinderGeometry(0.18, 0.22, 11, 8), poleM, x, 5.5, bz);
    mesh(new THREE.CylinderGeometry(0.2, 0.24, 16, 8), poleM, 0, 8, bz - 0.5);
    const sh = mesh(new THREE.PlaneGeometry(4, 4.7), new THREE.MeshBasicMaterial({ map: shieldTex(), transparent: true, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) }), 0, 13.5, bz);
    sh.userData.focus = 'castle'; hitTargets.push(sh);
    const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.55, 0), new THREE.Vector2(0.55, 0), new THREE.Vector2(0, -1.2)]));
    const flags = { gold: [], blue: [] };
    for (const s of [-1, 1]) for (let k = 0; k < 9; k++) {
      const f = (k + 0.5) / 9, x = s * lerp(1, 15, f), y = 10.4 - Math.sin(f * Math.PI) * 1.6;
      (k % 2 ? flags.blue : flags.gold).push(TRS(x, y, bz, 1, 1, 1));
    }
    const fm = (c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.25 });
    add(instanced(tri, fm(0xf4b41a), flags.gold)); add(instanced(tri, fm(0x2d4fa8), flags.blue));
  }

  // everything solid casts and catches the moonlight
  world.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !o.material?.isMeshBasicMaterial) { o.castShadow = !TOUCH; o.receiveShadow = !TOUCH; } });

  // ---- CostBot himself, patrolling the sky ----
  const flyer = createCostBot({ style: 'glossy', shadows: !TOUCH });
  flyer.root.scale.setScalar(2.1);
  scene.add(flyer.root);
  flyer.root.traverse((o) => { if (o.isMesh) { o.userData.bot = flyer; hitTargets.push(o); } });
  let prevFly = null;
  animators.push((t, dt) => {
    const a = t * 0.11;
    const x = Math.sin(a) * 34, z = Math.sin(a * 2) * 17 - 2;
    if (prevFly) {
      const dx = x - prevFly.x, dz = z - prevFly.z, head = Math.atan2(dx, dz);
      let d = head - flyer.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      flyer.root.rotation.y += d * Math.min(1, dt * 3);
      flyer._bank = lerp(flyer._bank || 0, clamp(-d * 6, -0.6, 0.6), 0.05);
    }
    prevFly = { x, z };
    flyer.root.position.x = x; flyer.root.position.z = z;
    flyer.update(t, dt, { baseY: 19 + Math.sin(t * 0.5) * 1.5, leanX: 0.35, leanZ: flyer._bank || 0, billow: 1.6 });
  });

  // ---- fireworks over the castle ----
  let fireworksOn = true, nextBurst = 1.5;
  const bursts = [];
  const FW = [0xff5a8a, 0xf4c430, 0x4fc3ff, 0xb56cff, 0x3cff9a, 0xff8a3a];
  function burst() {
    const n = 110, pos = new Float32Array(n * 3), vel = [];
    const c = new THREE.Vector3(CAS.cx + (Math.random() - 0.5) * 26, 28 + Math.random() * 10, CAS.cz - 6 + (Math.random() - 0.5) * 10);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = Math.sqrt(1 - u * u), sp = 7 + Math.random() * 2.5;
      vel.push(new THREE.Vector3(s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp));
      pos.set([c.x, c.y, c.z], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = FW[Math.floor(Math.random() * FW.length)];
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(col).multiplyScalar(3), size: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    bursts.push({ pts, vel, age: 0, life: 2.2 });
  }
  animators.push((t, dt) => {
    if (fireworksOn && t > nextBurst) { burst(); if (Math.random() < 0.35) burst(); nextBurst = t + 1.4 + Math.random() * 2.2; }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], p = b.pts.geometry.attributes.position;
      b.age += dt;
      for (let k = 0; k < b.vel.length; k++) {
        const v = b.vel[k]; v.multiplyScalar(1 - dt * 1.2); v.y -= 5 * dt;
        p.setXYZ(k, p.getX(k) + v.x * dt, p.getY(k) + v.y * dt, p.getZ(k) + v.z * dt);
      }
      p.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, 1 - (b.age / b.life) ** 2);
      if (b.age >= b.life) { scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i, 1); }
    }
  });

  // ---- camera: orbit / zoom / pan with eased fly-to ----
  const VIEWS = {
    overview: { target: [0, 0, 3], r: 108, phi: 0.86, theta: 0 },
    castle: { target: [CAS.cx, 7, CAS.cz], r: 42, phi: 1.12, theta: 0.25 },
  };
  for (const l of C.LANDS) { const q = LANDR[l.id]; VIEWS[l.id] = { target: [q.cx, 3, q.cz], r: 44, phi: 1.0, theta: -Math.sign(q.cx) * 0.45 }; }
  const cam = { target: new THREE.Vector3(...VIEWS.overview.target), r: 150, phi: 0.5, theta: -0.6 };
  const goal = { target: new THREE.Vector3(...VIEWS.overview.target), r: VIEWS.overview.r, phi: VIEWS.overview.phi, theta: VIEWS.overview.theta };
  let lastInput = 0, touring = false, tourIdx = 0, tourNext = 0;
  const TOUR = ['overview', ...C.LANDS.map((l) => l.id), 'castle'];
  function focus(name, fromTour = false) {
    const v = VIEWS[name]; if (!v) return;
    goal.target.set(...v.target); goal.r = v.r; goal.phi = v.phi;
    // take the short way round to the requested heading
    goal.theta = cam.theta + Math.atan2(Math.sin(v.theta - cam.theta), Math.cos(v.theta - cam.theta));
    if (!fromTour) touring = false;
    emit('focus', { name, touring });
  }
  function setTour(on) { touring = on; tourNext = 0; emit('tour', { on }); }

  const el = renderer.domElement;
  el.style.touchAction = 'none';
  const pointers = new Map();
  let drag = null, pinch = 0, downAt = null;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { pan: e.button === 2 || e.shiftKey, x: e.clientX, y: e.clientY };
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    lastInput = clock.elapsedTime; touring = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) { hover(e); return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInput = clock.elapsedTime;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) goal.r = clamp(goal.r * (pinch / d), 12, 190);
      pinch = d; return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = goal.r * 0.0016, c = Math.cos(goal.theta), s = Math.sin(goal.theta);
      goal.target.x = clamp(goal.target.x - (dx * c + dy * s) * k, -70, 70);
      goal.target.z = clamp(goal.target.z - (-dx * s + dy * c) * k, -55, 55);
    } else {
      goal.theta -= dx * 0.006;
      goal.phi = clamp(goal.phi - dy * 0.005, 0.12, 1.42);
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (downAt && pointers.size === 0 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && performance.now() - downAt.t < 450) click(e);
    if (pointers.size === 0) { drag = null; downAt = null; }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); goal.r = clamp(goal.r * Math.exp(e.deltaY * 0.0012), 12, 190); lastInput = clock.elapsedTime; touring = false; }, { passive: false });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(e) {
    const rc = el.getBoundingClientRect();
    ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(hitTargets, false);
    const sprite = hits.find((h) => h.object.isSprite);
    return (sprite || hits[0])?.object;
  }
  function click(e) {
    const o = pickAt(e); if (!o) return;
    if (o.userData.bot) {
      const b = o.userData.bot;
      if (b === flyer) { b.cheer(); setTimeout(() => b.antic(DANCES[Math.floor(Math.random() * DANCES.length)]), 1600); emit('bot', { who: 'flyer' }); }
      else b.antic(Math.random() < 0.5 ? 'wave' : DANCES[Math.floor(Math.random() * DANCES.length)]);
      return;
    }
    if (o.userData.focus) focus(o.userData.focus);
  }
  let hoverT = 0;
  function hover(e) {
    const now = performance.now(); if (now - hoverT < 60) return; hoverT = now;
    const o = pickAt(e);
    el.style.cursor = o && (o.userData.bot || o.userData.focus) ? 'pointer' : 'grab';
  }

  const keys = (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === '0') focus('overview');
    else if (k >= '1' && k <= '4') focus(C.LANDS[+k - 1].id);
    else if (k === '5') focus('castle');
    else if (k === 't') setTour(!touring);
    else if (k === 'f') { fireworksOn = !fireworksOn; emit('fireworks', { on: fireworksOn }); }
  };
  addEventListener('keydown', keys);

  function resize() {
    const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
    renderer.setSize(w, h); composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? Math.min(80, 45 / Math.sqrt(camera.aspect)) : 45;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // ---- the loop ----
  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (touring && t > tourNext) { tourIdx = (tourIdx + 1) % TOUR.length; focus(TOUR[tourIdx], true); tourNext = t + 7; }
    else if (!touring && !drag && t - lastInput > 12) goal.theta += dt * 0.05;   // idle: a slow drift round the park
    const k = 1 - Math.exp(-dt * 2.6);
    cam.target.lerp(goal.target, k); cam.r = lerp(cam.r, goal.r, k); cam.phi = lerp(cam.phi, goal.phi, k); cam.theta = lerp(cam.theta, goal.theta, k);
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.target.x + cam.r * sp * Math.sin(cam.theta), cam.target.y + cam.r * Math.cos(cam.phi), cam.target.z + cam.r * sp * Math.cos(cam.theta));
    camera.lookAt(cam.target);
    for (const f of animators) f(t, dt);
    // land signs fade out as you fly in, so a close-up isn't all label
    for (const l of labels) l.material.opacity = clamp((camera.position.distanceTo(l.position) - 28) / 22, 0, 1);
    composer.render();
  }
  frame();
  emit('ready', { lands: C.LANDS.map((l) => l.id) });

  return {
    focus,
    tour: setTour,
    get touring() { return touring; },
    toggleFireworks() { fireworksOn = !fireworksOn; emit('fireworks', { on: fireworksOn }); return fireworksOn; },
    get fireworks() { return fireworksOn; },
    views: Object.keys(VIEWS),
    scene, camera, renderer,
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize); removeEventListener('keydown', keys);
      renderer.dispose(); el.remove();
    },
  };
}
