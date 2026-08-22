import assert from 'node:assert/strict';
import { LAND_PARCEL_COST } from '../src/data/land.js';
import {
  LAND_MARKER_OFFSET, LAND_WORLD_UNITS_PER_TILE, landMarkerLayout, purchaseLandFromMarker,
} from '../src/renderer3d/land-purchase-markers.js';

const markers = landMarkerLayout(30);
assert.equal(markers.length, 4, 'one purchase arrow is published at every edge');
assert.deepEqual(markers.map(m => m.side), ['n', 'e', 's', 'w']);

const center = LAND_WORLD_UNITS_PER_TILE / 2;
const edgeDistance = (30 + LAND_MARKER_OFFSET + 0.5) * LAND_WORLD_UNITS_PER_TILE;
for (const marker of markers) {
  const alongX = marker.dx !== 0;
  assert.equal(alongX ? marker.z : marker.x, center,
    `${marker.side} is centred on its edge`);
  assert.equal(Math.abs((alongX ? marker.x : marker.z) - center), edgeDistance,
    `${marker.side} lies beyond the owned edge`);
  assert.equal(Math.abs(marker.dx) + Math.abs(marker.dz), 1,
    `${marker.side} points along exactly one tile axis`);
}

assert.equal(LAND_PARCEL_COST, 500_000, 'every square expansion costs $500k');

{
  let purchases = 0;
  const game = {
    buyLand() { purchases++; return { ok: true, parcel: { cost: LAND_PARCEL_COST } }; },
    log() { throw new Error('successful marker purchases must not log an error'); },
  };
  assert.equal(purchaseLandFromMarker(game).ok, true);
  assert.equal(purchases, 1, 'a marker click delegates once to the public buyLand command');
}

{
  const messages = [];
  const game = {
    buyLand() { return { ok: false, reason: 'Land Acquisition costs $500,000.' }; },
    log(message, kind) { messages.push({ message, kind }); },
  };
  assert.equal(purchaseLandFromMarker(game).ok, false);
  assert.deepEqual(messages, [
    { message: 'Land Acquisition costs $500,000.', kind: 'bad' },
  ], 'a refused click explains the price through the game log');
}

console.log('land purchase marker tests passed');
