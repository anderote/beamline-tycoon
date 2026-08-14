// src/renderer3d/utility-flow.js
//
// Energy visibly moving through utility runs. Each utility pulses in its own
// colour and rhythm — a repeating soft band added on top of the pipe's normal
// PBR shading, via onBeforeCompile, in the utility's own colour. Gated on
// whatever getLineMaterial's caller already knows about network health
// (ok/soft/hard from utility-line-builder-v2._buildErrorMap): a hard fault
// doesn't just draw an X over the pipe, it stops the pipe from carrying
// anything — the motion IS the "is this network actually delivering" signal.
//
// THREE is loaded as a CDN global (src/three-global.js) — do NOT import it.

import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';

// ---- Per-utility motion --------------------------------------------------
//
// One table — the whole feel is tunable here. Units: bakeRunDistanceUVs (below)
// writes ABSOLUTE run distance in metres into uv.y, not a 0..1 fraction, so
// `speed` is metres/second and `period`/`width` are metres of pipe.
//
// `color` is the pulse's own emissive tint — deliberately the utility's own
// descriptor colour (UTILITY_TYPES[type].color) in every case but one: an
// emissive term is a multiply against that colour, and hvCable's descriptor
// colour is #141418 (near-black by design — see hvCable.js's "has to look
// like trunk" comment), which stays invisible no matter how hard you push the
// emissive strength.
//
// AUTHORIZED EXCEPTION — hvCable's `color` below is NOT powerCable's tint and
// is NOT a free pick: it's a deliberate, ruled-on departure from "pulse = the
// pipe's own colour", scoped to this one utility because that rule has no
// answer for a genuinely near-black base. `#8f94c8` is a dim, desaturated
// blue-violet — the colour of corona/arc discharge around a live HV
// conductor (ionised-air emission reads blue-violet, not white or green), so
// it still says "this conductor is live and dangerous" in the same grounded
// register as every other utility's pulse, rather than an arbitrary neon
// accent standing in for an unglowable black.
//
// vacuumPipe is explicitly `null`: inert grey, no flow, nothing to tune.
export const FLOW_PARAMS = {
  hvCable: {
    speed: 0.65, period: 5.0, width: 3.5, strength: 1.15, baseGlow: 0.12,
    color: '#8f94c8',
  },
  powerCable: {
    speed: 0.65, period: 5.0, width: 3.5, strength: 1.15, baseGlow: 0.12,
  },
  vacuumPipe: null,
  rfWaveguide: {
    // Broad enough to grade smoothly like cooling water, with a slightly
    // shorter repeat so RF retains some character without visibly flashing.
    speed: 0.65, period: 3.0, width: 2.1, strength: 1.15, baseGlow: 0.12,
  },
  coolingWater: {
    // The reference treatment: a broad, slow band whose neighbours nearly
    // merge into a steady flowing gradient.
    speed: 0.55, period: 5.0, width: 3.5, strength: 1.1, baseGlow: 0.12,
  },
  cryoTransfer: {
    // Very slow drift plus a small always-on baseGlow — the "faint constant
    // frost glow" the brief calls for. Applied to both the core AND the
    // jacket material (see getJacketMaterial in utility-line-builder-v2.js):
    // frost forms on the OUTER jacket of a real cryo line, so the jacket
    // carrying its own baseGlow instead of just occluding the core's is the
    // physically-motivated fix, not just the convenient one.
    speed: 0.2, period: 6.0, width: 4.2, strength: 0.9, baseGlow: 0.28,
  },
  dataFiber: {
    // Still the quickest utility, but a soft travelling wash rather than blips.
    speed: 0.9, period: 4.0, width: 2.4, strength: 1.0, baseGlow: 0.08,
  },
};

for (const t of UTILITY_TYPE_LIST) {
  if (!(t in FLOW_PARAMS)) {
    // Fail loud in dev rather than silently rendering a new utility inert —
    // this is exactly the "new 8th utility" gap the tests guard against.
    console.warn(`[utility-flow] FLOW_PARAMS has no entry for utility type "${t}"`);
  }
}

// Per-flowState modifiers, applied to the base FLOW_PARAMS entry at patch
// time. 'ok' is the table above verbatim. 'soft' stutters and dims — a
// network that's delivering but over capacity should read as struggling, not
// as healthy. 'hard' zeroes everything: no pulses, unlit pipe, exactly like
// the acceptance criteria asks for, and it needs no separate code path in the
// shader — uStrength/uBaseGlow at 0 means the added term is 0.
const FLOW_STATE_MODS = {
  ok:   { speedMul: 1, strengthMul: 1,    baseGlowMul: 1,   stutter: 0 },
  soft: { speedMul: 1, strengthMul: 0.4,  baseGlowMul: 0.5, stutter: 1 },
  hard: { speedMul: 0, strengthMul: 0,    baseGlowMul: 0,   stutter: 0 },
};

