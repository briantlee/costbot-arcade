/* Headless check of the tycoon sim: node ct-smoketest.mjs
 * Plays a scripted "decent player" season on the Grand Opening scenario and
 * asserts the park actually works — guests arrive, ride, eat, litter gets swept,
 * rides break and get fixed, months close with a bill, the season ends. Prints a
 * month-by-month table so balance changes can be eyeballed. */
import assert from 'node:assert';
import './cl-content.js';
const { createSim } = await import('./ct-sim.js');
const { MONTH } = await import('./ct-content.js');

const sim = createSim({ scenario: 'grand', seed: 42 });
const S = sim.S;
sim.seedPark();
const build = (what, i, j, rot = 0) => { const b = sim.place(what, i, j, rot); assert.ok(b, `could not place ${what} at ${i},${j} r${rot}: ${sim.canPlace(what, i, j, rot).reason}`); return b; };
for (let i = 4; i <= 18; i++) build('path', i, 16);
for (let i = 31; i <= 46; i++) build('path', i, 16);
build('wheel', 14, 14, 0);
build('soda', 12, 17, 2); build('burger', 16, 17, 2); build('restroom', 6, 17, 2);
build('droptower', 34, 14, 0);
for (const i of [10, 17, 33, 41]) build('bench', i, 16);
for (const i of [7, 15, 36, 44]) build('bin', i, 16);
for (const i of [5, 9, 13, 32, 37, 42, 46]) build('lamp', i, 16);
for (const [i, j] of [[5, 12], [12, 12], [16, 12], [33, 12], [44, 12]]) build('tree', i, j);
assert.ok(sim.hire('janitor')); assert.ok(sim.hire('mechanic'));
console.log('cash after opening build:', Math.round(S.cash));

// a smarter player prices rides at what guests think they are worth
const SMART = process.env.SMART !== '0';
const price = () => { if (SMART) for (const b of S.builds.values()) if (b.kind === 'ride') sim.setPrice(b.id, Math.round(sim.rideValue(b))); };
price();
const seen = { breakdown: 0, fixed: 0, month: 0, end: null, msgs: 0 };
const rows = [];
let extra = false, coaster = false, cups = false;
for (let t = 0; t < MONTH * 8.2 && !S.ended; t += 0.1) {
  sim.step(0.1);
  if (!cups && S.cash > 2500) { cups = true; build('teacups', 38, 17, 2); sim.hire('janitor'); price(); }
  if (!coaster && S.cash > 8000) { coaster = true; build('coaster', 8, 14, 0); sim.hire('entertainer'); price(); }
  if (!extra && coaster && S.month < 6 && S.cash > 8800 && S.cash > 12000) {
    extra = true;
    for (let j = 17; j <= 26; j++) build('path', 11, j);
    build('path', 12, 25);
    build('boats', 14, 24, 1);          // entrance on the west side, onto the new path
    build('churro', 10, 22, 3);
    build('haunted', 40, 14, 0);
    price();
  }
  for (const e of sim.drainEvents()) {
    if (e.type === 'breakdown') seen.breakdown++;
    else if (e.type === 'fixed') seen.fixed++;
    else if (e.type === 'msg') seen.msgs++;
    else if (e.type === 'month') {
      seen.month++;
      const b = e.bill;
      rows.push({ month: b.label, cash: Math.round(b.cash), income: Math.round(b.income), expense: Math.round(b.expense),
        adm: Math.round(b.ledger.income.admission), rides: Math.round(b.ledger.income.rides), stalls: Math.round(b.ledger.income.stalls), profit: Math.round(b.profit), guests: b.guests, rating: b.rating, 
        thoughts: sim.thoughtSummary(50).slice(0, 3).map((t) => `${t.n}×${t.key}`).join(' ') });
    } else if (e.type === 'end') seen.end = e;
  }
}
console.table(rows);
const rode = [...S.builds.values()].filter((b) => b.kind === 'ride').map((b) => `${b.name}: ${b.stats.riders} riders, rel ${b.reliability.toFixed(0)}`);
console.log(rode.join('\n'));
console.log({ ...seen, end: seen.end && seen.end.outcome, result: seen.end && seen.end.result, litter: S.litterTotal, vomit: S.vomitTotal, staffDone: S.staff.map((s) => `${s.kind}:${s.done}`).join(' ') });
assert.equal(seen.month, 8, 'eight months close');
assert.ok(seen.end, 'the season ends');
assert.ok(S.stats.totalGuests > 100, 'guests arrive');
assert.ok([...S.builds.values()].every((b) => b.kind !== 'ride' || b.stats.riders > 0), 'every ride gets riders');
assert.ok(seen.breakdown > 0 && seen.fixed > 0, 'rides break and the Fixer Bot fixes them');
assert.ok(S.staff.find((s) => s.kind === 'janitor').done > 0, 'janitors sweep');

// save / load round-trip
const snap = JSON.parse(JSON.stringify(sim.snapshot()));
const sim2 = createSim({ scenario: 'grand', seed: 1 });
sim2.restore(snap);
assert.equal(sim2.S.builds.size, S.builds.size, 'builds survive a save');
assert.equal(Math.round(sim2.S.cash), Math.round(S.cash), 'cash survives a save');
sim2.step(5);
console.log('ok — save/load round-trips; guests after 5s on the restored park:', sim2.S.guests.length);
