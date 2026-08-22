// test/test-utility-flow.js — energy flow on utility lines
// (src/renderer3d/utility-flow.js + the getLineMaterial/buildLineGroup wiring
// in src/renderer3d/utility-line-builder-v2.js).
//
// Covers what can't be seen by eye headlessly:
//   1. bakeRunDistanceUVs rescales a segment's own 0..1 uv.y into an absolute
//      [distStart, distEnd] window, in isolation.
//   2. Built through a real multi-leg rigid cylinder line (vacuumPipe), that
//      rescaling is CONTINUOUS across segment boundaries (no reset-to-0 at a
//      waypoint) and oriented source (line.start) -> sink (line.end).
//   2b. Same continuity/orientation check for rfWaveguide's rectangular
//      (BoxGeometry) segments via bakeRunDistanceFromPositionZ — this is the
//      one that was WRONG in an earlier round: rect segments briefly shipped
//      with no run-distance bake at all, which meant no real travelling
//      direction, just a synchronized blink. This test exists specifically
//      so that regresses loudly rather than silently.
//   3. FLOW_PARAMS covers every utility, including vacuum gas-to-pump motion.
//   4. getLineMaterial returns distinct cached materials per
//      (utilityType, flowState), the same instance on repeat calls, and every
//      one tagged __shared.
//
// THREE is a CDN global in the browser; stubbed here (pattern lifted from
// test/test-utility-line-fault-mark.js) so this stays headless. The
// CylinderGeometry stub reproduces three's actual generateTorso() uv layout
// closely enough to exercise the real bakeRunDistanceUVs — two rows, first
// row (local +Y / p1 side) at uv.y=1, second row (local -Y / p0 side) at
// uv.y=0 — see utility-flow.js's doc comment for why that's the geometry
// bakeRunDistanceUVs assumes. The BoxGeometry stub is checked against real
// three (node_modules/three, not the game's stub): `new THREE.BoxGeometry(w,
// h, len).attributes.position.array` has exactly 24 vertices whose z
// component (the length axis here) takes ONLY the two values ±len/2,
// regardless of which of the 6 faces a vertex belongs to — verified with a
// throwaway `node -e` script against the real package before writing this
// stub, not assumed from reading source alone.

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addVectors(a, b) { return this.set(a.x + b.x, a.y + b.y, a.z + b.z); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
}
class Obj3 {
  constructor() {
    this.children = []; this.userData = {};
    this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0 };
    this.quaternion = { copy() {} }; this.scale = new V3(1, 1, 1);
    this.layers = { mask: 1, enable(n) { this.mask |= (1 << n); }, test() { return true; } };
  }
  add(c) { this.children.push(c); }
  remove(c) {
    const i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
  }
  traverse(fn) { fn(this); for (const c of this.children) (c.traverse ? c.traverse(fn) : fn(c)); }
  updateMatrix() {}
}

// Reproduces three's CylinderGeometry uv layout for the default
// heightSegments=1 case used by buildCylinderSegment: row y=0 (v=0, top,
// local +Y) gets uv.y = 1; row y=1 (v=1, bottom, local -Y) gets uv.y = 0.
class CylinderGeometry {
  constructor(radiusTop, radiusBottom, height, radialSegments = 8) {
    this.parameters = { radiusTop, radiusBottom, height, radialSegments };
    const rs = radialSegments;
    const uvs = [];
    for (let y = 0; y <= 1; y++) {
      const v = y;
      const uvY = 1 - v;
      for (let x = 0; x <= rs; x++) uvs.push(x / rs, uvY);
    }
    this.attributes = { uv: { array: new Float32Array(uvs), needsUpdate: false } };
  }
  dispose() {}
}

