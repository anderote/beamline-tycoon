// Canonicalize compact or older persisted placeable records at world-load
// boundaries. Scenario generators intentionally may omit fields that the
// ordinary placement command derives from the catalogue, while runtime
// consumers require the complete instance contract.

import { PLACEABLES } from '../data/placeables/index.js';

export function normalizePlaceableInstances(entries) {
  if (!Array.isArray(entries)) return [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const def = PLACEABLES[entry.type];
    const kind = def?.kind ?? entry.kind ?? entry.category ?? null;

    if (kind) {
      entry.kind = kind;
      // Runtime instances use category as a legacy alias for kind, not as
      // the catalogue/palette category carried by the definition.
      entry.category = kind;
    }

    entry.subCol ??= 0;
    entry.subRow ??= 0;
    entry.dir ??= entry.rotated ? 1 : 0;
    entry.placeY ??= 0;
    entry.stackParentId ??= null;
    entry.stackChildren ??= [];

    if ((!Array.isArray(entry.cells) || entry.cells.length === 0)
        && typeof def?.footprintCells === 'function') {
      entry.cells = def.footprintCells(
        entry.col, entry.row, entry.subCol, entry.subRow, entry.dir,
      );
    }
  }

  return entries;
}
