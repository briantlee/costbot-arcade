/* ============================================================================
 * CostBot Arcade — CostBot in 3D
 * ----------------------------------------------------------------------------
 * The flying-superhero CostBot as a three.js model, shared by every 3D cabinet
 * (and the Cost Intelligence Hub mascot). ES module; the page maps `three`:
 *
 *   import { createCostBot, OUTFITS } from '../shared/costbot-3d.js';
 *   const bot = createCostBot({ style: 'glossy' });   // or 'cartoon'
 *   scene.add(bot.root);
 *   bot.setOutfit('detective');   // or any OUTFITS id; `season` marks the holiday ones
 *   bot.setMood('zen');           // face + body language, see MOODS ('happy' is the default)
 *   bot.setScreen('$19.3M');      // what the tablet shows during the 'tablet' antic
 *   bot.showGear('magnifier', true);   // hold a prop on top of whatever the outfit wears
 *   bot.cheer();                  // hop, spin, fist pumps (~1.6s)
 *   bot.antic('yawn');            // idle bits: 'yawn' | 'tablet' | 'loop' | 'wave' | 'dizzy'
 *   bot.antic('boogie');          // dances (~4s): boogie, robot, disco, ymca, twist, sprinkler, floss,
 *                                 // moonwalk, pirouette, dab, chicken — see DANCES
 *   bot.setInspect(true);         // magnifier out and up to his visor (inspecting something)
 *   // every frame:
 *   bot.update(t, dt, { lookX, lookY });
 *
 * Proportions follow the sculpt refs: the head is ~1.4x the belly's width, the
 * visor is a rounded rectangle wrapped onto the helmet, the shield covers most of
 * the chest. 'cartoon' is toon shading with outlines (pair it with OutlineEffect)
 * and matches the flat icon; 'glossy' is plastic-and-metal and suits bloom.
 * ==========================================================================*/
import * as THREE from 'three';

const PAL = {
  white: 0xe2edf7, body: 0xc4d4e6, silver: 0xc2cfdd, line: 0x0d1b3a, visor: 0x122a52, eye: 0x8fe3ee,
  antenna: 0x2c8fa6, gold: 0xf4b41a, goldDark: 0xeaa716, teal: 0x1f8a8c, cape: 0x2f6bd0, capeIn: 0x1d4fa0,
};

/* Outfits recolour slots and switch accessories on. `unlock` is how a player
 * gets one — a token price, or an easter-egg code the cabinet listens for. (Not called 'secret':
 * the security scanner reads any value on a key named secret as a hardcoded credential.) */
export const OUTFITS = [
  { id: 'classic', label: 'Classic', unlock: { tokens: 0 } },
  { id: 'detective', label: 'Anomaly Detective', unlock: { tokens: 150 },
    colors: { cape: 0xa8844f, capeIn: 0x6e5431 }, gear: ['fedora', 'magnifier'] },
  { id: 'halloween', label: 'Spooky Spend', unlock: { tokens: 250 }, season: 'halloween',
    colors: { cape: 0xf07a12, capeIn: 0x1a1024, eye: 0xffa53a, antenna: 0x6b2fa0 }, gear: ['witchhat'] },
  { id: 'holiday', label: 'Santa (Holiday Freeze)', unlock: { tokens: 250 }, season: 'xmas',
    colors: { cape: 0xc8202c, capeIn: 0x7e1119, antenna: 0xe8f4ff }, gear: ['santahat', 'scarf'] },
  { id: 'mega', label: 'Mega CostBot', unlock: { easterEgg: 'konami' },
    colors: { white: 0xf4c430, silver: 0xfff1b8, cape: 0xb3122e, capeIn: 0x6e0a1b, eye: 0xff5a4a, visor: 0x2a0d12 }, metal: true },
  { id: 'graviton', label: 'Graviton Green', unlock: { easterEgg: 'graviton' },
    colors: { white: 0x9bd94a, silver: 0x5f9e2a, cape: 0x1f5e2a, capeIn: 0x113a19, eye: 0xd6ff5c, antenna: 0x76b900 } },
  // ---- the holiday wardrobe: `season` is a calendar key the host maps to dates (the Hub mascot
  // wears them automatically in season); here they are simply more outfits to buy ----
  { id: 'reindeer', label: 'Rudolph Mode', unlock: { tokens: 250 }, season: 'xmas',
    colors: { white: 0x9a6a3f, silver: 0x6e4a2a, cape: 0xc8202c, capeIn: 0x7e1119, antenna: 0xe0202c }, gear: ['antlers', 'rednose'] },
  { id: 'snowman', label: 'Frosty Forecast', unlock: { tokens: 250 }, season: 'xmas',
    colors: { white: 0xf7fbff, silver: 0xdfe9f3, cape: 0x7fc6ea, capeIn: 0x3f8fc0, antenna: 0x1d1a24 }, gear: ['tophat', 'carrot', 'scarfRed'] },
  { id: 'elf', label: 'Budget Elf', unlock: { tokens: 250 }, season: 'xmas',
    colors: { cape: 0x1f7a3a, capeIn: 0xc8202c, antenna: 0xf4c430 }, gear: ['elfhat'] },
  { id: 'gingerbread', label: 'Gingerbread Bot', unlock: { tokens: 250 }, season: 'xmas',
    colors: { white: 0xb8733a, silver: 0xf2ead8, cape: 0xc8202c, capeIn: 0x2f8a3a, antenna: 0xff4f7a }, gear: ['gumdrops'] },
  { id: 'hanukkah', label: 'Hanukkah Glow', unlock: { tokens: 250 }, season: 'hanukkah',
    colors: { cape: 0x1f4fbf, capeIn: 0xdfe8f7, antenna: 0x9fc4ff, eye: 0xbfe3ff }, gear: ['scarfBlue'] },
  { id: 'newyear', label: 'New Year’s Eve', unlock: { tokens: 250 }, season: 'newyear',
    colors: { cape: 0x1b1b3a, capeIn: 0xd4af37, antenna: 0xf4c430 }, gear: ['partyhat'] },
  { id: 'lunar', label: 'Lunar New Year', unlock: { tokens: 250 }, season: 'lunar',
    colors: { white: 0xd8262e, silver: 0xf4c430, cape: 0xf4b41a, capeIn: 0xa3161c, antenna: 0xf4c430 }, gear: ['lantern'] },
  { id: 'valentine', label: 'Be Mine', unlock: { tokens: 250 }, season: 'valentine',
    colors: { cape: 0xff5c8a, capeIn: 0xc2185b, antenna: 0xff4f7a, eye: 0xff9ab8 }, gear: ['heartband'] },
  { id: 'stpatrick', label: 'Lucky Leprechaun', unlock: { tokens: 250 }, season: 'stpatrick',
    colors: { cape: 0x1f8a3a, capeIn: 0x0f5a24, antenna: 0x3ccf5a }, gear: ['leprechaun'] },
  { id: 'easter', label: 'Egg Hunter', unlock: { tokens: 250 }, season: 'easter',
    colors: { cape: 0xb9a6f0, capeIn: 0x8fd6c6, antenna: 0xffb3d6 }, gear: ['bunnyears'] },
  { id: 'july4', label: 'Stars & Stripes', unlock: { tokens: 250 }, season: 'july4',
    colors: { cape: 0x2548a8, capeIn: 0xc8202c, antenna: 0xc8202c }, gear: ['unclesam'] },
  { id: 'vampire', label: 'Count Costula', unlock: { tokens: 250 }, season: 'halloween',
    colors: { white: 0xdfe3ea, cape: 0x121016, capeIn: 0xb3122e, eye: 0xff3b3b, antenna: 0xb3122e }, gear: ['collar'] },
  { id: 'pumpkin', label: 'Pumpkin Patch', unlock: { tokens: 250 }, season: 'halloween',
    colors: { white: 0xf07a12, silver: 0x3f8f2a, cape: 0x3b2a1a, capeIn: 0xf4a53a, eye: 0xffd24a, antenna: 0x3f8f2a } },
  { id: 'diwali', label: 'Festival of Lights', unlock: { tokens: 250 }, season: 'diwali',
    colors: { cape: 0xd81b60, capeIn: 0xf4b41a, antenna: 0xffb300, eye: 0xffd54f }, gear: ['diya'] },
  { id: 'thanksgiving', label: 'Pilgrim Saver', unlock: { tokens: 250 }, season: 'thanksgiving',
    colors: { cape: 0x8a4b1f, capeIn: 0xd9822b, antenna: 0xd9822b }, gear: ['pilgrim'] },
];

