// src/renderer3d/frame-pacer.js
//
// GPU back-pressure for the render loop.
//
// _animate() is a bare requestAnimationFrame loop and WebGPU's render() is
// fire-and-forget: it encodes a frame, submits it to the device queue and
// returns without waiting. Nothing in that arrangement stops the next rAF
// callback from submitting another frame while the previous one is still
// executing, so once per-frame GPU cost exceeds the frame budget the queue
// grows without bound.
//
// That is the shape of the "the world froze but the UI still worked" report,
// and it measures exactly like one. On the Major Lab at night with a dozen
// lampposts: JS inside _animate() stayed at ~3 ms, a 16 ms setInterval kept
// firing on schedule (p95 17 ms) — so the main thread was never blocked — yet
// the gap between one rAF callback and the next reached 9.7 s, and
// queue.onSubmittedWorkDone() latency reached 11 s. The picture on screen was
// seconds of queued frames behind the simulation, and "it takes a long time
// to restore" is simply how long the queue takes to drain.
//
// The cure is back-pressure. queue.onSubmittedWorkDone() resolves when every
// command buffer submitted before the call has completed, which is precisely
// the signal needed to count frames in flight. Skipping a frame costs
// framerate; not skipping it costs a ten-second freeze, so the trade is not
// close. Note this does NOT make the GPU work cheaper — it converts an
// unbounded latency failure into an honest frame-rate drop, and it does that
// no matter which part of the frame is expensive.
//
// TWO SAFETY PROPERTIES, both load-bearing — this must never be able to stop
// rendering permanently:
//
//   1. WATCHDOG. A completion that never arrives (a lost device, a tab the
//      compositor has stopped scheduling) would otherwise pin inFlight above
//      the limit forever and freeze the world for good — the exact bug this
//      file exists to prevent. If no completion has landed for watchdogMs the
//      next frame is let through and the counters are resynchronised.
//   2. UNSUPPORTED IS TRANSPARENT. three's WebGPURenderer silently falls back
//      to a WebGL2 backend where there is no device queue and no
//      onSubmittedWorkDone. There, `supported` is false and shouldRender() is
//      a constant true, so the fallback path behaves exactly as it did before
//      this module existed. Never "emulate" pacing there with a timer: WebGL2
//      already applies its own implicit back-pressure at the driver, and a
//      guessed one on top would only drop frames for nothing.

const DEFAULT_MAX_FRAMES_IN_FLIGHT = 2;
const DEFAULT_WATCHDOG_MS = 1000;

const defaultNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

export class FramePacer {
  /**
   * @param {object} renderer three's WebGPURenderer (or anything shaped like
   *        it). Only `backend.isWebGPUBackend` and `backend.device.queue` are
   *        read, so a plain object works in tests.
   * @param {object} [options]
   * @param {number} [options.maxFramesInFlight=2] how many submitted-but-
   *        unfinished frames are tolerated before a frame is skipped. 1 is
   *        strictly serialised (lowest latency, worst throughput); 2 lets the
   *        CPU build frame N+1 while the GPU runs frame N, which is the usual
   *        pipelining depth and what a healthy engine already achieves.
   * @param {number} [options.watchdogMs=1000] how long to wait for any
   *        completion before assuming the signal is never coming.
   * @param {Function} [options.now] clock injection for tests.
   */
  constructor(renderer, options = {}) {
    this.maxFramesInFlight = Math.max(1, Math.floor(
      options.maxFramesInFlight ?? DEFAULT_MAX_FRAMES_IN_FLIGHT,
    ));
    this.watchdogMs = Math.max(0, Number(options.watchdogMs ?? DEFAULT_WATCHDOG_MS));
    this._now = typeof options.now === 'function' ? options.now : defaultNow;

    // Only the native WebGPU backend exposes a device queue. Reading through
    // optional chaining rather than assuming: the fallback path constructs the
    // same renderer class with a completely different backend object.
    const queue = renderer?.backend?.isWebGPUBackend === true
      ? renderer.backend?.device?.queue
      : null;
    this._queue = typeof queue?.onSubmittedWorkDone === 'function' ? queue : null;

    /** @type {boolean} false on the WebGL2 fallback — see the header. */
    this.supported = this._queue !== null;

    this._submitted = 0;
    this._completed = 0;
    this._skipped = 0;
    this._watchdogTrips = 0;
    this._lastProgressAt = this._now();
    this._disposed = false;
  }

  /** Frames submitted to the device that have not reported completion yet. */
  get inFlight() {
    return Math.max(0, this._submitted - this._completed);
  }

  /**
   * May this frame submit GPU work? Call once per frame, immediately before
   * the render, and skip the render (only the render — keep ticking the sim,
   * the camera and the UI) when it returns false.
   */
  shouldRender() {
    if (!this.supported || this._disposed) return true;
    if (this.inFlight < this.maxFramesInFlight) return true;

    if (this.watchdogMs > 0 && this._now() - this._lastProgressAt >= this.watchdogMs) {
      // Nothing has completed in a long time. Either the device is gone or
      // the completion signal is not coming; either way, refusing to draw
      // forever is worse than drawing into a queue that may be stuck.
      this._watchdogTrips++;
      this._completed = this._submitted;
      this._lastProgressAt = this._now();
      return true;
    }

    this._skipped++;
    return false;
  }

  /**
   * Record that a frame's GPU work has been submitted. Call right after the
   * render, never before: three encodes and submits inside render(), so the
   * completion probe has to be armed after that returns or it would resolve
   * against the previous frame.
   */
  frameSubmitted() {
    if (!this.supported || this._disposed) return;
    const seq = ++this._submitted;
    this._lastProgressAt = this._now();
    // Resolution means "everything submitted up to this call is done", so a
    // later frame's completion also retires every earlier one. Take the max
    // rather than decrementing, so out-of-order settling cannot under-count.
    const settle = () => {
      if (this._disposed) return;
      if (seq > this._completed) this._completed = seq;
      this._lastProgressAt = this._now();
    };
    // A rejection (device lost) is still information: it means this frame is
    // never completing, and holding the queue closed on it would freeze the
    // world exactly the way the watchdog exists to prevent.
    this._queue.onSubmittedWorkDone().then(settle, settle);
  }

  /** Runtime knob, so a quality preset or a debug overlay can retune pacing. */
  setMaxFramesInFlight(count) {
    this.maxFramesInFlight = Math.max(1, Math.floor(count || 1));
  }

  getStats() {
    return {
      framePacingSupported: this.supported,
      framesInFlight: this.inFlight,
      framesSubmitted: this._submitted,
      framesSkipped: this._skipped,
      framePacerWatchdogTrips: this._watchdogTrips,
      maxFramesInFlight: this.maxFramesInFlight,
    };
  }

  dispose() {
    this._disposed = true;
    this._queue = null;
  }
}

export default FramePacer;
