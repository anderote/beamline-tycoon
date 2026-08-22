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
  // three paired return headers. Their authored blue and red halves keep
  // supply and return unmistakable.
  // Rigid hot-water pipe carries the collected heat through sealed
  // wall sleeves to the existing cooling tower yard.
  const place = (type, col, row, extra = {}) => game.placePlaceable({
    type, col, row, free: true, silent: true, ...extra,
  });
  const upperFourLine = place('waterDistributor4', -5, 8);
  const upperTwoLine = place('waterDistributor2', -1, 8);
  const lowerFourLine = place('waterDistributor4', -9, 0);
  const lowerTwoLine = place('waterDistributor4', -5, 0);
  const upperColdDistributor = place('waterDistributor4', -9, 8);
  const lowerColdDistributor = place('waterDistributor4', 0, 5);
  const fourLineHeader = id => ({
    id, waterPorts: ['water_line_3', 'water_line_4'], supplyPort: 'supply_pipe_2',
  });
  const twoLineHeader = id => ({
    id, waterPorts: ['water_line_2'], supplyPort: 'supply_pipe_2',
  });
  const upperHeaders = [
    fourLineHeader(upperFourLine), twoLineHeader(upperTwoLine),
    fourLineHeader(upperColdDistributor),
  ];
  const lowerHeaders = [
    fourLineHeader(lowerFourLine), fourLineHeader(lowerTwoLine),
    fourLineHeader(lowerColdDistributor),
  ];
  const sleeve = row => place('waterSupplyWallPassThrough1x1', 2, row, {
    wallMount: { col: 2, row, edge: 'e', off: 1 },
  });
  const upperSleeves = [sleeve(6), sleeve(7), sleeve(8)];
  const lowerSleeves = [sleeve(2), sleeve(3), sleeve(4)];

  const connectReturns = (loads, headers) => {
    const outlets = headers.flatMap(header => header.waterPorts.map(port => ({
      header, port,
    })));
    loads.forEach((id, index) => {
      const { header, port } = outlets[index];
      const connected = wireUtility(game, 'coolingWater', { id, port: 'hot_out' }, {
        id: header.id, port,
      }, { waterCircuit: 'hot' });
      // The upper room's first quadrupole is boxed in by its legacy cold hose.
      // The spare socket on the third return header gives the obstacle-aware
      // router a clean approach without crossing the room wall.
      if (!connected) {
        wireUtility(game, 'coolingWater', { id, port: 'hot_out' }, {
          id: outlets.at(-1).header.id, port: outlets.at(-1).port,
        }, { waterCircuit: 'hot' });
      }
    });
  };
  connectReturns(['pl_3', 'pl_2', 'pl_1', 'bl_14', 'bl_15'], upperHeaders);
  connectReturns(['pl_9', 'pl_8', 'pl_7', 'bl_16', 'bl_17'], lowerHeaders);

  // The upper target's red fitting lands exactly on the hot hose already
  // serving the adjacent compact distributor. Its equipment envelope leaves
  // no separate approach corridor, so commit the physically correct tee at
  // that coincident point instead of pretending a second parallel hose fits.
  const upperTargetConnected = [...game.state.utilityLines.values()].some(line =>
    line.utilityType === 'coolingWater'
      && [line.start, line.end].some(ref =>
        ref?.placeableId === 'bl_15' && ref.portName === 'hot_out'));
  if (!upperTargetConnected) {
    const hotTrunk = [...game.state.utilityLines.values()].find(line =>
      line.utilityType === 'coolingWater' && line.waterCircuit === 'hot'
        && [line.start, line.end].some(ref =>
          ref?.placeableId === upperTwoLine && ref.portName === 'water_line_2'));
    if (hotTrunk) {
      game.utilityLineSystem?.addLine({
        utilityType: 'coolingWater', waterCircuit: 'hot',
        start: { placeableId: 'bl_15', portName: 'hot_out' }, end: null,
        path: [{ col: -0.5, row: 8 }, { col: -0.25, row: 8 }],
        cablePath: [{ col: -0.5, row: 8 }, { col: -0.25, row: 8 }],
        tapLineIds: { start: hotTrunk.id },
      });
    }
  }

  const hotPipe = { waterCircuit: 'hot' };
  const coldPipe = { waterCircuit: 'cold' };
  const roomPipe = { waterCircuit: 'room' };
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
    ['in_112', 'hot_in'],
    ['in_112', 'hot_in'],
    ['in_244', 'hot_in'],
  ];
  const lowerRejection = [
    ['in_113', 'hot_in'],
    ['in_113', 'hot_in'],
    ['in_244', 'hot_in'],
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

  // Close the central plant chain: each heat-rejection bank returns green
  // room-temperature water to the matching chiller, which then produces the
  // blue cold header used above.
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_112', port: 'room_out' },
    { id: 'in_90', port: 'room_in' }, roomPipe);
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_113', port: 'room_out' },
    { id: 'in_91', port: 'room_in' }, roomPipe);
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_116', port: 'room_out' },
    { id: 'in_234', port: 'room_in' }, roomPipe);
  wireUtility(game, 'waterSupplyPipe',
    { id: 'in_117', port: 'room_out' },
    { id: 'in_235', port: 'room_in' }, roomPipe);

  return powerRepair;
}
