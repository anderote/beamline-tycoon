import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SceneLayerVisibility,
  WORLD_LAYER_IDS,
  sceneLayerTargets,
} from '../src/renderer3d/scene-layer-visibility.js';

function object() { return { visible: true }; }

assert.deepEqual(WORLD_LAYER_IDS, [
  'lights', 'zoneLabels', 'beamline', 'infra', 'facility', 'structure', 'grounds', 'staff',
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
    pipeAttachmentGroup: object(),
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
    lowerStoreyPresentation: {
      beamlineGroups: [object(), object()],
      infrastructureGroups: [object()],
    },
    _zoneLabelMeshes: [object(), object()],
    lightingGroup: [{ group: object() }],
  };
  const targets = sceneLayerTargets(renderer);
  const fixtureTarget = targets.at(-1);
  assert.deepEqual(fixtureTarget.layers, ['lights', 'grounds']);
  assert(targets.some(target => target.layers.includes('beamline')));
  assert(targets.some(target => target.layers.includes('infra')));
  assert(targets.some(target => target.layers.includes('staff')));
  assert.equal(targets.filter(target => target.layers.includes('zoneLabels')).length, 2,
    'each floor-painted zone label is independently controlled');

  const controller = new SceneLayerVisibility(() => sceneLayerTargets(renderer));
  controller.setVisible('beamline', false);
  for (const group of [
    renderer.beamlineComponentGroup,
    renderer.beamEffectGroup,
    renderer.beamPipeGroup,
    renderer.pipeAttachmentGroup,
  ]) {
    assert.equal(group.visible, false, 'every beamline-owned render group is hidden');
  }
  assert.equal(renderer.infrastructureComponentGroup.visible, true,
    'beamline visibility does not affect infrastructure hardware');
  assert(renderer.lowerStoreyPresentation.beamlineGroups.every(group => group.visible === false),
    'lower-storey beamline context follows the beamline layer switch');
  controller.setVisible('infra', false);
  assert(renderer.lowerStoreyPresentation.infrastructureGroups.every(group => group.visible === false),
    'lower-storey infrastructure context follows the infrastructure layer switch');
  controller.setVisible('zoneLabels', false);
  assert(renderer._zoneLabelMeshes.every(label => label.visible === false),
    'zone label visibility leaves the rest of the zone overlay untouched');
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
  assert.match(hud, /if \(opening\)[\s\S]*isWorldLayerVisible\(button\.dataset\.worldLayer\)/,
    'opening the panel refreshes switches changed by shortcuts or Options');
  assert.match(renderer, /obj\.parent === this\.beamlineComponentGroup/,
    'component picking recognizes the presentation subgroups');
  assert.match(renderer, /toggleZoneLabels\(\)\s*\{\s*return this\.toggleWorldLayer\('zoneLabels'\)/,
    'the layer panel, keyboard shortcut, and options dialog share one zone-label state');
}

console.log('scene layer visibility contract passed');
