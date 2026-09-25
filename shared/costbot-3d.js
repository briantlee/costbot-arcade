/* ============================================================================
 * CostBot Arcade — CostBot in 3D
 * ----------------------------------------------------------------------------
 * The flying-superhero CostBot as a three.js model, shared by every 3D cabinet
 * (and the Cost Intelligence Hub mascot). ES module; the page maps `three`:
 *
 *   import { createCostBot, OUTFITS } from '../shared/costbot-3d.js';
 *   const bot = createCostBot({ style: 'glossy' });   // or 'cartoon'
 *   scene.add(bot.root);
 *   bot.setOutfit('detective');
 *   bot.cheer();                  // hop, spin, fist pumps (~1.6s)
 *   bot.antic('yawn');            // idle bits: 'yawn' | 'tablet' | 'loop' | 'wave'
 *   // every frame:
 *   bot.update(t, dt, { lookX, lookY });
 *
 * Proportions follow the sculpt refs: the head is ~1.4x the belly's width, the
 * visor is a rounded rectangle wrapped onto the helmet, the shield covers most of
 * the chest. 'cartoon' is toon shading with outlines (pair it with OutlineEffect)
 * and matches the flat icon; 'glossy' is plastic-and-metal and suits bloom.
 * ==========================================================================*/
import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// helvetiker bold, trimmed to the one glyph the shield needs
const DOLLAR_FONT = new Font({"cssFontWeight":"bold","ascender":1216,"underlinePosition":-100,"cssFontStyle":"normal","boundingBox":{"yMin":-333,"xMin":-162,"yMax":1216,"xMax":1681},"resolution":1000,"original_font_information":{"postscript_name":"Helvetiker-Bold","version_string":"Version 1.00 2004 initial release","vendor_url":"http://www.magenta.gr","full_font_name":"Helvetiker Bold","font_family_name":"Helvetiker","copyright":"Copyright (c) Magenta ltd, 2004.","description":"","trademark":"","designer":"","designer_url":"","unique_font_identifier":"Magenta ltd:Helvetiker Bold:22-10-104","license_url":"http://www.ellak.gr/fonts/MgOpen/license.html","license_description":"Copyright (c) 2004 by MAGENTA Ltd. All Rights Reserved.\r\n\r\nPermission is hereby granted, free of charge, to any person obtaining a copy of the fonts accompanying this license (\"Fonts\") and associated documentation files (the \"Font Software\"), to reproduce and distribute the Font Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or sell copies of the Font Software, and to permit persons to whom the Font Software is furnished to do so, subject to the following conditions: \r\n\r\nThe above copyright and this permission notice shall be included in all copies of one or more of the Font Software typefaces.\r\n\r\nThe Font Software may be modified, altered, or added to, and in particular the designs of glyphs or characters in the Fonts may be modified and additional glyphs or characters may be added to the Fonts, only if the fonts are renamed to names not containing the word \"MgOpen\", or if the modifications are accepted for inclusion in the Font Software itself by the each appointed Administrator.\r\n\r\nThis License becomes null and void to the extent applicable to Fonts or Font Software that has been modified and is distributed under the \"MgOpen\" name.\r\n\r\nThe Font Software may be sold as part of a larger software package but no copy of one or more of the Font Software typefaces may be sold by itself. \r\n\r\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL MAGENTA OR PERSONS OR BODIES IN CHARGE OF ADMINISTRATION AND MAINTENANCE OF THE FONT SOFTWARE BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.","manufacturer_name":"Magenta ltd","font_sub_family_name":"Bold"},"descender":-334,"familyName":"Helvetiker","lineHeight":1549,"underlineThickness":50,"glyphs":{"$":{"x_min":0,"x_max":704,"ha":800,"o":"m 682 693 l 495 693 q 468 782 491 749 q 391 831 441 824 l 391 579 q 633 462 562 534 q 704 259 704 389 q 616 57 704 136 q 391 -22 528 -22 l 391 -156 l 308 -156 l 308 -22 q 76 69 152 -7 q 0 300 0 147 l 183 300 q 215 191 190 230 q 308 128 245 143 l 308 414 q 84 505 157 432 q 12 700 12 578 q 89 902 12 824 q 308 981 166 981 l 308 1069 l 391 1069 l 391 981 q 595 905 521 981 q 682 693 670 829 m 308 599 l 308 831 q 228 796 256 831 q 200 712 200 762 q 225 642 200 668 q 308 599 251 617 m 391 128 q 476 174 449 140 q 504 258 504 207 q 391 388 504 354 l 391 128 "}}});

