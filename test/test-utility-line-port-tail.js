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

console.log('\n--- 1. Start-port tail remains orthogonal ---');
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
  assert(!includesFloorPoint(points, logical, 'powerCable'),
    'drops the old floor-level footprint endpoint instead of looping back to it');
  assert(points.length >= 6, `adds the connector riser (got ${points.length} points)`);
  assert(isOrthogonal(points), 'every connector-to-route segment changes only one axis');
}

console.log('\n--- 2. End-port tail remains orthogonal ---');
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
  assert(!includesFloorPoint(points, logical, 'powerCable'),
    'the sink tail does not revisit its old floor-level footprint edge');
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
  assert(!includesFloorPoint(points, logical, 'powerCable')
    && !includesFloorPoint(points, logical2, 'powerCable'),
    'neither end detours through its old floor-level footprint position');
  assert(isOrthogonal(points), 'moving both ends keeps the shared corner Manhattan');
}

setModelBoundsProvider(null);
setShellMeasureProvider(null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
