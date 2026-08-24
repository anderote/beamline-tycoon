// Rendering and interaction helpers for SolveRunner's utility topology graph.

import { escapeHtml } from './format.js';
import { makeDraggable } from './draggable.js';

const PAN_EXCLUDE = 'button, a, input, select, textarea, [role="button"]';

/**
 * Turn the topology viewport into a grab-to-pan surface. Horizontal motion
 * moves the wide graph while vertical motion moves its owning context-window
 * body, so a large topology can be explored without chasing either scrollbar.
 * The drag implementation is injectable to keep this DOM wiring testable in
 * the non-browser suite.
 */
export function bindUtilityTopologyPan(canvas, options = {}) {
  if (!canvas) return () => {};
  const scrollParent = options.scrollParent || canvas.closest?.('.ctx-body') || null;
  const drag = options.makeDraggable || makeDraggable;
  const reportScroll = () => options.onScroll?.({
    left: canvas.scrollLeft || 0,
    top: scrollParent?.scrollTop || 0,
  });
  const handleCanvasScroll = () => reportScroll();
  const handleParentScroll = () => reportScroll();

  canvas.addEventListener('scroll', handleCanvasScroll, { passive: true });
  scrollParent?.addEventListener?.('scroll', handleParentScroll, { passive: true });

  const disposeDrag = drag(canvas, canvas, {
    button: 0,
    threshold: 3,
    exclude: PAN_EXCLUDE,
    grabCursor: true,
    onStart: () => {
      options.onPanStart?.();
      return {
        left: canvas.scrollLeft || 0,
        top: scrollParent?.scrollTop || 0,
      };
    },
    onMove: (_event, dx, dy, start) => {
      canvas.scrollLeft = start.left - dx;
      if (scrollParent) scrollParent.scrollTop = start.top - dy;
      canvas.classList?.add('is-panning');
      reportScroll();
    },
    onEnd: (_event, moved) => {
      canvas.classList?.remove('is-panning');
      options.onPanEnd?.(moved);
      reportScroll();
    },
  });

  return () => {
    disposeDrag?.();
    canvas.removeEventListener('scroll', handleCanvasScroll);
    scrollParent?.removeEventListener?.('scroll', handleParentScroll);
    canvas.classList?.remove('is-panning');
  };
}

function qty(value) {
  if (!Number.isFinite(value)) return '--';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 0.1 && magnitude < 1e6) return value.toFixed(1);
  return value.toExponential(2);
}

const STATUS = Object.freeze({
  healthy: { label: 'Flowing', tone: 'good' },
  constrained: { label: 'Constrained', tone: 'warn' },
  off: { label: 'De-energized', tone: 'bad' },
  idle: { label: 'Idle branch', tone: 'idle' },
  dead: { label: 'Dead end', tone: 'bad' },
  shared: { label: 'Shared flow', tone: 'neutral' },
  unknown: { label: 'Shared flow', tone: 'neutral' },
});

const FAULT_LABEL = Object.freeze({
  breaker_tripped: 'Breaker tripped',
  breaker_open: 'Breaker open',
  switch_open: 'Switch open',
  grid_outage: 'Grid outage',
  generator_disabled: 'Generator disabled',
  fuel_empty: 'Generator out of fuel',
});

function nodeKind(node) {
  if (node.kind === 'open') return 'Open cable end';
  if (node.kind === 'junction') return 'Network junction';
  if (node.roles?.includes('peer')) return 'Peer';
  if (node.roles?.includes('source') && node.roles?.includes('sink')) return 'Converter';
  if (node.roles?.includes('source')) return 'Source';
  if (node.roles?.includes('sink')) return 'Load';
  return 'Distribution';
}

function layerLabel(depth, maxDepth, direction) {
  if (direction === 'shared') return depth === 0 ? 'Shared network' : `Connected layer ${depth + 1}`;
  if (depth === 0) return 'Supply';
  if (depth === maxDepth) return 'Loads';
  return `Distribution ${depth}`;
}

