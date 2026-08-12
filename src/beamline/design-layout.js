// src/beamline/design-layout.js — the logical sequence a saved design turns
// into when it is placed on the map.
//
// DesignPlacer used to walk `design.components` twice: once in _recompute()
// for the price quote and preview footprint, once in confirm() for the actual
// placement. Both walks re-implemented the same three rules (pipe placements do
// not occupy tiles and ride the NEXT pipe, junctions sit trackLen + <pipe>
// tiles apart, placements with no pipe to land on are dropped), which meant the
// quote and the placement could disagree — and neither could be checked from
// a test or a validation harness without a DOM, a renderer and a live Game.
//
// So the sequencing lives here, headless: COMPONENTS is the only import, no
// THREE, no document. DesignPlacer keeps the geometry (which tile, which
// facing, which junction rotation) and consumes this for the ordering; a
// harness consumes the same call to know exactly what beamline the player
// would end up with.

import { COMPONENTS } from '../data/components.js';

// One map tile of beam pipe is four sub-units, i.e. 2 m of beam (a sub-unit is
// 0.5 m — see flattener.js). Modules are laid out trackLen + <pipe tiles> apart
// and the connecting run goes face to face, so the pipe's sub-length is exactly
// tiles * SUB_PER_TILE (see DesignPlacer._buildPipePath for why it is
// face-to-face and not anchor-to-anchor).
const SUB_PER_TILE = 4;

// Minimum drift, in sub-units, that must survive between a placement and its
// neighbour (and between a placement and the junction face at either end of the
// pipe). n placements make n + 1 such gaps.
//
// This exists because the pipe used to be hard-coded to ONE tile — 4 sub-units
// — no matter what was mounted on it. Two quadrupoles are 2 sub-units each and
// exactly fill it, so findSlot rejected the second with 'overlap'; a cryomodule
// is 16 sub-units and could never fit at all. Half a sub-unit (0.25 m) of
// clearance is small enough not to inflate a pipe carrying a couple of BPMs and
// large enough that nothing ever ends up flush against a module face, where
// findSlot's snap would have to clamp it and quietly move it off the position
// the quote was computed from.
const MIN_GAP_SUB = 0.5;

function trackTiles(sub, fallback) {
  return Math.ceil((sub || fallback) / 4);
}

function totalHardwareSubL(atts) {
  let sum = 0;
  for (const a of atts) sum += a.subL;
  return sum;
}

/**
 * How many map tiles the pipe carrying `atts` has to be.
 *
 * A pipe must be at least as long as the hardware bolted to it plus the
 * clearance gaps around it, and never shorter than the one tile a bare
 * inter-module run has always been.
 */
function pipeTilesFor(atts) {
  const needed = totalHardwareSubL(atts) + (atts.length + 1) * MIN_GAP_SUB;
  return Math.max(1, Math.ceil(needed / SUB_PER_TILE));
}

/**
 * Sequential, non-overlapping start positions (as 0..1 fractions of the pipe)
 * for `atts` laid along a pipe of `pipeSubL` sub-units, with the leftover
 * length split evenly into the n + 1 gaps around them.
 *
 * This replaces the old (i + 1) / (n + 1) spacing, which ignored how long the
 * attachments actually were: it spaced their START points evenly and then let
 * each one extend for its own subL, so any two neighbours whose combined length
 * exceeded the spacing overlapped. findSlot then rejected the later one with
 * 'overlap' and the player was charged for hardware that never appeared.
 *
 * `position` in pipe-placements.js is the START of the interval
 * [position, position + subL / pipe.subL], so laying the intervals end to end
 * with a gap between them is exactly the arrangement findSlot's snap mode
 * accepts verbatim — no clamping, no gap search, no reordering.
 */
function packedPositions(atts, pipeSubL) {
  const gap = (pipeSubL - totalHardwareSubL(atts)) / (atts.length + 1);
  const out = [];
  let cursor = gap;
  for (const a of atts) {
    out.push(cursor / pipeSubL);
    cursor += a.subL + gap;
  }
  return out;
}

