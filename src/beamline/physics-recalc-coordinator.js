// Revision guard around asynchronous physics. Game owns when a calculation is
// needed; this coordinator owns stale-result rejection and pending counts.

export class PhysicsRecalcCoordinator {
  constructor(engine) {
    this.engine = engine;
    this._revisions = new Map();
    this._pending = new Set();
  }

  request(key, payload, effects, apply) {
    if (!this.engine?.isReady?.()) return false;
    const revision = (this._revisions.get(key) || 0) + 1;
    this._revisions.set(key, revision);
    this._pending.add(key);
    this.engine.computeAsync(payload, effects, { lane: key }).then(result => {
      if (this._revisions.get(key) !== revision) return;
      this._pending.delete(key);
      apply(result);
    }).catch(() => {
      if (this._revisions.get(key) === revision) {
        this._pending.delete(key);
        apply(null);
      }
    });
    return true;
  }

  invalidate(key) {
    this._revisions.set(key, (this._revisions.get(key) || 0) + 1);
    this._pending.delete(key);
  }

  clear() {
    for (const key of this._revisions.keys()) this.invalidate(key);
  }

  isPending(key) { return this._pending.has(key); }
  pendingCount() { return this._pending.size; }
}
