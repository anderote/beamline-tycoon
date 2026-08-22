// Logical objects exposed to click/drag selection.
//
// Placeables have durable ids, but floors and building edges do not. This
// module gives every selectable object a stable key and maps the game's
// authoring kinds onto the five player-facing selection categories. It stays
// pure: input owns the selected keys and the renderer owns their presentation.

import { COMPONENTS } from '../data/components.js';
import { GROUNDS_WALLS } from '../data/grounds.js';
import { PLACEABLES } from '../data/placeables/index.js';
import {
  DOOR_TYPES, FLOORS, WALL_TYPES, WINDOW_TYPES,
} from '../data/structure.js';
import { placementPose } from '../beamline/pipe-placements.js';
import {
  edgeKey, mirrorEdge, parseEdgeKey, doorRecordCoversEdge,
} from './edge-keys.js';
import { levelOf, sameLevel, tileKey } from './storeys.js';

export const SELECTION_CATEGORIES = Object.freeze([
  Object.freeze({ key: 'beamline', label: 'Beamline' }),
  Object.freeze({ key: 'infra', label: 'Infra' }),
  Object.freeze({ key: 'facility', label: 'Facility' }),
  Object.freeze({ key: 'structure', label: 'Structure' }),
  Object.freeze({ key: 'grounds', label: 'Grounds' }),
]);

export const SELECTION_CATEGORY_KEYS = Object.freeze(
  SELECTION_CATEGORIES.map(category => category.key),
);

const SELECTION_CATEGORY_SET = new Set(SELECTION_CATEGORY_KEYS);

export function isSelectionCategory(value) {
  return SELECTION_CATEGORY_SET.has(value);
}

export function selectionCategoryForPlaceable(entry, def = PLACEABLES[entry?.type]) {
  if (isSelectionCategory(def?.selectionCategory)) return def.selectionCategory;
  const kind = entry?.kind || entry?.category || def?.kind;
  if (kind === 'beamline') return 'beamline';
  if (kind === 'infrastructure') return 'infra';
  if (kind === 'equipment' || kind === 'furnishing') return 'facility';
  if (kind === 'decoration') {
    return def?.category === 'structureLights' || def?.mount === 'wall'
      || def?.mount === 'overhead' || def?.mount === 'surface'
      ? 'structure'
      : 'grounds';
  }
  return 'facility';
}

export function floorSelectionKey(col, row, level = 0) {
  return `floor:${tileKey(col, row, level)}`;
}

/** One key for the two spellings of the same physical edge. */
export function physicalEdgeSelectionKey(col, row, edge, level = 0) {
  const direct = edgeKey(col, row, edge, level);
  const mirror = mirrorEdge(col, row, edge, level);
  if (!mirror) return `edge:${direct}`;
  const alias = edgeKey(mirror.col, mirror.row, mirror.edge, level);
  return `edge:${direct < alias ? direct : alias}`;
}

export function attachmentSelectionKey(id) {
  return `attachment:${id}`;
}

export function selectionTargetForPlaceable(entry, rootObj = null) {
  if (!entry?.id) return null;
  const def = PLACEABLES[entry.type] || COMPONENTS[entry.type] || {};
  return {
    key: entry.id,
    id: entry.id,
    targetKind: 'placeable',
    selectionCategory: selectionCategoryForPlaceable(entry, def),
    type: entry.type,
    name: def.name || entry.type || 'Unknown item',
    col: entry.col,
    row: entry.row,
    subCol: entry.subCol || 0,
    subRow: entry.subRow || 0,
    dir: entry.dir || 0,
    level: levelOf(entry),
    entry,
    rootObj,
  };
}

function floorTarget(tile) {
  const def = FLOORS[tile?.type] || {};
  return {
    key: floorSelectionKey(tile.col, tile.row, levelOf(tile)),
    targetKind: 'floor',
    selectionCategory: def.groundsSurface ? 'grounds' : 'structure',
    type: tile.type,
    name: def.name || tile.type || 'Floor',
    col: tile.col,
    row: tile.row,
    subCol: 0,
    subRow: 0,
    dir: tile.orientation ? 1 : 0,
    level: levelOf(tile),
    tile,
  };
}

function samePhysicalEdge(a, b) {
  return !!a && !!b && sameLevel(a, levelOf(b))
    && physicalEdgeSelectionKey(a.col, a.row, a.edge, levelOf(a))
      === physicalEdgeSelectionKey(b.col, b.row, b.edge, levelOf(b));
}

