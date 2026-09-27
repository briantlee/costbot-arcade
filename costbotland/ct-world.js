/* ============================================================================
 * CostBotLand Tycoon — the 3D park
 * ----------------------------------------------------------------------------
 * Draws whatever ct-sim.js says is there. The fixed park (castle, gate, woods,
 * lands, sky) is built once; rides, stalls and scenery get a model each, and the
 * crowd, litter, paths and path add-ons are instanced so a full park stays cheap.
 *
 *   const world = createWorld(scene, { touch });
 *   world.sync(sim, t, dt);          // every frame
 *   world.setGhost('coaster', rot);  world.moveGhost(i, j, check);
 * ==========================================================================*/
import * as THREE from 'three';
import { createCostBot } from '../shared/costbot-3d.js';
import { GRID, cellX, cellZ, LANDS, FIXED, DEFS, ADDON_BY_ID } from './ct-content.js';
import { T, ROT_Y, footprint, idx } from './ct-sim.js';

const TAU = Math.PI * 2;
const { W, H } = GRID;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- materials + textures ----
// Plain materials are shared by colour + options, so identical parts can be baked together (see
// mergeStatic) and the renderer isn't switching between hundreds of look-alike materials.
const STD = new Map();
const std = (color, o = {}) => {
  const make = () => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true, ...o });
  if (o.map || o.emissiveMap) return make();
  const key = `${color?.isColor ? color.getHex() : color}|${JSON.stringify(o)}`;
  if (!STD.has(key)) STD.set(key, make());
  return STD.get(key);
};
const GLOWS = [];   // every glow material, so night can turn them up
const glow = (color, k = 2) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false }); m.userData.base = new THREE.Color(color); m.userData.k = k; GLOWS.push(m); return m; };
function canvasTex(w, h, paint, { repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
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
const tileTex = () => canvasTex(128, 128, (g, w, h) => {
  const r = rng(5);
  g.fillStyle = '#9a8ea8'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 150 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v},${v - 12},${v + 10})`; g.fillRect(x * 32 + 2 + (y % 2) * 8, y * 32 + 2, 28, 28);
  }
  g.strokeStyle = 'rgba(40,30,60,.5)'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
});
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
    for (let x = 10; x < w - 10; x += 9) if (r() < 0.55) { g.fillStyle = ['#3cff9a', '#4fb3ff', '#b56cff', '#ffcf5a'][Math.floor(r() * 4)]; g.fillRect(x, y + 3, 4, 3); }
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
const stripeTex = (a, b, n = 12) => canvasTex(256, 32, (g, w, h) => {
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * w) / n, 0, w / n + 1, h); }
});
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const badgeTex = (emoji, ring = '#f4b41a') => canvasTex(128, 128, (g) => {
  g.fillStyle = 'rgba(16,10,26,.85)'; g.beginPath(); g.arc(64, 64, 58, 0, TAU); g.fill();
  g.strokeStyle = ring; g.lineWidth = 7; g.stroke();
  g.font = `64px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 64, 70);
});
const labelTex = (text, color) => canvasTex(640, 128, (g, w, h) => {
  g.font = 'bold 64px "Segoe UI", system-ui, sans-serif';
  const tw = Math.min(w - 20, g.measureText(text).width + 70), x = (w - tw) / 2;
  g.fillStyle = 'rgba(16,10,26,.82)'; g.strokeStyle = color; g.lineWidth = 5;
  g.beginPath(); g.roundRect(x, 14, tw, h - 28, 50); g.fill(); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = '#fff'; g.fillText(text, w / 2, h / 2 + 3);
});
const bubbleTex = (text) => canvasTex(512, 96, (g, w, h) => {
  g.font = '600 34px "Segoe UI", system-ui, sans-serif';
  const tw = Math.min(w - 12, g.measureText(text).width + 44), x = (w - tw) / 2;
  g.fillStyle = 'rgba(255,255,255,.94)'; g.beginPath(); g.roundRect(x, 6, tw, h - 30, 26); g.fill();
  g.beginPath(); g.moveTo(w / 2 - 12, h - 25); g.lineTo(w / 2, h - 6); g.lineTo(w / 2 + 12, h - 25); g.fill();
  g.fillStyle = '#231a33'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 38);
});

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const slab = (w, d, r, depth) => new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth, bevelEnabled: false }).rotateX(-Math.PI / 2);
const TRS = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
function instanced(geo, mat, mats) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((mx, i) => { m.setMatrixAt(i, mx); });
  m.count = mats.length; m.instanceMatrix.needsUpdate = true;
  return m;
}
// Bake a static group's meshes into one mesh per material — the castle alone is ~55 draw calls
// otherwise, twice over with shadows. `keep` meshes (animated ones) are left as they are.
function mergeStatic(group, mergeable = () => true) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !mergeable(o) || Array.isArray(o.material)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], meshes: [] });
    byMat.get(o.material).geos.push(g); byMat.get(o.material).meshes.push(o);
  });
  for (const [mat, { geos, meshes }] of byMat) {
    if (meshes.length < 2) continue;
    const merged = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      if (!geos.every((g) => g.attributes[k])) continue;
      const size = geos[0].attributes[k].itemSize, total = geos.reduce((a, g) => a + g.attributes[k].array.length, 0);
      const arr = new Float32Array(total); let off = 0;
      for (const g of geos) { arr.set(g.attributes[k].array, off); off += g.attributes[k].array.length; }
      merged.setAttribute(k, new THREE.BufferAttribute(arr, size));
    }
    for (const m of meshes) m.parent.remove(m);
    const one = new THREE.Mesh(merged, mat); one.castShadow = one.receiveShadow = true;
    group.add(one);
  }
}
const mk = (geo, mat, x = 0, y = 0, z = 0, parent = null) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (parent) parent.add(m); return m; };

// ---- staff bots: a few-mesh mini CostBot (the full model is ~80 meshes; at staff size nobody can tell) ----
const miniGeo = {
  body: new THREE.CapsuleGeometry(0.26, 0.3, 4, 10), head: new THREE.SphereGeometry(0.34, 14, 10),
  visor: new THREE.SphereGeometry(0.3, 14, 8, -0.9, 1.8, 1.1, 0.9), eye: new THREE.SphereGeometry(0.06, 6, 5),
  cape: new THREE.PlaneGeometry(0.5, 0.62), leg: new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6), tool: new THREE.BoxGeometry(0.08, 0.5, 0.08),
};
const STAFF_COLOR = { janitor: 0x3fb950, mechanic: 0xf4b41a, entertainer: 0xe8445a };
function miniBot(kind, stone = false) {
  const g = new THREE.Group(), c = stone ? 0x9a93ad : STAFF_COLOR[kind];
  const miniWhite = std(stone ? 0xb7b0c6 : 0xe2edf7, { flatShading: false, roughness: stone ? 0.9 : 0.4 });
  const miniVisor = std(stone ? 0x6d6680 : 0x122a52, { flatShading: false, roughness: 0.2 });
  const miniEye = stone ? std(0x6d6680) : glow(0x8fe3ee, 2);
  mk(miniGeo.body, std(c, { flatShading: false, roughness: 0.5 }), 0, 0.5, 0, g);
  const head = mk(miniGeo.head, miniWhite, 0, 1.02, 0, g);
  mk(miniGeo.visor, miniVisor, 0, 1.02, 0.05, g).rotation.y = Math.PI;
  for (const s of [-1, 1]) mk(miniGeo.eye, miniEye, s * 0.1, 1.05, 0.33, g);
  const cape = mk(miniGeo.cape, std(c, { side: THREE.DoubleSide }), 0, 0.55, -0.24, g);
  const legs = [-1, 1].map((s) => mk(miniGeo.leg, miniWhite, s * 0.12, 0.14, 0, g));
  const tool = mk(miniGeo.tool, std(stone ? 0x9a93ad : kind === 'janitor' ? 0x8a5a2a : 0x9a8fb0, { metalness: 0.5 }), 0.3, 0.55, 0.1, g);
  if (stone) { tool.visible = false; const s = mk(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12).rotateX(Math.PI / 2), std(0xf4b41a, { metalness: 0.6 }), 0, 0.55, 0.27, g); s.scale.y = 1.2; }
  return { root: g, update(t, moving, working) {
    const w = moving ? Math.sin(t * 14) : 0;
    legs[0].rotation.x = w * 0.7; legs[1].rotation.x = -w * 0.7;
    cape.rotation.x = 0.25 + (moving ? 0.35 : 0) + Math.sin(t * 5) * 0.05;
    tool.rotation.z = working ? Math.sin(t * 16) * 0.6 : 0.2;
    head.position.y = 1.02 + Math.abs(w) * 0.03;
  } };
}

