// test/test-light-pools.js — ground light pool footprint math, and the
// darkness ramp every fake-lighting channel (pool opacity, halo opacity,
// fixture emissiveIntensity) shares.
//
// THREE is a CDN global (see lighting-builder.js's header) — this test never
// calls buildLightPools/buildLightHalos or anything else that constructs a
// THREE object. It exercises the pure helpers headlessly:
//  1. poolFootprint(light, dir): point -> circle, cone -> elongated ellipse
//     pushed forward, dir rotates the offset, radius scales linearly.
//  2. The three darkness-ramp lerps stay bounded, monotonic, and agree with
//     their documented endpoints (day-night.js's own darkness contract).

import {
  poolFootprint,
  fixtureLightTag,
  aimYaw,
  POOL_RADIUS_SCALE,
  CONE_ELONGATION,
  CONE_OFFSET_FRAC,
  EMITTER_BASE_INTENSITY,
  EMITTER_MAX_INTENSITY,
  POOL_MAX_OPACITY,
  HALO_MAX_OPACITY,
  emitterIntensityForDarkness,
  poolOpacityForDarkness,
  haloOpacityForDarkness,
} from '../src/renderer3d/lighting-builder.js';
import { LIGHTING_DEFS } from '../src/data/placeables/lighting.js';

const DEF = Object.fromEntries(LIGHTING_DEFS.map((d) => [d.id, d]));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const POINT_LIGHT = { color: '#ffa64d', intensity: 1.0, radius: 6, shape: 'point' };
const CONE_LIGHT = { color: '#f5f8ff', intensity: 1.8, radius: 9, shape: 'cone', coneDeg: 45, tiltDeg: 35 };

// ---------------------------------------------------------------------------
console.log('\n=== point fixture: a circle, centred on the fixture ===\n');
{
  const f = poolFootprint(POINT_LIGHT, 0);
  assert(f.rx === f.rz, `rx === rz for a point light (got rx=${f.rx}, rz=${f.rz})`);
  assert(f.offsetX === 0 && f.offsetZ === 0, `zero offset for a point light (got ${f.offsetX}, ${f.offsetZ})`);
  assert(f.rx === POINT_LIGHT.radius * POOL_RADIUS_SCALE, `rx derives from radius * POOL_RADIUS_SCALE (got ${f.rx})`);

  // dir must not matter at all for a point light — it has no aim.
  const dirs = [0, 1, 2, 3].map((d) => poolFootprint(POINT_LIGHT, d));
  assert(dirs.every((d) => d.rx === dirs[0].rx && d.rz === dirs[0].rz && d.offsetX === 0 && d.offsetZ === 0),
    'a point light\'s footprint is identical across all four dirs');
}

