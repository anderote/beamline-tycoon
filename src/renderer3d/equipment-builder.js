// src/renderer3d/equipment-builder.js
// Renders equipment and zone furnishings from authored box/cylinder/sphere/
// torus/cone parts. Fallback boxes use a 6-entry material array (one per
// face) so a face can independently use a tiled MATERIAL or a DECAL.
// THREE is a CDN global — do NOT import it.

import { PLACEABLES } from '../data/placeables/index.js';
import { MATERIALS } from './materials/index.js';
import { DECALS } from './materials/decals.js';
import { applyTiledBoxUVs } from './uv-utils.js';
import { buildPlaceableVisualDetails } from './placeable-visual-details.js';
import { configureGlowMesh, getGlowMaterial } from './machine-glow.js';
import { contentKey } from './content-hash.js';
// Phase 6: utility-port-builder removed; all buildPortStubs call sites in
// this file were already commented out.

// BoxGeometry face order is [+X, -X, +Y, -Y, +Z, -Z]; each face has 4 UVs,
// 8 floats per face in the uv attribute array.
const FACE_INDEX = { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 };

const SUB_UNIT = 0.5;
const PRIMITIVE_SEGMENTS = 16;

// Cache per (compType + faceKey + base + override) -> material so identical
// face configs share. Module-level cache lives across rebuilds and instances.
const _equipMatCache = new Map();

// Cache for simple single-material parts (no per-face overrides) keyed on
// `baseName|colorHex` so every leg/top/shelf sharing the same spec reuses
// a single MeshStandardMaterial.
const _partMatCache = new Map();

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
  constructor() {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
    this._objectsById = new Map();
    this._signaturesById = new Map();
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
      const dir = item.dir || 0;
      const swapFoot = (dir === 1 || dir === 3);
      const defW = compDef?.subW || (isFurnishing ? 1 : 2);
      const defL = compDef?.subL || compDef?.subH || (isFurnishing ? 1 : 2);
      const footW = (swapFoot ? defL : defW) * SUB_UNIT;
      const footL = (swapFoot ? defW : defL) * SUB_UNIT;

      const tileX = (item.col ?? 0) * 2;
      const tileZ = (item.row ?? 0) * 2;
      const subX = (item.subCol || 0) * SUB_UNIT;
      const subZ = (item.subRow || 0) * SUB_UNIT;
      const centerX = tileX + subX + footW / 2;
      const centerZ = tileZ + subZ + footL / 2;
      const baseY = (item.placeY || 0) * SUB_UNIT;
      const rotY = -dir * (Math.PI / 2);
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
          const geo = createEquipmentPartGeometry(part, pw, ph, pl);
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
      const vSubW = compDef?.visualSubW ?? compDef?.subW ?? (isFurnishing ? 1 : 2);
      const vSubH = compDef?.visualSubH ?? compDef?.subH ?? (isFurnishing ? 1 : 2);
      const vSubL = compDef?.visualSubL ?? compDef?.subL ?? compDef?.subH ?? (isFurnishing ? 1 : 2);
      const w = vSubW * SUB_UNIT;
      const h = vSubH * SUB_UNIT;
      const l = vSubL * SUB_UNIT;

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
  }

  _disposeObject(obj, parentGroup) {
    parentGroup.remove(obj);
    obj.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry.dispose();
    });
  }

  /**
   * Remove all meshes from group and dispose geometries. Materials live in
   * _equipMatCache and are shared across instances and rebuilds — DO NOT
   * dispose them here.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const obj of this._objectsById.values()) this._disposeObject(obj, parentGroup);
    this._objectsById.clear();
    this._signaturesById.clear();
    this._meshes = [];
  }
}
