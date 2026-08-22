import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

globalThis.THREE = THREE;

const { COMPONENTS } = await import('../src/data/components.js');
const { DECORATIONS_RAW } = await import('../src/data/decorations.raw.js');
const { DECORATIONS } = await import('../src/data/decorations.js');
const { MODES } = await import('../src/data/modes.js');
const { PLACEABLES } = await import('../src/data/placeables/index.js');
const {
  buildDecorationGroup,
  hasDedicatedDecorationGeometry,
} = await import('../src/renderer3d/decoration-builder.js');
const {
  componentPaletteEntries,
  resolvePaletteCollection,
  standardPaletteKind,
} = await import('../src/ui/palette-collection.js');
const { buildPaletteIndex } = await import('../src/ui/palette-search.js');

const UTILITY_DECORATIONS = [
  'propaneTank',
  'utilityPole2Way',
  'utilityPole',
  'transmissionTower',
  'overheadPowerSpan',
  'outdoorPipeRack',
  'backupGenerator',
];

const VISIBLE_UTILITY_DECORATIONS = UTILITY_DECORATIONS
  .filter(id => !DECORATIONS[id].deprecated);

const SECURITY_DECORATIONS = [
  'guardTower',
  'securityGatehouse',
  'securityCameraMast',
  'vehicleBarrier',
  'securityBollard',
];

const LINKED_UTILITY_EQUIPMENT = [
  'gridServicePoint',
  'gridServicePointHighCapacity',
  'padMountTransformer',
  'facilityTransformer',
  'hvTransformer',
  'gridIntertieTransformer',
  'poleMountTransformer',
  'disconnectSwitch',
  'waterTank',
  'facilityWaterSupply',
  'bulkWaterTank',
];

test('Grounds exposes Utilities and Security collection tabs', () => {
  const utilities = MODES.grounds.categories.utilities;
  const security = MODES.grounds.categories.security;

  assert.equal(utilities.isDecorationTab, true);
  assert.deepEqual(utilities.utilityLineTools, ['hvCable', 'powerCable', 'coolingWater']);
  assert.deepEqual(utilities.linkedPlaceables, LINKED_UTILITY_EQUIPMENT);
  assert.equal(security.isDecorationTab, true);
  assert.deepEqual(security.linkedPlaceables, ['floodLight']);
});

test('new Grounds content is registered, described, and dimensioned', () => {
  for (const [category, ids] of [
    ['utilities', UTILITY_DECORATIONS],
    ['security', SECURITY_DECORATIONS],
  ]) {
    for (const id of ids) {
      const raw = DECORATIONS_RAW[id];
      const def = PLACEABLES[id];
      assert.ok(raw, `${id} is authored in DECORATIONS_RAW`);
      assert.ok(def, `${id} is registered in PLACEABLES`);
      assert.equal(def.kind, 'decoration');
      assert.equal(def.category, category);
      assert.ok(DECORATIONS[id], `${id} is available to Grounds palettes`);
      assert.ok(def.cost?.funding > 0, `${id} has a funding cost`);
      assert.ok(def.desc?.length > 0, `${id} has palette copy`);
      assert.ok(def.subW > 0 && def.subL > 0 && def.subH > 0,
        `${id} has a positive authored footprint`);
    }
  }
});

test('collection tabs reuse working equipment without changing primary ownership', () => {
  const utilities = resolvePaletteCollection(
    'utilities', MODES.grounds.categories.utilities,
    { decorations: DECORATIONS, components: COMPONENTS },
  );
  assert.deepEqual(utilities.decorations.map(([id]) => id), VISIBLE_UTILITY_DECORATIONS);
  assert.deepEqual(utilities.components.map(([id]) => id), LINKED_UTILITY_EQUIPMENT);
  assert.deepEqual(utilities.utilityLineTools, ['hvCable', 'powerCable', 'coolingWater']);

  for (const id of LINKED_UTILITY_EQUIPMENT) {
    assert.equal(PLACEABLES[id].kind, 'infrastructure');
    assert.ok(['power', 'cooling'].includes(PLACEABLES[id].category),
      `${id} retains its functional Infra category`);
  }

  const security = resolvePaletteCollection(
    'security', MODES.grounds.categories.security,
    { decorations: DECORATIONS, components: COMPONENTS },
  );
  assert.deepEqual(
    security.decorations.map(([id]) => id),
    [...SECURITY_DECORATIONS, 'floodLight'],
  );
  assert.deepEqual(security.components, []);
});

