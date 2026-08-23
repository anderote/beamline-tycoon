// Pure presentation policy for the occasional drops that make water fittings
// feel live. Utility topology and temperature identity remain authored by the
// water-line contract; this module only selects visible emitter points.

import {
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_HOT,
  lineWaterCircuit,
  waterCircuitColor,
} from '../utility/water-circuits.js';

const WATER_LINE_TYPES = new Set(['coolingWater', 'waterSupplyPipe']);
const DRIPPING_CIRCUITS = new Set([WATER_CIRCUIT_COLD, WATER_CIRCUIT_HOT]);

function copyPoint(point) {
  if (!point) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function uniquePoints(points) {
  const seen = new Set();
  return points.filter(point => {
    const key = `${point.x.toFixed(4)}:${point.y.toFixed(4)}:${point.z.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Emit only from real connected terminal fittings. A long pipe should not
 * look porous along its body, and open construction caps are deliberately dry.
 */
export function waterDripEmitterPoints(line, worldPoints) {
  if (!WATER_LINE_TYPES.has(line?.utilityType)
      || !DRIPPING_CIRCUITS.has(lineWaterCircuit(line))
      || !Array.isArray(worldPoints) || worldPoints.length === 0) return [];

  const emitters = [];
  if (line.start) emitters.push(copyPoint(worldPoints[0]));
  if (line.end) emitters.push(copyPoint(worldPoints[worldPoints.length - 1]));
  return uniquePoints(emitters.filter(Boolean));
}

/** Build one bounded instanced-particle descriptor for a hot/cold water line. */
export function waterDripEffect(line, worldPoints, flowState = 'ok') {
  const path = waterDripEmitterPoints(line, worldPoints);
  if (path.length === 0) return null;
  const circuit = lineWaterCircuit(line);
  return {
    id: `water-fitting-drips:${line.id}`,
    kind: 'ambientDrip',
    source: 'water-fittings',
    emitterMode: 'points',
    path,
    color: waterCircuitColor(circuit, '#78bfff'),
    cycle: circuit === WATER_CIRCUIT_HOT ? 4.8 : 4.2,
    fallDuration: 0.92,
    radius: 0.024,
    elongation: 1.45,
    floorY: 0.025,
    enabled: flowState !== 'off' && flowState !== 'hard',
  };
}
