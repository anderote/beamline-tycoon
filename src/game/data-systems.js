import { PLACEABLES } from '../data/placeables/index.js';

const WORKLOADS = ['cpu', 'gpu', 'balanced'];
const zeroBuckets = () => ({ cpu: 0, gpu: 0, balanced: 0 });

function declaredZones(def) {
  if (Array.isArray(def?.zoneTypes)) return def.zoneTypes;
  return def?.zoneType ? [def.zoneType] : [];
}

/**
 * Resolve the one declared zone containing a data-system placement.
 *
 * Old/headless states without zone occupancy are treated as unverified rather
 * than invalid so pure pipeline tests and pre-zone saves retain their data.
 * A live game has `zoneOccupied`; there every floor tile touched by the rack
 * must belong to one of its authored home zones.
 */
export function dataSystemHomeZone(state, placed) {
  const def = PLACEABLES[placed?.type];
  const allowed = declaredZones(def);
  if (allowed.length === 0) return null;
  if (!state?.zoneOccupied || placed?.col == null || placed?.row == null) {
    return undefined;
  }

  const tiles = new Set();
  for (const cell of (placed.cells || [{ col: placed.col, row: placed.row }])) {
    tiles.add(`${cell.col},${cell.row}`);
  }
  let resolved = null;
  for (const key of tiles) {
    const zone = state.zoneOccupied[key];
    if (!allowed.includes(zone)) return null;
    if (resolved !== null && resolved !== zone) return null;
    resolved = zone;
  }
  return resolved;
}

function networkedDataIds(state) {
  // Pure/headless fixtures that predate topology publication omit the field
  // entirely and retain legacy aggregate behavior. A live Game owns the field
  // from construction onward; null there means discovery has not yet proved a
  // gateway connection, so fail closed until the next utility solve.
  if (!state || !Object.hasOwn(state, 'utilityNetworks')) return null;
  const networks = state?.utilityNetworks?.get?.('dataFiber');
  if (!Array.isArray(networks)) return new Set();
  const ids = new Set();
  for (const network of networks) {
    for (const port of (network.ports || [])) ids.add(port.placeableId);
  }
  return ids;
}

/** Sum the installed ingest, storage and processing hardware. */
export function computeDataSystemCapacity(state) {
  const capacity = { ingest: 0, storage: 0, cpu: 0, gpu: 0 };
  const units = { allInOne: 0, daq: 0, storage: 0, cpu: 0, gpu: 0 };
  const inactive = { wrongZone: 0, noGateway: 0 };
  const candidates = [];
  for (const placed of (state?.placeables || [])) {
    const spec = PLACEABLES[placed.type]?.effects?.dataSystem;
    if (!spec) continue;
    const zone = dataSystemHomeZone(state, placed);
    if (zone === null) {
      inactive.wrongZone++;
      continue;
    }
    candidates.push({ placed, spec, zone });
  }

  // A live topology makes fiber termination meaningful. A Control Room full
  // of disks and processors is inert until an ingest-capable gateway in that
  // same zone has a line on the facility data network. Racks behind the
  // gateway share the room's internal fabric; players wire the room once,
  // not every individual disk shelf.
  const networked = networkedDataIds(state);
  const activeZones = new Set();
  let gateways = 0;
  for (const candidate of candidates) {
    if (!(candidate.spec.ingest > 0)) continue;
    if (networked && !networked.has(candidate.placed.id)) continue;
    activeZones.add(candidate.zone);
    gateways++;
  }

  for (const { spec, zone } of candidates) {
    if (networked && !activeZones.has(zone)) {
      inactive.noGateway++;
      continue;
    }
    for (const key of Object.keys(capacity)) capacity[key] += Math.max(0, spec[key] || 0);
    if (spec.kind && Object.hasOwn(units, spec.kind)) units[spec.kind]++;
  }
  return { ...capacity, units, gateways, inactive };
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
  let ingestDropped = 0;
  let storageDropped = capacityDrop;

  for (const request of requests) {
    const bs = request.entry.beamState;
    const afterIngest = Math.max(0, request.rate || 0) * ingestScale;
    const accepted = Math.min(afterIngest, freeStorage);
    const rejectedAtIngest = Math.max(0, request.rate || 0) - afterIngest;
    const rejectedAtStorage = afterIngest - accepted;
    const lost = rejectedAtIngest + rejectedAtStorage;
    freeStorage -= accepted;
    ingested += accepted;
    dropped += lost;
    ingestDropped += rejectedAtIngest;
    storageDropped += rejectedAtStorage;
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
  let bottleneck = 'Clear';
  if (requested > 0) {
    if (capacity.gateways === 0) bottleneck = 'Control Room DAQ gateway';
    else if (ingestDropped > 0) bottleneck = 'DAQ ingest';
    else if (storageDropped > 0) bottleneck = 'Raw data buffer';
    else if (stored > 0 && !(state?.staffDataEfficiency > 0)) bottleneck = 'Data scientist';
    else if (stored > 0 && processed < ingested) {
      const cpuBacklog = requests.some(r => r.workload === 'cpu');
      const gpuBacklog = requests.some(r => r.workload === 'gpu');
      bottleneck = cpuBacklog && !gpuBacklog ? 'CPU processing'
        : (gpuBacklog && !cpuBacklog ? 'GPU processing' : 'Mixed processing');
    }
  }
  const snapshot = {
    capacity,
    requested,
    ingested,
    dropped,
    ingestDropped,
    storageDropped,
    stored,
    processed,
    bottleneck,
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
