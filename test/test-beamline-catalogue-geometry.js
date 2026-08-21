// Catalogue contract for the beamline models that formerly reached the
// generic fallback renderer. These checks cover attachment-only hardware too,
// which is intentionally absent from the free-grid PLACEABLES inventory.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0, height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {}, fillStyle: null,
        };
      },
    };
  },
};

const { COMPONENTS } = await import('../src/data/components.js');
const {
  ComponentBuilder,
  componentPose,
  isDetailedComponent,
} = await import('../src/renderer3d/component-builder.js');
const { BeamPipeBuilder } = await import('../src/renderer3d/beam-pipe-builder.js');
const {
  BEAM_PIPE_RADIUS, BEAM_FLANGE_RADIUS, BEAM_FLANGE_WIDTH,
} = await import('../src/beamline/visual-geometry.js');
const { PLACEABLE_VISUAL_PROFILES } =
  await import('../src/renderer3d/placeable-visual-details.js');

const SOURCE_IDS = [
  'cyclotron30', 'cyclotron70', 'cyclotron230',
  'protonLinacFrontEnd', 'lwfaStation', 'positronSource',
];
const ROLE_SOURCE_IDS = [...SOURCE_IDS, 'vanDeGraaff', 'cockcroftWalton'];
const LEGACY_SOURCE_IDS = [
  'source', 'dcPhotoGun', 'ncRfGun', 'srfGun',
  'penningIonSource', 'ionSource', 'ecrIonSource',
];
const ALL_SOURCE_IDS = [...LEGACY_SOURCE_IDS, ...ROLE_SOURCE_IDS];
const OPTICS_IDS = [
  'injectionSeptum', 'combinedFunctionMagnet', 'chicane',
  'undulator', 'energyDegrader', 'scanningMagnet',
];
const ACCELERATOR_IDS = ['industrialLinac', 'dtl', 'cryomodule'];
const ALL_IDS = [...SOURCE_IDS, ...OPTICS_IDS, ...ACCELERATOR_IDS, 'collisionPoint'];
const STRAIGHT_THROUGH_IDS = [
  'combinedFunctionMagnet', 'chicane', 'undulator', 'energyDegrader',
  'scanningMagnet', ...ACCELERATOR_IDS, 'collisionPoint',
];

function visualFor(id) {
  const def = COMPONENTS[id];
  const wrapper = new ComponentBuilder().createObject(def, def.accentColor);
  return wrapper.children[0];
}

function role(visual, name) {
  return visual.children.find(child => child.isMesh && child.userData.role === name);
}

function geometryBox(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox;
}

test('all formerly generic beamline components use floor-origin dedicated builders', () => {
  for (const id of ALL_IDS) {
    const def = COMPONENTS[id];
    assert.ok(def, `${id} stays in the beamline catalogue`);
    assert.equal(isDetailedComponent(id, def), true,
      `${id} must bypass the generic fallback renderer`);
    assert.equal(PLACEABLE_VISUAL_PROFILES[id], undefined,
      `${id} must not retain an obsolete fallback profile`);

    const pose = componentPose(def, {
      col: 0, row: 0, subCol: 0, subRow: 0, direction: 0,
    }, true);
    assert.equal(pose.y, 0, `${id} owns its floor and beam-height offsets`);
  }
});

test('every new model exposes a complete mechanical material silhouette', () => {
  for (const id of ALL_IDS) {
    const roles = visualFor(id).children
      .filter(child => child.isMesh && child.userData.role)
      .map(child => child.userData.role)
      .sort();
    assert.deepEqual(roles, ['accent', 'copper', 'detail', 'iron', 'pipe', 'stand'],
      `${id} needs structure, working hardware, beam tube, supports, and fine detail`);
  }
});

test('new models sit on the floor and respect their authored footprints', () => {
  for (const id of ALL_IDS) {
    const def = COMPONENTS[id];
    const box = new THREE.Box3().setFromObject(visualFor(id));
    const size = box.getSize(new THREE.Vector3());
    assert.ok(box.min.y >= -1e-6, `${id} must not sink below the floor`);
    assert.ok(size.x <= def.subW * 0.5 + 0.06,
      `${id} must stay within its ${def.subW * 0.5} m width (${size.x} m)`);
    assert.ok(size.z <= def.subL * 0.5 + 0.10,
      `${id} may only overhang its ${def.subL * 0.5} m length by its flange thickness (${size.z} m)`);
    const hitboxTop = 1 + def.subH * 0.25;
    assert.ok(box.max.y <= hitboxTop + 0.06,
      `${id} must stay below its ${hitboxTop} m authored hitbox top (${box.max.y} m)`);
  }
});

