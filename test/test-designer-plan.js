// test/test-designer-plan.js — tests for src/beamline/designer-plan.js
//
// The planner is pure: fixture state + draft stack in, ordered op list +
// blockers + summary out. The load-bearing assertions here are:
//
//   1. OP ORDER, not just op presence. The list is an execution script:
//      removeFromPipe → mergePipes → removeJunction → geometry → placements
//      → tuneParams. mergePipes sitting BEFORE removeJunction is the subtle
//      one — validateMergePipes proves adjacency by the junction reference
//      the two pipes SHARE, and removeJunction nulls exactly that.
//   2. SYMBOL RESOLUTION. Every `$sym` an op references must be declared by
//      an EARLIER op's `out`. A shared checker runs over every plan built
//      here, happy path or not.
//   3. PURITY. The state and the draft handed in come back untouched.
//
// Fixture geometry throughout: a vertical run down col 2 starting at a source
// placed at (col 0, row 0). 4 sub-units = 1 tile = 2 m.

import { planDesignerApply } from '../src/beamline/designer-plan.js';
import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { FLOORS, WALL_TYPES } from '../src/data/structure.js';
import { flattenPath } from '../src/beamline/flattener.js';
import { pipeCost } from '../src/beamline/BeamlineSystem.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function kinds(plan) { return plan.ops.map(o => o.kind); }
function codes(plan) { return plan.blockers.map(b => b.code); }
function opOf(plan, kind) { return plan.ops.find(o => o.kind === kind) || null; }
function blockerOf(plan, code) { return plan.blockers.find(b => b.code === code) || null; }

// -------------------------------------------------------------------------
// Shared invariant checks, run on every plan this file builds.
// -------------------------------------------------------------------------

const PHASE_RANK = {
  bulldozePlaceable: 0, bulldozeWall: 0,
  removeFromPipe: 1,
  mergePipes: 2,
  removeJunction: 3,
  clearDecoration: 4, placeConcrete: 4,
  splitPipe: 5, trimPipe: 5, extendPipe: 5,
  drawPipe: 5,            // may be promoted when it needs a new junction
  placeJunction: 6, placeOnPipe: 6,
  tuneParams: 7,
};

function collectSymbols(value, into) {
  if (typeof value === 'string') {
    if (value.startsWith('$')) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectSymbols(v, into);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'out') continue;   // declarations, not references
      collectSymbols(v, into);
    }
  }
  return into;
}

/** Every referenced $sym is declared by an earlier op; phases never regress. */
function checkPlanInvariants(plan, label) {
  const declared = new Set();
  let ok = true;
  let detail = '';
  let rank = -1;
  for (const op of plan.ops) {
    for (const sym of collectSymbols({ ...op, out: undefined }, new Set())) {
      if (!declared.has(sym)) {
        ok = false;
        detail = `${op.kind} references undeclared ${sym}`;
      }
    }
    for (const sym of Object.values(op.out || {})) declared.add(sym);

    const r = PHASE_RANK[op.kind];
    assert(r !== undefined, `${label}: op kind '${op.kind}' is in the documented set`);
    // A drawPipe anchored to a junction this plan creates is the one
    // documented promotion; it may sit in the placement phase.
    const effective = (op.kind === 'drawPipe' && collectSymbols({ ...op, out: undefined }, new Set()).size > 0)
      ? 6 : r;
    if (effective < rank) { ok = false; detail = `${op.kind} runs out of phase order`; }
    rank = Math.max(rank, effective);

    if (!('nodeIndex' in op)) { ok = false; detail = `${op.kind} has no nodeIndex`; }
  }
  assert(ok, `${label}: op list is internally consistent${detail ? ' — ' + detail : ''}`);
  assertEq(plan.ok, plan.blockers.length === 0, `${label}: ok mirrors blockers.length === 0`);
}

function plan(state, opts) {
  const stateBefore = JSON.stringify(state);
  const draftBefore = JSON.stringify(opts.draftNodes);
  const result = planDesignerApply(state, opts);
  assert(JSON.stringify(state) === stateBefore, 'planner did not mutate state');
  assert(JSON.stringify(opts.draftNodes) === draftBefore, 'planner did not mutate draftNodes');
  checkPlanInvariants(result, opts._label || 'plan');
  return result;
}

// -------------------------------------------------------------------------
// Fixture builders
// -------------------------------------------------------------------------

// A source at (0,0) with subW/subL 4 puts its exit port at pipe point
// (col 0, row 0.5). We instead anchor the run on col 2 by placing the source
// at col 2 so ports and pipe line up on the same column.
function placeable(id, type, col, row, subCol = 0, subRow = 0, dir = 0, params = {}) {
  const def = COMPONENTS[type] || PLACEABLES[type];
  const swap = dir === 1 || dir === 3;
  const w = swap ? def.subL : def.subW;
  const h = swap ? def.subW : def.subL;
  const cells = [];
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      const sc = subCol + dc, sr = subRow + dr;
      cells.push({
        col: col + Math.floor(sc / 4), row: row + Math.floor(sr / 4),
        subCol: ((sc % 4) + 4) % 4, subRow: ((sr % 4) + 4) % 4,
      });
    }
  }
  return { id, type, col, row, subCol, subRow, dir, params, cells, stackChildren: [] };
}

