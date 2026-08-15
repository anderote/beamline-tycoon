// Keep synchronous persistence outside the simulation tick in browsers. Node
// drivers stay synchronous so headless tests and command-line consumers do not
// leave timers behind or change their observable tick contract.

export function scheduleBrowserIdle(callback, {
  scope = globalThis,
  timeout = 2000,
} = {}) {
  if (typeof callback !== 'function') return null;
  if (typeof scope.requestIdleCallback === 'function') {
    return scope.requestIdleCallback(callback, { timeout });
  }
  if (scope.window === scope && typeof scope.setTimeout === 'function') {
    return scope.setTimeout(callback, 0);
  }
  callback();
  return null;
}
