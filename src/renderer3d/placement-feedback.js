// Lightweight, presentation-only feedback for committing a placeable.
//
// The game model remains at its canonical pose. This coordinator briefly
// offsets the renderer-owned wrapper, then restores it exactly. Dust uses one
// bounded instanced draw so stamping a line or moving a group cannot create a
// scene-object storm.

export const PLACEMENT_GHOST_LIFT = 0.24;
export const PLACEMENT_SETTLE_DURATION = 0.36;
export const PLACEMENT_IMPACT_PROGRESS = 0.56;
export const MAX_PLACEMENT_DUST_PUFFS = 128;

const BOUNCE_END_PROGRESS = 0.84;
const DUST_LIFETIME = 0.48;
const DUST_COLORS = Object.freeze([0xd8c39e, 0xc9ae82, 0xb9986b, 0xe4d3b1]);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

/** Vertical offset shared by the hover handoff and committed settle. */
export function placementSettleOffset(progress, lift = PLACEMENT_GHOST_LIFT) {
  const t = clamp01(progress);
  const height = Math.max(0, Number(lift) || 0);
  if (t < PLACEMENT_IMPACT_PROGRESS) {
    const fall = t / PLACEMENT_IMPACT_PROGRESS;
    return height * (1 - fall * fall);
  }
  if (t < BOUNCE_END_PROGRESS) {
    const bounce = (t - PLACEMENT_IMPACT_PROGRESS)
      / (BOUNCE_END_PROGRESS - PLACEMENT_IMPACT_PROGRESS);
    return height * 0.16 * Math.sin(Math.PI * bounce);
  }
  return 0;
}

/** Puffy grow-and-fade envelope; fading is represented by shrinking to zero. */
export function placementDustScale(progress) {
  const t = clamp01(progress);
  return Math.pow(Math.sin(Math.PI * t), 0.72) * (0.72 + t * 0.4);
}

/** Exact ids that should receive feedback from a placeable compatibility event. */
export function placementFeedbackIds(data) {
  if (data?.action !== 'placed' && data?.action !== 'moved') return [];
  const changes = data.changeSet?.placeables;
  if (changes instanceof Map) {
    return [...changes.values()]
      .filter(change => change?.id != null && change.action !== 'removed')
      .map(change => change.id);
  }
  return data.placeableId == null ? [] : [data.placeableId];
}

function setObjectYOffset(object, canonicalY, offset) {
  if (!object?.position) return;
  object.position.y = canonicalY + offset;
  if (object.matrixAutoUpdate === false) object.updateMatrix?.();
}

/**
 * @typedef {{
 *   object: object,
 *   dustY?: number,
 *   footprintRadius?: number,
 *   footprintHalfWidth?: number,
 *   footprintHalfDepth?: number,
 *   supported?: boolean,
 * }} PlacementFeedbackTarget
 */

