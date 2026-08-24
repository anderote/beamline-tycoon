// Per-animation-frame GPU admission and interaction policy. ThreeRenderer
// owns the camera flags; FramePacer owns queue back-pressure. Keeping their
// join here makes the ordering explicit and testable without constructing a
// renderer or reaching through one of its private methods.

export class FrameRenderPolicy {
  constructor(framePacer = null) {
    this.framePacer = framePacer;
    // Reused every frame: this runs at rAF cadence and should not create a
    // short-lived policy object sixty times per second.
    this._plan = {
      renderAllowed: true,
      cameraMoving: false,
      deferShadows: false,
    };
  }

  /**
   * @param {object} view ThreeRenderer-shaped live camera state.
   * @param {object|null} input InputHandler-shaped pan/key state.
   */
  beginFrame(view = {}, input = null) {
    const keys = input?.keysDown;
    const cameraMoving = view._viewRotating === true
      || view._snapping === true
      || view._freeOrbiting === true
      || view._focusing === true
      || input?.isPanning === true
      || keys?.has?.('w') === true
      || keys?.has?.('a') === true
      || keys?.has?.('s') === true
      || keys?.has?.('d') === true;
    const renderAllowed = !this.framePacer || this.framePacer.shouldRender();

    this._plan.renderAllowed = renderAllowed;
    this._plan.cameraMoving = cameraMoving;
    this._plan.deferShadows = !renderAllowed || cameraMoving;
    return this._plan;
  }
}

export default FrameRenderPolicy;
