// test/test-utility-line-fault-pulse.js — a faulted run is struck with an X;
// it does not become a different colour of pipe.
//
// The defect: a network in a fault state painted its lines with an amber or
// red emissive. Over powerCable's green that renders as solid yellow, which
// reads as "this is a different kind of pipe" rather than "this run is
// faulted" — and being a blend it lands on a different hue for each of the six
// utilities, so there is nothing for the player to learn. The colour is the
// utility's identity; the fault is a symbol struck over it.
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
const { UTILITY_TYPES, UTILITY_TYPE_LIST, utilityLineHeight } =
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

console.log('\n--- 2. The fault is an X over the run ---');
{
  const ok = buildOne(LINE('ul_ok', 'powerCable'), 'ok');
  assert(marksIn(ok.group).length === 0, 'a healthy run carries no mark');

  const hard = buildOne(LINE('ul_hard', 'powerCable'), 'hard');
  const hardMarks = marksIn(hard.group);
  assert(hardMarks.length === 1, `a hard fault strikes one mark (got ${hardMarks.length})`);
  assert(hardMarks[0] && hardMarks[0].children.length === 2,
    'made of two crossed bars — an X, not a blob');
  assert(hardMarks[0] && hardMarks[0].children.every(b => Math.abs(b.rotation.y) > 0.1),
    'both bars are turned off-axis, so they cross');

  const soft = buildOne(LINE('ul_soft', 'powerCable'), 'soft');
  const softMarks = marksIn(soft.group);
  assert(softMarks.length === 1, 'a soft fault is marked too');
  assert(softMarks[0].userData.severity === 'soft'
    && hardMarks[0].userData.severity === 'hard',
    'and the two severities stay distinguishable');
  assert(softMarks[0].children[0].material !== hardMarks[0].children[0].material,
    'via different materials (amber vs red), not different shapes');
}

console.log('\n--- 3. The mark sits on the run, clear of it ---');
{
  const { group } = buildOne(LINE('ul_pos', 'powerCable'), 'hard');
  const mark = marksIn(group)[0];
  const runY = utilityLineHeight('powerCable');
  // The fixture runs from tile (0,0) to (4,0) → world x 0..8 at z 0.
  assert(Math.abs(mark.position.x - 4) < 1e-6 && Math.abs(mark.position.z) < 1e-6,
    `struck at the midpoint of the run (${mark.position.x}, ${mark.position.z})`);
  assert(mark.position.y > runY,
    `and above it, not buried in the cable (${mark.position.y} vs run ${runY})`);
}

console.log('\n--- 4. Clearing the fault clears the mark ---');
{
  // Same line id, status flips: the hash carries errorStatus, so the rebuild
  // is what removes the X. A stale mark would mean a fixed network still
  // reading as broken.
  const line = LINE('ul_flip', 'powerCable');
  const builder = new UtilityLineBuilderV2();
  const parent = new Obj3();
  const lines = new Map([[line.id, line]]);
  let status = 'hard';
  builder._buildErrorMap = () => new Map([[line.id, status]]);

  builder.build(lines, new Map(), parent, { state: {} });
  assert(marksIn(parent).length === 1, 'faulted: marked');

  status = 'ok';
  builder.build(lines, new Map(), parent, { state: {} });
  assert(marksIn(parent).length === 0, 'fixed: the mark is gone');
  assert(parent.children.length === 1, 'and the line itself is still there, once');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
