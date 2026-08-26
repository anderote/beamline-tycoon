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
    // synchronous wait. The caller keeps its regular frame submission gated.
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
