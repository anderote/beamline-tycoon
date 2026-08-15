// Live build-menu thumbnails retain classic WebGLRenderer because their API
// is synchronous and its small offscreen renders remain much faster than the
// node renderer's fallback backend. Keep it out of the entry chunk and load it
// only when the player first interacts with the build palette.

let loadPromise = null;

export function loadLegacyThumbnailRenderer() {
  if (globalThis.THREE?.WebGLRenderer) return Promise.resolve(true);
  if (!loadPromise) {
    loadPromise = import('three').then(({ WebGLRenderer }) => {
      if (!globalThis.THREE?.WebGLRenderer) {
        globalThis.THREE = Object.freeze({ ...globalThis.THREE, WebGLRenderer });
      }
      return true;
    }).catch((error) => {
      console.warn('[Renderer] Live thumbnail renderer unavailable.', error);
      return false;
    });
  }
  return loadPromise;
}