/* Moods change the face and the body language, never the outfit. 'happy' is how he ships; the
 * rest are for fun. `eyes`: open | half | joy (^ ^) | closed (◡ ◡) | heart; `mouth`: smile | grin |
 * small | flat | frown | wobble; `brows`: angry | worried; bob/float/billow/pulse scale the idle motion. */
export const DANCES = ['boogie', 'robot', 'disco', 'ymca', 'twist', 'sprinkler', 'floss', 'moonwalk', 'pirouette', 'dab', 'chicken'];

export const MOODS = [
  { id: 'happy', label: 'Happy & helpful', icon: '😊', eyes: 'open', mouth: 'smile' },
  { id: 'excited', label: 'Excited', icon: '🤩', eyes: 'joy', mouth: 'grin', bob: 1.8, float: 1.4, billow: 1.4, pulse: 2.2 },
  { id: 'zen', label: 'Zen', icon: '😌', eyes: 'closed', mouth: 'small', bob: 0.55, float: 1.6, billow: 0.6, lookY: 0.12 },
  { id: 'smitten', label: 'Smitten', icon: '😍', eyes: 'heart', mouth: 'grin', bob: 0.8, sway: 0.12, pulse: 1.6 },
  { id: 'sleepy', label: 'Sleepy', icon: '😴', eyes: 'half', mouth: 'small', bob: 0.45, sag: 0.12, billow: 0.5, lookY: -0.22, tilt: 0.12, pulse: 0.4 },
  { id: 'grumpy', label: 'Grumpy', icon: '😤', eyes: 'open', mouth: 'frown', brows: 'angry', lookY: -0.12, armUp: 1.1 },
  { id: 'worried', label: 'Worried', icon: '😟', eyes: 'open', mouth: 'wobble', brows: 'worried', tremble: 0.025 },
];

const NO_OUTLINE = new Set(['line', 'visor', 'eye', 'cape', 'capeIn', 'screen', 'hilite', 'visorHi', 'capeLine', 'heart', 'flame']);
// OutlineEffect takes LINEAR rgb and does not convert it, so the icon's #0d1b3a navy has to be
// given pre-linearised — as sRGB numbers it renders a washed-out slate instead.
const INK = new THREE.Color(0x0d1b3a);
const OUTLINE = { thickness: 0.013, color: [INK.r, INK.g, INK.b] };

// Cel bands, shadow → mid → lit, as RGBA multipliers. The icon's shadows are a cool blue-gray
// rather than a darker grey, so the body's bands are tinted; everything else stays neutral so
// gold and cape shadows don't go muddy.
function makeGradient(bands) {
  const g = new THREE.DataTexture(new Uint8Array(bands.flatMap((b) => [...b, 255])), bands.length, 1, THREE.RGBAFormat);
  g.minFilter = g.magFilter = THREE.NearestFilter;
  g.needsUpdate = true;
  return g;
}
// three's toon shader reads only .r of the gradient; read .rgb so the bands can carry a tint
const tintedBands = (m) => {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <gradientmap_pars_fragment>',
      THREE.ShaderChunk.gradientmap_pars_fragment.replace('return vec3( texture2D( gradientMap, coord ).r );',
        'return texture2D( gradientMap, coord ).rgb;'));
  };
  m.customProgramCacheKey = () => 'costbot-tinted-bands';
  return m;
};

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 176;
  drawScreen(c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the tablet CostBot checks when he is bored: a tiny cost chart, trending down, and a headline figure
function drawScreen(c, headline = '-18%') {
  const g = c.getContext('2d');
  g.fillStyle = '#0b1733'; g.fillRect(0, 0, 256, 176);
  g.strokeStyle = '#2f4d80'; g.lineWidth = 2;
  for (let y = 30; y < 176; y += 36) { g.beginPath(); g.moveTo(16, y); g.lineTo(240, y); g.stroke(); }
  g.strokeStyle = '#4fe3ff'; g.lineWidth = 7; g.lineJoin = 'round';
  g.beginPath();
  [[16, 40], [60, 58], [100, 50], [140, 96], [180, 110], [240, 146]].forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.stroke();
  let px = 34;
  g.font = `bold ${px}px system-ui, sans-serif`;
  while (px > 16 && g.measureText(headline).width > 150) { px -= 2; g.font = `bold ${px}px system-ui, sans-serif`; }
  g.fillStyle = '#f4b41a'; g.textAlign = 'right'; g.fillText(headline, 240, 44); g.textAlign = 'left';
}

function materialSets() {
  const gradient = makeGradient([[118, 118, 118], [196, 196, 196], [255, 255, 255]]);
  const coolBands = makeGradient([[86, 118, 164], [176, 196, 224], [255, 255, 255]]);
  const toon = (color, o = {}) => tintedBands(new THREE.MeshToonMaterial({ color, gradientMap: gradient, toneMapped: false, ...o }));
  const toonBody = (color) => toon(color, { gradientMap: coolBands });
  const flat = (color, o = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...o });
  const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, ...o });
  const screen = screenTexture();
  const cartoon = {
    white: toonBody(PAL.white), body: toonBody(PAL.body), silver: toonBody(PAL.silver), line: flat(PAL.line), visor: toon(PAL.visor),
    eye: flat(PAL.eye), antenna: toon(PAL.antenna), gold: toon(PAL.gold), goldDark: toon(PAL.goldDark),
    teal: toon(PAL.teal), cape: toon(PAL.cape, { side: THREE.BackSide }), capeIn: toon(PAL.capeIn, { side: THREE.FrontSide }),
    felt: toon(0x5a3a22), black: toon(0x1d1a24), red: toon(0xc8202c), fluff: toon(0xffffff), band: toon(0x6b2fa0),
    green: toon(0x1f7a3a), glass: flat(0xbfefff, { transparent: true, opacity: 0.45 }), screen: flat(0xffffff, { map: screen }),
    blue: toon(0x2548a8), pink: toon(0xff6f9c), orange: toon(0xf07a12), brown: toon(0x7a4a26),
    redIn: toon(0xb3122e, { side: THREE.BackSide }), heart: flat(0xff4f7a), flame: flat(0xffc233),
    // icon-style shine and ink: flat white glints, a lighter band across the visor, the cape's edge line
    hilite: flat(0xffffff, { transparent: true, opacity: 0.92 }), visorHi: flat(0x2b5391), capeLine: flat(0x0d1b3a),
  };
  for (const [k, m] of Object.entries(cartoon)) {
    m.userData.outlineParameters = NO_OUTLINE.has(k) || k === 'glass' ? { visible: false } : OUTLINE;
  }
  const glossy = {
    white: phys(PAL.white, { metalness: 0.05 }), body: phys(PAL.white, { metalness: 0.05 }), silver: phys(PAL.silver, { metalness: 0.6 }),
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
    blue: phys(0x2548a8, { roughness: 0.6 }), pink: phys(0xff6f9c, { roughness: 0.5 }), orange: phys(0xf07a12, { roughness: 0.5 }),
    brown: phys(0x7a4a26, { roughness: 0.8, clearcoat: 0 }), redIn: phys(0xb3122e, { roughness: 0.6, side: THREE.BackSide }),
    heart: new THREE.MeshStandardMaterial({ color: 0xff4f7a, emissive: 0xff2d6a, emissiveIntensity: 1.1 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc233, toneMapped: false }),
    glass: phys(0xbfefff, { transparent: true, opacity: 0.35, roughness: 0.05 }),
    screen: new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }),
    // glossy gets real specular instead, so the painted-on bits hide
    hilite: new THREE.MeshBasicMaterial({ visible: false }), visorHi: new THREE.MeshBasicMaterial({ visible: false }),
    capeLine: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return { cartoon, glossy };
}

