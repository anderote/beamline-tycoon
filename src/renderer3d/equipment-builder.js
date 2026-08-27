// src/renderer3d/equipment-builder.js
// Renders equipment and zone furnishings from authored box/cylinder/sphere/
// torus/cone parts. Fallback boxes use a 6-entry material array (one per
// face) so a face can independently use a tiled MATERIAL or a DECAL.
// THREE is a CDN global — do NOT import it.

import { MeshBasicNodeMaterial } from 'three/webgpu';
import { reflector } from 'three/tsl';
import { PLACEABLES } from '../data/placeables/index.js';
import { MATERIALS } from './materials/index.js';
import { DECALS } from './materials/decals.js';
import { applyTiledBoxUVs } from './uv-utils.js';
import { buildPlaceableVisualDetails } from './placeable-visual-details.js';
import { configureGlowMesh, getGlowMaterial } from './machine-glow.js';
import { contentKey } from './content-hash.js';
import { fixtureMountY, wallFixturePose } from './fixture-light-math.js';
// Phase 6: utility-port-builder removed; all buildPortStubs call sites in
// this file were already commented out.

// BoxGeometry face order is [+X, -X, +Y, -Y, +Z, -Z]; each face has 4 UVs,
// 8 floats per face in the uv attribute array.
const FACE_INDEX = { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 };

const SUB_UNIT = 0.5;
const PRIMITIVE_SEGMENTS = 16;
const FAR_PRIMITIVE_SEGMENTS = 8;

const FAR_EQUIPMENT_COLORS = Object.freeze({
  frame: 0x303841,
  dark: 0x20272e,
  metal: 0x8b98a2,
  surface: 0xb8aa91,
  screen: 0x42b7c8,
  sanitary: 0xdce5e7,
  plant: 0x47734a,
});

// Cache per (compType + faceKey + base + override) -> material so identical
// face configs share. Module-level cache lives across rebuilds and instances.
const _equipMatCache = new Map();

// Cache for simple single-material parts (no per-face overrides) keyed on
// `baseName|colorHex` so every leg/top/shelf sharing the same spec reuses
// a single MeshStandardMaterial.
const _partMatCache = new Map();

function createReflectiveMirrorMaterial() {
  // A true planar reflection is renderer-managed by ReflectorNode on both the
  // native WebGPU and node-renderer WebGL2 paths. Keep the target deliberately
  // low-resolution: bathroom mirrors are a visual accent, not another full
  // resolution world render for every fixture.
  const reflectionNode = reflector({
    resolutionScale: 0.25,
    bounces: false,
    samples: 0,
  });
  const material = new MeshBasicNodeMaterial();
  material.colorNode = reflectionNode;
  material.toneMapped = true;
  material.userData.reflectiveMirror = true;
  return { material, reflectionNode };
}

function _partMaterial(baseName, colorHex) {
  const key = `${baseName || '-'}|${colorHex ?? 'x'}`;
  let m = _partMatCache.get(key);
  if (m) return m;
  let map = null;
  let color = colorHex ?? 0x888888;
  if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    if (colorHex == null) color = 0xffffff;
  }
  const roughness = map ? 0.7 : 0.45;
  m = new THREE.MeshStandardMaterial({
    map, color, roughness, metalness: 0.15,
  });
  _partMatCache.set(key, m);
  return m;
}

// ── Static-part merging ──────────────────────────────────────────────
// A placeable authored from `parts` used to render one Mesh per part: a
// cafeteria chair cost 10 draw calls, a workstation 16. Nothing about those
// boxes is dynamic — they never move relative to their wrapper — so they are
// baked into ONE merged BufferGeometry per resolved surface (same idea as
// floor-builder, which merges 1,793 floor tiles into 22 meshes).
//
// Grouping key is the surface, not the colour: parts that differ only by a
// flat colour are merged into a single geometry whose per-vertex `color`
// attribute carries what used to be `material.color`. MeshStandardMaterial
// multiplies material.color (white here) by the vertex colour, so the shaded
// result is bit-identical to the per-part material. Vertex colours are read
// in the working colour space, and THREE.Color/`material.color` already live
// there, so we copy .r/.g/.b straight across (same trick as floor-builder's
// per-tile tint).
//
// What is NOT merged: glow parts. They carry userData.role === 'glow', which
// light-rig.js traverses for to attach real PointLights, VisualEffectSystem
// clones their material per mesh to animate them independently, and the
// bloom pass selects them by layer. They stay one mesh per part.

/** Cache of merged-surface materials, keyed by map + roughness + metalness. */
const _mergedPartMatCache = new Map();

function _mergedSurfaceKey(mat) {
  return `${mat.map ? mat.map.uuid : '-'}|${mat.roughness}|${mat.metalness}`;
}

/**
 * Vertex-colour twin of a resolved per-part material: same map and shading
 * constants, but the flat colour moves onto the geometry.
 */
function _mergedPartMaterial(sourceMat) {
  const key = _mergedSurfaceKey(sourceMat);
  let m = _mergedPartMatCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: sourceMat.map,
    color: 0xffffff,
    roughness: sourceMat.roughness,
    metalness: sourceMat.metalness,
    vertexColors: true,
  });
  _mergedPartMatCache.set(key, m);
  return m;
}

/**
 * Concatenate already-transformed part geometries into one indexed
 * BufferGeometry, stamping each part's flat colour into a `color` attribute.
 *
 * @param {Array<{ geometry: THREE.BufferGeometry, color: THREE.Color }>} entries
 * @returns {THREE.BufferGeometry}
 */
