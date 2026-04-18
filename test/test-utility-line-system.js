// test/test-utility-line-system.js — integration tests for UtilityLineSystem.
//
// UtilityLineSystem is a thin facade over validateDrawLine. It owns mutation
// of state.utilityLines and emits 'utilityLinesChanged' events with
// {utilityType} on every successful mutation. Failures go through the
// injected log callback and return null / false.
//
// Test scenarios:
//   1. addLine({utilityType, start, end, path}) with valid args → line appears
//      in state.utilityLines; utilityLinesChanged emitted with {utilityType}.
//   2. addLine with invalid args → no state change; log(..., 'bad') called.
//   3. addLine assigns id from the injected nextLineId.
//   4. removeLine(id) → line removed, event emitted, returns true.
//   5. removeLine('nonexistent') → returns false, no event.
//   6. onPlaceableRemoved(placeableId) → removes all lines referencing that
//      placeable; emits one event per affected utility type.
//   7. listLines() / listLinesByType('powerCable').

import { UtilityLineSystem } from '../src/utility/UtilityLineSystem.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixture defs: two utility types (powerCable, dataCable), each with
// source (E) and sink (W) sides.
// ---------------------------------------------------------------------------

const SRC_DEF = {
  subL: 2, subW: 2,
  ports: {
    powerOut: { side: 'right', utility: 'powerCable', role: 'source', params: { capacity: 100 } },
    dataOut:  { side: 'right', utility: 'dataCable',  role: 'source', params: { frequency: 1 } },
  },
};

const SINK_DEF = {
  subL: 2, subW: 2,
  ports: {
    powerIn: { side: 'left', utility: 'powerCable', role: 'sink', params: { demand: 50 } },
    dataIn:  { side: 'left', utility: 'dataCable',  role: 'sink', params: { frequency: 1 } },
  },
};

function placeable(id, type, col, row, dir = 0) {
  return { id, type, category: 'beamline',
           col, row, subCol: 0, subRow: 0, dir };
}

function mockSystem() {
  const state = {
    placeables: [
      // Source at col=2, row=3 (dir=0: right = E → +col first segment).
      placeable('src1', 'source_rack', 2, 3, 0),
      // Sink at col=8, row=3 (dir=0: left = W → +col last segment).
      placeable('sink1', 'sink_rack', 8, 3, 0),
      placeable('sink2', 'sink_rack', 8, 7, 0),
    ],
    utilityLines: new Map(),
    defs: { source_rack: SRC_DEF, sink_rack: SINK_DEF },
  };
  const events = [];
  const logs = [];
  let lineCtr = 0;

  const system = new UtilityLineSystem({
    state,
    emit: (ev, data) => { events.push({ ev, data }); },
    log: (msg, type) => { logs.push({ msg, type }); },
    nextLineId: () => `ul_${++lineCtr}`,
  });
  return { system, state, events, logs };
}

