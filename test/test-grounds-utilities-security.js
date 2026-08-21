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
const { resolvePaletteCollection } = await import('../src/ui/palette-collection.js');
const { buildPaletteIndex } = await import('../src/ui/palette-search.js');

const UTILITY_DECORATIONS = [
  'propaneTank',
  'utilityPole',
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
  'padMountTransformer',
  'facilityTransformer',
  'hvTransformer',
  'gridIntertieTransformer',
  'poleMountTransformer',
  'disconnectSwitch',
  'hvDuctBankVault',
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
