// Lighting catalogue ownership and subsection coverage. Floor lamps use the
// ordinary occupying ground mount, but are indoor building fixtures; palette
// ownership is therefore authored through the subsection contract instead of
// being guessed from mount alone.

import { MODES } from '../src/data/modes.js';
import { LIGHTING_DEFS } from '../src/data/placeables/lighting.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('\n--- Lighting palette split and subsections ---');

const EXPECTED = {
  lighting: {
    pathLandscape: ['lamppost', 'doubleLamppost', 'bollardLight'],
    areaSecurity: ['highMastLight', 'floodLight'],
  },
  structureLights: {
    floorLamps: ['floorLamp', 'arcFloorLamp', 'torchiere'],
    deskTask: ['deskLamp', 'portableWorkLight', 'bankerLamp', 'magnifierTaskLamp'],
    ceilingLights: [
      'ceilingPanel', 'highBay', 'linearPendant', 'cleanroomPanel',
      'recessedDownlight', 'ceilingBatten',
    ],
    wallLights: ['wallSconce', 'bulkheadLight', 'wallStripLight', 'pictureLight'],
    utilityWarning: [
      'emergencyWallLight', 'emergencyCeilingLight', 'klaxonStrobe',
      'rotatingBeacon', 'signalTower', 'exitLight',
    ],
  },
};

const categories = {
  lighting: MODES.grounds?.categories?.lighting,
  structureLights: MODES.structure?.categories?.structureLights,
};
const byId = Object.fromEntries(LIGHTING_DEFS.map(def => [def.id, def]));

assert(LIGHTING_DEFS.length === 28, `twenty-eight lighting fixtures defined (got ${LIGHTING_DEFS.length})`);

const expectedIds = [];
for (const [category, subsectionMap] of Object.entries(EXPECTED)) {
  const categoryDef = categories[category];
  assert(categoryDef?.isDecorationTab === true, `${category} is a decoration palette tab`);
  for (const [subsection, ids] of Object.entries(subsectionMap)) {
    assert(!!categoryDef?.subsections?.[subsection], `${category}.${subsection} is a labeled palette subsection`);
    for (const id of ids) {
      expectedIds.push(id);
      const def = byId[id];
      assert(!!def, `${id} exists`);
      assert(def?.category === category, `${id} belongs to ${category}`);
      assert(def?.subsection === subsection, `${id} belongs to ${subsection}`);
    }
  }
}

assert(new Set(expectedIds).size === expectedIds.length, 'no fixture is listed in two subsections');
assert(expectedIds.length === LIGHTING_DEFS.length, 'every lighting fixture is covered by the subsection contract');
assert(LIGHTING_DEFS.every(def => expectedIds.includes(def.id)), 'the catalogue contains no orphaned fixture');

for (const id of ['floorLamp', 'arcFloorLamp', 'torchiere']) {
  assert(byId[id].mount === 'ground', `${id} reserves ordinary floor occupancy`);
  assert(byId[id].category === 'structureLights', `${id} stays in the indoor Structure palette`);
}

for (const id of ['klaxonStrobe', 'rotatingBeacon', 'signalTower']) {
  assert(byId[id].light.dynamicProfile === 'statusBlink', `${id} uses the warning-light pulse profile`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
