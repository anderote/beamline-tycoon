// src/renderer3d/builders/port-fitting-builder.js
//
// The physical connectors on equipment: a piece of hardware bolted to the
// shell wherever a component declares a utility port.
//
// These are NOT interactive feedback. The available-port dots
// (utility-line-builder-v2.setAvailablePorts) appear only while a utility tool
// is armed and answer "what can I click right now"; fittings are always on and
// answer "what can this device be plugged into", which is a property of the
// machine and should be legible when no tool is armed at all. Without them a
// cable arrives at a blank wall of geometry.
//
// ── Why distinct shapes instead of one ────────────────────────────
// Every port used to get the same collar-and-spigot, so a cryogenic transfer
// line, an RF waveguide and a power feed were three identical grey lumps and
// the only thing distinguishing them was a tint most players never decode. A
// real hall does not look like that: the utility IS the connector. A CF flange
// with its bolt ring, a rectangular waveguide, a vacuum-jacketed bayonet and a
// conduit gland are all instantly separable at a glance, from any angle, with
// no legend. Each style below is authored to depict the connector that utility
// actually uses, in the same vocabulary the component builders use for their
// own detail — flanges, bolt rings, stiffener lips, glands.
//
// ── Why one mesh per fitting ─────────────────────────────────────────
// Fittings are always on, and a built-out hall has hundreds of them. Each style
// is therefore authored ONCE, in the local +X-facing orientation, merged into a
// single BufferGeometry and cached by style for the lifetime of the process. A
// fitting is then one THREE.Mesh sharing that geometry and a per-utility shared
// material, rotated onto the port's outward normal — one draw call each, where
// the old collar+spigot cost two, and no per-fitting geometry allocation at all.
//
// Everything stays inside roughly the old envelope (~0.075 m radius, ~0.1 m of
// projection along the normal), except the deliberately taller 0.2 m HV roof
// bushing, and stays desaturated. These are hardware detail, not UI: a hundred
// of them on screen must still read as a machine hall, not as markers.
//
// THREE is loaded as a CDN global — do NOT import it.

import { COMPONENTS } from '../../data/components.js';
import { portAnchor3D } from '../../utility/port-anchors.js';
import { portAnchorOverride } from '../../data/utility-port-anchors.js';
import { isIndoorHvRackSupport } from '../../utility/soft-cable.js';
import { UTILITY_TYPES } from '../../utility/registry.js';
import { portWaterCircuit, waterCircuitColor } from '../../utility/water-circuits.js';
import { _mergeGeometries } from '../component-builder.js';

// Envelope. Nothing below may exceed these; they are the budget that keeps a
// wall of fittings reading as texture on the machines rather than as clutter,
// and `getFittingGeometry` checks every style against them once at build time
// so a future connector can't quietly grow into a landmark. Measured per axis
// (half-extent off the port axis on Y and Z), not as a radius, so a square
// backplate is allowed its corners.
const ENVELOPE_R = 0.075;    // max half-extent off the port axis, metres
const ENVELOPE_L = 0.11;     // max projection along the outward normal, metres

// Plates bite very slightly into the shell so no sliver of floor/wall shows
// through the seam when the anchor lands a hair proud of the surface.
const EMBED = 0.004;

const _matCache = new Map();
const _geoCache = new Map();
const _flowMatCache = new Map();
const _flowGeoCache = new Map();
let _equipmentFlowGeometry = null;

function getFittingMaterial(color, style = null) {
  const key = `${style || 'utility'}:${color}`;
  if (_matCache.has(key)) return _matCache.get(key);
  const porcelain = style === 'hvInsulator';
  const materialColor = porcelain ? '#d8d2bc' : color;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(materialColor),
    roughness: porcelain ? 0.62 : 0.45,
    metalness: porcelain ? 0.08 : 0.55,
    // Just enough glow to stay readable against a dark shell, far below the
    // port markers — these are hardware, not a highlight.
    emissive: new THREE.Color(materialColor),
    emissiveIntensity: porcelain ? 0.06 : 0.18,
  });
  // The renderer's teardown path disposes any material it finds on a fitting
  // unless this flag is set; these are cached and reused across every rebuild.
  mat.userData.__shared = true;
  _matCache.set(key, mat);
  return mat;
}

