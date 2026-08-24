import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CAMERA_PROJECTION_ISOMETRIC,
  CAMERA_PROJECTION_PERSPECTIVE,
  PERSPECTIVE_FOV_DEGREES,
  normalizeCameraProjection,
  perspectiveDistanceForViewHeight,
} from '../src/renderer3d/camera-projection.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('perspective framing preserves the orthographic visible height at target', () => {
  const viewHeight = 42;
  const distance = perspectiveDistanceForViewHeight(viewHeight);
  const reconstructed = 2 * distance * Math.tan((PERSPECTIVE_FOV_DEGREES * Math.PI) / 360);
  assert.ok(Math.abs(reconstructed - viewHeight) < 1e-9);
  assert.equal(normalizeCameraProjection(CAMERA_PROJECTION_PERSPECTIVE), CAMERA_PROJECTION_PERSPECTIVE);
  assert.equal(normalizeCameraProjection('unknown'), CAMERA_PROJECTION_ISOMETRIC);
});

test('camera panel exposes real projection, angle, and effects commands', () => {
  const html = read('../index.html');
  const hud = read('../src/ui/hud.js');
  const renderer = read('../src/renderer3d/ThreeRenderer.js');
  const main = read('../src/main.js');

  assert.match(html, /id="camera-settings-toggle"/);
  assert.match(html, /data-camera-projection="isometric"[^>]*>Isometric</);
  assert.match(html, /data-camera-projection="perspective"[^>]*>Perspective</);
  assert.match(hud, /this\.renderer\.setCameraProjection\(button\.dataset\.cameraProjection\)/);
  assert.match(hud, /this\.renderer\.setViewMode\(button\.dataset\.cameraAngle\)/);
  assert.match(hud, /this\.renderer\.setGlowEnabled\(event\.target\.checked\)/);
  assert.match(renderer, /setCameraProjection\(projection\)/);
  assert.match(renderer, /getCameraSettings\(\)[\s\S]*glowEnabled:\s*this\.glowEnabled/,
    'camera settings read the renderer glow state during startup');
  assert.doesNotMatch(renderer, /this\.isGlowEnabled\(\)/,
    'camera settings do not call an undefined glow method');
  assert.match(main, /cameraProjection: renderer\.cameraProjection/);
  assert.match(main, /renderer\.setCameraProjection\(restoredView\.cameraProjection\)/);
});