// Reproduces the one invariant bakeRunDistanceFromPositionZ relies on: 24
// vertices (BoxGeometry's default-segments count), z alternating between the
// two length-extents ±depth/2. Confirmed against real three above — which
// face a vertex belongs to doesn't matter, only z does.
class BoxGeometry {
  constructor(width, height, depth) {
    this.parameters = { width, height, depth, widthSegments: 1, heightSegments: 1, depthSegments: 1 };
    const halfLen = depth / 2;
    const position = [];
    const uv = [];
    for (let i = 0; i < 24; i++) {
      const z = (i % 2 === 0) ? -halfLen : halfLen;
      position.push(0, 0, z);
      uv.push(0, 0); // native uv is irrelevant here — the bake overwrites it
    }
    this.attributes = {
      position: { array: new Float32Array(position), needsUpdate: false },
      uv: { array: new Float32Array(uv), needsUpdate: false },
    };
  }
  dispose() {}
}

globalThis.THREE = {
  Vector3: V3,
  Color: class { constructor(c) { this.c = c; } multiplyScalar(s) { this.scale = s; return this; } },
  Quaternion: class { setFromUnitVectors() { return this; } },
  Group: Obj3,
  Mesh: class extends Obj3 { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } },
  MeshStandardMaterial: class { constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; } dispose() {} },
  MeshBasicMaterial: class { constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; } dispose() {} },
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry: class { constructor(...a) { this.args = a; } dispose() {} },
  TorusGeometry: class { constructor(...a) { this.args = a; } dispose() {} },
};

const { getLineMaterial, UtilityLineBuilderV2 } =
  await import('../src/renderer3d/utility-line-builder-v2.js');
const { FLOW_PARAMS, bakeRunDistanceUVs, bakeRunDistanceFromPositionZ } =
  await import('../src/renderer3d/utility-flow.js');
const { UTILITY_TYPES, UTILITY_TYPE_LIST } = await import('../src/utility/registry.js');
// Pure topology, no THREE — computeLineOrientations never touches the stub.
const { computeLineOrientations } = await import('../src/utility/line-orientation.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('\n--- 1. bakeRunDistanceUVs rescales in isolation ---');
{
  // Two "rows" worth of uv.y, as a cylinder segment would carry: 1 (p1 side)
  // then 0 (p0 side), each x3 verts for good measure.
  const fakeGeo = {
    attributes: {
      uv: { array: new Float32Array([0, 1, 0.5, 1, 1, 1, 0, 0, 0.5, 0, 1, 0]), needsUpdate: false },
    },
  };
  bakeRunDistanceUVs(fakeGeo, 10, 16);
  const arr = fakeGeo.attributes.uv.array;
  assert(fakeGeo.attributes.uv.needsUpdate === true, 'flags the attribute dirty');
  assert(arr[1] === 16 && arr[3] === 16 && arr[5] === 16,
    `uv.y=1 (p1/end side) becomes distEnd=16 (got ${arr[1]},${arr[3]},${arr[5]})`);
  assert(arr[7] === 10 && arr[9] === 10 && arr[11] === 10,
    `uv.y=0 (p0/start side) becomes distStart=10 (got ${arr[7]},${arr[9]},${arr[11]})`);
  assert(arr[0] === 0 && arr[2] === 0.5 && arr[4] === 1,
    'uv.x (radial coordinate) is untouched');
}

console.log('\n--- 1b. bakeRunDistanceFromPositionZ rescales in isolation ---');
{
  const halfLen = 2.5; // depth = 5
  const fakeGeo = {
    parameters: { depth: 2 * halfLen },
    attributes: {
      position: { array: new Float32Array([0, 0, -halfLen, 1, 1, halfLen, 2, 2, -halfLen]), needsUpdate: false },
      uv: { array: new Float32Array([9, 9, 9, 9, 9, 9]), needsUpdate: false },
    },
  };
  bakeRunDistanceFromPositionZ(fakeGeo, 20, 26);
  const uv = fakeGeo.attributes.uv.array;
  assert(fakeGeo.attributes.uv.needsUpdate === true, 'flags the uv attribute dirty');
  assert(uv[1] === 20, `z=-halfLen (p0/start side) becomes distStart=20 (got ${uv[1]})`);
  assert(uv[3] === 26, `z=+halfLen (p1/end side) becomes distEnd=26 (got ${uv[3]})`);
  assert(uv[5] === 20, `a second z=-halfLen vertex also becomes distStart (got ${uv[5]})`);
}

// A three-waypoint, two-segment powered run: (0,0) -> (3,0) -> (3,4), both
// ends open so buildWorldPoints emits the path verbatim (no port risers).
// World coords are tile*2: (0,0)->(6,0)->(6,8). Segment lengths: 6 and 8.
function buildFlowLine(utilityType) {
  const line = {
    id: 'ul_flow', utilityType, start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 3, row: 4 }],
  };
  const builder = new UtilityLineBuilderV2();
  const parent = new Obj3();
  const lines = new Map([[line.id, line]]);
  builder.build(lines, new Map(), parent, { state: {} });
  return { group: parent.children[0] };
}