// ── Physical flow arrows ────────────────────────────────────────────────
//
// A fitting already knows the port normal: local +X points away from the
// machine. Put a small arrow just above the connector in that same local frame
// and the port's role becomes readable without arming a utility tool:
//   source → points +X, away from the enclosure
//   sink   → points -X, into the enclosure; its head stays at the outer end so
//            the enclosure cannot hide the part that communicates direction
//   pass   ↔ double-headed, because either side may be the feed
// These remain depth-tested, translucent machine markings — not UI badges.

const FLOW_ARROW_Y = 0.095;
const FLOW_ARROW_INNER_X = 0.115;
const FLOW_ARROW_OUTER_X = 0.285;

function getFlowArrowMaterial(color) {
  if (_flowMatCache.has(color)) return _flowMatCache.get(color);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.14,
    roughness: 0.5,
    metalness: 0.1,
    transparent: true,
    opacity: 0.32,
    depthTest: true,
    depthWrite: false,
  });
  mat.userData.__shared = true;
  _flowMatCache.set(color, mat);
  return mat;
}

function getFlowArrowGeometry(role) {
  const normalized = role === 'source' || role === 'sink' ? role : 'pass';
  const cached = _flowGeoCache.get(normalized);
  if (cached) return cached;

  const parts = [];
  const shaftStart = normalized === 'pass' ? FLOW_ARROW_INNER_X + 0.045 : FLOW_ARROW_INNER_X;
  const shaftEnd = FLOW_ARROW_OUTER_X - 0.045;
  const shaft = new THREE.BoxGeometry(shaftEnd - shaftStart, 0.012, 0.012);
  shaft.translate((shaftStart + shaftEnd) / 2, FLOW_ARROW_Y, 0);
  parts.push(shaft);

  const addHead = (x, direction) => {
    const head = new THREE.ConeGeometry(0.029, 0.058, 6);
    // ConeGeometry points along local +Y. Rotate it onto the fitting's +X
    // axis; the sign chooses away from or toward the equipment shell.
    head.rotateZ(direction > 0 ? -Math.PI / 2 : Math.PI / 2);
    head.translate(x, FLOW_ARROW_Y, 0);
    parts.push(head);
  };
  if (normalized === 'source' || normalized === 'pass') {
    addHead(FLOW_ARROW_OUTER_X, 1);
  }
  if (normalized === 'sink') addHead(FLOW_ARROW_OUTER_X, -1);
  if (normalized === 'pass') addHead(FLOW_ARROW_INNER_X, -1);

  const merged = _mergeGeometries(parts);
  for (const part of parts) part.dispose?.();
  _flowGeoCache.set(normalized, merged);
  return merged;
}

function waterAwareColor(utilityType, waterCircuit = null) {
  const descriptor = UTILITY_TYPES[utilityType];
  if ((utilityType === 'waterSupplyPipe' || utilityType === 'coolingWater')
      && waterCircuit) return waterCircuitColor(waterCircuit, descriptor?.color || '#999999');
  return descriptor?.color || '#999999';
}

function buildFlowArrow(utilityType, role, waterCircuit = null) {
  const descriptor = UTILITY_TYPES[utilityType];
  if (descriptor?.directional === false) return null;
  // Black HV conduit is excellent scenery but an invisible arrow. Reuse its
  // authored marker colour when it has one, then fall back to line colour.
  const color = waterCircuit
    ? waterAwareColor(utilityType, waterCircuit)
    : descriptor?.markerColor || descriptor?.color || '#aaaaaa';
  const normalized = role === 'source' || role === 'sink' ? role : 'pass';
  const arrow = new THREE.Mesh(
    getFlowArrowGeometry(normalized),
    getFlowArrowMaterial(color),
  );
  arrow.userData = {
    isUtilityFlowArrow: true,
    flowRole: normalized,
    flowDirection: normalized === 'source' ? 1 : normalized === 'sink' ? -1 : 0,
    arrowheadPosition: normalized === 'pass' ? 'both' : 'outer',
    sharedGeometry: true,
  };
  return arrow;
}

/** Passive transfer fittings still have a visually meaningful named direction. */
export function portFlowArrowRole(portName, declaredRole = 'pass') {
  if (declaredRole === 'source' || declaredRole === 'sink') return declaredRole;
  if (/(^|_)in(?:_|$)/.test(portName || '')) return 'sink';
  if (/(^|_)out(?:_|$)/.test(portName || '')) return 'source';
  return 'pass';
}

