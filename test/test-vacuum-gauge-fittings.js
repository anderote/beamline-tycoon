// Geometry contract for gauges shared by beam-pipe and vacuum-run mounting.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const {
  _buildPiraniGaugeRoles,
  _buildColdCathodeGaugeRoles,
  _buildBAGaugeRoles,
} = await import('../src/renderer3d/builders/vacuum-builder.js');

const BUILDERS = [
  ['Pirani', _buildPiraniGaugeRoles],
  ['cold-cathode', _buildColdCathodeGaugeRoles],
  ['Bayard-Alpert', _buildBAGaugeRoles],
];

for (const [name, build] of BUILDERS) {
  test(`${name} gauge mounts through a vertical copper-gasketed CF flange`, () => {
    const roles = build();
    const copperRings = roles.copper.filter(geometry =>
      geometry instanceof THREE_NS.TorusGeometry);
    const verticalHardware = roles.iron.filter(geometry =>
      geometry instanceof THREE_NS.CylinderGeometry);
    const duplicatePipeSpans = roles.pipe.filter(geometry =>
      geometry instanceof THREE_NS.CylinderGeometry
        && Math.abs(geometry.parameters.height - 0.5) < 1e-9);
    assert.equal(copperRings.length, 1,
      'one exposed copper gasket is captured between the CF plates');
    assert.equal(verticalHardware.length, 8,
      'the removable joint carries the full eight-bolt pattern');
    assert.equal(duplicatePipeSpans.length, 0,
      'the instrument does not draw a second horizontal pipe over its host run');
  });
}
