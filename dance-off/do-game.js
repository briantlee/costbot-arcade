/* ============================================================================
 * CostBot: Dance Off! — ENGINE
 * ----------------------------------------------------------------------------
 * A dance-battle rhythm cabinet in 3D, after the dance-off in Guardians of the
 * Galaxy: the dance is the distraction, and the win is what happens behind the
 * villain's back.
 *
 * Every round is the villain's eight-beat verse, then CostBot's. On his verse you
 * shadow him — hit his moves as he makes them — and the squad steps toward the
 * Infinity Invoice under the noise of each one. On yours you dance to keep him
 * watching; miss, and he glances back (his notes turn ✋: don't press). The squad
 * grabs the invoice on the song's last beat if they made it all the way.
 *
 * Also here: held Lifecycle Slides, the Groove meter and its Freestyle, the
 * Awesome Medley, and CostBot's wardrobe.
 *
 *   import { mount } from './do-game.js';
 *   const game = mount('#game', {
 *     profile,                    // optional server profile slice (ArcadeSync)
 *     onEvent(type, payload) {},  // 'ready' 'run:start' 'run:end'
 *     onComplete(result) {},      // at the end of every dance-off
 *   });
 *
 * Timing: every beat is measured on the AudioContext clock the music is
 * scheduled on (read back from ArcadeMusic.debug(), the same anchor CostBot
 * Hero uses), less the output latency, so what you hear is what is judged.
 * ==========================================================================*/
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCostBot, makeCoinFactory, DANCES, OUTFITS } from '../shared/costbot-3d.js';
import {
  MOVES, MOVE_ORDER, KEYS, GROOVE_KEY, ROUND_BEATS, SONGS, VILLAIN, DIFFS, DIFF_ORDER,
  buildChart, buildMedley, MEDLEY, BALANCE as B, GRADES, LINES,
} from './do-content.js';
import { buildStage, makeVillain, makeSquad, dressSquad, SPOTS } from './do-stage.js';
import { makeFloorLane } from './do-floorlane.js';

const GAME_ID = 'dance-off';
const VERSION = '0.2.0';
const STORE = 'costbot.danceoff.v1';
const HALF = ROUND_BEATS / 2;
const LOBBY_BEAT = 0.5;            // do_lobby is 120bpm
// the dances in costbot-3d.js move at two beats a second of model time: a bot's clock is
// scaled by MODEL_BEAT / beat so they land on any song's beat, and antic() lengths are model seconds
const MODEL_BEAT = 0.5;
const MASTER_VOL = 0.2;
const MUSIC_VOL = 0.8;
const SQUAD_DANCES = [['floss', 'ymca', 'sprinkler'], ['boogie', 'dab', 'twist'], ['robot', 'chicken', 'disco']];
const SQUAD_STAGE = [[-1.3, 3.4], [0.2, 3.9], [1.7, 3.4]];    // where the crew dances when the invoice is out

const NO_WALLET = { tokens: 0, earn: () => 0, spend: () => false, init: () => ({}) };
const wallet = () => window.ArcadeWallet || NO_WALLET;
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => Math.round(n).toLocaleString();
// the arcade's own gold coin, not the 🪙 emoji (which renders silver on some systems)
const TOK = '<img class="do-tok" src="../shared/assets/token-coin-64.png" alt="tokens">';
const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
const GRADE_STYLE = {
  perfect: { label: 'PERFECT!', color: '#ffe066' },
  great: { label: 'GREAT', color: '#6ff5c1' },
  good: { label: 'GOOD', color: '#8fc9ff' },
  miss: { label: 'MISS', color: '#ff5c7a' },
  wrong: { label: 'WRONG MOVE', color: '#ff5c7a' },
  offbeat: { label: 'OFF-BEAT', color: '#9aa3b8' },
  noise: { label: 'CLANK!', color: '#ffb020' },
  moved: { label: 'HE SAW THAT!', color: '#ff5c7a' },
  held: { label: 'HELD!', color: '#d9b3ff' },
  drop: { label: 'DROPPED', color: '#9aa3b8' },
};

