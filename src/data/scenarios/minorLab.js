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
  const retainedColdBranches = new Set([
    'ul_621', 'ul_622', 'ul_623', 'ul_624',
    'ul_625', 'ul_626', 'ul_627', 'ul_628',
  ]);
  for (const [lineId, line] of [...game.state.utilityLines]) {
    if (line.utilityType === 'coolingWater' && !retainedColdBranches.has(lineId)) {
      game.utilityLineSystem?.removeLine(lineId);
    }
  }
  const powerRepair = wireUtility(
    game,
    'powerCable',
    { id: 'in_118', role: 'source', index: 5 },
    { id: 'fn_26', role: 'sink' },
  );

  // The imported facility predates explicit hot-water returns. Preserve its
  // working cold branches, then retrofit each of the two beam rooms with
  // three 2:1 return headers. Rigid hot-water pipe carries the collected heat
  // through sealed wall sleeves to the existing cooling tower yard.
  const place = (type, col, row, extra = {}) => game.placePlaceable({
    type, col, row, free: true, silent: true, ...extra,
  });
  const upperDistributors = [
    place('waterDistributor2', -5, 8),
    place('waterDistributor2', -3, 8),
    place('waterDistributor2', -1, 8),
  ];
  const lowerDistributors = [
    place('waterDistributor2', -9, 0),
    place('waterDistributor2', -7, 0),
    // Turn the final header so its two hose tails approach independently;
    // otherwise the target's long return fences in the adjacent quadrupole.
    place('waterDistributor2', -5, 0, { dir: 1 }),
  ];
  const upperColdDistributor = place('waterDistributor2', -9, 8);
  const lowerColdDistributor = place('waterDistributor2', 0, 5);
  const sleeve = row => place('waterSupplyWallPassThrough1x1', 2, row, {
    wallMount: { col: 2, row, edge: 'e', off: 1 },
  });
  const upperSleeves = [sleeve(6), sleeve(7), sleeve(8)];
  const lowerSleeves = [sleeve(2), sleeve(3), sleeve(4)];

  const connectReturns = (loads, distributors, preferredSlots = null) => {
    loads.forEach((id, index) => {
      const [preferredDistributorIndex, preferredPortIndex] = preferredSlots?.[index]
        || [Math.floor(index / 2), (index % 2) + 1];
      const distributor = distributors[preferredDistributorIndex];
      const preferredPort = `water_line_${preferredPortIndex}`;
      const candidates = [
        [distributor, preferredPort],
        ...distributors.flatMap(candidate => [1, 2]
          .map(portIndex => [candidate, `water_line_${portIndex}`])),
      ];
      for (const [candidate, port] of candidates) {
        if (wireUtility(game, 'coolingWater', { id, port: 'hot_out' }, {
          id: candidate, port,
        }, { waterCircuit: 'hot' })) break;
      }
    });
  };
  connectReturns(['bl_14', 'pl_1', 'pl_2', 'pl_3', 'bl_15'], upperDistributors);
  connectReturns(
    ['bl_16', 'pl_7', 'pl_8', 'pl_9', 'bl_17'],
    lowerDistributors,
    [[0, 1], [0, 2], [1, 1], [2, 1], [2, 2]],
  );

  const hotPipe = { waterCircuit: 'hot' };
  const coldPipe = { waterCircuit: 'cold' };
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_90', port: 'supply_cold_out' },
    { id: upperColdDistributor, port: 'supply_pipe_1' }, coldPipe);
  wireUtility(game, 'coolingWater',
    { id: upperColdDistributor, port: 'water_line_1' },
    { id: 'bl_15', port: 'cool_in' }, coldPipe);
  wireUtility(game, 'coolingWater',
    { id: upperColdDistributor, port: 'water_line_2' },
    { id: 'in_249', port: 'cool_in' }, coldPipe);
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_91', port: 'supply_cold_out' },
    { id: lowerColdDistributor, port: 'supply_pipe_1' }, coldPipe);
  wireUtility(game, 'coolingWater',
    { id: lowerColdDistributor, port: 'water_line_1' },
    { id: 'bl_17', port: 'cool_in' }, coldPipe);
  wireUtility(game, 'coolingWater',
    { id: lowerColdDistributor, port: 'water_line_2' },
    { id: 'in_130', port: 'cool_in' }, coldPipe);

  const upperRejection = [
    ['in_112', 'supply_hot_1'],
    ['in_112', 'supply_hot_2'],
    ['in_244', 'supply_hot_1'],
  ];
  const lowerRejection = [
    ['in_113', 'supply_hot_1'],
    ['in_113', 'supply_hot_2'],
    ['in_244', 'supply_hot_2'],
  ];
  const connectHotHeaders = (distributors, sleeves, rejectors) => {
    distributors.forEach((distributor, index) => {
      wireUtility(game, 'waterSupplyPipe',
        { id: distributor, port: 'supply_pipe_1' },
        { id: sleeves[index], port: 'supply_front' }, hotPipe);
      wireUtility(game, 'waterSupplyPipe',
        { id: rejectors[index][0], port: rejectors[index][1] },
        { id: sleeves[index], port: 'supply_back' }, hotPipe);
    });
  };
  connectHotHeaders(upperDistributors, upperSleeves, upperRejection);
  connectHotHeaders(lowerDistributors, lowerSleeves, lowerRejection);

  return powerRepair;
}
