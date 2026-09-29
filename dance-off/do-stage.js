/* ============================================================================
 * CostBot: Dance Off! — THE STAGE
 * ----------------------------------------------------------------------------
 * The world the dance-off happens in, and the three casts on it. Nothing here
 * knows the rules; the engine (do-game.js) calls pulse() on the beat and moves
 * people around, and this file makes that look like a disco on a starship.
 *
 *   const stage = buildStage(scene);     // floor, lights, sky, sign, invoice
 *   stage.pulse(beatIndex, party);       // on every beat: the floor and strips flash (party: all of it)
 *   stage.update(t, dt);                 // every frame
 *   const max = makeVillain();           // Max Tokens: CostBot's evil twin in black chrome
 *   const squad = makeSquad();           // three mini CostBots, the heist crew
 *
 * Layout, looking from the camera (+z) into the room (-z):
 *   CostBot front-left, the villain front-right facing him, the invoice on its
 *   pedestal at the back right, and the squad's route along the back wall —
 *   behind the villain, so he has to turn around to see it.
 * ==========================================================================*/
import * as THREE from 'three';
import { createCostBot, makeCoinFactory, OUTFITS } from '../shared/costbot-3d.js';

export const PALETTE = [0xff4fa3, 0x39d5ff, 0xffc233, 0x8dff5a, 0xb77bff];
const ART_OPACITY = 0.22;       // the song art is set dressing: there, but never louder than the dancers
export const SPOTS = {
  costbot: new THREE.Vector3(-3.4, 0, 1.2),
  villain: new THREE.Vector3(3.6, 0, -0.6),
  invoice: new THREE.Vector3(8.8, 0, -9.6),
  squadFrom: new THREE.Vector3(-11, 0, -8.6),
  squadTo: new THREE.Vector3(7.2, 0, -9),
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStage(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // ---- the sky: a violet nebula wash and a field of stars ----
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), new THREE.MeshBasicMaterial({
    side: THREE.BackSide, depthWrite: false,
    map: canvasTex(8, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#02010a'); gr.addColorStop(0.35, '#150a33'); gr.addColorStop(0.5, '#3a1250');
      gr.addColorStop(0.56, '#1a0b2e'); gr.addColorStop(1, '#02010a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }),
  }));
  group.add(sky);
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2, y = Math.random() * 0.9 + 0.05, r = 70;
    const k = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * k * r, y * r, Math.sin(a) * k * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.35, sizeAttenuation: true, depthWrite: false }));
  group.add(stars);

  // ---- the floor: a light-up grid that flashes a new pattern on every beat ----
  const COLS = 12, ROWS = 10, TILE = 2;     // the two front rows only show on a phone, where the camera sits further back
  const tileGeo = new THREE.BoxGeometry(TILE * 0.93, 0.14, TILE * 0.93);
  const tileMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const floor = new THREE.InstancedMesh(tileGeo, tileMat, COLS * ROWS);
  const tiles = [];
  const m4 = new THREE.Matrix4();
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    const x = -11 + i * TILE, z = -11.2 + j * TILE;
    m4.makeTranslation(x, -0.07, z);
    floor.setMatrixAt(tiles.length, m4);
    tiles.push({ i, j, x, z, level: 0, color: new THREE.Color(PALETTE[(i + j) % PALETTE.length]) });
  }
  floor.instanceMatrix.needsUpdate = true;
  group.add(floor);
  // the grout between tiles: a dark slab under the grid so the gaps read as gaps
  const base = new THREE.Mesh(new THREE.BoxGeometry(COLS * TILE + 1, 0.2, ROWS * TILE + 1),
    new THREE.MeshStandardMaterial({ color: 0x07060e, roughness: 0.4, metalness: 0.6 }));
  base.position.set(0, -0.2, -11.2 + (ROWS - 1) * TILE / 2);
  group.add(base);
  const tmpC = new THREE.Color();
  const cx = 0, cz = -4.2;
  function lightFloor(beat, party) {
    if (party) {
      // Freestyle: every tile, every colour, every beat
      for (const tl of tiles) { tl.level = 0.75 + Math.random() * 0.25; tl.color.setHex(PALETTE[(Math.random() * PALETTE.length) | 0]); }
      return;
    }
    const pattern = Math.floor(beat / 4) % 4, b = beat % 4;
    const hue = PALETTE[beat % PALETTE.length];
    for (const tl of tiles) {
      let on;
      if (pattern === 0) on = (tl.i + tl.j + beat) % 2 === 0;                                   // checkerboard
      else if (pattern === 1) on = (tl.i + tl.j + b) % 4 === 0;                                  // diagonals marching
      else if (pattern === 2) on = Math.floor(Math.hypot(tl.x - cx, (tl.z - cz) * 1.4) / 2.6) % 4 === b;   // rings out from the middle
      else on = Math.random() < 0.28;                                                            // sparkle
      if (on) { tl.level = 1; tl.color.setHex(pattern === 3 ? PALETTE[(Math.random() * PALETTE.length) | 0] : hue); }
    }
  }
  function drawFloor(dt) {
    for (let n = 0; n < tiles.length; n++) {
      const tl = tiles[n];
      tl.level = Math.max(0, tl.level - dt * 2.6);
      tmpC.copy(tl.color).multiplyScalar(0.07 + tl.level * tl.level * 1.25);
      floor.setColorAt(n, tmpC);
    }
    floor.instanceColor.needsUpdate = true;
  }

  // ---- the back wall: dark panels with LED strips that jump on the beat ----
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x0b0918, roughness: 0.7, metalness: 0.3 }));
  wall.position.set(0, 9, -13);
  group.add(wall);
  const strips = [];
  for (let i = 0; i < 13; i++) {
    const m = new THREE.MeshBasicMaterial({ color: PALETTE[i % PALETTE.length], toneMapped: false });
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 7, 0.1), m);
    s.position.set(-15 + i * 2.5, 3.8, -12.9);
    s.userData = { base: new THREE.Color(PALETTE[i % PALETTE.length]), level: 0 };
    group.add(s); strips.push(s);
  }

  // ---- the song's artwork, hung faintly across the back wall — contain-fit, so the whole picture shows ----
  // sized to the band of wall the play camera actually sees (it looks low, over the note lane)
  const ART_W = 24, ART_H = 9.6;
  const artMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), artMat);
  art.position.set(0, 5.3, -12.95);
  group.add(art);
  const artLoader = new THREE.TextureLoader();
  let artUrl = null, artTarget = 0;
  function setArt(url) {
    if (url === artUrl) return;
    artUrl = url;
    artTarget = 0;
    if (!url) return;
    artLoader.load(url, (tex) => {
      if (url !== artUrl) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      // contain-fit: size the frame to the picture, as big as fits the wall, nothing cropped
      const ia = tex.image.width / tex.image.height, wa = ART_W / ART_H;
      if (ia > wa) art.scale.set(ART_W, ART_W / ia, 1); else art.scale.set(ART_H * ia, ART_H, 1);
      if (artMat.map) artMat.map.dispose();
      artMat.map = tex; artMat.needsUpdate = true;
      artTarget = ART_OPACITY;
    });
  }

  // ---- the sign ----
  const signTex = canvasTex(1024, 300, (g, w, h) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 900 150px "Arial Black", Impact, system-ui, sans-serif';
    g.shadowColor = '#ff2d95'; g.shadowBlur = 36;
    g.strokeStyle = '#ff7cc4'; g.lineWidth = 9; g.strokeText('DANCE OFF!', w / 2, h * 0.6);
    g.fillStyle = '#fff2fb'; g.fillText('DANCE OFF!', w / 2, h * 0.6);
    g.font = '700 54px system-ui, sans-serif'; g.shadowColor = '#39d5ff';
    g.fillStyle = '#bff3ff'; g.fillText('C O S T B O T', w / 2, h * 0.14);
  });
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false, depthWrite: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 4.4), signMat);
  sign.position.set(0, 12.6, -12.7);
  group.add(sign);

  // ---- light: a cool fill, a warm key, and two coloured rims that throb ----
  group.add(new THREE.HemisphereLight(0x8a90ff, 0x2a0620, 0.6));
  const key = new THREE.DirectionalLight(0xfff1e6, 1.5);
  key.position.set(-5, 11, 12);
  group.add(key);
  const rimA = new THREE.PointLight(0xff4fa3, 30, 0, 1.2); rimA.position.set(-7, 5, -4);
  const rimB = new THREE.PointLight(0x39d5ff, 30, 0, 1.2); rimB.position.set(8, 5, -3);
  group.add(rimA, rimB);

  // ---- follow-spot cones sweeping the room ----
  const coneAlpha = canvasTex(4, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  coneAlpha.colorSpace = THREE.NoColorSpace;
  const cones = [-9, -3, 3, 9].map((x, i) => {
    const geo = new THREE.ConeGeometry(2.6, 14, 28, 1, true).translate(0, -7, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE[(i * 2) % PALETTE.length], transparent: true, opacity: 0.16, alphaMap: coneAlpha,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const c = new THREE.Mesh(geo, mat);
    c.position.set(x, 14, -5);
    c.userData.phase = i * 1.7;
    group.add(c);
    return c;
  });

  // ---- the mirror ball ----
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 2),
    new THREE.MeshStandardMaterial({ color: 0xe8ecff, metalness: 1, roughness: 0.12, flatShading: true }));
  ball.position.set(0, 12.2, -4);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6), new THREE.MeshBasicMaterial({ color: 0x333344 }));
  cord.position.set(0, 16, -4);
  group.add(ball, cord);

  // ---- the Infinity Invoice on its pedestal ----
  const invoice = new THREE.Group();
  invoice.position.copy(SPOTS.invoice);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 1.7, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a1426, roughness: 0.35, metalness: 0.7 }));
  ped.position.y = 0.85;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.77, 0.06, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0xf7bd1c, metalness: 1, roughness: 0.25 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 1.7;
  invoice.add(ped, rim);
  const orb = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0xc58bff, emissive: 0x9b3dff, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.3 }));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.035, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xd9b3ff, toneMapped: false }));
  const glow = new THREE.PointLight(0xa24dff, 14, 0, 1.4);
  orb.add(gem, halo, glow);
  orb.position.set(0, 2.55, 0);
  invoice.add(orb);
  const labelTex = canvasTex(512, 96, (g, w, h) => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 44px system-ui, sans-serif';
    g.shadowColor = '#a24dff'; g.shadowBlur = 18; g.fillStyle = '#efe0ff';
    g.fillText('INFINITY INVOICE', w / 2, h / 2);
  });
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false, toneMapped: false }));
  label.scale.set(3.4, 0.64, 1); label.position.set(0, 3.7, 0);
  invoice.add(label);
  group.add(invoice);
  let carrier = null;          // once grabbed, the orb rides on a squad bot's head
  const orbWorld = new THREE.Vector3();

  let beatFlash = 0, signDim = 0, signK = 0;
  return {
    group, invoice, orb, sign,
    pulse(beat, party = false) {
      lightFloor(beat, party);
      for (let i = 0; i < strips.length; i++) if (party || (i + beat) % 3 === 0) strips[i].userData.level = 1;
      beatFlash = 1;
    },
    grab(bot) { carrier = bot; label.visible = false; },
    // the sign sits right behind the HUD's move strip, so it steps back while there is a strip to read
    dimSign(on) { signDim = on ? 1 : 0; },
    setArt,
    get grabbed() { return !!carrier; },
    orbPosition() { return orb.getWorldPosition(orbWorld); },
    hideOrb() { orb.visible = false; glow.intensity = 0; },
    reset() {
      carrier = null; label.visible = true; orb.visible = true; glow.intensity = 14;
      if (orb.parent !== invoice) invoice.add(orb);
      orb.position.set(0, 2.55, 0); orb.scale.setScalar(1);
    },
    update(t, dt) {
      drawFloor(dt);
      beatFlash = Math.max(0, beatFlash - dt * 3);
      for (const s of strips) {
        s.userData.level = Math.max(0, s.userData.level - dt * 3);
        s.material.color.copy(s.userData.base).multiplyScalar(0.25 + s.userData.level * 1.8);
      }
      for (const c of cones) {
        const ph = c.userData.phase;
        c.rotation.z = Math.sin(t * 0.55 + ph) * 0.55;
        c.rotation.x = Math.cos(t * 0.4 + ph * 1.3) * 0.3;
        c.material.opacity = 0.11 + beatFlash * 0.07;
      }
      rimA.intensity = 22 + beatFlash * 30; rimB.intensity = 22 + beatFlash * 30;
      ball.rotation.y = t * 0.6;
      signK += (signDim - signK) * (1 - Math.exp(-dt * 4));
      artMat.opacity += (artTarget - artMat.opacity) * (1 - Math.exp(-dt * 3));
      art.visible = artMat.opacity > 0.005;
      signMat.color.setScalar(0.8 + beatFlash * 0.35);
      signMat.opacity = 1 - signK * 0.92;
      gem.rotation.y = t * 1.6; gem.rotation.x = Math.sin(t) * 0.3;
      halo.rotation.x = t * 1.1; halo.rotation.y = t * 0.7;
      if (carrier) {
        // lift it off the pedestal and float it just over the carrier's helmet
        if (orb.parent !== group) group.add(orb);
        const p = carrier.root.position;
        orb.position.lerp(orbWorld.set(p.x, p.y + 2.1, p.z), 1 - Math.exp(-dt * 8));
        orb.scale.setScalar(0.7);
      } else {
        orb.position.y = 2.55 + Math.sin(t * 2) * 0.12;
      }
    },
  };
}