// The chest shield, painted at 1024px so it stays crisp up close. `f` is the texture frame in
// shield units (x across, y up); the shape is the icon's: flat top, clipped corners, short point.
function shieldTexture(f) {
  const W = 1024, k = W / (f.x1 - f.x0), H = Math.round((f.y1 - f.y0) * k);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (x) => (x - f.x0) * k, Y = (y) => (f.y1 - y) * k;
  const OUTER = [[-0.36, 0.26], [0.36, 0.26], [0.5, 0.05], [0, -0.38], [-0.5, 0.05]];
  const inset = (s, dy) => OUTER.map(([x, y]) => [x * s, y * s + dy]);
  const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => { if (i) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y)); }); g.closePath(); };
  const INK = '#0d1b3a';
  g.lineJoin = 'round'; g.lineCap = 'round';
  // ink + gold rim
  path(OUTER);
  g.lineWidth = 0.075 * k; g.strokeStyle = INK; g.stroke();
  const gold = g.createLinearGradient(0, Y(0.26), 0, Y(-0.38));
  gold.addColorStop(0, '#ffc93a'); gold.addColorStop(0.55, '#f4b41a'); gold.addColorStop(1, '#e09a10');
  g.fillStyle = gold; g.fill();
  // teal inset with a lighter facet on the upper left, inked at its edge
  const IN = inset(0.72, 0.012);
  path(IN);
  const teal = g.createLinearGradient(0, Y(0.2), 0, Y(-0.27));
  teal.addColorStop(0, '#249aa0'); teal.addColorStop(1, '#146a72');
  g.fillStyle = teal; g.fill();
  g.save(); g.clip();
  g.beginPath(); g.moveTo(X(IN[0][0]), Y(IN[0][1])); g.lineTo(X(0), Y(IN[0][1])); g.lineTo(X(-0.02), Y(-0.08)); g.lineTo(X(IN[4][0]), Y(IN[4][1])); g.closePath();
  g.fillStyle = 'rgba(120,220,220,.22)'; g.fill();
  g.restore();
  path(IN); g.lineWidth = 0.028 * k; g.strokeStyle = INK; g.stroke();
  // the $ — chunky, gold, inked
  g.font = `900 ${Math.round(0.56 * k)}px "Arial Black","Segoe UI Black","Helvetica Neue",system-ui,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const dx = X(0), dy = Y(-0.02);
  g.lineWidth = 0.05 * k; g.strokeStyle = INK; g.strokeText('$', dx, dy);
  const dg = g.createLinearGradient(0, dy - 0.22 * k, 0, dy + 0.22 * k);
  dg.addColorStop(0, '#ffd24a'); dg.addColorStop(1, '#eea514');
  g.fillStyle = dg; g.fillText('$', dx, dy);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createCostBot({ style = 'glossy', shadows = true } = {}) {
  const SETS = materialSets();
  const BASE = {};
  for (const s of Object.values(SETS)) for (const [k, m] of Object.entries(s)) if (m.color) BASE[k] = BASE[k] || m.color.getHex();
  BASE.body = PAL.body;
  const shade = (hex) => new THREE.Color(hex).multiplyScalar(0.92).getHex();   // outfit body: a touch under the helmet
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
  part(new THREE.LatheGeometry(bodyPts, 48), 'body', pose, [0, BODY_Y, 0]).scale.z = BODY_Z;
  // the belly line: just under the shield's point and heavy, as on the icon (it used to sit down by
  // the hips, where the legs hid it)
  const WAIST_Y = -0.2;
  const waist = part(new THREE.TorusGeometry(bodyR(WAIST_Y) + 0.004, 0.026, 8, 64), 'line', pose, [0, BODY_Y + WAIST_Y, 0]);
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

  // ---- mood faces: the other mouths, eye shapes and brows, all hidden until a mood asks ----
  const faceLine = (pts, parent = head) => {
    const at = pts[Math.floor(pts.length / 2)].clone();
    const g = new THREE.Group();
    g.position.copy(at);
    parent.add(g);
    part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => p.clone().sub(at))), 48, 0.026, 8), 'eye', g);
    for (const p of [pts[0], pts[pts.length - 1]]) part(new THREE.SphereGeometry(0.026, 12, 8), 'eye', g, p.clone().sub(at).toArray());
    g.visible = false;
    return g;
  };
  const curve = (w, f, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const u = -1 + 2 * i / n; return S(u * w, f(u), 1.03); });
  const mouths = {
    smile,
    grin: faceLine(curve(0.23, (u) => -0.28 + 0.12 * u * u)),
    small: faceLine(curve(0.1, (u) => -0.235 + 0.022 * u * u)),
    flat: faceLine(curve(0.12, () => -0.23)),
    frown: faceLine(curve(0.14, (u) => -0.2 - 0.035 * u * u)),
    wobble: faceLine(curve(0.15, (u) => -0.225 + 0.016 * Math.sin(u * Math.PI * 2.5))),
  };
  const arcs = (f) => eyes.map((e, i) => faceLine(Array.from({ length: 17 }, (_, k) => {
    const u = -1 + k / 8; return S((i ? 0.3 : -0.3) + u * 0.075, f(u), 1.03);
  })));
  const joyEyes = arcs((u) => 0.05 + 0.06 * (1 - u * u));      // ^ ^
  const closedEyes = arcs((u) => 0.09 - 0.05 * (1 - u * u));   // ◡ ◡
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.5);
  heartShape.bezierCurveTo(-0.15, -0.3, -0.62, -0.05, -0.5, 0.25);
  heartShape.bezierCurveTo(-0.4, 0.55, -0.05, 0.55, 0, 0.25);
  heartShape.bezierCurveTo(0.05, 0.55, 0.4, 0.55, 0.5, 0.25);
  heartShape.bezierCurveTo(0.62, -0.05, 0.15, -0.3, 0, -0.5);
  const heartGeo = new THREE.ShapeGeometry(heartShape, 12);
  const onFace = (m, lon, lat, lift = 1.035) => {
    m.position.copy(S(lon, lat, lift));
    const n = S(lon, lat, 1).divide(HEAD).divide(HEAD).normalize();    // the ellipsoid's surface normal
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    return m;
  };
  const heartEyes = [-0.3, 0.3].map((lon) => {
    const m = onFace(part(heartGeo, 'heart', head), lon, 0.07);
    m.scale.setScalar(0.26); m.visible = false;
    return m;
  });
  const brow = (inner, outer) => [-1, 1].map((s) => faceLine([0, 1, 2, 3, 4].map((k) => {
    const u = k / 4; return S(s * (0.19 + u * 0.2), inner + (outer - inner) * u, 1.03);
  })));
  const brows = { angry: brow(0.17, 0.235), worried: brow(0.235, 0.18) };

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

  // chest shield: painted like the icon's — navy ink, gold rim, teal inset, bold outlined $ —
  // as one crisp texture on a grid wrapped onto the belly. Built from extruded slabs it gave
  // OutlineEffect a dozen hard edges to trace and came out cracked, with a doubled-looking $.
  // Proportions follow the 2D icon: ~0.46 of the head's width, ~1.6 wide to 1 tall.
  const SH_W = 1.12, SH_TOP = 1.62;                  // world width, top edge just under the collar
  const SHIELD = { x0: -0.56, x1: 0.56, y0: -0.44, y1: 0.32 };   // texture frame, in shield units
  const shieldK = SH_W / (SHIELD.x1 - SHIELD.x0);    // shield units -> world
  const shieldCY = SH_TOP - 0.26 * shieldK;
  const emblemMap = shieldTexture(SHIELD);
  SETS.cartoon.emblem = new THREE.MeshBasicMaterial({ map: emblemMap, transparent: true, alphaTest: 0.04, toneMapped: false });
  SETS.cartoon.emblem.userData.outlineParameters = { visible: false };   // it carries its own ink
  SETS.glossy.emblem = new THREE.MeshPhysicalMaterial({ map: emblemMap, transparent: true, alphaTest: 0.04,
    roughness: 0.28, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const decalGeo = new THREE.PlaneGeometry((SHIELD.x1 - SHIELD.x0) * shieldK, (SHIELD.y1 - SHIELD.y0) * shieldK, 48, 36);
  { // wrap the grid onto the belly: z is the lathe's actual surface at each (x, y), plus a hair
    const p = decalGeo.attributes.position;
    const yMid = shieldCY + ((SHIELD.y1 + SHIELD.y0) / 2) * shieldK;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + yMid;
      const R = bodyR(y - BODY_Y);
      p.setXYZ(i, x, y, Math.sqrt(Math.max(0, R * R - x * x)) * BODY_Z + 0.012);
    }
    decalGeo.computeVertexNormals();
  }
  part(decalGeo, 'emblem', pose).castShadow = false;
  // a handle at the shield's centre for callers that burst things out of the chest
  const emblem = new THREE.Object3D();
  emblem.position.set(0, shieldCY, bodyR(shieldCY - BODY_Y) * BODY_Z);
  pose.add(emblem);

  // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> fist
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.72, 1.55, 0.05);
    pose.add(shoulder);
    part(new THREE.SphereGeometry(0.19, 20, 14), 'body', shoulder);
    part(new THREE.CapsuleGeometry(0.16, 0.25, 6, 16), 'body', shoulder, [0, -0.24, 0]);
    const elbow = new THREE.Group();
    elbow.position.y = -0.44;
    shoulder.add(elbow);
    part(new THREE.TorusGeometry(0.165, 0.02, 8, 24), 'line', elbow).rotation.x = Math.PI / 2;
    part(new THREE.CapsuleGeometry(0.165, 0.2, 6, 16), 'body', elbow, [0, -0.17, 0]);
    part(new THREE.TorusGeometry(0.17, 0.035, 8, 24), 'silver', elbow, [0, -0.33, 0]).rotation.x = Math.PI / 2;
    const fist = new THREE.Group();
    fist.position.y = -0.52;
    elbow.add(fist);
    part(new THREE.SphereGeometry(0.22, 20, 14), 'body', fist).scale.set(1, 0.92, 1);
    part(new THREE.SphereGeometry(0.085, 12, 8), 'body', fist, [-side * 0.07, 0.04, 0.18]);
    return { shoulder, elbow, fist };
  }
  const armUp = makeArm(1);     // CostBot's left: the "up, up and away" fist
  const armDown = makeArm(-1);

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.3, 0.45, 0);
    pose.add(hip);
    part(new THREE.CapsuleGeometry(0.21, 0.42, 6, 16), 'body', hip, [0, -0.35, 0]);
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

  // ---- holiday gear ----
  const onHead = (pos = [0, 0, 0]) => { const g = new THREE.Group(); g.position.set(...pos); head.add(g); g.visible = false; return g; };
  const inHand = () => { const g = new THREE.Group(); armDown.fist.add(g); g.visible = false; return g; };
  const makeScarf = (slot) => {
    const g = new THREE.Group(); pose.add(g); g.visible = false;
    part(new THREE.TorusGeometry(0.5, 0.13, 12, 40), slot, g, [0, 1.8, 0.02]).rotation.x = Math.PI / 2 + 0.1;
    part(new THREE.BoxGeometry(0.22, 0.6, 0.08), slot, g, [0.28, 1.5, 0.52]).rotation.z = 0.15;
    return g;
  };
  const topHat = (brim, crown, band, h = 0.9, taper = 0) => {
    const g = hatAt(new THREE.Group());
    part(new THREE.CylinderGeometry(1.05, 1.05, 0.05, 40), brim, g);
    part(new THREE.CylinderGeometry(0.62 - taper, 0.66, h, 32), crown, g, [0, h / 2, 0]);
    part(new THREE.CylinderGeometry(0.67, 0.67, 0.16, 32), band, g, [0, 0.12, 0]);
    return g;
  };
  const star = (r = 0.12) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.42 : r;
      if (i) sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false });
  };

  gear.scarfRed = makeScarf('red');
  gear.scarfBlue = makeScarf('blue');

  // Christmas: antlers + a glowing nose (the antenna slot, so it glows red in 'glossy'), a snowman's
  // top hat and carrot, an elf hat with a bell, gumdrop buttons
  gear.antlers = onHead([0, 0.72, -0.05]);
  for (const s of [-1, 1]) {
    const beam = part(new THREE.CylinderGeometry(0.05, 0.075, 1.15, 8), 'brown', gear.antlers, [s * 0.5, 0.42, 0]);
    beam.rotation.z = -s * 0.6;
    for (const [y, len, rz] of [[0.1, 0.5, 0.35], [0.45, 0.42, 0.1], [0.8, 0.3, -0.2]]) {
      const tine = part(new THREE.CylinderGeometry(0.035, 0.05, len, 8), 'brown', gear.antlers, [s * (0.3 + y * 0.55 + 0.05), 0.2 + y * 0.4 + len * 0.45, 0]);
      tine.rotation.z = s * rz;
    }
  }
  gear.rednose = onHead();
  part(new THREE.SphereGeometry(0.11, 20, 14), 'antenna', gear.rednose, S(0, -0.08, 1.06).toArray());
  gear.tophat = topHat('black', 'black', 'red');
  gear.carrot = onHead();
  const carrotDir = new THREE.Vector3(0.75, -0.1, 1).normalize();
  const carrot = part(new THREE.ConeGeometry(0.09, 0.7, 16), 'orange', gear.carrot, S(0, -0.07, 1.02).addScaledVector(carrotDir, 0.35).toArray());
  carrot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), carrotDir);
  gear.elfhat = hatAt(new THREE.Group());
  part(new THREE.TorusGeometry(0.8, 0.12, 12, 40), 'red', gear.elfhat).rotation.x = Math.PI / 2;
  const elfCone = part(new THREE.ConeGeometry(0.8, 1.6, 32), 'green', gear.elfhat, [0.35, 0.55, -0.1]);
  elfCone.rotation.z = -0.9;
  part(new THREE.SphereGeometry(0.13, 16, 12), 'gold', gear.elfhat, [0.98, 1.05, -0.1]);
  gear.gumdrops = new THREE.Group(); pose.add(gear.gumdrops); gear.gumdrops.visible = false;
  [['red', 0.86], ['green', 0.64]].forEach(([slot, y]) => {     // down the belly, under the shield
    part(new THREE.SphereGeometry(0.1, 14, 10), slot, gear.gumdrops, [0.05, y, bodyR(y - BODY_Y) * BODY_Z + 0.02]);
  });

  // New Year's party hat, a lunar-new-year lantern, Valentine's heart boppers
  gear.partyhat = hatAt(new THREE.Group());
  const ph = part(new THREE.ConeGeometry(0.55, 1.35, 32), 'gold', gear.partyhat, [0.18, 0.62, 0]);
  ph.rotation.z = -0.22;
  part(new THREE.TorusGeometry(0.55, 0.07, 8, 32), 'pink', gear.partyhat, [0.03, 0.02, 0]).rotation.set(Math.PI / 2, 0.22, 0);
  for (const y of [0.35, 0.7]) part(new THREE.TorusGeometry(0.55 * (1 - y / 1.35) + 0.01, 0.035, 6, 32), 'pink', gear.partyhat, [0.18 + (y - 0.675) * 0.22 * -1, 0.62 + (y - 0.675), 0]).rotation.set(Math.PI / 2, 0.22, 0);
  part(new THREE.SphereGeometry(0.16, 14, 10), 'fluff', gear.partyhat, [0.33, 1.28, 0]);
  gear.lantern = inHand();
  part(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), 'gold', gear.lantern, [0, -0.2, 0.2]);
  part(new THREE.SphereGeometry(0.3, 20, 14), 'red', gear.lantern, [0, -0.6, 0.2]).scale.y = 0.85;
  for (const y of [-0.36, -0.84]) part(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 16), 'gold', gear.lantern, [0, y, 0.2]);
  part(new THREE.CylinderGeometry(0.02, 0.06, 0.26, 8), 'gold', gear.lantern, [0, -1.0, 0.2]);
  gear.heartband = onHead([0, 0.9, 0]);
  for (const s of [-1, 1]) {
    const spring = part(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), 'black', gear.heartband, [s * 0.36, 0.22, 0]);
    spring.rotation.z = -s * 0.35;
    const h = part(new THREE.ExtrudeGeometry(heartShape, { depth: 0.08, bevelEnabled: false }), 'pink', gear.heartband, [s * 0.46, 0.52, -0.04]);
    h.scale.setScalar(0.34);
  }

  // St Patrick's top hat, Easter ears, a Fourth of July hat
  gear.leprechaun = topHat('green', 'green', 'black', 0.8);
  part(new THREE.BoxGeometry(0.26, 0.2, 0.04), 'gold', gear.leprechaun, [0, 0.12, 0.67]);
  part(new THREE.BoxGeometry(0.15, 0.1, 0.05), 'green', gear.leprechaun, [0, 0.12, 0.68]);
  gear.bunnyears = onHead([0, 0.85, -0.05]);
  for (const s of [-1, 1]) {
    const ear = part(new THREE.SphereGeometry(1, 20, 14), 'fluff', gear.bunnyears, [s * 0.3, 0.5, 0]);
    ear.scale.set(0.15, 0.52, 0.08); ear.rotation.z = -s * 0.18;
    const inner = part(new THREE.SphereGeometry(1, 16, 12), 'pink', gear.bunnyears, [s * 0.3, 0.48, 0.05]);
    inner.scale.set(0.08, 0.4, 0.05); inner.rotation.z = -s * 0.18;
  }
  gear.unclesam = topHat('blue', 'fluff', 'blue', 1.0, 0.04);
  for (const y of [0.4, 0.62, 0.84]) part(new THREE.CylinderGeometry(0.63, 0.635, 0.08, 32), 'red', gear.unclesam, [0, y, 0]);
  part(star(0.1), 'gold', gear.unclesam, [0, 0.07, 0.67]);

  // Halloween vampire collar, a Diwali diya, a pilgrim hat
  gear.collar = new THREE.Group(); pose.add(gear.collar); gear.collar.visible = false;
  for (const [slot, r] of [['black', 0.02], ['redIn', 0]]) {
    // tall and flared wider than the helmet, so it frames his head from behind
    const c = part(new THREE.CylinderGeometry(1.8 + r, 0.7 + r, 1.7, 40, 1, true, Math.PI * 0.28, Math.PI * 1.44), slot, gear.collar, [0, 2.55, -0.15]);
    c.rotation.x = -0.12;
  }
  gear.diya = inHand();
  gear.diya.position.set(0.22, 0.1, 0.25);
  part(new THREE.SphereGeometry(0.24, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 'orange', gear.diya);
  part(new THREE.ConeGeometry(0.08, 0.26, 12), 'flame', gear.diya, [0, 0.15, 0]);
  gear.pilgrim = topHat('black', 'black', 'brown', 0.95, 0.08);
  part(new THREE.BoxGeometry(0.26, 0.2, 0.04), 'gold', gear.pilgrim, [0, 0.12, 0.67]);
  part(new THREE.BoxGeometry(0.15, 0.1, 0.05), 'brown', gear.pilgrim, [0, 0.12, 0.68]);

  // the tablet for the idle "checking the numbers" bit
  const tablet = new THREE.Group();
  armDown.fist.add(tablet);
  tablet.visible = false;
  tablet.position.set(0.25, 0.05, 0.25);
  part(new THREE.BoxGeometry(0.62, 0.44, 0.04), 'black', tablet);
  part(new THREE.PlaneGeometry(0.56, 0.38), 'screen', tablet, [0, 0, 0.022]);

  // ---- dizzy props: swirly eyes and a ring of stars, hidden until he has been spun too hard ----
  const swirls = eyes.map((e) => {
    const g = new THREE.Group();
    g.position.copy(e.position); g.rotation.copy(e.rotation);
    head.add(g);
    for (const r of [0.1, 0.055]) part(new THREE.TorusGeometry(r, 0.02, 6, 24, Math.PI * 1.6), 'eye', g);
    g.visible = false;
    return g;
  });
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.07 : 0.17;
    i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.05, bevelEnabled: false }).center();
  const stars = new THREE.Group();
  stars.position.y = 1.3;
  head.add(stars);
  for (let i = 0; i < 3; i++) {
    const st = part(starGeo, 'gold', stars);
    st.position.set(Math.cos(i / 3 * Math.PI * 2) * 0.95, 0, Math.sin(i / 3 * Math.PI * 2) * 0.95);
  }
  stars.visible = false;
  const FALL_PIVOT = 1.5;                   // he topples about his middle, not his feet

  // ---- behaviour ----
  let outfit = 'classic', mood = MOODS[0];
  const held = new Set();             // props shown on top of the outfit (showGear)
  let inspecting = false, inspectK = 0;   // magnifier raised to the visor
  const MAG_REST = gear.magnifier.quaternion.clone();                 // how the detective carries it, lens down
  const MAG_POS = gear.magnifier.position.clone(), _up = new THREE.Vector3();
  const MAG_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -Math.PI / 2 + 0.45, 0.12));   // handle up, lens toward us
  const _fq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _mq = new THREE.Quaternion();
  let celebrate = 0, anticName = null, anticT = 0, anticDur = 0;
  let nextBlink = 2, blinkT = 0, billow = 1;
  const lerp = THREE.MathUtils.lerp;
  const ANTICS = { yawn: 2.6, tablet: 3.2, loop: 1.3, wave: 2.2, dizzy: 3.6, ...Object.fromEntries(DANCES.map((d) => [d, 4])) };

  function applyOutfit() {
    const o = OUTFITS.find((x) => x.id === outfit) || OUTFITS[0];
    for (const set of Object.values(SETS)) {
      for (const [k, m] of Object.entries(set)) {
        if (!m.color || BASE[k] == null || k === 'screen') continue;
        // the body follows the helmet's outfit colour unless an outfit gives it its own
        const want = o.colors && (o.colors[k] != null ? o.colors[k] : k === 'body' ? o.colors.white : null);
        m.color.setHex(want != null ? (k === 'body' && o.colors[k] == null ? shade(want) : want) : BASE[k]);
        if (m.emissive && (k === 'eye' || k === 'antenna')) m.emissive.setHex((o.colors && o.colors[k]) || (k === 'eye' ? 0x19c8f0 : PAL.antenna));
      }
      if (set === SETS.glossy) for (const m of [set.white, set.body]) {
        m.metalness = o.metal ? 0.9 : 0.05;
        m.roughness = o.metal ? 0.22 : 0.3;
      }
    }
    for (const [name, g] of Object.entries(gear)) g.visible = !!(o.gear && o.gear.includes(name)) || held.has(name);
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
    get mood() { return mood.id; },
    setMood(id) { mood = MOODS.find((m) => m.id === id) || MOODS[0]; },
    setInspect(on) { inspecting = !!on; if (on) held.add('magnifier'); else held.delete('magnifier'); applyOutfit(); },
    showGear(name, on = true) { if (!gear[name]) return; if (on) held.add(name); else held.delete(name); applyOutfit(); },
    setScreen(headline) {
      for (const set of Object.values(SETS)) {
        const tex = set.screen.map;
        if (tex && tex.image) { drawScreen(tex.image, String(headline)); tex.needsUpdate = true; }
      }
    },
    cheer() { celebrate = 1.6; anticName = null; tablet.visible = false; yawnO.visible = false; smile.visible = true; },
    antic(name) {
      if (!ANTICS[name] || celebrate > 0) return 0;
      anticName = name; anticT = 0; anticDur = ANTICS[name];
      return anticDur;
    },
    /* opts: lookX/lookY in -1..1 (head turn), billow multiplier (speed), still (no hover bob),
     baseY (hover height), leanX/leanZ (extra pitch/bank in radians), run (legs run, for ground skimming) */
    update(t, dt, opts = {}) {
      celebrate = Math.max(0, celebrate - dt);
      const party = celebrate > 0;
      const since = 1.6 - celebrate;
      if (anticName) { anticT += dt; if (anticT >= anticDur) anticName = null; }
      const a = anticName, p = a ? anticT / anticDur : 0;
      const env = a ? Math.min(1, p * 5, (1 - p) * 5) : 0;     // ease in / out of the bit

      const hop = party && since < 0.6 ? Math.sin(since / 0.6 * Math.PI) * 0.6 : 0;
      const md = mood;
      root.position.y = (opts.baseY || 0) - (md.sag || 0) + (opts.still ? 0 : Math.sin(t * 1.6 * (md.bob || 1)) * 0.1 * (md.float || 1)) + hop;
      pose.rotation.set(REST.x, (party && since < 0.6 ? since / 0.6 * Math.PI * 2 : 0), REST.z);
      if (a === 'loop') pose.rotation.x = REST.x - (1 - Math.cos(p * Math.PI)) * Math.PI;
      pose.rotation.x += opts.leanX || 0;     // cabinets lean him into the flight
      pose.rotation.z += opts.leanZ || 0;     // and bank him into turns
      let fall = 0, drop = 0, wob = 0;
      if (a === 'dizzy') {
        const ease = (x) => x * x * (3 - 2 * x);
        if (p < 0.3) wob = Math.sin(anticT * 13) * 0.28 * (p / 0.3);
        else if (p < 0.42) { const q = (p - 0.3) / 0.12; fall = -1.42 * q * q; drop = -0.9 * q * q; }
        else if (p < 0.78) { const q = p - 0.42; fall = -1.42 + Math.sin(q * 38) * 0.05 * Math.max(0, 1 - q * 7); drop = -0.9; }
        else { const q = (p - 0.78) / 0.22; const e = ease(q); fall = -1.42 * (1 - e) + Math.sin(q * Math.PI) * 0.12; drop = -0.9 * (1 - e) + Math.sin(q * Math.PI) * 0.6; }
      }
      pose.rotation.z += fall + wob;
      pose.position.set(FALL_PIVOT * Math.sin(fall), FALL_PIVOT * (1 - Math.cos(fall)) + drop, 0);
      const dizzy = a === 'dizzy';
      for (const g of swirls) { g.visible = dizzy; g.rotation.z = -t * 9; }
      stars.visible = dizzy && p > 0.36 && p < 0.86;
      if (stars.visible) stars.rotation.y = t * 4;

      let lookX = opts.lookX || 0, lookY = (opts.lookY || 0) + (a ? 0 : md.lookY || 0);
      if (a === 'tablet') { lookX = 0.25; lookY = -0.55 * env; }
      if (a === 'yawn') lookY = 0.35 * env;
      if (a === 'wave') { lookX = -0.2; lookY = 0.1; }
      head.rotation.y = lerp(head.rotation.y, lookX * 0.45, 0.08);
      head.rotation.x = lerp(head.rotation.x, -lookY * 0.3, 0.08);
      const moodTilt = opts.still ? (md.tilt || 0) : (md.tilt || 0) + (md.sway ? Math.sin(t * 1.2) * md.sway : 0) + (md.tremble ? Math.sin(t * 31) * md.tremble : 0);
      head.rotation.z = lerp(head.rotation.z, a === 'yawn' ? 0.12 * env : a === 'dizzy' ? Math.sin(t * 7) * 0.2 : party ? 0 : moodTilt, 0.12);

      const waving = a === 'wave';
      const bf = DANCES.includes(a) ? 1 - env : 1;    // a dance owns the arms: the resting pose lets go of them
      armUp.shoulder.rotation.z = lerp(armUp.shoulder.rotation.z,
        waving ? 2.55 + Math.sin(anticT * 11) * 0.38 * env
          : (a === 'yawn' ? 2.9 : party ? 2.0 : md.armUp || 2.0) + Math.sin(t * (party ? 12 : 2)) * (party ? 0.2 : 0.05), 0.2 * bf);
      armUp.elbow.rotation.z = lerp(armUp.elbow.rotation.z, a === 'yawn' ? 0.2 : waving ? 0.35 : 0.8, 0.1 * bf);
      armUp.shoulder.rotation.x = -0.35;
      let dz = party ? -2.2 : -0.45, dx = party ? 0 : -0.25, ex = party ? 0 : -1.0 + Math.sin(t * 1.6) * 0.08;
      if (a === 'tablet') { dz = -0.35; dx = -0.9 * env; ex = -1.25; }
      if (a === 'yawn') { dz = -0.2; dx = -1.6 * env; ex = -2.0 * env - 1.0 * (1 - env); }   // hand to mouth
      armDown.shoulder.rotation.z = lerp(armDown.shoulder.rotation.z, dz, 0.12 * bf);
      armDown.shoulder.rotation.x = lerp(armDown.shoulder.rotation.x, dx, 0.12 * bf);
      armDown.elbow.rotation.x = lerp(armDown.elbow.rotation.x, ex, 0.12 * bf);
      tablet.visible = a === 'tablet' && env > 0.3;
      legs.forEach((leg, i) => {
        // opts.run: skimming the ground, the stubby legs actually run (Space Harrier style)
        leg.rotation.x = opts.run ? Math.sin(t * 17 + i * Math.PI) * 0.95 - 0.1 : 0.4 + Math.sin(t * 2 + i * 1.3) * 0.1;
        leg.rotation.z = (i ? 1 : -1) * 0.08;
      });

      // ---- inspecting: the magnifier comes up to his visor and he leans in ----
      inspectK = lerp(inspectK, inspecting && !a && !party ? 1 : 0, 0.15);
      if (inspectK > 0.01) {
        // hand held low and out to his side, so the big lens stands beside his head
        armDown.shoulder.rotation.z = lerp(armDown.shoulder.rotation.z, -0.75, inspectK * 0.4);
        armDown.shoulder.rotation.x = lerp(armDown.shoulder.rotation.x, -0.5, inspectK * 0.4);
        armDown.elbow.rotation.x = lerp(armDown.elbow.rotation.x, -0.55, inspectK * 0.4);
        head.rotation.x = lerp(head.rotation.x, 0.12, inspectK * 0.2);
        // whatever the arm is doing, the handle points up out of his fist and the lens faces the viewer
        root.updateMatrixWorld(true);
        armDown.fist.getWorldQuaternion(_fq).invert();
        root.getWorldQuaternion(_rq).multiply(MAG_UP);
        _mq.copy(_fq).multiply(_rq);
        gear.magnifier.quaternion.copy(MAG_REST).slerp(_mq, inspectK);
        const sc = 1.2 + 3.0 * inspectK;                          // a comically big lens (4.2x) — it reads at mascot size
        gear.magnifier.scale.setScalar(sc);
        // grip it up near the lens, not at the end of the handle, so the lens sits beside his head
        _up.set(0, 1, 0).applyQuaternion(gear.magnifier.quaternion);
        gear.magnifier.position.copy(MAG_POS).addScaledVector(_up, -0.34 * sc * inspectK);
        // …a touch toward the viewer, so it's clearly in front of the helmet rather than behind it
        _up.set(0.17, -0.04, 0.3).applyQuaternion(root.getWorldQuaternion(_rq)).applyQuaternion(_fq);
        gear.magnifier.position.addScaledVector(_up, sc * inspectK);
      } else { gear.magnifier.quaternion.copy(MAG_REST); gear.magnifier.scale.setScalar(1.2); gear.magnifier.position.copy(MAG_POS); }

      // ---- dances: two beats a second, eased in and out by env ----
      const isDance = DANCES.includes(a);
      if (!isDance) armDown.elbow.rotation.z = lerp(armDown.elbow.rotation.z, 0, 0.2);   // only dances bend it in-plane
      const AU = armUp, AD = armDown;
      const arms = (uz, ue, dz, de, k = 0.3) => {        // [up arm: shoulder z, elbow], [down arm: shoulder z, in-plane elbow]
        AU.shoulder.rotation.z = lerp(AU.shoulder.rotation.z, uz, k * env);
        AU.elbow.rotation.z = lerp(AU.elbow.rotation.z, ue, k * env);
        AD.shoulder.rotation.z = lerp(AD.shoulder.rotation.z, dz, k * env);
        AD.shoulder.rotation.x = lerp(AD.shoulder.rotation.x, 0, k * env);
        AD.elbow.rotation.x = lerp(AD.elbow.rotation.x, 0, k * env);
        AD.elbow.rotation.z = lerp(AD.elbow.rotation.z, de, k * env);
      };
      if (a === 'ymca') {
        // Y, M, C, A — a letter every 0.9s, a little bounce on each
        const k = Math.min(3, Math.floor(anticT / 0.9));
        // (his arms are short next to that helmet: much past 2.4 rad and they vanish behind it)
        arms(...[[2.15, 0.05, -2.15, 0], [2.45, -0.6, -2.45, 0.6], [2.3, 0.9, -0.9, -0.9], [2.45, 0.75, -2.45, -0.75]][k], 0.35);
        pose.rotation.y += 0.3 * env;
        if (k === 2) pose.rotation.z += 0.25 * env;        // lean into the C
        root.position.y += Math.abs(Math.sin(anticT * Math.PI / 0.9)) * 0.15 * env;
      } else if (a === 'twist') {
        const beat = anticT * Math.PI * 4;
        pose.rotation.y += Math.sin(beat) * 0.55 * env;
        head.rotation.y = lerp(head.rotation.y, -Math.sin(beat) * 0.4, 0.3);
        root.position.y += (-0.12 + Math.sin(beat * 2) * 0.03) * env;       // low and bouncy
        arms(1.1 + Math.sin(beat) * 0.3, 1.6, -1.1 + Math.sin(beat) * 0.3, -1.6);
        legs.forEach((leg, i) => { leg.rotation.x = 0.4 + 0.5 * env; leg.rotation.z = (i ? 1 : -1) * 0.08 + Math.sin(beat) * 0.3 * env; });
      } else if (a === 'sprinkler') {
        // hand behind the head, arm out front: tick-tick-tick across, whoosh back
        const k = anticT % 2, sweep = k < 1.6 ? -0.6 + Math.floor(k / 0.2) * 0.15 : 0.6 - (k - 1.6) / 0.4 * 1.2;
        pose.rotation.y += sweep * env;
        AU.shoulder.rotation.z = lerp(AU.shoulder.rotation.z, 2.9, 0.3 * env);
        AU.elbow.rotation.z = lerp(AU.elbow.rotation.z, 2.0, 0.3 * env);
        AD.shoulder.rotation.z = lerp(AD.shoulder.rotation.z, -1.5, 0.3 * env);
        AD.shoulder.rotation.x = lerp(AD.shoulder.rotation.x, -0.9, 0.3 * env);
        AD.elbow.rotation.x = lerp(AD.elbow.rotation.x, -0.1, 0.3 * env);
      } else if (a === 'floss') {
        const s = Math.sin(anticT * Math.PI * 4);
        pose.position.x += -s * 0.22 * env; pose.rotation.z += s * 0.12 * env;
        arms(0.45, 0.1, -0.45, 0);
        AU.shoulder.rotation.x = -0.35 + s * 0.9 * env;
        AD.shoulder.rotation.x = s * 0.9 * env;
      } else if (a === 'moonwalk') {
        // turn to the side and glide backwards, looking back at the audience
        pose.rotation.y += 1.1 * env;
        pose.position.x += (0.6 - 1.2 * p) * env;
        legs.forEach((leg, i) => { leg.rotation.x = 0.4 + Math.sin(anticT * Math.PI * 4 + i * Math.PI) * 0.6 * env; });
        arms(0.7, 0.5, -0.7, 0, 0.2);
        head.rotation.y = lerp(head.rotation.y, -0.8, 0.15);
      } else if (a === 'pirouette') {
        const e = p * p * (3 - 2 * p);
        pose.rotation.y += e * Math.PI * 4;                 // two full turns (4π lands back where it started)
        root.position.y += Math.sin(p * Math.PI) * 0.35;
        arms(2.85, 0.9, -2.85, -0.9, 0.2);                  // arms in a ring overhead
        legs.forEach((leg, i) => { leg.rotation.x = i ? 0.2 : 0.4 + 0.9 * env; });   // one foot tucked
      } else if (a === 'dab') {
        const k = anticT % 2, hit = k > 0.35 && k < 1.5, s = hit ? 0.45 : 0.2;
        AU.shoulder.rotation.z = lerp(AU.shoulder.rotation.z, hit ? 2.2 : 2.0, s * env);
        AU.elbow.rotation.z = lerp(AU.elbow.rotation.z, hit ? 2.3 : 0.8, s * env);
        if (hit) AU.shoulder.rotation.x = -0.35 - 0.8 * env;    // forearm across the face
        AD.shoulder.rotation.z = lerp(AD.shoulder.rotation.z, hit ? -2.4 : -0.45, s * env);
        AD.elbow.rotation.x = lerp(AD.elbow.rotation.x, hit ? -0.05 : -1.0, s * env);
        head.rotation.x = lerp(head.rotation.x, hit ? 0.35 : 0, s);
        head.rotation.y = lerp(head.rotation.y, hit ? 0.5 : 0, s);
      } else if (a === 'chicken') {
        const beat = anticT * Math.PI * 4, flap = Math.max(0, Math.sin(beat * 2)), peck = Math.max(0, Math.sin(beat));
        arms(1.0 + flap * 0.6, 2.4, -1.0 - flap * 0.6, -2.4, 0.4);   // hands in the armpits, elbows flapping
        pose.position.z += peck * 0.35 * env;
        head.rotation.x = lerp(head.rotation.x, peck * 0.4, 0.4);
        legs.forEach((leg, i) => { leg.rotation.x = 0.4 + Math.max(0, Math.sin(beat + i * Math.PI)) * 0.6 * env; });
      }
      if (a === 'boogie') {
        const beat = anticT * Math.PI * 4;
        pose.position.x += Math.sin(beat / 2) * 0.28 * env;
        pose.rotation.z += Math.sin(beat / 2) * 0.16 * env;
        root.position.y += Math.abs(Math.sin(beat)) * 0.2 * env;
        head.rotation.x += Math.sin(beat) * 0.08 * env;
        armUp.shoulder.rotation.z = lerp(armUp.shoulder.rotation.z, 1.9 + Math.sin(beat) * 0.7, 0.3);
        armDown.shoulder.rotation.z = lerp(armDown.shoulder.rotation.z, -1.4 - Math.sin(beat) * 0.7, 0.3);
        armDown.elbow.rotation.x = lerp(armDown.elbow.rotation.x, -0.6, 0.2);
        legs.forEach((leg, i) => { leg.rotation.x = 0.4 + Math.max(0, Math.sin(beat + i * Math.PI)) * 0.7 * env; });
      } else if (a === 'robot') {
        // the robot: eight snapped poses, four a second — [up shoulder, down shoulder, head turn]
        const k = Math.floor(anticT * 4) % 8;
        const R = [[1.6, -1.6, 0.4], [2.4, -0.4, -0.4], [1.6, -1.6, 0], [0.8, -2.4, 0.4],
          [1.6, -1.6, -0.4], [2.4, -2.4, 0], [1.6, -0.8, 0.4], [0.8, -1.6, -0.4]][k];
        const snap = 0.55 * env;
        armUp.shoulder.rotation.z = lerp(armUp.shoulder.rotation.z, R[0], snap);
        armUp.elbow.rotation.z = lerp(armUp.elbow.rotation.z, k % 2 ? 1.5 : 0.2, snap);
        armDown.shoulder.rotation.z = lerp(armDown.shoulder.rotation.z, R[1], snap);
        armDown.shoulder.rotation.x = lerp(armDown.shoulder.rotation.x, 0, snap);
        armDown.elbow.rotation.x = lerp(armDown.elbow.rotation.x, k % 2 ? -1.5 : -0.2, snap);
        head.rotation.y = lerp(head.rotation.y, R[2], snap);
        pose.rotation.y += (k % 4 < 2 ? 0.25 : -0.25) * env;
        root.position.y += (k % 2 ? 0.06 : 0) * env;
      } else if (a === 'disco') {
        // point up to one side, then down across, hips swaying — Saturday night at the data center
        const beat = anticT * Math.PI * 4, up = Math.sin(beat / 2) > 0;
        armUp.shoulder.rotation.z = lerp(armUp.shoulder.rotation.z, up ? 2.9 : 1.2, 0.25 * env);
        armUp.elbow.rotation.z = lerp(armUp.elbow.rotation.z, 0.1, 0.2 * env);
        armDown.shoulder.rotation.z = lerp(armDown.shoulder.rotation.z, up ? -0.4 : -1.2, 0.2 * env);
        pose.rotation.z += Math.sin(beat) * 0.1 * env;
        pose.position.x += Math.sin(beat) * 0.12 * env;
        head.rotation.y = lerp(head.rotation.y, up ? 0.35 : -0.25, 0.2 * env);
        head.rotation.z = lerp(head.rotation.z, up ? -0.12 : 0.1, 0.2 * env);
        legs.forEach((leg, i) => { leg.rotation.z = (i ? 1 : -1) * (0.08 + Math.max(0, Math.sin(beat + i * Math.PI)) * 0.35 * env); });
      }

      nextBlink -= dt;
      if (nextBlink < 0) { blinkT = 0.14; nextBlink = 2 + Math.random() * 3; }
      blinkT = Math.max(0, blinkT - dt);
      // a cheer always reads as delight, whatever the mood; the yawn and the dizzy bit own the face
      const dancing = DANCES.includes(a);
      const eyeKind = a === 'dizzy' ? 'none' : party || dancing ? 'joy' : a === 'yawn' || a === 'tablet' ? 'open' : md.eyes;
      let eyeY = blinkT > 0 ? 0.1 : eyeKind === 'half' ? 0.42 : 1;
      if (a === 'yawn') eyeY = 1 - 0.8 * env;
      if (a === 'tablet') eyeY = 0.8;
      for (const e of eyes) { e.scale.y = lerp(e.scale.y, eyeY, 0.35); e.visible = eyeKind === 'open' || eyeKind === 'half'; }
      joyEyes.forEach((g) => { g.visible = eyeKind === 'joy'; });
      closedEyes.forEach((g) => { g.visible = eyeKind === 'closed'; });
      const beat = 1 + Math.max(0, Math.sin(t * 7)) ** 8 * 0.25;
      heartEyes.forEach((h) => { h.visible = eyeKind === 'heart'; h.scale.setScalar(0.26 * beat); });
      yawnO.visible = a === 'yawn' && env > 0.4;
      const mouthKind = yawnO.visible ? null : party || dancing ? 'grin' : a ? 'smile' : md.mouth;
      for (const [k, g] of Object.entries(mouths)) g.visible = k === mouthKind;
      for (const [k, pair] of Object.entries(brows)) pair.forEach((g) => { g.visible = !a && !party && md.brows === k; });

      antenna.scale.setScalar(1 + Math.sin(t * 4 * (md.pulse || 1)) * 0.06 + (party ? 0.15 : 0));
      billow = lerp(billow, (party ? 1.8 : md.billow || 1) * (opts.billow || 1), 0.05);
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