function occupancyOf(placeables) {
  const occ = {};
  for (const p of placeables) {
    for (const c of p.cells) occ[`${c.col},${c.row},${c.subCol},${c.subRow}`] = p.id;
  }
  return occ;
}

function makeState(placeables, beamPipes, funding = 100000000) {
  return {
    placeables,
    beamPipes,
    subgridOccupied: occupancyOf(placeables),
    wallOccupied: {},
    resources: { funding },
  };
}

function pipe(id, start, end, fromRow, toRow, placements = []) {
  return {
    id, start, end,
    path: [{ col: 2, row: fromRow }, { col: 2, row: toRow }],
    subL: Math.round(Math.abs(toRow - fromRow) * 4),
    placements,
  };
}

function ref(junctionId, portName) { return { junctionId, portName }; }

/**
 * source(2,0) → pipe → optional endpoint.
 * The source's exit port sits at (col 2, row 0.5); an endpoint placed
 * `endRow` tiles down has its entry port at that row.
 */
function makeRun({ endpoint = null, pipeToRow = 6.5, placements = [] } = {}) {
  const src = placeable('src_1', 'source', 2, 0);
  const placeables = [src];
  let endRef = null;
  if (endpoint) {
    // faradayCup: subW 2, subL 4. Entry port faces N; centre must be
    // pipeToRow + 4*0.125 = pipeToRow + 0.5 tiles down.
    const centreRow = pipeToRow + 0.5;
    const absSubCol = Math.round(2 * (2 * 2 + 1) - 2 / 2);       // col 2 centre
    const absSubRow = Math.round(2 * (centreRow * 2 + 1) - 4 / 2);
    placeables.push(placeable(
      'end_1', endpoint,
      Math.floor(absSubCol / 4), Math.floor(absSubRow / 4),
      absSubCol % 4, absSubRow % 4, 0,
    ));
    endRef = ref('end_1', 'entry');
  }
  const bp = pipe('bp_1', ref('src_1', 'exit'), endRef, 0.5, pipeToRow, placements);
  return makeState(placeables, [bp]);
}

/** draftNodes exactly as BeamlineDesigner.openFromSource would build them. */
function draftFromMap(state, sourceId) {
  return flattenPath(state, sourceId).map((entry, idx) => ({
    id: entry.kind === 'drift' ? -1000 - idx : entry.id,
    type: entry.kind === 'drift' ? 'drift' : entry.type,
    params: { ...(entry.params || {}) },
    beamStart: entry.beamStart,
    subL: entry.subL,
    _pipeKind: entry.kind,
    _sourceRef: entry.kind === 'module'
      ? { placeableId: entry.id }
      : entry.kind === 'placement'
        ? { pipeId: entry.pipeId, placementId: entry.id, position: entry.position }
        : { pipeId: entry.pipeId },
  }));
}

/** A node as insertComponent() creates it: no map bookkeeping at all. */
function newNode(type, params = {}) {
  const def = COMPONENTS[type];
  return {
    id: -1, type, params,
    subL: def.subL,
    _pipeKind: def.role === 'junction' || def.isDrawnConnection ? 'module' : 'placement',
    _sourceRef: {},
  };
}

// =========================================================================
console.log('\n--- 1: no changes at all → empty plan ---');
{
  const state = makeRun();
  const draft = draftFromMap(state, 'src_1');
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, originalNodes: draft, _label: 'noop' });
  assert(res.ok === true, 'ok=true');
  assertEq(res.ops.length, 0, 'no ops');
  assertEq(res.summary.totalCost, 0, 'costs nothing');
  assertEq(res.summary.movedCount, 0, 'movedCount is 0 in this phase');
  assertEq(res.summary.danglingLineCount, 0, 'danglingLineCount is 0 in this phase');
}

// =========================================================================
console.log('\n--- 2: append a beam pipe at an open end → extendPipe ---');
{
  const state = makeRun();                       // no endpoint: pipe end is open
  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('drift'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'append drift' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'extendPipe', 'exactly one extendPipe');
  const op = opOf(res, 'extendPipe');
  assertEq(op.pipeId, 'bp_1', 'extends the run\'s pipe');
  assertEq(op.additionalPath[0].row, 6.5, 'starts at the open cap');
  assertEq(op.additionalPath[1].row, 7.5, 'runs 1 tile (4 sub-units = 2 m) further');
  assertEq(op.nodeIndex, draft.length - 1, 'nodeIndex points at the added draft node');
  // The preview number has to be the number BeamlineSystem.extendPipe charges.
  assertEq(res.summary.totalCost, pipeCost(1).funding, 'priced with the real pipeCost');
  assertEq(res.summary.adds[0].type, 'drift', 'summarised as a drift add');
  assertEq(res.summary.adds[0].metres, 2, 'reports 2 m of pipe');
}