// recolour one bot's materials by slot (each bot owns its materials, so this touches no one else)
function recolor(bot, colors, emissive = {}) {
  const seen = new Set();
  bot.root.traverse((o) => {
    if (!o.isMesh || !o.userData.slot || seen.has(o.material)) return;
    seen.add(o.material);
    const slot = o.userData.slot;
    if (colors[slot] != null && o.material.color) o.material.color.setHex(colors[slot]);
    if (emissive[slot] != null && o.material.emissive) o.material.emissive.setHex(emissive[slot]);
  });
}

/* Max Tokens: CostBot's own model, bigger, in black chrome and red light, with a
 * token-topped staff and a ring of inference spinning over his head. */
export function makeVillain() {
  const bot = createCostBot({ style: 'glossy', shadows: false });
  bot.setMood('grumpy');
  const steel = new THREE.MeshStandardMaterial({ color: 0x22202c, metalness: 0.9, roughness: 0.3 });
  const red = new THREE.MeshBasicMaterial({ color: 0xff2d3d, toneMapped: false });
  recolor(bot, { white: 0x1c1f28, body: 0x14161d, silver: 0xd3d9e3, gold: 0xe0202e, goldDark: 0x9c1020, line: 0x3a3f4d,
    cape: 0x0c0d12, capeIn: 0xe0202e, antenna: 0xff2a2a, eye: 0xff3030 }, { eye: 0xff1a1a, antenna: 0xff1a1a });
  const staff = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 10), steel);
  pole.position.y = -0.3;
  const coin = makeCoinFactory()();
  coin.scale.setScalar(1.4);
  coin.position.y = 0.95;
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40), red);
  glow.position.y = 0.95;
  staff.add(pole, coin, glow);
  bot.armDown.fist.add(staff);
  const spin = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.035, 8, 64), red);
  spin.rotation.x = Math.PI / 2;
  spin.position.y = 1.55;
  bot.head.add(spin);
  const update = bot.update;
  bot.update = (t, dt, opts) => { update(t, dt, opts); spin.rotation.z = t * 1.8; coin.rotation.y = t * 3; glow.rotation.y = t * 3; };
  bot.root.scale.setScalar(1.3);
  return bot;
}

/* The heist crew: three mini CostBots. dressSquad() puts them in three different outfits
 * from the whole wardrobe (secret ones too — they are the crew, not the player). */
export function dressSquad(squad) {
  const pool = OUTFITS.map((o) => o.id).filter((id) => id !== 'classic');
  for (const m of squad) m.bot.setOutfit(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
}
export function makeSquad() {
  return [0, 1, 2].map((i) => {
    const bot = createCostBot({ style: 'glossy', shadows: false });
    bot.root.scale.setScalar(0.42);
    bot.root.position.copy(SPOTS.squadFrom).add(new THREE.Vector3(-i * 1.2, 0, i * 0.35));
    bot.root.rotation.y = Math.PI / 2;      // facing along the route, toward the invoice
    return { bot, i, s: 0, frozenT: 0, moving: false };
  });
}
