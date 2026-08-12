// test/test-design-layout.js — tests for src/beamline/design-layout.js.
//
// layoutDesign() is the single sequencing rule that DesignPlacer's quote walk
// (_recompute) and its placement walk (confirm) both consume, so a divergence
// here is a divergence between the price the player is shown and the beamline
// they get. It is also the only way a validation harness can know what a saved
// design expands to without a renderer.
//
// The bare `import` below is half the test: this module must stay loadable
// from plain node. If anything it pulls in ever reaches for `document` or
// THREE, this file fails at import time rather than in the browser.
//
// Scenarios:
//   1. Modules only → module/pipe/module alternation, no attachments.
//   2. Attachments between modules land on the pipe that follows them.
//   3. Attachments before the first module are discarded as leading.
//   4. Attachments after the last module are discarded as trailing, and a
//      design with no modules at all is entirely trailing.
//   5. Packed position maths for 1, 2 and 3 attachments on one pipe.
//   6. Unknown component types vanish, exactly as both original walks did.
//   7. Pipes are sized to their contents, and `role` is the discriminator.
//
// Tests 5 and 7 were rewritten when two real bugs were fixed here (see the
// module header of design-layout.js):
//
//   * The walk used to split on `comp.placement === 'attachment'`. The
//     authoritative rule — the one BeamlineInputController hand-builds with —
//     is `comp.role`, and the two disagree on every RF cavity. `rfCavity`,
//     which this file used as its "wide module" fixture, is
//     `placement: 'module'` but `role: 'placement'`: it is a PIPE PLACEMENT,
//     and the fixture had to be swapped for a real junction of the same size.
//   * A pipe used to be hard-coded to one tile (4 sub-units) whatever was
//     mounted on it, and attachments were spaced (i+1)/(n+1) with no regard
//     for their own length, so anything that did not fit overlapped and was
//     silently dropped. Pipes are now sized to their contents and positions
//     are packed end to end, which is what test 5's numbers changed to.

import { layoutDesign } from '../src/beamline/design-layout.js';
import { COMPONENTS } from '../src/data/components.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Real registry ids, so the test breaks if `role` ever flips underneath it
// rather than silently testing a fiction.
//
// MODULE is deliberately a role-UNDEFINED component and MODULE_B a
// role-'junction' one: "not a pipe placement" is the rule, and both of those
// have to land on the module path (see design-layout.js for why role
// `undefined` is not treated as mountable hardware).
const MODULE = 'drift';          // role undefined, subL 4, subW 2 → 1x1 tiles
const MODULE_B = 'dipole';       // role junction,  subL 2, subW 2 → 1x1 tiles
const MODULE_WIDE = 'ecrIonSource'; // role junction, subL 6, subW 4 → 2x1 tiles
const ATT = 'bpm';               // subL 1 — a quarter of a one-tile pipe
const ATT_B = 'quadrupole';      // subL 2 — half a one-tile pipe
const ATT_C = 'bellows';         // subL 2

function design(...types) {
  return { name: 'test', components: types.map(t => ({ type: t, params: { tag: t } })) };
}
const kinds = layout => layout.sequence.map(s => s.kind);
const types = layout => layout.sequence.map(s => s.type);

// ==========================================================================
// Fixture sanity: the ids above must still be what this file assumes.
// ==========================================================================
console.log('\n--- Test 0: registry fixtures ---');
{
  for (const t of [MODULE, MODULE_B, MODULE_WIDE]) {
    assert(COMPONENTS[t] && COMPONENTS[t].role !== 'placement', `${t} is still a module`);
  }
  for (const t of [ATT, ATT_B, ATT_C]) {
    assert(COMPONENTS[t]?.role === 'placement', `${t} is still a pipe placement`);
  }
  assert(COMPONENTS[MODULE]?.role === undefined,
    `${MODULE} still has no role at all — the "everything else is a module" case`);
  assert(COMPONENTS[MODULE_B]?.role === 'junction' && COMPONENTS[MODULE_WIDE]?.role === 'junction',
    'the other two module fixtures are real junctions');
  // The lengths test 5 and test 7 do arithmetic with.
  assert(COMPONENTS[ATT]?.subL === 1 && COMPONENTS[ATT_B]?.subL === 2
    && COMPONENTS[ATT_C]?.subL === 2, 'attachment fixtures are 1 / 2 / 2 sub-units');
  // `placement` and `role` are DIFFERENT axes, and the whole point of the
  // discriminator fix. If these ever agree the fixtures below stop proving
  // anything, because either field would produce the same answer.
  assert(COMPONENTS.rfCavity?.placement === 'module'
    && COMPONENTS.rfCavity?.role === 'placement',
    'rfCavity is a catalogue "module" but a beamline PLACEMENT — the two axes still disagree');
}