const CSS = `
.do-root{position:absolute;inset:0;overflow:hidden;background:#05030c;font-family:'Segoe UI',system-ui,sans-serif;color:#f1ecff;user-select:none;-webkit-user-select:none}
.do-root canvas.do-gl{display:block;width:100%;height:100%}
.do-hud{position:absolute;inset:0;pointer-events:none}
.do-hud.off>*{opacity:0;transition:opacity .3s}
/* the notes sit in a band right under the dancers' feet, just above the pads, so your eyes never leave the floor */
.do-top{position:absolute;bottom:92px;left:50%;transform:translateX(-50%);width:min(760px,92vw);text-align:center}
.do-who{font:900 14px system-ui;letter-spacing:.24em;margin-bottom:6px;text-shadow:0 0 12px currentColor;transition:color .2s}
.do-who.call{color:#ff6b8b}.do-who.resp{color:#6ff5c1}.do-who.intro{color:#ffe066}
.do-lane{position:relative;height:64px;border-radius:14px;background:rgba(12,8,28,.42);border:1px solid rgba(90,70,160,.55);backdrop-filter:blur(4px);overflow:hidden;transition:box-shadow .3s,border-color .3s}
/* floor mode: the notes are on the dance floor, so the bar goes (its label and captions stay) */
.do-root.floor .do-lane{display:none}
.do-hud.free .do-lane{box-shadow:0 0 34px rgba(255,194,51,.7);border-color:#ffc233}
.do-hit{position:absolute;top:5px;bottom:5px;left:14%;width:62px;margin-left:-31px;border-radius:16px;border:3px solid rgba(255,255,255,.5);
  box-shadow:0 0 14px rgba(255,255,255,.3),inset 0 0 14px rgba(255,255,255,.12);transition:transform .08s,border-color .1s;z-index:4;pointer-events:none}
.do-hit.beat{transform:scale(1.08);border-color:#fff}
.do-time{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:min(420px,52vw);display:flex;align-items:center;gap:10px;font:800 12px system-ui;color:#cfc4f3;font-variant-numeric:tabular-nums}
.do-time .bar{flex:1;height:5px;border-radius:3px;background:rgba(20,14,40,.8);overflow:hidden}
.do-time .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#39d5ff,#b77bff,#ff4fa3)}
.do-now{position:absolute;top:40px;left:50%;transform:translateX(-50%);font:800 13px system-ui;color:#ffe066;letter-spacing:.06em;opacity:0;white-space:nowrap;text-shadow:0 0 10px rgba(255,224,102,.6)}
.do-now.on{animation:donow 3.2s ease-out}
@keyframes donow{0%{opacity:0;transform:translate(-50%,6px)}12%{opacity:1;transform:translate(-50%,0)}80%{opacity:1}100%{opacity:0}}
.do-mark{position:absolute;top:0;bottom:0;border-left:2px dashed rgba(255,255,255,.2)}
.do-mark span{position:absolute;top:4px;left:7px;font:900 10px system-ui;letter-spacing:.18em;white-space:nowrap}
.do-mark.villain span{color:#ff6b8b}.do-mark.you span{color:#6ff5c1}
.do-note{position:absolute;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  font:900 28px system-ui;color:#0d0820;transition:opacity .35s,transform .35s,background .15s,border-color .15s;z-index:3}
.do-note.sneak{background:rgba(18,10,40,.85);border:3px solid;border-radius:50%}
.do-note.sneak i{position:absolute;top:-7px;right:-9px;font-size:13px;font-style:normal}
.do-note.sneak.freeze{border-color:#8fc9ff !important;color:#8fc9ff !important;background:rgba(80,160,255,.35)}
.do-note .g{position:absolute;bottom:-13px;left:50%;transform:translateX(-50%);font:900 9px system-ui;letter-spacing:.14em;color:#fff;white-space:nowrap;text-shadow:0 1px 2px #000}
.do-note .tail{position:absolute;left:50%;top:50%;height:18px;margin-top:-9px;border-radius:0 9px 9px 0;opacity:.6;z-index:-1}
.do-note.holding{box-shadow:0 0 24px #fff;transform:scale(1.08)}
.do-note.free{box-shadow:0 0 16px #fff}
.do-note.done{opacity:0;transform:scale(1.6)}
.do-note.miss{background:#3a1020 !important;color:#ff8aa0}
.do-note.held{opacity:0}
.do-meter{position:absolute;top:60px;width:190px;font:700 12px system-ui;letter-spacing:.06em}
.do-meter.att{left:18px}.do-meter.heist{right:18px;text-align:right}
.do-meter.hide,.do-groove.hide{display:none}
.do-meter .bar{height:12px;margin-top:5px;border-radius:7px;background:rgba(20,14,40,.8);border:1px solid #3a2d66;overflow:hidden}
.do-meter .bar i{display:block;height:100%;width:50%;border-radius:7px;transition:width .15s,background .3s}
.do-meter.heist .bar i{margin-left:auto;background:linear-gradient(90deg,#7b3dff,#d9b3ff)}
.do-meter .sub{margin-top:5px;font-weight:600;color:#a99bd6;font-size:11px;min-height:14px}
.do-groove{position:absolute;left:18px;top:122px;width:190px;font:800 11px system-ui;letter-spacing:.14em;color:#ffe066}
.do-groove .bar{height:10px;margin-top:4px;border-radius:6px;background:rgba(20,14,40,.8);border:1px solid #5a4a20;overflow:hidden}
.do-groove .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff4fa3,#ffc233,#8dff5a,#39d5ff,#b77bff);transition:width .15s}
.do-groove button{display:none;margin:6px 0 0;pointer-events:auto;cursor:pointer;border:0;border-radius:14px;padding:6px 14px;font:900 12px system-ui;color:#12071f;background:linear-gradient(90deg,#ffc233,#ff4fa3)}
.do-groove.ready{animation:doready .5s infinite alternate}
.do-groove.ready button{display:block}
@keyframes doready{from{text-shadow:0 0 4px #ffc233}to{text-shadow:0 0 18px #ffc233}}
.do-score{position:absolute;left:18px;bottom:18px;font:800 13px system-ui;letter-spacing:.06em;color:#cfc4f3}
.do-score big{display:block;font:900 30px system-ui;color:#fff;letter-spacing:0}
.do-combo{position:absolute;right:18px;bottom:18px;text-align:right;font:800 13px system-ui;color:#cfc4f3}
.do-combo big{display:block;font:900 30px system-ui;color:#ffe066}
.do-judge{position:absolute;z-index:5;font:900 22px system-ui;letter-spacing:.04em;transform:translate(-50%,-50%);text-shadow:0 0 16px currentColor,0 2px 0 #000;opacity:0}
.do-judge.pop{animation:dopop .7s ease-out}
.do-big{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font:italic 900 64px system-ui;letter-spacing:.02em;text-shadow:0 0 30px currentColor,0 4px 0 #000;opacity:0;white-space:nowrap}
.do-big.pop{animation:dobig 1.1s ease-out}
@keyframes dopop{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}15%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-90%) scale(1)}}
@keyframes dobig{0%{opacity:0;transform:translate(-50%,-50%) scale(2)}15%{opacity:1;transform:translate(-50%,-50%) scale(1)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(.9)}}
/* speech is subtitled just above the lane, where your eyes already are */
.do-caps{height:44px;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;margin-bottom:4px}
.do-cap{font:700 14px system-ui;line-height:1.35;color:#f1ecff;opacity:0;transition:opacity .25s;text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.do-cap.on{opacity:1}
.do-cap b{font:900 11px system-ui;letter-spacing:.14em;margin-right:8px}
.do-cap.villain b{color:#ff6b8b}.do-cap.costbot b{color:#39d5ff}
/* a keyboard player never touches the pads: hide them and drop the lane to the very bottom */
.do-root:not(.touch) .do-pads{display:none}
.do-root:not(.touch) .do-top{bottom:20px}
.do-pads{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:8px;pointer-events:auto}
.do-pad{width:74px;height:62px;border-radius:14px;border:2px solid var(--c);background:rgba(12,8,28,.75);color:#fff;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font:800 9px system-ui;letter-spacing:.04em;touch-action:manipulation;
  transition:transform .06s}
.do-pad b{font:900 22px system-ui;color:var(--c);line-height:1}
.do-pad.hit{transform:scale(.92);background:var(--c);color:#0d0820}.do-pad.hit b{color:#0d0820}
.do-btn{pointer-events:auto;cursor:pointer;border:1px solid #4a3a80;background:rgba(18,12,40,.85);color:#e6ddff;border-radius:18px;padding:6px 12px;font:700 12px system-ui}
.do-btn:hover{background:#2a1d55;color:#fff}
.do-mute{position:absolute;left:14px;top:14px}
.do-panel{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(10,5,25,.55),rgba(5,2,12,.88));pointer-events:auto}
.do-panel.on{display:flex}
.do-box{width:min(640px,92vw);max-height:92vh;overflow:auto;padding:24px 30px;border-radius:22px;background:rgba(16,10,36,.92);border:1px solid #4a3a80;box-shadow:0 20px 80px rgba(0,0,0,.6),0 0 60px rgba(162,77,255,.2);text-align:center}
.do-box h1{margin:0;font:italic 900 46px system-ui;letter-spacing:.01em;background:linear-gradient(90deg,#ff4fa3,#ffc233,#39d5ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.do-box h1 small{display:block;font:800 14px system-ui;letter-spacing:.4em;color:#bff3ff;-webkit-text-fill-color:#bff3ff;margin-bottom:4px}
.do-box h2{margin:0 0 6px;font:900 32px system-ui}
.do-box p{color:#cfc4f3;line-height:1.5;font-size:15px;margin:10px 0}
.do-legend{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0}
.do-legend div{border:1px solid var(--c);border-radius:12px;padding:8px 4px;font:700 11px system-ui;color:#e6ddff}
.do-legend b{display:block;font:900 24px system-ui;color:var(--c)}
.do-go{pointer-events:auto;cursor:pointer;border:0;border-radius:30px;padding:14px 30px;font:900 17px system-ui;color:#12071f;
  background:linear-gradient(90deg,#ff4fa3,#ffc233);box-shadow:0 0 30px rgba(255,79,163,.5);margin:5px}
.do-go:hover{filter:brightness(1.1)}
.do-go.alt{background:#2a1d55;color:#e6ddff;box-shadow:none}
.do-fine{font-size:12px !important;color:#8f82b8 !important}
.do-grade{font:italic 900 96px system-ui;line-height:1;margin:6px 0;text-shadow:0 0 30px currentColor}
.do-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
.do-stats div{background:rgba(40,28,80,.5);border-radius:12px;padding:8px 4px;font:700 11px system-ui;color:#a99bd6;letter-spacing:.06em}
.do-stats b{display:block;font:900 20px system-ui;color:#fff;letter-spacing:0}
.do-tokens{font:900 22px system-ui;color:#ffc233}
.do-tok{width:1.15em;height:1.15em;vertical-align:-0.22em;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.do-outfit button .do-tok{width:14px;height:14px;vertical-align:-3px}
.do-setup{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;margin:4px 0 12px}
.do-songpick select{pointer-events:auto;max-width:300px;font:700 14px system-ui;padding:8px 10px;border-radius:12px;background:#1a1236;color:#f1ecff;border:1px solid #4a3a80}
.do-diffs{display:flex;gap:4px}
.do-diff{pointer-events:auto;cursor:pointer;border:1px solid var(--c);background:transparent;color:var(--c);border-radius:12px;padding:7px 11px;font:800 12px system-ui}
.do-diff.on{background:var(--c);color:#12071f}
.do-songbest{width:100%;margin:0 !important}
.do-exp{pointer-events:auto;cursor:pointer;font:700 12px system-ui;color:#cfc4f3;display:flex;align-items:center;gap:5px}
.do-exp input{pointer-events:auto;accent-color:#b77bff}
.do-shopgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.do-outfit{border:1px solid #4a3a80;border-radius:12px;padding:10px 6px;background:rgba(40,28,80,.4);font:700 11px system-ui;color:#a99bd6}
.do-outfit b{display:block;font:800 13px system-ui;color:#fff;margin-bottom:6px}
.do-outfit button{pointer-events:auto;cursor:pointer;border-radius:10px;border:1px solid #6a55b5;background:#2a1d55;color:#fff;font:800 11px system-ui;padding:5px 10px}
.do-outfit.on{border-color:#6ff5c1;background:rgba(40,120,90,.3)}
.do-outfit.locked{opacity:.55}
.do-otag{display:flex;gap:8px;justify-content:center;align-items:center;margin:2px 0 4px;font:700 14px system-ui;color:#cfc4f3}
.do-dbadge{font:900 12px system-ui;letter-spacing:.14em;padding:4px 10px;border-radius:10px;background:var(--c);color:#12071f}
.do-tabs{display:flex;gap:6px;justify-content:center;margin:10px 0 12px}
.do-tab{pointer-events:auto;cursor:pointer;border:1px solid var(--c);background:transparent;color:var(--c);border-radius:12px;padding:7px 14px;font:800 12px system-ui}
.do-tab.on{background:var(--c);color:#12071f}
.do-table{width:100%;border-collapse:collapse;font:600 13px system-ui;color:#e6ddff;font-variant-numeric:tabular-nums}
.do-table th{font:800 10px system-ui;letter-spacing:.1em;color:#8f82b8;text-align:left;padding:6px 6px;border-bottom:1px solid #3a2d66}
.do-table td{padding:7px 6px;border-bottom:1px solid rgba(58,45,102,.5);text-align:left}
.do-table td.n,.do-table th.n{text-align:right}
.do-table tr.me1 td{color:#ffe066}
.do-table .gr{font:italic 900 15px system-ui}
.do-play{pointer-events:auto;cursor:pointer;border:0;border-radius:10px;padding:5px 10px;font:900 11px system-ui;color:#12071f;background:linear-gradient(90deg,#ff4fa3,#ffc233);white-space:nowrap}
.do-play:hover{filter:brightness(1.12)}
.do-empty{color:#8f82b8;font-size:14px;margin:18px 0}
.do-bests{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:6px 0 0;font:700 12px system-ui;color:#cfc4f3}
.do-bests span b{color:var(--c)}

@media (max-width:640px){
  .do-top{bottom:88px}
  .do-who{font-size:10px;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .do-time{top:62px;width:70vw}
  .do-now{top:82px;font-size:11px}
  .do-lane{height:60px}
  .do-time{font-size:10px}
  .do-hit{width:48px;margin-left:-24px}
  .do-note{width:38px;height:38px;margin:-19px 0 0 -19px;font-size:20px;border-radius:11px}
  .do-meter{top:88px;width:42vw;font-size:10px}
  .do-meter .sub{font-size:10px}
  .do-score,.do-combo{top:196px;bottom:auto;font-size:10px}.do-score big,.do-combo big{font-size:22px}
  .do-groove{top:150px;left:18px;width:42vw}
  .do-pad{width:17vw;max-width:70px;height:64px}
  .do-cap{font-size:12px}.do-caps{height:36px}
  .do-box h1{font-size:34px}.do-big{font-size:36px}.do-judge{font-size:18px}
  .do-shopgrid{grid-template-columns:repeat(2,1fr)}
  .do-table{font-size:11px}.do-table .hideS{display:none}
}
`;

