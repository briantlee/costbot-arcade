/* ============================================================================
 * CostBotLand Tycoon — the simulation
 * ----------------------------------------------------------------------------
 * Pure logic, no three.js and no DOM, so it runs the same in the page and in
 * `node ct-smoketest.mjs`. The game calls step(dt) with sim seconds (already
 * multiplied by the speed setting) and reads state back out to draw it.
 *
 *   const sim = createSim({ scenario: 'grand', seed: 7 });
 *   sim.canPlace('coaster', i, j, rot)  // -> { ok, reason, cost, fp }
 *   sim.place('coaster', i, j, rot); sim.placePath(i, j); sim.placeAddon('bench', i, j);
 *   sim.bulldoze(i, j); sim.hire('janitor'); sim.step(0.1);
 *   sim.drainEvents()   // messages, breakdowns, month bills, the end of the run
 *
 * The grid is GRID.W x GRID.H cells; k = j * W + i indexes every per-cell array.
 * ==========================================================================*/
import {
  GRID, cellX, cellZ, LANDS, FIXED, MONTH, MONTH_NAMES, DEFS, ADDON_BY_ID, ADDON_BY_N, STAFF_BY_ID,
  BAL, SCENARIOS, THOUGHTS, ADVICE, FIRST_NAMES, LAST_NAMES,
} from './ct-content.js';

const { W, H } = GRID;
export const T = { EMPTY: 0, PATH: 1, BLOCK: 2, BUILD: 3, GATE: 4 };
export const ROT_Y = [0, -Math.PI / 2, Math.PI, Math.PI / 2];   // entrance faces +Z, -X, -Z, +X
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const idx = (i, j) => j * W + i;
export const inGrid = (i, j) => i >= 0 && j >= 0 && i < W && j < H;

// Night falls once a month: 0 = broad day, 1 = full night.
export function nightness(t) {
  const raw = 0.5 - 0.5 * Math.cos(((t / MONTH) % 1 - 0.3) * Math.PI * 2);
  const x = clamp((raw - 0.4) / 0.3, 0, 1);
  return x * x * (3 - 2 * x);
}