function getEquipmentFlowGeometry() {
  if (_equipmentFlowGeometry) return _equipmentFlowGeometry;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.42, 0, -0.07,  0.10, 0, -0.07,  0.10, 0, -0.20,
    -0.42, 0, -0.07,  0.10, 0, -0.20,  0.48, 0, 0,
    -0.42, 0,  0.07,  0.10, 0,  0.20,  0.10, 0, 0.07,
    -0.42, 0,  0.07,  0.48, 0,  0.00,  0.10, 0, 0.20,
  ], 3));
  geometry.computeVertexNormals();
  _equipmentFlowGeometry = geometry;
  return geometry;
}

function isDirectionalEquipment(def) {
  return def?.utilityFlowPresentation !== 'symmetric'
    && (def?.wallPassThrough === true
      || /Transformer$/.test(def?.id || ''));
}

function isCableSupport(def) {
  return def?.hvCableSupport === 'outdoorPole'
    || isIndoorHvRackSupport(def);
}

function averageAnchor(entries) {
  if (entries.length === 0) return null;
  return entries.reduce((sum, entry) => ({
    x: sum.x + entry.anchor.x / entries.length,
    y: sum.y + entry.anchor.y / entries.length,
    z: sum.z + entry.anchor.z / entries.length,
  }), { x: 0, y: 0, z: 0 });
}

function buildEquipmentFlowArrow(endpoint, def, ports) {
  if (!isDirectionalEquipment(def)) return null;
  const inputs = ports.filter(port => /(^|_)in(?:_|$)/.test(port.name));
  const outputs = ports.filter(port => /(^|_)out(?:_|$)/.test(port.name));
  const from = averageAnchor(inputs);
  const to = averageAnchor(outputs);
  if (!from || !to) return null;
  let dx = to.x - from.x;
  let dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 1e-5) {
    const inOut = inputs[0].anchor.out || { x: 0, z: 0 };
    const outOut = outputs[0].anchor.out || { x: 0, z: 0 };
    dx = outOut.x - inOut.x;
    dz = outOut.z - inOut.z;
  }
  const length = Math.hypot(dx, dz);
  if (length < 1e-5) return null;
  dx /= length;
  dz /= length;

  const descriptor = UTILITY_TYPES.hvCable;
  const color = descriptor?.markerColor || descriptor?.color || '#ffd34e';
  const arrow = new THREE.Mesh(getEquipmentFlowGeometry(), getFlowArrowMaterial(color));
  arrow.position.set(
    (from.x + to.x) / 2,
    def.wallPassThrough ? (from.y + to.y) / 2 + 0.16 : 0.035,
    (from.z + to.z) / 2,
  );
  arrow.rotation.y = Math.atan2(-dz, dx);
  arrow.userData = {
    isUtilityEquipmentFlowArrow: true,
    placeableId: endpoint.id,
    fromPortNames: inputs.map(port => port.name),
    toPortNames: outputs.map(port => port.name),
    flowDirection: { x: dx, z: dz },
    sharedGeometry: true,
  };
  return arrow;
}

// ── Geometry primitives, all authored facing local +X ────────────────
//
// The shell surface is the YZ plane at x = 0 and the port's outward normal is
// +X. +Y stays up after orientation (the quaternion between two horizontal
// unit vectors is a pure spin about Y), so "up" in these builders really is up
// on the finished machine — which is what lets a junction box have a lid and a
// fibre gland have a service loop hanging below it.

/**
 * A cylinder or cone whose axis is +X. `rOut` is the radius of the end
 * furthest from the shell, `rIn` the end nearest it, `x` the centre of its run.
 * (CylinderGeometry is Y-aligned with radiusTop at +Y; a -90° spin about Z
 * carries +Y onto +X.)
 */
function _axial(rOut, rIn, len, segs, x, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rOut, rIn, len, segs);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * A slab lying flat against the shell: `t` thick along the normal, `h` tall
 * along Y, `w` wide along Z. `x` is the centre of its thickness.
 */
function _slab(t, h, w, x, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(t, h, w);
  g.translate(x, y, z);
  return g;
}

/**
 * A ring whose axis is +X — seal rings, jacket terminations, fibre coils.
 * (TorusGeometry's axis is +Z; a quarter turn about Y carries +Z onto +X.)
 */
