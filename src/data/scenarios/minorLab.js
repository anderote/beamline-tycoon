// Minor Lab — canonical authored baseline.
//
// Source: the most recent Minor Lab Scenario Admin export in Downloads on
// 2026-08-22 (`minorLab.scenario (19).json`, SHA-256
// 33a91472b136ab19d5926a67175dd32c3296ab3d555a1ea9d33339453ebc7073).
// It already uses the stable built-in `minorLab` identity. One disconnected
// `switchgear` record from a retired component was removed; the authored
// layout is otherwise preserved (data graph SHA-256
// 08781412bb28e387c24111afe4b0e836863329063d1e7358a70bf35c662762a7).

import MINOR_LAB_BASE from './minorLab.base.json' with { type: 'json' };
import { wireUtility } from './scenario-wiring.js';

export function generateMinorLab() {
  // Game.applyScenario owns and normalizes the arrays it receives. Return a
  // fresh graph on every launch so editing one Minor Lab never mutates the
  // imported module singleton or a later New Game session.
  return JSON.parse(JSON.stringify(MINOR_LAB_BASE.data));
}

/**
 * Complete the seven loose utility gestures in the authored export. Keeping
 * these repairs outside the snapshot preserves the downloaded world verbatim,
 * while every fresh Minor Lab still starts with both beamlines serviceable.
 */
export function setupMinorLab(game) {
  const hotPipe = { waterCircuit: 'hot' };
  const coldWater = { waterCircuit: 'cold' };
  const hotWater = { waterCircuit: 'hot' };

  // Close the two new chillers' condenser loops into the authored tower bank.
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_1549', role: 'sink', side: 'front', index: 1 },
    { id: 'in_1551', role: 'source', side: 'right', index: 0 }, hotPipe);
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_1550', role: 'sink', side: 'front', index: 1 },
    { id: 'in_1552', role: 'source', side: 'right', index: 0 }, hotPipe);

  // Each beam-room manifold's fourth pair is the intended target branch.
  wireUtility(game, 'coolingWater',
    { id: 'in_1562', role: 'source', side: 'right', index: 6 },
    { id: 'bl_15', role: 'sink', side: 'left', index: 0 }, coldWater);
  wireUtility(game, 'coolingWater',
    { id: 'bl_15', role: 'sink', side: 'left', index: 1 },
    { id: 'in_1562', role: 'source', side: 'right', index: 7 }, hotWater);
  wireUtility(game, 'coolingWater',
    { id: 'in_1518', role: 'source', side: 'right', index: 6 },
    { id: 'bl_17', role: 'sink', side: 'left', index: 0 }, coldWater);
  wireUtility(game, 'coolingWater',
    { id: 'bl_17', role: 'sink', side: 'left', index: 1 },
    { id: 'in_1518', role: 'source', side: 'right', index: 7 }, hotWater);

  // The lower beamline's BPM is the only data sink not already on the rack bus.
  return wireUtility(game, 'dataFiber',
    { id: 'fn_4', role: 'pass', side: 'front', index: 0 },
    { id: 'pl_12', role: 'sink', side: 'right', index: 0 });
}
