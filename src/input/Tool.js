// src/input/Tool.js
//
// The explicit form of the controller shape BeamlineInputController and
// UtilityLineInputController converged on. A Tool is one armed input mode:
// InputHandler.setTool(tool) makes it the exclusive owner of placement /
// paint gestures until it is replaced or cleared. This replaces the old
// web of per-family selectedX fields kept mutually exclusive by manual
// deselect calls — with a single activeTool slot, exclusivity holds by
// construction.
//
// Contract:
//   - onEnter(ctx) / onExit(ctx): arm / disarm. InputHandler guarantees
//     onExit of the previous tool runs before onEnter of the next one, and
//     that all legacy (not-yet-converted) tool state is cleared in between.
//   - onMouseDown / onMouseMove / onMouseUp / onClick / onRightClick /
//     onKey: receive the DOM event (or a {clientX, clientY, button}-shaped
//     object for synthesized clicks) plus ctx, and return true to consume
//     the event. Returning false lets InputHandler's remaining legacy
//     dispatch chains run.
//   - onShiftChange(down, ctx): fired when the Shift key goes down/up so
//     tools with shift-modified previews (wall boundary fill, demolish
//     whole-run) can refresh without waiting for a mousemove.
//   - ctx is { game, renderer, input } (input = the InputHandler).
//   - cursor: optional CSS cursor to apply to the canvas while armed.
//
// Keep this a duck-typed base, not a framework: subclasses override only
// the handlers they need, and plain objects with the same shape work too.

export class Tool {
  constructor(id, kind) {
    this.id = id;      // identity, e.g. 'zone:office' or 'decoration:oakTree'
    this.kind = kind;  // family discriminator, e.g. 'placeable' | 'zone'
    this.cursor = '';  // optional CSS cursor while armed ('' = default)
  }

  // Optional: the unified-placeable id this tool has armed (drives the
  // shared hover ghost / commit / rotation paths via
  // InputHandler.armedPlaceableId). Null for tools without a ghost.
  get armedPlaceableId() { return null; }

  onEnter(_ctx) {}
  onExit(_ctx) {}
  onMouseDown(_e, _ctx) { return false; }
  onMouseMove(_e, _ctx) { return false; }
  onMouseUp(_e, _ctx) { return false; }
  onClick(_e, _ctx) { return false; }
  onRightClick(_e, _ctx) { return false; }
  onKey(_e, _ctx) { return false; }
  onShiftChange(_down, _ctx) {}
}
