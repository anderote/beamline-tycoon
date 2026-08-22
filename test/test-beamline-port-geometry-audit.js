// test/test-beamline-port-geometry-audit.js
//
// Contract boundary between the beamline catalogue and presentation geometry.
// Every utility sink is either pinned to defining visible hardware (RF/cryo)
// or deliberately terminates in the utility-specific fitting generated on the
// measured shell (power/HV, cooling, vacuum, data). Nothing may silently join
// the catalogue as an unreviewed generic dot.

import assert from 'node:assert/strict';
import test from 'node:test';
import { BEAMLINE_COMPONENTS_RAW } from '../src/data/beamline-components.raw.js';
import { COMPONENTS } from '../src/data/components.js';
import {
  PORT_GEOMETRY_CLASS,
  portAnchorOverride,
  portGeometryClassification,
} from '../src/data/utility-port-anchors.js';

const beamlinePorts = Object.keys(BEAMLINE_COMPONENTS_RAW).flatMap((type) => {
  const def = COMPONENTS[type];
  return Object.entries(def?.ports || {})
    .filter(([, spec]) => spec?.utility)
    .map(([portName, spec]) => ({ type, portName, spec }));
});

test('every beamline utility port has an intentional geometry classification', () => {
  const unreviewed = beamlinePorts.filter(({ type, portName, spec }) =>
    portGeometryClassification(type, portName, spec) === PORT_GEOMETRY_CLASS.UNREVIEWED);
  assert.equal(beamlinePorts.length, 272, 'audit population changes loudly with catalogue growth');
  assert.deepEqual(unreviewed.map(p => `${p.type}.${p.portName}`), []);
});

test('every RF and cryogenic sink is pinned to exact visible hardware', () => {
  const defining = beamlinePorts.filter(({ spec }) =>
    spec.utility === 'rfWaveguide' || spec.utility === 'cryoTransfer');
  assert.equal(defining.length, 41);
  for (const { type, portName, spec } of defining) {
    assert.equal(
      portGeometryClassification(type, portName, spec),
      PORT_GEOMETRY_CLASS.EXPLICIT_HARDWARE,
      `${type}.${portName}`,
    );
    const mount = portAnchorOverride(type, portName);
    assert.ok(Number.isFinite(mount.y), `${type}.${portName} has exact height`);
  }
});

test('remaining beamline services intentionally generate utility-specific terminals', () => {
  const generated = beamlinePorts.filter(({ spec }) =>
    spec.utility !== 'rfWaveguide' && spec.utility !== 'cryoTransfer');
  assert.equal(generated.length, 231);
  for (const { type, portName, spec } of generated) {
    assert.equal(
      portGeometryClassification(type, portName, spec),
      PORT_GEOMETRY_CLASS.GENERATED_HARDWARE,
      `${type}.${portName}`,
    );
  }
});

test('generated vacuum, cooling and data fittings use their physical service bands', () => {
  for (const { type, portName, spec } of beamlinePorts) {
    const mount = portAnchorOverride(type, portName);
    if (spec.utility === 'vacuumPipe') {
      assert.equal(mount?.y, 1.0, `${type}.${portName} meets the beam chamber axis`);
    } else if (spec.utility === 'coolingWater') {
      assert.ok(mount?.y >= 0.5 && mount?.y <= 0.8,
        `${type}.${portName} remains on the low cooling manifold`);
    } else if (spec.utility === 'dataFiber') {
      assert.ok(mount?.y >= 1.0 && mount?.y <= 1.5,
        `${type}.${portName} remains on the instrumentation head`);
    }
  }
});

test('the complete component registry contains no unreviewed utility geometry', () => {
  const allPorts = Object.entries(COMPONENTS).flatMap(([type, def]) =>
    Object.entries(def?.ports || {})
      .filter(([, spec]) => spec?.utility)
      .map(([portName, spec]) => ({ type, portName, spec })));
  assert.equal(allPorts.length, 610, 'registry audit population changes loudly');
  const unreviewed = allPorts.filter(({ type, portName, spec }) =>
    portGeometryClassification(type, portName, spec) === PORT_GEOMETRY_CLASS.UNREVIEWED);
  assert.deepEqual(unreviewed.map(p => `${p.type}.${p.portName}`), []);
});

test('cryogenic plant outlets and valve-box branches use exact visible bayonets', () => {
  const expected = {
    'coldBox4K.cryo_out': [0.49, 0.62, 1.32, 1, 0, 0],
    'coldBox2K.cryo_out': [0.15, 0.78, 0.95, 1, 0, 0],
    'cryoValveBox.bus_back': [-0.20, 0.50, -0.74, 0, 0, -1],
    'cryoValveBox.bus_front': [0.20, 0.50, 0.74, 0, 0, 1],
    'cryoValveBox.bus_left': [-0.495, 0.36, -0.30, -1, 0, 0],
    'cryoValveBox.bus_right': [0.495, 0.36, 0.30, 1, 0, 0],
  };
  for (const [key, values] of Object.entries(expected)) {
    const [type, portName] = key.split('.');
    const mount = portAnchorOverride(type, portName);
    assert.deepEqual(
      [mount.localX, mount.y, mount.localZ,
        mount.normal.x, mount.normal.y, mount.normal.z],
      values,
      key,
    );
    assert.equal(
      portGeometryClassification(type, portName, COMPONENTS[type].ports[portName]),
      PORT_GEOMETRY_CLASS.EXPLICIT_HARDWARE,
      `${key} is protected as defining geometry`,
    );
  }
});