function cylinderMeshes(group) {
  const out = [];
  const walk = (o) => {
    if (o.isMesh && o.geometry instanceof CylinderGeometry) out.push(o);
    for (const c of o.children || []) walk(c);
  };
  walk(group);
  return out;
}

// RF joints and support hardware are BoxGeometry too. The builder publishes
// the traversable-run role explicitly so this contract does not depend on the
// current decorative geometry.
function boxMeshes(group) {
  const out = [];
  const walk = (o) => {
    if (o.isMesh
      && o.geometry instanceof BoxGeometry
      && o.userData?.isUtilityLineSegment) out.push(o);
    for (const c of o.children || []) walk(c);
  };
  walk(group);
  return out;
}

console.log('\n--- 2. Continuous across segment boundaries, source -> sink ---');
{
  const { group } = buildFlowLine('vacuumPipe');
  const effect = group.userData.visualEffects?.[0];
  assert(effect?.kind === 'pathPulse', 'the builder publishes a declarative path-pulse effect');
  assert(effect?.crest === false,
    'vacuum flow keeps its moving light but publishes no visible crest object');
  assert(effect?.groundSpill === false,
    'utility pulses do not paint repeating circular glows on the floor');
  assert(effect?.path?.length === 3, 'the effect receives the same complete polyline as the pipe');
  assert(!group.children.some((child) => child.userData?.isFloorGlowStrip),
    'the geometry builder allocates no light-field or spill objects itself');
  const meshes = cylinderMeshes(group);
  assert(meshes.length === 2, `two cylinder segments built (got ${meshes.length})`);

  // Each segment's uv.y array: first (radialSegments+1) verts are the p1/end
  // side (originally uv.y=1), the rest are the p0/start side (uv.y=0) — see
  // the CylinderGeometry stub above.
  function endpoints(mesh) {
    const arr = mesh.geometry.attributes.uv.array;
    const rs = mesh.geometry.parameters.radialSegments;
    const firstBlockLen = (rs + 1) * 2;
    return { p0: arr[firstBlockLen + 1], p1: arr[1] };
  }
  const seg0 = endpoints(meshes[0]);
  const seg1 = endpoints(meshes[1]);

  assert(seg0.p0 === 0, `first segment starts at the source, distance 0 (got ${seg0.p0})`);
  assert(Math.abs(seg0.p1 - 6) < 1e-6, `first segment ends at distance 6 (got ${seg0.p1})`);
  assert(Math.abs(seg1.p0 - seg0.p1) < 1e-6,
    `second segment starts exactly where the first ends: continuous (${seg1.p0} vs ${seg0.p1})`);
  assert(Math.abs(seg1.p1 - 14) < 1e-6,
    `second segment ends at the sink, total run length 14 (got ${seg1.p1})`);
  assert(seg1.p1 > seg1.p0 && seg1.p0 > seg0.p0,
    'distance increases monotonically along source -> sink');
}

