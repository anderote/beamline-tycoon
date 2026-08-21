// src/ui/Stubby.js — the advisor's face and voice.
//
// Owns its own markup rather than a block in index.html: Stubby is one
// self-contained unit and splitting his DOM across two files means every
// change to him is two edits in two languages.
//
// The rule that matters here is that a helper must never cost you a click.
// The container is pointer-events: none and only the sprite and the bubble
// take pointer events back, so anywhere Stubby overlaps the facility, clicks
// pass straight through to it.

import { ADVICE_LEVEL_STORAGE_KEY } from '../advisor/engine.js';
import { drawStubby, STUBBY_W, STUBBY_H } from './stubby-sprite.js';

/** The introduction is a global player choice, like the advice level itself:
 * switching save slots must not make Stubby introduce himself again. */
export const STUBBY_INTRODUCTION_STORAGE_KEY = 'beamlineTycoon.stubbyIntroduced';

export const STUBBY_INTRODUCTION = Object.freeze({
  title: "Hi, I'm Stubby",
  body: "I'm a three-stub tuner here to help impedance match your gameplay experience. It looks like you're trying to build a beamline. Want some help?",
  acceptLabel: 'Yes help me',
  declineLabel: 'No Piss off',
});

export const STUBBY_TURN_OFF_LABEL = 'Turn Stubby off';

/** How long the perk-up animation runs before settling back to idle. */
const PERK_MS = 900;
/** Mouth-flap period while Stubby is delivering a line. */
const TALK_INTERVAL_MS = 320;
/** How many flaps before he settles. A bubble can stay open for minutes; a
 *  mouth that never stops moving is both a needless canvas redraw every third
 *  of a second and a fidget in the corner of the player's eye. */
const TALK_FLAPS = 8;

