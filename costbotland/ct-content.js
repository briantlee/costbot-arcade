/* ============================================================================
 * CostBotLand Tycoon — catalog & balance
 * ----------------------------------------------------------------------------
 * Everything a designer tunes lives here; ct-sim.js reads it and never hard-codes
 * a number. The park layout (castle, lands, gate) comes from cl-content.js so the
 * tycoon, the 3D showcase and the classic game all agree on the map.
 *
 * Money is park money, flavor only — nothing here is a real cost figure. The
 * FinOps twist is in the mechanics: every ride carries a monthly "cloud bill"
 * whether anyone rides it or not, and a ride can be reserved (prepaid for three
 * months at a discount) like a savings plan.
 * ==========================================================================*/
const LAYOUT = globalThis.CostBotLandContent;

// The park is a 50 x 36 grid of 2-unit cells over the 100 x 72 world the other
// CostBotLand pages use. Cell (i, j) is centred at world (-49 + 2i, -35 + 2j).
export const GRID = { W: 50, H: 36, size: 2 };
export const cellX = (i) => -GRID.W + GRID.size * i + 1;
export const cellZ = (j) => -GRID.H + GRID.size * j + 1;

export const LANDS = LAYOUT.LANDS.map((l) => ({
  id: l.id, name: l.name, emoji: l.emoji, color: l.color,
  // the land's rect in world units
  x0: (l.rect.x - 500) / 10, x1: (l.rect.x + l.rect.w - 500) / 10,
  z0: (l.rect.y - 360) / 10, z1: (l.rect.y + l.rect.h - 360) / 10,
}));

// Fixed geometry, in cells: the castle is solid, the gate is where guests come
// and go, the row behind the fence is the entrance plaza (not buildable).
export const FIXED = {
  castle: { i0: 20, i1: 29, j0: 12, j1: 19 },
  gate: [[24, 34], [25, 34]],
  statues: [[21, 33], [28, 33]],
  firstBlockedRow: 34,
};

// Sim seconds per park month at 1x. The calendar is compressed on purpose: a
// season is a sitting, not an evening.
export const MONTH = 50;
export const MONTH_NAMES = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];

/* Rides. w x d is the footprint in cells facing south (entrance on the +Z side);
 * E / I / N are excitement, intensity, nausea on a 0-10 scale like the rating
 * boards in the classic tycoon games. `upkeep` is the monthly cloud bill,
 * `price` the default ticket, `cap` riders per cycle, `cycle` seconds a ride
 * lasts. `land` is where it is themed: built there, it thrills 20% more. */
