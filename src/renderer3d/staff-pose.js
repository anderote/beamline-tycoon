// Pure presentation mapping for staff activity. Keeping this independent of
// THREE makes the visible job vocabulary testable without a renderer.

const DESK_JOBS = new Set(['runBeam', 'takeData', 'analyze', 'paperwork']);

export function staffPoseFor({ mode, seated = false, jobType = null } = {}) {
  if (mode === 'pathWalk' || mode === 'simTravel') return 'walk';
  if (mode !== 'working') return 'stand';
  if (seated && DESK_JOBS.has(jobType)) return 'deskWork';
  if (seated) return 'sit';
  return 'benchWork';
}
