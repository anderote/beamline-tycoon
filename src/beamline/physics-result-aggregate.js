// Facility-level read model derived from already-computed per-beamline
// results. The old path ran Python a second time for every source solely to
// recreate this summary.

export function aggregateBeamlinePhysics(entries, orderedGraph = []) {
  const sourceOffsets = new Map();
  for (const node of orderedGraph || []) {
    if (node?.id != null && !sourceOffsets.has(node.id)) {
      sourceOffsets.set(node.id, node.beamStart || 0);
    }
  }
  const runs = (entries || []).filter(entry =>
    Array.isArray(entry?.beamState?.physicsEnvelope)
      && entry.beamState.physicsEnvelope.length > 0);
  if (runs.length === 0) return null;

  const best = runs.reduce((a, b) =>
    ((b.beamState.beamEnergy || 0) > (a.beamState.beamEnergy || 0) ? b : a));
  const bs = best.beamState;
  const sum = key => runs.reduce((total, entry) => total + (entry.beamState[key] || 0), 0);
  const main = {
    beamEnergy: bs.beamEnergy || 0,
    beamCurrent: bs.beamCurrent || 0,
    beamQuality: bs.beamQuality || 0,
    totalLossFraction: bs.totalLossFraction || 0,
    discoveryChance: bs.discoveryChance || 0,
    finalNormEmittanceX: bs.finalNormEmittanceX,
    finalBunchLength: bs.finalBunchLength,
    felSaturated: runs.some(entry => entry.beamState.felSaturated),
    dataRate: sum('dataRate'),
    collisionRate: sum('collisionRate'),
    photonRate: sum('photonRate'),
    luminosity: sum('luminosity'),
    nDiagnostics: sum('nDiagnostics'),
    beamAlive: runs.some(entry => entry.beamState.physicsAlive),
  };
  const envelope = [];
  for (const entry of runs) {
    const offset = sourceOffsets.get(entry.sourceId) || 0;
    for (const sample of entry.beamState.physicsEnvelope) {
      envelope.push(offset ? { ...sample, s: (sample.s || 0) + offset } : sample);
    }
  }
  main.envelope = envelope;
  return main;
}
