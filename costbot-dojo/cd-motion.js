/* ============================================================================
 * CostBot: Dojo — LANE MOTION (webcam)
 * ----------------------------------------------------------------------------
 * The one part of this cabinet with no counterpart anywhere else in the arcade,
 * which is exactly why it is its own file: the engine should not have to carry
 * a camera pipeline it can run perfectly well without.
 *
 * The stage is split into vertical lanes. Each frame the camera image is
 * downscaled, mirrored and compared against the previous frame; the fraction of
 * pixels that changed inside a lane is that lane's motion level. A chop is a
 * lane crossing the sensitivity threshold, rate-limited so one swing registers
 * once rather than on every frame it is still moving.
 *
 * Denial is a supported state, not an error. `blocked` is where a machine with
 * no camera, a refused prompt or an insecure origin all end up, and the game
 * reads it and quietly switches to keys — so this module never has to throw and
 * the caller never has to catch.
 *
 * SECURITY-REVIEW: requests camera access via getUserMedia. Frames are held in
 * memory only for the frame-to-frame diff and are never recorded, persisted or
 * transmitted; only the resulting per-lane motion numbers leave this module.
 *
 *   const m = CDMotion.create({ lanes: 3 });
 *   await m.start();                  // -> true if the camera came up
 *   m.sample();                       // once per animation frame
 *   m.chops(threshold, dtMs);         // -> [laneIndex, ...] struck this frame
 *   m.isLive(); m.state; m.lanes;     // 'idle'|'requesting'|'ready'|'blocked'
 *   m.stop();
 * ==========================================================================*/
((global) => {
  'use strict';

  const PROC_W = 192;         // the diff runs on a thumbnail; full res buys nothing
  const PROC_H = 108;
  const PIXEL_DELTA = 18;     // per-pixel grey change that counts as movement
  const CHOP_COOLDOWN = 260;  // ms a lane is deaf after registering a chop
  const REARM = 0.6;          // motion must fall below threshold*REARM to fire again
                              // (a rising edge) so sustained motion fires once, not
                              // on a loop — someone shifting in frame isn't a chop
  const NOISE_MAX = 0.05;     // cap on the learned noise floor, so a stray movement
                              // during calibration can't deafen the mat entirely

  function create(options) {
    const opts = options || {};
    const laneCount = opts.lanes || 3;

    const proc = document.createElement('canvas');
    proc.width = PROC_W;
    proc.height = PROC_H;
    const pctx = proc.getContext('2d', { willReadFrequently: true });

    const lanes = new Array(laneCount).fill(0);
    const cooldown = new Array(laneCount).fill(0);
    const armed = new Array(laneCount).fill(true);   // rising-edge gate per lane
    const baseL = new Array(laneCount).fill(0);      // learned resting noise per lane
    const rawL = new Array(laneCount).fill(0);       // this frame's level before subtraction

    let video = null;
    let stream = null;
    let prevGrey = null;
    let state = 'idle';

    async function start() {
      if (state === 'ready') return true;
      state = 'requesting';
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        state = 'ready';
        return true;
      } catch {
        state = 'blocked';        // denied, absent, or a non-secure origin
        video = null;
        stream = null;
        return false;
      }
    }

    function stop() {
      if (stream) stream.getTracks().forEach((t) => { t.stop(); });
      stream = null;
      video = null;
      prevGrey = null;
      lanes.fill(0);
      armed.fill(true);
      baseL.fill(0);
      // 'blocked' is sticky: a refused prompt stays refused until the page
      // reloads, and pretending otherwise just re-prompts a player who said no.
      state = state === 'ready' ? 'idle' : state;
    }

    function isLive() {
      return state === 'ready' && video && video.readyState >= 2;
    }

    function sample() {
      if (!isLive()) return;

      pctx.save();
      pctx.scale(-1, 1);                    // mirror, so the mat matches the room
      pctx.drawImage(video, -PROC_W, 0, PROC_W, PROC_H);
      pctx.restore();

      const frame = pctx.getImageData(0, 0, PROC_W, PROC_H).data;
      const grey = new Float32Array(PROC_W * PROC_H);
      const laneW = PROC_W / laneCount;
      const changed = new Array(laneCount).fill(0);
      const total = new Array(laneCount).fill(0);

      for (let i = 0; i < grey.length; i += 1) {
        const p = i * 4;
        grey[i] = frame[p] * 0.3 + frame[p + 1] * 0.59 + frame[p + 2] * 0.11;
        let lane = Math.floor((i % PROC_W) / laneW);
        if (lane >= laneCount) lane = laneCount - 1;
        total[lane] += 1;
        if (prevGrey && Math.abs(grey[i] - prevGrey[i]) > PIXEL_DELTA) changed[lane] += 1;
      }

      if (prevGrey) {
        // rawL is the frame's motion; lanes is what's left after the learned room
        // noise floor is subtracted, so a still room reads ~0.
        for (let l = 0; l < laneCount; l += 1) {
          rawL[l] = changed[l] / Math.max(1, total[l]);
          lanes[l] = Math.max(0, rawL[l] - baseL[l]);
        }
      }
      prevGrey = grey;
    }

    // Learn the room's resting motion. Call this each frame during the 3-2-1
    // countdown, when nobody is chopping yet: it samples and eases the noise floor
    // toward the current still-room level, so sensor noise in a dim or busy room
    // doesn't sit near the trigger. Subtracted back out in sample().
    function resetCalibration() { baseL.fill(0); }
    function calibrate() {
      sample();
      if (!isLive()) return;
      for (let l = 0; l < laneCount; l += 1) baseL[l] = Math.min(NOISE_MAX, baseL[l] * 0.85 + rawL[l] * 0.15);
    }

    function chops(threshold, dt) {
      const hits = [];
      for (let l = 0; l < laneCount; l += 1) {
        cooldown[l] -= dt;
        if (lanes[l] < threshold * REARM) armed[l] = true;   // lane went quiet: re-arm
        if (armed[l] && lanes[l] > threshold && cooldown[l] <= 0) {
          armed[l] = false;                                  // one chop per rising edge
          cooldown[l] = CHOP_COOLDOWN;
          hits.push(l);
        }
      }
      return hits;
    }

    return {
      start, stop, sample, calibrate, resetCalibration, chops, isLive, lanes,
      get state() { return state; },
      get video() { return video; },
      get laneCount() { return laneCount; },
    };
  }

  global.CDMotion = { create };
})(typeof window !== 'undefined' ? window : globalThis);
