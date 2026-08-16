// Pure planning helpers for the contextual "Build Forward" assistant.
// Keeping recommendation policy out of the DOM/input controller makes it
// testable and ensures the world helper and Designer speak about the same
// beamline type without embedding UI state in the save model.

import { COMPONENTS } from '../data/components.js';
import {
  BEAMLINE_TYPES,
  getBeamlineType,
} from '../data/beamline-types.js';
import { computeBeamlinePlacementHints } from './designer-placement-hints.js';

export const GUIDED_UTILITY_ORDER = Object.freeze([
  'powerCable', 'rfWaveguide', 'coolingWater', 'vacuumPipe',
  'cryoTransfer', 'dataFiber',
]);

export const GUIDED_UTILITY_LABELS = Object.freeze({
  powerCable: 'Electrical power',
  rfWaveguide: 'RF power',
  coolingWater: 'Cooling water',
  vacuumPipe: 'Vacuum',
  cryoTransfer: 'Cryogenics',
  dataFiber: 'Data & controls',
});

function sourceAllowsType(source, typeId) {
  return !Array.isArray(source?.beamlineTypes) || source.beamlineTypes.includes(typeId);
}

export function compatibleBeamlineTypesForSource(sourceType) {
  const source = COMPONENTS[sourceType];
  if (!source?.isSource) return [];
  return Object.values(BEAMLINE_TYPES).filter(type =>
    sourceAllowsType(source, type.id));
}

export function componentAllowedForBeamline(typeId, componentId, isUnlocked = () => true) {
  const comp = COMPONENTS[componentId];
  if (!comp || !isUnlocked(comp)) return false;
  const type = getBeamlineType(typeId);
  if (!type) return true;
  if (Array.isArray(comp.beamlineTypes) && !comp.beamlineTypes.includes(typeId)) return false;
  if (Array.isArray(type.excludes) && type.excludes.includes(componentId)) return false;
  return true;
}

/**
 * Recommend the next on-pipe components from the exact physics advisor used
 * by Designer. `primary` is the first source-to-endpoint recipe, while the
 * complete list remains available to callers that need to skip a location
 * which cannot accept another physical component.
 */
export function guidedPlacementSuggestions({
  typeId = null, nodes = [], envelope = [], isUnlocked = () => true,
} = {}) {
  const hints = computeBeamlinePlacementHints({
    typeId,
    nodes,
    envelope,
    isUnlocked,
  });
  return {
    primary: hints[0] || null,
    alternatives: hints.slice(1, 3),
    hints,
  };
}

function nodeEndS(node) {
  return (node?.beamStart || 0) + Math.max(0, node?.subL || 0) * 0.5;
}

/**
 * Translate a Designer insertion recipe into a real pipe coordinate. The
 * physics hint's `s` is the preferred location; the before/after node boundary
 * is a fallback for older recipes. Reverse-traversed pipes are mapped back to
 * their authored start-relative coordinate.
 */
