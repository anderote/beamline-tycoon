// Cooling water uses the same continuous spline sheath as flexible power/HV
// cords, for both committed lines and the live draw preview.

globalThis.THREE = await import('three');

const { UtilityLineBuilderV2 } =
  await import('../src/renderer3d/utility-line-builder-v2.js');

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('PASS ', message); }
  else { failed++; console.log('FAIL ', message); }
}

function flexibleMeshes(root) {
  const found = [];
  root.traverse(object => {
    if (object.userData?.isFlexibleUtilityCable) found.push(object);
  });
  return found;
}

const cablePath = [
  { col: 0, row: 0 },
  { col: 1, row: 1 },
  { col: 2, row: -1 },
  { col: 3, row: 0 },
];
const path = [{ col: 0, row: 0 }, { col: 3, row: 0 }];

{
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE.Group();
  const line = {
    id: 'cooling_hose', utilityType: 'coolingWater', start: null, end: null,
    path, cablePath,
  };
  builder.build(new Map([[line.id, line]]), new Map(), parent, { state: {} });
  const meshes = flexibleMeshes(parent);
  assert(meshes.length === 1,
    `committed cooling run is one continuous flexible sheath (got ${meshes.length})`);
  assert(meshes[0]?.geometry?.type === 'TubeGeometry',
    `committed cooling sheath uses smooth tube geometry (${meshes[0]?.geometry?.type})`);
}

{
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE.Group();
  builder.setPreview({
    utilityType: 'coolingWater', path: cablePath, cablePath,
    color: '#4488ff', valid: true,
  }, parent);
  const meshes = flexibleMeshes(parent);
  assert(meshes.length === 1,
    `cooling draw preview is one continuous flexible sheath (got ${meshes.length})`);
  assert(meshes[0]?.geometry?.type === 'TubeGeometry',
    `cooling preview uses smooth tube geometry (${meshes[0]?.geometry?.type})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
