// src/advisor/engine.js — ranks what the rules found and decides what, if
// anything, Stubby says.
//
// The engine surfaces exactly one advice at a time. A character who reads out
// six problems is a log with a face; the value is in picking the one that
// matters most right now and letting the player deal with it.

import { ADVICE_RULES } from './rules.js';

/** Higher wins. Ties inside a band break on position in ADVICE_RULES, so the
 *  order of that table is meaningful. */
const SEVERITY_RANK = { blocker: 3, warning: 2, tip: 1 };

/** Player-facing advice filters. `minRank: Infinity` is the explicit off
 *  state, rather than a special case spread through the presenter and tick
 *  loop. The HUD reads this same table, so its labels cannot drift from what
 *  the engine actually filters. */
export const ADVICE_LEVELS = Object.freeze({
  all: Object.freeze({ label: 'Full advice', detail: 'Tips, warnings, and blockers', minRank: 1 }),
  warnings: Object.freeze({ label: 'Warnings & blockers', detail: 'Skip optional tips', minRank: 2 }),
  blockers: Object.freeze({ label: 'Blockers only', detail: 'Only problems that stop the beam', minRank: 3 }),
  off: Object.freeze({ label: 'Off', detail: 'Stubby stays quiet', minRank: Infinity }),
});

/** Global preference key. The level also lives in the active game save for
 *  portability, while this key keeps the player's choice when switching save
 *  slots or starting a new facility. */
export const ADVICE_LEVEL_STORAGE_KEY = 'beamlineTycoon.adviceLevel';

const DEFAULT_ADVICE_LEVEL = 'all';

/** Rules that omit cooldownTicks still get one — a rule firing every
 *  evaluation with no cooldown would re-open its bubble twice a second. */
const DEFAULT_COOLDOWN_TICKS = 120;

export class AdvisorEngine {
  constructor(rules = ADVICE_RULES) {
    this.rules = rules;
    /** keys the player dismissed this session, cleared when the advice recurs
     *  after its cooldown */
    this._dismissed = new Set();
    /** keys the player asked never to hear again; persisted */
    this._silenced = new Set();
    /** key -> tick at which it was last dismissed, for cooldown expiry */
    this._dismissedAt = new Map();
    this._current = null;
    this._level = DEFAULT_ADVICE_LEVEL;
  }

  /**
   * Run every rule against a context and pick what to say.
   * @returns {object|null} the advice now current
   */
  evaluate(ctx) {
    const tick = ctx.tick || 0;
    const found = [];

    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if ((SEVERITY_RANK[rule.severity] || 0) < ADVICE_LEVELS[this._level].minRank) continue;
      let payload;
      try {
        payload = rule.when(ctx);
      } catch {
        // A rule that throws is a bug in that rule, not a reason to silence
        // every other rule — and this runs inside the tick loop.
        continue;
      }
      if (!payload) continue;

      const key = payload.target != null ? `${rule.id}:${payload.target}` : rule.id;
      if (this._silenced.has(key)) continue;

      // A dismissal holds only until the cooldown lapses. Persistent problems
      // therefore come back; the player who wants it gone for good uses
      // silence() instead.
      const dismissedAt = this._dismissedAt.get(key);
      if (dismissedAt != null) {
        const cooldown = rule.cooldownTicks ?? DEFAULT_COOLDOWN_TICKS;
        if (tick - dismissedAt < cooldown) continue;
        this._dismissedAt.delete(key);
        this._dismissed.delete(key);
      }

      let text;
      try {
        text = rule.say(ctx, payload);
      } catch {
        continue;
      }
      if (!text || !text.title) continue;

      found.push({
        ruleId: rule.id,
        key,
        order: i,
        severity: rule.severity,
        group: rule.group,
        title: text.title,
        body: text.body || '',
        // The payload is bound here so the presenter can invoke the action
        // without knowing which rule produced it. `host` is {game, renderer}.
        action: rule.action
          ? { label: rule.action.label, run: (host) => rule.action.run(host, payload) }
          : null,
      });
    }

    found.sort((a, b) => {
      const s = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      return s !== 0 ? s : a.order - b.order;
    });

    this._current = found[0] || null;
    return this._current;
  }

  /** The advice Stubby should be showing, or null for "nothing to say". */
  current() {
    return this._current;
  }

  /** Current player-selected advice filter. */
  level() {
    return this._level;
  }

  /** Change how much Stubby is allowed to surface. Returns false for unknown
   *  values so corrupted/old saves cannot leave the advisor in a phantom
   *  state. The next evaluate() selects fresh advice under the new filter. */
  setLevel(level) {
    if (!Object.hasOwn(ADVICE_LEVELS, level)) return false;
    this._level = level;
    this._current = null;
    return true;
  }

  /** Hide this advice until its cooldown lapses and the problem is still there. */
  dismiss(key, tick = 0) {
    if (!key) return;
    this._dismissed.add(key);
    this._dismissedAt.set(key, tick);
    if (this._current && this._current.key === key) this._current = null;
  }

  /** Never show this advice again. Survives save/load. */
  silence(key) {
    if (!key) return;
    this._silenced.add(key);
    if (this._current && this._current.key === key) this._current = null;
  }

  /** Silenced keys, for the save file. Cooldowns and dismissals are session
   *  state and deliberately not persisted — a reloaded game should tell you
   *  again what is still broken. */
  toJSON() {
    return { silenced: [...this._silenced], level: this._level };
  }

  fromJSON(data) {
    this._silenced = new Set(Array.isArray(data?.silenced) ? data.silenced : []);
    this._level = Object.hasOwn(ADVICE_LEVELS, data?.level)
      ? data.level
      : DEFAULT_ADVICE_LEVEL;
    this._current = null;
  }
}

export { SEVERITY_RANK };
