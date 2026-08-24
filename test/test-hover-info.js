import {
  beamlineRfOperatingInfo,
  componentHoverInfo,
  furnishingHoverInfo,
  staffHoverInfo,
  utilityNetworkHoverInfo,
} from '../src/ui/hover-info.js';
import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import {
  HOVER_DETAIL_TONE_CLASSES,
  renderHoverTooltipDetail,
  renderHoverTooltipTitle,
} from '../src/ui/hover-tooltip-detail.js';
import { readFileSync } from 'node:fs';

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

const tree = componentHoverInfo(PLACEABLES.oakTree);
assert(tree.detail.includes('Shift+drag: line place')
    && tree.detail.includes('Shift+Z/X: spacing'),
  'ground decoration hover explains line placement and spacing shortcuts');

const lamppost = componentHoverInfo(PLACEABLES.lamppost);
assert(lamppost.detail.includes('Shift+drag: line place'),
  'ground lamp hover explains line placement');

const wallSconce = componentHoverInfo(PLACEABLES.wallSconce);
assert(!wallSconce.detail.includes('Shift+drag: line place'),
  'wall-mounted decoration hover omits unsupported line placement');

const panel = componentHoverInfo(COMPONENTS.powerPanel);
assert(panel.detail === 'Power: 120 kW consumed · 120 kW produced',
  `power distributor hover compares consumed and produced power (${panel.detail})`);

const actionablePanel = componentHoverInfo(COMPONENTS.powerPanel, {
  autoConnectPlan: { candidates: 5, stubs: [{}, {}, {}, {}] },
});
assert(actionablePanel.detail === '5 unconnected power connections in range · Tab connects 4 · T disconnects all',
  `placed panel hover reports both nearby plugs and Tab capacity (${actionablePanel.detail})`);

const actionableHvDistributor = componentHoverInfo(COMPONENTS.compactHvDistributor, {
  autoConnectPlan: { utilityType: 'hvCable', candidates: 2, stubs: [{}] },
});
assert(actionableHvDistributor.detail === '2 unconnected HV connections in range · Tab connects 1 · T disconnects all',
  `HV distributor hover names feeder inputs (${actionableHvDistributor.detail})`);

const connectedCavity = componentHoverInfo(COMPONENTS.ellipticalSrfCavity, {
  connectedUtilityCount: 2,
});
assert(connectedCavity.detail.endsWith(' · T disconnects all'),
  'connected ordinary components advertise the hover disconnect shortcut');

const packageChiller = componentHoverInfo(COMPONENTS.packageChiller);
assert(packageChiller.detail === 'Cooling output: 5 kW',
  `package chiller hover shows its total cooling capacity (${packageChiller.detail})`);

const makeUpTank = componentHoverInfo(COMPONENTS.waterTank);
assert(makeUpTank.detail === 'Water: 1 L/tick supply · 500 L storage',
  `make-up tank hover separates supply and storage (${makeUpTank.detail})`);
const facilityWater = componentHoverInfo(COMPONENTS.facilityWaterSupply);
assert(facilityWater.title === 'Water Replenishment Plant',
  `dedicated water replenishment building has an explicit title (${facilityWater.title})`);
assert(facilityWater.detail === 'Water: 20 L/tick supply',
  `water replenishment hover claims no storage (${facilityWater.detail})`);
const bulkWater = componentHoverInfo(COMPONENTS.bulkWaterTank);
assert(bulkWater.detail === 'Water: 5,000 L storage',
  `bulk tank hover claims no generation (${bulkWater.detail})`);

const turboPump = componentHoverInfo(COMPONENTS.turboPump);
assert(turboPump.detail === 'Vacuum: high-vac 300 L/s · needs 15 L/s backing',
  `vacuum pump hover names its pressure stage and backing requirement (${turboPump.detail})`);
const vacuumCart = componentHoverInfo(COMPONENTS.vacuumCart);
assert(vacuumCart.detail === 'Vacuum: roughing 30 L/s · high-vac 300 L/s',
  `integrated vacuum cart hover exposes both pressure-stage capacities (${vacuumCart.detail})`);

