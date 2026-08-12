// src/data/stock-designs.js — the prebuilt beamlines every type ships with.
//
// RCT2 hands you a folder of working coasters per track type. You are not
// expected to design a Giga from nothing on your first hour; you place a stock
// one, run it, and then start moving pieces. This is that folder.
//
// A blueprint is DATA, not saved state. It cannot be deleted, it is present in
// a fresh save, and it is versioned with the code that validates it — none of
// which is true of `state.savedDesigns`, where the player's own designs live.
// Placing one copies nothing into that store; "Duplicate to My Designs" is the
// deliberate path from stock to editable.
//
// EVERY BLUEPRINT HERE IS MEASURED, NOT ASSERTED. scripts/eval-design.mjs runs
// each one through the real physics engine and checks the beam it produces
// against its type's `spec` band in beamline-types.js. A blueprint that does
// not land in band does not ship. The measured numbers go to
// stock-designs.measured.json and are what the picker displays, so a card can
// never advertise an energy the machine does not reach.
//
// TIER IS WITHIN THE TYPE, not across the roster: `tier: 1` on a Test Stand and
// `tier: 1` on an XFEL are both "the entry machine of this kind", and the type's
// own `tier` in beamline-types.js is what orders them against each other. Each
// step up must be a real change in what the machine can do — more energy, more
// current, better beam — never the same lattice at a higher price.
//
// Entry shape:
//   id          stable key; also the measured.json key. Never reuse.
//   typeId      BEAMLINE_TYPES id
//   tier        1..3 within the type
//   name        display name
//   blurb       one line, RCT2 ride-list voice: what it is FOR
//   components  [{ type, params }] in beam order, exactly the shape
//               state.savedDesigns uses, so DesignPlacer needs no special case.
//
// WHAT LANDS ON A PIPE. Components with `role: 'placement'` — quadrupoles,
// solenoids, BPMs, and every RF cavity — are laid onto the pipe between the
// junctions that surround them; `role: 'junction'` components (sources,
// dipoles, endpoints) take grid tiles. Note this is `role`, NOT `placement`:
// an S-band structure is `placement: 'module'` but `role: 'placement'`, and
// design placement got that distinction wrong until it was caught by
// test/test-design-layout-fidelity.js. See src/beamline/design-layout.js.
//
// ALWAYS SET MAGNET STRENGTHS EXPLICITLY. Catalogue defaults are chosen for
// palette placement, not for any particular beam energy, and a quadrupole's
// focusing goes as 1/p — the same magnet that is right at 1 GeV blows a 37 MeV
// beam out to hundreds of metres. A blueprint that omits `gradient` or
// `fieldStrength` is inheriting a number nobody chose for it.
//
// The roster is split by particle and scale so the files stay readable and so
// several people (or agents) can author against the evaluator at once.

import { ELECTRON_LOW_TIER_DESIGNS } from './stock-designs/electron-low.js';
import { PROTON_DESIGNS } from './stock-designs/proton.js';
import { PHOTON_HIGH_TIER_DESIGNS } from './stock-designs/photon-high.js';

export const STOCK_DESIGNS = [
  ...ELECTRON_LOW_TIER_DESIGNS,
  ...PROTON_DESIGNS,
  ...PHOTON_HIGH_TIER_DESIGNS,
];

/** Blueprints for one type id, in tier order. */
export function stockDesignsFor(typeId) {
  return STOCK_DESIGNS
    .filter(d => d.typeId === typeId)
    .sort((a, b) => a.tier - b.tier);
}

/** One blueprint by id, or null. */
export function getStockDesign(id) {
  return STOCK_DESIGNS.find(d => d.id === id) || null;
}
