// src/renderer3d/beam-visual-mode.js
//
// A deliberately small rendering policy. Simulation may operate at RF and
// optical frequencies, but the world view needs a legible representation at
// human time scales: a steady core for continuous delivery, travelling packets
// when the machine has pulse structure or deliberately bunches the beam.

const BUNCHING_COMPONENTS = new Set([
  'buncher', 'rfq', 'bunchCompressor', 'rfAccelerationModule',
  'sbandStructure', 'cbandStructure', 'xbandStructure',
]);

const ELECTRON_MASS_GEV = 0.511e-3;
const PROTON_MASS_GEV = 0.938;
const DEFAULT_VISUAL_BETA = 0.66;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Map a published beam current to a readable, non-zero visual brightness.
 * The floor is intentional: a weak but surviving beam should remain visible
 * without pretending that it has the same intensity as the design maximum.
 */
export function beamVisualIntensity(current, maximum, floor = 0.12) {
  const value = Math.max(0, Number(current) || 0);
  const ceiling = Math.max(value, Number(maximum) || 0);
  if (!(ceiling > 0)) return clamp01(floor);

  // Use a reference below the maximum so low-current sections still separate
  // visibly while the upper end remains stable as the design changes.
  const reference = Math.max(1e-6, ceiling * 0.05);
  const fraction = Math.log1p(value / reference) / Math.log1p(ceiling / reference);
  return clamp01(floor + (1 - floor) * fraction);
}

/** Interpolate a physics envelope datum at normalized beamline distance. */
export function sampleBeamEnvelope(envelope, u) {
  // Physics publishes the envelope in increasing s order. Avoid copying and
  // sorting for every canvas column; this helper is called once per rendered
  // pixel by the designer animation.
  const samples = Array.isArray(envelope) ? envelope : [];
  if (!samples.length) return null;
  if (samples.length === 1) return { ...samples[0] };

  const maxS = samples[samples.length - 1].s;
  const target = clamp01(Number.isFinite(u) ? u : 0) * Math.max(maxS, 0);
  if (target <= samples[0].s) return { ...samples[0] };
  if (target >= maxS) return { ...samples[samples.length - 1] };

  let hi = 1;
  while (hi < samples.length && samples[hi].s < target) hi++;
  const a = samples[hi - 1], b = samples[hi];
  const t = (target - a.s) / Math.max(1e-9, b.s - a.s);
  const out = { ...a };
  for (const key of ['current', 'peak_current', 'bunch_frequency', 'bunch_length']) {
    if (Number.isFinite(a[key]) && Number.isFinite(b[key])) {
      out[key] = a[key] + (b[key] - a[key]) * t;
    }
  }
  return out;
}

function particleMassGeV(beamlineType) {
  return String(beamlineType?.particle || '').startsWith('p')
    ? PROTON_MASS_GEV
    : ELECTRON_MASS_GEV;
}

/** Relativistic velocity beta from kinetic energy, for old envelopes. */
export function relativisticBeta(kineticEnergyGeV, massGeV) {
  const kinetic = Number(kineticEnergyGeV);
  const mass = Number(massGeV);
  if (!Number.isFinite(kinetic) || kinetic < 0 || !Number.isFinite(mass) || mass <= 0) {
    return null;
  }
  const gamma = 1 + kinetic / mass;
  if (gamma <= 1) return 0;
  return Math.sqrt(Math.max(0, 1 - 1 / (gamma * gamma)));
}

/**
 * Compress physical beta into a readable world-space animation speed.
 * The offset keeps an injector visibly alive; sqrt preserves a clear increase
 * through a proton linac without making an electron beam unreadably fast.
 */
export function beamVisualSpeed(relBeta) {
  const beta = Number.isFinite(relBeta) ? clamp01(relBeta) : DEFAULT_VISUAL_BETA;
  return 0.8 + 3.2 * Math.sqrt(beta);
}

