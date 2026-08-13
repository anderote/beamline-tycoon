// src/data/land.js — the map is a purchasable resource.
//
// Everything through tier 4 fits on the starting 61x61 site. What does not fit
// is the machines that cannot fold: a linear collider must run straight, since
// synchrotron loss goes as E^4/rho and bending a 500 GeV electron beam radiates
// away the energy the last thirty placements just bought it. So the collider
// tiers are not gated on money-for-hardware or on research — they are gated on
// having somewhere to put a straight line that long, which makes ground the
// scarce thing and land the late game's one real cash sink.
//
// The ladder is sized so each parcel unlocks exactly one collider tier, and the
// last also unlocks the tier-6 Black Hole Factory. Nothing else in the game
// needs that much land, and the Black Hole Factory cannot exist without it —
// the land ladder and the machine ladder are one progression seen from two
// sides.
//
// A parcel adds +30 half-extent, i.e. +60 tiles per side, symmetric on both
// axes (a straight run may lie along either one, so square growth buys as much
// straight-run budget as an elongated map would, for a much smaller change).
//
// COSTS ARE PROVISIONAL. They span $500M to $15B against a game whose late
// research costs $41M; that gap is deliberate, but it is the number most likely
// to move. Settle it in scripts/balance-sim.mjs, not by feel.

export const LAND_PARCELS = [
  {
    id: 'land1',
    name: 'Land Acquisition',
    halfExtent: 60,
    tilesPerSide: 121,
    cost: 500_000_000,
    // What the purchase is FOR, in the player's terms. Kept next to the price
    // so a card can say what the money buys rather than how big a square it is.
    unlocks: 'Z-pole collider',
    desc: 'Buy out the neighbouring farmland. Doubles the site.',
  },
  {
    id: 'land2',
    name: 'Compulsory Purchase',
    halfExtent: 90,
    tilesPerSide: 181,
    cost: 3_000_000_000,
    unlocks: 'Higgs factory',
    desc: 'The county exercises eminent domain on your behalf. Nobody is happy.',
  },
  {
    id: 'land3',
    name: 'Site Condemnation',
    halfExtent: 120,
    tilesPerSide: 241,
    cost: 15_000_000_000,
    unlocks: 'TeV collider · Black Hole Factory',
    desc: 'Everything to the horizon becomes national scientific infrastructure.',
  },
];

/** The largest map that can ever be bought — the straight-run budget every
 *  beamline type has to fit inside. */
export const MAX_MAP_HALF_EXTENT = LAND_PARCELS[LAND_PARCELS.length - 1].halfExtent;

/** The parcel on offer at a given half-extent, or null when the ladder is
 *  exhausted. Land is bought in order and never sold back, so "next" is the
 *  first parcel bigger than what the player already owns. */
export function nextLandParcel(halfExtent) {
  return LAND_PARCELS.find(p => p.halfExtent > halfExtent) || null;
}

/**
 * The smallest half-extent that can hold a straight run of `tiles` — i.e. the
 * map a design of that length needs. Returns null when nothing on the ladder is
 * big enough, which is a design that cannot be built at all rather than one
 * that is merely expensive.
 */
export function halfExtentForStraightRun(tiles, startingHalfExtent) {
  const fits = (halfExtent) => halfExtent * 2 + 1 >= tiles;
  if (fits(startingHalfExtent)) return startingHalfExtent;
  const parcel = LAND_PARCELS.find(p => fits(p.halfExtent));
  return parcel ? parcel.halfExtent : null;
}
