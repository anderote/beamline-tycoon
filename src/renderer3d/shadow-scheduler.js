// Pure staggered shadow refresh scheduler. Dirty assignments refresh promptly,
// then the active slots share one queue-wide periodic service rate. `hz` is
// deliberately aggregate rather than per-slot: twelve shadows at 15 Hz must
// cost 15 scene renders per second, not 180.

export class ShadowScheduler {
  constructor(slotCount, opts = {}) {
    this.slotCount = Math.max(0, Math.floor(slotCount || 0));
    this._dirty = new Uint8Array(this.slotCount);
    this._assignmentKeys = new Array(this.slotCount).fill(null);
    this._cursor = 0;
    this._periodicElapsedMs = 0;
    this._activeCount = 0;
    this.configure(opts);
    this.markAllDirty();
  }

  configure(opts = {}) {
    const nextHz = Math.max(0, Number(opts.hz) || 0);
    if (this.hz !== undefined && nextHz !== this.hz) this._periodicElapsedMs = 0;
    this.hz = nextHz;
    this.maxUpdatesPerFrame = Math.max(1, Math.floor(opts.maxUpdatesPerFrame || 1));
  }

  markAllDirty() {
    this._dirty.fill(1);
  }

  resetSlot(index) {
    if (index < 0 || index >= this.slotCount) return;
    this._dirty[index] = 0;
    this._assignmentKeys[index] = null;
  }

  get pendingCount() {
    let count = 0;
    for (let i = 0; i < this._activeCount; i++) {
      if (this._assignmentKeys[i] != null && this._dirty[i]) count++;
    }
    return count;
  }

  /** @returns {number[]} pooled result containing slot indices to refresh. */
  step({ activeCount, enabled = true, dtMs = 0, assignmentKeys = [] } = {}) {
    const active = Math.max(0, Math.min(this.slotCount, Math.floor(activeCount || 0)));
    this._activeCount = active;
    this._result = this._result || [];
    this._result.length = 0;

    for (let i = 0; i < this.slotCount; i++) {
      const key = i < active ? (assignmentKeys[i] ?? null) : null;
      if (key !== this._assignmentKeys[i]) {
        this._assignmentKeys[i] = key;
        this._dirty[i] = key == null ? 0 : 1;
      } else if (i >= active) {
        this.resetSlot(i);
      }
    }

    if (!enabled || active === 0 || this.hz <= 0) {
      this._periodicElapsedMs = 0;
      return this._result;
    }

    const interval = 1000 / this.hz;
    const elapsed = Math.max(0, Number(dtMs) || 0);
    // A resumed background tab can deliver a huge dt. Keep at most one
    // frame's service capacity so it cannot repay wall-clock debt by issuing
    // a burst of shadow renders on the first visible frame.
    this._periodicElapsedMs = Math.min(
      this._periodicElapsedMs + elapsed,
      interval * this.maxUpdatesPerFrame,
    );

    // Dirty assignments bypass the periodic clock so a newly selected light
    // is not dark for a whole queue rotation. They still obey the hard frame
    // cap and round-robin cursor, which is what turns the dusk transition into
    // a short queue rather than one all-lights-at-once frame.
    let lastScheduled = -1;
    const dirtyStart = this._cursor;
    for (let offset = 0; offset < active && this._result.length < this.maxUpdatesPerFrame; offset++) {
      const i = (dirtyStart + offset) % active;
      if (this._assignmentKeys[i] == null || !this._dirty[i]) continue;
      this._result.push(i);
      this._dirty[i] = 0;
      lastScheduled = i;
    }
    if (this._result.length > 0) {
      this._cursor = (lastScheduled + 1) % Math.max(1, active);
      // A dirty refresh is useful work from this queue too. Start the
      // periodic cadence after the backlog drains instead of interleaving
      // redundant refreshes with still-dirty layers.
      this._periodicElapsedMs = 0;
      return this._result;
    }

    let due = Math.min(
      this.maxUpdatesPerFrame,
      Math.floor(this._periodicElapsedMs / interval),
    );
    const periodicStart = this._cursor;
    lastScheduled = -1;
    for (let offset = 0; offset < active && due > 0; offset++) {
      const i = (periodicStart + offset) % active;
      if (this._assignmentKeys[i] == null) continue;
      this._result.push(i);
      lastScheduled = i;
      due--;
    }
    if (lastScheduled >= 0) this._cursor = (lastScheduled + 1) % Math.max(1, active);
    this._periodicElapsedMs -= this._result.length * interval;
    return this._result;
  }
}
