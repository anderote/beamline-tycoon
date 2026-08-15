import {
  beamlineRfOperatingInfo,
  componentHoverInfo,
  furnishingHoverInfo,
  utilityNetworkHoverInfo,
} from '../src/ui/hover-info.js';
import { COMPONENTS } from '../src/data/components.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('PASS ', message); }
  else { failed++; console.error('FAIL ', message); }
}

const rf = beamlineRfOperatingInfo([
  { type: 'ecrIonSource' },
  { type: 'buncher' },
  { type: 'rfCavity' },
], COMPONENTS);
assert(rf?.bandId === 'vhf', 'beamline RF band comes from first accelerating RF element');
assert(rf?.display === 'VHF · 162.5 MHz', `beamline RF display includes band and frequency (${rf?.display})`);

const cavity = componentHoverInfo(COMPONENTS.ellipticalSrfCavity);
assert(cavity.title === COMPONENTS.ellipticalSrfCavity.name, 'component hover names the object');
assert(cavity.detail.includes('L-band') && cavity.detail.includes('1300 MHz'),
  'RF component hover shows band and frequency');

const panel = componentHoverInfo(COMPONENTS.powerPanel);
assert(panel.detail === 'Power: 40 kW consumed · 40 kW produced',
  `power distributor hover compares consumed and produced power (${panel.detail})`);

const packageChiller = componentHoverInfo(COMPONENTS.packageChiller);
assert(packageChiller.detail === 'Cooling output: 5 kW',
  `package chiller hover shows its total cooling capacity (${packageChiller.detail})`);

const network = utilityNetworkHoverInfo(UTILITY_TYPES.powerCable, {
  utilization: 0.75,
  totalDemand: 75,
  totalCapacity: 100,
});
assert(network.title === 'Power Cable Network', 'network hover names the utility');
assert(network.detail === 'Utilization: 75% · 75 / 100 kW',
  `network hover shows utilization and load (${network.detail})`);

const furnishing = furnishingHoverInfo({
  name: 'Operator Desk',
  effects: { morale: 0.1, research: 2, ignored: 0 },
});
assert(furnishing.detail === 'Morale +10% · Research +2',
  'furnishing effects stay on one detail line');

for (const info of [cavity, panel, network, furnishing]) {
  assert(info && !info.title.includes('\n') && !info.detail.includes('\n'),
    `${info?.title || 'hover'} is limited to two logical lines`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