function renderNode(node, options) {
  const status = STATUS[node.status] || STATUS.unknown;
  const label = node.placeableId
    ? options.labelFor(node.placeableId)
    : node.kind === 'open' ? 'Unterminated run' : 'Logical junction';
  const metrics = [];
  if (node.roles?.includes('source')) {
    metrics.push(`<span><small>Available</small><strong>${qty(node.capacity)} ${escapeHtml(options.capacityUnit)}</strong></span>`);
  }
  if (node.roles?.includes('sink')) {
    metrics.push(`<span><small>Load</small><strong>${qty(node.demand)} ${escapeHtml(options.demandUnit)}</strong></span>`);
  } else if (Number.isFinite(node.downstreamDemand)) {
    metrics.push(`<span><small>Downstream</small><strong>${qty(node.downstreamDemand)} ${escapeHtml(options.demandUnit)}</strong></span>`);
  }
  if (Number.isFinite(node.quality)) {
    metrics.push(`<span><small>Delivered</small><strong>${Math.round(node.quality * 100)}%</strong></span>`);
  }
  const actions = node.placeableId ? (options.actionsFor(node.placeableId) || []) : [];
  const actionHtml = actions.length > 0
    ? `<div class="utility-topology-actions">${actions.map(action =>
      `<button type="button" data-topology-placeable="${escapeHtml(node.placeableId)}" data-topology-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join('')}</div>`
    : '';
  const fault = node.fault ? `<div class="utility-topology-node-fault">${escapeHtml(FAULT_LABEL[node.fault] || node.fault)}</div>` : '';
  return `<article class="utility-topology-node utility-topology-node-${escapeHtml(status.tone)}">
    <div class="utility-topology-node-heading">
      <span class="utility-topology-node-kind">${escapeHtml(nodeKind(node))}</span>
      <span class="utility-topology-node-status">${escapeHtml(status.label)}</span>
    </div>
    <strong class="utility-topology-node-name">${escapeHtml(label)}</strong>
    ${fault}
    ${metrics.length ? `<div class="utility-topology-node-metrics">${metrics.join('')}</div>` : ''}
    ${actionHtml}
  </article>`;
}

function renderEdge(edge, topology, options) {
  const byId = options.nodesById;
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  const fromLabel = from?.placeableId ? options.labelFor(from.placeableId) : nodeKind(from || {});
  const toLabel = to?.placeableId ? options.labelFor(to.placeableId) : nodeKind(to || {});
  const status = STATUS[edge.status] || STATUS.unknown;
  const magnitude = Number.isFinite(edge.flow)
    ? `${qty(edge.flow)} ${escapeHtml(options.demandUnit)}`
    : topology.direction === 'shared' ? 'bidirectional' : 'shared / non-radial';
  return `<div class="utility-topology-edge utility-topology-edge-${escapeHtml(status.tone)}">
    <span class="utility-topology-edge-arrow">↓</span>
    <span class="utility-topology-edge-route">${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)}</span>
    <strong>${magnitude}</strong>
    <span>${escapeHtml(status.label)}</span>
  </div>`;
}

export function renderUtilityTopology(topology, options = {}) {
  if (!topology || !Array.isArray(topology.nodes)) {
    return `<div class="ui-empty-state">Topology telemetry is waiting for the next utility solve.</div>`;
  }
  const settings = {
    labelFor: options.labelFor || (id => id),
    actionsFor: options.actionsFor || (() => []),
    capacityUnit: options.capacityUnit || '',
    demandUnit: options.demandUnit || options.capacityUnit || '',
  };
  settings.nodesById = new Map(topology.nodes.map(node => [node.id, node]));
  const diagnostics = topology.diagnostics || {};
  const chips = [
    topology.radial ? ['Radial', 'good']
      : topology.direction === 'shared' ? ['Bidirectional bus', 'neutral'] : ['Shared / meshed flow', 'neutral'],
    diagnostics.constrainedNodes > 0 ? [`${diagnostics.constrainedNodes} constrained`, 'warn'] : null,
    diagnostics.deenergizedNodes > 0 ? [`${diagnostics.deenergizedNodes} de-energized`, 'bad'] : null,
    diagnostics.deadBranches > 0 ? [`${diagnostics.deadBranches} dead branch${diagnostics.deadBranches === 1 ? '' : 'es'}`, 'bad'] : null,
    diagnostics.idleNodes > 0 ? [`${diagnostics.idleNodes} idle`, 'idle'] : null,
  ].filter(Boolean);

  const byDepth = new Map();
  for (const node of topology.nodes) {
    const depth = Number.isFinite(node.depth) ? node.depth : 0;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(node);
  }
  let graph = '';
  const renderedEdges = new Set();
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (let i = 0; i < depths.length; i++) {
    const depth = depths[i];
    const nodes = byDepth.get(depth);
    graph += `<section class="utility-topology-level">
      <div class="utility-topology-level-label">${escapeHtml(layerLabel(depth, topology.maxDepth || 0, topology.direction))}</div>
      <div class="utility-topology-level-nodes">${nodes.map(node => renderNode(node, settings)).join('')}</div>
    </section>`;
    if (i >= depths.length - 1) continue;
    const nextDepth = depths[i + 1];
    const crossing = (topology.edges || []).filter(edge => {
      const a = settings.nodesById.get(edge.from)?.depth;
      const b = settings.nodesById.get(edge.to)?.depth;
      return Math.min(a, b) === depth && Math.max(a, b) === nextDepth;
    });
    if (crossing.length) {
      for (const edge of crossing) renderedEdges.add(edge.id);
      graph += `<div class="utility-topology-edges">${crossing.map(edge =>
        renderEdge(edge, topology, settings)).join('')}</div>`;
    }
  }
  const crossLinks = (topology.edges || []).filter(edge => !renderedEdges.has(edge.id));
  if (crossLinks.length) {
    graph += `<section class="utility-topology-crosslinks">
      <div class="utility-topology-level-label">Cross-links and shared joins</div>
      <div class="utility-topology-edges">${crossLinks.map(edge =>
        renderEdge(edge, topology, settings)).join('')}</div>
    </section>`;
  }

  return `<div class="utility-topology">
    <div class="utility-topology-intro">
      <div><strong>Live network flow</strong><span>Supply flows downward. Drag the diagram to pan.</span></div>
      <div class="utility-topology-chips">${chips.map(([label, tone]) =>
        `<span class="utility-topology-chip utility-topology-chip-${tone}">${escapeHtml(label)}</span>`).join('')}</div>
    </div>
    <div class="utility-topology-canvas" tabindex="0" role="region" aria-label="Network topology diagram. Drag to pan.">${graph}</div>
    ${!topology.radial && topology.direction !== 'shared'
      ? '<p class="utility-topology-footnote">Exact branch quantities are withheld for loops, implicit joins, and multi-source networks because flow can take more than one valid path.</p>' : ''}
  </div>`;
}

export default renderUtilityTopology;
