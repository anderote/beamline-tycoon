import {
  addDesignerPlotTag,
  applyDesignerPlotYRange,
  clearDesignerPlotTags,
  createDesignerPlotYRanges,
  DESIGNER_PLOT_TAG_LIMIT,
  designerPlotCursorLayers,
  designerPlotPrimaryAxis,
  designerPlotTagCount,
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

console.log('\n--- Persistent plot tags and live hover ---');
{
  const tagsByPanel = new Map();
  const first = addDesignerPlotTag(tagsByPanel, '0', { x: 0.2, y: 0.3 });
  const second = addDesignerPlotTag(tagsByPanel, '0', { x: 0.7, y: 0.6 });
  addDesignerPlotTag(tagsByPanel, '1', { x: 0.4, y: 0.5 });
  check(tagsByPanel.get('0').length === DESIGNER_PLOT_TAG_LIMIT
    && tagsByPanel.get('1').length === 1,
  'each plot independently retains up to two clicked tags');
  check(first.slot === 0 && second.slot === 1 && designerPlotTagCount(tagsByPanel) === 3,
    'tags receive stable A/B slots and the global control counts every panel');

  const retainedSecond = tagsByPanel.get('0')[1];
  const replacement = addDesignerPlotTag(tagsByPanel, '0', { x: 0.9, y: 0.8 });
  check(tagsByPanel.get('0').length === 2
    && tagsByPanel.get('0')[0] === retainedSecond
    && replacement.slot === first.slot,
  'a third click replaces only the oldest tag and reuses its comparison slot');

  const hover = { x: 0.55, y: 0.45 };
  const layers = designerPlotCursorLayers(tagsByPanel.get('0'), hover);
  check(layers.length === 3
    && layers[0].kind === 'hover'
    && layers.slice(1).every(layer => layer.kind === 'tag'),
  'live hover and both persistent tags are composed together');
  check(layers[1].cursor.slot === 0 && layers[2].cursor.slot === 1,
    'persistent A/B tags draw after hover in stable slot order');

  check(clearDesignerPlotTags(tagsByPanel, '0')
    && !tagsByPanel.has('0')
    && tagsByPanel.get('1').length === 1
    && designerPlotTagCount(tagsByPanel) === 1,
  'clearing one plot removes only that panel\'s persistent tags');
  check(!clearDesignerPlotTags(tagsByPanel, '0'),
    'clearing an already-empty plot is a no-op');
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

  const bunch = designerPlotPrimaryAxis('bunch-evolution', [0.25e-12, 1e-12]);
  check(bunch.scale === 1e12 && bunch.unit === 'ps',
    'bunch-duration bounds use the same smart units as the visible primary axis');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
