// Transaction planner/executor for utility runs that cross structural walls.
//
// The line validator remains the authority for one terminated run. This
// coordinator turns one player gesture into N+1 ordinary runs terminated on N
// real wall placeables, pre-validates the complete hypothetical topology, and
// then commits it inside the caller's one Game.commitGesture.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { canPlaceWallFixture } from '../game/placement.js';
import { wallFixtureDir, physicalWallFixtureSlotKeys } from '../game/wall-fixture-geometry.js';
import { buildManhattanPath } from './line-geometry.js';
import { validateDrawLine } from './line-drawing.js';
import { pathRunsAlongWall, pathWallCrossings } from './wall-crossings.js';
import {
  getPortSpec,
  portWorldPosition,
  utilityPortConnectionLimit,
} from './ports.js';
import {
  isSoftCable,
  roundedCableTilePath,
  sanitizeCablePath,
} from './soft-cable.js';
import { snapUtilityRouteCoordinate } from './routing-contract.js';

const EPS = 1e-7;

const AUTOMATIC_FITTING_TYPES = Object.freeze({
  powerCable: 'powerWallPassThrough',
  hvCable: 'hvWallPassThrough',
  dataFiber: 'dataFiberWallPassThrough',
  cryoTransfer: 'cryoWallPassThrough',
  rfWaveguide: 'rfWallPassThrough',
  vacuumPipe: 'vacuumWallPassThrough',
  coolingWater: Object.freeze({
    cold: 'coldWaterLineWallPassThrough',
    hot: 'hotWaterLineWallPassThrough',
  }),
  waterSupplyPipe: Object.freeze({
    cold: 'coldWaterSupplyWallPassThrough',
    hot: 'hotWaterSupplyWallPassThrough',
  }),
});

export function automaticWallPassThroughType(utilityType, waterCircuit = null) {
  const mapped = AUTOMATIC_FITTING_TYPES[utilityType];
  return typeof mapped === 'string' ? mapped : mapped?.[waterCircuit] || null;
}

export function combineConstructionCosts(...costs) {
  const total = {};
  for (const cost of costs) {
    for (const [resource, amount] of Object.entries(cost || {})) {
      if (Number.isFinite(amount) && amount !== 0) {
        total[resource] = (total[resource] || 0) + amount;
      }
    }
  }
  return Object.keys(total).length ? total : null;
}

function lineIterable(lines) {
  return lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
}

function portClaims(state, placeableId, portName) {
  let claims = 0;
  for (const line of lineIterable(state?.utilityLines)) {
    if (line?.start?.placeableId === placeableId && line.start.portName === portName) claims++;
    if (line?.end?.placeableId === placeableId && line.end.portName === portName) claims++;
  }
  return claims;
}

function availablePair(state, entry, def, utilityType, pair) {
  return pair.length === 2 && pair.every((portName) => {
    const spec = getPortSpec(def, portName);
    return spec?.utility === utilityType
      && portClaims(state, entry.id, portName) < utilityPortConnectionLimit(spec, utilityType);
  });
}

function passThroughPairs(def, utilityType) {
  const authored = def?.automaticWallPassThrough?.portPairs
    || def?.electricalGroups?.[utilityType]
    || def?.utilityGroups?.[utilityType];
  if (Array.isArray(authored)) return authored.filter(pair => Array.isArray(pair) && pair.length === 2);
  const front = [];
  const back = [];
  for (const [name, spec] of Object.entries(def?.ports || {})) {
    if (spec?.utility !== utilityType || spec.role !== 'pass') continue;
    if (spec.side === 'front') front.push(name);
    if (spec.side === 'back') back.push(name);
  }
  return front.map((name, index) => [name, back[index]]).filter(pair => pair[1]);
}

function samePhysicalSlot(entry, crossing) {
  const wanted = new Set(physicalWallFixtureSlotKeys({ ...crossing.wallMount, span: 1 }));
  return physicalWallFixtureSlotKeys({
    ...entry.wallMount,
    span: PLACEABLES[entry.type]?.wallSpan ?? entry.wallMount?.span ?? 1,
  }).some(key => wanted.has(key));
}

function pairDistance(entry, def, pair, point) {
  const positions = pair.map(name => portWorldPosition(entry, def, name)).filter(Boolean);
  if (positions.length !== 2) return Infinity;
  const col = (positions[0].x + positions[1].x) / 4;
  const row = (positions[0].z + positions[1].z) / 4;
  return Math.hypot(col - point.col, row - point.row);
}