// =========================================================================
console.log('\n--- 3: append a junction at an open end → placeJunction binds the cap ---');
{
  const state = makeRun();
  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('faradayCup'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'append cup' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'placeJunction', 'one placeJunction, no pipe surgery');
  const op = opOf(res, 'placeJunction');
  assertEq(op.type, 'faradayCup', 'the right component');
  assertEq(op.dir, 0, 'oriented so its entry faces back up the beam');
  assertEq(op.connect.length, 1, 'binds exactly one pipe end');
  assertEq(op.connect[0].pipe, 'bp_1', 'binds the existing pipe');
  assertEq(op.connect[0].end, 'end', 'binds the downstream (open) side');
  assertEq(op.connect[0].port, 'entry', 'to its entry port');
  assert(op.out && op.out.junction.startsWith('$'), 'declares a symbolic junction id');
  assertEq(res.summary.totalCost, COMPONENTS.faradayCup.cost.funding, 'charged at list price');
  // Placed beyond the cap: its centre sits 0.5 tiles past row 6.5, which puts
  // its entry port back exactly on row 6.5 — footprint rows 28..31 in
  // sub-units, i.e. tile row 7 with no sub-offset.
  assertEq(op.col, 2, 'anchored on the pipe column');
  assertEq(op.row, 7, 'anchored so its entry port lands on the cap');
  assertEq(op.subRow, 0, 'flush onto the sub-grid');
}

