import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url),
  'utf8',
);

function methodBody(name, nextName) {
  const start = source.indexOf(`  ${name}(`);
  const directEnd = source.indexOf(`\n  ${nextName}(`, start);
  const asyncEnd = source.indexOf(`\n  async ${nextName}(`, start);
  const end = directEnd === -1
    ? asyncEnd
    : (asyncEnd === -1 ? directEnd : Math.min(directEnd, asyncEnd));
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${nextName} follows ${name}`);
  return source.slice(start, end);
}

test('orthographic projection updates are invalidated only by zoom-changing camera work', () => {
  const sync = methodBody('_syncOverlayFromPan', 'zoomAt');
  assert.match(sync, /_syncOverlayFromPan\(updateFrustum = true\)/,
    'initialization, resize-adjacent restoration, and external callers keep the safe default');
  assert.match(sync, /if \(updateFrustum\) \{[\s\S]*this\._updateCameraFrustum\(\);[\s\S]*\}/,
    'projection work is explicitly gated');

  const zoom = methodBody('zoomAt', 'panBy');
  assert.match(zoom, /this\._updateCameraFrustum\(\);/,
    'zoom applies its new projection before the cursor-anchor raycast');
  assert.match(zoom, /this\._syncOverlayFromPan\(false\);/,
    'zoom does not apply the same projection twice');

  for (const [name, next] of [
    ['panBy', 'panScreenAligned'],
    ['panScreenAligned', 'setPanFromDragDelta'],
    ['orbitBy', 'endFreeOrbit'],
  ]) {
    const body = methodBody(name, next);
    assert.match(body, /this\._syncOverlayFromPan\(false\);/,
      `${name} updates overlay bookkeeping without rebuilding the projection matrix`);
    assert.doesNotMatch(body, /this\._updateCameraFrustum\(\);/,
      `${name} does not directly update the projection matrix`);
  }
});

test('multi-ray camera gestures reuse one canvas bounds read', () => {
  const raycast = methodBody('_raycastGround', 'worldToScreen');
  assert.match(raycast, /_raycastGround\(screenX, screenY, screenRect = null\)/);
  assert.match(raycast, /this\._screenRay\(screenX, screenY, screenRect\)/,
    'ground raycasts forward caller-owned bounds');

  const screenRay = methodBody('_screenRay', '_syncOverlayFromPan');
  assert.match(screenRay,
    /const rect = screenRect \|\| this\.renderer\.domElement\.getBoundingClientRect\(\);/,
    'ordinary picks retain the safe live-bounds fallback');

  const zoom = methodBody('zoomAt', 'panBy');
  assert.equal((zoom.match(/getBoundingClientRect\(\)/g) || []).length, 1,
    'cursor-anchored zoom reads canvas bounds once');
  assert.equal((zoom.match(/_raycastGround\([^\n]*screenRect\)/g) || []).length, 2,
    'both zoom anchor raycasts share those bounds');

  const pan = methodBody('panBy', 'panScreenAligned');
  assert.equal((pan.match(/getBoundingClientRect\(\)/g) || []).length, 1,
    'drag panning reads canvas bounds once');
  assert.equal((pan.match(/_raycastGround\([^\n]*rect\)/g) || []).length, 2,
    'both pan mapping raycasts share those bounds');
});

test('camera motion selects the cheap render path and defers shadow refreshes', () => {
  const animate = methodBody('_animate', '_currentWorldDetail');
  assert.match(animate,
    /const cameraMoving = framePlan\.cameraMoving[\s\S]*this\._cameraMotionUntilMs;/,
    'the frame policy and pointer-event settle tail share one motion signal');
  assert.match(animate,
    /const deferShadows = framePlan\.deferShadows \|\| cameraMoving;/,
    'camera motion and GPU back-pressure share shadow deferral');
  assert.match(animate,
    /freezeAssignment: cameraMoving,[\s\S]*deferShadows,/,
    'fixture ranking and shadow refresh work are held during motion');
  assert.match(animate,
    /render\(\{ skipPostProcessing: cameraMoving \}\)/,
    'camera motion bypasses the expensive post-processing graph');
  const sun = methodBody('_updateSunCycle', 'hydrateDeferredAssets');
  assert.match(sun, /shadowRefreshPending[\s\S]*pendingCount/,
    'a deferred camera-following sun shadow is refreshed after motion settles');
  assert.match(sun,
    /!authoritativeChanged && !localTimeChanged && !panChanged && !shadowRefreshPending/,
    'paused worlds do not sleep through the settled shadow refresh');

  for (const [name, next] of [
    ['zoomAt', 'panBy'],
    ['panBy', 'panScreenAligned'],
    ['panScreenAligned', 'setPanFromDragDelta'],
    ['orbitBy', 'endFreeOrbit'],
  ]) {
    assert.match(methodBody(name, next), /this\._noteCameraMotion\(\);/,
      `${name} extends the motion-quality window`);
  }
});