export class Stubby {
  /**
   * @param {object} game     the Game
   * @param {object} engine   the AdvisorEngine, for dismiss/silence
   * @param {object} renderer the renderer, for advice actions that move the
   *   camera. Injected rather than looked up off the game: main.js keeps the
   *   renderer in a local and only mirrors it onto `window` for console use.
   */
  constructor(game, engine, renderer) {
    this.game = game;
    this.engine = engine;
    this.host = { game, renderer };
    this.advice = null;
    this.collapsed = false;
    this.introducing = false;
    this.introductionSeen = this._hasSeenIntroduction();
    this._pendingAdvice = null;
    this._frame = 'idle';
    this._talkTimer = null;
    this._perkTimer = null;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'stubby';
    root.className = 'stubby hidden';
    root.innerHTML = `
      <div class="stubby-bubble" role="status" aria-live="polite">
        <div class="stubby-bubble-title"></div>
        <div class="stubby-bubble-body"></div>
        <div class="stubby-bubble-actions">
          <button type="button" class="stubby-btn stubby-btn-action hidden" data-act="advice-action"></button>
          <button type="button" class="stubby-btn" data-act="dismiss">Got it</button>
          <button type="button" class="stubby-btn stubby-btn-quiet" data-act="silence">Stop telling me this</button>
          <button type="button" class="stubby-btn stubby-btn-quiet stubby-btn-off" data-act="turn-off"
                  title="Hide Stubby until you turn advice back on from the ? menu">${STUBBY_TURN_OFF_LABEL}</button>
          <button type="button" class="stubby-btn stubby-btn-action hidden" data-act="intro-accept">${STUBBY_INTRODUCTION.acceptLabel}</button>
          <button type="button" class="stubby-btn stubby-btn-quiet hidden" data-act="intro-decline">${STUBBY_INTRODUCTION.declineLabel}</button>
        </div>
      </div>
      <canvas class="stubby-sprite" width="${STUBBY_W}" height="${STUBBY_H}"
              title="Stubby — click to hide"></canvas>
    `;
    document.body.appendChild(root);

    this.root = root;
    this.bubble = root.querySelector('.stubby-bubble');
    this.titleEl = root.querySelector('.stubby-bubble-title');
    this.bodyEl = root.querySelector('.stubby-bubble-body');
    this.actionBtn = root.querySelector('[data-act="advice-action"]');
    this.dismissBtn = root.querySelector('[data-act="dismiss"]');
    this.silenceBtn = root.querySelector('[data-act="silence"]');
    this.turnOffBtn = root.querySelector('[data-act="turn-off"]');
    this.introAcceptBtn = root.querySelector('[data-act="intro-accept"]');
    this.introDeclineBtn = root.querySelector('[data-act="intro-decline"]');
    this.canvas = root.querySelector('.stubby-sprite');

    this.canvas.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this._syncBubble();
    });
    this.dismissBtn.addEventListener('click', () => {
      if (this.advice) this.engine.dismiss(this.advice.key, this.game?.state?.tick || 0);
      this._setAdvice(null);
    });
    this.silenceBtn.addEventListener('click', () => {
      if (this.advice) this.engine.silence(this.advice.key);
      this._setAdvice(null);
    });
    this.turnOffBtn.addEventListener('click', () => this.turnOff());
    this.introAcceptBtn.addEventListener('click', () => this.respondToIntroduction(true));
    this.introDeclineBtn.addEventListener('click', () => this.respondToIntroduction(false));
    this.actionBtn.addEventListener('click', () => {
      if (this.advice?.action) this.advice.action.run(this.host);
    });

    this._draw('idle');
  }

  /**
   * Show this advice, or nothing when null.
   *
   * Two separate diffs, because the two things they guard are different.
   * Re-rendering identical text every evaluation would churn the DOM under the
   * player's cursor, so nothing happens when key, title and body all match.
   * But several rules hold a STABLE key while their numbers move —
   * `optics.needs-focusing` counts down as you place quads,
   * `economy.burning-cash` tracks the runway — and diffing on key alone froze
   * the bubble at whatever it first said. Only a changed key re-perks; changed
   * text refreshes quietly.
   */
  update(advice) {
    if (this.introducing) {
      this._pendingAdvice = advice || null;
      // The HUD can set advice to Off while the introduction is open. Honour
      // that preference immediately, just as it dismisses an ordinary bubble.
      if (this.engine.level?.() === 'off') this.respondToIntroduction(false);
      return;
    }
    if (advice && !this.introductionSeen) {
      this._pendingAdvice = advice;
      this._showIntroduction();
      return;
    }

    const prev = this.advice;
    if (!advice && !prev) return;
    if (advice && prev
        && advice.key === prev.key
        && advice.title === prev.title
        && advice.body === prev.body) {
      return;
    }
    const keyChanged = !advice || !prev || advice.key !== prev.key;
    this._setAdvice(advice, { perk: keyChanged });
  }

  _setAdvice(advice, opts = {}) {
    this.advice = advice || null;
    this._showAdviceControls();

    if (!this.advice) {
      this.root.classList.add('hidden');
      this._stopTalking();
      this._draw('idle');
      return;
    }

    this.root.classList.remove('hidden');
    this.root.dataset.severity = this.advice.severity;
    this.titleEl.textContent = this.advice.title;
    this.bodyEl.textContent = this.advice.body;

    if (this.advice.action) {
      this.actionBtn.textContent = this.advice.action.label;
      this.actionBtn.classList.remove('hidden');
    } else {
      this.actionBtn.classList.add('hidden');
    }

    // Genuinely new advice re-opens the bubble: the player collapsed the LAST
    // thing he said, not this one. A text-only refresh of advice already on
    // screen must NOT re-open it — that would override a deliberate collapse
    // every time a number ticked.
    if (opts.perk) this.collapsed = false;
    this._syncBubble({ talk: !!opts.perk });

    if (opts.perk) this._perk();
  }

  /** @param {{talk?: boolean}} opts talk:false refreshes the bubble without
   *  re-animating — used when only the numbers in an on-screen advice moved. */
  _syncBubble(opts = {}) {
    const shown = (this.introducing || !!this.advice) && !this.collapsed;
    this.bubble.classList.toggle('hidden', !shown);
    if (!shown) this._stopTalking();
    else if (opts.talk !== false) this._startTalking();
  }

  /** One-shot attention grab, then settle into the talking cycle. */
  _perk(severity = this.advice?.severity) {
    clearTimeout(this._perkTimer);
    // _syncBubble has already started the mouth flapping; leaving it running
    // would repaint over the perk pose one flap later and cut the perk from
    // 900 ms to 320.
    this._stopTalking();
    // A tip is not bad news — nothing is broken, he just has an idea. Opening
    // wide-eyed and alarmed for "you have money to spend" would train the
    // player to read every appearance as a fault.
    this._draw(severity === 'tip' ? 'pleased' : 'alert');
    this.root.classList.remove('stubby-perk');
    // Reflow so re-adding the class restarts the animation.
    void this.root.offsetWidth;
    this.root.classList.add('stubby-perk');
    this._perkTimer = setTimeout(() => {
      this.root.classList.remove('stubby-perk');
      if (!this.collapsed && (this.introducing || this.advice)) this._startTalking();
      else this._draw('idle');
    }, PERK_MS);
  }

  _hasSeenIntroduction() {
    try {
      return localStorage.getItem(STUBBY_INTRODUCTION_STORAGE_KEY) != null;
    } catch {
      return false;
    }
  }

  _rememberIntroduction(choice) {
    this.introductionSeen = true;
    try { localStorage.setItem(STUBBY_INTRODUCTION_STORAGE_KEY, choice); } catch {}
  }

  _showIntroduction() {
    this.introducing = true;
    this.advice = null;
    this.collapsed = false;
    this.root.classList.remove('hidden');
    this.root.dataset.severity = 'tip';
    this.titleEl.textContent = STUBBY_INTRODUCTION.title;
    this.bodyEl.textContent = STUBBY_INTRODUCTION.body;
    this.actionBtn.classList.add('hidden');
    this.dismissBtn.classList.add('hidden');
    this.silenceBtn.classList.add('hidden');
    // The introduction already has its explicit permanent opt-out. Avoid two
    // adjacent buttons that perform the same action under different labels.
    this.turnOffBtn.classList.add('hidden');
    this.introAcceptBtn.classList.remove('hidden');
    this.introDeclineBtn.classList.remove('hidden');
    this._syncBubble();
    this._perk('tip');
  }

  _showAdviceControls() {
    this.dismissBtn.classList.remove('hidden');
    this.silenceBtn.classList.remove('hidden');
    this.turnOffBtn.classList.remove('hidden');
    this.introAcceptBtn.classList.add('hidden');
    this.introDeclineBtn.classList.add('hidden');
  }

  /** Resolve the one-time introduction while keeping the player's first real
   * advice ready to show if they accept. */
  respondToIntroduction(wantsHelp) {
    if (!this.introducing) return false;

    if (!wantsHelp) return this.turnOff();

    this.introducing = false;
    const pending = this._pendingAdvice;
    this._pendingAdvice = null;
    this._rememberIntroduction('accepted');

    if (pending) this._setAdvice(pending);
    else this._setAdvice(null);
    return true;
  }

  /** Permanently disable Stubby until the player opts back in from the ? menu. */
  turnOff() {
    // If this is the introduction's opt-out, remember it too so a new save
    // cannot re-open the greeting before the global Off preference is read.
    if (this.introducing && !this.introductionSeen) {
      this._rememberIntroduction('declined');
    }
    this.introducing = false;
    this._pendingAdvice = null;
    this.engine.setLevel('off');
    try { localStorage.setItem(ADVICE_LEVEL_STORAGE_KEY, 'off'); } catch {}
    // The global preference covers new facilities; the advisor serializer in
    // the active save makes the same choice portable with that facility.
    this.game?.save?.();
    this._setAdvice(null);
    return true;
  }

  _startTalking() {
    this._stopTalking();
    let flaps = 0;
    this._talkTimer = setInterval(() => {
      flaps++;
      if (flaps > TALK_FLAPS) {
        this._stopTalking();
        this._draw('idle');
        return;
      }
      this._draw(flaps % 2 ? 'talk' : 'idle');
    }, TALK_INTERVAL_MS);
  }

  _stopTalking() {
    if (this._talkTimer) {
      clearInterval(this._talkTimer);
      this._talkTimer = null;
    }
  }

  _draw(frame) {
    if (frame === this._frame) return;
    this._frame = frame;
    drawStubby(this.canvas, { frame });
  }

  /** Tear down timers and DOM — for tests and for a full UI teardown. */
  destroy() {
    this._stopTalking();
    clearTimeout(this._perkTimer);
    this.root.remove();
  }
}
