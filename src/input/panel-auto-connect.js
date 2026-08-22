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
import {
  COOLING_AUTO_CONNECT_CLASS,
  coolingAutoConnectClass,
} from '../data/cooling-auto-connect-classes.js';
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

/** Every real utility run terminating on one endpoint, across all utilities. */
export function connectedUtilityLineIds(state, endpointId) {
  if (!state || !endpointId) return [];
  return iterLines(state.utilityLines)
    .filter(line => line?.start?.placeableId === endpointId
      || line?.end?.placeableId === endpointId)
    .map(line => line.id)
    .filter(Boolean);
}

/** Remove all utility runs on one auto-connect-capable device as one undo step. */
export function disconnectAutoConnectDevice(game, endpointId) {
  const endpoint = findUtilityEndpoint(game?.state, endpointId);
  const def = COMPONENTS[endpoint?.type];
  if (!game || !endpoint || !utilityAutoConnectProfile(def)) return [];

  // Snapshot first: removing a run can also dangle lines connected to an
  // instrument mounted on it, so never iterate the live Map while mutating it.
  const lineIds = connectedUtilityLineIds(game.state, endpointId);
  if (lineIds.length === 0) return [];

  const removed = [];
  game.commitGesture({
    mutate: () => game.batchEvents(() => {
      for (const lineId of lineIds) {
        if (game.removeUtilityLine(lineId)) removed.push(lineId);
      }
      return removed.length > 0 ? removed : null;
    }),
    failed: result => !result,
  });

  if (removed.length > 0) {
    game.log(
      `Removed ${removed.length} utility connection${removed.length === 1 ? '' : 's'} from ${def.name || endpoint.type}`,
      'info',
    );
  }
  return removed;
}

function rolesCanAutoConnect(originSpec, targetSpec, utilityType) {
  if (!originSpec || !targetSpec) return false;
  if (utilityType === 'coolingWater') {
    const originClass = coolingAutoConnectClass(originSpec);
    const targetClass = coolingAutoConnectClass(targetSpec);
    switch (originClass) {
      case COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH:
        return targetClass === COOLING_AUTO_CONNECT_CLASS.LOAD;
      case COOLING_AUTO_CONNECT_CLASS.PLANT_LINK:
        return targetClass === COOLING_AUTO_CONNECT_CLASS.PLANT_LINK
          || targetClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION;
      case COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED:
        return targetClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION;
      case COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION:
        return targetClass === COOLING_AUTO_CONNECT_CLASS.PLANT_LINK
          || targetClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED;
      default:
        return false;
    }
  }
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

function directlyConnectedPeerPorts(state, lines, utilityType, placeableId) {
  const peers = [];
  for (const line of iterLines(lines)) {
    if (!line || line.utilityType !== utilityType || !line.start || !line.end) continue;
    let peerRef = null;
    if (line.start.placeableId === placeableId) peerRef = line.end;
    else if (line.end.placeableId === placeableId) peerRef = line.start;
    if (!peerRef?.placeableId || !peerRef.portName) continue;
    const peer = findUtilityEndpoint(state, peerRef.placeableId);
    const spec = getPortSpec(COMPONENTS[peer?.type], peerRef.portName);
    if (spec?.utility === utilityType) {
      peers.push({ placeableId: peerRef.placeableId, spec });
    }
  }
  return peers;
}

const COOLING_PLANT_CAPABILITY_PARAMS = Object.freeze([
  'capacity',
  'heatRejectionCapacity',
  'storageCapacityL',
  'supplyRateLPerTick',
]);

function coolingCapabilities(spec) {
  const capabilities = new Set();
  for (const param of COOLING_PLANT_CAPABILITY_PARAMS) {
    if (Number(spec?.params?.[param]) > 0) capabilities.add(param);
  }
  return capabilities;
}

function coolingCandidateRank(candidate, originClasses, coveredCapabilities) {
  const targetClass = coolingAutoConnectClass(candidate.spec);
  const distributionOnly = originClasses.size === 1
    && originClasses.has(COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION);
  if (distributionOnly) {
    if (targetClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED) return -3;
    if (Number(candidate.spec?.params?.capacity) > 0) return -2;
    return -1;
  }
  if (!originClasses.has(COOLING_AUTO_CONNECT_CLASS.PLANT_LINK)) return 0;
  if (targetClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION) return 1;
  if (targetClass !== COOLING_AUTO_CONNECT_CLASS.PLANT_LINK) return 0;
  let newlyCovered = 0;
  for (const capability of coolingCapabilities(candidate.spec)) {
    if (!coveredCapabilities.has(capability)) newlyCovered++;
  }
  return newlyCovered > 0 ? -newlyCovered : 2;
}

/**
 * Plan real lines from one utility source/distributor to nearby compatible
 * devices. Nearest devices normally win when targets outnumber connectors;
 * cooling plant links first add capabilities the origin does not already have.
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
  const coolingOriginClasses = new Set(outlets
    .map(outlet => coolingAutoConnectClass(outlet.spec))
    .filter(Boolean));
  const connectedCoolingPeers = utilityType === 'coolingWater'
    ? directlyConnectedPeerPorts(state, lines, utilityType, panelId)
    : [];
  const coveredCoolingCapabilities = new Set();
  if (utilityType === 'coolingWater') {
    for (const spec of Object.values(panelDef.ports)) {
      if (spec?.utility !== utilityType || spec.role !== 'source') continue;
      for (const capability of coolingCapabilities(spec)) {
        coveredCoolingCapabilities.add(capability);
      }
    }
    for (const peer of connectedCoolingPeers) {
      for (const capability of coolingCapabilities(peer.spec)) {
        coveredCoolingCapabilities.add(capability);
      }
    }
  }

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
          && (!overheadPeer || (outlet.portName === portName
            && isOverheadHvSupport(panelDef, outlet.portName)
            && isOverheadHvSupport(def, portName))))) continue;
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
  const distributionOnly = utilityType === 'coolingWater'
    && coolingOriginClasses.size === 1
    && coolingOriginClasses.has(COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION);
  const connectedDistributionFeeds = new Set(connectedCoolingPeers
    .filter(peer => {
      const peerClass = coolingAutoConnectClass(peer.spec);
      return peerClass === COOLING_AUTO_CONNECT_CLASS.PLANT_LINK
        || peerClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED;
    })
    .map(peer => peer.placeableId));
  const targetLimit = distributionOnly
    ? Math.max(0, 1 - connectedDistributionFeeds.size)
    : Infinity;
  const remainingCandidates = [...candidates];

  while (remainingCandidates.length > 0) {
    if (connectedTargets.size >= targetLimit) break;
    let candidateIndex = 0;
    if (utilityType === 'coolingWater') {
      let bestRank = Infinity;
      for (let index = 0; index < remainingCandidates.length; index++) {
        const rank = coolingCandidateRank(
          remainingCandidates[index], coolingOriginClasses, coveredCoolingCapabilities,
        );
        if (rank < bestRank) {
          bestRank = rank;
          candidateIndex = index;
        }
      }
    }
    const [sink] = remainingCandidates.splice(candidateIndex, 1);
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
    if (utilityType === 'coolingWater') {
      for (const capability of coolingCapabilities(sink.spec)) {
        coveredCoolingCapabilities.add(capability);
      }
    }
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
