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
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {},
          fillStyle: null,
        };
      },
    };
  },
};

const { COMPONENTS } = await import('../src/data/components.js');
const {
  buildPortFitting,
  buildPortFittings,
} = await import('../src/renderer3d/builders/port-fitting-builder.js');

const anchor = { x: 3, y: 1.2, z: -4, out: { x: 0, z: 1 }, standoff: 0.03 };

function arrowOf(fitting) {
  return fitting.children.find(child => child.userData?.isUtilityFlowArrow);
}

test('physical port arrows encode source, sink and passive flow roles', () => {
  const source = buildPortFitting(anchor, 'powerCable', 'source');
  const sink = buildPortFitting(anchor, 'powerCable', 'sink');
  const pass = buildPortFitting(anchor, 'powerCable', 'pass');

  assert.equal(arrowOf(source)?.userData.flowDirection, 1,
    'source arrow points outward along the fitting normal');
  assert.equal(arrowOf(sink)?.userData.flowDirection, -1,
    'sink arrow points inward against the fitting normal');
  assert.equal(arrowOf(pass)?.userData.flowDirection, 0,
    'pass-through fitting carries the double-headed arrow geometry');
  assert.notEqual(arrowOf(source).geometry, arrowOf(sink).geometry,
    'opposite roles use opposite authored arrowheads');
});

test('flow arrows stay faint, physical and attached to the fitting transform', () => {
  const fitting = buildPortFitting(anchor, 'hvCable', 'source');
  const arrow = arrowOf(fitting);
  assert.ok(arrow, 'the fitting owns one direction arrow child');
  assert.equal(arrow.parent, fitting, 'the arrow rotates and moves with its physical fitting');
  assert.equal(arrow.material.transparent, true);
  assert.ok(arrow.material.opacity > 0.2 && arrow.material.opacity < 0.5,
    `the arrow is visible but faint (opacity ${arrow.material.opacity})`);
  assert.equal(arrow.material.depthTest, true,
    'the arrow is occluded by equipment like real painted/illuminated hardware');
  assert.equal(arrow.material.depthWrite, false,
    'the translucent arrow does not punch holes in nearby connector geometry');
});

test('distribution-panel fittings inherit their declared in/out roles', () => {
  const endpoint = {
    id: 'panel-1', type: 'powerPanel',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const { group, count } = buildPortFittings([endpoint]);
  const declared = Object.entries(COMPONENTS.powerPanel.ports)
    .filter(([, spec]) => spec?.utility);

  assert.equal(count, declared.length);
  assert.equal(group.children.length, declared.length);
  for (const fitting of group.children) {
    const spec = COMPONENTS.powerPanel.ports[fitting.userData.portName];
    assert.equal(fitting.userData.placeableId, endpoint.id);
    assert.equal(fitting.userData.portRole, spec.role);
    assert.equal(arrowOf(fitting)?.userData.flowRole, spec.role,
      `${fitting.userData.portName} arrow follows its ${spec.role} port declaration`);
  }
  assert.equal(group.children.filter(f => f.userData.portRole === 'sink').length, 1,
    'the HV feeder is visibly the one input');
  assert.equal(group.children.filter(f => f.userData.portRole === 'source').length, 4,
    'the four branch circuits are visibly outputs');
});
