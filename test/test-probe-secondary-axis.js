// Overlay designer plots share the primary distance axis but retain independent
// y-domains and right-side scales. This recording canvas pins the three-channel
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
  const events = { paths: [], text: [], fillRects: [], strokeRects: [], arcs: [] };
  const ctx = {
    fillStyle: null,
    strokeStyle: null,
    font: null,
    textAlign: null,
    lineWidth: 1,
    _path: [],
    clearRect() {},
    fillRect(...args) { events.fillRects.push({ args, fillStyle: this.fillStyle }); },
    strokeRect(...args) { events.strokeRects.push({ args, strokeStyle: this.strokeStyle }); },
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
    arc(...args) { events.arcs.push({ args, fillStyle: this.fillStyle }); },
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
    peak_current: 4, rel_beta: 0.4, beta_x: 4, beta_y: 7,
    phase_advance_x: 0.1, phase_advance_y: 0.2, rigidity_t_m: 0.012 },
  { s: 10, energy: 0.006, eta_x: 0.08, current: 20,
    sigma_x: 0.002, sigma_y: 0.003, emit_nx: 2e-6, emit_ny: 3e-6,
    peak_current: 8, rel_beta: 0.9, beta_x: 9, beta_y: 5,
    phase_advance_x: 0.8, phase_advance_y: 1.0, rigidity_t_m: 0.024 },
];

console.log('\n--- Cursor values at shared distance ---');
{
  const { canvas, events } = recordingCanvas();
  const rightInset = 66;
  const primaryDomain = [[0.002, 0.007], [0, 0.1]];
  const secondaryDomain = ProbePlots.secondaryYDomain('current-loss', envelope, null);
  ProbePlots.draw(canvas, 'energy-dispersion', envelope, [], 0, [0, 10], null, {
    yDomain: primaryDomain,
    rightInset,
  });
  ProbePlots.drawSecondary(canvas, 'current-loss', envelope, [0, 10], null, {
    yDomain: secondaryDomain,
    rightInset,
    axisOffset: 30,
  });
  const readout = ProbePlots.drawCursor(canvas, 'energy-dispersion', envelope, [0, 10], {
    cursorX: 460,
    cursorY: 180,
    yDomain: primaryDomain,
    secondaryType: 'current-loss',
    secondaryDomain,
    rightInset,
  });
  check(readout?.s === 10,
    'the cursor snaps to the nearest solver sample on the shared distance axis');
  check(readout?.rows.some(row => row.includes('Energy') && row.includes('6.00 MeV')),
    'the hover readout reports the primary energy value with units');
  check(readout?.rows.some(row => row.includes('η_x') && row.includes('0.0800 m')),
    'the hover readout reports the other primary line value');
  check(readout?.rows.some(row => row.includes('2·Current') && row.includes('20.0 mA')),
    'the hover readout includes the secondary-axis value');
  check(events.arcs.length >= 3,
    'the cursor marks each visible line at the sampled distance');
  check(events.strokeRects.length === 1
    && events.text.some(event => event.text.startsWith('s=10.0 m')),
  'the values appear in one compact distance-labelled terminal readout');

  const ghost = envelope.map(d => ({ ...d, energy: d.energy + 0.001, current: d.current + 5 }));
  const comparison = ProbePlots.drawCursor(canvas, 'energy-dispersion', envelope, [0, 10], {
    cursorX: 460,
    cursorY: 180,
    yDomain: primaryDomain,
    secondaryType: 'current-loss',
    secondaryDomain: ProbePlots.unionYDomain(
      ProbePlots.secondaryYDomain('current-loss', envelope, null),
      ProbePlots.secondaryYDomain('current-loss', ghost, null),
    )?.[0],
    ghostEnvelope: ghost,
    solidLabel: 'P',
    ghostLabel: 'C',
    rightInset,
  });
  check(comparison?.rows.some(row => row.includes('P 20.0 mA · C 25.0 mA')),
    'comparison hover values distinguish proposed and current curves');

  const threeChannel = ProbePlots.drawCursor(canvas, 'energy', envelope, [0, 10], {
    cursorX: 460,
    cursorY: 180,
    yDomain: [[0.002, 0.007]],
    overlays: [
      { type: 'current-loss', domain: secondaryDomain, seriesIndex: 2 },
      { type: 'rel-beta', domain: [0, 1], seriesIndex: 3 },
    ],
    rightInset: 72,
  });
  check(threeChannel?.rows.some(row => row.includes('2·Current'))
    && threeChannel?.rows.some(row => row.includes('3·Beam β')),
  'the hover readout reports both independently scaled overlay channels');
}

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
  check(['twiss-beta', 'phase-advance', 'rigidity']
    .every(type => ProbePlots.isDistancePlot(type)
      && ProbePlots.secondaryYDomain(type, envelope, null)),
  'Twiss beta, phase advance, and rigidity are primary and overlay distance plots');
}