export const RIDES = [
  { id: 'carousel', name: 'Merry-Go-Budget', emoji: '🎠', w: 2, d: 2, cost: 900, upkeep: 40, price: 2, cap: 12, cycle: 8,
    E: 3.2, I: 1.0, N: 0.5, land: 'frontier', blurb: 'A gentle spin for everyone. Cheap to run, easy to love.' },
  { id: 'teacups', name: 'Spin-Up Cups', emoji: '🫖', w: 2, d: 2, cost: 1200, upkeep: 55, price: 2, cap: 12, cycle: 8,
    E: 4.0, I: 4.2, N: 4.8, land: 'small', blurb: 'Instances spinning up and down. Mind the nausea.' },
  { id: 'wheel', name: 'Big Wheel of Fortune', emoji: '🎡', w: 3, d: 2, cost: 1600, upkeep: 70, price: 3, cap: 16, cycle: 14,
    E: 4.4, I: 1.3, N: 0.6, land: 'token', blurb: 'Views of the whole park — and the whole bill.' },
  { id: 'droptower', name: 'The Price Drop', emoji: '🗼', w: 2, d: 2, cost: 2600, upkeep: 110, price: 4, cap: 8, cycle: 7,
    E: 6.6, I: 8.0, N: 3.6, land: 'cache', blurb: 'Up slowly, down all at once. Just like a good optimization.' },
  { id: 'haunted', name: 'Zombie Instances', emoji: '👻', w: 3, d: 3, cost: 3400, upkeep: 130, price: 4, cap: 12, cycle: 14,
    E: 6.0, I: 3.2, N: 1.0, land: 'cache', blurb: 'A dark ride through servers nobody remembers launching.' },
  { id: 'flume', name: 'Data Lake Flume', emoji: '🪵', w: 4, d: 3, cost: 3900, upkeep: 150, price: 4, cap: 10, cycle: 12,
    E: 6.2, I: 4.6, N: 2.4, land: 'frontier', blurb: 'Float through the data lake, then drop into cold storage.' },
  { id: 'boats', name: "It's a Small Bill", emoji: '🚤', w: 4, d: 4, cost: 4800, upkeep: 180, price: 4, cap: 20, cycle: 16,
    E: 5.4, I: 1.0, N: 0.3, land: 'small', blurb: 'A boat ride where every line item sings. Huge capacity.' },
  { id: 'coaster', name: 'The Token Burner', emoji: '🎢', w: 5, d: 3, cost: 7000, upkeep: 280, price: 6, cap: 16, cycle: 14,
    E: 8.2, I: 7.2, N: 4.2, land: 'token', blurb: 'A neon coaster that climbs like a usage chart. The headliner.' },
];

// Stalls are 1x1, served from the front. `sells` is the need they fix.
export const SHOPS = [
  { id: 'churro', name: 'Churro Cart', emoji: '🌯', cost: 250, upkeep: 20, price: 3, sells: 'food', color: '#f59e0b',
    blurb: 'Fixes hunger. Leaves wrappers.' },
  { id: 'burger', name: 'Burger Byte', emoji: '🍔', cost: 350, upkeep: 25, price: 4, sells: 'food', color: '#ef4444',
    blurb: 'Fixes hunger, better margin. Leaves wrappers.' },
  { id: 'soda', name: 'Liquid Assets', emoji: '🥤', cost: 250, upkeep: 20, price: 2, sells: 'drink', color: '#3b82f6',
    blurb: 'Fixes thirst. Guests will need a restroom after.' },
  { id: 'balloon', name: 'Balloon Budget', emoji: '🎈', cost: 300, upkeep: 18, price: 4, sells: 'souvenir', color: '#ec4899',
    blurb: 'Pure happiness, on a string.' },
  { id: 'restroom', name: 'Restroom', emoji: '🚻', cost: 300, upkeep: 22, price: 0, sells: 'toilet', color: '#14b8a6',
    blurb: 'Free to use. Absolutely not optional.' },
];

// Path add-ons sit on a path tile.
export const ADDONS = [
  { id: 'bench', n: 1, name: 'Bench', emoji: '🪑', cost: 80, blurb: 'Tired guests sit and recover.' },
  { id: 'bin', n: 2, name: 'Bin', emoji: '🗑️', cost: 60, blurb: 'Guests nearby bin their litter.' },
  { id: 'lamp', n: 3, name: 'Lamp', emoji: '💡', cost: 70, blurb: 'Lights the path at night. A little pretty, too.' },
];