function _ring(r, tube, x, y = 0, z = 0, radial = 6, tubular = 12) {
  const g = new THREE.TorusGeometry(r, tube, radial, tubular);
  g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * A circle of hex bolt heads standing proud of a face, in the plane of the
 * mounting flange. The single most legible "this is bolted hardware" cue we
 * have, and the same trick `component-builder._addBoltHoles` plays on the beam
 * pipe flanges.
 */
function _boltRing(out, n, circleR, headR, headL, x, phase = 0) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push(_axial(headR, headR, headL, 6, x, Math.cos(a) * circleR, Math.sin(a) * circleR));
  }
}

// ── The styles ───────────────────────────────────────────────────────

/**
 * powerCable / hvCable — a conduit gland screwed into a small junction box.
 *
 * What a power feed actually terminates in: a bolted box on the shell that the
 * armoured conduit enters through a stepped cable gland (body nut, compression
 * nut, then the cord itself). The box, not the cord, is what makes it read as
 * electrical from across the hall. HV shares the style — it is the same class
 * of hardware, just darker, and the utility's own colour carries the rest.
 */
function _stylePowerGland() {
  const parts = [];
  // Bolted backplate against the shell.
  parts.push(_slab(0.016, 0.125, 0.115, 0.004 - EMBED));
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      parts.push(_axial(0.008, 0.008, 0.008, 6, 0.016, sy * 0.048, sz * 0.043));
    }
  }
  // Box body, then a proud bolted lid — the lid seam is what makes it a box
  // rather than a block.
  parts.push(_slab(0.034, 0.098, 0.088, 0.029));
  parts.push(_slab(0.010, 0.106, 0.096, 0.051));
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      parts.push(_axial(0.006, 0.006, 0.006, 6, 0.058, sy * 0.040, sz * 0.035));
    }
  }
  // Gland stack out of the lid: hex body, compression nut, cord stub.
  parts.push(_axial(0.024, 0.024, 0.020, 6, 0.066));
  parts.push(_axial(0.019, 0.019, 0.012, 6, 0.082));
  parts.push(_axial(0.012, 0.013, 0.016, 8, 0.096));
  return parts;
}

/**
 * A compact porcelain HV roof bushing, authored along local +X.
 *
 * The broad skirts make the creepage path legible at game scale. A short base
 * flange bites into the cabinet roof and the cable lands on the capped outer
 * stud, so this reads as insulated HV hardware rather than a generic gland.
 */
function _styleHvInsulator() {
  const parts = [];
  parts.push(_axial(0.055, 0.055, 0.018, 10, 0.005 - EMBED));
  parts.push(_axial(0.026, 0.034, 0.035, 10, 0.029));
  for (const [x, radius] of [[0.057, 0.064], [0.095, 0.070], [0.133, 0.060]]) {
    parts.push(_axial(radius * 0.72, radius, 0.018, 12, x));
    parts.push(_axial(radius * 0.72, radius * 0.72, 0.020, 12, x + 0.019));
  }
  parts.push(_axial(0.024, 0.030, 0.034, 10, 0.169));
  parts.push(_axial(0.033, 0.033, 0.014, 10, 0.193));
  return parts;
}

/**
 * coolingWater — a manifold plate carrying twin supply/return hose barbs.
 *
 * Cooling is never one line: it is a flow and a return, so the connector is a
 * pair. Stacked vertically (supply over return) rather than side by side, which
 * keeps the fitting narrow against the machine's flank and reads correctly from
 * the isometric camera. Each spigot is a boss, a hex union nut and a ridged
 * barb — the stepped cones are the barb ridges a hose clamp bites onto.
 */
function _styleHoseBarbs() {
  const parts = [];
  parts.push(_slab(0.014, 0.140, 0.080, 0.003 - EMBED));
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      parts.push(_axial(0.008, 0.008, 0.008, 6, 0.014, sy * 0.056, sz * 0.026));
    }
  }
  for (const sy of [0.040, -0.040]) {
    parts.push(_axial(0.026, 0.028, 0.014, 8, 0.017, sy));   // boss
    parts.push(_axial(0.022, 0.022, 0.014, 6, 0.031, sy));   // union nut
    parts.push(_axial(0.013, 0.019, 0.015, 8, 0.0455, sy));  // barb ridge 1
    parts.push(_axial(0.013, 0.019, 0.015, 8, 0.0605, sy));  // barb ridge 2
    parts.push(_axial(0.011, 0.013, 0.010, 8, 0.073, sy));   // tip
  }
  return parts;
}

