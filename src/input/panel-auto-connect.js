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
import { lineWaterCircuit, portWaterCircuit } from '../utility/water-circuits.js';
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

/** Remove every utility run terminating on the given endpoints as one undo step. */
export function disconnectUtilityEndpoints(game, endpointIds) {
  if (!game) return [];
  const endpoints = [...new Set(endpointIds || [])]
    .map(endpointId => findUtilityEndpoint(game.state, endpointId))
    .filter(Boolean);
  if (endpoints.length === 0) return [];

  // Snapshot first: removing a run can also dangle lines connected to an
  // instrument mounted on it, so never iterate the live Map while mutating it.
  const lineIds = [...new Set(endpoints.flatMap(endpoint => (
    connectedUtilityLineIds(game.state, endpoint.id)
  )))];
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
    const deviceLabel = endpoints.length === 1
      ? (COMPONENTS[endpoints[0].type]?.name || endpoints[0].type)
      : `${endpoints.length} selected devices`;
    game.log(
      `Removed ${removed.length} utility connection${removed.length === 1 ? '' : 's'} from ${deviceLabel}`,
      'info',
    );
  }
  return removed;
}

/** Remove all utility runs on auto-connect-capable devices as one undo step. */
export function disconnectAutoConnectDevices(game, endpointIds) {
  const assistedIds = [...new Set(endpointIds || [])].filter(endpointId => {
    const endpoint = findUtilityEndpoint(game?.state, endpointId);
    return endpoint && utilityAutoConnectProfile(COMPONENTS[endpoint.type]);
  });
  return disconnectUtilityEndpoints(game, assistedIds);
}

