// Authored secondary geometry for placeables that used to render as a lone
// fallback box.  The fallback housing remains in place (including its decal
// faces); these details give it a legible physical silhouette and a clear
// operating face without duplicating a separate renderer for every SKU.
// THREE is a CDN global — do NOT import it.

import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs, applyTiledCylinderUVs } from './uv-utils.js';
import { configureGlowMesh, getGlowMaterial } from './machine-glow.js';

// This is deliberately an inventory, not a heuristic.  Adding a new generic
// box to the catalogue means it is visible here during art review.
export const PLACEABLE_VISUAL_PROFILES = Object.freeze({
  // Beamline modules without a dedicated role builder.
  cyclotron30: 'cyclotron', cyclotron70: 'cyclotron', cyclotron230: 'cyclotron',
  lwfaStation: 'laserBay', positronSource: 'targetStation',
  injectionSeptum: 'magnet', combinedFunctionMagnet: 'magnet',
  industrialLinac: 'linac', protonLinacFrontEnd: 'linac',
  cryomodule: 'cryomodule', collisionPoint: 'collision',

  // Infrastructure modules without a dedicated role builder.
  bakeoutSystem: 'cabinet',
  rackIoc: 'rack', ppsInterlock: 'rack', mps: 'rack', timingSystem: 'rack',
  patchPanel: 'rack', networkSwitch: 'rack', fiberBus: 'rack', blmReadout: 'rack',
  bpmElectronics: 'rack', archiver: 'rack', searchSecure: 'rack', accessControl: 'rack',
  areaMonitor: 'areaMonitor',
  shielding: 'shieldedCell', targetHandling: 'handling', beamDump: 'dump',
  radWasteStorage: 'storage', laserSystem: 'laserBay', petawattLaser: 'laserBay',
  powerPanel: 'cabinet', powerBus: 'powerBus', spiderBox: 'powerBus',
  waterTank: 'storage', facilityWaterSupply: 'pump', bulkWaterTank: 'storage',

  // Office furnishings that had no parts list.
  whiteboard: 'whiteboard', whiteboardLarge: 'whiteboard', coffeeMachine: 'coffeeMachine',
  projector: 'projector', phoneUnit: 'phone',
  dataAppliance: 'rack', dataStorageRack: 'rack',
  cpuComputeRack: 'rack', gpuComputeRack: 'rack',

  // Lab and shop equipment that had no parts list.
  oscilloscope: 'benchInstrument', signalGenerator: 'benchInstrument',
  spectrumAnalyzer: 'benchInstrument', networkAnalyzer: 'benchInstrument',
  coolantPump: 'pump', heatExchanger: 'heatExchanger', pipeRack: 'pipeRack',
  chillerUnit: 'chiller', flowMeter: 'meter', testChamber: 'chamber',
  leakDetector: 'benchInstrument', pumpCart: 'pumpCart', gasManifold: 'manifold',
  rga: 'rackInstrument', laserAlignment: 'opticalTable', mirrorMount: 'opticalInstrument',
  beamProfiler: 'opticalInstrument', interferometer: 'opticalInstrument',
  photodetector: 'opticalInstrument', polarizer: 'opticalInstrument',
  fiberCoupler: 'opticalInstrument', opticalChopper: 'opticalInstrument',
  powerMeter: 'opticalInstrument', spatialFilter: 'opticalInstrument',
  scopeStation: 'scopeStation', wireScannerBench: 'benchFixture',
  bpmTestFixture: 'benchFixture', serverCluster: 'rack',
});

export function hasPlaceableVisualDetails(id) {
  return Object.prototype.hasOwnProperty.call(PLACEABLE_VISUAL_PROFILES, id);
}

const _materials = new Map();

function material(style, color) {
  const texture = {
    dark: 'metal_dark', brushed: 'metal_brushed', painted: 'metal_painted_white',
    copper: 'copper', concrete: 'concrete',
  }[style] || null;
  const key = `${style}|${color.toString(16)}`;
  let out = _materials.get(key);
  if (out) return out;
  out = new THREE.MeshStandardMaterial({
    map: texture && MATERIALS[texture] ? MATERIALS[texture].map : null,
    color,
    roughness: style === 'glass' ? 0.22 : 0.58,
    metalness: style === 'painted' || style === 'concrete' ? 0.08 : 0.45,
  });
  _materials.set(key, out);
  return out;
}

