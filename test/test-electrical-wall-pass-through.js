// Electrical cable handling at building walls and on utility poles.
//
// The contract is physical as well as topological: power/HV runs cannot cross
// wall slabs, wall feedthroughs bridge two separately terminated runs, and
// utility poles expose real high crossarm terminals for suspended HV spans.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0, height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {}, fillStyle: null,
        };
      },
    };
  },
};

const { COMPONENTS } = await import('../src/data/components.js');
const { PLACEABLES } = await import('../src/data/placeables/index.js');
const { getUtilityPortsV2 } = await import('../src/data/utility-ports-v2.js');
const {
  canPlaceWallFixture,
} = await import('../src/game/placement.js');
const {
  wallFixturePose,
} = await import('../src/game/wall-fixture-geometry.js');
const {
  portAnchor3D,
} = await import('../src/utility/port-anchors.js');
const {
  portWorldPosition,
} = await import('../src/utility/ports.js');
const {
  validateDrawLine,
} = await import('../src/utility/line-drawing.js');
const {
  discoverNetworks,
  makeDefaultPortLookup,
} = await import('../src/utility/network-discovery.js');
const {
  buildSoftCableWorldPoints,
  isTensionedHvCable,
} = await import('../src/renderer3d/utility-line-builder-v2.js');
const {
  componentPose,
} = await import('../src/renderer3d/component-builder.js');

const crossingWall = { '1,0,e': 'officeWall' }; // boundary col=2, row 0..1
const directCrossing = [{ col: 0.5, row: 0.5 }, { col: 2.5, row: 0.5 }];

function openState(extra = {}) {
  return {
    placeables: [], beamPipes: [], utilityLines: new Map(),
    wallOccupied: {},
    ...extra,
  };
}

function candidate(state, utilityType, start, end) {
  return validateDrawLine(state, {
    utilityType, start, end,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  });
}

test('Power palette provides two real wall-mounted electrical feedthroughs', () => {
  for (const [id, utility, names] of [
    ['powerWallPassThrough', 'powerCable', ['pwr_in', 'pwr_out']],
    ['hvWallPassThrough', 'hvCable', ['hv_in', 'hv_out']],
  ]) {
    const def = PLACEABLES[id];
    assert.equal(def.kind, 'infrastructure');
    assert.equal(def.category, 'power');
    assert.equal(def.mount, 'wall');
    assert.equal(def.wallPassThrough, true);
    assert.ok(def.cost.funding > 0);
    assert.ok(Array.isArray(def.parts) && def.parts.length >= 4);
    // A wall edge is divided into four 0.5 m mounting slots. Parts are
    // authored in half-metre sub-units, so a one-slot face must stay <= 1.0
    // sub-units wide or it visually collides with neighboring wall hardware.
    assert.ok(def.parts.every(part => (part.w || 1) <= 1.0),
      `${id} face hardware fits one wall slot`);
    const ports = getUtilityPortsV2(id);
    assert.deepEqual(Object.keys(ports), names);
    assert.ok(Object.values(ports).every(port =>
      port.utility === utility && port.role === 'pass'));
    assert.deepEqual(new Set(Object.values(ports).map(port => port.side)),
      new Set(['front', 'back']));
  }
});

test('A wall feedthrough reserves the matching slot on both wall faces', () => {
  const north = { col: 4, row: 4, edge: 'n', off: 1 };
  const south = { col: 4, row: 3, edge: 's', off: 2 };
  const game = {
    state: {
      wallOccupied: { '4,4,n': 'officeWall' },
      placeables: [],
    },
  };
  assert.equal(canPlaceWallFixture(game, PLACEABLES.powerWallPassThrough, north).ok, true);
  game.state.placeables.push({
    id: 'feed', type: 'powerWallPassThrough', wallMount: north,
  });
  assert.equal(canPlaceWallFixture(game, PLACEABLES.wallSconce, south).ok, false);
  assert.equal(canPlaceWallFixture(
    game, PLACEABLES.wallSconce, { ...south, off: 1 },
  ).ok, true);
});

