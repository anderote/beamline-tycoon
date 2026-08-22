// Pure presentation policy for electrical spark emitters. Physics and utility
// solvers publish the mutation; this module only chooses a readable amount of
// colour-only particle feedback for the renderer.

export function utilityConnectionSparkProfile(line) {
  if (!line?.start || !line?.end || line.buried === true) return null;
  if (line.utilityType === 'hvCable') {
    return {
      count: 30,
      colors: [0xf6fbff, 0x9fd7ff, 0xffd35a, 0xff742a],
      speedMin: 3.4,
      speedMax: 9.2,
      lifetimeMin: 0.45,
      lifetimeMax: 1.25,
      size: 0.06,
      restitution: 0.62,
    };
  }
  if (line.utilityType === 'powerCable') {
    return {
      count: 8,
      colors: [0xffffff, 0xffd66b, 0xff922e],
      speedMin: 1.8,
      speedMax: 4.6,
      lifetimeMin: 0.24,
      lifetimeMax: 0.72,
      size: 0.043,
      restitution: 0.62,
    };
  }
  return null;
}

export function equipmentPowerUpSparkProfile(count = 10) {
  return {
    count: Math.max(1, Math.floor(Number(count) || 10)),
    colors: [0xffffff, 0x9fdcff, 0xffd26a],
    speedMin: 1.2,
    speedMax: 4.2,
    lifetimeMin: 0.22,
    lifetimeMax: 0.68,
    size: 0.04,
    restitution: 0.5,
  };
}

