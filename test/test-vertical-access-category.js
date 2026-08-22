import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPONENTS } from '../src/data/components.js';
import { MODES } from '../src/data/modes.js';
import { componentPaletteEntries } from '../src/ui/palette-collection.js';

test('Structure exposes a vertical-access category with the working stair placeable', () => {
  const category = MODES.structure.categories.verticalAccess;
  assert.equal(category.name, 'Vertical Access');
  assert.deepEqual(Object.keys(category.subsections), ['stairs', 'elevators']);
  assert.deepEqual(category.subsections.stairs.linkedPlaceables, ['internalStairs']);

  const linkedIds = Object.values(category.subsections)
    .flatMap(subsection => subsection.linkedPlaceables || []);
  const entries = componentPaletteEntries(COMPONENTS, 'verticalAccess', linkedIds);

  assert.deepEqual(entries.map(({ key }) => key), ['internalStairs']);
  assert.equal(entries[0].comp.verticalConnector.kind, 'stairs');
  assert.equal(entries[0].comp.category, 'ops',
    'the secondary Structure palette home does not change functional Infra ownership');
});
