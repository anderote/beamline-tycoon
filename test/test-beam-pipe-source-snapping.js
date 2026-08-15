// test/test-beam-pipe-source-snapping.js — source flanges are the beam-pipe
// gesture's visible, magnetic handles.
//
// Defends the input contract below the browser event binding:
//   1. Live picking measures against the projected flange at beam height, not
//      its ground shadow, and uses a fixed pixel-radius target.
//   2. The idle direct-manipulation query only returns source beam ports.
//   3. Hover and drag previews land on the exact port coordinate.
//   4. A casual diagonal hand motion stays locked to the source's beam axis.
//   5. BeamlineTool picks down/move/up on the plane where pipes are rendered.

import { BeamlineInputController } from '../src/input/BeamlineInputController.js';
import { BeamlineTool } from '../src/input/beamline-tool.js';
import { BEAM_PIPE_Y } from '../src/beamline/pipe-geometry.js';
import { portWorldPosition } from '../src/beamline/junctions.js';
import { gridToIso } from '../src/renderer/grid.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function placeable(id, type, col, row, dir = 0) {
  return { id, type, col, row, subCol: 0, subRow: 0, dir };
}

function projectedRenderer(scale = 10) {
  return {
    worldToScreen: (x, y, z) => ({ x: x * scale, y: z * scale - y * 100 }),
    renderBeamPipePreview() {},
    clearDragPreview() {},
  };
}

function controllerWith(placeables, renderer = projectedRenderer()) {
  return new BeamlineInputController({
    game: { state: { placeables, beamPipes: [] }, log() {} },
    renderer,
    inputHandler: { placementDir: 0 },
  });
}

function beamPortPoint(p, name) {
  const pos = portWorldPosition(p, name);
  return {
    pos,
    path: { col: (pos.x - 1) / 2, row: (pos.z - 1) / 2 },
    iso: gridToIso(pos.x / 2, pos.z / 2),
  };
}

console.log('\n--- 1. The drawn source flange, not its shadow, is the grab target ---');
{
  const source = placeable('src', 'source', 2, 2);
  const renderer = projectedRenderer();
  const ctrl = controllerWith([source], renderer);
  const exit = beamPortPoint(source, 'exit');
  const flangePx = renderer.worldToScreen(exit.pos.x, BEAM_PIPE_Y, exit.pos.z);
  const shadowPx = renderer.worldToScreen(exit.pos.x, 0, exit.pos.z);

  const onFlange = ctrl.findSourcePortAt(exit.iso.x, exit.iso.y, flangePx);
  const onShadow = ctrl.findSourcePortAt(exit.iso.x, exit.iso.y, shadowPx);
  assert(onFlange?.junctionId === source.id && onFlange?.portName === 'exit',
    'the visible source exit flange starts a beam-pipe gesture');
  assert(!onShadow, 'the same port is not acquired from its bare-floor shadow');

  ctrl.onPipeToolHover(exit.iso.x, exit.iso.y, flangePx);
  assert(ctrl.hoverValidAnchor === true, 'hovering the visible flange is a valid anchor');
  assert(ctrl.hoverPoint?.col === exit.path.col && ctrl.hoverPoint?.row === exit.path.row,
    'the hover marker snaps onto the exact flange coordinate');
}

console.log('\n--- 2. Idle direct manipulation is source-only ---');
{
  const cup = placeable('cup', 'faradayCup', 2, 6);
  const renderer = projectedRenderer();
  const ctrl = controllerWith([cup], renderer);
  const entry = beamPortPoint(cup, 'entry');
  const entryPx = renderer.worldToScreen(entry.pos.x, BEAM_PIPE_Y, entry.pos.z);
  assert(!ctrl.findSourcePortAt(entry.iso.x, entry.iso.y, entryPx),
    'an endpoint port does not steal an idle selection click');
}

console.log('\n--- 3. Preview acquires the exact destination and locks to the beam axis ---');
{
  const source = placeable('src', 'source', 2, 2);
  const cup = placeable('cup', 'faradayCup', 2, 6);
  // The cup is two subcells wide; centre it on the source's four-subcell axis.
  cup.subCol = 1;
  const renderer = projectedRenderer();
  const ctrl = controllerWith([source, cup], renderer);
  const exit = beamPortPoint(source, 'exit');
  const entry = beamPortPoint(cup, 'entry');
  const exitPx = renderer.worldToScreen(exit.pos.x, BEAM_PIPE_Y, exit.pos.z);
  const entryPx = renderer.worldToScreen(entry.pos.x, BEAM_PIPE_Y, entry.pos.z);

  ctrl.onMouseDown(exit.iso.x, exit.iso.y, 0, 'drift', exitPx);
  assert(ctrl.isActive(), 'pressing the source flange begins the draw');

  // Deliberately hand the controller an unrelated ground/plane coordinate;
  // the projected screen point is the visible cup flange, so it must win.
  const offTarget = gridToIso(20, 20);
  ctrl.onMouseMove(offTarget.x, offTarget.y, entryPx);
  const snappedEnd = ctrl.drawPath.at(-1);
  assert(snappedEnd?.col === entry.path.col && snappedEnd?.row === entry.path.row,
    'the live preview terminates exactly at the acquired destination flange');

  // Move off every flange on a diagonal. The source's exit faces +row, so a
  // natural imperfect drag must preserve the source port's column.
  const diagonal = gridToIso(exit.pos.x / 2 + 2, exit.pos.z / 2 + 3);
  ctrl.onMouseMove(diagonal.x, diagonal.y, { x: 9999, y: 9999 });
  assert(ctrl.drawPath.every(p => p.col === exit.path.col),
    'a diagonal hand motion remains on the source output axis');
}

console.log('\n--- 4. The beamline tool picks on the rendered pipe plane ---');
{
  const heights = [];
  let active = false;
  const renderer = {
    screenToWorld: (x, y) => ({ x, y }),
    screenToWorldAtHeight: (x, y, height) => {
      heights.push(height);
      return { x, y };
    },
    updateHover() {},
  };
  const ctrl = {
    isActive: () => active,
    onMouseDown() { active = true; },
    onMouseMove() {},
    onMouseUp() { active = false; },
  };
  const ctx = {
    renderer,
    input: { beamlineController: ctrl },
    game: {},
  };
  const tool = new BeamlineTool('drift');
  tool.onMouseDown({ clientX: 10, clientY: 20, button: 0 }, ctx);
  tool.onMouseMove({ clientX: 30, clientY: 40 }, ctx);
  tool.onMouseUp({ clientX: 30, clientY: 40, button: 0 }, ctx);
  assert(heights.length === 3, `down/move/up all use the pipe plane (got ${heights.length})`);
  assert(heights.every(height => height === BEAM_PIPE_Y),
    `every pick uses the shared ${BEAM_PIPE_Y} m beam-axis height`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
