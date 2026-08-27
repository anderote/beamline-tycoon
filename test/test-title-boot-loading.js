// The welcome scene is intentionally elaborate, but it must never compete
// indefinitely with the renderer startup it is covering. Browser control is
// owner-only, so pin the lifecycle wiring at the source boundary as well as
// leaving visual timing for the owner-run smoke lane.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const title = readFileSync(new URL('../src/ui/TitleScreen.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const renderer = readFileSync(
  new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url),
  'utf8',
);

test('the welcome animation yields the main thread while boot is pending', () => {
  assert.match(title, /this\._bootPending = true;/);
  assert.match(title, /now - this\._lastBootFrameAt < 1000 \/ 12/,
    'the expensive display-resolution warp is capped during boot');
  assert.match(title,
    /if \(this\._waitingForBootAfterClick\) \{\s*this\._raf = requestAnimationFrame\(loop\);\s*return;/,
    'the warp is frozen after the player enters the loading state');
  assert.match(title, /ready\(cfg\) \{[\s\S]*this\._bootPending = false;/,
    'normal title animation resumes when startup is complete');
});

test('loading presents one named phase instead of duplicate labels', () => {
  assert.match(title, /this\.loadingSubEl\?\.classList\.add\('hidden'\)/);
  assert.doesNotMatch(title, /textContent = 'loading\.\.\.'/);
  for (const phase of [
    'Starting 3D...',
    'Indexing UI...',
    'Restoring facility...',
    'Finalizing...',
  ]) {
    assert.ok(main.includes(`setLoadingStatus('${phase}')`), `${phase} is reported`);
  }
});

test('optional decoration textures do not block TitleScreen.ready', () => {
  const initStart = renderer.indexOf('  async init() {');
  const initEnd = renderer.indexOf('\n  // --- Coordinate conversion', initStart);
  const initBody = renderer.slice(initStart, initEnd);
  assert.doesNotMatch(initBody, /loadDecorationManifest|hydrateDeferredAssets/);

  const readyAt = main.indexOf('    titleScreen.ready({');
  const hydrateAt = main.indexOf('renderer.hydrateDeferredAssets()');
  assert.ok(readyAt >= 0 && hydrateAt > readyAt,
    'deferred texture hydration starts only after the title gate is usable');
  assert.match(renderer,
    /async hydrateDeferredAssets\(\) \{[\s\S]*loadDecorationManifest\(\)[\s\S]*this\._refreshDecorations\(\)/,
    'hydration refreshes only the owning decoration section');
});

test('the opaque title gate suspends hidden 3D frame submission', () => {
  assert.match(main, /renderer\.setRenderingSuspended\(true\)/,
    'main suspends the world renderer before any startup world replacement');
  assert.match(renderer,
    /if \(this\.renderingSuspended\) \{[\s\S]*this\._lastAnimTime = performance\.now\(\);[\s\S]*return;/,
    'the animation loop yields before hidden world and GPU work');
  assert.match(main,
    /titleScreen\.dismiss = \(\.\.\.args\) => \{[\s\S]*deferredPresentationReady[\s\S]*renderer\.prepareInteractiveLod\(\)[\s\S]*renderer\.setRenderingSuspended\(false\);/,
    'both LOD sides finish warming before the title releases the world');
  assert.match(main, /renderer\.renderPreparedWorldFrame\(\)/,
    'native WebGPU submits one prepared final-world frame behind the title');
});

test('hosted Python physics does not start on the first playable frame', () => {
  assert.match(main, /createDeferredPhysicsStart\(startPhysics\)/);
  assert.match(main,
    /renderer\.setRenderingSuspended\(false\);\s*deferredPhysicsStart\.schedule\(\);/,
    'Continue resumes rendering before scheduling the heavy worker warmup');
  assert.doesNotMatch(main, /renderer\.setRenderingSuspended\(false\);\s*startPhysics\(\);/,
    'the 30 MB Pyodide load never competes with the first interactive frame');
});
