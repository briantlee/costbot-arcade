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

      // First sign-in on a browser that already has local progress: adopt it so
      // nothing earned before the server existed is lost.
      if (!me.hasServerProfile) {
        const local = readLocalProfile();
        if (local) {
          state.profile = local;
          pushProfile(local, true);
        }
      }
    } catch {
      state.enabled = false;   // static hosting, offline, or API down — stay quiet
    }
    return state;
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
    get state() { return state; },
    get enabled() { return state.enabled; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