// ---- Run-distance UVs -----------------------------------------------------
//
// CylinderGeometry generates uv.y = 0 at its local -Y end and 1 at its local
// +Y end (three's own CylinderGeometry.js: `uvs.push(u, 1 - v)` with v=0 at
// the top/+Y row). buildCylinderSegment (utility-line-builder-v2.js) rotates
// local +Y to point from p0 toward p1 via setFromUnitVectors(up, dir), so as
// generated, uv.y already runs 0 at p0 → 1 at p1 for a single segment — and
// buildWorldPoints walks line.start → line.end, so p0→p1 is already
// source→sink. bakeRunDistanceUVs only has to rescale that per-segment 0..1
// into the segment's absolute [distStart, distEnd] window along the whole
// polyline, preserving orientation, so uv.y is continuous across segment
// joins instead of resetting to 0..1 at every waypoint.
//
// Scoped to CYLINDER segments: rewrites the geometry's own EXISTING uv.y (0
// at p0, 1 at p1) into the absolute window. That existing-uv.y approach
// doesn't carry over to rfWaveguide's rectangular (BoxGeometry) segments —
// three's BoxGeometry doesn't have the cylinder's property that uv.y alone
// tracks the length axis: its side faces track length on OPPOSITE uv
// components (px/nx via u, py/ny via v) and the two end caps don't track it
// at all (see BoxGeometry.js's buildPlane calls) — so rect segments use
// bakeRunDistanceFromPositionZ below instead, which sidesteps uv entirely.
export function bakeRunDistanceUVs(geometry, distStart, distEnd) {
  const uv = geometry && geometry.attributes && geometry.attributes.uv;
  if (!uv || !uv.array) return geometry;
  const arr = uv.array;
  const span = distEnd - distStart;
  for (let i = 1; i < arr.length; i += 2) {
    arr[i] = distStart + arr[i] * span;
  }
  uv.needsUpdate = true;
  return geometry;
}

// Same job as bakeRunDistanceUVs — bakes an absolute [distStart, distEnd]
// run-distance into the uv.y channel a flow-patched shader reads
// (patchFlowMaterial's `vFlowDist = uv.y`) — but for BoxGeometry (rfWaveguide's
// rectangular segments), sourced from vertex POSITION rather than the
// geometry's native uv.
//
// buildRectSegment builds `new THREE.BoxGeometry(width, height, len)` with
// its length along local Z, then rotates local +Z to point from p0 toward p1
// (setFromUnitVectors(forward, dir)) — the exact same "local axis becomes the
// segment direction" pattern buildCylinderSegment uses for local Y. Unlike
// uv.y, a BoxGeometry vertex's local Z component is monotonic along the
// length axis and means the same thing on EVERY one of the 6 faces: the two
// end caps (pz/nz) sit at a single fixed z = ±depth/2 each, and the four side
// faces (px/nx/py/ny, one row per end at the default depthSegments=1) span
// exactly the same -depth/2..+depth/2 range. So instead of fighting uv's
// per-face inconsistency, this reads position.z straight off the untransformed
// vertex (available in the vertex shader as `position`, before any matrix)
// and writes the resulting absolute distance into the SAME uv.y channel the
// shared shader code already reads — no shader changes needed, just a
// different source for what gets baked in.
export function bakeRunDistanceFromPositionZ(geometry, distStart, distEnd) {
  const pos = geometry && geometry.attributes && geometry.attributes.position;
  const uv = geometry && geometry.attributes && geometry.attributes.uv;
  if (!pos || !pos.array || !uv || !uv.array) return geometry;
  const depth = geometry.parameters && geometry.parameters.depth;
  const halfLen = Number.isFinite(depth) ? depth / 2 : 0;
  if (halfLen <= 0) return geometry;
  const posArr = pos.array;
  const uvArr = uv.array;
  const span = distEnd - distStart;
  const vertCount = Math.min(Math.floor(posArr.length / 3), Math.floor(uvArr.length / 2));
  for (let i = 0; i < vertCount; i++) {
    const z = posArr[i * 3 + 2];
    const t = (z + halfLen) / (2 * halfLen); // 0 at p0/start side, 1 at p1/end side
    uvArr[i * 2 + 1] = distStart + t * span;
  }
  uv.needsUpdate = true;
  return geometry;
}

