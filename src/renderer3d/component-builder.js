// src/renderer3d/component-builder.js
// Builds Three.js meshes for beamline components from world snapshot data.
// THREE is a CDN global — do NOT import it.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { BEAMLINE_COMPONENTS_RAW } from '../data/beamline-components.raw.js';
import {
  BEAM_AXIS_HEIGHT as BEAM_HEIGHT,
  BEAM_PIPE_RADIUS as PIPE_R,
  BEAM_FLANGE_RADIUS as FLANGE_R,
  BEAM_FLANGE_WIDTH as FLANGE_H,
} from '../beamline/visual-geometry.js';
import { roleBuilderFallbacks } from '../data/validate.js';
import { MATERIALS } from './materials/index.js';
import { DECALS } from './materials/decals.js';
import { applyTiledBoxUVs, applyTiledCylinderUVs } from './uv-utils.js';
import { buildPlaceableVisualDetails } from './placeable-visual-details.js';
import { BLOOM_LAYER } from './glow-pipeline.js';
import { getGlowMaterial, setGlowNightFactor } from './machine-glow.js';
export { getGlowMaterial, setGlowNightFactor } from './machine-glow.js';
import { wallFixturePose } from '../game/wall-fixture-geometry.js';
import { syncMapEdgeServiceLeadVisual } from './map-edge-service-lead.js';
import {
  _buildBPMRoles,
  _buildICTRoles,
  _buildScreenRoles,
  _buildWireScannerRoles,
} from './builders/diagnostic-builder.js';
import {
  _buildPiraniGaugeRoles,
  _buildColdCathodeGaugeRoles,
  _buildBAGaugeRoles,
  _buildGateValveRoles,
  _buildRoughingPumpRoles,
  _buildRoughingPumpCartRoles,
  _buildTurboPumpRoles,
  _buildTurboPumpCartRoles,
  _buildVacuumCartRoles,
  _buildHighCapacityVacuumStationRoles,
  _buildVacuumManifold4Roles,
  _buildVacuumManifold8Roles,
  _buildIonPumpRoles,
  _buildNEGPumpRoles,
  _buildTiSubPumpRoles,
} from './builders/vacuum-builder.js';
import {
  _buildLN2DewarRoles,
  _buildCryocoolerRoles,
  _buildLN2PrecoolerRoles,
  _buildHeRecoveryRoles,
  _buildHeRecoveryHeaderRoles,
  _buildHeGasBagRoles,
  _buildHePurifierRoles,
  _buildHeLiquefierRoles,
  _buildWaterLoadRoles,
  _buildFanCoilCoolerRoles,
  _buildPackageChillerRoles,
  _buildDualCircuitChillerRoles,
  _buildDryCoolerBankRoles,
  _buildCoolingTowerRoles,
  _buildDeioniserRoles,
  _buildLcwSkidRoles,
  _buildChillerRoles,
  _buildEmergencyCoolingRoles,
  _buildCoolingManifoldRoles,
} from './builders/cooling-builder.js';
import {
  _buildColdBox4KRoles,
  _buildColdBox2KRoles,
  _buildHeCompressorRoles,
  _buildCryomoduleHousingRoles,
  _buildCryoValveBoxRoles,
} from './builders/cryo-builder.js';
import {
  _buildPulsedKlystronRoles,
  _buildCWKlystronRoles,
  _buildSLAC5045KlystronRoles,
  _buildMultibeamKlystronRoles,
  _buildMagnetronRoles,
  _buildTWTRoles,
  _buildIOTRoles,
  _buildCirculatorRoles,
  _buildRFCouplerRoles,
  _buildGyrotronRoles,
  _buildSolidStateAmpRoles,
  _buildHighPowerSSARoles,
  _buildModulatorRoles,
  _buildLLRFControllerRoles,
  _buildWaveguideManifoldRoles,
} from './builders/rf-builder.js';
import {
  _buildInjectionSeptumRoles,
  _buildCombinedFunctionMagnetRoles,
  _buildChicaneRoles,
  _buildUndulatorRoles,
  _buildEnergyDegraderRoles,
  _buildScanningMagnetRoles,
  _buildDcInjectorRoles,
  _buildSolenoidRoles,
  _buildCollimatorRoles,
  _buildApertureRoles,
  _buildVelocitySelectorRoles,
  _buildEmittanceFilterRoles,
  _buildSextupoleRoles,
} from './builders/optics-builder.js';
import {
  _buildHVTransformerRoles,
  _buildDisconnectSwitchRoles,
  _buildCompactHvDistributorRoles,
  _buildSwitchgearRoles,
  _buildPadMountTransformerRoles,
  _buildMCCRoles,
  _buildUPSRoles,
  _buildCompactDistributionPanelRoles,
  _buildSectionDistributionPanelRoles,
  _buildMainDistributionPanelRoles,
  _buildPowerBusRoles,
  _buildSpiderBoxRoles,
} from './builders/power-builder.js';
import {
  _buildCollisionPointRoles,
  _buildFaradayCupRoles,
  _buildBeamStopRoles,
  _buildDetectorRoles,
  _buildTargetRoles,
  _buildMaterialsTestStationRoles,
  _buildXRayConverterStationRoles,
  _buildEBeamIrradiationVaultRoles,
  _buildIsotopeProductionTargetRoles,
  _buildRadiationEffectsStationRoles,
  _buildProtonTherapyGantryRoles,
  _buildSpallationNeutronTargetRoles,
  _buildPhotonScienceHutchRoles,
  _buildXfelEndstationRoles,
  _buildEuvCollectorRoles,
} from './builders/endpoint-builder.js';
import {
  _buildVanDeGraaffRoles,
  _buildCockcroftWaltonRoles,
} from './builders/compound-machine-builder.js';
import {
  _buildIndustrialLinacRoles,
  _buildDtlRoles,
  _buildCryomoduleRoles,
} from './builders/accelerator-builder.js';
import {
  _buildCyclotron30Roles,
  _buildCyclotron70Roles,
  _buildCyclotron230Roles,
  _buildProtonLinacFrontEndRoles,
  _buildLwfaStationRoles,
  _buildPositronSourceRoles,
} from './builders/source-machine-builder.js';
// Phase 6: utility-port-builder and carrier-rack modules removed. Port stub
// rendering was already commented-out at call sites; carrierRack is no longer
// a placeable.

const SUB_UNIT = 0.5; // 1 sub-unit = 0.5m in world space
const SEGS = 16;      // cylinder segment count for smooth round shapes

// ── Standard beamline geometry constants ─────────────────────────────
// All components share these so the beam pipe looks continuous when
// components are placed end-to-end.
const PIPE_COLOR   = 0x99aabb;  // stainless steel blue-gray
const FLANGE_COLOR = 0xbbbbbb;  // bright steel
const STAND_COLOR  = 0x555555;  // dark gray support structure

// ── Shared materials (created lazily) ────────────────────────────────

const _matCache = new Map();

function _mat(color, roughness = 0.5, metalness = 0.3, textureName = 'metal_painted_white') {
  const key = `${color}-${roughness}-${metalness}-${textureName ?? ''}`;
  if (!_matCache.has(key)) {
    const opts = { color, roughness, metalness };
    if (textureName && MATERIALS[textureName]) {
      opts.map = MATERIALS[textureName].map;
    }
    _matCache.set(key, new THREE.MeshStandardMaterial(opts));
  }
  return _matCache.get(key).clone();
}

// ── Infra fallback material cache ──────────────────────────────────
// Keyed by compType|faceKey|baseName|overrideJSON so identical face
// configs across instances share one MeshStandardMaterial. Mirrors
// equipment-builder's _equipMatCache.
const _infraFaceMatCache = new Map();
const _INFRA_FACE_KEYS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
const _INFRA_FACE_INDEX = { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 };

