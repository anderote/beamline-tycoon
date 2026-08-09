// src/ui/draggable.js — shared drag-to-move behavior for dialogs/popups/windows.
//
// makeDraggable(el, handleEl, opts) wires a mousedown handler on handleEl that
// starts a drag. Document-level mousemove/mouseup listeners are attached only
// while a drag is active and removed on release, so idle windows add no
// document listeners. Returns a dispose() that removes everything (including
// any in-flight drag listeners).
//
// Default behavior moves `el` by writing style.left/top from the position it
// had at drag start. Sites with custom motion (world-anchored windows, canvas
// panning) pass onMove and keep full control.
//
// opts:
//   exclude         CSS selector — mousedown on/inside a match is ignored
//                   (close buttons, sliders, embedded controls)
//   button          restrict to one mouse button index (default: any button)
//   threshold       px of movement before the drag "takes"; onMove doesn't
//                   fire and `moved` stays false until exceeded (default 0)
//   freezeTransform freeze a centered `transform` position into left/top
//                   pixels on drag start, so moves are plain pixel offsets
//   grabCursor      swap handleEl's cursor to 'grabbing' during the drag and
//                   back to 'grab' on release
//   preventDefault  call e.preventDefault() on drag start (default true)
//   onStart(e)      return false to abort the drag; any other return value is
//                   kept as per-drag state and passed to onMove/onEnd
//   onMove(e, dx, dy, state)   replaces the default left/top move
//   onEnd(e, moved, state)     called on release of an active drag
export function makeDraggable(el, handleEl, opts = {}) {
  const {
    exclude = null,
    button = null,
    threshold = 0,
    freezeTransform = false,
    grabCursor = false,
    preventDefault = true,
    onStart = null,
    onMove = null,
    onEnd = null,
  } = opts;

  let active = null; // { sx, sy, ox, oy, moved, state } while dragging

  const handleMove = (e) => {
    if (!active) return;
    const dx = e.clientX - active.sx;
    const dy = e.clientY - active.sy;
    if (!active.moved && Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    active.moved = true;
    if (onMove) {
      onMove(e, dx, dy, active.state);
    } else {
      el.style.left = (active.ox + dx) + 'px';
      el.style.top = (active.oy + dy) + 'px';
    }
  };

  const handleUp = (e) => {
    const drag = active;
    active = null;
    detachDoc();
    if (!drag) return;
    if (grabCursor) handleEl.style.cursor = 'grab';
    if (onEnd) onEnd(e, drag.moved, drag.state);
  };

  const attachDoc = () => {
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };
  const detachDoc = () => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleUp);
  };

  const handleDown = (e) => {
    if (button != null && e.button !== button) return;
    if (exclude && e.target.closest(exclude)) return;
    let state;
    if (onStart) {
      state = onStart(e);
      if (state === false) return;
    }
    // First drag of a centered element: freeze the transform position into
    // left/top pixels so subsequent moves don't fight the transform.
    if (freezeTransform && el.style.transform !== 'none') {
      const r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.transform = 'none';
    }
    active = {
      sx: e.clientX, sy: e.clientY,
      ox: parseInt(el.style.left, 10) || 0,
      oy: parseInt(el.style.top, 10) || 0,
      moved: false,
      state,
    };
    if (grabCursor) handleEl.style.cursor = 'grabbing';
    if (preventDefault) e.preventDefault();
    attachDoc();
  };

  handleEl.addEventListener('mousedown', handleDown);

  return function dispose() {
    handleEl.removeEventListener('mousedown', handleDown);
    detachDoc();
    active = null;
  };
}
