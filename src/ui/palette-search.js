// src/ui/palette-search.js
//
// The build-menu search bar's data layer: a flat index over every
// placeable item in the game (beamline/infra components, structure floors
// /walls/doors, grounds decorations, and facility zones/furnishings) plus a
// ranked text search over that index.
//
// There is no single source-of-truth list for "every placeable" — hud.js's
// _renderPaletteImpl switches across six separate data families, each with
// its own notion of what tab it belongs to. This module re-derives one flat
// list from those same families so a search can reach all of them at once,
// which is the whole point: browsing can't answer "where are all the desks"
// because desks are scattered across room-type tabs the player would have
// to guess at.
//
// DEMOLISH_BUTTONS (src/input/demolishScopes.js) is deliberately excluded —
// those are click-to-delete tool scopes, not things you build, so they have
// no place in a build-item search.

import { COMPONENTS } from '../data/components.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { DECORATIONS } from '../data/decorations.js';
import { ZONES, ZONE_FURNISHINGS } from '../data/facility.js';
import { MODES } from '../data/modes.js';
import { isFacilityCategory, getModeForCategory } from '../renderer/Renderer.js';

function floorHome(id, floor) {
  if (floor.structureFloor) return { mode: 'structure', category: 'flooring' };
  if (floor.groundsSurface) return { mode: 'grounds', category: 'surfaces' };
  return null;
}

// WALL_TYPES merges Structure's own walls (subsection 'walls'/'shielding')
// with Grounds' hedges/fencing (subsection 'hedges'/'fencing', defined in
// grounds.js) — see structure.js's `WALL_TYPES = { ...STRUCTURE_WALLS,
// ...GROUNDS_WALLS }`. The subsection is the only field that tells them
// apart at this point, so it doubles as the tab classifier here.
function wallHome(wall) {
  if (wall.subsection === 'walls' || wall.subsection === 'shielding') return { mode: 'structure', category: 'walls' };
  if (wall.subsection === 'hedges' || wall.subsection === 'fencing') return { mode: 'grounds', category: 'fencing' };
  return null;
}

/**
 * Pick the one tab a shared furnishing opens when selected from search.
 * The normal build palette still renders it in every compatible room tab;
 * search deliberately keeps one result per item and uses the first declared
 * live zone as its stable landing point.
 */
export function primaryFacilityZone(furnishing) {
  const candidates = furnishing.zoneType
    ? [furnishing.zoneType]
    : (Array.isArray(furnishing.zoneTypes) ? furnishing.zoneTypes : []);
  return candidates.find(zoneType => MODES.facility.categories[zoneType]) || null;
}

/**
 * Build a flat index of every searchable placeable item.
 *
 * @param {object} game - the active Game instance. Only `game.isComponentUnlocked`
 *   is used, to drop research-locked COMPONENTS entries entirely (locked
 *   items are never rendered in the normal palette either — see hud.js
 *   `_createPaletteItem`). Affordability and zone-tier gating are NOT
 *   baked in here because they change with funding/zone growth on every
 *   tick; the palette-search renderer (hud.js) re-checks those live at
 *   render time instead, the same way the normal palette does.
 * @returns {Array<{id:string, name:string, desc:string, mode:string,
 *   category:string, kind:string, source:string}>}
 */
export function buildPaletteIndex(game) {
  const index = [];

  // --- COMPONENTS (beamline + infra + true facility-mode equipment that
  // carries a `category`). Lab/room equipment placeables also live in
  // COMPONENTS (kind 'equipment' entries are merged in by components.js)
  // but have no `category` field — only `zoneType`/`zoneTypes` — so they
  // fall out of this loop naturally and are picked up once, correctly,
  // via ZONE_FURNISHINGS below.
  for (const [id, comp] of Object.entries(COMPONENTS)) {
    if (!comp.category) continue;
    const mode = getModeForCategory(comp.category);
    if (!mode) continue; // no live tab for this category — nothing to land on
    if (game && typeof game.isComponentUnlocked === 'function' && !game.isComponentUnlocked(comp)) continue;
    const kind = isFacilityCategory(comp.category) ? 'facility' : 'component';
    index.push({
      id, name: comp.name || id, desc: comp.desc || '',
      mode, category: comp.category, kind, source: 'components',
    });
  }

  // --- FLOORS (structure.js)
  for (const [id, floor] of Object.entries(FLOORS)) {
    const home = floorHome(id, floor);
    if (!home) continue;
    index.push({
      id, name: floor.name || id, desc: floor.desc || '',
      mode: home.mode, category: home.category, kind: 'floor', source: 'structure',
    });
  }

  // --- WALL_TYPES (structure.js, merges grounds.js hedges/fencing)
  for (const [id, wall] of Object.entries(WALL_TYPES)) {
    const home = wallHome(wall);
    if (!home) continue;
    index.push({
      id, name: wall.name || id, desc: wall.desc || '',
      mode: home.mode, category: home.category, kind: 'wall', source: 'structure',
    });
  }

  // --- DOOR_TYPES (structure.js) — always Structure > Doors, gates included.
  for (const [id, door] of Object.entries(DOOR_TYPES)) {
    index.push({
      id, name: door.name || id, desc: door.desc || '',
      mode: 'structure', category: 'doors', kind: 'door', source: 'structure',
    });
  }

  // --- DECORATIONS (decorations.js) — always Grounds; `category` is the
  // grounds tab key directly (treesPlants/furniture/lighting/utilities/etc.).
  for (const [id, dec] of Object.entries(DECORATIONS)) {
    if (!dec.category) continue;
    index.push({
      id, name: dec.name || id, desc: dec.desc || '',
      mode: 'grounds', category: dec.category, kind: 'decoration', source: 'decorations',
    });
  }

  // --- ZONE_FURNISHINGS (facility.js) — lab + room furnishings, always
  // Facility mode. Shared furnishings remain one search result, with their
  // first declared live zone used as a predictable landing tab. The normal
  // palette still lists the same item in every compatible room tab.
  for (const [id, furn] of Object.entries(ZONE_FURNISHINGS)) {
    const zoneType = primaryFacilityZone(furn);
    if (!zoneType) continue;
    index.push({
      id, name: furn.name || id, desc: furn.desc || '',
      mode: 'facility', category: zoneType, kind: 'furnishing', source: 'facility',
    });
  }

  // --- ZONES (facility.js) — the zone-paint tool itself, one per tab.
  for (const [id, zone] of Object.entries(ZONES)) {
    if (!MODES.facility.categories[id]) continue;
    index.push({
      id, name: zone.name || id, desc: zone.desc || '',
      mode: 'facility', category: id, kind: 'zone', source: 'facility',
    });
  }

  return index;
}

