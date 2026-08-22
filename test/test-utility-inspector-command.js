// Utility-line clicks resolve through the published network discovery and
// open the inspector identified by that solved network.

import {
  openUtilityInspectorForLine,
  utilityNetworkForLine,
} from '../src/ui/utility-inspector-command.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

console.log('\n--- Utility inspector click command ---');

{
  const line = {
    id: 'line_bus_power',
    utilityType: 'powerCable',
    start: { placeableId: 'source', portName: 'out' },
    end: { placeableId: 'sink', portName: 'in' },
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  };
  const published = {
    id: 'net_powerCable_published',
    utilityType: 'powerCable',
    lineIds: [line.id],
    sources: [],
    sinks: [],
  };
  const state = {
    utilityLines: new Map([[line.id, line]]),
    utilityNetworks: new Map([['powerCable', [published]]]),
  };

  const resolved = utilityNetworkForLine(state, line.id);
  assert(resolved?.network === published,
    'line selection reuses the solver-published network object');

  let opened = null;
  const didOpen = openUtilityInspectorForLine({ state }, line.id, (utilityType, networkId) => {
    opened = { utilityType, networkId };
  });
  assert(didOpen === true, 'a line on a published network opens an inspector');
  assert(opened?.utilityType === 'powerCable'
      && opened?.networkId === 'net_powerCable_published',
  'the inspector receives the clicked line\'s solved utility type and network id');
}

{
  const state = { utilityLines: new Map(), utilityNetworks: new Map() };
  let opened = false;
  assert(openUtilityInspectorForLine({ state }, 'missing', () => { opened = true; }) === false,
    'a missing line is a clean no-op');
  assert(opened === false, 'a missing line cannot create an inspector window');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