test('Feedthrough ports and committed component pose land on opposite wall faces', () => {
  const wallMount = { col: 3, row: 5, edge: 'n', off: 1, faceOffset: 0.0625 };
  const entry = {
    id: 'feed', type: 'powerWallPassThrough', col: 3, row: 5,
    subCol: 0, subRow: 0, dir: 3, wallMount,
  };
  const def = COMPONENTS.powerWallPassThrough;
  const input = portWorldPosition(entry, def, 'pwr_in');
  const output = portWorldPosition(entry, def, 'pwr_out');
  const wallZ = wallMount.row * 2;
  assert.ok(input.z > wallZ && output.z < wallZ,
    `ports straddle wall plane ${wallZ} (${input.z}, ${output.z})`);

  const mirrored = { ...entry, portsFlipped: true };
  assert.ok(portWorldPosition(mirrored, def, 'pwr_in').z < wallZ,
    'M-mirroring swaps the input onto the far face');

  const expected = wallFixturePose(wallMount, 0);
  const pose = componentPose(def, {
    col: entry.col, row: entry.row, subCol: 0, subRow: 0,
    direction: entry.dir, wallMount,
  }, true);
  assert.equal(pose.x, expected.x);
  assert.equal(pose.z, expected.z);
  assert.equal(pose.rotY, expected.yaw);

  const shielded = {
    ...entry,
    wallMount: { ...wallMount, faceOffset: 0.275 },
  };
  const shieldedIn = portWorldPosition(shielded, def, 'pwr_in');
  const shieldedOut = portWorldPosition(shielded, def, 'pwr_out');
  assert.ok(shieldedIn.z > wallZ + 0.275 && shieldedOut.z < wallZ - 0.275,
    'both terminals clear a thick shielding-wall slab');
});

