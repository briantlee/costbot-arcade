/* ============================================================================
 * CostBot Arcade — SHARED BIOMES
 * ----------------------------------------------------------------------------
 * Arena palettes and procedural scenery, shared by every game in the arcade.
 * A theme in arcade-music.js names one of these, so picking a soundtrack also
 * picks the ground you fight on.
 *
 *   <script src="../shared/arcade-biomes.js"></script>
 *   const bio   = ArcadeBiomes.get('field');
 *   const props = ArcadeBiomes.generate(rng, worldW, worldH, bio);
 *   ArcadeBiomes.drawProp(ctx, prop, bio, elapsedSeconds);
 *
 * Adding a biome costs one palette entry plus one case in drawProp — all the
 * scenery is drawn procedurally, so no art is required.
 * ==========================================================================*/
((global) => {
  'use strict';
  const TAU = Math.PI * 2;

  const BIOMES = {
    datacenter: {
      id: 'datacenter', name: 'Datacenter',
      floor: '#101725', grid: '#1b2942', fog: 'rgba(12,18,30,0.62)',
      sky: ['#18243c', '#0b1020'], props: 'racks', propAlpha: 0.55, density: 78,
    },
    field: {
      id: 'field', name: 'Rolling Fields',
      floor: '#1b3a20', grid: '#27512e', fog: 'rgba(10,26,14,0.55)',
      sky: ['#2c5a34', '#12291a'], props: 'field', propAlpha: 0.9, density: 110,
    },
    // Cool steel, not rust: the browns read as dirt, so the metal now comes from
    // a blue-grey base and orange survives only where something is actually hot.
    foundry: {
      id: 'foundry', name: 'Scrap Foundry',
      floor: '#181c21', grid: '#39434f', fog: 'rgba(15,18,23,0.62)',
      sky: ['#414a55', '#0d0f13'], props: 'foundry', propAlpha: 0.9, density: 92,
    },
    arena: {
      id: 'arena', name: 'Sunset Arena',
      floor: '#2b1c12', grid: '#4a3120', fog: 'rgba(32,16,8,0.55)',
      sky: ['#7a3a1c', '#20100a'], props: 'arena', propAlpha: 0.85, density: 88,
    },
    dusk: {
      id: 'dusk', name: 'Ashen Dusk',
      floor: '#14121f', grid: '#241f38', fog: 'rgba(14,10,24,0.62)',
      sky: ['#2a2340', '#0c0a16'], props: 'dusk', propAlpha: 0.8, density: 96,
    },
  };

  function get(name) { return BIOMES[name] || BIOMES.datacenter; }

  // rnd() must return 0..1 — pass a seeded generator for reproducible arenas.
  function generate(rnd, worldW, worldH, biome) {
    const out = [];
    const n = (biome && biome.density) || 78;
    for (let i = 0; i < n; i++) {
      out.push({
        x: 60 + rnd() * (worldW - 120),
        y: 60 + rnd() * (worldH - 120),
        w: 34 + rnd() * 26,
        h: 54 + rnd() * 40,
        leds: 3 + ((rnd() * 4) | 0),
        hue: rnd(),
        kind: rnd(),
      });
    }
    return out;
  }

  function drawProp(ctx, pr, B, t) {
    const shadow = (rx, ry, dy) => {
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.beginPath(); ctx.ellipse(pr.x, pr.y + dy, rx, ry, 0, 0, TAU); ctx.fill();
    };

    switch (B.props) {
      case 'field': {
        if (pr.kind < 0.42) {                       // tree
          const r0 = pr.w * 0.62;
          shadow(r0 * 0.9, r0 * 0.32, pr.h * 0.42);
          ctx.fillStyle = '#4a3320';
          ctx.fillRect(pr.x - pr.w * 0.09, pr.y - pr.h * 0.05, pr.w * 0.18, pr.h * 0.45);
          const sway = Math.sin(t * 0.9 + pr.hue * 6) * 2.2;
          [[-r0 * 0.52, -r0 * 0.1, r0 * 0.62], [r0 * 0.5, -r0 * 0.16, r0 * 0.58],
           [0, -r0 * 0.72, r0 * 0.72]].forEach(([ox, oy, rr], i) => {
            ctx.fillStyle = i === 2 ? '#3f8a45' : '#316b37';
            ctx.beginPath();
            ctx.arc(pr.x + ox + sway, pr.y + oy - pr.h * 0.08, rr, 0, TAU);
            ctx.fill();
          });
        } else if (pr.kind < 0.72) {                // bush
          shadow(pr.w * 0.42, pr.w * 0.16, pr.w * 0.3);
          [[-pr.w * 0.22, 0, pr.w * 0.3], [pr.w * 0.2, -pr.w * 0.04, pr.w * 0.27],
           [0, -pr.w * 0.2, pr.w * 0.3]].forEach(([ox, oy, rr]) => {
            ctx.fillStyle = '#2c6132';
            ctx.beginPath(); ctx.arc(pr.x + ox, pr.y + oy, rr, 0, TAU); ctx.fill();
          });
        } else if (pr.kind < 0.88) {                // flower cluster
          const cols = ['#e8d24a', '#d96ba0', '#e9f0f5'];
          for (let i = 0; i < 5; i++) {
            const a = pr.hue * 9 + i * 1.7;
            ctx.fillStyle = cols[(i + ((pr.hue * 10) | 0)) % cols.length];
            ctx.beginPath();
            ctx.arc(pr.x + Math.cos(a) * pr.w * 0.4, pr.y + Math.sin(a) * pr.w * 0.28, 2.6, 0, TAU);
            ctx.fill();
          }
        } else {                                     // rock
          shadow(pr.w * 0.34, pr.w * 0.14, pr.w * 0.22);
          ctx.fillStyle = '#5c6470';
          ctx.beginPath(); ctx.ellipse(pr.x, pr.y, pr.w * 0.32, pr.w * 0.24, 0, 0, TAU); ctx.fill();
        }
        return;
      }

      case 'foundry': {
        shadow(pr.w * 0.55, pr.w * 0.2, pr.h / 2 + 3);
        if (pr.kind < 0.45) {                        // steel drum
          // a hard specular band down one side is what sells "cylinder of metal"
          const bg = ctx.createLinearGradient(pr.x - pr.w / 2, 0, pr.x + pr.w / 2, 0);
          bg.addColorStop(0, '#20262e'); bg.addColorStop(0.28, '#5d6875');
          bg.addColorStop(0.42, '#93a0ae'); bg.addColorStop(0.62, '#4d5661');
          bg.addColorStop(1, '#1b2028');
          ctx.fillStyle = bg;
          ctx.beginPath(); ctx.roundRect(pr.x - pr.w / 2, pr.y - pr.h / 2, pr.w, pr.h, 6); ctx.fill();
          ctx.strokeStyle = '#0f1319'; ctx.lineWidth = 2; ctx.stroke();
          // rolled hoops top and bottom
          ctx.fillStyle = 'rgba(190,203,216,0.30)';
          ctx.fillRect(pr.x - pr.w / 2, pr.y - pr.h * 0.34, pr.w, 2.5);
          ctx.fillRect(pr.x - pr.w / 2, pr.y + pr.h * 0.28, pr.w, 2.5);
          // the one warm note: something molten still in the drum
          ctx.fillStyle = '#d2621f';
          ctx.fillRect(pr.x - pr.w / 2, pr.y - pr.h * 0.14, pr.w, pr.h * 0.1);
        } else if (pr.kind < 0.8) {                  // pipe run
          const pg = ctx.createLinearGradient(0, pr.y - pr.h * 0.22, 0, pr.y + pr.h * 0.22);
          pg.addColorStop(0, '#2b323b'); pg.addColorStop(0.26, '#8894a2');
          pg.addColorStop(0.5, '#5a6470'); pg.addColorStop(1, '#191e25');
          ctx.fillStyle = pg;
          ctx.beginPath(); ctx.roundRect(pr.x - pr.w * 0.7, pr.y - pr.h * 0.22, pr.w * 1.4, pr.h * 0.44, 8); ctx.fill();
          ctx.strokeStyle = '#10151b'; ctx.lineWidth = 2; ctx.stroke();
          for (let i = 0; i < 4; i++) {              // bolted flanges
            const bx = pr.x - pr.w * 0.5 + i * pr.w * 0.34;
            ctx.fillStyle = '#9aa7b5';
            ctx.beginPath(); ctx.arc(bx, pr.y, 2.9, 0, TAU); ctx.fill();
            ctx.fillStyle = '#2c333c';
            ctx.beginPath(); ctx.arc(bx, pr.y, 1.3, 0, TAU); ctx.fill();
          }
        } else {                                      // molten vent
          const pulse = 0.55 + 0.45 * Math.sin(t * 2.4 + pr.hue * 7);
          const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, pr.w * 0.9);
          g.addColorStop(0, `rgba(255,140,40,${0.5 * pulse})`);
          g.addColorStop(1, 'rgba(255,90,20,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.w * 0.9, 0, TAU); ctx.fill();
        }
        return;
      }

      case 'arena': {
        shadow(pr.w * 0.5, pr.w * 0.18, pr.h / 2 + 3);
        if (pr.kind < 0.5) {                          // crate
          const sz = pr.w * 0.9;
          ctx.fillStyle = '#4a3117';
          ctx.beginPath(); ctx.roundRect(pr.x - sz / 2, pr.y - sz / 2, sz, sz, 4); ctx.fill();
          ctx.strokeStyle = '#7d5426'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(pr.x - sz / 2, pr.y - sz / 2); ctx.lineTo(pr.x + sz / 2, pr.y + sz / 2);
          ctx.moveTo(pr.x + sz / 2, pr.y - sz / 2); ctx.lineTo(pr.x - sz / 2, pr.y + sz / 2);
          ctx.stroke();
        } else if (pr.kind < 0.82) {                  // banner
          ctx.fillStyle = '#6a2018';
          ctx.fillRect(pr.x - pr.w * 0.22, pr.y - pr.h * 0.6, pr.w * 0.44, pr.h * 1.1);
          ctx.fillStyle = '#d8b24a';
          ctx.fillRect(pr.x - pr.w * 0.22, pr.y - pr.h * 0.2, pr.w * 0.44, pr.h * 0.14);
          ctx.strokeStyle = '#3a1a10'; ctx.lineWidth = 2;
          ctx.strokeRect(pr.x - pr.w * 0.22, pr.y - pr.h * 0.6, pr.w * 0.44, pr.h * 1.1);
        } else {                                       // floodlight pool
          const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, pr.w * 1.3);
          g.addColorStop(0, 'rgba(255,196,120,0.22)');
          g.addColorStop(1, 'rgba(255,170,90,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.w * 1.3, 0, TAU); ctx.fill();
        }
        return;
      }

      case 'dusk': {
        if (pr.kind < 0.5) {                           // bare tree
          shadow(pr.w * 0.4, pr.w * 0.14, pr.h * 0.42);
          ctx.strokeStyle = '#3b3450'; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pr.x, pr.y + pr.h * 0.4); ctx.lineTo(pr.x, pr.y - pr.h * 0.3);
          const sway = Math.sin(t * 0.6 + pr.hue * 5) * 2;
          [[-1, 0.55], [1, 0.4], [-1, 0.15], [1, 0.0]].forEach(([dir, up], i) => {
            ctx.moveTo(pr.x, pr.y - pr.h * (0.05 + up * 0.4));
            ctx.lineTo(pr.x + dir * pr.w * (0.34 + i * 0.05) + sway,
                       pr.y - pr.h * (0.22 + up * 0.42));
          });
          ctx.stroke(); ctx.lineCap = 'butt';
        } else if (pr.kind < 0.82) {                   // monolith
          shadow(pr.w * 0.4, pr.w * 0.15, pr.h / 2 + 2);
          ctx.fillStyle = '#252038';
          ctx.beginPath(); ctx.roundRect(pr.x - pr.w * 0.26, pr.y - pr.h * 0.5, pr.w * 0.52, pr.h, 4); ctx.fill();
          ctx.strokeStyle = '#3d3558'; ctx.lineWidth = 2; ctx.stroke();
        } else {                                        // lantern
          const flick = 0.6 + 0.4 * Math.sin(t * 5.5 + pr.hue * 11);
          const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, pr.w * 1.1);
          g.addColorStop(0, `rgba(255,196,110,${0.42 * flick})`);
          g.addColorStop(1, 'rgba(255,170,80,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.w * 1.1, 0, TAU); ctx.fill();
          ctx.fillStyle = `rgba(255,214,140,${0.8 * flick})`;
          ctx.beginPath(); ctx.arc(pr.x, pr.y, 3.4, 0, TAU); ctx.fill();
        }
        return;
      }

      default: {                                        // server racks
        shadow(pr.w * 0.55, pr.w * 0.2, pr.h / 2 + 3);
        ctx.fillStyle = '#0d1522';
        ctx.beginPath(); ctx.roundRect(pr.x - pr.w / 2, pr.y - pr.h / 2, pr.w, pr.h, 5); ctx.fill();
        ctx.strokeStyle = B.grid || '#1b2942'; ctx.lineWidth = 1.5; ctx.stroke();
        for (let l = 0; l < pr.leds; l++) {
          const on = Math.sin(t * (1.4 + pr.hue * 2.6) + l * 1.9) > -0.2;
          ctx.fillStyle = on ? (l % 2 ? '#2e8f6a' : '#2a6fa8') : '#1a2434';
          ctx.fillRect(pr.x - pr.w / 2 + 6, pr.y - pr.h / 2 + 8 + l * 9, pr.w - 12, 3);
        }
      }
    }
  }

  global.ArcadeBiomes = { BIOMES, get, generate, drawProp };
})(typeof window !== 'undefined' ? window : globalThis);