export class PlacementFeedbackSystem {
  constructor(scene, {
    resolveTarget,
    random = Math.random,
    maxDustPuffs = MAX_PLACEMENT_DUST_PUFFS,
    enabled = true,
  } = {}) {
    this.scene = scene;
    this.resolveTarget = typeof resolveTarget === 'function' ? resolveTarget : () => null;
    this.random = typeof random === 'function' ? random : Math.random;
    this.enabled = enabled !== false;
    this.maxDustPuffs = Math.max(0, Math.min(
      MAX_PLACEMENT_DUST_PUFFS, Math.floor(Number(maxDustPuffs) || 0),
    ));
    this.pending = new Map();
    this.active = new Map();
    this.dust = [];

    this.group = new THREE.Group();
    this.group.name = 'placementFeedback';
    scene?.add?.(this.group);

    this.dustMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        vertexColors: true,
      }),
      Math.max(1, this.maxDustPuffs),
    );
    this.dustMesh.name = 'placementDustPuffs';
    this.dustMesh.count = 0;
    this.dustMesh.frustumCulled = false;
    this.dustMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
    this.group.add(this.dustMesh);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
    this._color = new THREE.Color();
  }

  /** Queue an id until the frame-coalesced world rebuild exposes its wrapper. */
  request(placeableId, options = {}) {
    if (!this.enabled || placeableId == null) return false;
    const id = String(placeableId);
    const prior = this.active.get(id);
    if (prior) {
      setObjectYOffset(prior.object, prior.canonicalY, 0);
      this.active.delete(id);
    }
    this.pending.set(id, { id, wait: 0, ...options });
    return true;
  }

  update(dtSeconds) {
    if (!this.enabled) return;
    const dt = Math.max(0, Math.min(0.1, Number(dtSeconds) || 0));
    this._resolvePending(dt);

    for (const [id, landing] of [...this.active]) {
      landing.elapsed += dt;
      const progress = Math.min(1, landing.elapsed / PLACEMENT_SETTLE_DURATION);
      setObjectYOffset(
        landing.object,
        landing.canonicalY,
        placementSettleOffset(progress, landing.lift),
      );
      if (!landing.impacted && progress >= PLACEMENT_IMPACT_PROGRESS) {
        landing.impacted = true;
        this._emitDust(landing);
      }
      if (progress < 1) continue;
      setObjectYOffset(landing.object, landing.canonicalY, 0);
      this.active.delete(id);
    }

    this._updateDust(dt);
  }

  _resolvePending(dt) {
    for (const [id, request] of [...this.pending]) {
      const target = this.resolveTarget(id);
      if (target?.supported === false) {
        this.pending.delete(id);
        continue;
      }
      if (!target?.object?.position) {
        request.wait += dt;
        if (request.wait >= 0.75) this.pending.delete(id);
        continue;
      }
      const canonicalY = target.object.position.y;
      const fallbackRadius = Math.max(0.25, Number(target.footprintRadius) || 0.5);
      const landing = {
        id,
        object: target.object,
        canonicalY,
        dustY: Number.isFinite(target.dustY) ? target.dustY : canonicalY,
        footprintRadius: fallbackRadius,
        footprintHalfWidth: Math.max(
          0.25, Number(target.footprintHalfWidth) || fallbackRadius,
        ),
        footprintHalfDepth: Math.max(
          0.25, Number(target.footprintHalfDepth) || fallbackRadius,
        ),
        lift: Math.max(0, Number(request.lift) || PLACEMENT_GHOST_LIFT),
        elapsed: 0,
        impacted: false,
      };
      this.active.set(id, landing);
      this.pending.delete(id);
      setObjectYOffset(landing.object, canonicalY, landing.lift);
    }
  }

  _emitDust(landing) {
    if (this.maxDustPuffs <= 0) return;
    const room = Math.max(0, this.maxDustPuffs - this.dust.length);
    const count = Math.min(room, Math.max(5, Math.min(
      11, Math.round(5 + landing.footprintRadius * 1.8),
    )));
    const halfWidth = landing.footprintHalfWidth;
    const halfDepth = landing.footprintHalfDepth;
    const perimeter = 4 * (halfWidth + halfDepth);
    for (let i = 0; i < count; i++) {
      let distance = ((i + (this.random() - 0.5) * 0.45) / count) * perimeter;
      distance = (distance + perimeter) % perimeter;
      let localX;
      let localZ;
      let outwardX;
      let outwardZ;
      if (distance < halfWidth * 2) {
        localX = -halfWidth + distance;
        localZ = -halfDepth;
        outwardX = 0;
        outwardZ = -1;
      } else if ((distance -= halfWidth * 2) < halfDepth * 2) {
        localX = halfWidth;
        localZ = -halfDepth + distance;
        outwardX = 1;
        outwardZ = 0;
      } else if ((distance -= halfDepth * 2) < halfWidth * 2) {
        localX = halfWidth - distance;
        localZ = halfDepth;
        outwardX = 0;
        outwardZ = 1;
      } else {
        distance -= halfWidth * 2;
        localX = -halfWidth;
        localZ = halfDepth - distance;
        outwardX = -1;
        outwardZ = 0;
      }
      // Keep the impact localized: puffs begin just inside the footprint edge
      // and only ease a little farther out instead of erupting from the centre.
      const speed = (0.06 + this.random() * 0.1)
        * Math.min(1.35, 0.85 + landing.footprintRadius * 0.12);
      const inset = 0.82 + this.random() * 0.12;
      this.dust.push({
        x: landing.object.position.x + localX * inset,
        y: landing.dustY + 0.06 + this.random() * 0.04,
        z: landing.object.position.z + localZ * inset,
        vx: outwardX * speed,
        vz: outwardZ * speed,
        rise: 0.06 + this.random() * 0.1,
        radius: 0.04 + this.random() * 0.04,
        age: 0,
        lifetime: DUST_LIFETIME * (0.82 + this.random() * 0.36),
        color: DUST_COLORS[Math.floor(this.random() * DUST_COLORS.length) % DUST_COLORS.length],
      });
    }
  }

  _updateDust(dt) {
    const live = [];
    let index = 0;
    for (const puff of this.dust) {
      puff.age += dt;
      const progress = puff.age / puff.lifetime;
      if (progress >= 1 || index >= this.maxDustPuffs) continue;
      const drift = Math.max(0, 1 - progress * 0.72);
      puff.x += puff.vx * dt * drift;
      puff.z += puff.vz * dt * drift;
      const size = puff.radius * placementDustScale(progress);
      this._position.set(
        puff.x,
        puff.y + puff.rise * (progress + Math.sin(Math.PI * progress) * 0.45),
        puff.z,
      );
      this._scale.set(size * 1.15, size * 0.82, size);
      this._matrix.compose(this._position, this._rotation, this._scale);
      this.dustMesh.setMatrixAt(index, this._matrix);
      this._color.setHex(puff.color);
      this.dustMesh.setColorAt(index, this._color);
      live.push(puff);
      index++;
    }
    this.dust = live;
    this.dustMesh.count = index;
    this.dustMesh.instanceMatrix.needsUpdate = true;
    if (this.dustMesh.instanceColor) this.dustMesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const landing of this.active.values()) {
      setObjectYOffset(landing.object, landing.canonicalY, 0);
    }
    this.active.clear();
    this.pending.clear();
    this.dust.length = 0;
    this.dustMesh.count = 0;
    this.group.parent?.remove?.(this.group);
    this.dustMesh.geometry?.dispose?.();
    this.dustMesh.material?.dispose?.();
    this.scene = null;
  }
}

export default PlacementFeedbackSystem;
