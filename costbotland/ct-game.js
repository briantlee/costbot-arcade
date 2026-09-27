/* ============================================================================
 * CostBotLand Tycoon — the game: camera, tools, HUD, panels, saving, results
 * ----------------------------------------------------------------------------
 *   import { mount } from './ct-game.js';
 *   const game = mount('#game', { onEvent, onComplete, meta });
 *
 * ct-sim.js owns the rules, ct-world.js owns the pictures; this file turns the
 * player's clicks into sim calls and the sim's state into HUD numbers. The run
 * result reuses the existing `costbotland` leaderboard columns: score is park
 * value, guests is peak guests, stars is park rating / 200, uptime is ride
 * uptime, combo is rides built.
 * ==========================================================================*/
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCostBot, DANCES } from '../shared/costbot-3d.js';
import { createSim, T, idx, inGrid } from './ct-sim.js';
import { createWorld } from './ct-world.js';
import { GRID, RIDES, SHOPS, SCENERY, ADDONS, STAFF, DEFS, ADDON_BY_ID, STAFF_BY_ID, BAL, SCENARIOS, MONTH, LANDS, ADVICE } from './ct-content.js';

const SAVE_KEY = 'costbot.tycoon.save.v1';
const META_KEY = 'costbot.tycoon.meta.v1';
const TOUCH = matchMedia('(pointer: coarse)').matches;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const bar = (v, max = 100, cls = '') => `<span class="bar ${cls}"><i style="width:${clamp((v / max) * 100, 0, 100)}%"></i></span>`;

