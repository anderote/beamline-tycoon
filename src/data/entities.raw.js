// Entities — autonomous wildlife and NPC agents that roam the map.
export const ENTITIES_RAW = {
  deer: {
    id: 'deer',

    // --- Sim / AI ---
    walkSpeed: 1.2,
    fleeSpeed: 4.0,
    minSpacing: 1.0,
    herdCohesionRadius: 4.0,
    wanderJitterStrength: 0.15,
    terrainBiasStrength: 0.3,
    labAversionRadius: 3.0,
    spookRadius: 6.0,
    cursorSpookRadius: 4.0,
    cursorSpookDwell: 0.5,
    grazeChance: 0.02,
    grazeDurationRange: [3, 8],
    maxSteepness: 1.0,

    // --- 3D model rendering ---
    modelScale: 0.7,              // world-unit scale of GLB mesh
    modelYOffset: 0.0,            // world-unit Y offset so feet touch the terrain
    modelHeadingOffset: Math.PI,  // radians — Meshy models face -Z; π flips to +Z

    // --- Pose selection ---
    walkMinSpeed: 0.3,            // below this speed, use stand pose instead of walk
  },
};
