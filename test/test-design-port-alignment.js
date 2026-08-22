// Stock-design pipes must physically touch the beam ports they claim.
//
// Topology-only fidelity tests did not catch the old DesignPlacer arithmetic:
// it estimated faces from integer module anchors, while cyclotrons extract
// from the centre of a wide sub-grid footprint. The pipe was logically bound
// to `exit` but visibly missed it by up to 0.75 tile.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { portWorldPosition } from '../src/beamline/junctions.js';
import { COMPONENTS } from '../src/data/components.js';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';
import { DesignPlacer } from '../src/ui/DesignPlacer.js';

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

const EPS = 1e-9;
const stubRenderer = { _renderCursors() {} };

function portName(type, outgoing) {
  const ports = COMPONENTS[type]?.ports || {};
  if (outgoing) {
    if (ports.exit) return 'exit';
    if (ports.ringExit) return 'ringExit';
    return Object.keys(ports).filter(k => /exit/i.test(k)).sort()[0];
  }
  if (ports.entry) return 'entry';
  if (ports.linacEntry) return 'linacEntry';
  return Object.keys(ports).filter(k => k.startsWith('entry')).sort()[0];
}

function portPipePoint(placeable, outgoing) {
  const world = portWorldPosition(placeable, portName(placeable.type, outgoing));
  return world && { col: (world.x - 1) / 2, row: (world.z - 1) / 2 };
}

function samePoint(a, b) {
  return !!a && !!b
    && Math.abs(a.col - b.col) <= EPS
    && Math.abs(a.row - b.row) <= EPS;
}

console.log('\n=== Cyclotron stock-design port alignment ===\n');

const designs = STOCK_DESIGNS.filter(design =>
  design.components?.some(component => /^cyclotron(30|70|230)$/.test(component.type))
);
assert(designs.length === 9, `fixture: all 9 cyclotron blueprints are covered (got ${designs.length})`);

for (const design of designs) {
  const game = new Game(new BeamlineRegistry(), { seed: 902 });
  game.setSandboxMode(true);
  const placer = new DesignPlacer(game, stubRenderer);
  placer.start(design);
  placer.setPosition(0, 0);

  for (let rotation = 0; rotation < 4; rotation++) {
    const modules = placer.previewModules.filter(module => module.kind === 'module');
    let aligned = placer.previewPipes.length === Math.max(0, modules.length - 1);
    for (let i = 0; i < placer.previewPipes.length && aligned; i++) {
      const pipe = placer.previewPipes[i];
      aligned = samePoint(pipe.from, portPipePoint(modules[i], true))
        && samePoint(pipe.to, portPipePoint(modules[i + 1], false));
    }
    assert(aligned, `${design.id} rotation ${rotation}: every pipe touches both beam ports`);
    placer.rotate();
  }
}

// Confirm the same coordinator reaches committed game state, not only the
// ghost. One compact fixture per shipped cyclotron size is enough here; the
// stock fidelity suite separately commits all nine complete blueprints.
for (const sourceType of ['cyclotron30', 'cyclotron70']) {
  for (let rotation = 0; rotation < 4; rotation++) {
    const game = new Game(new BeamlineRegistry(), { seed: 930 + rotation });
    game.setSandboxMode(true);
    const placer = new DesignPlacer(game, stubRenderer);
    placer.start({
      name: `${sourceType} alignment fixture`,
      components: [{ type: sourceType }, { type: 'beamStop' }],
    });
    for (let turn = 0; turn < rotation; turn++) placer.rotate();

    let placed = false;
    const ext = game.state.mapHalfExtent;
    outer:
    for (let row = -ext; row <= ext; row++) {
      for (let col = -ext; col <= ext; col++) {
        placer.setPosition(col, row);
        if (placer.valid && placer.confirm()) { placed = true; break outer; }
      }
    }

    const source = game.state.placeables.find(p => p.type === sourceType);
    const endpoint = game.state.placeables.find(p => p.type === 'beamStop');
    const pipe = game.state.beamPipes[0];
    const aligned = placed && source && endpoint && pipe
      && samePoint(pipe.path[0], portPipePoint(source, true))
      && samePoint(pipe.path[pipe.path.length - 1], portPipePoint(endpoint, false));
    assert(aligned, `${sourceType} rotation ${rotation}: committed pipe lands on both ports`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
