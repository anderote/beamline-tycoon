import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beamlineStatusPresentation,
  selectedBeamlineFocusModel,
} from '../src/renderer3d/selected-beamline-focus.js';

function port(placeableId) { return { placeableId, portName: 'p' }; }

function fixture() {
  const entry = {
    id: 'bl_1', sourceId: 'src_1', status: 'running',
  };
  const other = {
    id: 'bl_2', sourceId: 'src_2', status: 'stopped',
  };
  const registry = {
    get: id => [entry, other].find(item => item.id === id) || null,
    getAll: () => [entry, other],
  };
  const state = {
    placeables: [
      { id: 'src_1', type: 'source', category: 'beamline', kind: 'beamline', beamlineId: 'bl_1' },
      { id: 'end_1', type: 'faradayCup', category: 'beamline', kind: 'beamline', beamlineId: 'bl_1' },
      { id: 'src_2', type: 'source', category: 'beamline', kind: 'beamline', beamlineId: 'bl_2' },
      { id: 'other_end', type: 'faradayCup', category: 'beamline', kind: 'beamline', beamlineId: 'bl_2' },
      { id: 'panel', type: 'powerPanel', category: 'infrastructure', kind: 'infrastructure' },
      { id: 'transformer', type: 'hvTransformer', category: 'infrastructure', kind: 'infrastructure' },
      { id: 'chiller', type: 'chiller', category: 'infrastructure', kind: 'infrastructure' },
      { id: 'other_pump', type: 'turboPump', category: 'infrastructure', kind: 'infrastructure' },
    ],
    beamPipes: [
      {
        id: 'bp_1', subL: 16,
        start: { junctionId: 'src_1', portName: 'exit' },
        end: { junctionId: 'end_1', portName: 'entry' },
        path: [{ col: 1, row: 2 }, { col: 1, row: 6 }],
        placements: [{ id: 'quad_1', type: 'quadrupole', position: 0.4, subL: 2 }],
      },
      {
        id: 'bp_2', subL: 16,
        start: { junctionId: 'src_2', portName: 'exit' },
        end: { junctionId: 'other_end', portName: 'entry' },
        path: [{ col: 5, row: 2 }, { col: 5, row: 6 }], placements: [],
      },
    ],
    utilityLines: new Map(),
    utilityNetworks: new Map([
      ['powerCable', [{
        id: 'net_power', utilityType: 'powerCable', lineIds: ['line_branch'],
        ports: [port('src_1'), port('quad_1'), port('panel'), port('src_2')],
      }]],
      ['hvCable', [{
        id: 'net_hv', utilityType: 'hvCable', lineIds: ['line_hv'],
        ports: [port('panel'), port('transformer')],
      }]],
      ['coolingWater', [{
        id: 'net_cooling', utilityType: 'coolingWater', lineIds: ['line_cooling'],
        ports: [port('transformer'), port('chiller')],
      }, {
        id: 'net_other', utilityType: 'coolingWater', lineIds: ['line_other'],
        ports: [port('src_2'), port('other_pump')],
      }]],
    ]),
  };
  return { state, registry };
}

test('selected beamline focus follows serving infrastructure without crossing into another beamline', () => {
  const { state, registry } = fixture();
  const target = {
    id: 'src_1', selectionCategory: 'beamline', targetKind: 'placeable',
    entry: state.placeables[0], col: 1, row: 1,
  };
  const model = selectedBeamlineFocusModel(state, registry, target);

  assert.equal(model.beamlineId, 'bl_1');
  assert.equal(model.status, 'running');
  assert.deepEqual([...model.beamlineNodeIds].sort(), ['end_1', 'quad_1', 'src_1']);
  assert.deepEqual([...model.beamlinePipeIds], ['bp_1']);
  assert.deepEqual([...model.infrastructureIds].sort(), ['chiller', 'panel', 'transformer']);
  assert.deepEqual([...model.utilityLineIds].sort(), ['line_branch', 'line_cooling', 'line_hv']);
  assert.equal(model.utilityLineIds.has('line_other'), false,
    'a shared bus does not let another beamline pull its services into focus');
  assert.equal(model.focusedComponentIds.has('src_2'), false);
  assert.deepEqual(model.routePoints, [{ col: 1, row: 2 }, { col: 1, row: 6 }]);
});

test('pipe-mounted component selection resolves its owning beamline', () => {
  const { state, registry } = fixture();
  const model = selectedBeamlineFocusModel(state, registry, {
    id: 'quad_1', selectionCategory: 'beamline', targetKind: 'beamlineAttachment',
    col: 1, row: 4,
  });
  assert.equal(model.beamlineId, 'bl_1');
});

test('selection does not hide utilities before the solver has published topology', () => {
  const { state, registry } = fixture();
  state.utilityNetworks = null;
  const model = selectedBeamlineFocusModel(state, registry, {
    id: 'src_1', selectionCategory: 'beamline', targetKind: 'placeable',
    entry: state.placeables[0], col: 1, row: 1,
  });
  assert.equal(model.utilityLineIds, null);
  assert.equal(model.focusedComponentIds, null);
});

test('beamline run-state presentation is explicit and color-separated', () => {
  assert.deepEqual(beamlineStatusPresentation('running'), {
    label: 'BEAM ON', color: 0x35e86b,
  });
  assert.deepEqual(beamlineStatusPresentation('stopped'), {
    label: 'BEAM OFF', color: 0xff453a,
  });
  assert.equal(beamlineStatusPresentation('faulted').label, 'BEAM FAULT');
});