/**
 * Build secondary geometry around a fallback box.
 *
 * Coordinates are relative to the fallback housing centre.  Callers retain
 * ownership of the housing itself, which is important because it carries
 * authored per-face decals and is shared by live, ghost and thumbnail paths.
 */
export function buildPlaceableVisualDetails(compDef, { width, height, length, color }) {
  const profile = PLACEABLE_VISUAL_PROFILES[compDef?.id];
  if (!profile || typeof THREE === 'undefined') return null;

  const group = new THREE.Group();
  const paint = material('painted', color ?? 0x778899);
  const dark = material('dark', 0x26313a);
  const steel = material('brushed', 0xaeb9c0);
  const copper = material('copper', 0xb87333);
  const warning = material('painted', 0xd69a24);

  const add = (geo, mat, x = 0, y = 0, z = 0, rot = null) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const box = (w, h, l, mat, x = 0, y = 0, z = 0) => {
    const geo = new THREE.BoxGeometry(w, h, l);
    applyTiledBoxUVs(geo, w, h, l);
    return add(geo, mat, x, y, z);
  };
  const cyl = (r, h, mat, x = 0, y = 0, z = 0, axis = 'y') => {
    const geo = new THREE.CylinderGeometry(r, r, h, 12);
    applyTiledCylinderUVs(geo, r, h, 12);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    return add(geo, mat, x, y, z);
  };
  const torus = (major, tube, mat, x = 0, y = 0, z = 0, rot = null) =>
    add(new THREE.TorusGeometry(major, tube, 8, 16), mat, x, y, z, rot);
  const sphere = (r, mat, x = 0, y = 0, z = 0) =>
    add(new THREE.SphereGeometry(r, 12, 8), mat, x, y, z);
  let hasPhysicalGlow = false;
  const glowOptions = (profile, light) => {
    if (!light || hasPhysicalGlow) return { profile, light: false };
    hasPhysicalGlow = true;
    return { profile, light };
  };
  const glowMaterial = (colorHex) => getGlowMaterial(`${compDef.id}:details`, colorHex);
  const glowBox = (w, h, l, colorHex, x = 0, y = 0, z = 0, profile = 'steady', light = null) => {
    const mesh = box(w, h, l, glowMaterial(colorHex), x, y, z);
    return configureGlowMesh(mesh, glowOptions(profile, light));
  };
  const glowCyl = (r, h, colorHex, x = 0, y = 0, z = 0, axis = 'y', profile = 'steady', light = null) => {
    const mesh = cyl(r, h, glowMaterial(colorHex), x, y, z, axis);
    return configureGlowMesh(mesh, glowOptions(profile, light));
  };
  const glowSphere = (r, colorHex, x = 0, y = 0, z = 0, profile = 'statusBlink', light = null) => {
    const mesh = sphere(r, glowMaterial(colorHex), x, y, z);
    return configureGlowMesh(mesh, glowOptions(profile, light));
  };
  const front = length / 2 + 0.015;
  const bottom = -height / 2;
  const top = height / 2;
  const inset = Math.min(width, length) * 0.09;
  const indicatorR = Math.max(0.012, Math.min(width, height, length) * 0.035);
  const SCREEN_LIGHT = { intensity: 0.24, distance: 1.7, daylightFloor: 0.18 };
  const STATUS_LIGHT = { intensity: 0.09, distance: 0.9, daylightFloor: 0.1 };
  const WARNING_LIGHT = { intensity: 0.18, distance: 1.3, daylightFloor: 0.12 };
  const feet = () => {
    for (const x of [-width * 0.34, width * 0.34]) {
      for (const z of [-length * 0.34, length * 0.34]) cyl(Math.min(width, length) * 0.055, 0.06, dark, x, bottom - 0.025, z);
    }
  };
  const frontRail = () => {
    box(width - inset * 2, 0.035, 0.04, steel, 0, top - 0.06, front);
    box(width - inset * 2, 0.035, 0.04, steel, 0, bottom + 0.08, front);
    box(0.035, height - 0.18, 0.04, steel, -width / 2 + inset, 0, front);
    box(0.035, height - 0.18, 0.04, steel, width / 2 - inset, 0, front);
  };
  const frontKnobs = (count = 3) => {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * Math.min(width * 0.18, 0.16);
      cyl(Math.min(width, height) * 0.055, 0.035, warning, x, -height * 0.12, front + 0.02, 'z');
    }
  };

  switch (profile) {
    case 'rack':
    case 'rackInstrument': {
      feet(); frontRail();
      const bays = Math.max(3, Math.min(8, Math.round(height / 0.25)));
      for (let i = 0; i < bays; i++) {
        const y = bottom + 0.16 + (i + 0.5) * ((height - 0.30) / bays);
        box(width * 0.72, 0.025, 0.045, dark, 0, y, front + 0.015);
        const colorHex = i % 5 === 3 ? 0xffaa40 : (i % 4 === 2 ? 0x44ddff : 0x44ff66);
        glowBox(0.04, 0.04, 0.05, colorHex, width * 0.29, y, front + 0.025,
          'statusBlink', STATUS_LIGHT);
      }
      break;
    }
    case 'cabinet': {
      feet(); frontRail();
      box(0.035, height - 0.22, 0.05, dark, 0, 0, front + 0.02);
      for (const x of [-width * 0.18, width * 0.18]) box(0.035, height * 0.28, 0.06, steel, x, -height * 0.1, front + 0.035);
      for (let i = 0; i < 5; i++) box(width * 0.42, 0.018, 0.04, dark, -width * 0.22, top * 0.35 - i * 0.055, front + 0.025);
      for (let i = 0; i < 3; i++) glowSphere(indicatorR, i === 2 ? 0xffaa40 : 0x44ff66,
        width * (0.16 + i * 0.08), top * 0.48, front + 0.07, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'benchInstrument': {
      feet();
      box(width * 0.83, height * 0.56, 0.035, dark, -width * 0.09, height * 0.08, front + 0.02);
      glowBox(width * 0.24, height * 0.34, 0.045, 0x28bce8,
        width * 0.24, height * 0.10, front + 0.03, 'screen', SCREEN_LIGHT);
      glowBox(width * 0.19, Math.max(0.008, height * 0.018), 0.012, 0x66ff99,
        width * 0.24, height * 0.13, front + 0.061, 'screen');
      frontKnobs(3);
      for (let i = 0; i < 3; i++) glowBox(0.012, height * 0.055, 0.012, 0xffc04a,
        (i - 1) * Math.min(width * 0.18, 0.16), -height * 0.08, front + 0.06);
      break;
    }
    case 'pump': {
      box(width * 0.9, 0.10, length * 0.68, dark, 0, bottom - 0.02, 0);
      cyl(Math.min(width, height) * 0.28, width * 0.62, paint, 0, bottom + height * 0.18, -length * 0.08, 'x');
      cyl(Math.min(width, height) * 0.16, width * 0.32, dark, 0, bottom + height * 0.18, length * 0.23, 'x');
      cyl(Math.min(width, length) * 0.08, height * 0.32, steel, width * 0.29, bottom + height * 0.35, -length * 0.18);
      glowSphere(indicatorR, 0x44ff66, width * 0.29, bottom + height * 0.53,
        front + 0.025, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'heatExchanger': {
      feet();
      for (const x of [-width * 0.32, width * 0.32]) cyl(Math.min(width, height) * 0.15, length * 0.82, steel, x, height * 0.06, 0, 'z');
      for (const y of [-height * 0.18, height * 0.18]) box(width * 0.78, 0.035, length * 0.86, copper, 0, y, 0);
      break;
    }
    case 'manifold': {
      cyl(Math.min(width, height) * 0.11, length * 0.84, steel, 0, 0, 0, 'z');
      for (const z of [-length * 0.26, 0, length * 0.26]) {
        cyl(Math.min(width, height) * 0.07, height * 0.58, copper, 0, height * 0.25, z);
        torus(Math.min(width, height) * 0.12, 0.025, warning, 0, height * 0.45, z, [Math.PI / 2, 0, 0]);
      }
      break;
    }
    case 'pipeRack': {
      for (const x of [-width * 0.28, width * 0.28]) {
        box(0.06, height * 0.82, 0.06, dark, x, bottom + height * 0.41, 0);
        for (const y of [-height * 0.15, height * 0.20]) cyl(0.055, length * 0.88, steel, x, y, 0, 'z');
      }
      break;
    }
    case 'chiller': {
      feet();
      for (const x of [-width * 0.24, width * 0.24]) {
        cyl(Math.min(width, length) * 0.18, 0.06, dark, x, top + 0.02, 0);
        torus(Math.min(width, length) * 0.12, 0.018, steel, x, top + 0.055, 0);
      }
      for (let i = 0; i < 6; i++) box(width * 0.58, 0.018, 0.04, dark, 0, -height * 0.15 + i * 0.05, front + 0.02);
      glowBox(width * 0.18, height * 0.09, 0.035, 0x36c8ef,
        width * 0.24, height * 0.23, front + 0.045, 'screen', SCREEN_LIGHT);
      glowSphere(indicatorR, 0x44ff66, width * 0.37, height * 0.23,
        front + 0.065, 'statusBlink');
      break;
    }
    case 'meter': {
      cyl(Math.min(width, height) * 0.32, 0.09, steel, 0, 0, front + 0.035, 'z');
      glowCyl(Math.min(width, height) * 0.25, 0.10, 0x79d9e8,
        0, 0, front + 0.085, 'z', 'steady', SCREEN_LIGHT);
      {
        const needle = box(0.018, Math.min(width, height) * 0.19, 0.018, warning,
          0, Math.min(width, height) * 0.065, front + 0.145);
        needle.rotation.z = -0.72;
      }
      glowSphere(indicatorR * 0.68, 0xffaa40,
        Math.min(width, height) * 0.18, -Math.min(width, height) * 0.16,
        front + 0.15, 'statusBlink');
      break;
    }
    case 'chamber': {
      feet();
      cyl(Math.min(width, length) * 0.28, height * 0.46, steel, 0, top + height * 0.12, 0);
      for (const x of [-width * 0.28, width * 0.28]) cyl(Math.min(width, height) * 0.10, width * 0.24, dark, x, height * 0.12, 0, 'x');
      glowSphere(indicatorR, 0x44ff66, width * 0.3, height * 0.25,
        front + 0.03, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'pumpCart': {
      box(width * 0.88, 0.08, length * 0.78, dark, 0, bottom - 0.01, 0);
      for (const x of [-width * 0.36, width * 0.36]) for (const z of [-length * 0.30, length * 0.30]) cyl(0.08, 0.05, dark, x, bottom - 0.09, z, 'x');
      cyl(Math.min(width, height) * 0.20, width * 0.55, paint, 0, bottom + height * 0.22, 0, 'x');
      box(0.05, height * 0.55, 0.05, steel, -width * 0.36, height * 0.14, -length * 0.30);
      glowSphere(indicatorR, 0x44ff66, width * 0.25, bottom + height * 0.48,
        front + 0.03, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'opticalTable': {
      feet();
      box(width * 0.92, 0.07, length * 0.92, steel, 0, top + 0.03, 0);
      for (const x of [-width * 0.22, width * 0.22]) for (const z of [-length * 0.22, length * 0.22]) cyl(0.025, 0.025, dark, x, top + 0.075, z);
      if (compDef.id === 'laserAlignment') glowSphere(indicatorR * 0.8, 0xff3344,
        0, top + 0.11, length * 0.28, 'steady', WARNING_LIGHT);
      break;
    }
    case 'opticalInstrument': {
      box(width * 0.7, 0.06, length * 0.7, dark, 0, bottom + 0.04, 0);
      cyl(Math.min(width, length) * 0.16, height * 0.56, steel, 0, bottom + height * 0.32, 0);
      glowCyl(Math.min(width, length) * 0.24, 0.05, 0x5fd8ff,
        0, bottom + height * 0.64, 0, 'y', 'screen', SCREEN_LIGHT);
      break;
    }
    case 'scopeStation': {
      feet(); frontRail();
      glowBox(width * 0.72, height * 0.40, 0.045, 0x30bfe8,
        0, height * 0.18, front + 0.025, 'screen', SCREEN_LIGHT);
      glowBox(width * 0.58, Math.max(0.01, height * 0.025), 0.012, 0x66ff99,
        0, height * 0.22, front + 0.056, 'screen');
      box(width * 0.10, height * 0.30, length * 0.18, dark, 0, -height * 0.20, -length * 0.18);
      break;
    }
    case 'benchFixture': {
      feet();
      box(width * 0.86, 0.08, length * 0.80, dark, 0, bottom + 0.03, 0);
      cyl(Math.min(width, height) * 0.16, length * 0.55, steel, 0, bottom + height * 0.30, 0, 'z');
      torus(Math.min(width, height) * 0.18, 0.028, copper, 0, bottom + height * 0.30, 0, [Math.PI / 2, 0, 0]);
      glowSphere(indicatorR, 0x44ff66, width * 0.31, bottom + height * 0.45,
        front + 0.025, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'whiteboard': {
      box(width + 0.08, height + 0.08, 0.05, steel, 0, 0, front + 0.025);
      box(width * 0.72, 0.04, 0.12, steel, 0, bottom + 0.10, front + 0.07);
      for (const x of [-width * 0.32, width * 0.20]) cyl(0.025, 0.12, warning, x, bottom + 0.14, front + 0.09, 'z');
      break;
    }
    case 'coffeeMachine': {
      feet();
      cyl(Math.min(width, length) * 0.22, height * 0.36, steel, 0, top - height * 0.18, -length * 0.08);
      cyl(Math.min(width, length) * 0.12, 0.09, dark, 0, -height * 0.08, front + 0.04, 'z');
      box(width * 0.36, 0.04, length * 0.30, steel, 0, bottom + 0.11, length * 0.12);
      glowSphere(indicatorR, 0x44ff66, width * 0.22, height * 0.16,
        front + 0.055, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'projector': {
      glowCyl(Math.min(width, height) * 0.27, 0.09, 0xd8efff,
        0, 0, front + 0.04, 'z', 'steady', { intensity: 0.34, distance: 2.2, daylightFloor: 0.2 });
      box(width * 0.30, 0.04, length * 0.24, steel, 0, bottom - 0.01, 0);
      break;
    }
    case 'phone': {
      glowCyl(Math.min(width, length) * 0.28, 0.04, 0x4fcde8,
        0, top + 0.015, 0, 'y', 'screen', SCREEN_LIGHT);
      for (const x of [-width * 0.22, width * 0.22]) sphere(Math.min(width, length) * 0.07, steel, x, top + 0.035, 0);
      break;
    }
    case 'tower': {
      feet();
      cyl(Math.min(width, length) * 0.23, height * 1.05, paint, 0, 0, 0);
      for (const y of [-height * 0.30, 0, height * 0.30]) torus(Math.min(width, length) * 0.27, 0.035, steel, 0, y, 0);
      cyl(Math.min(width, length) * 0.17, 0.12, warning, 0, top + 0.06, 0);
      break;
    }
    case 'cyclotron': {
      feet();
      cyl(Math.min(width, length) * 0.42, height * 0.42, paint, 0, 0, 0);
      torus(Math.min(width, length) * 0.28, 0.07, copper, 0, top * 0.25, 0);
      cyl(Math.min(width, length) * 0.10, height * 0.58, dark, 0, top * 0.25, 0);
      glowSphere(indicatorR * 1.2, 0xffaa40, width * 0.31, height * 0.28,
        front + 0.03, 'statusBlink', WARNING_LIGHT);
      break;
    }
    case 'laserBay': {
      feet();
      cyl(Math.min(width, height) * 0.16, length * 0.82, steel, 0, top + height * 0.04, 0, 'z');
      for (const z of [-length * 0.28, length * 0.28]) torus(Math.min(width, height) * 0.20, 0.035, copper, 0, top + height * 0.04, z, [Math.PI / 2, 0, 0]);
      box(width * 0.24, height * 0.42, length * 0.30, dark, width * 0.28, -height * 0.05, 0);
      glowBox(width * 0.14, height * 0.12, 0.025, 0x36c8ef,
        width * 0.28, height * 0.02, front + 0.035, 'screen', SCREEN_LIGHT);
      glowSphere(indicatorR, 0xff3344, -width * 0.32, top + indicatorR,
        0, 'statusBlink', WARNING_LIGHT);
      break;
    }
    case 'targetStation': {
      feet();
      cyl(Math.min(width, length) * 0.22, height * 0.50, steel, 0, top * 0.05, 0);
      for (const y of [-height * 0.15, height * 0.12]) torus(Math.min(width, length) * 0.27, 0.04, warning, 0, y, 0);
      cyl(Math.min(width, length) * 0.09, length * 0.78, dark, 0, 0, 0, 'z');
      glowSphere(indicatorR, 0xffaa40, width * 0.28, height * 0.25,
        front + 0.03, 'statusBlink', WARNING_LIGHT);
      break;
    }
    case 'magnet': {
      const arm = height * 0.18;
      box(width * 0.78, arm, length * 0.70, paint, 0, height * 0.30, 0);
      box(width * 0.78, arm, length * 0.70, paint, 0, -height * 0.30, 0);
      for (const x of [-width * 0.34, width * 0.34]) box(width * 0.12, height * 0.60, length * 0.70, dark, x, 0, 0);
      cyl(Math.min(width, height) * 0.08, length * 0.86, steel, 0, 0, 0, 'z');
      break;
    }
    case 'linac': {
      feet();
      cyl(Math.min(width, height) * 0.30, length * 0.88, steel, 0, 0, 0, 'z');
      // TorusGeometry already faces down the local Z beam axis. Rotating the
      // rings onto Y made them spill beyond the one-metre accelerating skid.
      for (const z of [-length * 0.32, 0, length * 0.32]) torus(Math.min(width, height) * 0.32, 0.04, copper, 0, 0, z);
      for (const z of [-length * 0.28, 0, length * 0.28]) glowSphere(indicatorR * 0.7,
        0x44ddff, width * 0.31, height * 0.24, z, 'steady', STATUS_LIGHT);
      break;
    }
    case 'cryomodule': {
      feet();
      cyl(Math.min(width, height) * 0.36, length * 0.88, steel, 0, 0, 0, 'z');
      for (const z of [-length * 0.34, -length * 0.12, length * 0.12, length * 0.34]) torus(Math.min(width, height) * 0.38, 0.035, dark, 0, 0, z, [Math.PI / 2, 0, 0]);
      for (const z of [-length * 0.25, length * 0.25]) glowSphere(indicatorR * 0.8,
        0x44ddff, width * 0.34, height * 0.18, z, 'steady', STATUS_LIGHT);
      break;
    }
    case 'collision': {
      sphere(Math.min(width, height, length) * 0.22, warning, 0, 0, 0);
      for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
        const o = (axis === 'x' ? width : length) * 0.30 * sign;
        cyl(Math.min(width, length) * 0.08, (axis === 'x' ? width : length) * 0.34, steel,
          axis === 'x' ? o : 0, 0, axis === 'z' ? o : 0, axis);
      }
      break;
    }
    case 'shieldedCell': {
      box(width * 0.58, height * 0.72, 0.045, dark, 0, -height * 0.06, front + 0.02);
      box(width * 0.05, height * 0.78, 0.07, warning, -width * 0.32, -height * 0.03, front + 0.04);
      box(width * 0.15, 0.05, 0.08, steel, width * 0.19, -height * 0.05, front + 0.05);
      glowSphere(indicatorR, 0xff3344, width * 0.26, height * 0.27,
        front + 0.08, 'statusBlink', WARNING_LIGHT);
      break;
    }
    case 'handling': {
      feet();
      for (const x of [-width * 0.36, width * 0.36]) box(0.10, height * 0.88, 0.12, warning, x, 0, 0);
      box(width * 0.84, 0.10, 0.16, warning, 0, top * 0.82, 0);
      cyl(0.035, height * 0.45, dark, 0, top * 0.34, 0);
      sphere(0.09, dark, 0, -height * 0.05, 0);
      glowSphere(indicatorR * 1.1, 0xffaa40, 0, top * 0.92,
        0, 'statusBlink', WARNING_LIGHT);
      break;
    }
    case 'dump': {
      feet();
      cyl(Math.min(width, height) * 0.23, length * 0.72, warning, 0, 0, 0, 'z');
      cyl(Math.min(width, height) * 0.12, length * 0.82, dark, 0, 0, 0, 'z');
      break;
    }
    case 'storage': {
      feet();
      for (const x of [-width * 0.22, width * 0.22]) for (const z of [-length * 0.20, length * 0.20]) cyl(Math.min(width, length) * 0.12, height * 0.72, warning, x, -height * 0.05, z);
      break;
    }
    case 'powerBus': {
      for (const x of [-width * 0.22, 0, width * 0.22]) {
        box(width * 0.08, height * 0.22, length * 0.90, copper, x, 0, 0);
        for (const z of [-length * 0.34, length * 0.34]) cyl(width * 0.09, height * 0.46, dark, x, 0, z);
      }
      glowSphere(indicatorR, 0x44ff66, width * 0.34, height * 0.24,
        front + 0.02, 'statusBlink', STATUS_LIGHT);
      break;
    }
    case 'areaMonitor': {
      cyl(Math.min(width, length) * 0.20, 0.07, dark, 0, bottom - 0.015, 0);
      box(width * 0.16, height * 0.55, length * 0.16, steel, 0, -height * 0.08, 0);
      box(width * 0.54, height * 0.30, 0.05, dark, 0, height * 0.22, front + 0.025);
      glowBox(width * 0.28, height * 0.13, 0.06, 0x43d8ee,
        -width * 0.08, height * 0.23, front + 0.05, 'screen', SCREEN_LIGHT);
      glowCyl(width * 0.055, 0.05, 0xffaa40, width * 0.18,
        height * 0.23, front + 0.055, 'z', 'statusBlink', WARNING_LIGHT);
      break;
    }
    default:
      return null;
  }

  return group;
}
