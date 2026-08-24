// src/data/placeables/lighting.js
//
// Facility lighting fixtures. Unlike the other per-kind def files, these
// are authored directly here rather than derived from a *.raw.js registry —
// there is no separate "lighting.raw.js"; this file IS the source of truth.
//
// Fixtures stay kind: 'decoration' (see design doc §5) — lighting is not a
// new Placeable kind. `category` is derived below from `subsection`, not
// authored per-fixture. Outdoor ground fixtures are landscaping (Grounds ->
// Lighting), while indoor floor, wall, overhead, and surface fixtures are
// building fabric (Structure -> Lights, alongside Flooring/Walls/Doors).
// `subsection` is both the palette grouping and the location discriminator
// for ground-mounted fixtures: indoor floor lamps need ordinary furnishing
// occupancy, so they correctly use mount: 'ground' rather than the
// non-occupying floor-covering mount. Two extra fields
// discriminate behavior for later tasks:
//   - mount: 'ground' | 'wall' | 'overhead' | 'surface' — placement layer.
//   - light: { color, intensity, radius, shape, coneDeg?, tiltDeg?, emitterY,
//              sourceOffsetY? }
//     — read uniformly by the renderer regardless of mount. `radius` is the
//     light pool radius in world units (meters); `emitterY` is the emitter's
//     offset above a ground/surface support, or the authored world height for
//     wall/overhead fixtures (also meters). `sourceOffsetY` is an optional
//     correction from that mounted group origin to the visible diffuser; it
//     keeps the analytic light and painted pool attached to hanging geometry.
//     `coneDeg`/`tiltDeg` are required when shape === 'cone'.
//
// `lamppost` and `bollardLight` are reworked from decorations.raw.js with
// their cost/morale/footprint carried over unchanged. `floodLight` replaces
// `spotLight`, inheriting its cost/morale/footprint too. The old geometry
// builders for all three stay keyed to the old ids in decoration-builder.js
// until Task 5 rebuilds fixture geometry — floodLight renders as nothing
// until then, which is expected.
//
// energyCost is in kW, calibrated to stay small beside a panel's 30 kW branch:
// sconces and ceiling panels are near-free (tens of watts), lampposts and
// bollards are small (hundreds of watts), and high masts/floods/high bays
// carry the real cost (roughly half a kW to 1.5 kW) — see task-3-report.md
// for the full reasoning.

const OUTDOOR_SUBSECTIONS = new Set(['pathLandscape', 'areaSecurity']);

function categoryForFixture(def) {
  return OUTDOOR_SUBSECTIONS.has(def.subsection) ? 'lighting' : 'structureLights';
}

