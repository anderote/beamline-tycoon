import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BEAMLINE_COMPONENTS_RAW as COMPONENTS } from '../src/data/beamline-components.raw.js';
import { PARAM_DEFS, computeStats, getDefaults } from '../src/beamline/component-physics.js';
import { UTILITY_PORTS_V2_BY_ID } from '../src/data/utility-ports-v2.js';

const starterSources = Object.values(COMPONENTS)
  .filter(component => component.isSource && component.unlocked === true);

test('the opening catalogue has several electron and proton source choices', () => {
  const electrons = starterSources.filter(component => component.subsection === 'electron');
  const protons = starterSources.filter(component => component.subsection === 'proton');
  assert.ok(electrons.length >= 3, `expected 3+ starter electron sources, found ${electrons.length}`);
  assert.ok(protons.length >= 3, `expected 3+ starter proton sources, found ${protons.length}`);
});

test('all dedicated source guns have tunable physics and usable extraction energy', () => {
  const ids = [
    'source', 'dcPhotoGun', 'ncRfGun', 'srfGun',
    'penningIonSource', 'ionSource', 'ecrIonSource',
  ];
  for (const id of ids) {
    assert.ok(PARAM_DEFS[id], `${id} has parameter definitions`);
    const stats = computeStats(id, getDefaults(id));
    assert.ok(stats.beamCurrent > 0, `${id} produces current`);
    assert.ok(stats.extractionEnergy > 0, `${id} declares source extraction energy`);
  }
});

test('source utility requirements are backed by authored sink ports', () => {
  for (const component of Object.values(COMPONENTS).filter(c => c.isSource)) {
    const sinkUtilities = new Set(Object.values(UTILITY_PORTS_V2_BY_ID[component.id] || {})
      .filter(port => port.role === 'sink')
      .map(port => port.utility));
    for (const utility of component.requiredConnections || []) {
      assert.ok(sinkUtilities.has(utility), `${component.id} has a ${utility} sink port`);
    }
  }
});