/** Retained single-device command for context panels and older integrations. */
export function disconnectAutoConnectDevice(game, endpointId) {
  return disconnectAutoConnectDevices(game, [endpointId]);
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
        return targetClass === COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH
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

function autoConnectCircuitsMatch(originSpec, targetSpec, utilityType) {
  if (utilityType !== 'coolingWater') return true;
  const originCircuit = portWaterCircuit(originSpec);
  const targetCircuit = portWaterCircuit(targetSpec);
  return !originCircuit || !targetCircuit || originCircuit === targetCircuit;
}

// Each wood utility pole's side fitting is authored specifically as the service
// drop into the compact green pad-mount transformer. Keep it reserved for that
// exact assisted-wiring pair; pole-to-pole spans continue to align matching
// overhead conductors, and manual wiring remains free to use any valid port.
function assistedOutletMatchesTarget(
  originDef,
  targetDef,
  outletPortName,
  targetPortName,
  utilityType,
) {
  const dedicatedTap = getPortSpec(originDef, 'hv_tap')?.connectionKind === 'hvDistributionTap';
  if (utilityType !== 'hvCable' || !dedicatedTap) return true;
  if (targetDef?.id === 'padMountTransformer') {
    return outletPortName === 'hv_tap' && targetPortName === 'hv_in';
  }
  return outletPortName !== 'hv_tap';
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

function inferredLineWaterCircuit(state, line) {
  const authored = lineWaterCircuit(line);
  if (authored) return authored;
  const circuits = new Set();
  for (const ref of [line?.start, line?.end]) {
    if (!ref?.placeableId || !ref.portName) continue;
    const endpoint = findUtilityEndpoint(state, ref.placeableId);
    const circuit = portWaterCircuit(getPortSpec(COMPONENTS[endpoint?.type], ref.portName));
    if (circuit) circuits.add(circuit);
  }
  return circuits.size === 1 ? [...circuits][0] : null;
}

/**
 * A configurable water distributor does not author hot/cold on its flexible
 * ports: the rigid pipe connected to the same converter group decides it.
 * Assisted wiring must resolve that circuit before offering the outlet, or a
 * single passive header could accidentally join a cold inlet to a hot return.
 */
function resolvedCoolingOutletSpec(state, panel, panelDef, portName, spec, lines) {
  if (spec?.utility !== 'coolingWater' || portWaterCircuit(spec)) return spec;
  const converter = panelDef?.waterConverterGroups?.find(group =>
    group?.waterLinePorts?.includes(portName));
  if (!converter) return spec;

  const supplyPorts = new Set(converter.supplyPipePorts || []);
  const circuits = new Set();
  for (const line of iterLines(lines)) {
    if (line?.utilityType !== 'waterSupplyPipe') continue;
    const touchesGroup = [line.start, line.end].some(ref =>
      ref?.placeableId === panel.id && supplyPorts.has(ref.portName));
    if (!touchesGroup) continue;
    const circuit = inferredLineWaterCircuit(state, line);
    if (circuit) circuits.add(circuit);
  }
  if (circuits.size !== 1) return null;
  return {
    ...spec,
    params: { ...(spec.params || {}), waterCircuit: [...circuits][0] },
  };
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

function pairedCoolingAssignments(outlets, candidates) {
  const branchOutlets = outlets.filter(outlet =>
    coolingAutoConnectClass(outlet.spec) === COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH);
  const coldOutlets = branchOutlets.filter(outlet => portWaterCircuit(outlet.spec) === 'cold');
  const hotOutlets = branchOutlets.filter(outlet => portWaterCircuit(outlet.spec) === 'hot');
  if (coldOutlets.length === 0 || coldOutlets.length !== hotOutlets.length) return [];

  // Distributor branches share one face. Its outward normal tells us which
  // plan axis runs along the header; preserving order on that axis prevents
  // the familiar left-to-right braid when several beamline loads sit beside it.
  const normal = branchOutlets.find(outlet => outlet.vec)?.vec;
  const axis = normal?.dCol ? 'row' : normal?.dRow ? 'col' : (() => {
    const colValues = branchOutlets.map(outlet => outlet.tile.col);
    const rowValues = branchOutlets.map(outlet => outlet.tile.row);
    const colSpan = Math.max(...colValues) - Math.min(...colValues);
    const rowSpan = Math.max(...rowValues) - Math.min(...rowValues);
    return colSpan > rowSpan ? 'col' : 'row';
  })();
  const coordinate = entry => entry.tile[axis];
  const byHeaderPosition = (a, b) => coordinate(a) - coordinate(b)
    || a.portName.localeCompare(b.portName);
  coldOutlets.sort(byHeaderPosition);
  hotOutlets.sort(byHeaderPosition);

  // Cold and hot ports are authored in the same circuit order. Zipping those
  // ordered lists preserves cold_1/hot_1 on the LCW manifold and maps the
  // Water Distributor's first cold branch to its first hot branch.
  const stations = coldOutlets.map((cold, index) => {
    const hot = hotOutlets[index];
    return {
      cold,
      hot,
      coordinate: (coordinate(cold) + coordinate(hot)) / 2,
    };
  }).sort((a, b) => a.coordinate - b.coordinate);

  const targetsByDevice = new Map();
  for (const candidate of candidates) {
    if (coolingAutoConnectClass(candidate.spec) !== COOLING_AUTO_CONNECT_CLASS.LOAD) continue;
    const circuit = portWaterCircuit(candidate.spec);
    if (circuit !== 'cold' && circuit !== 'hot') continue;
    let target = targetsByDevice.get(candidate.placeableId);
    if (!target) {
      target = {
        placeableId: candidate.placeableId,
        deviceDistance: candidate.deviceDistance,
        cold: null,
        hot: null,
      };
      targetsByDevice.set(candidate.placeableId, target);
    }
    if (!target[circuit]) target[circuit] = candidate;
  }

  // Keep the existing nearest-device policy when there are more loads than
  // physical pairs, then align the chosen devices with header stations. Both
  // hoses for a target are planned together before generic single-line fallback.
  const targets = [...targetsByDevice.values()]
    .filter(target => target.cold && target.hot)
    .sort((a, b) => a.deviceDistance - b.deviceDistance
      || a.placeableId.localeCompare(b.placeableId))
    .slice(0, stations.length)
    .map(target => ({
      ...target,
      coordinate: (target.cold.tile[axis] + target.hot.tile[axis]) / 2,
    }))
    .sort((a, b) => a.coordinate - b.coordinate
      || a.placeableId.localeCompare(b.placeableId));

  return targets.map((target, index) => ({ station: stations[index], target }));
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
    const spec = resolvedCoolingOutletSpec(
      state, panel, panelDef, portName, getPortSpec(panelDef, portName), lines,
    );
    return pos && {
      portName,
      spec,
      tile: portTile(pos),
      vec: portApproachVec(panel, panelDef, portName),
    };
  }).filter(outlet => outlet?.spec)
    .map((outlet, outletIndex) => ({ ...outlet, outletIndex }));
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
  const supportsPairedWaterCircuits = utilityType === 'coolingWater'
    && (panelDef.waterConverterGroups?.length || 0) > 1;
  for (const endpoint of listUtilityEndpoints(state)) {
    if (!endpoint || endpoint.id === panelId) continue;
    // Paired water equipment intentionally has one cold and one hot run to
    // the same distributor. Existing service on one circuit must not hide the
    // still-free connector on the other circuit.
    if (!supportsPairedWaterCircuits
        && devicesDirectlyConnected(lines, utilityType, panelId, endpoint.id)) continue;
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
          && autoConnectCircuitsMatch(outlet.spec, spec, utilityType)
          && assistedOutletMatchesTarget(
            panelDef, def, outlet.portName, portName, utilityType,
          )
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
        targetType: endpoint.type,
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
  const connectedTargetCircuits = new Set();
  const connectedTargetDevices = new Set();
  const candidateTargets = new Set(candidates.map(candidate => candidate.placeableId));
  const distributionOnly = utilityType === 'coolingWater'
    && coolingOriginClasses.size === 1
    && coolingOriginClasses.has(COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION);
  const connectedDistributionFeeds = new Set(connectedCoolingPeers
    .filter(peer => {
      const peerClass = coolingAutoConnectClass(peer.spec);
      return peerClass === COOLING_AUTO_CONNECT_CLASS.PLANT_LINK
        || peerClass === COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH
        || peerClass === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED;
    })
    .map(peer => peer.placeableId));
  const targetLimit = distributionOnly
    ? Math.max(0, 1 - connectedDistributionFeeds.size)
    : Infinity;

  const routedStub = (outlet, sink, validationState) => {
    const start = { placeableId: panelId, portName: outlet.portName };
    const end = { placeableId: sink.placeableId, portName: sink.portName };
    const directJumper = Math.abs(outlet.tile.col - sink.tile.col)
      + Math.abs(outlet.tile.row - sink.tile.row) <= 0.5;
    const routes = buildPortRoutedPaths(
      outlet.tile, directJumper ? null : outlet.vec,
      sink.tile, directJumper ? null : sink.vec,
      { allowZeroLength: true },
    );
    const path = routes.find(candidate => validateDrawLine(validationState, {
      utilityType,
      start,
      end,
      path: candidate,
    }).ok);
    return path ? { start, end, path, subL: pathLengthSubUnits(path) } : null;
  };

  if (supportsPairedWaterCircuits) {
    const assignments = pairedCoolingAssignments(outlets, candidates);
    for (const { station, target } of assignments) {
      const pairLines = [...plannedLines];
      const pairProbeState = { ...state, utilityLines: pairLines };
      const pairStubs = [];
      for (const circuit of ['cold', 'hot']) {
        const stub = routedStub(station[circuit], target[circuit], pairProbeState);
        if (!stub) break;
        pairStubs.push(stub);
        pairLines.push({
          id: `__panel_auto_pair_${stubs.length + pairStubs.length}`,
          utilityType,
          start: stub.start,
          end: stub.end,
          path: stub.path,
        });
      }
      if (pairStubs.length !== 2) continue;

      for (const stub of pairStubs) {
        stubs.push(stub);
        plannedLines.push({
          id: `__panel_auto_${stubs.length}`,
          utilityType,
          start: stub.start,
          end: stub.end,
          path: stub.path,
        });
        totalSubL += stub.subL;
      }
      usedOutlets.add(station.cold.outletIndex);
      usedOutlets.add(station.hot.outletIndex);
      connectedTargetCircuits.add(`${target.placeableId}:cold`);
      connectedTargetCircuits.add(`${target.placeableId}:hot`);
      connectedTargetDevices.add(target.placeableId);
    }
  }

  const remainingCandidates = [...candidates];

  while (remainingCandidates.length > 0) {
    if (connectedTargetDevices.size >= targetLimit) break;
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
    const sinkCircuit = utilityType === 'coolingWater'
      ? portWaterCircuit(sink.spec) || 'unspecified'
      : 'default';
    const sinkTargetKey = `${sink.placeableId}:${sinkCircuit}`;
    if (connectedTargetCircuits.has(sinkTargetKey) && !sink.overheadPeer) continue;
    const outletIdx = outlets.findIndex((outlet, index) => !usedOutlets.has(index)
      && rolesCanAutoConnect(outlet.spec, sink.spec, utilityType)
      && autoConnectCircuitsMatch(outlet.spec, sink.spec, utilityType)
      && assistedOutletMatchesTarget(
        panelDef,
        COMPONENTS[sink.targetType],
        outlet.portName,
        sink.portName,
        utilityType,
      )
      && (!sink.overheadPeer || outlet.portName === sink.portName));
    if (outletIdx < 0) continue;
    const outlet = outlets[outletIdx];
    const stub = routedStub(outlet, sink, probeState);
    if (!stub) continue;

    stubs.push(stub);
    plannedLines.push({
      id: `__panel_auto_${stubs.length}`,
      utilityType,
      start: stub.start,
      end: stub.end,
      path: stub.path,
    });
    totalSubL += stub.subL;
    usedOutlets.add(outlet.outletIndex);
    connectedTargetCircuits.add(sinkTargetKey);
    connectedTargetDevices.add(sink.placeableId);
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
    skipped: Math.max(0, candidateTargets.size - connectedTargetDevices.size),
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
