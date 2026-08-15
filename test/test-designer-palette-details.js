// test/test-designer-palette-details.js — the compact Designer cards expose a
// complete hover inspector rather than forcing players to place a component
// before they can see its requirements and physics.

import { COMPONENTS } from '../src/data/components.js';
import { designerPaletteDetails } from '../src/renderer/designer-renderer.js';

let passed = 0;
let failed = 0;
function assertOk(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

const buncher = designerPaletteDetails('buncher', COMPONENTS.buncher);

assertOk(buncher.name === 'Buncher', 'includes the full component name');
assertOk(buncher.description.includes('sub-harmonic'), 'includes the untruncated description');
assertOk(buncher.rows.some(row => row.label === 'Cost' && row.value === '$150,000'), 'includes formatted cost');
assertOk(buncher.rows.some(row => row.label === 'RF frequency' && row.value === '162.5 MHz'), 'includes RF frequency');
assertOk(buncher.rows.some(row => row.label === 'RF band' && row.value === 'VHF'), 'includes RF band');
assertOk(buncher.rows.some(row => row.label === 'β acceptance'
  && row.value.includes('0.20–0.75')), 'includes the component beta acceptance window');
assertOk(buncher.rows.some(row => row.label === 'Bunch Compression'), 'includes component-specific physics stats');
assertOk(buncher.utilityRows.some(row => row.label === 'Power draw'), 'includes port-derived utility demand');
assertOk(buncher.utilityRows.some(row => row.label === 'RF draw'), 'includes RF demand');
assertOk(buncher.utilityRows.some(row => row.label === 'Vacuum load' && row.value === '5.0e-7 mbar·L/s'), 'preserves tiny nonzero utility loads');
assertOk(buncher.connections.includes('Power cable') && buncher.connections.includes('RF waveguide'), 'includes readable connection requirements');
assertOk(buncher.params.some(row => row.label === 'Voltage' && row.value === '0.1 MV'), 'includes default tunable parameters and units');

console.log(`\n${passed}/${passed + failed} assertions passed`);
process.exit(failed > 0 ? 1 : 0);