const PAL = {
  white: 0xf1f4f8, silver: 0xc9d1dd, line: 0x0d1b3a, visor: 0x122a52, eye: 0x8fe3ee,
  antenna: 0x2c8fa6, gold: 0xf4b41a, goldDark: 0xeaa716, teal: 0x1f8a8c, cape: 0x2f6bd0, capeIn: 0x1d4fa0,
};

/* Outfits recolour slots and switch accessories on. `unlock` is how a player
 * gets one — a token price, or a secret (the cabinet decides what that means). */
export const OUTFITS = [
  { id: 'classic', label: 'Classic', unlock: { tokens: 0 } },
  { id: 'detective', label: 'Anomaly Detective', unlock: { tokens: 150 },
    colors: { cape: 0xa8844f, capeIn: 0x6e5431 }, gear: ['fedora', 'magnifier'] },
  { id: 'halloween', label: 'Spooky Spend', unlock: { tokens: 250 },
    colors: { cape: 0xf07a12, capeIn: 0x1a1024, eye: 0xffa53a, antenna: 0x6b2fa0 }, gear: ['witchhat'] },
  { id: 'holiday', label: 'Holiday Freeze', unlock: { tokens: 250 },
    colors: { cape: 0xc8202c, capeIn: 0x7e1119, antenna: 0xe8f4ff }, gear: ['santahat', 'scarf'] },
  { id: 'mega', label: 'Mega CostBot', unlock: { secret: 'konami' },
    colors: { white: 0xf4c430, silver: 0xfff1b8, cape: 0xb3122e, capeIn: 0x6e0a1b, eye: 0xff5a4a, visor: 0x2a0d12 }, metal: true },
  { id: 'graviton', label: 'Graviton Green', unlock: { secret: 'graviton' },
    colors: { white: 0x9bd94a, silver: 0x5f9e2a, cape: 0x1f5e2a, capeIn: 0x113a19, eye: 0xd6ff5c, antenna: 0x76b900 } },
];

const NO_OUTLINE = new Set(['line', 'visor', 'eye', 'cape', 'capeIn', 'screen', 'hilite', 'visorHi', 'capeLine']);
// OutlineEffect takes LINEAR rgb and does not convert it, so the icon's #0d1b3a navy has to be
// given pre-linearised — as sRGB numbers it renders a washed-out slate instead.
const INK = new THREE.Color(0x0d1b3a);
const OUTLINE = { thickness: 0.013, color: [INK.r, INK.g, INK.b] };

function makeGradient() {
  const g = new THREE.DataTexture(new Uint8Array([118, 196, 255]), 3, 1, THREE.RedFormat);
  g.minFilter = g.magFilter = THREE.NearestFilter;
  g.needsUpdate = true;
  return g;
}

