import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  compatibleBeamlineTypesForSource,
  guidedEndpointSuggestions,
  guidedPlacementTarget,
  guidedPlacementSuggestions,
  infrastructureChecklistForNodes,
} from '../src/beamline/guided-setup-plan.js';
import { computeBeamlinePlacementHints } from '../src/beamline/designer-placement-hints.js';
import { GuidedBeamlineSetup } from '../src/ui/GuidedBeamlineSetup.js';

const unlocked = () => true;

test('source choice narrows the target beamline types by particle family', () => {
  const electrons = compatibleBeamlineTypesForSource('source').map(t => t.id);
  const protons = compatibleBeamlineTypesForSource('ionSource').map(t => t.id);

  assert.ok(electrons.includes('testStand'));
  assert.ok(!electrons.includes('therapy'));
  assert.ok(protons.includes('isotopeIrradiation'),
    'compatible proton missions are visible before their hardware is researched');
  assert.ok(protons.includes('therapy'),
    'therapy is a selectable purpose, not a research reward');
  assert.ok(!protons.includes('testStand'));
});

test('Guide returns the exact physics recipes used by Designer', () => {
  const nodes = [
    { kind: 'module', type: 'source', beamStart: 0, subL: 4 },
    { kind: 'drift', beamStart: 2, subL: 20, pipeId: 'pipe-1' },
  ];
  const envelope = Array.from({ length: 40 }, (_, i) => ({
    s: 12 * i / 39,
    energy: 0.00025,
    bunch_frequency: 0,
    focus_margin: 0.8,
    focus_urgency: 0.1,
  }));
  const expected = computeBeamlinePlacementHints({
    typeId: 'testStand', nodes, envelope, isUnlocked: unlocked,
  });
  const plan = guidedPlacementSuggestions({
    typeId: 'testStand', nodes, envelope, isUnlocked: unlocked,
  });

  assert.deepEqual(plan.hints, expected);
  assert.deepEqual(plan.primary, expected[0]);
  assert.equal(plan.primary.componentType, 'buncher');
  assert.equal(plan.primary.kind, 'longitudinal');
});

test('physics insertion boundaries map to forward and reverse pipe coordinates', () => {
  const nodes = [
    { kind: 'module', id: 'source-1', type: 'source', beamStart: 0, subL: 4 },
    { kind: 'drift', id: 'drift-1', beamStart: 2, subL: 20, pipeId: 'pipe-1' },
    { kind: 'module', id: 'end-1', type: 'faradayCup', beamStart: 12, subL: 4 },
  ];
  const hint = {
    componentType: 'quadrupole', nodeIndex: 1, position: 'after', s: 7,
  };
  const forward = guidedPlacementTarget({
    nodes,
    pipes: [{
      id: 'pipe-1', subL: 20,
      start: { junctionId: 'source-1' }, end: { junctionId: 'end-1' },
    }],
    hint,
  });
  const reverse = guidedPlacementTarget({
    nodes,
    pipes: [{
      id: 'pipe-1', subL: 20,
      start: { junctionId: 'end-1' }, end: { junctionId: 'source-1' },
    }],
    hint,
  });

  assert.equal(forward.forward, true);
  assert.equal(forward.position, 0.5,
    'the physics s-coordinate is retained instead of snapping to the end of a long drift');
  assert.equal(reverse.forward, false);
  assert.ok(reverse.position < forward.position,
    'reverse traversal subtracts the component span from the authored coordinate');
});

test('Guide auto-place commits the physics tuning parameters', () => {
  const guided = Object.create(GuidedBeamlineSetup.prototype);
  guided.suggestionId = 'quadrupole';
  guided.suggestionPipeId = 'pipe-1';
  guided.suggestionPosition = 0.4;
  guided.suggestionParams = { polarity: 1, gradient: 0.02 };
  let placed = null;
  guided.game = {
    commitGesture: ({ mutate }) => mutate(),
    beamline: {
      placeOnPipe: (pipeId, options) => {
        placed = { pipeId, options };
        return 'placement-1';
      },
    },
  };
  guided.onComponentBuilt = () => true;

  guided._buildSuggested();

  assert.equal(placed.pipeId, 'pipe-1');
  assert.equal(placed.options.position, 0.4);
  assert.deepEqual(placed.options.params, { polarity: 1, gradient: 0.02 });
});

test('required endpoints follow the chosen machine mission', () => {
  const endpoints = guidedEndpointSuggestions('testStand', unlocked);
  assert.ok(endpoints.includes('faradayCup'));
  assert.ok(endpoints.includes('materialsTestStation'));

  const processingEndpoints = guidedEndpointSuggestions('ebeamProcessing', unlocked);
  assert.ok(processingEndpoints.includes('xRayConverterStation'),
    'the compact X-ray station is offered as an early processing endpoint');
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

test('Guide is the sole guidance surface and exposes physics auto-place', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  const input = readFileSync(new URL('../src/input/InputHandler.js', import.meta.url), 'utf8');
  const guided = readFileSync(new URL('../src/ui/GuidedBeamlineSetup.js', import.meta.url), 'utf8');

  assert.match(html, /id="btn-build-forward"[^>]*>Guide</);
  assert.doesNotMatch(html, /btn-goals|goals-overlay/);
  assert.match(hud, /_guidedSetup\?\.toggle\?\.\(\)/);
  assert.match(input, /case 'g': case 'G':[\s\S]*?_guidedSetup\?\.toggle\?\.\(\)/);
  assert.match(guided, /data-guide-action="suggest-next"/);
  assert.match(guided, /data-guide-action="build-suggestion">Auto-place here/);
  assert.match(guided, /params: hint\.params \|\| \{\}/,
    'the dry-run receives Designer tuning parameters');
  assert.match(guided, /params,\n\s*\}\)/,
    'auto-place commits the same tuning parameters');
});
