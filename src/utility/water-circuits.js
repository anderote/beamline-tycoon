// Shared temperature-circuit contract for flexible water lines and fabricated
// water-supply pipe. Temperature is topology, not a cosmetic line colour:
// cold supply, room-temperature transfer, and hot return never join.

export const WATER_CIRCUIT_COLD = 'cold';
export const WATER_CIRCUIT_ROOM = 'room';
export const WATER_CIRCUIT_HOT = 'hot';
export const WATER_CIRCUIT_COLORS = Object.freeze({
  [WATER_CIRCUIT_COLD]: '#287fc4',
  [WATER_CIRCUIT_ROOM]: '#4f9b72',
  [WATER_CIRCUIT_HOT]: '#c45b42',
});
export const WATER_CIRCUITS = Object.freeze([
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_ROOM,
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

export function waterCircuitColor(circuit, fallback = '#ffffff') {
  return WATER_CIRCUIT_COLORS[normalizeWaterCircuit(circuit)] || fallback;
}

export function waterCircuitLabel(circuit) {
  if (circuit === WATER_CIRCUIT_HOT) return 'hot return';
  if (circuit === WATER_CIRCUIT_ROOM) return 'room-temperature transfer';
  return 'cold supply';
}
