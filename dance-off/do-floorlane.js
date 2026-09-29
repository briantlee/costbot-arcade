/* ============================================================================
 * CostBot: Dance Off! — THE FLOOR LANE
 * ----------------------------------------------------------------------------
 * The note bar, laid across the dance floor: one horizontal row in front of both
 * dancers, notes scrolling right to left into a hit ring on the left, exactly like
 * the bar — only it is on the tiles, under the dancers, so your eyes never leave
 * the floor. The row runs across the view rather than into it, so notes keep their
 * spacing (runways pointing into the screen crushed them together).
 *
 *   const floor = makeFloorLane(scene);
 *   floor.sync(notes, marks, beat, { ahead, free, dt });   // every frame (a note's ✋ is n.frozen)
 *   floor.mark(note, grade);                                         // a note was judged
 *   floor.ringAt(out);                                               // where to pop a judgement
 *   floor.pulse(); floor.clear(); floor.setVisible(on);
 *
 * Everything is drawn without tone mapping, so the bloom picks it up like the tiles.
 * ==========================================================================*/
import * as THREE from 'three';
import { MOVES } from './do-content.js';

// The row, in world units: z in front of both dancers' feet, the ring at the left end.
export const ROW = { z: 3.4, ringX: -1.8, farX: 7.6 };   // the ring just right of CostBot, mid-screen
const RUN = ROW.farX - ROW.ringX;
const NOTE_SIZE = 1.2;
const NOTE_Y = 0.72;          // note centre height above the floor
const NOTE_TILT = -0.28;      // leaning back a touch, so they sit on the floor and still face the camera
const FLOOR_Y = 0.04;

