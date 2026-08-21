import { mergeWorldRefreshPlans } from './world-refresh-plan.js';

/**
 * Collect world invalidations until the renderer's next animation frame.
 * Game events are synchronous and compatibility follow-ups often arrive in
 * bursts; draining once per frame guarantees each renderer section rebuilds
 * at most once for that burst.
 */
export class WorldInvalidationScheduler {
  constructor(apply) {
    this._apply = apply;
    this._pending = null;
  }

  enqueue(plan) {
    if (!plan) return;
    this._pending = this._pending
      ? mergeWorldRefreshPlans(this._pending, plan)
      : mergeWorldRefreshPlans(plan);
  }

  flush() {
    const plan = this._pending;
    this._pending = null;
    if (plan) this._apply(plan);
    return plan;
  }

  clear() {
    this._pending = null;
  }

  get pending() {
    return this._pending;
  }
}
