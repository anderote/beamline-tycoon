// src/renderer3d/utility-flow.js
//
// Energy visibly moving through utility runs. Each utility pulses in its own
// colour and rhythm — a repeating soft band applied to the pipe's material,
// via onBeforeCompile, in the utility's own colour. Gated on
// whatever getLineMaterial's caller already knows about network health
// (ok/soft/hard from utility-line-builder-v2._buildErrorMap): a hard fault
// stops the pipe from carrying anything. Motion is the line-level delivery
// signal; port glyphs and hover text carry the actionable diagnosis.
//
// THREE is loaded as a CDN global (src/three-global.js) — do NOT import it.

import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { min, mix, mod, sin, smoothstep, uniform, uv } from 'three/tsl';

// ---- Per-utility motion --------------------------------------------------
//
// One table — the whole feel is tunable here. Units: bakeRunDistanceUVs (below)
// writes ABSOLUTE run distance in metres into uv.y, not a 0..1 fraction, so
// `speed` is metres/second and `period`/`width` are metres of pipe.
//
// `color` is the moving surface band's tint. Emissive flows normally use the
// utility's own descriptor colour (UTILITY_TYPES[type].color). Utility flow is
// deliberately line-only: no utility publishes a separate travelling crest
// shape. Electrical cables are the exception only in shading — their visible
// flow is an albedo variation rather than emissive output. Their bounded,
// invisible moving point-light proxy can still cast restrained nearby light.
// The surface variation needs an explicit lighter target colour so the two
// differently black electrical jackets can visibly change at all.
//
// `#8f94c8` remains a dim, desaturated blue-violet so HV reads differently
// from ordinary branch power.
//
export const FLOW_PARAMS = {
  hvCable: {
    // Isolated violet surface bands drift along the feeder. Their wide spacing
    // keeps long HV trunks from becoming rows of moving light points.
    speed: 0.72, period: 12.0, width: 0.48, strength: 1.60, baseGlow: 0.045,
    color: '#8f94c8',
    emissive: false,
    lightIntensity: 0.28, lightDistance: 2.05, daylightFloor: 0.34,
  },
  powerCable: {
    // Sparse green surface gradients move over the charcoal branch jacket at
    // a deliberate crawl. A typical run shows one or two travelling
    // highlights instead of a tightly packed train of glowing points.
    speed: 0.48, period: 3.2, width: 0.30, strength: 1.12, baseGlow: 0.09,
    color: '#9be39b',
    emissive: false,
    lightIntensity: 0.16, lightDistance: 1.5, daylightFloor: 0.26,
  },
  vacuumPipe: {
    // Gas load drifts from beam chambers toward the pump. Kept restrained so
    // a vacuum header reads as molecular flow in pipework, not another power
    // cable; direction is inverted in UtilityLineBuilderV2, not in the shader.
    // Only the pipe's emissive band and bounded light proxy communicate flow.
    speed: 0.30, period: 3.8, width: 0.78, strength: 0.46, baseGlow: 0.018,
    color: '#aebbc2',
    lightIntensity: 0.055, lightDistance: 0.9, daylightFloor: 0.12,
  },
  rfWaveguide: {
    // The moving field itself is the light source. Long, closely spaced red
    // gradients make the guide read as an energized field instead of a train
    // of fast sparks; the deliberately slow travel keeps that motion legible.
    speed: 0.95, period: 0.62, width: 0.24, strength: 1.75, baseGlow: 0.11,
    lightIntensity: 0.30, lightDistance: 2.15, daylightFloor: 0.28,
  },
  coolingWater: {
    // The reference treatment: a broad, slow band whose neighbours nearly
    // merge into a steady flowing gradient.
    speed: 0.62, period: 2.6, width: 0.72, strength: 0.82, baseGlow: 0.075,
    lightIntensity: 0.10, lightDistance: 1.35, daylightFloor: 0.18,
  },
  waterSupplyPipe: {
    speed: 0.48, period: 3.1, width: 0.82, strength: 0.62, baseGlow: 0.045,
    lightIntensity: 0.075, lightDistance: 1.1, daylightFloor: 0.14,
  },
  cryoTransfer: {
    // A restrained cold sheen drifts over the stainless vacuum vessel. The
    // obvious cold cues are localized at bayonets and bellows by the cryostat
    // builder, so the insulated straight jacket should never glow like hose.
    speed: 0.16, period: 4.8, width: 1.35, strength: 0.30, baseGlow: 0.055,
    lightIntensity: 0.075, lightDistance: 1.15, daylightFloor: 0.2,
  },
  dataFiber: {
    // Broad white packets travel both ways at once: Ethernet is peer traffic,
    // not a source-to-sink service. Keep the cadence slow enough to read as
    // traffic rather than rapid flashing, while remaining the fastest utility
    // surface flow. Fibre stays intentionally lightless.
    speed: 1.6, period: 1.4, width: 0.16, strength: 1.0, baseGlow: 0.025,
    bidirectional: true, light: false,
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
// as healthy. 'hard' zeroes everything for a faulted network; 'off' does the
// same for a healthy-looking line whose source is not actually energized.
// Both need no separate shader path: uStrength/uBaseGlow at 0 means the added
// term is 0.
const FLOW_STATE_MODS = {
  ok:   { speedMul: 1, strengthMul: 1,    baseGlowMul: 1,   stutter: 0 },
  soft: { speedMul: 1, strengthMul: 0.4,  baseGlowMul: 0.5, stutter: 1 },
  hard: { speedMul: 0, strengthMul: 0,    baseGlowMul: 0,   stutter: 0 },
  off:  { speedMul: 0, strengthMul: 0,    baseGlowMul: 0,   stutter: 0 },
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
 * `flowState` ('ok' | 'soft' | 'hard' | 'off'). A no-op — returns `material`
 * untouched — when the utility has no flow (FLOW_PARAMS[utilityType] is
 * null/undefined, e.g. vacuumPipe).
 *
 * Emissive utilities add to totalEmissiveRadiance. Electrical cables instead
 * blend the lit surface colour toward their flow tint, preserving the motion
 * cue without bloom or emitted light.
 */
export function patchFlowMaterial(material, utilityType, flowState, colorOverride = null) {
  const params = FLOW_PARAMS[utilityType];
  if (!params) return material;
  const mods = FLOW_STATE_MODS[flowState] || FLOW_STATE_MODS.ok;
  const colorHex = colorOverride || params.color
    || (UTILITY_TYPES[utilityType] && UTILITY_TYPES[utilityType].color) || '#ffffff';

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

  // Node-renderer equivalent of the GLSL patch below. Both paths reference
  // the same value objects, and tickFlow advances both representations, so
  // the legacy rollback and WebGPU renderer remain visually synchronized.
  for (const entry of Object.values(uniforms)) entry.node = uniform(entry.value);
  const flowDist = uv().y;
  const flowCycle = mod(
    flowDist.sub(uniforms.uTime.node.mul(uniforms.uSpeed.node)),
    uniforms.uPeriod.node,
  );
  const flowEdge = min(flowCycle, uniforms.uPeriod.node.sub(flowCycle));
  let flowPulse = smoothstep(0, uniforms.uWidth.node, flowEdge).oneMinus();
  if (params.bidirectional) {
    const reverseCycle = mod(
      flowDist.add(uniforms.uTime.node.mul(uniforms.uSpeed.node)),
      uniforms.uPeriod.node,
    );
    const reverseEdge = min(reverseCycle, uniforms.uPeriod.node.sub(reverseCycle));
    const reversePulse = smoothstep(0, uniforms.uWidth.node, reverseEdge).oneMinus();
    flowPulse = min(flowPulse.add(reversePulse), 1);
  }
  const flowThrum = sin(uniforms.uTime.node.mul(6)).mul(0.5).add(0.5)
    .mul(0.28).add(0.72);
  const flowGate = uniforms.uStutter.node.greaterThan(0.5).select(flowThrum, 1);
  const flowAmount = uniforms.uBaseGlow.node.add(
    uniforms.uStrength.node.mul(flowPulse).mul(flowGate),
  );
  if (params.emissive === false) {
    material.colorNode = mix(
      uniform(material.color), uniforms.uFlowColor.node, min(flowAmount, 1),
    );
  } else {
    material.emissiveNode = uniforms.uFlowColor.node.mul(flowAmount);
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // vFlowDist rides in on its own varying rather than reusing three's own
    // vUv — that varying only exists when USE_UV (or an actual map) is
    // defined, and none of these materials use a map.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFlowDist;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvFlowDist = uv.y;');

    const flowLines = [
      'float flowCycle = mod( vFlowDist - uTime * uSpeed, uPeriod );',
      'float flowEdge = min( flowCycle, uPeriod - flowCycle );',
      'float flowPulse = 1.0 - smoothstep( 0.0, uWidth, flowEdge );',
      ...(params.bidirectional ? [
        'float reverseCycle = mod( vFlowDist + uTime * uSpeed, uPeriod );',
        'float reverseEdge = min( reverseCycle, uPeriod - reverseCycle );',
        'float reversePulse = 1.0 - smoothstep( 0.0, uWidth, reverseEdge );',
        'flowPulse = min( 1.0, flowPulse + reversePulse );',
      ] : []),
      // A soft fault thrums instead of square-wave blinking. The red fault
      // mark still communicates the problem; motion stays readable.
      'float flowThrum = 0.72 + 0.28 * ( 0.5 + 0.5 * sin( uTime * 6.0 ) );',
      'float flowGate = uStutter > 0.5 ? flowThrum : 1.0;',
      params.emissive === false
        ? 'diffuseColor.rgb = mix( diffuseColor.rgb, uFlowColor, clamp( uBaseGlow + uStrength * flowPulse * flowGate, 0.0, 1.0 ) );'
        : 'totalEmissiveRadiance += uFlowColor * ( uBaseGlow + uStrength * flowPulse * flowGate );',
    ];
    const flowAnchor = params.emissive === false
      ? '#include <color_fragment>' : '#include <emissivemap_fragment>';
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
      .replace(flowAnchor, [flowAnchor, ...flowLines].join('\n'));
  };

  // Keep the flow tint in the cache key as well as the shader structure.
  // WebGPU shares a NodeBuilderState (including the uniform bindings cloned
  // from the first material) between equal material cache keys. Cold and hot
  // water use the same utility type and flow state, so omitting colorHex made
  // whichever circuit compiled second inherit the first circuit's moving
  // glow even though its body material still had the correct colour.
  material.customProgramCacheKey = () => `flow:${utilityType}:${flowState}:${colorHex}`;
  material.userData.flowUniforms = uniforms;
  _patchedMaterials.add(material);
  return material;
}

/** Advance uTime on every patched material by the frame delta. */
export function tickFlow(dtSeconds) {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  for (const mat of _patchedMaterials) {
    const u = mat.userData && mat.userData.flowUniforms;
    if (u && u.uTime) {
      u.uTime.value += dtSeconds;
      if (u.uTime.node) u.uTime.node.value = u.uTime.value;
    }
  }
}
