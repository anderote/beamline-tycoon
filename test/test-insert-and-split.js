// test/test-insert-and-split.js — integration test for tryInsertOnBeamPipe
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame() {
  const registry = new BeamlineRegistry();
  const g = new Game(registry);
  // Give the player enough resources to build anything.
  g.state.resources.funding = 1e9;
  return g;
}

// Find available types in the registry.
const sourceType = 'source';            // single-port source at subL=4
const quadType   = 'pillboxCavity';     // two-port module, subL=2, subW=3
const dumpType   = 'faradayCup';        // single-port endpoint at subL=4

assert(COMPONENTS[sourceType] && COMPONENTS[sourceType].isSource, `source type resolved (${sourceType})`);
assert(COMPONENTS[quadType]   && COMPONENTS[quadType].ports.entry && COMPONENTS[quadType].ports.exit, `quad type resolved (${quadType})`);
assert(COMPONENTS[dumpType]   && COMPONENTS[dumpType].ports.entry, `endpoint type resolved (${dumpType})`);

// --- 1. Build: source at (2,2) → faraday cup at (2,12), pipe (2,4)→(2,11).
const g = makeGame();
const sourceId = g.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
assert(sourceId, 'source placed');
const dumpId = g.placePlaceable({ type: dumpType, col: 2, row: 12, subCol: 0, subRow: 0, dir: 0 });
assert(dumpId, 'endpoint placed');

const path = [{ col: 2, row: 4 }, { col: 2, row: 11 }];
const sourcePort = Object.keys(COMPONENTS[sourceType].ports).find(k => COMPONENTS[sourceType].ports[k].side === 'front');
const dumpPort   = Object.keys(COMPONENTS[dumpType].ports).find(k => COMPONENTS[dumpType].ports[k].side === 'back');
const ok = g.createBeamPipe(sourceId, sourcePort, dumpId, dumpPort, path);
assert(ok, 'pipe created');
assert(g.state.beamPipes.length === 1, 'exactly one pipe');
const originalSubL = g.state.beamPipes[0].subL;

// --- 2. Insert a quadrupole at (2,7) with dir=0 (aligned with +row pipe).
const quadId = g.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 7, dir: 0 });
assert(quadId, 'quadrupole inserted via tryInsertOnBeamPipe');

// --- 3. Verify the pipe was split into two pipes.
assert(g.state.beamPipes.length === 2, `pipe count is now 2 (got ${g.state.beamPipes.length})`);

const p1 = g.state.beamPipes.find(p => p.toId === quadId);
const p2 = g.state.beamPipes.find(p => p.fromId === quadId);
assert(p1 && p1.fromId === sourceId, 'p1 connects source → quad');
assert(p2 && p2.toId === dumpId, 'p2 connects quad → dump');
assert(p1.toPort && COMPONENTS[quadType].ports[p1.toPort]?.side === 'back', 'p1 attaches to module entry (back) port');
assert(p2.fromPort && COMPONENTS[quadType].ports[p2.fromPort]?.side === 'front', 'p2 attaches to module exit (front) port');

// --- 4. Length conservation. The pipe split uses the module's world-space
//     footprint to find the exact split indices, and includes the trailing
//     edge entry for the 3D renderer to cut at the module boundary.
const placeable = PLACEABLES[quadType];
const tileLen = Math.max(1, placeable.subL);
const expectedRemovedSubL = tileLen;
const remainingSubL = p1.subL + p2.subL;
assert(
  Math.abs(remainingSubL - (originalSubL - expectedRemovedSubL)) <= 1,
  `length conservation: p1(${p1.subL}) + p2(${p2.subL}) = ${remainingSubL}, expected ${originalSubL - expectedRemovedSubL}`
);

// --- 5. Insertion at a bad rotation (dir=1) on a fresh setup should fail.
const g2 = makeGame();
const s2 = g2.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
const d2 = g2.placePlaceable({ type: dumpType, col: 2, row: 12, subCol: 0, subRow: 0, dir: 0 });
g2.createBeamPipe(s2, sourcePort, d2, dumpPort, [{ col: 2, row: 4 }, { col: 2, row: 11 }]);
const bad = g2.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 7, dir: 1 });
assert(bad === null, 'mismatched rotation returns null');
assert(g2.state.beamPipes.length === 1, 'pipe unchanged on failed insert');

