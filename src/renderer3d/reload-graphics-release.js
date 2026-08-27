// Fast graphics shutdown for an imminent page reload.
//
// A full ThreeRenderer.dispose() is correct for a long-lived single-page
// teardown, but it synchronously walks every renderer cache and render target.
// On a large facility that cleanup can itself monopolize Chrome. A reload is a
// different contract: the page is about to release the entire JS graph, so we
// only need to stop animation and release the browser-owned GPU context/device
// before the replacement page requests another one.

export function releaseGraphicsForReload(renderer) {
  if (!renderer) return null;
  renderer.setAnimationLoop?.(null);

  const device = renderer.backend?.device;
  if (renderer.backend?.isWebGPUBackend === true && typeof device?.destroy === 'function') {
    device.destroy();
    return 'webgpu';
  }

  const gl = renderer.getContext?.();
  const loseContext = gl?.getExtension?.('WEBGL_lose_context');
  if (typeof loseContext?.loseContext === 'function') {
    loseContext.loseContext();
    return 'webgl2';
  }

  return null;
}