// ============================================================================
// ride, stall and scenery models — each faces +Z (its entrance), centred on its
// footprint, and returns { root, update(t, dt, st) } with st = { run, broken, p }
// ============================================================================
function entranceArch(g, color, zEdge, w = 1.6) {
  const post = std(0x2a2238, { metalness: 0.4 });
  for (const s of [-1, 1]) mk(new THREE.CylinderGeometry(0.07, 0.07, 1.9, 6), post, s * w / 2, 0.95, zEdge, g);
  mk(new THREE.BoxGeometry(w + 0.25, 0.28, 0.12), glow(color, 1.8), 0, 1.95, zEdge, g);
}
const MODELS = {
  carousel(color) {
    const g = new THREE.Group(), spin = new THREE.Group();
    mk(new THREE.CylinderGeometry(1.85, 1.95, 0.35, 24), std(0x8d86a3), 0, 0.17, 0, g);
    g.add(spin);
    mk(new THREE.CylinderGeometry(1.7, 1.7, 0.12, 24), std(0xf4b41a, { metalness: 0.5, roughness: 0.4 }), 0, 0.41, 0, spin);
    mk(new THREE.CylinderGeometry(0.14, 0.14, 2.5, 8), std(0xf4b41a, { metalness: 0.6 }), 0, 1.7, 0, spin);
    const canopy = mk(new THREE.ConeGeometry(2.05, 1, 24, 1), new THREE.MeshStandardMaterial({ map: stripeTex('#e8445a', '#fff4e6', 16), roughness: 0.6 }), 0, 3.4, 0, spin);
    canopy.castShadow = true;
    mk(new THREE.CylinderGeometry(2.05, 2.05, 0.28, 24, 1, true), new THREE.MeshStandardMaterial({ map: stripeTex('#e8445a', '#fff4e6', 24), side: THREE.DoubleSide }), 0, 2.78, 0, spin);
    mk(new THREE.SphereGeometry(0.2, 10, 8), std(0xf4b41a, { metalness: 0.8 }), 0, 4.0, 0, spin);
    const bulbs = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; bulbs.push(Math.cos(a) * 2.02, 2.64, Math.sin(a) * 2.02); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    spin.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: new THREE.Color(2.6, 2.1, 1.1), size: 0.22, toneMapped: false })));
    const horses = [], cols = [0xffffff, 0x3b82f6, 0xf59e0b, 0xa855f7];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, h = new THREE.Group();
      h.position.set(Math.cos(a) * 1.25, 1, Math.sin(a) * 1.25); h.rotation.y = -a;
      mk(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 5), std(0xf4b41a, { metalness: 0.7 }), 0, 0.5, 0, h);
      mk(new THREE.BoxGeometry(0.22, 0.3, 0.62), std(cols[i % 4]), 0, 0, 0, h);
      mk(new THREE.BoxGeometry(0.16, 0.32, 0.18), std(cols[i % 4]), 0, 0.2, 0.34, h);
      spin.add(h); horses.push(h);
    }
    entranceArch(g, color, 2.05);
    let v = 0;
    return { root: g, update(t, dt, st) {
      v = lerp(v, st.run ? 1.1 : 0, dt * 1.5);
      spin.rotation.y += v * dt;
      horses.forEach((h, i) => { h.position.y = 1 + Math.sin(t * 3.5 + i * 1.3) * 0.2 * (v / 1.1); });
    } };
  },
  teacups(color) {
    const g = new THREE.Group(), plate = new THREE.Group();
    mk(new THREE.CylinderGeometry(1.9, 1.95, 0.3, 28), std(0x6d6380), 0, 0.15, 0, g);
    g.add(plate);
    mk(new THREE.CylinderGeometry(1.75, 1.75, 0.1, 28), new THREE.MeshStandardMaterial({ map: stripeTex('#14b8a6', '#e6fffb', 20), roughness: 0.6 }), 0, 0.35, 0, plate);
    mk(new THREE.SphereGeometry(0.45, 14, 10), std(0xf6f3ea, { flatShading: false }), 0, 0.75, 0, plate);
    mk(new THREE.ConeGeometry(0.2, 0.3, 10), std(0x14b8a6), 0, 1.3, 0, plate);
    const cups = [], cols = [0xff8ab3, 0x7fd6ff, 0xffd166];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU, c = new THREE.Group();
      c.position.set(Math.cos(a) * 1.08, 0.4, Math.sin(a) * 1.08);
      const m = std(cols[i], { flatShading: false, side: THREE.DoubleSide });
      mk(new THREE.CylinderGeometry(0.55, 0.38, 0.55, 18, 1, true), m, 0, 0.3, 0, c);
      mk(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 18), m, 0, 0.05, 0, c);
      mk(new THREE.TorusGeometry(0.16, 0.05, 6, 12), m, 0.6, 0.32, 0, c).rotation.x = Math.PI / 2;
      plate.add(c); cups.push(c);
    }
    entranceArch(g, color, 2.05);
    let v = 0;
    return { root: g, update(_t, dt, st) {
      v = lerp(v, st.run ? 1 : 0, dt * 1.6);
      plate.rotation.y += v * 0.9 * dt;
      cups.forEach((c, i) => { c.rotation.y -= v * (2.4 + i * 0.5) * dt; });
    } };
  },
  wheel(color) {
    const g = new THREE.Group(), wheel = new THREE.Group(), R = 2.5, hub = 3.1;
    const steel = std(0x9a8fb0, { metalness: 0.7, roughness: 0.35 });
    mk(new THREE.BoxGeometry(5.4, 0.25, 3.4), std(0x6d6380), 0, 0.12, 0, g);
    for (const s of [-1, 1]) for (const lean of [-1, 1]) {
      mk(new THREE.CylinderGeometry(0.09, 0.11, hub + 0.3, 6), steel, lean * 1.0, hub / 2, s * 0.55, g).rotation.z = lean * 0.3;
    }
    wheel.position.set(0, hub, 0); g.add(wheel);
    mk(new THREE.TorusGeometry(R, 0.1, 8, 48), steel, 0, 0, 0, wheel);
    mk(new THREE.TorusGeometry(R * 0.3, 0.08, 6, 20), steel, 0, 0, 0, wheel);
    const spokes = [], bulbs = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; spokes.push(TRS(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0, 1, R, 1, 0, 0, a - Math.PI / 2)); }
    for (let i = 0; i < 30; i++) { const a = (i / 30) * TAU; bulbs.push(Math.cos(a) * R, Math.sin(a) * R, 0.15); }
    wheel.add(instanced(new THREE.CylinderGeometry(0.035, 0.035, 1, 4), steel, spokes));
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    wheel.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: new THREE.Color(2.6, 2, 0.9), size: 0.26, toneMapped: false })));
    const gondolas = [], gc = [0x3b82f6, 0xa855f7, 0xf59e0b, 0x14b8a6];
    for (let i = 0; i < 8; i++) { const q = new THREE.Group(); mk(new THREE.BoxGeometry(0.55, 0.5, 0.55), std(gc[i % 4]), 0, -0.35, 0, q); g.add(q); gondolas.push(q); }
    entranceArch(g, color, 2.05);
    let a = 0, v = 0;
    return { root: g, update(_t, dt, st) {
      v = lerp(v, st.run ? 0.35 : 0, dt * 1.2); a += v * dt;
      wheel.rotation.z = a;
      gondolas.forEach((q, i) => { const b = (i / 8) * TAU + a; q.position.set(Math.cos(b) * R, hub + Math.sin(b) * R, 0.3); });
    } };
  },
  droptower(color) {
    const g = new THREE.Group();
    mk(new THREE.BoxGeometry(3.4, 0.4, 3.4), std(0x3a2f58), 0, 0.2, 0, g);
    mk(new THREE.CylinderGeometry(0.34, 0.42, 10, 10), std(0x5b4a8a, { metalness: 0.5, roughness: 0.4 }), 0, 5.2, 0, g);
    const stripes = [];
    for (let y = 1.5; y < 10; y += 1.2) stripes.push(TRS(0, y, 0));
    g.add(instanced(new THREE.CylinderGeometry(0.39, 0.39, 0.12, 10), glow(0xb56cff, 1.8), stripes));
    mk(new THREE.ConeGeometry(0.7, 1, 10), glow(0x7fe3ff, 2.2), 0, 10.7, 0, g);
    const car = new THREE.Group(); g.add(car);
    mk(new THREE.TorusGeometry(0.85, 0.2, 8, 20).rotateX(Math.PI / 2), std(0xf4b41a, { metalness: 0.6, roughness: 0.35 }), 0, 0, 0, car);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; mk(new THREE.BoxGeometry(0.28, 0.4, 0.28), std(0xe2edf7), Math.cos(a) * 1.05, -0.2, Math.sin(a) * 1.05, car); }
    entranceArch(g, color, 2.05);
    let y = 0.8;
    return { root: g, update(_t, dt, st) {
      let target = 0.8;
      if (st.run) {
        const p = st.p;
        if (p < 0.55) target = lerp(0.8, 9, p / 0.55);
        else if (p < 0.72) target = 9;
        else target = lerp(9, 0.8, Math.min(1, ((p - 0.72) / 0.12) ** 2));
        y = p > 0.72 ? target : lerp(y, target, 0.2);
      } else y = lerp(y, target, dt * 2);
      car.position.y = y;
    } };
  },
  haunted(color) {
    const g = new THREE.Group();
    const wall = std(0x3a3350), roof = std(0x201a30), win = glow(0x5cff9a, 1.6);
    mk(new THREE.BoxGeometry(5.4, 0.3, 5.4), std(0x2a2338), 0, 0.15, 0, g);
    mk(new THREE.BoxGeometry(4.4, 3, 3.4), wall, 0, 1.8, -0.5, g);
    mk(new THREE.ConeGeometry(3.3, 1.8, 4).rotateY(Math.PI / 4).scale(1, 1, 0.8), roof, 0, 4.2, -0.5, g);
    mk(new THREE.CylinderGeometry(0.75, 0.8, 5, 8), wall, -1.7, 2.8, -1.5, g);
    mk(new THREE.ConeGeometry(1, 1.8, 8), roof, -1.7, 6.2, -1.5, g);
    mk(new THREE.BoxGeometry(1, 1.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x0c0814 }), 0, 1.1, 1.21, g);
    for (const [x, y] of [[-1.4, 2.4], [1.4, 2.4], [1.4, 1.2], [-1.4, 1.2]]) mk(new THREE.PlaneGeometry(0.6, 0.7), win, x, y, 1.22, g);
    mk(new THREE.PlaneGeometry(0.5, 0.6), win, -1.7, 4.2, -0.72, g);
    const rackMat = [std(0x221d38), std(0x221d38), std(0x2e2748), std(0x221d38),
      new THREE.MeshStandardMaterial({ color: 0x151226, emissive: 0xffffff, emissiveMap: rackTex(), emissiveIntensity: 1.2, roughness: 0.6 }), std(0x221d38)];
    for (const x of [-2.1, 2.1]) mk(new THREE.BoxGeometry(0.8, 2.2, 0.6), rackMat, x, 1.4, 1.8, g);
    for (const x of [-1.2, 1.3]) mk(new THREE.BoxGeometry(0.5, 0.7, 0.15), std(0x6d6380), x, 0.6, 2.3, g).rotation.z = (x > 0 ? 0.1 : -0.12);
    const ghost = new THREE.Group(); g.add(ghost);
    const gm = new THREE.MeshStandardMaterial({ color: 0xe8fff4, emissive: 0x9affd0, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 });
    mk(new THREE.SphereGeometry(0.42, 14, 10), gm, 0, 0.3, 0, ghost);
    mk(new THREE.ConeGeometry(0.42, 0.9, 14, 1, true).rotateX(Math.PI), gm, 0, -0.2, 0, ghost);
    entranceArch(g, color, 2.7);
    return { root: g, update(t, _dt, st) {
      const k = st.run ? 1.4 : 0.6;
      ghost.position.set(Math.cos(t * 0.8 * k) * 2.3, 4.6 + Math.sin(t * 2) * 0.4, -0.5 + Math.sin(t * 0.8 * k) * 1.9);
      win.color.copy(win.userData.base).multiplyScalar(win.userData.k * (st.run ? 0.9 + Math.random() * 0.5 : 0.8));
    } };
  },
  flume(color) {
    const g = new THREE.Group();
    mk(new THREE.BoxGeometry(7.6, 0.25, 5.6), std(0x5b4630), 0, 0.12, 0, g);
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU, x = Math.cos(a) * 3.1, z = Math.sin(a) * 1.9;
      const up = Math.max(0, -Math.sin(a));                   // the back half climbs
      pts.push(new THREE.Vector3(x, 0.55 + up ** 2 * 3.2 * (x < 0.8 ? 1 : 0.35 + 0.65 * (1 - (x - 0.8) / 2.3)), z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    mk(new THREE.TubeGeometry(curve, 160, 0.5, 10, true), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8, side: THREE.DoubleSide }), 0, 0, 0, g);
    mk(new THREE.TubeGeometry(curve, 160, 0.36, 10, true), new THREE.MeshStandardMaterial({ color: 0x3fb8ff, emissive: 0x1a6aa8, emissiveIntensity: 0.7, transparent: true, opacity: 0.85, roughness: 0.15 }), 0, 0.06, 0, g);
    mk(new THREE.ConeGeometry(2.6, 3.2, 9).scale(1.2, 1, 0.8), std(0x6d5a3a), -0.6, 1.6, -0.6, g);
    const legs = [];
    for (let i = 0; i < 24; i++) { const p = curve.getPointAt(i / 24); if (p.y > 0.9) legs.push(TRS(p.x, p.y / 2, p.z, 1, p.y, 1)); }
    g.add(instanced(new THREE.CylinderGeometry(0.06, 0.06, 1, 5), std(0x3a2a1a), legs));
    mk(new THREE.BoxGeometry(2.2, 0.12, 1.2), std(0x8a4b2a), 0, 1.8, 2.3, g);
    for (const x of [-1, 1]) mk(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 5), std(0x3a2a1a), x, 0.9, 2.3, g);
    const logs = [];
    for (let i = 0; i < 3; i++) { const l = mk(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8).rotateX(Math.PI / 2), std(0x7a4a2a), 0, 0, 0, g); l.userData.dyn = true; logs.push(l); }
    entranceArch(g, color, 2.75);
    let u = 0, v = 0;
    return { root: g, update(_t, dt, st) {
      v = lerp(v, st.run ? 0.06 : 0.008, dt * 2); u = (u + v * dt) % 1;
      logs.forEach((l, i) => {
        const q = (u + i / 3) % 1, p = curve.getPointAt(q), tg = curve.getTangentAt(q);
        l.position.set(p.x, p.y + 0.3, p.z); l.lookAt(p.x + tg.x, p.y + 0.3 + tg.y, p.z + tg.z);
      });
    } };
  },
  boats(color) {
    const g = new THREE.Group();
    mk(new THREE.BoxGeometry(7.6, 0.25, 7.6), std(0x2b6a52), 0, 0.12, 0, g);
    const water = mk(new THREE.RingGeometry(1.7, 3.5, 56).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x139c90, emissive: 0x0b8f86, emissiveIntensity: 0.55, roughness: 0.15, transparent: true, opacity: 0.92 }), 0, 0.3, 0, g);
    mk(new THREE.TorusGeometry(3.55, 0.16, 6, 56).rotateX(Math.PI / 2), std(0x5b8f86), 0, 0.3, 0, g);
    mk(new THREE.CylinderGeometry(1.7, 1.8, 0.5, 30), std(0x2f8a4a), 0, 0.3, 0, g);
    const head = new THREE.Group(); head.position.set(0, 0.5, -0.2); g.add(head);
    mk(new THREE.BoxGeometry(1.4, 1.2, 1.1), std(0x2aa37a, { flatShading: false }), 0, 0.6, 0, head);
    for (const s of [-1, 1]) mk(new THREE.SphereGeometry(0.16, 10, 8), glow(0x7fffe0, 2.4), s * 0.3, 0.75, 0.56, head);
    mk(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5), std(0x1f7a5a), 0, 1.45, 0, head);
    mk(new THREE.SphereGeometry(0.12, 8, 6), glow(0xff5a8a, 2.4), 0, 1.75, 0, head);
    const boats = [], hull = std(0x8a4b2a), rim = std(0xf4b41a);
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Group();
      mk(new THREE.BoxGeometry(0.7, 0.3, 1.3), hull, 0, 0.15, 0, b);
      mk(new THREE.BoxGeometry(0.76, 0.08, 1.36), rim, 0, 0.33, 0, b);
      g.add(b); boats.push(b);
    }
    entranceArch(g, color, 3.75);
    let a = 0, v = 0;
    return { root: g, update(t, dt, st) {
      v = lerp(v, st.run ? 0.25 : 0.03, dt); a += v * dt;
      water.material.emissiveIntensity = 0.5 + Math.sin(t * 1.3) * 0.12;
      boats.forEach((b, i) => { const q = a + (i / 5) * TAU; b.position.set(Math.cos(q) * 2.6, 0.32 + Math.sin(t * 2 + i) * 0.04, Math.sin(q) * 2.6); b.rotation.y = -q; });
    } };
  },
  coaster(color) {
    const g = new THREE.Group();
    mk(new THREE.BoxGeometry(9.6, 0.25, 5.6), new THREE.MeshStandardMaterial({ color: 0x14285e, emissive: 0x3d7bff, emissiveMap: gridTex(), emissiveIntensity: 0.5, roughness: 0.7 }), 0, 0.12, 0, g);
    const pts = [];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU + Math.PI / 2;                 // i = 0 is the station, front centre
      const back = Math.max(0, -Math.sin(a));
      pts.push(new THREE.Vector3(Math.cos(a) * 4.2, 0.7 + 5.2 * back ** 2 + 1.6 * Math.max(0, Math.sin(a * 3 + 0.6)) * (1 - back), Math.sin(a) * 2.2 * (1 + 0.15 * Math.sin(2 * a))));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    mk(new THREE.TubeGeometry(curve, 240, 0.14, 8, true), glow(0x3fa0ff, 2.4), 0, 0, 0, g);
    mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => p.clone().add(new THREE.Vector3(0, -0.35, 0))), true), 240, 0.07, 6, true), glow(0x1f5ad0, 1.5), 0, 0, 0, g);
    const legs = [];
    for (let i = 0; i < 44; i++) { const p = curve.getPointAt(i / 44); if (p.y > 1) legs.push(TRS(p.x, p.y / 2, p.z, 1, p.y, 1)); }
    g.add(instanced(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), glow(0x2a6fe0, 1.1), legs));
    mk(new THREE.BoxGeometry(2.6, 0.12, 1.1), std(0x1d3a8a), 0, 1.7, 2.35, g);
    const car = mk(new THREE.BoxGeometry(0.6, 0.45, 1.3), glow(0x9fd4ff, 2.1), 0, 0, 0, g);
    car.userData.dyn = true;
    entranceArch(g, color, 2.75);
    let u = 0;
    return { root: g, update(_t, dt, st) {
      if (st.run) { const p = st.p; u = p < 0.15 ? 0 : ((p - 0.15) / 0.85) ** 1.15; }
      else u = lerp(u, 0, dt * 3) < 0.002 ? 0 : u;
      const q = u % 1, p = curve.getPointAt(q), tg = curve.getTangentAt(q);
      car.position.set(p.x, p.y + 0.32, p.z); car.lookAt(p.x + tg.x, p.y + 0.32 + tg.y, p.z + tg.z);
    } };
  },
};
function stallModel(def) {
  const g = new THREE.Group();
  mk(new THREE.BoxGeometry(1.7, 0.14, 1.7), std(0x6d6380), 0, 0.07, 0, g);
  if (def.id === 'restroom') {
    mk(new THREE.BoxGeometry(1.5, 1.6, 1.3), std(0x2a9d8f), 0, 0.94, -0.1, g);
    mk(new THREE.BoxGeometry(1.7, 0.16, 1.5), std(0x1d5e57), 0, 1.82, -0.1, g);
    for (const x of [-0.38, 0.38]) mk(new THREE.BoxGeometry(0.45, 1, 0.05), std(0x0f3b36), x, 0.64, 0.56, g);
  } else {
    mk(new THREE.BoxGeometry(1.3, 1, 1.1), std(new THREE.Color(def.color).multiplyScalar(0.8)), 0, 0.64, -0.15, g);
    mk(new THREE.BoxGeometry(1.36, 0.14, 0.4), std(0xf6f3ea), 0, 1.02, 0.5, g);
    const aw = mk(new THREE.PlaneGeometry(1.5, 0.8), new THREE.MeshStandardMaterial({ map: stripeTex(def.color, '#fff8ee', 8), side: THREE.DoubleSide }), 0, 1.62, 0.3, g);
    aw.rotation.x = -0.95;
    mk(new THREE.BoxGeometry(1.4, 0.1, 1.2), std(new THREE.Color(def.color).multiplyScalar(0.6)), 0, 1.9, -0.2, g);
  }
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTex(def.emoji, def.color) }));
  sign.scale.setScalar(0.95); sign.position.set(0, 2.55, 0); g.add(sign);
  return { root: g, update(t) { sign.position.y = 2.55 + Math.sin(t * 2 + def.cost) * 0.08; } };
}
function sceneryModel(def, seed) {
  const g = new THREE.Group(), r = rng(seed * 97 + 13);
  let update = null;
  if (def.id === 'tree') {
    const s = 0.8 + r() * 0.5;
    mk(new THREE.CylinderGeometry(0.14, 0.2, 1.2 * s, 6), std(0x4a3222), 0, 0.6 * s, 0, g);
    mk(new THREE.IcosahedronGeometry(1, 0).scale(0.95 * s, 1.25 * s, 0.95 * s), std([0x2f6b3c, 0x245a34, 0x3a7a42][Math.floor(r() * 3)]), 0, 1.9 * s, 0, g).rotation.y = r() * TAU;
  } else if (def.id === 'flowers') {
    mk(new THREE.CylinderGeometry(0.85, 0.9, 0.16, 12), std(0x4a3222), 0, 0.08, 0, g);
    const cols = [0xff5a8a, 0xffd166, 0xb56cff, 0xff8a3a, 0x7fd6ff];
    for (let i = 0; i < 9; i++) mk(new THREE.SphereGeometry(0.16, 8, 6), std(cols[i % cols.length]), (r() - 0.5) * 1.3, 0.28, (r() - 0.5) * 1.3, g);
  } else if (def.id === 'topiary') {
    const leaf = std(0x2f8a45);
    mk(new THREE.BoxGeometry(1.2, 0.5, 1.2), std(0x6d6380), 0, 0.25, 0, g);
    mk(new THREE.SphereGeometry(0.6, 12, 10), leaf, 0, 1.1, 0, g);
    mk(new THREE.SphereGeometry(0.68, 12, 10).scale(1.2, 1, 1), leaf, 0, 2.1, 0, g);
    for (const s of [-1, 1]) mk(new THREE.SphereGeometry(0.25, 10, 8), leaf, s * 0.72, 1.35 + (s > 0 ? 0.45 : 0), 0, g);
    mk(new THREE.SphereGeometry(0.13, 8, 6), leaf, 0, 3.05, 0, g);
  } else if (def.id === 'crystal') {
    const m = glow(0xb56cff, 1.6);
    for (let i = 0; i < 4; i++) { const s = 0.4 + r() * 0.5; mk(new THREE.OctahedronGeometry(1, 0).scale(s * 0.5, s * 1.9, s * 0.5), m, (r() - 0.5) * 1, s * 1.2, (r() - 0.5) * 1, g).rotation.set((r() - 0.5) * 0.6, r() * TAU, (r() - 0.5) * 0.6); }
  } else if (def.id === 'cactus') {
    const m = std(0x3e7a3a), s = 0.8 + r() * 0.4;
    mk(new THREE.CapsuleGeometry(0.28 * s, 1.6 * s, 4, 8), m, 0, 1.1 * s, 0, g);
    mk(new THREE.CapsuleGeometry(0.17 * s, 0.55 * s, 4, 8), m, 0.42 * s, 1.3 * s, 0, g).rotation.z = -0.5;
    mk(new THREE.CapsuleGeometry(0.17 * s, 0.5 * s, 4, 8), m, -0.4 * s, 1 * s, 0, g).rotation.z = 0.6;
  } else if (def.id === 'fountain') {
    mk(new THREE.CylinderGeometry(0.95, 1, 0.4, 20), std(0x8d86a3), 0, 0.2, 0, g);
    mk(new THREE.CylinderGeometry(0.82, 0.82, 0.08, 20), new THREE.MeshStandardMaterial({ color: 0x3fb8ff, emissive: 0x1a6aa8, emissiveIntensity: 0.8, roughness: 0.1 }), 0, 0.38, 0, g);
    mk(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 8), std(0x8d86a3), 0, 0.8, 0, g);
    const jet = mk(new THREE.ConeGeometry(0.35, 1, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x4fb3ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.55 }), 0, 1.7, 0, g);
    jet.userData.dyn = true;
    update = (t) => { jet.scale.y = 1 + Math.sin(t * 4) * 0.12; };
  } else if (def.id === 'statue') {
    // a stone CostBot: the live model is ~80 draw calls, and people build a lot of statues
    mk(new THREE.CylinderGeometry(0.75, 0.9, 1.1, 14), std(0x8d86a3), 0, 0.55, 0, g);
    const bot = miniBot(null, true);
    bot.root.scale.setScalar(1.9); bot.root.position.y = 1.1; bot.root.rotation.x = 0.05; g.add(bot.root);
    bot.root.children[5].rotation.x = 0.5;
  }
  return { root: g, update };
}
export function makeModel(defId, seed = 1) {
  const def = DEFS[defId];
  if (def.kind === 'ride') return MODELS[defId](LANDS.find((l) => l.id === def.land)?.color || '#f4b41a');
  if (def.kind === 'shop') return stallModel(def);
  return sceneryModel(def, seed);
}