// A footprint centred on the cursor cell. The entrance is the cell in front.
export function footprint(def, ci, cj, rot = 0) {
  const w = rot % 2 ? def.d : def.w, d = rot % 2 ? def.w : def.d;
  const i0 = ci - Math.floor((w - 1) / 2), j0 = cj - Math.floor((d - 1) / 2);
  let ent = null;
  if (def.kind !== 'scenery') {
    if (rot === 0) ent = [i0 + Math.floor(w / 2), j0 + d];
    else if (rot === 1) ent = [i0 - 1, j0 + Math.floor(d / 2)];
    else if (rot === 2) ent = [i0 + Math.floor(w / 2), j0 - 1];
    else ent = [i0 + w, j0 + Math.floor(d / 2)];
  }
  return { i0, j0, w, d, ent };
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const newLedger = () => ({
  income: { admission: 0, rides: 0, stalls: 0 },
  expense: { construction: 0, upkeep: 0, reserved: 0, staff: 0, stock: 0, marketing: 0, interest: 0 },
});
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export function createSim({ scenario = 'grand', seed = Date.now() % 100000 } = {}) {
  const rand = mulberry(seed);
  const rr = (a, b) => a + rand() * (b - a);
  const sc = { ...SCENARIOS[scenario] };
  const S = {
    scenario: sc, time: 0, month: 0, cash: sc.cash, entryFee: sc.entryFee,
    type: new Uint8Array(W * H), owner: new Int32Array(W * H).fill(-1), land: new Uint8Array(W * H),
    addon: new Uint8Array(W * H), litter: new Uint8Array(W * H), vomit: new Uint8Array(W * H),
    beauty: new Float32Array(W * H), lit: new Uint8Array(W * H),
    builds: new Map(), guests: [], staff: [], nextId: 1, nextGuest: 1, nextStaff: 1,
    gateDist: null, dirtyGraph: true, dirtyBeauty: true,
    version: 0, litterVersion: 0, beautyTotal: 0, litterTotal: 0, vomitTotal: 0,
    rating: 500, arrivalAcc: 0, campaignUntil: 0, quickFixReadyAt: 0,
    ledger: newLedger(), history: [], events: [], thoughtLog: [], adviceAt: {},
    stats: { peakGuests: 0, totalGuests: 0, leftUnhappy: 0, ridesBuilt: 0, upT: 0, downT: 0, bestRating: 0 },
    milestones: new Set(), ended: false, outcome: null,
    _ratingT: 0, _adviceT: 0, _hypeT: 0,
  };

  // ---- the fixed map ----
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = idx(i, j), x = cellX(i), z = cellZ(j);
    const l = LANDS.findIndex((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1);
    S.land[k] = l + 1;
    const c = FIXED.castle;
    if ((i >= c.i0 && i <= c.i1 && j >= c.j0 && j <= c.j1) || j >= FIXED.firstBlockedRow) S.type[k] = T.BLOCK;
  }
  for (const [i, j] of FIXED.statues) S.type[idx(i, j)] = T.BLOCK;
  const gateCells = FIXED.gate.map(([i, j]) => { const k = idx(i, j); S.type[k] = T.GATE; return k; });

  const emit = (e) => { S.events.push(e); };
  const msg = (text, extra = {}) => emit({ type: 'msg', text, t: S.time, ...extra });
  const spend = (cat, amt) => { S.cash -= amt; S.ledger.expense[cat] += amt; };
  const earn = (cat, amt) => { S.cash += amt; S.ledger.income[cat] += amt; };
  const passable = (k) => S.type[k] === T.PATH || S.type[k] === T.GATE;
  const landOf = (i, j) => (inGrid(i, j) ? LANDS[S.land[idx(i, j)] - 1] : null);
  const rides = () => [...S.builds.values()].filter((b) => b.kind === 'ride');

  // ---- building ----
  function canPlace(what, ci, cj, rot = 0) {
    if (what === 'path') {
      if (!inGrid(ci, cj)) return { ok: false, reason: 'Off the map' };
      const t = S.type[idx(ci, cj)];
      if (t === T.PATH) return { ok: false, reason: 'Already a path', quiet: true };
      if (t !== T.EMPTY) return { ok: false, reason: 'Something is in the way' };
      if (S.cash < BAL.pathCost) return { ok: false, reason: 'Not enough cash' };
      return { ok: true, cost: BAL.pathCost };
    }
    if (ADDON_BY_ID[what]) {
      const a = ADDON_BY_ID[what];
      if (!inGrid(ci, cj) || S.type[idx(ci, cj)] !== T.PATH) return { ok: false, reason: 'Goes on a path' };
      if (S.addon[idx(ci, cj)]) return { ok: false, reason: 'This path already has one', quiet: S.addon[idx(ci, cj)] === a.n };
      if (S.cash < a.cost) return { ok: false, reason: 'Not enough cash' };
      return { ok: true, cost: a.cost };
    }
    const def = DEFS[what];
    const fp = footprint(def, ci, cj, rot);
    for (let j = fp.j0; j < fp.j0 + fp.d; j++) for (let i = fp.i0; i < fp.i0 + fp.w; i++) {
      if (!inGrid(i, j) || S.type[idx(i, j)] !== T.EMPTY) return { ok: false, reason: 'Something is in the way', fp };
    }
    let connected = true;
    if (fp.ent) {
      const [ei, ej] = fp.ent;
      if (!inGrid(ei, ej)) return { ok: false, reason: 'The entrance is off the map', fp };
      const t = S.type[idx(ei, ej)];
      if (t !== T.EMPTY && t !== T.PATH) return { ok: false, reason: 'The entrance is blocked', fp };
      connected = t === T.PATH;
    }
    if (S.cash < def.cost) return { ok: false, reason: 'Not enough cash', fp };
    return { ok: true, cost: def.cost, fp, connected };
  }

  function place(what, ci, cj, rot = 0, { free = false } = {}) {
    const chk = free ? { ok: true } : canPlace(what, ci, cj, rot);
    if (!chk.ok) return null;
    if (what === 'path') {
      const k = idx(ci, cj);
      if (S.type[k] !== T.EMPTY) return null;
      S.type[k] = T.PATH;
      if (!free) spend('construction', BAL.pathCost);
      S.dirtyGraph = true; S.version++;
      return { path: k };
    }
    if (ADDON_BY_ID[what]) {
      const k = idx(ci, cj);
      S.addon[k] = ADDON_BY_ID[what].n;
      if (!free) spend('construction', ADDON_BY_ID[what].cost);
      S.dirtyBeauty = true; S.version++;
      return { addon: k };
    }
    const def = DEFS[what], fp = footprint(def, ci, cj, rot);
    const cx = fp.i0 + (fp.w - 1) / 2, cz = fp.j0 + (fp.d - 1) / 2;
    const land = landOf(Math.round(cx), Math.round(cz));
    const b = {
      id: S.nextId++, def: what, kind: def.kind, name: def.name, emoji: def.emoji,
      ci, cj, rot, i0: fp.i0, j0: fp.j0, w: fp.w, d: fp.d,
      ent: fp.ent, entIdx: fp.ent ? idx(fp.ent[0], fp.ent[1]) : -1,
      x: cellX(0) + cx * GRID.size, z: cellZ(0) + cz * GRID.size,
      price: def.price || 0, open: true, state: 'idle', timer: 0, queue: [], riders: [],
      reliability: 100, cycles: 0, reservedUntil: 0, assigned: -1, lastInspect: 0,
      themed: !!(def.land && land && land.id === def.land), land: land ? land.id : null,
      cost: free ? 0 : def.cost, built: S.time, dist: null, connected: false,
      stats: { riders: 0, revenue: 0, upkeep: 0 }, m: { riders: 0, revenue: 0, upkeep: 0, up: 0, down: 0 },
    };
    for (let j = fp.j0; j < fp.j0 + fp.d; j++) for (let i = fp.i0; i < fp.i0 + fp.w; i++) {
      const k = idx(i, j); S.type[k] = T.BUILD; S.owner[k] = b.id;
    }
    S.builds.set(b.id, b);
    if (!free) spend('construction', def.cost);
    if (b.kind === 'ride') S.stats.ridesBuilt++;
    if (b.kind === 'scenery') S.dirtyBeauty = true;
    S.dirtyGraph = true; S.version++;
    return b;
  }
  // player actions refresh the path network at once, so a paused park still shows what connects
  const refresh = (r) => { if (S.dirtyGraph) recomputeGraph(); if (S.dirtyBeauty) recomputeBeauty(); return r; };
  const placePath = (i, j) => refresh(place('path', i, j));
  const placeAddon = (id, i, j) => refresh(place(id, i, j));

  function ejectGuest(g, k) {
    g.mode = 'walk'; g.target = -1; g.ci = g.from = g.to = k; g.prog = 1;
    const p = cellPos(k); g.x = p.x; g.z = p.z;
  }
  function removeBuild(b) {
    for (let j = b.j0; j < b.j0 + b.d; j++) for (let i = b.i0; i < b.i0 + b.w; i++) {
      const k = idx(i, j); S.type[k] = T.EMPTY; S.owner[k] = -1;
    }
    const out = passable(b.entIdx) ? b.entIdx : gateCells[0];
    for (const g of S.guests) if (g.qb === b.id || g.target === b.id) { if (g.mode === 'queue' || g.mode === 'ride') ejectGuest(g, out); g.target = -1; g.qb = -1; }
    const refund = b.reservedUntil > S.time ? 0 : Math.round(b.cost * BAL.refund);
    if (refund) { S.cash += refund; S.ledger.expense.construction -= refund; }
    S.builds.delete(b.id);
    if (b.kind === 'scenery') S.dirtyBeauty = true;
    S.dirtyGraph = true; S.version++;
    return { removed: b, refund };
  }
  function bulldoze(i, j) {
    if (!inGrid(i, j)) return null;
    const k = idx(i, j);
    if (S.type[k] === T.BUILD) return removeBuild(S.builds.get(S.owner[k]));
    if (S.type[k] === T.PATH) {
      if (S.addon[k]) { S.addon[k] = 0; S.dirtyBeauty = true; S.version++; return { addon: k }; }
      S.type[k] = T.EMPTY; S.litter[k] = 0; S.vomit[k] = 0; S.litterVersion++;
      S.dirtyGraph = true; S.version++;
      return { path: k };
    }
    return null;
  }

  // ---- path fields: BFS from every entrance and from the gate ----
  function bfs(sources) {
    const d = new Int16Array(W * H).fill(-1), q = new Int32Array(W * H);
    let h = 0, t = 0;
    for (const s of sources) if (passable(s)) { d[s] = 0; q[t++] = s; }
    while (h < t) {
      const k = q[h++], i = k % W, j = (k / W) | 0;
      for (const [di, dj] of N4) {
        const ni = i + di, nj = j + dj;
        if (!inGrid(ni, nj)) continue;
        const n = idx(ni, nj);
        if (d[n] < 0 && passable(n)) { d[n] = d[k] + 1; q[t++] = n; }
      }
    }
    return d;
  }
  function recomputeGraph() {
    S.dirtyGraph = false;
    S.gateDist = bfs(gateCells);
    for (const b of S.builds.values()) {
      if (b.kind === 'scenery') continue;
      b.dist = passable(b.entIdx) ? bfs([b.entIdx]) : null;
      b.connected = !!b.dist && b.dist[gateCells[0]] >= 0;
    }
    // anyone standing where a path used to be gets walked back onto the network
    for (const g of S.guests) if (g.mode === 'walk' && (!passable(g.ci) || !passable(g.to))) ejectGuest(g, nearestPassable(g.ci));
    for (const s of S.staff) if (!passable(s.ci) || !passable(s.to)) { const k = nearestPassable(s.ci); s.ci = s.from = s.to = k; s.prog = 1; s.mode = 'walk'; s.job = null; }
  }
  function nearestPassable(k) {
    const i0 = k % W, j0 = (k / W) | 0;
    let best = gateCells[0], bd = 1e9;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const n = idx(i, j);
      if (!passable(n) || S.gateDist[n] < 0) continue;
      const d = Math.abs(i - i0) + Math.abs(j - j0);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  function recomputeBeauty() {
    S.dirtyBeauty = false;
    S.beauty.fill(0); S.lit.fill(0);
    let total = 0;
    const spread = (ci, cj, b, r) => {
      const R = Math.ceil(r);
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
        if (!inGrid(i, j)) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d <= r) S.beauty[idx(i, j)] += b * (1 - d / (r + 1));
      }
    };
    for (const b of S.builds.values()) {
      if (b.kind !== 'scenery') continue;
      const def = DEFS[b.def], k = b.themed ? 1.5 : 1;
      spread(b.i0, b.j0, def.beauty * k, def.r); total += def.beauty * k;
    }
    for (let k = 0; k < W * H; k++) {
      if (S.addon[k] !== ADDON_BY_ID.lamp.n) continue;
      const i = k % W, j = (k / W) | 0;
      spread(i, j, 0.4, 1.5); total += 0.3;
      for (let y = j - 2; y <= j + 2; y++) for (let x = i - 2; x <= i + 2; x++) if (inGrid(x, y) && Math.abs(x - i) + Math.abs(y - j) <= 3) S.lit[idx(x, y)] = 1;
    }
    S.beautyTotal = total;
  }

  // ---- guests ----
  const cellPos = (k) => ({ x: cellX(k % W), z: cellZ((k / W) | 0) });
  const recentThoughts = [];
  function think(g, key, b) {
    if ((g.cd[key] || 0) > S.time) return;
    g.cd[key] = S.time + 22 + rand() * 10;
    const text = THOUGHTS[key].replace('{ride}', b ? b.name : 'it').replace('{land}', b?.land ? b.land : landOf(g.ci % W, (g.ci / W) | 0)?.name || 'here');
    g.thoughts.unshift({ text, t: S.time }); if (g.thoughts.length > 5) g.thoughts.pop();
    S.thoughtLog.push({ key, t: S.time, text });
    if (rand() < 0.06) recentThoughts.push({ gid: g.id, text });
  }
  function rideValue(b) { const def = DEFS[b.def]; return def.E * (b.themed ? 1.2 : 1) * 1.25 + 1; }

  function spawnGuest() {
    const k = gateCells[rand() < 0.5 ? 0 : 1];
    const p = cellPos(k);
    const fee = S.entryFee;
    let cash = Math.round(rr(...BAL.guestCash));
    if (fee > cash * 0.6) return;                      // turned away at the booth
    cash -= fee;
    earn('admission', fee);
    const fair = BAL.fairFee + BAL.fairFeePerRide * openRideCount();
    const g = {
      id: S.nextGuest++, name: `${FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]}`,
      ci: k, from: k, to: k, prev: -1, prog: 1, x: p.x, z: p.z, mode: 'walk', target: -1, qb: -1, leaving: false,
      happy: clamp(60 + rand() * 22 + (S.rating - 500) / 30, 20, 95), hunger: rand() * 30, thirst: rand() * 30, bladder: rand() * 20,
      energy: 75 + rand() * 25, nausea: 0, cash, spent: fee, minI: rand() * 3.5, maxI: 3 + rand() * 7, tolN: 45 + rand() * 45,
      stayUntil: S.time + rr(...BAL.stay), hue: rand(), off: (rand() - 0.5) * 0.9, cd: {}, thoughts: [], recent: [],
      queueAt: 0, patience: 0, sitUntil: 0, shopUntil: 0, trash: 0, rides: 0, arrived: S.time,
    };
    if (fee > fair * 1.2) { g.happy -= 10; think(g, 'fee'); }
    S.guests.push(g);
    S.stats.totalGuests++;
  }
  function openRideCount() { let n = 0; for (const b of S.builds.values()) if (b.kind === 'ride' && b.open && b.connected) n++; return n; }
  function shopCount() { let n = 0; for (const b of S.builds.values()) if (b.kind === 'shop' && b.connected) n++; return n; }
  function capacity() { return Math.min(BAL.maxGuests, BAL.capBase + BAL.capPerRide * openRideCount() + BAL.capPerShop * shopCount()); }

  function nearestShop(sells, k, cash) {
    let best = null, bd = 1e9;
    for (const b of S.builds.values()) {
      if (b.kind !== 'shop' || !b.open || DEFS[b.def].sells !== sells || !b.dist || b.price > cash) continue;
      const d = b.dist[k];
      if (d >= 0 && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function pickTarget(g) {
    const k = g.ci;
    let need = null;
    if (g.bladder > 62) need = 'toilet'; else if (g.hunger > 55) need = 'food'; else if (g.thirst > 55) need = 'drink';
    if (need) {
      const s = nearestShop(need, k, g.cash);
      if (s) { g.target = s.id; return; }
      think(g, { toilet: 'notoilet', food: 'nofood', drink: 'nodrink' }[need]);
    }
    if (g.cash > 6 && rand() < 0.06) { const s = nearestShop('souvenir', k, g.cash); if (s && s.dist[k] < 14) { g.target = s.id; return; } }
    let best = null, bestS = 0, n = 0, tooIntense = null, tooDear = null, full = null, dull = 0;
    for (const b of S.builds.values()) {
      if (b.kind !== 'ride' || !b.open || b.state === 'broken' || !b.dist) continue;
      const d = b.dist[k]; if (d < 0) continue;
      n++;
      const def = DEFS[b.def];
      if (def.I > g.maxI) { tooIntense = b; continue; }
      if (b.price > rideValue(b) * 1.35 || b.price > g.cash) { tooDear = b; continue; }
      if (b.queue.length >= BAL.queueCap) { full = b; continue; }
      let s = def.E * (b.themed ? 1.2 : 1) + 2 + Math.min(1.5, S.beauty[b.entIdx] * 0.2);
      if (def.I < g.minI) { s *= 0.45; dull++; }
      s -= d * 0.08 + b.queue.length * 0.09;
      if (g.recent.includes(b.id)) s *= 0.3;
      s *= 0.7 + rand() * 0.6;
      if (s > bestS) { bestS = s; best = b; }
    }
    if (best) { g.target = best.id; return; }
    if (tooDear && rand() < 0.6) think(g, 'expensive', tooDear);
    else if (tooIntense && rand() < 0.5) think(g, 'intense', tooIntense);
    else if (full) think(g, 'queue', full);
    else if (dull) think(g, 'boring');
    else if (n === 0 && rand() < 0.4) think(g, 'nothing');
  }

  function stepTo(g, n) { g.prev = g.ci; g.from = g.ci; g.to = n; g.prog = 0; }
  function wander(g, allowGate = false) {
    const k = g.ci, i = k % W, j = (k / W) | 0, opts = [];
    let straight = -1;
    for (const [di, dj] of N4) {
      const ni = i + di, nj = j + dj;
      if (!inGrid(ni, nj)) continue;
      const n = idx(ni, nj);
      if (!passable(n) || (S.type[n] === T.GATE && !allowGate) || n === g.prev) continue;
      opts.push(n);
      if (g.prev >= 0 && n - k === k - g.prev) straight = n;
    }
    if (!opts.length) { if (g.prev >= 0 && passable(g.prev)) stepTo(g, g.prev); return; }
    stepTo(g, straight >= 0 && rand() < 0.55 ? straight : opts[Math.floor(rand() * opts.length)]);
  }
  function follow(g, field) {
    const k = g.ci, d = field[k], i = k % W, j = (k / W) | 0, opts = [];
    for (const [di, dj] of N4) {
      const ni = i + di, nj = j + dj;
      if (inGrid(ni, nj) && field[idx(ni, nj)] === d - 1) opts.push(idx(ni, nj));
    }
    if (opts.length) stepTo(g, opts[Math.floor(rand() * opts.length)]);
  }

  function arriveAt(g, b) {
    g.target = -1;
    const def = DEFS[b.def];
    if (b.kind === 'ride') {
      if (!b.open || b.state === 'broken') { think(g, 'broken', b); return; }
      if (b.queue.length >= BAL.queueCap) { think(g, 'queue', b); return; }
      if (b.price > g.cash) { think(g, 'broke'); return; }
      g.mode = 'queue'; g.qb = b.id; g.queueAt = S.time; g.patience = rr(...BAL.queuePatience);
      b.queue.push(g.id);
      return;
    }
    if (b.price > g.cash) { think(g, 'broke'); return; }
    g.cash -= b.price; g.spent += b.price;
    if (b.price) { earn('stalls', b.price); spend('stock', b.price * BAL.stockShare); b.stats.revenue += b.price; b.m.revenue += b.price; }
    b.stats.riders++; b.m.riders++;
    if (def.sells === 'food') { g.hunger = Math.max(0, g.hunger - 75); g.happy += 4; g.trash = rr(4, 12); }
    else if (def.sells === 'drink') { g.thirst = Math.max(0, g.thirst - 80); g.bladder += 22; g.happy += 3; g.trash = rr(4, 12); }
    else if (def.sells === 'souvenir') g.happy += 10;
    else if (def.sells === 'toilet') { g.bladder = 0; g.happy += 3; }
    g.mode = 'shop'; g.shopUntil = S.time + 1.2;
    g.recent.unshift(b.id); if (g.recent.length > 3) g.recent.pop();
  }

  function onCell(g) {
    const k = g.ci;
    const dirt = S.litter[k] + 2 * S.vomit[k];
    if (dirt) { g.happy -= Math.min(6, dirt * 1.1); if (dirt >= 3 || S.vomit[k]) think(g, 'dirty'); }
    if (S.beauty[k] > 1) { g.happy += Math.min(2.5, S.beauty[k] * 0.3); if (S.beauty[k] > 3) think(g, 'scenery'); }
    if (nightness(S.time) > 0.7 && !S.lit[k] && S.type[k] === T.PATH) { g.happy -= 0.25; if (rand() < 0.15) think(g, 'dark'); }
    if (S.land[k] && rand() < 0.015) think(g, 'theme', { name: '', land: LANDS[S.land[k] - 1].name });
    else if (S.litterTotal + S.vomitTotal < 3 && S.guests.length > 30 && rand() < 0.006) think(g, 'clean');
    if (S.addon[k] === ADDON_BY_ID.bench.n && g.energy < 45 && !g.leaving) { g.mode = 'sit'; g.sitUntil = S.time + 6; return; }
    if (g.leaving && S.type[k] === T.GATE) { g.mode = 'gone'; return; }
    if (g.target >= 0) {
      const b = S.builds.get(g.target);
      if (!b) g.target = -1;
      else if (k === b.entIdx) arriveAt(g, b);
    }
  }
  function decide(g) {
    if (g.mode !== 'walk') return;
    if (!g.leaving && (S.time > g.stayUntil || g.happy < 14 || g.energy < 4 || (g.cash < 1 && rand() < 0.2))) {
      g.leaving = true; g.target = -1;
      if (g.happy < 30) { S.stats.leftUnhappy++; think(g, 'home'); }
      else if (g.cash < 1) think(g, 'broke');
    }
    let field = null;
    if (g.leaving) field = S.gateDist;
    else {
      if (g.target < 0 && (rand() < 0.6 || g.hunger > 55 || g.thirst > 55 || g.bladder > 62)) pickTarget(g);
      if (g.target >= 0) {
        const b = S.builds.get(g.target);
        if (!b?.dist || b.dist[g.ci] < 0) { if (b) think(g, 'cantfind', b); g.target = -1; }
        else field = b.dist;
      }
    }
    if (field && field[g.ci] === 0 && !g.leaving) { arriveAt(g, S.builds.get(g.target)); return; }
    if (field && field[g.ci] > 0) follow(g, field);
    else wander(g, g.leaving);
  }
  function dropTrash(g) {
    const k = g.ci, i = k % W, j = (k / W) | 0;
    for (let y = j - 2; y <= j + 2; y++) for (let x = i - 2; x <= i + 2; x++) if (inGrid(x, y) && S.addon[idx(x, y)] === ADDON_BY_ID.bin.n) return;
    if (rand() < 0.5) return;                       // half of them carry it out
    if (S.type[k] === T.PATH && S.litter[k] < BAL.litterMax) { S.litter[k]++; S.litterTotal++; S.litterVersion++; }
  }
  function stepGuest(g, dt) {
    g.hunger = Math.min(100, g.hunger + BAL.hunger * dt);
    g.thirst = Math.min(100, g.thirst + BAL.thirst * dt);
    g.bladder = Math.min(100, g.bladder + BAL.bladder * dt);
    g.energy = clamp(g.energy + (g.mode === 'sit' ? BAL.sit : g.mode === 'ride' ? 0 : -BAL.tire) * dt, 0, 100);
    g.nausea = Math.max(0, g.nausea - BAL.nauseaDecay * dt);
    if (g.hunger > 75) { g.happy -= 0.25 * dt; think(g, 'hungry'); }
    if (g.thirst > 75) { g.happy -= 0.25 * dt; think(g, 'thirsty'); }
    if (g.bladder > 80) { g.happy -= 0.45 * dt; think(g, 'toilet'); }
    if (g.energy < 20) { g.happy -= 0.15 * dt; think(g, 'tired'); }
    if (g.nausea > 60) { g.happy -= 0.2 * dt; think(g, 'sick'); }
    if (g.trash > 0 && g.mode === 'walk') { g.trash -= dt; if (g.trash <= 0) dropTrash(g); }
    g.happy = clamp(g.happy, 0, 100);

    if (g.mode === 'walk') {
      if (g.prog < 1) {
        g.prog = Math.min(1, g.prog + (BAL.guestSpeed / GRID.size) * dt);
        if (g.prog >= 1) { g.ci = g.to; onCell(g); decide(g); }
      } else decide(g);
      const a = cellPos(g.from), b = cellPos(g.to), p = g.prog;
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      g.x = a.x + dx * p - (dz / L) * g.off; g.z = a.z + dz * p + (dx / L) * g.off;
      if (L < 0.01) { g.x = a.x + g.off * 0.6; g.z = a.z + g.off * 0.3; }
      g.dir = Math.atan2(dx, dz);
    } else if (g.mode === 'queue') {
      const b = S.builds.get(g.qb);
      const waited = S.time - g.queueAt;
      if (!b || waited > g.patience || (b.state === 'broken' && waited > 8) || !b.open) {
        if (b) { b.queue.splice(b.queue.indexOf(g.id), 1); think(g, b.state === 'broken' ? 'broken' : 'queue', b); }
        g.happy -= 6; g.qb = -1; g.mode = 'walk'; g.prog = 1;
        return;
      }
      g.happy -= 0.05 * dt;
      const slot = b.queue.indexOf(g.id), e = cellPos(b.entIdx);
      const col = slot % 4, row = Math.floor(slot / 4);
      g.x = e.x - 0.75 + col * 0.5; g.z = e.z - 0.75 + (row % 4) * 0.5 + Math.floor(row / 4) * 0.12;
    } else if (g.mode === 'sit') {
      if (S.time > g.sitUntil || g.energy > 95) { g.mode = 'walk'; decide(g); }
    } else if (g.mode === 'shop') {
      if (S.time > g.shopUntil) { g.mode = 'walk'; decide(g); }
    }
  }

  // ---- rides ----
  function startCycle(b) {
    const def = DEFS[b.def];
    if (rand() < BAL.breakBase * (1 + (100 - b.reliability) / 12)) { breakDown(b); return; }
    const ids = b.queue.splice(0, def.cap);
    b.riders = [];
    for (const id of ids) {
      const g = S.guests.find((q) => q.id === id);
      if (!g) continue;
      if (g.cash < b.price) { think(g, 'broke'); g.mode = 'walk'; g.qb = -1; continue; }
      g.cash -= b.price; g.spent += b.price;
      earn('rides', b.price); b.stats.revenue += b.price; b.m.revenue += b.price;
      g.mode = 'ride'; b.riders.push(g);
    }
    b.stats.riders += b.riders.length; b.m.riders += b.riders.length;
    b.state = 'running'; b.timer = def.cycle; b.cycles++;
    b.reliability = Math.max(0, b.reliability - BAL.wear);
  }
  function endCycle(b) {
    const def = DEFS[b.def];
    for (const g of b.riders) {
      if (g.mode !== 'ride') continue;
      const fit = def.I < g.minI ? 0.6 : 1;
      g.happy = clamp(g.happy + (5 + def.E * 2.4 * (b.themed ? 1.2 : 1)) * fit, 0, 100);
      g.nausea += def.N * 7 * (0.6 + rand() * 0.8);
      g.energy -= 2; g.rides++;
      ejectGuest(g, b.entIdx); g.qb = -1;
      g.recent.unshift(b.id); if (g.recent.length > 3) g.recent.pop();
      if (g.nausea > g.tolN && rand() < 0.55) {
        g.happy -= 12; g.nausea *= 0.4; think(g, 'sick');
        if (S.vomit[b.entIdx] < BAL.litterMax) { S.vomit[b.entIdx]++; S.vomitTotal++; S.litterVersion++; }
      } else if (rand() < 0.3) think(g, b.price < rideValue(b) * 0.7 ? 'value' : 'great', b);
    }
    b.riders = []; b.state = 'idle'; b.timer = 0;
  }
  function breakDown(b) {
    b.state = 'broken'; b.brokeAt = S.time;
    for (const id of b.queue) { const g = S.guests.find((q) => q.id === id); if (g) think(g, 'broken', b); }
    emit({ type: 'breakdown', id: b.id, text: `🛠️ ${b.name} has broken down!`, t: S.time });
  }
  function fix(b, by) {
    if (b.state !== 'broken') return false;
    b.state = 'idle'; b.timer = 0; b.assigned = -1;
    b.reliability = Math.min(100, b.reliability + BAL.fixGain);
    emit({ type: 'fixed', id: b.id, by, text: `✅ ${b.name} is running again`, t: S.time });
    return true;
  }
  function stepRide(b, dt) {
    const def = DEFS[b.def];
    if (b.state === 'broken') { b.m.down += dt; S.stats.downT += dt; return; }
    b.m.up += dt; S.stats.upT += dt;
    if (b.state === 'running') { b.timer -= dt; if (b.timer <= 0) endCycle(b); return; }
    if (!b.open) return;
    if (b.queue.length) { b.timer += dt; if (b.timer >= BAL.loadWait || b.queue.length >= def.cap) startCycle(b); }
  }

  // ---- staff ----
  function hire(kind) {
    const def = STAFF_BY_ID[kind];
    if (!def || S.cash < def.hire) return null;
    spend('staff', def.hire);
    const k = gateCells[0], p = cellPos(k);
    const s = { id: S.nextStaff++, kind, name: `${def.name} #${S.staff.filter((q) => q.kind === kind).length + 1}`,
      ci: k, from: k, to: k, prev: -1, prog: 1, x: p.x, z: p.z, dir: 0, mode: 'walk', job: null, timer: 0, done: 0 };
    S.staff.push(s); S.version++;
    return s;
  }
  function fire(id) {
    const i = S.staff.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const s = S.staff[i];
    if (s.job?.b) { const b = S.builds.get(s.job.b); if (b && b.assigned === s.id) b.assigned = -1; }
    S.staff.splice(i, 1); S.version++;
    return true;
  }
  function nearestDirty(k, depth = 16) {
    const seen = new Map([[k, -1]]), q = [k];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (c !== k && (S.litter[c] || S.vomit[c])) { let n = c; while (seen.get(n) !== k && seen.get(n) !== -1) n = seen.get(n); return n; }
      if (h > depth * depth) break;
      const i = c % W, j = (c / W) | 0;
      for (const [di, dj] of N4) {
        const ni = i + di, nj = j + dj;
        if (!inGrid(ni, nj)) continue;
        const n = idx(ni, nj);
        if (!seen.has(n) && S.type[n] === T.PATH) { seen.set(n, c); q.push(n); }
      }
    }
    return -1;
  }
  function staffDecide(s) {
    const k = s.ci;
    if (s.kind === 'janitor') {
      if (S.litter[k] || S.vomit[k]) { s.mode = 'work'; s.timer = 0.5 + 0.25 * (S.litter[k] + S.vomit[k]); s.job = { sweep: k }; return; }
      const n = nearestDirty(k);
      if (n >= 0) { stepTo(s, n); return; }
    } else if (s.kind === 'mechanic') {
      let b = s.job ? S.builds.get(s.job.b) : null;
      if (s.job && (!b?.dist || b.dist[k] < 0 || (s.job.fix && b.state !== 'broken'))) { if (b && b.assigned === s.id) b.assigned = -1; s.job = null; b = null; }
      if (!s.job) {
        let best = null, bd = 1e9, inspect = null, id = 1e9;
        for (const r of rides()) {
          if (!r.dist || r.dist[k] < 0 || (r.assigned >= 0 && r.assigned !== s.id)) continue;
          if (r.state === 'broken' && r.dist[k] < bd) { bd = r.dist[k]; best = r; }
          else if (r.reliability < 80 && S.time - r.lastInspect > 25 && r.dist[k] < id) { id = r.dist[k]; inspect = r; }
        }
        const pick = best || inspect;
        if (pick) { s.job = { b: pick.id, fix: !!best }; pick.assigned = s.id; b = pick; }
      }
      if (b) {
        if (b.dist[k] === 0) { s.mode = 'work'; s.timer = s.job.fix ? BAL.fixTime : BAL.inspectTime; return; }
        follow(s, b.dist); return;
      }
    }
    wander(s);
  }
  function stepStaff(s, dt) {
    if (s.mode === 'work') {
      s.timer -= dt;
      if (s.timer > 0) return;
      s.mode = 'walk';
      if (s.job && s.job.sweep !== undefined) {
        const k = s.job.sweep;
        S.litterTotal -= S.litter[k]; S.vomitTotal -= S.vomit[k]; S.litter[k] = 0; S.vomit[k] = 0;   // one pass sweeps the whole tile
        S.litterVersion++; s.done++; s.job = null;
      } else if (s.job) {
        const b = S.builds.get(s.job.b);
        if (b) { if (s.job.fix) fix(b, s.name); else { b.reliability = Math.min(100, b.reliability + BAL.inspectGain); b.lastInspect = S.time; } b.assigned = -1; s.done++; }
        s.job = null;
      }
      staffDecide(s);
      return;
    }
    if (s.prog < 1) {
      s.prog = Math.min(1, s.prog + (BAL.staffSpeed / GRID.size) * dt);
      if (s.prog >= 1) { s.ci = s.to; staffDecide(s); }
    } else staffDecide(s);
    const a = cellPos(s.from), b = cellPos(s.to);
    s.x = a.x + (b.x - a.x) * s.prog; s.z = a.z + (b.z - a.z) * s.prog;
    if (a.x !== b.x || a.z !== b.z) s.dir = Math.atan2(b.x - a.x, b.z - a.z);
  }

  // ---- money, rating, months ----
  function stepMoney(dt) {
    let upkeep = 0;
    for (const b of S.builds.values()) {
      if (b.kind === 'scenery') continue;
      const def = DEFS[b.def];
      let u = (def.upkeep / MONTH) * dt;
      if (b.reservedUntil > S.time) u = 0;
      else if (b.kind === 'ride' && !b.open) u *= BAL.closedUpkeep;
      b.stats.upkeep += u; b.m.upkeep += u; upkeep += u;
    }
    spend('upkeep', upkeep);
    let wages = 0;
    for (const s of S.staff) wages += (STAFF_BY_ID[s.kind].wage / MONTH) * dt;
    spend('staff', wages);
    if (S.cash < 0) spend('interest', ((-S.cash * BAL.interest) / MONTH) * dt);
  }
  function stepRating() {
    const n = S.guests.length;
    let happy = 0, critical = 0;
    for (const g of S.guests) { happy += g.happy; if (g.hunger > 88 || g.thirst > 88 || g.bladder > 90) critical++; }
    const avg = n ? happy / n : 60;
    let broken = 0;
    for (const b of S.builds.values()) if (b.state === 'broken') broken++;
    let r = 360 + (avg - 50) * 4 + Math.min(230, openRideCount() * 22) + Math.min(90, S.beautyTotal * 0.6)
      - Math.min(160, S.litterTotal * 3.5) - Math.min(120, S.vomitTotal * 7) - broken * 30 - (n ? (critical / n) * 180 : 0);
    if (n === 0) r = Math.min(r, 480);
    S.rating += (clamp(r, 0, 999) - S.rating) * 0.25;
    S.stats.bestRating = Math.max(S.stats.bestRating, S.rating);
  }
  function thoughtSummary(window = 60) {
    while (S.thoughtLog.length && S.thoughtLog[0].t < S.time - 120) S.thoughtLog.shift();
    const counts = {};
    for (const t of S.thoughtLog) {
      if (t.t < S.time - window) continue;
      if (!counts[t.key]) counts[t.key] = { key: t.key, text: t.text, n: 0 };
      counts[t.key].n++;
    }
    return Object.values(counts).sort((a, b) => b.n - a.n);
  }
  function stepAdvice() {
    const n = S.guests.length;
    if (n < 15) return;
    for (const t of thoughtSummary(45)) {
      if (t.n < Math.max(6, n * 0.08)) break;
      if (!ADVICE[t.key] || (S.adviceAt[t.key] || -1e9) > S.time - 90) continue;
      S.adviceAt[t.key] = S.time;
      msg(ADVICE[t.key], { advice: t.key });
      break;
    }
  }
  function monthLabel(m) { return `${MONTH_NAMES[m % 12]} Y${Math.floor(m / 12) + 1}`; }
  function closeMonth() {
    const m = S.month;
    const util = rides().map((b) => {
      const def = DEFS[b.def];
      const slots = def.cap * (MONTH / (def.cycle + BAL.loadWait));
      return { id: b.id, name: b.name, emoji: b.emoji, util: slots ? b.m.riders / slots : 0, riders: b.m.riders,
        revenue: b.m.revenue, upkeep: b.m.upkeep, reserved: b.reservedUntil > S.time, open: b.open };
    });
    const income = sum(S.ledger.income), expense = sum(S.ledger.expense);
    const bill = {
      month: m, label: monthLabel(m), ledger: S.ledger, income, expense, profit: income - expense,
      guests: S.guests.length, rating: Math.round(S.rating), cash: S.cash, rides: util,
      idle: util.filter((u) => u.util < 0.2 && !u.reserved && u.open),
    };
    S.history.push(bill);
    if (S.history.length > 24) S.history.shift();
    emit({ type: 'month', bill, t: S.time });
    S.ledger = newLedger();
    for (const b of S.builds.values()) b.m = { riders: 0, revenue: 0, upkeep: 0, up: 0, down: 0 };
    S.month = m + 1;
    if (S.cash < BAL.bankrupt) return end('bankrupt');
    if (sc.months && S.month >= sc.months) end(goalMet() ? 'win' : 'lose');
  }
  function goalMet() { return !sc.goal || (S.guests.length >= sc.goal.guests && S.rating >= sc.goal.rating); }
  function end(outcome) {
    if (S.ended) return;
    S.ended = true; S.outcome = outcome;
    emit({ type: 'end', outcome, result: result(), t: S.time });
  }
  function parkValue() {
    let v = 0;
    for (const b of S.builds.values()) v += b.cost * (b.kind === 'scenery' ? 0.5 : 0.7);
    return Math.round(S.cash + v + S.guests.length * 25);
  }
  function uptime() { const t = S.stats.upT + S.stats.downT; return t ? Math.round((100 * S.stats.upT) / t) : 100; }
  function result() {
    return {
      game: 'costbotland', stageId: sc.id, outcome: S.outcome, dollarsSaved: 0,
      score: Math.max(0, parkValue()), guests: S.stats.peakGuests, stars: +(S.stats.bestRating / 200).toFixed(1),
      uptime: uptime(), combo: S.stats.ridesBuilt, rating: Math.round(S.rating), monthsPlayed: S.month,
    };
  }
  function milestones() {
    const n = S.guests.length;
    for (const m of [1, 50, 100, 200, 300, 400, 500]) {
      if (n >= m && !S.milestones.has(`g${m}`)) { S.milestones.add(`g${m}`); msg(m === 1 ? '🎟️ Your first guest just walked through the gate!' : `👥 ${m} guests in the park!`, { good: true }); }
    }
    for (const r of [600, 700, 800]) {
      if (S.rating >= r && !S.milestones.has(`r${r}`)) { S.milestones.add(`r${r}`); msg(`⭐ Park rating hit ${r}!`, { good: true }); }
    }
  }

  // ---- the tick ----
  const TICK = 0.1;
  let acc = 0;
  function tick(dt) {
    if (S.dirtyGraph) recomputeGraph();
    if (S.dirtyBeauty) recomputeBeauty();
    S.time += dt;
    // arrivals
    if (!S.ended || !sc.months) {
      const open = openRideCount();
      const fair = BAL.fairFee + BAL.fairFeePerRide * open;
      const feeF = clamp(1.25 - S.entryFee / (fair * 1.6), 0.08, 1.2);
      const rateF = 0.35 + S.rating / 650;
      const camp = S.campaignUntil > S.time ? BAL.campaign.boost : 1;
      const rate = open ? (BAL.arrBase + BAL.arrPerRide * open) * rateF * feeF * camp : 0.04;
      S.arrivalAcc += rate * dt;
      while (S.arrivalAcc >= 1) { S.arrivalAcc -= 1; if (S.guests.length < capacity()) spawnGuest(); }
    }
    for (const b of S.builds.values()) if (b.kind === 'ride') stepRide(b, dt);
    for (const g of S.guests) stepGuest(g, dt);
    if (S.guests.some((g) => g.mode === 'gone')) S.guests = S.guests.filter((g) => g.mode !== 'gone');
    for (const s of S.staff) stepStaff(s, dt);
    S._hypeT += dt;
    if (S._hypeT >= 1) {
      S._hypeT = 0;
      for (const s of S.staff) {
        if (s.kind !== 'entertainer') continue;
        for (const g of S.guests) if (g.mode !== 'ride' && Math.abs(g.x - s.x) < 4 && Math.abs(g.z - s.z) < 4) { g.happy = Math.min(100, g.happy + 1.2); if (rand() < 0.04) think(g, 'entertained'); }
      }
    }
    stepMoney(dt);
    S._ratingT += dt; if (S._ratingT >= 2) { S._ratingT = 0; stepRating(); milestones(); }
    S._adviceT += dt; if (S._adviceT >= 10) { S._adviceT = 0; stepAdvice(); }
    S.stats.peakGuests = Math.max(S.stats.peakGuests, S.guests.length);
    if (Math.floor(S.time / MONTH) > S.month && !(S.ended && sc.months)) closeMonth();
  }
  function step(dt) {
    acc += dt;
    while (acc >= TICK) { acc -= TICK; tick(TICK); }
  }

  // ---- player actions ----
  function setPrice(id, p) { const b = S.builds.get(id); if (b && b.kind !== 'scenery') b.price = clamp(Math.round(p), 0, 20); return b?.price; }
  function setOpen(id, open) {
    const b = S.builds.get(id); if (!b || b.kind === 'scenery') return false;
    b.open = open;
    if (!open) for (const gid of b.queue.splice(0)) { const g = S.guests.find((q) => q.id === gid); if (g) { g.mode = 'walk'; g.qb = -1; g.prog = 1; } }
    return true;
  }
  function reserveCost(b) { return Math.round(DEFS[b.def].upkeep * BAL.reserve.months * BAL.reserve.share); }
  function reserve(id) {
    const b = S.builds.get(id);
    if (!b || b.kind === 'scenery' || b.reservedUntil > S.time) return false;
    const c = reserveCost(b);
    if (S.cash < c) return false;
    spend('reserved', c);
    b.reservedUntil = S.time + BAL.reserve.months * MONTH;
    msg(`📝 Reserved ${b.name} for ${BAL.reserve.months} months — no upkeep bill until ${monthLabel(Math.floor(b.reservedUntil / MONTH))}.`);
    return true;
  }
  function quickFix(id) {
    const b = S.builds.get(id);
    if (!b || b.state !== 'broken' || S.quickFixReadyAt > S.time) return false;
    S.quickFixReadyAt = S.time + BAL.quickFixCooldown;
    return fix(b, 'CostBot');
  }
  function setEntryFee(v) { S.entryFee = clamp(Math.round(v), 0, 50); return S.entryFee; }
  function campaign() {
    if (S.cash < BAL.campaign.cost || S.campaignUntil > S.time) return false;
    spend('marketing', BAL.campaign.cost);
    S.campaignUntil = S.time + BAL.campaign.months * MONTH;
    msg('📣 Ad campaign running — expect more guests this month.');
    return true;
  }
  function drainEvents() { const e = S.events; S.events = []; return e; }
  function drainBubbles() { return recentThoughts.splice(0); }

  function snapshot() {
    const paths = [], addons = [], litter = [];
    for (let k = 0; k < W * H; k++) {
      if (S.type[k] === T.PATH) paths.push(k);
      if (S.addon[k]) addons.push([k, S.addon[k]]);
      if (S.litter[k] || S.vomit[k]) litter.push([k, S.litter[k], S.vomit[k]]);
    }
    return {
      v: 1, scenario: sc.id, seed, time: S.time, month: S.month, cash: S.cash, entryFee: S.entryFee, rating: S.rating,
      campaignUntil: S.campaignUntil, quickFixReadyAt: S.quickFixReadyAt, ledger: S.ledger, history: S.history, stats: S.stats,
      milestones: [...S.milestones], ended: S.ended, outcome: S.outcome, paths, addons, litter,
      builds: [...S.builds.values()].map((b) => ({ def: b.def, ci: b.ci, cj: b.cj, rot: b.rot, price: b.price, open: b.open,
        reliability: b.reliability, reservedUntil: b.reservedUntil, cycles: b.cycles, cost: b.cost, built: b.built, stats: b.stats })),
      staff: S.staff.map((s) => s.kind),
    };
  }
  function restore(snap) {
    for (const k of snap.paths) S.type[k] = T.PATH;
    for (const [k, n] of snap.addons) if (ADDON_BY_N[n]) S.addon[k] = n;
    for (const [k, l, v] of snap.litter || []) { S.litter[k] = l; S.vomit[k] = v; S.litterTotal += l; S.vomitTotal += v; }
    for (const s of snap.builds) {
      const b = place(s.def, s.ci, s.cj, s.rot, { free: true });
      if (!b) continue;
      Object.assign(b, { price: s.price, open: s.open, reliability: s.reliability, reservedUntil: s.reservedUntil,
        cycles: s.cycles, cost: s.cost, built: s.built, stats: s.stats || b.stats });
    }
    Object.assign(S, { time: snap.time, month: snap.month, cash: snap.cash, entryFee: snap.entryFee, rating: snap.rating,
      campaignUntil: snap.campaignUntil, quickFixReadyAt: snap.quickFixReadyAt, ledger: snap.ledger, history: snap.history,
      stats: snap.stats, ended: snap.ended, outcome: snap.outcome });
    S.milestones = new Set(snap.milestones);
    for (const kind of snap.staff) { const s = hire(kind); if (s) S.cash += STAFF_BY_ID[kind].hire; }
    S.ledger.expense.staff = snap.ledger.expense.staff;
    S.dirtyGraph = S.dirtyBeauty = true; S.version++; S.litterVersion++;
  }

  // ---- the park as it opens: Main Street, a ring round the castle, a carousel and a churro cart ----
  function seedPark() {
    const path = (i, j) => place('path', i, j, 0, { free: true });
    for (let j = 21; j <= 33; j++) { path(24, j); path(25, j); }
    for (let i = 19; i <= 30; i++) { path(i, 20); path(i, 11); }
    for (let j = 11; j <= 20; j++) { path(19, j); path(30, j); }
    for (const j of [22, 25, 28, 31]) { S.addon[idx(24, j)] = ADDON_BY_ID.lamp.n; S.addon[idx(25, j + 1)] = ADDON_BY_ID.lamp.n; }
    S.addon[idx(24, 30)] = ADDON_BY_ID.bin.n;
    const c = place('carousel', 26, 25, 1, { free: true }); if (c) c.cost = DEFS.carousel.cost;
    place('churro', 23, 27, 3, { free: true });
    place('tree', 22, 30, 0, { free: true }); place('tree', 27, 31, 0, { free: true });
    place('flowers', 23, 22, 0, { free: true }); place('flowers', 26, 22, 0, { free: true });
    S.dirtyBeauty = true;
    S.arrivalAcc = 14;               // an opening-day crowd is already at the gate
  }

  return {
    S, T, W, H, gateCells, seedPark,
    canPlace, place: (what, i, j, rot, o) => (o?.free ? place(what, i, j, rot, o) : refresh(place(what, i, j, rot))), placePath, placeAddon,
    bulldoze: (i, j) => refresh(bulldoze(i, j)), hire, fire,
    setPrice, setOpen, reserve, reserveCost, quickFix, setEntryFee, campaign,
    step, drainEvents, drainBubbles, thoughtSummary, snapshot, restore,
    parkValue, uptime, result, capacity, openRideCount, rideValue, goalMet, monthLabel,
    passable, nightness: () => nightness(S.time),
    date() { const m = Math.floor(S.time / MONTH); return { month: m, label: monthLabel(m), frac: (S.time / MONTH) % 1 }; },
    endNow(outcome) { end(outcome); },
    keepPlaying() { sc.months = 0; },
  };
}
