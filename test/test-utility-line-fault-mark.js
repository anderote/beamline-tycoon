// A utility run keeps its own colour and carries no world-space fault X.
// Fault text belongs to hover; the only compact world glyph is an exclamation
// point over each affected sink port.
//
// The defect: a network in a fault state painted its lines with an amber or
// red emissive. Over powerCable's green that renders as solid yellow, which
// reads as "this is a different kind of pipe" rather than "this run is
// faulted" — and being a blend it lands on a different hue for each of the six
// utilities, so there is nothing for the player to learn. The colour is the
// utility's identity. Fault state now stays in flow motion + port affordances.
//
// THREE is a CDN global in the browser; stubbed here to the handful of classes
// the material and mark paths touch.

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
    // Real Object3D always carries a Layers mask (buildLineGroup enables
    // BLOOM_LAYER on flow-patched meshes — see utility-flow.js / Task 4).
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
globalThis.THREE = {
  Vector3: V3,
  Color: class { constructor(c) { this.c = c; } },
  Quaternion: class { setFromUnitVectors() { return this; } },
  Group: Obj3,
  Mesh: class extends Obj3 { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } },
  MeshStandardMaterial: class { constructor(opts = {}) { Object.assign(this, opts); this.userData = {}; } dispose() {} },
  BoxGeometry: class { constructor(...a) { this.args = a; } dispose() {} },
  CylinderGeometry: class { constructor(...a) { this.args = a; } dispose() {} },
  SphereGeometry: class { constructor(...a) { this.args = a; } dispose() {} },
  TorusGeometry: class { constructor(...a) { this.args = a; } dispose() {} },
};

const { getLineMaterial, UtilityLineBuilderV2 } =
  await import('../src/renderer3d/utility-line-builder-v2.js');
const { UTILITY_TYPES, UTILITY_TYPE_LIST } =
  await import('../src/utility/registry.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function marksIn(group) {
  const out = [];
  const walk = (o) => {
    if (o.userData && o.userData.isUtilityFaultMark) out.push(o);
    for (const c of o.children || []) walk(c);
  };
  walk(group);
  return out;
}

// One line, four tiles long, both ends open.
const LINE = (id, utilityType) => ({
  id, utilityType, start: null, end: null,
  path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
});

function buildOne(line, errorStatus) {
  const builder = new UtilityLineBuilderV2();
  const parent = new Obj3();
  const lines = new Map([[line.id, line]]);
  // _buildErrorMap needs published network data; drive the status directly by
  // stubbing it, which is the seam build() reads.
  builder._buildErrorMap = () => new Map([[line.id, errorStatus]]);
  builder.build(lines, new Map(), parent, { state: {} });
  return { builder, parent, group: parent.children[0] };
}

console.log('\n--- 1. A faulted line keeps its utility colour ---');
{
  const wrong = [];
  for (const type of UTILITY_TYPE_LIST) {
    const own = UTILITY_TYPES[type].color;
    for (const status of ['ok', 'soft', 'hard']) {
      const mat = getLineMaterial(type, status);
      if (mat.color.c !== own) wrong.push(`${type}/${status}`);
      if (mat.emissive) wrong.push(`${type}/${status}:glow`);
    }
  }
  assert(wrong.length === 0,
    `no status recolours or lights the pipe (wrong: ${wrong.join(',') || 'none'})`);
}

console.log('\n--- 2. Faulted lines carry no red/amber X ---');
{
  const ok = buildOne(LINE('ul_ok', 'powerCable'), 'ok');
  assert(marksIn(ok.group).length === 0, 'a healthy run carries no X');

  const hard = buildOne(LINE('ul_hard', 'powerCable'), 'hard');
  assert(marksIn(hard.group).length === 0, 'a hard fault carries no X on the pipe');

  const soft = buildOne(LINE('ul_soft', 'powerCable'), 'soft');
  assert(marksIn(soft.group).length === 0, 'a soft fault carries no X on the pipe');
}

console.log('\n--- 3. Sink alerts are compact exclamation points over ports ---');
{
  const builder = new UtilityLineBuilderV2();
  const parent = new Obj3();
  builder.setUtilityPortIssueMarkers([
    {
      placeableId: 'quad', portName: 'pwr_in', utilityType: 'powerCable',
      severity: 'warning', x: 2, y: 0.4, z: 3,
    },
    {
      placeableId: 'cavity', portName: 'rf_in', utilityType: 'rfWaveguide',
      severity: 'critical', x: 5, y: 0.8, z: 7,
    },
    {
      placeableId: 'panel', portName: 'hv_in', utilityType: 'hvCable',
      severity: 'critical', x: 8, y: 0.6, z: 4,
    },
  ], parent);
  const markers = parent.children[0]?.children || [];
  assert(markers.length === 3, 'one marker is drawn per affected sink port');
  assert(markers.every(marker => marker.children.length === 3),
    'each marker is a leader plus two-piece exclamation glyph, not an X');
  assert(markers.every(marker => marker.children[0].position.y < marker.children[1].position.y
      && marker.children[1].position.y < marker.children[2].position.y),
    'the leader rises from the port to the dot and bar');
  assert(markers[0]?.userData.severity === 'warning'
      && markers[0]?.children[1].material.color.c === '#2e8b2e',
    'partial power uses a subdued shade of the green power-port color');
  assert(markers[1]?.userData.severity === 'critical'
      && markers[1]?.children[1].material.color.c === UTILITY_TYPES.rfWaveguide.color,
    'zero RF service uses the full-bright RF port color');
  assert(markers[1]?.position.x === 5 && markers[1]?.position.y === 0.8
      && markers[1]?.position.z === 7,
    'the marker group starts at the exact affected port anchor');
  assert(markers[2]?.children[1].material.color.c === UTILITY_TYPES.hvCable.markerColor,
    'HV issues use its visible port-marker override, not the near-black cable color');
  builder.pulseUtilityPortIssueMarkers(0);
  assert(markers[0]?.children[1].material.emissiveIntensity
      < markers[1]?.children[1].material.emissiveIntensity,
    'warning markers remain dimmer than critical markers while pulsing');
}

console.log('\n--- 4. Clearing port issues clears the glyphs ---');
{
  const builder = new UtilityLineBuilderV2();
  const parent = new Obj3();
  const issue = {
    placeableId: 'quad', portName: 'pwr_in', utilityType: 'powerCable',
    severity: 'warning', x: 2, y: 0.4, z: 3,
  };
  assert(builder.setUtilityPortIssueMarkers([issue], parent) === true,
    'the first issue set builds markers');
  assert(builder.setUtilityPortIssueMarkers([issue], parent) === false,
    'an unchanged issue set reuses its marker group');
  builder.setUtilityPortIssueMarkers([], parent);
  assert(parent.children.length === 0, 'fixed ports have no lingering glyph');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
