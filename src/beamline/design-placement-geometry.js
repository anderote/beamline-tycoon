// src/beamline/design-placement-geometry.js — map geometry for a saved design.
//
// Design layout decides topology and pipe lengths. This module turns that
// ordered layout into exact junction anchors and face-to-face pipe paths. Beam
// ports, not rounded tile footprints, are the authority: wide sources such as
// cyclotrons extract from the middle of an edge, which may sit on a sub-tile
// centerline rather than the module's integer anchor row/column.

import { COMPONENTS } from '../data/components.js';
import { DIR_DELTA, reverseDir } from '../data/directions.js';
import { portSide, portWorldPosition } from './junctions.js';

const EPS = 1e-6;
const DIR_TO_COMPASS = ['N', 'E', 'S', 'W'];

function dirFromCompass(side) {
  const i = DIR_TO_COMPASS.indexOf(side);
  return i < 0 ? null : i;
}

function entryPortName(type) {
  const ports = COMPONENTS[type]?.ports || {};
  if (ports.entry) return 'entry';
  if (ports.linacEntry) return 'linacEntry';
  return Object.keys(ports).filter(k => k.startsWith('entry')).sort()[0] || 'entry';
}

function exitPortName(type) {
  const ports = COMPONENTS[type]?.ports || {};
  if (ports.exit) return 'exit';
  if (ports.ringExit) return 'ringExit';
  return Object.keys(ports).filter(k => /exit/i.test(k)).sort()[0] || 'exit';
}

function pipePoint(placeable, portName) {
  const world = portWorldPosition(placeable, portName);
  if (!world) return null;
  return {
    col: (world.x - 1) / 2,
    row: (world.z - 1) / 2,
  };
}

function splitAbsSub(value) {
  const tile = Math.floor(value / 4);
  return { tile, sub: value - tile * 4 };
}

/**
 * Find the sub-grid anchor that puts one named port at an exact pipe point.
 * Translating a placeable by one sub-unit translates every port by 0.25 pipe
 * tiles, so a zero-anchor probe makes the inverse exact and rotation-neutral.
 */
function anchorPortAt(type, dir, portName, target) {
  const probe = { type, col: 0, row: 0, subCol: 0, subRow: 0, dir };
  const origin = pipePoint(probe, portName);
  if (!origin) return null;

  const absColRaw = (target.col - origin.col) * 4;
  const absRowRaw = (target.row - origin.row) * 4;
  const absCol = Math.round(absColRaw);
  const absRow = Math.round(absRowRaw);
  if (Math.abs(absColRaw - absCol) > EPS || Math.abs(absRowRaw - absRow) > EPS) {
    return null;
  }

  const x = splitAbsSub(absCol);
  const z = splitAbsSub(absRow);
  const pose = {
    type,
    col: x.tile,
    row: z.tile,
    subCol: x.sub,
    subRow: z.sub,
    dir,
  };
  const resolved = pipePoint(pose, portName);
  if (!resolved
      || Math.abs(resolved.col - target.col) > EPS
      || Math.abs(resolved.row - target.row) > EPS) {
    return null;
  }
  return pose;
}

function exitTravelDir(type, dir, fallback) {
  const side = portSide({ type, dir }, exitPortName(type));
  const resolved = side ? dirFromCompass(side) : null;
  return resolved === null ? fallback : resolved;
}

/**
 * Add exact placement geometry to layoutDesign()'s sequence.
 *
 * The first module keeps the cursor-selected anchor. Every later module is
 * sub-grid anchored so its entry port lands exactly `pipe.tiles` beyond the
 * preceding module's exit port. The resulting pipe therefore has the quoted
 * length and physically touches both declared ports at every rotation.
 */
export function planDesignPlacementGeometry(
  layout,
  { startCol = 0, startRow = 0, direction = 0 } = {},
) {
  const sequence = (layout?.sequence || []).map(item => ({ ...item }));
  let travelDir = direction;
  let previousModule = null;
  let pendingPipe = null;

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    if (item.kind === 'pipe') {
      pendingPipe = item;
      continue;
    }

    const dir = reverseDir(travelDir);
    const entryPort = entryPortName(item.type);
    const exitPort = exitPortName(item.type);
    let pose;

    if (!previousModule) {
      pose = {
        type: item.type,
        col: startCol,
        row: startRow,
        subCol: 0,
        subRow: 0,
        dir,
      };
    } else {
      if (!pendingPipe) {
        return { ok: false, reason: 'missing_pipe_between_modules', sequence };
      }
      const from = pipePoint(previousModule.pose, previousModule.exitPort);
      if (!from) return { ok: false, reason: 'missing_exit_port', sequence };
      const delta = DIR_DELTA[travelDir];
      const to = {
        col: from.col + delta.dc * pendingPipe.tiles,
        row: from.row + delta.dr * pendingPipe.tiles,
      };
      pose = anchorPortAt(item.type, dir, entryPort, to);
      if (!pose) return { ok: false, reason: 'port_off_subgrid', sequence };
      pendingPipe.path = [from, to];
      pendingPipe = null;
    }

    item.pose = pose;
    item.entryPort = entryPort;
    item.exitPort = exitPort;
    previousModule = item;
    travelDir = exitTravelDir(item.type, dir, travelDir);
  }

  if (pendingPipe) return { ok: false, reason: 'trailing_pipe', sequence };
  return { ok: true, sequence };
}

