// Pure planning helpers for the contextual "Build Forward" assistant.
// Keeping recommendation policy out of the DOM/input controller makes it
// testable and ensures the world helper and Designer speak about the same
// beamline type without embedding UI state in the save model.

import { COMPONENTS } from '../data/components.js';
import {
  BEAMLINE_TYPES,
  getBeamlineType,
} from '../data/beamline-types.js';

const PREBUNCHED_SOURCES = new Set(['ncRfGun', 'srfGun']);
const FOCUSING = ['quadrupole', 'protonQuad', 'scQuad', 'combinedFunctionMagnet'];
const DIAGNOSTICS = ['bpm', 'ict', 'screen'];
const ELECTRON_ACCEL = [
  'pillboxCavity', 'rfCavity', 'sbandStructure', 'ellipticalSrfCavity',
  'cryomodule', 'cbandStructure', 'xbandStructure',
];
const PROTON_ACCEL = [
  'rfq', 'pillboxCavity', 'halfWaveResonator', 'spokeCavity',
  'ellipticalSrfCavity', 'srf650Cryomodule', 'srf805Cryomodule',
];

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

function firstAllowed(ids, typeId, isUnlocked, reject = new Set()) {
  return ids.find(id => !reject.has(id)
    && componentAllowedForBeamline(typeId, id, isUnlocked));
}

/**
 * Recommend the next few on-pipe components for a new line. This is an
 * intentionally short starter recipe, not an automatic optimiser: after the
 * first accelerator/focusing/diagnostic vocabulary is established the player
 * graduates to the Designer and its real physics plots.
 */
export function guidedPlacementSuggestions({
  sourceType, typeId = null, placements = [], isUnlocked = () => true,
} = {}) {
  const placedTypes = placements.map(p => p?.type).filter(Boolean);
  const placed = new Set(placedTypes);
  const type = getBeamlineType(typeId);
  const accelOrder = type?.particle === 'p+' ? PROTON_ACCEL : ELECTRON_ACCEL;
  const accelerator = firstAllowed(accelOrder, typeId, isUnlocked);
  const focusing = firstAllowed(FOCUSING, typeId, isUnlocked);
  const diagnostic = firstAllowed(DIAGNOSTICS, typeId, isUnlocked);
  const needsBuncher = !PREBUNCHED_SOURCES.has(sourceType)
    && componentAllowedForBeamline(typeId, 'buncher', isUnlocked);

  let primary = null;
  let reason = '';
  if (needsBuncher && !placed.has('buncher')) {
    primary = 'buncher';
    reason = 'Shape the continuous source beam into RF bunches';
  } else if (accelerator && !placedTypes.some(id => accelOrder.includes(id))) {
    primary = accelerator;
    reason = 'Add the first accelerating section';
  } else if (focusing && !placedTypes.some(id => FOCUSING.includes(id))) {
    primary = focusing;
    reason = 'Control the beam envelope before it grows';
  } else if (diagnostic && !placedTypes.some(id => DIAGNOSTICS.includes(id))) {
    primary = diagnostic;
    reason = 'Measure the beam before committing to a longer lattice';
  } else if (accelerator) {
    primary = accelerator;
    reason = 'Continue toward the selected beamline’s target energy';
  }

  const reject = new Set(primary ? [primary] : []);
  const alternatives = [];
  for (const id of ['buncher', accelerator, focusing, diagnostic].filter(Boolean)) {
    if (alternatives.length >= 2) break;
    if (reject.has(id) || placed.has(id)) continue;
    if (!componentAllowedForBeamline(typeId, id, isUnlocked)) continue;
    reject.add(id);
    alternatives.push(id);
  }

  const coreReady = (!needsBuncher || placed.has('buncher'))
    && placedTypes.some(id => accelOrder.includes(id))
    && placedTypes.some(id => FOCUSING.includes(id));

  return { primary, alternatives, reason, coreReady };
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