// one canvas texture per look, shared by every note that wears it
const texCache = new Map();
function tex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function glyph(g, s, text, color, size = 70) {
  g.fillStyle = color; g.font = `900 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, s / 2, s / 2 + 4);
}
// your moves: a filled tile in the move's colour; his: a dark disc ringed in it, with footprints
const moveTex = (id) => tex(`move:${id}`, 128, 128, (g, s) => {
  const m = MOVES[id];
  g.shadowColor = m.color; g.shadowBlur = 18;
  roundRect(g, 14, 14, s - 28, s - 28, 22); g.fillStyle = m.color; g.fill();
  g.shadowBlur = 0; glyph(g, s, m.glyph, '#0d0820');
});
const sneakTex = (id) => tex(`sneak:${id}`, 128, 128, (g, s) => {
  const m = MOVES[id];
  g.shadowColor = m.color; g.shadowBlur = 16;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 16, 0, Math.PI * 2);
  g.fillStyle = 'rgba(18,10,40,.92)'; g.fill();
  g.lineWidth = 9; g.strokeStyle = m.color; g.stroke();
  g.shadowBlur = 0; glyph(g, s, m.glyph, m.color, 62);
  g.font = '26px system-ui'; g.fillText('👣', s - 26, 26);
});
const freezeTex = () => tex('freeze', 128, 128, (g, s) => {
  g.shadowColor = '#8fc9ff'; g.shadowBlur = 16;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 16, 0, Math.PI * 2);
  g.fillStyle = 'rgba(80,160,255,.55)'; g.fill();
  g.lineWidth = 9; g.strokeStyle = '#8fc9ff'; g.stroke();
  g.shadowBlur = 0; glyph(g, s, '✋', '#fff', 54);
});
const labelTex = (text, color) => tex(`label:${text}`, 320, 64, (g, _w, h) => {
  g.font = '900 30px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.shadowColor = '#000'; g.shadowBlur = 6; g.fillStyle = color; g.fillText(text, 8, h / 2);
});

export function makeFloorLane(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const glow = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false });
  const flat = (w, d, mat, x, z, y = FLOOR_Y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // the strip itself, its two rails, and the ring
  // the strip runs the width of the floor: notes that have passed the ring slide on out to the left
  const stripL = -8.4, stripW = ROW.farX + 0.8 - stripL, stripMid = stripL + stripW / 2;
  flat(stripW, 1.9, new THREE.MeshBasicMaterial({ color: 0x0a0618, transparent: true, opacity: 0.6, depthWrite: false }), stripMid, ROW.z);
  const railMat = glow(0xb77bff, 0.7);
  for (const dz of [-0.95, 0.95]) flat(stripW, 0.05, railMat, stripMid, ROW.z + dz, FLOOR_Y + 0.004);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.84, 48), ringMat);
  ring.position.set(ROW.ringX, NOTE_Y, ROW.z + 0.02);
  ring.rotation.x = NOTE_TILT;
  group.add(ring);
  const ringDisc = flat(1.6, 1.6, glow(0xffffff, 0.12), ROW.ringX, ROW.z, FLOOR_Y + 0.008);
  // beat ticks scroll along the row with the notes
  const tickMat = glow(0xffffff, 0.25);
  const ticks = Array.from({ length: 8 }, () => flat(0.05, 1.8, tickMat, 0, ROW.z, FLOOR_Y + 0.006));
  let pulse = 0;

  const tailMat = new Map();
  const tailFor = (id) => {
    if (!tailMat.has(id)) tailMat.set(id, glow(new THREE.Color(MOVES[id].color).getHex(), 0.55));
    return tailMat.get(id);
  };
  const noteGeo = new THREE.PlaneGeometry(1, 1);
  const live = new Set();       // notes (and verse marks) that currently own a mesh

  function meshFor(n) {
    const mat = new THREE.MeshBasicMaterial({ map: n.kind === 'move' ? moveTex(n.move) : sneakTex(n.move), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(noteGeo, mat);
    m.rotation.x = NOTE_TILT;
    m.scale.setScalar(NOTE_SIZE);
    group.add(m);
    n.sprite = m;
    if (n.hold) {
      n.tail = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.36), tailFor(n.move));
      n.tail.rotation.x = -Math.PI / 2;
      group.add(n.tail);
    }
    live.add(n);
  }
  function markMesh(mk) {
    // a verse divider: a coloured line across the strip, and whose verse starts there
    const you = mk.kind === 'you', color = you ? 0x39d5ff : 0xff6b8b;
    const g = new THREE.Group();
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 1.9), glow(color, 0.85));
    line.rotation.x = -Math.PI / 2;
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.48), new THREE.MeshBasicMaterial({ map: labelTex(mk.label, you ? '#6ff5c1' : '#ff6b8b'), transparent: true, depthWrite: false, toneMapped: false }));
    lbl.position.set(1.25, 0.02, -0.72);
    lbl.rotation.x = -Math.PI / 2;
    g.add(line, lbl);
    g.position.set(0, FLOOR_Y + 0.01, ROW.z);
    group.add(g);
    mk.mesh = g;
    live.add(mk);
  }
  // everything a note or mark made is its own, except the shared textures and the shared note/tail materials
  function drop(o) {
    if (o.sprite) { group.remove(o.sprite); o.sprite.material.dispose(); o.sprite = null; }
    if (o.tail) { group.remove(o.tail); o.tail.geometry.dispose(); o.tail = null; }
    if (o.mesh) {
      group.remove(o.mesh);
      o.mesh.traverse((c) => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); } });
      o.mesh = null;
    }
    live.delete(o);
  }

  return {
    group,
    setVisible(on) { group.visible = on; },
    clear() { for (const o of [...live]) drop(o); },
    pulse() { pulse = 1; },
    ringAt(out) { return out.set(ROW.ringX, NOTE_Y + 1.2, ROW.z); },
    mark(n, grade) { n.fx = { grade, t: 0 }; },
    sync(notes, marks, b, { ahead, free = false, dt = 0 }) {
      const unit = RUN / ahead;
      const x = (beat) => ROW.ringX + (beat - b) * unit;
      pulse = Math.max(0, pulse - dt * 4);
      ringMat.opacity = 0.8 + pulse * 0.2;
      ring.scale.setScalar(1 + pulse * 0.12);
      ringDisc.material.opacity = 0.1 + pulse * 0.2;
      const frac = b - Math.floor(b);
      ticks.forEach((t, k) => { const at = k - frac; t.visible = at >= 0 && at <= ahead; t.position.x = ROW.ringX + at * unit; });

      for (const mk of marks) {
        const dx = mk.beat - b, on = dx < ahead + 0.3 && dx > -0.8;
        if (on && !mk.mesh) markMesh(mk);
        if (!on && mk.mesh) drop(mk);
        if (mk.mesh) mk.mesh.position.x = x(mk.beat);
      }
      for (const n of notes) {
        const dx = n.beat - b, end = n.hold ? n.len : 0;
        const fading = n.fx && n.fx.t < 0.4;
        if ((dx > ahead + 0.3 || dx + end < -0.8) && !fading) { if (n.sprite) drop(n); continue; }
        if (dx > ahead + 0.3) continue;
        if (!n.sprite) meshFor(n);
        const m = n.sprite;
        m.position.set(n.holding ? ROW.ringX : Math.max(ROW.ringX - 1.2, x(n.beat)), NOTE_Y, ROW.z + 0.05);
        if (n.tail) {
          const from = n.holding ? 0 : Math.max(0, dx), to = dx + n.len;
          const len = Math.max(0.01, (to - from) * unit);
          n.tail.scale.x = len;
          n.tail.position.set(ROW.ringX + from * unit + len / 2, FLOOR_Y + 0.012, ROW.z);
          n.tail.visible = to > 0;
        }
        if (n.fx) {
          // judged: a hit swells and fades in the ring, a miss goes grey and sinks away
          n.fx.t += dt;
          const k = Math.min(1, n.fx.t / 0.4);
          if (n.fx.grade === 'miss') { m.material.color.setRGB(0.6, 0.25, 0.3); m.material.opacity = 1 - k; m.position.y -= k * 0.5; }
          else if (!n.holding) { m.scale.setScalar(NOTE_SIZE * (1 + k * 0.6)); m.material.opacity = 1 - k; }
          continue;
        }
        // an unjudged note of his verse turns into a hand while he is looking back
        const frozen = n.kind === 'sneak' && !!n.frozen;
        const want = frozen ? freezeTex() : n.kind === 'move' ? moveTex(n.move) : sneakTex(n.move);
        if (m.material.map !== want) { m.material.map = want; m.material.needsUpdate = true; }
        const near = 1 - Math.min(1, Math.abs(dx) / 0.5);
        m.scale.setScalar(NOTE_SIZE * (1 + near * 0.1) * (free ? 1.06 : 1));
        m.material.color.setScalar(free ? 1.25 : 1);
      }
    },
  };
}
