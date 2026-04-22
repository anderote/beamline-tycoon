// src/renderer3d/grass-tuft-builder.js
// Scatters 3D grass across grass cells. Two sibling InstancedMeshes:
//   - clump mesh: ~7-blade tufts for default terrain + grass + wildgrass
//   - tall-blade mesh: dense single upright blades grouped into tufts for
//     tallgrass, with short/medium/tall height classes per tuft
// Per-cell count, position jitter, color, scale, and rotation all derive
// from the cell's existing hash so rebuilds are deterministic.
// THREE is a CDN global — do NOT import it.
//
// Pure helpers (`computeGrassTuftsForCell`, `computeTallGrassBladesForCell`)
// have NO Three.js dependencies so they can be unit-tested under plain Node.

import { sampleCornersAt } from '../game/terrain.js';

/** Clump tuft palette — darks and brights so neighbouring tufts read as
 *  lighter/darker patches within a single tile. */
const GRASS_COLORS = [
  0x1e4410, 0x28501c, 0x36681f, 0x4a8c2e,  // darks
  0x5f9b2e, 0x7ab03c, 0x8ec23e, 0xa3cd52,  // brights
];

/** Tall-grass blade palette — skewed toward olive / dry-grass greens so the
 *  hair-like field reads with a late-summer, slightly wheat-adjacent feel
 *  without going full yellow. */
const TALL_GRASS_COLORS = [
  0x4a6a28, 0x5a7a30, 0x6a8a38, 0x7a9540,
  0x8aaa42, 0x9ab856, 0x7e8a30, 0x6a7228,
];

/** Reed palette — straw / dried cattail tones. Reeds are the tallest,
 *  nearly-upright stalks that sprinkle through the tall-grass field. */
const REED_COLORS = [
  0xbca05a, 0xa89040, 0xc8b060, 0x8e7a30,
  0x9a8540, 0x6a7028, 0xa89a50, 0x585020,
];

/** Per-kind density multiplier for placed clump-style grass. Tall grass
 *  gets the same rough clump coverage as wildgrass AND the single-blade
 *  tufts from the tall mesh layered on top. */
