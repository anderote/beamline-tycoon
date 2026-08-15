function hashPhase(value) {
  const text = String(value ?? 'fixture');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff * Math.PI * 2;
}

/** Deterministic, subtle fixture modulation. Never touches simulation state. */
export function fixtureDynamicFactor(profile, id, timeMs, darkness = 1) {
  const t = Math.max(0, Number(timeMs) || 0) / 1000;
  const d = Math.max(0, Math.min(1, Number(darkness) || 0));
  const phase = hashPhase(id);
  const mains = Math.sin(t * Math.PI * 4 + phase);
  switch (profile) {
    case 'fluorescent': {
      const duskFlutter = Math.max(0, 1 - d * 4);
      const flutter = Math.sin(t * 31 + phase * 3) * Math.sin(t * 11 + phase);
      return Math.max(0.78, 0.975 + mains * 0.012 - duskFlutter * Math.max(0, flutter) * 0.12);
    }
    case 'arcStable':
      return 0.992 + mains * 0.008;
    case 'warmSteady':
      return (0.94 + d * 0.06) * (0.992 + mains * 0.008);
    default:
      return 1;
  }
}