// --- Fix 1: Rollback atomicity test ---
// Monkey-patch beamPipes.push to throw after the first successful push (p1
// was pushed but p2 will trigger the error), simulating a failure mid-step 12.
{
  const gr = makeGame();
  const sr = gr.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
  const dr = gr.placePlaceable({ type: dumpType,   col: 2, row: 12, subCol: 0, subRow: 0, dir: 0 });
  gr.createBeamPipe(sr, sourcePort, dr, dumpPort, [{ col: 2, row: 4 }, { col: 2, row: 11 }]);
  const origPipeId = gr.state.beamPipes[0].id;

  // Monkey-patch: throw on the push of the two new half-pipes (step 12).
  // The insert code calls push(p1, p2) as one call so we throw on the
  // first (and only) push that happens inside steps 10-13.
  let pushCount = 0;
  const origPush = Array.prototype.push;
  gr.state.beamPipes.push = function (...args) {
    pushCount++;
    if (pushCount === 1) throw new Error('simulated push failure for rollback test');
    return origPush.apply(this, args);
  };

  const rollbackResult = gr.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 7, dir: 0 });

  // Restore the real push before further assertions.
  gr.state.beamPipes.push = origPush;

  assert(rollbackResult === null, 'rollback: tryInsertOnBeamPipe returns null on mid-step failure');
  assert(gr.state.beamPipes.length === 1, `rollback: exactly one pipe in state (got ${gr.state.beamPipes.length})`);
  assert(gr.state.beamPipes[0].id === origPipeId, 'rollback: original pipe restored by id');
  assert(gr.state.beamPipes[0].fromId === sr, 'rollback: original pipe fromId intact');
  assert(gr.state.beamPipes[0].toId === dr, 'rollback: original pipe toId intact');
  // The module should not be in state (removePlaceable was called in the catch).
  const moduleAfterRollback = gr.state.placeables.find(p => p.kind === 'beamline' && p.type === quadType);
  assert(!moduleAfterRollback, 'rollback: module not in state after rollback');
}

// --- Fix 2: Attachment precision test ---
// Create a pipe with two attachments, insert a module in the middle, and verify
// that the attachments end up on the right half-pipes with sub-unit precision.
{
  const ga = makeGame();
  const sa = ga.placePlaceable({ type: sourceType, col: 2, row: 2,  subCol: 0, subRow: 0, dir: 0 });
  const da = ga.placePlaceable({ type: dumpType,   col: 2, row: 14, subCol: 0, subRow: 0, dir: 0 });
  // Path (2,4)→(2,13): 10 tiles (indices 0..9), tileDist=9, subL=36
  ga.createBeamPipe(sa, sourcePort, da, dumpPort, [{ col: 2, row: 4 }, { col: 2, row: 13 }]);
  const attPipe = ga.state.beamPipes[0];
  assert(attPipe.subL === 36, `attachment precision: pipe subL should be 36 (got ${attPipe.subL})`);

  // Add two attachments: one near 0.2 and one near 0.8.
  attPipe.attachments.push({ id: 'att_test_a', position: 0.2, type: 'bpm' });
  attPipe.attachments.push({ id: 'att_test_b', position: 0.8, type: 'bpm' });

  // Insert at tile (2,9) — expandPipePath is now sub-tile (0.25-step).
  // Expanded tiles: {2,4},{2,4.25},...,{2,13} = 37 entries.
  // tileIndex for row=9: index 20, tileLen = subL = 2.
  // halfBefore = floor(2/2) = 1, startIdx = 19, endIdx = 20.
  // moduleSubStart = 19, moduleSubEnd = 21.
  // att_a: absSub = 0.2*36 = 7.2 < 19 → p1, newPos = 7.2/p1.subL
  // att_b: absSub = 0.8*36 = 28.8 > 21 → p2, newPos = (28.8-21)/p2.subL
  const insertResultA = ga.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 0 });
  assert(insertResultA, 'attachment precision: insertion succeeded');

  const pa1 = ga.state.beamPipes.find(p => p.toId === insertResultA);
  const pa2 = ga.state.beamPipes.find(p => p.fromId === insertResultA);
  assert(pa1 && pa1.attachments.length === 1, `attachment precision: p1 has 1 attachment (got ${pa1?.attachments?.length})`);
  assert(pa2 && pa2.attachments.length === 1, `attachment precision: p2 has 1 attachment (got ${pa2?.attachments?.length})`);

  // att_a should be on p1. Its original absSub = 7.2; p1 covers sub-units 0..20, subL=20.
  // Expected newPos = 7.2/20 = 0.36.
  const attA = pa1.attachments[0];
  const expectedPosA = 7.2 / pa1.subL;
  assert(Math.abs(attA.position - expectedPosA) < 0.02,
    `attachment precision: att_a position ${attA.position.toFixed(4)} ≈ ${expectedPosA.toFixed(4)} (within 0.02)`);

  // att_b should be on p2. Its original absSub = 28.8; moduleSubEnd=21, p2 covers remainder.
  const attB = pa2.attachments[0];
  // moduleSubEnd = endIdx + 1 = 21 (sub-tile entries, 1 entry = 1 sub-unit)
  const moduleSubEnd = 21;
  const expectedPosB = (0.8 * 36 - moduleSubEnd) / pa2.subL;
  assert(Math.abs(attB.position - expectedPosB) < 0.02,
    `attachment precision: att_b position ${attB.position.toFixed(4)} ≈ ${expectedPosB.toFixed(4)} (within 0.02)`);
}

