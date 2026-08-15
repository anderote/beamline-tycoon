// Cooling water uses the same continuous spline sheath as flexible power/HV
// cords, for both committed lines and the live draw preview.

globalThis.THREE = await import('three');

const { buildSoftCableWorldPoints, UtilityLineBuilderV2 } =
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
  const cornerPath = [
    { col: 0, row: 0 },
    { col: 2, row: 0 },
    { col: 2, row: 2 },
  ];
  const closestToCorner = {};
  for (const utilityType of ['powerCable', 'coolingWater', 'hvCable']) {
    const points = buildSoftCableWorldPoints({
      utilityType, path: cornerPath, cablePath: cornerPath,
      start: null, end: null,
    }, new Map());
    closestToCorner[utilityType] = Math.min(...points.map(point =>
      Math.hypot(point.x - 4, point.z)));
  }
  assert(closestToCorner.powerCable < closestToCorner.coolingWater
      && closestToCorner.coolingWater < closestToCorner.hvCable,
    `renderer applies progressively broader turns (${JSON.stringify(closestToCorner)})`);
}

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
  assert(builder.updateRelaxations(0.1) === false,
    'a line loaded with the scene starts already settled');
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

{
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE.Group();
  // Establish the initial scene. Lines present here would load already at
  // rest; only a line appearing afterward should visibly settle.
  builder.build(new Map(), new Map(), parent, { state: {} });
  const placeables = new Map([
    ['supply', {
      id: 'supply', type: 'mcc', kind: 'infrastructure', category: 'infrastructure',
      col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
    }],
    ['load', {
      id: 'load', type: 'mcc', kind: 'infrastructure', category: 'infrastructure',
      col: 4, row: 3, subCol: 0, subRow: 0, dir: 2,
    }],
  ]);
  const line = {
    id: 'new_power_cord', utilityType: 'powerCable',
    start: { placeableId: 'supply', portName: 'pwr_out_1' },
    end: { placeableId: 'load', portName: 'pwr_out_1' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 3 }],
    cablePath: [
      { col: 0, row: 0 },
      { col: 1.2, row: 0.1 },
      { col: 1.4, row: 1.6 },
      { col: 4, row: 3 },
    ],
  };
  builder.build(new Map([[line.id, line]]), placeables, parent, { state: {} });
  const beforeMesh = flexibleMeshes(parent)[0];
  const before = Array.from(beforeMesh.geometry.attributes.position.array);
  builder.updateRelaxations(0.1);
  const during = Array.from(beforeMesh.geometry.attributes.position.array);
  assert(JSON.stringify(during) !== JSON.stringify(before),
    'a newly committed flexible line starts moving toward its settled shape');

  let finished = false;
  for (let frame = 0; frame < 12; frame++) {
    finished = builder.updateRelaxations(0.1) || finished;
  }
  assert(finished, 'the relaxation reaches a terminal resting frame');
  const atRestMesh = flexibleMeshes(parent)[0];
  const atRest = Array.from(atRestMesh.geometry.attributes.position.array);
  assert(builder.updateRelaxations(1) === false,
    'a rested line performs no more animation work');
  assert(JSON.stringify(Array.from(atRestMesh.geometry.attributes.position.array))
      === JSON.stringify(atRest),
    'the final cable geometry remains completely still');
}

{
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE.Group();
  const line = {
    id: 'dragged_power_cord', utilityType: 'powerCable',
    start: { placeableId: 'supply', portName: 'pwr_out_1' },
    end: { placeableId: 'load', portName: 'pwr_out_1' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 3 }],
    cablePath: [
      { col: 0, row: 0 }, { col: 1.2, row: 0.1 },
      { col: 1.4, row: 1.6 }, { col: 4, row: 3 },
    ],
  };
  const originalPlaceables = new Map([
    ['supply', {
      id: 'supply', type: 'mcc', kind: 'infrastructure', category: 'infrastructure',
      col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
    }],
    ['load', {
      id: 'load', type: 'mcc', kind: 'infrastructure', category: 'infrastructure',
      col: 4, row: 3, subCol: 0, subRow: 0, dir: 2,
    }],
  ]);
  const lines = new Map([[line.id, line]]);
  builder.build(lines, originalPlaceables, parent, { state: {} });
  const oldControls = flexibleMeshes(parent)[0].userData.flexibleControlPoints
    .map(point => point.clone());

  const movedPlaceables = new Map(originalPlaceables);
  movedPlaceables.set('load', { ...originalPlaceables.get('load'), col: 6, row: 4 });
  builder.setDraggedPlaceableId('load');
  builder.build(lines, movedPlaceables, parent, { state: {} });
  const draggedMesh = flexibleMeshes(parent)[0];
  const firstDragControls = draggedMesh.userData.flexibleControlPoints;
  assert(firstDragControls.at(-1).distanceTo(oldControls.at(-1)) > 0.5,
    'the carried fitting immediately keeps its cable endpoint attached');
  const endpoint = firstDragControls.at(-1).clone();
  const geometryBeforeDynamics = Array.from(draggedMesh.geometry.attributes.position.array);
  builder.updateDragDynamics(0.03);
  assert(JSON.stringify(Array.from(draggedMesh.geometry.attributes.position.array))
      !== JSON.stringify(geometryBeforeDynamics),
    'the cable middle trails the carried fitting with damped motion');
  assert(draggedMesh.userData.flexibleControlPoints.at(-1).distanceTo(endpoint) < 1e-9,
    'damped motion never pulls the plug away from the carried fitting');

  let dragSettled = false;
  for (let frame = 0; frame < 360; frame++) {
    dragSettled = builder.updateDragDynamics(1 / 60) || dragSettled;
  }
  assert(dragSettled, 'the dragged cable settles after the cursor stops');
  const settledGeometry = Array.from(draggedMesh.geometry.attributes.position.array);
  assert(builder.updateDragDynamics(1 / 60) === false
      && JSON.stringify(Array.from(draggedMesh.geometry.attributes.position.array))
        === JSON.stringify(settledGeometry),
    'drag physics becomes completely idle at rest');

  const fartherPlaceables = new Map(movedPlaceables);
  fartherPlaceables.set('load', { ...movedPlaceables.get('load'), col: 7, row: 5 });
  builder.build(lines, fartherPlaceables, parent, { state: {} });
  builder.updateDragDynamics(1 / 60);
  const trailingControls = flexibleMeshes(parent)[0].userData.flexibleControlPoints
    .map(point => point.clone());
  builder.setDraggedPlaceableId(null);
  builder.build(lines, fartherPlaceables, parent, { state: {} });
  const committedControls = flexibleMeshes(parent)[0].userData.flexibleControlPoints;
  assert(committedControls.some((point, index) => point.distanceTo(trailingControls[index]) > 1e-4),
    'dropping forces the transient trailing shape into its final resting solve');
  assert(builder.updateDragDynamics(1 / 60) === false,
    'drop clears all transient drag simulation state');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
