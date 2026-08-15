import { BEAMLINE_TYPES, beamlineTypesFor } from '../src/data/beamline-types.js';
import { COMPONENTS } from '../src/data/components.js';
import { getStockDesign } from '../src/data/stock-designs.js';
import { RESEARCH } from '../src/data/research.js';
import { guidedEndpointSuggestions } from '../src/beamline/guided-setup-plan.js';
import { computeEndpointService } from '../src/game/endpoint-economy.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

console.log('\n=== Early proton revenue path ===\n');

const research = ['protonAcceleration'];
const type = BEAMLINE_TYPES.isotopeIrradiation;
const endpoint = COMPONENTS.radiationEffectsStation;
const starter = getStockDesign('isotope-cyclone30');
const lastComponent = starter?.components?.at(-1)?.type;

assert(beamlineTypesFor().includes(type),
  'the irradiation mission is selectable before proton hardware is researched');
assert(endpoint?.requires === 'protonAcceleration',
  'electronics irradiation hardware still unlocks through proton acceleration');
assert(RESEARCH.protonAcceleration.unlocks.includes('radiationEffectsStation'),
  'the research node advertises the station in its unlock list');
assert(guidedEndpointSuggestions(type.id, comp => research.includes(comp.requires))[0]
  === 'radiationEffectsStation',
  'guided setup recommends the paid electronics station first');
assert(lastComponent === 'radiationEffectsStation',
  'the entry 30 MeV proton design terminates at the paid station');

const service = computeEndpointService(type.id, {
  beamEnergy: 0.030,
  beamCurrent: 0.296,
  beamQuality: 1,
  uptimeFraction: 1,
}, starter.components);
assert(service.contractName === 'Electronics radiation testing',
  'the station attaches the electronics-testing contract');
assert(service.revenue > 0,
  `an in-band starter beam earns endpoint revenue ($${service.revenue.toFixed(2)}/tick)`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
