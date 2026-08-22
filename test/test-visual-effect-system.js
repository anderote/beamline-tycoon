import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Three from 'three';

globalThis.THREE = Three;

const {
  prepareEffectPath, sampleEffectPath, surfaceGlowFactor, travellingPulseDistances,
} = await import('../src/renderer3d/effect-math.js');
const { VisualEffectSystem } = await import('../src/renderer3d/visual-effect-system.js');

test('effect path sampling and travelling crests are continuous and deterministic', () => {
  const path = prepareEffectPath([
    { x: 0, y: 0.5, z: 0 },
    { x: 4, y: 0.5, z: 0 },
    { x: 4, y: 0.5, z: 3 },
  ]);
  assert.equal(path.length, 7);
  assert.deepEqual(sampleEffectPath(path, 5), { x: 4, y: 0.5, z: 1 });
  assert.deepEqual(travellingPulseDistances(path.length, 3, 1, 0), [0, 3, 6]);
  assert.deepEqual(travellingPulseDistances(path.length, 3, 1, 1), [1, 4, 7]);
  assert.equal(surfaceGlowFactor('statusBlink', 'machine-a', 0.5),
    surfaceGlowFactor('statusBlink', 'machine-a', 0.5), 'machine phases are deterministic');
  assert.equal(surfaceGlowFactor('screen', 'machine-a', 0.5, 'off'), 0.06);
});

test('path effects render every crest in two instanced draws without creating lights', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 32, lightProxyBudget: 12 });
  system.syncScope('utilities', [{
    id: 'water-1', kind: 'pathPulse',
    path: [{ x: 0, y: 0.2, z: 0 }, { x: 10, y: 0.2, z: 0 }],
    color: '#4488ff', speed: 1, period: 5, radius: 0.1, groundRadius: 0.5,
    light: { intensity: 0.5, distance: 3, daylightFloor: 0.4 },
  }]);

  let pointLights = 0;
  scene.traverse((obj) => { if (obj.isPointLight) pointLights++; });
  assert.equal(pointLights, 0, 'the scalable effect layer itself allocates no THREE lights');

  system.update(0, 0);
  assert.equal(system._pulseMesh.count, 3, 'all three visible crests are instanced');
  assert.equal(system._spillMesh.count, 3, 'every crest gets matching projected spill');
  const pulseMatrix = new Three.Matrix4();
  const pulsePosition = new Three.Vector3();
  const pulseRotation = new Three.Quaternion();
  const pulseScale = new Three.Vector3();
  system._pulseMesh.getMatrixAt(0, pulseMatrix);
  pulseMatrix.decompose(pulsePosition, pulseRotation, pulseScale);
  assert.ok(Math.max(pulseScale.x, pulseScale.y, pulseScale.z)
      > Math.min(pulseScale.x, pulseScale.y, pulseScale.z) * 2,
    'a utility crest is an elongated traveling wave packet, not a flashing sphere');
  assert.equal(system.getStats().lightCandidates, 3,
    'moving proxies are merely candidates for the bounded physical-light pool');

  const proxyIdentities = system.lightEmitters.slice();
  const before = proxyIdentities.map((proxy) => proxy.position.x);
  system.update(0.25, 0);
  assert.deepEqual(system.lightEmitters, proxyIdentities,
    'proxy object identities remain fixed as effects animate');
  assert.notDeepEqual(proxyIdentities.map((proxy) => proxy.position.x), before,
    'the fixed proxies move with their associated crests');

  system.setQuality({ effectPulseCount: 1 });
  system.update(0.1, 0);
  assert.equal(system._pulseMesh.count, 1, 'quality parks visual instances above its budget');
  assert.ok(system.getStats().droppedPulses > 0);
  system.setEnabled(false);
  assert.equal(system._pulseMesh.count, 0);
  assert.equal(system.lightEmitters.some((proxy) => proxy.visible), false);
  system.dispose();
});

test('path effects can keep emissive crests and real-light proxies without floor circles', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 8, lightProxyBudget: 4 });
  system.syncScope('utilities', [{
    id: 'cable-1', kind: 'pathPulse', groundSpill: false,
    path: [{ x: 0, y: 0.1, z: 0 }, { x: 4, y: 0.1, z: 0 }],
    color: '#7788ff', speed: 1, period: 2, radius: 0.06,
    light: { intensity: 0.2, distance: 1.5 },
  }]);

  system.update(0, 1);
  assert.equal(system._pulseMesh.count, 3, 'traveling cable crests remain visible');
  assert.equal(system._spillMesh.count, 0, 'the cable contributes no circular floor decals');
  assert.ok(system.getStats().lightCandidates > 0,
    'bounded real-light proxies remain available for nearby surface response');
  system.dispose();
});

