// test/test-decoration-preview.js — the placed decoration must be the one the
// ghost previewed: same rotation, same footprint, same procedural seed.
//
// No THREE global and no DOM: the placement math is exported as a pure
// function, and the builder's geometry hook (_buildOne) is overridden with a
// recorder that hands back plain-object stand-ins for THREE.Group.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DecorationBuilder,
  decorationThumbnailFrame,
  decorationPlacement,
  decorationSeed,
} from '../src/renderer3d/decoration-builder.js';
import { DECORATIONS_RAW } from '../src/data/decorations.raw.js';
import { Placeable } from '../src/game/Placeable.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';

const SUB = 0.5; // world units per sub-tile

// World-space AABB of the cells Placeable actually reserves.
function footprintBoundsFromCells(placeable, col, row, subCol, subRow, dir) {
  const cells = placeable.footprintCells(col, row, subCol, subRow, dir);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of cells) {
    const cx = c.col * 2 + c.subCol * SUB;
    const cz = c.row * 2 + c.subRow * SUB;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx + SUB);
    z0 = Math.min(z0, cz); z1 = Math.max(z1, cz + SUB);
  }
  return { x0, x1, z0, z1 };
}

function boundsFromPlacement(p) {
  return {
    x0: p.x - p.footW / 2,
    x1: p.x + p.footW / 2,
    z0: p.z - p.footL / 2,
    z1: p.z + p.footL / 2,
  };
}

// --- Footprint parity with Placeable.footprintCells ----------------------

test('rendered footprint matches Placeable.footprintCells for every dir', () => {
  const cases = ['parkBench', 'longFlowerBed', 'infoSign', 'oakTree'];
  for (const typeId of cases) {
    const raw = DECORATIONS_RAW[typeId];
    assert.ok(raw, `${typeId} exists in DECORATIONS_RAW`);
    const subW = raw.subW ?? raw.gridW ?? 4;
    const subL = raw.subL ?? raw.gridH ?? 4;
    const placeable = new Placeable({ id: typeId, kind: 'decoration', subW, subL });

    for (const dir of [0, 1, 2, 3]) {
      const dec = { col: 3, row: -2, subCol: 1, subRow: 2, subW, subL, subH: raw.subH ?? 4, dir };
      const got = boundsFromPlacement(decorationPlacement(dec));
      const want = footprintBoundsFromCells(placeable, dec.col, dec.row, dec.subCol, dec.subRow, dir);
      assert.deepEqual(got, want, `${typeId} dir=${dir}`);
    }
  }
});

test('dir=1 swaps a 3x1 bench so it is 1 wide and 3 long', () => {
  const p = decorationPlacement({ col: 0, row: 0, subCol: 0, subRow: 0, subW: 3, subL: 1, dir: 1 });
  assert.equal(p.footW, 1 * SUB);
  assert.equal(p.footL, 3 * SUB);
  // Geometry itself stays authored unrotated — rotY is what turns it.
  assert.equal(p.geoW, 3 * SUB);
  assert.equal(p.geoL, 1 * SUB);
});

test('rotation convention matches the ghost and EquipmentBuilder (-dir * PI/2)', () => {
  for (const dir of [0, 1, 2, 3]) {
    assert.equal(decorationPlacement({ dir }).rotY, -dir * (Math.PI / 2));
  }
});

// --- Ghost/placed seed parity --------------------------------------------

function recordingBuilder() {
  const calls = [];
  class Recorder extends DecorationBuilder {
    _buildOne(typeId, category, footW, footL, totalH, variant = 0, seed = 0) {
      calls.push({ typeId, category, footW, footL, totalH, variant, seed });
      return {
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        rotation: { x: 0, y: 0, z: 0 },
        traverse(cb) { cb(this); },
      };
    }
  }
  return { builder: new Recorder(), calls };
}

test('ghost seed equals placed seed for the same cell', () => {
  const pos = { col: 7, row: -4, subCol: 2, subRow: 1 };
  const { builder, calls } = recordingBuilder();

  builder._createGhost('oakTree', null, 0, pos);
  const ghostSeed = calls[0].seed;

  const parent = { children: [], add(o) { this.children.push(o); }, remove() {} };
  const raw = DECORATIONS_RAW.oakTree;
  builder.build([{
    ...pos,
    type: 'oakTree',
    category: raw.category,
    subW: raw.subW ?? 4,
    subL: raw.subL ?? 4,
    subH: raw.subH ?? 4,
    dir: 0,
    y: 0,
  }], parent);
  const placedSeed = calls[calls.length - 1].seed;

  assert.equal(ghostSeed, placedSeed);
  assert.equal(ghostSeed, decorationSeed(pos.col, pos.row, pos.subCol, pos.subRow));
  assert.notEqual(ghostSeed, 0);
});