/**
 * cryoTransfer — a vacuum-jacketed bayonet.
 *
 * The one connector on this list whose whole point is that it is two pipes:
 * a fat outer jacket holding insulating vacuum, and a thin inner line carrying
 * the liquid, which runs the full length and pokes out past the jacket's
 * tapered termination. A small capped pump-out stub on top of the jacket is the
 * tell that the annulus is evacuated — the detail that separates this from a
 * plain fat pipe at a glance.
 */
function _styleCryoBayonet() {
  const parts = [];
  parts.push(_axial(0.070, 0.072, 0.014, 12, 0.003 - EMBED));
  _boltRing(parts, 6, 0.055, 0.009, 0.009, 0.0145);
  parts.push(_axial(0.046, 0.048, 0.046, 10, 0.033));   // jacket
  parts.push(_axial(0.034, 0.046, 0.014, 10, 0.063));   // jacket taper
  parts.push(_ring(0.034, 0.006, 0.070));               // jacket termination
  // Inner line — runs the whole way through and stands proud of the jacket.
  parts.push(_axial(0.015, 0.015, 0.108, 8, 0.050 - EMBED));
  parts.push(_ring(0.017, 0.005, 0.092));               // bayonet lip
  // Pump-out stub on the jacket crown (Y-aligned, so no spin needed).
  const stub = new THREE.CylinderGeometry(0.009, 0.009, 0.026, 6);
  stub.translate(0.028, 0.053, 0);
  parts.push(stub);
  const stubCap = new THREE.CylinderGeometry(0.013, 0.013, 0.006, 6);
  stubCap.translate(0.028, 0.069, 0);
  parts.push(stubCap);
  return parts;
}

/**
 * rfWaveguide — a rectangular waveguide flange with a bolt ring.
 *
 * RF at these powers does not travel in a cable, it travels in a rectangular
 * duct, and that 2:1 rectangle is the whole silhouette. Broad wall horizontal
 * so the camera looks down onto the flat of the guide. Flange plate, a raised
 * choke groove pad around the aperture, the guide run itself, and a lip at the
 * far end where the next section bolts on.
 */
function _styleWaveguideFlange() {
  const parts = [];
  parts.push(_slab(0.014, 0.100, 0.140, 0.003 - EMBED));
  // Four corner bolts plus two on the long edges — the standard flange pattern.
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      parts.push(_axial(0.009, 0.009, 0.008, 6, 0.014, sy * 0.038, sz * 0.056));
    }
    parts.push(_axial(0.009, 0.009, 0.008, 6, 0.014, sy * 0.038, 0));
  }
  parts.push(_slab(0.005, 0.058, 0.094, 0.0125));       // choke pad
  parts.push(_slab(0.058, 0.036, 0.072, 0.044));        // guide run, 2:1
  parts.push(_slab(0.008, 0.050, 0.086, 0.077));        // far-end lip
  return parts;
}

/**
 * vacuumPipe — a ConFlat flange.
 *
 * The most recognisable object in a beam hall: a thick disc with a ring of
 * heavy bolt heads and a raised knife edge biting a gasket. Repeated on every
 * beam pipe joint in `component-builder`, so a vacuum port that looks like one
 * reads as continuous with the pipework it belongs to. Behind the flange, a
 * short nipple ending in a blanked-off cap.
 */
function _styleCFFlange() {
  const parts = [];
  parts.push(_axial(0.074, 0.074, 0.016, 12, 0.004 - EMBED));
  _boltRing(parts, 6, 0.056, 0.010, 0.010, 0.017);
  parts.push(_ring(0.040, 0.005, 0.014, 0, 0, 6, 14));  // knife edge / gasket
  parts.push(_axial(0.030, 0.032, 0.048, 10, 0.036));   // nipple
  parts.push(_axial(0.040, 0.040, 0.010, 12, 0.065));   // blank flange
  parts.push(_axial(0.020, 0.022, 0.012, 8, 0.076));    // cap boss
  return parts;
}

