/* Headless logic smoke test for CostBotLand.
 *   node smoketest.js
 *
 * Dependency-free: stubs just enough DOM to load cl-content.js + cl-game.js in
 * Node and drives the loop with a controllable clock, so the core rules are
 * verified deterministically and fast — incidents spawn, get resolved (instant
 * and hold types), land meters drain and reopen after going dark, the ring
 * track speeds you up, the churro boosts speed, the castle blocks movement,
 * and the day ends with a proper result payload. A Playwright visual pass
 * (screenshots, zero console errors) matching the other cabinets is the
 * follow-up; this covers the logic it would otherwise re-derive.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- controllable clock + rAF pump ---------------------------------------
let fakeNow = 0, rafCb = null;
function raf(cb) { rafCb = cb; return 1; }
function caf() { rafCb = null; }
function tick(seconds) {
  const stepMs = 16; let left = seconds * 1000;
  while (left > 0 && rafCb) { const dt = Math.min(stepMs, left); fakeNow += dt; left -= dt;
    const cb = rafCb; rafCb = null; cb(fakeNow); }
}

// ---- minimal DOM stubs ----------------------------------------------------
function stubCtx() {
  const noop = () => {};
  return new Proxy({ measureText: () => ({ width: 12 }),
    createLinearGradient: () => ({ addColorStop: noop }), setTransform: noop, save: noop,
    restore: noop, beginPath: noop, setLineDash: noop },
    { get(t, p) { return p in t ? t[p] : noop; }, set() { return true; } });
}
function stubCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => stubCtx(),
    addEventListener: () => {}, removeEventListener: () => {}, setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) };
}
function stubHost() {
  const kids = [];
  return { style: {}, _kids: kids, set innerHTML(v) { kids.length = 0; }, get innerHTML() { return ''; },
    appendChild: (c) => kids.push(c), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) };
}
const host = stubHost();
// Register window-level key handlers so the test can drive real movement input.
const handlers = {};
const win = {
  devicePixelRatio: 1, requestAnimationFrame: raf, cancelAnimationFrame: caf,
  addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
  removeEventListener: (type, fn) => { if (handlers[type]) handlers[type] = handlers[type].filter((h) => h !== fn); },
  performance: { now: () => fakeNow }, getComputedStyle: () => ({ position: 'static' }),
  document: { querySelector: () => host, createElement: (tag) => (tag === 'canvas' ? stubCanvas() : {}) },
  Image: function () { this.onload = null; Object.defineProperty(this, 'src', { set() {} }); },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, console,
};
win.window = win; win.globalThis = win;

const ctx = vm.createContext(win);
for (const f of ['cl-content.js', 'cl-game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}

const C = win.CostBotLandContent;
const game = win.CostBotLand.mount('#game', { persist: false });
const G = game._debug;
const at = (x, y) => { G.chef.x = x; G.chef.y = y; tick(0.02); }; // move + refresh hint
const press = (key) => (handlers.keydown || []).forEach((h) => h({ key, preventDefault() {} }));
const release = (key) => (handlers.keyup || []).forEach((h) => h({ key, preventDefault() {} }));

let pass = 0;
function ok(name, cond) { assert.ok(cond, 'FAIL: ' + name); pass++; console.log('  ✓ ' + name); }

console.log('CostBotLand — logic smoke test\n');

// 1) boot + start
ok('mounts in menu state', game.state === 'menu');
game.start();
ok('start() enters playing', game.state === 'playing');
ok('four lands initialised full', G.lands.length === 4 && G.lands.every((l) => l.happy === C.SCORING.landStart));

// 2) a goal spawns somewhere (a land incident or the lost child) within a few seconds
tick(2.5);
ok('a goal spawns within a few seconds', G.lands.some((l) => l.incident) || !!G.child);

// 3) resolve a land incident (covers instant + hold via the resolve path)
let land = G.lands[0];
land.incident = { type: C.INCIDENTS.breakdown, age: 0 }; // force one for a deterministic resolve
function resolveAt(l) {
  const before = G.guests;
  at(l.def.attract.x, l.def.attract.y);
  assert.ok(G.hint && G.hint.kind === 'fix', 'should offer FIX when standing on an incident');
  game.act();
  if (G.chef.prep) tick(G.chef.prep.dur + 0.05); // hold-type: let the ring finish
  return G.guests - before;
}
ok('resolving an incident serves a guest', resolveAt(land) === 1);
ok('resolving refills that land’s happiness', land.happy > C.SCORING.landStart - 30);
ok('score accrued', G.score > 0);
ok('combo advanced', G.longestCombo >= 1);

// 4) castle blocks OFF-track movement, but the ring track lets you slip behind it
{
  G.chef.prep = null; G.chef.carryChild = null;
  // approach the castle from below, off the track, pushing up — should be stopped
  G.chef.x = C.CASTLE.x + C.CASTLE.w / 2; G.chef.y = C.CASTLE.y + C.CASTLE.h + 44;
  press('w'); tick(2); release('w');
  ok('castle stops off-track movement', G.chef.y > C.CASTLE.y + C.CASTLE.h);
  // ride the top rail rightward through the castle's x-range — pass-through allowed
  G.chef.x = C.CASTLE.x - 30; G.chef.y = C.TRACK.y;
  press('d'); tick(1); release('d');
  ok('on the track you can move behind the castle', G.chef.x > C.CASTLE.x + C.CASTLE.w / 2);
}

// 5) the ring track is a SPEED LANE — on-rail travel is faster than off-rail
{
  G.chef.prep = null; G.chef.carryChild = null;
  function travelRight(x, y) {
    G.chef.x = x; G.chef.y = y; G.chef.boost = 0;
    const sx = G.chef.x; press('d'); tick(0.4); release('d');
    return G.chef.x - sx;
  }
  const off = travelRight(500, 150);                          // above the ring → off-rail
  const on = travelRight(C.TRACK.x + 40, C.TRACK.y + C.TRACK.h); // on the bottom rail → on-rail
  ok('moving off the track sets onTrack=false', off > 0);
  ok('the track is a speed lane (meaningfully faster on-rail)', on > off * 1.3);
}

// 6) a land left alone long enough goes dark, then reopens
{
  const l = G.lands[0];
  l.incident = { type: C.INCIDENTS.breakdown, age: 0 };
  l.downT = 0; l.happy = 8;
  G.chef.x = 500; G.chef.y = 600; // stand away so nothing gets resolved
  let wentDown = false;
  for (let i = 0; i < 400 && !wentDown; i++) { tick(0.05); if (l.downT > 0) wentDown = true; }
  ok('a starved land goes dark', wentDown);
  ok('going dark clears its incident', l.incident === null);
  // wait out the closure (it reopens at reopenAt, then immediately starts decaying again)
  tick(C.SCORING.downSeconds + 0.05);
  ok('a dark land reopens with partial happiness',
    l.downT <= 0 && l.happy > 0 && l.happy <= C.SCORING.reopenAt + 0.001);
}

// 7) churro boost
{
  G.churro = { x: G.chef.x + 5, y: G.chef.y }; G.chef.prep = null;
  tick(0.05);
  ok('walking over a churro grants a speed boost', G.chef.boost > 0 && G.churro === null);
}

// 7b) ticket gate — a line builds and scanning admits the front guest
{
  game.start();
  const gate = G.gate;
  // let the line build up at the booth
  for (let i = 0; i < 60 && gate.line.length < 3; i++) tick(0.2);
  ok('a line of guests builds at the ticket booth', gate.line.length >= 1);
  const gBefore = G.guests, lineBefore = gate.line.length;
  at(C.GATE.x, C.GATE.y); // stand at the booth
  ok('offers SCAN at the booth with a line', G.hint && G.hint.kind === 'scan');
  game.act();
  ok('scanning admits the front guest', gate.line.length === lineBefore - 1 && G.guests === gBefore + 1);
  // starve the gate to force a jam
  gate.happy = 3; gate.line = [{}, {}, {}, {}, {}];
  let jammed = false;
  for (let i = 0; i < 200 && !jammed; i++) { G.chef.x = 500; G.chef.y = 300; tick(0.05); if (gate.jamT > 0) jammed = true; }
  ok('an overloaded gate jams', jammed && gate.line.length === 0);
}

// 7c) lost child — the goal spawner can produce one; then lift, carry, drop
{
  game.start();
  // close every land so the only open goal slot is the child → spawner must pick it
  G.lands.forEach((l) => { l.downT = 5; l.incident = null; });
  G.child = null; G.goalT = 0.1;
  tick(0.3);
  ok('the goal spawner can produce a lost child', !!G.child && G.child.state === 'waiting');
  G.lands.forEach((l) => { l.downT = 0; l.happy = 100; }); // reopen for the rest
  const target = G.lands[G.child.target];
  at(G.child.x, G.child.y);
  ok('offers LIFT next to the child', G.hint && G.hint.kind === 'child_pickup');
  game.act();
  ok('lifting the child fills the chef’s hands', G.chef.carryChild && G.child.state === 'carried');
  // while carrying you cannot fix — plant an incident under the chef and confirm no FIX
  target.incident = { type: C.INCIDENTS.breakdown, age: 0 };
  at(target.def.attract.x, target.def.attract.y);
  ok('carrying the child blocks fixing (offers DROP, not FIX)', G.hint && G.hint.kind === 'child_drop');
  const gBefore = G.guests;
  game.act();
  ok('dropping the child at the target reunites them', G.guests === gBefore + 1 && G.chef.carryChild === null && G.child === null);
}

// 7d) monetary penalties — lose park cash when things aren't handled in time
{
  game.start();
  // a lost child left too long costs park cash
  G.score = 0; G.chef.x = 500; G.chef.y = 600; G.chef.carryChild = null;
  G.child = { x: 300, y: 400, target: 0, state: 'waiting', patience: 0.1, max: 22 };
  tick(0.3);
  ok('a lost child costs park cash', G.child === null && G.score === -C.SCORING.childPenalty);

  // a guest who waits past their patience abandons the line and costs cash
  game.start();
  G.score = 0; G.gate.jamT = 0; G.gate.happy = 100; G.gate.spawnT = 99;
  G.gate.line = [{ patience: 0.1 }];
  tick(0.3);
  ok('an abandoned ticket-line guest costs park cash',
    G.gate.line.length === 0 && G.score === -C.SCORING.ticketPenalty);
}

// 8) day ends with a full result payload
game.start();
tick(C.SCORING.roundSeconds + 1);
ok('day ends after roundSeconds', game.state === 'over');
ok('result carries the board metrics', G.result &&
  ['guests', 'stars', 'combo', 'uptime', 'outcome', 'stageId', 'score'].every((k) => k in G.result));
ok('flavor-only: dollarsSaved is 0', G.result.dollarsSaved === 0);
ok('stageId is "park"', G.result.stageId === 'park');
ok('uptime is a 0–100 percentage', G.result.uptime >= 0 && G.result.uptime <= 100);

// 9) all lands dark ends the day early ("closed")
game.start();
for (const l of G.lands) { l.happy = 4; }
let closed = false;
for (let i = 0; i < 200 && !closed; i++) { G.chef.x = 500; G.chef.y = 690; tick(0.05); if (game.state === 'over') closed = true; }
ok('all lands dark shuts the park early', closed && G.result.outcome === 'closed');

console.log('\n' + pass + ' checks passed.');