// =========================================================================
console.log('\n--- 4: append before a terminal endpoint by consuming drift ---');
{
  const state = makeRun({ endpoint: 'faradayCup' });
  const draft = draftFromMap(state, 'src_1');
  // Insert before the endpoint module (the last draft node).
  draft.splice(draft.length - 1, 0, newNode('sbandStructure'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'before endpoint' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'placeOnPipe', 'a cavity rides the pipe — no geometry needed');
  const op = opOf(res, 'placeOnPipe');
  assertEq(op.pipeId, 'bp_1', 'lands on the pipe feeding the endpoint');
  assertEq(op.subL, COMPONENTS.sbandStructure.subL, 'claims its own length');
  assertEq(op.nodeIndex, draft.length - 2, 'nodeIndex points at the inserted node');
  assert(op.position > 0 && op.position < 1, `position inside the pipe (got ${op.position})`);
  assertEq(res.summary.totalCost, COMPONENTS.sbandStructure.cost.funding, 'charged at list price');
  // The endpoint never moves: no trim, no extend, no move op.
  assert(!kinds(res).includes('trimPipe') && !kinds(res).includes('extendPipe'),
    'the terminal endpoint is not displaced');
}

// =========================================================================
console.log('\n--- 5: insert a junction into a drift with room → split then place ---');
{
  const state = makeRun({ endpoint: 'faradayCup' });
  const draft = draftFromMap(state, 'src_1');
  draft.splice(draft.length - 1, 0, newNode('combinedFunctionMagnet'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'splice magnet' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'splitPipe,placeJunction',
    'geometry (split) precedes the placement it feeds');

  const split = opOf(res, 'splitPipe');
  const place = opOf(res, 'placeJunction');
  assertEq(split.pipeId, 'bp_1', 'splits the run\'s pipe');
  assertEq(split.gapSubL, COMPONENTS.combinedFunctionMagnet.subL, 'hole sized to the module');
  assert(split.out.head.startsWith('$') && split.out.tail.startsWith('$'),
    'declares both stub symbols');
  assertEq(place.connect.length, 2, 'binds both stubs');
  assertEq(place.connect[0].pipe, split.out.head, 'upstream stub is the head (forward run)');
  assertEq(place.connect[0].end, 'end', 'head binds on its open (downstream) side');
  assertEq(place.connect[0].port, 'entry', 'head feeds the module entry');
  assertEq(place.connect[1].pipe, split.out.tail, 'downstream stub is the tail');
  assertEq(place.connect[1].end, 'start', 'tail binds on its open (upstream) side');
  assertEq(place.connect[1].port, 'exit', 'tail is fed by the module exit');
  assertEq(place.col, 2, 'anchored on the pipe column');
}

// =========================================================================
console.log('\n--- 6: insert into a drift with NO room — the two refusals differ ---');
{
  // 6a. gap_too_large: the whole section is shorter than the module.
  //     source exit at row 0.5, endpoint entry at row 1.0 → 2 sub-units of pipe.
  const tiny = makeRun({ endpoint: 'faradayCup', pipeToRow: 1.0 });
  const draftA = draftFromMap(tiny, 'src_1');
  draftA.splice(draftA.length - 1, 0, newNode('combinedFunctionMagnet'));  // subL 4
  const resA = plan(tiny, { sourceId: 'src_1', draftNodes: draftA, _label: 'gap too large' });
  assert(resA.ok === false, 'ok=false');
  assertEq(codes(resA).join(','), 'no_space', 'blocked as no_space');
  const bA = blockerOf(resA, 'no_space');
  assertEq(bA.nodeIndex, draftA.length - 2, 'blocker points at the offending draft node');
  assert(/longer than the beam pipe section/i.test(bA.message),
    `"give up on this section" wording (got: ${bA.message})`);
  assert(!/exact spot/i.test(bA.message), 'does NOT tell the player to nudge it along');

  // 6b. stub_too_short: the module DOES fit on this section, just not where
  //     its neighbours push it. Pipe 0.5..3.25 = 11 sub-units, an existing
  //     6-long cavity flush at the head, so the 4-long magnet is centred in
  //     the remaining 5 and ends up flush against the far end — zero pipe left
  //     on the downstream side. The message has to say "nudge it", not "give
  //     up on this section", or the player deletes the wrong thing.
  const packed = makeRun({
    endpoint: 'faradayCup',
    pipeToRow: 3.25,
    placements: [{ id: 'pl_1', type: 'rfCavity', position: 0, subL: 6, params: {} }],
  });
  assertEq(packed.beamPipes[0].subL, 11, 'fixture pipe is 11 sub-units');
  const draftB = draftFromMap(packed, 'src_1');
  draftB.splice(draftB.length - 1, 0, newNode('combinedFunctionMagnet'));
  const resB = plan(packed, { sourceId: 'src_1', draftNodes: draftB, _label: 'stub too short' });
  assert(resB.ok === false, 'ok=false');
  assertEq(codes(resB).join(','), 'no_space', 'blocked as no_space');
  const bB = blockerOf(resB, 'no_space');
  assert(/not at that exact spot/i.test(bB.message),
    `"move it along" wording (got: ${bB.message})`);
  assert(!/longer than the beam pipe section/i.test(bB.message),
    'does NOT tell the player the section is hopeless');
}

// =========================================================================
console.log('\n--- 7: deletion of a mid-run junction merges the pipes ---');
{
  // source(2,0) → bp_1 → combinedFunctionMagnet → bp_2 → faradayCup, all on col 2.
  const src = placeable('src_1', 'source', 2, 0);
  // magnet: subW 2, subL 4, entry port up. Centre at row 3.0 → entry at row 2.5.
  const mag = placeable('mag_1', 'combinedFunctionMagnet', 2, 2, 1, 2);
  const cup = placeable('end_1', 'faradayCup', 2, 5, 1, 2);
  const bp1 = pipe('bp_1', ref('src_1', 'exit'), ref('mag_1', 'entry'), 0.5, 2.5);
  const bp2 = pipe('bp_2', ref('mag_1', 'exit'), ref('end_1', 'entry'), 3.5, 5.5);
  const state = makeState([src, mag, cup], [bp1, bp2]);

  const flat = flattenPath(state, 'src_1');
  assertEq(flat.filter(e => e.kind === 'module').map(e => e.id).join(','), 'src_1,mag_1,end_1',
    'fixture walks source → magnet → endpoint');

  const draft = draftFromMap(state, 'src_1').filter(n => n._sourceRef.placeableId !== 'mag_1');
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'delete magnet' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'mergePipes,removeJunction',
    'the merge runs BEFORE the removal that would null the shared reference');
  const merge = opOf(res, 'mergePipes');
  assertEq(merge.pipeIdA, 'bp_1', 'merges the upstream pipe');
  assertEq(merge.pipeIdB, 'bp_2', 'with the downstream pipe');
  assert(merge.out.pipe.startsWith('$'), 'declares the merged pipe symbol');
  assertEq(opOf(res, 'removeJunction').junctionId, 'mag_1', 'removes the deleted junction');
  const refund = Math.floor(COMPONENTS.combinedFunctionMagnet.cost.funding * 0.5);
  assertEq(res.summary.totalCost, -refund, 'nets out to the 50% refund');
  assertEq(res.summary.removes[0].refund, refund, 'summarised as a refund');
}

// =========================================================================
console.log('\n--- 8: attachment add and remove ---');
{
  const state = makeRun({
    endpoint: 'faradayCup',
    placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.25, subL: 2, params: {} }],
  });
  const draft = draftFromMap(state, 'src_1');
  const withoutQuad = draft.filter(n => n._sourceRef.placementId !== 'pl_1');
  const res = plan(state, { sourceId: 'src_1', draftNodes: withoutQuad, _label: 'drop quad' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'removeFromPipe', 'one removeFromPipe');
  assertEq(opOf(res, 'removeFromPipe').placementId, 'pl_1', 'the right placement');
  assertEq(res.summary.totalCost, -Math.floor(COMPONENTS.quadrupole.cost.funding * 0.5),
    'refunds 50%, matching BeamlineSystem.removeFromPipe');

  // Swap it for a BPM in one plan: the removal must precede the placement.
  const swapped = withoutQuad.slice();
  swapped.splice(swapped.length - 1, 0, newNode('quadrupole'));
  const res2 = plan(state, { sourceId: 'src_1', draftNodes: swapped, _label: 'swap quad' });
  assert(res2.ok === true, `ok=true (blockers ${JSON.stringify(res2.blockers)})`);
  assertEq(kinds(res2).join(','), 'removeFromPipe,placeOnPipe',
    'removal frees the slot before the replacement claims it');
}

