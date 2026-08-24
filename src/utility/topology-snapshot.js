// Solver-side utility topology telemetry.
//
// Network discovery owns connectivity and each descriptor owns capacity,
// demand, and quality. This module joins those already-authoritative results
// into a bounded, display-ready graph. The UI must not rediscover a network or
// independently estimate branch loads.

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function portKey(port) {
  return port?.portKey || (port?.placeableId && port?.portName
    ? `${port.placeableId}:${port.portName}` : '');
}

function demandForSink(worldState, sink, descriptor) {
  if (sink?.portKey) {
    const electrical = worldState?.electricalSinkDemands?.get?.(sink.portKey);
    if (Number.isFinite(electrical)) return Math.max(0, electrical);
  }
  const param = descriptor?.demandParam || 'demand';
  const authored = sink?.params?.[param];
  if (Number.isFinite(authored)) return Math.max(0, authored);
  return Math.max(0, finite(sink?.demand));
}

function capacityForSource(source, descriptor) {
  const candidates = [
    descriptor?.capacityParam,
    'capacity',
    'heatRejectionCapacity',
    'pumpSpeed',
    'coldCapacityW',
  ].filter(Boolean);
  for (const name of candidates) {
    const value = source?.params?.[name];
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return Math.max(0, finite(source?.capacity));
}

function equipmentNode(id) {
  return `equipment:${id}`;
}

function addEdge(edges, adjacency, edge) {
  if (!edge.from || !edge.to) return;
  edges.push(edge);
  if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
  if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
  adjacency.get(edge.from).push({ nodeId: edge.to, edge });
  adjacency.get(edge.to).push({ nodeId: edge.from, edge });
}

function components(nodes, adjacency) {
  const out = [];
  const seen = new Set();
  for (const id of nodes.keys()) {
    if (seen.has(id)) continue;
    const group = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift();
      group.push(current);
      for (const next of adjacency.get(current) || []) {
        if (seen.has(next.nodeId)) continue;
        seen.add(next.nodeId);
        queue.push(next.nodeId);
      }
    }
    out.push(group);
  }
  return out;
}

function deviceFault(worldState, placeableId) {
  const live = worldState?.powerReliability?.devices?.[placeableId];
  if (!live) return null;
  if (live.breakerTripped === true) return 'breaker_tripped';
  if (live.breakerOpen === true) return 'breaker_open';
  if (live.switchClosed === false) return 'switch_open';
  if ((live.outageTicksRemaining || 0) > 0) return 'grid_outage';
  if (live.generatorEnabled === false) return 'generator_disabled';
  if (Number.isFinite(live.generatorFuelTicks) && live.generatorFuelTicks <= 0) {
    return 'fuel_empty';
  }
  return null;
}

function normalizeNodeQuantities(nodes, flow) {
  const sinkNodes = [...nodes.values()].filter(node => node.kind === 'equipment' && node.demand > 0);
  const rawDemand = sinkNodes.reduce((sum, node) => sum + node.demand, 0);
  if (rawDemand > 0 && Number.isFinite(flow?.totalDemand)) {
    const scale = Math.max(0, flow.totalDemand) / rawDemand;
    for (const node of sinkNodes) node.demand *= scale;
  } else if (sinkNodes.length > 0 && Number.isFinite(flow?.totalDemand) && flow.totalDemand > 0) {
    const share = flow.totalDemand / sinkNodes.length;
    for (const node of sinkNodes) node.demand = share;
  }

  const sourceNodes = [...nodes.values()].filter(node =>
    node.kind === 'equipment' && node.roles.includes('source'));
  const rawCapacity = sourceNodes.reduce((sum, node) => sum + node.capacity, 0);
  if (rawCapacity > 0 && Number.isFinite(flow?.totalCapacity)) {
    const scale = Math.max(0, flow.totalCapacity) / rawCapacity;
    for (const node of sourceNodes) node.capacity *= scale;
  } else if (sourceNodes.length > 0 && Number.isFinite(flow?.totalCapacity) && flow.totalCapacity > 0) {
    const share = flow.totalCapacity / sourceNodes.length;
    for (const node of sourceNodes) node.capacity = share;
  }
}

function assignDepths(nodes, adjacency, rootIds) {
  const queue = [];
  for (const id of rootIds) {
    const node = nodes.get(id);
    if (!node) continue;
    node.depth = 0;
    queue.push(id);
  }
  if (queue.length === 0 && nodes.size > 0) {
    const first = [...nodes.keys()].sort()[0];
    nodes.get(first).depth = 0;
    queue.push(first);
  }
  while (queue.length) {
    const current = queue.shift();
    const depth = nodes.get(current)?.depth || 0;
    for (const next of adjacency.get(current) || []) {
      const node = nodes.get(next.nodeId);
      if (!node || Number.isFinite(node.depth)) continue;
      node.depth = depth + 1;
      queue.push(next.nodeId);
    }
  }
  for (const node of nodes.values()) {
    if (!Number.isFinite(node.depth)) node.depth = 0;
  }
}