test('beam tubes cross the shared one-metre axis and reach every physical beam port', () => {
  for (const id of ALL_IDS) {
    const pipeBox = geometryBox(role(visualFor(id), 'pipe'));
    assert.ok(pipeBox.min.y < 1 && pipeBox.max.y > 1,
      `${id} beam tube must straddle the shared 1 m axis`);
  }

  for (const id of SOURCE_IDS) {
    const def = COMPONENTS[id];
    const pipeBox = geometryBox(role(visualFor(id), 'pipe'));
    assert.ok(pipeBox.max.z >= def.subL * 0.25 - 1e-6,
      `${id} extraction tube must reach its +Z exit port`);
  }

  for (const id of STRAIGHT_THROUGH_IDS) {
    const def = COMPONENTS[id];
    const pipeBox = geometryBox(role(visualFor(id), 'pipe'));
    const halfLength = def.subL * 0.25;
    assert.ok(pipeBox.min.z <= -halfLength + 1e-6 && pipeBox.max.z >= halfLength - 1e-6,
      `${id} tube must reach both longitudinal beam ports`);
  }

  const septumPipe = geometryBox(role(visualFor('injectionSeptum'), 'pipe'));
  assert.ok(septumPipe.min.z <= -0.5 + 1e-6,
    'injectionSeptum injected channel must reach its rear port');
  assert.ok(septumPipe.min.x <= -0.5 + 1e-6 && septumPipe.max.x >= 0.5 - 1e-6,
    'injectionSeptum circulating channel must reach both side ports');
});

test('every source model carries a visible extraction tube to its authored exit', () => {
  const catalogueSources = Object.values(COMPONENTS)
    .filter(def => def.isSource)
    .map(def => def.id)
    .sort();
  assert.deepEqual([...ALL_SOURCE_IDS].sort(), catalogueSources,
    'the visual contract must name every source in the catalogue');

  for (const id of ALL_SOURCE_IDS) {
    const def = COMPONENTS[id];
    const visual = visualFor(id);
    const rolePipe = role(visual, 'pipe');
    let exitBox;
    if (rolePipe) {
      exitBox = geometryBox(rolePipe);
    } else {
      visual.updateMatrixWorld(true);
      exitBox = new THREE.Box3();
      visual.traverse((child) => {
        if (child.isMesh && child.userData.beamPortName === 'exit') {
          exitBox.union(new THREE.Box3().setFromObject(child));
        }
      });
    }
    assert.equal(exitBox.isEmpty(), false, `${id} must render an identifiable exit tube`);
    assert.ok(exitBox.min.y < 1 && exitBox.max.y > 1,
      `${id} extraction tube must straddle the shared 1 m beam axis`);
    assert.ok(exitBox.max.z >= def.subL * 0.25 - 1e-6,
      `${id} extraction tube must reach its +Z footprint-edge port`);
  }
});

test('standalone beam pipes use the same tube and flange dimensions as components', () => {
  const parent = new THREE.Group();
  const builder = new BeamPipeBuilder();
  builder.build({
    beamPipes: [{
      id: 'pipe',
      path: [{ col: 0, row: 0 }, { col: 0, row: 2 }],
      openStart: false,
      openEnd: false,
    }],
    moduleSubTiles: [],
  }, parent);

  const tube = parent.getObjectByName('beam-pipe-runs');
  const flange = parent.getObjectByName('beam-pipe-flanges');
  assert.equal(tube.geometry.parameters.radiusTop, BEAM_PIPE_RADIUS);
  assert.equal(tube.geometry.parameters.radiusBottom, BEAM_PIPE_RADIUS);
  assert.equal(flange.geometry.parameters.radiusTop, BEAM_FLANGE_RADIUS);
  assert.equal(flange.geometry.parameters.radiusBottom, BEAM_FLANGE_RADIUS);
  assert.equal(flange.geometry.parameters.height, BEAM_FLANGE_WIDTH);
  builder.dispose(parent);
});

test('the authored catalogue families retain their identifying geometry', () => {
  const cyclotronWidths = ['cyclotron30', 'cyclotron70', 'cyclotron230']
    .map(id => geometryBox(role(visualFor(id), 'iron')).getSize(new THREE.Vector3()).x);
  assert.ok(cyclotronWidths[0] < cyclotronWidths[1] && cyclotronWidths[1] < cyclotronWidths[2],
    'cyclotron yokes must visibly scale from 30 to 70 to 230 MeV');

  const chicanePipe = geometryBox(role(visualFor('chicane'), 'pipe')).getSize(new THREE.Vector3());
  assert.ok(chicanePipe.x > 0.45,
    'the chicane beam pipe must visibly leave and return to the reference orbit');

  const cryomodulePipe = role(visualFor('cryomodule'), 'pipe');
  assert.ok(cryomodulePipe.geometry.attributes.position.count > 1000,
    'the cryomodule must expose its multi-cell cavity string, not a plain tank');
});