test('HV wall feedthrough terminals accept cables from every cardinal direction', () => {
  const state = openState({
    placeables: [{ id: 'feed', type: 'hvWallPassThrough', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 }],
  });
  const paths = [
    [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    [{ col: 0, row: 0 }, { col: -1, row: 0 }],
    [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    [{ col: 0, row: 0 }, { col: 0, row: -1 }],
  ];
  for (const portName of ['hv_in', 'hv_out']) {
    for (const path of paths) {
      assert.equal(validateDrawLine(state, {
        utilityType: 'hvCable', start: { placeableId: 'feed', portName }, path,
      }).ok, true, `${portName} accepts ${JSON.stringify(path[1])}`);
    }
  }
});

test('4×4 HV wall feedthrough keeps four omnidirectional, un-rated conductors isolated', () => {
  const def = PLACEABLES.hvWallPassThrough4x4;
  const ports = getUtilityPortsV2(def.id);
  assert.equal(def.wallSpan, 4);
  assert.equal(Object.keys(ports).length, 8);
  assert.ok(Object.values(ports).every(port =>
    port.utility === 'hvCable' && port.role === 'pass'
      && port.omnidirectional === true && Object.keys(port.params).length === 0),
  'the bushing publishes no internal power or capacity limit');
  assert.deepEqual(def.electricalGroups.hvCable, [
    ['hv_in_1', 'hv_out_1'], ['hv_in_2', 'hv_out_2'],
    ['hv_in_3', 'hv_out_3'], ['hv_in_4', 'hv_out_4'],
  ]);

  const state = openState({
    placeables: [{ id: 'feed', type: def.id, col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 }],
    utilityLines: new Map(Array.from({ length: 4 }, (_, index) => {
      const n = index + 1;
      return [`line-${n}`, {
        id: `line-${n}`, utilityType: 'hvCable',
        start: { placeableId: 'feed', portName: `hv_in_${n}` },
        end: { placeableId: 'feed', portName: `hv_out_${n}` },
        path: [{ col: n * 3, row: 0 }, { col: n * 3 + 1, row: 0 }],
      }];
    })),
  });
  const networks = discoverNetworks('hvCable', state.utilityLines, makeDefaultPortLookup(state));
  assert.equal(networks.length, 4, 'each numbered front/back pair is isolated from the other three');
});

test('Power and HV inspect the visible cable trace and refuse wall crossings', () => {
  const state = openState({ wallOccupied: crossingWall });
  for (const utilityType of ['powerCable', 'hvCable']) {
    const result = validateDrawLine(state, { utilityType, path: directCrossing });
    assert.equal(result.reason, 'wall_pass_through_required', utilityType);
  }

  const hiddenRouteAroundWall = [
    { col: 0.5, row: 0.5 }, { col: 0.5, row: 1.5 },
    { col: 2.5, row: 1.5 }, { col: 2.5, row: 0.5 },
  ];
  assert.equal(validateDrawLine(state, {
    utilityType: 'powerCable',
    path: hiddenRouteAroundWall,
    cablePath: directCrossing,
  }).reason, 'wall_pass_through_required',
  'a hidden route around the wall cannot legalize a visible cable through it');

  assert.equal(validateDrawLine(state, {
    utilityType: 'powerCable',
    path: directCrossing,
    cablePath: hiddenRouteAroundWall,
  }).ok, true,
  'a visibly routed cable around the wall is legal even if its hidden compatibility path crosses');
});

test('Fabricated pipes, waveguides and cryogenic services retain wall crossing', () => {
  const state = openState({ wallOccupied: crossingWall });
  for (const utilityType of [
    'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer',
  ]) {
    const result = validateDrawLine(state, { utilityType, path: directCrossing });
    assert.equal(result.ok, true, `${utilityType}: ${result.reason || 'ok'}`);
  }
});

test('Feedthrough and pole connection kinds preserve the radial electrical chain', () => {
  const powerState = openState({
    placeables: [
      { id: 'panel', type: 'powerPanel', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'feed', type: 'powerWallPassThrough', col: 2, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'load', type: 'quadrupole', col: 4, row: 0, subCol: 0, subRow: 0, dir: 0 },
    ],
  });
  assert.equal(candidate(powerState, 'powerCable',
    { placeableId: 'panel', portName: 'pwr_out_1' },
    { placeableId: 'feed', portName: 'pwr_in' }).ok, true);
  assert.equal(candidate(powerState, 'powerCable',
    { placeableId: 'feed', portName: 'pwr_out' },
    { placeableId: 'load', portName: 'pwr_in' }).ok, true);

  const hvState = openState({
    placeables: [
      { id: 'supply', type: 'facilityTransformer', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'poleA', type: 'utilityPole', col: 3, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'poleB', type: 'utilityPole', col: 6, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'panel', type: 'powerPanel', col: 9, row: 0, subCol: 0, subRow: 0, dir: 0 },
    ],
  });
  const refs = (placeableId, portName) => ({ placeableId, portName });
  assert.equal(candidate(hvState, 'hvCable', refs('supply', 'hv_out_1'), refs('poleA', 'hv_in')).ok, true);
  assert.equal(candidate(hvState, 'hvCable', refs('poleA', 'hv_out'), refs('poleB', 'hv_in')).ok, true);
  assert.equal(candidate(hvState, 'hvCable', refs('poleB', 'hv_out'), refs('panel', 'hv_in')).ok, true);

  hvState.utilityLines = new Map([
    ['a', { id: 'a', utilityType: 'hvCable', start: refs('supply', 'hv_out_1'), end: refs('poleA', 'hv_in'), path: [{ col: 0, row: 0 }, { col: 1, row: 0 }] }],
    ['b', { id: 'b', utilityType: 'hvCable', start: refs('poleA', 'hv_out'), end: refs('poleB', 'hv_in'), path: [{ col: 2, row: 0 }, { col: 3, row: 0 }] }],
    ['c', { id: 'c', utilityType: 'hvCable', start: refs('poleB', 'hv_out'), end: refs('panel', 'hv_in'), path: [{ col: 4, row: 0 }, { col: 5, row: 0 }] }],
  ]);
  const networks = discoverNetworks(
    'hvCable', hvState.utilityLines, makeDefaultPortLookup(hvState),
  );
  assert.equal(networks.length, 1);
  assert.ok(networks[0].sources.some(port => port.placeableId === 'supply'));
  assert.ok(networks[0].sinks.some(port => port.placeableId === 'panel'));
});

test('Utility-pole terminals pull an HV span straight and taut', () => {
  const def = COMPONENTS.utilityPole;
  const a = { id: 'a', type: 'utilityPole', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
  const b = { id: 'b', type: 'utilityPole', col: 0, row: 6, subCol: 0, subRow: 0, dir: 0 };
  const start = portAnchor3D(a, def, 'hv_out');
  const end = portAnchor3D(b, def, 'hv_in');
  assert.equal(start.y, 6.4);
  assert.equal(end.y, 6.4);
  const line = {
    utilityType: 'hvCable',
    start: { placeableId: 'a', portName: 'hv_out' },
    end: { placeableId: 'b', portName: 'hv_in' },
    path: [{ col: 0, row: 0 }, { col: 4, row: 3 }, { col: 0, row: 6 }],
    cablePath: [{ col: 0, row: 0 }, { col: 4, row: 3 }, { col: 0, row: 6 }],
  };
  const endpoints = new Map([['a', a], ['b', b]]);
  assert.equal(isTensionedHvCable(line, endpoints), true);
  const cable = buildSoftCableWorldPoints(line, endpoints);
  assert.ok(cable.length >= 8);
  const first = cable[0];
  const last = cable[cable.length - 1];
  for (let index = 0; index < cable.length; index++) {
    const t = index / (cable.length - 1);
    assert.ok(cable[index].distanceTo(first.clone().lerp(last, t)) < 1e-8,
      'every sample remains on the straight support-to-support chord');
  }
});

test('An HV wall pass-through tensions its attached feeder', () => {
  const feed = {
    id: 'feed', type: 'hvWallPassThrough', col: 3, row: 5,
    subCol: 0, subRow: 0, dir: 3,
    wallMount: { col: 3, row: 5, edge: 'n', off: 1, faceOffset: 0.0625 },
  };
  const transformer = {
    id: 'transformer', type: 'padMountTransformer',
    col: 3, row: 1, subCol: 0, subRow: 0, dir: 1,
  };
  const line = {
    utilityType: 'hvCable',
    start: { placeableId: 'transformer', portName: 'hv_out_1' },
    end: { placeableId: 'feed', portName: 'hv_in' },
    path: [{ col: 3, row: 1 }, { col: 8, row: 3 }, { col: 3, row: 5 }],
    cablePath: [{ col: 3, row: 1 }, { col: 8, row: 3 }, { col: 3, row: 5 }],
  };
  const endpoints = new Map([['feed', feed], ['transformer', transformer]]);
  assert.equal(isTensionedHvCable(line, endpoints), true);
  const cable = buildSoftCableWorldPoints(line, endpoints);
  const first = cable[0];
  const last = cable[cable.length - 1];
  assert.ok(cable.every((point, index) => point.distanceTo(
    first.clone().lerp(last, index / (cable.length - 1)),
  ) < 1e-8), 'the pass-through removes drawn slack and holds the cable taut');
});

test('A live HV draw from a tower stays taut to its open cursor end', () => {
  const tower = {
    id: 'tower', type: 'transmissionTower',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const line = {
    utilityType: 'hvCable', tensioned: true,
    path: [{ col: 0, row: 0 }, { col: 3, row: 4 }],
    cablePath: [{ col: 0, row: 0 }, { col: 2, row: 5 }, { col: 3, row: 4 }],
  };
  const start = portAnchor3D(tower, COMPONENTS.transmissionTower, 'hv_out');
  const cable = buildSoftCableWorldPoints(line, null, { start, end: null });
  const first = cable[0];
  const last = cable[cable.length - 1];
  assert.ok(cable.every((point, index) => point.distanceTo(
    first.clone().lerp(last, index / (cable.length - 1)),
  ) < 1e-8), 'the draw preview ignores mouse-trace slack at a tension support');
  assert.ok(first.y > last.y, 'the straight preview reaches down from tower height to the cursor plane');
});