function screenTexture() {
  // the tablet CostBot checks when he is bored: a tiny cost chart, trending down
  const c = document.createElement('canvas');
  c.width = 256; c.height = 176;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1733'; g.fillRect(0, 0, 256, 176);
  g.strokeStyle = '#2f4d80'; g.lineWidth = 2;
  for (let y = 30; y < 176; y += 36) { g.beginPath(); g.moveTo(16, y); g.lineTo(240, y); g.stroke(); }
  g.strokeStyle = '#4fe3ff'; g.lineWidth = 7; g.lineJoin = 'round';
  g.beginPath();
  [[16, 40], [60, 58], [100, 50], [140, 96], [180, 110], [240, 146]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.fillStyle = '#f4b41a'; g.font = 'bold 34px system-ui, sans-serif'; g.fillText('-18%', 150, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function materialSets() {
  const gradient = makeGradient();
  const toon = (color, o = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradient, toneMapped: false, ...o });
  const flat = (color, o = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...o });
  const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, ...o });
  const screen = screenTexture();
  const cartoon = {
    white: toon(PAL.white), silver: toon(PAL.silver), line: flat(PAL.line), visor: toon(PAL.visor),
    eye: flat(PAL.eye), antenna: toon(PAL.antenna), gold: toon(PAL.gold), goldDark: toon(PAL.goldDark),
    teal: toon(PAL.teal), cape: toon(PAL.cape, { side: THREE.BackSide }), capeIn: toon(PAL.capeIn, { side: THREE.FrontSide }),
    felt: toon(0x5a3a22), black: toon(0x1d1a24), red: toon(0xc8202c), fluff: toon(0xffffff), band: toon(0x6b2fa0),
    green: toon(0x1f7a3a), glass: flat(0xbfefff, { transparent: true, opacity: 0.45 }), screen: flat(0xffffff, { map: screen }),
    // icon-style shine and ink: flat white glints, a lighter band across the visor, the cape's edge line
    hilite: flat(0xffffff, { transparent: true, opacity: 0.92 }), visorHi: flat(0x2b5391), capeLine: flat(0x0d1b3a),
  };
  for (const [k, m] of Object.entries(cartoon)) {
    m.userData.outlineParameters = NO_OUTLINE.has(k) || k === 'glass' ? { visible: false } : OUTLINE;
  }
  const glossy = {
    white: phys(PAL.white, { metalness: 0.05 }), silver: phys(PAL.silver, { metalness: 0.6 }),
    line: phys(0x8e9cb3, { metalness: 0.5 }), visor: phys(PAL.visor, { roughness: 0.06, metalness: 0.3 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x2fd8ff, emissive: 0x19c8f0, emissiveIntensity: 1.4 }),
    antenna: phys(PAL.antenna, { emissive: PAL.antenna, emissiveIntensity: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf7bd1c, metalness: 1, roughness: 0.22 }),
    goldDark: new THREE.MeshStandardMaterial({ color: 0xe8a012, metalness: 1, roughness: 0.28 }),
    teal: phys(PAL.teal), cape: phys(PAL.cape, { roughness: 0.55, clearcoat: 0, side: THREE.BackSide }),
    capeIn: phys(PAL.capeIn, { roughness: 0.6, clearcoat: 0, side: THREE.FrontSide }),
    felt: phys(0x5a3a22, { roughness: 0.8, clearcoat: 0 }), black: phys(0x1d1a24, { roughness: 0.6 }),
    red: phys(0xc8202c, { roughness: 0.7, clearcoat: 0.2 }), fluff: phys(0xffffff, { roughness: 0.9, clearcoat: 0 }),
    band: phys(0x6b2fa0), green: phys(0x1f7a3a, { roughness: 0.7 }),
    glass: phys(0xbfefff, { transparent: true, opacity: 0.35, roughness: 0.05 }),
    screen: new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }),
    // glossy gets real specular instead, so the painted-on bits hide
    hilite: new THREE.MeshBasicMaterial({ visible: false }), visorHi: new THREE.MeshBasicMaterial({ visible: false }),
    capeLine: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return { cartoon, glossy };
}