// ==========================================================================
// Test 1: modules only.
// ==========================================================================
console.log('\n--- Test 1: modules only ---');
{
  const layout = layoutDesign(design(MODULE, MODULE_B, MODULE_WIDE));

  assert(kinds(layout).join(',') === 'module,pipe,module,pipe,module',
    `pipes sit between modules and nowhere else (got ${kinds(layout).join(',')})`);
  assert(types(layout).join(',') === `${MODULE},,${MODULE_B},,${MODULE_WIDE}`,
    'modules keep their order and pipes carry no registry type');
  assert(layout.sequence.every(s => s.kind !== 'pipe' || s.attachments.length === 0),
    'no attachments materialise from nowhere');
  assert(layout.discardedLeading.length === 0 && layout.discardedTrailing.length === 0,
    'nothing discarded');

  // trackLen/trackW are what DesignPlacer lays the footprint and the cursor
  // advance out with, so they belong to the shared walk, not to the caller.
  const [m1, , m2, , m3] = layout.sequence;
  assert(m1.trackLen === 1 && m1.trackW === 1, `${MODULE} is 1x1 tiles`);
  assert(m2.trackLen === 1 && m2.trackW === 1, `${MODULE_B} is 1x1 tiles`);
  assert(m3.trackLen === 2 && m3.trackW === 1, `${MODULE_WIDE} (subL 6, subW 4) is 2x1 tiles`);
  assert(m1.params?.tag === MODULE, 'module params are carried through verbatim');

  // A pipe with nothing on it is still one tile — the minimum gap DesignPlacer
  // leaves between modules — which is what the quote prices. Pipes only grow
  // when there is hardware to carry (test 7).
  assert(layout.sequence.filter(s => s.kind === 'pipe').every(p => p.tiles === 1 && p.subL === 4),
    'an empty inter-module pipe is one tile / four subtiles');
}
{
  const layout = layoutDesign(design(MODULE));
  assert(kinds(layout).join(',') === 'module', 'a single module needs no pipe');
}
{
  const layout = layoutDesign({ components: [] });
  assert(layout.sequence.length === 0, 'an empty design produces an empty sequence');
  assert(layoutDesign(undefined).sequence.length === 0, 'and a missing design does not throw');
}

// ==========================================================================
// Test 2: attachments ride the next pipe.
// ==========================================================================
console.log('\n--- Test 2: attachments between modules ---');
{
  const layout = layoutDesign(design(MODULE, ATT, MODULE_B, ATT_B, ATT_C, MODULE_WIDE));

  assert(kinds(layout).join(',') === 'module,pipe,module,pipe,module',
    `attachments occupy no sequence slot of their own (got ${kinds(layout).join(',')})`);

  const [, p1, , p2] = layout.sequence;
  assert(p1.attachments.map(a => a.type).join(',') === ATT,
    'the attachment authored after module 1 lands on the pipe leaving module 1');
  assert(p2.attachments.map(a => a.type).join(',') === `${ATT_B},${ATT_C}`,
    'the pair authored after module 2 lands on the next pipe, in order');
  assert(p1.attachments[0].params?.tag === ATT, 'attachment params are carried through verbatim');
  assert(layout.discardedLeading.length === 0 && layout.discardedTrailing.length === 0,
    'nothing discarded when every attachment has a pipe downstream');
}

// ==========================================================================
// Test 3: attachments before the first module.
// ==========================================================================
console.log('\n--- Test 3: leading attachments are discarded ---');
{
  const layout = layoutDesign(design(ATT, ATT_B, MODULE, MODULE_B));

  assert(kinds(layout).join(',') === 'module,pipe,module',
    'the modules are laid out as if the leading attachments were never there');
  assert(layout.discardedLeading.map(a => a.type).join(',') === `${ATT},${ATT_B}`,
    'both leading attachments are reported for the warning');
  assert(layout.discardedTrailing.length === 0, 'and none of them count as trailing');
  assert(layout.sequence[1].attachments.length === 0,
    'they do NOT slide onto the first available pipe — that would reorder the design');
}

// ==========================================================================
// Test 4: attachments after the last module.
// ==========================================================================
console.log('\n--- Test 4: trailing attachments are discarded ---');
{
  const layout = layoutDesign(design(MODULE, MODULE_B, ATT, ATT_B));

  assert(kinds(layout).join(',') === 'module,pipe,module', 'the trailing pair adds no pipe');
  assert(layout.sequence[1].attachments.length === 0,
    'they do not drift backwards onto the last real pipe');
  assert(layout.discardedTrailing.map(a => a.type).join(',') === `${ATT},${ATT_B}`,
    'both are reported for the warning');
  assert(layout.discardedLeading.length === 0, 'and none count as leading');
}
{
  // A design of nothing but attachments has no first module to be "before",
  // so it reads as trailing — matching the single warning DesignPlacer has
  // always emitted for it.
  const layout = layoutDesign(design(ATT, ATT_B));
  assert(layout.sequence.length === 0, 'no modules → no sequence');
  assert(layout.discardedTrailing.length === 2 && layout.discardedLeading.length === 0,
    'an all-attachment design is entirely trailing');
}

