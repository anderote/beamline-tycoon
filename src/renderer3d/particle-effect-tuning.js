// Session-local presentation tuning for glowing pixel effects.
//
// These values never enter Game state or saves. The effects workshop may
// replace them at runtime, while gameplay producers and BeamBuilder read the
// same normalized profiles so a preview matches the real presentation.

const PROFILE_DEFS = {
  hvConnection: {
    label: 'HV Connection',
    description: 'A dense, energetic shower from a live high-voltage connector.',
    fields: {
      count:       { label: 'Particles', min: 8, max: 160, step: 1, value: 56 },
      size:        { label: 'Pixel size', min: 0.014, max: 0.09, step: 0.002, value: 0.034 },
      speed:       { label: 'Launch speed', min: 0.4, max: 8, step: 0.1, value: 3.4 },
      lifetime:    { label: 'Lifetime', min: 0.3, max: 4, step: 0.1, value: 2.1 },
      gravity:     { label: 'Gravity', min: 0, max: 18, step: 0.5, value: 9.5 },
      bounce:      { label: 'Bounce', min: 0, max: 0.95, step: 0.05, value: 0.62 },
      spread:      { label: 'Spread', min: 0.05, max: 2, step: 0.05, value: 0.95 },
    },
  },
  powerConnection: {
    label: 'Power Connection',
    description: 'A smaller shower from an ordinary live power cord.',
    fields: {
      count:       { label: 'Particles', min: 3, max: 80, step: 1, value: 20 },
      size:        { label: 'Pixel size', min: 0.014, max: 0.07, step: 0.002, value: 0.026 },
      speed:       { label: 'Launch speed', min: 0.25, max: 5, step: 0.05, value: 1.8 },
      lifetime:    { label: 'Lifetime', min: 0.2, max: 3, step: 0.1, value: 1.25 },
      gravity:     { label: 'Gravity', min: 0, max: 18, step: 0.5, value: 9.5 },
      bounce:      { label: 'Bounce', min: 0, max: 0.95, step: 0.05, value: 0.58 },
      spread:      { label: 'Spread', min: 0.05, max: 2, step: 0.05, value: 0.72 },
    },
  },
  explosion: {
    label: 'Explosion',
    description: 'A presentation-only fireball with hot falling debris pixels.',
    fields: {
      count:       { label: 'Particles', min: 12, max: 220, step: 1, value: 110 },
      size:        { label: 'Pixel size', min: 0.018, max: 0.14, step: 0.002, value: 0.05 },
      speed:       { label: 'Blast speed', min: 0.5, max: 12, step: 0.1, value: 5.2 },
      lifetime:    { label: 'Lifetime', min: 0.3, max: 5, step: 0.1, value: 2.5 },
      gravity:     { label: 'Gravity', min: 0, max: 18, step: 0.5, value: 8 },
      bounce:      { label: 'Bounce', min: 0, max: 0.95, step: 0.05, value: 0.5 },
      spread:      { label: 'Spread', min: 0.1, max: 2.5, step: 0.05, value: 1.45 },
    },
  },
  beamline: {
    label: 'Particle Beam',
    description: 'Looping live-beam pixels; real beam speed still follows published beta.',
    fields: {
      density:     { label: 'Pixel density', min: 0.25, max: 3, step: 0.05, value: 1 },
      size:        { label: 'Pixel size', min: 0.012, max: 0.09, step: 0.002, value: 0.036 },
      speed:       { label: 'Speed scale', min: 0.1, max: 2.5, step: 0.05, value: 1 },
      coreOpacity: { label: 'Core glow', min: 0, max: 1, step: 0.05, value: 0.64 },
      pixelOpacity:{ label: 'Pixel glow', min: 0.1, max: 1, step: 0.05, value: 0.78 },
      bunchSize:   { label: 'Bunch pixels', min: 1, max: 10, step: 1, value: 4 },
      slosh:       { label: 'Liquid slosh', min: 0, max: 1.5, step: 0.05, value: 0.65 },
    },
  },
  targetRadiation: {
    label: 'Target Radiation',
    description: 'Secondary-particle showers where a live beam is absorbed by a target or stop.',
    fields: {
      density:     { label: 'Shower density', min: 0.25, max: 3, step: 0.05, value: 1 },
      size:        { label: 'Particle size', min: 0.012, max: 0.09, step: 0.002, value: 0.03 },
      speed:       { label: 'Shower speed', min: 0.2, max: 3, step: 0.05, value: 1 },
      lifetime:    { label: 'Range', min: 0.2, max: 2.5, step: 0.05, value: 0.9 },
      spread:      { label: 'Angular spread', min: 0.1, max: 2, step: 0.05, value: 1.15 },
      brightness:  { label: 'Brightness', min: 0.1, max: 1, step: 0.05, value: 0.88 },
    },
  },
  synchrotronRadiation: {
    label: 'Synchrotron Radiation',
    description: 'Narrow photon streaks emitted tangentially by a live beam in bending magnets.',
    fields: {
      density:     { label: 'Streak density', min: 0.25, max: 3, step: 0.05, value: 1 },
      size:        { label: 'Streak width', min: 0.008, max: 0.07, step: 0.002, value: 0.022 },
      speed:       { label: 'Streak speed', min: 0.2, max: 3, step: 0.05, value: 1.2 },
      lifetime:    { label: 'Streak range', min: 0.15, max: 2, step: 0.05, value: 0.7 },
      streakLength:{ label: 'Streak length', min: 0.08, max: 1.2, step: 0.02, value: 0.38 },
      spread:      { label: 'Cone spread', min: 0, max: 0.6, step: 0.02, value: 0.08 },
      brightness:  { label: 'Brightness', min: 0.1, max: 1, step: 0.05, value: 0.92 },
    },
  },
  sourceFlow: {
    label: 'Source Interior',
    description: 'Cyclotron spiral orbits and ECR plasma vortices feeding the extracted beam.',
    fields: {
      density:     { label: 'Particle density', min: 0.25, max: 3, step: 0.05, value: 1 },
      size:        { label: 'Particle size', min: 0.012, max: 0.09, step: 0.002, value: 0.032 },
      speed:       { label: 'Circulation speed', min: 0.15, max: 3, step: 0.05, value: 1 },
      slosh:       { label: 'Plasma slosh', min: 0, max: 1.5, step: 0.05, value: 0.8 },
      brightness:  { label: 'Brightness', min: 0.1, max: 1, step: 0.05, value: 0.9 },
    },
  },
};