// =========================================================================
console.log('\n--- 9: param tuning only ---');
{
  const state = makeRun({
    endpoint: 'faradayCup',
    placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.25, subL: 2, params: { gradient: 5 } }],
  });
  state.placeables[0].params = { current: 1 };
  const draft = draftFromMap(state, 'src_1');
  draft[0].params = { current: 2 };                       // source module
  const quad = draft.find(n => n._sourceRef.placementId === 'pl_1');
  quad.params = { gradient: 9 };
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'tune' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'tuneParams,tuneParams', 'two tune ops and nothing else');
  assertEq(res.summary.totalCost, 0, 'tuning is free');
  const mod = res.ops.find(o => o.target === 'module');
  const pl = res.ops.find(o => o.target === 'placement');
  assertEq(mod.junctionId, 'src_1', 'module tune targets the source placeable');
  assertEq(mod.params.current, 2, 'carries the new value');
  assertEq(pl.pipeId, 'bp_1', 'placement tune carries its pipe');
  assertEq(pl.placementId, 'pl_1', 'and its placement id');
  assertEq(pl.params.gradient, 9, 'carries the new value');
}

// =========================================================================
console.log('\n--- 9b: palette Replace materialises the new component type ---');
{
  // Pipe-mounted hardware keeps its draft id/_sourceRef when the palette
  // replaces its type. The planner must still remove the referenced map item
  // and create the requested type instead of mistaking identity for equality.
  const state = makeRun({
    endpoint: 'faradayCup',
    placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.25, subL: 2, params: {} }],
  });
  const draft = draftFromMap(state, 'src_1');
  const quad = draft.find(n => n._sourceRef.placementId === 'pl_1');
  quad.type = 'bpm';
  quad.params = {};
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'replace attachment' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'removeFromPipe,placeOnPipe',
    'an attachment replacement removes the old type and places the new one');
  assertEq(opOf(res, 'removeFromPipe').placementId, 'pl_1', 'removes the retained map identity');
  assertEq(opOf(res, 'placeOnPipe').type, 'bpm', 'places the requested replacement type');

  // Replacing a schematic Beam Pipe span carries only a pipe back-reference.
  // That span is map-derived, but the requested hardware is not.
  const state2 = makeRun({ endpoint: 'faradayCup' });
  const draft2 = draftFromMap(state2, 'src_1');
  const drift = draft2.find(n => n._pipeKind === 'drift');
  drift.type = 'quadrupole';
  drift.params = {};
  const res2 = plan(state2, { sourceId: 'src_1', draftNodes: draft2, _label: 'replace drift' });
  assert(res2.ok === true, `ok=true (blockers ${JSON.stringify(res2.blockers)})`);
  assertEq(kinds(res2).join(','), 'placeOnPipe',
    'replacing a drift span creates the requested pipe-mounted component');
  assertEq(opOf(res2, 'placeOnPipe').type, 'quadrupole', 'places the selected component');

  // Junction replacements keep the old placeable id in exactly the same way.
  // At a terminal, the old endpoint is removed and the replacement is bound
  // back onto the now-open pipe end.
  const state3 = makeRun({ endpoint: 'faradayCup' });
  const draft3 = draftFromMap(state3, 'src_1');
  const endpoint = draft3.find(n => n._sourceRef.placeableId === 'end_1');
  endpoint.type = 'beamStop';
  endpoint.params = {};
  const res3 = plan(state3, { sourceId: 'src_1', draftNodes: draft3, _label: 'replace junction' });
  assert(res3.ok === true, `ok=true (blockers ${JSON.stringify(res3.blockers)})`);
  assertEq(kinds(res3).join(','), 'removeJunction,placeJunction',
    'a junction replacement removes the old endpoint and places the new one');
  assertEq(opOf(res3, 'placeJunction').type, 'beamStop', 'places the requested endpoint type');
}

