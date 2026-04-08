import { RESEARCH, RESEARCH_LAB_MAP, RESEARCH_SPEED_TABLE } from '../data/research.js';
import { COMPONENTS } from '../data/components.js';
import { ZONES, ZONE_FURNISHINGS, FURNISHING_TIER_THRESHOLDS } from '../data/infrastructure.js';
import { MACHINES } from '../data/machines.js';

// Module-level caches (reset via resetResearchCache)
let _nodeDepthCache = {};
let _finalNodes = null;

export function resetResearchCache() {
  _nodeDepthCache = {};
  _finalNodes = null;
}

export function isResearchAvailable(id, state) {
  const r = RESEARCH[id];
  if (!r || r.hidden || state.completedResearch.includes(id) || state.activeResearch === id) return false;
  if (!r.requires) return true;
  if (Array.isArray(r.requires)) {
    return r.requires.every(req => state.completedResearch.includes(req));
  }
  return state.completedResearch.includes(r.requires);
}

export function startResearch(id, state, log) {
  if (!isResearchAvailable(id, state)) return false;
  const r = RESEARCH[id];
  // Check lab gate
  const speedMult = getResearchSpeedMultiplier(id, state);
  if (speedMult === null) {
    const labType = RESEARCH_LAB_MAP[r.category];
    const labName = ZONES[labType]?.name || labType;
    const isFinal = _computeFinalNodes().has(id);
    const minTier = isFinal ? 2 : 1;
    log(`Requires ${labName} (Tier ${minTier}+) to begin`, 'bad');
    return false;
  }
  // Check all costs (data, funding, reputation)
  const costs = {};
  if (r.cost.data) costs.data = r.cost.data;
  if (r.cost.funding) costs.funding = r.cost.funding;
  if (r.cost.reputation) {
    // Reputation is checked but not spent -- it's a threshold
    if ((state.resources.reputation || 0) < r.cost.reputation) {
      log(`Need ${r.cost.reputation} reputation`, 'bad');
      return false;
    }
  }
  // Check affordability
  for (const [res, amt] of Object.entries(costs)) {
    if ((state.resources[res] || 0) < amt) {
      const missing = [];
      if (costs.data && (state.resources.data || 0) < costs.data) missing.push(`${costs.data} data`);
      if (costs.funding && (state.resources.funding || 0) < costs.funding) missing.push(`$${costs.funding}`);
      log(`Need ${missing.join(' + ')}`, 'bad');
      return false;
    }
  }
  // Spend costs
  for (const [res, amt] of Object.entries(costs)) state.resources[res] -= amt;
  state.activeResearch = id;
  state.researchProgress = 0;
  log(`Researching: ${r.name}`, 'info');
  return true;
}

export function getEffect(key, def, completedResearch) {
  let v = def;
  for (const id of completedResearch) {
    const r = RESEARCH[id];
    if (r?.effect?.[key] !== undefined)
      v = key.endsWith('Mult') ? v * r.effect[key] : v + r.effect[key];
  }
  return v;
}

export function _computeNodeDepth(id) {
  if (_nodeDepthCache[id] !== undefined) return _nodeDepthCache[id];
  const r = RESEARCH[id];
  if (!r || !r.requires) return 1;
  const reqs = Array.isArray(r.requires) ? r.requires : [r.requires];
  const depth = 1 + Math.max(...reqs.map(req => _computeNodeDepth(req)));
  _nodeDepthCache[id] = depth;
  return depth;
}

export function _computeFinalNodes() {
  if (_finalNodes) return _finalNodes;
  const referenced = new Set();
  for (const r of Object.values(RESEARCH)) {
    if (r.requires) {
      const reqs = Array.isArray(r.requires) ? r.requires : [r.requires];
      for (const req of reqs) referenced.add(req);
    }
  }
  _finalNodes = new Set();
  for (const [id, r] of Object.entries(RESEARCH)) {
    if (!r.hidden && !referenced.has(id)) _finalNodes.add(id);
  }
  return _finalNodes;
}

export function _getFurnishingTier(zoneType, zoneFurnishings) {
  let count = 0;
  for (const f of zoneFurnishings || []) {
    const def = ZONE_FURNISHINGS[f.type];
    if (def && def.zoneType === zoneType) count++;
  }
  let tier = 0;
  for (let t = FURNISHING_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (count >= FURNISHING_TIER_THRESHOLDS[t]) { tier = t + 1; break; }
  }
  return tier;
}

export function getLabResearchTier(labType, state) {
  const conn = state.zoneConnectivity?.[labType];
  if (!conn || !conn.active) {
    const tileTier = conn ? conn.tier : 0;
    const furnTier = _getFurnishingTier(labType, state.zoneFurnishings);
    return Math.min(tileTier, furnTier);
  }
  const tileTier = conn.tier;
  const furnTier = _getFurnishingTier(labType, state.zoneFurnishings);
  return Math.min(tileTier, furnTier);
}

export function getResearchSpeedMultiplier(id, state) {
  const r = RESEARCH[id];
  if (!r) return null;
  const labType = RESEARCH_LAB_MAP[r.category];
  if (!labType) return 1; // no lab mapping = normal speed
  const tier = getLabResearchTier(labType, state);
  const depth = _computeNodeDepth(id);
  const isFinal = _computeFinalNodes().has(id);

  let row;
  if (isFinal) row = 'final';
  else if (depth >= 5) row = 'late';
  else if (depth >= 3) row = 'mid';
  else row = 'early';

  return RESEARCH_SPEED_TABLE[row][tier];
}

export function tickResearch(state, log, getResearchSpeedMult, recalcBeamline) {
  if (!state.activeResearch) return false;
  const r = RESEARCH[state.activeResearch];
  const sciBonus = 1 + state.staff.scientists * 0.05;
  const bqFactor = state.beamOn ? (0.5 + 0.5 * state.beamQuality) : 0.5;
  const speedMult = getResearchSpeedMult(state.activeResearch) || 1;
  state.researchProgress += (1 / speedMult) * sciBonus * bqFactor;
  if (state.researchProgress >= r.duration) {
    state.completedResearch.push(state.activeResearch);
    log(`Research done: ${r.name}!`, 'reward');
    if (r.unlocks) {
      for (const c of r.unlocks) {
        if (COMPONENTS[c]) log(`Unlocked: ${COMPONENTS[c].name}`, 'good');
      }
    }
    if (r.unlocksMachines) {
      for (const m of r.unlocksMachines) {
        if (MACHINES[m]) log(`Unlocked machine: ${MACHINES[m].name}`, 'good');
      }
    }
    state.activeResearch = null;
    state.researchProgress = 0;
    recalcBeamline();
    return true; // research completed
  }
  return false;
}
