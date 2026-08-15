// Shared message vocabulary for the main-thread physics client and its worker.

export const PHYSICS_MESSAGE = Object.freeze({
  INIT: 'init',
  READY: 'ready',
  INIT_ERROR: 'init-error',
  COMPUTE: 'compute',
  RESULT: 'result',
});
