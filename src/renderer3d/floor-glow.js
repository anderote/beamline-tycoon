// src/renderer3d/floor-glow.js
//
// Pipes can't cast light — three has no line light, and sampling a point
// light along a run would be ruinous (one light per metre, times every wired
// utility, is exactly the "shader recompile per light" problem light-rig.js
// exists to avoid). But utility runs already LIE ON THE DECK
// (utilityLineHeight puts a run a centimetre above the floor — see
// utility-line-builder-v2.js), so instead of casting light, this paints it: a
// flat, additive-blended strip on the floor directly beneath the run, pulsing
// in the SAME rhythm as the pipe above it.
//
// "Same rhythm" here means the same FORMULA and the same per-frame tick, not
// a literally-shared uniform object: this strip's material goes through
// patchFlowMaterial (utility-flow.js) exactly like the pipe's own material
// does, which registers its uTime uniform with that module's tickFlow(). Both
// uniforms start at 0 and both get the same dtSeconds added by the same
// tickFlow(dt) call in ThreeRenderer._animate — two different uniform
// objects, numerically identical values every frame, which is what "in
// phase" actually requires.
//
// THREE is loaded as a CDN global — do NOT import it.

import { FLOW_PARAMS, patchFlowMaterial, bakeRunDistanceFromPositionZ } from './utility-flow.js';

// A hair above the floor tiles, well below the pipe centerline itself
// (utilityLineHeight) — this is paint on the deck, not a second pipe.
const FLOOR_GLOW_Y = 0.005;
// Wider than the pipe it sits under — a "pool" of spilled light, not a
// shadow of the pipe traced onto the floor.
const FLOOR_GLOW_WIDTH = 0.5;
const FLOOR_GLOW_THICKNESS = 0.002;

/**
 * Build the floor-glow strip for one utility run, reusing the run's own
 * polyline. Returns null when there's nothing to paint: `utilityType` has no
 * flow at all (FLOW_PARAMS[utilityType] == null — vacuumPipe, by design), or
 * `flowState` is 'hard' (network dead: the pipe above goes dark, so does the
 * pool under it — see utility-flow.js's FLOW_STATE_MODS.hard, which already
 * zeroes the pipe's own strength/baseGlow the same way).
 *
 * `points` must already be in source -> sink order (the SAME order the
 * caller baked into the pipe segments above — utility-line-builder-v2.js
 * reverses its own `points` array the same way before calling this, driven
 * by computeLineOrientations). This function does not accept a `reversed`
 * flag of its own: getting that from a second parameter here, independent of
 * whatever the caller already resolved for the pipe, is exactly how the pool
 * and the pulses above it could end up disagreeing about which way is
 * "forward".
 *
 * @param {THREE.Vector3[]} points
 * @param {string} utilityType
 * @param {'ok'|'soft'|'hard'} flowState
 * @returns {THREE.Group|null}
 */
export function buildFloorGlowStrip(points, utilityType, flowState) {
  if (!points || points.length < 2) return null;
  if (!FLOW_PARAMS[utilityType]) return null; // vacuumPipe (or any future no-flow utility)
  if (flowState === 'hard') return null;

  // Deliberately NOT cached/shared across lines (contrast getLineMaterial /
  // getJacketMaterial in utility-line-builder-v2.js, both of which tag their
  // materials __shared): the geometry below is this one line's own polyline
  // and can never be reused by another line, so the material riding with it
  // can't be either — a cached, __shared-tagged material here would survive
  // this line's group disposal (utility-line-builder-v2.js's _disposeGroup
  // skips anything tagged __shared) while some OTHER line kept using the
  // same cached instance, which is a lifetime mismatch, not a saving. Each
  // strip is a handful of segments; the per-line material is cheap.
  const material = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1, metalness: 0,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  // Same mechanism the pipe's own material uses (adds to
  // totalEmissiveRadiance via onBeforeCompile) — color=black keeps the
  // material's base PBR response at ~0 so the only thing that reads is the
  // flow pulse itself, which is the "no lighting" the brief asks for: this
  // paints, it doesn't shade.
  patchFlowMaterial(material, utilityType, flowState);

  const group = new THREE.Group();
  group.userData = { isFloorGlowStrip: true, utilityType, flowState };

  const segLens = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = points[i].distanceTo(points[i + 1]);
    segLens.push(d);
    total += d;
  }

  let cum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = segLens[i];
    const runDist = { start: cum, end: cum + segLen };
    cum += segLen;
    const seg = buildFloorGlowSegment(points[i], points[i + 1], material, runDist);
    if (seg) group.add(seg);
  }

  if (group.children.length === 0) return null;
  return group;
}

// One flat segment between two run points, projected onto the floor plane —
// a riser's vertical jog up to a port anchor still contributes a real (if
// near-zero-length) floor segment at that point's x/z, which is harmless.
// Baked via bakeRunDistanceFromPositionZ (utility-flow.js), the same
// BoxGeometry-vertex-position bake rfWaveguide's rectangular pipe segments
// use, so run-distance is continuous across waypoints exactly like the pipe.
function buildFloorGlowSegment(p0, p1, material, runDist) {
  const a = new THREE.Vector3(p0.x, FLOOR_GLOW_Y, p0.z);
  const b = new THREE.Vector3(p1.x, FLOOR_GLOW_Y, p1.z);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return null;
  const geo = new THREE.BoxGeometry(FLOOR_GLOW_WIDTH, FLOOR_GLOW_THICKNESS, len);
  bakeRunDistanceFromPositionZ(geo, runDist.start, runDist.end);
  const mesh = new THREE.Mesh(geo, material);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  mesh.position.copy(mid);
  // The strip stays flat on the floor regardless of any grade in the run
  // above it — only a yaw around Y is needed to point its length axis along
  // the segment, never the pipe's full 3D orientation.
  const n = dir.clone().normalize();
  // Direct field assignment (not rotation.set(...)) matches the convention
  // buildFaultMark already uses in utility-line-builder-v2.js for the same
  // reason: every other Euler-rotated mesh in this renderer is set this way.
  mesh.rotation.y = Math.atan2(n.x, n.z);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export default buildFloorGlowStrip;
