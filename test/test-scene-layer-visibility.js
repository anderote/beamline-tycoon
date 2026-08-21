import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SceneLayerVisibility,
  WORLD_LAYER_IDS,
  sceneLayerTargets,
} from '../src/renderer3d/scene-layer-visibility.js';

function object() { return { visible: true }; }

assert.deepEqual(WORLD_LAYER_IDS, [
  'lights', 'beamline', 'infra', 'facility', 'structure', 'grounds', 'staff',
]);

{
  const beamline = object();
  const infra = object();
  const fixture = object();
  const controller = new SceneLayerVisibility(() => [
    { layers: ['beamline'], object: beamline },
    { layers: ['infra'], object: infra },
    { layers: ['lights', 'grounds'], object: fixture },
  ]);

  assert.equal(controller.toggle('beamline'), false);
  assert.equal(beamline.visible, false);
  assert.equal(infra.visible, true, 'independent layers remain visible');
  assert.equal(controller.setVisible('lights', false), false);
  assert.equal(fixture.visible, false);
  controller.setVisible('lights', true);
  controller.setVisible('grounds', false);
  assert.equal(fixture.visible, false, 'multi-layer targets require every owner to be visible');
  assert.equal(controller.setVisible('unknown', false), null);

  const reset = controller.reset();
  assert.equal(Object.values(reset).every(Boolean), true);
  assert.equal(beamline.visible, true);
  assert.equal(fixture.visible, true);
}

{
  const renderer = {
    beamlineComponentGroup: object(),
    beamEffectGroup: object(),
    beamPipeGroup: object(),
    infrastructureComponentGroup: object(),
    connectionGroup: object(),
    utilityLineGroup: object(),
    utilityPortIssueGroup: object(),
    portFittingGroup: object(),
    facilityLayerGroup: object(),
    structureLayerGroup: object(),
    groundsLayerGroup: object(),
    staffPawns: { group: object() },
    lightPoolGroup: object(),
    lightHaloGroup: object(),
    volumetricLightGroup: object(),
    lightingGroup: [{ group: object() }],
  };
  const targets = sceneLayerTargets(renderer);
  const fixtureTarget = targets.at(-1);
  assert.deepEqual(fixtureTarget.layers, ['lights', 'grounds']);
  assert(targets.some(target => target.layers.includes('beamline')));
  assert(targets.some(target => target.layers.includes('infra')));
  assert(targets.some(target => target.layers.includes('staff')));
}

{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url), 'utf8');

  for (const id of WORLD_LAYER_IDS) {
    assert.match(html, new RegExp(`data-world-layer="${id}"`), `${id} has a HUD switch`);
  }
  assert.match(css, /#layer-visibility-control\s*\{[^}]*bottom:\s*calc\(var\(--hud-bottom-height\) \+ 8px\)[^}]*left:\s*12px/s,
    'layer control is anchored above the lower-left build bar');
  assert.match(hud, /this\.renderer\.toggleWorldLayer\(id\)/,
    'HUD delegates layer toggles through the renderer public API');
  assert.match(renderer, /obj\.parent === this\.beamlineComponentGroup/,
    'component picking recognizes the presentation subgroups');
}

console.log('scene layer visibility contract passed');