export const GRASS_DENSITY_MUL = {
  grass:     1.0,
  wildgrass: 3.0,
  tallgrass: 3.0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Pure per-cell grass tuft generator — the clump-style tufts used by default
 * terrain, `grass`, and `wildgrass`. Positions are in tile units centered on
 * (col, row); offsets are ±0.45 of a tile.
 *
 * @param {number} col
 * @param {number} row
 * @param {number} hash       32-bit integer hash for the cell
 * @param {number} brightness terrain brightness in [-1, 1]
 * @param {number} [densityMul=1]  multiplier on the density curve
 * @returns {Array<{x:number,y:number,z:number,scale:number,rotY:number,colorHex:number}>}
 */
export function computeGrassTuftsForCell(col, row, hash, brightness, densityMul = 1, corners = null) {
  const c = corners || { nw: 0, ne: 0, se: 0, sw: 0 };
  const brightGate = clamp((brightness + 0.5) * 1.2, 0, 1);
  const density = (0.5 + brightGate * 0.7) * densityMul;
  const hash01 = (hash & 0xFFFF) / 0xFFFF;
  const n = Math.floor(hash01 * density * 10);

  const tufts = [];
  for (let i = 0; i < n; i++) {
    const th = (Math.imul(hash, 0x85ebca6b) + Math.imul(i, 0xc2b2ae35)) | 0;
    const uh = th >>> 0;

    const offX = ((uh         & 0xFF) / 255 - 0.5) * 0.9;
    const offZ = (((uh >>> 8)  & 0xFF) / 255 - 0.5) * 0.9;
    const colorIdx = (uh >>> 16) & 0x7;
    const scale = 0.7 + (((uh >>> 19) & 0xF) / 15) * 0.6;
    const rotY  = (((uh >>> 23) & 0xFF) / 255) * 2 * Math.PI;

    const u = offX + 0.5;
    const v = offZ + 0.5;
    const y = sampleCornersAt(c, u, v);

    tufts.push({
      x: col + offX, y, z: row + offZ,
      scale, rotY, colorHex: GRASS_COLORS[colorIdx],
    });
  }
  return tufts;
}

/**
 * Pure per-cell tall-grass blade generator — dense blades grouped into
 * 7–10 tufts per tile. Each tuft has a height class (short/medium/tall)
 * so the field reads as varied height instead of a uniform fringe.
 *
 * Blade geometry is a unit-height triangle (H=1 in the mesh); the `scale`
 * returned here maps directly to meters. All classes lean (nothing is
 * perfectly upright — real grass and reeds both bend):
 *   short  ≈ 0.30 m
 *   medium ≈ 0.55 m
 *   tall   ≈ 0.85 m
 *   reed   ≈ 1.08 m  (straw-toned — the color differentiates, not rigidity)
 *
 * Blades per tile: 7..10 tufts × 14/18/22/12 per tuft → ~100..220 total.
 *
 * @param {number} col
 * @param {number} row
 * @param {number} hash       32-bit integer hash for the cell
 * @param {number} brightness terrain brightness in [-1, 1] (unused for
 *                             density — tall grass is uniformly dense — but
 *                             kept in the signature for symmetry + future
 *                             subtle variation).
 * @returns {Array<{x:number,y:number,z:number,scale:number,rotY:number,tilt:number,colorHex:number}>}
 */
// eslint-disable-next-line no-unused-vars
export function computeTallGrassBladesForCell(col, row, hash, brightness, corners = null) {
  const c = corners || { nw: 0, ne: 0, se: 0, sw: 0 };
  const tuftCount = 7 + ((hash >>> 3) & 0x3);  // 7..10 tufts

  const blades = [];
  for (let t = 0; t < tuftCount; t++) {
    const th = (Math.imul(hash, 0x85ebca6b) + Math.imul(t, 0xc2b2ae35)) | 0;
    const uh = th >>> 0;

    // Tuft center within tile (±0.38 so cluster radius fits inside ±0.48).
    const cx = ((uh         & 0xFF) / 255 - 0.5) * 0.76;
    const cz = (((uh >>> 8) & 0xFF) / 255 - 0.5) * 0.76;

    // Height class: ~25% short, ~37% medium, ~25% tall, ~12% reed.
    const classBits = (uh >>> 16) & 0x7;
    let heightScale, bladesPerTuft, isReed;
    if (classBits < 2)       { heightScale = 0.30; bladesPerTuft = 14; isReed = false; }
    else if (classBits < 5)  { heightScale = 0.55; bladesPerTuft = 18; isReed = false; }
    else if (classBits < 7)  { heightScale = 0.85; bladesPerTuft = 22; isReed = false; }
    else                     { heightScale = 1.08; bladesPerTuft = 12; isReed = true;  }

    for (let b = 0; b < bladesPerTuft; b++) {
      const bh = (Math.imul(uh, 0x2c6fe996) + Math.imul(b, 0x50c5d1f3)) | 0;
      const vh = bh >>> 0;

      // Reeds cluster tighter (0.02..0.07) so they read as a bunch of
      // stalks sharing a base; grass tufts splay wider.
      const rMax = isReed ? 0.05 : 0.08;
      const radius = 0.02 + ((vh & 0xFF) / 255) * rMax;
      const ang = (((vh >>> 8) & 0xFF) / 255) * 2 * Math.PI;
      const offX = clamp(cx + Math.cos(ang) * radius, -0.48, 0.48);
      const offZ = clamp(cz + Math.sin(ang) * radius, -0.48, 0.48);

      const u = offX + 0.5;
      const v = offZ + 0.5;
      const y = sampleCornersAt(c, u, v);

      const colorIdx = (vh >>> 16) & 0x7;
      // ±10% height jitter within the tuft so even a "short" tuft has a
      // few taller standouts. Kept tight so height classes stay visually
      // separable; max total height = 1.08 × 1.10 ≈ 1.19 m.
      const scale = heightScale * (0.90 + (((vh >>> 19) & 0x7) / 7) * 0.2);
      const rotY = (((vh >>> 22) & 0xFF) / 255) * 2 * Math.PI;
      // Every blade leans — nothing stands perfectly upright. Reeds get a
      // slightly gentler range (0.10..0.35 rad, ~6°..20°) so they arc
      // instead of buckling like grass, which bends harder (0.12..0.55
      // rad, ~7°..31°).
      const tilt = isReed
        ? 0.10 + (((vh >>> 14) & 0xF) / 15) * 0.25
        : 0.12 + (((vh >>> 14) & 0xF) / 15) * 0.43;

      const colorHex = isReed ? REED_COLORS[colorIdx] : TALL_GRASS_COLORS[colorIdx];
      blades.push({
        x: col + offX, y, z: row + offZ,
        scale, rotY, tilt,
        colorHex,
      });
    }
  }
  return blades;
}

/**
 * Builds the two instanced grass meshes. `add(parent)` attaches to a
 * Three.js Group/Scene. `rebuild(snapshot)` rebuilds from a world snapshot.
 * `dispose()` removes and disposes owned geometry/materials.
 */
export class GrassTuftBuilder {
  constructor() {
    this._parent = null;
    this._clumpMesh = null;
    this._tallMesh = null;
  }

  add(parent) {
    this._parent = parent;
  }

  rebuild(snapshot) {
    this._disposeMeshes();
    if (!this._parent) return;
    if (typeof THREE === 'undefined') return; // test/headless safety
    const terrain = snapshot?.terrain ?? [];
    const grassSurfaces = snapshot?.grassSurfaces ?? [];

    this._buildClumpMesh(terrain, grassSurfaces);
    const tallCells = grassSurfaces.filter(c => c.kind === 'tallgrass');
    if (tallCells.length > 0) this._buildTallMesh(tallCells);
  }

  dispose() {
    this._disposeMeshes();
    this._parent = null;
  }

  // --- Clump mesh (default terrain + grass + wildgrass + tallgrass) ---------
  // Tallgrass gets clumps too so the "rough grass" layer sits beneath the
  // single-blade tufts — reads as wildgrass with taller stalks on top.

  _buildClumpMesh(terrain, grassSurfaces) {
    const clumpCells = grassSurfaces;
    if (terrain.length === 0 && clumpCells.length === 0) return;

    // 7-blade clump geometry — one central upright blade + 6 in a ring,
    // each tilted outward so tips splay. Per-instance rotY adds variety.
    // Rows: [cx, cz, facing (rad), tiltDeg, height (m)]
    const R = 0.05;
    const BLADES = [
      [ 0.00,      0.00,        0.30,          0,   0.30 ],
      [ R,         0.00,        0,             18,  0.24 ],
      [ R * 0.5,   R * 0.866,   Math.PI / 3,   22,  0.20 ],
      [-R * 0.5,   R * 0.866, 2*Math.PI / 3,   15,  0.27 ],
      [-R,         0.00,        Math.PI,       20,  0.22 ],
      [-R * 0.5,  -R * 0.866, 4*Math.PI / 3,   18,  0.18 ],
      [ R * 0.5,  -R * 0.866, 5*Math.PI / 3,   24,  0.25 ],
    ];
    const BLADE_W = 0.025;
    const positions = [];
    for (const [cx, cz, facing, tiltDeg, h] of BLADES) {
      const fx = Math.cos(facing), fz = Math.sin(facing);
      const px = -fz, pz = fx;
      const hw = BLADE_W * 0.5;
      const tilt = tiltDeg * Math.PI / 180;
      const tipX = cx + fx * Math.sin(tilt) * h;
      const tipZ = cz + fz * Math.sin(tilt) * h;
      const tipY =      Math.cos(tilt) * h;
      positions.push(
        cx - px * hw, 0, cz - pz * hw,
        cx + px * hw, 0, cz + pz * hw,
        tipX,         tipY, tipZ,
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide,
    });

    // Upper bound: 12/cell default + ~36/cell for wildgrass/tallgrass (3× mul).
    const maxCount = terrain.length * 12 + clumpCells.length * 40;
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.matrixAutoUpdate = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxCount * 3), 3
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let idx = 0;

    // Tile units -> world: terrain builder places cell centers at
    // (col*2+1, 0, row*2+1). Tufts sit on the terrain surface, sampled from per-tile corner heights.
    for (const cell of terrain) {
      const tufts = computeGrassTuftsForCell(cell.col, cell.row, cell.hash, cell.brightness, 1, cell.cornersY || null);
      for (const t of tufts) {
        idx = this._writeInstance(mesh, dummy, color, idx, t, 1);
      }
    }
    for (const cell of clumpCells) {
      const mul = GRASS_DENSITY_MUL[cell.kind] ?? 1;
      const tufts = computeGrassTuftsForCell(cell.col, cell.row, cell.hash, cell.brightness, mul, cell.cornersY || null);
      for (const t of tufts) {
        idx = this._writeInstance(mesh, dummy, color, idx, t, 1);
      }
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this._parent.add(mesh);
    this._clumpMesh = mesh;
  }

  _writeInstance(mesh, dummy, color, idx, t, yScale) {
    dummy.position.set(t.x * 2 + 1, t.y, t.z * 2 + 1);
    dummy.rotation.set(0, t.rotY, 0);
    dummy.scale.set(t.scale, t.scale * yScale, t.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(idx, dummy.matrix);
    color.setHex(t.colorHex);
    mesh.setColorAt(idx, color);
    return idx + 1;
  }

  // --- Tall-grass mesh (dense single blades) ---------------------------------

  _buildTallMesh(tallCells) {
    // Single narrow upright blade: 1 triangle of unit height. Per-instance
    // `scale` returned by computeTallGrassBladesForCell is in meters (short
    // ~0.3 m, medium ~0.55 m, tall ~0.85 m). Rendered double-sided so it's
    // visible from every angle.
    const H = 1.0;
    const W = 0.012;
    const positions = [
      -W * 0.5, 0, 0,
       W * 0.5, 0, 0,
       0,       H, 0,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide,
    });

    // Per-tuft max 22 blades × up to 10 tufts = 220; allocate 240 to be safe.
    const maxCount = tallCells.length * 240;
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.matrixAutoUpdate = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxCount * 3), 3
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let idx = 0;

    for (const cell of tallCells) {
      const blades = computeTallGrassBladesForCell(cell.col, cell.row, cell.hash, cell.brightness, cell.cornersY || null);
      for (const b of blades) {
        dummy.position.set(b.x * 2 + 1, b.y, b.z * 2 + 1);
        // Compose Y-rotation (facing) with a small forward tilt (lean).
        // Euler order 'YXZ' applies rotY first, then tilt around local X.
        dummy.rotation.set(b.tilt, b.rotY, 0, 'YXZ');
        dummy.scale.set(b.scale, b.scale, b.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        color.setHex(b.colorHex);
        mesh.setColorAt(idx, color);
        idx++;
      }
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this._parent.add(mesh);
    this._tallMesh = mesh;
  }

  _disposeMeshes() {
    for (const m of [this._clumpMesh, this._tallMesh]) {
      if (!m) continue;
      if (this._parent) this._parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this._clumpMesh = null;
    this._tallMesh = null;
  }
}