// A straight horizontal path from src1's east edge (col≈3) to sink1's west edge
// (col≈8), col=3→8, row=3. Both endpoints align +col (E→W).
function straightPower() {
  return {
    utilityType: 'powerCable',
    start: { placeableId: 'src1',  portName: 'powerOut' },
    end:   { placeableId: 'sink1', portName: 'powerIn'  },
    path:  [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  };
}

// ==========================================================================
// Test 1: addLine with valid args.
// ==========================================================================
console.log('\n--- Test 1: addLine valid ---');
{
  const { system, state, events, logs } = mockSystem();
  const id = system.addLine(straightPower());
  assert(typeof id === 'string', `id returned (got ${id})`);
  assert(state.utilityLines.size === 1, `1 line in state (got ${state.utilityLines.size})`);
  assert(state.utilityLines.has(id), 'line is keyed by id');
  const line = state.utilityLines.get(id);
  assert(line.utilityType === 'powerCable', 'utilityType preserved');
  assert(line.start.placeableId === 'src1', 'start ref preserved');
  assert(line.end.placeableId === 'sink1', 'end ref preserved');
  assert(typeof line.subL === 'number' && line.subL > 0, 'subL computed');
  const ev = events.find(e => e.ev === 'utilityLinesChanged');
  assert(!!ev, 'utilityLinesChanged event emitted');
  assert(ev && ev.data && ev.data.utilityType === 'powerCable', 'event carries utilityType');
  assert(logs.length === 0, `no logs (got ${logs.length})`);
}

// ==========================================================================
// Test 2: addLine with invalid args → null, log called with 'bad'.
// ==========================================================================
console.log('\n--- Test 2: addLine invalid ---');
{
  const { system, state, events, logs } = mockSystem();
  // No path → invalid_path.
  const id = system.addLine({
    utilityType: 'powerCable',
    start: { placeableId: 'src1', portName: 'powerOut' },
    end:   { placeableId: 'sink1', portName: 'powerIn' },
    path:  [],
  });
  assert(id === null, `returns null (got ${id})`);
  assert(state.utilityLines.size === 0, `state unchanged (got ${state.utilityLines.size})`);
  assert(events.length === 0, `no events (got ${events.length})`);
  assert(logs.length === 1, `one log (got ${logs.length})`);
  assert(logs[0].type === 'bad', `log type=bad (got ${logs[0].type})`);
}

// ==========================================================================
// Test 3: addLine uses injected nextLineId; successive ids differ.
// ==========================================================================
console.log('\n--- Test 3: id assignment ---');
{
  const { system, state } = mockSystem();
  const id1 = system.addLine(straightPower());
  // Second add on same ports would fail port_taken, so build a 2nd distinct line.
  const id2 = system.addLine({
    utilityType: 'dataCable',
    start: { placeableId: 'src1',  portName: 'dataOut' },
    end:   { placeableId: 'sink1', portName: 'dataIn'  },
    path:  [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });
  assert(id1 === 'ul_1', `first id = ul_1 (got ${id1})`);
  assert(id2 === 'ul_2', `second id = ul_2 (got ${id2})`);
  assert(state.utilityLines.size === 2, `2 lines (got ${state.utilityLines.size})`);
}

// ==========================================================================
// Test 4: removeLine(id) → removed, event emitted, true.
// ==========================================================================
console.log('\n--- Test 4: removeLine ---');
{
  const { system, state, events } = mockSystem();
  const id = system.addLine(straightPower());
  // Clear events from the add.
  events.length = 0;
  const removed = system.removeLine(id);
  assert(removed === true, `removeLine returns true (got ${removed})`);
  assert(state.utilityLines.size === 0, 'line gone');
  const ev = events.find(e => e.ev === 'utilityLinesChanged');
  assert(!!ev, 'utilityLinesChanged emitted on remove');
  assert(ev && ev.data && ev.data.utilityType === 'powerCable',
    'remove event carries utilityType');
}

// ==========================================================================
// Test 5: removeLine('nonexistent') → false, no event.
// ==========================================================================
console.log('\n--- Test 5: removeLine missing ---');
{
  const { system, events } = mockSystem();
  const removed = system.removeLine('nope');
  assert(removed === false, `removeLine returns false (got ${removed})`);
  assert(events.length === 0, `no events (got ${events.length})`);
}

// ==========================================================================
// Test 6: onPlaceableRemoved cascades & emits one event per utility type.
// ==========================================================================
console.log('\n--- Test 6: onPlaceableRemoved ---');
{
  const { system, state, events } = mockSystem();
  // Add a powerCable line + a dataCable line (both reference src1).
  system.addLine(straightPower());
  system.addLine({
    utilityType: 'dataCable',
    start: { placeableId: 'src1',  portName: 'dataOut' },
    end:   { placeableId: 'sink1', portName: 'dataIn'  },
    path:  [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });
  assert(state.utilityLines.size === 2, '2 lines before cascade');
  events.length = 0;

  system.onPlaceableRemoved('src1');

  assert(state.utilityLines.size === 0, `all lines removed (got ${state.utilityLines.size})`);
  const types = events
    .filter(e => e.ev === 'utilityLinesChanged')
    .map(e => e.data && e.data.utilityType);
  assert(types.length === 2, `2 events emitted (got ${types.length})`);
  assert(types.includes('powerCable'), 'powerCable event emitted');
  assert(types.includes('dataCable'), 'dataCable event emitted');
}

// ==========================================================================
// Test 7: listLines / listLinesByType.
// ==========================================================================
console.log('\n--- Test 7: list helpers ---');
{
  const { system } = mockSystem();
  system.addLine(straightPower());
  system.addLine({
    utilityType: 'dataCable',
    start: { placeableId: 'src1',  portName: 'dataOut' },
    end:   { placeableId: 'sink1', portName: 'dataIn'  },
    path:  [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });

  const all = system.listLines();
  assert(Array.isArray(all) && all.length === 2, `listLines → 2 (got ${all.length})`);

  const power = system.listLinesByType('powerCable');
  assert(power.length === 1, `powerCable: 1 (got ${power.length})`);
  assert(power[0].utilityType === 'powerCable', 'powerCable entry type');

  const data = system.listLinesByType('dataCable');
  assert(data.length === 1, `dataCable: 1 (got ${data.length})`);

  const none = system.listLinesByType('cryoTransfer');
  assert(none.length === 0, `cryoTransfer: 0 (got ${none.length})`);
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