const currentProfiles = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultsFor(id) {
  const def = PROFILE_DEFS[id];
  if (!def) return null;
  return Object.fromEntries(Object.entries(def.fields).map(([key, field]) => [key, field.value]));
}

export function particleEffectDefinitions() {
  return Object.fromEntries(Object.entries(PROFILE_DEFS).map(([id, def]) => [id, {
    id,
    label: def.label,
    description: def.description,
    fields: Object.fromEntries(Object.entries(def.fields).map(([key, field]) => [key, { ...field }])),
  }]));
}

export function particleEffectProfile(id) {
  if (!PROFILE_DEFS[id]) return null;
  return { ...(currentProfiles.get(id) || defaultsFor(id)) };
}

export function setParticleEffectProfile(id, values = {}) {
  const def = PROFILE_DEFS[id];
  if (!def) return null;
  const next = particleEffectProfile(id);
  for (const [key, field] of Object.entries(def.fields)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const numeric = Number(values[key]);
    if (!Number.isFinite(numeric)) continue;
    const clamped = clamp(numeric, field.min, field.max);
    next[key] = field.step >= 1 ? Math.round(clamped) : clamped;
  }
  currentProfiles.set(id, next);
  return { ...next };
}

export function resetParticleEffectProfile(id) {
  if (!PROFILE_DEFS[id]) return null;
  currentProfiles.delete(id);
  return particleEffectProfile(id);
}

function burstProfile(id, colors, overrides = {}) {
  const p = particleEffectProfile(id);
  if (!p) return null;
  return {
    count: p.count,
    colors,
    speedMin: p.speed * 0.42,
    speedMax: p.speed * 1.12,
    lifetimeMin: p.lifetime * 0.62,
    lifetimeMax: p.lifetime * 1.18,
    size: p.size,
    gravity: p.gravity,
    restitution: p.bounce,
    drag: 0.55,
    friction: 0.16,
    spread: p.spread,
    ...overrides,
  };
}

export function electricalSparkProfile(id) {
  if (id === 'hvConnection') {
    return burstProfile(id, [0xf6fbff, 0x9fd7ff, 0xffd35a, 0xff742a]);
  }
  if (id === 'powerConnection') {
    return burstProfile(id, [0xffffff, 0xffd66b, 0xff922e]);
  }
  return null;
}

