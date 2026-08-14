// test/test-designer-focus-advisor.js — the FODO advisor has to propose a
// LATTICE, not a single arrow.
//
// _computeGhostQuads armed on the rising edge of focus_urgency: it latched
// inUrgentRegion at >= 0.7 and only re-armed once urgency fell back under 0.56.
// On an unfocused line urgency ramps monotonically to 1.0 and stays pinned
// there, so the region never closed and the advisor emitted exactly ONE ghost
// no matter how long the drift — a 40 m run needing six quads got one arrow.
// Worse, a candidate suppressed by a nearby existing quad hit `continue` AFTER
// latching the flag, so one real quad could blank every suggestion downstream
// of it.
//
// Coverage:
//   1. a long unfocused run proposes a whole FODO string, spaced about a
//      half-cell apart, with alternating F/D polarity.
//   2. suggestions stop where focusing already exists, and resume after it —
//      one existing quad does not silence the rest of the line.
//   3. the count is capped so a very long machine cannot wallpaper the
//      schematic with arrows.
//   4. a well-focused line proposes nothing.
//   5. every ghost carries a nodeIndex that indexes draftNodes.

import { BeamlineDesigner } from '../src/ui/BeamlineDesigner.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// A designer without the constructor's DOM/game wiring: these tests exercise
// the advisor's pure detection logic against a supplied envelope.
function makeDesigner(nodes, envelope) {
  const d = Object.create(BeamlineDesigner.prototype);
  d.draftNodes = nodes;
  d.draftEnvelope = envelope;
  d.ghostQuads = [];
  d.selectedIndex = -1;
  d.markerS = 0;
  d._updateTotalLength();
  // _recalcDraft resyncs totalLength to the envelope before computing ghosts.
  const maxS = envelope[envelope.length - 1].s;
  if (maxS > 0) d.totalLength = maxS;
  d._computeGhostQuads();
  return d;
}

// The physics engine's urgency profile, reproduced: urgency tracks distance
// since the last focusing element and saturates at 1.0 after ~20 m.
function buildEnvelope(totalS, focusSPositions, n = 1000) {
  const env = [];
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * totalS;
    let lastFocus = 0;
    for (const q of focusSPositions) if (q <= s) lastFocus = q;
    env.push({ s, energy: 1.0, focus_urgency: Math.min(1, (s - lastFocus) / 20) });
  }
  return env;
}

const drifts = (n) => Array.from({ length: n }, () => ({ type: 'drift', subL: 4 }));

console.log('1. a long unfocused run proposes a FODO string');
{
  // 21 nodes: a source then 20 x 2 m drifts = 40 m with no focusing anywhere.
  const d = makeDesigner([{ type: 'source' }, ...drifts(20)], buildEnvelope(40, []));
  const n = d.ghostQuads.length;
  check('proposes more than one quad', n > 1, `got ${n}`);

  const pols = d.ghostQuads.map(g => g.polarity);
  let alternates = true;
  for (let i = 1; i < pols.length; i++) if (pols[i] === pols[i - 1]) alternates = false;
  check('polarity alternates F/D', alternates, `polarities: ${pols.join(',')}`);

  const ss = d.ghostQuads.map(g => g.s);
  let ascending = true;
  for (let i = 1; i < ss.length; i++) if (ss[i] <= ss[i - 1]) ascending = false;
  check('positions strictly ascending', ascending, `s: ${ss.map(v => v.toFixed(1)).join(',')}`);
  check('positions stay inside the beamline', ss.every(s => s >= 0 && s <= d.totalLength),
    `s: ${ss.map(v => v.toFixed(1)).join(',')} totalLength=${d.totalLength}`);

  // Spacing should be regular — a lattice, not a clump — and should match the
  // model the advisor reads. lattice.py's drift_urgency is
  // drift_since_focus / 20, so urgency crosses the 0.7 threshold after 14 m
  // unfocused. A string spaced wider than that leaves the run urgent even
  // after you build every arrow; one spaced far tighter proposes hardware the
  // beam does not need.
  if (ss.length > 2) {
    const gaps = ss.slice(1).map((s, i) => s - ss[i]);
    const spread = Math.max(...gaps) / Math.max(Math.min(...gaps), 1e-9);
    check('spacing is regular (max gap within 2x min gap)', spread <= 2.0,
      `gaps: ${gaps.map(g => g.toFixed(2)).join(',')}`);
    check('spacing is tight enough to hold urgency under threshold',
      Math.max(...gaps) <= 14.0, `max gap ${Math.max(...gaps).toFixed(2)} m`);
    check('spacing is not gratuitously dense',
      Math.min(...gaps) >= 3.0, `min gap ${Math.min(...gaps).toFixed(2)} m`);
  }
}