console.log('\n--- 2b. rfWaveguide (BoxGeometry) segments also travel source -> sink ---');
{
  // Same fixture, but the rect-segment (rfWaveguide) style. Every vertex's
  // baked uv.y is one of exactly two values per segment (see the BoxGeometry
  // stub) — this is the bug that shipped in the previous round: rect segments
  // built with NO run-distance bake at all, so they never had a direction.
  const { group } = buildFlowLine('rfWaveguide');
  const meshes = boxMeshes(group);
  assert(meshes.length === 2, `two box segments built (got ${meshes.length})`);

  function distinctBakedValues(mesh) {
    const arr = mesh.geometry.attributes.uv.array;
    const vals = new Set();
    for (let i = 1; i < arr.length; i += 2) vals.add(+arr[i].toFixed(6));
    return [...vals].sort((a, b) => a - b);
  }
  const seg0 = distinctBakedValues(meshes[0]);
  const seg1 = distinctBakedValues(meshes[1]);

  assert(seg0.length === 2 && seg1.length === 2,
    `each box segment bakes to exactly two distances, its own start and end (got ${seg0.length}, ${seg1.length})`);
  assert(seg0[0] === 0, `first segment starts at the source, distance 0 (got ${seg0[0]})`);
  assert(Math.abs(seg0[1] - 6) < 1e-6, `first segment ends at distance 6 (got ${seg0[1]})`);
  assert(Math.abs(seg1[0] - seg0[1]) < 1e-6,
    `second segment starts exactly where the first ends: continuous (${seg1[0]} vs ${seg0[1]})`);
  assert(Math.abs(seg1[1] - 14) < 1e-6,
    `second segment ends at the sink, total run length 14 (got ${seg1[1]})`);
}

console.log('\n--- 3. A vacuum run carries restrained gas-flow lighting ---');
{
  const { group } = buildFlowLine('vacuumPipe');
  const meshes = cylinderMeshes(group);
  assert(meshes.length === 2, 'vacuum run still builds its geometry');
  for (const m of meshes) {
    assert(m.layers.mask !== 1, 'vacuum flow is enabled on the bloom layer');
  }
}

console.log('\n--- 3b. Electrical runs vary surface colour and cast bounded local light ---');
{
  for (const utilityType of ['powerCable', 'hvCable']) {
    const { group } = buildFlowLine(utilityType);
    const meshes = cylinderMeshes(group);
    assert(meshes.length >= 1, `${utilityType} still builds its cable geometry`);
    assert(meshes.every(mesh => mesh.layers.mask === 1),
      `${utilityType} stays off the bloom layer`);
    const effect = group.userData.visualEffects?.[0];
    assert(effect?.crest === false && effect?.groundSpill === false,
      `${utilityType} publishes no crest or projected floor-glow geometry`);
    assert(effect?.light && effect.light.intensity > 0 && effect.light.distance > 0,
      `${utilityType} publishes a bounded moving real-light candidate`);

    const material = meshes[0].material;
    assert(material.colorNode && !material.emissiveNode,
      `${utilityType} uses a color node rather than an emissive node`);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <uv_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>',
    };
    material.onBeforeCompile(shader);
    assert(shader.fragmentShader.includes('diffuseColor.rgb = mix(')
        && !shader.fragmentShader.includes('totalEmissiveRadiance +='),
      `${utilityType} legacy shader varies lit surface colour without emissive radiance`);
  }
}