// --- Fix 3a: Corner rejection ---
// An L-bend pipe; inserting at the corner tile should return null.
{
  const gc = makeGame();
  const sc = gc.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
  // Place endpoints for the two arms of the L.
  // We'll use beamStop as a second endpoint on the +col arm.
  const stopType = 'beamStop';
  const stopPort = Object.keys(COMPONENTS[stopType].ports).find(k => COMPONENTS[stopType].ports[k].side === 'back');
  const bc = gc.placePlaceable({ type: stopType, col: 8, row: 8, subCol: 0, subRow: 0, dir: 1 });
  assert(bc, 'corner test: beamStop placed');
  // L-bend pipe: (2,4)→(2,8)→(6,8)
  const lPath = [{ col: 2, row: 4 }, { col: 2, row: 8 }, { col: 6, row: 8 }];
  gc.createBeamPipe(sc, sourcePort, bc, stopPort, lPath);
  assert(gc.state.beamPipes.length === 1, 'corner test: pipe created');
  const pipeBefore = gc.state.beamPipes[0];

  // Try to insert at (2,8) — the corner tile.
  const cornerResult = gc.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 8, dir: 0 });
  assert(cornerResult === null, 'corner rejection: insert at corner returns null');
  assert(gc.state.beamPipes.length === 1, 'corner rejection: pipe count unchanged');
  assert(gc.state.beamPipes[0].id === pipeBefore.id, 'corner rejection: original pipe unchanged');
}

// --- Fix 3b: Footprint collision with another placeable ---
// Place an rfCoupler (1 sub-cell, infrastructure) on a tile that would be inside
// the module footprint. The insert should return null.
{
  const gf = makeGame();
  const sf = gf.placePlaceable({ type: sourceType, col: 2, row: 2,  subCol: 0, subRow: 0, dir: 0 });
  const df = gf.placePlaceable({ type: dumpType,   col: 2, row: 14, subCol: 0, subRow: 0, dir: 0 });
  gf.createBeamPipe(sf, sourcePort, df, dumpPort, [{ col: 2, row: 4 }, { col: 2, row: 13 }]);
  const pipeBefore2 = gf.state.beamPipes[0];

  // Place an rfCoupler right at (2,9) subCell (0,0) — this is inside the
  // footprint that pillboxCavity would need when inserted at (2,9) dir=0.
  const obstacleId = gf.placePlaceable({ type: 'rfCoupler', col: 2, row: 9, subCol: 0, subRow: 0, dir: 0 });
  assert(obstacleId, 'footprint collision test: rfCoupler placed as obstacle');

  const collisionResult = gf.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 0 });
  assert(collisionResult === null, 'footprint collision: insert returns null when footprint is occupied');
  assert(gf.state.beamPipes.length === 1, 'footprint collision: pipe count unchanged');
  assert(gf.state.beamPipes[0].id === pipeBefore2.id, 'footprint collision: original pipe unchanged');
  assert(gf.state.placeables.some(p => p.id === obstacleId), 'footprint collision: obstacle still in state');
}

