import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const { UTILITY_TYPES, UTILITY_TYPE_LIST } = await import('../src/utility/registry.js');
const { UtilityLineBuilderV2 } = await import('../src/renderer3d/utility-line-builder-v2.js');
const {
  UTILITY_DETAIL_ENTER_ZOOM,
  UTILITY_DETAIL_EXIT_ZOOM,
  utilityDetailForZoom,
} = await import('../src/renderer3d/utility-lod.js');

function collect(root, predicate) {
  const out = [];
  root.traverse(object => { if (predicate(object)) out.push(object); });
  return out;
}

function effectivelyVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

function line(id, utilityType, row) {
  return {
    id,
    utilityType,
    start: null,
    end: null,
    waterCircuit: utilityType === 'waterSupplyPipe' ? 'cold' : undefined,
    path: [{ col: 0, row }, { col: 4, row }],
    cablePath: [{ col: 0, row }, { col: 2, row: row + 0.35 }, { col: 4, row }],
  };
}

test('utility zoom policy uses a stable hysteresis band', () => {
  assert.ok(UTILITY_DETAIL_EXIT_ZOOM < UTILITY_DETAIL_ENTER_ZOOM);
  assert.ok(UTILITY_DETAIL_EXIT_ZOOM > 2.15,
    'dense utility construction stays merged through the ordinary object LOD boundary');
  assert.equal(utilityDetailForZoom(UTILITY_DETAIL_EXIT_ZOOM - 0.01, true), false,
    'zooming out crosses into low detail at the lower boundary');
  assert.equal(utilityDetailForZoom(
    (UTILITY_DETAIL_EXIT_ZOOM + UTILITY_DETAIL_ENTER_ZOOM) / 2, true,
  ), true, 'near detail remains active inside the band while zooming out');
  assert.equal(utilityDetailForZoom(
    (UTILITY_DETAIL_EXIT_ZOOM + UTILITY_DETAIL_ENTER_ZOOM) / 2, false,
  ), false, 'far detail remains active inside the band while zooming in');
  assert.equal(utilityDetailForZoom(UTILITY_DETAIL_ENTER_ZOOM, false), true,
    'zooming in restores detail at the upper boundary');
});