console.log('\n--- Beam optics plot traces and units ---');
{
  const twiss = recordingCanvas();
  ProbePlots.draw(twiss.canvas, 'twiss-beta', envelope, [], 0, [0, 10], null);
  check(twiss.events.paths.some(event => event.strokeStyle === '#55aaff')
    && twiss.events.paths.some(event => event.strokeStyle === '#ff8a55'),
  'Twiss beta renders independent horizontal and vertical optics traces');

  const phase = recordingCanvas();
  const phaseDomain = ProbePlots.yDomainFor('phase-advance', envelope, null, [], 0);
  ProbePlots.draw(phase.canvas, 'phase-advance', envelope, [], 0, [0, 10], null,
    { yDomain: phaseDomain });
  const phaseReadout = ProbePlots.drawCursor(
    phase.canvas, 'phase-advance', envelope, [0, 10], {
      cursorX: 460, cursorY: 180, yDomain: phaseDomain,
    });
  check(phase.events.text.some(event => event.text === 'μ (deg)')
    && phaseReadout?.rows.some(row => row.includes('μ_x') && row.includes('deg')),
  'phase advance is labelled and reported in degrees rather than as ring tune');

  const rigidity = recordingCanvas();
  ProbePlots.drawSecondary(rigidity.canvas, 'rigidity', envelope, [0, 10], null, {
    yDomain: ProbePlots.secondaryYDomain('rigidity', envelope, null),
    rightInset: 36,
  });
  check(rigidity.events.text.some(event => event.text === 'Bρ (T·m)'),
    'magnetic rigidity uses the standard B-rho axis and tesla-metre units');
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
  check(events.text.some(event => event.text === 'I (mA)'
    && event.font === 'bold 9px monospace'),
  'the independent right-axis label uses the larger plot font');
  check(events.text.some(event => event.text === '2·Current'),
    'the overlaid trace receives a distinct secondary legend');
  check(events.text.some(event => event.text === '2·Current'
    && event.font === '8px monospace'),
  'the secondary legend uses the larger plot font');
  check(events.text.some(event => event.text === 's (m)'
    && event.font === '9px monospace'),
  'primary axis labels use the larger plot font');
}

console.log('\n--- Third channel styling and axis ---');
{
  const { canvas, events } = recordingCanvas();
  const betaEnvelope = envelope.map((d, index) => ({ ...d, rel_beta: 0.35 + index * 0.5 }));
  ProbePlots.draw(canvas, 'energy', betaEnvelope, [], 0, [0, 10], null, {
    yDomain: [[0.002, 0.007]],
    rightInset: 72,
  });
  ProbePlots.drawSecondary(canvas, 'current-loss', betaEnvelope, [0, 10], null, {
    yDomain: ProbePlots.secondaryYDomain('current-loss', betaEnvelope, null),
    rightInset: 72,
    axisOffset: 0,
    seriesIndex: 2,
  });
  ProbePlots.drawSecondary(canvas, 'rel-beta', betaEnvelope, [0, 10], null, {
    yDomain: ProbePlots.secondaryYDomain('rel-beta', betaEnvelope, null),
    rightInset: 72,
    axisOffset: 36,
    seriesIndex: 3,
  });
  const tertiaryTrace = events.paths.find(event => event.strokeStyle === '#5de6ff'
    && event.path.length >= 2 && event.path[0].x !== event.path[1].x);
  const tertiaryAxis = events.paths.find(event => event.strokeStyle === '#5de6ff'
    && event.path.length === 2 && event.path[0].x === event.path[1].x);
  check(!!tertiaryTrace, 'the third channel has its own cyan tactical trace');
  check(tertiaryAxis?.path[0].x > Math.max(...tertiaryTrace.path.map(point => point.x)),
    'the third channel receives a separate outer y-axis');
  check(events.text.some(event => event.text === '3·Beam β'
    && event.fillStyle === '#5de6ff'),
  'the third-channel legend is numbered and color matched');
}