// ============================================================================
// the world
// ============================================================================
export function createWorld(scene, { touch = false } = {}) {
  const world = new THREE.Group();
  scene.add(world);
  const add = (o, p = world) => { p.add(o); return o; };
  const animators = [];

  // ---- sky, light ----
  const NIGHT_SKY = new THREE.Color(0x120a28), DAY_SKY = new THREE.Color(0x7fb4e6);
  const NIGHT_FOG = new THREE.Color(0x2a1848), DAY_FOG = new THREE.Color(0xa9cbe8);
  scene.background = new THREE.Color().copy(NIGHT_SKY);
  scene.fog = new THREE.Fog(0x2a1848, 170, 380);
  const hemi = add(new THREE.HemisphereLight(0x9aa8ff, 0x2a1d3a, 1.1), scene);
  const sun = new THREE.DirectionalLight(0xd4dcff, 1.5);
  sun.position.set(-40, 70, 45);
  sun.castShadow = !touch;
  Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 50, bottom: -50, near: 10, far: 200 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008;
  scene.add(sun);
  const starsGeo = new THREE.BufferGeometry(), sp = [], sr = rng(9);
  for (let i = 0; i < 1500; i++) { const a = sr() * TAU, e = 0.08 + Math.acos(1 - sr()) * 0.9; sp.push(Math.cos(a) * Math.cos(e) * 420, Math.sin(e) * 420, Math.sin(a) * Math.cos(e) * 420); }
  starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starsMat = new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true });
  scene.add(new THREE.Points(starsGeo, starsMat));
  const castleLight = new THREE.PointLight(0xffb86a, 60, 26, 1.6);

  // ---- ground ----
  const PW = W * GRID.size, PD = H * GRID.size;
  const grass = mk(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), std(0x1f3a26, { map: pavingTex('#2c5234', 3, [60, 60]) }), 0, -0.32, 0, world);
  grass.receiveShadow = true;
  const lawn = mk(slab(PW + 3, PD - 1, 2, 0.3), std(0x467a46, { map: pavingTex('#548a50', 11, [12, 9]) }), 0, -0.3, -1, world);
  lawn.receiveShadow = true;
  const labels = [];
  for (const l of LANDS) {
    const w = l.x1 - l.x0, d = l.z1 - l.z0, cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
    const mat = l.id === 'token'
      ? new THREE.MeshStandardMaterial({ color: 0x1c3470, emissive: 0x3d7bff, emissiveMap: gridTex(), emissiveIntensity: 0.35, roughness: 0.8 })
      : std({ cache: 0x4a3480, frontier: 0xb58450, small: 0x1f6a55 }[l.id], { map: pavingTex({ cache: '#5a3f94', frontier: '#c9955a', small: '#26745e' }[l.id], l.id.length * 7, [3, 2]) });
    const p = mk(slab(w - 0.4, d - 0.4, 3, 0.04), mat, cx, 0, cz, world); p.receiveShadow = true;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(`${l.emoji}  ${l.name}`, l.color), depthTest: false, transparent: true }));
    label.scale.set(11, 2.2, 1); label.position.set(cx, 3.2, cz + (d / 2) - 1.5); label.renderOrder = 10;
    add(label); labels.push(label);
  }

  // ---- the castle (fixed, solid) ----
  {
    const c = FIXED.castle;
    const cx = (cellX(c.i0) + cellX(c.i1)) / 2, cz = (cellZ(c.j0) + cellZ(c.j1)) / 2;
    const g = add(new THREE.Group()); g.position.set(cx, 0, cz); g.scale.setScalar(0.92);
    const wall = std(0xe8d2a6), tower = std(0xdcc392), roof = std(0x2c4aa0, { roughness: 0.6 }), gold = std(0xf4b41a, { metalness: 0.8, roughness: 0.3 }), stone = std(0x5a5470);
    mk(new THREE.BoxGeometry(21, 1.2, 15), stone, 0, 0.6, 0, g);
    mk(new THREE.BoxGeometry(17, 4.5, 2.4), wall, 0, 3.45, 4.6, g);
    for (const s of [-1, 1]) mk(new THREE.BoxGeometry(2.4, 4.5, 10), wall, s * 7.4, 3.45, 0, g);
    mk(new THREE.BoxGeometry(11, 8, 7), wall, 0, 5.2, -0.5, g);
    mk(new THREE.ConeGeometry(5, 3.6, 4, 1).rotateY(Math.PI / 4).scale(1.45, 1, 0.95), roof, 0, 11, -0.5, g);
    const spire = (x, z, r, h, cone, base = 1.2) => {
      mk(new THREE.CylinderGeometry(r, r * 1.05, h, 14), tower, x, base + h / 2, z, g);
      mk(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.35, 14), stone, x, base + h, z, g);
      mk(new THREE.ConeGeometry(r * 1.35, cone, 14), roof, x, base + h + cone / 2, z, g);
      mk(new THREE.SphereGeometry(r * 0.22, 10, 8), gold, x, base + h + cone + 0.1, z, g);
      return base + h + cone;
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) spire(sx * 8.4, sz * 4.8, 1.4, 7, 4);
    for (const sx of [-1, 1]) { spire(sx * 4.3, 3.2, 1.05, 10, 4.5); spire(sx * 4.6, -3.6, 1.3, 12, 5.2); spire(sx * 2.2, -4.2, 0.7, 13.5, 3.4); }
    const top = spire(0, -1, 2, 14, 8.5);
    const flag = mk(new THREE.PlaneGeometry(1.8, 1), new THREE.MeshStandardMaterial({ color: 0x2f6bd0, side: THREE.DoubleSide }), 0.95, top + 2.4, -1, g);
    mk(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), stone, 0, top + 1.5, -1, g);
    animators.push((t) => { flag.rotation.y = Math.sin(t * 2.2) * 0.35; });
    const dark = new THREE.MeshStandardMaterial({ color: 0x120c1c, roughness: 1 });
    mk(new THREE.BoxGeometry(3, 2.8, 0.2), dark, 0, 2.6, 5.85, g);
    mk(new THREE.PlaneGeometry(3.3, 3.9), new THREE.MeshBasicMaterial({ map: shieldTex(), transparent: true, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) }), 0, 7.4, 3.02, g);
    const win = [];
    for (const x of [-4.3, -1.6, 1.6, 4.3]) for (const y of [5.6, 8.2]) if (Math.abs(x) > 2 || y < 6) win.push(TRS(x, y, 3.03));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [4.5, 6.5]) win.push(TRS(sx * 8.4, y, sz * 4.8 + 1.42));
    for (const sx of [-1, 1]) for (const y of [6, 8.3, 10.2]) win.push(TRS(sx * 4.3, y, 4.27));
    g.add(instanced(new THREE.BoxGeometry(0.42, 0.7, 0.08), glow(0xffc86a, 1.8), win));
    castleLight.position.set(0, 5, 9); g.add(castleLight);
    mergeStatic(g, (o) => o !== flag);
  }

  // ---- the gate, fence, gate statues ----
  const gateBots = [];
  {
    const gz = cellZ(FIXED.gate[0][1]) - 0.2, gx = (cellX(FIXED.gate[0][0]) + cellX(FIXED.gate[1][0])) / 2;
    const stoneM = std(0x6d6380), iron = std(0x1e1a2a, { metalness: 0.7, roughness: 0.4 });
    for (const s of [-1, 1]) { mk(new THREE.BoxGeometry(1.2, 5.5, 1.2), stoneM, gx + s * 2.6, 2.75, gz, world); mk(new THREE.SphereGeometry(0.4, 10, 8), glow(0xffcf7a, 2.4), gx + s * 2.6, 5.9, gz, world); }
    mk(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshBasicMaterial({ map: shieldTex(), transparent: true, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) }), gx, 6.6, gz, world);
    mk(new THREE.BoxGeometry(5.2, 0.3, 0.3), iron, gx, 5.2, gz, world);
    const posts = [], rails = [];
    for (let x = -PW / 2; x <= PW / 2; x += 1.6) if (Math.abs(x - gx) > 3.2) posts.push(TRS(x, 1, gz));
    for (const s of [-1, 1]) for (const y of [0.6, 1.7]) rails.push(TRS(gx + s * (PW / 4 + 1.6), y, gz, PW / 2 - 3.2, 1, 1));
    add(instanced(new THREE.CylinderGeometry(0.07, 0.07, 2, 5), iron, posts));
    add(instanced(new THREE.BoxGeometry(1, 0.1, 0.1), iron, rails));
    const plaza = mk(slab(16, 6, 1.5, 0.08), std(0x8a7d98, { map: pavingTex('#9a8ea8', 21, [4, 2]) }), gx, 0, gz + 3.4, world); plaza.receiveShadow = true;
    for (const [i, j] of FIXED.statues) {
      const x = cellX(i), z = cellZ(j);
      mk(new THREE.CylinderGeometry(1, 1.2, 1.8, 16), std(0x8d86a3), x, 0.9, z, world);
      const bot = createCostBot({ style: 'glossy', shadows: false });
      bot.root.scale.setScalar(0.85); bot.root.position.set(x, 1.8, z); bot.root.rotation.y = x < 0 ? 0.2 : -0.2;
      add(bot.root); gateBots.push(bot);
      animators.push((t, dt) => bot.update(t + x, dt, { baseY: 1.8 + 0.9, still: true }));
    }
    let waveAt = 5;
    animators.push((t) => { if (t > waveAt) { gateBots[Math.floor(t) % 2].antic('wave'); waveAt = t + 7 + Math.random() * 6; } });
  }

  // ---- woods round the outside, mountains beyond ----
  {
    const r = rng(42), trees = [];
    for (let i = 0; i < 520; i++) {
      const x = (r() - 0.5) * 280, z = (r() - 0.5) * 220;
      if (Math.abs(x) < PW / 2 + 3 && z > -PD / 2 - 3 && z < PD / 2 + 8) continue;
      trees.push([x, z, 1.4 + r() * 1.6]);
    }
    const leaves = instanced(new THREE.IcosahedronGeometry(1, 0), std(0x2f6b3c), trees.map(([x, z, s]) => TRS(x, 1.9 * s, z, 1.3 * s, 1.6 * s, 1.3 * s, r() * TAU)));
    const cols = [0x2f6b3c, 0x245a34, 0x3a7a42, 0x1f4f30];
    trees.forEach((_, i) => { leaves.setColorAt(i, new THREE.Color(cols[i % 4])); });
    add(leaves);
    add(instanced(new THREE.CylinderGeometry(0.16, 0.22, 1, 5), std(0x4a3222), trees.map(([x, z, s]) => TRS(x, 0.5 * s, z, s, s, s))));
    for (let i = 0; i < 11; i++) {
      const x = -170 + i * 34 + r() * 14, h = 26 + r() * 30;
      mk(new THREE.ConeGeometry(18 + r() * 14, h, 6 + Math.floor(r() * 3)), std(0x3a2d5d), x, h / 2 - 1, -120 - r() * 40, world).rotation.y = r() * TAU;
    }
  }

  // ---- paths + path add-ons (instanced, rebuilt when the sim's layout changes) ----
  const MAXC = W * H;
  const tileGeo = new THREE.BoxGeometry(GRID.size, 0.1, GRID.size);
  const paths = add(new THREE.InstancedMesh(tileGeo, std(0xffffff, { map: tileTex(), flatShading: false }), MAXC));
  paths.receiveShadow = true; paths.count = 0;
  const benches = add(new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.12, 0.38), std(0x7a4a2a), MAXC)); benches.count = 0;
  const benchBacks = add(new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.4, 0.08), std(0x7a4a2a), MAXC)); benchBacks.count = 0;
  const bins = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.17, 0.6, 10), std(0x2f6b3c, { metalness: 0.3 }), MAXC)); bins.count = 0;
  const poles = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 2.6, 6), std(0x1b1626, { metalness: 0.6 }), MAXC)); poles.count = 0;
  const bulbMat = glow(0xffcf7a, 2.6);
  const bulbs = add(new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat, MAXC)); bulbs.count = 0;
  // instanced layers that change shape as the park grows: skip frustum culling, their bounds go stale
  for (const im of [paths, benches, benchBacks, bins, poles, bulbs]) im.frustumCulled = false;
  function syncPaths(sim) {
    const S = sim.S, m = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0, nb = 0, nbin = 0, nl = 0;
    for (let k = 0; k < MAXC; k++) {
      const t = S.type[k];
      if (t !== T.PATH && t !== T.GATE) continue;
      const i = k % W, j = (k / W) | 0, x = cellX(i), z = cellZ(j);
      paths.setMatrixAt(n, m.makeTranslation(x, 0.05, z));
      paths.setColorAt(n, col.setHSL(0.72, 0.1, 0.62 + ((i * 7 + j * 13) % 5) * 0.02)); n++;
      const a = S.addon[k];
      if (!a) continue;
      // tuck the add-on against a side with no path, so it never blocks the walkway visually
      let ox = 0, oz = 0.72, ry = 0;
      for (const [di, dj, r] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
        const ni = i + di, nj = j + dj;
        const open = ni < 0 || nj < 0 || ni >= W || nj >= H || (S.type[idx(ni, nj)] !== T.PATH && S.type[idx(ni, nj)] !== T.GATE);
        if (open) { ox = di * 0.72; oz = dj * 0.72; ry = r; break; }
      }
      if (a === ADDON_BY_ID.bench.n) {
        benches.setMatrixAt(nb, TRS(x + ox, 0.42, z + oz, 1, 1, 1, ry));
        benchBacks.setMatrixAt(nb, TRS(x + ox * 1.25, 0.66, z + oz * 1.25, 1, 1, 1, ry)); nb++;
      } else if (a === ADDON_BY_ID.bin.n) bins.setMatrixAt(nbin++, m.makeTranslation(x + ox, 0.4, z + oz));
      else if (a === ADDON_BY_ID.lamp.n) {
        poles.setMatrixAt(nl, m.makeTranslation(x + ox, 1.35, z + oz));
        bulbs.setMatrixAt(nl, m.makeTranslation(x + ox, 2.72, z + oz)); nl++;
      }
    }
    paths.count = n; benches.count = benchBacks.count = nb; bins.count = nbin; poles.count = bulbs.count = nl;
    for (const im of [paths, benches, benchBacks, bins, poles, bulbs]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  // ---- litter ----
  const LMAX = 1500;
  const litterMesh = add(new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.05, 0.14), std(0xffffff), LMAX)); litterMesh.count = 0;
  const vomitMesh = add(new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6).scale(1, 0.18, 1), std(0x9acd32, { roughness: 0.3 }), LMAX)); vomitMesh.count = 0;
  litterMesh.frustumCulled = vomitMesh.frustumCulled = false;
  function syncLitter(sim) {
    const S = sim.S, col = new THREE.Color(), lc = [0xffffff, 0xff5a5a, 0xffd166, 0x7fd6ff];
    let nl = 0, nv = 0;
    for (let k = 0; k < MAXC; k++) {
      const L = S.litter[k], V = S.vomit[k];
      if (!L && !V) continue;
      const x = cellX(k % W), z = cellZ((k / W) | 0), r = rng(k);
      for (let q = 0; q < L && nl < LMAX; q++) { litterMesh.setMatrixAt(nl, TRS(x + (r() - 0.5) * 1.5, 0.13, z + (r() - 0.5) * 1.5, 1, 1, 1, r() * TAU)); litterMesh.setColorAt(nl, col.set(lc[Math.floor(r() * 4)])); nl++; }
      for (let q = 0; q < V && nv < LMAX; q++) vomitMesh.setMatrixAt(nv++, TRS(x + (r() - 0.5) * 1.2, 0.12, z + (r() - 0.5) * 1.2, 0.8 + r() * 0.5, 1, 0.8 + r() * 0.5));
    }
    litterMesh.count = nl; vomitMesh.count = nv;
    litterMesh.instanceMatrix.needsUpdate = vomitMesh.instanceMatrix.needsUpdate = true;
    if (litterMesh.instanceColor) litterMesh.instanceColor.needsUpdate = true;
  }

  // ---- the crowd ----
  const GMAX = 650;
  const bodies = add(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.23, 0.62, 8), std(0xffffff, { flatShading: false }), GMAX));
  const heads = add(new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), std(0xffffff, { flatShading: false }), GMAX));
  bodies.count = heads.count = 0;
  bodies.frustumCulled = heads.frustumCulled = false;
  bodies.castShadow = !touch;
  const SKIN = [0xf1c7a5, 0xd9a07a, 0xa8714f, 0x7a4b2f, 0xffe0c4].map((c) => new THREE.Color(c));
  const gm = new THREE.Matrix4(), gcol = new THREE.Color();
  let selectedGuest = -1;
  function syncGuests(sim, t) {
    let n = 0;
    for (const g of sim.S.guests) {
      if (g.mode === 'ride' || n >= GMAX) continue;
      const bob = g.mode === 'walk' && g.prog < 1 ? Math.abs(Math.sin(t * 11 + g.id)) * 0.08 : 0;
      const y = g.mode === 'sit' ? 0.3 : 0.41 + bob;
      bodies.setMatrixAt(n, gm.makeTranslation(g.x, y, g.z));
      heads.setMatrixAt(n, gm.makeTranslation(g.x, y + 0.46, g.z));
      const sel = g.id === selectedGuest;
      bodies.setColorAt(n, sel ? gcol.set(0xffffff) : gcol.setHSL(g.hue, 0.7, g.happy < 30 ? 0.3 : 0.52));
      heads.setColorAt(n, SKIN[g.id % SKIN.length]);
      n++;
    }
    bodies.count = heads.count = n;
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  }

  const staffViews = new Map();
  function syncStaff(sim, t, dt) {
    const live = new Set();
    for (const s of sim.S.staff) {
      live.add(s.id);
      let v = staffViews.get(s.id);
      if (!v) {
        const bot = miniBot(s.kind);
        add(bot.root);
        bot.root.traverse((o) => { if (o.isMesh) o.userData.staff = s.id; });
        v = { bot, yaw: 0 }; staffViews.set(s.id, v);
      }
      const moving = s.mode === 'walk' && s.prog < 1;
      let d = s.dir - v.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); v.yaw += d * Math.min(1, dt * 8);
      v.bot.root.position.set(s.x, 0.1, s.z); v.bot.root.rotation.y = v.yaw;
      v.bot.update(t + s.id, moving, s.mode === 'work');
    }
    for (const [id, v] of staffViews) if (!live.has(id)) { world.remove(v.bot.root); staffViews.delete(id); }
  }

  // ---- builds ----
  const views = new Map();
  const iconTex = { broken: badgeTex('🛠️', '#ff5a5a'), noent: badgeTex('⚠️', '#ffd166'), closed: badgeTex('⛔', '#ff8a3a') };
  function syncBuilds(sim, t, dt) {
    const S = sim.S;
    for (const [id, v] of views) if (!S.builds.has(id)) { world.remove(v.model.root); if (v.icon) world.remove(v.icon); views.delete(id); }
    for (const b of S.builds.values()) {
      let v = views.get(b.id);
      if (!v) {
        const model = makeModel(b.def, b.id);
        model.root.position.set(b.x, 0, b.z);
        model.root.rotation.y = ROT_Y[b.rot];
        // the frame of every model is static: bake it; moving parts live in child groups or are tagged dyn
        mergeStatic(model.root, (o) => o.parent === model.root && !o.userData.dyn);
        model.root.traverse((o) => {
          if (!o.isMesh) return;
          o.userData.build = b.id;
          // only the big shapes throw shadows — every caster is a second draw call in the shadow pass
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          o.castShadow = !touch && !o.material?.isMeshBasicMaterial && o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) > 0.6;
          o.receiveShadow = !touch && b.kind !== 'scenery';
        });
        add(model.root);
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex.broken, depthTest: false }));
        icon.scale.setScalar(1.6); icon.renderOrder = 11; icon.visible = false; add(icon);
        v = { model, icon, iconKind: null, h: b.kind === 'ride' ? { droptower: 12, coaster: 8, wheel: 7, haunted: 8 }[b.def] || 6 : 3.5 };
        views.set(b.id, v);
      }
      const def = DEFS[b.def];
      if (v.model.update) v.model.update(t, dt, { run: b.state === 'running', broken: b.state === 'broken', p: b.state === 'running' ? 1 - b.timer / def.cycle : 0 });
      const kind = b.kind === 'scenery' ? null : b.state === 'broken' ? 'broken' : !b.dist || !b.connected ? 'noent' : !b.open ? 'closed' : null;
      if (kind !== v.iconKind) { v.iconKind = kind; v.icon.visible = !!kind; if (kind) v.icon.material.map = iconTex[kind]; v.icon.material.needsUpdate = true; }
      if (kind) v.icon.position.set(b.x, v.h + Math.abs(Math.sin(t * 3)) * 0.5, b.z);
    }
  }

  // ---- thought bubbles ----
  const bubbles = [];
  function bubble(sim, gid, text) {
    const g = sim.S.guests.find((q) => q.id === gid);
    if (!g || g.mode === 'ride') return;
    if (bubbles.length >= 6) { const old = bubbles.shift(); world.remove(old.s); old.s.material.map.dispose(); }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex(text), depthTest: false, transparent: true }));
    s.scale.set(6.2, 1.16, 1); s.renderOrder = 12; add(s);
    bubbles.push({ s, g, age: 0 });
  }
  function stepBubbles(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]; b.age += dt;
      b.s.position.set(b.g.x, 1.9 + b.age * 0.25, b.g.z);
      b.s.material.opacity = clamp(3.2 - b.age, 0, 1);
      if (b.age > 3.2) { world.remove(b.s); b.s.material.map.dispose(); bubbles.splice(i, 1); }
    }
  }

  // ---- build ghost + grid + selection ----
  const grid = (() => {
    const pts = [];
    for (let i = 0; i <= W; i++) pts.push(cellX(i) - 1, 0.13, cellZ(0) - 1, cellX(i) - 1, 0.13, cellZ(FIXED.firstBlockedRow) - 1);
    for (let j = 0; j <= FIXED.firstBlockedRow; j++) pts.push(cellX(0) - 1, 0.13, cellZ(j) - 1, cellX(W) - 1, 0.13, cellZ(j) - 1);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
    l.visible = false; return add(l);
  })();
  const plateMat = new THREE.MeshBasicMaterial({ color: 0x3cff9a, transparent: true, opacity: 0.35, depthWrite: false });
  const plate = mk(new THREE.BoxGeometry(1, 0.06, 1), plateMat, 0, 0.12, 0, world); plate.visible = false;
  const entMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7, depthWrite: false });
  const entMark = mk(new THREE.ConeGeometry(0.5, 0.9, 3).rotateX(Math.PI / 2), entMat, 0, 0.35, 0, world); entMark.visible = false;
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false });
  const selRing = mk(new THREE.TorusGeometry(1, 0.06, 6, 48).rotateX(Math.PI / 2), selMat, 0, 0.2, 0, world); selRing.visible = false;
  let ghost = null, ghostId = null, ghostRot = 0;
  function setGhost(id, rot = 0) {
    if (ghost && (ghostId !== id)) { world.remove(ghost.root); ghost = null; }
    ghostId = id; ghostRot = rot;
    grid.visible = !!id;
    if (!id) { plate.visible = entMark.visible = false; return; }
    if (!ghost && DEFS[id]) {
      ghost = makeModel(id, 7);
      ghost.root.traverse((o) => { if (o.isMesh || o.isPoints || o.isSprite) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; o.castShadow = false; } });
      add(ghost.root);
    }
  }
  function moveGhost(ci, cj, chk) {
    if (!ghostId) return;
    const def = DEFS[ghostId];
    const fp = def ? footprint(def, ci, cj, ghostRot) : { i0: ci, j0: cj, w: 1, d: 1, ent: null };
    const cx = cellX(fp.i0) + (fp.w - 1), cz = cellZ(fp.j0) + (fp.d - 1);
    plate.visible = true; plate.position.set(cx, 0.14, cz); plate.scale.set(fp.w * GRID.size, 1, fp.d * GRID.size);
    plateMat.color.set(chk.ok ? 0x3cff9a : 0xff4a5a);
    if (ghost) { ghost.root.visible = true; ghost.root.position.set(cx, 0, cz); ghost.root.rotation.y = ROT_Y[ghostRot]; }
    entMark.visible = !!fp.ent;
    if (fp.ent) {
      entMark.position.set(cellX(fp.ent[0]), 0.4, cellZ(fp.ent[1]));
      entMark.rotation.y = ROT_Y[ghostRot] + Math.PI;
      entMat.color.set(chk.connected === false ? 0xffd166 : 0x3cff9a);
    }
  }
  function hideGhost() { plate.visible = entMark.visible = false; if (ghost) ghost.root.visible = false; }
  function select(sel, sim) {
    selectedGuest = sel?.guest ? sel.guest : -1;
    selRing.visible = false;
    if (!sel) return;
    if (sel.build) {
      const b = sim.S.builds.get(sel.build); if (!b) return;
      selRing.visible = true; selRing.position.set(b.x, 0.2, b.z);
      selRing.scale.set(b.w * 1.25, 1, b.d * 1.25);
    }
  }
  function followSelection(sel, sim) {
    if (!sel) return;
    let x = null, z = null;
    if (sel.guest) { const g = sim.S.guests.find((q) => q.id === sel.guest); if (g) { x = g.x; z = g.z; } }
    if (sel.staff) { const s = sim.S.staff.find((q) => q.id === sel.staff); if (s) { x = s.x; z = s.z; } }
    if (x !== null) { selRing.visible = true; selRing.position.set(x, 0.15, z); selRing.scale.setScalar(0.6); }
  }

  // ---- fireworks (the finale, and a nightly show once the park earns one) ----
  const bursts = [];
  const FW = [0xff5a8a, 0xf4c430, 0x4fc3ff, 0xb56cff, 0x3cff9a, 0xff8a3a];
  function burst() {
    const n = 110, pos = new Float32Array(n * 3), vel = [];
    const c = new THREE.Vector3((Math.random() - 0.5) * 40, 28 + Math.random() * 12, -8 + (Math.random() - 0.5) * 14);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = Math.sqrt(1 - u * u), spd = 7 + Math.random() * 2.5;
      vel.push(new THREE.Vector3(s * Math.cos(th) * spd, u * spd, s * Math.sin(th) * spd)); pos.set([c.x, c.y, c.z], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(FW[Math.floor(Math.random() * FW.length)]).multiplyScalar(3), size: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    bursts.push({ pts, vel, age: 0, life: 2.2 });
  }
  let fireworks = 0, nextBurst = 0;
  function stepFireworks(t, dt) {
    if (fireworks > 0 && t > nextBurst) { burst(); if (Math.random() < 0.4) burst(); nextBurst = t + (fireworks > 1 ? 0.35 : 1.4) + Math.random() * 1.2; }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], p = b.pts.geometry.attributes.position; b.age += dt;
      for (let k = 0; k < b.vel.length; k++) { const v = b.vel[k]; v.multiplyScalar(1 - dt * 1.2); v.y -= 5 * dt; p.setXYZ(k, p.getX(k) + v.x * dt, p.getY(k) + v.y * dt, p.getZ(k) + v.z * dt); }
      p.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - (b.age / b.life) ** 2);
      if (b.age >= b.life) { scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i, 1); }
    }
  }

  // ---- day / night ----
  function setNight(n) {
    scene.background.copy(DAY_SKY).lerp(NIGHT_SKY, n);
    scene.fog.color.copy(DAY_FOG).lerp(NIGHT_FOG, n);
    hemi.intensity = lerp(2.4, 1.05, n); hemi.color.setHex(0xdfe9ff).lerp(new THREE.Color(0x9aa8ff), n);
    sun.intensity = lerp(2.9, 1.35, n); sun.color.setHex(0xfff4e0).lerp(new THREE.Color(0xd4dcff), n);
    starsMat.opacity = n;
    castleLight.intensity = lerp(0, 60, n);
    const k = lerp(0.55, 1, n);
    for (const m of GLOWS) m.color.copy(m.userData.base).multiplyScalar(m.userData.k * k);
  }

  // ---- per frame ----
  let pathV = -1, litterV = -1;
  function sync(sim, t, dt, cam) {
    const S = sim.S;
    if (S.version !== pathV) { pathV = S.version; syncPaths(sim); }
    if (S.litterVersion !== litterV) { litterV = S.litterVersion; syncLitter(sim); }
    syncBuilds(sim, t, dt);
    syncGuests(sim, t);
    syncStaff(sim, t, dt);
    stepBubbles(dt);
    stepFireworks(t, dt);
    for (const f of animators) f(t, dt);
    if (cam) for (const l of labels) l.material.opacity = clamp((cam.position.distanceTo(l.position) - 26) / 22, 0, 0.95);
  }

  // a new park: drop every per-park view so ids from the old sim can't be reused
  function reset() {
    for (const v of views.values()) { world.remove(v.model.root); world.remove(v.icon); }
    views.clear();
    for (const v of staffViews.values()) world.remove(v.bot.root);
    staffViews.clear();
    for (const b of bubbles.splice(0)) world.remove(b.s);
    pathV = litterV = -1; selectedGuest = -1; selRing.visible = false;
  }

  return {
    world, sync, reset, setNight, setGhost, moveGhost, hideGhost, select, followSelection, bubble,
    setFireworks(level) { fireworks = level; },
    pickTargets: () => [...[...views.values()].map((v) => v.model.root), ...[...staffViews.values()].map((v) => v.bot.root)],
    guestNear(sim, x, z, r = 1.1) {
      let best = null, bd = r * r;
      for (const g of sim.S.guests) { if (g.mode === 'ride') continue; const d = (g.x - x) ** 2 + (g.z - z) ** 2; if (d < bd) { bd = d; best = g; } }
      return best;
    },
    gateBots,
  };
}