// Scenery on an empty tile. `beauty` spreads over `r` cells; built in its own
// land it counts half again.
export const SCENERY = [
  { id: 'tree', name: 'Tree', emoji: '🌳', cost: 40, beauty: 1.0, r: 2, blurb: 'Shade and a little calm.' },
  { id: 'flowers', name: 'Flower Bed', emoji: '🌷', cost: 25, beauty: 1.2, r: 1.5, blurb: 'Cheap and cheerful.' },
  { id: 'topiary', name: 'CostBot Topiary', emoji: '🪴', cost: 150, beauty: 2.2, r: 2.5, blurb: 'A hedge in his likeness.' },
  { id: 'crystal', name: 'Cache Crystal', emoji: '💎', cost: 120, beauty: 2.0, r: 2, land: 'cache', blurb: 'Glows. Themed for Cache Mountain.' },
  { id: 'cactus', name: 'Cactus', emoji: '🌵', cost: 40, beauty: 1.0, r: 2, land: 'frontier', blurb: 'Themed for Frontier Cloud.' },
  { id: 'fountain', name: 'Token Fountain', emoji: '⛲', cost: 400, beauty: 3.0, r: 3, land: 'token', blurb: 'Coins in, joy out.' },
  { id: 'statue', name: 'CostBot Statue', emoji: '🗿', cost: 600, beauty: 4.0, r: 3.5, blurb: 'The founder, on a plinth.' },
];

// Staff are bots. `wage` is monthly.
export const STAFF = [
  { id: 'janitor', name: 'Sweeper Bot', emoji: '🧹', hire: 150, wage: 60, outfit: 'graviton', blurb: 'Sweeps litter and worse.' },
  { id: 'mechanic', name: 'Fixer Bot', emoji: '🔧', hire: 200, wage: 90, outfit: 'mega', blurb: 'Fixes breakdowns and inspects rides.' },
  { id: 'entertainer', name: 'Hype Bot', emoji: '🎭', hire: 150, wage: 70, outfit: 'july4', blurb: 'Wanders about making guests happier.' },
];

export const BAL = {
  pathCost: 15,
  refund: 0.5,                 // cash back on demolishing a ride or stall (never for a reserved one)
  guestSpeed: 4.6,             // world units / sec — brisk: the calendar is compressed, so are the walks
  staffSpeed: 5.2,
  maxGuests: 600,
  guestCash: [30, 95],
  stay: [90, 170],            // sim seconds a guest means to stay
  // arrivals / sec = (base + perRide x open rides) x rating x fee x campaign, capped by park capacity
  arrBase: 0.1, arrPerRide: 0.22, capBase: 30, capPerRide: 32, capPerShop: 6,
  fairFee: 16, fairFeePerRide: 2.5,
  campaign: { cost: 800, months: 1, boost: 1.5 },
  queueCap: 28,
  queuePatience: [25, 45],
  loadWait: 1.5,               // a ride waits this long for a fuller load
  // needs, per sim second
  hunger: 0.42, thirst: 0.5, bladder: 0.26, tire: 0.22, nauseaDecay: 0.9, sit: 4,
  // breakdowns: chance per cycle = breakBase x (1 + (100 - reliability) / 12)
  breakBase: 0.015, wear: 1.2, fixGain: 30, inspectGain: 18, fixTime: 3.5, inspectTime: 3,
  quickFixCooldown: 25,        // CostBot flies over himself
  closedUpkeep: 0.3,           // a closed ride still costs this share of its bill
  reserve: { months: 3, share: 0.55 },   // prepay 55% of three months' upkeep, then no bill for three months
  stockShare: 0.35,            // cost of goods on stall sales
  interest: 0.03,              // per month on an overdraft
  bankrupt: -10000,
  litterMax: 6,
};

export const SCENARIOS = {
  grand: {
    id: 'grand', name: 'Grand Opening', months: 8, cash: 15000, entryFee: 12,
    goal: { guests: 250, rating: 600 },
    blurb: 'Open the gates in March. By the end of October have 250 guests in the park and a park rating of 600.',
  },
  sandbox: {
    id: 'sandbox', name: 'Sandbox', months: 0, cash: 60000, entryFee: 12, goal: null,
    blurb: 'No clock, no board. Just build.',
  },
};

