// Shared temperature-circuit contract for flexible water lines and fabricated
// water-supply pipe. Temperature is topology, not a cosmetic line colour:
// cold supply, lukewarm transfer, and hot return never join.

export const WATER_CIRCUIT_COLD = 'cold';
export const WATER_CIRCUIT_LUKEWARM = 'lukewarm';
// Source compatibility for modules that imported the former symbol. The
// canonical persisted value is now `lukewarm`; normalizeWaterCircuit also
// upgrades old saves whose lines and ports still contain `room`.
export const WATER_CIRCUIT_ROOM = WATER_CIRCUIT_LUKEWARM;
export const WATER_CIRCUIT_HOT = 'hot';
export const WATER_CIRCUIT_COLORS = Object.freeze({
  [WATER_CIRCUIT_COLD]: '#287fc4',
  [WATER_CIRCUIT_LUKEWARM]: '#4f9b72',
  [WATER_CIRCUIT_HOT]: '#c45b42',
});
export const WATER_CIRCUITS = Object.freeze([
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_LUKEWARM,
  WATER_CIRCUIT_HOT,
]);

const WATER_UTILITIES = new Set(['coolingWater', 'waterSupplyPipe']);

export function isWaterUtility(utilityType) {
  return WATER_UTILITIES.has(utilityType);
}

export function normalizeWaterCircuit(value) {
  if (value === 'room') return WATER_CIRCUIT_LUKEWARM;
  return WATER_CIRCUITS.includes(value) ? value : null;
}

export function portWaterCircuit(spec) {
  return normalizeWaterCircuit(spec?.params?.waterCircuit);
}

export function lineWaterCircuit(line) {
  return normalizeWaterCircuit(line?.waterCircuit);
}

export function waterCircuitColor(circuit, fallback = '#ffffff') {
  return WATER_CIRCUIT_COLORS[normalizeWaterCircuit(circuit)] || fallback;
}

export function waterCircuitLabel(circuit) {
  const normalized = normalizeWaterCircuit(circuit);
  if (normalized === WATER_CIRCUIT_HOT) return 'hot return';
  if (normalized === WATER_CIRCUIT_LUKEWARM) return 'lukewarm transfer';
  return 'cold supply';
}