function findExistingPassThrough(state, crossing, utilityType) {
  const candidates = [];
  for (const entry of state?.placeables || []) {
    if (!entry?.wallMount || !samePhysicalSlot(entry, crossing)) continue;
    const def = COMPONENTS[entry.type];
    if (!def?.wallPassThrough) continue;
    for (const pair of passThroughPairs(def, utilityType)) {
      if (!availablePair(state, entry, def, utilityType, pair)) continue;
      candidates.push({
        entry, def, pair,
        distance: pairDistance(entry, def, pair, crossing.point),
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0] || null;
}

function polylineCumulative(path) {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(
      path[i].col - path[i - 1].col,
      path[i].row - path[i - 1].row,
    );
  }
  return cumulative;
}

function pointAtDistance(path, cumulative, distance) {
  const total = cumulative[cumulative.length - 1];
  const d = Math.max(0, Math.min(total, distance));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < d - EPS) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > EPS ? (d - cumulative[i - 1]) / span : 0;
  return {
    col: path[i - 1].col + (path[i].col - path[i - 1].col) * t,
    row: path[i - 1].row + (path[i].row - path[i - 1].row) * t,
  };
}

function slicePolyline(path, cumulative, startDistance, endDistance) {
  const out = [pointAtDistance(path, cumulative, startDistance)];
  for (let i = 1; i < path.length - 1; i++) {
    if (cumulative[i] > startDistance + EPS && cumulative[i] < endDistance - EPS) {
      out.push({ col: path[i].col, row: path[i].row });
    }
  }
  out.push(pointAtDistance(path, cumulative, endDistance));
  return out.filter((point, index) => index === 0
    || Math.hypot(point.col - out[index - 1].col, point.row - out[index - 1].row) > EPS);
}

function snapPoint(point) {
  return {
    col: snapUtilityRouteCoordinate(point.col),
    row: snapUtilityRouteCoordinate(point.row),
  };
}

function compatibilityPath(slice) {
  const start = snapPoint(slice[0]);
  const end = snapPoint(slice[slice.length - 1]);
  const firstLeg = slice.find(point =>
    Math.hypot(point.col - slice[0].col, point.row - slice[0].row) > EPS);
  const preferVerticalFirst = firstLeg
    ? Math.abs(firstLeg.row - slice[0].row) >= Math.abs(firstLeg.col - slice[0].col)
    : false;
  const path = buildManhattanPath(start, end, { preferVerticalFirst });
  return path.length >= 2 ? path : [start, { ...end }];
}

function crossingDirection(path, crossing) {
  const axis = crossing.axis;
  const boundary = crossing.boundary;
  let before = crossing.segmentIndex;
  while (before >= 0 && Math.abs(path[before][axis] - boundary) < EPS) before--;
  let after = crossing.segmentIndex + 1;
  while (after < path.length && Math.abs(path[after][axis] - boundary) < EPS) after++;
  const from = before >= 0 ? path[before][axis] : boundary;
  const to = after < path.length ? path[after][axis] : boundary;
  return Math.sign(to - from) || 1;
}

function crossingSidePoint(crossing, path, outgoing) {
  const point = { ...crossing.point };
  const sign = crossingDirection(path, crossing) * (outgoing ? 1 : -1);
  point[crossing.axis] += sign * 0.25;
  return point;
}

function orientPair(entry, def, pair, crossing, path) {
  const axis = crossing.axis;
  const sign = crossingDirection(path, crossing);
  const scored = pair.map(portName => {
    const pos = portWorldPosition(entry, def, portName);
    const coordinate = axis === 'col' ? pos?.x / 2 : pos?.z / 2;
    return { portName, score: (coordinate - crossing.boundary) * sign };
  }).sort((a, b) => a.score - b.score);
  return { incomingPort: scored[0].portName, outgoingPort: scored[1].portName };
}

function powerStartsUpstream(state, opts) {
  if (opts.utilityType !== 'powerCable') return null;
  const specFor = ref => {
    const entry = ref && state?.placeables?.find(placeable => placeable.id === ref.placeableId);
    return entry ? getPortSpec(COMPONENTS[entry.type], ref.portName) : null;
  };
  const start = specFor(opts.start);
  const end = specFor(opts.end);
  if (start?.role === 'source') return true;
  if (end?.role === 'source') return false;
  return true;
}

function cloneLines(lines) {
  return new Map(Array.from(lineIterable(lines), line => [line.id, line]));
}

/** Plan one gesture without mutating the real game state. */
export function planAutomaticWallPassThroughs(game, opts = {}) {
  const state = game?.state;
  const ordinary = validateDrawLine(state, opts);
  if (ordinary.ok) {
    return { ok: true, feedthroughs: [], segments: [opts], fittingCost: null };
  }
  if (ordinary.reason !== 'wall_pass_through_required') return ordinary;
  const permissive = validateDrawLine(state, { ...opts, allowAutomaticWallPassThrough: true });
  if (!permissive.ok) return permissive;

  const soft = isSoftCable(opts.utilityType)
    && Array.isArray(opts.cablePath) && opts.cablePath.length >= 2;
  const physicalPath = soft
    ? roundedCableTilePath(sanitizeCablePath(opts.cablePath), opts.utilityType)
    : opts.path.map(point => ({ col: point.col, row: point.row }));
  if (pathRunsAlongWall(state.wallOccupied, physicalPath)) {
    return { ok: false, reason: 'route cannot run along the wall itself' };
  }
  const crossings = pathWallCrossings(state.wallOccupied, physicalPath);
  if (crossings.length === 0) return ordinary;
  const duplicate = crossings.some((hit, index) => crossings.slice(0, index).some(previous =>
    previous.wallKey === hit.wallKey && previous.wallMount.off === hit.wallMount.off));
  if (duplicate) return { ok: false, reason: 'route crosses the same wall slot more than once' };

  const probeState = {
    ...state,
    placeables: [...(state.placeables || [])],
    utilityLines: cloneLines(state.utilityLines),
  };
  const probeGame = { ...game, state: probeState };
  const feedthroughs = [];
  const selections = [];
  const fittingType = automaticWallPassThroughType(opts.utilityType, opts.waterCircuit);
  if (!fittingType) return { ok: false, reason: 'select hot or cold water before crossing a wall' };
  const powerForward = powerStartsUpstream(state, opts);

  for (let index = 0; index < crossings.length; index++) {
    const crossing = crossings[index];
    let selected = findExistingPassThrough(probeState, crossing, opts.utilityType);
    let entry;
    let def;
    let pair;
    let isNew = false;
    if (selected) {
      ({ entry, def, pair } = selected);
    } else {
      def = PLACEABLES[fittingType];
      if (!def) return { ok: false, reason: `missing automatic wall fitting ${fittingType}` };
      const wallResult = canPlaceWallFixture(probeGame, def, crossing.wallMount);
      if (!wallResult.ok) {
        return { ok: false, reason: wallResult.hasWall
          ? 'that wall crossing slot is occupied' : 'the route no longer crosses a wall' };
      }
      entry = {
        id: `__automatic_wall_${probeState.placeables.length}_${index}`,
        type: fittingType,
        category: 'infrastructure', kind: 'infrastructure',
        col: wallResult.wallMount.col, row: wallResult.wallMount.row,
        subCol: 0, subRow: 0,
        dir: wallFixtureDir(wallResult.wallMount),
        portsFlipped: false,
        wallMount: wallResult.wallMount,
      };
      pair = def.automaticWallPassThrough.portPairs[0];
      // The directional power gland always presents pwr_in to the upstream
      // side, regardless of which face spelling represented the wall.
      if (opts.utilityType === 'powerCable') {
        const oriented = orientPair(entry, def, pair, crossing, physicalPath);
        const desiredIncoming = powerForward ? 'pwr_in' : 'pwr_out';
        if (oriented.incomingPort !== desiredIncoming) entry.portsFlipped = true;
      }
      probeState.placeables.push(entry);
      feedthroughs.push({
        probeId: entry.id,
        type: fittingType,
        wallMount: wallResult.wallMount,
        portsFlipped: entry.portsFlipped,
        cost: def.cost,
      });
      isNew = true;
    }
    const oriented = orientPair(entry, def, pair, crossing, physicalPath);
    selections.push({ ...oriented, entryId: entry.id, crossing, isNew });
  }

  const cumulative = polylineCumulative(physicalPath);
  const total = cumulative[cumulative.length - 1];
  const distances = [0, ...crossings.map(hit => hit.distance), total];
  const segments = [];
  for (let index = 0; index < distances.length - 1; index++) {
    const physicalSlice = slicePolyline(
      physicalPath, cumulative, distances[index], distances[index + 1],
    );
    if (soft && index > 0) {
      physicalSlice[0] = crossingSidePoint(crossings[index - 1], physicalPath, true);
    }
    if (soft && index < selections.length) {
      physicalSlice[physicalSlice.length - 1] = crossingSidePoint(
        crossings[index], physicalPath, false,
      );
    }
    const start = index === 0 ? (opts.start || null) : {
      placeableId: selections[index - 1].entryId,
      portName: selections[index - 1].outgoingPort,
    };
    const end = index === selections.length ? (opts.end || null) : {
      placeableId: selections[index].entryId,
      portName: selections[index].incomingPort,
    };
    const segment = {
      utilityType: opts.utilityType,
      start,
      end,
      path: soft ? compatibilityPath(physicalSlice) : physicalSlice,
      ...(soft ? { cablePath: physicalSlice } : {}),
      waterCircuit: opts.waterCircuit,
      routeHeightMeters: opts.routeHeightMeters,
      tapLineIds: {
        start: index === 0 ? opts.tapLineIds?.start || null : null,
        end: index === selections.length ? opts.tapLineIds?.end || null : null,
      },
    };
    const validated = validateDrawLine(probeState, segment);
    if (!validated.ok) return validated;
    const line = { id: `__automatic_line_${index}`, ...validated.line };
    probeState.utilityLines.set(line.id, line);
    segments.push(segment);
  }

  return {
    ok: true,
    feedthroughs,
    segments,
    fittingCost: combineConstructionCosts(...feedthroughs.map(fitting => fitting.cost)),
  };
}

/** Add a plan's hypothetical records to a cloned state for bulk preflight. */
export function applyAutomaticWallPassThroughPlanToState(state, plan) {
  if (!state || !plan?.ok) return false;
  if (!(state.utilityLines instanceof Map)) state.utilityLines = cloneLines(state.utilityLines);
  for (const fitting of plan.feedthroughs || []) {
    state.placeables.push({
      id: fitting.probeId,
      type: fitting.type,
      category: 'infrastructure', kind: 'infrastructure',
      col: fitting.wallMount.col, row: fitting.wallMount.row,
      subCol: 0, subRow: 0,
      dir: wallFixtureDir(fitting.wallMount),
      portsFlipped: fitting.portsFlipped,
      wallMount: fitting.wallMount,
    });
  }
  for (const segment of plan.segments || []) {
    const checked = validateDrawLine(state, segment);
    if (!checked.ok) return false;
    const id = `__automatic_planned_line_${state.utilityLines.size}`;
    state.utilityLines.set(id, { id, ...checked.line });
  }
  return true;
}

/** Execute a prevalidated plan inside the caller's active gesture. */
export function executeAutomaticWallPassThroughPlan(game, plan) {
  return executeAutomaticWallPassThroughPlans(game, [plan]);
}

/** Execute several plans with one shared probe-id -> real-id mapping. */
export function executeAutomaticWallPassThroughPlans(game, plans) {
  if (!Array.isArray(plans) || plans.some(plan => !plan?.ok)) return null;
  const idMap = new Map();
  const placeableIds = [];
  for (const fitting of plans.flatMap(plan => plan.feedthroughs || [])) {
    const id = game.placePlaceable({
      type: fitting.type,
      col: fitting.wallMount.col,
      row: fitting.wallMount.row,
      subCol: 0,
      subRow: 0,
      wallMount: fitting.wallMount,
      portsFlipped: fitting.portsFlipped,
      free: true,
      silent: true,
    });
    if (!id) return null;
    idMap.set(fitting.probeId, id);
    placeableIds.push(id);
  }
  const remap = ref => ref && ({
    placeableId: idMap.get(ref.placeableId) || ref.placeableId,
    portName: ref.portName,
  });
  const lineIds = [];
  for (const segment of plans.flatMap(plan => plan.segments || [])) {
    const id = game.utilityLineSystem.addLine({
      ...segment,
      start: remap(segment.start),
      end: remap(segment.end),
    });
    if (!id) return null;
    lineIds.push(id);
  }
  return lineIds.length ? { lineIds, placeableIds } : null;
}
