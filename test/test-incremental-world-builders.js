import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Three from 'three';

globalThis.THREE = Three;
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        set fillStyle(_value) {},
      }),
    };
  },
};

const { DecorationBuilder } = await import('../src/renderer3d/decoration-builder.js');
const { BeamPipeBuilder } = await import('../src/renderer3d/beam-pipe-builder.js');
const { UtilityLineBuilderV2 } = await import('../src/renderer3d/utility-line-builder-v2.js');
const { buildLightPools } = await import('../src/renderer3d/lighting-builder.js');
const { LIGHTING_DEFS } = await import('../src/data/placeables/lighting.js');

function decoration(id, type, col, row, category = 'decor') {
  return {
    id, type, category, col, row,
    subCol: 0, subRow: 0, subW: 2, subL: 2, subH: 2,
    dir: 0, y: 0, placeY: 0, indoors: false,
  };
}

test('decoration exact patches preserve unrelated geometry and skip lighting work', () => {
  const builder = new DecorationBuilder();
  builder._buildOne = () => new Three.Group();
  const parent = new Three.Group();
  const benchA = decoration('bench-a', 'parkBench', 0, 0);
  const benchB = decoration('bench-b', 'parkBench', 2, 0);
  const lamp = decoration('lamp', 'bollardLight', 4, 0, 'lighting');

  builder.build([benchA, benchB, lamp], parent);
  const benchAGroup = builder.getGroup('bench-a');
  const benchBGroup = builder.getGroup('bench-b');
  const lampGroup = builder.getGroup('lamp');
  const fixtureRegistry = builder.getLightingFixtures();

  const movedBenchA = { ...benchA, col: 1 };
  const benchResult = builder.build([movedBenchA, benchB, lamp], parent, {
    changes: new Map([['bench-a', {
      id: 'bench-a', kind: 'decoration', action: 'updated',
    }]]),
  });
  assert.equal(benchResult.lightingChanged, false);
  assert.notStrictEqual(builder.getGroup('bench-a'), benchAGroup);
  assert.strictEqual(builder.getGroup('bench-b'), benchBGroup);
  assert.strictEqual(builder.getGroup('lamp'), lampGroup);
  assert.strictEqual(builder.getLightingFixtures(), fixtureRegistry,
    'non-light edits preserve the fixture registry identity');

  const movedLamp = { ...lamp, col: 5 };
  const lampResult = builder.build([movedBenchA, benchB, movedLamp], parent, {
    changes: new Map([['lamp', {
      id: 'lamp', kind: 'decoration', action: 'updated',
    }]]),
  });
  assert.equal(lampResult.lightingChanged, true);
  assert.strictEqual(builder.getGroup('bench-b'), benchBGroup);
  assert.notStrictEqual(builder.getGroup('lamp'), lampGroup);
  assert.notStrictEqual(builder.getLightingFixtures(), fixtureRegistry);
});

function fixture(id, def, x) {
  const group = new Three.Group();
  group.position.set(x, 1, 0);
  return { id, def, group };
}

test('light-pool fragment cache raycasts only new or changed fixtures', () => {
  const def = LIGHTING_DEFS.find(entry => entry.id === 'bollardLight');
  const occluder = new Three.Group();
  const wall = new Three.Mesh(
    new Three.BoxGeometry(0.1, 3, 20),
    new Three.MeshBasicMaterial(),
  );
  wall.castShadow = true;
  wall.position.set(20, 1.5, 0);
  occluder.add(wall);
  occluder.updateMatrixWorld(true);
  const cache = new Map();
  const originalIntersect = Three.Raycaster.prototype.intersectObjects;
  let raycasts = 0;
  Three.Raycaster.prototype.intersectObjects = function counted(...args) {
    raycasts++;
    return originalIntersect.apply(this, args);
  };
  try {
    const a = fixture('a', def, 0);
    const b = fixture('b', def, 4);
    const first = buildLightPools([a, b], { occluders: occluder, fragmentCache: cache });
    assert.equal(raycasts, 64, 'two new fixtures trace 32 rays each');
    first.geometry.dispose();
    first.material.dispose();

    raycasts = 0;
    const unchanged = buildLightPools([a, b], { occluders: occluder, fragmentCache: cache });
    assert.equal(raycasts, 0, 'unchanged fixtures reuse both cached pool fans');
    unchanged.geometry.dispose();
    unchanged.material.dispose();

    raycasts = 0;
    const c = fixture('c', def, 8);
    const added = buildLightPools([a, b, c], { occluders: occluder, fragmentCache: cache });
    assert.equal(raycasts, 32, 'adding one fixture traces only its new fan');
    assert.equal(cache.size, 3);
    added.geometry.dispose();
    added.material.dispose();
  } finally {
    Three.Raycaster.prototype.intersectObjects = originalIntersect;
    wall.geometry.dispose();
    wall.material.dispose();
  }
});

