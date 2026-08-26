export const PHYSICS_PLAYABLE_RUNWAY_MS = 8_000;
export const PHYSICS_IDLE_TIMEOUT_MS = 12_000;

/**
 * Give the renderer a quiet first-play window before starting Pyodide/Numpy.
 * Explicit physics consumers can still call BeamPhysics.init() directly; its
 * initialization is idempotent, so this scheduled warmup safely joins them.
 */
export function createDeferredPhysicsStart(start, {
  runwayMs = PHYSICS_PLAYABLE_RUNWAY_MS,
  idleTimeoutMs = PHYSICS_IDLE_TIMEOUT_MS,
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
  requestIdle = typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback.bind(globalThis)
    : null,
  cancelIdle = typeof globalThis.cancelIdleCallback === 'function'
    ? globalThis.cancelIdleCallback.bind(globalThis)
    : null,
} = {}) {
  if (typeof start !== 'function') throw new TypeError('start must be a function');
  if (typeof setTimer !== 'function') throw new TypeError('setTimer must be a function');

  let timerHandle = null;
  let idleHandle = null;
  let started = false;
  let cancelled = false;

  const clearScheduled = () => {
    if (timerHandle != null) clearTimer?.(timerHandle);
    if (idleHandle != null) cancelIdle?.(idleHandle);
    timerHandle = null;
    idleHandle = null;
  };

  const runNow = () => {
    if (started || cancelled) return false;
    started = true;
    clearScheduled();
    start();
    return true;
  };

  const schedule = () => {
    if (started || cancelled || timerHandle != null || idleHandle != null) return false;
    timerHandle = setTimer(() => {
      timerHandle = null;
      if (requestIdle) {
        idleHandle = requestIdle(() => {
          idleHandle = null;
          runNow();
        }, { timeout: idleTimeoutMs });
      } else {
        runNow();
      }
    }, runwayMs);
    return true;
  };

  const cancel = () => {
    if (started || cancelled) return false;
    cancelled = true;
    clearScheduled();
    return true;
  };

  return {
    schedule,
    runNow,
    cancel,
    get started() { return started; },
  };
}