test('functional overhead supports are linked into Infra Power and keep decoration placement', () => {
  const pole = PLACEABLES.utilityPole;
  const tower = PLACEABLES.transmissionTower;
  const powerSubsections = MODES.infra.categories.power.subsections;

  assert.deepEqual(Object.keys(powerSubsections).slice(0, 5),
    ['transport', 'gridSupply', 'transformers', 'overhead', 'routingHardware']);
  assert.equal(powerSubsections.routingHardware.name, 'Cable Routing');
  assert.deepEqual(powerSubsections.overhead.linkedPlaceables,
    ['utilityPole2Way', 'utilityPole', 'transmissionTower']);
  const halfPole = PLACEABLES.utilityPole2Way;
  assert.equal(halfPole.kind, 'decoration');
  assert.equal(halfPole.category, 'utilities');
  assert.equal(halfPole.name, '2×2 Wood Utility Pole');
  assert.equal(halfPole.subW, 2);
  assert.equal(halfPole.subL, 2);
  assert.equal(pole.kind, 'decoration');
  assert.equal(pole.category, 'utilities');
  assert.equal(pole.name, '4×4 Wood Utility Pole');
  assert.equal(pole.subW, 2);
  assert.equal(pole.subL, 2);
  assert.equal(standardPaletteKind(COMPONENTS.utilityPole), 'decoration');
  assert.equal(tower.kind, 'decoration');
  assert.equal(tower.name, '6×6 HV Transmission Tower');
  assert.equal(tower.subW, 4);
  assert.equal(tower.subL, 4);
  assert.equal(tower.subH, 18, 'the metal tower is half the former 18 m height');
  assert.equal(standardPaletteKind(COMPONENTS.transmissionTower), 'decoration');
});

test('retired power routing props stay loadable but leave every build palette', () => {
  const retired = [
    'powerWallPassThrough', 'cableTray', 'cableRiser', 'hvDuctBankVault',
    'indoorHvCableCornerRack',
  ];
  const activePower = componentPaletteEntries(COMPONENTS, 'power').map(({ key }) => key);
  const searchIds = new Set(buildPaletteIndex(null).map(entry => entry.id));
  for (const id of retired) {
    assert.ok(PLACEABLES[id], `${id} remains registered for old saves`);
    assert.equal(PLACEABLES[id].deprecated, true);
    assert.equal(activePower.includes(id), false, `${id} is absent from Infra Power`);
    assert.equal(searchIds.has(id), false, `${id} is absent from global search`);
  }
  assert.equal(activePower.includes('indoorHvCableRack1Way'), true,
    'the single-conductor indoor rack is available from Infra Power');
  assert.equal(searchIds.has('indoorHvCableRack1Way'), true,
    'the single-conductor indoor rack is available from global search');
  assert.equal(PLACEABLES.overheadPowerSpan.deprecated, true,
    'the legacy prefab overhead span remains retired too');
});

test('wood pole draws four overhead insulators plus one low HV tap insulator', () => {
  const def = PLACEABLES.utilityPole;
  const model = buildDecorationGroup(
    def.id, def.category, def.subW * 0.5, def.subL * 0.5, def.subH * 0.5,
  );
  let insulators = 0;
  model.traverse(child => {
    if (child.isMesh && child.material?.color?.getHex() === 0xd7e0e4) insulators++;
  });
  assert.equal(insulators, 5);
});

test('2×2 wood pole is the one-sided two-level half of the full pole', () => {
  const def = PLACEABLES.utilityPole2Way;
  const model = buildDecorationGroup(
    def.id, def.category, def.subW * 0.5, def.subL * 0.5, def.subH * 0.5,
  );
  const ceramicPositions = [];
  model.traverse(child => {
    if (child.isMesh && child.material?.color?.getHex() === 0xd7e0e4) {
      ceramicPositions.push(child.position.clone());
    }
  });
  assert.equal(ceramicPositions.length, 3, 'two overhead insulators plus one tap');
  const overhead = ceramicPositions.filter(position => position.y > 5);
  assert.equal(overhead.length, 2);
  assert.ok(overhead.every(position => position.x > 0),
    'both overhead conductors sit on the same side of the pole');
  assert.equal(new Set(overhead.map(position => position.y.toFixed(4))).size, 2,
    'the two conductors occupy separate vertical levels');
});