function _mergePartGeometries(entries) {
  let vertexTotal = 0;
  let indexTotal = 0;
  let haveNormals = true;
  let haveUVs = true;
  for (const { geometry } of entries) {
    const position = geometry.attributes.position;
    vertexTotal += position.count;
    indexTotal += geometry.index ? geometry.index.count : position.count;
    if (!geometry.attributes.normal) haveNormals = false;
    if (!geometry.attributes.uv) haveUVs = false;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const normals = haveNormals ? new Float32Array(vertexTotal * 3) : null;
  const uvs = haveUVs ? new Float32Array(vertexTotal * 2) : null;
  const colors = new Float32Array(vertexTotal * 3);
  const indices = vertexTotal > 65535
    ? new Uint32Array(indexTotal)
    : new Uint16Array(indexTotal);

  let vertexOffset = 0;
  let indexOffset = 0;
  // Index window of each source part. The physics mass integrator reads these
  // back (geometry-mass-properties.js) so a merged prop still measures as the
  // set of closed shells it was authored as, not as one non-manifold soup.
  const ranges = [];
  for (const { geometry, color } of entries) {
    const position = geometry.attributes.position;
    const count = position.count;
    positions.set(position.array.subarray(0, count * 3), vertexOffset * 3);
    if (normals) {
      normals.set(geometry.attributes.normal.array.subarray(0, count * 3), vertexOffset * 3);
    }
    if (uvs) {
      uvs.set(geometry.attributes.uv.array.subarray(0, count * 2), vertexOffset * 2);
    }
    const r = color.r, g = color.g, b = color.b;
    for (let k = 0; k < count; k++) {
      const o = (vertexOffset + k) * 3;
      colors[o] = r; colors[o + 1] = g; colors[o + 2] = b;
    }
    const rangeStart = indexOffset;
    if (geometry.index) {
      const src = geometry.index.array;
      for (let k = 0; k < src.length; k++) indices[indexOffset + k] = src[k] + vertexOffset;
      indexOffset += src.length;
    } else {
      for (let k = 0; k < count; k++) indices[indexOffset + k] = vertexOffset + k;
      indexOffset += count;
    }
    ranges.push({ start: rangeStart, count: indexOffset - rangeStart });
    vertexOffset += count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs) merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.userData.shellRanges = ranges;
  if (!normals) merged.computeVertexNormals();
  return merged;
}

function _equipmentPlacement(item, compDef, isFurnishing) {
  const dir = item.dir || 0;
  const swapFoot = dir === 1 || dir === 3;
  const defW = compDef?.subW || (isFurnishing ? 1 : 2);
  const defL = compDef?.subL || compDef?.subH || (isFurnishing ? 1 : 2);
  const footW = (swapFoot ? defL : defW) * SUB_UNIT;
  const footL = (swapFoot ? defW : defL) * SUB_UNIT;
  const tileX = (item.col ?? 0) * 2;
  const tileZ = (item.row ?? 0) * 2;
  const subX = (item.subCol || 0) * SUB_UNIT;
  const subZ = (item.subRow || 0) * SUB_UNIT;
  const wallPose = compDef?.mount === 'wall' ? wallFixturePose(item.wallMount) : null;
  const floorY = (item.placeY || 0) * SUB_UNIT;
  return {
    centerX: wallPose?.x ?? (tileX + subX + footW / 2),
    centerZ: wallPose?.z ?? (tileZ + subZ + footL / 2),
    baseY: compDef?.mount === 'wall' ? fixtureMountY(compDef, floorY) : floorY,
    rotY: wallPose?.yaw ?? (-dir * (Math.PI / 2)),
  };
}

function _equipmentVisualDimensions(compDef, isFurnishing) {
  const vSubW = compDef?.visualSubW ?? compDef?.subW ?? (isFurnishing ? 1 : 2);
  const vSubH = compDef?.visualSubH ?? compDef?.subH ?? (isFurnishing ? 1 : 2);
  const vSubL = compDef?.visualSubL ?? compDef?.subL ?? compDef?.subH
    ?? (isFurnishing ? 1 : 2);
  return { width: vSubW * SUB_UNIT, height: vSubH * SUB_UNIT, depth: vSubL * SUB_UNIT };
}

function _farEquipmentPart(entries, roles, role, shape, dimensions, position) {
  const part = shape === 'cylinder'
    ? { shape, axis: dimensions.axis || 'y' }
    : { shape: 'box' };
  const geometry = createEquipmentPartGeometry(
    part, dimensions.width, dimensions.height, dimensions.depth,
  );
  geometry.translate(position.x, position.y, position.z);
  const color = new THREE.Color(dimensions.color);
  entries.push({ geometry, color });
  roles.push(role);
}

function _farEquipmentGeometry(compDef, isFurnishing) {
  const id = compDef.id || '';
  const { width, height, depth } = _equipmentVisualDimensions(compDef, isFurnishing);
  const entries = [];
  const roles = [];
  const bodyColor = compDef.spriteColor || compDef.color || 0x78848c;
  const box = (role, w, h, d, x, y, z, color = bodyColor) =>
    _farEquipmentPart(entries, roles, role, 'box',
      { width: w, height: h, depth: d, color }, { x, y, z });
  const cylinder = (role, w, h, d, x, y, z, color = bodyColor, axis = 'y') =>
    _farEquipmentPart(entries, roles, role, 'cylinder',
      { width: w, height: h, depth: d, color, axis }, { x, y, z });

  let kind = 'facility-machine';
  if (/plant/i.test(id)) {
    kind = 'indoor-plant';
    box('pot', width * 0.48, height * 0.28, depth * 0.48,
      0, height * 0.14, 0, 0x765740);
    cylinder('stem', width * 0.10, height * 0.52, depth * 0.10,
      0, height * 0.50, 0, 0x43643b);
    box('canopy', width * 0.76, height * 0.34, depth * 0.76,
      0, height * 0.80, 0, FAR_EQUIPMENT_COLORS.plant);
  } else if (/chair|stool|armchair|sofa|couch|bench$/i.test(id)) {
    kind = /stool/i.test(id) ? 'stool' : (/sofa|couch|bench$/i.test(id) ? 'seating' : 'chair');
    const seatY = Math.max(0.28, height * 0.42);
    box('seat', width * 0.78, Math.max(0.10, height * 0.12), depth * 0.72,
      0, seatY, 0, bodyColor);
    if (!/stool/i.test(id)) {
      box('back', width * 0.76, Math.max(0.28, height * 0.46), depth * 0.12,
        0, Math.min(height * 0.76, seatY + height * 0.28), depth * 0.31,
        FAR_EQUIPMENT_COLORS.dark);
    }
    for (const x of [-width * 0.28, width * 0.28]) {
      box('leg', 0.07, seatY, 0.07, x, seatY * 0.5, 0,
        FAR_EQUIPMENT_COLORS.frame);
    }
  } else if (/table|desk|bench|counter|workstand|workbench|console|station|bar$/i.test(id)) {
    kind = /console/i.test(id) ? 'console' : 'work-surface';
    const topY = Math.max(0.40, height * 0.68);
    box('surface', width * 0.90, Math.max(0.10, height * 0.10), depth * 0.86,
      0, topY, 0, FAR_EQUIPMENT_COLORS.surface);
    for (const x of [-width * 0.34, width * 0.34]) {
      box('frame', Math.max(0.08, width * 0.10), topY, depth * 0.66,
        x, topY * 0.5, 0, FAR_EQUIPMENT_COLORS.frame);
    }
    if (/console|computer|monitor/i.test(id)) {
      box('screen', width * 0.50, height * 0.24, depth * 0.10,
        0, Math.min(height * 0.88, topY + height * 0.16), depth * 0.31,
        FAR_EQUIPMENT_COLORS.screen);
    }
  } else if (/rack|shelf|bookcase|locker|cabinet|refrigerator|vending|appliance|chamber|cage|stall|credenza|sideboard/i.test(id)) {
    kind = /rack|shelf|bookcase/i.test(id) ? 'storage-rack' : 'facility-cabinet';
    box('body', width * 0.82, height * 0.92, depth * 0.78,
      0, height * 0.46, 0, FAR_EQUIPMENT_COLORS.dark);
    box('front', width * 0.64, height * 0.68, Math.max(0.04, depth * 0.06),
      0, height * 0.50, depth * 0.41, bodyColor);
    box('accent', width * 0.48, Math.max(0.04, height * 0.045), depth * 0.07,
      0, height * 0.72, depth * 0.45, FAR_EQUIPMENT_COLORS.screen);
  } else if (/pump/i.test(id) && /cart|trolley/i.test(id)) {
    kind = 'mobile-pump-cart';
    box('deck', width * 0.90, Math.max(0.08, height * 0.08), depth * 0.84,
      0, height * 0.16, 0, FAR_EQUIPMENT_COLORS.frame);
    cylinder('pump', width * 0.42, height * 0.55, depth * 0.42,
      -width * 0.12, height * 0.48, 0, bodyColor);
    cylinder('flange', width * 0.52, Math.max(0.07, height * 0.07), depth * 0.52,
      -width * 0.12, height * 0.72, 0, FAR_EQUIPMENT_COLORS.metal);
    box('controller', width * 0.30, height * 0.42, depth * 0.30,
      width * 0.27, height * 0.48, -depth * 0.16, FAR_EQUIPMENT_COLORS.dark);
    box('screen', width * 0.20, height * 0.12, Math.max(0.035, depth * 0.04),
      width * 0.27, height * 0.55, depth * 0.01, FAR_EQUIPMENT_COLORS.screen);
    for (const x of [-width * 0.32, width * 0.32]) {
      cylinder('wheel', 0.15, 0.08, 0.15, x, 0.10, 0,
        FAR_EQUIPMENT_COLORS.dark, 'z');
    }
    box('handle', 0.07, height * 0.62, 0.07,
      width * 0.40, height * 0.47, -depth * 0.34, FAR_EQUIPMENT_COLORS.metal);
  } else if (/cart|trolley/i.test(id)) {
    kind = 'mobile-cart';
    box('body', width * 0.84, height * 0.48, depth * 0.78,
      0, height * 0.48, 0, bodyColor);
    for (const x of [-width * 0.30, width * 0.30]) {
      cylinder('wheel', 0.15, 0.08, 0.15, x, 0.10, 0,
        FAR_EQUIPMENT_COLORS.dark, 'z');
    }
  } else if (/toilet|urinal|sink|dryer/i.test(id)) {
    kind = 'sanitary-fixture';
    box('base', width * 0.62, height * 0.52, depth * 0.72,
      0, height * 0.26, 0, FAR_EQUIPMENT_COLORS.sanitary);
    box('back', width * 0.72, height * 0.38, depth * 0.28,
      0, height * 0.68, depth * 0.20, FAR_EQUIPMENT_COLORS.metal);
  } else if (/coil|generator|antenna|cylinder|crane|hoist|lathe|mill|press|welder|pump|exchanger|chiller/i.test(id)) {
    kind = 'shop-machine';
    box('stand', width * 0.76, Math.max(0.12, height * 0.12), depth * 0.74,
      0, Math.max(0.06, height * 0.06), 0, FAR_EQUIPMENT_COLORS.frame);
    cylinder('body', width * 0.50, height * 0.66, depth * 0.50,
      0, height * 0.46, 0, bodyColor);
    box('accent', width * 0.58, Math.max(0.06, height * 0.07), depth * 0.58,
      0, height * 0.58, 0, FAR_EQUIPMENT_COLORS.screen);
  } else {
    box('body', width * 0.78, height * 0.78, depth * 0.76,
      0, height * 0.39, 0, bodyColor);
    box('front', width * 0.52, height * 0.26, Math.max(0.04, depth * 0.07),
      0, height * 0.47, depth * 0.40, FAR_EQUIPMENT_COLORS.dark);
    box('accent', width * 0.34, Math.max(0.04, height * 0.05), depth * 0.08,
      0, height * 0.54, depth * 0.44, FAR_EQUIPMENT_COLORS.screen);
  }

  const geometry = _mergePartGeometries(entries);
  for (const entry of entries) entry.geometry.dispose();
  geometry.userData.farSilhouetteKind = kind;
  geometry.userData.farPartRoles = [...new Set(roles)];
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function _showEquipmentAtFar(item, compDef, isFurnishing) {
  if (!compDef || compDef.isRack) return false;
  if (compDef.mount === 'wall' || compDef.mount === 'surface'
      || compDef.mount === 'overhead') return false;
  if ((item.placeY || 0) > 0.1 || compDef.stackable === true) return false;
  if (/rug|organizer|ashtray|wastebasket|paperTowelBin/i.test(compDef.id || '')) return false;
  const { width, height, depth } = _equipmentVisualDimensions(compDef, isFurnishing);
  const recognizableSmall = /chair|stool|toilet|urinal|plant/i.test(compDef.id || '');
  return recognizableSmall || width > 0.55 || height > 0.65 || depth > 0.55;
}

/** Public catalogue contract used by tests and presentation diagnostics. */
export function equipmentFarPresentation(item, isFurnishing = false) {
  return _showEquipmentAtFar(item, PLACEABLES[item?.type], isFurnishing)
    ? 'silhouette'
    : 'hidden';
}

/**
 * Build one authored equipment part inside an exact w/h/l bounding box.
 * `box` remains the backwards-compatible default; the small primitive set
 * lets catalogue-authored lab apparatus use coils, domes, tanks, and horns
 * without adding an id-specific renderer for every prop.
 */
export function createEquipmentPartGeometry(part, width, height, length) {
  const shape = part?.shape || 'box';
  if (shape === 'box') {
    const geometry = new THREE.BoxGeometry(width, height, length);
    applyTiledBoxUVs(geometry, width, height, length);
    return geometry;
  }

  let geometry;
  if (shape === 'cylinder') {
    geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, PRIMITIVE_SEGMENTS);
  } else if (shape === 'sphere') {
    geometry = new THREE.SphereGeometry(0.5, PRIMITIVE_SEGMENTS, 12);
  } else if (shape === 'torus') {
    geometry = new THREE.TorusGeometry(0.35, 0.15, 10, 24);
  } else if (shape === 'cone') {
    const topScale = Number.isFinite(part.topScale) ? part.topScale : 0;
    geometry = new THREE.CylinderGeometry(0.5 * topScale, 0.5, 1, PRIMITIVE_SEGMENTS);
  } else {
    // Validation rejects unknown shapes. Keep production rendering resilient
    // if malformed content nevertheless reaches this path.
    geometry = new THREE.BoxGeometry(1, 1, 1);
  }

  // Cylinder/cone axes describe their long axis; a torus axis describes its
  // hole normal. Sphere orientation is harmless and intentionally ignored.
  const axis = part?.axis || (shape === 'torus' ? 'z' : 'y');
  if (shape === 'torus') {
    if (axis === 'y') geometry.rotateX(Math.PI / 2);
    if (axis === 'x') geometry.rotateY(Math.PI / 2);
  } else if (shape !== 'sphere') {
    if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
  }

  // Normalize the primitive's post-axis bounding box before applying the
  // authored dimensions. This makes w/h/l mean the same exact visual bounds
  // for every shape and preserves the existing bottom-based y convention.
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  geometry.scale(
    width / Math.max(size.x, 1e-9),
    height / Math.max(size.y, 1e-9),
    length / Math.max(size.z, 1e-9),
  );
  return geometry;
}

/**
 * Convert semantically-authored part names into presentation-light intent.
 * This keeps the raw catalogue renderer-agnostic while allowing every screen,
 * trace, rack LED, and alarm window to use the lighting engine consistently.
 */
export function equipmentPartGlowSpec(compDef, part) {
  const id = compDef?.id || '';
  const name = part?.name || '';
  const color = part?.color ?? 0x40d8ff;
  if (/(?:screen|scr\d*$|lcd$|display$)/i.test(name)) {
    return {
      color, profile: 'screen', priority: 4,
      light: { intensity: 0.24, distance: 1.7, daylightFloor: 0.18 },
    };
  }
  if (/(?:trace\d*$|^tr\d+$)/i.test(name)) {
    return {
      color, profile: 'screen', priority: 3,
      light: { intensity: 0.16, distance: 1.3, daylightFloor: 0.15 },
    };
  }
  if (/(?:arcGlow|sparkGlow)/i.test(name)) {
    return {
      color, profile: 'statusBlink', priority: 5,
      light: { intensity: 0.32, distance: 2.4, daylightFloor: 0.16 },
    };
  }
  const serverLed = id === 'serverRack' && /^s\d+[acd]$/i.test(name);
  const daqLed = id === 'daqRack' && /L\d+$/i.test(name);
  const alarmWindow = id === 'alarmPanel' && /^[a-e][1-4]$/i.test(name);
  const namedIndicator = /(?:led\d*$|lamp[LMR0-9]*$|dot(?:Hot|Cold)$|beacon$)/i.test(name);
  if (serverLed || daqLed || alarmWindow || namedIndicator) {
    const beacon = /beacon$/i.test(name);
    return {
      color,
      profile: 'statusBlink',
      priority: beacon ? 3 : 2,
      light: beacon
        ? { intensity: 0.2, distance: 1.4, daylightFloor: 0.12 }
        : { intensity: 0.08, distance: 0.9, daylightFloor: 0.08 },
    };
  }
  return null;
}

function _faceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  const cacheKey = `${compType}|${faceKey}|${baseName}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _equipMatCache.get(cacheKey);
  if (m) return m;

  if (faceOverride && faceOverride.decal && DECALS[faceOverride.decal]) {
    m = DECALS[faceOverride.decal];
    _equipMatCache.set(cacheKey, m);
    return m;
  }

  if (faceOverride && faceOverride.material && MATERIALS[faceOverride.material]) {
    m = MATERIALS[faceOverride.material];
    _equipMatCache.set(cacheKey, m);
    return m;
  }

  let map = null;
  let color = fallbackColor;
  if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.7,
    metalness: 0.2,
  });
  _equipMatCache.set(cacheKey, m);
  return m;
}

// Rewrite a single face's UVs to span 0→1 (needed for decal faces so the
// full decal texture shows instead of being cropped by the tiled UV span).
function _setFaceUVsClamped(geometry, faceKey) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const face = FACE_INDEX[faceKey];
  if (face == null) return;
  const arr = uv.array;
  const off = face * 8;
  arr[off + 0] = 0; arr[off + 1] = 1;
  arr[off + 2] = 1; arr[off + 3] = 1;
  arr[off + 4] = 0; arr[off + 5] = 0;
  arr[off + 6] = 1; arr[off + 7] = 0;
  uv.needsUpdate = true;
}

export class EquipmentBuilder {
  constructor({ buildFarBatches = true } = {}) {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
    this._objectsById = new Map();
    this._signaturesById = new Map();
    this._farBatches = [];
    this._farSource = null;
    this._farSignature = null;
    this._builtFarSignature = null;
    this._showDetail = true;
    this._buildFarBatches = buildFarBatches;
  }

  /** Public lookup for picking, selection, and incident coordinators. */
  getGroup(id) {
    return this._objectsById.get(`equipment:${id}`)
      || this._objectsById.get(`furnishing:${id}`)
      || null;
  }

  resolveBatchHit(hit) {
    const object = hit?.object;
    if (!object?.userData?.batchedEquipment || !Number.isInteger(hit.instanceId)) return null;
    const nodeId = object.userData.nodeIds?.[hit.instanceId] ?? null;
    return {
      nodeId,
      rootObj: nodeId != null ? (this.getGroup(nodeId) || object) : object,
    };
  }

  _disposeFarBatches() {
    for (const mesh of this._farBatches) {
      mesh.parent?.remove(mesh);
      mesh.dispose?.();
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    this._farBatches = [];
    this._builtFarSignature = null;
  }

  _queueFarBatches(equipmentData, furnishingData, parentGroup) {
    if (!this._buildFarBatches) return;
    const signature = contentKey([equipmentData || [], furnishingData || []]);
    this._farSource = {
      equipmentData: equipmentData || [],
      furnishingData: furnishingData || [],
      parentGroup,
    };
    this._farSignature = signature;
    if (this._builtFarSignature && this._builtFarSignature !== signature) {
      this._disposeFarBatches();
    }
    if (!this._showDetail) this._rebuildFarBatches();
  }

  _rebuildFarBatches() {
    if (!this._buildFarBatches || !this._farSource) return;
    if (this._builtFarSignature === this._farSignature) {
      for (const mesh of this._farBatches) mesh.visible = !this._showDetail;
      return;
    }
    this._disposeFarBatches();
    const { equipmentData, furnishingData, parentGroup } = this._farSource;
    const buckets = new Map();
    const collect = (item, isFurnishing) => {
      const def = PLACEABLES[item.type];
      if (!_showEquipmentAtFar(item, def, isFurnishing)) return;
      const key = `${isFurnishing ? 'furnishing' : 'equipment'}|${item.type}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { def, isFurnishing, entries: [] };
        buckets.set(key, bucket);
      }
      bucket.entries.push(item);
    };
    for (const item of equipmentData) collect(item, false);
    for (const item of furnishingData) collect(item, true);

    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const { def, isFurnishing, entries } of buckets.values()) {
      const geometry = _farEquipmentGeometry(def, isFurnishing);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.66,
        metalness: 0.16,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = `equipment-far-${entries[0].type}`;
      mesh.userData.batchedEquipment = true;
      mesh.userData.nodeIds = [];
      mesh.userData.lod = 'equipment-far';
      mesh.userData.farSilhouetteKind = geometry.userData.farSilhouetteKind;
      mesh.userData.farPartRoles = geometry.userData.farPartRoles;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.visible = !this._showDetail;
      for (let index = 0; index < entries.length; index++) {
        const item = entries[index];
        const pose = _equipmentPlacement(item, def, isFurnishing);
        position.set(pose.centerX, pose.baseY, pose.centerZ);
        rotation.setFromAxisAngle(yAxis, pose.rotY);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.userData.nodeIds[index] = item.id ?? null;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      parentGroup.add(mesh);
      this._farBatches.push(mesh);
    }
    this._builtFarSignature = this._farSignature;
  }

  setDetailLevel(showDetail) {
    this._showDetail = !!showDetail;
    for (const object of this._objectsById.values()) {
      object.visible = this._showDetail;
      object.userData.lodHidden = !this._showDetail;
    }
    if (!this._showDetail) this._rebuildFarBatches();
    for (const mesh of this._farBatches) mesh.visible = !this._showDetail;
  }

  /**
   * Build equipment and furnishing meshes from snapshot data.
   * @param {Array} equipmentData
   * @param {Array} furnishingData
   * @param {THREE.Group} parentGroup
   */
  build(equipmentData, furnishingData, parentGroup, { changes = null } = {}) {
    const FACE_KEYS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

    const placeOne = (item, isFurnishing) => {
      const compDef = PLACEABLES[item.type];
      if (!compDef && !isFurnishing) return;
      if (compDef && compDef.isRack) return;

      // Footprint (in subtiles) — must match Placeable.footprintCells, which
      // swaps subW/subL when dir is 1 or 3. The visual mesh/group is then
      // rotated around its center (set below) so geometry matches occupancy.
      const { centerX, centerZ, baseY, rotY } =
        _equipmentPlacement(item, compDef, isFurnishing);
      const fallbackColor = compDef?.spriteColor || compDef?.color || 0x888888;
      const baseName = compDef?.baseMaterial || null;
      const physicsId = item.id ?? `${isFurnishing ? 'furnishing' : 'equipment'}:${item.type}:${item.col}:${item.row}:${item.subCol ?? 0}:${item.subRow ?? 0}`;
      const stampPhysicsIdentity = (object) => {
        object.userData ||= {};
        object.userData.physicsId = physicsId;
        object.userData.nodeId = physicsId;
        object.userData.placeableId = item.id ?? null;
        object.userData.placeableType = item.type;
        object.userData.effectState = item.effectState || 'on';
        object.userData.physicsKind = isFurnishing ? 'furnishing' : 'equipment';
        object.userData.physicsMassKg = Number(compDef?.physicsMassKg) || null;
        object.userData.physicsDensityKgM3 = Number(compDef?.physicsDensityKgM3) || null;
      };

      // ── Parts path ────────────────────────────────────────────────
      // If the def lists `parts`, build a Group with one Mesh per part.
      // Part coords are in SUBTILES, centered on the footprint, with
      // y=0 at the floor and y increasing upward. w/h/l are subtile-
      // unit sizes. Parts default to boxes and may opt into the validated
      // primitive vocabulary. Each part may override baseMaterial/color.
      if (Array.isArray(compDef?.parts) && compDef.parts.length > 0) {
        const group = new THREE.Group();
        // Variant overrides: per-part { material?, color? } merged over the
        // authored part spec. Uses `'material' in override` semantics so an
        // explicit null ("no texture, just color") is honored instead of
        // falling back to the authored material.
        const variantIdx = item.variant || 0;
        const partOverrides = compDef.variantOverrides?.[variantIdx] || null;
        const glowSpecs = compDef.parts.map(part => equipmentPartGlowSpec(compDef, part));
        let physicalGlowIndex = -1;
        for (let i = 0; i < glowSpecs.length; i++) {
          if (!glowSpecs[i]) continue;
          if (physicalGlowIndex < 0 || glowSpecs[i].priority > glowSpecs[physicalGlowIndex].priority) {
            physicalGlowIndex = i;
          }
        }
        // Static parts collect into per-surface buckets and become one merged
        // mesh each; glow parts stay individual (see the merging notes above).
        /** @type {Map<string, { material: THREE.Material, entries: Array, manifest: Array }>} */
        const staticBuckets = new Map();
        const partMatrix = new THREE.Matrix4();
        const partEuler = new THREE.Euler();
        const partQuat = new THREE.Quaternion();
        const partPos = new THREE.Vector3();
        const partScale = new THREE.Vector3(1, 1, 1);

        for (const [partIndex, part] of compDef.parts.entries()) {
          const pw = (part.w || 1) * SUB_UNIT;
          const ph = (part.h || 1) * SUB_UNIT;
          const pl = (part.l || 1) * SUB_UNIT;
          const reflectiveMirror = part.surface === 'mirror'
            && item.presentation !== 'ghost';
          const geo = reflectiveMirror
            ? new THREE.PlaneGeometry(pw, ph)
            : createEquipmentPartGeometry(part, pw, ph, pl);
          const ov = partOverrides?.[part.name];
          const partMatName = (ov && 'material' in ov) ? ov.material : part.material;
          const partColorHex = (ov && 'color' in ov) ? ov.color : part.color;
          const partBase = partMatName ?? baseName;
          const partColor = partColorHex ?? (partBase ? null : fallbackColor);
          const glowSpec = equipmentPartGlowSpec(compDef, { ...part, color: partColorHex });
          // Part position: (x, z) is the part's center in the footprint-
          // centered plane; y is its BOTTOM (easier to author), so we
          // lift by h/2 to get the BoxGeometry center.
          partPos.set(
            (part.x || 0) * SUB_UNIT,
            ((part.y || 0) + (part.h || 1) / 2) * SUB_UNIT,
            (part.z || 0) * SUB_UNIT,
          );
          if (Array.isArray(part.rotation)) {
            partEuler.set(part.rotation[0], part.rotation[1], part.rotation[2]);
          } else {
            partEuler.set(0, 0, 0);
          }

          if (reflectiveMirror) {
            // Bathroom furnishings face local -Z. Rotate both the visible
            // plane and ReflectorNode's hidden target so its clipping plane
            // and virtual camera use that same room-facing normal.
            geo.rotateY(Math.PI);
            const { material, reflectionNode } = createReflectiveMirrorMaterial();
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.copy(partPos);
            mesh.position.z -= pl / 2 + 0.002;
            mesh.rotation.copy(partEuler);
            reflectionNode.target.rotation.y = Math.PI;
            reflectionNode.target.matrixAutoUpdate = false;
            reflectionNode.target.updateMatrix();
            mesh.add(reflectionNode.target);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.userData.partName = part.name || null;
            mesh.userData.parts = [{ name: part.name || null, shape: 'plane' }];
            mesh.userData.isReflectiveMirrorSurface = true;
            mesh.userData.reflectorBaseNode = reflectionNode.reflector;
            mesh.userData.ownsMaterial = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            group.add(mesh);
            continue;
          }

          if (glowSpec) {
            const mesh = new THREE.Mesh(
              geo, getGlowMaterial(`${compDef.id}:parts`, glowSpec.color),
            );
            mesh.userData.partName = part.name || null;
            mesh.userData.partShape = part.shape || 'box';
            mesh.userData.parts = [{ name: part.name || null, shape: part.shape || 'box' }];
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.position.copy(partPos);
            mesh.rotation.copy(partEuler);
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            configureGlowMesh(mesh, {
              profile: glowSpec.profile,
              light: partIndex === physicalGlowIndex ? glowSpec.light : false,
            });
            group.add(mesh);
            continue;
          }

          // Static part: bake the local transform into the geometry and file
          // it under its resolved surface. `_partMaterial` stays the single
          // source of truth for how map/colour/roughness resolve — we merely
          // read the answer back off the material it hands us.
          const sourceMat = _partMaterial(partBase, partColor);
          partQuat.setFromEuler(partEuler);
          partMatrix.compose(partPos, partQuat, partScale);
          geo.applyMatrix4(partMatrix);
          const key = _mergedSurfaceKey(sourceMat);
          let bucket = staticBuckets.get(key);
          if (!bucket) {
            bucket = { material: _mergedPartMaterial(sourceMat), entries: [], manifest: [] };
            staticBuckets.set(key, bucket);
          }
          bucket.entries.push({ geometry: geo, color: sourceMat.color });
          bucket.manifest.push({ name: part.name || null, shape: part.shape || 'box' });
        }

        for (const bucket of staticBuckets.values()) {
          const merged = _mergePartGeometries(bucket.entries);
          for (const entry of bucket.entries) entry.geometry.dispose();
          const mesh = new THREE.Mesh(merged, bucket.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          // The individual parts no longer exist as objects; keep their
          // identity as a manifest so catalogue tests and debugging can still
          // ask what went into this surface.
          mesh.userData.parts = bucket.manifest;
          mesh.userData.mergedPartCount = bucket.manifest.length;
          group.add(mesh);
        }
        group.position.set(centerX, baseY, centerZ);
        group.rotation.y = rotY;
        group.matrixAutoUpdate = false;
        group.updateMatrix();
        stampPhysicsIdentity(group);
        // PORT STUBS disabled — will revisit with connected routing
        // if (!isFurnishing) {
        //   const portStubs = buildPortStubs(
        //     item.type,
        //     ((compDef.subW || compDef.gridW || 2) * SUB_UNIT) / 2,
        //     (compDef.subL || compDef.gridH || 2) * SUB_UNIT,
        //   );
        //   if (portStubs) group.add(portStubs);
        // }
        return group;
      }

      // ── Single-box path ──────────────────────────────────────────
      // Visual dims — may be smaller (or larger) than the footprint so a
      // benchtop instrument can take a full subtile of room but render at
      // realistic scale. Defaults to the footprint when not authored.
      const { width: w, height: h, depth: l } =
        _equipmentVisualDimensions(compDef, isFurnishing);

      const geo = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geo, w, h, l);

      const faces = compDef?.faces || {};

      for (const key of FACE_KEYS) {
        if (faces[key]?.decal) _setFaceUVsClamped(geo, key);
      }

      const matArray = FACE_KEYS.map(key =>
        _faceMaterial(item.type, key, baseName, faces[key], fallbackColor)
      );

      const mesh = new THREE.Mesh(geo, matArray);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.position.set(0, h / 2, 0);
      mesh.updateMatrix();

      const wrapper = new THREE.Group();
      wrapper.position.set(centerX, baseY, centerZ);
      wrapper.rotation.y = rotY;
      wrapper.matrixAutoUpdate = false;
      wrapper.add(mesh);
      // The base housing keeps its authored decal faces.  Fallback-only
      // placeables receive their reviewed mechanical details around that
      // housing, so facilities no longer read as unlabeled cubes.
      const details = buildPlaceableVisualDetails(compDef, {
        width: w, height: h, length: l, color: fallbackColor,
      });
      if (details) {
        details.position.y = h / 2;
        wrapper.add(details);
      }
      // PORT STUBS disabled — will revisit with connected routing
      // if (!isFurnishing) {
      //   const portStubs = buildPortStubs(
      //     item.type,
      //     ((compDef?.subW || compDef?.gridW || 2) * SUB_UNIT) / 2,
      //     (compDef?.subL || compDef?.gridH || 2) * SUB_UNIT,
      //   );
      //   if (portStubs) wrapper.add(portStubs);
      // }
      wrapper.updateMatrix();
      stampPhysicsIdentity(wrapper);

      return wrapper;
    };

    const desiredEntry = (item, isFurnishing) => {
      const fallbackId = `${item.type}:${item.col}:${item.row}:${item.subCol ?? 0}:${item.subRow ?? 0}`;
      const id = `${isFurnishing ? 'furnishing' : 'equipment'}:${item.id ?? fallbackId}`;
      return [id, { item, isFurnishing, signature: contentKey([isFurnishing, item]) }];
    };
    const replace = (id, wanted) => {
      const existing = this._objectsById.get(id);
      if (existing && wanted && this._signaturesById.get(id) === wanted.signature) return;
      if (existing) this._disposeObject(existing, parentGroup);
      if (!wanted) {
        this._objectsById.delete(id);
        this._signaturesById.delete(id);
        return;
      }
      const object = placeOne(wanted.item, wanted.isFurnishing);
      if (object) {
        parentGroup.add(object);
        this._objectsById.set(id, object);
        this._signaturesById.set(id, wanted.signature);
      } else {
        this._objectsById.delete(id);
        this._signaturesById.delete(id);
      }
    };

    // Exact mutation patch: snapshot reconciliation retained every untouched
    // item, so avoid hashing or visiting all of their detailed child meshes.
    if (changes instanceof Map && changes.size > 0) {
      const equipmentById = new Map((equipmentData || []).map(item => [item.id, item]));
      const furnishingsById = new Map((furnishingData || []).map(item => [item.id, item]));
      for (const change of changes.values()) {
        const isFurnishing = change.kind === 'furnishing';
        if (!isFurnishing && change.kind !== 'equipment') continue;
        const id = `${isFurnishing ? 'furnishing' : 'equipment'}:${change.id}`;
        const item = (isFurnishing ? furnishingsById : equipmentById).get(change.id);
        replace(id, item ? desiredEntry(item, isFurnishing)[1] : null);
      }
      this._meshes = Array.from(this._objectsById.values());
      this._queueFarBatches(equipmentData, furnishingData, parentGroup);
      this.setDetailLevel(this._showDetail);
      return;
    }

    const desired = new Map();
    const collect = (item, isFurnishing) => {
      const [id, entry] = desiredEntry(item, isFurnishing);
      desired.set(id, entry);
    };
    if (equipmentData) for (const eq of equipmentData) collect(eq, false);
    if (furnishingData) for (const furn of furnishingData) collect(furn, true);

    // Reconcile by stable id. Unchanged tables, racks, consoles, and their
    // detailed child meshes remain attached; only added/updated/removed
    // entries allocate or dispose geometry.
    for (const [id, wanted] of desired) {
      replace(id, wanted);
    }
    for (const [id, object] of this._objectsById) {
      if (desired.has(id)) continue;
      this._disposeObject(object, parentGroup);
      this._objectsById.delete(id);
      this._signaturesById.delete(id);
    }
    this._meshes = Array.from(this._objectsById.values());
    this._queueFarBatches(equipmentData, furnishingData, parentGroup);
    this.setDetailLevel(this._showDetail);
  }

  _disposeObject(obj, parentGroup) {
    parentGroup.remove(obj);
    obj.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
      child.userData?.reflectorBaseNode?.dispose?.();
      if (child.userData?.ownsMaterial) child.material?.dispose?.();
    });
  }

  /**
   * Remove all meshes from group and dispose geometries. Materials live in
   * _equipMatCache and are shared across instances and rebuilds — DO NOT
   * dispose them here.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    this._disposeFarBatches();
    for (const obj of this._objectsById.values()) this._disposeObject(obj, parentGroup);
    this._objectsById.clear();
    this._signaturesById.clear();
    this._meshes = [];
    this._farSource = null;
    this._farSignature = null;
  }
}

/**
 * Build one furnishing/equipment visual at a floor-relative local origin.
 *
 * Placement ghosts use this instead of ComponentBuilder's beam-axis fallback
 * so their geometry and vertical datum are identical to the committed object.
 * The returned object is detached from the temporary builder group and is
 * owned by the caller.
 */
export function createEquipmentObject(item, isFurnishing = false) {
  const builder = new EquipmentBuilder();
  const parent = new THREE.Group();
  const localItem = {
    ...item,
    col: 0,
    row: 0,
    subCol: 0,
    subRow: 0,
    dir: 0,
    placeY: 0,
  };
  builder.build(
    isFurnishing ? [] : [localItem],
    isFurnishing ? [localItem] : [],
    parent,
  );
  const object = parent.children[0] || null;
  if (!object) return null;
  parent.remove(object);
  object.position.set(0, 0, 0);
  object.rotation.y = 0;
  object.updateMatrix();
  return object;
}