console.log('2. existing focusing suppresses locally, not globally');
{
  // A quad at s = 15 in the middle of a 57 m line. The stretch after it still
  // diverges and must still be advised.
  const nodes = [{ type: 'source' }, ...drifts(7), { type: 'quadrupole' }, ...drifts(20)];
  const d = makeDesigner(nodes, buildEnvelope(57, [15]));
  check('still advises past an existing quad', d.ghostQuads.length > 1,
    `got ${d.ghostQuads.length}`);
  check('advises somewhere downstream of the existing quad',
    d.ghostQuads.some(g => g.s > 15),
    `s: ${d.ghostQuads.map(g => g.s.toFixed(1)).join(',')}`);
  check('does not stack a suggestion on top of the existing quad',
    !d.ghostQuads.some(g => Math.abs(g.s - 15) < 1.0),
    `s: ${d.ghostQuads.map(g => g.s.toFixed(1)).join(',')}`);
}

console.log('3. the suggestion count is capped');
{
  const d = makeDesigner([{ type: 'source' }, ...drifts(400)], buildEnvelope(800, []));
  check('caps the arrow count on a very long machine',
    d.ghostQuads.length > 0 && d.ghostQuads.length <= 12,
    `got ${d.ghostQuads.length} on an 800 m unfocused line`);
}

console.log('4. a well-focused line proposes nothing');
{
  // Focusing every 5 m keeps urgency at 0.25 — nowhere near the threshold.
  const focusEvery5 = Array.from({ length: 8 }, (_, i) => (i + 1) * 5);
  const d = makeDesigner([{ type: 'source' }, ...drifts(20)], buildEnvelope(40, focusEvery5));
  check('no suggestions when the beam is already focused', d.ghostQuads.length === 0,
    `got ${d.ghostQuads.length}`);
}

console.log('5. ghosts carry a usable nodeIndex');
{
  const nodes = [{ type: 'source' }, ...drifts(20)];
  const d = makeDesigner(nodes, buildEnvelope(40, []));
  check('every nodeIndex indexes draftNodes',
    d.ghostQuads.every(g => Number.isInteger(g.nodeIndex) &&
      g.nodeIndex >= 0 && g.nodeIndex < nodes.length),
    `indices: ${d.ghostQuads.map(g => g.nodeIndex).join(',')}`);
}

console.log('6. the readout walks the marker through every suggestion');
{
  const d = makeDesigner([{ type: 'source' }, ...drifts(20)], buildEnvelope(40, []));
  d._updateSelectionFromMarker = () => {};
  d._centerViewOnMarker = () => {};   // needs a laid-out canvas
  d._renderAll = () => {};
  d._advisorCursor = -1;

  const visited = [];
  for (let i = 0; i < d.ghostQuads.length; i++) {
    d._jumpToNextGhost();
    visited.push(d.markerS);
  }
  check('one click per suggestion reaches all of them',
    visited.length === d.ghostQuads.length &&
    visited.every((s, i) => s === d.ghostQuads[i].s),
    `visited ${visited.map(v => v.toFixed(1)).join(',')}`);

  d._jumpToNextGhost();
  check('wraps back to the first suggestion', d.markerS === d.ghostQuads[0].s,
    `landed on ${d.markerS}`);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
