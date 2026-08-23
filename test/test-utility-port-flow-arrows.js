import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {},
          fillStyle: null,
        };
      },
    };
  },
};

const { COMPONENTS } = await import('../src/data/components.js');
const {
  buildPortFitting,
  buildPortFittings,
  portFlowArrowRole,
} = await import('../src/renderer3d/builders/port-fitting-builder.js');
const { portAnchor3D } = await import('../src/utility/port-anchors.js');
const { HV_LOAD_TAP_IDS } = await import('../src/data/hv-load-taps.js');
const { GRID_SERVICE_HV_OUTPUT_MOUNTS } = await import('../src/data/utility-port-anchors.js');

const anchor = { x: 3, y: 1.2, z: -4, out: { x: 0, z: 1 }, standoff: 0.03 };

function arrowOf(fitting) {
  return fitting.children.find(child => child.userData?.isUtilityFlowArrow);
}

function fittingsOf(group) {
  return group.children.filter(child => child.userData?.isUtilityPortFitting);
}

function equipmentArrowOf(group, placeableId) {
  return group.children.find(child => child.userData?.isUtilityEquipmentFlowArrow
    && child.userData.placeableId === placeableId);
}

test('physical port arrows encode source, sink and passive flow roles', () => {
  const source = buildPortFitting(anchor, 'powerCable', 'source');
  const sink = buildPortFitting(anchor, 'powerCable', 'sink');
  const pass = buildPortFitting(anchor, 'powerCable', 'pass');

  assert.equal(arrowOf(source)?.userData.flowDirection, 1,
    'source arrow points outward along the fitting normal');
  assert.equal(arrowOf(sink)?.userData.flowDirection, -1,
    'sink arrow points inward against the fitting normal');
  assert.equal(arrowOf(sink)?.userData.arrowheadPosition, 'outer',
    'the inlet arrowhead stays outside the enclosure where it cannot be hidden');
  assert.equal(arrowOf(pass)?.userData.flowDirection, 0,
    'pass-through fitting carries the double-headed arrow geometry');
  assert.notEqual(arrowOf(source).geometry, arrowOf(sink).geometry,
    'opposite roles use opposite authored arrowheads');
});

test('data fittings are peer connectors with no directional arrow', () => {
  for (const role of ['source', 'sink', 'pass']) {
    const fitting = buildPortFitting(anchor, 'dataFiber', role);
    assert.equal(arrowOf(fitting), undefined,
      `legacy ${role} metadata does not put a direction arrow on a data peer`);
  }
});

test('flow arrows stay faint, physical and attached to the fitting transform', () => {
  const fitting = buildPortFitting(anchor, 'hvCable', 'source');
  const arrow = arrowOf(fitting);
  assert.ok(arrow, 'the fitting owns one direction arrow child');
  assert.equal(arrow.parent, fitting, 'the arrow rotates and moves with its physical fitting');
  assert.equal(arrow.material.transparent, true);
  assert.ok(arrow.material.opacity > 0.2 && arrow.material.opacity < 0.5,
    `the arrow is visible but faint (opacity ${arrow.material.opacity})`);
  assert.equal(arrow.material.depthTest, true,
    'the arrow is occluded by equipment like real painted/illuminated hardware');
  assert.equal(arrow.material.depthWrite, false,
    'the translucent arrow does not punch holes in nearby connector geometry');
});

test('top-mounted fittings orient their hardware and flow arrow vertically', () => {
  const top = buildPortFitting(
    { x: 1, y: 2, z: 3, out: { x: 0, y: 1, z: 0 }, standoff: 0.06 },
    'cryoTransfer',
    'sink',
  );
  const axis = new THREE_REAL.Vector3(1, 0, 0).applyQuaternion(top.quaternion);
  assert.ok(axis.distanceTo(new THREE_REAL.Vector3(0, 1, 0)) < 1e-9,
    'the +X-authored bayonet points along the exact +Y normal');
  assert.equal(arrowOf(top)?.parent, top,
    'the flow arrow inherits the same vertical fitting transform');
});

test('cooling and cabinet RF load taps use tall porcelain roof bushings', () => {
  const endpoints = HV_LOAD_TAP_IDS.map((type, index) => ({
    id: `tap-${index}`, type,
    col: index * 4, row: 0, subCol: 0, subRow: 0, dir: index % 4,
  }));
  const { group } = buildPortFittings(endpoints);
  const fittings = new Map(fittingsOf(group).map(fitting => [
    `${fitting.userData.placeableId}:${fitting.userData.portName}`, fitting,
  ]));

  for (const [index, type] of HV_LOAD_TAP_IDS.entries()) {
    const fitting = fittings.get(`tap-${index}:hv_in`);
    assert.ok(fitting, `${type} has a persistent HV input fitting`);
    assert.equal(fitting.userData.fittingStyle, 'hvInsulator');
    assert.equal(`#${fitting.material.color.getHexString()}`, '#d8d2bc');
    const axis = new THREE_REAL.Vector3(1, 0, 0).applyQuaternion(fitting.quaternion);
    assert.ok(axis.distanceTo(new THREE_REAL.Vector3(0, 1, 0)) < 1e-9,
      `${type} bushing points vertically from the roof`);
    fitting.geometry.computeBoundingBox();
    assert.ok(fitting.geometry.boundingBox.max.x >= 0.19,
      `${type} uses the tall insulator silhouette`);
  }
});