test('every utility keeps its route silhouette while far detail is suppressed', () => {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  const lines = new Map(UTILITY_TYPE_LIST.map((utilityType, index) => {
    const record = line(`lod-${utilityType}`, utilityType, index * 2);
    return [record.id, record];
  }));

  // Exercise the important lifecycle case: a world rebuild performed while
  // already zoomed out must inherit the current presentation immediately.
  builder.setDetailLevel(false);
  builder.build(lines, new Map(), parent);
  const farBatches = parent.children.filter(child => child.userData?.isUtilityFarRouteBatch);
  assert.ok(farBatches.length > 0 && farBatches.length <= UTILITY_TYPE_LIST.length,
    'far routes use at most one material-compatible GPU mesh per utility type');

  for (const utilityType of UTILITY_TYPE_LIST) {
    const group = parent.children.find(child =>
      child.userData?.lineId === `lod-${utilityType}`);
    assert.ok(group, `${utilityType} creates a committed line group`);
    const representedByBatch = farBatches.some(batch =>
      batch.userData.lineIds.includes(`lod-${utilityType}`));
    assert.ok(collect(group, object => object.isMesh && effectivelyVisible(object)).length > 0
      || representedByBatch,
      `${utilityType} retains visible low-detail route geometry`);
    if (UTILITY_TYPES[utilityType].fixedRouteHeight === true) {
      const farRoutes = collect(group, object => object.userData?.isUtilityFarRoute);
      assert.equal(farRoutes.length, 1,
        `${utilityType} collapses its rigid route to one facility-scale mesh`);
      assert.equal(effectivelyVisible(farRoutes[0]), false,
        `${utilityType} hides its per-line source after facility-wide merging`);
      assert.ok(representedByBatch,
        `${utilityType} is represented in a facility-wide far route mesh`);
    }
  }

  const detailObjects = collect(parent,
    object => object.userData?.utilityLodRole === 'detail');
  assert.ok(detailObjects.length > 0,
    'fittings, jackets, bands, ports, and supports publish one shared LOD role');
  assert.ok(detailObjects.every(object => !effectivelyVisible(object)),
    'all utility detail objects are suppressed in the far band');

  const supportGroup = collect(parent,
    object => object.userData?.isRigidUtilitySupportGroup)[0];
  assert.ok(supportGroup && !effectivelyVisible(supportGroup),
    'dense rigid-service support racks are omitted from the far presentation');

  const flexible = collect(parent,
    object => object.userData?.isFlexibleUtilityCable)[0];
  assert.equal(flexible.geometry.parameters.radialSegments, 4,
    'soft utilities swap to a four-sided far tube instead of retaining near tessellation');
  const farTubularSegments = flexible.geometry.parameters.tubularSegments;

  const firstRigidType = UTILITY_TYPE_LIST.find(type =>
    UTILITY_TYPES[type].fixedRouteHeight === true);
  builder.setFocus([`lod-${firstRigidType}`]);
  assert.ok(farBatches.every(batch => !effectivelyVisible(batch)),
    'focused utility inspection falls back to independently dimmable line routes');
  const focusedSource = collect(parent.children.find(child =>
    child.userData?.lineId === `lod-${firstRigidType}`),
  object => object.userData?.isUtilityFarRoute)[0];
  assert.ok(effectivelyVisible(focusedSource),
    'the focused line keeps a selectable per-line far route');
  builder.setFocus(null);
  assert.ok(farBatches.every(batch => effectivelyVisible(batch)),
    'clearing focus restores the facility-wide route batches');

  const indexedRoots = [
    ...builder._lineGroups.values(),
    ...builder._busGroups.values(),
    builder._rigidSupportGroup,
  ].filter(Boolean);
  const traversals = indexedRoots.map(root => root.traverse);
  for (const root of indexedRoots) {
    root.traverse = () => { throw new Error('LOD transition rescanned a utility hierarchy'); };
  }
  builder.setDetailLevel(true);
  for (let index = 0; index < indexedRoots.length; index++) {
    indexedRoots[index].traverse = traversals[index];
  }
  assert.ok(detailObjects.every(object => effectivelyVisible(object)),
    'zooming back in restores every authored utility detail');
  assert.ok(collect(parent, object => object.userData?.isUtilityFarRoute)
    .every(object => !effectivelyVisible(object)),
  'zooming back in hides every merged far route');
  assert.ok(farBatches.every(batch => !effectivelyVisible(batch)),
    'zooming back in also hides facility-wide far route batches');
  assert.equal(flexible.geometry.parameters.radialSegments, 8,
    'soft utilities restore their rounded near tube');
  assert.ok(flexible.geometry.parameters.tubularSegments > farTubularSegments,
    'the near flexible route restores denser longitudinal sampling');

  builder.dispose(parent);
});

test('far HV cable tessellation preserves horizontal and vertical route orientation', () => {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  const horizontal = line('hv-horizontal', 'hvCable', 0);
  const vertical = {
    ...line('hv-vertical', 'hvCable', 2),
    path: [{ col: 0, row: 2 }, { col: 0, row: 6 }],
    cablePath: [
      { col: 0, row: 2 }, { col: 0.3, row: 4 }, { col: 0, row: 6 },
    ],
  };
  builder.setDetailLevel(false);
  builder.build(new Map([
    [horizontal.id, horizontal], [vertical.id, vertical],
  ]), new Map(), parent);

  const sizeFor = id => {
    const group = parent.children.find(child => child.userData?.lineId === id);
    const cable = collect(group, object => object.userData?.isFlexibleUtilityCable)[0];
    assert.equal(cable.geometry, cable.userData.utilityLodGeometries.far);
    cable.geometry.computeBoundingBox();
    return cable.geometry.boundingBox.getSize(new THREE_NS.Vector3());
  };
  const xSize = sizeFor(horizontal.id);
  const zSize = sizeFor(vertical.id);
  assert.ok(xSize.x > xSize.z * 5, 'the east/west far cable stays east/west');
  assert.ok(zSize.z > zSize.x * 5, 'the north/south far cable stays north/south');
  builder.dispose(parent);
});