export function equipmentSparkProfile(count = 18) {
  const power = electricalSparkProfile('powerConnection');
  return {
    ...power,
    count: Math.max(1, Math.floor(Number(count) || 18)),
    colors: [0xffffff, 0x9fdcff, 0xffd26a],
    speedMin: power.speedMin * 0.72,
    speedMax: power.speedMax * 0.86,
    lifetimeMin: power.lifetimeMin * 0.88,
    lifetimeMax: power.lifetimeMax,
    restitution: Math.min(power.restitution, 0.54),
  };
}

export function previewParticleDescriptors(id, position) {
  if (!position || !PROFILE_DEFS[id]) return [];
  if (id === 'hvConnection' || id === 'powerConnection') {
    return [{
      kind: 'particleBurst', position, normal: { x: 0, y: 1, z: 0 },
      ...electricalSparkProfile(id), physicalLight: false,
    }];
  }
  if (id === 'explosion') {
    const particles = burstProfile(
      id,
      [0xffffff, 0xffe07a, 0xff8a2a, 0xff3b16, 0x8f2415],
      { upwardBias: 0.62 },
    );
    return [
      {
        kind: 'burst', position, color: 0xfff4c2, physicalLight: false,
        durationMs: Math.round(particles.lifetimeMax * 260), radius: particles.size * 8,
        groundRadius: particles.size * 22,
      },
      { kind: 'particleBurst', position, normal: { x: 0, y: 1, z: 0 }, ...particles },
    ];
  }
  if (id === 'targetRadiation') {
    const p = particleEffectProfile(id);
    return [{
      kind: 'particleBurst', position, normal: { x: 1, y: 0.15, z: 0 },
      count: Math.round(28 * p.density),
      colors: [0xffffff, 0xffe36a, 0x72ecff, 0xb37aff],
      speedMin: 1.5 * p.speed,
      speedMax: 3.8 * p.speed,
      lifetimeMin: p.lifetime * 0.55,
      lifetimeMax: p.lifetime,
      size: p.size,
      gravity: 0,
      drag: 0.08,
      restitution: 0,
      friction: 0,
      spread: p.spread,
      upwardBias: 0.15,
      physicalLight: false,
    }];
  }
  if (id === 'synchrotronRadiation') {
    const p = particleEffectProfile(id);
    return [{
      kind: 'particleBurst', position, normal: { x: 1, y: 0, z: 0 },
      count: Math.round(18 * p.density),
      colors: [0xffffff, 0x7deaff, 0x9a8cff],
      speedMin: 3.2 * p.speed,
      speedMax: 5.4 * p.speed,
      lifetimeMin: p.lifetime * 0.65,
      lifetimeMax: p.lifetime,
      size: p.size,
      gravity: 0,
      drag: 0,
      restitution: 0,
      friction: 0,
      spread: p.spread,
      upwardBias: 0,
      physicalLight: false,
    }];
  }
  if (id === 'sourceFlow') {
    const p = particleEffectProfile(id);
    return [{
      kind: 'particleBurst', position, normal: { x: 1, y: 0.1, z: 0 },
      count: Math.round(28 * p.density),
      colors: [0xffffff, 0xb35cff, 0x5ce8ff],
      speedMin: 1.2 * p.speed,
      speedMax: 2.8 * p.speed,
      lifetimeMin: 0.8,
      lifetimeMax: 1.4,
      size: p.size,
      gravity: 0,
      drag: 0.04,
      restitution: 0,
      friction: 0,
      spread: 0.55 * p.slosh,
      upwardBias: 0.1,
      physicalLight: false,
    }];
  }
  const beam = particleEffectProfile('beamline');
  return [{
    kind: 'particleBurst', position, normal: { x: 1, y: 0, z: 0 },
    count: Math.round(34 * beam.density),
    colors: [0xffffff, 0x83ffff, 0x36e8ff],
    speedMin: 2.4 * beam.speed,
    speedMax: 4.2 * beam.speed,
    lifetimeMin: 0.9,
    lifetimeMax: 1.5,
    size: beam.size,
    gravity: 0,
    drag: 0.08,
    restitution: 0.15,
    friction: 0.05,
    spread: 0.08,
    upwardBias: 0,
    physicalLight: false,
  }];
}