test('dense utility runs share the bounded light-proxy pool fairly', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 8, lightProxyBudget: 4 });
  const path = [{ x: 0, y: 0.1, z: 0 }, { x: 10, y: 0.1, z: 0 }];
  system.syncScope('utilities', [
    {
      id: 'power-old', kind: 'pathPulse', path, speed: 1, period: 1, crest: false,
      light: { intensity: 0.16, distance: 1.5 },
    },
    {
      id: 'hv-new', kind: 'pathPulse', path, speed: 1, period: 1, crest: false,
      light: { intensity: 0.28, distance: 2.05 },
    },
  ]);

  assert.deepEqual([...system._effects.values()].map((effect) => effect.proxyCount), [2, 2],
    'the older dense run cannot consume every candidate before the newer run gets one');
  system.update(0, 1);
  assert.equal(system.getStats().lightCandidates, 4);
  assert.ok(system.lightEmitters.some((proxy) => proxy.visible && proxy.position.x >= 5),
    'a reduced proxy allocation still spans the full run instead of bunching at its source');
  system.dispose();
});

test('path effects can keep moving light proxies without crest objects', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 8, lightProxyBudget: 4 });
  system.syncScope('utilities', [{
    id: 'vacuum-1', kind: 'pathPulse', crest: false, groundSpill: false,
    path: [{ x: 0, y: 0.5, z: 0 }, { x: 4, y: 0.5, z: 0 }],
    color: '#aebbc2', speed: 0.3, period: 2,
    light: { intensity: 0.055, distance: 0.9 },
  }]);

  system.update(0, 1);
  assert.equal(system._pulseMesh.count, 0, 'no travelling crest object is drawn');
  assert.equal(system._spillMesh.count, 0, 'no projected spill object is drawn');
  assert.ok(system.getStats().lightCandidates > 0,
    'moving light proxies remain available for nearby illumination');
  system.dispose();
});

test('path effects honor utility-specific silhouettes and can opt out of room light', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 8, lightProxyBudget: 4 });
  system.syncScope('utilities', [{
    id: 'fiber-1', kind: 'pathPulse', groundSpill: false,
    path: [{ x: 0, y: 0.1, z: 0 }, { x: 2, y: 0.1, z: 0 }],
    color: '#eeeeee', speed: 4, period: 4, radius: 0.1,
    radialScale: 0.4, lengthScale: 0.6, light: false,
  }]);

  system.update(0, 1);
  const matrix = new Three.Matrix4();
  const position = new Three.Vector3();
  const rotation = new Three.Quaternion();
  const scale = new Three.Vector3();
  system._pulseMesh.getMatrixAt(0, matrix);
  matrix.decompose(position, rotation, scale);
  assert.ok(Math.abs(scale.x - 0.04) < 1e-6 && Math.abs(scale.z - 0.06) < 1e-6,
    'the descriptor controls radial and longitudinal crest shape');
  assert.equal(system.getStats().lightCandidates, 0,
    'an informational utility can sparkle without casting room light');
  system.dispose();
});

test('utility ambient effects share one bounded instanced particle draw', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, {
    pulseBudget: 0, ambientBudget: 12, lightProxyBudget: 0,
  });
  system.syncScope('utilities', [
    {
      id: 'cryo-1', kind: 'ambientMist',
      path: [{ x: 0, y: 0.4, z: 0 }, { x: 6, y: 0.4, z: 0 }],
      spacing: 2, particlesPerEmitter: 2, cycle: 4,
    },
    {
      id: 'water-1', kind: 'ambientDrip',
      path: [{ x: 0, y: 1.2, z: 2 }, { x: 8, y: 1.2, z: 2 }],
      spacing: 2, cycle: 3, fallDuration: 0.8,
    },
  ]);

  system.update(0, 0);
  assert.equal(system._ambientMesh.count, 8,
    'mist sources along the pipe fit inside the shared ambient budget');
  assert.equal(system.getStats().ambientBudget, 12);
  assert.equal(system.group.children.filter(child => child.name === 'ambientUtilityParticleInstances').length, 1,
    'all mist and drips use one instanced mesh rather than per-particle scene objects');

  let sawDrip = false;
  for (let i = 0; i < 80 && !sawDrip; i++) {
    system.update(0.1, 0);
    if (system._ambientMesh.count <= 8) continue;
    const matrix = new Three.Matrix4();
    const position = new Three.Vector3();
    const rotation = new Three.Quaternion();
    const scale = new Three.Vector3();
    system._ambientMesh.getMatrixAt(8, matrix);
    matrix.decompose(position, rotation, scale);
    sawDrip = scale.y > scale.x * 1.5 && position.y >= 0.025;
  }
  assert.equal(sawDrip, true, 'occasional water particles fall as narrow vertical droplets');

  system.setQuality({ effectPulseCount: 4 });
  system.update(0.1, 0);
  assert.ok(system._ambientMesh.count <= 2,
    'lighting quality also bounds the ambient particle pool');
  system.dispose();
});

