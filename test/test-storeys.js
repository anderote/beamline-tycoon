import assert from 'node:assert/strict';
import {
  MAX_FLOORS, MAX_LEVEL, STOREY_HEIGHT, floorLabel, levelOf, levelWorldY,
  normalizeLevel, parseSubtileKey, parseTileKey, sameLevel, storeyEdgeKey,
  subtileKey, tileKey, withLevel,
} from '../src/game/storeys.js';
import { edgeKey, findEdgeKey, mirrorEdge, parseEdgeKey } from '../src/game/edge-keys.js';

assert.equal(MAX_FLOORS, 3);
assert.equal(MAX_LEVEL, 2);
assert.equal(normalizeLevel(-4), 0);
assert.equal(normalizeLevel(99), 2);
assert.equal(levelOf({}), 0, 'legacy records belong to the ground floor');
assert.equal(levelOf({ level: 1 }), 1);
assert.equal(levelWorldY(2), STOREY_HEIGHT * 2);
assert.deepEqual(['GF', '2F', '3F'], [0, 1, 2].map(floorLabel));

assert.equal(tileKey(4, -2, 0), '4,-2', 'ground tile keys stay legacy-compatible');
assert.equal(subtileKey(4, -2, 1, 3, 0), '4,-2,1,3');
assert.equal(storeyEdgeKey(4, -2, 'n', 0), '4,-2,n');
assert.equal(tileKey(4, -2, 1), '1|4,-2');
assert.equal(subtileKey(4, -2, 1, 3, 2), '2|4,-2,1,3');
assert.equal(storeyEdgeKey(4, -2, 'n', 2), '2|4,-2,n');
assert.deepEqual(parseTileKey('1|4,-2'), { col: 4, row: -2, level: 1 });
assert.deepEqual(
  parseSubtileKey('2|4,-2,1,3'),
  { col: 4, row: -2, subCol: 1, subRow: 3, level: 2 },
);

assert.deepEqual(withLevel({ col: 1, row: 2 }, 0), { col: 1, row: 2 });
assert.deepEqual(withLevel({ col: 1, row: 2 }, 2), { col: 1, row: 2, level: 2 });
assert.equal(sameLevel({}, 0), true);
assert.equal(sameLevel({ level: 1 }, 0), false);

assert.equal(edgeKey(4, -2, 'n'), '4,-2,n');
assert.equal(edgeKey(4, -2, 'n', 1), '1|4,-2,n');
assert.deepEqual(parseEdgeKey('2|4,-2,n'), { col: 4, row: -2, edge: 'n', level: 2 });
assert.deepEqual(mirrorEdge(4, -2, 'n', 1), { col: 4, row: -3, edge: 's', level: 1 });
assert.equal(findEdgeKey({ '1|4,-3,s': 'officeWall' }, 4, -2, 'n', 1), '1|4,-3,s');

console.log('storey coordinate contract tests passed');
