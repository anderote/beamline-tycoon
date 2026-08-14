// test/test-designer-marker-mapping.js — the stackup marker must land under the
// cursor that placed it.
//
// Clicking the stackup runs _placeMarkerAtClickX: pixel x -> fractional
// position within a component region -> physical s, using _compPhysLengths().
// Drawing the marker runs the inverse: s -> pixel x. The two are only inverses
// of each other if they agree on how long each component is in metres.
//
// They did not. _compPhysLengths() (and totalLength, and _panToFollowMarker)
// read a drift's real length off the NODE via _nodeSubL, honouring a trimmed or
// spliced drift's own subL. The marker-drawing loop in designer-renderer.js
// recomputed the same quantity from COMPONENTS[type].subL — the catalogue
// DEFAULT — so any beamline containing a drift whose subL differs from 4 drew
// the marker somewhere other than where it was clicked, with the error growing
// downstream of the mismatched drift.
//
// Coverage:
//   1. round trip: click x -> s -> x is the identity, for a stackup with
//      non-default drift lengths.
//   2. the s -> x map agrees with the component regions at every boundary
//      (component i's left edge is at cumulative length of 0..i-1).
//   3. the default-subL case still round-trips (no regression for the
//      configuration that always worked).

import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';
import { COMPONENTS } from '../src/data/components.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// A designer instance without the constructor's DOM/game wiring: this test only
// exercises the pure length/pixel mapping methods.
function makeDesigner(nodes) {
  const d = Object.create(BeamlineDesigner.prototype);
  d.draftNodes = nodes;
  d.selectedIndex = -1;
  d.markerS = 0;
  d._updateSelectionFromMarker = () => {};
  d._updateTotalLength();
  return d;
}

// Rebuild the regions the schematic renderer stores for click detection.
const LEFT_MARGIN = 20;
function buildRegions(d, zoom, panPx) {
  const regions = [];
  let x = LEFT_MARGIN + panPx;
  for (let i = 0; i < d.draftNodes.length; i++) {
    const n = d.draftNodes[i];
    const subL = (typeof n.subL === 'number' && n.subL > 0)
      ? n.subL
      : ((COMPONENTS[n.type] || {}).subL || 4);
    const w = d._compPixelWidth(n.type, subL) * zoom;
    regions.push({ x, y: 0, w, h: 30, index: i });
    x += w;
  }
  return regions;
}

function runRoundTrip(label, nodes, zoom, panPx) {
  const d = makeDesigner(nodes);
  d._compRegions = buildRegions(d, zoom, panPx);

  const first = d._compRegions[0];
  const last = d._compRegions[d._compRegions.length - 1];
  const spanStart = first.x;
  const spanEnd = last.x + last.w;

  let worst = 0;
  let worstAt = null;
  for (let k = 0; k <= 40; k++) {
    // Stay strictly inside the span: the endpoints are the "clicked outside"
    // snap-to-edge path, which is deliberately not a round trip.
    const clickX = spanStart + ((k + 0.5) / 41) * (spanEnd - spanStart);
    d._placeMarkerAtClickX(clickX);
    const drawnX = LEFT_MARGIN + panPx + d._sToPixelOffset(d.markerS, zoom);
    const err = Math.abs(drawnX - clickX);
    if (err > worst) { worst = err; worstAt = { clickX, drawnX, s: d.markerS }; }
  }
  check(
    `${label}: click -> s -> pixel round trips`,
    worst < 1e-6,
    worstAt && `worst error ${worst.toFixed(3)}px (clicked ${worstAt.clickX.toFixed(2)}, ` +
      `marker s=${worstAt.s.toFixed(3)} drew at ${worstAt.drawnX.toFixed(2)})`,
  );
}

console.log('1. round trip with non-default drift lengths');
// Drifts trimmed/spliced away from the catalogue default of subL = 4.
const mixed = [
  { type: 'source' },
  { type: 'drift', subL: 1 },
  { type: 'quadrupole' },
  { type: 'drift', subL: 12 },
  { type: 'pillboxCavity' },
  { type: 'drift', subL: 2 },
  { type: 'quadrupole' },
];
runRoundTrip('mixed drift lengths', mixed, 1.7, -35);

console.log('2. component boundaries line up with the regions');
{
  const zoom = 1.3, panPx = 0;
  const d = makeDesigner(mixed.map(n => ({ ...n })));
  const regions = buildRegions(d, zoom, panPx);
  const lengths = d._compPhysLengths();
  let cumS = 0;
  let allOk = true;
  let detail = '';
  for (let i = 0; i < regions.length; i++) {
    const x = LEFT_MARGIN + panPx + d._sToPixelOffset(cumS, zoom);
    if (!near(x, regions[i].x, 1e-6)) {
      allOk = false;
      detail = `component ${i} left edge: map says ${x.toFixed(3)}, region says ${regions[i].x.toFixed(3)}`;
      break;
    }
    cumS += lengths[i];
  }
  check('every component left edge maps to its region x', allOk, detail);
  check('lengths sum to totalLength',
    near(lengths.reduce((a, b) => a + b, 0), d.totalLength, 1e-9),
    `sum=${lengths.reduce((a, b) => a + b, 0)} totalLength=${d.totalLength}`);
}

console.log('3. default drift lengths still round trip');
runRoundTrip('all-default lengths', [
  { type: 'source' },
  { type: 'drift' },
  { type: 'quadrupole' },
  { type: 'drift' },
  { type: 'quadrupole' },
], 1.0, 0);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
