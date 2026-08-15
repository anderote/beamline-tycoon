/** Attach one recoverable device-loss handler while preserving Three's own bookkeeping. */
export function attachRendererLossHandler(renderer, onLoss) {
  if (!renderer || typeof onLoss !== 'function') return () => {};
  const previous = renderer.onDeviceLost;
  let active = true;
  const wrapped = function onDeviceLost(info) {
    if (typeof previous === 'function') previous.call(renderer, info);
    if (active) onLoss(info || {});
  };
  renderer.onDeviceLost = wrapped;
  return () => {
    active = false;
    if (renderer.onDeviceLost === wrapped) renderer.onDeviceLost = previous;
  };
}