// =========================================================================
console.log('\n--- 10: blocker — source_immovable (removed, prepended to, or replaced) ---');
{
  const state = makeRun({ endpoint: 'faradayCup' });
  const draft = draftFromMap(state, 'src_1');

  const dropped = draft.filter(n => n._sourceRef.placeableId !== 'src_1');
  const resA = plan(state, { sourceId: 'src_1', draftNodes: dropped, _label: 'drop source' });
  assertEq(codes(resA).join(','), 'source_immovable', 'deleting the source is refused');
  assert(/anchors this beamline/i.test(blockerOf(resA, 'source_immovable').message),
    'message explains the source is anchored');

  const prepended = [newNode('drift'), ...draft];
  const resB = plan(state, { sourceId: 'src_1', draftNodes: prepended, _label: 'prepend' });
  assertEq(codes(resB).join(','), 'source_immovable', 'prepending in front of the source is refused');
  assertEq(blockerOf(resB, 'source_immovable').nodeIndex, 0, 'points at the prepended node');

  const retyped = draftFromMap(state, 'src_1');
  retyped[0].type = 'dcPhotoGun';
  const resC = plan(state, { sourceId: 'src_1', draftNodes: retyped, _label: 'replace source' });
  assertEq(codes(resC).join(','), 'source_immovable', 'replacing the anchored source is refused');
  assertEq(blockerOf(resC, 'source_immovable').nodeIndex, 0,
    'the source replacement blocker points at the source');
}

// =========================================================================
console.log('\n--- 11: blocker — no_space when a change would displace hardware ---');
{
  // Beam pipe added between two anchored modules: everything downstream would
  // have to slide. Phase 2 refuses; Task 4.2 turns this into moveJunction ops.
  const state = makeRun({ endpoint: 'faradayCup' });
  const draft = draftFromMap(state, 'src_1');
  draft.splice(draft.length - 1, 0, newNode('drift'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'interior drift' });
  assert(res.ok === false, 'ok=false');
  assertEq(codes(res).join(','), 'no_space', 'blocked as no_space');
  assert(/push everything downstream/i.test(blockerOf(res, 'no_space').message),
    'message names displacement as the reason');
  assert(!kinds(res).includes('moveJunction'), 'no moveJunction op is emitted in this phase');
}

// =========================================================================
console.log('\n--- 12: blocker — collision when a new junction lands on something ---');
{
  const state = makeRun();               // open end at row 6.5
  // Park a beam stop exactly where an appended faradayCup would go (case 3).
  const squatter = placeable('sq_1', 'beamStop', 2, 7, 0, 0);
  state.placeables.push(squatter);
  Object.assign(state.subgridOccupied, occupancyOf([squatter]));

  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('faradayCup'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'collision' });
  assert(res.ok === false, 'ok=false');
  assertEq(codes(res).join(','), 'collision', 'blocked as collision');
  assert(/already there/i.test(blockerOf(res, 'collision').message),
    'message says the space is taken');
}

// =========================================================================
console.log('\n--- 12b: decisive confirmation clears ordinary site conflicts and pours concrete ---');
{
  const state = makeRun();
  const squatter = placeable('eq_1', 'coolantPump', 2, 7, 0, 0);
  squatter.kind = 'equipment';
  squatter.category = 'equipment';
  state.placeables.push(squatter);
  Object.assign(state.subgridOccupied, occupancyOf([squatter]));
  state.floors = [];
  state.infraOccupied = {};
  state.zones = [];
  state.zoneOccupied = {};

  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('faradayCup'));
  const res = plan(state, {
    sourceId: 'src_1', draftNodes: draft,
    prepareSite: true, _label: 'decisive site preparation',
  });

  assert(res.ok === true, `ordinary equipment is site-cleared (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'bulldozePlaceable,placeConcrete,placeJunction',
    'bulldoze and foundation precede the new module');
  assertEq(opOf(res, 'bulldozePlaceable').placeableId, 'eq_1',
    'the exact obstructing placeable is named');
  assertEq(res.ops.filter(op => op.kind === 'placeConcrete').length, 1,
    'the one-tile module footprint is paved once');
  assert(res.summary.adds.some(row => row.label === FLOORS.concrete.name),
    'the confirmation lists the concrete pad');
  assert(res.summary.removes.some(row => row.type === 'coolantPump'
      || row.label === PLACEABLES.coolantPump.name),
    'the confirmation explicitly lists the bulldozed equipment');
  const expected = (COMPONENTS.faradayCup.cost.funding || 0)
    + FLOORS.concrete.cost
    - Math.floor((PLACEABLES.coolantPump.cost.funding || 0) * 0.5);
  assertEq(res.summary.totalCost, expected,
    'the net quote includes concrete and the normal demolition refund');
}

// =========================================================================
console.log('\n--- 12c: decisive confirmation clears walls crossed by a wide module ---');
{
  const state = makeRun();
  state.walls = [{ type: 'structuralWall', col: 2, row: 7, edge: 'e', variant: 0 }];
  state.wallOccupied = { '2,7,e': 'structuralWall' };
  state.wallOverlays = [];
  state.doors = [];
  state.windows = [];
  state.floors = [];
  state.infraOccupied = {};
  state.zones = [];
  state.zoneOccupied = {};

  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('detector'));
  const res = plan(state, {
    sourceId: 'src_1', draftNodes: draft,
    prepareSite: true, _label: 'wall site preparation',
  });
  assert(res.ok === true, `crossed wall is removable (blockers ${JSON.stringify(res.blockers)})`);
  assert(kinds(res)[0] === 'bulldozeWall' && kinds(res).at(-1) === 'placeJunction',
    `wall demolition precedes foundation and module placement (got ${kinds(res)})`);
  assert(res.summary.removes.some(row => row.label === WALL_TYPES.structuralWall.name),
    'the confirmation lists the demolished wall and refund');
  assert(res.ops.filter(op => op.kind === 'placeConcrete').length > 1,
    'the full multi-tile detector footprint receives foundation');
}

// =========================================================================
console.log('\n--- 12d: destructive landscaping is charged rather than refunded ---');
{
  const state = makeRun();
  const tree = placeable('dc_1', 'oakTree', 2, 7, 0, 0);
  tree.kind = 'decoration';
  tree.category = 'decoration';
  state.placeables.push(tree);
  Object.assign(state.subgridOccupied, occupancyOf([tree]));
  state.floors = [];
  state.infraOccupied = {};
  state.zones = [];
  state.zoneOccupied = {};

  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('faradayCup'));
  const res = plan(state, {
    sourceId: 'src_1', draftNodes: draft,
    prepareSite: true, _label: 'tree site preparation',
  });
  assert(res.ok === true, `tree is cleared (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'clearDecoration,placeConcrete,placeJunction',
    'tree clearing and foundation precede module placement');
  assert(res.summary.adds.some(row => row.label === 'Site clearing'
      && row.cost === PLACEABLES.oakTree.removeCost),
    'the confirmation quotes the tree removal cost');
  assert(res.summary.removes.some(row => row.label === PLACEABLES.oakTree.name
      && row.refund === 0),
    'the confirmation shows that destructive clearing has no resale refund');
}

