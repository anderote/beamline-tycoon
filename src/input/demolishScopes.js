// Demolish mode definitions. Each demolish tool maps to a scope (the set
// of placeable kinds it can delete), a display label, a description, and
// a swatch color used by the HUD palette.
//
// Cascade tiers (each tier deletes its own kind plus all kinds below it):
//   demolishBeamline > demolishEquipment > demolishFurnishing > demolishDecoration
// Standalone single-kind modes do NOT cascade.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';

/**
 * 50% refund of a placeable/component definition's funding cost.
 * @param {object} compOrDef - placeable or component def with `cost`
 * @returns {number} integer refund amount
 */
export function demolishRefund(compOrDef) {
  if (!compOrDef) return 0;
  const cost = typeof compOrDef.cost === 'object'
    ? (compOrDef.cost.funding || 0)
    : (compOrDef.cost || 0);
  return Math.floor(cost * 0.5);
}

// Cascading placeable scopes. Each tier includes itself and every tier below.
// Order matters: top-to-bottom is decreasing scope.
export const DEMOLISH_PLACEABLE_SCOPE = {
  demolishBeamline:   new Set(['beamline', 'equipment', 'furnishing', 'decoration']),
  demolishEquipment:  new Set(['equipment', 'furnishing', 'decoration']),
  demolishFurnishing: new Set(['furnishing', 'decoration']),
  demolishDecoration: new Set(['decoration']),
  // demolishAll behaves like the top tier for placeables, plus standalone systems.
  demolishAll:        new Set(['beamline', 'equipment', 'furnishing', 'decoration']),
};

// Standalone (non-cascading) demolish modes. These each affect exactly one
// system and never touch placeables.
export const DEMOLISH_STANDALONE = new Set([
  'demolishWall',
  'demolishDoor',
  'demolishFloor',
  'demolishZone',
  'demolishUtility',
]);

// HUD palette button definitions, in display order.
export const DEMOLISH_BUTTONS = [
  // Cascade tiers
  { key: 'demolishBeamline',   name: 'Demolish Beamline',  desc: 'Beamline + everything below', color: '#c44' },
  { key: 'demolishEquipment',  name: 'Demolish Equipment', desc: 'Equipment + furnishing + decoration', color: '#a64' },
  { key: 'demolishFurnishing', name: 'Demolish Furniture', desc: 'Furniture + decoration', color: '#a48' },
  { key: 'demolishDecoration', name: 'Demolish Decoration', desc: 'Decoration only', color: '#86a' },
  // Standalone
  { key: 'demolishWall',       name: 'Demolish Walls',     desc: 'Wall segments', color: '#a86' },
  { key: 'demolishDoor',       name: 'Demolish Doors',     desc: 'Door segments', color: '#88a' },
  { key: 'demolishFloor',      name: 'Demolish Floor',     desc: 'Flooring tiles', color: '#a44' },
  { key: 'demolishZone',       name: 'Demolish Zone',      desc: 'Zone overlays', color: '#a84' },
  { key: 'demolishUtility',    name: 'Demolish Utilities', desc: 'Utility pipes / cables', color: '#c84' },
  // Sweeper
  { key: 'demolishAll',        name: 'Demolish All',       desc: 'Everything on the hovered tile', color: '#c22' },
];

/**
 * Compute the refund for a deletable target (the shape returned by
 * _findDeletablePlaceable). Used by the hover overlay and demolishTarget.
 * @param {object} found - { kind, placeable, entry?, node?, attachment?, pipeId? }
 * @param {object} game - Game instance (needed for beam pipe segment lookup)
 */
export function refundForFound(found, game) {
  if (!found) return 0;
  if (found.kind === 'beampipe') {
    const pipe = (game.state.beamPipes || []).find(p => p.id === found.pipeId);
    if (!pipe) return 0;
    const segCount = Math.max(1, (pipe.path.length - 1) || 1);
    const driftDef = COMPONENTS.drift;
    const costPerTile = driftDef ? driftDef.cost.funding : 10000;
    return Math.floor(costPerTile * segCount * 0.5);
  }
  if (found.kind === 'attachment') {
    return demolishRefund(found.placeable);
  }
  return demolishRefund(found.placeable);
}

/**
 * Display name for a deletable target.
 */
export function nameForFound(found) {
  if (!found) return 'Unknown';
  if (found.kind === 'beampipe') return 'Beam Pipe';
  if (found.kind === 'attachment') {
    return found.placeable?.name || found.attachment?.type || 'Attachment';
  }
  const def = found.placeable;
  return def?.name || found.entry?.type || found.node?.type || 'Unknown';
}
