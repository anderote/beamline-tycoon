import {
  applyDesignerPlotYRange,
  createDesignerPlotYRanges,
  designerPlotPrimaryAxis,
  formatDesignerPlotBound,
  suggestDesignerFixedYRange,
  validateDesignerFixedYRange,
} from '../src/ui/designer-plot-controls.js';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

console.log('\n--- Per-panel Designer Y ranges ---');
{
  const ranges = createDesignerPlotYRanges();
  ranges[0].mode = 'fixed';
  check(ranges.length === 3 && ranges[1].mode === 'auto',
    'each plot panel starts in Auto Scale mode');
  check(ranges[0] !== ranges[1],
    'plot panels do not share mutable range settings');

  const auto = [[1, 9], [-0.2, 0.4]];
  const applied = applyDesignerPlotYRange(auto, { mode: 'fixed', min: 2, max: 5 });
  check(applied[0][0] === 2 && applied[0][1] === 5,
    'Fixed mode replaces the primary Y domain');
  check(applied[1][0] === -0.2 && applied[1][1] === 0.4,
    'secondary channels retain their independent autoscale');
  check(auto[0][0] === 1 && auto[0][1] === 9,
    'applying a fixed range does not mutate the solver-published auto domain');

  const unchanged = applyDesignerPlotYRange(auto, { mode: 'fixed', min: 8, max: 3 });
  check(unchanged[0][0] === 1 && unchanged[0][1] === 9,
    'invalid fixed bounds safely fall back to Auto Scale');
}

console.log('\n--- Fixed range validation and display units ---');
{
  check(validateDesignerFixedYRange({ min: 0, max: 10 }).valid,
    'linear ranges accept zero');
  check(!validateDesignerFixedYRange({ min: 0, max: 10 }, 'log').valid,
    'logarithmic fixed ranges reject non-positive bounds');
  check(!validateDesignerFixedYRange({ min: 10, max: 10 }).valid,
    'fixed ranges require max to exceed min');

  const logSeed = suggestDesignerFixedYRange([-2, 8], 'log');
  check(logSeed.min > 0 && logSeed.max > logSeed.min,
    'switching to Fixed on a log plot seeds a valid positive range');

  const mev = designerPlotPrimaryAxis('energy', [0.002, 0.008]);
  check(mev.scale === 1000 && mev.unit === 'MeV',
    'energy bounds use the same smart units as the visible primary axis');
  check(formatDesignerPlotBound(0.0035, mev.scale) === '3.5',
    'solver energy values are formatted in the visible axis unit for editing');

  const power = designerPlotPrimaryAxis('beam-power', [0.02, 0.12]);
  check(power.scale === 1000 && power.unit === 'kW',
    'beam power bounds use the same smart units as the visible primary axis');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