export function createCostBot({ style = 'glossy', shadows = true } = {}) {
  const SETS = materialSets();
  const BASE = {};
  for (const s of Object.values(SETS)) for (const [k, m] of Object.entries(s)) if (m.color) BASE[k] = BASE[k] || m.color.getHex();
  let current = style;

  const part = (geo, slot, parent, pos = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, SETS[current][slot]);
    m.userData.slot = slot;
    m.position.set(...pos);
    m.castShadow = shadows;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();     // placement + bob
  const pose = new THREE.Group();     // flying lean, loop-de-loops
  const REST = new THREE.Euler(0.12, 0, -0.08);
  pose.rotation.copy(REST);
  root.add(pose);

  // body: an egg, narrower at the top
  const BODY_H = 0.85, BODY_R = 0.8, BODY_Y = 1.1, BODY_Z = 0.85;
  const bodyR = (y) => Math.sqrt(Math.max(0, 1 - (y / BODY_H) ** 2)) * BODY_R * (1 - 0.12 * y / BODY_H);
  const bodyPts = [];
  for (let i = 0; i <= 32; i++) { const y = -Math.cos(i / 32 * Math.PI) * BODY_H; bodyPts.push(new THREE.Vector2(bodyR(y), y)); }
  part(new THREE.LatheGeometry(bodyPts, 48), 'white', pose, [0, BODY_Y, 0]).scale.z = BODY_Z;
  const waist = part(new THREE.TorusGeometry(bodyR(-0.52) + 0.005, 0.018, 8, 64), 'line', pose, [0, BODY_Y - 0.52, 0]);
  waist.rotation.x = Math.PI / 2;
  waist.scale.y = BODY_Z;

  // head: big ellipsoid; face features are laid onto its surface with S()
  const HEAD = new THREE.Vector3(1.2, 1.0, 1.05);
  const head = new THREE.Group();
  head.position.set(0, 2.75, 0);
  pose.add(head);
  part(new THREE.SphereGeometry(1, 64, 48), 'white', head).scale.copy(HEAD);
  const S = (lon, lat, lift = 1) => new THREE.Vector3(
    HEAD.x * Math.sin(lon) * Math.cos(lat), HEAD.y * Math.sin(lat), HEAD.z * Math.cos(lon) * Math.cos(lat)).multiplyScalar(lift);

  // superellipse patch hugging the head (n=2 ellipse, n≈5 rounded rectangle)
  function surfacePatch(lon0, lat0, w, h, n, lift, rings = 16, segs = 96) {
    const boundary = (a) => {
      const c = Math.cos(a), s = Math.sin(a);
      return [Math.sign(c) * Math.abs(c) ** (2 / n) * w, Math.sign(s) * Math.abs(s) ** (2 / n) * h];
    };
    const center = S(lon0, lat0, lift);
    const pos = [0, 0, 0], idx = [];
    for (let r = 1; r <= rings; r++) {
      for (let s = 0; s < segs; s++) {
        const [x, y] = boundary(s / segs * Math.PI * 2);
        pos.push(...S(lon0 + x * r / rings, lat0 + y * r / rings, lift).sub(center).toArray());
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + (s + 1) % segs);
    for (let r = 1; r < rings; r++) {
      const b = 1 + (r - 1) * segs, nb = b + segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(b + s, nb + s, b + s1, b + s1, nb + s, nb + s1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const edge = Array.from({ length: segs }, (_, s) => {
      const [x, y] = boundary(s / segs * Math.PI * 2);
      return S(lon0 + x, lat0 + y, lift);
    });
    return { geo, center, edge };
  }

  const visor = surfacePatch(0, 0.02, 0.88, 0.46, 5, 1.008);
  part(visor.geo, 'visor', head, visor.center.toArray());
  part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(visor.edge, true), 240, 0.06, 12, true), 'white', head);
  // painted shine: a streak on the helmet's upper left, a glint beside it, and a lighter band along the visor top
  for (const [lon, lat, w, h] of [[-0.52, 0.6, 0.27, 0.095], [-0.18, 0.78, 0.07, 0.045]]) {
    const hl = surfacePatch(lon, lat, w, h, 2, 1.004);
    part(hl.geo, 'hilite', head, hl.center.toArray());
  }
  const vband = surfacePatch(0.02, 0.37, 0.7, 0.05, 4, 1.014);
  part(vband.geo, 'visorHi', head, vband.center.toArray());

  const eyes = [-0.3, 0.3].map((lon) => {
    const e = surfacePatch(lon, 0.07, 0.115, 0.19, 2, 1.03);
    return part(e.geo, 'eye', head, e.center.toArray());
  });
  const smilePts = [];
  for (let i = 0; i <= 24; i++) { const lon = -0.19 + i / 24 * 0.38; smilePts.push(S(lon, -0.25 + 1.6 * lon * lon, 1.03)); }
  const mouthAt = S(0, -0.22, 1.03);
  const smile = new THREE.Group();
  smile.position.copy(mouthAt);
  head.add(smile);
  part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(smilePts.map((p) => p.clone().sub(mouthAt))), 48, 0.028, 8), 'eye', smile);
  for (const p of [smilePts[0], smilePts[24]]) part(new THREE.SphereGeometry(0.028, 12, 8), 'eye', smile, p.clone().sub(mouthAt).toArray());
  // the yawn: an open "O", hidden until needed
  const yawnO = part(new THREE.TorusGeometry(0.075, 0.026, 8, 24), 'eye', head, S(0, -0.24, 1.03).toArray());
  yawnO.rotation.x = 0.24;
  yawnO.visible = false;

  for (const d of [-0.33, 0.33]) {
    const rho = Math.sqrt(1 - d * d), pts = [];
    for (let t = Math.asin(0.5 / rho); t <= Math.PI + 0.5; t += 0.05) {
      pts.push(new THREE.Vector3(d, rho * Math.sin(t), rho * Math.cos(t)).multiply(HEAD));
    }
    part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.02, 6), 'line', head);
  }

  const podProfile = [[0, 0], [0.3, 0], [0.34, 0.03], [0.34, 0.13], [0.3, 0.16], [0.23, 0.16], [0.22, 0.2], [0.19, 0.24], [0, 0.25]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  for (const s of [-1, 1]) {
    const pod = part(new THREE.LatheGeometry(podProfile, 40), 'silver', head, [s * 1.08, -0.02, 0]);
    pod.rotation.z = -s * Math.PI / 2;
  }

  part(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'silver', head, [0, 0.97, 0]);
  part(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 12), 'silver', head, [0, 1.3, 0]);
  const antenna = part(new THREE.SphereGeometry(0.15, 24, 16), 'antenna', head, [0, 1.62, 0]);
  part(new THREE.SphereGeometry(0.045, 10, 8), 'hilite', antenna, [-0.06, 0.07, 0.11]);

  // chest shield: gold plate, teal inset, raised $ — bent to follow the belly
  const shieldShape = new THREE.Shape();
  shieldShape.moveTo(0, -0.5);
  shieldShape.lineTo(0.5, 0.02);
  shieldShape.lineTo(0.36, 0.28);
  shieldShape.lineTo(-0.36, 0.28);
  shieldShape.lineTo(-0.5, 0.02);
  shieldShape.closePath();
  const bend = (geo) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setZ(i, p.getZ(i) - p.getX(i) ** 2 * 0.85 - Math.max(0, p.getY(i)) ** 2 * 1.0 - Math.min(0, p.getY(i)) ** 2 * 0.25);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const emblem = new THREE.Group();
  emblem.position.set(0, BODY_Y + 0.17, 0.73);
  emblem.scale.setScalar(1.22);
  pose.add(emblem);
  part(bend(new THREE.ExtrudeGeometry(shieldShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3 })), 'goldDark', emblem);
  part(bend(new THREE.ExtrudeGeometry(shieldShape, { depth: 0.03, bevelEnabled: false }).scale(0.8, 0.8, 1)), 'teal', emblem, [0, 0.015, 0.06]);
  const dollar = new TextGeometry('$', { font: DOLLAR_FONT, size: 0.42, depth: 0.05, curveSegments: 10,
    bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 });
  dollar.center();
  part(bend(dollar), 'gold', emblem, [0, -0.03, 0.12]);

  // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> fist
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.72, 1.55, 0.05);
    pose.add(shoulder);
    part(new THREE.SphereGeometry(0.19, 20, 14), 'white', shoulder);
    part(new THREE.CapsuleGeometry(0.16, 0.25, 6, 16), 'white', shoulder, [0, -0.24, 0]);
    const elbow = new THREE.Group();
    elbow.position.y = -0.44;
    shoulder.add(elbow);
    part(new THREE.TorusGeometry(0.165, 0.02, 8, 24), 'line', elbow).rotation.x = Math.PI / 2;
    part(new THREE.CapsuleGeometry(0.165, 0.2, 6, 16), 'white', elbow, [0, -0.17, 0]);
    part(new THREE.TorusGeometry(0.17, 0.035, 8, 24), 'silver', elbow, [0, -0.33, 0]).rotation.x = Math.PI / 2;
    const fist = new THREE.Group();
    fist.position.y = -0.52;
    elbow.add(fist);
    part(new THREE.SphereGeometry(0.22, 20, 14), 'white', fist).scale.set(1, 0.92, 1);
    part(new THREE.SphereGeometry(0.085, 12, 8), 'white', fist, [-side * 0.07, 0.04, 0.18]);
    return { shoulder, elbow, fist };
  }
  const armUp = makeArm(1);     // CostBot's left: the "up, up and away" fist
  const armDown = makeArm(-1);

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.3, 0.45, 0);
    pose.add(hip);
    part(new THREE.CapsuleGeometry(0.21, 0.42, 6, 16), 'white', hip, [0, -0.35, 0]);
    part(new THREE.TorusGeometry(0.212, 0.018, 8, 24), 'line', hip, [0, -0.42, 0]).rotation.x = Math.PI / 2;
    return hip;
  });

  // cape: collar at the neck, sheet re-shaped each frame to trail behind and to his right
  part(new THREE.TorusGeometry(0.56, 0.08, 10, 40), 'cape', pose, [0, 1.85, -0.02]).rotation.x = Math.PI / 2 + 0.15;
  const CAPE_COLS = 29, CAPE_ROWS = 21;   // PlaneGeometry(1, 1, 28, 20) → 29×21 vertices, row 0 at the collar
  const capeGeo = new THREE.PlaneGeometry(1, 1, CAPE_COLS - 1, CAPE_ROWS - 1);
  const capeUV = capeGeo.attributes.uv;
  part(capeGeo, 'cape', pose);
  part(capeGeo, 'capeIn', pose);
  capeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -0.6), 2.6);   // it moves; never cull it
  const capeLine = part(new THREE.BufferGeometry(), 'capeLine', pose);
  capeLine.castShadow = false;
  capeLine.frustumCulled = false;
  function updateCape(t, billow) {
    const p = capeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = capeUV.getX(i) * 2 - 1, k = 1 - capeUV.getY(i);
      const th = u * (1.5 - 0.35 * k);
      const rk = Math.sqrt(k);
      const flutter = (Math.sin(t * 2.4 + k * 5 + u * 3) * 0.12 + Math.sin(t * 3.9 + u * 5) * 0.04) * k * billow;
      p.setXYZ(i,
        Math.sin(th) * (0.62 + 0.8 * rk + 0.75 * k) - k * k * 0.75 * billow,
        // scalloped hem, like the icon's cape
        1.85 - k * 2.1 + k * k * 0.4 * billow + Math.cos(u * Math.PI * 3.5) * 0.09 * k ** 3,
        -Math.cos(th) * (0.58 + 0.5 * rk) - k * k * 0.5 * billow + flutter);
    }
    p.needsUpdate = true;
    capeGeo.computeVertexNormals();
    // ink the cape's edge by hand: a thin sheet has no silhouette for OutlineEffect to find
    if (capeLine.visible && capeLine.material.visible) {
      const pts = [];
      const at = (col, row) => new THREE.Vector3().fromBufferAttribute(p, row * CAPE_COLS + col);
      for (let r = 0; r < CAPE_ROWS; r++) pts.push(at(0, r));
      for (let c = 1; c < CAPE_COLS; c++) pts.push(at(c, CAPE_ROWS - 1));
      for (let r = CAPE_ROWS - 2; r >= 0; r--) pts.push(at(CAPE_COLS - 1, r));
      capeLine.geometry.dispose();
      capeLine.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.035, 5, false);
    }
  }

  // ---- outfit gear (hidden until an outfit asks for it) ----
  const gear = {};
  const hatAt = (g) => { g.position.set(0, 0.78, -0.05); g.rotation.x = -0.12; head.add(g); g.visible = false; return g; };

  gear.fedora = hatAt(new THREE.Group());
  part(new THREE.CylinderGeometry(1.2, 1.2, 0.05, 40), 'felt', gear.fedora);
  part(new THREE.CylinderGeometry(0.66, 0.76, 0.5, 32), 'felt', gear.fedora, [0, 0.27, 0]);
  part(new THREE.CylinderGeometry(0.77, 0.77, 0.12, 32), 'black', gear.fedora, [0, 0.1, 0]);

  gear.witchhat = hatAt(new THREE.Group());
  part(new THREE.CylinderGeometry(1.3, 1.3, 0.05, 40), 'black', gear.witchhat);
  const cone = part(new THREE.ConeGeometry(0.72, 1.5, 32), 'black', gear.witchhat, [0.12, 0.78, -0.08]);
  cone.rotation.z = -0.22;
  part(new THREE.CylinderGeometry(0.72, 0.74, 0.14, 32), 'band', gear.witchhat, [0, 0.1, 0]);

  gear.santahat = hatAt(new THREE.Group());
  part(new THREE.TorusGeometry(0.85, 0.16, 12, 40), 'fluff', gear.santahat).rotation.x = Math.PI / 2;
  const sc = part(new THREE.ConeGeometry(0.85, 1.3, 32), 'red', gear.santahat, [0.18, 0.6, -0.15]);
  sc.rotation.z = -0.45;
  part(new THREE.SphereGeometry(0.2, 16, 12), 'fluff', gear.santahat, [0.62, 1.12, -0.3]);

  gear.scarf = new THREE.Group();
  pose.add(gear.scarf);
  gear.scarf.visible = false;
  part(new THREE.TorusGeometry(0.5, 0.13, 12, 40), 'green', gear.scarf, [0, 1.8, 0.02]).rotation.x = Math.PI / 2 + 0.1;
  part(new THREE.BoxGeometry(0.22, 0.6, 0.08), 'green', gear.scarf, [0.28, 1.5, 0.52]).rotation.z = 0.15;

  // magnifying glass in the down hand
  gear.magnifier = new THREE.Group();
  armDown.fist.add(gear.magnifier);
  gear.magnifier.visible = false;
  gear.magnifier.position.set(0, -0.05, 0.22);
  gear.magnifier.rotation.x = -0.6;
  part(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), 'felt', gear.magnifier, [0, 0.16, 0]);
  const lensRing = part(new THREE.TorusGeometry(0.24, 0.045, 10, 32), 'gold', gear.magnifier, [0, 0.6, 0]);
  lensRing.rotation.y = Math.PI / 2;
  const lens = part(new THREE.CircleGeometry(0.22, 32), 'glass', gear.magnifier, [0, 0.6, 0]);
  lens.rotation.y = Math.PI / 2;

  // the tablet for the idle "checking the numbers" bit
  const tablet = new THREE.Group();
  armDown.fist.add(tablet);
  tablet.visible = false;
  tablet.position.set(0.25, 0.05, 0.25);
  part(new THREE.BoxGeometry(0.62, 0.44, 0.04), 'black', tablet);
  part(new THREE.PlaneGeometry(0.56, 0.38), 'screen', tablet, [0, 0, 0.022]);

  // ---- behaviour ----
  let outfit = 'classic';
  let celebrate = 0, anticName = null, anticT = 0, anticDur = 0;
  let nextBlink = 2, blinkT = 0, billow = 1;
  const lerp = THREE.MathUtils.lerp;
  const ANTICS = { yawn: 2.6, tablet: 3.2, loop: 1.3, wave: 2.2 };

  function applyOutfit() {
    const o = OUTFITS.find((x) => x.id === outfit) || OUTFITS[0];
    for (const set of Object.values(SETS)) {
      for (const [k, m] of Object.entries(set)) {
        if (!m.color || BASE[k] == null || k === 'screen') continue;
        m.color.setHex((o.colors && o.colors[k] != null) ? o.colors[k] : BASE[k]);
        if (m.emissive && (k === 'eye' || k === 'antenna')) m.emissive.setHex((o.colors && o.colors[k]) || (k === 'eye' ? 0x19c8f0 : PAL.antenna));
      }
      if (set.white.metalness != null && set === SETS.glossy) {
        set.white.metalness = o.metal ? 0.9 : 0.05;
        set.white.roughness = o.metal ? 0.22 : 0.3;
      }
    }
    for (const [name, g] of Object.entries(gear)) g.visible = !!(o.gear && o.gear.includes(name));
  }

  const api = {
    root, pose, head, emblem, eyes, antenna, armUp, armDown, legs,
    get outfit() { return outfit; },
    get style() { return current; },
    get busy() { return celebrate > 0 || !!anticName; },
    setStyle(s) {
      if (!SETS[s]) return;
      current = s;
      root.traverse((o) => { if (o.userData.slot) o.material = SETS[s][o.userData.slot]; });
    },
    setOutfit(id) { outfit = OUTFITS.some((o) => o.id === id) ? id : 'classic'; applyOutfit(); },
    cheer() { celebrate = 1.6; anticName = null; tablet.visible = false; yawnO.visible = false; smile.visible = true; },
    antic(name) {
      if (!ANTICS[name] || celebrate > 0) return 0;
      anticName = name; anticT = 0; anticDur = ANTICS[name];
      return anticDur;
    },
    /* opts: lookX/lookY in -1..1 (head turn), billow multiplier (speed), still (no hover bob),
     baseY (hover height), leanX/leanZ (extra pitch/bank in radians) */
    update(t, dt, opts = {}) {
      celebrate = Math.max(0, celebrate - dt);
      const party = celebrate > 0;
      const since = 1.6 - celebrate;
      if (anticName) { anticT += dt; if (anticT >= anticDur) anticName = null; }
      const a = anticName, p = a ? anticT / anticDur : 0;
      const env = a ? Math.min(1, p * 5, (1 - p) * 5) : 0;     // ease in / out of the bit

      const hop = party && since < 0.6 ? Math.sin(since / 0.6 * Math.PI) * 0.6 : 0;
      root.position.y = (opts.baseY || 0) + (opts.still ? 0 : Math.sin(t * 1.6) * 0.1) + hop;
      pose.rotation.set(REST.x, (party && since < 0.6 ? since / 0.6 * Math.PI * 2 : 0), REST.z);
      if (a === 'loop') pose.rotation.x = REST.x - (1 - Math.cos(p * Math.PI)) * Math.PI;
      pose.rotation.x += opts.leanX || 0;     // cabinets lean him into the flight
      pose.rotation.z += opts.leanZ || 0;     // and bank him into turns

      let lookX = opts.lookX || 0, lookY = opts.lookY || 0;
      if (a === 'tablet') { lookX = 0.25; lookY = -0.55 * env; }
      if (a === 'yawn') lookY = 0.35 * env;
      if (a === 'wave') { lookX = -0.2; lookY = 0.1; }
      head.rotation.y = lerp(head.rotation.y, lookX * 0.45, 0.08);
      head.rotation.x = lerp(head.rotation.x, -lookY * 0.3, 0.08);
      head.rotation.z = lerp(head.rotation.z, a === 'yawn' ? 0.12 * env : 0, 0.08);

      const waving = a === 'wave';
      armUp.shoulder.rotation.z = lerp(armUp.shoulder.rotation.z,
        waving ? 2.55 + Math.sin(anticT * 11) * 0.38 * env
          : (a === 'yawn' ? 2.9 : 2.0) + Math.sin(t * (party ? 12 : 2)) * (party ? 0.2 : 0.05), 0.2);
      armUp.elbow.rotation.z = lerp(armUp.elbow.rotation.z, a === 'yawn' ? 0.2 : waving ? 0.35 : 0.8, 0.1);
      armUp.shoulder.rotation.x = -0.35;
      let dz = party ? -2.2 : -0.45, dx = party ? 0 : -0.25, ex = party ? 0 : -1.0 + Math.sin(t * 1.6) * 0.08;
      if (a === 'tablet') { dz = -0.35; dx = -0.9 * env; ex = -1.25; }
      if (a === 'yawn') { dz = -0.2; dx = -1.6 * env; ex = -2.0 * env - 1.0 * (1 - env); }   // hand to mouth
      armDown.shoulder.rotation.z = lerp(armDown.shoulder.rotation.z, dz, 0.12);
      armDown.shoulder.rotation.x = lerp(armDown.shoulder.rotation.x, dx, 0.12);
      armDown.elbow.rotation.x = lerp(armDown.elbow.rotation.x, ex, 0.12);
      tablet.visible = a === 'tablet' && env > 0.3;
      legs.forEach((leg, i) => {
        leg.rotation.x = 0.4 + Math.sin(t * 2 + i * 1.3) * 0.1;
        leg.rotation.z = (i ? 1 : -1) * 0.08;
      });

      nextBlink -= dt;
      if (nextBlink < 0) { blinkT = 0.14; nextBlink = 2 + Math.random() * 3; }
      blinkT = Math.max(0, blinkT - dt);
      let eyeY = party ? 0.4 : blinkT > 0 ? 0.1 : 1;
      if (a === 'yawn') eyeY = 1 - 0.8 * env;
      if (a === 'tablet') eyeY = 0.8;
      for (const e of eyes) e.scale.y = lerp(e.scale.y, eyeY, 0.35);
      yawnO.visible = a === 'yawn' && env > 0.4;
      smile.visible = !yawnO.visible;

      antenna.scale.setScalar(1 + Math.sin(t * 4) * 0.06 + (party ? 0.15 : 0));
      billow = lerp(billow, (party ? 1.8 : 1) * (opts.billow || 1), 0.05);
      updateCape(t, billow);
    },
  };
  applyOutfit();
  return api;
}

/* A spinning gold token, shared by the 3D cabinets. */
export function makeCoinFactory() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2b40c'; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b07a00'; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
  g.font = 'bold 160px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffe07a'; g.fillText('$', 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2;   // cylinder cap UVs run sideways; stand the $ upright
  const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 40).rotateX(Math.PI / 2);
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0xf7bd1c, metalness: 1, roughness: 0.22, emissive: 0x3a2600 }),
    new THREE.MeshStandardMaterial({ map: tex, metalness: 0.85, roughness: 0.3, emissive: 0x2a1c00 }),
  ];
  const faces = [mats[0], mats[1], mats[1]];
  return () => new THREE.Mesh(geo, faces);
}