test('transmission tower has a tall lattice silhouette and projecting crossarms', () => {
  const def = PLACEABLES.transmissionTower;
  const model = buildDecorationGroup(
    def.id, def.category, def.subW * 0.5, def.subL * 0.5, def.subH * 0.5,
  );
  const bounds = new THREE.Box3().setFromObject(model);
  let meshCount = 0;
  model.traverse(child => { if (child.isMesh) meshCount++; });
  assert.ok(meshCount >= 70, `the tower is visibly latticed (${meshCount} meshes)`);
  assert.ok(bounds.max.y >= 8.9 && bounds.max.y <= 9.1,
    `the half-height tower peak reaches 9 m (${bounds.max.y})`);
  const footprintWidth = def.subW * 0.5;
  assert.ok(bounds.max.x - bounds.min.x > footprintWidth + 0.4,
    `crossarms project beyond the 4×4 footprint (${bounds.max.x - bounds.min.x})`);
});

test('new utility and security props use bespoke multi-part 3D models', () => {
  for (const id of [...UTILITY_DECORATIONS, ...SECURITY_DECORATIONS]) {
    const def = PLACEABLES[id];
    assert.equal(hasDedicatedDecorationGeometry(id), true,
      `${id} cannot fall through to the generic decoration box`);
    const model = buildDecorationGroup(
      id,
      def.category,
      def.subW * 0.5,
      def.subL * 0.5,
      def.subH * 0.5,
    );
    let meshCount = 0;
    model.traverse(child => {
      if (!child.isMesh) return;
      meshCount++;
      const positions = child.geometry?.getAttribute?.('position');
      assert.ok(positions && positions.count > 0, `${id} mesh has vertices`);
    });
    assert.ok(meshCount >= 4, `${id} has a multi-part silhouette (${meshCount} meshes)`);
  }
});

test('security gate boom extends away from the guard hut', () => {
  const def = PLACEABLES.securityGatehouse;
  const model = buildDecorationGroup(
    def.id,
    def.category,
    def.subW * 0.5,
    def.subL * 0.5,
    def.subH * 0.5,
  );
  const meshes = [];
  model.traverse(child => {
    if (child.isMesh) meshes.push(child);
  });

  const hut = meshes.find(mesh => mesh.material.color.getHex() === 0xd0d2cc);
  const boom = meshes.find(mesh => mesh.material.color.getHex() === 0xe7d8b2);
  const markings = meshes.filter(mesh => mesh.material.color.getHex() === 0xd45a43);

  assert.ok(hut && boom, 'gatehouse exposes identifiable hut and boom geometry');
  assert.equal(markings.length, 4, 'gatehouse boom retains all warning markings');
  const hutRightEdge = hut.position.x + hut.geometry.parameters.width / 2;
  const boomLeftEdge = boom.position.x - boom.geometry.parameters.width / 2;
  assert.ok(boomLeftEdge > hutRightEdge,
    'boom starts beyond the hut instead of passing through it');
  assert.ok(markings.every(marking => marking.position.x > hutRightEdge),
    'boom warning markings point away from the hut');
});

test('global search keeps reused placeables single-homed', () => {
  const index = buildPaletteIndex(null);

  for (const id of LINKED_UTILITY_EQUIPMENT) {
    const entries = index.filter(item => item.id === id);
    assert.equal(entries.length, 1, `${id} appears once in search`);
    assert.equal(entries[0].mode, 'infra');
    assert.equal(entries[0].category, PLACEABLES[id].category);
  }

  assert.equal(index.filter(item => item.id === 'floodLight').length, 1);
  assert.equal(index.find(item => item.id === 'floodLight')?.category, 'lighting');
  for (const id of [...VISIBLE_UTILITY_DECORATIONS, ...SECURITY_DECORATIONS]) {
    const entry = index.find(item => item.id === id);
    assert.equal(entry?.mode, 'grounds');
    assert.equal(entry?.category, PLACEABLES[id].category);
  }
});
