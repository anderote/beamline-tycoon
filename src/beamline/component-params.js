// src/beamline/component-params.js
//
// The one place that decides what params a beamline component ACTUALLY carries
// the moment it is placed.
//
// This existed in three copies and one of them was missing. `Game.
// _placePlaceableInner` seeded junction-mounted components correctly;
// `BeamlineSystem.placeOnPipe` passed `opts.params || {}` straight into
// findSlot and seeded nothing; `scripts/eval-design.mjs` had its own correct
// copy for the harness. Same component, different mount, different physics.
//
// The concrete failure: `spokeCavity` declares `params: { rfFrequency: 325,
// gradient: 8 }` in the catalogue and has NO PARAM_DEFS entry, so step 2 below
// is the only place those numbers exist. Placed on a pipe it arrived with
// `params: {}` and beam_physics/modules/rf_acceleration.py fell back to its
// DEFAULT_RF_FREQ of 1.3e9 — 4x off, and since the captured bunch length is
// sigma_t = BUNCH_PHASE_SIGMA_RAD / (2*pi*f), that moved bunch length, peak
// current and space charge together. A 325 MHz spoke resonator ran as a
// 1.3 GHz cavity. test/test-design-layout-fidelity.js caught it as 12
// `placed=undefined harness=325` assertions.
//
// This is not a corner case: every RF cavity in the game (buncher,
// pillboxCavity, rfCavity, sbandStructure, spokeCavity, halfWaveResonator,
// ellipticalSrfCavity, cryomodule, rfq, industrialLinac) is role 'placement'
// and therefore goes down the pipe path.
//
// WHY IT LIVES HERE: seeding needs PARAM_DEFS (./component-physics.js, a leaf
// with no imports of its own) and COMPONENTS (../data/components.js, which
// pulls the placeable registry + validate.js + the utility-port tables).
// Importing both from one module is only safe if nothing in that data chain
// imports back — src/data/* reaches into src/beamline/ only for the leaf
// modules component-physics.js and cavity-specs.js, never for this file, so
// the edge is one-way. physics-payload.js in this same directory already
// imports exactly this pair and initialises fine, which is the existing proof.
// Putting it in src/data/ instead WOULD close a cycle, the same class of
// breakage src/utility/endpoint-lookup.js was carved out to avoid.

import { PARAM_DEFS } from './component-physics.js';
import { COMPONENTS } from '../data/components.js';

/**
 * The params a beamline component actually carries once placed.
 *
 * Three ordered steps, and the order is the contract — this mirrors what
 * `Game._placePlaceableInner` has always done for junction-mounted components,
 * which is the reference implementation the fidelity test measures against:
 *
 *   1. every non-derived PARAM_DEFS[type] default. Derived params are engine
 *      outputs, not inputs, so seeding them would hand the physics a stale
 *      answer to a question it is about to compute.
 *   2. then COMPONENTS[type].params for any key step 1 did not already set.
 *      Catalogue values only FILL GAPS — a type with a PARAM_DEFS entry for a
 *      key wins with its default, because that entry also carries the min/max
 *      the editor UI clamps to and the two must agree.
 *   3. then the caller's explicit params on top, unconditionally. For a stock
 *      design these are the blueprint's authored OVERRIDES, which is why a
 *      blueprint may legitimately mention only the handful of params it tunes.
 *
 * @param {string} type      component id, e.g. 'spokeCavity'
 * @param {object} [authored] explicit caller/blueprint overrides
 * @returns {object} a fresh params object (never aliases either source table)
 */
export function seedComponentParams(type, authored) {
  const out = {};

  const defs = PARAM_DEFS[type];
  if (defs) {
    for (const [k, pdef] of Object.entries(defs)) {
      if (!pdef.derived) out[k] = pdef.default;
    }
  }

  const catalogue = COMPONENTS[type]?.params;
  if (catalogue) {
    for (const [k, v] of Object.entries(catalogue)) {
      if (!(k in out)) out[k] = v;
    }
  }

  return Object.assign(out, authored || {});
}
