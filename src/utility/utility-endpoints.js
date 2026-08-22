// src/utility/utility-endpoints.js
//
// Everything a utility line can attach to.
//
// Beamline components come in two storage flavours: free-standing modules
// (role 'junction') live in state.placeables, while role 'placement' modules —
// cavities, quadrupoles, BPMs, cryomodules — live inside the pipe that carries
// them (pipe.placements). Both declare utility ports in utility-ports-v2, but
// the whole utility system used to index state.placeables only, so a
// placement's declared pwr_in / rf_in / cryo_in was invisible: it could not be
// discovered into a network, could not be hovered, and could not be wired.
// Every cryoTransfer sink in the game is a placement, so the cryo plant had
// nothing to serve and the quench path was dead code.
//
// This module is the single place that flattens both into placeable-like
// records, so discovery, line validation and port hit-testing all see the same
// endpoint set.

import { COMPONENTS } from '../data/components.js';
import { placementPose } from '../beamline/pipe-placements.js';
import { utilityAttachmentPose, VACUUM_LINE_MOUNT_Y } from './line-attachments.js';

/**
 * Placement → placeable-like record.
 *
 * placementPose returns the CENTER of the placement (that's what the renderer
 * draws on), while port geometry (utility/ports.js portWorldPosition) measures
 * from the footprint's anchor corner. Negative subCol/subRow of half the
 * footprint re-center it, so ports land on the mesh's real edges.
 */
function placementRecord(pipe, att) {
  const pose = placementPose(pipe, att);
  if (!pose) return null;
  const def = COMPONENTS[att.type];
  const subL = (def && def.subL) || 2;
  const subW = (def && def.subW) || 2;
  const swap = (pose.dir === 1 || pose.dir === 3);
  const footColSub = swap ? subL : subW;
  const footRowSub = swap ? subW : subL;
  return {
    id: att.id,
    type: att.type,
    kind: 'beamline',
    category: 'beamline',
    col: pose.col,
    row: pose.row,
    subCol: -footColSub / 2,
    subRow: -footRowSub / 2,
    dir: pose.dir,
    params: att.params,
    portsFlipped: att.portsFlipped === true,
    pipeId: pipe.id,
    isPlacement: true,
    // Physics write-back (Game._writeBackCavityResults). The cryogenic solver
    // needs the gradient a cavity actually reached to work out how much heat
    // it is dumping into the bath, and every cryo sink in the game is a
    // placement — so this has to survive the flattening or the thermal loop
    // sees no dynamic load at all.
    gradientAchieved: att.gradientAchieved,
  };
}

function utilityAttachmentRecord(line, att) {
  const pose = utilityAttachmentPose(line, att);
  if (!pose) return null;
  return {
    id: att.id,
    type: att.type,
    kind: 'infrastructure',
    category: 'infrastructure',
    col: pose.col,
    row: pose.row,
    subCol: null,
    subRow: null,
    worldX: pose.worldX,
    worldZ: pose.worldZ,
    dir: pose.dir,
    params: att.params,
    utilityLineId: line.id,
    // Utility attachments currently belong to vacuum runs. Retired saved
    // lane values cannot move the gauge away from the fixed vacuum datum.
    yOffset: VACUUM_LINE_MOUNT_Y - 1.0,
    isPlacement: true,
    isUtilityAttachment: true,
  };
}

/**
 * All utility endpoints in the world: state.placeables followed by every pipe
 * placement. Placements are synthesized fresh on each call (they are derived
 * from pipe geometry) — callers that need them repeatedly should build one
 * index and reuse it.
 */
export function listUtilityEndpoints(state) {
  const out = [];
  for (const p of (state && state.placeables) || []) out.push(p);
  for (const pipe of (state && state.beamPipes) || []) {
    for (const att of (pipe.placements) || []) {
      const rec = placementRecord(pipe, att);
      if (rec) out.push(rec);
    }
  }
  const lines = state?.utilityLines;
  const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
  for (const line of iter) {
    for (const att of (line?.attachments || [])) {
      const rec = utilityAttachmentRecord(line, att);
      if (rec) out.push(rec);
    }
  }
  return out;
}

/** id → endpoint Map over listUtilityEndpoints(state). */
export function makeUtilityEndpointIndex(state) {
  const byId = new Map();
  for (const e of listUtilityEndpoints(state)) byId.set(e.id, e);
  return byId;
}

/** Single endpoint lookup. Prefer the index when resolving more than one. */
export function findUtilityEndpoint(state, id) {
  for (const p of (state && state.placeables) || []) {
    if (p && p.id === id) return p;
  }
  for (const pipe of (state && state.beamPipes) || []) {
    for (const att of (pipe.placements) || []) {
      if (att && att.id === id) return placementRecord(pipe, att);
    }
  }
  const lines = state?.utilityLines;
  const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
  for (const line of iter) {
    for (const att of (line?.attachments || [])) {
      if (att && att.id === id) return utilityAttachmentRecord(line, att);
    }
  }
  return null;
}
