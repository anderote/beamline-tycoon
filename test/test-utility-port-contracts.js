import assert from 'node:assert/strict';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import {
  findUtilityPortName,
  resolveUtilityPortName,
} from '../src/utility/port-contracts.js';

const bus = { ports: getUtilityPortsV2('powerBus') };

assert.equal(
  findUtilityPortName(bus.ports, { utility: 'powerCable', role: 'pass', side: 'back' }),
  'pwr_in',
);
assert.equal(
  resolveUtilityPortName(bus, 'powerCable', { role: 'pass', side: 'right', index: 1 }),
  'pwr_out_3',
);
assert.equal(
  resolveUtilityPortName(bus, 'powerCable', { port: 'pwr_out_1' }),
  'pwr_out_1',
);
assert.equal(
  resolveUtilityPortName(bus, 'rfWaveguide', { role: 'pass' }),
  null,
);
assert.equal(
  resolveUtilityPortName(bus, 'powerCable', { port: 'missing' }),
  null,
);

console.log('PASS: utility port references resolve by capability and validate explicit names');
