// src/input/BeamlineInputController.js
//
// All beamline-related input: junction placement ghost, pipe drawing,
// placement-on-pipe ghost. Translates cursor events into BeamlineSystem
// calls. Owned by InputHandler; InputHandler delegates beamline input
// here when the selected tool is a beamline component or pipe-drawing.

export class BeamlineInputController {
  constructor({ game, renderer }) {
    this.game = game;
    this.renderer = renderer;
  }

  onHover(/* worldX, worldY */) {
    // no-op
  }

  onMouseDown(/* worldX, worldY, button */) {
    // no-op
    return false;
  }

  onMouseMove(/* worldX, worldY */) {
    // no-op
  }

  onMouseUp(/* worldX, worldY, button */) {
    // no-op
    return false;
  }

  onRotate() {
    // no-op
  }

  isActive() {
    return false;
  }

  reset() {
    // no-op
  }
}
