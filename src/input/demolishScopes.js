// Demolish mode definitions. Demolition is one tool whose five filters mirror
// the player-facing selection categories. Keeping this classification aligned
// with selection is important: an indoor light must not become Grounds merely
// because its Placeable kind is `decoration`, and a transformer linked into a
// Grounds palette still belongs to Infra.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { GROUNDS_WALLS } from '../data/grounds.js';
import { DOOR_TYPES, FLOORS, variantCost } from '../data/structure.js';
import { selectionCategoryForPlaceable } from '../game/selection-targets.js';

/**
 * 50% refund of a placeable/component definition's funding cost.
 *
 * Variant-aware: defs that declare `variantCosts` are CHARGED per variant
 * (Game.placeWall/placeWindow/placeInfraTile) and, for walls and windows,
 * refunded per variant too — so the tooltip has to price the variant that
 * was actually placed, not the def's base cost. Omitting `variant` keeps
 * the old flat behaviour for defs that have no variant pricing.
 *
 * @param {object} compOrDef - placeable or component def with `cost`
 * @param {number} [variant] - placed variant index
 * @returns {number} integer refund amount
 */
export function demolishRefund(compOrDef, variant = 0) {
  if (!compOrDef) return 0;
  return Math.floor(variantCost(compOrDef, variant) * 0.5);
}

export const DEMOLISH_FILTERS = Object.freeze([
  Object.freeze({
    key: 'structure', label: 'Structure', defaultEnabled: false, color: '#a88666',
    desc: 'Building floors, walls, doors, windows, and indoor fixtures',
  }),
  Object.freeze({
    key: 'beamline', label: 'Beamline', defaultEnabled: true, color: '#cc5555',
    desc: 'Beamline modules, beam pipes, and pipe-mounted hardware',
  }),
  Object.freeze({
    key: 'infra', label: 'Infra', defaultEnabled: true, color: '#cc8844',
    desc: 'Infrastructure modules, utility lines, and line attachments',
  }),
  Object.freeze({
    key: 'facility', label: 'Facility', defaultEnabled: true, color: '#889966',
    desc: 'Facility equipment, furnishings, and room zones',
  }),
  Object.freeze({
    key: 'grounds', label: 'Grounds', defaultEnabled: false, color: '#668866',
    desc: 'Outdoor surfaces, fences, gates, and scenery',
  }),
]);

const DEMOLISH_FILTER_KEYS = new Set(DEMOLISH_FILTERS.map(filter => filter.key));

export function defaultDemolishFilters() {
  return new Set(DEMOLISH_FILTERS
    .filter(filter => filter.defaultEnabled)
    .map(filter => filter.key));
}

export function normalizeDemolishFilters(filters) {
  const values = filters instanceof Set ? filters : new Set(filters || []);
  return new Set([...values].filter(key => DEMOLISH_FILTER_KEYS.has(key)));
}

/**
 * Immutable demolition decision surface shared by hover, clicks, and area
 * sweeps. `has(kind)` deliberately matches Set's API so the existing object
 * picker can cheaply reject entire Placeable families before applying the
 * finer Structure/Grounds decoration split.
 */
export function createDemolishPolicy(filters = defaultDemolishFilters()) {
  const enabled = normalizeDemolishFilters(filters);
  const placeableKinds = new Set();
  if (enabled.has('beamline')) placeableKinds.add('beamline');
  if (enabled.has('infra')) placeableKinds.add('infrastructure');
  if (enabled.has('facility')) {
    placeableKinds.add('equipment');
    placeableKinds.add('furnishing');
  }
  if (enabled.has('structure') || enabled.has('grounds')) placeableKinds.add('decoration');

  return Object.freeze({
    enabled,
    has: kind => placeableKinds.has(kind),
    allowsCategory: category => enabled.has(category),
    allowsPlaceable(entry, def = PLACEABLES[entry?.type] || COMPONENTS[entry?.type]) {
      return enabled.has(selectionCategoryForPlaceable(entry, def));
    },
    allowsFloor(type) {
      const def = FLOORS[type];
      return !!def && enabled.has(def.groundsSurface ? 'grounds' : 'structure');
    },
    allowsEdge(hit) {
      if (!hit) return false;
      const groundsEdge = !!GROUNDS_WALLS[hit.wallType]
        || DOOR_TYPES[hit.doorType]?.subsection === 'gates';
      return enabled.has(groundsEdge ? 'grounds' : 'structure');
    },
  });
}

// Compatibility policies for older saved input paths and focused tool tests.
// Production demolition always uses the filtered policy above.
export function legacyDemolishPolicy(type) {
  if (type === 'demolishBuilding') return createDemolishPolicy(['structure', 'grounds', 'facility']);
  if (type === 'demolishBeamline') return createDemolishPolicy(['beamline']);
  if (type === 'demolishUtility') return createDemolishPolicy(['infra']);
  return createDemolishPolicy(['structure', 'beamline', 'infra', 'facility', 'grounds']);
}

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
  if (found.kind === 'utilityAttachment') return demolishRefund(found.placeable);
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
  if (found.kind === 'utilityAttachment') {
    return found.placeable?.name || found.attachment?.type || 'Vacuum Instrument';
  }
  const def = found.placeable;
  return def?.name || found.entry?.type || found.node?.type || 'Unknown';
}
