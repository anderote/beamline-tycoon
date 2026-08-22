import assert from 'node:assert/strict';
import * as ThreeModule from 'three';

class FakeTextureLoader {
  load() { return new ThreeModule.Texture(); }
}

globalThis.THREE = { ...ThreeModule, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement() {
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

const { Game } = await import('../src/game/Game.js');
const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
const { COMPONENTS } = await import('../src/data/components.js');
const { PARAM_DEFS } = await import('../src/beamline/component-physics.js');
const { PLACEABLES } = await import('../src/data/placeables/index.js');
const { createEquipmentObject } = await import('../src/renderer3d/equipment-builder.js');

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const EPSILON = 1e-6;

function boundsFor(type, isFurnishing) {
  const object = createEquipmentObject({ id: `test:${type}`, type }, isFurnishing);
  assert.ok(object, `${type} builds a preview object`);
  object.updateMatrixWorld(true);
  return new ThreeModule.Box3().setFromObject(object);
}

for (const type of ['sideboard', 'credenza']) {
  const bounds = boundsFor(type, true);
  const surfaceMetres = PLACEABLES[type].surfaceY * 0.5;
  assert.ok(Math.abs(bounds.min.y) <= EPSILON,
    `${type} feet meet the floor`);
  assert.ok(Math.abs(bounds.max.y - surfaceMetres) <= EPSILON,
    `${type} surfaceY ${surfaceMetres} matches its rendered top ${bounds.max.y}`);
}

for (const [type, isFurnishing] of [
  ['coffeeMachine', true],
  ['oscilloscope', false],
]) {
  const bounds = boundsFor(type, isFurnishing);
  assert.ok(bounds.min.y <= EPSILON && bounds.min.y > -0.07,
    `${type} preview geometry meets its support plane (min ${bounds.min.y})`);
}

const game = new Game(new BeamlineRegistry(), { seed: 2217 });
game.state.resources.funding = 1e9;

const sideboardId = game.placePlaceable({
  type: 'sideboard', col: 8, row: 8, subCol: 0, subRow: 0, free: true,
});
const coffeeId = game.placePlaceable({
  type: 'coffeeMachine', col: 8, row: 8, subCol: 1, subRow: 0, free: true,
});
const coffee = game.getPlaceable(coffeeId);
assert.equal(coffee.stackParentId, sideboardId,
  'coffee machine is parented to the sideboard surface');
assert.equal(coffee.placeY, PLACEABLES.sideboard.surfaceY,
  'coffee machine base uses the sideboard rendered top');

const benchId = game.placePlaceable({
  type: 'labBench', col: 12, row: 8, subCol: 0, subRow: 0, free: true,
});
const scopeId = game.placePlaceable({
  type: 'oscilloscope', col: 12, row: 8, subCol: 2, subRow: 0, free: true,
});
const scope = game.getPlaceable(scopeId);
assert.equal(scope.stackParentId, benchId,
  'oscilloscope is parented to the lab bench surface');
assert.equal(scope.placeY, PLACEABLES.labBench.surfaceY,
  'oscilloscope base uses the rendered lab-bench top');

console.log('Surface placeable visual tests passed.');