// ==========================================================================
// Test 5: packed positions.
//
// `position` is the START of the interval [position, position + subL/pipe.subL]
// that pipe-placements.findSlot reserves, so an arrangement is only legal if
// those INTERVALS are disjoint — not merely the start points.
//
// The old (i + 1) / (n + 1) spacing only spread the starts. Two quadrupoles at
// 1/3 and 2/3 of a 4-sub-unit pipe each claim half the run, so they overlapped,
// findSlot rejected the second with 'overlap', and DesignPlacer — which never
// looked at placeOnPipe's return value — charged for it and dropped it.
//
// They are now laid end to end with the pipe's slack split evenly into the
// n + 1 gaps around them, which both keeps every attachment off the pipe ends
// (the property the old spacing was chosen for) and makes the intervals
// provably disjoint.
// ==========================================================================
console.log('\n--- Test 5: packed positions ---');
{
  const onPipe = (...atts) => layoutDesign(design(MODULE, ...atts, MODULE_B)).sequence[1];
  const positions = (...atts) => onPipe(...atts).attachments.map(a => a.position);

  // A lone attachment is CENTRED on the pipe — its interval is, which is what
  // "centred" has to mean. The old rule put its start at the midpoint, i.e.
  // the hardware itself sat in the downstream half.
  const one = onPipe(ATT);            // bpm subL 1 on a 4-sub-unit pipe
  assert(one.attachments[0].position === 0.375,
    `1 attachment is centred: [0.375, 0.625] (got ${one.attachments[0].position})`);

  // bpm(1) + quadrupole(2) = 3 sub-units + 3 gaps of 0.5 minimum → 2 tiles,
  // 8 sub-units, so the slack is 5/3 per gap.
  const two = onPipe(ATT, ATT_B);
  assert(two.subL === 8 && two.attachments[0].position === (5 / 3) / 8
    && two.attachments[1].position === (5 / 3 + 1 + 5 / 3) / 8,
    `2 attachments sit at the ends of even gaps on an 8-sub-unit pipe (got ${positions(ATT, ATT_B)})`);

  // 1 + 2 + 2 = 5 sub-units on an 8-sub-unit pipe → 4 gaps of 0.75.
  const three = onPipe(ATT, ATT_B, ATT_C);
  assert(three.attachments.map(a => a.position).join(',') === '0.09375,0.3125,0.65625',
    `3 attachments pack at 0.09375 / 0.3125 / 0.65625 (got ${positions(ATT, ATT_B, ATT_C)})`);

  // The invariants, which are what actually has to hold for findSlot to take
  // every position verbatim in snap mode. These outlive any particular gap
  // constant: change MIN_GAP_SUB and these must still pass.
  for (const pipe of [one, two, three]) {
    const set = pipe.attachments.map(a => a.position);
    const ivs = pipe.attachments.map(a => [a.position, a.position + a.subL / pipe.subL]);
    assert(set.every(p => p > 0 && p < 1), `every position is strictly inside (0,1): ${set}`);
    assert(set.every((p, i) => i === 0 || p > set[i - 1]), `positions ascend in author order: ${set}`);
    assert(ivs.every(([, end]) => end < 1),
      `nothing runs off the far end of the pipe: ${ivs.map(v => v[1])}`);
    assert(ivs.every(([start], i) => i === 0 || start > ivs[i - 1][1]),
      `intervals are disjoint with a real gap between them: ${JSON.stringify(ivs)}`);
  }

  // Evenly-sized gaps, not just non-overlapping ones — the property that makes
  // the drift lengths either side of a magnet symmetric.
  const gaps = (pipe) => {
    const out = [];
    let cursor = 0;
    for (const a of pipe.attachments) {
      out.push(a.position * pipe.subL - cursor);
      cursor = a.position * pipe.subL + a.subL;
    }
    out.push(pipe.subL - cursor);
    return out;
  };
  for (const pipe of [one, two, three]) {
    const g = gaps(pipe);
    assert(g.every(x => Math.abs(x - g[0]) < 1e-9 && x >= 0.5 - 1e-9),
      `slack is split evenly and never below the 0.5 sub-unit minimum: ${g}`);
  }
}

