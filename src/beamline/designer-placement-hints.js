// Physics-aware, non-mutating build suggestions for the Beamline Designer.
//
// This module deliberately knows nothing about the canvas or live Game state.
// It turns a draft, its propagated envelope, and the selected machine mission
// into insertion recipes. BeamlineDesigner decides which components are
// unlocked/visible, the renderer decides how to present them, and accepting a
// recipe goes through the designer's ordinary undoable insert path.

import { COMPONENTS } from '../data/components.js';

const FOCUS_TYPES = new Set([
  'quadrupole', 'scQuad', 'protonQuad', 'combinedFunctionMagnet', 'solenoid',
]);

const BUNCH_PREP_TYPES = new Set([
  'buncher', 'rfq', 'ncRfGun', 'srfGun',
]);

const URGENCY_THRESHOLD = 0.7;
const MAX_FOCUS_HINTS = 12;
const URGENCY_DRIFT_SCALE_M = 20.0;

function nodeLengthM(node) {
  const comp = node ? COMPONENTS[node.type] : null;
  const subL = (node && typeof node.subL === 'number' && node.subL > 0)
    ? node.subL
    : ((comp && comp.subL) || 4);
  return subL * 0.5;
}

function nodeIndexAtS(nodes, s) {
  if (!nodes.length) return 0;
  let acc = 0;
  for (let i = 0; i < nodes.length; i++) {
    acc += nodeLengthM(nodes[i]);
    if (acc >= s) return i;
  }
  return nodes.length - 1;
}

function boundaryAfterNode(nodes, index) {
  let s = 0;
  for (let i = 0; i <= index && i < nodes.length; i++) s += nodeLengthM(nodes[i]);
  return s;
}

