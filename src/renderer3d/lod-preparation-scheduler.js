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
  }

  schedule(builders) {
    this.cancel();
    const queue = Array.from(builders || [])
      .filter(builder => typeof builder?.prepareFarPresentation === 'function');
    if (!queue.length) return false;

    const token = this._token;
    const step = () => {
      if (token !== this._token) return;
      this._handle = null;
      queue.shift().prepareFarPresentation();
      if (queue.length && token === this._token) this._schedule(step);
    };
    this._schedule(step);
    return true;
  }

  cancel() {
    this._token++;
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
