// test/test-utility-line-port-tail.js — presentation anchors may sit inside a
// component's logical footprint, but the cable must remain orthogonal while it
// bridges from the routed footprint-edge point into that visible connector.

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}
globalThis.THREE = { Vector3: V3 };

const { COMPONENTS } = await import('../src/data/components.js');
const { portWorldPosition } = await import('../src/utility/ports.js');
const { utilityLineHeight } = await import('../src/utility/registry.js');
const {
  portAnchor3D,
  setModelBoundsProvider,
  setShellMeasureProvider,
} = await import('../src/utility/port-anchors.js');
const { buildWorldPoints } = await import('../src/renderer3d/utility-line-builder-v2.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const def = COMPONENTS.powerPanel;
const panel = {
  id: 'panel', type: 'powerPanel', category: 'infrastructure',
  col: 3, row: 4, subCol: 0, subRow: 0, dir: 0,
};
const panel2 = {
  id: 'panel2', type: 'powerPanel', category: 'infrastructure',
  col: 8, row: 7, subCol: 0, subRow: 0, dir: 0,
};
const ref = { placeableId: panel.id, portName: 'pwr_out_1' };
const ref2 = { placeableId: panel2.id, portName: 'pwr_out_4' };
const logical = portWorldPosition(panel, def, ref.portName);
const logical2 = portWorldPosition(panel2, def, ref2.portName);
const logicalTile = { col: logical.x / 2, row: logical.z / 2 };
const logicalTile2 = { col: logical2.x / 2, row: logical2.z / 2 };
const endpoints = new Map([[panel.id, panel], [panel2.id, panel2]]);

// Deliberately make the rendered cabinet narrower and shorter along its face
// than its authored footprint. That is the production case that used to turn
// the final run segment into a diagonal.
setModelBoundsProvider(type => type === 'powerPanel' ? {
  minX: -0.1, maxX: 0.1,
  minY: 0, maxY: 1.2,
  minZ: -0.25, maxZ: 0.25,
} : null);
setShellMeasureProvider((type, requests) => new Map(
  requests.map(request => [request.key, type === 'powerPanel' ? 0.1 : null]),
));
const anchor = portAnchor3D(panel, def, ref.portName);
const anchor2 = portAnchor3D(panel2, def, ref2.portName);

function isOrthogonal(points) {
  return points.every((p, i) => {
    if (i === 0) return true;
    const prev = points[i - 1];
    const changed = [
      Math.abs(p.x - prev.x),
      Math.abs(p.y - prev.y),
      Math.abs(p.z - prev.z),
    ].filter(d => d > 1e-6).length;
    return changed <= 1;
  });
}

function includesPoint(points, target) {
  return points.some(p => Math.abs(p.x - target.x) < 1e-6
    && Math.abs(p.z - target.z) < 1e-6);
}

function includesFloorPoint(points, target, utilityType) {
  const floorY = utilityLineHeight(utilityType);
  return points.some(p => Math.abs(p.x - target.x) < 1e-6
    && Math.abs(p.y - floorY) < 1e-6
    && Math.abs(p.z - target.z) < 1e-6);
}

function verticalSegments(points) {
  return points.slice(1).map((point, index) => [points[index], point])
    .filter(([a, b]) => Math.abs(a.y - b.y) > 1e-6);
}

console.log('\n--- 1. Start-port tail climbs outside a front-terminal cabinet ---');
{
  const points = buildWorldPoints({
    utilityType: 'powerCable', start: ref, end: null,
    path: [
      logicalTile,
      { col: logicalTile.col + 0.5, row: logicalTile.row },
      { col: logicalTile.col + 0.5, row: logicalTile.row + 2 },
      { col: logicalTile.col + 3, row: logicalTile.row + 2 },
    ],
  }, endpoints);
  assert(includesPoint(points, anchor), 'moves the floor route onto the visible connector');
  assert(includesFloorPoint(points, anchor, 'powerCable'),
    'uses the visible front terminal as the outside vertical landing');
  assert(verticalSegments(points).length === 1
      && Math.abs(verticalSegments(points)[0][0].x - anchor.x) < 1e-6
      && Math.abs(verticalSegments(points)[0][0].z - anchor.z) < 1e-6,
    'the only vertical cable leg stays on the front terminal plane');
  assert(points.length >= 6, `adds the connector riser (got ${points.length} points)`);
  assert(isOrthogonal(points), 'every connector-to-route segment changes only one axis');
}

console.log('\n--- 2. End-port tail climbs outside a front-terminal cabinet ---');
{
  const points = buildWorldPoints({
    utilityType: 'powerCable', start: null, end: ref,
    path: [
      { col: logicalTile.col + 3, row: logicalTile.row + 2 },
      { col: logicalTile.col + 0.5, row: logicalTile.row + 2 },
      { col: logicalTile.col + 0.5, row: logicalTile.row },
      logicalTile,
    ],
  }, endpoints);
  assert(includesPoint(points, anchor), 'moves the sink floor route onto the visible connector');
  assert(includesFloorPoint(points, anchor, 'powerCable'),
    'the sink tail rises directly beneath the front terminal');
  assert(verticalSegments(points).length === 1
      && Math.abs(verticalSegments(points)[0][0].x - anchor.x) < 1e-6
      && Math.abs(verticalSegments(points)[0][0].z - anchor.z) < 1e-6,
    'the sink vertical leg remains on the front terminal plane');
  assert(points.length >= 6, `adds the unreversed sink riser (got ${points.length} points)`);
  assert(isOrthogonal(points), 'the sink tail has no diagonal segment');
}

console.log('\n--- 3. A shared L corner absorbs both measured endpoints ---');
{
  const points = buildWorldPoints({
    utilityType: 'powerCable', start: ref, end: ref2,
    path: [
      logicalTile,
      { col: logicalTile2.col, row: logicalTile.row },
      logicalTile2,
    ],
  }, endpoints);
  assert(includesPoint(points, anchor) && includesPoint(points, anchor2),
    'both floor terminals land on their visible connectors');
  assert(includesFloorPoint(points, anchor, 'powerCable')
    && includesFloorPoint(points, anchor2, 'powerCable'),
    'both front-terminal tails climb directly beneath their visible glands');
  assert(verticalSegments(points).length === 2,
    'the shared run has one outside vertical leg per cabinet');
  assert(isOrthogonal(points), 'moving both ends keeps the shared corner Manhattan');
}

console.log('\n--- 4. A top cryo bayonet drops outside its cryostat ---');
{
  const cryostat = {
    id: 'cryo', type: 'srf650Cryomodule', category: 'beamline',
    col: 10, row: 10, subCol: -0.5, subRow: -2.5, dir: 0, isPlacement: true,
  };
  const cryoDef = COMPONENTS[cryostat.type];
  const cryoRef = { placeableId: cryostat.id, portName: 'cryo_in' };
  const cryoAnchor = portAnchor3D(cryostat, cryoDef, cryoRef.portName);
  const sideLanding = portWorldPosition(cryostat, cryoDef, cryoRef.portName);
  const anchorTile = { col: cryoAnchor.x / 2, row: cryoAnchor.z / 2 };
  const cryoEndpoints = new Map([[cryostat.id, cryostat]]);
  const points = buildWorldPoints({
    utilityType: 'cryoTransfer', start: null, end: cryoRef,
    path: [
      { col: anchorTile.col - 3, row: anchorTile.row - 2 },
      { col: anchorTile.col - 1, row: anchorTile.row - 2 },
      { col: anchorTile.col - 1, row: anchorTile.row },
      anchorTile,
    ],
  }, cryoEndpoints);
  const tipY = cryoAnchor.y + cryoAnchor.out.y * cryoAnchor.standoff;
  const verticals = verticalSegments(points);

  assert(isOrthogonal(points), 'the side-drop transition remains fully orthogonal');
  assert(points.some(point => Math.abs(point.x - cryoAnchor.x) < 1e-6
      && Math.abs(point.y - tipY) < 1e-6
      && Math.abs(point.z - cryoAnchor.z) < 1e-6),
    'the line still terminates on the visible top bayonet');
  assert(verticals.length === 1
      && Math.abs(verticals[0][0].x - sideLanding.x) < 1e-6
      && Math.abs(verticals[0][0].z - sideLanding.z) < 1e-6,
    `the only descent is at the footprint side (${sideLanding.x}, ${sideLanding.z})`);
  assert(verticals.every(([a]) => Math.abs(a.x - cryoAnchor.x) > 1e-6
      || Math.abs(a.z - cryoAnchor.z) > 1e-6),
    'no vertical transfer-line segment passes through the cryostat body');
}

setModelBoundsProvider(null);
setShellMeasureProvider(null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