console.log('\n--- 4. FLOW_PARAMS covers every utility ---');
{
  const missing = UTILITY_TYPE_LIST.filter(t => !(t in FLOW_PARAMS));
  assert(missing.length === 0,
    `every UTILITY_TYPE_LIST member has a FLOW_PARAMS entry (missing: ${missing.join(',') || 'none'})`);
  assert(FLOW_PARAMS.vacuumPipe && FLOW_PARAMS.vacuumPipe.strength < FLOW_PARAMS.coolingWater.strength,
    'vacuumPipe has a subtler flow than cooling water');
  assert(!FLOW_PARAMS.rfWaveguide.color,
    'rfWaveguide has no colour override — falls through to its own (red) descriptor colour');
  assert(FLOW_PARAMS.hvCable.color && FLOW_PARAMS.hvCable.color !== '#141418',
    'hvCable IS overridden (its own descriptor colour is near-black and cannot visibly glow)');
  for (const t of UTILITY_TYPE_LIST) {
    const p = FLOW_PARAMS[t];
    assert(p && Number.isFinite(p.speed) && Number.isFinite(p.period)
      && Number.isFinite(p.width) && Number.isFinite(p.strength) && Number.isFinite(p.baseGlow),
      `${t} has complete surface-flow parameters`);
  }
  assert(FLOW_PARAMS.rfWaveguide.width * 2 >= FLOW_PARAMS.rfWaveguide.period * 0.3,
    'RF uses a long smooth gradient instead of a needle-sharp packet');
  assert(FLOW_PARAMS.hvCable.emissive === false
      && FLOW_PARAMS.hvCable.light !== false
      && FLOW_PARAMS.powerCable.emissive === false
      && FLOW_PARAMS.powerCable.light !== false,
    'power and HV keep surface-colour motion and bounded light');
  assert(FLOW_PARAMS.hvCable.speed <= 0.75
      && FLOW_PARAMS.powerCable.speed <= 0.5,
    'electrical highlights travel at a restrained crawl');
  assert(FLOW_PARAMS.dataFiber.speed > FLOW_PARAMS.rfWaveguide.speed
      && FLOW_PARAMS.dataFiber.light === false,
    'data remains the fastest lightless packet train');
  assert(FLOW_PARAMS.dataFiber.speed / FLOW_PARAMS.dataFiber.period <= 1.2
      && FLOW_PARAMS.dataFiber.width >= 0.15,
    'data uses broad packets at a restrained non-flashing cadence');
  const fiber = UTILITY_TYPES.dataFiber;
  assert(fiber.geometryStyle === 'fiberBundle'
      && fiber.pipeRadiusMeters >= 0.025
      && fiber.bundleStrandRadiusMeters > 0
      && fiber.bundleSpacingMeters > fiber.bundleStrandRadiusMeters,
    'data declares a thicker routed envelope containing distinct cable strands');
  assert(FLOW_PARAMS.hvCable.period >= 12
      && FLOW_PARAMS.powerCable.period >= 3.2,
    'power and HV highlights are spaced far enough apart to avoid glowing rows');
  assert(FLOW_PARAMS.hvCable.period > FLOW_PARAMS.powerCable.period * 3,
    'HV highlights remain much sparser than branch-power highlights');
  assert(FLOW_PARAMS.powerCable.color !== '#44cc44'
      && FLOW_PARAMS.hvCable.color !== '#141418',
    'electrical flow targets contrast with each cable base colour');
  assert(FLOW_PARAMS.powerCable.lightIntensity > FLOW_PARAMS.coolingWater.lightIntensity * 1.5
      && FLOW_PARAMS.hvCable.lightIntensity > FLOW_PARAMS.powerCable.lightIntensity * 1.7,
    'power and HV cast stronger local light than support-service flow');
  for (const type of [
    'hvCable', 'powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer',
  ]) {
    const { group } = buildFlowLine(type);
    const effect = group.userData.visualEffects?.[0];
    assert(effect?.crest === false
        && effect?.light && effect.light.intensity > 0 && effect.light.distance > 0,
      `${type} publishes light motion without a visible travelling shape`);
  }
  assert(!buildFlowLine('dataFiber').group.userData.visualEffects,
    'data fiber uses only its moving line colour, with no shape or room-light effect');
  const fiberStrands = cylinderMeshes(buildFlowLine('dataFiber').group)
    .filter(mesh => Number.isInteger(mesh.userData?.fiberBundleStrand));
  assert(fiberStrands.length === 6
      && new Set(fiberStrands.map(mesh => mesh.userData.fiberBundleStrand)).size === 3,
    `a two-segment data run renders as three parallel cables (${fiberStrands.length} strand segments)`);
}

