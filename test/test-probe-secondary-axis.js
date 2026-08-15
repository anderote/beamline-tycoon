// Secondary designer plots share the primary distance axis but retain an
// independent y-domain and right-side scale. This recording canvas pins the
// composition contract without requiring browser rendering.

import fs from 'node:fs';
import { ProbePlots } from '../src/ui/probe-plots.js';

let passed = 0;
let failed = 0;
function check(condition, message, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}${detail ? ` (${detail})` : ''}`);
  }
}

function recordingCanvas() {
  const events = { paths: [], text: [] };
  const ctx = {
    fillStyle: null,
    strokeStyle: null,
    font: null,
    textAlign: null,
    lineWidth: 1,
    _path: [],
    clearRect() {},
    fillRect() {},
    beginPath() { this._path = []; },
    moveTo(x, y) { this._path.push({ op: 'move', x, y }); },
    lineTo(x, y) { this._path.push({ op: 'line', x, y }); },
    stroke() {
      events.paths.push({ strokeStyle: this.strokeStyle,
        path: this._path.map(point => ({ ...point })) });
    },
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
  return {
    canvas: { width: 640, height: 360, getContext: () => ctx },
    events,
  };
}

const envelope = [
  { s: 0, energy: 0.003, eta_x: 0.02, current: 10,
    sigma_x: 0.001, sigma_y: 0.002, emit_nx: 1e-6, emit_ny: 2e-6,
    peak_current: 4 },
  { s: 10, energy: 0.006, eta_x: 0.08, current: 20,
    sigma_x: 0.002, sigma_y: 0.003, emit_nx: 2e-6, emit_ny: 3e-6,
    peak_current: 8 },
];

console.log('\n--- Secondary metric catalogue ---');
{
  check(ProbePlots.isDistancePlot('energy-dispersion'),
    'an along-beamline plot accepts a secondary metric');
  check(!ProbePlots.isDistancePlot('phase-space')
    && !ProbePlots.isDistancePlot('eic-triangle'),
  'point and triangle plots reject distance overlays');
  const currentDomain = ProbePlots.secondaryYDomain('current-loss', envelope, null);
  check(currentDomain?.[0] < 10 && currentDomain?.[1] > 20,
    'the secondary current axis has its own padded y-domain', JSON.stringify(currentDomain));
  check(ProbePlots.secondaryYDomain('phase-space', envelope, null) === null,
    'unsupported point plots expose no secondary y-domain');
}

console.log('\n--- Shared distance pixels, independent right axis ---');
{
  const { canvas, events } = recordingCanvas();
  const rightInset = 66; // energy/dispersion axis + outer secondary axis
  const secondaryDomain = ProbePlots.unionYDomain(
    ProbePlots.secondaryYDomain('current-loss', envelope, null),
    ProbePlots.secondaryYDomain('current-loss', envelope.map(d => ({ ...d, current: d.current + 5 })), null),
  )?.[0];
  ProbePlots.draw(canvas, 'energy-dispersion', envelope, [], 0, [0, 10], null, {
    yDomain: [[0.002, 0.007], [0, 0.1]],
    rightInset,
  });
  ProbePlots.drawSecondary(canvas, 'current-loss', envelope, [0, 10], null, {
    yDomain: secondaryDomain,
    rightInset,
    axisOffset: 30,
  });

  const primary = events.paths.find(event => event.strokeStyle === '#44dd88'
    && event.path.length >= 2);
  const secondary = events.paths.find(event => event.strokeStyle === '#ff5ec4'
    && event.path.length >= 2 && event.path[0].x !== event.path[1].x);
  const primaryXs = primary?.path.map(point => point.x);
  const secondaryXs = secondary?.path.map(point => point.x);
  check(JSON.stringify(primaryXs) === JSON.stringify(secondaryXs),
    'primary and secondary traces map distance to identical x pixels',
    `${JSON.stringify(primaryXs)} vs ${JSON.stringify(secondaryXs)}`);
  check(secondaryDomain?.[0] < 10 && secondaryDomain?.[1] > 25,
    'comparison mode unions both secondary y-domains before drawing');

  const outerAxis = events.paths.find(event => event.strokeStyle === '#ff5ec4'
    && event.path.length === 2 && event.path[0].x === event.path[1].x);
  check(outerAxis?.path[0].x > Math.max(...secondaryXs),
    'the secondary y-axis is drawn to the right of the shared plot area');
  check(events.text.some(event => event.text === 'I (mA)'
    && event.fillStyle === '#ff5ec4'),
  'the independent right axis is labelled in the secondary trace colour');
  check(events.text.some(event => event.text === '2·Current'),
    'the overlaid trace receives a distinct secondary legend');
}

console.log('\n--- Designer controls ---');
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const selectors = html.match(/class="dsgn-plot-secondary-select"/g) || [];
  check(selectors.length === 3, 'each plot panel has a second dropdown');
  check((html.match(/\+ Add second plot/g) || []).length === 3,
    'each secondary dropdown defaults to no overlay');
  check(html.includes('Secondary plot for panel 1')
    && html.includes('Secondary plot for panel 3'),
  'secondary selectors have panel-specific accessible labels');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
