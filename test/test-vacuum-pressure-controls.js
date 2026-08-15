import { bindVacuumPressureRangeControls } from '../src/ui/vacuum-pressure-controls.js';
import { VACUUM_TICKS_PER_DAY } from '../src/utility/types/vacuumPipe.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function button(rangeTicks) {
  return {
    dataset: { vacuumRangeTicks: String(rangeTicks) },
    addEventListener(event, listener) {
      if (event === 'click') this.click = listener;
    },
  };
}

console.log('\n--- Vacuum pressure range controls ---');
{
  const oneDay = button(VACUUM_TICKS_PER_DAY);
  const tenDays = button(VACUUM_TICKS_PER_DAY * 10);
  const invalid = button(999);
  const root = { querySelectorAll: () => [oneDay, tenDays, invalid] };
  const selected = [];

  bindVacuumPressureRangeControls(root, rangeTicks => selected.push(rangeTicks));
  oneDay.click();
  tenDays.click();
  invalid.click();

  assert(selected.join(',') === `${VACUUM_TICKS_PER_DAY},${VACUUM_TICKS_PER_DAY * 10}`,
    'range controls publish valid selections and reject unknown spans');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
