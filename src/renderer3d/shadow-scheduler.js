// Pure staggered shadow refresh scheduler. Dirty assignments refresh promptly,
// then each active slot receives periodic updates at the preset cadence.

export class ShadowScheduler {
  constructor(slotCount, opts = {}) {
    this.slotCount = Math.max(0, Math.floor(slotCount || 0));
    this._elapsed = new Float64Array(this.slotCount);
    this._dirty = new Uint8Array(this.slotCount);
    this._assignmentKeys = new Array(this.slotCount).fill(null);
    this._cursor = 0;
    this.configure(opts);
    this.markAllDirty();
  }

  configure(opts = {}) {
    this.hz = Math.max(0, Number(opts.hz) || 0);
    this.maxUpdatesPerFrame = Math.max(1, Math.floor(opts.maxUpdatesPerFrame || 1));
  }

  markAllDirty() {
    this._dirty.fill(1);
  }

  resetSlot(index) {
    if (index < 0 || index >= this.slotCount) return;
    this._elapsed[index] = 0;
    this._dirty[index] = 0;
    this._assignmentKeys[index] = null;
  }

  /** @returns {number[]} pooled result containing slot indices to refresh. */
  step({ activeCount, enabled = true, dtMs = 0, assignmentKeys = [] } = {}) {
    const active = Math.max(0, Math.min(this.slotCount, Math.floor(activeCount || 0)));
    this._result = this._result || [];
    this._result.length = 0;

    for (let i = 0; i < this.slotCount; i++) {
      const key = i < active ? (assignmentKeys[i] ?? null) : null;
      if (key !== this._assignmentKeys[i]) {
        this._assignmentKeys[i] = key;
        this._elapsed[i] = 0;
        this._dirty[i] = key == null ? 0 : 1;
      } else if (i < active && key != null) {
        this._elapsed[i] += Math.max(0, Number(dtMs) || 0);
      } else if (i >= active) {
        this.resetSlot(i);
      }
    }

    if (!enabled || active === 0 || this.hz <= 0) return this._result;
    const interval = 1000 / this.hz;
    for (let pass = 0; pass < 2 && this._result.length < this.maxUpdatesPerFrame; pass++) {
      for (let offset = 0; offset < active && this._result.length < this.maxUpdatesPerFrame; offset++) {
        const i = (this._cursor + offset) % active;
        if (this._assignmentKeys[i] == null || this._result.includes(i)) continue;
        const eligible = pass === 0 ? this._dirty[i] : this._elapsed[i] >= interval;
        if (!eligible) continue;
        this._result.push(i);
        this._dirty[i] = 0;
        this._elapsed[i] = 0;
        this._cursor = (i + 1) % Math.max(1, active);
      }
    }
    return this._result;
  }
}

