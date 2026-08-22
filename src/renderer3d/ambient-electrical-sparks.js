// Low-frequency, presentation-only electrical spark scheduling.
//
// All electrical quantities consumed here are already published by the
// utility solver. This module never discovers topology or recalculates load;
// it only turns complete, energized connections and distributor utilization
// into bounded wall-clock event rates for the renderer.

export const HV_CONNECTION_SPARK_RATE_PER_SECOND = 1 / 300;
export const DISTRIBUTOR_MAX_SPARK_RATE_PER_SECOND = 1 / 180;

function values(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return collection.values();
  return collection;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function networkHasPort(network, placeableId, portName) {
  const portKey = `${placeableId}:${portName}`;
  return (network?.ports || []).some(port =>
    port?.portKey === portKey
      || (port?.placeableId === placeableId && port?.portName === portName));
}

function energizedHvNetworks(state) {
  const flows = state?.utilityNetworkData?.get?.('hvCable');
  return (state?.utilityNetworks?.get?.('hvCable') || []).filter(network => {
    const flow = flows?.get?.(network.id);
    return (flow?.totalCapacity || 0) > 0;
  });
}

/**
 * Build eligible emitters from solver-published state.
 *
 * A cable contributes one combined event rate split over its two plugged-in
 * ends. A distributor contributes only while its HV inlet is energized, its
 * breaker is closed, and it has real downstream demand. Its rate rises
 * linearly from zero to the deliberately low maximum at nameplate load.
 */
export function ambientElectricalSparkCandidates(state, getDefinition = () => null) {
  const energized = energizedHvNetworks(state);
  const energizedLineIds = new Set(energized.flatMap(network => network.lineIds || []));
  const candidates = [];

  for (const line of values(state?.utilityLines)) {
    if (!line?.id || line.utilityType !== 'hvCable'
        || !line.start || !line.end || line.buried === true
        || !energizedLineIds.has(line.id)) continue;
    const endpointRate = HV_CONNECTION_SPARK_RATE_PER_SECOND / 2;
    candidates.push({
      id: `hv:${line.id}:start`, kind: 'hvConnection', lineId: line.id,
      ref: line.start, ratePerSecond: endpointRate,
    });
    candidates.push({
      id: `hv:${line.id}:end`, kind: 'hvConnection', lineId: line.id,
      ref: line.end, ratePerSecond: endpointRate,
    });
  }

  const demands = state?.electricalSinkDemands;
  const liveDevices = state?.powerReliability?.devices || {};
  for (const placeable of state?.placeables || []) {
    const def = getDefinition(placeable?.type);
    const breaker = def?.electricalControl?.breaker;
    const rating = Number(breaker?.rating) || 0;
    if (!placeable?.id || def?.category !== 'power' || def?.subsection !== 'distribution'
        || !(rating > 0) || liveDevices[placeable.id]?.breakerTripped === true) continue;
    const inletNetwork = energized.find(network => networkHasPort(
      network, placeable.id, 'hv_in',
    ));
    if (!inletNetwork) continue;
    const demand = Number(demands?.get?.(`${placeable.id}:hv_in`)) || 0;
    const utilization = clamp01(demand / rating);
    if (!(utilization > 0)) continue;
    candidates.push({
      id: `distributor:${placeable.id}`,
      kind: 'distributor',
      placeableId: placeable.id,
      utilization,
      ratePerSecond: DISTRIBUTOR_MAX_SPARK_RATE_PER_SECOND * utilization,
    });
  }

  return candidates;
}

/** Pick at most one event from independent Poisson rates for a time window. */
export function chooseAmbientElectricalSpark(candidates, seconds = 1, random = Math.random) {
  const eligible = (candidates || []).filter(candidate => candidate?.ratePerSecond > 0);
  const totalRate = eligible.reduce((sum, candidate) => sum + candidate.ratePerSecond, 0);
  const duration = Math.max(0, Number(seconds) || 0);
  if (!(totalRate > 0) || !(duration > 0)) return null;
  const chance = 1 - Math.exp(-totalRate * duration);
  if (random() >= chance) return null;
  let cursor = random() * totalRate;
  for (const candidate of eligible) {
    cursor -= candidate.ratePerSecond;
    if (cursor <= 0) return candidate;
  }
  return eligible[eligible.length - 1] || null;
}

export class AmbientElectricalSparkScheduler {
  constructor({ random = Math.random, intervalSeconds = 1 } = {}) {
    this.random = random;
    this.intervalSeconds = Math.max(0.1, Number(intervalSeconds) || 1);
    this.elapsed = 0;
  }

  update(dtSeconds, state, getDefinition) {
    // Do not replay a tab's entire backgrounded wall-clock gap as sparks.
    this.elapsed += Math.min(this.intervalSeconds, Math.max(0, Number(dtSeconds) || 0));
    if (this.elapsed < this.intervalSeconds) return null;
    this.elapsed -= this.intervalSeconds;
    return chooseAmbientElectricalSpark(
      ambientElectricalSparkCandidates(state, getDefinition),
      this.intervalSeconds,
      this.random,
    );
  }
}

