// Dependency-free transient particle motion and collision.
//
// The renderer owns these particles: they never write transforms back into
// Game state. Colliders are conservative world-space AABBs measured from the
// authored scene. That is intentionally cheaper than giving every spark a
// rigid body while still letting hot pixels ricochet from walls, beamline
// hardware, infrastructure, equipment, and furnishings.

const EPS = 1e-6;
const MAX_STEP_SECONDS = 1 / 90;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeParticleCollider(raw) {
  const min = raw?.min || raw;
  const max = raw?.max || raw;
  const collider = {
    minX: finite(min?.x ?? raw?.minX),
    minY: finite(min?.y ?? raw?.minY),
    minZ: finite(min?.z ?? raw?.minZ),
    maxX: finite(max?.x ?? raw?.maxX),
    maxY: finite(max?.y ?? raw?.maxY),
    maxZ: finite(max?.z ?? raw?.maxZ),
  };
  if (collider.minX > collider.maxX) [collider.minX, collider.maxX] = [collider.maxX, collider.minX];
  if (collider.minY > collider.maxY) [collider.minY, collider.maxY] = [collider.maxY, collider.minY];
  if (collider.minZ > collider.maxZ) [collider.minZ, collider.maxZ] = [collider.maxZ, collider.minZ];
  return collider;
}

export function particleCollisionWorld({ boxes = [], floorY = 0 } = {}) {
  return {
    boxes: (boxes || []).map(normalizeParticleCollider).filter(box =>
      box.maxX - box.minX > EPS
      && box.maxY - box.minY > EPS
      && box.maxZ - box.minZ > EPS),
    floorY: finite(floorY),
  };
}

function reflect(particle, nx, ny, nz) {
  const incoming = particle.vx * nx + particle.vy * ny + particle.vz * nz;
  if (incoming >= 0) return;
  const impulse = (1 + particle.restitution) * incoming;
  particle.vx -= impulse * nx;
  particle.vy -= impulse * ny;
  particle.vz -= impulse * nz;
  // Tangential energy loss keeps sparks from skating forever along walls.
  const friction = Math.max(0, Math.min(1, particle.friction));
  const normalSpeed = particle.vx * nx + particle.vy * ny + particle.vz * nz;
  particle.vx = normalSpeed * nx + (particle.vx - normalSpeed * nx) * (1 - friction);
  particle.vy = normalSpeed * ny + (particle.vy - normalSpeed * ny) * (1 - friction);
  particle.vz = normalSpeed * nz + (particle.vz - normalSpeed * nz) * (1 - friction);
}

/** Resolve a spherical particle against one expanded AABB. */
export function collideParticleWithBox(particle, rawBox) {
  const box = rawBox.minX == null ? normalizeParticleCollider(rawBox) : rawBox;
  const radius = Math.max(0, finite(particle.radius, 0.025));
  const minX = box.minX - radius, maxX = box.maxX + radius;
  const minY = box.minY - radius, maxY = box.maxY + radius;
  const minZ = box.minZ - radius, maxZ = box.maxZ + radius;
  if (particle.x <= minX || particle.x >= maxX
      || particle.y <= minY || particle.y >= maxY
      || particle.z <= minZ || particle.z >= maxZ) return false;

  const faces = [
    { depth: particle.x - minX, nx: -1, ny: 0, nz: 0, axis: 'x', value: minX },
    { depth: maxX - particle.x, nx: 1, ny: 0, nz: 0, axis: 'x', value: maxX },
    { depth: particle.y - minY, nx: 0, ny: -1, nz: 0, axis: 'y', value: minY },
    { depth: maxY - particle.y, nx: 0, ny: 1, nz: 0, axis: 'y', value: maxY },
    { depth: particle.z - minZ, nx: 0, ny: 0, nz: -1, axis: 'z', value: minZ },
    { depth: maxZ - particle.z, nx: 0, ny: 0, nz: 1, axis: 'z', value: maxZ },
  ];
  faces.sort((a, b) => a.depth - b.depth);
  const face = faces[0];
  particle[face.axis] = face.value;
  reflect(particle, face.nx, face.ny, face.nz);
  return true;
}

function stepOnce(particle, dt, world) {
  particle.vy -= particle.gravity * dt;
  const damping = Math.exp(-Math.max(0, particle.drag) * dt);
  particle.vx *= damping;
  particle.vy *= damping;
  particle.vz *= damping;
  particle.x += particle.vx * dt;
  particle.y += particle.vy * dt;
  particle.z += particle.vz * dt;

  const floor = finite(world?.floorY);
  if (particle.y - particle.radius < floor) {
    particle.y = floor + particle.radius;
    reflect(particle, 0, 1, 0);
  }
  // Two passes resolve corners where a wall and machine box overlap.
  for (let pass = 0; pass < 2; pass++) {
    let collided = false;
    for (const box of (world?.boxes || [])) {
      collided = collideParticleWithBox(particle, box) || collided;
    }
    if (!collided) break;
  }
}

/** Advance one particle with bounded substeps so thin walls are not skipped. */
export function stepKineticParticle(particle, dtSeconds, world) {
  let remaining = Math.max(0, Math.min(0.1, finite(dtSeconds)));
  while (remaining > EPS) {
    const dt = Math.min(MAX_STEP_SECONDS, remaining);
    stepOnce(particle, dt, world);
    remaining -= dt;
  }
  particle.age += Math.max(0, finite(dtSeconds));
  return particle.age < particle.lifetime;
}