function _infraFaceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  const cacheKey = `${compType}|${faceKey}|${baseName || ''}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _infraFaceMatCache.get(cacheKey);
  if (m) return m;

  // Decal override: reuse the shared DECALS material. The caller is
  // responsible for rewriting this face's UVs to 0→1.
  if (faceOverride && faceOverride.decal && DECALS[faceOverride.decal]) {
    m = DECALS[faceOverride.decal];
    _infraFaceMatCache.set(cacheKey, m);
    return m;
  }

  // Per-face tiled override or inherited base material
  const perFaceBase = faceOverride && faceOverride.base;
  const resolvedBase = perFaceBase || baseName;

  let map = null;
  let color = fallbackColor;
  if (resolvedBase && MATERIALS[resolvedBase]) {
    map = MATERIALS[resolvedBase].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.7,
    metalness: 0.2,
  });
  _infraFaceMatCache.set(cacheKey, m);
  return m;
}

// Rewrite a single face's UVs to span 0→1 so the full decal texture
// shows instead of being cropped by the tiled UV span from applyTiledBoxUVs.
function _setInfraFaceUVsClamped(geometry, faceKey) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const face = _INFRA_FACE_INDEX[faceKey];
  if (face == null) return;
  const arr = uv.array;
  const off = face * 8;
  arr[off + 0] = 0; arr[off + 1] = 1;
  arr[off + 2] = 1; arr[off + 3] = 1;
  arr[off + 4] = 0; arr[off + 5] = 0;
  arr[off + 6] = 1; arr[off + 7] = 0;
  uv.needsUpdate = true;
}

// ── Role-based material system ───────────────────────────────────────
// Detail builders that use the new template pattern return meshes
// bucketed into one of these roles. Each role maps to a shared material
// (or a per-color cached material for 'accent').

const ROLES = /** @type {const} */ (['accent', 'iron', 'copper', 'pipe', 'stand', 'detail', 'glow']);

// Paint-on-iron for the accent role. The color is overridden per beamline;
// this base exists only to be cloned.
const ACCENT_BASE_ROUGHNESS = 0.6;
const ACCENT_BASE_METALNESS = 0.12;

// SHARED_MATERIALS now derive their .map from MATERIALS but keep their
// own roughness/metalness and color tint. Per-role default texture:
//   iron   -> metal_dark
//   copper -> copper
//   pipe   -> metal_brushed
//   stand  -> metal_painted_white  (tinted dark gray via color)
//   detail -> metal_dark
//   glow   -> none (emissive surfaces have no albedo texture by default)
const SHARED_MATERIALS = {
  iron:   new THREE.MeshStandardMaterial({ map: MATERIALS.metal_dark.map,          color: 0xffffff,    roughness: 0.5, metalness: 0.4 }),
  copper: new THREE.MeshStandardMaterial({ map: MATERIALS.copper.map,              color: 0xffffff,    roughness: 0.4, metalness: 0.5 }),
  pipe:   new THREE.MeshStandardMaterial({ map: MATERIALS.metal_brushed.map,       color: 0xffffff,    roughness: 0.3, metalness: 0.5 }),
  stand:  new THREE.MeshStandardMaterial({ map: MATERIALS.metal_painted_white.map, color: STAND_COLOR, roughness: 0.7, metalness: 0.1 }),
  detail: new THREE.MeshStandardMaterial({ map: MATERIALS.metal_dark.map,          color: 0xffffff,    roughness: 0.7, metalness: 0.3 }),
  glow:   new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35, metalness: 0.1 }),
};

/** Cache of (componentType + '|' + colorHex) -> MeshStandardMaterial */
const _accentMatCache = new Map();

/**
 * Get or create a painted-metal material for a given component type at a
 * given accent color. Cached so that all placements of the same type on
 * the same beamline share one material instance.
 *
 * The `compType` is part of the key so future components can tweak
 * roughness/metalness per type without affecting others.
 */
export function getAccentMaterial(compType, colorHex) {
  const key = compType + '|' + colorHex.toString(16).padStart(6, '0');
  let m = _accentMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: MATERIALS.metal_painted_white.map,  // neutral tintable base
      color: colorHex,
      roughness: ACCENT_BASE_ROUGHNESS,
      metalness: ACCENT_BASE_METALNESS,
    });
    _accentMatCache.set(key, m);
  }
  return m;
}

// Per-component-type emissive color. Component builders bucket geometry into
// `b.glow` without choosing a color (buckets only carry geometry); the color
// is resolved here, at instantiation, keyed by compType — mirroring how
// getAccentMaterial keys by compType, but independent of the beamline's
// accent paint, since a screen's color isn't a paint choice.
const GLOW_COLORS = {
  llrfController: 0x40e0ff, // cyan-blue LCD/CRT readout
  negPump: 0x44ff66,        // green "active" indicator strip
  ionSource: 0xff6633,      // hot-cathode orange (unchanged from the old hand-rolled material)
};
const GLOW_PROFILES = {
  llrfController: 'screen',
  negPump: 'statusBlink',
  ionSource: 'arc',
};
const DEFAULT_GLOW_COLOR = 0x40e0ff;

// ── Template-and-tint infrastructure ────────────────────────────────
// A "role-based" builder returns { accent: [geoms], iron: [geoms], ... }
// where each array holds already-transformed BufferGeometries ready to
// be merged. We merge each role's list once per component type and cache
// the resulting meshes as a "template". Per-placement instantiation then
// creates lightweight Mesh wrappers that share the template's geometry
// and (for non-accent roles) the template's material.

/** @type {Map<string, Record<string, THREE.Mesh>>} */
const _templateCache = new Map();

/**
 * Registry of role-based builders. Unlike DETAIL_BUILDERS (legacy — returns
 * a fully assembled THREE.Group), these return a role bucket object.
 *
 * A builder may omit roles it doesn't use — the template-cache step only
 * processes roles with at least one geometry.
 *
 * @type {Record<string, () => Record<string, THREE.BufferGeometry[]>>}
 */
const ROLE_BUILDERS = {};

/**
 * Build (or fetch) the template for a role-based component type.
 * Returns a map of role -> Mesh. The meshes own merged geometry but use
 * placeholder/shared materials. Callers clone the meshes per placement.
 */
function _getRoleTemplate(compType) {
  if (_templateCache.has(compType)) return _templateCache.get(compType);
  const builder = ROLE_BUILDERS[compType];
  if (!builder) return null;

  const buckets = builder();
  const template = {};
  for (const role of ROLES) {
    const list = buckets[role];
    if (!list || list.length === 0) continue;
    const merged = _mergeGeometries(list);
    // Dispose the source geometries — we own `merged` now.
    for (const g of list) g.dispose();
    const mat = role === 'accent'
      ? SHARED_MATERIALS.pipe // placeholder; replaced per placement
      : SHARED_MATERIALS[role];
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData.role = role;
    if (role === 'detail') mesh.userData.lod = 'detail';
    template[role] = mesh;
  }

  _templateCache.set(compType, template);
  return template;
}

// Per-component override material cache. Key: compType + '|' + role + '|' + textureName.
// Each entry mirrors a role's SHARED_MATERIAL but swaps the .map to a
// different MATERIALS entry while preserving the role's color/roughness/metalness.
const _overrideRoleMatCache = new Map();

function _getOverrideRoleMaterial(compType, role, textureName) {
  const key = `${compType}|${role}|${textureName}`;
  let m = _overrideRoleMatCache.get(key);
  if (m) return m;
  const base = SHARED_MATERIALS[role];
  const tex = MATERIALS[textureName];
  if (!base || !tex) return base ?? null;
  m = new THREE.MeshStandardMaterial({
    map: tex.map,
    color: base.color.clone(),
    roughness: base.roughness,
    metalness: base.metalness,
  });
  _overrideRoleMatCache.set(key, m);
  return m;
}

/**
 * Instantiate a placed component from its role template. Returns a Group
 * containing one Mesh per role, where meshes share the template's merged
 * geometry and a cached material. Cheap to call repeatedly.
 *
 * @param {string} compType
 * @param {number} accentColorHex
 * @returns {THREE.Group|null} null if no role builder exists for this type
 */
function _instantiateRoleTemplate(compType, accentColorHex) {
  const template = _getRoleTemplate(compType);
  if (!template) return null;

  const group = new THREE.Group();
  // Resolve per-role material, honoring an optional per-component override.
  const compDef = COMPONENTS[compType];
  const overrides = (compDef && compDef.textures) || null;
  for (const role of ROLES) {
    const tplMesh = template[role];
    if (!tplMesh) continue;
    let mat;
    if (role === 'accent') {
      mat = getAccentMaterial(compType, accentColorHex);
    } else if (role === 'glow') {
      mat = getGlowMaterial(compType, GLOW_COLORS[compType] ?? DEFAULT_GLOW_COLOR);
    } else if (overrides && overrides[role]) {
      mat = _getOverrideRoleMaterial(compType, role, overrides[role]);
    } else {
      mat = SHARED_MATERIALS[role];
    }
    const mesh = new THREE.Mesh(tplMesh.geometry, mat);
    mesh.userData.role = role;
    // The geometry is the module-level role template, shared by reference
    // with every other instance of this component type (including the
    // committed scene objects). Flag it so teardown paths — notably the
    // renderer's preview clear, which runs on every hover while a placement
    // tool is armed — remove the mesh without disposing buffers still in use.
    // (Materials are cloned per ghost, so they stay disposable.)
    mesh.userData.sharedGeometry = true;
    if (role === 'detail') {
      mesh.userData.lod = 'detail';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    } else if (role === 'glow') {
      // A lit screen/lamp must not cast a shadow, and it opts into the
      // bloom-only render pass (see glow-pipeline.js) by enabling BLOOM_LAYER.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.layers.enable(BLOOM_LAYER);
      // Declarative profile only. VisualEffectSystem owns the animation and
      // clones the shared material per placement when it syncs the scene.
      mesh.userData.effectProfile = GLOW_PROFILES[compType] || 'steady';
    } else {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(mesh);
  }
  return group;
}

function _addShadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Merge a list of non-indexed BufferGeometries with matching attributes into
 * a single BufferGeometry. Only handles `position` and `normal` attributes
 * (all the primitives we use — Box/Cylinder/Torus/Plane — expose these).
 *
 * Each input geometry is consumed: we assume the caller has already applied
 * any world-space transform via `.applyMatrix4()`. The result is a fresh
 * non-indexed BufferGeometry owning its own buffers.
 *
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
export function _mergeGeometries(geometries) {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // First pass — make sure every input is non-indexed so we can concat directly.
  const flat = geometries.map(g => g.index ? g.toNonIndexed() : g);

  // Sum sizes.
  let posCount = 0;
  let normCount = 0;
  let uvCount = 0;
  for (const g of flat) {
    posCount += g.attributes.position.array.length;
    const na = g.attributes.normal;
    if (na) normCount += na.array.length;
    const ua = g.attributes.uv;
    if (ua) uvCount += ua.array.length;
  }

  const positions = new Float32Array(posCount);
  const allHaveNormals = flat.every(g => g.attributes.normal);
  const normals = allHaveNormals ? new Float32Array(normCount) : null;
  const allHaveUVs = flat.every(g => g.attributes.uv);
  const uvs = allHaveUVs ? new Float32Array(uvCount) : null;

  let posOff = 0;
  let normOff = 0;
  let uvOff = 0;
  for (const g of flat) {
    positions.set(g.attributes.position.array, posOff);
    posOff += g.attributes.position.array.length;
    if (normals) {
      normals.set(g.attributes.normal.array, normOff);
      normOff += g.attributes.normal.array.length;
    }
    if (uvs) {
      uvs.set(g.attributes.uv.array, uvOff);
      uvOff += g.attributes.uv.array.length;
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) {
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  if (uvs) {
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  return merged;
}

// ── Detailed geometry builders ───────────────────────────────────────
// Each returns a THREE.Group whose local origin is centered at the
// component's footprint center, Y=0 at floor level.
// Beam travels along +Z in local space (rotated later by direction).

function _buildSource() {
  const group = new THREE.Group();
  const bodyColor    = 0x4a6b4a; // dark steel-green gun chamber
  const insulatorC   = 0xcc8833; // ceramic amber for HV insulators
  const copperC      = 0xb87333; // copper anode/cathode hardware
  const solenoidC    = 0x8b4513; // dark copper solenoid winding

  // ── Gun vacuum chamber — main cylindrical vessel ──
  const chamberR = 0.4, chamberH = 0.9;
  const chamberGeo = new THREE.CylinderGeometry(chamberR, chamberR, chamberH, SEGS);
  applyTiledCylinderUVs(chamberGeo, chamberR, chamberH, SEGS);
  const chamber = _addShadow(new THREE.Mesh(chamberGeo, _mat(bodyColor, 0.5, 0.25)));
  chamber.rotation.x = Math.PI / 2;
  chamber.position.set(0, BEAM_HEIGHT, -0.2);
  group.add(chamber);

  // Chamber end caps (front and rear flanges)
  const capR = 0.43, capH = 0.04;
  for (const zOff of [-0.2 - chamberH / 2, -0.2 + chamberH / 2]) {
    const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(g, capR, capH, SEGS);
    const cap = _addShadow(new THREE.Mesh(g, _mat(FLANGE_COLOR, 0.3, 0.5)));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, BEAM_HEIGHT, zOff);
    group.add(cap);
  }

  // ── HV insulator stack on top — 4 ceramic rings ──
  const stackBase = BEAM_HEIGHT + chamberR;
  const ringR = 0.18, ringH = 0.08, ringGap = 0.03;
  for (let i = 0; i < 4; i++) {
    const y = stackBase + i * (ringH + ringGap) + ringH / 2;
    const g = new THREE.CylinderGeometry(ringR, ringR, ringH, SEGS);
    applyTiledCylinderUVs(g, ringR, ringH, SEGS);
    const ring = _addShadow(new THREE.Mesh(g, _mat(insulatorC, 0.35, 0.05)));
    ring.position.set(0, y, -0.45);
    group.add(ring);
    // Wide porcelain sheds give the stack a readable high-voltage silhouette.
    const shed = _addShadow(new THREE.Mesh(
      new THREE.TorusGeometry(ringR + 0.035, 0.022, 6, 20),
      _mat(insulatorC, 0.42, 0.03),
    ));
    shed.rotation.x = Math.PI / 2;
    shed.position.set(0, y, -0.45);
    group.add(shed);
    // Steel spacer between rings
    if (i < 3) {
      const sg = new THREE.CylinderGeometry(ringR + 0.02, ringR + 0.02, ringGap, SEGS);
      applyTiledCylinderUVs(sg, ringR + 0.02, ringGap, SEGS);
      const spacer = _addShadow(new THREE.Mesh(sg, _mat(FLANGE_COLOR, 0.3, 0.5)));
      spacer.position.set(0, y + ringH / 2 + ringGap / 2, -0.45);
      group.add(spacer);
    }
  }

  // Hot cathode face, recessed behind the rear flange.
  {
    const cathode = new THREE.Mesh(
      new THREE.CircleGeometry(0.11, SEGS),
      getGlowMaterial('source', 0xff8a3d),
    );
    cathode.userData.role = 'glow';
    cathode.layers.enable(BLOOM_LAYER);
    cathode.position.set(0, BEAM_HEIGHT, -0.2 - chamberH / 2 - 0.022);
    cathode.rotation.y = Math.PI;
    group.add(cathode);
  }

  // Analog HV meter and guard rail make the service side legible from above.
  {
    const meter = _addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.035, 16),
      _mat(0xe8e1c8, 0.65, 0.05),
    ));
    meter.rotation.z = Math.PI / 2;
    meter.position.set(chamberR + 0.035, BEAM_HEIGHT + 0.16, -0.08);
    group.add(meter);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.055, 0.008), _mat(0x222222, 0.8, 0));
    needle.rotation.z = -0.55;
    needle.position.set(chamberR + 0.057, BEAM_HEIGHT + 0.16, -0.08);
    group.add(needle);
  }

  // HV cable bushing on top of insulator stack
  const bushingR = 0.08, bushingH = 0.15;
  const bushingY = stackBase + 4 * (ringH + ringGap);
  {
    const g = new THREE.CylinderGeometry(bushingR, bushingR * 1.3, bushingH, SEGS);
    applyTiledCylinderUVs(g, bushingR, bushingH, SEGS);
    const bushing = _addShadow(new THREE.Mesh(g, _mat(0x333333, 0.8, 0.05)));
    bushing.position.set(0, bushingY + bushingH / 2, -0.45);
    group.add(bushing);
  }

  // ── HV feedthrough at rear — thick insulated cylinder ──
  {
    const ftR = 0.12, ftH = 0.3;
    const g = new THREE.CylinderGeometry(ftR, ftR, ftH, SEGS);
    applyTiledCylinderUVs(g, ftR, ftH, SEGS);
    const ft = _addShadow(new THREE.Mesh(g, _mat(insulatorC, 0.35, 0.05)));
    ft.rotation.x = Math.PI / 2;
    ft.position.set(0, BEAM_HEIGHT + 0.15, -0.2 - chamberH / 2 - ftH / 2);
    group.add(ft);
  }

  // ── Wehnelt/anode assembly — copper cylinder at front of chamber ──
  {
    const anodeR = 0.14, anodeH = 0.12;
    const g = new THREE.CylinderGeometry(anodeR, anodeR * 0.9, anodeH, SEGS);
    applyTiledCylinderUVs(g, anodeR, anodeH, SEGS);
    const anode = _addShadow(new THREE.Mesh(g, _mat(copperC, 0.35, 0.6)));
    anode.rotation.x = Math.PI / 2;
    anode.position.set(0, BEAM_HEIGHT, -0.2 + chamberH / 2 + anodeH / 2);
    group.add(anode);
  }

  // ── Focusing solenoid around beam exit ──
  const solR = 0.16, solH = 0.3;
  const solZ = 0.45;
  {
    const g = new THREE.CylinderGeometry(solR, solR, solH, SEGS);
    applyTiledCylinderUVs(g, solR, solH, SEGS);
    const sol = _addShadow(new THREE.Mesh(g, _mat(solenoidC, 0.5, 0.3)));
    sol.rotation.x = Math.PI / 2;
    sol.position.set(0, BEAM_HEIGHT, solZ);
    group.add(sol);
  }
  // Solenoid end rings
  for (const zOff of [solZ - solH / 2, solZ + solH / 2]) {
    const g = new THREE.CylinderGeometry(solR + 0.02, solR + 0.02, 0.02, SEGS);
    applyTiledCylinderUVs(g, solR + 0.02, 0.02, SEGS);
    const endRing = _addShadow(new THREE.Mesh(g, _mat(FLANGE_COLOR, 0.3, 0.5)));
    endRing.rotation.x = Math.PI / 2;
    endRing.position.set(0, BEAM_HEIGHT, zOff);
    group.add(endRing);
  }

  // ── Beam exit pipe through solenoid to the authored exit port ──
  const portStart = -0.2 + chamberH / 2 + 0.12;
  _addSourceExit(group, 'source', portStart);

  // ── Cooling water fittings on chamber sides ──
  for (const xSign of [-1, 1]) {
    for (const zOff of [-0.35, -0.05]) {
      const g = new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8);
      applyTiledCylinderUVs(g, 0.02, 0.12, 8);
      const fitting = _addShadow(new THREE.Mesh(g, _mat(PIPE_COLOR, 0.3, 0.5)));
      fitting.rotation.z = Math.PI / 2;
      fitting.position.set(xSign * (chamberR + 0.06), BEAM_HEIGHT - 0.1, zOff);
      group.add(fitting);
    }
  }

  // ── Support structure — cradle frame ──
  const cradleW = 0.9, cradleD = 1.0;
  const legH = BEAM_HEIGHT - chamberR + 0.08;
  // Four vertical legs
  const legW = 0.06;
  for (const xOff of [-cradleW / 2 + legW, cradleW / 2 - legW]) {
    for (const zOff of [-0.55, 0.15]) {
      const g = new THREE.BoxGeometry(legW, legH, legW);
      applyTiledBoxUVs(g, legW, legH, legW);
      const leg = _addShadow(new THREE.Mesh(g, _mat(STAND_COLOR, 0.7, 0.1)));
      leg.position.set(xOff, legH / 2, zOff);
      group.add(leg);
    }
  }
  // Cross-braces front and back
  for (const zOff of [-0.55, 0.15]) {
    const g = new THREE.BoxGeometry(cradleW, 0.04, legW);
    applyTiledBoxUVs(g, cradleW, 0.04, legW);
    const brace = _addShadow(new THREE.Mesh(g, _mat(STAND_COLOR, 0.7, 0.1)));
    brace.position.set(0, legH, zOff);
    group.add(brace);
  }
  // Side rails connecting front/back braces
  for (const xOff of [-cradleW / 2 + legW, cradleW / 2 - legW]) {
    const g = new THREE.BoxGeometry(legW, 0.04, cradleD);
    applyTiledBoxUVs(g, legW, 0.04, cradleD);
    const rail = _addShadow(new THREE.Mesh(g, _mat(STAND_COLOR, 0.7, 0.1)));
    rail.position.set(xOff, legH, -0.2);
    group.add(rail);
  }

  return group;
}

function _buildDuoplasmatron() {
  const group = new THREE.Group();
  const bodyColor   = 0x4a5b7a; // dark steel-blue, distinct from electron gun's green-grey
  const magnetColor = 0x222222; // dark iron magnet collar
  const cathodeC    = 0xff6633; // hot-cathode emissive orange
  const copperC     = 0xb87333; // copper extraction electrodes

  // ── Main body cylinder ──
  const bodyR = 0.4, bodyH = 1.0;
  const bodyZ = -0.1; // shifted slightly back so extraction stack fits inside footprint
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyH, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyH, SEGS);
    const body = _addShadow(new THREE.Mesh(g, _mat(bodyColor, 0.5, 0.4)));
    body.rotation.x = Math.PI / 2;
    body.position.set(0, BEAM_HEIGHT, bodyZ);
    group.add(body);
  }

  // Front and rear flanges
  const flR = 0.43, flH = 0.04;
  for (const zOff of [bodyZ - bodyH / 2, bodyZ + bodyH / 2]) {
    const g = new THREE.CylinderGeometry(flR, flR, flH, SEGS);
    applyTiledCylinderUVs(g, flR, flH, SEGS);
    const fl = _addShadow(new THREE.Mesh(g, _mat(FLANGE_COLOR, 0.3, 0.5)));
    fl.rotation.x = Math.PI / 2;
    fl.position.set(0, BEAM_HEIGHT, zOff);
    group.add(fl);
  }

  // ── Magnet collar — torus around the body midpoint ──
  {
    const torusR = bodyR + 0.06; // ring radius around body
    const tubeR  = 0.09;          // torus tube thickness
    const g = new THREE.TorusGeometry(torusR, tubeR, 8, 24);
    const torus = _addShadow(new THREE.Mesh(g, _mat(magnetColor, 0.6, 0.6)));
    // TorusGeometry lies in XY plane by default (axis along +Z) — already
    // wrapping around the beam axis. Position at body midpoint.
    torus.position.set(0, BEAM_HEIGHT, bodyZ);
    group.add(torus);
  }

  // ── Hot-cathode rear cap — small disc, glowing hot-cathode orange ──
  // This is legacy DETAIL_BUILDERS (returns a Group directly, not role
  // buckets), so it doesn't go through _instantiateRoleTemplate's
  // per-placement loop — the role tag, bloom layer, and shadow flag that
  // loop would normally set have to be applied by hand here.
  {
    const capR = 0.18, capH = 0.05;
    const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(g, capR, capH, SEGS);
    const mat = getGlowMaterial('ionSource', cathodeC);
    const cap = new THREE.Mesh(g, mat);
    cap.userData.role = 'glow';
    cap.layers.enable(BLOOM_LAYER);
    cap.castShadow = false;
    cap.receiveShadow = true;
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, BEAM_HEIGHT, bodyZ - bodyH / 2 - flH - capH / 2);
    group.add(cap);
  }

  // ── Extraction electrode stack — two thin copper rings at the front ──
  {
    const ringR = 0.15, ringH = 0.04, gap = 0.05;
    const baseZ = bodyZ + bodyH / 2 + flH;
    for (let i = 0; i < 2; i++) {
      const z = baseZ + ringH / 2 + i * (ringH + gap);
      const g = new THREE.CylinderGeometry(ringR, ringR, ringH, SEGS);
      applyTiledCylinderUVs(g, ringR, ringH, SEGS);
      const ring = _addShadow(new THREE.Mesh(g, _mat(copperC, 0.35, 0.6)));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, BEAM_HEIGHT, z);
      group.add(ring);
    }
  }

  _addBeamSupport(group, bodyZ - 0.28);
  _addBeamSupport(group, bodyZ + 0.28);
  // The extraction electrodes stop well inside the footprint. Continue with
  // a real vacuum tube to the same edge coordinate used by beam-pipe input.
  _addSourceExit(group, 'ionSource', 0.57);

  return group;
}

function _buildEcrIonSource() {
  const group = new THREE.Group();
  const chamberColor   = 0x8a9aab; // light steel
  const coilColor      = 0x884422; // dark copper coils
  const waveguideColor = 0xc8b060; // brass waveguide
  const copperC        = 0xb87333; // copper extraction plates

  // ── Plasma chamber — central cylinder ──
  const chR = 0.5, chH = 1.2;
  const chZ = -0.2; // shift back a bit so extraction stack lives inside the 6-sub footprint
  {
    const g = new THREE.CylinderGeometry(chR, chR, chH, SEGS);
    applyTiledCylinderUVs(g, chR, chH, SEGS);
    const ch = _addShadow(new THREE.Mesh(g, _mat(chamberColor, 0.45, 0.5)));
    ch.rotation.x = Math.PI / 2;
    ch.position.set(0, BEAM_HEIGHT, chZ);
    group.add(ch);
  }

  // End-cap flanges
  const flR = 0.54, flH = 0.05;
  for (const zOff of [chZ - chH / 2, chZ + chH / 2]) {
    const g = new THREE.CylinderGeometry(flR, flR, flH, SEGS);
    applyTiledCylinderUVs(g, flR, flH, SEGS);
    const fl = _addShadow(new THREE.Mesh(g, _mat(FLANGE_COLOR, 0.3, 0.5)));
    fl.rotation.x = Math.PI / 2;
    fl.position.set(0, BEAM_HEIGHT, zOff);
    group.add(fl);
  }

  // ── Mirror solenoid coils — two large toruses near each end of chamber ──
  {
    const ringR = 0.55;  // ring radius
    const tubeR = 0.12;  // tube thickness
    const inset = 0.18;  // distance from chamber end inward
    for (const zOff of [chZ - chH / 2 + inset, chZ + chH / 2 - inset]) {
      const g = new THREE.TorusGeometry(ringR, tubeR, 10, 28);
      const torus = _addShadow(new THREE.Mesh(g, _mat(coilColor, 0.55, 0.55)));
      // TorusGeometry is in XY plane (axis along +Z), wraps the beam axis.
      torus.position.set(0, BEAM_HEIGHT, zOff);
      group.add(torus);
    }
  }

  // ── Microwave waveguide — rectangular box entering rear-left of chamber ──
  {
    const wgW = 0.25, wgH = 0.25, wgL = 0.6;
    const g = new THREE.BoxGeometry(wgW, wgH, wgL);
    applyTiledBoxUVs(g, wgW, wgH, wgL);
    const wg = _addShadow(new THREE.Mesh(g, _mat(waveguideColor, 0.4, 0.6)));
    // Place to the rear-left of the chamber, axis aligned with beam (z direction).
    wg.position.set(-(chR + wgW / 2 + 0.02), BEAM_HEIGHT + 0.05, chZ - chH / 2 + wgL / 2);
    group.add(wg);
  }

  // ── Extraction stack — three copper plates of decreasing radius at front ──
  {
    const plateRs = [0.25, 0.18, 0.12];
    const plateH  = 0.04;
    const gap     = 0.06;
    const baseZ   = chZ + chH / 2 + flH;
    for (let i = 0; i < plateRs.length; i++) {
      const r = plateRs[i];
      const z = baseZ + plateH / 2 + i * (plateH + gap);
      const g = new THREE.CylinderGeometry(r, r, plateH, SEGS);
      applyTiledCylinderUVs(g, r, plateH, SEGS);
      const plate = _addShadow(new THREE.Mesh(g, _mat(copperC, 0.35, 0.6)));
      plate.rotation.x = Math.PI / 2;
      plate.position.set(0, BEAM_HEIGHT, z);
      group.add(plate);
    }
  }

  // RF vacuum window and a violet plasma viewport distinguish the microwave
  // source from a plain solenoid can.
  {
    const window = _addShadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.19, 0.035),
      _mat(0x6ca6d8, 0.18, 0.15),
    ));
    window.position.set(-(chR + 0.15), BEAM_HEIGHT + 0.05, chZ - chH / 2 + 0.31);
    group.add(window);
    const viewport = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 16),
      getGlowMaterial('ecrIonSource', 0xb34dff),
    );
    viewport.userData.role = 'glow';
    viewport.layers.enable(BLOOM_LAYER);
    viewport.rotation.y = Math.PI / 2;
    viewport.position.set(chR + 0.006, BEAM_HEIGHT + 0.08, chZ);
    group.add(viewport);
  }

  _addBeamSupport(group, chZ - 0.35);
  _addBeamSupport(group, chZ + 0.35);
  // ECR's 3 m footprint puts its authored exit at local z=1.5 m. Previously
  // the visible model stopped at the last extraction plate (z=0.69 m), leaving
  // a conspicuous gap even though the pipe state began at the correct port.
  _addSourceExit(group, 'ecrIonSource', 0.69);

  return group;
}

function _addAxialCylinder(group, {
  radius, length, z, color, roughness = 0.4, metalness = 0.45,
  radialSegments = SEGS, radiusBack = radius,
}) {
  const geometry = new THREE.CylinderGeometry(radius, radiusBack, length, radialSegments);
  applyTiledCylinderUVs(geometry, Math.max(radius, radiusBack), length, radialSegments);
  const mesh = _addShadow(new THREE.Mesh(geometry, _mat(color, roughness, metalness)));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(0, BEAM_HEIGHT, z);
  group.add(mesh);
  return mesh;
}

function _addSourceExit(group, sourceType, startZ) {
  const def = BEAMLINE_COMPONENTS_RAW[sourceType];
  const endZ = (def?.subL || 4) * SUB_UNIT / 2;
  const pipe = _addAxialCylinder(group, {
    radius: PIPE_R, length: Math.max(0.001, endZ - startZ), z: (startZ + endZ) / 2,
    color: PIPE_COLOR, roughness: 0.3, metalness: 0.55,
  });
  pipe.userData.beamPortName = 'exit';
  const flange = _addAxialCylinder(group, {
    radius: FLANGE_R, length: FLANGE_H, z: endZ,
    color: FLANGE_COLOR, roughness: 0.28, metalness: 0.6,
  });
  flange.userData.beamPortName = 'exit';
}

function _addSourceGlowDisc(group, id, color, radius, z, facing = 1) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, SEGS),
    getGlowMaterial(id, color),
  );
  disc.userData.role = 'glow';
  disc.layers.enable(BLOOM_LAYER);
  disc.castShadow = false;
  if (facing < 0) disc.rotation.y = Math.PI;
  disc.position.set(0, BEAM_HEIGHT, z);
  group.add(disc);
  return disc;
}

function _buildDcPhotoGun() {
  const group = new THREE.Group();
  const stainless = 0x93a7b1;
  const ceramic = 0xe7d9b0;
  const blue = 0x2779b8;

  // Broad ceramic HV column behind a compact stainless extraction chamber.
  _addAxialCylinder(group, { radius: 0.34, length: 0.55, z: -0.48, color: ceramic, roughness: 0.48, metalness: 0.03 });
  for (const z of [-0.72, -0.58, -0.44, -0.3]) {
    const shed = _addShadow(new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.035, 7, 22),
      _mat(0xcbb984, 0.5, 0.02),
    ));
    shed.position.set(0, BEAM_HEIGHT, z);
    group.add(shed);
  }
  _addAxialCylinder(group, { radius: 0.4, length: 0.62, z: 0.03, color: stainless, roughness: 0.28, metalness: 0.72 });
  _addAxialCylinder(group, { radius: 0.44, length: 0.05, z: -0.28, color: FLANGE_COLOR, roughness: 0.25, metalness: 0.68 });
  _addAxialCylinder(group, { radius: 0.44, length: 0.05, z: 0.34, color: FLANGE_COLOR, roughness: 0.25, metalness: 0.68 });

  // Laser injection arrives through a blue viewport on the service side.
  const laserTube = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.48, 12),
    _mat(blue, 0.22, 0.35),
  ));
  laserTube.rotation.z = Math.PI / 2;
  laserTube.position.set(-0.54, BEAM_HEIGHT + 0.14, -0.05);
  group.add(laserTube);
  const viewport = _addShadow(new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.025, 8, 18),
    _mat(FLANGE_COLOR, 0.25, 0.65),
  ));
  viewport.rotation.y = Math.PI / 2;
  viewport.position.set(-0.405, BEAM_HEIGHT + 0.14, -0.05);
  group.add(viewport);
  const laserSpot = new THREE.Mesh(
    new THREE.CircleGeometry(0.065, 16),
    getGlowMaterial('dcPhotoGun', 0x55d7ff),
  );
  laserSpot.userData.role = 'glow';
  laserSpot.layers.enable(BLOOM_LAYER);
  laserSpot.rotation.y = Math.PI / 2;
  laserSpot.position.set(-0.431, BEAM_HEIGHT + 0.14, -0.05);
  group.add(laserSpot);

  // Cathode/anode stack is visible as copper discs down the bore.
  _addAxialCylinder(group, { radius: 0.18, length: 0.035, z: -0.22, color: 0xb87333, roughness: 0.3, metalness: 0.72 });
  _addAxialCylinder(group, { radius: 0.15, length: 0.035, z: 0.28, color: 0xb87333, roughness: 0.3, metalness: 0.72 });
  _addSourceGlowDisc(group, 'dcPhotoGun', 0x7be8ff, 0.075, -0.198);
  _addSourceExit(group, 'dcPhotoGun', 0.37);
  _addBeamSupport(group, -0.42);
  _addBeamSupport(group, 0.22);
  return group;
}

function _buildNcRfGun() {
  const group = new THREE.Group();
  const copper = 0xc87532;
  const darkCopper = 0x75401f;

  // Two unequal copper cells give the gun its characteristic photoinjector
  // profile instead of another generic pressure vessel.
  _addAxialCylinder(group, { radius: 0.34, length: 0.38, z: -0.38, color: copper, roughness: 0.3, metalness: 0.75, radiusBack: 0.27 });
  _addAxialCylinder(group, { radius: 0.43, length: 0.46, z: 0.03, color: copper, roughness: 0.28, metalness: 0.78, radiusBack: 0.36 });
  for (const z of [-0.58, -0.18, 0.27]) {
    _addAxialCylinder(group, { radius: z === 0.27 ? 0.46 : 0.39, length: 0.045, z, color: darkCopper, roughness: 0.35, metalness: 0.68 });
  }

  // Rectangular S-band coupler and water manifolds.
  const coupler = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.28, 0.42),
    _mat(0xc2a453, 0.35, 0.58),
  ));
  coupler.position.set(0.5, BEAM_HEIGHT + 0.08, 0.02);
  group.add(coupler);
  const iris = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.16, 0.23),
    _mat(0x5b331f, 0.38, 0.6),
  ));
  iris.position.set(0.39, BEAM_HEIGHT + 0.08, 0.02);
  group.add(iris);
  for (const x of [-0.3, 0.3]) {
    const water = _addShadow(new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.025, 7, 20),
      _mat(0x2879a5, 0.3, 0.45),
    ));
    water.position.set(0, BEAM_HEIGHT, x);
    group.add(water);
  }

  _addSourceGlowDisc(group, 'ncRfGun', 0xffb34e, 0.075, -0.605, -1);
  _addSourceExit(group, 'ncRfGun', 0.3);
  _addBeamSupport(group, -0.38);
  _addBeamSupport(group, 0.13);
  return group;
}

function _buildSrfGun() {
  const group = new THREE.Group();
  const cryostat = 0xb7c4d2;
  const niobium = 0x7d90b8;

  // Long helium vessel with bell-shaped cavity cells visible as raised bands.
  _addAxialCylinder(group, { radius: 0.48, length: 1.5, z: -0.05, color: cryostat, roughness: 0.22, metalness: 0.72 });
  for (const z of [-0.48, -0.05, 0.38]) {
    const cell = _addShadow(new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.075, 10, 28),
      _mat(niobium, 0.24, 0.8),
    ));
    cell.position.set(0, BEAM_HEIGHT, z);
    group.add(cell);
  }
  for (const z of [-0.8, 0.7]) {
    _addAxialCylinder(group, { radius: 0.52, length: 0.06, z, color: FLANGE_COLOR, roughness: 0.25, metalness: 0.72 });
  }

  // Top cryogenic turret and side RF fundamental power coupler.
  const turret = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.52, 14),
    _mat(0x6a82aa, 0.3, 0.62),
  ));
  turret.position.set(0, BEAM_HEIGHT + 0.58, -0.2);
  group.add(turret);
  const cryoPipe = _addShadow(new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.035, 8, 18, Math.PI),
    _mat(0x79b9dd, 0.26, 0.58),
  ));
  cryoPipe.rotation.z = Math.PI / 2;
  cryoPipe.position.set(0.17, BEAM_HEIGHT + 0.82, -0.2);
  group.add(cryoPipe);
  const coupler = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.26),
    _mat(0xc2a453, 0.34, 0.62),
  ));
  coupler.position.set(0.55, BEAM_HEIGHT + 0.05, 0.38);
  group.add(coupler);

  _addSourceGlowDisc(group, 'srfGun', 0x8ec8ff, 0.07, -0.835, -1);
  _addSourceExit(group, 'srfGun', 0.73);
  _addBeamSupport(group, -0.55);
  _addBeamSupport(group, 0.45);
  return group;
}

function _buildPenningIonSource() {
  const group = new THREE.Group();
  const yoke = 0x493d64;
  const steel = 0x718398;

  // Rectangular permanent-magnet return yoke around a narrow discharge tube.
  for (const x of [-0.34, 0.34]) {
    const side = _addShadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.72, 0.82),
      _mat(yoke, 0.5, 0.42),
    ));
    side.position.set(x, BEAM_HEIGHT, -0.16);
    group.add(side);
  }
  for (const y of [BEAM_HEIGHT - 0.36, BEAM_HEIGHT + 0.36]) {
    const bridge = _addShadow(new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.16, 0.82),
      _mat(yoke, 0.5, 0.42),
    ));
    bridge.position.set(0, y, -0.16);
    group.add(bridge);
  }
  _addAxialCylinder(group, { radius: 0.22, length: 0.9, z: -0.16, color: steel, roughness: 0.34, metalness: 0.58 });

  // Opposed cathode stalks and a visible magenta plasma aperture.
  for (const x of [-0.27, 0.27]) {
    const cathode = _addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.28, 10),
      _mat(0xb87333, 0.32, 0.68),
    ));
    cathode.rotation.z = Math.PI / 2;
    cathode.position.set(x / 2, BEAM_HEIGHT, -0.38);
    group.add(cathode);
  }
  _addSourceGlowDisc(group, 'penningIonSource', 0xd95cff, 0.09, 0.315);
  for (const z of [0.35, 0.43]) {
    _addAxialCylinder(group, { radius: z === 0.35 ? 0.18 : 0.13, length: 0.035, z, color: 0xb87333, roughness: 0.3, metalness: 0.7 });
  }
  _addSourceExit(group, 'penningIonSource', 0.46);
  _addBeamSupport(group, -0.38);
  _addBeamSupport(group, 0.2);
  return group;
}

function _buildDrift() {
  const group = new THREE.Group();

  const pipeL = 2.0; // full tile length so adjacent pipes meet flush

  // Main vacuum pipe — standard bore at standard height
  const driftPipeGeo = new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS);
  applyTiledCylinderUVs(driftPipeGeo, PIPE_R, pipeL, SEGS);
  const pipe = _addShadow(new THREE.Mesh(driftPipeGeo, _mat(PIPE_COLOR, 0.3, 0.5)));
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0, BEAM_HEIGHT, 0);
  group.add(pipe);

  // CF flanges at each end with bolt holes and bore opening
  for (const sign of [-1, 1]) {
    const driftFlangeGeo = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(driftFlangeGeo, FLANGE_R, FLANGE_H, SEGS);
    const flange = _addShadow(new THREE.Mesh(driftFlangeGeo, _mat(FLANGE_COLOR, 0.3, 0.6)));
    flange.rotation.x = Math.PI / 2;
    flange.position.set(0, BEAM_HEIGHT, sign * pipeL / 2);
    group.add(flange);

    // Dark bore opening on flange face — makes pipe look hollow
    const bore = new THREE.Mesh(
      new THREE.CircleGeometry(PIPE_R * 0.85, SEGS),
      _mat(0x111111, 0.9, 0.0),
    );
    // CircleGeometry faces +Z; flip for -Z end
    if (sign < 0) bore.rotation.y = Math.PI;
    bore.position.set(0, BEAM_HEIGHT, sign * (pipeL / 2 + FLANGE_H / 2 + 0.001));
    bore.userData.lod = 'detail';
    group.add(bore);

    _addBoltHoles(group, 0, BEAM_HEIGHT, sign * pipeL / 2, sign);
  }

  // Support stands — two per tile, each with two legs, foot plate, and crossbars
  _addBeamSupport(group, -0.45); // front support
  _addBeamSupport(group,  0.45); // rear support

  return group;
}

/**
 * Add bolt hole details on a CF flange face.
 * Small dark cylinders arranged in a circle on the flange surface.
 */
function _addBoltHoles(group, x, y, z, sign) {
  const boltCount = 6;
  const boltR = 0.012;
  const boltDepth = 0.02;
  const boltCircleR = (PIPE_R + FLANGE_R) / 2; // midway between pipe and flange edge
  const boltMat = _mat(0x333333, 0.8, 0.2);

  for (let i = 0; i < boltCount; i++) {
    const angle = (i / boltCount) * Math.PI * 2;
    const bx = x + Math.cos(angle) * boltCircleR;
    const by = y + Math.sin(angle) * boltCircleR;
    const boltGeo = new THREE.CylinderGeometry(boltR, boltR, boltDepth, 6);
    applyTiledCylinderUVs(boltGeo, boltR, boltDepth, 6);
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(bx, by, z + sign * (FLANGE_H / 2 + 0.001));
    bolt.userData.lod = 'detail'; // only visible when zoomed in
    group.add(bolt);
  }
}

/**
 * Add a realistic beam pipe support at a given Z offset.
 * Two vertical legs extend from floor to above the pipe, with a top crossbar
 * sitting just above the pipe (not intersecting it) and a lower brace near the floor.
 */
function _addBeamSupport(group, zPos) {
  const legW = 0.04;          // leg cross-section
  const legSpacing = 0.28;    // distance between legs (wider than pipe diameter)
  const topOfPipe = BEAM_HEIGHT + PIPE_R;
  const barH = 0.03;          // crossbar thickness
  const barD = 0.04;          // crossbar depth along beam axis
  const legH = topOfPipe + barH; // legs reach up to underside of top crossbar
  const barW = legSpacing + legW; // crossbar spans between leg outsides

  // Two vertical legs — full height from floor to top crossbar
  for (const side of [-1, 1]) {
    const supportLegGeo = new THREE.BoxGeometry(legW, legH, legW);
    applyTiledBoxUVs(supportLegGeo, legW, legH, legW);
    const leg = _addShadow(new THREE.Mesh(supportLegGeo, _mat(STAND_COLOR, 0.7, 0.1)));
    leg.position.set(side * legSpacing / 2, legH / 2, zPos);
    group.add(leg);
  }

  // Top crossbar — sits just above the pipe
  const topBarGeo = new THREE.BoxGeometry(barW, barH, barD);
  applyTiledBoxUVs(topBarGeo, barW, barH, barD);
  const topBar = _addShadow(new THREE.Mesh(topBarGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  topBar.position.set(0, topOfPipe + barH / 2, zPos);
  group.add(topBar);

  // Bottom crossbar — sits just below the pipe
  const bottomBarGeo = new THREE.BoxGeometry(barW, barH, barD);
  applyTiledBoxUVs(bottomBarGeo, barW, barH, barD);
  const bottomBar = _addShadow(new THREE.Mesh(bottomBarGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  bottomBar.position.set(0, BEAM_HEIGHT - PIPE_R - barH / 2, zPos);
  group.add(bottomBar);

  // Lower brace (near floor)
  const lowerBarGeo = new THREE.BoxGeometry(barW, barH, barD);
  applyTiledBoxUVs(lowerBarGeo, barW, barH, barD);
  const lowerBar = _addShadow(new THREE.Mesh(lowerBarGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  lowerBar.position.set(0, 0.08, zPos);
  group.add(lowerBar);

  // Small foot plate
  const footW = legSpacing + legW + 0.04;
  const footGeo = new THREE.BoxGeometry(footW, 0.02, 0.08);
  applyTiledBoxUVs(footGeo, footW, 0.02, 0.08);
  const foot = _addShadow(new THREE.Mesh(footGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  foot.position.set(0, 0.01, zPos);
  group.add(foot);
}

// ── Role-based builders (template pattern) ──────────────────────────
// These return BufferGeometry buckets rather than assembled Groups.
// Individual primitives are built, positioned via a Matrix4, and baked
// into the geometry so they can be merged per role.

function _pushTransformed(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

/**
 * Build the role buckets for a C-clamp magnet. The C opens toward local
 * -X. Dipoles use `bentPipe: true`, which routes the internal beam pipe
 * as an L (entry on local -Z, exit on local -X), visually showing the
 * 90° bend toward the open side of the C. Quadrupoles share the same
 * yoke/coils/supports as a placeholder but keep a straight pipe.
 *
 * Physical layout (1m × 1m × 1m, beam along local +Z):
 *   - C-shaped painted iron clamp: a spine on +X with top and bottom arms
 *     extending toward -X, forming a gap the beam pipe passes through.
 *   - Two rectangular copper coil bars on the inner faces of the arms,
 *     running the full length of the magnet.
 *   - Beam pipe: straight for quads, L-shaped 90° bend for dipoles.
 *   - Simple pedestal supports at each end: foot plate with two columns
 *     rising to the underside of the bottom arm.
 */
function _buildCClampRoles(bentPipe) {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
  const m4 = new THREE.Matrix4();

  // 1-tile footprint: 2×2 sub-units (1m) in both X and Z.
  const yokeOuter = 0.4;    // half-extent of the yoke in X and Y
  const wall      = 0.12;   // yoke slab thickness
  const magL      = 1.0;    // full tile depth — adjacent quads touch face-to-face
  const backX     = yokeOuter - wall / 2;    // X center of the C's spine (+X side)
  const armY      = yokeOuter - wall / 2;    // Y offset of the top/bottom arm centers
  const armW      = 2 * yokeOuter - wall;    // X span of the arms (stops at spine's inner face)
  const armCx     = -wall / 2;               // X center of the arms

  // --- Painted yoke (accent role) ---
  // Spine: vertical slab on +X
  {
    const g = new THREE.BoxGeometry(wall, 2 * yokeOuter, magL);
    applyTiledBoxUVs(g, wall, 2 * yokeOuter, magL);
    m4.makeTranslation(backX, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.accent, g, m4);
  }
  // Top and bottom arms: horizontal slabs forming the C's jaws
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(armW, wall, magL);
    applyTiledBoxUVs(g, armW, wall, magL);
    m4.makeTranslation(armCx, BEAM_HEIGHT + sign * armY, 0);
    _pushTransformed(buckets.accent, g, m4);
  }

  // --- Copper coils (copper role) ---
  // Two rectangular copper bars sitting on the inner faces of the top and
  // bottom arms, running the full length of the magnet.
  const coilW = 0.26;
  const coilH = 0.1;
  const coilYOff = yokeOuter - wall - coilH / 2;
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(coilW, coilH, magL);
    applyTiledBoxUVs(g, coilW, coilH, magL);
    m4.makeTranslation(armCx, BEAM_HEIGHT + sign * coilYOff, 0);
    _pushTransformed(buckets.copper, g, m4);
  }

  // --- Beam pipe through the C gap (pipe role) ---
  if (bentPipe) {
    // Dipole: L-shaped 90° bend. Entry half runs from the yoke's back
    // face (local -Z) to the centre; exit half runs from the centre out
    // to the open side of the C (local -X). Each half is magL/2 long so
    // the full arc sits inside the yoke footprint.
    const halfL = magL / 2;
    // Entry segment along +Z (cylinder default axis is +Y, rotate X +90°)
    {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, halfL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, halfL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, -halfL / 2);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    // Exit segment along -X (rotate Z +90° — the cylinder axis becomes the X axis)
    {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, halfL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, halfL, SEGS);
      const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(-halfL / 2, BEAM_HEIGHT, 0);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    // Small spherical joint at the bend corner to hide the seam
    {
      const g = new THREE.SphereGeometry(PIPE_R, SEGS, SEGS);
      m4.makeTranslation(0, BEAM_HEIGHT, 0);
      _pushTransformed(buckets.pipe, g, m4);
    }
  } else {
    // Quadrupole (placeholder): straight pipe through the centre.
    const pipeGeom = new THREE.CylinderGeometry(PIPE_R, PIPE_R, magL, SEGS);
    applyTiledCylinderUVs(pipeGeom, PIPE_R, magL, SEGS);
    m4.identity();
    m4.makeRotationX(Math.PI / 2);
    const pipeT = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    const pipeFull = new THREE.Matrix4().multiplyMatrices(pipeT, m4);
    _pushTransformed(buckets.pipe, pipeGeom, pipeFull);
  }

  // --- Pedestal supports (stand role) ---
  // Simple pedestal at each end: wide foot plate with two thin columns
  // rising to the underside of the bottom arm.
  const sBaseH = 0.06;
  const sColW  = 0.1;
  const sColD  = 0.16;
  const sColX  = 0.24;
  const sTopY  = BEAM_HEIGHT - yokeOuter;   // bottom face of the C's bottom arm
  const sColH  = sTopY - sBaseH;
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (magL / 2 - sColD / 2 - 0.04);
    const baseW = sColX * 2 + sColW + 0.12;
    const baseD = sColD + 0.04;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    m4.makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, m4);
    for (const side of [-1, 1]) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      m4.makeTranslation(side * sColX, sBaseH + sColH / 2, zPos);
      _pushTransformed(buckets.stand, col, m4);
    }
  }

  return buckets;
}

// Dipole: C-clamp with an L-shaped beam pipe (bent toward the open side).
function _buildDipoleRoles() { return _buildCClampRoles(true); }
ROLE_BUILDERS.dipole = _buildDipoleRoles;

/**
 * Proper 4-pole quadrupole magnet, diamond-rotated around the beam axis.
 *
 * The whole yoke+poles+coils assembly is rotated 45° about Z (the beam
 * axis), so the square steel return yoke sits as a diamond with a vertex
 * pointing straight down — the orientation you commonly see on real
 * beamlines where the magnet rests on a pedestal cradling the lower
 * vertex. Pole tips project radially toward the beam pipe at cardinal
 * angles (top/bottom/left/right) after the 45° rotation — i.e., they
 * start life at 45°/135°/225°/315° in the unrotated frame.
 *
 * Footprint: 1m along X, 1m along Y (diameter of the diamond), 1m along Z.
 */
function _buildQuadrupoleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
  const m4 = new THREE.Matrix4();

  const magL  = 1.0;   // full tile depth along beam (+Z) so neighbors butt flush
  const zRot  = Math.PI / 4; // diamond rotation around the beam axis

  // Apply the diamond rotation to any (x, y) offset in the unrotated
  // square frame. We build the yoke/poles/coils in an axis-aligned frame
  // (simpler math) and push them into buckets with this rotation baked in
  // so the merged geometry is already in the correct diamond orientation.
  function pushRotated(bucket, geom, localX, localY, zOff, extraRotZ = 0) {
    // Box's local axes: +X right, +Y up, +Z along beam. After rotating by
    // (zRot + extraRotZ) around Z, a local +Y originally pointing "up" in
    // the unrotated frame points outward toward one of the diamond faces.
    const rot = new THREE.Matrix4().makeRotationZ(zRot + extraRotZ);
    const cx =  Math.cos(zRot) * localX - Math.sin(zRot) * localY;
    const cy =  Math.sin(zRot) * localX + Math.cos(zRot) * localY;
    const trans = new THREE.Matrix4().makeTranslation(cx, BEAM_HEIGHT + cy, zOff);
    _pushTransformed(bucket, geom, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // --- Square iron return yoke (accent) ---
  // Built as 4 slabs forming a hollow square of outer half-extent `yokeOuter`
  // and inner half-extent `yokeInner`. After the 45° rotation it reads as a
  // hollow diamond. Pole tips extend inward from the midpoints of each side,
  // so (unrotated) we leave the midpoints of each slab open for the poles to
  // plug into seamlessly.
  const yokeOuter = 0.48;
  const wall      = 0.14;
  const slabLen   = 2 * yokeOuter; // full side of the square
  // Top and bottom slabs
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(slabLen, wall, magL);
    applyTiledBoxUVs(g, slabLen, wall, magL);
    pushRotated(buckets.accent, g, 0, sign * (yokeOuter - wall / 2), 0);
  }
  // Left and right slabs (shorter so they don't overlap top/bottom)
  for (const sign of [1, -1]) {
    const shortLen = slabLen - 2 * wall;
    const g = new THREE.BoxGeometry(wall, shortLen, magL);
    applyTiledBoxUVs(g, wall, shortLen, magL);
    pushRotated(buckets.accent, g, sign * (yokeOuter - wall / 2), 0, 0);
  }

  // --- Four iron pole tips ---
  // In the unrotated frame, one pole per side of the square pointing toward
  // the centre. After rotation they sit at top/bottom/left/right around the
  // beam pipe. Each pole is a box whose "long" axis is radial.
  const poleTipR   = PIPE_R + 0.04;          // air gap between tip and beam pipe
  const poleBaseR  = yokeOuter - wall;       // pole root at inner yoke face
  const poleLen    = poleBaseR - poleTipR;
  const poleW      = 0.28;                    // tangential width
  // Top/bottom poles: Y is the radial direction
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(poleW, poleLen, magL);
    applyTiledBoxUVs(g, poleW, poleLen, magL);
    pushRotated(buckets.iron, g, 0, sign * (poleTipR + poleLen / 2), 0);
  }
  // Left/right poles: X is the radial direction — use a sideways box
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(poleLen, poleW, magL);
    applyTiledBoxUVs(g, poleLen, poleW, magL);
    pushRotated(buckets.iron, g, sign * (poleTipR + poleLen / 2), 0, 0);
  }

  // --- Copper racetrack coils (one pair of long bars per pole) ---
  // Two parallel bars per pole, flanking the pole tangentially, running the
  // full magnet length along Z. Chunky enough to read as wound copper.
  const coilBarW   = 0.10;                  // cross-section width
  const coilBarH   = poleLen * 0.85;
  const coilTanOff = poleW / 2 + coilBarW / 2 + 0.005;
  const coilRadC   = poleTipR + poleLen / 2; // radial centre matches pole
  for (const sign of [1, -1]) {
    for (const tSign of [-1, 1]) {
      // Top/bottom poles: radial = Y, tangential = X
      {
        const g = new THREE.BoxGeometry(coilBarW, coilBarH, magL);
        applyTiledBoxUVs(g, coilBarW, coilBarH, magL);
        pushRotated(buckets.copper, g, tSign * coilTanOff, sign * coilRadC, 0);
      }
      // Left/right poles: radial = X, tangential = Y — swap box dims
      {
        const g = new THREE.BoxGeometry(coilBarH, coilBarW, magL);
        applyTiledBoxUVs(g, coilBarH, coilBarW, magL);
        pushRotated(buckets.copper, g, sign * coilRadC, tSign * coilTanOff, 0);
      }
    }
  }

  // --- Straight beam pipe through the centre (pipe) ---
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, magL, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, magL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // --- Pedestal supports (stand) ---
  // The diamond's lowest point is at y = BEAM_HEIGHT - yokeOuter*sqrt(2).
  // We cradle the lower V-faces of the diamond with two angled pedestals at
  // each Z end. For simplicity, use a wide flat base plate at floor level
  // plus a central column rising to just under the lower vertex.
  const diamondBottomY = BEAM_HEIGHT - yokeOuter * Math.SQRT2;
  const sBaseH = 0.06;
  const sColW  = 0.26;
  const sColD  = 0.18;
  const sColH  = Math.max(0.04, diamondBottomY - sBaseH);
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (magL / 2 - sColD / 2 - 0.04);
    const baseW = sColW + 0.2;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    const bt = new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, bt);
    if (sColH > 0.05) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      const ct = new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos);
      _pushTransformed(buckets.stand, col, ct);
    }
  }

  return buckets;
}
ROLE_BUILDERS.quadrupole = _buildQuadrupoleRoles;
ROLE_BUILDERS.sextupole = _buildSextupoleRoles;
ROLE_BUILDERS.injectionSeptum = _buildInjectionSeptumRoles;
ROLE_BUILDERS.combinedFunctionMagnet = _buildCombinedFunctionMagnetRoles;
ROLE_BUILDERS.chicane = _buildChicaneRoles;
ROLE_BUILDERS.undulator = _buildUndulatorRoles;
ROLE_BUILDERS.energyDegrader = _buildEnergyDegraderRoles;
ROLE_BUILDERS.scanningMagnet = _buildScanningMagnetRoles;
ROLE_BUILDERS.dcInjector = _buildDcInjectorRoles;
ROLE_BUILDERS.solenoid = _buildSolenoidRoles;
ROLE_BUILDERS.collimator = _buildCollimatorRoles;
ROLE_BUILDERS.aperture = _buildApertureRoles;
ROLE_BUILDERS.velocitySelector = _buildVelocitySelectorRoles;
ROLE_BUILDERS.emittanceFilter = _buildEmittanceFilterRoles;

/**
 * Bellows Section — compact 0.25 m corrugated vacuum coupling.
 *
 * A stack of torus rings produces the accordion silhouette. Flanges at
 * both ends keep the coupling readable without filling the 0.5 m visual
 * subtile around its inline anchor. No support stand — bellows normally hangs
 * between its neighbors.
 */
function _buildBellowsRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const visualHalf = 0.125;                 // compact ±0.125 m envelope around the point slot
  const flangeZ   = visualHalf - FLANGE_H / 2;
  const bellowsL  = 0.12;                   // short accordion between the two end flanges
  const ringInner = PIPE_R;                  // inner bore radius
  const ringOuter = PIPE_R * 2.4;            // outer accordion radius
  const tube      = (ringOuter - ringInner) / 2;
  const ringCentR = ringInner + tube;
  const ringCount = 4;
  const ringSegs  = 10;
  const tubeSegs  = 12;

  // Thin smooth inner sleeve so the vacuum space is visibly a closed tube
  // rather than seeing straight through the gaps between rings.
  {
    const g = new THREE.CylinderGeometry(PIPE_R * 0.98, PIPE_R * 0.98, bellowsL + 0.01, SEGS);
    applyTiledCylinderUVs(g, PIPE_R * 0.98, bellowsL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Corrugation rings — TorusGeometry default lies in XY plane (axis +Z),
  // which is exactly the beam axis, so no rotation is needed.
  for (let i = 0; i < ringCount; i++) {
    const t = (i + 0.5) / ringCount;         // 0..1 along the bellows span
    const z = -bellowsL / 2 + t * bellowsL;
    const g = new THREE.TorusGeometry(ringCentR, tube, tubeSegs, ringSegs);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.pipe, g, trans);
  }

  // CF flanges at the compact visual ends. The attachment's inline point slot,
  // rather than this mesh envelope, owns longitudinal placement occupancy.
  for (const sign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * flangeZ);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  return buckets;
}
ROLE_BUILDERS.bellows = _buildBellowsRoles;
ROLE_BUILDERS.bpm = _buildBPMRoles;
ROLE_BUILDERS.ict = _buildICTRoles;
ROLE_BUILDERS.screen = _buildScreenRoles;
ROLE_BUILDERS.wireScanner = _buildWireScannerRoles;
ROLE_BUILDERS.piraniGauge = _buildPiraniGaugeRoles;
ROLE_BUILDERS.coldCathodeGauge = _buildColdCathodeGaugeRoles;
ROLE_BUILDERS.baGauge = _buildBAGaugeRoles;
ROLE_BUILDERS.gateValve = _buildGateValveRoles;
ROLE_BUILDERS.roughingPump = _buildRoughingPumpRoles;
ROLE_BUILDERS.roughingPumpCart = _buildRoughingPumpCartRoles;
ROLE_BUILDERS.turboPump = _buildTurboPumpRoles;
ROLE_BUILDERS.turboPumpCart = _buildTurboPumpCartRoles;
ROLE_BUILDERS.vacuumCart = _buildVacuumCartRoles;
ROLE_BUILDERS.highCapacityVacuumStation = _buildHighCapacityVacuumStationRoles;
ROLE_BUILDERS.vacuumManifold = _buildVacuumManifold4Roles;
ROLE_BUILDERS.vacuumManifold8 = _buildVacuumManifold8Roles;
ROLE_BUILDERS.ionPump = _buildIonPumpRoles;
ROLE_BUILDERS.negPump = _buildNEGPumpRoles;
ROLE_BUILDERS.tiSubPump = _buildTiSubPumpRoles;
ROLE_BUILDERS.ln2Dewar = _buildLN2DewarRoles;
ROLE_BUILDERS.cryocooler = _buildCryocoolerRoles;
ROLE_BUILDERS.ln2Precooler = _buildLN2PrecoolerRoles;
ROLE_BUILDERS.heRecovery = _buildHeRecoveryRoles;
ROLE_BUILDERS.heRecoveryHeader = _buildHeRecoveryHeaderRoles;
ROLE_BUILDERS.heGasBag = _buildHeGasBagRoles;
ROLE_BUILDERS.hePurifier = _buildHePurifierRoles;
ROLE_BUILDERS.heLiquefier = _buildHeLiquefierRoles;
ROLE_BUILDERS.coldBox4K = _buildColdBox4KRoles;
ROLE_BUILDERS.coldBox2K = _buildColdBox2KRoles;
ROLE_BUILDERS.heCompressor = _buildHeCompressorRoles;
ROLE_BUILDERS.cryomoduleHousing = _buildCryomoduleHousingRoles;
ROLE_BUILDERS.cryoValveBox = _buildCryoValveBoxRoles;
ROLE_BUILDERS.waterLoad = _buildWaterLoadRoles;
ROLE_BUILDERS.fanCoilCooler = _buildFanCoilCoolerRoles;
ROLE_BUILDERS.packageChiller = _buildPackageChillerRoles;
ROLE_BUILDERS.dualCircuitChiller = _buildDualCircuitChillerRoles;
ROLE_BUILDERS.dryCoolerBank = _buildDryCoolerBankRoles;
ROLE_BUILDERS.lcwSkid = _buildLcwSkidRoles;
ROLE_BUILDERS.chiller = _buildChillerRoles;
ROLE_BUILDERS.coolingTower = _buildCoolingTowerRoles;
ROLE_BUILDERS.deionizer = _buildDeioniserRoles;
ROLE_BUILDERS.emergencyCooling = _buildEmergencyCoolingRoles;
ROLE_BUILDERS.coolingManifold = _buildCoolingManifoldRoles;
ROLE_BUILDERS.slac5045Klystron = _buildSLAC5045KlystronRoles;
ROLE_BUILDERS.pulsedKlystron = _buildPulsedKlystronRoles;
ROLE_BUILDERS.cwKlystron = _buildCWKlystronRoles;
ROLE_BUILDERS.multibeamKlystron = _buildMultibeamKlystronRoles;
ROLE_BUILDERS.magnetron = _buildMagnetronRoles;
ROLE_BUILDERS.twt = _buildTWTRoles;
ROLE_BUILDERS.widebandDriverAmp = _buildTWTRoles;
ROLE_BUILDERS.iot = _buildIOTRoles;
ROLE_BUILDERS.circulator = _buildCirculatorRoles;
ROLE_BUILDERS.rfCoupler = _buildRFCouplerRoles;
ROLE_BUILDERS.gyrotron = _buildGyrotronRoles;
ROLE_BUILDERS.solidStateAmp = _buildSolidStateAmpRoles;
ROLE_BUILDERS.lowBandBuncherAmp = _buildSolidStateAmpRoles;
ROLE_BUILDERS.highPowerSSA = _buildHighPowerSSARoles;
ROLE_BUILDERS.modulator = _buildModulatorRoles;
ROLE_BUILDERS.llrfController = _buildLLRFControllerRoles;
ROLE_BUILDERS.waveguideManifold = _buildWaveguideManifoldRoles;
ROLE_BUILDERS.hvTransformer = _buildHVTransformerRoles;
ROLE_BUILDERS.facilityTransformer = _buildHVTransformerRoles;
ROLE_BUILDERS.gridIntertieTransformer = _buildHVTransformerRoles;
ROLE_BUILDERS.disconnectSwitch = _buildDisconnectSwitchRoles;
ROLE_BUILDERS.compactHvDistributor = _buildCompactHvDistributorRoles;
ROLE_BUILDERS.switchgear = _buildSwitchgearRoles;
ROLE_BUILDERS.padMountTransformer = _buildPadMountTransformerRoles;
ROLE_BUILDERS.mcc = _buildMCCRoles;
ROLE_BUILDERS.ups = _buildUPSRoles;
ROLE_BUILDERS.powerPanel = _buildCompactDistributionPanelRoles;
ROLE_BUILDERS.sectionDistributionPanel = _buildSectionDistributionPanelRoles;
ROLE_BUILDERS.mainDistributionPanel = _buildMainDistributionPanelRoles;
ROLE_BUILDERS.powerBus = _buildPowerBusRoles;
ROLE_BUILDERS.spiderBox = _buildSpiderBoxRoles;
ROLE_BUILDERS.vanDeGraaff = _buildVanDeGraaffRoles;
ROLE_BUILDERS.cockcroftWalton = _buildCockcroftWaltonRoles;
ROLE_BUILDERS.cyclotron30 = _buildCyclotron30Roles;
ROLE_BUILDERS.cyclotron70 = _buildCyclotron70Roles;
ROLE_BUILDERS.cyclotron230 = _buildCyclotron230Roles;
ROLE_BUILDERS.protonLinacFrontEnd = _buildProtonLinacFrontEndRoles;
ROLE_BUILDERS.lwfaStation = _buildLwfaStationRoles;
ROLE_BUILDERS.positronSource = _buildPositronSourceRoles;
ROLE_BUILDERS.industrialLinac = _buildIndustrialLinacRoles;
ROLE_BUILDERS.dtl = _buildDtlRoles;
ROLE_BUILDERS.cryomodule = _buildCryomoduleRoles;

// Phase 6: carrierRack removed with the legacy rack-paint system. The role
// builder and its constants are gone.

/**
 * RFQ (Radio-Frequency Quadrupole) — long copper accelerating structure.
 *
 * Physically the thing is a chunky horizontal cavity vessel with tuning
 * plungers poking out the top, an RF drive waveguide coming in from the
 * side, and multiple support pedestals underneath. Footprint in sub-units:
 * subW=4, subL=6 → 2 m × 3 m; the beam runs along the long axis (+Z).
 */
function _buildRFQRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL    = 3.0;     // full component length along beam
  const bodyR   = 0.55;    // outer radius of the main copper body
  const bodyL   = magL - 2 * FLANGE_H - 0.1;
  const ribR    = bodyR + 0.05;
  const ribH    = 0.06;
  const ribCount = 5;

  // Main copper body — one long cylinder along +Z
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyL, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Rib rings — slightly wider short cylinders suggesting segment joints
  for (let i = 0; i < ribCount; i++) {
    const t = (i + 0.5) / ribCount;
    const z = -bodyL / 2 + t * bodyL;
    const g = new THREE.CylinderGeometry(ribR, ribR, ribH, SEGS);
    applyTiledCylinderUVs(g, ribR, ribH, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Tuning plungers — short vertical piston stubs along the top centre line
  const plungerCount = 8;
  const plungerR = 0.09;
  const plungerH = 0.35;
  const plungerBaseY = BEAM_HEIGHT + bodyR;
  for (let i = 0; i < plungerCount; i++) {
    const t = (i + 0.5) / plungerCount;
    const z = -bodyL / 2 + t * bodyL;
    // Body
    const g = new THREE.CylinderGeometry(plungerR, plungerR, plungerH, SEGS);
    applyTiledCylinderUVs(g, plungerR, plungerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, plungerBaseY + plungerH / 2, z);
    _pushTransformed(buckets.iron, g, trans);
    // Cap flange at the top of each plunger
    const capGeo = new THREE.CylinderGeometry(plungerR * 1.4, plungerR * 1.4, 0.035, SEGS);
    applyTiledCylinderUVs(capGeo, plungerR * 1.4, 0.035, SEGS);
    const capTrans = new THREE.Matrix4().makeTranslation(0, plungerBaseY + plungerH + 0.018, z);
    _pushTransformed(buckets.detail, capGeo, capTrans);
  }

  // RF drive waveguide — rectangular stub sticking out the -X side near
  // the upstream (-Z) end, ending in a flanged coupling box.
  {
    const wgW = 0.34, wgH = 0.18, wgL = 0.5;
    const wgZ = -bodyL / 2 + 0.6;
    const wgX = -(bodyR + wgL / 2);
    const g = new THREE.BoxGeometry(wgL, wgH, wgW);
    applyTiledBoxUVs(g, wgL, wgH, wgW);
    const trans = new THREE.Matrix4().makeTranslation(wgX, BEAM_HEIGHT, wgZ);
    _pushTransformed(buckets.accent, g, trans);
    // End-cap flange block
    const capW = 0.42, capH = 0.26, capL = 0.06;
    const capG = new THREE.BoxGeometry(capL, capH, capW);
    applyTiledBoxUVs(capG, capL, capH, capW);
    const capTrans = new THREE.Matrix4().makeTranslation(wgX - wgL / 2 - capL / 2, BEAM_HEIGHT, wgZ);
    _pushTransformed(buckets.detail, capG, capTrans);
  }

  // End flanges + beam pipe stubs reaching to the tile edges (±magL/2)
  const tileEdge = magL / 2;
  for (const sign of [-1, 1]) {
    const stubStart = bodyL / 2;
    const stubL = tileEdge - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Four support pedestals evenly spaced under the cavity
  const supportCount = 4;
  const sBaseH = 0.06;
  const sColW  = 0.24;
  const sColD  = 0.2;
  const sColH  = BEAM_HEIGHT - bodyR - sBaseH;
  for (let i = 0; i < supportCount; i++) {
    const t = (i + 0.5) / supportCount;
    const zPos = -bodyL / 2 + t * bodyL;
    const baseW = sColW + 0.18;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    const bt = new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, bt);
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    const ct = new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos);
    _pushTransformed(buckets.stand, col, ct);
  }

  return buckets;
}
ROLE_BUILDERS.rfq = _buildRFQRoles;

/**
 * NC RF Cavity (rfCavity) — multi-cell standing-wave copper structure.
 *
 * Six chunky copper cells strung along the beam like beads — the visual
 * signature of a standing-wave structure. Each cell carries its own small
 * tuning plunger. The routed rfWaveguide utility terminates directly on the
 * cavity skin; this builder deliberately does not grow a fake external feed.
 * Footprint: subW=4, subL=6 → 2 m × 3 m, beam along +Z.
 */
function _buildRFCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL      = 3.0;
  const cellCount = 6;
  const cellR     = 0.5;
  const gapR      = 0.32;                  // waist between cells (narrower)
  const gapL      = 0.04;
  const cellL     = (magL - 0.2) / cellCount - gapL;
  const cellTrainL = cellCount * cellL + (cellCount - 1) * gapL;
  const cellZ0    = -cellTrainL / 2 + cellL / 2;

  // Beads-on-a-string cells
  for (let i = 0; i < cellCount; i++) {
    const zc = cellZ0 + i * (cellL + gapL);
    const g = new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS);
    applyTiledCylinderUVs(g, cellR, cellL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  // Narrow waist sections bridging each cell pair
  for (let i = 0; i < cellCount - 1; i++) {
    const zc = cellZ0 + i * (cellL + gapL) + cellL / 2 + gapL / 2;
    const g = new THREE.CylinderGeometry(gapR, gapR, gapL + 0.01, SEGS);
    applyTiledCylinderUVs(g, gapR, gapL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // One small tuning plunger per cell, on top centre line
  const plungerR = 0.07, plungerH = 0.22;
  const plungerY = BEAM_HEIGHT + cellR;
  for (let i = 0; i < cellCount; i++) {
    const zc = cellZ0 + i * (cellL + gapL);
    const g = new THREE.CylinderGeometry(plungerR, plungerR, plungerH, SEGS);
    applyTiledCylinderUVs(g, plungerR, plungerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, plungerY + plungerH / 2, zc);
    _pushTransformed(buckets.iron, g, trans);
    const capGeo = new THREE.CylinderGeometry(plungerR * 1.4, plungerR * 1.4, 0.03, SEGS);
    applyTiledCylinderUVs(capGeo, plungerR * 1.4, 0.03, SEGS);
    const capTrans = new THREE.Matrix4().makeTranslation(0, plungerY + plungerH + 0.015, zc);
    _pushTransformed(buckets.detail, capGeo, capTrans);
  }

  // End pipe stubs + CF flanges at tile edges
  const tileEdge = magL / 2;
  for (const sign of [-1, 1]) {
    const stubStart = cellTrainL / 2;
    const stubL = tileEdge - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Three support pedestals
  const sBaseH = 0.06;
  const sColW  = 0.24;
  const sColD  = 0.18;
  const sColH  = BEAM_HEIGHT - cellR - sBaseH;
  for (const t of [0.15, 0.5, 0.85]) {
    const zPos = -cellTrainL / 2 + t * cellTrainL;
    const baseW = sColW + 0.18;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }

  return buckets;
}
ROLE_BUILDERS.rfCavity = _buildRFCavityRoles;

/**
 * S-band Structure — normal-conducting traveling-wave copper linac.
 *
 * Visually distinct from rfCavity: a long smooth copper tube densely
 * populated with thin disk rings (disk-loaded TW structure), with a
 * prominent coupler cell at each end and one compact waveguide launcher
 * at the declared RF input. Footprint: 2 m × 3 m.
 */
function _buildSbandStructureRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL    = 3.0;
  const bodyR   = 0.4;
  const couplerR = 0.52;
  const couplerL = 0.28;
  const bodyL   = magL - 2 * couplerL - 0.1;

  // Smooth copper body tube
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyL, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Disk rings — dense, thin, slightly protruding
  const diskCount = 22;
  const diskR = bodyR + 0.03;
  const diskH = 0.025;
  for (let i = 0; i < diskCount; i++) {
    const t = (i + 0.5) / diskCount;
    const z = -bodyL / 2 + t * bodyL;
    const g = new THREE.CylinderGeometry(diskR, diskR, diskH, SEGS);
    applyTiledCylinderUVs(g, diskR, diskH, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Large coupler cells at each end (bulkier than the body)
  for (const sign of [-1, 1]) {
    const zc = sign * (bodyL / 2 + couplerL / 2);
    const g = new THREE.CylinderGeometry(couplerR, couplerR, couplerL, SEGS);
    applyTiledCylinderUVs(g, couplerR, couplerL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // One real RF input, at the same high +X mount declared by rf_in. The old
  // model drew two 300 x 170 mm red ducts on opposite couplers even though the
  // component exposes only one routable waveguide port. Besides reading as two
  // connections, those ducts were roughly three times the routed guide's
  // 100 x 70 mm section and never met its fitting.
  //
  // The copper root is the cell-to-guide transformer. Its short red launch is
  // exactly the routed guide section, so the always-on waveguide flange and a
  // connected utility run continue the same silhouette instead of landing on
  // a separate decorative block.
  const wgY = 1.35;
  const wgZ = 0.914;
  const adapterL = 0.18, adapterH = 0.13, adapterW = 0.16;
  {
    const g = new THREE.BoxGeometry(adapterL, adapterH, adapterW);
    applyTiledBoxUVs(g, adapterL, adapterH, adapterW);
    _pushTransformed(buckets.copper, g,
      new THREE.Matrix4().makeTranslation(0.25, wgY, wgZ));
  }
  const wgL = 0.30, wgH = 0.07, wgW = 0.10;
  {
    const g = new THREE.BoxGeometry(wgL, wgH, wgW);
    applyTiledBoxUVs(g, wgL, wgH, wgW);
    _pushTransformed(buckets.accent, g,
      new THREE.Matrix4().makeTranslation(0.49, wgY, wgZ));
  }

  // Beam pipe stubs + flanges at tile edges
  const tileEdge = magL / 2;
  for (const sign of [-1, 1]) {
    const stubStart = bodyL / 2 + couplerL;
    const stubL = tileEdge - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Four support pedestals along the length
  const sBaseH = 0.06;
  const sColW  = 0.22;
  const sColD  = 0.18;
  const sColH  = BEAM_HEIGHT - couplerR - sBaseH;
  for (const t of [0.1, 0.38, 0.62, 0.9]) {
    const zPos = -magL / 2 + t * magL;
    const baseW = sColW + 0.16;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }

  return buckets;
}
ROLE_BUILDERS.sbandStructure = _buildSbandStructureRoles;

/**
 * Half-Wave Resonator — superconducting single-cell cryomodule.
 *
 * Vertical rectangular cryostat that stands on the floor and rises
 * above the beam axis, wrapped in external stiffener ridges. A fat
 * side RF coupler punches through the vessel at beam height and a
 * cryo transfer port rises from the top plate. Footprint: subW=2,
 * subL=2 → 1 m × 1 m, so the beam pipe (X=0) lands on a subtile
 * boundary.
 */
function _buildHalfWaveResonatorRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const tileHalf    = 0.5;                   // ±0.5 m along beam (1 m tile)
  const vesselW     = 0.82;                  // X extent
  const vesselL     = 0.88;                  // Z extent (along beam)
  const vesselBot   = 0.06;                  // clear the floor slightly
  const vesselTop   = 1.85;                  // rises ~0.85 m above the beam
  const vesselH     = vesselTop - vesselBot;
  const vesselY     = vesselBot + vesselH / 2;

  // Main stainless cryostat body (pipe role → brushed metal).
  {
    const g = new THREE.BoxGeometry(vesselW, vesselH, vesselL);
    applyTiledBoxUVs(g, vesselW, vesselH, vesselL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselY, 0));
  }

  // External stiffener ridges — thin horizontal flange rings that wrap
  // the vessel on all four sides. Placed symmetrically around the beam
  // axis so the vessel reads as ribbed.
  const ridgeTh = 0.05;
  const ridgeGrow = 0.08;
  const ridgeYs = [0.32, 0.68, 1.04, 1.40, 1.72];
  for (const y of ridgeYs) {
    const g = new THREE.BoxGeometry(vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    applyTiledBoxUVs(g, vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(0, y, 0));
  }

  // Thick top plate (bolted lid)
  {
    const plateW = vesselW + 0.16;
    const plateL = vesselL + 0.16;
    const plateH = 0.09;
    const g = new THREE.BoxGeometry(plateW, plateH, plateL);
    applyTiledBoxUVs(g, plateW, plateH, plateL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselTop + plateH / 2, 0));
  }

  // Baseplate foot (sits on the floor)
  {
    const footW = vesselW + 0.14;
    const footL = vesselL + 0.14;
    const footH = 0.06;
    const g = new THREE.BoxGeometry(footW, footH, footL);
    applyTiledBoxUVs(g, footW, footH, footL);
    _pushTransformed(buckets.stand, g, new THREE.Matrix4().makeTranslation(0, footH / 2, 0));
  }

  // Fat side RF coupler (accent) emerging through the vessel at beam height.
  {
    const cW = 0.26;   // Z extent (along beam) — short coupler
    const cH = 0.26;   // Y extent
    const cL = 0.42;   // X extent (how far it sticks out)
    const g = new THREE.BoxGeometry(cL, cH, cW);
    applyTiledBoxUVs(g, cL, cH, cW);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL / 2, BEAM_HEIGHT, 0));
    // Outer flange cap
    const capL = 0.05;
    const capG = new THREE.BoxGeometry(capL, cH * 1.25, cW * 1.25);
    applyTiledBoxUVs(capG, capL, cH * 1.25, cW * 1.25);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL + capL / 2, BEAM_HEIGHT, 0));
  }

  // Top liquid-helium / cryo transfer port rising from the lid.
  {
    const portR = 0.09, portH = 0.32;
    const lidTop = vesselTop + 0.09;
    const g = new THREE.CylinderGeometry(portR, portR, portH, SEGS);
    applyTiledCylinderUVs(g, portR, portH, SEGS);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, lidTop + portH / 2, 0));
    const capGeo = new THREE.CylinderGeometry(portR * 1.5, portR * 1.5, 0.04, SEGS);
    applyTiledCylinderUVs(capGeo, portR * 1.5, 0.04, SEGS);
    _pushTransformed(buckets.detail, capGeo, new THREE.Matrix4().makeTranslation(0, lidTop + portH + 0.02, 0));
  }

  // Beam pipe passes straight through the vessel along Z at beam height.
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 2 * tileHalf, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, 2 * tileHalf, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  // CF flanges at tile edges
  for (const sign of [-1, 1]) {
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileHalf);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  return buckets;
}
ROLE_BUILDERS.halfWaveResonator = _buildHalfWaveResonatorRoles;

/**
 * Spoke Cavity — superconducting multi-spoke cryomodule.
 *
 * Vertical rectangular cryostat, taller and longer than the HWR. Two
 * side-mounted RF couplers punch out through the vessel at beam height
 * and two cryo transfer ports rise from the top plate. External
 * stiffener ridges wrap the vessel. Footprint: subW=2, subL=4 → 1 m × 2 m;
 * the beam pipe (X=0) lands on a subtile boundary.
 */
function _buildSpokeCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL      = 2.0;                   // tile length along beam (2 m tile)
  const tileEdge  = magL / 2;
  const vesselW   = 0.88;                  // X extent
  const vesselL   = magL - 0.14;           // Z extent (along beam)
  const vesselBot = 0.06;
  const vesselTop = 2.00;                  // rises ~1 m above the beam
  const vesselH   = vesselTop - vesselBot;
  const vesselY   = vesselBot + vesselH / 2;

  // Main cryostat body.
  {
    const g = new THREE.BoxGeometry(vesselW, vesselH, vesselL);
    applyTiledBoxUVs(g, vesselW, vesselH, vesselL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselY, 0));
  }

  // External stiffener ridges (horizontal flange rings).
  const ridgeTh = 0.05;
  const ridgeGrow = 0.08;
  const ridgeYs = [0.32, 0.68, 1.04, 1.40, 1.76];
  for (const y of ridgeYs) {
    const g = new THREE.BoxGeometry(vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    applyTiledBoxUVs(g, vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(0, y, 0));
  }

  // A pair of vertical stiffener strips running the full height on the
  // two broad (±Z) faces — suggests welded box construction.
  const stripW = 0.04, stripD = 0.03;
  for (const zSign of [-1, 1]) {
    for (const xOff of [-vesselW * 0.3, vesselW * 0.3]) {
      const g = new THREE.BoxGeometry(stripW, vesselH, stripD);
      applyTiledBoxUVs(g, stripW, vesselH, stripD);
      _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(
        xOff, vesselY, zSign * (vesselL / 2 + stripD / 2)));
    }
  }

  // Top plate
  {
    const plateW = vesselW + 0.16;
    const plateL = vesselL + 0.16;
    const plateH = 0.09;
    const g = new THREE.BoxGeometry(plateW, plateH, plateL);
    applyTiledBoxUVs(g, plateW, plateH, plateL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselTop + plateH / 2, 0));
  }

  // Baseplate foot
  {
    const footW = vesselW + 0.14;
    const footL = vesselL + 0.14;
    const footH = 0.06;
    const g = new THREE.BoxGeometry(footW, footH, footL);
    applyTiledBoxUVs(g, footW, footH, footL);
    _pushTransformed(buckets.stand, g, new THREE.Matrix4().makeTranslation(0, footH / 2, 0));
  }

  // Two side RF couplers (accent) punching through +X at beam height,
  // spaced along Z so each spoke cell gets its own drive.
  const couplerZs = [-vesselL * 0.25, vesselL * 0.25];
  for (const zc of couplerZs) {
    const cW = 0.26, cH = 0.26, cL = 0.42;
    const g = new THREE.BoxGeometry(cL, cH, cW);
    applyTiledBoxUVs(g, cL, cH, cW);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL / 2, BEAM_HEIGHT, zc));
    const capL = 0.05;
    const capG = new THREE.BoxGeometry(capL, cH * 1.25, cW * 1.25);
    applyTiledBoxUVs(capG, capL, cH * 1.25, cW * 1.25);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL + capL / 2, BEAM_HEIGHT, zc));
  }

  // Two cryo transfer ports on top, offset along Z from the couplers.
  const cryoZs = [-vesselL * 0.32, vesselL * 0.32];
  const lidTop = vesselTop + 0.09;
  for (const zc of cryoZs) {
    const portR = 0.09, portH = 0.32;
    const g = new THREE.CylinderGeometry(portR, portR, portH, SEGS);
    applyTiledCylinderUVs(g, portR, portH, SEGS);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, lidTop + portH / 2, zc));
    const capGeo = new THREE.CylinderGeometry(portR * 1.5, portR * 1.5, 0.04, SEGS);
    applyTiledCylinderUVs(capGeo, portR * 1.5, 0.04, SEGS);
    _pushTransformed(buckets.detail, capGeo, new THREE.Matrix4().makeTranslation(0, lidTop + portH + 0.02, zc));
  }

  // Beam pipe passes straight through the vessel along Z at beam height.
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 2 * tileEdge, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, 2 * tileEdge, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  // CF flanges at tile edges
  for (const sign of [-1, 1]) {
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  return buckets;
}
ROLE_BUILDERS.spokeCavity = _buildSpokeCavityRoles;

/**
 * Pillbox Cavity — single-cell normal-conducting RF cavity.
 *
 * Footprint: subW=3, subL=2 → 1.5 m × 1 m. Short chunky copper cell with
 * prominent end flanges, a top RF coupler and a bottom pickup probe, and
 * a pair of cooling water tubes running along the sides.
 */
function _buildPillboxCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const tileHalf = 0.5;                   // ±0.5 m along beam (1 m tile in Z)
  const cellR    = 0.4;
  const cellL    = 0.56;                  // main cell length along beam
  const shoulderR = cellR + 0.05;
  const shoulderL = 0.06;

  // Main copper cell body
  {
    const g = new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS);
    applyTiledCylinderUVs(g, cellR, cellL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Shoulder rings at each cell end — slightly wider, step-in profile
  for (const sign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(shoulderR, shoulderR, shoulderL, SEGS);
    applyTiledCylinderUVs(g, shoulderR, shoulderL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (cellL / 2 + shoulderL / 2));
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Beam pipe stubs + CF end flanges reaching to the tile edges
  for (const sign of [-1, 1]) {
    const stubStart = cellL / 2 + shoulderL;
    const stubL = tileHalf - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileHalf);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Top RF coupler — chunky cylindrical stub with a flange cap
  {
    const couplerR = 0.1, couplerH = 0.3;
    const g = new THREE.CylinderGeometry(couplerR, couplerR, couplerH, SEGS);
    applyTiledCylinderUVs(g, couplerR, couplerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + cellR + couplerH / 2, 0);
    _pushTransformed(buckets.copper, g, trans);
    // Coax-style cap: wider flat disk
    const capGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, SEGS);
    applyTiledCylinderUVs(capGeo, 0.16, 0.04, SEGS);
    const capTrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + cellR + couplerH + 0.02, 0);
    _pushTransformed(buckets.detail, capGeo, capTrans);
  }

  // Bottom pickup probe — smaller stub on the underside
  {
    const probeR = 0.055, probeH = 0.18;
    const g = new THREE.CylinderGeometry(probeR, probeR, probeH, SEGS);
    applyTiledCylinderUVs(g, probeR, probeH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT - cellR - probeH / 2, 0);
    _pushTransformed(buckets.detail, g, trans);
  }

  // Cooling water tubes — two thin copper tubes running along the cell on
  // each side (±X), curving up to small bosses on top. Modeled here as a
  // horizontal bar + a small vertical elbow stub at each end.
  {
    const tubeR = 0.025;
    const tubeY = BEAM_HEIGHT + 0.02;
    const tubeX = cellR + tubeR + 0.01;
    const tubeL = cellL + 2 * shoulderL;
    for (const xSign of [-1, 1]) {
      // Horizontal run along Z
      const hg = new THREE.CylinderGeometry(tubeR, tubeR, tubeL, 10);
      applyTiledCylinderUVs(hg, tubeR, tubeL, 10);
      const hrot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const htrans = new THREE.Matrix4().makeTranslation(xSign * tubeX, tubeY, 0);
      _pushTransformed(buckets.detail, hg, new THREE.Matrix4().multiplyMatrices(htrans, hrot));
      // Small vertical elbow at each end
      for (const zSign of [-1, 1]) {
        const eg = new THREE.CylinderGeometry(tubeR, tubeR, 0.12, 10);
        applyTiledCylinderUVs(eg, tubeR, 0.12, 10);
        const etrans = new THREE.Matrix4().makeTranslation(xSign * tubeX, tubeY + 0.06, zSign * tubeL / 2);
        _pushTransformed(buckets.detail, eg, etrans);
      }
    }
  }

  // Support pedestals at both Z ends — simple two-column style
  const sBaseH = 0.06;
  const sColW  = 0.1;
  const sColD  = 0.16;
  const sColX  = 0.24;
  const sTopY  = BEAM_HEIGHT - cellR + 0.1;
  const sColH  = sTopY - sBaseH;
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (cellL / 2 - sColD / 2);
    const baseW = sColX * 2 + sColW + 0.12;
    const baseD = sColD + 0.04;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    const bt = new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, bt);
    for (const side of [-1, 1]) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      const ct = new THREE.Matrix4().makeTranslation(side * sColX, sBaseH + sColH / 2, zPos);
      _pushTransformed(buckets.stand, col, ct);
    }
  }

  return buckets;
}
ROLE_BUILDERS.pillboxCavity = _buildPillboxCavityRoles;
/**
 * Buncher — smaller, simpler single-gap RF cavity.
 *
 * Visually distinct from the pillbox: shorter copper cell with a smaller
 * radius, a single small RF coupler on top, and a compact single-pedestal
 * stand.  No cooling tubes or bottom probe — it's a low-power device.
 */
function _buildBuncherRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const tileHalf   = 0.5;
  const cellR      = 0.28;
  const cellL      = 0.36;
  const shoulderR  = cellR + 0.04;
  const shoulderL  = 0.04;

  // Main copper cell body
  {
    const g = new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS);
    applyTiledCylinderUVs(g, cellR, cellL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Shoulder rings
  for (const sign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(shoulderR, shoulderR, shoulderL, SEGS);
    applyTiledCylinderUVs(g, shoulderR, shoulderL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (cellL / 2 + shoulderL / 2));
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Beam pipe stubs + CF end flanges
  for (const sign of [-1, 1]) {
    const stubStart = cellL / 2 + shoulderL;
    const stubL = tileHalf - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileHalf);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Small top RF coupler — single stub, no cap
  {
    const couplerR = 0.06, couplerH = 0.18;
    const g = new THREE.CylinderGeometry(couplerR, couplerR, couplerH, SEGS);
    applyTiledCylinderUVs(g, couplerR, couplerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + cellR + couplerH / 2, 0);
    _pushTransformed(buckets.copper, g, trans);
  }

  // Single compact support pedestal — centered under the cell
  {
    const sBaseH = 0.05;
    const sTopY  = BEAM_HEIGHT - cellR + 0.1;
    const sColH  = sTopY - sBaseH;
    const sColW  = 0.08;
    const sColD  = 0.12;
    const baseW  = 0.32;
    const baseD  = 0.16;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, 0));
    for (const side of [-1, 1]) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      const ct = new THREE.Matrix4().makeTranslation(side * 0.1, sBaseH + sColH / 2, 0);
      _pushTransformed(buckets.stand, col, ct);
    }
  }

  return buckets;
}
ROLE_BUILDERS.buncher = _buildBuncherRoles;

/**
 * 9-cell Elliptical SRF Cavity (ellipticalSrfCavity) — TESLA/XFEL-style
 * superconducting niobium cavity in its helium jacket.
 *
 * Nine elliptical cells strung along the beam axis (peak cell diameter
 * ~210 mm at 1.3 GHz, 115 mm cell period), flanked by short beam tubes.
 * The whole active length (~1.04 m) sits inside a stainless helium vessel
 * with stiffener ridges, a prominent coaxial fundamental-power coupler at
 * one end, a pickup probe at the opposite end, and a liquid-helium transfer
 * port rising from the top. Footprint: subW=2, subL=3 → 1 m × 1.5 m, beam
 * along +Z through X=0.
 */
function _buildEllipticalSrfCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL    = 1.5;                       // subL=3 → 1.5 m
  const tileEdge = magL / 2;

  // Nine elliptical cells — scaled spheres for a rounded bead profile.
  // 1.3 GHz TESLA cell geometry: ~210 mm peak diameter, ~115 mm period.
  const cellCount = 9;
  const cellPeakR = 0.16;                    // peak radius of each cell
  const cellPeriod = 0.12;                   // centre-to-centre spacing
  const activeL   = cellCount * cellPeriod;  // ~1.08 m
  const cellZ0    = -activeL / 2 + cellPeriod / 2;
  const cellHalfZ = cellPeriod * 0.60;       // half-length of the ellipsoid (slight overlap at irises)

  for (let i = 0; i < cellCount; i++) {
    const zc = cellZ0 + i * cellPeriod;
    // Sphere scaled to an ellipsoid: waist radius cellPeakR, long half-axis along Z.
    const g = new THREE.SphereGeometry(1, SEGS, Math.max(8, Math.floor(SEGS / 2)));
    g.scale(cellPeakR, cellPeakR, cellHalfZ);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.pipe, g, trans);
  }

  // Iris necks between cells — narrow cylinders at each cell junction.
  // Real iris radius ~35 mm (much smaller than cell waist).
  const irisR = 0.055;
  const irisL = 0.015;
  for (let i = 0; i < cellCount - 1; i++) {
    const zc = cellZ0 + (i + 0.5) * cellPeriod;
    const g = new THREE.CylinderGeometry(irisR, irisR, irisL, SEGS);
    applyTiledCylinderUVs(g, irisR, irisL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // End group beam tubes bridging the outermost cells to the module edges.
  const endTubeR = irisR + 0.02;
  for (const sign of [-1, 1]) {
    const innerZ = sign * (activeL / 2);
    const outerZ = sign * (tileEdge - 0.05);
    const tubeL  = Math.abs(outerZ - innerZ);
    if (tubeL > 0.001) {
      const g = new THREE.CylinderGeometry(endTubeR, endTubeR, tubeL, SEGS);
      applyTiledCylinderUVs(g, endTubeR, tubeL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, (innerZ + outerZ) / 2);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
  }

  // Helium jacket — stainless vessel enclosing the cavity string. Rendered
  // as stiffener rings (open between rings) so the cells stay visible.
  const jacketR = cellPeakR + 0.08;
  const ringL   = 0.035;
  const ringCount = 6;
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    const zr = -activeL / 2 + 0.03 + t * (activeL - 0.06);
    const g = new THREE.CylinderGeometry(jacketR, jacketR, ringL, SEGS);
    applyTiledCylinderUVs(g, jacketR, ringL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zr);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // End-cap plates of the helium vessel at each end of the cell string.
  const endCapR = jacketR + 0.02;
  const endCapL = 0.04;
  for (const sign of [-1, 1]) {
    const zc = sign * (activeL / 2 + endCapL / 2);
    const g = new THREE.CylinderGeometry(endCapR, endCapR, endCapL, SEGS);
    applyTiledCylinderUVs(g, endCapR, endCapL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Fundamental-power coupler (FPC) — fat coaxial feed entering from +X at
  // the upstream end. Coaxial outer, then a flared waveguide-to-coax box,
  // then a bolted flange cap.
  const fpcZ = -activeL / 2 + cellPeriod * 0.6;
  {
    const coaxR = 0.09;
    const coaxL = 0.30;
    const coaxX = jacketR + coaxL / 2;
    const g = new THREE.CylinderGeometry(coaxR, coaxR, coaxL, SEGS);
    applyTiledCylinderUVs(g, coaxR, coaxL, SEGS);
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(coaxX, BEAM_HEIGHT, fpcZ);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    // Waveguide transformer box at the outer end
    const boxW = 0.26, boxH = 0.22, boxL = 0.18;
    const boxX = coaxX + coaxL / 2 + boxL / 2;
    const bg = new THREE.BoxGeometry(boxL, boxH, boxW);
    applyTiledBoxUVs(bg, boxL, boxH, boxW);
    _pushTransformed(buckets.accent, bg, new THREE.Matrix4().makeTranslation(boxX, BEAM_HEIGHT, fpcZ));
    // Outer flange cap
    const capL = 0.05;
    const capG = new THREE.BoxGeometry(capL, boxH * 1.15, boxW * 1.15);
    applyTiledBoxUVs(capG, capL, boxH * 1.15, boxW * 1.15);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(boxX + boxL / 2 + capL / 2, BEAM_HEIGHT, fpcZ));
  }

  // Pickup probe — small coaxial sensor at the downstream end, −X side.
  {
    const pR = 0.04, pL = 0.22;
    const pX = -(jacketR + pL / 2);
    const pZ = activeL / 2 - cellPeriod * 0.6;
    const g = new THREE.CylinderGeometry(pR, pR, pL, SEGS);
    applyTiledCylinderUVs(g, pR, pL, SEGS);
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(pX, BEAM_HEIGHT, pZ);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Liquid-helium transfer port — vertical stub rising from the top of the
  // helium jacket near the centre.
  {
    const portR = 0.07, portH = 0.40;
    const portY = BEAM_HEIGHT + jacketR + portH / 2;
    const g = new THREE.CylinderGeometry(portR, portR, portH, SEGS);
    applyTiledCylinderUVs(g, portR, portH, SEGS);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, portY, 0));
    // Flange cap on top
    const capR = portR * 1.5;
    const capH = 0.04;
    const capG = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(capG, capR, capH, SEGS);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(0, portY + portH / 2 + capH / 2, 0));
  }

  // Beam-pipe stubs + CF flanges at the tile edges.
  for (const sign of [-1, 1]) {
    const stubStart = tileEdge - 0.05;
    const stubL = 0.05;
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));

    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Two support pedestals carrying the jacket.
  const sBaseH = 0.06;
  const sColW  = 0.22;
  const sColD  = 0.18;
  const sColH  = BEAM_HEIGHT - jacketR - sBaseH;
  for (const t of [0.22, 0.78]) {
    const zPos = -magL / 2 + t * magL;
    const baseW = sColW + 0.16;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }

  return buckets;
}
ROLE_BUILDERS.ellipticalSrfCavity = _buildEllipticalSrfCavityRoles;

// ══ RF ladder + type-coverage builders ══════════════════════════════
//
// Twelve components whose whole point is that they sit on a ladder: five
// SRF cryomodules that are the same machine at five scales, two NC copper
// structures separated only by cell pitch, and five one-offs. Written
// against a handful of shared primitives, because the thing a reader needs
// to see in these functions is the *silhouette* — 5 fat cells vs 6 small
// ones, a doubled beam axis, a laser hall instead of a waveguide — not
// another forty lines of Matrix4 bookkeeping.

/** Cylinder lying along the beam (+Z). `rTop` is the radius at the +Z end. */
function _gCylZ(bucket, r, len, { x = 0, y = BEAM_HEIGHT, z = 0, rTop = r, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(rTop, r, len, segs);
  applyTiledCylinderUVs(g, (r + rTop) / 2, len, segs);
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const trans = new THREE.Matrix4().makeTranslation(x, y, z);
  _pushTransformed(bucket, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
}

/** Cylinder standing upright (+Y). */
function _gCylY(bucket, r, len, { x = 0, y = BEAM_HEIGHT, z = 0, rTop = r, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(rTop, r, len, segs);
  applyTiledCylinderUVs(g, (r + rTop) / 2, len, segs);
  _pushTransformed(bucket, g, new THREE.Matrix4().makeTranslation(x, y, z));
}

/** Cylinder lying across the beam (+X). `rTop` is the radius at the +X end. */
function _gCylX(bucket, r, len, { x = 0, y = BEAM_HEIGHT, z = 0, rTop = r, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(rTop, r, len, segs);
  applyTiledCylinderUVs(g, (r + rTop) / 2, len, segs);
  const rot = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  const trans = new THREE.Matrix4().makeTranslation(x, y, z);
  _pushTransformed(bucket, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
}

/** Axis-aligned box, optionally yawed about +Y (for magnets following a curve). */
function _gBox(bucket, w, h, d, { x = 0, y = BEAM_HEIGHT, z = 0, rotY = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  applyTiledBoxUVs(g, w, h, d);
  const trans = new THREE.Matrix4().makeTranslation(x, y, z);
  if (rotY === 0) {
    _pushTransformed(bucket, g, trans);
  } else {
    const rot = new THREE.Matrix4().makeRotationY(rotY);
    _pushTransformed(bucket, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
}

/**
 * Cylinder spanning two arbitrary points — the primitive that makes curved
 * beam pipes and draped pulse cables writable at all. `a`/`b` are [x, y, z].
 */
function _gSegment(bucket, a, b, r, segs = 10) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return;
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  applyTiledCylinderUVs(g, r, len, segs);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len),
  );
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
    q,
    new THREE.Vector3(1, 1, 1),
  );
  _pushTransformed(bucket, g, m);
}

/**
 * Circular arc drawn as `steps` chords, centred on `centre` = [x, y, z], with
 * angle 0 pointing straight DOWN from the centre. `plane` picks which pair of
 * axes the arc sweeps in: 'zy' (arc opens along ±Z, the goniometer-cradle
 * case) or 'xy' (opens along ±X).
 *
 * Real precision mounts are arcs — a cradle rail whose centre of curvature is
 * the sample, a girth strap round a pressure vessel — and chording them keeps
 * that hardware in the same _gSegment vocabulary as every other curved run
 * here rather than dragging in a torus with its own UV rules.
 */
function _gArc(bucket, centre, r, a0, a1, steps, tubeR) {
  const pt = (a) => (
    [centre[0], centre[1] - r * Math.cos(a), centre[2] + r * Math.sin(a)]
  );
  for (let i = 0; i < steps; i++) {
    _gSegment(
      bucket,
      pt(a0 + (a1 - a0) * (i / steps)),
      pt(a0 + (a1 - a0) * ((i + 1) / steps)),
      tubeR,
      8,
    );
  }
}

/**
 * Beam-pipe stubs from `innerZ` out to the tile edge plus a CF flange on
 * each edge. Every placement component needs this or the pipe visibly
 * breaks at the join with its neighbour.
 */
function _gBeamEnds(buckets, tileEdge, innerZ, { pipeR = PIPE_R, y = BEAM_HEIGHT, x = 0 } = {}) {
  for (const sign of [-1, 1]) {
    const stubL = tileEdge - innerZ;
    if (stubL > 0.001) {
      _gCylZ(buckets.pipe, pipeR, stubL, { x, y, z: sign * (innerZ + stubL / 2) });
    }
    _gCylZ(buckets.detail, FLANGE_R, FLANGE_H, { x, y, z: sign * tileEdge });
  }
}

/** A row of floor pedestals: foot plate plus column, one per z in `zList`. */
function _gPedestals(buckets, zList, topY, { w = 0.24, d = 0.2, x = 0 } = {}) {
  const baseH = 0.06;
  const colH = Math.max(0.04, topY - baseH);
  for (const z of zList) {
    _gBox(buckets.stand, w + 0.18, baseH, d + 0.06, { x, y: baseH / 2, z });
    _gBox(buckets.stand, w, colH, d, { x, y: baseH + colH / 2, z });
  }
}

/** Evenly spaced positions inside a span of length `L` centred on `centre`. */
function _gSpread(count, L, centre = 0) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(centre - L / 2 + ((i + 0.5) / count) * L);
  return out;
}

/**
 * The SRF cryomodule family — five catalogue entries built from one
 * parametric cryostat, because that is what they physically are: a string
 * of elliptical niobium cells in a helium vessel, inside a vacuum jacket,
 * with end cans carrying the warm-to-cold transitions. The rungs differ in
 * exactly the ways a player can read at 70×30 px:
 *
 *   cell count + cell size  — 650 MHz cells are physically twice the
 *                             diameter of 805 MHz ones, so "fewer, fatter"
 *                             is genuinely the lower rung.
 *   cryo connection         — one stub (650), twin stubs (805), a full
 *                             header (CW, whose heat load never pauses),
 *                             one small stub (Nb3Sn at 4.5 K).
 *   coupler rows            — one row, or doubled for CW duty.
 *   shell role              — `accent` for Nb3Sn so its warmer catalogue
 *                             colour owns the whole silhouette; `pipe`
 *                             (stainless) for the 2 K units.
 *   segments                — >1 splits the string into cavity groups with
 *                             interconnect bellows: the linac-sector read.
 *
 * Beam along +Z, axis at BEAM_HEIGHT, footprint 2 m wide (subW 4).
 */
function _srfCryomoduleRoles(opts) {
  const {
    magL,                    // subL * 0.5
    cellCount,               // cells per cavity string segment
    cellPeakR,               // equator radius of one cell
    cellPeriod,              // cell centre-to-centre along the beam
    segments = 1,
    interconnectL = 0.6,
    cryoPorts = 1,
    cryoPortR = 0.09,
    cryoPortH = 0.32,
    header = false,          // heavy cryogenic header along the top
    distributionLine = false,// 2 K supply/return running the full length
    couplerSides = [1],      // +1 = +X row, -1 = -X row
    shellRole = 'pipe',
    pedestalCount = 3,
  } = opts;

  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
  const shell = buckets[shellRole];

  const tileEdge  = magL / 2;
  const vesselR   = cellPeakR + 0.09;      // vacuum jacket over the He vessel
  const irisR     = Math.max(0.10, cellPeakR * 0.30);
  const cellHalfZ = cellPeriod * 0.55;
  const segL      = cellCount * cellPeriod;
  const stringL   = segments * segL + (segments - 1) * interconnectL;

  // Segment start z for each cavity group.
  const segStarts = [];
  for (let s = 0; s < segments; s++) segStarts.push(-stringL / 2 + s * (segL + interconnectL));

  // --- Elliptical cells (pipe = bare niobium) ---
  const cellZs = [];
  for (const segStart of segStarts) {
    for (let i = 0; i < cellCount; i++) {
      const zc = segStart + (i + 0.5) * cellPeriod;
      cellZs.push(zc);
      const g = new THREE.SphereGeometry(1, SEGS, Math.max(8, Math.floor(SEGS / 2)));
      g.scale(cellPeakR, cellPeakR, cellHalfZ);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc));
    }
    // Iris necks between cells — the beam sees a much smaller hole than the
    // cell equator, and showing that is what makes the string read as cells.
    for (let i = 0; i < cellCount - 1; i++) {
      const zc = segStart + (i + 1) * cellPeriod;
      _gCylZ(buckets.pipe, irisR, cellPeriod * 0.18, { z: zc });
    }
  }

  // --- Vacuum-jacket stiffener rings over each cell junction ---
  for (const segStart of segStarts) {
    for (let i = 0; i <= cellCount; i++) {
      _gCylZ(buckets.detail, vesselR, 0.07, { z: segStart + i * cellPeriod });
    }
  }

  // --- Interconnect bellows between cavity groups ---
  // A real module-to-module joint: a short small-bore bellows inside a
  // collar. Only srfLinacSector has more than one group.
  for (let s = 0; s < segments - 1; s++) {
    const zc = segStarts[s] + segL + interconnectL / 2;
    _gCylZ(shell, vesselR * 0.72, interconnectL, { z: zc });
    for (const t of [-0.3, 0, 0.3]) {
      _gCylZ(buckets.detail, vesselR * 0.82, 0.05, { z: zc + t * interconnectL });
    }
  }

  // --- End cans + warm-to-cold transitions ---
  // The cold string stops well short of the tile edge; the rest is end can,
  // then a cone down to room-temperature beam pipe. Cryomodule end cans are
  // genuinely this long — they hold the coupler feedthroughs and the
  // gate valves.
  const stubL  = 0.22;
  const transL = 0.42;
  const canOuterZ = tileEdge - stubL - transL;
  const canL = canOuterZ - stringL / 2;
  for (const sign of [-1, 1]) {
    if (canL > 0.05) {
      _gCylZ(shell, vesselR, canL, { z: sign * (stringL / 2 + canL / 2) });
      _gCylZ(buckets.detail, vesselR + 0.03, 0.06, { z: sign * (stringL / 2 + 0.05) });
    }
    // Transition cone: wide (jacket) inboard, narrow (warm pipe) outboard.
    const rOut = 0.20;
    _gCylZ(shell, sign > 0 ? vesselR : rOut, transL, {
      z: sign * (canOuterZ + transL / 2),
      rTop: sign > 0 ? rOut : vesselR,
    });
  }

  // --- Fundamental power couplers, one per cell per row ---
  // Coax through the jacket, waveguide transformer box, bolted flange.
  const coaxL = 0.20, boxL = 0.16, capL = 0.05;
  for (const side of couplerSides) {
    for (const zc of cellZs) {
      const coaxX = side * (vesselR + coaxL / 2);
      _gCylX(buckets.accent, 0.085, coaxL, { x: coaxX, z: zc });
      const boxX = side * (vesselR + coaxL + boxL / 2);
      _gBox(buckets.accent, boxL, 0.22, 0.24, { x: boxX, z: zc });
      const capX = side * (vesselR + coaxL + boxL + capL / 2);
      _gBox(buckets.detail, capL, 0.26, 0.28, { x: capX, z: zc });
    }
  }

  // --- Cryogenic connections on top ---
  for (const zc of _gSpread(cryoPorts, stringL * 0.7)) {
    const portY = BEAM_HEIGHT + vesselR + cryoPortH / 2;
    _gCylY(buckets.pipe, cryoPortR, cryoPortH, { y: portY, z: zc });
    _gCylY(buckets.detail, cryoPortR * 1.5, 0.04, { y: portY + cryoPortH / 2 + 0.02, z: zc });
  }

  if (header) {
    // CW means the 2 K heat load never pauses, so the header that carries it
    // is a structural member running the whole module rather than a stub.
    const headerH = 0.26, headerW = 0.34;
    const headerY = BEAM_HEIGHT + vesselR + headerH / 2 + 0.06;
    const headerL = 2 * canOuterZ;
    _gBox(buckets.pipe, headerW, headerH, headerL, { y: headerY });
    for (const zc of cellZs) {
      _gCylY(buckets.detail, 0.05, 0.14, { y: headerY - headerH / 2 - 0.05, z: zc });
    }
    _gBox(buckets.detail, headerW + 0.06, 0.05, 0.10, { y: headerY + headerH / 2, z: 0 });
  }

  if (distributionLine) {
    // Sector-scale modules are fed from a cryogenic distribution line that
    // runs past every group rather than terminating on one module.
    const lineX = -(vesselR + 0.16);
    const lineY = BEAM_HEIGHT + vesselR * 0.6;
    _gCylZ(buckets.pipe, 0.11, 2 * canOuterZ, { x: lineX, y: lineY });
    for (const segStart of segStarts) {
      const zc = segStart + segL / 2;
      _gSegment(buckets.pipe, [lineX, lineY, zc], [-vesselR * 0.55, BEAM_HEIGHT + vesselR * 0.8, zc], 0.05);
      _gCylZ(buckets.detail, 0.14, 0.06, { x: lineX, y: lineY, z: zc });
    }
  }

  _gBeamEnds(buckets, tileEdge, canOuterZ + transL);
  _gPedestals(buckets, _gSpread(pedestalCount, stringL + 2 * canL), BEAM_HEIGHT - vesselR, {
    w: 0.26, d: 0.22,
  });

  return buckets;
}

/**
 * 650 MHz cryomodule — the bottom rung of the SRF ladder. 650 MHz cells are
 * roughly twice the diameter of the 1.3 GHz TESLA cells in
 * `ellipticalSrfCavity`, so the module is squatter and fatter: five big
 * beads, one cryo stub, warm-to-cold transitions at both ends. 10 m.
 */
function _buildSrf650CryomoduleRoles() {
  return _srfCryomoduleRoles({
    magL: 10,
    cellCount: 5,
    cellPeakR: 0.55,
    cellPeriod: 1.45,
    cryoPorts: 1,
    pedestalCount: 3,
  });
}
ROLE_BUILDERS.srf650Cryomodule = _buildSrf650CryomoduleRoles;

/**
 * 805 MHz cryomodule — one rung up. Same family, but the higher frequency
 * shrinks every cell, so six smaller beads fit where five fat ones did, and
 * the module is longer (12 m). Twin cryo stubs: more cavities to feed.
 */
function _buildSrf805CryomoduleRoles() {
  return _srfCryomoduleRoles({
    magL: 12,
    cellCount: 6,
    cellPeakR: 0.44,
    cellPeriod: 1.20,
    cryoPorts: 2,
    pedestalCount: 4,
  });
}
ROLE_BUILDERS.srf805Cryomodule = _buildSrf805CryomoduleRoles;

/**
 * CW cryomodule — the 805 silhouette carrying continuous-wave hardware.
 * Duty cycle is the whole story: at CW the dynamic heat load never pauses,
 * so the cryogenic header becomes a full-length structural member and every
 * cavity gets a coupler on both sides to split the average power.
 */
function _buildCwCryomoduleRoles() {
  return _srfCryomoduleRoles({
    magL: 12,
    cellCount: 6,
    cellPeakR: 0.45,
    cellPeriod: 1.20,
    cryoPorts: 2,
    header: true,
    couplerSides: [1, -1],
    pedestalCount: 4,
  });
}
ROLE_BUILDERS.cwCryomodule = _buildCwCryomoduleRoles;

/**
 * Nb3Sn cryomodule — same cryostat, different metallurgy. Nb3Sn runs at
 * 4.5 K rather than 2 K, so it needs no superfluid plant: the cryo
 * connection is one small stub instead of a header, and the whole vacuum
 * jacket goes in the `accent` bucket so the warmer catalogue colour owns
 * the silhouette. Colour is the identity here — the shape is deliberately
 * the same as the 2 K units.
 */
function _buildNbSnCryomoduleRoles() {
  return _srfCryomoduleRoles({
    magL: 12,
    cellCount: 6,
    cellPeakR: 0.45,
    cellPeriod: 1.20,
    cryoPorts: 1,
    cryoPortR: 0.055,
    cryoPortH: 0.22,
    shellRole: 'accent',
    pedestalCount: 4,
  });
}
ROLE_BUILDERS.nbSnCryomodule = _buildNbSnCryomoduleRoles;

/**
 * SRF linac sector — one placement standing in for a whole cryogenic
 * sector, and it has to look like it. Three cavity groups separated by
 * interconnect bellows, a cryo distribution line running past all of them
 * rather than terminating on one module, and a twelve-strong row of
 * couplers. 16 m: the longest thing in the catalogue.
 */
function _buildSrfLinacSectorRoles() {
  return _srfCryomoduleRoles({
    magL: 16,
    cellCount: 4,
    cellPeakR: 0.40,
    cellPeriod: 1.05,
    segments: 3,
    interconnectL: 0.6,
    cryoPorts: 3,
    distributionLine: true,
    pedestalCount: 5,
  });
}
ROLE_BUILDERS.srfLinacSector = _buildSrfLinacSectorRoles;

/**
 * C-band structure — travelling-wave copper at 5712 MHz. Same 3 m footprint
 * as `sbandStructure` and deliberately the same family, separated by the
 * one thing that actually changes with frequency: cell pitch. S-band's 22
 * disks become 40 here, over a slimmer body, because the cell period is
 * βλ/3 and λ has halved. One waveguide feed at the input coupler, and a
 * water manifold along the top — 40 MV/m of copper is mostly a heater.
 */
function _buildCbandStructureRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 3.0;
  const tileEdge = magL / 2;
  const bodyR    = 0.34;
  const couplerR = 0.44;
  const couplerL = 0.26;
  const bodyL    = magL - 2 * couplerL - 0.30;

  _gCylZ(buckets.copper, bodyR, bodyL);

  // Disc loading — the identity. Finer pitch than S-band, same protrusion.
  const diskCount = 40;
  for (const z of _gSpread(diskCount, bodyL)) {
    _gCylZ(buckets.copper, bodyR + 0.03, 0.018, { z });
  }

  // Input and output coupler cells.
  for (const sign of [-1, 1]) {
    _gCylZ(buckets.copper, couplerR, couplerL, { z: sign * (bodyL / 2 + couplerL / 2) });
  }

  // Single waveguide feed into the input coupler, -X side. C-band runs one
  // klystron into one structure; the X-band unit below is the one that
  // needs a manifold.
  {
    const wgZ = -(bodyL / 2 + couplerL / 2);
    const wgL = 0.40;
    _gBox(buckets.accent, wgL, 0.15, 0.26, { x: -(couplerR + wgL / 2), z: wgZ });
    _gBox(buckets.detail, 0.06, 0.22, 0.33, { x: -(couplerR + wgL + 0.03), z: wgZ });
    // Output coupler dumps into a matched load on the far side.
    _gBox(buckets.detail, 0.30, 0.20, 0.24, {
      x: couplerR + 0.15, z: bodyL / 2 + couplerL / 2,
    });
  }

  // Water manifold along the top with a jumper into every fourth cell.
  {
    const manY = BEAM_HEIGHT + bodyR + 0.14;
    _gCylZ(buckets.pipe, 0.075, bodyL + 2 * couplerL, { y: manY });
    for (const z of _gSpread(10, bodyL)) {
      _gCylY(buckets.detail, 0.028, 0.14, { y: manY - 0.07, z });
    }
    _gCylZ(buckets.detail, 0.11, 0.05, { y: manY, z: -(bodyL / 2 + couplerL * 0.6) });
  }

  _gBeamEnds(buckets, tileEdge, bodyL / 2 + couplerL);
  _gPedestals(buckets, _gSpread(3, magL * 0.8), BEAM_HEIGHT - couplerR, { w: 0.22, d: 0.18 });

  return buckets;
}
ROLE_BUILDERS.cbandStructure = _buildCbandStructureRoles;

/**
 * X-band structure — 11424 MHz, the finest cell pitch on the ladder and a
 * bore small enough that alignment stops being forgiving. 62 discs over a
 * slim body reads as a dense copper comb. At 100 MV/m the RF and the water
 * both have to arrive from everywhere at once, so this one carries
 * waveguide manifolds above *and* below the axis and water headers on both
 * flanks — the visual difference from C-band is density, not shape.
 */
function _buildXbandStructureRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 3.0;
  const tileEdge = magL / 2;
  const bodyR    = 0.26;
  const couplerR = 0.34;
  const couplerL = 0.22;
  const bodyL    = magL - 2 * couplerL - 0.30;

  _gCylZ(buckets.copper, bodyR, bodyL);

  const diskCount = 62;
  for (const z of _gSpread(diskCount, bodyL)) {
    _gCylZ(buckets.copper, bodyR + 0.025, 0.012, { z });
  }
  for (const sign of [-1, 1]) {
    _gCylZ(buckets.copper, couplerR, couplerL, { z: sign * (bodyL / 2 + couplerL / 2) });
  }

  // Waveguide manifolds above and below, each feeding the body through a
  // row of short coupling irises.
  const manL = bodyL + 2 * couplerL;
  for (const ySign of [1, -1]) {
    const manY = BEAM_HEIGHT + ySign * (bodyR + 0.16);
    _gBox(buckets.accent, 0.22, 0.13, manL, { y: manY });
    for (const z of _gSpread(8, bodyL)) {
      _gCylY(buckets.detail, 0.035, 0.12, { y: manY - ySign * 0.11, z });
    }
    // Feed elbow at the upstream end of each manifold.
    _gBox(buckets.detail, 0.28, 0.17, 0.09, { y: manY, z: -(manL / 2 + 0.05) });
  }

  // Water headers on both flanks, at axis height so they clear the manifolds.
  for (const xSign of [1, -1]) {
    const hx = xSign * (bodyR + 0.14);
    _gCylZ(buckets.pipe, 0.055, manL, { x: hx });
    for (const z of _gSpread(6, bodyL)) {
      _gCylX(buckets.detail, 0.022, 0.10, { x: hx - xSign * 0.09, z });
    }
  }

  _gBeamEnds(buckets, tileEdge, bodyL / 2 + couplerL);

  // Two side columns rather than a centre pedestal: the lower waveguide
  // manifold occupies the space a centre column would want, so the columns
  // straddle it and cradle the body on its lower flanks instead.
  {
    const baseH = 0.06;
    const colX = 0.24;
    // Where a column at colX meets the body's surface.
    const colTopY = BEAM_HEIGHT - Math.sqrt(Math.max(0, bodyR * bodyR - colX * colX));
    for (const z of _gSpread(2, magL * 0.66)) {
      for (const xSign of [1, -1]) {
        _gBox(buckets.stand, 0.18, baseH, 0.28, { x: xSign * colX, y: baseH / 2, z });
        _gBox(buckets.stand, 0.12, colTopY - baseH, 0.22, {
          x: xSign * colX, y: (baseH + colTopY) / 2, z,
        });
      }
    }
  }

  return buckets;
}
ROLE_BUILDERS.xbandStructure = _buildXbandStructureRoles;

/**
 * Two-beam module — CLIC's answer to "where does 100 MW of X-band come
 * from": you don't build klystrons, you run a second, low-energy, very
 * high-current drive beam alongside the main one and decelerate it through
 * PETS structures that hand their power across. The doubled beam axis *is*
 * the component. Drive beam above, main beam on the axis, PETS transfer
 * blocks bridging them at every unit. 12 m.
 */
function _buildTwoBeamModuleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 12.0;
  const tileEdge = magL / 2;
  const driveY   = BEAM_HEIGHT + 0.62;   // second axis, above the main one
  const units    = 8;
  const unitL    = 1.36;
  const spanL    = units * unitL;
  const mainR    = 0.17;                 // accelerating structure, small bore
  const driveR   = 0.25;                 // PETS: large bore, low impedance

  const unitZs = _gSpread(units, spanL);

  for (const zc of unitZs) {
    // Main accelerating structure — X-band, so densely disc-loaded.
    _gCylZ(buckets.copper, mainR, unitL - 0.14, { z: zc });
    for (const z of _gSpread(14, unitL - 0.2, zc)) {
      _gCylZ(buckets.copper, mainR + 0.02, 0.012, { z });
    }
    // Drive-beam PETS — coarser periodic loading, much bigger aperture.
    _gCylZ(buckets.copper, driveR, unitL - 0.14, { y: driveY, z: zc });
    for (const z of _gSpread(6, unitL - 0.2, zc)) {
      _gCylZ(buckets.copper, driveR + 0.03, 0.03, { y: driveY, z });
    }
    // Power transfer: PETS output waveguide down to the main structure's
    // input coupler. Offset in +X so both axes stay visible in silhouette.
    _gBox(buckets.accent, 0.17, 0.52, 0.34, { x: 0.30, y: (BEAM_HEIGHT + driveY) / 2, z: zc });
    _gBox(buckets.detail, 0.30, 0.11, 0.24, { x: 0.22, y: driveY - 0.20, z: zc });
    _gBox(buckets.detail, 0.30, 0.11, 0.24, { x: 0.22, y: BEAM_HEIGHT + 0.15, z: zc });
  }

  // Drift pipes bridging the units on both axes.
  for (let i = 0; i < units - 1; i++) {
    const zc = (unitZs[i] + unitZs[i + 1]) / 2;
    _gCylZ(buckets.pipe, PIPE_R, 0.16, { z: zc });
    _gCylZ(buckets.pipe, 0.12, 0.16, { y: driveY, z: zc });
  }

  // The drive beam enters from upstream and is dumped inside the module —
  // it never reaches the exit port, and the dump block says so.
  _gCylZ(buckets.pipe, 0.12, tileEdge - spanL / 2, {
    y: driveY, z: -(spanL / 2 + (tileEdge - spanL / 2) / 2),
  });
  _gCylZ(buckets.detail, 0.20, FLANGE_H, { y: driveY, z: -tileEdge });
  _gBox(buckets.iron, 0.5, 0.5, 0.44, { y: driveY, z: spanL / 2 + 0.24 });
  _gBox(buckets.detail, 0.58, 0.10, 0.10, { y: driveY + 0.28, z: spanL / 2 + 0.24 });

  _gBeamEnds(buckets, tileEdge, spanL / 2);

  // Support frames carry both axes, so they are portal frames rather than
  // the usual single column.
  {
    const baseH = 0.06;
    const topY = driveY + driveR + 0.05;
    for (const z of _gSpread(5, spanL)) {
      for (const xSign of [1, -1]) {
        const cx = xSign * 0.55;
        _gBox(buckets.stand, 0.24, baseH, 0.30, { x: cx, y: baseH / 2, z });
        _gBox(buckets.stand, 0.14, topY - baseH, 0.22, { x: cx, y: (baseH + topY) / 2, z });
      }
      _gBox(buckets.stand, 1.24, 0.09, 0.18, { y: BEAM_HEIGHT - 0.30, z });
      _gBox(buckets.stand, 1.24, 0.09, 0.18, { y: driveY - 0.34, z });
    }
  }

  return buckets;
}
ROLE_BUILDERS.twoBeamModule = _buildTwoBeamModuleRoles;

/**
 * Plasma afterburner — the one component on this ladder that must not read
 * as RF. There is no waveguide, no klystron feed, no cryostat: the
 * accelerating structure is a 20 cm sapphire capillary filled with hydrogen,
 * and everything else in the 10 m footprint is the laser hall that drives
 * it. So the silhouette is a big enclosure sitting beside a nearly bare
 * beam pipe, with turning-mirror housings walking the drive pulse from the
 * enclosure onto the axis, and an injection chicane upstream.
 */
function _buildPlasmaAfterburnerRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 10.0;
  const tileEdge = magL / 2;

  // --- The accelerator itself: small, central, and easy to miss ---
  const capL = 0.30;
  _gCylZ(buckets.pipe, 0.045, capL);                       // sapphire capillary
  _gBox(buckets.iron, 0.30, 0.30, 0.46, { z: 0 });         // discharge housing
  _gBox(buckets.detail, 0.36, 0.06, 0.08, { y: BEAM_HEIGHT + 0.17, z: -0.14 });
  _gBox(buckets.detail, 0.36, 0.06, 0.08, { y: BEAM_HEIGHT + 0.17, z: 0.14 });
  // Hydrogen feed line into the cell — the plasma is made fresh each shot.
  _gCylY(buckets.detail, 0.03, 0.34, { x: -0.12, y: BEAM_HEIGHT + 0.32, z: 0 });

  // --- Laser enclosure: the silhouette ---
  // Class-4 laser at joule-scale pulse energy lives in a sealed, interlocked
  // hall. It is offset to +X so the beam axis stays clear.
  const encX = 0.60, encW = 0.78, encH = 1.35, encL = 6.0, encZ = -0.9;
  _gBox(buckets.accent, encW, encH, encL, { x: encX, y: encH / 2, z: encZ });
  // Panel seams and roof rails.
  for (const z of _gSpread(6, encL, encZ)) {
    _gBox(buckets.detail, encW + 0.03, 0.05, 0.06, { x: encX, y: encH * 0.62, z });
  }
  _gBox(buckets.detail, encW * 0.5, 0.10, encL * 0.9, { x: encX, y: encH + 0.05, z: encZ });
  // Chiller / power-supply skid against the far end of the hall.
  _gBox(buckets.iron, 0.62, 0.85, 1.0, { x: encX, y: 0.425, z: encZ - encL / 2 - 0.52 });
  _gBox(buckets.detail, 0.66, 0.10, 0.34, { x: encX, y: 0.90, z: encZ - encL / 2 - 0.52 });

  // --- Laser transport: enclosure -> turning mirrors -> capillary ---
  // Evacuated transport tube out of the hall, two turning-mirror housings,
  // then the final optic, which drops the pulse onto the beam axis. The
  // transport runs above the beam pipe so the housings can sit on the axis
  // in plan view without fouling the vacuum chamber.
  const transY = BEAM_HEIGHT + 0.34;
  const mirrorZ = -1.35;
  const encFaceX = encX - encW / 2;
  _gCylX(buckets.pipe, 0.075, encFaceX, { x: encFaceX / 2, y: transY, z: mirrorZ });
  for (const mz of [mirrorZ, -0.55]) {
    _gCylY(buckets.iron, 0.15, 0.28, { x: 0, y: transY, z: mz });
    _gCylY(buckets.detail, 0.18, 0.04, { x: 0, y: transY + 0.16, z: mz });
  }
  _gSegment(buckets.pipe, [0, transY, mirrorZ], [0, transY, -0.55], 0.06);
  // Final turning mirror drops the pulse onto the axis just upstream of the
  // cell — collinear with the beam, which is the whole trick.
  _gSegment(buckets.pipe, [0, transY, -0.55], [0, BEAM_HEIGHT, -0.30], 0.055);

  // --- Injection chicane upstream: four small dipoles ---
  // The witness bunch has to be dropped into the wake with sub-micron
  // timing, so it arrives through its own chicane rather than straight on.
  for (const [i, z] of _gSpread(4, 2.2, -2.9).entries()) {
    const xOff = (i === 1 || i === 2) ? -0.13 : 0;
    _gBox(buckets.accent, 0.36, 0.34, 0.30, { x: xOff, z });
    _gBox(buckets.copper, 0.40, 0.07, 0.24, { x: xOff, y: BEAM_HEIGHT + 0.20, z });
    _gBox(buckets.copper, 0.40, 0.07, 0.24, { x: xOff, y: BEAM_HEIGHT - 0.20, z });
  }

  // --- Diagnostics downstream: a spectrometer dipole and its screen tank ---
  _gBox(buckets.accent, 0.40, 0.36, 0.40, { z: 1.6 });
  _gCylY(buckets.pipe, 0.26, 0.44, { x: -0.32, y: BEAM_HEIGHT + 0.30, z: 2.5 });

  // Beam pipe runs the full length; the capillary is the only break in it.
  for (const sign of [-1, 1]) {
    const inner = capL / 2;
    const runL = tileEdge - inner;
    _gCylZ(buckets.pipe, PIPE_R, runL, { z: sign * (inner + runL / 2) });
    _gCylZ(buckets.detail, FLANGE_R, FLANGE_H, { z: sign * tileEdge });
  }

  _gPedestals(buckets, [-4.2, -2.9, -1.4, 0, 1.6, 3.2, 4.4], BEAM_HEIGHT - 0.22, {
    w: 0.20, d: 0.18,
  });

  return buckets;
}
ROLE_BUILDERS.plasmaAfterburner = _buildPlasmaAfterburnerRoles;

/**
 * Crystal channeling stage — the one accelerating component in the game that
 * contains no accelerating structure at all. The medium is a bent silicon
 * wafer a few centimetres across; everything else inside the 10 m footprint
 * is the machine that holds it still.
 *
 * Modelled on UA9's goniometer at the SPS and its LHC crystal-collimation
 * descendants: pneumatic isolators, a granite bench, a pitch cradle whose
 * centre of curvature is the crystal itself, a yaw stage under a small UHV
 * cross, and a laser interferometer watching the stack because the Lindhard
 * critical angle is tens of microradians and nothing mechanical holds that
 * open-loop. The mount outweighs the crystal by roughly 100:1, and that ratio
 * IS the read — what the player is buying is alignment, not a resonator. So:
 * no waveguide, no coupler, no cryostat, nothing that bulges into cells.
 */
function _buildCrystalChannelStageRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 10.0;              // subL 20
  const tileEdge = magL / 2;

  // --- Pneumatic isolators + granite bench ---
  // The bench is the single largest object here and it is inert: mass and
  // damping are the whole product. Six air legs, because three-point support
  // is what a real optical table uses and six reads as "heavier still".
  const benchH = 0.28, benchTop = 0.40, benchW = 1.80, benchL = 6.4;
  for (const z of [-2.6, 0, 2.6]) {
    for (const x of [-0.62, 0.62]) _gCylY(buckets.stand, 0.15, 0.12, { x, y: 0.06, z });
  }
  _gBox(buckets.stand, benchW, benchH, benchL, { y: benchTop - benchH / 2 });
  // Kinematic mounting rails let the stage stack be lifted off and put back
  // on the same three points — the only reason a bench this big is useful.
  for (const x of [-0.72, 0.72]) {
    _gBox(buckets.detail, 0.10, 0.05, benchL - 0.4, { x, y: benchTop + 0.025 });
  }

  // --- Pitch cradle: two arc rails centred ON the crystal ---
  // A goniometer's defining trick. Because the arc's centre of curvature sits
  // at the beam axis, rotating the carriage tilts the crystal without
  // translating it, so the beam never walks off the channel while you search
  // for the alignment angle.
  const cradleR = 0.56, cradleX = 0.60;
  for (const sx of [-1, 1]) {
    _gArc(buckets.iron, [sx * cradleX, BEAM_HEIGHT, 0], cradleR, -1.08, 1.08, 10, 0.055);
    // Saddle tying the arc's low point down to the bench.
    _gBox(buckets.iron, 0.18, 0.07, 0.44, { x: sx * cradleX, y: benchTop + 0.02 });
    // Worm drive that walks the carriage along the rail.
    _gCylZ(buckets.detail, 0.035, 0.9, { x: sx * (cradleX - 0.10), y: 0.50 });
  }

  // --- Tilt carriage riding the cradle ---
  const carY = 0.545;
  _gBox(buckets.iron, 1.44, 0.09, 0.40, { y: carY });
  for (const sx of [-1, 1]) _gBox(buckets.iron, 0.15, 0.09, 0.24, { x: sx * cradleX, y: 0.50 });

  // --- Yaw (theta) stage: the axis that actually finds the channel ---
  // Everything else is a convenience; this one is swept in microradian steps
  // until the beam falls into the corridor between lattice planes.
  _gCylY(buckets.iron, 0.30, 0.16, { y: 0.67 });
  _gCylY(buckets.accent, 0.325, 0.03, { y: 0.765 });   // graduated angle readout
  _gCylY(buckets.pipe, 0.10, 0.08, { y: 0.79 });        // rotary vacuum feedthrough

  // --- Micrometer / piezo actuators ---
  // Coarse micrometers on the outside, a piezo flexure under the yaw stage.
  // Two stages of resolution is what gets you from millimetres to the
  // microradian setting range the crystal needs.
  for (const sx of [-1, 1]) {
    _gCylX(buckets.iron, 0.045, 0.22, { x: sx * 0.44, y: 0.67 });
    _gCylX(buckets.detail, 0.075, 0.04, { x: sx * 0.575, y: 0.67 });
    _gCylY(buckets.iron, 0.04, 0.24, { x: sx * 0.34, y: 0.50, z: 0.28 });
    _gCylY(buckets.detail, 0.065, 0.035, { x: sx * 0.34, y: 0.635, z: 0.28 });
  }
  _gBox(buckets.accent, 0.30, 0.05, 0.30, { y: 0.615 });

  // --- The crystal chamber: a small UHV cross on the axis ---
  // Physically the smallest vessel on any beamline in the catalogue. The
  // silicon inside it is centimetres across and never visible; the bright
  // band and the viewports are what mark where it is.
  const chR = 0.20, chHalf = 0.22;
  _gCylZ(buckets.pipe, chR, chHalf * 2);
  _gCylZ(buckets.accent, chR + 0.015, 0.07);
  for (const sign of [-1, 1]) {
    _gCylZ(buckets.detail, 0.26, 0.05, { z: sign * (chHalf + 0.025) });
    // Viewport nozzle: alignment is checked optically before the beam is let in.
    _gCylX(buckets.pipe, 0.09, 0.16, { x: sign * 0.28 });
    _gCylX(buckets.accent, 0.105, 0.03, { x: sign * 0.375 });
  }
  _gCylY(buckets.pipe, 0.07, 0.20, { y: BEAM_HEIGHT + 0.30 });
  _gCylY(buckets.detail, 0.105, 0.035, { y: BEAM_HEIGHT + 0.417 });

  // Ion pump on a tee downstream — a channeling crystal is a UHV device and
  // an oil-free one, because a hydrocarbon film on the surface destroys the
  // channel long before the radiation damage does.
  _gCylY(buckets.pipe, 0.09, 0.30, { y: BEAM_HEIGHT + 0.25, z: 0.90 });
  _gBox(buckets.iron, 0.30, 0.26, 0.34, { y: BEAM_HEIGHT + 0.53, z: 0.90 });

  // --- Laser interferometer arm ---
  // The readout that makes the whole thing an instrument instead of a stand:
  // a heterodyne interferometer measuring the carriage against a fixed
  // reference, continuously, while a TeV beam deposits into the crystal and
  // tries to move it.
  const armX = -0.86, armY = BEAM_HEIGHT + 0.12;
  _gBox(buckets.iron, 0.16, 0.10, 5.2, { x: armX, y: BEAM_HEIGHT });
  for (const z of [-2.0, 2.0]) _gCylY(buckets.stand, 0.05, 0.55, { x: armX, y: 0.675, z });
  _gBox(buckets.accent, 0.26, 0.22, 0.62, { x: armX, y: BEAM_HEIGHT + 0.16, z: -2.10 });
  _gBox(buckets.detail, 0.14, 0.14, 0.14, { x: armX, y: armY, z: -0.60 });  // beam splitter
  _gBox(buckets.detail, 0.12, 0.12, 0.12, { x: armX, y: armY, z: 1.60 });   // reference retro
  // Measurement retroreflector, posted up off the carriage itself.
  _gCylY(buckets.iron, 0.03, 0.52, { x: -0.40, y: 0.86, z: -0.60 });
  _gBox(buckets.detail, 0.11, 0.11, 0.11, { x: -0.40, y: armY, z: -0.60 });
  _gCylZ(buckets.accent, 0.014, 1.12, { x: armX, y: armY, z: -1.23 });
  _gCylZ(buckets.accent, 0.014, 2.13, { x: armX, y: armY, z: 0.53 });
  _gCylX(buckets.accent, 0.014, 0.40, { x: -0.63, y: armY, z: -0.60 });

  // --- Stage controller and interferometer electronics ---
  for (const z of [-3.70, 3.70]) {
    _gBox(buckets.iron, 0.50, 0.72, 0.66, { x: 0.62, y: 0.36, z });
    _gBox(buckets.detail, 0.06, 0.30, 0.50, { x: 0.89, y: 0.50, z });
    _gBox(buckets.accent, 0.10, 0.06, 0.30, { x: 0.89, y: 0.66, z });
  }

  // --- Beam line through: bare pipe, a bellows and a sector valve each side ---
  // Ten metres of tile and almost all of it is plain pipe. Nothing here
  // accelerates except the 300 µm of silicon at z = 0.
  _gBeamEnds(buckets, tileEdge, chHalf + 0.05);
  for (const sign of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      _gCylZ(buckets.detail, PIPE_R + 0.035, 0.035, { z: sign * (1.5 + k * 0.06) });
    }
    _gBox(buckets.accent, 0.26, 0.34, 0.14, { z: sign * 2.4, y: BEAM_HEIGHT + 0.06 });
    _gCylX(buckets.detail, 0.09, 0.04, { x: 0.17, y: BEAM_HEIGHT + 0.06, z: sign * 2.4 });
  }
  _gPedestals(buckets, [-4.3, -3.4, 3.4, 4.3], BEAM_HEIGHT - 0.14, { w: 0.18, d: 0.16 });

  return buckets;
}
ROLE_BUILDERS.crystalChannelStage = _buildCrystalChannelStageRoles;

/**
 * Fast kicker — a magnet that is almost entirely not a magnet. The ferrite
 * window-frame yoke is small because it has to be: rise time scales with
 * stored energy, so a kicker gets a tiny aperture and a handful of turns.
 * The hardware that costs money and takes floor space is the
 * pulse-forming network — a cabinet of charged line, thyratron and
 * terminating load — and the thick coaxial pulse cables between them.
 * Those cables are the identity: read them and this is not a dipole.
 *
 * subW is 2, not 4 — this is a 1 m × 2 m tile — so the cabinet cannot stand
 * beside the magnet the way it does in a real tunnel. It stands *upstream*
 * of it instead, hard against one side, and the magnet occupies the last
 * half metre. Same story, told along Z.
 */
function _buildFastKickerRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 2.0;
  const tileEdge = magL / 2;
  const yokeZ    = 0.56;   // the magnet lives downstream; the cabinet owns the rest

  // --- Ferrite window-frame yoke ---
  // Small on purpose: kicker rise time goes as the stored energy, so the
  // aperture is the minimum the beam will tolerate and the winding is one
  // turn. This is the entire magnet.
  const yokeOuter = 0.17, wall = 0.05, yokeL = 0.44;
  for (const ySign of [1, -1]) {
    _gBox(buckets.iron, 2 * yokeOuter, wall, yokeL, {
      y: BEAM_HEIGHT + ySign * (yokeOuter - wall / 2), z: yokeZ,
    });
  }
  for (const xSign of [1, -1]) {
    _gBox(buckets.iron, wall, 2 * yokeOuter - 2 * wall, yokeL, {
      x: xSign * (yokeOuter - wall / 2), z: yokeZ,
    });
  }
  // Single-turn copper busbars on the inner faces — a kicker cannot afford
  // more inductance than that.
  for (const ySign of [1, -1]) {
    _gBox(buckets.copper, 0.16, 0.035, yokeL + 0.06, {
      y: BEAM_HEIGHT + ySign * (yokeOuter - wall - 0.025), z: yokeZ,
    });
  }
  // Ceramic chamber collars either side of the yoke: a metal chamber would
  // short out the kick before it reached the beam.
  for (const sign of [-1, 1]) {
    _gCylZ(buckets.detail, 0.11, 0.05, { z: yokeZ + sign * (yokeL / 2 + 0.04) });
  }

  // --- Pulse-forming network cabinet: the actual bulk of the component ---
  const cabX = -0.32, cabW = 0.32, cabH = 1.50, cabL = 1.34;
  const cabZ = -0.28;
  _gBox(buckets.accent, cabW, cabH, cabL, { x: cabX, y: cabH / 2, z: cabZ });
  _gBox(buckets.detail, cabW + 0.04, 0.08, cabL + 0.04, { x: cabX, y: cabH + 0.04, z: cabZ });
  // Door louvres — a PFN dumps most of its stored energy as heat.
  for (const z of _gSpread(4, cabL * 0.8, cabZ)) {
    _gBox(buckets.detail, 0.04, 0.46, 0.20, { x: cabX + cabW / 2 + 0.02, y: 0.82, z });
  }
  // Thyratron stack rising out of the cabinet roof — the switch that decides
  // which bunch gets kicked and which does not.
  _gCylY(buckets.detail, 0.10, 0.28, { x: cabX, y: cabH + 0.22, z: cabZ - 0.42 });
  _gCylY(buckets.detail, 0.14, 0.05, { x: cabX, y: cabH + 0.38, z: cabZ - 0.42 });

  // --- Coaxial pulse cables, cabinet roof to yoke ---
  // Four of them, arcing over the gap. Deliberately thick — 50 Ω coax at
  // tens of kilovolts is wrist-sized, and at this scale it is the single
  // most recognisable thing in the component.
  const cableR = 0.05;
  for (const xi of [-0.09, -0.03, 0.03, 0.09]) {
    const path = [
      [cabX + xi, cabH - 0.04, cabZ + cabL / 2 - 0.10],
      [cabX + xi, cabH + 0.14, cabZ + cabL / 2 + 0.06],
      [xi * 0.5, cabH + 0.10, yokeZ - 0.18],
      [xi * 0.5, BEAM_HEIGHT + yokeOuter + 0.03, yokeZ],
    ];
    for (let i = 0; i < path.length - 1; i++) {
      _gSegment(buckets.iron, path[i], path[i + 1], cableR);
    }
    // Cable-end connector at the magnet feedthrough.
    _gCylY(buckets.detail, cableR * 1.5, 0.06, {
      x: xi * 0.5, y: BEAM_HEIGHT + yokeOuter + 0.06, z: yokeZ,
    });
  }
  // Matched terminating load on the far side, with its own return cable —
  // the pulse has to go somewhere after it has crossed the aperture.
  _gBox(buckets.iron, 0.20, 0.34, 0.34, { x: 0.32, y: BEAM_HEIGHT - 0.02, z: yokeZ });
  _gSegment(buckets.iron,
    [0.10, BEAM_HEIGHT + yokeOuter, yokeZ],
    [0.30, BEAM_HEIGHT + 0.16, yokeZ], cableR);

  // The beam pipe runs the full tile — the yoke is offset downstream, so
  // there is no symmetric inner boundary to stub from.
  _gBeamEnds(buckets, tileEdge, 0);
  _gPedestals(buckets, [yokeZ], BEAM_HEIGHT - yokeOuter, { w: 0.18, d: 0.16 });

  return buckets;
}
ROLE_BUILDERS.fastKicker = _buildFastKickerRoles;

/**
 * Recirculation arc — the beam leaves the straight, walks a lateral arc
 * through a row of small dipoles, and rejoins downstream. Energy recovery
 * lives or dies on getting the return path's phase right, and the arc is
 * where that is set.
 *
 * The bypass leaves toward local -X, which is the 'left' / W side once the
 * placeable's `dir` is applied (junctions.js SIDE_TO_COMPASS), and that is
 * where the catalogue entry puts its `arcEntry` port. The apex therefore
 * carries a real stub and CF flange out at the tile edge: the returning
 * beam ties in there. If the routing ever moves that port to 'right', this
 * geometry has to flip with it — the router and the picture must agree. 6 m.
 */
function _buildRecirculationArcRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 6.0;
  const tileEdge = magL / 2;
  const splitZ   = 2.35;    // where the arc leaves and rejoins
  const arcX     = -0.70;   // lateral excursion at the apex (fits subW=4)

  // Straight-through chord, full length.
  _gBeamEnds(buckets, tileEdge, splitZ);
  _gCylZ(buckets.pipe, PIPE_R, 2 * splitZ);

  // Arc path: a raised-cosine bump, which gives zero lateral slope at both
  // junctions so the arc pipe meets the chord tangentially.
  const arcPt = (t) => {
    const z = -splitZ + 2 * splitZ * t;
    const x = arcX * 0.5 * (1 - Math.cos(2 * Math.PI * t));
    return [x, BEAM_HEIGHT, z];
  };
  const arcSegs = 18;
  for (let i = 0; i < arcSegs; i++) {
    _gSegment(buckets.pipe, arcPt(i / arcSegs), arcPt((i + 1) / arcSegs), PIPE_R * 0.9, 8);
  }

  // Small dipoles along the arc, each yawed onto the local tangent. The
  // apex is left clear for the arcEntry tie-in.
  for (const t of [0.12, 0.28, 0.72, 0.88]) {
    const p = arcPt(t);
    const q = arcPt(Math.min(1, t + 0.01));
    const rotY = Math.atan2(q[0] - p[0], q[2] - p[2]);
    _gBox(buckets.accent, 0.42, 0.34, 0.34, { x: p[0], z: p[2], rotY });
    for (const ySign of [1, -1]) {
      _gBox(buckets.copper, 0.30, 0.06, 0.28, {
        x: p[0], y: BEAM_HEIGHT + ySign * 0.20, z: p[2], rotY,
      });
    }
  }

  // Splitter and recombiner at the two junctions — bigger than the arc
  // dipoles because they have to separate two beams of different energy.
  for (const sign of [-1, 1]) {
    _gBox(buckets.accent, 0.52, 0.44, 0.48, { z: sign * splitZ });
    _gBox(buckets.iron, 0.60, 0.10, 0.34, { y: BEAM_HEIGHT + 0.27, z: sign * splitZ });
    _gCylY(buckets.detail, 0.06, 0.22, { x: 0.20, y: BEAM_HEIGHT + 0.42, z: sign * splitZ });
  }

  // Apex: the merge box where the returning beam ties in, and the stub and
  // CF flange that carry the `arcEntry` port out to the left tile edge.
  {
    const tileHalfW = 1.0;                    // subW 4
    _gBox(buckets.accent, 0.30, 0.34, 0.44, { x: arcX, z: 0 });
    const stubStart = arcX - 0.15;
    const stubL = tileHalfW + stubStart;      // stubStart is negative
    _gCylX(buckets.pipe, PIPE_R, stubL, { x: stubStart - stubL / 2, z: 0 });
    _gCylX(buckets.detail, FLANGE_R, FLANGE_H, { x: -tileHalfW, z: 0 });
  }

  // Corrector and a BPM button block on the return leg.
  _gBox(buckets.detail, 0.22, 0.20, 0.18, { x: arcX * 0.8, y: BEAM_HEIGHT + 0.12, z: 0.9 });

  // Pedestals under both paths.
  _gPedestals(buckets, [-2.35, 0, 2.35], BEAM_HEIGHT - 0.24, { w: 0.22, d: 0.18 });
  for (const t of [0.25, 0.5, 0.75]) {
    const p = arcPt(t);
    _gPedestals(buckets, [p[2]], BEAM_HEIGHT - 0.22, { w: 0.20, d: 0.18, x: p[0] });
  }

  return buckets;
}
ROLE_BUILDERS.recirculationArc = _buildRecirculationArcRoles;

/**
 * Final focus doublet — the last two magnets before the interaction point,
 * and the reason a collider's luminosity is what it is. Two superconducting
 * quads back to back in one cryostat, at deliberately different apertures:
 * the upstream one is wide because the beam is still large there, the
 * IP-side one is narrow and its cryostat tapers to a cone so the detector
 * can be pushed as close to the collision as the magnet allows. 3 m.
 */
function _buildFinalFocusDoubletRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 3.0;
  const tileEdge = magL / 2;

  // Two cold masses. QF1 upstream: big bore, big body. QD0 downstream:
  // smaller everything, because it sits inside the detector's shadow.
  const quads = [
    { z: -0.62, len: 1.05, r: 0.42, bore: 0.135, label: 'QF1' },
    { z: 0.58, len: 0.85, r: 0.31, bore: 0.075, label: 'QD0' },
  ];

  for (const q of quads) {
    _gCylZ(buckets.accent, q.r, q.len, { z: q.z });
    // Collar rings and four saddle coil packs — the quad read, at the only
    // level of detail a cryostat lets you see.
    for (const z of _gSpread(4, q.len * 0.86, q.z)) {
      _gCylZ(buckets.detail, q.r + 0.025, 0.05, { z });
    }
    for (const a of [0.25, 0.75, 1.25, 1.75]) {
      const ang = a * Math.PI;
      _gBox(buckets.copper, 0.16, 0.16, q.len * 0.9, {
        x: Math.cos(ang) * (q.r + 0.06),
        y: BEAM_HEIGHT + Math.sin(ang) * (q.r + 0.06),
        z: q.z,
      });
    }
    // Cryo port and current-lead box for each cold mass.
    _gCylY(buckets.pipe, 0.07, 0.30, { y: BEAM_HEIGHT + q.r + 0.15, z: q.z - q.len * 0.28 });
    _gBox(buckets.iron, 0.24, 0.30, 0.26, { x: -(q.r + 0.14), y: BEAM_HEIGHT + 0.24, z: q.z + q.len * 0.3 });
  }

  // The interconnect between the two quads is the one place the aperture
  // step is actually visible: wide bore in, cone, narrow bore out.
  {
    const aZ = quads[0].z + quads[0].len / 2;
    const bZ = quads[1].z - quads[1].len / 2;
    const midL = bZ - aZ;
    _gCylZ(buckets.pipe, quads[0].bore, midL * 0.35, { z: aZ + midL * 0.175 });
    _gCylZ(buckets.pipe, quads[0].bore, midL * 0.3, {
      z: aZ + midL * 0.5, rTop: quads[1].bore,
    });
    _gCylZ(buckets.pipe, quads[1].bore, midL * 0.35, { z: bZ - midL * 0.175 });
    _gCylZ(buckets.detail, quads[0].bore + 0.04, 0.04, { z: aZ + 0.02 });
  }

  // Upstream: flat cryostat end plate, then warm beam pipe to the tile edge.
  {
    const endZ = quads[0].z - quads[0].len / 2;
    _gCylZ(buckets.accent, quads[0].r, 0.10, { z: endZ - 0.05 });
    _gCylZ(buckets.detail, quads[0].r + 0.04, 0.05, { z: endZ - 0.10 });
    const runL = tileEdge - (endZ - 0.10);
    _gCylZ(buckets.pipe, quads[0].bore, runL, { z: -(tileEdge - runL / 2) });
    _gCylZ(buckets.detail, FLANGE_R, FLANGE_H, { z: -tileEdge });
  }

  // Downstream: the conical nose toward the IP.
  {
    const startZ = quads[1].z + quads[1].len / 2;
    const coneL = tileEdge - startZ - 0.14;
    _gCylZ(buckets.accent, quads[1].r, coneL, { z: startZ + coneL / 2, rTop: 0.14 });
    _gCylZ(buckets.pipe, PIPE_R, 0.14, { z: tileEdge - 0.07 });
    _gCylZ(buckets.detail, FLANGE_R * 0.8, FLANGE_H, { z: tileEdge });
  }

  for (const q of quads) {
    _gPedestals(buckets, [q.z], BEAM_HEIGHT - q.r, { w: 0.26, d: 0.22 });
  }

  return buckets;
}
ROLE_BUILDERS.finalFocusDoublet = _buildFinalFocusDoubletRoles;

/**
 * Black hole chamber — the interaction region of the tier-6 machine, and the
 * only endpoint in the game with a beam port on both faces (entryA/entryB).
 *
 * The read wanted here is containment, not observation: this is closer to a
 * reactor vessel in a shielded pit than to `detector`'s open barrel. A heavy
 * spherical shell on a saddle, girth straps, two opposed nozzles with their
 * final-focus doublets squeezing beta-star down to millimetres just outside,
 * and shield walls stacked from discrete blocks with the roof beams only
 * partly on — so the silhouette says the vessel is normally buried and is
 * being looked at through a gap.
 *
 * Sphere radius is set by the floor, not by the catalogue's 12 m: the beam
 * axis is fixed at BEAM_HEIGHT = 1 m, the vessel is centred on the beam, so
 * anything past ~0.95 m radius would sink through the ground.
 */
function _buildBlackHoleChamberRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 6.0;               // subL 12
  const tileEdge = magL / 2;
  const vesselR  = 0.92;

  // --- Plinth and saddle ---
  // A vessel this heavy is not on legs; it sits in a cradle on a poured pad.
  _gBox(buckets.stand, 2.80, 0.16, 2.60, { y: 0.08 });
  for (const z of [-0.62, 0.62]) {
    _gBox(buckets.stand, 0.70, 0.16, 0.50, { y: 0.24, z });
    _gBox(buckets.iron, 0.92, 0.10, 0.56, { y: 0.35, z });
  }

  // --- Containment vessel ---
  // Sphere UVs are already 0→1 per hemisphere, so unlike Box/Cylinder this
  // one needs no applyTiled* pass (same as the SRF cell strings above).
  {
    const g = new THREE.SphereGeometry(vesselR, SEGS * 2, SEGS);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0));
  }
  // Girth straps: an accent belt on the equator plus two meridional bands.
  // Each is a disc slightly larger than the sphere, so only the rim shows —
  // exactly how a welded reinforcing strap reads from outside.
  _gCylY(buckets.accent, vesselR + 0.035, 0.12, { y: BEAM_HEIGHT });
  _gCylZ(buckets.iron, vesselR + 0.030, 0.10);
  _gCylX(buckets.iron, vesselR + 0.030, 0.10);

  // --- Two opposed beam entries ---
  // entryA on -Z, entryB on +Z. Each nozzle flares from beam-pipe bore up to
  // the vessel penetration; the doublet outside it is the final focus, which
  // is what buys the luminosity a 200 TeV collision rate needs.
  for (const sign of [-1, 1]) {
    _gCylZ(buckets.detail, 0.36, 0.06, { z: sign * 0.90 });
    _gCylZ(buckets.pipe, sign > 0 ? 0.30 : 0.14, 0.55, {
      z: sign * 1.10, rTop: sign > 0 ? 0.14 : 0.30,
    });
    for (const qz of [1.72, 2.24]) {
      _gBox(buckets.accent, 0.62, 0.62, 0.42, { z: sign * qz });
      for (const dy of [-0.24, 0.24]) {
        _gBox(buckets.copper, 0.68, 0.10, 0.34, { y: BEAM_HEIGHT + dy, z: sign * qz });
      }
    }
  }
  _gBeamEnds(buckets, tileEdge, 1.375);

  // --- Instrumentation penetrations on the upper hemisphere ---
  // Every port is a hole in the shielding, which is why they all point up and
  // away from the plane the debris fan lives in.
  for (const d of [
    [0.62, 0.66, 0.42], [-0.62, 0.66, 0.42],
    [0.62, 0.66, -0.42], [-0.62, 0.66, -0.42],
    [0.0, 0.72, 0.70], [0.0, 0.72, -0.70],
  ]) {
    const n = Math.hypot(d[0], d[1], d[2]);
    const u = [d[0] / n, d[1] / n, d[2] / n];
    const p0 = [u[0] * (vesselR - 0.05), BEAM_HEIGHT + u[1] * (vesselR - 0.05), u[2] * (vesselR - 0.05)];
    const p1 = [u[0] * (vesselR + 0.24), BEAM_HEIGHT + u[1] * (vesselR + 0.24), u[2] * (vesselR + 0.24)];
    const p2 = [u[0] * (vesselR + 0.30), BEAM_HEIGHT + u[1] * (vesselR + 0.30), u[2] * (vesselR + 0.30)];
    _gSegment(buckets.pipe, p0, p1, 0.075, 10);
    _gSegment(buckets.detail, p1, p2, 0.115, 10);
  }

  // --- Top access hatch ---
  _gCylY(buckets.pipe, 0.20, 0.24, { y: BEAM_HEIGHT + vesselR + 0.10 });
  _gCylY(buckets.accent, 0.26, 0.05, { y: BEAM_HEIGHT + vesselR + 0.245 });

  // --- Radial shielding ---
  // Tungsten close in, stacked concrete outside it. Blocks rather than one
  // slab, with the joints visible: shielding at this scale is assembled and
  // disassembled around the vessel every time anyone goes in.
  for (const sx of [-1, 1]) {
    _gBox(buckets.iron, 0.34, 1.50, 1.90, { x: sx * 1.16, y: 0.75 });
    for (const z of [-1.0, 0, 1.0]) {
      _gBox(buckets.stand, 0.72, 1.55, 0.92, { x: sx * 1.60, y: 0.775, z });
      _gBox(buckets.detail, 0.76, 0.06, 0.08, { x: sx * 1.60, y: 1.58, z });
    }
  }
  // Two roof beams only — the pit is open over the vessel.
  for (const z of [-1.2, 1.2]) _gBox(buckets.iron, 3.10, 0.14, 0.34, { y: 2.10, z });
  // Area radiation monitor on the shield wall.
  _gCylY(buckets.detail, 0.04, 0.60, { x: 1.60, y: 1.85, z: -1.60 });
  _gCylY(buckets.accent, 0.08, 0.10, { x: 1.60, y: 2.20, z: -1.60 });

  return buckets;
}
ROLE_BUILDERS.blackHoleChamber = _buildBlackHoleChamberRoles;

/**
 * Hawking radiation detector — a calorimeter that records rather than
 * collects, and it has to be distinguishable at a glance from `detector`,
 * which is a big magnetised barrel. The difference is not size: it is
 * instrumentation density.
 *
 * So the silhouette is a sampling stack — tungsten absorber alternating with
 * scintillator, fine pitch in the electromagnetic section and coarse in the
 * hadronic one, exactly the way a real sandwich calorimeter is graded — with
 * every layer's light piped out through wavelength-shifting fibre into a
 * manifold and fanned to readout racks. No yoke, no coil, no tracker: nothing
 * here bends a particle, because the measurement is the spectrum of what
 * comes out, not the momentum of any one thing in it.
 */
function _buildHawkingDetectorRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL     = 7.0;               // subL 14
  const tileEdge = magL / 2;

  // --- Steel deck the stack is assembled on ---
  _gBox(buckets.stand, 2.00, 0.22, 3.40, { y: 0.11, z: 0.15 });

  // --- Sampling stack ---
  // EM section first: thin absorber at fine pitch, because a shower from a
  // photon or electron is short and you need many samples inside it. Then the
  // hadronic section: thicker plates, coarser pitch, more of them.
  let z = -1.30;
  const layers = [
    { n: 8,  pitch: 0.085, absD: 0.055, sciD: 0.022, w: 1.56, h: 1.50 },
    { n: 12, pitch: 0.175, absD: 0.115, sciD: 0.038, w: 1.56, h: 1.56 },
  ];
  for (const sec of layers) {
    for (let i = 0; i < sec.n; i++) {
      _gBox(buckets.iron, sec.w, sec.h, sec.absD, { z: z + sec.absD / 2 });
      _gBox(buckets.accent, sec.w + 0.04, sec.h + 0.04, sec.sciD,
        { z: z + sec.absD + sec.sciD / 2 });
      z += sec.pitch;
    }
  }
  const stackFront = -1.30, stackBack = z;

  // --- Hermetic frame ---
  // Four corner rails carrying the plate stack. "Hermetic" is the whole point
  // of the device: an evaporating black hole radiates into every degree of
  // freedom, so anything that escapes through a crack is the signal you lost.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      _gBox(buckets.iron, 0.09, 0.09, stackBack - stackFront + 0.12,
        { x: sx * 0.82, y: BEAM_HEIGHT + sy * 0.80, z: (stackFront + stackBack) / 2 });
    }
  }
  // Entrance snout: the beam pipe flares into the front face and stops there.
  _gCylZ(buckets.pipe, 0.10, 0.24, { z: stackFront - 0.12, rTop: 0.16 });

  // --- Fibre readout: manifold over the stack, bundles out to the racks ---
  _gBox(buckets.detail, 1.70, 0.12, stackBack - stackFront + 0.10,
    { y: BEAM_HEIGHT + 0.86, z: (stackFront + stackBack) / 2 });
  for (const sx of [-1, 1]) {
    for (const fz of _gSpread(5, 2.40, (stackFront + stackBack) / 2)) {
      _gSegment(buckets.copper,
        [sx * 0.30, BEAM_HEIGHT + 0.92, fz],
        [sx * 1.45, BEAM_HEIGHT + 0.45, 2.35], 0.035, 8);
    }
    // Readout rack: this endpoint's product is data, and the rack is where it
    // becomes data. Nothing here is a magnet power supply.
    _gBox(buckets.iron, 0.56, 1.40, 0.62, { x: sx * 1.52, y: 0.70, z: 2.55 });
    _gBox(buckets.detail, 0.06, 1.10, 0.46, { x: sx * 1.82, y: 0.75, z: 2.55 });
    _gBox(buckets.accent, 0.08, 0.05, 0.34, { x: sx * 1.83, y: 1.28, z: 2.55 });
    _gCylZ(buckets.copper, 0.05, 1.50, { x: sx * 1.52, y: 1.46, z: 1.45 });
  }

  // --- Beam entry only: this is an endpoint, the pipe stops in the stack ---
  {
    const inner = stackFront - 0.24;
    const stubL = tileEdge + inner;
    if (stubL > 0.001) _gCylZ(buckets.pipe, PIPE_R, stubL, { z: inner - stubL / 2 });
    _gCylZ(buckets.detail, FLANGE_R, FLANGE_H, { z: -tileEdge });
  }
  _gPedestals(buckets, [-2.90], BEAM_HEIGHT - 0.14, { w: 0.20, d: 0.18 });

  return buckets;
}
ROLE_BUILDERS.hawkingDetector = _buildHawkingDetectorRoles;

// ── Endpoint builders ───────────────────────────────────────────────
ROLE_BUILDERS.faradayCup = _buildFaradayCupRoles;
ROLE_BUILDERS.collisionPoint = _buildCollisionPointRoles;
ROLE_BUILDERS.beamStop   = _buildBeamStopRoles;
ROLE_BUILDERS.detector   = _buildDetectorRoles;
ROLE_BUILDERS.target     = _buildTargetRoles;
ROLE_BUILDERS.materialsTestStation = _buildMaterialsTestStationRoles;
ROLE_BUILDERS.xRayConverterStation = _buildXRayConverterStationRoles;
ROLE_BUILDERS.eBeamIrradiationVault = _buildEBeamIrradiationVaultRoles;
ROLE_BUILDERS.isotopeProductionTarget = _buildIsotopeProductionTargetRoles;
ROLE_BUILDERS.radiationEffectsStation = _buildRadiationEffectsStationRoles;
ROLE_BUILDERS.protonTherapyGantry = _buildProtonTherapyGantryRoles;
ROLE_BUILDERS.spallationNeutronTarget = _buildSpallationNeutronTargetRoles;
ROLE_BUILDERS.photonScienceHutch = _buildPhotonScienceHutchRoles;
ROLE_BUILDERS.xfelEndstation = _buildXfelEndstationRoles;
ROLE_BUILDERS.euvCollector = _buildEuvCollectorRoles;

// Registry: component type id → builder function (legacy path for builders
// that still return a fully-assembled THREE.Group rather than role buckets).
const DETAIL_BUILDERS = {
  source: _buildSource,
  dcPhotoGun: _buildDcPhotoGun,
  ncRfGun: _buildNcRfGun,
  srfGun: _buildSrfGun,
  penningIonSource: _buildPenningIonSource,
  ionSource: _buildDuoplasmatron,
  ecrIonSource: _buildEcrIonSource,
  drift: _buildDrift,
};

// Coverage report: beamline components with no bespoke geometry render as a
// generic box/cylinder. Info-level so missing 3D art stays visible without
// failing anything.
{
  const fallback = roleBuilderFallbacks(
    BEAMLINE_COMPONENTS_RAW,
    [...Object.keys(ROLE_BUILDERS), ...Object.keys(DETAIL_BUILDERS)],
  );
  if (fallback.length > 0) {
    console.info(
      `[content] ${fallback.length} beamline component(s) using fallback box/cylinder geometry ` +
      `(no ROLE_BUILDERS/DETAIL_BUILDERS entry): ${fallback.join(', ')}`,
    );
  }
}

/**
 * Create a transparent ghost version of a beamline component for placement preview.
 * Returns a THREE.Group with all meshes set to transparent + green edge wireframe.
 */
/**
 * Returns true if a component type renders with its internal origin
 * already at the floor (y=0). True for: role/detail-builder components
 * (they bake BEAM_HEIGHT into their geometry) AND parts-list items
 * (each part is positioned with its y=0 on the floor). Fallback single-
 * box items return false — callers must offset by h/2 to un-bury them.
 */
export function isDetailedComponent(compType, compDef) {
  if (!!ROLE_BUILDERS[compType] || !!DETAIL_BUILDERS[compType]) return true;
  if (compDef && Array.isArray(compDef.parts) && compDef.parts.length > 0) return true;
  return false;
}

/**
 * World-space pose (position + Y rotation) of one component instance.
 *
 * Extracted from ComponentBuilder.build so the design-placement ghost in
 * ThreeRenderer can put its translucent copies at exactly the coordinates the
 * committed meshes will land on. Two copies of this arithmetic would drift the
 * first time either the sub-tile centring or the dir 1/3 swap changed, and the
 * whole value of the ghost is that it is not lying about where things go.
 *
 * @param {object} compDef   COMPONENTS entry (or {} for unknown types)
 * @param {{col:number,row:number,subCol:?number,subRow:?number,direction:?number}} inst
 * @param {boolean} isDetailed  true when the visual already has its origin at
 *        the floor (role/detail builders, parts lists, placeholder boxes) —
 *        fallback single-box visuals are centred and need the h/2 lift.
 * @returns {{x:number, y:number, z:number, rotY:number}}
 */
export function componentPose(compDef, inst, isDetailed) {
  const direction = inst.direction || 0;
  const wallPose = compDef?.mount === 'wall'
    ? (compDef.wallPassThrough === true
        ? wallFixturePose(inst.wallMount, 0)
        : wallFixturePose(inst.wallMount))
    : null;
  // gridW/gridH store sub-cell counts (1 sub-cell = 0.5 world units).
  const gwRaw = compDef.gridW || compDef.subW || 4;
  const ghRaw = compDef.gridH || compDef.subL || 4;
  // snapForPlaceable swaps w/h for dir 1/3 when computing the top-left subtile
  // origin, so the render centre must swap too or committed meshes drift from
  // the reserved subcells.
  const swap = (direction === 1 || direction === 3);
  const gwSub = swap ? ghRaw : gwRaw;
  const ghSub = swap ? gwRaw : ghRaw;

  let x, z;
  if (Number.isFinite(inst.worldX) && Number.isFinite(inst.worldZ)) {
    x = inst.worldX;
    z = inst.worldZ;
  // Pipe attachments are the exception: their col/row are interpolated float
  // coordinates along a pipe path, so the mesh centres directly on that point
  // regardless of the component's sub-tile footprint. subCol === null is the
  // marker world-snapshot's buildPipeAttachments sets.
  } else if (inst.subCol == null && inst.subRow == null) {
    x = inst.col * 2 + 1;
    z = inst.row * 2 + 1;
  } else {
    x = inst.col * 2 + ((inst.subCol || 0) + gwSub / 2) * SUB_UNIT;
    z = inst.row * 2 + ((inst.subRow || 0) + ghSub / 2) * SUB_UNIT;
  }

  return {
    x: wallPose?.x ?? x,
    z: wallPose?.z ?? z,
    y: (isDetailed ? 0 : ((compDef.subH || 2) * SUB_UNIT) / 2)
      + (Number.isFinite(inst.yOffset) ? inst.yOffset : 0),
    rotY: wallPose?.yaw ?? (-direction * (Math.PI / 2)),
  };
}

export function createBeamlineGhost(compType) {
  const compDef = COMPONENTS[compType];
  if (!compDef) return null;

  const builder = DETAIL_BUILDERS[compDef.id];
  let group;
  if (builder) {
    group = builder();
  } else {
    // Fallback box/cylinder
    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = (compDef.subH || 2) * SUB_UNIT;
    const l = (compDef.subL || 2) * SUB_UNIT;
    let geometry;
    if (compDef.geometryType === 'cylinder') {
      const radius = Math.min(w, h) / 2;
      geometry = new THREE.CylinderGeometry(radius, radius, l, 8);
      applyTiledCylinderUVs(geometry, radius, l, 8);
      geometry.rotateX(Math.PI / 2);   // along the footprint's length, as above
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geometry, w, h, l);
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x888888 }));
    group = new THREE.Group();
    group.add(mesh);
  }

  // Collect meshes first (avoid mutating group during traversal)
  const meshes = [];
  group.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });

  // Make all meshes transparent and add green wireframe edges
  for (const child of meshes) {
    child.material = child.material.clone();
    child.material.transparent = true;
    child.material.opacity = 0.3;
    child.material.depthWrite = false;
    const wiremat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const wire = new THREE.Mesh(child.geometry, wiremat);
    wire.position.copy(child.position);
    wire.rotation.copy(child.rotation);
    wire.scale.copy(child.scale);
    group.add(wire);
  }

  return group;
}

// ── Fallback / parts visual builder (standalone) ─────────────────────
// Builds a Group/Mesh for a placeable using its declared parts[], or
// a single-box/cylinder fallback if parts is absent. Single source of
// truth for both ComponentBuilder._createFallbackMesh (live + ghost
// meshes) and renderComponentThumbnail (build-menu previews) so all
// three code paths render identical geometry. Honors compDef.baseMaterial
// and compDef.faces for category paint and per-face decals/overrides.
// Returns the visual at its local origin — callers position it in the
// world.
function _buildPartsOrFallback(compDef) {
  if (Array.isArray(compDef.parts) && compDef.parts.length > 0) {
    const group = new THREE.Group();
    const baseColor = compDef.spriteColor ?? 0x888888;
    for (const part of compDef.parts) {
      const pw = (part.w || 1) * SUB_UNIT;
      const ph = (part.h || 1) * SUB_UNIT;
      const pl = (part.l || 1) * SUB_UNIT;
      const geo = new THREE.BoxGeometry(pw, ph, pl);
      applyTiledBoxUVs(geo, pw, ph, pl);
      const partBase = part.material;
      let map = null;
      let color = part.color ?? baseColor;
      if (partBase && MATERIALS[partBase]) {
        map = MATERIALS[partBase].map;
        if (part.color == null) color = 0xffffff;
      }
      const mat = new THREE.MeshStandardMaterial({
        map, color, roughness: 0.7, metalness: 0.15,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (part.x || 0) * SUB_UNIT,
        ((part.y || 0) + (part.h || 1) / 2) * SUB_UNIT,
        (part.z || 0) * SUB_UNIT,
      );
      group.add(mesh);
    }
    return group;
  }

  const vSubW = compDef.visualSubW ?? compDef.subW ?? 2;
  const vSubH = compDef.visualSubH ?? compDef.subH ?? 2;
  const vSubL = compDef.visualSubL ?? compDef.subL ?? 2;
  const INSET = 0.06;
  const w = vSubW * SUB_UNIT - INSET;
  const h = vSubH * SUB_UNIT;
  const l = vSubL * SUB_UNIT - INSET;

  const fallbackColor = compDef.spriteColor !== undefined ? compDef.spriteColor : 0x888888;
  const baseName = compDef.baseMaterial || null;
  const faces = compDef.faces || null;
  const hasBaseOrFaces = !!(baseName || faces);

  let geometry;
  let material;

  if (compDef.geometryType === 'cylinder') {
    const radius = Math.min(w, h) / 2;
    geometry = new THREE.CylinderGeometry(radius, radius, l, 8);
    applyTiledCylinderUVs(geometry, radius, l, 8);
    // The cylinder's length IS the footprint's length (`l` is visualSubL), and
    // the footprint runs subL along local Z — so the tube has to lie along Z.
    // rotateZ put it on X instead, which drew every fallback cylinder across
    // its own footprint: the 16-sub cryomodule became an 8 m barrel lying
    // sideways over a 1 m-wide reservation. rotateX takes +Y to +Z.
    geometry.rotateX(Math.PI / 2);

    if (baseName && MATERIALS[baseName]) {
      const cacheKey = `${compDef.id}|cyl|${baseName}`;
      let m = _infraFaceMatCache.get(cacheKey);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          map: MATERIALS[baseName].map,
          color: 0xffffff,
          roughness: 0.7,
          metalness: 0.2,
        });
        _infraFaceMatCache.set(cacheKey, m);
      }
      material = m;
    } else {
      material = new THREE.MeshStandardMaterial({
        color: fallbackColor, roughness: 0.7, metalness: 0.1,
      });
    }
  } else {
    geometry = new THREE.BoxGeometry(w, h, l);
    applyTiledBoxUVs(geometry, w, h, l);

    if (hasBaseOrFaces) {
      if (faces) {
        for (const key of _INFRA_FACE_KEYS) {
          if (faces[key] && faces[key].decal) {
            _setInfraFaceUVsClamped(geometry, key);
          }
        }
      }
      material = _INFRA_FACE_KEYS.map(key =>
        _infraFaceMaterial(
          compDef.id,
          key,
          baseName,
          faces ? faces[key] : null,
          fallbackColor,
        )
      );
    } else {
      material = new THREE.MeshStandardMaterial({
        color: fallbackColor, roughness: 0.7, metalness: 0.1,
      });
    }
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Keep the fallback housing (and therefore its per-face decals) as the
  // shell, then attach an explicit, reviewed physical profile for every
  // formerly generic placeable.  Both live placement and thumbnails call
  // this function, so their silhouettes cannot drift apart.
  const details = buildPlaceableVisualDetails(compDef, {
    width: w, height: h, length: l, color: fallbackColor,
  });
  if (!details) return mesh;
  const group = new THREE.Group();
  group.add(mesh, details);
  return group;
}

// ── Thumbnail renderer ──────────────────────────────────────────────
// Static pre-rendered thumbnails. Vite resolves these at build time so the
// palette never needs a live WebGL render for components that have a PNG.
const _staticThumbMap = {};
try {
  // import.meta.glob is a Vite-only build-time macro. Guarded so this module
  // stays importable from plain-Node headless tests (see
  // test/test-glow-role.js), which have no Vite transform and no
  // filesystem-backed asset glob — thumbnails there simply fall back to the
  // live-render path below.
  const _staticThumbs = import.meta.glob('/assets/textures/thumbnails/*.png', { eager: true, query: '?url', import: 'default' });
  for (const [path, val] of Object.entries(_staticThumbs)) {
    const id = path.split('/').pop().replace('.png', '');
    _staticThumbMap[id] = typeof val === 'string' ? val : (val && val.default) || val;
  }
} catch (_) { /* not running under Vite — see comment above */ }

const _thumbCache = new Map();

/**
 * Render a component's 3D model to a data URL thumbnail.
 * Returns null if the component has no detailed 3D model.
 */
let _thumbRenderer = null;
let _thumbScene = null;
let _thumbCamera = null;

function _getThumbRenderer(size) {
  if (!THREE.WebGLRenderer) return null;
  if (!_thumbRenderer) {
    _thumbRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    _thumbScene = new THREE.Scene();
    _thumbScene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(-5, 8, 4);
    _thumbScene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
    fillLight.position.set(6, 3, -4);
    _thumbScene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, -4, -2);
    _thumbScene.add(rimLight);
    _thumbCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }
  _thumbRenderer.setSize(size * 2, size * 2);
  _thumbRenderer.setClearColor(0x000000, 0);
  return { renderer: _thumbRenderer, scene: _thumbScene, camera: _thumbCamera };
}

// type → {minX, maxX, minY, maxY, minZ, maxZ} in metres, or null when the type
// has no model at all. Measured once per type from a throwaway instance.
const _boundsCache = new Map();

/**
 * Instantiate a type's model the way getModelBounds and the thumbnail path do,
 * or null when THREE is absent, the type is unknown, or its builder throws.
 * The caller owns the result and must dispose it.
 *
 * The model is posed the way the renderer poses it, minus the world placement:
 * `componentPose` lifts a non-detailed model by half its height to un-bury it
 * (its origin is the box centre, not the floor), and a measurement taken in the
 * unlifted frame is measuring something nobody draws. That mattered as soon as
 * port anchors started raycasting: rays fired at an authored height would pass
 * over a model still sitting half underground and report no surface at all.
 */
function _instantiateForMeasurement(compType) {
  if (typeof THREE === 'undefined') return null;
  const compDef = COMPONENTS[compType] || PLACEABLES[compType];
  if (!compDef) return null;
  const defId = compDef.id || compType;
  const accent = compDef.accentColor || 0xc62828;
  let model = null;
  try {
    if (ROLE_BUILDERS[defId]) model = _instantiateRoleTemplate(defId, accent);
    else if (DETAIL_BUILDERS[defId]) model = DETAIL_BUILDERS[defId]();
    else model = _buildPartsOrFallback(compDef);
  } catch (_e) {
    return null;
  }
  if (!model) return null;
  // Same lift componentPose applies, and only the lift: rotation is the
  // placement's business and measurement works in the unrotated local frame.
  const lift = componentPose(compDef, { col: 0, row: 0 },
    isDetailedComponent(defId, compDef)).y;
  if (lift) model.position.y += lift;
  return model;
}

/**
 * Drop a throwaway model's GPU resources rather than waiting for the next GC of
 * something nothing will draw. Shared role-template geometry is left alone —
 * every placed instance of the type is still drawing it.
 */
function _disposeMeasurementModel(model) {
  model.traverse?.((o) => {
    if (o.geometry && !o.userData?.sharedGeometry && typeof o.geometry.dispose === 'function') {
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) if (!m.userData?.__shared && typeof m.dispose === 'function') m.dispose();
  });
}

/**
 * The world-space extent of a component type's model, in metres.
 *
 * Utility port anchors need to know how tall a device actually is: a port dot
 * and its cable have to sit on the shell, and a rack, a floor-standing pump and
 * an on-pipe cavity have wildly different shells. Nothing in the component data
 * records height — only the footprint — so the model is the only source, and
 * measuring it is exactly what the thumbnail path below already does.
 *
 * Instantiate → measure → dispose, cached by type. Returns null when THREE is
 * absent (headless tests) or the type has no model, and callers must have a
 * fallback for that.
 *
 * The full box is reported (both ends of every axis): a port anchor needs to
 * know where the lateral surface is and how far the model runs along its own
 * length, not just how tall it is.
 */
export function getModelBounds(compType) {
  if (_boundsCache.has(compType)) return _boundsCache.get(compType);
  let out = null;
  const model = _instantiateForMeasurement(compType);
  if (model) {
    model.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(model);
    if (Number.isFinite(box.max.y)) {
      out = {
        minX: box.min.x, maxX: box.max.x,
        minY: box.min.y, maxY: box.max.y,
        minZ: box.min.z, maxZ: box.max.z,
      };
    }
    // Never added to a scene; drop what it owns rather than waiting for the
    // next GC of a model nothing will draw.
    _disposeMeasurementModel(model);
  }
  _boundsCache.set(compType, out);
  return out;
}

// `${compType}|${request hash}` → Map<key, direct-distance|recovered-mount|null>.
// A type is instantiated at most once per distinct request list, which in
// practice means once: the anchor layer asks for all of a type's ports in a
// single call and caches the answer itself.
const _shellMeasureCache = new Map();

// Rays start this far outside the model's bounding box, so a surface sitting
// exactly on the box face is still in front of the origin.
const _RAY_MARGIN = 1.0;

// A missed ray usually means the authored longitudinal fraction landed in a
// gap between pieces of the chassis (or the authored height is just above a
// squat machine). Falling back to the full model bounds leaves a fitting in
// empty air. These samples find the closest point whose inward ray actually
// intersects rendered geometry. Fractions include near-edge points because a
// port just beyond a cabinet end should snap to that end, not its midpoint.
const _SHELL_SAMPLE_FRACTIONS = [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98];

function _surfaceAxisSamples(target, lo, hi) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
  if (hi - lo < 1e-6) return [lo];
  const values = [Math.min(hi, Math.max(lo, target))];
  for (const f of _SHELL_SAMPLE_FRACTIONS) values.push(lo + (hi - lo) * f);
  return [...new Set(values.map(v => Math.round(v * 1e6) / 1e6))];
}

function _castShellRay(raycaster, model, box, req, y, along, span) {
  const sign = req.sign < 0 ? -1 : 1;
  const perp = req.axis === 'x' ? 'z' : 'x';
  const face = sign > 0 ? box.max[req.axis] : box.min[req.axis];
  const origin = new THREE.Vector3(0, y, 0);
  origin[req.axis] = face + sign * _RAY_MARGIN;
  origin[perp] = along;
  const direction = new THREE.Vector3();
  direction[req.axis] = -sign;
  raycaster.set(origin, direction);
  raycaster.far = span;
  const hits = raycaster.intersectObject(model, true);
  if (hits.length === 0) return null;
  return { lat: Math.abs(hits[0].point[req.axis]), y, along };
}

/**
 * Recover a missed shell request on the nearest real piece of model geometry.
 *
 * First keep the requested height and move only along the machine. That is the
 * important source/chassis case: an extraction pipe extends the model bounds
 * past the cabinet, but a power or cooling gland still belongs on the cabinet
 * at its authored service height. Only when no nearby surface exists at that
 * height do we search both dimensions (needed for a port authored just above a
 * short pump or manifold).
 */
function _nearestShellMount(raycaster, model, box, req, span) {
  const perp = req.axis === 'x' ? 'z' : 'x';
  const meshBoxes = [];
  model.traverse?.((obj) => {
    if (!obj?.isMesh || obj.visible === false) return;
    const meshBox = new THREE.Box3().setFromObject(obj);
    if (Number.isFinite(meshBox.max.y)) meshBoxes.push(meshBox);
  });

  let best = null;
  let bestCost = Infinity;
  let bestBody = null;
  let bestBodyCost = Infinity;
  const sideExtent = Math.abs(req.sign < 0 ? box.min[req.axis] : box.max[req.axis]);
  // During recovery, a beam pipe or support leg can be closer in projection
  // than the chassis but is a poor service mount. Prefer a substantial shell
  // on the requested side when one exists; retain the narrow hit as a fallback
  // for genuinely slender devices such as gauges.
  const bodyLat = Math.max(0.06, sideExtent * 0.25);
  const tested = new Set();
  const tryPoint = (y, along, cost) => {
    const key = `${Math.round(y * 1e6)}:${Math.round(along * 1e6)}`;
    if (tested.has(key)) return;
    tested.add(key);
    const hit = _castShellRay(raycaster, model, box, req, y, along, span);
    if (hit && cost < bestCost) {
      best = hit;
      bestCost = cost;
    }
    if (hit && hit.lat >= bodyLat && cost < bestBodyCost) {
      bestBody = hit;
      bestBodyCost = cost;
    }
  };

  // Preserve the service height when a nearby part of the chassis exists.
  for (const meshBox of meshBoxes) {
    if (req.y < meshBox.min.y - 1e-6 || req.y > meshBox.max.y + 1e-6) continue;
    for (const along of _surfaceAxisSamples(req.along, meshBox.min[perp], meshBox.max[perp])) {
      const delta = along - req.along;
      tryPoint(req.y, along, delta * delta);
    }
  }
  const perpSpan = box.max[perp] - box.min[perp];
  const sameHeightLimit = Math.max(0.35, Math.min(1.0, perpSpan * 0.25));
  const sameHeight = bestBody || best;
  const sameHeightCost = bestBody ? bestBodyCost : bestCost;
  if (sameHeight && Math.sqrt(sameHeightCost) <= sameHeightLimit) return sameHeight;

  // No nearby surface at the requested height: find the closest projected
  // point on any mesh, sampling each mesh's own bounds so open space in a
  // compound machine cannot win merely because it lies inside the overall box.
  best = null;
  bestCost = Infinity;
  bestBody = null;
  bestBodyCost = Infinity;
  tested.clear();
  for (const meshBox of meshBoxes) {
    const ys = _surfaceAxisSamples(req.y, meshBox.min.y, meshBox.max.y);
    const alongs = _surfaceAxisSamples(req.along, meshBox.min[perp], meshBox.max[perp]);
    for (const y of ys) {
      for (const along of alongs) {
        const dy = y - req.y;
        const da = along - req.along;
        tryPoint(y, along, dy * dy + da * da);
      }
    }
  }
  return bestBody || best;
}

/**
 * Where a component type's shell actually is, measured by raycast.
 *
 * A bounding box cannot answer this: a magnet with a wide floor skirt and a
 * narrow yoke has one box, but a port at yoke height belongs on the yoke, not
 * out past the skirt at the box's edge. So each request names a height and a
 * point along the machine, and gets back the distance from the model's local
 * origin to the first surface a ray hits coming inward from outside.
 *
 * Requests are batched because the cost here is instantiating the model, not
 * casting the rays — one call measures every port on a type at once.
 *
 * @param {string} compType
 * @param {Array<{key: string, axis: 'x'|'z', sign: 1|-1, y: number, along: number}>} requests
 *   `along` is the offset on the axis perpendicular to `axis`, in local metres.
 * @returns {Map<string, number|{lat:number,y:number,along:number}|null>}
 *   A direct hit is its lateral distance in metres. A recovered miss is the
 *   nearest complete mount on real geometry. Null is reserved for a model with
 *   no raycastable surface at all; the map is empty when THREE is absent or the
 *   type has no model.
 */
export function measureShellSurfaces(compType, requests) {
  const list = Array.isArray(requests) ? requests : [];
  const cacheKey = `${compType}|${list.map(
    (r) => `${r.key}:${r.axis}${r.sign}:${r.y}:${r.along}`,
  ).join(';')}`;
  const cached = _shellMeasureCache.get(cacheKey);
  if (cached) return cached;

  const out = new Map();
  if (list.length > 0 && typeof THREE !== 'undefined') {
    const model = _instantiateForMeasurement(compType);
    if (model) {
      model.updateMatrixWorld?.(true);
      const box = new THREE.Box3().setFromObject(model);
      if (Number.isFinite(box.max.y)) {
        const raycaster = new THREE.Raycaster();
        const span = box.max.distanceTo(box.min) + _RAY_MARGIN * 2;
        for (const req of list) {
          if (!req || (req.axis !== 'x' && req.axis !== 'z')) continue;
          if (!Number.isFinite(req.y) || !Number.isFinite(req.along)) {
            out.set(req && req.key, null);
            continue;
          }
          const direct = _castShellRay(
            raycaster, model, box, req, req.y, req.along, span,
          );
          // Preserve the compact numeric answer for a direct hit. A recovered
          // miss carries its adjusted height/longitudinal position as well.
          out.set(req.key, direct
            ? direct.lat
            : _nearestShellMount(raycaster, model, box, req, span));
        }
      }
      _disposeMeasurementModel(model);
    }
  }

  _shellMeasureCache.set(cacheKey, out);
  return out;
}

export function renderComponentThumbnail(compType, size = 64) {
  if (_staticThumbMap[compType]) return _staticThumbMap[compType];
  if (typeof THREE === 'undefined') return null;
  if (_thumbCache.has(compType)) return _thumbCache.get(compType);

  const compDef = COMPONENTS[compType] || PLACEABLES[compType];
  if (!compDef) return null;

  const defId = compDef.id || compType;
  const hasRole = !!ROLE_BUILDERS[defId];
  const legacyBuilder = DETAIL_BUILDERS[defId];
  const hasParts = Array.isArray(compDef.parts) && compDef.parts.length > 0;
  const hasFootprint = !!(compDef.subW || compDef.gridW);
  if (!hasRole && !legacyBuilder && !hasParts && !hasFootprint) return null;

  const thumb = _getThumbRenderer(size);
  if (!thumb) return null;
  const { renderer, scene, camera } = thumb;

  const defaultAccent = (compDef && compDef.accentColor) || 0xc62828;
  let model;
  if (hasRole) {
    model = _instantiateRoleTemplate(defId, defaultAccent);
  } else if (legacyBuilder) {
    model = legacyBuilder();
  } else {
    model = _buildPartsOrFallback(compDef);
  }
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const bSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bSize.x, bSize.y, bSize.z);
  const projW = (bSize.x + bSize.z) / Math.SQRT2;
  const projH = (bSize.x + 2 * bSize.y + bSize.z) / Math.sqrt(6);
  const halfFrame = Math.max(projW, projH) * 0.55;

  camera.left = -halfFrame;
  camera.right = halfFrame;
  camera.top = halfFrame;
  camera.bottom = -halfFrame;
  camera.updateProjectionMatrix();

  const isoDist = maxDim * 4;
  camera.position.set(
    center.x + isoDist,
    center.y + isoDist,
    center.z + isoDist,
  );
  camera.lookAt(center);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  _thumbCache.set(compType, dataUrl);

  scene.remove(model);

  return dataUrl;
}

// ── ComponentBuilder class ───────────────────────────────────────────

export class ComponentBuilder {
  constructor() {
    // Map from component id -> THREE.Group or THREE.Mesh
    this._meshMap = new Map();
  }

  /** Public lookup for picking/selection coordinators. */
  getGroup(id) { return this._meshMap.get(id) || null; }

  /** Hide ornamental geometry and shadow submissions outside detail zoom. */
  setDetailLevel(showDetail) {
    const visible = !!showDetail;
    for (const obj of this._meshMap.values()) {
      obj.traverse(child => {
        if (!child.isMesh) return;
        if (child.userData.lod === 'detail') child.visible = visible;
        if (child.userData.nearCastShadow == null) {
          child.userData.nearCastShadow = child.castShadow === true;
        }
        child.castShadow = visible && child.userData.nearCastShadow;
      });
    }
  }

  /**
   * Create a fallback mesh for components without a role or detail
   * builder. Delegates to the shared standalone builder so live meshes,
   * ghost previews, and build-menu thumbnails all render identically.
   */
  _createFallbackMesh(compDef) {
    return _buildPartsOrFallback(compDef);
  }

  /**
   * Create a minimal placeholder box for a pipe placement whose type has
   * no COMPONENTS entry (unknown/future-only types). Sized to the
   * placement's `subL` along the pipe axis, with width/height chosen so
   * the box is visible around the pipe (~2× typical pipe radius).
   *
   * Wrapped in a Group for parity with _createObject's wrapper so dispose
   * and dim code paths work uniformly.
   */
  _createPlaceholderBox(subL, spriteColor = 0xffffff) {
    const w = 2 * SUB_UNIT;              // ~1 world unit across
    const h = 2 * SUB_UNIT;              // ~1 world unit tall
    const l = Math.max(subL || 2, 1) * SUB_UNIT;
    const geo = new THREE.BoxGeometry(w, h, l);
    applyTiledBoxUVs(geo, w, h, l);
    const mat = new THREE.MeshStandardMaterial({
      color: spriteColor,
      roughness: 0.7,
      metalness: 0.15,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Centered vertically so the box sits around the beampipe axis.
    mesh.position.y = BEAM_HEIGHT;
    const wrapper = new THREE.Group();
    wrapper.add(mesh);
    return wrapper;
  }

  /**
   * Create the 3D object (Group or Mesh) for a given component type.
   * Wraps in a group with an invisible hitbox for easier click detection.
   *
   * Prefers the role-based template path if a builder is registered; falls
   * back to the legacy DETAIL_BUILDERS (source/drift/pillbox); finally
   * falls back to a generic fallback mesh.
   */
  _createObject(compDef, accentColorHex = 0xc62828) {
    const compType = compDef.id;
    let visual = null;

    if (ROLE_BUILDERS[compType]) {
      visual = _instantiateRoleTemplate(compType, accentColorHex);
    }

    if (!visual) {
      const legacyBuilder = DETAIL_BUILDERS[compType];
      if (legacyBuilder) {
        visual = legacyBuilder();
      } else {
        visual = this._createFallbackMesh(compDef);
      }
    }

    // Wrap with invisible hitbox for easier raycasting
    const wrapper = new THREE.Group();
    wrapper.add(visual);

    // PORT STUBS disabled — will revisit with connected routing
    // const portStubs = buildPortStubs(
    //   compDef.id,
    //   ((compDef.subW || compDef.gridW || 2) * SUB_UNIT) / 2,
    //   (compDef.subL || compDef.gridH || 2) * SUB_UNIT,
    // );
    // if (portStubs) wrapper.add(portStubs);

    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = Math.max((compDef.subH || 2) * SUB_UNIT, 1.0);
    const l = (compDef.subL || 2) * SUB_UNIT;
    const hitW = Math.max(w, 0.8), hitL = Math.max(l, 0.8);
    const hitGeo = new THREE.BoxGeometry(hitW, h, hitL);
    applyTiledBoxUVs(hitGeo, hitW, h, hitL);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.y = BEAM_HEIGHT;
    wrapper.add(hitbox);

    return wrapper;
  }

  /** Public component factory for renderer coordinators that batch visuals. */
  createObject(compDef, accentColorHex = 0xc62828) {
    return this._createObject(compDef, accentColorHex);
  }

  /**
   * Set opacity on an object (works for both Mesh and Group).
   *
   * Role-tagged meshes share their material across every placement, so
   * we can't mutate the shared material directly — we'd dim everything.
   * For those we clone once per mesh on first dim and cache the clone on
   * userData, swapping between shared and clone as the dim state toggles.
   */
  _setDimmed(obj, dimmed) {
    const opacity = dimmed ? 0.3 : 1.0;
    obj.traverse((child) => {
      if (!child.isMesh) return;
      const role = child.userData.role;
      if (role) {
        // Shared material — clone-on-dim so we never mutate the shared one.
        if (dimmed) {
          if (!child.userData._dimMat) {
            const clone = child.material.clone();
            clone.transparent = true;
            clone.opacity = opacity;
            child.userData._dimMat = clone;
            child.userData._baseMat = child.material;
          }
          child.material = child.userData._dimMat;
        } else if (child.userData._baseMat) {
          child.material = child.userData._baseMat;
        }
      } else {
        // Legacy / fallback meshes own their own material.
        child.material.opacity = opacity;
        child.material.transparent = dimmed;
      }
    });
  }

  /**
   * Build or update meshes for all components in the snapshot.
   * Removes stale meshes for components no longer present.
   */
  build(componentData, parentGroup, { categoryGroups = null } = {}) {
    if (!componentData || !parentGroup) return;

    const seen = new Set();

    for (const comp of componentData) {
      const { id, type, dimmed } = comp;
      seen.add(id);

      const rawDef = COMPONENTS[type];
      const compDef = rawDef || {};
      // Pipe placements carry subCol === null as a marker (set by
      // world-snapshot.buildPipeAttachments). When true, prefer the
      // placement's own subL over the type's default so varying-length
      // placements render correctly via the placeholder fallback.
      const isPipePlacement = comp.subCol == null && comp.subRow == null;
      const placementSubL = (isPipePlacement && typeof comp.subL === 'number') ? comp.subL : null;
      // Fallback: unknown type on a pipe placement — render a placeholder
      // box sized to the placement's subL. Follow-up task can polish this
      // with a proper mesh for whatever types don't yet have one.
      const usePlaceholder = isPipePlacement && !rawDef;
      // Both legacy DETAIL_BUILDERS and new ROLE_BUILDERS bake BEAM_HEIGHT
      // into their geometry, so their wrappers should sit at y=0.
      // Parts-list items also place themselves with y=0 on the floor.
      // Placeholder boxes bake BEAM_HEIGHT in too.
      const isDetailed = usePlaceholder || isDetailedComponent(type, compDef);

      // Create object if not already in map
      if (!this._meshMap.has(id)) {
        const accent = comp.accentColor ?? 0xc62828;
        const obj = usePlaceholder
          ? this._createPlaceholderBox(placementSubL ?? 2, compDef.spriteColor ?? 0xffffff)
          : this._createObject(compDef, accent);
        obj.matrixAutoUpdate = false;
        // Stamp the id on the wrapper so hit identification reads it straight
        // off the raycast parent chain instead of scanning _meshMap.
        obj.userData.nodeId = id;
        obj.userData.beamlineId = comp.beamlineId || null;
        obj.userData.compType = type;
        obj.userData.pipeId = comp.pipeId || null;
        obj.userData.utilityLineId = comp.utilityLineId || null;
        obj.userData.isPlaceholder = !!usePlaceholder;
        this._meshMap.set(id, obj);
      }

      const obj = this._meshMap.get(id);
      const targetGroup = categoryGroups?.[comp.category] || parentGroup;
      if (obj.parent !== targetGroup) targetGroup.add(obj);
      obj.userData.presentationCategory = comp.category || null;
      obj.userData.effectState = comp.effectState || 'on';

      // Position + rotation. Shared with the design-placement ghost via
      // componentPose so a preview can never claim a spot the commit will not
      // use.
      const pose = componentPose(compDef, comp, isDetailed);
      obj.position.set(pose.x, pose.y, pose.z);
      obj.rotation.y = pose.rotY;
      syncMapEdgeServiceLeadVisual(obj, comp.mapEdgeConnection, pose);

      // Dimming
      this._setDimmed(obj, dimmed);

      obj.updateMatrix();
    }

    // Remove stale objects. Role-tagged meshes share merged template
    // geometry and shared materials with every other placement of the
    // same type, so we must NOT dispose them — only dispose the per-dim
    // material clone (if any) and the hitbox, plus legacy/fallback meshes
    // which own their geometry & material outright.
    for (const [id, obj] of this._meshMap) {
      if (!seen.has(id)) {
        if (obj.parent) obj.parent.remove(obj);
        this._disposeWrapper(obj);
        this._meshMap.delete(id);
      }
    }
  }

  /**
   * Dispose a wrapper without touching shared template resources.
   * Only disposes:
   *   - per-wrapper dim material clones (`child.userData._dimMat`)
   *   - the hitbox geometry and material (owned per wrapper)
   *   - legacy / fallback meshes that have no role tag (they own their own)
   */
  _disposeWrapper(obj) {
    obj.traverse((child) => {
      if (!child.isMesh) return;
      if (child.userData._dimMat) {
        child.userData._dimMat.dispose();
        child.userData._dimMat = null;
      }
      if (child.userData.role) {
        // Shared — do not dispose geometry or base material.
        return;
      }
      // Legacy/fallback mesh or hitbox — owned geometry/material, safe.
      if (child.geometry) child.geometry.dispose();
      // A mesh with per-face materials carries an ARRAY here, and Array has
      // no .dispose — the untagged multi-material builders threw on every
      // teardown. Materials only; `map` textures are shared via
      // TextureManager and are not this wrapper's to free.
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat && typeof mat.dispose === 'function') mat.dispose();
      }
    });
  }

  /** Public teardown paired with createObject(). */
  disposeObject(obj) {
    this._disposeWrapper(obj);
  }

  /**
   * Dispose all objects and clear the map.
   */
  dispose(parentGroup) {
    for (const [, obj] of this._meshMap) {
      if (obj.parent) obj.parent.remove(obj);
      else if (parentGroup) parentGroup.remove(obj);
      this._disposeWrapper(obj);
    }
    this._meshMap.clear();
  }
}
