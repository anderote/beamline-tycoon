// Idle-world utility ports are both wiring handles and part of the equipment
// the player is trying to select. Keep the press ambiguous until the pointer
// moves far enough to become a deliberate drag; a release before then remains
// an ordinary equipment click.

export const DEFERRED_PORT_DRAG_THRESHOLD_PX = 7;

function replayablePress(event) {
  return {
    button: 0,
    clientX: event.clientX,
    clientY: event.clientY,
    shiftKey: !!event.shiftKey,
    altKey: !!event.altKey,
    ctrlKey: !!event.ctrlKey,
    metaKey: !!event.metaKey,
  };
}

export class DeferredUtilityPortDrag {
  constructor(thresholdPx = DEFERRED_PORT_DRAG_THRESHOLD_PX) {
    this.thresholdPx = thresholdPx;
    this._pending = null;
  }

  get isPending() { return this._pending !== null; }

  begin(port, event) {
    if (!port?.utilityType || event?.button !== 0) return false;
    this._pending = {
      port,
      press: replayablePress(event),
    };
    return true;
  }

  /** Return the original press once this pointer stream becomes a drag. */
  update(event) {
    const pending = this._pending;
    if (!pending) return null;
    if (Number.isFinite(event?.buttons) && (event.buttons & 1) === 0) {
      this.cancel();
      return null;
    }
    const distance = Math.hypot(
      Number(event?.clientX) - pending.press.clientX,
      Number(event?.clientY) - pending.press.clientY,
    );
    if (!Number.isFinite(distance) || distance < this.thresholdPx) return null;
    this._pending = null;
    return { port: pending.port, press: pending.press };
  }

  /** A pending release is intentionally left for normal click selection. */
  release() {
    const wasPending = this.isPending;
    this._pending = null;
    return wasPending;
  }

  cancel() { this._pending = null; }
}

export default DeferredUtilityPortDrag;