export function mount(target, opts = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  const onEvent = opts.onEvent || (() => {});
  const onComplete = opts.onComplete || (() => {});
  if (!document.getElementById('do-style')) {
    const st = document.createElement('style'); st.id = 'do-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  wallet().init && wallet().init();

  // ---- profile ----
  const blank = {
    best: 0, bestCombo: 0, bestAcc: 0, runs: 0, wins: 0, songs: {}, top: null,
    song: SONGS[0].key, diff: 'normal', experimental: false, noteView: null, outfit: 'classic', outfits: ['classic'],
  };
  let profile = { ...blank };
  try { profile = { ...blank, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { /* private mode */ }
  if (opts.profile) profile = { ...profile, ...opts.profile };
  if (!DIFFS[profile.diff]) profile.diff = 'normal';
  // your top runs per difficulty; a save from before this existed is seeded from its per-song bests
  const TOP_N = 10;
  if (!profile.top) {
    profile.top = Object.fromEntries(DIFF_ORDER.map((d) => [d, []]));
    for (const [k, v] of Object.entries(profile.songs || {})) {
      const [song, diff] = k.split(':');
      if (profile.top[diff] && v.best > 0) profile.top[diff].push({ song, score: v.best, won: v.wins > 0 });
    }
    for (const d of DIFF_ORDER) profile.top[d] = profile.top[d].sort((a, b) => b.score - a.score).slice(0, TOP_N);
  }
  for (const d of DIFF_ORDER) profile.top[d] = profile.top[d] || [];
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch { /* ok */ } };

  // ---- DOM ----
  const root = document.createElement('div');
  root.className = 'do-root';
  // touch devices get the pads; a keyboard player gets the screen back
  const TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  root.classList.toggle('touch', TOUCH);
  host.appendChild(root);
  const legend = MOVE_ORDER.map((id) => { const m = MOVES[id]; return `<div style="--c:${m.color}"><b>${m.glyph}</b>${m.name}</div>`; }).join('');
  root.innerHTML = `
    <div class="do-hud off">
      <div class="do-time"><span class="el">0:00</span><div class="bar"><i></i></div><span class="rem">-0:00</span></div>
      <div class="do-now"></div>
      <div class="do-top">
        <div class="do-caps"><div class="do-cap villain"><b></b><span></span></div><div class="do-cap costbot"><b>🕺 COSTBOT</b><span></span></div></div>
        <div class="do-who intro">GET READY</div><div class="do-lane"><div class="do-hit"></div></div>
      </div>
      <div class="do-meter att"><span class="lbl"></span><div class="bar"><i></i></div><div class="sub"></div></div>
      <div class="do-meter heist">💼 THE HEIST<div class="bar"><i></i></div><div class="sub"></div></div>
      <div class="do-groove">✨ GROOVE<div class="bar"><i></i></div><button class="do-groovebtn">✨ FREESTYLE (Enter)</button></div>
      <div class="do-score"><span class="lbl">SCORE</span><big>0</big></div>
      <div class="do-combo"><span class="lbl">COMBO</span><big>0</big></div>
      <div class="do-judge"></div><div class="do-big"></div>
      <div class="do-pads">${MOVE_ORDER.map((id) => { const m = MOVES[id]; return `<button class="do-pad" data-move="${id}" style="--c:${m.color}"><b>${m.glyph}</b>${m.name.replace(/^The /, '')}</button>`; }).join('')}</div>
    </div>
    <button class="do-btn do-mute" title="Sound (M)">🔊</button>
    <div class="do-panel do-title on"><div class="do-box">
      <h1><small>COSTBOT</small>DANCE OFF!</h1>
      <p class="do-story"></p>
      <p><b>His verse:</b> shadow him — hit each 👣 move as he dances it, and the squad sneaks a step toward the invoice.
        <b>Your verse:</b> dance your moves on the beat to keep him mesmerized. Hold <b>␣</b> for the whole slide.</p>
      <p>Miss and he glances back: his notes turn ✋ — <b>don't press them</b>. Fill ✨ Groove and hit <b>Enter</b> to freestyle.
        Get the squad all the way there, then <b>finish the song</b>: they grab the invoice on the last beat.</p>
      <div class="do-legend">${legend}</div>
      <p class="do-fine do-keys"></p>
      <div class="do-setup">
        <label class="do-songpick">🎵 <select class="do-song"></select></label>
        <div class="do-diffs">${DIFF_ORDER.map((d) => `<button class="do-diff" data-diff="${d}" style="--c:${DIFFS[d].color}">${DIFFS[d].label}</button>`).join('')}</div>
        <label class="do-exp"><input type="checkbox" class="do-expbox"> 🧪 Experimental songs</label>
        <button class="do-btn do-view" title="Where the notes go: on the dance floor, or in a bar along the bottom">🎯 Notes: on the floor</button>
        <button class="do-btn" data-act="scores">🏅 My scores</button>
        <button class="do-btn" data-act="shop">👕 Wardrobe</button>
        <div class="do-songbest do-fine"></div>
      </div>
      <button class="do-go" data-act="start">🕺 Dance-off, bro</button>
      <button class="do-go alt" data-act="board">🏆 Leaderboard</button>
      <div class="do-bests"></div>
      <p class="do-fine do-best"></p>
    </div></div>
    <div class="do-panel do-scores"><div class="do-box">
      <h2>🏅 Your top scores</h2>
      <div class="do-tabs">${DIFF_ORDER.map((d) => `<button class="do-tab" data-tab="${d}" style="--c:${DIFFS[d].color}">${DIFFS[d].label}</button>`).join('')}</div>
      <div class="do-toplist"></div>
      <button class="do-go do-scoreplay">🕺 Dance</button>
      <button class="do-go alt" data-act="menu">← Back</button>
    </div></div>
    <div class="do-panel do-shop"><div class="do-box">
      <h2>👕 CostBot's wardrobe</h2>
      <p class="do-fine do-shoppurse"></p>
      <div class="do-shopgrid"></div>
      <button class="do-go alt" data-act="menu">← Back</button>
    </div></div>
    <div class="do-panel do-over"><div class="do-box">
      <h2 class="do-otitle"></h2>
      <div class="do-otag"></div>
      <p class="do-osub"></p>
      <div class="do-grade"></div>
      <p class="do-oline"></p>
      <div class="do-stats"></div>
      <div class="do-tokens"></div>
      <p class="do-fine do-purse"></p>
      <button class="do-go" data-act="again">🔁 Dance again</button>
      <button class="do-go alt" data-act="menu">🎵 Change song</button>
      <button class="do-go alt" data-act="board">🏆 Leaderboard</button>
    </div></div>`;
  const $ = (s) => root.querySelector(s);
  const hud = $('.do-hud'), who = $('.do-who'), lane = $('.do-lane'), hitEl = $('.do-hit');
  const attLbl = $('.att .lbl'), attBar = $('.att .bar i'), attSub = $('.att .sub');
  const heistBar = $('.heist .bar i'), heistSub = $('.heist .sub');
  const grooveEl = $('.do-groove'), grooveBar = $('.do-groove .bar i');
  const scoreEl = $('.do-score big'), comboEl = $('.do-combo big');
  const judgeEl = $('.do-judge'), bigEl = $('.do-big');
  const nowEl = $('.do-now');
  const timeEl = $('.do-time .el'), timeRem = $('.do-time .rem'), timeBar = $('.do-time .bar i');
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const sayEl = { villain: $('.do-cap.villain'), costbot: $('.do-cap.costbot') };
  const muteBtn = $('.do-mute');

  // ---- three ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.className = 'do-gl';
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.45, 0.92));
  composer.addPass(new OutputPass());

  const stage = buildStage(scene);
  // the notes on the dance floor: one row across the front of it, right to left into a ring
  const floor = makeFloorLane(scene);
  floor.setVisible(false);
  // desktop defaults to the floor; a phone's scene is small, so it defaults to the bar — either can switch
  const floorMode = () => (profile.noteView ? profile.noteView === 'floor' : !TOUCH);
  function applyView() {
    root.classList.toggle('floor', floorMode());
    $('.do-view').textContent = floorMode() ? '🎯 Notes: on the floor' : '▭ Notes: in a bar';
  }
  const costbot = createCostBot({ style: 'glossy', shadows: false });
  costbot.root.position.copy(SPOTS.costbot);
  const villain = makeVillain();              // Max Tokens
  villain.root.position.copy(SPOTS.villain);
  scene.add(villain.root);
  const squad = makeSquad();
  dressSquad(squad);
  scene.add(costbot.root, ...squad.map((m) => m.bot.root));
  const COSTBOT_YAW = 0.5, VILLAIN_YAW = -0.55, VILLAIN_BACK = Math.PI * 0.86;
  costbot.root.rotation.y = COSTBOT_YAW;
  const V = VILLAIN;
  sayEl.villain.querySelector('b').textContent = `${V.icon} ${V.short}`;
  villain.root.rotation.set(0, VILLAIN_YAW, 0);
  // feet on the floor: after a bot animates, find the lowest point of its legs and lift the
  // whole bot if that is below the floor — covers the hover bob, crouches, thrusts, landings
  const FLOOR_Y = 0.02, legBox = new THREE.Box3();
  function standOnFloor(bot) {
    bot.root.updateMatrixWorld(true);
    let low = Infinity;
    for (const leg of bot.legs) { legBox.setFromObject(leg); low = Math.min(low, legBox.min.y); }
    if (low < FLOOR_Y) bot.root.position.y += FLOOR_Y - low;
  }
  const applyOutfit = () => { costbot.setOutfit(profile.outfits.includes(profile.outfit) ? profile.outfit : 'classic'); };

  const coinOf = makeCoinFactory();
  const coins = [];

  // camera shots: [position, look-at]; 'freestyle' orbits and is worked out per frame
  const SHOTS = {
    title: [[0, 5.4, 19], [0, 3, -3]],
    // in play the camera looks low, so the dancers stand above the note band at the bottom
    wide: [[0, 6.2, 20], [0, 1.4, -3.5]],
    villain: [[2.2, 4.6, 15.5], [2.4, 1.7, -1.8]],
    costbot: [[-2, 4.3, 15], [-1.8, 1.5, -0.8]],
    glance: [[2, 9.5, 18], [1.5, 0.6, -7]],
    finale: [[3, 6.5, 17], [3.5, 1.4, -5]],
    party: [[0, 5, 16], [0, 1.3, 0.5]],
    freestyle: [[0, 5.5, 15], [0, 1.5, -1]],
  };
  let shot = 'title';
  const camPos = new THREE.Vector3(...SHOTS.title[0]), camLook = new THREE.Vector3(...SHOTS.title[1]);
  const tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
  camera.position.copy(camPos); camera.lookAt(camLook);

  function resize() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // narrow screens: pull the lens wider so both dancers stay in shot
    camera.fov = w / h < 1 ? 62 : 42;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- audio ----
  let actx = null, master = null, music = null, muted = false;
  function audioInit() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(actx.destination);
    if (window.ArcadeMusic) { music = window.ArcadeMusic.create(() => ({ ctx: actx, master })); music.setVolume(MUSIC_VOL); }
    if (phase === 'title') playLobby();
  }
  const latency = () => (actx ? (actx.outputLatency || actx.baseLatency || 0.02) : 0);
  // beat 0 of the current anchor, in AudioContext seconds (or performance seconds with no audio)
  let clockT0 = 0, audioClock = false;
  function anchor(track) {
    if (!music || !actx) { clockT0 = performance.now() / 1000; audioClock = false; return; }
    music.stop();
    music.playTrack(track);
    const d = music.debug();
    const T = window.ArcadeMusic.TRACKS[track];
    clockT0 = (d.nextTime || actx.currentTime + 0.08) - (d.step || 0) * (60 / T.bpm / 4);
    audioClock = true;
    lastBeat = null;           // a new clock: count beats from here, don't replay (or wait out) the old one
  }
  const songTime = () => (audioClock && actx ? actx.currentTime - latency() : performance.now() / 1000);
  let BEAT = LOBBY_BEAT;       // seconds per dance beat: the lobby's, or the song's (x2 in half-time)
  const beatNow = () => (songTime() - clockT0) / BEAT;
  function playLobby() { BEAT = LOBBY_BEAT; if (music) anchor('do_lobby'); else lastBeat = null; }

  function tone(freq, dur, { type = 'sine', gain = 0.25, at = 0, to = null } = {}) {
    if (!actx || muted) return;
    const t = actx.currentTime + at;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, { freq = 1500, q = 0.9, gain = 0.5, sweep = null } = {}) {
    if (!actx || muted) return;
    const len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (sweep ? 1 - i / len : Math.exp(-i / (len * 0.18)));
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    const t = actx.currentTime;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) { f.frequency.exponentialRampToValueAtTime(sweep[0], t + dur * 0.4); f.frequency.exponentialRampToValueAtTime(sweep[1], t + dur * 0.9); }
    const g = actx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }
  const scratch = () => noise(0.35, { freq: 2400, q: 3, sweep: [300, 1800] });     // the record scratch of a glance
  const clap = () => noise(0.12, { gain: 0.55 });                                    // the handoff clap
  const SFX = {
    perfect: () => { tone(1318, 0.12, { gain: 0.18 }); tone(1760, 0.16, { gain: 0.14, at: 0.05 }); },
    great: () => tone(1175, 0.14, { gain: 0.16 }),
    good: () => tone(880, 0.12, { gain: 0.13 }),
    miss: () => tone(160, 0.28, { type: 'sawtooth', gain: 0.12, to: 70 }),
    offbeat: () => tone(300, 0.08, { type: 'square', gain: 0.05 }),
    step: () => { tone(1900, 0.05, { type: 'triangle', gain: 0.12 }); tone(1400, 0.05, { type: 'triangle', gain: 0.08, at: 0.04 }); },
    alarm: () => { tone(880, 0.18, { type: 'square', gain: 0.1 }); tone(660, 0.3, { type: 'square', gain: 0.1, at: 0.18 }); },
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(f, 0.3, { type: 'triangle', gain: 0.16, at: i * 0.09 }); }),
    lose: () => [392, 330, 262, 196].forEach((f, i) => { tone(f, 0.35, { type: 'triangle', gain: 0.14, at: i * 0.16 }); }),
    groove: () => [659, 784, 988, 1175, 1319, 1568].forEach((f, i) => { tone(f, 0.22, { type: 'sawtooth', gain: 0.07, at: i * 0.05 }); }),
  };
  function setMuted(m) {
    muted = m;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, actx.currentTime, 0.05);
  }

  // ---- speech, judgement, big text ----
  const sayT = { villain: 0, costbot: 0 };
  function say(whoId, text, secs = 2.6) { sayEl[whoId].querySelector('span').textContent = text; sayEl[whoId].classList.add('on'); sayT[whoId] = secs + 0.8; }
  function pop(el, text, color) {
    el.textContent = text; el.style.color = color;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  // judgements pop right over the hit ring, not over a dancer's head
  function showJudge(kind) {
    const st = GRADE_STYLE[kind];
    if (floorMode() && run) {
      // over the ring on the floor
      floor.ringAt(tmpV).project(camera);
      judgeEl.style.left = `${(tmpV.x * 0.5 + 0.5) * root.clientWidth}px`;
      judgeEl.style.top = `${(-tmpV.y * 0.5 + 0.5) * root.clientHeight}px`;
      pop(judgeEl, st.label, st.color);
      return;
    }
    const rr = hitEl.getBoundingClientRect(), base = root.getBoundingClientRect();
    judgeEl.style.left = `${rr.left - base.left + rr.width / 2}px`;
    judgeEl.style.top = `${rr.top - base.top - 16}px`;
    pop(judgeEl, st.label, st.color);
  }

  // ---- dancing ----
  // each move takes turns through its list; long notes get the big ones (see MOVES in do-content.js)
  const turn = {};
  function danceFor(moveId, len) {
    const set = MOVES[moveId].dances[len >= 1.5 ? 'long' : 'short'];
    turn[moveId + len] = ((turn[moveId + len] ?? -1) + 1) % set.length;
    return set[turn[moveId + len]];
  }
  // a hit lands with a squash-and-stretch punch on whoever danced it
  const punch = new Map();
  function dance(bot, moveId, len) { bot.antic(danceFor(moveId, len), Math.max(0.5, len) * MODEL_BEAT); punch.set(bot, 1); }

  // ---- the run ----
  let phase = 'title';          // title | play | finale | over
  let run = null;
  const newStats = () => ({ score: 0, combo: 0, best: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0, held: 0, hands: 0 } });
  // Every move the villain makes is a note on his verse ('sneak': you shadow it), and his
  // verse is followed by yours ('move'). `calls` is what he
  // dances on his own in solo; `marks` label whose half is whose.
  function buildNotes(chart) {
    const notes = [], calls = [], marks = [];
    const n = chart.rounds.length;
    chart.rounds.forEach((rd, r) => {
      const r0 = chart.intro + r * ROUND_BEATS;
      marks.push({ beat: r0 - 0.5, kind: 'villain', label: `${V.icon} ${V.short} · ${r + 1}/${n}` },
        { beat: r0 + HALF - 0.5, kind: 'you', label: '🕺 YOU' });
      for (const c of rd.call) {
        calls.push({ beat: r0 + c.at, move: c.move, len: c.len, done: false });
        notes.push({ kind: 'sneak', owner: 'p1', r, beat: r0 + c.at, move: c.move, len: c.len, hold: !!c.hold, judged: null, el: null });
      }
      for (const c of rd.resp) notes.push({ kind: 'move', owner: 'p1', r, beat: r0 + HALF + c.at, move: c.move, len: c.len, hold: !!c.hold, judged: null, el: null });
    });
    return { notes, calls, marks };
  }

  function start() {
    audioInit();
    if (run) return;
    ['.do-title', '.do-over', '.do-shop', '.do-scores'].forEach((s) => { $(s).classList.remove('on'); });
    const song = profile.song, diff = profile.diff;
    const medley = song === MEDLEY.key ? rollMedley() : null;       // a fresh mix every dance
    const track = window.ArcadeMusic && window.ArcadeMusic.TRACKS[song] ? song : SONGS[0].key;
    stage.setArt(artFor(medley && medley.length ? medley[0].key : track));
    applyOutfit();
    hud.classList.remove('off');
    floor.setVisible(floorMode());
    stage.reset();
    stage.dimSign(true);
    for (const c of coins) scene.remove(c.mesh);
    coins.length = 0;
    dressSquad(squad);                 // a new crew look every dance
    squad.forEach((m, i) => {
      m.s = 0; m.hop = 0; m.party = false; m.bot.setMood('happy'); m.bot.root.scale.setScalar(0.42);
      m.bot.root.rotation.y = Math.PI / 2; m.bot.root.position.copy(SPOTS.squadFrom).x -= i * 1.3;
    });
    clearLane();
    const chart = buildChart(window.ArcadeMusic.TRACKS[track], diff);
    const built = buildNotes(chart);
    const nSneak = built.notes.filter((x) => x.kind === 'sneak').length;
    BEAT = chart.beatSec;
    run = {
      ...built, song: track, diff, medley: medley && medley.map((g) => ({ ...g, beat: (g.bar * 4) / chart.unit, shown: false })), intro: chart.intro, nRounds: chart.rounds.length,
      win: (DIFFS[diff] || DIFFS.normal).win, missCost: (DIFFS[diff] || DIFFS.normal).missCost, step: 100 / (nSneak * B.stepShare),
      p: { p1: newStats() }, steps: 0, holds: [], groove: 0, free: null,
      suspicion: 0, heist: 0, glance: null, suspicious: false, alarmed: false,
      round: -1, fin: null, started: performance.now(),
    };
    attLbl.textContent = `🚨 ${V.short}'S SUSPICION`;
    phase = 'play';
    anchor(track);
    who.className = 'do-who intro'; who.textContent = 'GET READY';
    shot = 'wide';
    updateMeters();
    onEvent('run:start', { game: GAME_ID, song: track, diff });
  }

  // ---- the lane ----
  // Notes scroll right to left: a note sits at the hit line on its beat and is on screen
  // laneAhead beats before that — the runway into every verse. A hold has a tail as long
  // as its slide; while it is held its head pins to the line and the tail runs down.
  function clearLane() {
    lane.querySelectorAll('.do-note,.do-mark').forEach((el) => { el.remove(); });
    floor.clear();
  }
  function paintNote(el, n, moveId) {
    const m = MOVES[moveId];
    if (n.kind === 'move') el.style.background = m.color;
    if (n.kind === 'sneak') { el.style.borderColor = m.color; el.style.color = m.color; }
    el.firstChild.nodeValue = m.glyph;
    const tail = el.querySelector('.tail');
    if (tail) tail.style.background = m.color;
  }
  function noteEl(n) {
    const el = document.createElement('div');
    el.className = `do-note ${n.kind}`;
    el.innerHTML = `?${n.kind === 'sneak' ? '<i>👣</i>' : ''}${n.hold ? '<div class="tail"></div>' : ''}<div class="g"></div>`;
    paintNote(el, n, n.move);
    lane.appendChild(el);
    return el;
  }
  function laneFrame(b, dt) {
    const glanceBy = run.glance ? run.glance.start + B.glanceBeats : -Infinity;
    if (floorMode()) {
      // his notes turn to hands while he looks back — the judging reads n.frozen, so it is set here too
      for (const n of run.notes) if (n.kind === 'sneak' && !n.judged && n.beat - b < B.laneAhead + 1) n.frozen = n.beat <= glanceBy;
      floor.sync(run.notes, run.marks, b, { ahead: B.floorAhead, glanceEnd: glanceBy, free: !!run.free, dt });
      return;
    }
    // fewer beats on screen when it is narrow, so 8th notes never pile on top of each other
    const w = lane.clientWidth, hitX = w * 0.14, ahead = clamp(w / 150, 3.5, B.laneAhead), ppb = (w - hitX - 24) / ahead;
    const x = (beat) => hitX + (beat - b) * ppb;
    const glanceEnd = run.glance ? run.glance.start + B.glanceBeats : -Infinity;
    for (const n of run.notes) {
      const dx = n.beat - b, end = n.hold ? n.len : 0;
      if (dx > ahead + 0.6 || dx + end < -1.4) {
        if (n.el) { n.el.remove(); n.el = null; }
        continue;
      }
      if (!n.el) n.el = noteEl(n);
      n.el.style.left = `${n.holding ? hitX : x(n.beat)}px`;
      if (n.hold) {
        const tail = n.el.querySelector('.tail');
        if (tail) tail.style.width = `${Math.max(0, (n.holding ? n.beat + n.len - b : n.len) * ppb)}px`;
      }
      if (n.judged) continue;
      n.el.classList.toggle('free', !!run.free);
      if (n.kind === 'sneak') {
        // while he is looking back, his notes are hands: do not move
        const frozen = n.beat <= glanceEnd;
        if (frozen !== !!n.frozen) {
          n.frozen = frozen;
          n.el.classList.toggle('freeze', frozen);
          n.el.firstChild.nodeValue = frozen ? '✋' : MOVES[n.move].glyph;
        }
      }
    }
    for (const mk of run.marks) {
      const dx = mk.beat - b, on = dx < ahead + 0.6 && dx > -1.4;
      if (on && !mk.el) {
        mk.el = document.createElement('div');
        mk.el.className = `do-mark ${mk.kind}`;
        mk.el.innerHTML = `<span>${mk.label}</span>`;
        lane.appendChild(mk.el);
      }
      if (!on && mk.el) { mk.el.remove(); mk.el = null; }
      if (mk.el) mk.el.style.left = `${x(mk.beat)}px`;
    }
  }
  function markNote(n, grade, label, done = grade !== 'miss') {
    floor.mark(n, grade);
    if (!n.el) return;
    n.el.classList.add(grade);
    n.el.querySelector('.g').textContent = label;
    if (done) n.el.classList.add('done');
  }

  function updateMeters() {
    if (!run) return;
    const a = run.suspicion;
    attBar.style.width = `${a}%`;
    attBar.style.background = a < 30 ? 'linear-gradient(90deg,#2ee6a6,#8dff5a)' : a < 60 ? 'linear-gradient(90deg,#ffb020,#ffe066)' : 'linear-gradient(90deg,#ff2d55,#ff7a8a)';
    attSub.textContent = run.free ? 'Hypnotized. 🌈' : a < 30 ? 'Mesmerized.' : a < 60 ? 'Getting suspicious…' : a < 85 ? 'He’s onto you!' : 'One more slip…';
    heistBar.style.width = `${Math.min(100, run.heist)}%`;
    heistSub.textContent = run.glance ? 'Squad frozen…' : run.heist >= 100 ? 'In position — finish the song!' : `${Math.floor(run.heist)}% to the invoice`;
    grooveBar.style.width = `${run.free ? 100 : run.groove}%`;
    grooveEl.classList.toggle('ready', run.groove >= 100 && !run.free);
    scoreEl.textContent = fmt(run.p.p1.score);
    comboEl.textContent = run.p.p1.combo;
  }

  // integer beats: the floor, the calls, the phase changes
  function onBeat(bi) {
    stage.pulse(((bi % 64) + 64) % 64, !!(run && run.free));
    hitEl.classList.add('beat'); setTimeout(() => hitEl.classList.remove('beat'), 90);
    floor.pulse();
    if (phase === 'title' || phase === 'over') {
      // attract mode: the two of them trade four-beat dances to the lobby groove
      if (bi % 8 === 0) costbot.antic(pick(DANCES), 4 * MODEL_BEAT);
      if (bi % 8 === 4) villain.antic(pick(DANCES), 4 * MODEL_BEAT);
      return;
    }
    if (!run) return;
    if (phase === 'finale') { finaleBeat(bi); return; }
    const rel = bi - run.intro;
    if (rel < 0) {
      if (bi === 1) say('villain', pick(V.lines.intro), 3.4);
      if (bi === 7) say('costbot', pick(LINES.costbotIntro), 3.2);
      if (bi >= run.intro - 4) pop(bigEl, bi === run.intro - 1 ? 'DANCE!' : String(run.intro - 1 - bi), '#ffe066');
      if (bi === run.intro - 4) shot = 'villain';
      return;
    }
    const r = Math.floor(rel / ROUND_BEATS), inR = rel % ROUND_BEATS;
    if (inR === 0) {
      if (r >= run.nRounds) { beginFinale(run.heist >= 100 ? 'win' : 'songOver'); return; }   // the last beat decides it
      run.round = r;
      who.className = 'do-who call';
      who.textContent = `ROUND ${r + 1}/${run.nRounds} · HIS VERSE — SHADOW HIM 👣`;
      if (!run.free) shot = 'villain';
      if (r > 0 && Math.random() < 0.45) say('villain', pick(V.lines.round));
    }
    // the handoff: two claps and a countdown, and the camera gets there first
    if (inR === HALF - 2 || inR === HALF - 1) {
      clap();
      who.className = 'do-who resp'; who.textContent = `YOUR MOVE IN ${HALF - inR}…`;
      if (inR === HALF - 1 && !run.glance && !run.free) shot = 'costbot';
    }
    // whoever just finished points the floor over to the other one
    if (inR === HALF && r < run.nRounds) {
      villain.antic('pointright', 1.2 * MODEL_BEAT);
      if (Math.random() < 0.35) say('villain', pick(LINES.yourTurn), 1.4);
    }
    if (inR === 0 && r > 0 && r < run.nRounds) {
      costbot.antic('point', 1.2 * MODEL_BEAT);
      if (Math.random() < 0.35) say('costbot', `${pick(LINES.yourTurn)} 👉`, 1.4);
    }
    if (inR === HALF) { who.className = 'do-who resp'; who.textContent = 'YOUR VERSE — KEEP HIM WATCHING'; }
    // suspicious enough, he checks behind him on his own, halfway through his verse
    if (inR === 4 && run.suspicion >= B.lookAbove) startGlance();
  }

  // ---- input ----
  function press(moveId) {
    audioInit();
    flashPad(moveId);
    if (phase !== 'play' || !run) return;
    const b = beatNow();
    const rel = b - run.intro;
    if (rel < 0) return;
    let best = null, bestD = Infinity;
    for (const n of run.notes) {
      if (n.judged) continue;
      const d = Math.abs(n.beat - b) * BEAT;
      if (d < bestD) { bestD = d; best = n; }
    }
    const [wp, wg, wok] = run.win;
    if (best && bestD <= wok) { hitNote(best, moveId, bestD <= wp ? 'perfect' : bestD <= wg ? 'great' : 'good'); return; }
    stray(moveId, ((rel % ROUND_BEATS) + ROUND_BEATS) % ROUND_BEATS);
  }
  function release(moveId) {
    if (!run) return;
    const b = beatNow();
    for (const h of run.holds) if (!h.over && h.key === moveId) endHold(h, b >= h.n.beat + h.n.len - B.hold.grace);
  }

  // a press with no note under it
  function stray(moveId, inR) {
    if (run.free) return;                                  // freestyle: nothing is wrong
    suspect(B.suspicion.offbeat);
    if (inR < HALF - run.win[2] / BEAT) {
      // on his verse: the squad clanks something
      showJudge('noise'); SFX.offbeat();
      if (run.suspicion >= B.clankLookAbove) startGlance();
    } else {
      dance(costbot, moveId, 1);
      showJudge('offbeat'); SFX.offbeat();
    }
    updateMeters();
  }

  // a hit lands: points, combo, and the Groove (only for the solo player)
  // countAs: which tally it goes in (a ✋ left alone is 'hands', paid like a Good)
  function award(pl, grade, base = B.points[grade], countAs = grade) {
    const st = run.p[pl];
    st.combo += 1;
    st.best = Math.max(st.best, st.combo);
    st.counts[countAs] += 1;
    st.score += base * (1 + Math.min(st.combo, B.comboCap) / B.comboCap) * (run.free ? B.groove.mult : 1);
    if (!run.free) {
      const was = run.groove;
      run.groove = Math.min(100, run.groove + (B.groove.fill[grade] || 0));
      if (was < 100 && run.groove >= 100) { pop(bigEl, '✨ GROOVE READY — ENTER!', '#ffc233'); tone(1568, 0.2, { type: 'triangle', gain: 0.12 }); }
    }
  }
  function breakCombo(pl) {
    const st = run.p[pl];
    st.combo = 0;
    st.counts.miss += 1;
    run.groove = Math.max(0, run.groove + B.groove.miss);
  }

  function hitNote(n, moveId, grade) {
    const right = run.free || moveId === n.move;
    if (n.kind === 'sneak') { sneakNote(n, right, grade, moveId); return; }
    // a dance note: CostBot's verse
    const dancer = costbot;
    dance(dancer, right ? n.move : moveId, n.len);
    if (!right) { missNote(n, true); return; }
    n.judged = grade;
    award(n.owner, grade);
    SFX[grade]();
    showJudge(grade, dancer);
    suspect(-B.suspicion.drain[grade]);
    if (!run.glance) addHeist(run.step * B.moveShare * B.sneak[grade]);
    const c = run.p.p1.combo;
    if (c > 0 && c % 16 === 0) { say('costbot', pick(LINES.costbotHype), 2); pop(bigEl, `${c} COMBO!`, '#ffe066'); }
    if (n.hold) startHold(n, moveId, grade);
    else markNote(n, grade, grade.toUpperCase());
    flawlessCheck(n);
    updateMeters();
  }

  // a shadow step on his verse: his own move, on his beat — the squad steps under the noise of it
  function sneakNote(n, right, grade, moveId) {
    if (run.glance) {
      // he is looking straight at them
      n.judged = 'miss';
      breakCombo('p1');
      markNote(n, 'miss', 'MOVED!');
      showJudge('moved');
      SFX.alarm();
      suspect(B.suspicion.moved);
      updateMeters();
      return;
    }
    if (!right) {
      // the wrong step is a clank; a bored villain turns round to see what it was
      n.judged = 'miss';
      breakCombo('p1');
      markNote(n, 'miss', 'CLANK');
      showJudge('noise'); SFX.offbeat();
      suspect(run.missCost * B.suspicion.clank);
      if (run.suspicion >= B.clankLookAbove) startGlance();
      updateMeters();
      return;
    }
    n.judged = grade;
    award('p1', grade);
    suspect(-B.suspicion.drain[grade]);
    run.steps += 1;
    SFX.step();
    squad.forEach((m) => { m.hop = 0.22; });
    addHeist(run.step * B.sneak[grade]);
    if (n.hold) startHold(n, moveId, grade);
    else markNote(n, grade, grade.toUpperCase());
    updateMeters();
  }

  // a dance note missed: no press, or the wrong move
  function missNote(n, wrong) {
    n.judged = 'miss';
    breakCombo(n.owner);
    markNote(n, 'miss', wrong ? 'WRONG' : 'MISS');
    SFX.miss();
    showJudge(wrong ? 'wrong' : 'miss');
    if (!run.free) {
      suspect(run.missCost);
      wobble = 0.5;
      startGlance();
    }
    updateMeters();
  }

  // a whole verse at Great or better: a bonus, and the other dancer stumbles
  function flawlessCheck(n) {
    const verse = run.notes.filter((x) => x.kind === n.kind && x.r === n.r);
    if (!verse.every((x) => x.judged) || !verse.every((x) => x.judged === 'perfect' || x.judged === 'great')) return;
    if (n.kind !== 'move') return;
    run.p[n.owner].score += B.flawless.score;
    pop(bigEl, 'FLAWLESS!', '#6ff5c1');
    SFX.win();
    villainWobble = 0.7;
    say('villain', pick(V.lines.flawless), 1.8);
    suspect(-B.suspicion.flawless);
  }

  // ---- holds: the Lifecycle Slide ----
  function startHold(n, key, grade) {
    n.holding = true;
    run.holds.push({ n, key, grade, over: false, lastB: n.beat });
    if (n.el) { n.el.classList.add('holding'); n.el.querySelector('.g').textContent = 'HOLD'; }
  }
  function holdFrame(b) {
    for (const h of run.holds) {
      if (h.over) continue;
      const upTo = Math.min(b, h.n.beat + h.n.len);
      if (upTo > h.lastB) {
        const st = run.p[h.n.owner];
        st.score += B.hold.tickPerBeat * (upTo - h.lastB) * (1 + Math.min(st.combo, B.comboCap) / B.comboCap) * (run.free ? B.groove.mult : 1);
        h.lastB = upTo;
      }
      if (b >= h.n.beat + h.n.len) endHold(h, true);
    }
    run.holds = run.holds.filter((h) => !h.over);
  }
  function endHold(h, full) {
    h.over = true;
    h.n.holding = false;
    if (h.n.el) h.n.el.classList.remove('holding');
    const st = run.p[h.n.owner];
    if (full) {
      st.score += B.hold.bonus;
      st.counts.held += 1;
      markNote(h.n, h.grade, 'HELD!');
      showJudge('held');
      if (h.n.kind === 'sneak') addHeist(run.step * B.hold.heist);
      tone(1568, 0.16, { type: 'triangle', gain: 0.12 });
    } else {
      markNote(h.n, h.grade, 'DROP');
      showJudge('drop');
    }
    updateMeters();
  }

  // ---- the Groove: Freestyle ----
  function freestyle() {
    if (!run || run.free || run.groove < 100 || phase !== 'play') return;
    run.groove = 0;
    run.free = { until: beatNow() + B.groove.beats };
    run.glance = null;
    hud.classList.add('free');
    pop(bigEl, 'FREESTYLE!', '#ffc233');
    say('costbot', pick(LINES.groove), 2.2);
    SFX.groove();
    shot = 'freestyle';
    costbot.cheer();
    updateMeters();
  }
  function endFreestyle() {
    run.free = null;
    hud.classList.remove('free');
    shot = 'villain';
  }

  // ---- the heist, the glance, the strike (solo) ----
  // The squad fills the heist over the whole song and waits at the pedestal once it is
  // full; the grab itself happens on the song's last beat (see beginFinale).
  function addHeist(n) {
    const was = run.heist;
    run.heist = Math.min(100, run.heist + n);
    if (!run.suspicious && run.heist >= 75) { run.suspicious = true; say('villain', pick(V.lines.suspicious)); }
    if (was < 100 && run.heist >= 100) {
      pop(bigEl, 'IN POSITION!', '#d9b3ff');
      say('costbot', 'They’re at the invoice — finish the song! 🕺', 2.6);
    }
  }
  function startGlance() {
    if (!run || run.glance || run.free) return;
    run.glance = { start: beatNow() };
    scratch();
    say('villain', pick(V.lines.glance), 1.8);
    shot = 'glance';
    squad.forEach((m) => { m.bot.setMood('worried'); });
  }
  // Suspicion never goes up during a Freestyle; at the top he has them
  function suspect(n) {
    if ((n > 0 && run.free) || phase !== 'play') return;
    run.suspicion = clamp(run.suspicion + n, 0, B.suspicion.max);
    if (!run.alarmed && run.suspicion >= 85) { run.alarmed = true; say('villain', pick(V.lines.suspicious), 2); SFX.alarm(); }
    if (run.suspicion < 70) run.alarmed = false;
    if (run.suspicion >= B.suspicion.max) beginFinale('busted');
  }

  // ---- the ending ----
  // kind: 'win' (in position on the last beat) | 'songOver' | 'busted'
  function beginFinale(kind) {
    if (!run || run.fin) return;
    for (const h of run.holds) if (!h.over) endHold(h, true);
    if (run.free) endFreestyle();
    grooveEl.classList.remove('ready');
    phase = 'finale';
    run.fin = { at: Math.ceil(beatNow()), kind };
    run.glance = null;
    const good = kind === 'win';
    who.className = `do-who ${good ? 'resp' : 'call'}`;
    who.textContent = kind === 'win' ? 'THE GRAB!' : kind === 'busted' ? 'BUSTED' : 'THE SONG IS OVER';
    shot = 'finale';
    clearLane();
  }
  // the crew comes down to the front of the floor and dances, each to a routine of their own
  function squadParty(f) {
    squad.forEach((m, i) => {
      if (!m.party) { m.party = true; m.bot.setMood('excited'); }
      m.bot.antic(SQUAD_DANCES[i][Math.floor(f / 4) % 3], 4 * MODEL_BEAT);
    });
  }
  function finaleBeat(bi) {
    const f = bi - run.fin.at, { kind } = run.fin;
    if (kind === 'win') {
      if (f === 0) { stage.grab(squad[0].bot); pop(bigEl, 'INVOICE GRABBED!', '#d9b3ff'); SFX.win(); squad.forEach((m) => { m.bot.setMood('excited'); }); }
      if (f === 1) say('villain', V.lines.loses, 2.4);
      if (f === 3) villain.antic('dizzy');
      if (f === 4) { burstCoins(stage.orbPosition(), 44); stage.hideOrb(); costbot.antic('pirouette', 4 * MODEL_BEAT); shot = 'party'; }
      if (f >= 5 && (f - 5) % 4 === 0) squadParty(f - 5);
      if (f === 8) { costbot.cheer(); say('costbot', 'Invoice liberated! 🎉', 3); }
      if (f === 12) costbot.antic('boogie', 4 * MODEL_BEAT);
      if (f === 17) endDance('clear');
    } else {
      if (f === 0) {
        say('villain', kind === 'busted' ? V.lines.busted : V.lines.songOver, 3);
        villain.antic('dab', 4 * MODEL_BEAT);
        SFX.lose();
        squad.forEach((m) => { m.bot.setMood('worried'); });
      }
      if (f === 1) costbot.antic('dizzy');
      if (f === 9) endDance('fail');
    }
  }
  function burstCoins(at, n) {
    for (let i = 0; i < n; i++) {
      const mesh = coinOf();
      mesh.position.copy(at);
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 5;
      const vel = new THREE.Vector3(Math.cos(a) * v * 0.8 - 2, 5 + Math.random() * 6, Math.sin(a) * v * 0.5 + 3);
      scene.add(mesh);
      coins.push({ mesh, vel, spin: (Math.random() - 0.5) * 20, life: 4 + Math.random() });
    }
  }

  // a ✋ left alone is as clean as a Perfect; held slides are a bonus, not a note
  const accuracy = (st, total) => (total ? (st.counts.perfect + st.counts.hands + st.counts.great * 0.8 + st.counts.good * 0.5) / total : 0);
  function endDance(outcome) {
    if (!run) return;
    const r = run;
    run = null;
    phase = 'over';
    hud.classList.remove('free');
    // grade every note of the rounds reached (a quit or a bust stops early)
    const played = r.notes.filter((n) => n.r <= r.round);
    const mine = (pl) => played.filter((n) => n.owner === pl);
    const p1 = r.p.p1;
    const acc1 = accuracy(p1, mine('p1').length);
    const tokens = Math.floor(p1.score * B.tokensPerScore) + (outcome === 'clear' ? B.heistBonus : 0);
    if (tokens > 0) wallet().earn(tokens, GAME_ID);
    const g = GRADES.find((x) => acc1 >= x.min) || GRADES[GRADES.length - 1];
    profile.best = Math.max(profile.best, Math.round(p1.score));
    profile.bestCombo = Math.max(profile.bestCombo, p1.best);
    profile.bestAcc = Math.max(profile.bestAcc, Math.round(acc1 * 100));
    profile.runs += 1;
    if (outcome === 'clear') profile.wins += 1;
    const sk = `${r.song}:${r.diff}`;
    const prev = profile.songs[sk] || { best: 0, wins: 0 };
    profile.songs[sk] = { best: Math.max(prev.best, Math.round(p1.score)), wins: prev.wins + (outcome === 'clear' ? 1 : 0) };
    // this difficulty's top ten (a quit is not a run worth ranking)
    let rank = -1;
    if (outcome !== 'quit' && p1.score > 0) {
      const entry = { song: r.song, score: Math.round(p1.score), grade: g.grade, acc: Math.round(Math.min(1, acc1) * 100), combo: p1.best, won: outcome === 'clear', at: new Date().toISOString().slice(0, 10) };
      const list = [...profile.top[r.diff], entry].sort((a, b) => b.score - a.score).slice(0, TOP_N);
      rank = list.indexOf(entry);
      profile.top[r.diff] = list;
    }
    save();
    const result = {
      game: GAME_ID, version: VERSION, outcome, stageId: `${r.song}:${r.diff}`, seed: 0, dollarsSaved: 0,
      tokensEarned: tokens, score: Math.round(p1.score), combo: p1.best, accuracy: Math.round(Math.min(1, acc1) * 100),
      kills: r.steps, level: Math.max(0, r.round + 1), grade: g.grade, heist: Math.floor(r.heist), suspicion: Math.round(r.suspicion),
      villain: V.id,
      quizCorrect: 0, quizWrong: 0, durationMs: Math.round(performance.now() - r.started), timeSurvived: Math.round((performance.now() - r.started) / 1000),
      profile: { ...profile },
    };
    const songName = (SONGS.find((x) => x.key === r.song) || {}).name || r.song;
    const D = DIFFS[r.diff];
    $('.do-otag').innerHTML = `<span class="do-dbadge" style="--c:${D.color}">${D.label.toUpperCase()}</span><span>${songName}</span>`;
    const ranked = rank === 0 ? ` 🏆 New best on ${D.label}!` : rank > 0 ? ` 🏅 #${rank + 1} on your ${D.label} list.` : '';
    const gradeEl = $('.do-grade');
    $('.do-otitle').textContent = outcome === 'clear' ? '💼 Invoice liberated!' : outcome === 'quit' ? 'Dance-off called off' : r.suspicion >= B.suspicion.max ? '🚨 Busted!' : '🎵 Out of song';
    $('.do-osub').textContent = outcome === 'clear' ? 'Last beat, last step — the squad walked out with the Infinity Invoice.'
      : outcome === 'quit' ? 'Tokens earned so far still count.'
        : r.suspicion >= B.suspicion.max ? `${V.name}'s suspicion maxed out — he caught the squad red-handed.` : `The song ended with the squad ${Math.floor(r.heist)}% of the way there. Shadow more of his moves.`;
    gradeEl.textContent = outcome === 'quit' ? '—' : g.grade;
    gradeEl.style.color = { S: '#ffe066', A: '#6ff5c1', B: '#8fc9ff', C: '#d9b3ff', D: '#ff8aa0' }[g.grade] || '#fff';
    $('.do-oline').textContent = outcome === 'quit' ? '' : `${g.line}${ranked}`;
    $('.do-stats').innerHTML = [
      ['SCORE', fmt(p1.score)], ['BEST COMBO', p1.best], ['ACCURACY', `${Math.round(Math.min(1, acc1) * 100)}%`], ['HEIST', `${Math.floor(r.heist)}%`],
      ['PERFECT', p1.counts.perfect], ['GREAT', p1.counts.great], ['MISS', p1.counts.miss], ['SLIDES HELD', p1.counts.held],
    ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
    $('.do-tokens').innerHTML = `+${fmt(tokens)} ${TOK} tokens`;
    $('.do-purse').textContent = `${fmt(wallet().tokens)} in your arcade purse`;
    hud.classList.add('off');
    floor.setVisible(false);
    stage.dimSign(false);
    $('.do-over').classList.add('on');
    shot = 'title';
    villain.root.rotation.set(0, VILLAIN_YAW, 0);
    playLobby();
    paintSetup();
    onEvent('run:end', result);
    onComplete(result);
  }

  // ---- title setup: song, difficulty, the wardrobe ----
  // the medley is rolled once now (so it has a track to list) and again at every start
  const medleyPool = () => SONGS.filter((x) => !x.medley && (profile.experimental || !x.experimental)).map((x) => x.key);
  function rollMedley() {
    if (!window.ArcadeMusic) return [];
    const { track, segs } = buildMedley(window.ArcadeMusic.TRACKS, medleyPool());
    window.ArcadeMusic.TRACKS[MEDLEY.key] = track;
    return segs;
  }
  rollMedley();
  const songSel = $('.do-song'), expBox = $('.do-expbox');
  const artFor = (key) => { const sg = SONGS.find((x) => x.key === key); return sg && sg.art ? `../shared/assets/${sg.art}` : null; };
  function fillSongs() {
    songSel.innerHTML = SONGS.filter((x) => window.ArcadeMusic && window.ArcadeMusic.TRACKS[x.key] && (profile.experimental || !x.experimental)).map((x) => {
      const T = window.ArcadeMusic.TRACKS[x.key];
      return `<option value="${x.key}">${x.experimental ? '🧪 ' : ''}${x.name} — ${T.bpm}bpm${T.bpm > 150 ? ' (half-time)' : ''}</option>`;
    }).join('');
  }
  expBox.checked = !!profile.experimental;
  fillSongs();
  expBox.addEventListener('change', () => { profile.experimental = expBox.checked; save(); fillSongs(); paintSetup(); });
  function paintSetup() {
    applyView();
    songSel.value = profile.song;
    if (songSel.value !== profile.song) profile.song = songSel.value || SONGS[0].key;
    if (phase !== 'play' && phase !== 'finale') stage.setArt(artFor(profile.song));
    applyOutfit();
    root.querySelectorAll('.do-diff').forEach((b) => { b.classList.toggle('on', b.dataset.diff === profile.diff); });
    const rec = profile.songs[`${profile.song}:${profile.diff}`];
    $('.do-songbest').textContent = `${V.icon} vs ${V.name}. ${rec ? `Your best here: ${fmt(rec.best)}${rec.wins ? ` · ${rec.wins} heist${rec.wins > 1 ? 's' : ''}` : ''}` : 'Not danced yet on this difficulty.'}`;
    $('.do-story').innerHTML = `<b>${V.name}</b> has the <b>Infinity Invoice</b> — the one bill that holds all the waste. CostBot can't out-fight him. So he's going to <i>out-dance</i> him.`;
    $('.do-keys').textContent = 'Arrow keys or WASD, Space to slide (hold it) — or tap the pads. Enter spends a full Groove. Esc ends the dance.';
    $('.do-bests').innerHTML = `🏅 Best —${DIFF_ORDER.map((d) => { const t = profile.top[d][0]; return ` <span style="--c:${DIFFS[d].color}">${DIFFS[d].label} <b>${t ? fmt(t.score) : '—'}</b></span>`; }).join(' ·')}`;
    $('.do-best').textContent = profile.runs ? `${profile.wins}/${profile.runs} heists pulled off · best combo ${profile.bestCombo}` : '';
  }
  songSel.addEventListener('change', () => { profile.song = songSel.value; save(); paintSetup(); });
  root.querySelectorAll('.do-diff').forEach((b) => { b.addEventListener('click', () => { profile.diff = b.dataset.diff; save(); paintSetup(); }); });

  // your top scores, a tab per difficulty
  let scoresTab = null;
  function paintScores(tab = scoresTab || profile.diff) {
    scoresTab = tab;
    root.querySelectorAll('.do-tab').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); });
    const list = profile.top[tab] || [];
    const songName = (k) => { const sg = SONGS.find((x) => x.key === k); return sg ? sg.name : k; };
    const gradeColor = { S: '#ffe066', A: '#6ff5c1', B: '#8fc9ff', C: '#d9b3ff', D: '#ff8aa0' };
    $('.do-toplist').innerHTML = !list.length ? `<p class="do-empty">No ${DIFFS[tab].label} runs yet — go dance one.</p>`
      : `<table class="do-table"><tr><th>#</th><th>Song</th><th class="n">Score</th><th>Grade</th><th class="n hideS">Acc</th><th class="n hideS">Combo</th><th>💼</th><th class="hideS">Date</th><th></th></tr>${list.map((e, i) => `
        <tr class="${i === 0 ? 'me1' : ''}"><td>${i + 1}</td><td>${songName(e.song)}</td><td class="n">${fmt(e.score)}</td>
        <td class="gr" style="color:${gradeColor[e.grade] || '#a99bd6'}">${e.grade || '—'}</td><td class="n hideS">${e.acc != null ? `${e.acc}%` : '—'}</td>
        <td class="n hideS">${e.combo != null ? e.combo : '—'}</td><td>${e.won ? '✓' : ''}</td><td class="hideS">${e.at || '—'}</td>
        <td>${SONGS.some((x) => x.key === e.song) ? `<button class="do-play" data-play="${e.song}" title="Play ${songName(e.song)} on ${DIFFS[tab].label}">▶ Play</button>` : ''}</td></tr>`).join('')}</table>`;
    $('.do-toplist').querySelectorAll('[data-play]').forEach((b) => { b.addEventListener('click', () => { playFromScores(b.dataset.play, tab); }); });
    const cur = SONGS.find((x) => x.key === profile.song);
    $('.do-scoreplay').textContent = `🕺 Dance ${cur ? cur.name : ''} on ${DIFFS[tab].label}`;
  }
  root.querySelectorAll('.do-tab').forEach((b) => { b.addEventListener('click', () => { paintScores(b.dataset.tab); }); });
  // straight from the list into a dance: that song, that tab's difficulty
  function playFromScores(song, diff) {
    const sg = SONGS.find((x) => x.key === song);
    if (!sg) return;
    if (sg.experimental && !profile.experimental) { profile.experimental = true; expBox.checked = true; fillSongs(); }
    profile.song = song; profile.diff = diff; save();
    paintSetup();
    start();
  }
  $('.do-scoreplay').addEventListener('click', () => { playFromScores(profile.song, scoresTab || profile.diff); });

  // the wardrobe: CostBot's outfits, bought with arcade tokens (secret ones are found, not bought)
  function paintShop() {
    $('.do-shoppurse').innerHTML = `${TOK} ${fmt(wallet().tokens)} tokens in your arcade purse`;
    $('.do-shopgrid').innerHTML = OUTFITS.map((o) => {
      const owned = profile.outfits.includes(o.id), on = profile.outfit === o.id;
      const price = o.unlock && o.unlock.tokens != null ? o.unlock.tokens : null;
      const btn = on ? '<button disabled>✓ Wearing</button>'
        : owned ? `<button data-wear="${o.id}">Wear</button>`
          : price != null ? `<button data-buy="${o.id}">${TOK} ${fmt(price)}</button>` : '<button disabled>🔒 Secret</button>';
      return `<div class="do-outfit${on ? ' on' : ''}${!owned && price == null ? ' locked' : ''}"><b>${o.label}</b>${btn}</div>`;
    }).join('');
    $('.do-shopgrid').querySelectorAll('[data-wear]').forEach((b) => { b.addEventListener('click', () => { profile.outfit = b.dataset.wear; save(); applyOutfit(); paintShop(); }); });
    $('.do-shopgrid').querySelectorAll('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        const o = OUTFITS.find((x) => x.id === b.dataset.buy);
        if (!wallet().spend(o.unlock.tokens)) { b.textContent = 'Not enough tokens'; return; }
        profile.outfits.push(o.id); profile.outfit = o.id; save(); applyOutfit(); costbot.cheer(); paintShop();
      });
    });
  }

  function showPanel(which) {
    ['.do-title', '.do-over', '.do-shop', '.do-scores'].forEach((s) => { $(s).classList.toggle('on', s === which); });
    if (which === '.do-shop') paintShop();
    if (which === '.do-scores') paintScores(profile.diff);
    if (which === '.do-title') paintSetup();
  }

  function flashPad(id) {
    const b = root.querySelector(`.do-pad[data-move="${id}"]`);
    if (!b) return;
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 110);
  }
  const typing = (e) => e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON');
  function onKey(e) {
    if (e.repeat) return;
    const k = keyOf(e);
    if (k === 'm') { setMuted(!muted); return; }
    if (k === 'Escape') { if (run) endDance('quit'); return; }
    if (phase === 'title' || phase === 'over') {
      if ((k === 'Enter' || k === ' ') && !typing(e) && !$('.do-shop').classList.contains('on') && !$('.do-scores').classList.contains('on')) { e.preventDefault(); start(); }
      return;
    }
    if (!run) return;
    if (k === GROOVE_KEY) { e.preventDefault(); freestyle(); return; }
    if (KEYS[k]) { e.preventDefault(); press(KEYS[k]); }
  }
  function onKeyUp(e) {
    if (!run) return;
    const k = keyOf(e);
    const id = KEYS[k];
    if (id) release(id);
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  root.querySelectorAll('.do-pad').forEach((b) => {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(b.dataset.move); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { release(b.dataset.move); });
  });
  $('.do-groovebtn').addEventListener('click', () => { freestyle(); });
  root.querySelectorAll('[data-act="start"]').forEach((b) => { b.addEventListener('click', () => { start(); }); });
  root.querySelectorAll('[data-act="again"]').forEach((b) => { b.addEventListener('click', () => { start(); }); });
  root.querySelectorAll('[data-act="menu"]').forEach((b) => { b.addEventListener('click', () => { showPanel('.do-title'); }); });
  root.querySelectorAll('[data-act="shop"]').forEach((b) => { b.addEventListener('click', () => { showPanel('.do-shop'); }); });
  $('.do-view').addEventListener('click', () => { profile.noteView = floorMode() ? 'lane' : 'floor'; save(); applyView(); });
  root.querySelectorAll('[data-act="scores"]').forEach((b) => { b.addEventListener('click', () => { showPanel('.do-scores'); }); });
  root.querySelectorAll('[data-act="board"]').forEach((b) => { b.addEventListener('click', () => { location.href = `../leaderboard/index.html#${GAME_ID}`; }); });
  muteBtn.addEventListener('click', () => { audioInit(); setMuted(!muted); });
  root.addEventListener('pointerdown', () => audioInit(), { once: true });
  const onVis = () => { if (document.hidden && run) endDance('quit'); };
  document.addEventListener('visibilitychange', onVis);
  paintSetup();

  // ---- frame ----
  let raf = 0, last = performance.now() / 1000, t = 0, lastBeat = null, wobble = 0, villainWobble = 0;
  const squadT = squad.map(() => 0);
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now() / 1000, dt = Math.min(0.05, now - last);
    last = now; t += dt;
    const b = beatNow();
    const bi = Math.floor(b);
    if (lastBeat === null) lastBeat = bi;
    // every whole beat since the last frame, in order — a slow frame must not skip one
    while (lastBeat < bi) { lastBeat += 1; onBeat(lastBeat); }

    if (run && phase === 'play') {
      // anything that sailed past its window
      for (const n of run.notes) {
        if (n.judged || (b - n.beat) * BEAT <= run.win[2]) continue;
        if (n.kind === 'move') missNote(n, false);
        else if (n.frozen) {
          // held still while he looked: that was the right call
          n.judged = 'held';
          award('p1', 'good', B.points.good, 'hands');
          markNote(n, 'held', 'HELD');
        } else { n.judged = 'miss'; breakCombo('p1'); markNote(n, 'miss', 'MISS'); suspect(run.missCost * B.suspicion.skip); }
        if (!run || phase !== 'play') break;
      }
    }
    if (run && phase === 'play') {
      // the villain dances his own verse (a note can sit on an 8th, so this is per frame)
      for (const c of run.calls) if (!c.done && b >= c.beat) { c.done = true; dance(villain, c.move, c.len); }
      holdFrame(b);
      if (run.free && b >= run.free.until) endFreestyle();
      const rel = b - run.intro, inR = ((rel % ROUND_BEATS) + ROUND_BEATS) % ROUND_BEATS;
      if (run.glance) {
        const gp = (b - run.glance.start) / B.glanceBeats;
        if (run && run.glance && gp >= 1) {
          run.glance = null;
          squad.forEach((m) => { m.bot.setMood('happy'); });
          shot = inR >= HALF - 1 ? 'costbot' : 'villain';
        }
      }
      if (run && phase === 'play' && run.medley) {
        // the medley: each song brings its own artwork, and a now-playing tag
        for (const g of run.medley) {
          if (g.shown || b < g.beat - 0.5) continue;
          g.shown = true;
          stage.setArt(artFor(g.key));
          const sg = SONGS.find((x) => x.key === g.key);
          nowEl.textContent = `🎵 ${sg ? sg.name : g.key}`;
          nowEl.classList.remove('on'); void nowEl.offsetWidth; nowEl.classList.add('on');
        }
      }
      if (run && phase === 'play') {
        laneFrame(b, dt); updateMeters();
        // the song clock: from the first beat of the intro to the last beat of the last verse
        const total = (run.intro + run.nRounds * ROUND_BEATS) * BEAT, el = clamp(b * BEAT, 0, total);
        timeEl.textContent = clock(el); timeRem.textContent = `-${clock(total - el)}`; timeBar.style.width = `${(el / total) * 100}%`;
      }
    }

    // the villain turns his back to look at the squad during a glance, and at the end of a won heist
    const glancing = run && run.glance && phase === 'play';
    const lookBack = glancing || (run && run.fin && run.fin.kind === 'win' && beatNow() >= run.fin.at + 1);
    villain.root.rotation.y += ((lookBack ? VILLAIN_BACK : VILLAIN_YAW) - villain.root.rotation.y) * (1 - Math.exp(-dt * 10));
    const rate = MODEL_BEAT / BEAT;
    costbot.update(t, dt * rate, { lookX: 0.2 });
    villain.update(t, dt * rate, { lookX: -0.2, keepMood: true });
    standOnFloor(costbot);
    standOnFloor(villain);
    if (villainWobble > 0) { villainWobble = Math.max(0, villainWobble - dt); villain.root.rotation.z = Math.sin(t * 30) * 0.2 * villainWobble; } else villain.root.rotation.z = 0;
    if (wobble > 0) { wobble = Math.max(0, wobble - dt); costbot.root.rotation.z = Math.sin(t * 40) * 0.18 * (wobble / 0.5); } else costbot.root.rotation.z = 0;
    for (const [bot, k] of punch) {
      const base = bot === costbot ? 1 : 1.3, q = Math.sin(k * Math.PI);
      bot.root.scale.set(base * (1 - 0.07 * q), base * (1 + 0.12 * q), base * (1 - 0.07 * q));
      const nk = k - dt * 5;
      if (nk <= 0) { bot.root.scale.setScalar(base); punch.delete(bot); } else punch.set(bot, nk);
    }

    // the squad: frozen mid-step while he looks, otherwise tiptoeing toward the heist target;
    // after a win they come down to the front of the floor and dance
    squad.forEach((m, i) => {
      const p = m.bot.root.position;
      if (m.party) {
        const [tx, tz] = SQUAD_STAGE[i];
        const k = 1 - Math.exp(-dt * 3);
        p.x += (tx - p.x) * k; p.z += (tz - p.z) * k;
        m.bot.root.rotation.y += (0.1 - m.bot.root.rotation.y) * k;
        m.bot.root.scale.setScalar(m.bot.root.scale.x + (0.6 - m.bot.root.scale.x) * k);
        squadT[i] += dt;
        m.bot.update(squadT[i], dt * rate, {});
        standOnFloor(m.bot);
        return;
      }
      const target = run ? clamp(run.heist / 100 - i * 0.04, 0, 1) : m.s;
      const frozen = !!glancing;
      const prev = m.s;
      if (!frozen) m.s += clamp(target - m.s, -dt * 0.5, dt * 0.25);
      const moving = Math.abs(m.s - prev) > 1e-5;
      if (!frozen) squadT[i] += dt;
      const from = SPOTS.squadFrom, to = SPOTS.squadTo;
      p.x = THREE.MathUtils.lerp(from.x - i * 1.3, to.x - i * 1.3, m.s);
      p.z = from.z + i * 0.35;
      m.bot.root.rotation.y = m.s < prev ? -Math.PI / 2 : Math.PI / 2;
      // a sneak step is a little hop, so every tap visibly moves them
      m.hop = Math.max(0, (m.hop || 0) - dt);
      const hopY = m.hop > 0 ? Math.sin((1 - m.hop / 0.22) * Math.PI) * 0.45 : 0;
      m.bot.update(squadT[i], frozen ? 0 : dt, { run: moving && !frozen, leanX: moving ? 0.25 : 0, still: frozen, baseY: hopY });
      standOnFloor(m.bot);
    });

    // coins from the shattered invoice
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.vel.y -= 16 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.y < 0.15) { c.mesh.position.y = 0.15; c.vel.y *= -0.45; c.vel.x *= 0.7; c.vel.z *= 0.7; }
      c.mesh.rotation.y += c.spin * dt;
      c.life -= dt;
      if (c.life <= 0) { scene.remove(c.mesh); coins.splice(i, 1); }
    }

    stage.update(t, dt);

    // camera: ease toward the current shot, with a slow drift so it never sits dead still
    const [sp, sl] = SHOTS[shot];
    const tall = camera.aspect < 1;       // portrait: back off and centre up so both dancers fit
    // freestyle swings on an arc in front of the dancers (never behind them)
    if (shot === 'freestyle') tmpV.set(Math.sin(t * 0.8) * 9, 5.5 + Math.sin(t * 1.3) * 0.8, 14 + Math.cos(t * 1.6) * 2.5);
    else tmpV.set(sp[0] * (tall ? 0.25 : 1) + Math.sin(t * 0.3) * 0.5, sp[1] * (tall ? 1.25 : 1) + Math.sin(t * 0.45) * 0.15, sp[2] * (tall ? 1.75 : 1));
    if (tall && shot === 'freestyle') tmpV.multiplyScalar(1.5);
    // portrait: look higher so the floor comes down to meet the note band at the bottom
    tmpL.set(sl[0] * (tall ? 0.2 : 1), sl[1] + (tall && shot !== 'title' ? 2.2 : 0), sl[2]);
    // floor mode: stay near the middle of the floor and a little back, so the whole row is always in shot
    if (floorMode() && run && shot !== 'title' && shot !== 'freestyle') { tmpV.x *= 0.3; tmpL.x *= 0.3; tmpV.y += 0.8; tmpV.z += 1.5; }
    const k = 1 - Math.exp(-dt * (shot === 'glance' ? 4 : 2.2));
    camPos.lerp(tmpV, k); camLook.lerp(tmpL, k);
    camera.position.copy(camPos); camera.lookAt(camLook);

    // captions fade out when their line has had its time
    for (const id of ['villain', 'costbot']) {
      if (sayT[id] > 0) { sayT[id] -= dt; if (sayT[id] <= 0) sayEl[id].classList.remove('on'); }
    }
    composer.render();
  }
  frame();
  onEvent('ready', { game: GAME_ID });

  return {
    get profile() { return profile; },
    get phase() { return phase; },
    get run() { return run; },
    start,
    hit: press,
    release,
    freestyle,
    beat: beatNow,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVis);
      if (music) music.stop();
      if (actx) actx.close();
      renderer.dispose();
      root.remove();
    },
  };
}