console.log('\n--- 5. getLineMaterial: distinct per flowState, cached, tagged __shared ---');
{
  const ok = getLineMaterial('coolingWater', 'ok');
  const soft = getLineMaterial('coolingWater', 'soft');
  const hard = getLineMaterial('coolingWater', 'hard');
  assert(ok !== soft && soft !== hard && ok !== hard,
    'ok / soft / hard are three distinct material instances');
  assert(ok.userData.__shared && soft.userData.__shared && hard.userData.__shared,
    'all three are tagged __shared');

  const okAgain = getLineMaterial('coolingWater', 'ok');
  const softAgain = getLineMaterial('coolingWater', 'soft');
  assert(okAgain === ok, 'repeat call for the same (type, state) returns the cached instance');
  assert(softAgain === soft, 'same for the soft variant');

  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <uv_vertex>',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
  };
  soft.onBeforeCompile(shader);
  assert(shader.fragmentShader.includes('sin( uTime * 6.0 )')
      && !shader.fragmentShader.includes('step( 0.5, fract( uTime * 2.2 ) )'),
    'soft faults thrum smoothly instead of square-wave flashing the entire run');

  const powerOk = getLineMaterial('powerCable', 'ok');
  assert(powerOk !== ok, 'a different utility type is never the same cached instance');
  assert(powerOk.colorNode && !powerOk.emissiveNode,
    'power flow is a surface colour variation rather than emissive light');

  assert(ok.userData.flowUniforms && soft.userData.flowUniforms && hard.userData.flowUniforms,
    'flow-capable utility materials carry a flowUniforms handle');
  assert(hard.userData.flowUniforms.uStrength.value === 0
    && hard.userData.flowUniforms.uBaseGlow.value === 0,
    'hard-faulted material has its pulse strength and base glow zeroed (no motion)');
  assert(soft.userData.flowUniforms.uStrength.value > 0
    && soft.userData.flowUniforms.uStrength.value < ok.userData.flowUniforms.uStrength.value,
    'soft-faulted material pulses dimmer than a healthy one, not off');

  const vac = getLineMaterial('vacuumPipe', 'ok');
  assert(vac.userData.flowUniforms, 'vacuumPipe gets a gas-flow patch');
  assert(vac.userData.__shared, 'but is still cached/shared like any other line material');
}

console.log('\n--- 6b. Vacuum visually flows from chamber to pump ---');
{
  const pump = { placeableId: 'pump', portName: 'vac_out' };
  const chamber = { placeableId: 'chamber', portName: 'vac_in' };
  const network = {
    id: 'vac', utilityType: 'vacuumPipe', lineIds: ['V1'],
    ports: [
      { ...pump, role: 'source' },
      { ...chamber, role: 'sink' },
    ],
    sources: [{ portKey: 'pump:vac_out', ...pump }],
    sinks: [{ portKey: 'chamber:vac_in', ...chamber }],
  };
  const lines = new Map([['V1', {
    id: 'V1', utilityType: 'vacuumPipe', start: pump, end: chamber,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  }]]);
  const normal = computeLineOrientations(network, lines);
  const vacuum = computeLineOrientations(network, lines, { invertDirection: true });
  assert(normal.get('V1') === false, 'solver capacity direction is pump to chamber');
  assert(vacuum.get('V1') === true, 'visual vacuum direction reverses chamber to pump');

  // The renderer must request that inversion for real vacuum networks — the
  // topology helper alone cannot change a rendered line unless the builder
  // passes the vacuum-specific option through.
  const builder = new UtilityLineBuilderV2();
  const orientation = builder._buildOrientationMap(
    { utilityNetworks: new Map([['vacuumPipe', [network]]]) }, lines);
  assert(orientation.get('V1') === true,
    'UtilityLineBuilderV2 renders vacuum gas flowing chamber -> pump');
}

