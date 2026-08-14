// test/test-window-glow.js — the night glow on window panes.
//
// THREE is a CDN global (see wall-builder.js / lighting-builder.js headers),
// so the window GEOMETRY is not unit-testable here — this file exercises only
// the pure darkness ramp that drives the glow, in the style of
// test/test-light-pools.js. The pane's emissive colour is set once at build
// time; glassGlowForDarkness is the entire per-frame contract.
//
// Kept separate from test/test-windows.js (catalogue/sim coverage) on
// purpose: the two files are owned by different tasks.

import {
  glassGlowForDarkness,
  GLASS_MAX_GLOW,
  emitterIntensityForDarkness,
  poolOpacityForDarkness,
  haloOpacityForDarkness,
} from '../src/renderer3d/lighting-builder.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
console.log('\n=== glass glow ramp: documented endpoints ===\n');
{
  assert(typeof GLASS_MAX_GLOW === 'number' && GLASS_MAX_GLOW > 0,
    `GLASS_MAX_GLOW is a positive number (got ${GLASS_MAX_GLOW})`);
  assert(glassGlowForDarkness(0) === 0,
    `glass is inert in broad daylight (got ${glassGlowForDarkness(0)})`);
  assert(glassGlowForDarkness(1) === GLASS_MAX_GLOW,
    `glassGlowForDarkness(1) === GLASS_MAX_GLOW (got ${glassGlowForDarkness(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== glass glow ramp: bounded and monotonic across [0,1] ===\n');
{
  let mono = true, bounded = true;
  let prev = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const g = glassGlowForDarkness(t);
    if (g < prev) mono = false;
    if (g < 0 || g > GLASS_MAX_GLOW) bounded = false;
    prev = g;
  }
  assert(mono, 'glassGlowForDarkness is non-decreasing as darkness rises');
  assert(bounded, 'glassGlowForDarkness stays within [0, GLASS_MAX_GLOW]');

  const mid = glassGlowForDarkness(0.5);
  assert(mid > 0 && mid < GLASS_MAX_GLOW,
    `half darkness gives a strictly intermediate glow (got ${mid})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== glass shares the one darkness curve, not a second one ===\n');
{
  // Every fake-lighting channel must switch on together — a pane that lights
  // before the lamps do (or after) reads as a bug from outside the building.
  // All four ramps are anchored at the same two endpoints of `darkness`.
  const channelsOffAtDay = [
    ['pool', poolOpacityForDarkness(0)],
    ['halo', haloOpacityForDarkness(0)],
    ['glass', glassGlowForDarkness(0)],
  ];
  assert(channelsOffAtDay.every(([, v]) => v === 0),
    `pool, halo and glass are all off at darkness 0 (got ${channelsOffAtDay.map(([n, v]) => `${n}=${v}`).join(', ')})`);

  // The emitter ramp has a non-zero daytime base by design, so it is only
  // checked for the shared direction, not a zero start.
  assert(emitterIntensityForDarkness(1) > emitterIntensityForDarkness(0)
    && glassGlowForDarkness(1) > glassGlowForDarkness(0),
    'glass and fixture emitters both rise with darkness (same direction)');

  // Linear in darkness, exactly like the pool/halo ramps — no second curve.
  assert(Math.abs(glassGlowForDarkness(0.25) * 2 - glassGlowForDarkness(0.5)) < 1e-12,
    'glassGlowForDarkness is linear in darkness (doubling darkness doubles glow)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
