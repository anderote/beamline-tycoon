// src/data/placeables/lighting.js
//
// Facility lighting fixtures. Unlike the other per-kind def files, these
// are authored directly here rather than derived from a *.raw.js registry —
// there is no separate "lighting.raw.js"; this file IS the source of truth.
//
// Fixtures stay kind: 'decoration' (see design doc §5) — lighting is not a
// new Placeable kind. `category` is derived below from `mount`, not
// authored per-fixture: ground-mounted fixtures are landscaping (Grounds ->
// Lighting), while wall- and overhead-mounted fixtures are building fabric
// (Structure -> Lights, alongside Flooring/Walls/Doors). Two extra fields
// discriminate behavior for later tasks:
//   - mount: 'ground' | 'wall' | 'overhead' — placement path + render height.
//   - light: { color, intensity, radius, shape, coneDeg?, tiltDeg?, emitterY }
//     — read uniformly by the renderer regardless of mount. `radius` is the
//     light pool radius in world units (meters); `emitterY` is the emitter's
//     height above its mount point (also meters); `coneDeg`/`tiltDeg` are
//     required when shape === 'cone'.
//
// `lamppost` and `bollardLight` are reworked from decorations.raw.js with
// their cost/morale/footprint carried over unchanged. `floodLight` replaces
// `spotLight`, inheriting its cost/morale/footprint too. The old geometry
// builders for all three stay keyed to the old ids in decoration-builder.js
// until Task 5 rebuilds fixture geometry — floodLight renders as nothing
// until then, which is expected.
//
// energyCost is in kW, calibrated against a powerPanel's 40 kW capacity:
// sconces and ceiling panels are near-free (tens of watts), lampposts and
// bollards are small (hundreds of watts), and high masts/floods/high bays
// carry the real cost (roughly half a kW to 1.5 kW) — see task-3-report.md
// for the full reasoning.

// mount -> palette category. Ground-mounted fixtures are landscaping
// (Grounds mode's `lighting` tab); wall- and overhead-mounted fixtures are
// building fabric (Structure mode's `structureLights` tab, see modes.js).
// Keyed off `mount`, not per-fixture id, so new fixtures fall into the
// right tab automatically as long as they declare a mount.
const CATEGORY_BY_MOUNT = {
  ground: 'lighting',
  wall: 'structureLights',
  overhead: 'structureLights',
};

const RAW_LIGHTING_DEFS = [
  // === Ground — lamp family ===
  {
    id: 'lamppost', name: 'Lamppost', cost: { funding: 8 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'lamppost',
    blocksBuild: false, kind: 'decoration', mount: 'ground',
    subW: 1, subL: 1, subH: 6,
    desc: 'Classic path lighting for safe walks home after night shift.',
    energyCost: 0.15,
    light: { color: '#ffa64d', intensity: 1.0, radius: 6, shape: 'point', emitterY: 2.7 },
  },
  {
    id: 'doubleLamppost', name: 'Double Lamppost', cost: { funding: 16 }, removeCost: 0,
    morale: 0.75, placement: 'outdoor', spriteKey: 'double_lamppost',
    blocksBuild: false, kind: 'decoration', mount: 'ground',
    subW: 1, subL: 1, subH: 6,
    desc: 'Twin-headed lamppost that throws a wider pool of light down the path.',
    energyCost: 0.28,
    light: { color: '#ffab52', intensity: 1.4, radius: 8.5, shape: 'point', emitterY: 2.8 },
  },
  {
    id: 'bollardLight', name: 'Bollard Light', cost: { funding: 6 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'bollard_light',
    blocksBuild: false, kind: 'decoration', mount: 'ground',
    subW: 1, subL: 1, subH: 2,
    desc: 'Low bollard marker for ankle-height path illumination.',
    energyCost: 0.08,
    light: { color: '#ffb877', intensity: 0.5, radius: 2.5, shape: 'point', emitterY: 0.4 },
  },
  {
    id: 'highMastLight', name: 'High Mast Light', cost: { funding: 65 }, removeCost: 0,
    morale: 0.25, placement: 'outdoor', spriteKey: 'high_mast_light',
    blocksBuild: false, kind: 'decoration', mount: 'ground',
    subW: 3, subL: 3, subH: 16,
    desc: 'Tall parking-lot mast that floods a wide area in cool white light.',
    energyCost: 1.5,
    light: { color: '#e8f0ff', intensity: 2.2, radius: 16, shape: 'point', emitterY: 7.5 },
  },
  {
    id: 'floodLight', name: 'Flood Light', cost: { funding: 12 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'spot_light',
    blocksBuild: false, kind: 'decoration', mount: 'ground',
    subW: 1, subL: 1, subH: 1,
    desc: 'Directional flood for facades and dramatic beamline reveals.',
    energyCost: 0.75,
    light: {
      color: '#f5f8ff', intensity: 1.8, radius: 9, shape: 'cone',
      coneDeg: 45, tiltDeg: 35, emitterY: 0.4,
    },
  },

  // === Wall ===
  {
    id: 'wallSconce', name: 'Wall Sconce', cost: { funding: 5 }, removeCost: 0,
    morale: 0.5, placement: 'outdoor', spriteKey: 'wall_sconce',
    blocksBuild: false, kind: 'decoration', mount: 'wall',
    subW: 1, subL: 1, subH: 2,
    desc: 'Warm wall-mounted fixture for corridors and building facades.',
    energyCost: 0.03,
    light: { color: '#ffcb8a', intensity: 0.6, radius: 3, shape: 'point', emitterY: 2.1 },
  },
  {
    id: 'bulkheadLight', name: 'Bulkhead Light', cost: { funding: 9 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'bulkhead_light',
    blocksBuild: false, kind: 'decoration', mount: 'wall',
    subW: 1, subL: 1, subH: 2,
    desc: 'Caged industrial fixture built for corridors and exterior walls.',
    energyCost: 0.12,
    light: { color: '#dce6e8', intensity: 0.9, radius: 4.5, shape: 'point', emitterY: 2.4 },
  },

  // === Overhead ===
  {
    id: 'ceilingPanel', name: 'Ceiling Panel', cost: { funding: 7 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'ceiling_panel',
    blocksBuild: false, kind: 'decoration', mount: 'overhead',
    subW: 1, subL: 1, subH: 2,
    desc: 'Cool white office panel hung from a short chain.',
    energyCost: 0.05,
    light: { color: '#eaf3ff', intensity: 0.8, radius: 4, shape: 'point', emitterY: 1.5 },
  },
  {
    id: 'highBay', name: 'High Bay Light', cost: { funding: 22 }, removeCost: 0,
    morale: 0.1, placement: 'outdoor', spriteKey: 'high_bay',
    blocksBuild: false, kind: 'decoration', mount: 'overhead',
    subW: 1, subL: 1, subH: 3,
    desc: 'Industrial high-bay fixture throwing a wide cone over the experimental hall.',
    energyCost: 0.9,
    light: {
      color: '#f0f5ff', intensity: 1.6, radius: 9, shape: 'cone',
      coneDeg: 90, tiltDeg: 0, emitterY: 1.5,
    },
  },
];

export const LIGHTING_DEFS = RAW_LIGHTING_DEFS.map((def) => ({
  ...def,
  category: CATEGORY_BY_MOUNT[def.mount],
}));
