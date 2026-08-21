// Shared vertical-coordinate contract for multi-storey construction.
//
// `level` is a zero-based storey index: 0 = ground floor, 1 = second floor,
// 2 = third floor. Ground-floor occupancy keys deliberately keep their legacy
// shape so old saves, authored scenarios, and code that only operates at
// ground level continue to agree while upper-floor call sites adopt the
// level-aware helpers.

export const MAX_FLOORS = 3;
export const MAX_LEVEL = MAX_FLOORS - 1;

// The existing structural/high-bay roof datum. Ceiling profiles remain a
// presentation treatment beneath this fixed deck; every upper floor must be
// planar even when the rooms below use different suspended ceilings.
export const STOREY_HEIGHT = 3.35;

export function normalizeLevel(level) {
  const n = Number.isFinite(Number(level)) ? Math.trunc(Number(level)) : 0;
  return Math.max(0, Math.min(MAX_LEVEL, n));
}

export function levelOf(record) {
  return normalizeLevel(record?.level ?? 0);
}

export function levelWorldY(level) {
  return normalizeLevel(level) * STOREY_HEIGHT;
}

function prefix(level) {
  const normalized = normalizeLevel(level);
  return normalized === 0 ? '' : `${normalized}|`;
}

export function tileKey(col, row, level = 0) {
  return `${prefix(level)}${col},${row}`;
}

export function subtileKey(col, row, subCol, subRow, level = 0) {
  return `${prefix(level)}${col},${row},${subCol},${subRow}`;
}

function splitLevel(key) {
  const value = String(key ?? '');
  const divider = value.indexOf('|');
  if (divider < 0) return { level: 0, body: value };
  return { level: normalizeLevel(Number(value.slice(0, divider))), body: value.slice(divider + 1) };
}

export function parseTileKey(key) {
  const { level, body } = splitLevel(key);
  const [col, row] = body.split(',').map(Number);
  return { col, row, level };
}

export function parseSubtileKey(key) {
  const { level, body } = splitLevel(key);
  const [col, row, subCol, subRow] = body.split(',').map(Number);
  return { col, row, subCol, subRow, level };
}

export function storeyEdgeKey(col, row, edge, level = 0) {
  return `${prefix(level)}${col},${row},${edge}`;
}

export function withLevel(record, level) {
  const normalized = normalizeLevel(level);
  return normalized === 0 ? record : { ...record, level: normalized };
}

export function sameLevel(record, level) {
  return levelOf(record) === normalizeLevel(level);
}

export function floorLabel(level) {
  return ['GF', '2F', '3F'][normalizeLevel(level)];
}
