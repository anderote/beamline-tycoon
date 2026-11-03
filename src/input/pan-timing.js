// Preserve the established 60Hz pan speed across refresh rates, while capping
// catch-up after a stalled/background frame so the camera does not jump.
export function panFrameScale(elapsedMs) {
  return Math.min(50, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)) / (1000 / 60);
}
