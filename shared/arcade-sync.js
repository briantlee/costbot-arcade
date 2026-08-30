/* ============================================================================
 * CostBot Arcade — SERVER SYNC (optional)
 * ----------------------------------------------------------------------------
 * Bridges a game's local profile to the arcade's server profile when one is
 * available, and does nothing at all when it is not.
 *
 * The same arcade source is served two ways: statically from GitHub Pages, and
 * dynamically from the aix-proto app. Only the second has an API. So this file
 * probes for it once and disables itself on failure — a game never has to know
 * which host it is running on, and never breaks because the network is absent.
 *
 * Identity is supplied by the platform (MyID at the front door), so there is no
 * login here and no credential ever touches this code.
 *
 *   await ArcadeSync.init();          // -> { enabled, hubId, profile, ... }
 *   ArcadeSync.submit(result, meta);  // record a run + persist the profile
 *   ArcadeSync.pushProfile(meta);     // debounced profile save
 *   await ArcadeSync.boards();        // leaderboard payload
 * ==========================================================================*/
((global) => {
  'use strict';

  // Resolve the API against the arcade root, derived from THIS script's own URL.
  // Pages live at different depths (/, /waste-hunter/, /jukebox/), and under
  // aix-proto everything is nested beneath /a/<slug>/ — so neither an absolute
  // path nor a fixed relative one works. The script's own location does.
  function apiBase() {
    const s = document.currentScript && document.currentScript.src;
    if (s) return s.replace(/shared\/arcade-sync\.js.*$/, '') + 'api/';
    return 'api/';
  }
  const API = apiBase();

  const state = {
    enabled: false,        // an API answered
    checked: false,
    hubId: null,
    displayName: null,
    team: null,
    authenticated: false,
    profile: null,         // server-side profile, when one exists
    identity: null,        // {email, username} as the front door supplied them
    pool: null,            // {total, mine, players} — the shared AI token fund
    isAdmin: false,        // may open the owner-only Usage board
    resetEpoch: 0,         // when the owner last wiped the server, in epoch ms
    wipedLocal: false,     // this page load dropped stale local progress
  };

  async function req(path, opts) {
    const r = await fetch(API + path, Object.assign({
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    }, opts));
    if (!r.ok) throw new Error(path + ' -> ' + r.status);
    return r.json();
  }

  async function init() {
    if (state.checked) return state;
    state.checked = true;
    try {
      const me = await req('me');
      state.enabled = true;
      state.hubId = me.hubId;
      state.displayName = me.displayName;
      state.team = me.team;
      state.authenticated = me.authenticated;
      state.profile = me.profile;
      state.identity = me.identity || null;
      state.pool = me.pool || null;
      state.isAdmin = Boolean(me.isAdmin);
      state.resetEpoch = Number(me.resetEpoch) || 0;

      // Do this BEFORE anything reads localStorage. Every page awaits init() before
      // it builds a game, and the wallet initializes lazily inside that game, so
      // this is the one point where a stale local copy can be dropped rather than
      // pushed back up to a server that was just cleared.
      state.wipedLocal = applyReset(state.resetEpoch);

      // First sign-in on a browser that already has local progress: adopt it so
      // nothing earned before the server existed is lost.
      if (!me.hasServerProfile) {
        const local = readLocalProfile();
        if (local) {
          state.profile = local;
          pushProfile(local, true);
        }
      }

      // A name the player set themselves always wins — only ever fill a blank.
      if (!state.displayName) await adoptFrontDoorName();
    } catch {
      state.enabled = false;   // static hosting, offline, or API down — stay quiet
    }
    return state;
  }

  // ---- honouring a server-side reset ----------------------------------------
  // Clearing the database is not enough on its own. Every cabinet's progress and
  // the shared wallet are local-first: they live in localStorage and get pushed
  // back up on the next page load, so a truncated server refills itself from the
  // first player through the door — and the owner sees a reset that "did not work".
  //
  // The server hands us the epoch ms of its last full wipe. Anything this browser
  // stored before that moment is stale by definition, so it goes. One stamp records
  // the epoch we have already honoured, which is why this runs once per reset and
  // not on every load.
  const RESET_STAMP = 'costbot.arcade.reset';

  function applyReset(epoch) {
    if (!epoch) return false;                 // never reset — nothing to honour
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(RESET_STAMP)) || 0;
    } catch {
      return false;                           // no storage at all: nothing to clear
    }
    if (seen >= epoch) return false;          // already dropped for this reset
    try {
      // Collect first, delete second — removing while iterating shifts the indices.
      const doomed = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.indexOf('costbot.') === 0 && k !== RESET_STAMP) doomed.push(k);
      }
      doomed.forEach((k) => { localStorage.removeItem(k); });
      localStorage.setItem(RESET_STAMP, String(epoch));
      if (doomed.length) {
        console.info('arcade: the server was reset — dropped ' + doomed.length
          + ' stale local key(s)');
      }
      return doomed.length > 0;
    } catch {
      return false;                           // private mode: nothing persisted anyway
    }
  }

  // ---- the email the front door will not forward ----------------------------
  // A hub id is a PERNR: correct as a key, useless as a label. The server cannot do
  // better on its own — the front door forwards ONLY x-aix-hub-id and x-aix-groups
  // downstream and deliberately strips x-aix-email before it reaches an app, so
  // nameFromEmail() there has nothing to work with in production and the boards fall
  // back to an employee number.
  //
  // The BROWSER can still ask. /whoami lives at the control-plane origin root — the
  // same origin serving this page — so the MyID session cookie rides along and it
  // answers with the caller's OWN identity and nobody else's.
  //
  // We send back the derived NAME, through the same path as the "set your name"
  // button, and deliberately NOT the raw address: a client-supplied email persisted
  // into an `email` column would look verified without being verified, and the
  // platform uses email as a share-by-email match key. A display name is
  // self-asserted either way, and scores stay keyed to the verified hub id.
  function nameFromEmail(email) {
    const local = String(email || '').split('@')[0];
    if (!local) return null;
    const parts = local.split(/[._-]+/)
      .filter((w) => w && !/^\d+$/.test(w))
      .map((w) => w.replace(/\d+$/, ''))      // drop a trailing "lee2" disambiguator
      .filter(Boolean);
    if (!parts.length) return null;
    return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  let whoamiOnce = null;
  function whoami() {
    // Cached: init() needs it only when the name is blank, but a page that wants to
    // SHOW the identity can ask any time without a second round trip.
    if (whoamiOnce) return whoamiOnce;
    whoamiOnce = (async () => {
      try {
        const r = await fetch(new URL('/whoami', global.location.origin).href, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (!r.ok) return null;               // 401 unauthenticated, 404 static host
        return await r.json();
      } catch {
        return null;                          // no control plane here — stay quiet
      }
    })();
    return whoamiOnce;
  }

  // What MyID actually knows about the viewer: {hubId, email, namespace, groups}.
  // Lazy on purpose — a game never needs it, so it stays off the run's critical path.
  async function identity() {
    const who = await whoami();
    if (who && who.email) {
      state.identity = {
        email: who.email,
        username: (state.identity && state.identity.username) || who.namespace || null,
      };
    }
    return { front_door: state.identity, myid: who };
  }

  async function adoptFrontDoorName() {
    const who = await whoami();
    if (!who || !who.email) return;
    state.identity = {
      email: who.email,
      username: (state.identity && state.identity.username) || null,
    };
    const name = nameFromEmail(who.email) || who.namespace || null;
    if (!name) return;
    state.displayName = name;
    await setDisplayName(name);               // persists, so this runs once per player
  }

  function readLocalProfile() {
    try {
      const raw = localStorage.getItem('costbot.wastehunter.v1');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  let pending = null;
  let timer = null;
  function pushProfile(profile, immediate) {
    if (!state.enabled || !profile) return;
    pending = profile;
    const flush = () => {
      timer = null;
      const body = { profile: pending };
      pending = null;
      req('profile', { method: 'PUT', body: JSON.stringify(body) })
        .then((r) => { if (r && r.team) state.team = r.team; })
        .catch(() => {});
    };
    if (immediate) { if (timer) clearTimeout(timer); flush(); return; }
    if (timer) return;                 // coalesce bursts of profile writes
    timer = setTimeout(flush, 1500);
  }

  function submit(result, profile) {
    if (!state.enabled) return Promise.resolve(null);
    // A queued profile write gets FLUSHED here, not dropped. Dropping it only
    // makes sense if this call carries the profile itself, and every caller
    // passes null — so cancelling the queued save just threw the run's progress
    // away and left the server a step behind.
    if (timer) { clearTimeout(timer); timer = null; if (pending) pushProfile(pending, true); }
    return req('score', {
      method: 'POST',
      body: JSON.stringify({ result: result, profile: profile || null }),
    }).catch(() => null);
  }

  // Lets a player fix their own label — the escape hatch when nothing derivable
  // is available and we would otherwise be stuck with an employee number.
  function setDisplayName(name) {
    if (!state.enabled || !name) return Promise.resolve(null);
    state.displayName = name;
    return req('profile', {
      method: 'PUT',
      body: JSON.stringify({ profile: state.profile || {}, displayName: name }),
    }).catch(() => null);
  }

  // ---- per-game profile slices --------------------------------------------
  // The server stores ONE profile blob per player. With more than one game in the
  // arcade that has to be namespaced, or the games overwrite each other. Older
  // blobs are a bare Waste Hunter profile, so those migrate on first read.
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return { games: {} };
    if (raw.games) return raw;
    // a legacy top-level Waste Hunter meta
    const looksLikeWH = 'tokens' in raw || 'credits' in raw   // 'credits' = pre-rename saves
      || 'achievements' in raw || 'cleared' in raw;
    return { games: looksLikeWH ? { 'waste-hunter': raw } : {} };
  }

  function gameProfile(id) {
    const p = migrate(state.profile);
    return (p.games && p.games[id]) || null;
  }

  // ---- reconciling a server slice with the local one ------------------------
  // Progress is LOCAL-FIRST: a cleared stage or an unlocked achievement is in
  // localStorage the instant it is earned, and goes to the server best-effort.
  // Any dropped write — a tab closed on the results screen, a navigation that
  // aborts the PUT mid-flight, a few seconds of no network — leaves the server
  // one step behind, and a host that boots from the server copy alone then hands
  // the player a silent rollback: the stage they just cleared is locked again.
  // It gets worse, because the rolled-back copy is what the next save writes to
  // localStorage, so a single lost write turns into lost progress for good.
  //
  // So neither copy wins outright. Everything these games persist is one-way — a
  // cleared stage never un-clears, a lifetime total never falls, an achievement
  // is never handed back — which means the two copies can be merged on those
  // semantics, and the merge is always at least as good as either input:
  //
  //   numbers   -> the larger (lifetime totals, per-stage bests, upgrade
  //                levels, achievement timestamps)
  //   booleans  -> either one (a cleared stage stays cleared)
  //   objects   -> key by key, recursively
  //   arrays    -> concatenated, de-duplicated, newest first (run history)
  //   anything
  //     else    -> whichever copy was written last, per `savedAt`
  //
  // NOT for the wallet. `tokens` is a spendable balance that legitimately goes
  // DOWN, and merging it upwards would refund every purchase ever made. The
  // wallet reconciles itself against lifetime `earned` — see arcade-wallet.js.
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // Arrays come in two flavours here and they must not be treated alike.
  //
  // A LOG is timestamped entries the game trims to a fixed length (run history).
  // Merged newest-first and trimmed back: neither side was allowed past the
  // game's cap, so the longer of the two IS that cap.
  //
  // A SET is unordered ids with no cap at all (achievements earned, trivia
  // questions seen). The union stands in full — capping one of those to the
  // longer input drops entries whenever the two copies have diverged, which is
  // precisely the case this whole merge exists to handle.
  function mergeList(server, local) {
    const seen = new Map();
    for (const item of server.concat(local)) {
      const key = isObj(item) && item.t !== undefined ? 't:' + item.t : JSON.stringify(item);
      if (!seen.has(key)) seen.set(key, item);
    }
    const all = Array.from(seen.values());
    if (!all.every((x) => isObj(x) && typeof x.t === 'number')) return all;
    all.sort((a, b) => b.t - a.t);
    return all.slice(0, Math.max(server.length, local.length));
  }

  function mergeValue(s, l, prefer) {
    if (s === undefined) return l;
    if (l === undefined) return s;
    if (typeof s === 'number' && typeof l === 'number') {
      if (!Number.isFinite(s)) return l;
      if (!Number.isFinite(l)) return s;
      return Math.max(s, l);
    }
    if (typeof s === 'boolean' && typeof l === 'boolean') return s || l;
    if (Array.isArray(s) && Array.isArray(l)) return mergeList(s, l);
    if (isObj(s) && isObj(l)) return mergeObj(s, l, prefer);
    return prefer === 'server' ? s : l;
  }

  function mergeObj(s, l, prefer) {
    const out = {};
    const keys = Object.keys(s).concat(Object.keys(l).filter((k) => !(k in s)));
    for (const k of keys) out[k] = mergeValue(s[k], l[k], prefer);
    return out;
  }

  // `opts.spendable` names top-level fields that are BALANCES rather than
  // records — they go down when the player buys something, so the larger of the
  // two copies is not the better one. Those come wholesale from whichever copy
  // was written last, because merging them upward refunds the purchase.
  function reconcile(server, local, opts) {
    if (!isObj(server)) return isObj(local) ? local : null;
    if (!isObj(local)) return server;
    // A local copy with no stamp cannot claim to be the newer one. That covers
    // both a browser that has never played and every save written before
    // stamping existed, and it keeps the old server-wins behaviour for the
    // fields a merge cannot reason about.
    const ls = Number(local.savedAt) || 0;
    const ss = Number(server.savedAt) || 0;
    const prefer = ls > 0 && ls >= ss ? 'local' : 'server';
    const merged = mergeObj(server, local, prefer);
    const newer = prefer === 'server' ? server : local;
    for (const k of (opts && opts.spendable) || []) {
      if (k in newer) merged[k] = newer[k];
    }
    return merged;
  }

  // What a host should boot a game from: the server slice merged with whatever
  // this browser already had. Pushes the result back when the server was the one
  // behind, so the next machine the player sits at starts from the merged copy
  // rather than repeating the rollback.
  function adopt(id, local, opts) {
    const server = gameProfile(id);
    const merged = reconcile(server, local, opts);
    if (!merged) return null;
    if (state.enabled && JSON.stringify(merged) !== JSON.stringify(server)) saveGame(id, merged);
    return merged;
  }

  function saveGame(id, data) {
    if (!state.enabled || !data) return;
    const p = migrate(state.profile);
    p.games = p.games || {};
    p.games[id] = data;
    state.profile = p;
    pushProfile(p, true);
  }

  function boards() {
    if (!state.enabled) return Promise.resolve(null);
    return req('leaderboards').catch(() => null);
  }

  // One game's own metrics, ranked per metric — the arcade board only speaks
  // dollars, which cannot express distance or top speed.
  function gameBoards(game) {
    if (!state.enabled || !game) return Promise.resolve(null);
    return req('leaderboards/' + encodeURIComponent(game)).catch(() => null);
  }

  // Last-chance flush when the tab goes away, so Bot Bay purchases and theme
  // changes made outside a run are not lost.
  global.addEventListener('pagehide', () => {
    if (timer && pending) {
      try {
        navigator.sendBeacon(
          API + 'profile',
          new Blob([JSON.stringify({ profile: pending })], { type: 'application/json' }),
        );
      } catch { /* best effort */ }
    }
  });

  global.ArcadeSync = {
    init, submit, pushProfile, boards, gameBoards, setDisplayName, gameProfile, saveGame,
    reconcile, adopt, identity,
    get state() { return state; },
    get enabled() { return state.enabled; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