// ==========================================================================
// Test 5b: the case the old rule could not express at all.
//
// Two quadrupoles are 2 sub-units each — exactly a whole one-tile pipe with no
// room for clearance. This is the shape that used to be charged for and
// silently dropped on testStand-sband and ebeam-sterilisation.
// ==========================================================================
console.log('\n--- Test 5b: two half-pipe attachments ---');
{
  const pipe = layoutDesign(design(MODULE, ATT_B, ATT_B, MODULE_B)).sequence[1];
  assert(pipe.tiles === 2 && pipe.subL === 8,
    `two subL-2 attachments force the pipe to 2 tiles (got ${pipe.tiles})`);
  const ivs = pipe.attachments.map(a => [a.position, a.position + a.subL / pipe.subL]);
  assert(ivs[0][1] < ivs[1][0], `and they no longer overlap: ${JSON.stringify(ivs)}`);
}

// ==========================================================================
// Test 6: unknown types are dropped.
// ==========================================================================
console.log('\n--- Test 6: unknown component types ---');
{
  const layout = layoutDesign(design(MODULE, 'notAThing', ATT, MODULE_B));
  assert(kinds(layout).join(',') === 'module,pipe,module', 'an unknown type adds no module');
  assert(layout.sequence[1].attachments.length === 1,
    'and does not disturb the attachments around it');
}

// ==========================================================================
// Test 7: `role` is the discriminator, and pipes are sized to their contents.
//
// Both halves of the same defect. RF cavities are `placement: 'module'` but
// `role: 'placement'`, so the old `placement === 'attachment'` test made every
// one of them a junction — and a junction with no `routing` table stops
// flattener.pickOutgoingPort dead, so the beam walk terminated at the first
// cavity and every stock blueprint flattened to 4 elements instead of 10-14.
//
// Classifying them correctly then exposes the second half: a cryomodule is 16
// sub-units and a one-tile pipe is 4, so it could not be mounted anywhere.
// ==========================================================================
console.log('\n--- Test 7: role classification and pipe sizing ---');
{
  // A cavity between two junctions is hardware ON the pipe, not a junction.
  const layout = layoutDesign(design(MODULE_B, 'rfCavity', MODULE_B));
  assert(kinds(layout).join(',') === 'module,pipe,module',
    `an RF cavity adds no junction of its own (got ${kinds(layout).join(',')})`);
  assert(layout.sequence[1].attachments.map(a => a.type).join(',') === 'rfCavity',
    'it rides the pipe between the two junctions');
  assert(layout.sequence[1].attachments[0].subL === 6,
    'carrying its registry length, which is what sizes the pipe');
}
{
  // The sizing rule: hardware + (n+1) gaps of 0.5, rounded up to whole tiles,
  // never below 1.
  const pipeFor = (...atts) => layoutDesign(design(MODULE_B, ...atts, MODULE_B)).sequence[1];

  assert(pipeFor().tiles === 1, 'a bare pipe is 1 tile');
  assert(pipeFor(ATT).tiles === 1, 'a bpm (1) still fits in 1 tile');
  assert(pipeFor(ATT_B).tiles === 1, 'a quadrupole (2) still fits in 1 tile');
  assert(pipeFor('rfCavity').tiles === 2, 'an rfCavity (6) needs 2 tiles');
  // 16 sub-units + 2 gaps of 0.5 = 17 → ceil(17/4) = 5 tiles. This is the case
  // that was simply impossible before: it cannot fit on any pipe of fixed
  // length 4, and placeOnPipe would have returned null for it forever.
  assert(pipeFor('cryomodule').tiles === 5, 'a cryomodule (16) needs 5 tiles');

  for (const atts of [[], [ATT], [ATT_B], ['rfCavity'], ['cryomodule'], [ATT, ATT_B, ATT_C]]) {
    const pipe = pipeFor(...atts);
    assert(pipe.subL === pipe.tiles * 4, `subL tracks tiles (${atts.join('+') || 'empty'})`);
    const hardware = pipe.attachments.reduce((s, a) => s + a.subL, 0);
    assert(pipe.subL >= hardware + (pipe.attachments.length + 1) * 0.5,
      `the pipe holds its contents plus clearance (${atts.join('+') || 'empty'})`);
  }
}
{
  // role `undefined` is NOT mountable hardware: it stays a module. `drift` is
  // the visible case (it is the pipe-draw tool), but every rfPower, cooling,
  // vacuum and dataControls entry is in the same boat, and none of them have
  // on-pipe geometry.
  const layout = layoutDesign(design(MODULE_B, MODULE, MODULE_B));
  assert(kinds(layout).join(',') === 'module,pipe,module,pipe,module',
    `a role-less component stays on the module path (got ${kinds(layout).join(',')})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
