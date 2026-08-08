// Demolish mode definitions. Each demolish tool maps to a scope (the set
// of placeable kinds it can delete), a display label, a description, and
// a swatch color used by the HUD palette.
//
// Four tools (RCT-style):
//   demolishAll      — catch-all: everything on the hovered/dragged tile
//   demolishBeamline — beamline components + pipes + equipment (click-on-object)
//   demolishBuilding — walls, doors, flooring & zone overlays
//   demolishUtility  — utility lines (click a pipe/cable to remove it)

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

// Placeable-kind scopes for the click-on-object delete path.
//   demolishAll      — everything (also sweeps tiles/edges via its own handlers)
//   demolishBeamline — union of the old demolishBeamline + demolishEquipment
export const DEMOLISH_PLACEABLE_SCOPE = {
  demolishAll:       new Set(['beamline', 'infrastructure', 'equipment', 'furnishing', 'decoration']),
  demolishBeamline:  new Set(['beamline', 'infrastructure', 'equipment', 'furnishing', 'decoration']),
};

// Standalone (non-cascading) demolish modes. These never route through the
// placeable-scope click path.
export const DEMOLISH_STANDALONE = new Set([
  'demolishBuilding',
  'demolishUtility',
]);

// HUD palette button definitions, in display order. Slot order matters:
// the palette hotkey badges map slots 0-3 to Z/X/C/V. `sub` is the short
// card subtitle; `desc` is the longer preview-panel description.
// `cardName` is the short label on the palette card (the cards live inside
// the Demolish tab, so the prefix is redundant there and would truncate);
// `name` is the full tool name for the preview panel.
export const DEMOLISH_BUTTONS = [
  { key: 'demolishAll',      name: 'Demolish',          cardName: 'Demolish', sub: 'Everything on the tile',
    desc: 'Clear everything under the cursor — components, equipment, walls, floors, zones. Drag to sweep an area.', color: '#c22' },
  { key: 'demolishBeamline', name: 'Demolish Beamline', cardName: 'Beamline', sub: 'Components, pipes & equipment',
    desc: 'Beamline components, beam pipes and placed equipment. Click an object to remove it (50% refund).', color: '#c44' },
  { key: 'demolishBuilding', name: 'Demolish Building', cardName: 'Building', sub: 'Walls, doors, floors & zones',
    desc: 'Walls, doors, flooring and zone overlays. Drag along a wall to clear a run, or drag a rectangle over floors.', color: '#a86' },
  { key: 'demolishUtility',  name: 'Demolish Utility',  cardName: 'Utility', sub: 'Pipes & cables',
    desc: 'Utility pipes and cables. Click a line to remove it.', color: '#c84' },
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
  if (found.kind === 'placement') {
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
  if (found.kind === 'placement') {
    return found.placeable?.name || found.attachment?.type || 'Attachment';
  }
  const def = found.placeable;
  return def?.name || found.entry?.type || found.node?.type || 'Unknown';
}
