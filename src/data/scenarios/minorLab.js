// Minor Lab — canonical authored baseline.
//
// Source: the newest Minor Lab Scenario Admin export in Downloads on
// 2026-08-22 (`minorLab4.scenario (3).json`, SHA-256
// 794e9189b7583f66d1aba1b11a1b1fef3d6f879c0e342f30f68eee251206b97a).
// Only the top-level scenario id was changed, from `minorLab4` to the stable
// built-in identity `minorLab`; the complete exported world data is preserved.

import MINOR_LAB_BASE from './minorLab.base.json' with { type: 'json' };
import { wireUtility } from './scenario-wiring.js';

export function generateMinorLab() {
  // Game.applyScenario owns and normalizes the arrays it receives. Return a
  // fresh graph on every launch so editing one Minor Lab never mutates the
  // imported module singleton or a later New Game session.
  return JSON.parse(JSON.stringify(MINOR_LAB_BASE.data));
}

/**
 * The export captured an unfinished cable gesture: `ul_261` leaves the main
 * panel's sixth branch socket and `ul_693` leaves the monitor-bank inlet, but
 * their free ends never joined. Replace those two authored dangling halves
 * with the single connection they describe. No other world data is changed.
 */
export function setupMinorLab(game) {
  for (const lineId of ['ul_261', 'ul_693']) {
    game.utilityLineSystem?.removeLine(lineId);
  }
  return wireUtility(
    game,
    'powerCable',
    { id: 'in_118', role: 'source', index: 5 },
    { id: 'fn_26', role: 'sink' },
  );
}
