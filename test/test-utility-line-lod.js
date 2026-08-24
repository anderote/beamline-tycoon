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

  for (const utilityType of UTILITY_TYPE_LIST) {
    const group = parent.children.find(child =>
      child.userData?.lineId === `lod-${utilityType}`);
    assert.ok(group, `${utilityType} creates a committed line group`);
    assert.ok(collect(group, object => object.isMesh && effectivelyVisible(object)).length > 0,
      `${utilityType} retains visible low-detail route geometry`);
    if (UTILITY_TYPES[utilityType].fixedRouteHeight === true) {
      const farRoutes = collect(group, object => object.userData?.isUtilityFarRoute);
      assert.equal(farRoutes.length, 1,
        `${utilityType} collapses its rigid route to one facility-scale mesh`);
      assert.ok(effectivelyVisible(farRoutes[0]),
        `${utilityType} exposes its merged route in the far band`);
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

  builder.setDetailLevel(true);
  assert.ok(detailObjects.every(object => effectivelyVisible(object)),
    'zooming back in restores every authored utility detail');
  assert.ok(collect(parent, object => object.userData?.isUtilityFarRoute)
    .every(object => !effectivelyVisible(object)),
  'zooming back in hides every merged far route');
  assert.equal(flexible.geometry.parameters.radialSegments, 8,
    'soft utilities restore their rounded near tube');
  assert.ok(flexible.geometry.parameters.tubularSegments > farTubularSegments,
    'the near flexible route restores denser longitudinal sampling');

  builder.dispose(parent);
});
