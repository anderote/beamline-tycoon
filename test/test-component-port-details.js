// Component info windows expose the resolved utility-port contract: connector
// kinds, directions, names, and solver-facing demand/capacity values.

import {
  componentUtilityPortGroups,
  componentUtilityPortSectionHtml,
} from '../src/ui/utility-port-details.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.error('  FAIL:', message); }
}

function group(type, utilityType, role) {
  return componentUtilityPortGroups(type)
    .find(entry => entry.utilityType === utilityType && entry.role === role);
}

console.log('\n=== Component info utility ports ===\n');

{
  const mccInput = group('mcc', 'hvCable', 'sink');
  const mccOutputs = group('mcc', 'powerCable', 'source');
  assert(mccInput?.count === 1 && mccInput.portNames[0] === 'hv_in'
      && mccInput.metrics[0]?.value === '250 kW',
    'MCC shows its named 250 kW HV input');
  assert(mccOutputs?.count === 8 && mccOutputs.metrics[0]?.value === '250 kW total · 31.25 kW each',
    'MCC groups eight branch outputs without hiding total or per-port capacity');
}

{
  const dipolePower = group('dipole', 'powerCable', 'sink');
  const dipoleVacuum = group('dipole', 'vacuumPipe', 'sink');
  assert(dipolePower?.roleLabel === 'Input' && dipolePower.metrics[0]?.value === '25 kW',
    'sink ports are labeled as inputs with their declared demand');
  assert(dipoleVacuum?.metrics[0]?.value === '5.0e-7 mbar·L/s',
    'utility-specific demand units and small values remain visible');
}

{
  const bus = group('powerBus', 'powerCable', 'pass');
  assert(bus?.count === 9 && bus.metrics[0]?.value === '160 kW',
    'pass-through bus rating is not multiplied by its connector count');
}

{
  const water = group('waterTank', 'coolingWater', 'source');
  assert(water?.metrics.some(metric => metric.label === 'Water supply'
      && metric.value === '1 L/tick total · 0.166667 L/tick each'),
    'water-source ports expose make-up flow');
  assert(water?.metrics.some(metric => metric.label === 'Water storage'
      && metric.value === '500 L total · 83.333333 L each'),
    'water-source ports expose storage separately from thermal capacity');
}

{
  const chillerWater = group('chiller', 'waterSupplyPipe', 'source');
  assert(chillerWater?.metrics.some(metric => metric.label === 'Header capacity'
      && metric.value === '300 kW total')
      && chillerWater.metrics.some(metric => metric.label === 'Process return'
        && metric.value === '300 kW total'),
  'central chiller distinguishes cold-header output from hot process-return acceptance');
}

{
  const rf = group('solidStateAmp', 'rfWaveguide', 'source');
  assert(rf?.metrics[0]?.label === 'Peak capacity'
      && rf.metrics[0].value === '35 kW total · 8.75 kW each · 100% duty',
    'RF output banks retain their peak capacity and duty-cycle meaning');
}

{
  const html = componentUtilityPortSectionHtml('mcc');
  assert(html.includes('Connection ports') && html.includes('HV Feeder')
      && html.includes('Outputs ×8') && html.includes('250 kW total · 31.25 kW each'),
    'single-component info markup renders the port groups and capacities');
}

assert(componentUtilityPortGroups('flowerBed').length === 0,
  'placeables without utility connectors do not gain an empty ports section');
assert(componentUtilityPortSectionHtml('flowerBed') === '',
  'the ports section renderer stays absent when a component has no connectors');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
