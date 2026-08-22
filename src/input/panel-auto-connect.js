// Utility-device assisted wiring.
//
// `autoConnectRadius` is deliberately not a utility serviceRadius:
// service radii create implicit bus membership, while this action plans and
// purchases ordinary point-to-point utility lines. Every path consumes a real
// connector, passes through validateDrawLine, and belongs to one undo gesture.
// Definitions may override the radius/utility, but ordinary one-utility
// sources and passive distribution peers opt in automatically. That keeps the
// affordance available to new pumps, chillers, manifolds, switches and utility
// supports without another hand-maintained allow-list.

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import {
  availablePorts,
  getPortSpec,
  placeableCenterWorld,
  portApproachVec,
  portWorldPosition,
} from '../utility/ports.js';
import { buildPortRoutedPaths, pathLengthSubUnits } from '../utility/line-geometry.js';
import { validateDrawLine } from '../utility/line-drawing.js';
import { isOverheadHvSupport } from '../utility/soft-cable.js';
import { findUtilityEndpoint, listUtilityEndpoints } from '../utility/utility-endpoints.js';
import { runWiringCost } from './utility-run-wiring.js';

export const PANEL_AUTO_CONNECT_UTILITY = 'powerCable';

const EPS = 1e-6;

const DEFAULT_AUTO_CONNECT_RADIUS = Object.freeze({
  powerCable: 5,
  hvCable: 10,
  vacuumPipe: 6,
  rfWaveguide: 6,
  coolingWater: 8,
  cryoTransfer: 6,
  dataFiber: 8,
});

function snapQ(value) { return Math.round(value * 4) / 4; }

function portTile(pos) {
  return pos && { col: snapQ(pos.x / 2), row: snapQ(pos.z / 2) };
}

function iterLines(lines) {
  if (!lines) return [];
  return typeof lines.values === 'function' ? Array.from(lines.values()) : lines;
}