function edgeTarget(state, wall) {
  const overlay = (state.wallOverlays || []).find(entry => samePhysicalEdge(entry, wall)) || null;
  const door = (state.doors || []).find(entry => doorRecordCoversEdge(
    entry, DOOR_TYPES[entry.type], wall.col, wall.row, wall.edge,
  ) && sameLevel(entry, levelOf(wall))) || null;
  const window = (state.windows || []).find(entry => samePhysicalEdge(entry, wall)) || null;
  const wallDef = WALL_TYPES[wall.type] || {};
  const feature = window || door || overlay || wall;
  const featureDef = window
    ? WINDOW_TYPES[window.type]
    : door
      ? DOOR_TYPES[door.type]
      : overlay
        ? WALL_TYPES[overlay.type]
        : wallDef;
  return {
    key: physicalEdgeSelectionKey(wall.col, wall.row, wall.edge, levelOf(wall)),
    targetKind: 'edge',
    selectionCategory: GROUNDS_WALLS[wall.type] ? 'grounds' : 'structure',
    type: feature.type,
    name: featureDef?.name || wallDef.name || wall.type || 'Wall',
    col: wall.col,
    row: wall.row,
    subCol: 0,
    subRow: 0,
    dir: wall.edge === 'e' ? 1 : wall.edge === 's' ? 2 : wall.edge === 'w' ? 3 : 0,
    edge: wall.edge,
    level: levelOf(wall),
    wall,
    overlay,
    door,
    window,
  };
}

function attachmentTarget(pipe, attachment) {
  const pose = placementPose(pipe, attachment);
  if (!pose) return null;
  const def = COMPONENTS[attachment.type] || {};
  return {
    key: attachmentSelectionKey(attachment.id),
    id: attachment.id,
    targetKind: 'beamlineAttachment',
    selectionCategory: 'beamline',
    type: attachment.type,
    name: def.name || attachment.type || 'Beamline component',
    col: pose.col,
    row: pose.row,
    subCol: 0,
    subRow: 0,
    dir: pose.dir || 0,
    pipeId: pipe.id,
    attachment,
  };
}

/** Build the complete current selection catalogue from canonical game state. */
export function selectionTargetsForState(state) {
  if (!state) return [];
  const targets = [];
  for (const entry of state.placeables || []) {
    const target = selectionTargetForPlaceable(entry);
    if (target) targets.push(target);
  }
  for (const pipe of state.beamPipes || []) {
    for (const attachment of pipe.placements || []) {
      const target = attachmentTarget(pipe, attachment);
      if (target) targets.push(target);
    }
  }
  for (const tile of state.floors || []) targets.push(floorTarget(tile));
  for (const wall of state.walls || []) targets.push(edgeTarget(state, wall));
  return targets;
}

export function selectionTargetByKey(state, key) {
  if (!state || key == null) return null;
  if (!String(key).startsWith('floor:')
      && !String(key).startsWith('edge:')
      && !String(key).startsWith('attachment:')) {
    const entry = (state.placeables || []).find(placeable => placeable.id === key);
    return selectionTargetForPlaceable(entry);
  }
  return selectionTargetsForState(state).find(target => target.key === key) || null;
}

export function parseFloorSelectionKey(key) {
  const match = /^floor:(?:(\d+)\|)?(-?\d+),(-?\d+)$/.exec(String(key));
  if (!match) return null;
  const value = { col: Number(match[2]), row: Number(match[3]) };
  return match[1] ? { ...value, level: Number(match[1]) } : value;
}

export function parsePhysicalEdgeSelectionKey(key) {
  const match = /^edge:(.+)$/.exec(String(key));
  return match ? parseEdgeKey(match[1]) : null;
}

export function selectionCategoryCounts(targets) {
  const counts = Object.fromEntries(SELECTION_CATEGORY_KEYS.map(key => [key, 0]));
  for (const target of targets || []) {
    if (isSelectionCategory(target?.selectionCategory)) counts[target.selectionCategory]++;
  }
  return counts;
}

export function selectionTargetPosition(target) {
  if (!target) return '(?, ?)';
  const edge = target.targetKind === 'edge' ? ` ${String(target.edge || '').toUpperCase()}` : '';
  return `(${target.col ?? '?'}, ${target.row ?? '?'})${edge}`;
}