test('off-map utility services use the normal pole and tower terminals', () => {
  const types = ['gridServicePoint', 'gridServicePointHighCapacity'];
  const endpoints = types.map((type, index) => ({
    id: `service-${index}`, type,
    col: index * 4, row: 0, subCol: 0, subRow: 0, dir: 0,
  }));
  const { group } = buildPortFittings(endpoints);
  const fittings = new Map(fittingsOf(group).map(fitting => [
    `${fitting.userData.placeableId}:${fitting.userData.portName}`, fitting,
  ]));

  for (const [typeIndex, type] of types.entries()) {
    const mounts = GRID_SERVICE_HV_OUTPUT_MOUNTS[type];
    const outputNames = Object.entries(COMPONENTS[type].ports)
      .filter(([, spec]) => spec.utility === 'hvCable' && spec.role === 'source')
      .map(([name]) => name);
    assert.equal(outputNames.length, mounts.length,
      `${type} gives every feeder output its own overhead terminal`);

    for (const [portIndex, portName] of outputNames.entries()) {
      const fitting = fittings.get(`service-${typeIndex}:${portName}`);
      const resolved = portAnchor3D(endpoints[typeIndex], COMPONENTS[type], portName);
      assert.ok(fitting, `${type}.${portName} has persistent output hardware`);
      assert.equal(fitting.userData.fittingStyle, 'gland',
        `${type}.${portName} uses the same terminal cap as an ordinary overhead support`);
      assert.equal(COMPONENTS[type].ports[portName].tensionsCable, true,
        `${type}.${portName} tensions cable at its overhead insulator`);
      assert.equal(COMPONENTS[type].ports[portName].maxConnections, 1,
        `${type}.${portName} accepts one player-drawn cable`);
      assert.equal(resolved.y, mounts[portIndex].y);
      assert.deepEqual(resolved.out, mounts[portIndex].normal,
        `${type}.${portName} uses the normal support-terminal approach`);
      const axis = new THREE_REAL.Vector3(1, 0, 0).applyQuaternion(fitting.quaternion);
      assert.ok(axis.distanceTo(new THREE_REAL.Vector3(
        mounts[portIndex].normal.x,
        mounts[portIndex].normal.y,
        mounts[portIndex].normal.z,
      )) < 1e-9, `${type}.${portName} follows the support-terminal axis`);
    }
  }
});