// =========================================================================
console.log('\n--- 13: blocker — not_straight for a module with no through-axis ---');
{
  // A dipole's exit leaves sideways, so it cannot be spliced into a straight
  // run — the flattener would walk the beam round a corner that isn't there.
  const state = makeRun({ endpoint: 'faradayCup' });
  const draft = draftFromMap(state, 'src_1');
  draft.splice(draft.length - 1, 0, newNode('dipole'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'dipole splice' });
  assert(res.ok === false, 'ok=false');
  assert(codes(res).includes('not_straight'), `blocked as not_straight (got ${codes(res)})`);
}

// =========================================================================
console.log('\n--- 14: blocker — multi_branch_unsupported ---');
{
  // Three pipes on one junction: a splitter the planner refuses to guess at.
  const src = placeable('src_1', 'source', 2, 0);
  const mag = placeable('mag_1', 'combinedFunctionMagnet', 2, 2, 1, 2);
  const state = makeState([src, mag], [
    pipe('bp_1', ref('src_1', 'exit'), ref('mag_1', 'entry'), 0.5, 2.5),
    pipe('bp_2', ref('mag_1', 'exit'), null, 3.5, 5.5),
    { id: 'bp_3', start: ref('mag_1', 'aux'), end: null,
      path: [{ col: 3, row: 3 }, { col: 6, row: 3 }], subL: 12, placements: [] },
  ]);
  const draft = draftFromMap(state, 'src_1');
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'branch' });
  assert(res.ok === false, 'ok=false');
  assertEq(codes(res).join(','), 'multi_branch_unsupported', 'blocked as multi_branch_unsupported');
  assertEq(res.ops.length, 0, 'nothing is planned for a branching run');
  assert(res.blockers[0].nodeIndex >= 0, 'points at the branching module in the draft');
}

// =========================================================================
console.log('\n--- 15: blocker — unaffordable ---');
{
  const state = makeRun();
  state.resources.funding = 1000;
  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('faradayCup'));               // $30,000
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'broke' });
  assert(res.ok === false, 'ok=false');
  assertEq(codes(res).join(','), 'unaffordable', 'blocked as unaffordable');
  assertEq(blockerOf(res, 'unaffordable').nodeIndex, -1, 'not attributable to one node');
  assert(res.summary.totalCost > 1000, 'summary still reports the real cost');
  // Ops are still returned so the preview can show what WOULD happen.
  assert(res.ops.length > 0, 'the plan is still built, just not applicable');
}

// =========================================================================
console.log('\n--- 15b: free-construction planning still quotes an unaffordable build ---');
{
  const state = makeRun();
  state.resources.funding = 0;
  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('faradayCup'));
  const res = plan(state, {
    sourceId: 'src_1', draftNodes: draft, freeConstruction: true,
    _label: 'free construction',
  });
  assert(res.ok === true,
    `free construction is not blocked by the live balance (${JSON.stringify(res.blockers)})`);
  assertEq(res.summary.totalCost, COMPONENTS.faradayCup.cost.funding,
    'the confirmation keeps the full nominal build quote');
  assert(res.ops.length > 0, 'the quoted free-construction plan remains executable');
}