// --- Fix 3c: Rotation mismatch — all four directions on a +row pipe ---
// A pipe running along +row (col constant). dir=0 axis is +row, dir=2 is -row.
// Both should succeed (pipes are undirected). dir=1 (+col) and dir=3 (-col)
// should fail.
{
  const makeG3 = () => {
    const g3 = makeGame();
    const s3 = g3.placePlaceable({ type: sourceType, col: 2, row: 2,  subCol: 0, subRow: 0, dir: 0 });
    const d3 = g3.placePlaceable({ type: dumpType,   col: 2, row: 14, subCol: 0, subRow: 0, dir: 0 });
    g3.createBeamPipe(s3, sourcePort, d3, dumpPort, [{ col: 2, row: 4 }, { col: 2, row: 13 }]);
    return g3;
  };

  // dir=0: axis is +row — matches +row pipe. Should succeed.
  {
    const g3 = makeG3();
    const r0 = g3.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 0 });
    assert(r0 !== null, 'rotation: dir=0 on +row pipe succeeds');
    assert(g3.state.beamPipes.length === 2, 'rotation: dir=0 splits pipe into 2');
  }

  // dir=2: axis is -row — opposite of +row, but pipes are undirected. Should succeed.
  {
    const g3 = makeG3();
    const r2 = g3.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 2 });
    assert(r2 !== null, 'rotation: dir=2 (reverse) on +row pipe succeeds (undirected)');
    assert(g3.state.beamPipes.length === 2, 'rotation: dir=2 splits pipe into 2');
  }

  // dir=1: axis is +col — perpendicular to +row pipe. Should fail.
  {
    const g3 = makeG3();
    const r1 = g3.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 1 });
    assert(r1 === null, 'rotation: dir=1 (+col) on +row pipe rejected');
    assert(g3.state.beamPipes.length === 1, 'rotation: dir=1 leaves pipe unchanged');
  }

  // dir=3: axis is -col — perpendicular to +row pipe. Should fail.
  {
    const g3 = makeG3();
    const r3 = g3.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 3 });
    assert(r3 === null, 'rotation: dir=3 (-col) on +row pipe rejected');
    assert(g3.state.beamPipes.length === 1, 'rotation: dir=3 leaves pipe unchanged');
  }
}

// --- Fix 4: Dense sub-tile pipe path (as created by the game UI) ---
// Pipe paths drawn in-game use 0.25-step dense format. This test verifies
// that tryInsertOnBeamPipe works with dense paths, not just waypoint paths.
{
  const gd = makeGame();
  const sd = gd.placePlaceable({ type: sourceType, col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 });
  const dd = gd.placePlaceable({ type: dumpType, col: 2, row: 14, subCol: 0, subRow: 0, dir: 0 });

  // Build a dense 0.25-step path (matching _buildStraightPath output)
  const densePath = [];
  for (let r = 4; r <= 13; r += 0.25) {
    densePath.push({ col: 2, row: r });
  }
  gd.createBeamPipe(sd, sourcePort, dd, dumpPort, densePath);
  assert(gd.state.beamPipes.length === 1, 'dense path: pipe created');

  const insertId = gd.tryInsertOnBeamPipe({ type: quadType, col: 2, row: 9, dir: 0 });
  assert(insertId !== null, 'dense path: module inserted on dense sub-tile pipe');
  assert(gd.state.beamPipes.length === 2, `dense path: pipe split into 2 (got ${gd.state.beamPipes.length})`);

  const dp1 = gd.state.beamPipes.find(p => p.toId === insertId);
  const dp2 = gd.state.beamPipes.find(p => p.fromId === insertId);
  assert(dp1 && dp1.fromId === sd, 'dense path: p1 connects source → module');
  assert(dp2 && dp2.toId === dd, 'dense path: p2 connects module → dump');
}

