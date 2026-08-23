import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/game/Game.js';
import {
  beamlineRunReadiness,
  findBeamlineComponent,
  toggleBeamlineComponentState,
} from '../src/beamline/component-operation.js';
import { makeDefaultPortLookup } from '../src/utility/network-discovery.js';

function sourceFixture() {
  const source = {
    id: 'source_1', type: 'source', category: 'beamline', beamlineEnabled: true,
  };
  const downstream = {
    id: 'quad_1', type: 'quadrupole', beamlineEnabled: true,
    position: 0.25, subL: 2,
  };
  const state = {
    placeables: [source],
    beamPipes: [{
      id: 'pipe_1', subL: 8,
      path: [{ col: 0, row: 0 }, { col: 2, row: 0 }],
      placements: [downstream],
    }],
    infraBlockers: [{
      code: 'power_unconnected', reason: 'Quadrupole is unpowered',
      location: { placeableId: downstream.id },
    }],
    nodeQualities: {
      [source.id]: { powerQuality: 1, coolingQuality: 1, vacuumQuality: 1 },
      [downstream.id]: { powerQuality: 0 },
    },
  };
  const entry = {
    sourceId: source.id,
    beamState: { componentHealth: { [source.id]: 100, [downstream.id]: 100 } },
  };
  return { source, downstream, state, entry };
}

test('downstream utility faults do not prevent a working source from running', () => {
  const { source, downstream, state, entry } = sourceFixture();
  // Vacuum is a beam-path condition for this source, not one of its declared
  // operating requirements. Poor vacuum is therefore a physics penalty too.
  state.nodeQualities[source.id].vacuumQuality = 0;
  const result = beamlineRunReadiness(state, entry, [source, downstream]);
  assert.equal(result.canRun, true);
});

test('source utilities, source failure, and staffing still gate emission', () => {
  const { source, downstream, state, entry } = sourceFixture();

  state.nodeQualities[source.id].powerQuality = 0;
  assert.equal(beamlineRunReadiness(state, entry, [source, downstream]).canRun, false);

  state.nodeQualities[source.id].powerQuality = 1;
  entry.beamState.componentHealth[source.id] = 0;
  assert.equal(
    beamlineRunReadiness(state, entry, [source, downstream]).code,
    'source_failed',
  );

  entry.beamState.componentHealth[source.id] = 100;
  state.infraBlockers.push({ code: 'beam_unstaffed', reason: 'No operator' });
  assert.equal(
    beamlineRunReadiness(state, entry, [source, downstream]).code,
    'beam_unstaffed',
  );
});

test('module and on-pipe component toggles mutate the canonical saved records', () => {
  const { downstream, state } = sourceFixture();
  assert.equal(findBeamlineComponent(state, downstream.id), downstream);

  const off = toggleBeamlineComponentState(state, downstream.id);
  assert.equal(off.enabled, false);
  assert.equal(downstream.beamlineEnabled, false);

  const on = toggleBeamlineComponentState(state, downstream.id);
  assert.equal(on.enabled, true);
  assert.equal(downstream.beamlineEnabled, true);
});

test('switched-off active services have zero demand while vacuum remains live', () => {
  const { downstream, state } = sourceFixture();
  downstream.beamlineEnabled = false;
  const lookup = makeDefaultPortLookup(state);
  const ports = lookup.listPorts(downstream.id);
  const power = ports.find(port => port.spec?.utility === 'powerCable');
  const vacuum = ports.find(port => port.spec?.utility === 'vacuumPipe');

  assert.equal(power?.spec?.params?.demand, 0);
  assert.notEqual(vacuum?.spec?.params?.outgassing, 0);
});

test('downstream beam loss no longer switches off a running source', () => {
  const entry = {
    id: 'bl-1', status: 'running',
    beamState: { componentHealth: {}, continuousBeamTicks: 10 },
  };
  const events = [];
  const game = {
    registry: { get: () => entry },
    _writeBackCavityResults() {},
    emit(name, payload) { events.push([name, payload]); },
    log() {},
  };

  Game.prototype.applyPhysicsResultForBeamline.call(game, entry, {
    beamEnergy: 0,
    dataRate: 0,
    beamQuality: 0,
    luminosity: 0,
    beamAlive: false,
    beamCurrent: 0,
    totalLossFraction: 1,
    envelope: [],
    cavities: [],
  });

  assert.equal(entry.status, 'running');
  assert.equal(entry.beamState.physicsAlive, false);
  assert.equal(events.some(([name]) => name === 'beamToggled'), false);
});
