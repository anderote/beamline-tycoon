import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFloorWallModes,
  floorWallMode,
  previewSurfaceCorners,
  rememberFloorWallMode,
  storeyFramePlan,
} from '../src/renderer3d/storey-view.js';

let modes = createFloorWallModes();
assert.deepEqual(modes, ['transparent', 'transparent', 'transparent']);
modes = rememberFloorWallMode(modes, 1, 'down');
modes = rememberFloorWallMode(modes, 2, 'cutaway');
assert.equal(floorWallMode(modes, 0), 'transparent');
assert.equal(floorWallMode(modes, 1), 'down');
assert.equal(floorWallMode(modes, 2), 'cutaway');
assert.equal(floorWallMode(modes, 99), 'cutaway', 'floor wall lookup clamps to the three-storey contract');
assert.equal(floorWallMode(modes, 0), 'transparent', 'changing an upper floor leaves ground-floor walls alone');

assert.deepEqual(storeyFramePlan(1, false), [
  { level: 0, visible: true, ghosted: true, roofsVisible: false },
  { level: 1, visible: false, ghosted: false, roofsVisible: false },
  { level: 2, visible: false, ghosted: false, roofsVisible: false },
], 'selected-floor view ghosts only the storeys below it');

assert.deepEqual(storeyFramePlan(1, true), [
  { level: 0, visible: true, ghosted: false, roofsVisible: true },
  { level: 1, visible: false, ghosted: false, roofsVisible: false },
  { level: 2, visible: true, ghosted: false, roofsVisible: true },
], 'roof overview makes every non-active storey solid and roof-visible');

const slope = { nw: 0.1, ne: 0.4, se: -0.2, sw: 0.25 };
assert.deepEqual(previewSurfaceCorners(slope, 0), slope, 'ground previews follow terrain');
assert.deepEqual(previewSurfaceCorners(slope, 1), { nw: 0, ne: 0, se: 0, sw: 0 },
  'second-floor previews are planar within the raised preview group');
assert.deepEqual(previewSurfaceCorners(slope, 2), { nw: 0, ne: 0, se: 0, sw: 0 },
  'third-floor previews are planar within the raised preview group');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url), 'utf8');
const context = readFileSync(new URL('../src/renderer3d/lower-storey-presentation.js', import.meta.url), 'utf8');

assert.match(html, /data-wall-mode="roof"[^>]+Show all stories and roofs/,
  'the triangle describes the all-storeys roof overview');
assert.match(hud, /setStoreyWallMode\(btn\.dataset\.wallMode\)/,
  'wall buttons delegate to the storey visibility coordinator');
assert.match(renderer, /case 'activeLevelChanged':[\s\S]*?_refreshActiveLevel\(\)/,
  'floor switching uses the targeted active-level refresh');
assert.doesNotMatch(renderer.match(/ACTIVE_LEVEL_SNAPSHOT_SECTIONS[\s\S]*?\]\);/)?.[0] || '', /'terrain'|'cliffs'/,
  'floor switching does not rebuild full-map terrain or cliffs');
assert.doesNotMatch(context, /frames\.delete\(/,
  'built storey frames remain cached when the player changes floor');

console.log('storey view and cache contract tests passed');