// ---- The shader patch -----------------------------------------------------
//
// Materials patched here are tracked so tickFlow can advance uTime on all of
// them without the caller keeping its own list. Shared materials (see
// utility-line-builder-v2.js's `shared()`) live for the process lifetime, so
// this set only grows — same lifetime as the module-level material caches it
// mirrors, not a new leak.
const _patchedMaterials = new Set();

/**
 * Install the flow pulse on `material` (a MeshStandardMaterial) via
 * onBeforeCompile, in `utilityType`'s colour and rhythm (FLOW_PARAMS) at
 * `flowState` ('ok' | 'soft' | 'hard'). A no-op — returns `material`
 * untouched — when the utility has no flow (FLOW_PARAMS[utilityType] is
 * null/undefined, e.g. vacuumPipe).
 *
 * Adds to totalEmissiveRadiance; never touches material.emissive/.color, so
 * it composes with the "a line's colour is its utility, always and only"
 * rule above getLineMaterial rather than fighting it.
 */
export function patchFlowMaterial(material, utilityType, flowState) {
  const params = FLOW_PARAMS[utilityType];
  if (!params) return material;
  const mods = FLOW_STATE_MODS[flowState] || FLOW_STATE_MODS.ok;
  const colorHex = params.color || (UTILITY_TYPES[utilityType] && UTILITY_TYPES[utilityType].color) || '#ffffff';

  const uniforms = {
    uTime:      { value: 0 },
    uSpeed:     { value: params.speed * mods.speedMul },
    uPeriod:    { value: Math.max(params.period, 1e-3) },
    uWidth:     { value: Math.max(params.width, 1e-3) },
    uStrength:  { value: params.strength * mods.strengthMul },
    uBaseGlow:  { value: (params.baseGlow || 0) * mods.baseGlowMul },
    uStutter:   { value: mods.stutter },
    // `new THREE.Color(hexString)` already does the sRGB->linear conversion
    // here — Color.set() routes a string through setStyle(), which defaults
    // colorSpace to SRGBColorSpace and calls
    // ColorManagement.toWorkingColorSpace (node_modules/three/src/math/
    // Color.js:74-112): the SAME mechanism `material.emissive = colorHex`
    // goes through (Material.js's setValues special-cases an existing Color
    // property and calls `.set()` on it rather than replacing it). This is
    // NOT the "raw uniform value uploaded as-is" footgun — that only bites
    // when a colour is built WITHOUT going through Color.set/setHex/setStyle
    // (e.g. a bare {r,g,b} literal or an array). Verified empirically, not
    // just read from source: `new THREE.Color('#40e0ff').r/.g/.b` reproduces
    // component-builder.js's documented linear luma (0.567) for that exact
    // hex to 3 decimal places (see task-4-report.md's fix-round notes).
    uFlowColor: { value: new THREE.Color(colorHex) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // vFlowDist rides in on its own varying rather than reusing three's own
    // vUv — that varying only exists when USE_UV (or an actual map) is
    // defined, and none of these materials use a map.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFlowDist;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvFlowDist = uv.y;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying float vFlowDist;',
        'uniform float uTime;',
        'uniform float uSpeed;',
        'uniform float uPeriod;',
        'uniform float uWidth;',
        'uniform float uStrength;',
        'uniform float uBaseGlow;',
        'uniform float uStutter;',
        'uniform vec3 uFlowColor;',
      ].join('\n'))
      // Placed right after emissivemap_fragment: totalEmissiveRadiance is in
      // scope there and this is purely additive over it, never a replacement.
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        'float flowCycle = mod( vFlowDist - uTime * uSpeed, uPeriod );',
        'float flowEdge = min( flowCycle, uPeriod - flowCycle );',
        'float flowPulse = 1.0 - smoothstep( 0.0, uWidth, flowEdge );',
        'float flowGate = uStutter > 0.5 ? step( 0.5, fract( uTime * 2.2 ) ) : 1.0;',
        'totalEmissiveRadiance += uFlowColor * ( uBaseGlow + uStrength * flowPulse * flowGate );',
      ].join('\n'));
  };

  // Without this, three's program cache can key two structurally-identical
  // MeshStandardMaterials (same maps/defines — true of every utility's line
  // material here) to the SAME compiled program and skip calling
  // onBeforeCompile on the second one entirely, silently dropping its motion.
  material.customProgramCacheKey = () => `flow:${utilityType}:${flowState}`;
  material.userData.flowUniforms = uniforms;
  _patchedMaterials.add(material);
  return material;
}

/** Advance uTime on every patched material by the frame delta. */
export function tickFlow(dtSeconds) {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  for (const mat of _patchedMaterials) {
    const u = mat.userData && mat.userData.flowUniforms;
    if (u && u.uTime) u.uTime.value += dtSeconds;
  }
}