test('distribution-panel fittings inherit their declared in/out roles', () => {
  const endpoint = {
    id: 'panel-1', type: 'powerPanel',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const { group, count } = buildPortFittings([endpoint]);
  const declared = Object.entries(COMPONENTS.powerPanel.ports)
    .filter(([, spec]) => spec?.utility);

  assert.equal(count, declared.length);
  assert.equal(group.children.length, declared.length);
  for (const fitting of group.children) {
    const spec = COMPONENTS.powerPanel.ports[fitting.userData.portName];
    assert.equal(fitting.userData.placeableId, endpoint.id);
    assert.equal(fitting.userData.portRole, spec.role);
    assert.equal(arrowOf(fitting)?.userData.flowRole, spec.role,
      `${fitting.userData.portName} arrow follows its ${spec.role} port declaration`);
  }
  assert.equal(group.children.filter(f => f.userData.portRole === 'sink').length, 1,
    'the HV feeder is visibly the one input');
  assert.equal(group.children.filter(f => f.userData.portRole === 'source').length, 4,
    'the four branch circuits are visibly outputs');
});

test('equipment water fittings expose blue cold, green room, and red hot circuits', () => {
  const endpoints = [
    { id: 'quad', type: 'quadrupole', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
    { id: 'tower', type: 'coolingTower', col: 4, row: 0, subCol: 0, subRow: 0, dir: 0 },
    { id: 'manifold', type: 'coolingManifold', col: 8, row: 0, subCol: 0, subRow: 0, dir: 0 },
    { id: 'chiller', type: 'chiller', col: 12, row: 0, subCol: 0, subRow: 0, dir: 0 },
    { id: 'dist', type: 'waterDistributor2', col: 16, row: 0, subCol: 0, subRow: 0, dir: 0 },
  ];
  const { group } = buildPortFittings(endpoints);
  const fittings = new Map(fittingsOf(group).map(fitting => [
    `${fitting.userData.placeableId}:${fitting.userData.portName}`, fitting,
  ]));
  const hex = fitting => `#${fitting.material.color.getHexString()}`;

  assert.equal(hex(fittings.get('quad:cool_in')), '#287fc4');
  assert.equal(hex(fittings.get('quad:hot_out')), '#c45b42');
  assert.equal(hex(fittings.get('tower:hot_in')), '#c45b42');
  assert.equal(hex(fittings.get('tower:room_out')), '#4f9b72');
  assert.equal(arrowOf(fittings.get('tower:hot_in'))?.userData.flowRole, 'sink');
  assert.equal(arrowOf(fittings.get('tower:room_out'))?.userData.flowRole, 'source');
  assert.equal(hex(fittings.get('chiller:room_in')), '#4f9b72');
  assert.equal(hex(fittings.get('chiller:supply_cold_out')), '#287fc4');
  assert.equal(hex(fittings.get('chiller:return_hot_in')), '#c45b42');
  assert.equal(hex(fittings.get('chiller:reject_hot_out')), '#c45b42');
  assert.equal(arrowOf(fittings.get('chiller:return_hot_in'))?.userData.flowRole, 'sink');
  assert.equal(arrowOf(fittings.get('chiller:reject_hot_out'))?.userData.flowRole, 'source');
  assert.equal(hex(fittings.get('dist:water_line_1')), '#287fc4');
  assert.equal(hex(fittings.get('dist:water_line_2')), '#c45b42');
  assert.equal(hex(fittings.get('dist:supply_pipe_1')), '#287fc4');
  assert.equal(hex(fittings.get('dist:supply_pipe_2')), '#c45b42');
  assert.equal(hex(fittings.get('manifold:supply_cold')), '#287fc4');
  assert.equal(hex(fittings.get('manifold:supply_hot')), '#c45b42');
  assert.equal(hex(fittings.get('manifold:cold_1')), '#287fc4');
  assert.equal(hex(fittings.get('manifold:hot_1')), '#c45b42');
});

test('supports and symmetric HV wall feedthrough terminals stay nondirectional', () => {
  assert.equal(portFlowArrowRole('hv_in', 'pass'), 'sink');
  assert.equal(portFlowArrowRole('hv_out_4', 'pass'), 'source');
  assert.equal(portFlowArrowRole('bus_1', 'pass'), 'pass');
  const pole = {
    id: 'pole', type: 'utilityPole',
    col: 1, row: 2, subCol: 0, subRow: 0, dir: 1,
  };
  const feed = {
    id: 'feed', type: 'hvWallPassThrough', col: 4, row: 5,
    subCol: 0, subRow: 0, dir: 3,
    wallMount: { col: 4, row: 5, edge: 'n', off: 1, faceOffset: 0.0625 },
  };
  const rack = {
    id: 'rack', type: 'indoorHvCableRack',
    col: 7, row: 2, subCol: 0, subRow: 0, dir: 0,
  };
  const { group } = buildPortFittings([pole, rack, feed]);
  const fittings = new Map(fittingsOf(group).map(fitting => [
    `${fitting.userData.placeableId}:${fitting.userData.portName}`, fitting,
  ]));
  assert.equal(arrowOf(fittings.get('pole:hv_in'))?.userData.flowRole, 'pass');
  assert.equal(arrowOf(fittings.get('pole:hv_out'))?.userData.flowRole, 'pass');
  assert.equal(arrowOf(fittings.get('rack:hv_1'))?.userData.flowRole, 'pass');
  assert.equal(arrowOf(fittings.get('rack:hv_4'))?.userData.flowRole, 'pass');
  assert.equal(arrowOf(fittings.get('feed:hv_in'))?.userData.flowRole, 'pass');
  assert.equal(arrowOf(fittings.get('feed:hv_out'))?.userData.flowRole, 'pass');
  assert.equal(arrowOf(fittings.get('feed:hv_in'))?.userData.arrowheadPosition, 'both');
  assert.equal(arrowOf(fittings.get('feed:hv_out'))?.userData.arrowheadPosition, 'both');
  assert.equal(fittings.get('feed:hv_in')?.userData.portRole, 'pass',
    'visual direction does not change the pass-through topology role');
});

test('every 4x4 HV wall feedthrough terminal presents symmetric flow', () => {
  const feed = {
    id: 'feed-4x4', type: 'hvWallPassThrough4x4', col: 4, row: 5,
    subCol: 0, subRow: 0, dir: 3,
    wallMount: { col: 4, row: 5, edge: 'n', off: 0, span: 4, faceOffset: 0.0625 },
  };
  const { group } = buildPortFittings([feed]);
  const fittings = new Map(fittingsOf(group).map(fitting => [
    fitting.userData.portName, fitting,
  ]));
  for (let index = 1; index <= 4; index++) {
    const inlet = fittings.get(`hv_in_${index}`);
    const outlet = fittings.get(`hv_out_${index}`);
    for (const fitting of [inlet, outlet]) {
      assert.equal(arrowOf(fitting).userData.flowDirection, 0,
        `pair ${index} has no preferred flow direction on either face`);
      assert.equal(arrowOf(fitting).userData.arrowheadPosition, 'both',
        `pair ${index} uses a double-headed terminal arrow on either face`);
    }
  }
  assert.equal(equipmentArrowOf(group, feed.id), undefined,
    'the feedthrough body has no inlet-to-outlet arrow');
});

test('only directional equipment carries a body-level flow arrow', () => {
  const endpoints = [
    { id: 'pole', type: 'utilityPole', col: 1, row: 2, subCol: 0, subRow: 0, dir: 1 },
    { id: 'tower', type: 'transmissionTower', col: 12, row: 8, subCol: 0, subRow: 0, dir: 2 },
    { id: 'rack', type: 'indoorHvCableRack', col: 10, row: 2, subCol: 0, subRow: 0, dir: 0 },
    {
      id: 'feed', type: 'hvWallPassThrough', col: 4, row: 5,
      subCol: 0, subRow: 0, dir: 3,
      wallMount: { col: 4, row: 5, edge: 'n', off: 1, faceOffset: 0.0625 },
    },
    { id: 'xfmr', type: 'facilityTransformer', col: 8, row: 3, subCol: 0, subRow: 0, dir: 1 },
  ];
  const { group } = buildPortFittings(endpoints);
  for (const endpoint of endpoints.slice(0, 4)) {
    assert.equal(equipmentArrowOf(group, endpoint.id), undefined,
      `${endpoint.type} has no misleading cross-insulator body arrow`);
  }
  for (const endpoint of endpoints.slice(4)) {
    const marker = equipmentArrowOf(group, endpoint.id);
    assert.ok(marker, `${endpoint.type} has a body-level direction arrow`);
    assert.ok(marker.userData.fromPortNames.every(name => name.includes('_in')),
      'arrow origins are authored inlet ports');
    assert.ok(marker.userData.toPortNames.every(name => name.includes('_out')),
      'arrow destinations are authored outlet ports');
    const worldForward = new THREE_REAL.Vector3(1, 0, 0)
      .applyQuaternion(marker.quaternion);
    const expected = marker.userData.flowDirection;
    assert.ok(worldForward.dot(new THREE_REAL.Vector3(expected.x, 0, expected.z)) > 0.999,
      'the painted arrow rotates toward the equipment outlets');
  }
});

test('control-room ports and flow arrows live on the visible rear panel', () => {
  const capture = {
    id: 'capture', type: 'serverRack',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const compute = {
    id: 'compute', type: 'cpuComputeRack',
    col: 2, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const captureData = portAnchor3D(capture, COMPONENTS.serverRack, 'data_out');
  const capturePower = portAnchor3D(capture, COMPONENTS.serverRack, 'pwr_in');
  const computeData = portAnchor3D(compute, COMPONENTS.cpuComputeRack, 'data_in');
  const computePower = portAnchor3D(compute, COMPONENTS.cpuComputeRack, 'pwr_in');

  assert.equal(COMPONENTS.serverRack.parts.find(part => part.name === 's1a').z < 0, true,
    'the detailed capture rack status lights are on local -Z');
  assert.equal(captureData.out.z, 1,
    'the capture-rack data connector points out of the opposite +Z rear');
  assert.equal(capturePower.out.z, 1,
    'the capture-rack power connector shares that rear panel');
  assert.ok(COMPONENTS.cpuComputeRack.faces?.['+Z']?.decal,
    'the simple compute rack declares its visible front decal on +Z');
  assert.equal(computeData.out.z, -1,
    'the compute-rack data connector points out of the opposite -Z rear');
  assert.equal(computePower.out.z, -1,
    'the compute-rack power connector shares that rear panel');

  const { group, count } = buildPortFittings([capture, compute]);
  assert.equal(count, 4);
  const fittings = new Map(group.children.map(fitting => [
    `${fitting.userData.placeableId}:${fitting.userData.portName}`, fitting,
  ]));
  assert.equal(arrowOf(fittings.get('capture:data_out')), undefined,
    'the capture data peer has no directional arrow');
  assert.equal(arrowOf(fittings.get('capture:pwr_in'))?.userData.flowDirection, -1,
    'the capture power arrow points inward through its rear input');
  assert.equal(arrowOf(fittings.get('compute:data_in')), undefined,
    'the compute data peer has no directional arrow');
});