/**
 * Expand `design.components` into the ordered run of things that placement
 * actually produces.
 *
 * @param {{ components?: Array<{type: string, params?: object}> }} design
 * @returns {{
 *   sequence: Array<
 *     | { kind: 'module', type: string, params: object|undefined, subL: number, subW: number, trackLen: number, trackW: number }
 *     | { kind: 'pipe', type: null, subL: number, tiles: number, attachments: Array<{ type: string, params: object|undefined, subL: number, position: number }> }
 *   >,
 *   discardedLeading: Array<{ type: string, params: object|undefined }>,
 *   discardedTrailing: Array<{ type: string, params: object|undefined }>,
 * }}
 *
 * `sequence` alternates module, pipe, module, ... — a pipe entry only exists
 * between two modules, because that is the only place DesignPlacer draws one.
 * The pipe entry precedes the module it feeds, matching the order the player
 * sees the beam travel in; confirm() places the module first and then wires the
 * pipe backwards to its predecessor.
 *
 * A pipe's `tiles` is how far apart the two modules either side of it must be
 * laid, and its `subL` (tiles * 4) is the length the `position` fractions on its
 * attachments are measured against — the same length validateDrawPipe will
 * derive from the path DesignPlacer draws, so the packing computed here is the
 * packing findSlot sees.
 *
 * Components whose type is unknown to COMPONENTS are dropped silently, exactly
 * as both original walks did (`if (!comp) continue`), so they never reach the
 * quote either.
 */
export function layoutDesign(design) {
  const sequence = [];
  const discardedLeading = [];
  const discardedTrailing = [];

  let pending = [];
  let placedAny = false;

  for (const c of (design?.components || [])) {
    const comp = COMPONENTS[c.type];
    if (!comp) continue;

    // `role`, NOT `placement`, is what decides whether a component goes on a
    // pipe or becomes a junction of its own. This used to test
    // `comp.placement === 'attachment'`, which is a different axis entirely:
    // `placement` describes how the CATALOGUE UI offers the thing, while `role`
    // is the beamline topology rule the hand-build path in
    // BeamlineInputController (onHover / _commitPlacement) has always used —
    // role 'junction' → placeJunction, role 'placement' → goes on a pipe.
    //
    // The two disagree on every RF cavity: buncher, pillboxCavity,
    // sbandStructure, industrialLinac, rfq, cryomodule and friends are
    // `placement: 'module'` but `role: 'placement'`. Placing a design therefore
    // made each of them a junction — and a junction with no `routing` table
    // stops flattener.pickOutgoingPort dead (`if (!routing || routing.length
    // === 0) { if (arrivalPort != null) return null; }`), so the beam walk
    // terminated at the first cavity. All three stock blueprints flattened to
    // four elements instead of ten to fourteen.
    //
    // role `undefined` (drift, and every rfPower/cooling/vacuum/dataControls
    // module) is deliberately NOT treated as a pipe placement: those are not
    // beamline elements at all, they have no on-pipe geometry, and mounting one
    // inside a beam pipe would be nonsense. They stay on the module path, where
    // the existing footprint and collision code already handles them.
    if (comp.role === 'placement') {
      pending.push({ type: c.type, params: c.params, subL: comp.subL || 2 });
      continue;
    }

    if (placedAny) {
      // The pipe is sized to its contents, not fixed at one tile — see
      // pipeTilesFor. A cryomodule alone is 16 sub-units and cannot ride a
      // 4-sub-unit run at all.
      const attachments = drainOnto(pending);
      const tiles = pipeTilesFor(attachments);
      const subL = tiles * SUB_PER_TILE;
      sequence.push({
        kind: 'pipe',
        // Beam pipes are drawn, not placed from the registry, so there is no
        // COMPONENTS id to name here — `kind` is the discriminator.
        type: null,
        subL,
        tiles,
        attachments: withPositions(attachments, subL),
      });
    } else if (pending.length > 0) {
      // Attachments authored before the first module have no pipe upstream of
      // them and are dropped rather than silently slid onto a later run, which
      // would reorder the player's design.
      discardedLeading.push(...pending.map(stripSubL));
    }
    pending = [];

    const subL = comp.subL || 4;
    const subW = comp.subW || 2;
    sequence.push({
      kind: 'module',
      type: c.type,
      params: c.params,
      subL,
      subW,
      trackLen: trackTiles(comp.subL, 4),
      trackW: trackTiles(comp.subW, 2),
    });
    placedAny = true;
  }

  // Anything still queued has no pipe downstream of it. A design consisting of
  // nothing but attachments lands here too — there was never a first module for
  // them to be "before", so they read as trailing, which is what DesignPlacer
  // has always warned about.
  if (pending.length > 0) discardedTrailing.push(...pending.map(stripSubL));

  return { sequence, discardedLeading, discardedTrailing };
}

function stripSubL(a) {
  return { type: a.type, params: a.params };
}

// The queued placements, copied so the caller's `pending` array can be reused.
// Positions are attached separately (withPositions) because the pipe has to be
// sized from the hardware BEFORE the fractions along it can be computed.
function drainOnto(pending) {
  return pending.map(a => ({ ...a }));
}

function withPositions(atts, pipeSubL) {
  const positions = packedPositions(atts, pipeSubL);
  return atts.map((a, i) => ({ ...a, position: positions[i] }));
}