const network = utilityNetworkHoverInfo(UTILITY_TYPES.powerCable, {
  utilization: 0.75,
  totalDemand: 75,
  totalCapacity: 100,
});
assert(network.title === 'Power Cable Network', 'network hover names the utility');
assert(network.detail === 'Supply: 100 kW · Demand: 75 kW',
  `network hover labels numeric supply and demand (${network.detail})`);
assert(network.detailRows.length === 2
    && network.detailRows[0][0].text === 'Supply: 100 kW'
    && network.detailRows[1][0].text === 'Demand: 75 kW',
  'network hover gives supply and demand their own rows');
assert(network.detailSegments[0].tone === 'supply'
    && network.detailSegments[2].tone === 'healthy',
  'network hover is green when supply exceeds demand');

const exactlyCoveredNetwork = utilityNetworkHoverInfo(UTILITY_TYPES.powerCable, {
  totalDemand: 100,
  totalCapacity: 100,
});
assert(exactlyCoveredNetwork.detailSegments[2].tone === 'healthy',
  'network hover remains green when supply exactly meets demand');

const warningNetwork = utilityNetworkHoverInfo(UTILITY_TYPES.powerCable, {
  totalDemand: 100,
  totalCapacity: 75,
});
assert(warningNetwork.detailSegments[2].tone === 'warning',
  'moderately underpowered demand is orange');
assert(warningNetwork.detail.includes('Issue: Connected equipment is under-served.')
    && warningNetwork.detailSegments[4].tone === 'warning',
  'under-service is explained in yellow on the line hover');

const criticalNetwork = utilityNetworkHoverInfo(UTILITY_TYPES.powerCable, {
  totalDemand: 100,
  totalCapacity: 40,
});
assert(criticalNetwork.detailSegments[2].tone === 'critical',
  'severely underpowered demand is red');

const mismatchNetwork = utilityNetworkHoverInfo(UTILITY_TYPES.rfWaveguide, {
  totalDemand: 100,
  totalCapacity: 100,
  perSinkQuality: { 'cavity:rf_in': 0 },
  errors: [{
    severity: 'soft',
    code: 'rf_frequency_mismatch',
    message: 'No RF source covering L-band (1300.0 MHz).',
  }],
});
assert(mismatchNetwork.detail.includes('Issue: No RF source covering L-band (1300.0 MHz).')
    && mismatchNetwork.detailSegments[4].tone === 'critical',
  'a band mismatch that delivers zero service is explained in red');

const hardFaultNetwork = utilityNetworkHoverInfo(UTILITY_TYPES.powerCable, {
  totalDemand: 100,
  totalCapacity: 0,
  perSinkQuality: { 'quad:pwr_in': 0 },
  errors: [{ severity: 'hard', code: 'power_starved', message: 'Power network has no capacity.' }],
});
assert(hardFaultNetwork.detail.includes('Issue: Power network has no capacity.')
    && hardFaultNetwork.detailSegments[4].tone === 'critical',
  'a hard failure puts its solver explanation in red on the line hover');

const vacuumNetwork = utilityNetworkHoverInfo(UTILITY_TYPES.vacuumPipe, {
  totalCapacity: 1722,
  totalDemand: 1e-6,
  pressure: 1.33e-8,
  vacuumStage: 'high',
  stageCapacities: {
    rough: { powered: 15 }, high: { backed: 1722 }, uhv: { powered: 600 },
  },
  volumeL: 250,
  volumeBreakdown: { beamPipeL: 80, servicePipeL: 20, componentChambersL: 150 },
  perSinkQuality: { 'source:vac_in': 0.98 },
});
assert(vacuumNetwork.detail
    === 'Pressure: 1.33e-8 mbar · High vacuum: 1,722 L/s effective · Capacity R 15 / H 1,722 / U 600 L/s · Gas load: 1.00e-6 mbar·L/s · Volume: 250 L (utility pipe 20, beamline pipe 80, beamline components 150)',
  `vacuum hover reports pressure-stage capacity, gas throughput, and volume sources (${vacuumNetwork.detail})`);
assert(vacuumNetwork.detailRows.length === 5
    && vacuumNetwork.detailRows.every(row => row.length === 1),
  'vacuum hover gives every published diagnostic its own row');
assert(!vacuumNetwork.detail.includes('Demand: 0 L/s'),
  'vacuum hover never rounds gas throughput to a dimensionally incorrect zero-L/s demand');