// computeLineOrientations is pure topology (src/utility/line-orientation.js)
// — no THREE, no renderer, tested directly against fake network/line data.
console.log('\n--- 6. computeLineOrientations: source -> sink from topology, not draw order ---');
{
  const CHILLER_SOURCE = { placeableId: 'chiller', portName: 'out' };
  const LOAD_SINK = { placeableId: 'load', portName: 'in' };
  const network = {
    id: 'n1', utilityType: 'coolingWater', lineIds: ['L1'],
    ports: [
      { placeableId: 'chiller', portName: 'out', role: 'source', params: {} },
      { placeableId: 'load', portName: 'in', role: 'sink', params: {} },
    ],
    sources: [{ portKey: 'chiller:out', placeableId: 'chiller', portName: 'out', capacity: 10, params: {} }],
    sinks: [{ portKey: 'load:in', placeableId: 'load', portName: 'in', demand: 5, params: {} }],
  };

  // Drawn source -> sink: line.start IS the source port.
  const forwardLines = new Map([
    ['L1', { id: 'L1', utilityType: 'coolingWater', start: CHILLER_SOURCE, end: LOAD_SINK, path: [{ col: 0, row: 0 }, { col: 4, row: 0 }] }],
  ]);
  const forward = computeLineOrientations(network, forwardLines);
  assert(forward.get('L1') === false, 'drawn source -> sink orients forward (not reversed)');

  // The SAME physical run, drawn the other way: line.start is the sink,
  // line.end is the source (player clicked the load first).
  const reversedLines = new Map([
    ['L1', { id: 'L1', utilityType: 'coolingWater', start: LOAD_SINK, end: CHILLER_SOURCE, path: [{ col: 4, row: 0 }, { col: 0, row: 0 }] }],
  ]);
  const reversedResult = computeLineOrientations(network, reversedLines);
  assert(reversedResult.get('L1') === true, 'the same run drawn sink -> source orients reversed');

  // A mid-run line past a junction: L1 runs chiller -> (open end at tile
  // 4,0); L2 runs from an open end that geometrically lands ON L1's open
  // end (a tap/tee, not a shared port) -> load. Neither of L2's ends is
  // itself a source port — it has to resolve via L1.
  const junctionNetwork = {
    id: 'n2', utilityType: 'coolingWater', lineIds: ['L1', 'L2'],
    ports: network.ports, sources: network.sources, sinks: network.sinks,
  };
  const junctionLines = new Map([
    ['L1', { id: 'L1', utilityType: 'coolingWater', start: CHILLER_SOURCE, end: null, path: [{ col: 0, row: 0 }, { col: 4, row: 0 }] }],
    ['L2', { id: 'L2', utilityType: 'coolingWater', start: null, end: LOAD_SINK, path: [{ col: 4, row: 0 }, { col: 8, row: 0 }] }],
  ]);
  const junctionResult = computeLineOrientations(junctionNetwork, junctionLines);
  assert(junctionResult.get('L1') === false, 'the source-side leg of a junction is forward');
  assert(junctionResult.get('L2') === false,
    'the far leg orients AWAY from the source too (its touching end is the near side, so it is also forward, not reversed)');

  // A line drawn INTO the header's interior (a true mid-span tap, not onto
  // another line's own terminal) resolves the same way.
  const midSpanLines = new Map([
    ['L1', { id: 'L1', utilityType: 'coolingWater', start: CHILLER_SOURCE, end: LOAD_SINK, path: [{ col: 0, row: 0 }, { col: 8, row: 0 }] }],
    ['L2', { id: 'L2', utilityType: 'coolingWater', start: null, end: { placeableId: 'gauge', portName: 'sense' }, path: [{ col: 4, row: 0 }, { col: 4, row: 3 }] }],
  ]);
  const midSpanNetwork = {
    id: 'n3', utilityType: 'coolingWater', lineIds: ['L1', 'L2'],
    ports: network.ports, sources: network.sources, sinks: network.sinks,
  };
  const midSpanResult = computeLineOrientations(midSpanNetwork, midSpanLines);
  assert(midSpanResult.get('L1') === false, 'the tapped header itself is unaffected by a branch off its middle');
  assert(midSpanResult.get('L2') === false,
    'a branch tapped off the header\'s interior orients away from the source through the tap, not reversed');

  // A network with no source at all: falls back to draw order everywhere,
  // and must not throw or produce NaN.
  const sourcelessNetwork = { id: 'n4', utilityType: 'coolingWater', lineIds: ['L1'], ports: [], sources: [], sinks: [] };
  const sourcelessLines = new Map([
    ['L1', { id: 'L1', utilityType: 'coolingWater', start: null, end: null, path: [{ col: 0, row: 0 }, { col: 2, row: 0 }] }],
  ]);
  let threw = false;
  let sourcelessResult;
  try { sourcelessResult = computeLineOrientations(sourcelessNetwork, sourcelessLines); }
  catch (e) { threw = true; }
  assert(!threw, 'a sourceless network does not throw');
  assert(sourcelessResult && sourcelessResult.size === 0,
    'and produces no orientation entries at all — callers treat that as forward/draw-order');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
