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
//     tools with shift-modified previews (smart floor wall paths, demolish
//     whole-run) can refresh without waiting for a mousemove.
//   - onCtrlChange(down, ctx): the same, for Ctrl. Command + drag is reserved
//     for camera orbit. Where
//     Shift EXTENDS a structure gesture, Ctrl INVERTS it — the tool erases
//     along exactly the path it would have drawn — so the preview has to
//     swap between the placement ghost and the red demolish preview even
//     with a stationary cursor.
//   - onRotateKey(ctx): R, offered to the active tool BEFORE the unified
//     placement rotation and the research-overlay fallback. Return true to
//     consume it. For tools whose gesture has an orientation of its own —
//     the utility line's bend order — R means "turn the thing I am drawing",
//     which is the same promise it makes everywhere else.
//   - cancelGesture(ctx, reason): fired when an in-flight gesture must end
//     without committing. `reason` is 'stateReplaced' when undo/redo is
//     about to swap game state wholesale, or 'abort' for a lost pointer
//     (window blur, tab hide, pointercancel, mouseup off-canvas). Tools
//     holding state that mirrors the world — MoveTool's lifted object —
//     must DROP it on 'stateReplaced' (the restore already holds a copy)
//     but RESTORE it on 'abort' (nothing else will).
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
  onCtrlChange(_down, _ctx) {}
  onRotateKey(_ctx) { return false; }
  cancelGesture(_ctx, _reason) {}
}
