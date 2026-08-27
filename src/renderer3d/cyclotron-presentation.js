// Shared, THREE-free geometry contract for cyclotron models and their live
// particle presentation. Local +Z is the beam-exit direction. BeamBuilder's
// `side` basis points toward local -X, so authored +X coordinates are negated
// when represented here.

export const CYCLOTRON_VISUAL_PROFILES = Object.freeze({
  cyclotron30: Object.freeze({
    footprint: 4.0, bodyR: 1.28, bodyH: 0.72, coilR: 1.03, serviceCount: 2,
  }),
  cyclotron70: Object.freeze({
    footprint: 5.0, bodyR: 1.65, bodyH: 0.90, coilR: 1.34, serviceCount: 3,
  }),
  cyclotron230: Object.freeze({
    footprint: 6.0, bodyR: 2.05, bodyH: 1.00, coilR: 1.68, serviceCount: 4,
    shieldRing: true,
  }),
});

export function cyclotronVisualProfile(type) {
  return CYCLOTRON_VISUAL_PROFILES[type] || null;
}

/** The exact local path authored by source-machine-builder's extraction pipe. */
export function cyclotronExtractionContract(type, fallbackSize = 2) {
  const profile = cyclotronVisualProfile(type);
  const sourceLength = profile?.footprint || Math.max(0.5, fallbackSize);
  const bodyR = profile?.bodyR || sourceLength * 0.33;
  const halfLength = sourceLength / 2;
  const channelJoinForward = Math.min(bodyR * 0.72, halfLength - 0.35);
  return {
    sourceLength,
    orbitExitSide: -bodyR * 0.25,
    orbitExitForward: channelJoinForward - 0.30,
    channelJoinForward,
    exitForward: halfLength,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Resolve one particle onto the continuous spiral -> extraction channel ->
 * straight beam-pipe path in BeamBuilder's local side/forward basis.
 */
export function cyclotronParticlePathPoint(effect, {
  progress,
  orbitEnd,
  turns,
  orbitScale = 1,
  angularWobble = 0,
} = {}, target = {}) {
  const safeOrbitEnd = Math.max(0.001, Math.min(0.999, orbitEnd ?? 0.78));
  const safeProgress = Math.max(0, Math.min(1, progress ?? 0));
  const fallbackRadius = Math.max(0, effect.radius ?? 0);
  const authoredSide = effect.orbitExitSide ?? -fallbackRadius * 0.25;
  const authoredForward = effect.orbitExitForward
    ?? Math.sqrt(Math.max(0, fallbackRadius ** 2 - authoredSide ** 2));
  const targetSide = authoredSide * orbitScale;
  const targetForward = authoredForward * orbitScale;
  const targetRadius = Math.hypot(targetSide, targetForward);
  const finalAngle = Math.atan2(targetForward, targetSide);

  if (safeProgress <= safeOrbitEnd) {
    const orbitQ = Math.min(1, safeProgress / safeOrbitEnd);
    const angle = finalAngle - (1 - orbitQ) * Math.PI * 2 * (turns ?? 4)
      + angularWobble * (1 - orbitQ);
    const radius = targetRadius * orbitQ;
    target.side = Math.cos(angle) * radius;
    target.forward = Math.sin(angle) * radius;
    target.angle = angle;
    target.orbitQ = orbitQ;
    target.extracting = false;
    target.verticalWobbleScale = 1 - orbitQ;
    return target;
  }

  const extractionQ = (safeProgress - safeOrbitEnd) / (1 - safeOrbitEnd);
  const joinSide = 0;
  const joinForward = effect.channelJoinForward ?? authoredForward + 0.30;
  const exitSide = 0;
  const exitForward = effect.exitForward ?? effect.sourceLength * 0.5;
  const leadLength = Math.hypot(joinSide - targetSide, joinForward - targetForward);
  const pipeLength = Math.hypot(exitSide - joinSide, exitForward - joinForward);
  const totalLength = Math.max(1e-6, leadLength + pipeLength);
  const travelled = extractionQ * totalLength;

  if (travelled <= leadLength && leadLength > 1e-6) {
    const t = travelled / leadLength;
    target.side = lerp(targetSide, joinSide, t);
    target.forward = lerp(targetForward, joinForward, t);
    target.angle = finalAngle;
    target.orbitQ = 1;
    target.extracting = true;
    target.verticalWobbleScale = 0;
    return target;
  }
  const t = pipeLength > 1e-6 ? (travelled - leadLength) / pipeLength : 1;
  const clampedT = Math.max(0, Math.min(1, t));
  target.side = lerp(joinSide, exitSide, clampedT);
  target.forward = lerp(joinForward, exitForward, clampedT);
  target.angle = finalAngle;
  target.orbitQ = 1;
  target.extracting = true;
  target.verticalWobbleScale = 0;
  return target;
}