// Guest thoughts, RCT-style. {ride} / {land} are filled in.
export const THOUGHTS = {
  hungry: "I'm hungry", thirsty: "I'm thirsty", toilet: 'I need a restroom', tired: "I'm tired",
  sick: 'I feel sick', dirty: 'The path here is disgusting', clean: 'This park is really clean and tidy',
  scenery: 'The scenery here is beautiful', theme: 'Great theming in {land}!', dark: "It's too dark around here",
  great: '{ride} was great!', value: '{ride} is great value', expensive: "I'm not paying that much for {ride}",
  intense: '{ride} looks too intense for me', boring: 'I want to go on something more thrilling',
  queue: 'The queue for {ride} is too long', broken: '{ride} has broken down!', cantfind: "I can't find {ride}",
  nothing: "There's nothing here for me", broke: "I've run out of money", fee: "The entry fee is outrageous",
  home: 'I want to go home', entertained: 'That Hype Bot was fun!', nofood: "I can't find anything to eat",
  nodrink: "I can't find anything to drink", notoilet: "I can't find a restroom",
};

// What CostBot tells you when a complaint gets common. Keyed like THOUGHTS.
export const ADVICE = {
  hungry: 'Guests are hungry — build a 🌯 Churro Cart or 🍔 Burger Byte.',
  nofood: 'Guests can’t find food — put a stall on a path they walk.',
  thirsty: 'Guests are thirsty — build a 🥤 Liquid Assets stand.',
  nodrink: 'Guests can’t find a drink — put a 🥤 stand where they walk.',
  toilet: 'Guests need a 🚻 Restroom. Soon.',
  notoilet: 'Guests can’t find a 🚻 Restroom — connect one to the paths.',
  tired: 'Guests are tired — put 🪑 benches on the paths.',
  dirty: 'The paths are filthy — hire a 🧹 Sweeper Bot and add 🗑️ bins.',
  dark: 'It’s dark out there — add 💡 lamps along the paths.',
  boring: 'Guests want thrills — try 🗼 The Price Drop or 🎢 The Token Burner.',
  queue: 'Queues are long — you need more rides.',
  expensive: 'Guests think tickets are too pricey — lower a price or two.',
  intense: 'Plenty of guests want gentler rides — 🎠 🎡 🚤 are easy on the stomach.',
  sick: 'Guests are feeling sick — keep 🧹 Sweeper Bots near the intense rides.',
  nothing: 'Guests are bored — build more rides and connect them with paths.',
  broken: 'Rides keep breaking — hire a 🔧 Fixer Bot.',
  fee: 'The entry fee is scaring guests off — lower it in 💰 Finances.',
  cantfind: 'Guests can’t reach a ride — check its entrance has a path.',
};

export const FIRST_NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fran', 'Gus', 'Hana', 'Ivy', 'Jay', 'Kai', 'Lena', 'Milo', 'Nia',
  'Otto', 'Pia', 'Quinn', 'Rex', 'Sana', 'Theo', 'Uma', 'Vic', 'Wren', 'Xan', 'Yara', 'Zed', 'Ari', 'Bo', 'Cy', 'Dot'];
export const LAST_NAMES = ['Budget', 'Ledger', 'Invoice', 'Reserved', 'Spot', 'Savings', 'Credits', 'Forecast', 'Rightsize',
  'Tagger', 'Chargeback', 'Accrual', 'Rollup', 'Egress', 'Quota', 'Commit', 'Burst', 'Idle', 'Cache', 'Token'];

export const DEFS = Object.fromEntries([
  ...RIDES.map((d) => ({ ...d, kind: 'ride' })),
  ...SHOPS.map((d) => ({ ...d, kind: 'shop', w: 1, d: 1 })),
  ...SCENERY.map((d) => ({ ...d, kind: 'scenery', w: 1, d: 1 })),
].map((d) => [d.id, d]));
export const ADDON_BY_ID = Object.fromEntries(ADDONS.map((a) => [a.id, a]));
export const ADDON_BY_N = Object.fromEntries(ADDONS.map((a) => [a.n, a]));
export const STAFF_BY_ID = Object.fromEntries(STAFF.map((s) => [s.id, s]));