// Word-boundary matching. Plain substring search over prose ("table" inside
// "stable"/"portable"/"suitable"/"Stackable"/"Rotatable"/"Insertable" — all
// real hits a first pass of this feature produced) reads as broken: a player
// searching for a table gets cooling plant and a beam collimator back. A
// query must match from the START of some word in the text, not merely
// appear as a substring anywhere in it.
//
// `words()` splits on anything that isn't a letter/digit, which is enough
// for both prose ("Coffee Table" -> ["coffee","table"]) and item names —
// camelCase ids are handled separately (see scoreFor: ids only ever match
// on full equality, never substring, so no camelCase splitting is needed
// there).
function words(text) {
  return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** True if `needle` prefixes at least one word of `text`. Exported for its
 * own direct unit test (test-palette-search.js) — this is the one rule the
 * false-positive bug above lived in. */
export function matchesWordPrefix(text, needle) {
  return words(text).some(w => w.startsWith(needle));
}

// Ranking, borrowed in shape from src/data/wiki/search.js's scoreFor but
// scored over {id, name, desc} rather than {id, title, body}, and in a
// different priority order: exact name, then name prefix, then exact id,
// then a word in the name starting with the query, then a word in the
// description starting with the query.
//
// id matching is exact-only (no substring/prefix tier): ids are single
// camelCase tokens ('packageChiller'), and every meaningful substring of one
// ("chiller") already shows up as a real word in that item's `name`
// ("Package Chiller"), which the name tier below already catches. Adding an
// id tier on top would only re-surface the same items with no new reach.
function scoreFor(needle, item) {
  const name = item.name.toLowerCase();
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;
  if (item.id.toLowerCase() === needle) return 70;
  if (matchesWordPrefix(name, needle)) return 50;
  if (matchesWordPrefix(item.desc, needle)) return 20;
  return 0;
}

// Above this score, a result matched the item's identity (name or id).
// Below it (score 20), the query only turned up inside the description —
// still worth surfacing (that's how e.g. "klystron" ought to find RF
// sources whose names don't say the word), but capped so a handful of
// incidental description mentions don't swamp the real name matches. See
// hud.js _renderPaletteSearchResults for the divider drawn at this same
// boundary.
export const PALETTE_SEARCH_NAME_SCORE = 50;
const MAX_DESCRIPTION_ONLY_RESULTS = 6;

/**
 * Ranked matches over `index`, best first: every name/id match ranks ahead
 * of every description-only match (capped to MAX_DESCRIPTION_ONLY_RESULTS),
 * so the strong hits are never buried under incidental prose mentions.
 * Empty for a query under two characters — same rationale as searchWiki:
 * one letter matches nearly everything and helps nobody.
 *
 * @param {string} query
 * @param {ReturnType<typeof buildPaletteIndex>} index
 * @returns {Array<ReturnType<typeof buildPaletteIndex>[number] & {matchedIn: 'name'|'desc'}>}
 */
export function searchPalette(query, index) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return [];

  const nameHits = [];
  const descHits = [];
  for (const item of index) {
    const score = scoreFor(needle, item);
    if (!score) continue;
    (score >= PALETTE_SEARCH_NAME_SCORE ? nameHits : descHits).push({ item, score });
  }

  const bySort = (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name);
  nameHits.sort(bySort);
  descHits.sort(bySort);

  return [
    ...nameHits.map(({ item }) => ({ ...item, matchedIn: 'name' })),
    ...descHits.slice(0, MAX_DESCRIPTION_ONLY_RESULTS).map(({ item }) => ({ ...item, matchedIn: 'desc' })),
  ];
}
