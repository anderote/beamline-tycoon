// src/data/placeables/dims.js
//
// Shared dimension normalizer for placeable def files.
// All dims are in SUB-TILES (1 sub-tile = 0.5m). gridW/gridH in the raw
// files are authored in sub-tiles too (not whole tiles), matching subW/subL.
// subW = X footprint, subL = Z footprint, subH = Y height.

export function toDims(raw, { subH = 1 } = {}) {
  return {
    subW: raw.subW ?? raw.gridW ?? 4,
    subL: raw.subL ?? raw.gridH ?? 4,
    subH: raw.subH ?? subH,
  };
}
