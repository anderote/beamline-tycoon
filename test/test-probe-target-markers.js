// Mission-target annotations should read like bare terminal callouts, not UI
// pills. Exercise the public plot renderer with a recording canvas so this
// remains testable without a browser or pixel snapshots.

import { ProbePlots } from '../src/ui/probe-plots.js';

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

function renderEnergyTarget(yDomain, targetBand) {
  const events = { fillRects: [], strokeRects: [], text: [] };
  const ctx = {
    fillStyle: null,
    strokeStyle: null,
    font: null,
    textAlign: null,
    lineWidth: 1,
    clearRect() {},
    fillRect(...args) { events.fillRects.push({ args, fillStyle: this.fillStyle }); },
    strokeRect(...args) { events.strokeRects.push({ args, strokeStyle: this.strokeStyle }); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setLineDash() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fill() {},
    closePath() {},
    fillText(text, x, y) {
      events.text.push({ text: String(text), x, y, fillStyle: this.fillStyle,
        font: this.font, textAlign: this.textAlign });
    },
    measureText(text) { return { width: String(text).length * 5 }; },
  };
  const canvas = { width: 640, height: 360, getContext: () => ctx };
  const envelope = [
    { s: 0, energy: 0.004, eta_x: 0 },
    { s: 10, energy: 0.010, eta_x: 0 },
  ];
  ProbePlots.draw(canvas, 'energy-dispersion', envelope, [], 0, [0, 10], null, {
    yDomain: [yDomain, [0, 0.001]],
    targetBand,
  });
  return events;
}

console.log('\n--- In-range mission bounds ---');
{
  const baseline = renderEnergyTarget([0.001, 0.014], null);
  const rendered = renderEnergyTarget([0.001, 0.014], [0.003, 0.012]);
  const labels = rendered.text.filter(event => event.text.includes('TARGET'));
  check(labels.map(event => event.text).includes('← TARGET MIN 3.00 MeV'),
    'minimum energy uses a left-pointing terminal annotation');
  check(labels.map(event => event.text).includes('← TARGET MAX 12.0 MeV'),
    'maximum energy uses the same left-pointing terminal annotation');
  check(labels.every(event => event.fillStyle === 'rgba(255, 82, 82, 0.98)'),
    'target text uses terminal red');
  check(labels.every(event => event.font === 'bold 8px monospace'),
    'target text uses the shared terminal font');
  check(rendered.fillRects.length === baseline.fillRects.length,
    'target annotations add no filled background rectangles');
  check(rendered.strokeRects.length === baseline.strokeRects.length,
    'target annotations add no bordered background rectangles');
}

console.log('\n--- Off-scale mission range ---');
{
  const baseline = renderEnergyTarget([0.000046, 0.000054], null);
  const rendered = renderEnergyTarget([0.000046, 0.000054], [0.003, 0.012]);
  const labels = rendered.text.filter(event => event.text.includes('TARGET'));
  check(labels.some(event => event.text === '↑ TARGET 3.00 MeV–12.0 MeV'),
    'an off-scale target range keeps its directional edge arrow');
  check(labels.every(event => event.fillStyle === 'rgba(255, 82, 82, 0.98)'),
    'off-scale target text uses the same terminal red');
  check(rendered.fillRects.length === baseline.fillRects.length,
    'off-scale annotations also have no filled background');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
