import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_TILT_SHIFT_SETTINGS,
  normalizeTiltShiftSettings,
  parseTiltShiftSettings,
} from '../src/renderer3d/tilt-shift-settings.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('tilt-shift settings normalize malformed and out-of-range preferences', () => {
  assert.deepEqual(parseTiltShiftSettings('not json'), DEFAULT_TILT_SHIFT_SETTINGS);
  assert.deepEqual(normalizeTiltShiftSettings({
    enabled: true,
    strength: 99,
    focus: -1,
    band: '0.4',
  }), {
    enabled: true,
    strength: 2.5,
    focus: 0,
    band: 0.4,
  });
});

test('camera panel exposes angle, glow, and adjustable tilt-shift commands', () => {
  const html = read('../index.html');
  const hud = read('../src/ui/hud.js');
  const renderer = read('../src/renderer3d/ThreeRenderer.js');
  const main = read('../src/main.js');

  assert.match(html, /id="camera-settings-toggle"/);
  assert.doesNotMatch(html, /Perspective|data-camera-projection/,
    'the rejected perspective mode is absent from the panel');
  for (const setting of ['strength', 'focus', 'band']) {
    assert.match(html, new RegExp(`data-camera-tilt="${setting}"`));
  }
  assert.match(hud, /this\.renderer\.setViewMode\(button\.dataset\.cameraAngle\)/);
  assert.match(hud, /this\.renderer\.setGlowEnabled\(event\.target\.checked\)/);
  assert.match(hud, /this\.renderer\.setTiltShiftSettings\(\{ enabled: event\.target\.checked \}\)/);
  assert.match(renderer, /setTiltShiftSettings\(settings\)/);
  assert.match(renderer, /getCameraSettings\(\)[\s\S]*tiltShift:\s*this\.tiltShiftSettings/);
  assert.doesNotMatch(renderer, /PerspectiveCamera|setCameraProjection|cameraProjection/);
  assert.doesNotMatch(main, /cameraProjection/,
    'save restoration no longer retains the removed projection mode');
});
