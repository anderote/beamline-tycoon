// src/advisor/context.js — the snapshot every advice rule reads.
//
// Rules are pure functions of this object and never touch `game` directly.
// That is the whole point: a rule that reaches into live state cannot be
// tested against a fixture, cannot be reasoned about on its own, and can
// mutate the facility it is supposed to be commenting on. Everything a rule
// needs is copied out here, once per evaluation.
//
// The advisor runs on the game tick, and the tick starts before Pyodide has
// booted and before the utility gate has ever solved. Every field therefore
// defaults rather than throwing — a half-built context yields quiet rules,
// not a crash in the tick loop.

import { TUTORIAL_STEPS } from '../data/tutorial.js';

/** Count beamline placements across every pipe (placements live on the pipes,
 *  not in state.placeables — see the note in data/tutorial.js). */
function countPlacements(state) {
  let n = 0;
  for (const bp of state.beamPipes || []) n += (bp.placements || []).length;
  return n;
}

/** The first tutorial step whose condition is not yet met, or null when the
 *  checklist is complete. A step whose condition throws on a partially-booted
 *  state counts as incomplete rather than taking the tick down with it. */
function firstIncompleteStep(state) {
  for (const step of TUTORIAL_STEPS) {
    let done = false;
    try {
      done = !!step.condition(state);
    } catch {
      done = false;
    }
    if (!done) {
      return { id: step.id, name: step.name, hint: step.hint, group: step.group };
    }
  }
  return null;
}

/**
 * Build the advice context.
 *
 * @param {object} game     the Game; may be mid-boot
 * @param {object} designer the BeamlineDesigner, when one is open
 * @returns {object} a plain snapshot holding no references into game state
 */
export function buildAdvisorContext(game, designer) {
  const state = (game && game.state) || {};
  const resources = state.resources || {};
  const econ = state.economySnapshot || {};

  const blockers = (state.infraBlockers || []).map(b => ({
    code: b.code || '',
    message: b.message || b.reason || '',
    severity: b.severity || 'hard',
    placeableId: b.location?.placeableId ?? null,
    portName: b.location?.portName ?? null,
    zoneId: b.location?.zoneId ?? null,
  }));

  // NOTE: state.unwiredSinks is deliberately NOT copied here. It is a nested
  // object — { [placeableId]: { [utility]: true } }, see utility-gate.js — not
  // the array an earlier draft of this file assumed, and the gate has already
  // turned every hard-required unwired sink into an entry in infraBlockers
  // carrying the placeable, the port and a code. Every rule reads the blockers;
  // nothing needs the raw topology. Adding it back means handling the object
  // shape, not calling .map on it.

  // Optics advice only exists while a designer is open on a draft. A closed
  // designer is not an error — those rules simply have nothing to say.
  const ghostQuads = (designer && Array.isArray(designer.ghostQuads))
    ? designer.ghostQuads.map(g => ({ s: g.s, nodeIndex: g.nodeIndex, polarity: g.polarity }))
    : [];

  const rawDispersion = designer?.draftDispersionWarnings || [];
  const dispersionWarnings = rawDispersion.map(w => ({
    elementIndex: w.element_index ?? w.elementIndex ?? -1,
    elementType: w.element_type ?? w.elementType ?? '',
    etaX: w.eta_x ?? w.etaX ?? 0,
    s: w.s ?? 0,
  }));

  const draftNodes = (designer && Array.isArray(designer.draftNodes)) ? designer.draftNodes : [];
  const QUAD_TYPES = new Set([
    'quadrupole', 'scQuad', 'protonQuad', 'combinedFunctionMagnet',
  ]);

  return {
    tick: state.tick || 0,
    funding: resources.funding || 0,
    income: econ.income?.total || 0,
    expenses: econ.upkeep?.total || 0,
    net: econ.net || 0,

    blockers,
    beamRunning: !!state.infraCanRun && countPlacements(state) > 0,
    placeableCount: (state.placeables || []).length,
    beamlineCount: (state.beamPipes || []).length,
    placementCount: countPlacements(state),

    designerOpen: !!(designer && designer.isOpen),
    ghostQuads,
    dispersionWarnings,
    draftLength: designer?.totalLength || 0,
    draftQuadCount: draftNodes.filter(n => QUAD_TYPES.has(n.type)).length,

    tutorial: { nextStep: firstIncompleteStep(state) },
  };
}