/**
 * dataFiber — a small gland with a service loop.
 *
 * Deliberately the smallest fitting of the six: signal hardware is tiny next to
 * anything that carries power or coolant, and that size difference is itself
 * information. A compact gland with a strain-relief boot, plus the giveaway —
 * two turns of slack fibre coiled flat against the shell below it and held by a
 * tie block, because every real fibre termination has a service loop so the
 * cable can be re-terminated without re-pulling it.
 */
function _styleFiberGland() {
  const parts = [];
  parts.push(_slab(0.010, 0.072, 0.072, 0.001 - EMBED));
  for (const sy of [1, -1]) {
    parts.push(_axial(0.007, 0.007, 0.007, 6, 0.0095, sy * 0.026, 0));
  }
  parts.push(_axial(0.019, 0.020, 0.018, 6, 0.015));    // gland hex
  parts.push(_axial(0.014, 0.016, 0.010, 8, 0.029));    // dome nut
  parts.push(_axial(0.006, 0.013, 0.020, 8, 0.044));    // strain-relief boot
  // The service loop: coils lie in the plane of the shell and run up behind the
  // gland, so the fibre visibly disappears into it.
  parts.push(_ring(0.038, 0.0045, 0.006, -0.028, 0.006, 6, 14));
  parts.push(_ring(0.032, 0.0045, 0.014, -0.028, -0.004, 6, 14));
  parts.push(_slab(0.010, 0.016, 0.010, 0.008, -0.066, 0));  // tie block
  return parts;
}

/**
 * Fallback — the original collar and spigot, to the millimetre.
 *
 * Used for any utility this module has no opinion about, including a future
 * seventh type added before anyone gets round to drawing its connector. Better
 * a generic fitting than no fitting: the port still has to be visible.
 */
function _styleGenericCollar() {
  return [
    _axial(ENVELOPE_R, ENVELOPE_R, 0.025, 8, 0.0125),
    _axial(0.035, 0.035, 0.070, 8, 0.060),
  ];
}

// Utility → style. Geometry is cached per STYLE, not per utility, so hvCable
// and powerCable — the same box-and-gland hardware in different colours — cost
// one cached geometry between them.
const STYLE_OF = {
  powerCable: 'gland',
  hvCable: 'gland',
  coolingWater: 'barbs',
  waterSupplyPipe: 'cfFlange',
  cryoTransfer: 'bayonet',
  rfWaveguide: 'waveguide',
  vacuumPipe: 'cfFlange',
  dataFiber: 'fiber',
};

const STYLE_BUILDERS = {
  gland: _stylePowerGland,
  hvInsulator: _styleHvInsulator,
  barbs: _styleHoseBarbs,
  bayonet: _styleCryoBayonet,
  waveguide: _styleWaveguideFlange,
  cfFlange: _styleCFFlange,
  fiber: _styleFiberGland,
  generic: _styleGenericCollar,
};

/**
 * Once per style, at build time: shout if a connector has outgrown the budget.
 * Cheap (one bounding box on a few hundred vertices, once per process) and it
 * catches the failure mode these styles are most prone to — a detail added to
 * make one fitting read better, at the cost of every fitting in the hall.
 */
function _checkEnvelope(style, geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const lat = Math.max(Math.abs(bb.min.y), Math.abs(bb.max.y), Math.abs(bb.min.z), Math.abs(bb.max.z));
  const maxLength = style === 'hvInsulator' ? 0.205 : ENVELOPE_L;
  if (lat > ENVELOPE_R + 1e-6 || bb.max.x > maxLength + 1e-6) {
    console.warn(
      `[port-fitting] style "${style}" exceeds the fitting envelope: ` +
      `lateral ${lat.toFixed(3)}m (max ${ENVELOPE_R}), projection ${bb.max.x.toFixed(3)}m (max ${maxLength})`
    );
  }
}

/**
 * The merged, cached geometry for a utility's connector style, facing +X.
 * Built on first demand — a save with no cryo plant never pays for a bayonet.
 */
function getFittingGeometry(utilityType, styleOverride = null) {
  const style = styleOverride || STYLE_OF[utilityType] || 'generic';
  const cached = _geoCache.get(style);
  if (cached) return cached;
  const parts = (STYLE_BUILDERS[style] || _styleGenericCollar)();
  const merged = _mergeGeometries(parts);
  // The parts were never uploaded, but drop their buffers anyway rather than
  // leaving two copies of every style alive for the process lifetime.
  for (const p of parts) p.dispose?.();
  _checkEnvelope(style, merged);
  _geoCache.set(style, merged);
  return merged;
}

