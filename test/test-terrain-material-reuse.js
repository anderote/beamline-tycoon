import assert from 'node:assert/strict';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
        set fillStyle(_value) {},
      }),
    };
  },
};

const { TerrainBuilder } = await import('../src/renderer3d/terrain-builder.js');

function tile(col, row, brightness = 0) {
  return {
    col, row, brightness, hash: col * 17 + row,
    cornersY: { nw: 0, ne: 0, se: 0, sw: 0 },
  };
}

const parent = new THREE.Group();
const builder = new TerrainBuilder(null);
builder.build([tile(0, 0)], parent);
const material = builder.getMesh().material;
let materialDisposals = 0;
material.addEventListener('dispose', () => { materialDisposals++; });

builder.build([tile(0, 0), tile(1, 0)], parent);
assert.strictEqual(builder.getMesh().material, material,
  'growing terrain reuses the compiled material');
assert.equal(materialDisposals, 0,
  'a geometry resize does not dispose the shared terrain material');

builder.dispose(parent);
assert.equal(materialDisposals, 1, 'final builder disposal releases the material once');

console.log('Terrain material reuse tests passed.');