function pipe(id, row, length = 4) {
  return {
    id,
    path: [{ col: 0, row }, { col: length, row }],
    openStart: false,
    openEnd: false,
  };
}

test('beam-pipe reconciliation retains unchanged fragments and instanced meshes', () => {
  const builder = new BeamPipeBuilder();
  const parent = new Three.Group();
  const pipes = [pipe('a', 0), pipe('b', 2), pipe('c', 4)];
  const initial = builder.build({ beamPipes: pipes }, parent);
  assert.equal(initial.reconciledPipes, 3);
  assert.deepEqual(
    { runs: builder.getStats().runs, flanges: builder.getStats().flanges,
      supports: builder.getStats().supports, caps: builder.getStats().caps },
    { runs: 3, flanges: 15, supports: 12, caps: 0 },
    'batched reconciliation retains the authored run/fitting counts',
  );
  const fragmentA = builder._fragmentsById.get('a');
  const fragmentC = builder._fragmentsById.get('c');
  const runMesh = builder._meshesByName.get('beam-pipe-runs');

  const movedB = pipe('b', 3);
  const changed = builder.build({ beamPipes: [pipes[0], movedB, pipes[2]] }, parent);
  assert.equal(changed.reconciledPipes, 1);
  assert.equal(changed.reusedPipes, 2);
  assert.strictEqual(builder._fragmentsById.get('a'), fragmentA);
  assert.strictEqual(builder._fragmentsById.get('c'), fragmentC);
  assert.strictEqual(builder._meshesByName.get('beam-pipe-runs'), runMesh,
    'same-size matrix updates reuse the allocated instanced mesh');
  assert.deepEqual(
    builder._meshesByName.get('beam-pipe-runs').userData.pipeIds,
    ['a', 'b', 'c'],
  );

  const noOp = builder.build({ beamPipes: [pipes[0], movedB, pipes[2]] }, parent);
  assert.equal(noOp.changed, false);
  assert.strictEqual(builder._meshesByName.get('beam-pipe-runs'), runMesh);

  const joined = {
    id: 'd',
    path: [{ col: 0, row: 0 }, { col: 0, row: -2 }],
    openStart: false,
    openEnd: false,
  };
  const joinedResult = builder.build({
    beamPipes: [pipes[0], movedB, pipes[2], joined],
  }, parent);
  assert.equal(joinedResult.reconciledPipes, 2,
    'a new shared endpoint rebuilds the new pipe plus its flange-dependent neighbour');
  assert.equal(joinedResult.reusedPipes, 2);
  assert.strictEqual(builder._meshesByName.get('beam-pipe-runs'), runMesh,
    'spare power-of-two capacity absorbs the added run without GPU reallocation');
});

test('utility-line reconciliation already preserves unchanged stable-id groups', () => {
  const builder = new UtilityLineBuilderV2();
  const parent = new Three.Group();
  const first = {
    id: 'power-a', utilityType: 'powerCable', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 3, row: 0 }],
  };
  builder.build(new Map([[first.id, first]]), new Map(), parent, { state: {} });
  const firstGroup = builder._lineGroups.get(first.id);

  const second = {
    id: 'power-b', utilityType: 'powerCable', start: null, end: null,
    path: [{ col: 0, row: 2 }, { col: 3, row: 2 }],
  };
  builder.build(new Map([
    [first.id, { ...first, path: first.path.map(point => ({ ...point })) }],
    [second.id, second],
  ]), new Map(), parent, { state: {} });
  assert.strictEqual(builder._lineGroups.get(first.id), firstGroup,
    'adding another utility run does not rebuild existing line geometry');
  assert.equal(builder._lineGroups.size, 2);
});