/**
 * One fitting: a single mesh, sharing this utility's cached style geometry and
 * cached material, stood at the anchor and spun onto the port's outward normal.
 *
 * @param {{x:number,y:number,z:number,out?:{x:number,y?:number,z:number}}} anchor
 * @param {string} utilityType key into UTILITY_TYPES; unknown → generic collar
 * @param {'source'|'sink'|'pass'} [role] direction of flow through the port
 */
export function buildPortFitting(
  anchor, utilityType, role = 'pass', flowRole = role, waterCircuit = null,
  fittingStyle = null,
) {
  const color = waterAwareColor(utilityType, waterCircuit);
  const mesh = new THREE.Mesh(
    getFittingGeometry(utilityType, fittingStyle),
    getFittingMaterial(color, fittingStyle),
  );

  const out = anchor.out || { x: 0, y: 0, z: 0 };
  // Geometry is authored along +X. Horizontal normals still produce the old
  // pure Y rotation, while exact top mounts rotate +X onto +Y.
  const axis = new THREE.Vector3(out.x || 0, out.y || 0, out.z || 0);
  if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
  else axis.normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);

  mesh.position.set(anchor.x, anchor.y, anchor.z);
  const flowArrow = buildFlowArrow(utilityType, flowRole, waterCircuit);
  if (flowArrow) mesh.add(flowArrow);
  mesh.userData = {
    isUtilityPortFitting: true,
    utilityType,
    waterCircuit,
    fittingStyle: fittingStyle || STYLE_OF[utilityType] || 'generic',
    portRole: role,
    // Shared by reference with every other fitting of this utility; teardown
    // paths must not dispose it. Same contract as component-builder's role
    // meshes.
    sharedGeometry: true,
  };
  return mesh;
}

/**
 * Every declared utility port on every endpoint, as fittings.
 *
 * @param {Array} endpoints listUtilityEndpoints(state)
 * @returns {{group: THREE.Group, count: number}}
 */
export function buildPortFittings(endpoints) {
  const group = new THREE.Group();
  group.userData = { isUtilityPortFittings: true };
  let count = 0;
  for (const ep of endpoints || []) {
    const def = COMPONENTS[ep.type];
    if (!def || !def.ports) continue;
    const endpointPorts = [];
    for (const [name, spec] of Object.entries(def.ports)) {
      if (!spec || !spec.utility) continue;
      const anchor = portAnchor3D(ep, def, name);
      if (!anchor) continue;
      const fitting = buildPortFitting(
        anchor, spec.utility, spec.role,
        isCableSupport(def) || def.utilityFlowPresentation === 'symmetric'
          ? 'pass' : spec.flowRole || portFlowArrowRole(name, spec.role),
        portWaterCircuit(spec),
        portAnchorOverride(ep.type, name)?.fittingStyle || null);
      fitting.userData.placeableId = ep.id;
      fitting.userData.portName = name;
      group.add(fitting);
      endpointPorts.push({ name, spec, anchor });
      count++;
    }
    const equipmentArrow = buildEquipmentFlowArrow(ep, def, endpointPorts);
    if (equipmentArrow) group.add(equipmentArrow);
  }
  return { group, count };
}

/**
 * Signature over what the fittings depend on — endpoint identity, type, pose.
 * Anything else about the world can change without touching them.
 */
export function portFittingSignature(endpoints) {
  const parts = [];
  for (const ep of endpoints || []) {
    const def = COMPONENTS[ep.type];
    if (!def || !def.ports) continue;
    if (!Object.values(def.ports).some(s => s && s.utility)) continue;
    const wall = ep.wallMount
      ? `${ep.wallMount.edge || ''},${ep.wallMount.off || 0},${ep.wallMount.span || 0},${ep.wallMount.faceOffset || 0}` : '';
    parts.push(`${ep.id}:${ep.type}:${ep.col},${ep.row},${ep.subCol || 0},${ep.subRow || 0},${ep.dir || 0},${ep.portsFlipped ? 1 : 0},${wall}`);
  }
  return parts.join(';');
}

export default buildPortFittings;
