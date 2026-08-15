import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPONENTS } from '../src/data/components.js';
import {
  compatibleBeamlineTypesForSource,
  guidedEndpointSuggestions,
  guidedPlacementSuggestions,
  infrastructureChecklistForNodes,
} from '../src/beamline/guided-setup-plan.js';

const unlocked = () => true;

test('source choice narrows the target beamline types by particle family', () => {
  const research = { completedResearch: [] };
  const electrons = compatibleBeamlineTypesForSource('source', research).map(t => t.id);
  const protons = compatibleBeamlineTypesForSource('ionSource', research).map(t => t.id);

  assert.ok(electrons.includes('testStand'));
  assert.ok(!electrons.includes('therapy'));
  assert.ok(protons.includes('isotopeIrradiation') === false,
    'research-gated proton types remain hidden until unlocked');

  const allResearch = {
    completedResearch: Object.values(COMPONENTS).map(c => c.requires).filter(Boolean).flat(),
  };
  const unlockedProtons = compatibleBeamlineTypesForSource('ionSource', allResearch).map(t => t.id);
  assert.ok(!unlockedProtons.includes('testStand'));
});

test('starter recipe advances from bunching to acceleration to focusing', () => {
  let plan = guidedPlacementSuggestions({
    sourceType: 'source', typeId: 'testStand', placements: [], isUnlocked: unlocked,
  });
  assert.equal(plan.primary, 'buncher');
  assert.equal(plan.coreReady, false);

  plan = guidedPlacementSuggestions({
    sourceType: 'source', typeId: 'testStand',
    placements: [{ type: 'buncher' }], isUnlocked: unlocked,
  });
  assert.equal(plan.primary, 'pillboxCavity');

  plan = guidedPlacementSuggestions({
    sourceType: 'source', typeId: 'testStand',
    placements: [{ type: 'buncher' }, { type: 'pillboxCavity' }], isUnlocked: unlocked,
  });
  assert.equal(plan.primary, 'quadrupole');

  plan = guidedPlacementSuggestions({
    sourceType: 'source', typeId: 'testStand',
    placements: [
      { type: 'buncher' }, { type: 'pillboxCavity' }, { type: 'quadrupole' },
    ], isUnlocked: unlocked,
  });
  assert.equal(plan.coreReady, true);
  assert.equal(plan.primary, 'bpm');
});

test('pre-bunched RF guns skip the redundant buncher suggestion', () => {
  const plan = guidedPlacementSuggestions({
    sourceType: 'ncRfGun', typeId: 'testStand', placements: [], isUnlocked: unlocked,
  });
  assert.equal(plan.primary, 'pillboxCavity');
});

test('required endpoints follow the chosen machine mission', () => {
  const endpoints = guidedEndpointSuggestions('testStand', unlocked);
  assert.ok(endpoints.includes('faradayCup'));
  assert.ok(endpoints.includes('materialsTestStation'));
});

test('infrastructure checklist is derived from real component sink ports', () => {
  const nodes = [
    { id: 'source-1', type: 'source' },
    { id: 'bunch-1', type: 'buncher' },
    { id: 'cavity-1', type: 'pillboxCavity' },
  ];
  const state = {
    unwiredSinks: {
      'source-1': { powerCable: true },
      'bunch-1': { powerCable: true, rfWaveguide: true },
      'cavity-1': { powerCable: true, rfWaveguide: true },
    },
    utilityLines: new Map(),
  };
  const rows = infrastructureChecklistForNodes(nodes, state);
  assert.deepEqual(rows.map(r => r.utility), [
    'powerCable', 'rfWaveguide', 'coolingWater', 'vacuumPipe',
  ]);
  assert.equal(rows[0].sinkCount, 3);
  assert.equal(rows[0].complete, false);
  assert.deepEqual(rows[1].frequencies, [162500000],
    'RF checklist exposes the actual frequency bucket the source must cover');

  state.unwiredSinks = {};
  assert.ok(infrastructureChecklistForNodes(nodes, state).every(r => r.complete));
});
