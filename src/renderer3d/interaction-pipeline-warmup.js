/**
 * Compile the direct-to-canvas material pipelines used while the camera moves.
 *
 * The normal WebGPU frame renders through the glow pipeline's offscreen
 * targets. Camera interaction deliberately bypasses post-processing, which
 * means Three needs a second pipeline family for the swapchain target. Without
 * this warmup, the first orbit/pan can block on a large batch of cold shader
 * and render-pipeline compilation even though steady-state rendering is fast.
 */
export async function prewarmInteractionPipelines(renderer, scene, camera) {
  if (renderer?.backend?.isWebGPUBackend !== true
      || typeof renderer.compileAsync !== 'function'
      || typeof renderer.render !== 'function') {
    return false;
  }

  try {
    await renderer.compileAsync(scene, camera);
    // compileAsync warms shader work asynchronously, but Three can still
    // allocate a render-context-specific pipeline and its bind groups on the
    // first real swapchain submission. Submit that exact frame now so those
    // last allocations also happen behind the loading screen.
    renderer.render(scene, camera);
    await renderer.backend.device?.queue?.onSubmittedWorkDone?.();
    return true;
  } catch (error) {
    // Warmup is an optimization, not a boot requirement. Device-loss recovery
    // and the normal render path still need a chance to handle a transient GPU
    // failure rather than leaving the title screen permanently in LOADING.
    console.warn('[renderer] Interaction pipeline warmup deferred:', error);
    return false;
  }
}

/**
 * Compile geometry/material variants added during play without submitting a
 * frame that can synchronously block the browser's GPU process. The caller
 * keeps rendering gated until this promise settles; simulation and DOM input
 * continue normally while WebGPU prepares the new pipelines.
 */
export async function precompileWorldPipelines(renderer, scene, camera, {
  submit = true,
} = {}) {
  if (renderer?.backend?.isWebGPUBackend !== true
      || typeof renderer.compileAsync !== 'function') {
    return false;
  }
  try {
    await renderer.compileAsync(scene, camera);
    // WebGPURenderer's async submission warms the render-context-specific
    // pipeline without turning the next ordinary animation frame into a
    // synchronous wait. This is the mid-game counterpart to the direct boot
    // warmup above; the caller keeps its regular frame submission gated.
    if (submit && typeof renderer.renderAsync === 'function') {
      await renderer.renderAsync(scene, camera);
      await renderer.backend.device?.queue?.onSubmittedWorkDone?.();
    }
    return true;
  } catch (error) {
    console.warn('[renderer] World pipeline precompile deferred:', error);
    return false;
  }
}
