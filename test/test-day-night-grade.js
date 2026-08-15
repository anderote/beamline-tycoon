// test/test-day-night-grade.js — night gets dark, but never flat black.
//
// Before this, `_updateSunCycle` pinned ambient intensity at 1.3 regardless
// of the time of day, so midnight was a well-lit facility with a blue cast.
// dayNightGrade(timeOfDay) is the pure replacement: a single "how dark is
// it" value (`darkness`) that every consumer — ambient, sun, moon, and later
// tasks' fixture emissive/light pools/real lights — reads to stay in
// lockstep. This file pins its curve shape: monotonic, eased at dusk/dawn,
// and bounded so geometry never goes flat black at midnight.

import {
  dayNightGrade,
  NIGHT_AMBIENT,
} from '../src/renderer3d/day-night.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
console.log('\n=== darkness: 0 at noon, 1 at midnight ===\n');
{
  const noon = dayNightGrade(0.5);
  const midnight = dayNightGrade(0.0);
  assert(noon.darkness === 0, `darkness is 0 at noon (got ${noon.darkness})`);
  assert(midnight.darkness === 1, `darkness is 1 at midnight (got ${midnight.darkness})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== darkness is monotonic from noon to midnight ===\n');
{
  // Evening side: noon (0.5) sliding up to midnight-as-1.0.
  const evening = [];
  for (let i = 0; i <= 11; i++) evening.push(dayNightGrade(0.5 + (i / 11) * 0.5).darkness);
  let eveningOk = true;
  for (let i = 1; i < evening.length; i++) {
    if (evening[i] < evening[i - 1]) eveningOk = false;
  }
  assert(eveningOk, `darkness is non-decreasing from noon toward midnight via dusk (${evening.map((x) => x.toFixed(3)).join(', ')})`);

  // Morning side: noon (0.5) sliding down to midnight-as-0.0.
  const morning = [];
  for (let i = 0; i <= 11; i++) morning.push(dayNightGrade(0.5 - (i / 11) * 0.5).darkness);
  let morningOk = true;
  for (let i = 1; i < morning.length; i++) {
    if (morning[i] < morning[i - 1]) morningOk = false;
  }
  assert(morningOk, `darkness is non-decreasing from noon toward midnight via dawn (${morning.map((x) => x.toFixed(3)).join(', ')})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== ambientIntensity ranges from 1.3 (noon) to NIGHT_AMBIENT (midnight) ===\n');
{
  assert(NIGHT_AMBIENT === 0.65, `NIGHT_AMBIENT is 0.65 (got ${NIGHT_AMBIENT})`);
  const noon = dayNightGrade(0.5);
  const midnight = dayNightGrade(0.0);
  assert(noon.ambientIntensity === 1.3, `ambientIntensity is 1.3 at noon (got ${noon.ambientIntensity})`);
  assert(midnight.ambientIntensity === NIGHT_AMBIENT, `ambientIntensity is NIGHT_AMBIENT at midnight (got ${midnight.ambientIntensity})`);

  let inRange = true;
  for (let i = 0; i < 100; i++) {
    const t = i / 100;
    const { ambientIntensity } = dayNightGrade(t);
    if (ambientIntensity < NIGHT_AMBIENT || ambientIntensity > 1.3) inRange = false;
  }
  assert(inRange, 'ambientIntensity never leaves [NIGHT_AMBIENT, 1.3] across a full day');

  const darkestChannel = Math.min(...midnight.ambientColor) * midnight.ambientIntensity;
  assert(darkestChannel >= 0.25,
    `midnight ambient keeps every colour channel legible before tone mapping (got ${darkestChannel})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== sunIntensity reaches 0 at night; moonIntensity is 0 by day ===\n');
{
  const midnight = dayNightGrade(0.0);
  assert(midnight.sunIntensity === 0, `sunIntensity is 0 at midnight (got ${midnight.sunIntensity})`);

  const noon = dayNightGrade(0.5);
  assert(noon.moonIntensity === 0, `moonIntensity is 0 at noon (got ${noon.moonIntensity})`);

  let sunNeverNegative = true;
  let moonNeverNegative = true;
  for (let i = 0; i < 100; i++) {
    const t = i / 100;
    const { sunIntensity, moonIntensity } = dayNightGrade(t);
    if (sunIntensity < 0) sunNeverNegative = false;
    if (moonIntensity < 0) moonNeverNegative = false;
  }
  assert(sunNeverNegative, 'sunIntensity never goes negative');
  assert(moonNeverNegative, 'moonIntensity never goes negative');
}

// ---------------------------------------------------------------------------
console.log('\n=== colours are well-formed RGB triples ===\n');
{
  for (const t of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.999]) {
    const { ambientColor, sunColor } = dayNightGrade(t);
    assert(
      Array.isArray(ambientColor) && ambientColor.length === 3 &&
        ambientColor.every((c) => c >= 0 && c <= 1),
      `ambientColor at timeOfDay=${t} is a valid [r,g,b] in [0,1] (got ${JSON.stringify(ambientColor)})`
    );
    assert(
      Array.isArray(sunColor) && sunColor.length === 3 &&
        sunColor.every((c) => c >= 0 && c <= 1),
      `sunColor at timeOfDay=${t} is a valid [r,g,b] in [0,1] (got ${JSON.stringify(sunColor)})`
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
