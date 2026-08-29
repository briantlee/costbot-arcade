/* ============================================================================
 * CostBot Mudslides — CONTENT / BALANCE
 * ----------------------------------------------------------------------------
 * CostBot slides down a muddy hill collecting the AI tokens the arcade runs on.
 * Three lanes, jump, slide. Endless, escalating.
 *
 * Every tunable lives here; ms-game.js hardcodes no balance.
 * ==========================================================================*/
((global) => {
  'use strict';

  // ---------------------------------------------------------------------------
  // WORLD / FEEL
  //   z is distance down the hill in world units. Speed is z-units per second.
  // ---------------------------------------------------------------------------
  const WORLD = {
    lanes: [-1, 0, 1],
    laneWidth: 320,          // world units between lane centres
    drawDistance: 5200,      // how far ahead we render
    startSpeed: 900,
    maxSpeed: 3000,
    accel: 13,               // speed gained per second survived
    laneShiftTime: 0.14,     // seconds to slide between lanes
    jump: { impulse: 1180, gravity: 3000, maxHold: 0.16 },
    slideTime: 0.55,
    // A crash costs you the run unless a shield absorbs it.
    crashGrace: 0.9,         // seconds of invulnerability after a shield saves you
    startShields: 0,
    maxShields: 3,           // Mudslides you are holding stack this high
  };

  // ---------------------------------------------------------------------------
  // TOKENS — the score, and the whole reason CostBot is on the hill
  //
  // r.tokens is live-accrued (HUD shows it mid-run) AND is the exact wallet
  // credit at crash — there is no separate end-of-run conversion, unlike Waste
  // Hunter's dollars-to-tokens divisor. So the per-item values here ARE the
  // conversion rate. Modeled against the real spawn/speed constants below (row
  // cadence from DIFFICULTY.reactionAt, token odds from tokenChance/trailChance,
  // distance payout from SCORING.distanceTokensPer): a competent-not-perfect
  // run was clearing ~600-900 tokens/min and climbing as speed ramped toward
  // maxSpeed — 6-9x the ~100/min every other cabinet targets. These values (and
  // distanceTokensPer below) are divided by 6, landing a ~60-90s run near
  // 90-110/min.
  const TOKENS = {
    input: { name: 'Input token', value: 0.17, color: '#7fd6c4', glow: '#3fa891', r: 15 },
    output: { name: 'Output token', value: 0.83, color: '#ffd76b', glow: '#f0a52c', r: 19 },
    cached: { name: 'Cached token', value: 0.33, color: '#a06bff', glow: '#7b3fe0', r: 15,
      // cached tokens arrive in trails; clearing a whole trail pays the streak
      streakBonus: 2 },
  };

  // ---------------------------------------------------------------------------
  // VENDORS — the names on the signs.
  //
  // These are the lines on the megabill: the things that actually take the money
  // while CostBot is trying to collect tokens. `path` is a 24x24 icon outline
  // drawn straight onto the canvas with Path2D, so the signs need no image
  // assets and stay crisp at any distance. A vendor with no path gets a
  // wordmark sign instead, which reads just as well at speed.
  // ---------------------------------------------------------------------------
  const VENDORS = [
    { id: 'datadog', name: 'Datadog', color: '#632CA6',
      path: 'M19.57 17.04l-1.997-1.316-1.665 2.782-1.937-.567-1.706 2.604.087.82 9.274-1.71-.538-5.794zm-8.649-2.498l1.488-.204c.241.108.409.15.697.223.45.117.97.23 1.741-.16.18-.088.553-.43.704-.625l6.096-1.106.622 7.527-10.444 1.882zm11.325-2.712l-.602.115L20.488 0 .789 2.285l2.427 19.693 2.306-.334c-.184-.263-.471-.581-.96-.989-.68-.564-.44-1.522-.039-2.127.53-1.022 3.26-2.322 3.106-3.956-.056-.594-.15-1.368-.702-1.898-.02.22.017.432.017.432s-.227-.289-.34-.683c-.112-.15-.2-.199-.319-.4-.085.233-.073.503-.073.503s-.186-.437-.216-.807c-.11.166-.137.48-.137.48s-.241-.69-.186-1.062c-.11-.323-.436-.965-.343-2.424.6.421 1.924.321 2.44-.439.171-.251.288-.939-.086-2.293-.24-.868-.835-2.16-1.066-2.651l-.028.02c.122.395.374 1.223.47 1.625.293 1.218.372 1.642.234 2.204-.116.488-.397.808-1.107 1.165-.71.358-1.653-.514-1.713-.562-.69-.55-1.224-1.447-1.284-1.883-.062-.477.275-.763.445-1.153-.243.07-.514.192-.514.192s.323-.334.722-.624c.165-.109.262-.178.436-.323a9.762 9.762 0 0 0-.456.003s.42-.227.855-.392c-.318-.014-.623-.003-.623-.003s.937-.419 1.678-.727c.509-.208 1.006-.147 1.286.257.367.53.752.817 1.569.996.501-.223.653-.337 1.284-.509.554-.61.99-.688.99-.688s-.216.198-.274.51c.314-.249.66-.455.66-.455s-.134.164-.259.426l.03.043c.366-.22.797-.394.797-.394s-.123.156-.268.358c.277-.002.838.012 1.056.037 1.285.028 1.552-1.374 2.045-1.55.618-.22.894-.353 1.947.68.903.888 1.609 2.477 1.259 2.833-.294.295-.874-.115-1.516-.916a3.466 3.466 0 0 1-.716-1.562 1.533 1.533 0 0 0-.497-.85s.23.51.23.96c0 .246.03 1.165.424 1.68-.039.076-.057.374-.1.43-.458-.554-1.443-.95-1.604-1.067.544.445 1.793 1.468 2.273 2.449.453.927.186 1.777.416 1.997.065.063.976 1.197 1.15 1.767.306.994.019 2.038-.381 2.685l-1.117.174c-.163-.045-.273-.068-.42-.153.08-.143.241-.5.243-.572l-.063-.111c-.348.492-.93.97-1.414 1.245-.633.359-1.363.304-1.838.156-1.348-.415-2.623-1.327-2.93-1.566 0 0-.01.191.048.234.34.383 1.119 1.077 1.872 1.56l-1.605.177.759 5.908c-.337.048-.39.071-.757.124-.325-1.147-.946-1.895-1.624-2.332-.599-.384-1.424-.47-2.214-.314l-.05.059a2.851 2.851 0 0 1 1.863.444c.654.413 1.181 1.481 1.375 2.124.248.822.42 1.7-.248 2.632-.476.662-1.864 1.028-2.986.237.3.481.705.876 1.25.95.809.11 1.577-.03 2.106-.574.452-.464.69-1.434.628-2.456l.714-.104.258 1.834 11.827-1.424zM15.05 6.848c-.034.075-.085.125-.007.37l.004.014.013.032.032.073c.14.287.295.558.552.696.067-.011.136-.019.207-.023.242-.01.395.028.492.08.009-.048.01-.119.005-.222-.018-.364.072-.982-.626-1.308-.264-.122-.634-.084-.757.068a.302.302 0 0 1 .058.013c.186.066.06.13.027.207m1.958 3.392c-.092-.05-.52-.03-.821.005-.574.068-1.193.267-1.328.372-.247.191-.135.523.047.66.511.382.96.638 1.432.575.29-.038.546-.497.728-.914.124-.288.124-.598-.058-.698m-5.077-2.942c.162-.154-.805-.355-1.556.156-.554.378-.571 1.187-.041 1.646.053.046.096.078.137.104a4.77 4.77 0 0 1 1.396-.412c.113-.125.243-.345.21-.745-.044-.542-.455-.456-.146-.749' },
    { id: 'googlecloud', name: 'GCP', color: '#4285F4',
      path: 'M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-2.821-4.552l-.043.043.006-.05A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c1.244-.04 2.518.368 3.486 1.15a5.186 5.186 0 0 1 1.862 4.078v.518c3.53-.07 3.53 5.262 0 5.193h-5.193l-.008.009v-.04H6.785a2.59 2.59 0 0 1-1.067-.23h.001a2.597 2.597 0 1 1 3.437-3.437l3.013-3.012A6.747 6.747 0 0 0 8.11 8.24c.018-.01.04-.026.054-.023a5.186 5.186 0 0 1 3.67-1.69z' },
    { id: 'snowflake', name: 'Snowflake', color: '#29B5E8',
      path: 'M24 3.459c0 .646-.418 1.18-1.141 1.18-.723 0-1.142-.534-1.142-1.18 0-.647.419-1.18 1.142-1.18.723 0 1.141.533 1.141 1.18zm-.228 0c0-.533-.38-.951-.913-.951s-.913.38-.913.95c0 .533.38.952.913.952.57 0 .913-.419.913-.951zm-1.37-.533h.495c.266 0 .456.152.456.38 0 .153-.076.229-.19.305l.19.266v.038h-.266l-.19-.266h-.229v.266h-.266zm.495.228h-.229v.267h.229c.114 0 .152-.038.152-.114.038-.077-.038-.153-.152-.153zM7.602 12.4c.038-.151.076-.304.076-.456 0-.114-.038-.228-.038-.342-.114-.343-.304-.647-.646-.838l-4.87-2.777c-.685-.38-1.56-.152-1.94.533-.381.685-.153 1.56.532 1.94l2.701 1.56-2.701 1.56c-.685.38-.913 1.256-.533 1.94.38.685 1.256.914 1.94.533l4.832-2.777c.343-.267.571-.533.647-.876zm1.332 2.626c-.266-.038-.57.038-.837.19l-4.832 2.777c-.685.38-.913 1.256-.532 1.94.38.686 1.255.914 1.94.533l2.701-1.56v3.12c0 .8.647 1.408 1.446 1.408.799 0 1.407-.647 1.407-1.408v-5.592c0-.761-.57-1.37-1.293-1.408zm4.946-6.088c.266.038.57-.038.837-.19l4.832-2.777c.685-.38.913-1.256.532-1.94-.38-.686-1.255-.914-1.94-.533l-2.701 1.56V1.975c0-.799-.647-1.408-1.446-1.408-.799 0-1.446.609-1.446 1.408V7.53c0 .76.609 1.37 1.332 1.407zM3.265 5.97l4.832 2.777c.266.152.533.19.837.19.723-.038 1.331-.684 1.331-1.407V1.975c0-.799-.646-1.408-1.407-1.408-.799 0-1.446.647-1.446 1.408v3.12l-2.701-1.56c-.685-.38-1.56-.152-1.94.533-.419.646-.19 1.521.494 1.902zm9.093 6.011a.412.412 0 00-.114-.266l-.57-.571a.346.346 0 00-.267-.114.412.412 0 00-.266.114l-.571.57a.411.411 0 00-.114.267c0 .076.038.19.114.267l.57.57a.345.345 0 00.267.114c.076 0 .19-.038.266-.114l.571-.57a.412.412 0 00.114-.267zm1.598.533L11.94 14.53c-.039.038-.153.114-.229.114h-.608a.411.411 0 01-.267-.114L8.82 12.514a.408.408 0 01-.076-.229v-.608c0-.076.038-.19.114-.267l2.016-2.016a.41.41 0 01.267-.114h.608a.41.41 0 01.267.114l2.016 2.016a.347.347 0 01.114.267v.608c-.076.077-.114.19-.19.229zm5.593 5.44l-4.832-2.777c-.266-.152-.57-.19-.837-.152-.723.038-1.332.684-1.332 1.408v5.554c0 .8.647 1.408 1.408 1.408.799 0 1.446-.647 1.446-1.408v-3.12l2.7 1.56c.686.38 1.561.152 1.941-.533.419-.646.19-1.521-.494-1.94zm2.549-7.533l-2.701 1.56 2.7 1.56c.686.38.914 1.256.533 1.94-.38.685-1.255.913-1.94.533l-4.832-2.778a1.644 1.644 0 01-.647-.798c-.037-.153-.076-.305-.076-.457 0-.114.039-.228.039-.342.114-.343.342-.647.646-.837l4.832-2.778c.685-.38 1.56-.152 1.94.533.457.609.19 1.484-.494 1.864' },
    { id: 'databricks', name: 'Databricks', color: '#FF3621',
      path: 'M.95 14.184L12 20.403l9.919-5.55v2.21L12 22.662l-10.484-5.96-.565.308v.77L12 24l11.05-6.218v-4.317l-.515-.309L12 19.118l-9.867-5.653v-2.21L12 16.805l11.05-6.218V6.32l-.515-.308L12 11.974 2.647 6.681 12 1.388l7.76 4.368.668-.411v-.566L12 0 .95 6.27v.72L12 13.207l9.919-5.55v2.26L12 15.52 1.516 9.56l-.565.308Z' },
    { id: 'newrelic', name: 'New Relic', color: '#1CE783',
      path: 'M8.0015 14.3091v7.384L12.0008 24V12.0008L1.6078 5.9996v4.6167ZM12.0008 0 2.8232 5.2976 6.8209 7.606l5.1799-2.9893 6.3936 3.6913v7.384l-5.1783 2.9908v4.6167l9.176-5.2991V5.9996Z' },
    { id: 'akamai', name: 'Akamai', color: '#0096D6',
      path: 'M13.0548 0C6.384 0 .961 5.3802.961 12.0078.961 18.6354 6.3698 24 13.0548 24c.6168 0 .6454-.3572.0859-.5293-4.9349-1.5063-8.5352-6.069-8.5352-11.4629 0-5.4656 3.6725-10.0706 8.6934-11.5195C13.8153.3448 13.6716 0 13.0548 0Zm2.3242 1.8223c-5.2648 0-9.5254 4.2606-9.5254 9.5254 0 1.2193.2285 2.3818.6445 3.4433.1722.459.4454.4584.4024.0137-.0287-.3156-.0567-.6447-.0567-.9746 0-5.2648 4.2606-9.5254 9.5254-9.5254 4.9779 0 6.4698 2.2235 6.6563 2.08.2008-.1577-1.808-4.5624-7.6465-4.5624zm.4687 4.0703c-1.8622.0592-3.651.7168-5.1035 1.8554-.2582.2009-.1567.3284.1445.1993 2.4675-1.076 5.5812-1.1046 8.6368-.043 2.0514.7173 3.2413 1.7364 3.3418 1.6934.1578-.0718-1.1915-2.2226-3.6446-3.1407-1.1135-.4196-2.2576-.6-3.375-.5644z' },
    { id: 'mongodb', name: 'MongoDB', color: '#47A248',
      path: 'M17.193 9.555c-1.264-5.58-4.252-7.414-4.573-8.115-.28-.394-.53-.954-.735-1.44-.036.495-.055.685-.523 1.184-.723.566-4.438 3.682-4.74 10.02-.282 5.912 4.27 9.435 4.888 9.884l.07.05A73.49 73.49 0 0111.91 24h.481c.114-1.032.284-2.056.51-3.07.417-.296.604-.463.85-.693a11.342 11.342 0 003.639-8.464c.01-.814-.103-1.662-.197-2.218zm-5.336 8.195s0-8.291.275-8.29c.213 0 .49 10.695.49 10.695-.381-.045-.765-1.76-.765-2.405z' },
    // Microsoft had their marks pulled from the simple-icons package; this is the
    // same 24x24 outline, still mirrored by the Iconify API.
    { id: 'azure', name: 'Azure', color: '#0078D4',
      path: 'M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14v.002L17.35 1.76A1.62 1.62 0 0 0 15.816.657H8.184A1.62 1.62 0 0 0 6.65 1.76L.086 21.204a1.62 1.62 0 0 0 1.536 2.139h4.741a1.62 1.62 0 0 0 1.535-1.103l.977-2.892l4.947 3.675c.28.208.618.32.966.32m-3.084-12.531l3.624 10.739a.54.54 0 0 1-.51.713v-.001h-.03a.54.54 0 0 1-.322-.106l-9.287-6.9h4.853m6.313 7.006c.116-.326.13-.694.007-1.058L9.79 1.76l-.007-.02h6.034a.54.54 0 0 1 .512.366l6.562 19.445a.54.54 0 0 1-.338.684' },
    // Conviva ship no mark in any public icon set, so this is a drawn stand-in
    // in their brand orange: concentric rings, which is at least on-theme for a
    // company whose product is measuring concurrent streams.
    { id: 'conviva', name: 'Conviva', color: '#F5A623', path: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 3.6a8.4 8.4 0 110 16.8 8.4 8.4 0 010-16.8zm0 2.4a6 6 0 100 12 6 6 0 000-12zm0 2.4a3.6 3.6 0 110 7.2 3.6 3.6 0 010-7.2z' },
    // Fastly and Anthropic are not in the icon set the rest of this file inlines
    // from, so these two are DRAWN approximations in the correct brand colour —
    // Fastly's flame and Claude's radiating burst — not the official artwork.
    { id: 'fastly', name: 'Fastly', color: '#FF282D', path: 'M12 1.2c2.4 3.1 3.3 5.5 2.6 7.9 1-.6 1.8-1.6 2.2-2.9 2.4 2.6 3.6 5.4 3.6 8.2 0 4.7-3.7 8.4-8.4 8.4S3.6 19.1 3.6 14.4 c0-3.8 2.1-6.9 4.6-9.4 .5 1.4 1.2 2.4 2.1 3C9.4 5.7 10.2 3.3 12 1.2ZM12 12c1.3 1.7 1.9 3 1.9 4.2 0 1.6-1.3 2.9-2.9 2.9s-2.9-1.3-2.9-2.9c0-1.5.9-2.8 2.1-3.9.3.7.7 1.2 1.2 1.5-.2-.7 0-1.4.6-1.8Z' },
    { id: 'claude', name: 'Claude', color: '#D97757', path: 'M11.53 10L12.95 5.43L12 1.4L11.05 5.43L12.47 10ZM12.59 10.03L16.11 6.78L17.3 2.82L14.46 5.83L13.41 10.51ZM13.49 10.59L18.17 9.54L21.18 6.7L17.22 7.89L13.97 11.41ZM14 11.53L18.57 12.95L22.6 12L18.57 11.05L14 12.47ZM13.97 12.59L17.22 16.11L21.18 17.3L18.17 14.46L13.49 13.41ZM13.41 13.49L14.46 18.17L17.3 21.18L16.11 17.22L12.59 13.97ZM12.47 14L11.05 18.57L12 22.6L12.95 18.57L11.53 14ZM11.41 13.97L7.89 17.22L6.7 21.18L9.54 18.17L10.59 13.49ZM10.51 13.41L5.83 14.46L2.82 17.3L6.78 16.11L10.03 12.59ZM10 12.47L5.43 11.05L1.4 12L5.43 12.95L10 11.53ZM10.03 11.41L6.78 7.89L2.82 6.7L5.83 9.54L10.51 10.59ZM10.59 10.51L9.54 5.83L6.7 2.82L7.89 6.78L11.41 10.03ZM12 12m-2.4 0a2.4 2.4 0 104.8 0a2.4 2.4 0 10-4.8 0' },
  ];

  // ---------------------------------------------------------------------------
  // OBSTACLES
  //   kind: 'jump'  — low, clear it by jumping
  //         'slide' — high, get under it by sliding
  //         'block' — full height, change lane or die
  //         'chasm' — a gap in the hill, jump or fall
  //         'tar'   — no crash, but it drags you to a crawl
  //
  // `cause` is what the wipeout screen blames. A vendor obstacle overrides it
  // with the vendor's own name, so you always find out which contract got you.
  // ---------------------------------------------------------------------------
  const OBSTACLES = {
    bedrock: { name: 'AWS Bedrock', kind: 'jump', art: 'rock', color: '#6a6157', accent: '#8d8377',
      w: 250, h: 108, blurb: 'A boulder of AWS Bedrock. Jump it.',
      causes: ['a boulder of AWS Bedrock',
        'an unbudgeted boulder of AWS Bedrock',
        'AWS Bedrock, straight to the shins'] },
    bedrock_slab: { name: 'AWS Bedrock Slab', kind: 'jump', art: 'rock',
      color: '#5d5449', accent: '#837a6e',
      w: 300, h: 76, blurb: 'Wider, lower, still solid.',
      causes: ['a slab of AWS Bedrock',
        'a wide, flat slab of AWS Bedrock',
        'inference charges the size of a rock'] },
    vendor_board: { name: 'Contract', kind: 'block', art: 'sign', vendor: true,
      color: '#20283a', accent: '#7d8ba8',
      w: 210, h: 210, blurb: 'Signed, sealed, in your way.',
      causes: null },   // vendor obstacles draw from VENDOR_CAUSES
    vendor_gantry: { name: 'Renewal', kind: 'slide', art: 'gantry', vendor: true,
      color: '#20283a', accent: '#7d8ba8',
      w: 330, h: 150, blurb: 'Overhead and unavoidable. Get under it.',
      causes: null },
    support_tar: { name: 'Extended Support Tar', kind: 'tar', art: 'tar', glyph: '🛢️',
      color: '#4b3b2f', accent: '#8a6a3f',
      w: 300, h: 40, slow: 0.45, dur: 1.1, blurb: 'Year 3 fees. Everything slows down.',
      causes: ['Extended Support tar',
        'year-three support fees, thick as tar',
        'a support tier nobody remembered renewing out of'] },
    billing_gap: { name: 'Billing Gap', kind: 'chasm', art: 'chasm', glyph: '🕳️',
      color: '#0a0d14', accent: '#2b3f66',
      w: 340, h: 0, blurb: 'Month-end close. Mind the gap.',
      causes: ['the month-end Billing Gap',
        'a hole where the month-end close should be',
        'three days of missing CUR'] },
  };

  // Every vendor sign can end a run in more than one way. `{vendor}` is filled
  // with the name on the sign, so the same Datadog board reads differently each
  // time and the wipeout screen stops sounding like a template.
  const VENDOR_CAUSES = [
    'the {vendor} Contract',
    'the {vendor} Renewal',
    'a cost spike in the {vendor} spend',
    'an issue in the {vendor} cost pipeline',
    'an unbudgeted {vendor} true-up',
    'a {vendor} invoice nobody had seen before',
    '{vendor} usage that grew while nobody was looking',
    'a {vendor} commitment that came due',
    'the {vendor} line on the megabill',
    'a surprise tier change in {vendor}',
  ];

  // What can appear, and from what distance travelled (metres) it starts.
  const SPAWN_TABLE = [
    { type: 'bedrock', weight: 30, from: 0 },
    { type: 'vendor_board', weight: 34, from: 0 },
    { type: 'bedrock_slab', weight: 22, from: 300 },
    { type: 'vendor_gantry', weight: 26, from: 260 },
    { type: 'billing_gap', weight: 18, from: 620 },
    { type: 'support_tar', weight: 14, from: 1200 },
  ];

  // Hazard density ramps with distance; never so dense that all three lanes close.
  // Hazard spacing is expressed in SECONDS OF WARNING, not world units. Spacing by
  // distance looks fine at the start speed and becomes unplayable at the top one —
  // the same 420-unit gap is 1.4s at 300/s and 0.14s at 3000/s.
  const DIFFICULTY = {
    reactionAt: (m) => Math.max(0.78, 1.55 - m * 0.00035),  // seconds to read a row
    minGap: 430,                                            // world-unit floor
    firstRowZ: 2600,                                        // ~3s of clear road to settle in
    maxBlockedAt: (m) => (m < 400 ? 1 : 2),                 // never all three
    chasmFrom: 620,
    chasmChance: 0.16,
    tokenChance: 0.72,
    trailChance: 0.30,
    powerupEvery: 2600,
  };

  // ---------------------------------------------------------------------------
  // POWER-UPS — every one is a real cost lever
  // ---------------------------------------------------------------------------
  // `weight` is the relative chance of this one turning up at a power-up slot.
  // `sprite` names an image in assets/ to draw instead of the icon glyph.
  const POWERUPS = {
    batch: { name: 'Batch API', icon: '📦', dur: 8, color: '#7fd6c4', weight: 20,
      blurb: 'Double tokens, everything slows down.',
      fact: 'Batch processing trades latency for roughly half the price.' },
    cache: { name: 'Prompt Cache', icon: '🧲', dur: 9, color: '#a06bff', weight: 20,
      blurb: 'Pulls every token on the hill toward you.',
      fact: 'Cached input tokens cost a fraction of fresh ones.' },
    graviton: { name: 'Graviton Skates', icon: '⚡', dur: 7, color: '#ffd76b', weight: 20,
      blurb: 'Faster, and you jump further.',
      fact: 'Graviton: ~20% better price-performance than x86.' },
    spot: { name: 'Spot Burst', icon: '🚀', dur: 6, color: '#ff9e2c', weight: 20,
      blurb: 'Huge speed burst — but Spot can be reclaimed.',
      fact: 'Up to 90% off, if you can tolerate interruption.' },
    // The drink the hill is named after, and the only thing that will save you.
    // Carries the weight the RI Shield used to, since it is now the sole shield.
    mudslide: { name: 'The Mudslide', icon: '🥤', sprite: 'mudslide', dur: 0,
      color: '#e0b877', weight: 27,
      blurb: 'One free wipeout. Drink up.',
      fact: 'Cheapest insurance on the hill. Also the tastiest.' },
  };

  // ---------------------------------------------------------------------------
  // SCORING EXTRAS
  // ---------------------------------------------------------------------------
  const SCORING = {
    dodgeWindow: 900,        // world units since the lane change that still counts as a dodge
    nearMissTokens: 0.5,
    distanceTokensPer: 180,  // a token every N metres survived — was 30, /6 with TOKENS above
    speedBonusAt: 2200,      // above this speed, pickups pay double
    historyKept: 50,         // runs retained locally for the board
  };

  const ACHIEVEMENTS = [
    { id: 'ms_first', name: 'First Descent', icon: '🥤', desc: 'Finish your first run.' },
    { id: 'ms_1k', name: 'Token Economy', icon: '🪙', desc: 'Collect 1,000 tokens in one run.' },
    { id: 'ms_2km', name: 'Long Hauler', icon: '📏', desc: 'Survive 2,000 metres.' },
    { id: 'ms_nearmiss', name: 'Paper Thin', icon: '🌬️', desc: '25 near misses in one run.' },
    { id: 'ms_nohit', name: 'Clean Sheet', icon: '✨', desc: 'Reach 1,000m without drinking one.' },
    { id: 'ms_topspeed', name: 'Terminal Velocity', icon: '🚀', desc: 'Hit maximum speed.' },
    { id: 'ms_10k', name: 'Token Whale', icon: '🐋', desc: 'Bank 10,000 tokens across all runs.' },
  ];

  const TIPS = [
    'Cached tokens come in trails — clear a whole one for a streak bonus.',
    'Tar pits will not kill you. They will cost you every token ahead of you.',
    'Graviton Skates make your jumps longer. Use them on chasm-heavy stretches.',
    'A near miss pays. Dodging early pays nothing.',
    'Spot Burst is the fastest way down, and the fastest way into a contract.',
    'Every token you pick up is banked, even the run you crash on.',
    'Bedrock comes in two heights. Both of them want you to jump.',
    'The Mudslide is the only thing that saves a run. Grab every glass.',
    'Land a jump in deep mud and the whole hill notices.',
  ];

  // ---------------------------------------------------------------------------
  // BRIEFING — the "how to play" screen.
  //
  // Only the prose lives here. The token, hazard and power-up tables on that
  // screen are generated from the balance data above, so they cannot drift out
  // of sync with what the game actually does.
  // ---------------------------------------------------------------------------
  const BRIEFING = {
    story: [
      'Everything in the CostBot Arcade runs on AI tokens. They are what pays for '
      + 'the next report, the next agent, the next thing CostBot ships for the team — '
      + 'and there are never enough of them.',
      'So he goes to the hill. Tokens wash down it all day, and the fastest way to '
      + 'the bottom is on your back at speed. Everything you pick up is banked to the '
      + 'arcade, whether you make it down or not — and every vendor on the megabill '
      + 'has planted a sign in the mud.',
    ],
    // one line per obstacle kind — the specific hazards are listed from OBSTACLES
    hazards: [
      { kind: 'jump', key: '↑', label: 'Jump it', note: 'Bedrock. Low, solid, unbothered.' },
      { kind: 'slide', key: '↓', label: 'Slide under it', note: 'Renewals hang overhead.' },
      { kind: 'block', key: '← →', label: 'Go around it', note: 'A signed contract fills the lane.' },
      { kind: 'chasm', key: '↑', label: 'Jump the gap', note: 'Month-end close, spanning the road.' },
      { kind: 'tar', key: '—', label: 'Survivable', note: 'Extended Support drags you to a crawl.' },
    ],
  };

  global.MS_CONTENT = {
    WORLD, TOKENS, VENDORS, OBSTACLES, VENDOR_CAUSES, SPAWN_TABLE, DIFFICULTY,
    POWERUPS, SCORING, ACHIEVEMENTS, TIPS, BRIEFING,
  };
})(typeof window !== 'undefined' ? window : globalThis);