function explicitAutoConnectRadius(def) {
  const radius = Number(def?.autoConnectRadius);
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

/**
 * Resolve the single utility a device can sensibly fan out.
 *
 * Sink-only equipment remains a target. A source or passive peer becomes an
 * auto-connect origin when all such connectors belong to one utility. Content
 * with multiple origin utilities must choose explicitly so Tab is predictable.
 */
export function utilityAutoConnectProfile(def) {
  if (!def?.ports) return null;
  const explicitUtility = def.autoConnectUtility;
  if (explicitUtility && !UTILITY_TYPES[explicitUtility]) return null;

  const originUtilities = new Set(Object.values(def.ports)
    .filter(spec => spec && (spec.role === 'source' || spec.role === 'pass'))
    .map(spec => spec.utility)
    .filter(utilityType => UTILITY_TYPES[utilityType]));
  const utilityType = explicitUtility
    || (originUtilities.size === 1 ? [...originUtilities][0] : null);
  if (!utilityType || !originUtilities.has(utilityType)) return null;

  const radius = explicitAutoConnectRadius(def)
    || DEFAULT_AUTO_CONNECT_RADIUS[utilityType]
    || 0;
  return radius > 0 ? { utilityType, radius } : null;
}

export function panelAutoConnectRadius(def) {
  return utilityAutoConnectProfile(def)?.radius || 0;
}

/** Retained public name for callers while the affordance expands past panels. */
export function panelAutoConnectUtility(def) {
  return utilityAutoConnectProfile(def)?.utilityType || null;
}

function rolesCanAutoConnect(originSpec, targetSpec, utilityType) {
  if (!originSpec || !targetSpec) return false;
  if (originSpec.role === 'source') {
    return targetSpec.role !== 'source'
      || (utilityType !== 'powerCable' && utilityType !== 'hvCable');
  }
  return originSpec.role === 'pass';
}

function devicesDirectlyConnected(lines, utilityType, a, b) {
  return iterLines(lines).some(line => {
    if (!line || line.utilityType !== utilityType || !line.start || !line.end) return false;
    const startId = line.start.placeableId;
    const endId = line.end.placeableId;
    return (startId === a && endId === b) || (startId === b && endId === a);
  });
}

/**
 * Plan real lines from one utility source/distributor to nearby compatible
 * devices. Nearest devices win when targets outnumber physical connectors.
 */
export function planPanelAutoConnect(state, panelId, {
  portPosition = portWorldPosition,
} = {}) {
  const baseEmpty = {
    panelId,
    utilityType: null,
    radius: 0,
    candidates: 0,
    outlets: 0,
    stubs: [],
    skipped: 0,
    totalSubL: 0,
    cost: null,
  };
  if (!state || !panelId) return baseEmpty;

  const panel = findUtilityEndpoint(state, panelId);
  const panelDef = COMPONENTS[panel?.type];
  const profile = utilityAutoConnectProfile(panelDef);
  const radius = profile?.radius || 0;
  const utilityType = profile?.utilityType || null;
  const empty = { ...baseEmpty, utilityType };
  if (!panel || !panelDef || radius <= 0 || !utilityType) return empty;

  const resolvePortPosition = typeof portPosition === 'function'
    ? portPosition
    : portWorldPosition;
  const lines = state.utilityLines;
  const connectorPorts = availablePorts(
    panel, panelDef, utilityType, lines,
  ).filter(name => {
    const role = getPortSpec(panelDef, name)?.role;
    return role === 'source' || role === 'pass';
  });
  const centre = placeableCenterWorld(panel, panelDef);
  if (!centre) return { ...empty, radius, outlets: connectorPorts.length };

  const outlets = connectorPorts.map(portName => {
    const pos = resolvePortPosition(panel, panelDef, portName);
    return pos && {
      portName,
      spec: getPortSpec(panelDef, portName),
      tile: portTile(pos),
      vec: portApproachVec(panel, panelDef, portName),
    };
  }).filter(Boolean);

  const candidates = [];
  for (const endpoint of listUtilityEndpoints(state)) {
    if (!endpoint || endpoint.id === panelId) continue;
    if (devicesDirectlyConnected(lines, utilityType, panelId, endpoint.id)) continue;
    const def = COMPONENTS[endpoint.type];
    if (!def?.ports) continue;
    const overheadPeer = utilityType === 'hvCable'
      && isOverheadHvSupport(panelDef)
      && isOverheadHvSupport(def);
    const endpointCentre = placeableCenterWorld(endpoint, def);
    const deviceDistance = endpointCentre
      ? Math.hypot(endpointCentre.x - centre.x, endpointCentre.z - centre.z) / 2
      : Infinity;
    for (const portName of availablePorts(endpoint, def, utilityType, lines)) {
      const spec = getPortSpec(def, portName);
      if (!outlets.some(outlet => rolesCanAutoConnect(outlet.spec, spec, utilityType)
          && (!overheadPeer || outlet.portName === portName))) continue;
      const pos = resolvePortPosition(endpoint, def, portName);
      if (!pos) continue;
      const distance = Math.hypot(pos.x - centre.x, pos.z - centre.z) / 2;
      if (distance > radius + EPS) continue;
      candidates.push({
        placeableId: endpoint.id,
        portName,
        tile: portTile(pos),
        vec: portApproachVec(endpoint, def, portName),
        distance,
        deviceDistance,
        spec,
        overheadPeer,
      });
    }
  }

  candidates.sort((a, b) => (Number(b.overheadPeer) - Number(a.overheadPeer))
    || ((a.overheadPeer || b.overheadPeer)
      ? (a.deviceDistance - b.deviceDistance)
      : (a.distance - b.distance))
    || a.placeableId.localeCompare(b.placeableId)
    || a.portName.localeCompare(b.portName));

  // Validate against existing lines plus each line already promised by this
  // plan. That makes the button's count/cost agree with the eventual commit.
  const plannedLines = [...iterLines(lines)];
  const probeState = { ...state, utilityLines: plannedLines };
  const stubs = [];
  let totalSubL = 0;
  const usedOutlets = new Set();
  const connectedTargets = new Set();
  const candidateTargets = new Set(candidates.map(candidate => candidate.placeableId));

  for (const sink of candidates) {
    if (connectedTargets.has(sink.placeableId) && !sink.overheadPeer) continue;
    const outletIdx = outlets.findIndex((outlet, index) => !usedOutlets.has(index)
      && rolesCanAutoConnect(outlet.spec, sink.spec, utilityType)
      && (!sink.overheadPeer || outlet.portName === sink.portName));
    if (outletIdx < 0) continue;
    const outlet = outlets[outletIdx];
    const start = { placeableId: panelId, portName: outlet.portName };
    const end = { placeableId: sink.placeableId, portName: sink.portName };
    const directJumper = Math.abs(outlet.tile.col - sink.tile.col)
      + Math.abs(outlet.tile.row - sink.tile.row) <= 0.5;
    const routes = buildPortRoutedPaths(
      outlet.tile, directJumper ? null : outlet.vec,
      sink.tile, directJumper ? null : sink.vec,
      {
        allowZeroLength: true,
        portClearance: UTILITY_TYPES[utilityType]?.portClearance !== false,
      },
    );
    const path = routes.find(candidate => validateDrawLine(probeState, {
      utilityType,
      start,
      end,
      path: candidate,
    }).ok);
    if (!path) continue;

    const subL = pathLengthSubUnits(path);
    stubs.push({ start, end, path, subL });
    plannedLines.push({
      id: `__panel_auto_${stubs.length}`,
      utilityType,
      start,
      end,
      path,
    });
    totalSubL += subL;
    usedOutlets.add(outletIdx);
    connectedTargets.add(sink.placeableId);
  }

  return {
    panelId,
    utilityType,
    radius,
    candidates: candidateTargets.size,
    outlets: outlets.length,
    stubs,
    skipped: Math.max(0, candidateTargets.size - connectedTargets.size),
    totalSubL,
    cost: runWiringCost(utilityType, totalSubL),
  };
}

/** Commit a previously calculated plan as a single paid/undoable gesture. */
export function commitPanelAutoConnect(game, plan) {
  if (!game || !plan || plan.stubs.length === 0) return [];
  const utilityType = plan.utilityType || PANEL_AUTO_CONNECT_UTILITY;
  const planCost = plan.cost;
  const committed = [];
  game.commitGesture({
    cost: planCost || undefined,
    mutate: () => {
      let committedSubL = 0;
      for (const stub of plan.stubs) {
        const id = game.utilityLineSystem.addLine({
          utilityType,
          start: stub.start,
          end: stub.end,
          path: stub.path,
        });
        if (id) {
          committed.push(id);
          committedSubL += stub.subL;
        }
      }

      // A world change between menu render and click can invalidate one line.
      // Charge only for lines that actually landed.
      if (planCost && committed.length > 0) {
        const actual = runWiringCost(utilityType, committedSubL) || {};
        for (const [resource, amount] of Object.entries(planCost)) {
          const refund = amount - (actual[resource] || 0);
          if (refund > 0) game.refundConstruction({ [resource]: refund }, 1);
        }
      }
      return committed.length > 0 ? committed : null;
    },
    failed: result => !result,
  });

  if (committed.length > 0) {
    const label = UTILITY_TYPES[utilityType]?.displayName || utilityType;
    game.log(
      `${label}: auto-connected ${committed.length} nearby connection${committed.length === 1 ? '' : 's'}`,
      'good',
    );
  }
  return committed;
}

export default planPanelAutoConnect;