test('mist descriptors can spend most of their cycle fully dormant', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, {
    pulseBudget: 0, ambientBudget: 8, lightProxyBudget: 0,
  });
  system.syncScope('utilities', [{
    id: 'intermittent-cryo', kind: 'ambientMist',
    path: [{ x: 0, y: 0.4, z: 0 }, { x: 2, y: 0.4, z: 0 }],
    spacing: 10, particlesPerEmitter: 1, cycle: 1, activeFraction: 0.2,
  }]);

  const counts = [];
  for (let i = 0; i < 40; i++) {
    system.update(0.05, 0);
    counts.push(system._ambientMesh.count);
  }
  assert.ok(counts.some(count => count === 0),
    'the mist disappears between short condensation puffs');
  assert.ok(counts.some(count => count > 0),
    'the same deterministic cycle still produces visible mist');
  system.dispose();
});

test('surface glows animate independently while retaining shared shader structure', () => {
  const scene = new Three.Scene();
  const root = new Three.Group();
  const wrapper = new Three.Group();
  wrapper.userData.nodeId = 'pump-1';
  wrapper.userData.effectState = 'on';
  const source = new Three.MeshStandardMaterial({ emissive: 0x44ff66, emissiveIntensity: 2 });
  const mesh = new Three.Mesh(new Three.BoxGeometry(1, 1, 1), source);
  mesh.userData.role = 'glow';
  mesh.userData.effectProfile = 'statusBlink';
  wrapper.add(mesh);
  root.add(wrapper);
  scene.add(root);

  const system = new VisualEffectSystem(scene, { pulseBudget: 0, lightProxyBudget: 0 });
  system.syncSurfaceGlows('components', root);
  assert.notEqual(mesh.material, source, 'a placement receives its own animation material');
  const clone = mesh.material;
  system.update(0.1, 1);
  wrapper.userData.effectState = 'off';
  system.update(0.1, 1);
  assert.equal(clone.emissiveIntensity, source.emissiveIntensity * 0.06,
    'game-driven off state reaches the emissive surface');
  system.dispose();
  assert.equal(mesh.material, source, 'dispose restores the builder-owned shared material');
  mesh.geometry.dispose();
  source.dispose();
});

test('one-shot effects combine instanced visuals with an optional physical flash sink', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 8, lightProxyBudget: 0 });
  const flashes = [];
  system.setFlashHandler((...args) => { flashes.push(args); return 'pooled-light'; });
  const burst = system.emit({
    kind: 'burst', position: { x: 2, y: 1, z: 3 }, color: 0xff8844,
    intensity: 12, durationMs: 500,
  });
  assert.ok(burst);
  assert.equal(flashes.length, 1, 'the bounded physical-light backend receives one request');
  system.update(0.1, 1);
  assert.equal(system.getStats().bursts, 1);
  assert.equal(system._pulseMesh.count, 1, 'the burst itself is an instanced emissive visual');
  system.update(0.5, 1);
  assert.equal(system.getStats().bursts, 0, 'transient visuals expire without scene add/remove churn');
  system.dispose();
});

test('burst packets can form a flattened pressure wave', () => {
  const scene = new Three.Scene();
  const system = new VisualEffectSystem(scene, { pulseBudget: 4, lightProxyBudget: 0 });
  system.emit({
    kind: 'burst', position: { x: 0, y: 1, z: 0 }, durationMs: 500,
    radius: 1, horizontalScale: 1.8, verticalScale: 0.15,
    physicalLight: false, groundSpill: false,
  });
  system.update(0.1, 1);

  const matrix = new Three.Matrix4();
  const position = new Three.Vector3();
  const rotation = new Three.Quaternion();
  const scale = new Three.Vector3();
  system._pulseMesh.getMatrixAt(0, matrix);
  matrix.decompose(position, rotation, scale);
  assert.ok(scale.x > scale.y * 10 && Math.abs(scale.x - scale.z) < 1e-6,
    'horizontal and vertical burst scales produce a broad, flat visual packet');
  assert.equal(system._spillMesh.count, 0,
    'the pressure packet can omit the redundant floor spill');
  system.dispose();
});