// ---------------------------------------------------------------------------
console.log('\n=== cone fixture: an ellipse elongated along its aim, pushed forward ===\n');
{
  const f = poolFootprint(CONE_LIGHT, 0);
  assert(f.rx !== f.rz, `rx !== rz for a cone light (got rx=${f.rx}, rz=${f.rz})`);
  assert(f.offsetX !== 0 || f.offsetZ !== 0, `non-zero offset for a cone light (got ${f.offsetX}, ${f.offsetZ})`);

  const along = CONE_LIGHT.radius * POOL_RADIUS_SCALE * CONE_ELONGATION;
  const across = CONE_LIGHT.radius * POOL_RADIUS_SCALE;
  assert(Math.max(f.rx, f.rz) === along, `the long axis equals radius * POOL_RADIUS_SCALE * CONE_ELONGATION (got ${Math.max(f.rx, f.rz)}, want ${along})`);
  assert(Math.min(f.rx, f.rz) === across, `the short axis equals plain radius * POOL_RADIUS_SCALE (got ${Math.min(f.rx, f.rz)}, want ${across})`);

  // dir=0 aims along local +x per lighting-builder.js's authoring convention
  // — the ellipse should be pushed out along +x, not +z.
  assert(f.offsetX > 0 && f.offsetZ === 0, `dir=0 pushes the centre along +x, not z (got offsetX=${f.offsetX}, offsetZ=${f.offsetZ})`);
  assert(f.rx > f.rz, 'dir=0: the long axis is rx (aim is along x)');
  const expectedOffset = CONE_LIGHT.radius * POOL_RADIUS_SCALE * CONE_OFFSET_FRAC;
  assert(f.offsetX === expectedOffset, `offset magnitude is radius * POOL_RADIUS_SCALE * CONE_OFFSET_FRAC (got ${f.offsetX}, want ${expectedOffset})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== incrementing dir rotates the offset 90 degrees ===\n');
{
  // dir is 0-3 quarter turns (NOT octants — see Task 5's preflight ruling
  // P2). Each step should swing the offset vector's angle by exactly 90°,
  // and swap which axis carries the long/short radius along with it.
  const angleOf = (f) => Math.atan2(f.offsetZ, f.offsetX) * 180 / Math.PI;
  const footprints = [0, 1, 2, 3].map((d) => poolFootprint(CONE_LIGHT, d));

  for (let i = 0; i < 4; i++) {
    const a = angleOf(footprints[i]);
    const b = angleOf(footprints[(i + 1) % 4]);
    let delta = b - a;
    // normalize to (-180, 180]
    while (delta <= -180) delta += 360;
    while (delta > 180) delta -= 360;
    assert(Math.abs(Math.abs(delta) - 90) < 1e-6,
      `dir=${i} -> dir=${(i + 1) % 4}: offset angle steps by 90 degrees (got ${delta.toFixed(3)})`);
  }

  // dir=1's aim is along z (perpendicular to dir=0's), so the long axis
  // should now be rz instead of rx.
  assert(footprints[1].rz > footprints[1].rx, 'dir=1: the long axis is rz (aim rotated onto z)');
  assert(footprints[1].offsetZ !== 0 && footprints[1].offsetX === 0,
    `dir=1: offset is purely along z (got offsetX=${footprints[1].offsetX}, offsetZ=${footprints[1].offsetZ})`);

  // Every dir's footprint shares the same axis-aligned rx/rz *pair of
  // values* (just swapped) and the same offset magnitude — only the axis
  // changes, never the size.
  for (const f of footprints) {
    assert(Math.max(f.rx, f.rz) === Math.max(footprints[0].rx, footprints[0].rz),
      'long-axis length is the same across all four dirs');
    const mag = Math.hypot(f.offsetX, f.offsetZ);
    const mag0 = Math.hypot(footprints[0].offsetX, footprints[0].offsetZ);
    assert(Math.abs(mag - mag0) < 1e-9, 'offset magnitude is the same across all four dirs');
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== radius scales the footprint linearly ===\n');
{
  const base = poolFootprint(POINT_LIGHT, 0);
  const doubled = poolFootprint({ ...POINT_LIGHT, radius: POINT_LIGHT.radius * 2 }, 0);
  assert(doubled.rx === base.rx * 2, `doubling radius doubles rx for a point light (got ${doubled.rx}, want ${base.rx * 2})`);

  const baseCone = poolFootprint(CONE_LIGHT, 1);
  const doubledCone = poolFootprint({ ...CONE_LIGHT, radius: CONE_LIGHT.radius * 3 }, 1);
  assert(Math.abs(doubledCone.rx - baseCone.rx * 3) < 1e-9, 'tripling radius triples rx for a cone light');
  assert(Math.abs(doubledCone.rz - baseCone.rz * 3) < 1e-9, 'tripling radius triples rz for a cone light');
  assert(Math.abs(doubledCone.offsetZ - baseCone.offsetZ * 3) < 1e-9, 'tripling radius triples the offset for a cone light');

  // A zero radius must not produce a degenerate-but-nonzero footprint.
  const zero = poolFootprint({ ...CONE_LIGHT, radius: 0 }, 0);
  assert(zero.rx === 0 && zero.rz === 0 && zero.offsetX === 0 && zero.offsetZ === 0,
    'radius=0 collapses the footprint to nothing');
}

// ---------------------------------------------------------------------------
console.log('\n=== non-cone shapes (or a missing light block) degrade to a circle ===\n');
{
  const missingShape = poolFootprint({ color: '#fff', radius: 4 }, 2);
  assert(missingShape.rx === missingShape.rz, 'a light block with no `shape` field is treated as a point (circle)');

  const nullLight = poolFootprint(null, 1);
  assert(nullLight.rx === 0 && nullLight.rz === 0, 'a null light produces a zero-radius footprint, not a crash');
}

// ---------------------------------------------------------------------------
console.log('\n=== darkness ramp: bounded, monotonic, matches its documented endpoints ===\n');
{
  assert(emitterIntensityForDarkness(0) === EMITTER_BASE_INTENSITY, `emitterIntensityForDarkness(0) === EMITTER_BASE_INTENSITY (got ${emitterIntensityForDarkness(0)})`);
  assert(emitterIntensityForDarkness(1) === EMITTER_MAX_INTENSITY, `emitterIntensityForDarkness(1) === EMITTER_MAX_INTENSITY (got ${emitterIntensityForDarkness(1)})`);
  assert(poolOpacityForDarkness(0) === 0, 'pool opacity is 0 at full daylight (lamps are off)');
  assert(poolOpacityForDarkness(1) === POOL_MAX_OPACITY, `poolOpacityForDarkness(1) === POOL_MAX_OPACITY (got ${poolOpacityForDarkness(1)})`);
  assert(haloOpacityForDarkness(0) === 0, 'halo opacity is 0 at full daylight (lamps are off)');
  assert(haloOpacityForDarkness(1) === HALO_MAX_OPACITY, `haloOpacityForDarkness(1) === HALO_MAX_OPACITY (got ${haloOpacityForDarkness(1)})`);

  let emitterMono = true, poolMono = true, haloMono = true;
  let prevEmitter = -Infinity, prevPool = -Infinity, prevHalo = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const e = emitterIntensityForDarkness(t);
    const p = poolOpacityForDarkness(t);
    const h = haloOpacityForDarkness(t);
    if (e < prevEmitter) emitterMono = false;
    if (p < prevPool) poolMono = false;
    if (h < prevHalo) haloMono = false;
    prevEmitter = e; prevPool = p; prevHalo = h;
  }
  assert(emitterMono, 'emitterIntensityForDarkness is non-decreasing as darkness rises');
  assert(poolMono, 'poolOpacityForDarkness is non-decreasing as darkness rises');
  assert(haloMono, 'haloOpacityForDarkness is non-decreasing as darkness rises');
}

// ---------------------------------------------------------------------------
// fixtureLightTag — the ONLY contract between the painted-pool system and the
// real-light rig (light-rig.js). It is pure by design: no THREE, no scene
// graph, so the aim and mount-height math is assertable headlessly right here
// rather than only visible on a GPU.
console.log('\n=== fixtureLightTag: the pure handoff to light-rig.js ===\n');
{
  // --- a plain ground point fixture ---
  const lamp = fixtureLightTag(DEF.lamppost, { id: 'L1', dir: 0 });
  assert(lamp.id === 'L1', 'the placement id is carried through (it keys pool suppression)');
  assert(lamp.shape === 'point', `lamppost is a point light (got ${lamp.shape})`);
  assert(lamp.aimed === false, 'a point fixture is never aimed');
  assert(lamp.aimYaw === 0, 'an unaimed fixture reports zero yaw regardless of dir');
  assert(lamp.color === DEF.lamppost.light.color, 'color is passed through verbatim as the def\'s css string');
  assert(lamp.radius === DEF.lamppost.light.radius, 'radius is the def\'s pool radius — the rig sets light.distance from it');
  assert(lamp.intensity === DEF.lamppost.light.intensity, 'intensity comes from the def');

  // dir must not leak into an unaimed fixture's yaw.
  const lampTurned = fixtureLightTag(DEF.lamppost, { id: 'L1', dir: 3 });
  assert(lampTurned.aimYaw === 0, 'dir=3 still yields zero yaw for a point fixture');

  // --- ground mount: offsetY IS emitterY ---
  assert(lamp.offsetY === DEF.lamppost.light.emitterY,
    `a ground fixture's origin is on the floor, so offsetY === emitterY (got ${lamp.offsetY})`);

  // --- wall mount: offsetY is ZERO, not emitterY ---
  // The regression this guards: emitterY is measured from the MOUNT SURFACE,
  // and a wall fixture's group origin already IS that mounting point 2.1 m up
  // the wall. Copying emitterY raw would hang the real spot another 2.1 m
  // above the sconce's own geometry.
  const sconce = fixtureLightTag(DEF.wallSconce, { id: 'W1', dir: 1 });
  assert(sconce.offsetY === 0,
    `a wall fixture's emitter sits AT its origin, so offsetY is 0, not emitterY=${DEF.wallSconce.light.emitterY} (got ${sconce.offsetY})`);
  assert(DEF.wallSconce.light.emitterY !== 0, 'sanity: the wall def really does carry a non-zero emitterY to be ignored');

  const panel = fixtureLightTag(DEF.ceilingPanel, { id: 'C1' });
  assert(panel.offsetY === 0, 'an overhead fixture hangs from its origin too — offsetY 0');

  // --- aimed ground cone (floodLight) ---
  const flood = fixtureLightTag(DEF.floodLight, { id: 'F1', dir: 2 });
  assert(flood.shape === 'cone', 'floodLight is a cone');
  assert(flood.aimed === true, 'a ground-mounted cone IS aimed by dir');
  assert(flood.aimYaw === aimYaw(2), `an aimed fixture's yaw follows aimYaw(dir) exactly (got ${flood.aimYaw}, want ${aimYaw(2)})`);
  assert(flood.coneDeg === DEF.floodLight.light.coneDeg, 'coneDeg is carried (the rig halves it for SpotLight.angle)');
  assert(flood.tiltDeg === DEF.floodLight.light.tiltDeg, 'tiltDeg is carried (tilt off straight-down, toward the aim)');
  assert(flood.offsetY === DEF.floodLight.light.emitterY, 'floodLight is ground-mounted, so offsetY === emitterY');

  // Every dir gives a distinct yaw — otherwise a rotated flood's real cone
  // would land somewhere its painted pool isn't.
  const yaws = [0, 1, 2, 3].map((d) => fixtureLightTag(DEF.floodLight, { id: 'F', dir: d }).aimYaw);
  assert(new Set(yaws).size === 4, `all four dirs give distinct aim yaws (got ${yaws.join(', ')})`);

  // --- overhead cone (highBay): a cone, but NOT aimed ---
  const bay = fixtureLightTag(DEF.highBay, { id: 'H1', dir: 1 });
  assert(bay.shape === 'cone', 'highBay is a cone');
  assert(bay.aimed === false, 'an OVERHEAD cone points straight down — it is not aimed, even with dir set');
  assert(bay.aimYaw === 0, 'and so reports zero yaw');
  assert(bay.coneDeg === 90, 'highBay keeps its wide 90 degree cone');

  // --- defs with no light block, and field defaults ---
  assert(fixtureLightTag({ id: 'bench', mount: 'ground' }, { id: 'B1' }) === null,
    'a def with no light block produces null — nothing for the rig to hold');
  assert(fixtureLightTag(null, { id: 'X' }) === null, 'a null def is null, not a crash');

  const bare = fixtureLightTag({ id: 'bare', mount: 'ground', light: { color: '#fff' } }, { id: 'Z1' });
  assert(bare.intensity === 1, `a light block with no intensity defaults to 1 (got ${bare.intensity})`);
  assert(bare.radius === 0, `no radius defaults to 0 — the rig reads that as "use my own throw" (got ${bare.radius})`);
  assert(bare.shape === 'point', 'no shape defaults to point');
  assert(bare.coneDeg === 0 && bare.tiltDeg === 0, 'no cone fields default to 0, so the rig falls back to its own angle');
  assert(bare.offsetY === 0, 'a light block with no emitterY sits at its origin');
  assert(bare.aimed === false, 'a shapeless light is not an aimed cone');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