export function mount(container, opts = {}) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  const onEvent = opts.onEvent || (() => {});
  const onComplete = opts.onComplete || (() => {});
  const meta = Object.assign({ plays: 0, wins: 0, bestScore: 0, bestGuests: 0, bestRating: 0 }, readJSON(META_KEY), opts.meta || {});

  // ---- renderer ----
  const renderer = new THREE.WebGLRenderer({ antialias: !TOUCH });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !TOUCH;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 900);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const world = createWorld(scene, { touch: TOUCH });

  // CostBot himself: patrols the sky, and flies down when you ask him to fix something
  const flyer = createCostBot({ style: 'glossy', shadows: !TOUCH });
  flyer.root.scale.setScalar(1.7);
  scene.add(flyer.root);
  const fly = { x: 0, z: 0, y: 17, yaw: 0, to: null, until: 0, bank: 0 };

  // ---- the UI ----
  const ui = document.createElement('div');
  ui.className = 'ct-ui';
  ui.innerHTML = `
    <div class="ct-top">
      <a class="pill" href="../index.html" data-a="arcade" title="Back to the CostBot Arcade"><img src="../shared/assets/costbot.png" alt="">←</a>
      <span class="pill stat" data-a="finance" title="Cash (F for finances)">💰 <b data-v="cash">$0</b></span>
      <span class="pill stat" data-a="thoughts" title="Guests in the park / park capacity (T for thoughts)">👥 <b data-v="guests">0</b><small data-v="cap"></small></span>
      <span class="pill stat" data-a="thoughts" title="Park rating, 0-999">⭐ <b data-v="rating">500</b></span>
      <span class="pill stat" data-a="goal" title="Date (G for the goal)">📅 <b data-v="date">Mar Y1</b><span class="mbar"><i data-v="month"></i></span></span>
      <span class="pill stat goal" data-a="goal" data-v="goal"></span>
      <span class="sp"></span>
      <span class="speed">
        <button class="pill" data-speed="0" title="Pause (Space)">⏸</button>
        <button class="pill" data-speed="1" title="Normal speed (1)">▶</button>
        <button class="pill" data-speed="2" title="Fast (2)">⏩</button>
        <button class="pill" data-speed="4" title="Fastest (3)">⏭</button>
      </span>
    </div>
    <div class="ct-feed"></div>
    <div class="ct-toast"></div>
    <div class="ct-tip"></div>
    <aside class="ct-side"></aside>
    <div class="ct-palette"></div>
    <nav class="ct-bar">
      <button data-tool="path" title="Path (P)">🛤️<span>Path</span></button>
      <button data-cat="rides" title="Rides">🎢<span>Rides</span></button>
      <button data-cat="shops" title="Stalls">🍔<span>Stalls</span></button>
      <button data-cat="extras" title="Benches, bins, lamps">🪑<span>Extras</span></button>
      <button data-cat="scenery" title="Scenery">🌳<span>Scenery</span></button>
      <button data-cat="staff" title="Staff">👷<span>Staff</span></button>
      <button data-tool="bulldoze" title="Bulldoze (B)">🚜<span>Bulldoze</span></button>
      <i class="gap"></i>
      <button data-a="finance" title="Finances (F)">💰<span>Money</span></button>
      <button data-a="thoughts" title="Guest thoughts (T)">💭<span>Thoughts</span></button>
      <button data-a="goal" title="Goal (G)">🎯<span>Goal</span></button>
    </nav>
    <div class="ct-overlay ct-title"></div>
    <div class="ct-overlay ct-end"></div>`;
  root.appendChild(ui);
  const $ = (s) => ui.querySelector(s);
  $('.ct-side').addEventListener('pointerdown', () => { sideHold = performance.now(); });
  const V = {};
  ui.querySelectorAll('[data-v]').forEach((n) => { V[n.dataset.v] = n; });
  const setV = (k, txt) => { if (V[k] && V[k].textContent !== String(txt)) V[k].textContent = txt; };

  // ---- state ----
  let sim = null, speed = 0, lastSpeed = 1, mode = 'title';
  let tool = null, rot = 0, cat = null, sel = null, side = null;
  let hoverCell = null, painting = false, lastPaint = null, pendingDemo = null;
  let tokensEarned = 0, realSeconds = 0, saveT = 0, hudT = 0, sideT = 0;
  let finaleUntil = 0, sideHold = 0;

  // ---- camera ----
  const cam = { target: new THREE.Vector3(0, 0, 4), r: 150, phi: 0.5, theta: -0.5 };
  const goal = { target: new THREE.Vector3(0, 0, 4), r: 88, phi: 0.92, theta: 0 };
  function focusAt(x, z, r = 38) { goal.target.set(x, 0, z); goal.r = r; goal.phi = Math.min(goal.phi, 1.05); }
  function resize() {
    const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
    renderer.setSize(w, h); composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? Math.min(80, 45 / Math.sqrt(camera.aspect)) : 45;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // ---- helpers ----
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
  function feed(text, extra = {}) {
    const box = $('.ct-feed');
    const n = document.createElement('div');
    n.className = `msg${extra.good ? ' good' : ''}${extra.bad ? ' bad' : ''}${extra.id ? ' link' : ''}`;
    n.innerHTML = esc(text);
    if (extra.id) n.onclick = () => { const b = sim.S.builds.get(extra.id); if (b) { focusAt(b.x, b.z, 30); selectThing({ build: b.id }); } };
    box.prepend(n);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => { n.classList.add('fade'); setTimeout(() => n.remove(), 700); }, 11000);
  }
  function toast(html, ms = 9000, onclick = null) {
    const t = $('.ct-toast');
    t.innerHTML = html; t.classList.add('show');
    t.onclick = () => { t.classList.remove('show'); if (onclick) onclick(); };
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
  }
  function setSpeed(s) {
    speed = s; if (s) lastSpeed = s;
    ui.querySelectorAll('[data-speed]').forEach((b) => { b.classList.toggle('on', +b.dataset.speed === s); });
  }

  // ---- starting, saving, ending ----
  function begin(scenario, snap = null) {
    world.reset();
    sim = createSim({ scenario, seed: snap ? snap.sim.seed : Math.floor(Math.random() * 1e6) });
    if (snap) { sim.restore(snap.sim); tokensEarned = snap.tokensEarned || 0; realSeconds = snap.realSeconds || 0; if (sim.S.ended) sim.keepPlaying(); }
    else { sim.seedPark(); tokensEarned = 0; realSeconds = 0; meta.plays++; saveMeta(); }
    mode = 'play'; tool = null; sel = null; closeSide(); closePalette();
    $('.ct-title').classList.remove('show'); $('.ct-end').classList.remove('show');
    ui.classList.add('playing');
    goal.target.set(0, 0, 2); goal.r = 82; goal.phi = 0.9; goal.theta = 0;
    setSpeed(1);
    if (!snap) {
      feed(`🎢 Welcome to CostBotLand! ${sim.S.scenario.goal ? `Goal: ${sim.S.scenario.goal.guests} guests and a ${sim.S.scenario.goal.rating} rating by the end of ${sim.monthLabel(sim.S.scenario.months - 1)}.` : 'Sandbox — no clock.'}`, { good: true });
      setTimeout(() => feed('Tip: lay 🛤️ paths out into the lands, then put rides on them — the yellow arrow is the entrance.'), 2500);
    }
    onEvent('run:start', { scenario });
    save();
  }
  function save() {
    if (!sim || mode === 'title') return;
    writeJSON(SAVE_KEY, { sim: sim.snapshot(), tokensEarned, realSeconds, savedAt: Date.now() });
  }
  function saveMeta() { writeJSON(META_KEY, meta); if (opts.onMeta) opts.onMeta(meta); }
  function finish(ev) {
    const r = { ...ev.result, tokensEarned, timeSurvived: Math.round(realSeconds) };
    meta.bestScore = Math.max(meta.bestScore, r.score);
    meta.bestGuests = Math.max(meta.bestGuests, r.guests);
    meta.bestRating = Math.max(meta.bestRating, r.rating);
    if (ev.outcome === 'win') { meta.wins++; finaleUntil = sim.S.time + 20; }
    saveMeta();
    const sc = sim.S.scenario, g = sc.goal;
    const head = { win: '🎆 The board is thrilled!', lose: '📉 The board expected more', bankrupt: '💸 Out of money' }[ev.outcome];
    const sub = { win: `You hit ${g ? `${g.guests} guests and a ${g.rating} rating` : 'the goal'} — CostBotLand is a hit.`,
      lose: g ? `The goal was ${g.guests} guests and a ${g.rating} rating. You finished with ${sim.S.guests.length} guests and ${Math.round(sim.S.rating)}.` : '',
      bankrupt: 'The overdraft got too deep. Watch the monthly bill — idle rides still cost money.' }[ev.outcome];
    const e = $('.ct-end');
    e.innerHTML = `<div class="card">
      <h2>${head}</h2><p>${esc(sub)}</p>
      <div class="grid">
        <div><small>Park value</small><b>${money(r.score)}</b></div>
        <div><small>Peak guests</small><b>${r.guests}</b></div>
        <div><small>Best rating</small><b>${Math.round(sim.S.stats.bestRating)}</b></div>
        <div><small>Ride uptime</small><b>${r.uptime}%</b></div>
        <div><small>Rides built</small><b>${r.combo}</b></div>
        <div><small>Tokens earned</small><b>🪙 ${tokensEarned}</b></div>
      </div>
      <div class="row">
        <button class="big" data-a="keep">🏗️ Keep building (sandbox)</button>
        <button data-a="new">🔄 New park</button>
        <a class="btn" href="../leaderboard/index.html#costbotland">🏆 Leaderboard</a>
      </div></div>`;
    e.classList.add('show');
    onEvent('run:end', r);
    try { onComplete(r); } catch (err) { console.error(err); }
    save();
  }

  // ---- title screen ----
  function showTitle() {
    mode = 'title'; setSpeed(0);
    ui.classList.remove('playing');
    const saved = readJSON(SAVE_KEY);
    const canContinue = saved?.sim && saved.sim.v === 1;
    const t = $('.ct-title');
    t.innerHTML = `<div class="card">
      <img class="logo" src="../shared/assets/costbot.png" alt="">
      <h1>CostBotLand <span>Tycoon</span></h1>
      <p class="tag">Build the park. Keep the guests happy. Watch the cloud bill.</p>
      <div class="row col">
        ${canContinue ? `<button class="big" data-a="continue">⏯ Continue your park <small>${esc(SCENARIOS[saved.sim.scenario].name)} · ${esc(saved.sim.ended ? 'sandbox' : `month ${saved.sim.month + 1}`)}</small></button>` : ''}
        <button class="${canContinue ? '' : 'big'}" data-a="grand">🎢 Grand Opening <small>${esc(SCENARIOS.grand.blurb)}</small></button>
        <button data-a="sandbox">🏖️ Sandbox <small>${esc(SCENARIOS.sandbox.blurb)}</small></button>
      </div>
      <details><summary>How to play</summary>
        <ul>
          <li><b>🛤️ Paths</b> — click or drag to lay them. Guests only walk on paths, starting from the gate.</li>
          <li><b>🎢 Rides</b> — pick one, <b>R</b> rotates, click to place. The yellow arrow is the entrance: it must touch a path.</li>
          <li><b>🍔 Stalls, 🚻 restrooms, 🪑 benches, 🗑️ bins, 💡 lamps</b> — guests get hungry, thirsty, tired and litter. Night falls every month.</li>
          <li><b>👷 Staff</b> — 🧹 Sweeper Bots clean, 🔧 Fixer Bots fix breakdowns, 🎭 Hype Bots cheer guests up.</li>
          <li><b>💭 Thoughts</b> tell you what guests want. <b>💰 Money</b> shows the monthly bill — idle rides still cost upkeep. Reserve a busy ride to prepay its bill at a discount.</li>
          <li>Click anything — a ride, a guest, a bot — to inspect it. Drag to orbit, right-drag or WASD to pan, scroll to zoom.</li>
        </ul>
      </details>
      ${meta.plays ? `<p class="best">Your best: ${money(meta.bestScore)} park value · ${meta.bestGuests} guests · ${meta.wins} win${meta.wins === 1 ? '' : 's'}</p>` : ''}
      </div>`;
    t.classList.add('show');
    // something to look at behind the card
    if (!sim) { sim = createSim({ scenario: 'grand', seed: 3 }); if (canContinue) { try { sim.restore(saved.sim); } catch { sim.seedPark(); } } else sim.seedPark(); }
    goal.target.set(0, 0, 2); goal.r = 92; goal.phi = 0.85;
  }

  // ---- palette ----
  const CATS = {
    rides: RIDES.map((d) => ({ id: d.id, tool: 'build' })),
    shops: SHOPS.map((d) => ({ id: d.id, tool: 'build' })),
    extras: ADDONS.map((d) => ({ id: d.id, tool: 'addon' })),
    scenery: SCENERY.map((d) => ({ id: d.id, tool: 'build' })),
  };
  function card(it) {
    const a = ADDON_BY_ID[it.id], d = a || DEFS[it.id];
    const land = d.land ? LANDS.find((l) => l.id === d.land) : null;
    const stats = d.kind === 'ride'
      ? `<em>E ${d.E} · I ${d.I} · N ${d.N}</em><em>${d.w}×${d.d} · bill ${money(d.upkeep)}/mo</em>`
      : d.kind === 'shop' ? `<em>sells ${d.sells}${d.price ? ` · ${money(d.price)}` : ' · free'}</em><em>bill ${money(d.upkeep)}/mo</em>`
      : `<em>${esc(d.blurb)}</em>`;
    const poor = sim && sim.S.cash < d.cost;
    const on = tool && tool.id === it.id;
    return `<button class="card${poor ? ' poor' : ''}${on ? ' on' : ''}" data-pick="${it.id}" data-kind="${it.tool}" title="${esc(d.blurb || '')}">
      <span class="e">${d.emoji}</span><b>${esc(d.name)}</b><span class="c">${money(d.cost)}</span>${stats}
      ${land ? `<span class="chip" style="--c:${land.color}">✨ ${esc(land.name)}</span>` : ''}</button>`;
  }
  function openPalette(c) {
    cat = c;
    const p = $('.ct-palette');
    ui.querySelectorAll('.ct-bar [data-cat]').forEach((b) => { b.classList.toggle('on', b.dataset.cat === c); });
    if (c === 'staff') {
      const counts = {};
      for (const s of sim.S.staff) counts[s.kind] = (counts[s.kind] || 0) + 1;
      p.innerHTML = `<div class="cards">${STAFF.map((s) => `<button class="card${sim.S.cash < s.hire ? ' poor' : ''}" data-hire="${s.id}" title="${esc(s.blurb)}">
          <span class="e">${s.emoji}</span><b>${esc(s.name)}</b><span class="c">hire ${money(s.hire)}</span><em>${esc(s.blurb)}</em><em>wage ${money(s.wage)}/mo · on staff: ${counts[s.id] || 0}</em></button>`).join('')}</div>
        <div class="hint">Staff start at the gate and walk the paths. Click a bot in the park to see what it’s doing, or to let it go.</div>`;
    } else {
      p.innerHTML = `<div class="cards">${CATS[c].map(card).join('')}</div><div class="hint">${c === 'rides' ? '<b>R</b> rotates · the yellow arrow is the entrance · built in its land, a ride is ✨ themed (+20% thrill)' : c === 'extras' ? 'These go on a path tile. Drag to place along a path.' : 'Click to place, drag to paint · <b>Esc</b> or right-click cancels'}</div>`;
    }
    p.classList.add('show');
  }
  function closePalette() { cat = null; $('.ct-palette').classList.remove('show'); ui.querySelectorAll('.ct-bar [data-cat]').forEach((b) => { b.classList.remove('on'); }); }
  function setTool(t) {
    tool = t; pendingDemo = null;
    ui.querySelectorAll('.ct-bar [data-tool]').forEach((b) => { b.classList.toggle('on', !!t && b.dataset.tool === t.kind); });
    world.setGhost(t && (t.kind === 'build' || t.kind === 'addon' || t.kind === 'path') ? (t.kind === 'path' ? 'path' : t.id) : (t && t.kind === 'bulldoze' ? 'bulldoze' : null), rot);
    if (!t) { world.hideGhost(); $('.ct-tip').classList.remove('show'); }
    if (cat && cat !== 'staff') openPalette(cat);
    renderer.domElement.style.cursor = t ? 'crosshair' : '';
  }

  // ---- the side panel: inspector, finances, thoughts, goal ----
  function openSide(kind) { side = kind; sideT = 0; renderSide(); $('.ct-side').classList.add('show'); }
  function closeSide() { side = null; $('.ct-side').classList.remove('show'); if (sel) { sel = null; world.select(null, sim); } }
  function selectThing(s) { sel = s; world.select(s, sim); openSide('inspect'); }
  function renderSide() {
    const el = $('.ct-side'), S = sim.S;
    let html = '';
    if (side === 'inspect' && sel) {
      if (sel.build) html = inspectBuild(S.builds.get(sel.build));
      else if (sel.guest) html = inspectGuest(S.guests.find((g) => g.id === sel.guest));
      else if (sel.staff) html = inspectStaff(S.staff.find((s) => s.id === sel.staff));
      if (!html) { closeSide(); return; }
    } else if (side === 'finance') html = financePanel();
    else if (side === 'thoughts') html = thoughtsPanel();
    else if (side === 'goal') html = goalPanel();
    el.innerHTML = `<button class="x" data-a="close" title="Close (Esc)">✕</button>${html}`;
  }
  function inspectBuild(b) {
    if (!b) return '';
    const d = DEFS[b.def], S = sim.S;
    if (b.kind === 'scenery') return `<h3>${d.emoji} ${esc(d.name)}</h3><p>${esc(d.blurb)}</p><p>Beauty ${d.beauty}${b.themed ? ' · ✨ themed (×1.5)' : ''}</p><div class="row"><button data-a="demolish">🚜 Remove</button></div>`;
    const status = b.state === 'broken' ? '<span class="chip bad">🛠️ Broken down</span>' : !b.connected ? '<span class="chip warn">⚠️ Entrance not on a path</span>'
      : !b.open ? '<span class="chip warn">⛔ Closed</span>' : b.state === 'running' ? '<span class="chip good">● Running</span>' : '<span class="chip good">● Open</span>';
    const reserved = b.reservedUntil > S.time;
    const bill = reserved ? 0 : d.upkeep * (b.open ? 1 : BAL.closedUpkeep);
    let body = `<h3>${d.emoji} ${esc(d.name)}</h3>${status}${b.themed ? ' <span class="chip theme">✨ Themed</span>' : ''}`;
    if (b.kind === 'ride') {
      const slots = d.cap * (MONTH / (d.cycle + BAL.loadWait));
      const util = slots ? b.m.riders / Math.max(0.05, ((S.time / MONTH) % 1)) / slots : 0;
      body += `<table>
        <tr><td>Excitement</td><td>${bar(d.E * (b.themed ? 1.2 : 1), 10, 'e')} ${(d.E * (b.themed ? 1.2 : 1)).toFixed(1)}</td></tr>
        <tr><td>Intensity</td><td>${bar(d.I, 10, 'i')} ${d.I}</td></tr>
        <tr><td>Nausea</td><td>${bar(d.N, 10, 'n')} ${d.N}</td></tr>
        <tr><td>Reliability</td><td>${bar(b.reliability, 100, b.reliability < 60 ? 'n' : 'g')} ${Math.round(b.reliability)}%</td></tr>
        <tr><td>Queue</td><td>${b.queue.length} / ${BAL.queueCap}</td></tr>
        <tr><td>Riders this month</td><td>${b.m.riders} <small>(${pct(Math.min(1, util))} of capacity)</small></td></tr>
        <tr><td>Revenue this month</td><td>${money(b.m.revenue)}</td></tr>
        <tr><td>Cloud bill</td><td>${reserved ? `<b class="good">reserved</b> until ${sim.monthLabel(Math.floor(b.reservedUntil / MONTH))}` : `${money(bill)}/mo`}</td></tr>
      </table>`;
    } else {
      body += `<table><tr><td>Sold this month</td><td>${b.m.riders}</td></tr><tr><td>Revenue this month</td><td>${money(b.m.revenue)}</td></tr>
        <tr><td>Bill</td><td>${reserved ? '<b class="good">reserved</b>' : `${money(bill)}/mo`}</td></tr></table>`;
    }
    if (d.price || b.kind === 'ride') {
      const hint = b.kind === 'ride' ? `Guests pay up to about ${money(sim.rideValue(b) * 1.3)}` : '';
      body += `<div class="price"><span>Price</span><button data-a="price-">−</button><b>${money(b.price)}</b><button data-a="price+">+</button><small>${hint}</small></div>`;
    }
    const rc = sim.reserveCost(b), save3 = d.upkeep * BAL.reserve.months - rc;
    body += `<div class="row">
      ${b.state === 'broken' ? `<button class="big" data-a="quickfix" ${S.quickFixReadyAt > S.time ? 'disabled' : ''}>🤖 Send CostBot to fix it${S.quickFixReadyAt > S.time ? ` (${Math.ceil(S.quickFixReadyAt - S.time)}s)` : ''}</button>` : ''}
      <button data-a="toggle">${b.open ? '⛔ Close' : '✅ Open'}</button>
      ${reserved ? '' : `<button data-a="reserve" title="Prepay ${BAL.reserve.months} months of this bill for ${money(rc)} — saves ${money(save3)}. Lost if you demolish it.">📝 Reserve ${BAL.reserve.months} mo · ${money(rc)}</button>`}
      <button data-a="demolish" class="warn">🚜 Demolish${reserved ? '' : ` (+${money(b.cost * BAL.refund)})`}</button>
    </div>`;
    if (b.kind === 'ride' && !b.open) body += `<p class="note">A closed ride still bills ${pct(BAL.closedUpkeep)} of its upkeep — like a stopped instance with its disks attached.</p>`;
    return body;
  }
  function inspectGuest(g) {
    if (!g) return '';
    const doing = g.mode === 'ride' ? `Riding ${sim.S.builds.get(g.qb)?.name || ''}` : g.mode === 'queue' ? `Queueing for ${sim.S.builds.get(g.qb)?.name || ''}`
      : g.mode === 'sit' ? 'Resting on a bench' : g.mode === 'shop' ? 'Buying something' : g.leaving ? 'Heading home'
      : g.target >= 0 ? `Walking to ${sim.S.builds.get(g.target)?.name || ''}` : 'Wandering';
    const face = g.happy > 75 ? '😄' : g.happy > 50 ? '🙂' : g.happy > 30 ? '😐' : '😠';
    return `<h3>${face} ${esc(g.name)}</h3><p class="doing">${esc(doing)}</p>
      <table>
        <tr><td>Happiness</td><td>${bar(g.happy, 100, 'g')}</td></tr>
        <tr><td>Hunger</td><td>${bar(g.hunger, 100, 'n')}</td></tr>
        <tr><td>Thirst</td><td>${bar(g.thirst, 100, 'n')}</td></tr>
        <tr><td>Restroom</td><td>${bar(g.bladder, 100, 'n')}</td></tr>
        <tr><td>Energy</td><td>${bar(g.energy, 100, 'e')}</td></tr>
        <tr><td>Nausea</td><td>${bar(g.nausea, 100, 'i')}</td></tr>
        <tr><td>Cash</td><td>${money(g.cash)} <small>(spent ${money(g.spent)})</small></td></tr>
        <tr><td>Rides ridden</td><td>${g.rides}</td></tr>
        <tr><td>Likes</td><td>intensity ${g.minI.toFixed(1)}–${g.maxI.toFixed(1)}</td></tr>
      </table>
      <h4>💭 Thinking</h4><ul class="thoughts">${g.thoughts.map((t) => `<li>“${esc(t.text)}”</li>`).join('') || '<li class="dim">Nothing much yet.</li>'}</ul>`;
  }
  function inspectStaff(s) {
    if (!s) return '';
    const def = STAFF_BY_ID[s.kind];
    const job = s.mode === 'work' ? (s.kind === 'janitor' ? 'Sweeping' : s.job?.fix ? 'Fixing a ride' : 'Inspecting a ride')
      : s.job?.b ? `Heading to ${sim.S.builds.get(s.job.b)?.name || 'a ride'}` : 'Patrolling';
    return `<h3>${def.emoji} ${esc(s.name)}</h3><p class="doing">${esc(job)}</p><p>${esc(def.blurb)}</p>
      <table><tr><td>Jobs done</td><td>${s.done}</td></tr><tr><td>Wage</td><td>${money(def.wage)}/mo</td></tr></table>
      <div class="row"><button data-a="fire" class="warn">👋 Let go</button></div>`;
  }
  function financePanel() {
    const S = sim.S, L = S.ledger;
    const inc = Object.entries(L.income), exp = Object.entries(L.expense);
    const tin = inc.reduce((a, [, v]) => a + v, 0), tex = exp.reduce((a, [, v]) => a + v, 0);
    const label = { admission: '🎟️ Admissions', rides: '🎢 Ride tickets', stalls: '🍔 Stalls', construction: '🏗️ Construction', upkeep: '☁️ Cloud bill (upkeep)',
      reserved: '📝 Reservations', staff: '👷 Staff', stock: '📦 Stall stock', marketing: '📣 Marketing', interest: '🏦 Overdraft interest' };
    const rides = [...S.builds.values()].filter((b) => b.kind === 'ride');
    const frac = Math.max(0.05, (S.time / MONTH) % 1);
    const rideRows = rides.map((b) => {
      const d = DEFS[b.def], slots = d.cap * (MONTH / (d.cycle + BAL.loadWait)), util = b.m.riders / frac / slots;
      const res = b.reservedUntil > S.time;
      return `<tr><td>${d.emoji} ${esc(b.name)}</td><td class="${util < 0.2 && b.open && !res ? 'bad' : ''}">${pct(Math.min(1, util))}</td><td>${res ? '<b class="good">reserved</b>' : money(d.upkeep * (b.open ? 1 : BAL.closedUpkeep))}</td>
        <td>${res ? '' : `<button class="mini" data-reserve="${b.id}" title="Prepay ${BAL.reserve.months} months at ${pct(BAL.reserve.share)} of the bill">📝 ${money(sim.reserveCost(b))}</button>`}</td></tr>`;
    }).join('');
    const hist = S.history.slice(-6).reverse().map((h) => `<tr><td>${h.label}</td><td>${money(h.income)}</td><td>${money(h.expense)}</td><td class="${h.profit < 0 ? 'bad' : 'good'}">${money(h.profit)}</td></tr>`).join('');
    const fair = BAL.fairFee + BAL.fairFeePerRide * sim.openRideCount();
    return `<h3>💰 Finances</h3>
      <div class="big-num ${S.cash < 0 ? 'bad' : ''}">${money(S.cash)}</div><p class="dim">Park value ${money(sim.parkValue())}</p>
      <div class="price"><span>Entry fee</span><button data-a="fee-">−</button><b>${money(S.entryFee)}</b><button data-a="fee+">+</button><small>fair for your park ≈ ${money(fair)}</small></div>
      <div class="row"><button data-a="campaign" ${S.campaignUntil > S.time || S.cash < BAL.campaign.cost ? 'disabled' : ''}>📣 Ad campaign · ${money(BAL.campaign.cost)}${S.campaignUntil > S.time ? ' (running)' : ''}</button></div>
      <h4>This month so far</h4>
      <table>${inc.map(([k, v]) => `<tr><td>${label[k]}</td><td class="good">${money(v)}</td></tr>`).join('')}
        ${exp.filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => `<tr><td>${label[k]}</td><td class="bad">−${money(v)}</td></tr>`).join('')}
        <tr class="tot"><td>Profit</td><td class="${tin - tex < 0 ? 'bad' : 'good'}">${money(tin - tex)}</td></tr></table>
      <h4>☁️ The cloud bill — rides</h4>
      ${rides.length ? `<table class="rides"><tr><th>Ride</th><th>Used</th><th>Bill/mo</th><th></th></tr>${rideRows}</table>
      <p class="note">Red = under 20% used. Idle rides still bill — close them, move them, or build paths so guests find them. A reservation prepays ${BAL.reserve.months} months at ${pct(BAL.reserve.share)} of the bill.</p>` : '<p class="dim">No rides yet.</p>'}
      ${hist ? `<h4>Past months</h4><table><tr><th>Month</th><th>In</th><th>Out</th><th>Profit</th></tr>${hist}</table>` : ''}`;
  }
  function thoughtsPanel() {
    const top = sim.thoughtSummary(60).slice(0, 10);
    const n = sim.S.guests.length;
    return `<h3>💭 What guests are thinking</h3><p class="dim">Last minute of park time · ${n} guests</p>
      <ul class="tlist">${top.map((t) => `<li><b>${t.n}</b> “${esc(t.text)}”${ADVICE[t.key] ? `<small>${esc(ADVICE[t.key])}</small>` : ''}</li>`).join('') || '<li class="dim">Quiet so far.</li>'}</ul>`;
  }
  function goalPanel() {
    const S = sim.S, sc = S.scenario, g = sc.goal;
    if (!g) return `<h3>🏖️ Sandbox</h3><p>${esc(sc.blurb)}</p>`;
    if (S.ended) return `<h3>🎯 ${esc(sc.name)} — season over</h3><p>${S.outcome === 'win' ? '🎆 You made it.' : 'The season has ended.'} Your run is on the leaderboard; you’re building freely now.</p>
      <table><tr><td>👥 Guests now</td><td>${S.guests.length}</td></tr><tr><td>⭐ Rating now</td><td>${Math.round(S.rating)}</td></tr><tr><td>🏟️ Park capacity</td><td>${sim.capacity()}</td></tr></table>`;
    const left = sc.months - S.month;
    return `<h3>🎯 ${esc(sc.name)}</h3><p>${esc(sc.blurb)}</p>
      <table><tr><td>👥 Guests</td><td>${bar(S.guests.length, g.guests, 'g')} ${S.guests.length} / ${g.guests}</td></tr>
      <tr><td>⭐ Rating</td><td>${bar(S.rating, g.rating, 'e')} ${Math.round(S.rating)} / ${g.rating}</td></tr>
      <tr><td>📅 Time left</td><td>${left > 0 ? `${left} month${left === 1 ? '' : 's'}` : 'season over'}</td></tr>
      <tr><td>🏟️ Park capacity</td><td>${sim.capacity()} guests <small>(more rides → more room)</small></td></tr></table>
      <p class="note">Both goals are checked when ${sim.monthLabel(sc.months - 1)} ends.</p>`;
  }

  // ---- clicks in the UI ----
  ui.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-a], [data-speed]');
    if (!b || !ui.contains(b)) return;
    if (b.dataset.speed !== undefined) { if (mode === 'play') setSpeed(+b.dataset.speed); return; }
    if (b.dataset.pick) { const kind = b.dataset.kind; setTool(tool && tool.id === b.dataset.pick ? null : { kind, id: b.dataset.pick }); return; }
    if (b.dataset.hire) {
      const s = sim.hire(b.dataset.hire);
      if (s) feed(`${STAFF_BY_ID[s.kind].emoji} Hired ${s.name}. They’ll start at the gate.`); else feed('Not enough cash to hire.', { bad: true });
      openPalette('staff'); return;
    }
    if (b.dataset.reserve) { if (!sim.reserve(+b.dataset.reserve)) feed('Not enough cash to reserve that.', { bad: true }); renderSide(); return; }
    if (b.dataset.tool) { const t = b.dataset.tool; closePalette(); setTool(tool && tool.kind === t ? null : { kind: t, id: t }); return; }
    if (b.dataset.cat) { if (cat === b.dataset.cat) { closePalette(); setTool(null); } else { setTool(null); openPalette(b.dataset.cat); } return; }
    const a = b.dataset.a;
    if (!a) return;
    if (a === 'arcade') return;       // plain link
    e.preventDefault();
    const S = sim?.S, bb = sel?.build ? S.builds.get(sel.build) : null;
    if (a === 'grand' || a === 'sandbox') begin(a);
    else if (a === 'continue') { const s = readJSON(SAVE_KEY); if (s) begin(s.sim.scenario, s); }
    else if (a === 'keep') { sim.keepPlaying(); $('.ct-end').classList.remove('show'); setSpeed(1); feed('🏗️ Sandbox mode — keep building. The leaderboard already has your run.', { good: true }); }
    else if (a === 'new') { $('.ct-end').classList.remove('show'); showTitle(); }
    else if (a === 'close') closeSide();
    else if (a === 'finance' || a === 'thoughts' || a === 'goal') { if (mode !== 'play') return; if (side === a) closeSide(); else { sel = null; world.select(null, sim); openSide(a); } }
    else if (a === 'price-' && bb) { sim.setPrice(bb.id, bb.price - 1); renderSide(); }
    else if (a === 'price+' && bb) { sim.setPrice(bb.id, bb.price + 1); renderSide(); }
    else if (a === 'fee-') { sim.setEntryFee(S.entryFee - 1); renderSide(); }
    else if (a === 'fee+') { sim.setEntryFee(S.entryFee + 1); renderSide(); }
    else if (a === 'campaign') { sim.campaign(); renderSide(); }
    else if (a === 'toggle' && bb) { sim.setOpen(bb.id, !bb.open); renderSide(); }
    else if (a === 'reserve' && bb) { if (!sim.reserve(bb.id)) feed('Not enough cash to reserve that.', { bad: true }); renderSide(); }
    else if (a === 'demolish' && bb) {
      if (bb.kind === 'ride' && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '🚜 Click again to demolish'; return; }
      const r = sim.bulldoze(bb.i0, bb.j0); if (r?.refund) feed(`🚜 Demolished ${bb.name} — ${money(r.refund)} back.`);
      closeSide();
    } else if (a === 'quickfix' && bb) sendCostBot(bb);
    else if (a === 'fire' && sel && sel.staff) { sim.fire(sel.staff); closeSide(); }
  });
  function sendCostBot(b) {
    if (!sim.quickFix(b.id)) return;
    fly.to = { x: b.x, z: b.z }; fly.until = realSeconds + 4;
    flyer.cheer();
    feed(`🤖 CostBot swooped in and fixed ${b.name}!`, { good: true });
    renderSide();
  }

  // ---- the park: pointer + keys ----
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function groundAt(e) {
    const rc = el.getBoundingClientRect();
    ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const i = Math.floor((hit.x + GRID.W) / GRID.size), j = Math.floor((hit.z + GRID.H) / GRID.size);
    return { x: hit.x, z: hit.z, i, j };
  }
  function pickThing(e) {
    const g = groundAt(e);
    const hits = ray.intersectObjects(world.pickTargets(), true);
    for (const h of hits) {
      if (h.object.userData.staff) return { staff: h.object.userData.staff };
      if (h.object.userData.build) {
        // a guest standing in front of a ride wins over the ride behind them
        const near = g && world.guestNear(sim, g.x, g.z, 0.8);
        return near ? { guest: near.id } : { build: h.object.userData.build };
      }
    }
    if (h0(e)) return { flyer: true };
    if (!g) return null;
    const near = world.guestNear(sim, g.x, g.z, 1.1);
    if (near) return { guest: near.id };
    if (inGrid(g.i, g.j)) { const o = sim.S.owner[idx(g.i, g.j)]; if (o >= 0) return { build: o }; }
    return null;
  }
  function h0() { return ray.intersectObject(flyer.root, true).length > 0; }

  function checkAt(i, j) {
    if (!tool) return null;
    if (tool.kind === 'path') return sim.canPlace('path', i, j);
    if (tool.kind === 'addon') return sim.canPlace(tool.id, i, j);
    if (tool.kind === 'build') return sim.canPlace(tool.id, i, j, rot);
    if (tool.kind === 'bulldoze') {
      if (!inGrid(i, j)) return { ok: false, reason: '' };
      const k = idx(i, j), t = sim.S.type[k];
      if (t === T.BUILD) { const b = sim.S.builds.get(sim.S.owner[k]); return { ok: true, what: b, reason: `Demolish ${b.name}${b.reservedUntil > sim.S.time ? ' (reservation lost)' : b.kind === 'scenery' ? '' : ` · +${money(b.cost * BAL.refund)}`}` }; }
      if (t === T.PATH) return { ok: true, reason: sim.S.addon[k] ? 'Remove the add-on' : 'Remove path' };
      return { ok: false, reason: '' };
    }
    return null;
  }
  function tipFor(chk) {
    if (!tool || !chk) return '';
    if (!chk.ok) return chk.quiet ? '' : `<span class="bad">${esc(chk.reason)}</span>`;
    if (tool.kind === 'bulldoze') return esc(chk.reason);
    const d = DEFS[tool.id];
    let t = money(chk.cost);
    if (d?.land && chk.fp) {
      const cx = chk.fp.i0 + (chk.fp.w - 1) / 2, cz = chk.fp.j0 + (chk.fp.d - 1) / 2;
      const l = LANDS[sim.S.land[idx(Math.round(cx), Math.round(cz))] - 1];
      if (l && l.id === d.land) t += ` · <span class="good">✨ themed for ${esc(l.name)}</span>`;
      else t += ` · <span class="dim">themed in ${esc(LANDS.find((q) => q.id === d.land).name)}</span>`;
    }
    if (chk.connected === false) t += ' · <span class="warn">entrance needs a path</span>';
    return t;
  }
  function hover(e) {
    const g = groundAt(e);
    const tip = $('.ct-tip');
    if (!g || !tool) { tip.classList.remove('show'); world.hideGhost(); hoverCell = null; return; }
    hoverCell = g;
    const chk = checkAt(g.i, g.j);
    if (tool.kind === 'bulldoze') world.moveGhost(g.i, g.j, { ok: chk.ok && !!chk.reason });
    else world.moveGhost(g.i, g.j, chk);
    const html = tipFor(chk);
    tip.innerHTML = html; tip.classList.toggle('show', !!html);
    tip.style.left = `${e.clientX + 16}px`; tip.style.top = `${e.clientY + 18}px`;
  }
  function applyAt(i, j, first) {
    const chk = checkAt(i, j);
    if (!chk?.ok) { if (first && chk?.reason && !chk.quiet) feed(chk.reason, { bad: true }); return; }
    if (tool.kind === 'path') sim.placePath(i, j);
    else if (tool.kind === 'addon') sim.placeAddon(tool.id, i, j);
    else if (tool.kind === 'bulldoze') {
      const b = chk.what;
      if (b && b.kind === 'ride' && first) {
        if (!pendingDemo || pendingDemo.id !== b.id || pendingDemo.until < realSeconds) { pendingDemo = { id: b.id, until: realSeconds + 2.5 }; feed(`Click ${b.name} again to demolish it.`); return; }
      } else if (b && b.kind === 'ride') return;     // no demolishing rides by drag
      const r = sim.bulldoze(i, j);
      if (r?.removed && r.removed.kind !== 'scenery') feed(`🚜 Demolished ${r.removed.name}${r.refund ? ` — ${money(r.refund)} back` : ' — the reservation is lost'}.`);
      pendingDemo = null;
    } else if (tool.kind === 'build') {
      const d = DEFS[tool.id];
      if (d.kind !== 'scenery' && !first) return;    // rides and stalls: one per click
      const b = sim.place(tool.id, i, j, rot);
      if (!b) return;
      if (d.kind === 'ride') {
        feed(`${d.emoji} Built ${d.name}${b.themed ? ' ✨' : ''}${sim.canPlace('path', b.ent[0], b.ent[1]).ok ? ' — now run a path to its entrance.' : '.'}`, { good: true, id: b.id });
        setTool(null); closePalette(); selectThing({ build: b.id });
      }
    }
  }

  const pointers = new Map();
  let drag = null, pinch = 0;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { painting = false; const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = { kind: 'pan2', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return; }
    const kind = e.button === 2 ? 'orbit' : e.button === 1 || e.shiftKey ? 'pan' : 'left';
    drag = { kind, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false };
    if (kind === 'left' && tool && mode === 'play') {
      const g = groundAt(e);
      if (g) { painting = true; lastPaint = { i: g.i, j: g.j }; applyAt(g.i, g.j, true); }
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (mode === 'play') hover(e);
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (drag.kind === 'pan2' && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch) goal.r = clamp(goal.r * (pinch / d), 14, 170);
      pan(mx - drag.x, my - drag.y); drag.x = mx; drag.y = my; pinch = d; return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    if (painting && tool) {
      const g = groundAt(e);
      if (g && lastPaint && (g.i !== lastPaint.i || g.j !== lastPaint.j)) {
        // walk the line cell by cell so a fast drag doesn't leave gaps
        let { i, j } = lastPaint;
        while (i !== g.i || j !== g.j) {
          if (Math.abs(g.i - i) >= Math.abs(g.j - j)) i += Math.sign(g.i - i); else j += Math.sign(g.j - j);
          applyAt(i, j, false);
        }
        lastPaint = { i: g.i, j: g.j };
      }
      return;
    }
    if (drag.kind === 'pan') pan(dx, dy);
    else if (drag.kind === 'orbit' || (drag.kind === 'left' && drag.moved)) { goal.theta -= dx * 0.006; goal.phi = clamp(goal.phi - dy * 0.005, 0.2, 1.35); }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (drag && pointers.size === 0) {
      const click = !drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6;
      if (click && drag.kind === 'orbit' && tool) { setTool(null); closePalette(); }
      else if (click && drag.kind === 'left' && !tool && mode === 'play') {
        const p = pickThing(e);
        if (p?.flyer) { flyer.antic(DANCES[Math.floor(Math.random() * DANCES.length)]); }
        else if (p) selectThing(p);
        else if (side === 'inspect') closeSide();
      }
      drag = null; painting = false; lastPaint = null;
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', () => { $('.ct-tip').classList.remove('show'); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); goal.r = clamp(goal.r * Math.exp(e.deltaY * 0.0012), 14, 170); }, { passive: false });
  function pan(dx, dy) {
    const k = goal.r * 0.0017, c = Math.cos(goal.theta), s = Math.sin(goal.theta);
    goal.target.x = clamp(goal.target.x - (dx * c + dy * s) * k, -60, 60);
    goal.target.z = clamp(goal.target.z - (-dx * s + dy * c) * k, -45, 45);
  }
  const held = new Set();
  const keys = (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.type === 'keyup') { held.delete(k); return; }
    held.add(k);
    if (mode !== 'play') return;
    if (k === 'escape') { if (tool) { setTool(null); closePalette(); } else if (cat) closePalette(); else closeSide(); }
    else if (k === 'r' && !e.metaKey && !e.ctrlKey) { rot = (rot + 1) % 4; if (tool) { world.setGhost(tool.kind === 'path' ? 'path' : tool.id, rot); if (hoverCell) world.moveGhost(hoverCell.i, hoverCell.j, checkAt(hoverCell.i, hoverCell.j) || { ok: false }); } }
    else if (k === ' ') { e.preventDefault(); setSpeed(speed ? 0 : lastSpeed); }
    else if (k === '1' || k === '2' || k === '3') setSpeed([1, 2, 4][+k - 1]);
    else if (k === 'p') { closePalette(); setTool(tool && tool.kind === 'path' ? null : { kind: 'path', id: 'path' }); }
    else if (k === 'b') { closePalette(); setTool(tool && tool.kind === 'bulldoze' ? null : { kind: 'bulldoze', id: 'bulldoze' }); }
    else if (k === 'f') { if (side === 'finance') closeSide(); else openSide('finance'); }
    else if (k === 't') { if (side === 'thoughts') closeSide(); else openSide('thoughts'); }
    else if (k === 'g') { if (side === 'goal') closeSide(); else openSide('goal'); }
    else if (k === 'q') goal.theta += Math.PI / 4;
    else if (k === 'e') goal.theta -= Math.PI / 4;
    else if (k === '=' || k === '+') goal.r = clamp(goal.r * 0.85, 14, 170);
    else if (k === '-') goal.r = clamp(goal.r / 0.85, 14, 170);
  };
  addEventListener('keydown', keys);
  addEventListener('keyup', keys);
  const hidden = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', hidden);

  // ---- sim events → UI ----
  function handleEvents() {
    for (const e of sim.drainEvents()) {
      if (e.type === 'msg') feed(e.text, { good: e.good });
      else if (e.type === 'breakdown') feed(e.text, { bad: true, id: e.id });
      else if (e.type === 'fixed') { if (e.by !== 'CostBot') feed(`${e.text} (${e.by})`, { id: e.id }); }
      else if (e.type === 'month') monthBill(e.bill);
      else if (e.type === 'end') finish(e);
    }
    for (const b of sim.drainBubbles()) world.bubble(sim, b.gid, b.text);
  }
  function monthBill(bill) {
    let tokens = Math.round(clamp(15 + bill.rating / 20 + Math.max(0, bill.profit) / 40, 0, 180));
    if (!sim.S.scenario.months) tokens = Math.round(tokens / 2);
    if (tokens > 0) { tokensEarned += tokens; if (window.ArcadeWallet) window.ArcadeWallet.earn(tokens, 'costbotland'); }
    const up = bill.ledger.expense.upkeep;
    const idle = bill.idle.slice(0, 3).map((r) => `${r.emoji} ${esc(r.name)} (${pct(r.util)})`).join(', ');
    toast(`<b>📄 ${bill.label} bill</b>
      <div class="bill"><span>Income</span><b class="good">${money(bill.income)}</b><span>Spend</span><b class="bad">${money(bill.expense)}</b><span>Profit</span><b class="${bill.profit < 0 ? 'bad' : 'good'}">${money(bill.profit)}</b></div>
      <small>☁️ Ride upkeep ${money(up)}${idle ? ` · barely used: ${idle}` : ''}</small>
      <small>🪙 +${tokens} tokens · click for the details</small>`, 10000, () => openSide('finance'));
    save();
  }

  // ---- HUD ----
  function hud() {
    const S = sim.S, d = sim.date(), sc = S.scenario;
    setV('cash', money(S.cash)); V.cash.classList.toggle('bad', S.cash < 0);
    setV('guests', S.guests.length); setV('cap', `/${sim.capacity()}`);
    setV('rating', Math.round(S.rating));
    V.rating.className = S.rating >= 700 ? 'good' : S.rating < 400 ? 'bad' : '';
    setV('date', d.label);
    V.month.style.width = `${d.frac * 100}%`;
    if (sc.goal && !S.ended) {
      const left = sc.months - S.month;
      V.goal.innerHTML = `🎯 👥 <b class="${S.guests.length >= sc.goal.guests ? 'good' : ''}">${S.guests.length}/${sc.goal.guests}</b> ⭐ <b class="${S.rating >= sc.goal.rating ? 'good' : ''}">${Math.round(S.rating)}/${sc.goal.rating}</b> <small>${left} mo left</small>`;
      V.goal.style.display = '';
    } else V.goal.style.display = 'none';
  }

  // ---- the loop ----
  const clock = new THREE.Clock();
  let animT = 0, raf = 0;
  showTitle();
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const playing = mode === 'play';
    if (playing && speed) { sim.step(dt * speed); realSeconds += dt; }
    const adt = mode === 'title' ? dt : dt * speed;
    animT += adt;
    if (playing) handleEvents();
    // camera: WASD pans, the eased orbit follows
    if (held.size && playing) {
      const s = 60 * dt;
      if (held.has('w') || held.has('arrowup')) pan(0, s * 8); if (held.has('s') || held.has('arrowdown')) pan(0, -s * 8);
      if (held.has('a') || held.has('arrowleft')) pan(s * 8, 0); if (held.has('d') || held.has('arrowright')) pan(-s * 8, 0);
    }
    if (mode === 'title') goal.theta += dt * 0.04;
    const k = 1 - Math.exp(-dt * 5);
    cam.target.lerp(goal.target, k); cam.r = lerp(cam.r, goal.r, k); cam.phi = lerp(cam.phi, goal.phi, k); cam.theta = lerp(cam.theta, goal.theta, k);
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.target.x + cam.r * sp * Math.sin(cam.theta), cam.target.y + cam.r * Math.cos(cam.phi), cam.target.z + cam.r * sp * Math.cos(cam.theta));
    camera.lookAt(cam.target);
    const night = sim.nightness();
    world.setNight(night);
    // bloom is for lamps and neon after dark; in daylight it would just smear the white paint
    bloom.strength = lerp(0.28, 0.72, night); bloom.threshold = lerp(1.35, 1.0, night);
    world.setFireworks(sim.S.time < finaleUntil ? 2 : night > 0.6 && sim.S.rating >= 700 ? 1 : 0);
    world.sync(sim, animT, adt, camera);
    world.followSelection(sel, sim);
    // CostBot's flight: a lazy figure-eight, or straight down to a broken ride
    {
      let tx, tz, ty;
      if (fly.to && realSeconds < fly.until) { tx = fly.to.x; tz = fly.to.z; ty = 7; } else { fly.to = null; const a = animT * 0.09; tx = Math.sin(a) * 34; tz = Math.sin(a * 2) * 16 - 4; ty = 17; }
      const dx = tx - fly.x, dz = tz - fly.z;
      const kk = fly.to ? Math.min(1, dt * 2.5) : Math.min(1, dt * 1.2);
      fly.x += dx * kk; fly.z += dz * kk; fly.y = lerp(fly.y, ty, kk);
      if (Math.hypot(dx, dz) > 0.3) { let d = Math.atan2(dx, dz) - fly.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); fly.yaw += d * Math.min(1, dt * 3); fly.bank = lerp(fly.bank, clamp(-d * 5, -0.6, 0.6), 0.05); }
      flyer.root.position.set(fly.x, 0, fly.z); flyer.root.rotation.y = fly.yaw;
      flyer.update(animT, adt || dt * 0.3, { baseY: fly.y, leanX: 0.3, leanZ: fly.bank, billow: 1.5 });
    }
    if (playing) {
      hudT += dt; if (hudT > 0.2) { hudT = 0; hud(); }
      // refresh the side panel's numbers, but never mid-click: a rebuilt button swallows the click
      sideT += dt; if (side && sideT > 0.5 && performance.now() - sideHold > 2500) { sideT = 0; renderSide(); }
      saveT += dt; if (saveT > 15) { saveT = 0; save(); }
    }
    composer.render();
  }
  frame();
  onEvent('ready', {});

  return {
    get sim() { return sim; }, get meta() { return meta; }, get mode() { return mode; },
    begin, setSpeed, setTool: (t) => setTool(t), select: selectThing, focusAt, openSide, save,
    camera, scene, world, renderer,
    destroy() {
      cancelAnimationFrame(raf); save();
      removeEventListener('resize', resize); removeEventListener('keydown', keys); removeEventListener('keyup', keys);
      document.removeEventListener('visibilitychange', hidden);
      renderer.dispose(); root.innerHTML = '';
    },
  };
}
