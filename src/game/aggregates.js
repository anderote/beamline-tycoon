// src/game/aggregates.js
//
// One definition per derived quantity, and every call site imports it.
//
// Every accessor here replaces a quantity that was being computed at two or
// more call sites, and each of those pairs had already drifted apart in a way
// that showed up as a balance bug:
//
//   - powered placeables / equipment draw — computeTickUpkeep billed the
//     'equipment' + 'infrastructure' union while computeSystemStats added up
//     per-category draws, which both omitted the uncategorised lab items and
//     double-counted cryogenics (a facility drawing 74 kW of a 100 kW supply
//     displayed a green 6%);
//   - pump count — billed off a Set in economy.js and displayed off a
//     hand-copied array 120 lines below it, with a comment asking the next
//     editor to keep them in sync;
//   - hardware node count — the flattener emits a synthetic 'drift' entry per
//     gap between placements, and beam income billed them as machines, so
//     spacing hardware further apart minted money (roughly doubling beam
//     income on a normal layout until it was caught);
//   - uptime — the per-beamline value divided beamOnTicks by wall-clock
//     ticks, the facility value divided the SUM of beamOnTicks by the same,
//     so the facility figure ran up to N with N beamlines and paid out the
//     `highAvailability` objective for a facility whose beams were down;
//   - billed data rate — the tick derated dataRate by data-fiber
//     connectivity, the fee was charged on the raw value, so a detector with
//     a cut fiber was paid for science it demonstrably did not produce.
//
// Rule for anything added here: the accessor is the definition. If a call
// site needs a variant, it takes an argument — it does not re-derive.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';

// Vacuum pumps: billed the per-tick service fee AND counted in the vacuum
// panel. These were two lists.
export const PUMP_TYPES = ['roughingPump', 'turboPump', 'ionPump', 'negPump', 'tiSubPump'];
const PUMP_TYPE_SET = new Set(PUMP_TYPES);

export function isPumpType(type) {
  return PUMP_TYPE_SET.has(type);
}

/**
 * Every placed unit that draws power and shows up in the system panels.
 * Pumps, RF sources, chillers and cold boxes are placed with kind (and so
 * category) 'infrastructure'; 'equipment' is lab devices. Both count —
 * filtering to 'equipment' alone left the HUD reporting zero pumps and zero
 * draw for hardware the player is billed for.
 */
export function poweredPlaceables(state) {
  return (state?.placeables || []).filter(
    p => p.category === 'equipment' || p.category === 'infrastructure',
  );
}

/** kW drawn by placed equipment/infrastructure, billed whenever placed. */
export function equipmentEnergyDraw(state) {
  let draw = 0;
  for (const p of poweredPlaceables(state)) draw += (COMPONENTS[p.type]?.energyCost || 0);
  return draw;
}

/**
 * kW drawn by the beamlines that are actually running. Game._updateAggregate-
 * Beamline sums only running entries into state.totalEnergyCost; there is no
 * global beamOn gate, which used to bill stopped beamlines whenever any one
 * beamline ran.
 */
export function beamlineEnergyDraw(state) {
  return state?.totalEnergyCost || 0;
}

/**
 * kW drawn by facility lighting fixtures. Lights are decorations
 * (kind: 'decoration'), so poweredPlaceables — which deliberately excludes
 * decorations for the pump/equipment consumers below — cannot be reused
 * here; this is its own walk over state.placeables, filtered on the def
 * carrying a `light` block rather than on category.
 *
 * Also sums state.wallFixtures, the edge-keyed store a later task (wall-
 * mounted sconces/bulkheads) introduces for fixtures that never enter
 * state.placeables. That store does not exist yet, so it is read
 * defensively: absent, empty, or holding entries with no matching def all
 * contribute zero rather than throwing.
 */
export function lightingEnergyDraw(state) {
  let draw = 0;
  for (const p of state?.placeables || []) {
    const def = PLACEABLES[p.type];
    if (def?.light) draw += (def.energyCost || 0);
  }
  for (const f of Object.values(state?.wallFixtures || {})) {
    const def = PLACEABLES[f?.type];
    if (def?.light) draw += (def.energyCost || 0);
  }
  return draw;
}

/** The facility's total electrical draw — the basis for both the power bill
 *  and the power panel's utilization. */
export function facilityEnergyDraw(state) {
  return equipmentEnergyDraw(state) + beamlineEnergyDraw(state) + lightingEnergyDraw(state);
}

/** Placed vacuum pumps, the basis for both the service fee and the panel. */
export function pumpCount(state) {
  let n = 0;
  for (const p of poweredPlaceables(state)) if (isPumpType(p.type)) n++;
  return n;
}

/**
 * The HARDWARE entries of a flattened beamline. flattenPath also emits a
 * synthetic entry per gap between placements (`kind: 'drift'`) — those are
 * geometry, not machines, and no consumer that counts or bills should see
 * them.
 */
export function hardwareNodes(flattened) {
  return (flattened || []).filter(n => n.kind !== 'drift');
}

/** Machine count of a flattened beamline — what beam income scales with. */
export function hardwareNodeCount(flattened) {
  return hardwareNodes(flattened).length;
}

/** One beamline's uptime in [0,1]: beam-on ticks over elapsed ticks. */
export function beamlineUptime(beamState, tick) {
  if (!(tick > 0)) return 1;
  return (beamState?.beamOnTicks || 0) / tick;
}

/**
 * The facility's uptime: the MEAN of the per-beamline uptimes. Not the sum of
 * beam-on ticks over wall-clock ticks — that is a different number as soon as
 * there is more than one beamline.
 */
export function facilityUptime(beamStates, tick) {
  const list = Array.from(beamStates || []);
  if (list.length === 0 || !(tick > 0)) return 1;
  let sum = 0;
  for (const bs of list) sum += beamlineUptime(bs, tick);
  return sum / list.length;
}

/**
 * The data rate the facility is actually paid for: the physics rate derated
 * by the data-fiber connectivity of the nodes producing it. Everything that
 * bills, credits `data`, or displays "what this beamline earns" must quote
 * this, not beamState.dataRate.
 */
export function billedDataRate(beamState, dataConnectivity = 1) {
  return (beamState?.dataRate || 0) * dataConnectivity;
}
