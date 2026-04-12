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

// --- 4. Length conservation. A module occupying tileLen tiles removes
//     (tileLen + 1) tile-spacings worth of pipe from the original, i.e.
//     (tileLen + 1) * 4 sub-units. The module's own subL is separate from
//     the pipe accounting — it represents the active element's length,
//     not the tile footprint.
const placeable = PLACEABLES[quadType];
const tileLen = Math.max(1, Math.ceil(placeable.subL / 4));
const expectedRemovedSubL = (tileLen + 1) * 4;
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
