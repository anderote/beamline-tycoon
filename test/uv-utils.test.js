// test/uv-utils.test.js
// Run: node --test test/uv-utils.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub minimal THREE BufferAttribute so the module can run without a browser.
globalThis.THREE = {
  BufferAttribute: class {
    constructor(arr, itemSize) {
      this.array = arr;
      this.itemSize = itemSize;
      this.needsUpdate = false;
    }
  },
};

const { applyTiledBoxUVs, applyTiledCylinderUVs } = await import('../src/renderer3d/uv-utils.js');

function fakeBoxGeom() {
  return {
    attributes: {
      uv: new globalThis.THREE.BufferAttribute(new Float32Array(48), 2),
    },
  };
}

// TEXEL_SCALE = 32 -> 2 meters per source-texture-tile.

test('box: 2m cube uses [0..1] UVs on every face', () => {
  const g = fakeBoxGeom();
  applyTiledBoxUVs(g, 2, 2, 2);
  const uv = g.attributes.uv.array;
  for (let face = 0; face < 6; face++) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.deepEqual(new Set(us), new Set([0, 1]));
    assert.deepEqual(new Set(vs), new Set([0, 1]));
  }
});

test('box: 4m x 1m x 2m face spans match dimensions / 2m', () => {
  const g = fakeBoxGeom();
  applyTiledBoxUVs(g, 4, 1, 2);
  const uv = g.attributes.uv.array;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
  // +/-X face: U spans d=2 -> 1.0, V spans h=1 -> 0.5
  for (const face of [0, 1]) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.equal(Math.max(...us) - Math.min(...us), 1.0, '+/-X U span');
    assert.equal(Math.max(...vs) - Math.min(...vs), 0.5, '+/-X V span');
  }
  // +/-Y face: U spans w=4 -> 2.0, V spans d=2 -> 1.0
  for (const face of [2, 3]) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.equal(Math.max(...us) - Math.min(...us), 2.0, '+/-Y U span');
    assert.equal(Math.max(...vs) - Math.min(...vs), 1.0, '+/-Y V span');
  }
  // +/-Z face: U spans w=4 -> 2.0, V spans h=1 -> 0.5
  for (const face of [4, 5]) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.equal(Math.max(...us) - Math.min(...us), 2.0, '+/-Z U span');
    assert.equal(Math.max(...vs) - Math.min(...vs), 0.5, '+/-Z V span');
  }
});

test('box: needsUpdate is set after rewrite', () => {
  const g = fakeBoxGeom();
  applyTiledBoxUVs(g, 1, 1, 1);
  assert.equal(g.attributes.uv.needsUpdate, true);
});

function fakeCylinderGeom(segs = 32, hasCaps = true) {
  const sideVerts = (segs + 1) * 2;
  const capVerts = hasCaps ? (segs + 2) * 2 : 0;
  const total = sideVerts + capVerts;
  return {
    attributes: {
      uv: new globalThis.THREE.BufferAttribute(new Float32Array(total * 2), 2),
    },
    _sideVerts: sideVerts,
    _capVerts: capVerts,
  };
}

test('cylinder: side U spans circumference / 2m, V spans height / 2m', () => {
  const r = 1;
  const h = 4;
  const segs = 32;
  const g = fakeCylinderGeom(segs, false);
  applyTiledCylinderUVs(g, r, h, segs);
  const uv = g.attributes.uv.array;
  const expectedUSpan = (2 * Math.PI * r) / 2;
  const expectedVSpan = h / 2;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < g._sideVerts; i++) {
    const u = uv[i * 2];
    const v = uv[i * 2 + 1];
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  assert.ok(Math.abs((uMax - uMin) - expectedUSpan) < 1e-5, `side U span: ${uMax - uMin} vs ${expectedUSpan}`);
  assert.ok(Math.abs((vMax - vMin) - expectedVSpan) < 1e-5, `side V span: ${vMax - vMin} vs ${expectedVSpan}`);
});
