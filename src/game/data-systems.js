import { PLACEABLES } from '../data/placeables/index.js';

const WORKLOADS = ['cpu', 'gpu', 'balanced'];
const zeroBuckets = () => ({ cpu: 0, gpu: 0, balanced: 0 });

/** Sum the installed ingest, storage and processing hardware. */
export function computeDataSystemCapacity(state) {
  const capacity = { ingest: 0, storage: 0, cpu: 0, gpu: 0 };
  const units = { allInOne: 0, daq: 0, storage: 0, cpu: 0, gpu: 0 };
  for (const placed of (state?.placeables || [])) {
    const spec = PLACEABLES[placed.type]?.effects?.dataSystem;
    if (!spec) continue;
    for (const key of Object.keys(capacity)) capacity[key] += Math.max(0, spec[key] || 0);
    if (spec.kind && Object.hasOwn(units, spec.kind)) units[spec.kind]++;
  }
  return { ...capacity, units };
}

function processingBudget(capacity, staffEfficiency) {
  const staff = Math.max(0, staffEfficiency || 0);
  return {
    cpu: Math.max(0, capacity.cpu) * staff,
    gpu: Math.max(0, capacity.gpu) * staff,
  };
}

function useCompute(workload, amount, budget) {
  let remaining = amount;
  let used = 0;
  const take = (key, wanted) => {
    const n = Math.min(wanted, budget[key]);
    budget[key] -= n;
    remaining -= n;
    used += n;
  };
  if (workload === 'cpu') {
    take('cpu', remaining);
    take('gpu', remaining * 0.35); // GPUs can limp through control workloads.
  } else if (workload === 'gpu') {
    take('gpu', remaining);
    take('cpu', remaining * 0.25); // CPUs can reconstruct a few events slowly.
  } else {
    // Balanced workloads need both halves; either side can become the limit.
    const pairs = Math.min(remaining, budget.cpu * 2, budget.gpu * 2);
    const half = pairs / 2;
    budget.cpu -= half;
    budget.gpu -= half;
    remaining -= pairs;
    used += pairs;
  }
  return used;
}

/**
 * Advance the facility data pipeline by one tick.
 *
 * `requests` are already fiber-derated. DAQ limits what enters, storage keeps
 * unprocessed raw data between ticks, and CPU/GPU capacity plus a scientist
 * working Take Data converts it into the existing research-data resource.
 */
export function tickDataSystems(state, entries, requests = []) {
  const capacity = computeDataSystemCapacity(state);
  const requested = requests.reduce((sum, r) => sum + Math.max(0, r.rate || 0), 0);
  const ingestScale = requested > 0
    ? Math.min(1, capacity.ingest / requested)
    : 0;

  let storedBefore = 0;
  for (const entry of entries) storedBefore += Math.max(0, entry.beamState.rawDataStored || 0);
  // Demolishing storage cannot leave an invisible, over-capacity buffer. Drop
  // newest/last-listed buffers first until the remaining data fits.
  let overflow = Math.max(0, storedBefore - capacity.storage);
  const capacityDrop = overflow;
  if (overflow > 0) {
    for (let i = entries.length - 1; i >= 0 && overflow > 0; i--) {
      const bs = entries[i].beamState;
      const held = Math.max(0, bs.rawDataStored || 0);
      const lost = Math.min(held, overflow);
      bs.rawDataStored = held - lost;
      bs.rawDataDropped = Math.max(0, bs.rawDataDropped || 0) + lost;
      overflow -= lost;
      storedBefore -= lost;
    }
  }
  let freeStorage = Math.max(0, capacity.storage - storedBefore);
  let ingested = 0;
  let dropped = capacityDrop;

  for (const request of requests) {
    const bs = request.entry.beamState;
    const afterIngest = Math.max(0, request.rate || 0) * ingestScale;
    const accepted = Math.min(afterIngest, freeStorage);
    const lost = Math.max(0, request.rate || 0) - accepted;
    freeStorage -= accepted;
    ingested += accepted;
    dropped += lost;
    bs.rawDataStored = Math.max(0, bs.rawDataStored || 0) + accepted;
    bs.rawDataDropped = Math.max(0, bs.rawDataDropped || 0) + lost;
    bs.totalRawDataIngested = Math.max(0, bs.totalRawDataIngested || 0) + accepted;
    bs.dataWorkload = WORKLOADS.includes(request.workload) ? request.workload : 'balanced';
  }

  const compute = processingBudget(capacity, state?.staffDataEfficiency);
  const processedByWorkload = zeroBuckets();
  let processed = 0;
  // Round-robin by workload keeps a large imaging detector from permanently
  // starving a small controls experiment sharing the same facility.
  for (const workload of WORKLOADS) {
    for (const entry of entries) {
      const bs = entry.beamState;
      if ((bs.dataWorkload || 'balanced') !== workload) continue;
      const available = Math.max(0, bs.rawDataStored || 0);
      const done = useCompute(workload, available, compute);
      if (!(done > 0)) continue;
      bs.rawDataStored = available - done;
      bs.totalDataProcessed = Math.max(0, bs.totalDataProcessed || 0) + done;
      bs.totalDataCollected = Math.max(0, bs.totalDataCollected || 0) + done;
      processedByWorkload[workload] += done;
      processed += done;
    }
  }

  state.resources.data += processed;
  const stored = entries.reduce((sum, e) => sum + Math.max(0, e.beamState.rawDataStored || 0), 0);
  const snapshot = {
    capacity,
    requested,
    ingested,
    dropped,
    stored,
    processed,
    processedByWorkload,
    ingestUtilization: capacity.ingest > 0 ? Math.min(1, requested / capacity.ingest) : (requested > 0 ? 1 : 0),
    storageUtilization: capacity.storage > 0 ? Math.min(1, stored / capacity.storage) : (stored > 0 ? 1 : 0),
    cpuUtilization: capacity.cpu > 0 && state.staffDataEfficiency > 0
      ? 1 - compute.cpu / (capacity.cpu * state.staffDataEfficiency) : 0,
    gpuUtilization: capacity.gpu > 0 && state.staffDataEfficiency > 0
      ? 1 - compute.gpu / (capacity.gpu * state.staffDataEfficiency) : 0,
  };
  state.dataSystemSnapshot = snapshot;
  return snapshot;
}
