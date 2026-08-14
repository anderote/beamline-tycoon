import { RESEARCH, RESEARCH_LAB_MAP, RESEARCH_SPEED_TABLE } from '../data/research.js';
import { COMPONENTS } from '../data/components.js';
import { ZONES, ZONE_FURNISHINGS, FURNISHING_TIER_THRESHOLDS, itemMatchesZone } from '../data/facility.js';

// Module-level caches. Safe to share across Game instances: both derive
// purely from the static RESEARCH table, never from game state.
let _nodeDepthCache = {};
let _finalNodes = null;

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

/**
 * Furnishing tier for a zone. `zoneItems` must be state.zoneItems — every
 * placed item with a ZONE_FURNISHINGS def — not state.zoneFurnishings, which
 * is the kind === 'furnishing' subset and therefore excludes all 43 LAB items
 * (they are kind 'equipment'). Matching goes through itemMatchesZone so the
 * defs that declare a `zoneTypes` array (labBench et al.) count too.
 */
export function _getFurnishingTier(zoneType, zoneItems) {
  let count = 0;
  for (const f of zoneItems || []) {
    const def = ZONE_FURNISHINGS[f.type];
    if (itemMatchesZone(def, zoneType)) count++;
  }
  let tier = 0;
  for (let t = FURNISHING_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (count >= FURNISHING_TIER_THRESHOLDS[t]) { tier = t + 1; break; }
  }
  return tier;
}

// Task 6 (staff-professions-3, jobs-and-gates): reads peakTier, not the
// live (staffing-ratcheted) `.tier` zoneConnectivity now carries. Research
// gating is a durable "has this lab ever reached the level this node
// needs" question — the same shape as the brief's own peakTier/palette-
// unlock rule ("losing access to components you already bought is
// punishing in a way that losing throughput is not"), not a live
// efficiency read (that's StaffMember.efficiency's own zoneTier argument,
// which still reads the live `.tier` — an understaffed lab genuinely
// SLOWS work happening in it right now, unaffected by this).
//
// Reading the live tier here instead — the first version of this fix —
// let a temporary staffing lull (an engineer pulled onto a commission
// backlog, say) retroactively un-start research a player was already
// mid-node on, or wall an entire research subtree behind a lab that's
// rarely fully staffed at the exact instant startResearch happens to
// check. Measured live in a 24-beamline playthrough
// (scripts/balance-playthrough.mjs): 81% of an 80,000-tick run blocked on
// lab tier, 31 research nodes never reachable, once commission work (also
// new this task, and a higher board priority than labWork — 70 vs 40)
// started competing with labWork for the same finite engineer pool.
export function getLabResearchTier(labType, state) {
  const conn = state.zoneConnectivity?.[labType];
  const tier = conn ? (conn.peakTier ?? conn.tier ?? 0) : 0;
  const furnTier = _getFurnishingTier(labType, state.zoneItems || state.zoneFurnishings);
  return Math.min(tier, furnTier);
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
  // Task 6 (staff-professions-3, jobs-and-gates) removed the old
  // `sciBonus = 1 + state.staff.scientist * 0.05` term: it rewarded merely
  // HAVING scientists on the roster, not any of them actually doing
  // anything — the same presence-vs-work gap Game._tickBeamline's own
  // sciMult had (see that call site's own comment). The passive trickle
  // below (lab tier via speedMult, beam quality, morale) is now the whole
  // story for research progress that isn't work-gated; the WORK-gated half
  // is jobEffects/analyze.js's completion effect, which adds directly to
  // state.researchProgress when a scientist finishes converting data.
  const bqFactor = state.beamOn ? (0.5 + 0.5 * state.beamQuality) : 0.5;
  const speedMult = getResearchSpeedMult(state.activeResearch) || 1;
  // Apply morale bonus to research speed
  state.researchProgress += (1 / speedMult) * bqFactor * (state.moraleMultiplier || 1.0);
  if (state.researchProgress >= r.duration) {
    state.completedResearch.push(state.activeResearch);
    log(`Research done: ${r.name}!`, 'reward');
    if (r.unlocks) {
      for (const c of r.unlocks) {
        if (COMPONENTS[c]) log(`Unlocked: ${COMPONENTS[c].name}`, 'good');
      }
    }
    state.activeResearch = null;
    state.researchProgress = 0;
    recalcBeamline();
    return true; // research completed
  }
  return false;
}