assert(vacuumNetwork.detailSegments[0].tone === 'warning'
    && vacuumNetwork.detailSegments[2].tone === 'supply'
    && vacuumNetwork.detailSegments[4].tone === 'supply'
    && vacuumNetwork.detailSegments[6].tone === 'warning',
  'suboptimal vacuum pressure warns without treating pumping speed as demand coverage');

function fakeDocument() {
  const textNode = text => ({ textContent: String(text) });
  return {
    createTextNode: textNode,
    createElement: () => ({
      className: '',
      textContent: '',
      children: [],
      replaceChildren(...children) {
        this.children = children;
        this.textContent = children.map(child => child.textContent).join('');
      },
    }),
  };
}

const detailElement = {
  ownerDocument: fakeDocument(),
  children: [],
  replaceChildren(...children) {
    this.children = children;
    this.textContent = children.map(child => child.textContent).join('');
  },
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
};
renderHoverTooltipDetail(detailElement, warningNetwork);
assert(detailElement.children.length === 3
    && detailElement.children.every(row => row.className === 'hover-tooltip-detail-row'),
  'utility detail renderer creates one block element per metric or issue');
assert(detailElement.children[0].children[0].className === HOVER_DETAIL_TONE_CLASSES.supply
    && detailElement.children[1].children[0].className === HOVER_DETAIL_TONE_CLASSES.warning
    && detailElement.children[2].children[0].className === HOVER_DETAIL_TONE_CLASSES.warning,
  'row-based network detail renderer preserves metric and issue colors');
assert(detailElement.attributes['aria-label'] === warningNetwork.detail,
  'row-based network detail keeps the complete plain-text summary for assistive technology');

const titleElement = {
  ownerDocument: fakeDocument(),
  children: [],
  attributes: {},
  replaceChildren(...children) {
    this.children = children;
    this.textContent = children.map(child => child.textContent).join('');
  },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
};
renderHoverTooltipTitle(titleElement, {
  title: 'Chiller',
  status: { tone: 'warning', label: 'Needs attention', detail: 'Cooling is under-served' },
});
assert(titleElement.textContent === 'Chiller'
    && titleElement.children[0].className.includes('hover-tooltip-status-warning'),
  'component hover title renders a yellow operational-status dot without changing its name');
assert(titleElement.attributes['aria-label'] === 'Chiller: Needs attention',
  'the hover status remains readable without relying on color alone');

const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert(/\.hover-tooltip:not\(\.demolish-tooltip\):not\(\.drag-cost-tooltip\)\s*\{[^}]*width:\s*240px[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s.test(styles),
  'world hover tooltips have a stable wrapping width');
assert(/\.hover-tooltip-detail-row\s*\{[^}]*display:\s*block/s.test(styles),
  'utility metric rows have an explicit block layout');

const furnishing = furnishingHoverInfo({
  name: 'Operator Desk',
  effects: { morale: 0.1, research: 2, ignored: 0 },
});
assert(furnishing.detail === 'Morale +10% · Research +2',
  'furnishing effects stay on one detail line');

const workingStaff = staffHoverInfo({
  id: 'staff_1',
  name: 'Ada Chen',
  profession: 'technician',
  job: {
    jobType: 'repair', phase: 'travel', target: { beamlineId: 'bl_1', nodeId: 'node_1' },
  },
}, { state: { staffMembers: [] } });
assert(workingStaff.title === 'Ada Chen', 'staff hover names the person');
assert(workingStaff.detail === 'Repair — travelling to the beamline',
  `staff hover reports the current job and phase (${workingStaff.detail})`);

const idleStaff = staffHoverInfo({
  id: 'staff_2',
  name: 'Sam Rivera',
  profession: 'admin',
  job: null,
  idleReason: 'Nothing to do right now.',
}, { state: { staffMembers: [] } });
assert(idleStaff.detail === 'Nothing to do right now.',
  `idle staff hover explains why they are idle (${idleStaff.detail})`);

for (const info of [
  cavity, panel, actionablePanel, actionableHvDistributor, packageChiller, makeUpTank, facilityWater,
  bulkWater, furnishing, workingStaff, idleStaff,
]) {
  assert(info && !info.title.includes('\n') && !info.detail.includes('\n'),
    `${info?.title || 'hover'} is limited to two logical lines`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
