// test/test-zone-label.js — the pure half of the floor-painted zone labels.
//
// Everything the look depends on that can be decided without a GPU: which
// rectangle of a ragged zone the paint goes in, which way it faces as the
// camera orbits, how it shrinks into a small room, and which of two
// overlapping labels survives. buildZoneFloorLabel itself needs THREE + a
// canvas and is covered by the browser screenshots, not here.

import {
  largestSolidRect,
  rectCenterWorld,
  labelAxisForRect,
  labelYaw,
  fixedLabelYaw,
  fitLabelBox,
  abbreviateZoneName,
  brightenHex,
  resolveLabelOverlaps,
  ZONE_LABEL_STYLES,
  DEFAULT_ZONE_LABEL_STYLE,
  zoneLabelStyleById,
} from '../src/renderer3d/zone-label.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
const tiles = (...pairs) => pairs.map(([col, row]) => ({ col, row }));

console.log('largestSolidRect');
{
  const r = largestSolidRect(tiles([0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]));
  assert(r.w === 3 && r.h === 2 && r.col0 === 0 && r.row0 === 0, 'full 3x2 block is its own rectangle');

  // L shape: a 3x3 block minus its top-right 2x2 corner. The biggest solid
  // rectangle is the 1x3 left column or the 3x1 bottom row (area 3 each).
  const L = largestSolidRect(tiles([0, 0], [0, 1], [0, 2], [1, 2], [2, 2]));
  assert(L.w * L.h === 3, 'L-shape falls back to its longest solid arm');
  assert((L.w === 1 && L.h === 3) || (L.w === 3 && L.h === 1), 'and that arm is 1 tile thick');

  // A ring: the centroid sits on the hole, which is exactly why the label is
  // placed from the solid rectangle instead.
  const ring = largestSolidRect(tiles(
    [0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2],
  ));
  assert(ring.w * ring.h === 3, 'ring picks a solid 3x1 side, never the hole');

  assert(largestSolidRect([]) === null, 'empty cluster has no rectangle');
  const one = largestSolidRect(tiles([5, -3]));
  assert(one.w === 1 && one.h === 1 && one.col0 === 5 && one.row0 === -3, 'single tile');
}

console.log('rectCenterWorld');
{
  const c = rectCenterWorld({ col0: 0, row0: 0, w: 1, h: 1 });
  assert(c.x === 1 && c.z === 1, 'a 1x1 rect centres on the tile centre (col*2+1)');
  const d = rectCenterWorld({ col0: 2, row0: 4, w: 4, h: 2 });
  assert(d.x === 8 && d.z === 10, '4x2 rect at (2,4) centres at world (8,10)');
}

console.log('label axis + facing');
{
  assert(labelAxisForRect({ w: 6, h: 2 }) === 'x', 'wide room runs the text along X');
  assert(labelAxisForRect({ w: 2, h: 6 }) === 'z', 'deep room runs the text along Z');
  assert(labelAxisForRect({ w: 3, h: 3 }) === 'x', 'square room defaults to X');

  // The camera-right vector is matrixWorld column 0. Text along +X reads
  // left-to-right exactly when that column's x component is positive.
  assert(labelYaw('x', 0.7, 0.7) === 0, 'X axis, camera-right +x: no flip');
  assert(labelYaw('x', -0.7, 0.7) === Math.PI, 'X axis, camera-right -x: 180 flip');
  assert(labelYaw('z', 0.7, -0.7) === Math.PI / 2, 'Z axis, camera-right -z: yaw PI/2');
  assert(labelYaw('z', 0.7, 0.7) === (3 * Math.PI) / 2, 'Z axis, camera-right +z: the other end');

  // The property that makes axis-locking free: of the two directions along an
  // axis, exactly one reads left-to-right, for every camera yaw.
  let bad = 0;
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180;
    const rx = Math.cos(a), rz = Math.sin(a);
    for (const axis of ['x', 'z']) {
      const yaw = labelYaw(axis, rx, rz);
      // Text run direction for rotation.y = yaw is (cos yaw, 0, -sin yaw);
      // its screen-space x is the dot with camera-right.
      const dx = Math.cos(yaw) * rx - Math.sin(yaw) * rz;
      if (dx < -1e-9) bad++;
    }
  }
  assert(bad === 0, 'text never reads right-to-left, at any of 360 camera yaws');

  assert(fixedLabelYaw('x') === 0 && fixedLabelYaw('z') === Math.PI / 2,
    'the fixed variant ignores the camera entirely');
}