function assignRadialLoads(nodes, edges, adjacency, rootId, totalCapacity) {
  const parent = new Map([[rootId, null]]);
  const parentEdge = new Map();
  const order = [];
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    for (const next of adjacency.get(current) || []) {
      if (parent.has(next.nodeId)) continue;
      parent.set(next.nodeId, current);
      parentEdge.set(next.nodeId, next.edge);
      queue.push(next.nodeId);
    }
  }
  const downstream = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const node = nodes.get(id);
    let demand = finite(node?.demand);
    for (const next of adjacency.get(id) || []) {
      if (parent.get(next.nodeId) === id) demand += finite(downstream.get(next.nodeId));
    }
    downstream.set(id, demand);
    if (node) node.downstreamDemand = demand;
    const edge = parentEdge.get(id);
    if (edge) {
      edge.flow = demand;
      edge.from = parent.get(id);
      edge.to = id;
      edge.utilization = totalCapacity > 0 ? demand / totalCapacity : (demand > 0 ? 1 : 0);
      edge.status = demand <= 0 ? 'dead'
        : totalCapacity <= 0 ? 'off'
          : demand > totalCapacity ? 'constrained' : 'healthy';
    }
  }
}

/**
 * Create the solver-published graph for one connected utility network.
 * Exact per-run flow is published only for a single-source radial graph. A
 * bus, cycle, multi-source network, or implicit adjacency remains visible but
 * is explicitly marked as shared rather than assigned invented branch watts.
 */
