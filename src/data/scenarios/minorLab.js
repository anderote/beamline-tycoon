// Minor Lab — canonical authored baseline.
//
// Source: the newest Minor Lab Scenario Admin export in Downloads on
// 2026-08-22 (`minorLab4.scenario (3).json`, SHA-256
// 794e9189b7583f66d1aba1b11a1b1fef3d6f879c0e342f30f68eee251206b97a).
// The top-level scenario id was changed from `minorLab4` to the stable built-in
// identity `minorLab`. Its power distribution nodes were subsequently migrated
// to the current panel topology; the authored facility layout remains otherwise
// preserved (data graph SHA-256
// 4dc3972a1de6dcc5598f5a734b7dcb460f380800f70b39bfb3324251f10a6337).

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
  // three 2:1 return headers. Each room uses one dual four-line distributor
  // plus one two-line distributor, matching the compact one-sided catalogue
  // layouts. Rigid hot-water pipe carries the collected heat through sealed
  // wall sleeves to the existing cooling tower yard.
  const place = (type, col, row, extra = {}) => game.placePlaceable({
    type, col, row, free: true, silent: true, ...extra,
  });
  const upperFourLine = place('waterDistributor4', -5, 8);
  const upperTwoLine = place('waterDistributor2', -1, 8);
  const lowerFourLine = place('waterDistributor4', -9, 0);
  const lowerTwoLine = place('waterDistributor2', -5, 0);
  const distributorHeaders = (fourLine, twoLine) => [
    { id: fourLine, waterPorts: ['water_line_1', 'water_line_2'], supplyPort: 'supply_pipe_1' },
    { id: fourLine, waterPorts: ['water_line_3', 'water_line_4'], supplyPort: 'supply_pipe_2' },
    { id: twoLine, waterPorts: ['water_line_1', 'water_line_2'], supplyPort: 'supply_pipe_1' },
  ];
  const upperHeaders = distributorHeaders(upperFourLine, upperTwoLine);
  const lowerHeaders = distributorHeaders(lowerFourLine, lowerTwoLine);
  const upperColdDistributor = place('waterDistributor2', -9, 8);
  const lowerColdDistributor = place('waterDistributor2', 0, 5);
  const sleeve = row => place('waterSupplyWallPassThrough1x1', 2, row, {
    wallMount: { col: 2, row, edge: 'e', off: 1 },
  });
  const upperSleeves = [sleeve(6), sleeve(7), sleeve(8)];
  const lowerSleeves = [sleeve(2), sleeve(3), sleeve(4)];

  const connectReturns = (loads, headers) => {
    loads.forEach((id, index) => {
      const header = headers[Math.floor(index / 2)];
      const connected = wireUtility(game, 'coolingWater', { id, port: 'hot_out' }, {
        id: header.id, port: header.waterPorts[index % 2],
      }, { waterCircuit: 'hot' });
      // The upper room's first quadrupole is boxed in by its legacy cold hose.
      // The spare socket on the third return header gives the obstacle-aware
      // router a clean approach without crossing the room wall.
      if (!connected) {
        wireUtility(game, 'coolingWater', { id, port: 'hot_out' }, {
          id: headers[2].id, port: headers[2].waterPorts[1],
        }, { waterCircuit: 'hot' });
      }
    });
  };
  connectReturns(['pl_3', 'pl_2', 'pl_1', 'bl_14', 'bl_15'], upperHeaders);
  connectReturns(['pl_9', 'pl_8', 'pl_7', 'bl_16', 'bl_17'], lowerHeaders);

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
  const connectHotHeaders = (headers, sleeves, rejectors) => {
    headers.forEach((header, index) => {
      wireUtility(game, 'waterSupplyPipe',
        { id: header.id, port: header.supplyPort },
        { id: sleeves[index], port: 'supply_front' }, hotPipe);
      wireUtility(game, 'waterSupplyPipe',
        { id: rejectors[index][0], port: rejectors[index][1] },
        { id: sleeves[index], port: 'supply_back' }, hotPipe);
    });
  };
  connectHotHeaders(upperHeaders, upperSleeves, upperRejection);
  connectHotHeaders(lowerHeaders, lowerSleeves, lowerRejection);

  return powerRepair;
}