console.log('fitLabelBox');
{
  const style = DEFAULT_ZONE_LABEL_STYLE;
  // Aspect 12 is roughly "RF LABORATORY" in Press Start 2P.
  const big = fitLabelBox(20, 12, 12, style);
  assert(Math.abs(big.w / big.h - 12) < 1e-9, 'aspect ratio is preserved');
  assert(big.h === style.maxHeight, 'a 20-tile hall is capped by maxHeight, not by the room');
  const wide = fitLabelBox(6, 6, 12, style);
  assert(Math.abs(wide.w - 6 * 2 * style.widthFrac) < 1e-9, 'a 6-tile room fills widthFrac of its run');
  const thin = fitLabelBox(20, 1, 12, style);
  assert(Math.abs(thin.h - 1 * 2 * style.crossFrac) < 1e-9, 'a 1-tile-deep corridor is capped across');
  const tiny = fitLabelBox(1, 1, 12, style);
  assert(tiny.h < style.abbrevBelow, 'a 1x1 closet cannot carry the full name');
  const tinyAbbrev = fitLabelBox(1, 1, 2.2, style);
  assert(tinyAbbrev.h > style.hideBelow, '...but it can carry the two-letter abbreviation');

  // Scale is world-space and linear in the footprint: doubling the room
  // doubles the paint, which is what makes it zoom with the scene.
  const a = fitLabelBox(3, 3, 12, style), b = fitLabelBox(6, 6, 12, style);
  assert(Math.abs(b.h - 2 * a.h) < 1e-9, 'twice the room, twice the paint');
}

console.log('abbreviateZoneName');
{
  assert(abbreviateZoneName('RF Laboratory') === 'RL', 'two words -> initials');
  assert(abbreviateZoneName('Maintenance') === 'MA', 'one word -> first two letters');
  assert(abbreviateZoneName('') === '?', 'empty name degrades instead of throwing');
}

console.log('brightenHex');
{
  const c = brightenHex(0xaa8833, 0.66, 0.9);
  const l = (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2 / 255;
  assert(Math.abs(l - 0.66) < 0.01, 'lightness lands on target');
  assert(c.r > c.g && c.g > c.b, 'hue is preserved (still an amber)');
  const grey = brightenHex(0x808080, 0.8, 1);
  assert(grey.r === grey.g && grey.g === grey.b, 'a grey stays grey (no hue invented)');
  const white = brightenHex(0xffffff, 0.5, 1);
  assert(white.r === 128 && white.g === 128 && white.b === 128, 'saturation-0 path');
}

console.log('resolveLabelOverlaps');
{
  const apart = [{ cx: 0, cz: 0, w: 4, h: 1 }, { cx: 20, cz: 0, w: 4, h: 1 }];
  assert(resolveLabelOverlaps(apart).length === 2, 'labels that do not touch both survive');

  const clash = [
    { cx: 0, cz: 0, w: 2, h: 2 },    // small
    { cx: 0.2, cz: 0, w: 8, h: 4 },  // big, nearly on top of it
  ];
  const kept = resolveLabelOverlaps(clash);
  assert(kept.length === 1 && kept[0] === 1, 'the bigger room keeps its label');

  const grazing = [{ cx: 0, cz: 0, w: 4, h: 2 }, { cx: 3.9, cz: 0, w: 4, h: 2 }];
  assert(resolveLabelOverlaps(grazing).length === 2, 'a slight graze is tolerated');

  assert(resolveLabelOverlaps([]).length === 0, 'no labels, no crash');
}

console.log('style config');
{
  const ids = Object.keys(ZONE_LABEL_STYLES);
  assert(ids.length >= 4, 'at least four variants to compare');
  for (const id of ids) {
    const s = ZONE_LABEL_STYLES[id];
    assert(s.id === id, `${id}: id matches its key`);
    assert(s.opacity > 0 && s.opacity <= 1, `${id}: opacity in range`);
    assert(s.hideBelow < s.abbrevBelow, `${id}: hides only below the abbreviation threshold`);
    assert(s.rotation === 'flip' || s.rotation === 'fixed', `${id}: known rotation mode`);
  }
  assert(zoneLabelStyleById('stencil') === ZONE_LABEL_STYLES.stencil, 'lookup by id');
  assert(zoneLabelStyleById('nope') === null, 'unknown id returns null, not undefined-ish');
  assert(Object.values(ZONE_LABEL_STYLES).includes(DEFAULT_ZONE_LABEL_STYLE), 'default is one of the variants');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