function lastInsertionBoundary(nodes) {
  if (!nodes.length) return { nodeIndex: 0, position: 'before', s: 0 };
  const last = nodes.length - 1;
  const lastComp = COMPONENTS[nodes[last].type];
  if (lastComp?.category === 'endpoint' && last > 0) {
    return { nodeIndex: last, position: 'before', s: boundaryAfterNode(nodes, last - 1) };
  }
  return { nodeIndex: last, position: 'after', s: boundaryAfterNode(nodes, last) };
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function formatEnergy(gev) {
  const value = Math.max(0, finite(gev));
  if (value >= 1) return `${value.toFixed(value >= 10 ? 1 : 2)} GeV`;
  if (value >= 1e-3) return `${(value * 1e3).toFixed(value >= 0.1 ? 0 : 1)} MeV`;
  return `${(value * 1e6).toFixed(value >= 1e-4 ? 0 : 1)} keV`;
}

function formatEnergyBand(band) {
  if (!Array.isArray(band) || band.length < 2) return 'mission energy band';
  const [lo, hi] = band;
  if (lo == null) return `≤ ${formatEnergy(hi)}`;
  if (hi == null) return `≥ ${formatEnergy(lo)}`;
  return `${formatEnergy(lo)}–${formatEnergy(hi)}`;
}

function componentLabel(type) {
  return COMPONENTS[type]?.name || type;
}

function hintBase(id, kind, componentType, s, nodeIndex, position, priority) {
  return {
    id,
    kind,
    componentType,
    label: `ADD ${componentLabel(componentType).toUpperCase()}`,
    s,
    nodeIndex,
    position,
    priority,
    params: {},
  };
}

function focusHints(nodes, envelope, beamlineType, isAvailable) {
  if (!envelope || envelope.length < 2 || !nodes.length) return [];

  const existingFocusS = [];
  let nextQuadPolarity = 1;
  let cumS = 0;
  for (const node of nodes) {
    const length = nodeLengthM(node);
    if (FOCUS_TYPES.has(node.type)) {
      existingFocusS.push(cumS + length / 2);
      if (node.type !== 'solenoid') {
        const polarity = node.params?.polarity;
        nextQuadPolarity = polarity === 1 ? -1 : 1;
      }
    }
    cumS += length;
  }

  const mid = envelope[Math.floor(envelope.length / 2)];
  const pGev = Math.max(finite(mid?.energy, 0.01), 1e-6);
  const refFocal = pGev / (0.2998 * 20.0 * 2.0);
  const cellLength = Math.max(refFocal * 2, 3.0);
  const spacing = Math.max(3.0, URGENCY_THRESHOLD * URGENCY_DRIFT_SCALE_M * 0.85);
  const particle = beamlineType?.particle || 'e-';
  const ionBeam = particle !== 'e-';

  const out = [];
  let nextS = -Infinity;
  for (const datum of envelope) {
    if (out.length >= MAX_FOCUS_HINTS) break;
    const urgency = finite(datum?.focus_urgency);
    if (urgency < URGENCY_THRESHOLD) continue;

    const s = finite(datum?.s);
    if (s < nextS) continue;

    const nearby = existingFocusS.find(qs => qs >= s - spacing && qs <= s + cellLength);
    if (nearby !== undefined) {
      nextS = nearby + spacing;
      continue;
    }

    // Solenoids are the natural first remedy for a slow ion beam; once the
    // beam has reached a few MeV, or on an electron line, use an alternating
    // quadrupole lattice. Availability is supplied by the designer so a rule
    // never offers locked or machine-incompatible hardware.
    const kineticGev = finite(datum?.energy);
    let componentType = ionBeam && kineticGev <= 0.005 && isAvailable('solenoid')
      ? 'solenoid'
      : 'quadrupole';
    if (!isAvailable(componentType)) {
      componentType = componentType === 'solenoid' ? 'quadrupole' : 'solenoid';
    }
    if (!isAvailable(componentType)) continue;

    const nodeIndex = nodeIndexAtS(nodes, s);
    const hint = hintBase(
      `focus:${componentType}:${s.toFixed(3)}`,
      'focus', componentType, s, nodeIndex, 'after', 70 + urgency * 10,
    );
    const margin = finite(datum?.focus_margin, 1);
    hint.reason = componentType === 'solenoid'
      ? 'LOW-ENERGY BEAM EXPANDING'
      : 'BEAM DIVERGING TOWARD APERTURE';
    hint.state = `${formatEnergy(kineticGev)} · margin ${Math.round(margin * 100)}%`;
    hint.target = 'restore focusing margin';
    hint.confidence = urgency >= 0.9 ? 'high' : 'medium';
    if (componentType === 'quadrupole') {
      hint.params.polarity = nextQuadPolarity;
      hint.axis = nextQuadPolarity === 1 ? 'X' : 'Y';
      nextQuadPolarity *= -1;
    }
    out.push(hint);
    nextS = s + spacing;
  }
  return out;
}

function bunchingHint(nodes, envelope, beamlineType, isAvailable) {
  if (!nodes.length || !envelope?.length) return null;
  if (nodes.some(node => BUNCH_PREP_TYPES.has(node.type))) return null;

  const first = envelope[0];
  if (finite(first?.bunch_frequency) > 0) return null;

  const particle = beamlineType?.particle || 'e-';
  const ionBeam = particle !== 'e-';
  let componentType = ionBeam ? 'rfq' : 'buncher';
  if (!isAvailable(componentType)) componentType = 'buncher';
  if (!isAvailable(componentType)) return null;

  const sourceIndex = Math.max(0, nodes.findIndex(node => COMPONENTS[node.type]?.category === 'source'));
  const s = boundaryAfterNode(nodes, sourceIndex);
  const hint = hintBase(
    `capture:${componentType}:${sourceIndex}`,
    'longitudinal', componentType, s, sourceIndex, 'after', 96,
  );
  hint.reason = ionBeam ? 'DC ION BEAM NEEDS CAPTURE' : 'DC BEAM NEEDS RF BUNCHING';
  hint.state = `${formatEnergy(first?.energy)} · unbunched`;
  hint.target = ionBeam ? 'capture into proton RF' : 'establish RF buckets';
  hint.confidence = 'high';
  return hint;
}

function acceleratorCandidates(beamlineType, kineticGev) {
  const id = beamlineType?.id;
  const ionBeam = beamlineType?.particle && beamlineType.particle !== 'e-';
  if (ionBeam) {
    if (kineticGev < 0.001) return ['rfq', 'halfWaveResonator'];
    if (kineticGev < 0.02) return ['halfWaveResonator', 'spokeCavity'];
    if (kineticGev < 0.18) return ['spokeCavity', 'halfWaveResonator', 'srf650Cryomodule'];
    if (kineticGev < 0.6) return ['srf650Cryomodule', 'spokeCavity', 'srf805Cryomodule'];
    return ['srf805Cryomodule', 'srf650Cryomodule', 'cwCryomodule'];
  }
  if (id === 'ebeamProcessing') return ['industrialLinac', 'rfCavity', 'sbandStructure'];
  if (id === 'testStand') return ['pillboxCavity', 'rfCavity', 'sbandStructure'];
  return ['cryomodule', 'ellipticalSrfCavity', 'sbandStructure', 'rfCavity'];
}

function energyHint(nodes, envelope, beamlineType, isAvailable) {
  const band = beamlineType?.spec?.energyGeV;
  if (!Array.isArray(band) || band[0] == null || !envelope?.length || !nodes.length) return null;

  const final = envelope[envelope.length - 1];
  const kineticGev = finite(final?.energy);
  if (kineticGev >= band[0] * 0.985) return null;

  const componentType = acceleratorCandidates(beamlineType, kineticGev)
    .find(type => isAvailable(type));
  if (!componentType) return null;

  const insertion = lastInsertionBoundary(nodes);
  const hint = hintBase(
    `energy:${componentType}:${insertion.nodeIndex}:${insertion.position}`,
    'energy', componentType, insertion.s, insertion.nodeIndex, insertion.position, 82,
  );
  hint.reason = 'BEAM BELOW MISSION ENERGY';
  hint.state = `${formatEnergy(kineticGev)} now`;
  hint.target = `${formatEnergyBand(band)} at endpoint`;
  hint.confidence = 'medium';
  return hint;
}

function dedupeHints(hints) {
  const seen = new Set();
  return hints.filter(hint => {
    const key = `${hint.componentType}:${hint.nodeIndex}:${hint.position}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Build every currently actionable insertion recipe, ordered along the line. */
export function computePlacementHints({
  nodes = [],
  envelope = [],
  beamlineType = null,
  isAvailable = () => true,
} = {}) {
  const hints = focusHints(nodes, envelope, beamlineType, isAvailable);
  const bunch = bunchingHint(nodes, envelope, beamlineType, isAvailable);
  const energy = energyHint(nodes, envelope, beamlineType, isAvailable);
  if (bunch) hints.push(bunch);
  if (energy) hints.push(energy);
  return dedupeHints(hints).sort((a, b) => a.s - b.s || b.priority - a.priority);
}

/** Mission bands understood by the shared plot renderer. */
export function missionPlotTargets(beamlineType) {
  const spec = beamlineType?.spec || {};
  return {
    energyGeV: Array.isArray(spec.energyGeV) ? [...spec.energyGeV] : null,
    currentMA: Array.isArray(spec.currentMA) ? [...spec.currentMA] : null,
    spotSizeMm: Array.isArray(spec.spotSizeMm) ? [...spec.spotSizeMm] : null,
  };
}

export const PLACEMENT_HINT_CONSTANTS = Object.freeze({
  urgencyThreshold: URGENCY_THRESHOLD,
  maxFocusHints: MAX_FOCUS_HINTS,
});
