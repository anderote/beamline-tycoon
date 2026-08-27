/**
 * Prepare dormant LOD presentations across separate browser-idle slices.
 * Re-scheduling cancels the outstanding slice so builders from an obsolete
 * world snapshot cannot keep allocating geometry after a refresh.
 */
export class LodPreparationScheduler {
  constructor({ scope = globalThis, timeout = 1200, fallbackDelay = 32 } = {}) {
    this._scope = scope;
    this._timeout = timeout;
    this._fallbackDelay = fallbackDelay;
    this._handle = null;
    this._token = 0;
    this._queue = [];
  }

  schedule(builders) {
    this.cancel();
    this._queue = Array.from(builders || [])
      .filter(builder => typeof builder?.prepareFarPresentation === 'function');
    if (!this._queue.length) return false;

    const token = this._token;
    const step = () => {
      if (token !== this._token) return;
      this._handle = null;
      this._queue.shift()?.prepareFarPresentation();
      if (this._queue.length && token === this._token) this._schedule(step);
    };
    this._schedule(step);
    return true;
  }

  /**
   * Finish any idle preparation before the renderer becomes interactive.
   * Most title sessions drain this queue naturally while the player is at the
   * menu. A fast Continue click must not move the same work onto the first
   * camera gesture, where WebGPU pipeline admission can amplify it into a
   * multi-second visible stall.
   */
  flush() {
    const queue = this._queue.splice(0);
    const pending = this._handle;
    this._handle = null;
    this._token++;
    if (pending?.kind === 'idle') this._scope.cancelIdleCallback?.(pending.id);
    else if (pending) this._scope.clearTimeout?.(pending.id);
    for (const builder of queue) builder.prepareFarPresentation();
    return queue.length;
  }

  cancel() {
    this._token++;
    this._queue = [];
    const pending = this._handle;
    this._handle = null;
    if (!pending) return;
    if (pending.kind === 'idle') this._scope.cancelIdleCallback?.(pending.id);
    else this._scope.clearTimeout?.(pending.id);
  }

  get pending() {
    return this._handle !== null;
  }

  _schedule(callback) {
    if (typeof this._scope.requestIdleCallback === 'function') {
      this._handle = {
        kind: 'idle',
        id: this._scope.requestIdleCallback(callback, { timeout: this._timeout }),
      };
      return;
    }
    if (typeof this._scope.setTimeout === 'function') {
      this._handle = {
        kind: 'timer',
        id: this._scope.setTimeout(callback, this._fallbackDelay),
      };
      return;
    }
    callback();
  }
}