export function guidedPlacementTarget({ nodes = [], pipes = [], hint } = {}) {
  if (!hint?.componentType || nodes.length === 0 || pipes.length === 0) return null;
  const nodeIndex = Math.max(0, Math.min(nodes.length - 1, hint.nodeIndex || 0));
  const targetNode = nodes[nodeIndex];
  const fallbackS = hint.position === 'before'
    ? (targetNode?.beamStart || 0)
    : nodeEndS(targetNode);
  const boundaryS = Number.isFinite(hint.s) ? hint.s : fallbackS;

  let pipeNodeIndex = targetNode?.pipeId ? nodeIndex : -1;
  if (pipeNodeIndex < 0) {
    const step = hint.position === 'before' ? -1 : 1;
    for (let i = nodeIndex + step; i >= 0 && i < nodes.length; i += step) {
      if (nodes[i]?.pipeId) {
        pipeNodeIndex = i;
        break;
      }
    }
  }
  if (pipeNodeIndex < 0) {
    let bestDistance = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i]?.pipeId) continue;
      const lo = nodes[i].beamStart || 0;
      const hi = nodeEndS(nodes[i]);
      const distance = boundaryS < lo ? lo - boundaryS : boundaryS > hi ? boundaryS - hi : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        pipeNodeIndex = i;
      }
    }
  }
  const pipeId = nodes[pipeNodeIndex]?.pipeId;
  const pipe = pipes.find(candidate => candidate?.id === pipeId);
  if (!pipe || !(pipe.subL > 0)) return null;

  const pipeIndices = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]?.pipeId === pipeId) pipeIndices.push(i);
  }
  if (pipeIndices.length === 0) return null;
  const firstIndex = pipeIndices[0];
  const pipeBeamStart = Math.min(...pipeIndices.map(i => nodes[i].beamStart || 0));
  let previousModule = null;
  for (let i = firstIndex - 1; i >= 0; i--) {
    if (nodes[i]?.kind === 'module') {
      previousModule = nodes[i];
      break;
    }
  }
  const traversalAnchorId = previousModule?.id
    || nodes.find(node => node?.kind === 'module')?.id
    || null;
  const forward = !traversalAnchorId || pipe.start?.junctionId === traversalAnchorId;

  const pipeLengthM = pipe.subL * 0.5;
  const def = COMPONENTS[hint.componentType];
  const componentLengthM = def?.attachmentKind === 'inline'
    ? 0
    : Math.max(0, def?.subL || 2) * 0.5;
  const offsetM = Math.max(0, Math.min(pipeLengthM, boundaryS - pipeBeamStart));
  const rawPosition = forward
    ? offsetM / pipeLengthM
    : (pipeLengthM - offsetM - componentLengthM) / pipeLengthM;
  const maxPosition = Math.max(0, 1 - componentLengthM / pipeLengthM);

  return {
    pipeId,
    position: Math.max(0, Math.min(maxPosition, rawPosition)),
    forward,
  };
}

export function guidedEndpointSuggestions(typeId, isUnlocked = () => true) {
  const required = getBeamlineType(typeId)?.requiredEndpoint || [];
  return required.filter(id => componentAllowedForBeamline(typeId, id, isUnlocked));
}

function nodeSinkPorts(node) {
  const def = COMPONENTS[node?.type];
  if (!def?.ports) return [];
  return Object.entries(def.ports)
    .filter(([, spec]) => spec?.utility && spec.role === 'sink')
    .map(([portName, spec]) => ({ node, portName, spec }));
}

function lineTouchesPort(state, nodeId, portName) {
  const lines = state?.utilityLines;
  const values = lines instanceof Map ? lines.values() : Object.values(lines || {});
  for (const line of values) {
    for (const end of [line?.start, line?.end]) {
      if (end?.placeableId === nodeId && end?.portName === portName) return true;
    }
  }
  return false;
}

function sinkIsConnected(state, sink) {
  const id = sink.node?.id;
  if (!id) return false;
  if (state?.unwiredSinks?.[id]?.[sink.spec.utility]) return false;
  // Once the utility gate has published its complete unwired map, absence from
  // that map means a bus or real line covers the sink. Before the first solve,
  // require a literal endpoint connection instead of optimistically checking it.
  if (state?.unwiredSinks) return true;
  return lineTouchesPort(state, id, sink.portName);
}

function requirementAmount(spec) {
  const p = spec?.params || {};
  return p.demand ?? p.heatLoad ?? p.rfPowerRequired ?? p.srfHeatW
    ?? p.outgassing ?? 0;
}

export function infrastructureChecklistForNodes(nodes = [], state = null) {
  const byUtility = new Map();
  for (const node of nodes) {
    for (const sink of nodeSinkPorts(node)) {
      const utility = sink.spec.utility;
      if (!byUtility.has(utility)) byUtility.set(utility, []);
      byUtility.get(utility).push(sink);
    }
  }

  return GUIDED_UTILITY_ORDER.flatMap((utility) => {
    const sinks = byUtility.get(utility) || [];
    if (sinks.length === 0) return [];
    const connected = sinks.filter(s => sinkIsConnected(state, s)).length;
    const amount = sinks.reduce((sum, s) => sum + requirementAmount(s.spec), 0);
    const frequencies = [...new Set(sinks
      .map(s => s.spec?.params?.frequency)
      .filter(Number.isFinite))].sort((a, b) => a - b);
    return [{
      utility,
      label: GUIDED_UTILITY_LABELS[utility] || utility,
      sinkCount: sinks.length,
      connected,
      complete: connected === sinks.length,
      amount,
      frequencies,
    }];
  });
}