console.log('\n--- Designer controls ---');
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const controller = fs.readFileSync(new URL('../src/ui/BeamlineDesigner.js', import.meta.url), 'utf8');
  const renderer = fs.readFileSync(new URL('../src/renderer/designer-renderer.js', import.meta.url), 'utf8');
  const optionRows = html.match(/class="dsgn-plot-options(?: dsgn-plot-options--single)?"/g) || [];
  const primarySelectors = html.match(/class="dsgn-plot-select"/g) || [];
  const secondarySelectors = html.match(/class="dsgn-plot-secondary-select"/g) || [];
  const tertiarySelectors = html.match(/class="dsgn-plot-tertiary-select"/g) || [];
  const scaleSelectors = html.match(/class="dsgn-plot-scale-select"/g) || [];
  const thirdPanelStart = html.indexOf('aria-label="Plot options for panel 3"');
  const thirdPanelEnd = html.indexOf('<canvas class="dsgn-plot-canvas" data-panel="2">');
  const thirdPanelControls = html.slice(thirdPanelStart, thirdPanelEnd);
  const selectorRule = styles.match(
    /\.dsgn-plot-select,\s*\.dsgn-plot-secondary-select,\s*\.dsgn-plot-tertiary-select\s*\{([^}]*)\}/
  )?.[1] || '';
  check(optionRows.length === 3
    && styles.includes('.dsgn-plot-options {')
    && !selectorRule.includes('position: absolute'),
  'each plot keeps its selectors in a dedicated control row outside the canvas');
  check(selectorRule.includes('var(--ui-font-display)')
    && styles.includes('.dsgn-range-btn {')
    && styles.match(/\.dsgn-range-btn\s*\{[^}]*var\(--ui-font-display\)/s),
  'plot selectors and range buttons use the Beamline Tycoon display typeface');
  check(secondarySelectors.length === 2 && tertiarySelectors.length === 2,
    'both distance panels expose second and third channel dropdowns');
  check(primarySelectors.length === 3,
    'all three panels expose a primary plot dropdown');
  check(scaleSelectors.length === 3
    && !html.includes('id="dsgn-y-scale-select"')
    && html.includes('aria-label="Y-axis scale for plot 1"')
    && html.includes('aria-label="Y-axis scale for plot 3"'),
  'each plot exposes its own accessible Lin/Log selector instead of one global control');
  check(html.includes('<option value="energy" selected>Energy</option>')
    && html.includes('<option value="current-loss" selected>Beam Current</option>')
    && html.includes('<option value="rel-beta" selected>Beam &beta;</option>'),
  'the left panel defaults to Energy, Current, and Beam beta');
  check(html.includes('<option value="beam-envelope" selected>Beam Envelope</option>')
    && html.includes('<option value="emittance" selected>Emittance</option>'),
  'the middle panel defaults to Envelope, Emittance, and Current');
  check(thirdPanelControls.includes('data-panel="2"')
    && thirdPanelControls.includes('<option value="eic-triangle" selected>')
    && thirdPanelControls.includes('<option value="energy">Energy</option>')
    && thirdPanelControls.includes('<option value="phase-space">Phase Space</option>')
    && !thirdPanelControls.includes('disabled'),
  'the right panel defaults to the radar but offers the full primary plot catalogue');
  check(html.includes('Secondary plot for panel 1')
    && html.includes('Third plot for panel 2'),
  'overlay selectors have channel- and panel-specific accessible labels');
  check(html.includes('<option value="twiss-beta">Twiss &beta;x / &beta;y</option>')
    && html.includes('<option value="phase-advance">Phase Advance &mu;x / &mu;y</option>')
    && html.includes('<option value="rigidity">Magnetic Rigidity</option>'),
  'all three new optics quantities appear in the designer plot catalogue');
  check(controller.includes("canvas.addEventListener('mousemove'")
    && controller.includes("canvas.addEventListener('mouseleave'"),
  'designer canvases track and clear pointer positions for hover readouts');
  check(controller.includes('.dsgn-plot-tertiary-select'),
    'third-channel selectors trigger a plot redraw');
  check(controller.includes("document.querySelectorAll('.dsgn-plot-scale-select')")
    && controller.includes('this.plotYAxisModes[panelIndex]')
    && renderer.includes('this.plotYAxisModes?.[panelIndex]'),
  'plot scale changes are stored and rendered by panel index');
  check(renderer.includes('ProbePlots.drawCursor(off, plotType, solid, xRange')
    && renderer.includes('overlays: overlays.map'),
  'the renderer composes the cursor readout after all active channels');
  check(renderer.includes('const rect = canvas.getBoundingClientRect()')
    && renderer.includes("panel.classList.toggle('dsgn-plot-panel--radar', plotType === 'eic-triangle')"),
  'plot sizing excludes the control row and radar styling follows the selected plot');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
