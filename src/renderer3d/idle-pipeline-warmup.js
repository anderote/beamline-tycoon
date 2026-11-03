// Compile offscreen objects one idle task at a time against the real scene's
// lighting/cache context. Never submit a frame or delay playable startup.
export class IdlePipelineWarmup {
  constructor({ scope = globalThis, busy = () => false } = {}) {
    this.scope = scope; this.busy = busy; this.token = 0; this.handle = null;
    this.completed = 0; this.remaining = 0;
  }
  cancel() {
    this.token++;
    if (this.handle !== null) {
      if (this.scope.requestIdleCallback) this.scope.cancelIdleCallback?.(this.handle);
      else this.scope.clearTimeout?.(this.handle);
    }
    this.handle = null; this.remaining = 0;
  }
  schedule(renderer, scene, camera) {
    this.cancel();
    if (!renderer?.backend?.isWebGPUBackend || !renderer.compileAsync) return;
    const objects = [];
    scene.traverseVisible(object => {
      if (object.isMesh && object.material && object.material.visible !== false) objects.push(object);
    });
    const token = this.token;
    this.completed = 0; this.remaining = objects.length;
    const queue = callback => {
      this.handle = this.scope.requestIdleCallback
        ? this.scope.requestIdleCallback(callback, { timeout: 1000 })
        : this.scope.setTimeout(callback, 32);
    };
    const step = async () => {
      if (token !== this.token) return;
      this.handle = null;
      if (this.busy()) { queue(step); return; }
      const object = objects.shift();
      if (!object) return;
      const previous = object.frustumCulled;
      try {
        // compileAsync constructs its render list before its first asynchronous
        // node-build wait. Restore culling immediately so ordinary frames keep
        // their normal visibility while compilation completes.
        object.frustumCulled = false;
        let pending;
        try { pending = renderer.compileAsync(object, camera, scene); }
        finally { object.frustumCulled = previous; }
        await pending;
      } catch (error) {
        console.warn('[renderer] Idle pipeline preparation skipped:', error);
      }
      if (token !== this.token) return;
      this.completed++; this.remaining = objects.length;
      if (objects.length) queue(step);
    };
    if (objects.length) queue(step);
  }
}
