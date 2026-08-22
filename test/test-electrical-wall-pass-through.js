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
const { WALL_TYPES } = await import('../src/data/structure.js');
const { getUtilityPortsV2 } = await import('../src/data/utility-ports-v2.js');
const {
  canPlaceWallFixture,
} = await import('../src/game/placement.js');
const {
  wallFixturePose,
} = await import('../src/game/wall-fixture-geometry.js');
const {
  portAnchor3D,
  setModelBoundsProvider,
} = await import('../src/utility/port-anchors.js');
const {
  availablePorts,
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
  getModelBounds,
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

test('Power palette retires the low-voltage feedthrough and keeps HV wall entry', () => {
  assert.equal(PLACEABLES.hvWallPassThrough2x2, undefined,
    'the retired half-wall HV feedthrough is absent from the catalogue');
  assert.equal(PLACEABLES.powerWallPassThrough.deprecated, true,
    'old low-voltage fittings remain loadable only for save compatibility');
  for (const [id, utility, names] of [
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
    if (utility === 'hvCable') {
      assert.equal(def.utilityFlowPresentation, 'symmetric');
      assert.deepEqual(new Set(Object.values(ports).map(port => port.connectionKind)),
        new Set(['hvPassThrough']),
        'both HV faces publish the same passive connection kind');
    }
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
  assert.equal(def.utilityFlowPresentation, 'symmetric');
  assert.equal(Object.keys(ports).length, 8);
  assert.ok(Object.values(ports).every(port =>
    port.utility === 'hvCable' && port.role === 'pass'
      && port.connectionKind === 'hvPassThrough'
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

test('indoor HV rack is a six-point bus with inset overhead terminals and two crossbar-height taps', () => {
  const def = PLACEABLES.indoorHvCableRack;
  const ports = getUtilityPortsV2(def.id);
  assert.equal(def.kind, 'infrastructure');
  assert.equal(def.category, 'power');
  assert.equal(def.subsection, 'routingHardware');
  assert.equal(def.subW, 4);
  assert.equal(def.subL, 2);
  assert.equal(def.subH, 5, 'the full bracket stays inside a 2.5 m envelope');
  assert.deepEqual(Object.keys(ports), [
    'hv_1', 'hv_2', 'hv_3', 'hv_4', 'hv_tap_left', 'hv_tap_right',
  ]);
  assert.ok(Object.values(ports).slice(0, 4).every(port =>
    port.utility === 'hvCable' && port.role === 'pass'
      && port.omnidirectional === true && port.maxConnections === 2),
  'every saddle is a two-segment omnidirectional HV support');
  assert.ok(Object.values(ports).slice(4).every(port =>
    port.utility === 'hvCable' && port.role === 'pass'
      && port.connectionKind === 'hvDistributionTap'
      && port.omnidirectional === true && port.maxConnections === 1),
  'both leg taps accept one ordinary HV feeder');
  assert.deepEqual(def.electricalGroups.hvCable, [[
    'hv_1', 'hv_2', 'hv_3', 'hv_4', 'hv_tap_left', 'hv_tap_right',
  ]], 'all six rack terminals share one passive HV bus');

  const rack = {
    id: 'rack', type: def.id, col: 0, row: 0,
    subCol: 0, subRow: 0, dir: 0,
  };
  setModelBoundsProvider(() => ({
    minX: -1, maxX: 1, minY: 0, maxY: 2.45, minZ: -0.5, maxZ: 0.5,
  }));
  const overheadAnchors = ['hv_1', 'hv_2', 'hv_3', 'hv_4']
    .map(name => portAnchor3D(rack, COMPONENTS[def.id], name));
  assert.deepEqual(overheadAnchors.map(anchor => anchor.x), [0.4, 0.8, 1.2, 1.6],
    'the inset row keeps a uniform 0.4 m pitch clear of the uprights');
  assert.ok(overheadAnchors.every(anchor => anchor.y === 2.00 && anchor.z === 0.5),
    'all cable attachments sit at the hanging-insulator tips below the crossbar centreline');
  const sideTaps = ['hv_tap_left', 'hv_tap_right']
    .map(name => portAnchor3D(rack, COMPONENTS[def.id], name));
  assert.ok(sideTaps.every((anchor, index) =>
    Math.abs(anchor.x - [0.02, 1.98][index]) < 1e-9));
  assert.ok(sideTaps.every(anchor => anchor.y === 2.00 && anchor.z === 0.5),
    'both leg taps share the hanging crossbar-terminal height');
  const sideTapCaps = def.parts.filter(part => /^hv-tap-(left|right)-cap$/.test(part.name));
  assert.equal(sideTapCaps.length, 2, 'both side taps render a metal attachment cap');
  assert.ok(sideTapCaps.every(part =>
    Math.abs((part.y + part.h / 2) * 0.5 - 2.00) < 1e-9),
  'both visible tap caps are centred on the crossbar-terminal height');
  const visualTop = Math.max(...def.parts.map(part => ((part.y || 0) + (part.h || 1)) * 0.5));
  assert.ok(visualTop > 2.35 && visualTop < 2.5,
    'the metal bracket clears its cables but remains below the indoor ceiling envelope');
  setModelBoundsProvider(null);

  const lines = new Map();
  for (let index = 1; index <= 4; index++) {
    for (let segment = 0; segment < 2; segment++) {
      const id = `cable-${index}-${segment}`;
      lines.set(id, {
        id, utilityType: 'hvCable',
        start: { placeableId: rack.id, portName: `hv_${index}` }, end: null,
        path: [
          { col: segment * 3, row: index * 3 },
          { col: segment * 3 + 1, row: index * 3 },
        ],
      });
    }
  }
  for (const side of ['left', 'right']) {
    lines.set(`tap-${side}`, {
      id: `tap-${side}`, utilityType: 'hvCable',
      start: { placeableId: rack.id, portName: `hv_tap_${side}` }, end: null,
      path: [{ col: side === 'left' ? -3 : 3, row: 0 }, { col: 0, row: 0 }],
    });
  }
  const state = openState({ placeables: [rack], utilityLines: lines });
  const networks = discoverNetworks('hvCable', lines, makeDefaultPortLookup(state));
  assert.equal(networks.length, 1,
    'a live feeder on any overhead terminal or side tap reaches all six rack points');
  assert.equal(isTensionedHvCable(lines.get('cable-1-0'), new Map([[rack.id, rack]])), true,
    'the indoor bracket applies the suspended HV tension-and-sag presentation');
  assert.equal(isTensionedHvCable(lines.get('tap-left'), new Map([[rack.id, rack]])), true,
    'a crossbar-height side tap applies the same cable tension as a utility-pole support');
});

test('one-way indoor HV rack is one pole with one top-supported conductor', () => {
  const def = PLACEABLES.indoorHvCableRack1Way;
  const ports = getUtilityPortsV2(def.id);
  assert.equal(def.kind, 'infrastructure');
  assert.equal(def.category, 'power');
  assert.equal(def.subsection, 'routingHardware');
  assert.equal(def.mount, 'overhead');
  assert.equal(def.hvCableSupport, 'indoorRack');
  assert.equal(def.subW, 1);
  assert.equal(def.subL, 2);
  assert.equal(def.subH, 5);
  assert.deepEqual(Object.keys(ports), ['hv_1']);
  assert.deepEqual(ports.hv_1, {
    utility: 'hvCable', side: 'front', offsetAlong: 0.5,
    role: 'pass', omnidirectional: true, maxConnections: 2, params: {},
  });

  assert.equal(def.parts.filter(part => part.name === 'upright').length, 1);
  assert.equal(def.parts.filter(part => part.name === 'foot').length, 1);
  assert.equal(def.parts.filter(part => part.name === 'insulator-stem').length, 1);
  assert.equal(def.parts.filter(part => part.name === 'terminal-cap').length, 1);
  assert.equal(def.parts.some(part => /crossbar|hv-tap/.test(part.name)), false,
    'the one-way support is only a pole and top insulator');

  const rack = {
    id: 'rack-1-way', type: def.id, col: 0, row: 0,
    subCol: 0, subRow: 0, dir: 0,
  };
  setModelBoundsProvider(() => ({
    minX: -0.25, maxX: 0.25, minY: 0, maxY: 2.05, minZ: -0.5, maxZ: 0.5,
  }));
  const anchor = portAnchor3D(rack, COMPONENTS[def.id], 'hv_1');
  assert.deepEqual({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0.25, y: 2.00, z: 0.5 },
    'the HV cable lands on the insulator cap at the pole top');
  assert.deepEqual(anchor.out, { x: 0, y: 1, z: 0 },
    'the terminal fitting faces upward along the top-mounted insulator');
  setModelBoundsProvider(null);

  const lines = new Map([0, 1].map(segment => [`wire-${segment}`, {
    id: `wire-${segment}`, utilityType: 'hvCable',
    start: { placeableId: rack.id, portName: 'hv_1' }, end: null,
    path: [{ col: segment * 2, row: 0 }, { col: segment * 2 + 1, row: 0 }],
  }]));
  const state = openState({ placeables: [rack], utilityLines: lines });
  const networks = discoverNetworks('hvCable', lines, makeDefaultPortLookup(state));
  assert.equal(networks.length, 1,
    'both cable segments remain continuous through the single support point');
  assert.ok([...lines.values()].every(line => (
    isTensionedHvCable(line, new Map([[rack.id, rack]]))
  )), 'both attachments use suspended HV tension and sag');
});

test('compact indoor HV rack is an L-frame three-point bus for two overhead wires', () => {
  const def = PLACEABLES.indoorHvCableRack2Way;
  const ports = getUtilityPortsV2(def.id);
  assert.equal(def.kind, 'infrastructure');
  assert.equal(def.category, 'power');
  assert.equal(def.subsection, 'routingHardware');
  assert.equal(def.mount, 'overhead');
  assert.equal(def.hvCableSupport, 'indoorRack');
  assert.equal(def.subW, 2);
  assert.equal(def.subL, 2);
  assert.equal(def.subH, 5);
  assert.deepEqual(Object.keys(ports), ['hv_1', 'hv_2', 'hv_tap_left']);
  assert.ok(['hv_1', 'hv_2'].every(name => {
    const port = ports[name];
    return port.utility === 'hvCable' && port.role === 'pass'
      && port.omnidirectional === true && port.maxConnections === 2;
  }), 'both hanging terminals support two cable segments');
  assert.equal(ports.hv_tap_left.connectionKind, 'hvDistributionTap');
  assert.equal(ports.hv_tap_left.maxConnections, 1);
  assert.deepEqual(def.electricalGroups.hvCable, [[
    'hv_1', 'hv_2', 'hv_tap_left',
  ]], 'both conductors and the side tap share one passive HV bus');

  assert.equal(def.parts.filter(part => part.name === 'upright').length, 1);
  assert.equal(def.parts.filter(part => part.name === 'foot').length, 1);
  assert.equal(def.parts.filter(part => /^insulator-\d+-stem$/.test(part.name)).length, 2);
  assert.equal(def.parts.filter(part => part.name === 'hv-tap-left-cap').length, 1);
  const upright = def.parts.find(part => part.name === 'upright');
  const crossbar = def.parts.find(part => part.name === 'crossbar');
  assert.ok(upright.x < 0 && crossbar.x + crossbar.w / 2 > 0.9,
    'one edge upright and a cantilevered crossbar form the compact L-frame');

  const rack = {
    id: 'rack-2-way', type: def.id, col: 0, row: 0,
    subCol: 0, subRow: 0, dir: 0,
  };
  setModelBoundsProvider(() => ({
    minX: -0.5, maxX: 0.5, minY: 0, maxY: 2.45, minZ: -0.5, maxZ: 0.5,
  }));
  const overheadAnchors = ['hv_1', 'hv_2']
    .map(name => portAnchor3D(rack, COMPONENTS[def.id], name));
  assert.deepEqual(overheadAnchors.map(anchor => anchor.x), [0.4, 0.8]);
  assert.ok(overheadAnchors.every(anchor => anchor.y === 2.00 && anchor.z === 0.5),
    'the two visible insulator tips carry the overhead wires at rack height');
  const tapAnchor = portAnchor3D(rack, COMPONENTS[def.id], 'hv_tap_left');
  assert.ok(Math.abs(tapAnchor.x - 0.01) < 1e-9
    && tapAnchor.y === 2.00 && tapAnchor.z === 0.5,
  'the single side tap lands on the outside cap of the upright');
  setModelBoundsProvider(null);

  const lines = new Map([
    ['wire-1', {
      id: 'wire-1', utilityType: 'hvCable',
      start: { placeableId: rack.id, portName: 'hv_1' }, end: null,
      path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    }],
    ['wire-2', {
      id: 'wire-2', utilityType: 'hvCable',
      start: { placeableId: rack.id, portName: 'hv_2' }, end: null,
      path: [{ col: 0, row: 1 }, { col: 1, row: 1 }],
    }],
    ['tap', {
      id: 'tap', utilityType: 'hvCable',
      start: { placeableId: rack.id, portName: 'hv_tap_left' }, end: null,
      path: [{ col: -1, row: 0 }, { col: 0, row: 0 }],
    }],
  ]);
  const state = openState({ placeables: [rack], utilityLines: lines });
  const networks = discoverNetworks('hvCable', lines, makeDefaultPortLookup(state));
  assert.equal(networks.length, 1,
    'either overhead conductor or the side tap energizes the complete compact rack');
  assert.ok([...lines.values()].every(line => (
    isTensionedHvCable(line, new Map([[rack.id, rack]]))
  )), 'all three elevated rack attachments use suspended HV tension and sag');
});

test('45-degree indoor HV rack turns four isolated suspended cables around corners', () => {
  const def = PLACEABLES.indoorHvCableCornerRack;
  const ports = getUtilityPortsV2(def.id);
  assert.equal(def.hvCableSupport, 'indoorRack');
  assert.equal(def.subW, 4);
  assert.equal(def.subL, 4);
  assert.deepEqual(Object.keys(ports), ['hv_1', 'hv_2', 'hv_3', 'hv_4']);
  assert.ok(Object.values(ports).every(port =>
    port.utility === 'hvCable' && port.role === 'pass'
      && port.omnidirectional === true && port.maxConnections === 2));
  assert.deepEqual(def.electricalGroups.hvCable, []);

  const rack = {
    id: 'corner', type: def.id, col: 0, row: 0,
    subCol: 0, subRow: 0, dir: 0,
  };
  setModelBoundsProvider(getModelBounds);
  const anchors = Object.keys(ports).map(name => portAnchor3D(rack, COMPONENTS[def.id], name));
  const spacings = anchors.slice(1).map((anchor, index) => Math.hypot(
    anchor.x - anchors[index].x,
    anchor.z - anchors[index].z,
  ));
  assert.ok(spacings.every(spacing => Math.abs(spacing - 0.5) < 1e-9),
    'the diagonal corner row retains its own 0.5 m conductor spacing');
  assert.ok(anchors.every((anchor, index) => index === 0
    || Math.abs((anchor.x - anchors[index - 1].x)
      - (anchor.z - anchors[index - 1].z)) < 1e-9),
  'the hanging attachment points follow a true 45-degree line');
  assert.ok(anchors.every(anchor => anchor.y === 2.00),
    'the corner-rack cables attach to the bottoms of the hanging insulators');
  const bounds = getModelBounds(def.id);
  assert.ok(bounds && Math.abs((bounds.maxX - bounds.minX) - (bounds.maxZ - bounds.minZ)) < 0.05,
    'the authored 45-degree parts render diagonally within the square footprint');
  setModelBoundsProvider(null);

  const lines = new Map(Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    return [`corner-cable-${n}`, {
      id: `corner-cable-${n}`, utilityType: 'hvCable',
      start: { placeableId: rack.id, portName: `hv_${n}` }, end: null,
      path: [{ col: index, row: 0 }, { col: index, row: 1 }],
    }];
  }));
  const state = openState({ placeables: [rack], utilityLines: lines });
  const networks = discoverNetworks('hvCable', lines, makeDefaultPortLookup(state));
  assert.equal(networks.length, 4, 'the four corner conductors remain electrically isolated');
  assert.equal(isTensionedHvCable(lines.get('corner-cable-1'), new Map([[rack.id, rack]])), true,
    'the corner rack tensions attached HV spans');
});

test('2×2 utility pole and 4×4 transmission tower accept every HV approach', () => {
  const paths = [
    [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    [{ col: 0, row: 0 }, { col: -1, row: 0 }],
    [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    [{ col: 0, row: 0 }, { col: 0, row: -1 }],
  ];
  for (const [type, expectedSize] of [
    ['utilityPole', 2], ['transmissionTower', 4],
  ]) {
    const def = PLACEABLES[type];
    const ports = getUtilityPortsV2(type);
    assert.equal(def.subW, expectedSize);
    assert.equal(def.subL, expectedSize);
    const expectedNames = type === 'utilityPole'
      ? ['hv_in', 'hv_out', 'hv_3', 'hv_4', 'hv_tap']
      : ['hv_in', 'hv_out', 'hv_3', 'hv_4', 'hv_5', 'hv_6'];
    assert.deepEqual(Object.keys(ports), expectedNames);
    const overheadNames = expectedNames.filter(name => name !== 'hv_tap');
    assert.ok(overheadNames.every(name =>
      ports[name].omnidirectional === true && ports[name].maxConnections === 2));
    const state = openState({
      placeables: [{ id: 'support', type, col: 0, row: 0, subCol: 0, subRow: 0, dir: 1 }],
    });
    for (const portName of ['hv_in', 'hv_out']) {
      for (const path of paths) {
        assert.equal(validateDrawLine(state, {
          utilityType: 'hvCable', start: { placeableId: 'support', portName }, path,
        }).ok, true, `${type}.${portName} accepts ${JSON.stringify(path[1])}`);
      }
    }
  }

  const linkedState = openState({
    placeables: [
      { id: 'tower', type: 'transmissionTower', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'pole', type: 'utilityPole', col: 0, row: 3, subCol: 0, subRow: 0, dir: 3 },
    ],
  });
  assert.equal(validateDrawLine(linkedState, {
    utilityType: 'hvCable',
    start: { placeableId: 'tower', portName: 'hv_out' },
    end: { placeableId: 'pole', portName: 'hv_in' },
    path: [{ col: 0, row: 0 }, { col: 0, row: 3 }],
  }).ok, true, 'a transmission-tower output connects directly to a rotated utility-pole input');

  const supportRef = (placeableId, portName) => ({ placeableId, portName });
  for (const [start, end, message] of [
    [supportRef('tower', 'hv_in'), supportRef('pole', 'hv_in'),
      'passive support terminals connect without an authored in/out pairing'],
    [supportRef('tower', 'hv_out'), supportRef('pole', 'hv_out'),
      'matching passive output names do not cause a wrong-port error'],
  ]) {
    assert.equal(validateDrawLine(linkedState, {
      utilityType: 'hvCable', start, end,
      path: [{ col: 0, row: 0 }, { col: 0, row: 3 }],
    }).ok, true, message);
  }
});

test('each pole insulator accepts two wires and all terminals share the transformer-tap bus', () => {
  const support = {
    id: 'pole', type: 'utilityPole', col: 0, row: 0,
    subCol: 0, subRow: 0, dir: 0,
  };
  const def = COMPONENTS.utilityPole;
  const first = {
    id: 'first', utilityType: 'hvCable',
    start: { placeableId: 'pole', portName: 'hv_in' }, end: null,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  };
  const second = {
    id: 'second', utilityType: 'hvCable',
    start: { placeableId: 'pole', portName: 'hv_in' }, end: null,
    path: [{ col: 0, row: 0 }, { col: 0, row: 1 }],
  };
  const state = openState({ placeables: [support], utilityLines: new Map([['first', first]]) });
  assert.ok(availablePorts(support, def, 'hvCable', state.utilityLines).includes('hv_in'),
    'one attached wire leaves the insulator available');
  assert.equal(validateDrawLine(state, {
    utilityType: 'hvCable', start: second.start, path: second.path,
  }).ok, true, 'a second wire can land on the same insulator');
  state.utilityLines.set('second', second);
  assert.ok(!availablePorts(support, def, 'hvCable', state.utilityLines).includes('hv_in'),
    'two attached wires fill the insulator');
  assert.equal(validateDrawLine(state, {
    utilityType: 'hvCable', start: second.start,
    path: [{ col: 0, row: 0 }, { col: -1, row: 0 }],
  }).reason, 'port_taken', 'a third wire is rejected');

  const otherA = {
    id: 'other-a', utilityType: 'hvCable',
    start: { placeableId: 'pole', portName: 'hv_out' }, end: null,
    path: [{ col: 0, row: 0 }, { col: -1, row: 0 }],
  };
  const otherB = {
    id: 'other-b', utilityType: 'hvCable',
    start: { placeableId: 'pole', portName: 'hv_out' }, end: null,
    path: [{ col: 0, row: 0 }, { col: 0, row: -1 }],
  };
  state.utilityLines.set('other-a', otherA);
  state.utilityLines.set('other-b', otherB);
  const networks = discoverNetworks(
    'hvCable', state.utilityLines, makeDefaultPortLookup(state),
  );
  assert.equal(networks.length, 1,
    'separate overhead terminals share the pole bus');

  const tap = getUtilityPortsV2('utilityPole').hv_tap;
  assert.equal(tap.connectionKind, 'hvDistributionTap');
  assert.equal(tap.maxConnections, 1);
  assert.deepEqual(PLACEABLES.utilityPole.electricalGroups.hvCable, [[
    'hv_in', 'hv_out', 'hv_3', 'hv_4', 'hv_tap',
  ]], 'the pad-transformer tap reaches every live overhead terminal');
  const tapLine = {
    id: 'pole-tap', utilityType: 'hvCable',
    start: { placeableId: 'pole', portName: 'hv_tap' }, end: null,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  };
  assert.equal(isTensionedHvCable(tapLine, new Map([[support.id, support]])), false,
    'the pole transformer tap remains a slack service connection');
});

test('overhead support anchors coincide with every visible insulator terminal', () => {
  setModelBoundsProvider(() => ({ minX: -2, maxX: 2, minY: 0, maxY: 10, minZ: -1, maxZ: 1 }));
  const cases = {
    utilityPole: {
      hv_in: [-0.91, 6.4064], hv_out: [0.91, 6.4064],
      hv_3: [-0.91, 5.3536], hv_4: [0.91, 5.3536],
    },
    transmissionTower: {
      hv_in: [-1.18, 4.6894], hv_out: [1.18, 4.6894],
      hv_3: [-1, 6.0286], hv_4: [1, 6.0286],
      hv_5: [-0.82, 7.2004], hv_6: [0.82, 7.2004],
    },
  };
  for (const [type, expected] of Object.entries(cases)) {
    const support = { id: type, type, col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
    const centre = type === 'utilityPole' ? 0.5 : 1;
    for (const [name, [x, y]] of Object.entries(expected)) {
      const anchor = portAnchor3D(support, COMPONENTS[type], name);
      assert.ok(Math.abs(anchor.x - (centre + x)) < 1e-8, `${type}.${name} x`);
      assert.ok(Math.abs(anchor.y - y) < 1e-8, `${type}.${name} y`);
      assert.ok(Math.abs(Math.abs(anchor.z - centre) - 0.05) < 1e-8, `${type}.${name} z`);
    }
  }
  const poleTap = portAnchor3D(
    { id: 'pole', type: 'utilityPole', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
    COMPONENTS.utilityPole,
    'hv_tap',
  );
  assert.deepEqual(
    [poleTap.x, poleTap.y, poleTap.z, poleTap.out.x, poleTap.out.y, poleTap.out.z],
    [0.5, 1.55, 0.8, 0, 0, 1],
    'the utility-pole tap lands on its visible pad-transformer feeder insulator',
  );
  const transformerInput = portAnchor3D(
    {
      id: 'transformer', type: 'padMountTransformer', col: 2, row: 0,
      subCol: 0, subRow: 0, dir: 0,
    },
    COMPONENTS.padMountTransformer,
    'hv_in',
  );
  assert.equal(poleTap.y, transformerInput.y,
    'the pole tap and green transformer primary bushing share one feeder height');
  setModelBoundsProvider(null);
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

test('HV spans between overhead supports may cross every wall and fence family', () => {
  const supports = [
    { id: 'pole', type: 'utilityPole', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
    { id: 'tower', type: 'transmissionTower', col: 3, row: 0, subCol: 0, subRow: 0, dir: 0 },
  ];
  const start = { placeableId: 'pole', portName: 'hv_out' };
  const end = { placeableId: 'tower', portName: 'hv_in' };
  const wallTypes = Object.keys(WALL_TYPES);
  assert.ok(wallTypes.length > 10, 'test covers the complete registered wall/fence catalogue');
  for (const wallType of wallTypes) {
    const state = openState({
      placeables: supports,
      wallOccupied: { '1,0,e': wallType },
    });
    const result = validateDrawLine(state, {
      utilityType: 'hvCable', start, end,
      path: directCrossing, cablePath: directCrossing,
    });
    assert.equal(result.ok, true, `${wallType}: ${result.reason || 'ok'}`);
  }
});

test('The overhead crossing exception requires two HV supports', () => {
  const state = openState({
    placeables: [
      { id: 'source', type: 'facilityTransformer', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'rack', type: 'indoorHvCableRack', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'pole', type: 'utilityPole', col: 3, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'pole-b', type: 'utilityPole', col: 6, row: 0, subCol: 0, subRow: 0, dir: 0 },
    ],
    wallOccupied: crossingWall,
  });
  for (const start of [
    { placeableId: 'source', portName: 'hv_out_1' },
    { placeableId: 'rack', portName: 'hv_1' },
  ]) {
    const result = validateDrawLine(state, {
      utilityType: 'hvCable', start,
      end: { placeableId: 'pole', portName: 'hv_in' },
      path: directCrossing, cablePath: directCrossing,
    });
    assert.equal(result.reason, 'wall_pass_through_required', start.placeableId);
  }
  const lowTapSpan = {
    id: 'low-tap-span', utilityType: 'hvCable',
    start: { placeableId: 'pole', portName: 'hv_tap' },
    end: { placeableId: 'pole-b', portName: 'hv_tap' },
    path: directCrossing,
  };
  assert.equal(validateDrawLine(state, lowTapSpan).reason, 'wall_pass_through_required',
    'two pole-base taps do not gain the elevated wall-crossing exception');
  assert.equal(isTensionedHvCable(lowTapSpan, new Map(state.placeables.map(p => [p.id, p]))), false,
    'two pole-base taps render as a loose ground feeder');
});

test('Fabricated vacuum, waveguide and cryogenic services retain wall crossing', () => {
  const state = openState({ wallOccupied: crossingWall });
  for (const utilityType of [
    'vacuumPipe', 'rfWaveguide', 'cryoTransfer',
  ]) {
    const result = validateDrawLine(state, { utilityType, path: directCrossing });
    assert.equal(result.ok, true, `${utilityType}: ${result.reason || 'ok'}`);
  }
});

test('Flexible water lines cannot cross walls', () => {
  const state = openState({ wallOccupied: crossingWall });
  const result = validateDrawLine(state, {
    utilityType: 'coolingWater',
    start: null,
    end: null,
    path: directCrossing,
    cablePath: directCrossing,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wall_pass_through_required');
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
  assert.equal(candidate(hvState, 'hvCable', refs('supply', 'hv_out_1'), refs('poleA', 'hv_out')).ok, true,
    'a source can use either passive pole terminal');
  assert.equal(candidate(hvState, 'hvCable', refs('poleA', 'hv_out'), refs('poleB', 'hv_in')).ok, true);
  assert.equal(candidate(hvState, 'hvCable', refs('poleA', 'hv_in'), refs('panel', 'hv_in')).ok, true,
    'either passive pole terminal can continue to a sink');
  assert.equal(candidate(hvState, 'hvCable', refs('poleB', 'hv_out'), refs('panel', 'hv_in')).ok, true);

  hvState.utilityLines = new Map([
    ['a', { id: 'a', utilityType: 'hvCable', start: refs('supply', 'hv_out_1'), end: refs('poleA', 'hv_in'), path: [{ col: 0, row: 0 }, { col: 1, row: 0 }] }],
    ['b', { id: 'b', utilityType: 'hvCable', start: refs('poleA', 'hv_in'), end: refs('poleB', 'hv_in'), path: [{ col: 2, row: 0 }, { col: 3, row: 0 }] }],
    ['c', { id: 'c', utilityType: 'hvCable', start: refs('poleB', 'hv_in'), end: refs('panel', 'hv_in'), path: [{ col: 4, row: 0 }, { col: 5, row: 0 }] }],
  ]);
  const networks = discoverNetworks(
    'hvCable', hvState.utilityLines, makeDefaultPortLookup(hvState),
  );
  assert.equal(networks.length, 1);
  assert.ok(networks[0].sources.some(port => port.placeableId === 'supply'));
  assert.ok(networks[0].sinks.some(port => port.placeableId === 'panel'));
});

test('Utility-pole terminals take up lateral slack but retain visible suspension sag', () => {
  const def = COMPONENTS.utilityPole;
  const a = { id: 'a', type: 'utilityPole', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 };
  const b = { id: 'b', type: 'utilityPole', col: 0, row: 6, subCol: 0, subRow: 0, dir: 0 };
  const start = portAnchor3D(a, def, 'hv_out');
  const end = portAnchor3D(b, def, 'hv_in');
  assert.equal(start.y, 6.4064);
  assert.equal(end.y, 6.4064);
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
    const chord = first.clone().lerp(last, t);
    assert.ok(Math.hypot(cable[index].x - chord.x, cable[index].z - chord.z) < 1e-8,
      'every sample remains on the direct support-to-support plan path');
  }
  const middle = cable[Math.floor(cable.length / 2)];
  assert.ok(middle.y < first.y - 0.58 && middle.y > first.y - 1.36,
    'the relaxed conductor hangs in a visible shallow bow rather than reading as rigid');
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
  assert.ok(cable.every((point, index) => {
    const chord = first.clone().lerp(last, index / (cable.length - 1));
    return Math.hypot(point.x - chord.x, point.z - chord.z) < 1e-8;
  }), 'the pass-through removes drawn lateral slack');
  const middleIndex = Math.floor(cable.length / 2);
  const middleChord = first.clone().lerp(last, middleIndex / (cable.length - 1));
  assert.ok(cable[middleIndex].y < middleChord.y - 0.36
      && cable[middleIndex].y > middleChord.y - 1.36,
    'the pass-through-supported conductor remains suspended with visible shallow sag');
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
  assert.ok(cable.every((point, index) => {
    const chord = first.clone().lerp(last, index / (cable.length - 1));
    return Math.hypot(point.x - chord.x, point.z - chord.z) < 1e-8;
  }), 'the draw preview ignores mouse-trace slack at a tension support');
  const middleIndex = Math.floor(cable.length / 2);
  const middleChord = first.clone().lerp(last, middleIndex / (cable.length - 1));
  assert.ok(cable[middleIndex].y < middleChord.y,
    'the live tensioned preview includes the suspended bow');
  assert.ok(first.y > last.y, 'the preview reaches down from tower height to the cursor plane');
});
