/* ============================================================================
 * CostBot Arcade — THE WALLET
 * ----------------------------------------------------------------------------
 * One purse for the whole arcade.
 *
 * Every cabinet used to keep its own token count, which meant a token earned in
 * Mudslides was stranded there — you could not spend it on bait in Colombia or
 * on an upgrade in the Bot Bay. This module is the single place tokens live, so
 * they are earned anywhere and spent anywhere.
 *
 * Two numbers, and the whole design is the line between them:
 *
 *   tokens   ON HAND. Spendable in any game — bait, Bot Bay upgrades, and the
 *            casino when it opens.
 *   banked   GIVEN AWAY, to CostBot's build fund. Every 10,000 banked ships
 *            another product. Banking is one-way on purpose: a token can buy
 *            you something or it can build something, never both.
 *
 * Storage is one localStorage key shared by every page, plus — when the arcade
 * app is serving and a player is signed in — a `_wallet` slice on the server
 * profile, so the purse follows them between machines.
 *
 *   ArcadeWallet.init();                 // once per page, before reading
 *   ArcadeWallet.tokens                  // on hand
 *   ArcadeWallet.earn(250, 'mudslides');
 *   ArcadeWallet.spend(120)              // -> true if it went through
 *   ArcadeWallet.bank();                 // everything on hand -> the fund
 *   ArcadeWallet.onChange(fn);
 * ==========================================================================*/
((global) => {
  'use strict';

  const KEY = 'costbot.arcade.wallet.v1';
  const SLICE = '_wallet';          // the pseudo-game the server profile stores it under
  const SHIP_COST = 10000;

  // Cabinets that kept their own purse before this module existed. Their tokens
  // are folded in once, on first load, and zeroed at the source so the same
  // tokens cannot be counted twice.
  const LEGACY = [
    { key: 'costbot.wastehunter.v1', tokens: 'tokens', banked: 'banked' },
    { key: 'costbot.mudslides.v1', tokens: 'totalTokens', banked: 'banked' },
    { key: 'costbot.mudsliders.v1', tokens: 'totalTokens', banked: 'banked' },
    { key: 'costbot.holiday.v1', tokens: 'tokens', banked: 'banked' },
  ];

  const num = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const state = {
    tokens: 0,
    banked: 0,
    earned: 0,          // lifetime, never spent down — the "you have generated" number
    byGame: {},         // gameId -> lifetime earned, for the breakdown
    migrated: false,
  };

  let ready = false;
  const listeners = [];

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return {
        tokens: num(o.tokens), banked: num(o.banked), earned: num(o.earned),
        byGame: (o.byGame && typeof o.byGame === 'object') ? o.byGame : {},
        migrated: !!o.migrated,
      };
    } catch { return null; }
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
    push();
    listeners.forEach((fn) => { try { fn(snapshot()); } catch (e) { console.error(e); } });
  }

  // Fold each cabinet's old private purse in, once, and zero it at the source.
  // Without the zeroing a second migration would double the player's tokens.
  function absorbLegacy() {
    if (state.migrated) return;
    for (const g of LEGACY) {
      let o;
      try {
        const raw = localStorage.getItem(g.key);
        if (!raw) continue;
        o = JSON.parse(raw);
      } catch { continue; }
      const t = num(o[g.tokens]);
      const b = num(o[g.banked]);
      if (!t && !b) continue;
      state.tokens += t;
      state.banked += b;
      state.earned += t + b;
      o[g.tokens] = 0;
      o[g.banked] = 0;
      try { localStorage.setItem(g.key, JSON.stringify(o)); } catch { /* ignore */ }
    }
    state.migrated = true;
  }

  // The server keeps one profile blob per player; the wallet rides in it as a
  // pseudo-game slice so no server change is needed. Whichever copy has seen
  // more lifetime tokens wins, which is the safe direction: a stale local purse
  // never eats a bigger server one.
  function pull() {
    const sync = global.ArcadeSync;
    if (!sync || !sync.enabled || !sync.gameProfile) return;
    const remote = sync.gameProfile(SLICE);
    if (!remote) return;
    if (num(remote.earned) >= state.earned) {
      state.tokens = num(remote.tokens);
      state.banked = num(remote.banked);
      state.earned = num(remote.earned);
      state.byGame = remote.byGame || state.byGame;
    }
  }

  function push() {
    const sync = global.ArcadeSync;
    if (!sync || !sync.enabled || !sync.saveGame) return;
    try { sync.saveGame(SLICE, snapshot()); } catch { /* best effort */ }
  }

  function snapshot() {
    return {
      tokens: state.tokens, banked: state.banked, earned: state.earned,
      byGame: Object.assign({}, state.byGame),
      shipped: Math.floor(state.banked / SHIP_COST),
      toward: state.banked % SHIP_COST,
      shipCost: SHIP_COST,
    };
  }

  function init() {
    if (ready) return snapshot();
    const saved = read();
    if (saved) Object.assign(state, saved);
    absorbLegacy();
    pull();
    ready = true;
    write();
    return snapshot();
  }

  function earn(n, game) {
    init();
    const v = num(n);
    if (!v) return state.tokens;
    state.tokens += v;
    state.earned += v;
    if (game) state.byGame[game] = num(state.byGame[game]) + v;
    write();
    return state.tokens;
  }

  // Returns false and changes nothing when the player cannot afford it, so a
  // caller can use it directly as the affordability check.
  function spend(n) {
    init();
    const v = num(n);
    if (v > state.tokens) return false;
    state.tokens -= v;
    write();
    return true;
  }

  // One-way. `n` omitted banks everything on hand.
  function bank(n) {
    init();
    const v = n === undefined ? state.tokens : Math.min(num(n), state.tokens);
    if (!v) return 0;
    state.tokens -= v;
    state.banked += v;
    write();
    return v;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // Another tab spending tokens should not leave this one showing a stale purse.
  global.addEventListener('storage', (e) => {
    if (e.key !== KEY || !ready) return;
    const saved = read();
    if (!saved) return;
    Object.assign(state, saved);
    listeners.forEach((fn) => { try { fn(snapshot()); } catch (err) { console.error(err); } });
  });

  global.ArcadeWallet = {
    init, earn, spend, bank, onChange, snapshot,
    get tokens() { init(); return state.tokens; },
    get banked() { init(); return state.banked; },
    get earned() { init(); return state.earned; },
    SHIP_COST,
    SLICE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
