// Presentation-only radiation emitters derived from the ordered beamline and
// already-published physics envelope. This module deliberately has no THREE or
// game-state dependency so the snapshot boundary remains easy to test.

import { cyclotronExtractionContract } from './cyclotron-presentation.js';

const DEFAULT_STRENGTH = 0.55;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function elementEnd(element) {
  return (Number(element?.beamStart) || 0) + Math.max(0, Number(element?.subL) || 0) * 0.5;
}

function nearestEnvelopeSample(envelope, position) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const sample of (Array.isArray(envelope) ? envelope : [])) {
    if (!Number.isFinite(sample?.s)) continue;
    const distance = Math.abs(sample.s - position);
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Map published beam power into a readable effect weight without re-solving it. */
export function radiationVisualStrength(beamPowerMw) {
  if (!Number.isFinite(beamPowerMw)) return DEFAULT_STRENGTH;
  const power = Math.max(0, beamPowerMw);
  return clamp01(0.22 + 0.78 * Math.log1p(power) / Math.log(101));
}

/**
 * Return renderer descriptors for a live beam path.
 *
 * `elements` are flattenPath entries decorated at the snapshot boundary with
 * `physicsType`, `isDipole`, and `isEndpoint` from the component catalogue.
 * Positions are normalized because BeamBuilder owns the final routed polyline.
 */
export function beamRadiationEvents(elements = [], envelope = [], beamlineType = null) {
  const ordered = (elements || []).filter(element => element?.kind !== 'drift');
  if (!ordered.length) return [];

  const totalLength = Math.max(...(elements || []).map(elementEnd), 0);
  if (!(totalLength > 0)) return [];

  const events = [];
  for (const element of ordered) {
    if (!(element.isDipole || element.physicsType === 'dipole')) continue;
    const centre = (Number(element.beamStart) || 0)
      + Math.max(0, Number(element.subL) || 0) * 0.25;
    const sample = nearestEnvelopeSample(envelope, centre);
    const protonLike = String(beamlineType?.particle || '').startsWith('p');
    events.push({
      kind: 'synchrotron',
      elementId: element.id,
      u: clamp01(centre / totalLength),
      strength: radiationVisualStrength(sample?.beam_power_mw) * (protonLike ? 0.42 : 1),
      beta: Number.isFinite(sample?.rel_beta) ? clamp01(sample.rel_beta) : 0.66,
      energyGeV: Math.max(0, Number(sample?.energy) || 0),
    });
  }

  const endpoint = ordered[ordered.length - 1];
  if (endpoint?.isEndpoint) {
    const sample = nearestEnvelopeSample(envelope, Number(endpoint.beamStart) || totalLength);
    events.push({
      kind: 'impact',
      elementId: endpoint.id,
      endpointType: endpoint.physicsType || 'beamStop',
      // The routed path terminates at the endpoint aperture, which is exactly
      // where the visible shower starts even though the absorber has length.
      u: 1,
      strength: radiationVisualStrength(sample?.beam_power_mw),
      beta: Number.isFinite(sample?.rel_beta) ? clamp01(sample.rel_beta) : 0.66,
      energyGeV: Math.max(0, Number(sample?.energy) || 0),
    });
  }

  return events;
}

/** Describe source-internal motion that joins the first outgoing beam pipe. */
export function beamSourceEffect(elements = []) {
  const source = (elements || []).find(element => element?.kind === 'module');
  if (!source) return null;
  const width = Math.max(0.5, (Number(source.subW) || 2) * 0.5);
  const length = Math.max(0.5, (Number(source.subL) || 2) * 0.5);
  if (/^cyclotron\d+$/i.test(source.type || '')) {
    const extraction = cyclotronExtractionContract(source.type, Math.min(width, length));
    return {
      kind: 'cyclotronSpiral', elementId: source.id,
      radius: Math.hypot(extraction.orbitExitSide, extraction.orbitExitForward),
      ...extraction,
    };
  }
  if (source.type === 'ecrIonSource') {
    return {
      kind: 'plasmaVortex', elementId: source.id,
      radius: Math.min(width, length) * 0.19,
      sourceLength: length,
    };
  }
  return null;
}