test('ghost without a position falls back to the nominal seed', () => {
  const { builder, calls } = recordingBuilder();
  builder._createGhost('oakTree', null, 0);
  assert.equal(calls[0].seed, 0);
});

test('thumbnail camera encloses the full transmission tower', () => {
  const raw = DECORATIONS_RAW.transmissionTower;
  const size = { x: raw.subW * SUB, y: raw.subH * SUB, z: raw.subL * SUB };
  const frame = decorationThumbnailFrame(size);
  const cameraDistance = frame.isoDist * Math.sqrt(3);
  assert.ok(frame.far > cameraDistance + size.y,
    `tower remains inside the thumbnail far plane (${frame.far} > ${cameraDistance + size.y})`);
  assert.ok(frame.halfFrame > 0, 'tower thumbnail has a nonzero orthographic frame');
});

test('build applies rotation and swapped-footprint centering', () => {
  const { builder, calls } = recordingBuilder();
  const parent = { children: [], add(o) { this.children.push(o); }, remove() {} };
  const raw = DECORATIONS_RAW.parkBench;
  const dec = {
    col: 2, row: 5, subCol: 1, subRow: 0,
    type: 'parkBench', category: raw.category,
    subW: raw.subW, subL: raw.subL, subH: raw.subH ?? 4,
    dir: 1, y: 0.75,
  };
  builder.build([dec], parent);

  const p = decorationPlacement(dec);
  const group = parent.children[0];
  assert.equal(group.rotation.y, -1 * (Math.PI / 2));
  assert.equal(group.position.x, p.x);
  assert.equal(group.position.z, p.z);
  assert.equal(group.position.y, 0.75);
  // Geometry is built from the unrotated dims.
  assert.equal(calls[0].footW, raw.subW * SUB);
  assert.equal(calls[0].footL, raw.subL * SUB);
});

// --- Snapshot carries dir and samples the rendered mesh -------------------

function fakeGame(placeables, cornerHeights = new Map()) {
  return { state: { placeables, cornerHeights, cornerHeightsRevision: 0 } };
}

test('snapshot emits dir so the placed object can be rotated', () => {
  const game = fakeGame([
    { id: 1, kind: 'decoration', type: 'parkBench', col: 0, row: 0, subCol: 0, subRow: 0, dir: 3 },
    { id: 2, kind: 'decoration', type: 'oakTree', col: 1, row: 1, subCol: 0, subRow: 0 },
  ]);
  const snap = buildWorldSnapshot(game, { only: ['decorations'] });
  assert.equal(snap.decorations[0].dir, 3);
  assert.equal(snap.decorations[1].dir, 0); // absent dir defaults, never undefined
});

test('snapshot y uses the triangulated sampler, matching the rendered mesh', () => {
  // Corner steps [nw, ne, se, sw]; only SE is raised, so the SW->NE diagonal
  // split puts a bilinear sample and a triangulated sample at different heights
  // inside the NW triangle.
  const cornerHeights = new Map([['0,0', [0, 0, 4, 0]]]);
  const game = fakeGame(
    [{ id: 1, kind: 'decoration', type: 'oakTree', col: 0, row: 0, subCol: 0, subRow: 0 }],
    cornerHeights,
  );
  const snap = buildWorldSnapshot(game, { only: ['decorations'] });
  // oakTree is 4x4 -> midpoint (u,v) = (0.5, 0.5), exactly on the diagonal,
  // where the triangulated surface reads 0 while bilinear reads se/4.
  assert.equal(snap.decorations[0].y, 0);
});

test('snapshot samples the centre of the SWAPPED footprint on dir 1/3', () => {
  const cornerHeights = new Map([['0,0', [0, 0, 4, 0]]]);
  const game = fakeGame(
    [{ id: 1, kind: 'decoration', type: 'parkBench', col: 0, row: 0, subCol: 0, subRow: 0, dir: 1 }],
    cornerHeights,
  );
  const snap = buildWorldSnapshot(game, { only: ['decorations'] });
  const p = decorationPlacement({ ...snap.decorations[0] });
  // Sampled point must be the footprint centre the builder positions at.
  assert.equal(p.x, p.footW / 2);
  assert.equal(p.z, p.footL / 2);
});
