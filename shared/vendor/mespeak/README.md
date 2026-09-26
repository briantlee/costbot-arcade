# meSpeak.js 1.9.6 (eSpeak, vendored)

CostBot's voice in Cloud Patrol. eSpeak compiled to JavaScript (via Emscripten), wrapped
for the browser: the npm build is CommonJS, so `mespeak.js` here is `src/ESpeak.js` +
`src/index.js` wrapped in a tiny module shim and minified with terser. It defines
`window.meSpeak`.

Only US English ships (`voices/en-us.json`). Speech is rendered with `rawdata` and played
through the game's own WebAudio graph, which is what lets the cabinet pitch it and
robot-ify it — browser speechSynthesis can't be processed.

**License: GPL-3.0** (eSpeak and meSpeak) — see `LICENSE`. This is the one non-MIT
dependency in the arcade; keep it isolated here.
