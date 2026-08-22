// Shared hot/cold circuit contract for flexible water lines and fabricated
// water-supply pipe. Temperature is topology, not a cosmetic line colour: a
// hot return may never be joined to a cold supply header.

export const WATER_CIRCUIT_COLD = 'cold';
export const WATER_CIRCUIT_HOT = 'hot';
export const WATER_CIRCUITS = Object.freeze([
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_HOT,
]);

const WATER_UTILITIES = new Set(['coolingWater', 'waterSupplyPipe']);

export function isWaterUtility(utilityType) {
  return WATER_UTILITIES.has(utilityType);
}

export function normalizeWaterCircuit(value) {
  return WATER_CIRCUITS.includes(value) ? value : null;
}

export function portWaterCircuit(spec) {
  return normalizeWaterCircuit(spec?.params?.waterCircuit);
}

export function lineWaterCircuit(line) {
  return normalizeWaterCircuit(line?.waterCircuit);
}

export function waterCircuitLabel(circuit) {
  return circuit === WATER_CIRCUIT_HOT ? 'hot return' : 'cold supply';
}