// =========================================================================
console.log('\n--- 16: symbols chain across a multi-step plan ---');
{
  // Delete the magnet (merge) AND splice a fresh one back in: the split has to
  // operate on the MERGED pipe's symbol, and the new junction on the split's.
  const src = placeable('src_1', 'source', 2, 0);
  const mag = placeable('mag_1', 'combinedFunctionMagnet', 2, 2, 1, 2);
  const cup = placeable('end_1', 'faradayCup', 2, 5, 1, 2);
  const state = makeState([src, mag, cup], [
    pipe('bp_1', ref('src_1', 'exit'), ref('mag_1', 'entry'), 0.5, 2.5),
    pipe('bp_2', ref('mag_1', 'exit'), ref('end_1', 'entry'), 3.5, 5.5),
  ]);
  const draft = draftFromMap(state, 'src_1').filter(n => n._sourceRef.placeableId !== 'mag_1');
  draft.splice(draft.length - 1, 0, newNode('combinedFunctionMagnet'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'merge then split' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'mergePipes,removeJunction,splitPipe,placeJunction',
    'merge → remove → split → place, in that order');
  const merge = opOf(res, 'mergePipes');
  const split = opOf(res, 'splitPipe');
  const place = opOf(res, 'placeJunction');
  assertEq(split.pipeId, merge.out.pipe, 'the split consumes the merged pipe symbol');
  assertEq(place.connect[0].pipe, split.out.head, 'the placement consumes the split symbols');
  assertEq(place.connect[1].pipe, split.out.tail, 'both of them');
}

// =========================================================================
console.log('\n--- 17: a bare source with no pipe draws one ---');
{
  const state = makeState([placeable('src_1', 'source', 2, 0)], []);
  const draft = draftFromMap(state, 'src_1');
  assertEq(draft.length, 1, 'fixture flattens to just the source');
  draft.push(newNode('drift'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'first pipe' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'drawPipe', 'one drawPipe out of the source');
  const op = opOf(res, 'drawPipe');
  assertEq(op.start.junctionId, 'src_1', 'anchored on the source');
  assertEq(op.start.portName, 'exit', 'at its exit port');
  assertEq(op.end, null, 'the far end is left open');
  assert(op.out.pipe.startsWith('$'), 'declares the new pipe symbol');
}

// =========================================================================
console.log('\n--- 18: junction then pipe at an open end — drawPipe is promoted ---');
{
  const state = makeRun();
  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('combinedFunctionMagnet'));
  draft.push(newNode('drift'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'magnet then pipe' });
  assert(res.ok === true, `ok=true (blockers ${JSON.stringify(res.blockers)})`);
  assertEq(kinds(res).join(','), 'placeJunction,drawPipe',
    'the drawPipe follows the placeJunction it depends on, not the geometry phase');
  const place = opOf(res, 'placeJunction');
  const draw = opOf(res, 'drawPipe');
  assertEq(draw.start.junctionId, place.out.junction, 'anchored on the junction just placed');
  assertEq(draw.start.portName, 'exit', 'at its exit port');
}

// =========================================================================
console.log('\n--- 19: two modules back to back is refused with an actionable message ---');
{
  const state = makeRun();
  const draft = draftFromMap(state, 'src_1');
  draft.push(newNode('combinedFunctionMagnet'));
  draft.push(newNode('faradayCup'));
  const res = plan(state, { sourceId: 'src_1', draftNodes: draft, _label: 'back to back' });
  assert(res.ok === false, 'ok=false');
  assertEq(codes(res).join(','), 'no_space', 'blocked as no_space');
  assert(/Add a Beam Pipe/i.test(blockerOf(res, 'no_space').message),
    `message tells the player what to do (got: ${blockerOf(res, 'no_space').message})`);
}

// =========================================================================
console.log('\n--- 20: purity under a plan that touches everything ---');
{
  const state = makeRun({
    endpoint: 'faradayCup',
    placements: [{ id: 'pl_1', type: 'quadrupole', position: 0.5, subL: 2, params: { gradient: 3 } }],
  });
  const draft = draftFromMap(state, 'src_1')
    .filter(n => n._sourceRef.placementId !== 'pl_1');
  draft.splice(draft.length - 1, 0, newNode('sbandStructure'));
  draft[0].params = { current: 7 };

  const stateJson = JSON.stringify(state);
  const draftJson = JSON.stringify(draft);
  const res = planDesignerApply(state, { sourceId: 'src_1', draftNodes: draft });
  assert(JSON.stringify(state) === stateJson, 'state is byte-identical after planning');
  assert(JSON.stringify(draft) === draftJson, 'draftNodes are byte-identical after planning');
  // Planning twice must give the same answer — no hidden accumulation.
  const res2 = planDesignerApply(state, { sourceId: 'src_1', draftNodes: draft });
  assertEq(JSON.stringify(res2.ops), JSON.stringify(res.ops), 'planning is deterministic');
  checkPlanInvariants(res, 'purity');
  assertEq(kinds(res).join(','), 'removeFromPipe,placeOnPipe,tuneParams',
    'removal → placement → tune');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