const LIGHT_PROFILES = {
  lamppost:       { sourceRadius: 0.11, shadowSoftness: 0.55, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  doubleLamppost: { sourceRadius: 0.14, shadowSoftness: 0.6,  bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  bollardLight:   { sourceRadius: 0.07, shadowSoftness: 0.7,  bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  highMastLight:  { sourceRadius: 0.2,  shadowSoftness: 0.4,  bloomProfile: 'soft', dynamicProfile: 'arcStable', cookieProfile: 'panel' },
  floodLight:     { sourceRadius: 0.12, shadowSoftness: 0.3,  bloomProfile: 'soft', dynamicProfile: 'arcStable', cookieProfile: 'flood' },
  wallSconce:     { sourceRadius: 0.09, shadowSoftness: 0.7,  bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  bulkheadLight:  { sourceRadius: 0.1,  shadowSoftness: 0.6,  bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'cage' },
  wallStripLight: { sourceRadius: 0.16, shadowSoftness: 0.75, bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'panel' },
  emergencyWallLight: { sourceRadius: 0.08, shadowSoftness: 0.6, bloomProfile: 'soft', dynamicProfile: 'statusBlink', cookieProfile: 'soft' },
  ceilingPanel:   { sourceRadius: 0.24, shadowSoftness: 0.9,  bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'panel' },
  highBay:        { sourceRadius: 0.2,  shadowSoftness: 0.78, bloomProfile: 'soft', dynamicProfile: 'arcStable', cookieProfile: 'panel' },
  linearPendant:  { sourceRadius: 0.22, shadowSoftness: 0.88, bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'panel' },
  cleanroomPanel: { sourceRadius: 0.28, shadowSoftness: 0.94, bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'panel' },
  deskLamp:       { sourceRadius: 0.07, shadowSoftness: 0.7, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  portableWorkLight: { sourceRadius: 0.1, shadowSoftness: 0.45, bloomProfile: 'soft', dynamicProfile: 'arcStable', cookieProfile: 'flood' },
  floorLamp:      { sourceRadius: 0.11, shadowSoftness: 0.76, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  arcFloorLamp:   { sourceRadius: 0.13, shadowSoftness: 0.72, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  torchiere:      { sourceRadius: 0.14, shadowSoftness: 0.82, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  bankerLamp:     { sourceRadius: 0.08, shadowSoftness: 0.76, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  magnifierTaskLamp: { sourceRadius: 0.08, shadowSoftness: 0.68, bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'soft' },
  recessedDownlight: { sourceRadius: 0.13, shadowSoftness: 0.86, bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'soft' },
  ceilingBatten:  { sourceRadius: 0.18, shadowSoftness: 0.86, bloomProfile: 'soft', dynamicProfile: 'fluorescent', cookieProfile: 'panel' },
  emergencyCeilingLight: { sourceRadius: 0.09, shadowSoftness: 0.7, bloomProfile: 'soft', dynamicProfile: 'statusBlink', cookieProfile: 'soft' },
  pictureLight:   { sourceRadius: 0.09, shadowSoftness: 0.78, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'soft' },
  klaxonStrobe:   { sourceRadius: 0.09, shadowSoftness: 0.58, bloomProfile: 'soft', dynamicProfile: 'statusBlink', cookieProfile: 'cage' },
  rotatingBeacon: { sourceRadius: 0.1, shadowSoftness: 0.62, bloomProfile: 'soft', dynamicProfile: 'statusBlink', cookieProfile: 'soft' },
  signalTower:    { sourceRadius: 0.08, shadowSoftness: 0.65, bloomProfile: 'soft', dynamicProfile: 'statusBlink', cookieProfile: 'soft' },
  exitLight:      { sourceRadius: 0.08, shadowSoftness: 0.76, bloomProfile: 'soft', dynamicProfile: 'warmSteady', cookieProfile: 'panel' },
};

const RAW_LIGHTING_DEFS = [
  // === Ground — lamp family ===
  {
    id: 'lamppost', name: 'Lamppost', cost: { funding: 8 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'lamppost',
    blocksBuild: false, kind: 'decoration', mount: 'ground', subsection: 'pathLandscape',
    subW: 1, subL: 1, subH: 6,
    desc: 'Classic path lighting for safe walks home after night shift.',
    energyCost: 0.15,
    light: { color: '#ffa64d', intensity: 1.0, radius: 6, shape: 'point', emitterY: 2.7 },
  },
  {
    id: 'doubleLamppost', name: 'Double Lamppost', cost: { funding: 16 }, removeCost: 0,
    morale: 0.75, placement: 'outdoor', spriteKey: 'double_lamppost',
    blocksBuild: false, kind: 'decoration', mount: 'ground', subsection: 'pathLandscape',
    subW: 1, subL: 1, subH: 6,
    desc: 'Twin-headed lamppost that throws a wider pool of light down the path.',
    energyCost: 0.28,
    light: { color: '#ffab52', intensity: 1.4, radius: 8.5, shape: 'point', emitterY: 2.8 },
  },
  {
    id: 'bollardLight', name: 'Bollard Light', cost: { funding: 6 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'bollard_light',
    blocksBuild: false, kind: 'decoration', mount: 'ground', subsection: 'pathLandscape',
    subW: 1, subL: 1, subH: 2,
    desc: 'Low bollard marker for ankle-height path illumination.',
    energyCost: 0.08,
    light: { color: '#ffb877', intensity: 0.5, radius: 2.5, shape: 'point', emitterY: 0.4 },
  },
  {
    id: 'highMastLight', name: 'High Mast Light', cost: { funding: 65 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'high_mast_light',
    blocksBuild: false, kind: 'decoration', mount: 'ground', subsection: 'areaSecurity',
    subW: 3, subL: 3, subH: 16,
    desc: 'Tall parking-lot mast that floods a wide area in cool white light.',
    energyCost: 1.5,
    light: { color: '#e8f0ff', intensity: 2.2, radius: 16, shape: 'point', emitterY: 7.5 },
  },
  {
    id: 'floodLight', name: 'Flood Light', cost: { funding: 12 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'spot_light',
    blocksBuild: false, kind: 'decoration', mount: 'ground', subsection: 'areaSecurity',
    subW: 1, subL: 1, subH: 3,
    desc: 'Directional flood for facades and dramatic beamline reveals.',
    energyCost: 0.75,
    light: {
      color: '#f5f8ff', intensity: 1.8, radius: 9, shape: 'cone',
      coneDeg: 30, beamAngleDeg: 30, tiltDeg: 73, emitterY: 1.2,
      targetDistance: 4, maxGroundRange: 18, penumbra: 0.4,
    },
  },

  // === Wall ===
  {
    id: 'wallSconce', name: 'Wall Sconce', cost: { funding: 5 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'wall_sconce',
    blocksBuild: false, kind: 'decoration', mount: 'wall', subsection: 'wallLights',
    subW: 1, subL: 1, subH: 2,
    desc: 'Warm wall-mounted fixture for corridors and building facades.',
    energyCost: 0.03,
    light: { color: '#ffcb8a', intensity: 0.6, radius: 3, shape: 'point', emitterY: 2.1 },
  },
  {
    id: 'bulkheadLight', name: 'Bulkhead Light', cost: { funding: 9 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'bulkhead_light',
    blocksBuild: false, kind: 'decoration', mount: 'wall', subsection: 'wallLights',
    subW: 1, subL: 1, subH: 2,
    desc: 'Caged industrial fixture built for corridors and exterior walls.',
    energyCost: 0.12,
    light: { color: '#dce6e8', intensity: 0.9, radius: 4.5, shape: 'point', emitterY: 2.4 },
  },
  {
    id: 'wallStripLight', name: 'Wall Strip Light', cost: { funding: 12 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'wall_strip_light',
    blocksBuild: false, kind: 'decoration', mount: 'wall', subsection: 'wallLights',
    subW: 1, subL: 1, subH: 2,
    desc: 'A broad linear wall wash for corridors and service bays.',
    energyCost: 0.14,
    light: { color: '#e5f2ff', intensity: 1.05, radius: 5.5, shape: 'point', emitterY: 2.3 },
  },
  {
    id: 'emergencyWallLight', name: 'Emergency Wall Light', cost: { funding: 14 }, removeCost: 0,
    morale: 0.05, placement: 'outdoor', spriteKey: 'emergency_wall_light',
    blocksBuild: false, kind: 'decoration', mount: 'wall', subsection: 'utilityWarning',
    subW: 1, subL: 1, subH: 2,
    desc: 'Twin amber emergency lamps with a restrained status pulse.',
    energyCost: 0.08,
    light: { color: '#ff8a45', intensity: 0.75, radius: 3.5, shape: 'point', emitterY: 2.2, dayFloor: 0.35 },
  },

  // === Overhead ===
  {
    id: 'ceilingPanel', name: 'Ceiling Panel', cost: { funding: 7 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'ceiling_panel',
    blocksBuild: false, kind: 'decoration', mount: 'overhead', subsection: 'ceilingLights',
    subW: 1, subL: 1, subH: 2,
    desc: 'Cool white office panel hung from a short chain.',
    energyCost: 0.05,
    light: {
      color: '#eaf3ff', intensity: 0.8, radius: 4, shape: 'cone',
      coneDeg: 105, beamAngleDeg: 105, tiltDeg: 0, emitterY: 3.0,
      sourceOffsetY: -0.195,
    },
  },
  {
    id: 'highBay', name: 'High Bay Light', cost: { funding: 22 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'high_bay',
    blocksBuild: false, kind: 'decoration', mount: 'overhead', subsection: 'ceilingLights',
    subW: 1, subL: 1, subH: 3,
    desc: 'Industrial high-bay fixture throwing a wide cone over the experimental hall.',
    energyCost: 0.9,
    light: {
      color: '#f0f5ff', intensity: 1.6, radius: 9, shape: 'cone',
      coneDeg: 90, tiltDeg: 0, emitterY: 4.5, sourceOffsetY: -0.28,
    },
  },
  {
    id: 'linearPendant', name: 'Linear Pendant', cost: { funding: 18 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'linear_pendant',
    blocksBuild: false, kind: 'decoration', mount: 'overhead', subsection: 'ceilingLights',
    subW: 3, subL: 1, subH: 2,
    desc: 'A suspended linear luminaire for benches and equipment aisles.',
    energyCost: 0.18,
    light: {
      color: '#edf6ff', intensity: 1.15, radius: 6.5, shape: 'cone',
      coneDeg: 100, beamAngleDeg: 100, tiltDeg: 0, emitterY: 3.4,
      sourceOffsetY: -0.251,
    },
  },
  {
    id: 'cleanroomPanel', name: 'Cleanroom Panel', cost: { funding: 28 }, removeCost: 0,
    morale: 0.15, placement: 'outdoor', spriteKey: 'cleanroom_panel',
    blocksBuild: false, kind: 'decoration', mount: 'overhead', subsection: 'ceilingLights',
    subW: 2, subL: 2, subH: 2,
    desc: 'A sealed high-output panel for clean and controlled spaces.',
    energyCost: 0.22,
    light: {
      color: '#f4fbff', intensity: 1.35, radius: 7.5, shape: 'cone',
      coneDeg: 110, beamAngleDeg: 110, tiltDeg: 0, emitterY: 3.2,
      sourceOffsetY: -0.139,
    },
  },

  // === Surface — stack on desks, benches, cabinets, and worktops ===
  {
    id: 'deskLamp', name: 'Desk Lamp', cost: { funding: 6 }, removeCost: 0,
    morale: 0.2, placement: 'outdoor', spriteKey: 'desk_lamp',
    blocksBuild: false, kind: 'decoration', mount: 'surface', subsection: 'deskTask', stackable: true,
    subW: 1, subL: 1, subH: 1,
    desc: 'A warm articulated task lamp that sits on any available surface.',
    energyCost: 0.04,
    light: { color: '#ffd29a', intensity: 0.55, radius: 2.5, shape: 'point', emitterY: 0.48 },
  },
  {
    id: 'portableWorkLight', name: 'Portable Work Light', cost: { funding: 11 }, removeCost: 0,
    morale: 0.05, placement: 'outdoor', spriteKey: 'portable_work_light',
    blocksBuild: false, kind: 'decoration', mount: 'surface', subsection: 'deskTask', stackable: true,
    subW: 1, subL: 1, subH: 1,
    desc: 'A compact directional work lamp for benches, carts, and tool cabinets.',
    energyCost: 0.16,
    light: {
      color: '#fff1cf', intensity: 1.0, radius: 4.5, shape: 'cone',
      coneDeg: 42, beamAngleDeg: 42, tiltDeg: 58, emitterY: 0.42,
      targetDistance: 2.2, maxGroundRange: 7, penumbra: 0.5,
    },
  },

  // === Floor lamps — ordinary ground occupancy, indoor Structure palette ===
  {
    id: 'floorLamp', name: 'Shade Floor Lamp', cost: { funding: 9 }, removeCost: 0,
    morale: 0.35, spriteKey: 'floor_lamp', blocksBuild: false,
    kind: 'decoration', mount: 'ground', subsection: 'floorLamps',
    subW: 1, subL: 1, subH: 4,
    desc: 'A warm fabric-shade floor lamp for offices, lounges, and reception areas.',
    energyCost: 0.05,
    light: { color: '#ffd09a', intensity: 0.62, radius: 3.2, shape: 'point', emitterY: 1.65 },
  },
  {
    id: 'arcFloorLamp', name: 'Arc Floor Lamp', cost: { funding: 14 }, removeCost: 0,
    morale: 0.45, spriteKey: 'arc_floor_lamp', blocksBuild: false,
    kind: 'decoration', mount: 'ground', subsection: 'floorLamps',
    subW: 2, subL: 1, subH: 5,
    desc: 'A long-reach arc lamp that pools warm light over a seating group.',
    energyCost: 0.07,
    light: { color: '#ffd6a6', intensity: 0.72, radius: 3.8, shape: 'point', emitterY: 1.85, sourceOffsetX: 0.38 },
  },
  {
    id: 'torchiere', name: 'Torchiere', cost: { funding: 11 }, removeCost: 0,
    morale: 0.3, spriteKey: 'torchiere', blocksBuild: false,
    kind: 'decoration', mount: 'ground', subsection: 'floorLamps',
    subW: 1, subL: 1, subH: 4,
    desc: 'A compact uplighter that gives offices and corridors soft indirect light.',
    energyCost: 0.06,
    light: { color: '#ffe0b5', intensity: 0.68, radius: 3.5, shape: 'point', emitterY: 1.78 },
  },

  // === Desk and task lamps ===
  {
    id: 'bankerLamp', name: 'Banker Lamp', cost: { funding: 8 }, removeCost: 0,
    morale: 0.3, spriteKey: 'banker_lamp', blocksBuild: false,
    kind: 'decoration', mount: 'surface', subsection: 'deskTask', stackable: true,
    subW: 1, subL: 1, subH: 1,
    desc: 'A green glass reading lamp for private offices and quiet analysis desks.',
    energyCost: 0.04,
    light: { color: '#b9e89b', intensity: 0.48, radius: 2.2, shape: 'point', emitterY: 0.38 },
  },
  {
    id: 'magnifierTaskLamp', name: 'Magnifier Task Lamp', cost: { funding: 13 }, removeCost: 0,
    morale: 0.1, spriteKey: 'magnifier_task_lamp', blocksBuild: false,
    kind: 'decoration', mount: 'surface', subsection: 'deskTask', stackable: true,
    subW: 1, subL: 1, subH: 2,
    desc: 'A ring-lit magnifier for electronics, optics, and precision bench work.',
    energyCost: 0.06,
    light: { color: '#eef8ff', intensity: 0.62, radius: 2.6, shape: 'point', emitterY: 0.62 },
  },

  // === Additional ceiling fixtures ===
  {
    id: 'recessedDownlight', name: 'Recessed Downlight', cost: { funding: 5 }, removeCost: 0,
    morale: 0.05, spriteKey: 'recessed_downlight', blocksBuild: false,
    kind: 'decoration', mount: 'overhead', subsection: 'ceilingLights',
    subW: 1, subL: 1, subH: 1,
    desc: 'A compact flush downlight for corridors, reception, and small offices.',
    energyCost: 0.025,
    light: { color: '#fff1dc', intensity: 0.58, radius: 3.1, shape: 'cone', coneDeg: 95, tiltDeg: 0, emitterY: 3.0, sourceOffsetY: -0.025 },
  },
  {
    id: 'ceilingBatten', name: 'Ceiling Batten', cost: { funding: 10 }, removeCost: 0,
    morale: 0.05, spriteKey: 'ceiling_batten', blocksBuild: false,
    kind: 'decoration', mount: 'overhead', subsection: 'ceilingLights',
    subW: 3, subL: 1, subH: 1,
    desc: 'A practical surface-mounted linear light for stores, workshops, and plant rooms.',
    energyCost: 0.11,
    light: { color: '#e9f4ff', intensity: 0.92, radius: 5.4, shape: 'cone', coneDeg: 105, tiltDeg: 0, emitterY: 3.1, sourceOffsetY: -0.055 },
  },
  {
    id: 'emergencyCeilingLight', name: 'Emergency Ceiling Light', cost: { funding: 16 }, removeCost: 0,
    morale: 0.05, spriteKey: 'emergency_ceiling_light', blocksBuild: false,
    kind: 'decoration', mount: 'overhead', subsection: 'utilityWarning',
    subW: 1, subL: 1, subH: 1,
    desc: 'A battery-backed twin-head emergency fitting with an amber status pulse.',
    energyCost: 0.06,
    light: { color: '#ff9b55', intensity: 0.72, radius: 3.4, shape: 'cone', coneDeg: 92, tiltDeg: 0, emitterY: 3.0, sourceOffsetY: -0.08, dayFloor: 0.35 },
  },

  // === Additional wall and utility/warning lights ===
  {
    id: 'pictureLight', name: 'Picture Light', cost: { funding: 8 }, removeCost: 0,
    morale: 0.3, spriteKey: 'picture_light', blocksBuild: false,
    kind: 'decoration', mount: 'wall', subsection: 'wallLights',
    subW: 1, subL: 1, subH: 1,
    desc: 'A slim warm wall washer for signs, artwork, and reception displays.',
    energyCost: 0.035,
    light: { color: '#ffd2a0', intensity: 0.48, radius: 2.8, shape: 'point', emitterY: 2.05 },
  },
  {
    id: 'klaxonStrobe', name: 'Klaxon Strobe', cost: { funding: 18 }, removeCost: 0,
    morale: 0, spriteKey: 'klaxon_strobe', blocksBuild: false,
    kind: 'decoration', mount: 'wall', subsection: 'utilityWarning',
    subW: 1, subL: 1, subH: 1,
    desc: 'A wall-mounted industrial klaxon with a high-visibility red warning strobe.',
    energyCost: 0.08,
    light: { color: '#ff3f2f', intensity: 0.82, radius: 3.2, shape: 'point', emitterY: 2.35, dayFloor: 0.65 },
  },
  {
    id: 'rotatingBeacon', name: 'Rotating Beacon', cost: { funding: 12 }, removeCost: 0,
    morale: 0, spriteKey: 'rotating_beacon', blocksBuild: false,
    kind: 'decoration', mount: 'surface', subsection: 'utilityWarning', stackable: true,
    subW: 1, subL: 1, subH: 1,
    desc: 'An amber rotating beacon for cabinets, doors, and active work areas.',
    energyCost: 0.045,
    light: { color: '#ff9f2d', intensity: 0.66, radius: 2.6, shape: 'point', emitterY: 0.28, dayFloor: 0.7 },
  },
  {
    id: 'signalTower', name: 'Signal Tower', cost: { funding: 15 }, removeCost: 0,
    morale: 0, spriteKey: 'signal_tower', blocksBuild: false,
    kind: 'decoration', mount: 'surface', subsection: 'utilityWarning', stackable: true,
    subW: 1, subL: 1, subH: 1,
    desc: 'A three-colour machine status tower for control desks and equipment cabinets.',
    energyCost: 0.035,
    light: { color: '#55ff78', intensity: 0.48, radius: 2.1, shape: 'point', emitterY: 0.4, dayFloor: 0.65 },
  },
  {
    id: 'exitLight', name: 'Exit Light', cost: { funding: 10 }, removeCost: 0,
    morale: 0.05, spriteKey: 'exit_light', blocksBuild: false,
    kind: 'decoration', mount: 'wall', subsection: 'utilityWarning',
    subW: 2, subL: 1, subH: 1,
    desc: 'An illuminated green exit marker for corridors and assembly routes.',
    energyCost: 0.02,
    light: { color: '#70f09a', intensity: 0.36, radius: 1.8, shape: 'point', emitterY: 2.25, dayFloor: 0.45 },
  },
];

export const LIGHTING_DEFS = RAW_LIGHTING_DEFS.map((def) => {
  const profile = LIGHT_PROFILES[def.id];
  return {
    ...def,
    category: categoryForFixture(def),
    light: {
      ...def.light,
      poolRadius: def.light.poolRadius ?? def.light.radius,
      penumbra: def.light.penumbra ?? profile.shadowSoftness,
      ...profile,
    },
  };
});

export function validateLightingDef(def) {
  const errors = [];
  if (!def || !['ground', 'wall', 'overhead', 'surface'].includes(def.mount)) errors.push('invalid mount');
  const light = def?.light;
  if (!light) return [...errors, 'missing light'];
  for (const field of ['intensity', 'poolRadius', 'emitterY', 'sourceRadius', 'shadowSoftness']) {
    if (!Number.isFinite(light[field]) || light[field] < 0) errors.push(`invalid ${field}`);
  }
  if (light.dayFloor != null
      && (!Number.isFinite(light.dayFloor) || light.dayFloor < 0 || light.dayFloor > 1)) {
    errors.push('invalid dayFloor');
  }
  if (light.shape === 'cone') {
    const angle = light.beamAngleDeg ?? light.coneDeg;
    if (!Number.isFinite(angle) || angle <= 0 || angle >= 180) errors.push('invalid beam angle');
    if (!Number.isFinite(light.tiltDeg) || light.tiltDeg < 0 || light.tiltDeg >= 90) errors.push('invalid tilt');
  }
  return errors;
}
