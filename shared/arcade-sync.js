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
    if (timer) { clearTimeout(timer); timer = null; pending = null; }
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
    identity,
    get state() { return state; },
    get enabled() { return state.enabled; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
