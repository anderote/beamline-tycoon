// test/test-schematic-icons.js — Beamline Designer schematic coverage for
// compound accelerators and sprite-family aliases.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

class FakeContext {
  constructor() {
    this.fillStyle = null;
    this.ops = [];
    this.imageSmoothingEnabled = true;
  }

  fillRect(x, y, w, h) {
    this.ops.push({ kind: 'fillRect', x, y, w, h, color: this.fillStyle });
  }

  clearRect() {}

  drawImage(source) {
    this.ops.push({ kind: 'drawImage', source });
  }

  createRadialGradient() {
    return { addColorStop() {} };
  }
}

class FakeCanvas {
  constructor(width = 70, height = 30) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.style = {};
    this._ctx = new FakeContext();
  }

  getContext() { return this._ctx; }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return new FakeCanvas();
    return { style: {} };
  },
};

const { COMPONENTS } = await import('../src/data/components.js');
const { UIHost } = await import('../src/ui/UIHost.js');
const { schematicDrawerKey } = await import('../src/ui/overlays.js');

test('compound accelerators have their own Designer schematic identities', () => {
  for (const id of [
    'vanDeGraaff', 'cockcroftWalton', 'cyclotron30', 'cyclotron70',
    'ecrIonSource', 'lwfaStation', 'industrialLinac',
  ]) {
    assert.equal(schematicDrawerKey(id), id, `${id} should not fall back to generic artwork`);
  }
});

test('spriteKey aliases resolve instead of leaving blank Designer cards', () => {
  assert.equal(schematicDrawerKey('penningIonSource'), 'ionSource');
  assert.equal(schematicDrawerKey('ellipticalSrfCavity'), 'rfCavity');
  assert.equal(schematicDrawerKey('protonLinacFrontEnd'), 'rfCavity');
  assert.equal(schematicDrawerKey('eBeamIrradiationVault'), 'target');
});

test('every Beamline Designer catalogue component resolves to artwork', () => {
  const beamlineCategories = new Set(['source', 'optics', 'rf', 'diagnostic', 'endpoint']);
  const missing = Object.entries(COMPONENTS)
    .filter(([, comp]) => beamlineCategories.has(comp.category))
    .filter(([id]) => !schematicDrawerKey(id))
    .map(([id]) => id);
  assert.deepEqual(missing, []);
});

test('requested machine schematics paint distinct hardware, not only the beam backdrop', () => {
  const ui = Object.create(UIHost.prototype);
  const fingerprints = new Map();

  for (const id of ['vanDeGraaff', 'industrialLinac']) {
    const canvas = new FakeCanvas(180, 40);
    ui.drawSchematic(canvas, id);
    const source = canvas._ctx.ops.find(op => op.kind === 'drawImage')?.source;
    assert.ok(source, `${id} should composite an offscreen schematic`);
    const colors = new Set(source._ctx.ops
      .filter(op => op.kind === 'fillRect' && op.color !== '#0a0a1a')
      .map(op => op.color));
    assert.ok(colors.size >= 8, `${id} should contain a detailed machine silhouette`);
    fingerprints.set(id, [...colors].sort().join(','));
  }

  assert.notEqual(
    fingerprints.get('vanDeGraaff'),
    fingerprints.get('industrialLinac'),
    'the two requested machines should not share generic artwork',
  );
});