/** Returns 'continuous' or 'bunched' for a running beamline visual. */
export function beamVisualMode(beamlineType, elements = []) {
  // Low duty beamlines are visibly delivered as a pulse train. A CW machine
  // becomes visibly bunched once its lattice intentionally captures/compresses
  // the beam; an electrostatic/DC transport otherwise stays a steady core.
  if (Number.isFinite(beamlineType?.dutyFactor) && beamlineType.dutyFactor < 0.75) {
    return 'bunched';
  }
  return elements.some(el => BUNCHING_COMPONENTS.has(el?.type))
    ? 'bunched'
    : 'continuous';
}

/**
 * Build a renderer-only profile over normalized beamline distance.
 * `bunch` is an indicative mix (0 continuous, 1 packets), never literal RF
 * spacing. Physics owns rel_beta/bunch_frequency; this module only maps the
 * already-published values into human-readable presentation.
 */
export function beamVisualProfile(beamlineType, elements = [], envelope = []) {
  const fallbackMode = beamVisualMode(beamlineType, elements);
  const fallbackBunch = fallbackMode === 'bunched' ? 1 : 0;
  const fallback = () => ([
    { u: 0, beta: DEFAULT_VISUAL_BETA, speed: beamVisualSpeed(), bunch: fallbackBunch },
    { u: 1, beta: DEFAULT_VISUAL_BETA, speed: beamVisualSpeed(), bunch: fallbackBunch },
  ]);

  const samples = (Array.isArray(envelope) ? envelope : [])
    .filter(sample => Number.isFinite(sample?.s) && sample.s >= 0)
    .slice()
    .sort((a, b) => a.s - b.s);
  if (samples.length < 2) return fallback();

  const maxS = samples[samples.length - 1].s;
  if (!(maxS > 0)) return fallback();

  const forcedPackets = Number.isFinite(beamlineType?.dutyFactor)
    && beamlineType.dutyFactor < 0.75;
  const hasPublishedBunching = samples.some(sample =>
    Object.prototype.hasOwnProperty.call(sample, 'bunch_frequency'));
  const massGeV = particleMassGeV(beamlineType);

  const profile = [];
  for (const sample of samples) {
    const derivedBeta = relativisticBeta(sample.energy, massGeV);
    const beta = Number.isFinite(sample.rel_beta)
      ? clamp01(sample.rel_beta)
      : (derivedBeta ?? DEFAULT_VISUAL_BETA);
    const bunch = forcedPackets
      ? 1
      : (hasPublishedBunching
        ? (Number(sample.bunch_frequency) > 0 ? 1 : 0)
        : fallbackBunch);
    const next = {
      u: clamp01(sample.s / maxS),
      beta,
      speed: beamVisualSpeed(beta),
      bunch,
    };
    const previous = profile[profile.length - 1];
    if (previous && Math.abs(previous.u - next.u) < 1e-9) profile[profile.length - 1] = next;
    else profile.push(next);
  }

  if (profile.length < 2) return fallback();
  if (profile[0].u > 0) profile.unshift({ ...profile[0], u: 0 });
  if (profile[profile.length - 1].u < 1) {
    profile.push({ ...profile[profile.length - 1], u: 1 });
  }
  return profile;
}

/** Interpolate the visual state at normalized distance `u`. */
export function sampleBeamVisualProfile(profile, u, fallbackMode = 'continuous') {
  const samples = Array.isArray(profile) && profile.length
    ? profile
    : beamVisualProfile(null, fallbackMode === 'bunched' ? [{ type: 'buncher' }] : [], []);
  const position = clamp01(Number.isFinite(u) ? u : 0);
  if (position <= samples[0].u) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (position >= last.u) return { ...last };

  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].u <= position) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const t = (position - a.u) / Math.max(1e-9, b.u - a.u);
  return {
    u: position,
    beta: a.beta + (b.beta - a.beta) * t,
    speed: a.speed + (b.speed - a.speed) * t,
    bunch: a.bunch + (b.bunch - a.bunch) * t,
  };
}
