// src/utility/endpoint-lookup.js
//
// Minimal id -> record lookup over everything a utility line can attach to.
//
// WHY NOT listUtilityEndpoints: that module resolves placement GEOMETRY, so it
// imports COMPONENTS, which imports validate.js, which imports the utility
// registry — and the registry imports the solver type descriptors. A solver
// reaching for listUtilityEndpoints therefore closes an import cycle and the
// whole registry fails to initialise.
//
// Solvers don't need geometry. They need to know what a sink IS (its type) and
// what the physics pass last recorded on it. Both live directly on the stored
// object, so this walks state.placeables and pipe.placements and hands back the
// raw records with no resolution and no heavy imports.
//
// The pipe-placements half is not optional: every cryo sink in the game is a
// role-'placement' module living inside pipe.placements, so a placeables-only
// walk would find none of them.

/**
 * @param {object} worldState  game state (reads placeables + beamPipes)
 * @returns {Map<string, object>} id -> the stored placeable or placement
 */
export function endpointsById(worldState) {
  const byId = new Map();
  if (!worldState) return byId;
  for (const p of (worldState.placeables || [])) {
    if (p && p.id) byId.set(p.id, p);
  }
  for (const pipe of (worldState.beamPipes || [])) {
    for (const att of (pipe.placements || [])) {
      // `pipeId` is spliced on rather than mutating the stored placement: the
      // vacuum solver needs to know which beam pipe a sink sits on so it can
      // charge that pipe's surface area to whatever pumps serve it.
      if (att && att.id) byId.set(att.id, { ...att, pipeId: pipe.id });
    }
  }
  return byId;
}