export function buildUtilityTopologySnapshot(
  worldState, network, flow, descriptor = {},
) {
  const nodes = new Map();
  const edges = [];
  const adjacency = new Map();
  const linesById = worldState?.utilityLines instanceof Map
    ? worldState.utilityLines : new Map();

  const ensureEquipment = (placeableId) => {
    const id = equipmentNode(placeableId);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, placeableId, kind: 'equipment', roles: [], portNames: [],
        demand: 0, capacity: 0, quality: null, depth: null,
        downstreamDemand: null, status: 'healthy', fault: deviceFault(worldState, placeableId),
      });
    }
    return nodes.get(id);
  };
  const ensureSynthetic = (id, kind) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, placeableId: null, kind, roles: [kind], portNames: [], demand: 0,
        capacity: 0, quality: null, depth: null, downstreamDemand: null,
        status: kind === 'open' ? 'dead' : 'healthy', fault: null,
      });
    }
    return nodes.get(id);
  };

  for (const port of network?.ports || []) {
    if (!port?.placeableId) continue;
    const node = ensureEquipment(port.placeableId);
    if (port.role && !node.roles.includes(port.role)) node.roles.push(port.role);
    if (port.portName && !node.portNames.includes(port.portName)) node.portNames.push(port.portName);
  }
  for (const source of network?.sources || []) {
    const node = ensureEquipment(source.placeableId);
    if (!node.roles.includes('source')) node.roles.push('source');
    node.capacity += capacityForSource(source, descriptor);
  }
  for (const sink of network?.sinks || []) {
    const node = ensureEquipment(sink.placeableId);
    if (!node.roles.includes('sink')) node.roles.push('sink');
    node.demand += demandForSink(worldState, sink, descriptor);
    const quality = flow?.perSinkQuality?.[portKey(sink)];
    if (Number.isFinite(quality)) {
      node.quality = node.quality == null ? quality : Math.min(node.quality, quality);
    }
  }
  normalizeNodeQuantities(nodes, flow);

  const networkLineIds = new Set(network?.lineIds || []);
  const tapTargets = new Set();
  for (const lineId of networkLineIds) {
    const line = linesById.get(lineId);
    if (line?.tapLineIds?.start) tapTargets.add(line.tapLineIds.start);
    if (line?.tapLineIds?.end) tapTargets.add(line.tapLineIds.end);
  }
  const endpointNode = (line, side) => {
    const ref = line?.[side];
    if (ref?.placeableId) return ensureEquipment(ref.placeableId).id;
    const target = line?.tapLineIds?.[side];
    if (target) return ensureSynthetic(`junction:${target}`, 'junction').id;
    return ensureSynthetic(`open:${line?.id}:${side}`, 'open').id;
  };

  for (const lineId of networkLineIds) {
    const line = linesById.get(lineId);
    if (!line) continue;
    const from = endpointNode(line, 'start');
    const to = endpointNode(line, 'end');
    if (tapTargets.has(lineId)) {
      const junction = ensureSynthetic(`junction:${lineId}`, 'junction').id;
      addEdge(edges, adjacency, {
        id: `${lineId}:a`, lineId, kind: 'run', from, to: junction,
        flow: null, utilization: null, status: 'unknown',
      });
      addEdge(edges, adjacency, {
        id: `${lineId}:b`, lineId, kind: 'run', from: junction, to,
        flow: null, utilization: null, status: 'unknown',
      });
    } else {
      addEdge(edges, adjacency, {
        id: lineId, lineId, kind: 'run', from, to,
        flow: null, utilization: null, status: 'unknown',
      });
    }
  }

  // Discovery can join components without an explicit endpoint-to-endpoint
  // line (covered distribution buses, physical adjacency, contact tees). Keep
  // those members in the graph through a clearly-labelled logical junction.
  // These virtual links deliberately disable exact branch-flow attribution.
  const groups = components(nodes, adjacency);
  let hasImplicitLinks = false;
  if (groups.length > 1) {
    hasImplicitLinks = true;
    const hub = ensureSynthetic(`network:${network.id}`, 'junction').id;
    for (const group of groups) {
      const representative = group.find(id => id !== hub);
      if (!representative) continue;
      addEdge(edges, adjacency, {
        id: `implicit:${hub}:${representative}`, lineId: null, kind: 'implicit',
        from: hub, to: representative, flow: null, utilization: null, status: 'shared',
      });
    }
  }

  const rootIds = [...nodes.values()]
    .filter(node => node.kind === 'equipment' && node.roles.includes('source'))
    .map(node => node.id).sort();
  assignDepths(nodes, adjacency, rootIds);

  const connected = components(nodes, adjacency).length <= 1;
  const hasSelfLoop = edges.some(edge => edge.from === edge.to);
  const hasCycle = connected && (hasSelfLoop || edges.length >= nodes.size);
  const topologyOnly = descriptor?.topologyOnly === true;
  const radial = !topologyOnly && rootIds.length === 1 && connected
    && !hasCycle && !hasImplicitLinks && edges.length === Math.max(0, nodes.size - 1);
  if (radial) {
    assignRadialLoads(nodes, edges, adjacency, rootIds[0], Math.max(0, finite(flow?.totalCapacity)));
  }

  for (const node of nodes.values()) {
    if (node.kind === 'open') continue;
    if (node.fault) node.status = 'off';
    else if (node.quality != null && node.quality <= 0) node.status = 'off';
    else if (node.quality != null && node.quality < 0.999) node.status = 'constrained';
    else if (node.roles.includes('source') && node.capacity <= 0) node.status = 'off';
    else if (radial && node.downstreamDemand <= 0 && !node.roles.includes('sink')) node.status = 'idle';
  }

  const runLoads = new Map();
  for (const edge of edges) {
    if (!edge.lineId) continue;
    const current = runLoads.get(edge.lineId);
    if (!current || finite(edge.flow, -1) > finite(current.flow, -1)) {
      runLoads.set(edge.lineId, {
        lineId: edge.lineId,
        load: Number.isFinite(edge.flow) ? edge.flow : null,
        utilization: Number.isFinite(edge.utilization) ? edge.utilization : null,
        status: edge.status,
      });
    }
  }

  const nodeList = [...nodes.values()].sort((a, b) =>
    a.depth - b.depth || String(a.id).localeCompare(String(b.id)));
  const diagnostics = {
    deadBranches: [...runLoads.values()].filter(run => run.status === 'dead').length,
    constrainedNodes: nodeList.filter(node => node.status === 'constrained').length,
    deenergizedNodes: nodeList.filter(node => node.status === 'off').length,
    idleNodes: nodeList.filter(node => node.status === 'idle').length,
    openEnds: nodeList.filter(node => node.kind === 'open').length,
  };

  return {
    networkId: network.id,
    utilityType: network.utilityType,
    direction: topologyOnly ? 'shared' : 'source-to-load',
    radial,
    hasCycle,
    hasImplicitLinks,
    rootIds,
    maxDepth: nodeList.reduce((max, node) => Math.max(max, node.depth || 0), 0),
    nodes: nodeList,
    edges,
    perSegmentLoad: [...runLoads.values()].sort((a, b) => a.lineId.localeCompare(b.lineId)),
    diagnostics,
  };
}

export default buildUtilityTopologySnapshot;