// --- Source insertion on pipe: cut gap, connect exit to forward pipe ---
{
  const gs = makeGame();
  gs.createBeamPipe(null, null, null, null, [{ col: 2, row: 2 }, { col: 2, row: 13 }]);
  assert(gs.state.beamPipes.length === 1, 'source-insert: pipe created');

  // Insert a source mid-pipe. Both halves should survive, but only the
  // forward half connects to the source's exit port.
  const srcId = gs.tryInsertOnBeamPipe({ type: sourceType, col: 2, row: 6, dir: 0 });
  assert(srcId !== null, 'source-insert: source placed on pipe');
  assert(gs.state.beamPipes.length === 2, `source-insert: 2 pipes remain (got ${gs.state.beamPipes.length})`);
  const srcDef = COMPONENTS[sourceType];
  const srcExitPort = Object.entries(srcDef.ports).find(([, p]) => p.side === 'front')[0];
  // One pipe should connect FROM source (exit), the other is disconnected.
  const connected = gs.state.beamPipes.find(p => p.fromId === srcId);
  const disconnected = gs.state.beamPipes.find(p => p.fromId !== srcId && p.toId !== srcId);
  assert(connected !== undefined, 'source-insert: forward pipe connects FROM source');
  assert(connected.fromPort === srcExitPort, 'source-insert: forward pipe uses exit port');
  assert(disconnected !== undefined, 'source-insert: backward pipe kept as disconnected');
}

// --- Endpoint insertion on pipe: cut gap, connect entry to backward pipe ---
{
  const ge = makeGame();
  ge.createBeamPipe(null, null, null, null, [{ col: 2, row: 2 }, { col: 2, row: 13 }]);
  assert(ge.state.beamPipes.length === 1, 'endpoint-insert: pipe created');

  const endId = ge.tryInsertOnBeamPipe({ type: dumpType, col: 2, row: 7, dir: 0 });
  assert(endId !== null, 'endpoint-insert: endpoint placed on pipe');
  assert(ge.state.beamPipes.length === 2, `endpoint-insert: 2 pipes remain (got ${ge.state.beamPipes.length})`);
  const dumpDef = COMPONENTS[dumpType];
  const dumpEntryPort = Object.entries(dumpDef.ports).find(([, p]) => p.side === 'back')[0];
  // One pipe should connect TO endpoint (entry), the other is disconnected.
  const connected = ge.state.beamPipes.find(p => p.toId === endId);
  const disconnected = ge.state.beamPipes.find(p => p.fromId !== endId && p.toId !== endId);
  assert(connected !== undefined, 'endpoint-insert: backward pipe connects TO endpoint');
  assert(connected.toPort === dumpEntryPort, 'endpoint-insert: backward pipe uses entry port');
  assert(disconnected !== undefined, 'endpoint-insert: forward pipe kept as disconnected');
}

// --- Pipe overlap prevention ---
{
  const go = makeGame();
  go.createBeamPipe(null, null, null, null, [{ col: 2, row: 2 }, { col: 2, row: 6 }]);
  assert(go.state.beamPipes.length === 1, 'overlap: initial pipe created');
  // Draw a pipe that partially overlaps the existing one.
  const ok = go.createBeamPipe(null, null, null, null, [{ col: 2, row: 4 }, { col: 2, row: 8 }]);
  assert(ok === true, 'overlap: partial overlap pipe created (gap-fill)');
  assert(go.state.beamPipes.length === 2, `overlap: now 2 pipes (got ${go.state.beamPipes.length})`);
  // The new pipe should only contain the uncovered portion (row 6 to 8).
  const newPipe = go.state.beamPipes[1];
  const newStart = newPipe.path[0];
  const newEnd = newPipe.path[newPipe.path.length - 1];
  // The start should be around row 6 (end of existing pipe) not row 4.
  assert(newStart.row >= 5.75, `overlap: new pipe starts past existing (row ${newStart.row})`);
  // Drawing fully overlapping pipe should fail (nothing new to add).
  const nope = go.createBeamPipe(null, null, null, null, [{ col: 2, row: 3 }, { col: 2, row: 5 }]);
  assert(nope === false, 'overlap: fully covered pipe rejected');
  assert(go.state.beamPipes.length === 2, 'overlap: pipe count unchanged after rejection');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
